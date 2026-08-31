-- RLS para las tablas de BreastIA.
-- El backend FastAPI usa la service_role key (bypassa RLS por diseño);
-- estas políticas solo controlan lo que el frontend puede leer/escribir
-- directamente con la clave anon/authenticated de Supabase.

-- Función helper: evita recursión al comprobar profiles.role dentro de
-- políticas de otras tablas (y de la propia profiles), vía SECURITY DEFINER.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ============ profiles ============
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

-- Solo se permite auto-registrarse como "doctor" (nunca "admin"), para que
-- nadie pueda manipular el request de registro y autopromocionarse.
drop policy if exists "profiles_insert_self_doctor" on public.profiles;
create policy "profiles_insert_self_doctor"
on public.profiles for insert
to authenticated
with check (id = auth.uid() and role = 'doctor');

-- Sin policy de update/delete para authenticated: la gestión de usuarios
-- (incluida la promoción a admin) se hace solo vía backend con service_role.

-- ============ cases ============
alter table public.cases enable row level security;

drop policy if exists "cases_select_own_or_admin" on public.cases;
create policy "cases_select_own_or_admin"
on public.cases for select
to authenticated
using (created_by_user_id = auth.uid() or public.is_admin());

-- Sin policies de insert/update/delete para authenticated: todas las
-- mutaciones de casos pasan por el backend (service_role), que ya valida
-- ownership (get_owned_case_or_404) y rol (require_doctor_user).

-- ============ predictions ============
alter table public.predictions enable row level security;

drop policy if exists "predictions_select_admin" on public.predictions;
create policy "predictions_select_admin"
on public.predictions for select
to authenticated
using (public.is_admin());

-- ============ annotations ============
alter table public.annotations enable row level security;
-- Sin ninguna policy: solo accesible vía backend con service_role.

-- ============ storage: bucket "mamografias" (dataset de entrenamiento) ============
drop policy if exists "mamografias_admin_read" on storage.objects;
create policy "mamografias_admin_read"
on storage.objects for select
to authenticated
using (bucket_id = 'mamografias' and public.is_admin());
