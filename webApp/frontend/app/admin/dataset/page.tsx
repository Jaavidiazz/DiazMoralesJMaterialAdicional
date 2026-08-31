"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Database, Folder, FolderOpen, Images } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/lib/api";

type DatasetSummary = {
  bucket: string;
  prefix: string;
  file_count: number;
  filenames: string[];
};

export default function AdminDatasetPage() {
  const supabase = useMemo(() => createClient(), []);

  const [summary, setSummary] = useState<DatasetSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("No se ha podido obtener la sesión del usuario.");
      }

      const res = await fetch(`${API_URL}/admin/dataset/summary`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.detail || "No se ha podido obtener el resumen del dataset.",
        );
      }

      const data: DatasetSummary = await res.json();
      setSummary(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error desconocido al cargar el dataset.");
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleDownload = async () => {
    if (!summary || summary.file_count === 0) return;

    setDownloading(true);
    setError(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("No se ha podido obtener la sesión del usuario.");
      }

      const res = await fetch(`${API_URL}/admin/dataset/download`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.detail || "No se ha podido descargar el dataset.",
        );
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = "dataset_mamografias.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error al iniciar la descarga del dataset.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 shadow-lg shadow-indigo-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
              <Folder className="h-6 w-6" />
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Dataset de mamografías
              </h1>
              <p className="max-w-3xl text-sm text-indigo-50/90">
                Gestiona el conjunto de imágenes almacenado en Supabase
                Storage. Consulta el estado actual, revisa el número de
                archivos disponibles y descarga una copia comprimida del
                dataset.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link href="/admin/dashboard">
              <Button
                variant="outline"
                className="rounded-xl border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                ← Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* MÉTRICAS */}
      <section className="grid gap-6 md:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-indigo-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Bucket
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Database className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-900">
              {loading ? "—" : summary?.bucket || "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-violet-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Carpeta
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <FolderOpen className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-900">
              {loading ? "—" : summary?.prefix ? `${summary.prefix}/` : "—"}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-teal-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Imágenes disponibles
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Images className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-900">
              {loading ? "—" : (summary?.file_count ?? 0)}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* CARD PRINCIPAL */}
      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardHeader className="rounded-t-2xl border-b bg-slate-50/60">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Estado del dataset en Supabase Storage
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-5 px-6 py-6">
          {loading && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
              Cargando información del dataset...
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {!loading && !error && summary && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border bg-slate-50/70 px-4 py-4">
                  <p className="text-xs uppercase text-slate-500">Bucket</p>
                  <p className="mt-2 text-sm font-semibold">
                    {summary.bucket}
                  </p>
                </div>

                <div className="rounded-2xl border bg-slate-50/70 px-4 py-4">
                  <p className="text-xs uppercase text-slate-500">Carpeta</p>
                  <p className="mt-2 text-sm font-semibold">
                    {summary.prefix}/
                  </p>
                </div>

                <div className="rounded-2xl border bg-slate-50/70 px-4 py-4">
                  <p className="text-xs uppercase text-slate-500">
                    Total imágenes
                  </p>
                  <p className="mt-2 text-2xl font-semibold">
                    {summary.file_count}
                  </p>
                </div>
              </div>

              {summary.file_count === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  Todavía no hay imágenes en el dataset.
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">
                    Archivos detectados
                  </p>

                  <div className="max-h-72 overflow-y-auto rounded-2xl border bg-slate-50/40 p-3">
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {summary.filenames.map((filename) => (
                        <Card
                          key={filename}
                          className="rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03),0_4px_10px_-4px_rgba(15,23,42,0.10)]"
                        >
                          <CardContent className="truncate px-3 py-2.5 text-xs font-medium text-slate-700">
                            {filename}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t bg-slate-50/60 px-6 py-4 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={fetchSummary}
            disabled={loading}
          >
            {loading ? "Actualizando..." : "Actualizar contador"}
          </Button>

          <Button
            className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
            onClick={handleDownload}
            disabled={downloading || !summary || summary.file_count === 0}
          >
            {downloading ? "Preparando ZIP..." : "Descargar dataset (ZIP)"}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
