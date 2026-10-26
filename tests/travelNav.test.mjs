// TRAVEL TO (src/game/travelNav.js): odcinki podróży — warp po prostej, studnie grawitacji
// (koniec przed brzegiem, cel w studni — napędem), krótkie odcinki napędem; spięcie z grą.
// node --test tests/travelNav.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRAVEL_TUNE, planTravelLeg, segmentCircleEntry, wellAt } from '../src/game/travelNav.js';
import { WARP_COURSE_TUNE, warpCourseBearing, warpCourseAligned, warpCourseHudVisible, warpCoursePass, warpCourseExitDue, chooseWarpJump } from '../src/game/warpCourse.js';
import { warpExitRampDistance, WARP_EMERGENCY, planWarpEmergency } from '../src/game/warpDrive.js';
import vm from 'node:vm';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('wejście odcinka w okrąg: pierwszy punkt przecięcia, start w środku — brak', () => {
  const c = { x: 100, y: 0, r: 10 };
  const hit = segmentCircleEntry({ x: 0, y: 0 }, { x: 200, y: 0 }, c);
  assert.ok(near(hit.x, 90) && near(hit.y, 0));
  assert.equal(segmentCircleEntry({ x: 0, y: 50 }, { x: 200, y: 50 }, c), null, 'mija');
  assert.equal(segmentCircleEntry({ x: 100, y: 2 }, { x: 300, y: 0 }, c), null, 'start w środku');
  assert.equal(segmentCircleEntry({ x: 0, y: 0 }, { x: 50, y: 0 }, c), null, 'za krótki');
  assert.equal(wellAt({ x: 105, y: 0 }, [c]), c);
});

test('ręczny warp: namiar ze znakiem przez ±π i tolerancja dokładnie ±5°', () => {
  const p = { x: 0, y: 0 }, aim = { x: -100000, y: 0 };
  assert.ok(near(warpCourseBearing(p, -179 * Math.PI / 180, aim).err, -Math.PI / 180));
  assert.ok(near(warpCourseBearing(p, 179 * Math.PI / 180, aim).err, Math.PI / 180));
  for (const sign of [-1, 1]) {
    assert.equal(warpCourseAligned(sign * WARP_COURSE_TUNE.tolerance), true);
    assert.equal(warpCourseAligned(sign * 5.01 * Math.PI / 180), false);
  }
  const pass = warpCoursePass(p, 1, 0, { x: 100000, y: 20000 });
  assert.equal(pass.along, 100000);
  assert.equal(pass.miss, 20000);
  assert.ok(warpCoursePass(p, 1, 0, { x: -3, y: 4 }).along < 0);
  assert.equal(warpCoursePass(p, 1, 0, { x: -3, y: 4 }).miss, 5);
  const ramp = warpExitRampDistance(260000, 1800);
  assert.equal(warpCourseExitDue(p, 1, 0, { x: ramp + 1, y: 0 }, ramp), false);
  assert.equal(warpCourseExitDue(p, 1, 0, { x: ramp, y: 0 }, ramp), true);
});

