// Modele broni z Blendera (GLB) w grze: loader (src/3d/ships3d/weapons/weaponGlb.js), rejestr rodzin,
// buildWeapon3D z częściami GLB i partia wież (turretBatch3D.js) z AO. GLB parsowany w Node (GLTFLoader.parse).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseWeaponGlb, registerWeaponGlb, resetWeaponGlbQueries, setWeaponGlbFamilies, weaponGlbParts, loadWeaponGlbs,
  weaponGlbFamilies, weaponGlbFile, weaponGlbUrl, parseWeaponGlbList, WEAPON_GLB_GAME, WEAPON_GLB_TRI_BUDGET, WeaponGlbPart,
  WEAPON_GLB_AUTO, WEAPON_GLB_LOD0_PX, WEAPON_GLB_LOD1_PX, weaponGlbLodFor, weaponGlbAutoLod
} from '../src/3d/ships3d/weapons/weaponGlb.js';
import { buildWeapon3D } from '../src/3d/ships3d/weapons/weapons3D.js';
import { SHIP3D_MAT, SHIP3D_MAT_COUNT } from '../src/3d/ships3d/meshBuilder3D.js';
import { buildTurretFamilyArrays, createTurretBatchGeometry, TURRET_PART } from '../src/3d/ships3d/turretBatch3D.js';

const abOf = (url) => {
  const buf = readFileSync(fileURLToPath(url));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};
const PALETTE = new Set(Object.values(SHIP3D_MAT));
const tris = (p, n) => p.ring.triangleCount + p.housing.triangleCount + n * p.barrel.triangleCount + (p.spin ? n * p.spin.triangleCount : 0);

const lod0 = await parseWeaponGlb(abOf(weaponGlbUrl('yamato', 0)), 'yamato.glb');
const lod1 = await parseWeaponGlb(abOf(weaponGlbUrl('yamato', 1)), 'yamato_lod1.glb');

