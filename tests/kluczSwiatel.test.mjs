// Zadanie 23 portu WebGPU (duża bitwa): klucz węzła świateł pamiętany z podpisem (src/3d/tsl/kluczSwiatel.js).
// three r183 liczy `lightsNode.getCacheKey(true)` przy każdym renderer.render() (~10–15 µs: przejście przez
// węzły-proxy TSL) — 12 passów bloomu i post na tym samym pustym węźle. Pamiętany klucz musi być TYM SAMYM
// kluczem co wymuszone przeliczenie three dla każdego stanu świateł. Bez GPU.
// node --test tests/kluczSwiatel.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { zainstalujKluczSwiatel, kluczSwiatelOryginal, statKluczSwiatel } from '../src/3d/tsl/kluczSwiatel.js';

zainstalujKluczSwiatel();
const ref = (node) => kluczSwiatelOryginal.call(node, true, null);

test('klucz pamiętany = wymuszony klucz three dla każdego stanu świateł', () => {
  const node = new THREE.LightsNode();
  const k0 = node.getCacheKey(true);
  assert.equal(k0, ref(node), 'pusty węzeł (post, bloom)');
  const sun = new THREE.DirectionalLight();
  const amb = new THREE.AmbientLight();
  node.setLights([sun, amb]);
  const k1 = node.getCacheKey(true);
  assert.equal(k1, ref(node));
  assert.notEqual(k1, k0, 'nowe światła — nowy klucz');
  sun.castShadow = true;
  const k2 = node.getCacheKey(true);
  assert.equal(k2, ref(node));
  assert.notEqual(k2, k1, 'castShadow w kluczu');
  const spot = new THREE.SpotLight();
  spot.map = new THREE.Texture();
  node.setLights([sun, amb, spot]);
  const k3 = node.getCacheKey(true);
  assert.equal(k3, ref(node));
  spot.map = new THREE.Texture();
  const k4 = node.getCacheKey(true);
  assert.equal(k4, ref(node));
  assert.notEqual(k4, k3, 'mapa reflektora w kluczu');
  node.setLights([sun, amb]);
  assert.equal(node.getCacheKey(true), k2, 'powrót do tego samego zestawu — ten sam klucz');
  node.setLights([]);
  assert.equal(node.getCacheKey(true), k0);
  // nowa tablica z tymi samymi światłami (RenderList.finish podaje swoją) — klucz z pamięci
  node.setLights([sun, amb]);
  node.getCacheKey(true);
  const przed = { ...statKluczSwiatel };
  node.setLights([sun, amb]);
  assert.equal(node.getCacheKey(true), k2);
  assert.equal(statKluczSwiatel.zPamieci, przed.zPamieci + 1, 'bez przeliczenia');
  assert.equal(statKluczSwiatel.przeliczenia, przed.przeliczenia);
});

test('skutki uboczne jak po wymuszonym przeliczeniu; ignores i obce dzieci — ścieżka three', () => {
  const node = new THREE.LightsNode();
  node.setLights([new THREE.DirectionalLight()]);
  const k = node.getCacheKey(true);
  node._cacheKey = 123;
  node._cacheKeyVersion = -1;
  assert.equal(node.getCacheKey(true), k);
  assert.equal(node._cacheKey, k);
  assert.equal(node._cacheKeyVersion, node.version);
  // wywołanie z ignores (przejście klucza z zewnątrz) — oryginał
  const przed = statKluczSwiatel.oryginal;
  node.getCacheKey(true, new Set());
  assert.equal(statKluczSwiatel.oryginal, przed + 1);
  // ktoś dopisał węzeł do LightsNode — klucz three (z tym węzłem), bez pamięci
  const extra = new THREE.LightsNode();
  extra.dodatek = new THREE.ConstNode(1);
  assert.equal(extra.getCacheKey(true), ref(extra));
  assert.equal(statKluczSwiatel.oryginal, przed + 2);
});

test('Core3D instaluje klucz przy tworzeniu renderera', () => {
  const src = readFileSync(new URL('../src/3d/core3d.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ zainstalujKluczSwiatel \} from '\.\/tsl\/kluczSwiatel\.js';/);
  assert.match(src, /zainstalujKluczSwiatel\(\);/);
});
