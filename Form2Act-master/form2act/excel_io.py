from __future__ import annotations

import re
from pathlib import Path

import pandas as pd


def list_sheet_names(path: Path) -> list[str]:
    return pd.ExcelFile(path).sheet_names


def _sheet_key(name: str) -> str:
    return re.sub(r"\s+", " ", name.strip()).casefold()


def resolve_sheet_name(requested: str | None, available: list[str]) -> str:
    if not available:
        raise ValueError("В файле нет листов")

    if not requested:
        return available[0]

    if requested in available:
        return requested

    key = _sheet_key(requested)
    by_key = {_sheet_key(s): s for s in available}

    if key in by_key:
        return by_key[key]

    for sheet in available:
        if key in _sheet_key(sheet):
            return sheet

    names = ", ".join(repr(s) for s in available)
    raise ValueError(f"Лист {requested!r} не найден. Доступны: {names}")


def read_sheet(path: Path, sheet: str | int | None = None, *, header_row: int | None = None) -> tuple[pd.DataFrame, str]:
    names = list_sheet_names(path)
    sheet_name = resolve_sheet_name(sheet if isinstance(sheet, str) else None, names) if sheet is None or isinstance(sheet, str) else names[sheet]

    kwargs: dict = {"sheet_name": sheet_name}
    if header_row is not None:
        kwargs["header"] = header_row

    df = pd.read_excel(path, **kwargs)
    return df, sheet_name
