// Profil dużej bitwy w PRAWDZIWEJ grze: Vite + headless Chrome z GPU (d3d11) przez CDP
// (pomocniki z dema/rdzen-cdp.js), gra z ?dev, tryb single, bitwa piraci vs Terra Nova.
// Wypisuje próbki PerfHUD w trakcie bitwy i profil CPU (Profiler CDP) rozbity na
// poddrzewa updateHexShips3D („U hex”) i render() w ms na klatkę.
//   node scripts/profil-bitwy.mjs [--side 60] [--warm 60] [--prof 6] [--zoom 0.1] [--wrecks 90] [--out katalog]
// --side: okrętów na stronę (17% pancerników, 42% niszczycieli, reszta fregat),
// --warm: najdłużej tyle sekund bitwy przed profilem (wcześniej, gdy wraków ≥ --wrecks),
// --prof: sekundy profilu. Plik .cpuprofile (do DevTools → Performance) trafia do --out.
// Uwaga: sam start Profilera pauzuje stronę na ~0,5 s — liczy się suma, nie pojedyncze klatki.
// Zadanie 23 (port WebGPU): próbki mają też passy Core3D (draw calle, trójkąty, ms CPU passa) i GPU klatki;
// --out z próbkami w probki.json; ten sam skrypt na tagu webgl-baseline (skopiuj z dema/rdzen-cdp.js —
// kasuje profil Chrome) daje porównanie tag ↔ main. Rozbicie profilu: updateHexShips3D, render gry, render
// Core3D (passy → three) i koszt three na obiekt (renderObject / _renderObjectDirect, łącznie po nazwie).
//   --seed n: Math.random z ziarnem (mulberry32) — ta sama bitwa na obu wersjach (domyślnie bez).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../dema/rdzen-cdp.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SIDE = Number(arg('side', 60));
const WARM = Number(arg('warm', 60));
const PROF = Number(arg('prof', 6));
const ZOOM = Number(arg('zoom', 0.1));
const WRECKS = Number(arg('wrecks', 90));
const OUT = arg('out', join(tmpdir(), 'profil-bitwy'));
const SEED = arg('seed', null);
mkdirSync(OUT, { recursive: true });

