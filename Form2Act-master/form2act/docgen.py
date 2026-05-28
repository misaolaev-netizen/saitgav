import io
import shutil
import tempfile
import zipfile
from pathlib import Path

from mailmerge import MailMerge

from form2act.config import MERGE_FIELDS, OUTPUT_DIR, TEMPLATE_PROTOCOL
from form2act.docx_tables import append_tables_from_externals, list_external_tables_needed
from form2act.template_scan import resolve_table_anchor
from form2act.docx_placeholders import replace_brace_placeholders_in_docx_bytes
from form2act.docx_table_brace import expand_brace_table_row
from form2act.merge_expand import expand_merge_placeholders
from form2act.table_data import (
    load_xlsx_rows,
    map_row_to_merge_fields,
    rows_from_manual_text,
)


def _safe_name(fio: str) -> str:
    for ch in '\\/:*?"<>|':
        fio = fio.replace(ch, "_")
    return fio.strip() or "без_имени"


def _rows_for_table(
    tcfg: dict,
    student_ids: list[str],
    store,
    all_fields: set[str],
) -> list[dict[str, str]]:
    from form2act.store import DataStore

    sub_sources = tcfg.get("sources")
    if sub_sources:
        merged: list[dict[str, str]] = []
        for sub in sub_sources:
            piece = dict(tcfg)
            piece.update(sub)
            piece.pop("sources", None)
            merged.extend(_rows_for_table(piece, student_ids, store, all_fields))
        return merged

    source = tcfg.get("data_source") or "students"
    rows_data: list[dict[str, str]] = []

    if source == "manual":
        for raw in tcfg.get("manual_rows") or []:
            rows_data.append(map_row_to_merge_fields(raw, all_fields))
        text = tcfg.get("manual_text")
        if text:
            for raw in rows_from_manual_text(text):
                rows_data.append(map_row_to_merge_fields(raw, all_fields))
    elif source == "xlsx":
        data_id = tcfg.get("xlsx_id")
        if not data_id:
            return []
        filter_fios: set[str] | None = None
        if student_ids:
            filter_fios = {
                (store.records[sid].get("_fio") or sid).casefold()
                for sid in student_ids
                if sid in store.records
            }
        for raw in load_xlsx_rows(data_id, tcfg.get("xlsx_sheet")):
            if filter_fios:
                fio = (
                    raw.get("Фамилия_имя_отчество")
                    or raw.get("ФИО")
                    or raw.get("fio")
                    or ""
                ).casefold()
                if fio and fio not in filter_fios:
                    continue
            rows_data.append(
                expand_merge_placeholders(map_row_to_merge_fields(raw, all_fields))
            )
    elif source == "diploma_table":
        from form2act.diploma_tables import excel_rows_for_merge

        table_id = tcfg.get("diploma_table_id")
        if not table_id:
            return []
        filter_fios: set[str] | None = None
        if student_ids:
            filter_fios = {
                (store.records[sid].get("_fio") or sid).casefold()
                for sid in student_ids
                if sid in store.records
            }
        for raw in excel_rows_for_merge(table_id):
            if filter_fios:
                fio = (raw.get("Фамилия_имя_отчество") or raw.get("fio") or "").casefold()
                if fio not in filter_fios:
                    continue
            rows_data.append(
                expand_merge_placeholders(map_row_to_merge_fields(raw, all_fields))
            )
    else:
        ids = tcfg.get("student_ids") or student_ids
        for sid in ids:
            if sid not in store.records:
                continue
            rows_data.append(expand_merge_placeholders(store.get_merge_payload(sid)))

    return rows_data