// Uruchamiamy prawdziwe funkcje sterowania z index.html, bez renderera i DOM.
function manualWarpHarness() {
  const html = read('index.html');
  // + wybór skoku klawiszem warpa (DECYZJE-2 T1): kurs → cel w stożku → skok awaryjny
  const names = ['cancelTravel', 'takeManualWarpCourse', 'startManualWarpCharge', 'stepWarpCourse', 'attemptWarp', 'handleWarpKeyDown', 'handleWarpKeyUp',
    'chooseManualWarpJump', 'planPlayerWarpEmergency', 'formatWarpJumpKm'];
  const funcs = names.map(name => {
    const start = html.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n    }', start) + 6);
  }).join('\n');
  const state = {
    ship: { pos: { x: 0, y: 0 }, angle: 0, command: null },
    warp: { state: 'idle', fuel: 20, dir: { x: 1, y: 0 }, exitRamp: null },
    travelNav: { active: true, target: { x: 500000, y: 0 }, leg: { x: 500000, y: 0, kind: 'warp' }, phase: 'align', cmd: {}, waypoints: [] },
    warpCourse: { aim: null, autoExit: false, refreshLeft: 0, kind: '', label: '' },
    DevFlags: { unlimitedWarp: false }, PAUSED: false, exits: 0,
    WARP_COURSE_TUNE, warpCourseBearing, warpCourseAligned, warpCourseExitDue, warpExitRampDistance,
    _warpCourseBearing: {},
    // wybór skoku (T1): bez celów w stożku; skok awaryjny z prawdziwego planisty, świat bez studni
    chooseWarpJump, planWarpEmergency, WARP_EMERGENCY, WORLD: null, _warpEmergencyPlan: {},   // statek w (0, 0) — bez brzegu świata
    collectTravelTargets: () => state.coneTargets, coneTargets: [],
    travelLegToTarget: (c) => ({ x: c.tx ?? c.x, y: c.ty ?? c.y, kind: 'warp' }),
    getTravelWells: () => [], warpEmergencyWells: () => state.wells, wells: [], travelMinWarpDist: () => 40000,
    _tugWarp: { active: false },
    messages: [],
    pushZoneMessage(m) { state.messages.push(m); }, travelRestoreStance() {}, clearPlayerAttackState() {},
    // Silniki sprawne (src/game/engineDamage.js — skok wymaga choć jednej dyszy MAIN).
    isMainDriveDestroyed: () => false, playerDriveDown: () => false,
    // Silniki w pracy (src/game/engineIgnition.js — skok wymaga pracy silników; etap E2).
    playerEnginesBlockDrive: () => false,
    getPlayerSpeed: () => 260000, playerWarpHullLength: () => 1800,
    // droga wyjścia (rampa + ślizg z pędem — index.html: playerWarpExitDistance); tu rampa bez pędu
    playerWarpExitDistance: () => warpExitRampDistance(260000, 1800),
    // Hipercruise (E5) bezczynny — odcinki warpa go nie dotyczą.
    hypercruise: { state: 'idle', target: null }, hypercruiseBusy: () => false, stopPlayerHypercruise() {},
    nextTravelLeg: () => state.travelNav.leg,
    exitWarp: () => { state.exits++; state.warp.exitRamp = { active: true }; }
  };
  vm.createContext(state);
  vm.runInContext(funcs, state);
  return state;
}

test('gra: ręczny skok przejmuje cel, doprecyzowuje kurs ±5° i sam wychodzi przez rampę', () => {
  for (const start of ['attemptWarp', 'handleWarpKeyDown']) {
    for (const deg of [-5, 0, 5]) {
      const h = manualWarpHarness();
      h.ship.angle = deg * Math.PI / 180;
      const target = h.travelNav.target;
      h[start]();
      assert.equal(h.travelNav.active, false);
      assert.equal(h.travelNav.target, target, 'cel nie znika');
      assert.equal(h.warp.state, 'charging');
      assert.equal(h.warpCourse.autoExit, true);
      assert.equal(h.warp.chargeAngle, 0, 'dokładny namiar punktu, bez minięcia o 5°');
      h.warp.state = 'active';
      h.stepWarpCourse(1 / 120);
      assert.equal(h.exits, 0, 'za wcześnie na wyjście');
      h.ship.pos.x = target.x - warpExitRampDistance(260000, 1800) + 1;
      h.stepWarpCourse(1 / 120);
      assert.equal(h.exits, 1);
      assert.equal(h.warp.state, 'idle');
      assert.equal(h.warp.exitRamp.active, true);
      h.stepWarpCourse(1 / 120);
      assert.equal(h.exits, 1, 'bez powtórnego wyjścia / nowej podróży');
    }
  }
});

test('gra (DECYZJE-2 T1): kurs w stożku ±20° (poza zielonym pasmem ±5°) wygrywa — dokładny namiar kursu i wyjście przy punkcie', () => {
  for (const deg of [-19.9, -5.01, 5.01, 19.9]) {
    const h = manualWarpHarness();
    h.ship.angle = deg * Math.PI / 180;
    h.coneTargets = [{ x: 300000, y: 300000 * Math.tan(h.ship.angle), r: 0, label: 'Mars', kind: 'body' }];
    h.attemptWarp();
    assert.equal(h.warpCourse.kind, 'course', `${deg}°: kurs gracza wygrywa z celem na dziobie`);
    assert.equal(h.warp.chargeAngle, 0, 'dokładny namiar kursu');
    assert.ok(h.messages.some((m) => /WYJŚCIE PRZY PUNKCIE KURSU/.test(m)));
  }
});

