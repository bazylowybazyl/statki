import test from 'node:test';
import assert from 'node:assert/strict';

import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { buildBeamStructure, BEAM_TYPE, computeNodeSetInertia } from '../src/game/beamBody3D.js';

const CS = 0.5;

function boxStructure({ w = 3, h = 3, d = 3, shell = 0, frameStride = 1, bulkheadEvery = 8 } = {}) {
  const vox = voxelizeTriangles(
    makeBoxTriangles(w, h, d, 0.05, 0.05, 0.05),
    null,
    { cellSize: CS, shellLayers: shell }
  );
  return buildBeamStructure(vox, { cellMassBase: 10, frameStride, bulkheadEvery });
}

test('struktura: węzły, belki i środek masy w zerze', () => {
  const s = boxStructure({});
  assert.ok(s.nodes.length > 50, `za mało węzłów: ${s.nodes.length}`);
  assert.ok(s.beams.length > s.nodes.length, 'belek powinno być więcej niż węzłów');

  let mx = 0, my = 0, mz = 0, m = 0;
  for (const n of s.nodes) { mx += n.ox * n.mass; my += n.oy * n.mass; mz += n.oz * n.mass; m += n.mass; }
  assert.ok(Math.abs(mx / m) < 1e-9, `COM.x = ${mx / m}`);
  assert.ok(Math.abs(my / m) < 1e-9, `COM.y = ${my / m}`);
  assert.ok(Math.abs(mz / m) < 1e-9, `COM.z = ${mz / m}`);

  for (const v of s.invInertia) assert.ok(Number.isFinite(v));
  assert.ok(s.mass > 0 && s.radius > 0);
});

test('powłoka jest TRIANGULOWANA — są przekątne, nie tylko osie', () => {
  // Bez przekątnych sześcian ośmiu węzłów składa się w romb bez oporu.
  // Sprawdzamy, że istnieją belki o długości ≈ cs·√2 (przekątna ścienna).
  const s = boxStructure({});
  const axial = s.beams.filter((b) => Math.abs(b.rest - CS) < 1e-6).length;
  const diagonal = s.beams.filter((b) => Math.abs(b.rest - CS * Math.SQRT2) < 1e-6).length;
  assert.ok(axial > 0, 'brak belek osiowych');
  assert.ok(diagonal > axial, `za mało przekątnych: ${diagonal} vs ${axial} osiowych`);
});

test('węzeł zna liczbę belek z nietkniętej konstrukcji', () => {
  const s = boxStructure({});
  for (const n of s.nodes) {
    assert.equal(n.beamCount, n.beams.length, 'beamCount rozjechany z listą belek');
    assert.ok(n.beamCount > 0, 'węzeł bez belek — wypadłby z konstrukcji');
  }
});

test('każda belka ma sensowne progi i długość spoczynkową', () => {
  const s = boxStructure({});
  for (const b of s.beams) {
    assert.ok(b.rest > 0 && Number.isFinite(b.rest));
    assert.equal(b.rest, b.restBase, 'restBase musi startować równy rest');
    assert.ok(b.stiffness > 0 && b.stiffness <= 1);
    assert.ok(b.break > b.deform, 'próg zerwania musi być wyżej niż próg plastyczności');
    assert.equal(b.broken, false);
    assert.notEqual(s.nodes[b.a], undefined);
    assert.notEqual(s.nodes[b.b], undefined);
  }
});

test('hierarchia materiału: gródź mocniejsza od wręgu, wręg od poszycia', () => {
  const s = boxStructure({ w: 8, h: 3, d: 3, shell: 2, bulkheadEvery: 4 });
  const byType = (t) => s.beams.filter((b) => b.type === t);
  const plating = byType(BEAM_TYPE.PLATING);
  const frames = byType(BEAM_TYPE.FRAME);
  const bulkheads = byType(BEAM_TYPE.BULKHEAD);

  assert.ok(plating.length > 0, 'brak poszycia');
  assert.ok(frames.length > 0, 'brak wręgów — cienkościenna bryła spłaszczy się bez oporu');
  assert.ok(bulkheads.length > 0, 'brak grodzi — kadłub nie ma granic sekcji');
  assert.ok(frames[0].break > plating[0].break, 'wręg słabszy od poszycia');
  assert.ok(bulkheads[0].break > frames[0].break, 'gródź słabsza od wręgu');
});

test('wręgi łączą PRZECIWLEGŁE ściany, nie sąsiadów', () => {
  const s = boxStructure({ w: 6, h: 3, d: 3, shell: 2, frameStride: 1 });
  const frames = s.beams.filter((b) => b.type === BEAM_TYPE.FRAME);
  assert.ok(frames.length > 0);
  for (const b of frames) {
    assert.ok(b.rest > CS * 1.9, `wręg za krótki (${b.rest}) — to nie jest strut przez wnętrze`);
    assert.ok(s.nodes[b.a].surface && s.nodes[b.b].surface, 'wręg powinien łączyć powierzchnie');
  }
});

test('bulkheadEvery=0 wyłącza grodzie', () => {
  const s = boxStructure({ w: 8, bulkheadEvery: 0 });
  assert.equal(s.beams.filter((b) => b.type === BEAM_TYPE.BULKHEAD).length, 0);
  assert.equal(s.stats.bulkheads, 0);
});

test('brak zdublowanych belek', () => {
  const s = boxStructure({});
  const seen = new Set();
  for (const b of s.beams) {
    const key = b.a < b.b ? `${b.a}|${b.b}` : `${b.b}|${b.a}`;
    assert.ok(!seen.has(key), `zdublowana belka ${key}`);
    seen.add(key);
  }
});

test('computeNodeSetInertia: podzbiór węzłów dostaje własny środek masy', () => {
  const s = boxStructure({ w: 6, h: 3, d: 3 });
  const half = s.nodes.filter((n) => n.ox < 0);
  assert.ok(half.length > 3, 'za mały podzbiór');
  const info = computeNodeSetInertia(half, CS);
  assert.ok(info.com.x < -0.1, `środek masy połówki powinien być po jej stronie: ${info.com.x}`);
  assert.ok(info.mass > 0 && info.mass < s.mass);
  for (const v of info.invInertia) assert.ok(Number.isFinite(v));
});
