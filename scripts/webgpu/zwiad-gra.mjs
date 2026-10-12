// ZWIAD — fregata w ładowni Atlasa w prawdziwej grze (src/game/scoutBay.js, blok „ZWIAD: FREGATA W ŁADOWNI” w index.html).
// Atlas w pustce, 3 piraci ~16 km przed nim. Przebieg: H (wrota, wynurzenie, wylot jako duch) → stery fregaty (W, A)
// → fregata pod piratami → X (skan) i T (oznacz) → H (powrót, lądowanie, wrota) → znaczniki w ostatnim miejscu.
// Zrzuty faz i raport w .tmp/zwiad/gra (raport.json): fazy, czasy, znaczniki, duch, kamera, błędy konsoli.
//
// node scripts/webgpu/zwiad-gra.mjs [--zoom 0.25] [--rozmiar 1600x900] [--port 5399]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const zoom = Number(args.zoom || 0.25);
const models = args.modele === '1';
const out = resolve(repo, args.out || (args.modele === '1' ? '.tmp/zwiad/gra-modele' : '.tmp/zwiad/gra'));
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5399));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { ustawienia: { W, H, zoom }, fazy: [], zrzuty: {} };

const STATE = `(() => {
  const B = window.ScoutBay, s = window.ship, n = B.npc, r = (v) => Math.round(v);
  return {
    czas: +(window.__zwT || 0).toFixed(2), faza: B.phase, stery: B.controlling, wrota: +B.door.toFixed(2),
    atlas: { x: r(s.pos.x), y: r(s.pos.y), v: r(Math.hypot(s.vel.x, s.vel.y)) },
    fregata: n ? { x: r(n.x), y: r(n.y), v: r(Math.hypot(n.vx, n.vy)), duch: n.isCollidable === false, kadlub: !!n.beamHull,
      odAtlasa: r(Math.hypot(n.x - s.pos.x, n.y - s.pos.y)), hp: r(n.hp ?? 0) } : null,
    kamera: { x: r(window.camera.x), y: r(window.camera.y) },
    znaczniki: B.markedTargets().map((m) => m.id + ':' + m.label + ':' + m.source + (m.visible ? '' : ':mgla') + (m.destroyed ? ':zniszczony' : ''))
  };
})()`;