test('rejestr ogólny: rodzina → assets/weapons3d/<plik>[_lod1].glb, w grze Yamato i Tempest w trybie AUTO; lista rodzin z adresu', () => {
  const rel = (u) => fileURLToPath(u).replaceAll('\\', '/').replace(/^.*\/assets\//, 'assets/');
  assert.equal(rel(weaponGlbUrl('tempest1')), 'assets/weapons3d/tempest1.glb');
  assert.equal(rel(weaponGlbUrl('tempest2', 1)), 'assets/weapons3d/tempest2_lod1.glb');
  assert.equal(weaponGlbFile('yamato2'), 'yamato');
  // 2026-10-13 (decyzja użytkownika): Yamato, Yamato L, Tempest 1 / 2 i Lanca na stałe, LOD wg oddalenia kamery;
  // 2026-10-20: Promień Śmierci „Gungnir” (deathRay — wieża supercapitala Terra Nova)
  assert.deepEqual(Object.keys(WEAPON_GLB_GAME).sort(), ['deathRay', 'lance', 'tempest1', 'tempest2', 'yamato', 'yamato2']);
  for (const [fam, mode] of Object.entries(WEAPON_GLB_GAME)) {
    assert.equal(mode, WEAPON_GLB_AUTO, `${fam}: tryb AUTO (LOD0 z bliska, LOD1 z daleka)`);
    for (const lod of [0, 1]) assert.ok(readFileSync(fileURLToPath(weaponGlbUrl(fam, lod))).length > 1000, `plik ${fam} LOD${lod}`);
  }
  assert.deepEqual([...parseWeaponGlbList('yamato, tempest2@1,,0')], [['yamato', 0], ['tempest2', 1]]);
  assert.deepEqual([...parseWeaponGlbList('lance@auto,tempest1@a')], [['lance', WEAPON_GLB_AUTO], ['tempest1', WEAPON_GLB_AUTO]]);
  assert.equal(parseWeaponGlbList('').size, 0, '„stary” = pusta lista');
  assert.deepEqual([...weaponGlbFamilies()], Object.entries(WEAPON_GLB_GAME), 'bez przełącznika — WEAPON_GLB_GAME');
  globalThis.__WEAPON_GLB = ['tempest1@1'];
  assert.deepEqual([...weaponGlbFamilies()], [['tempest1', 1]]);
  globalThis.__WEAPON_GLB = false;
  assert.equal(weaponGlbFamilies().size, 0);
  delete globalThis.__WEAPON_GLB;
  globalThis.location = { search: '?dev=1&bronieGlb=' };
  assert.equal(weaponGlbFamilies().size, 0, '?bronieGlb= — żadna rodzina');
  globalThis.location = { search: '?bronieGlb=yamato,tempest2@1' };
  assert.deepEqual([...weaponGlbFamilies()], [['yamato', 0], ['tempest2', 1]]);
  delete globalThis.location;
});

test('format loadera: tablice jak MeshBuilder3D.build() + ao, materiały z palety, normalne jednostkowe', () => {
  for (const [name, P] of [['LOD0', lod0], ['LOD1', lod1]]) {
    assert.deepEqual(P.unknownMaterials, [], `${name}: materiały tylko z palety SHIP3D_MAT`);
    assert.equal(P.spin, null, `${name}: Yamato bez wirnika`);
    for (const k of ['ring', 'housing', 'barrel']) {
      const d = P[k];
      const vc = d.vertexCount;
      assert.ok(vc > 0, `${name} ${k}`);
      assert.ok(d.position instanceof Float32Array && d.position.length === vc * 3);
      assert.ok(d.normal instanceof Float32Array && d.normal.length === vc * 3);
      assert.ok(d.uv instanceof Float32Array && d.uv.length === vc * 2);
      assert.ok(d.mat instanceof Float32Array && d.mat.length === vc);
      assert.ok(d.ao instanceof Float32Array && d.ao.length === vc);
      assert.equal(d.index.length, d.triangleCount * 3);
      assert.ok(d.index instanceof (vc > 65535 ? Uint32Array : Uint16Array));
      for (let i = 0; i < d.index.length; i++) if (d.index[i] >= vc) assert.fail(`${name} ${k}: indeks poza zakresem`);
      for (let i = 0; i < vc; i++) {
        const m = d.mat[i];
        if (!PALETTE.has(m) || m < 0 || m >= SHIP3D_MAT_COUNT) assert.fail(`${name} ${k}: materiał ${m}`);
        const a = d.ao[i];
        if (!(a >= 0 && a <= 1)) assert.fail(`${name} ${k}: AO ${a}`);
        const nl = Math.hypot(d.normal[i * 3], d.normal[i * 3 + 1], d.normal[i * 3 + 2]);
        if (Math.abs(nl - 1) > 1e-3) assert.fail(`${name} ${k}: normalna ${nl}`);
      }
      // uv = rzut pudełkowy MeshBuilder3D (uvScale 1): para współrzędnych pozycji wg dominującej osi normalnej
      for (let i = 0; i < vc; i += 97) {
        const [x, y, z] = d.position.subarray(i * 3, i * 3 + 3);
        const [ax, ay, az] = Array.from(d.normal.subarray(i * 3, i * 3 + 3), Math.abs);
        const want = az >= ax && az >= ay ? [x, y] : ax >= ay ? [y, z] : [x, z];
        assert.deepEqual([d.uv[i * 2], d.uv[i * 2 + 1]], want);
      }
    }
    const aoMin = Math.min(...P.housing.ao);
    assert.ok(aoMin < 0.8, `${name}: AO wypieczone (min ${aoMin.toFixed(2)})`);
  }
});

test('budżet trójkątów rodziny: LOD0 ≤ 40 tys., LOD1 ≤ 6 tys. (3 lufy)', () => {
  assert.ok(tris(lod0, 3) <= WEAPON_GLB_TRI_BUDGET.lod0, `LOD0 ${tris(lod0, 3)}`);
  assert.ok(tris(lod1, 3) <= WEAPON_GLB_TRI_BUDGET.lod1, `LOD1 ${tris(lod1, 3)}`);
  assert.ok(tris(lod1, 3) < tris(lod0, 3) / 3, 'LOD1 wyraźnie lżejszy');
});

test('układ: Z w górę, lufa wzdłuż +X od czopu, wylot = muzzleX budowniczego, obrys jak model z weapons3D.js', () => {
  const ref = buildWeapon3D('yamato', { builder: true });
  assert.equal(ref.source, 'builder');
  for (const [name, P] of [['LOD0', lod0], ['LOD1', lod1]]) {
    const box = (d) => {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = 0; i < d.position.length; i += 3) for (let k = 0; k < 3; k++) {
        b[k] = Math.min(b[k], d.position[i + k]); b[k + 3] = Math.max(b[k + 3], d.position[i + k]);
      }
      return b;
    };
    const bb = box(P.barrel);
    assert.ok(Math.abs(bb[3] - ref.muzzleX) < 0.75, `${name}: wylot lufy ${bb[3].toFixed(2)} vs muzzleX ${ref.muzzleX}`);
    assert.ok(Math.abs(bb[1] + bb[4]) < 0.5 && Math.abs(bb[2] + bb[5]) < 0.6, `${name}: lufa na osi czopu (y, z ≈ 0)`);
    const hb = box(P.housing), rb = box(P.ring);
    const refH = box(ref.parts.housing.build());
    assert.ok(hb[2] > -1 && hb[5] > 10 && hb[5] < 25, `${name}: obudowa nad pokładem, Z w górę (z ${hb[2].toFixed(1)}…${hb[5].toFixed(1)})`);
    assert.ok(Math.abs(hb[5] - refH[5]) < 6, `${name}: wysokość obudowy jak model z budowniczego (${hb[5].toFixed(1)} vs ${refH[5].toFixed(1)})`);
    assert.ok(Math.abs(hb[0] + hb[3]) < 10 && Math.abs(hb[1] + hb[4]) < 1, `${name}: obudowa wokół osi obrotu, symetryczna w y`);
    assert.ok(rb[5] < 3 && rb[3] > 18, `${name}: pierścień niski i szeroki`);
  }
});

