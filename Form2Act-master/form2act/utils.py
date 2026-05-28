import re
from datetime import date, datetime


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
