// Misja 1, etap ROZPOZNANIA fregatą zwiadu z ładowni Atlasa (2026-10-11) w PRAWDZIWEJ grze: Vite + headless Chrome
// z WebGPU (CDP), czas rzeczywisty.
//
//   node scripts/webgpu/baza-zwiad-gra.mjs [--out .tmp/baza-zwiad] [--rozmiar 1600x900] [--wykrycie 1]
//
// Skok dev ?story=scout (Atlas w punkcie wyjścia z warpa, sygnatura masy), samouczek włączony:
//   01 sygnatura masy (znacznik „H → fregata zwiadu”), H — start fregaty (wrota, wynurzenie, wylot), 02 stery fregaty,
//   oblot bazy — fregata przestawiana w punkty ~5 km od obwiedni (cel „Obleć bazę … n / 4”), X — skan, 03–06 kadry
//   oblotu, 07 cel „Odwołaj fregatę (H)”, H — stery wracają na Atlasa (faza approach). --wykrycie 1: na końcu druga
//   próba — fregata 2 km od bazy → alarm (drony, faza defences).
// Raport: <out>/raport.json — cele misji, postęp, alarm, znaczniki ScoutBay, pipeline'y synchroniczne, błędy konsoli.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/baza-zwiad');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5377));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { kadry: [], kroki: [], bledy: [] };

const PIPE_REC = `(() => {
  const R = { pipes: [] };
  const name = (m, o) => ((m && m.name) || (m && m.type) || '?') + ' @ ' + ((o && o.name) || (o && o.type) || '?');
  const hook = setInterval(() => {
    const r = window.Core3D && window.Core3D.renderer;
    const pu = r && r.backend && r.backend.pipelineUtils;
    if (!pu) return;
    clearInterval(hook);
    const render = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (R.pipes.length < 8192) R.pipes.push({ sync: !promises, frame: window.__frameId | 0, nazwa: name(ro && ro.material, ro && ro.object) });
      return render.call(this, ro, promises);
    };
  }, 10);
  window.__pipeRec = R;
})();`;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PIPE_REC });

