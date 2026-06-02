from __future__ import annotations

import datetime
import re
from pathlib import Path
from typing import Any

from form2act.config import DIPLOMA_FIELDS, MERGE_FIELDS, PREVIEW_FIELDS
from form2act.custom_fields import all_custom_names
from form2act.excel_io import list_sheet_names
from form2act.morphology import finalize_names
from form2act.utils import is_real_student_fio


def _commission_fields() -> dict[str, str]:
    """Поля состава ГЭК для подстановки в шаблон протокола.

    Загружаются лениво, чтобы избежать циклического импорта между store.py
    и commissions.py.
    """
    try:
        from form2act.commissions import load_commission
    except Exception:
        return {}

    commission = load_commission()

    def _person_line(person) -> str:
        name = (person.name or "").strip()
        position = (person.position or "").strip()
        if name and position:
            return f"{name}, {position}"
        return name or position

    def _person_name(person) -> str:
        return (person.name or "").strip()

    members_lines = [m.as_line() for m in commission.members if (m.name or "").strip()]
    members_block = "\n".join(members_lines)

    fields = {
        "ПредседательГЭК": _person_line(commission.chairman),
        "ЗамПредседателяГЭК": _person_line(commission.deputy_chairman),
        "СекретарьГЭК": _person_line(commission.secretary),
        "Секретарь": _person_line(commission.secretary),
        "ЧленыГЭК": members_block,
        "Председатель_ГЭК": _person_line(commission.chairman),
        "Заместитель_председателя_ГЭК": _person_line(commission.deputy_chairman),
        "Секретарь_ГЭК": _person_line(commission.secretary),
        "Члены_ГЭК": members_block,
        # Короткие имена для строк подписи в протоколе
        "ПредседательГЭК_имя": _person_name(commission.chairman),
        "ЗамПредседателяГЭК_имя": _person_name(commission.deputy_chairman),
        "СекретарьГЭК_имя": _person_name(commission.secretary),
        "Председатель_ГЭК_имя": _person_name(commission.chairman),
        "Заместитель_председателя_ГЭК_имя": _person_name(commission.deputy_chairman),
        "Секретарь_ГЭК_имя": _person_name(commission.secretary),
    }
    return {k: v for k, v in fields.items() if v}


def _strip_pages_prefix(value: str) -> str:
    s = str(value or "").strip()
    m = re.match(r"на\s+(\d+)\s+страниц", s, re.I)
    return m.group(1) if m else s


def _compute_group_admission_year(group_value: Any) -> str | None:
    s = str(group_value or "").strip()
    if not s:
        return None
    m = re.search(r"(\d)", s)
    if not m:
        return None
    first_digit = int(m.group(1))
    year = datetime.date.today().year - first_digit
    return str(year)


