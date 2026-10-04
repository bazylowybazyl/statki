import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAMERA_RIG_DEFAULTS,
  CAMERA_RIG_RANGES,
  createCameraRig,
  createCameraRigTune,
  stepCameraRig,
  noteCameraRigCombat,
  cameraLookMagnitude,
  defaultShipZoom,
  cameraShakeAmplitudePx,
  sampleCameraShakePx,
  normalizeCameraLookMode,
  stepCameraRigWarp,
  noteCameraRigWarp,
  cameraWarpPulse,
  CAMERA_WARP_PULSES,
  normalizeCameraWarpKickMode
} from '../src/game/cameraRig.js';
import { stepCameraZoom, cameraZoomBase } from '../src/game/cameraZoom.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

const W = 1920;
const H = 1080;
const VMAX = 10000;
const tune = createCameraRigTune();

function input(over = {}) {
  return {
    dt: 1 / 144,
    viewW: W,
    viewH: H,
    mouseX: W / 2,
    mouseY: H / 2,
    lookFrozen: false,
    lookEnabled: true,
    velX: 0,
    velY: 0,
    maxSpeed: VMAX,
    mode: 'auto',
    ...over
  };
}

function settle(rig, over = {}, seconds = 4, dt = 1 / 144) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) stepCameraRig(rig, input({ dt, ...over }), tune);
  return rig;
}

// Środek statku na ekranie = środek kadru − offset (kamera jest przed statkiem).
function shipScreen(rig) {
  return { x: W / 2 - rig.offsetX, y: H / 2 - rig.offsetY };
}

test('nawigacja: kursor nie rusza kamerą — świat stoi pod wskaźnikiem', () => {
  const rig = createCameraRig();
  for (const [mx, my] of [[0, 0], [W, 0], [W, H], [0, H], [W * 0.8, H * 0.3]]) {
    settle(rig, { mouseX: mx, mouseY: my }, 1);
    assert.ok(Math.abs(rig.offsetX) < 1e-6 && Math.abs(rig.offsetY) < 1e-6, `kursor (${mx}, ${my})`);
  }
  assert.equal(rig.combat, 0);
});

test('nawigacja: wyprzedzenie lotu — statek ~⅓ ekranu od tylnej krawędzi przy v_max', () => {
  const rig = settle(createCameraRig(), { velX: VMAX }, 6);
  const s = shipScreen(rig);
  const full = (1 - Math.exp(-1 / tune.leadSpeedRef)) * tune.navLead * W / 2;
  assert.ok(Math.abs(rig.offsetX - full) < 0.5, `offset ${rig.offsetX} vs ${full}`);
  assert.ok(s.x / W > 0.3 && s.x / W < 0.35, `statek na ${(s.x / W * 100).toFixed(1)}% szerokości`);
  // W pionie ta sama część pół ekranu (elipsa kadru), nie ułamek szerokości.
  const up = settle(createCameraRig(), { velY: -VMAX * 3 }, 6);
  assert.ok(Math.abs(up.offsetY + tune.navLead * H / 2) < 0.5, `offset pionowy ${up.offsetY}`);
});

test('nawigacja: wyprzedzenie widać przy zwykłych prędkościach, nie dopiero przy v_max', () => {
  // Atlas po ~6 s pełnego ciągu: ~1400 j/s z v_max 10 000. Liniowo byłoby 14% pełnego.
  const rig = settle(createCameraRig(), { velX: 1400 }, 6);
  const share = rig.offsetX / (tune.navLead * W / 2);
  assert.ok(share > 0.35 && share < 0.6, `${(share * 100).toFixed(0)}% pełnego wyprzedzenia`);
  // Rośnie z prędkością i nie przekracza pełnego.
  const faster = settle(createCameraRig(), { velX: 4000 }, 6);
  assert.ok(faster.offsetX > rig.offsetX && faster.offsetX < tune.navLead * W / 2);
});

test('walka: statek zostaje w kadrze przy każdym położeniu kursora i pełnej prędkości', () => {
  const rig = createCameraRig();
  const margin = tune.frameMargin;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let worst = Infinity;
  for (let i = 0; i < 144 * 20; i++) {
    // Kursor skacze po całym kadrze co klatkę, statek leci w losowym kierunku.
    const a = rnd() * Math.PI * 2;
    stepCameraRig(rig, input({
      mode: 'always',
      mouseX: rnd() * W,
      mouseY: rnd() * H,
      velX: Math.cos(a) * VMAX * 1.5,
      velY: Math.sin(a) * VMAX * 1.5,
      dt: 1 / (30 + rnd() * 200)
    }), tune);
    const s = shipScreen(rig);
    worst = Math.min(worst, s.x / W, 1 - s.x / W, s.y / H, 1 - s.y / H);
  }
  assert.ok(worst >= margin - 1e-9, `najbliżej krawędzi: ${(worst * 100).toFixed(2)}% (margines ${margin * 100}%)`);
});

