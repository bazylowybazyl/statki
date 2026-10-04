// Modele 3D kadłubów z automatu (src/3d/ships3d/ships/autoHull3D.js — lotniskowce, superkapitały,
// myśliwiec, megafrachtowiec, kadłuby ruchu v2) i pełny rejestr modeli (ships3D.js). Bez GPU:
// geometria, skala = kadłub gry, uv pokładu, gniazda / światła / mostek z danych gry, obrysy
// aktualne względem sprite'ów, każdy profil kadłuba gry ma model.
// node --test tests/auto3dModel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAutoHull3D, AUTO3D_IDS, AUTO3D_TABLE, autoHullScale } from '../src/3d/ships3d/ships/autoHull3D.js';
import { AUTO3D_OUTLINES } from '../src/3d/ships3d/ships/autoOutlines3D.js';
import { autoHullNozzles } from '../src/3d/ships3d/ships/autoHulls3D.js';
import { SHIP3D_IDS, SHIP3D_MODELS, buildShip3D } from '../src/3d/ships3d/ships/ships3D.js';
import { SHIP3D_MAT, SHIP3D_MAT_COUNT } from '../src/3d/ships3d/meshBuilder3D.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { getHullRenderSize, HULL_RENDER_PROFILES } from '../src/data/ships.js';
import { TRAFFIC_HULLS } from '../src/data/trafficHulls.js';
import { BRIDGE3D_KINDS } from '../src/3d/bridge3DShapes.js';

