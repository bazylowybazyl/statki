// Rozdarcia kadłubów belkowych (2026-09-29): poszarpany brzeg dziur zamiast kwadratowych rogów siatki.
//  - skóra (src/3d/beamHullSkin.js): rozdarcie narożnika czworokąta z liczby martwych komórek / zerwanych
//    belek, które go dzielą (HULL_SKIN_TEAR) — materiał partii wycina nim poszarpany pas przy brzegu
//    (hexShips3D.tsl.js, hullTearFray; WGSL budowany w Node);
//  - mapa ran (src/3d/hullDamageMap.js): węzeł zniszczony POZA trafieniem broni (hak HullBodies.onNodeLost —
//    zderzenie, zgniot, cięcie, rozpad) stempluje rozdarcie `tear` z dziurą ~1 komórki (osmalony, poszarpany
//    brzeg jak po broni); trafienia broni zostają przy haku krateru;
//  - rów przebicia Mjolnira (src/game/hullCraters.js trenchCraters): kratery na znakach rzazu, cofnięte o
//    swój promień — dziura wzdłuż całej drogi w materiale.
// node --test tests/hullTear.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || {};
window.wrecks = [];
const THREE = await import('three/webgpu');
const { HullBodies } = await import('../src/game/hullBodies.js');
const { buildHullSkinTopology, writeHullSkin, HULL_SKIN_TEAR } = await import('../src/3d/beamHullSkin.js');
const M = await import('../src/3d/hullDamageMap.js');
const S = await import('../src/3d/hullDamageStamps.js');
const { HullDamageMap } = M;
const { HullNodeMaterial, HULL_FLAT_NORMAL_TEXTURE, HULL_TEAR_FRAY } = await import('../src/3d/hexShips3D.tsl.js');
const { HullLacquer } = await import('../src/3d/hullLacquer.js');
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { createShot, flyShot } = await import('./helpers/hullFlight.mjs');