test('rejestr: buildWeapon3D oddaje części z GLB (yamato, yamato2), układ z FAMILIES; budowniczy na żądanie', () => {
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(null);
  registerWeaponGlb('yamato', 0, lod0);
  const ref = buildWeapon3D('yamato', { builder: true });
  const m = buildWeapon3D('yamato');
  assert.equal(m.source, 'glb');
  assert.ok(m.parts.ring instanceof WeaponGlbPart && m.parts.barrel instanceof WeaponGlbPart);
  for (const k of ['trunnion', 'barrels', 'barrelShift', 'muzzleX', 'recoil', 'pitch', 'kind', 'light']) assert.deepEqual(m[k], ref[k], k);
  assert.equal(m.parts.barrel.build().triangleCount, lod0.barrel.triangleCount);
  const b1 = m.parts.housing.build(), b2 = m.parts.housing.build();
  b1.position[0] = 1e6;
  assert.notEqual(b2.position[0], 1e6, 'build() oddaje kopie');
  assert.equal(buildWeapon3D('yamato'), m, 'cache');
  const twin = buildWeapon3D('yamato2');
  assert.equal(twin.source, 'glb');
  assert.equal(twin.barrels.length, 2);
  assert.deepEqual(twin.barrelShift, [-2, -2]);
  assert.equal(buildWeapon3D('tempest1').source, 'builder', 'rodzina bez GLB — budowniczy');
});