const hulls = Object.fromEntries(AUTO3D_IDS.map((id) => [id, buildAutoHull3D(id)]));
const pngSize = (path) => { const b = readFileSync(new URL(`../${path}`, import.meta.url)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('rejestr: każdy profil kadłuba gry (HULL_RENDER_PROFILES) ma model 3D, id bez kolizji', () => {
  for (const id of Object.keys(HULL_RENDER_PROFILES)) assert.ok(SHIP3D_MODELS[id], `${id}: profil kadłuba bez modelu 3D`);
  assert.equal(new Set(SHIP3D_IDS).size, SHIP3D_IDS.length);
  for (const id of ['fighter', 'megafreighter_front', 'megafreighter_wagon', 'megafreighter_back']) assert.ok(SHIP3D_MODELS[id], id);
  for (const id of AUTO3D_IDS) assert.equal(SHIP3D_MODELS[id].kind, 'auto');
  const h = buildShip3D('terran_carrier');
  assert.equal(h.id, 'terran_carrier');
});

test('obrysy: zgodne z rozmiarem sprite\'ów i z płótnem ruchu v2', () => {
  for (const id of AUTO3D_IDS) {
    const t = AUTO3D_TABLE[id];
    const out = AUTO3D_OUTLINES[t.outlineOf || id];
    assert.ok(out, `${id}: brak obrysu — uruchom node scripts/webgpu/obrysy-floty.mjs`);
    assert.deepEqual(out.sprite, pngSize(t.sprite), `${id}: sprite ≠ obrys — uruchom generator obrysów`);
    if (TRAFFIC_HULLS[id]?.png && !t.outlineOf) assert.deepEqual(out.sprite, TRAFFIC_HULLS[id].png, `${id}: płótno ≠ TRAFFIC_HULLS.png`);
    assert.ok(out.plates.length >= 1 && out.tiers.length >= 1, `${id}: płyta i tarasy`);
  }
});

test('kadłuby: geometria poprawna, zamknięta objętość, skala = kadłub gry, pokład = sprite', () => {
  for (const id of AUTO3D_IDS) {
    const t = AUTO3D_TABLE[id];
    const h = hulls[id];
    const d = h.builder.build();
    for (let i = 0; i < d.position.length; i++) assert.ok(Number.isFinite(d.position[i]), `${id}: NaN`);
    for (let i = 0; i < d.normal.length; i += 3) assert.ok(Math.abs(Math.hypot(d.normal[i], d.normal[i + 1], d.normal[i + 2]) - 1) < 1e-3, `${id}: normalna`);
    for (const m of d.mat) assert.ok(m >= 0 && m < SHIP3D_MAT_COUNT && Number.isInteger(m), `${id}: materiał ${m}`);
    for (const i of d.index) assert.ok(i < d.vertexCount, `${id}: indeks`);
    assert.ok(d.triangleCount > 500 && d.triangleCount < 80000, `${id}: trójkąty ${d.triangleCount}`);
    const [W, H] = AUTO3D_OUTLINES[t.outlineOf || id].sprite;
    const want = t.worldWidth ? t.worldWidth / W : getHullRenderSize(t.profile, W, H).w / W;
    assert.ok(Math.abs(h.scale - want) < 1e-12 && Math.abs(autoHullScale(id) - want) < 1e-12, `${id}: skala`);
    let vol = 0; let z0 = Infinity; let z1 = -Infinity; let x0 = Infinity; let x1 = -Infinity;
    for (let tr = 0; tr < d.index.length; tr += 3) {
      const [a, b, c] = [d.index[tr], d.index[tr + 1], d.index[tr + 2]].map((i) => [d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    for (let i = 0; i < d.position.length; i += 3) {
      x0 = Math.min(x0, d.position[i]); x1 = Math.max(x1, d.position[i]);
      z0 = Math.min(z0, d.position[i + 2]); z1 = Math.max(z1, d.position[i + 2]);
    }
    assert.ok(vol > 0, `${id}: objętość ${vol} — ściany odwrócone`);
    assert.ok(x0 > -W / 2 - 60 && x1 < W / 2 + 1, `${id}: poza płótnem`);
    assert.ok((z1 - z0) > (x1 - x0) * 0.05, `${id}: płaski (${(z1 - z0).toFixed(0)} px na ${(x1 - x0).toFixed(0)} px)`);
    let deck = 0;
    for (let v = 0; v < d.vertexCount; v++) {
      if (d.mat[v] !== SHIP3D_MAT.DECK) continue;
      deck++;
      assert.ok(Math.abs(d.uv[v * 2] - (d.position[v * 3] / W + 0.5)) < 1e-4, `${id}: uv`);
    }
    assert.ok(deck > 100, `${id}: pokład`);
    // Zapytania: środek kadłuba w obrysie, dach nad dnem.
    const cx = (x0 + x1) * 0.5 * h.scale;
    const cy = AUTO3D_OUTLINES[t.outlineOf || id].axisY * h.scale;
    if (h.contains(cx, cy)) assert.ok(h.heightAt(cx, cy) > h.bottomAt(cx, cy), `${id}: dach pod dnem`);
  }
});

test('dysze, gniazda, hangary, światła i mostki z danych gry', () => {
  for (const id of AUTO3D_IDS) {
    const t = AUTO3D_TABLE[id];
    const h = hulls[id];
    assert.equal(h.nozzles.length, autoHullNozzles(id).length, `${id}: dysze = dysze MAIN danych`);
    for (const n of h.nozzles) assert.deepEqual(n.dir, [-1, 0, 0]);
    const ed = t.editor ? SHIP_EDITOR_DEFAULTS.ships[t.editor] : null;
    assert.equal(h.mounts.length, ed?.hardpoints?.length || 0, `${id}: gniazda`);
    assert.equal(h.hangars.length, (ed?.hardpoints || []).filter((q) => q.type === 'hangar').length, `${id}: hangary`);
    assert.equal(h.lights.length, (ed?.lights?.position || []).length + (ed?.lights?.road || []).length, `${id}: światła`);
    if (t.bridge) {
      assert.equal(h.bridges.length, 1, `${id}: mostek`);
      assert.deepEqual(BRIDGE3D_KINDS[t.bridge].png, AUTO3D_OUTLINES[t.outlineOf || id].sprite, `${id}: mostek z innego sprite'a`);
    } else assert.equal(h.bridges.length, 0);
  }
});