async function shot(name, opis) {
  await ev('(async () => { await window.__harness.frames(3); return true; })()');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty[name] = { opis, ...(await ev(STATE)) };
  console.log('zrzut', name.padEnd(20), JSON.stringify(report.zrzuty[name]));
}
async function run(frames) {
  await ev(`(async () => { await window.__harness.step(${frames}); window.__zwT = (window.__zwT || 0) + ${frames} / 60; return true; })()`);
}
async function until(expr, maxSec, chunk = 15) {
  const t0 = await ev('window.__zwT || 0');
  for (;;) {
    if (await ev(`!!(${expr})`)) return +((await ev('window.__zwT || 0')) - t0).toFixed(2);
    if ((await ev('window.__zwT || 0')) - t0 > maxSec) return -1;
    await run(chunk);
  }
}
async function phase(name, expr, maxSec, chunk = 15) {
  const sec = await until(expr, maxSec, chunk);
  const st = await ev(STATE);
  report.fazy.push({ faza: name, sekundy: sec, stan: st });
  console.log('faza', name.padEnd(16), sec, JSON.stringify(st));
  return sec;
}
const key = (code, type) => ev(`(() => { window.dispatchEvent(new KeyboardEvent('${type}', { code: '${code}', key: '${code}', bubbles: true })); return true; })()`);
async function tap(code) { await key(code, 'keydown'); await run(2); await key(code, 'keyup'); }

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x2a11};
(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();
${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&zwiad=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.ScoutBay)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.setVisualMode?.(${models}, false); document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250);
  await ev('window.__harness.hold(true)');

  report.start = await ev(`(async () => {
    const S = window.__harness.scene, Hh = window.__harness; Hh.reseed(${0x2a11}); S.hideHud(false);
    const sun = window.SUN || { x: 0, y: 0 };
    const ax = sun.x + 2.2e6, ay = sun.y + 0.9e6;
    DevScene.teleport(ax, ay, 0);
    const s = window.ship;
    for (let it = 0; it < 600 && !(s.beamHull && s.spriteReady); it++) await Hh.step(2);
    await Hh.step(30);
    window.ScoutBay.grant();
    // Piraci 16 km przed dziobem (uśpieni — bez walki, sam zwiad).
    const pir = [];
    // + jeden w mgle 30 km przed Atlasem (OKO) i grupa 55 km (DALEKI SKAN)
    for (const [dx, dy] of [[16000, -1200], [17500, 1500], [19000, -300], [30000, 3000], [55000, 3000], [56000, 4200], [55500, 1800]]) {
      const list = window.spawnCallInShip('frigate_pd', { mode: 'pirate', spawnPos: { x: ax + dx, y: ay + dy }, spawnAngle: Math.PI });
      for (const n of (Array.isArray(list) ? list : [list])) if (n) { n.combatDisabled = true; n.ai = null; pir.push(n.id || n.type); }
    }
    await Hh.step(30);
    S.shipCam(${zoom});
    return { atlas: { x: Math.round(s.pos.x), y: Math.round(s.pos.y) }, piraci: pir.length, faza: window.ScoutBay.phase,
      luk: window.ScoutBay.env.bayLocal };
  })()`, 300000);
  console.log('start', JSON.stringify(report.start));
  await shot('00-atlas', 'Atlas z fregatą w ładowni, piraci w mgle');

  const beg = await ev('window.__harness.frameLog.n');
  await tap('KeyH');
  await run(100);
  await shot('00b-wrota', 'wrota w połowie otwierania');
  await phase('wrota', `window.ScoutBay.phase === 'rising'`, 10);
  if (args.diag === '1') {
    report.diag = await ev(`(() => { const n = window.ScoutBay.npc; return { skinZ: n.__skinZ, vis: n.__fogVisible, warp: n.__warpNurtMode || null,
      spriteReady: !!n.spriteReady, beam: !!n.beamHull, depth: window.__scoutBay3D.geo.depth }; })()`);
    console.log('diag', JSON.stringify(report.diag));
    await ev('(() => { window.__scoutBay3D.frigateZ = () => 0; return true; })()');
    await run(2);
    await shot('01-dno-z0', 'diagnostyka: fregata z = 0');
    await ev('(() => { window.__scoutBay3D.group.visible = false; window.__scoutBay3D.sync = () => false; window.ship.__bayCut = null; return true; })()');
    await run(2);
    await shot('01-dno-bez-luku', 'diagnostyka: bez luku');
  }
  await shot('01-dno', 'wrota otwarte, fregata na dnie luku');
  await run(70);
  await shot('01b-wynurzenie', 'fregata wynurza się (duch) — rośnie do rozmiaru z gry');
  report.pozaWynurzenie = await ev(`(() => { const n = window.ScoutBay.npc; return { z: +(n.__skinZ || 0).toFixed(2), skala: n.__renderScale ?? 1, lift: +window.ScoutBay.lift.toFixed(2) }; })()`);
  await phase('nad-atlasem', `window.ScoutBay.phase === 'departing'`, 10);
  // kursor (celownik broni) z dala od kadłuba — nie zasłania fregaty na zrzutach
  await ev(`(() => { const s = window.ship; window.DevScene.pointerAt(s.pos.x - 3000, s.pos.y + 2500); return true; })()`);
  await run(45);
  await shot('01c-wylot-nad-atlasem', 'wylot nad kadłubem Atlasa — fregata nad nim i nad mostkiem');
  await run(60);
  await shot('01d-wylot-nad-dziobem', 'wylot nad dziobem Atlasa');
  report.pozaWylot = await ev(`(() => { const n = window.ScoutBay.npc; return { z: +(n.__skinZ || 0).toFixed(2), skala: n.__renderScale ?? 1, faza: window.ScoutBay.phase }; })()`);
  console.log('poza', JSON.stringify(report.pozaWynurzenie), JSON.stringify(report.pozaWylot));
  await phase('wylot', `window.ScoutBay.phase === 'flight'`, 20);
  await shot('02-stery', 'stery i kamera na fregacie');

  // Lot sterami: W 4 s (rozpędzanie), potem przeniesienie pod bazę (oszczędność czasu harnessu) i skan.
  await key('KeyW', 'keydown'); await run(240); await key('KeyW', 'keyup');
  report.lot = await ev(STATE);
  console.log('lot', JSON.stringify(report.lot));
  await ev(`(() => { const n = window.ScoutBay.npc, s = window.ship; const x = s.pos.x + 11000, y = s.pos.y + 3000;
    if (n.pos) { n.pos.x = x; n.pos.y = y; } n.x = x; n.y = y; return true; })()`);
  await run(30);
  await shot('03-pod-baza', 'fregata pod bazą — piraci widoczni w kręgu wzroku fregaty');
  await tap('KeyX');
  await run(50);
  await shot('04-skan', 'fala skanu fregaty');
  await phase('skan', `window.ScoutBay.markedTargets().length >= 3 || !window.ScoutBay.scan.active`, 4);
  // T: zdejmij i oznacz ponownie pierwszy cel kursorem.
  await ev(`(() => { const m = window.ScoutBay.marks[0]; window.DevScene.pointerAt(m.x, m.y); return true; })()`);
  await tap('KeyT');
  report.poT1 = await ev('window.ScoutBay.marks.length');
  await tap('KeyT');
  report.poT2 = await ev('window.ScoutBay.marks.map((m) => m.id + ":" + m.source)');
  console.log('T', report.poT1, JSON.stringify(report.poT2));

  // SYSTEMY ZWIADU (2026-10-11): licznik prędkości kokpitu = fregata, I — maskowanie fregaty (nie Atlasa),
  // 3 — oko odsłania pirata w mgle 19 km od fregaty, 4 — daleki skan na grupę 44 km.
  report.systemy = {};
  await key('KeyW', 'keydown'); await run(90); await key('KeyW', 'keyup');
  await run(12);
  report.systemy.licznik = await ev(`(() => { const n = window.ScoutBay.npc; return { kokpit: window.hudSystem?.cockpit?.els?.spValue?.textContent ?? null,
    fregata: Math.round(Math.hypot(n.vel ? n.vel.x : n.vx, n.vel ? n.vel.y : n.vy)), atlas: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)) }; })()`);
  await tap('KeyI');
  await run(100);
  report.systemy.maskowanie = await ev(`(() => ({ fregata: window.ScoutBay.cloak.state, ukryta: window.ScoutBay.cloakHidden(),
    atlas: window.ship.cloak ? window.ship.cloak.state : null }))()`);
  await shot('04b-maskowanie', 'fregata zamaskowana (I przy sterach fregaty)');
  const far = `window.npcs.filter((n) => !n.friendly && Math.abs(n.x - (window.ship.pos.x + 30000)) < 400)[0]`;
  report.systemy.okoPrzed = await ev(`!window.SensorSystem.hides(${far})`);
  await ev(`(() => { const p = ${far}; window.DevScene.pointerAt(p.x, p.y); return true; })()`);
  await tap('Digit3');
  await run(30);
  report.systemy.okoPo = await ev(`!window.SensorSystem.hides(${far})`);
  report.systemy.oko = await ev('window.ScoutBay.state().eye');
  await ev(`(() => { window.camera.zoom = window.camera.targetZoom = ${zoom * 0.18}; return true; })()`);
  await run(20);
  await shot('04c-oko', 'oko: koło odsłoniętej mgły pod kursorem przy piracie 19 km od fregaty');
  await tap('Digit3');
  await ev(`(() => { const s = window.ship; window.DevScene.pointerAt(s.pos.x + 55000, s.pos.y + 3000); return true; })()`);
  await tap('Digit4');
  await run(60);
  await shot('04d-daleki-skan', 'daleki skan: klin w stronę kursora');
  await run(90);
  report.systemy.echa = await ev(`window.ScoutBay.echoes.map((q) => q.id + ' · ' + window.ScoutBay.echoLabel(q) + ' · ' + Math.round(q.err) + ' j.')`);
  await ev(`(() => { window.camera.zoom = window.camera.targetZoom = ${zoom * 0.12}; return true; })()`);
  await run(20);
  await shot('04e-echa', 'echa dalekiego skanu');
  await ev(`(() => { window.camera.zoom = window.camera.targetZoom = ${zoom}; return true; })()`);
  await tap('KeyI');
  console.log('systemy', JSON.stringify(report.systemy));

  await tap('KeyH');
  await phase('powrot', `window.ScoutBay.phase === 'landing'`, 120, 30);
  await shot('05-ladowanie', 'lądowanie w luku');
  await phase('ladownia', `window.ScoutBay.phase === 'stowed'`, 20);
  await run(60);
  await shot('06-znaczniki', 'kamera na Atlasie, znaczniki w ostatnim znanym miejscu');
  report.koniec = await ev(STATE);
  report.pipeline = (await ev(`window.__harness.frameStats(${beg})`)).pipeline;
  report.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  report.blad = String(err?.stack || err);
  console.log('BŁĄD', report.blad);
} finally {
  await chrome.close();
  await server.close();
}
writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
console.log('pipeline', JSON.stringify(report.pipeline), 'błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
