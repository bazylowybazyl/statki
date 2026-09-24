import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DestructorSystem as D,
  DESTRUCTOR_CONFIG,
  initHexBody,
  getHexArenaStats,
  captureHexBodySnapshot
} from '../src/game/destructor.js';
import { resetHexArenaForTests } from '../src/game/hexArenaBridge.js';
import { TowConstraintSystem } from '../src/game/towSystem.js';
import { createColdWreckSystem, COLD_WRECK_CONFIG, THAW_RESULT } from '../src/game/coldWrecks.js';
import { SHIPMENT_STATUS } from '../src/game/cargoFleet.js';
import { readIndexHtml, sliceFunction, loadIndexFunction } from './helpers/indexSource.mjs';

// Zimne wraki na prawdziwym destruktorze i arenie heksów. Atrapą jest tylko
// raster (kanwa, getImageData) i to, czego moduł pyta grę (odwołania, kadr,
// obudzone ciała) — tak jak robi to index.html przez opcje systemu.

const noop = () => {};
const ctx2d = {
  drawImage: noop, save: noop, restore: noop, translate: noop, beginPath: noop,
  moveTo: noop, lineTo: noop, closePath: noop, clip: noop, fill: noop,
  clearRect: noop, fillRect: noop,
  getImageData(_x, _y, w, h) { return { data: new Uint8ClampedArray(w * h * 4).fill(255) }; }
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

// Jeden obraz = jeden typ kadłuba = jeden szablon (klucz WeakMap).
const HULL_IMAGE = { width: 160, height: 60 };
const SMALL_IMAGE = { width: 60, height: 40 };

function makeHull(image = HULL_IMAGE, state = {}) {
  const e = { x: 0, y: 0, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 50000, noSplit: true, ...state };
  initHexBody(e, image);
  return e;
}

// Rozpad jak w processSplits: rodzic zostaje przy reszcie, luźna grupa → wrak.
function splitWreck(parent, predicate) {
  const shards = parent.hexGrid.shards;
  const loose = shards.filter(predicate);
  const main = shards.filter(s => !predicate(s));
  D.rebuildEntityGrid(parent, main);
  return D.spawnWreckEntity(parent, loose, null);
}

// Wrak gotowy do zamrożenia: śpi od dawna, cisza po trafieniu.
function makeSleepyWreck(image = SMALL_IMAGE, x = 0, y = 0) {
  const parent = makeHull(image, { x, y });
  const wreck = splitWreck(parent, s => s.c >= 2);
  wreck.x = x;
  wreck.y = y;
  wreck.vx = 0;
  wreck.vy = 0;
  wreck.angVel = 0;
  wreck._wreckSleeping = true;
  wreck._wreckSleptSec = COLD_WRECK_CONFIG.afterSec + 1;
  wreck._lastImpactMs = -1e9;
  return wreck;
}

function makeSystem(wrecks, coldWrecks, overrides = {}) {
  return createColdWreckSystem({
    wrecks,
    coldWrecks,
    getSimTimeMs: () => 1e7,
    ...overrides
  });
}

function describeGrid(w) {
  const g = w.hexGrid;
  const live = new Map();
  for (const s of g.shards) {
    if (!s.active || s.isDebris) continue;
    live.set(`${s.c},${s.r}`, {
      hp: s.hp, maxHp: s.maxHp, bx: s._bakedOffX, by: s._bakedOffY,
      gx: s.gridX, gy: s.gridY, ox: s.origGridX, oy: s.origGridY
    });
  }
  return {
    live,
    active: g.activeStructuralCount,
    base: g.baseStructuralCount,
    pivot: g.pivot ? { x: g.pivot.x, y: g.pivot.y } : null,
    isFragment: g.isFragment,
    disableSolidArmorLod: g.disableSolidArmorLod,
    cols: g.cols,
    rows: g.rows,
    srcWidth: g.srcWidth,
    srcHeight: g.srcHeight,
    armorImage: g.armorImage,
    drift: g._maxHexDrift,
    x: w.x,
    y: w.y,
    angle: w.angle
  };
}

test('zrzut → zamrożenie → odtworzenie: siatka, łup, ładunek i broń po komórkach bez zmian', () => {
  resetHexArenaForTests({ capacity: 8192 });
  const parent = makeHull(HULL_IMAGE, { x: 500, y: 200, angle: 0.3 });
  const cols = parent.hexGrid.cols;
  // Manifest łupu rodzica: działo przykręcone do komórki, która odleci z wrakiem.
  parent._salvage = {
    weapons: [
      { weaponId: 'railgun_heavy', cell: '15,3' },
      { weaponId: 'laser_pd', cell: '2,2' }
    ],
    materials: { scrap: 40, steel: 12 },
    sourceShards: parent.hexGrid.shards.length,
    remainingShards: parent.hexGrid.shards.length,
    label: 'Test Hull'
  };
  const wreck = splitWreck(parent, s => s.c >= 14);
  assert.ok(wreck?.isWreck, 'wrak powstał');
  assert.equal(wreck.hexGrid.hexTemplate, parent.hexGrid.hexTemplate, 'fragment dziedziczy klucz szablonu');
  assert.deepEqual(wreck._salvage.weapons.map(w => w.cell), ['15,3'], 'działo odleciało z fragmentem');

  // Stan wraku do odtworzenia: wyrwa, uszkodzone HP, trwałe wgniecenie, dryf.
  const byKey = new Map(wreck.hexGrid.shards.map(s => [`${s.c},${s.r}`, s]));
  D.destroyShard(wreck, byKey.get('20,0'), { x: 0, y: 0 });
  byKey.get('16,4').hp = 33.5;
  byKey.get('17,2').hp = 12.25;
  const dented = byKey.get('18,5');
  dented.gridX += 3.25; dented._bakedOffX += 3.25;
  dented.gridY -= 1.5; dented._bakedOffY -= 1.5;
  wreck.hexGrid._maxHexDrift = 4.5;
  wreck.x = 1234.5; wreck.y = -987.25; wreck.angle = 0.7;
  wreck._cargoManifest = { steel: 5 };
  wreck._cargoOrderId = 'order-1';
  wreck._wreckAge = 99;
  const salvageRef = wreck._salvage;
  const cargoRef = wreck._cargoManifest;
  const before = describeGrid(wreck);
  assert.equal(before.live.size, before.active, 'licznik aktywnych zgodny z maską');

  const wrecks = [wreck];
  const coldWrecks = [];
  const calls = [];
  const tow = new TowConstraintSystem();
  const anchor = makeHull(SMALL_IMAGE, { x: 1500, y: -900 });
  tow.attach(anchor, wreck, { length: 300 });
  const system = makeSystem(wrecks, coldWrecks, {
    onBeforeFreeze: (w, snap) => {
      calls.push({ w, snap, hadGrid: !!w.hexGrid });
      tow.detachBody(w, 'wreck-cold');
    }
  });

  const allocatedBefore = getHexArenaStats().allocated;
  const members = wreck.hexGrid._packedBody.memberCount;
  assert.equal(system.freeze(wreck), true);

  // Po zamrożeniu: poza wrecks, bez siatki, duch, arena zwolniona.
  assert.equal(wrecks.includes(wreck), false);
  assert.deepEqual(coldWrecks, [wreck]);
  assert.equal(wreck.hexGrid, null);
  assert.equal(wreck.isCollidable, false);
  assert.equal(wreck.isCold, true);
  assert.equal(wreck.vx, 0);
  assert.equal(wreck.angVel, 0);
  assert.equal(getHexArenaStats().allocated, allocatedBefore - members, 'wszystkie sloty wraku wróciły do areny');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hadGrid, true, 'hak przed zwolnieniem siatki (renderer czyta zasięg)');
  assert.equal(tow.isAttached(wreck), false, 'lina odpięta');
  assert.equal(D._wreckPool.includes(wreck), false, 'zimny wrak nie jest w puli');
  const snap = wreck._coldSnapshot;
  assert.equal(snap.cells.length, before.live.size);
  assert.equal(snap.summary.weapons, 1);
  assert.equal(snap.summary.hasCargo, true);
  assert.equal(snap.summary.hasScrap, true);

  // Sloty areny dostają inne heksy — zrzut nie może z nich czytać.
  const squatter = makeHull(HULL_IMAGE, { x: -5000, y: 0 });
  for (const s of squatter.hexGrid.shards) { s.hp = 1; s.gridX += 50; }

  const result = system.thaw(wreck, 'test');
  assert.equal(result, THAW_RESULT.THAWED);
  assert.deepEqual(wrecks, [wreck]);
  assert.equal(coldWrecks.length, 0);
  assert.equal(wreck.isCold, false);
  assert.equal(wreck.isCollidable, true);
  assert.equal(wreck._wreckSleeping, false, 'obudzony');
  assert.equal(wreck.hexGrid.isSleeping, false);
  assert.ok(wreck.hexGrid._packedBody, 'znów w arenie');
  assert.equal(wreck._coldSnapshot, null);

  const after = describeGrid(wreck);
  assert.deepEqual([...after.live.keys()].sort(), [...before.live.keys()].sort(), 'maska żywych');
  for (const [key, b] of before.live) {
    const a = after.live.get(key);
    assert.equal(a.hp, Math.fround(b.hp), `hp ${key}`);
    assert.equal(a.maxHp, Math.fround(b.maxHp), `maxHp ${key}`);
    assert.equal(a.bx, Math.fround(b.bx), `bakedX ${key}`);
    assert.equal(a.by, Math.fround(b.by), `bakedY ${key}`);
    assert.equal(a.ox, b.ox, `origGridX ${key}`);
    assert.ok(Math.abs(a.gx - b.gx) < 1e-6, `gridX ${key}`);
    assert.ok(Math.abs(a.gy - b.gy) < 1e-6, `gridY ${key}`);
  }
  assert.equal(after.live.get('16,4').hp, 33.5);
  assert.equal(after.live.get('18,5').bx, 3.25);
  assert.equal(after.live.has('20,0'), false, 'wyrwa została wyrwą');
  for (const key of ['active', 'base', 'isFragment', 'disableSolidArmorLod', 'cols', 'rows',
    'srcWidth', 'srcHeight', 'armorImage', 'drift', 'x', 'y', 'angle']) {
    assert.equal(after[key], before[key], key);
  }
  assert.deepEqual(after.pivot, before.pivot, 'pivot');
  assert.equal(wreck._salvage, salvageRef, 'manifest łupu to ten sam obiekt');
  assert.equal(wreck._cargoManifest, cargoRef, 'ładunek to ten sam obiekt');
  assert.equal(wreck._cargoOrderId, 'order-1');
  assert.equal(wreck._wreckAge, 99);

  // Sąsiedzi odbudowani: heks w środku ma 6 żywych sąsiadów, jak przed zamrożeniem.
  const inner = wreck.hexGrid.map['16,3'];
  assert.equal(inner.neighbors.length, 6);
  assert.equal(wreck.hexGrid.grid[16 + 3 * cols], inner);

  // Broń nadal „po komórce”: kolejny rozpad zabiera działo z właściwym kawałkiem.
  assert.ok(wreck.hexGrid.map['15,3'], 'komórka działa istnieje po odmrożeniu');
  const chip = splitWreck(wreck, s => s.c <= 15);
  assert.deepEqual(chip._salvage.weapons.map(w => w.weaponId), ['railgun_heavy']);
  assert.equal(wreck._salvage.weapons.length, 0);
});

