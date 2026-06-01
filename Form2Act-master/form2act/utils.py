import re
from datetime import date, datetime

_NON_STUDENT_MARKERS = (
    "комисс",        # «Комиссия:»
    "председат",     # «РГСУ — председатель», «Председатель ГЭК»
    "секретар",      # «Суворкина — секретарь»
    "руководитель",  # «Дипломный руководитель»
    "заочк",         # «заочка»
    "очник",         # «очники»
    "ведущи",        # «ведущий»
    "участ",         # «участники»
    "учаща",         # «учащиеся»
    "состав",        # «состав комиссии»
    "примеч",        # «примечания»
)

_CYRILLIC_NAME_RE = re.compile(r"^[А-ЯЁ][а-яё\-]{1,}\.?$")


def _looks_like_name_token(token: str) -> bool:
    t = token.strip()
    if not t:
        return False
    if t.endswith("."):
        head = t[:-1]
        return bool(head) and head[0].isupper() and head.isalpha()
    return bool(_CYRILLIC_NAME_RE.match(t))


def is_real_student_fio(fio: str) -> bool:
    """Эвристика: «настоящий» ФИО студента — три слова кириллицей с большой буквы.

    Отсекает строки типа «Комиссия:», «Тузовский», «РГСУ — председатель»,
    «заочка», единичные фамилии без имени/отчества и т. п., которые часто
    встречаются в служебных строках Excel «шаблоны для дипломов».
    """
    if not fio:
        return False
    text = str(fio).replace("\xa0", " ").strip()
    if not text:
        return False
    low = text.casefold()
    if ":" in text:
        return False
    if any(marker in low for marker in _NON_STUDENT_MARKERS):
        return False
    tokens = [t for t in re.split(r"[\s—–\-]+", text) if t]
    if len(tokens) < 3:
        return False
    real = sum(1 for t in tokens if _looks_like_name_token(t))
    return real >= 3


def normalize_fio(value) -> str:
    if value is None or (isinstance(value, float) and str(value) == "nan"):
        return ""
    text = str(value).replace("\xa0", " ").strip()
    text = text.replace("ё", "е").replace("Ё", "Е")
    # Часто ФИО приходит с лишней пунктуацией из Excel/Forms.
    text = re.sub(r"[.,;:()\"'`]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.casefold()


def format_cell(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float):
        if str(value) == "nan":
            return ""
        if value == int(value):
            return str(int(value))
    if isinstance(value, (datetime, date)):
        if isinstance(value, datetime) and value.hour == 0 and value.minute == 0:
            return value.strftime("%d.%m.%Y")
        return value.strftime("%d.%m.%Y %H:%M")
    return str(value).strip()


def row_to_record(row, column_map: dict) -> dict:
    record = {}
    for src_col, key in column_map.items():
        if src_col in row.index:
            val = format_cell(row[src_col])
            if val:
                record[key] = val
    return record


def format_questions_from_form(record: dict) -> str:
    parts = []
    for i in range(1, 4):
        author = record.get(f"АвторВопроса{i}", "").strip()
        question = record.get(f"Вопрос{i}", "").strip()
        if author and question:
            parts.append(f"{author} {question}")
        elif question:
            parts.append(question)
    return "\n".join(parts)
