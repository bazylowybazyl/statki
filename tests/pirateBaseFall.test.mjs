// Upadek habitatu bazy piratów na planetoidę (src/game/story/pirateBaseFall.js, 2026-10-19): teren skały w silniku belek
// leży tam, gdzie rysuje się skała (te same wierzchołki siatki co render), studnia grawitacji (punkt, 1/r² albo stała),
// wrak dziedziczy studnię rodzica, bryła spadająca na teren-kulę osiada na powierzchni bez przebicia. Pełna sekwencja
// upadku (wieża pierwsza, dysk za nią, wszystko zamarza na skale) — scripts/destrukcja-taran-sym.mjs --tryb upadek.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { DestructorBeams3D as D, createBeamConfig } from '../src/game/destructorBeams3D.js';
import { buildBeamStructure } from '../src/game/beamBody3D.js';
import { voxelizeTriangles, makeBoxTriangles } from '../src/game/voxelBody3D.js';
import { HULL_BODY_CONFIG as C } from '../src/game/hullBodies.js';
import {
  PIRATE_ROCK_SHAPE, PIRATE_FALL_TUNE, createPirateRockTerrain, decodeRockShape, fallKindOf
} from '../src/game/story/pirateBaseFall.js';
import { createPirateRockLayout } from '../src/3d/portBuildings/pirateRockLayout.js';
import { createPirateBaseLayout } from '../src/3d/portBuildings/pirateBaseLayout.js';
import { placePirateBase } from '../src/game/story/pirateBaseSite.js';
import { SMALL_BODY_MAPS, SMALL_BODY_SHAPE_RANGE } from '../src/3d/planetMaps.js';
import { SMALL_BODY_SEGMENTS, decodeSmallBodyShape, displaceSmallBodyGeometry } from '../src/3d/smallBodyShape.js';

function gameConfig() {
  const cfg = createBeamConfig(15);
  Object.assign(cfg, { planar: true, localSolver: true, activeMotionThreshold: 6, activeSettleFrames: 4,
    crushStrength: C.crushStrength, contactV2: true, pinYieldMul: C.pinYieldMul, pinBreakCells: C.pinBreakCells,
    crushTravelMul: C.crushTravelMul, friction: C.friction, globalBreakMul: C.globalBreakMul, maxContacts: C.maxContacts,
    solidFriction: C.solidFriction, solidNodeDamping: C.solidNodeDamping, solidActiveCells: C.solidActiveCells,
    crushRestSpeed3D: C.crushRestSpeed3D });
  D.init(cfg);
  D.splitQueue.length = 0;
  D.terrains.length = 0;
  return cfg;
}

function solidStructure(tris, cell) {
  const vox = voxelizeTriangles(tris, null, { cellSize: cell, interiorMode: 'full', shellLayers: 1, ribStep: 3 });
  return buildBeamStructure(vox, { bulkheadEvery: 0 });
}

function body(structure, opts, density = 1) {
  const nodes = structure.nodeStore.count, cs = structure.cellSize;
  return D.createBody(structure, { planar: false, ...opts, massMultiplier: (density * cs * cs * nodes) / structure.mass });
}

// Syntetyczna mapa kształtu (bajty RGBA jak z getImageData; 16 bitów w R / G) — gładka, ±zakres mapy skały.
function syntheticShapeRgba(w, h, range) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = (x + 0.5) / w, v = (y + 0.5) / h;
    const d = 0.6 * range[1] * Math.sin(u * Math.PI * 6) * Math.sin(v * Math.PI) + 0.3 * range[0] * Math.cos(v * Math.PI * 5);
    const q = Math.round((d - range[0]) / (range[1] - range[0]) * 65535);
    const i = (y * w + x) * 4;
    rgba[i] = q >> 8; rgba[i + 1] = q & 255; rgba[i + 2] = 0; rgba[i + 3] = 255;
  }
  return rgba;
}

test('mapa kształtu terenu = mapa renderu planetoidy (plik, zakres, siatka, dekodowanie)', () => {
  const maps = SMALL_BODY_MAPS.hidalgo;
  assert.ok(maps && maps.shape, 'mapa kształtu Hidalgo w planetMaps.js');
  assert.equal(PIRATE_ROCK_SHAPE.url, maps.shape);
  assert.deepEqual([...PIRATE_ROCK_SHAPE.range], [...SMALL_BODY_SHAPE_RANGE.hidalgo]);
  assert.equal(PIRATE_ROCK_SHAPE.segW, SMALL_BODY_SEGMENTS.w);
  assert.equal(PIRATE_ROCK_SHAPE.segH, SMALL_BODY_SEGMENTS.h);
  const w = 40, h = 20, range = PIRATE_ROCK_SHAPE.range;
  const rgba = syntheticShapeRgba(w, h, range);
  const a = decodeRockShape(rgba, w, h, range), b = decodeSmallBodyShape(rgba, w, h, range);
  assert.equal(a.w, b.w);
  assert.equal(a.h, b.h);
  assert.ok(Math.abs(a.poleN - b.poleN) < 1e-9 && Math.abs(a.poleS - b.poleS) < 1e-9);
  for (let i = 0; i < w * h; i++) assert.ok(Math.abs(a.d[i] - b.d[i]) < 1e-9);
});

