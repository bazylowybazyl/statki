// Skrypt sprawdzający demo Atlasa 3D (dema/atlas3d-webgpu.html) w kontenerze bez GPU.
// Chromium z Playwrighta (instalacja globalna) na SwiftShaderze: ładuje stronę z ?test=1,
// woła __demo.step i akcje trybów, zbiera błędy konsoli i wyjątki (walidacja WebGPU / WGSL
// = błąd), zapisuje zrzuty do .tmp/atlas3d/. Sprawdza POPRAWNOŚĆ, nie wydajność.
//
// Użycie: serwer `npx vite --port 5199 --strictPort` w tle, potem
//   node scripts/webgpu/atlas3d-demo.mjs [--url http://localhost:5199] [--tylko start,gra,lot,poscig,galeria,pelny,flota,glb]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const argVal = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const BASE = argVal('--url', 'http://localhost:5199');
const ONLY = (argVal('--tylko', '') || '').split(',').filter(Boolean);
const OUT = argVal('--out', '.tmp/atlas3d');
const W = Number(argVal('--w', 1280));
const H = Number(argVal('--h', 720));
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
  if (type === 'warning' && /WebGPU|WGSL|GPUValidationError|Invalid|validation|THREE\./i.test(text)) return true;
  return false;
}

async function openPage(browser, query) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => {
    const text = m.text();
    if (isProblem(m.type(), text)) problems.push(`[${current}] konsola ${m.type()}: ${text.slice(0, 400)}`);
  });
  page.on('pageerror', (e) => problems.push(`[${current}] wyjątek: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${current}] żądanie nieudane: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${current}] HTTP ${r.status()}: ${r.url()}`); });
  const t0 = Date.now();
  await page.goto(`${BASE}/dema/atlas3d-webgpu.html?${query}`);
  await page.waitForFunction(() => (window.__demo && (window.__demo.ready === true || window.__demo.error))
    || document.getElementById('err').style.display === 'block', null, { timeout: 240000 });
  const pageErr = await page.evaluate(() => document.getElementById('err').textContent);
  if (pageErr) throw new Error(`błąd strony: ${pageErr.slice(0, 1500)}`);
  const err = await page.evaluate(() => window.__demo.error || null);
  if (err) throw new Error(`demo nie wystartowało: ${err} ${await page.evaluate(() => window.__demo.detail || '')}`);
  notes.push(`[${current}] start ${Date.now() - t0} ms`);
  await page.evaluate(() => { document.getElementById('panel').classList.add('hidden'); document.getElementById('hud').classList.add('hidden'); });
  return page;
}

const step = (page, n) => page.evaluate((k) => window.__demo.step(k), n);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });
const call = (page, fn, arg) => page.evaluate(fn, arg);
const stats = (page) => page.evaluate(() => window.__demo.stats());
const want = (name) => ONLY.length === 0 || ONLY.includes(name);

