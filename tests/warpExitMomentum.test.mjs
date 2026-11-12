// Wyjście z warpa z pędem (2026-10-19, scena „Wojna”): hamowanie przylotu NPC kończy się na k × prędkość bojowa klasy,
// okręt wraca do gry z tą prędkością wzdłuż kursu, a nadmiar ścina zwykły model lotu — ślizg z planu (warpExitMomentum)
// = ślizg modelu lotu. Rejestr ruchu warpa: punkt przylotu = koniec ślizgu, duch do końca hamowania, w ślizgu twardy.
//   node --test tests/warpExitMomentum.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WARP_EXIT_MOMENTUM, WARP_RUSH, createWarpArrival, planWarpRush, sampleWarpRush, warpBrakeTime, warpExitMomentum
} from '../src/game/warpDrive.js';
import { createWarpTraffic, planWarpArrivalAxis } from '../src/game/warpTraffic.js';
import { buildShipFlightSpec, setFlightArrive, stepShipFlight } from '../src/game/flight/shipFlightModel.js';

const HULLS = [
  ['terran_frigate', 'frigate_pd'], ['terran_destroyer', 'destroyer'], ['terran_battleship', 'battleship'],
  ['terran_carrier', 'carrier'], ['terran_supercapital', 'supercapital'],
  ['pirate_frigate', 'frigate_pd'], ['pirate_destroyer', 'destroyer'], ['pirate_battleship', 'battleship']
];

test('profil: vExit = k × maxSpeed, ślizg ≈ (k² − 1)·v² / (2 · 1,5 · decel) + ogon pilota; k = 0 — zatrzymanie, k < 1 — bez ślizgu', () => {
  assert.equal(WARP_EXIT_MOMENTUM.k, 3);
  for (const [hull] of HULLS) {
    const spec = buildShipFlightSpec(hull);
    const m = warpExitMomentum(spec);
    assert.equal(m.vExit, 3 * spec.maxSpeed, hull);
    const flat = 8 * spec.maxSpeed ** 2 / (3 * spec.decel);
    assert.ok(m.slide > flat && m.slide < flat * 1.1, `${hull}: ${m.slide.toFixed(0)} vs ${flat.toFixed(0)}`);
    assert.ok(m.slideTime > 2 * spec.maxSpeed / (1.5 * spec.decel), hull);
    // klasy Terra Nova i piraci: ślizg rzędu kilometrów, nie dziesiątek
    assert.ok(m.slide > 2500 && m.slide < 4500, `${hull}: ślizg ${m.slide.toFixed(0)}`);
  }
  const spec = buildShipFlightSpec('terran_destroyer');
  assert.deepEqual(warpExitMomentum(spec, 0), { vExit: 0, combat: spec.maxSpeed, slide: 0, slideTime: 0 });
  const slow = warpExitMomentum(spec, 0.5);
  assert.equal(slow.vExit, 0.5 * spec.maxSpeed);
  assert.equal(slow.slide, 0);
  assert.equal(warpExitMomentum(null).vExit, 0, 'bez specyfikacji — bez pędu');
});

