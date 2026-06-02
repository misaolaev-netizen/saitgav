from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

_FIO_HEADER_PATTERNS = (
    "фио", "фио студента", "фамилия, имя, отчество",
    "фамилия имя отчество", "фамилия_имя_отчество",
)

_XLSX_SIGNATURE = b"PK\x03\x04"
_XLS_SIGNATURE = b"\xD0\xCF\x11\xE0"


def _is_excel_lock_or_temp(path: Path) -> bool:
    name = path.name
    return name.startswith("~$") or name.startswith(".~lock")


def _detect_engine(path: Path) -> str | None:
    suffix = path.suffix.lower()
    try:
        with path.open("rb") as fh:
            head = fh.read(8)
    except OSError:
        return None
    if head.startswith(_XLSX_SIGNATURE):
        return "openpyxl"
    if head.startswith(_XLS_SIGNATURE):
        return "xlrd"
    if suffix == ".xlsx":
        return "openpyxl"
    if suffix == ".xls":
        return "xlrd"
    return None


def _ensure_readable(path: Path) -> str:
    if _is_excel_lock_or_temp(path):
        raise ValueError(
            f"Файл {path.name!r} — временный файл блокировки Excel и не содержит данных."
        )
    if not path.exists():
        raise FileNotFoundError(f"Файл не найден: {path}")
    if path.stat().st_size < 200:
        raise ValueError(
            f"Файл {path.name!r} слишком мал и не похож на корректный Excel-файл."
        )
    engine = _detect_engine(path)
    if engine is None:
        raise ValueError(
            f"Не удаётся определить формат файла {path.name!r}. Сохраните его как .xlsx."
        )
    return engine


def list_sheet_names(path: Path) -> list[str]:
    engine = _ensure_readable(path)
    return pd.ExcelFile(path, engine=engine).sheet_names


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


def _detect_header_row(path: Path, sheet_name: str, max_scan: int = 10) -> int | None:
    engine = _ensure_readable(path)
    raw = pd.read_excel(path, sheet_name=sheet_name, header=None, dtype=str, nrows=max_scan, engine=engine)
    if raw.empty:
        return None
    first_col = str(raw.iloc[0, 0] if len(raw.columns) else "").strip().casefold()
    has_fio_in_first = any(p in first_col for p in _FIO_HEADER_PATTERNS)
    if has_fio_in_first:
        return 0
    for i in range(min(len(raw), max_scan)):
        row_vals = [str(x).strip().casefold() for x in raw.iloc[i].tolist()]
        if any(any(p in v for p in _FIO_HEADER_PATTERNS) for v in row_vals):
            return i
    return None


def read_sheet(path: Path, sheet: str | int | None = None, *, header_row: int | None = None) -> tuple[pd.DataFrame, str]:
    engine = _ensure_readable(path)
    names = list_sheet_names(path)
    sheet_name = resolve_sheet_name(sheet if isinstance(sheet, str) else None, names) if sheet is None or isinstance(sheet, str) else names[sheet]

    kwargs: dict = {"sheet_name": sheet_name, "engine": engine}
    if header_row is not None:
        kwargs["header"] = header_row
    else:
        detected = _detect_header_row(path, sheet_name)
        if detected is not None and detected > 0:
            kwargs["header"] = detected

    df = pd.read_excel(path, **kwargs)
    return df, sheet_name
