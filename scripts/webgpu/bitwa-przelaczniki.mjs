// Koszt pojedynczych funkcji gry w DUŻEJ bitwie (audyt FPS 2026-10-11, docs/AUDYT-wydajnosc-2026-10-11.md): JEDNA
// bitwa (skład jak scripts/profil-bitwy-flot.mjs, fale dosyłane, gdy strona słabnie), na przemian fazy E0 (gra bez
// zmian) i wariant (funkcja wyłączona przełącznikiem w stronie), kanapki E0 – V – E0: liczy się różnica V − średnia
// sąsiednich E0, więc trend bitwy i wolne zmiany tła maszyny się znoszą. Wynik: fps, czas zadań wątku głównego na
// klatkę (CDP TaskDuration), czasy PerfHUD, układ strony i styl; średnia ± SE z kanapek.
//   node scripts/webgpu/bitwa-przelaczniki.mjs --warianty nozzles,radar,markers,... [--sklad 50,20,10,3]
//        [--zoom 0.1 | --zoom default] [--trwanie 240] [--faza 3] [--ustal 0.6] [--seed 7] [--port 5310]
//        [--query physHz=60] [--ls 'k=v;k=v'] [--out katalog]
// Warianty: tablica ALL niżej (np. dirOff — reżyser kadru wył. przy E0 = Pełny; do tego --zoom default, dłuższe fazy:
// --faza 7 --ustal 3, bo kadr przybliża się po ~2,5 s + 6,7 s). Nowy wariant = para wyrażeń [wyłącz, przywróć].
// Poprawki z audytu (§ 4, pkt 2–7): warianty *Old włączają STARĄ ścieżkę (E0 = nowa) — koszt poprawki = −różnica:
// --warianty colorOld,wakeOld,ghostsOld,nozzleOld,jetOld,flightOld (wyniki — § 6 audytu).
// Pomiar tylko przy bezczynnych innych sesjach — równoległa gra w headless Chrome zabiera grze 35–75% klatek.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, navigateAndWait, evaluate, sleep } from '../../dema/rdzen-cdp.js';
import { startChrome } from './wspolne.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const SKLAD = String(arg('sklad', '50,20,10,3')).split(',').map((v) => Math.max(0, Number(v) || 0));
const [NF, ND, NB, NS] = [SKLAD[0] || 0, SKLAD[1] || 0, SKLAD[2] || 0, SKLAD[3] || 0];
const ZOOM_ARG = String(arg('zoom', '0.1'));
const ZOOM = ZOOM_ARG === 'default' ? '(Number(cam.defaultZoom) || 0.2)' : String(Number(ZOOM_ARG));
const TRWANIE = Number(arg('trwanie', 240));
const FAZA = Number(arg('faza', 3));
const USTAL = Number(arg('ustal', 0.6));
const PORT = Number(arg('port', 5310));
const SEED = arg('seed', '7');
const QUERY = arg('query', '');
const LS = String(arg('ls', '')).split(';').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; });
const OUT = arg('out', join(tmpdir(), 'bitwa-przelaczniki'));
mkdirSync(OUT, { recursive: true });

