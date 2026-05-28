from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from form2act.config import BASE_DIR, DIPLOMA_FORM_COLUMNS
from form2act.excel_io import read_sheet
from form2act.morphology import finalize_names, split_fio_parts
from form2act.utils import normalize_fio, row_to_record

DIPLOMA_TABLES_DIR = BASE_DIR / "uploads" / "diploma_tables"
REGISTRY_PATH = DIPLOMA_TABLES_DIR / "registry.json"

EXCEL_HEADERS = list(DIPLOMA_FORM_COLUMNS.keys())


def _read_diploma_df(path: Path) -> pd.DataFrame:
    if path.exists():
        df = pd.read_excel(path, dtype=str)
    else:
        df = pd.DataFrame(columns=EXCEL_HEADERS)
    for h in EXCEL_HEADERS:
        if h not in df.columns:
            df[h] = ""
    df = df[EXCEL_HEADERS]
    return df.fillna("").astype(str)


def _write_diploma_df(path: Path, df: pd.DataFrame) -> None:
    out = df[EXCEL_HEADERS].fillna("").astype(str)
    out.to_excel(path, index=False, sheet_name="Дипломы")


def _ensure_dir() -> None:
    DIPLOMA_TABLES_DIR.mkdir(parents=True, exist_ok=True)


def _load_registry() -> dict:
    _ensure_dir()
    if not REGISTRY_PATH.exists():
        return {"tables": []}
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _save_registry(data: dict) -> None:
    _ensure_dir()
    REGISTRY_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _table_path(table_id: str) -> Path:
    reg = _load_registry()
    for t in reg.get("tables", []):
        if t["id"] == table_id:
            return Path(t["path"])
    raise FileNotFoundError("Таблица не найдена")


def list_tables() -> list[dict]:
    reg = _load_registry()
    out = []
    for t in reg.get("tables", []):
        path = Path(t["path"])
        row_count = 0
        if path.exists():
            try:
                row_count = len(_read_diploma_df(path))
            except Exception:
                pass
        out.append(
            {
                "id": t["id"],
                "name": t["name"],
                "row_count": row_count,
                "exists": path.exists(),
                "created": t.get("created"),
            }
        )
    return out


def excel_rows_for_merge(table_id: str) -> list[dict[str, str]]:
    path = _table_path(table_id)
    df = _read_diploma_df(path)
    rows: list[dict[str, str]] = []
    for _, row in df.iterrows():
        rec = row_to_record(row, DIPLOMA_FORM_COLUMNS)
        fio = (rec.get("fio") or rec.get("Фамилия_имя_отчество") or "").strip()
        if not fio:
            continue
        rec["fio"] = fio
        rec["Фамилия_имя_отчество"] = fio
        rec["_fio"] = fio
        finalize_names(rec)
        payload = {k: str(v) for k, v in rec.items() if v and not str(k).startswith("_")}
        payload.update(split_fio_parts(fio))
        rows.append(payload)
    return rows


