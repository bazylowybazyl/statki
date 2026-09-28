// Czas klatki rozpadu stacji w PRAWDZIWEJ grze (zadanie 16): klatki wokół rozpadu, budowy materiałów w nich.
// Ten sam scenariusz na tagu webgl-baseline (WebGL — worktree tagu, `--backend webgl`) i na gałęzi (WebGPU):
//   1) Wenus — destroyStation3D jak gra przy 0 HP (odłamki paneli, wygaszenie bryły),
//   2) Merkury — rozpad na trójkąty (debrisStyle „triangles”, materiał rozpadu),
//   3) Saturn — implozja (mode „implode”),
//   4) Uran — detachChunk jak gra przy progu HP, kroki do podziału fragmentu na kawałki (klony z cięciem),
//   5) Neptun — destroyStation3D (inny model GLB: MeshPhysicalMaterial).
// Klatki krokowane zegarem harnessu (harness-strona.js), czas CPU klatki = najdłuższe wywołanie rAF strony w klatce
// (pętla gry), mierzony prawdziwym zegarem; Core3D.render osobno. Na WebGPU dodatkowo liczniki cache NodeManagera
// (budowy NodeBuildera = nowe wpisy nodeBuilderCache) i pipeline'ów; na WebGL — liczba programów (renderer.info).
// Przed pomiarem: stacje gotowe, rozgrzewki w wolnych chwilach (czekanie w czasie rzeczywistym).
//
//   node scripts/webgpu/rozpad-stacji.mjs [--backend webgpu|webgl] [--out plik.json] [--port 5354] [--powtorz 1]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, repo, osobneLosowanieUuid, parseArgs, sleep } from './wspolne.mjs';

const args = parseArgs();
const backend = args.backend || 'webgpu';
const out = resolve(repo, args.out || `.tmp/webgpu/zadania/16/rozpad-${backend}.json`);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const repeats = Math.max(1, Number(args.powtorz || 1));

const PAGE_SETUP = String.raw`(async () => {
  const S = window.__harness.scene, H = window.__harness, realNow = H.realNow;
  S.hideHud(true);
  const glb = () => stations.filter((s) => !s.ringPort && !s.isPirate).every((s) => !!s._mesh3d);
  for (let i = 0; i < 900 && !glb(); i++) await H.frames(2);
  // Rejestr klatek: każde wywołanie rAF strony mierzone prawdziwym zegarem.
  const rec = window.__rozpadRec = { frames: [], cur: 0, render: 0 };
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => raf((ts) => { const t0 = realNow(); try { cb(ts); } finally { const d = realNow() - t0; if (d > rec.cur) rec.cur = d; } });
  const C = window.Core3D;
  const origRender = C.render;
  C.render = function (...a) { const t0 = realNow(); const r = origRender.apply(this, a); rec.render += realNow() - t0; return r; };
  // WebGPU: każda budowa materiału = backend.createNodeBuilder + build() — licznik i czas CPU budów w klatce.
  rec.builds = 0; rec.buildMs = 0;
  const be = C.renderer?.backend;
  if (C.renderer?.isWebGPURenderer && be?.createNodeBuilder) {
    const create = be.createNodeBuilder.bind(be);
    be.createNodeBuilder = (...a) => {
      const nb = create(...a);
      rec.builds++;
      const build = nb.build.bind(nb);
      nb.build = (...b) => {
        const t0 = realNow();
        try { return build(...b); } finally {
          const ms = realNow() - t0;
          rec.buildMs += ms;
          const m = nb.material;
          const label = (m?.isShadowPassMaterial ? 'cień:' : '') + (m?.type || '?') + ':' + (nb.object?.name || nb.object?.type || '?');
          (rec.what || (rec.what = [])).push(label.slice(0, 80) + ' ' + ms.toFixed(1) + 'ms');
        }
      };
      return nb;
    };
  }
  return glb();
})()`;

// Liczniki renderera (WebGPU: cache NodeManagera i pipeline'ów; WebGL: programy).
const COUNTERS = String.raw`(() => {
  const r = window.Core3D.renderer;
  if (r?.isWebGPURenderer) {
    return { nodeBuilders: r._nodes?.nodeBuilderCache?.size ?? null, pipelines: r._pipelines?.caches?.size ?? null,
      programs: r._pipelines?.programs ? (r._pipelines.programs.vertex.size + r._pipelines.programs.fragment.size) : null };
  }
  return { programs: r?.info?.programs?.length ?? null };
})()`;

