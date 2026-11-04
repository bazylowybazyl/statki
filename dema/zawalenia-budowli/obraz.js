// OBRAZ dema D20 „Zawalenia budowli na szarych blokach” (docs/PLAN-zawalenia-budowli-3d.md, synteza dema § 5).
// Demo jest hostem: własny WebGPURenderer (strażnik jednego renderera skanuje tylko src/ — tests/overlayContextMerge),
// materiały wyłącznie TSL, niebo i post z dema/halo_ring_demo_env.js (bloom gry, ACES, sRGB — szarość jak w grze).
// Obraz z niczym się nie zderza (zasada żelazna 1): bloki rysują pozy klastrów silnika (interpolowane), gruz obrazu i pył
// to cząstki CPU (D2 — bez gazu), smugi i błyski — addytywne, HDR.
//
//  - BLOKI: JEDEN InstancedMesh na wszystkie prostopadłościany wszystkich gospodarzy (+ sceneria: płyty pod wieżami,
//    pomost, okręt-zastępstwo). Macierz = interpolowana poza klastra · T(środek − com) · Rz(yaw) · S(2h); barwa per
//    instancja (szarość ±6% z hasza bloku), rysa (S.util + zdrowie wiązań) jako przyciemnienie, krawędzie bloków
//    przyciemnione w TSL (szwy kondygnacji widać bez nakładek). Martwe — macierz zerowa.
//  - GRUZ OBRAZU: InstancedMesh kamieni (dwudziestościan), balistyka CPU w Float64Array (SoA), lądowanie na podłożu
//    (kula sceny) albo na płytach scenerii, ≤ STONE_CAP. Blok w gruz → 6–10 kamieni potęgowo (podgląd L2).
//  - PYŁ: pula sprite'ów (SpriteNodeMaterial z instancjami, mieszanie zwykłe), źródła z rekordów gospodarza.
//  - SMUGI (kwady wzdłuż odcinka) i BŁYSKI (sprite'y) — addytywnie, luminancja > 1, forceSinglePass.
//  - Rozgrzewka: compileAsync (cel postu) z każdą kamerą, pule z licznikiem ≥ 2, potem 2 klatki (pass cienia, bloom);
//    licznik pipeline'ów synchronicznych (hak pipelineUtils) liczy od końca rozgrzewki — ma być 0.
// Świat sceny = świat silnika (x gry, −y gry, z w górę) przy 0 — bez dużych przesunięć (float32 wystarcza).
import * as THREE from 'three/webgpu';
import {
  Fn, abs, cameraPosition, cross, dot, exp, float, floor, fract, instancedBufferAttribute, max, min, mix, normalize,
  positionGeometry, positionWorld, sin, smoothstep, texture, uniform, uv, varying, vec2, vec3, vec4
} from 'three/tsl';
import { createPost, createSky } from '../halo_ring_demo_env.js';
import { installPlaceholders, getPlaceholderStats } from '../../src/3d/tsl/zamiennik.js';
import { compileAsyncNaCelu } from '../../src/3d/rozgrzewka.js';
import { COLLAPSE_REC, collapseGroundZ } from '../../src/game/structureCollapse.js';
import { STRUCT_BOX_STRIDE } from '../../src/game/structureGraph.js';

export const BOX_CAP = 2048;
export const STONE_CAP = 3000;
export const DUST_CAP = 4096;
export const GLOW_CAP = 768;
export const BEAM_CAP = 192;
const SKY_LAYER = 9;   // DEMO_LAYERS.cineSky (createSky)

// PRNG obrazu (mulberry32) — ziarno od nowa w każdej scenie: zrzuty harnessu powtarzalne, gra bez Math.random.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash01 = (n) => { let x = (n * 2654435761) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x85ebca6b) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

// macierz obrotu kwaternionu (wiersze) do m[o..o+9)
function rotInto(qx, qy, qz, qw, m, o) {
  m[o] = 1 - 2 * (qy * qy + qz * qz); m[o + 1] = 2 * (qx * qy - qw * qz); m[o + 2] = 2 * (qx * qz + qw * qy);
  m[o + 3] = 2 * (qx * qy + qw * qz); m[o + 4] = 1 - 2 * (qx * qx + qz * qz); m[o + 5] = 2 * (qy * qz - qw * qx);
  m[o + 6] = 2 * (qx * qz - qw * qy); m[o + 7] = 2 * (qy * qz + qw * qx); m[o + 8] = 1 - 2 * (qx * qx + qy * qy);
}

// ── materiały (graf RAZ na rodzaj) ──────────────────────────────────────────────────────────────────────────────
// szum wartości 2D (gładki) — grunt planetoidy
const h21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const vnoise2 = Fn(([x]) => {
  const i = floor(x).toVar();
  const f = fract(x).toVar();
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0)).toVar();
  const a = h21(i), b = h21(i.add(vec2(1, 0))), c = h21(i.add(vec2(0, 1))), d = h21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

function blockMaterial(nSize, nTint) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.86, metalness: 0.0 });
  m.name = 'ZawBloki';
  // pozycja w bryle bloku w jednostkach świata (szwy krawędzi o stałej szerokości niezależnie od skali instancji)
  const vLoc = varying(positionGeometry.mul(nSize.xyz), 'vZawLoc');
  const vHalf = varying(nSize.xyz.mul(0.5), 'vZawHalf');
  const vTint = varying(nTint, 'vZawTint');
  m.colorNode = Fn(() => {
    const d = vHalf.sub(abs(vLoc)).toVar();
    // na ścianie jedna składowa ≈ 0 — druga najmniejsza to odległość od najbliższej krawędzi
    const edge = max(min(d.x, d.y), min(max(d.x, d.y), d.z));
    const seam = smoothstep(0.0, 5.0, edge).mul(0.42).add(0.58);
    const grain = vnoise2(vLoc.xy.add(vLoc.z).mul(0.09)).mul(0.08).add(0.96);
    const crack = vTint.w;
    const col = vTint.rgb.mul(seam).mul(grain).mul(float(1.0).sub(crack.mul(0.5)));
    return vec4(col, 1.0);
  })();
  return m;
}

function stoneMaterial(nCol) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0.0 });
  m.name = 'ZawGruz';
  m.colorNode = vec4(varying(nCol.rgb, 'vZawStone'), 1.0);
  return m;
}

function groundMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 1.0, metalness: 0.0 });
  m.name = 'ZawGrunt';
  m.colorNode = Fn(() => {
    const p = positionWorld.xy.toVar();
    const big = vnoise2(p.mul(1 / 2300)).mul(0.6).add(vnoise2(p.mul(1 / 700)).mul(0.4));
    const fine = vnoise2(p.mul(1 / 60)).mul(0.5).add(vnoise2(p.mul(1 / 17)).mul(0.5));
    const base = mix(vec3(0.13, 0.122, 0.112), vec3(0.22, 0.208, 0.19), big);
    return vec4(base.mul(fine.mul(0.28).add(0.86)), 1.0);
  })();
  return m;
}

function dustMaterial(nP, nC) {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  m.name = 'ZawPyl';
  m.positionNode = nP.xyz;
  m.scaleNode = vec2(nP.w, nP.w);
  m.rotationNode = nC.z;
  const q = uv().sub(0.5).mul(2.0);
  const r2 = dot(q, q);
  // kłąb: miękki brzeg + szum (obracany z cząstką) — nie krążek
  const n = vnoise2(q.mul(2.6).add(nC.w.mul(37.0))).mul(0.55).add(vnoise2(q.mul(6.0).add(nC.w.mul(11.0))).mul(0.45));
  const soft = float(1.0).sub(smoothstep(0.0, 1.0, r2)).mul(n.mul(0.9).add(0.35));
  // jasność pyłu jak oświetlony grunt (materiał bez świateł — barwa wprost, pod progiem bloomu)
  m.colorNode = vec3(0.165, 0.155, 0.142).mul(nC.x);
  m.opacityNode = soft.mul(nC.y).clamp(0.0, 1.0);
  return m;
}

function glowMaterial(nP, nC) {
  const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.name = 'ZawBlysk';
  m.forceSinglePass = true;
  m.positionNode = nP.xyz;
  m.scaleNode = vec2(nP.w, nP.w);
  const q = uv().sub(0.5).mul(2.0);
  const r2 = dot(q, q);
  m.colorNode = nC.rgb.mul(exp(r2.mul(-7.0)).add(exp(r2.mul(-60.0)).mul(1.5))).mul(float(1.0).sub(smoothstep(0.6, 1.0, r2)));
  return m;
}

