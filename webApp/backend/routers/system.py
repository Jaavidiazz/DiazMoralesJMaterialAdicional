from fastapi import APIRouter, HTTPException

from core.config import SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL
from core.model_service import get_predictor
from core.report_service import _llamar_gemini_con_reintentos

router = APIRouter()


@router.get("/")
def root():
    return {"message": "Backend OK"}


@router.get("/health")
def health():
    return {
        "status": "ok",
        "supabase": bool(SUPABASE_URL and SUPABASE_SERVICE_KEY),
        "gemini": bool(GEMINI_API_KEY),
        "gemini_primary_model": GEMINI_PRIMARY_MODEL,
        "gemini_fallback_model": GEMINI_FALLBACK_MODEL,
        "detectron_loaded": get_predictor() is not None,
    }


@router.get("/test-gemini")
def test_gemini():
    errores = []

    try:
        text = _llamar_gemini_con_reintentos(
            prompt="Responde solo con: Gemini OK",
            model_name=GEMINI_PRIMARY_MODEL,
            max_retries=2,
        )
        return {
            "ok": True,
            "model": GEMINI_PRIMARY_MODEL,
            "response": text,
        }
    except Exception as e:
        errores.append(f"{GEMINI_PRIMARY_MODEL}: {str(e)}")

    try:
        text = _llamar_gemini_con_reintentos(
            prompt="Responde solo con: Gemini OK",
            model_name=GEMINI_FALLBACK_MODEL,
            max_retries=1,
        )
        return {
            "ok": True,
            "model": GEMINI_FALLBACK_MODEL,
            "response": text,
        }
    except Exception as e:
        errores.append(f"{GEMINI_FALLBACK_MODEL}: {str(e)}")

    raise HTTPException(
        status_code=503,
        detail="Gemini no respondió correctamente. " + " | ".join(errores),
    )
