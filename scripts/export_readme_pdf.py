from __future__ import annotations

from html import escape
from pathlib import Path
import re
import sys
from textwrap import wrap

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


LINK_PATTERN = re.compile(r"\[([^]]+)]\(([^)]+)\)")
INLINE_CODE_PATTERN = re.compile(r"`([^`]+)`")
BOLD_PATTERN = re.compile(r"\*\*([^*]+)\*\*")


def _register_unicode_font(pdfmetrics, TTFont) -> str:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
        Path("/System/Library/Fonts/STHeiti Medium.ttc"),
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/simsun.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
    ]
    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont("DueFlowUnicode", str(candidate)))
            return "DueFlowUnicode"
        except Exception:
            continue
    return "Helvetica"


def _inline_markup(text: str, code_font: str) -> str:
    value = escape(text.strip())
    value = LINK_PATTERN.sub(
        lambda match: (
            f'<link href="{escape(match.group(2), quote=True)}" color="#d83b52">'
            f"{match.group(1)}</link>"
        ),
        value,
    )
    value = INLINE_CODE_PATTERN.sub(
        lambda match: f'<font name="{code_font}" color="#334155">{match.group(1)}</font>',
        value,
    )
    return BOLD_PATTERN.sub(r"<b>\1</b>", value)


def _wrap_code(block: list[str], width: int = 86) -> str:
    wrapped: list[str] = []
    for line in block:
        pieces = wrap(
            line,
            width=width,
            replace_whitespace=False,
            drop_whitespace=False,
            subsequent_indent="  ",
        )
        wrapped.extend(pieces or [""])
    return "\n".join(wrapped)


def _markdown_story(lines, *, styles, Paragraph, Spacer, Preformatted, Table, TableStyle, colors):
    story = []
    paragraph: list[str] = []
    code_block: list[str] = []
    table_rows: list[list[str]] = []
    in_code = False

    def flush_paragraph() -> None:
        if paragraph:
            text = " ".join(part.strip() for part in paragraph if part.strip())
            if text:
                story.append(Paragraph(_inline_markup(text, styles["code"].fontName), styles["body"]))
                story.append(Spacer(1, 5))
            paragraph.clear()

    def flush_code() -> None:
        if code_block:
            story.append(Preformatted(_wrap_code(code_block), styles["code"]))
            story.append(Spacer(1, 8))
            code_block.clear()

    def flush_table() -> None:
        if not table_rows:
            return
        rows = [row for row in table_rows if not all(re.fullmatch(r"[-: ]+", cell) for cell in row)]
        if rows:
            column_count = max(len(row) for row in rows)
            normalized = [row + [""] * (column_count - len(row)) for row in rows]
            rendered = [
                [Paragraph(_inline_markup(cell, styles["code"].fontName), styles["table"]) for cell in row]
                for row in normalized
            ]
            widths = [250 / column_count] * column_count
            if column_count == 2:
                widths = [180, 330]
            table = Table(rendered, colWidths=widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 7),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                        ("TOPPADDING", (0, 0), (-1, -1), 5),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ]
                )
            )
            story.extend([table, Spacer(1, 10)])
        table_rows.clear()

    for raw_line in lines:
        line = raw_line.rstrip()
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_paragraph()
            flush_table()
            if in_code:
                flush_code()
            in_code = not in_code
            continue
        if in_code:
            code_block.append(line)
            continue

        if stripped.startswith("|") and stripped.endswith("|"):
            flush_paragraph()
            table_rows.append([cell.strip() for cell in stripped.strip("|").split("|")])
            continue
        flush_table()

        if not stripped:
            flush_paragraph()
            continue
        if stripped.startswith("<"):
            flush_paragraph()
            continue

        heading = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            story.append(Spacer(1, 6 if level == 2 else 3))
            story.append(
                Paragraph(
                    _inline_markup(heading.group(2), styles["code"].fontName),
                    styles[f"h{level}"],
                )
            )
            story.append(Spacer(1, 4))
            continue

        image = re.match(r"^!\[([^]]*)]\(([^)]+)\)$", stripped)
        if image:
            flush_paragraph()
            story.append(Paragraph(f"<i>{escape(image.group(1))}</i>", styles["caption"]))
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            story.append(
                Paragraph(
                    _inline_markup(stripped.lstrip("> "), styles["code"].fontName),
                    styles["quote"],
                )
            )
            story.append(Spacer(1, 5))
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            flush_paragraph()
            story.append(
                Paragraph(
                    _inline_markup(bullet.group(1), styles["code"].fontName),
                    styles["bullet"],
                    bulletText="•",
                )
            )
            continue

        paragraph.append(stripped)

    flush_paragraph()
    flush_table()
    flush_code()
    return story


