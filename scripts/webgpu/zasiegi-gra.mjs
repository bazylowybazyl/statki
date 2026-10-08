// Zasięgi broni w PRAWDZIWEJ grze (2026-10-07, skrócenie zasięgów — src/data/weapons.js § ZASIĘGI):
// faza misji 1 (domyślnie odwet piratów: 7 pancerników, 8 niszczycieli, 15 fregat), Vite + headless
// Chrome z WebGPU. Gracz nic nie robi — strzela kierowanie ogniem na auto i AI.
//
//   node scripts/webgpu/zasiegi-gra.mjs [--faza counter] [--czas 70] [--out .tmp/zasiegi-gra] [--tag nowe]
//                                       [--nadpisz plik.json] [--mnoznik 0.8]
//
// --nadpisz: { "id_broni": { "baseRange": 14000, … }, … } — wpisane w MASTER_WEAPONS przed startem gry
//            (A/B bez zmiany plików gry, np. dawne zasięgi); --mnoznik: wszystkie baseRange poza obroną
//            punktową (aux) × k — szybka próba „całej tabeli bliżej / dalej”.
// Mierzy (czas gry = SimClock.sim): odległość strzelca od najbliższego wroga przy KAŻDYM strzale (szyna
// strzałów — gracz, sojusznicy, piraci; mediana / p90 / maks., gracz także per broń), pierwszy strzał gracza
// po pojawieniu się odwetu, odległość najbliższego wroga, żywi wrogowie i ich pula (kadłub + tarcza),
// tarcza i kadłub Atlasa, pociski w locie, czas klatki. Wynik: <out>/<tag>-*.png, <out>/raport-<tag>.json.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const faza = args.faza || 'counter';
const czas = Number(args.czas || 70);
const tag = args.tag || 'gra';
const mnoznik = Number(args.mnoznik || 1);
const nadpisz = args.nadpisz ? JSON.parse(readFileSync(resolve(repo, args.nadpisz), 'utf8')) : {};
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zasiegi-gra');
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5383));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { faza, tag, mnoznik, nadpisz: Object.keys(nadpisz), probki: [], bledy: [] };

// Instrumentacja w stronie: nadpisania broni, szyna strzałów, czasy klatek.
const INSTRUMENT = `(() => {
  const MW = window.MASTER_WEAPONS;
  const over = ${JSON.stringify(nadpisz)};
  for (const id of Object.keys(over)) if (MW[id]) Object.assign(MW[id], over[id]);
  const k = ${mnoznik};
  if (k !== 1) for (const d of Object.values(MW)) if (d.mountType !== 'aux' && d.baseRange > 0) d.baseRange = Math.round(d.baseRange * k);
  const M = window.__zasiegi = { on: false, shots: [], frames: [], last: 0 };
  const near = (x, y, pirate) => {
    let best = Infinity;
    const s = window.ship;
    if (pirate) {
      if (s && !s.dead) best = Math.hypot(s.pos.x - x, s.pos.y - y);
      for (const n of window.npcs || []) if (n && !n.dead && n.friendly === true) best = Math.min(best, Math.hypot(n.x - x, n.y - y));
    } else {
      for (const n of window.npcs || []) if (window.isHostileNpc(n)) best = Math.min(best, Math.hypot(n.x - x, n.y - y));
    }
    return best;
  };
  window.WeaponShotBus.on((d) => {
    if (!M.on) return;
    const s = d.shooter;
    if (!s) return;
    const side = s === window.ship ? 0 : (s.friendly === true ? 1 : (window.isHostileNpc(s) ? 2 : 3));
    if (side === 3) return;
    const sx = s === window.ship ? s.pos.x : s.x;
    const sy = s === window.ship ? s.pos.y : s.y;
    M.shots.push([+window.SimClock.sim.toFixed(2), side, d.weaponId, Math.round(near(sx, sy, side === 2))]);
  });
  const tick = (t) => { if (M.on && M.last) M.frames.push(t - M.last); M.last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return true;
})()`;

const SAMPLE = `(() => {
  const s = window.ship;
  const hostile = (window.npcs || []).filter((n) => window.isHostileNpc(n) && !(n.hp <= 0));
  const allies = (window.npcs || []).filter((n) => n && !n.dead && n.friendly === true && !(n.hp <= 0) && !n.fighter);
  let near = Infinity, pool = 0;
  for (const n of hostile) {
    near = Math.min(near, Math.hypot(n.x - s.pos.x, n.y - s.pos.y));
    pool += Math.max(0, n.hp || 0) + Math.max(0, n.shield?.val || 0);
  }
  const fr = window.__zasiegi.frames.splice(0);
  fr.sort((a, b) => a - b);
  return {
    t: +window.SimClock.sim.toFixed(1), faza: window.StoryGame?.phase, wrogowie: hostile.length, sojusznicy: allies.length,
    najblizszy: Number.isFinite(near) ? Math.round(near) : null, pulaWroga: Math.round(pool),
    tarcza: Math.round(s.shield?.val || 0), kadlub: Math.round(s.hull?.val ?? s.hp ?? 0),
    pociski: (window.bullets || []).length, rakiety: window.rocketSystem3D?.activeRockets ?? null,
    klatkaMs: fr.length ? +fr[fr.length >> 1].toFixed(1) : null, klatkaP95: fr.length ? +fr[Math.floor(fr.length * 0.95)].toFixed(1) : null,
    gpuMs: +(window.Core3D?.gpuFrameMs || 0).toFixed(1), zoom: +window.camera.zoom.toFixed(3)
  };
})()`;

