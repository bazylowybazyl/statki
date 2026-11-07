// Pomiar generatora planet (dema/generator-planet.html) przez CDP: klatki dema wstrzymane, czas GPU ze znaczników
// czasu (renderer z trackTimestamp — tylko przejścia wypieku), kompilacja przejść na zimno (świeży profil Chrome —
// bez pamięci shaderów), wypiek każdego rodzaju w rozdzielczościach, wypiek UKŁADU 8 planet (jeden odczyt prób),
// pamięć map (plannedBytes). Headless — bez obcego obciążenia GPU (gra użytkownika); krótko.
//
//   node scripts/webgpu/generator-planet-pomiar.mjs [--out .tmp/generator-planet/pomiar] [--roz 1024,2048,4096]
//        [--powt 3] [--uklad terran,rocky,desert,gas,gas,ice_giant,ice,barren] [--port 5441]
//        [--razem 1]   (kompilacja przejść WSZYSTKICH rodzajów jednym wywołaniem — równolegle w tle, jak ekran ładowania)
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/generator-planet/pomiar');
mkdirSync(out, { recursive: true });
const sizes = String(args.roz || '1024,2048,4096').split(',').map(Number);
const reps = Number(args.powt || 3);
const system = String(args.uklad || 'terran,rocky,desert,gas,gas,ice_giant,ice,barren').split(',');
const TYPES = ['terran', 'ocean', 'desert', 'rocky', 'ice', 'volcanic', 'barren', 'toxic', 'gas', 'ice_giant'];

const { server, base } = await startVite(Number(args.port || 5441));
const chrome = await startChrome({ width: 800, height: 450 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 900000) => evaluate(cdp, e, t);
let result;
try {
  // strona bez siatki: jedno ciało (najtańszy start), potem klatki wstrzymane
  await cdp.send('Page.navigate', { url: `${base}/dema/generator-planet.html?test=1&planeta=barren:1&roz=1024` });
  if (!await waitFor(cdp, '!!(window.__gen && window.__gen.ready())', 300000, 300)) throw new Error('demo nie wstało');
  result = await ev(`(async () => {
    const G = window.__gen, B = G.baker, r = G.renderer;
    G.S.paused = true;
    const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
    await sleep(300);
    await r.resolveTimestampsAsync('render');
    const timed = !!r.backend.trackTimestamp;
    const types = ${JSON.stringify(TYPES)};
    const out = { timed, compile: {}, bake: {}, system: null };
    // kompilacja na zimno: wszystkie naraz (--razem) albo rodzaj po rodzaju (przejścia wspólne przy pierwszym)
    if (${args.razem ? 'true' : 'false'}) {
      const t0 = performance.now();
      await B.compile(types);
      out.compileAll = performance.now() - t0;
    }
    for (const t of types) {
      const t0 = performance.now();
      await B.compile([t]);
      out.compile[t] = performance.now() - t0;
    }
    for (const t of types) {
      out.bake[t] = {};
      for (const size of ${JSON.stringify(sizes)}) {
        const gpu = [], wall = [];
        let bytes = 0;
        for (let k = 0; k < ${reps}; k++) {
          await r.resolveTimestampsAsync('render');
          const t0 = performance.now();
          const res = await B.bake({ type: t, seed: 1000 + k * 7 }, { size });
          wall.push(performance.now() - t0);
          gpu.push(timed ? await r.resolveTimestampsAsync('render') : null);
          bytes = res.bytes;
          res.dispose();
        }
        const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
        out.bake[t][size] = { gpuMs: timed ? med(gpu) : null, wallMs: med(wall), bytes };
      }
    }
    B.releaseScratch();
    // układ: wszystkie planety naraz (jeden odczyt prób)
    for (const size of ${JSON.stringify(sizes.filter((s) => s <= 2048))}) {
      await r.resolveTimestampsAsync('render');
      const t0 = performance.now();
      const res = await B.bakeSystem(${JSON.stringify(system)}.map((type, i) => ({ type, seed: 77 + i })), { size });
      const wall = performance.now() - t0;
      const gpu = timed ? await r.resolveTimestampsAsync('render') : null;
      const bytes = res.reduce((s, x) => s + x.bytes, 0);
      out.system = out.system || {};
      out.system[size] = { planets: res.length, wallMs: wall, gpuMs: gpu, bytes, scratchBytes: size * size / 2 * 16 };
      for (const x of res) x.dispose();
      B.releaseScratch();
    }
    return out;
  })()`);
  result.bledy = logs.errors().slice(0, 20);
} finally {
  writeJson(join(out, 'pomiar.json'), result || {});
  await chrome.close();
  await server.close();
}
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`czas GPU ze znaczników: ${result.timed ? 'tak' : 'NIE'}`);
if (result.compileAll != null) console.log(`kompilacja wszystkich przejść naraz (na zimno): ${result.compileAll.toFixed(0)} ms`);
console.log('rodzaj        kompil. ms | ' + sizes.map((s) => `${s}: GPU ms / ściana ms / MB`).join(' | '));
for (const t of TYPES) {
  const row = sizes.map((s) => { const b = result.bake[t][s]; return `${b.gpuMs?.toFixed(1) ?? '—'} / ${b.wallMs.toFixed(0)} / ${mb(b.bytes)}`; });
  console.log(`${t.padEnd(12)} ${result.compile[t].toFixed(0).padStart(8)}   | ${row.join(' | ')}`);
}
for (const [s, v] of Object.entries(result.system || {})) {
  console.log(`układ ${v.planets} planet @${s}: GPU ${v.gpuMs?.toFixed(1)} ms, ściana ${v.wallMs.toFixed(0)} ms, mapy ${mb(v.bytes)} MB (+ pole robocze ${mb(v.scratchBytes)} MB do releaseScratch)`);
}
if (result.bledy?.length) console.log('Błędy:', result.bledy.join('\n'));
process.exit(0);
