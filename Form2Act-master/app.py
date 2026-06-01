from __future__ import annotations

import io
import re
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file, send_from_directory

from form2act.config import (
    DATA_DIR,
    DIPLOMA_FIELDS,
    DP_COLUMNS,
    FORM_COLUMNS,
    GIA_COLUMNS,
    MERGE_FIELDS,
    OUTPUT_DIR,
    TEMPLATES_COLUMNS,
)

EDITABLE_FIELDS = list(dict.fromkeys([*MERGE_FIELDS, *DIPLOMA_FIELDS]))
from form2act.diploma import build_diploma_merge, diploma_payload_from_form, preview_labels
from form2act.diploma_tables import (
    create_table as create_diploma_table,
    delete_table,
    find_row_by_fio,
    import_table as import_diploma_table,
    list_tables as list_diploma_tables,
    upsert_row as upsert_diploma_row,
    _table_path as diploma_table_path,
)
from form2act.docgen import (
    generate_batch,
    generate_combined_document,
    generate_combined_preview_bytes,
    generate_protocol,
)
from form2act.table_data import list_uploaded_tables, save_xlsx_upload
from form2act.template_profiles import create_profile_from_base, get_profile, list_profiles
from form2act.template_scan import scan_template_tables
from form2act.docpreview import (
    is_complete_docx_preview_html,
    merge_docx_to_html,
    merge_to_docx_bytes,
    merge_to_editable_html,
)
from form2act.docx_edit import (
    apply_edits_to_docx,
    apply_saved_html_edits,
    paragraph_texts_from_docx_bytes,
)
from form2act.docx_pdf import docx_bytes_to_pdf, libreoffice_available
from form2act.excel_io import read_sheet
from form2act.reload import default_file_paths, reload_all
from form2act.store import DataStore
from form2act.utils import format_cell, normalize_fio
from form2act.custom_fields import (
    add_for_template as add_custom_field_template,
    add_global as add_custom_field_global,
    field_catalog,
    list_global as list_custom_fields_global,
)
from form2act.commissions import (
    commission_from_payload,
    commission_payload,
    save_commission,
)
from form2act.word_templates import list_word_templates, merge_fields_in_template, resolve_template

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024

store = DataStore()
UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
TEMPLATE_UPLOAD_DIR = UPLOAD_DIR / "templates"
TEMPLATE_UPLOAD_DIR.mkdir(exist_ok=True)


@app.route("/")
def index():
    paths = default_file_paths()
    sheet_lists = {}
    for key in ("dp", "templates"):
        if paths[key]:
            try:
                sheet_lists[key] = store.sheets_in_file(paths[key])
            except Exception:
                sheet_lists[key] = []
    return render_template(
        "index.html",
        merge_fields=MERGE_FIELDS,
        diploma_fields=DIPLOMA_FIELDS,
        preview_labels=preview_labels(),
        defaults={k: str(v) if v else "" for k, v in paths.items()},
        sheets=sheet_lists,
    )


@app.post("/api/reload")
def api_reload():
    body = request.get_json(silent=True) or {}
    def _safe_data_path(raw: str | None) -> Path | None:
        value = (raw or "").strip()
        if not value:
            return None
        p = Path(value)
        if not p.is_absolute():
            p = (DATA_DIR / p).resolve()
        try:
            p.relative_to(DATA_DIR.resolve())
        except Exception:
            return None
        if not p.exists():
            return None
        if p.name.startswith("~$") or p.name.startswith(".~lock"):
            return None
        return p

    stats = reload_all(
        store,
        dp_path=_safe_data_path(body.get("dp_file")),
        form_path=_safe_data_path(body.get("form_file")),
        gia_path=_safe_data_path(body.get("gia_file")),
        templates_path=_safe_data_path(body.get("templates_file")),
        dp_sheet=body.get("dp_sheet"),
        templates_sheet=body.get("templates_sheet"),
        use_templates=body.get("use_templates", True),
    )
    return jsonify({"ok": True, "stats": stats})


def _candidate_columns_for_merge_field(field: str) -> list[str]:
    maps = [DP_COLUMNS, FORM_COLUMNS, GIA_COLUMNS, TEMPLATES_COLUMNS]
    cols: list[str] = []
    for mapping in maps:
        for src_col, dst in mapping.items():
            if dst == field and src_col not in cols:
                cols.append(src_col)
    if field not in cols:
        cols.append(field)
    return cols


def _fio_tokens(text: str) -> list[str]:
    cleaned = normalize_fio(text).replace("-", " ")
    return [p for p in cleaned.split(" ") if p]


def _fio_match_score(target_fio: str, cell_fio: str) -> int:
    t = _fio_tokens(target_fio)
    c = _fio_tokens(cell_fio)
    if not t or not c:
        return 0
    if " ".join(t) == " ".join(c):
        return 100
    score = 0
    cset = set(c)
    for token in t:
        if token in cset:
            score += 3
        elif any(x.startswith(token) or token.startswith(x) for x in c):
            score += 1
    return score


def _extract_values_from_row(df, row, fields: list[str]) -> dict[str, str]:
    values: dict[str, str] = {}
    for field in fields:
        fname = str(field)
        for col in _candidate_columns_for_merge_field(fname):
            if col in df.columns:
                v = format_cell(row.get(col))
                if v:
                    values[fname] = v
                    break
    return values


