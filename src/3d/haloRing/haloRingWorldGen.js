// Mapy habitatu pieczone na GPU (render-to-texture), raz na przebudowę.
//
// Mapa to „projekt” świata: gdzie morza, góry, rzeki, lasy, miasta. Detal
// poniżej teksela dokłada shader powierzchni z kafelkowych tekstur szumu,
// więc mapa nie musi mieć rozdzielczości metra. Współrzędne mapy:
//   u = θ / 2π (wzdłuż ringu, zawija się), v = t / Wf (w poprzek podłogi).
// Szum jest liczony na walcu (x, y) = R·(cos θ, sin θ), więc mapa jest
// bezszwowa na u = 0/1 bez żadnych sztuczek.
//
//   mapA RGBA16F: wysokość [j.], odległość od rzeki [j.], wilgotność, temperatura
//   mapB RGBA8:   wagi typów sektorów (krajobraz, miasto-ogród, przemysł, szkło)
//   mapC RGBA8:   las, zabudowa, odsłonięta konstrukcja, skała
//
// Pierwsza klatka dostaje mapę niskiej rozdzielczości w jednym przebiegu,
// pełna rozdzielczość dopieka się plastrami w tle (brief §12).
import * as THREE from 'three';
import { HALO_GLSL_COMMON, HALO_GLSL_NOISE, HALO_GLSL_PORTSITES } from './haloRingGLSL.js';
import { HALO_SECTOR_TYPES, HALO_TERRAIN } from './haloRingConfig.js';
import { haloPortTileUniforms } from './haloRingUniforms.js';
import { HALO_LANDMARK } from './haloRingLandmarks.js';

const MAX_SECTORS = 32;
const RIVERS = 3;
const MAX_LANDMARKS = HALO_LANDMARK.maxCount;

