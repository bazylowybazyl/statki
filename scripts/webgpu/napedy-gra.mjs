// NAPĘDY w PRAWDZIWEJ grze (E5, docs/PLAN-ekonomia-rynki.md § 3.4): prędkości gracza i czasy podróży
// w CZASIE GRY (zegar rejestru ruchu warpa — suma dt gry), żeby wolny headless nie zawyżał czasów.
// Vite + headless Chrome z WebGPU (CDP), gra swobodna, nieograniczone paliwo warpa.
//
//   node scripts/webgpu/napedy-gra.mjs [--out .tmp/napedy] [--etapy przelot,dopalacz,dolot,luna,mars,hiper]
//
// Etapy:
//   przelot  — BOJOWY, W trzymane: prędkość co sekundę, szczyt i czas do szczytu (PRZELOTU nie ma od 2026-10-22);
//   dopalacz — Shift + W w BOJOWYM: szczyt;
//   dolot    — TRAVEL TO 5 / 10 / 30 tys. j. (odcinki 'drive'): czas, fazy, błąd celu, prędkość na końcu;
//   luna     — TRAVEL TO do Księżyca (przy Ziemi);
//   mars     — TRAVEL TO pod Marsa (warp + dolot 'drive' w studni), potem pod Jowisza;
//   przechwyt — hipercruise + rajder piratów 30 km przed dziobem: blokada masy przerywa lot;
//   hiper    — hipercruise ręcznie (akcja nav.hypercruise): rozruch, szczyt, czas do szczytu, wyjście
//              (pomijany, gdy gra go nie ma — pomiar bazy przed E5).
// Na końcu pipeline'y utworzone synchronicznie po starcie (ma być 0).
//
// Wynik: <out>/raport.json i zrzuty <out>/*.png.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const out = resolve(repo, args.out || '.tmp/napedy');
mkdirSync(out, { recursive: true });
const etapy = new Set(String(args.etapy || 'przelot,dopalacz,dolot,luna,mars,hiper,przechwyt').split(','));

const { server, base } = await startVite(Number(args.port || 5379));
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { etapy: {}, bledy: [] };

