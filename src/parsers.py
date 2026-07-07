from __future__ import annotations

import hashlib
import os
from pathlib import Path
import platform
import shlex
import subprocess
import tempfile
import textwrap


SUPPORTED_EXTENSIONS = {".txt", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}


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
    if suffix in IMAGE_EXTENSIONS:
        return parse_image(file_path)
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


def parse_image(path: Path) -> str:
    command = os.getenv("DUEFLOW_OCR_COMMAND", "").strip()
    if command:
        return _parse_image_with_command(path, command)
    if platform.system() == "Darwin":
        return _parse_image_with_macos_vision(path)
    raise RuntimeError("Image OCR requires DUEFLOW_OCR_COMMAND or macOS Vision")


def _parse_image_with_command(path: Path, command: str) -> str:
    resolved = str(path)
    if "{path}" in command:
        shell_command = command.replace("{path}", shlex.quote(resolved))
    else:
        shell_command = f"{command} {shlex.quote(resolved)}"
    result = subprocess.run(shell_command, shell=True, check=False, capture_output=True, text=True, timeout=30)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Image OCR command failed: {detail or result.returncode}")
    content = normalize_content(result.stdout)
    if not content:
        raise RuntimeError("Image OCR did not return text")
    return content


def _parse_image_with_macos_vision(path: Path) -> str:
    script = textwrap.dedent(
        """
        import AppKit
        import Foundation
        import Vision

        guard CommandLine.arguments.count == 2 else {
          fputs("missing image path\\n", stderr)
          exit(2)
        }

        let url = URL(fileURLWithPath: CommandLine.arguments[1])
        guard let image = NSImage(contentsOf: url) else {
          fputs("failed to load image\\n", stderr)
          exit(3)
        }
        var rect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
          fputs("failed to convert image\\n", stderr)
          exit(4)
        }

        var lines: [String] = []
        let request = VNRecognizeTextRequest { request, error in
          if let error = error {
            fputs(error.localizedDescription + "\\n", stderr)
            exit(5)
          }
          guard let observations = request.results as? [VNRecognizedTextObservation] else {
            return
          }
          for observation in observations {
            if let text = observation.topCandidates(1).first?.string {
              lines.append(text)
            }
          }
        }
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(macOS 11.0, *) {
          request.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
        }

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
          try handler.perform([request])
          print(lines.joined(separator: "\\n"))
        } catch {
          fputs(error.localizedDescription + "\\n", stderr)
          exit(6)
        }
        """
    )
    with tempfile.NamedTemporaryFile("w", suffix=".swift", encoding="utf-8", delete=False) as tmp:
        tmp.write(script)
        script_path = Path(tmp.name)
    try:
        result = subprocess.run(
            ["/usr/bin/swift", str(script_path), str(path)],
            check=False,
            capture_output=True,
            text=True,
            timeout=45,
        )
    finally:
        script_path.unlink(missing_ok=True)

    if result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"macOS Vision OCR failed: {detail or result.returncode}")
    content = normalize_content(result.stdout)
    if not content:
        raise RuntimeError("macOS Vision OCR did not return text")
    return content


def is_supported_file(path: str | Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS
