import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Zimne wraki: warunki zamrożenia, budżety klatki, limit liczby zimnych, ten sam obiekt wraku po odmrożeniu
// i wpięcie w index.html. Prawdziwe kadłuby na belkach (HullBodies); atrapą jest tylko obraz (płyta RGBA) i to,
// czego system pyta grę (odwołania, kadr, obudzone ciała). Migawka ciała, ciała do rysowania, limit węzłów
// i warunki właściwe belkom — tests/coldWrecksBeam.test.mjs. (Dawną wersję tych testów na wrakach heksowych
// usunięto 2026-10-19 razem z silnikiem heksów.)

globalThis.window = globalThis.window || {};
window.wrecks = [];
const { HullBodies } = await import('../src/game/hullBodies.js');
const { TowConstraintSystem } = await import('../src/game/towSystem.js');
const { createColdWreckSystem, COLD_WRECK_CONFIG, THAW_RESULT } = await import('../src/game/coldWrecks.js');
const { SHIPMENT_STATUS } = await import('../src/game/cargoFleet.js');
const { readIndexHtml, sliceFunction, loadIndexFunction } = await import('./helpers/indexSource.mjs');
const D = HullBodies.engine;

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 130; data[i * 4 + 1] = 140; data[i * 4 + 2] = 150; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

const IMAGE = plate(180, 75);

function ship(x = 0, y = 0) {
  const e = { x, y, vx: 0, vy: 0, angle: 0.2, angVel: 0, mass: 5000 };
  HullBodies.createHull(e, IMAGE);
  return e;
}

// Wrak gotowy do zamrożenia: śpi od dawna, cisza po trafieniu (zegar HullBodies), bez czekającego rozpadu.
function sleepyWreck(x = 0, y = 0) {
  window.wrecks.length = 0;
  const e = ship(x, y);
  const w = HullBodies.convertToWreck(e);
  e.dead = true;
  assert.ok(w && w.beamHull, 'wrak z kadłuba');
  window.wrecks.length = 0;
  w.vx = 0; w.vy = 0; w.angVel = 0;
  w._wreckSleeping = true;
  w._wreckSleptSec = COLD_WRECK_CONFIG.afterSec + 1;
  w._lastImpactMs = (HullBodies.simTime - COLD_WRECK_CONFIG.afterSec - 5) * 1000;
  w.beamHull.body.structureDirty = false;
  D.splitQueue.length = 0;
  HullBodies.sleep(w);
  return w;
}

test('zamrożenie → odmrożenie: ten sam obiekt — łup, ładunek, wiek; lina odpięta w haku przed uśpieniem ciała', () => {
  const w = sleepyWreck(1200, -900);
  const salvage = { weapons: [{ weaponId: 'railgun_heavy', cell: '3,1' }], materials: { scrap: 40, steel: 12 }, label: 'Test Hull' };
  w._salvage = salvage;
  w._cargoManifest = { steel: 5 };
  w._cargoOrderId = 'order-1';
  w._wreckAge = 99;
  const cargoRef = w._cargoManifest;
  const wrecks = [w];
  const coldWrecks = [];
  const tow = new TowConstraintSystem();
  const anchor = ship(3000, -900);
  tow.attach(anchor, w, { length: 300 });
  assert.equal(tow.isAttached(w), true);
  const calls = [];
  const system = createColdWreckSystem({
    wrecks,
    coldWrecks,
    onBeforeFreeze: (wreck, snap) => {
      calls.push({ wreck, snap, hadBody: HullBodies.hasHull(wreck) });
      tow.detachBody(wreck, 'wreck-cold');
    }
  });
  assert.equal(system.freeze(w), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].wreck, w);
  assert.equal(calls[0].snap, w._coldSnapshot, 'hak dostaje migawkę (smuga zapisuje się na niej)');
  assert.equal(calls[0].hadBody, true, 'hak przed zwolnieniem ciała (smuga czyta zasięg żywych węzłów)');
  assert.equal(tow.isAttached(w), false, 'lina odpięta');
  assert.equal(wrecks.includes(w), false);
  assert.deepEqual(coldWrecks, [w]);
  assert.equal(w.isCold, true);
  assert.equal(w.isCollidable, false, 'duch dla okrętów i pocisków');
  assert.equal(w.vx, 0);
  assert.equal(w.angVel, 0);
  const summary = w._coldSnapshot.summary;
  assert.equal(summary.label, 'Test Hull');
  assert.equal(summary.weapons, 1);
  assert.equal(summary.hasCargo, true);
  assert.equal(summary.hasScrap, true);

  assert.equal(system.thaw(w, 'test'), THAW_RESULT.THAWED);
  assert.deepEqual(wrecks, [w]);
  assert.equal(coldWrecks.length, 0);
  assert.equal(w.isCold, false);
  assert.equal(w.isCollidable, true);
  assert.equal(w._wreckSleeping, false, 'obudzony');
  assert.equal(w._coldSnapshot, null);
  assert.ok(HullBodies.hasHull(w), 'kadłub wrócił');
  assert.equal(w._salvage, salvage, 'manifest łupu to ten sam obiekt');
  assert.equal(w._cargoManifest, cargoRef, 'ładunek to ten sam obiekt');
  assert.equal(w._cargoOrderId, 'order-1');
  assert.equal(w._wreckAge, 99);
});

