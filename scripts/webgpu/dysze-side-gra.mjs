// Modele 3D dysz SIDE w PRAWDZIWEJ grze (2026-10-07; src/3d/ships3d/thrusters/sideThruster3D.js, partia
// thrusterBatch3D.js, lista klatki sideNozzleFrame.js): Vite + headless Chrome z GPU (CDP). Gra swobodna, okręty
// Terra Nova (fregata, niszczyciel, lotniskowiec, superkapitał) i piratów (fregata, superkapitał) obok Atlasa, pauza,
// ciąg SIDE wymuszony (__throttle = 1) — zbliżenia każdego kadłuba w wariantach sprite (statki 2D) i model 3D
// (statki 3D), A/B bez modeli dysz (setSideNozzles3D(false) — płomień wraca na marker), wektorowanie (dysze gracza
// obrócone w zakresie gimbala), kamera 3D (orbita) przy Atlasie. Frachtowce (sceny fr_*: wahadłowiec, kontenerowiec,
// frachtowiec dalekiego zasięgu, ciężki frachtowiec, lokomotywa megafrachtowca — wpisy edytora `sideOnly`): po 4 dysze
// SIDE w szarej palecie cywilnej; w raporcie dysze encji (lista klatki), źródło układu i skala markerów.
//
//   node scripts/webgpu/dysze-side-gra.mjs [--out .tmp/dysze-side/gra] [--rozmiar 1600x900] [--czekaj 1400]
//        [--sceny gracz,tn_frigate,…] [--warianty 2d,3d,ab] [--kamera3d 1]
//
// Wynik: <out>/<scena>-<wariant>.png, <out>/raport.json (dysze w partii, rysunki, pipeline'y synchroniczne w klatce,
// błędy konsoli).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/dysze-side/gra');
const waitMs = Number(args.czekaj || 1400);
const onlyScenes = args.sceny ? new Set(String(args.sceny).split(',')) : null;
const variants = String(args.warianty || '2d,3d,ab').split(',').filter(Boolean);
mkdirSync(out, { recursive: true });

const { server, base } = await startVite(Number(args.port || 5393));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { sceny: {}, bledy: [] };

// Kamera RTS na encji (wyrażenie w stronie) ze stałym zoomem; dx, dy — przesunięcie w j. świata (w układzie kadłuba).
const camAt = (expr, z, dx = 0, dy = 0) => ev(`(() => {
  const e = ${expr};
  if (!e) return false;
  const x = e.pos ? e.pos.x : e.x, y = e.pos ? e.pos.y : e.y, a = Number(e.angle) || 0;
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = x + Math.cos(a) * ${dx} - Math.sin(a) * ${dy};
  c.y = c.targetY = y + Math.sin(a) * ${dx} + Math.cos(a) * ${dy};
  c.manualZoom = true; if (${z} > c.maxZoom) c.maxZoom = ${z}; c.zoom = c.targetZoom = ${z};
  window.DevScene?.syncCamera?.();
  return true;
})()`);
const npc = (tag) => `(window.npcs || []).find((n) => n && n.__dysze === '${tag}')`;

// Pipeline'y tworzone synchronicznie w klatce (to, czego nie rozgrzano) — licznik w backendzie three.
const HOOK = `(() => {
  const be = window.Core3D?.renderer?.backend;
  if (!be || be.__dyszeHook) return !!be;
  const list = window.__dyszeSync = [];
  const orig = be.createRenderPipeline.bind(be);
  be.createRenderPipeline = (ro, promises) => {
    if (!promises) list.push((ro.material && (ro.material.name || ro.material.type)) + ' @ ' + (ro.object && (ro.object.name || ro.object.type)));
    return orig(ro, promises);
  };
  be.__dyszeHook = true;
  return true;
})()`;

