"""
Comprueba que get_owned_case_or_404() no deja que un doctor acceda a casos
de otro doctor: las rutas /cases/{case_id}/* verifican la propiedad del
caso, no solo el rol.

No se usa la red real: se sustituyen con monkeypatch las funciones que
hablan con Supabase (get_case_or_404, get_latest_prediction,
require_doctor_user) y la escritura del registro de acceso.

El guard vive en core.security y resuelve get_case_or_404 dentro de ese
mismo modulo, asi que es ahi donde hay que parchearlo aunque se importe
desde routers.cases.
"""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import core.security as security
import routers.cases as cases_router
from main import app


class DummyUser:
    def __init__(self, id):
        self.id = id


@pytest.fixture(autouse=True)
def no_real_audit_log(monkeypatch):
    monkeypatch.setattr(security, "log_case_access", lambda **kwargs: None)


# get_owned_case_or_404() en aislamiento

def test_owned_case_returns_case_for_owner(monkeypatch):
    fake_case = {"id": 1, "created_by_user_id": "user-a"}
    monkeypatch.setattr(security, "get_case_or_404", lambda case_id: fake_case)

    result = security.get_owned_case_or_404(1, "user-a")

    assert result == fake_case


def test_owned_case_blocks_non_owner(monkeypatch):
    fake_case = {"id": 1, "created_by_user_id": "user-a"}
    monkeypatch.setattr(security, "get_case_or_404", lambda case_id: fake_case)

    with pytest.raises(HTTPException) as exc_info:
        security.get_owned_case_or_404(1, "user-b")

    # 404 y no 403: no debe revelar si el caso existe
    assert exc_info.value.status_code == 404


def test_owned_case_propagates_not_found(monkeypatch):
    def raise_404(case_id):
        raise HTTPException(status_code=404, detail="Case no encontrado")

    monkeypatch.setattr(security, "get_case_or_404", raise_404)

    with pytest.raises(HTTPException) as exc_info:
        security.get_owned_case_or_404(999, "user-a")

    assert exc_info.value.status_code == 404


# GET /cases/{case_id} a traves del router de FastAPI

def _patch_case(monkeypatch, requester_id: str, owner_id: str):
    fake_case = {"id": 42, "created_by_user_id": owner_id}
    monkeypatch.setattr(
        cases_router,
        "require_doctor_user",
        lambda authorization: {
            "user": DummyUser(requester_id),
            "profile": {"role": "doctor"},
        },
    )
    # get_owned_case_or_404 resuelve get_case_or_404 en core.security.
    monkeypatch.setattr(security, "get_case_or_404", lambda case_id: fake_case)
    monkeypatch.setattr(cases_router, "get_latest_prediction", lambda case_id: None)


def test_get_case_endpoint_blocks_other_doctor(monkeypatch):
    _patch_case(monkeypatch, requester_id="attacker-id", owner_id="owner-id")

    client = TestClient(app)
    response = client.get("/cases/42", headers={"Authorization": "Bearer fake-token"})

    assert response.status_code == 404


def test_get_case_endpoint_allows_owner(monkeypatch):
    _patch_case(monkeypatch, requester_id="owner-id", owner_id="owner-id")

    client = TestClient(app)
    response = client.get("/cases/42", headers={"Authorization": "Bearer fake-token"})

    assert response.status_code == 200
    assert response.json()["case"]["id"] == 42