test('walka: kursor przy krawędzi zagląda na 0,75 pół ekranu, w martwej strefie nic', () => {
  const edge = settle(createCameraRig(), { mode: 'always', mouseX: W, mouseY: H / 2 }, 3);
  assert.ok(Math.abs(edge.offsetX - tune.combatLook * W / 2) < 0.5, `offset ${edge.offsetX}`);
  // Dawniej (×2,0 bez limitu) środek statku lądował tu 960 px ZA lewą krawędzią.
  assert.ok(shipScreen(edge).x > tune.frameMargin * W - 1e-6);

  const dz = tune.lookDeadZone * 0.9;
  const center = settle(createCameraRig(), { mode: 'always', mouseX: W / 2 + dz * W / 2, mouseY: H / 2 }, 2);
  assert.ok(Math.abs(center.offsetX) < 1e-6, 'martwa strefa');
});

test('walka: drżenie ręki (±5 px, 30 Hz) prawie nie rusza kamerą', () => {
  const rig = createCameraRig();
  const base = W * 0.75;
  settle(rig, { mode: 'always', mouseX: base, mouseY: H / 2 }, 3);
  let min = Infinity;
  let max = -Infinity;
  const dt = 1 / 144;
  for (let i = 0; i < 288; i++) {
    const t = i * dt;
    stepCameraRig(rig, input({ dt, mode: 'always', mouseX: base + 5 * Math.sin(2 * Math.PI * 30 * t), mouseY: H / 2 }), tune);
    min = Math.min(min, rig.offsetX);
    max = Math.max(max, rig.offsetX);
  }
  // Dawniej kamera szła za ręką 1:2 bez filtra — 20 px rozrzutu.
  assert.ok(max - min < 1, `rozrzut offsetu ${(max - min).toFixed(3)} px`);
});

test('zamrożony kursor trzyma punkt patrzenia; odmrożenie rusza płynnie, bez skoku', () => {
  const rig = settle(createCameraRig(), { mode: 'always', mouseX: W * 0.9, mouseY: H * 0.2 }, 3);
  const held = { x: rig.offsetX, y: rig.offsetY };
  // Menu PPM / koło ŚPM / Alt: kursor jedzie na drugi koniec ekranu.
  settle(rig, { mode: 'always', mouseX: W * 0.1, mouseY: H * 0.9, lookFrozen: true }, 1);
  assert.ok(Math.abs(rig.offsetX - held.x) < 0.01 && Math.abs(rig.offsetY - held.y) < 0.01, 'offset trzymany');
  // Odmrożenie z kursorem na drugim końcu (~1300 px drogi): pierwsza klatka to
  // ułamek drogi. Dawniej Alt zerował offset w jednej klatce — skok o setki px.
  const before = rig.offsetX;
  stepCameraRig(rig, input({ mode: 'always', mouseX: W * 0.1, mouseY: H * 0.9 }), tune);
  assert.ok(Math.abs(rig.offsetX - before) < 3, `pierwsza klatka po odmrożeniu: ${(rig.offsetX - before).toFixed(2)} px`);
});

test('krok niezależny od FPS i nierównych klatek', () => {
  const run = (dts) => {
    const rig = createCameraRig();
    for (const dt of dts) stepCameraRig(rig, input({ dt, mode: 'never', velX: VMAX, velY: -VMAX * 0.4 }), tune);
    return rig;
  };
  const steps = (dt, n) => Array.from({ length: n }, () => dt);
  const a = run(steps(1 / 60, 30));
  const b = run(steps(1 / 144, 72));
  const uneven = [0.033, 0.004, 0.021, 0.0069, 0.012, 0.033, 0.0011, 0.017];
  const c = run([...uneven, 0.5 - uneven.reduce((s, x) => s + x, 0)]);
  for (const r of [b, c]) {
    assert.ok(Math.abs(r.offsetX - a.offsetX) < 1e-6 && Math.abs(r.offsetY - a.offsetY) < 1e-6,
      `${r.offsetX} vs ${a.offsetX}`);
  }
  assert.ok(a.offsetX > 0 && a.offsetX < tune.navLead * W / 2, 'po 0,5 s jeszcze w drodze');
});

test('postawa walki: sygnał trzyma ją combatHold s, pauza nie odlicza', () => {
  const rig = createCameraRig();
  const dt = 1 / 144;
  noteCameraRigCombat(rig, tune, 'strzał');
  assert.equal(rig.combatReason, 'strzał');
  settle(rig, { holdDt: dt }, tune.combatEnterTime + 0.05, dt);
  assert.equal(rig.combat, 1, 'po czasie wejścia pełna walka');
  // Pauza: klatki lecą, czas gry stoi — walka zostaje.
  settle(rig, { holdDt: 0 }, 20, dt);
  assert.equal(rig.combat, 1);
  // Bez sygnałów: trzymanie, potem wyjście.
  settle(rig, { holdDt: dt }, tune.combatHold - tune.combatEnterTime - 0.2, dt);
  assert.equal(rig.combat, 1, 'jeszcze w oknie trzymania');
  settle(rig, { holdDt: dt }, 0.2 + tune.combatExitTime + 0.05, dt);
  assert.equal(rig.combat, 0, 'wróciła nawigacja');
});

