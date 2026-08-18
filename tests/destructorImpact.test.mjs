import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem } from '../src/game/destructor.js';
import { resolveShipAsteroidCollision } from '../src/game/asteroidDestructor.js';

const HEX_R = 9;
const HEX_SPACING = HEX_R * 1.5;
const HEX_HEIGHT = Math.sqrt(3) * HEX_R;

function makeShard(c, r, index) {
  return {
    c,
    r,
    gridX: c * HEX_SPACING,
    gridY: r * HEX_HEIGHT,
    origGridX: c * HEX_SPACING,
    origGridY: r * HEX_HEIGHT,
    deformation: { x: 0, y: 0 },
    targetDeformation: { x: 0, y: 0 },
    active: true,
    isDebris: false,
    hp: 80,
    maxHp: 80,
    mass: 10,
    hitRadius: HEX_R * 1.3,
    __meshIndex: index,
    neighbors: [],
    applyDeformation(x, y) {
      this.deformation.x += x;
      this.deformation.y += y;
      this.targetDeformation.x += x;
      this.targetDeformation.y += y;
    },
    becomeDebris() {
      this.isDebris = true;
      this.active = false;
    }
  };
}

function makeHexEntity({
  x,
  y = 0,
  vx = 0,
  mass,
  rammingMass,
  isRingSegment = false,
  noSplit = false,
  cols = 8,
  rows = 8,
  shard = makeShard(4, 4, 0)
}) {
  const grid = new Array(cols * rows);
  grid[shard.c + shard.r * cols] = shard;

  return {
    x,
    y,
    vx,
    vy: 0,
    angle: 0,
    angVel: 0,
    radius: 90,
    mass,
    rammingMass,
    isRingSegment,
    noSplit,
    hexGrid: {
      shards: [shard],
      grid,
      map: {},
      cols,
      rows,
      srcWidth: cols * HEX_SPACING,
      srcHeight: rows * HEX_HEIGHT,
      pivot: null,
      _pendingEraseQueue: [],
      activeStructuralCount: 1,
      baseStructuralCount: 1
    }
  };
}

function makeFilledHexEntity(opts) {
  const cols = opts.cols || 8;
  const rows = opts.rows || 8;
  const shards = [];
  const grid = new Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const s = makeShard(c, r, shards.length);
      shards.push(s);
      grid[c + r * cols] = s;
    }
  }

  return {
    x: opts.x,
    y: opts.y || 0,
    vx: opts.vx || 0,
    vy: opts.vy || 0,
    angle: 0,
    angVel: 0,
    radius: Math.max(cols * HEX_SPACING, rows * HEX_HEIGHT) * 0.5,
    mass: opts.mass,
    rammingMass: opts.rammingMass,
    isRingSegment: !!opts.isRingSegment,
    noSplit: !!opts.noSplit,
    hexGrid: {
      shards,
      grid,
      map: {},
      cols,
      rows,
      srcWidth: cols * HEX_SPACING,
      srcHeight: rows * HEX_HEIGHT,
      pivot: null,
      _pendingEraseQueue: [],
      activeStructuralCount: shards.length,
      baseStructuralCount: shards.length
    }
  };
}

function activeShardCount(entity) {
  return entity.hexGrid.shards.filter(s => s.active && !s.isDebris).length;
}

function deformedShardCount(entity, minMagnitude = 4) {
  let count = 0;
  const minSq = minMagnitude * minMagnitude;
  for (const shard of entity.hexGrid.shards) {
    if (!shard || !shard.active || shard.isDebris) continue;
    const dx = Number(shard.targetDeformation?.x) || 0;
    const dy = Number(shard.targetDeformation?.y) || 0;
    if (dx * dx + dy * dy >= minSq) count++;
  }
  return count;
}

// Model zderzeń po usunięciu crashu: JEDNA reguła na każdą prędkość. Testy pilnują,
// żeby nie wróciły progi — odpowiedź silnika ma być ciągła i monotoniczna.

