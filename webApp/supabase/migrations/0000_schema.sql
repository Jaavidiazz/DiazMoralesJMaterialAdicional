-- Esquema base de BreastIA.
--
-- Reconstruido a partir del uso real de las tablas en el backend y de las
-- políticas RLS de 0001_rls_policies.sql, no de un volcado directo de la
-- base de datos. Antes de darlo por idéntico a producción conviene
-- compararlo con `supabase db dump`. Sirve para levantar un entorno de
-- desarrollo o de test desde cero.
--
-- Se usa `create table if not exists` para poder aplicarlo sobre un
-- proyecto Supabase que ya tenga estas tablas.

-- ============ profiles ============
-- Perfil de aplicación 1:1 con auth.users (id compartido).
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text,
    role text not null check (role in ('doctor', 'admin')),
    created_at timestamptz not null default now()
);

-- ============ cases ============
create table if not exists public.cases (
    id bigserial primary key,
    patient text,
    age integer,
    breast_side text,
    doctor_comment text,
    image_url text,
    storage_path text,
    storage_public_url text,
    model_score double precision,
    model_metadata jsonb,
    report_text text,
    report_visible boolean not null default false,
    created_by_user_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now()
);

create index if not exists cases_created_by_user_id_idx on public.cases (created_by_user_id);
create index if not exists cases_created_at_idx on public.cases (created_at desc);

-- ============ predictions ============
create table if not exists public.predictions (
    id bigserial primary key,
    case_id bigint not null references public.cases(id) on delete cascade,
    model_name text not null,
    classification text not null,
    prob_maligna double precision,
    confidence double precision,
    raw_outputs jsonb,
    created_at timestamptz not null default now()
);

create index if not exists predictions_case_id_idx on public.predictions (case_id);

-- ============ annotations ============
-- Correcciones/anotaciones de un doctor sobre la predicción del modelo
-- (feedback humano, útil para reentrenar/evaluar el modelo).
create table if not exists public.annotations (
    id bigserial primary key,
    case_id bigint not null references public.cases(id) on delete cascade,
    is_correct boolean not null,
    final_label text,
    final_category_id integer,
    bbox jsonb,
    notes text,
    created_at timestamptz not null default now()
);

create index if not exists annotations_case_id_idx on public.annotations (case_id);

-- ============ audit_log ============
-- Traza mínima de acceso a casos clínicos (quién accedió o modificó qué
-- caso y cuándo). No es un sistema de auditoría con garantías legales,
-- pero permite saber quién ha tocado un caso y detectar accesos anómalos.
create table if not exists public.audit_log (
    id bigserial primary key,
    case_id bigint references public.cases(id) on delete set null,
    user_id uuid references public.profiles(id) on delete set null,
    action text not null,
    allowed boolean not null default true,
    detail text,
    created_at timestamptz not null default now()
);

create index if not exists audit_log_case_id_idx on public.audit_log (case_id);
create index if not exists audit_log_user_id_idx on public.audit_log (user_id);
create index if not exists audit_log_created_at_idx on public.audit_log (created_at desc);

-- RLS activado sin policies: solo accesible vía backend con service_role
-- (igual que annotations). El frontend nunca debe leer/escribir logs de
-- auditoría directamente.
alter table public.audit_log enable row level security;
