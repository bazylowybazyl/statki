// Wieże broni 3D w partiach (opcja „Bronie 3D”, src/3d/ships3d/turretBatch3D.js; 2026-10-07): jeden rysunek na
// rodzinę broni — układ rekordu instancji, scalona geometria rodziny, poza części zgodna z dawnym drzewem Object3D
// (pierścień → obudowa z kursem → czop z pochyleniem → lufy z odrzutem → wirnik), WGSL materiału bez GPU.
// node --test tests/turretBatch3D.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import {
  TURRET_PART, TURRET_INST_STRIDE, TURRET_INST_ATTRS, buildTurretFamilyArrays, turretVertexCpu, writeTurretInstance,
  turretInstanceScratch, createTurretBatchGeometry, createTurretBatchMaterial, TurretBatchSet, TurretBatchNodeMaterial,
  turretBatchWarmHolder
} from '../src/3d/ships3d/turretBatch3D.js';
import { buildWeapon3D, WEAPON3D_FAMILIES, WEAPON3D_FAMILY } from '../src/3d/ships3d/weapons/weapons3D.js';
import { applySunShadowToBuiltinMaterial } from '../src/3d/sunShadowMask.js';

const DEG = Math.PI / 180;
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('rekord instancji: 16 liczb, cztery vec4 w jednym przeplecionym buforze', () => {
  assert.equal(TURRET_INST_STRIDE, 16);
  assert.deepEqual(TURRET_INST_ATTRS.map((a) => [a.name, a.offset]), [['iTurPos', 0], ['iTurRot', 4], ['iTurBarrel', 8], ['iTurSlab', 12]]);
  const t = turretInstanceScratch();
  Object.assign(t, { x: 1, y: 2, z: 3, scale: 4, yawCos: 5, yawSin: 6, hullCos: 7, hullSin: 8, pitchCos: 9, pitchSin: 10, back: 11, spin: 12, zb: 13, zt: 14, lo: 15, hi: 16 });
  const d = new Float32Array(32);
  writeTurretInstance(d, 16, t);
  assert.deepEqual([...d.subarray(16)], Array.from({ length: 16 }, (_, i) => i + 1));
  assert.ok(d.subarray(0, 16).every((v) => v === 0), 'zapis tylko w swoim rekordzie');
});

test('geometria partii: ≤ 8 buforów wierzchołków, jeden bufor instancji, wszystkie rodziny', () => {
  for (const fam of WEAPON3D_FAMILIES) {
    const fa = buildTurretFamilyArrays(fam);
    const { geometry, buffer } = createTurretBatchGeometry(fa, 4);
    const buffers = new Set();
    for (const a of Object.values(geometry.attributes)) buffers.add(a.isInterleavedBufferAttribute ? a.data : a);
    assert.ok(buffers.size <= 8, `${fam}: ${buffers.size} buforów wierzchołków (limit 8)`);
    assert.equal(buffers.size, 6, `${fam}: position, normal, uv, aMat, aTurPart + bufor instancji`);
    for (const { name, offset } of TURRET_INST_ATTRS) {
      const a = geometry.getAttribute(name);
      assert.ok(a?.isInterleavedBufferAttribute && a.data === buffer && a.offset === offset && a.itemSize === 4, `${fam}: ${name}`);
    }
    assert.ok(buffer.isInstancedInterleavedBuffer && buffer.stride === TURRET_INST_STRIDE && buffer.meshPerAttribute === 1);
    assert.notEqual(buffer.usage, THREE.DynamicDrawUsage, 'wysyłka zakresem, nie DynamicDrawUsage (pełny upload co render)');
    assert.equal(geometry.isInstancedBufferGeometry, true);
    assert.equal(geometry.index.count, fa.index.length);
  }
});