function ringImpact(speed) {
  const shipShard = makeShard(4, 4, 0);
  const ship = makeHexEntity({ x: 0, vx: speed, mass: 800000, shard: shipShard });
  const ring = makeHexEntity({
    x: 10, vx: 0, mass: 2500000, isRingSegment: true, noSplit: true, shard: makeShard(4, 4, 0)
  });
  DestructorSystem.collideEntities(ship, ring, 1 / 60, true);
  return {
    ship,
    ring,
    shipShard,
    deform: Math.hypot(shipShard.targetDeformation.x, shipShard.targetDeformation.y)
  };
}

test('velocity response stays proportional across the old crash thresholds (150 / 200 u/s)', () => {
  // Stary silnik przelaczal tryb na 150 (hardWall) i 200 (isDestruction) u/s: powyzej
  // progu dampEntityAgainstHardWall kasowal 96% predkosci normalnej. Teraz obowiazuje
  // jeden impuls, wiec predkosc po zderzeniu ma byc LINIOWA wzgledem predkosci przed.
  const ratios = [140, 180, 240, 600].map((v) => ringImpact(v).ship.vx / v);

  for (const r of ratios) {
    assert.ok(Number.isFinite(r), `predkosc po zderzeniu ma byc skonczona, dostalem ${r}`);
  }
  const spread = Math.max(...ratios) - Math.min(...ratios);
  assert.ok(
    spread < 0.02,
    `odpowiedz predkosciowa ma byc liniowa — brak przelaczania rezimu; rozrzut ${spread}, ratios=${ratios}`
  );
});

test('collision transfers momentum instead of deleting it', () => {
  // Rdzen zmiany: mur juz nie POCHLANIA pedu (stare normalKeep 0.04 kasowalo go
  // z ukladu). Teraz ped przechodzi na drugie cialo — suma ma sie zgadzac.
  const { ship, ring } = ringImpact(600);

  const before = 800000 * 600;
  const after = 800000 * ship.vx + 2500000 * ring.vx;
  const drift = Math.abs(after - before) / before;

  assert.ok(drift < 0.05, `ped ma byc zachowany, odchylka ${(drift * 100).toFixed(1)}%`);
  assert.ok(ship.vx < 600, `taranujacy ma zwolnic (vx=${ship.vx})`);
  assert.ok(ring.vx > 0, `ring ma dostac pchniecie, a nie zjesc ped (vx=${ring.vx})`);
});

test('crush depth resolves with speed instead of saturating instantly', () => {
  // Przed strojeniem crushEnergy szlo z pedu (~1e7-1e10) przy zaciskaczu ~1e2, wiec
  // deformacja byla ZAWSZE wysycona i nie niosla informacji o sile uderzenia.
  const slow = ringImpact(40).deform;
  const mid = ringImpact(90).deform;
  const fast = ringImpact(150).deform;

  assert.ok(slow > 0, `nawet wolne uderzenie ma wgniatac kadlub, dostalem ${slow}`);
  assert.ok(mid > slow * 1.2, `glebokosc zgniotu ma rosnac z predkoscia (${slow} -> ${mid})`);
  assert.ok(fast > mid * 1.2, `glebokosc zgniotu ma rosnac z predkoscia (${mid} -> ${fast})`);
});

test('a contact hex crumples before it is erased', () => {
  const { shipShard, deform } = ringImpact(600);

  assert.equal(shipShard.active, true, 'heks kontaktowy ma sie wgniesc, a nie wyparowac w jednym ticku');
  assert.ok(deform > 4, `heks kontaktowy ma dostac widoczne wgniecenie, dostalem ${deform}`);
});

function ringRam(speed) {
  const ship = makeFilledHexEntity({
    x: 0, vx: speed, mass: 200000, rammingMass: 800000, cols: 120, rows: 80
  });
  const ring = makeFilledHexEntity({
    x: 800, vx: 0, mass: 2500000, isRingSegment: true, noSplit: true, cols: 80, rows: 80
  });
  const before = activeShardCount(ship);
  DestructorSystem.collideEntities(ship, ring, 1 / 120, true);
  return { lost: before - activeShardCount(ship), dented: deformedShardCount(ship) };
}