// Dysze SIDE encji: na liście klatki (EngineVfxSystem — te rysuje partia modeli), w układzie z edytora, dysze MAIN
// (frachtowce: 0 — ścieżka lotu bez zmian), wpis edytora i skala markerów (obraz kadłuba).
const nozzleInfo = (expr) => ev(`(() => {
  const e = ${expr};
  if (!e) return null;
  const F = window.SideNozzleFrame;
  let lista = 0;
  for (let i = 0; i < (F ? F.count : 0); i++) if (F.entity[i] === e) lista++;
  return { typ: e.type, rama: e.shipFrame, edytor: e.__editorLayoutShipId || null, uklad: (e.visual?.torqueThrusters || []).length,
    lista, main: (e.visual?.mainThrusters || []).length, skala: +(Number(e.__hardpointScaleX) || 0).toFixed(4), kadlub: !!e.beamHull };
})()`);

async function shot(scene, variant, info = null) {
  await sleep(waitMs);
  if (typeof info === 'string') info = await nozzleInfo(info);
  const stan = await ev(`(async () => {
    const m = await import('/src/3d/ships3d/shipModels3DGame.js');
    const s = m.shipModels3DStats();
    return { dysze: s.sideNozzles, rysunki: s.sideNozzleDraws, lista: window.SideNozzleFrame?.count ?? null,
      zoom: +(window.camera.zoom || 0).toFixed(3), sync: (window.__dyszeSync || []).length };
  })()`);
  await screenshotPng(cdp, join(out, `${scene}-${variant}.png`));
  (report.sceny[scene] ||= {})[variant] = { info, ...stan };
  console.log(scene.padEnd(14), variant.padEnd(10), JSON.stringify({ info, ...stan }));
}