def _load_lookup_df(path: Path, sheet: str | None):
    df, sheet_name = read_sheet(path, sheet)
    fio_cols = [
        "ФИО",
        "ФИО студента",
        "Фамилия, имя, отчество",
        "Фамилия_имя_отчество",
        "Фамилия Имя Отчество",
    ]
    fio_col = next((c for c in fio_cols if c in df.columns), None)
    if not fio_col:
        try:
            raw = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str).fillna("")
            header_idx = None
            for i in range(min(len(raw), 25)):
                row_vals = [normalize_fio(x).replace("_", " ") for x in raw.iloc[i].tolist()]
                if any(
                    ("фио" in v) or ("фамилия" in v and "имя" in v and "отчество" in v)
                    for v in row_vals
                ):
                    header_idx = i
                    break
            if header_idx is not None:
                hdr = [str(x).strip() for x in raw.iloc[header_idx].tolist()]
                body = raw.iloc[header_idx + 1 :].copy()
                body.columns = hdr
                body = body.fillna("").astype(str)
                body = body.loc[:, [c for c in body.columns if str(c).strip()]]
                if len(body.columns):
                    df = body
        except Exception:
            pass
    return df, sheet_name


def _find_best_row_by_fio(df, fio: str):
    target = normalize_fio(fio)
    row = None
    best_score = 0
    for _, r in df.iterrows():
        row_best = 0
        for c in df.columns:
            score = _fio_match_score(target, format_cell(r.get(c)))
            if score > row_best:
                row_best = score
            if row_best >= 100:
                break
        if row_best > best_score:
            best_score = row_best
            row = r
        if best_score >= 100:
            break
    return row, best_score


@app.post("/api/excel-field-lookup")
def api_excel_field_lookup():
    body = request.get_json(silent=True) or {}
    raw_path = (body.get("path") or "").strip()
    fio = (body.get("fio") or "").strip()
    field = (body.get("field") or "").strip()
    sheet = (body.get("sheet") or "").strip() or None
    if not raw_path or not fio or not field:
        return jsonify({"error": "Нужны path, fio и field"}), 400

    p = Path(raw_path)
    if not p.is_absolute():
        p = (DATA_DIR / p).resolve()
    try:
        p.relative_to(DATA_DIR.resolve())
    except Exception:
        return jsonify({"error": "Недопустимый путь файла"}), 400
    if not p.exists():
        return jsonify({"error": "Файл не найден"}), 404

    try:
        df, sheet_name = _load_lookup_df(p, sheet)
    except Exception as e:
        # Если лист не найден/переименован — пробуем первый доступный лист.
        if sheet:
            try:
                df, sheet_name = _load_lookup_df(p, None)
            except Exception:
                return jsonify({"error": str(e)}), 400
        else:
            return jsonify({"error": str(e)}), 400

    fio_cols = [
        "ФИО",
        "ФИО студента",
        "Фамилия, имя, отчество",
        "Фамилия_имя_отчество",
        "Фамилия Имя Отчество",
    ]
    fio_col = next((c for c in fio_cols if c in df.columns), None)
    if not fio_col:
        # Частый случай: первая строка листа — дата/заголовок, а шапка таблицы ниже.
        try:
            raw = pd.read_excel(p, sheet_name=sheet_name, header=None, dtype=str).fillna("")
            header_idx = None
            for i in range(min(len(raw), 25)):
                row_vals = [normalize_fio(x).replace("_", " ") for x in raw.iloc[i].tolist()]
                if any(
                    ("фио" in v) or ("фамилия" in v and "имя" in v and "отчество" in v)
                    for v in row_vals
                ):
                    header_idx = i
                    break
            if header_idx is not None:
                hdr = [str(x).strip() for x in raw.iloc[header_idx].tolist()]
                body = raw.iloc[header_idx + 1 :].copy()
                body.columns = hdr
                body = body.fillna("").astype(str)
                body = body.loc[:, [c for c in body.columns if str(c).strip()]]
                if len(body.columns):
                    df = body
        except Exception:
            pass
        fio_col = next((c for c in fio_cols if c in df.columns), None)
    if not fio_col:
        # Мягкий поиск: любая колонка, похожая на ФИО.
        for c in df.columns:
            key = normalize_fio(str(c)).replace("_", " ")
            if "фио" in key or (
                "фамилия" in key and "имя" in key and "отчество" in key
            ):
                fio_col = c
                break
    target = normalize_fio(fio)
    if not fio_col and len(df):
        # Фолбэк по содержимому: ищем колонку, где встречается ФИО студента.
        for c in df.columns:
            matched = False
            for _, r in df.iterrows():
                if _fio_match_score(target, format_cell(r.get(c))) >= 3:
                    matched = True
                    break
            if matched:
                fio_col = c
                break
    if not fio_col:
        return jsonify(
            {
                "ok": True,
                "value": "",
                "sheet": sheet_name,
                "found": False,
                "warning": "В листе не найдена колонка ФИО",
            }
        )
    row, best_score = _find_best_row_by_fio(df, target)
    if row is None or best_score < 3:
        return jsonify({"ok": True, "value": "", "sheet": sheet_name, "found": False})

    value = ""
    source_col = ""
    for col in _candidate_columns_for_merge_field(field):
        if col in df.columns:
            value = format_cell(row.get(col))
            source_col = col
            if value:
                break

    return jsonify(
        {
            "ok": True,
            "value": value,
            "sheet": sheet_name,
            "found": True,
            "source_col": source_col,
        }
    )