// Jeden przypadek: akcja w klatce 0, potem n klatek po 1/60 s; wiersz na klatkę.
function caseJs(name, stationId, action, frames, untilPieces = false) {
  return String.raw`(async () => {
    const S = window.__harness.scene, H = window.__harness, realNow = H.realNow, rec = window.__rozpadRec;
    const st = stations.find((s) => s.id === '${stationId}');
    S.cam(st.x, st.y, 0.5);
    // Nowy kadr (planeta, stacja): pierwsze rysowania i wgrywanie tekstur przed pomiarem.
    await H.frames(10);
    for (let i = 0; i < 300 && !S.uploadsIdle(); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500));
    await H.frames(10);
    const counters = () => (${COUNTERS});
    const before = counters();
    const rows = [];
    H.reseed(0x16b0);
    const { destroyStation3D } = await import('/src/3d/stations3D.js');
    const tA = realNow();
    ${action}
    const actionMs = realNow() - tA;
    const pieces = () => Core3D.scene.children.some((o) => /__piece\d+$/.test(o.name));
    let split = -1;
    const buildsBefore = rec.builds;
    for (let k = 0; k < ${frames}; k++) {
      rec.cur = 0; rec.render = 0; rec.buildMs = 0; rec.what = [];
      const b0 = rec.builds;
      await H.step(1);
      const c = counters();
      rows.push({ k, ms: +rec.cur.toFixed(2), render: +rec.render.toFixed(2), budowy: rec.builds - b0, budowyMs: +rec.buildMs.toFixed(2), co: rec.what.slice(0, 12), nb: c.nodeBuilders, pl: c.pipelines, pr: c.programs });
      if (${untilPieces ? 'true' : 'false'} && split < 0 && pieces()) { split = k; }
      if (${untilPieces ? 'true' : 'false'} && split >= 0 && k > split + 20) break;
    }
    return { name: '${name}', actionMs: +actionMs.toFixed(2), before, after: counters(), split, rows };
  })()`;
}

const CASES = [
  ['wenus-rozpad', 'venus', `st._destroyed3D = true; destroyStation3D(st, { shockwave: true });`, 40],
  ['merkury-trojkaty', 'mercury', `st._destroyed3D = true; destroyStation3D(st, { shockwave: true, debrisStyle: 'triangles' });`, 40],
  ['saturn-implozja', 'saturn', `st._destroyed3D = true; destroyStation3D(st, { shockwave: true, mode: 'implode' });`, 40],
  ['uran-odpad-podzial', 'uranus', `Destruction3D.detachChunk(st._mesh3d);`, 1500, true],
  ['neptun-rozpad', 'neptune', `st._destroyed3D = true; destroyStation3D(st, { shockwave: true });`, 40]
];

const summarize = (c) => {
  const ms = c.rows.map((r) => r.ms);
  const sorted = [...ms].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  const first = c.rows.slice(0, 5).map((r) => r.ms);
  const around = c.split >= 0 ? c.rows.slice(Math.max(0, c.split - 1), c.split + 4).map((r) => r.ms) : null;
  const buildFrames = c.rows.filter((r) => r.budowy > 0).map((r) => `k${r.k}:${r.budowy}/${r.budowyMs}ms`);
  return { przypadek: c.name, akcjaMs: c.actionMs, klatki0do4Ms: first, podzialKlatka: c.split, klatkiPodzialuMs: around,
    medianaMs: med, maksMs: Math.max(...ms), maksKlatka: ms.indexOf(Math.max(...ms)),
    budowy: c.rows.reduce((a, r) => a + (r.budowy || 0), 0), budowyMs: +c.rows.reduce((a, r) => a + (r.budowyMs || 0), 0).toFixed(2),
    klatkiZBudowami: buildFrames,
    skoki: c.rows.filter((r) => r.ms > 8).slice(0, 10).map((r) => ({ k: r.k, ms: r.ms, render: r.render, budowy: r.budowy, co: r.co })),
    nodeBuilderCache: (c.after.nodeBuilders ?? 0) - (c.before.nodeBuilders ?? 0),
    pipelineNowe: (c.after.pipelines ?? 0) - (c.before.pipelines ?? 0), programyNowe: (c.after.programs ?? 0) - (c.before.programs ?? 0) };
};

const { server, base } = await startVite(Number(args.port || 5354));
const results = [];
try {
  for (let rep = 1; rep <= repeats; rep++) {
    const chrome = await startChrome({ width: 1920, height: 1080 });
    const logs = await attachLogs(chrome);
    const { cdp } = chrome;
    const ev = (e, t = 600000) => evaluate(cdp, e, t);
    try {
      await osobneLosowanieUuid(cdp);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
      await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderer=${backend}` });
      if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
      await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
      await ev('window.__harness.hold(true)');
      if (!await ev(PAGE_SETUP)) throw new Error('bryły stacji nie powstały');
      // Rozgrzewki (requestIdleCallback) i wgrywanie tekstur — czas rzeczywisty, bez klatek gry.
      await sleep(6000);
      await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
      const run = { rep, cases: [] };
      for (const [name, id, action, frames, until] of CASES) {
        const c = await ev(caseJs(name, id, action, frames, !!until));
        const s = summarize(c);
        run.cases.push({ ...s, wiersze: c.split >= 0 ? c.rows.slice(Math.max(0, c.split - 2), c.split + 10) : c.rows.slice(0, 12) });
        console.log(`${backend} p${rep} ${name}: akcja ${s.akcjaMs} ms, klatki 0–4 ${JSON.stringify(s.klatki0do4Ms)} ms, mediana ${s.medianaMs}, maks ${s.maksMs} (k${s.maksKlatka}), budowy ${s.budowy} (${s.budowyMs} ms) ${JSON.stringify(s.klatkiZBudowami.slice(0, 8))}, programy +${s.programyNowe}${c.split >= 0 ? `, podział k${c.split}: ${JSON.stringify(s.klatkiPodzialuMs)}` : ''}`);
      }
      run.bledy = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 20);
      results.push(run);
    } finally {
      await chrome.close();
    }
  }
} finally {
  await server.close();
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ when: new Date().toISOString(), backend, results }, null, 2) + '\n');
console.log('zapisano', out);
process.exit(0);
