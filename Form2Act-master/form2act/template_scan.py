from __future__ import annotations

from pathlib import Path
from typing import Any

from mailmerge import MailMerge

from form2act.docx_placeholders import scan_fields_from_template
from form2act.docx_table_brace import pick_primary_brace_table, scan_brace_table_rows


def scan_template_tables(template: Path) -> dict:
    with MailMerge(str(template)) as doc:
        fields = sorted(doc.get_merge_fields())
        anchors: dict[str, dict] = {}
        for field in fields:
            table, row_idx, _row = doc._MailMerge__find_row_anchor(field)
            if table is None:
                continue
            key = f"row_{row_idx}"
            entry = anchors.setdefault(
                key,
                {
                    "row_index": row_idx,
                    "fields_in_row": [],
                    "suggested_anchors": [],
                },
            )
            entry["fields_in_row"].append(field)

        tables = []
        for entry in anchors.values():
            fields_in_row = sorted(set(entry["fields_in_row"]))
            preferred = next(
                (f for f in fields_in_row if "фамилия" in f.lower() or "fio" in f.lower()),
                None,
            )
            suggested = preferred or (fields_in_row[0] if fields_in_row else "")
            tables.append(
                {
                    "row_index": entry["row_index"],
                    "fields_in_row": fields_in_row,
                    "suggested_anchor": suggested,
                }
            )

        table_fields = {f for t in tables for f in t["fields_in_row"]}
        header_fields = [f for f in fields if f not in table_fields]
        table_anchors = [t["suggested_anchor"] for t in tables if t.get("suggested_anchor")]

        return {
            "fields": fields,
            "tables": sorted(tables, key=lambda t: t["row_index"]),
            "header_fields": header_fields,
            "table_fields": sorted(table_fields),
            "table_anchors": table_anchors,
        }


def list_table_anchors(template: Path) -> list[str]:
    info = scan_template_tables(template)
    return info.get("table_anchors") or []


def default_tables_config(scan: dict[str, Any]) -> list[dict[str, Any]]:
    source = scan.get("table_source")
    tables = scan.get("tables") or []
    if source == "mailmerge":
        return [
            {
                "anchor": t.get("suggested_anchor"),
                "columns": t.get("fields_in_row") or [],
                "data_source": "students",
            }
            for t in tables
            if t.get("suggested_anchor")
        ]
    if source == "brace":
        primary = pick_primary_brace_table(tables) or (tables[0] if tables else None)
        if not primary:
            return []
        return [
            {
                "table_index": primary["table_index"],
                "row_index": primary["row_index"],
                "fields_in_row": primary.get("fields_in_row") or [],
                "data_source": "students",
            }
        ]
    return []


def scan_template_full(template: Path) -> dict[str, Any]:
    mailmerge, brace, all_fields = scan_fields_from_template(template)

    try:
        mm = scan_template_tables(template)
        if mm.get("tables"):
            return {
                "mode": "combined",
                "table_source": "mailmerge",
                "fields": mm.get("fields") or all_fields,
                "tables": mm.get("tables") or [],
                "header_fields": mm.get("header_fields") or [],
                "table_fields": mm.get("table_fields") or [],
                "table_anchors": mm.get("table_anchors") or [],
                "mailmerge_fields": mailmerge,
                "brace_fields": brace,
            }
    except Exception:
        pass

    brace_tables = scan_brace_table_rows(template)
    if brace_tables:
        primary = pick_primary_brace_table(brace_tables) or brace_tables[0]
        table_fields = set(primary.get("fields_in_row") or [])
        for t in brace_tables:
            table_fields.update(t.get("fields_in_row") or [])
        header_fields = [f for f in all_fields if f not in table_fields]
        return {
            "mode": "combined",
            "table_source": "brace",
            "fields": all_fields,
            "tables": brace_tables,
            "header_fields": header_fields,
            "table_fields": sorted(table_fields, key=str.casefold),
            "table_anchors": [primary.get("suggested_anchor", "")],
            "mailmerge_fields": mailmerge,
            "brace_fields": brace,
        }

    return {
        "mode": "single",
        "table_source": None,
        "fields": all_fields,
        "tables": [],
        "header_fields": all_fields,
        "table_fields": [],
        "table_anchors": [],
        "mailmerge_fields": mailmerge,
        "brace_fields": brace,
    }


def resolve_table_anchor(
    doc: "MailMerge",
    anchor: str | None,
    columns: list[str] | None = None,
) -> str:
    candidates: list[str] = []
    if anchor:
        candidates.append(anchor)
    for f in columns or []:
        if f not in candidates:
            candidates.append(f)
    for f in sorted(doc.get_merge_fields()):
        if f not in candidates:
            candidates.append(f)

    for field in candidates:
        table, _idx, _row = doc._MailMerge__find_row_anchor(field)
        if table is not None:
            return field

    available = []
    for field in sorted(doc.get_merge_fields()):
        table, _idx, _row = doc._MailMerge__find_row_anchor(field)
        if table is not None:
            available.append(field)

    if available:
        hint = ", ".join(available[:8])
        raise ValueError(
            f"Поле «{anchor or '?'}» не в строке таблицы. "
            f"Доступные якоря: {hint}."
        )

    fields = ", ".join(sorted(doc.get_merge_fields())[:12]) or "—"
    raise ValueError(
        "В этом .docx нет таблицы с полями слияния (MERGEFIELD в строке). "
        f"Поля в файле: {fields}."
    )
