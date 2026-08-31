"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/utils";
import {
  Bot,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

const adminLinks = [
  { href: "/admin/dashboard", label: "Resumen", icon: LayoutDashboard },
  { href: "/admin/users", label: "Usuarios", icon: Users },
  { href: "/admin/dataset", label: "Dataset", icon: Database },
  { href: "/admin/model", label: "Modelos", icon: Bot },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loggingOut, setLoggingOut] = useState(false);
  const [initials, setInitials] = useState("AD");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const loadProfile = async () => {
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError) {
        console.error("Error obteniendo usuario:", userError);
        return;
      }

      const user = userData.user;
      if (!user) return;

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .single();

      if (profileError) {
        console.error("Error obteniendo perfil:", profileError);
      }

      const fullName = profile?.full_name ?? null;
      const newInitials = getInitials(fullName, user.email, "AD");
      setInitials(newInitials);
    };

    loadProfile();
  }, [supabase]);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);

      const { error } = await supabase.auth.signOut();

      if (error) {
        console.error("Error cerrando sesión:", error);
        return;
      }

      router.replace("/auth/login");
      router.refresh();
    } catch (error) {
      console.error("Error inesperado al cerrar sesión:", error);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-slate-100 to-slate-50">
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm md:hidden"
          onClick={() => setMobileNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-shrink-0 -translate-x-full flex-col overflow-hidden bg-gradient-to-b from-slate-900 to-slate-800 text-slate-100 shadow-xl transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 ${
          mobileNavOpen ? "translate-x-0" : ""
        }`}
      >
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />

        <div className="relative flex items-center justify-between gap-3 px-6 pt-7 pb-5">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/30">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-white">
                BreastIA
              </p>
              <p className="text-xs text-slate-400">Panel de administración</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mx-4 h-px bg-white/10" />

        <nav className="relative flex-1 space-y-1 px-3 py-5">
          {adminLinks.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link key={link.href} href={link.href}>
                <span
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-indigo-500 text-white shadow-md shadow-indigo-500/20"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {link.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="relative mx-4 h-px bg-white/10" />

        <div className="relative px-4 py-4">
          <div className="mb-3 flex items-center gap-2.5 rounded-xl bg-white/5 px-3 py-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-300">
              {initials}
            </div>
            <p className="truncate text-xs text-slate-300">Sesión activa</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Cerrando sesión..." : "Cerrar sesión"}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500 text-white">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <p className="text-sm font-semibold text-slate-900">BreastIA</p>
        </header>

        <main className="flex-1 overflow-y-auto p-6 [background-image:radial-gradient(circle_at_1px_1px,rgba(15,23,42,0.045)_1px,transparent_0)] [background-size:22px_22px] md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