test('warunki zamrożenia: odwołania, ruch w pobliżu, niedawne trafienie, kadr, krótki sen i noWreckSleep blokują; reszta marznie w budżecie klatki', () => {
  const wrecks = [];
  for (let i = 0; i < 10; i++) wrecks.push(sleepyWreck(i * 2000, 0));

  const towed = sleepyWreck(0, 20000);
  const cut = sleepyWreck(2000, 20000);
  const locked = sleepyWreck(4000, 20000);
  const hovered = sleepyWreck(6000, 20000);
  const nearShip = sleepyWreck(0, -30000);
  const nearSleeper = sleepyWreck(0, -60000);
  const recentlyHit = sleepyWreck(0, 40000);
  recentlyHit._lastImpactMs = HullBodies.simTime * 1000;
  const onScreen = sleepyWreck(2000, 40000);
  const restless = sleepyWreck(4000, 40000);
  restless._wreckSleptSec = COLD_WRECK_CONFIG.afterSec - 1;
  const holding = sleepyWreck(6000, 40000);
  holding.noWreckSleep = true;
  const blocked = [towed, cut, locked, hovered, nearShip, recentlyHit, onScreen, restless, holding];
  wrecks.push(...blocked, nearSleeper);

  const liveShip = { x: 800, y: -30000, radius: 200, vx: 300, vy: 0 };
  const sleepingNeighbour = { x: -300, y: -60000, radius: 100, isWreck: true, _wreckSleeping: true };
  const coldWrecks = [];
  const references = new Set([towed, cut, locked]);
  const system = createColdWreckSystem({
    wrecks,
    coldWrecks,
    markReferences: (stamp) => { for (const w of references) w._coldRefStamp = stamp; },
    isReferenced: (w) => w === hovered,
    isVisuallySafe: (w) => w !== onScreen,
    getAwakeBodies: () => [liveShip, sleepingNeighbour, nearShip]
  });

  assert.deepEqual(blocked.map((w) => system.explain(w)),
    ['odwolanie', 'odwolanie', 'odwolanie', 'odwolanie-wprost', 'ruch-w-poblizu', 'trafiony-niedawno', 'kadr', 'spi-krotko', 'bez-snu']);
  for (const w of blocked) assert.equal(system.isFreezeCandidate(w), false);
  assert.equal(system.isFreezeCandidate(nearSleeper), true, 'śpiący sąsiad nie blokuje');
  assert.equal(system.isFreezeCandidate(wrecks[0]), true);

  system.step(1 / 60);
  assert.equal(coldWrecks.length, COLD_WRECK_CONFIG.freezePerFrame, 'budżet zamrożeń na klatkę');
  system.step(1 / 60);
  assert.equal(coldWrecks.length, COLD_WRECK_CONFIG.freezePerFrame * 2);
  for (let i = 0; i < 4; i++) system.step(1 / 60);
  assert.equal(coldWrecks.length, 11, '10 zwykłych + śpiący sąsiad');
  for (const w of blocked) {
    assert.equal(w.isCold, false);
    assert.ok(wrecks.includes(w) && HullBodies.hasHull(w), 'zablokowany zostaje w wrecks, z kadłubem');
  }

  // Kilka sekund później nadal nic z zablokowanych — skan co 0,5 s ich nie weźmie.
  for (let i = 0; i < 300; i++) system.step(1 / 60);
  assert.equal(coldWrecks.length, 11);
});

