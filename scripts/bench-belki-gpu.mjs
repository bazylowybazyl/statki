// Pomiar: fizyka belek na GPU (dema/destruktor2d-webgpu) vs silnik CPU (DestructorBeams3D),
// te same sceny w tej samej przeglądarce (headless Chrome, prawdziwe GPU, znaczniki czasu bez
// kwantyzacji). Czas GPU = czas karty z timestamp-query; CPU = czas ściany kroku w JS.
//
//   node scripts/bench-belki-gpu.mjs                      wszystkie sceny
//   node scripts/bench-belki-gpu.mjs --tylko taran        taran Atlas–Atlas 800 j./s w siatkach 120/240/480/960
//   node scripts/bench-belki-gpu.mjs --tylko flota        flota 72 kadłuby (lot) i flota + 6 taranów
//   node scripts/bench-belki-gpu.mjs --siatki 120,240     ograniczenie siatek
//   node scripts/bench-belki-gpu.mjs --bez-cpu            tylko GPU
//   node scripts/bench-belki-gpu.mjs --q "gs=0"           parametry strony (gs=0: dispatch na kolor, gsSize=256)
//
// Wynik: tabela na stdout i JSON w .tmp/belki-gpu/bench.json.
import { join } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, parseArgs, writeJson, repo } from './webgpu/wspolne.mjs';

const args = parseArgs();
const only = args.tylko || '';
const grids = (args.siatki || '120,240,480,960').split(',').map(Number);
const withCpu = !args['bez-cpu'];

const CASES = [];
if (!only || only === 'taran') {
  for (const res of grids) {
    CASES.push({ name: `taran-${res}`, kind: 'ram', res, gpuSteps: 360, cpuSteps: res >= 960 ? 30 : res >= 480 ? 90 : 360 });
  }
}
if (!only || only === 'flota') {
  for (const res of grids.filter((r) => r <= 240)) {
    CASES.push({ name: `flota-${res}`, kind: 'fleet', res, gpuSteps: 360, cpuSteps: 240 });
    CASES.push({ name: `flota+tarany-${res}`, kind: 'fleet-ram', res, gpuSteps: 360, cpuSteps: 240 });
  }
}

const pageScript = (c) => `(async () => {
  const G = window.__gpu2d;
  G.setLoop(false);
  const stats = (arr) => {
    const v = arr.slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const mean = v.reduce((s, x) => s + x, 0) / v.length;
    return { mean, median: v[Math.floor(v.length / 2)], p95: v[Math.floor(v.length * 0.95)], max: v[v.length - 1], n: v.length };
  };
  const out = { name: '${c.name}' };
  const t0 = performance.now();
  const info = await G.reset(${c.kind === 'ram' ? `{ scene: 'ram', ramSpeed: 800, res: ${c.res}, pose: 90, dummy: 'atlas', wall: 0 }` : `{ scene: '${c.kind}', res: ${c.res}, pairs: 6 }`});
  G.setLoop(false);
  out.buildMs = performance.now() - t0;
  out.scene = info;
  // rozgrzewka potoków i zegara karty
  await G.benchSteps(20, { batch: 2 });
  await G.reset(${c.kind === 'ram' ? `{ scene: 'ram', ramSpeed: 800, res: ${c.res}, pose: 90, dummy: 'atlas', wall: 0 }` : `{ scene: '${c.kind}', res: ${c.res}, pairs: 6 }`});
  G.setLoop(false);
  const r = await G.benchSteps(${c.gpuSteps}, { batch: 2 });
  const ticks = r.times;
  out.gpu = stats(ticks.map((t) => t.ms));
  // okna: lot (przed stykiem) i styk (0,4–2,4 s) — dla taranu
  out.gpuFlight = stats(ticks.filter((t) => t.tick <= 36).map((t) => t.ms));
  out.gpuContact = stats(ticks.filter((t) => t.tick > 48 && t.tick <= 288).map((t) => t.ms));
  out.encode = stats(r.encode);
  out.substeps = stats(ticks.map((t) => t.substeps));
  out.dispatches = stats(ticks.map((t) => t.dispatches));
  const summary = await G.readSummary();
  out.gpuEnd = { broken: summary.counters[1], killed: summary.counters[3], bodies: summary.bodies.filter((b) => !b.dead).length,
    wrecks: summary.bodies.filter((b) => b.wreck && !b.dead).length, nan: summary.nan };
  if (${withCpu}) {
    const m = await import('/dema/destruktor2d-webgpu/cpuReference.js');
    for (const local of [true, false]) {
      let sim;
      if ('${c.kind}' === 'ram') {
        const atlasHull = await G.loadHull('atlas');
        sim = m.createCpuRam({ atlasHull, dummyHull: atlasHull, cellSize: 1800 / ${c.res}, frames: 2, bulkheads: 8, speed: 800,
          pose: Math.PI / 2, massMul: 1, local, cfg: { crushStrength: 300000, globalBreakMul: 0.6 } });
      } else {
        const ids = ['atlas', 'terran_carrier', 'terran_battleship', 'pirate_battleship', 'terran_destroyer', 'pirate_destroyer',
          'terran_frigate', 'pirate_frigate', 'long_haul_freighter'];
        const hulls = {};
        for (const id of ids) hulls[id] = await G.loadHull(id);
        sim = m.createCpuFleet({ hulls, cellSize: 1800 / ${c.res}, frames: 2, bulkheads: 8, local, ramPairs: ${c.kind === 'fleet-ram' ? 6 : 0} });
      }
      const steps = ${c.cpuSteps};
      const times = sim.step(steps);
      const key = local ? 'cpuLocal' : 'cpuFull';
      out[key] = stats(times.map((t) => t.ms));
      out[key + 'Flight'] = stats(times.slice(0, 36).map((t) => t.ms));
      out[key + 'Contact'] = stats(times.slice(48, 288).map((t) => t.ms));
      out[key + 'Steps'] = steps;
      out[key + 'End'] = sim.summary();
    }
  }
  return out;
})()`;

