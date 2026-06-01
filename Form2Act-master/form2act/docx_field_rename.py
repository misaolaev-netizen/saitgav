"""Переименовать «обезличенные» MERGEFIELD F1/F17/F2/… в уникальные имена.

В v2-шаблоне протокола все поля имеют одинаковое имя `F1` (или `F17`),
а смысл задан только подписью в кавычках «…», которую Word показывает
до слияния (display fallback). MailMerge сворачивает все одноимённые поля
к одному значению, поэтому такой шаблон без переименования полей рабочим
быть не может.

Здесь мы лезем прямо в `word/document.xml`, ищем «display text» «X» рядом
с инструкцией `MERGEFIELD F<num>` и переписываем имя поля на `X`.
"""

from __future__ import annotations

import io
import re
import zipfile

# В Word merge-поле может быть оформлено двумя способами:
#   1. `w:fldSimple` с атрибутом `w:instr=" MERGEFIELD F1 \\* MERGEFORMAT "`
#      и текстом «X» внутри.
#   2. Сложное поле: `<w:fldChar begin/> ... <w:instrText> MERGEFIELD F1 </w:instrText>
#      ... <w:fldChar separate/> ... <w:t>«X»</w:t> ... <w:fldChar end/>`.
# Регэкспы ниже покрывают оба варианта.

_FLD_SIMPLE_RE = re.compile(
    r'(<w:fldSimple\b[^>]*?w:instr="\s*MERGEFIELD\s+)(F\d+)([^"]*"[^>]*>)(.*?)(</w:fldSimple>)',
    re.IGNORECASE | re.DOTALL,
)

_COMPLEX_FIELD_RE = re.compile(
    r'(<w:instrText[^>]*>\s*MERGEFIELD\s+)(F\d+)(\b[^<]*</w:instrText>)(.*?)(?=<w:fldChar[^>]*w:fldCharType="end")',
    re.IGNORECASE | re.DOTALL,
)

_DISPLAY_TEXT_RE = re.compile(r'«\s*([^«»]{1,80}?)\s*»', re.DOTALL)
_TEXT_RUN_RE = re.compile(r"<w:t[^>]*>([^<]*)</w:t>", re.DOTALL)


def _joined_runs(xml_fragment: str) -> str:
    """Сшить значения всех `<w:t>` фрагмента — Word часто режет «X» по форматированию."""
    return "".join(_TEXT_RUN_RE.findall(xml_fragment))


def _candidate_name(body: str) -> str | None:
    """Найти «X» внутри display-фрагмента поля и вернуть строку без обрамления."""
    joined = _joined_runs(body)
    m = _DISPLAY_TEXT_RE.search(joined)
    if not m:
        return None
    name = m.group(1).strip()
    # «X» обычно содержит русский идентификатор: убираем пробелы и спец-символы.
    name = re.sub(r"\s+", "_", name)
    if not name:
        return None
    if len(name) > 60:
        return None
    return name


def _rename_in_xml(xml: str) -> tuple[str, dict[str, str]]:
    """Переписать обезличенные F<num>-поля и вернуть отображение старое→новое."""
    mapping: dict[str, str] = {}

    def fix_simple(m: re.Match[str]) -> str:
        new_name = _candidate_name(m.group(4))
        if not new_name:
            return m.group(0)
        mapping[m.group(2)] = new_name
        return f"{m.group(1)}{new_name}{m.group(3)}{m.group(4)}{m.group(5)}"

    def fix_complex(m: re.Match[str]) -> str:
        new_name = _candidate_name(m.group(4))
        if not new_name:
            return m.group(0)
        mapping[m.group(2)] = new_name
        return f"{m.group(1)}{new_name}{m.group(3)}{m.group(4)}"

    xml = _FLD_SIMPLE_RE.sub(fix_simple, xml)
    xml = _COMPLEX_FIELD_RE.sub(fix_complex, xml)
    return xml, mapping


def rename_generic_merge_fields(docx_bytes: bytes) -> tuple[bytes, dict[str, str]]:
    """Вернуть копию docx, в которой `MERGEFIELD F1/F17/...` переименованы
    по тексту «X», и словарь соответствий старое имя → новое.

    Если ни одного «обезличенного» поля не найдено — возвращает исходные байты.
    """
    src = io.BytesIO(docx_bytes)
    out = io.BytesIO()
    mapping: dict[str, str] = {}
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                try:
                    xml = data.decode("utf-8")
                except UnicodeDecodeError:
                    xml = data.decode("utf-8", errors="ignore")
                new_xml, part_map = _rename_in_xml(xml)
                if part_map:
                    mapping.update(part_map)
                if new_xml != xml:
                    data = new_xml.encode("utf-8")
            zout.writestr(item, data)
    return out.getvalue(), mapping