const close = (a, b, tol, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} != ${b} (±${tol})`);

function plate(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 140; data[i * 4 + 1] = 150; data[i * 4 + 2] = 160; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
const npcAt = (x, y) => ({ x, y, vx: 0, vy: 0, angle: 0, angVel: 0, mass: 5000, dead: false, isWreck: false, hpLost: 0 });

const SF = M.DMG_STAMP_FLOATS;
function lastStamp(slot) {
  const i = HullDamageMap._qCount - 1;
  const Q = HullDamageMap._qData, o = i * SF;
  return {
    r: Q[o + 2] * slot.worldH, cut: Q[o + 3], heat: Q[o + 4], scorch: Q[o + 5], rim: Q[o + 6], ion: Q[o + 7],
    hole: Q[o + 12] * slot.worldH
  };
}
function fresh() {
  HullDamageMap.reset();
  HullDamageMap.frame = 10;
  for (const s of HullDamageMap.slots) { s.dx0 = 1; s.dy0 = 1; s.dx1 = 0; s.dy1 = 0; }
}

test('skóra: rozdarcie narożników przy martwym węźle (0,5 / 0,75 / 1 z liczby martwych komórek), głąb blachy 0', () => {
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(300, 150));
  try {
    const body = e.beamHull.body;
    const s = body.nodeStore;
    const topo = buildHullSkinTopology(body);
    const n = topo.count * 4;
    const pos = new Float32Array(n * 3), shade = new Float32Array(n), heat = new Float32Array(n * 2), tear = new Float32Array(n);
    writeHullSkin(body, topo, pos, shade, heat, tear);
    assert.ok(tear.every((t) => t === 0), 'cały kadłub: bez rozdarć');
    // Węzeł najbliżej środka płyty zniszczony cięciem (bez broni).
    const alive = Uint8Array.from(s.active.subarray(0, s.count));
    assert.equal(HullBodies.cutNearest(e, e.x, e.y, 1), 1);
    let mid = -1;
    for (let i = 0; i < s.count; i++) if (alive[i] && !s.active[i]) mid = i;
    assert.ok(mid >= 0, 'węzeł środka zniszczony');
    writeHullSkin(body, topo, pos, shade, heat, tear);
    for (let k = 0; k < 4; k++) assert.equal(tear[mid * 4 + k], 0, 'martwy węzeł: czworokąt zwinięty, bez rozdarcia');
    // Sąsiedzi przez bok: dwa narożniki dzielą martwą komórkę (0,5), dwa — nie (0).
    const side = [];
    for (let i = 0; i < s.count; i++) {
      if (!s.active[i]) continue;
      const dx = s.ix[i] - s.ix[mid], dy = s.iy[i] - s.iy[mid];
      if (Math.abs(dx) + Math.abs(dy) === 1) side.push(i);
    }
    assert.equal(side.length, 4);
    for (const i of side) {
      const t = Array.from(tear.subarray(i * 4, i * 4 + 4)).sort();
      assert.deepEqual(t, [0, 0, HULL_SKIN_TEAR[1], HULL_SKIN_TEAR[1]], `sąsiad ${i}`);
    }
    // Daleko od dziury — 0.
    let far = -1;
    for (let i = 0; i < s.count; i++) if (s.active[i] && Math.abs(s.ix[i] - s.ix[mid]) > 3) { far = i; break; }
    assert.ok(Array.from(tear.subarray(far * 4, far * 4 + 4)).every((t) => t === 0));
    assert.deepEqual(Array.from(HULL_SKIN_TEAR), [0, 0.5, 0.75, 1]);
    // Zapis bez tablicy rozdarcia działa jak dawniej (testy, narzędzia).
    assert.equal(writeHullSkin(body, topo, pos, shade, heat), body.activeNodes);
  } finally {
    HullBodies.release(e);
  }
});

test('mapa ran: węzeł zniszczony poza bronią → stempel rozdarcia z dziurą ~1 komórki; trafienie broni — tylko krater', async () => {
  const { craterOptsFor } = await import('../src/game/hullCraters.js');
  fresh();
  HullBodies.onImpact = HullDamageMap.onHullImpact;
  HullBodies.onNodeLost = HullDamageMap.onHullNodeLost;
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  try {
    const key = e.beamHull.dmgKey;
    const cs = e.beamHull.cellSize;
    const slot = () => HullDamageMap.slotOf(key);
    const T = S.STAMP.tear.impact;
    // Cięcie wraku / zderzenie (poza trafieniem): stempel rozdarcia.
    assert.equal(HullBodies.cutNearest(e, 100, 0, 1), 1);
    assert.equal(HullDamageMap.stats.tearStamps, 1);
    const st = lastStamp(slot());
    close(st.r, T[S.S_R], 1e-3, 'promień rozdarcia');
    close(st.hole, S.TEAR_HOLE_CELLS * cs, 1e-3, 'dziura ~1 komórki — lej tylko przy prawdziwej dziurze');
    close(st.heat, T[S.S_HEAT], 1e-6);
    close(st.scorch, T[S.S_SCORCH], 1e-6);
    close(st.rim, T[S.S_HOLE], 1e-6);
    assert.equal(st.cut, 0, 'bez przezroczystości — dziurę robi geometria (i poszarpany brzeg skóry)');
    assert.ok(S.lejRadius(T) > 0.5 * cs && S.lejRadius(T) < S.TEAR_HOLE_CELLS * cs, `lej rozdarcia ${S.lejRadius(T)} j. — za brzegiem martwej komórki, w dziurze`);
    // Sąsiedni węzeł w tej samej klatce (bliżej niż 0,9 komórki od stempla) — łączy się; dalej — nowy stempel.
    HullDamageMap.onHullNodeLost(e, e.beamHull, 0.5, 0.5, 100 + 0.5 * cs, 0);
    assert.equal(HullDamageMap.stats.tearMerged, 1);
    HullDamageMap.onHullNodeLost(e, e.beamHull, 0.5, 0.5, 100 + 2 * cs, 0);
    assert.equal(HullDamageMap.stats.tearStamps, 2);
    // Trafienie broni: krater stempluje hak krateru, zniszczone w nim węzły nie dają rozdarć.
    const before = HullDamageMap.stats.tearStamps;
    const yam = { vfxKey: 'special_yamato_cannon', type: 'plasma', weaponSize: 'Capital' };
    const hit = HullBodies.sweep(e, -150, -1000, -150, 0, 0);
    HullDamageMap.setSource(yam);
    HullBodies.impact(e, hit.worldX, hit.worldY, 850, { x: 0, y: 9000 }, craterOptsFor(yam, 'impact', 850));
    HullDamageMap.clearSource();
    assert.ok(HullBodies.impactResult.killed > 10, `krater: ${HullBodies.impactResult.killed} węzłów`);
    assert.equal(HullDamageMap.stats.tearStamps, before, 'krater broni bez stempli rozdarcia');
    assert.equal(HullBodies._weaponDepth, 0);
    // Limit rozdarć na slot w klatce zostawia miejsce stemplom broni.
    HullDamageMap.frame++;
    for (let k = 0; k < 60; k++) HullDamageMap.onHullNodeLost(e, e.beamHull, 0.5, 0.5, -280 + k * 2 * cs, 60);
    assert.ok(slot().pending <= M.DMG_TEAR_SLOT_CAP, `slot: ${slot().pending}`);
    assert.ok(HullDamageMap.stats.tearCapped > 0);
    assert.ok(M.DMG_TEAR_SLOT_CAP < M.DMG_SLOT_STAMP_CAP);
  } finally {
    HullBodies.onImpact = null;
    HullBodies.onNodeLost = null;
    HullBodies.release(e);
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
  }
});

test('rów przebicia Mjolnira: dziura wzdłuż całej drogi w materiale, szeroka na ~2 promienie leja rzazu', () => {
  const MJ = MASTER_WEAPONS.siege_railgun;
  const e = npcAt(0, 0);
  HullBodies.createHull(e, plate(600, 300));
  try {
    const R = S.trenchRadiusFor({ vfxKey: 'siege_railgun' }, MJ.baseDamage);
    close(R, S.lejRadius(S.STAMP.mjolnir.kerf), 1e-9);
    const base = e.beamHull.body.activeNodes;
    const log = flyShot(createShot(MJ, -2000, 10, 1, 0, 3), MJ, [e]);
    assert.deepEqual(log.map((l) => l.type), ['enter', 'exit']);
    const cs = e.beamHull.cellSize;
    // Rów od wejścia do wylotu przecina płytę — druga połowa odpada wrakiem (rozpad silnika, w kroku).
    HullBodies.step(1 / 120, [e]);
    const parts = [e, ...window.wrecks];
    const anyAt = (x, y) => parts.some((p) => HullBodies.probe(p, x, y, cs * 0.75));
    // Środek toru (daleko od kraterów wejścia i wyjścia): pusto; za brzegiem rowu — blacha.
    for (const x of [-120, -60, 0, 60, 120]) {
      assert.equal(anyAt(x, 10), false, `rów w x = ${x}`);
      assert.equal(anyAt(x, 10 + R + 2 * cs), true, `blacha nad rowem w x = ${x}`);
      assert.equal(anyAt(x, 10 - R - 2 * cs), true, `blacha pod rowem w x = ${x}`);
    }
    let alive = 0;
    for (const p of parts) alive += p.beamHull?.body && !p.beamHull.body.dead ? p.beamHull.body.activeNodes : 0;
    const area = (base - alive) * cs * cs;
    assert.ok(area > 600 * 2 * R * 0.6, `rów: ${base - alive} węzłów`);
  } finally {
    HullBodies.release(e);
    for (const w of window.wrecks) HullBodies.release(w);
    window.wrecks.length = 0;
  }
});

test('WGSL partii skór: poszarpany brzeg — szum z poziomu 0 i discard tylko przy rozdarciu (aShadeHeat.w)', () => {
  const canvas = { width: 1, height: 1, style: {}, addEventListener() {}, removeEventListener() {}, getContext() { return null; } };
  const renderer = new THREE.WebGPURenderer({ canvas });
  renderer.hasFeature = () => false;
  renderer.backend.device = { limits: { maxUniformBufferBindingSize: 65536 }, features: new Set() };
  const t = new THREE.Texture(); t.image = { width: 64, height: 32 }; t.minFilter = THREE.LinearMipmapLinearFilter;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setAttribute('aShadeHeat', new THREE.BufferAttribute(new Float32Array(16), 4));
  g.setAttribute('aUvSlot', new THREE.BufferAttribute(new Float32Array(12), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new HullNodeMaterial('beamBatch', { uSprite: { value: t }, uNormalMap: { value: HULL_FLAT_NORMAL_TEXTURE }, uShapeMap: HullLacquer.flatShapeUniform });
  const mesh = new THREE.Mesh(g, mat);
  const b = renderer.backend.createNodeBuilder(mesh, renderer);
  b.material = mat; b.scene = new THREE.Scene(); b.camera = new THREE.OrthographicCamera(); b.context.material = mat;
  b.build();
  const f = b.fragmentShader;
  const m = f.match(/if \( \( (nodeVarying\d+)\.w > 0\.01 \) \) \{([\s\S]*?)\n\t\}/);
  assert.ok(m, 'gałąź rozdarcia');
  const branch = m[2];
  assert.equal((branch.match(/textureSampleLevel\(/g) || []).length, 2, 'dwie oktawy szumu z poziomu 0 (bez pochodnych w gałęzi)');
  assert.doesNotMatch(branch, /textureSample\(/);
  assert.match(branch, /discard;/);
  assert.match(branch, new RegExp(`${m[1]}\\.w > `), 'próg z szumu');
  // Pułapka 29: indeks slotu partii (zmienna WGSL z pierwszego użycia) liczony PRZED gałęzią rozdarcia —
  // w niej mapa ran i lampy reszty materiału czytałyby slot 0 (rany znikały z kadłubów).
  assert.doesNotMatch(branch, /round\(/, 'bez indeksu slotu w gałęzi');
  const slotAt = f.search(/= \( u32\( round\( nodeVarying\d+\.z \) \) \* \d+u \);/);
  assert.ok(slotAt >= 0 && slotAt < m.index, 'indeks slotu przed gałęzią rozdarcia');
  assert.match(f, new RegExp(`\\/ vec2<f32>\\( ${HULL_TEAR_FRAY.coarse}\\.0 \\)`), 'okres szumu grubego w j. świata kadłuba');
});
