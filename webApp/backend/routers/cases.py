import io
import os
from typing import Optional

from fastapi import APIRouter, File, Form, Header, HTTPException, Path, Request, Response, UploadFile
from PIL import Image

from core.config import supabase, UPLOAD_DIR, MAX_UPLOAD_SIZE_BYTES, ALLOWED_IMAGE_CONTENT_TYPES
from core.schemas import AnnotationCreate, ReportUpdateBody, VisibilidadBody
from core.security import (
    derived_asset_filename,
    ensure_image_exists,
    get_latest_prediction,
    get_owned_case_or_404,
    require_doctor_user,
    safe_float,
    save_image_to_dataset,
    unique_filename,
)
from core.model_service import generar_mapa_calor, generar_overlay, predecir_mama
from core.report_service import generar_informe_gemini
from core.pdf_service import generar_informe_pdf
from core.rate_limit import limiter

router = APIRouter(prefix="/cases", tags=["cases"])


def _validate_uploaded_image(file: UploadFile, image_bytes: bytes) -> None:
    if file.content_type not in ALLOWED_IMAGE_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Tipo de archivo no soportado ({file.content_type}). Solo se aceptan: {', '.join(sorted(ALLOWED_IMAGE_CONTENT_TYPES))}",
        )

    if len(image_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"La imagen supera el tamaño máximo permitido ({MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB)",
        )

    if len(image_bytes) == 0:
        raise HTTPException(status_code=400, detail="El archivo subido está vacío")


