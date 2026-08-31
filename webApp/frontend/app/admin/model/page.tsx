"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Activity, Bot, Check, HardDrive, Settings, X } from "lucide-react";

type FileInfo = {
  filename: string;
  size_kb?: number;
  size_mb?: number;
  last_modified?: number;
};

type BackupEntry = {
  filename: string;
  size_mb: number;
  created_at: number;
};

type ModelStatus = {
  predictor_loaded: boolean;
  cfg_file: FileInfo | null;
  weights_file: FileInfo | null;
  model_dir: string;
};

function formatTimestamp(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("es-ES");
}

export default function AdminModelPage() {
  const supabase = useMemo(() => createClient(), []);

  // --- Estado del modelo actual ---
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  // --- Backups ---
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loadingBackups, setLoadingBackups] = useState(true);

  // --- Subida de nuevo modelo ---
  const [weightsFile, setWeightsFile] = useState<File | null>(null);
  const [cfgFile, setCfgFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const weightsInputRef = useRef<HTMLInputElement>(null);
  const cfgInputRef = useRef<HTMLInputElement>(null);

  // --- Carga del estado del modelo ---
  const fetchStatus = async () => {
    setLoadingStatus(true);
    setStatusError(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("No se ha podido obtener la sesión del usuario.");
      }

      const res = await fetch(`${API_URL}/admin/model/status`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || "No se pudo obtener el estado del modelo.");
      }

      const data: ModelStatus = await res.json();
      setStatus(data);
    } catch (err: any) {
      setStatusError(err.message || "Error desconocido.");
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  };

  const fetchBackups = async () => {
    setLoadingBackups(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(`${API_URL}/admin/model/backups`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setBackups(data.backups || []);
    } catch {
      // los backups son solo informativos, se ignora el error
    } finally {
      setLoadingBackups(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchBackups();
  }, []);

  // --- Subida del nuevo modelo ---
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError(null);
    setUploadSuccess(null);

    if (!weightsFile || !cfgFile) {
      setUploadError("Debes seleccionar los dos archivos antes de subir.");
      return;
    }

    if (!weightsFile.name.endsWith(".pth")) {
      setUploadError("El archivo de pesos debe tener extensión .pth");
      return;
    }

    if (!cfgFile.name.endsWith(".yaml") && !cfgFile.name.endsWith(".yml")) {
      setUploadError("El archivo de configuración debe tener extensión .yaml");
      return;
    }

    setUploading(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        throw new Error("No se ha podido obtener la sesión del usuario.");
      }

      const formData = new FormData();
      formData.append("weights_file", weightsFile);
      formData.append("cfg_file", cfgFile);

      const res = await fetch(`${API_URL}/admin/model/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(body?.detail || "Error al subir el modelo.");
      }

      setUploadSuccess(body?.message || "Modelo actualizado correctamente.");
      setWeightsFile(null);
      setCfgFile(null);
      if (weightsInputRef.current) weightsInputRef.current.value = "";
      if (cfgInputRef.current) cfgInputRef.current.value = "";

      // Refrescar estado y backups tras la subida
      await fetchStatus();
      await fetchBackups();
    } catch (err: any) {
      setUploadError(err.message || "Error inesperado al subir el modelo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 shadow-lg shadow-indigo-900/10">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-4">
            <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
              <Bot className="h-6 w-6" />
            </div>

            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                Gestión del modelo IA
              </h1>
              <p className="max-w-3xl text-sm text-indigo-50/90">
                Consulta el estado del modelo activo y sube una nueva versión
                entrenada para que el sistema la use automáticamente.
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

      {/* MÉTRICAS DE ESTADO */}
      <section className="grid gap-6 md:grid-cols-3">
        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-indigo-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Estado del predictor
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Activity className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              {loadingStatus ? (
                <p className="text-2xl font-semibold text-slate-400">—</p>
              ) : status?.predictor_loaded ? (
                <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Activo
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700">
                  <span className="h-2 w-2 rounded-full bg-red-500" />
                  No cargado
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-violet-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Pesos del modelo (.pth)
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                <HardDrive className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              {loadingStatus ? (
                <p className="text-2xl font-semibold text-slate-400">—</p>
              ) : status?.weights_file ? (
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {status.weights_file.filename}
                  </p>
                  <p className="text-xs text-slate-500">
                    {status.weights_file.size_mb} MB
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatTimestamp(status.weights_file.last_modified)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No encontrado</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
          <div className="h-1.5 w-full bg-teal-500" />
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Configuración (.yaml)
              </p>
              <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                <Settings className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              {loadingStatus ? (
                <p className="text-2xl font-semibold text-slate-400">—</p>
              ) : status?.cfg_file ? (
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {status.cfg_file.filename}
                  </p>
                  <p className="text-xs text-slate-500">
                    {status.cfg_file.size_kb} KB
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    {formatTimestamp(status.cfg_file.last_modified)}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-slate-400">No encontrado</p>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {statusError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {statusError}
        </div>
      )}

      {/* FORMULARIO DE SUBIDA */}
      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardHeader className="rounded-t-2xl border-b bg-slate-50/60">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Subir nuevo modelo entrenado
          </CardTitle>
        </CardHeader>

        <form onSubmit={handleUpload}>
          <CardContent className="space-y-6 px-6 py-6">
            <p className="text-sm text-slate-500">
              Sube los dos archivos generados tras el reentrenamiento. El servidor
              hará un backup del modelo actual y cargará el nuevo automáticamente
              sin necesidad de reiniciar.
            </p>

            {/* Archivo de pesos */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Archivo de pesos{" "}
                <span className="text-slate-400 font-normal">(.pth)</span>
              </label>
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500 transition hover:border-teal-400 hover:bg-teal-50">
                  {weightsFile ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                      <Check className="h-4 w-4 text-emerald-600" />
                      {weightsFile.name}{" "}
                      <span className="font-normal text-slate-500">
                        ({(weightsFile.size / (1024 * 1024)).toFixed(1)} MB)
                      </span>
                    </span>
                  ) : (
                    "Haz clic para seleccionar model_final.pth"
                  )}
                  <input
                    ref={weightsInputRef}
                    type="file"
                    accept=".pth"
                    className="hidden"
                    onChange={(e) =>
                      setWeightsFile(e.target.files?.[0] ?? null)
                    }
                  />
                </label>
                {weightsFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setWeightsFile(null);
                      if (weightsInputRef.current)
                        weightsInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Archivo de configuración */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-slate-700">
                Archivo de configuración{" "}
                <span className="text-slate-400 font-normal">(.yaml)</span>
              </label>
              <div className="flex items-center gap-3">
                <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-500 transition hover:border-teal-400 hover:bg-teal-50">
                  {cfgFile ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
                      <Check className="h-4 w-4 text-emerald-600" />
                      {cfgFile.name}{" "}
                      <span className="font-normal text-slate-500">
                        ({(cfgFile.size / 1024).toFixed(1)} KB)
                      </span>
                    </span>
                  ) : (
                    "Haz clic para seleccionar detectron.cfg.yaml"
                  )}
                  <input
                    ref={cfgInputRef}
                    type="file"
                    accept=".yaml,.yml"
                    className="hidden"
                    onChange={(e) => setCfgFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                {cfgFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setCfgFile(null);
                      if (cfgInputRef.current)
                        cfgInputRef.current.value = "";
                    }}
                    className="text-slate-400 hover:text-slate-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Mensajes de feedback */}
            {uploadError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
                {uploadError}
              </div>
            )}

            {uploadSuccess && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                <Check className="h-4 w-4 flex-shrink-0" />
                {uploadSuccess}
              </div>
            )}

            {/* Aviso de backup */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              El modelo actual se guardará automáticamente como backup en{" "}
              <code className="rounded bg-amber-100 px-1">model/backups/</code>{" "}
              antes de ser reemplazado.
            </div>
          </CardContent>

          <CardFooter className="flex justify-between gap-3 border-t bg-slate-50/60 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={fetchStatus}
              disabled={loadingStatus || uploading}
            >
              {loadingStatus ? "Actualizando..." : "Actualizar estado"}
            </Button>

            <Button
              type="submit"
              className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
              disabled={uploading || !weightsFile || !cfgFile}
            >
              {uploading ? "Subiendo modelo..." : "Subir y activar modelo"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* HISTORIAL DE BACKUPS */}
      <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
        <CardHeader className="rounded-t-2xl border-b bg-slate-50/60">
          <CardTitle className="text-lg font-semibold text-slate-900">
            Historial de backups
          </CardTitle>
        </CardHeader>

        <CardContent className="px-6 py-6">
          {loadingBackups ? (
            <p className="text-sm text-slate-500">Cargando backups...</p>
          ) : backups.length === 0 ? (
            <p className="text-sm text-slate-400">
              Aún no hay backups. Se crearán automáticamente al subir un nuevo modelo.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {backups.map((b) => (
                <Card
                  key={b.filename}
                  className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="h-1.5 w-full bg-indigo-500" />
                  <CardContent className="space-y-2 p-4">
                    <p className="truncate text-sm font-medium text-slate-800">
                      {b.filename}
                    </p>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{b.size_mb} MB</span>
                      <span>{formatTimestamp(b.created_at)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