const { server, base } = await startVite(5395);
const chrome = await startChrome({ width: 1280, height: 720, extraArgs: ['--enable-webgpu-developer-features'] });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const results = [];
const f = (s, k = 'mean') => (s ? s[k].toFixed(3) : '—').padStart(8);
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/destruktor2d-webgpu.html${args.q ? '?' + args.q : ''}` });
  const ok = await waitFor(cdp, '!!(window.__gpu2d && (window.__gpu2d.started || window.__gpu2d.error))', 180000, 300);
  const adapter = await evaluate(cdp, 'window.__gpu2d.error || window.__gpu2d.adapter');
  console.log(`adapter: ${adapter}${ok ? '' : ' (strona nie wystartowała)'}`);
  for (const c of CASES) {
    process.stdout.write(`${c.name} … `);
    const r = await evaluate(cdp, pageScript(c), 1800000);
    results.push(r);
    console.log(`węzły ${r.scene.nodes}, belki ${r.scene.beams}, kolory ${r.scene.colors}`);
    console.log(`   GPU  ms/krok: średnio ${f(r.gpu)}  mediana ${f(r.gpu, 'median')}  p95 ${f(r.gpu, 'p95')}  maks ${f(r.gpu, 'max')}` +
      `  | lot ${f(r.gpuFlight)} styk ${f(r.gpuContact)} | podkroki ${r.substeps?.mean.toFixed(1)} dispatchy ${r.dispatches?.max}` +
      ` | CPU kodowanie ${f(r.encode)}`);
    for (const key of ['cpuLocal', 'cpuFull']) {
      if (!r[key]) continue;
      console.log(`   ${key === 'cpuLocal' ? 'CPU lokalny' : 'CPU pełny  '} ms/krok: średnio ${f(r[key])}  mediana ${f(r[key], 'median')}  p95 ${f(r[key], 'p95')}` +
        `  maks ${f(r[key], 'max')}  | lot ${f(r[key + 'Flight'])} styk ${f(r[key + 'Contact'])}  (${r[key + 'Steps']} kroków)`);
    }
    console.log(`   koniec GPU: zerwania ${r.gpuEnd.broken}, ciała ${r.gpuEnd.bodies}, wraki ${r.gpuEnd.wrecks}${r.gpuEnd.nan ? `, NaN ${r.gpuEnd.nan}` : ''}` +
      (r.cpuFullEnd ? ` | CPU pełny: ${JSON.stringify(r.cpuFullEnd)}` : ''));
  }
} finally {
  const errs = logs.errors().filter((l) => !/favicon/.test(l));
  if (errs.length) console.log('BŁĘDY:\n' + errs.slice(0, 20).join('\n'));
  await chrome.close();
  await server.close();
}
const file = writeJson(join(repo, '.tmp/belki-gpu/bench.json'), { when: new Date().toISOString(), results });
console.log(`\nwyniki: ${file}`);
process.exit(0);
