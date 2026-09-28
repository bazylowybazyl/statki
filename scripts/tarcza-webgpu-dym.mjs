// Skrypt sprawdzający demo tarczy WebGPU (dema/tarcza-webgpu.html) w kontenerze bez GPU.
// Chromium z Playwrighta (instalacja globalna) na SwiftShaderze: ładuje stronę z ?test=1,
// woła __demo.step i kolejne akcje, zbiera błędy konsoli i wyjątki (walidacja WebGPU /
// WGSL = błąd) i zapisuje zrzuty do .tmp/tarcza/. Sprawdza POPRAWNOŚĆ, nie wygląd ani
// wydajność (SwiftShader: klatka ~0,5–2 s).
//
// Użycie: serwer `npx vite --port 5173 --strictPort` w tle, potem
//   node scripts/tarcza-webgpu-dym.mjs [--url http://localhost:5173] [--tylko start,trafienia,...]
// Scenariusze: start, trafienia, salwa, wiazka, torpeda, pekniecie, gaszenie, ab, tarcza, debug.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const BASE = argVal('--url', 'http://localhost:5173');
const ONLY = (argVal('--tylko', '') || '').split(',').filter(Boolean);
const OUT = '.tmp/tarcza';
mkdirSync(OUT, { recursive: true });

const root = execSync('npm root -g').toString().trim();
const { chromium } = require(`${root}/playwright`);

