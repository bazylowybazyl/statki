// Kamera w bitwie (2026-10-11, reżyser kadru — src/game/cameraDirector.js): skok dev do fazy kampanii, próbki co
// --krok s: kamera (środek, zoom, kadr w km), statek na ekranie, rig, reżyser (obecność, człon zoomu, przesunięcie,
// punkty, sygnały), wrogowie (ekran, w kadrze, tunel, mgła); zrzuty w chwilach --kadry; na końcu czasy klatek i
// pipeline'y utworzone synchronicznie po starcie (ma być 0). Wariant opcji „Kadr bitwy”: --kadr full|pan|off (A/B).
//   node scripts/webgpu/kamera-gra.mjs [--faza counter|defences|counter2…] [--czas 40] [--krok 0.5] [--kadr full]
//        [--mysz srodek|lewygorny|poza] [--kadry 2,6,10,14,20] [--rozmiar 1600x900] [--out .tmp/kamera/<faza>]
// Uwaga: harness nie steruje Atlasem — stoi pod ostrzałem fali i ginie po ~30 s (reżyser gaśnie z jego śmiercią).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const faza = args.faza || 'counter';
const out = resolve(repo, args.out || `.tmp/kamera/${faza}`);
mkdirSync(out, { recursive: true });
const czas = Number(args.czas || 40);
const krok = Number(args.krok || 0.5);
const kadry = String(args.kadry || '2,6,10,14,20,28,36').split(',').map(Number);
const mysz = args.mysz || 'srodek';

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { faza, mysz, kadr: args.kadr || 'full', probki: [], bledy: [] };

const sample = () => ev(`(() => {
  const c = window.camera, s = window.ship, R = window.CameraRig?.rig, S = window.StoryGame;
  const W = innerWidth, H = innerHeight, z = c.zoom;
  const scr = (x, y) => ({ x: (x - c.x) * z + W / 2, y: (y - c.y) * z + H / 2 });
  const hide = (n) => window.SensorSystem?.hides ? window.SensorSystem.hides(n) : false;
  const foes = [], friends = [];
  for (const n of (window.npcs || [])) {
    if (!n || n.dead || n.isWreck || !(n.hp > 0)) continue;
    const x = n.pos ? n.pos.x : n.x, y = n.pos ? n.pos.y : n.y;
    const p = scr(x, y);
    const rec = { tag: n.__storyTag || '', x: Math.round(x), y: Math.round(y), sx: Math.round(p.x), sy: Math.round(p.y),
      on: p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H, ukryty: hide(n), tunel: n.isCollidable === false, warp: n.__warpNurtMode || '' ,
      d: Math.round(Math.hypot(x - s.pos.x, y - s.pos.y)) };
    if (n.friendly === false || n.pirate || n.faction === 'pirates' || /counter|ambush|wave/.test(rec.tag)) foes.push(rec); else friends.push(rec);
  }
  const sp = scr(s.pos.x, s.pos.y);
  return {
    t: +(performance.now() / 1000).toFixed(2), faza: S.phase, cel: S.ui.objective ? S.ui.objective.text : null,
    kam: { x: Math.round(c.x), y: Math.round(c.y), zoom: +z.toFixed(4), tz: +c.targetZoom.toFixed(4), manual: !!c.manualZoom, mode: c.mode,
      widokKm: [+(W / z / 1000).toFixed(1), +(H / z / 1000).toFixed(1)] },
    statek: { x: Math.round(s.pos.x), y: Math.round(s.pos.y), sx: Math.round(sp.x), sy: Math.round(sp.y), v: Math.round(Math.hypot(s.vel.x, s.vel.y)) },
    rez: window.CameraDirector ? (() => { const d = window.CameraDirector.dir; return { obecnosc: +d.presence.toFixed(2), zoomLog: +d.zoomLog.toFixed(3), bias: [Math.round(d.biasX), Math.round(d.biasY)], pkt: d.count, syg: d.cues, powod: d.reason, wladza: +d.authority.toFixed(2) }; })() : null,
    rig: R ? { ox: Math.round(R.offsetX), oy: Math.round(R.offsetY), walka: +R.combat.toFixed(2), powod: R.combatReason, lookN: [+R.lookNX.toFixed(2), +R.lookNY.toFixed(2)], cel: [Math.round(R.targetX), Math.round(R.targetY)] } : null,
    mysz: window.__mouseDbg ? window.__mouseDbg() : null,
    wrogowie: foes, sojusznicy: friends.length,
    kolejkaPrzylotow: S._arrivalQueue ? S._arrivalQueue.length : null
  };
})()`);

