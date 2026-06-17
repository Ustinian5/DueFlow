from __future__ import annotations

import hashlib
from pathlib import Path


SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf"}


def normalize_content(content: str) -> str:
    lines = content.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.rstrip() for line in lines).strip()


def content_hash(content: str) -> str:
    return hashlib.sha256(normalize_content(content).encode("utf-8")).hexdigest()


def parse_file(path: str | Path) -> str:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {suffix}")
    if suffix in {".txt", ".md"}:
        return file_path.read_text(encoding="utf-8")
    return parse_pdf(file_path)


def parse_pdf(path: Path) -> str:
    try:
        import pdfplumber  # type: ignore

        with pdfplumber.open(path) as pdf:
            pages = [page.extract_text() or "" for page in pdf.pages]
        return normalize_content("\n".join(pages))
    except ModuleNotFoundError:
        pass
    except Exception:
        pass

    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        return normalize_content("\n".join(page.extract_text() or "" for page in reader.pages))
    except ModuleNotFoundError as exc:
        raise RuntimeError("PDF parsing requires pdfplumber or pypdf") from exc


def is_supported_file(path: str | Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS
