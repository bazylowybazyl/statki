import test from 'node:test';
import assert from 'node:assert/strict';

import { DestructorSystem, DESTRUCTOR_CONFIG } from '../src/game/destructor.js';

// Solver plastyczny ("prawdziwa harmonijka"): pchamy lewą kolumnę paska heksów,
// oczekujemy linii zgniotu z propagacją w głąb (gradient przesunięć po kolumnach),
// emergentnego wybrzuszenia na froncie oraz zachowania inwariantu gridX-origGridX.

const SPACING = 13.5;      // gridDivisions(9) * 1.5
const ROWH = Math.sqrt(3) * 9;

function buildStrip(cols, rows) {
  const shards = [];
  const byCR = new Map();
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = c * SPACING;
      const y = r * ROWH + (c % 2 ? ROWH * 0.5 : 0);
      const s = {
        gridX: x, gridY: y,
        origGridX: x, origGridY: y,
        _uvBaseX: x, _uvBaseY: y,
        _pristineX: x, _pristineY: y,
        active: true, isDebris: false,
        c, r, hp: 80, maxHp: 80,
        neighbors: [],
        __meshIndex: shards.length,
        deformation: { x: 0, y: 0 },
        targetDeformation: { x: 0, y: 0 },
        becomeDebris() { this.active = false; this.isDebris = true; },
        _traceHexPath() {}
      };
      shards.push(s);
      byCR.set(c + ',' + r, s);
    }
  }
  for (const s of shards) {
    const odd = (s.c % 2 !== 0);
    const offs = odd
      ? [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
      : [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
    for (const [dc, dr] of offs) {
      const n = byCR.get((s.c + dc) + ',' + (s.r + dr));
      if (n) s.neighbors.push(n);
    }
  }
  return shards;
}

function makeGrid(cols, rows) {
  const shards = buildStrip(cols, rows);
  return {
    shards,
    grid: [],
    cols, rows,
    srcWidth: cols * SPACING, srcHeight: rows * ROWH,
    _plasticSeeds: [],
    isSleeping: false, sleepFrames: 0, wakeHoldFrames: 0,
    meshDirty: false, meshDirtyAll: false, meshDirtyStart: -1, meshDirtyEnd: -1,
    visualDirtyAll: false, visualDirtyStart: -1, visualDirtyEnd: -1,
    activeStructuralCount: shards.length
  };
}

test('plastic solver: linia zgniotu propaguje, front nie przenika, bulge emergentny', () => {
  const prevSolver = DESTRUCTOR_CONFIG.crumpleSolver;
  const prevCompact = DESTRUCTOR_CONFIG.plasticCompactDestroy;
  DESTRUCTOR_CONFIG.crumpleSolver = 1;
  DESTRUCTOR_CONFIG.plasticCompactDestroy = 0.3; // bez destrukcji w tym teście

  try {
    const cols = 30, rows = 7;
    const grid = makeGrid(cols, rows);
    const shards = grid.shards;
    const entity = { hexGrid: grid, dead: false, noSplit: true, vx: 0, vy: 0, mass: 1000 };

    const leftCol = shards.filter(s => s.c === 0);
    for (let t = 0; t < 60; t++) {
      for (const s of leftCol) {
        if (!s.active) continue;
        grid._plasticSeeds.push(s, 5, 0);
      }
      DestructorSystem.updatePlasticCrush([entity], 1 / 120);
    }

    const colPush = (c) => {
      const cs = shards.filter(s => s.c === c && s.active);
      return cs.reduce((a, s) => a + (s.gridX - s._uvBaseX), 0) / Math.max(1, cs.length);
    };
    const spreadY = (c) => {
      const ys = shards.filter(s => s.c === c && s.active).map(s => s.gridY);
      return Math.max(...ys) - Math.min(...ys);
    };
    const baseSpread = (rows - 1) * ROWH;

    // brak NaN
    assert.equal(shards.some(s => !Number.isFinite(s.gridX) || !Number.isFinite(s.gridY)), false);
    // inwariant: origGridX śledzi gridX (GPU pristine lazy-init liczy z różnicy)
    for (const s of shards) {
      assert.ok(Math.abs((s.gridX - s.origGridX)) < 0.001, 'gridX == origGridX (baked=0)');
    }
    // front stawia opór (nie przenika swobodnie) — 60 ticków × 5px = 300 nakazu,
    // materiał ma trzymać front poniżej połowy tego
    assert.ok(colPush(0) < 150, `front ${colPush(0).toFixed(1)} < 150`);
    // propagacja w głąb: gradient kolumn
    assert.ok(colPush(3) > 5, `col3 ${colPush(3).toFixed(1)} > 5`);
    assert.ok(colPush(8) > 0.5, `col8 ${colPush(8).toFixed(1)} > 0.5`);
    assert.ok(colPush(0) > colPush(3) && colPush(3) > colPush(8), 'monotoniczny gradient zgniotu');
    // wybrzuszenie emergentne na froncie, cisza w głębi
    assert.ok(spreadY(2) - baseSpread > 1, `bulge front ${(spreadY(2) - baseSpread).toFixed(1)} > 1`);
    assert.ok(spreadY(20) - baseSpread < 0.5, 'spokojna strefa bez bulge');
  } finally {
    DESTRUCTOR_CONFIG.crumpleSolver = prevSolver;
    DESTRUCTOR_CONFIG.plasticCompactDestroy = prevCompact;
  }
});

test('plastic solver: rozciąganie ponad próg zrywa wiązania', () => {
  const prevSolver = DESTRUCTOR_CONFIG.crumpleSolver;
  DESTRUCTOR_CONFIG.crumpleSolver = 1;
  try {
    const grid = makeGrid(10, 5);
    const shards = grid.shards;
    const entity = { hexGrid: grid, dead: false, noSplit: true, vx: 0, vy: 0, mass: 1000 };

    // rozerwij: kolumny 0-1 ciągnij w lewo mocno, wielokrotnie
    const left = shards.filter(s => s.c <= 1);
    const bondsBefore = shards.reduce((a, s) => a + s.neighbors.length, 0);
    for (let t = 0; t < 40; t++) {
      for (const s of left) {
        if (!s.active) continue;
        grid._plasticSeeds.push(s, -8, 0);
      }
      DestructorSystem.updatePlasticCrush([entity], 1 / 120);
    }
    const bondsAfter = shards.reduce((a, s) => a + s.neighbors.length, 0);
    assert.ok(bondsAfter < bondsBefore, `wiązania zerwane (${bondsBefore} -> ${bondsAfter})`);
  } finally {
    DESTRUCTOR_CONFIG.crumpleSolver = prevSolver;
  }
});