const moveMouse = async (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const R = { pipes: [] };
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

try {
  const url = `${base}/index.html?dev=1&story=${faza}`;
  await cdp.send('Page.navigate', { url });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); localStorage.setItem('sc_camera_frame', '${args.kadr || 'full'}'); if (window.OPTIONS) window.OPTIONS.cameraFrame = '${args.kadr || 'full'}'; return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, 'window.StoryGame.active && !!window.StoryGame.phase', 300000, 400)) throw new Error('gra nie ruszyła');
  // mysz: środek kadru (neutralnie), lewy górny (ostatni punkt patrzenia), poza kanwą (zamrożenie)
  await moveMouse(W / 2, H / 2);
  await sleep(200);
  if (mysz === 'lewygorny' || mysz === 'poza') await moveMouse(Math.round(W * 0.12), Math.round(H * 0.15));
  if (mysz === 'poza') { await sleep(300); await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W + 50, y: H + 50 }); }
  await ev(`(() => { window.__mouseDbg = () => null; window.__ft = []; let last = performance.now(); const f = (t) => { window.__ft.push(t - last); last = t; if (window.__ft.length > 20000) window.__ft.shift(); requestAnimationFrame(f); }; requestAnimationFrame(f); return true; })()`);
  const pipesStart = await ev('window.__pipeRec.pipes.length');
  const t0 = Date.now();
  let k = 0;
  while ((Date.now() - t0) / 1000 <= czas) {
    const tt = (Date.now() - t0) / 1000;
    const st = await sample();
    st.ts = +tt.toFixed(2);
    report.probki.push(st);
    if (k < kadry.length && tt >= kadry[k]) {
      await screenshotPng(cdp, join(out, `kadr-${String(kadry[k]).padStart(3, '0')}.png`));
      k++;
    }
    await sleep(krok * 1000);
  }
  report.klatki = await ev(`(() => { const a = window.__ft.slice(60).sort((x, y) => x - y); const q = (p) => +a[Math.floor(p * (a.length - 1))].toFixed(2); return { n: a.length, p50: q(0.5), p95: q(0.95), p99: q(0.99) }; })()`);
  console.log('klatki', JSON.stringify(report.klatki));
  const pipes = await ev('window.__pipeRec.pipes');
  report.syncPoStarcie = pipes.slice(pipesStart).filter((p) => p.sync).map((p) => p.nazwa);
  console.log('pipeline sync po starcie:', report.syncPoStarcie.length, JSON.stringify(report.syncPoStarcie.slice(0, 20)));
  report.bledy = logs.errors().slice(0, 40);
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
} finally {
  writeJson(join(out, 'sonda.json'), report);
  // podsumowanie
  const lines = [];
  for (const p of report.probki) {
    const f = p.wrogowie || [];
    const vis = f.filter((e) => !e.tunel);
    const on = vis.filter((e) => e.on).length;
    let cx = 0, cy = 0;
    for (const e of vis) { cx += e.sx; cy += e.sy; }
    if (vis.length) { cx /= vis.length; cy /= vis.length; }
    const dmin = vis.length ? Math.min(...vis.map((e) => e.d)) : null;
    lines.push(`${String(p.ts).padStart(6)} ${p.faza?.padEnd(9)} zoom ${p.kam.zoom} widok ${p.kam.widokKm.join('×')}km  statek@(${p.statek.sx},${p.statek.sy}) v${p.statek.v}  rig(${p.rig?.ox},${p.rig?.oy}) rez[${p.rez ? `${p.rez.obecnosc} z${p.rez.zoomLog} b${p.rez.bias} p${p.rez.pkt} s${p.rez.syg}` : '-'}]  wrogowie ${vis.length}/${f.length} w kadrze ${on}  środek wrogów(${Math.round(cx)},${Math.round(cy)}) najbliższy ${dmin}`);
  }
  console.log(lines.join('\n'));
  await chrome.close();
  await server.close();
}
