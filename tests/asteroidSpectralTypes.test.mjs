// A1 (2026-10-12, docs/PLAN-pas-realizm.md § Typy): typy skał z widm planetoid — carbon (C),
// metal (M), basalt (V), primitive (D / P), platinum i wypełniacz węglowy rock_c. Tabele per typ
// kompletne, wygląd w obu kopiach rockMaterial (gra, demo) w kolejności ROCK_TYPES, surowce
// w resources.js, wydobycie nowych typów daje urobek, a materiał skał i minerały (nowe gałęzie
// programów powierzchni) budują się do WGSL w Node (atrapa banku — bez GPU).
// node --test tests/asteroidSpectralTypes.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = globalThis.window || {};
const ctx2d = new Proxy({}, {
  get(target, key) {
    if (key === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    if (key in target) return target[key];
    return () => {};
  },
  set(target, key, value) { target[key] = value; return true; }
});
globalThis.document = globalThis.document ?? { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const THREE = await import('three/webgpu');
const {
  ROCK_TYPES, ROCK_TYPE_INDEX: TI, ORE_ROCK_TYPES, ROCK_TYPE_LABELS_PL, ORE_TIER, FAMILY_WEIGHTS_BY_TYPE, ROCK_FAMILIES,
  SHAPE_COUNT, NEUTRAL_CARBON_TYPE, LATE_ORE_TYPES, isNeutralType, isNeutralTypeId
} = await import('../src/game/asteroidRockKinds.js');
const { SPECTRAL_ORE_TYPES, ASTEROID_TYPES } = await import('../src/data/asteroidTypes.js');
const { ASTEROID_MATERIAL } = await import('../src/data/asteroidPhysics.js');
const {
  rockMaterial, oreResourceOf, ROCK_FRACTURE, ROCK_COMPOSITION, CORE_MATERIAL
} = await import('../src/game/asteroidMaterials.js');
const { RESOURCES, ASTEROID_YIELD } = await import('../src/data/resources.js');
const gameRock = await import('../src/3d/asteroids/rockMaterial.js');
const demoRock = await import('../dema/asteroidy-webgpu/rockMaterial.js');
const gameMinerals = await import('../src/3d/asteroids/minerals.js');
const { CORE_LOOK } = await import('../dema/asteroidy-webgpu/coreLook.js');
const { LightGrid, GridLighting } = await import('../src/3d/fx/lightGrid.js');
const { getBeltMedium } = await import('../src/3d/asteroids/beltMedium.js');
const { AsteroidMining: MiningBase } = await import('../src/game/asteroidMining.js');

const SPECTRAL = ['carbon', 'metal', 'basalt', 'primitive', 'platinum'];
// Rudy z widm razem z dopisaną w A2 węglową z lodem (C z lodem w rdzeniach — rodzina Themis).
const SPECTRAL_ALL = [...SPECTRAL, 'carbon_ice'];
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('indeksy: dawne typy bez zmian, typy z widm 9–13, wypełniacz węglowy 14, węglowa z lodem 15', () => {
  assert.deepEqual(ASTEROID_TYPES, ['iron', 'copper', 'silicon', 'titan', 'crystal', 'ice', 'uran'], 'ASTEROID_TYPES (tekstury PNG) bez zmian');
  assert.deepEqual(SPECTRAL_ORE_TYPES, SPECTRAL);
  assert.equal(TI.rock, 7);
  assert.equal(TI.energy, 8);
  SPECTRAL.forEach((id, i) => assert.equal(TI[id], 9 + i, id));
  assert.equal(TI.rock_c, 14);
  assert.equal(NEUTRAL_CARBON_TYPE, 14);
  // A2: rudy dopisane po wypełniaczu (LATE_ORE_TYPES) — od 15, w ORE_ROCK_TYPES na końcu.
  assert.deepEqual(LATE_ORE_TYPES, ['carbon_ice']);
  assert.equal(TI.carbon_ice, 15);
  assert.equal(ROCK_TYPES.length, 16);
  assert.match(read('src/3d/asteroids/minerals.js'), /const key = shape \* 256 \+ type;/, 'klucz szablonu minerałów mieści typy');
  assert.ok(ROCK_TYPES.length < 256);
  assert.ok(isNeutralType(TI.rock) && isNeutralType(TI.rock_c) && !isNeutralType(TI.carbon) && !isNeutralType(TI.energy));
  assert.ok(isNeutralTypeId('rock') && isNeutralTypeId('rock_c') && !isNeutralTypeId('carbon'));
  assert.ok(!isNeutralType(TI.carbon_ice) && !isNeutralTypeId('carbon_ice'));
  assert.deepEqual(ORE_ROCK_TYPES, [...ASTEROID_TYPES, ...SPECTRAL, 'carbon_ice']);
});

test('tabele per typ kompletne: etykieta, szczebel, kształty, gęstość, pękanie, skład, rdzeń, surowiec', () => {
  for (const id of ROCK_TYPES) {
    assert.ok(ROCK_TYPE_LABELS_PL[id], `etykieta ${id}`);
    const w = FAMILY_WEIGHTS_BY_TYPE[id];
    assert.ok(w && w.length === ROCK_FAMILIES.length, `wagi rodzin ${id}`);
    assert.ok(ROCK_FRACTURE[id], `pękanie ${id}`);
  }
  for (const id of SPECTRAL_ALL) {
    assert.ok(Number.isFinite(ORE_TIER[id]), `szczebel ${id}`);
    assert.ok(ASTEROID_MATERIAL[id], `gęstość ${id}`);
    assert.ok(ROCK_COMPOSITION[id], `skład ${id}`);
    assert.ok(CORE_MATERIAL[id], `rdzeń ${id}`);
    const res = oreResourceOf(id);
    assert.ok(res && RESOURCES[res], `surowiec ${id} → ${res}`);
    assert.equal(ASTEROID_YIELD[id], res);
    assert.equal(rockMaterial(id).id, id);
  }
  // Rzeczywistość: C i D lekkie i porowate, M ciężka, V pośrodku; platynowce najwyższy szczebel.
  assert.ok(ASTEROID_MATERIAL.carbon.mass <= 1.5 && ASTEROID_MATERIAL.primitive.mass <= 1.5);
  assert.ok(ASTEROID_MATERIAL.metal.mass > ASTEROID_MATERIAL.basalt.mass && ASTEROID_MATERIAL.basalt.mass > ASTEROID_MATERIAL.carbon.mass);
  assert.equal(ORE_TIER.platinum, 2);
  assert.equal(CORE_MATERIAL.metal.kind, 'metal');
  assert.equal(CORE_MATERIAL.primitive.kind, 'ice');
  // Nowe surowce: carbon_ore, nickel_ore, platinum_ore; V i D dają istniejące (tytan, lód).
  assert.equal(oreResourceOf('carbon'), 'carbon_ore');
  assert.equal(oreResourceOf('metal'), 'nickel_ore');
  assert.equal(oreResourceOf('platinum'), 'platinum_ore');
  assert.equal(oreResourceOf('basalt'), 'titanium_ore');
  assert.equal(oreResourceOf('primitive'), 'ice');
  for (const k of ['carbon_ore', 'nickel_ore', 'platinum_ore']) assert.equal(RESOURCES[k].tier, 0, `${k}: surowiec T0`);
  // Węglowa z lodem: lekka i porowata jak C, rdzeń z lodu, urobek — lód (woda pasa głównego).
  assert.ok(ASTEROID_MATERIAL.carbon_ice.mass <= 1.5);
  assert.equal(CORE_MATERIAL.carbon_ice.kind, 'ice');
  assert.equal(oreResourceOf('carbon_ice'), 'ice');
  assert.equal(ORE_TIER.carbon_ice, 0);
  assert.deepEqual(FAMILY_WEIGHTS_BY_TYPE.carbon_ice, FAMILY_WEIGHTS_BY_TYPE.carbon, 'kształty jak C');
  // Wypełniacz węglowy = skała neutralna dla wydobycia (bez rudy, ukryty rdzeń jak skała).
  assert.equal(rockMaterial('rock_c').id, 'rock');
  assert.equal(rockMaterial(TI.rock_c).id, 'rock');
  assert.equal(oreResourceOf('rock_c'), null);
  assert.ok(rockMaterial('rock_c').density < rockMaterial('rock').density, 'węglowy lżejszy od kamiennego');
});

test('realistyczne typy nie świecą: GLOW_ROCK pasa bez nowych typów, wygląd bez emisji', () => {
  const src = read('src/3d/asteroids/asteroidBelt.js');
  const m = src.match(/const GLOW_ROCK = Object\.freeze\(\{([^\n]*)\}\);/);
  assert.ok(m, 'GLOW_ROCK');
  const keys = [...m[1].matchAll(/(\d+):/g)].map((x) => Number(x[1]));
  assert.deepEqual(keys, [TI.crystal, TI.uran, TI.energy]);
  for (const id of [...SPECTRAL_ALL, 'rock_c']) {
    const look = gameRock.ROCK_TYPE_LOOKS[TI[id]];
    assert.equal(look.emit, 0, `${id}: emisja`);
  }
});

test('wygląd: wiersz i = ROCK_TYPES[i] w obu kopiach, demo = gra; C i D ciemne, M i platynowce metal', () => {
  for (const looks of [gameRock.ROCK_TYPE_LOOKS, demoRock.ROCK_TYPE_LOOKS]) {
    assert.equal(looks.length, ROCK_TYPES.length);
    looks.forEach((L, i) => assert.equal(L.id, ROCK_TYPES[i], `wiersz ${i}`));
  }
  assert.deepEqual(demoRock.ROCK_TYPE_LOOKS, gameRock.ROCK_TYPE_LOOKS, 'kopia dema = gra');
  const lum = (hex) => {
    const v = parseInt(hex.slice(1), 16);
    return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
  };
  const L = (id) => gameRock.ROCK_TYPE_LOOKS[TI[id]];
  // Albedo: C ~0,04 i D ~0,05 ciemniejsze od S (krzem) i V (bazalt, ~0,35); rock_c ciemniejszy od rock.
  assert.ok(lum(L('carbon').base) < 0.6 * lum(L('silicon').base));
  assert.ok(lum(L('primitive').base) < 0.6 * lum(L('basalt').base));
  assert.ok(lum(L('rock_c').base) < 0.7 * lum(L('rock').base));
  assert.ok(lum(L('basalt').base) > lum(L('carbon').base) * 1.8);
  // D czerwonobrązowa (R > G > B).
  const p = parseInt(L('primitive').base.slice(1), 16);
  assert.ok(((p >> 16) & 255) > ((p >> 8) & 255) && ((p >> 8) & 255) > (p & 255));
  assert.equal(L('metal').metal, 1);
  assert.equal(L('platinum').metal, 1);
  assert.ok(lum(L('metal').a) > lum(L('iron').a), 'M jaśniejsza od żelaza');
  // Węglowa z lodem: ciemna jak C (Themis ~0,07), chłodniejsza (B ≥ R), szron niebieskawobiały (c);
  // siła szronu w bParam programu węglowej — węglowa bez szronu, bez prześwitu lodu (ice 0).
  assert.ok(lum(L('carbon_ice').base) < 0.6 * lum(L('silicon').base));
  const ci = parseInt(L('carbon_ice').base.slice(1), 16);
  assert.ok((ci & 255) >= ((ci >> 16) & 255), 'C z lodem: chłodny odcień');
  const fr = parseInt(L('carbon_ice').c.slice(1), 16);
  // (lum — luminancja w sRGB: 3× w sRGB ≈ 10× liniowo)
  assert.ok((fr & 255) > ((fr >> 16) & 255) && lum(L('carbon_ice').c) > 3 * lum(L('carbon_ice').base), 'szron jasny i niebieskawy');
  assert.equal(L('carbon').bParam, 0, 'węglowa bez szronu');
  assert.ok(L('carbon_ice').bParam > 0.5);
  assert.equal(L('carbon_ice').ice, 0);
  // Rdzenie w demie (coreLook.js) znają nowe typy.
  for (const id of [...SPECTRAL_ALL, 'rock_c']) assert.ok(CORE_LOOK[id], `CORE_LOOK ${id}`);
  assert.equal(CORE_LOOK.carbon_ice.kind, 'ice');
});

test('kopie dema: programy powierzchni typów z widm takie same jak w grze', () => {
  const branch = (src) => {
    const a = src.indexOf('If(type.equal(0)');
    const b = src.indexOf('}).Else(() => {', a);
    return src.slice(a, b).replace('S.strikeSurge(positionWorld', 'S.strikeSurge(V.localP');
  };
  assert.equal(branch(read('dema/asteroidy-webgpu/rockMaterial.js')), branch(read('src/3d/asteroids/rockMaterial.js')));
  for (const id of ['carbon', 'primitive']) assert.match(read('src/3d/asteroids/rockMaterial.js'), new RegExp(`ElseIf\\(type\\.equal\\(TI\\.${id}\\)`));
  // Węglowa z lodem: program węglowej (szron), minerały i optyka lodu.
  assert.match(read('src/3d/asteroids/rockMaterial.js'), /ElseIf\(type\.equal\(TI\.carbon\)\.or\(type\.equal\(TI\.carbon_ice\)\)/);
  assert.match(read('src/3d/asteroids/minerals.js'), /ElseIf\(type\.equal\(TI\.ice\)\.or\(type\.equal\(TI\.carbon_ice\)\)/);
  assert.ok(gameMinerals.MINERAL_TYPES.includes(TI.carbon_ice), 'minerały carbon_ice');
  const recipes = (src) => src.slice(src.indexOf('const MINERAL_RECIPES'), src.indexOf('});', src.indexOf('const MINERAL_RECIPES')))
    .split('\n').filter((l) => /^\s+\w+: \{ kind/.test(l)).join('\n');
  assert.equal(recipes(read('dema/asteroidy-webgpu/minerals.js')), recipes(read('src/3d/asteroids/minerals.js')));
  for (const id of ['carbon', 'basalt', 'metal', 'platinum']) assert.ok(gameMinerals.MINERAL_TYPES.includes(TI[id]), `minerały ${id}`);
});

// --- WGSL w Node: materiał skał (gra i tło) i minerały z nowymi gałęziami -----------------
const fakeBank = (() => {
  const mk = () => {
    const t = new THREE.DataArrayTexture(new Uint16Array(4 * 4 * 4 * SHAPE_COUNT), 4, 4, SHAPE_COUNT);
    t.type = THREE.HalfFloatType;
    return t;
  };
  return { size: 4, longAxis: new Float32Array(SHAPE_COUNT * 3), textureA: mk(), textureB: mk(), maxRadius: new Float32Array(SHAPE_COUNT).fill(1.2), radiusAt: () => 1 };
})();
const noise = new THREE.Storage3DTexture(8, 8, 8);
const grid = new LightGrid();
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const wgsl = new THREE.WebGPURenderer({ canvas });
wgsl.hasFeature = () => false;
wgsl.lighting = new GridLighting(grid, { mode: 'optIn' });
function buildMesh(mesh) {
  const b = wgsl.backend.createNodeBuilder(mesh, wgsl);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader };
}
const count = (s, re) => (s.match(re) || []).length;

test('WGSL: materiał skał (gra, tło) z gałęziami C / D / M / V i minerały budują się w limitach r183', () => {
  const shared = gameRock.createRockShared(fakeBank, noise);
  shared.volume = getBeltMedium();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 0, 0, 1, 0], 3));
  const inst = new THREE.InstancedInterleavedBuffer(new Float32Array(20), 20);
  for (const [name, off] of [['iPos', 0], ['iRot', 4], ['iSpin', 8], ['iShape', 12], ['iStretch', 16]]) {
    geo.setAttribute(name, new THREE.InterleavedBufferAttribute(inst, 4, off));
  }
  geo.setAttribute('aMip', new THREE.Float32BufferAttribute([0, 0, 0], 1));
  for (const backdrop of [false, true]) {
    const mat = new gameRock.RockNodeMaterial({ shared, backdrop });
    const { fragment } = buildMesh(new THREE.Mesh(geo, mat));
    assert.ok(fragment.length > 2000, `skały ${backdrop ? 'tła' : 'gry'}`);
    assert.ok(count(fragment, /var<uniform>/g) <= 12, `bufory uniform: ${count(fragment, /var<uniform>/g)}`);
    assert.doesNotMatch(fragment, /pow\(\s*-/);
    // Gałęzie typów z widm: porównania z indeksami 9–13 i 15 w kodzie fragmentu.
    for (const id of ['carbon', 'primitive', 'metal', 'platinum', 'basalt', 'carbon_ice']) {
      assert.match(fragment, new RegExp(`==\\s*(?:i32\\()?${TI[id]}\\b`), `gałąź ${id}`);
    }
  }
  // Smugi skał w skoku (warpDebris.js, 2026-10-19): wariant `smear` — rozciągnięcie w wierzchołkach, ogon z alfą;
  // zwykłe warstwy bez niego (ten sam WGSL co dawniej — bez varyingu smugi).
  const back = buildMesh(new THREE.Mesh(geo, new gameRock.RockNodeMaterial({ shared, backdrop: true })));
  assert.doesNotMatch(back.vertex, /vRockSmear/, 'zwykłe skały tła bez smugi');
  const smearMat = new gameRock.RockNodeMaterial({ shared, backdrop: true, smear: true });
  assert.equal(smearMat.transparent, true);
  assert.equal(smearMat.blending, THREE.NormalBlending);
  assert.equal(smearMat.depthWrite, false);
  const sm = buildMesh(new THREE.Mesh(geo, smearMat));
  assert.match(sm.vertex, /vRockSmear/, 'smuga: udział ogona w wierzchołku');
  assert.ok(count(sm.fragment, /var<uniform>/g) <= 12, `smuga: bufory uniform ${count(sm.fragment, /var<uniform>/g)}`);
  const layer = new gameRock.RockNodeMaterial({ shared });
  const mm = new gameMinerals.MineralMaterial({ shared, layer: layer.L, grid });
  const mgeo = new THREE.InstancedBufferGeometry();
  mgeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 0, 0, 1, 0], 3));
  mgeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  mgeo.setAttribute('aU', new THREE.Float32BufferAttribute([0, 0, 1], 1));
  mgeo.setAttribute('aBary', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  mgeo.setAttribute('aKind', new THREE.Float32BufferAttribute([0, 0, 0], 1));
  const minst = new THREE.InstancedInterleavedBuffer(new Float32Array(32), 32);
  ['iPos', 'iRot', 'iSpin', 'iShape', 'iStretch', 'mPos', 'mRot', 'mSize'].forEach((name, k) => {
    mgeo.setAttribute(name, new THREE.InterleavedBufferAttribute(minst, 4, k * 4));
  });
  const { fragment } = buildMesh(new THREE.Mesh(mgeo, mm));
  assert.ok(count(fragment, /var<uniform>/g) <= 12);
  for (const id of ['carbon', 'basalt', 'metal', 'carbon_ice']) assert.match(fragment, new RegExp(`==\\s*(?:i32\\()?${TI[id]}\\b`), `minerały: gałąź ${id}`);
});