@router.get("/")
def list_cases(
    skip: int = 0,
    limit: int = 50,
    patient: Optional[str] = None,
    classification: Optional[str] = None,
    breast_side: Optional[str] = None,
    has_report: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    current_user_id = str(auth_data["user"].id)

    limit = max(1, min(limit, 200))
    skip = max(0, skip)

    query = (
        supabase
        .table("cases")
        .select("*", count="exact")
        .eq("created_by_user_id", current_user_id)
    )

    if patient:
        query = query.ilike("patient", f"%{patient}%")

    if breast_side:
        query = query.eq("breast_side", breast_side)

    if classification:
        query = query.eq("model_metadata->>clasificacion", classification)

    if has_report is not None:
        if has_report:
            query = query.not_.is_("report_text", "null")
        else:
            query = query.is_("report_text", "null")

    if date_from:
        query = query.gte("created_at", date_from)

    if date_to:
        query = query.lte("created_at", date_to)

    res = (
        query
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )

    cases = res.data or []
    total_count = res.count or 0
    items = []

    for case in cases:
        case_id = case["id"]
        pred = get_latest_prediction(case_id)

        items.append({
            "id": case_id,
            "patient": case.get("patient"),
            "age": case.get("age"),
            "breast_side": case.get("breast_side"),
            "doctor_comment": case.get("doctor_comment"),
            "image_url": case.get("image_url"),
            "report_visible": case.get("report_visible"),
            "report_text": case.get("report_text"),
            "created_at": case.get("created_at"),
            "classification": pred.get("classification") if pred else None,
            "prob_maligna": safe_float(pred.get("prob_maligna")) if pred else 0.0,
            "confidence": safe_float(pred.get("confidence")) if pred else safe_float(case.get("model_score")),
        })

    return {
        "items": items,
        "total_count": total_count,
        "skip": skip,
        "limit": limit,
        "has_more": skip + len(items) < total_count,
    }


@router.post("/")
@limiter.limit("20/minute")
async def create_case(
    request: Request,
    file: UploadFile = File(...),
    patient: Optional[str] = Form(None),
    age: Optional[int] = Form(None),
    breast_side: Optional[str] = Form(None),
    doctor_comment: Optional[str] = Form(None),
    authorization: Optional[str] = Header(default=None),
):
    from core.model_service import get_predictor

    auth_data = require_doctor_user(authorization)
    current_user_id = str(auth_data["user"].id)
    if get_predictor() is None:
        raise HTTPException(status_code=500, detail="El modelo Detectron2 no está cargado")

    image_bytes = await file.read()
    _validate_uploaded_image(file, image_bytes)

    try:
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="El archivo subido no es una imagen válida o es un formato no soportado.",
        )

    filename = unique_filename(file.filename)
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        f.write(image_bytes)

    prediccion = predecir_mama(image)

    prediccion_metadata = {
        "clasificacion": prediccion["clasificacion"],
        "prob_maligna": safe_float(prediccion["prob_maligna"]),
        "confidence": safe_float(prediccion["confidence"]),
        "raw_outputs": prediccion["raw_outputs"],
    }

    case_data = {
        "patient": patient,
        "age": age,
        "breast_side": breast_side,
        "doctor_comment": doctor_comment,
        "image_url": file_path,
        "storage_path": file_path,
        "storage_public_url": f"/uploads/{filename}",
        "model_score": safe_float(prediccion["confidence"]),
        "model_metadata": prediccion_metadata,
        "report_text": None,
        "report_visible": False,
        "created_by_user_id": current_user_id,
    }

    insert_res = supabase.table("cases").insert([case_data]).execute()
    if not insert_res.data:
        raise HTTPException(status_code=500, detail="No se pudo guardar el caso")

    saved_case = insert_res.data[0]
    case_id = saved_case["id"]

    save_image_to_dataset(image_bytes, file.filename or filename)

    prediction_data = {
        "case_id": case_id,
        "model_name": "detectron2",
        "classification": prediccion["clasificacion"],
        "prob_maligna": safe_float(prediccion["prob_maligna"]),
        "confidence": safe_float(prediccion["confidence"]),
        "raw_outputs": prediccion["raw_outputs"],
    }

    supabase.table("predictions").insert([prediction_data]).execute()

    # Solo generar overlay/heatmap si el estudio no es normal
    if prediccion.get("clasificacion", "").lower() != "normal":
        try:
            # Se regeneran siempre para que correspondan a la imagen actual.
            # El nombre se deriva del de la imagen original, no del id del
            # caso, para que no sea enumerable desde /uploads.
            overlay_filename = derived_asset_filename(filename, "_overlay", ".jpg")
            overlay_fs_path = os.path.join(UPLOAD_DIR, overlay_filename)
            generar_overlay(file_path, overlay_fs_path)

            heatmap_filename = derived_asset_filename(filename, "_heatmap", ".png")
            heatmap_fs_path = os.path.join(UPLOAD_DIR, heatmap_filename)
            generar_mapa_calor(file_path, heatmap_fs_path)
        except Exception as e:
            print(f"[WARN] Error generando overlay/heatmap para caso {case_id}: {e}")

    return {
        "case_id": case_id,
        "filename": filename,
        "clasificacion": prediccion["clasificacion"],
        "prob_maligna": prediccion["prob_maligna"],
        "confidence": prediccion["confidence"],
    }


@router.get("/{case_id}")
def get_case(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    case = get_owned_case_or_404(case_id, str(auth_data["user"].id))
    pred = get_latest_prediction(case_id)

    return {
        "case": case,
        "latest_prediction": pred,
    }


@router.post("/{case_id}/generate_report")
@limiter.limit("10/minute")
def generate_report(
    request: Request,
    case_id: int = Path(...),
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    case = get_owned_case_or_404(case_id, str(auth_data["user"].id), action="generate_report")

    image_path = case.get("image_url")
    if not image_path:
        raise HTTPException(status_code=400, detail="El caso no tiene imagen asociada")

    fs_path = ensure_image_exists(image_path)

    try:
        image = Image.open(fs_path).convert("RGB")
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"No se pudo abrir la imagen del caso: {e}"
        )

    try:
        datos_mama = predecir_mama(image)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error al procesar la imagen del caso: {e}"
        )

    datos_mama_metadata = {
        "clasificacion": datos_mama["clasificacion"],
        "prob_maligna": safe_float(datos_mama["prob_maligna"]),
        "confidence": safe_float(datos_mama["confidence"]),
        "raw_outputs": datos_mama["raw_outputs"],
    }

    report_text = generar_informe_gemini(datos_mama, case)

    update_res = (
        supabase
        .table("cases")
        .update({
            "model_score": safe_float(datos_mama["confidence"]),
            "model_metadata": datos_mama_metadata,
            "report_text": report_text,
            "report_visible": False,
        })
        .eq("id", case_id)
        .execute()
    )

    if not update_res.data:
        raise HTTPException(status_code=404, detail="Case no encontrado al actualizar")

    supabase.table("predictions").insert([{
        "case_id": case_id,
        "model_name": "detectron2",
        "classification": datos_mama["clasificacion"],
        "prob_maligna": safe_float(datos_mama["prob_maligna"]),
        "confidence": safe_float(datos_mama["confidence"]),
        "raw_outputs": datos_mama["raw_outputs"],
    }]).execute()

    updated_case = update_res.data[0]

    return {
        "case_id": updated_case["id"],
        "clasificacion": datos_mama["clasificacion"],
        "prob_maligna": safe_float(datos_mama["prob_maligna"]),
        "confidence": safe_float(datos_mama["confidence"]),
        "report_visible": updated_case["report_visible"],
        "report_preview": (
            report_text[:300] + "..."
            if report_text and len(report_text) > 300
            else report_text
        ),
    }


