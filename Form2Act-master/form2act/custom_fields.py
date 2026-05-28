from __future__ import annotations

import json
import re
from pathlib import Path

from form2act.config import BASE_DIR, DIPLOMA_FIELDS, MERGE_FIELDS

CUSTOM_FIELDS_PATH = BASE_DIR / "uploads" / "custom_fields.json"
_FIELD_NAME_RE = re.compile(r"^[\wА-Яа-яЁё][\wА-Яа-яЁё0-9_.\-]{0,79}$")


def _normalize_name(name: str) -> str:
    return (name or "").strip()


def validate_field_name(name: str) -> str:
    n = _normalize_name(name)
    if not n:
        raise ValueError("Укажите имя поля")
    if not _FIELD_NAME_RE.match(n):
        raise ValueError("Имя поля: буквы, цифры, _ (без пробелов)")
    if n in MERGE_FIELDS or n in DIPLOMA_FIELDS:
        raise ValueError("Такое поле уже есть в стандартном списке")
    return n


def _load() -> dict:
    CUSTOM_FIELDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not CUSTOM_FIELDS_PATH.exists():
        return {"global": [], "by_template": {}}
    return json.loads(CUSTOM_FIELDS_PATH.read_text(encoding="utf-8"))


def _save(data: dict) -> None:
    CUSTOM_FIELDS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CUSTOM_FIELDS_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _tpl_key(template: Path | str | None) -> str:
    if not template:
        return ""
    return str(Path(template).resolve())


def list_global() -> list[str]:
    data = _load()
    return sorted(set(data.get("global") or []), key=str.casefold)


def list_for_template(template: Path | str | None) -> list[str]:
    data = _load()
    by = data.get("by_template") or {}
    return sorted(set(by.get(_tpl_key(template), []) or []), key=str.casefold)


def add_global(name: str) -> list[str]:
    n = validate_field_name(name)
    data = _load()
    g = set(data.setdefault("global", []))
    g.add(n)
    data["global"] = sorted(g, key=str.casefold)
    _save(data)
    return data["global"]


def add_for_template(template: Path | str, name: str) -> list[str]:
    n = validate_field_name(name)
    data = _load()
    key = _tpl_key(template)
    by = data.setdefault("by_template", {})
    items = set(by.get(key, []) or [])
    items.add(n)
    by[key] = sorted(items, key=str.casefold)
    _save(data)
    return by[key]


def remove_global(name: str) -> None:
    data = _load()
    g = [x for x in data.get("global", []) if x != name]
    data["global"] = g
    _save(data)


def word_fields_in_template(template: Path) -> list[str]:
    from mailmerge import MailMerge

    try:
        with MailMerge(str(template)) as doc:
            return sorted(doc.get_merge_fields(), key=str.casefold)
    except Exception:
        return []


def field_catalog(template: Path | str | None = None) -> dict:
    from form2act.docx_placeholders import brace_fields_in_template, template_merge_field_names

    tpl = Path(template) if template else None
    if tpl and tpl.exists():
        mailmerge, brace, word = template_merge_field_names(tpl)
    else:
        mailmerge, brace, word = [], [], []
    custom_g = list_global()
    custom_t = list_for_template(tpl) if tpl else []
    custom = sorted(set(custom_g) | set(custom_t), key=str.casefold)

    diploma = list(DIPLOMA_FIELDS)
    protocol = [f for f in MERGE_FIELDS if f not in word]

    all_names = sorted(
        set(word) | set(diploma) | set(custom) | set(MERGE_FIELDS),
        key=str.casefold,
    )

    template_all = sorted(set(mailmerge) | set(brace), key=str.casefold)

    return {
        "fields": all_names,
        "word": word,
        "mailmerge": mailmerge,
        "brace": brace,
        "template_all": template_all,
        "diploma": diploma,
        "custom": custom,
        "protocol": protocol,
        "for_chips": sorted(
            set(word) | set(diploma) | set(custom) | set(MERGE_FIELDS),
            key=str.casefold,
        ),
    }


def all_custom_names() -> list[str]:
    data = _load()
    names: set[str] = set(data.get("global") or [])
    for items in (data.get("by_template") or {}).values():
        names.update(items or [])
    return sorted(names, key=str.casefold)
