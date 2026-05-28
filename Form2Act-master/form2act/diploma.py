from __future__ import annotations

import re

from form2act.config import DIPLOMA_FIELDS, MERGE_FIELDS
from form2act.utils import normalize_fio


def format_pages(value: str) -> str:
    s = (value or "").strip()
    if not s:
        return ""
    if re.search(r"страниц", s, re.I):
        return s
    m = re.match(r"^(\d+)\s*$", s)
    if m:
        n = int(m.group(1))
        word = "странице" if n % 10 == 1 and n % 100 != 11 else "страницах"
        return f"на {n} {word}"
    return s


def build_diploma_merge(
    body: dict,
    store,
    *,
    student_id: str | None = None,
) -> tuple[str | None, dict[str, str]]:
    fio_key, data = diploma_payload_from_form(body)
    sid = student_id
    if not sid and store is not None and fio_key in store.records:
        sid = fio_key
    if sid and store is not None and sid in store.records:
        merge = dict(store.get_merge_payload(sid))
        merge.update(data)
    else:
        merge = data
        sid = None
    from form2act.merge_expand import expand_merge_placeholders

    return sid, expand_merge_placeholders(merge)


def diploma_payload_from_form(body: dict) -> tuple[str, dict[str, str]]:
    fio = (body.get("fio") or body.get("ФИО") or "").strip()
    if not fio:
        raise ValueError("Укажите ФИО")

    data: dict[str, str] = {"fio": fio, "Фамилия_имя_отчество": fio}

    pages = (body.get("pages") or "").strip()
    if pages:
        data["ВКР"] = format_pages(pages)

    graph = (body.get("graph_pages") or "").strip()
    if graph:
        data["ГрафЧасть"] = format_pages(graph)

    questions = (body.get("Вопросы") or "").strip()
    if questions:
        data["Вопросы"] = questions

    for key in DIPLOMA_FIELDS:
        val = (body.get(key) or "").strip()
        if val:
            data[key] = val

    return normalize_fio(fio), data


def preview_labels() -> dict[str, str]:
    return {
        "Протокол": "№ протокола",
        "Дата_защиты_диплома": "Дата защиты",
        "Дата_ДЭ": "Дата ДЭ",
        "Группа": "Группа",
        "группа_год": "Год поступления",
        "F2": "ФИО (род. падеж)",
        "Темы_дипломного_проекта": "Тема",
        "Руководитель": "Руководитель",
        "ВКР": "Объём ВКР",
        "ГрафЧасть": "Графическая часть",
        "Рецензент": "Рецензент",
        "Вопросы": "Вопросы комиссии",
        "Фамилия_имя_отчество": "ФИО",
        "БаллДемо": "Балл ДЭ",
        "оценкаДемо": "Оценка ДЭ",
        "оценкаДиплом": "Оценка диплома",
        "ГИА": "Итоговая оценка",
        "Рецензия_замечания": "Рецензия (замечания)",
        "Рецензия_достоинства": "Достоинства работы",
        "Отзыв_руководителя": "Отзыв руководителя",
        "Отзыв_руководителя_2": "Отзыв руководителя (развёрнутый)",
        "Готовое_изделие": "Готовое изделие",
        "Общая_оценка": "Общая оценка (защита)",
        "Уровень_знаний": "Уровень знаний",
    }


def all_storable_fields() -> list[str]:
    return list(dict.fromkeys([*MERGE_FIELDS, *DIPLOMA_FIELDS]))
