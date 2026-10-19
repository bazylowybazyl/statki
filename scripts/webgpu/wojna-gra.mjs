// Scena „Wojna” (DevScene.wojna — src/game/warScene.js, 2026-10-19) w PRAWDZIWEJ grze: dwie floty wychodzą z warpa
// z pędem naprzeciw siebie (Terra Nova ~20, piraci ~25), obie w postawie NATARCIA. Harness w trybie hold (kroki tylko
// przez __harness.step), co sekundę czasu gry: stan sceny (przyloty, zwolnienia z tunelu, zmierzone ŚLIZGI — od końca
// hamowania do prędkości bojowej), okręty w przelotach, stojące, wolniejsze niż 0,6 maxSpeed w przelocie, odległość flot,
// straty; zrzuty zwiastunów, przylotów i zwarcia; na końcu klatki (CPU, przestoje), Core3D.gpuFrameMs, pipeline'y
// SYNCHRONICZNE (ma być 0) i błędy konsoli.
//
//   node scripts/webgpu/wojna-gra.mjs [--out .tmp/wojna/gra] [--czas 60] [--k 3] [--zwiastun thread|ripple|none]
//        [--tlo jupiter|mars] [--atlas side|fleet] [--A 20] [--B 25] [--odleglosc 25000] [--rozmiar 1600x900]
//        [--zrzuty 1.5,4,6,8,10,13,18,25,35,50] [--query renderWorker=1]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/wojna/gra');
const CZAS = Number(args.czas || 60);
const SHOTS = String(args.zrzuty || '1.5,4,5.5,7,9,11,13,16,20,26,35,50').split(',').map(Number).filter((t) => t <= CZAS);
const opts = {
  k: Number(args.k ?? 3),
  heraldStyle: args.zwiastun || 'thread',
  backdrop: args.tlo || 'jupiter',
  atlas: args.atlas || 'side',
  countA: Number(args.A || 20),
  countB: Number(args.B || 25),
  distance: Number(args.odleglosc || 25000)
};
const query = args.query ? `&${args.query}` : '';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5447));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const report = { opts, plan: null, probki: [], zrzuty: {}, slizgi: null, klatki: null, pipeline: null, bledy: [] };

