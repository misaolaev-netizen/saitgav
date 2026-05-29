from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from form2act.config import DIPLOMA_FORM_COLUMNS, DP_COLUMNS, FORM_COLUMNS, GIA_COLUMNS, TEMPLATES_COLUMNS
from form2act.diploma import format_pages
from form2act.excel_io import list_sheet_names, read_sheet
from form2act.utils import format_questions_from_form, normalize_fio, row_to_record
from form2act.store import DataStore

_DATE_FROM_SHEET_RE = re.compile(r"^(\d{1,2})\.(\d{1,2})\.(\d{2,4})")


def _date_from_sheet_name(sheet_name: str) -> str | None:
    m = _DATE_FROM_SHEET_RE.match(sheet_name.strip())
    if not m:
        return None
    day, month, year = m.group(1), m.group(2), m.group(3)
    if len(year) == 2:
        year = "20" + year
    return f"{day.zfill(2)}.{month.zfill(2)}.{year}"


def _load_dp_sheet(store: DataStore, path: Path, sheet: str | None) -> int:
    df, sheet_name = read_sheet(path, sheet)
    date_from_sheet = _date_from_sheet_name(sheet_name)
    count = 0
    for _, row in df.iterrows():
        data = row_to_record(row, DP_COLUMNS)
        fio = data.get("fio", "")
        if not fio:
            continue
        data["Фамилия_имя_отчество"] = fio
        if date_from_sheet and not data.get("Дата_защиты_диплома"):
            data["Дата_защиты_диплома"] = date_from_sheet
        store.apply_row(normalize_fio(fio), data, "ДП")
        count += 1
    return count


def load_dp(store: DataStore, path: Path, sheet: str | None = None) -> int:
    if sheet:
        count = _load_dp_sheet(store, path, sheet)
        store.meta["dp_file"] = str(path)
        store.meta["dp_sheet"] = sheet
        return count

    sheets = list_sheet_names(path)
    total = 0
    for sh in sheets:
        total += _load_dp_sheet(store, path, sh)
    store.meta["dp_file"] = str(path)
    store.meta["dp_sheet"] = sheets[0] if sheets else None
    return total


def load_diploma_form(store: DataStore, path: Path, sheet: str | None = None) -> int:
    df, sheet_name = read_sheet(path, sheet)
    count = 0
    for _, row in df.iterrows():
        data = row_to_record(row, DIPLOMA_FORM_COLUMNS)
        fio = data.get("fio", "")
        if not fio:
            continue
        if data.get("pages"):
            data["ВКР"] = format_pages(str(data.pop("pages")))
        if data.get("graph_pages"):
            data["ГрафЧасть"] = format_pages(str(data.pop("graph_pages")))
        data["Фамилия_имя_отчество"] = fio
        store.apply_row(normalize_fio(fio), data, "дипломы")
        count += 1
    store.meta["diploma_file"] = str(path)
    store.meta["diploma_sheet"] = sheet_name
    return count


def load_form(store: DataStore, path: Path, sheet: str | None = None) -> int:
    df, sheet_name = read_sheet(path, sheet)
    count = 0
    for _, row in df.iterrows():
        data = row_to_record(row, FORM_COLUMNS)
        _attach_form_questions(row, data)
        fio = data.get("fio", "")
        if not fio:
            continue
        data.setdefault("Фамилия_имя_отчество", fio)
        store.apply_row(normalize_fio(fio), data, "опрос")
        count += 1
    store.meta["form_file"] = str(path)
    store.meta["form_sheet"] = sheet_name
    return count


def _attach_form_questions(row: pd.Series, data: dict) -> None:
    for i in range(1, 4):
        for prefix in ("АвторВопроса", "Вопрос"):
            col = f"{prefix}{i}"
            if col not in row.index:
                continue
            val = row[col]
            if pd.notna(val) and str(val).strip():
                data[col] = str(val).strip()
    text = format_questions_from_form(data)
    if text:
        data["Вопросы"] = text


def load_gia(store: DataStore, path: Path) -> int:
    df, _ = read_sheet(path, header_row=1)
    count = 0
    for _, row in df.iterrows():
        data = row_to_record(row, GIA_COLUMNS)
        fio = data.get("fio", "")
        if not fio:
            continue
        if data.get("дата_сдачи_де"):
            data.setdefault("Дата_ДЭ", data.pop("дата_сдачи_де"))
        data.pop("оценка_вкр_raw", None)
        store.apply_row(normalize_fio(fio), data, "ГИА")
        count += 1
    store.meta["gia_file"] = str(path)
    return count


def load_templates(store: DataStore, path: Path, sheet: str | None = None) -> int:
    df, sheet_name = read_sheet(path, sheet)

    if df.shape[1] and str(df.columns[0]).startswith("Работа"):
        df, sheet_name = read_sheet(path, sheet_name, header_row=2)

    count = 0
    for _, row in df.iterrows():
        data = row_to_record(row, TEMPLATES_COLUMNS)
        fio = data.get("fio", "")
        if not fio:
            continue
        data["Фамилия_имя_отчество"] = fio
        if data.get("fio_rp"):
            data["F2"] = data["fio_rp"]
        if data.get("РП"):
            data["F2"] = data["РП"]
        if data.get("Руководитель"):
            data["Руководитель_from_template"] = True
        store.apply_row(normalize_fio(fio), data, f"шаблоны:{sheet_name}")
        count += 1
    store.meta.setdefault("templates_sheets", []).append(sheet_name)
    return count