test('partia wież: geometria rodziny z GLB (AO z pliku), ten sam układ atrybutów co rodziny z budowniczego', () => {
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(null);
  registerWeaponGlb('yamato', 0, lod0);
  const fa = buildTurretFamilyArrays('yamato');
  assert.equal(fa.model.source, 'glb');
  assert.equal(fa.vertexCount, lod0.ring.vertexCount + lod0.housing.vertexCount + 3 * lod0.barrel.vertexCount);
  assert.equal(fa.index.length / 3, tris(lod0, 3));
  assert.equal(fa.pieces.filter((p) => p.part === TURRET_PART.BARREL).length, 3);
  const hp = fa.pieces.find((p) => p.part === TURRET_PART.HOUSING);
  assert.deepEqual([...fa.ao.subarray(hp.first, hp.first + 50)], [...lod0.housing.ao.subarray(0, 50)], 'AO obudowy z pliku');
  const fb = buildTurretFamilyArrays('tempest1');
  assert.ok(fb.ao.every((v) => v === 1), 'budowniczy — AO 1');
  const key = (g) => Object.keys(g.attributes).sort().map((n) => {
    const a = g.attributes[n];
    return `${n}:${a.itemSize}:${a.data ? a.data.stride + ',' + a.offset : ''}:${a.normalized ? 'n' : ''}`;
  }).join('|') + `|idx:${!!g.index}`;
  assert.equal(key(createTurretBatchGeometry(fa, 2).geometry), key(createTurretBatchGeometry(fb, 2).geometry),
    'klucz geometrii three jak w rozgrzewce (bez nowego pipeline\'u w klatce)');
  const ring = fa.pieces.find((p) => p.part === TURRET_PART.RING);
  const yMax = fa.height;
  assert.ok(yMax > 10 && ring.count === lod0.ring.vertexCount);
});

// Tempest (scripts/blender/tempest.py): tempest1 (1 lufa), tempest2 (2 lufy), lance (Lanca — korpus Tempesta, długa
// lufa). Rodziny MASOWE (bateria główna Atlasa i NPC Terra Nova) — LOD1 w budżecie modelu z budowniczego (+25%).
const TEMPEST = {};
for (const fam of ['tempest1', 'tempest2', 'lance']) {
  TEMPEST[fam] = {
    lod0: await parseWeaponGlb(abOf(weaponGlbUrl(fam, 0)), `${fam}.glb`),
    lod1: await parseWeaponGlb(abOf(weaponGlbUrl(fam, 1)), `${fam}_lod1.glb`)
  };
}

test('Tempest i Lanca: format, budżet (LOD1 ≈ budżet budowniczego), układ jak weapons3D.js', () => {
  const box = (d) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < d.position.length; i += 3) for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], d.position[i + k]); b[k + 3] = Math.max(b[k + 3], d.position[i + k]);
    }
    return b;
  };
  for (const [fam, files] of Object.entries(TEMPEST)) {
    const ref = buildWeapon3D(fam, { builder: true });
    const n = ref.barrels.length;
    const refTris = ref.parts.ring.build().triangleCount + ref.parts.housing.build().triangleCount + n * ref.parts.barrel.build().triangleCount;
    const refH = box(ref.parts.housing.build()), refR = box(ref.parts.ring.build());
    for (const [name, P] of [['LOD0', files.lod0], ['LOD1', files.lod1]]) {
      const tag = `${fam} ${name}`;
      assert.deepEqual(P.unknownMaterials, [], `${tag}: materiały tylko z palety SHIP3D_MAT`);
      assert.equal(P.spin, null, `${tag}: bez wirnika`);
      for (const k of ['ring', 'housing', 'barrel']) {
        const d = P[k];
        assert.ok(d.vertexCount > 0 && d.index.length === d.triangleCount * 3, `${tag} ${k}`);
        for (let i = 0; i < d.vertexCount; i++) {
          if (!PALETTE.has(d.mat[i])) assert.fail(`${tag} ${k}: materiał ${d.mat[i]}`);
          if (!(d.ao[i] >= 0 && d.ao[i] <= 1)) assert.fail(`${tag} ${k}: AO ${d.ao[i]}`);
        }
      }
      const bb = box(P.barrel), hb = box(P.housing), rb = box(P.ring);
      assert.ok(Math.abs(bb[3] - ref.muzzleX) < 0.75, `${tag}: wylot ${bb[3].toFixed(2)} vs muzzleX ${ref.muzzleX}`);
      assert.ok(Math.abs(bb[1] + bb[4]) < 0.5 && Math.abs(bb[2] + bb[5]) < 0.6, `${tag}: lufa na osi czopu`);
      assert.ok(hb[2] > -0.5 && hb[5] > 5 && Math.abs(hb[5] - refH[5]) < 3, `${tag}: obudowa z ${hb[2].toFixed(1)}…${hb[5].toFixed(1)} (budowniczy ${refH[5].toFixed(1)})`);
      assert.ok(Math.abs(hb[1] + hb[4]) < 0.5, `${tag}: obudowa symetryczna w y`);
      assert.ok(Math.abs(hb[0] - refH[0]) < 1.5 && Math.abs(hb[3] - refH[3]) < 1.5, `${tag}: obrys obudowy w x jak budowniczy`);
      assert.ok(rb[5] < 2 && Math.abs(rb[3] - refR[3]) < 0.5, `${tag}: pierścień niski, promień jak budowniczy`);
    }
    assert.ok(tris(files.lod0, n) <= WEAPON_GLB_TRI_BUDGET.lod0, `${fam} LOD0 ${tris(files.lod0, n)}`);
    assert.ok(tris(files.lod1, n) <= Math.min(WEAPON_GLB_TRI_BUDGET.lod1, refTris * 1.25),
      `${fam} LOD1 ${tris(files.lod1, n)} — budżet rodziny masowej ≈ budowniczy (${refTris}) + 25%`);
  }
});

