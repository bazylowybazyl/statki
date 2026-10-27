// STUDNIE GRAWITACYJNE W WARPIE GRACZA (BRIEF-studnie, decyzja użytkownika 2026-10-26: „nie można odpalić warpa PRZY
// planecie i trzeba od niej kawałek odlecieć, ale samo przelatywanie w warpie? powinno jak najbardziej być … nie wymuszasz
// przelotu bokiem”): start skoku w studni planety / małego ciała / słońca zablokowany (odmowa z komunikatem; TRAVEL TO
// wyprowadza hipercruise'em do brzegu, potem skok), w locie studnia planety nie hamuje (słońce, baza piratów, przechwyt
// misji 2 — jak dawniej), planista bez objazdów studni planet, podłoga łącznego zwolnienia nad planetą.
// Poprawki po recenzji (2026-10-27): wyjście ze studni z hali K-7 / zatoki osią doku przez bramę, przez jądro (pas budowli
// portu) promieniowo — bez stycznej przez hale (rozgrywka ust. 1); wnętrze ringu — start wolno (ust. 2); odcinek wyjścia
// nie krótszy niż próg hipercruise'u (ust. 3); polska nazwa ciała (ust. 4); bez komunikatów stref planet w przelocie (ust. 5);
// księżyce z bryłą w zwolnieniu skoku (obraz W4).
// Logika na PRAWDZIWYCH funkcjach index.html (loadIndexFunction na zaślepionym świecie) i warpDrive.js / travelNav.js.
// node --test tests/warpStudnie.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadIndexFunction, sliceFunction } from './helpers/indexSource.mjs';
import {
  WARP_SLOW_FLOOR, warpSpeedFactor, WARP_FLYBY_DEFAULTS, warpFlybySlowdown, planWarpCruise, simulateWarpLeg, warpTripTuneFor,
  warpLegTimeline, warpExitRampTime, warpExitRampDistance, planWarpEmergency, WARP_EMERGENCY, warpMoonReach, warpFlybyFactor
} from '../src/game/warpDrive.js';
import { moonsOf } from '../src/data/systemMap.js';
import { TRAVEL_TUNE, planTravelLeg, wellExitPoint, travelApproachPoint, segmentCrossesCircle } from '../src/game/travelNav.js';
import { WARP_DRIVES, HYPERCRUISE_TUNE } from '../src/data/driveModes.js';
import { RADAR_PLANET_NAMES } from '../src/ui/radar/radarConfig.js';
import { HaloRingWorld } from '../src/game/haloRingWorld.js';
import { haloRingKey } from '../src/game/haloRingPlanets.js';
import { computeHaloRingLayout } from '../src/3d/haloRing/haloRingLayout.js';
import { resolveRingPlanetWorldRadius } from '../src/3d/ringScale.js';
import { k7FrameFor, k7HubToGame } from '../src/game/story/k7Dock.js';
import { MOON_BODY_TUNES, moonGameNode, moonStartAngle, moonOrbitRadius, moonBodyRadius } from '../src/data/moonBodies.js';
import { WORLD_LENS_DEFAULTS, warpLensFrame, newWarpLensFrame, warpLensQ } from '../src/3d/warp/worldLens.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const deg = Math.PI / 180;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fns = (scope, names) => {
  for (const n of names) scope[n] = loadIndexFunction(html, `    function ${n}(`, n, scope);
  return scope;
};

// Świat jak w grze (liczby z planetOrbitRadii — ring „Halo”: studnia = obwiednia ringu + 3000 + 9000; Mars bez ringu
// w tej atrapie): Ziemia, Mars, Jowisz na osi x, słońce daleko w bok, Ceres jako małe ciało.
// (planety w grze mają `name` angielskie — podpis „Earth”; komunikat odmowy po polsku z RADAR_PLANET_NAMES)
const EARTH = { id: 'earth', label: 'Earth', x: 2e6, y: 5e6, zone: { inner: 41202, outer: 46752, gravityWell: 55752 } };
const MARS = { id: 'mars', label: 'Mars', x: 2.6e6, y: 5e6, zone: { inner: 32700, outer: 38250, gravityWell: 47250 } };
const JUPITER = { id: 'jupiter', label: 'Jowisz', x: 3.5e6, y: 5e6, zone: { inner: 52200, outer: 57750, gravityWell: 66750 } };
const CERES = { id: 'ceres', label: 'Ceres', x: 3e6, y: 6e6, smallBody: true, zone: { inner: 10000, outer: 14000, gravityWell: 20000 } };
const SUN = { x: 5e6, y: 5e6 + 3e6, r: 823 };
function world(extra = {}) {
  const sc = {
    planets: [EARTH, MARS, JUPITER], window: { smallBodies: [CERES] },
    planetOrbitRadii: (p) => p.zone, formatPlanetOrbitLabel: (p) => p.label,
    SUN, mercMission: null, pirateOrbitRadii: () => ({ inner: 4 * 42253, outer: 6 * 42253, gravityWell: 7 * 42253 }),
    _playerTravelWells: [], haloWorld: null, haloRingKey: () => '', RADAR_PLANET_NAMES,
    ship: { pos: { x: 0, y: 0 }, w: 1800, h: 806, radius: 0 },
    ...extra
  };
  return fns(sc, ['putPlayerTravelWell', 'playerHullReach', 'playerTravelWells', 'playerWarpStartWell']);
}
const at = (body, r, ang = 0) => ({ x: body.x + Math.cos(ang) * r, y: body.y + Math.sin(ang) * r });

// ── pkt 4: podłoga łącznego zwolnienia ─────────────────────────────────────────────────────────────────────────────
test('pkt 4: podłoga = najgłębszy sam przelot (× 0,15); strefa × przelot nie niżej; strefa sama — bez zmian', () => {
  assert.ok(near(WARP_SLOW_FLOOR, 1 - WARP_FLYBY_DEFAULTS.depth, 1e-12), 'podłoga = sam przelot (najgłębsze zwolnienie przy ciele)');
  const fMin = warpFlybySlowdown(0, 0, 48000);   // przelot centralny nad tarczą (Jowisz)
  assert.ok(near(fMin, 0.15, 1e-12));
  assert.ok(near(warpSpeedFactor(0.3, fMin), 0.15, 1e-12), 'nad planetą w jej studni: × 0,15 (dawniej × 0,045)');
  assert.ok(near(warpSpeedFactor(0.3, fMin, 0), 0.045, 1e-12), 'bez podłogi — dawne × 0,045');
  assert.equal(warpSpeedFactor(0.3, 1), 0.3, 'strefa sama (bez ciała) — bez zmian');
  assert.equal(warpSpeedFactor(0.8, 1), 0.8);
  assert.equal(warpSpeedFactor(1, 0.5), 0.5, 'sam przelot — bez zmian');
  assert.ok(near(warpSpeedFactor(0.8, 0.15), 0.15, 1e-12), 'pas × przelot — podłoga');
  assert.ok(near(warpSpeedFactor(0.3, 0.6), 0.18, 1e-12), 'iloczyn ponad podłogą — bez zmian');
  assert.equal(warpSpeedFactor(0.1, 0.5), 0.1, 'strefa wolniejsza niż podłoga zostaje sobą (podłoga nie przyspiesza strefy)');
  assert.ok(near(warpSpeedFactor(1, 0.15 * 0.5), 0.15, 1e-12), 'dwa ciała naraz — też podłoga');
  assert.equal(warpSpeedFactor(NaN, NaN), 1);
});