@app.post("/api/excel-row-lookup")
def api_excel_row_lookup():
    body = request.get_json(silent=True) or {}
    raw_path = (body.get("path") or "").strip()
    fio = (body.get("fio") or "").strip()
    sheet = (body.get("sheet") or "").strip() or None
    scan_all = bool(body.get("scan_all"))
    fields = body.get("fields") or MERGE_FIELDS
    if not fio:
        return jsonify({"error": "Нужен fio"}), 400

    values: dict[str, str] = {}
    best_meta: dict[str, str] = {"file": "", "sheet": ""}
    best_score = 0

    candidates: list[tuple[Path, str | None]] = []
    if raw_path and not scan_all:
        p = Path(raw_path)
        if not p.is_absolute():
            p = (DATA_DIR / p).resolve()
        try:
            p.relative_to(DATA_DIR.resolve())
        except Exception:
            return jsonify({"error": "Недопустимый путь файла"}), 400
        if not p.exists():
            return jsonify({"error": "Файл не найден"}), 404
        candidates.append((p, sheet))
    else:
        files = sorted(
            [p for p in DATA_DIR.glob("*.xls*") if p.suffix.lower() in (".xlsx", ".xls")],
            key=lambda x: x.name.lower(),
        )
        for p in files:
            try:
                sheets = store.sheets_in_file(p)
            except Exception:
                sheets = [None]
            for sh in (sheets or [None]):
                candidates.append((p, sh))

    for p, sh in candidates:
        try:
            df, sheet_name = _load_lookup_df(p, sh)
        except Exception:
            continue
        row, score = _find_best_row_by_fio(df, fio)
        if row is None or score < 3:
            continue
        row_values = _extract_values_from_row(df, row, [str(f) for f in fields])
        for k, v in row_values.items():
            if v and not values.get(k):
                values[k] = v
        if score > best_score:
            best_score = score
            best_meta = {"file": p.name, "sheet": sheet_name}
        if all(values.get(str(f)) for f in fields):
            break

    if not values.get("группа_год"):
        grp = values.get("Группа", "")
        if grp:
            m = re.search(r"(\d)", grp)
            if m:
                from datetime import date

                values["группа_год"] = str(date.today().year - int(m.group(1)))
    if not values:
        return jsonify({"ok": True, "found": False, "values": {}})
    return jsonify({"ok": True, "found": True, "values": values, **best_meta})


@app.get("/api/students")
def api_students():
    return jsonify({"students": store.list_students()})


@app.get("/api/student/<student_id>")
def api_student(student_id: str):
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    return jsonify(
        {
            "id": student_id,
            "record": store.records[student_id],
            "merge": store.get_merge_payload(student_id),
        }
    )


@app.put("/api/student/<student_id>")
def api_update_student(student_id: str):
    body = request.get_json(silent=True) or {}
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    for field, value in body.items():
        if field.startswith("_"):
            continue
        store.set_override(student_id, field, str(value))
    return jsonify({"merge": store.get_merge_payload(student_id)})


@app.post("/api/upload")
def api_upload():
    file = request.files.get("file")
    if not file:
        return jsonify({"error": "Файл не передан"}), 400

    safe_name = Path(file.filename).name
    dest = DATA_DIR / safe_name
    file.save(dest)
    return jsonify(
        {
            "ok": True,
            "path": str(dest),
        }
    )


@app.get("/api/commission")
def api_commission_get():
    return jsonify(commission_payload())


@app.put("/api/commission")
def api_commission_put():
    body = request.get_json(silent=True) or {}
    if not isinstance(body, dict):
        return jsonify({"error": "Ожидается JSON-объект"}), 400
    commission = commission_from_payload(body)
    save_commission(commission)
    return jsonify(commission_payload())


@app.get("/api/excel-files")
def api_excel_files():
    files = sorted(
        [
            p
            for p in DATA_DIR.glob("*.xls*")
            if p.suffix.lower() in (".xlsx", ".xls")
            and not p.name.startswith("~$")
            and not p.name.startswith(".~lock")
        ],
        key=lambda p: p.name.lower(),
    )
    result = []
    for p in files:
        try:
            sheets = store.sheets_in_file(p)
        except Exception:
            sheets = []
        result.append({"name": p.name, "path": str(p), "sheets": sheets})
    return jsonify({"files": result})


