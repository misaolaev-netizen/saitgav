from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def libreoffice_available() -> bool:
    return bool(shutil.which("libreoffice") or shutil.which("soffice"))


def docx_bytes_to_pdf(docx_bytes: bytes) -> bytes | None:
    cmd = shutil.which("libreoffice") or shutil.which("soffice")
    if not cmd:
        return None
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        docx_path = td_path / "document.docx"
        docx_path.write_bytes(docx_bytes)
        subprocess.run(
            [
                cmd,
                "--headless",
                "--convert-to",
                "pdf",
                "--outdir",
                str(td_path),
                str(docx_path),
            ],
            check=True,
            capture_output=True,
            timeout=120,
        )
        pdf_path = td_path / "document.pdf"
        if not pdf_path.exists():
            return None
        return pdf_path.read_bytes()
