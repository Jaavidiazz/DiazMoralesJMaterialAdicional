"""
Registro de acceso a casos clínicos: quién accede a qué caso y cuándo.

Es una traza mínima, no un sistema de auditoría con garantías legales.
Permite saber quién ha consultado o modificado un caso y detectar accesos
anómalos, como intentos repetidos contra casos de otros doctores.

Si falla la escritura del registro se ignora la excepción y se imprime un
aviso, para no interrumpir la petición real.
"""

from typing import Optional

from core.config import supabase


def log_case_access(case_id: int, user_id: str, action: str, allowed: bool) -> None:
    try:
        supabase.table("audit_log").insert([{
            "case_id": case_id,
            "user_id": user_id,
            "action": action,
            "allowed": allowed,
        }]).execute()
    except Exception as e:
        print(f"[WARN] No se pudo escribir en audit_log (case_id={case_id}, user_id={user_id}): {e}")


def log_admin_action(user_id: Optional[str], action: str, detail: Optional[str] = None) -> None:
    try:
        supabase.table("audit_log").insert([{
            "case_id": None,
            "user_id": user_id,
            "action": action,
            "allowed": True,
            "detail": detail,
        }]).execute()
    except Exception as e:
        print(f"[WARN] No se pudo escribir en audit_log (action={action}): {e}")
