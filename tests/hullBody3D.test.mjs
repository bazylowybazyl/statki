// Bryła kadłuba 3D pod wierzchem z kreatora (src/3d/hullBody3D/, docs/OPIS-miasto-3d.md § 11): obrys z pola kreatora,
// geometria pod płaszczyzną i w sylwetce (z góry zasłania ją skóra kadłuba), spód w dół, światła w rowie, powtarzalność;
// materiał (materiał modeli floty) buduje WGSL w Node; moduł nie czyta window / DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { buildHullField } from '../src/game/hullDesign/hullDesignGeometry.js';
import { hullDesignPreset } from '../src/game/hullDesign/hullDesignPresets.js';
import { buildHullBodyGeometry, hullBodyLoopsFromField, hullBodyOutline, HULL_BODY_TUNE } from '../src/3d/hullBody3D/hullBodyGeometry.js';
import { createHullBody3D } from '../src/3d/hullBody3D/hullBody3D.js';
import { pointInPoly, SHIP3D_MAT } from '../src/3d/ships3d/meshBuilder3D.js';

const field = buildHullField(hullDesignPreset('dreadnought'), { pipes: false });

test('bryła: obrys ramy drednota z izolinii pola poziomu 0 — jedna zamknięta łamana na całym kadłubie', () => {
  const loops = hullBodyLoopsFromField(field);
  assert.equal(loops.length, 1);
  assert.ok(loops[0].length > 40 && loops[0].length < 600, `wierzchołki ${loops[0].length}`);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of loops[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  // drednot 8 000 × 3 816 j. (krok 4 j.)
  assert.ok(Math.abs(x1 - x0 - 8000) < 16 && Math.abs(y1 - y0 - 3816) < 16, `pudło ${x1 - x0} × ${y1 - y0}`);
});

test('bryła: pod płaszczyzną i w sylwetce, spód w dół, światła w rowie, wynik powtarzalny', () => {
  const loops = hullBodyLoopsFromField(field);
  const g = buildHullBodyGeometry(loops);
  const poly = hullBodyOutline(loops);
  assert.ok(g.triangleCount > 10000 && g.triangleCount < 120000, `trójkąty ${g.triangleCount}`);
  assert.ok(g.stats.lights > 100, `światła ${g.stats.lights}`);
  assert.ok(g.stats.depth > 300 && g.stats.depth <= HULL_BODY_TUNE.bottom.depth, `głębokość ${g.stats.depth}`);
  let outside = 0, above = 0, lights = 0, down = 0, bottom = 0;
  for (let i = 0; i < g.vertexCount; i++) {
    const x = g.position[i * 3], y = g.position[i * 3 + 1], z = g.position[i * 3 + 2];
    if (z > 1e-4) above++;
    if (z < -0.5 && !pointInPoly(x, y, poly)) outside++;
    const m = g.mat[i];
    if (m === SHIP3D_MAT.E_WINDOW || m === SHIP3D_MAT.E_ICE) {
      lights++;
      // w rowie: między sufitem a dolną wargą (z ∈ (−62; −38) × skala)
      assert.ok(z < -38 * g.stats.scale && z > -62 * g.stats.scale, `światło na z ${z}`);
    }
    if (z <= HULL_BODY_TUNE.bottom.zFlat * g.stats.scale + 1e-3 && g.normal[i * 3 + 2] < -0.5) bottom++;
    if (g.normal[i * 3 + 2] < -0.5) down++;
  }
  assert.equal(above, 0, 'nic nad płaszczyzną wierzchu');
  assert.equal(outside, 0, 'nic poza sylwetką (z góry zasłania skóra kadłuba)');
  assert.ok(lights >= g.stats.lights * 4);
  assert.ok(bottom > g.stats.bottomCells, 'spód z siatki wysokości skierowany w dół');
  assert.ok(down > 0);
  const g2 = buildHullBodyGeometry(loops);
  assert.deepEqual(Array.from(g2.position.subarray(0, 600)), Array.from(g.position.subarray(0, 600)));
  assert.equal(g2.triangleCount, g.triangleCount);
});

test('bryła: wierzch jako płytki dach — z ≤ 0, krawędź o spadek niżej, cokoły pod modelami gry, uv w obrazie', () => {
  const loops = hullBodyLoopsFromField(field);
  const pins = [{ x: -1900, y: 0, r: 75 }];
  const g = buildHullBodyGeometry(loops, { top: { drop: 225, pins, image: field.image } });
  const flat = buildHullBodyGeometry(loops, { top: { drop: 0, image: field.image } });
  assert.equal(g.stats.drop, 225);
  assert.ok(g.stats.topCells > 5000, `komórki wierzchu ${g.stats.topCells}`);
  assert.ok(g.triangleCount > flat.triangleCount * 0.9 && g.topGrid && g.topGrid.nx > 100);
  let maxZ = -Infinity, deckOut = 0, deck = 0;
  for (let i = 0; i < g.vertexCount; i++) {
    const z = g.position[i * 3 + 2];
    if (z > maxZ) maxZ = z;
    if (g.mat[i] === SHIP3D_MAT.DECK) {
      deck++;
      const u = g.uv[i * 2], v = g.uv[i * 2 + 1];
      if (u < 0 || u > 1 || v < 0 || v > 1) deckOut++;
    }
  }
  assert.ok(maxZ <= HULL_BODY_TUNE.top.lift + 1e-4, `wierzch nie wyżej niż skóra (${maxZ})`);
  assert.ok(deck > 10000 && deckOut === 0, `uv pokładu w obrazie (${deckOut} / ${deck})`);
  // wysokość wierzchu: przy osi w szerokim miejscu plateau 0, pod mostkiem cokół 0, przy burcie −spadek
  const G = g.topGrid;
  const at = (x, y) => G.data[Math.round((y - G.y0) / G.cell) * G.nx + Math.round((x - G.x0) / G.cell)];
  assert.ok(Math.abs(at(-1000, 0)) < 1, `plateau ${at(-1000, 0)}`);
  assert.ok(Math.abs(at(-1900, 0)) < 1, `cokół mostka ${at(-1900, 0)}`);
  assert.ok(at(3000, 0) < -100, `dziób niżej ${at(3000, 0)}`);
  assert.ok(Math.abs(flat.stats.drop) === 0 && flat.topGrid.data.every((v) => Math.abs(v) < 1e-6), 'spadek 0 — płasko');
});

test('bryła: materiał modeli floty z wypełnieniem buduje WGSL w Node; moduł nie czyta window / DOM', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  const body = createHullBody3D({ scene: new THREE.Scene() });
  body.setFromField(field);
  body.setPose(0, 0, 0);
  body.setSun(-60000, -40000);
  body.update(1);
  assert.ok(body.built && body.group.visible);
  const [mesh] = body.warmupMeshes();
  for (const name of ['position', 'normal', 'uv', 'aMat']) assert.ok(mesh.geometry.getAttribute(name), name);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material; b.scene = new THREE.Scene(); b.camera = new THREE.PerspectiveCamera(); b.context.material = mesh.material;
  b.build();
  assert.match(b.fragmentShader, /fn main/);
  for (const f of ['src/3d/hullBody3D/hullBody3D.js', 'src/3d/hullBody3D/hullBodyGeometry.js']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /\bwindow\.|\bdocument\.|from '\.\.\/\.\.\/game\//, f);
  }
});
