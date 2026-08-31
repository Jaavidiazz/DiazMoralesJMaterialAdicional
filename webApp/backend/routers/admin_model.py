import os
import time
from typing import Optional

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile
from detectron2.config import get_cfg

from core.config import CFG_PATH, WEIGHTS_PATH, MODEL_DIR, MAX_MODEL_WEIGHTS_SIZE_BYTES, MAX_MODEL_CFG_SIZE_BYTES
from core.security import require_admin_user
from core.model_service import get_predictor, load_predictor
import core.model_service as model_service
from core.audit import log_admin_action
from core.rate_limit import limiter

router = APIRouter(prefix="/admin/model", tags=["admin-model"])


@router.get("/status")
def get_model_status(
    authorization: Optional[str] = Header(default=None),
):
    require_admin_user(authorization)

    cfg_exists = os.path.exists(CFG_PATH)
    weights_exists = os.path.exists(WEIGHTS_PATH)

    cfg_info = None
    if cfg_exists:
        stat = os.stat(CFG_PATH)
        cfg_info = {
            "filename": os.path.basename(CFG_PATH),
            "size_kb": round(stat.st_size / 1024, 2),
            "last_modified": stat.st_mtime,
        }

    weights_info = None
    if weights_exists:
        stat = os.stat(WEIGHTS_PATH)
        weights_info = {
            "filename": os.path.basename(WEIGHTS_PATH),
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "last_modified": stat.st_mtime,
        }

    return {
        "predictor_loaded": get_predictor() is not None,
        "cfg_file": cfg_info,
        "weights_file": weights_info,
        "model_dir": MODEL_DIR,
    }


@router.get("/backups")
def get_model_backups(
    authorization: Optional[str] = Header(default=None),
):
    require_admin_user(authorization)

    backup_dir = os.path.join(MODEL_DIR, "backups")

    if not os.path.exists(backup_dir):
        return {"backups": []}

    entries = []
    for filename in os.listdir(backup_dir):
        filepath = os.path.join(backup_dir, filename)
        if not os.path.isfile(filepath):
            continue
        stat = os.stat(filepath)
        entries.append({
            "filename": filename,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "created_at": stat.st_mtime,
        })

    entries.sort(key=lambda x: x["created_at"], reverse=True)

    return {"backups": entries}