test('powierzchnia zderzeń skały leży w wierzchołkach siatki renderu (meshQuat, środek, skala R)', () => {
  const rock = createPirateRockLayout();
  const layout = createPirateBaseLayout();
  const place = placePirateBase({ x: 7.5e6, y: -3.2e6 }, 0.7, layout);
  const W = SMALL_BODY_SEGMENTS.w, H = SMALL_BODY_SEGMENTS.h, range = PIRATE_ROCK_SHAPE.range;
  const shape = decodeSmallBodyShape(syntheticShapeRgba(96, 48, range), 96, 48, range);
  const geo = new THREE.SphereGeometry(1, W, H);
  displaceSmallBodyGeometry(geo, shape);
  const T = createPirateRockTerrain(rock, place, shape);
  const q = new THREE.Quaternion(rock.meshQuat[0], rock.meshQuat[1], rock.meshQuat[2], rock.meshQuat[3]);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const g = {};
  let worst = 0, n = 0;
  for (let i = 0; i < pos.count; i += 7) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).multiplyScalar(rock.R).applyQuaternion(q);
    const bx = v.x + rock.center[0], bh = v.y + rock.center[1], bz = v.z + rock.center[2];
    place.toGame(bx, bz, g);
    // świat silnika: X = x gry, Y = −y gry, Z = wysokość (h bazy)
    const ex = g.x - T.cx, ey = -g.y - T.cy, ez = bh - T.cz;
    const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
    const r = T.radius(ex / d, ey / d, ez / d);
    worst = Math.max(worst, Math.abs(r - d));
    n++;
  }
  assert.ok(n > 500);
  // przy R 16 km — ułamek jednostki (precyzja float32 pozycji siatki)
  assert.ok(worst < 0.05, `największa różnica promienia ${worst.toFixed(4)} j.`);
  // normalna jednostkowa, na zewnątrz (iloczyn z promieniem > 0), na skale z rzeźbą nie zawsze promieniowa
  const out = { x: 0, y: 0, z: 0 };
  let tilted = 0;
  for (let k = 0; k < 200; k++) {
    const th = Math.acos(1 - 2 * ((k + 0.5) / 200)), ph = k * 2.399963;
    const ux = Math.sin(th) * Math.cos(ph), uy = Math.sin(th) * Math.sin(ph), uz = Math.cos(th);
    T.normal(ux, uy, uz, T.radius(ux, uy, uz), out);
    const l = Math.hypot(out.x, out.y, out.z);
    assert.ok(Math.abs(l - 1) < 1e-9);
    const dot = out.x * ux + out.y * uy + out.z * uz;
    assert.ok(dot > 0.7, `normalna na zewnątrz (${dot.toFixed(3)})`);
    if (dot < 0.9999) tilted++;
  }
  assert.ok(tilted > 50, 'rzeźba skały pochyla normalną');
  // wysokość powierzchni z góry: punkt (x, y) nad środkiem skały — szczyt w promieniu terenu
  const top = T.surfaceZAt(T.cx, -T.cy);
  assert.ok(Math.abs(top - (T.cz + T.radius(0, 0, 1))) < 1);
});

test('studnia grawitacji: przyspieszenie ku punktowi, stałe (r0 = 0) albo ∝ 1/r² (r0 > 0)', () => {
  gameConfig();
  const dt = 1 / 60;
  const s = solidStructure(makeBoxTriangles(90, 90, 90), 30);
  const a = body(s, { gravityWell: { x: 0, y: 0, z: -10000, g: 300, r0: 0 } });
  a.pos.z = 0;
  D.integrate(dt, [a]);
  // (silnik dokłada tłumienie liniowe ciała — ułamek promila na krok)
  assert.ok(Math.abs(a.vel.z + 300 * dt) < 0.01 * 300 * dt, `stała: vz ${a.vel.z}`);
  assert.ok(Math.abs(a.vel.x) < 1e-9 && Math.abs(a.vel.y) < 1e-9);
  const b = body(s, { gravityWell: { x: 4000, y: 0, z: 0, g: 300, r0: 2000 } });
  D.integrate(dt, [b]);
  // r = 4000: g · r0² / r² = 300 · 0,25 = 75
  assert.ok(Math.abs(b.vel.x - 75 * dt) < 0.01 * 75 * dt, `1/r²: vx ${b.vel.x}`);
  // studnia wypiera zwykłą grawitację ciała (pierwszeństwo)
  const c = body(s, { gravity: { x: 0, y: 0, z: -1000 }, gravityWell: { x: 0, y: 5000, z: 0, g: 100, r0: 0 } });
  D.integrate(dt, [c]);
  assert.ok(Math.abs(c.vel.z) < 1e-9 && c.vel.y > 0);
});

