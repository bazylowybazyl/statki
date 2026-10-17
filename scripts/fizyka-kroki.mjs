// KOSZT KAŻDEGO KROKU FIZYKI i rytm klatek wątku gry w dużej bitwie (2026-10-17, audyt „fizyka w workerze” —
// docs/AUDYT-fizyka-worker-2026-10-17.md). Bez zmian w grze: opakowania PerfHUD.markPhysicsStep / addTiming /
// recordFrameTime (kubełki krok po kroku), HullBodies.step, worldBodies.step, rocketSystem3D.step w stronie; rejestr
// rAF (odstęp, CPU wszystkich wywołań rAF klatki), longtask. Bitwa jak w scripts/profil-bitwy-flot.mjs (piraci przed
// dziobem, Terra Nova za graczem, pustka między Wenus a Ziemią, gracz nieśmiertelny).
//   node scripts/fizyka-kroki.mjs [--sklad 50,20,10,3] [--zoom 0.45] [--trwanie 90] [--tryb worker|off] [--okno 1]
//        [--seed 7] [--physHz 60] [--profile 25:5,65:5] [--out .tmp/fizyka-kroki/<nazwa>] [--port 5296]
// --okno 1: prawdziwe okno z vsync (headless: false, 1280 × 720) — okresy rAF jak u gracza; bez niego headless bez
// limitu klatek (koszty pod obciążeniem wątków bez vsync). Wynik: <out>/kroki.json (+ profile .cpuprofile);
// analiza: node scripts/fizyka-kroki-analiza.mjs <out>/kroki.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVite, navigateAndWait, evaluate, sleep } from '../dema/rdzen-cdp.js';
import { startChrome, parseArgs } from './webgpu/wspolne.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const args = parseArgs();
const SKLAD = String(args.sklad || '50,20,10,3').split(',').map((v) => Math.max(0, Number(v) || 0));
const [NF, ND, NB, NS] = [SKLAD[0] || 0, SKLAD[1] || 0, SKLAD[2] || 0, SKLAD[3] || 0];
const ZOOM = Number(args.zoom || 0.45);
const TRWANIE = Number(args.trwanie || 90);
const TRYB = args.tryb || 'worker';
const SEED = Number(args.seed || 7) >>> 0;
const PHYS_HZ = Number(args.physHz || 60);
const PORT = Number(args.port || 5296);
const OKNO = args.okno === '1';   // prawdziwe okno z vsync (headless: false) zamiast headless bez limitu klatek
const OUT = resolve(repoRoot, args.out || `.tmp/fizyka-kroki/${SKLAD.join('-')}-z${ZOOM}-${TRYB}-${PHYS_HZ}hz${args.okno === '1' ? '-okno' : ''}`);
const PROFILE_AT = String(args.profile || '').split(',').filter(Boolean)
  .map((v) => { const [a, d] = v.split(':').map(Number); return { at: a, dur: Number.isFinite(d) && d > 0 ? d : 5 }; });
mkdirSync(OUT, { recursive: true });

// Kubełki kroku (klucze PerfHUD.addTiming wołane w physicsStep) + opakowania.
const KEYS = ['physicsTime', 'preAiTime', 'worldZoneTime', 'playerSystemsTime', 'scanUiTime', 'playerFlightTime', 'wreckPrepTime',
  'aiTime', 'aiSquadsTime', 'aiSupportWingTime', 'aiNpcStepTime', 'aiNpcGridTime', 'aiNpcEnemyBrainTime', 'aiNpcFriendlyBrainTime',
  'aiNpcOtherTime', 'aiSeparationTime', 'aiWeaponScanTime', 'aiTargetPickTime', 'aiPirateMissionTime',
  'ciwsTime', 'npcFireTime', 'projectileTime', 'destructiblePrepTime', 'destructorTime', 'collisionTime', 'hardpointTime', 'hudNavTime'];
const EXTRA = ['hbStep', 'wbStep', 'rocketStep', 'aiTick', 'first', 'frameId', 'npc', 'bullets', 'wrecks', 't', 'gap'];
const COLS = [...KEYS, ...EXTRA];

const INJECT = `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {}
  let s = ${SEED};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // Rejestr klatek rAF: odstęp, CPU wszystkich wywołań rAF tej klatki.
  const F = window.__fw = { on: false, frames: [], lt: [] };
  const raf = window.requestAnimationFrame.bind(window);
  let curTs = -1, cpu = 0;
  window.requestAnimationFrame = function (cb) {
    return raf((ts) => {
      if (ts !== curTs) { if (curTs >= 0 && F.on) F.frames.push([ts - curTs, cpu, performance.now()]); curTs = ts; cpu = 0; }
      const t0 = performance.now();
      try { cb(ts); } finally { cpu += performance.now() - t0; }
    });
  };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (F.on) F.lt.push([e.startTime, e.duration]); }).observe({ entryTypes: ['longtask'] }); } catch {}
})();`;

