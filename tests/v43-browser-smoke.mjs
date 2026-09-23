import { chromium } from 'playwright';

const APP_URL = 'https://darksathili-jpg.github.io/respect-des-lieux/';
const SUPABASE_HOST = 'odrussbhwyvyudmybjxy.supabase.co';
const IDLE_MS = 35_000;

const fail = (message, details = '') => {
  console.error('V4.3 BROWSER SMOKE FAIL:', message);
  if (details) console.error(details);
  process.exitCode = 1;
};

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block'
  });

  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const supabaseRequests = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('request', (req) => {
    if (req.url().includes(SUPABASE_HOST)) {
      supabaseRequests.push({ method: req.method(), url: req.url(), at: Date.now() });
    }
  });

  const response = await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  if (!response || !response.ok()) {
    fail('GitHub Pages ne répond pas correctement', response ? `HTTP ${response.status()}` : 'pas de réponse');
  }

  await page.waitForFunction(() => window.RL_DIAG && window.RL_BACKEND, null, { timeout: 20_000 });
  await page.waitForSelector('#rl-auth-screen.open', { timeout: 20_000 });

  const initial = await page.evaluate(() => ({
    title: document.title,
    backend: window.RL_BACKEND?.projectRef || null,
    version: window.RL_DIAG?.snapshot?.().version || null,
    diag: window.RL_DIAG?.snapshot?.() || null,
    authVisible: document.querySelector('#rl-auth-screen')?.classList.contains('open') || false,
    mainDisplay: getComputedStyle(document.querySelector('#main-app')).display
  }));

  if (initial.backend !== 'odrussbhwyvyudmybjxy') fail('backend inattendu', JSON.stringify(initial));
  if (initial.version !== '4.3') fail('version runtime différente de 4.3', JSON.stringify(initial));
  if (!initial.authVisible) fail('écran Auth non visible sans session', JSON.stringify(initial));
  if (initial.mainDisplay !== 'none') fail('application métier visible avant authentification', JSON.stringify(initial));

  const restBefore = supabaseRequests.filter((r) => /\/rest\/v1\/|\/storage\/v1\//.test(r.url)).length;
  const requestsBefore = initial.diag?.requests ?? null;

  console.log(`V4.3 browser smoke: repos ${IDLE_MS / 1000}s — vérification absence de polling...`);
  await page.waitForTimeout(IDLE_MS);

  const afterIdle = await page.evaluate(() => window.RL_DIAG.snapshot());
  const restAfter = supabaseRequests.filter((r) => /\/rest\/v1\/|\/storage\/v1\//.test(r.url)).length;

  if (restAfter !== restBefore) {
    fail('activité REST/Storage périodique détectée au repos', JSON.stringify(supabaseRequests, null, 2));
  }
  if (requestsBefore !== null && afterIdle.requests !== requestsBefore) {
    fail('compteur réseau runtime a augmenté au repos', JSON.stringify({ requestsBefore, afterIdle }, null, 2));
  }

  // Deuxième onglet : le chargement sans session doit rester fermé et sans trafic métier périodique.
  const page2 = await context.newPage();
  const page2Supabase = [];
  page2.on('request', (req) => {
    if (req.url().includes(SUPABASE_HOST)) page2Supabase.push(req.url());
  });
  await page2.goto(APP_URL, { waitUntil: 'networkidle', timeout: 60_000 });
  await page2.waitForFunction(() => window.RL_DIAG && window.RL_BACKEND, null, { timeout: 20_000 });
  await page2.waitForSelector('#rl-auth-screen.open', { timeout: 20_000 });
  const page2Before = await page2.evaluate(() => window.RL_DIAG.snapshot().requests);
  await page2.waitForTimeout(5_000);
  const page2After = await page2.evaluate(() => window.RL_DIAG.snapshot().requests);

  if (page2After !== page2Before) {
    fail('deuxième onglet : activité réseau périodique détectée sans session', JSON.stringify({ page2Before, page2After, page2Supabase }, null, 2));
  }

  if (pageErrors.length) fail('erreurs JavaScript non gérées', pageErrors.join('\n'));

  // Les erreurs console liées aux polices/ressources tierces ne sont pas bloquantes ici,
  // mais elles sont imprimées pour rendre le test observable.
  if (consoleErrors.length) {
    console.warn('V4.3 browser smoke — erreurs console observées:', consoleErrors);
  }

  if (!process.exitCode) {
    console.log('V4.3 Browser Smoke: PASS');
    console.log(JSON.stringify({ initial, afterIdle, supabaseRequests }, null, 2));
  }
} finally {
  await browser.close();
}