// --- Wydobycie: nowe typy dają urobek do ładowni ----------------------------------------
class AsteroidMining extends MiningBase {
  constructor(o = {}) { super({ ...o, config: { rubble: false, ...(o.config || {}) } }); }
}
const rockRecord = (type, r, id = 4242) => ({
  id, x: 1000, y: 2000, r, d: 2 * r, shape: 3, type: TI[type],
  qx: 0, qy: 0, qz: 0, qw: 1, ax: 0, ay: 0, az: 1, spin: 0, phase: 0, sx: 1, sy: 1, sz: 1, seed: 0.37
});

test('wydobycie: skały z widm mają rdzeń i rudę swojego surowca, wypełniacz węglowy to skała neutralna', () => {
  const sys = new AsteroidMining({ radiusAt: () => 1 });
  for (const id of SPECTRAL_ALL) {
    const b = sys.activate(rockRecord(id, 360), { z: -500 });
    assert.equal(b.typeId, id);
    assert.equal(b.oreRes, oreResourceOf(id), `${id}: surowiec`);
    assert.ok(b.core, `${id}: rdzeń`);
    assert.ok(b.oreMass > 0 && b.oreMass < b.mass, `${id}: ruda ${b.oreMass.toFixed(1)} / ${b.mass.toFixed(1)} t`);
  }
  // M: dużo metalu (Psyche) — udział rudy wyższy niż w C; C lżejsza od M przy tym samym promieniu.
  const c = sys.activate(rockRecord('carbon', 360, 51), { z: -500 });
  const m = sys.activate(rockRecord('metal', 360, 52), { z: -500 });
  assert.ok(m.oreMass / m.mass > c.oreMass / c.mass, 'M bogatsza w rudę niż C');
  assert.ok(c.mass < 0.4 * m.mass, `C ${c.mass.toFixed(0)} t vs M ${m.mass.toFixed(0)} t`);
  // rock_c: bez rudy albo z ukrytym rdzeniem pospolitej rudy (jak skała neutralna).
  let plain = 0;
  for (let id = 1; id < 40; id++) {
    const n = sys.activate(rockRecord('rock_c', 200, 9000 + id), { z: -300 });
    assert.equal(n.typeId, 'rock_c');
    if (n.oreTypeId === null) { plain++; assert.equal(n.oreMass, 0); }
  }
  assert.ok(plain > 20, `wypełniacz węglowy zwykle bez rudy (${plain} / 39)`);
});