const BAKE_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Funkcje świata — wspólne dla trzech wyjść (A/B/C). Tylko ASCII w GLSL.
const WORLD_GLSL = /* glsl */`
uniform vec4 uGeo;          // L, Wf, wallHeight, floorMid
uniform vec4 uNoiseOff;
uniform float uSectorCount;
uniform float uSectorStart;
uniform float uSectorSpan;
uniform float uSectorType[${MAX_SECTORS}];
uniform vec4 uSectorClimate[${MAX_SECTORS}];
uniform float uSectorPort[${MAX_SECTORS}];
uniform vec4 uRiverA[${RIVERS}];
uniform vec3 uRiverM1[${RIVERS}];
uniform vec3 uRiverM2[${RIVERS}];
uniform vec3 uRiverM3[${RIVERS}];
uniform vec4 uRegion;       // u0, v0, u1, v1 pieczonego plastra
uniform float uSeaDepth;
uniform float uLandmarkCount;
uniform vec4 uLandmarkA[${MAX_LANDMARKS}];   // s srodka, pol-dlugosc plyty wzdluz, t srodka, pol-szerokosc w poprzek
uniform vec4 uLandmarkB[${MAX_LANDMARKS}];   // wysokosc placu, trawnik, rampa, -
varying vec2 vUv;
${HALO_GLSL_PORTSITES}

// Place pod megabudowlami (haloRingLandmarks.js): x = waga placu (1 na plycie
// i trawniku, rampa do terenu), y = rdzen pod plyta (ukryty pod kamienna
// plyta: bez drzew i detalu), z = wysokosc placu, w = obrzeze plyty.
vec4 haloLandmarkPlaza(float s, float t, float L) {
  vec4 best = vec4(0.0);
  for (int i = 0; i < ${MAX_LANDMARKS}; i++) {
    if (float(i) >= uLandmarkCount) break;
    vec4 A = uLandmarkA[i];
    vec4 B = uLandmarkB[i];
    float ds = s - A.x;
    ds -= L * floor(ds / L + 0.5);
    float d = max(abs(ds) - A.y, abs(t - A.z) - A.w);
    float w = 1.0 - smoothstep(B.y, B.y + B.z, d);
    if (w > best.x) best = vec4(w, 1.0 - smoothstep(-70.0, -40.0, d), B.x, 1.0 - smoothstep(0.0, 80.0, d));
  }
  return best;
}

vec3 cylP(float s, float t, float scale) {
  float th = s / uGeo.x * HALO_TAU;
  float Rn = uGeo.x / HALO_TAU;
  return vec3(cos(th) * Rn, sin(th) * Rn, t) / scale + uNoiseOff.xyz;
}
float fbm3(vec3 p, int oct) {
  float a = 0.5;
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += a * haloGnoise3(p);
    p = p * 2.03 + vec3(17.1, 9.3, 5.7);
    a *= 0.5;
  }
  return sum;
}
float ridged3(vec3 p, int oct) {
  float a = 0.5;
  float sum = 0.0;
  float wgt = 1.0;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    float n = 1.0 - abs(haloGnoise3(p));
    n = n * n;
    sum += a * n * wgt;
    wgt = clamp(n * 1.7, 0.0, 1.0);
    p = p * 2.07 + vec3(3.3, 11.9, 7.1);
    a *= 0.5;
  }
  return sum;
}
vec4 typeOneHot(float k) {
  return vec4(step(abs(k - 0.0), 0.1), step(abs(k - 1.0), 0.1), step(abs(k - 2.0), 0.1), step(abs(k - 3.0), 0.1));
}

struct HaloWorld {
  float h;
  float riverDist;
  float moist;
  float temp;
  vec4 typeW;
  float forest;
  float urban;
  float exposed;
  float rock;
};

HaloWorld haloWorldAt(float s, float t) {
  HaloWorld W;
  float L = uGeo.x;
  float Wf = uGeo.y;
  float wallH = uGeo.z;
  float v = clamp(t / Wf, 0.0, 1.0);
  float theta = s / L * HALO_TAU;

  // --- sektory: przejscia na ~1/3 sektora, granica falowana szumem
  float x = mod(theta - uSectorStart, HALO_TAU) / uSectorSpan;
  x += haloGnoise3(cylP(s, t, 4200.0) + 31.0) * 0.1;
  float k = floor(x);
  float f = x - k;
  float b = 1.0 / 6.0;
  float wk = 1.0;
  float wo = 0.0;
  float ko = k;
  if (f < b) {
    float a = smoothstep(0.0, 1.0, (f + b) / (2.0 * b));
    wk = a; wo = 1.0 - a; ko = k - 1.0;
  } else if (f > 1.0 - b) {
    float a = smoothstep(0.0, 1.0, (f - (1.0 - b)) / (2.0 * b));
    wk = 1.0 - a; wo = a; ko = k + 1.0;
  }
  int ik = int(mod(k, uSectorCount));
  int io = int(mod(ko, uSectorCount));
  vec4 typeW = typeOneHot(uSectorType[ik]) * wk + typeOneHot(uSectorType[io]) * wo;
  vec4 cl = uSectorClimate[ik] * wk + uSectorClimate[io] * wo;
  // --- strefy wokol dokow (poprawki uzytkownika 2026-09-23): plyta doku ->
  // pas fabryczny (przemysl TYLKO wokol dokow) -> osady tam, gdzie nie ma gor
  // -> sektor jak byl; granice zafalowane szumem. Gory sektora przy brzegach
  // wstegi (scianach) moga zostac tuz obok dokow — nie musza.
  float zWarp = fbm3(cylP(s, t, 1700.0) + 13.0, 3) * 520.0;
  vec4 pz = haloPortZones(s, t, L, zWarp);
  float zInd = pz.x;
  // nad dokiem (strona kamery gry) teren niski: bez gor, pas fabryczny i osady
  float zShield = pz.w;
  float zNear = max(zInd, zShield);
  typeW = typeW * (1.0 - zInd) + vec4(0.0, 0.0, zInd, 0.0);
  // plac pod megabudowla: plasko, lad, bez rzek, zabudowy i lasu
  vec4 lmP = haloLandmarkPlaza(s, t, L);
  float lmW = lmP.x;

  // --- kontynenty i morza (zawinieta domena, okresowa na walcu)
  vec3 q = cylP(s, t, 14000.0);
  vec3 warp = vec3(fbm3(q + 3.1, 3), fbm3(q + 7.7, 3), fbm3(q + 11.3, 3));
  float cont = fbm3(cylP(s, t, 7200.0) + warp * 0.9, 6);
  float thr = (cl.x - 0.5) * 0.72;
  float wallZone = 1.0 - smoothstep(0.0, 0.27, min(v, 1.0 - v));
  float mountAmt = cl.y;
  float e = cont - thr + wallZone * mountAmt * 0.32;
  e = mix(e, max(e, 0.22), zNear);  // pod pasem fabrycznym i nad dokiem lad, nie morze
  e = mix(e, max(e, 0.3), lmW);
  float coast = smoothstep(-0.015, 0.015, e);
  float seaH = -8.0 - uSeaDepth * smoothstep(0.0, 0.3, -e);

  // --- gory: pasma przy scianach + grzbiety wewnatrz, do ~60% wysokosci scian
  float hMax = wallH * 0.6;
  float rid = ridged3(cylP(s, t, 3600.0) + warp * 0.45, 6);
  float ranges = smoothstep(0.42, 0.8, fbm3(cylP(s, t, 11000.0) + 5.0, 3) + 0.5);
  float mMask = clamp(wallZone * 0.95 + ranges * 0.5, 0.0, 1.0) * mountAmt;
  float mountains = pow(max(rid, 0.0), 1.7) * mMask * hMax * 1.35 * (1.0 - zShield);
  // osady przy porcie tylko tam, gdzie teren sektora nie ma gor
  float zRes = pz.y * (1.0 - zInd) * (1.0 - smoothstep(0.1, 0.28, mountains / max(hMax, 1.0)));
  typeW = typeW * (1.0 - zRes) + vec4(0.0, zRes, 0.0, 0.0);
  float hills = (fbm3(cylP(s, t, 1500.0) + 2.0, 4) * 0.5 + 0.5) * (14.0 + 55.0 * mountAmt);
  float landBase = 3.0 + 60.0 * smoothstep(0.0, 0.5, e);
  float landH = landBase + hills * smoothstep(0.0, 0.12, e) + mountains * smoothstep(-0.05, 0.25, e + wallZone * 0.3);

  // pustynia: wydmy wzdluz wstegi + mesy tarasowe
  float desert = smoothstep(0.3, 0.12, cl.w) * smoothstep(0.6, 0.85, cl.z);
  vec3 dp = cylP(s, t, 520.0);
  dp.z = t / 150.0 + uNoiseOff.w;
  float dunes = pow(1.0 - abs(haloGnoise3(dp + warp)), 3.0) * 24.0;
  float mesaN = fbm3(cylP(s, t, 2600.0) + 21.0, 4);
  float mesa = smoothstep(0.08, 0.13, mesaN) * 130.0 + smoothstep(0.25, 0.29, mesaN) * 85.0;
  landH = mix(landH, landBase * 0.5 + dunes + mesa + mountains * 0.55, desert);
  // lodowiec: doliny wypelnione lodem (splaszczone)
  float glacial = smoothstep(0.25, 0.08, cl.z);
  landH = mix(landH, max(landH, 26.0 + hills * 0.4), glacial * 0.55);
  float hLand = mix(seaH, landH, coast);

  // miasto-ogrod: tarasy schodzace do jezior
  float terr = landBase + hills * 0.55 + mountains * 0.3;
  float stepH = 12.0;
  float tq = terr / stepH;
  float terraced = (floor(tq) + smoothstep(0.74, 1.0, fract(tq))) * stepH;
  float hGarden = mix(seaH * 0.35, terraced, coast);
  // przemysl: plaskie platformy na trzech poziomach + kanaly
  float pad = floor((fbm3(cylP(s, t, 2200.0) + 41.0, 2) * 0.5 + 0.5) * 3.0) * 7.0 + 5.0;
  float canal = max(1.0 - smoothstep(22.0, 32.0, abs(t - Wf * 0.3)), 1.0 - smoothstep(22.0, 32.0, abs(t - Wf * 0.71)));
  float hInd = mix(pad, -7.0, canal);
  hInd = mix(seaH * 0.3, hInd, smoothstep(-0.22, -0.12, e));
  // szklo: plaskie parki i jeziora
  float hGlass = mix(seaH * 0.4, 5.0 + hills * 0.25, coast);

  float h = typeW.x * hLand + typeW.y * hGarden + typeW.z * hInd + typeW.w * hGlass;
  // doki wpiete w podloge (K-7 + zatoki) i portale tranzytow: plaska plyta bez zabudowy
  float dockPad = haloPortPad(s, t, L, 0.0, 300.0);
  h = mix(h, 7.0, dockPad);
  h = mix(h, lmP.z, lmW);

  // --- rzeki: meandry okresowe (parametry z layoutu), zanikaja w gorach
  float uu = s / L;
  float rd = 1e5;
  for (int i = 0; i < ${RIVERS}; i++) {
    vec4 ra = uRiverA[i];
    float vc = ra.x
      + uRiverM1[i].y * sin(HALO_TAU * uu * uRiverM1[i].x + uRiverM1[i].z)
      + uRiverM2[i].y * sin(HALO_TAU * uu * uRiverM2[i].x + uRiverM2[i].z)
      + uRiverM3[i].y * sin(HALO_TAU * uu * uRiverM3[i].x + uRiverM3[i].z);
    float halfW = ra.y * (0.5 + 0.5 * (haloGnoise3(cylP(s, 0.0, 9000.0) + float(i) * 7.3) * 0.5 + 0.5));
    rd = min(rd, abs(v - vc) * Wf - halfW);
  }
  float riverW = clamp(typeW.x + typeW.y + typeW.w * 0.7, 0.0, 1.0) * (1.0 - desert * 0.85) * (1.0 - dockPad) * (1.0 - zInd) * (1.0 - lmW);
  float fadeHigh = 1.0 - smoothstep(150.0, 320.0, h);
  float bankT = smoothstep(0.0, 110.0, max(rd, 0.0));
  float riverH = rd < 0.0 ? (-5.0 - 6.0 * clamp(-rd / 30.0, 0.0, 1.0)) : mix(1.2, h, bankT);
  h = mix(h, min(h, riverH), riverW * fadeHigh);
  rd = mix(600.0, rd, riverW * fadeHigh);

  // --- klimat lokalny, las, zabudowa
  float nearWater = (1.0 - smoothstep(0.0, 420.0, rd)) * 0.22 + (1.0 - coast) * 0.12;
  float moist = clamp(cl.w + nearWater, 0.0, 1.0);
  float temp = clamp(cl.z - max(h, 0.0) / max(hMax, 1.0) * 0.5, 0.0, 1.0);
  float fN = fbm3(cylP(s, t, 1200.0) + 57.0, 4) * 0.5 + 0.5;
  float forest = smoothstep(0.42, 0.7, fN * 0.62 + moist * 0.55 - 0.08)
    * smoothstep(0.16, 0.3, temp) * smoothstep(-2.0, 4.0, h) * (1.0 - desert)
    * clamp(typeW.x + typeW.y * 0.4 + typeW.w * 0.35, 0.0, 1.0);
  float cityN = fbm3(cylP(s, t, 2300.0) + 71.0, 3) * 0.5 + 0.5;
  float dry = smoothstep(-3.0, 3.0, h) * smoothstep(-10.0, 25.0, rd);
  float urban = (typeW.y * smoothstep(0.34, 0.5, cityN)
    + typeW.z * 0.95
    + typeW.w * smoothstep(0.38, 0.55, cityN) * 0.75) * dry * (1.0 - smoothstep(110.0, 260.0, h));
  // pas fabryczny gesty, osady w dolinach gestsze niz zwykle miasto-ogrod
  urban = max(urban, (zInd * 0.95 + zRes * smoothstep(0.16, 0.3, cityN)) * dry * (1.0 - smoothstep(110.0, 260.0, h)));
  urban = clamp(urban, 0.0, 1.0) * (1.0 - dockPad) * (1.0 - lmW);
  forest *= (1.0 - urban * 0.9) * (1.0 - dockPad) * (1.0 - zInd) * (1.0 - lmW);
  float exN = fbm3(cylP(s, t, 4800.0) + 91.0, 3);
  // plyta doku: goly metal z liniami (fartuch portu), bez zabudowy i lasu;
  // pod plyta placu megabudowli rdzen (bez drzew i detalu), obrzeze splaszczone
  float exposed = max(typeW.z * smoothstep(0.22, 0.36, exN) * dry * (1.0 - dockPad), dockPad);
  exposed = max(exposed, max(lmP.y, lmP.w * 0.3));
  float rock = clamp(smoothstep(230.0, 540.0, h) * 0.75 + desert * smoothstep(40.0, 110.0, h) * 0.8, 0.0, 1.0);

  // pod plyta placu i tuz za nia bez drzew (drzewa miasta rosna z wagi
  // ogrodu, a nie wolno im przebic plyty): waga ogrodu -> szklo, sam koniec
  // (wysokosc, zabudowa, las policzone wyzej)
  typeW = mix(typeW, vec4(0.0, 0.0, 0.0, 1.0), smoothstep(0.6, 0.8, lmP.w) * lmW);

  W.h = h;
  W.riverDist = clamp(rd, -200.0, 600.0);
  W.moist = moist;
  W.temp = temp;
  W.typeW = typeW;
  W.forest = forest;
  W.urban = urban;
  W.exposed = exposed;
  W.rock = rock;
  return W;
}
`;

