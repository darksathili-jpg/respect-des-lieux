import { chromium } from 'playwright';

const APP_URL = 'https://darksathili-jpg.github.io/respect-des-lieux/';
const SUPABASE_HOST = 'odrussbhwyvyudmybjxy.supabase.co';
const IDLE_MS = 35_000;
const DEPLOY_WAIT_MS = 120_000;

const fail = (message, details = '') => {
  console.error('V4.3 BROWSER SMOKE FAIL:', message);
  if (details) console.error(details);
  process.exitCode = 1;
};

async function openCurrentProduction(page) {
  const deadline = Date.now() + DEPLOY_WAIT_MS;
  let lastState = null;

  while (Date.now() < deadline) {
    const url = APP_URL + '?ci=' + Date.now();
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });

    if (!response || !response.ok()) {
      lastState = { http: response ? response.status() : null };
      await page.waitForTimeout(5_000);
      continue;
    }

    try {
      await page.waitForFunction(() => window.RL_DIAG && window.RL_BACKEND, null, { timeout: 20_000 });
      await page.waitForSelector('#rl-auth-screen.open', { timeout: 20_000 });
    } catch (error) {
      lastState = { runtimeReady: false, error: String(error) };
      await page.waitForTimeout(5_000);
      continue;
    }

    lastState = await page.evaluate(() => ({
      productionLock: !!document.getElementById('rl-v43-production-lock'),
      setupExists: !!document.querySelector('#setup-screen'),
      legacyConfigInputExists: !!document.querySelector('input[type="file"][onchange*="loadConfigFile"]'),
      backend: window.RL_BACKEND?.projectRef || null,
      version: window.RL_DIAG?.snapshot?.().version || null
    }));

    if (
      lastState.productionLock &&
      !lastState.setupExists &&
      !lastState.legacyConfigInputExists &&
      lastState.backend === 'odrussbhwyvyudmybjxy' &&
      lastState.version === '4.3'
    ) {
      return response;
    }

    console.log('GitHub Pages encore sur une version précédente, nouvelle tentative...', lastState);
    await page.waitForTimeout(5_000);
  }

  throw new Error('GitHub Pages n’a pas exposé la version V4.3 attendue dans le délai imparti: ' + JSON.stringify(lastState));
}

const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
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

  await openCurrentProduction(page);

  const initial = await page.evaluate(() => ({
    title: document.title,
    backend: window.RL_BACKEND?.projectRef || null,
    version: window.RL_DIAG?.snapshot?.().version || null,
    diag: window.RL_DIAG?.snapshot?.() || null,
    authVisible: document.querySelector('#rl-auth-screen')?.classList.contains('open') || false,
    mainDisplay: getComputedStyle(document.querySelector('#main-app')).display,
    setupExists: !!document.querySelector('#setup-screen'),
    legacyConfigInputExists: !!document.querySelector('input[type="file"][onchange*="loadConfigFile"]'),
    legacyReconfigControlExists: !!document.querySelector('[onclick*="reconfig("]')
  }));

  if (initial.backend !== 'odrussbhwyvyudmybjxy') fail('backend inattendu', JSON.stringify(initial));
  if (initial.version !== '4.3') fail('version runtime différente de 4.3', JSON.stringify(initial));
  if (!initial.authVisible) fail('écran Auth non visible sans session', JSON.stringify(initial));
  if (initial.mainDisplay !== 'none') fail('application métier visible avant authentification', JSON.stringify(initial));
  if (initial.setupExists) fail('ancien assistant Supabase encore présent dans le DOM', JSON.stringify(initial));
  if (initial.legacyConfigInputExists) fail('ancien import config.json encore présent dans l’interface', JSON.stringify(initial));
  if (initial.legacyReconfigControlExists) fail('ancien contrôle de reconfiguration encore présent dans l’interface', JSON.stringify(initial));

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
  await openCurrentProduction(page2);
  const page2State = await page2.evaluate(() => ({
    requests: window.RL_DIAG.snapshot().requests,
    setupExists: !!document.querySelector('#setup-screen')
  }));
  await page2.waitForTimeout(5_000);
  const page2After = await page2.evaluate(() => window.RL_DIAG.snapshot().requests);

  if (page2After !== page2State.requests) {
    fail('deuxième onglet : activité réseau périodique détectée sans session', JSON.stringify({ page2State, page2After, page2Supabase }, null, 2));
  }
  if (page2State.setupExists) {
    fail('deuxième onglet : ancien assistant Supabase encore présent');
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