def main() -> None:
    readme = ROOT / "README.md"
    output = ROOT / "README.pdf"
    if not readme.exists():
        raise SystemExit("README.md not found")

    try:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_CENTER
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import (
            Image,
            PageBreak,
            Paragraph,
            Preformatted,
            SimpleDocTemplate,
            Spacer,
            Table,
            TableStyle,
        )
    except ModuleNotFoundError as exc:
        raise SystemExit("Install reportlab first: python -m pip install -r requirements.txt") from exc

    body_font = _register_unicode_font(pdfmetrics, TTFont)
    code_font = "Courier"
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle(
            "DueFlowTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=30,
            leading=34,
            textColor=colors.HexColor("#111827"),
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "subtitle": ParagraphStyle(
            "DueFlowSubtitle",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=12,
            leading=17,
            textColor=colors.HexColor("#475569"),
            alignment=TA_CENTER,
        ),
        "h2": ParagraphStyle(
            "DueFlowH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=17,
            leading=21,
            textColor=colors.HexColor("#111827"),
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "DueFlowH3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=17,
            textColor=colors.HexColor("#1f2937"),
            keepWithNext=True,
        ),
        "h4": ParagraphStyle(
            "DueFlowH4",
            parent=base["Heading4"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=colors.HexColor("#334155"),
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "DueFlowBody",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=9.2,
            leading=13.4,
            textColor=colors.HexColor("#334155"),
        ),
        "bullet": ParagraphStyle(
            "DueFlowBullet",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=9,
            leading=12.8,
            leftIndent=15,
            firstLineIndent=-7,
            bulletIndent=2,
            textColor=colors.HexColor("#334155"),
            spaceAfter=2,
        ),
        "quote": ParagraphStyle(
            "DueFlowQuote",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=9.2,
            leading=13.5,
            leftIndent=13,
            borderWidth=0,
            borderColor=colors.HexColor("#ff5b6c"),
            borderPadding=(4, 8, 4, 9),
            backColor=colors.HexColor("#f8fafc"),
            textColor=colors.HexColor("#334155"),
        ),
        "code": ParagraphStyle(
            "DueFlowCode",
            parent=base["Code"],
            fontName=code_font,
            fontSize=7.4,
            leading=9.6,
            leftIndent=8,
            rightIndent=8,
            borderPadding=8,
            backColor=colors.HexColor("#f1f5f9"),
            textColor=colors.HexColor("#0f172a"),
            spaceBefore=3,
            spaceAfter=3,
        ),
        "table": ParagraphStyle(
            "DueFlowTable",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=7.8,
            leading=10.5,
            textColor=colors.HexColor("#334155"),
        ),
        "caption": ParagraphStyle(
            "DueFlowCaption",
            parent=base["BodyText"],
            fontName=body_font,
            fontSize=8,
            leading=10,
            textColor=colors.HexColor("#64748b"),
            alignment=TA_CENTER,
            spaceAfter=6,
        ),
        "cta": ParagraphStyle(
            "DueFlowCTA",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=15,
            alignment=TA_CENTER,
            textColor=colors.white,
        ),
    }

    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="DueFlow README",
        author="DueFlow contributors",
        subject="Local-first deadline planning",
    )

    story = [Spacer(1, 6 * mm)]
    icon = ROOT / "desktop" / "src-tauri" / "icons" / "128x128@2x.png"
    if icon.is_file():
        story.extend([Image(str(icon), width=22 * mm, height=22 * mm), Spacer(1, 4 * mm)])
    story.extend(
        [
            Paragraph("DueFlow", styles["title"]),
            Paragraph(
                "Turn scattered deadline information into an actionable schedule - locally.",
                styles["subtitle"],
            ),
            Spacer(1, 4 * mm),
        ]
    )

    cta = Paragraph(
        '<link href="https://ustinian5.github.io/DueFlow/#demo" color="#ffffff">'
        "Open the 60-second browser sample</link>",
        styles["cta"],
    )
    cta_box = Table([[cta]], colWidths=[110 * mm], hAlign="CENTER")
    cta_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#e4475b")),
                ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#d83b52")),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    story.extend([cta_box, Spacer(1, 5 * mm)])

    screenshot = ROOT / "docs" / "images" / "browser-sample-en.png"
    if screenshot.is_file():
        story.append(Image(str(screenshot), width=174 * mm, height=127.7 * mm))
        story.append(Spacer(1, 2 * mm))
    story.extend(
        [
            Paragraph(
                "After the first visit, the sample also works offline. Copy the plan or download a standard .ics "
                "calendar; no signup, API key, or upload is required.",
                styles["caption"],
            ),
            PageBreak(),
        ]
    )

    source_lines = readme.read_text(encoding="utf-8").splitlines()
    try:
        start = next(index for index, line in enumerate(source_lines) if line.strip() == "## Why DueFlow")
    except StopIteration:
        start = 0
    story.extend(
        _markdown_story(
            source_lines[start:],
            styles=styles,
            Paragraph=Paragraph,
            Spacer=Spacer,
            Preformatted=Preformatted,
            Table=Table,
            TableStyle=TableStyle,
            colors=colors,
        )
    )

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
        canvas.setLineWidth(0.5)
        canvas.line(18 * mm, 13 * mm, A4[0] - 18 * mm, 13 * mm)
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(18 * mm, 8.5 * mm, "DueFlow - MIT licensed - github.com/Ustinian5/DueFlow")
        canvas.drawRightString(A4[0] - 18 * mm, 8.5 * mm, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    print(output)


if __name__ == "__main__":
    main()
