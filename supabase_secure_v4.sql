-- ============================================================
-- RESPECT DES LIEUX — SUPABASE SECURE V4.2
-- ============================================================
-- Migration idempotente :
-- - conserve RLS ACTIVE ;
-- - réserve les tables au rôle authenticated ;
-- - protège le bucket rl-photos ;
-- - ajoute les index utiles aux lectures de l'application.
--
-- IMPORTANT :
-- 1) ne jamais utiliser ALTER TABLE ... DISABLE ROW LEVEL SECURITY ;
-- 2) exécuter ce fichier seulement lorsque la base répond de nouveau ;
-- 3) faire une sauvegarde avant toute intervention de production.
-- ============================================================

begin;

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
  created_at timestamptz default now()
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
  created_at timestamptz default now()
);

alter table public.signalements enable row level security;
alter table public.reparations enable row level security;

revoke all on table public.signalements from anon;
revoke all on table public.reparations from anon;

grant select, insert, update, delete on table public.signalements to authenticated;
grant select, insert, update, delete on table public.reparations to authenticated;

drop policy if exists "rl_signalements_authenticated" on public.signalements;
create policy "rl_signalements_authenticated"
on public.signalements
for all
to authenticated
using (true)
with check (true);

drop policy if exists "rl_reparations_authenticated" on public.reparations;
create policy "rl_reparations_authenticated"
on public.reparations
for all
to authenticated
using (true)
with check (true);

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
on conflict (id) do update
set public = false;

drop policy if exists "rl_photos_select" on storage.objects;
drop policy if exists "rl_photos_insert" on storage.objects;
drop policy if exists "rl_photos_update" on storage.objects;
drop policy if exists "rl_photos_delete" on storage.objects;

create policy "rl_photos_select"
on storage.objects
for select
to authenticated
using (bucket_id = 'rl-photos');

create policy "rl_photos_insert"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'rl-photos');

create policy "rl_photos_update"
on storage.objects
for update
to authenticated
using (bucket_id = 'rl-photos')
with check (bucket_id = 'rl-photos');

create policy "rl_photos_delete"
on storage.objects
for delete
to authenticated
using (bucket_id = 'rl-photos');

commit;