const INSTALL = `(async () => {
  const m = await import('/src/ui/perfHud.js'); const PH = m.PerfHUD;
  const KEYS = ${JSON.stringify(KEYS)}, COLS = ${JSON.stringify(COLS)};
  const idx = new Map(COLS.map((k, i) => [k, i])), NC = COLS.length;
  const CAP = 40000;
  const R = window.__kr = { on: false, rows: new Float64Array(CAP * NC), n: 0, NC, cols: COLS, cur: null, frames: [], lastFrame: -1, lastAi: -1,
    stepT0: 0, lastClose: 0, inStep: false, loopFrames: [] };
  const cur = new Float64Array(NC);
  const oMark = PH.markPhysicsStep.bind(PH), oAdd = PH.addTiming.bind(PH), oRec = PH.recordFrameTime.bind(PH);
  let stepsInFrame = 0, physInFrame = 0;
  PH.markPhysicsStep = function () {
    if (R.on) { cur.fill(0); R.inStep = true; R.stepT0 = performance.now(); cur[idx.get('gap')] = R.lastClose ? R.stepT0 - R.lastClose : 0; }
    return oMark();
  };
  PH.addTiming = function (key, ms) {
    if (R.on && R.inStep) {
      const i = idx.get(key);
      if (i !== undefined) cur[i] += ms;
      if (key === 'physicsTime') {
        R.inStep = false;
        const fid = window.__frameId | 0, ai = window.__aiDecisionTickId | 0;
        cur[idx.get('aiTick')] = ai !== R.lastAi ? 1 : 0; R.lastAi = ai;
        cur[idx.get('first')] = fid !== R.lastFrame ? 1 : 0; R.lastFrame = fid;
        cur[idx.get('frameId')] = fid;
        cur[idx.get('npc')] = (window.npcs || []).length; cur[idx.get('bullets')] = (window.bullets || []).length; cur[idx.get('wrecks')] = (window.wrecks || []).length;
        cur[idx.get('t')] = performance.now();
        R.lastClose = performance.now();
        if (R.n < CAP) { R.rows.set(cur, R.n * NC); R.n++; }
        stepsInFrame++; physInFrame += ms;
      }
    }
    return oAdd(key, ms);
  };
  PH.recordFrameTime = function (ms) {
    if (R.on) { R.loopFrames.push([ms, stepsInFrame, physInFrame, performance.now()]); }
    stepsInFrame = 0; physInFrame = 0;
    return oRec(ms);
  };
  const wrap = (obj, name, col) => { if (!obj || typeof obj[name] !== 'function') return false; const o = obj[name];
    const ci = idx.get(col);
    obj[name] = function (...a) { if (!(R.on && R.inStep)) return o.apply(this, a); const t0 = performance.now(); try { return o.apply(this, a); } finally { cur[ci] += performance.now() - t0; } };
    return true; };
  const w = { hb: wrap(window.HullBodies, 'step', 'hbStep'), wb: wrap(window.WorldBodies, 'step', 'wbStep'), rk: wrap(window.rocketSystem3D, 'step', 'rocketStep') };
  if (!PH.visible) PH.toggle();
  return w;
})()`;

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: OKNO ? 1280 : 1920, height: OKNO ? 720 : 1080, webgpu: false, headless: OKNO ? false : undefined, renderMode: TRYB === 'worker' ? 'worker' : 'off' });
const { cdp, logs } = chrome;
const ev = (e, t) => evaluate(cdp, e, t);
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
const q = `dev=1&physHz=${PHYS_HZ}${TRYB === 'worker' ? '&renderWorker=1' : '&renderWorker=0'}`;
const report = (k, v) => console.log(String(k).padEnd(10), typeof v === 'string' ? v : JSON.stringify(v));
try {
  const ready = await navigateAndWait(cdp, `${base}/index.html?${q}`, '!!(window.ship && window.HullBodies && window.Core3D)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  let started = false;
  for (let t0 = Date.now(); !started && Date.now() - t0 < 240000;) { await sleep(250); try { started = await ev('(window.__frameId || 0) > 30 && !!window.camera'); } catch {} }
  report('gra', { ready, started, tryb: await ev('window.__renderModeBoot?.mode || window.RenderSnapshot?.mode || null') });
  report('opakowania', await ev(INSTALL));
  report('miejsce', await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) { const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin }; }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return; if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { najblizejKm: Math.round(best.dmin / 1000) };
  })()`));
  await sleep(4000);
  // spokój (bez bitwy) — 6 s rejestru
  await ev('(() => { window.__kr.on = true; window.__fw.on = true; return 1; })()');
  await sleep(6000);
  const calm = await ev(`(() => { const R = window.__kr; const out = { n: R.n, rows: Array.from(R.rows.subarray(0, R.n * R.NC)), loop: R.loopFrames.splice(0), fw: window.__fw.frames.splice(0), lt: window.__fw.lt.splice(0) }; R.n = 0; return out; })()`, 60000);
  report('spokój', { kroki: calm.n, klatki: calm.loop.length });
  report('spawn', await ev(`(() => {
    const s = window.ship, a = 0, c = Math.cos(a), n = Math.sin(a);
    const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
    const out = { piraci: 0, tn: 0 };
    const put = (key, mode, pos, ang) => { const r = window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
      const k = Array.isArray(r) ? r.length : (r ? 1 : 0); if (mode === 'pirate') out.piraci += k; else out.tn += k; };
    const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
      for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
        put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
    block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, a + Math.PI);
    block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, a + Math.PI);
    block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, a + Math.PI);
    block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, a + Math.PI);
    block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, a);
    block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, a);
    block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, a);
    block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, a);
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    window.__spawnT = performance.now();
    return out;
  })()`));
  const t0 = Date.now();
  const sec = () => (Date.now() - t0) / 1000;
  const todo = [...PROFILE_AT].sort((a, b) => a.at - b.at);
  const hud = [];
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  while (sec() < TRWANIE) {
    if (todo.length && sec() >= todo[0].at) {
      const { at, dur } = todo.shift();
      await cdp.send('Profiler.start');
      await sleep(dur * 1000);
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(join(OUT, `profil-t${at}.cpuprofile`), JSON.stringify(profile));
      report('profil', { at, dur });
      continue;
    }
    await sleep(3000);
    const h = await ev(`(() => { const d = window.__PH?.display || (window.__phRef ||= null); const H = window.RenderWorkerHost; if (H) H.readStats?.();
      const npcs = window.npcs || []; const live = npcs.filter((n) => !n.dead);
      return { t: Math.round((performance.now() - window.__spawnT) / 100) / 10, npc: live.length, pir: live.filter((n) => !n.friendly).length,
        wraki: (window.wrecks || []).length, zimne: (window.coldWrecks || []).length, pociski: (window.bullets || []).length,
        rakiety: window.rocketSystem3D?.rockets?.length ?? null, wezly: (() => { let k = 0; for (const h of (window.HullBodies?._hulls || [])) { const b = h?.body; if (b && !b.dead) k += b.activeNodes || 0; } return k; })(),
        composed: H ? H.composed : null,
        // worker renderu (RET_F64): CPU klatki workera [ms], GPU klatki, liczniki narastające — takty rAF, czekania na
        // stronę, rendery (różnice między próbkami → na sekundę)
        w: H ? { cpu: Math.round((H.stats[6] || 0) * 100) / 100, render: Math.round((H.stats[5] || 0) * 100) / 100,
          gpu: Math.round((H.stats[0] || 0) * 100) / 100, ticks: H.stats[13] || 0, waits: H.stats[14] || 0, renders: H.stats[16] || 0,
          msgRenders: H.stats[17] || 0, lagSum: H.stats[18] || 0, lagN: H.stats[19] || 0, frames: window.__frameId | 0, wall: performance.now() } : null };
    })()`);
    hud.push(h);
    report(`t=${Math.round(sec())}`, h);
  }
  const dump = await ev(`(() => { const R = window.__kr; R.on = false; window.__fw.on = false;
    return { n: R.n, cols: R.cols, rows: Array.from(R.rows.subarray(0, R.n * R.NC)), loop: R.loopFrames.splice(0), fw: window.__fw.frames.splice(0), lt: window.__fw.lt.splice(0), spawnT: window.__spawnT }; })()`, 120000);
  writeFileSync(join(OUT, 'kroki.json'), JSON.stringify({ sklad: SKLAD, zoom: ZOOM, tryb: TRYB, seed: SEED, physHz: PHYS_HZ, cols: COLS, calm, dump, hud }));
  report('zapis', { plik: join(OUT, 'kroki.json'), kroki: dump.n, klatki: dump.loop.length });
  const errs = logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys|favicon/.test(l));
  report('błędy', errs.slice(0, 8));
} catch (e) {
  console.log('BŁĄD', e.stack || e.message);
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}