test('opcja kamery: Zawsze / Nigdy ignorują sygnały, nieznana = Auto', () => {
  const always = settle(createCameraRig(), { mode: 'always' }, 1);
  assert.equal(always.combat, 1);
  const never = createCameraRig();
  noteCameraRigCombat(never, tune, 'trafienie');
  settle(never, { mode: 'never', mouseX: W, mouseY: H }, 1);
  assert.equal(never.combat, 0);
  assert.ok(Math.abs(never.offsetX) < 1e-6, 'Nigdy: kursor nie rusza kamerą mimo walki');
  assert.equal(normalizeCameraLookMode('bzdura'), 'auto');
  assert.equal(normalizeCameraLookMode('never'), 'never');
});

test('split-screen: kursor wyłączony, wyprzedzenie zostaje', () => {
  const rig = settle(createCameraRig(), { mode: 'always', lookEnabled: false, mouseX: W, velX: VMAX * 3 }, 3);
  assert.ok(Math.abs(rig.offsetX - tune.combatLead * W / 2) < 0.5);
});

test('krzywa kursora, zoom startowy i strojenie w zakresach', () => {
  assert.equal(cameraLookMagnitude(0.1, 0.12, 1.2), 0);
  assert.equal(cameraLookMagnitude(1, 0.12, 1.2), 1);
  assert.ok(cameraLookMagnitude(0.5, 0.12, 1) > cameraLookMagnitude(0.5, 0.12, 1.5));
  // Atlas: 1800 j. na 20% z 1920 px.
  assert.ok(Math.abs(defaultShipZoom(1920, 1800, tune) - 0.2133) < 1e-3);
  assert.equal(defaultShipZoom(1920, 10, tune), 3.2);
  const t = createCameraRigTune({ combatLook: 99, navOmega: 'x', nieznane: 1 });
  assert.equal(t.combatLook, CAMERA_RIG_RANGES.combatLook[1]);
  assert.equal(t.navOmega, CAMERA_RIG_DEFAULTS.navOmega);
  assert.equal('nieznane' in t, false);
  for (const key of Object.keys(CAMERA_RIG_DEFAULTS)) {
    const [min, max] = CAMERA_RIG_RANGES[key];
    assert.ok(CAMERA_RIG_DEFAULTS[key] >= min && CAMERA_RIG_DEFAULTS[key] <= max, key);
  }
});

test('wstrząs: w px z sufitem, gładki w czasie', () => {
  assert.equal(cameraShakeAmplitudePx(18, 0, tune), 18 * tune.shakeScale);
  assert.equal(cameraShakeAmplitudePx(1000, 1000, tune), tune.shakeMaxPx);
  const out = { x: 0, y: 0 };
  let prev = null;
  let worstStep = 0;
  for (let i = 0; i < 1000; i++) {
    sampleCameraShakePx(10, i / 1000, tune, out);
    assert.ok(Math.abs(out.x) <= 10 + 1e-9 && Math.abs(out.y) <= 10 + 1e-9);
    if (prev) worstStep = Math.max(worstStep, Math.abs(out.x - prev.x), Math.abs(out.y - prev.y));
    prev = { ...out };
  }
  // Biały szum skakał o pełną amplitudę między klatkami.
  assert.ok(worstStep < 2, `największy krok w 1 ms: ${worstStep.toFixed(3)} px`);
  sampleCameraShakePx(0, 1, tune, out);
  assert.deepEqual(out, { x: 0, y: 0 });
});

// --- Kop warpa (zadanie 22-B, demo „Nurt”: dema/warp-webgpu/scenes.js — createTripScene) ---

const Z_PLAYER = 0.2;
const smoothDemo = (x) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const peakOf = (rise, fall) => cameraWarpPulse(rise * Math.log((rise + fall) / rise), rise, fall);

// Klatki gry jak loop() / render(): kop (czas gry) → sprężyna zoomu z członem → rig. Automat
// warpa gracza uproszczony: ładowanie `ct` s od `t0`, skok (engageWarp → 'kick'), `warpLen` s
// lotu, wyjście (exitWarp → 'exit'). Statek stoi (bez wyprzedzenia) — offset riga = sam kop.
function warpFlight(o = {}) {
  const dt = o.dt ?? 1 / 144;
  const t0 = o.t0 ?? 0.3;
  const ct = o.ct ?? 0.8;
  const warpLen = o.warpLen ?? 3;
  const tail = o.tail ?? 5;
  const abortAt = o.abortAt ?? Infinity;       // przerwane ładowanie (ułamek)
  const heading = o.heading ?? 0;
  const enabled = o.enabled || (() => true);
  const paused = o.paused || (() => false);
  const rig = createCameraRig();
  const cam = { zoom: Z_PLAYER, targetZoom: Z_PLAYER, minZoom: 0.035, maxZoom: 3.2, zoomVel: 0 };
  const wIn = { dt, state: 'idle', charge: 0, dirX: Math.cos(heading), dirY: Math.sin(heading), enabled: true };
  let state = 'idle';
  let charge = 0;
  let t = 0;
  let kickAt = null;
  let exitAt = null;
  const frames = Math.round((t0 + ct + warpLen + tail) / dt);
  for (let i = 0; i < frames; i++) {
    const p = paused(t, kickAt, exitAt);
    const gdt = p ? 0 : dt;
    if (!p) {
      t += dt;
      if (state === 'idle' && charge === 0 && kickAt === null && t >= t0) state = 'charging';
      if (state === 'charging') {
        charge += dt;
        if (charge / ct >= abortAt) { state = 'idle'; }
        else if (charge >= ct - 1e-9) { state = 'active'; kickAt = t; noteCameraRigWarp(rig, 'kick'); }
      } else if (state === 'active' && t - kickAt >= warpLen - 1e-9) {
        state = 'idle'; exitAt = t; noteCameraRigWarp(rig, 'exit');
      }
    }
    wIn.dt = gdt;
    wIn.state = state;
    wIn.charge = state === 'charging' ? charge / ct : 0;
    wIn.enabled = enabled(t, kickAt, exitAt);
    stepCameraRigWarp(rig, wIn, tune);
    cam.zoomImpulseLog = rig.warpZoomLog;
    if (o.playerZoom) { const z = o.playerZoom(t, kickAt); if (z) cam.targetZoom = z; }
    stepCameraZoom(cam, dt);
    stepCameraRig(rig, input({ dt, holdDt: gdt, viewH: o.viewH ?? H, mode: o.mode ?? 'never', mouseX: o.mouseX ?? W / 2 }), tune);
    if (o.onFrame) o.onFrame({ t, kickAt, exitAt, rig, cam, state, charge: charge / ct, paused: p });
  }
  return { rig, cam };
}