function beamMaterial(nA, nB, nC) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.name = 'ZawSmuga';
  m.forceSinglePass = true;
  m.positionNode = Fn(() => {
    const t = positionGeometry.x, s = positionGeometry.y;
    const a = nA.xyz.toVar(), b = nB.xyz.toVar();
    const P = mix(a, b, t).toVar();
    const dir = normalize(b.sub(a).add(vec3(0.0, 0.0, 0.0001)));
    const toCam = normalize(cameraPosition.sub(P));
    const side = normalize(cross(dir, toCam).add(vec3(0.00001, 0.0, 0.0)));
    return P.add(side.mul(s.mul(nA.w)));
  })();
  const vS = varying(positionGeometry.y, 'vZawBeamS');
  const vT = varying(positionGeometry.x, 'vZawBeamT');
  m.colorNode = Fn(() => {
    const across = exp(vS.mul(vS).mul(-3.5));
    const along = smoothstep(0.0, 0.55, vT).mul(float(0.25).add(vT.mul(0.75)));
    return vec4(nC.rgb.mul(across).mul(along).mul(nB.w), 1.0);
  })();
  return m;
}

// PŁYTA (pole płyty silnika — dysk mieszkalny, korona bębna): siatka w dwóch arkuszach (wierzch, spód), wierzchołki co
// ½ komórki; tekstura RG8 z pola (R = F.thick, G = 255 przy materiale; wysyłka przy zmianie F.version), próbkowana
// DWULINIOWO. Kontur otworu i brzegu = G = ½ (w połowie między komórką z materiałem a otworem — gładki, bez schodków po 45 j.,
// maskNode — także w passie cienia). Wierzch = średnia grubość komórek z materiałem (R / G — rów zostaje rowem, otwór
// nie ściąga zbocza w dół przez całą komórkę), opada do spodu tuż przy konturze (ściana). Normalne z pochodnych
// (flatShading). Graf RAZ na pole (własna tekstura), układ pola (o, u, v, n) w macierzy siatki.
const PLATE_MASK = 0.5;
function plateMaterial(tex, uCell, uScale, PM, tint) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0.0, flatShading: true });
  m.name = 'ZawPlyta';
  const g = positionGeometry;
  const uvC = vec2(g.x.add(0.5), g.y.add(0.5)).div(PM);
  const s = texture(tex, uvC).level(0);
  const hA = s.r.div(max(s.g, float(0.002)));
  const lift = smoothstep(PLATE_MASK, PLATE_MASK + 0.2, s.g);
  m.positionNode = vec3(g.x.add(0.5).mul(uCell), g.y.add(0.5).mul(uCell), hA.mul(lift).mul(uScale).mul(float(1.0).sub(g.z)));
  m.maskNode = texture(tex, varying(uvC, 'vZawPlUv')).g.greaterThan(PLATE_MASK);
  m.colorNode = Fn(() => {
    const p = positionWorld.xy.toVar();
    const grain = vnoise2(p.mul(1 / 90)).mul(0.08).add(vnoise2(p.mul(1 / 23)).mul(0.05)).add(0.92);
    return vec4(vec3(tint[0], tint[1], tint[2]).mul(grain), 1.0);
  })();
  return m;
}

