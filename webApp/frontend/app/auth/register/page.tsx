"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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

export default function RegisterPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error || !data.user) {
      console.error(error);
      setErrorMsg("Error al registrar el usuario.");
      setLoading(false);
      return;
    }

    const user = data.user;

    const { error: profileError } = await supabase.from("profiles").insert([
      {
        id: user.id,
        full_name: fullName,
        role: "doctor",
      },
    ]);

    if (profileError) {
      console.error(profileError);
      setErrorMsg(
        "Usuario creado, pero hubo un error al crear el perfil del usuario."
      );
      setLoading(false);
      return;
    }

    setSuccessMsg("Usuario registrado exitosamente. Redirigiendo al login...");
    setLoading(false);

    setTimeout(() => {
      router.push("/auth/login");
    }, 1500);
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
            Crear cuenta
          </CardTitle>

          <CardDescription className="text-sm text-slate-600">
            Regístrate para gestionar casos e informes
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleRegister}>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <label
                htmlFor="fullName"
                className="text-sm font-medium text-slate-700"
              >
                Nombre completo
              </label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre y apellidos"
                required
                className="h-11 rounded-xl border-slate-200 bg-white/80 focus-visible:ring-2 focus-visible:ring-slate-400"
              />
            </div>

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
                placeholder="Crea una contraseña"
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

            {successMsg && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {successMsg}
              </div>
            )}

            <p className="text-center text-xs text-slate-500">
              ¿Ya tienes cuenta?{" "}
              <button
                type="button"
                className="font-medium text-teal-600 underline-offset-2 hover:underline"
                onClick={() => router.push("/auth/login")}
              >
                Inicia sesión
              </button>
            </p>
          </CardContent>

          <CardFooter className="mt-4 pt-2">
            <Button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl bg-teal-600 text-white transition hover:bg-teal-700"
            >
              {loading ? "Creando cuenta..." : "Registrarse"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
