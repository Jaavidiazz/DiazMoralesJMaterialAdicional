"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import { getClassificationDisplay } from "@/lib/classification";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  FileEdit,
  FileText,
  FileX,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  color: "teal" | "rose" | "emerald" | "slate";
  valueClassName?: string;
}) {
  const badgeClass: Record<string, string> = {
    teal: "bg-teal-50 text-teal-600",
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    slate: "bg-slate-100 text-slate-500",
  };
  const stripeClass: Record<string, string> = {
    teal: "bg-teal-500",
    rose: "bg-rose-500",
    emerald: "bg-emerald-500",
    slate: "bg-slate-300",
  };

  return (
    <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
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

interface BackendCase {
  id: number;
  patient: string | null;
  age: number | null;
  report_text: string | null;
  report_visible: boolean;
  created_at: string;
  classification: string | null;
  confidence: number | null;
}

interface CaseReportDetail {
  case_id: number;
  report_text: string | null;
  report_visible: boolean;
}


export default function InformesPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [informes, setInformes] = useState<BackendCase[]>([]);
  const [selected, setSelected] = useState<BackendCase | null>(null);
  const [selectedReport, setSelectedReport] = useState<CaseReportDetail | null>(
    null,
  );

  const [editorText, setEditorText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [togglingVisibility, setTogglingVisibility] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadInformes = async () => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudieron cargar los informes.");
      }

      const data: { items: BackendCase[] } = await res.json();

      const soloInformes = data.items.filter(
        (item) => item.report_text && item.report_text.trim() !== "",
      );

      setInformes(soloInformes);
    } catch (err: any) {
      console.error("Error cargando informes:", err);
      setError(err.message || "Error cargando informes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInformes();
  }, []);

  const loadSingleReport = async (caseItem: BackendCase) => {
    setSelected(caseItem);
    setSelectedReport(null);
    setEditorText("");
    setLoadingReport(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${caseItem.id}/report`, {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudo cargar el informe.");
      }

      const data: CaseReportDetail = await res.json();
      setSelectedReport(data);
      setEditorText(data.report_text || "");
    } catch (err: any) {
      console.error("Error cargando informe:", err);
      setError(err.message || "Error cargando informe.");
    } finally {
      setLoadingReport(false);
    }
  };

  const handleSaveReport = async () => {
    if (!selected) return;

    const cleanText = editorText.trim();

    if (!cleanText) {
      setError("El informe no puede estar vacío.");
      return;
    }

    setSavingReport(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${selected.id}/report`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          report_text: cleanText,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudo guardar el informe.");
      }

      const updated: CaseReportDetail = await res.json();

      setSelectedReport(updated);
      setEditorText(updated.report_text || "");

      setSelected((prev) =>
        prev
          ? {
              ...prev,
              report_text: updated.report_text,
              report_visible: updated.report_visible,
            }
          : null,
      );

      setInformes((prev) =>
        prev.map((inf) =>
          inf.id === selected.id
            ? {
                ...inf,
                report_text: updated.report_text,
                report_visible: updated.report_visible,
              }
            : inf,
        ),
      );

      setSuccess("Informe guardado correctamente.");
    } catch (err: any) {
      console.error("Error guardando informe:", err);
      setError(err.message || "Error guardando informe.");
    } finally {
      setSavingReport(false);
    }
  };

  const handleToggleVisibility = async () => {
    if (!selected) return;

    const currentVisible =
      selectedReport?.report_visible ?? selected.report_visible;

    setTogglingVisibility(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${selected.id}/visibility`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          report_visible: !currentVisible,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudo actualizar la visibilidad.");
      }

      const updated = await res.json();

      setSelectedReport((prev) =>
        prev
          ? {
              ...prev,
              report_visible: updated.report_visible,
            }
          : null,
      );

      setSelected((prev) =>
        prev
          ? {
              ...prev,
              report_visible: updated.report_visible,
            }
          : null,
      );

      setInformes((prev) =>
        prev.map((inf) =>
          inf.id === selected.id
            ? { ...inf, report_visible: updated.report_visible }
            : inf,
        ),
      );

      setSuccess(
        updated.report_visible
          ? "Informe marcado como visible."
          : "Informe marcado como oculto.",
      );
    } catch (err: any) {
      console.error("Error cambiando visibilidad:", err);
      setError(err.message || "Error cambiando visibilidad.");
    } finally {
      setTogglingVisibility(false);
    }
  };

  const handleExportPdf = async () => {
    if (!selected) return;

    setExportingPdf(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sesión no válida.");

      const res = await fetch(`${API_URL}/cases/${selected.id}/report/pdf`, {
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail || "No se pudo exportar el informe a PDF.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `informe_caso_${selected.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error("Error exportando informe a PDF:", err);
      setError(err.message || "Error exportando el informe a PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const selectedVisible =
    selectedReport?.report_visible ?? selected?.report_visible ?? false;

  const hasUnsavedChanges = useMemo(() => {
    const original = selectedReport?.report_text ?? "";
    return editorText !== original;
  }, [editorText, selectedReport]);

  const stats = useMemo(() => {
    const total = informes.length;
    const visibles = informes.filter((i) => i.report_visible).length;
    const ocultos = informes.filter((i) => !i.report_visible).length;
    const malignos = informes.filter((i) => {
      const c = i.classification?.toLowerCase();
      return c === "maligna" || c === "malignant";
    }).length;

    return { total, visibles, ocultos, malignos };
  }, [informes]);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-teal-600 to-cyan-700 shadow-lg shadow-teal-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Informes generados
                </h1>
                <p className="max-w-3xl text-sm text-teal-50/90">
                  Revisa, corrige y valida los informes generados por IA antes
                  de marcarlos como visibles en el sistema.
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
          </div>
        </div>
      </section>

      {!loading && informes.length > 0 && (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatTile label="Total informes" value={stats.total} icon={Layers} color="slate" />
          <StatTile
            label="Visibles"
            value={stats.visibles}
            icon={Eye}
            color="emerald"
            valueClassName="text-emerald-600"
          />
          <StatTile label="Ocultos" value={stats.ocultos} icon={EyeOff} color="slate" />
          <StatTile
            label="Sospecha maligna"
            value={stats.malignos}
            icon={AlertTriangle}
            color="rose"
            valueClassName="text-rose-600"
          />
        </section>
      )}

      {loading && (
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardContent className="p-8">
            <p className="text-sm text-slate-500">Cargando informes...</p>
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

      {success && (
        <Card className="rounded-2xl border border-emerald-200 bg-emerald-50 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_25px_-8px_rgba(16,185,129,0.14)]">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-emerald-700">{success}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          {!loading && informes.length === 0 && (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardContent className="p-8 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <FileX className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  No hay informes todavía
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Los informes generados aparecerán aquí para su revisión y
                  edición.
                </p>
              </CardContent>
            </Card>
          )}

          {informes.map((inf) => {
            const classification = getClassificationDisplay(inf.classification);

            return (
              <button
                key={inf.id}
                type="button"
                className={`w-full rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md ${
                  selected?.id === inf.id ? "ring-2 ring-slate-300" : ""
                }`}
                onClick={() => loadSingleReport(inf)}
              >
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">
                        Caso #{inf.id}
                      </h3>
                      <p className="mt-1 text-sm text-slate-500">
                        {inf.patient || "Paciente desconocido"}
                      </p>
                    </div>

                    <Badge
                      variant="outline"
                      className={`rounded-full px-3 py-1 text-[11px] font-medium ${
                        inf.report_visible
                          ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {inf.report_visible ? "Visible" : "Oculto"}
                    </Badge>
                  </div>

                  <div className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Fecha</span>
                      <span className="text-right text-slate-900">
                        {new Date(inf.created_at).toLocaleString()}
                      </span>
                    </div>

                    {inf.age != null && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Edad</span>
                        <span className="text-slate-900">{inf.age} años</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Clasificación</span>
                      <Badge
                        variant="outline"
                        className={`rounded-full px-3 py-1 text-[11px] font-medium ${classification.badgeClass}`}
                      >
                        {classification.label}
                      </Badge>
                    </div>

                    {inf.confidence != null && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-slate-500">Confianza</span>
                        <span className="text-slate-900">
                          {Math.round(inf.confidence * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div>
          {!selected && (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardContent className="p-10 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <FileEdit className="h-6 w-6" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-900">
                  Selecciona un informe
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Elige un caso de la izquierda para revisar, editar y validar
                  su informe.
                </p>
              </CardContent>
            </Card>
          )}

          {selected && (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardContent className="p-6 md:p-8">
                <div className="space-y-6">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="space-y-2">
                      <h2 className="text-xl font-semibold text-slate-900">
                        Informe del caso #{selected.id}
                      </h2>
                      <div className="space-y-1 text-sm text-slate-500">
                        <p>Paciente: {selected.patient || "Desconocido"}</p>
                        {selected.age != null && (
                          <p>Edad: {selected.age} años</p>
                        )}
                        <p>
                          Fecha:{" "}
                          {new Date(selected.created_at).toLocaleString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`rounded-full px-3 py-1 text-xs font-medium ${
                          selectedVisible
                            ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        }`}
                      >
                        {selectedVisible ? "Visible" : "Oculto"}
                      </Badge>

                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={handleToggleVisibility}
                        disabled={togglingVisibility || loadingReport}
                      >
                        {togglingVisibility
                          ? "Actualizando..."
                          : selectedVisible
                            ? "Ocultar informe"
                            : "Hacer visible"}
                      </Button>

                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={handleExportPdf}
                        disabled={exportingPdf || loadingReport || !selectedReport?.report_text}
                      >
                        {exportingPdf ? "Exportando..." : "Exportar PDF"}
                      </Button>

                      <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => {
                          setSelected(null);
                          setSelectedReport(null);
                          setEditorText("");
                          setError(null);
                          setSuccess(null);
                        }}
                      >
                        Cerrar
                      </Button>
                    </div>
                  </div>

                  {loadingReport ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
                      <p className="text-sm text-slate-500">
                        Cargando informe...
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-3">
                        <label className="block text-sm font-medium text-slate-700">
                          Texto del informe
                        </label>
                        <textarea
                          value={editorText}
                          onChange={(e) => setEditorText(e.target.value)}
                          rows={18}
                          className="w-full rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-700 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                          placeholder="Escribe aquí el informe clínico..."
                        />
                      </div>

                      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
                        <p className="text-sm text-slate-500">
                          {hasUnsavedChanges
                            ? "Hay cambios sin guardar."
                            : "Sin cambios pendientes."}
                        </p>

                        <Button
                          className="rounded-xl"
                          onClick={handleSaveReport}
                          disabled={
                            savingReport || loadingReport || !hasUnsavedChanges
                          }
                        >
                          {savingReport ? "Guardando..." : "Guardar cambios"}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
