#!/usr/bin/env node
// scripts/webgpu/warp-soczewka-sym.mjs — SYMULATOR DOWODOWY soczewki świata „podniesiony świat” (DECYZJE M / P / T,
// 2026-10-25). Bez przeglądarki: prawdziwe moduły gry i renderu w Node, krok 60 Hz.
//
//   • fizyka skoku: planWarpCruise / warpTripTuneFor / warpTripTime, warpFlybyFactor (zwolnienie przy ciałach), strefy
//     (pas × 0,8, studnie × 0,3), createWarpExitRamp / sampleWarpExitRamp, ślizg z pędem (k = 3, Atlas), wyjście TRAVEL TO
//     (rampa + ślizg przed końcem odcinka) albo ręczne (swobodny skok);
//   • kamera: stepCameraRigWarp + stepCameraRig (cameraRig.js) — zoom skoku, kop, wyprzedzenie, kadr przylotu — KAMERA
//     GRY z K1 (DECYZJE K1, wpięte w etapie integracji 2026-10-26): przy wyjściu z celem bez wysunięcia statku,
//     wyprzedzenie zostaje, kadr przylotu celu NA TLE z perspektywą (input.arrivalDepthK — warpArrivalFrame.js), trzymanie
//     do końca ślizgu + warpArrivalHold, powrót smoothstep warpArrivalReturn; podłoga zoomu na ekranie — cameraZoom.js
//     (cameraZoomFloor: warpArrivalFloor · zoomRef przy zatrzaśniętym kadrze przylotu, inaczej limit kadłuba 0,035);
//   • oś β: src/render/warpLensPhase.js — stepWarpLensPhase na obiekcie warpa jak w grze (index.html:
//     stepPlayerWarpLensPhase — zegar gry, wiek wyjścia od ramp.t0, ślizg = arriving; stan minimalny — przerwane
//     ładowanie, β wyjścia);
//   • soczewka: src/3d/warp/worldLens.js (WarpWorldLens — ten sam kod co w grze) na rekordach jak planet3d.assets.js
//     (płaszczyzna gry / tło z = −50 000 / słońce z = −60 000, bramka ringu, księżyce w węzłach gry — moonOrbit.js),
//     świat z systemMap.js, smallBodies.js, ringScale.js, haloRingLayout.js. Ringi „Halo” i pierścień Saturna się nie
//     rysują (kontrola kadłuba liczy tarczę z ringiem — rExt).
//
// Scenariusze: S1 Ziemia → Jowisz z Marsem w trawersie, S2 Ziemia → Mars krótki, S3 swobodny skok obok Jowisza,
// S4 Jowisz → Saturn (cel NA TLE, z = −50 000), S5 przerwane ładowanie (S1 do 60% ładowania), S6 Ziemia → Mars z Jowiszem
// w stożku za celem.
//
// Wynik: tory ciał co 0,5 s (środek na ekranie od środka kadru [px, y w dół], promień [px], prędkość [px/s]) i KONTROLE
// (DECYZJE P4 + BRIEF C1–C5 + stożek M4). Kod wyjścia ≠ 0, gdy kontrola nie przejdzie. Kamera bez K1 (dawny wariant
// „dziś”) nie istnieje już w kodzie gry — --k1 przyjmuje tylko „tak” (inne wartości: ostrzeżenie).
//
// Użycie:
//   node scripts/webgpu/warp-soczewka-sym.mjs [--scen S1,S2,S3,S4,S5,S6] [--res 1080,1440] [--k1 oba|tak|nie] [--B 45000]
//     [--tory gl|wszystkie|nie] [--md plik.md] [--json plik.json] [--scisle-dzis] [--origin-ruch] [--wpiecie nowe|dzis]
// Domyślnie: wszystkie scenariusze, obie rozdzielczości, oba warianty kamery, tory dla 1080p z K1, raport na stdout.

import { writeFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, ROOT).href);
const WD = await imp('src/game/warpDrive.js');
const CR = await imp('src/game/cameraRig.js');
const SM = await imp('src/data/systemMap.js');
const SB = await imp('src/data/smallBodies.js');
const RS = await imp('src/3d/ringScale.js');
const HL = await imp('src/3d/haloRing/haloRingLayout.js');
const DM = await imp('src/data/driveModes.js');
const WL = await imp('src/3d/warp/worldLens.js');
const PH = await imp('src/render/warpLensPhase.js');
const WAF = await imp('src/render/warpArrivalFrame.js');
const MO = await imp('src/3d/moonOrbit.js');
const CZ = await imp('src/game/cameraZoom.js');

// ------------------------------------------------------------------------------------------------ argumenty
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes('--' + name);
const SCENS = String(arg('scen', 'S1,S2,S3,S4,S5,S6')).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const RESS = String(arg('res', '1080,1440')).split(',').map((s) => Number(s.trim())).filter((h) => h > 0);
const K1MODE = String(arg('k1', 'tak'));
if (K1MODE !== 'tak') console.warn('[sym] --k1 ' + K1MODE + ': kamera bez K1 nie istnieje już w kodzie gry (cameraRig.js) — liczę K1');
const K1S = [true];
const B_LENS = Number(arg('B', WL.WORLD_LENS_DEFAULTS.B));
const TORY = String(arg('tory', 'gl'));
const MD = arg('md', '');
const JSON_OUT = arg('json', '');
const STRICT_OFF = flag('scisle-dzis');
const ORIGIN_MOVE = flag('origin-ruch');   // A/B: planeta startu „ruchem” (projekt B) zamiast reguły ogólnej
// Wpięcie: 'nowe' — sterownik gry po integracji (warpNurt._commitWorldLens + planet3d.assets.js: oś β z warpLensPhase,
// kotwica, origin, exitSlow, arriving, kropki i słońce); 'dzis' — wpięcie sprzed integracji (informacyjnie): β z dawnego
// player.js lensBeta (0 → 1 w 0,5 s od kopu, wyjście: spadek od ramp.slow do tHalt), bez kotwicy, startu, exitSlow
// i arriving, bez kropek i słońca (kamera — już z K1).
const WIRING = String(arg('wpiecie', 'nowe'));
const DEBUG_T = arg('debug-cel', '') ? String(arg('debug-cel', '')).split(',').map(Number) : null;   // --debug-cel t0,t1

// ------------------------------------------------------------------------------------------------ stałe gry
const deg = Math.PI / 180;
const DT = 1 / 60;
const AU = SM.computeWorldUnitsPerAu(140);
const L_HULL = 1800;            // Atlas: ship.w = 3000 × 0,6 (getHullRenderSize)
const W_HULL = 806;             // Atlas: ship.h (sprite 3747 × 1677)
const V_MAX = 507;              // Atlas: prędkość bojowa (tryb napędu)
const BRAKE = 200;              // Atlas: driveState.brakeAccel — hamowanie ślizgu [j/s²]
const K_EXIT = WD.WARP_EXIT_MOMENTUM.k;
const V_END = K_EXIT * V_MAX;
const SLIDE = (V_END * V_END - V_MAX * V_MAX) / (2 * BRAKE);
const DRIVE = DM.WARP_DRIVES.warp_mk2.speed;  // Atlas: PLAYER_HULL_DRIVE.atlas.warp = 'warp_mk2'
const CHARGE_T = 0.8;           // warp.chargeTime
const ENTRY_T = 0.9;            // warp.entryDuration
const RING_R = RS.RING_PLANET_WORLD_RADII;
const RING_OUT = {};
const WELL = {};
for (const k of Object.keys(RING_R)) {
  const L = HL.computeHaloRingLayout({ id: k, name: k });
  RING_OUT[k] = L.outerRadius;
  WELL[k] = L.outerRadius + 3000 + 9000;       // studnia: ring + port + strefa (index.html: planetOrbitRadii)
}
// Planety bez ringu (index.html: planetOrbitRadii, gałąź bez konfigu): inner = max(2,2 r, r + 1500), outer + 4000, studnia + 6000.
for (const p of SM.buildSystemMap(140, {}).planets) {
  if (WELL[p.id]) continue;
  const inner = Math.max(p.r * 2.2, p.r + 1500);
  WELL[p.id] = inner + 4000 + 6000;
}
const LENS_RING_EXTENT = 8000;  // planet3d.assets.js — bramka ringu
const LENS_GATE_RAMP = 0.3;
const LENS_GATE_OPEN = 0.15;
const PLANET_MUL = 4.5;         // PLANET_SIZE_MULTIPLIER
const SUN_R = 399 * 6;          // r3D × SUN_SIZE_MULTIPLIER
const FOV = 35;                 // Core3D.cameraPersp.fov