test('gra (DECYZJE-2 T1): poza stożkiem kursu, bez celu i na odcinku napędem — skok awaryjny 400 tys. j. w dziób z wyjściem przy punkcie; anulowanie i ręczne wyjście zachowują cel', () => {
  for (const deg of [-20.5, 20.5, 90]) {
    const h = manualWarpHarness();
    h.ship.angle = deg * Math.PI / 180;
    h.attemptWarp();
    assert.equal(h.warp.state, 'charging');
    assert.equal(h.warpCourse.kind, 'emergency');
    assert.equal(h.warpCourse.autoExit, true, 'każdy skok ma koniec i wyjście automatyczne');
    assert.equal(h.warp.chargeAngle, h.ship.angle, 'skok awaryjny — dokładnie w dziób');
    assert.ok(near(Math.hypot(h.warpCourse.aim.x, h.warpCourse.aim.y), WARP_EMERGENCY.dist, 1e-6));
    assert.ok(h.messages.some((m) => /SKOK AWARYJNY 400 KM/.test(m)), h.messages.join(' | '));
    h.warp.state = 'active';
    h.warp.dir = { x: Math.cos(h.ship.angle), y: Math.sin(h.ship.angle) };
    h.stepWarpCourse(1 / 120);
    assert.equal(h.exits, 0);
    h.handleWarpKeyUp();
    assert.equal(h.exits, 1, 'ręczne wyjście w locie zostaje');
    assert.ok(h.travelNav.target, 'ręczne wyjście zachowuje cel');
  }
  // automatyczne wyjście skoku awaryjnego (bez kursu TRAVEL TO): rampa kończy się w punkcie
  {
    const h = manualWarpHarness();
    h.cancelTravel(null);
    h.ship.angle = 0;
    h.attemptWarp();
    assert.equal(h.warpCourse.kind, 'emergency');
    h.warp.state = 'active';
    h.ship.pos.x = WARP_EMERGENCY.dist - warpExitRampDistance(260000, 1800) + 1;
    h.stepWarpCourse(1 / 120);
    assert.equal(h.exits, 1, 'skok bez kursu też wychodzi sam');
  }
  const h = manualWarpHarness();
  h.ship.angle = 0.5;
  h.attemptWarp(); h.attemptWarp();
  assert.equal(h.warp.state, 'idle', 'drugi 9 / UI przerywa ładowanie');
  assert.ok(h.travelNav.target);
  assert.equal(h.warpCourse.autoExit, false);
  h.ship.angle = 0;
  h.travelNav.leg.kind = 'drive';
  h.handleWarpKeyDown();
  assert.equal(h.warpCourse.kind, 'emergency', 'odcinek napędem nie jest kursem skoku — skok awaryjny');
  assert.equal(warpCourseHudVisible(h.travelNav.leg, h.warpCourse.aim, true), true, 'HUD pokazuje punkt skoku awaryjnego');
  h.handleWarpKeyUp();
  h.cancelTravel(null);
  assert.equal(h.travelNav.target, null, 'jawne skasowanie kursu');
});

test('gra (DECYZJE-2 T1): cel w stożku ±20° przed dziobem wygrywa ze skokiem awaryjnym; studnia tuż przed dziobem — odmowa', () => {
  const h = manualWarpHarness();
  h.cancelTravel(null);
  h.ship.angle = 15 * Math.PI / 180;
  const c = { x: 300000, y: 0, r: 0, label: 'Mars', kind: 'body' };
  h.coneTargets = [c];
  h.attemptWarp();
  assert.equal(h.warpCourse.kind, 'cone');
  assert.equal(h.warpCourse.label, 'Mars');
  assert.equal(h.warp.chargeAngle, 0, 'dokładny namiar celu przy starcie ładowania');
  assert.ok(h.messages.some((m) => /CEL PRZED DZIOBEM — MARS/.test(m)));
  // studnia 20 tys. j. przed dziobem — skok awaryjny za krótki: komunikat, bez ładowania
  const g = manualWarpHarness();
  g.cancelTravel(null);
  g.ship.angle = 0;
  g.wells = [{ x: 30000, y: 0, r: 8000 }];
  g.attemptWarp();
  assert.equal(g.warp.state, 'idle');
  assert.ok(g.messages.some((m) => /STUDNIA GRAWITACJI PRZED DZIOBEM/.test(m)));
});

