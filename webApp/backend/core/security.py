from typing import Optional

from fastapi import HTTPException

from core.config import supabase
from core.audit import log_case_access


def safe_float(value, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except Exception:
        return default


def unique_filename(original_name: str) -> str:
    import os
    import uuid

    ext = os.path.splitext(original_name)[1].lower() or ".png"
    return f"{uuid.uuid4().hex}{ext}"


def derived_asset_filename(unique_original_filename: str, suffix: str, ext: str) -> str:
    """Nombre para un artefacto derivado (overlay, heatmap) de una imagen
    subida con unique_filename(). Se construye sobre el hash aleatorio del
    original y no sobre el id del caso: como /uploads no pide autenticación,
    un nombre secuencial se podría enumerar.
    """
    import os

    base = os.path.splitext(unique_original_filename)[0]
    return f"{base}{suffix}{ext}"


def save_image_to_dataset(image_bytes: bytes, original_filename: str) -> bool:
    """Copia una mamografía nueva al bucket de dataset para reentrenamiento.

    El nombre en storage es el hash SHA-256 del contenido, de modo que la
    misma imagen no se guarda dos veces (la subida falla con "Duplicate").
    No propaga excepciones: un fallo aquí no debe impedir crear el caso.
    """
    import hashlib
    import os

    from core.config import DATASET_BUCKET, DATASET_PREFIX

    content_types = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }

    ext = os.path.splitext(original_filename)[1].lower()
    if ext not in content_types:
        ext = ".png"

    digest = hashlib.sha256(image_bytes).hexdigest()
    storage_path = f"{DATASET_PREFIX}/{digest}{ext}"

    try:
        supabase.storage.from_(DATASET_BUCKET).upload(
            storage_path,
            image_bytes,
            {"content-type": content_types[ext]},
        )
        return True
    except Exception as e:
        print(f"[dataset] No se ha guardado {storage_path} en el dataset: {e}")
        return False


def ensure_image_exists(image_path: str) -> str:
    import os

    if not image_path:
        raise HTTPException(status_code=400, detail="El caso no tiene image_url")

    if not os.path.exists(image_path):
        raise HTTPException(
            status_code=404,
            detail=f"No se encontró la imagen en el servidor: {image_path}",
        )

    return image_path


def get_case_or_404(case_id: int) -> dict:
    res = (
        supabase
        .table("cases")
        .select("*")
        .eq("id", case_id)
        .single()
        .execute()
    )
    case = res.data
    if not case:
        raise HTTPException(status_code=404, detail="Case no encontrado")
    return case


def get_owned_case_or_404(case_id: int, user_id: str, action: str = "read") -> dict:
    case = get_case_or_404(case_id)
    if str(case.get("created_by_user_id")) != str(user_id):
        # 404 y no 403: no revelar si el caso existe
        log_case_access(case_id=case_id, user_id=user_id, action=action, allowed=False)
        raise HTTPException(status_code=404, detail="Case no encontrado")

    log_case_access(case_id=case_id, user_id=user_id, action=action, allowed=True)
    return case


def get_latest_prediction(case_id: int) -> Optional[dict]:
    res = (
        supabase
        .table("predictions")
        .select("*")
        .eq("case_id", case_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    data = res.data or []
    return data[0] if data else None


def get_profile_by_user_id(user_id: str) -> Optional[dict]:
    res = (
        supabase
        .table("profiles")
        .select("*")
        .eq("id", user_id)
        .single()
        .execute()
    )
    return res.data


def get_current_user_from_token(authorization: Optional[str]):
    if not authorization:
        raise HTTPException(status_code=401, detail="Falta el token de autorización")

    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Token de autorización inválido")

    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token vacío")

    try:
        user_response = supabase.auth.get_user(token)
        user = getattr(user_response, "user", None)

        if not user:
            raise HTTPException(status_code=401, detail="No se pudo identificar al usuario")

        return user
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {e}")


def require_admin_user(authorization: Optional[str]) -> dict:
    user = get_current_user_from_token(authorization)
    profile = get_profile_by_user_id(user.id)

    if not profile:
        raise HTTPException(status_code=404, detail="No se encontró el perfil del usuario")

    if profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="No autorizado")

    return {
        "user": user,
        "profile": profile,
    }


def require_doctor_user(authorization: Optional[str]) -> dict:
    user = get_current_user_from_token(authorization)
    profile = get_profile_by_user_id(user.id)

    if not profile:
        raise HTTPException(status_code=404, detail="No se encontró el perfil del usuario")

    if profile.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="No autorizado")

    return {
        "user": user,
        "profile": profile,
    }


def list_dataset_files() -> list:
    """Lista los ficheros bajo DATASET_PREFIX en el bucket del dataset.

    Recorre subcarpetas y pagina más allá del límite de 1000 elementos por
    llamada, para que el conteo refleje el contenido real del bucket. Cada
    entrada lleva "name" como ruta relativa a DATASET_PREFIX.
    """
    from core.config import DATASET_BUCKET, DATASET_PREFIX

    page_size = 1000

    def list_page(full_prefix: str, offset: int) -> list:
        return supabase.storage.from_(DATASET_BUCKET).list(
            full_prefix,
            {
                "limit": page_size,
                "offset": offset,
                "sortBy": {"column": "name", "order": "asc"},
            },
        ) or []

    def collect(relative_prefix: str) -> list:
        full_prefix = f"{DATASET_PREFIX}/{relative_prefix}" if relative_prefix else DATASET_PREFIX
        collected = []
        offset = 0

        while True:
            page = list_page(full_prefix, offset)
            if not page:
                break

            for entry in page:
                name = entry.get("name")
                if not name or name.startswith("."):
                    continue

                relative_name = f"{relative_prefix}/{name}" if relative_prefix else name
                is_folder = entry.get("id") is None and entry.get("metadata") is None

                if is_folder:
                    collected.extend(collect(relative_name))
                else:
                    collected.append({**entry, "name": relative_name})

            if len(page) < page_size:
                break
            offset += page_size

        return collected

    try:
        return collect("")
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo archivos del dataset: {e}",
        )