test('warunki zamrożenia: odwołania, obudzone ciało, niedawne trafienie i kadr blokują; reszta marznie w budżecie klatki', () => {
  resetHexArenaForTests({ capacity: 16384 });
  const wrecks = [];
  for (let i = 0; i < 10; i++) wrecks.push(makeSleepyWreck(SMALL_IMAGE, i * 400, 0));

  const towed = makeSleepyWreck(SMALL_IMAGE, 0, 20000);
  const cut = makeSleepyWreck(SMALL_IMAGE, 400, 20000);
  const locked = makeSleepyWreck(SMALL_IMAGE, 800, 20000);
  const hovered = makeSleepyWreck(SMALL_IMAGE, 1200, 20000);
  const nearShip = makeSleepyWreck(SMALL_IMAGE, 0, -30000);
  const nearSleeper = makeSleepyWreck(SMALL_IMAGE, 0, -60000);
  const recentlyHit = makeSleepyWreck(SMALL_IMAGE, 0, 40000);
  const onScreen = makeSleepyWreck(SMALL_IMAGE, 400, 40000);
  const restless = makeSleepyWreck(SMALL_IMAGE, 800, 40000);
  restless._wreckSleptSec = COLD_WRECK_CONFIG.afterSec - 1;
  const holding = makeSleepyWreck(SMALL_IMAGE, 1200, 40000);
  holding.noWreckSleep = true;
  const blocked = [towed, cut, locked, hovered, nearShip, recentlyHit, onScreen, restless, holding];
  wrecks.push(...blocked, nearSleeper);

  // Prawdziwe trafienie: applyImpact budzi wrak i stempluje czas symulacji.
  D._simulationTime = 5000;
  const hitShard = recentlyHit.hexGrid.shards[0];
  const hitX = recentlyHit.x + (hitShard.gridX - recentlyHit.hexGrid.srcWidth * 0.5 - recentlyHit.hexGrid.pivot.x);
  const hitY = recentlyHit.y + (hitShard.gridY - recentlyHit.hexGrid.srcHeight * 0.5 - recentlyHit.hexGrid.pivot.y);
  assert.equal(D.applyImpact(recentlyHit, hitX, hitY, 5, { x: 0, y: 0 }, { shard: hitShard }), true);
  assert.equal(recentlyHit._lastImpactMs, 5000 * 1000);
  recentlyHit._wreckSleeping = true; // gra uśpi go ponownie — trafienie ma blokować i tak

  const liveShip = { x: 800, y: -30000, radius: 200, vx: 0, vy: 0 };
  const sleepingNeighbour = { x: -300, y: -60000, radius: 100, isWreck: true, _wreckSleeping: true };
  const coldWrecks = [];
  const references = new Set([towed, cut, locked]);
  const system = makeSystem(wrecks, coldWrecks, {
    getSimTimeMs: () => 5000 * 1000 + 3000,
    markReferences: (stamp) => { for (const w of references) w._coldRefStamp = stamp; },
    isReferenced: (w) => w === hovered,
    isVisuallySafe: (w) => w !== onScreen,
    getAwakeBodies: () => [liveShip, sleepingNeighbour, nearShip]
  });

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
    assert.ok(wrecks.includes(w) && w.hexGrid, 'zablokowany zostaje w wrecks, z siatką');
  }

  // Kilka sekund później nadal nic z zablokowanych — skan co 0,5 s ich nie weźmie.
  for (let i = 0; i < 300; i++) system.step(1 / 60);
  assert.equal(coldWrecks.length, 11);
});