await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [], startIdx: -1 };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();` });

const KEYS = {
  w: { key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87 },
  s: { key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 },
  shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
  o: { key: 'o', code: 'KeyO', windowsVirtualKeyCode: 79 }
};
const keyDown = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...KEYS[k], nativeVirtualKeyCode: KEYS[k].windowsVirtualKeyCode });
const keyUp = (k) => cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...KEYS[k], nativeVirtualKeyCode: KEYS[k].windowsVirtualKeyCode });
const gameT = () => ev('(window.WarpTraffic && window.WarpTraffic.time) || 0');
const speed = () => ev('Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y))');
async function waitGame(seconds) {
  const t0 = await gameT();
  for (let i = 0; i < 4000; i++) { if ((await gameT()) - t0 >= seconds) return; await sleep(40); }
}
// Zatrzymanie statku między etapami (narzędzie — nie rozgrywka): powrót na pozycję i kurs startu
// (devTeleportTo — etapy niezależne, porównywalne między wersjami), prędkość 0, postawa bojowa.
let startPose = null;
const stopShip = () => ev(`(() => { window.cancelTravel && window.cancelTravel(null); window.setShipMode('combat', true);
  if (window.hypercruise && window.hypercruise.state !== 'idle') window.__hypercruiseReset && window.__hypercruiseReset();
  const p = ${JSON.stringify(startPose)};
  if (p && window.devTeleportTo) window.devTeleportTo(p.x, p.y, { angle: p.angle, quiet: true });
  const s = window.ship; s.vel.x = 0; s.vel.y = 0; s.angVel = 0; s.command = null;
  return true; })()`);

async function profile(seconds, label) {
  const rows = [];
  const t0 = await gameT();
  let peak = 0, peakT = 0;
  for (let i = 0; i < 6000; i++) {
    const t = (await gameT()) - t0;
    const v = await speed();
    if (v > peak + 5) { peak = v; peakT = t; }
    if (!rows.length || t - rows[rows.length - 1].t >= 1) rows.push({ t: +t.toFixed(1), v });
    if (t >= seconds) break;
    await sleep(40);
  }
  console.log(label.padEnd(26), 'szczyt', peak, 'j/s po', peakT.toFixed(1), 's');
  return { szczyt: peak, poSek: +peakT.toFixed(1), probki: rows };
}

const navState = () => ev(`(() => { const n = window.travelNav, s = window.ship, t = n.target;
  return { faza: n.active ? n.phase : 'brak', warp: window.warp.state, hc: window.hypercruise ? window.hypercruise.state : null,
    v: Math.round(Math.hypot(s.vel.x, s.vel.y)), doCelu: t ? Math.round(Math.hypot(t.x - s.pos.x, t.y - s.pos.y)) : null,
    x: s.pos.x, y: s.pos.y }; })()`);

async function travel(goal, label, limitGameS = 400) {
  await ev(`window.setTravelTarget(${goal.x}, ${goal.y}, ${JSON.stringify(label)})`);
  const t0 = await gameT();
  const fazy = {};
  let last = null, lastT = 0, maxV = 0;
  let st = null;
  for (let i = 0; i < 40000; i++) {
    st = await navState();
    const t = (await gameT()) - t0;
    const key = st.faza === 'drive' && st.hc ? `drive/${st.hc}` : st.faza;
    if (last) fazy[last] = +((fazy[last] || 0) + (t - lastT)).toFixed(2);
    last = key; lastT = t;
    maxV = Math.max(maxV, st.v);
    if (st.faza === 'brak' || t > limitGameS) break;
    await sleep(40);
  }
  const czas = (await gameT()) - t0;
  // Po „na miejscu” statek dohamowuje — prędkość i odległość po 3 s gry.
  await waitGame(3);
  const end = await navState();
  const blad = Math.round(Math.hypot(goal.x - end.x, goal.y - end.y));
  const r = { czasS: +czas.toFixed(1), fazy, maxV, vKoniec: st.v, vPo3s: end.v, bladCelu: blad };
  console.log(label.padEnd(26), JSON.stringify(r));
  return r;
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(3000);
  await ev(`(() => { window.DevFlags && (window.DevFlags.unlimitedWarp = true); window.__pipeRec.startIdx = window.__pipeRec.pipes.length; return true; })()`);
  report.hiper = await ev('typeof window.hypercruise === "object" && !!window.hypercruise');
  report.warp = await ev('({ speed: window.warp.speed, drive: window.warp.driveId || null })');
  console.log('warp:', JSON.stringify(report.warp));
  report.start = await navState();
  startPose = await ev('({ x: window.ship.pos.x, y: window.ship.pos.y, angle: window.ship.angle })');
  await screenshotPng(cdp, join(out, '00-start.png'));

  if (etapy.has('przelot')) {
    // BOJOWY, W trzymane (PRZELOTU nie ma od 2026-10-22; w bazie sprzed zmiany — ten sam etap w postawie bojowej).
    await stopShip();
    await keyDown('w');
    report.etapy.bojowy = await profile(16, 'BOJOWY (W)');
    await keyUp('w');
    await stopShip();
  }
  if (etapy.has('dopalacz')) {
    await stopShip();
    await keyDown('w'); await keyDown('shift');
    report.etapy.dopalaczBojowy = await profile(16, 'BOJOWY + Shift');
    await keyUp('shift'); await keyUp('w');
    await stopShip();
  }
  if (etapy.has('dolot')) {
    // Odcinki 'drive' 5 / 10 / 30 tys. j. — kierunek OD najbliższej planety (bez płyty ringu po drodze).
    for (const dist of [5000, 10000, 30000]) {
      await stopShip();
      const goal = await ev(`(() => { const s = window.ship; let best = null, bd = Infinity;
        for (const p of window.planets) { if (!p) continue; const d = Math.hypot(s.pos.x - p.x, s.pos.y - p.y); if (d < bd) { bd = d; best = p; } }
        const a = best ? Math.atan2(s.pos.y - best.y, s.pos.x - best.x) : s.angle + 0.6;
        return { x: s.pos.x + Math.cos(a) * ${dist}, y: s.pos.y + Math.sin(a) * ${dist} }; })()`);
      report.etapy[`dolot${dist / 1000}k`] = await travel(goal, `TRAVEL ${dist / 1000} tys. (drive)`);
    }
    await stopShip();
  }
  if (etapy.has('luna')) {
    await stopShip();
    const goal = await ev(`(() => {
      let halo = null; window.Core3D.scene.traverse((o) => { if (!halo && o.name === 'MoonHalo:moon') halo = o; });
      const g = halo && halo.parent; if (!g) return null;
      const mx = g.position.x, my = -g.position.y, r = Math.max(Number(halo.scale.x) || 0, 1) * 1.075;
      const s = window.ship, dx = s.pos.x - mx, dy = s.pos.y - my, d = Math.hypot(dx, dy) || 1;
      return { x: mx + dx / d * (r + 4000), y: my + dy / d * (r + 4000), d: Math.round(d) };
    })()`);
    if (goal) {
      report.etapy.luna = { dystans: goal.d, ...(await travel(goal, `TRAVEL Luna (${Math.round(goal.d / 1000)} tys.)`)) };
      await screenshotPng(cdp, join(out, '01-luna.png'));
    } else report.etapy.luna = { blad: 'brak Księżyca w scenie' };
    await stopShip();
  }
  if (etapy.has('mars')) {
    for (const id of ['mars', 'jupiter']) {
      await stopShip();
      const goal = await ev(`(() => {
        const p = window.planets.find((q) => q && q.id === ${JSON.stringify(id)}); if (!p) return null;
        const r = window.planetOrbitRadii(p), s = window.ship, dx = s.pos.x - p.x, dy = s.pos.y - p.y, d = Math.hypot(dx, dy) || 1;
        const rr = r.outer + 3000;
        return { x: p.x + dx / d * rr, y: p.y + dy / d * rr, d: Math.round(d), well: Math.round(r.gravityWell) };
      })()`);
      if (!goal) { report.etapy[id] = { blad: 'brak planety' }; continue; }
      report.etapy[id] = { dystans: goal.d, studnia: goal.well, ...(await travel(goal, `TRAVEL ${id} (${Math.round(goal.d / 1000)} tys.)`, 600)) };
      await screenshotPng(cdp, join(out, `02-${id}.png`));
    }
    await stopShip();
  }
  if (etapy.has('hiper') && report.hiper) {
    await stopShip();
    await keyDown('o'); await sleep(60); await keyUp('o');
    const prof = await profile(30, 'HIPERCRUISE (O)');
    const peakState = await ev('JSON.parse(JSON.stringify({ state: window.hypercruise.state, vmax: window.hypercruise.vmax, engine: window.hypercruise.engineId }))');
    await screenshotPng(cdp, join(out, '03-hiper.png'));
    await keyDown('o'); await sleep(60); await keyUp('o');
    const t0 = await gameT();
    let wyj = null;
    for (let i = 0; i < 3000; i++) {
      const s = await ev('window.hypercruise.state');
      if (s === 'idle') { wyj = (await gameT()) - t0; break; }
      await sleep(40);
    }
    report.etapy.hiper = { ...prof, ...peakState, wyjscieS: wyj == null ? null : +wyj.toFixed(1), vPoWyjsciu: await speed() };
    console.log('HIPERCRUISE wyjście'.padEnd(26), JSON.stringify({ wyjscieS: report.etapy.hiper.wyjscieS, v: report.etapy.hiper.vPoWyjsciu }));
    await stopShip();
  }
  if (etapy.has('przechwyt') && report.hiper) {
    // Przechwyt: hipercruise ręczny, po rozpędzie rajder piratów 30 km przed dziobem — blokada masy (12 km)
    // ma przerwać lot (wyjście z flagą interrupted), a statek nie może przelecieć przez rajdera.
    await stopShip();
    // Kurs od najbliższej planety (płyta ringu zrywa hipercruise — nie o to tu chodzi).
    await ev(`(() => { const s = window.ship; let best = null, bd = Infinity;
      for (const p of window.planets) { if (!p) continue; const d = Math.hypot(s.pos.x - p.x, s.pos.y - p.y); if (d < bd) { bd = d; best = p; } }
      if (best) window.devTeleportTo(s.pos.x, s.pos.y, { angle: Math.atan2(s.pos.y - best.y, s.pos.x - best.x), quiet: true });
      return true; })()`);
    await keyDown('o'); await sleep(60); await keyUp('o');
    for (let i = 0; i < 3000; i++) { if ((await ev('window.hypercruise.state')) === 'active' && (await speed()) > 8000) break; await sleep(40); }
    const pir = await ev(`(() => { const s = window.ship, d = 30000;
      const n = window.spawnDevHull('pirate_raider', { spawnPos: { x: s.pos.x + Math.cos(s.angle) * d, y: s.pos.y + Math.sin(s.angle) * d } });
      if (n) n.combatDisabled = false;   // manekin dev jest uśpiony — uśpione okręty celowo nie blokują
      return n ? { x: n.x ?? n.pos?.x, y: n.y ?? n.pos?.y } : null; })()`);
    const t0 = await gameT();
    let st = null;
    for (let i = 0; i < 3000; i++) {
      st = await ev('({ s: window.hypercruise.state, i: window.hypercruise.interrupted, r: window.hypercruise.reason, v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)) })');
      if (st.s === 'idle') break;
      await sleep(40);
    }
    const dist = pir ? await ev(`Math.round(Math.hypot(window.ship.pos.x - ${pir.x}, window.ship.pos.y - ${pir.y}))`) : null;
    report.etapy.przechwyt = { rajder: !!pir, ...st, poS: +((await gameT()) - t0).toFixed(1), odRajdera: dist };
    console.log('PRZECHWYT'.padEnd(26), JSON.stringify(report.etapy.przechwyt));
    await screenshotPng(cdp, join(out, '04-przechwyt.png'));
    await stopShip();
  }
  const pipes = await ev('(() => { const R = window.__pipeRec; return R.pipes.slice(Math.max(0, R.startIdx)).filter((p) => p.sync).map((p) => p.nazwa); })()');
  report.pipelineSyncPoStarcie = pipes;
  console.log('pipeline sync po starcie:', pipes.length, JSON.stringify(pipes.slice(0, 12)));
} catch (err) {
  report.blad = String(err?.stack || err);
  console.error(err);
} finally {
  report.bledy = logs.errors().slice(0, 40);
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
  process.exit(0);
}