function makeBakeFragment(output) {
  return /* glsl */`
${HALO_GLSL_COMMON}
${HALO_GLSL_NOISE}
${WORLD_GLSL}
void main() {
  vec2 uv = mix(uRegion.xy, uRegion.zw, vUv);
  float s = uv.x * uGeo.x;
  float t = uv.y * uGeo.y;
  HaloWorld W = haloWorldAt(s, t);
  ${output === 'A' ? 'gl_FragColor = vec4(W.h, W.riverDist, W.moist, W.temp);' : ''}
  ${output === 'B' ? 'gl_FragColor = W.typeW;' : ''}
  ${output === 'C' ? 'gl_FragColor = vec4(W.forest, W.urban, W.exposed, W.rock);' : ''}
}
`;
}

function makeTarget(width, height, type, mipmaps) {
  const rt = new THREE.WebGLRenderTarget(width, height, {
    type,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: mipmaps,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping
  });
  rt.texture.anisotropy = 8;
  rt.texture.colorSpace = THREE.NoColorSpace;
  return rt;
}

export class HaloWorldMaps {
  constructor(renderer, layout, quality) {
    this.renderer = renderer;
    this.layout = layout;
    this.quality = quality;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.uniforms = this._makeUniforms(layout);
    this.materials = {
      A: this._makeMaterial('A'),
      B: this._makeMaterial('B'),
      C: this._makeMaterial('C')
    };
    this.low = null;
    this.full = null;
    this.pending = null;
    this.cpu = null;
    this.ready = false;
    this.version = 0;
    this.textureBytes = 0;
    this._buildLow();
  }