@app.get("/api/excel-sheet-preview")
def api_excel_sheet_preview():
    raw_path = (request.args.get("path") or "").strip()
    sheet = (request.args.get("sheet") or "").strip() or None
    if not raw_path:
        return jsonify({"error": "Не указан path"}), 400

    p = Path(raw_path)
    if not p.is_absolute():
        p = (DATA_DIR / p).resolve()
    try:
        p.relative_to(DATA_DIR.resolve())
    except Exception:
        return jsonify({"error": "Недопустимый путь файла"}), 400
    if not p.exists():
        return jsonify({"error": "Файл не найден"}), 404

    try:
        df, sheet_name = read_sheet(p, sheet)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    max_cols = 30
    max_rows = 200
    col_names = [str(c) for c in df.columns[:max_cols]]
    rows: list[list[str]] = []
    for _, row in df.head(max_rows).iterrows():
        rows.append([format_cell(row.get(c, "")) for c in df.columns[:max_cols]])

    return jsonify(
        {
            "ok": True,
            "sheet": sheet_name,
            "columns": col_names,
            "rows": rows,
            "truncated": len(df) > max_rows or len(df.columns) > max_cols,
        }
    )


@app.get("/api/preview/<student_id>")
def api_preview(student_id: str):
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    return jsonify(
        {
            "id": student_id,
            "fio": store.records[student_id].get("_fio", ""),
            "preview": store.get_preview_payload(student_id),
            "labels": preview_labels(),
        }
    )


def _layout_html_for_docx(tpl: Path, student_id: str | None) -> str | None:
    if student_id and student_id in store.records:
        html = store.get_preview_html(student_id, tpl)
        if html:
            return html
    return store.get_template_layout_html(tpl)


def _finalize_docx_preview_bytes(
    raw_bytes: bytes,
    tpl: Path,
    *,
    student_id: str | None = None,
    paragraph_baseline: list | None = None,
    paragraph_edited: list | None = None,
    apply_layout: bool = True,
) -> bytes:
    if paragraph_baseline and paragraph_edited:
        return apply_edits_to_docx(raw_bytes, paragraph_baseline, paragraph_edited)
    if not apply_layout:
        return raw_bytes
    html = _layout_html_for_docx(tpl, student_id)
    entry = store.get_template_layout_entry(tpl)
    stored_baseline = (entry or {}).get("baseline") if entry and not student_id else None
    return apply_saved_html_edits(
        raw_bytes, html, stored_baseline=stored_baseline or None
    )


def _get_template_docx_bytes(
    template_path: str | None,
    student_id: str | None = None,
    merge_overrides: dict | None = None,
    *,
    raw: bool = False,
) -> tuple[bytes, Path, dict[str, str]]:
    tpl = resolve_template(template_path)
    if raw:
        return tpl.read_bytes(), tpl, {}

    from form2act.merge_expand import expand_merge_placeholders

    if student_id and student_id in store.records:
        merge, tpl = _merge_for_preview(student_id, merge_overrides, template_path)
    else:
        merge = {}
        for key, value in (merge_overrides or {}).items():
            if not str(key).startswith("_"):
                merge[str(key)] = str(value)
        merge = expand_merge_placeholders(merge)
    return merge_to_docx_bytes(merge, template=tpl), tpl, merge


def _build_merged_docx_bytes(
    template_path: str | None,
    student_id: str | None = None,
    merge_overrides: dict | None = None,
) -> tuple[bytes, Path, dict[str, str]]:
    return _get_template_docx_bytes(
        template_path, student_id, merge_overrides, raw=False
    )


def _merge_for_preview(
    student_id: str,
    overrides: dict | None = None,
    template_path: str | None = None,
) -> tuple[dict[str, str], Path]:
    from form2act.merge_expand import expand_merge_placeholders

    merge = store.get_merge_payload(student_id)
    if overrides:
        for key, value in overrides.items():
            if not key.startswith("_"):
                merge[key] = str(value)
    merge = expand_merge_placeholders(merge)
    tpl = resolve_template(template_path)
    return merge, tpl


@app.get("/api/word-templates")
def api_word_templates():
    return jsonify({"templates": list_word_templates()})


@app.get("/api/template-fields")
def api_template_fields():
    from form2act.docx_placeholders import missing_template_fields
    from form2act.merge_expand import expand_merge_placeholders

    try:
        tpl = resolve_template(request.args.get("template"))
        catalog = field_catalog(tpl)
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    student_id = request.args.get("student")
    missing: list[str] = []
    if student_id and student_id in store.records:
        merge = expand_merge_placeholders(store.get_merge_payload(student_id))
        _all, missing, _brace_missing = missing_template_fields(tpl, merge)

    labels = preview_labels()
    fill_summary = None
    if not student_id:
        from form2act.docx_placeholders import fill_status_for_all_students

        fill_summary = fill_status_for_all_students(
            tpl, store.records, store.get_merge_payload
        )

    from form2act.template_scan import scan_template_full

    scan = scan_template_full(tpl)
    return jsonify(
        {
            "template": str(tpl),
            "fields": catalog["for_chips"],
            "template_all": catalog.get("template_all") or catalog["word"],
            "groups": {
                "word": catalog.get("template_all") or catalog["word"],
                "mailmerge": catalog.get("mailmerge") or [],
                "brace": catalog.get("brace") or [],
                "template_all": catalog.get("template_all") or catalog["word"],
                "diploma": catalog["diploma"],
                "custom": catalog["custom"],
                "protocol": catalog["protocol"],
            },
            "missing": missing,
            "missing_labels": {f: labels.get(f, f) for f in missing},
            "labels": labels,
            "fill_summary": fill_summary,
            "mode": scan.get("mode"),
            "table_source": scan.get("table_source"),
            "tables": scan.get("tables") or [],
            "header_fields": scan.get("header_fields") or [],
            "table_fields": scan.get("table_fields") or [],
        }
    )


