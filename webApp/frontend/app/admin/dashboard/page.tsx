"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import {
  Bot,
  CheckCircle2,
  Clock,
  Database,
  Images,
  LayoutDashboard,
  Layers,
  Users,
} from "lucide-react";

type Metrics = {
  totalCases: number;
  analyzedCases: number;
  pendingCases: number;
  datasetCount: number;
};

export default function AdminDashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);

      // 1) Total de casos
      const { count: totalCases, error: totalError } = await supabase
        .from("cases")
        .select("*", { count: "exact", head: true });

      if (totalError) {
        console.error("Error contando casos:", totalError);
      }

      // 2) Obtener case_id de predictions y contar casos únicos analizados
      const { data: predictionRows, error: predictionsError } = await supabase
        .from("predictions")
        .select("case_id");

      if (predictionsError) {
        console.error("Error obteniendo predicciones:", predictionsError);
      }

      const uniqueCaseIds = new Set(
        (predictionRows ?? [])
          .map((row) => row.case_id)
          .filter((value) => value !== null && value !== undefined),
      );

      const analyzedCases = uniqueCaseIds.size;

      // 3) Pendientes
      const safeTotalCases = totalCases ?? 0;
      const pendingCases = Math.max(0, safeTotalCases - analyzedCases);

      // 4) Archivos del dataset: se piden al backend (mismo endpoint que
      // usa /admin/dataset) para no depender de las políticas RLS del
      // bucket desde el navegador.
      let datasetCount = 0;
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        try {
          const res = await fetch(`${API_URL}/admin/dataset/summary`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
            cache: "no-store",
          });
          if (res.ok) {
            const summary = await res.json();
            datasetCount = summary.file_count ?? 0;
          }
        } catch (err) {
          console.error("Error obteniendo dataset:", err);
        }
      }

      setMetrics({
        totalCases: safeTotalCases,
        analyzedCases,
        pendingCases,
        datasetCount,
      });
    } catch (error) {
      console.error("Error cargando métricas:", error);
      setMetrics({
        totalCases: 0,
        analyzedCases: 0,
        pendingCases: 0,
        datasetCount: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  const m = metrics ?? {
    totalCases: 0,
    analyzedCases: 0,
    pendingCases: 0,
    datasetCount: 0,
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 shadow-lg shadow-indigo-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Panel de administración
              </h1>
              <p className="max-w-3xl text-sm text-indigo-50/90">
                Resumen general del sistema y accesos rápidos de gestión
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* MÉTRICAS */}
      <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-indigo-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Casos registrados
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Layers className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {loading ? "…" : m.totalCases}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-emerald-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Casos analizados
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-emerald-600">
              {loading ? "…" : m.analyzedCases}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-amber-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Casos pendientes
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Clock className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-amber-600">
              {loading ? "…" : m.pendingCases}
            </p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-slate-300" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Imágenes del dataset
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Images className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {loading ? "…" : m.datasetCount}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* BLOQUES INFORMATIVOS */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-900">
              Estado del sistema
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600">
            <p>
              Aquí puedes controlar la evolución de los casos registrados,
              revisar cuántos han sido procesados por el modelo y acceder a la
              gestión interna de usuarios y dataset.
            </p>
            <p>
              Los contadores reflejan casos únicos analizados, evitando
              duplicados producidos por múltiples predicciones sobre un mismo
              caso.
            </p>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <CardHeader>
            <CardTitle className="text-lg font-semibold text-slate-900">
              Acciones rápidas
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link href="/admin/users">
              <Button className="gap-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                <Users className="h-4 w-4" />
                Usuarios
              </Button>
            </Link>

            <Link href="/admin/dataset">
              <Button
                variant="outline"
                className="gap-1.5 rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <Database className="h-4 w-4" />
                Dataset
              </Button>
            </Link>

            <Link href="/admin/model">
              <Button
                variant="outline"
                className="gap-1.5 rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <Bot className="h-4 w-4" />
                Modelos
              </Button>
            </Link>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