test('kop warpa: przy skoku statek wyrywa się do przodu (140 px × impuls 0,05 / 0,42 s — szczyt ~96 px po 0,11 s) i kamera go dogania', () => {
  for (const [dt, heading] of [[1 / 144, 0], [1 / 60, 2.0], [1 / 240, -0.7]]) {
    let peak = 0;
    let peakAge = 0;
    let after = 0;
    warpFlight({
      dt, heading, onFrame: ({ rig }) => {
        const age = rig.warpKickAge;
        if (!(age > 0)) return;
        // Statek na ekranie = środek − offset: wzdłuż kursu przed środkiem o cofnięcie kamery.
        const ahead = -(rig.offsetX * Math.cos(heading) + rig.offsetY * Math.sin(heading));
        const side = -rig.offsetX * Math.sin(heading) + rig.offsetY * Math.cos(heading);
        assert.ok(Math.abs(side) < 1e-6, 'kop tylko wzdłuż kursu');
        assert.ok(Math.abs(ahead - 140 * cameraWarpPulse(age, CAMERA_WARP_PULSES.lagRise, CAMERA_WARP_PULSES.lagFall)) < 1e-6,
          `wiek ${age.toFixed(3)} s: ${ahead}`);
        if (ahead > peak) { peak = ahead; peakAge = age; }
        if (age > 2 && age < 2.02) after = ahead;
      }
    });
    assert.ok(Math.abs(peak - 140 * peakOf(0.05, 0.42)) < 1.5, `szczyt ${peak.toFixed(1)} px (${dt})`);
    assert.ok(Math.abs(peak - 95.8) < 1.5 && Math.abs(peakAge - 0.112) <= dt, `szczyt ${peak.toFixed(1)} px po ${peakAge.toFixed(3)} s`);
    assert.ok(after < 1.5, 'po 2 s kamera dogoniła statek');
  }
});

test('kop warpa: zoom jak w demie — ładowanie ×0,55, skok −10%, wyjście +10% i powrót w 1,4 s; potem dokładnie zoom gracza', () => {
  const at = {};
  const mark = (key, z) => { if (!(key in at)) at[key] = z; };
  let worstStep = 0;
  let prevLog = Math.log(Z_PLAYER);
  let minKick = Infinity;
  const { cam, rig } = warpFlight({
    onFrame: ({ t, kickAt, exitAt, cam: c, state, charge, rig: r }) => {
      const f = c.zoom / Z_PLAYER;
      assert.equal(c.targetZoom, Z_PLAYER, 'targetZoom gracza nietknięty');
      assert.ok(Math.abs(cameraZoomBase(c) - Z_PLAYER) < 1e-12, 'zoom gracza (stan sprężyny) nietknięty');
      const lz = Math.log(c.zoom);
      worstStep = Math.max(worstStep, Math.abs(lz - prevLog));
      prevLog = lz;
      if (state === 'charging' && charge >= 0.5) mark('c50', { f, charge });
      if (kickAt !== null && exitAt === null) {
        minKick = Math.min(minKick, f);
        if (t - kickAt >= 2) mark('lot', { f });
      }
      if (exitAt !== null) {
        // Wiek impulsu wyjścia: pierwsza klatka po zdarzeniu ma już dt (wyjście w krokach fizyki tej klatki).
        const a = r.warpExitAge;
        if (a >= 0.2) mark('e02', { f, a });
        if (a >= 0.5) mark('e05', { f, a });
        if (a >= 1.4) mark('e14', { f, a });
      }
    }
  });
  const lerp = (a, b, x) => a + (b - a) * x;
  const easeOut3 = (x) => 1 - (1 - Math.min(1, x)) ** 3;
  // Ładowanie: lerp(1, 0,55, smoothstep(ładowanie)) — po ułamku ładowania (0,8 s gry, 3 s dema).
  assert.ok(Math.abs(at.c50.f - lerp(1, 0.55, smoothDemo(at.c50.charge))) < 2e-3, `ładowanie 50%: ×${at.c50.f}`);
  // Skok: 0,55 · (1 − 0,1 · impuls(0,04 / 0,25)) — dno ×0,5155.
  assert.ok(Math.abs(minKick - 0.55 * (1 - 0.1 * peakOf(0.04, 0.25))) < 2e-3, `dno przy skoku ×${minKick}`);
  assert.ok(Math.abs(at.lot.f - 0.55) < 1e-4, `w locie ×${at.lot.f}`);
  // Wyjście: lerp(0,55, 1, easeOut³(t / 1,4)) · (1 + 0,1 · impuls(0,03 / 0,18)).
  for (const k of ['e02', 'e05', 'e14']) {
    const { f, a } = at[k];
    const demo = lerp(0.55, 1, easeOut3(a / 1.4)) * (1 + 0.1 * cameraWarpPulse(a, 0.03, 0.18));
    assert.ok(Math.abs(f - demo) < 3e-3, `${k}: ×${f} vs demo ×${demo}`);
  }
  // Bez szarpnięć: najwyżej ~0,03 log(zoom) na klatkę 144 Hz (ząbek kółka to 0,2 rozłożone na ~0,3 s).
  assert.ok(worstStep < 0.04, `największy krok zoomu na klatkę: ${worstStep.toFixed(4)}`);
  // Po impulsach: dokładnie zoom gracza, człon zerowy, stan riga w spoczynku.
  assert.equal(cam.zoom, Z_PLAYER);
  assert.equal(rig.warpZoomLog, 0);
  assert.equal(rig.warpHold, 1);
  assert.equal(rig.offsetX, 0);
});