// Warianty: on — włącz eksperyment (wyłącz funkcję), off — przywróć.
const ALL = {
  jetsOld: ['window.SideJets3D.enabled = false', 'window.SideJets3D.enabled = true', 'dysze SIDE: stary batch zamiast sideJets3D'],
  nozzles: ['window.setSideNozzles3D(false)', 'window.setSideNozzles3D(true)', 'bez modeli 3D dysz SIDE'],
  engLights: ['(window.__hullLightTune.__eg = window.__hullLightTune.engineGain, window.__hullLightTune.engineGain = 0)',
    '(window.__hullLightTune.engineGain = window.__hullLightTune.__eg ?? 8)', 'bez świateł dysz na kadłubach (engineGain 0)'],
  radar: ['(window.__abP.radarR = window.__abP.CR.prototype.render, window.__abP.CR.prototype.render = function () {})',
    '(window.__abP.CR.prototype.render = window.__abP.radarR)', 'bez rysunku radaru kokpitu'],
  markers: ['(window.__abP.cmD = window.__abP.CM.draw, window.__abP.CM.draw = function () {})',
    '(window.__abP.CM.draw = window.__abP.cmD)', 'bez znaczników krawędzi'],
  turrets: ['window.Core3D.perfToggles.fgWeapons = false', 'window.Core3D.perfToggles.fgWeapons = true', 'bez wieżyczek 2D (sync + rysunek)'],
  fog: ['window.setFogOfWar(false)', 'window.setFogOfWar(true)', 'bez mgły wojny'],
  dust: ["window.OPTIONS.spaceDust = 'off'", "window.OPTIONS.spaceDust = 'on'", 'bez pyłu kosmicznego'],
  shafts: ['window.Core3D.setPerfToggles({ shadowShafts: false })', 'window.Core3D.setPerfToggles({ shadowShafts: true })', 'bez maski słońca (shafts)'],
  classic: ["window.HullLighting.setModel('classic')", "window.HullLighting.setModel('pbr')", 'oświetlenie kadłubów: klasyczne'],
  bridges: ['(window.__abP.b3U = window.Bridge3D.update, window.Bridge3D.update = function () {})',
    '(window.Bridge3D.update = window.__abP.b3U)', 'bez aktualizacji mostków 3D'],
  gas: ['(window.__explosions && (window.__explosions.tune.drawGas = false))', '(window.__explosions && (window.__explosions.tune.drawGas = true))', 'wybuchy: bez marszu gazu'],
  bloom: ['window.Core3D.setPerfToggles({ bloom: false })', 'window.Core3D.setPerfToggles({ bloom: true })', 'bez bloomu'],
  dirOff: ["window.OPTIONS.cameraFrame = 'off'", "window.OPTIONS.cameraFrame = 'full'", 'reżyser kadru wył. (E0 = Pełny)'],
  // stare ścieżki poprawek z audytu (E0 = nowe)
  colorOld: ['window.__abP.AVG.enabled = false', 'window.__abP.AVG.enabled = true', 'kolor smugi wraku bez pamięci per obraz (stara)'],
  wakeOld: ['window.__wakeMovers.enabled = false', 'window.__wakeMovers.enabled = true', 'budzenie wraków: pętla śpiący × ciała (stara)'],
  ghostsOld: ['window.RadarTune.stampGhosts = false', 'window.RadarTune.stampGhosts = true', 'radar: napisy duchów strokeText (stara)'],
  nozzleOld: ['window.SideNozzleFrame.sourceLod = false', 'window.SideNozzleFrame.sourceLod = true', 'modele dysz SIDE bez LOD przy źródle (stara)'],
  jetOld: ['window.SideJets3D.lod = false', 'window.SideJets3D.lod = true', 'dysze SIDE bez obrazu: pełna praca (stara)'],
  flightOld: ['window.FlightVfxLod.enabled = false', 'window.FlightVfxLod.enabled = true', 'stan dysz z modelu lotu 30 Hz dla każdego (stara)']
};
const WAR = String(arg('warianty', 'jetsOld,nozzles,engLights,radar,markers,turrets')).split(',').filter((k) => ALL[k]);

