import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Prymitywy zgięcia przestrzeni dla efektów warpa (docs/BRIEF-warp.md §5.1):
// ten sam pass tła co soczewka skoku, lista punkt / szew / fala. Testy pilnują
// pakowania świat → UV, lustra CPU shadera (tożsamość poza zasięgiem, kierunek
// wciągania) i tego, że pass działa także bez soczewki skoku.

globalThis.window = globalThis.window || {};
const THREE = await import('three');
const {
  WARP_SPACE_MAX_PRIMS,
  WARP_SPACE_TYPE,
  packWarpSpacePrims,
  warpSpaceSampleUv,
  createWarpLensShader
} = await import('../src/3d/warpLens3D.js');
const { Core3D } = await import('../src/3d/core3d.js');

const readSrc = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const vecs = (n) => Array.from({ length: n }, () => new THREE.Vector4());
const cam = { x: 1000, y: 2000, zoom: 0.25 };
const W = 1600;
const H = 900;

function packOne(req) {
  const A = vecs(WARP_SPACE_MAX_PRIMS);
  const B = vecs(WARP_SPACE_MAX_PRIMS);
  const n = packWarpSpacePrims([req], 1, cam, W, H, A, B);
  return { n, A, B };
}

test('pakowanie: środek w UV jak soczewka, długości w wysokościach ekranu, oś z y w dół', () => {
  const { n, A, B } = packOne({ type: WARP_SPACE_TYPE.SEAM, x: 1000 + 400, y: 2000 - 200, angle: Math.PI / 2, a: 900, b: 120, strength: 0.5 });
  assert.equal(n, 1);
  assert.ok(Math.abs(A[0].x - (0.5 + 400 * 0.25 / W)) < 1e-12);
  assert.ok(Math.abs(A[0].y - (0.5 + 200 * 0.25 / H)) < 1e-12, 'y gry w dół → v w górę');
  assert.ok(Math.abs(A[0].z - Math.cos(Math.PI / 2)) < 1e-12);
  assert.ok(Math.abs(A[0].w + 1) < 1e-12, 'kąt π/2 (w dół ekranu gry) → oś −v');
  assert.ok(Math.abs(B[0].x - 900 * 0.25 / H) < 1e-12);
  assert.ok(Math.abs(B[0].y - 120 * 0.25 / H) < 1e-12);
  assert.equal(B[0].z, 0.5);
  assert.equal(B[0].w, WARP_SPACE_TYPE.SEAM);

  // Fala: amplituda świat → wysokości ekranu, ze znakiem.
  const ring = packOne({ type: WARP_SPACE_TYPE.RING, x: 1000, y: 2000, a: 800, b: 100, strength: -60 });
  assert.equal(ring.n, 1);
  assert.ok(Math.abs(ring.B[0].z + 60 * 0.25 / H) < 1e-12);
});

test('pakowanie: pomija zerowe, za małe i poza kadrem; połknięcie przycięte do 0,65', () => {
  assert.equal(packOne({ type: WARP_SPACE_TYPE.POINT, x: 1000, y: 2000, a: 500, b: 500, strength: 0 }).n, 0);
  assert.equal(packOne({ type: WARP_SPACE_TYPE.POINT, x: 1000, y: 2000, a: 5, b: 5, strength: 0.5 }).n, 0, 'kilka pikseli nic nie pokaże');
  assert.equal(packOne({ type: WARP_SPACE_TYPE.POINT, x: 1000 + 1e6, y: 2000, a: 500, b: 500, strength: 0.5 }).n, 0);
  assert.equal(packOne({ type: WARP_SPACE_TYPE.RING, x: 1000, y: 2000, a: 500, b: 0, strength: 50 }).n, 0);
  const big = packOne({ type: WARP_SPACE_TYPE.POINT, x: 1000, y: 2000, a: 500, b: 500, strength: 5 });
  assert.equal(big.B[0].z, 0.65);
});

