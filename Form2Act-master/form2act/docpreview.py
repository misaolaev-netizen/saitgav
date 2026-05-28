from __future__ import annotations

import html as html_lib
import re
from pathlib import Path

import mammoth

from form2act.config import OUTPUT_DIR
from form2act.docgen import generate_protocol
from form2act.merge_expand import expand_merge_placeholders, expand_placeholders_in_html


def is_docx_preview_html(html: str | None) -> bool:
    if not html or not html.strip():
        return False
    h = html.strip()
    return (
        'data-preview-format="docx-preview"' in h
        or 'class="docx-body-host"' in h
        or 'class="docx-wrapper"' in h
        or 'class="docx"' in h
    )


def is_complete_docx_preview_html(html: str | None) -> bool:
    if not html or not is_docx_preview_html(html):
        return False
    return "docx-style-host" in html and "docx-body-host" in html


def _clean_preview_html(html: str) -> str:
    html = re.sub(r"<a\s+id=[\"'][^\"']*[\"']\s*></a>", "", html, flags=re.I)
    html = re.sub(r"<a\s+id=[\"'][^\"']*[\"']\s*/>", "", html, flags=re.I)
    return html


def merge_to_docx_bytes(
    merge_data: dict[str, str],
    template: Path | None = None,
) -> bytes:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    preview_path = OUTPUT_DIR / "_preview_render.docx"
    try:
        generate_protocol(merge_data, template=template, output_path=preview_path)
        return preview_path.read_bytes()
    finally:
        preview_path.unlink(missing_ok=True)


def merge_docx_to_html(
    merge_data: dict[str, str],
    template: Path | None = None,
) -> tuple[str, list[str]]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    preview_path = OUTPUT_DIR / "_preview_render.docx"
    try:
        generate_protocol(merge_data, template=template, output_path=preview_path)
        with preview_path.open("rb") as docx_file:
            result = mammoth.convert_to_html(
                docx_file,
                include_default_style_map=True,
            )
        warnings = [str(m) for m in result.messages]
        return _clean_preview_html(result.value), warnings
    finally:
        preview_path.unlink(missing_ok=True)


def _wrap_editable_values(html: str, merge: dict[str, str]) -> str:
    items = sorted(
        ((k, str(v).strip()) for k, v in merge.items() if v and len(str(v).strip()) >= 2),
        key=lambda x: -len(x[1]),
    )
    for field, value in items:
        esc = html_lib.escape(value)
        token = (
            f'<span class="merge-editable" contenteditable="true" spellcheck="true" '
            f'data-merge-field="{html_lib.escape(field, quote=True)}">{esc}</span>'
        )
        if esc in html:
            html = html.replace(esc, token, 1)
    return html


def _editable_shell(inner_html: str) -> str:
    return (
        f'<div class="docx-editable docx-wrapper" contenteditable="true" '
        f'spellcheck="true">{inner_html}</div>'
    )


def merge_to_editable_html(
    merge_data: dict[str, str],
    template: Path | None = None,
    saved_html: str | None = None,
) -> tuple[str, list[str]]:
    expanded = expand_merge_placeholders(merge_data)
    if saved_html and saved_html.strip():
        body = expand_placeholders_in_html(saved_html.strip(), expanded)
        if is_complete_docx_preview_html(body):
            return body, []
        if not is_docx_preview_html(body):
            return _editable_shell(body), []

    html, warnings = merge_docx_to_html(merge_data, template=template)
    wrapped = _wrap_editable_values(html, expanded)
    wrapped = expand_placeholders_in_html(wrapped, expanded)
    return _editable_shell(wrapped), warnings
