-- ============================================================
-- RESPECT DES LIEUX — SUPABASE SECURE V4.3
-- ============================================================
-- Reproduit l'architecture de production du projet
-- respect-des-lieux-v2.
--
-- Principes V4.3 :
-- - RLS reste ACTIVE ;
-- - aucun accès métier au rôle anon ;
-- - seuls les e-mails explicitement autorisés peuvent créer
--   un compte Auth et lire/écrire les données ;
-- - aucune suppression métier n'est accordée au navigateur ;
-- - photos privées, JPEG uniquement, 3 Mo maximum, 2 par dossier ;
-- - longueurs de texte bornées côté base ;
-- - contraintes et index nécessaires aux requêtes du front.
-- ============================================================

begin;

create table if not exists public.authorized_users (
  email text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.authorized_users (email, active)
values ('elise.sattolo@ac-lille.fr', true)
on conflict (email) do update set active = excluded.active;

create unique index if not exists authorized_users_email_lower_uidx
  on public.authorized_users (lower(email));

alter table public.authorized_users
  drop constraint if exists authorized_users_email_length,
  add constraint authorized_users_email_length
    check (char_length(email) <= 320);

alter table public.authorized_users enable row level security;
revoke all on table public.authorized_users from anon;
revoke all on table public.authorized_users from authenticated;
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

create or replace function private.enforce_authorized_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is null
     or not exists (
       select 1
       from public.authorized_users
       where active
         and lower(email) = lower(new.email)
     )
  then
    raise exception 'AUTH_EMAIL_NOT_AUTHORIZED'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_authorized_auth_user() from public;
revoke all on function private.enforce_authorized_auth_user() from anon;
revoke all on function private.enforce_authorized_auth_user() from authenticated;

drop trigger if exists rl_enforce_authorized_auth_user on auth.users;
create trigger rl_enforce_authorized_auth_user
before insert on auth.users
for each row
execute function private.enforce_authorized_auth_user();

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

alter table public.signalements
  drop constraint if exists signalements_max_two_photos,
  add constraint signalements_max_two_photos
    check (coalesce(cardinality(photos_urls), 0) <= 2),
  drop constraint if exists signalements_num_length,
  add constraint signalements_num_length
    check (num is null or char_length(num) <= 32),
  drop constraint if exists signalements_date_length,
  add constraint signalements_date_length
    check (date is null or char_length(date) <= 10),
  drop constraint if exists signalements_heure_length,
  add constraint signalements_heure_length
    check (heure is null or char_length(heure) <= 8),
  drop constraint if exists signalements_lieu_length,
  add constraint signalements_lieu_length
    check (lieu is null or char_length(lieu) <= 120),
  drop constraint if exists signalements_type_length,
  add constraint signalements_type_length
    check (type is null or char_length(type) <= 120),
  drop constraint if exists signalements_gravite_length,
  add constraint signalements_gravite_length
    check (gravite is null or char_length(gravite) <= 32),
  drop constraint if exists signalements_signale_par_length,
  add constraint signalements_signale_par_length
    check (signale_par is null or char_length(signale_par) <= 80),
  drop constraint if exists signalements_description_length,
  add constraint signalements_description_length
    check (description is null or char_length(description) <= 2000),
  drop constraint if exists signalements_eleve_length,
  add constraint signalements_eleve_length
    check (eleve is null or char_length(eleve) <= 160),
  drop constraint if exists signalements_classe_length,
  add constraint signalements_classe_length
    check (classe is null or char_length(classe) <= 64),
  drop constraint if exists signalements_famille_length,
  add constraint signalements_famille_length
    check (famille is null or char_length(famille) <= 16),
  drop constraint if exists signalements_statut_length,
  add constraint signalements_statut_length
    check (statut is null or char_length(statut) <= 32);

alter table public.reparations
  drop constraint if exists reparations_mesure_length,
  add constraint reparations_mesure_length
    check (mesure is null or char_length(mesure) <= 200),
  drop constraint if exists reparations_referent_length,
  add constraint reparations_referent_length
    check (referent is null or char_length(referent) <= 160),
  drop constraint if exists reparations_debut_length,
  add constraint reparations_debut_length
    check (debut is null or char_length(debut) <= 10),
  drop constraint if exists reparations_duree_length,
  add constraint reparations_duree_length
    check (duree is null or char_length(duree) <= 120),
  drop constraint if exists reparations_notes_length,
  add constraint reparations_notes_length
    check (notes is null or char_length(notes) <= 3000),
  drop constraint if exists reparations_cloture_length,
  add constraint reparations_cloture_length
    check (cloture is null or char_length(cloture) <= 3000),
  drop constraint if exists reparations_statut_length,
  add constraint reparations_statut_length
    check (statut is null or char_length(statut) <= 32);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reparations_signa_id_fkey'
      and conrelid = 'public.reparations'::regclass
  ) then
    alter table public.reparations
      add constraint reparations_signa_id_fkey
      foreign key (signa_id)
      references public.signalements(id)
      on delete cascade;
  end if;
end $$;

alter table public.signalements enable row level security;
alter table public.reparations enable row level security;

revoke all on table public.signalements from anon;
revoke all on table public.reparations from anon;
revoke all on table public.signalements from authenticated;
revoke all on table public.reparations from authenticated;

grant select, insert, update on table public.signalements to authenticated;
grant select, insert, update on table public.reparations to authenticated;

drop policy if exists "rl_signalements_authorized" on public.signalements;
drop policy if exists "rl_signalements_select" on public.signalements;
drop policy if exists "rl_signalements_insert" on public.signalements;
drop policy if exists "rl_signalements_update" on public.signalements;

create policy "rl_signalements_select"
on public.signalements
for select
to authenticated
using ((select private.is_authorized_user()));

create policy "rl_signalements_insert"
on public.signalements
for insert
to authenticated
with check ((select private.is_authorized_user()));

create policy "rl_signalements_update"
on public.signalements
for update
to authenticated
using ((select private.is_authorized_user()))
with check ((select private.is_authorized_user()));

drop policy if exists "rl_reparations_authorized" on public.reparations;
drop policy if exists "rl_reparations_select" on public.reparations;
drop policy if exists "rl_reparations_insert" on public.reparations;
drop policy if exists "rl_reparations_update" on public.reparations;

create policy "rl_reparations_select"
on public.reparations
for select
to authenticated
using ((select private.is_authorized_user()));

create policy "rl_reparations_insert"
on public.reparations
for insert
to authenticated
with check ((select private.is_authorized_user()));

create policy "rl_reparations_update"
on public.reparations
for update
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

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'rl-photos',
  'rl-photos',
  false,
  3145728,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

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

commit;
