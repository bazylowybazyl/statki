// Wydobycie skał w PRAWDZIWEJ grze (zadanie 21b) obok sceny „Kopalnia” dema
// dema/asteroidy-webgpu (klawisz G): ta sama skała testowa (miedź, r = 650, 1700 j. przed
// dziobem w miejscu sceny „pole”, kąt −0,4, zoom 0,34, kadr między statkiem a skałą), ta sama
// sekwencja: skała → lasery dronów (4 s) → piła w poprzek → ładunek L w otworze + detonacja →
// wiązka ściągająca (urobek do ładowni). Zrzuty, stan platformy, błędy konsoli / walidacji.
//
//   node scripts/webgpu/wydobycie-gra.mjs [--out katalog] [--port 5362] [--rozmiar 1920x1080]
//        [--demo] [--koszt] [--hud] [--etapy skala,laser,pila,ladunek,urobek]
// --hud:   z HUD-em DOM kokpitu (układ panelu wydobycia względem kokpitu).
//
// --demo:  te same etapy w demie (window.__demo: rig, mining, step) → <out>/demo/*.png.
// --koszt: czas rzeczywisty (zegar harnessu „real”): budowa ciała, wybuch (ms jednorazowo),
//          najdłuższa klatka wokół przejęcia i wybuchu, koszt klatki po wybuchu (krok
//          platformy + render skał w wydobyciu, mediana) → <out>/koszt.json.
// Etapy (JS w stronie gry): MINING_STAGES — sesja „wydobycie” w zrzuty.mjs bierze je stąd.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const port = Number(args.port || 5362);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/21b');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const SEED = 0x5eed1234;
const IGNORE = [/favicon\.ico/, /AudioSys/, /Unable to decode audio data/, /powerPreference option is currently ignored/, /\[vite\]/, /DevTools/, /GPU stall due to ReadPixels/];

// Wspólne miejsce: scena „pole” dema (W.SPOTS.field), kąt −0,4, skała testowa 1700 j. przed
// dziobem, kadr 0,62 drogi statek → skała (camHold dema), zoom 0,34.
export const MINING_SETUP = `const W = await import('/dema/asteroidy-webgpu/world.js');
  const s = W.SPOTS.field; DevScene.teleport(s.x, s.y, -0.4);
  const B = window.__asteroidBelt; const R = B.rig;
  R.reset(); window.setMiningMode(true, true); window.__miningAim = { x: NaN, y: NaN, down: false };
  await H.step(3);
  const rock = R.spawnTestRock('copper', { x: ship.pos.x, y: ship.pos.y, angle: ship.angle }, 650);
  const rx = rock.p[0], ry = -rock.p[1];
  window.__minTest = { rx, ry, sx: ship.pos.x, sy: ship.pos.y };
  S.cam(ship.pos.x + (rx - ship.pos.x) * 0.62, ship.pos.y + (ry - ship.pos.y) * 0.62, 0.34);`;

// Etapy: js — ciało funkcji async w stronie (S = pomocniki sceny, H = harness, R = platforma,
// T = window.__minTest); klatki 1/60 s (fizyka 120 Hz — dwa kroki na klatkę).
export const MINING_STAGES = {
  skala: {
    opis: 'Skała testowa (miedź, r 650) przejęta przez fizykę — zewnętrze materiałem skał w trybie wycięć',
    js: `${MINING_SETUP}
      await H.step(30);`
  },
  laser: {
    opis: 'Lasery trzech dronów w środku skały (4 s): otwór, żar cięcia, iskry, reflektory robocze',
    js: `const T = window.__minTest; window.__miningAim = { x: T.rx, y: T.ry, down: true }; await H.step(240);`
  },
  pila: {
    opis: 'Piła w poprzek skały (drut między dwoma dronami, rozżarzona szczelina)',
    js: `const T = window.__minTest; const R = window.__asteroidBelt.rig; window.__miningAim = { x: T.rx, y: T.ry, down: false };
      const dx = T.rx - T.sx, dy = T.ry - T.sy, l = Math.hypot(dx, dy) || 1; const nx = -dy / l, ny = dx / l;
      const ox = T.rx + (dx / l) * 250, oy = T.ry + (dy / l) * 250;
      R.startSaw(ox - nx * 900, oy - ny * 900, ox + nx * 900, oy + ny * 900);
      for (let i = 0; i < 400 && !R.saw.done && R.saw.t < R.saw.len * 0.55; i++) await H.step(1);`
  },
  ladunek: {
    opis: 'Ładunek L w dnie otworu lasera + detonacja: błysk, iskry, fala, odłamy',
    js: `const T = window.__minTest; const R = window.__asteroidBelt.rig;
      for (let i = 0; i < 600 && !R.saw.done; i++) await H.step(1);
      R.chargeIndex = 2; R.stock.L = Math.max(R.stock.L, 2);
      R.plantCharge(T.rx, T.ry); await H.step(2);
      R.detonate(); await H.step(5);`
  },
  urobek: {
    opis: 'Wiązka ściągająca: odłamy i okruchy lecą do statku, ruda do ładowni',
    js: `const R = window.__asteroidBelt.rig; if (!R.tractorOn) R.toggleTractor(); await H.step(150);`
  }
};