const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const hyp = (x, y) => Math.sqrt(x * x + y * y);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '—');

// ------------------------------------------------------------------------------------------------ świat
// Księżyc z bryłą (planet3d.assets.js: DirectMoon) w węźle gry (moonOrbit.js) — rodzic z ringiem: płaszczyzna gry.
function moonBody(tune, parent, parentId) {
  const parentR = RING_R[parentId] || parent.r;
  const node = MO.moonGameNode(tune);
  const rad = MO.moonOrbitRadius(tune, node, parentR);
  const ang = MO.moonStartAngle(tune, node);
  const ringAnchored = !!RING_R[parentId];
  const r = Math.max(900, parentR * tune.sizeRatioToParent * (ringAnchored ? 1 : PLANET_MUL));
  return { id: tune.id || 'moon', kind: 'moon', parentId, x: parent.x + Math.cos(ang) * rad, y: parent.y + Math.sin(ang) * rad,
    r, z: ringAnchored ? 0 : (tune.z ?? MO.MOON_TUNE.z), ringAnchored, rExt: 0, fly: 0 };
}

function buildWorld(angles, smallPos = {}) {
  const map = SM.buildSystemMap(140, { angleFor: (def) => (angles[def.id] ?? 0) });
  const bodies = [];
  const P = {};
  for (const p of map.planets) {
    const ring = RING_R[p.id];
    const r = ring || p.r * PLANET_MUL;
    const b = {
      id: p.id, kind: 'planet', x: Math.cos(p.angle) * p.orbitRadius, y: Math.sin(p.angle) * p.orbitRadius,
      r, z: ring ? 0 : -50000, ring: !!ring, rExt: ring ? RING_OUT[p.id] + 2500 : (p.id === 'saturn' ? r * 1.77 : r), fly: r
    };
    bodies.push(b);
    P[p.id] = b;
  }
  bodies.push({ id: 'sun', kind: 'sun', x: 0, y: 0, r: SUN_R, z: -60000, ring: false, rExt: SUN_R, fly: 0 });
  bodies.push({ ...moonBody(MO.MOON_TUNE, P.earth, 'earth'), id: 'luna' });
  for (const t of MO.JUPITER_MOONS_TUNE) bodies.push(moonBody(t, P.jupiter, 'jupiter'));
  for (const s of SB.SMALL_BODIES) {
    if (s.parentId) continue;
    const pos = smallPos[s.id];
    const orb = s.orbitAU * AU;
    bodies.push({ id: s.id, kind: 'small', x: pos ? pos.x : Math.cos(s.angle) * orb, y: pos ? pos.y : Math.sin(s.angle) * orb,
      r: s.radius, z: 0, rExt: 0, fly: s.radius });
  }
  return { bodies, P };
}

// Punkt na okręgu R w odległości bocznej `lat` od prostej (S0, u), najbliżej `alongPref` wzdłuż niej.
function onOrbitAtLateral(R, S0, u, lat, alongPref) {
  const n = { x: -u.y, y: u.x };
  let best = null;
  for (let i = 0; i < 72000; i++) {
    const a = i / 72000 * 2 * Math.PI;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    const l = (x - S0.x) * n.x + (y - S0.y) * n.y;
    const al = (x - S0.x) * u.x + (y - S0.y) * u.y;
    const err = Math.abs(l - lat) + 0.05 * Math.abs(al - alongPref);
    if (!best || err < best.err) best = { x, y, err };
  }
  return best;
}

const ORB = (id) => SM.SYSTEM_MAP_PLANET_BY_ID[id].orbitAU * AU;

// Kąt ciała od kursu przy starcie [°] (+ w prawo) i odległość [tys. j.] — do tytułów scenariuszy.
function bearingNote(world, id, S0, u) {
  const b = world.bodies.find((q) => q.id === id);
  if (!b) return '';
  const ox = b.x - S0.x;
  const oy = b.y - S0.y;
  const a = ox * u.x + oy * u.y;
  const l = oy * u.x - ox * u.y;
  return `${Math.round(Math.atan2(l, a) / deg)}° od kursu, ${Math.round(hyp(ox, oy) / 1000)} tys. j.`;
}

function legBetween(angles, from, to) {
  const F = { x: Math.cos(angles[from]) * ORB(from), y: Math.sin(angles[from]) * ORB(from) };
  const T = { x: Math.cos(angles[to]) * ORB(to), y: Math.sin(angles[to]) * ORB(to) };
  const D = hyp(T.x - F.x, T.y - F.y);
  const u = { x: (T.x - F.x) / D, y: (T.y - F.y) / D };
  const S0 = { x: F.x + u.x * (WELL[from] + 2000), y: F.y + u.y * (WELL[from] + 2000) };
  const leg = D - (WELL[from] + 2000) - (WELL[to] + 1100);
  return { u, S0, leg };
}

function scenarioS1() {
  const thJ = 61.2 * deg;
  const angles = { mercury: 330 * deg, venus: 200 * deg, earth: 0, mars: 0, jupiter: thJ, saturn: 75 * deg, uranus: 110 * deg, neptune: 300 * deg };
  const { u, S0, leg } = legBetween(angles, 'earth', 'jupiter');
  const mars = onOrbitAtLateral(ORB('mars'), S0, u, -75000, leg * 0.5);
  angles.mars = Math.atan2(mars.y, mars.x);
  const ceres = onOrbitAtLateral(SB.SMALL_BODY_BY_ID.ceres.orbitAU * AU, S0, u, 150000, leg * 0.62);
  const world = buildWorld(angles, { ceres: { x: ceres.x, y: ceres.y } });
  return { name: 'S1', title: `Ziemia → Jowisz (TRAVEL TO), Mars 75 tys. j. w lewo od kursu w połowie, Luna w węźle gry (${bearingNote(world, 'luna', S0, u)}), Ceres 150 tys. w pasie`,
    world, S0, u, leg, target: 'jupiter', origin: 'earth', free: false, flyby: 'mars', flybyLat: 75000 };
}

function scenarioS2(extra = {}) {
  const ER = ORB('earth');
  const MR = ORB('mars');
  const Dw = 400000;
  const thM = Math.acos((ER * ER + MR * MR - Dw * Dw) / (2 * ER * MR));
  const angles = { mercury: 330 * deg, venus: 200 * deg, earth: 0, mars: thM, jupiter: 40 * deg, saturn: 75 * deg, uranus: 110 * deg, neptune: 300 * deg, ...extra };
  const { u, S0, leg } = legBetween(angles, 'earth', 'mars');
  const world = buildWorld(angles);
  return { name: 'S2', title: `Ziemia → Mars krótki (odcinek ${Math.round(leg / 1000)} tys. j.), Luna w węźle gry (${bearingNote(world, 'luna', S0, u)})`,
    world, S0, u, leg, target: 'mars', origin: 'earth', free: false };
}