const key = (code, k, vk) => ({ key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
const KEY_H = key('KeyH', 'h', 72), KEY_X = key('KeyX', 'x', 88);
async function tap(k) {
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
  await sleep(70);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

const STATE = `(() => {
  const S = window.StoryGame, site = S.site, B = window.ScoutBay, n = B.npc, o = S.ui.objective;
  let prog = '';
  try { prog = o && o.progress ? String(o.progress()) : ''; } catch { prog = '?'; }
  return {
    faza: S.phase, alarm: !!site?.alarmed,
    cel: o ? o.id + ': ' + o.text + (prog ? ' [' + prog + ']' : '') : null,
    podpowiedz: S.ui.hint?.spec?.title || null,
    fregata: B.phase, stery: !!B.controlling,
    odBazy: n && site?.dock ? Math.round(site.dock.distance(n.pos ? n.pos.x : n.x, n.pos ? n.pos.y : n.y)) : null,
    znaczniki: B.markedTargets().length,
    budowle: site?.structures ? Object.fromEntries(Object.entries(site.structures).map(([k, st]) => [k, !window.SensorSystem?.hides?.(st)])) : null
  };
})()`;
async function state(tag) {
  const st = await ev(STATE);
  report.kroki.push({ tag, ...st });
  console.log(tag.padEnd(22), JSON.stringify(st));
  return st;
}
async function shot(name) {
  await sleep(Number(args.czekaj || 600));
  const st = await ev(STATE);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.kadry.push({ name, ...st });
  console.log(name.padEnd(22), JSON.stringify(st));
}
// fregata w punkcie `d` j. od obwiedni bazy na promieniu od środka pod kątem `a` (układ gry), kurs styczny
const frigateAt = (d, a) => ev(`(() => {
  const S = window.StoryGame, site = S.site, B = window.ScoutBay, n = B.npc;
  if (!n || n.dead) return null;
  const c = site.building;
  let p = null;
  for (let r = 0; r < 80000; r += 50) {
    const q = { x: c.x + Math.cos(${a}) * r, y: c.y + Math.sin(${a}) * r };
    if (site.dock.distance(q.x, q.y) >= ${d}) { p = q; break; }
  }
  const ang = ${a} + Math.PI / 2;
  if (n.pos) { n.pos.x = p.x; n.pos.y = p.y; }
  n.x = p.x; n.y = p.y;
  if (n.vel) { n.vel.x = 0; n.vel.y = 0; }
  n.vx = 0; n.vy = 0; n.angle = n.desiredAngle = ang; n.angVel = 0;
  B.cmdSpeed = 0; B.cmdFace = ang;
  return { x: Math.round(p.x), y: Math.round(p.y) };
})()`);

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=scout` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.ScoutBay)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '1'); return true; })()`);
  await sleep(1200);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(700);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.querySelector('[data-story-tutorial="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'scout' && !!window.StoryGame.site?.station", 300000, 400)) throw new Error('faza scout nie ruszyła');
  await sleep(2500);
  await shot('01-sygnatura');
  // H — start fregaty (wrota, wynurzenie, wylot) i stery
  await tap(KEY_H);
  await state('H');
  if (!await waitFor(cdp, "window.ScoutBay.phase === 'flight' && window.ScoutBay.controlling", 30000, 200)) console.log('fregata nie doleciała do fazy lotu', JSON.stringify(await ev(STATE)));
  await sleep(2500);
  await shot('02-stery-fregaty');
  // oblot: od strony gracza (oś podejścia) dookoła, 5 km od obwiedni
  const axis = await ev('window.StoryGame.site.axis');
  const around = [Math.PI, Math.PI - 1.2, Math.PI - 2.2, Math.PI - 3.1, Math.PI - 4.2].map((t) => axis + t);
  let k = 3;
  for (let i = 0; i < around.length; i++) {
    await frigateAt(5000, around[i]);
    await sleep(1600);
    if (i === 1) { await tap(KEY_X); await sleep(2200); }
    await shot(`0${k++}-oblot-${i + 1}`);
    const st = await ev(STATE);
    if (st.cel && /^recall/.test(st.cel)) break;
  }
  const fin = await state('po-oblocie');
  report.oblot = { cel: fin.cel, alarm: fin.alarm, znaczniki: fin.znaczniki };
  // H — stery z powrotem na Atlasa
  await tap(KEY_H);
  await sleep(1500);
  await shot(`0${k++}-powrot`);
  await waitFor(cdp, "window.StoryGame.phase === 'approach'", 15000, 300);
  report.powrot = await state('approach');
  // powrót fregaty do ładowni omija bazę (ScoutBay.setAvoid — strefa wykrycia + zapas): najmniejsza odległość
  // od obwiedni w locie powrotnym i alarm
  report.lotPowrotny = { minOdBazy: Infinity, alarm: false, faza: null, sekundy: 0 };
  for (let t = 0; t < 120; t++) {
    const s = await ev(STATE);
    if (s.odBazy != null) report.lotPowrotny.minOdBazy = Math.min(report.lotPowrotny.minOdBazy, s.odBazy);
    report.lotPowrotny.alarm = report.lotPowrotny.alarm || s.alarm;
    report.lotPowrotny.faza = s.fregata;
    report.lotPowrotny.sekundy = t;
    if (s.fregata === 'stowed' || s.fregata === 'lost' || s.alarm) break;
    await sleep(1000);
  }
  console.log('lot powrotny:', JSON.stringify(report.lotPowrotny));
  await shot(`0${k++}-po-powrocie`);
  if (args.wykrycie) {
    // druga próba: fregata znowu w locie, 2 km od bazy → alarm
    await waitFor(cdp, "window.ScoutBay.phase === 'stowed'", 120000, 500);
    await tap(KEY_H);
    await waitFor(cdp, "window.ScoutBay.phase === 'flight'", 30000, 200);
    await frigateAt(2000, axis + Math.PI - 0.6);
    await sleep(3000);
    await shot(`0${k++}-wykrycie`);
    report.wykrycie = await state('wykrycie');
  }
  report.pipeline = await ev(`(() => {
    const p = (window.__pipeRec?.pipes || []).filter((x) => x.frame > 0);
    const sync = p.filter((x) => x.sync);
    return { wszystkie: (window.__pipeRec?.pipes || []).length, wGrze: p.length, sync: sync.length, lista: sync.slice(0, 30).map((x) => x.nazwa) };
  })()`);
  console.log('pipeline:', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