// Te same etapy w demie (window.__demo: rig dema, mining, step(n, dt)).
const DEMO_STAGES = {
  skala: `const d = window.__demo; d.setScene('mining'); d.S.mouse.valid = false; d.S.showEscort = false; d.step(40, 1 / 60);
    const b = d.mining.bodies[0]; window.__minTest = { rx: b.p[0], ry: -b.p[1], sx: d.S.ship.x, sy: d.S.ship.y };`,
  laser: `const d = window.__demo; const T = window.__minTest; for (let i = 0; i < 240; i++) { d.rig.pointer(T.rx, T.ry, true); d.step(1, 1 / 60); }`,
  pila: `const d = window.__demo; const T = window.__minTest; d.rig.pointer(T.rx, T.ry, false);
    const dx = T.rx - T.sx, dy = T.ry - T.sy, l = Math.hypot(dx, dy) || 1; const nx = -dy / l, ny = dx / l;
    const ox = T.rx + (dx / l) * 250, oy = T.ry + (dy / l) * 250;
    d.rig.startSaw(ox - nx * 900, oy - ny * 900, ox + nx * 900, oy + ny * 900);
    for (let i = 0; i < 400 && d.rig.saw && !d.rig.saw.done && d.rig.saw.t < d.rig.saw.len * 0.55; i++) d.step(1, 1 / 60);`,
  ladunek: `const d = window.__demo; const T = window.__minTest;
    for (let i = 0; i < 600 && d.rig.saw && !d.rig.saw.done; i++) d.step(1, 1 / 60);
    d.rig.chargeIndex = 2; d.rig.plantCharge(T.rx, T.ry, d.S.time); d.step(2, 1 / 60); d.rig.detonate(); d.step(5, 1 / 60);`,
  urobek: `const d = window.__demo; if (!d.rig.tractor) d.rig.toggleTractor(); d.step(150, 1 / 60);`
};

const STATE_JS = `(() => { const B = window.__asteroidBelt; const R = B.rig; const M = B.mining;
  const ore = {}; for (const k of Object.keys(R.totals.ore)) if (R.totals.ore[k] > 0) ore[k] = R.totals.ore[k];
  return { ciala: M.bodies.length, okruchy: M.pebbles.length, drony: R.drones.map((d) => [Math.round(d.p[0]), Math.round(-d.p[1]), Math.round(d.p[2]), d.laserOn ? 1 : 0]),
    laser: R.drones.filter((d) => d.laserOn).length, pila: R.saw.active ? +(R.saw.t / R.saw.len).toFixed(2) : null, ladunki: R.charges.length, wybuchy: R.totals.blasts,
    zebrane: R.totals.collected, ruda: ore, plonna: +R.totals.waste.toFixed(1), stracone: +R.totals.lost.toFixed(1), ladownia: window.CockpitBridge?.getCargoLabel?.() ?? null, wiazka: R.tractorOn ? R.tractorCount : null,
    atlas: { ...B.mined.stats }, widok: { ...B.miningView.stats }, ciezkieMs: +R.stats.heavyMs.toFixed(2), budowaMs: +M.stats.lastBuildMs.toFixed(2), wybuchMs: +M.stats.lastBlastMs.toFixed(2),
    komunikaty: R.recentMessages(4) }; })()`;

async function openGame(cdp, ev, base) {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${SEED};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  if (!await waitFor(cdp, '!!(window.__asteroidBelt && window.__asteroidBelt.ready && window.__asteroidBelt.rig)', 120000, 400)) throw new Error('pas / platforma nie wstały');
}

