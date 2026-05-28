from __future__ import annotations

from pathlib import Path

from form2act.config import DATA_DIR
from form2act.loaders import load_dp, load_form, load_gia, load_templates
from form2act.store import DataStore


def default_file_paths() -> dict[str, Path | None]:
    files = {
        "dp": DATA_DIR / "ДП 2025-2026.xlsx",
        "form": DATA_DIR / "Проба1(данные).xlsx",
        "gia": DATA_DIR / "ГИА_результаты (3).xlsx",
        "templates": DATA_DIR / "шаблоны для дипломов 41 (1).xlsx",
        "protocol_tpl": DATA_DIR / "протоколШАБЛОН (1).docx",
    }
    return {name: path if path.exists() else None for name, path in files.items()}


def reload_all(
    store: DataStore,
    *,
    dp_path: Path | None = None,
    form_path: Path | None = None,
    gia_path: Path | None = None,
    templates_path: Path | None = None,
    templates_sheet: str | None = None,
    dp_sheet: str | None = None,
    use_templates: bool = True,
) -> dict:
    paths = default_file_paths()
    store.clear()

    stats: dict = {"dp": 0, "form": 0, "gia": 0, "templates": 0, "errors": []}

    def _run(label: str, fn) -> None:
        try:
            fn()
        except Exception as exc:
            stats["errors"].append(f"{label}: {exc}")

    dp = dp_path or paths["dp"]
    if dp:
        _run("ДП", lambda: stats.update({"dp": load_dp(store, dp, dp_sheet)}))

    form = form_path or paths["form"]
    if form:
        _run("Опрос", lambda: stats.update({"form": load_form(store, form)}))

    gia = gia_path or paths["gia"]
    if gia:
        _run("ГИА", lambda: stats.update({"gia": load_gia(store, gia)}))

    tpl = templates_path or paths["templates"]
    if use_templates and tpl:
        def _templates() -> None:
            sheet = templates_sheet
            if not sheet:
                sheet = store.sheets_in_file(tpl)[0]
            stats["templates"] = load_templates(store, tpl, sheet)
            stats["templates_sheet"] = store.meta.get("templates_sheets", [sheet])[-1]

        _run("Шаблоны", _templates)

    stats["students"] = len(store.records)
    return stats