test('kop warpa: drżenie w drugiej połowie ładowania (4 px · smoothstep), potem wstrząsy z camera.addShake', () => {
  const seen = [];
  warpFlight({ onFrame: ({ rig, state, charge }) => { if (state === 'charging') seen.push([charge, rig.warpShakePx]); else assert.equal(rig.warpShakePx, 0); } });
  for (const [c, px] of seen) {
    const want = 4 * smoothDemo((c - 0.5) / 0.5);
    assert.ok(Math.abs(px - want) < 1e-9, `ładowanie ${c.toFixed(2)}: ${px}`);
  }
  assert.ok(seen.some(([c]) => c < 0.5) && seen.some(([, px]) => px > 3.5));
  // Amplituda wstrząsu: px wprost, pod tym samym sufitem.
  assert.equal(cameraShakeAmplitudePx(0, 0, tune, 4), 4);
  assert.equal(cameraShakeAmplitudePx(18, 0, tune, 4), 18 * tune.shakeScale + 4);
  assert.equal(cameraShakeAmplitudePx(1000, 0, tune, 4), tune.shakeMaxPx);
});

test('kop warpa: opcja „Wył.” — zdarzenia przepadają, kamera jak bez warpa; wyłączenie w skoku wraca do zoomu gracza bez skoku', () => {
  warpFlight({
    enabled: () => false,
    onFrame: ({ rig, cam }) => {
      assert.equal(cam.zoom, Z_PLAYER);
      assert.equal(rig.offsetX, 0);
      assert.equal(rig.offsetY, 0);
      assert.equal(rig.warpShakePx, 0);
    }
  });
  // Wyłączone 1 s po skoku (opcja w menu, RTS): oddalenie wraca w 1,4 s, bez skoku zoomu
  // (rozpoczęty impuls skoku dobiega końca — po 1 s to już ×0,9998).
  let prevLog = null;
  let worst = 0;
  let offAt = null;
  let back = null;
  let zoomBack = null;
  warpFlight({
    enabled: (t, kickAt) => !(kickAt !== null && t - kickAt >= 1),
    onFrame: ({ t, kickAt, cam, rig }) => {
      const lz = Math.log(cam.zoom);
      if (prevLog !== null) worst = Math.max(worst, Math.abs(lz - prevLog));
      prevLog = lz;
      if (kickAt !== null && t - kickAt >= 1 && offAt === null) offAt = t;
      if (offAt !== null && back === null && rig.warpHold === 1) { back = t - offAt; zoomBack = cam.zoom; }
    }
  });
  assert.ok(worst < 0.04, `największy krok zoomu: ${worst.toFixed(4)}`);
  assert.ok(back !== null && back <= 1.4 + 1 / 144 + 1e-9 && back > 1.3, `oddalenie wróciło po ${back} s`);
  assert.ok(Math.abs(zoomBack / Z_PLAYER - 1) < 1e-4, `zoom po powrocie ×${zoomBack / Z_PLAYER}`);
  assert.equal(normalizeCameraWarpKickMode('off'), 'off');
  assert.equal(normalizeCameraWarpKickMode('bzdura'), 'on');
  assert.equal(normalizeCameraWarpKickMode(undefined), 'on');
});