def create_table(name: str) -> dict:
    _ensure_dir()
    table_id = uuid.uuid4().hex[:10]
    safe = re.sub(r'[<>:"/\\|?*]', "_", (name or "Таблица").strip())[:80] or "Таблица"
    path = DIPLOMA_TABLES_DIR / f"{table_id}_{safe}.xlsx"
    pd.DataFrame(columns=EXCEL_HEADERS).to_excel(path, index=False, sheet_name="Дипломы")

    entry = {
        "id": table_id,
        "name": name.strip() or "Таблица",
        "path": str(path.resolve()),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    reg = _load_registry()
    reg.setdefault("tables", []).append(entry)
    _save_registry(reg)
    return {**entry, "row_count": 0}


def import_table(file_bytes: bytes, filename: str, name: str | None = None) -> dict:
    _ensure_dir()
    table_id = uuid.uuid4().hex[:10]
    path = DIPLOMA_TABLES_DIR / f"{table_id}_{filename}"
    path.write_bytes(file_bytes)

    df, _ = read_sheet(path, None)
    cols = [str(c).strip() for c in df.columns]
    if "ФИО" not in cols and cols:
        first = cols[0]
        if first.lower() in ("фио", "фамилия, имя, отчество", "фамилия имя отчество"):
            df = df.rename(columns={first: "ФИО"})

    for h in EXCEL_HEADERS:
        if h not in df.columns:
            df[h] = ""
    df = df[EXCEL_HEADERS].fillna("").astype(str)
    _write_diploma_df(path, df)

    display_name = (name or Path(filename).stem).strip()
    entry = {
        "id": table_id,
        "name": display_name,
        "path": str(path.resolve()),
        "created": datetime.now(timezone.utc).isoformat(),
    }
    reg = _load_registry()
    reg.setdefault("tables", []).append(entry)
    _save_registry(reg)
    return {**entry, "row_count": len(df)}


def form_body_to_excel_row(body: dict) -> dict[str, str]:
    row: dict[str, str] = {}
    fio = (body.get("fio") or "").strip()
    row["ФИО"] = fio
    pages = (body.get("pages") or "").strip()
    if pages:
        row["Кол-во страниц"] = pages if re.search(r"страниц", pages, re.I) else pages
    graph = (body.get("graph_pages") or "").strip()
    if graph:
        row["Кол-во страниц граф. ч."] = graph

    for excel_col, form_key in DIPLOMA_FORM_COLUMNS.items():
        if form_key in ("fio", "pages", "graph_pages"):
            continue
        val = (body.get(form_key) or "").strip()
        if val:
            row[excel_col] = val
    return row


def excel_row_to_form(row: dict) -> dict[str, str]:
    out: dict[str, str] = {"fio": str(row.get("ФИО", "") or "").strip()}
    pages = row.get("Кол-во страниц", "")
    if pages is not None and str(pages).strip():
        s = str(pages).strip()
        m = re.match(r"на\s+(\d+)", s, re.I)
        out["pages"] = m.group(1) if m else s
    graph = row.get("Кол-во страниц граф. ч.", "")
    if graph is not None and str(graph).strip():
        s = str(graph).strip()
        m = re.match(r"на\s+(\d+)", s, re.I)
        out["graph_pages"] = m.group(1) if m else s

    for excel_col, form_key in DIPLOMA_FORM_COLUMNS.items():
        if form_key in ("fio", "pages", "graph_pages"):
            continue
        val = row.get(excel_col, "")
        if val is not None and str(val).strip() and not (isinstance(val, float) and pd.isna(val)):
            out[form_key] = str(val).strip()
    return out


def _norm_fio_cell(val) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def upsert_row(table_id: str, body: dict) -> dict:
    path = _table_path(table_id)
    row_data = form_body_to_excel_row(body)
    fio = row_data.get("ФИО", "").strip()
    if not fio:
        raise ValueError("Укажите ФИО")

    df = _read_diploma_df(path)

    fio_norm = normalize_fio(fio)
    updated = False
    if len(df):
        for idx in df.index:
            cell = _norm_fio_cell(df.at[idx, "ФИО"])
            if cell and normalize_fio(cell) == fio_norm:
                for col, val in row_data.items():
                    if col in df.columns and val:
                        df.at[idx, col] = str(val)
                updated = True
                break

    if not updated:
        new_row = {h: str(row_data.get(h, "") or "") for h in EXCEL_HEADERS}
        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)

    _write_diploma_df(path, df)
    return {"updated": updated, "row_count": len(df), "fio": fio}


def find_row_by_fio(table_id: str, fio: str) -> dict | None:
    path = _table_path(table_id)
    if not path.exists() or not fio.strip():
        return None
    df = _read_diploma_df(path)
    if "ФИО" not in df.columns or not len(df):
        return None
    target = normalize_fio(fio.strip())
    for _, row in df.iterrows():
        cell = _norm_fio_cell(row.get("ФИО"))
        if cell and normalize_fio(cell) == target:
            return excel_row_to_form(
                {str(c): "" if pd.isna(row[c]) else row[c] for c in df.columns}
            )
    return None


def delete_table(table_id: str) -> None:
    reg = _load_registry()
    tables = reg.get("tables", [])
    kept = []
    for t in tables:
        if t["id"] == table_id:
            p = Path(t["path"])
            if p.exists():
                p.unlink(missing_ok=True)
        else:
            kept.append(t)
    reg["tables"] = kept
    _save_registry(reg)