const FLAGS = ['--headless=new', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
  '--use-webgpu-adapter=swiftshader', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'];

const problems = [];
const notes = [];
let current = 'start';

function isProblem(type, text) {
  if (type === 'error') return true;
  // Chromium zgłasza walidację WebGPU / WGSL jako ostrzeżenia konsoli.
  if (type === 'warning' && /WebGPU|WGSL|GPUValidationError|Invalid|validation|THREE\./i.test(text)) return true;
  return false;
}

async function openPage(browser, query) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('console', (m) => {
    const text = m.text();
    if (isProblem(m.type(), text)) problems.push(`[${current}] konsola ${m.type()}: ${text}`);
    else if (/Tarcza Atlasa/.test(text)) notes.push(text);
  });
  page.on('pageerror', (e) => problems.push(`[${current}] wyjątek: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${current}] żądanie nieudane: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${current}] HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}/dema/tarcza-webgpu.html?${query}`);
  await page.waitForFunction(() => window.__demo && (window.__demo.ready === true || window.__demo.error), null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__demo.error || null);
  if (err) throw new Error(`demo nie wystartowało: ${err} ${await page.evaluate(() => window.__demo.detail || '')}`);
  // Czyste zrzuty: panel schowany.
  await page.evaluate(() => document.getElementById('panel').classList.add('hidden'));
  return page;
}

const step = (page, n) => page.evaluate((k) => window.__demo.step(k), n);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const has = (page, fn) => page.evaluate((f) => typeof window.__demo[f] === 'function', fn);
const call = (page, expr) => page.evaluate(expr);
const stats = (page) => page.evaluate(() => window.__demo.stats());

async function maybe(page, fn, expr) {
  if (await has(page, fn)) return call(page, expr);
  notes.push(`[${current}] pominięto ${fn}() — jeszcze nie ma w demie`);
  return undefined;
}

// Czeka (klatkami) na stan tarczy; zwraca, czy się doczekał.
async function waitState(page, state, maxFrames, chunk = 6) {
  for (let f = 0; f < maxFrames; f += chunk) {
    const st = await stats(page);
    if (st.state === state) return true;
    await step(page, chunk);
  }
  return (await stats(page)).state === state;
}

const want = (name) => ONLY.length === 0 || ONLY.includes(name);

const scenarios = {
  async start(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await step(page, 2);
    await shot(page, '01-start');
    const st = await stats(page);
    notes.push(`[start] ${JSON.stringify(st)}`);
    if (!(st.maxR > 850 && st.maxR < 1050)) problems.push(`[start] maxR ${st.maxR} poza oczekiwanym zakresem (~pół kadłuba + odstęp)`);
    await page.close();
  },

  async trafienia(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, 0, 2600));
    await step(page, 2);
    // Każda klasa trafienia w inny punkt obrysu (punkty gry, y w dół).
    await call(page, () => {
      const d = window.__demo;
      d.hit(700, -200, 12, 'pd');
      d.hit(-500, -300, 110, 'main');
      d.hit(200, 380, 600, 'special');
      d.hit(-850, 60, 250, 'shield');
    });
    await step(page, 3);
    await shot(page, '02-trafienia-a');
    await step(page, 10);
    await shot(page, '02-trafienia-b');
    await page.close();
  },

  async salwa(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, -300, 3000));
    await step(page, 2);
    if (await has(page, 'salvo')) {
      // Trzy salwy w to samo miejsce (pociski lecą ~1 s) — przegrzanie aż do przebicia.
      await call(page, () => { window.__demo.aim(600, -250); window.__demo.salvo(); });
      await step(page, 20);
      await call(page, () => window.__demo.salvo());
      await step(page, 20);
      await call(page, () => window.__demo.salvo());
      await step(page, 34);
      await shot(page, '03-salwa');
      await step(page, 30);
      await shot(page, '03-salwa-przegrzanie');
      const st = await stats(page);
      notes.push(`[salwa] trafienia w tarczę ${st.shieldHits}, przebicie: ${st.breach}`);
      if (!(st.shieldHits > 20)) problems.push(`[salwa] za mało trafień w tarczę: ${st.shieldHits}`);
    } else notes.push('[salwa] pominięto — brak __demo.salvo');
    await page.close();
  },

  async wiazka(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(300, -200, 2200));
    await step(page, 2);
    if (await has(page, 'beam')) {
      // Wiązka trzymana w jednym punkcie (górny kieł dziobu): przegrzanie → przebicie →
      // wiązka przechodzi przez dziurę i pali pancerz.
      await call(page, () => window.__demo.beam(560, -80, true));
      await step(page, 30);
      await shot(page, '04-wiazka');
      await step(page, 70);
      await shot(page, '04-wiazka-przebicie');
      const st = await stats(page);
      notes.push(`[wiazka] przebicie: ${st.breach}, trafienia w pancerz: ${st.hullHits}`);
      await call(page, () => window.__demo.beam(0, 0, false));
      await step(page, 4);
    } else notes.push('[wiazka] pominięto — brak __demo.beam');
    await page.close();
  },

  async torpeda(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, 0, 3200));
    await step(page, 2);
    await call(page, () => window.__demo.hit(-300, -420, 900, 'special'));
    await step(page, 4);
    await shot(page, '05-torpeda-a');
    await step(page, 14);
    await shot(page, '05-torpeda-b');
    await page.close();
  },

  async pekniecie(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, 0, 3200));
    await step(page, 2);
    await call(page, () => { window.__demo.hit(400, -300, 200, 'main'); window.__demo.breakShield(); });
    await step(page, 3);
    const st1 = await stats(page);
    if (st1.state !== 'breaking') problems.push(`[pekniecie] oczekiwano 'breaking', jest '${st1.state}'`);
    await shot(page, '06-pekniecie-a');
    await step(page, 12);
    await shot(page, '06-pekniecie-b');
    if (!(await waitState(page, 'off', 60))) problems.push('[pekniecie] tarcza nie przeszła w off');
    // Regeneracja do progu (20%) → ponowny rozruch.
    await call(page, () => window.__demo.setHP(0.3));
    if (!(await waitState(page, 'activating', 12, 2))) problems.push('[pekniecie] brak ponownego rozruchu (activating)');
    await step(page, 8);
    await shot(page, '06-rozruch');
    if (!(await waitState(page, 'active', 90))) problems.push('[pekniecie] rozruch nie doszedł do active');
    await page.close();
  },

  async gaszenie(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, 0, 3200));
    await step(page, 2);
    await call(page, () => window.__demo.toggleShield());
    await step(page, 6);
    const st = await stats(page);
    if (st.state !== 'deactivating' && st.state !== 'off') problems.push(`[gaszenie] oczekiwano deactivating/off, jest '${st.state}'`);
    await shot(page, '07-gaszenie');
    if (!(await waitState(page, 'off', 60))) problems.push('[gaszenie] tarcza nie zgasła');
    await call(page, () => window.__demo.toggleShield());
    await step(page, 8);
    await shot(page, '07-wlaczenie');
    if (!(await waitState(page, 'active', 90))) problems.push('[gaszenie] tarcza nie wróciła do active');
    await page.close();
  },

  async ab(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    await call(page, () => window.__demo.lookAt(0, 0, 2600));
    await step(page, 2);
    await call(page, () => window.__demo.setNewFx(false));
    await call(page, () => { window.__demo.hit(500, -330, 120, 'main'); window.__demo.hit(-600, 250, 700, 'special'); });
    await step(page, 5);
    await shot(page, '08-ab-gra');
    await call(page, () => window.__demo.setNewFx(true));
    await call(page, () => { window.__demo.hit(500, -330, 120, 'main'); window.__demo.hit(-600, 250, 700, 'special'); });
    await step(page, 5);
    await shot(page, '08-ab-nowe');
    await page.close();
  },

  async tarcza(browser) {
    const page = await openPage(browser, 'test=1&siatka=256');
    if (await has(page, 'shieldClash')) {
      await call(page, () => window.__demo.lookAt(0, -900, 3600));
      await call(page, () => window.__demo.shieldClash(true, true));
      await step(page, 40);
      await shot(page, '09-tarcza-w-tarcze');
      const st = await stats(page);
      notes.push(`[tarcza] faza ${st.clash}, punkty styku ${st.clashContacts}, tarcza wroga ${st.enemyShield} ${Math.round(st.enemyHp)}`);
      if (st.clash === 'approach' && st.clashContacts === 0) problems.push('[tarcza] brak styku pól po szybkim starcie');
    } else notes.push('[tarcza] pominięto — brak __demo.shieldClash');
    await page.close();
  },

  async debug(browser) {
    const page = await openPage(browser, 'test=1&debug=pole&siatka=256');
    await step(page, 3);
    await shot(page, '10-debug-pole');
    await page.close();
  }
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: FLAGS });
const t0 = Date.now();
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (!want(name)) continue;
    current = name;
    const ts = Date.now();
    try {
      await fn(browser);
    } catch (e) {
      problems.push(`[${name}] przerwane: ${e.stack || e}`);
    }
    console.log(`  ${name}: ${((Date.now() - ts) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
}

for (const n of notes) console.log(n);
console.log(`czas: ${((Date.now() - t0) / 1000).toFixed(1)} s, zrzuty: ${OUT}/`);
if (problems.length) {
  console.log(`BŁĘDY (${problems.length}):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('OK — bez błędów konsoli i wyjątków.');