test('rozpęd z pędem: hamowanie z v0 do vExit na tej samej drodze, ciągłość drogi i prędkości, potem lot z vExit', () => {
  const L = 900;
  const vE = 3000;
  const a = planWarpRush(createWarpArrival({ x: 0, y: 0, angle: 0, hullLength: L, startTime: 0 }), WARP_RUSH.arriveDist, vE);
  assert.equal(a.vExit, vE);
  assert.ok(Math.abs(a.brake - 2 * WARP_RUSH.brakeDist * L / (a.v0 + vE)) < 1e-12);
  assert.ok(Math.abs(warpBrakeTime(L, a.v0, vE) - a.brake) < 1e-12);
  const s = {};
  // tuż przed i tuż po końcu hamowania: droga i prędkość ciągłe, droga hamowania = brakeDist × L
  sampleWarpRush(a, a.tBrake, s);
  const along0 = s.along;
  sampleWarpRush(a, a.tStop - 1e-6, s);
  assert.ok(Math.abs(s.along - a.rushDist) < 0.1 && Math.abs(s.speed - vE) < 1);
  assert.ok(Math.abs((a.rushDist - along0) - WARP_RUSH.brakeDist * L) < 1e-6);
  sampleWarpRush(a, a.tStop + 1e-6, s);
  assert.ok(Math.abs(s.along - a.rushDist) < 0.1 && s.speed === vE);
  sampleWarpRush(a, a.tStop + 2, s);
  assert.ok(Math.abs(s.off - 2 * vE) < 1e-6, 'po hamowaniu okręt leci dalej z vExit');
  // prędkość maleje monotonicznie do vExit, nigdy poniżej
  let prev = Infinity;
  for (let t = a.tBrake; t <= a.tStop + 0.5; t += 0.005) {
    sampleWarpRush(a, t, s);
    assert.ok(s.speed <= prev + 1e-9 && s.speed >= vE - 1e-9);
    prev = s.speed;
  }
  // vExit = 0 — dawny profil co do bitu
  const b = planWarpRush(createWarpArrival({ x: 0, y: 0, angle: 0, hullLength: L, startTime: 0 }));
  assert.equal(b.vExit, 0);
  assert.equal(b.brake, warpBrakeTime(L, b.v0));
  sampleWarpRush(b, b.tStop + 3, s);
  assert.equal(s.off, 0);
  assert.equal(s.speed, 0);
});

test('ślizg z planu = ślizg modelu lotu (pilot w trybie bojowym naprzód: decel + governor), każda klasa ±1,5%', () => {
  const DT = 1 / 120;
  for (const [hull, type] of HULLS) {
    const spec = buildShipFlightSpec(hull);
    const m = warpExitMomentum(spec);
    const e = { x: 0, y: 0, vx: m.vExit, vy: 0, angle: 0, angVel: 0, mission: true, type, shipFrame: hull };
    let brainT = 0;
    let t = 0;
    while (Math.hypot(e.vx, e.vy) > spec.maxSpeed * 1.0005 && t < 60) {
      if (brainT <= 0) { setFlightArrive(e, e.x + 50000, 0, { speedMode: 'combat' }); brainT = 0.05; }
      stepShipFlight(e, DT);
      brainT -= DT;
      t += DT;
    }
    const err = Math.abs(e.x - m.slide) / m.slide;
    assert.ok(err < 0.015, `${hull}: model ${e.x.toFixed(0)} j., plan ${m.slide.toFixed(0)} j. (${(err * 100).toFixed(1)}%)`);
    assert.ok(Math.abs(t - m.slideTime) / m.slideTime < 0.03, `${hull}: czas ${t.toFixed(2)} s, plan ${m.slideTime.toFixed(2)} s`);
  }
});

test('oś przylotu z pędem: punkt przylotu = koniec ślizgu, hamowanie kończy się `slide` przed nim', () => {
  const ang = 0.6;
  const a = planWarpArrivalAxis({ x: 10000, y: -2000, angle: ang, hullLength: 700, hullWidth: 250, startTime: 1, exitSpeed: 4200, slide: 2600 });
  assert.equal(a.ex, 10000);
  assert.equal(a.ey, -2000);
  assert.equal(a.slide, 2600);
  assert.ok(Math.abs(a.x - (10000 - Math.cos(ang) * 2600)) < 1e-9 && Math.abs(a.y - (-2000 - Math.sin(ang) * 2600)) < 1e-9);
  assert.equal(a.sx, a.x, 'zwiastun (nić, błysk) w punkcie wyjścia — końcu hamowania');
  assert.equal(a.vExit, 4200);
  // bez pędu: dawny przylot (punkt = miejsce zatrzymania)
  const b = planWarpArrivalAxis({ x: 10000, y: -2000, angle: ang, hullLength: 700, startTime: 1, slide: 2600 });
  assert.equal(b.x, 10000);
  assert.equal(b.vExit, 0);
  assert.equal(b.slide, 0, 'ślizg bez prędkości wyjścia nic nie znaczy');
  assert.equal(b.heraldStyle, 'thread');
  assert.equal(planWarpArrivalAxis({ x: 0, y: 0, hullLength: 400, heraldStyle: 'ripple' }).heraldStyle, 'ripple');
  assert.equal(planWarpArrivalAxis({ x: 0, y: 0, hullLength: 400, heraldStyle: 'zła' }).heraldStyle, 'thread');
});

