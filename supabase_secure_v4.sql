-- ============================================================
-- RESPECT DES LIEUX — SUPABASE SECURE V4.2
-- ============================================================
-- Reproduit l'architecture du projet respect-des-lieux-v2.
-- RLS reste ACTIVE. Aucun accès aux données n'est accordé au rôle anon.
-- Les comptes Auth ne sont pas suffisants : leur e-mail doit aussi figurer
-- dans public.authorized_users.
-- ============================================================

begin;

create table if not exists public.authorized_users (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Compte initial autorisé. Ajouter les autres personnels explicitement ici
-- ou depuis le SQL Editor.
insert into public.authorized_users (email, active)
values ('elise.sattolo@ac-lille.fr', true)
on conflict (email) do update set active = excluded.active;

alter table public.authorized_users enable row level security;
revoke all on table public.authorized_users from anon;
grant select on table public.authorized_users to authenticated;

drop policy if exists "authorized_users_read_own" on public.authorized_users;
create policy "authorized_users_read_own"
on public.authorized_users
for select
to authenticated
using (
  lower(email) = lower(coalesce((select auth.jwt())->>'email',''))
);

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

create or replace function private.is_authorized_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.authorized_users
    where active
      and lower(email) = lower(coalesce((select auth.jwt())->>'email',''))
  );
$$;

revoke all on function private.is_authorized_user() from public;
revoke all on function private.is_authorized_user() from anon;
grant execute on function private.is_authorized_user() to authenticated;

create table if not exists public.signalements (
  id bigint primary key,
  num text,
  date text,
  heure text,
  lieu text,
  type text,
  gravite text,
  signale_par text,
  description text,
  eleve text,
  classe text,
  famille text,
  photos_urls text[],
  statut text default 'Ouvert',
  created_at timestamptz not null default now()
);

create table if not exists public.reparations (
  id bigint primary key,
  signa_id bigint,
  mesure text,
  referent text,
  debut text,
  duree text,
  notes text,
  cloture text,
  statut text default 'En cours',
  created_at timestamptz not null default now()
);

alter table public.signalements enable row level security;
alter table public.reparations enable row level security;

revoke all on table public.signalements from anon;
revoke all on table public.reparations from anon;
grant select, insert, update, delete on table public.signalements to authenticated;
grant select, insert, update, delete on table public.reparations to authenticated;

drop policy if exists "rl_signalements_authorized" on public.signalements;
create policy "rl_signalements_authorized"
on public.signalements
for all
to authenticated
using ((select private.is_authorized_user()))
with check ((select private.is_authorized_user()));

drop policy if exists "rl_reparations_authorized" on public.reparations;
create policy "rl_reparations_authorized"
on public.reparations
for all
to authenticated
using ((select private.is_authorized_user()))
with check ((select private.is_authorized_user()));

create index if not exists signalements_created_at_idx
  on public.signalements (created_at desc);
create index if not exists signalements_date_idx
  on public.signalements (date desc);
create index if not exists signalements_statut_idx
  on public.signalements (statut);

create index if not exists reparations_created_at_idx
  on public.reparations (created_at desc);
create index if not exists reparations_signa_id_idx
  on public.reparations (signa_id);
create index if not exists reparations_statut_idx
  on public.reparations (statut);

insert into storage.buckets (id, name, public)
values ('rl-photos', 'rl-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "rl_photos_select" on storage.objects;
drop policy if exists "rl_photos_insert" on storage.objects;
drop policy if exists "rl_photos_update" on storage.objects;
drop policy if exists "rl_photos_delete" on storage.objects;

create policy "rl_photos_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rl-photos'
  and (select private.is_authorized_user())
);

create policy "rl_photos_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rl-photos'
  and (select private.is_authorized_user())
);

create policy "rl_photos_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'rl-photos'
  and (select private.is_authorized_user())
)
with check (
  bucket_id = 'rl-photos'
  and (select private.is_authorized_user())
);

create policy "rl_photos_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'rl-photos'
  and (select private.is_authorized_user())
);

drop function if exists public.is_authorized_user();

commit;