test('thawWreck: najwyżej jedno odmrożenie na klatkę, reszta w kolejce z wywołaniem zwrotnym', () => {
  const a = sleepyWreck(0, 0);
  const b = sleepyWreck(5000, 0);
  const wrecks = [a, b];
  const coldWrecks = [];
  const system = createColdWreckSystem({ wrecks, coldWrecks });
  system.freeze(a);
  system.freeze(b);
  assert.equal(coldWrecks.length, 2);

  const ready = [];
  system.step(1 / 60); // nowa klatka: budżet 1
  assert.equal(system.thaw(a, 'tow', w => ready.push(w)), THAW_RESULT.THAWED);
  assert.equal(system.thaw(b, 'salvage', w => ready.push(w)), THAW_RESULT.QUEUED);
  assert.deepEqual(ready, [a]);
  assert.equal(b.isCold, true);
  system.step(1 / 60);
  assert.deepEqual(ready, [a, b], 'kolejka odmroziła w następnej klatce i wywołała akcję');
  assert.equal(b.isCold, false);
  assert.ok(wrecks.includes(b) && HullBodies.hasHull(b));
  // Już gorący: akcja od razu.
  assert.equal(system.thaw(b, 'tow', w => ready.push(w)), THAW_RESULT.THAWED);
  assert.equal(ready.length, 3);
});

test('getFrameId: budżet odmrożeń na klatkę rAF, także dla wywołań z UI między krokami', () => {
  const a = sleepyWreck(0, 0);
  const b = sleepyWreck(5000, 0);
  const c = sleepyWreck(9000, 0);
  const wrecks = [a, b, c];
  const coldWrecks = [];
  let frame = 7;
  const system = createColdWreckSystem({ wrecks, coldWrecks, getFrameId: () => frame });
  for (const w of [a, b, c]) system.freeze(w);
  assert.equal(system.thaw(a, 'ui'), THAW_RESULT.THAWED);
  assert.equal(system.thaw(b, 'ui'), THAW_RESULT.QUEUED, 'ta sama klatka');
  frame++;
  assert.equal(system.thaw(c, 'ui'), THAW_RESULT.THAWED, 'nowa klatka bez step() — nowy budżet');
  system.step(1 / 60); // ta sama klatka co c: kolejka czeka
  assert.equal(b.isCold, true);
  frame++;
  system.step(1 / 60);
  assert.equal(b.isCold, false);
});

test('MAX_COLD_WRECKS: wyrzuca najdalszego od gracza, nigdy wraka z ładunkiem', () => {
  const near = sleepyWreck(100, 0);
  const mid = sleepyWreck(3000, 0);
  const far = sleepyWreck(9000, 0);
  const farthestCargo = sleepyWreck(60000, 0);
  farthestCargo._cargoManifest = { ore_iron: 3 };
  const farther = sleepyWreck(20000, 0);
  for (const w of [near, mid, far, farthestCargo, farther]) w._salvage = { weapons: [], materials: { scrap: 3 }, label: 'Wrak' };
  const wrecks = [near, mid, far, farthestCargo, farther];
  const coldWrecks = [];
  const evicted = [];
  const system = createColdWreckSystem({
    wrecks,
    coldWrecks,
    config: { maxCold: 3 },
    getPlayerPos: () => ({ x: 0, y: 0 }),
    onEvicted: w => evicted.push(w)
  });
  for (const w of [...wrecks]) system.freeze(w);
  assert.equal(coldWrecks.length, 5);
  system.enforceColdLimit();
  assert.deepEqual(new Set(evicted), new Set([farther, far]));
  assert.equal(coldWrecks.length, 3);
  assert.ok(coldWrecks.includes(farthestCargo), 'ładunek nigdy nie idzie do recyklingu');
  for (const w of evicted) {
    assert.equal(w.dead, true);
    assert.equal(w.isCold, false);
    assert.equal(w._coldSnapshot, null);
    assert.equal(w._salvage, null, 'łup czyszczony dopiero przy recyklingu');
    assert.equal(HullBodies.hasHull(w), false, 'kadłub zwolniony');
  }
});