@router.get("/{case_id}/patient-history")
def get_patient_history(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    current_user_id = str(auth_data["user"].id)
    case = get_owned_case_or_404(case_id, current_user_id, action="read_patient_history")

    patient_name = (case.get("patient") or "").strip()
    if not patient_name:
        return {"patient": None, "cases": []}

    res = (
        supabase
        .table("cases")
        .select("*")
        .eq("created_by_user_id", current_user_id)
        .ilike("patient", patient_name)
        .order("created_at", desc=True)
        .execute()
    )

    cases = res.data or []
    items = []

    for c in cases:
        c_id = c["id"]
        pred = get_latest_prediction(c_id)
        meta = c.get("model_metadata") or {}

        items.append({
            "id": c_id,
            "created_at": c.get("created_at"),
            "breast_side": c.get("breast_side"),
            "classification": pred.get("classification") if pred else meta.get("clasificacion"),
            "prob_maligna": safe_float(pred.get("prob_maligna")) if pred else safe_float(meta.get("prob_maligna")),
            "confidence": safe_float(pred.get("confidence")) if pred else safe_float(c.get("model_score") or meta.get("confidence")),
            "has_report": bool(c.get("report_text")),
            "is_current": c_id == case_id,
        })

    return {"patient": patient_name, "cases": items}


@router.get("/{case_id}/details")
def get_case_details(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    case = get_owned_case_or_404(case_id, str(auth_data["user"].id))
    pred = get_latest_prediction(case_id)

    image_path = case.get("image_url")
    fs_path = ensure_image_exists(image_path)

    original_filename = os.path.basename(fs_path)
    original_rel_path = f"/uploads/{original_filename}"

    meta = case.get("model_metadata") or {}
    clasificacion_case = (pred.get("classification") if pred else meta.get("clasificacion") or "")
    es_normal = (clasificacion_case or "").lower() == "normal"

    overlay_rel_path: Optional[str] = None
    heatmap_rel_path: Optional[str] = None

    if not es_normal:
        # Nombre derivado del de la imagen original, no del id del caso
        # (mismo criterio que en create_case).
        overlay_filename = derived_asset_filename(original_filename, "_overlay", ".jpg")
        overlay_fs_path = os.path.join(UPLOAD_DIR, overlay_filename)
        overlay_rel_path = f"/uploads/{overlay_filename}"

        # Siempre regenerar overlay para garantizar que coincide con la imagen actual
        try:
            generar_overlay(fs_path, overlay_fs_path)
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error generando la imagen con predicción del modelo: {e}",
            )

        heatmap_filename = derived_asset_filename(original_filename, "_heatmap", ".png")
        heatmap_fs_path = os.path.join(UPLOAD_DIR, heatmap_filename)
        heatmap_rel_path = f"/uploads/{heatmap_filename}"

        # Siempre regenerar heatmap para garantizar que coincide con la imagen actual
        try:
            generar_mapa_calor(fs_path, heatmap_fs_path)
        except Exception as e:
            print(f"[WARN] Error generando mapa de calor para caso {case_id}: {e}")
            heatmap_rel_path = None

    prob_maligna = safe_float(pred.get("prob_maligna")) if pred else safe_float(meta.get("prob_maligna"))
    confidence = safe_float(pred.get("confidence")) if pred else safe_float(case.get("model_score") or meta.get("confidence"))

    return {
        "case_id": case_id,
        "clasificacion": clasificacion_case,
        "prob_maligna": prob_maligna,
        "confidence": confidence,
        "original_path": original_rel_path,
        "overlay_path": overlay_rel_path,
        "heatmap_path": heatmap_rel_path,
    }


@router.patch("/{case_id}/visibility")
def actualizar_visibilidad(
    case_id: int,
    body: VisibilidadBody,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    get_owned_case_or_404(case_id, str(auth_data["user"].id), action="update_visibility")

    res = (
        supabase
        .table("cases")
        .update({"report_visible": body.report_visible})
        .eq("id", case_id)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Case no encontrado")

    updated = res.data[0]
    return {
        "case_id": updated["id"],
        "report_visible": updated["report_visible"],
    }


@router.get("/{case_id}/report")
def obtener_informe(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    case = get_owned_case_or_404(case_id, str(auth_data["user"].id), action="read_report")

    if not case["report_text"]:
        raise HTTPException(status_code=400, detail="Este caso no tiene informe generado")

    return {
        "case_id": case["id"],
        "report_visible": case["report_visible"],
        "report_text": case["report_text"],
    }


@router.get("/{case_id}/report/pdf")
def exportar_informe_pdf(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    case = get_owned_case_or_404(case_id, str(auth_data["user"].id), action="export_report_pdf")

    if not case.get("report_text"):
        raise HTTPException(status_code=400, detail="Este caso no tiene informe generado")

    pred = get_latest_prediction(case_id)
    meta = case.get("model_metadata") or {}
    clasificacion = pred.get("classification") if pred else meta.get("clasificacion")
    confidence = safe_float(pred.get("confidence")) if pred else safe_float(case.get("model_score") or meta.get("confidence"))

    pdf_bytes = generar_informe_pdf(case, case["report_text"], clasificacion, confidence)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="informe_caso_{case_id}.pdf"',
        },
    )


@router.patch("/{case_id}/report")
def actualizar_informe(
    case_id: int,
    body: ReportUpdateBody,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    get_owned_case_or_404(case_id, str(auth_data["user"].id), action="update_report")

    report_text = (body.report_text or "").strip()

    if not report_text:
        raise HTTPException(status_code=400, detail="El informe no puede estar vacío")

    res = (
        supabase
        .table("cases")
        .update({"report_text": report_text})
        .eq("id", case_id)
        .execute()
    )

    if not res.data:
        raise HTTPException(status_code=404, detail="Case no encontrado")

    updated = res.data[0]

    return {
        "case_id": updated["id"],
        "report_text": updated["report_text"],
        "report_visible": updated["report_visible"],
    }


@router.get("/{case_id}/predictions")
def get_case_predictions(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    get_owned_case_or_404(case_id, str(auth_data["user"].id), action="read_predictions")

    res = (
        supabase
        .table("predictions")
        .select("*")
        .eq("case_id", case_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []


@router.post("/{case_id}/annotations")
def create_annotation(
    case_id: int,
    body: AnnotationCreate,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    get_owned_case_or_404(case_id, str(auth_data["user"].id), action="create_annotation")

    annotation_data = {
        "case_id": case_id,
        "is_correct": body.is_correct,
        "final_label": body.final_label,
        "final_category_id": body.final_category_id,
        "bbox": body.bbox,
        "notes": body.notes,
    }

    res = supabase.table("annotations").insert([annotation_data]).execute()

    if not res.data:
        raise HTTPException(status_code=500, detail="No se pudo guardar la anotación")

    return res.data[0]


@router.get("/{case_id}/annotations")
def list_annotations(
    case_id: int,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_doctor_user(authorization)
    get_owned_case_or_404(case_id, str(auth_data["user"].id), action="read_annotations")

    res = (
        supabase
        .table("annotations")
        .select("*")
        .eq("case_id", case_id)
        .order("created_at", desc=True)
        .execute()
    )

    return res.data or []