function scenarioS3() {
  const JR = ORB('jupiter');
  const angles = { mercury: 330 * deg, venus: 200 * deg, earth: 200 * deg, mars: 120 * deg, jupiter: 0, saturn: 75 * deg, uranus: 110 * deg, neptune: 300 * deg };
  const world = buildWorld(angles);
  const u = { x: 0, y: 1 };
  const S0 = { x: JR - 300000, y: -700000 };
  return { name: 'S3', title: 'Swobodny skok przez pas, Jowisz 300 tys. j. z boku w połowie (księżyce w węzłach gry), wyjście ręczne po 1,2 mln j.',
    world, S0, u, leg: 1200000, target: null, origin: null, free: true, flyby: 'jupiter', flybyLat: 300000 };
}

// S4 — cel NA TLE (z = −50 000, bez ringu): kadr przylotu i trzymanie celu w perspektywie (recenzja 2026-10-26, ust. 1).
function scenarioS4() {
  const angles = { mercury: 330 * deg, venus: 200 * deg, earth: 150 * deg, mars: 250 * deg, jupiter: 0, saturn: 30 * deg, uranus: 110 * deg, neptune: 300 * deg };
  const { u, S0, leg } = legBetween(angles, 'jupiter', 'saturn');
  const world = buildWorld(angles);
  return { name: 'S4', title: `Jowisz → Saturn (TRAVEL TO, cel na tle z = −50 000; odcinek ${Math.round(leg / 1000)} tys. j., stop ${Math.round(WELL.saturn + 1100)} j. od środka)`,
    world, S0, u, leg, target: 'saturn', origin: 'jupiter', free: false };
}

// S5 — przerwane ładowanie (nowa trasa, holownik): S1 do 60% ładowania, potem idle (recenzja, ust. 2).
function scenarioS5() {
  const sc = scenarioS1();
  return { ...sc, name: 'S5', title: 'Przerwane ładowanie: S1 do 60% ładowania, potem automat w idle (bez wyjścia)', abortAt: 0.6, flyby: null };
}

// S6 — duże ciało w stożku za celem: Jowisz ~1,4 mln j. za Marsem, ~6° od kursu (recenzja, ust. 3).
function scenarioS6() {
  const base = scenarioS2();
  const jup = onOrbitAtLateral(ORB('jupiter'), base.S0, base.u, 150000, 1.6e6);
  const sc = scenarioS2({ jupiter: Math.atan2(jup.y, jup.x) });
  return { ...sc, name: 'S6', title: `Ziemia → Mars, Jowisz w stożku za celem (${bearingNote(sc.world, 'jupiter', sc.S0, sc.u)})`, coneBody: 'jupiter' };
}
const SCEN_FN = { S1: scenarioS1, S2: scenarioS2, S3: scenarioS3, S4: scenarioS4, S5: scenarioS5, S6: scenarioS6 };

function zoneAt(x, y, sc) {
  const r = hyp(x, y);
  let f = (r > 35.5 * AU && r < 47 * AU) ? 0.8 : 1;
  for (const k of Object.keys(WELL)) {
    const p = sc.world.P[k];
    if (hyp(x - p.x, y - p.y) < WELL[k]) f = 0.3;
  }
  return f;
}

