"use client";

import React, { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        setErrorMsg("Error al iniciar sesión. Verifica tus credenciales.");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();

      if (profileError || !profile) {
        setErrorMsg("No se ha encontrado el perfil del usuario.");
        return;
      }

      const nextPath = searchParams.get("next");
      if (nextPath) {
        router.replace(nextPath);
        router.refresh();
        return;
      }

      if (profile.role === "doctor") {
        router.replace("/doctor/dashboard");
        router.refresh();
        return;
      }

      if (profile.role === "admin") {
        router.replace("/admin/dashboard");
        router.refresh();
        return;
      }

      setErrorMsg("El rol del usuario no es válido.");
    } catch (err) {
      console.error(err);
      setErrorMsg("Ha ocurrido un error inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_35%),radial-gradient(circle_at_bottom,_rgba(168,85,247,0.12),_transparent_30%)]" />
      <div className="absolute inset-0 bg-grid-white/[0.03]" />

      <Card className="relative z-10 w-full max-w-md border-white/10 bg-white/95 shadow-2xl backdrop-blur">
        <CardHeader className="space-y-3 text-center pb-2">
          <div className="mb-1 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Breast<span className="text-teal-600">IA</span>
            </h1>
          </div>

          <CardTitle className="text-2xl font-bold tracking-tight text-slate-900">
            Iniciar sesión
          </CardTitle>

          <CardDescription className="text-sm text-slate-600">
            Accede a tu panel para gestionar casos e informes
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleLogin}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="tuemail@ejemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-11 rounded-xl border-slate-200 bg-white/80 focus-visible:ring-2 focus-visible:ring-slate-400"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-slate-700"
              >
                Contraseña
              </label>
              <Input
                id="password"
                type="password"
                placeholder="Introduce tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="h-11 rounded-xl border-slate-200 bg-white/80 focus-visible:ring-2 focus-visible:ring-slate-400"
              />
            </div>

            {errorMsg && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {errorMsg}
              </div>
            )}
          </CardContent>

          <CardFooter className="mt-4 pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-teal-600 text-white transition hover:bg-teal-700"
            >
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
