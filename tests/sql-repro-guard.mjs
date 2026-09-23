import fs from 'node:fs';

const sql = fs.readFileSync('supabase_secure_v4.sql', 'utf8');
const fail = (message) => {
  console.error('SQL REPRO GUARD FAIL:', message);
  process.exitCode = 1;
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};

// Reject malformed single-dollar pseudo-quotes such as `do $` or `as $`.
expect(!/^\s*(do|as)\s+\$\s*$/gmi.test(sql), 'dollar quoting SQL invalide détecté');

// Every anonymous DO block must use a valid $$ delimiter.
const doBlocks = (sql.match(/^\s*do\s+\$\$/gmi) || []).length;
const doEnds = (sql.match(/^\s*end\s+\$\$;/gmi) || []).length;
expect(doBlocks === doEnds, 'nombre de blocs DO $$ incohérent');

// Reliability/security invariants.
expect(!/disable\s+row\s+level\s+security/i.test(sql), 'RLS ne doit jamais être désactivé');
expect(/alter table public\.signalements enable row level security/i.test(sql), 'RLS signalements absent');
expect(/alter table public\.reparations enable row level security/i.test(sql), 'RLS reparations absent');
expect(!/grant[^;]*delete[^;]*to\s+authenticated/i.test(sql), 'DELETE navigateur interdit');
expect(!/grant[^;]*truncate[^;]*to\s+authenticated/i.test(sql), 'TRUNCATE navigateur interdit');
expect(sql.includes('3145728'), 'limite Storage 3 Mo absente');
expect(sql.includes("array['image/jpeg']::text[]"), 'restriction JPEG absente');
expect(sql.includes('AUTH_EMAIL_NOT_AUTHORIZED'), 'garde Auth allowlist absente');
expect(sql.includes("nextval('public.signalements_id_seq')"), 'séquence signalements absente');
expect(sql.includes("nextval('public.reparations_id_seq')"), 'séquence réparations absente');
expect(sql.includes('rl_assign_signalement_num'), 'trigger numéro dossier absent');
expect(sql.includes('signalements_num_uidx'), 'unicité numéro dossier absente');
expect(sql.includes('reparations_signa_id_fkey'), 'clé étrangère réparation absente');

if (!process.exitCode) {
  console.log('SQL Reproducibility Guard: PASS');
}
