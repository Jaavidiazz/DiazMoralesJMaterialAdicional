import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

CLASIFICACION_LABELS = {
    "maligna": "Sospecha maligna",
    "benigna": "Aspecto benigno",
    "normal": "Estudio normal",
}


def _formatear_fecha(value) -> str:
    if not value:
        return "—"
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).strftime("%d/%m/%Y %H:%M")
    except Exception:
        return str(value)


def generar_informe_pdf(case: dict, report_text: str, clasificacion: str | None, confidence: float | None) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        title=f"Informe caso {case.get('id')}",
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "TitleBreastIA", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#0f172a")
    )
    subtitle_style = ParagraphStyle(
        "SubtitleBreastIA", parent=styles["Normal"], fontSize=10, textColor=colors.HexColor("#64748b")
    )
    body_style = ParagraphStyle(
        "BodyBreastIA", parent=styles["Normal"], fontSize=11, leading=16, spaceAfter=6
    )

    story = [
        Paragraph("BreastIA — Informe clínico", title_style),
        Paragraph(f"Caso #{case.get('id')} · Generado el {datetime.now().strftime('%d/%m/%Y %H:%M')}", subtitle_style),
        Spacer(1, 0.6 * cm),
    ]

    clasificacion_label = CLASIFICACION_LABELS.get((clasificacion or "").lower(), clasificacion or "—")
    confidence_label = f"{round(confidence * 100)}%" if confidence is not None else "—"

    data = [
        ["Paciente", case.get("patient") or "Desconocido"],
        ["Edad", f"{case['age']} años" if case.get("age") is not None else "—"],
        ["Lado", {"left": "Izquierda", "right": "Derecha"}.get(case.get("breast_side"), "—")],
        ["Fecha del estudio", _formatear_fecha(case.get("created_at"))],
        ["Resultado IA", clasificacion_label],
        ["Confianza del modelo", confidence_label],
    ]

    table = Table(data, colWidths=[5 * cm, 10 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
                ("TEXTCOLOR", (0, 0), (0, -1), colors.HexColor("#475569")),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 0.8 * cm))

    story.append(Paragraph("Informe", ParagraphStyle("H2", parent=styles["Heading2"], textColor=colors.HexColor("#0f172a"))))
    story.append(Spacer(1, 0.2 * cm))

    for paragraph in (report_text or "").split("\n"):
        if paragraph.strip():
            story.append(Paragraph(paragraph.strip(), body_style))
        else:
            story.append(Spacer(1, 0.2 * cm))

    story.append(Spacer(1, 1 * cm))
    story.append(
        Paragraph(
            "Este informe ha sido generado con apoyo de inteligencia artificial y debe ser validado "
            "por un profesional médico antes de cualquier decisión clínica.",
            ParagraphStyle("Disclaimer", parent=styles["Italic"], fontSize=8, textColor=colors.HexColor("#94a3b8")),
        )
    )

    doc.build(story)
    return buffer.getvalue()