@app.get("/api/template-fill-status")
def api_template_fill_status():
    from form2act.docx_placeholders import fill_status_for_all_students
    from form2act.template_scan import scan_template_full

    try:
        tpl = resolve_template(request.args.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    scan = scan_template_full(tpl)
    fields_subset = None
    if scan.get("mode") == "combined" and scan.get("table_fields"):
        fields_subset = set(scan["table_fields"])

    status = fill_status_for_all_students(
        tpl,
        store.records,
        store.get_merge_payload,
        fields_subset=fields_subset,
    )
    labels = preview_labels()
    return jsonify(
        {
            "template": str(tpl),
            "labels": labels,
            **status,
        }
    )


@app.get("/api/custom-fields")
def api_custom_fields_list():
    return jsonify({"global": list_custom_fields_global()})


@app.post("/api/custom-fields")
def api_custom_fields_add():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    try:
        if body.get("template"):
            tpl = resolve_template(body.get("template"))
            fields = add_custom_field_template(tpl, name)
            scope = "template"
        else:
            fields = add_custom_field_global(name)
            scope = "global"
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"ok": True, "scope": scope, "fields": fields, "name": name})


@app.post("/api/upload-template")
def api_upload_template():
    file = request.files.get("file")
    if not file or not file.filename.lower().endswith(".docx"):
        return jsonify({"error": "Нужен файл .docx"}), 400
    dest = TEMPLATE_UPLOAD_DIR / file.filename
    file.save(dest)
    return jsonify({"ok": True, "template": {"name": dest.name, "path": str(dest.resolve())}})


@app.post("/api/preview-doc-editable")
def api_preview_doc_editable():
    body = request.get_json(silent=True) or {}
    student_id = body.get("id")
    sid = student_id if student_id and student_id in store.records else None
    raw = bool(body.get("raw")) or (sid is None and not body.get("merge"))
    try:
        raw_bytes, tpl, _merge = _get_template_docx_bytes(
            body.get("template"),
            student_id=sid,
            merge_overrides=body.get("merge"),
            raw=raw,
        )
        baseline = paragraph_texts_from_docx_bytes(raw_bytes)
        docx_bytes = _finalize_docx_preview_bytes(
            raw_bytes,
            tpl,
            student_id=sid,
            paragraph_baseline=body.get("paragraph_baseline"),
            paragraph_edited=body.get("paragraph_edited"),
            apply_layout=raw,
        )
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 404 if isinstance(e, FileNotFoundError) else 400
    except Exception as e:
        return jsonify({"error": f"Ошибка предпросмотра: {e}"}), 500
    fio = store.records[sid].get("_fio", "") if sid else ""
    saved_html = _layout_html_for_docx(tpl, sid)
    return jsonify(
        {
            "id": sid,
            "fio": fio,
            "template": str(tpl),
            "has_saved_layout": bool(saved_html),
            "paragraph_baseline": baseline,
            "pdf_available": libreoffice_available(),
            "warnings": [],
        }
    )