def generate_protocol(
    merge_data: dict[str, str],
    template: Path | None = None,
    output_path: Path | None = None,
) -> Path:
    tpl = template or TEMPLATE_PROTOCOL
    if not tpl.exists():
        raise FileNotFoundError(f"Шаблон не найден: {tpl}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fio = merge_data.get("Фамилия_имя_отчество", "студент")
    out = output_path or (OUTPUT_DIR / f"протокол_{_safe_name(fio)}.docx")

    expanded = expand_merge_placeholders(merge_data)
    work_tpl = OUTPUT_DIR / "_gen_work_tpl.docx"
    work_tpl.write_bytes(replace_brace_placeholders_in_docx_bytes(tpl.read_bytes(), expanded))
    try:
        with MailMerge(str(work_tpl)) as doc:
            fields_in_tpl = doc.get_merge_fields()
            payload = {
                field: str(_merge_value(expanded, field)) for field in fields_in_tpl
            }
            doc.merge(**payload)
            doc.write(str(out))
        docx_bytes = replace_brace_placeholders_in_docx_bytes(out.read_bytes(), expanded)
        out.write_bytes(docx_bytes)
    finally:
        work_tpl.unlink(missing_ok=True)
    return out


def _merge_value(merge: dict[str, str], field: str) -> str:
    if field in merge:
        return str(merge[field] or "")
    fl = field.casefold()
    for k, v in merge.items():
        if k.casefold() == fl:
            return str(v or "")
    return ""


def _build_header_merge(
    all_fields: set[str],
    global_rows: list[dict[str, str]],
    header_merge: dict[str, str] | None,
    table_field_names: set[str],
) -> dict[str, str]:
    header = dict(header_merge or {})
    for field in all_fields:
        if field in table_field_names or field in header:
            continue
        if global_rows:
            header.setdefault(field, global_rows[0].get(field, ""))
    if "Количество" in all_fields and not header.get("Количество"):
        header["Количество"] = str(len(global_rows))
    return header


def generate_combined_brace_document(
    template: Path,
    student_ids: list[str],
    store,
    *,
    tables: list[dict],
    header_merge: dict[str, str] | None = None,
    output_path: Path | None = None,
) -> Path:
    from form2act.store import DataStore

    if not isinstance(store, DataStore):
        raise TypeError("store must be DataStore")
    if not template.exists():
        raise FileNotFoundError(f"Шаблон не найден: {template}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = output_path or (OUTPUT_DIR / "сводный_документ.docx")

    from form2act.docx_placeholders import scan_fields_from_template

    tcfg = tables[0]
    _mm, _br, all_names = scan_fields_from_template(template)
    all_fields: set[str] = set(all_names) | set(tcfg.get("fields_in_row") or [])
    for f in header_merge or {}:
        all_fields.add(f)

    rows_data = _rows_for_table(tcfg, student_ids, store, all_fields)
    if not rows_data:
        raise ValueError("Нет данных для строк таблицы")

    global_rows = rows_data
    table_field_names = set(tcfg.get("fields_in_row") or [])
    header = _build_header_merge(all_fields, global_rows, header_merge, table_field_names)

    for i, rd in enumerate(rows_data, 1):
        if "n_pp" in all_fields and not rd.get("n_pp"):
            rd["n_pp"] = str(i)

    docx_bytes = template.read_bytes()
    docx_bytes = replace_brace_placeholders_in_docx_bytes(docx_bytes, header)
    docx_bytes = expand_brace_table_row(
        docx_bytes,
        table_index=int(tcfg["table_index"]),
        row_index=int(tcfg["row_index"]),
        rows_data=rows_data,
    )
    docx_bytes = replace_brace_placeholders_in_docx_bytes(docx_bytes, header)
    out.write_bytes(docx_bytes)
    return out


def generate_combined_document(
    template: Path,
    student_ids: list[str],
    store,
    *,
    tables: list[dict],
    header_merge: dict[str, str] | None = None,
    output_path: Path | None = None,
) -> Path:
    from form2act.store import DataStore

    if not isinstance(store, DataStore):
        raise TypeError("store must be DataStore")

    if not template.exists():
        raise FileNotFoundError(f"Шаблон не найден: {template}")

    if tables and "table_index" in tables[0]:
        return generate_combined_brace_document(
            template,
            student_ids,
            store,
            tables=tables,
            header_merge=header_merge,
            output_path=output_path,
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out = output_path or (OUTPUT_DIR / "сводный_документ.docx")

    table_field_names: set[str] = set()
    for tcfg in tables:
        table_field_names.add(tcfg["anchor"])
        for col in tcfg.get("columns") or []:
            table_field_names.add(col)

    global_rows: list[dict[str, str]] = []
    for sid in student_ids:
        if sid not in store.records:
            continue
        global_rows.append(expand_merge_placeholders(store.get_merge_payload(sid)))

    if not global_rows and not any(
        (t.get("data_source") in ("manual", "xlsx", "diploma_table")) for t in tables
    ):
        raise ValueError("Нет данных по выбранным студентам")

    main_path = str(template.resolve())
    externals = list_external_tables_needed(tables, main_path)
    work_tpl = template
    temp_dir = None
    header: dict[str, str] = dict(header_merge or {})
    if externals:
        temp_dir = tempfile.mkdtemp()
        work_tpl = append_tables_from_externals(template, externals)

    try:
        with MailMerge(str(work_tpl)) as doc:
            all_fields = set(doc.get_merge_fields())
            header = _build_header_merge(
                all_fields, global_rows, header_merge, table_field_names
            )
            if "Количество" in all_fields and not header.get("Количество"):
                total = 0
                for tcfg in tables:
                    total += len(_rows_for_table(tcfg, student_ids, store, all_fields))
                header["Количество"] = str(total or len(global_rows))

            payload = {field: str(header.get(field, "") or "") for field in all_fields}
            doc.merge(**payload)

            for tcfg in tables:
                anchor = resolve_table_anchor(
                    doc,
                    tcfg.get("anchor"),
                    tcfg.get("columns"),
                )
                tcfg["anchor"] = anchor

                rows_data = _rows_for_table(tcfg, student_ids, store, all_fields)
                if not rows_data:
                    continue

                merge_rows: list[dict[str, str]] = []
                for i, rd in enumerate(rows_data, 1):
                    row = {field: str(rd.get(field, "") or "") for field in all_fields}
                    if "n_pp" in all_fields and not row.get("n_pp"):
                        row["n_pp"] = str(i)
                    merge_rows.append(row)

                doc.merge_rows(anchor, merge_rows)

            doc.write(str(out))
    finally:
        if temp_dir and work_tpl != template:
            shutil.rmtree(temp_dir, ignore_errors=True)

    expanded_header = expand_merge_placeholders(header)
    docx_bytes = replace_brace_placeholders_in_docx_bytes(out.read_bytes(), expanded_header)
    out.write_bytes(docx_bytes)
    return out


def generate_combined_preview_bytes(
    template: Path,
    student_ids: list[str],
    store,
    *,
    tables: list[dict],
    header_merge: dict[str, str] | None = None,
) -> bytes:
    tmp = OUTPUT_DIR / "_preview_combined.docx"
    generate_combined_document(
        template,
        student_ids,
        store,
        tables=tables,
        header_merge=header_merge,
        output_path=tmp,
    )
    data = tmp.read_bytes()
    tmp.unlink(missing_ok=True)
    return data


def generate_batch(
    students: list[dict],
    template: Path | None = None,
) -> tuple[list[Path], io.BytesIO]:
    paths: list[Path] = []
    for item in students:
        path = generate_protocol(item["merge"], template=template)
        paths.append(path)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in paths:
            zf.write(p, p.name)
    buf.seek(0)
    return paths, buf
