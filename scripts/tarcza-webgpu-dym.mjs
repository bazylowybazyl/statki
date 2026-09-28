// Skrypt sprawdzający demo tarczy WebGPU (dema/tarcza-webgpu.html) w kontenerze bez GPU.
// Chromium z Playwrighta (instalacja globalna) na SwiftShaderze: ładuje stronę z ?test=1,
// woła __demo.step i kolejne akcje, zbiera błędy konsoli i wyjątki (walidacja WebGPU /
// WGSL = błąd) i zapisuje zrzuty do .tmp/tarcza/. Sprawdza POPRAWNOŚĆ, nie wygląd ani
// wydajność (SwiftShader: klatka ~0,5–2 s).
//
// Użycie: serwer `npx vite --port 5173 --strictPort` w tle, potem
//   node scripts/tarcza-webgpu-dym.mjs [--url http://localhost:5173] [--tylko start,debug]
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
let current = 'start';

function isProblem(type, text) {
  if (type === 'error') return true;
  // Chromium zgłasza walidację WebGPU / WGSL jako ostrzeżenia konsoli.
  if (type === 'warning' && /WebGPU|WGSL|GPUValidationError|Invalid|validation/i.test(text)) return true;
  return false;
}

async function openPage(browser, query) {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  page.on('console', (m) => {
    const text = m.text();
    if (isProblem(m.type(), text)) problems.push(`[${current}] konsola ${m.type()}: ${text}`);
  });
  page.on('pageerror', (e) => problems.push(`[${current}] wyjątek: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`[${current}] żądanie nieudane: ${r.url()}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.push(`[${current}] HTTP ${r.status()}: ${r.url()}`); });
  await page.goto(`${BASE}/dema/tarcza-webgpu.html?${query}`);
  await page.waitForFunction(() => window.__demo && (window.__demo.ready === true || window.__demo.error), null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__demo.error || null);
  if (err) throw new Error(`demo nie wystartowało: ${err} ${await page.evaluate(() => window.__demo.detail || '')}`);
  return page;
}

async function step(page, n) {
  await page.evaluate((k) => window.__demo.step(k), n);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

const want = (name) => ONLY.length === 0 || ONLY.includes(name);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: FLAGS });
const t0 = Date.now();
try {
  if (want('start')) {
    current = 'start';
    const page = await openPage(browser, 'test=1&siatka=256');
    await step(page, 2);
    await shot(page, '01-start');
    const st = await page.evaluate(() => window.__demo.stats());
    console.log('stats:', JSON.stringify(st));
    await page.close();
  }
} catch (e) {
  problems.push(`[${current}] przerwane: ${e.stack || e}`);
} finally {
  await browser.close();
}

console.log(`czas: ${((Date.now() - t0) / 1000).toFixed(1)} s, zrzuty: ${OUT}/`);
if (problems.length) {
  console.log(`BŁĘDY (${problems.length}):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('OK — bez błędów konsoli i wyjątków.');