test('powrót do K-7: po rampie kończy się HUD warpa, cel pozostaje tylko do dolotu napędem', () => {
  const well = { x: 600000, y: 0, r: 40000 };
  const target = { x: 600000, y: 10000 }, pos = { x: 0, y: 0 };
  const jump = planTravelLeg(pos, target, [target], [well], { minWarp: 40000 });
  const last = planTravelLeg(jump, target, [target], [well], { minWarp: 40000 });
  assert.equal(jump.kind, 'warp');
  assert.equal(last.kind, 'drive');
  assert.equal(warpCourseHudVisible(jump, null, false), true);
  assert.equal(warpCourseHudVisible(last, jump, true), true, 'rampa zachowuje stary punkt do zatrzymania');
  const h = manualWarpHarness();
  h.travelNav.active = false;
  h.travelNav.target = target;
  h.travelNav.leg = last;
  h.ship.pos = { x: jump.x, y: jump.y };
  h.warpCourse.aim = jump;
  h.warpCourse.autoExit = true;
  h.warp.exitRamp = { active: true };
  h.stepWarpCourse(1 / 120);
  assert.equal(h.warpCourse.aim, jump, 'nie kasuje wskazania w rampie');
  h.warp.exitRamp.active = false;
  h.stepWarpCourse(1 / 120);
  assert.equal(h.warpCourse.aim, null);
  assert.equal(h.warpCourse.autoExit, false);
  assert.equal(h.travelNav.target, target, 'punkt K-7 pozostaje do dolotu');
  assert.equal(warpCourseHudVisible(h.travelNav.leg, h.warpCourse.aim, false), false);
  h.handleWarpKeyDown();
  // DECYZJE-2 T1: dolot napędem nie jest kursem skoku — klawisz warpa daje skok awaryjny w dziób (z punktem i HUD-em)
  assert.equal(h.warpCourse.kind, 'emergency');
  assert.notEqual(h.warpCourse.aim, jump, 'wskazanie kursu K-7 nie wraca');
  h.handleWarpKeyUp();
  h.ship.pos = { ...target };
  h.stepWarpCourse(1 / 120);
  assert.equal(h.travelNav.target, null, 'na miejscu znika także cel podróży');
});

test('gra: przejęcie istniejącego skoku, pauza i koniec podróży nie przywracają autopilota', () => {
  const h = manualWarpHarness();
  h.warp.state = 'active';
  h.takeManualWarpCourse();
  assert.equal(h.warpCourse.autoExit, true);
  h.ship.pos.x = 500000;
  h.PAUSED = true; h.stepWarpCourse(1);
  assert.equal(h.exits, 0);
  h.PAUSED = false; h.stepWarpCourse(1 / 120);
  assert.equal(h.exits, 1);
  h.warp.exitRamp.active = false;
  h.stepWarpCourse(1 / 120);
  assert.equal(h.travelNav.target, null);
  assert.equal(h.travelNav.active, false);
  assert.equal(h.ship.command, null);
});

test('odcinek: daleki cel w otwartej przestrzeni — warp prosto do celu; blisko — napędem; na miejscu — koniec', () => {
  const pos = { x: 0, y: 0 };
  const target = { x: 500000, y: 0 };
  const leg = planTravelLeg(pos, target, [target], [], { minWarp: 60000 });
  assert.deepEqual(leg, { x: 500000, y: 0, kind: 'warp', final: true });
  const near1 = planTravelLeg(pos, { x: 30000, y: 0 }, [{ x: 30000, y: 0 }], [], { minWarp: 60000 });
  assert.equal(near1.kind, 'drive');
  assert.equal(planTravelLeg(pos, { x: 1000, y: 0 }, [], [], {}), null, 'w promieniu przylotu');
  const noFuel = planTravelLeg(pos, target, [target], [], { minWarp: 60000, warpOk: false });
  assert.equal(noFuel.kind, 'drive');
});

test('odcinek: cel w studni grawitacji — warp kończy się przed jej brzegiem, dalej napędem', () => {
  const well = { x: 600000, y: 0, r: 40000 };
  const target = { x: 600000, y: 10000 };
  const leg = planTravelLeg({ x: 0, y: 0 }, target, [target], [well], { minWarp: 60000 });
  assert.equal(leg.kind, 'warp');
  assert.equal(leg.final, false);
  const d = Math.hypot(leg.x - well.x, leg.y - well.y);
  assert.ok(near(d, well.r + TRAVEL_TUNE.wellMargin, 1e-3), `koniec warpa ${d} od środka studni`);
  // Statek przy brzegu studni: ostatni odcinek napędem.
  const last = planTravelLeg({ x: leg.x, y: leg.y }, target, [target], [well], { minWarp: 60000 });
  assert.equal(last.kind, 'drive');
  assert.equal(last.final, true);
});