// siatka płyty: wierzchołki (x, y) w jednostkach komórki co 1/SUB (0 … PM − 1), z = arkusz (0 wierzch, 1 spód)
const PLATE_SUB = 2;
function plateGeometry(PM) {
  const n = (PM - 1) * PLATE_SUB + 1, nv = n * n;
  const pos = new Float32Array(2 * nv * 3), nor = new Float32Array(2 * nv * 3);
  const idx = new Uint32Array(2 * (n - 1) * (n - 1) * 6);
  for (let s = 0; s < 2; s++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (s * nv + j * n + i) * 3;
    pos[k] = i / PLATE_SUB; pos[k + 1] = j / PLATE_SUB; pos[k + 2] = s;
    nor[k + 2] = s ? -1 : 1;
  }
  let w = 0;
  for (let s = 0; s < 2; s++) for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = s * nv + j * n + i, b = a + 1, c = a + n + 1, d = a + n;
    if (s === 0) { idx[w++] = a; idx[w++] = b; idx[w++] = c; idx[w++] = a; idx[w++] = c; idx[w++] = d; }
    else { idx[w++] = a; idx[w++] = c; idx[w++] = b; idx[w++] = a; idx[w++] = d; idx[w++] = c; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// Grunt: czasza kuli sceny (R, środek) — siatka biegunowa gęstsza przy środku, normalne z kuli (horyzont jak na planetoidzie).
function groundGeometry(ground, rMax = 60000, rings = 110, segs = 160) {
  const R = +ground.R, cx = +ground.cx || 0, cy = +ground.cy || 0, cz = +ground.cz || 0;
  if (R < rMax) rMax = R * 0.97;   // mała skała (habitat): czasza do brzegu górnej półkuli
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const r = rMax * (i / rings) ** 2;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      const z = collapseGroundZ(ground, x, y) - 0.5;
      pos.push(x, y, z);
      const nx = (x - cx) / R, ny = (y - cy) / R, nz = (z - cz) / R;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nor.push(nx / l, ny / l, nz / l);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      const a = i * segs + j, b = (i + 1) * segs + j, c = (i + 1) * segs + j1, d = i * segs + j1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Obraz dema na kanwie `canvas`. Zwraca obiekt O (opis metod niżej). onError(tekst) — błędy WebGPU / WGSL na ekran.
 */
export async function createObraz(canvas, { onError = () => {} } = {}) {
  const WANTED = ['maxTextureDimension2D', 'maxBufferSize', 'maxStorageBufferBindingSize', 'maxColorAttachmentBytesPerSample',
    'maxVertexAttributes', 'maxInterStageShaderVariables', 'maxSampledTexturesPerShaderStage'];
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }) : null;
  if (!adapter) throw new Error('Demo wymaga przeglądarki z WebGPU (brak adaptera).');
  const requiredLimits = {};
  for (const k of WANTED) if (Number.isFinite(adapter.limits[k])) requiredLimits[k] = adapter.limits[k];
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false, requiredLimits });
  await renderer.init();
  if (!renderer.backend.isWebGPUBackend) throw new Error('Demo wymaga WebGPU (three przeszedł na zapasowy backend WebGL2).');
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  installPlaceholders(renderer);
  renderer.backend.device.addEventListener('uncapturederror', (e) => onError(`WEBGPU: ${e.error?.message || e.error}`));
  // narzędzia (scripts/webgpu/harness-strona.js): dziennik pipeline'ów i budów NodeBuilder dla dem z własnym rendererem
  window.__HARNESS_RENDERER__ = renderer;

  const stats = { syncPipes: 0, syncNames: [], counting: false, draws: 0, tris: 0, frameCpuMs: 0, blocks: 0, stones: 0, dust: 0, glow: 0, beams: 0 };
  {
    // pipeline'y tworzone SYNCHRONICZNIE w zwykłym renderze (nikt ich nie rozgrzał) — po rozgrzewce ma być 0
    const pu = renderer.backend.pipelineUtils;
    const orig = pu.createRenderPipeline;
    pu.createRenderPipeline = function (ro, promises) {
      if (!promises && stats.counting) {
        stats.syncPipes++;
        if (stats.syncNames.length < 24) stats.syncNames.push(`${ro?.material?.name || ro?.material?.type} @ ${ro?.object?.name || ro?.object?.type}`);
      }
      return orig.call(this, ro, promises);
    };
  }

  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(36, 1, 20, 160000);
  persp.up.set(0, 0, 1);
  persp.layers.enable(SKY_LAYER);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 10, 80000);
  ortho.up.set(0, 1, 0);

  // ── światła: stały zestaw od startu (pułapka 34), gaszenie tylko intensywnością ──
  const sunDir = new THREE.Vector3(0.42, -0.72, 0.56).normalize();
  const sun = new THREE.DirectionalLight(0xfff1e2, 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 2.0;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 30000;
  scene.add(sun, sun.target);
  // niebo „u góry” sceny z-up (domyślnie three bierze +y)
  const hemi = new THREE.HemisphereLight(0x9ea4ae, 0x4f4740, 2.6);
  hemi.position.set(0, 0, 1);
  scene.add(hemi);

  const sky = createSky();
  sky.uniforms.uSunDirW.value.copy(sunDir);
  sky.uniforms.uStars.value = 1.0;
  scene.add(sky.mesh);

  const post = createPost(renderer);
  post.configure({ msaa: 4, bloomResolution: 0.5 });
  post.state.exposure = 1.0;

  // grunt (budowany w setScene — podłoże sceny)
  const groundMat = groundMaterial();
  const ground = new THREE.Mesh(new THREE.BufferGeometry(), groundMat);
  ground.name = 'grunt';
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  let groundKey = '';
  scene.add(ground);

  // ── bloki ──
  const boxIb = new THREE.InstancedInterleavedBuffer(new Float32Array(BOX_CAP * 8), 8);
  const nSize = instancedBufferAttribute(boxIb, 'vec4', 8, 0);
  const nTint = instancedBufferAttribute(boxIb, 'vec4', 8, 4);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.deleteAttribute('uv');
  const blocks = new THREE.InstancedMesh(boxGeo, blockMaterial(nSize, nTint), BOX_CAP);
  blocks.name = 'bloki';
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  blocks.frustumCulled = false;
  blocks.count = 0;
  scene.add(blocks);
  const BM = blocks.instanceMatrix.array;
  const BD = boxIb.array;

  // ── płyty (pola płyty silnika: dysk mieszkalny 89², korona bębna 47²) — siatki i materiały od startu (rozgrzewka) ──
  const plates = [96, 48].map((PM, i) => {
    const data = new Uint8Array(PM * PM * 2);
    const tex = new THREE.DataTexture(data, PM, PM, THREE.RGFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    tex.needsUpdate = true;
    const uCell = uniform(45), uScale = uniform(255);
    const mesh = new THREE.Mesh(plateGeometry(PM), plateMaterial(tex, uCell, uScale, PM, i === 0 ? [0.3, 0.296, 0.288] : [0.24, 0.236, 0.232]));
    mesh.name = i === 0 ? 'plyta-dysk' : 'plyta-korona';
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false; mesh.visible = false;
    scene.add(mesh);
    return { PM, data, tex, uCell, uScale, mesh, F: null, ver: -1, cursor: 0, Pb: null };
  });

  // ── wieża H-T (siatka brył sceny gry w układzie F wokselizacji; poza z pozy ciała / klastra) ──
  const htMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.82, metalness: 0.05, vertexColors: true });
  htMat.name = 'ZawHT';
  const htMesh = new THREE.Mesh(new THREE.BufferGeometry(), htMat);
  htMesh.name = 'H-T';
  htMesh.castShadow = true; htMesh.receiveShadow = true; htMesh.frustumCulled = false;
  htMesh.matrixAutoUpdate = false; htMesh.visible = false;
  scene.add(htMesh);
  let htSrc = null;                                   // { pose(out) → bool } — poza układu F (świat) ze sceny
  const htPrev = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 }, htCur = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  let htPrevTick = -9;
  /** Siatka H-T (raz, przed rozgrzewką): pozycje i barwy trójkątów (Float32Array, bez indeksów) w układzie F. */
  function setHTGeometry(positions, colors) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    htMesh.geometry.dispose();
    htMesh.geometry = g;
  }
  // lina windy (D17): odcinek od bloku-kotwicy do skały pod nim + obudowa kotwicy — dwa sloty instancji bloków
  let rope = null;                                    // { H, block, bottom: {x, y, z} }

  // ── gruz obrazu ──
  const stIb = new THREE.InstancedInterleavedBuffer(new Float32Array(STONE_CAP * 4), 4);
  const nStCol = instancedBufferAttribute(stIb, 'vec4', 4, 0);
  const stones = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), stoneMaterial(nStCol), STONE_CAP);
  stones.name = 'gruz';
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.frustumCulled = false;
  stones.count = 0;
  scene.add(stones);
  const SM = stones.instanceMatrix.array;
  // SoA: 0–2 poz, 3–5 v, 6–8 oś obrotu, 9 ω, 10 kąt, 11–13 skala, 14 g, 15 spoczynek (0 lot, 1 leży, −1 pusty)
  const SW = 16;
  const ST = new Float64Array(STONE_CAP * SW);
  for (let i = 0; i < STONE_CAP; i++) ST[i * SW + 15] = -1;

  // ── pył ──
  const duIb = new THREE.InstancedInterleavedBuffer(new Float32Array(DUST_CAP * 8), 8);
  const nDuP = instancedBufferAttribute(duIb, 'vec4', 8, 0);
  const nDuC = instancedBufferAttribute(duIb, 'vec4', 8, 4);
  const dust = new THREE.Sprite(dustMaterial(nDuP, nDuC));
  dust.name = 'pyl';
  dust.count = 0;
  dust.frustumCulled = false;
  dust.renderOrder = 5;
  scene.add(dust);
  const DD = duIb.array;
  // SoA: 0–2 poz, 3–5 v, 6 wiek, 7 życie, 8 s0, 9 s1, 10 alfa, 11 jasność, 12 kąt, 13 ω, 14 ziarno, 15 opadanie [j/s²]
  const DW = 16;
  const DS = new Float64Array(DUST_CAP * DW);
  for (let i = 0; i < DUST_CAP; i++) DS[i * DW + 7] = -1;

  // ── błyski ──
  const glIb = new THREE.InstancedInterleavedBuffer(new Float32Array(GLOW_CAP * 8), 8);
  const nGlP = instancedBufferAttribute(glIb, 'vec4', 8, 0);
  const nGlC = instancedBufferAttribute(glIb, 'vec4', 8, 4);
  const glow = new THREE.Sprite(glowMaterial(nGlP, nGlC));
  glow.name = 'blyski';
  glow.count = 0;
  glow.frustumCulled = false;
  glow.renderOrder = 10;
  scene.add(glow);
  const GD = glIb.array;
  // SoA: 0–2 poz, 3–5 v, 6 wiek, 7 życie, 8 s0, 9 s1, 10–12 barwa HDR
  const GW = 13;
  const GS = new Float64Array(GLOW_CAP * GW);
  for (let i = 0; i < GLOW_CAP; i++) GS[i * GW + 7] = -1;

  // ── smugi ──
  const bmIb = new THREE.InstancedInterleavedBuffer(new Float32Array(BEAM_CAP * 12), 12);
  const nBA = instancedBufferAttribute(bmIb, 'vec4', 12, 0);
  const nBB = instancedBufferAttribute(bmIb, 'vec4', 12, 4);
  const nBC = instancedBufferAttribute(bmIb, 'vec4', 12, 8);
  const beamGeo = new THREE.InstancedBufferGeometry();
  beamGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
  beamGeo.setIndex([0, 1, 2, 0, 2, 3]);
  beamGeo.instanceCount = 0;
  const beams = new THREE.Mesh(beamGeo, beamMaterial(nBA, nBB, nBC));
  beams.name = 'smugi';
  beams.frustumCulled = false;
  beams.renderOrder = 11;
  scene.add(beams);
  const BMD = bmIb.array;
  // SoA: 0–2 A, 3–5 B, 6 szer., 7 wiek, 8 życie, 9–11 barwa
  const BW = 12;
  const BS = new Float64Array(BEAM_CAP * BW);
  for (let i = 0; i < BEAM_CAP; i++) BS[i * BW + 8] = -1;

  // ── stan sceny ──
  let R = rng(1);
  let groundDesc = null;
  let supports = [];          // płyty scenerii: { x0, x1, y0, y1, z } — gruz ląduje na wierzchu
  let slots = [];             // gospodarze: { H, base, boxBlock, pv, pvTick, pc, pcFrame, crack, minH }
  let sceneryBase = 0, sceneryCount = 0, used = 0;
  let scenery = [];           // { x, y, z, hx, hy, hz, yaw, r, g, b, hidden, tag }
  let stoneHead = 0, dustHead = 0, glowHead = 0, beamHead = 0;
  let frameNo = 0, lastSaveTick = -1;
  const toggles = { gruz: true, rysy: true, pyl: true };

  function groundAt(x, y) {
    let z = groundDesc ? collapseGroundZ(groundDesc, x, y) : 0;
    for (let i = 0; i < supports.length; i++) {
      const s = supports[i];
      if (!s.hidden && x >= s.x0 && x <= s.x1 && y >= s.y0 && y <= s.y1 && s.z > z) z = s.z;
    }
    return z;
  }

  // ── scena: gospodarze i sceneria ──
  // plateFields — pola płyty sceny [{ F, Pb }] (0 — dysk, 1 — korona; Pb — wiązanie z grafem: rekordy otworów),
  // hideStump — gospodarze, których stojącą część rysuje pole płyty (kikut bez obrazu), ht — { pose(out) } wieży H-T,
  // ropeAnchor — lina windy { H, block, bottom: {x, y, z} } (D17)
  let ropeSlot = -1;
  function setScene({ hosts, ground: gdesc, sceneryBoxes = [], seed = 1, shadow = null, plateFields = [], hideStump = [], ht = null, ropeAnchor = null }) {
    plates.forEach((p, i) => {
      const pf = plateFields[i] || null;
      p.F = pf ? pf.F : null; p.Pb = pf ? pf.Pb || null : null; p.ver = -1; p.cursor = p.Pb ? p.Pb.rec.head : 0;
      p.mesh.visible = !!p.F;
      if (p.F) {
        const F = p.F;
        if (F.nu > p.PM || F.nv > p.PM) throw new Error(`płyta ${F.name}: ${F.nu}×${F.nv} > ${p.PM}²`);
        p.uCell.value = F.cell; p.uScale.value = 255 * F.unit;
        p.mesh.matrix.set(F.ux, F.vx, F.nx, F.ox, F.uy, F.vy, F.ny, F.oy, F.uz, F.vz, F.nz, F.oz, 0, 0, 0, 1);
        p.mesh.matrixWorldNeedsUpdate = true;
      }
    });
    htSrc = ht; htPrevTick = -9;
    htMesh.visible = !!ht;
    rope = ropeAnchor;
    R = rng(seed);
    groundDesc = gdesc;
    const key = JSON.stringify(gdesc);
    if (key !== groundKey) {
      ground.geometry.dispose();
      ground.geometry = groundGeometry(gdesc);
      groundKey = key;
    }
    slots = [];
    let base = 0;
    for (const H of hosts) {
      const A = H.A, nb = A.boxCount;
      const boxBlock = new Int32Array(nb);
      for (let b = 0; b < A.n; b++) for (let j = A.boxStart[b]; j < A.boxStart[b + 1]; j++) boxBlock[j] = b;
      const s = { H, base, boxBlock, pv: new Float64Array(7 * 64), pvTick: new Int32Array(64).fill(-9), pc: new Float64Array(12 * 64), pcFrame: new Int32Array(64).fill(-1), crack: new Float32Array(A.n), minH: new Float64Array(A.n), hideStump: hideStump.includes(H) };
      slots.push(s);
      // barwa i rozmiar per prostopadłościan (stałe)
      for (let j = 0; j < nb; j++) {
        const o = j * STRUCT_BOX_STRIDE, b = boxBlock[j], w = (base + j) * 8;
        BD[w] = 2 * A.boxData[o + 3]; BD[w + 1] = 2 * A.boxData[o + 4]; BD[w + 2] = 2 * A.boxData[o + 5]; BD[w + 3] = 0;
        const sh = 1 + (hash01(b * 7919 + 13) - 0.5) * 0.12;
        BD[w + 4] = 0.34 * sh; BD[w + 5] = 0.336 * sh; BD[w + 6] = 0.33 * sh; BD[w + 7] = 0;
      }
      base += nb;
    }
    sceneryBase = base;
    scenery = sceneryBoxes.map((b) => ({ hidden: false, yaw: 0, ...b }));
    sceneryCount = scenery.length;
    used = Math.min(BOX_CAP, base + sceneryCount);
    ropeSlot = -1;
    if (rope && used + 2 <= BOX_CAP) {
      ropeSlot = used; used += 2;
      // lina (ciemna) i obudowa kotwicy windy; macierze w writeBlocks
      BD.set([1, 1, 1, 0, 0.1, 0.1, 0.105, 0], ropeSlot * 8);
      BD.set([46, 46, 34, 0, 0.2, 0.19, 0.17, 0], (ropeSlot + 1) * 8);
    }
    for (let i = 0; i < sceneryCount; i++) {
      const s = scenery[i], w = (sceneryBase + i) * 8;
      BD[w] = 2 * s.hx; BD[w + 1] = 2 * s.hy; BD[w + 2] = 2 * s.hz; BD[w + 3] = 0;
      BD[w + 4] = s.r; BD[w + 5] = s.g; BD[w + 6] = s.b; BD[w + 7] = 0;
    }
    supports = scenery.filter((s) => s.support).map((s) => ({ x0: s.x - s.hx, x1: s.x + s.hx, y0: s.y - s.hy, y1: s.y + s.hy, z: s.z + s.hz, hidden: false, ref: s }));
    boxIb.needsUpdate = true;
    blocks.count = used;
    // pule efektów od zera
    for (let i = 0; i < STONE_CAP; i++) ST[i * SW + 15] = -1;
    for (let i = 0; i < DUST_CAP; i++) DS[i * DW + 7] = -1;
    for (let i = 0; i < GLOW_CAP; i++) GS[i * GW + 7] = -1;
    for (let i = 0; i < BEAM_CAP; i++) BS[i * BW + 8] = -1;
    stoneHead = dustHead = glowHead = beamHead = 0;
    SM.fill(0); stones.count = 0; stones.instanceMatrix.needsUpdate = true;
    dust.count = 0; glow.count = 0; beamGeo.instanceCount = 0;
    stats.stones = stats.dust = stats.glow = stats.beams = 0;
    lastSaveTick = -1;
    if (shadow) setShadow(shadow.x, shadow.y, shadow.z, shadow.r);
  }

  function setShadow(cx, cy, cz, r) {
    sun.target.position.set(cx, cy, cz);
    sun.position.set(cx + sunDir.x * 12000, cy + sunDir.y * 12000, cz + sunDir.z * 12000);
    const c = sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 100; c.far = 26000;
    c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
  }

  /** Sceneria w biegu (okręt, zniszczony pomost): zmiana pozy / ukrycie. */
  function setSceneryBox(i, patch) {
    const s = scenery[i];
    if (!s) return;
    Object.assign(s, patch);
    for (const sp of supports) if (sp.ref === s) { sp.x0 = s.x - s.hx; sp.x1 = s.x + s.hx; sp.y0 = s.y - s.hy; sp.y1 = s.y + s.hy; sp.z = s.z + s.hz; sp.hidden = !!s.hidden; }
  }

  // ── interpolacja póz klastrów ──
  /** Przed każdym krokiem fizyki: poza każdego żywego klastra jako „poprzednia” (tick — numer kroku). */
  // bufory póz rosną z listą klastrów gospodarza (narodziny w kroku — także między zapisem a klatką)
  function ensureCap(s) {
    const need = s.H.cls.length;
    if (s.pvTick.length >= need) return;
    const n = Math.max(need, 2 * s.pvTick.length);
    const pv = new Float64Array(7 * n); pv.set(s.pv); s.pv = pv;
    const pt = new Int32Array(n).fill(-9); pt.set(s.pvTick); s.pvTick = pt;
    const pc = new Float64Array(12 * n); pc.set(s.pc); s.pc = pc;
    const pf = new Int32Array(n).fill(-1); pf.set(s.pcFrame); s.pcFrame = pf;
  }

  function savePoses(tick) {
    for (const s of slots) {
      const cls = s.H.cls;
      ensureCap(s);
      for (let k = 0; k < cls.length; k++) {
        const r = cls[k];
        if (!r.alive) continue;
        const b = r.body, o = 7 * k;
        s.pv[o] = b.pos.x; s.pv[o + 1] = b.pos.y; s.pv[o + 2] = b.pos.z;
        s.pv[o + 3] = b.quat.x; s.pv[o + 4] = b.quat.y; s.pv[o + 5] = b.quat.z; s.pv[o + 6] = b.quat.w;
        s.pvTick[k] = tick;
      }
    }
    if (htSrc && htSrc.pose(htPrev)) htPrevTick = tick;
    lastSaveTick = tick;
  }

  // poza klastra k gospodarza s w klatce (alfa): pc[12k..] = pozycja (3) + macierz (9); raz na klatkę
  function clusterPose(s, k, alpha) {
    if (s.pcFrame[k] === frameNo) return 12 * k;
    s.pcFrame[k] = frameNo;
    const r = s.H.cls[k], b = r.body, o = 12 * k, pc = s.pc;
    let px = b.pos.x, py = b.pos.y, pz = b.pos.z, qx = b.quat.x, qy = b.quat.y, qz = b.quat.z, qw = b.quat.w;
    if (s.pvTick[k] === lastSaveTick && alpha < 1) {
      const p = 7 * k, pv = s.pv, ia = 1 - alpha;
      px = pv[p] * ia + px * alpha; py = pv[p + 1] * ia + py * alpha; pz = pv[p + 2] * ia + pz * alpha;
      let ax = pv[p + 3], ay = pv[p + 4], az = pv[p + 5], aw = pv[p + 6];
      if (ax * qx + ay * qy + az * qz + aw * qw < 0) { ax = -ax; ay = -ay; az = -az; aw = -aw; }
      qx = ax * ia + qx * alpha; qy = ay * ia + qy * alpha; qz = az * ia + qz * alpha; qw = aw * ia + qw * alpha;
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
      qx /= l; qy /= l; qz /= l; qw /= l;
    }
    pc[o] = px; pc[o + 1] = py; pc[o + 2] = pz;
    rotInto(qx, qy, qz, qw, pc, o + 3);
    return o;
  }

  // macierz instancji: środek p, obrót m (wiersze, 9) · Rz(yaw), skala 2h
  function writeMatrix(arr, slot, px, py, pz, m, mo, yaw, sx, sy, sz) {
    const c = Math.cos(yaw), s = Math.sin(yaw), w = slot * 16;
    // kolumny R·Rz(yaw)
    const c0x = m[mo] * c + m[mo + 1] * s, c0y = m[mo + 3] * c + m[mo + 4] * s, c0z = m[mo + 6] * c + m[mo + 7] * s;
    const c1x = -m[mo] * s + m[mo + 1] * c, c1y = -m[mo + 3] * s + m[mo + 4] * c, c1z = -m[mo + 6] * s + m[mo + 7] * c;
    arr[w] = c0x * sx; arr[w + 1] = c0y * sx; arr[w + 2] = c0z * sx; arr[w + 3] = 0;
    arr[w + 4] = c1x * sy; arr[w + 5] = c1y * sy; arr[w + 6] = c1z * sy; arr[w + 7] = 0;
    arr[w + 8] = m[mo + 2] * sz; arr[w + 9] = m[mo + 5] * sz; arr[w + 10] = m[mo + 8] * sz; arr[w + 11] = 0;
    arr[w + 12] = px; arr[w + 13] = py; arr[w + 14] = pz; arr[w + 15] = 1;
  }
  const ID9 = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);

  // rysy: wykorzystanie bloku (S.util, 255 = krytyczne) i najsłabsze wiązanie bloku (kratery, fala)
  function updateCracks() {
    let changed = false;
    for (const s of slots) {
      const A = s.H.A, S = s.H.S, minH = s.minH;
      minH.fill(1);
      for (let k = 0; k < A.e; k++) {
        if (!S.alive[k]) continue;
        const h = S.health[k];
        if (h < minH[A.ba[k]]) minH[A.ba[k]] = h;
        if (h < minH[A.bb[k]]) minH[A.bb[k]] = h;
      }
      for (let j = 0; j < s.boxBlock.length; j++) {
        const b = s.boxBlock[j];
        const u = S.util[b] / 255;
        let c = toggles.rysy ? Math.max(Math.min(1, Math.max(0, (u - 0.62) / 0.33)), Math.min(1, (1 - minH[b]) * 1.4)) : 0;
        c = Math.round(c * 20) / 20;
        const w = (s.base + j) * 8 + 7;
        if (BD[w] !== c) { BD[w] = c; changed = true; }
      }
    }
    if (changed) boxIb.needsUpdate = true;
  }

  function writeBlocks(alpha) {
    let nBlocks = 0;
    for (const s of slots) {
      const H = s.H, A = H.A, S = H.S, own = H.own, cls = H.cls, bd = A.boxData;
      ensureCap(s);
      for (let j = 0; j < s.boxBlock.length; j++) {
        const b = s.boxBlock[j], slot = s.base + j, o = own[b];
        if (o < 0 || S.dead[b] || !cls[o].alive || (s.hideStump && cls[o].kind === 1)) { BM.fill(0, slot * 16, slot * 16 + 16); continue; }
        const r = cls[o], f = r.f, po = clusterPose(s, o, alpha), pc = s.pc;
        const bo = j * STRUCT_BOX_STRIDE;
        const dx = bd[bo] - f[0], dy = bd[bo + 1] - f[1], dz = bd[bo + 2] - f[2];
        const m = po + 3;
        const px = pc[po] + pc[m] * dx + pc[m + 1] * dy + pc[m + 2] * dz;
        const py = pc[po + 1] + pc[m + 3] * dx + pc[m + 4] * dy + pc[m + 5] * dz;
        const pz = pc[po + 2] + pc[m + 6] * dx + pc[m + 7] * dy + pc[m + 8] * dz;
        writeMatrix(BM, slot, px, py, pz, pc, m, bd[bo + 6], 2 * bd[bo + 3], 2 * bd[bo + 4], 2 * bd[bo + 5]);
        nBlocks++;
      }
    }
    for (let i = 0; i < sceneryCount; i++) {
      const sc = scenery[i], slot = sceneryBase + i;
      if (sc.hidden) { BM.fill(0, slot * 16, slot * 16 + 16); continue; }
      writeMatrix(BM, slot, sc.x, sc.y, sc.z, ID9, 0, sc.yaw || 0, 2 * sc.hx, 2 * sc.hy, 2 * sc.hz);
    }
    if (ropeSlot >= 0) writeRope(alpha);
    blocks.instanceMatrix.needsUpdate = true;
    stats.blocks = nBlocks;
  }

  // lina windy (D17): wierzch bloku-kotwicy (poza klastra-właściciela — kikut albo wycinek w locie) → punkt na skale
  const _rp = { x: 0, y: 0, z: 0 };
  function writeRope(alpha) {
    const w0 = ropeSlot * 16;
    const s = slots.find((q) => q.H === rope.H);
    const H = rope.H, b = rope.block, o = H.own[b];
    if (!s || b < 0 || o < 0 || H.S.dead[b] || !H.cls[o].alive) { BM.fill(0, w0, w0 + 32); return; }
    const r = H.cls[o], f = r.f, po = clusterPose(s, o, alpha), pc = s.pc, m = po + 3, A = H.A;
    const dx = A.x[b] - f[0], dy = A.y[b] - f[1], dz = A.z[b] + 60 - f[2];
    _rp.x = pc[po] + pc[m] * dx + pc[m + 1] * dy + pc[m + 2] * dz;
    _rp.y = pc[po + 1] + pc[m + 3] * dx + pc[m + 4] * dy + pc[m + 5] * dz;
    _rp.z = pc[po + 2] + pc[m + 6] * dx + pc[m + 7] * dy + pc[m + 8] * dz;
    const bx = rope.bottom.x, by = rope.bottom.y, bz = rope.bottom.z;
    let ux = _rp.x - bx, uy = _rp.y - by, uz = _rp.z - bz;
    const L = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (!(L > 1)) { BM.fill(0, w0, w0 + 32); return; }
    ux /= L; uy /= L; uz /= L;
    // baza prostopadła do liny
    let ax = -uy, ay = ux, az = 0;
    let al = Math.sqrt(ax * ax + ay * ay);
    if (al < 1e-6) { ax = 1; ay = 0; al = 1; }
    ax /= al; ay /= al;
    const cx = uy * az - uz * ay, cy = uz * ax - ux * az, cz = ux * ay - uy * ax;
    const W = 12;
    BM[w0] = ax * W; BM[w0 + 1] = ay * W; BM[w0 + 2] = az * W; BM[w0 + 3] = 0;
    BM[w0 + 4] = cx * W; BM[w0 + 5] = cy * W; BM[w0 + 6] = cz * W; BM[w0 + 7] = 0;
    BM[w0 + 8] = ux * L; BM[w0 + 9] = uy * L; BM[w0 + 10] = uz * L; BM[w0 + 11] = 0;
    BM[w0 + 12] = (bx + _rp.x) / 2; BM[w0 + 13] = (by + _rp.y) / 2; BM[w0 + 14] = (bz + _rp.z) / 2; BM[w0 + 15] = 1;
    // obudowa kotwicy: obrót klastra, środek nad blokiem
    writeMatrix(BM, ropeSlot + 1, _rp.x, _rp.y, _rp.z - 10, pc, m, 0, 46, 46, 34);
  }

  // płyty: tekstura grubości przy zmianie F.version (wiersze nu → PM)
  function updatePlates() {
    for (const p of plates) {
      const F = p.F;
      if (!F || F.version === p.ver) continue;
      p.ver = F.version;
      const d = p.data, th = F.thick, PM = p.PM;
      d.fill(0);
      for (let iv = 0; iv < F.nv; iv++) for (let iu = 0; iu < F.nu; iu++) {
        const t = th[iu + iv * F.nu], o = 2 * (iu + iv * PM);
        d[o] = t; d[o + 1] = t > 0 ? 255 : 0;
      }
      p.tex.needsUpdate = true;
    }
  }

  // wieża H-T: poza układu F z interpolacją (poprzednia zapisana w savePoses)
  function updateHT(alpha) {
    if (!htSrc || !htSrc.pose(htCur)) { htMesh.visible = false; return; }
    htMesh.visible = true;
    let px = htCur.x, py = htCur.y, pz = htCur.z, qx = htCur.qx, qy = htCur.qy, qz = htCur.qz, qw = htCur.qw;
    if (htPrevTick === lastSaveTick && alpha < 1) {
      const a = alpha, ia = 1 - a, P = htPrev;
      px = P.x * ia + px * a; py = P.y * ia + py * a; pz = P.z * ia + pz * a;
      let bx = P.qx, by = P.qy, bz = P.qz, bw = P.qw;
      if (bx * qx + by * qy + bz * qz + bw * qw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      qx = bx * ia + qx * a; qy = by * ia + qy * a; qz = bz * ia + qz * a; qw = bw * ia + qw * a;
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
      qx /= l; qy /= l; qz /= l; qw /= l;
    }
    rotInto(qx, qy, qz, qw, _m, 0);
    htMesh.matrix.set(_m[0], _m[1], _m[2], px, _m[3], _m[4], _m[5], py, _m[6], _m[7], _m[8], pz, 0, 0, 0, 1);
    htMesh.matrixWorldNeedsUpdate = true;
  }

  // ── efekty: narodziny ──
  function spawnStone(x, y, z, vx, vy, vz, r, shade, g) {
    const i = stoneHead++ % STONE_CAP, o = i * SW;
    ST[o] = x; ST[o + 1] = y; ST[o + 2] = z; ST[o + 3] = vx; ST[o + 4] = vy; ST[o + 5] = vz;
    let ax = R() - 0.5, ay = R() - 0.5, az = R() - 0.5;
    const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ST[o + 6] = ax / l; ST[o + 7] = ay / l; ST[o + 8] = az / l;
    ST[o + 9] = (0.6 + R() * 3) * (R() < 0.5 ? -1 : 1); ST[o + 10] = R() * 6.283;
    ST[o + 11] = r * (0.75 + R() * 0.5); ST[o + 12] = r * (0.6 + R() * 0.5); ST[o + 13] = r * (0.45 + R() * 0.4);
    ST[o + 14] = g; ST[o + 15] = 0;
    const c = (0.24 + R() * 0.1) * shade, w = i * 4;
    stIb.array[w] = c; stIb.array[w + 1] = c * 0.985; stIb.array[w + 2] = c * 0.955;
    stIb.needsUpdate = true;
  }
  function spawnDust(x, y, z, vx, vy, vz, life, s0, s1, a, bright = 1, fall = 140) {
    if (!toggles.pyl) return;
    const i = dustHead++ % DUST_CAP, o = i * DW;
    DS[o] = x; DS[o + 1] = y; DS[o + 2] = z; DS[o + 3] = vx; DS[o + 4] = vy; DS[o + 5] = vz;
    DS[o + 6] = 0; DS[o + 7] = life; DS[o + 8] = s0; DS[o + 9] = s1; DS[o + 10] = a; DS[o + 11] = bright * (0.85 + R() * 0.3);
    DS[o + 12] = R() * 6.283; DS[o + 13] = (R() - 0.5) * 0.4; DS[o + 14] = R(); DS[o + 15] = fall;
  }
  function spawnGlow(x, y, z, life, s0, s1, r, g, b, vx = 0, vy = 0, vz = 0) {
    const i = glowHead++ % GLOW_CAP, o = i * GW;
    GS[o] = x; GS[o + 1] = y; GS[o + 2] = z; GS[o + 3] = vx; GS[o + 4] = vy; GS[o + 5] = vz;
    GS[o + 6] = 0; GS[o + 7] = life; GS[o + 8] = s0; GS[o + 9] = s1; GS[o + 10] = r; GS[o + 11] = g; GS[o + 12] = b;
  }
  function spawnBeam(ax, ay, az, bx, by, bz, width, life, r, g, b) {
    const i = beamHead++ % BEAM_CAP, o = i * BW;
    BS[o] = ax; BS[o + 1] = ay; BS[o + 2] = az; BS[o + 3] = bx; BS[o + 4] = by; BS[o + 5] = bz;
    BS[o + 6] = width; BS[o + 7] = 0; BS[o + 8] = life; BS[o + 9] = r; BS[o + 10] = g; BS[o + 11] = b;
  }

  // blok b gospodarza H w gruz obrazu: układ archetypu (O, q) → kamienie z objętości prostopadłościanów
  const _m = new Float64Array(9);
  function blockToStones(H, b, ox, oy, oz, qx, qy, qz, qw, vx, vy, vz, kind) {
    const A = H.A, bd = A.boxData, g = H.pose[8];
    rotInto(qx, qy, qz, qw, _m, 0);
    let vol = 0;
    for (let j = A.boxStart[b]; j < A.boxStart[b + 1]; j++) { const o = j * STRUCT_BOX_STRIDE; vol += 8 * bd[o + 3] * bd[o + 4] * bd[o + 5]; }
    if (!(vol > 0)) return;
    const n = 6 + Math.floor(R() * 5);
    const spread = kind === 2 ? 70 : 28;
    for (let j = A.boxStart[b]; j < A.boxStart[b + 1]; j++) {
      const o = j * STRUCT_BOX_STRIDE, hx = bd[o + 3], hy = bd[o + 4], hz = bd[o + 5], yaw = bd[o + 6];
      const share = (8 * hx * hy * hz) / vol, k = Math.max(1, Math.round(n * share));
      const rMax = Math.min(Math.cbrt((8 * hx * hy * hz) / k) * 0.75, Math.max(hx, hy, hz) * 0.8);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < k; i++) {
        const lx = (R() * 2 - 1) * hx * 0.8, ly = (R() * 2 - 1) * hy * 0.8, lz = (R() * 2 - 1) * hz * 0.8;
        const ax = bd[o] + cy * lx - sy * ly, ay = bd[o + 1] + sy * lx + cy * ly, az = bd[o + 2] + lz;
        const wx = ox + _m[0] * ax + _m[1] * ay + _m[2] * az;
        const wy = oy + _m[3] * ax + _m[4] * ay + _m[5] * az;
        const wz = oz + _m[6] * ax + _m[7] * ay + _m[8] * az;
        // potęgowo: dużo małych, kilka dużych
        const u = R(), r = Math.max(5, rMax * (0.3 + 0.7 * u * u));
        spawnStone(wx, wy, wz, vx + (R() - 0.5) * 2 * spread, vy + (R() - 0.5) * 2 * spread, vz + R() * spread * 0.6, r, 1, g);
      }
    }
    // pył z bloku
    const cx = ox + _m[0] * A.x[b] + _m[1] * A.y[b] + _m[2] * A.z[b];
    const cy2 = oy + _m[3] * A.x[b] + _m[4] * A.y[b] + _m[5] * A.z[b];
    const cz = oz + _m[6] * A.x[b] + _m[7] * A.y[b] + _m[8] * A.z[b];
    if (R() < 0.6) spawnDust(cx, cy2, cz, vx * 0.6 + (R() - 0.5) * 40, vy * 0.6 + (R() - 0.5) * 40, vz * 0.6, 4 + R() * 3, 50, 190 + R() * 90, 0.26, 1, 0.6 * g);
  }

  /**
   * Rekordy gospodarzy od ostatniego odczytu → efekty. ctx.muzzle(x, y, z, dx, dy, dz, out) — wylot smugi trafienia (out
   * {x, y, z}); ctx.weaponFx[a] — wygląd broni (barwa, błysk).
   */
  const _mz = { x: 0, y: 0, z: 0 };
  function consumeRecords(ctx) {
    for (const s of slots) {
      const H = s.H, rec = H.rec, buf = rec.buf;
      if (s.cursor === undefined) s.cursor = 0;
      if (rec.head - s.cursor > rec.cap) s.cursor = rec.head - rec.cap;
      for (; s.cursor < rec.head; s.cursor++) {
        const o = (s.cursor % rec.cap) * rec.stride, type = buf[o];
        const x = buf[o + 2], y = buf[o + 3], z = buf[o + 4], vx = buf[o + 5], vy = buf[o + 6], vz = buf[o + 7];
        if (type === COLLAPSE_REC.DEBRIS) {
          if (toggles.gruz) blockToStones(H, buf[o + 13] | 0, x, y, z, buf[o + 8], buf[o + 9], buf[o + 10], buf[o + 11], vx, vy, vz, buf[o + 14]);
        } else if (type === COLLAPSE_REC.RING) {
          const Rr = buf[o + 14] || 280;
          // kołnierz pyłu kondygnacji: na boki z obwodu, opada z gruzem (D2 — cząstki, bez gazu)
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * 6.283 + R() * 0.4, c = Math.cos(a), sn = Math.sin(a), sp = 90 + R() * 120;
            spawnDust(x + c * Rr, y + sn * Rr, z, c * sp + vx * 0.4, sn * sp + vy * 0.4, vz * 0.5, 3.5 + R() * 3, 70, 230 + R() * 110, 0.3, 1, 0.5 * H.pose[8]);
          }
          if (toggles.gruz) {
            for (let i = 0; i < 14; i++) {
              const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), sp = 40 + R() * 120;
              spawnStone(x + c * Rr, y + sn * Rr, z, c * sp + vx, sn * sp + vy, vz + R() * 30, 8 + R() * 22, 1, H.pose[8]);
            }
          }
        } else if (type === COLLAPSE_REC.CHIP) {
          const fx = (ctx.weaponFx && ctx.weaponFx[buf[o + 13] | 0]) || { r: 7, g: 4, b: 1.6, flash: 150, width: 7 };
          ctx.muzzle(x, y, z, vx, vy, vz, _mz);
          spawnBeam(_mz.x, _mz.y, _mz.z, x, y, z, fx.width, 0.16, fx.r, fx.g, fx.b);
          spawnGlow(x, y, z, 0.32, fx.flash * 0.6, fx.flash, fx.r * 1.4, fx.g * 1.4, fx.b * 1.4);
          spawnGlow(x, y, z, 0.12, fx.flash * 0.25, fx.flash * 0.45, 9, 8, 7);
          if (fx.ring) {
            for (let i = 0; i < 22; i++) {
              const a = (i / 22) * 6.283, c = Math.cos(a), sn = Math.sin(a);
              spawnDust(x, y, z, c * 260, sn * 260, (R() - 0.5) * 60, 3 + R() * 2, 80, 420, 0.3, 1.2);
            }
          }
          if (toggles.gruz) {
            for (let i = 0; i < 7; i++) {
              const sp = 120 + R() * 240;
              spawnStone(x, y, z, -vx * sp + (R() - 0.5) * 160, -vy * sp + (R() - 0.5) * 160, 40 + R() * 140, 3 + R() * 6, 1.05, H.pose[8]);
            }
          }
          for (let i = 0; i < 3; i++) spawnDust(x, y, z, -vx * 40 + (R() - 0.5) * 40, -vy * 40 + (R() - 0.5) * 40, (R() - 0.3) * 20, 2.5 + R() * 2, 40, 190 + R() * 80, 0.38);
        } else if (type === COLLAPSE_REC.DUST) {
          const gz = groundAt(x, y);
          const n = 10 + Math.min(18, Math.floor(Math.log10(1 + buf[o + 12]) * 2));
          for (let i = 0; i < n; i++) {
            const a = R() * 6.283, c = Math.cos(a), sn = Math.sin(a), d = 120 + R() * 260, sp = 50 + R() * 120;
            spawnDust(x + c * d, y + sn * d, gz + 20 + R() * 40, c * sp + vx * 0.2, sn * sp + vy * 0.2, 5 + R() * 12, 5 + R() * 4, 90, 300 + R() * 160, 0.3);
          }
        } else if (type === COLLAPSE_REC.CRACK) {
          for (let i = 0; i < 4; i++) spawnDust(x + (R() - 0.5) * 60, y + (R() - 0.5) * 60, z, (R() - 0.5) * 40, (R() - 0.5) * 40, 4, 3 + R() * 2, 30, 140, 0.35);
          if (toggles.gruz) for (let i = 0; i < 4; i++) spawnStone(x, y, z, (R() - 0.5) * 60, (R() - 0.5) * 60, 20 + R() * 30, 3 + R() * 5, 1, H.pose[8]);
        }
      }
    }
    // otwory pola płyty (wiązanie z grafem — structurePlate): zjedzona masa komórki leci z prędkością wieży, rozrzut na boki
    for (const p of plates) {
      const Pb = p.Pb;
      if (!Pb) continue;
      const rec = Pb.rec, buf = rec.buf, g = Pb.A.g;
      if (rec.head - p.cursor > rec.cap) p.cursor = rec.head - rec.cap;
      for (; p.cursor < rec.head; p.cursor++) {
        const o = (p.cursor % rec.cap) * rec.stride;
        const x = buf[o], y = buf[o + 1], z = buf[o + 2] + 0.5 * p.F.unit * p.F.thick0[buf[o + 7] | 0];
        const vx = buf[o + 3], vy = buf[o + 4], vz = buf[o + 5];
        if (toggles.gruz) {
          const k = R() < 0.6 ? 1 : 2;
          for (let i = 0; i < k; i++) {
            const a = R() * 6.283, sp = 30 + R() * 140;
            spawnStone(x + (R() - 0.5) * 40, y + (R() - 0.5) * 40, z, vx * 0.85 + Math.cos(a) * sp, vy * 0.85 + Math.sin(a) * sp, vz * 0.85 + (R() - 0.5) * 60, 8 + R() * 18, 1, g);
          }
        }
        if (R() < 0.2) spawnDust(x, y, z, vx * 0.3 + (R() - 0.5) * 120, vy * 0.3 + (R() - 0.5) * 120, vz * 0.2, 4 + R() * 3, 60, 260 + R() * 140, 0.28, 1, 0.3 * g);
      }
    }
  }

  // ── efekty: krok (dt — czas pokazu) ──
  let landPuffs = 0;
  function updateFx(dt) {
    landPuffs = 0;
    // kamienie
    let nSt = Math.min(stoneHead, STONE_CAP), stDirty = false;
    for (let i = 0; i < nSt; i++) {
      const o = i * SW;
      const st = ST[o + 15];
      if (st === -1) { if (SM[i * 16 + 15] !== 0) { SM.fill(0, i * 16, i * 16 + 16); stDirty = true; } continue; }
      if (st === 1 && SM[i * 16 + 15] === 1) continue;
      if (st === 0 && dt > 0) {
        const g = ST[o + 14];
        ST[o + 5] -= g * dt;
        ST[o] += ST[o + 3] * dt; ST[o + 1] += ST[o + 4] * dt; ST[o + 2] += ST[o + 5] * dt;
        ST[o + 10] += ST[o + 9] * dt;
        const gz = groundAt(ST[o], ST[o + 1]), rz = ST[o + 13];
        if (ST[o + 2] - rz < gz) {
          const sp = -ST[o + 5];
          ST[o + 2] = gz + rz * 0.7;
          // obłoczek przy lądowaniu większego kamienia (co czwarty, ≤ 6 na klatkę — inaczej front zasypuje kadr pyłem)
          if (sp > 70 && ST[o + 11] > 9 && landPuffs < 6 && toggles.pyl && R() < 0.25) {
            landPuffs++;
            spawnDust(ST[o], ST[o + 1], gz + rz, (R() - 0.5) * 40, (R() - 0.5) * 40, 6, 2.5 + R() * 2, rz * 3, rz * 8 + 50, 0.24);
          }
          // odbicie raz, potem leży
          if (sp > 90 && ST[o + 9] !== 0) { ST[o + 5] = sp * 0.22; ST[o + 3] *= 0.45; ST[o + 4] *= 0.45; ST[o + 9] *= 0.5; }
          else { ST[o + 15] = 1; ST[o + 3] = ST[o + 4] = ST[o + 5] = 0; }
        }
      }
      // macierz z osi i kąta (Rodrigues) × skala
      const ax = ST[o + 6], ay = ST[o + 7], az = ST[o + 8], an = ST[o + 10], c = Math.cos(an), s = Math.sin(an), t = 1 - c;
      const sx = ST[o + 11], sy = ST[o + 12], sz = ST[o + 13], w = i * 16;
      SM[w] = (t * ax * ax + c) * sx; SM[w + 1] = (t * ax * ay + s * az) * sx; SM[w + 2] = (t * ax * az - s * ay) * sx; SM[w + 3] = 0;
      SM[w + 4] = (t * ax * ay - s * az) * sy; SM[w + 5] = (t * ay * ay + c) * sy; SM[w + 6] = (t * ay * az + s * ax) * sy; SM[w + 7] = 0;
      SM[w + 8] = (t * ax * az + s * ay) * sz; SM[w + 9] = (t * ay * az - s * ax) * sz; SM[w + 10] = (t * az * az + c) * sz; SM[w + 11] = 0;
      SM[w + 12] = ST[o]; SM[w + 13] = ST[o + 1]; SM[w + 14] = ST[o + 2]; SM[w + 15] = 1;
      stDirty = true;
    }
    if (!toggles.gruz) nSt = 0;
    stones.count = nSt;
    stones.visible = nSt > 0;
    if (stDirty) stones.instanceMatrix.needsUpdate = true;
    stats.stones = nSt;

    // pył
    const nDu = Math.min(dustHead, DUST_CAP);
    let liveDu = 0;
    const drag = Math.exp(-0.9 * dt);
    for (let i = 0; i < nDu; i++) {
      const o = i * DW, w = i * 8;
      if (DS[o + 7] < 0) { DD[w + 3] = 0; continue; }
      DS[o + 6] += dt;
      const life = DS[o + 7], age = DS[o + 6];
      if (age >= life) { DS[o + 7] = -1; DD[w + 3] = 0; continue; }
      const k = age / life, grow = 1 - (1 - k) * (1 - k);
      const size = DS[o + 8] + (DS[o + 9] - DS[o + 8]) * grow;
      // próżnia planetoidy: pył nad gruntem opada (ułamek g), przy gruncie rozpływa się na boki
      const floor = groundAt(DS[o], DS[o + 1]) + size * 0.3;
      DS[o + 3] *= drag; DS[o + 4] *= drag;
      if (DS[o + 2] > floor + 1) DS[o + 5] = DS[o + 5] * drag - DS[o + 15] * dt;
      else DS[o + 5] = Math.max(0, DS[o + 5]) * drag;
      DS[o] += DS[o + 3] * dt; DS[o + 1] += DS[o + 4] * dt; DS[o + 2] += DS[o + 5] * dt;
      if (DS[o + 2] < floor) { DS[o + 2] = floor; if (DS[o + 5] < 0) DS[o + 5] = 0; }
      DS[o + 12] += DS[o + 13] * dt;
      const fadeIn = Math.min(1, age / 0.25), fade = (1 - k) * (1 - k * 0.4);
      DD[w] = DS[o]; DD[w + 1] = DS[o + 1]; DD[w + 2] = DS[o + 2]; DD[w + 3] = size;
      DD[w + 4] = DS[o + 11]; DD[w + 5] = DS[o + 10] * fadeIn * fade; DD[w + 6] = DS[o + 12]; DD[w + 7] = DS[o + 14];
      liveDu++;
    }
    dust.count = nDu;
    dust.visible = liveDu > 0 && toggles.pyl;
    duIb.needsUpdate = true;
    stats.dust = liveDu;

    // błyski
    const nGl = Math.min(glowHead, GLOW_CAP);
    let liveGl = 0;
    for (let i = 0; i < nGl; i++) {
      const o = i * GW, w = i * 8;
      if (GS[o + 7] < 0) { GD[w + 3] = 0; continue; }
      GS[o + 6] += dt;
      const life = GS[o + 7], age = GS[o + 6];
      if (age >= life) { GS[o + 7] = -1; GD[w + 3] = 0; continue; }
      GS[o] += GS[o + 3] * dt; GS[o + 1] += GS[o + 4] * dt; GS[o + 2] += GS[o + 5] * dt;
      const k = age / life, f = (1 - k) * (1 - k);
      GD[w] = GS[o]; GD[w + 1] = GS[o + 1]; GD[w + 2] = GS[o + 2]; GD[w + 3] = GS[o + 8] + (GS[o + 9] - GS[o + 8]) * Math.sqrt(k);
      GD[w + 4] = GS[o + 10] * f; GD[w + 5] = GS[o + 11] * f; GD[w + 6] = GS[o + 12] * f; GD[w + 7] = 0;
      liveGl++;
    }
    glow.count = nGl;
    glow.visible = liveGl > 0;
    glIb.needsUpdate = true;
    stats.glow = liveGl;

    // smugi
    const nBm = Math.min(beamHead, BEAM_CAP);
    let liveBm = 0;
    for (let i = 0; i < nBm; i++) {
      const o = i * BW, w = i * 12;
      if (BS[o + 8] < 0) { BMD[w + 7] = 0; BMD[w + 3] = 0; continue; }
      BS[o + 7] += dt;
      const life = BS[o + 8], age = BS[o + 7];
      if (age >= life) { BS[o + 8] = -1; BMD[w + 7] = 0; BMD[w + 3] = 0; continue; }
      const k = age / life;
      BMD[w] = BS[o]; BMD[w + 1] = BS[o + 1]; BMD[w + 2] = BS[o + 2]; BMD[w + 3] = BS[o + 6] * (1 - 0.5 * k);
      BMD[w + 4] = BS[o + 3]; BMD[w + 5] = BS[o + 4]; BMD[w + 6] = BS[o + 5]; BMD[w + 7] = (1 - k) * (1 - k);
      BMD[w + 8] = BS[o + 9]; BMD[w + 9] = BS[o + 10]; BMD[w + 10] = BS[o + 11]; BMD[w + 11] = 0;
      liveBm++;
    }
    beamGeo.instanceCount = nBm;
    beams.visible = liveBm > 0;
    bmIb.needsUpdate = true;
    stats.beams = liveBm;
  }

  // ── klatka ──
  let viewW = 1, viewH = 1;
  function resize(w, h) {
    viewW = Math.max(1, w | 0); viewH = Math.max(1, h | 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(viewW, viewH, false);
    const pr = renderer.getPixelRatio();
    post.resize(Math.max(1, Math.floor(viewW * pr)), Math.max(1, Math.floor(viewH * pr)));
    persp.aspect = viewW / viewH;
    persp.updateProjectionMatrix();
  }

  function drawScene(cam) {
    post.begin();
    renderer.render(scene, cam);
    post.finish();
  }

  /** Klatka: bloki (alfa interpolacji), rysy co kilka klatek, render kamerą `cam`. */
  function render(cam, alpha) {
    const t0 = performance.now();
    frameNo++;
    if (frameNo % 6 === 1) updateCracks();
    writeBlocks(alpha);
    updatePlates();
    updateHT(alpha);
    renderer.info.reset();
    drawScene(cam);
    stats.draws = renderer.info.render.drawCalls;
    stats.tris = renderer.info.render.triangles;
    stats.frameCpuMs = performance.now() - t0;
  }

  /** Rozgrzewka: pule z licznikiem ≥ 2, compileAsync (cel postu) każdą kamerą, potem 2 klatki (cień, bloom). */
  async function warmup() {
    const t0 = performance.now();
    const keep = { b: blocks.count, s: stones.count, d: dust.count, g: glow.count, m: beamGeo.instanceCount };
    blocks.count = Math.max(2, keep.b); stones.count = 2; dust.count = 2; glow.count = 2; beamGeo.instanceCount = 2;
    for (const o of [blocks, stones, dust, glow, beams]) o.visible = true;
    // płyty i wieża H-T: widoczne na czas rozgrzewki (scena startowa może ich nie mieć — 4 i 5 włącza się w biegu)
    const keepVis = [...plates.map((p) => p.mesh), htMesh].map((o) => [o, o.visible]);
    for (const [o] of keepVis) o.visible = true;
    persp.position.set(0, -4000, 1500); persp.lookAt(0, 0, 500); persp.updateMatrixWorld();
    ortho.position.set(0, 0, 20000); ortho.lookAt(0, 0, 0); ortho.updateMatrixWorld();
    post.begin();
    for (const cam of [persp, ortho]) await compileAsyncNaCelu(renderer, scene, cam);
    renderer.setRenderTarget(null);
    for (let k = 0; k < 2; k++) for (const cam of [persp, ortho]) drawScene(cam);
    await renderer.backend.device.queue.onSubmittedWorkDone();
    blocks.count = keep.b; stones.count = keep.s; dust.count = keep.d; glow.count = keep.g; beamGeo.instanceCount = keep.m;
    for (const [o, v] of keepVis) o.visible = v;
    stats.counting = true;
    stats.warmupMs = performance.now() - t0;
    return stats.warmupMs;
  }

  /**
   * Promień (o, d) wobec prostopadłościanów gospodarzy (stan z ostatniej klatki): pierwszy trafiony { t, host, block,
   * stump } albo null. Sceneria pomijana. Do strzału LPM (broń trafia tylko kikut — zapytania broni klastry mijają).
   */
  function raycastBoxes(ox, oy, oz, dx, dy, dz, tMax) {
    let best = null, bestT = tMax;
    for (const s of slots) {
      for (let j = 0; j < s.boxBlock.length; j++) {
        const w = (s.base + j) * 16;
        if (BM[w + 15] !== 1) continue;
        let tn = -Infinity, tf = Infinity, ok = true;
        const px = BM[w + 12] - ox, py = BM[w + 13] - oy, pz = BM[w + 14] - oz;
        for (let a = 0; a < 3 && ok; a++) {
          const cx = BM[w + 4 * a], cy = BM[w + 4 * a + 1], cz = BM[w + 4 * a + 2];
          const l = Math.sqrt(cx * cx + cy * cy + cz * cz);
          if (!(l > 0)) { ok = false; break; }
          const ux = cx / l, uy = cy / l, uz = cz / l, h = l * 0.5;
          const e = ux * px + uy * py + uz * pz, f = ux * dx + uy * dy + uz * dz;
          if (Math.abs(f) > 1e-9) {
            let t1 = (e + h) / f, t2 = (e - h) / f;
            if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
            if (t1 > tn) tn = t1;
            if (t2 < tf) tf = t2;
            if (tn > tf || tf < 0) ok = false;
          } else if (-e - h > 0 || -e + h < 0) ok = false;
        }
        if (ok && tn > 0 && tn < bestT) {
          const b = s.boxBlock[j], o = s.H.own[b];
          bestT = tn;
          best = { t: tn, H: s.H, block: b, stump: o >= 0 && s.H.cls[o].kind === 1 };
        }
      }
    }
    return best;
  }

  /** Środek gruzu obrazu (kamienie w promieniu r od (x, y)) do out {x, y, z} albo null — kamera „Zbliż: gruz”. */
  function debrisCenter(x, y, r, out) {
    let n = 0, sx = 0, sy = 0, sz = 0;
    const nSt = Math.min(stoneHead, STONE_CAP), r2 = r * r;
    for (let i = 0; i < nSt; i++) {
      const o = i * SW;
      if (ST[o + 15] < 0) continue;
      const dx = ST[o] - x, dy = ST[o + 1] - y;
      if (dx * dx + dy * dy > r2) continue;
      sx += ST[o]; sy += ST[o + 1]; sz += ST[o + 2]; n++;
    }
    if (n < 8) return null;
    out.x = sx / n; out.y = sy / n; out.z = sz / n;
    return out;
  }

  return {
    renderer, scene, persp, ortho, sun, hemi, sky, post, stats, toggles, debrisCenter,
    setScene, setSceneryBox, setShadow, savePoses, consumeRecords, updateFx, render, resize, warmup, raycastBoxes, setHTGeometry,
    spawnGlow, spawnBeam, spawnDust, spawnStone, groundAt,
    get view() { return { w: viewW, h: viewH }; },
    placeholders: () => getPlaceholderStats().builds,
    fxCounts: () => ({ stones: stats.stones, dust: stats.dust, glow: stats.glow, beams: stats.beams })
  };
}