test('rejestr: duch do końca hamowania, potem twardy okręt z vExit wzdłuż kursu; przylot „teraz” bierze pęd z resolvera', () => {
  const t = createWarpTraffic();
  const ang = -0.4;
  const rec = t.planArrival({ x: 5000, y: 3000, angle: ang, hullLength: 600, hullWidth: 220, burstIn: 0.8, exitSpeed: 3000, slide: 2400 });
  const fx = rec.fx;
  const e = { x: fx.x0, y: fx.y0, vx: 0, vy: 0, angle: ang, isCollidable: true };
  t.attach(rec, e);
  let released = false;
  for (let i = 0; i < 600 && !released; i++) {
    t.step(1 / 60);
    if (t.time < fx.tStop) assert.equal(e.isCollidable, false, 'w tunelu i w hamowaniu — duch');
    else released = true;
  }
  assert.ok(released);
  assert.equal(e.isCollidable, true, 'w ślizgu twardy');
  const sp = Math.hypot(e.vx, e.vy);
  assert.ok(Math.abs(sp - 3000) < 1e-6, `prędkość po hamowaniu ${sp}`);
  assert.ok(Math.abs(Math.atan2(e.vy, e.vx) - ang) < 1e-9, 'wzdłuż kursu');
  // poza z osi w klatce zwolnienia: koniec hamowania + vExit · (czas od tStop)
  const late = t.time - fx.tStop;
  assert.ok(Math.hypot(e.x - (fx.x + Math.cos(ang) * 3000 * late), e.y - (fx.y + Math.sin(ang) * 3000 * late)) < 1e-6);
  // dalej okręt prowadzi gra — rejestr nie pisze pozy
  e.x += 123;
  t.step(1 / 60);
  assert.equal(e.x, fx.x + Math.cos(ang) * 3000 * late + 123);

  const t2 = createWarpTraffic({ momentum: (en) => (en.kind === 'fast' ? { vExit: 2000, slide: 1500 } : null) });
  const fast = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, kind: 'fast' };
  const r2 = t2.arrive(fast);
  assert.equal(r2.fx.vExit, 2000);
  assert.equal(r2.fx.ex, 0);
  assert.equal(r2.fx.x, -1500, 'gra postawiła okręt w punkcie przylotu — hamowanie przed nim');
  const plain = t2.arrive({ x: 0, y: 0, vx: 0, vy: 0, angle: 0 });
  assert.equal(plain.fx.vExit, 0);
  assert.equal(plain.fx.x, 0);
  assert.equal(t2.arrive({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, kind: 'fast' }, { exit: null }).fx.vExit, 0, 'opts.exit = null — zatrzymanie');
});

test('warp-in prowadzony przez grę: hamowanie obrazu kończy się na prędkości, z którą gra puściła okręt', () => {
  const t = createWarpTraffic();
  const npc = { x: 0, y: 0, vx: 4000, vy: 0, angle: 0, state: 'warping_in', warpData: { speed: 4000 }, isCollidable: false };
  t.noteWarpIn(npc);
  t.step(1 / 60);
  const fx = t.records[0].fx;
  npc.state = 'engage_formation';
  npc.vx = 2100;
  t.step(1 / 60);
  assert.equal(fx.v0, 4000);
  assert.equal(fx.vExit, 2100);
  assert.ok(Math.abs(fx.brake - warpBrakeTime(fx.hullLength, 4000, 2100)) < 1e-12);
});