test('rodziny: scalone części (pierścień, obudowa, n luf, n wirników), przesunięcia kopii, wysokość jak dawniej', () => {
  let parts = 0;
  for (const fam of WEAPON3D_FAMILIES) {
    const m = buildWeapon3D(fam);
    const fa = buildTurretFamilyArrays(fam);
    const vc = (b) => (b ? b.vcount() : 0);
    const n = m.barrels.length;
    assert.equal(fa.vertexCount, vc(m.parts.ring) + vc(m.parts.housing) + n * (vc(m.parts.barrel) + vc(m.parts.spin)), fam);
    const kinds = fa.pieces.map((p) => p.part);
    assert.deepEqual(kinds, [TURRET_PART.RING, TURRET_PART.HOUSING, ...Array(n).fill(TURRET_PART.BARREL), ...(m.parts.spin ? Array(n).fill(TURRET_PART.SPIN) : [])], fam);
    parts += 3 + (m.parts.spin ? 1 : 0);
    for (const p of fa.pieces) {
      for (const i of [p.first, p.first + p.count - 1]) {
        assert.deepEqual([...fa.part.subarray(i * 4, i * 4 + 4)], [p.part, ...p.off].map(Math.fround), `${fam}: aTurPart wierzchołka ${i}`);
      }
    }
    fa.pieces.filter((p) => p.part >= TURRET_PART.BARREL).forEach((p, j) => {
      const i = j % n;
      assert.deepEqual(p.off, [m.barrelShift ? m.barrelShift[i] : 0, m.barrels[i][0], m.barrels[i][1]], `${fam}: kopia lufy ${i}`);
    });
    // wysokość jak dawne weaponGeometry (bryły three, boundingBox)
    const g = (b) => { const x = b.toGeometry(THREE); x.computeBoundingBox(); return x.boundingBox.max.z; };
    const height = Math.max(1, g(m.parts.ring), g(m.parts.housing), (m.trunnion?.[1] || 0) + g(m.parts.barrel));
    assert.ok(Math.abs(fa.height - height) < 1e-9, `${fam}: wysokość ${fa.height} ≠ ${height}`);
    assert.ok(fa.index.every((i) => i < fa.vertexCount));
  }
  // 24 rodziny z dawnego drzewa wież + Lanca (2026-10-08: pierścień, obudowa, lufa).
  assert.equal(WEAPON3D_FAMILIES.length, 25);
  assert.equal(parts, 79, 'dawniej 76 osobnych części (rysunków na wieżę) + 3 Lancy — teraz 1 na rodzinę');
  for (const fam of new Set(Object.values(WEAPON3D_FAMILY).filter(Boolean))) assert.ok(WEAPON3D_FAMILIES.includes(fam), fam);
});