// Próbka stanu bitwy (wszystkie okręty sceny): przeloty, wolno w przelocie, stoją z celem, odległość środków flot.
const PROBE = `(() => {
  const st = window.DevScene.wojnaState();
  const list = (window.WarScene?.tracked || []).map((t) => t.e).filter((e) => e && !e.dead && e.isCollidable !== false);
  let charging = 0, slow = 0, standing = 0, withTarget = 0, fighters = 0;
  const why = {};
  const c = { A: [0, 0, 0], B: [0, 0, 0] };
  for (const e of list) {
    const spec = e.__flightSpec;
    const sp = Math.hypot(e.vx || 0, e.vy || 0);
    const side = e.__warScene;
    if (side && c[side]) { c[side][0] += e.x; c[side][1] += e.y; c[side][2]++; }
    if (!spec) continue;
    if (e.__charge && e.__charge.phase) { charging++; if (sp < 0.6 * spec.maxSpeed) slow++; }
    if (e.target && !e.target.dead) {
      withTarget++;
      if (sp < 0.3 * spec.maxSpeed) {
        standing++;
        const sl = e.__battleSlot;
        const k = (e.__warScene || '?') + ' ' + e.type + ' ' + (sl ? sl.kind + '/' + sl.role + '/' + sl.phase : 'bez miejsca')
          + (e.__charge && e.__charge.phase ? ' przelot-' + e.__charge.phase : '');
        why[k] = (why[k] || 0) + 1;
      }
    }
  }
  for (const n of window.npcs || []) if (n && !n.dead && n.fighter) fighters++;
  const ca = c.A[2] ? [c.A[0] / c.A[2], c.A[1] / c.A[2]] : null;
  const cb = c.B[2] ? [c.B[0] / c.B[2], c.B[1] / c.B[2]] : null;
  const ph = (s) => { const p = window.getFleetPhase?.(s); return p ? p.phase : null; };
  return { t: st.t, A: st.A.alive + '/' + st.A.spawned, B: st.B.alive + '/' + st.B.spawned,
    zwolnione: st.A.released + st.B.released, wPrzelocie: charging, wolnoWPrzelocie: slow, zCelem: withTarget, stoi: standing, stoiCo: why,
    mysliwce: fighters, odlegloscFlot: ca && cb ? Math.round(Math.hypot(ca[0] - cb[0], ca[1] - cb[1])) : null,
    fazy: { tn: ph('friendly'), pir: ph('pirate') }, warp: window.WarpTraffic ? window.WarpTraffic.records.length : null,
    zoom: +window.camera.zoom.toFixed(4), gpuMs: +(Number(window.Core3D?.gpuFrameMs) || 0).toFixed(2) };
})()`;

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  await ev('window.__harness.frames(4)');
  await ev('window.__harness.hold(true)');
  // Atlas nieśmiertelny (widz) — scena dotyczy flot.
  await ev(`(() => { window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
    if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100); return true; })()`);
  report.plan = await ev(`window.DevScene.wojna(${JSON.stringify(opts)})`);
  console.log('plan:', JSON.stringify({ center: report.plan.center, planet: report.plan.planet,
    A: report.plan.fleets.A.count, B: report.plan.fleets.B.count, startB: report.plan.fleets.B.start }));
  const begLog = await ev('window.__harness.frameLog.n');
  const STEP = 1000 / 60;
  let t = 0;
  let shotI = 0;
  let nextProbe = 0;
  while (t < CZAS) {
    const nextShot = shotI < SHOTS.length ? SHOTS[shotI] : Infinity;
    const target = Math.min(nextShot, nextProbe, CZAS);
    const n = Math.max(1, Math.round((target - t) * 60));
    await ev(`window.__harness.step(${n}, ${STEP})`);
    t = await ev('window.DevScene.wojnaState().t');
    if (t + 1e-6 >= nextProbe) {
      const p = await ev(PROBE);
      report.probki.push(p);
      console.log(JSON.stringify(p));
      nextProbe += 1;
    }
    if (t + 1e-6 >= nextShot) {
      const name = `wojna-${String(shotI).padStart(2, '0')}-t${nextShot.toFixed(1)}`;
      await screenshotPng(cdp, join(out, `${name}.png`));
      report.zrzuty[name] = await ev(PROBE);
      console.log('zrzut', name);
      shotI++;
    }
  }
  const st = await ev('window.DevScene.wojnaState()');
  const stat = (arr) => {
    if (!arr.length) return null;
    const v = arr.map((s) => s.slide).sort((a, b) => a - b);
    return { n: v.length, min: v[0], med: v[v.length >> 1], max: v[v.length - 1] };
  };
  const byKey = (side) => {
    const m = {};
    for (const s of st[side].slides) (m[s.key] ||= []).push(s);
    return Object.fromEntries(Object.entries(m).map(([k, a]) => [k, { ...stat(a), vExit: Math.round(a.reduce((q, s) => q + s.vExit, 0) / a.length),
      t: +(a.reduce((q, s) => q + s.t, 0) / a.length).toFixed(2), bladPunktu: Math.round(a.reduce((q, s) => q + s.endErr, 0) / a.length) }]));
  };
  report.slizgi = { A: byKey('A'), B: byKey('B'), wszystkie: stat([...st.A.slides, ...st.B.slides]) };
  console.log('ślizgi:', JSON.stringify(report.slizgi, null, 1));
  const fs = await ev(`window.__harness.frameStats(${begLog})`);
  report.klatki = { klatki: fs.klatki, przestoje: fs.przestoje, maksMs: fs.maksMs, maksCpu: fs.maksCpu, lista: fs.lista };
  report.pipeline = fs.pipeline;
  console.log('klatki:', JSON.stringify(report.klatki), 'pipeline sync:', fs.pipeline?.sync, JSON.stringify(fs.pipeline?.syncLista || []).slice(0, 400));
  report.bledy = logs.errors().filter((l) => !/favicon|DevTools|\[vite\]/.test(l)).slice(0, 30);
} catch (e) {
  report.blad = String(e?.stack || e);
  console.error(e);
} finally {
  writeFileSync(join(out, 'wyniki.json'), JSON.stringify(report, null, 1));
  await chrome.close();
  await server.close();
}
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
console.log('wyniki:', join(out, 'wyniki.json'));
