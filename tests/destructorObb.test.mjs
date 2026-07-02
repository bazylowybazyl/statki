import test from 'node:test';
import assert from 'node:assert/strict';

import { entityObbsOverlap, DESTRUCTOR_CONFIG } from '../src/game/destructor.js';

// Geometria z destructor.js: HEX_SPACING = gridDivisions * 1.5, pad OBB = maxDeform*cds + HEX_SPACING*4
const HEX_SPACING = DESTRUCTOR_CONFIG.gridDivisions * 1.5;
const OBB_PAD =
  (DESTRUCTOR_CONFIG.maxDeform * Math.max(1, DESTRUCTOR_CONFIG.collisionDeformScale)) +
  HEX_SPACING * 4;

let tick = 0;
function nextTick() {
  return ++tick;
}

function makeHull({ x = 0, y = 0, angle = 0, w = 2000, h = 500, billboard = false } = {}) {
  return {
    x,
    y,
    angle,
    isAsteroidHex: billboard,
    visual: { spriteScale: 1 },
    hexGrid: { srcWidth: w, srcHeight: h, pivot: null }
  };
}

test('mijanka burta w burtę: okręgi otaczające się przecinają, OBB nie', () => {
  // Dwa równoległe kadłuby 2000x500; promień otoczki ~1031 każdy, więc test okręgów
  // uznałby parę za kolizyjną przy dystansie 1200. OBB odrzuca: 2*(250+pad) < 1200.
  const halfHeightWithPad = 250 + OBB_PAD;
  assert.ok(halfHeightWithPad * 2 < 1200, 'sanity: pad nie może zamknąć szczeliny');

  const A = makeHull({ y: 0 });
  const B = makeHull({ y: 1200 });
  assert.equal(entityObbsOverlap(A, B, nextTick(), 0), false);
});

test('równoległe kadłuby w zasięgu wysokości nakładają się', () => {
  const A = makeHull({ y: 0 });
  const B = makeHull({ y: 700 }); // < 2*(250+pad)
  assert.equal(entityObbsOverlap(A, B, nextTick(), 0), true);
});

test('margines prędkości rozszerza akceptację', () => {
  const A = makeHull({ y: 0 });
  const B = makeHull({ y: 1200 });
  const gap = 1200 - 2 * (250 + OBB_PAD);
  assert.equal(entityObbsOverlap(A, B, nextTick(), gap + 1), true);
  assert.equal(entityObbsOverlap(A, B, nextTick(), Math.max(0, gap - 1)), false);
});

test('obrót o 90 stopni ustawia długą oś w poprzek szczeliny', () => {
  // Ten sam dystans 1200, ale A obrócony o 90° — jego połowa długości (1000+pad)
  // sięga przez szczelinę, więc para MUSI przejść bramkę.
  const A = makeHull({ y: 0, angle: Math.PI / 2 });
  const B = makeHull({ y: 1200 });
  assert.equal(entityObbsOverlap(A, B, nextTick(), 0), true);
});

test('orientacja billboard (asteroidy hex) też respektuje obrót', () => {
  const A = makeHull({ y: 0, angle: Math.PI / 2, billboard: true });
  const B = makeHull({ y: 1200 });
  assert.equal(entityObbsOverlap(A, B, nextTick(), 0), true);

  const A2 = makeHull({ y: 0, billboard: true });
  assert.equal(entityObbsOverlap(A2, B, nextTick(), 0), false);
});

test('brak wymiarów gridu -> zachowawczo przepuszcza (fallback true)', () => {
  const A = makeHull({ y: 0 });
  const broken = { x: 0, y: 99999, angle: 0, hexGrid: {} };
  assert.equal(entityObbsOverlap(A, broken, nextTick(), 0), true);
});
