"""
Tests de derived_asset_filename() (core/security.py).

El overlay y el heatmap de un caso se sirven desde /uploads sin
autenticacion. Si su nombre se construyera con el id del caso (un entero
secuencial) cualquiera podria enumerar /uploads/case_1_overlay.jpg y ver
imagenes de casos ajenos.

derived_asset_filename() usa el hash aleatorio de la imagen original (el
que genera unique_filename()) en lugar del id del caso, de modo que el
nombre no es adivinable.
"""

from core.security import derived_asset_filename


def test_derived_filename_keeps_the_random_base():
    assert (
        derived_asset_filename("a1b2c3d4e5f6.png", "_overlay", ".jpg")
        == "a1b2c3d4e5f6_overlay.jpg"
    )
    assert (
        derived_asset_filename("a1b2c3d4e5f6.png", "_heatmap", ".png")
        == "a1b2c3d4e5f6_heatmap.png"
    )


def test_derived_filename_never_contains_a_sequential_case_id_marker():
    # El nombre no debe contener un identificador secuencial tipo "case_123".
    for case_id in (1, 2, 42, 999999):
        original = "9f8e7d6c5b4a.png"
        overlay = derived_asset_filename(original, "_overlay", ".jpg")
        heatmap = derived_asset_filename(original, "_heatmap", ".png")
        assert f"case_{case_id}" not in overlay
        assert f"case_{case_id}" not in heatmap
        assert str(case_id) not in overlay
        assert str(case_id) not in heatmap


def test_derived_filename_is_stable_for_the_same_original():
    # Determinista para el mismo original: al regenerar el overlay/heatmap
    # se sobrescribe la misma ruta y no se acumulan ficheros sueltos.
    a = derived_asset_filename("abc123.png", "_overlay", ".jpg")
    b = derived_asset_filename("abc123.png", "_overlay", ".jpg")
    assert a == b


def test_derived_filename_differs_between_different_originals():
    a = derived_asset_filename("abc123.png", "_overlay", ".jpg")
    b = derived_asset_filename("def456.png", "_overlay", ".jpg")
    assert a != b