test('thawWreck: najwyżej jedno odmrożenie na klatkę, reszta w kolejce z wywołaniem zwrotnym', () => {
  resetHexArenaForTests({ capacity: 8192 });
  const a = makeSleepyWreck(SMALL_IMAGE, 0, 0);
  const b = makeSleepyWreck(SMALL_IMAGE, 5000, 0);
  const wrecks = [a, b];
  const coldWrecks = [];
  const system = makeSystem(wrecks, coldWrecks);
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
  assert.ok(wrecks.includes(b) && b.hexGrid);
  // Już gorący: akcja od razu.
  assert.equal(system.thaw(b, 'tow', w => ready.push(w)), THAW_RESULT.THAWED);
  assert.equal(ready.length, 3);
});

test('getFrameId: budżet odmrożeń na klatkę rAF, także dla wywołań z UI między krokami', () => {
  resetHexArenaForTests({ capacity: 8192 });
  const a = makeSleepyWreck(SMALL_IMAGE, 0, 0);
  const b = makeSleepyWreck(SMALL_IMAGE, 5000, 0);
  const c = makeSleepyWreck(SMALL_IMAGE, 9000, 0);
  const wrecks = [a, b, c];
  const coldWrecks = [];
  let frame = 7;
  const system = makeSystem(wrecks, coldWrecks, { getFrameId: () => frame });
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

test('MAX_COLD_WRECKS: wyrzuca najdalszego od gracza, nigdy wraka z ładunkiem; pula wydaje go jako nowy wrak', () => {
  resetHexArenaForTests({ capacity: 16384 });
  const near = makeSleepyWreck(SMALL_IMAGE, 100, 0);
  const mid = makeSleepyWreck(SMALL_IMAGE, 3000, 0);
  const far = makeSleepyWreck(SMALL_IMAGE, 9000, 0);
  const farthestCargo = makeSleepyWreck(SMALL_IMAGE, 60000, 0);
  farthestCargo._cargoManifest = { ore_iron: 3 };
  const farther = makeSleepyWreck(SMALL_IMAGE, 20000, 0);
  const wrecks = [near, mid, far, farthestCargo, farther];
  const coldWrecks = [];
  const evicted = [];
  const system = makeSystem(wrecks, coldWrecks, {
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
    assert.equal(w._inPool, true);
    assert.equal(w.dead, true);
    assert.equal(w.isCold, false);
    assert.equal(w._salvage, null, 'łup czyszczony dopiero przy recyklingu');
  }

  // Wyrzucony zimny wrak nie ma siatki — pula musi dać mu nową skorupę.
  const parent = makeHull(SMALL_IMAGE, { x: 0, y: 0 });
  const reused = splitWreck(parent, s => s.c >= 3);
  assert.ok(evicted.includes(reused), 'obiekt z puli');
  assert.equal(reused.isCold, false);
  assert.equal(reused._inPool, false);
  assert.ok(reused.hexGrid?.shards?.length > 0);
  assert.equal(coldWrecks.includes(reused), false);
});

// Okręt i wrak burta w burtę, po ustaleniu styku (lekkie nachodzenie rozepchnięte).
function makeRestingPair() {
  const ship = makeHull(HULL_IMAGE, { x: 0, y: 0, mass: 60000 });
  const wreck = makeHull(HULL_IMAGE, { x: 0, y: 58, mass: 6000 });
  wreck.isWreck = true;
  let touching = 0;
  for (let i = 0; i < 240; i++) {
    const c0 = D._frameContacts;
    D.collideEntities(ship, wreck, 1 / 120, true);
    if (D._frameContacts > c0) touching++;
    ship.vx = ship.vy = ship.angVel = 0;
    wreck.vx = wreck.vy = wreck.angVel = 0;
  }
  assert.ok(touching > 0, 'para się styka');
  return { ship, wreck };
}

test('kontakt spoczynkowy nie zeruje licznika snu wraku; ruch i szybka para — tak', () => {
  resetHexArenaForTests({ capacity: 8192 });
  const { ship, wreck } = makeRestingPair();

  wreck._wreckSleeping = false;
  wreck._wreckSleepTimer = 1.0;
  wreck._lastImpactMs = -1;
  let contacts = 0;
  for (let i = 0; i < 120; i++) {
    const c0 = D._frameContacts;
    D.collideEntities(ship, wreck, 1 / 120, true);
    contacts += D._frameContacts - c0;
  }
  assert.ok(contacts > 0, 'styk trwa');
  assert.equal(wreck._wreckSleepTimer, 1.0, 'spoczynkowy styk nie budzi');
  assert.equal(wreck._lastImpactMs, -1, 'i nie liczy się jako trafienie');

  // Okręt rusza (≥ próg snu wraku) — wrak ma się obudzić.
  ship.vy = 30;
  D.collideEntities(ship, wreck, 1 / 120, true);
  assert.equal(wreck._wreckSleepTimer, 0, 'ruchome ciało budzi wrak');
  assert.ok(wreck._lastImpactMs >= 0);

  // Szybka para budzi nawet śpiący wrak (świeża para — poprzedni zgniot wgniótł styk).
  const fast = makeRestingPair();
  fast.wreck._wreckSleeping = true;
  fast.wreck._wreckSleepTimer = 2;
  fast.ship.vy = 120;
  const c0 = D._frameContacts;
  D.collideEntities(fast.ship, fast.wreck, 1 / 120, true);
  assert.ok(D._frameContacts > c0, 'kontakt jest');
  assert.equal(fast.wreck._wreckSleeping, false);
  assert.equal(fast.wreck._wreckSleepTimer, 0);

  // Wolny okręt (poniżej progu), ale głębokie nachodzenie: korekta przesuwa
  // wrak o więcej niż próg — kontakt faktycznie go ruszył.
  const deep = makeRestingPair();
  deep.wreck.y -= 6;
  deep.wreck._wreckSleepTimer = 1.5;
  D.collideEntities(deep.ship, deep.wreck, 1 / 120, true);
  assert.equal(deep.wreck._wreckSleepTimer, 0, 'wypchnięcie z nachodzenia budzi');
});

test('zrzut odrzuca siatkę spoza szablonu (awaryjny wrak) — takiego nie zamrażamy', () => {
  resetHexArenaForTests({ capacity: 4096 });
  const w = makeSleepyWreck(SMALL_IMAGE, 0, 0);
  w.hexGrid.hexTemplate = null;
  assert.equal(captureHexBodySnapshot(w), null);
  const wrecks = [w];
  const system = makeSystem(wrecks, []);
  assert.equal(system.isFreezeCandidate(w), false);
  assert.equal(system.freeze(w), false);
  assert.ok(wrecks.includes(w) && w.hexGrid);
  assert.equal(DESTRUCTOR_CONFIG.packedHexArena, 1);
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
  assert.match(sliceFunction(src, 'function removeWreckFromWorld(wreck)'), /coldWreckSystem\.forget\(wreck\);\s*DestructorSystem\?\.recycleWreck\?\.\(wreck\);/);

  const freezeHook = src.slice(src.indexOf('onBeforeFreeze(w) {'), src.indexOf('onThawed(w, reason) {'));
  assert.ok(freezeHook.indexOf('captureColdWreckImpostor') < freezeHook.indexOf('invalidateHexShipEntity3D(w)'),
    'smuga zapisana, zanim meshe znikną');
  assert.match(freezeHook, /TowSystem\.detachBody\(w, 'wreck-cold'\)/);

  assert.match(src, /updateHexShips3D\(cam, renderEntities, _hexCullInfo, coldWrecks\);/);
  assert.match(src, /for \(const w of wrecks\) if \(w && !w\.dead\) renderEntities\.push\(w\);/, 'renderEntities tylko z wrecks');
  assert.match(src, /setPerfHudWorldSource\(\(\) => \(\{ ship, npcs, wrecks, coldWrecks, bullets/);
  const hud = readFileSync(new URL('../src/ui/perfHud.js', import.meta.url), 'utf8');
  assert.match(hud, /Wraki gorące \/ śpiące \/ zimne/);
  assert.match(hud, /coldWreckCount: Array\.isArray\(coldWrecks\) \? coldWrecks\.length : 0/);
});
