// PRÓBA PROTOTYPU MAŁEJ SKALI (?malaSkala=1) w prawdziwej grze: fregata zwiadu przy sterach — kadr 650 j., sufit sterów,
// działa na kursor (LPM), cel ćwiczebny MalaSkala.cel(), wieże NPC z punktami życia. Zrzuty i raport w <out>.
//
// node scripts/webgpu/mala-skala-gra.mjs [--query renderWorker=1] [--out .tmp/skala/proto] [--port 5491]
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, osobneLosowanieUuid, repo } from './wspolne.mjs';

const args = parseArgs();
const W = 1920, H = 1080;
const query = args.query ?? 'renderWorker=1';
const out = resolve(repo, args.out || '.tmp/skala/proto');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5491));
const chrome = await startChrome({ width: W, height: H });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); }, 15 * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const report = { query, kroki: {}, zrzuty: [] };
const run = (frames) => ev(`(async () => { await window.__harness.step(${frames}); return true; })()`);
async function shot(name) {
  await ev('(async () => { await window.__harness.frames(3); return true; })()');
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  await ev('(async () => { await window.__harness.frames(2); return true; })()');
  await screenshotPng(cdp, join(out, `${name}.png`));
  report.zrzuty.push(name);
  console.log('zrzut', name);
}
const STATE = `(() => {
  const B = window.ScoutBay, n = B.npc, c = window.camera, t = window.__ssTarget;
  const r = (v) => Math.round(v);
  const turrets = (e) => (e && e.autoWeapons ? e.autoWeapons.filter((w) => w.hpOffset && !w.hpOffset.destroyed).length : 0);
  return {
    faza: B.phase, stery: B.controlling,
    kadr: r(window.innerWidth / c.zoom), zoom: +c.zoom.toFixed(3), cel: +c.targetZoom.toFixed(3), maxZoom: +c.maxZoom.toFixed(2),
    fregata: n ? { v: r(Math.hypot(n.vx || 0, n.vy || 0)), cmd: r(B.cmdSpeed || 0), wieze: turrets(n),
      zasieg: n.autoWeapons && n.autoWeapons[0] ? r(window.__ssRange(n, n.autoWeapons[0].def)) : null } : null,
    cel_cw: t ? { hp: r(t.hp), wieze: window.MalaSkala.wieze(t).length, rysowane: turrets(t),
      odl: n ? r(Math.hypot(t.x - n.x, t.y - n.y)) : null, uspiony: !!t.combatDisabled } : null,
    licznik: { ...window.MalaSkala.stats },
    pociskiFregaty: (window.bullets || []).filter((b) => b.source === n).length
  };
})()`;

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5ca1e};
(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();
${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&malaSkala=1${query ? '&' + query : ''}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.ship && window.__harness && window.ScoutBay && window.MalaSkala)', 240000, 400)) throw new Error('gra nie wstała');
  report.flaga = await ev('window.MalaSkala.on');
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250);
  await ev('window.__harness.hold(true)');
  report.start = await ev(`(async () => {
    const S = window.__harness.scene, Hh = window.__harness; Hh.reseed(${0x5ca1f}); S.hideHud(false);
    const sun = window.SUN || { x: 0, y: 0 };
    DevScene.teleport(sun.x + 2.2e6, sun.y + 0.9e6, 0);
    const s = window.ship;
    for (let it = 0; it < 600 && !(s.beamHull && s.spriteReady); it++) await Hh.step(2);
    await Hh.step(30);
    const { weaponRangeFor } = await import('/src/game/shipModifiers.js');
    window.__ssRange = (e, d) => weaponRangeFor(e, d, d.baseRange);
    return { faza: window.ScoutBay.phase, zoomAtlasa: +window.camera.zoom.toFixed(3) };
  })()`, 300000);
  console.log('start', JSON.stringify(report.start));

  // 1. Start fregaty i przejęcie sterów: kadr 650 j.
  await ev('window.ScoutBay.launch()');
  for (let i = 0; i < 300; i++) {
    if (await ev(`window.ScoutBay.phase === 'flight'`)) break;
    await run(10);
  }
  await run(90);
  report.kroki.stery = await ev(STATE);
  console.log('stery', JSON.stringify(report.kroki.stery));
  await shot('01-stery-kadr-650');

  // 2. W trzymane 6 s: prędkość pod sufitem sterów.
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); return true; })()`);
  await run(360);
  await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); return true; })()`);
  report.kroki.lot = await ev(STATE);
  console.log('lot', JSON.stringify(report.kroki.lot));

  // 3. Cel ćwiczebny 900 j. przed fregatą; fregata obok jego burty (bez ruchu), kursor na najbliższej wieży.
  report.kroki.cel = await ev(`(() => {
    const n = window.ScoutBay.npc;
    n.vx = n.vy = 0; if (n.vel) { n.vel.x = n.vel.y = 0; }
    window.ScoutBay.cmdSpeed = 0;
    const t = window.MalaSkala.cel({ odl: 900 });
    window.__ssTarget = t;
    return t ? { typ: t.type, x: Math.round(t.x), y: Math.round(t.y), wieze: (t.autoWeapons || []).length, hp: Math.round(t.hp) } : null;
  })()`);
  console.log('cel', JSON.stringify(report.kroki.cel));
  await run(30);
  // Najbliższa żywa wieża celu (pozycje z gniazd — MalaSkala.wieze; rekordy Turret2D są tylko dla encji w kadrze).
  const aimNearest = `(() => {
    const n = window.ScoutBay.npc, t = window.__ssTarget;
    const list = window.MalaSkala.wieze(t);
    let best = null, bd = Infinity;
    for (const w of list) { const d = Math.hypot(w.x - n.x, w.y - n.y); if (d < bd) { bd = d; best = w; } }
    if (!best) return null;
    const s = window.DevScene.pointerAt(best.x, best.y);
    return { bron: best.bron, hp: best.hp, strefa: Math.round(best.r), odl: Math.round(bd), x: Math.round(best.x), y: Math.round(best.y),
      sx: Math.round(s.x), sy: Math.round(s.y) };
  })()`;
  report.kroki.wiezaPrzed = await ev(aimNearest);
  console.log('wieża', JSON.stringify(report.kroki.wiezaPrzed));
  // Fregata ~240 j. od tej wieży, po stronie fregaty (zostaje na stałym miejscu — stery bez ciągu).
  await ev(`(() => {
    const n = window.ScoutBay.npc, w = ${JSON.stringify(report.kroki.wiezaPrzed)};
    if (!w) return false;
    const dx = n.x - w.x, dy = n.y - w.y, d = Math.hypot(dx, dy) || 1;
    const x = w.x + dx / d * 240, y = w.y + dy / d * 240;
    n.x = x; n.y = y; if (n.pos) { n.pos.x = x; n.pos.y = y; }
    n.vx = n.vy = 0; if (n.vel) { n.vel.x = n.vel.y = 0; }
    window.ScoutBay.cmdSpeed = 0;
    return true;
  })()`);
  await run(20);
  const c0 = await ev(aimNearest);
  // Diagnostyka celowania: wieża z gniazda vs rekord Turret2D (rysunek), kursor tam i z powrotem, wieża pod kursorem.
  report.kroki.celowanie = await ev(`(() => {
    const n = window.ScoutBay.npc, t = window.__ssTarget;
    const list = window.MalaSkala.wieze(t);
    let w = null, bd = Infinity;
    for (const q of list) { const d = Math.hypot(q.x - n.x, q.y - n.y); if (d < bd) { bd = d; w = q; } }
    const s = window.DevScene.pointerAt(w.x, w.y);
    const back = window.screenToWorld(s.x, s.y);
    const recs = (window.Turret2D.recordsFor(t) || []).filter((r) => r.entity === t);
    let rec = null, rd = Infinity;
    for (const r of recs) { const d = Math.hypot(r.wx - w.x, r.wy - w.y); if (d < rd) { rd = d; rec = r; } }
    return { wieza: { x: Math.round(w.x), y: Math.round(w.y), bron: w.bron, strefa: Math.round(w.r) },
      kursorWracaO: +Math.hypot(back.x - w.x, back.y - w.y).toFixed(1),
      pod: window.MalaSkala.wiezaPod(back.x, back.y), wrogi: window.isHostileNpc(t),
      spriteRot: t.capitalProfile?.spriteRotation ?? null, skalaGniazd: t.__hardpointScaleX ?? null,
      rekordyTurret2D: recs.length, najblizszyRekordO: rec ? Math.round(rd) : null, rekordBron: rec ? rec.weaponId : null };
  })()`);
  console.log('celowanie', JSON.stringify(report.kroki.celowanie));
  await shot('02-cel-cwiczebny-650');

  // 4. LPM trzymany: działa fregaty strzelają w wieżę (kursor odświeżany co 6 klatek — kamera jedzie za fregatą).
  const c = { x: c0 ? c0.sx : W / 2, y: c0 ? c0.sy : H / 2 };
  await ev(`(() => { document.getElementById('c').dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: ${c.x}, clientY: ${c.y}, bubbles: true })); return true; })()`);
  // Kolejna wieża dalej niż ~260 j. od fregaty: fregata przestawiona 220 j. na zewnątrz tej wieży (od środka celu) —
  // wyłączanie po kolei bez pilotowania w harnessie.
  const placeNear = `(() => {
    const n = window.ScoutBay.npc, t = window.__ssTarget;
    const list = window.MalaSkala.wieze(t);
    let best = null, bd = Infinity;
    for (const w of list) { const d = Math.hypot(w.x - n.x, w.y - n.y); if (d < bd) { bd = d; best = w; } }
    if (!best) return null;
    if (bd <= 260) return { odl: Math.round(bd), przestawiona: false };
    const ux = best.x - t.x, uy = best.y - t.y, L = Math.hypot(ux, uy) || 1;
    const x = best.x + ux / L * 220, y = best.y + uy / L * 220;
    n.x = x; n.y = y; if (n.pos) { n.pos.x = x; n.pos.y = y; }
    n.vx = n.vy = 0; if (n.vel) { n.vel.x = n.vel.y = 0; }
    window.ScoutBay.cmdSpeed = 0;
    return { odl: Math.round(bd), przestawiona: true, bron: best.bron };
  })()`;
  report.kroki.ogien = [];
  let down = 0;
  for (let k = 0; k < 40; k++) {
    await ev(placeNear);
    await ev(aimNearest);
    await run(6);
    if (k === 6) await shot('03-ogien-650');
    const st = await ev('window.MalaSkala.stats.turretsDown');
    if (st > down) { down = st; if (down <= 2) await shot(`03b-wieza-zniszczona-${down}`); }
    if (k % 8 === 7) { const s = await ev(STATE); report.kroki.ogien.push(s); console.log('ogień', JSON.stringify(s)); }
  }
  await shot('04-po-serii-650');
  await ev(`(() => { window.camera.targetZoom = window.innerWidth / 320; window.camera.manualZoom = true; return true; })()`);
  await run(40);
  await ev(aimNearest);
  await shot('05-kadr-320');
  for (let k = 0; k < 60; k++) { await ev(placeNear); await ev(aimNearest); await run(6); }
  await ev(`(() => { document.getElementById('c').dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: ${c.x}, clientY: ${c.y}, bubbles: true })); return true; })()`);
  report.kroki.koniecOgnia = await ev(STATE);
  console.log('koniec ognia', JSON.stringify(report.kroki.koniecOgnia));
  await shot('06-po-ogniu-320');

  // 5. Powrót (H): zoom i limit wracają.
  await ev(`(() => { window.ScoutBay.recall(); return true; })()`);
  await run(30);
  report.kroki.powrot = await ev(STATE);
  console.log('powrót', JSON.stringify(report.kroki.powrot));
  report.pipeline = (await ev(`window.__harness.frameStats(0)`)).pipeline;
  report.bledy = logs.errors().filter((l) => !/favicon|AudioSys|decode audio|powerPreference|\[vite\]|DevTools|ReadPixels/.test(l)).slice(0, 20);
} catch (err) {
  report.blad = String(err?.stack || err);
  console.log('BŁĄD', report.blad);
} finally {
  clearTimeout(guard);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2) + '\n');
  try { await chrome.close(); } catch {}
  try { await server.close(); } catch {}
}
console.log('pipeline', JSON.stringify(report.pipeline), '| błędy strony:', (report.bledy || []).length, (report.bledy || []).slice(0, 5).join(' | '));
process.exit(report.blad ? 1 : 0);