async function gameStages(base) {
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  const report = { when: new Date().toISOString(), etapy: [] };
  const dir = join(outDir, 'gra');
  mkdirSync(dir, { recursive: true });
  try {
    await openGame(cdp, ev, base);
    await ev('window.__harness.hold(true)');
    const only = args.etapy ? new Set(args.etapy.split(',')) : null;
    for (const [id, st] of Object.entries(MINING_STAGES)) {
      if (only && !only.has(id) && id !== 'skala') continue;
      logs.clear();
      const t0 = Date.now();
      let error = null;
      try {
        await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(${args.hud ? 'false' : 'true'}); H.reseed(0x21b0 + ${Object.keys(MINING_STAGES).indexOf(id)}); ${st.js} return true; })()`);
        await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
        await ev('window.__harness.frames(4)');
      } catch (err) {
        error = String(err?.message || err).slice(0, 500);
      }
      await screenshotPng(cdp, join(dir, `${id}.png`));
      const state = await ev(STATE_JS);
      const perf = await ev('window.__harness.scene.perf(10)');
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      report.etapy.push({ etap: id, opis: st.opis, blad: error, sekundy: (Date.now() - t0) / 1000, stan: state, perf, bledy: errors.slice(0, 20) });
      console.log(`  gra ${id.padEnd(8)} ${error ? 'BŁĄD ' + error : 'ok'} | ciała ${state.ciala} okruchy ${state.okruchy} | laser ${state.laser} | piła ${state.pila} | wybuchy ${state.wybuchy} | zebrane ${state.zebrane} ruda ${JSON.stringify(state.ruda)} ładownia ${state.ladownia} wiązka ${state.wiazka} wiązki ${state.widok.beams} | ${perf.drawCalls} dc, GPU ${perf.gpuMs} ms | błędy ${errors.length}`);
      if (errors.length) console.log('     ' + errors.slice(0, 6).join('\n     '));
      if (state.komunikaty?.length) console.log('     › ' + state.komunikaty.join(' | '));
    }
  } finally {
    writeFileSync(join(dir, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
  }
  return report;
}

async function demoStages(base) {
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  const dir = join(outDir, 'demo');
  mkdirSync(dir, { recursive: true });
  const report = { when: new Date().toISOString(), etapy: [] };
  try {
    await cdp.send('Page.navigate', { url: `${base}/dema/asteroidy-webgpu.html?scene=field&shot=1&lights=0` });
    if (!await waitFor(cdp, '!!(window.__demo && window.__demo.S.ready)', 240000, 400)) throw new Error('demo nie wstało');
    await ev(`(() => { const d = window.__demo; d.stopLoop(); d.S.showEscort = false; d.S.dynLights = true; d.setLights(0); d.S.hideUi = true; document.body.classList.add('shot'); return true; })()`);
    for (const [id, js] of Object.entries(DEMO_STAGES)) {
      logs.clear();
      await ev(`(async () => { ${js} return true; })()`);
      await ev(`(() => { window.__demo.step(2, 1 / 60); return true; })()`);
      await screenshotPng(cdp, join(dir, `${id}.png`));
      const st = await ev(`(() => { const d = window.__demo; return { ciala: d.mining.bodies.length, okruchy: d.mining.pebbles.length, ruda: { ...d.rig.cargo.ore }, laser: d.rig.drones.filter((x) => x.laser).length }; })()`);
      const errors = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l)));
      report.etapy.push({ etap: id, stan: st, bledy: errors.slice(0, 20) });
      console.log(`  demo ${id.padEnd(8)} | ciała ${st.ciala} okruchy ${st.okruchy} laser ${st.laser} ruda ${JSON.stringify(st.ruda)} | błędy ${errors.length}`);
    }
  } finally {
    writeFileSync(join(dir, 'wynik.json'), JSON.stringify(report, null, 2) + '\n');
    await chrome.close();
  }
  return report;
}

// Pomiar w czasie rzeczywistym: haki czasu na kroku platformy, obrazie skał w wydobyciu i
// widoku platformy (suma na klatkę rAF) + długość klatki (rAF). Etapy: bezczynnie (tryb
// wyłączony), przejęcie skały pola laserem, cięcie 3 s, ładunek L + detonacja, 3 s po wybuchu.
const KOSZT_HOOKS = `(() => {
  const B = window.__asteroidBelt; const R = B.rig;
  const acc = { rig: 0, mined: 0, view: 0 };
  const wrap = (obj, name, key) => { const f = obj[name].bind(obj); obj[name] = function (a, b) { const t = performance.now(); const r = f(a, b); acc[key] += performance.now() - t; return r; }; };
  wrap(R, 'step', 'rig'); wrap(B.mined, 'update', 'mined'); wrap(B.miningView, 'update', 'view');
  const rec = { frames: [], on: false, last: 0 };
  const tick = (t) => { if (rec.on) { rec.frames.push({ dt: rec.last ? t - rec.last : 0, rig: acc.rig, mined: acc.mined, view: acc.view }); } rec.last = t; acc.rig = 0; acc.mined = 0; acc.view = 0; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  window.__minRec = rec;
  return true; })()`;

async function koszt(base) {
  const chrome = await startChrome({ width: W, height: H });
  const logs = await attachLogs(chrome);
  const { cdp } = chrome;
  const ev = (e, t = 300000) => evaluate(cdp, e, t);
  const res = { when: new Date().toISOString(), etapy: {} };
  const med = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null; };
  const window_ = async (id, seconds, js = '') => {
    await ev(`(() => { window.__minRec.frames.length = 0; window.__minRec.on = true; ${js} return true; })()`);
    await sleep(seconds * 1000);
    const fr = await ev(`(() => { window.__minRec.on = false; return window.__minRec.frames.slice(2); })()`);
    const row = {
      klatek: fr.length,
      klatkaMs: med(fr.map((f) => f.dt)), klatkaMaks: fr.length ? +Math.max(...fr.map((f) => f.dt)).toFixed(2) : null,
      platformaMs: med(fr.map((f) => f.rig)), platformaMaks: fr.length ? +Math.max(...fr.map((f) => f.rig)).toFixed(2) : null,
      skalyMs: med(fr.map((f) => f.mined)), skalyMaks: fr.length ? +Math.max(...fr.map((f) => f.mined)).toFixed(2) : null,
      widokMs: med(fr.map((f) => f.view)),
      razemMs: med(fr.map((f) => f.rig + f.mined + f.view))
    };
    const st = await ev(`(() => { const B = window.__asteroidBelt; const R = B.rig; const M = B.mining; return { ciala: M.bodies.length, okruchy: M.pebbles.length, ciezkieMs: +R.stats.heavyMs.toFixed(2), budowaMs: +M.stats.lastBuildMs.toFixed(2), wybuchMs: +M.stats.lastBlastMs.toFixed(2), wysylki: B.mined.stats.uploads, komorki: B.mined.stats.uploadCells, laser: R.drones.filter((d) => d.laserOn).length }; })()`);
    res.etapy[id] = { ...row, ...st };
    console.log(`  koszt ${id.padEnd(12)} klatka ${row.klatkaMs} ms (maks ${row.klatkaMaks}) | platforma ${row.platformaMs} (maks ${row.platformaMaks}) | skały ${row.skalyMs} (maks ${row.skalyMaks}) | widok ${row.widokMs} | razem ${row.razemMs} ms | ciała ${st.ciala} okruchy ${st.okruchy} | budowa ${st.budowaMs} ms, wybuch ${st.wybuchMs} ms, ciężka ${st.ciezkieMs} ms`);
  };
  try {
    await openGame(cdp, ev, base);
    await ev('window.__harness.hold(true)');
    // Miejsce jak etapy (pole dema), skała pola do przejęcia: najbliższa średnia (r 250–600) przed dziobem.
    const target = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; S.hideHud(true);
      const W = await import('/dema/asteroidy-webgpu/world.js'); const s = W.SPOTS.field; DevScene.teleport(s.x, s.y, -0.4);
      const B = window.__asteroidBelt; B.rig.reset(); await H.step(10);
      S.cam(ship.pos.x, ship.pos.y, 0.34); await H.step(20);
      let best = null, bd = Infinity;
      B.field.forEachRockInRect(0, ship.pos.x - 6000, ship.pos.y - 6000, ship.pos.x + 6000, ship.pos.y + 6000, 400, (r) => {
        if (r.r < 250 || r.r > 600) return; const d = Math.hypot(r.x - ship.pos.x, r.y - ship.pos.y); if (d > 1500 && d < bd) { bd = d; best = r; } });
      return best ? { x: best.x, y: best.y, r: best.r, typ: best.type, d: Math.round(bd) } : null; })()`);
    if (!target) throw new Error('brak skały pola w zasięgu');
    res.skala = target;
    await ev(KOSZT_HOOKS);
    await ev(`(() => { window.__harness.clock.mode = 'real'; window.__harness.hold(false); return true; })()`);
    await sleep(3000);
    await window_('bezczynnie', 3);
    await ev(`(() => { window.setMiningMode(true, true); return true; })()`);
    await window_('tryb-bez-pracy', 2);
    await window_('przejecie', 3, `window.__miningAim = { x: ${target.x}, y: ${target.y}, down: true };`);
    await window_('ciecie', 3);
    await window_('wybuch', 2, `window.__miningAim.down = false; const R = window.__asteroidBelt.rig; R.chargeIndex = 2; R.stock.L = Math.max(R.stock.L, 2); window.__asteroidBelt.rig.plantCharge(${target.x}, ${target.y}); setTimeout(() => R.detonate(), 300);`);
    await window_('po-wybuchu', 3);
    await window_('po-wybuchu-5s', 3);
    res.bledy = logs.errors().filter((l) => !IGNORE.some((re) => re.test(l))).slice(0, 20);
  } finally {
    writeFileSync(join(outDir, 'koszt.json'), JSON.stringify(res, null, 2) + '\n');
    await chrome.close();
  }
  return res;
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { server, base } = await startVite(port);
  try {
    if (args.demo) await demoStages(base);
    else if (args.koszt) await koszt(base);
    else await gameStages(base);
  } finally {
    await server.close();
  }
  console.log('gotowe:', outDir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