test('wrak z rozpadu bryły dziedziczy studnię rodzica', () => {
  gameConfig();
  // dwie rozłączne kostki w jednej strukturze — rozpad daje drugi wrak
  const tris = [...makeBoxTriangles(90, 90, 90, -200, 0, 0), ...makeBoxTriangles(90, 90, 90, 200, 0, 0)];
  const s = solidStructure(tris, 30);
  const well = { x: 0, y: 0, z: -20000, g: 260, r0: 0 };
  const b = body(s, { gravityWell: well });
  const bodies = [b];
  b.structureDirty = true;
  D.splitQueue.push(b);
  D.processSplits(bodies);
  const wrecks = bodies.filter((w) => w !== b && !w.dead);
  assert.ok(wrecks.length >= 1, 'rozpad na dwa ciała');
  for (const w of wrecks) assert.equal(w.gravityWell, well);
});

test('bryła spada na teren-kulę i osiada na powierzchni (bez przebicia), styk woła onContact', () => {
  gameConfig();
  const R = 3000, cz = -R;
  const contacts = { n: 0, damage: 0, maxApproach: 0 };
  const T = {
    name: 'kula testowa', cx: 0, cy: 0, cz, R, rMax: R + 1,
    friction: PIRATE_FALL_TUNE.rockFriction, armorMul: PIRATE_FALL_TUNE.rockArmorMul, restAngDamp: PIRATE_FALL_TUNE.rockRestAngDamp,
    radius: () => R,
    normal: (ex, ey, ez, r, out) => { out.x = ex; out.y = ey; out.z = ez; return out; },
    onContact: (b, info) => {
      contacts.n++;
      if (info.doDamage) contacts.damage++;
      contacts.maxApproach = Math.max(contacts.maxApproach, info.approach);
    }
  };
  D.addTerrain(T);
  const s = solidStructure(makeBoxTriangles(120, 120, 120), 30);
  const b = body(s, { position: { x: 0, y: 0, z: 400 }, gravityWell: { x: 0, y: 0, z: cz, g: 300, r0: 0 } });
  const dt = 1 / 60, cell = 30;
  let minGap = Infinity;
  const gap = () => {
    // najniższy węzeł względem powierzchni kuli
    const sNodes = b.nodeStore, q = b.quat;
    let worst = Infinity;
    for (let i = 0; i < sNodes.count; i++) {
      if (!sNodes.active[i]) continue;
      const x = sNodes.x[i], y = sNodes.y[i], z = sNodes.z[i];
      // obrót q (świat ← ciało)
      const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
      const wx = b.pos.x + x + q.w * tx + (q.y * tz - q.z * ty);
      const wy = b.pos.y + y + q.w * ty + (q.z * tx - q.x * tz);
      const wz = b.pos.z + z + q.w * tz + (q.x * ty - q.y * tx);
      const d = Math.sqrt(wx * wx + wy * wy + (wz - cz) * (wz - cz)) - R;
      if (d < worst) worst = d;
    }
    return worst;
  };
  for (let k = 0; k < 60 * 5; k++) {
    D.integrate(dt, [b]);
    D.update(dt, [b]);
    minGap = Math.min(minGap, gap());
  }
  D.removeTerrain(T);
  assert.ok(contacts.damage > 0, 'styk ze skałą');
  assert.ok(contacts.maxApproach > 200, `uderzenie z prędkością spadku (${contacts.maxApproach.toFixed(0)} j/s)`);
  assert.ok(minGap > -2 * cell, `przebicie terenu: ${minGap.toFixed(1)} j.`);
  const v = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
  assert.ok(v < 20, `osiadła (v ${v.toFixed(1)} j/s)`);
  const g = gap();
  assert.ok(g > -cell && g < cell * 2, `leży na powierzchni (najniższy węzeł ${g.toFixed(1)} j.)`);
});

test('rodzaj bryły upadku z kawałka (wieża, dysk, bęben, szyb, drobnica)', () => {
  const mk = (kind, n, extra = {}) => ({ activeNodes: n, hull: { world: { kind, ...extra } } });
  assert.equal(fallKindOf(mk('tech', 5000)), 'tower');
  assert.equal(fallKindOf(mk('disc', 3000)), 'disc');
  assert.equal(fallKindOf(mk('drum', 2000)), 'drum');
  assert.equal(fallKindOf(mk('core', 2000)), 'core');
  assert.equal(fallKindOf(mk('drum', 100)), 'debris');
  assert.equal(fallKindOf({ activeNodes: 10, hull: null }), 'debris');
});
