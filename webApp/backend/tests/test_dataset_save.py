"""
Tests de save_image_to_dataset() (core/security.py): copia las mamografias
subidas por los doctores al bucket de dataset usado para reentrenar.

No se usa la red real: se sustituye con monkeypatch el cliente de Supabase
Storage por uno en memoria que registra las llamadas a upload() y simula el
error "Duplicate" que devuelve Supabase cuando el objeto ya existe.
"""

import hashlib

import pytest

import core.security as security


class FakeBucketAPI:
    """Sustituye a supabase.storage.from_(bucket): guarda en memoria."""

    def __init__(self):
        self.stored = set()
        self.calls = []

    def upload(self, path, file, file_options=None):
        self.calls.append((path, file_options))
        if path in self.stored:
            raise Exception(
                "{'statusCode': 400, 'error': Duplicate, 'message': The resource already exists}"
            )
        self.stored.add(path)
        return {"Key": path}


class FakeStorage:
    def __init__(self, bucket_api):
        self._bucket_api = bucket_api

    def from_(self, name):
        return self._bucket_api


class FakeSupabase:
    def __init__(self, bucket_api):
        self.storage = FakeStorage(bucket_api)


@pytest.fixture
def fake_bucket(monkeypatch):
    bucket = FakeBucketAPI()
    monkeypatch.setattr(security, "supabase", FakeSupabase(bucket))
    return bucket


def test_new_image_is_saved_to_dataset(fake_bucket):
    image_bytes = b"contenido-imagen-1"

    saved = security.save_image_to_dataset(image_bytes, "mamografia.png")

    assert saved is True
    assert len(fake_bucket.calls) == 1

    expected_digest = hashlib.sha256(image_bytes).hexdigest()
    path, options = fake_bucket.calls[0]
    assert path == f"dataset/{expected_digest}.png"
    assert options == {"content-type": "image/png"}


def test_same_image_content_is_not_duplicated(fake_bucket):
    image_bytes = b"contenido-imagen-repetido"

    first = security.save_image_to_dataset(image_bytes, "caso_a.png")
    # Mismo contenido con otro nombre de fichero: no debe volver a subirse.
    second = security.save_image_to_dataset(image_bytes, "caso_b.png")

    assert first is True
    assert second is False
    assert len(fake_bucket.calls) == 2  # se intenta, pero no se guarda dos veces
    assert len(fake_bucket.stored) == 1


def test_same_image_content_with_different_extension_is_treated_as_new(
    fake_bucket,
):
    # Limitacion conocida: el nombre es "{hash}.{extension}", asi que el
    # mismo contenido con otra extension no se detecta como duplicado. En la
    # practica un fichero conserva su extension al resubirse.
    image_bytes = b"contenido-imagen-repetido"

    first = security.save_image_to_dataset(image_bytes, "caso_a.png")
    second = security.save_image_to_dataset(image_bytes, "caso_b.jpg")

    assert first is True
    assert second is True
    assert len(fake_bucket.stored) == 2


def test_different_images_are_both_saved(fake_bucket):
    saved_1 = security.save_image_to_dataset(b"imagen-1", "a.png")
    saved_2 = security.save_image_to_dataset(b"imagen-2", "b.png")

    assert saved_1 is True
    assert saved_2 is True
    assert len(fake_bucket.stored) == 2


def test_unknown_extension_falls_back_to_png(fake_bucket):
    security.save_image_to_dataset(b"contenido", "estudio.dcm")

    path, options = fake_bucket.calls[0]
    assert path.endswith(".png")
    assert options == {"content-type": "image/png"}


def test_storage_failure_does_not_raise(monkeypatch):
    class BrokenBucketAPI:
        def upload(self, path, file, file_options=None):
            raise Exception("network error")

    monkeypatch.setattr(
        security, "supabase", FakeSupabase.__new__(FakeSupabase)
    )
    security.supabase.storage = FakeStorage(BrokenBucketAPI())

    # No debe lanzar excepcion: un fallo de red al guardar en el dataset no
    # puede tumbar la creacion del caso, que es la operacion principal.
    result = security.save_image_to_dataset(b"contenido", "a.png")

    assert result is False