test('ślizg z flagą wyjścia: mózg w trybie dolotu (travel) nie podtrzyma nadmiaru — droga jak z planu, flaga gaśnie', () => {
  const DT = 1 / 120;
  for (const [hull, type] of [['terran_frigate', 'frigate_pd'], ['terran_battleship', 'battleship'], ['pirate_destroyer', 'destroyer']]) {
    const spec = buildShipFlightSpec(hull);
    const m = warpExitMomentum(spec);
    const run = (flag) => {
      const e = { x: 0, y: 0, vx: m.vExit, vy: 0, angle: 0, angVel: 0, mission: true, type, shipFrame: hull, __warpExitSlide: flag };
      let brainT = 0;
      let t = 0;
      // koniec ślizgu: flaga zgaszona (≤ 1,01 maxSpeed) albo — bez flagi — prędkość bojowa
      while ((flag ? e.__warpExitSlide : Math.hypot(e.vx, e.vy) > spec.maxSpeed * 1.01) && t < 30) {
        if (brainT <= 0) { setFlightArrive(e, e.x + 80000, 0, { speedMode: 'travel' }); brainT = 0.05; }
        stepShipFlight(e, DT);
        brainT -= DT;
        t += DT;
      }
      return { x: e.x, t, flag: e.__warpExitSlide };
    };
    const withFlag = run(true);
    assert.ok(Math.abs(withFlag.x - m.slide) / m.slide < 0.03, `${hull}: ślizg z flagą ${withFlag.x.toFixed(0)} vs plan ${m.slide.toFixed(0)}`);
    assert.equal(withFlag.flag, false, `${hull}: flaga zgaszona przy prędkości bojowej`);
    const noFlag = run(false);
    if (spec.travelSpeed > spec.maxSpeed * 1.01) {
      assert.ok(noFlag.t >= 30 || noFlag.x > withFlag.x * 1.5, `${hull}: bez flagi tryb dolotu trzyma prędkość powyżej bojowej`);
    }
  }
});

// GRACZ (port dema „Pęd” do gry, 2026-10-23): rampa wyjścia kończy się na k × prędkość bojowa, potem ślizg tabelowym
// hamowaniem kadłuba do prędkości bojowej; TRAVEL TO i ręczny kurs liczą wyjście z drogi rampy + ślizgu (koniec ślizgu
// w punkcie odcinka); przeszkoda na kursie (płyta ringu, koło doku) — ślizg staje przed nią.
import { createWarpExitRamp, sampleWarpExitRamp, warpExitRampDistance } from '../src/game/warpDrive.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

function playerExitScope(over = {}) {
  const html = readIndexHtml();
  const scope = {
    PLAYER_WARP_MOMENTUM: { k: WARP_EXIT_MOMENTUM.k },
    _playerWarpExit: { vEnd: 0, vMin: 0, decel: 200, ramp: 0, slide: 0, total: 0 },
    PLAYER_WARP_SLIDE_MARGIN: Number(/const PLAYER_WARP_SLIDE_MARGIN = (\d+);/.exec(html)[1]),
    driveState: { flightSpec: { maxSpeed: 600, decel: 150 }, brakeAccel: 200 },
    warpExitRampDistance,
    playerWarpHullLength: () => 1800,
    getPlayerSpeed: () => 175000,
    ship: { pos: { x: 0, y: 0 }, radius: 1000, w: 1800, h: 600 },
    haloWorld: null,
    portDocks: { count: 0, docks: [] },
    warp: { exitSlide: null },
    ...over
  };
  for (const [header, name] of [
    ['function playerWarpExitPlan(v0, momentum = true, out = _playerWarpExit) {', 'playerWarpExitPlan'],
    ['function playerWarpExitDistance(momentum = true) {', 'playerWarpExitDistance'],
    ['function playerWarpObstacleAhead(x, y, dx, dy, range) {', 'playerWarpObstacleAhead'],
    ['function startPlayerWarpSlide(dirX, dirY, speed) {', 'startPlayerWarpSlide'],
    ['function stopPlayerWarpSlide() {', 'stopPlayerWarpSlide']
  ]) scope[name] = loadIndexFunction(html, header, name, scope);
  return { html, scope };
}

