import os
import uuid
import zipfile
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import FileResponse

from core.config import supabase, DATASET_BUCKET, DATASET_PREFIX, TMP_DIR
from core.security import require_admin_user, list_dataset_files

router = APIRouter(prefix="/admin/dataset", tags=["admin-dataset"])


@router.get("/summary")
def get_dataset_summary(
    authorization: Optional[str] = Header(default=None),
):
    require_admin_user(authorization)

    files = list_dataset_files()

    filenames = [
        f["name"]
        for f in files
        if f.get("name") and not f["name"].startswith(".")
    ]

    return {
        "bucket": DATASET_BUCKET,
        "prefix": DATASET_PREFIX,
        "file_count": len(filenames),
        "filenames": filenames,
    }


@router.get("/download")
def download_dataset(
    authorization: Optional[str] = Header(default=None),
):
    require_admin_user(authorization)

    files = list_dataset_files()

    valid_files = [
        f["name"]
        for f in files
        if f.get("name") and not f["name"].startswith(".")
    ]

    if not valid_files:
        raise HTTPException(
            status_code=400,
            detail="No hay archivos en el dataset para descargar",
        )

    zip_filename = f"dataset_mamografias_{uuid.uuid4().hex}.zip"
    zip_path = os.path.join(TMP_DIR, zip_filename)

    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
            for filename in valid_files:
                storage_path = f"{DATASET_PREFIX}/{filename}"

                file_bytes = supabase.storage.from_(DATASET_BUCKET).download(storage_path)

                if not file_bytes:
                    print(f"[WARN] No se pudo descargar {storage_path}")
                    continue

                # Se escribe directo en el ZIP, sin fichero temporal, para
                # admitir nombres con subcarpetas.
                zipf.writestr(filename, file_bytes)

        return FileResponse(
            path=zip_path,
            filename="dataset_mamografias.zip",
            media_type="application/zip",
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generando ZIP del dataset: {e}",
        )
