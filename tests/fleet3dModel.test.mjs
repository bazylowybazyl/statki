// Modele 3D kadłubów floty (src/3d/ships3d/ships/fleetHull3D.js — Terra Nova i piraci) i rejestr
// modeli okrętów (ships3D.js). Bez GPU: geometria, skala = kadłub gry, gniazda = markery edytora,
// obrysy zgodne ze sprite'ami i specyfikacją, WGSL materiału z paletą frakcji w Node.
// node --test tests/fleet3dModel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { buildFleetHull3D, FLEET3D_IDS, FLEET3D_SPECS, fleetHullScale } from '../src/3d/ships3d/ships/fleetHull3D.js';
import { FLEET3D_OUTLINES } from '../src/3d/ships3d/ships/fleetOutlines3D.js';
import { FLEET3D_PALETTES, FLEET3D_WEAPON_PALETTES, fleetClipKey } from '../src/3d/ships3d/ships/fleetHulls3D.js';
import { SHIP3D_MODELS, SHIP3D_IDS, buildShip3D } from '../src/3d/ships3d/ships/ships3D.js';
import { createShipMaterial } from '../src/3d/ships3d/shipMaterials3D.tsl.js';
import { SHIP3D_MAT, SHIP3D_MAT_COUNT } from '../src/3d/ships3d/meshBuilder3D.js';
import { SHIP_EDITOR_DEFAULTS } from '../src/data/hardpointEditorDefaults.js';
import { getHullRenderSize, HULL_RENDER_PROFILES } from '../src/data/ships.js';
import { BRIDGE3D_KINDS } from '../src/3d/bridge3DShapes.js';

const hulls = Object.fromEntries(FLEET3D_IDS.map((id) => [id, buildFleetHull3D(id)]));

function checkArrays(d, label) {
  for (let i = 0; i < d.position.length; i++) assert.ok(Number.isFinite(d.position[i]), `${label}: pozycja NaN (${i})`);
  for (let i = 0; i < d.normal.length; i += 3) {
    const l = Math.hypot(d.normal[i], d.normal[i + 1], d.normal[i + 2]);
    assert.ok(Math.abs(l - 1) < 1e-3, `${label}: normalna nie jednostkowa (${i / 3}: ${l})`);
  }
  for (const m of d.mat) assert.ok(m >= 0 && m < SHIP3D_MAT_COUNT && Number.isInteger(m), `${label}: materiał poza paletą ${m}`);
  for (const i of d.index) assert.ok(i < d.vertexCount, `${label}: indeks poza zakresem`);
}

test('rejestr: Atlas i kadłuby floty, wspólny kształt wyniku buildShip3D', () => {
  for (const id of ['atlas', 'pirate_battleship', 'pirate_destroyer', 'pirate_frigate', 'terran_battleship', 'terran_destroyer', 'terran_frigate', 'corvus']) {
    assert.ok(SHIP3D_IDS.includes(id), `${id}: brak w rejestrze`);
  }
  for (const id of ['atlas', ...FLEET3D_IDS]) {
    assert.ok(HULL_RENDER_PROFILES[id], `${id}: brak profilu renderu kadłuba`);
    const h = id === 'atlas' ? buildShip3D('atlas') : hulls[id];
    for (const k of ['id', 'label', 'faction', 'tier', 'sprite', 'scale', 'deckZ', 'builder', 'mounts', 'nozzles', 'rcs', 'hangars', 'lights', 'bridges', 'heightAt', 'bottomAt', 'contains']) {
      assert.ok(h[k] !== undefined, `${id}: brak pola ${k}`);
    }
    assert.equal(h.id, id);
    assert.equal(h.faction, SHIP3D_MODELS[id].faction);
  }
});

