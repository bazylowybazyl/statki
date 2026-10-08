// Holownik serwisowy w PRAWDZIWEJ grze (src/game/serviceTug.js, serviceTugGame.js; uszkodzenie silników —
// src/game/engineDamage.js): Vite + headless Chrome z GPU (CDP), strona harnessu (zegar wirtualny, klatki na żądanie).
// Atlas gracza daleko od Ziemi dostaje kratery w bębny dysz MAIN (wszystkie dysze zniszczone — zatrzask), potem:
//   1) silniki: brak ciągu głównego (W — przyrost prędkości), skok zablokowany (CapsLock), RCS dalej pracuje;
//   2) wezwanie holownika jak z karty Rezerwy (callInSupport('service_tug')): przylot tunelem „Nurtu” od Ziemi;
//   3) podejście i trzymanie pozycji burta w burtę (odległość i prędkość względna), naprawa rojem dronów holownika
//      (gdy jest rig sesji „Rój naprawczy”) — odrost komórek NIE przywraca dysz;
//   4) „paka”: holownik pod statkiem, zaczepy, lot do K-7 (skok automatem skoku gracza — holownik jedzie pod nim),
//      zawrót przed halą, zjazd statku pasem do stanowiska C-01, remont w doku (dysze sprawne, kadłub = szablon),
//      odlot holownika;
//   5) pipeline'y tworzone synchronicznie w klatkach całej akcji (ma być 0), błędy konsoli, zrzuty faz.
//
//   node scripts/webgpu/holownik-gra.mjs [--out .tmp/holownik/gra] [--rozmiar 1600x900] [--zoom 0.11]
//        [--odleglosc 420000] [--limit 900] [--modele 0]   (--modele 1 — wariant „Statki 3D”)
//
// Wynik: <out>/*.png, <out>/raport.json (fazy z czasem gry, pomiary, pipeline'y, błędy).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const zoom = Number(args.zoom || 0.11);
const away = Number(args.odleglosc || 420000);
const limitSec = Number(args.limit || 900);
const models = args.modele === '1';
const out = resolve(repo, args.out || (models ? '.tmp/holownik/gra-modele' : '.tmp/holownik/gra'));
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5398));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H, zoom, odleglosc: away, modele: models }, fazy: [], zrzuty: {} };

// Stan akcji: gracz (pozycja, prędkość, silniki, blokada wejścia), holownik i jego misja, skok gracza.
const STATE = `(() => {
  const s = window.ship, G = window.ServiceTugGame, m = G.missions[0] || null, t = m?.npc || null;
  const eng = window.EngineDamage.state(s);
  const st = window.HullBodies.structuralState(s) || {};
  const r = (v) => Math.round(v);
  return {
    czas: +(window.__holT || 0).toFixed(2),
    faza: m ? m.phase : (G.missions.length ? '?' : 'brak'),
    odcinek: m?.leg ? m.leg.kind + (m.legPhase ? '/' + m.legPhase : '') : '',
    gracz: { x: r(s.pos.x), y: r(s.pos.y), v: r(Math.hypot(s.vel.x, s.vel.y)), kurs: +s.angle.toFixed(3),
      silniki: eng.live + '/' + eng.total, wylaczony: eng.disabled, udzial: +(st.ratio ?? -1).toFixed(4),
      punkty: Math.round(s.hull.val), blokada: !!window.StoryGame.blocksInput, naPokladzie: !!s.__carriedBy },
    holownik: t ? { x: r(t.x), y: r(t.y), v: r(Math.hypot(t.vx, t.vy)), kurs: +t.angle.toFixed(3), duch: t.isCollidable === false,
      kadlub: !!t.beamHull, odGracza: r(Math.hypot(t.x - s.pos.x, t.y - s.pos.y)),
      vWzgl: r(Math.hypot(t.vx - s.vel.x, t.vy - s.vel.y)), martwy: !!t.dead } : null,
    skok: window.warp.state + (window.warp.exitRamp?.active ? '/rampa' : '')
  };
})()`;

async function shot(name, opis) {
  await ev('(async () => { await window.__harness.frames(3); return true; })()');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev(STATE)) };
  console.log('zrzut', name.padEnd(24), JSON.stringify(report.zrzuty[name]));
}