// Dawne drzewo wieży (shipModels3DGame.js do 2026-10-07): korzeń egzemplarza (początek ciała, θ) → grupa modelu
// (środek sprite'a, skala k) → korzeń wieży (pokład, skala s) → yaw → czop (pochylenie) → lufa (kopia, odrzut) → wirnik.
function oldTree(model, pose) {
  const root = new THREE.Object3D();
  root.position.set(pose.ox, pose.oy, 0);
  root.rotation.set(0, 0, pose.theta);
  const group = new THREE.Object3D();
  group.position.set(pose.scx, pose.scy, 0);
  group.scale.setScalar(pose.k);
  root.add(group);
  const t = new THREE.Object3D();
  t.position.set(pose.lx, pose.ly, pose.hz);
  t.scale.setScalar(pose.s);
  group.add(t);
  const ring = new THREE.Object3D();
  t.add(ring);
  const yaw = new THREE.Object3D();
  yaw.rotation.z = pose.yawLocal;
  t.add(yaw);
  const housing = new THREE.Object3D();
  yaw.add(housing);
  const pitch = new THREE.Object3D();
  pitch.position.set(model.trunnion[0], 0, model.trunnion[1]);
  pitch.rotation.y = -pose.pitch;
  yaw.add(pitch);
  const barrels = [], spins = [];
  model.barrels.forEach(([y, z], i) => {
    const b = new THREE.Object3D();
    const shift = model.barrelShift ? model.barrelShift[i] : 0;
    b.position.set(shift - pose.back, y, z);
    pitch.add(b);
    const m = new THREE.Object3D();
    b.add(m);
    barrels.push(m);
    const sp = new THREE.Object3D();
    sp.rotation.x = pose.spin;
    b.add(sp);
    spins.push(sp);
  });
  root.updateMatrixWorld(true);
  return { ring, housing, barrels, spins };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('poza części z rekordu = dawne drzewo Object3D (pozycje i normalne, wszystkie rodziny)', () => {
  const R = rng(7);
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  const out = {};
  for (const fam of WEAPON3D_FAMILIES) {
    const fa = buildTurretFamilyArrays(fam);
    const model = fa.model;
    for (let trial = 0; trial < 3; trial++) {
      // encja: świat ~6 mln j., początek partii przy kamerze ~kilka km od niej
      const pose = {
        ox: 6e6 + R() * 2000, oy: -6.5e6 - R() * 2000, theta: R() * 6.283 - 3.14,
        scx: R() * 300 - 150, scy: R() * 200 - 100, k: 0.5 + R() * 2,
        lx: R() * 200 - 100, ly: R() * 100 - 50, hz: R() * 30, s: 0.4 + R() * 1.4,
        ang: R() * 6.283 - 3.14, pitch: (R() * 40 - 5) * DEG, back: R() * model.recoil, spin: R() * 6.283
      };
      const ca = Math.cos(pose.ang), sa = -Math.sin(pose.ang), c = Math.cos(pose.theta), s = Math.sin(pose.theta);
      pose.yawLocal = Math.atan2(-s * ca + c * sa, c * ca + s * sa); // jak dawne syncTurrets
      const tree = oldTree(model, pose);
      // rekord jak nowe syncTurrets: podstawa wieży w świecie (x, −y) z drzewa, początek partii
      const org = { x: pose.ox - 1234.5, y: pose.oy + 987.25 };
      const base = new THREE.Vector3(pose.lx, pose.ly, pose.hz).applyMatrix4(tree.ring.parent.parent.matrixWorld);
      const t = turretInstanceScratch();
      Object.assign(t, {
        x: base.x - org.x, y: base.y - org.y, z: pose.hz * pose.k, scale: pose.s * pose.k,
        yawCos: ca, yawSin: sa, hullCos: c, hullSin: s,
        pitchCos: Math.cos(pose.pitch), pitchSin: Math.sin(pose.pitch), back: pose.back, spin: pose.spin
      });
      assert.ok(Math.abs(base.z - t.z) < 1e-9, 'podstawa wieży: z = pokład × k');
      const rec = new Float64Array(16);
      writeTurretInstance(rec, 0, t);
      const objFor = (p, j) => (p.part === TURRET_PART.RING ? tree.ring : p.part === TURRET_PART.HOUSING ? tree.housing
        : p.part === TURRET_PART.BARREL ? tree.barrels[j % model.barrels.length] : tree.spins[j % model.barrels.length]);
      let j = 0;
      for (const p of fa.pieces) {
        const obj = objFor(p, j);
        if (p.part >= TURRET_PART.BARREL) j++;
        nm.getNormalMatrix(obj.matrixWorld);
        for (const i of [p.first, p.first + (p.count >> 1), p.first + p.count - 1]) {
          v.fromArray(fa.position, i * 3).applyMatrix4(obj.matrixWorld);
          n.fromArray(fa.normal, i * 3).applyMatrix3(nm).normalize();
          turretVertexCpu(rec, 0, fa.part.subarray(i * 4, i * 4 + 4), fa.trunnion, fa.position.subarray(i * 3, i * 3 + 3), fa.normal.subarray(i * 3, i * 3 + 3), out);
          const d = Math.hypot(out.x + org.x - v.x, out.y + org.y - v.y, out.z - v.z);
          assert.ok(d < 1e-6, `${fam} część ${p.part}: pozycja różni się o ${d}`);
          const nl = Math.hypot(out.nx, out.ny, out.nz);
          assert.ok(Math.abs(nl - 1) < 1e-6 || nl < 1e-9, `${fam}: normalna obrócona, nie skalowana`);
          if (nl > 0.5) assert.ok(Math.hypot(out.nx - n.x, out.ny - n.y, out.nz - n.z) < 1e-6, `${fam} część ${p.part}: normalna`);
        }
      }
    }
  }
});

test('zestaw partii: liczba instancji, widoczność, wysyłka zakresem, wzrost pojemności bez utraty rekordów', () => {
  const scene = new THREE.Scene();
  const mat = new THREE.MeshBasicNodeMaterial();
  const set = new TurretBatchSet(scene, mat);
  const t = turretInstanceScratch();
  set.begin(100, -200);
  const a = set.family('tempest2'), b = set.family('vulcan');
  assert.equal(scene.children.length, 2, 'jedna siatka na rodzinę');
  for (let i = 0; i < 40; i++) { t.x = i; a.push(t); }
  b.push(t);
  set.end();
  assert.equal(set.draws, 2);
  assert.equal(set.turrets, 41);
  assert.equal(a.mesh.geometry.instanceCount, 40);
  assert.ok(a.capacity >= 40, 'pojemność rośnie');
  for (let i = 0; i < 40; i++) assert.equal(a.data[i * TURRET_INST_STRIDE], i, 'rekordy sprzed wzrostu zostają');
  assert.equal(a.mesh.geometry.getAttribute('iTurPos').data, a.buffer, 'geometria na nowym buforze');
  assert.deepEqual([a.mesh.position.x, a.mesh.position.y, a.mesh.position.z], [100, -200, 0], 'siatka w początku partii');
  assert.equal(a.mesh.visible, true);
  assert.equal(a.mesh.frustumCulled, false);
  assert.equal(a.mesh.receiveShadow, true, 'odbiorca cienia jak dawne siatki wież');
  assert.equal(a.buffer.updateRanges.length, 1);
  assert.deepEqual({ ...a.buffer.updateRanges[0] }, { start: 0, count: 40 * TURRET_INST_STRIDE });
  assert.equal(a.mesh.userData.turretTrunnion.x, buildTurretFamilyArrays('tempest2').trunnion[0]);
  // następna klatka: tylko vulcan
  set.begin(0, 0);
  b.push(t);
  set.end();
  assert.equal(a.mesh.visible, false, 'rodzina bez wież w kadrze — bez rysunku');
  assert.equal(a.mesh.geometry.instanceCount, 0);
  assert.equal(set.draws, 1);
});

// WGSL bez GPU (wzór tests/atlas3dModel.test.mjs).
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}

