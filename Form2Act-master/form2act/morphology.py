from __future__ import annotations

import re

try:
    import pymorphy3

    _MORPH = pymorphy3.MorphAnalyzer()
except ImportError:
    _MORPH = None


def _cap(word: str) -> str:
    if not word:
        return word
    if word.isupper() and len(word) <= 3:
        return word
    return word[0].upper() + word[1:]


def _inflect_word(word: str, case: str = "gent") -> str:
    if not word or not _MORPH:
        return word
    parsed = _MORPH.parse(word)
    if not parsed:
        return word
    for p in parsed:
        if "Name" in p.tag or "Surn" in p.tag:
            form = p.inflect({case})
            if form:
                return _cap(form.word)
    form = parsed[0].inflect({case})
    if form:
        return _cap(form.word)
    return word


def _decline_surname(surname: str, female: bool = False) -> str:
    s = surname.strip()
    if not s:
        return s
    lower = s.lower()
    if female:
        if lower.endswith("ова"):
            return _cap(s[:-1] + "ой")
        if lower.endswith("ева"):
            return _cap(s[:-1] + "ой")
        if lower.endswith("ина"):
            return _cap(s[:-1] + "ой")
        if lower.endswith("ая"):
            return _cap(s[:-2] + "ой")
        return s
    if lower.endswith(("ко", "енко", "ёвко", "ук", "юк", "ич", "як")):
        return s
    if lower.endswith("ий"):
        return _cap(s[:-2] + "ия")
    if lower.endswith("ый"):
        return _cap(s[:-2] + "ого")
    if lower.endswith(("ов", "ев", "ин", "ын")):
        return _cap(s + "а")
    if lower.endswith("й") and len(s) > 3:
        return _cap(s[:-1] + "я")
    return s


def _decline_patronymic(patronymic: str) -> str:
    p = patronymic.strip()
    low = p.lower()
    if low.endswith("ович"):
        return _cap(p[:-4] + "овича")
    if low.endswith("евич"):
        return _cap(p[:-4] + "евича")
    if low.endswith("ич"):
        return _cap(p[:-2] + "ича")
    if low.endswith("овна"):
        return _cap(p[:-4] + "овны")
    if low.endswith("евна"):
        return _cap(p[:-4] + "евны")
    if low.endswith("ична"):
        return _cap(p[:-4] + "ичны")
    return _inflect_word(p)


def split_fio(fio: str) -> tuple[str, str, str]:
    parts = re.sub(r"\s+", " ", fio.strip()).split()
    if len(parts) >= 3:
        return parts[0], parts[1], " ".join(parts[2:])
    if len(parts) == 2:
        return parts[0], parts[1], ""
    if len(parts) == 1:
        return parts[0], "", ""
    return "", "", ""


def fio_to_genitive(
    fio: str,
    *,
    surname_rp: str = "",
    name_rp: str = "",
    patronymic_rp: str = "",
) -> str:
    if surname_rp or name_rp or patronymic_rp:
        parts = [_cap(surname_rp), _cap(name_rp), _cap(patronymic_rp)]
        return " ".join(p for p in parts if p).strip()

    fam, name, pat = split_fio(fio)
    if not fam:
        return fio

    female = pat.lower().endswith(("овна", "евна", "ична"))
    fam_g = _decline_surname(fam, female=female)
    name_g = _inflect_word(name) if name else ""
    pat_g = _decline_patronymic(pat) if pat else ""
    return " ".join(p for p in (fam_g, name_g, pat_g) if p)


def supervisor_to_genitive_short(full_name: str) -> str:
    fam, name, pat = split_fio(full_name)
    if not fam:
        return full_name
    fam_g = _decline_surname(fam)
    ini = ""
    if name:
        ini += name[0].upper() + "."
    if pat:
        ini += " " + pat[0].upper() + "."
    return f"{fam_g} {ini}".strip()


def split_fio_parts(fio: str) -> dict[str, str]:
    parts = [p for p in (fio or "").split() if p]
    out: dict[str, str] = {}
    if not parts:
        return out
    out["Фамилия"] = parts[0]
    if len(parts) > 1:
        out["Имя"] = parts[1]
    if len(parts) > 2:
        out["Отчество"] = " ".join(parts[2:])
    return out


def finalize_names(record: dict) -> dict:
    fio = record.get("_fio") or record.get("fio") or record.get("Фамилия_имя_отчество", "")
    if fio and not record.get("Фамилия_имя_отчество"):
        record["Фамилия_имя_отчество"] = fio
    for key, val in split_fio_parts(fio).items():
        record.setdefault(key, val)

    rp = (
        record.get("F2")
        or record.get("РП")
        or record.get("fio_rp")
        or record.get("ФИОвРП")
    )
    if not rp and fio:
        rp = fio_to_genitive(
            fio,
            surname_rp=record.get("ФамилияРП", ""),
            name_rp=record.get("ИмяРП", ""),
            patronymic_rp=record.get("ОтчествоРП", ""),
        )
    if rp:
        record["F2"] = rp.strip()

    ru = record.get("Руководитель", "")
    if ru and len(ru.split()) >= 3 and "." not in ru:
        record.setdefault("Руководитель_исходный", ru)
        if not record.get("Руководитель_from_template"):
            record["Руководитель"] = supervisor_to_genitive_short(ru)

    return record