test('obrysy: zgodne z rozmiarem sprite\'ów (PNG), bryły przycięte aktualne względem specyfikacji', () => {
  for (const id of FLEET3D_IDS) {
    const spec = FLEET3D_SPECS[id];
    const png = readFileSync(new URL(`../${spec.sprite}`, import.meta.url));
    const W = png.readUInt32BE(16); const H = png.readUInt32BE(20);
    const outl = FLEET3D_OUTLINES[spec.outlineOf || id];
    assert.deepEqual(outl.sprite, [W, H], `${id}: sprite ${W}×${H} ≠ obrys — uruchom node scripts/webgpu/obrysy-floty.mjs`);
    const ax = spec.axisY || 0;
    for (const b of spec.blocks.filter((q) => q.clip)) {
      const list = b.mirror ? [b.poly, b.poly.map(([x, y]) => [x, 2 * ax - y]).reverse()] : [b.poly];
      for (const p of list) {
        const rec = outl.blocks.find((r) => r.key === fleetClipKey(p));
        assert.ok(rec && rec.parts.length > 0, `${id}: bryła „${b.name}” bez przyciętego konturu — uruchom generator obrysów`);
      }
    }
  }
});

test('kadłuby: geometria poprawna, skala = kadłub gry (getHullRenderSize), bryła 3D', () => {
  for (const id of FLEET3D_IDS) {
    const h = hulls[id];
    const d = h.builder.build();
    checkArrays(d, id);
    assert.ok(d.triangleCount > 2000 && d.triangleCount < 80000, `${id}: trójkąty ${d.triangleCount}`);
    const [W, H] = FLEET3D_OUTLINES[FLEET3D_SPECS[id].outlineOf || id].sprite;
    const size = getHullRenderSize(FLEET3D_SPECS[id].profile, W, H);
    assert.ok(Math.abs(h.scale * W - size.w) < 1e-6, `${id}: skala modelu ≠ skala renderu kadłuba`);
    assert.ok(Math.abs(fleetHullScale(id) - h.scale) < 1e-12);
    let x0 = Infinity; let x1 = -Infinity; let y0 = Infinity; let y1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (let i = 0; i < d.position.length; i += 3) {
      x0 = Math.min(x0, d.position[i]); x1 = Math.max(x1, d.position[i]);
      y0 = Math.min(y0, d.position[i + 1]); y1 = Math.max(y1, d.position[i + 1]);
      z0 = Math.min(z0, d.position[i + 2]); z1 = Math.max(z1, d.position[i + 2]);
    }
    // Model mieści się w płótnie sprite'a (dysze wystają najwyżej o kilka px za rufę).
    assert.ok(x0 > -W / 2 - 12 && x1 < W / 2 + 1, `${id}: x ${x0}..${x1} poza płótnem ${W}`);
    assert.ok(y0 > -H / 2 - 1 && y1 < H / 2 + 1, `${id}: y ${y0}..${y1} poza płótnem ${H}`);
    const len = x1 - x0;
    assert.ok((z1 - z0) > len * 0.12, `${id}: za płaski (${(z1 - z0).toFixed(0)} px na ${len.toFixed(0)} px długości)`);
    // Objętość ze ścian dodatnia — ściany na zewnątrz.
    let vol = 0;
    for (let t = 0; t < d.index.length; t += 3) {
      const [a, b, c] = [d.index[t], d.index[t + 1], d.index[t + 2]].map((i) => [d.position[i * 3], d.position[i * 3 + 1], d.position[i * 3 + 2]]);
      vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
    assert.ok(vol > 0, `${id}: objętość ${vol} — ściany odwrócone`);
  }
});

test('pokład: dachy mają materiał DECK z uv rzutu sprite\'a z góry w [0, 1]', () => {
  for (const id of FLEET3D_IDS) {
    const d = hulls[id].builder.build();
    const [W, H] = FLEET3D_OUTLINES[FLEET3D_SPECS[id].outlineOf || id].sprite;
    let deck = 0;
    for (let v = 0; v < d.vertexCount; v++) {
      if (d.mat[v] !== SHIP3D_MAT.DECK) continue;
      deck++;
      const u = d.uv[v * 2]; const w = d.uv[v * 2 + 1];
      assert.ok(u >= -0.01 && u <= 1.01 && w >= -0.01 && w <= 1.01, `${id}: uv pokładu poza teksturą: ${u}, ${w}`);
      assert.ok(Math.abs(u - (d.position[v * 3] / W + 0.5)) < 1e-4);
      assert.ok(Math.abs(w - (d.position[v * 3 + 1] / H + 0.5)) < 1e-4);
    }
    assert.ok(deck > 500, `${id}: za mało wierzchołków pokładu (${deck})`);
  }
});

test('gniazda, dysze, RCS, światła i mostek z danych edytora i gry', () => {
  for (const id of FLEET3D_IDS) {
    const h = hulls[id];
    const spec = FLEET3D_SPECS[id];
    const ed = SHIP_EDITOR_DEFAULTS.ships[spec.editor];
    assert.ok(ed, `${id}: brak układu edytora ${spec.editor}`);
    assert.equal(h.mounts.length, ed.hardpoints.length, `${id}: gniazda`);
    for (const hp of ed.hardpoints) {
      const m = h.mounts.find((q) => q.id === hp.id);
      assert.ok(m, `${id}: brak gniazda ${hp.id}`);
      assert.ok(Math.abs(m.x - hp.x * h.scale) < 1e-6 && Math.abs(m.y + hp.y * h.scale) < 1e-6, `${id}/${hp.id}: położenie`);
      assert.ok(m.z > h.deckZ * 0.5, `${id}/${hp.id}: gniazdo pod pokładem (z ${m.z.toFixed(2)})`);
      assert.ok(h.contains(m.x, m.y), `${id}/${hp.id}: gniazdo poza kadłubem`);
      assert.ok(h.heightAt(m.x, m.y) > h.bottomAt(m.x, m.y), `${id}/${hp.id}: dach pod dnem`);
    }
    assert.equal(h.nozzles.length, FLEET3D_OUTLINES[spec.outlineOf || id].pods.length, `${id}: dysze = gondole`);
    for (const n of h.nozzles) assert.deepEqual(n.dir, [-1, 0, 0]);
    // Każda dysza MAIN edytora ma gondolę (id markera na najbliższej dyszy).
    const ids = new Set(h.nozzles.map((n) => n.id).filter(Boolean));
    for (const e of ed.engines?.main || []) assert.ok(ids.has(e.id) || h.nozzles.length < ed.engines.main.length, `${id}: dysza ${e.id} bez gondoli`);
    assert.equal(h.rcs.length, (ed.engines?.side || []).length, `${id}: RCS`);
    assert.equal(h.lights.length, (ed.lights?.position || []).length + (ed.lights?.road || []).length, `${id}: światła`);
    assert.equal(h.bridges.length, 1, `${id}: mostek`);
    assert.equal(BRIDGE3D_KINDS[h.bridges[0].kind].hull, spec.editor, `${id}: mostek innego kadłuba`);
  }
});

// WGSL w Node: renderer bez init (atrapa kanwy) — wzór tests/atlas3dModel.test.mjs.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(material, geometry) {
  const mesh = new THREE.Mesh(geometry, material);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.PerspectiveCamera();
  b.context.material = material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('materiał TSL z paletą frakcji: WGSL buduje się bez GPU, w limitach WebGPU', () => {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
  tex.needsUpdate = true;
  for (const id of ['terran_battleship', 'pirate_frigate']) {
    const h = hulls[id];
    const geo = h.builder.toGeometry(THREE, h.scale);
    assert.ok(Object.keys(geo.attributes).length <= 8, 'najwyżej 8 buforów wierzchołków');
    const w = buildWGSL(createShipMaterial({ deckMap: tex, palette: h.palette }), geo);
    assert.ok(w.fragment.includes('fn main') && w.vertex.includes('fn main'), `${id}: brak WGSL`);
    assert.ok((w.fragment.match(/var<uniform>/g) || []).length <= 12, `${id}: za dużo buforów uniformów`);
  }
  assert.ok(FLEET3D_PALETTES.terran && FLEET3D_PALETTES.pirate && FLEET3D_WEAPON_PALETTES.pirate);
});
