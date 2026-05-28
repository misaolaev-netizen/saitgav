from __future__ import annotations

from pathlib import Path

from form2act.config import DATA_DIR, TEMPLATE_PROTOCOL
from form2act.loaders import load_dp, load_form, load_gia, load_templates
from form2act.store import DataStore


def _find_by_prefix(prefix: str, ext: str = ".xlsx") -> Path | None:
    prefix_lower = prefix.casefold()
    for p in sorted(DATA_DIR.glob(f"*{ext}")):
        if p.name.startswith("~$"):
            continue
        if p.name.casefold().startswith(prefix_lower):
            return p
    return None


def default_file_paths() -> dict[str, Path | None]:
    dp = _find_by_prefix("ДП")
    form = _find_by_prefix("Проба")
    gia = _find_by_prefix("ГИА")
    templates = _find_by_prefix("шаблоны")
    schedule = _find_by_prefix("Защита")

    if schedule and not dp:
        dp = schedule
        schedule = None

    protocol_tpl = TEMPLATE_PROTOCOL if TEMPLATE_PROTOCOL.exists() else None
    if not protocol_tpl:
        protocol_tpl = _find_by_prefix("протокол", ext=".docx")

    return {
        "dp": dp,
        "schedule": schedule,
        "form": form,
        "gia": gia,
        "templates": templates,
        "protocol_tpl": protocol_tpl,
    }


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

    schedule = paths.get("schedule")
    if schedule:
        _run("Расписание", lambda: stats.update({"schedule": load_dp(store, schedule)}))

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
