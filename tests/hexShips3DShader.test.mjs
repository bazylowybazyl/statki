// Materiał kadłubów po porcie WebGPU (zadanie 04): graf TSL na wariant
// (src/3d/hexShips3D.tsl.js) zamiast HEX_FRAGMENT_SHADER / BEAM_SKIN_* / HEX_VERTEX /
// ARMOR_VERTEX. Odpowiedniki dawnych regexów GLSL: kolejność bloków w źródle grafu,
// WGSL zbudowany w Node (WGSLNodeBuilder bez GPU) i zachowanie węzłów per obiekt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { renderGroup } from 'three/tsl';
import {
  HULL_FLAT_NORMAL_TEXTURE, HULL_EMPTY_SPRITE_TEXTURE, HULL_LIGHT_SLOT_VEC4, HULL_LIGHT_ZONE_OFFSET, HULL_SHARED,
  HULL_TSL_INTERNALS, HullDebrisNodeMaterial, HullLightStore, HullNodeMaterial, heatRampCpu
} from '../src/3d/hexShips3D.tsl.js';
import { HullLacquer, MAX_ENGINE_ZONES } from '../src/3d/hullLacquer.js';
import { MAX_SHADER_SHIP_LIGHTS } from '../src/game/shipLightRuntime.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const tsl = read('src/3d/hexShips3D.tsl.js');
const source = read('src/3d/hexShips3D.js');

// WGSL w Node: renderer bez init (atrapa kanwy i limitów), budowa węzłów jak NodeManager.getForRender.
const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
const renderer = new THREE.WebGPURenderer({ canvas });
renderer.hasFeature = () => false;
renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
function buildWGSL(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  return { vertex: b.vertexShader, fragment: b.fragmentShader, updateNodes: b.updateNodes };
}

function spriteTexture() {
  const t = new THREE.Texture();
  t.image = { width: 64, height: 32 };
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function holders(overrides = {}) {
  return {
    uSprite: { value: spriteTexture() }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uHasNormalMap: { value: 0 },
    uSpriteSize: { value: new THREE.Vector2(64, 32) }, uLightDir: { value: new THREE.Vector3(0, 0, 1) },
    uRotation: { value: 0 }, uLodOpacity: { value: 1 }, uBillboardLighting: { value: 0 },
    uShipLightCount: { value: 0 }, uEngineZoneCount: { value: 0 }, uLightBase: { value: 0 },
    uShapeMap: HullLacquer.flatShapeUniform, uLacquerWeight: { value: 1 }, uLacquerGlint: { value: 1 },
    ...overrides
  };
}
function beamGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(4), 1));
  g.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