const pct = (a, q) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : null);
function distStats(list) {
  const d = list.map((s) => s[3]).filter(Number.isFinite).sort((a, b) => a - b);
  return { strzaly: list.length, mediana: pct(d, 0.5), p90: pct(d, 0.9), maks: d.length ? d[d.length - 1] : null };
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=${faza}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame && window.WeaponShotBus && window.MASTER_WEAPONS)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(INSTRUMENT);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, `window.StoryGame.active && window.StoryGame.phase === '${faza}'`, 300000, 400)) throw new Error(`brak fazy ${faza}`);
  report.zasiegi = await ev(`(() => { const o = {}; for (const h of window.Game.player.hardpoints) { const w = window.MASTER_WEAPONS[h.mount]; if (w) o[w.id] = w.baseRange; } return o; })()`);
  console.log('broń Atlasa (zasięg):', JSON.stringify(report.zasiegi));
  // Odwet: czekamy na pierwszych wrogów (przylot warpem), od tej chwili liczymy.
  if (!await waitFor(cdp, '(window.npcs || []).some((n) => window.isHostileNpc(n))', 120000, 250)) throw new Error('brak wrogów');
  await ev(`(() => { window.__zasiegi.on = true; window.__zasiegi.t0 = window.SimClock.sim; return true; })()`);
  const t0 = await ev('window.SimClock.sim');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W / 2, y: H / 2 - 150, button: 'none' });
  const start = Date.now();
  let n = 0;
  while ((Date.now() - start) / 1000 < czas) {
    await sleep(1000);
    const p = await ev(SAMPLE);
    p.t = +(p.t - t0).toFixed(1);
    report.probki.push(p);
    if (n % 5 === 0) console.log(JSON.stringify(p));
    if (n % 15 === 0) await screenshotPng(cdp, join(out, `${tag}-${String(Math.round(p.t)).padStart(3, '0')}s.png`));
    n++;
    if (p.wrogowie === 0 && n > 10) break;
  }
  await screenshotPng(cdp, join(out, `${tag}-koniec.png`));
  const shots = await ev('window.__zasiegi.shots');
  for (const s of shots) s[0] = +(s[0] - t0).toFixed(2);
  const strony = ['gracz', 'sojusznicy', 'piraci'];
  report.strzaly = {};
  for (let k = 0; k < 3; k++) report.strzaly[strony[k]] = distStats(shots.filter((s) => s[1] === k));
  const bron = {};
  for (const s of shots) {
    if (s[1] !== 0 && s[1] !== 2) continue;
    const key = `${s[1] === 0 ? 'gracz' : 'pirat'}:${s[2]}`;
    (bron[key] ||= []).push(s);
  }
  report.bron = Object.fromEntries(Object.entries(bron).map(([k, v]) => [k, distStats(v)]));
  const pierwszy = shots.find((s) => s[1] === 0);
  report.pierwszyStrzalGracza = pierwszy ? { t: pierwszy[0], bron: pierwszy[2], dystans: pierwszy[3] } : null;
  const pierwszyPirat = shots.find((s) => s[1] === 2);
  report.pierwszyStrzalPirata = pierwszyPirat ? { t: pierwszyPirat[0], bron: pierwszyPirat[2], dystans: pierwszyPirat[3] } : null;
  const P = report.probki;
  const avg = (k) => Math.round(P.reduce((a, p) => a + (p[k] || 0), 0) / Math.max(1, P.length));
  report.podsumowanie = {
    czasGry: P.length ? P[P.length - 1].t : 0,
    wrogowieMaks: Math.max(0, ...P.map((p) => p.wrogowie)), wrogowieKoniec: P.length ? P[P.length - 1].wrogowie : null,
    pulaWrogaMaks: Math.max(0, ...P.map((p) => p.pulaWroga)), pulaWrogaKoniec: P.length ? P[P.length - 1].pulaWroga : null,
    atlasTarczaMin: Math.min(...P.map((p) => p.tarcza)), atlasKadlubKoniec: P.length ? P[P.length - 1].kadlub : null,
    pociskiSr: avg('pociski'), pociskiMaks: Math.max(0, ...P.map((p) => p.pociski)),
    klatkaMsSr: +(P.reduce((a, p) => a + (p.klatkaMs || 0), 0) / Math.max(1, P.length)).toFixed(1)
  };
  console.log('strzały (odległość od najbliższego wroga):', JSON.stringify(report.strzaly));
  console.log('broń:', JSON.stringify(report.bron));
  console.log('pierwszy strzał gracza:', JSON.stringify(report.pierwszyStrzalGracza), 'pirata:', JSON.stringify(report.pierwszyStrzalPirata));
  console.log('podsumowanie:', JSON.stringify(report.podsumowanie));
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, `raport-${tag}.json`), report);
  await chrome.close();
  await server.close();
}
