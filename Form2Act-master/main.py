#!/usr/bin/env python3

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_DIR = ROOT / ".venv"
VENV_PY = VENV_DIR / "bin" / "python"


def _running_in_project_venv() -> bool:
    try:
        return Path(sys.prefix).resolve() == VENV_DIR.resolve()
    except Exception:
        return False


def _ensure_venv() -> None:
    if not VENV_PY.exists():
        return
    if _running_in_project_venv():
        return
    os.execv(str(VENV_PY), [str(VENV_PY), str(ROOT / "main.py"), *sys.argv[1:]])


_ensure_venv()

try:
    from app import app
    from form2act.reload import reload_all
    from form2act.store import DataStore
except ModuleNotFoundError as exc:
    print(
        "Не установлены зависимости.\n"
        "Выполните:\n"
        f"  {VENV_PY} -m pip install -r {ROOT / 'requirements.txt'}\n"
        f"  {VENV_PY} {ROOT / 'main.py'}\n",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc

if __name__ == "__main__":
    from app import store

    reload_all(store, use_templates=True)
    port = int(os.environ.get("PORT", "5000"))
    print(f"http://127.0.0.1:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