test('lustro shadera: tożsamość poza zasięgiem, szew wciąga tło ku odcinkowi, fala przesuwa promieniowo', () => {
  const aspect = W / H;
  const s = { u: 0, v: 0 };
  // Szew poziomy na środku ekranu: połowa długości 0,3, zasięg 0,1, połknięcie 0,5.
  const prims = {
    A: [{ x: 0.5, y: 0.5, z: 1, w: 0 }],
    B: [{ x: 0.3, y: 0.1, z: 0.5, w: WARP_SPACE_TYPE.SEAM }]
  };
  warpSpaceSampleUv(0.5, 0.9, prims, 1, aspect, s);
  assert.deepEqual([s.u, s.v], [0.5, 0.9], 'poza zasięgiem w poprzek — bez zmian');
  warpSpaceSampleUv(0.5 + 0.35 / aspect, 0.5, prims, 1, aspect, s);
  assert.ok(Math.abs(s.u - (0.5 + 0.35 / aspect)) < 1e-12 && Math.abs(s.v - 0.5) < 1e-12, 'za końcem szwu — bez zmian');
  warpSpaceSampleUv(0.5, 0.52, prims, 1, aspect, s);
  assert.ok(s.v > 0.52, 'piksel przy szwie pokazuje tło z dalej — obraz ciągnie ku szwowi');
  assert.ok(Math.abs(s.u - 0.5) < 1e-12, 'szew nie przesuwa wzdłuż osi');
  // Ciągłość na brzegu zasięgu.
  warpSpaceSampleUv(0.5, 0.5 + 0.1 - 1e-7, prims, 1, aspect, s);
  assert.ok(Math.abs(s.v - (0.5 + 0.1)) < 1e-5);

  // Fala: pierścień R = 0,2, pasmo 0,03, amplituda 0,01 (w osi v).
  const ring = { A: [{ x: 0.5, y: 0.5, z: 1, w: 0 }], B: [{ x: 0.2, y: 0.03, z: 0.01, w: WARP_SPACE_TYPE.RING }] };
  warpSpaceSampleUv(0.5, 0.5 + 0.2, ring, 1, aspect, s);
  assert.ok(Math.abs(s.v - 0.7) < 1e-12, 'na samym promieniu przesunięcie zero');
  warpSpaceSampleUv(0.5, 0.5 + 0.2 + 0.02, ring, 1, aspect, s);
  assert.ok(s.v < 0.72, 'na zewnątrz pierścienia próbka bliżej środka');
  warpSpaceSampleUv(0.5, 0.5 + 0.5, ring, 1, aspect, s);
  assert.ok(Math.abs(s.v - 1.0) < 1e-12, 'daleko od pasma — bez zmian');
});

