from __future__ import annotations

from pathlib import Path

from mailmerge import MailMerge

from form2act.config import DATA_DIR, TEMPLATE_PROTOCOL
from form2act.custom_fields import field_catalog

UPLOAD_TEMPLATES_DIR = DATA_DIR.parent / "uploads" / "templates"


def _scan_folder(folder: Path, items: list[dict[str, str]], seen: set[str]) -> None:
    if not folder.exists():
        return
    for path in sorted(folder.glob("*.docx")):
        resolved = str(path.resolve())
        if resolved in seen:
            continue
        seen.add(resolved)
        items.append({"name": path.name, "path": resolved, "default": False})


def list_word_templates() -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    _scan_folder(DATA_DIR, items, seen)
    _scan_folder(UPLOAD_TEMPLATES_DIR, items, seen)

    default_path = str(TEMPLATE_PROTOCOL.resolve()) if TEMPLATE_PROTOCOL.exists() else None
    for item in items:
        if default_path and item["path"] == default_path:
            item["default"] = True
    if items and not any(i["default"] for i in items):
        items[0]["default"] = True
    return items


def resolve_template(path_str: str | None) -> Path:
    if not path_str:
        if not TEMPLATE_PROTOCOL.exists():
            raise FileNotFoundError(f"Шаблон по умолчанию не найден: {TEMPLATE_PROTOCOL}")
        return TEMPLATE_PROTOCOL.resolve()

    path = Path(path_str).resolve()
    allowed_roots = [DATA_DIR.resolve(), UPLOAD_TEMPLATES_DIR.resolve()]
    if not any(_is_under(path, root) for root in allowed_roots):
        raise ValueError("Шаблон должен быть в папке data/ или uploads/templates/")
    if not path.exists() or path.suffix.lower() != ".docx":
        raise FileNotFoundError(f"Шаблон не найден: {path}")
    return path


def _is_under(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def merge_fields_in_template(template: Path) -> list[str]:
    return field_catalog(template)["for_chips"]