// Ślizg jak w physicsStep (gałąź warp.exitSlide): prędkość maleje decel·dt, droga = Σ v·dt.
function runSlide(sl, dt = 1 / 600) {
  let x = 0;
  for (let i = 0; i < 1e6 && sl.active; i++) {
    sl.speed = Math.max(sl.vMin, sl.speed - sl.decel * dt);
    x += sl.speed * dt;
    if (sl.speed <= sl.vMin + 1e-6) sl.active = false;
  }
  return x;
}

test('gracz: plan wyjścia z pędem — vEnd = k × prędkość bojowa, ślizg tabelowym hamowaniem, droga = rampa + ślizg', () => {
  const { scope } = playerExitScope();
  const v0 = 175000;
  const p = scope.playerWarpExitPlan(v0, true, {});
  assert.equal(p.vEnd, 3 * 600);
  assert.equal(p.vMin, 600);
  assert.equal(p.decel, 200);
  assert.equal(p.ramp, warpExitRampDistance(v0, 1800, 1800));
  assert.equal(p.slide, (1800 ** 2 - 600 ** 2) / (2 * 200));
  assert.equal(p.total, p.ramp + p.slide);
  assert.equal(scope.playerWarpExitDistance(), p.total);
  // bez pędu (holownik, hamowanie grawitacyjne, ?pedGracz=0) — rampa do zatrzymania jak dawniej
  const stop = scope.playerWarpExitPlan(v0, false, {});
  assert.equal(stop.vEnd, 0);
  assert.equal(stop.slide, 0);
  assert.equal(stop.total, warpExitRampDistance(v0, 1800));
  scope.PLAYER_WARP_MOMENTUM = { k: 0 };
  assert.equal(scope.playerWarpExitDistance(), warpExitRampDistance(v0, 1800));
  // rampa z vEnd kończy się na vEnd, ślizg z niej przejeżdża dokładnie `slide`
  scope.PLAYER_WARP_MOMENTUM = { k: 3 };
  const r = createWarpExitRamp({ v0, hullLength: 1800, vEnd: p.vEnd });
  const s = sampleWarpExitRamp(r, r.tHalt + 1, {});
  assert.equal(s.phase, 'done');
  assert.ok(Math.abs(s.speed - p.vEnd) < 1e-6, `koniec rampy ${s.speed}`);
  scope.startPlayerWarpSlide(1, 0, s.speed);
  const sl = scope.warp.exitSlide;
  assert.equal(sl.active, true);
  const d = runSlide(sl);
  assert.ok(Math.abs(d - p.slide) < p.slide * 0.002, `ślizg ${d.toFixed(1)} vs ${p.slide}`);
  assert.ok(Math.abs(sl.speed - 600) < 1e-6, 'dalej zwykły lot z prędkością bojową');
  scope.startPlayerWarpSlide(1, 0, 600);
  assert.equal(scope.warp.exitSlide.active, false, 'wyjście nie szybsze od prędkości bojowej — bez ślizgu');
});