  _makeUniforms(layout) {
    const typeIndex = (type) => Math.max(0, HALO_SECTOR_TYPES.indexOf(type));
    const sectorType = new Array(MAX_SECTORS).fill(0);
    const sectorClimate = Array.from({ length: MAX_SECTORS }, () => new THREE.Vector4());
    const sectorPort = new Array(MAX_SECTORS).fill(0);
    layout.sectors.forEach((sector, i) => {
      if (i >= MAX_SECTORS) return;
      sectorType[i] = typeIndex(sector.type);
      sectorClimate[i].set(sector.climate.sea, sector.climate.mount, sector.climate.temp, sector.climate.moist);
      sectorPort[i] = sector.port ? 1 : 0;
    });
    const riverA = [];
    const m1 = [];
    const m2 = [];
    const m3 = [];
    for (let i = 0; i < RIVERS; i++) {
      const r = layout.rivers[i];
      riverA.push(new THREE.Vector4(r.center, r.width, r.phase, 1));
      m1.push(new THREE.Vector3(...r.m1));
      m2.push(new THREE.Vector3(...r.m2));
      m3.push(new THREE.Vector3(...r.m3));
    }
    const sectorStart = ((layout.sectorStart % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return {
      uGeo: { value: new THREE.Vector4(layout.circumference, layout.floor.length, layout.wallHeight, layout.radii.floorMid) },
      uNoiseOff: { value: new THREE.Vector4(...layout.noiseOffset.map((v) => v * 0.1)) },
      uSectorCount: { value: layout.sectors.length },
      uSectorStart: { value: sectorStart },
      uSectorSpan: { value: layout.sectorSpan },
      uSectorType: { value: sectorType },
      uSectorClimate: { value: sectorClimate },
      uSectorPort: { value: sectorPort },
      uRiverA: { value: riverA },
      uRiverM1: { value: m1 },
      uRiverM2: { value: m2 },
      uRiverM3: { value: m3 },
      uRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
      uSeaDepth: { value: HALO_TERRAIN.seaDepth },
      uLandmarkCount: { value: 0 },
      uLandmarkA: { value: Array.from({ length: MAX_LANDMARKS }, () => new THREE.Vector4()) },
      uLandmarkB: { value: Array.from({ length: MAX_LANDMARKS }, () => new THREE.Vector4(0, 0, 1, 0)) },
      ...(() => {
        const t = haloPortTileUniforms(layout);
        return { uPortTile: { value: t.tile }, uPortRects: { value: t.rects }, uPortZones: { value: t.zones } };
      })()
    };
  }

  _makeMaterial(output) {
    return new THREE.ShaderMaterial({
      name: `HaloWorldBake${output}`,
      uniforms: this.uniforms,
      vertexShader: BAKE_VERTEX,
      fragmentShader: makeBakeFragment(output),
      depthTest: false,
      depthWrite: false
    });
  }

  _mapSize(scale = 1) {
    const q = this.quality;
    const w = Math.max(256, Math.round(q.mapU * scale));
    const h = Math.max(32, Math.round(q.mapVPer6000 * (this.layout.width / 6000) * scale));
    return { w, h: Math.min(h, 2048) };
  }

  _allocSet(size, mipmaps) {
    return {
      A: makeTarget(size.w, size.h, THREE.HalfFloatType, mipmaps),
      B: makeTarget(size.w, size.h, THREE.UnsignedByteType, mipmaps),
      C: makeTarget(size.w, size.h, THREE.UnsignedByteType, mipmaps),
      size,
      rows: 0
    };
  }

  _render(target, material, region, rect) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    r.autoClear = false;
    this.uniforms.uRegion.value.set(region[0], region[1], region[2], region[3]);
    this.quad.material = material;
    // viewport/scissor celu three czyta W setRenderTarget — ustawić przed
    target.viewport.set(rect[0], rect[1], rect[2], rect[3]);
    target.scissor.set(rect[0], rect[1], rect[2], rect[3]);
    target.scissorTest = true;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    target.scissorTest = false;
    target.viewport.set(0, 0, target.width, target.height);
    target.scissor.set(0, 0, target.width, target.height);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;
  }

  _bakeRegion(set, u0, u1) {
    const { w, h } = set.size;
    const x0 = Math.round(u0 * w);
    const x1 = Math.round(u1 * w);
    const rect = [x0, 0, Math.max(1, x1 - x0), h];
    const region = [x0 / w, 0, x1 / w, 1];
    for (const key of ['A', 'B', 'C']) this._render(set[key], this.materials[key], region, rect);
  }

  _buildLow() {
    const size = this._mapSize(0.125);
    this.low = this._allocSet(size, true);
    this._bakeRegion(this.low, 0, 1);
    this._readbackCpu();
    this.pending = this._allocSet(this._mapSize(1), true);
    this.pending.nextSlice = 0;
    this.pending.slices = 24;
    this._updateBytes();
    this.version++;
  }

  // CPU: wysokość i zabudowa w niskiej rozdzielczości (dynamiczny near
  // kamery kinowej, rozstawianie obiektów w M4).
  _readbackCpu() {
    const w = 2048;
    const h = Math.max(32, Math.round(96 * this.layout.width / 6000));
    let rt = null;
    let data = null;
    try {
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
      this._render(rt, this.materials.A, [0, 0, 1, 1], [0, 0, w, h]);
      data = new Float32Array(w * h * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, data);
    } catch (err) {
      data = null;
    } finally {
      rt?.dispose();
    }
    if (!data) return;
    const heights = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) heights[i] = data[i * 4];
    this.cpu = { w, h, heights };
  }

