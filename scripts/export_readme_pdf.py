from __future__ import annotations

from pathlib import Path
import sys
from textwrap import wrap

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> None:
    root = ROOT
    readme = root / "README.md"
    output = root / "README.pdf"
    if not readme.exists():
        raise SystemExit("README.md not found")

    try:
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.pdfgen import canvas
    except ModuleNotFoundError as exc:
        raise SystemExit("Install reportlab first: python -m pip install -r requirements.txt") from exc

    font_name = "Helvetica"
    for candidate in [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/simsun.ttc"),
    ]:
        if candidate.exists():
            pdfmetrics.registerFont(TTFont("DueFlowChinese", str(candidate)))
            font_name = "DueFlowChinese"
            break

    width, height = A4
    margin = 42
    line_height = 14
    y = height - margin
    pdf = canvas.Canvas(str(output), pagesize=A4)
    pdf.setTitle("DueFlow README")
    pdf.setFont(font_name, 10)

    for raw_line in readme.read_text(encoding="utf-8").splitlines():
        lines = wrap(raw_line, width=88, replace_whitespace=False) or [""]
        for line in lines:
            if y < margin:
                pdf.showPage()
                pdf.setFont(font_name, 10)
                y = height - margin
            pdf.drawString(margin, y, line)
            y -= line_height

    pdf.save()
    print(output)


if __name__ == "__main__":
    main()