test('pkt 4: plan prędkości liczy to samo co gra — przelot centralny nad Jowiszem, Mk I / II / III (uzasadnienie podłogi)', () => {
  // odcinek 1,5 mln j., Jowisz (r 48 tys., studnia 66,75 tys.) dokładnie na kursie w połowie
  const L = 1.5e6;
  const base = { dist: L, v0: 0, hullLength: 1800, bodies: [{ along: L / 2, lateral: 0, r: 48000 }],
    zone: (s) => (Math.abs(s - L / 2) < 66750 ? 0.3 : 1), entry: 0.9, lag: 6, dt: 1 / 60 };
  for (const id of ['warp_mk1', 'warp_mk2', 'warp_mk3']) {
    const tune = warpTripTuneFor(WARP_DRIVES[id].speed);
    const withFloor = planWarpCruise(base, tune);
    const old = planWarpCruise({ ...base, floor: 0 }, tune);
    assert.ok(Math.abs(withFloor.time - withFloor.target) < 0.05, `${id}: plan trafia w czas podróży`);
    // dawniej plan nadrabiał × 0,045 nad tarczą prędkością przelotową (+31–42%) — wszystko inne w kadrze szybciej
    assert.ok(old.speed > withFloor.speed * 1.3, `${id}: ${Math.round(old.speed)} vs ${Math.round(withFloor.speed)}`);
    // ta sama prędkość przelotowa: z podłogą wcześniej u celu (czas nad tarczą krótszy)
    assert.ok(simulateWarpLeg(withFloor.speed, base) < simulateWarpLeg(withFloor.speed, { ...base, floor: 0 }) - 1);
    // oś czasu planu (warpLegTimeline) — ta sama symulacja
    const T = new Float64Array(1);
    const res = {};
    assert.equal(warpLegTimeline(withFloor.speed, base, new Float64Array([L / 2]), T, res, withFloor.target + 30),
      simulateWarpLeg(withFloor.speed, base, withFloor.target + 30));
    assert.ok(T[0] > 0 && T[0] < res.exitT);
  }
  // gra: fizyka skoku i symulator soczewki — ta sama funkcja
  assert.match(html, /const maxWarpSpeed = \(warp\.cruise \|\| warp\.speed\) \* warpSpeedFactor\(zoneWarpMul, warp\.flybyFactor\);/);
  assert.match(read('scripts/webgpu/warp-soczewka-sym.mjs'), /const vmax = cruise \* WD\.warpSpeedFactor\(zoneAt\(x, y, sc\), WD\.warpFlybyFactor\(/);
});

test('pkt 4: podłoga 0,15 trzyma obraz przelotu centralnego w P4 z dużym zapasem (prawdziwa mapa O1, 1080p)', () => {
  // Mapa O1 (worldLens.js: warpLensFrame / warpLensQ — kadr 1080p, kotwica 189 px pod środkiem, napęd z WARP_DRIVES): punkt
  // osi kursu za statkiem, którego obraz leży na DOLNEJ krawędzi kadru (wylot dołem), jedzie |d(q · a)/da| · v. Przy
  // prędkości podłogi z sufitu planu (WARP_SLOW_FLOOR · vMax) — z zapasem pod P4 (60 px/kl.); granica P4 — podłoga ≥ 0,3.
  const anchorY = 189;
  for (const id of ['warp_mk1', 'warp_mk2', 'warp_mk3']) {
    const F = warpLensFrame(0, -1, 960, 540, 0, anchorY, WORLD_LENS_DEFAULTS, newWarpLensFrame(), WARP_DRIVES[id].speed);
    const Q = {};
    const img = (a) => warpLensQ(0, -a, 1, F.s, F, Q).q * a;   // obraz punktu osi kursu (a < 0 — za statkiem) [px od kotwicy]
    // a na dolnej krawędzi: |img(a)| = 540 − anchorY (bisekcja; obraz za statkiem rośnie monotonicznie)
    let lo = -F.A * 0.95;
    let hi = -1;
    for (let k = 0; k < 80; k++) {
      const m = (lo + hi) / 2;
      if (-img(m) > 540 - anchorY) lo = m; else hi = m;
    }
    const a = (lo + hi) / 2;
    const rate = Math.abs(img(a + 1) - img(a - 1)) / 2;   // px na j. drogi
    const vMax = warpTripTuneFor(WARP_DRIVES[id].speed).vMax;   // sufit prędkości przelotowej planu
    const edge = rate * WARP_SLOW_FLOOR * vMax / 60;
    assert.ok(edge < 30, `${id}: dolna krawędź przy suficie prędkości ${edge.toFixed(1)} px/kl. (a ${Math.round(a)} j.)`);
    assert.ok(60 / (rate * vMax / 60) > 0.3, `${id}: granica P4 podłogi ${(60 / (rate * vMax / 60)).toFixed(2)}`);
  }
});

// ── pkt 1: start skoku zablokowany w studni ─────────────────────────────────────────────────────────────────────────
test('pkt 1: studnie gracza — planety, małe ciała, słońce (noWarpStart, jądro rIn); baza piratów poza listą; pula w miejscu', () => {
  const w = world({ mercMission: { station: { x: 1e6, y: 1e6 } } });
  const a = w.playerTravelWells();
  assert.deepEqual(a.map((x) => x.body === SUN ? 'sun' : x.body.id), ['earth', 'mars', 'jupiter', 'ceres', 'sun']);
  assert.ok(a.every((x) => x.noWarpStart));
  assert.ok(a.every((x) => x.rFree === 0), 'bez świata ringów — wnętrza ringu nie ma');
  assert.equal(a[0].r, 55752);
  assert.equal(a[0].rIn, 46752, 'jądro = strefa orbit (ring + 3000)');
  assert.equal(a[4].r, 823 * 2, 'słońce: strefa sun');
  assert.equal(w.playerTravelWells(), a, 'ta sama tablica (bez alokacji w kroku TRAVEL TO)');
  // studnia, w której stoi punkt — najgłębsza, z drogą do brzegu
  const s = w.playerWarpStartWell(at(EARTH, 53402));
  assert.equal(s.body, EARTH);
  assert.ok(near(s.out, 55752 - 53402, 1e-6));
  assert.equal(w.playerWarpStartWell(at(EARTH, 55800)), null, 'za brzegiem — wolno');
  assert.equal(w.playerWarpStartWell(at(CERES, 15000)).body, CERES);
  assert.equal(w.playerWarpStartWell({ x: SUN.x + 1000, y: SUN.y }).body, SUN);
  assert.equal(w.playerWarpStartWell({ x: 1e6 + 1000, y: 1e6 }), null, 'studnia bazy piratów — start jak dawniej');
});

function keyWorld(pos) {
  const calls = { take: 0, choose: 0, exits: 0 };
  const sc = world({
    ship: { pos, angle: 0, destroyed: false, command: null },
    warp: { state: 'idle', fuel: 30, charge: 0, chargeAngle: NaN, exitRamp: null },
    warpCourse: { aim: null, autoExit: false, kind: '', label: '' },
    travelNav: { active: true, target: { x: 9e6, y: 5e6 }, label: 'CEL' },
    DevFlags: { unlimitedWarp: false }, messages: [],
    pushZoneMessage(m) { sc.messages.push(m); },
    takeManualWarpCourse() { calls.take++; sc.travelNav.active = false; },
    playerDriveDown: () => false, playerEnginesBlockDrive: () => false, clearPlayerAttackState() {},
    chooseManualWarpJump() { calls.choose++; return { kind: 'emergency', aim: { x: pos.x + 4e5, y: pos.y }, bearing: 0, plan: { dist: 4e5, cut: 'none' } }; },
    formatWarpJumpKm: (d) => `${Math.round(d / 1000)} KM`,
    exitWarp() { calls.exits++; }
  });
  sc.calls = calls;
  return fns(sc, ['playerWellBodyName', 'refusePlayerWarpInWell', 'startManualWarpCharge', 'attemptWarp']);
}

test('pkt 1: CapsLock / 9 / pad / UI w studni — odmowa z nazwą ciała i drogą do brzegu, bez ładowania i bez przejęcia TRAVEL TO', () => {
  for (const fn of ['attemptWarp', 'startManualWarpCharge']) {
    // przed bramą K-7 (53,4 tys. j. od środka Ziemi; brzeg studni 55,75 tys.)
    const k = keyWorld(at(EARTH, 53402, 0.3));
    k[fn]();
    assert.equal(k.warp.state, 'idle', fn);
    assert.equal(k.calls.take, 0, `${fn}: TRAVEL TO nie przejęty — automat wyprowadza dalej`);
    assert.equal(k.calls.choose, 0, `${fn}: bez wyboru skoku`);
    assert.equal(k.travelNav.active, true);
    // nazwa po polsku (recenzja rozgrywki ust. 4: podpis planety w grze to „Earth”)
    assert.deepEqual(k.messages, ['WARP: STUDNIA GRAWITACJI — ODLEĆ OD: ZIEMIA · 3 KM DO BRZEGU']);
  }
  const ce = keyWorld(at(CERES, 5000));
  ce.attemptWarp();
  assert.match(ce.messages[0], /ODLEĆ OD: CERES · 15 KM DO BRZEGU/);
  const sun = keyWorld({ x: SUN.x, y: SUN.y + 1200 });
  sun.attemptWarp();
  assert.match(sun.messages[0], /ODLEĆ OD: SŁOŃCE · 1 KM DO BRZEGU/, 'słońce — ta sama zasada (przyjęte w BRIEF-ie)');
  // poza studnią — zwykły wybór skoku i ładowanie
  const free = keyWorld(at(EARTH, 58800));
  free.attemptWarp();
  assert.equal(free.warp.state, 'charging');
  assert.ok(free.calls.take >= 1, 'przejęcie sterów jak dawniej');
  assert.equal(free.calls.choose, 1);
  // studnia bazy piratów — start jak dawniej
  const pir = keyWorld({ x: 1e6 + 50000, y: 1e6 });
  pir.mercMission = { station: { x: 1e6, y: 1e6 } };
  pir.attemptWarp();
  assert.equal(pir.warp.state, 'charging');
  // w skoku klawisz w studni nadal wychodzi (ucieczka), w ładowaniu — przerywa
  const fly = keyWorld(at(EARTH, 20000));
  fly.warp.state = 'active';
  fly.attemptWarp();
  assert.equal(fly.calls.exits, 1);
  assert.equal(fly.warp.state, 'idle');
  assert.deepEqual(fly.messages, []);
  // ścieżki klawisza (recenzja rozgrywki ust. 6): CapsLock / 9 i pad to akcja nav.warp (src/input/inputActions.js) →
  // attemptWarp (GameActions w index.html), UI — toggleWarpFromUI → attemptWarp; dawny handleWarpKeyDown nie jest wpięty
  const actions = read('src/input/inputActions.js');
  assert.match(actions, /'nav\.warp': \['CapsLock', 'Digit9', 'Numpad9'\]/);
  assert.match(actions, /'nav\.warp': \{ button: PB\.Y \}/);
  assert.match(html, /'nav\.warp': \{ gate: gaNotRts, run\(\) \{ attemptWarp\(\); \} \}/);
  assert.match(sliceFunction(html, '    function toggleWarpFromUI() {'), /attemptWarp\(\);/);
});

// ── pkt 2: w locie studnia planety nie hamuje ───────────────────────────────────────────────────────────────────────
test('pkt 2: przelot centralny przez studnię planety bez hamowania; słońce i baza piratów hamują; przechwyt misji 2 — jak dawniej', () => {
  const exits = [];
  const sc = fns({
    warp: { state: 'active', charge: 0, dir: { x: 1, y: 0 }, route: { x0: EARTH.x - 6e5, y0: EARTH.y },
      gravityBrake: { active: false, timer: 0, duration: 1.1, dir: { x: 0, y: 0 }, startSpeed: 0, sourceId: null } },
    ship: { pos: { x: EARTH.x - 6e4, y: EARTH.y }, vel: { x: 30000, y: 0 }, destroyed: false },
    planets: [EARTH], window: { smallBodies: [] }, planetOrbitRadii: (p) => p.zone,
    SUN, mercMission: { station: { x: EARTH.x + 2e6, y: EARTH.y } },
    GRAVITY_WELL_IDS: ['planet_gravity', 'pirate_gravity', 'sun'], WARP_BRAKE_WELL_IDS: ['pirate_gravity', 'sun'],
    MISSIONS: { active: [] }, enterPirateInnerOrbit() {},
    norm: (v) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; },
    exitWarp: (o) => exits.push(o),
    travelNav: { active: false }, cancelTravel() {}, warpCourse: {}, pushZoneMessage() {}
  }, ['isGravityWellZoneId', 'isWarpBrakeWellZoneId', 'resolveGravityWellSource', 'warpLeavingWell', 'triggerGravityWarpBrake',
    'handleZoneTransition', 'storyInterdictWarp']);
  // skok nad Ziemią: brzeg studni, strefy orbit, nad tarczą, wylot — stan skoku bez zmian
  const seq = ['interplanetary', 'planet_gravity', 'planet_outer', 'planet_inner', 'planet_outer', 'planet_gravity', 'interplanetary'];
  for (let i = 1; i < seq.length; i++) sc.handleZoneTransition(seq[i - 1], seq[i]);
  assert.equal(sc.warp.state, 'active');
  assert.deepEqual(exits, []);
  // baza piratów (skok ku bazie) — hamowanie grawitacyjne bez rampy
  sc.handleZoneTransition('interplanetary', 'pirate_gravity');
  assert.equal(sc.warp.state, 'idle');
  assert.equal(sc.warp.gravityBrake.sourceId, 'pirate_gravity');
  assert.deepEqual(exits, [{ abrupt: true }]);
  // słońce
  sc.warp.state = 'active';
  sc.warp.dir = { x: 0, y: 1 };
  sc.handleZoneTransition('interplanetary', 'sun');
  assert.equal(sc.warp.gravityBrake.sourceId, 'sun');
  // przechwyt fabularny misji 2 (zasadzka w pasie) — bez zmian
  sc.warp.state = 'active';
  assert.equal(sc.storyInterdictWarp(), true);
  assert.equal(sc.warp.gravityBrake.sourceId, 'story_interdict');
  assert.equal(exits.length, 3);
});

// ── pkt 3: planista bez objazdów studni planet ──────────────────────────────────────────────────────────────────────
function routeWorld(extra = {}) {
  return fns(world({
    WORLD: { w: 1e7, h: 1e7 }, clamp, travelNav: { obstacleMargin: 1100 },
    portDocks: { pushCruiseObstacles: (out) => out }, ...extra
  }), ['getCruiseGravityObstacles', 'segmentCirclePenetration', 'segmentCollisionScore', 'pushPointOutsideObstacles',
    'buildCruiseDetourPair', 'planCruiseRoute']);
}

test('pkt 3: TRAVEL TO Ziemia → Jowisz z Marsem na kursie — prosto nad Marsem (dawniej objazd); słońce na kursie — objazd', () => {
  const r = routeWorld();
  const from = at(EARTH, 58752, 0);
  const to = travelApproachPoint(JUPITER, from, JUPITER.zone.gravityWell);
  const route = r.planCruiseRoute(from, to);
  assert.equal(route.length, 1, 'bez objazdu Marsa');
  assert.ok(near(route[0].x, to.x) && near(route[0].y, to.y));
  // odcinek: skok prosto do brzegu studni Jowisza (cel nadal kończy skok na brzegu SWOJEJ studni)
  const leg = planTravelLeg(from, to, route, r.playerTravelWells(), { minWarp: TRAVEL_TUNE.minWarp });
  assert.equal(leg.kind, 'warp');
  assert.ok(near(leg.x, to.x) && near(leg.y, to.y));
  // cel W studni Jowisza (port przy ringu): skok kończy się na jej brzegu + zapas, reszta napędem
  const port = at(JUPITER, 60000, Math.PI);
  const legIn = planTravelLeg(from, port, r.planCruiseRoute(from, port), r.playerTravelWells(), { minWarp: TRAVEL_TUNE.minWarp });
  assert.equal(legIn.kind, 'warp');
  assert.equal(legIn.final, false);
  assert.ok(near(Math.hypot(legIn.x - JUPITER.x, legIn.y - JUPITER.y), 66750 + TRAVEL_TUNE.wellMargin, 1e-3));
  // słońce na drodze — objazd (strefa słońca zostaje przeszkodą)
  const a = { x: SUN.x - 5e5, y: SUN.y + 200 };
  const b = { x: SUN.x + 5e5, y: SUN.y - 200 };
  const det = r.planCruiseRoute(a, b);
  assert.ok(det.length > 1, 'objazd słońca');
  for (const p of det) assert.ok(Math.hypot(p.x - SUN.x, p.y - SUN.y) > 823 * 2 + 1100);
});

test('pkt 3: wyjście ze studni startu (wellExitPoint) — prosto ku celowi; przez jądro albo z jądra promieniowo; wymuszony kierunek; próg odcinka', () => {
  const well = { x: 0, y: 0, r: 55752, rIn: 46752 };
  const R = 55752 + TRAVEL_TUNE.wellExit;
  // statek w pasie studni poza jądrem (50 tys.), cel na zewnątrz — punkt na promieniu ku celowi
  const pos = { x: 50000, y: 0 };
  const p1 = wellExitPoint(pos, { x: 2e6, y: 3e5 }, well);
  assert.ok(near(Math.hypot(p1.x, p1.y), R, 1e-6));
  const u = Math.atan2(3e5, 2e6 - 50000);
  assert.ok(near(Math.atan2(p1.y - pos.y, p1.x - pos.x), u, 1e-9), 'najkrótsza droga w stronę celu');
  assert.equal(p1.radial, false);
  // cel za planetą — prosta przez jądro (ring, planeta): PROMIENIOWO (recenzja rozgrywki ust. 1 — dawna styczna jądra szła
  // przez hale K-7 i mijała planetę; promieniowy wylot + skok przez środek studni daje przelot nad tarczą)
  const p2 = wellExitPoint(pos, { x: -2e6, y: 1e5 }, well);
  assert.ok(near(p2.x, R, 1e-6) && near(p2.y, 0, 1e-6) && p2.radial === true);
  // statek w jądrze — promieniowo na zewnątrz
  const p3 = wellExitPoint({ x: 0, y: -46002 }, { x: 3e6, y: 0 }, well);
  assert.ok(near(p3.x, 0, 1e-6) && near(p3.y, -R, 1e-6));
  // kierunek wymuszony (wylot z doku osią doku) i najkrótszy odcinek (próg hipercruise'u — wydłużenie w tym samym kierunku)
  const p4 = wellExitPoint({ x: 0, y: 53000 }, { x: 0, y: -2e6 }, well, TRAVEL_TUNE.wellExit, {}, { dir: { x: 0, y: 2 }, minLen: 10300 });
  assert.ok(near(p4.x, 0, 1e-9) && near(p4.y, 53000 + 10300, 1e-6), 'osią doku, wydłużony do progu');
  const p5 = wellExitPoint({ x: 0, y: 30000 }, { x: 0, y: -2e6 }, well, TRAVEL_TUNE.wellExit, {}, { minLen: 10300 });
  assert.ok(near(p5.y, R, 1e-6), 'dłuższy niż próg — bez zmian');
  // odcinek przez koło (planista: cel w zapasie wyjścia — prosto tylko poza jądrem)
  assert.equal(segmentCrossesCircle({ x: 50000, y: 0 }, { x: -57000, y: 0 }, 0, 0, 46752), true);
  assert.equal(segmentCrossesCircle({ x: 50000, y: 0 }, { x: 57000, y: 3000 }, 0, 0, 46752), false);
});

test('pkt 1 + 3: planTravelLeg — start w studni noWarpStart: najpierw napędem za brzeg (wellExit), potem skok; cel w zapasie przez jądro — najpierw wyjście; wnętrze ringu — skok; holownik jak dawniej', () => {
  const r = routeWorld();
  const wells = r.playerTravelWells();
  const pos = at(EARTH, 53402, 0);
  const target = travelApproachPoint(JUPITER, pos, JUPITER.zone.gravityWell);
  const leg = planTravelLeg(pos, target, [target], wells, { minWarp: TRAVEL_TUNE.minWarp });
  assert.equal(leg.kind, 'drive');
  assert.equal(leg.final, false);
  assert.equal(leg.wellExit, true);
  assert.ok(near(Math.hypot(leg.x - EARTH.x, leg.y - EARTH.y), 55752 + TRAVEL_TUNE.wellExit, 1e-6));
  // tolerancja dolotu odcinka (stepTravelNav: 0,6 · arriveRadius) mniejsza niż zapas wyjścia — po dolocie statek poza studnią
  // co najmniej ~3 tys. j. (recenzja obrazu K1: bliżej niż ~2 tys. j. prawdziwy ring zostaje w kadrze skoku — symulator S12)
  assert.ok(TRAVEL_TUNE.wellExit - TRAVEL_TUNE.arriveRadius * 0.6 >= 3000);
  const out = { x: leg.x - (leg.x - EARTH.x) / Math.hypot(leg.x - EARTH.x, leg.y - EARTH.y) * 1900, y: leg.y };
  assert.equal(r.playerWarpStartWell(out), null);
  const next = planTravelLeg(out, target, [target], wells, { minWarp: TRAVEL_TUNE.minWarp });
  assert.equal(next.kind, 'warp', 'za brzegiem — skok');
  // cel w tej samej studni (stacja przy Ziemi) — napędem jak dawniej
  assert.deepEqual(planTravelLeg(pos, at(EARTH, 40000, 2), [at(EARTH, 40000, 2)], wells, { minWarp: TRAVEL_TUNE.minWarp }).kind, 'drive');
  // cel tuż za brzegiem (w zapasie wyjścia) po TEJ samej stronie — prosto
  const near1 = at(EARTH, 57000, 0.05);
  const lo1 = planTravelLeg(pos, near1, [near1], wells, { minWarp: 1000 });
  assert.ok(lo1.kind === 'drive' && lo1.final === true && near(lo1.x, near1.x));
  // … po DRUGIEJ stronie planety (recenzja rozgrywki: dawniej napęd prosto przez ring i planetę) — najpierw wyjście promieniowe
  const far1 = at(EARTH, 57000, Math.PI);
  const lo2 = planTravelLeg(pos, far1, [far1], wells, { minWarp: TRAVEL_TUNE.minWarp });
  assert.ok(lo2.kind === 'drive' && lo2.wellExit === true && lo2.x > EARTH.x + 55752, 'wyjście po swojej stronie');
  // bez paliwa — wszystko napędem jak dawniej
  assert.equal(planTravelLeg(pos, target, [target], wells, { minWarp: TRAVEL_TUNE.minWarp, warpOk: false }).wellExit, undefined);
  // WNĘTRZE RINGU (rFree — recenzja rozgrywki ust. 2: napęd wyjdzie stamtąd tylko tranzytem): skok wolno
  const ringW = wells.map((w) => ({ ...w, rFree: w.body === EARTH ? 41800 - 986 : 0 }));
  const inside = at(EARTH, 39000, 0.3);
  assert.equal(planTravelLeg(inside, target, [target], ringW, { minWarp: TRAVEL_TUNE.minWarp }).kind, 'warp');
  // holownik (serviceTug.js — getTravelWells bez noWarpStart): wylot skokiem jak dawniej
  const tug = planTravelLeg(pos, target, [target], wells.map((w) => ({ x: w.x, y: w.y, r: w.r })), { minWarp: TRAVEL_TUNE.minWarp });
  assert.equal(tug.kind, 'warp');
  assert.match(html, /wells: \(\) => getTravelWells\(\),/, 'holownik: studnie bez noWarpStart');
});

// ── recenzja rozgrywki ust. 1–3: wyjście ze studni z portu K-7 na PRAWDZIWEJ geometrii ringu i hal ──────────────────────
// Ring „Halo” (HaloRingWorld — kolidery Ziemi, Marsa, Jowisza: płyta, hale K-7, zatoki, pylony, tranzyty) i prawdziwe funkcje
// index.html (planetOrbitRadii, playerTravelWells, playerWellExitPoint). Starty: stanowiska capital C-01…C-04, statek po
// odcumowaniu przed bramą (k7IsOutsideHall), bok hali; cele co 10° — odcinek wyjścia (kadłub Atlasa wzdłuż odcinka co 60 j.)
// nie dotyka ścian ani płyty, kończy się za brzegiem studni i jest nie krótszy niż próg hipercruise'u.
function k7World(id) {
  const P = { id, name: id, x: 2e6, y: 5e6, r: 3000 };
  const haloWorld = new HaloRingWorld({ planets: [P] });
  const sc = fns({
    planets: [P], window: { smallBodies: [] }, haloWorld, haloRingKey, computeHaloRingLayout, SUN: null,
    ship: { pos: { x: 0, y: 0 }, w: 1800, h: 806, radius: 0 }, _playerTravelWells: [],
    portDocks: { count: 0, docks: [] }, syncPlayerHypercruise: () => true, playerHypercruiseStopMargin: () => 4100,
    HYPERCRUISE_TUNE, wellExitPoint, segmentCrossesCircle,
    _wellExitDock: { x: 0, y: 0, ax: 1, ay: 0, inside: false }, _wellExitOpts: { dir: { x: 1, y: 0 }, minLen: 0 }
  }, ['planetOrbitRadii', 'putPlayerTravelWell', 'playerHullReach', 'playerTravelWells', 'playerWarpStartWell',
    'playerWellExitMinLen', 'wellExitDockBlocked', 'playerWellExitPoint']);
  sc.P = P;
  return sc;
}
test('recenzja rozgrywki ust. 1–3: TRAVEL TO z K-7 (Ziemia, Mars, Jowisz) — wylot osią hali przez bramę, bez ścian i płyty, za brzeg studni, hipercruise; wnętrze ringu — skok', () => {
  for (const id of ['earth', 'mars', 'jupiter']) {
    const w = k7World(id);
    const P = w.P;
    const wells = w.playerTravelWells();
    const well = wells[0];
    const col = w.haloWorld.entries[0].collider;
    // jądro = pas budowli portu (płyta przed bramą + zasięg kadłuba), nie strefa orbit (hale stoją poza nią)
    assert.ok(well.rIn > col.wallsOuter + 600 && well.rIn <= well.r, `${id}: jądro ${well.rIn} ≥ pas budowli`);
    assert.ok(near(well.rFree, col.back - w.playerHullReach(), 1e-9), `${id}: wnętrze ringu do płyty − zasięg kadłuba`);
    const frame = k7FrameFor(P, 0);
    const starts = [
      ...[-810, 810, -2430, 2430].map((x) => [`C ${x}`, k7HubToGame(P, frame, x, 1900, {})]),
      ...[-2430, 0, 2430].map((x) => [`brama ${x}`, k7HubToGame(P, frame, x, 7400 + 1180 + 400, {})]),
      ['bok hali', k7HubToGame(P, frame, 4300, 3000, {})]
    ];
    const minLeg = HYPERCRUISE_TUNE.minLeg + 4100;
    for (const [name, pos] of starts) {
      w.ship.pos = { x: pos.x, y: pos.y };
      for (let deg = 0; deg < 360; deg += 10) {
        const a = deg * Math.PI / 180;
        const target = { x: P.x + Math.cos(a) * 2e6, y: P.y + Math.sin(a) * 2e6 };
        const leg = planTravelLeg(pos, target, [target], wells, { minWarp: TRAVEL_TUNE.minWarp, exitPoint: w.playerWellExitPoint });
        assert.ok(leg && leg.kind === 'drive' && leg.wellExit, `${id} ${name} ${deg}°: odcinek wyjścia`);
        const dx = leg.x - pos.x;
        const dy = leg.y - pos.y;
        const L = Math.hypot(dx, dy);
        assert.ok(L >= minLeg, `${id} ${name} ${deg}°: odcinek ${L.toFixed(0)} j. ≥ próg hipercruise'u`);
        assert.ok(Math.hypot(leg.x - P.x, leg.y - P.y) >= well.r + TRAVEL_TUNE.wellExit - 1, `${id} ${name} ${deg}°: za brzegiem studni`);
        const ang = Math.atan2(dy, dx);
        for (let s = 0; s <= L; s += 60) {
          const sh = { pos: { x: pos.x + dx / L * s, y: pos.y + dy / L * s }, vel: { x: 0, y: 0 }, angle: ang, w: 1800, h: 806, radius: 0 };
          const hit = w.haloWorld.constrainShip(sh, true);
          assert.ok(!(hit && hit.hit), `${id} ${name} ${deg}°: kadłub w ${s.toFixed(0)} j. odcinka dotyka ${hit && hit.lastWall}`);
        }
      }
    }
    // wnętrze ringu (między planetą a płytą habitatu): start skoku wolno — odcinek warpem, bez odmowy
    const inside = { x: P.x + col.back - 3000, y: P.y };
    w.ship.pos = inside;
    assert.equal(w.playerWarpStartWell(inside), null, `${id}: wnętrze ringu — bez odmowy`);
    const far = { x: P.x - 2e6, y: P.y };
    assert.equal(planTravelLeg(inside, far, [far], wells, { minWarp: TRAVEL_TUNE.minWarp, exitPoint: w.playerWellExitPoint }).kind, 'warp');
    // dawny wylot styczny z bramy (jądro = strefa orbit) przecinał halę — strażnik regresji
    const gate = k7HubToGame(P, frame, 0, 7400 + 1180 + 400, {});
    const behind = { x: 2 * P.x - gate.x, y: 2 * P.y - gate.y };
    const old = wellExitPoint(gate, behind, { x: P.x, y: P.y, r: well.r, rIn: planetOrbitOuter(id) }, TRAVEL_TUNE.wellExit);
    assert.equal(old.radial, true, `${id}: cel za planetą z bramy — promieniowo, nie styczną`);
  }
});
function planetOrbitOuter(id) {
  return computeHaloRingLayout({ id, name: id }).outerRadius + 3000;
}

// ── pkt 1 + 7: TRAVEL TO ze studni = hipercruise za brzeg + skok (prawdziwe stepTravelNav / nextTravelLeg) ───────────────
function navWorld(pos, target) {
  const hc = [];
  const sc = fns(world({
    ship: { pos, angle: 0, angVel: 0, destroyed: false, command: null, w: 1800, h: 806, radius: 0 },
    travelNav: { active: true, target, label: 'JOWISZ', phase: 'leg', leg: null, cmd: null, waypoints: [], waypointIndex: 0 },
    warp: { state: 'idle', fuel: 60, fuelMax: 60, charge: 0, chargeAngle: NaN, exitRamp: null, exitSlide: null, dir: { x: 1, y: 0 } },
    PAUSED: false, DevFlags: { unlimitedWarp: false }, TRAVEL_TUNE, planTravelLeg, wrapAngle,
    planCruiseRoute: (a, b) => [b], travelMinWarpDist: () => TRAVEL_TUNE.minWarp,
    playerHasManualInput: () => false, cancelTravel() {}, pushZoneMessage() {},
    createApproachCommand: (o) => ({ type: 'approach', ...o }),
    travelTryHypercruise: (leg) => { hc.push(leg); return true; },
    hypercruiseBusy: () => false, hypercruise: { state: 'idle' },
    playerDriveDown: () => false, playerEnginesNotRunning: () => false, autoIgnitePlayerEngines() {},
    playerWarpExitDistance: () => 12000, exitWarp() {},
    portDocks: { count: 0, docks: [] }, syncPlayerHypercruise: () => true, playerHypercruiseStopMargin: () => 4100,
    HYPERCRUISE_TUNE, wellExitPoint, segmentCrossesCircle,
    _wellExitDock: { x: 0, y: 0, ax: 1, ay: 0, inside: false }, _wellExitOpts: { dir: { x: 1, y: 0 }, minLen: 0 }
  }), ['playerWellExitMinLen', 'wellExitDockBlocked', 'playerWellExitPoint', 'refreshTravelRoute', 'nextTravelLeg', 'stepTravelNav']);
  sc.hc = hc;
  return sc;
}

test('pkt 1 + 7: TRAVEL TO z portu Ziemi — hipercruise za brzeg studni (odcinek ≥ próg hipercruise\'u), potem ładowanie skoku', () => {
  const pos = at(EARTH, 53402, 0.2);
  const target = travelApproachPoint(JUPITER, pos, JUPITER.zone.gravityWell);
  const n = navWorld(pos, target);
  n.stepTravelNav();
  assert.equal(n.travelNav.phase, 'drive');
  assert.equal(n.travelNav.leg.wellExit, true);
  assert.ok(Math.hypot(n.travelNav.leg.x - pos.x, n.travelNav.leg.y - pos.y) >= HYPERCRUISE_TUNE.minLeg + 4100,
    'odcinek wyjścia nie krótszy niż próg hipercruise\'u (recenzja rozgrywki ust. 3)');
  assert.equal(n.hc.length, 1, 'odcinek leci hipercruise (travelTryHypercruise — ten sam odcinek)');
  assert.equal(n.hc[0], n.travelNav.leg);
  assert.equal(n.ship.command.type, 'approach');
  // dolot autopilota (punkt odcinka w tolerancji) — następny odcinek: skok
  n.ship.pos = { x: n.travelNav.leg.x - 1500, y: n.travelNav.leg.y };
  n.stepTravelNav();
  assert.equal(n.travelNav.phase, 'leg');
  n.stepTravelNav();
  assert.equal(n.travelNav.phase, 'align');
  assert.equal(n.travelNav.leg.kind, 'warp');
  n.ship.angle = Math.atan2(n.travelNav.leg.y - n.ship.pos.y, n.travelNav.leg.x - n.ship.pos.x);
  n.stepTravelNav();
  assert.equal(n.warp.state, 'charging', 'za brzegiem studni — ładowanie');
  assert.equal(n.travelNav.phase, 'charge');
  // straż ładowania: statek z powrotem w studni (dryf) — skok nie rusza, nowy odcinek z planisty
  const g = navWorld(at(EARTH, 50000, 0.2), target);
  g.travelNav.phase = 'align';
  g.travelNav.leg = { x: target.x, y: target.y, kind: 'warp', final: true };
  g.travelNav.cmd = { type: 'hold' };
  g.ship.angle = Math.atan2(target.y - g.ship.pos.y, target.x - g.ship.pos.x);
  g.stepTravelNav();
  assert.equal(g.warp.state, 'idle');
  assert.equal(g.travelNav.phase, 'leg');
  g.stepTravelNav();
  assert.equal(g.travelNav.leg.wellExit, true);
  // planista gry dostaje punkt wyjścia z playerWellExitPoint (wylot z doku osią hali, próg hipercruise'u)
  assert.match(sliceFunction(html, '    function nextTravelLeg() {'), /exitPoint: playerWellExitPoint/);
});

test('pkt 3 (recenzja obrazu D3): skok awaryjny — prawdziwe warpEmergencyWells: planeta na kursie nie skraca, słońce tak', () => {
  const PLANET = { id: 'mars', label: 'Mars', x: 1.2e5, y: 0, zone: { inner: 32700, outer: 38250, gravityWell: 47250 } };
  const sc = fns(world({ planets: [PLANET], window: { smallBodies: [] }, SUN: { x: 3e5, y: 0, r: 823 } }), ['pirateWarpWell', 'warpEmergencyWells']);
  const wells = sc.warpEmergencyWells();
  assert.deepEqual(wells.map((w) => w.label), ['SŁOŃCE'], 'tylko studnie hamujące (bez bazy piratów poza misją)');
  const pos = { x: 0, y: 0 };
  const em = planWarpEmergency(pos, 1, 0, wells, null);
  assert.equal(em.cut, 'well');
  assert.equal(em.well.label, 'SŁOŃCE');
  assert.ok(near(em.dist, 3e5 - 1646 - WARP_EMERGENCY.wellMargin, 1e-6), 'słońce skraca skok (koniec z rampą przed strefą)');
  assert.ok(em.dist > PLANET.x + PLANET.zone.gravityWell, 'skok przelatuje nad Marsem (jego studnia nie skraca)');
  // z bazą piratów (misja 1) — też studnia hamująca
  sc.mercMission = { station: { x: 2e6, y: 0 } };
  assert.deepEqual(sc.warpEmergencyWells().map((w) => w.label), ['SŁOŃCE', 'BAZA PIRATÓW']);
});

// ── plan skoku: planeta startu, nad którą skok przelatuje, jest mijanym ciałem; księżyce z bryłą w zwolnieniu ─────────────
test('pkt 3: skok nad planetą startu (wyjście ze studni, cel za planetą) — planeta jest mijanym ciałem; księżyce z bryłą zwalniają skok (bez księżyców celu)', () => {
  const route = () => ({ active: false, kind: 'none', arrive: 'none', x0: NaN, y0: NaN, x1: NaN, y1: NaN, dist: NaN, exitT: NaN,
    time: NaN, cruise: NaN, flyBody: null, flyAlong: NaN, flyLateral: NaN, flyT: NaN, beltIn: NaN, beltOut: NaN, beltTIn: NaN, beltTOut: NaN });
  const mk = (pos) => fns({
    performance, ship: { pos }, travelNav: { active: true, leg: null }, _tugWarp: { active: false },
    warpCourse: { aim: null, autoExit: false, kind: '', label: '' },
    planWarpEmergency, warpEmergencyWells: () => [], WORLD: { w: 1e7, h: 1e7 }, WARP_EMERGENCY, _warpEmergencyPlan: {},
    planets: [EARTH, JUPITER], window: { smallBodies: [] }, planetOrbitRadii: (p) => p.zone,
    WARP_ORIGIN_REACH: 100000, WARP_TARGET_REACH: 25000, _warpFlybyBodies: [], _warpFlybyCount: 0,
    warpBodyRadius: (p) => (p === EARTH ? 37800 : 48000),
    warp: { speed: 175000, entryDuration: 0.9, cruise: 0, tripPlan: null, originBody: null, targetBody: null, route: route() },
    detectZones: () => ({ current: { id: 'interplanetary', warpMultiplier: 1 } }),
    planWarpCruise, warpTripTuneFor, warpLegTimeline, warpExitRampTime, warpExitRampDistance, warpMoonReach, moonsOf,
    MOON_BODY_TUNES, moonGameNode, moonStartAngle, moonOrbitRadius, moonBodyRadius, haloRingKey, resolveRingPlanetWorldRadius,
    warpFlybyFactor, getPlayerSpeed: () => 0, playerWarpHullLength: () => 1800,
    driveState: { flightSpec: { maxSpeed: 500 }, brakeAccel: 200 }, PLAYER_WARP_MOMENTUM: { k: 3 }, _playerWarpExit: {},
    _warpRouteMarks: new Float64Array(3), _warpRouteMarkT: new Float64Array(3), _warpRouteTimeline: { exitT: NaN, exitV: 0, exitS: 0 }
  }, ['playerWarpLegEnd', 'warpWellEdgeDist', 'warpPlanetNear', 'warpCourseCrossesWell', 'playerWarpExitPlan', 'planPlayerWarp',
    'playerWarpFlybyFactor']);
  // z brzegu studni Ziemi (po stronie przeciwnej Jowiszowi) skok do Jowisza przez Ziemię
  const behind = mk(at(EARTH, 58752, Math.PI));
  const tgt = travelApproachPoint(JUPITER, behind.ship.pos, 66750);
  behind.travelNav.leg = { x: tgt.x, y: tgt.y, kind: 'warp' };
  behind.planPlayerWarp(1, 0);
  assert.equal(behind.warp.originBody, null, 'Ziemia przed dziobem — nie ciało startu');
  assert.equal(behind.warp.route.flyBody, EARTH, 'najbardziej widoczne mijane ciało — Ziemia (księżyce tylko zwalniają)');
  assert.equal(behind.warp.targetBody, JUPITER);
  // KSIĘŻYCE Z BRYŁĄ (recenzja obrazu W4): Luna w zwolnieniu (miejsce i promień jak w obrazie — src/data/moonBodies.js),
  // księżyce Jowisza (cel) — nie
  const list = behind._warpFlybyBodies.slice(0, behind._warpFlybyCount);
  const moons = list.filter((b) => b.moon);
  assert.equal(moons.length, 1, 'tylko Luna (księżyce celu jadą jego skalą)');
  const node = moonGameNode(MOON_BODY_TUNES.earth[0]);
  assert.ok(near(moons[0].x, EARTH.x + Math.cos(node.angle) * 96000, 1e-6) && near(moons[0].y, EARTH.y + Math.sin(node.angle) * 96000, 1e-6));
  assert.ok(near(moons[0].r, 37800 * 0.24, 1e-9), 'promień bryły Luny (ułamek promienia Ziemi z ringiem)');
  // fizyka skoku: miejsce księżyca od rodzica w każdym kroku (playerWarpFlybyFactor)
  behind.ship.pos = { x: moons[0].x - 20000, y: moons[0].y };
  behind.warp.dir = { x: 1, y: 0 };
  assert.ok(behind.playerWarpFlybyFactor() < 0.9, 'przy Lunie skok zwalnia');
  // z brzegu po stronie Jowisza — Ziemia za rufą: ciało startu jak dawniej
  const ahead = mk(at(EARTH, 58752, 0));
  ahead.travelNav.leg = { x: tgt.x, y: tgt.y, kind: 'warp' };
  ahead.planPlayerWarp(1, 0);
  assert.equal(ahead.warp.originBody, EARTH);
  assert.equal(ahead.warp.route.flyBody, null);
});

// ── recenzja rozgrywki ust. 5: przelot nad planetą bez serii komunikatów stref ───────────────────────────────────────────
test('recenzja rozgrywki ust. 5: w skoku i hipercruise\'ie strefy planet bez komunikatów (słońce, pas — jak dawniej)', () => {
  const sc = fns({ warp: { state: 'active' }, window: { hypercruise: { state: 'idle' } }, hypercruiseDriving: (hc) => hc.state === 'active' },
    ['zoneMessageQuiet']);
  for (const id of ['planet_gravity', 'planet_outer', 'planet_inner']) assert.equal(sc.zoneMessageQuiet({ id }), true, id);
  for (const id of ['sun', 'asteroid_belt', 'pirate_gravity', 'interplanetary']) assert.equal(sc.zoneMessageQuiet({ id }), false, id);
  sc.warp.state = 'idle';
  assert.equal(sc.zoneMessageQuiet({ id: 'planet_gravity' }), false, 'poza skokiem — jak dawniej');
  sc.window.hypercruise.state = 'active';
  assert.equal(sc.zoneMessageQuiet({ id: 'planet_outer' }), true, 'hipercruise nad planetą');
  const upd = sliceFunction(html, '    function updateZoneState(dt) {');
  assert.match(upd, /if \(zoneState\.current\.label && !zoneMessageQuiet\(zoneState\.current\)\) \{/);
  assert.match(upd, /if \(zoneState\.approaching\?\.enteringLabel && !zoneMessageQuiet\(zoneState\.approaching\)\) \{/);
});

test('próba w grze 10-27: pył hali K-7 gaśnie w soczewce skoku (przelot nad Ziemią bez „ducha hali”)', () => {
  // hala stoi w prawdziwym miejscu, ring jedzie z obrazem planety — w soczewce pakowanie pyłu hali nie dostaje ringów
  const i = html.indexOf('packHallDustFrame(HallDust.input, {');
  assert.ok(i > 0, 'wywołanie packHallDustFrame w render()');
  const call = html.slice(i, html.indexOf('});', i));
  assert.match(call, /rings:\s*haloWorld\s*&&\s*warpLensHudWorld\(\)\s*\?\s*haloWorld\.entries\s*:\s*null/);
  assert.match(html, /function warpLensHudWorld\(\) \{ return _hudLensAlpha > 1 - WARP_LENS_DOT_SWAP; \}/);
});
