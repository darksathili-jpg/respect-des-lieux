-- ============================================================
-- RESPECT DES LIEUX — DIAGNOSTIC V4.3 (LECTURE SEULE)
-- ============================================================
-- Aucun INSERT / UPDATE / DELETE / DDL.
-- Les requêtes ci-dessous permettent de contrôler la santé de la base
-- sans afficher les données nominatives des dossiers.
-- ============================================================

-- 1. Taille de la base
select
  pg_database_size(current_database()) as database_bytes,
  pg_size_pretty(pg_database_size(current_database())) as database_size;

-- 2. Volume métier
select
  (select count(*) from public.signalements) as signalements,
  (select count(*) from public.reparations) as reparations,
  (select count(*) from public.authorized_users where active) as authorized_users,
  (select count(*) from auth.users) as auth_users;

-- 3. Taille, scans, tuples morts et autovacuum
select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(relid)) as total_size,
  n_live_tup,
  n_dead_tup,
  seq_scan,
  idx_scan,
  last_autovacuum,
  last_autoanalyze
from pg_stat_user_tables
where schemaname = 'public'
  and relname in ('authorized_users','signalements','reparations')
order by pg_total_relation_size(relid) desc;

-- 4. Index
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('authorized_users','signalements','reparations')
order by tablename, indexname;

-- 5. RLS et policies
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname in ('public','storage')
  and tablename in ('authorized_users','signalements','reparations','objects')
order by schemaname, tablename, policyname;

-- 6. Privilèges accordés aux rôles navigateur
select
  grantee,
  table_name,
  privilege_type
from information_schema.role_table_grants
where grantee in ('anon','authenticated')
  and table_schema = 'public'
  and table_name in ('authorized_users','signalements','reparations')
order by table_name, grantee, privilege_type;

-- 7. Séquences serveur
select
  table_name,
  column_name,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('signalements','reparations')
  and column_name = 'id'
order by table_name;

-- 8. Configuration Storage
select
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'rl-photos';

-- 9. Anciennes images Base64 : doit rester à zéro
select
  count(*) as signalements_avec_base64
from public.signalements s
where exists (
  select 1
  from unnest(coalesce(s.photos_urls, '{}'::text[])) as p(url)
  where p.url like 'data:image/%;base64,%'
);

-- 10. Statistiques cache / temporaires / deadlocks
select
  datname,
  blks_read,
  blks_hit,
  round(
    100.0 * blks_hit / nullif(blks_hit + blks_read, 0),
    3
  ) as cache_hit_pct,
  temp_files,
  pg_size_pretty(temp_bytes) as temp_bytes,
  deadlocks,
  conflicts,
  xact_commit,
  xact_rollback
from pg_stat_database
where datname = current_database();

-- 11. Connexions
select
  state,
  count(*) as connections,
  max(extract(epoch from (now() - query_start)))::int as max_query_age_seconds
from pg_stat_activity
where datname = current_database()
group by state
order by connections desc;