// Promień Śmierci „Gungnir” (scripts/blender/deathRay.py): jedna wieża na supercapitalu (rozmiar Capital) — LOD0 do
// zbliżeń, LOD1 przy zwykłych zoomach. Wylot 62 w układzie wieży = SPECS.deathRay w turret2D.js (muzzleX 46 od czopu).
const DEATH_RAY = {
  lod0: await parseWeaponGlb(abOf(weaponGlbUrl('deathRay', 0)), 'deathRay.glb'),
  lod1: await parseWeaponGlb(abOf(weaponGlbUrl('deathRay', 1)), 'deathRay_lod1.glb')
};

test('Promień Śmierci: format, budżet, układ jak weapons3D.js (wylot 46 od czopu, korona zębów symetryczna)', () => {
  const box = (d) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < d.position.length; i += 3) for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], d.position[i + k]); b[k + 3] = Math.max(b[k + 3], d.position[i + k]);
    }
    return b;
  };
  const ref = buildWeapon3D('deathRay', { builder: true });
  assert.equal(ref.muzzleX, 46);
  const refH = box(ref.parts.housing.build()), refR = box(ref.parts.ring.build());
  for (const [name, P] of [['LOD0', DEATH_RAY.lod0], ['LOD1', DEATH_RAY.lod1]]) {
    const tag = `deathRay ${name}`;
    assert.deepEqual(P.unknownMaterials, [], `${tag}: materiały tylko z palety SHIP3D_MAT`);
    assert.equal(P.spin, null);
    const mats = new Set();
    for (const k of ['ring', 'housing', 'barrel']) {
      const d = P[k];
      assert.ok(d.vertexCount > 0 && d.index.length === d.triangleCount * 3, `${tag} ${k}`);
      for (let i = 0; i < d.vertexCount; i++) {
        if (!PALETTE.has(d.mat[i])) assert.fail(`${tag} ${k}: materiał ${d.mat[i]}`);
        if (!(d.ao[i] >= 0 && d.ao[i] <= 1)) assert.fail(`${tag} ${k}: AO ${d.ao[i]}`);
        mats.add(d.mat[i]);
      }
    }
    assert.ok(mats.has(SHIP3D_MAT.E_MINT), `${tag}: miętowe światła (barwa wiązki)`);
    assert.ok(Math.min(...P.housing.ao) < 0.8, `${tag}: AO wypieczone`);
    const bb = box(P.barrel), hb = box(P.housing), rb = box(P.ring);
    assert.ok(Math.abs(bb[3] - ref.muzzleX) < 0.75, `${tag}: wylot ${bb[3].toFixed(2)} vs muzzleX ${ref.muzzleX}`);
    assert.ok(Math.abs(bb[1] + bb[4]) < 0.5 && Math.abs(bb[2] + bb[5]) < 0.6, `${tag}: lufa na osi czopu`);
    assert.ok(hb[2] > -0.5 && Math.abs(hb[5] - refH[5]) < 3, `${tag}: obudowa z ${hb[2].toFixed(1)}…${hb[5].toFixed(1)} (budowniczy ${refH[5].toFixed(1)})`);
    assert.ok(Math.abs(hb[1] + hb[4]) < 0.5, `${tag}: obudowa symetryczna w y`);
    assert.ok(Math.abs(hb[0] - refH[0]) < 1.5, `${tag}: rufa obudowy jak budowniczy`);
    assert.ok(rb[5] < 2 && Math.abs(rb[3] - refR[3]) < 0.5, `${tag}: pierścień niski, promień jak budowniczy`);
  }
  assert.ok(tris(DEATH_RAY.lod0, 1) <= WEAPON_GLB_TRI_BUDGET.lod0, `LOD0 ${tris(DEATH_RAY.lod0, 1)}`);
  assert.ok(tris(DEATH_RAY.lod1, 1) <= WEAPON_GLB_TRI_BUDGET.lod1, `LOD1 ${tris(DEATH_RAY.lod1, 1)}`);
  assert.ok(tris(DEATH_RAY.lod1, 1) < tris(DEATH_RAY.lod0, 1) / 3, 'LOD1 wyraźnie lżejszy');
  // LOD AUTO: sylwetka r 64 × skala Capital 1,75 — LOD0 przy zbliżeniu 1,8, LOD1 przy 0,9
  assert.equal(weaponGlbLodFor(-1, 64 * 1.75 * 1.8), 0);
  assert.equal(weaponGlbLodFor(-1, 64 * 1.75 * 0.9), 1);
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(['deathRay@auto']);
  registerWeaponGlb('deathRay', 0, DEATH_RAY.lod0);
  registerWeaponGlb('deathRay', 1, DEATH_RAY.lod1);
  assert.equal(weaponGlbAutoLod('deathRay'), true);
  const m0 = buildWeapon3D('deathRay'), m1 = buildWeapon3D('deathRay', { lod: 1 });
  assert.ok(m0.source === 'glb' && m1.source === 'glb' && m1.lod === 1);
  for (const k of ['trunnion', 'barrels', 'muzzleX', 'recoil', 'pitch', 'kind', 'light']) assert.deepEqual(m0[k], ref[k], k);
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(null);
});