const SCENES = [
  // [nazwa, wyrażenie encji, zoom, przesunięcie kamery w układzie kadłuba (dx — ku dziobowi, dy — ku prawej burcie)]
  ['gracz', 'window.ship', 0.62, 0, 0],
  ['gracz-dziob', 'window.ship', 1.5, 700, 0],
  ['gracz-rufa', 'window.ship', 1.5, -640, 120],
  ['tn_frigate', npc('tn_frigate'), 3.2, 0, 0],
  ['tn_destroyer', npc('tn_destroyer'), 2.2, 0, 0],
  ['tn_carrier', npc('tn_carrier'), 0.8, 0, 0],
  ['tn_super', npc('tn_super'), 0.55, 0, 0],
  ['pi_frigate', npc('pi_frigate'), 3.2, 0, 0],
  ['pi_super', npc('pi_super'), 0.62, 0, 0],
  // frachtowce (dysze SIDE z wpisów edytora `sideOnly`, szara paleta cywilna)
  ['fr_shuttle', npc('fr_shuttle'), 6, 0, 0],
  ['fr_container', npc('fr_container'), 3, 0, 0],
  ['fr_longhaul', npc('fr_longhaul'), 1.8, 0, 0],
  ['fr_heavy', npc('fr_heavy'), 0.6, 0, 0],
  ['fr_mega', npc('fr_mega'), 0.42, 0, 0],
  ['fr_mega_rufa', npc('fr_mega'), 2.4, -990, -500]
];

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.setVisualMode(false, false); document.getElementById('btn-new-game')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 40', 300000, 400)) throw new Error('gra nie ruszyła');
  await waitFor(cdp, HOOK, 30000, 300);
  await sleep(1200);
  // Okręty obok gracza (przyloty wsparcia i piratów) — bez walki, żeby stały w kadrze.
  report.spawn = await ev(`(() => {
    const s = window.ship; const out = []; const errs = [];
    const put = (k, mode, x, y, a, tag) => {
      try {
        const r = window.spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a });
        const e = Array.isArray(r) ? r[0] : r;
        if (e) { e.__dysze = tag; e.combatDisabled = true; out.push(tag); }
      } catch (err) { errs.push(k + ': ' + String(err?.message || err)); }
    };
    put('frigate_pd', 'friendly', 1500, -1900, 0.4, 'tn_frigate');
    put('destroyer', 'friendly', 1500, 1900, -0.3, 'tn_destroyer');
    put('carrier', 'friendly', -2600, 3600, 0, 'tn_carrier');
    put('supercapital', 'friendly', 5200, 0, 0, 'tn_super');
    put('frigate_pd', 'pirate', -1500, -2600, 2.2, 'pi_frigate');
    put('pirate_supercapital', 'pirate', -5200, -3600, 0, 'pi_super');
    // Frachtowce: kadłuby dev (rama = profil frachtowca) i skład megafrachtowca (lokomotywa = głowa, wagony za nią —
    // dalej od gracza).
    put('freighter-small', 'friendly', -3200, 7000, 0.3, 'fr_shuttle');
    put('freighter-medium', 'friendly', -1600, 7000, 0.3, 'fr_container');
    put('freighter-large', 'friendly', 600, 7200, 0.3, 'fr_longhaul');
    put('freighter-capital', 'friendly', 4200, 7400, 0.3, 'fr_heavy');
    try {
      const head = window.spawnCallInShip('megafreighter', { mode: 'friendly', pos: { x: s.pos.x - 2000, y: s.pos.y - 9500 }, angle: Math.PI / 2 });
      if (head) { head.__dysze = 'fr_mega'; head.combatDisabled = true; out.push('fr_mega'); }
    } catch (err) { errs.push('megafreighter: ' + String(err?.message || err)); }
    return { out, errs };
  })()`);
  console.log('spawn', JSON.stringify(report.spawn));
  await waitFor(cdp, `(window.npcs || []).filter((n) => n && n.__dysze && n.beamHull).length >= 11`, 60000, 400);
  await sleep(3500);
  await ev('window.__setGamePaused(true)');
  // Ciąg SIDE wymuszony (EngineVfxSystem czyta __throttle; w pauzie aktuator dysz stoi).
  await ev(`(() => { for (const e of [window.ship, ...(window.npcs || [])]) for (const t of (e?.visual?.torqueThrusters || [])) t.__throttle = 1; return true; })()`);
  report.pipelineStart = await ev('(window.__dyszeSync || []).length');

  for (const [name, expr, z, dx, dy] of SCENES) {
    if (onlyScenes && !onlyScenes.has(name)) continue;
    if (!await camAt(expr, z, dx, dy)) { console.log('brak', name); continue; }
    const throttle = (v) => `(() => { for (const e of [window.ship, ...(window.npcs || [])]) for (const t of (e?.visual?.torqueThrusters || [])) t.__throttle = ${v}; return true; })()`;
    for (const v of variants) {
      if (v === '2d') await ev('(() => { window.setVisualMode(false, false); window.setSideNozzles3D(true); return true; })()');
      else if (v === '3d') await ev('(() => { window.setVisualMode(true, true); window.setSideNozzles3D(true); return true; })()');
      // A/B: bez modeli dysz (płomień wraca na marker) i dawny płomień SIDE (engineExhaustBatch)
      else if (v === 'ab') await ev('(() => { window.setVisualMode(false, false); window.setSideNozzles3D(false); return true; })()');
      else if (v === 'stary') await ev('(() => { window.setVisualMode(false, false); window.setSideNozzles3D(true); window.SideJets3D.enabled = false; return true; })()');
      // spokój: dysze bez ciągu (farba modelu bez strug w bloomie); pół: praca impulsowa (35% ciągu)
      else if (v === 'spokoj') await ev(`(() => { window.setVisualMode(false, false); window.setSideNozzles3D(true); return ${throttle(0)}; })()`);
      else if (v === 'pol') await ev(`(() => { window.setVisualMode(false, false); window.setSideNozzles3D(true); return ${throttle(0.35)}; })()`);
      await shot(name, v, name.startsWith('fr_') ? expr : null);
      if (v === 'spokoj' || v === 'pol') await ev(throttle(1));
      if (v === 'stary') await ev('(() => { window.SideJets3D.enabled = true; return true; })()');
    }
    await ev('(() => { window.setSideNozzles3D(true); window.setVisualMode(false, false); return true; })()');
  }

  // Wektorowanie: dysze gracza obrócone w zakresie gimbala (lewe +55°, prawe −55° od bazy), sprite i model.
  if (!onlyScenes || onlyScenes.has('wektor')) {
    await ev(`(() => {
      for (const t of (window.ship?.visual?.torqueThrusters || [])) {
        const left = String(t.mount || '').endsWith('_left');
        const d = (Number(t.baseDeg) || 0) + (left ? 55 : -55);
        t.nozzleDeg = t.__nozzleCurrentDeg = t.__nozzleTargetDeg = d;
      }
      return true;
    })()`);
    await camAt('window.ship', 1.5, 700, 0);
    for (const v of ['2d', '3d']) {
      await ev(`(() => { window.setVisualMode(${v === '3d'}, ${v === '3d'}); return true; })()`);
      await shot('wektor', v);
    }
    await ev('(() => { window.setVisualMode(false, false); return true; })()');
  }

  // Lot (--lot 1): bez pauzy, Atlas obraca się i przesuwa w bok (impulsy, kłęby gazu w ruchu) — seria zdjęć
  // i czas klatki: nowe dysze (modele + struga WebGPU) ↔ dawny płomień bez modeli, naprzemiennie (szum maszyny).
  if (args.lot === '1') {
    await ev(`(() => { for (const e of [window.ship, ...(window.npcs || [])]) for (const t of (e?.visual?.torqueThrusters || [])) delete t.__throttle; window.__setGamePaused(false); return true; })()`);
    await camAt('window.ship', 0.55);
    await ev(`(() => { const c = window.camera; c.mode = 'ship'; c.manualZoom = true; c.zoom = c.targetZoom = 0.55; return true; })()`);
    const KEY = {
      a: { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65 },
      q: { key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 81 }
    };
    const key = (k, down) => cdp.send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', ...KEY[k] });
    await key('a', true);
    await key('q', true);
    for (let i = 0; i < 4; i++) { await sleep(260); await screenshotPng(cdp, join(out, `lot-${i}.png`)); }
    const frameMs = async () => ev(`(async () => {
      const t = []; let last = performance.now();
      await new Promise((ok) => { const f = (now) => { t.push(now - last); last = now; if (t.length < 180) requestAnimationFrame(f); else ok(); }; requestAnimationFrame(f); });
      t.sort((a, b) => a - b);
      return { sr: +(t.reduce((s, v) => s + v, 0) / t.length).toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2) };
    })()`, 60000);
    const runs = [];
    for (const v of ['nowe', 'stare', 'nowe', 'stare']) {
      await ev(v === 'nowe' ? '(() => { window.SideJets3D.enabled = true; window.setSideNozzles3D(true); return true; })()'
        : '(() => { window.SideJets3D.enabled = false; window.setSideNozzles3D(false); return true; })()');
      await sleep(400);
      runs.push({ v, ...(await frameMs()) });
    }
    await key('a', false);
    await key('q', false);
    await ev('(() => { window.SideJets3D.enabled = true; window.setSideNozzles3D(true); return true; })()');
    report.lot = { klatka: runs, strugi: await ev('window.SideJets3D.getStats()') };
    console.log('lot', JSON.stringify(report.lot));
  }

  // Kamera 3D (orbita) przy dziobie Atlasa — dzwony z boku (model 3D zawsze w kamerach 3D).
  if (args.kamera3d !== '0' && (!onlyScenes || onlyScenes.has('kamera3d'))) {
    await ev(`(() => { const c = window.camera; c.mode = 'ship'; c.manualZoom = true; c.zoom = c.targetZoom = 0.9; window.Game3D.setCamera('orbit'); window.Game3D.rig.first = true; return true; })()`);
    await shot('kamera3d', 'orbita');
    await ev(`(() => { window.Game3D.setCamera('classic'); return true; })()`);
  }
  report.pipelineKoniec = await ev('(window.__dyszeSync || []).slice(0, 40)');
  report.bledy = logs.errors().slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
  console.log('pipeline\'y synchroniczne po starcie:', JSON.stringify(report.pipelineKoniec));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-80);
  console.error(err);
} finally {
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 2));
  await chrome.close();
  await server.close();
}
