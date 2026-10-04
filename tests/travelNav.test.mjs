// TRAVEL TO (src/game/travelNav.js): odcinki podróży — warp po prostej, studnie grawitacji
// (koniec przed brzegiem, cel w studni — napędem), krótkie odcinki napędem; spięcie z grą.
// node --test tests/travelNav.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRAVEL_TUNE, planTravelLeg, segmentCircleEntry, wellAt } from '../src/game/travelNav.js';
import { WARP_COURSE_TUNE, warpCourseBearing, warpCourseAligned, warpCourseHudVisible, warpCoursePass, warpCourseExitDue } from '../src/game/warpCourse.js';
import { warpExitRampDistance } from '../src/game/warpDrive.js';
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
  const names = ['cancelTravel', 'takeManualWarpCourse', 'startManualWarpCharge', 'stepWarpCourse', 'attemptWarp', 'handleWarpKeyDown', 'handleWarpKeyUp'];
  const funcs = names.map(name => {
    const start = html.indexOf(`    function ${name}(`);
    assert.ok(start >= 0, name);
    return html.slice(start, html.indexOf('\n    }', start) + 6);
  }).join('\n');
  const state = {
    ship: { pos: { x: 0, y: 0 }, angle: 0, command: null },
    warp: { state: 'idle', fuel: 20, dir: { x: 1, y: 0 }, exitRamp: null },
    travelNav: { active: true, target: { x: 500000, y: 0 }, leg: { x: 500000, y: 0, kind: 'warp' }, phase: 'align', cmd: {}, waypoints: [] },
    warpCourse: { aim: null, autoExit: false, refreshLeft: 0 },
    DevFlags: { unlimitedWarp: false }, PAUSED: false, exits: 0,
    WARP_COURSE_TUNE, warpCourseBearing, warpCourseAligned, warpCourseExitDue, warpExitRampDistance,
    _warpCourseBearing: {},
    pushZoneMessage() {}, travelRestoreStance() {}, clearPlayerAttackState() {},
    getPlayerSpeed: () => 260000, playerWarpHullLength: () => 1800,
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

test('gra: poza ±5°, bez celu i na odcinku napędem — wolny skok; anulowanie i Shift zachowują cel', () => {
  for (const deg of [-5.01, 5.01]) {
    const h = manualWarpHarness();
    h.ship.angle = deg * Math.PI / 180;
    h.attemptWarp();
    assert.equal(h.warpCourse.autoExit, false);
    assert.equal(h.warp.chargeAngle, h.ship.angle);
    h.warp.state = 'active'; h.ship.pos.x = 600000;
    h.stepWarpCourse(1 / 120);
    assert.equal(h.exits, 0);
    h.handleWarpKeyUp();
    assert.equal(h.exits, 1);
    assert.ok(h.travelNav.target, 'ręczne wyjście zachowuje cel');
  }
  const h = manualWarpHarness();
  h.attemptWarp(); h.attemptWarp();
  assert.equal(h.warp.state, 'idle', 'drugi 9 / UI przerywa ładowanie');
  assert.ok(h.travelNav.target);
  assert.equal(h.warpCourse.autoExit, false);
  h.travelNav.leg.kind = 'drive';
  h.handleWarpKeyDown();
  assert.equal(h.warpCourse.autoExit, false, 'krótki odcinek bez automatu warpa');
  assert.equal(h.warpCourse.aim, null, 'dolot napędem nie daje znacznika wyjścia z warpa');
  assert.equal(warpCourseHudVisible(h.travelNav.leg, h.warpCourse.aim, true), false);
  h.handleWarpKeyUp();
  h.cancelTravel(null);
  assert.equal(h.travelNav.target, null, 'jawne skasowanie kursu');
  h.attemptWarp();
  assert.equal(h.warpCourse.autoExit, false, 'bez celu zwykły warp');
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
  assert.equal(h.warpCourse.aim, null, 'wolny warp w pobliżu portu nie przywraca licznika');
  assert.equal(warpCourseHudVisible(h.travelNav.leg, h.warpCourse.aim, true), false);
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
    planetOrbitRadii: () => ({ gravityWell: 100000 }) };
  vm.createContext(h); vm.runInContext(fn, h);
  const obstacles = h.getCruiseGravityObstacles({ x: 95000, y: 0 }, { x: 250000, y: 0 });
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].x, mars.x, 'studnia Ziemi przy porcie nie wymusza objazdu');
});

test('gra: TRAVEL TO zamiast CRUISE / SKOK / PRZELOT w mapie, menu i skanerze; kurs warpa stoi od ładowania', () => {
  const cic = read('src/ui/cicDisplay.js');
  assert.match(cic, /\{ label: 'TRAVEL TO', action: 'travel' \}/);
  assert.doesNotMatch(cic, /CRUISE TO|cruiseNav/);
  const menu = read('src/game/worldCommandMenu.js');
  assert.match(menu, /\['travel', 'TRAVEL TO'\]/);
  assert.doesNotMatch(menu, /\['jump'|\['cruise'/);
  assert.match(read('src/ui/scannerOverviewUI.js'), /'travel'\]\) \{/);
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