const { server, base } = await startVite(PORT);
const chrome = await startChrome({ width: 1920, height: 1080, webgpu: false });
const { cdp, logs } = chrome;
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    ${LS.map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join(' ')} } catch {}
  let s = ${Number(SEED) >>> 0};
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();` });
await cdp.send('Performance.enable');
const ev = (expr) => evaluate(cdp, expr);
const log = (...a) => console.log(...a);
const perfMetrics = async () => { const { metrics } = await cdp.send('Performance.getMetrics'); const o = {}; for (const m of metrics) o[m.name] = m.value; return o; };

const KEYS = ['frameMs', 'physicsTime', 'physicsPerStep', 'aiTime', 'projectileTime', 'drawTime', 'render3dUpdateTime', 'render3dHexUpdateTime',
  'render3dCoreRenderTime', 'render3dComposerTime', 'renderUiTime', 'render2dTurretTime', 'render2dNpcTime', 'frameUntrackedTime', 'rocketsTime'];
const HUD = `(() => { const d = window.__PH.display; const o = {}; for (const k of ${JSON.stringify(KEYS)}) o[k] = Number(d[k]) || 0;
  const npcs = window.npcs || [];
  o.npc = npcs.filter((n) => !n.dead && !n.fighter).length; o.pir = npcs.filter((n) => !n.dead && !n.fighter && !n.friendly).length;
  o.wr = (window.wrecks || []).length; o.poc = (window.bullets || []).length; o.frame = window.__frameId || 0;
  o.gpu = Number(window.Core3D?.gpuFrameMs) || 0; o.zoom = Number(window.camera?.zoom) || 0; return o; })()`;

const SPAWN = (who) => `(() => {
  const s = window.ship, c = 1, n = 0;
  const at = (fwd, side) => ({ x: s.pos.x + c * fwd - n * side, y: s.pos.y + n * fwd + c * side });
  const put = (key, mode, pos, ang) => window.spawnCallInShip(key, { mode, spawnPos: pos, pos, spawnAngle: ang });
  const block = (key, mode, k, fwd0, rowGap, spacing, perRow, dir, ang) => {
    for (let i = 0; i < k; i++) { const row = Math.floor(i / perRow), inRow = Math.min(perRow, k - row * perRow), j = i - row * perRow;
      put(key, mode, at(fwd0 + dir * row * rowGap, (j - (inRow - 1) / 2) * spacing), ang); } };
  if (${JSON.stringify(who)} !== 'tn') {
    block('frigate_pd', 'pirate', ${NF}, 7000, 700, 650, 25, 1, Math.PI);
    block('destroyer', 'pirate', ${ND}, 8600, 900, 900, 20, 1, Math.PI);
    block('pirate_battleship', 'pirate', ${NB}, 10600, 1500, 1500, 10, 1, Math.PI);
    block('pirate_supercapital', 'pirate', ${NS}, 13500, 3500, 4000, 5, 1, Math.PI);
  }
  if (${JSON.stringify(who)} !== 'pir') {
    block('frigate_laser', 'friendly', ${NF}, -1500, 700, 650, 25, -1, 0);
    block('destroyer', 'friendly', ${ND}, -3100, 900, 900, 20, -1, 0);
    block('battleship', 'friendly', ${NB}, -5100, 1500, 1500, 10, -1, 0);
    block('supercapital', 'friendly', ${NS}, -8000, 3500, 4000, 5, -1, 0);
  }
  const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
  return true; })()`;

const phases = [];
try {
  await navigateAndWait(cdp, `${base}/index.html?dev=1${QUERY ? '&' + QUERY : ''}`,
    '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 180000);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  for (let t0 = Date.now(); Date.now() - t0 < 240000;) {
    await sleep(250);
    try { if (await ev('(window.__frameId || 0) > 30 && !!window.camera')) break; } catch { }
  }
  await ev(`(async () => { const m = await import('/src/ui/perfHud.js'); window.__PH = m.PerfHUD; if (!m.PerfHUD.visible) m.PerfHUD.toggle();
    window.__abP = { CR: (await import('/src/ui/radar/cockpitRadar.js')).CockpitRadar, CM: (await import('/src/ui/contactMarkers.js')).ContactMarkers,
      AVG: (await import('/src/3d/hexBodyImpostorBatch.js')).averageBodyColorCache };
    window.HullLighting?.getTuning?.(); return true; })()`);
  log('miejsce', await ev(`(() => {
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) { const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin }; }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    const cam = window.camera; cam.manualZoom = true; cam.zoom = cam.targetZoom = ${ZOOM};
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { najblizejKm: Math.round(best.dmin / 1000) }; })()`));
  await sleep(4000);
  await ev(SPAWN('both'));
  log('spawn', await ev(HUD));
  await sleep(8000);   // fale zbliżają się, pierwsze trafienia
  const t0 = Date.now();
  const seq = [];
  for (const k of WAR) { seq.push('E0'); seq.push(k); }
  seq.push('E0');
  let idx = 0;
  let lastWave = 0;
  while ((Date.now() - t0) / 1000 < TRWANIE) {
    // dosyłanie fal: strona < 35% składu — nowa fala tej strony (między fazami)
    const st = await ev(HUD);
    const tot = NF + ND + NB + NS;
    if ((Date.now() - lastWave) > 20000) {
      if (st.pir < tot * 0.35) { await ev(SPAWN('pir')); lastWave = Date.now(); log('fala', 'piraci'); }
      else if ((st.npc - st.pir) < tot * 0.35) { await ev(SPAWN('tn')); lastWave = Date.now(); log('fala', 'TN'); }
    }
    const v = seq[idx % seq.length];
    idx++;
    if (v !== 'E0') await ev(ALL[v][0]);
    await sleep(USTAL * 1000);
    const m0 = await perfMetrics();
    const h0 = await ev(HUD);
    const w0 = Date.now();
    const acc = {}; let n = 0;
    const steps = Math.max(2, Math.round((FAZA - USTAL) / 0.6));
    for (let i = 0; i < steps; i++) {
      await sleep(((FAZA - USTAL) * 1000) / steps);
      const h = await ev(HUD);
      for (const k of KEYS) acc[k] = (acc[k] || 0) + h[k];
      n++;
      acc.zoom = (acc.zoom || 0) + h.zoom;
      if (i === steps - 1) { acc.npc = h.npc; acc.wr = h.wr; acc.poc = h.poc; acc.frame = h.frame; acc.gpu = h.gpu; }
    }
    const m1 = await perfMetrics();
    const dt = (Date.now() - w0) / 1000;
    const frames = Math.max(1, acc.frame - h0.frame);
    const ph = { v, t: Math.round((Date.now() - t0) / 1000), fps: frames / dt, taskMs: ((m1.TaskDuration - m0.TaskDuration) * 1000) / frames,
      scriptMs: ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames, npc: acc.npc, wr: acc.wr, poc: acc.poc, gpu: acc.gpu, zoom: acc.zoom / n,
      layoutMs: ((m1.LayoutDuration - m0.LayoutDuration) * 1000) / frames, styleMs: ((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000) / frames };
    for (const k of KEYS) ph[k] = acc[k] / n;
    if (v !== 'E0') await ev(ALL[v][1]);
    phases.push(ph);
    log(`${String(ph.t).padStart(4)} ${v.padEnd(10)} fps ${ph.fps.toFixed(1).padStart(6)} task ${ph.taskMs.toFixed(2).padStart(6)} kl ${ph.frameMs.toFixed(2)} fiz ${ph.physicsTime.toFixed(2)} rys ${ph.drawTime.toFixed(2)} Uhex ${ph.render3dHexUpdateTime.toFixed(2)} core ${ph.render3dCoreRenderTime.toFixed(2)} ui ${ph.renderUiTime.toFixed(2)} lay ${ph.layoutMs.toFixed(2)} sty ${ph.styleMs.toFixed(2)} zoom ${ph.zoom.toFixed(3)} | npc ${ph.npc} wr ${ph.wr} poc ${ph.poc}`);
  }
  // Kanapki: V kontra średnia sąsiednich E0.
  const FIELDS = ['fps', 'taskMs', 'zoom', 'layoutMs', 'styleMs', 'frameMs', 'physicsTime', 'drawTime', 'render3dHexUpdateTime', 'render3dCoreRenderTime', 'renderUiTime', 'render2dTurretTime', 'aiTime', 'gpu'];
  const rep = {};
  for (let i = 1; i + 1 < phases.length; i++) {
    const a = phases[i - 1], b = phases[i], c = phases[i + 1];
    if (b.v === 'E0' || a.v !== 'E0' || c.v !== 'E0') continue;
    const r = rep[b.v] || (rep[b.v] = { n: 0, d: {}, d2: {} });
    r.n++;
    for (const f of FIELDS) { const d = b[f] - (a[f] + c[f]) / 2; r.d[f] = (r.d[f] || 0) + d; r.d2[f] = (r.d2[f] || 0) + d * d; }
  }
  log('\n== WARIANT − średnia sąsiednich E0 (średnia ± SE, n kanapek)');
  log('wariant'.padEnd(10), FIELDS.map((f) => f.padStart(16)).join(''));
  for (const [k, r] of Object.entries(rep)) {
    const cells = FIELDS.map((f) => { const m = r.d[f] / r.n; const v = r.n > 1 ? Math.max(0, r.d2[f] / r.n - m * m) / (r.n - 1) : 0; return `${m.toFixed(2)}±${Math.sqrt(v).toFixed(2)}`.padStart(16); });
    log(k.padEnd(10), cells.join(''), ` n=${r.n}  (${ALL[k][2]})`);
  }
  const e0 = phases.filter((p) => p.v === 'E0');
  log('\nE0 średnio:', JSON.stringify(Object.fromEntries(FIELDS.map((f) => [f, +(e0.reduce((s, p) => s + p[f], 0) / Math.max(1, e0.length)).toFixed(2)]))));
  writeFileSync(join(OUT, 'ab.json'), JSON.stringify({ phases, rep, args: process.argv.slice(2) }, null, 1));
  log('błędy', logs.filter((l) => /^\[(error|exception)\]/.test(l) && !/AudioSys/.test(l)).slice(0, 8));
} catch (e) {
  log('BŁĄD', e.stack || e.message, logs.filter((l) => /^\[(error|exception)\]/.test(l)).slice(0, 8));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}
