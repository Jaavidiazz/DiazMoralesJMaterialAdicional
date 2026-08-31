from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request

from core.config import supabase
from core.security import require_admin_user
from core.schemas import AdminUserCreate
from core.audit import log_admin_action
from core.rate_limit import limiter

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("")
def list_admin_users(
    authorization: Optional[str] = Header(default=None),
):
    require_admin_user(authorization)

    try:
        res = (
            supabase
            .table("profiles")
            .select("id, full_name, role, created_at")
            .order("created_at", desc=True)
            .execute()
        )

        return res.data or []
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo usuarios: {e}",
        )


@router.post("")
@limiter.limit("10/minute")
def create_admin_user(
    request: Request,
    body: AdminUserCreate,
    authorization: Optional[str] = Header(default=None),
):
    auth_data = require_admin_user(authorization)

    full_name = (body.full_name or "").strip()
    email = (body.email or "").strip().lower()
    password = (body.password or "").strip()
    role = (body.role or "").strip().lower()

    if not full_name or not email or not password or not role:
        raise HTTPException(
            status_code=400,
            detail="Todos los campos son obligatorios",
        )

    if role not in ["doctor", "admin"]:
        raise HTTPException(status_code=400, detail="Rol no válido")

    try:
        created_user_response = supabase.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "full_name": full_name,
                    "role": role,
                },
            }
        )

        created_user = getattr(created_user_response, "user", None)

        if not created_user:
            raise HTTPException(
                status_code=500,
                detail="No se pudo crear el usuario en Supabase Auth",
            )

        new_user_id = created_user.id

        insert_profile_res = (
            supabase
            .table("profiles")
            .insert(
                [{
                    "id": new_user_id,
                    "full_name": full_name,
                    "role": role,
                }]
            )
            .execute()
        )

        if not insert_profile_res.data:
            try:
                supabase.auth.admin.delete_user(new_user_id)
            except Exception:
                pass

            raise HTTPException(
                status_code=500,
                detail="No se pudo crear el perfil del usuario en profiles",
            )

        log_admin_action(
            user_id=str(auth_data["user"].id),
            action="create_user",
            detail=f"created_user_id={new_user_id} role={role}",
        )

        return {
            "message": "Usuario creado correctamente",
            "user": {
                "id": new_user_id,
                "email": email,
                "full_name": full_name,
                "role": role,
            },
            "profile": insert_profile_res.data[0],
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error creando usuario: {e}",
        )
