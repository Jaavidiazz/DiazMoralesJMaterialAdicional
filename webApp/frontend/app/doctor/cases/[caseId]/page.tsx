"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MammoViewer } from "@/components/mammoviewer";
import { API_URL } from "@/lib/api";
import { getClassificationDisplay } from "@/lib/classification";
import {
  CheckCircle2,
  ClipboardCheck,
  Gauge,
  ShieldQuestion,
  Stethoscope,
  Target,
  XCircle,
} from "lucide-react";

type CaseDetails = {
  case_id: number;
  clasificacion: string | null;
  prob_maligna: number;
  confidence: number;
  original_path: string;
  overlay_path: string;
  heatmap_path?: string | null;
};

type PatientHistoryItem = {
  id: number;
  created_at: string;
  breast_side: "left" | "right" | null;
  classification: string | null;
  prob_maligna: number | null;
  confidence: number | null;
  has_report: boolean;
  is_current: boolean;
};

type PatientHistoryResponse = {
  patient: string | null;
  cases: PatientHistoryItem[];
};

type Annotation = {
  id: number;
  created_at: string;
  is_correct: boolean;
  final_label: string | null;
  notes: string | null;
};


export default function CaseDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const caseId = (params?.caseId as string | undefined) ?? "";

  const [details, setDetails] = useState<CaseDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const [history, setHistory] = useState<PatientHistoryResponse | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [finalLabel, setFinalLabel] = useState("");
  const [annotationNotes, setAnnotationNotes] = useState("");
  const [savingAnnotation, setSavingAnnotation] = useState(false);
  const [annotationError, setAnnotationError] = useState<string | null>(null);

  const submitAnnotation = async () => {
    if (isCorrect === null) return;
    setSavingAnnotation(true);
    setAnnotationError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${caseId}/annotations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          is_correct: isCorrect,
          final_label: isCorrect ? null : finalLabel.trim() || null,
          notes: annotationNotes.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudo guardar la anotación.");
      }

      const created: Annotation = await res.json();
      setAnnotations((prev) => [created, ...prev]);
      setIsCorrect(null);
      setFinalLabel("");
      setAnnotationNotes("");
    } catch (e) {
      setAnnotationError(
        e instanceof Error ? e.message : "No se pudo guardar la anotación.",
      );
    } finally {
      setSavingAnnotation(false);
    }
  };

  useEffect(() => {
    if (!caseId) {
      setError("No se ha podido determinar el ID del caso.");
      setLoading(false);
      return;
    }

    const fetchDetails = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sesión no válida.");

        const res = await fetch(`${API_URL}/cases/${caseId}/details`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.detail || "Error al cargar detalles");
        }

        const data: CaseDetails = await res.json();
        setDetails(data);
      } catch (e: any) {
        console.error("Error cargando detalles:", e);
        setError(e.message || "Error al cargar detalles");
      } finally {
        setLoading(false);
      }
    };

    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sesión no válida.");

        const res = await fetch(`${API_URL}/cases/${caseId}/patient-history`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) return;

        const data: PatientHistoryResponse = await res.json();
        setHistory(data);
      } catch (e) {
        console.error("Error cargando historial del paciente:", e);
      } finally {
        setLoadingHistory(false);
      }
    };

    const fetchAnnotations = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        const res = await fetch(`${API_URL}/cases/${caseId}/annotations`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        setAnnotations(await res.json());
      } catch (e) {
        console.error("Error cargando anotaciones:", e);
      }
    };

    fetchDetails();
    fetchHistory();
    fetchAnnotations();
  }, [caseId]);

  const classificationStyles = getClassificationDisplay(
    details?.clasificacion ?? null,
  );

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-teal-600 to-cyan-700 shadow-lg shadow-teal-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <Stethoscope className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Detalles del caso #{caseId}
                </h1>
                <p className="text-sm text-teal-50/90">
                  Revisión clínica del estudio con apoyo visual de la predicción
                  del modelo.
                </p>
              </div>
            </div>

            {details && (
              <Badge
                variant="outline"
                className={`rounded-full border-white/40 bg-white/15 px-3 py-1 text-xs font-medium text-white`}
              >
                {classificationStyles.label}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              onClick={() => router.push("/doctor/cases")}
            >
              Volver a casos
            </Button>
          </div>
        </div>
      </section>

      {loading && (
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-8">
            <p className="text-sm text-slate-500">
              Cargando detalles del caso...
            </p>
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="rounded-2xl border border-red-200 bg-red-50 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_25px_-8px_rgba(220,38,38,0.12)]">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {details && (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
              <div className="h-1.5 w-full bg-teal-500" />
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Clasificación
                  </p>
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                    <ShieldQuestion className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-xl font-semibold text-slate-900">
                  {details.clasificacion ?? "—"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Resultado principal obtenido por la IA.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
              <div className="h-1.5 w-full bg-rose-500" />
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Probabilidad de malignidad
                  </p>
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                    <Target className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-xl font-semibold text-slate-900">
                  {Math.round(details.prob_maligna * 100)}%
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Estimación del modelo para lesión maligna.
                </p>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
              <div className="h-1.5 w-full bg-cyan-500" />
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Confianza del modelo
                  </p>
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
                    <Gauge className="h-4 w-4" />
                  </div>
                </div>
                <p className="mt-3 text-xl font-semibold text-slate-900">
                  {Math.round(details.confidence * 100)}%
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Nivel de confianza asociado a la predicción.
                </p>
              </CardContent>
            </Card>
          </section>

          {!loadingHistory && history && history.cases.length > 1 && (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg font-semibold text-slate-900">
                  Historial de {history.patient}
                </CardTitle>
                <p className="text-sm text-slate-500">
                  {history.cases.length} estudios registrados para este paciente.
                </p>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {history.cases.map((h) => {
                    const c = (h.classification || "").toLowerCase();
                    const badgeClass =
                      c === "maligna" || c === "malignant"
                        ? "bg-rose-100 text-rose-700 border-rose-200"
                        : c === "normal"
                          ? "bg-teal-100 text-teal-700 border-teal-200"
                          : c
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : "bg-amber-100 text-amber-700 border-amber-200";

                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => {
                          if (!h.is_current) router.push(`/doctor/cases/${h.id}`);
                        }}
                        className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 text-left text-sm transition ${
                          h.is_current
                            ? "border-slate-300 bg-slate-50"
                            : "border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-slate-900">
                            Caso #{h.id}
                            {h.is_current && (
                              <span className="ml-2 text-xs font-normal text-slate-500">
                                (este caso)
                              </span>
                            )}
                          </span>
                          <span className="text-slate-400">
                            {new Date(h.created_at).toLocaleDateString()}
                          </span>
                          <span className="text-slate-400">
                            {h.breast_side === "left"
                              ? "Izquierda"
                              : h.breast_side === "right"
                                ? "Derecha"
                                : "—"}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {h.has_report && (
                            <Badge
                              variant="outline"
                              className="rounded-full border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600"
                            >
                              Con informe
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={`rounded-full px-3 py-1 text-[11px] font-medium ${badgeClass}`}
                          >
                            {h.classification || "Pendiente IA"}
                          </Badge>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {(() => {
            const isNormal =
              details.clasificacion?.toLowerCase() === "normal";

            return isNormal ? (
              /* ── Estudio normal: solo imagen original ── */
              <section className="grid gap-6 md:grid-cols-2">
                <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold text-slate-900">
                      Mamografía original
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <img
                        src={`${API_URL}${details.original_path}`}
                        alt="Mamografía original"
                        className="mx-auto max-h-[560px] w-full object-contain"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border border-teal-100 bg-teal-50 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_25px_-8px_rgba(13,148,136,0.14)]">
                  <CardContent className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-100 text-teal-700">
                      <CheckCircle2 className="h-8 w-8" />
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-teal-800">
                        Sin hallazgos detectados
                      </p>
                      <p className="mt-2 text-sm text-teal-700">
                        El modelo de IA no ha identificado regiones de
                        interés en este estudio. La visualización asistida
                        (overlay y heatmap) no está disponible para estudios
                        clasificados como normales.
                      </p>
                    </div>
                    <p className="text-xs text-teal-600">
                      Este resultado debe ser confirmado por un radiólogo
                      especialista antes de cualquier decisión clínica.
                    </p>
                  </CardContent>
                </Card>
              </section>
            ) : (
              /* ── Estudio con hallazgos: imagen + overlay/heatmap ── */
              <section className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
                <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-semibold text-slate-900">
                      Mamografía original
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <img
                        src={`${API_URL}${details.original_path}`}
                        alt="Mamografía original"
                        className="mx-auto max-h-[560px] w-full object-contain"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
                  <CardHeader className="pb-2">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <CardTitle className="text-lg font-semibold text-slate-900">
                        Visualización asistida por IA
                      </CardTitle>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={showHeatmap ? "outline" : "default"}
                          className="rounded-xl"
                          onClick={() => setShowHeatmap(false)}
                        >
                          Overlay
                        </Button>

                        <Button
                          variant={showHeatmap ? "default" : "outline"}
                          className="rounded-xl"
                          onClick={() => setShowHeatmap(true)}
                          disabled={!details.heatmap_path}
                        >
                          Heatmap
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      <span className="font-medium text-slate-500">Overlay:</span>{" "}
                      regiones detectadas por el modelo con cajas de localización.{" "}
                      <span className="font-medium text-slate-500">Heatmap:</span>{" "}
                      mapa de calor Grad-CAM con las zonas de mayor peso en la
                      predicción.
                    </p>
                  </CardHeader>

                  <CardContent className="space-y-4">
                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <MammoViewer
                        baseSrc={`${API_URL}${details.overlay_path}`}
                        heatmapSrc={
                          details.heatmap_path
                            ? `${API_URL}${details.heatmap_path}`
                            : undefined
                        }
                        showHeatmap={showHeatmap}
                      />
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-sm font-medium text-slate-700">
                        {showHeatmap
                          ? "Mostrando mapa de calor para resaltar las zonas con mayor activación del modelo."
                          : "Mostrando overlay con la predicción detectada por el modelo."}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Esta visualización tiene carácter orientativo y sirve
                        como apoyo a la interpretación médica.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </section>
            );
          })()}

          {/* ── Anotación de validación clínica (CU-11) ── */}
          <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                  <ClipboardCheck className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-lg font-semibold text-slate-900">
                    Validación clínica
                  </CardTitle>
                  <p className="text-sm text-slate-500">
                    Registra si la predicción del modelo es correcta. Estas
                    anotaciones sirven de base para futuras mejoras del modelo.
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-5">
              {annotations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    Anotaciones registradas
                  </p>
                  {annotations.map((a) => (
                    <div
                      key={a.id}
                      className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 font-medium text-slate-800">
                          {a.is_correct ? (
                            <>
                              <CheckCircle2 className="h-4 w-4 text-teal-600" />
                              Predicción confirmada como correcta
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 text-rose-600" />
                              Predicción corregida
                              {a.final_label ? ` → ${a.final_label}` : ""}
                            </>
                          )}
                        </div>
                        {a.notes && (
                          <p className="text-slate-600">{a.notes}</p>
                        )}
                      </div>
                      <span className="text-slate-400">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">
                  ¿La clasificación del modelo ({details.clasificacion ?? "—"}) es
                  correcta?
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={isCorrect === true ? "default" : "outline"}
                    className="rounded-xl"
                    onClick={() => setIsCorrect(true)}
                  >
                    Sí, es correcta
                  </Button>
                  <Button
                    variant={isCorrect === false ? "default" : "outline"}
                    className="rounded-xl"
                    onClick={() => setIsCorrect(false)}
                  >
                    No, la corrijo
                  </Button>
                </div>

                {isCorrect === false && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">
                      Etiqueta correcta (opcional)
                    </label>
                    <Input
                      value={finalLabel}
                      onChange={(e) => setFinalLabel(e.target.value)}
                      placeholder="p. ej. benigna, maligna o normal"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500">
                    Notas (opcional)
                  </label>
                  <Textarea
                    value={annotationNotes}
                    onChange={(e) => setAnnotationNotes(e.target.value)}
                    placeholder="Observaciones clínicas sobre la predicción."
                  />
                </div>

                {annotationError && (
                  <p className="text-sm font-medium text-red-600">
                    {annotationError}
                  </p>
                )}

                <Button
                  className="rounded-xl"
                  disabled={isCorrect === null || savingAnnotation}
                  onClick={submitAnnotation}
                >
                  {savingAnnotation ? "Guardando..." : "Guardar anotación"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