@app.put("/api/template-layout")
def api_save_template_layout():
    body = request.get_json(silent=True) or {}
    try:
        tpl = resolve_template(body.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    html = body.get("html")
    if html is not None:
        baseline = body.get("paragraph_baseline")
        if not isinstance(baseline, list):
            baseline = []
        store.set_template_layout_html(
            tpl, str(html), baseline=[str(x) for x in baseline]
        )
    return jsonify({"ok": True, "template": str(tpl)})


@app.delete("/api/template-layout")
def api_clear_template_layout():
    body = request.get_json(silent=True) or {}
    try:
        tpl = resolve_template(body.get("template") or request.args.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    store.clear_template_layout_html(tpl)
    return jsonify({"ok": True, "template": str(tpl)})


@app.get("/api/template-download")
def api_template_download():
    try:
        tpl = resolve_template(request.args.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    return send_file(
        tpl,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=tpl.name,
    )


@app.post("/api/template-layout/export")
def api_template_layout_export():
    body = request.get_json(silent=True) or {}
    try:
        tpl = resolve_template(body.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    student_id = body.get("id")
    sid = student_id if student_id and student_id in store.records else None
    raw = bool(body.get("raw")) if "raw" in body else (sid is None)
    try:
        if raw:
            raw_bytes = tpl.read_bytes()
            docx_bytes = _finalize_docx_preview_bytes(
                raw_bytes,
                tpl,
                student_id=sid,
                paragraph_baseline=body.get("paragraph_baseline"),
                paragraph_edited=body.get("paragraph_edited"),
            )
        else:
            merge_extra = dict(body.get("merge") or {})
            docx_bytes, tpl, _merge = _get_template_docx_bytes(
                body.get("template"),
                student_id=sid,
                merge_overrides=merge_extra,
                raw=False,
            )
    except Exception as e:
        return jsonify({"error": f"Ошибка экспорта: {e}"}), 500
    out_name = tpl.name
    return send_file(
        io.BytesIO(docx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        as_attachment=True,
        download_name=out_name,
    )


@app.put("/api/student/<student_id>/preview-layout")
def api_save_preview_layout(student_id: str):
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    body = request.get_json(silent=True) or {}
    try:
        tpl = resolve_template(body.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    for field, value in (body.get("merge") or {}).items():
        if field.startswith("_"):
            continue
        store.set_override(student_id, field, str(value))

    html = body.get("html")
    if html is not None:
        store.set_preview_html(student_id, tpl, str(html))

    merge = store.get_merge_payload(student_id)
    from form2act.merge_expand import expand_merge_placeholders

    merge = expand_merge_placeholders(merge)
    return jsonify({"ok": True, "merge": merge, "template": str(tpl)})


@app.post("/api/preview-doc-file")
def api_preview_doc_file():
    body = request.get_json(silent=True) or {}
    student_id = body.get("id")
    sid = student_id if student_id and student_id in store.records else None
    raw = bool(body.get("raw")) or (sid is None and not body.get("merge"))
    try:
        raw_bytes, tpl, _merge = _get_template_docx_bytes(
            body.get("template"),
            student_id=sid,
            merge_overrides=body.get("merge"),
            raw=raw,
        )
        docx_bytes = _finalize_docx_preview_bytes(
            raw_bytes,
            tpl,
            student_id=sid,
            paragraph_baseline=body.get("paragraph_baseline"),
            paragraph_edited=body.get("paragraph_edited"),
            apply_layout=raw,
        )
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": f"Ошибка сборки документа: {e}"}), 500
    return send_file(
        io.BytesIO(docx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        download_name="preview.docx",
    )


@app.post("/api/preview-pdf-file")
def api_preview_pdf_file():
    body = request.get_json(silent=True) or {}
    student_id = body.get("id")
    sid = student_id if student_id and student_id in store.records else None
    raw = bool(body.get("raw")) or (sid is None and not body.get("merge"))
    if not libreoffice_available():
        return jsonify(
            {"error": "Для точного предпросмотра установите LibreOffice (libreoffice)"}
        ), 503
    try:
        docx_bytes, _tpl, _merge = _get_template_docx_bytes(
            body.get("template"),
            student_id=sid,
            merge_overrides=body.get("merge"),
            raw=raw,
        )
        pdf_bytes = docx_bytes_to_pdf(docx_bytes)
        if not pdf_bytes:
            return jsonify({"error": "Не удалось создать PDF"}), 500
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": f"Ошибка PDF: {e}"}), 500
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        download_name="preview.pdf",
    )


@app.get("/api/preview-doc/<student_id>")
def api_preview_doc_get(student_id: str):
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    try:
        merge, tpl = _merge_for_preview(student_id, template_path=request.args.get("template"))
        html, warnings = merge_docx_to_html(merge, template=tpl)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": f"Ошибка предпросмотра: {e}"}), 500
    return jsonify(
        {
            "id": student_id,
            "fio": store.records[student_id].get("_fio", ""),
            "html": html,
            "warnings": warnings,
            "template": str(tpl),
        }
    )


@app.post("/api/preview-doc")
def api_preview_doc_post():
    body = request.get_json(silent=True) or {}
    student_id = body.get("id")
    if not student_id or student_id not in store.records:
        return jsonify({"error": "Студент не найден"}), 404
    try:
        merge, tpl = _merge_for_preview(
            student_id,
            body.get("merge"),
            body.get("template"),
        )
        html, warnings = merge_docx_to_html(merge, template=tpl)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    except Exception as e:
        return jsonify({"error": f"Ошибка предпросмотра: {e}"}), 500
    return jsonify(
        {
            "id": student_id,
            "fio": store.records[student_id].get("_fio", ""),
            "html": html,
            "warnings": warnings,
            "template": str(tpl),
        }
    )


@app.get("/api/diploma/<student_id>")
def api_get_diploma(student_id: str):
    if student_id not in store.records:
        return jsonify({"error": "Не найден"}), 404
    return jsonify({"id": student_id, "form": store.get_diploma_form(student_id)})


@app.get("/api/diploma-tables")
def api_diploma_tables_list():
    return jsonify({"tables": list_diploma_tables()})


@app.post("/api/diploma-tables")
def api_diploma_tables_create():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "Таблица дипломов").strip()
    try:
        table = create_diploma_table(name)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "table": table})


@app.delete("/api/diploma-tables/<table_id>")
def api_diploma_tables_delete(table_id: str):
    try:
        delete_table(table_id)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    return jsonify({"ok": True})


@app.post("/api/diploma-tables/import")
def api_diploma_tables_import():
    file = request.files.get("file")
    if not file or not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "Нужен файл Excel (.xlsx)"}), 400
    name = (request.form.get("name") or "").strip() or None
    try:
        table = import_diploma_table(file.read(), file.filename, name=name)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "table": table})


@app.get("/api/diploma-tables/<table_id>/download")
def api_diploma_tables_download(table_id: str):
    try:
        path = diploma_table_path(table_id)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    if not path.exists():
        return jsonify({"error": "Файл таблицы не найден"}), 404
    return send_file(path, as_attachment=True, download_name=path.name)