  // Place pod megabudowlami (buildHaloLandmarkPlan — miejsca wybrane z mapy
  // sprzed placów): uniformy bake'u, ponowny bake mapy niskiej i odczyt CPU
  // (wysokość placu dla lotu i kamery); pełna mapa dopieka się już z placami.
  setLandmarks(list) {
    const n = Math.min(Array.isArray(list) ? list.length : 0, MAX_LANDMARKS);
    const u = this.uniforms;
    for (let i = 0; i < MAX_LANDMARKS; i++) {
      const lm = i < n ? list[i] : null;
      u.uLandmarkA.value[i].set(lm ? lm.s : 0, lm ? lm.plaza.halfA : 0, lm ? lm.t : 0, lm ? lm.plaza.halfQ : 0);
      u.uLandmarkB.value[i].set(lm ? lm.plazaH : 0, lm ? lm.plaza.lawn : 0, lm ? lm.plaza.ramp : 1, 0);
    }
    const changed = u.uLandmarkCount.value !== n || n > 0;
    u.uLandmarkCount.value = n;
    if (!changed || !this.low) return;
    this._bakeRegion(this.low, 0, 1);
    this._readbackCpu();
    if (this.pending) this.pending.nextSlice = 0;
    this.version++;
  }

  heightAtUV(u, v) {
    if (!this.cpu) return 0;
    const { w, h, heights } = this.cpu;
    const x = ((u % 1) + 1) % 1 * w - 0.5;
    const y = Math.max(0, Math.min(h - 1, v * h - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const X0 = ((x0 % w) + w) % w;
    const X1 = (X0 + 1) % w;
    const Y1 = Math.min(h - 1, y0 + 1);
    const a = heights[y0 * w + X0] * (1 - fx) + heights[y0 * w + X1] * fx;
    const b = heights[Y1 * w + X0] * (1 - fx) + heights[Y1 * w + X1] * fx;
    return a * (1 - fy) + b * fy;
  }

  // Dopieka plaster pełnej mapy; zwraca true, gdy mapa się zmieniła.
  step() {
    const p = this.pending;
    if (!p) return false;
    const u0 = p.nextSlice / p.slices;
    const u1 = (p.nextSlice + 1) / p.slices;
    this._bakeRegion(p, u0, u1);
    p.nextSlice++;
    if (p.nextSlice < p.slices) return false;
    // gotowe: podmiana i zwolnienie mapy niskiej
    this.full = p;
    this.pending = null;
    this._disposeSet(this.low);
    this.low = null;
    this.ready = true;
    this.version++;
    this._updateBytes();
    return true;
  }

  get progress() {
    if (this.ready) return 1;
    if (!this.pending) return 0;
    return this.pending.nextSlice / this.pending.slices;
  }

  get current() {
    return this.full || this.low;
  }

  _updateBytes() {
    const bytes = (set, bpp) => (set ? set.size.w * set.size.h * bpp * 4 / 3 : 0);
    let total = 0;
    for (const set of [this.low, this.full, this.pending]) {
      if (!set) continue;
      total += bytes(set, 8) + bytes(set, 4) * 2;
    }
    this.textureBytes = total;
  }

  _disposeSet(set) {
    if (!set) return;
    set.A.dispose();
    set.B.dispose();
    set.C.dispose();
  }

  dispose() {
    this._disposeSet(this.low);
    this._disposeSet(this.full);
    this._disposeSet(this.pending);
    for (const m of Object.values(this.materials)) m.dispose();
    this.quad.geometry.dispose();
    this.low = this.full = this.pending = null;
  }
}

export const HALO_WORLD_GLSL = WORLD_GLSL;