// ------------------------------------------------------------------------------------------------ przebieg
function simulate(sc, H, k1) {
  const W = Math.round(H * 16 / 9);
  const sPx = H / 1080;
  const u = sc.u;
  const course = Math.atan2(u.y, u.x);
  const roll = course + Math.PI / 2;            // kurs w górę ekranu (obrót kadru ustalony — jak projekt C)
  const rc = Math.cos(roll);
  const rs = Math.sin(roll);
  const toScreen = (wx, wy) => [rc * wx + rs * wy, -rs * wx + rc * wy];
  const toWorld = (sx, sy) => [rc * sx - rs * sy, rs * sx + rc * sy];
  const zoomRef = CR.defaultShipZoom(W, L_HULL);
  const focal = (H * 0.5) / Math.tan(FOV * 0.5 * deg);
  const tune = CR.CAMERA_RIG_DEFAULTS;
  const world = sc.world;
  const tgtW = sc.target ? world.P[sc.target] : null;
  const orgW = sc.origin ? world.P[sc.origin] : null;
  const fly = world.bodies.filter((b) => b.fly > 0 && b !== tgtW && b !== orgW).map((b) => ({ x: b.x, y: b.y, r: b.fly }));
  let cruise = DRIVE;
  let plan = null;
  if (!sc.free) {
    const bl = fly.map((b) => { const ox = b.x - sc.S0.x; const oy = b.y - sc.S0.y; return { along: ox * u.x + oy * u.y, lateral: oy * u.x - ox * u.y, r: b.r }; });
    plan = WD.planWarpCruise({ dist: sc.leg, v0: 0, hullLength: L_HULL, bodies: bl, zone: (s) => zoneAt(sc.S0.x + u.x * s, sc.S0.y + u.y * s, sc), entry: ENTRY_T, lag: 6, dt: 1 / 30 }, WD.warpTripTuneFor(DRIVE));
    cruise = plan.speed;
  }
  // Rekordy soczewki (jak planet3d.assets.js).
  const lens = new WL.WarpWorldLens({ B: B_LENS, originMove: ORIGIN_MOVE });
  const today = WIRING === 'dzis';
  const recs = world.bodies.map((b) => {
    const r = WL.newLensBody(b.id, today ? '' : b.kind);
    Object.assign(r, { x: b.x, y: b.y, r: b.r, z: b.z, rExt: today ? 0 : (b.rExt || 0) });
    r.src = b;
    return r;
  });
  const byId = Object.fromEntries(recs.map((r) => [r.id, r]));
  for (const r of recs) r.parent = r.src.parentId ? byId[r.src.parentId] : null;
  const target = tgtW ? byId[tgtW.id] : null;
  const origin = orgW ? byId[orgW.id] : null;
  const ctx = { ...WL.WARP_WORLD_LENS, targetHold: 0 };
  const rig = CR.createCameraRig();
  const track = PH.createWarpLensTrack();   // stan minimalny osi β (strona gry)
  const fill = CR.CAMERA_RIG_DEFAULTS.warpArrivalFill;
  const tgtDepthK = tgtW && tgtW.z !== 0 ? -tgtW.z / focal : 0;   // cel na tle: głębokość / ogniskowa [j./px]
  // Stan skoku
  let t = -CHARGE_T;
  let state = 'charging';
  let s = 0;
  let v = 0;
  let prog = 0;
  let ramp = null;
  let exitT0 = NaN;
  let exitNoted = false;
  let slideOn = false;
  let stopT = NaN;
  let tEnd = Infinity;
  let lensOn = false;
  // obiekt warpa gry dla osi β (index.html: GameState.warp — stan, ładowanie, kickSim, rampa z t0, ślizg)
  const gw = { state: 'charging', charge: 0, chargeTime: CHARGE_T, kickSim: NaN, exitRamp: null, exitSlide: { active: false }, gravityBrake: { active: false } };
  const phase = PH.createWarpLensPhase();
  // camera gry (cameraZoom.js — stepCameraZoom: zoom gracza = zoomRef, człon riga, podłoga kadru przylotu, limit członu)
  const cz = { zoom: zoomRef, targetZoom: zoomRef, zoomBase: zoomRef, _zoomSpringOut: zoomRef, zoomVel: 0, minZoom: 0.035,
    maxZoom: 3.2, zoomImpulseMin: NaN, zoomImpulseLog: 0 };
  const kA = Math.min(1, 6 * DT);
  const frames = [];
  const ev = { kick: 0, exit: NaN, brake: NaN, halt: NaN, stop: NaN, release: NaN, releaseWhy: '' };
  let prevHold = 0;
  while (t < tEnd - 1e-9) {
    // ---- fizyka (krok 60 Hz, jak physicsStep)
    if (state === 'charging' && sc.abortAt > 0 && t >= -CHARGE_T * (1 - sc.abortAt) - 1e-9) {
      state = 'aborted';            // przerwane ładowanie: automat w idle, bez wyjścia
      tEnd = t + 1.5;
    }
    if (state === 'charging' && t >= -1e-9) {
      state = 'active';
      prog = 0;
      CR.noteCameraRigWarp(rig, 'kick');
    }
    if (state === 'active') {
      prog = Math.min(1, prog + DT / ENTRY_T);
      const ease = prog * prog * (3 - 2 * prog);
      const x = sc.S0.x + u.x * s;
      const y = sc.S0.y + u.y * s;
      const vmax = cruise * zoneAt(x, y, sc) * WD.warpFlybyFactor(x, y, u.x, u.y, fly);
      const vs = Math.min(0, vmax);
      v += (vs + (vmax - vs) * ease - v) * kA;
      s += v * DT;
      const exitNow = sc.free ? s >= sc.leg
        : sc.leg - s <= WD.warpExitRampDistance(v, L_HULL, Math.min(v, V_END)) + SLIDE;
      if (exitNow) {
        state = 'exit';
        ramp = WD.createWarpExitRamp({ v0: v, hullLength: L_HULL, vEnd: Math.min(v, V_END), startTime: t });
        exitT0 = t;
        ev.exit = t;
        ev.brake = t + ramp.tBrake;
        ev.halt = t + ramp.tHalt;
      }
    } else if (state === 'exit') {
      const age = t - exitT0;
      if (age < ramp.tHalt) v = WD.sampleWarpExitRamp(ramp, age).speed;
      else {
        // koniec rampy: prędkość wyjścia vEnd, potem ślizg (startPlayerWarpSlide) do prędkości bojowej
        if (!slideOn && !(stopT >= 0)) { v = ramp.vEnd; if (v > V_MAX + 1e-6) slideOn = true; }
        if (slideOn) {
          v = Math.max(V_MAX, v - BRAKE * DT);
          if (v <= V_MAX + 1e-6) { slideOn = false; stopT = t; ev.stop = t; }
        } else if (!(stopT >= 0)) { stopT = t; ev.stop = t; }
        if (stopT >= 0 && !Number.isFinite(tEnd)) tEnd = stopT + 4;
      }
      s += v * DT;
      if (age >= ramp.tBrake && !exitNoted) { CR.noteCameraRigWarp(rig, 'exit'); exitNoted = true; }
    }
    const shipX = sc.S0.x + u.x * s;
    const shipY = sc.S0.y + u.y * s;
    // ---- kamera (raz na klatkę: stepCameraRigWarp → zoom → stepCameraRig), osie ekranu (kurs w górę)
    const exitAge = state === 'exit' ? t - exitT0 : -1;
    const camExitAge = state === 'exit' && exitAge < ramp.tHalt + WD.WARP_EXIT.settle + 0.3 ? exitAge : -1;
    const arrivalDist = tgtW ? Math.max(0, hyp(tgtW.x - shipX, tgtW.y - shipY) - tgtW.r) : -1;
    // index.html: updateCameraWarpKick — kadr przylotu z odległości od brzegu tarczy celu, cel na tle z perspektywą
    // (input.arrivalDepthK = warpArrivalDepthK(H) — tu ogniskowa z H, jak kamera gry w px CSS)
    const rigState = state === 'exit' || state === 'aborted' ? 'idle' : state;
    CR.stepCameraRigWarp(rig, {
      dt: DT, enabled: true, state: rigState, charge: state === 'charging' ? (t + CHARGE_T) / CHARGE_T : 1,
      dirX: 0, dirY: -1, exitAge: camExitAge, exitSlow: ramp ? ramp.tSlowEnd : WD.WARP_EXIT.slow, exitHalt: ramp ? ramp.tHalt : 1.15,
      rulon: false, zoomRef, zoomBase: zoomRef, arriving: slideOn, arrivalDist, arrivalDepthK: tgtDepthK, viewW: W, viewH: H
    }, tune);
    // cameraZoom.js: zoom na ekranie = zoom gracza × e^człon w [podłoga, max] (podłoga kadru przylotu — cameraZoomFloor)
    cz.zoomImpulseMin = rig.warpZoomFloor;
    cz.zoomImpulseLog = rig.warpZoomLog;
    CZ.stepCameraZoom(cz, DT);
    const zoom = cz.zoom;
    CR.stepCameraRig(rig, { dt: DT, viewW: W, viewH: H, mode: 'never', lookEnabled: false, velX: 0, velY: -v, maxSpeed: V_MAX }, tune);
    const shipSx = -rig.offsetX;
    const shipSy = -rig.offsetY;
    // Kotwica P0_nom: nominalny offset riga bez kopu i wysunięcia (rig.nominalX/Y — etap W; dawniej sama sprężyna).
    const anchorSx = -(Number.isFinite(rig.nominalX) ? rig.nominalX : rig.springX);
    const anchorSy = -(Number.isFinite(rig.nominalY) ? rig.nominalY : rig.springY);
    const [cox, coy] = toWorld(rig.offsetX / zoom, rig.offsetY / zoom);
    const camX = shipX + cox;
    const camY = shipY + coy;
    const camZ = focal / zoom;
    // ---- β (src/render/warpLensPhase.js: stepWarpLensPhase na obiekcie warpa — jak index.html stepPlayerWarpLensPhase)
    gw.state = rigState;
    gw.charge = state === 'charging' ? (t + CHARGE_T) : (state === 'active' ? CHARGE_T : 0);
    if (state === 'active' && !Number.isFinite(gw.kickSim)) gw.kickSim = 0;
    gw.exitRamp = ramp;
    gw.exitSlide.active = state === 'exit' && slideOn;
    let beta = PH.stepWarpLensPhase(track, phase, gw, t, false);
    if (today) {
      // player.js (przed integracją): lensBeta — smooth(0; 0,5; od kopu), wyjście lensAtExit · (1 − smooth(slow; tHalt)).
      if (state === 'active') beta = smoothstep(0, 0.5, t);
      else if (state === 'exit') beta = smoothstep(0, 0.5, exitT0) * (1 - smoothstep(ramp.slow, Math.max(ramp.slow + 0.05, ramp.tHalt), exitAge));
      else beta = 0;
    }
    const lensExitAge = today ? exitAge : Number(phase.exitAge);
    const arriving = today ? lensExitAge >= 0 && lensExitAge < (ramp ? ramp.tHalt : 0) + 12 : lensExitAge >= 0;
    // ---- rekordy (planet3d.assets.js: _lensPrepare)
    for (const r of recs) {
      const b = r.src;
      r.ready = !(today && b.kind === 'sun');   // dziś słońce bez rekordu soczewki
      const ortho = b.z === 0;
      r.flat = ortho ? zoom : focal / Math.max(1, camZ - b.z);
      if (b.ring) {
        const hw = W * 0.5 / zoom;
        const hh = H * 0.5 / zoom;
        const ex = Math.max(0, Math.abs(b.x - camX) - hw);
        const ey = Math.max(0, Math.abs(b.y - camY) - hh);
        const gapPx = (hyp(ex, ey) - (RING_OUT[b.id] + LENS_RING_EXTENT)) * zoom;
        let g = smoothstep(0, 1, gapPx / Math.max(1, LENS_GATE_RAMP * Math.min(W, H)));
        if (r.gateOpenSession === lens.session) g = 1;
        if (!r._lensed || g <= r.gate) r.gate = g;
        else r.gate += (g - r.gate) * (1 - Math.exp(-DT / LENS_GATE_OPEN));
        if (r.gate >= 0.999) { r.gate = 1; r.gateOpenSession = lens.session; }
      } else r.gate = 1;
    }
    const on = beta > 0.0005 || (arriving && ctx.targetHold > 0.0005);
    if (on) {
      Object.assign(ctx, {
        active: true, beta, speed: cruise, velAngle: course, zoom, W, H, focal, camZ, camX, camY, roll, shipX, shipY,
        shipSx, shipSy, anchorSx, anchorSy, hullHalfLen: L_HULL * zoom * 0.5, hullHalfWid: W_HULL * zoom * 0.5, dt: DT,
        target, origin, exitAge: arriving ? lensExitAge : -1, exitSlow: phase.exitSlow > 0 ? phase.exitSlow : 0, exitHalt: phase.exitHalt,
        arriving: phase.arriving,       // warpLensPhase: ślizg z pędem (warp.exitSlide.active) / hamowanie grawitacyjne
        arrivalFill: fill, zoomRef, zoomJump: zoomRef * tune.warpZoomOut
      });
      if (today) Object.assign(ctx, { anchorSx: NaN, anchorSy: NaN, origin: null, exitSlow: 0, arriving: null, arrivalFill: NaN, zoomRef: NaN, zoomJump: NaN });
      lens.update(recs, recs.length, ctx, target);
      for (const r of recs) r._lensed = true;
      lensOn = true;
    } else {
      if (lensOn) lensOn = false;
      lens.reset();
      ctx.targetHold = 0;
      for (const r of recs) r._lensed = false;
    }
    if (state === 'exit' && prevHold >= 0.999 && ctx.targetHold < 0.999 && !Number.isFinite(ev.release)) {
      ev.release = t;
      const A = lens._arr;
      ev.releaseWhy = A.releaseT === Infinity ? 'cięcie' : (A.conv >= lens.params.arrivalConvTime - 1e-9 ? 'zbieżność kamery'
        : (A.stopT >= 0 ? 'zatrzymanie + zapas' : 'limit'));
    }
    prevHold = ctx.targetHold;
    if (DEBUG_T && target && on && t >= DEBUG_T[0] && t <= DEBUG_T[1]) {
      console.log(`[cel] t ${t.toFixed(3)} gap ${Math.round(arrivalDist)} zoom ${zoom.toFixed(5)} flat ${target.flat.toFixed(5)} qT ${lens._tg.qT.toFixed(5)} `
        + `ef ${lens._F.ef.toFixed(1)} ec ${lens._F.ec.toFixed(1)} out (${target.out.x.toFixed(1)}, ${target.out.y.toFixed(1)}) r ${target.out.size.toFixed(1)} bT ${target.out.beta.toFixed(3)} entry ${target.entry}`);
    }
    // ---- obraz klatki
    const fb = {};
    for (const r of recs) {
      const b = r.src;
      let x;
      let y;
      let size;
      let bb = 0;
      if (on && r.ready) { x = r.out.x; y = r.out.y; size = r.out.size; bb = r.out.beta; }
      else {
        const [dx, dy] = toScreen(b.x - shipX, b.y - shipY);
        const m = r.flat / zoom;
        x = shipSx * m + dx * r.flat;
        y = shipSy * m + dy * r.flat;
        size = b.r * r.flat;
      }
      const inF = WL.lensDiscInFrame(x, y, size, W, H);
      const drawn = size >= 1.5 && inF;
      fb[b.id] = { x, y, size, bb, inF, drawn, entry: r.entry };
    }
    const [tdx, tdy] = tgtW ? toScreen(tgtW.x - shipX, tgtW.y - shipY) : [0, 0];
    frames.push({
      t, state, phaseName: stopT >= 0 && t - stopT >= (k1 ? 1 : 0) ? 'powrót' : phaseName(state, t, exitAge, ramp, slideOn), v, s, beta, zoom, shipSx, shipSy, anchorSx, anchorSy,
      hold: ctx.targetHold, exitAge, slide: slideOn, bodies: fb, tdx, tdy, hullL: L_HULL * zoom * 0.5, hullW: W_HULL * zoom * 0.5
    });
    t += DT;
    if (t > 120) break;
  }
  return { sc, H, W, sPx, k1, zoomRef, plan, cruise, frames, ev, recs, course };
}