@app.get("/api/diploma-tables/<table_id>/row")
def api_diploma_tables_row(table_id: str):
    fio = (request.args.get("fio") or "").strip()
    if not fio:
        return jsonify({"error": "Укажите fio"}), 400
    try:
        row = find_row_by_fio(table_id, fio)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 404
    if not row:
        return jsonify({"error": "Строка с таким ФИО не найдена в таблице"}), 404
    return jsonify({"form": row})


@app.post("/api/diploma/preview-merge")
def api_diploma_preview_merge():
    body = request.get_json(silent=True) or {}
    form = body.get("form") or body
    if not isinstance(form, dict):
        return jsonify({"error": "Некорректные данные формы"}), 400
    try:
        tpl = resolve_template(body.get("template")) if body.get("template") else None
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    student_id = (body.get("student_id") or "").strip() or None
    try:
        sid, merge = build_diploma_merge(form, store, student_id=student_id)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    missing: list[str] = []
    missing_labels: dict[str, str] = {}
    fields_meta: dict | None = None
    if tpl:
        from form2act.custom_fields import field_catalog
        from form2act.docx_placeholders import missing_template_fields

        catalog = field_catalog(tpl)
        _all, missing, _ = missing_template_fields(tpl, merge)
        labels = preview_labels()
        missing_labels = {f: labels.get(f, f) for f in missing}
        fields_meta = {
            "groups": {
                "word": catalog.get("template_all") or catalog["word"],
                "mailmerge": catalog.get("mailmerge") or [],
                "brace": catalog.get("brace") or [],
                "template_all": catalog.get("template_all") or catalog["word"],
                "diploma": catalog["diploma"],
                "custom": catalog["custom"],
                "protocol": catalog["protocol"],
            },
            "fields": catalog["for_chips"],
            "labels": labels,
            "missing": missing,
            "missing_labels": missing_labels,
            "template_all": catalog.get("template_all") or catalog["word"],
        }

    return jsonify(
        {
            "ok": True,
            "merge": merge,
            "student_id": sid,
            "template": str(tpl) if tpl else None,
            "missing": missing,
            "missing_labels": missing_labels,
            "fields_meta": fields_meta,
        }
    )


@app.post("/api/diploma")
def api_save_diploma():
    body = request.get_json(silent=True) or {}
    try:
        student_id, data = diploma_payload_from_form(body)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    store.apply_row(student_id, data, "форма:дипломы")
    for key, value in data.items():
        if key != "fio":
            store.set_override(student_id, key, value)

    excel_result = None
    table_id = (body.get("table_id") or "").strip()
    if table_id:
        try:
            excel_result = upsert_diploma_row(table_id, body)
        except (FileNotFoundError, ValueError) as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": f"Excel: {e}"}), 500

    return jsonify(
        {
            "ok": True,
            "id": student_id,
            "preview": store.get_preview_payload(student_id),
            "excel": excel_result,
        }
    )


@app.get("/api/template-scan")
def api_template_scan():
    from form2act.template_scan import scan_template_full

    try:
        tpl = resolve_template(request.args.get("template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    try:
        info = scan_template_full(tpl)
    except Exception as e:
        return jsonify({"error": f"Не удалось прочитать шаблон: {e}"}), 500
    return jsonify({"template": str(tpl), **info})


@app.get("/api/template-profiles")
def api_template_profiles_list():
    return jsonify({"profiles": list_profiles()})


@app.post("/api/template-profiles")
def api_template_profiles_create():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Укажите название шаблона"}), 400
    try:
        base = resolve_template(body.get("base_template"))
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    tables = body.get("tables") or []
    if not tables:
        return jsonify({"error": "Добавьте хотя бы одну таблицу (якорь строки)"}), 400

    for t in tables:
        if not t.get("anchor"):
            return jsonify({"error": "У каждой таблицы нужен якорь (поле в строке)"}), 400

    try:
        profile = create_profile_from_base(
            name,
            base,
            tables=tables,
            header_fields=body.get("header_fields") or [],
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, "profile": profile})


def _resolve_combined_request(body: dict) -> tuple[Path, list[str], list[dict], dict]:
    ids = body.get("ids") or list(store.records.keys())
    ids = [sid for sid in ids if sid in store.records]
    profile_id = body.get("profile_id")
    tables = body.get("tables")
    header_merge = dict(body.get("header") or {})

    if profile_id:
        profile = get_profile(profile_id)
        if not profile:
            raise ValueError("Профиль шаблона не найден")
        tpl = resolve_template(profile["template_path"])
        tables = tables or profile.get("tables") or []
        if not header_merge and profile.get("header_fields") and ids:
            first = store.get_merge_payload(ids[0])
            header_merge = {
                f: first.get(f, "")
                for f in profile["header_fields"]
                if first.get(f)
            }
    else:
        tpl = resolve_template(body.get("template"))
        if not tables:
            raise ValueError("Укажите profile_id или список tables")

    if not tables:
        raise ValueError("Нет настроек таблиц")

    has_alt = any(
        t.get("data_source") in ("manual", "xlsx", "diploma_table") or t.get("sources")
        for t in tables
    )
    if not ids and not has_alt:
        raise ValueError("Выберите студентов или укажите данные Excel/вручную")

    return tpl, ids, tables, header_merge


@app.post("/api/preview-combined")
def api_preview_combined():
    body = request.get_json(silent=True) or {}
    try:
        tpl, ids, tables, header_merge = _resolve_combined_request(body)
        docx_bytes = generate_combined_preview_bytes(
            tpl, ids, store, tables=tables, header_merge=header_merge
        )
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return send_file(
        io.BytesIO(docx_bytes),
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        download_name="preview_combined.docx",
    )


@app.get("/api/table-data")
def api_table_data_list():
    return jsonify({"tables": list_uploaded_tables()})


@app.post("/api/table-data/upload")
def api_table_data_upload():
    file = request.files.get("file")
    if not file or not file.filename.lower().endswith((".xlsx", ".xls")):
        return jsonify({"error": "Нужен файл Excel (.xlsx)"}), 400
    try:
        meta = save_xlsx_upload(file.read(), file.filename)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"ok": True, **meta})


