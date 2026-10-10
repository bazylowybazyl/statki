// DYM ZAPŁONU SILNIKA i odpalanie / gaszenie silników MAIN (etap E2 wybuchów i dymu WebGPU — src/game/engineIgnition.js,
// reżyser src/3d/explosions/explosionFx.js: ENGINE_TAG) w PRAWDZIWEJ grze: Vite + headless Chrome z WebGPU (CDP),
// harness czasu wirtualnego (scripts/webgpu/harness-strona.js — klatka 1/60 s, zrzuty na zatrzymanej klatce).
//
//   node scripts/webgpu/zaplon-gra.mjs [--tryb pustka,hala,wodowanie,koszt] [--out .tmp/zaplon-gra] [--rozmiar 1600x900]
//        [--zoom 0.55] [--diag 1] [--port 5381]
//
// pustka (gra swobodna, pusta przestrzeń, Atlas stoi): silniki WYŁ. → klawisz 0 (zapłon) → zrzuty w czasie (dym, błysk,
//   struga) | A/B: bez gazu zapłonu (engineGas false) — sama mechanika (struga rośnie od błysku) | bez mechaniki (silniki
//   zawsze w pracy — dawny obraz: struga od razu) | autozapłon W przy dryfie 300 j/s: nośnik = prędkość z chwili zapłonu
//   (1) i 0 (dym stoi w świecie) | gaszenie (klawisz 0 w pracy) | NPC: Terra Nova (wodór) i pirat (rakieta) — paleta.
// hala (kampania, Atlas na C-01 w hali K-7): klik ODDOKUJ → zrzuty od zwolnienia zamków (driveAt): dym w hali, ściana tylna
//   jako przeszkoda gazu, błysk, struga, W | A/B tej samej klatki: bez przeszkód gazu, bez pyłu hal.
// wodowanie (misja 1, ?story=defences): pierwszy okręt parkingu suchego doku — zapłon przed startem (zegar wodowania),
//   zrzuty dymu w stanowisku i wyjazdu rufą.
// koszt (czas rzeczywisty, pustka): Atlas + 3 NPC w kadrze, cykl zapłon / praca / gaszenie co 4 s; odcinki po 8 s
//   z gazem zapłonu i bez NAPRZEMIENNIE (ABBA ×2): klatka (średnia, p95), GPU klatki, CPU kroku wybuchów, domeny.
// Raport: <out>/raport.json — liczniki, pipeline'y SYNCHRONICZNE w klatkach scen (ma być 0), Core3D.tslUuid.kolizje (0),
// błędy konsoli. Skrypt nie robi reseed (pułapka 38).
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const tryby = String(args.tryb || 'pustka').split(',');
const [W, H] = String(args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/zaplon-gra');
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const ZOOM = Number(args.zoom || 0.55);
const DIAG = !!args.diag;

const { server, base } = await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const report = { pustka: null, hala: null, wodowanie: null, koszt: null, bledy: [] };

const stats = () => ev(`(() => {
  const x = window.__explosions; if (!x) return null;
  const s = x.stats, g = x.grid, e = window.ship?.engineIgn;
  const eg = []; for (const sl of g.slots) if (sl.active && sl.tag === 8) eg.push({ h: +sl.h.toFixed(1), fire: sl.fire, fade: +sl.fade.toFixed(2), v: Math.round(Math.hypot(sl.vx, sl.vy)), hosts: sl.hostN });
  return { silnik: e ? { stan: e.state, t: +e.t.toFixed(2) } : null, v: Math.round(Math.hypot(window.ship.vel.x, window.ship.vel.y)),
    engSeq: s.engSeq, engGas: s.engGas, engNoSlot: s.engNoSlot, engSmall: s.engSmall, engTaken: s.engTaken, engMax: s.engMax,
    domeny: g.stats.active, eg, zrodla: g.stats.sources, cpu: +s.cpuMs.toFixed(3) };
})()`);
const pipesSince = (k0) => ev(`(() => {
  const p = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const comp = p.filter((e) => e.compute);
  const nb = window.__harness.pipes.list.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: comp.length, budowyWKlatce: nb.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12),
    compLista: [...new Set(comp.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
const frameK = () => ev('window.__harness.frameLog.n');
const freeze = () => ev('(() => { const h = window.__harness; h.clock.t = h.realNow(); h.clock.mode = "frozen"; h.hold(true); return true; })()');
const unfreeze = () => ev('(() => { const h = window.__harness; h.hold(false); h.clock.mode = "real"; return true; })()');
const shipCam = (z) => ev(`(() => { const c = window.camera; if (c.mode === 'rts' && c.exitRtsMode) c.exitRtsMode(); c.mode = 'ship'; c.focusStation = null; c.transition = null; c.manualZoom = true;
  c.zoom = c.targetZoom = c.zoomBase = ${z}; document.getElementById('cockpit-ui-host')?.classList.add('hidden'); return true; })()`);
const camAt = (x, y, zoom) => ev(`(() => {
  const c = window.camera;
  if (c.mode !== 'rts' && typeof c.enterRtsMode === 'function') c.enterRtsMode();
  c.x = c.targetX = ${x}; c.y = c.targetY = ${y}; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${zoom};
  c.transition = null; window.DevScene?.syncCamera?.();
  document.getElementById('cockpit-ui-host')?.classList.add('hidden');
  return true;
})()`);
const keyEv = (type, k, code, vk) => cdp.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk });
const tap0 = async () => { await keyEv('keyDown', '0', 'Digit0', 48); await keyEv('keyUp', '0', 'Digit0', 48); };

async function shot(name, extra = null) {
  await ev('window.__harness.frames(2)');
  await sleep(80);
  await screenshotPng(cdp, join(out, `${name}.png`));
  if (DIAG) {
    // „sam gaz”: pule WeaponFx, struga MAIN i światła efektów poza passem — ta sama klatka
    await ev(`(async () => { const F = window.WeaponFx; window.__dg = [...F.gpu.meshes, F.projectiles.mesh, F.trails.mesh, F.beams.mesh].map((m) => [m, m.layers.mask]);
      for (const [m] of window.__dg) m.layers.set(31); window.Core3D.fx.lights.enabled = false; await window.__harness.frames(2); return true; })()`);
    await sleep(80);
    await screenshotPng(cdp, join(out, `${name}-samGaz.png`));
    await ev(`(async () => { for (const [m, mk] of window.__dg) m.layers.mask = mk; window.Core3D.fx.lights.enabled = true; await window.__harness.frames(1); return true; })()`);
  }
  const st = await stats();
  console.log(name.padEnd(34), JSON.stringify(st));
  return { name, ...st, ...(extra || {}) };
}

// Seria zrzutów w czasach `times` [s] od teraz (zegar wirtualny gry: krok 1/60 s).
async function series(prefix, times, onEach = null) {
  const rows = [];
  let tNow = 0;
  for (const at of times) {
    const n = Math.round((at - tNow) * 60);
    if (n > 0) await ev(`window.__harness.step(${n})`);
    tNow = at;
    if (onEach) await onEach(at);
    rows.push(await shot(`${prefix}-${String(at).replace('.', '_')}`, { t: at }));
  }
  return rows;
}

async function startFree() {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
    localStorage.setItem('sc_ships3d', '0'); localStorage.setItem('sc_weapons3d', '0'); } catch {} })();\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  await waitFor(cdp, '!!window.__harness', 60000, 100);
  await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.HullBodies)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await sleep(800);
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30 && !!window.camera && !!window.__explosions && !!window.PlayerEngines', 300000, 400)) throw new Error('gra swobodna nie ruszyła');
  await sleep(2000);
  return ev(`(() => {
    window.setFogOfWar?.(false);
    const pl = (window.planets || []).map((p) => ({ x: p.x ?? p.pos?.x, y: p.y ?? p.pos?.y, n: p.name || p.id })).filter((p) => Number.isFinite(p.x));
    const st = (window.stations || []).map((s) => ({ x: s.x ?? s.pos?.x, y: s.y ?? s.pos?.y })).filter((p) => Number.isFinite(p.x));
    const sun = window.SUN || { x: 0, y: 0 };
    const rOf = (re) => { const p = pl.find((q) => re.test(String(q.n))); return p ? Math.hypot(p.x - sun.x, p.y - sun.y) : NaN; };
    const R = (rOf(/venus|wenus/i) + rOf(/earth|ziemia/i)) / 2;
    let best = null;
    for (let k = 0; k < 96; k++) {
      const a = (k / 96) * Math.PI * 2, x = sun.x + Math.cos(a) * R, y = sun.y + Math.sin(a) * R;
      let dmin = Infinity; for (const p of pl.concat(st)) dmin = Math.min(dmin, Math.hypot(p.x - x, p.y - y));
      if (!best || dmin > best.dmin) best = { x, y, dmin };
    }
    window.DevScene.teleport(best.x, best.y, 0); window.DevScene.syncCamera();
    window.__godTimer = setInterval(() => { const s = window.ship; if (!s || s.destroyed) return;
      if (s.hull) s.hull.val = s.hull.max; if (s.shield) s.shield.val = s.shield.max; }, 100);
    return { x: best.x, y: best.y };
  })()`);
}

// Silniki gracza wyłączone od razu (bez sekwencji), okręt stoi.
const engOff = () => ev(`(async () => { const m = await import('/src/game/engineIgnition.js'); m.setEngineState(window.ship, m.ENGINE_OFF);
  window.ship.vel.x = 0; window.ship.vel.y = 0; window.ship.angVel = 0; return true; })()`);
const setTune = (o) => ev(`(() => { const T = window.__explosions.tune; window.__tPrev = window.__tPrev || {}; for (const [k, v] of Object.entries(${JSON.stringify(o)})) { if (!(k in window.__tPrev)) window.__tPrev[k] = T[k]; T[k] = v; } return true; })()`);
const resetTune = () => ev('(() => { Object.assign(window.__explosions.tune, window.__tPrev || {}); window.__tPrev = {}; return true; })()');
const TIMES = [0.15, 0.45, 0.8, 1.05, 1.2, 1.35, 1.6, 2.0, 2.6, 3.6];

// SONDA ŚWIATŁA dymu zapłonu (--sonda): w punktach osi obłoku (domena ENGINE_TAG, środek i wzdłuż wydechu, wysokość
// źródeł) — światła siatki Core3D.fx.grid (lustro pętli lightGrid.loop: okno, 1/(1+4x²), stożek), suma przed i po kolanie
// (gasGridLightCpu), słońce (maska), otoczenie, albedo × barwa domeny. Wynik w jednostkach przed albedo.
const PROBE = `(async () => {
  const X = window.__explosions, g = X.grid, C = window.Core3D, G = C.fx.grid, look = X.volume.look;
  const { gasGridLightCpu } = await import('/src/3d/gas/gasVolume.js');
  const sl = g.slots.find((s) => s.active && s.tag === 8); if (!sl) return { brak: 'domeny' };
  const F = window.EngineFrame; let k = -1; for (let i = 0; i < F.count; i++) if (F.entity[i] === window.ship) k = i;
  const dx = k >= 0 ? F.dirX[k] : 0, dy = k >= 0 ? F.dirY[k] : 0;
  const L = G.lights, out = { h: +sl.h.toFixed(1), swiatla: G.count, lampy: 0, punkty: [] };
  const half = sl.h * g.N * 0.5;
  for (const f of [-0.6, -0.3, 0, 0.3, 0.6]) {
    const sx = sl.cx + dx * half * f, sy = sl.cy + dy * half * f, z = 14;
    const px = sx - G.originX, py = sy - G.originY;
    const lights = []; let near = [];
    for (let i = 0; i < G.count; i++) {
      const o = i * 16; const ddx = L[o] - px, ddy = L[o + 1] - py, ddz = L[o + 2] - z;
      const dist = Math.hypot(ddx, ddy, ddz), x = dist / Math.max(L[o + 3], 1);
      if (x >= 1) continue;
      const x2 = x * x, win = 1 - x2; let att = win * win / (4 * x2 + 1);
      if (L[o + 11] > -1.5) { const tl = [-ddx / dist, -ddy / dist, -ddz / dist]; const c = tl[0] * L[o + 8] + tl[1] * L[o + 9] + tl[2] * L[o + 10];
        const e0 = L[o + 11], e1 = L[o + 12]; const u = Math.min(1, Math.max(0, (c - e0) / (e1 - e0))); const sm = u * u * (3 - 2 * u); att *= sm * sm; }
      const gain = G.gain.value;
      lights.push({ att, col: [L[o + 4] * gain, L[o + 5] * gain, L[o + 6] * gain], scatter: L[o + 7], owner: L[o + 15], x });
      near.push({ z: Math.round(L[o + 2]), r: Math.round(L[o + 3]), x: +x.toFixed(2), att: +att.toFixed(3), lum: +(L[o + 4] + L[o + 5] + L[o + 6]).toFixed(2), sc: L[o + 7] });
    }
    near.sort((a, b) => b.att * b.lum - a.att * a.lum);
    const gl = gasGridLightCpu(lights, sl.index ?? g.slots.indexOf(sl), look, 1);
    const glT = gasGridLightCpu(lights, sl.index ?? g.slots.indexOf(sl), look, 0.3);
    const sun = C.sunVisibilityAtWorld ? C.sunVisibilityAtWorld(sx, -sy) : null;
    out.punkty.push({ f, n: lights.length, gridPoKolanie: gl.map((v) => +v.toFixed(3)), gridTrans03: glT.map((v) => +v.toFixed(3)),
      slonce: sun, otoczenie: look.ambient.map((v) => +(v * X.volume.ambientScale).toFixed(3)), najsilniejsze: near.slice(0, 5) });
  }
  out.albedoTint = look.albedo.map((v, i) => +(v * sl.tint[i]).toFixed(3));
  out.look = { gridKnee: look.gridKnee, gridShadow: look.gridShadow, gridScatter: look.gridScatter, gridMinSigma: look.gridMinSigma, sunGain: look.sunGain, density: look.density };
  return out;
})()`;

try {
  if (tryby.includes('pustka')) {
    const P = await startFree();
    report.miejsce = P;
    await freeze();
    await ev('window.__harness.step(30)');
    const k0 = await frameK();
    const R = { warianty: {} };
    const at = async (dx, dy) => ev(`(() => { window.DevScene.teleport(${P.x + dx}, ${P.y + dy}, 0); window.ship.angVel = 0; window.ship.vel.x = 0; window.ship.vel.y = 0; return true; })()`);
    // A: zapłon klawiszem 0 (gaz zapłonu + mechanika)
    await at(0, 0);
    await shipCam(ZOOM);
    await engOff();
    await ev('window.__harness.step(90)');   // domeny poprzednich efektów wygasają
    R.warianty.wyl = await shot('p00-wylaczone');
    await tap0();
    R.warianty.zaplon = await series('p01-zaplon', TIMES);
    // gaszenie
    await ev('window.__harness.step(120)');
    await tap0();
    R.warianty.gaszenie = await series('p02-gaszenie', [0.15, 0.4, 0.7, 1.0, 1.5, 2.2]);
    // B: bez gazu zapłonu (sama mechanika: struga rośnie od błysku)
    await ev('window.__harness.step(240)');
    await at(40000, 0); await engOff(); await setTune({ engineGas: false });
    await ev('window.__harness.step(30)');
    await tap0();
    R.warianty.bezGazu = await series('p03-bezGazu', [0.45, 1.05, 1.35, 2.0]);
    await resetTune();
    // C: bez mechaniki — silniki od razu w pracy (dawny obraz), ciąg W
    await at(80000, 0);
    await ev(`(async () => { const m = await import('/src/game/engineIgnition.js'); m.setEngineState(window.ship, m.ENGINE_RUNNING); return true; })()`);
    await ev('window.__harness.step(30)');
    await keyEv('keyDown', 'w', 'KeyW', 87);
    R.warianty.bezMechaniki = await series('p04-bezMechaniki-W', [0.15, 0.45, 1.05]);
    await keyEv('keyUp', 'w', 'KeyW', 87);
    // D: autozapłon W przy dryfie 300 j/s — nośnik domeny 1 (prędkość z chwili zapłonu) i 0 (dym stoi w świecie)
    for (const [label, kc] of [['nosnik1', 1], ['nosnik0', 0]]) {
      await at(120000 + (kc ? 0 : 40000), 0); await engOff(); await setTune({ engineCarrier: kc });
      await ev('(() => { window.ship.vel.x = 300; window.ship.vel.y = 0; return true; })()');
      await ev('window.__harness.step(20)');
      await keyEv('keyDown', 'w', 'KeyW', 87);
      await ev('window.__harness.step(3)');
      await keyEv('keyUp', 'w', 'KeyW', 87);
      R.warianty[label] = await series(`p05-auto-${label}`, [0.45, 1.05, 1.6, 2.6]);
      await resetTune();
    }
    // E: NPC — Terra Nova (wodór) i pirat (rakieta): zapłon z wyłączonych
    for (const [label, key, mode] of [['terra', 'battleship', 'friendly'], ['pirat', 'pirate_battleship', 'pirate']]) {
      const x = P.x + 260000 + (mode === 'pirate' ? 40000 : 0), y = P.y;
      await at(260000 + (mode === 'pirate' ? 40000 : 0), 3000);
      const ok = await ev(`(async () => {
        const m = await import('/src/game/engineIgnition.js');
        const r = window.spawnCallInShip('${key}', { mode: '${mode}', spawnPos: { x: ${x}, y: ${y} }, pos: { x: ${x}, y: ${y} }, spawnAngle: 0 });
        const e = Array.isArray(r) ? r[0] : r; if (!e) return false;
        e.ai = () => {}; e.__fogVisible = true; window.__npcE = e;
        for (let i = 0; i < 60 && !e.beamHull; i++) await window.__harness.step(1);
        m.setEngineState(e, m.ENGINE_OFF);
        return true;
      })()`);
      if (!ok) continue;
      await camAt(x - 600, y, ZOOM * 0.8);
      await ev('window.__harness.step(30)');
      await ev(`(async () => { const m = await import('/src/game/engineIgnition.js'); m.igniteEngine(window.__npcE); return true; })()`);
      R.warianty[label] = await series(`p06-npc-${label}`, [0.45, 1.05, 1.25, 1.6, 2.4]);
      await ev('(() => { window.__npcE.dead = true; return true; })()');
      await shipCam(ZOOM);
    }
    R.pipeline = await pipesSince(k0);
    console.log('pustka pipeline', JSON.stringify(R.pipeline));
    report.pustka = R;
    await unfreeze();
  }

  if (tryby.includes('hala')) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n(() => { try {
      localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
    await waitFor(cdp, '!!window.__harness', 60000, 100);
    await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    await sleep(1000);
    await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
    await sleep(900);
    await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.flight)', 300000, 200)) throw new Error('brak lotu w tle menu');
    await ev(`(() => { const S = window.StoryGame; S.REVEAL_SEC = 1.2; S.REVEAL_DELAY_SEC = 0.2; const f = window.__menuBackdrop.flight; f.devTime = NaN; f.t = f.duration; return true; })()`);
    if (!await waitFor(cdp, '!!window.StoryGame.dialogue.current', 120000, 200)) throw new Error('brak odprawy');
    await sleep(1500);
    for (let k = 0; k < 20; k++) {
      const d = await ev('(() => { const d = window.StoryGame.dialogue; return d.active && d.mode === "scene"; })()');
      if (!d) break;
      await keyEv('keyDown', ' ', 'Space', 32); await keyEv('keyUp', ' ', 'Space', 32);
      await sleep(250);
    }
    if (!await waitFor(cdp, "window.StoryGame.phase === 'undock' && !!window.StoryGame.ui.action", 60000, 200)) throw new Error('brak panelu ODDOKUJ');
    await sleep(4000);
    const R = { przed: await ev('({ silnik: window.ship.engineIgn ? { ...window.ship.engineIgn } : null, blokada: !!window.StoryGame.lock })') };
    console.log('dok przed ODDOKUJ', JSON.stringify(R.przed));
    await freeze();
    await ev('window.__harness.step(20)');
    await shipCam(Number(args.zoomHala || 0.42));
    await ev('window.__harness.step(30)');
    R.k0 = await frameK();
    R.dok = await shot('h00-dok-wylaczone');
    await ev(`(() => { window.StoryGame.triggerAction('undock'); return true; })()`);
    // zapłon smokeTime (1,1 s) przed driveAt (3,45 s): dym od 2,35 s przy zamkach, błysk w chwili zwolnienia, płomień
    // 0,7 s, potem W — Atlas wylatuje ku bramie G-01, silnik dmucha w ścianę tylną
    R.seria = await series('h01-oddokuj', [2.2, 2.6, 2.9, 3.2, 3.4, 3.55, 3.75, 4.0, 4.5, 5.2, 6.2], async (t) => {
      if (args.sonda && (Math.abs(t - 2.9) < 1e-6 || Math.abs(t - 3.2) < 1e-6)) {
        const p = await ev(PROBE);
        (R.sonda ||= {})[t] = p;
        console.log('SONDA', t, JSON.stringify(p));
      }
      if (Math.abs(t - 3.2) < 1e-6 || Math.abs(t - 4.5) < 1e-6) {
        // A/B tej samej klatki: bez przeszkód gazu (ściana tylna hali), bez pyłu hal
        await ev(`(async () => { window.__explosions.tune.obstacles = false; await window.__harness.frames(2); return true; })()`);
        await sleep(60); await screenshotPng(cdp, join(out, `h01-oddokuj-${String(t).replace('.', '_')}-bezPrzeszkod.png`));
        await ev(`(async () => { window.__explosions.tune.obstacles = true; window.HallDustTune.enabled = false; await window.__harness.frames(2); return true; })()`);
        await sleep(60); await screenshotPng(cdp, join(out, `h01-oddokuj-${String(t).replace('.', '_')}-bezPylu.png`));
        await ev(`(async () => { window.HallDustTune.enabled = true; await window.__harness.frames(1); return true; })()`);
      }
    });
    await keyEv('keyDown', 'w', 'KeyW', 87);
    R.wylot = await series('h02-W', [0.5, 1.5, 3.0]);
    await keyEv('keyUp', 'w', 'KeyW', 87);
    R.pipeline = await pipesSince(R.k0);
    console.log('hala pipeline', JSON.stringify(R.pipeline));
    report.hala = R;
    await unfreeze();
  }

  if (tryby.includes('wodowanie')) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n(() => { try {
      localStorage.setItem('sc_story_campaign', '1'); localStorage.setItem('sc_story_tutorial', '0'); } catch {} })();\n${INJECT}` });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=defences` });
    await waitFor(cdp, '!!window.__harness', 60000, 100);
    await ev('(() => { window.__harness.clock.mode = "real"; return true; })()');
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
    await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
    await sleep(1000);
    await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
    await sleep(700);
    await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, "window.StoryGame.active && window.StoryGame.phase === 'defences' && !!window.StoryGame.site?.parkedList?.length", 300000, 400)) throw new Error('faza defences nie ruszyła');
    await sleep(1500);
    const R = {};
    R.start = await ev(`(() => {
      window.setFogOfWar?.(false);
      window.__godTimer = setInterval(() => { const s = window.ship; if (s?.hull) s.hull.val = s.hull.max; if (s?.shield) s.shield.val = s.shield.max; }, 100);
      const L = window.StoryGame.site.parkedList.map((e) => ({ k: e.__storyKey, st: e.engineIgn?.state, berth: e.__dockBerth }));
      return L;
    })()`);
    console.log('parking', JSON.stringify(R.start));
    await freeze();
    // Gracz poza parkingiem (nie taranuje): przy wierzchołku osi trzonu; zegar wodowania do pierwszego zapłonu
    const k0 = await frameK();
    let e = null;
    for (let i = 0; i < 80 && !e; i++) {
      await ev('window.__harness.step(60)');
      e = await ev(`(() => { const L = window.StoryGame.site.parkedList.concat(window.StoryGame.site.slipList || []);
        const q = L.find((n) => !n.dead && n.engineIgn && n.engineIgn.state === 1); if (!q) return null; window.__wodE = q;
        return { x: q.x, y: q.y, k: q.__storyKey, t: q.engineIgn.t }; })()`);
    }
    R.okret = e;
    if (e) {
      await camAt(e.x, e.y, Number(args.zoomWod || 0.3));
      R.seria = await series('w01-zaplon', [0.05, 0.5, 1.0, 1.3, 1.8, 2.6, 4.0, 6.0], async () => {
        await ev(`(() => { const q = window.__wodE; const c = window.camera; c.x = c.targetX = q.x; c.y = c.targetY = q.y; window.DevScene?.syncCamera?.(); return true; })()`);
      });
    }
    R.pipeline = await pipesSince(k0);
    console.log('wodowanie pipeline', JSON.stringify(R.pipeline));
    report.wodowanie = R;
    await unfreeze();
  }

  if (tryby.includes('koszt')) {
    const P0 = tryby.includes('pustka') ? await ev('({ x: window.ship.pos.x, y: window.ship.pos.y })') : await startFree();
    await unfreeze();
    const k0 = await frameK();
    const sx = P0.x + 600000, sy = P0.y + 200000;
    await ev(`(async () => {
      const m = await import('/src/game/engineIgnition.js');
      window.DevScene.teleport(${sx}, ${sy}, 0); window.ship.vel.x = 0; window.ship.vel.y = 0;
      window.__kE = [window.ship];
      for (const [key, mode, dx, dy] of [['battleship', 'friendly', 1200, 2600], ['pirate_battleship', 'pirate', 1400, -2600], ['destroyer', 'friendly', -2400, 0]]) {
        const r = window.spawnCallInShip(key, { mode, spawnPos: { x: ${sx} + dx, y: ${sy} + dy }, pos: { x: ${sx} + dx, y: ${sy} + dy }, spawnAngle: 0 });
        const e = Array.isArray(r) ? r[0] : r; if (e) { e.ai = () => {}; e.__fogVisible = true; window.__kE.push(e); }
      }
      window.__kM = m;
      return window.__kE.length;
    })()`);
    await camAt(sx, sy, 0.3);
    await sleep(4000);
    const seg = (on) => ev(`(async () => {
      const X = window.__explosions, C = window.Core3D, m = window.__kM;
      X.tune.engineGas = ${on};
      const s0 = { ...X.stats };
      const dts = [], gpu = []; let last = performance.now(); const t0 = last; let n = 0, dom = 0, cpu = 0, eg = 0, cyc = -1;
      while (performance.now() - t0 < 8000) {
        await new Promise((r) => requestAnimationFrame(r));
        const now = performance.now(); dts.push(now - last); last = now; n++;
        // cykl 4 s: zapłon z wyłączonych (0 s), gaszenie (2,6 s)
        const c = Math.floor((now - t0) / 4000), ph = ((now - t0) % 4000) / 1000;
        if (c !== cyc) { cyc = c; for (const e of window.__kE) { m.setEngineState(e, m.ENGINE_OFF); m.igniteEngine(e); } }
        if (ph > 2.6) for (const e of window.__kE) if (e.engineIgn?.state === m.ENGINE_RUNNING) m.shutdownEngine(e);
        if (C.gpuFrameMs > 0) gpu.push(C.gpuFrameMs);
        dom = Math.max(dom, X.grid.stats.active); eg = Math.max(eg, X.stats.engDomains); cpu += X.stats.cpuMs;
      }
      const d = (k) => (X.stats[k] || 0) - (s0[k] || 0);
      dts.sort((a, b) => a - b); gpu.sort((a, b) => a - b);
      const q = (a, p) => a.length ? +a[Math.min(a.length - 1, Math.floor(p * a.length))].toFixed(3) : null;
      return { gaz: ${on}, klatki: n, sredniaMs: +(dts.reduce((a, b) => a + b, 0) / n).toFixed(3), p95: q(dts, 0.95), najgorszaMs: +dts[dts.length - 1].toFixed(1),
        gpuMed: q(gpu, 0.5), gpuP95: q(gpu, 0.95), cpuKrokuSr: +(cpu / n).toFixed(3), domenyMax: dom, engMax: eg,
        sekwencje: d('engSeq'), zGazem: d('engGas'), bezDomeny: d('engNoSlot'), zaMale: d('engSmall') };
    })()`, 120000);
    const L = [];
    for (const on of [true, false, false, true, true, false, false, true]) { const r = await seg(on); L.push(r); console.log('koszt', JSON.stringify(r)); }
    const sum = (on) => { const A = L.filter((r) => r.gaz === on); const a = (k) => +(A.reduce((p, r) => p + (r[k] || 0), 0) / A.length).toFixed(3);
      return { sredniaMs: a('sredniaMs'), p95: a('p95'), najgorszaMs: Math.max(...A.map((r) => r.najgorszaMs)), gpuMed: a('gpuMed'), gpuP95: a('gpuP95'),
        cpuKrokuSr: a('cpuKrokuSr'), engMax: Math.max(...A.map((r) => r.engMax)), zGazem: A.reduce((p, r) => p + r.zGazem, 0), bezDomeny: A.reduce((p, r) => p + r.bezDomeny, 0) }; };
    report.koszt = { odcinki: L, z: sum(true), bez: sum(false), pipeline: await pipesSince(k0) };
    console.log('KOSZT z gazem', JSON.stringify(report.koszt.z));
    console.log('KOSZT bez gazu', JSON.stringify(report.koszt.bez));
    console.log('koszt pipeline', JSON.stringify(report.koszt.pipeline));
    await ev('(() => { window.__explosions.tune.engineGas = true; return true; })()');
  }
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  console.error(err);
  report.logi = logs.all().slice(-60);
} finally {
  try { report.tslUuid = await ev('(() => { const u = window.Core3D?.tslUuid; return u ? { kolizje: u.kolizje } : null; })()'); console.log('tslUuid', JSON.stringify(report.tslUuid)); } catch { /* strona padła */ }
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference|Unable to decode audio|AudioSys/.test(l)).slice(0, 60);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.slice(0, 20).join('\n'));
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