function phaseName(state, t, exitAge, ramp, slide) {
  if (state === 'charging') return 'ładowanie';
  if (state === 'aborted') return 'przerwanie';
  if (state === 'active') return t < 0.6 ? 'kop' : 'lot';
  if (exitAge < ramp.tHalt) return 'wyjście';
  return 'przylot';
}

// ------------------------------------------------------------------------------------------------ kontrole
const P4_MOVE = 60;   // [px/klatkę przy 1080p] ruch środka ciała w kadrze
const POP_PX = 2;     // [px] mignięcie liczone od tarczy tej wielkości (minDot)
const POP_RATIO = 0.15; // zniknięcie / pojawienie w jednej klatce: promień spada / rośnie ponad ×1 / 0,15
const C4_PX = 12;     // [px] najmniejszy odstęp tarczy od kadłuba (pół edgeGap — kieszeń miękka)
const P4_SIZE = 50;   // [px/klatkę] zmiana promienia
const STALL_S = 2;    // [s] najdłuższy postój
const C2_MARS = 250;  // [px przy 1080p] Mars w trawersie (S1)
const FAR_PX = 25;    // [px przy 1080p] ciało ≥ FAR_A przed dziobem — małe (BRIEF C2: dalekie ≤ ~20 px)
const FAR_A = 1.5e6;  // [j.] (Jowisz 48 tys. przy 1 mln ma w samej mapie r·E/a ≈ 28 px — za blisko na „daleko”)

