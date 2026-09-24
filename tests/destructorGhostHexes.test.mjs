// „Heksy-duchy”: siatka heksów jest indeksowana komórką POCZĄTKOWĄ, a wgnieciony
// heks (plastyczność solvera przesuwa gridX o `_bakedOffX`) stoi dziś gdzie
// indziej. Sondy trafień patrzyły w stałe okno komórek wokół punktu, więc heks
// wypchnięty poza nie był niewidzialny: pociski i wiązki przelatywały przez
// wgniecenie. Okna rosną teraz o zmierzony `_maxHexDrift` (sufit probeDriftCap).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DestructorSystem as D,
  DESTRUCTOR_CONFIG as C,
  disposeHexBody,
  findBeamHexShard,
  getHexProbeDrift
} from '../src/game/destructor.js';
import { getHexShardDrift } from '../src/game/hexContactGrid.js';
import { makeDestructorHull as hull } from './helpers/destructorHull.mjs';

const HIT_RAD = 5 * 1.3;
const BEAM_HIT_RAD_SQ = 90; // index.html: max(90, (r·1.45)²) dla gridDivisions 5

// Wypieczenie plastyczności jak w DestructorGpuSoftBody._applyResult /
// simulateElasticity: siatka spoczynkowa jedzie razem z _bakedOff, a licznik
// dryfu rośnie od razu (noteHexDrift).
function bake(entity, shard, dx, dy) {
  shard.gridX += dx;
  shard.gridY += dy;
  shard._bakedOffX += dx;
  shard._bakedOffY += dy;
  const grid = entity.hexGrid;
  const drift = getHexShardDrift(shard, C.collisionDeformScale);
  if (drift > (grid._maxHexDrift || 0)) grid._maxHexDrift = drift;
}

// Kadłub z helpera: kąt 0, skala 1, bez pivota — świat = pozycja + siatka − środek.
function worldOf(entity, gx, gy) {
  return { x: entity.x + gx - entity.hexGrid.srcWidth * 0.5, y: entity.y + gy - entity.hexGrid.srcHeight * 0.5 };
}