function hexGeometry(n = 2000) {
  const g = new THREE.CircleGeometry(20, 6);
  g.setAttribute('aGridPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('aStress', new THREE.InstancedBufferAttribute(new Float32Array(n), 1));
  g.setAttribute('aHeat', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
  return g;
}
const variantMesh = {
  beam: () => new THREE.Mesh(beamGeometry(), new HullNodeMaterial('beam', holders())),
  hex: () => { const m = new HullNodeMaterial('hex', holders()); return new THREE.InstancedMesh(hexGeometry(), m, 2000); },
  armor: () => new THREE.Mesh(new THREE.PlaneGeometry(64, 32), new HullNodeMaterial('armor', holders()))
};
const built = {};
for (const v of Object.keys(variantMesh)) built[v] = buildWGSL(variantMesh[v]());

test('graf na wariant: materiały kadłubów jednego wariantu mają ten sam klucz programu (jeden NodeBuilder)', () => {
  for (const v of ['beam', 'hex', 'armor']) {
    const a = new HullNodeMaterial(v, holders());
    const b = new HullNodeMaterial(v, holders({ uSprite: { value: spriteTexture() }, uLightDir: { value: new THREE.Vector3(1, 0, 0) } }));
    assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey(), `${v}: klucz zależy od encji`);
    // Te same węzły grafu (nie kopie) — budowa raz na wariant.
    assert.equal(a.fragmentNode, b.fragmentNode, v);
  }
  assert.notEqual(new HullNodeMaterial('beam', holders()).fragmentNode, new HullNodeMaterial('hex', holders()).fragmentNode);
  // Wartości per encja tylko w `uniforms` (obiekty) — pola-liczby materiału rozbiłyby klucz (0/1).
  assert.match(tsl, /this\.uniforms = uniforms;/);
  // Przezroczysty DoubleSide skóry belek w jednym przejściu (WebGL: ShaderMaterial, forceSinglePass).
  const beam = new HullNodeMaterial('beam', holders());
  assert.equal(beam.side, THREE.DoubleSide);
  assert.equal(beam.forceSinglePass, true);
  assert.equal(beam.transparent, true);
  assert.equal(beam.depthWrite, true);
  assert.equal(new HullNodeMaterial('hex', holders()).side, THREE.FrontSide);
});

test('WGSL kadłuba: tekstury per obiekt w liście aktualizacji, lampy w jednym buforze storage, ≤ 12 buforów uniformów', () => {
  for (const [v, r] of Object.entries(built)) {
    // Sprite, mapa normalnych i mapa kształtu lakieru — per obiekt (węzeł w updateNodes). Sprite
    // dwa razy: próbka zwykła i z jawnym poziomem mip (pas żaru brzegu warpa „Nurt”, zadanie 22) —
    // klon tego samego węzła, to samo wiązanie tekstury (liczba tekstur w WGSL bez zmian). Skóra belek:
    // maskowanie (src/3d/cloak/cloakTSL.js, 2026-10-04) — trzeci klon sprite'a (poświata brzegu) i mapa
    // normalnych z jawnym poziomem (szkło ukrytego kadłuba: węzeł i klon) — te same wiązania.
    const keys = r.updateNodes.filter((n) => n.hullKey).map((n) => n.hullKey).sort();
    // Oświetlenie v2 (2026-10-06): mapa powierzchni ze sprite'a — próbka główna (normalne, AO) i 7 próbek
    // reliefu samocienia (hullSelfShadow) — klony tego samego węzła, jedno wiązanie tekstury.
    const surface = Array(8).fill('uSurfaceMap');
    const expected = v === 'beam'
      ? ['uNormalMap', 'uNormalMap', 'uNormalMap', 'uShapeMap', 'uSprite', 'uSprite', 'uSprite', ...surface]
      : ['uNormalMap', 'uShapeMap', 'uSprite', 'uSprite', ...surface];
    assert.deepEqual(keys, expected, v);
    // Skóra belek: +1 wspólna tekstura — kafel szumu fxNoise poszarpanego brzegu rany (mapa ran, 18-C);
    // wszystkie warianty: +1 — mapa powierzchni (oświetlenie v2).
    const texLimit = v === 'beam' ? 8 : 7;
    assert.ok((r.fragment.match(/: texture_2d<f32>/g) || []).length <= texLimit, `${v}: bez nowego wiązania tekstury`);
    for (const stage of [r.vertex, r.fragment]) {
      assert.ok((stage.match(/var<uniform>/g) || []).length <= 12, `${v}: limit 12 buforów uniformów na etap`);
    }
    assert.match(r.fragment, /var<storage, read> hullLights\b/, `${v}: bufor lamp tylko do odczytu`);
    // Wspólne wartości (czas, strojenie, lakier) w grupie render — jeden zapis na klatkę.
    assert.match(r.fragment, /var<uniform> render : renderStruct/);
    // Lakier bez macierzy uv tekstury (mat3 per obiekt).
    assert.doesNotMatch(r.fragment, /mat3x3<f32>/, `${v}: macierz uv tekstury lakieru`);
  }
  // Ten sam graf zbudowany drugi raz = ten sam kod (moduł i pipeline GPU z cache).
  assert.equal(buildWGSL(variantMesh.beam()).fragment, built.beam.fragment);
});

test('hex fragment: piksel sprite\'a = uv × rozmiar sprite\'a, lampy czytane ze slotu (3 vec4 na lampę)', () => {
  assert.match(tsl, /const fragPx = spriteUV\.mul\(spriteSize\)\.toVar\(\);/);
  assert.match(tsl, /const k = base\.add\(i\.mul\(3\)\)\.toVar\(\);/);
  assert.match(tsl, /const base = int\(P\.uLightBase\)\.toVar\(\);/);
  assert.match(tsl, /lights\.element\(base\.add\(HULL_LIGHT_ZONE_OFFSET\)\.add\(i\)\)/);
  assert.equal(HULL_LIGHT_SLOT_VEC4, MAX_SHADER_SHIP_LIGHTS * 3 + MAX_ENGINE_ZONES);
  assert.equal(HULL_LIGHT_ZONE_OFFSET, MAX_SHADER_SHIP_LIGHTS * 3);
  // W WGSL pętla lamp kończy się na liczniku per kadłub: skóra belek — z bufora slotu (zadanie 23), heksy —
  // z uniformu obiektu.
  assert.match(built.beam.fragment, /for \( var i : i32 = 0; i < i32\( hullObjects\.value\[ \( \w+ \+ 11u \) \]\.x \); i \+\+ \)/);
  assert.match(built.hex.fragment, /for \( var i : i32 = 0; i < i32\( object\.\w+ \); i \+\+ \)/);
});

test('lakier stoi po isGlowing i przed pętlą świateł', () => {
  const glowing = tsl.indexOf('const isGlowing');
  const lacquer = tsl.indexOf('const lacquerW0');
  const lights = tsl.indexOf("Loop({ start: int(0), end: int(P.uShipLightCount)");
  assert.ok(glowing >= 0 && lacquer >= 0 && lights >= 0);
  // Niebieskawe odbicie przed isGlowing podbiłoby cały kadłub ×2,5.
  assert.ok(glowing < lacquer, 'lakier po isGlowing');
  // Lampy są emisyjne — lakier nie może ich przyciemniać.
  assert.ok(lacquer < lights, 'lakier przed światłami');
  // Niejednolity warunek „lacquerW > 0,001” z GLSL wybiera wynik (select), próbkowania i fwidth w jednolitym przepływie.
  assert.match(tsl, /finalColor\.assign\(select\(lacquerW\.greaterThan\(0\.001\), coated, finalColor\)\);/);
});

test('każdy wariant podaje offset fragmentu od początku mesha w kierunkach świata; środek statku z macierzy modelu', () => {
  // Dawne vWorldXY − vOriginXY: modelMatrix · (lokalnie, w = 0) — bez odejmowania dwóch pozycji ~7 mln j.
  assert.match(tsl, /const localWorldOf = \(localPos, world = modelWorldMatrix\) => varying\(world\.mul\(vec4\(localPos\.xy, 0\.0, 0\.0\)\)\.xy, 'vHullLocalWorld'\);/);
  // skóra belek: macierz świata z bufora slotu (zadanie 23) — ten sam iloczyn mat4 × vec4
  assert.match(built.beam.vertex, /vHullLocalWorld = \( mat4x4<f32>\( hullObjects\.value\[ \( \w+ \+ 4u \) \], hullObjects\.value\[ \( \w+ \+ 5u \) \], hullObjects\.value\[ \( \w+ \+ 6u \) \], hullObjects\.value\[ \( \w+ \+ 7u \) \] \) \* vec4<f32>\( position\.xy, 0\.0, 0\.0 \) \)\.xy;/);
  assert.match(built.armor.vertex, /vHullLocalWorld = \( object\.\w+ \* vec4<f32>\( position\.xy, 0\.0, 0\.0 \) \)\.xy;/);
  // Siatka heksów: pozycja PO instancjonowaniu (instanceMatrix · wierzchołek).
  const hv = built.hex.vertex;
  const inst = hv.indexOf('positionLocal = ( nodeVar0 * vec4<f32>( positionLocal, 1.0 ) ).xyz;');
  const lw = hv.search(/vHullLocalWorld = \( object\.\w+ \* vec4<f32>\( positionLocal\.xy, 0\.0, 0\.0 \) \)\.xy;/);
  assert.ok(inst >= 0 && lw > inst, 'offset heksa po instancjonowaniu');
  for (const r of Object.values(built)) assert.match(r.fragment, /\[ 3u \]\.xy/, 'środek statku = kolumna 3 macierzy modelu');
});

test('obłoki odbić są zakotwiczone w świecie i przesuwają się z pozycją statku', () => {
  // pozycja statku × drift + offset w kadłubie + wygięcie od R
  assert.match(tsl, /originXY\.mul\(L\.uLacquerD\.y\)\.add\(opts\.localWorld\)\.add\(R\.xy\.mul\(L\.uLacquerD\.z\.div\(max\(R\.z, 0\.05\)\)\)\)/);
  assert.match(tsl, /sampleShared\(L\.uLacquerSky, skyUV\)/);
});

test('lakier nie zależy od kamery: pion zamiast oka, odblask od „słońca odblasków”', () => {
  // Oko pseudo-perspektywy jechało z look-aheadem kamery — odblask pływał po kadłubie.
  assert.doesNotMatch(tsl, /uLacquerEye|cameraPosition/);
  for (const r of Object.values(built)) assert.doesNotMatch(r.fragment, /cameraPosition/);
  assert.match(tsl, /const NdotV = max\(N\.z, 0\.001\)/);
  // Słońce gry leży w płaszczyźnie; odblask liczy się od podniesionego (uLacquerC.w).
  assert.match(tsl, /const glintL = vec3\(sunXY\.mul\(cos\(L\.uLacquerC\.w\)\), sin\(L\.uLacquerC\.w\)\);/);
  assert.match(tsl, /dot\(R, glintL\)/);
  assert.doesNotMatch(source, /HullLacquer\.update\([^)]/, 'update() bez argumentów kamery');
});

test('materiał kadłuba czyta WSPÓLNE węzły lakieru; mapa kształtu per sprite w uniforms', () => {
  for (const name of ['uLacquerA', 'uLacquerB', 'uLacquerC', 'uLacquerD', 'uLacquerE']) {
    const node = HullLacquer.uniforms[name];
    assert.ok(node?.isNode && node.value?.isVector4, name);
    // Grupa render: jeden zapis na klatkę dla wszystkich kadłubów.
    assert.equal(node.groupNode, renderGroup, name);
  }
  for (const name of ['uLacquerEnv', 'uLacquerSky']) {
    const node = HullLacquer.uniforms[name];
    assert.ok(node?.isTextureNode && node.value?.isTexture, name);
    assert.equal(node.updateMatrix, false, `${name} bez macierzy uv`);
    // Zastępcza tekstura z filtrem liniowym — TSL wybiera ścieżkę próbkowania z tekstury przy budowie.
    assert.equal(node.value.minFilter, THREE.LinearFilter, name);
  }
  assert.match(source, /uShapeMap:\s*shapeUniform/);
  assert.match(source, /HullLacquer\.releaseShapeUniform\(data\.shapeImageRef\)/);
});

test('tekstura per obiekt: wartość z material.uniforms rysowanego obiektu, bez tekstury — zastępcza', () => {
  const { HullObjectTextureNode, PLACEHOLDER_SPRITE } = HULL_TSL_INTERNALS;
  const node = new HullObjectTextureNode(PLACEHOLDER_SPRITE, null);
  node.hullKey = 'uSprite';
  node.hullFallback = PLACEHOLDER_SPRITE;
  // TextureNode.setup nadpisuje updateType (NONE bez macierzy uv) — nasz zostaje OBJECT.
  node.updateType = THREE.NodeUpdateType.NONE;
  assert.equal(node.getUpdateType(), THREE.NodeUpdateType.OBJECT);
  const a = spriteTexture();
  const b = spriteTexture();
  node.update({ material: { uniforms: { uSprite: { value: a } } } });
  assert.equal(node.value, a);
  node.update({ material: { uniforms: { uSprite: { value: b } } } });
  assert.equal(node.value, b);
  node.update({ material: { uniforms: { uSprite: { value: null } } } });
  assert.equal(node.value, PLACEHOLDER_SPRITE, 'bez tekstury nie zostaje sprite poprzedniego kadłuba');
  // Zastępcze domyślne wartości materiału to inne obiekty niż zastępcze z budowy
  // (TextureNode skleja wiązania po uuid tekstury obecnej przy budowie).
  assert.notEqual(HULL_EMPTY_SPRITE_TEXTURE, PLACEHOLDER_SPRITE);
});

test('żar: rampa temperatury (lustro CPU) i jasność brzegu rany z HULL_SHARED per wariant', () => {
  assert.deepEqual(heatRampCpu(0).map((v) => +v.toFixed(3)), [0.55, 0.04, 0.01]);
  assert.deepEqual(heatRampCpu(1).map((v) => +v.toFixed(3)), [1, 0.93, 0.8]);
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (let h = 0.05; h <= 1.0; h += 0.05) assert.ok(lum(heatRampCpu(h)) >= lum(heatRampCpu(h - 0.05)) - 1e-9, `rampa monotoniczna przy ${h}`);
  // Jasność ~ 0,26h + 0,74h⁴ × szczyt; skóra belek i heksy mają osobne węzły (HULL_BODY_CONFIG / DESTRUCTOR_CONFIG).
  assert.match(tsl, /heatRamp\(heat\)\.mul\(opts\.heatPeak\.mul\(heat\.mul\(0\.26\)\.add\(heat2\.mul\(heat2\)\.mul\(0\.74\)\)\)\)/);
  assert.match(tsl, /heatPeak: HULL_SHARED\.beamHeatPeak/);
  assert.match(tsl, /heatPeak: HULL_SHARED\.hexHeatPeak/);
  assert.match(source, /shared\.beamHeatPeak\.value = tint \? Math\.max\(0, Number\(HullBodies\.config\.heatGlowPeak\) \|\| 0\) : 0\.0;/);
  assert.match(source, /shared\.hexHeatPeak\.value = tint \? Math\.max\(0, Number\(DESTRUCTOR_CONFIG\.heatGlowPeak\) \|\| 0\) : 0\.0;/);
  assert.ok(HULL_SHARED.uTime.isNode && HULL_SHARED.uTime.groupNode === renderGroup);
});

test('lampy: smoothstep z odwróconymi krawędziami liczony wzorem (WGSL nie gwarantuje builtinu przy low ≥ high)', () => {
  assert.match(tsl, /const core = smoothRev\(radiusPx, 0\.0, distPx\);/);
  assert.match(tsl, /const glow = smoothRev\(radiusPx\.mul\(mix\(7\.0, 9\.0, isNav\)\), 0\.0, distPx\);/);
  assert.doesNotMatch(built.beam.fragment, /smoothstep\( [^,()]+, 0\.0, /, 'builtin smoothstep z krawędzią 0 na końcu');
});

test('HullLightStore: slot na kadłub, zapis zakresów tylko zmienionych lamp i stref, jedna wersja na klatkę', () => {
  HullLightStore._ensure();
  const attr = HullLightStore.attribute;
  attr.clearUpdateRanges();
  const slot = HullLightStore.acquire();
  assert.ok(slot >= 0);
  const v0 = attr.version;
  HullLightStore.markDirty(slot, 0, 2 * 3);
  HullLightStore.markDirty(slot, HULL_LIGHT_ZONE_OFFSET, 4);
  assert.deepEqual(attr.updateRanges.slice(-2), [
    { start: slot * HULL_LIGHT_SLOT_VEC4 * 4, count: 24 },
    { start: (slot * HULL_LIGHT_SLOT_VEC4 + HULL_LIGHT_ZONE_OFFSET) * 4, count: 16 }
  ]);
  HullLightStore.commit();
  HullLightStore.commit();
  assert.equal(attr.version, v0 + 1, 'jedna wersja atrybutu na klatkę');
  HullLightStore.release(slot);
  assert.equal(HullLightStore.acquire(), slot, 'zwolniony slot wraca do puli');
  HullLightStore.release(slot);
  attr.clearUpdateRanges();
});

// Bufory wierzchołków pipeline'u tak, jak liczy je three (RenderObject.getVertexBuffers):
// atrybut nieprzeplatany = bufor, przeplatane = jeden bufor na InterleavedBuffer.
function vertexBufferCount(mesh) {
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mesh.material;
  b.scene = new THREE.Scene();
  b.camera = new THREE.OrthographicCamera();
  b.context.material = mesh.material;
  b.build();
  const buffers = new Set();
  for (const na of [...b.attributes, ...(b.bufferAttributes || [])]) {
    const attr = na.node?.attribute || mesh.geometry.getAttribute(na.name);
    buffers.add(attr?.isInterleavedBufferAttribute ? attr.data : (attr || na.name));
  }
  return buffers.size;
}

test('każdy materiał kadłubowy mieści się w 8 buforach wierzchołków (maxVertexBuffers WebGPU, także w adapterze)', async () => {
  // Z dziewięcioma pipeline nie powstaje, a three r183 połyka GPUPipelineError z
  // createRenderPipelineAsync — obiekt po cichu przestaje się rysować (odłamki belek, zadanie 04).
  const limit = 8;
  assert.ok(vertexBufferCount(variantMesh.beam()) <= limit, 'skóra belek');
  assert.ok(vertexBufferCount(variantMesh.hex()) <= limit, 'siatka heksów (z macierzą instancji)');
  assert.ok(vertexBufferCount(variantMesh.armor()) <= limit, 'płyta pancerza');
  const g = new THREE.CircleGeometry(25, 6);
  for (const [n, s] of [['aStartPos', 2], ['aStartVel', 2], ['aRotationData', 3], ['aTimeData', 2], ['aGridPos', 2], ['aHeat', 1]]) {
    g.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(10000 * s), s));
  }
  const debris = new HullDebrisNodeMaterial({ uSprite: { value: spriteTexture() }, uSpriteSize: { value: new THREE.Vector2(64, 32) },
    uTime: { value: 0 }, uLightDir: { value: new THREE.Vector3(0, 0, 1) }, uDayAmbient: { value: 0.24 }, uDayDiffuseMul: { value: 1.18 } });
  // Bez instancjonowania three (macierz instancji i normalne byłyby martwe, a dają +2 bufory).
  assert.ok(vertexBufferCount(new THREE.InstancedMesh(g, debris, 10000)) <= limit, 'pula szczątków GPU');
  const { Core3D } = await import('../src/3d/core3d.js');
  const prevScene = Core3D.scene;
  const prevInit = Core3D.isInitialized;
  Core3D.scene = new THREE.Scene();
  Core3D.isInitialized = true;
  try {
    const { HullDebris3D } = await import('../src/3d/hullDebris3D.js');
    HullDebris3D.ensure();
    for (const batch of HullDebris3D.batches) assert.ok(vertexBufferCount(batch.mesh) <= limit, `odłamki belek: ${batch.kind}`);
    HullDebris3D.dispose();
    const { HexBodyImpostorBatch } = await import('../src/3d/hexBodyImpostorBatch.js');
    HexBodyImpostorBatch.pushRaw(0, 0, 0, 10, 5, 0.5, 0.5, 0.5, 1);
    const impostor = Core3D.scene.children.find((o) => o.material?.name === 'hull:impostor');
    assert.ok(impostor && vertexBufferCount(impostor) <= limit, 'smugi wraków');
    HexBodyImpostorBatch.dispose();
  } finally {
    Core3D.scene = prevScene;
    Core3D.isInitialized = prevInit;
  }
});