function analyze(res) {
  const F = res.frames;
  const sPx = res.sPx;
  const W = res.W;
  const H = res.H;
  const ids = Object.keys(F[0].bodies);
  const checks = [];
  const add = (id, name, pass, value, note = '') => checks.push({ id, name, pass, value, note });
  // P4 / C5 — skoki klatka po klatce (ciała w kadrze w obu klatkach), per faza
  const jumps = {};
  let pops = [];
  for (let i = 1; i < F.length; i++) {
    const a = F[i - 1];
    const b = F[i];
    const ph = b.phaseName;
    const J = jumps[ph] || (jumps[ph] = { move: 0, moveId: '', moveT: 0, size: 0, sizeId: '', sizeT: 0, d2: 0, d2Id: '' });
    for (const id of ids) {
      const p = a.bodies[id];
      const q = b.bodies[id];
      if (p.drawn && q.drawn) {
        const mv = hyp(q.x - p.x, q.y - p.y);
        const ds = Math.abs(q.size - p.size);
        if (mv > J.move) { J.move = mv; J.moveId = id; J.moveT = b.t; }
        if (ds > J.size) { J.size = ds; J.sizeId = id; J.sizeT = b.t; }
        if (i >= 2) {
          const o = F[i - 2].bodies[id];
          if (o.drawn) {
            const d2 = hyp(q.x - 2 * p.x + o.x, q.y - 2 * p.y + o.y);
            if (d2 > J.d2) { J.d2 = d2; J.d2Id = id; }
          }
        }
      }
      // mignięcie: zniknięcie / pojawienie się w głębi kadru (środek w kadrze z zapasem), tarcza ≥ minDot (2 px), we
      // wszystkich fazach (także „powrót” — wyłączenie soczewki po przylocie)
      const deep = (o) => Math.abs(o.x) < W * 0.5 - o.size && Math.abs(o.y) < H * 0.5 - o.size;
      // (zanurzenie / wynurzenie przez próg minPx z małym krokiem promienia — nie mignięcie)
      // (obraz w kadrze ≥ POP_PX znika: wyskakuje z głębi kadru — następny ≥ 1,5 px poza kadrem — albo gaśnie w jednej
      // klatce do < 15% promienia; ciągłe zanurzanie przez próg 1,5 px z krokiem rzędu kilku px to nie mignięcie)
      const popOut = p.drawn && !q.drawn && p.size >= POP_PX && deep(p) && (q.size >= 1.5 || q.size < POP_RATIO * p.size);
      const popIn = !p.drawn && q.drawn && q.size >= POP_PX && deep(q) && (p.size >= 1.5 || p.size < POP_RATIO * q.size);
      if (popOut) pops.push({ t: b.t, id, kind: 'zniknięcie', size: p.size, ph });
      if (popIn) pops.push({ t: b.t, id, kind: 'pojawienie', size: q.size, ph });
    }
  }
  for (const ph of ['ładowanie', 'przerwanie', 'kop', 'lot', 'wyjście', 'przylot', 'powrót']) {
    const J = jumps[ph];
    if (!J) continue;
    const info = ph === 'powrót';   // kamera wraca do zoomu gracza po przylocie — prawdziwy świat, poza soczewką (K1)
    const ok = info || (J.move <= P4_MOVE * sPx && J.size <= P4_SIZE * sPx);
    add('P4-' + ph, `skok w klatce: ${ph}${info ? ' (kamera, informacyjnie)' : ''}`, ok, `${fmt(J.move, 1)} px (${J.moveId} @${fmt(J.moveT, 2)}) / Δr ${fmt(J.size, 1)} px (${J.sizeId}) / Δ² ${fmt(J.d2, 1)} (${J.d2Id})`,
      info ? 'zoom gracza po końcu ślizgu' : `≤ ${fmt(P4_MOVE * sPx)} / ${fmt(P4_SIZE * sPx)} px`);
  }
  add('P4-mig', 'mignięcia w głębi kadru', pops.length === 0, pops.length ? pops.slice(0, 4).map((p) => `${p.id} ${p.kind} ${fmt(p.size, 1)} px @${fmt(p.t, 2)} (${p.ph})`).join('; ') : '0');
  if (res.sc.abortAt > 0) {
    // Przerwane ładowanie: tylko ciągłość (P4, mignięcia) i powrót do prawdziwego widoku.
    const last = F[F.length - 1];
    const realEnd = Object.keys(last.bodies).every((id) => last.bodies[id].bb === 0);
    add('C7-przerwanie', 'po przerwaniu ładowania — prawdziwy widok (β = 0) w 1,5 s', realEnd && last.beta === 0, `β ${fmt(last.beta, 3)}`);
    return { checks, jumps, pops, counts: { min: 0, max: 0, avg: 0 } };
  }
  // C1 — ciała w kadrze w locie
  const flight = F.filter((f) => f.state === 'active' && f.t >= 0.6);
  const counts = flight.map((f) => ids.filter((id) => f.bodies[id].drawn).length);
  const cMin = counts.length ? Math.min(...counts) : 0;
  const cMax = counts.length ? Math.max(...counts) : 0;
  const cAvg = counts.length ? counts.reduce((x, y) => x + y, 0) / counts.length : 0;
  add('C1-liczba', 'ciała w kadrze w locie (min / śr. / max)', cMin >= 3, `${cMin} / ${fmt(cAvg, 1)} / ${cMax}`, '≥ 3 przez cały lot');
  // każda planeta i słońce: w kadrze ≥ 0,5 s (ładowanie + lot) albo powód
  const big = res.recs.filter((r) => r.src.kind === 'planet' || r.src.kind === 'sun').map((r) => r.id);
  const missing = [];
  const seen = [];
  for (const id of big) {
    const vis = F.filter((f) => (f.state === 'active' || f.state === 'charging') && f.bodies[id].drawn).length * DT;
    if (vis >= 0.5) { seen.push(id); continue; }
    const why = reasonHidden(res, id);
    if (!why) missing.push(id); else seen.push(id + ' (' + why + ')');
  }
  add('C1-planety', 'planety i słońce w kadrze (≥ 0,5 s) albo powód', missing.length === 0, missing.length ? 'brak: ' + missing.join(', ') : 'wszystkie', seen.join(', '));
  // C2 — Mars w trawersie (S1), dalekie małe
  if (res.sc.flyby) {
    const fid = res.sc.flyby;
    let peak = 0;
    let peakT = 0;
    for (const f of F) if (f.state === 'active' && f.bodies[fid].drawn && f.bodies[fid].size > peak) { peak = f.bodies[fid].size; peakT = f.t; }
    const need = res.sc.name === 'S1' ? C2_MARS * sPx : 0;
    add('C2-trawers', `${fid} w trawersie (${res.sc.flybyLat / 1000} tys. j.) — szczyt promienia`, peak >= need, `${fmt(peak)} px @${fmt(peakT, 2)} s`, need ? `≥ ${fmt(need)} px` : 'informacyjnie');
    // monotoniczność: rośnie do szczytu, potem maleje (w locie, β = 1)
    let up = 0;
    let down = 0;
    let prev = null;
    for (const f of F) {
      if (f.state !== 'active' || f.t < 0.6) { prev = null; continue; }
      const b = f.bodies[fid];
      if (!b.drawn || b.bb < 0.999) { prev = null; continue; }
      if (prev !== null) {
        if (f.t <= peakT && b.size < prev - 1e-6) up++;
        if (f.t > peakT && b.size > prev + 1e-6) down++;
      }
      prev = b.size;
    }
    add('C2-mono', `${fid}: rośnie do trawersu, potem maleje`, up === 0 && down === 0, `nawroty ${up} / ${down}`);
  }
  let farWorst = 0;
  let farId = '';
  for (const f of F) {
    if (f.state !== 'active' || f.t < 0.6) continue;
    for (const id of big) {
      const r = res.recs.find((q) => q.id === id);
      const [ax] = alongOf(res, f, r.src);
      const b = f.bodies[id];
      if (ax >= FAR_A && b.drawn && b.size > farWorst) { farWorst = b.size; farId = id + ' @' + fmt(f.t, 1); }
    }
  }
  add('C2-daleko', `ciało ≥ ${FAR_A / 1e6} mln j. przed dziobem — małe`, farWorst <= FAR_PX * sPx, `max ${fmt(farWorst, 1)} px (${farId})`, `≤ ${fmt(FAR_PX * sPx)} px`);
  // C3 — postój (ciało w kadrze, β = 1, ≥ 3 px: < 2 px/s i |d ln r / dt| < 0,02/s)
  let stallWorst = 0;
  let stallId = '';
  for (const id of ids) {
    let run = 0;
    for (let i = 1; i < F.length; i++) {
      const f = F[i];
      const b = f.bodies[id];
      const a = F[i - 1].bodies[id];
      if (f.state !== 'active' || !b.drawn || !a.drawn || b.size < 3 || b.bb < 0.999) { run = 0; continue; }
      const sp = hyp(b.x - a.x, b.y - a.y) / DT;
      const gr = Math.abs(Math.log(b.size / a.size)) / DT;
      if (sp < 2 && gr < 0.02) { run += DT; if (run > stallWorst) { stallWorst = run; stallId = id + ' @' + fmt(f.t, 1); } } else run = 0;
    }
  }
  add('C3-postój', 'najdłuższy postój ciała w kadrze', stallWorst <= STALL_S, `${fmt(stallWorst, 2)} s ${stallId}`, `≤ ${STALL_S} s`);
  // C4 — tarcza (z ringiem) nie zachodzi na kadłub (elipsa kadłuba na ekranie)
  let gapMin = Infinity;
  let gapId = '';
  for (const f of F) {
    for (const id of ids) {
      const b = f.bodies[id];
      // tylko obraz pełnej soczewki (kieszeń): prawdziwy obraz tła pod statkiem (przylot do Saturna) to prawdziwy świat;
      // cel od wyjścia — kadr przylotu kamery (T1; tło w pierścieniu Saturna: soczewka = prawdziwy obraz), nie kieszeń
      if (!b.drawn || !(b.bb >= 0.999)) continue;
      if (id === res.sc.target && f.exitAge >= 0) continue;
      const r = res.recs.find((q) => q.id === id);
      const ext = Math.max(1, (r.src.rExt || r.src.r) / r.src.r);
      const dx = b.x - f.shipSx;
      const dy = b.y - f.shipSy;
      const d = hyp(dx, dy);
      if (d < 1e-6) { gapMin = -Infinity; gapId = id; continue; }
      const ua = (-dy / d) / Math.max(1, f.hullL);
      const ul = (dx / d) / Math.max(1, f.hullW);
      const pk = 1 / Math.sqrt(ua * ua + ul * ul);
      const g = d - b.size * ext - pk;
      if (g < gapMin) { gapMin = g; gapId = `${id} @${fmt(f.t, 2)} (${f.phaseName})`; }
    }
  }
  add('C4-kadłub', 'najmniejszy odstęp tarczy (z ringiem) od kadłuba', gapMin >= C4_PX, `${fmt(gapMin)} px (${gapId})`, `≥ ${C4_PX} px (edgeGap ${WL.WORLD_LENS_DEFAULTS.edgeGap} px — kieszeń)`);
  // C6 — ciało w stożku za celem (M4): nie siedzi na tle tarczy celu (zanurzone przez cały czas soczewki, bez mignięć)
  if (res.sc.coneBody) {
    const cid = res.sc.coneBody;
    let worst = 0;
    let worstAt = '';
    for (const f of F) {
      const b = f.bodies[cid];
      if (!b.drawn || !(b.bb > 0)) continue;
      const [a, l] = alongOf(res, f, res.recs.find((q) => q.id === cid).src);
      const tg = res.sc.world.P[res.sc.target];
      const [ta] = alongOf(res, f, tg);
      const inCone = a > ta - tg.r && Math.atan2(Math.abs(l), a) / deg < WL.WORLD_LENS_DEFAULTS.coneDeg - WL.WORLD_LENS_DEFAULTS.coneSoftDeg;
      if (inCone && b.size > worst) { worst = b.size; worstAt = `@${fmt(f.t, 2)} (${f.phaseName})`; }
    }
    add('C6-stożek', `${cid} w stożku za celem — zanurzony (max promień w kadrze)`, worst <= 1.5, `${fmt(worst, 2)} px ${worstAt}`, '≤ 1,5 px (minPx)');
  }
  // C5 — cel: rośnie z hamowaniem, w kadrze, puszczenie bez skoku
  if (res.sc.target) {
    const tid = res.sc.target;
    const ev = res.ev;
    const ex = F.filter((f) => f.t >= ev.exit - 1e-9 && f.t <= ev.halt + 1e-9);
    let shrink = 0;
    for (let i = 1; i < ex.length; i++) shrink = Math.max(shrink, ex[i - 1].bodies[tid].size - ex[i].bodies[tid].size);
    const r0 = ex.length ? ex[0].bodies[tid].size : 0;
    const r1 = ex.length ? ex[ex.length - 1].bodies[tid].size : 0;
    add('C5-cel-rośnie', 'cel rośnie razem z hamowaniem (wyjście → zatrzymanie rampy)', shrink <= 0.5 && r1 >= 2 * r0,
      `${fmt(r0)} → ${fmt(r1)} px (×${fmt(r1 / Math.max(1e-9, r0), 2)}), max spadek ${fmt(shrink, 2)} px/kl.`, '× ≥ 2, bez malenia');
    // cel w kadrze od kopu (≥ 0,6 s) do końca obserwacji
    let outT = 0;
    const tLast = Number.isFinite(ev.stop) ? ev.stop + 1 : Infinity;
    for (const f of F) if (f.t >= 0.6 && f.t <= tLast && !f.bodies[tid].inF) outT += DT;
    add('C5-cel-kadr', 'cel w kadrze od kopu do końca ślizgu + 1 s (poza kadrem łącznie)', outT <= 0.05, `${fmt(outT, 2)} s`, '0 s');
    // puszczenie: okno [release − 0,1; release + 0,8]
    if (Number.isFinite(ev.release)) {
      let mv = 0;
      let ds = 0;
      let dec = 0;
      for (let i = 1; i < F.length; i++) {
        const f = F[i];
        if (f.t < ev.release - 0.1 || f.t > ev.release + 0.8) continue;
        const a = F[i - 1].bodies[tid];
        const b = f.bodies[tid];
        mv = Math.max(mv, hyp(b.x - a.x, b.y - a.y));
        ds = Math.max(ds, Math.abs(b.size - a.size));
        dec = Math.max(dec, (a.size - b.size) / Math.max(1e-9, a.size));
      }
      add('C5-puszczenie', `puszczenie celu (${ev.releaseWhy}) bez skoku`, mv <= P4_MOVE * sPx && ds <= P4_SIZE * sPx && dec <= 0.02,
        `@${fmt(ev.release, 2)} s: ruch ${fmt(mv, 1)} px/kl., Δr ${fmt(ds, 1)} px/kl., maleje ≤ ${fmt(dec * 100, 2)}%/kl.`, `≤ ${fmt(P4_MOVE * sPx)} / ${fmt(P4_SIZE * sPx)} px, ≤ 2%/kl.`);
    } else add('C5-puszczenie', 'puszczenie celu', false, 'cel nie został puszczony');
  }
  return { checks, jumps, pops, counts: { min: cMin, max: cMax, avg: cAvg } };
}