function interiorShard(entity) {
  const { srcWidth: w, srcHeight: h, shards } = entity.hexGrid;
  let best = null;
  let bestD = Infinity;
  for (const s of shards) {
    const d = Math.hypot(s.gridX - w * 0.5, s.gridY - h * 0.5);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

// Zostaje sam badany heks — sąsiad w punkcie trafienia maskowałby ducha.
function isolate(entity, keep) {
  for (const s of entity.hexGrid.shards) {
    if (s === keep) continue;
    s.active = false;
    s.isDebris = true;
  }
}

function withProbeDriftCap(value, fn) {
  const prev = C.probeDriftCap;
  C.probeDriftCap = value;
  try { return fn(); } finally { C.probeDriftCap = prev; }
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segmentCircleToi(x0, y0, x1, y1, cx, cy, radius) {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const r2 = radius * radius;
  if (fx * fx + fy * fy <= r2) return 0;
  const a = dx * dx + dy * dy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r2;
  const disc = b * b - 4 * a * c;
  if (a <= 1e-12 || disc < 0) return -1;
  const root = Math.sqrt(disc);
  const near = (-b - root) / (2 * a);
  if (near >= 0 && near <= 1) return near;
  const far = (-b + root) / (2 * a);
  return far >= 0 && far <= 1 ? far : -1;
}

const collisionX = (s) => s.gridX + s.deformation.x * C.collisionDeformScale;
const collisionY = (s) => s.gridY + s.deformation.y * C.collisionDeformScale;
const live = (s) => s.active && !s.isDebris;

for (const [label, dx, dy] of [['along x', 40, 0], ['along y', 0, 40], ['diagonally', 40, -40]]) {
  test(`point probe finds a hex baked 40 px ${label} out of its cell`, () => {
    const e = hull({ width: 320, height: 160, x: 1000, y: -500 });
    try {
      const shard = interiorShard(e);
      const oldX = shard.gridX, oldY = shard.gridY;
      isolate(e, shard);
      bake(e, shard, dx, dy);
      assert.ok(getHexProbeDrift(e.hexGrid) >= 40);

      const at = worldOf(e, shard.gridX, shard.gridY);
      assert.equal(D.probeImpact(e, at.x, at.y), true, 'metal stands at the dented position');
      assert.equal(D._probeImpactData(e, at.x, at.y).hitShard, shard);
      // 12 px obok (w promieniu sondy 2 × hitRadius) — też ten heks
      const near = worldOf(e, shard.gridX + 9, shard.gridY - 8);
      assert.equal(D._probeImpactData(e, near.x, near.y)?.hitShard, shard);

      const was = worldOf(e, oldX, oldY);
      assert.equal(D.probeImpact(e, was.x, was.y), false, 'nothing is left at the original cell');

      // Dawne okno (bez zapasu) — dokładnie ten błąd.
      withProbeDriftCap(0, () => assert.equal(D.probeImpact(e, at.x, at.y), false));
    } finally { disposeHexBody(e); }
  });
}

test('swept projectile hits a hex baked out of the cells around its path', () => {
  const e = hull({ width: 320, height: 160 });
  try {
    const shard = interiorShard(e);
    isolate(e, shard);
    bake(e, shard, 40, 40);
    // Pionowy tor przez nowe położenie: pudło komórek wokół toru (±3) nie
    // sięga komórki, z której heks pochodzi (~5 kolumn i wierszy dalej).
    const a = worldOf(e, shard.gridX, shard.gridY - 60);
    const b = worldOf(e, shard.gridX, shard.gridY + 60);
    const hit = D.sweepImpact(e, a.x, a.y, b.x, b.y, 2);
    assert.ok(hit, 'the projectile must stop on the dented hex');
    assert.equal(hit.hitShard, shard);
    const reach = shard.hitRadius * 2 + 2;
    assert.ok(Math.abs(hit.t - (60 - reach) / 120) < 1e-9, `t=${hit.t}`);
    // Punkt trafienia leży w heksie — sonda applyImpact znajduje ten sam heks.
    assert.equal(D._probeImpactData(e, hit.worldX, hit.worldY).hitShard, shard);

    withProbeDriftCap(0, () => assert.equal(D.sweepImpact(e, a.x, a.y, b.x, b.y, 2), null));
  } finally { disposeHexBody(e); }
});

test('beam raymarch point search sees a dented hex and returns the nearest one', () => {
  const e = hull({ width: 320, height: 160 });
  try {
    const grid = e.hexGrid;
    const shard = interiorShard(e);
    const other = grid.shards.find((s) => s.c === shard.c + 1 && s.r === shard.r);
    const oldX = shard.gridX, oldY = shard.gridY;
    for (const s of grid.shards) if (s !== shard && s !== other) { s.active = false; s.isDebris = true; }
    bake(e, shard, -35, 30);
    // Drugi heks tuż obok wgniecionego, ale dalej od punktu sondy.
    bake(e, other, shard.gridX + 8 - other.gridX, shard.gridY - other.gridY);

    assert.equal(findBeamHexShard(grid, shard.gridX + 1, shard.gridY + 1, BEAM_HIT_RAD_SQ), shard);
    assert.equal(findBeamHexShard(grid, shard.gridX + 7, shard.gridY, BEAM_HIT_RAD_SQ), other);
    assert.equal(findBeamHexShard(grid, oldX, oldY, BEAM_HIT_RAD_SQ), null);
    // Wiązka liczy pozycję WIZUALNĄ (bez collisionDeformScale).
    shard.deformation.x = 6;
    assert.equal(findBeamHexShard(grid, shard.gridX + 6, shard.gridY, BEAM_HIT_RAD_SQ), shard);
    withProbeDriftCap(0, () => assert.equal(findBeamHexShard(grid, shard.gridX + 1, shard.gridY + 1, BEAM_HIT_RAD_SQ), null));
  } finally { disposeHexBody(e); }
});

test('applyImpact damages the hex the hit already found instead of re-probing', () => {
  const e = hull({ width: 320, height: 160 });
  const stranger = hull({ width: 320, height: 160 });
  try {
    const shard = interiorShard(e);
    isolate(e, shard);
    // Heks brzegowy: sonda punktowa ma promień 2 × hitRadius ≈ 5,5 px, a raymarch
    // wiązki przyjmuje trafienie do ~9,5 px — dotąd takie trafienie ginęło.
    shard.hitRadius = HIT_RAD * 0.42;
    const p = worldOf(e, shard.gridX - 9, shard.gridY);
    const vel = { x: 2000, y: 0 };
    const hp0 = shard.hp;

    assert.equal(D.applyImpact(e, p.x, p.y, 10, vel), false, 'the point probe alone misses the edge hex');
    assert.equal(shard.hp, hp0);

    // Heks z innej siatki albo już martwy = zwykła sonda (tu: pudło).
    const foreign = interiorShard(stranger);
    assert.equal(D.applyImpact(e, p.x, p.y, 10, vel, { shard: foreign }), false);
    assert.equal(foreign.hp, foreign.maxHp);

    assert.equal(D.applyImpact(e, p.x, p.y, 10, vel, { shard }), true);
    // 0,9 × obrażeń wprost w heks + jego udział w polu distributeStructuralDamage
    assert.ok(shard.hp <= hp0 - 9 + 1e-9, `direct damage lands on the given hex: ${shard.hp}`);

    // Heks daleko od punktu (np. wołający liczył w innym układzie) nie dostaje
    // obrażeń „na odległość” — rozstrzyga sonda w punkcie trafienia.
    const far = worldOf(e, shard.gridX - 60, shard.gridY);
    const hp1 = shard.hp;
    assert.equal(D.applyImpact(e, far.x, far.y, 10, vel, { shard }), false);
    assert.equal(shard.hp, hp1);

    shard.active = false;
    assert.equal(D.applyImpact(e, p.x, p.y, 10, vel, { shard }), false);
  } finally { disposeHexBody(e); disposeHexBody(stranger); }
});

test('windowed probe, sweep and beam search match brute force on a randomly dented hull', () => {
  const rand = makeRng(20260924);
  const e = hull({ width: 360, height: 180, x: 50, y: 20 });
  try {
    const grid = e.hexGrid;
    for (const s of grid.shards) {
      if (rand() < 0.3) { s.active = false; s.isDebris = true; continue; }
      s.hitRadius = HIT_RAD * (0.42 + 0.58 * rand());
      if (rand() < 0.4) {
        s.gridX += (rand() * 2 - 1) * 50;
        s.gridY += (rand() * 2 - 1) * 50;
      }
      s.deformation.x = s.targetDeformation.x = (rand() * 2 - 1) * 20;
      s.deformation.y = s.targetDeformation.y = (rand() * 2 - 1) * 20;
    }
    let drift = 0;
    for (const s of grid.shards) if (live(s)) drift = Math.max(drift, getHexShardDrift(s, C.collisionDeformScale));
    grid._maxHexDrift = drift;
    assert.ok(drift > 50 && drift <= C.probeDriftCap, `drift ${drift}`);

    const w = grid.srcWidth, h = grid.srcHeight;
    const randPoint = () => ({ gx: -40 + rand() * (w + 80), gy: -40 + rand() * (h + 80) });

    for (let i = 0; i < 1500; i++) {
      const { gx, gy } = randPoint();
      let expected = null;
      let bestD2 = Infinity;
      let beamExpected = null;
      let beamD2 = BEAM_HIT_RAD_SQ;
      for (const s of grid.shards) {
        if (!live(s)) continue;
        const d2 = (collisionX(s) - gx) ** 2 + (collisionY(s) - gy) ** 2;
        const r = s.hitRadius * 2;
        if (d2 < r * r && d2 < bestD2) { bestD2 = d2; expected = s; }
        const v2 = (s.gridX + s.deformation.x - gx) ** 2 + (s.gridY + s.deformation.y - gy) ** 2;
        if (v2 < beamD2) { beamD2 = v2; beamExpected = s; }
      }
      const p = worldOf(e, gx, gy);
      assert.equal(D._probeImpactData(e, p.x, p.y)?.hitShard ?? null, expected, `probe at ${gx},${gy}`);
      assert.equal(D.probeImpact(e, p.x, p.y), !!expected);
      assert.equal(findBeamHexShard(grid, gx, gy, BEAM_HIT_RAD_SQ), beamExpected, `beam at ${gx},${gy}`);
    }

    for (let i = 0; i < 400; i++) {
      const a = randPoint();
      const len = 10 + rand() * 90;
      const ang = rand() * Math.PI * 2;
      const b = { gx: a.gx + Math.cos(ang) * len, gy: a.gy + Math.sin(ang) * len };
      const projR = rand() * 6;
      let bestT = Infinity;
      let expected = null;
      for (const s of grid.shards) {
        if (!live(s)) continue;
        const t = segmentCircleToi(a.gx, a.gy, b.gx, b.gy, collisionX(s), collisionY(s), s.hitRadius * 2 + projR);
        if (t >= 0 && t < bestT) { bestT = t; expected = s; }
      }
      const p0 = worldOf(e, a.gx, a.gy);
      const p1 = worldOf(e, b.gx, b.gy);
      const hit = D.sweepImpact(e, p0.x, p0.y, p1.x, p1.y, projR);
      if (!expected) { assert.equal(hit, null, `sweep ${i} must miss`); continue; }
      assert.ok(hit, `sweep ${i} must hit`);
      assert.ok(Math.abs(hit.t - bestT) < 1e-9, `sweep ${i}: t ${hit.t} vs ${bestT}`);
      // Start w kilku okręgach naraz = remis t = 0; kolejność przeglądu nie jest kontraktem.
      if (bestT > 1e-9) assert.equal(hit.hitShard, expected, `sweep ${i}`);
    }
  } finally { disposeHexBody(e); }
});

test('probe windows stay bounded when the drift counter is pathological', () => {
  const e = hull({ width: 160, height: 80 });
  try {
    e.hexGrid._maxHexDrift = 5000;
    assert.equal(getHexProbeDrift(e.hexGrid), C.probeDriftCap);
    const s = interiorShard(e);
    const p = worldOf(e, s.gridX, s.gridY);
    assert.equal(D._probeImpactData(e, p.x, p.y).hitShard, s);
    e.hexGrid._maxHexDrift = undefined;
    assert.equal(getHexProbeDrift(e.hexGrid), 0, 'no measurement = the old window');
  } finally { disposeHexBody(e); }
});

test('game hit paths hand the found hex to applyImpact', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const beam = html.slice(html.indexOf('window.fireWeaponCore = function'), html.indexOf('// --- LOGIKA POCISKÓW I RAKIET ---'));
  assert.match(beam, /findBeamHexShard\(pt\.hexGrid, gridX, gridY, beamHitRadSq\)/);
  assert.doesNotMatch(beam, /for \(let dr = -1; dr <= 1; dr\+\+\)/, 'the fixed 3x3 window is back in the beam raymarch');
  assert.match(beam, /applyHexImpact\(hitEntity, finalEndX, finalEndY, damage, [^;]*beamHitShard\)/);
  const bullets = html.slice(html.indexOf('function bulletsAndCollisionsStep('));
  assert.match(bullets, /hullShard = hexSweep\.hitShard/);
  assert.match(bullets, /applyHexImpact\(hitNPC\._realEntity \|\| hitNPC, hitX, hitY, npcDamage, [^;]*hitHexShard\)/);
});
