"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FilePlus2 } from "lucide-react";

type CreateCaseResponse = {
  case_id: number;
  filename: string;
  clasificacion?: string;
  prob_maligna?: number;
  confidence?: number;
  message?: string;
};

export default function NewCasePage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [patientCode, setPatientCode] = useState("");
  const [age, setAge] = useState<number | "">("");
  const [breastSide, setBreastSide] = useState<"left" | "right" | "">("");
  const [doctorComment, setDoctorComment] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    if (!file) {
      setMessage("Debes seleccionar una imagen del estudio.");
      setLoading(false);
      return;
    }

    if (!patientCode.trim()) {
      setMessage("Debes introducir el código del paciente.");
      setLoading(false);
      return;
    }

    if (age === "" || age < 0 || age > 120) {
      setMessage("Debes introducir una edad válida.");
      setLoading(false);
      return;
    }

    if (!breastSide) {
      setMessage("Debes seleccionar el lado de la mama.");
      setLoading(false);
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("patient", patientCode.trim());
      formData.append("age", age.toString());
      formData.append("breast_side", breastSide);

      if (doctorComment.trim()) {
        formData.append("doctor_comment", doctorComment.trim());
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        setMessage("Sesión no válida. Por favor, inicia sesión de nuevo.");
        return;
      }

      const res = await fetch(`${API_URL}/cases/`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      if (!res.ok) {
        let errorMessage = "Error al crear el caso en el servidor.";
        try {
          const err = await res.json();
          console.error("Error creando caso en backend:", err);
          errorMessage = err?.detail || errorMessage;
        } catch {
          console.error("La respuesta de error no vino en JSON.");
        }

        setMessage(errorMessage);
        return;
      }

      const data: CreateCaseResponse = await res.json();

      if (data.case_id) {
        router.push(`/doctor/cases/${data.case_id}`);
      } else {
        router.push("/doctor/cases");
      }
    } catch (error) {
      console.error("Error inesperado al crear caso:", error);
      setMessage(
        "No se pudo conectar con el backend. Revisa que FastAPI esté levantado y que CORS esté configurado.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-teal-600 to-cyan-700 shadow-lg shadow-teal-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <FilePlus2 className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Nuevo caso clínico
                </h1>
                <p className="max-w-3xl text-sm text-teal-50/90">
                  Registra un nuevo estudio para su análisis con el sistema de
                  apoyo al diagnóstico. Después podrás revisar el resultado del
                  modelo y completar el informe médico.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => router.push("/doctor/dashboard")}
            >
              ← Dashboard
            </Button>

            <Button
              variant="outline"
              className="rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => router.push("/doctor/cases")}
            >
              Ver casos
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Paso 1
            </p>
            <p className="mt-3 text-base font-semibold text-slate-900">
              Identificación del estudio
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Introduce un código anonimizado y los datos básicos del caso.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Paso 2
            </p>
            <p className="mt-3 text-base font-semibold text-slate-900">
              Subida de imagen
            </p>
            <p className="mt-1 text-sm text-slate-500">
              La mamografía se enviará al backend para su procesado automático.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Paso 3
            </p>
            <p className="mt-3 text-base font-semibold text-slate-900">
              Revisión posterior
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Podrás consultar la predicción, el heatmap y generar el informe.
            </p>
          </CardContent>
        </Card>
      </section>

      {message && (
        <Card className="rounded-2xl border border-red-200 bg-red-50 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_25px_-8px_rgba(220,38,38,0.12)]">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-red-600">{message}</p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <svg className="h-4 w-4 flex-shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span>
            Analizando la imagen con el modelo de IA. Esto puede tardar unos
            segundos, por favor espera.
          </span>
        </div>
      )}

      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Datos del estudio
          </CardTitle>
          <p className="text-sm text-slate-500">
            Completa la información clínica inicial antes de registrar el caso.
          </p>
        </CardHeader>

        <form onSubmit={handleCreate}>
          <CardContent className="space-y-8">
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Información del paciente
                </h3>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Código de paciente
                  </label>
                  <Input
                    value={patientCode}
                    onChange={(e) => setPatientCode(e.target.value)}
                    placeholder="PAC-001"
                    className="rounded-2xl h-11"
                  />
                  <p className="text-xs text-slate-400">
                    Usa un identificador anonimizado, no el nombre real del
                    paciente.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Edad
                  </label>
                  <Input
                    type="number"
                    value={age}
                    onChange={(e) =>
                      setAge(
                        e.target.value === "" ? "" : Number(e.target.value),
                      )
                    }
                    min={0}
                    max={120}
                    placeholder="Ej. 54"
                    className="rounded-2xl h-11"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Datos del estudio
                </h3>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Lado de la mama
                  </label>
                  <select
                    className="h-11 w-full rounded-2xl border border-slate-300 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                    value={breastSide}
                    onChange={(e) =>
                      setBreastSide(e.target.value as "left" | "right" | "")
                    }
                  >
                    <option value="">Selecciona una opción</option>
                    <option value="left">Izquierda</option>
                    <option value="right">Derecha</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-700">
                    Imagen del estudio
                  </label>
                  <Input
                    type="file"
                    accept="image/*"
                    onChange={(e) =>
                      setFile(e.target.files?.[0] ? e.target.files[0] : null)
                    }
                    className="rounded-2xl h-11"
                  />
                  <p className="text-xs text-slate-400">
                    La imagen se enviará al servidor para su análisis por el
                    modelo de IA. Formatos aceptados: JPEG, PNG o WEBP, hasta
                    15&nbsp;MB.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
                  Contexto clínico inicial
                </h3>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">
                  Notas clínicas iniciales
                </label>
                <Textarea
                  value={doctorComment}
                  onChange={(e) => setDoctorComment(e.target.value)}
                  placeholder="Motivo del estudio, hallazgos previos, antecedentes relevantes..."
                  className="min-h-[160px] rounded-2xl bg-slate-50"
                />
                <p className="text-xs text-slate-400">
                  Añade información útil para contextualizar el estudio antes de
                  generar el informe.
                </p>
              </div>
            </section>
          </CardContent>

          <CardFooter className="flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => router.push("/doctor/cases")}
            >
              Cancelar
            </Button>

            <Button type="submit" disabled={loading} className="rounded-xl">
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Analizando...
                </span>
              ) : (
                "Guardar caso"
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