function alongOf(res, f, b) {
  const u = res.sc.u;
  const x = res.sc.S0.x + u.x * f.s;
  const y = res.sc.S0.y + u.y * f.s;
  const ox = b.x - x;
  const oy = b.y - y;
  return [ox * u.x + oy * u.y, oy * u.x - ox * u.y];
}

// Uzasadnione ukrycie planety: w stożku za celem, cały lot za rufą (poza tylnym punktem zbiegu), cel przed kopem.
function reasonHidden(res, id) {
  const F = res.frames.filter((f) => f.state === 'active');
  if (!F.length) return '';
  const b = res.recs.find((q) => q.id === id).src;
  const tgt = res.sc.target ? res.sc.world.P[res.sc.target] : null;
  let behind = true;
  let cone = true;
  for (const f of F) {
    const [a, l] = alongOf(res, f, b);
    if (a > -50000) behind = false;
    if (tgt) {
      const [ta] = alongOf(res, f, tgt);
      const ang = Math.atan2(Math.abs(l), a) / deg;
      if (!(a > ta - tgt.r && ang < WL.WORLD_LENS_DEFAULTS.coneDeg)) cone = false;
    } else cone = false;
  }
  if (cone) return 'za celem w stożku';
  if (behind) return 'cały lot za rufą';
  return '';
}

