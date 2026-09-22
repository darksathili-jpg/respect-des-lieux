-- ============================================================
-- RESPECT DES LIEUX — DIAGNOSTIC V4.2 (LECTURE SEULE)
-- ============================================================
-- À exécuter uniquement lorsque le projet Supabase répond de nouveau.
-- Ce script ne modifie aucune donnée.
-- ============================================================

select
  pg_size_pretty(pg_database_size(current_database())) as database_size;

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
  and relname in ('signalements', 'reparations')
order by relname;

select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('signalements', 'reparations')
order by tablename, indexname;

select
  count(*) as signalements_avec_base64
from public.signalements s
where exists (
  select 1
  from unnest(coalesce(s.photos_urls, '{}'::text[])) as p(url)
  where p.url like 'data:image/%;base64,%'
);

select
  id,
  num,
  pg_column_size(s) as row_bytes,
  coalesce(array_length(photos_urls, 1), 0) as photo_count
from public.signalements s
order by pg_column_size(s) desc
limit 20;

select
  state,
  count(*) as connections,
  max(extract(epoch from (now() - query_start)))::int as max_query_age_seconds
from pg_stat_activity
where datname = current_database()
group by state
order by connections desc;