@app.post("/api/generate-combined")
def api_generate_combined():
    body = request.get_json(silent=True) or {}
    try:
        tpl, ids, tables, header_merge = _resolve_combined_request(body)
        path = generate_combined_document(
            tpl,
            ids,
            store,
            tables=tables,
            header_merge=header_merge,
        )
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    return jsonify(
        {
            "ok": True,
            "files": [path.name],
            "download": f"/download/{path.name}",
            "students": len(ids),
        }
    )


@app.post("/api/generate")
def api_generate():
    body = request.get_json(silent=True) or {}
    ids = [
        sid
        for sid in (body.get("ids") or list(store.records.keys()))
        if sid in store.records
    ]
    try:
        template = resolve_template(body.get("template")) if body.get("template") else None
    except (FileNotFoundError, ValueError) as e:
        return jsonify({"error": str(e)}), 400

    batch = [{"id": sid, "merge": store.get_merge_payload(sid)} for sid in ids]
    table_sources_early = body.get("table_sources")
    has_table_sources = isinstance(table_sources_early, list) and len(table_sources_early) > 0
    if not ids and not has_table_sources:
        return jsonify({"error": "Нет студентов"}), 400

    from form2act.docx_placeholders import missing_template_fields
    from form2act.merge_expand import expand_merge_placeholders
    from form2act.template_scan import default_tables_config, scan_template_full

    warnings: list[dict] = []
    template_scan: dict | None = None
    if template:
        template_scan = scan_template_full(template)
        header_only: set[str] | None = None
        if template_scan.get("mode") == "combined":
            header_only = set(template_scan.get("header_fields") or [])

        for item in batch:
            merge = expand_merge_placeholders(item["merge"])
            _all, missing, _ = missing_template_fields(template, merge)
            if header_only is not None:
                missing = [m for m in missing if m in header_only]
            if missing:
                sid = item["id"]
                fio = store.records.get(sid, {}).get("_fio", sid)
                warnings.append(
                    {
                        "student": sid,
                        "fio": fio,
                        "missing": missing,
                    }
                )

        if template_scan.get("mode") == "combined":
            tables = body.get("tables") or default_tables_config(template_scan)
            table_sources = body.get("table_sources")
            if tables and isinstance(table_sources, list) and table_sources:
                base = dict(tables[0])
                base["sources"] = table_sources
                base.pop("data_source", None)
                base.pop("diploma_table_id", None)
                base.pop("xlsx_id", None)
                tables = [base]
            elif tables and ids:
                base = dict(tables[0])
                base["data_source"] = "students"
                tables = [base]
            elif tables and isinstance(table_sources, list) and not table_sources:
                return jsonify({"error": "Отметьте хотя бы один источник строк таблицы"}), 400
            elif not tables:
                return jsonify(
                    {
                        "error": "В шаблоне не найдена строка таблицы с полями. "
                        "Используйте файл «…_merge.docx» или добавьте {поля} в строку таблицы в конструкторе.",
                    }
                ), 400
            header_merge = dict(body.get("header") or {})
            if ids:
                first = expand_merge_placeholders(store.get_merge_payload(ids[0]))
                for field in template_scan.get("header_fields") or []:
                    if field not in header_merge and first.get(field):
                        header_merge[field] = first[field]
            try:
                path = generate_combined_document(
                    template,
                    ids,
                    store,
                    tables=tables,
                    header_merge=header_merge,
                )
            except (FileNotFoundError, ValueError) as e:
                return jsonify({"error": str(e)}), 400
            except Exception as e:
                return jsonify({"error": str(e)}), 500
            return jsonify(
                {
                    "files": [path.name],
                    "download": f"/download/{path.name}",
                    "warnings": warnings,
                    "mode": "combined",
                    "students": len(ids),
                }
            )

    if len(batch) == 1:
        path = generate_protocol(batch[0]["merge"], template=template)
        return jsonify(
            {
                "files": [path.name],
                "download": f"/download/{path.name}",
                "warnings": warnings,
                "mode": "single",
            }
        )

    paths, zip_data = generate_batch(batch, template=template)
    zip_path = OUTPUT_DIR / "протоколы.zip"
    zip_path.write_bytes(zip_data.getvalue())
    return jsonify(
        {
            "files": [p.name for p in paths],
            "download": "/download/протоколы.zip",
            "warnings": warnings,
            "mode": "single",
        }
    )


@app.get("/download/<path:filename>")
def download(filename: str):
    return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