test('gracz: ślizg nie wjeżdża w płytę ringu ani w koło doku — staje przed przeszkodą z zapasem', () => {
  const margin = Number(/const PLAYER_WARP_SLIDE_MARGIN = (\d+);/.exec(readIndexHtml())[1]);
  const reach = 1000;
  const cases = [
    ['płyta ringu', { haloWorld: { rayToSlab: (x, y, dx, dy, len, pad) => (pad === reach ? 4000 + reach : Infinity) } }, 4000],
    ['koło doku', { portDocks: { count: 1, docks: [{ x: 6000, y: 0, keepR: 1000 }] } }, 6000 - 1000 - reach]
  ];
  for (const [name, over, obst] of cases) {
    const { scope } = playerExitScope(over);
    assert.ok(Math.abs(scope.playerWarpObstacleAhead(0, 0, 1, 0, 1e5) - obst) < 1e-6, name);
    scope.startPlayerWarpSlide(1, 0, 1800);
    const sl = scope.warp.exitSlide;
    assert.equal(sl.vMin, 0, `${name}: do zatrzymania`);
    const d = runSlide(sl);
    assert.ok(d <= obst - margin + 2 && d > obst - margin - 50, `${name}: staje ${d.toFixed(0)} j. (przeszkoda ${obst})`);
    assert.equal(sl.speed, 0);
  }
  // przeszkoda dalej niż droga ślizgu — zwykły ślizg do prędkości bojowej
  const far = playerExitScope({ portDocks: { count: 1, docks: [{ x: 60000, y: 0, keepR: 1000 }] } }).scope;
  far.startPlayerWarpSlide(1, 0, 1800);
  assert.equal(far.warp.exitSlide.vMin, 600);
  // statek już w kole doku (wyjście przy porcie) i dok za rufą / z boku — nie staje w miejscu
  for (const dock of [{ x: 300, y: 0, keepR: 1000 }, { x: -6000, y: 0, keepR: 1000 }, { x: 6000, y: 5000, keepR: 1000 }]) {
    const sc = playerExitScope({ portDocks: { count: 1, docks: [dock] } }).scope;
    assert.equal(sc.playerWarpObstacleAhead(0, 0, 1, 0, 1e5), Infinity, JSON.stringify(dock));
  }
});

test('gracz: exitWarp z vEnd, ślizg w physicsStep, TRAVEL TO / kurs / HUD z drogi ślizgu, holownik bez pędu, resety', () => {
  const html = readIndexHtml();
  const exitWarp = sliceFunction(html, 'function exitWarp(opts) {');
  assert.match(exitWarp, /const plan = playerWarpExitPlan\(speed, !\(opts && opts\.momentum === false\)\);/);
  // startTime — znacznik zegara gry rampy (SimClock.sim; obraz w workerze — warpWorldMirror.js, rozgrywka go nie czyta)
  assert.match(exitWarp, /createWarpExitRamp\(\{\s*v0: speed, hullLength: playerWarpHullLength\(\), dirX: dir\.x, dirY: dir\.y, vEnd: plan\.vEnd, startTime: SimClock\.sim\s*\}\)/);
  assert.match(html, /if \(s\.phase === 'done'\) \{\s*r\.active = false;[\s\S]{0,160}?if \(s\.speed > 1\) startPlayerWarpSlide\(r\.dirX, r\.dirY, s\.speed\);/);
  assert.match(html, /else if \(warp\.exitSlide && warp\.exitSlide\.active\) \{[\s\S]{0,400}?if \(playerHasManualInput\(\) \|\| hypercruise\.state !== 'idle'\) \{/);
  const nav = sliceFunction(html, 'function stepTravelNav() {');
  assert.match(nav, /if \(along <= playerWarpExitDistance\(\)\) \{/);
  assert.match(nav, /nav\.phase === 'exit' && !warp\.exitRamp\?\.active && !warp\.exitSlide\?\.active/);
  assert.doesNotMatch(nav, /warpExitRampDistance\(/);
  assert.match(sliceFunction(html, 'function stepWarpCourse(dt) {'), /warpCourse\.aim, playerWarpExitDistance\(\)\)\)/);
  assert.match(html, /const rampDist = playerWarpExitDistance\(!_tugWarp\.active\);/);
  // holownik: zestaw staje (droga bez pędu — rampa do zatrzymania)
  assert.match(html, /_tugWarp\.aim, warpExitRampDistance\(getPlayerSpeed\(\), playerWarpHullLength\(\)\)\)\) \{\s*warp\.state = 'idle';[\s\S]{0,120}?exitWarp\(\{ momentum: false \}\);/);
  // kop i resety gaszą ślizg
  assert.match(sliceFunction(html, 'function engageWarp(dirToMouse) {'), /stopPlayerWarpSlide\(\);/);
  assert.ok((html.match(/warp\.exitRamp = null;\s*stopPlayerWarpSlide\(\);/g) || []).length >= 2, 'resety');
  assert.match(html, /\[\?&\]pedGracz=\(\?:0\|off\|nie\)/);
});