class DataStore:
    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self.overrides: dict[str, dict[str, str]] = {}
        self.meta: dict[str, Any] = {}

    def clear(self) -> None:
        self.records.clear()
        self.overrides.clear()
        self.meta.clear()

    def apply_row(self, fio_key: str, data: dict, source: str) -> None:
        display_fio = str(data.get("fio") or "").strip()
        if not is_real_student_fio(display_fio) and fio_key not in self.records:
            # Не заводим новые записи для служебных строк
            # («Комиссия:», одиночные фамилии преподавателей, «заочка» и т. п.).
            return
        if fio_key not in self.records:
            self.records[fio_key] = {"_fio": "", "_sources": []}

        rec = self.records[fio_key]
        if data.get("fio"):
            rec["_fio"] = data["fio"]

        for key, value in data.items():
            if key == "fio" or not value:
                continue
            rec[key] = value

        if source not in rec["_sources"]:
            rec["_sources"].append(source)

    def set_override(self, fio_key: str, field: str, value: str) -> None:
        self.overrides.setdefault(fio_key, {})[field] = value
        if fio_key in self.records:
            self.records[fio_key][field] = value

    @staticmethod
    def preview_html_key(template: Path) -> str:
        return f"_preview_html:{template.resolve()}"

    def get_preview_html(self, fio_key: str, template: Path) -> str | None:
        return self.overrides.get(fio_key, {}).get(self.preview_html_key(template))

    def set_preview_html(self, fio_key: str, template: Path, html: str) -> None:
        self.overrides.setdefault(fio_key, {})[self.preview_html_key(template)] = html

    def clear_preview_html(self, fio_key: str, template: Path) -> None:
        self.overrides.get(fio_key, {}).pop(self.preview_html_key(template), None)

    @staticmethod
    def _template_layout_key(template: Path) -> str:
        return str(template.resolve())

    def get_template_layout_entry(self, template: Path) -> dict[str, Any] | None:
        layouts = self.meta.get("template_layouts") or {}
        raw = layouts.get(self._template_layout_key(template))
        if not raw:
            return None
        if isinstance(raw, dict):
            return raw
        return {"html": str(raw), "baseline": None}

    def get_template_layout_html(self, template: Path) -> str | None:
        entry = self.get_template_layout_entry(template)
        if not entry:
            return None
        html = entry.get("html")
        return str(html) if html else None

    def set_template_layout_html(
        self,
        template: Path,
        html: str,
        *,
        baseline: list[str] | None = None,
    ) -> None:
        layouts = self.meta.setdefault("template_layouts", {})
        layouts[self._template_layout_key(template)] = {
            "html": html,
            "baseline": list(baseline or []),
        }

    def clear_template_layout_html(self, template: Path) -> None:
        layouts = self.meta.get("template_layouts")
        if layouts:
            layouts.pop(self._template_layout_key(template), None)

    @staticmethod
    def _append_record_fields(payload: dict[str, str], record: dict[str, Any]) -> None:
        for key, value in record.items():
            if key.startswith("_") or value is None:
                continue
            text = str(value).strip()
            if text and key not in payload:
                payload[key] = text

    def get_merge_payload(self, fio_key: str) -> dict[str, str]:
        record = dict(self.records.get(fio_key, {}))
        record.update(self.overrides.get(fio_key, {}))
        finalize_names(record)
        if not record.get("группа_год"):
            computed = _compute_group_admission_year(record.get("Группа"))
            if computed:
                record["группа_год"] = computed

        payload: dict[str, str] = {}
        for field in MERGE_FIELDS:
            if record.get(field):
                payload[field] = str(record[field])
        for field in DIPLOMA_FIELDS:
            if record.get(field):
                payload[field] = str(record[field])
        for field in all_custom_names():
            if record.get(field):
                payload[field] = str(record[field])
        if record.get("_fio") and "Фамилия_имя_отчество" not in payload:
            payload["Фамилия_имя_отчество"] = record["_fio"]
        if record.get("F2") and "F2" not in payload:
            payload["F2"] = str(record["F2"])
        self._append_record_fields(payload, record)
        # Алиасы для подписи полей из v2-шаблона протокола.
        _V2_ALIASES = {
            "КоличествоСтраниц": ("ВКР",),
            "Изделие": ("Готовое_изделие",),
            "ОтзывРуководителя": ("Отзыв_руководителя",),
            "ОтзывРец": ("Рецензия_замечания",),
            "Достоинства": ("Рецензия_достоинства",),
            "Уровень_знаний": ("Уровень_знаний",),
            "ГрафЧасть": ("ГрафЧасть", "Графическая_часть"),
            "Фамилия_имя_отчество_в_Родит_п": (
                "Фамилия_имя_отчество_в_Родит_п",
                "Фамилия_имя_отчество_РП",
                "ФИО_РП",
            ),
            "Руководитель_Рп": ("Руководитель_РП", "Руководитель_в_Родит_п"),
        }
        for alias, sources in _V2_ALIASES.items():
            if payload.get(alias):
                continue
            for src in sources:
                value = record.get(src) or payload.get(src)
                if value:
                    payload[alias] = str(value)
                    break
        for name, value in _commission_fields().items():
            payload.setdefault(name, value)
        return payload

    def get_preview_payload(self, fio_key: str) -> dict[str, str]:
        record = dict(self.records.get(fio_key, {}))
        record.update(self.overrides.get(fio_key, {}))
        finalize_names(record)
        if not record.get("группа_год"):
            computed = _compute_group_admission_year(record.get("Группа"))
            if computed:
                record["группа_год"] = computed

        payload: dict[str, str] = {}
        for field in PREVIEW_FIELDS:
            if record.get(field):
                payload[field] = str(record[field])
        if record.get("_fio") and "Фамилия_имя_отчество" not in payload:
            payload["Фамилия_имя_отчество"] = record["_fio"]
        if record.get("F2") and "F2" not in payload:
            payload["F2"] = str(record["F2"])
        self._append_record_fields(payload, record)
        for name, value in _commission_fields().items():
            payload.setdefault(name, value)
        return payload

    def get_diploma_form(self, fio_key: str) -> dict[str, str]:
        rec = self.records.get(fio_key, {})
        ov = self.overrides.get(fio_key, {})
        merged = {**rec, **ov}
        extra_text_keys = ("БаллДемо", "оценкаДемо", "оценкаДиплом", "ГИА", "Дата_ДЭ")
        return {
            "fio": merged.get("_fio") or merged.get("Фамилия_имя_отчество") or "",
            "pages": _strip_pages_prefix(merged.get("ВКР", "")),
            "graph_pages": _strip_pages_prefix(merged.get("ГрафЧасть", "")),
            "Вопросы": str(merged.get("Вопросы", "") or ""),
            **{f: str(merged.get(f, "") or "") for f in DIPLOMA_FIELDS},
            **{k: str(merged.get(k, "") or "") for k in extra_text_keys},
        }

    def list_students(self) -> list[dict[str, Any]]:
        result = []
        for key, rec in sorted(self.records.items(), key=lambda x: x[1].get("_fio", "")):
            result.append(
                {
                    "id": key,
                    "fio": rec.get("_fio", ""),
                    "sources": rec.get("_sources", []),
                    "fields_filled": sum(1 for f in MERGE_FIELDS if rec.get(f)),
                    "merge": self.get_merge_payload(key),
                }
            )
        return result

    def sheets_in_file(self, path: Path) -> list[str]:
        return list_sheet_names(path)