test('index.html: odwołania do wraku (odzysk, locki, kursor, menu, rozkazy, liny, ładunek) blokują zamrożenie', () => {
  const src = readIndexHtml();
  const scope = { _coldRefMarkStamp: 0 };
  scope.markColdRef = loadIndexFunction(src, 'function markColdRef(entity)', 'markColdRef', scope);
  const mark = loadIndexFunction(src, 'function markColdWreckReferences(stamp)', 'markColdWreckReferences', scope);
  const w = () => ({ isWreck: true });
  const refs = {
    cutting: w(), towed: w(), locked: w(), locked2: w(), multi: w(), hover: w(), selected: w(),
    menu: w(), attack: w(), playerCmd: w(), npcCmd: w(), npcForce: w(), cargo: w(), ropeA: w()
  };
  const idle = w();
  const deadNpcCmd = w();
  const menuClosed = w();
  Object.assign(scope, {
    salvageState: { cutting: refs.cutting, towed: refs.towed },
    lockedTarget: refs.locked,
    lockedTarget2: refs.locked2,
    lockedTargets: [refs.multi, { isWreck: false }],
    scan: { target: refs.hover },
    scannerSelectedTarget: refs.selected,
    worldCommandMenu: { open: true, targetEntity: refs.menu },
    playerAttackState: { target: refs.attack },
    ship: { command: { targetEntity: refs.playerCmd } },
    npcs: [
      { command: { targetEntity: refs.npcCmd }, forceTarget: refs.npcForce },
      { dead: true, command: { targetEntity: deadNpcCmd }, _cargoWreck: refs.cargo }
    ],
    TowSystem: { constraints: [{ bodyA: refs.ropeA, bodyB: { isWreck: false } }] }
  });
  mark(7);
  for (const [name, ref] of Object.entries(refs)) assert.equal(ref._coldRefStamp, 7, name);
  assert.equal(idle._coldRefStamp, undefined);
  assert.equal(deadNpcCmd._coldRefStamp, undefined, 'rozkaz martwego NPC nie trzyma wraku');

  scope.worldCommandMenu = { open: false, targetEntity: menuClosed };
  mark(8);
  assert.equal(menuClosed._coldRefStamp, undefined, 'zamknięte menu nie trzyma wraku');
  assert.equal(refs.cutting._coldRefStamp, 8);

  // Wprost: lina i ładunek w locie (partia jeszcze nie leży we wraku).
  const orders = new Map([
    ['o-transit', { status: SHIPMENT_STATUS.IN_TRANSIT }],
    ['o-wreck', { status: SHIPMENT_STATUS.WRECK }]
  ]);
  const roped = w();
  const direct = loadIndexFunction(src, 'function isColdWreckReferencedDirect(wreck)', 'isColdWreckReferencedDirect', {
    TowSystem: { isAttached: (b) => b === roped },
    getShipmentOrder: (_fleet, id) => orders.get(id),
    cargoFleet: {},
    SHIPMENT_STATUS
  });
  assert.equal(direct(roped), true);
  assert.equal(direct({ isWreck: true, _cargoOrderId: 'o-transit' }), true, 'transfer w toku');
  assert.equal(direct({ isWreck: true, _cargoOrderId: 'o-wreck' }), false, 'ładunek leżący we wraku nie blokuje');
  assert.equal(direct(idle), false);
});

