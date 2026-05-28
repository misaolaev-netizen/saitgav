from __future__ import annotations

import html as html_lib
import re

PLACEHOLDER_RE = re.compile(r"\{([^{}]+)\}")


def expand_merge_placeholders(merge: dict[str, str], *, max_pass: int = 10) -> dict[str, str]:
    result = {k: str(v) if v is not None else "" for k, v in merge.items()}
    for _ in range(max_pass):
        changed = False
        for key, value in list(result.items()):
            if "{" not in value:
                continue
            new_val = PLACEHOLDER_RE.sub(
                lambda m: result.get(m.group(1).strip(), m.group(0)),
                value,
            )
            if new_val != value:
                result[key] = new_val
                changed = True
        if not changed:
            break
    return result


def expand_placeholders_in_html(html: str, merge: dict[str, str]) -> str:
    expanded = expand_merge_placeholders(merge)

    def repl(match: re.Match[str]) -> str:
        key = match.group(1).strip()
        value = expanded.get(key)
        if value is None or str(value).strip() == "":
            return match.group(0)
        return html_lib.escape(str(value))

    return PLACEHOLDER_RE.sub(repl, html)