test('materiał partii: WGSL z rekordem instancji, normalna przed widokiem, warstwa głębi z rekordu, w limitach', () => {
  const mat = applySunShadowToBuiltinMaterial(createTurretBatchMaterial());
  assert.ok(mat instanceof TurretBatchNodeMaterial);
  assert.match(mat.customProgramCacheKey(), /^TurretBatchNodeMaterial/, 'osobny program — nie dzieli kodu z materiałem broni bez partii');
  const holder = turretBatchWarmHolder(mat, 'vulcan');
  assert.equal(holder.receiveShadow, true, 'rozgrzewka w stanie siatek partii (receiveShadow w kluczu three)');
  const w = buildWGSL(holder);
  for (const name of ['iTurPos', 'iTurRot', 'iTurBarrel', 'iTurSlab', 'aTurPart', 'aMat']) assert.ok(w.vertex.includes(name), `atrybut ${name}`);
  const main = w.vertex.slice(w.vertex.indexOf('fn main'));
  const assignN = main.search(/normalLocal\s*=/);
  const useN = main.search(/v_normalViewGeometry\s*=/);
  assert.ok(assignN >= 0 && useN > assignN, 'normalna z rekordu przypisana przed normalną widoku');
  const assignP = main.search(/positionLocal\s*=/);
  assert.ok(assignP >= 0 && assignP < main.search(/v_positionWorld|positionWorld\s*=|varyings\.\w*positionWorld/) + 1e9, 'pozycja z rekordu');
  assert.ok(/@interpolate\(\s*flat/.test(w.vertex + w.fragment), 'warstwa głębi stała na instancję (flat)');
  const ubo = Math.max((w.vertex.match(/var<uniform>/g) || []).length, (w.fragment.match(/var<uniform>/g) || []).length);
  assert.ok(ubo <= 12, `${ubo} buforów uniformów (limit 12)`);
  const outStruct = w.vertex.match(/struct VaryingsStruct \{([\s\S]*?)\}/);
  const locations = outStruct ? (outStruct[1].match(/@location/g) || []).length : 0;
  assert.ok(locations <= 16, `${locations} varyingów (limit 16)`);
});

test('shipModels3DGame: wieże tylko w partiach — bez drzewa siatek na wieżę', () => {
  const src = read('src/3d/ships3d/shipModels3DGame.js');
  assert.match(src, /B\.family\(fam\)\.push\(T\);/);
  assert.match(src, /turretBatchWarmHolder\(turretMaterial\(\), fam\)/, 'rozgrzewka partii w rejestrze modeli 3D');
  assert.match(src, /sceneOriginNearCamera\(_org\);/, 'rekordy względem początku przy kamerze');
});
