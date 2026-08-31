import time

from fastapi import HTTPException

from core.config import genai_client, GEMINI_PRIMARY_MODEL, GEMINI_FALLBACK_MODEL


def _extraer_texto_respuesta(response) -> str:
    text = getattr(response, "text", None)
    if text and text.strip():
        return text.strip()
    raise RuntimeError("Gemini no devolvió texto de informe")


def _es_error_temporal_gemini(error_text: str) -> bool:
    error_text = error_text.upper()
    return (
        "503" in error_text
        or "UNAVAILABLE" in error_text
        or "HIGH DEMAND" in error_text
        or "OVERLOADED" in error_text
        or "SERVICE UNAVAILABLE" in error_text
    )


def _llamar_gemini_con_reintentos(prompt: str, model_name: str, max_retries: int = 3) -> str:
    last_error = None

    for attempt in range(max_retries):
        try:
            response = genai_client.models.generate_content(
                model=model_name,
                contents=prompt,
            )
            return _extraer_texto_respuesta(response)

        except Exception as e:
            last_error = e
            error_text = str(e)

            if _es_error_temporal_gemini(error_text) and attempt < max_retries - 1:
                wait_seconds = 2 ** attempt
                print(
                    f"[WARN] Gemini saturado con modelo {model_name}. "
                    f"Reintento {attempt + 1}/{max_retries} en {wait_seconds}s"
                )
                time.sleep(wait_seconds)
                continue

            raise e

    raise last_error


def generar_informe_gemini(datos_mama: dict, case: dict) -> str:
    patient_name = case.get("patient") or "Paciente"
    age = case.get("age")
    age_text = f"{age} años" if age is not None else "edad no especificada"
    breast_side = case.get("breast_side") or "no especificado"
    doctor_comment = case.get("doctor_comment") or "Sin comentarios clínicos adicionales."

    prompt = f"""
Eres un asistente médico especializado en la redacción de informes de mamografía en español.

Genera un informe médico formal, claro y bien estructurado basándote en los siguientes datos:

Paciente: {patient_name}
Edad: {age_text}
Lado estudiado: {breast_side}
Comentario clínico inicial: {doctor_comment}

Resultado del modelo:
- Clasificación automática: {datos_mama['clasificacion']}
- Probabilidad estimada de malignidad: {datos_mama['prob_maligna']:.2f}
- Confianza global del modelo: {datos_mama['confidence']:.2f}

Instrucciones:
- Escribe el informe en español.
- Usa tono formal y clínico.
- Organiza el texto en párrafos con estas secciones:
  Motivo del estudio, Hallazgos, Impresión diagnóstica y Recomendaciones.
- No uses listas con viñetas.
- No digas que eres una IA.
- No inventes datos no proporcionados.
- Al final añade una nota indicando que el informe se ha generado automáticamente
  como apoyo al diagnóstico y que requiere validación por un radiólogo.
""".strip()

    errores = []

    try:
        return _llamar_gemini_con_reintentos(
            prompt=prompt,
            model_name=GEMINI_PRIMARY_MODEL,
            max_retries=3,
        )
    except Exception as e:
        errores.append(f"{GEMINI_PRIMARY_MODEL}: {str(e)}")
        print(f"[WARN] Falló modelo principal: {e}")

    try:
        return _llamar_gemini_con_reintentos(
            prompt=prompt,
            model_name=GEMINI_FALLBACK_MODEL,
            max_retries=2,
        )
    except Exception as e:
        errores.append(f"{GEMINI_FALLBACK_MODEL}: {str(e)}")
        print(f"[WARN] Falló modelo fallback: {e}")

    raise HTTPException(
        status_code=503,
        detail=(
            "No se pudo generar el informe ahora mismo por saturación temporal de Gemini. "
            + " | ".join(errores)
        ),
    )