test('kop warpa: pauza zatrzymuje oś; przerwane ładowanie wraca bez kopa; zoom gracza zmieniony w skoku zostaje po wyjściu', () => {
  // Pauza 0,05–0,5 s po skoku: wiek impulsu, cofnięcie i zoom stoją.
  let frozen = null;
  warpFlight({
    paused: (t, kickAt) => kickAt !== null && t - kickAt >= 0.05 && t - kickAt < 0.051,
    onFrame: ({ rig, cam, paused }) => {
      if (!paused) { frozen = null; return; }
      if (!frozen) frozen = { age: rig.warpKickAge, lag: rig.warpLagPx, zoom: cam.zoom, off: rig.offsetX };
      else {
        assert.equal(rig.warpKickAge, frozen.age);
        assert.equal(rig.warpLagPx, frozen.lag);
        assert.equal(cam.zoom, frozen.zoom);
        assert.equal(rig.offsetX, frozen.off);
      }
    }
  });
  // Przerwane ładowanie (60%): bez kopa, oddalenie wraca do zoomu gracza.
  const { cam, rig } = warpFlight({ abortAt: 0.6, onFrame: ({ rig: r }) => assert.equal(r.warpLagPx, 0) });
  assert.equal(cam.zoom, Z_PLAYER);
  assert.equal(rig.warpKickAge, -1);
  // Kółko w skoku: nowy zoom gracza 0,4 — w locie 0,4 · 0,55, po wyjściu dokładnie 0,4.
  let mid = null;
  const r2 = warpFlight({
    playerZoom: (t, kickAt) => (kickAt !== null && t - kickAt > 0.5 ? 0.4 : null),
    onFrame: ({ t, kickAt, exitAt, cam: c }) => { if (kickAt !== null && exitAt === null && t - kickAt > 2.5 && mid === null) mid = c.zoom; }
  });
  assert.ok(Math.abs(mid - 0.4 * 0.55) < 1e-6, `w locie ${mid}`);
  assert.equal(r2.cam.zoom, 0.4);
  assert.equal(r2.cam.targetZoom, 0.4);
});

test('kop warpa: kadr — statek nie bliżej krawędzi niż frameMargin mimo kopu; kadr 2160 wierszy — kop ×2', () => {
  // Walka, kursor przy lewej krawędzi (kamera zagląda w lewo do granicy kadru), kurs w prawo:
  // kop cofa kamerę dalej w lewo — suma przycięta do kadru.
  warpFlight({
    mode: 'always', mouseX: 0,
    onFrame: ({ rig }) => {
      const x = W / 2 - rig.offsetX;
      assert.ok(x / W <= 1 - tune.frameMargin + 1e-9, `statek na ${(x / W * 100).toFixed(2)}% szerokości`);
    }
  });
  let peak = 0;
  warpFlight({ viewH: 2160, onFrame: ({ rig }) => { peak = Math.max(peak, -rig.offsetX); } });
  assert.ok(Math.abs(peak - 2 * 140 * peakOf(0.05, 0.42)) < 3, `szczyt przy 2160 wierszach: ${peak.toFixed(1)} px`);
});

test('kop warpa: strojenie w zakresach, zero wyłącza człony', () => {
  const t0 = createCameraRigTune({ warpKickPx: 0, warpZoomOut: 1, warpZoomKick: 0, warpZoomExit: 0, warpChargeShakePx: 0 });
  const rig = createCameraRig();
  const cam = { zoom: Z_PLAYER, targetZoom: Z_PLAYER, minZoom: 0.035, maxZoom: 3.2, zoomVel: 0 };
  const wIn = { dt: 1 / 60, state: 'charging', charge: 0.9, dirX: 1, dirY: 0, enabled: true };
  stepCameraRigWarp(rig, wIn, t0);
  noteCameraRigWarp(rig, 'kick');
  wIn.state = 'active';
  for (let i = 0; i < 30; i++) {
    stepCameraRigWarp(rig, wIn, t0);
    cam.zoomImpulseLog = rig.warpZoomLog;
    stepCameraZoom(cam, 1 / 60);
    assert.equal(cam.zoom, Z_PLAYER);
    assert.equal(rig.warpLagPx, 0);
    assert.equal(rig.warpShakePx, 0);
  }
  const wild = createCameraRigTune({ warpKickPx: 9999, warpZoomOut: 0, warpZoomReturn: -1 });
  assert.equal(wild.warpKickPx, CAMERA_RIG_RANGES.warpKickPx[1]);
  assert.equal(wild.warpZoomOut, CAMERA_RIG_RANGES.warpZoomOut[0]);
  assert.equal(wild.warpZoomReturn, CAMERA_RIG_RANGES.warpZoomReturn[0]);
});

// --- index.html ---

const html = readIndexHtml();