const scenarios = {
  async start(browser) {
    const page = await openPage(browser, 'test=1&tryb=ogledziny');
    await step(page, 3);
    await shot(page, '01-ogledziny');
    const st = await stats(page);
    notes.push(`[start] ${JSON.stringify(st)}`);
    if (st.mounts !== 45) problems.push(`[start] gniazd ${st.mounts}, oczekiwano 45 (ATLAS_EDITOR_DEFAULTS)`);
    if (!(st.turrets >= 25)) problems.push(`[start] za mało wież fitu gry: ${st.turrets}`);
    await call(page, () => window.__demo.view({ az: -40, el: 12, dist: 1500 }));
    await step(page, 2);
    await shot(page, '02-ogledziny-rufa');
    await call(page, () => window.__demo.view({ az: 150, el: 18, dist: 1300, pan: [500, 0, 0] }));
    await step(page, 2);
    await shot(page, '03-ogledziny-dziob');
    await call(page, () => window.__demo.view({ az: -135, el: 22, dist: 420, pan: [-340, 0, 60] }));
    await step(page, 2);
    await shot(page, '04-mostek-z-bliska');
    await call(page, () => window.__demo.view({ az: 200, el: 14, dist: 520, pan: [-760, 0, 0] }));
    await step(page, 2);
    await shot(page, '04b-rufa-dysze');
    await call(page, () => window.__demo.view({ az: 90, el: 4, dist: 2300, pan: [0, 0, 0] }));
    await step(page, 2);
    await shot(page, '04c-profil-burta');
    await page.close();
  },

  async gra(browser) {
    const page = await openPage(browser, 'test=1&tryb=lot&kamera=gra');
    await call(page, () => window.__demo.view({ dist: 2300 }));
    await step(page, 3);
    await shot(page, '05-z-gory-jak-gra');
    await page.close();
  },

  async lot(browser) {
    const page = await openPage(browser, 'test=1&tryb=lot&kamera=taktyczna');
    await call(page, () => { window.__demo.keys(['w', 'a']); window.__demo.mouse(0.35, 0.15, { lmb: true }); });
    await step(page, 50);
    await shot(page, '06-lot-taktyczna-ogien');
    const st = await stats(page);
    notes.push(`[lot] ${JSON.stringify(st)}`);
    if (!(st.pos[0] > 1 || st.pos[1] > 1)) problems.push('[lot] statek się nie ruszył');
    if (!(st.bolts > 0)) problems.push('[lot] brak pocisków po ogniu');
    await call(page, () => window.__demo.fire('hexlance'));
    await call(page, () => window.__demo.fire('missile'));
    await step(page, 12);
    await shot(page, '07-lot-hexlance-rakiety');
    await page.close();
  },

  async poscig(browser) {
    const page = await openPage(browser, 'test=1&tryb=lot&kamera=poscig');
    await call(page, () => { window.__demo.keys(['w']); window.__demo.mouse(0.0, 0.1, { lmb: true }); });
    await step(page, 40);
    await shot(page, '08-poscig');
    await call(page, () => window.__demo.camera('kinowa'));
    await step(page, 20);
    await shot(page, '09-kinowa');
    await page.close();
  },

  async galeria(browser) {
    const page = await openPage(browser, 'test=1&tryb=galeria');
    await step(page, 30);
    await shot(page, '10-galeria');
    await call(page, () => window.__demo.view({ az: -40, el: 22, dist: 520, pan: [-230, 230, 0] }));
    await step(page, 10);
    await shot(page, '11-galeria-bliżej');
    await call(page, () => window.__demo.view({ az: -30, el: 18, dist: 480, pan: [230, -230, 0] }));
    await step(page, 10);
    await shot(page, '11b-galeria-ciezkie');
    await call(page, () => { window.__demo.galleryScale(true); window.__demo.view({ az: -62, el: 34, dist: 1500, pan: [0, 0, 0] }); });
    await step(page, 4);
    await shot(page, '11c-galeria-skala-gry');
    await page.close();
  },

  async pelny(browser) {
    const page = await openPage(browser, 'test=1&tryb=ogledziny&fit=pelny');
    await call(page, () => window.__demo.view({ az: -115, el: 30, dist: 2100 }));
    await step(page, 3);
    await shot(page, '12-pelny-fit');
    const st = await stats(page);
    notes.push(`[pelny] wieże ${st.turrets}, trójkąty wież ${st.turretTris}`);
    await page.close();
  },

  // Flota (Terra Nova i piraci): tryb Flota na starcie, oględziny każdego okrętu, lot okrętem floty.
  async flota(browser) {
    const page = await openPage(browser, 'test=1');
    await step(page, 3);
    await shot(page, '13-flota');
    const ids = await call(page, () => Object.keys(window.__demo.ships));
    if (ids.length !== 7) problems.push(`[flota] okrętów ${ids.length}, oczekiwano 7`);
    for (const id of ids) {
      const st = await call(page, (k) => window.__demo.ship3d(k, 'ogledziny'), id);
      await step(page, 2);
      await shot(page, `14-${id}`);
      if (!(st.mounts > 0 && st.hullTris > 2000)) problems.push(`[flota] ${id}: ${JSON.stringify(st)}`);
    }
    await call(page, () => { window.__demo.ship3d('pirate_destroyer', 'lot'); window.__demo.keys(['w', 'a']); window.__demo.mouse(0.3, 0.2, { lmb: true }); });
    await step(page, 40);
    const st = await stats(page);
    if (!(st.pos[0] > 1 || st.pos[1] > 1)) problems.push('[flota] niszczyciel piratów się nie ruszył');
    notes.push(`[flota] ${JSON.stringify(st)}`);
    await page.close();
  },

  async glb(browser) {
    const page = await openPage(browser, 'test=1&tryb=ogledziny');
    await step(page, 2);
    const size = await call(page, async () => {
      const { exportAtlasGLB } = await import('/dema/atlas3d-webgpu/eksport.js');
      const img = new Image();
      img.src = '/assets/capital_ship_rect_v1.png';
      await img.decode();
      const blob = await exportAtlasGLB(window.__demo.ship, img);
      return blob.size;
    });
    notes.push(`[glb] ${(size / 1024 / 1024).toFixed(2)} MB`);
    if (!(size > 100000)) problems.push(`[glb] za mały plik: ${size} B`);
    await page.close();
  }
};

const browser = await chromium.launch({ args: FLAGS });
try {
  for (const [name, fn] of Object.entries(scenarios)) {
    if (!want(name)) continue;
    current = name;
    const t0 = Date.now();
    try { await fn(browser); } catch (e) { problems.push(`[${name}] ${e.stack || e}`); }
    notes.push(`[${name}] ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }
} finally {
  await browser.close();
}

const report = { problems, notes };
writeFileSync(`${OUT}/wynik.json`, JSON.stringify(report, null, 2));
for (const n of notes) console.log(n);
if (problems.length) {
  console.log(`\nPROBLEMY (${problems.length}):`);
  for (const p of problems) console.log(' - ' + p);
  process.exitCode = 1;
} else {
  console.log('\nOK — bez błędów konsoli i walidacji WebGPU.');
}