test('odcinek: punkt objazdu, przy którym statek już stoi, jest pomijany (bez pętli w miejscu)', () => {
  const pos = { x: 1000, y: 0 };
  const p1 = { x: 1500, y: 300 };
  const p2 = { x: 200000, y: 50000 };
  const target = { x: 600000, y: 0 };
  const leg = planTravelLeg(pos, target, [p1, p2, target], [], { minWarp: 60000 });
  assert.equal(leg.x, p2.x);
  assert.equal(leg.kind, 'warp');
});

test('odcinek: start w studni (port Ziemi) — wylot warpem bez przycinania własnej studni', () => {
  const home = { x: 0, y: 0, r: 40000 };
  const target = { x: 800000, y: 0 };
  const leg = planTravelLeg({ x: 5000, y: 0 }, target, [target], [home], { minWarp: 60000 });
  assert.deepEqual(leg, { x: 800000, y: 0, kind: 'warp', final: true });
});

test('K-7: bliski cel z dalekim objazdem oraz podróż wewnątrz studni — dolot napędem', () => {
  const well = { x: 0, y: 0, r: 100000 };
  const pos = { x: 110000, y: 0 }, dock = { x: 90000, y: 0 };
  const detour = { x: 180000, y: 80000 };
  assert.deepEqual(planTravelLeg(pos, dock, [detour, dock], [well], { minWarp: 40000 }),
    { ...dock, kind: 'drive', final: true }, '20 tys. do doku nie staje się warpem do objazdu');
  const inside = { x: -80000, y: 0 };
  assert.deepEqual(planTravelLeg(inside, dock, [dock], [well], { minWarp: 40000 }),
    { ...dock, kind: 'drive', final: true }, 'wewnątrz tej samej studni nie skaczemy ponownie');
  const outside = { x: 300000, y: 0 };
  assert.equal(planTravelLeg(dock, outside, [outside], [well], { minWarp: 40000 }).kind, 'warp',
    'odlot na nowy daleki cel zachowuje warp');
});

test('planista objazdów omija inne studnie, ale nie odsyła od brzegu studni celu K-7', () => {
  const html = read('index.html');
  const start = html.indexOf('    function getCruiseGravityObstacles(');
  const fn = html.slice(start, html.indexOf('\n    }', start) + 6);
  const earth = { x: 0, y: 0 }, mars = { x: 400000, y: 0 };
  const h = { planets: [earth, mars], travelNav: { obstacleMargin: 1100 },
    planetOrbitRadii: () => ({ gravityWell: 100000 }),
    // doki portów bez ringu (E14, src/game/portDockWorld.js): bez budowli — bez ich dysków
    portDocks: { pushCruiseObstacles: (out) => out } };
  vm.createContext(h); vm.runInContext(fn, h);
  const obstacles = h.getCruiseGravityObstacles({ x: 95000, y: 0 }, { x: 250000, y: 0 });
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].x, mars.x, 'studnia Ziemi przy porcie nie wymusza objazdu');
});

test('gra: TRAVEL TO zamiast CRUISE / SKOK / PRZELOT w mapie i menu; kurs warpa stoi od ładowania', () => {
  const cic = read('src/ui/cicDisplay.js');
  assert.match(cic, /\{ label: 'TRAVEL TO', action: 'travel'/);
  assert.doesNotMatch(cic, /CRUISE TO|cruiseNav/);
  const menu = read('src/game/worldCommandMenu.js');
  assert.match(menu, /\['travel', 'TRAVEL TO'\]/);
  assert.doesNotMatch(menu, /\['jump'|\['cruise'/);
  const html = read('index.html');
  assert.doesNotMatch(html, /cruiseNav|updateWarpCruiseAutopilot|rebuildCruiseRouteFromCurrent/);
  assert.match(html, /function setTravelTarget\(worldX, worldY, label = ''\) \{/);
  assert.match(html, /stepTravelNav\(\);\s*updatePlayerCommand\(dt\);/);
  // Ładowanie nie obraca statku ku kursorowi; w locie bez skrętu.
  assert.doesNotMatch(html, /const dirToMouse = norm\(\{ x: mouseWorld\.x - ship\.pos\.x/);
  assert.match(html, /warp\.dir\.x = Math\.cos\(warp\.chargeAngle\);/);
  // Wyjście z warpa: rampa przylotu prowadzi statek.
  assert.match(html, /else if \(warp\.exitRamp && warp\.exitRamp\.active\) \{/);
});
