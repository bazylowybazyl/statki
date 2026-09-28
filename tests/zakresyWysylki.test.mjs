// Zadanie 23 portu WebGPU: wysyłka zmienionego wycinka atrybutu bez DynamicDrawUsage i bez gubienia
// zakresów (src/3d/zakresyWysylki.js). three r183 wysyła atrybut z DynamicDrawUsage w CAŁOŚCI przy
// każdym renderze, który rysuje siatkę — skóra kadłubów belkowych, odłamki kadłubów i bryły dachu
// ringu wysyłały po kilka MB na klatkę, choć kod liczył zakresy zmian. Tu: zakres ZBIERANY do wysyłki
// (siatka nierysowana w klatce zmiany nie gubi jej przy następnej zmianie), bez alokacji na klatkę.
// node --test tests/zakresyWysylki.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { zbierzZakres, zbierzCaly } from '../src/3d/zakresyWysylki.js';

const code = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// Wysyłka jak WebGPUAttributeUtils.updateAttribute three r183: zakresy albo cały bufor, potem clearUpdateRanges.
function wyslij(attr) {
  const out = attr.updateRanges.length ? attr.updateRanges.map((r) => [r.start, r.count]) : [[0, attr.array.length]];
  if (attr.updateRanges.length) attr.clearUpdateRanges();
  return out;
}

test('zakres zbiera zmiany do wysyłki (siatka nierysowana w klatce zmiany), następna zmiana zbiera od nowa', () => {
  const attr = new THREE.BufferAttribute(new Float32Array(100), 1);
  const v0 = attr.version;
  zbierzZakres(attr, 10, 5);
  assert.equal(attr.version, v0 + 1, 'needsUpdate');
  zbierzZakres(attr, 40, 4); // druga zmiana przed wysyłką (siatka poza kadrem w poprzedniej klatce)
  assert.deepEqual(wyslij(attr), [[10, 34]], 'suma przedziałów — pierwsza zmiana nie ginie');
  assert.equal(attr.__zakres.pending, false, 'po wysyłce: wysłane');
  zbierzZakres(attr, 70, 3);
  assert.deepEqual(wyslij(attr), [[70, 3]], 'po wysyłce zakres od nowa');
  const v1 = attr.version;
  zbierzZakres(attr, 0, 0);
  assert.equal(attr.version, v1, 'pusty zakres — bez wysyłki');
  zbierzCaly(attr);
  assert.deepEqual(wyslij(attr), [[0, 100]]);
  // bez alokacji: ten sam obiekt zakresu
  zbierzZakres(attr, 5, 1);
  const r = attr.updateRanges[0];
  wyslij(attr);
  zbierzZakres(attr, 6, 1);
  assert.equal(attr.updateRanges[0], r, 'obiekt zakresu wielokrotnego użytku');
});

test('bufor z przeplotem (bryły dachu ringu): każdy atrybut bufora wysyła ten sam wycinek, nie cały bufor', () => {
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(64), 16);
  zbierzZakres(buf, 0, 32);
  zbierzZakres(buf, 0, 16);
  // three r183: wersja pilnowana per InterleavedBufferAttribute (iPos, iSize, iQuat) — trzy wysyłki po jednej zmianie
  assert.deepEqual([wyslij(buf), wyslij(buf), wyslij(buf)], [[[0, 32]], [[0, 32]], [[0, 32]]], 'kolejne atrybuty bez pełnej wysyłki');
  zbierzZakres(buf, 48, 16);
  assert.deepEqual(wyslij(buf), [[48, 16]], 'następna zmiana — zakres od nowa');
});

