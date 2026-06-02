"""Post-process docx bytes: split text runs containing `\n` into multiple
`<w:t>` runs joined by `<w:br/>` line breaks within the same paragraph.

Why this is needed
==================

`docx-mailmerge` (and our brace-placeholder substitution) writes the merge
value as plain text inside a single `<w:t>`.  When the value is a multi-line
string like ``"Иванов И.И.\nПетров П.П."`` Word renders it as a single line
because `\n` is *not* recognised as a paragraph or line break.

This module rewrites every `<w:t>` whose text contains `\n` into a sequence
``<w:t>line1</w:t><w:br/><w:t>line2</w:t>…`` so the rendered document shows
each line on its own row inside the same paragraph (style is preserved).
"""
from __future__ import annotations

import io
import re
import shutil
import tempfile
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

_T_RE = re.compile(r"(<w:t(\s[^>]*)?>)([^<]*)(</w:t>)")

_W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def _xml_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _convert_xml(xml: str) -> str:
    """Replace `\n` inside every `<w:t>` with `<w:br/>` joiners."""

    def repl(match: re.Match[str]) -> str:
        open_tag = match.group(1)
        attrs = match.group(2) or ""
        text = match.group(3)
        close_tag = match.group(4)
        if "\n" not in text:
            return match.group(0)
        # Preserve any explicit xml:space attribute, otherwise add it so
        # leading/trailing spaces survive splitting.
        if 'xml:space' not in attrs:
            open_tag = open_tag[:-1] + ' xml:space="preserve">'
        parts = text.split("\n")
        chunks: list[str] = []
        for i, part in enumerate(parts):
            if i:
                chunks.append("<w:br/>")
            chunks.append(open_tag + _xml_escape(part) + close_tag)
        return "".join(chunks)

    return _T_RE.sub(repl, xml)


def convert_newlines_to_breaks(docx_bytes: bytes) -> bytes:
    """Return a new docx where every `\n` inside `<w:t>` becomes a `<w:br/>`."""
    src = io.BytesIO(docx_bytes)
    out = io.BytesIO()
    with ZipFile(src, "r") as zin, ZipFile(out, "w", ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                try:
                    xml = data.decode("utf-8")
                except UnicodeDecodeError:
                    zout.writestr(item, data)
                    continue
                new_xml = _convert_xml(xml)
                data = new_xml.encode("utf-8")
            zout.writestr(item, data)
    return out.getvalue()


def convert_newlines_in_file(path: str | Path) -> None:
    p = Path(path)
    new_bytes = convert_newlines_to_breaks(p.read_bytes())
    p.write_bytes(new_bytes)