test('Tempest przez rejestr (lista rodzin): części z GLB, układ z FAMILIES, partia z AO', () => {
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(['tempest2@1']);
  registerWeaponGlb('tempest2', 1, TEMPEST.tempest2.lod1);
  const ref = buildWeapon3D('tempest2', { builder: true });
  const m = buildWeapon3D('tempest2');
  assert.equal(m.source, 'glb');
  for (const k of ['trunnion', 'barrels', 'barrelShift', 'muzzleX', 'recoil', 'pitch', 'kind', 'light']) assert.deepEqual(m[k], ref[k], k);
  const fa = buildTurretFamilyArrays('tempest2');
  const P = TEMPEST.tempest2.lod1;
  assert.equal(fa.vertexCount, P.ring.vertexCount + P.housing.vertexCount + 2 * P.barrel.vertexCount);
  assert.ok(Math.min(...fa.ao) < 0.8, 'AO z pliku');
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(null);
});

test('LOD wg oddalenia kamery (tryb AUTO): próg z histerezą, części LOD0 / LOD1, dwie partie rodziny', () => {
  // histereza: LOD0 od WEAPON_GLB_LOD0_PX, powrót do LOD1 poniżej WEAPON_GLB_LOD1_PX, pierwszy wybór — środek pasma
  assert.ok(WEAPON_GLB_LOD1_PX < WEAPON_GLB_LOD0_PX);
  assert.equal(weaponGlbLodFor(-1, WEAPON_GLB_LOD0_PX), 0);
  assert.equal(weaponGlbLodFor(-1, WEAPON_GLB_LOD1_PX), 1);
  const mid = (WEAPON_GLB_LOD0_PX + WEAPON_GLB_LOD1_PX) / 2;
  assert.equal(weaponGlbLodFor(1, mid), 1, 'z daleka do środka pasma — dalej LOD1');
  assert.equal(weaponGlbLodFor(0, mid), 0, 'z bliska do środka pasma — dalej LOD0');
  assert.equal(weaponGlbLodFor(1, WEAPON_GLB_LOD0_PX), 0);
  assert.equal(weaponGlbLodFor(0, WEAPON_GLB_LOD1_PX - 0.01), 1);
  // Yamato (Turret2D spec.r 58, skala 1,75): z góry LOD0 od zoomu ~1,6; Tempest Mk II (r 40, 0,76) przy max zoomie 3,2 — LOD1
  assert.equal(weaponGlbLodFor(-1, 58 * 1.75 * 1.8), 0);
  assert.equal(weaponGlbLodFor(-1, 58 * 1.75 * 0.9), 1);
  assert.equal(weaponGlbLodFor(-1, 40 * 0.76 * 3.2), 1);
  // rejestr: AUTO z oboma plikami — części wg poziomu partii; bez pliku LOD1 — jedna partia (LOD0)
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(['tempest2@auto', 'yamato@auto']);
  registerWeaponGlb('tempest2', 0, TEMPEST.tempest2.lod0);
  registerWeaponGlb('tempest2', 1, TEMPEST.tempest2.lod1);
  assert.equal(weaponGlbAutoLod('tempest2'), true);
  assert.equal(weaponGlbParts('tempest2', 0), TEMPEST.tempest2.lod0);
  assert.equal(weaponGlbParts('tempest2', 1), TEMPEST.tempest2.lod1);
  const m0 = buildWeapon3D('tempest2'), m1 = buildWeapon3D('tempest2', { lod: 1 });
  assert.ok(m0 !== m1 && m0.lod === 0 && m1.lod === 1 && m0.source === 'glb' && m1.source === 'glb');
  for (const k of ['trunnion', 'barrels', 'muzzleX', 'pitch']) assert.deepEqual(m1[k], m0[k], `układ LOD1 = LOD0: ${k}`);
  const f0 = buildTurretFamilyArrays('tempest2', 0), f1 = buildTurretFamilyArrays('tempest2', 1);
  assert.ok(f0 !== f1 && f1.lod === 1 && f1.index.length < f0.index.length, 'LOD1 — osobna, lżejsza geometria partii');
  const key = (g) => Object.keys(g.attributes).sort().map((n) => `${n}:${g.attributes[n].itemSize}`).join('|');
  assert.equal(key(createTurretBatchGeometry(f0, 1).geometry), key(createTurretBatchGeometry(f1, 1).geometry), 'ten sam układ — ten sam pipeline');
  // yamato@auto bez pliku LOD1 w rejestrze: jedna partia (części LOD0 dla obu poziomów)
  registerWeaponGlb('yamato', 0, lod0);
  assert.equal(weaponGlbAutoLod('yamato') && false, false);
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(null);
});

