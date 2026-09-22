import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const fail = (message) => {
  console.error('V4.3 GUARD FAIL:', message);
  process.exitCode = 1;
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};
const count = (text, regex) => (text.match(regex) || []).length;

const html = read('index.html');
const security = read('security-v4.js');
const config = read('config.js');
const sql = read('supabase_secure_v4.sql');

// ---------- Syntaxe JavaScript ----------
try {
  new Function(config);
} catch (error) {
  fail('config.js invalide: ' + error.message);
}

try {
  new Function(security);
} catch (error) {
  fail('security-v4.js invalide: ' + error.message);
}

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((source) => source.trim());

inlineScripts.forEach((source, index) => {
  try {
    new Function(source);
  } catch (error) {
    fail('script inline index.html #' + index + ' invalide: ' + error.message);
  }
});

// ---------- Régressions de charge ----------
expect(
  count(html, /\bsetInterval\s*\(/g) === 0,
  'index.html ne doit contenir aucun polling setInterval'
);
expect(
  count(security, /\bsetInterval\s*\(/g) === 0,
  'security-v4.js ne doit contenir aucun polling setInterval'
);
expect(
  count(html, /\bfetch\s*\(/g) === 0,
  'index.html ne doit pas contourner le client sécurisé avec fetch()'
);
expect(
  security.includes('MIN_AUTO_REFRESH_MS = 120000'),
  'la temporisation minimale de 2 minutes doit rester active'
);
expect(
  security.includes('if (dataRefreshPromise) return dataRefreshPromise;'),
  'la déduplication des rafraîchissements doit rester active'
);
expect(
  security.includes('if (appLaunchPromise) return appLaunchPromise;'),
  'la déduplication du bootstrap doit rester active'
);
expect(
  security.includes('limit=501') && security.includes('limit=1001'),
  'les fenêtres de données et leurs lignes sentinelles doivent rester bornées'
);
expect(
  security.includes('dataWindowExceeded'),
  'la détection de dépassement de fenêtre doit rester active'
);

// ---------- Données et écritures ----------
expect(
  !/localStorage\.setItem\(['"]rl3-(sig|rep|queue)/.test(html + security),
  'aucune donnée métier ne doit être persistée dans localStorage'
);
expect(
  !/id=neq\.0/.test(html + security),
  'la purge REST globale historique ne doit jamais réapparaître'
);
expect(
  !/\bnewRecordId\b|\bgenNum\s*\(/.test(html),
  'ID et numéros de dossier doivent rester générés côté PostgreSQL'
);
expect(
  html.includes('aucune écriture métier n\'est mise en file d\'attente localement') ||
  html.includes('aucune écriture métier n&#39;est mise en file d&#39;attente localement') ||
  html.includes('aucune écriture métier n'),
  'la politique sans file hors-ligne doit rester documentée dans le code'
);
expect(
  security.includes('Suppression désactivée en V4.3'),
  'SUPA.del doit rester désactivé'
);

// ---------- Secrets / backend ----------
expect(
  !/service_role|sb_secret_/i.test(html + security + config),
  'aucune clé serveur secrète ne doit être présente dans le frontend'
);
expect(
  config.includes("projectRef: 'odrussbhwyvyudmybjxy'"),
  'config.js doit pointer vers respect-des-lieux-v2'
);
expect(
  !/v4-2-hotfix/i.test(html + security + config),
  'la couche hotfix V4.2 obsolète ne doit pas réapparaître'
);

const configPos = html.indexOf("<script src='./config.js'></script>");
const securityPos = html.indexOf("<script src='./security-v4.js'></script>");
expect(
  configPos >= 0 && securityPos > configPos,
  'config.js doit être chargé avant security-v4.js'
);

// ---------- SQL / RLS ----------
expect(
  !/disable\s+row\s+level\s+security/i.test(sql),
  'le schéma ne doit jamais désactiver RLS'
);
expect(
  /alter table public\.signalements enable row level security/i.test(sql) &&
  /alter table public\.reparations enable row level security/i.test(sql),
  'RLS doit être activé sur les deux tables métier'
);
expect(
  !/grant[^;]*delete[^;]*to\s+authenticated/i.test(sql),
  'DELETE ne doit pas être accordé au rôle navigateur'
);
expect(
  !/grant[^;]*truncate[^;]*to\s+authenticated/i.test(sql),
  'TRUNCATE ne doit pas être accordé au rôle navigateur'
);
expect(
  sql.includes("public = false") || sql.includes("'rl-photos',\n  'rl-photos',\n  false"),
  'le bucket rl-photos doit rester privé'
);
expect(
  sql.includes('3145728') && sql.includes("image/jpeg"),
  'Storage doit conserver la limite 3 Mo et JPEG'
);
expect(
  sql.includes('rl_enforce_authorized_auth_user') &&
  sql.includes('AUTH_EMAIL_NOT_AUTHORIZED'),
  'la liste blanche Auth doit rester imposée côté PostgreSQL'
);
expect(
  sql.includes("nextval('public.signalements_id_seq')") &&
  sql.includes("nextval('public.reparations_id_seq')"),
  'les ID métier doivent rester générés par des séquences serveur'
);
expect(
  sql.includes('rl_assign_signalement_num') &&
  sql.includes('signalements_num_uidx'),
  'le numéro de dossier transactionnel et unique doit rester actif'
);

// ---------- Instrumentation ----------
expect(
  security.includes('window.RL_DIAG'),
  'RL_DIAG doit rester disponible pour le diagnostic runtime'
);

if (!process.exitCode) {
  console.log('V4.3 Reliability Guard: PASS');
}
