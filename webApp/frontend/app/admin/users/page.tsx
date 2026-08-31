"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { API_URL } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { ShieldCheck, UserPlus, Users as UsersIcon, X } from "lucide-react";

type UserItem = {
  id: string;
  full_name: string | null;
  role: string | null;
  email?: string | null;
  created_at?: string | null;
};

export default function AdminUsersPage() {
  const supabase = useMemo(() => createClient(), []);

  const [users, setUsers] = useState<UserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const [openModal, setOpenModal] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"doctor" | "admin">("doctor");

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoadingUsers(true);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        console.error("No se pudo obtener la sesión.");
        setUsers([]);
        return;
      }

      const res = await fetch(`${API_URL}/admin/users`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Error cargando usuarios:", data);
        setUsers([]);
        return;
      }

      setUsers(data || []);
    } catch (error) {
      console.error("Error cargando usuarios:", error);
      setUsers([]);
    } finally {
      setLoadingUsers(false);
    }
  };

  const resetForm = () => {
    setFullName("");
    setEmail("");
    setPassword("");
    setRole("doctor");
    setErrorMsg(null);
    setSuccessMsg(null);
  };

  const closeModal = () => {
    setOpenModal(false);
    setSubmitting(false);
    resetForm();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();

      if (sessionError || !session?.access_token) {
        setErrorMsg("No se ha podido obtener la sesión del usuario.");
        return;
      }

      const res = await fetch(`${API_URL}/admin/users`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password,
          role,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data?.detail || data?.error || "Error al crear usuario");
        return;
      }

      setSuccessMsg("Usuario creado correctamente.");

      // Actualización inmediata en la tabla
      if (data?.profile || data?.user) {
        const newUser = {
          id: data.profile?.id || data.user?.id,
          full_name:
            data.profile?.full_name || data.user?.full_name || fullName,
          role: data.profile?.role || data.user?.role || role,
          created_at: data.profile?.created_at || new Date().toISOString(),
        };

        setUsers((prev) => [newUser, ...prev]);
      } else {
        await loadUsers();
      }

      setTimeout(() => {
        closeModal();
      }, 1000);
    } catch (err) {
      console.error(err);
      setErrorMsg("Ha ocurrido un error inesperado.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatRole = (roleValue: string | null) => {
    if (roleValue === "admin") return "Administrador";
    if (roleValue === "doctor") return "Doctor";
    return "Sin rol";
  };

  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    return date.toLocaleDateString("es-ES");
  };

  return (
    <>
      <div className="space-y-8">
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-700 shadow-lg shadow-indigo-900/10">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div className="flex items-center gap-4">
              <div className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white backdrop-blur-sm">
                <UsersIcon className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                  Gestión de usuarios
                </h1>
                <p className="max-w-3xl text-sm text-indigo-50/90">
                  Alta y control de acceso para doctores y administradores
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

              <Button
                onClick={() => {
                  resetForm();
                  setOpenModal(true);
                }}
                className="gap-1.5 rounded-xl bg-white text-indigo-700 hover:bg-indigo-50"
              >
                <UserPlus className="h-4 w-4" />
                Registrar usuario
              </Button>
            </div>
          </div>
        </section>

        {/* TARJETAS RESUMEN */}
        <section className="grid gap-6 md:grid-cols-2">
          <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
            <div className="h-1.5 w-full bg-indigo-500" />
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Usuarios registrados
                </p>
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <UsersIcon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3 text-3xl font-semibold text-slate-900">
                {loadingUsers ? "—" : users.length}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06),0_20px_35px_-10px_rgba(15,23,42,0.18)]">
            <div className="h-1.5 w-full bg-violet-500" />
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Administración
                </p>
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                  <ShieldCheck className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-600 leading-6">
                Desde aquí puedes crear nuevas cuentas y asignar permisos dentro
                de BreastIA.
              </p>
            </CardContent>
          </Card>
        </section>

        {/* LISTADO */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              Usuarios del sistema
            </h2>
          </div>

          {loadingUsers ? (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardContent className="px-6 py-10 text-center text-sm text-slate-500">
                Cargando usuarios...
              </CardContent>
            </Card>
          ) : users.length === 0 ? (
            <Card className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)]">
              <CardContent className="px-6 py-10 text-center text-sm text-slate-500">
                No hay usuarios registrados todavía.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {users.map((user) => {
                const isAdmin = user.role === "admin";
                const initials = (user.full_name || "?")
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0]?.toUpperCase())
                  .join("");

                return (
                  <Card
                    key={user.id}
                    className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_25px_-8px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div
                      className={`h-1.5 w-full ${isAdmin ? "bg-violet-500" : "bg-teal-500"}`}
                    />
                    <CardContent className="flex items-start gap-4 p-5">
                      <div
                        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                          isAdmin
                            ? "bg-violet-100 text-violet-700"
                            : "bg-teal-100 text-teal-700"
                        }`}
                      >
                        {initials || "?"}
                      </div>

                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {user.full_name || "Sin nombre"}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          ID: {user.id}
                        </p>

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <span
                            className={`rounded-full px-3 py-1 text-xs font-medium ${
                              isAdmin
                                ? "bg-violet-100 text-violet-700"
                                : "bg-teal-100 text-teal-700"
                            }`}
                          >
                            {formatRole(user.role)}
                          </span>
                          <span className="text-xs text-slate-500">
                            Alta: {formatDate(user.created_at)}
                          </span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* MODAL */}
      {openModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div>
                <h2 className="text-xl font-semibold tracking-tight text-slate-900">
                  Registrar nuevo usuario
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Crea una nueva cuenta dentro del sistema
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUser}>
              <div className="space-y-5 px-6 py-6">
                <div className="space-y-2">
                  <label
                    htmlFor="full_name"
                    className="text-sm font-medium text-slate-700"
                  >
                    Nombre completo
                  </label>
                  <Input
                    id="full_name"
                    placeholder="Nombre y apellidos"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="h-11 rounded-xl border-slate-200"
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
                    placeholder="usuario@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-11 rounded-xl border-slate-200"
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
                    placeholder="Introduce una contraseña"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="h-11 rounded-xl border-slate-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="role"
                    className="text-sm font-medium text-slate-700"
                  >
                    Rol
                  </label>
                  <select
                    id="role"
                    value={role}
                    onChange={(e) =>
                      setRole(e.target.value as "doctor" | "admin")
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="doctor">Doctor</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                {errorMsg && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                    {errorMsg}
                  </div>
                )}

                {successMsg && (
                  <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                    {successMsg}
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse gap-3 border-t bg-slate-50/60 px-6 py-4 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeModal}
                  disabled={submitting}
                  className="rounded-xl border-slate-300"
                >
                  Cancelar
                </Button>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  {submitting ? "Guardando..." : "Crear usuario"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
