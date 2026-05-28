from __future__ import annotations

import json
import re
import uuid
from pathlib import Path

import pandas as pd

from form2act.config import DATA_DIR
from form2act.excel_io import read_sheet

TABLE_DATA_DIR = DATA_DIR.parent / "uploads" / "table_data"
TABLE_DATA_DIR.mkdir(parents=True, exist_ok=True)


def _norm_key(name: str) -> str:
    return re.sub(r"\s+", " ", str(name).strip()).casefold()


def rows_from_manual_text(text: str) -> list[dict[str, str]]:
    raw = (text or "").strip()
    if not raw:
        return []
    if raw.startswith("["):
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("Ожидается JSON-массив объектов")
        return [{str(k): str(v) for k, v in row.items()} for row in data if isinstance(row, dict)]

    lines = [ln for ln in raw.splitlines() if ln.strip()]
    if not lines:
        return []
    sep = "\t" if "\t" in lines[0] else ";"
    headers = [h.strip() for h in lines[0].split(sep)]
    start = 1 if len(lines) > 1 and not any(c.isdigit() for c in headers[0][:3]) else 0
    if start == 0 and len(lines) == 1:
        headers = ["col1", "col2", "col3"][: len(lines[0].split(sep))]
    rows: list[dict[str, str]] = []
    for line in lines[start:]:
        parts = [p.strip() for p in line.split(sep)]
        row = {}
        for i, val in enumerate(parts):
            key = headers[i] if i < len(headers) else f"col{i + 1}"
            if val:
                row[key] = val
        if row:
            rows.append(row)
    return rows


def save_xlsx_upload(file_bytes: bytes, filename: str) -> dict:
    uid = uuid.uuid4().hex[:12]
    path = TABLE_DATA_DIR / f"{uid}_{filename}"
    path.write_bytes(file_bytes)
    df, sheet = read_sheet(path, None)
    columns = [str(c) for c in df.columns]
    preview = []
    for _, row in df.head(200).iterrows():
        preview.append({str(c): "" if pd.isna(row[c]) else str(row[c]).strip() for c in df.columns})
    meta = {"id": uid, "path": str(path), "sheet": sheet, "columns": columns, "row_count": len(df)}
    meta_path = TABLE_DATA_DIR / f"{uid}.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {**meta, "preview": preview}


def list_uploaded_tables() -> list[dict]:
    items: list[dict] = []
    for meta_path in sorted(TABLE_DATA_DIR.glob("*.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        uid = meta.get("id") or meta_path.stem
        path = Path(meta.get("path", ""))
        name = path.name.split("_", 1)[-1] if path.name else uid
        items.append(
            {
                "id": uid,
                "name": name,
                "row_count": meta.get("row_count", 0),
                "columns": meta.get("columns") or [],
            }
        )
    return items


def load_xlsx_rows(data_id: str, sheet: str | None = None) -> list[dict[str, str]]:
    meta_path = TABLE_DATA_DIR / f"{data_id}.json"
    if not meta_path.exists():
        raise FileNotFoundError("Файл данных не найден, загрузите Excel снова")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    path = Path(meta["path"])
    df, _ = read_sheet(path, sheet or meta.get("sheet"))
    rows: list[dict[str, str]] = []
    for _, row in df.iterrows():
        item = {
            str(c): "" if pd.isna(row[c]) else str(row[c]).strip()
            for c in df.columns
            if not pd.isna(row[c]) and str(row[c]).strip()
        }
        if item:
            rows.append(item)
    return rows


def map_row_to_merge_fields(row: dict[str, str], field_names: set[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    by_norm = {_norm_key(k): k for k in row}
    for field in field_names:
        if field in row and row[field]:
            out[field] = row[field]
            continue
        nk = _norm_key(field)
        if nk in by_norm and row.get(by_norm[nk]):
            out[field] = row[by_norm[nk]]
    for key, val in row.items():
        if key not in out and val:
            out[key] = val
    return out
