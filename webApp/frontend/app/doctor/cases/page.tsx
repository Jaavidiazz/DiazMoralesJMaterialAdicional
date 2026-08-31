"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import {
  normalizeClassification,
  getClassificationDisplay,
  type AiResult,
} from "@/lib/classification";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck2,
  FolderOpen,
  Inbox,
  Layers,
  SearchX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const HOVER_SHADOW =
  "hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]";

function StatTile({
  label,
  value,
  icon: Icon,
  color,
  valueClassName,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  color: "teal" | "rose" | "emerald" | "cyan" | "slate";
  valueClassName?: string;
}) {
  const badgeClass: Record<string, string> = {
    teal: "bg-teal-50 text-teal-600",
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    cyan: "bg-cyan-50 text-cyan-600",
    slate: "bg-slate-100 text-slate-500",
  };
  const stripeClass: Record<string, string> = {
    teal: "bg-teal-500",
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    cyan: "bg-cyan-500",
    slate: "bg-slate-300",
  };

  return (
    <Card
      className={`overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 ${HOVER_SHADOW}`}
    >
      <div className={`h-1.5 w-full ${stripeClass[color]}`} />
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            {label}
          </p>
          <div
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${badgeClass[color]}`}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className={`mt-3 text-2xl font-semibold ${valueClassName ?? "text-slate-900"}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

type BackendCase = {
  id: number;
  created_at: string;
  patient: string | null;
  age: number | null;
  breast_side: "left" | "right" | null;
  doctor_comment: string | null;
  image_url: string | null;
  report_visible: boolean;
  report_text: string | null;
  classification: string | null;
  prob_maligna: number | null;
  confidence: number | null;
};

type CaseUI = {
  id: number;
  created_at: string;
  patient_label: string;
  age: number | null;
  breast_side: "left" | "right" | null;
  ai_result: AiResult | null;
  ai_confidence: number | null;
  report_visible: boolean;
  has_report: boolean;
};

type CasesPageResponse = {
  items: BackendCase[];
  total_count: number;
  skip: number;
  limit: number;
  has_more: boolean;
};

function mapBackendCasesToUI(data: BackendCase[]): CaseUI[] {
  return data.map((row) => ({
    id: row.id,
    created_at: row.created_at,
    patient_label: row.patient || `Caso #${row.id}`,
    age: row.age,
    breast_side: row.breast_side,
    ai_result: normalizeClassification(row.classification),
    ai_confidence: row.confidence,
    report_visible: row.report_visible,
    has_report: !!row.report_text,
  }));
}

const CARD_ACCENT: Record<AiResult | "pending", string> = {
  pending: "from-amber-50 to-white",
  malignant: "from-rose-50 to-white",
  normal: "from-teal-50 to-white",
  benign: "from-emerald-50 to-white",
};

function getStatusConfig(aiResult: AiResult | null) {
  const display = getClassificationDisplay(aiResult);
  return {
    ...display,
    cardAccent: CARD_ACCENT[aiResult ?? "pending"],
  };
}

function formatAiResultText(c: CaseUI) {
  if (c.ai_result === "malignant") return "Maligna (sospecha IA)";
  if (c.ai_result === "benign") return "Benigna (sugerida por IA)";
  if (c.ai_result === "normal") return "Normal (sin hallazgos relevantes)";
  return "Pendiente de análisis por IA";
}

type ClassificationFilter = "" | "maligna" | "benigna" | "normal";
type BreastSideFilter = "" | "left" | "right";
type ReportFilter = "" | "yes" | "no";

export default function DoctorCasesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [cases, setCases] = useState<CaseUI[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 20;

  const [patientInput, setPatientInput] = useState("");
  const [patientFilter, setPatientFilter] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>("");
  const [breastSideFilter, setBreastSideFilter] = useState<BreastSideFilter>("");
  const [reportFilter, setReportFilter] = useState<ReportFilter>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const hasActiveFilters =
    !!patientFilter || !!classificationFilter || !!breastSideFilter || !!reportFilter || !!dateFrom || !!dateTo;

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPatientFilter(patientInput.trim());
      setPage(0);
    }, 400);
    return () => clearTimeout(timeout);
  }, [patientInput]);

  const clearFilters = () => {
    setPatientInput("");
    setPatientFilter("");
    setClassificationFilter("");
    setBreastSideFilter("");
    setReportFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const fetchCases = async (currentPage = page) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const skip = currentPage * PAGE_SIZE;
      const params = new URLSearchParams({
        skip: String(skip),
        limit: String(PAGE_SIZE),
      });
      if (patientFilter) params.set("patient", patientFilter);
      if (classificationFilter) params.set("classification", classificationFilter);
      if (breastSideFilter) params.set("breast_side", breastSideFilter);
      if (reportFilter) params.set("has_report", reportFilter === "yes" ? "true" : "false");
      if (dateFrom) params.set("date_from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("date_to", new Date(dateTo + "T23:59:59").toISOString());

      const res = await fetch(`${API_URL}/cases/?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se han podido cargar los casos.");
      }

      const data: CasesPageResponse = await res.json();
      setCases(mapBackendCasesToUI(data.items));
      setHasMore(data.has_more);
    } catch (e: any) {
      console.error("Error obteniendo casos:", e);
      setError(e.message || "No se han podido cargar los casos.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCases(page);
  }, [page, patientFilter, classificationFilter, breastSideFilter, reportFilter, dateFrom, dateTo]);

  const handleGenerarInforme = async (caseId: number) => {
    setGeneratingId(caseId);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${caseId}/generate_report`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "Error al generar el informe");
      }

      await res.json();

      await fetchCases();
    } catch (e: any) {
      console.error("Error generando informe:", e);
      setError(e.message || "Error desconocido generando el informe");
    } finally {
      setGeneratingId(null);
    }
  };

  const stats = useMemo(() => {
    const total = cases.length;
    const malignant = cases.filter((c) => c.ai_result === "malignant").length;
    const benign = cases.filter((c) => c.ai_result === "benign").length;
    const normal = cases.filter((c) => c.ai_result === "normal").length;
    const reports = cases.filter((c) => c.has_report).length;

    return { total, malignant, benign, normal, reports };
  }, [cases]);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-teal-600 to-cyan-700 shadow-lg shadow-teal-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <FolderOpen className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Casos clínicos registrados
                </h1>
                <p className="max-w-3xl text-sm text-teal-50/90">
                  La IA actúa como herramienta de apoyo para clasificar los
                  estudios como benignos, malignos o normales. La validación
                  final corresponde siempre al profesional médico.
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
              className="rounded-xl bg-white text-teal-700 hover:bg-teal-50"
              onClick={() => router.push("/doctor/cases/newCase")}
            >
              Nuevo caso
            </Button>
          </div>
        </div>
      </section>

      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardContent className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-6">
          <div className="space-y-1 xl:col-span-2">
            <label className="text-xs font-medium text-slate-500">Paciente</label>
            <input
              type="text"
              value={patientInput}
              onChange={(e) => setPatientInput(e.target.value)}
              placeholder="Buscar por nombre..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Resultado IA</label>
            <select
              value={classificationFilter}
              onChange={(e) => {
                setClassificationFilter(e.target.value as ClassificationFilter);
                setPage(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Todos</option>
              <option value="maligna">Sospecha maligna</option>
              <option value="benigna">Aspecto benigno</option>
              <option value="normal">Normal</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Lado</label>
            <select
              value={breastSideFilter}
              onChange={(e) => {
                setBreastSideFilter(e.target.value as BreastSideFilter);
                setPage(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Ambos</option>
              <option value="left">Izquierda</option>
              <option value="right">Derecha</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Informe</label>
            <select
              value={reportFilter}
              onChange={(e) => {
                setReportFilter(e.target.value as ReportFilter);
                setPage(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Todos</option>
              <option value="yes">Con informe</option>
              <option value="no">Sin informe</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="h-10 w-full rounded-xl"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Limpiar filtros
            </Button>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-500">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(0);
              }}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="rounded-2xl border border-red-200 bg-red-50 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_25px_-8px_rgba(220,38,38,0.12)]">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && cases.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatTile label="Total de casos" value={stats.total} icon={Layers} color="slate" />
          <StatTile
            label="Sospecha maligna"
            value={stats.malignant}
            icon={AlertTriangle}
            color="rose"
            valueClassName="text-rose-600"
          />
          <StatTile
            label="Aspecto benigno"
            value={stats.benign}
            icon={CheckCircle2}
            color="emerald"
            valueClassName="text-emerald-600"
          />
          <StatTile
            label="Estudios normales"
            value={stats.normal}
            icon={CheckCircle2}
            color="teal"
            valueClassName="text-teal-600"
          />
          <StatTile
            label="Informes generados"
            value={stats.reports}
            icon={FileCheck2}
            color="cyan"
          />
        </section>
      )}

      {generatingId !== null && (
        <div className="flex items-center gap-3 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <svg className="h-4 w-4 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span>
            Gemini está generando el informe del caso #{generatingId}. Esto puede tardar hasta 30 segundos, por favor espera.
          </span>
        </div>
      )}

      {loading && (
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-8">
            <p className="text-sm text-slate-500">Cargando casos...</p>
          </CardContent>
        </Card>
      )}

      {!loading && cases.length > 0 && (
        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {cases.map((c) => {
            const status = getStatusConfig(c.ai_result);

            return (
              <Card
                key={c.id}
                className={`rounded-3xl border border-slate-200 bg-gradient-to-br ${status.cardAccent} shadow-sm transition hover:-translate-y-0.5 hover:shadow-md`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-lg font-semibold text-slate-900">
                        {c.patient_label}
                      </CardTitle>
                      <p className="text-xs text-slate-400">
                        {new Date(c.created_at).toLocaleString()}
                      </p>
                    </div>

                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${status.badgeClass}`}
                    >
                      {status.label}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex h-full flex-col space-y-5 text-sm text-slate-700">
                  <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-500">Edad</span>
                      <span className="text-slate-900">
                        {c.age != null ? `${c.age} años` : "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-500">Lado</span>
                      <span className="text-slate-900">
                        {c.breast_side === "left"
                          ? "Izquierda"
                          : c.breast_side === "right"
                            ? "Derecha"
                            : "—"}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-500">
                        Resultado IA
                      </span>
                      <span className="text-right text-slate-900">
                        {formatAiResultText(c)}
                      </span>
                    </div>

                    {c.ai_confidence != null && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-slate-500">
                          Confianza IA
                        </span>
                        <span className="text-slate-900">
                          {Math.round(c.ai_confidence * 100)}%
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-slate-500">
                        Informe
                      </span>
                      <span className="text-right text-slate-900">
                        {c.has_report
                          ? c.report_visible
                            ? "Generado y visible"
                            : "Generado y oculto"
                          : "No generado"}
                      </span>
                    </div>
                  </div>

                  <div className="mt-auto flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 rounded-xl"
                      onClick={() => router.push(`/doctor/cases/${c.id}`)}
                    >
                      Ver detalles
                    </Button>

                    <Button
                      size="sm"
                      className="flex-1 rounded-xl"
                      onClick={() => handleGenerarInforme(c.id)}
                      disabled={generatingId !== null}
                    >
                      {generatingId === c.id ? (
                        <span className="flex items-center gap-2">
                          <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                          </svg>
                          Generando...
                        </span>
                      ) : c.has_report ? "Regenerar informe" : "Generar informe"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {/* CONTROLES DE PAGINACIÓN */}
      {!loading && cases.length > 0 && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Anterior
          </Button>
          <span className="text-sm text-slate-500">
            Página {page + 1}
          </span>
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasMore}
          >
            Siguiente →
          </Button>
        </div>
      )}

      {!loading && cases.length === 0 && hasActiveFilters && (
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <SearchX className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              Ningún caso coincide con los filtros
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Prueba a ajustar o limpiar los filtros aplicados.
            </p>
            <Button variant="outline" className="mt-6 rounded-xl" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && cases.length === 0 && !hasActiveFilters && (
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-10 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
              <Inbox className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              No hay casos registrados todavía
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              Cuando se suban nuevos estudios aparecerán aquí con su análisis e
              informe asociado.
            </p>
            <Button
              className="mt-6 rounded-xl"
              onClick={() => router.push("/doctor/cases/newCase")}
            >
              Crear primer caso
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