@router.post("/upload")
@limiter.limit("5/minute")
async def upload_model(
    request: Request,
    weights_file: UploadFile = File(..., description="Archivo de pesos del modelo (.pth)"),
    cfg_file: UploadFile = File(..., description="Archivo de configuración del modelo (.yaml)"),
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_admin_user(authorization)

    # --- Validar extensiones ---
    weights_name = weights_file.filename or ""
    cfg_name = cfg_file.filename or ""

    if not weights_name.endswith(".pth"):
        raise HTTPException(
            status_code=400,
            detail="El archivo de pesos debe tener extensión .pth",
        )

    if not (cfg_name.endswith(".yaml") or cfg_name.endswith(".yml")):
        raise HTTPException(
            status_code=400,
            detail="El archivo de configuración debe tener extensión .yaml",
        )

    # --- Validar el tamaño declarado en el header (el real se revalida
    # después, tras leer los bytes) ---
    if weights_file.size is not None and weights_file.size > MAX_MODEL_WEIGHTS_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo de pesos supera el tamaño máximo permitido ({MAX_MODEL_WEIGHTS_SIZE_BYTES // (1024*1024)} MB)",
        )

    if cfg_file.size is not None and cfg_file.size > MAX_MODEL_CFG_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo de configuración supera el tamaño máximo permitido ({MAX_MODEL_CFG_SIZE_BYTES // 1024} KB)",
        )

    # --- Crear carpeta de backups si no existe ---
    backup_dir = os.path.join(MODEL_DIR, "backups")
    os.makedirs(backup_dir, exist_ok=True)

    # --- Hacer backup de los archivos actuales ---
    timestamp = int(time.time())

    cfg_backup_path = None
    weights_backup_path = None

    if os.path.exists(CFG_PATH):
        cfg_backup_path = os.path.join(backup_dir, f"detectron.cfg.{timestamp}.yaml")
        os.replace(CFG_PATH, cfg_backup_path)

    if os.path.exists(WEIGHTS_PATH):
        weights_backup_path = os.path.join(backup_dir, f"model_final.{timestamp}.pth")
        os.replace(WEIGHTS_PATH, weights_backup_path)

    # --- Validar que el YAML es un cfg de Detectron2 valido antes de escribirlo ---
    cfg_bytes = await cfg_file.read()
    if len(cfg_bytes) > MAX_MODEL_CFG_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"El archivo de configuración supera el tamaño máximo permitido ({MAX_MODEL_CFG_SIZE_BYTES // 1024} KB)",
        )

    try:
        test_cfg = get_cfg()
        test_cfg.merge_from_other_cfg(get_cfg().load_cfg(cfg_bytes.decode("utf-8")))
    except Exception as e:
        raise HTTPException(
            status_code=422,
            detail=f"El archivo de configuración no es un YAML de Detectron2 válido: {e}",
        )

    # --- Guardar nuevos archivos ---
    try:
        with open(CFG_PATH, "wb") as f:
            f.write(cfg_bytes)

        weights_bytes = await weights_file.read()
        if len(weights_bytes) > MAX_MODEL_WEIGHTS_SIZE_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"El archivo de pesos supera el tamaño máximo permitido ({MAX_MODEL_WEIGHTS_SIZE_BYTES // (1024*1024)} MB)",
            )

        with open(WEIGHTS_PATH, "wb") as f:
            f.write(weights_bytes)

    except HTTPException:
        if cfg_backup_path and os.path.exists(cfg_backup_path):
            os.replace(cfg_backup_path, CFG_PATH)
        if weights_backup_path and os.path.exists(weights_backup_path):
            os.replace(weights_backup_path, WEIGHTS_PATH)
        raise
    except Exception as e:
        # Si falla la escritura, restaurar backups
        if cfg_backup_path and os.path.exists(cfg_backup_path):
            os.replace(cfg_backup_path, CFG_PATH)
        if weights_backup_path and os.path.exists(weights_backup_path):
            os.replace(weights_backup_path, WEIGHTS_PATH)

        raise HTTPException(
            status_code=500,
            detail=f"Error guardando los archivos del modelo: {e}",
        )

    # --- Recargar predictor en caliente ---
    try:
        nuevo_predictor = load_predictor()

        if nuevo_predictor is None:
            raise RuntimeError("load_predictor() devolvió None tras cargar los nuevos archivos")

        model_service.predictor = nuevo_predictor

    except Exception as e:
        # Si el nuevo modelo falla al cargar, restaurar backups
        if cfg_backup_path and os.path.exists(cfg_backup_path):
            os.replace(cfg_backup_path, CFG_PATH)
        if weights_backup_path and os.path.exists(weights_backup_path):
            os.replace(weights_backup_path, WEIGHTS_PATH)

        # Intentar recargar el predictor con el modelo anterior
        try:
            model_service.predictor = load_predictor()
        except Exception:
            model_service.predictor = None

        raise HTTPException(
            status_code=422,
            detail=f"El modelo subido no es válido o no se pudo cargar: {e}",
        )

    # --- Respuesta de éxito ---
    cfg_stat = os.stat(CFG_PATH)
    weights_stat = os.stat(WEIGHTS_PATH)

    log_admin_action(
        user_id=str(auth_data["user"].id),
        action="upload_model",
        detail=f"cfg={os.path.basename(CFG_PATH)} weights={os.path.basename(WEIGHTS_PATH)}",
    )

    return {
        "message": "Modelo actualizado y cargado correctamente",
        "predictor_loaded": get_predictor() is not None,
        "cfg_file": {
            "filename": os.path.basename(CFG_PATH),
            "size_kb": round(cfg_stat.st_size / 1024, 2),
        },
        "weights_file": {
            "filename": os.path.basename(WEIGHTS_PATH),
            "size_mb": round(weights_stat.st_size / (1024 * 1024), 2),
        },
        "backup_created": cfg_backup_path is not None or weights_backup_path is not None,
    }