test('index.html: wpięcie — krok przed pętlą wraków, sen w sekundach, jawne budzenie, smugi, PerfHUD', () => {
  const src = readIndexHtml();
  const physics = sliceFunction(src, 'function physicsStep(');
  const stepAt = physics.indexOf('if (runFrameLogic) coldWreckSystem.step(frameLogicDt);');
  const loopAt = physics.indexOf('// Aktualizacja wraków — podział na aktywne i śpiące');
  assert.ok(stepAt > 0 && stepAt < loopAt, 'krok zimnych raz na klatkę, przed pętlą wraków');
  assert.match(physics, /w\._wreckSleptSec = w\._wreckSleeping \? \(Number\(w\._wreckSleptSec\) \|\| 0\) \+ dt : 0;/);
  assert.match(physics, /distToPlayer > WRECK_DESPAWN_DIST/);

  for (const header of ['function startWreckTow(wreck)', 'function startFieldSalvage(wreck)']) {
    assert.match(sliceFunction(src, header), /if \(wreck\.isCold\) \{\s*if \(thawWreck\(wreck, '\w+', start\w+\) === THAW_RESULT\.FAILED\)/, header);
  }
  // sliceFunction łapie `{` z domyślnego `opts = {}` — tu tniemy do następnej funkcji.
  const untilNextFunction = (header) => {
    const start = src.indexOf(header);
    assert.ok(start >= 0, header);
    return src.slice(start, src.indexOf('\n    function ', start + header.length));
  };
  assert.match(untilNextFunction('function executeNormalWorldCommandAction('), /if \(liveTarget\?\.isCold\) thawWreckForOrder\(liveTarget, action\);/);
  assert.match(untilNextFunction('function executeRtsWorldCommandAction('), /thawWreckForOrder\(liveTarget, action\);/);
  assert.match(sliceFunction(src, 'function pickWreckTargetAtWorld(worldPoint)'), /pass === 0 \? window\.wrecks : coldWrecks/);
  assert.match(src, /const wreckList = pass === 0 \? window\.wrecks : coldWrecks;/, 'hover widzi zimne');
  assert.match(sliceFunction(src, 'function removeWreckFromWorld(wreck)'), /coldWreckSystem\.forget\(wreck\);\s*recycleWreckEntity\(wreck\);/);
  // Wrak na belkach zwalnia kadłub (HullBodies) — także zimny z samą migawką.
  const recycle = sliceFunction(src, 'function recycleWreckEntity(wreck)');
  assert.match(recycle, /if \(wreck\?\.beamHull \|\| wreck\?\._coldSnapshot\?\.kind === 'beam'\) return HullBodies\.recycleWreck\(wreck\);/);
  assert.doesNotMatch(recycle, /DestructorSystem/);

  const freezeHook = src.slice(src.indexOf('onBeforeFreeze(w) {'), src.indexOf('onThawed(w, reason) {'));
  assert.match(freezeHook, /captureBeamColdImpostor\(w, w\._coldSnapshot, coldWreckSystem\.config\);/, 'smuga z migawki przy zamrożeniu');
  assert.doesNotMatch(freezeHook, /HullDamageEvents\.invalidate/, 'wrak zostaje ze skórą — meshy nie kasujemy');
  assert.match(freezeHook, /TowSystem\.detachBody\(w, 'wreck-cold'\)/);

  assert.match(src, /updateHexShips3D\(cam, renderEntities, _hexCullInfo, coldWrecks[,)]/);
  assert.match(src, /for \(const w of wrecks\) if \(w && !w\.dead\) renderEntities\.push\(w\);/, 'renderEntities tylko z wrecks');
  assert.match(src, /setPerfHudWorldSource\(\(\) => \(\{ ship, npcs, wrecks, coldWrecks, bullets/);
  const hud = readFileSync(new URL('../src/ui/perfHud.js', import.meta.url), 'utf8');
  assert.match(hud, /Wraki gorące \/ śpiące \/ zimne/);
  assert.match(hud, /coldWreckCount: Array\.isArray\(coldWrecks\) \? coldWrecks\.length : 0/);
});