test('GLSL: pętla prymitywów liczy to samo co lustro CPU, soczewka skoku bez zmian', () => {
  const fs = createWarpLensShader().fragmentShader;
  assert.match(fs, new RegExp(`uniform vec4 uPrimA\\[${WARP_SPACE_MAX_PRIMS}\\];`));
  assert.match(fs, /if \(i >= uPrimCount\) break;/);
  assert.match(fs, /float ps2 = px2 \+ pb\.z \* pb\.z \* pw \* pw;/);
  assert.match(fs, /float pa2 = pb\.z \* ptap \* ptap;/);
  assert.match(fs, /vec2 pds = pax \* pl \+ pper \* \(sign\(pya\) \* ps \* pb\.y\);/);
  assert.match(fs, /vec2 pdd = \(pd \/ pr\) \* \(pb\.z \* pk \* exp\(-pk \* pk\)\);/);
  // Próbka tła raz, na końcu i poza gałęziami (mipmapy z ciągłej mapy);
  // dwie kolejne tylko w pętli opływu widoku skoku, pod warunkiem na uniformie.
  assert.equal((fs.match(/texture2D\(tSource/g) || []).length, 3);
  assert.match(fs, /if \(uWV\.w > 0\.001\) \{/);
  assert.match(fs, /gl_FragColor\.rgb = mix\(gl_FragColor\.rgb, wvFlow, wvOut\);/);
  // Rybie oko bez ujemnej podstawy potęgi (NaN) i ze ściskiem ograniczonym.
  assert.match(fs, /float wxi = min\(wx, 0\.94\);/);
  assert.match(fs, /pow\(1\.0 \/ \(1\.0 - wxi \* wxi\), uWVMisc\.w \* wbeta\)/);
  // Front wyjścia: przed frontem (dalej w kierunku lotu) zwykły widok — lustro sweepBeta.
  assert.match(fs, /float wbeta = uWV\.w \* \(1\.0 - smoothstep\(uWVFront\.x - uWVFront\.y, uWVFront\.x \+ uWVFront\.y, wfs\)\);/);
  assert.match(fs, /wvOut = smoothstep\(0\.9, 1\.03, wx\);/);
  // Opływ słabnie z frontem: przesunięcie i jasność zbiegają do zwykłego widoku.
  assert.match(fs, /vec2 wvb = wvel \* wbeta;/);
  assert.match(fs, /mix\(1\.0, uWVMisc\.z, wbeta\)/);
  // Kropla: promień normalizowany brzegiem w kierunku piksela (lustro warpDropExit),
  // opływ liczony w układzie, w którym kropla jest kołem.
  assert.match(fs, /uniform vec4 uWVDrop;/);
  assert.match(fs, /float wvDropExit\(vec2 dir, vec4 g\) \{/);
  assert.match(fs, /if \(da >= 0\.0 && \(tA \* dir\.x - g\.x\) \/ g\.y >= -sa\) return tA;/);
  assert.match(fs, /if \(uL <= g\.x - g\.y \* sa && uL >= g\.z - g\.w \* sa\) return tL;/);
  assert.match(fs, /float wB = wvDropExit\(wl > 1e-6 \? vec2\(wfs, wcs\) \/ wl : vec2\(1\.0, 0\.0\), uWVDrop\);/);
  assert.match(fs, /float wx = wl \/ wB;/);
  assert.match(fs, /float wa = wfs \/ wB;/);
});

test('Core3D: kształt kropli z setWarpViewWorld trafia do uniformu, bez niego koło', () => {
  const core = makeFakeCore();
  core.width = W;
  core.height = H;
  core._warpViewReq = { ...Core3D._warpViewReq };
  const now = () => performance.now() / 1000;
  core.setWarpViewWorld(0, 0, 300, 1, 0, { drop: { ua: 0.25, ra: 0.8, ub: -0.98, rb: 0.07 } });
  assert.equal(core._prepareWarpLens(false, now()), true);
  const d = core.warpLensPass.uniforms.uWVDrop.value;
  assert.deepEqual([d.x, d.y, d.z, d.w], [0.25, 0.8, -0.98, 0.07]);
  core.setWarpViewWorld(0, 0, 300, 1, 0, {});
  core._prepareWarpLens(false, now());
  assert.deepEqual([d.x, d.y, d.z, d.w], [0, 1, 0, 1]);
});

function makeFakeCore() {
  const def = createWarpLensShader();
  return Object.assign(Object.create(Core3D), {
    composerTarget: { width: W, height: H },
    warpLensPass: { enabled: true, uniforms: THREE.UniformsUtils.clone(def.uniforms) },
    renderer: { capabilities: { isWebGL2: true, getMaxAnisotropy: () => 16 } },
    activeCam1: { x: 0, y: 0, zoom: 0.2 },
    activeCam2: null,
    warpLensTarget: null,
    _warpLensActive: false,
    _warpLensLastUseMs: 0,
    _warpLensRequest: { x: 0, y: 0, angle: 0, radiusAlong: 0, radiusAcross: 0, swallow: 0, stampMs: -Infinity },
    _warpLensUniformScratch: {},
    _warpSpaceReq: Array.from({ length: WARP_SPACE_MAX_PRIMS }, () => ({})),
    _warpSpaceCount: 0
  });
}

test('Core3D: same prymitywy włączają pass (soczewka skoku neutralna), lista zerowana co klatkę', () => {
  const core = makeFakeCore();
  const now = () => performance.now() / 1000;
  assert.equal(core._prepareWarpLens(false, now()), false);
  assert.equal(core.pushWarpSpaceWorld(WARP_SPACE_TYPE.SEAM, 100, -50, 0.3, 900, 120, 0.5), true);
  assert.equal(core._prepareWarpLens(false, now()), true);
  const lu = core.warpLensPass.uniforms;
  assert.equal(lu.uPrimCount.value, 1);
  assert.equal(lu.uSwallow.value, 0, 'bez soczewki skoku — jej mapa to tożsamość');
  assert.ok(lu.uCenter.value.x < -1, 'soczewka skoku poza kadrem');
  assert.equal(lu.tSource.value, core.warpLensTarget.texture);
  // Producent nic nie zgłosił w tej klatce → pass znika.
  assert.equal(core._prepareWarpLens(false, now()), false);
  // Limit listy.
  for (let i = 0; i < WARP_SPACE_MAX_PRIMS; i++) core.pushWarpSpaceWorld(0, 0, 0, 0, 500, 500, 0.3);
  assert.equal(core.pushWarpSpaceWorld(0, 0, 0, 0, 500, 500, 0.3), false);
});

test('Core3D: fale warpa w uberPassie — uniformy i konsumpcja w render()', () => {
  const core = readSrc('src/3d/core3d.js');
  assert.match(core, /uWaveCount: \{ value: 0 \}/);
  assert.match(core, /uniform vec4 uWaves\[\$\{MAX_WARP_WAVES\}\];/);
  assert.match(core, /uPost\.uWaveCount\.value = heatEnabled \? this\._packWarpWaves\(uPost\.uWaves\.value, uPost\.uWaveShape\.value\) : 0;/);
  assert.match(core, /this\._warpWaveCount = 0;/);
  // Fala zgłoszona w świecie trafia do uniformów w osi v ekranu.
  const fake = Object.assign(Object.create(Core3D), {
    width: W, height: H, activeCam1: { x: 0, y: 0, zoom: 0.5 }, activeCam2: null,
    perfToggles: { heatHaze: true },
    _warpWaveReq: Array.from({ length: 8 }, () => ({})), _warpWaveCount: 0
  });
  assert.equal(fake.pushWarpWaveWorld(0, 200, 100, 400, 50, 20, 0), true);
  const outW = vecs(8);
  const outS = vecs(8);
  assert.equal(fake._packWarpWaves(outW, outS), 1);
  assert.ok(Math.abs(outW[0].x - (0.5 + 200 * 0.5 / W)) < 1e-12);
  assert.ok(Math.abs(outW[0].y - (0.5 - 100 * 0.5 / H)) < 1e-12);
  assert.ok(Math.abs(outW[0].z - 400 * 0.5 / H) < 1e-12);
  assert.ok(Math.abs(outW[0].w - 20 * 0.5 / H) < 1e-12);
  assert.equal(outS[0].x, 0);
});