test('kop warpa w grze: zdarzenia z automatu (skok, wyjście), krok przed zoomem w czasie gry, człon zoomu, drżenie, opcja', () => {
  // Rozgrywka tylko zgłasza zdarzenie — jak sygnały walki (noteCameraRigCombat).
  const engage = sliceFunction(html, 'function engageWarp(dirToMouse) {');
  assert.match(engage, /warp\.state = 'active';[\s\S]*noteCameraRigWarp\(cameraRig, 'kick'\);/);
  // Wyjście = rampa przylotu (warpDrive.js): impuls zoomu przy wyjściu bez rampy (hamowanie
  // grawitacyjne) i na początku hamowania rampy (physicsStep).
  const exit = sliceFunction(html, 'function exitWarp(opts) {');
  assert.match(exit, /createWarpExitRamp\(/);
  assert.match(exit, /if \(abrupt\) \{[\s\S]*?noteCameraRigWarp\(cameraRig, 'exit'\);/);
  assert.match(html, /if \(!wasBrake && r\.age >= r\.tBrake\) \{[\s\S]*?noteCameraRigWarp\(cameraRig, 'exit'\);/);
  // Raz na klatkę renderu, przed zoomem; w pauzie czas gry 0 (oś stoi).
  const loop = sliceFunction(html, 'function loop(now) {');
  assert.match(loop, /if \(PAUSED(?: \|\| StoryGame\.worldFrozen)?\) \{[\s\S]*?updateCameraWarpKick\(0\);\s*updateCameraZoom\(frame\);/);
  assert.match(loop, /updateCameraWarpKick\(frame\);\s*updateCameraZoom\(frame\);[\s\S]*?render\(alpha, frame\);/);
  const kick = sliceFunction(html, 'function updateCameraWarpKick(gameDt) {');
  assert.match(kick, /stepCameraRigWarp\(cameraRig, w, cameraRigTune\);/);
  assert.match(kick, /camera\.zoomImpulseLog = cameraRig\.warpZoomLog;/);
  assert.match(kick, /normalizeCameraWarpKickMode\(OPTIONS\.cameraWarpKick\) === 'on'\s*&& camera\.mode === 'ship'/);
  // Nie pisze zoomu ani celu gracza wprost (zoom goni sprężyna, cel ustawia gracz).
  assert.doesNotMatch(kick, /camera\.zoom =|targetZoom =/);
  // Drżenie ładowania pod sufitem wstrząsu; RTS bierze zoom gracza bez kopu.
  const render = sliceFunction(html, 'function render(alpha, frameDt) {');
  assert.match(render, /cameraShakeAmplitudePx\(addShakeMag, weaponShakeMag, cameraRigTune, cameraRig\.warpShakePx\)/);
  assert.match(html, /enterRtsMode\(\) \{[\s\S]{0,400}?this\.targetZoom = cameraZoomBase\(this\);/);
  // Opcja w menu (Sterowanie) i zapis.
  assert.match(html, /data-camera-warp-kick="on"/);
  assert.match(html, /data-camera-warp-kick="off"/);
  assert.match(html, /localStorage\.setItem\('sc_camera_warp_kick', mode\)/);
  assert.match(html, /cameraWarpKick: 'on'/);
});

test('kop warpa w grze: updateCameraWarpKick czyta automat, kurs i opcję; poza kamerą statku zdarzenia przepadają', () => {
  const rig = createCameraRig();
  const scope = {
    _cameraWarpInput: { dt: 0, state: 'idle', charge: 0, dirX: 1, dirY: 0, enabled: true },
    warp: { state: 'charging', charge: 0.4, chargeTime: 0.8, dir: { x: 0, y: -1 } },
    ship: { angle: 1.2, destroyed: false },
    OPTIONS: { cameraWarpKick: 'on' },
    camera: { mode: 'ship', zoomImpulseLog: 0 },
    cameraRig: rig,
    cameraRigTune: tune,
    stepCameraRigWarp,
    normalizeCameraWarpKickMode
  };
  const update = loadIndexFunction(html, 'function updateCameraWarpKick(gameDt) {', 'updateCameraWarpKick', scope);
  for (let i = 0; i < 60; i++) update(1 / 60);
  assert.equal(scope._cameraWarpInput.charge, 0.5);
  assert.ok(Math.abs(scope.camera.zoomImpulseLog - Math.log(1 - 0.45 * smoothDemo(0.5))) < 1e-9, 'człon ładowania');
  assert.equal(rig.warpDirX, 0);
  assert.equal(rig.warpDirY, -1);
  // Skok przy kamerze RTS: zdarzenie przepada, oddalenie wraca do zoomu gracza.
  scope.camera.mode = 'rts';
  scope.warp.state = 'active';
  noteCameraRigWarp(rig, 'kick');
  for (let i = 0; i < 120; i++) update(1 / 60);
  assert.equal(rig.warpKickAge, -1);
  assert.equal(scope.camera.zoomImpulseLog, 0);
  // Bez kursu warpa — kurs z dziobu.
  scope.warp.dir = { x: 0, y: 0 };
  update(1 / 60);
  assert.ok(Math.abs(rig.warpDirX - Math.cos(1.2)) < 1e-12 && Math.abs(rig.warpDirY - Math.sin(1.2)) < 1e-12);
  // Przejście prowadzące zoom (fokus stacji, edytor): kop znika od razu — przejście startuje z zoomu na ekranie.
  scope.camera.mode = 'ship';
  scope.warp.dir = { x: 1, y: 0 };
  for (let i = 0; i < 60; i++) update(1 / 60);
  noteCameraRigWarp(rig, 'kick');
  update(1 / 60);
  update(1 / 60);
  assert.ok(rig.warpKickAge > 0 && rig.warpLagPx > 0 && rig.warpHold < 1);
  scope.camera.mode = 'focus';
  scope.camera.transition = { kind: 'focus' };
  update(1 / 60);
  assert.equal(rig.warpKickAge, -1);
  assert.equal(rig.warpHold, 1);
  assert.equal(rig.warpLagPx, 0);
  assert.equal(scope.camera.zoomImpulseLog, 0);
});

test('render: kamera statku z riga, bez dawnego ×2,0 za kursorem', () => {
  const render = sliceFunction(html, 'function render(alpha, frameDt) {');
  assert.doesNotMatch(render, /lookAheadFactor/);
  assert.match(render, /stepCameraRig\(cameraRig, rigIn, cameraRigTune\)/);
  assert.match(render, /rigIn\.lookFrozen = isCameraLookFrozen\(\);/);
  assert.match(render, /rigIn\.holdDt = PAUSED \? 0 : \(frameDt \|\| 0\);/);
  // Przejście do statku goni żywy cel riga, potem krok przejścia raz na klatkę.
  assert.match(render, /camera\.transition\.targetX = rigX;[\s\S]*?stepCameraTransition\(frameDt \|\| 0\);/);
  const cameraTarget = sliceFunction(html, 'function updateCameraTarget(dt) {');
  assert.doesNotMatch(cameraTarget, /tr\.elapsed/, 'przejścia nie idą w krokach fizyki');
});

test('kursor zamrożony przy menu PPM, kole ŚPM, Alt, tablecie, CIC i poza kanwą', () => {
  const frozen = sliceFunction(html, 'function isCameraLookFrozen() {');
  for (const cond of ['isHudPointerMode()', '!mouse.overCanvas', 'worldCommandMenu.open', 'shipModes.wheel.open', 'stationUI.open', 'CICDisplay.active']) {
    assert.ok(frozen.includes(cond), cond);
  }
});

test('trafienie przełącza postawę, obrażenia spoza walki nie', () => {
  // sliceFunction staje na `{}` domyślnego parametru — wycinek do przypisania na window.
  const dmgAt = html.indexOf('function applyDamageToPlayer(amount, opts = {}) {');
  const dmg = html.slice(dmgAt, html.indexOf('window.applyDamageToPlayer = applyDamageToPlayer;', dmgAt));
  assert.match(dmg, /opts\?\.combat !== false\) noteCameraCombat\(/);
  const integrity = sliceFunction(html, 'function enforceNpcHexIntegrityBalance() {');
  const playerCalls = integrity.match(/applyDamageToPlayer\([^)]*\)/g) || [];
  assert.ok(playerCalls.length >= 2);
  for (const call of playerCalls) assert.match(call, /combat: false/, call);
});

function makeCamera(over = {}) {
  return {
    x: 0, y: 0, zoom: 0.5, targetX: 0, targetY: 0, targetZoom: 0.5,
    minZoom: 0.035, maxZoom: 3.2, mode: 'ship', transition: null, ...over
  };
}

function loadTransition(camera) {
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep01 = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  return loadIndexFunction(html, 'function stepCameraTransition(dt) {', 'stepCameraTransition',
    { camera, lerp, smoothstep01, clamp });
}

test('przejście do statku: goni ruchomy cel, kończy dokładnie na nim, zoomu nie rusza', () => {
  const camera = makeCamera({
    x: 0, y: 0, zoom: 0.3,
    transition: { kind: 'ship', startX: 0, startY: 0, startZoom: 0.3, targetX: 1000, targetY: 0, targetZoom: 2, elapsed: 0, duration: 0.75 }
  });
  const step = loadTransition(camera);
  let targetX = 1000;
  let prevX = camera.x;
  let worstJump = 0;
  const dt = 1 / 144;
  while (camera.transition) {
    // render() przestawia cel co klatkę na statek + offset (statek leci).
    targetX += 3000 * dt;
    camera.transition.targetX = targetX;
    step(dt);
    worstJump = Math.max(worstJump, Math.abs(camera.x - prevX));
    prevX = camera.x;
    assert.equal(camera.zoom, 0.3, 'zoom prowadzi sprężyna, nie przejście');
  }
  assert.equal(camera.x, targetX, 'koniec na żywym celu — następna klatka riga bez skoku');
  assert.ok(worstJump < 60, `największy krok klatki: ${worstJump.toFixed(1)} j.`);
});

test('przejście do fokusu stacji nadal prowadzi zoom, a sprężyna zoomu stoi tylko wtedy', () => {
  const camera = makeCamera({
    mode: 'infrastructure', zoom: 0.3,
    transition: { kind: 'infrastructure', startX: 0, startY: 0, startZoom: 0.3, targetX: 500, targetY: 0, targetZoom: 0.9, elapsed: 0, duration: 0.9 }
  });
  const step = loadTransition(camera);
  step(0.45);
  assert.ok(camera.zoom > 0.3 && camera.zoom < 0.9);
  step(1);
  assert.equal(camera.zoom, 0.9);
  assert.equal(camera.transition, null);

  const zoomFn = sliceFunction(html, 'function updateCameraZoom(dt) {');
  assert.match(zoomFn, /if \(camera\.transition && camera\.transition\.kind !== 'ship'\) \{/);
});

test('powrót z edytora stacji wraca do zoomu gracza, nie do stałego defaultZoom', () => {
  const clearFocus = html.slice(html.indexOf('      clearFocus() {'), html.indexOf('      clearFocus() {') + 900);
  assert.match(clearFocus, /this\.returnZoom/);
  assert.match(html, /focusOnInfrastructure\(station, layout\) \{\s*if \(!station\) return;\s*this\.rememberShipZoom\(\);/);
});