// ------------------------------------------------------------------------------------------------ raport
function tracks(res, all) {
  const F = res.frames;
  const lines = [];
  const ids = Object.keys(F[0].bodies);
  const tid = res.sc.target;
  lines.push(`| t [s] | faza | v [tys. j/s] | β | zoom | statek (x, y) | ciała w kadrze: id (x, y · r · px/s · β) |`);
  lines.push('|---|---|---|---|---|---|---|');
  let next = -CHARGE_T;
  for (let i = 0; i < F.length; i++) {
    const f = F[i];
    if (f.t < next - 1e-9) continue;
    next += 0.5;
    const cells = [];
    for (const id of ids) {
      const b = f.bodies[id];
      if (!b.drawn && !(all && b.inF)) continue;
      const a = i > 0 ? F[i - 1].bodies[id] : b;
      const sp = hyp(b.x - a.x, b.y - a.y) / DT;
      cells.push(`${id === tid ? '**' + id + '**' : id} (${fmt(b.x)}, ${fmt(b.y)} · ${fmt(b.size, b.size < 10 ? 1 : 0)} · ${fmt(sp)} · ${fmt(b.bb, 2)})`);
    }
    lines.push(`| ${fmt(f.t, 2)} | ${f.phaseName}${f.slide ? ' (ślizg)' : ''} | ${fmt(f.v / 1000, 1)} | ${fmt(f.beta, 2)} | ${fmt(f.zoom, 4)} | ${fmt(f.shipSx)}, ${fmt(f.shipSy)} | ${cells.join('; ') || '—'} |`);
  }
  return lines.join('\n');
}

const runs = [];
let failed = 0;
const out = [];
out.push(`# Symulator soczewki świata „podniesiony świat” — ${new Date().toISOString().slice(0, 10)}`);
out.push('');
out.push(`Wpięcie: ${WIRING === 'dzis' ? 'DZIŚ (sterownik przed integracją — informacyjnie)' : 'nowe (etap integracji)'}${ORIGIN_MOVE ? ', planeta startu ruchem (A/B)' : ''}. B = ${B_LENS} j., mapa: h_f ${WL.WORLD_LENS_DEFAULTS.hf}, h_b ${WL.WORLD_LENS_DEFAULTS.hb}, w_s ${WL.WORLD_LENS_DEFAULTS.ws}, ε ${WL.WORLD_LENS_DEFAULTS.eps}·A; oś β: ładowanie ${PH.WARP_LENS_PHASE.chargeBeta}·smoothstep, kop ${PH.WARP_LENS_PHASE.kickTime} s easeOut³, front smug gwiazd w ramp.slow, zanurzenie ${PH.WARP_LENS_PHASE.submerge} s. Napęd Mk II ${DRIVE / 1000} tys. j/s, Atlas L ${L_HULL}, ślizg ${Math.round(SLIDE)} j.`);
out.push('');
for (const name of SCENS) {
  const fn = SCEN_FN[name];
  if (!fn) continue;
  const sc = fn();
  for (const H of RESS) {
    for (const k1 of K1S) {
      const res = simulate(sc, H, k1);
      const an = analyze(res);
      const strict = k1 || STRICT_OFF;
      const bad = an.checks.filter((c) => !c.pass);
      if (strict && bad.length) failed += bad.length;
      runs.push({ res, an });
      const ev = res.ev;
      out.push(`## ${sc.name} ${res.W}×${H} — kamera ${k1 ? 'K1 (DECYZJE)' : 'dziś (bez K1, informacyjnie)'}`);
      out.push('');
      out.push(`${sc.title}. ${res.plan ? `Plan: v_c ${fmt(res.cruise / 1000, 1)} tys. j/s, ${fmt(res.plan.time, 2)} / ${fmt(res.plan.target, 2)} s.` : `Swobodny: ${fmt(DRIVE / 1000)} tys. j/s × strefa.`} Zoom odniesienia ${fmt(res.zoomRef, 4)}; kop 0,00 s, wyjście ${fmt(ev.exit, 2)} s, hamowanie ${fmt(ev.brake, 2)} s, stop rampy ${fmt(ev.halt, 2)} s, koniec ślizgu ${fmt(ev.stop, 2)} s${Number.isFinite(ev.release) ? `, puszczenie celu ${fmt(ev.release, 2)} s (${ev.releaseWhy})` : ''}.`);
      out.push('');
      out.push('| kontrola | wynik | wartość | próg / uwagi |');
      out.push('|---|---|---|---|');
      for (const c of an.checks) out.push(`| ${c.name} | ${c.pass ? 'OK' : (strict ? '**BŁĄD**' : 'nie (info)')} | ${c.value} | ${c.note} |`);
      out.push('');
      if (TORY === 'wszystkie' || (TORY === 'gl' && k1 && H === RESS[0])) {
        out.push(`### Tory ${sc.name} ${res.W}×${H} (co 0,5 s; x, y od środka kadru [px, y w dół], r [px], px/s, β ciała)`);
        out.push('');
        out.push(tracks(res, false));
        out.push('');
      }
    }
  }
}
// Zbiorcza tabela
out.push('## Zbiorczo');
out.push('');
const ids = [...new Set(runs.flatMap((r) => r.an.checks.map((c) => c.id)))];
out.push('| przebieg | ' + ids.join(' | ') + ' |');
out.push('|---|' + ids.map(() => '---').join('|') + '|');
for (const r of runs) {
  const strictRun = r.res.k1 || STRICT_OFF;
  const m = Object.fromEntries(r.an.checks.map((c) => [c.id, c.pass ? 'OK' : (strictRun ? 'BŁĄD' : 'nie')]));
  out.push(`| ${r.res.sc.name} ${r.res.H}p ${r.res.k1 ? 'K1' : 'dziś'} | ` + ids.map((id) => m[id] || '—').join(' | ') + ' |');
}
out.push('');
out.push(failed ? `**${failed} kontroli nie przeszło (wariant K1${STRICT_OFF ? ' i dziś' : ''}).**` : 'Wszystkie kontrole wariantu K1 przeszły.');
const text = out.join('\n');
if (MD) writeFileSync(MD, text);
else console.log(text);
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(runs.map((r) => ({
    scen: r.res.sc.name, H: r.res.H, k1: r.res.k1, ev: r.res.ev, checks: r.an.checks,
    frames: r.res.frames.map((f) => ({ t: +f.t.toFixed(4), ph: f.phaseName, v: Math.round(f.v), beta: +f.beta.toFixed(4), zoom: +f.zoom.toFixed(5),
      ship: [+f.shipSx.toFixed(1), +f.shipSy.toFixed(1)], hold: +f.hold.toFixed(4),
      b: Object.fromEntries(Object.entries(f.bodies).filter(([, b]) => b.inF).map(([id, b]) => [id, [+b.x.toFixed(1), +b.y.toFixed(1), +b.size.toFixed(2), +b.bb.toFixed(3)]])) }))
  }))));
}
if (MD) console.log(`raport: ${MD}; ${failed ? failed + ' kontroli nie przeszło' : 'kontrole K1: OK'}`);
process.exitCode = failed ? 1 : 0;