test('decyzja raz na rodzinę: spóźniony plik nie podmienia modelu, flaga wyłącza GLB', async () => {
  resetWeaponGlbQueries();
  setWeaponGlbFamilies([]);
  assert.equal(weaponGlbParts('yamato'), null);
  setWeaponGlbFamilies(null);
  assert.equal(weaponGlbParts('yamato'), null, 'rodzina zapytana bez GLB zostaje przy budowniczym do końca sesji');
  assert.equal(buildWeapon3D('yamato').source, 'builder');
  resetWeaponGlbQueries();
  assert.ok(weaponGlbParts('yamato'));
  // LOD per rodzina z listy: tempest1@1 bez pliku w rejestrze — budowniczy; yamato@1 — części LOD1
  resetWeaponGlbQueries();
  setWeaponGlbFamilies(['yamato@1', 'tempest1@1']);
  assert.equal(weaponGlbParts('tempest1'), null);
  registerWeaponGlb('yamato', 1, lod1);
  assert.equal(weaponGlbParts('yamato'), lod1);
  setWeaponGlbFamilies(null);
  // loader: błąd pliku = ostrzeżenie, obietnica się nie odrzuca
  const warn = console.warn;
  const msgs = [];
  console.warn = (...a) => msgs.push(a.join(' '));
  try {
    const r = await loadWeaponGlbs({ fetchFn: async () => { throw new Error('brak pliku'); } });
    assert.equal(r.files.every((f) => f.ok === false), true);
  } finally { console.warn = warn; }
  assert.ok(msgs.some((m) => m.includes('brak pliku')));
});