test('pula szczątków GPU: graf wspólny dla pul, przezroczysty, bez głębi, DoubleSide w jednym przejściu', () => {
  const u = () => ({ uSprite: { value: spriteTexture() }, uSpriteSize: { value: new THREE.Vector2(64, 32) }, uTime: { value: 0 },
    uLightDir: { value: new THREE.Vector3(0, 0, 1) }, uDayAmbient: { value: 0.24 }, uDayDiffuseMul: { value: 1.18 } });
  const a = new HullDebrisNodeMaterial(u());
  const b = new HullDebrisNodeMaterial(u());
  assert.equal(a.fragmentNode, b.fragmentNode);
  assert.equal(a.customProgramCacheKey(), b.customProgramCacheKey());
  assert.equal(a.depthTest, false);
  assert.equal(a.depthWrite, false);
  assert.equal(a.forceSinglePass, true);
  const g = new THREE.CircleGeometry(25, 6);
  for (const [n, s] of [['aStartPos', 2], ['aStartVel', 2], ['aRotationData', 3], ['aTimeData', 2], ['aGridPos', 2], ['aHeat', 1]]) {
    g.setAttribute(n, new THREE.InstancedBufferAttribute(new Float32Array(100 * s), s));
  }
  const r = buildWGSL(new THREE.InstancedMesh(g, a, 100));
  // Martwy odłamek poza obcięciem (vec4(2, 2, 2, 1) z GLSL), pozycja świata przez modelViewMatrix.
  assert.match(r.vertex, /vec4<f32>\( 2\.0, 2\.0, 2\.0, 1\.0 \)/);
  assert.deepEqual(r.updateNodes.filter((n) => n.hullKey).map((n) => n.hullKey), ['uSprite']);
});

