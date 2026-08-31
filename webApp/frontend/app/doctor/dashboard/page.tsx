// app/doctor/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity,
  AlertTriangle,
  FilePlus2,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Sparkles,
} from "lucide-react";

export default function DoctorDashboard() {
  const supabase = useMemo(() => createClient(), []);
  const [totalCases, setTotalCases] = useState<number>(0);
  const [analyzedCases, setAnalyzedCases] = useState<number>(0);
  const [loadingCounts, setLoadingCounts] = useState<boolean>(true);

  useEffect(() => {
    const fetchCounts = async () => {
      setLoadingCounts(true);

      // Obtener el usuario autenticado
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error("Error obteniendo usuario:", userError);
        setLoadingCounts(false);
        return;
      }

      const userId = userData.user.id;

      // Traer solo los casos del doctor autenticado
      const { data, error } = await supabase
        .from("cases")
        .select("id, model_score")
        .eq("created_by_user_id", userId);

      if (error) {
        console.error("Error obteniendo casos:", error);
        setLoadingCounts(false);
        return;
      }

      const total = data?.length ?? 0;
      const analyzed = data?.filter((c) => c.model_score !== null).length ?? 0;

      setTotalCases(total);
      setAnalyzedCases(analyzed);
      setLoadingCounts(false);
    };

    fetchCounts();
  }, []);

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-teal-600 to-cyan-700 shadow-lg shadow-teal-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
              <LayoutDashboard className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Panel del doctor
              </h1>
              <p className="max-w-3xl text-sm text-teal-50/90">
                Prototipo de sistema de apoyo al diagnóstico de cáncer de mama.
                Desde este panel podrás gestionar los casos de ejemplo y
                visualizar los resultados generados por el modelo de IA.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DISCLAIMER MÉDICO */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-semibold text-amber-800">
            Sistema experimental. Requiere validación médica
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            Las predicciones generadas por el modelo de IA son un apoyo al
            diagnóstico y no sustituyen el criterio clínico de un radiólogo
            especialista. Todos los resultados deben ser revisados y validados
            por un profesional médico antes de tomar cualquier decisión clínica.
          </p>
        </div>
      </div>

      {/* Tarjetas de "estado" simplificadas */}
      <section className="grid gap-4 md:grid-cols-3">
        {/* Mis casos */}
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <div className="h-1.5 w-full bg-teal-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Mis casos
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <FolderOpen className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-slate-900">
              {loadingCounts ? "…" : totalCases}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Número de estudios registrados por ti en el sistema.
            </p>
          </CardContent>
        </Card>

        {/* Casos analizados por la IA */}
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <div className="h-1.5 w-full bg-cyan-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Casos analizados por la IA
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-3xl font-semibold text-cyan-600">
              {loadingCounts ? "…" : analyzedCases}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Casos en los que se ha ejecutado el modelo de aprendizaje
              automático (es decir, con una predicción generada).
            </p>
          </CardContent>
        </Card>

        {/* Info de versión */}
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
          <div className="h-1.5 w-full bg-slate-300" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Prototipo en desarrollo
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                <Sparkles className="h-4 w-4" />
              </div>
            </div>
            <p className="mt-3 text-lg font-semibold text-slate-900">
              Versión TFG
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Esta interfaz se ha diseñado como parte del Trabajo Fin de Grado.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Acciones principales */}
      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold text-slate-900">
            Acciones principales
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Usa estas opciones para trabajar con los casos de ejemplo del
            sistema.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/doctor/cases/newCase"
              className="inline-flex items-center gap-1.5 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100"
            >
              <FilePlus2 className="h-3.5 w-3.5" />
              Crear nuevo caso de ejemplo
            </Link>
            <Link
              href="/doctor/cases"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Ver casos registrados
            </Link>
            <Link
              href="/doctor/informes"
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              <FileText className="h-3.5 w-3.5" />
              Ver informes generados
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Bloque informativo tipo TFG */}
      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold text-slate-900">
            Información sobre el prototipo
          </h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Este sistema forma parte de un Trabajo Fin de Grado centrado en la
            integración de un modelo de aprendizaje automático para el apoyo
            al diagnóstico del cáncer de mama. Los datos mostrados en este
            entorno son de prueba y su objetivo es ilustrar el flujo completo:
            subida de imagen, inferencia con el modelo y presentación de
            resultados.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