test('destruction is graded by energy, not switched on by a threshold', () => {
  // Uderzenie podwarpowe ma WGNIATAC, warpowe ma ROZRYWAC. Stary silnik nie umial
  // tego rozroznic: gdy crush byl aktywny, deformacja byla od razu wysycona.
  const solid = ringRam(4000);
  assert.equal(solid.lost, 0, `4000 u/s ma wgniatac, a nie rozrywac (stracono ${solid.lost})`);
  assert.ok(solid.dented > 0, 'uderzenie podwarpowe ma zostawic widoczne wgniecenie');

  const warp = ringRam(40000);
  assert.ok(warp.lost > 0, 'uderzenie warpowe ma rozerwac kadlub na styku');
});

test('warp impact damage stays bounded to real contacts, not a radius stamp', () => {
  // Stary crashStamp kasowal do 384 heksow w promieniu 320 u wokol punktu trafienia.
  // Teraz gina wylacznie heksy, ktore faktycznie sie zetknely (budzet kontaktow).
  const { lost } = ringRam(40000);

  assert.ok(lost <= 96, `strata ma byc ograniczona do kontaktow, stracono ${lost} heksow`);
});

test('mass dominance changes how much, not which rules apply', () => {
  // Stary overrun wlaczal sie skokowo przy przewadze masy 8x. Teraz ciezszy taranujacy
  // po prostu wgniata glebiej. Predkosc trzymamy w pasmie, ktore sie rozdziela —
  // przy wysyceniu materialu obie proby dobilyby do tego samego sufitu.

  const probe = (victimMass) => {
    const atlas = makeFilledHexEntity({
      x: 0, vx: 60, mass: 200000, rammingMass: 800000, cols: 120, rows: 80
    });
    const victim = makeFilledHexEntity({
      x: 800, vx: 0, mass: victimMass, rammingMass: victimMass, cols: 60, rows: 28
    });
    DestructorSystem.collideEntities(atlas, victim, 1 / 60, true);
    let maxDef = 0;
    for (const s of victim.hexGrid.shards) {
      if (!s?.active || s.isDebris) continue;
      maxDef = Math.max(maxDef, Math.hypot(s.targetDeformation.x, s.targetDeformation.y));
    }
    return maxDef;
  };

  // Przewaga masy rosnie w miare lzejszej ofiary — ponizej i powyzej starego progu 8x.
  const lightAdvantage = probe(400000);  // 2x przewagi
  const heavyAdvantage = probe(20000);   // 40x przewagi

  assert.ok(lightAdvantage > 0, `nawet zblizone masy maja sie wgniatac, dostalem ${lightAdvantage}`);
  assert.ok(
    heavyAdvantage > lightAdvantage,
    `wieksza przewaga masy = glebsze wgniecenie (${lightAdvantage} -> ${heavyAdvantage})`
  );
});

test('legacy big asteroid fallback stops a fast ship instead of rebounding it away from the asteroid', () => {
  const asteroid = {
    alive: true,
    type: 'iron',
    size: 'BIG',
    worldX: 0,
    worldY: 0,
    scale: 1500,
    vx: 0,
    vy: 0,
    hardness: 0.7
  };
  const ship = {
    pos: { x: 600, y: 0 },
    vel: { x: -500, y: 0 },
    w: 3000,
    h: 1000,
    radius: 500,
    angle: 0,
    mass: 800000
  };

  const result = resolveShipAsteroidCollision(ship, asteroid);

  assert.ok(result?.collided);
  assert.ok(
    Math.abs(result.shipVx) < 80,
    `ship normal velocity should be absorbed by the massive asteroid, got vx=${result.shipVx}`
  );
  assert.ok(result.shipDamage > 2500, `massive hard crash should heavily damage the ship, got ${result.shipDamage}`);
});