// Krok czasu gry: n klatek po 1/60 s (licznik czasu akcji w __holT).
async function run(frames) {
  await ev(`(async () => { await window.__harness.step(${frames}); window.__holT = (window.__holT || 0) + ${frames} / 60; return true; })()`);
}

// Do warunku (wyrażenie JS) z limitem czasu gry [s]; co `chunk` klatek. Zwraca czas albo -1.
async function until(expr, maxSec, chunk = 30, label = '') {
  const t0 = await ev('window.__holT || 0');
  for (;;) {
    if (await ev(`!!(${expr})`)) return +((await ev('window.__holT || 0')) - t0).toFixed(2);
    const now = await ev('window.__holT || 0');
    if (now - t0 > maxSec) { console.log('  limit', label, JSON.stringify(await ev(STATE))); return -1; }
    await run(chunk);
  }
}

async function phase(name, expr, maxSec, chunk = 30) {
  const sec = await until(expr, maxSec, chunk, name);
  const st = await ev(STATE);
  report.fazy.push({ faza: name, sekundy: sec, stan: st });
  console.log('faza', name.padEnd(22), sec, JSON.stringify(st));
  return sec;
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x7096};
(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();
${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.ServiceTugGame && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.setVisualMode(${models}, false); document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
  await ev('window.__harness.hold(true)');

  // Scena: Atlas daleko od Ziemi (na prostej Słońce → Ziemia, za orbitą) — do K-7 trzeba skoku.
  report.start = await ev(`(async () => {
    const S = window.__harness.scene, Hh = window.__harness; Hh.reseed(${0x7096}); S.hideHud(false);
    const earth = window.planets.find((p) => p.id === 'earth'), sun = window.SUN || { x: 0, y: 0 };
    let dx = earth.x - sun.x, dy = earth.y - sun.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    DevScene.teleport(earth.x + dx * ${away}, earth.y + dy * ${away}, Math.atan2(-dy, -dx));
    const s = window.ship;
    let key = s.beamHull?.dmgKey, stable = 0;
    for (let it = 0; it < 1200 && stable < 60; it++) {
      await Hh.step(2);
      const k = s.beamHull?.dmgKey;
      stable = (k && k === key && s.spriteReady) ? stable + 2 : 0;
      key = k;
    }
    S.shipCam(${zoom});
    return { earth: { x: Math.round(earth.x), y: Math.round(earth.y) }, gracz: { x: Math.round(s.pos.x), y: Math.round(s.pos.y) },
      wezly: s.beamHull?.body.activeNodes, dysze: (s.visual?.mainThrusters || []).length };
  })()`, 300000);
  console.log('start', JSON.stringify(report.start));
  const beg = await ev('window.__harness.frameLog.n');

  // ---------- 1) silniki: kratery w bębny dysz MAIN ----------
  report.silniki = await ev(`(async () => {
    const HB = window.HullBodies, s = window.ship, cs = s.beamHull.cellSize;
    const c = Math.cos(s.angle), sn = Math.sin(s.angle);
    let killed = 0;
    for (const t of s.visual.mainThrusters) {
      const x = s.pos.x + t.offset.x * c - t.offset.y * sn, y = s.pos.y + t.offset.x * sn + t.offset.y * c;
      HB.impact(s, x, y, 400, null, { craterRadius: cs * 2.4 });
      killed += HB.impactResult?.killed || 0;
    }
    await window.__harness.step(12);
    const st = window.EngineDamage.state(s);
    // W: przyrost prędkości w 2 s (bez ciągu głównego ~0; RCS dalej jest).
    const v0 = Math.hypot(s.vel.x, s.vel.y);
    window.Input.keyDown('KeyW');
    await window.__harness.step(120);
    window.Input.keyUp('KeyW');
    const v1 = Math.hypot(s.vel.x, s.vel.y);
    // Skok: CapsLock — automat odmawia (napęd główny zniszczony).
    window.runGameAction('nav.warp');
    await window.__harness.step(6);
    return { zabiteWezly: killed, dysze: st, przyrostW2s: +(v1 - v0).toFixed(1), skok: window.warp.state };
  })()`);
  console.log('silniki', JSON.stringify(report.silniki));
  await shot('00-silniki-zniszczone', 'Atlas z kraterami w bębnach dysz MAIN — napęd główny zniszczony');

  // ---------- 2) wezwanie ----------
  report.wezwanie = await ev(`(() => window.callInSupport('service_tug', { mode: 'friendly' }))()`);
  console.log('wezwanie', JSON.stringify(report.wezwanie));
  await phase('przylot', 'window.ServiceTugGame.missions[0] && window.ServiceTugGame.missions[0].phase !== "arrive"', 60, 10);
  await shot('01-przylot', 'Holownik wyszedł z tunelu przed Atlasem');
  await phase('burta-w-burte', 'window.ServiceTugGame.missions[0]?.phase === "service"', 180);
  await shot('02-burta-w-burte', 'Trzymanie pozycji burta w burtę (dopasowana prędkość), start roju');
  report.trzymanie = await ev(STATE);

  // ---------- 3) naprawa ----------
  await phase('naprawa', 'window.ServiceTugGame.missions[0]?.phase !== "service"', 480, 60);
  report.poNaprawie = await ev(`(() => { const s = window.ship; return { ...window.EngineDamage.state(s),
    udzial: +(window.HullBodies.structuralState(s)?.ratio ?? -1).toFixed(4), rigKoniec: window.ServiceTugGame.missions[0]?.rigDone || '' }; })()`);
  console.log('po naprawie', JSON.stringify(report.poNaprawie));

  // ---------- 4) paka ----------
  await phase('pod-statkiem', 'window.ServiceTugGame.missions[0]?.phase === "clamp"', 180);
  await shot('03-pod-statkiem', 'Holownik pod Atlasem — zaczepy');
  await phase('na-pokladzie', 'window.ServiceTugGame.missions[0]?.phase === "carry"', 30, 10);
  await shot('04-na-pokladzie', 'Atlas na pokładzie, kurs na K-7');
  await phase('skok', 'window.warp.state === "active"', 240, 10);
  await run(60);
  await shot('05-skok', 'Skok z ładunkiem: rulon, holownik pod Atlasem');
  await phase('przed-hala', 'window.ServiceTugGame.missions[0]?.phase === "turn"', limitSec, 60);
  await shot('06-przed-hala', 'Przed halą K-7: zawrót dziobem od hali');
  await phase('wyladunek', 'window.ServiceTugGame.missions[0]?.phase === "unload"', 240, 30);
  await run(240);
  await shot('07-wyladunek', 'Zjazd Atlasa pasem do stanowiska C-01');
  await phase('odlot', '!window.ServiceTugGame.missions[0] || window.ServiceTugGame.missions[0].phase === "depart"', 120, 30);
  await run(60);
  await shot('08-w-stanowisku', 'Atlas w stanowisku C-01 po remoncie, holownik odlatuje');

  report.koniec = await ev(`(() => {
    const s = window.ship;
    const pose = window.ServiceTugGame.lastDelivery;   // koniec zjazdu: stanowisko C-01, dziobem ku bramie
    const st = window.HullBodies.structuralState(s) || {};
    return { silniki: window.EngineDamage.state(s), udzial: +(st.ratio ?? -1).toFixed(4), punkty: Math.round(s.hull.val), max: s.hull.max,
      blokada: !!window.StoryGame.blocksInput, naPokladzie: !!s.__carriedBy,
      odStanowiska: pose ? Math.round(Math.hypot(s.pos.x - pose.x, s.pos.y - pose.y)) : null,
      bladKursu: pose ? +Math.abs(Math.atan2(Math.sin(s.angle - pose.a), Math.cos(s.angle - pose.a))).toFixed(3) : null };
  })()`);
  console.log('koniec', JSON.stringify(report.koniec));
  await run(600);
  report.poOdlocie = await ev(STATE);
  report.pipeline = (await ev(`window.__harness.frameStats(${beg})`)).pipeline;
  console.log('pipeline', JSON.stringify(report.pipeline));
  report.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  report.blad = String(err?.stack || err);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