const { server, base } = await startVite(5293);
const chrome = await startChrome({ width: 1920, height: 1080, webgpu: false });
// --seed: Math.random z ziarnem przed skryptami strony (ta sama bitwa na tagu i na main — gra bez harnessu,
// czas prawdziwy).
if (SEED !== null) {
  await chrome.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { let s = ${Number(SEED) >>> 0};
    Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();` });
}
const samples = [];
const { cdp, logs } = chrome;
const ev = (expr) => evaluate(cdp, expr);
const report = (label, value) => console.log(label.padEnd(10), typeof value === 'string' ? value : JSON.stringify(value));
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l));

const HUD_EXPR = `(() => { const d = window.__PH.display; const r = (v) => Math.round(v * 100) / 100;
  const live = window.npcs.filter((n) => !n.dead && !n.fighter), lod = window.__hexLodStats;
  const P = window.__rendererInfo?.passes || window.Core3D?.lastFrameRenderInfo || {};
  const pass = (k) => (P[k] ? [P[k].calls, Math.round((P[k].triangles || 0) / 1000), r(P[k].ms || 0)] : null);
  const C = window.Core3D;
  return { fps: d.fps, klatka: r(d.frameMs), p95: r(d.frameP95), fizyka: r(d.physicsTime), rysowanie: r(d.drawTime),
    uHex: r(d.render3dHexUpdateTime), core: r(d.render3dCoreRenderTime), rakiety: r(d.rocketsTime),
    npc: live.length, wrogów: live.filter((n) => !n.friendly).length, wraki: window.wrecks.length,
    pociski: (window.bullets || []).length, pełne: lod?.fullBodies, smugi: lod?.impostorBodies,
    gpu: r(Number(C?.gpuFrameMs) || 0), composer: r(C?.lastFramePerf?.composerMs || 0), renderTotal: r(C?.lastFramePerf?.renderTotalMs || 0),
    dc: window.__rendererInfo?.calls, ortho: pass('ortho'), fg: pass('fg'), bloom: pass('bloom'), post: pass('post'), tlo: pass('bg') || pass('tlo'),
    fx: C?.fxStats ? [C.fxStats.dispatches, r(C.fxStats.cpuMs)] : null }; })()`;

try {
  const ready = await navigateAndWait(cdp, `${base}/index.html?dev=1`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  let started = false;
  for (let t0 = Date.now(); !started && Date.now() - t0 < 240000;) {
    await sleep(250);
    try { started = await ev('(window.__frameId || 0) > 30'); } catch { /* ładuje się */ }
  }
  report('gra', { ready, started });
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle(); return true; })()`);
  await sleep(2500);

  report('spawn', await ev(`(() => {
    const s = window.ship, a = s.angle || 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    let count = 0;
    const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, spawnAngle: ang }); count += Array.isArray(r) ? r.length : (r ? 1 : 0); };
    const side = ${SIDE};
    const nb = Math.max(1, Math.round(side * 0.17)), nd = Math.round(side * 0.42), nf = side - nb - nd;
    const row = (key, mode, k, fwd, spacing, ang) => { for (let i = 0; i < k; i++) put(key, mode, at(fwd, (i - (k - 1) / 2) * spacing), ang); };
    row('pirate_battleship', 'pirate', nb, 9000, 1500, a + Math.PI);
    row('destroyer', 'pirate', nd, 7600, 650, a + Math.PI);
    row('frigate_pd', 'pirate', nf, 6600, 650, a + Math.PI);
    row('battleship', 'friendly', nb, -3000, 1500, a);
    row('destroyer', 'friendly', nd, -1800, 650, a);
    row('frigate_laser', 'friendly', nf, -900, 650, a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    return { okręty: count };
  })()`));

  const t0 = Date.now();
  while (Date.now() - t0 < WARM * 1000) {
    await sleep(5000);
    const d = await ev(HUD_EXPR);
    samples.push({ t: Math.round((Date.now() - t0) / 1000), ...d });
    report(`t=${Math.round((Date.now() - t0) / 1000)}`, d);
    if (d.wraki >= WRECKS) break;
  }

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const f0 = await ev('window.__frameId');
  await cdp.send('Profiler.start');
  await sleep(PROF * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  const frames = (await ev('window.__frameId')) - f0;
  // próbki po profilu (bez narzutu Profilera): stan bitwy w chwili pomiaru
  for (let i = 0; i < 3; i++) { await sleep(1500); const d = await ev(HUD_EXPR); samples.push({ t: 'po', ...d }); report('po profilu', d); }
  writeFileSync(join(OUT, 'probki.json'), JSON.stringify({ side: SIDE, zoom: ZOOM, seed: SEED, frames, samples }, null, 1));
  const file = join(OUT, `bitwa-${Date.now()}.cpuprofile`);
  writeFileSync(file, JSON.stringify(profile));
  report('profil', { klatek: frames, s: PROF, plik: file });
  analyze(profile, frames);
  report('błędy', errors().slice(0, 10));
} catch (e) {
  console.log('BŁĄD', e.stack || e.message, errors().slice(0, 10));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

function analyze(profile, frames) {
  const nodes = new Map();
  for (const n of profile.nodes) nodes.set(n.id, { ...n, self: 0, total: 0, parent: null });
  for (const n of nodes.values()) for (const c of (n.children || [])) nodes.get(c).parent = n;
  const { samples, timeDeltas } = profile;
  for (let i = 0; i < samples.length; i++) nodes.get(samples[i]).self += (timeDeltas[i + 1] ?? timeDeltas[i]) / 1000;
  const totalOf = (n) => { let t = n.self; for (const c of (n.children || [])) t += totalOf(nodes.get(c)); n.total = t; return t; };
  for (const n of nodes.values()) if (!n.parent) totalOf(n);
  const pf = (ms) => (ms / Math.max(1, frames)).toFixed(3);
  const nameOf = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  // Najwyższe wystąpienia funkcji (bez przodka o tej samej nazwie), dzieci scalone po nazwie.
  const breakdown = (fname, depth, minMs) => {
    const tops = [...nodes.values()].filter((n) => {
      if (n.callFrame.functionName !== fname) return false;
      for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fname) return false;
      return true;
    });
    console.log(`\n== ${fname}: ${pf(tops.reduce((s, n) => s + n.total, 0))} ms/klatkę`);
    const merge = (list, d, indent) => {
      const by = new Map();
      for (const n of list) for (const cid of (n.children || [])) {
        const c = nodes.get(cid), k = nameOf(c);
        const e = by.get(k) || { total: 0, self: 0, kids: [] };
        e.total += c.total; e.self += c.self; e.kids.push(c); by.set(k, e);
      }
      for (const [k, e] of [...by.entries()].sort((a, b) => b[1].total - a[1].total)) {
        if (e.total / Math.max(1, frames) < minMs) continue;
        console.log(`${indent}${pf(e.total)}  ${k}  [self ${pf(e.self)}]`);
        if (d > 1) merge(e.kids, d - 1, indent + '    ');
      }
    };
    merge(tops, depth, '  ');
  };
  breakdown('updateHexShips3D', 3, 0.01);
  breakdown('render', 1, 0.03);
  // Core3D: renderSingle → render (core3d.js) → passy → three (głębiej: koszt na obiekt w WebGPURenderer)
  breakdown('renderSingle', 6, 0.03);
  // three: koszt na obiekt (łącznie po nazwie w całym drzewie — renderObject woła _renderObjectDirect)
  const byName = new Map();
  for (const n of nodes.values()) {
    const fn = n.callFrame.functionName || '(anon)';
    let dup = false;
    for (let p = n.parent; p; p = p.parent) if (p.callFrame.functionName === fn) { dup = true; break; }
    if (dup) continue;
    byName.set(fn, (byName.get(fn) || 0) + n.total);
  }
  console.log('\n-- łącznie (inkluzywnie) wybrane funkcje three / Core3D (ms/klatkę):');
  for (const fn of ['_renderScene', 'renderObjects', '_renderObjects', 'renderObject', '_renderObjectDirect', 'getRenderObject', 'updateForRender',
    'getForRender', 'draw', 'setPipeline', 'setBindGroup', 'updateBefore', 'updateAfter', 'onObjectUpdate', 'needsRefresh', 'getNodeBuilderState',
    'compute', 'writeBuffer', 'projectObject', '_projectObject', 'push', 'sort', 'beginRender', 'finishRender', 'updateMatrixWorld']) {
    if (byName.has(fn)) console.log(`  ${pf(byName.get(fn)).padStart(7)}  ${fn}`);
  }
  const self = new Map();
  for (const n of nodes.values()) { const k = nameOf(n); self.set(k, (self.get(k) || 0) + n.self); }
  console.log('\n-- self-time całej strony (ms/klatkę):');
  for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${pf(v)}  ${k}`);
}