test('skóra kadłubów, odłamki i bryły dachu ringu: bez DynamicDrawUsage, zmiany przez zbierzZakres', () => {
  const skin = code('src/3d/hexShips3D.js');
  const rebuild = skin.slice(skin.indexOf('function rebuildBeamSkinGeometry('), skin.indexOf('function setBeamSkinHeatClock('));
  assert.doesNotMatch(rebuild, /DynamicDrawUsage/, 'skóra kadłuba belkowego bez DynamicDrawUsage');
  const upd = skin.slice(skin.indexOf('function updateBeamSkinGeometry('), skin.indexOf('function updateBeamSkinMesh('));
  assert.match(upd, /zbierzZakres\(position, range\.min \* 12, quads \* 12\);/);
  assert.match(upd, /zbierzCaly\(position\);/);
  assert.doesNotMatch(upd, /needsUpdate = true|setAttrUpdateRange/, 'wszystkie ścieżki zapisu przez zbierany zakres');
  const debris = code('src/3d/hullDebris3D.js');
  assert.doesNotMatch(debris, /DynamicDrawUsage|addUpdateRange|clearUpdateRanges/);
  assert.match(debris, /zbierzZakres\(attr, batch\.dirtyMin \* width,/);
  const mega = code('src/3d/haloRing/haloRingMegastructure.js');
  assert.doesNotMatch(mega, /DynamicDrawUsage|addUpdateRange|clearUpdateRanges/);
  assert.match(mega, /zbierzZakres\(inst\.buf, 0, o\);/);
  assert.match(mega, /zbierzZakres\(L\.buf, 0, o\);/);
});

// Ścieżka three r183 bez atrap logiki: Attributes.update (wersja per atrybut, DynamicDrawUsage) +
// WebGPUAttributeUtils.updateAttribute (zakresy albo cały bufor, potem clearUpdateRanges) na urządzeniu-atrapie,
// które tylko liczy wysłane bajty.
test('three r183 (Attributes + WebGPUAttributeUtils): wysyłka tylko zakresu, także dla każdego atrybutu bufora z przeplotem', async () => {
  const { default: Attributes } = await import('three/src/renderers/common/Attributes.js');
  const { default: WebGPUAttributeUtils } = await import('three/src/renderers/webgpu/utils/WebGPUAttributeUtils.js');
  const { AttributeType } = await import('three/src/renderers/common/Constants.js');
  const data = new WeakMap();
  let bytes = 0;
  const backend = {
    get: (o) => { let d = data.get(o); if (!d) data.set(o, (d = {})); return d; },
    device: { queue: { writeBuffer: (buf, off, arr, dataOff = 0, size) => { bytes += (size ?? (arr.length - dataOff)) * (arr.BYTES_PER_ELEMENT || 1); } } }
  };
  const utils = new WebGPUAttributeUtils(backend);
  backend.createAttribute = (a) => { backend.get(utils._getBufferAttribute(a)).buffer = {}; };
  backend.updateAttribute = (a) => utils.updateAttribute(a);
  const attrs = new Attributes(backend);
  const draw = (list) => { for (const a of list) attrs.update(a, AttributeType.VERTEX); };

  // skóra kadłuba: 4000 floatów, zmiana 12 floatów
  const skin = new THREE.BufferAttribute(new Float32Array(4000), 3);
  draw([skin]);
  bytes = 0;
  zbierzZakres(skin, 120, 12);
  draw([skin]); draw([skin]); // dwa rendery w klatce (np. pass cienia i ortho)
  assert.equal(bytes, 12 * 4, 'tylko zmieniony wycinek, raz');
  bytes = 0;
  draw([skin]);
  assert.equal(bytes, 0, 'bez zmiany — bez wysyłki');
  // dawniej: DynamicDrawUsage — cały bufor przy każdym renderze
  const dyn = new THREE.BufferAttribute(new Float32Array(4000), 3).setUsage(THREE.DynamicDrawUsage);
  draw([dyn]);
  bytes = 0;
  draw([dyn]); draw([dyn]);
  assert.equal(bytes, 2 * 4000 * 4, 'DynamicDrawUsage: pełny bufor na render (stan sprzed zadania 23)');

  // bryły dachu: bufor z przeplotem, 3 atrybuty
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(16 * 500), 16);
  const ia = [0, 4, 8].map((o) => new THREE.InterleavedBufferAttribute(buf, 4, o));
  draw(ia);
  bytes = 0;
  zbierzZakres(buf, 0, 16 * 10);
  draw(ia);
  assert.equal(bytes, 3 * 16 * 10 * 4, 'każdy z 3 atrybutów wysyła ten sam wycinek (nie cały bufor)');
});
