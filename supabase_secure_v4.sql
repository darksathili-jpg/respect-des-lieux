-- ============================================================
-- RESPECT DES LIEUX — SUPABASE SECURE V4.3
-- ============================================================
-- Schéma reproductible du projet respect-des-lieux-v2.
-- Principes : RLS actif, aucun accès métier anonyme, aucun DELETE
-- navigateur, photos privées bornées, identifiants générés serveur.
-- ============================================================

begin;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

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
revoke all on table public.authorized_users from public;
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

create sequence if not exists public.signalements_id_seq as bigint;
create sequence if not exists public.reparations_id_seq as bigint;

do $$
declare
  v bigint;
begin
  select coalesce(max(id), 0) into v from public.signalements;
  if v = 0 then
    perform setval('public.signalements_id_seq', 1, false);
  else
    perform setval('public.signalements_id_seq', v, true);
  end if;

  select coalesce(max(id), 0) into v from public.reparations;
  if v = 0 then
    perform setval('public.reparations_id_seq', 1, false);
  else
    perform setval('public.reparations_id_seq', v, true);
  end if;
end $$;

alter table public.signalements
  alter column id set default nextval('public.signalements_id_seq');

alter table public.reparations
  alter column id set default nextval('public.reparations_id_seq');

alter sequence public.signalements_id_seq owned by public.signalements.id;
alter sequence public.reparations_id_seq owned by public.reparations.id;

revoke all on sequence public.signalements_id_seq from public;
revoke all on sequence public.signalements_id_seq from anon;
revoke all on sequence public.signalements_id_seq from authenticated;
grant usage on sequence public.signalements_id_seq to authenticated;

revoke all on sequence public.reparations_id_seq from public;
revoke all on sequence public.reparations_id_seq from anon;
revoke all on sequence public.reparations_id_seq from authenticated;
grant usage on sequence public.reparations_id_seq to authenticated;

create table if not exists private.signalement_counters (
  year integer primary key,
  last_value bigint not null check (last_value > 0)
);

revoke all on table private.signalement_counters from public;
revoke all on table private.signalement_counters from anon;
revoke all on table private.signalement_counters from authenticated;

create or replace function private.assign_signalement_num()
returns trigger
language plpgsql
security definer
set search_path = private, public, pg_temp
as $$
declare
  y integer;
  n bigint;
begin
  y := extract(year from current_date)::integer;

  insert into private.signalement_counters(year, last_value)
  values (y, 1)
  on conflict (year) do update
    set last_value = private.signalement_counters.last_value + 1
  returning last_value into n;

  new.num := y::text || '-' || lpad(n::text, 4, '0');
  return new;
end;
$$;

revoke all on function private.assign_signalement_num() from public;
revoke all on function private.assign_signalement_num() from anon;
revoke all on function private.assign_signalement_num() from authenticated;

drop trigger if exists rl_assign_signalement_num on public.signalements;
create trigger rl_assign_signalement_num
before insert on public.signalements
for each row
execute function private.assign_signalement_num();

create unique index if not exists signalements_num_uidx
  on public.signalements (num);

alter table public.signalements
  alter column num set not null,
  alter column date set not null,
  alter column lieu set not null,
  alter column statut set not null,
  drop constraint if exists signalements_max_two_photos,
  add constraint signalements_max_two_photos
    check (coalesce(cardinality(photos_urls), 0) <= 2),
  drop constraint if exists signalements_num_length,
  add constraint signalements_num_length check (char_length(num) <= 32),
  drop constraint if exists signalements_date_length,
  add constraint signalements_date_length check (char_length(date) <= 10),
  drop constraint if exists signalements_heure_length,
  add constraint signalements_heure_length check (heure is null or char_length(heure) <= 8),
  drop constraint if exists signalements_lieu_length,
  add constraint signalements_lieu_length check (char_length(lieu) <= 120),
  drop constraint if exists signalements_type_length,
  add constraint signalements_type_length check (type is null or char_length(type) <= 120),
  drop constraint if exists signalements_gravite_length,
  add constraint signalements_gravite_length check (gravite is null or char_length(gravite) <= 32),
  drop constraint if exists signalements_signale_par_length,
  add constraint signalements_signale_par_length check (signale_par is null or char_length(signale_par) <= 80),
  drop constraint if exists signalements_description_length,
  add constraint signalements_description_length check (description is null or char_length(description) <= 2000),
  drop constraint if exists signalements_eleve_length,
  add constraint signalements_eleve_length check (eleve is null or char_length(eleve) <= 160),
  drop constraint if exists signalements_classe_length,
  add constraint signalements_classe_length check (classe is null or char_length(classe) <= 64),
  drop constraint if exists signalements_famille_length,
  add constraint signalements_famille_length check (famille is null or char_length(famille) <= 16),
  drop constraint if exists signalements_statut_length,
  add constraint signalements_statut_length check (char_length(statut) <= 32),
  drop constraint if exists signalements_gravite_values,
  add constraint signalements_gravite_values check (gravite is null or gravite in ('Mineure','Moyenne','Grave')),
  drop constraint if exists signalements_famille_values,
  add constraint signalements_famille_values check (famille is null or famille in ('oui','non')),
  drop constraint if exists signalements_statut_values,
  add constraint signalements_statut_values check (statut in ('Ouvert','En réparation','Clos'));

alter table public.reparations
  alter column signa_id set not null,
  alter column mesure set not null,
  alter column referent set not null,
  alter column debut set not null,
  alter column statut set not null,
  drop constraint if exists reparations_mesure_length,
  add constraint reparations_mesure_length check (char_length(mesure) <= 200),
  drop constraint if exists reparations_referent_length,
  add constraint reparations_referent_length check (char_length(referent) <= 160),
  drop constraint if exists reparations_debut_length,
  add constraint reparations_debut_length check (char_length(debut) <= 10),
  drop constraint if exists reparations_duree_length,
  add constraint reparations_duree_length check (duree is null or char_length(duree) <= 120),
  drop constraint if exists reparations_notes_length,
  add constraint reparations_notes_length check (notes is null or char_length(notes) <= 3000),
  drop constraint if exists reparations_cloture_length,
  add constraint reparations_cloture_length check (cloture is null or char_length(cloture) <= 3000),
  drop constraint if exists reparations_statut_length,
  add constraint reparations_statut_length check (char_length(statut) <= 32),
  drop constraint if exists reparations_statut_values,
  add constraint reparations_statut_values check (statut in ('En cours','Terminée'));

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

revoke all on table public.signalements from public;
revoke all on table public.reparations from public;
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

drop index if exists public.signalements_created_at_idx;
drop index if exists public.signalements_statut_idx;
drop index if exists public.reparations_statut_idx;

create index if not exists signalements_date_idx
  on public.signalements (date desc);
create index if not exists reparations_created_at_idx
  on public.reparations (created_at desc);
create index if not exists reparations_signa_id_idx
  on public.reparations (signa_id);

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