// Zadanie 23 (duża bitwa: ~23 µs CPU na rysunek kadłuba w three r183 — wiązania i ~20 węzłów OBJECT):
// wszystko, co zmienia się per kadłub skóry belek, leży w buforze storage slotu (HullObjectStore) —
// macierz model-widok liczona jak highpModelViewMatrix three (double na CPU, float32 w buforze), macierz
// świata i 17 wartości z material.uniforms; w grupie „object” tylko numer slotu (stały).
test('skóra belek: dane per kadłub w buforze slotu — w grupie „object” sam slot, pozycja jak three', async () => {
  const { HullObjectStore, HULL_OBJECT_SLOT_VEC4 } = await import('../src/3d/hexShips3D.tsl.js');
  const b = built.beam;
  const objStruct = (b.vertex.match(/struct objectStruct \{[\s\S]*?\}/) || [''])[0];
  assert.doesNotMatch(objStruct, /mat4x4|mat3x3/, 'bez macierzy modelu w uniformach obiektu');
  // węzły OBJECT poza teksturami per kadłub (sprite, normalne, kształt lakieru — hullKey)
  const objNodes = b.updateNodes.filter((n) => n.isUniformNode && !n.hullKey && n.updateType === THREE.NodeUpdateType.OBJECT);
  assert.equal(objNodes.length, 1, 'jeden węzeł OBJECT (slot) zamiast ~20');
  const oldObj = built.armor.updateNodes.filter((n) => n.isUniformNode && !n.hullKey && n.updateType === THREE.NodeUpdateType.OBJECT);
  assert.ok(oldObj.length >= 10, `płyta pancerza dalej na uniformach obiektu (${oldObj.length})`);
  assert.match(b.vertex, /var<storage, read> hullObjects\b/);
  // positionView = MV slotu × vec4(positionLocal, 1) (jak modelViewMatrix × positionLocal), klip jak three
  assert.match(b.vertex, /v_positionView = \( mat4x4<f32>\( hullObjects\.value\[ \( \w+ \+ 0u \) \], hullObjects\.value\[ \( \w+ \+ 1u \) \], hullObjects\.value\[ \( \w+ \+ 2u \) \], hullObjects\.value\[ \( \w+ \+ 3u \) \] \) \* vec4<f32>\( positionLocal, 1\.0 \) \)\.xyz;/);
  assert.match(b.vertex, /= \( render\.cameraProjectionMatrix \* vec4<f32>\( varyings\.v_positionView, 1\.0 \) \);/);
  // płyta pancerza i heksy bez zmian (uniformy obiektu)
  assert.match((built.armor.vertex.match(/struct objectStruct \{[\s\S]*?\}/) || [''])[0], /mat4x4/);

  // commit: te same liczby co three (Float32 z Matrix4.multiplyMatrices), zakres slotów do wysyłki
  const mat = new HullNodeMaterial('beam', holders({ uHullSlot: { value: 0 }, uRotation: { value: 0.75 }, uLightBase: { value: 42 },
    uDmgSlot: { value: new THREE.Vector4(5, 6, 7, 1) }, uDmgWorld: { value: new THREE.Vector2(900, 400) }, uGridOwner: { value: 3 },
    uWarpA: { value: new THREE.Vector4(1, 2, 3, 4) }, uWarpB: { value: new THREE.Vector4(5, 6, 7, 8) }, uWarpC: { value: new THREE.Vector4(9, 10, 11, 12) } }));
  const mesh = new THREE.Mesh(beamGeometry(), mat);
  const scene = new THREE.Scene();
  scene.add(mesh);
  mesh.position.set(7075238.77, -6289731.51, 0);
  mesh.rotation.set(0, 0, -1.234);
  scene.updateMatrixWorld();
  const cam = new THREE.OrthographicCamera(-960, 960, 540, -540, 0.1, 5000);
  cam.position.set(7075100.25, -6289650.5, 1000);
  const slot = HullObjectStore.acquire(mesh);
  assert.ok(slot >= 1, 'slot 0 zarezerwowany (zera)');
  mat.uniforms.uHullSlot.value = slot;
  assert.equal(HullObjectStore.commit(cam), 1);
  const A = HullObjectStore.attribute.array;
  const o = slot * HULL_OBJECT_SLOT_VEC4 * 4;
  const mv = new THREE.Matrix4().multiplyMatrices(cam.matrixWorldInverse, mesh.matrixWorld);
  assert.deepEqual(Array.from(A.subarray(o, o + 16)), Array.from(new Float32Array(mv.elements)), 'MV jak highpModelViewMatrix three');
  assert.deepEqual(Array.from(A.subarray(o + 16, o + 32)), Array.from(new Float32Array(mesh.matrixWorld.elements)), 'macierz świata');
  assert.equal(A[o + 33], Math.fround(0.75));
  assert.equal(A[o + 46], 42);
  assert.deepEqual(Array.from(A.subarray(o + 48, o + 53)), [5, 6, 7, 1, 3]);
  assert.deepEqual(Array.from(A.subarray(o + 56, o + 68)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const r = HullObjectStore.attribute.updateRanges[0];
  assert.ok(r && r.start <= o && r.start + r.count >= o + HULL_OBJECT_SLOT_VEC4 * 4, 'zakres wysyłki obejmuje slot');
  // niewidoczny — bez zapisu; zwolniony slot wraca do puli
  mesh.visible = false;
  assert.equal(HullObjectStore.commit(cam), 0);
  HullObjectStore.release(slot);
  assert.equal(HullObjectStore.acquire(new THREE.Mesh()), slot, 'slot ponownie użyty');
  HullObjectStore.release(slot);
  // klej: slot przy tworzeniu skóry, zwolnienie z materiałem, zapis przed passem ortho
  assert.match(source, /material\.uniforms\.uHullSlot\.value = HullObjectStore\.acquire\(mesh\);/);
  assert.match(source, /HullObjectStore\.release\(hullSlot\.value\);/);
  assert.match(source, /Core3D\.addPassHook\('ortho', \(camera\) => \{ HullObjectStore\.commit\(camera\); \}\);/);
  const core = read('src/3d/core3d.js');
  assert.match(core, /const hooks = this\._passHooks \? this\._passHooks\[pass\.name\] : null;\n\s*if \(hooks\) for \(let i = 0; i < hooks\.length; i\+\+\) hooks\[i\]\(camera, pass\);[\s\S]{0,200}?renderer\.render\(this\.scene, camera\);/);
});
