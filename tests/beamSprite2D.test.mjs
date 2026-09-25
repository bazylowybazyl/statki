import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { sampleSpriteLattice, buildSpriteBeamStructure } from '../src/game/beamSprite2D.js';
import { DestructorBeams3D as D, createBeamConfig, BEAM_TYPE } from '../src/game/destructorBeams3D.js';
import { cloneBeamStructure } from '../src/game/beamCrashScene3D.js';
import { buildSpriteSkinTopology, writeSpriteSkinGeometry, SPRITE_CORNERS } from '../src/3d/beamSpriteSkin2D.js';
import { BeamShips3D as R } from '../src/3d/beamShips3D.js';
import {
  applyPlanarFlightControls, planarHeading, setPlanarHeading, PLANAR_FLIGHT_DEFAULTS
} from '../src/game/beamFlightControls2D.js';
import { BeamWeapons3D } from '../src/game/beamWeapons3D.js';

// Obraz RGBA z prostokątów [x0, y0, x1, y1) w pikselach (y w dół jak w PNG).
function image(width, height, rects, rgb = [150, 160, 170]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const o = (y * width + x) * 4;
      data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

const plate = (cells = 40, rows = 16, world = 400) =>
  buildSpriteBeamStructure(image(cells * 4, rows * 4, [[0, 0, cells * 4, rows * 4]]),
    { worldLength: world, cellsAlong: cells, bulkheadEvery: 0 });

function planarConfig(cs, extra = {}) {
  const cfg = createBeamConfig(cs);
  cfg.planar = true;
  cfg.maxContacts = 384;
  Object.assign(cfg, extra);
  D.init(cfg);
  return cfg;
}

function assertPlanar(bodies) {
  for (const b of bodies) {
    assert.equal(b.pos.z, 0, `${b.name}: pos.z`);
    assert.equal(b.quat.x, 0, `${b.name}: quat.x`);
    assert.equal(b.quat.y, 0, `${b.name}: quat.y`);
    for (const n of b.nodes) if (n.active) assert.equal(n.z, 0, `${b.name}: węzeł poza płaszczyzną`);
  }
}

test('sprite lattice: dziób w prawo, górny wiersz obrazu to +Y, z = 0', () => {
  // Blok w prawym górnym rogu obrazu i szeroki pas u dołu.
  const img = image(40, 20, [[32, 0, 40, 4], [0, 12, 40, 20]]);
  const lattice = sampleSpriteLattice(img, { worldLength: 400, cellsAlong: 20 });
  assert.equal(lattice.nx, 20);
  assert.equal(lattice.ny, 10);
  assert.equal(lattice.nz, 1);
  assert.equal(lattice.cellSize, 20);
  // Blok 8 × 4 px = 4 × 2 komórki, pas 40 × 8 px = 20 × 4 komórki.
  assert.equal(lattice.cells.length, 8 + 20 * 4);
  const corner = lattice.cells.filter(c => c.iy >= 8);
  assert.equal(corner.length, 8);
  for (const c of corner) {
    assert.ok(c.x > 0 && c.y > 0, 'prawy górny róg obrazu = +X, +Y');
    assert.equal(c.z, 0);
  }
  for (const c of lattice.cells) assert.equal(lattice.solidMask[c.ix + c.iy * lattice.nx], 1);
  // Obrys = komórka z pustym sąsiadem; środek pasa (wiersze 1–2 z 4) nie jest obrysem.
  const inner = lattice.cells.find(c => c.iy === 1 && c.ix === 10);
  const edge = lattice.cells.find(c => c.iy === 0 && c.ix === 10);
  assert.equal(inner.surface, false);
  assert.equal(edge.surface, true);
  assert.ok(Math.abs(inner.r - 150 / 255) < 1e-6, 'kolor komórki z pikseli sprite\'a');
});

test('sprite lattice: próg pokrycia alfą i przezroczyste marginesy', () => {
  // Pas o grubości 1 piksela w komórce 4 × 4 px pokrywa 25% próbek.
  const thin = image(16, 8, [[0, 1, 16, 2]]);
  assert.equal(sampleSpriteLattice(thin, { cellsAlong: 4, samples: 4, minCoverage: 0.3 }).cells.length, 0);
  assert.equal(sampleSpriteLattice(thin, { cellsAlong: 4, samples: 4, minCoverage: 0.2 }).cells.length, 4);
  const faint = image(16, 8, [[0, 0, 16, 8]]);
  for (let i = 3; i < faint.data.length; i += 4) faint.data[i] = 30;
  assert.equal(sampleSpriteLattice(faint, { cellsAlong: 4, alphaCutoff: 40 }).cells.length, 0);
});

test('sprite structure: wręgi w poprzek kadłuba, grodzie i wyłączanie wręgów', () => {
  const img = image(160, 64, [[0, 0, 160, 64]]);
  const s = buildSpriteBeamStructure(img, { worldLength: 400, cellsAlong: 40, bulkheadEvery: 8 });
  assert.equal(s.planar, true);
  assert.ok(s.stats.frames > 0, 'są wręgi');
  assert.ok(s.stats.bulkheads > 0, 'są grodzie');
  for (const n of s.nodes) assert.equal(n.z, 0);
  const frames = s.beams.filter(b => b.type === BEAM_TYPE.FRAME);
  // Burta górna i dolna mają ten sam ix: wręg idzie w poprzek, od obrysu do obrysu —
  // także z narożników (bez ukośnych strut przez cały kadłub).
  const across = frames.filter(b => s.nodes[b.a].ix === s.nodes[b.b].ix);
  assert.ok(across.length > 0);
  assert.equal(across.length, frames.length, 'wszystkie wręgi w poprzek');
  for (const b of across) {
    assert.ok(s.nodes[b.a].surface && s.nodes[b.b].surface);
    assert.equal(Math.abs(s.nodes[b.a].iy - s.nodes[b.b].iy), 15, 'od burty do burty');
  }
  const bare = buildSpriteBeamStructure(img, { worldLength: 400, cellsAlong: 40, frameStride: 0, bulkheadEvery: 0 });
  assert.equal(bare.stats.frames, 0);
  assert.equal(bare.stats.bulkheads, 0);
  assert.deepEqual(Object.keys(s.spriteSkin).sort(),
    ['cellSize', 'height', 'image', 'key', 'nx', 'ny', 'pixelPitch', 'tint', 'width']);
});

test('tryb płaski: taran zostaje w płaszczyźnie, wraki niosą skórę sprite\'a', () => {
  const s = plate(40, 16, 400);
  planarConfig(s.cellSize, { crushStrength: 300000, globalBreakMul: 0.6 });
  const a = D.createBody(cloneBeamStructure(s), { name: 'a' });
  const b = D.createBody(cloneBeamStructure(s), { name: 'b', position: { x: 360, y: 0, z: 0 } });
  setPlanarHeading(b, Math.PI / 2);
  a.vel.x = 3000;
  const bodies = [a, b];
  for (let i = 0; i < 240; i++) {
    D.integrate(1 / 120, bodies);
    D.update(1 / 120, bodies);
  }
  assert.ok(D.perf.beamsBroken > 0, 'taran zrywa belki');
  const wrecks = bodies.filter(x => x.isWreck);
  assert.ok(wrecks.length > 0, 'płyty pękają na odłamy');
  for (const w of wrecks) assert.equal(w.spriteSkin, s.spriteSkin);
  assertPlanar(bodies);
  for (const x of bodies) {
    assert.equal(x.angVel.x, 0);
    assert.equal(x.angVel.y, 0);
    assert.ok(Number.isFinite(x.pos.x) && Number.isFinite(x.vel.x));
  }
});

// Czas, po którym prędkość zbliżania spada poniżej połowy — miara oporu zgniotu.
function halfStopTime(cells, strength) {
  const s = plate(cells, Math.round(cells * 0.4), 400);
  planarConfig(s.cellSize, { crushStrength: strength, globalBreakMul: 0.6 });
  const a = D.createBody(cloneBeamStructure(s), {});
  const b = D.createBody(cloneBeamStructure(s), { position: { x: 330, y: 0, z: 0 } });
  setPlanarHeading(b, Math.PI / 2);
  a.vel.x = 900;
  const bodies = [a, b];
  let touched = -1;
  for (let i = 0; i < 1200; i++) {
    D.integrate(1 / 120, bodies);
    D.update(1 / 120, bodies);
    if (touched < 0 && D.perf.contacts > 0) touched = i;
    if (touched >= 0 && a.vel.x - b.vel.x < 450) return (i - touched) / 120;
  }
  return Infinity;
}

test('granica zgniotu: opór zależy od frontu styku, nie od gęstości siatki', () => {
  const coarse = halfStopTime(24, 300000);
  const fine = halfStopTime(48, 300000);
  assert.ok(Number.isFinite(coarse) && Number.isFinite(fine));
  assert.ok(Math.max(coarse, fine) / Math.min(coarse, fine) < 1.6,
    `czas hamowania zależy od siatki: ${coarse.toFixed(2)} s vs ${fine.toFixed(2)} s`);
  // Mocniejsza stal hamuje szybciej.
  assert.ok(halfStopTime(24, 1200000) < coarse);
});

test('skóra sprite\'a: ciągła w całej płycie, szew otwiera zerwana belka, martwy węzeł znika', () => {
  const s = plate(8, 4, 80);
  planarConfig(s.cellSize);
  const body = D.createBody(cloneBeamStructure(s), {});
  const topo = buildSpriteSkinTopology(body);
  const positions = new Float32Array(topo.count * 12), colors = new Float32Array(topo.count * 12);
  const corner = (node, k) => {
    const o = body.nodes.indexOf(node) * 12 + k * 3;
    return [positions[o], positions[o + 1]];
  };
  const at = (ix, iy) => body.nodes.find(n => n.ix === ix && n.iy === iy);
  const left = at(3, 1), right = at(4, 1);
  // Dent wspólny dla obu komórek: narożniki zostają zszyte.
  left.x += 3; right.x += 3;
  assert.equal(writeSpriteSkinGeometry(body, topo, positions, colors), topo.count);
  assert.deepEqual(corner(left, 1), corner(right, 0));
  assert.deepEqual(corner(left, 2), corner(right, 3));

  // UV: lewy górny narożnik lewej górnej komórki = lewy górny róg obrazu.
  const topLeft = at(0, 3);
  const uv = topo.uvs.subarray(body.nodes.indexOf(topLeft) * 8 + 6, body.nodes.indexOf(topLeft) * 8 + 8);
  assert.deepEqual(Array.from(uv), [0, 1]);
  assert.deepEqual(SPRITE_CORNERS[3], [-1, 1]);

  // Zerwana belka między komórkami: szew się rozchodzi.
  const beam = body.beams.find(b => (body.nodes[b.a] === left && body.nodes[b.b] === right) ||
    (body.nodes[b.a] === right && body.nodes[b.b] === left));
  beam.broken = true;
  right.x += 6;
  writeSpriteSkinGeometry(body, topo, positions, colors);
  assert.ok(Math.abs(corner(left, 1)[0] - corner(right, 0)[0]) > 1, 'szew otwarty');
  assert.ok(colors[body.nodes.indexOf(left) * 12 + 3] < 1, 'brzeg rozdarcia ciemnieje');

  // Martwy węzeł: czworokąt zwinięty do punktu.
  D.destroyNode(body, left);
  assert.equal(writeSpriteSkinGeometry(body, topo, positions, colors), topo.count - 1);
  const [x0, y0] = corner(left, 0);
  for (let k = 1; k < 4; k++) assert.deepEqual(corner(left, k), [x0, y0]);
});

test('renderer: kadłub ze sprite\'a ma skórę bez podglądu belek, wrak dostaje własną, sprzątanie', () => {
  const s = plate(20, 8, 200);
  s.spriteSkin.tint = [1, 0.5, 0.5];
  planarConfig(s.cellSize);
  const body = D.createBody(cloneBeamStructure(s), {});
  const bodies = [body];
  const scene = new THREE.Scene();
  R.init(scene);
  const camera = new THREE.OrthographicCamera();
  try {
    R.sync(bodies, camera, 0);
    const data = R.bodyData.get(body);
    assert.ok(data.sprite, 'skóra sprite\'a');
    assert.equal(data.beamLines, null, 'belki tylko w podglądzie');
    assert.equal(data.nodeMesh, null);
    assert.equal(data.sprite.mesh.geometry.attributes.position.count, body.nodes.length * 4);
    assert.equal(data.sprite.mesh.material.color.g, 0.5, 'odcień kukły');
    assert.equal(data.sprite.mesh.material.depthTest, false);
    assert.equal(R.stats.skinTriangles, body.nodes.length * 2);

    // Przecięcie w połowie: rodzic i wrak rysują własne czworokąty.
    for (const beam of body.beams) {
      if ((body.nodes[beam.a].ox > 0) !== (body.nodes[beam.b].ox > 0)) beam.broken = true;
    }
    body.structureDirty = true;
    D.splitQueue.push(body);
    D.processSplits(bodies);
    assert.equal(bodies.length, 2);
    R.sync(bodies, camera, 0);
    const wreckData = R.bodyData.get(bodies[1]);
    assert.ok(wreckData.sprite);
    assert.equal(R.bodyData.get(body).sprite.mesh.geometry.attributes.position.count, body.nodes.length * 4);
    assert.equal(wreckData.sprite.mesh.geometry.attributes.position.count, bodies[1].nodes.length * 4);

    R.beamsEnabled = true;
    R.sync(bodies, camera, 0);
    assert.equal(R.bodyData.get(body).beamLines.material.depthTest, false, 'podgląd belek nad sprite\'em');
  } finally {
    R.beamsEnabled = false;
    R.sync([], camera, 0);
    assert.equal(scene.children.filter(o => o.isMesh && o.material?.map).length, 0);
    R.disposeSpriteSkin(s.spriteSkin);
    R.debris.dispose(R.scene);
    R.debris = null;
  }
});

test('sterowanie 2D: ciąg wzdłuż dziobu, A obraca w lewo, hamulec, kurs z kwaternionu', () => {
  const s = plate(10, 4, 100);
  planarConfig(s.cellSize);
  const body = D.createBody(cloneBeamStructure(s), {});
  setPlanarHeading(body, Math.PI / 2);
  assert.ok(Math.abs(planarHeading(body.quat) - Math.PI / 2) < 1e-12);
  const input = { throttle: 1, turn: 1, strafe: 0, boost: false, brake: false };
  for (let i = 0; i < 120; i++) applyPlanarFlightControls(body, input, 1 / 120);
  assert.ok(body.vel.y > 400 && Math.abs(body.vel.x) < 1e-9, 'dziób +Y');
  assert.ok(body.angVel.z > 0, 'A = przeciwnie do wskazówek zegara');
  assert.ok(body.angVel.z <= PLANAR_FLIGHT_DEFAULTS.turnRate + 1e-12);
  const speed = Math.hypot(body.vel.x, body.vel.y);
  applyPlanarFlightControls(body, { ...input, throttle: 0, turn: 0, brake: true }, 1 / 120);
  assert.ok(Math.hypot(body.vel.x, body.vel.y) < speed);
  // Bez stabilizacji puszczony ster nie gasi obrotu od zderzenia.
  body.angVel.z = 0.3;
  applyPlanarFlightControls(body, { throttle: 0, turn: 0, strafe: 0 }, 1 / 120, PLANAR_FLIGHT_DEFAULTS, false);
  assert.equal(body.angVel.z, 0.3);
});

test('broń na kadłubie 2D: lufy rozstawione wzdłuż lokalnego Y, pociski w płaszczyźnie', () => {
  const s = plate(20, 8, 200);
  planarConfig(s.cellSize);
  const ship = D.createBody(cloneBeamStructure(s), {});
  setPlanarHeading(ship, 0.4);
  D._refreshRot(ship);
  const weapons = new BeamWeapons3D(D, 8, { laserSpeed: 3000, convergence: 1500, sideAxis: 1 });
  assert.ok(weapons.fire(0, ship, 450, 3));
  assert.ok(weapons.fire(0, ship, 450, 3));
  const [p1, p2] = weapons.projectiles;
  for (const p of [p1, p2]) {
    assert.equal(p.z, 0);
    assert.equal(p.vz, 0);
    assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - 3000) < 1e-6);
  }
  const lateral = (p) => -Math.sin(0.4) * (p.x - ship.pos.x) + Math.cos(0.4) * (p.y - ship.pos.y);
  assert.ok(lateral(p1) * lateral(p2) < 0, 'lufy po obu burtach');
});
