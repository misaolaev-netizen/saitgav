from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

from form2act.config import DATA_DIR

PROFILES_DIR = DATA_DIR.parent / "uploads" / "templates" / "profiles"
PROFILES_DIR.mkdir(parents=True, exist_ok=True)


def _safe_slug(name: str) -> str:
    s = re.sub(r"[^\w\-]+", "_", name.strip(), flags=re.UNICODE)
    return s.strip("_") or "шаблон"


def list_profiles() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for path in sorted(PROFILES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        data.setdefault("id", path.stem)
        tpl = Path(data.get("template_path", ""))
        data["template_exists"] = tpl.exists()
        items.append(data)
    return items


def get_profile(profile_id: str) -> dict[str, Any] | None:
    path = PROFILES_DIR / f"{profile_id}.json"
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    data.setdefault("id", profile_id)
    return data


def save_profile(
    name: str,
    template_path: Path,
    *,
    tables: list[dict[str, Any]],
    header_fields: list[str] | None = None,
    source_template: str | None = None,
) -> dict[str, Any]:
    profile_id = _safe_slug(name)
    dest_docx = template_path.parent / f"{profile_id}.docx"
    if template_path.resolve() != dest_docx.resolve():
        shutil.copy2(template_path, dest_docx)
        template_path = dest_docx

    profile = {
        "id": profile_id,
        "name": name.strip(),
        "template_path": str(template_path.resolve()),
        "header_fields": header_fields or [],
        "tables": tables,
        "source_template": source_template,
    }
    out = PROFILES_DIR / f"{profile_id}.json"
    out.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return profile


def create_profile_from_base(
    name: str,
    base_template: Path,
    *,
    tables: list[dict[str, Any]],
    header_fields: list[str] | None = None,
) -> dict[str, Any]:
    profile_id = _safe_slug(name)
    dest = DATA_DIR.parent / "uploads" / "templates" / f"{profile_id}.docx"
    shutil.copy2(base_template, dest)
    return save_profile(
        name,
        dest,
        tables=tables,
        header_fields=header_fields,
        source_template=str(base_template.resolve()),
    )
