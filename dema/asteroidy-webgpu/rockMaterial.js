// dema/asteroidy-webgpu/rockMaterial.js
//
// Materiał skał w TSL — port shadera src/3d/rocks/rockMaterial3D.js:
//   • wierzchołki: promień z mapy oktaedrycznej banku (rockBank.js),
//     rozciągnięcie, kwaternion bazowy × obrót wokół osi w czasie, skala
//     promieniem instancji; pozycje instancji względem lokalnego początku
//     przy kamerze (float32 bez drgań przy milionach j.);
//   • fragmenty: KAŻDY typ ma własny program powierzchni (metal żelaza, skorupy
//     malachitu, chondry krzemu, warstwy tytanu, szczeliny kryształu, szkliwo
//     lodu, smolinek uranu, pęknięcia skał energetycznych, skała neutralna),
//     relief z pochodnych (gradient powierzchni), żyły o stałej szerokości
//     w świecie z antyaliasingiem w pikselach, emisja HDR na liniach;
//   • światło: SurfaceLightingModel (surfaceLighting.js) — słońce i WSZYSTKIE
//     światła siatki (lights.js) przechodzą przez direct(); otoczenie, odblask
//     metalu, prześwit lodu i emisja idą jako emisja materiału.
//
// Tabela wyglądu typów i domyślne światło SKOPIOWANE z rockMaterial3D.js
// (tamten moduł ciągnie shadery GLSL i maskę cienia Core3D).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec3, vec4, uniform, uniformArray, attribute, varyingProperty,
  texture, texture3D, positionGeometry, positionView, positionViewDirection, positionWorld, cameraViewMatrix,
  If, select, mix, smoothstep, clamp, fract, floor, abs, sign, sqrt, pow, sin, cos, log2, exp,
  min, max, dot, cross, normalize, reflect, step, dFdx, dFdy, fwidth, diffuseColor, Discard, length
} from 'three/tsl';
import { ROCK_TYPES, SHAPE_COUNT } from '../../src/game/asteroidRockKinds.js';
import { octTexUv, quatRotate, quatMul } from './tslCommon.js';
import { SurfaceLightingModel } from './surfaceLighting.js';

export const ROCK_TYPE_COUNT = ROCK_TYPES.length;

// Kopia ROCK_TYPE_LOOKS z rockMaterial3D.js (kolejność = ROCK_TYPES).
export const ROCK_TYPE_LOOKS = Object.freeze([
  Object.freeze({ id: 'iron', base: '#3e3935', base2: '#26221f', a: '#44484e', aSpec: 0.7, b: '#5a2b15', bParam: 0.55, c: '#80868e', d: '#2e2926', emit: 0, cover: 0.4, line: 0, sparkle: 0.35, ice: 0, gloss: 60, metal: 1, relief: 0.05 }),
  Object.freeze({ id: 'copper', base: '#4a4540', base2: '#302c28', a: '#2f8a58', aSpec: 0.3, b: '#0d3a26', bParam: 0.5, c: '#b8683a', d: '#1d3a94', emit: 0, cover: 0.3, line: 11, sparkle: 0.2, ice: 0, gloss: 60, metal: 1, relief: 0.03 }),
  Object.freeze({ id: 'silicon', base: '#827b71', base2: '#5f5951', a: '#b7bbbf', aSpec: 0.7, b: '#4a443d', bParam: 0.5, c: '#7f6246', d: '#a39d92', emit: 0, cover: 0.25, line: 13, sparkle: 1.0, ice: 0, gloss: 70, metal: 0, relief: 0.02 }),
  Object.freeze({ id: 'titan', base: '#72777d', base2: '#4f545a', a: '#16181b', aSpec: 0.9, b: '#4b5056', bParam: 7.0, c: '#7c5d28', d: '#7a7f85', emit: 0, cover: 0.5, line: 0, sparkle: 0.5, ice: 0, gloss: 70, metal: 0.8, relief: 0.03 }),
  Object.freeze({ id: 'crystal', base: '#3a3444', base2: '#201c27', a: '#5ce1ff', aSpec: 1.2, b: '#a070ff', bParam: 0.5, c: '#9fc4e0', d: '#2a2433', emit: 0.9, cover: 0.3, line: 9, sparkle: 0.8, ice: 0, gloss: 72, metal: 0, relief: 0.03 }),
  Object.freeze({ id: 'ice', base: '#8699aa', base2: '#62768a', a: '#123f78', aSpec: 0.55, b: '#3d3630', bParam: 0.4, c: '#5aa9ff', d: '#9fb1c1', emit: 0, cover: 0.4, line: 12, sparkle: 0.6, ice: 1, gloss: 80, metal: 0, relief: 0.03 }),
  Object.freeze({ id: 'uran', base: '#1e1f19', base2: '#0d0e0a', a: '#7a8f2a', aSpec: 0.45, b: '#25733f', bParam: 0.5, c: '#58d843', d: '#a8973a', emit: 0.7, cover: 0.3, line: 6, sparkle: 0.03, ice: 0, gloss: 32, metal: 0, relief: 0.045 }),
  Object.freeze({ id: 'rock', base: '#5c554d', base2: '#3b3631', a: '#595b5e', aSpec: 0.04, b: '#37383a', bParam: 0.5, c: '#77716a', d: '#2c2926', emit: 0, cover: 0.3, line: 0, sparkle: 0.05, ice: 0, gloss: 12, metal: 0, relief: 0.025 }),
  Object.freeze({ id: 'energy', base: '#26213a', base2: '#110e1a', a: '#a8ecff', aSpec: 0.6, b: '#8a3cff', bParam: 0.5, c: '#b8f0ff', d: '#0c0a12', emit: 1.6, cover: 0.75, line: 6, sparkle: 0.5, ice: 0, gloss: 55, metal: 0, relief: 0.04 })
]);

export const ROCK_LIGHT_DEFAULTS = Object.freeze({
  sunColor: [1.0, 0.95, 0.88],
  sunIntensity: 1.9,
  sunElevDeg: 24,
  ambientTop: [0.16, 0.18, 0.22],
  ambientBounce: [0.10, 0.085, 0.07],
  lunar: 0.35,
  wrap: 0.12,
  exposure: 1.0,
  hazeColor: [0.030, 0.034, 0.045],
  hazePerUnit: 1 / 26000
});

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexToLinear(hex, out = new THREE.Vector3()) {
  const v = parseInt(String(hex).replace('#', ''), 16);
  return out.set(srgbToLinear(((v >> 16) & 255) / 255), srgbToLinear(((v >> 8) & 255) / 255), srgbToLinear((v & 255) / 255));
}

/**
 * Uniformy wspólne dla wszystkich materiałów skał (jedno ustawienie na klatkę).
 */
// Wygląd typów w JEDNEJ tablicy uniformów (limit 12 buforów uniform na etap
// shadera): typ t, pole k → element t · 8 + k.
export const TYPE_ROW = Object.freeze({ base: 0, base2: 1, a: 2, b: 3, c: 4, d: 5, p: 6, s: 7 });

export function createRockShared(bank, noise) {
  const S = {
    bank,
    noise,
    shapeSize: uniform(bank.size),
    time: uniform(0),
    // Kierunek do słońca (scena, jednostkowy) i barwa × moc.
    sunDir: uniform(new THREE.Vector3(1, 0, 0.4).normalize()),
    sunColor: uniform(new THREE.Vector3(1.9, 1.805, 1.672)),
    ambientTop: uniform(new THREE.Vector3(...ROCK_LIGHT_DEFAULTS.ambientTop)),
    ambientBounce: uniform(new THREE.Vector3(...ROCK_LIGHT_DEFAULTS.ambientBounce)),
    lunar: uniform(ROCK_LIGHT_DEFAULTS.lunar),
    wrap: uniform(ROCK_LIGHT_DEFAULTS.wrap),
    exposure: uniform(ROCK_LIGHT_DEFAULTS.exposure),
    detail: uniform(1),
    veins: uniform(1),
    hazeColor: uniform(new THREE.Vector3(...ROCK_LIGHT_DEFAULTS.hazeColor)),
    hazePerUnit: uniform(ROCK_LIGHT_DEFAULTS.hazePerUnit),
    // 1 = słońce przesłaniane przez pole (transmitancja per skała), 0 = pełne.
    sunOcc: uniform(1),
    typeData: uniformArray(Array.from({ length: ROCK_TYPE_COUNT * 8 }, () => new THREE.Vector4()), 'vec4'),
    // Światło wolumetryczne passa gry (volumetrics.js), ustawiane przed kompilacją.
    volume: null,
    // [z sceny] strop warstwy skał gry — dno pyłu nad skałami (i minerałami na
    // nich): skały PLAY leżą pod płaszczyzną gry (wierzch ≤ 0, rockLayers zOf).
    rockLayerTop: uniform(0),
    // Mnożnik światła świecącego pyłu na skałach (volumetrics.js, rgb kolumny).
    fogLit: uniform(1.5),
    // Uderzenia piorunów (storm.js): xyz punkt (scena), w siła (0 = pusty).
    strikes: uniformArray(Array.from({ length: 8 }, () => new THREE.Vector4()), 'vec4'),
    shapeAxis: uniformArray(Array.from({ length: SHAPE_COUNT }, (_, k) => {
      const a = bank.longAxis;
      return new THREE.Vector4(a[k * 3] || 1, a[k * 3 + 1] || 0, a[k * 3 + 2] || 0, 0);
    }), 'vec4')
  };
  const lin = new THREE.Vector3();
  const T = S.typeData.array;
  for (let i = 0; i < ROCK_TYPE_COUNT; i++) {
    const L = ROCK_TYPE_LOOKS[Math.min(i, ROCK_TYPE_LOOKS.length - 1)];
    const o = i * 8;
    hexToLinear(L.base, lin); T[o + TYPE_ROW.base].set(lin.x, lin.y, lin.z, 1);
    hexToLinear(L.base2, lin); T[o + TYPE_ROW.base2].set(lin.x, lin.y, lin.z, 1);
    hexToLinear(L.a, lin); T[o + TYPE_ROW.a].set(lin.x, lin.y, lin.z, L.aSpec);
    hexToLinear(L.b, lin); T[o + TYPE_ROW.b].set(lin.x, lin.y, lin.z, L.bParam);
    hexToLinear(L.c, lin); T[o + TYPE_ROW.c].set(lin.x, lin.y, lin.z, L.emit);
    hexToLinear(L.d, lin); T[o + TYPE_ROW.d].set(lin.x, lin.y, lin.z, 1);
    T[o + TYPE_ROW.p].set(L.cover, L.line, L.sparkle, L.relief);
    T[o + TYPE_ROW.s].set(L.ice, L.gloss, L.metal, 0);
  }
  S.typeRow = (type, k) => S.typeData.element(type.mul(8).add(k));
  /** TSL: rozbłysk ładunku przy uderzeniu pioruna blisko P (suma siła × gauss). */
  S.strikeSurge = (P, radiusIn) => {
    const radius = float(radiusIn);
    const sum = float(0.0).toVar();
    for (let i = 0; i < 8; i++) {
      const st = S.strikes.element(i);
      const d = st.xyz.sub(P);
      sum.addAssign(st.w.mul(exp(dot(d, d).div(radius.mul(radius)).negate())));
    }
    return sum;
  };
  return S;
}

const hash11 = (n) => fract(sin(n.mul(127.1).add(311.7)).mul(43758.5453));

// Paski wzdłuż h z antyaliasingiem analitycznym (fw = zmiana h na piksel).
const bandMask = Fn(([h, w, fw]) => {
  const t = abs(fract(h).sub(0.5));
  const e = max(fw, 1e-4).toVar();
  const m = float(1.0).sub(smoothstep(w.mul(0.5).sub(e), w.mul(0.5).add(e), t));
  return mix(m, w, smoothstep(0.35, 0.9, e));
}).setLayout({ name: 'rockBandMask', type: 'float', inputs: [{ name: 'h', type: 'float' }, { name: 'w', type: 'float' }, { name: 'fw', type: 'float' }] });

/**
 * Materiał warstwy skał.
 *   backdrop = tło (kamera persp., zamglenie z głębokością, transmitancja
 *   słońca bez maski powierzchni); inaczej warstwa gry (ortho).
 */
export class RockNodeMaterial extends THREE.NodeMaterial {
  static get type() { return 'RockNodeMaterial'; }

  constructor({ shared, backdrop = false, carve = null }) {
    super();
    this.lights = true;
    this.fog = false;
    this.backdrop = backdrop;
    this.S = shared;
    // Skały w wydobyciu (minedRocks.js): siatka komórek ciała w atlasie 3D —
    // pikseli z wykopanego miejsca nie ma (wnętrze rysuje raymarching).
    // Atrybuty instancji: iCarve = (początek bloku w atlasie [teksele], bok
    // komórki), iGrid = (środek komórki 0 w układzie skały, —).
    this.carve = carve;
    // Uniformy warstwy: skala pikseli (ortho: zoom; persp: ogniskowa [px]),
    // wysokość kamery persp. (0 = ortho), próg pikseli, przyciemnienie tła.
    this.L = {
      pxScale: uniform(1),
      camZ: uniform(0),
      minPx: uniform(0.6),
      layerDim: uniform(backdrop ? 0.85 : 1)
    };
    this.V = {
      dir: varyingProperty('vec3', 'vRockDir'),
      objP: varyingProperty('vec3', 'vRockObjP'),
      rot: varyingProperty('vec4', 'vRockRot'),
      stretchR: varyingProperty('vec4', 'vRockStretchR'),
      info: varyingProperty('vec4', 'vRockInfo'),
      misc: varyingProperty('vec4', 'vRockMisc'),
      carve: carve ? varyingProperty('vec4', 'vRockCarve') : null,
      grid: carve ? varyingProperty('vec4', 'vRockGrid') : null
    };
    this.positionNode = this._buildVertex();
    this._surf = null;
  }

  _buildVertex(withVaryings = true, shadowCarve = null) {
    const S = this.S;
    const L = this.L;
    const V = this.V;
    const bankA = S.bank.textureA;
    return Fn(() => {
      const iPos = attribute('iPos', 'vec4');
      const iRot = attribute('iRot', 'vec4');
      const iSpin = attribute('iSpin', 'vec4');
      const iShape = attribute('iShape', 'vec4');
      const iStretch = attribute('iStretch', 'vec4');
      const aMip = attribute('aMip', 'float');
      const dir = normalize(positionGeometry).toVar();
      const layer = int(iShape.x.add(0.5)).toVar();
      const r = texture(bankA, octTexUv(dir, S.shapeSize)).depth(layer).level(aMip).x;
      // Rozmiar na ekranie: ortho → promień × zoom; persp → ogniskowa / odległość.
      const depth = iPos.z.negate().toVar();
      const pxPerUnit = select(L.camZ.greaterThan(0.0), L.pxScale.div(max(L.camZ.add(depth), 1.0)), L.pxScale).toVar();
      const radiusPx = iPos.w.mul(pxPerUnit).toVar();
      // Poniżej progu skała maleje do zera (bez wyskakiwania przy zoomie).
      const fadeScale = smoothstep(L.minPx, L.minPx.mul(2.0), radiusPx);
      const ang = iShape.w.add(iSpin.w.mul(S.time)).mul(0.5).toVar();
      const q = quatMul(vec4(iSpin.xyz.mul(sin(ang)), cos(ang)), iRot).toVar();
      const pObj = dir.mul(r).mul(iStretch.xyz).toVar();
      const local = quatRotate(q, pObj).mul(iPos.w.mul(fadeScale));
      if (shadowCarve) {
        // Mapa cienia skały w wydobyciu: punkt w układzie skały i dane ciała (atlas).
        shadowCarve.objP.assign(pObj.mul(iPos.w));
        shadowCarve.carve.assign(attribute('iCarve', 'vec4'));
        shadowCarve.grid.assign(attribute('iGrid', 'vec4'));
      }
      if (withVaryings) {
        const lod = log2(max(1.0, S.shapeSize.mul(2.8284).div(max(1.0, radiusPx.mul(6.2832)))));
        V.dir.assign(dir);
        V.objP.assign(pObj.mul(iPos.w));
        V.rot.assign(q);
        V.stretchR.assign(vec4(iStretch.xyz, iPos.w));
        V.info.assign(vec4(float(layer), iShape.y, iShape.z, lod));
        V.misc.assign(vec4(radiusPx, pxPerUnit, depth, iStretch.w));
        if (this.carve) {
          V.carve.assign(attribute('iCarve', 'vec4'));
          V.grid.assign(attribute('iGrid', 'vec4'));
        }
      }
      return iPos.xyz.add(local);
    })();
  }

  setupDiffuseColor(/* builder */) {
    this._surf = this._buildSurface();
    if (this.carve) this._carveTest();
    diffuseColor.assign(vec4(this._surf.diffAlbedo, 1.0));
  }

  // Wykopane / odłupane miejsce: zapełnienie siatki ciała kawałek POD powierzchnią
  // (promieniowo do środka o 0,8 komórki) < 0,5 → piksel znika.
  _carveTest() {
    const V = this.V;
    const c = V.carve;
    const g = V.grid;
    const p = V.objP;
    const len = max(length(p), 1.0);
    const pin = p.mul(float(1.0).sub(c.w.mul(0.8).div(len)));
    const cell = pin.sub(g.xyz).div(c.w);
    const uvw = c.xyz.add(cell).add(0.5).div(this.carve.size);
    const f = texture3D(this.carve.atlas, uvw).level(0).r;
    If(f.lessThan(0.5), () => { Discard(); });
  }

  setupNormal() {
    return this._surf ? this._surf.N : vec3(0, 0, 1);
  }

  setupLightingModel() {
    return new SurfaceLightingModel(this._surf);
  }

  setupLighting(builder) {
    const lit = super.setupLighting(builder);
    return lit.add(this._surf.emissive);
  }

  setupOutput(builder, outputNode) {
    const S = this.S;
    const col = outputNode.rgb.mul(S.exposure).mul(this.L.layerDim).toVar();
    if (this.backdrop) {
      // Tło: zamglenie z głębokością w barwie pyłu w cieniu (gaśnie z mrokiem pola).
      const misc = this.V.misc;
      const haze = clamp(misc.z.mul(S.hazePerUnit), 0.0, 0.92).toVar();
      const sunT = mix(float(1.0), misc.w, S.sunOcc);
      col.assign(mix(col.mul(float(1.0).sub(haze.mul(0.45))), S.hazeColor.mul(sunT), haze.mul(0.85)));
    } else if (S.volume) {
      // Pył nad skałą (volumetrics.js): rozproszenie świateł od kamery do
      // stropu warstwy skał, skała przygaszona transmitancją ośrodka.
      // Warstwa skał gry jest DNEM pyłu: kolumna kończy się na jej stropie
      // (S.rockLayerTop, z = 0), nie na powierzchni. Całka do powierzchni
      // robiła z dużej skały (środek do z ≈ −2000, wierzch pod płaszczyzną)
      // białą tarczę: jej stoki łapały pełną, jasną kolumnę smugi, a wierzch
      // tylko część — „kawałek bez światła, reszta prawie biała” (zgłoszenie
      // użytkownika 2026-09-27, drugie). Tak cała skała ma jedną mgłę, a pełna
      // kolumna zostaje nad tłem między skałami (tam widać cienie skał w smudze).
      const P = positionWorld;
      const v = S.volume.sample(vec3(P.xy, max(P.z, S.rockLayerTop))).toVar();
      // Świecący pył nad skałą oświetla ją też z góry (rozproszenie w dół ≈ to,
      // które widzi kamera): skała w smudze dostaje barwę smugi na albedo,
      // mocniej na ścianach zwróconych w górę.
      const Nv = this._surf.N;
      const fogLit = this._surf.diffAlbedo.mul(v.rgb).mul(S.fogLit).mul(clamp(Nv.z.mul(0.6).add(0.4), 0.0, 1.0));
      col.assign(col.add(fogLit).mul(v.a).add(v.rgb));
    }
    return vec4(max(col, vec3(0.0)), 1.0);
  }

  /** Program powierzchni: albedo, relief, żyły, emisja i parametry światła. */
  _buildSurface() {
    const S = this.S;
    const V = this.V;
    const bankA = S.bank.textureA;
    const bankB = S.bank.textureB;
    const noise = S.noise;

    const dir = normalize(V.dir).toVar();
    const layer = int(V.info.x.add(0.5)).toVar();
    const type = int(V.info.y.add(0.5)).toVar();
    const seed = V.info.z.toVar();
    const lod = V.info.w.toVar();
    const pxPerUnit = V.misc.y.toVar();
    const uvs = octTexUv(dir, S.shapeSize).toVar();
    const sa = texture(bankA, uvs).depth(layer).level(lod).toVar();
    const sb = texture(bankB, uvs).depth(layer).level(lod).toVar();
    // Normalna obiektu → rozciągnięcie (odwrotna transpozycja) → scena → widok.
    const nObj = normalize(sa.yzw.div(V.stretchR.xyz));
    const Nw = normalize(quatRotate(V.rot, nObj));
    const Nv = normalize(cameraViewMatrix.mul(vec4(Nw, 0.0)).xyz).toVar();
    const Vv = positionViewDirection.toVar();
    const vp = positionView.toVar();

    // --- Próbki szumu (przed gałęziami typów) ---
    const P = V.objP.toVar();
    const R = max(V.stretchR.w, 1.0).toVar();
    const Q = P.div(R).toVar();
    const so = vec3(seed.mul(37.1), seed.mul(91.7), seed.mul(53.3)).toVar();
    const n1 = texture3D(noise, P.div(520.0).add(so)).toVar();
    const n2 = texture3D(noise, P.div(219.3).add(so.yzx).add(vec3(0.31, 0.77, 0.13))).toVar();
    const nd = texture3D(noise, P.div(90.0).add(so.zxy)).toVar();
    const nq = texture3D(noise, Q.mul(0.62).add(so.mul(0.71))).toVar();
    const nm = texture3D(noise, Q.mul(1.9).add(so.yxz).add(vec3(0.47, 0.11, 0.83))).toVar();
    const nc = texture3D(noise, P.div(380.0).add(so.xzy)).toVar();
    const zoneN = texture3D(noise, P.div(1155.0).add(vec3(0.53, 0.21, 0.87)).add(so)).r.toVar();
    // Pochodne do antyaliasingu wzorów (przed gałęziami).
    const dQx = dFdx(Q).toVar();
    const dQy = dFdy(Q).toVar();
    const fwNqG = fwidth(nq.g).toVar();
    const longAxis = S.shapeAxis.element(layer).xyz.toVar();

    const tA = S.typeRow(type, TYPE_ROW.a).toVar();
    const tB = S.typeRow(type, TYPE_ROW.b).toVar();
    const tC = S.typeRow(type, TYPE_ROW.c).toVar();
    const tD = S.typeRow(type, TYPE_ROW.d).toVar();
    const tP = S.typeRow(type, TYPE_ROW.p).toVar();
    const tS = S.typeRow(type, TYPE_ROW.s).toVar();
    const tBase = S.typeRow(type, TYPE_ROW.base).rgb.toVar();
    const tBase2 = S.typeRow(type, TYPE_ROW.base2).rgb.toVar();
    const ao = sb.r.toVar();
    const crater = sb.g.toVar();
    const macro = sb.b.toVar();
    const convex = sb.a.toVar();
    const featureFade = (s) => smoothstep(1.5, 4.0, pxPerUnit.mul(s));

    // Skała macierzysta (wspólna).
    const albedo = mix(tBase2, tBase, smoothstep(0.25, 0.75, macro.mul(0.7).add(n1.r.mul(0.3)))).toVar();
    albedo.mulAssign(mix(0.78, 1.12, convex));
    albedo.assign(mix(albedo, albedo.mul(1.25).add(0.015), crater.mul(0.5)));

    const H = float(0).toVar();
    const lf = float(1).toVar();
    const lw = float(0).toVar();
    const lcol = vec3(0).toVar();
    const lspec = float(0).toVar();
    const lemit = float(0).toVar();
    const lmetal = float(0).toVar();
    const specK = float(0.03).toVar();
    const gloss = tS.y.toVar();
    const metal = float(0).toVar();
    const metalF0 = vec3(0.56, 0.57, 0.58).toVar();
    const emit = vec3(0).toVar();
    const sparkK = tP.z.toVar();
    const sparkCol = vec3(1).toVar();
    const relief = tP.w.mul(R).toVar();
    const veinZone = smoothstep(float(0.58).sub(tP.x.mul(0.3)), float(0.66).sub(tP.x.mul(0.3)), zoneN).toVar();
    const veinField = n1.g.sub(n1.a).add(n2.r.sub(0.5).mul(0.05)).add(nd.r.sub(0.5).mul(0.018)).toVar();

    If(type.equal(0), () => {
      // ŻELAZO: metal na wypukłościach, rdza w zagłębieniach, regmaglipty, lamele.
      const metalM = smoothstep(0.6, 0.72, convex.mul(0.45).add(nq.r.mul(0.75)).add(float(1).sub(crater).mul(0.06))).toVar();
      const rustM = float(1).sub(metalM).mul(smoothstep(0.3, 0.7, float(1).sub(ao).mul(0.9).add(n2.a.mul(0.5)).add(crater.mul(0.25)))).toVar();
      const thumb = smoothstep(0.3, 0.95, nq.b);
      H.subAssign(thumb.mul(relief).mul(mix(0.35, 1.0, metalM)));
      const kq = R.div(9.0).toVar();
      const u1 = vec3(0.577, 0.577, 0.577);
      const u2 = vec3(0.577, -0.577, 0.577);
      const u3 = vec3(-0.577, 0.577, 0.577);
      const w1 = bandMask(dot(Q, u1).mul(kq).add(nd.r.mul(0.25)), float(0.22), abs(dot(dQx, u1)).add(abs(dot(dQy, u1))).mul(kq));
      const w2 = bandMask(dot(Q, u2).mul(kq).add(nd.a.mul(0.25)), float(0.22), abs(dot(dQx, u2)).add(abs(dot(dQy, u2))).mul(kq));
      const w3 = bandMask(dot(Q, u3).mul(kq).add(nd.g.mul(0.25)), float(0.22), abs(dot(dQx, u3)).add(abs(dot(dQy, u3))).mul(kq));
      const lamella = max(w1, max(w2, w3)).mul(featureFade(9.0)).toVar();
      const metalCol = mix(tA.rgb.mul(nd.r.mul(0.24).add(0.88)), tC.rgb, lamella.mul(0.25));
      metalF0.assign(vec3(0.36, 0.35, 0.33).mul(lamella.mul(0.25).add(0.9)));
      albedo.assign(mix(albedo, tD.rgb, smoothstep(0.4, 0.8, nq.a).mul(0.5)));
      albedo.assign(mix(albedo, metalCol, metalM));
      albedo.assign(mix(albedo, tB.rgb.mul(n2.r.mul(0.5).add(0.75)), rustM.mul(tB.w).mul(1.6)));
      metal.assign(metalM);
      specK.assign(mix(0.04, tA.w, metalM));
      gloss.assign(mix(18.0, tS.y.mul(nd.a.mul(0.5).add(0.75)), metalM));
      sparkCol.assign(vec3(1.0, 0.92, 0.85));
    }).ElseIf(type.equal(1), () => {
      // MIEDŹ: skorupy malachitu z pasami, azuryt, rodzima miedź.
      const malN = nq.g.mul(0.85).add(float(1).sub(convex).mul(0.22)).add(float(1).sub(ao).mul(0.2));
      const mal = smoothstep(float(0.7).sub(tP.x.mul(0.15)), float(0.74).sub(tP.x.mul(0.15)), malN).toVar();
      const band = bandMask(nq.g.mul(8.0).add(nd.r.mul(0.18)), float(0.42), fwNqG.mul(8.0).add(0.03)).toVar();
      const malCol = mix(tB.rgb, tA.rgb, band).mul(nd.a.mul(0.3).add(0.85));
      const az = smoothstep(0.82, 0.9, nm.b).mul(smoothstep(0.35, 0.75, mal));
      albedo.assign(mix(albedo, malCol, mal));
      albedo.assign(mix(albedo, tD.rgb, az.mul(0.85)));
      H.addAssign(mal.mul(relief).mul(band.mul(0.4).add(0.6)));
      const nug = smoothstep(0.9, 0.95, nd.b).mul(float(1).sub(mal)).mul(smoothstep(0.5, 0.75, convex)).toVar();
      albedo.assign(mix(albedo, tC.rgb, nug));
      metal.assign(nug);
      metalF0.assign(vec3(0.95, 0.64, 0.54));
      specK.assign(mix(0.05, 1.0, nug));
      gloss.assign(mix(20.0, tS.y, nug));
      lf.assign(veinField);
      lw.assign(tP.y.mul(float(1).sub(mal)).mul(veinZone));
      lcol.assign(tC.rgb);
      lspec.assign(0.6);
      lmetal.assign(1.0);
      sparkCol.assign(vec3(1.0, 0.8, 0.6));
    }).ElseIf(type.equal(2), () => {
      // KRZEM: jasny chondryt — chondry w trzech barwach, druza, żyły kwarcu.
      const chond = smoothstep(0.62, 0.72, nc.b).mul(featureFade(30.0));
      const chCol = select(nc.r.lessThan(0.4), tB.rgb, select(nc.r.lessThan(0.62), tC.rgb, tD.rgb));
      albedo.assign(mix(albedo, chCol, chond.mul(0.7)));
      albedo.mulAssign(nd.a.mul(0.16).add(0.92));
      const druse = smoothstep(0.55, 0.85, float(1).sub(ao).mul(0.8).add(crater.mul(0.5))).mul(smoothstep(0.5, 0.7, nm.r)).toVar();
      albedo.assign(mix(albedo, tA.rgb.mul(0.9), druse.mul(0.6)));
      sparkK.assign(tP.z.mul(druse.mul(2.0).add(1.0)));
      specK.assign(druse.mul(0.3).add(0.06));
      lf.assign(veinField);
      lw.assign(tP.y.mul(veinZone));
      lcol.assign(tA.rgb);
      lspec.assign(tA.w);
    }).ElseIf(type.equal(3), () => {
      // TYTAN: warstwy w poprzek długiej osi (ilmenit / plagioklaz / rutyl), tarasy.
      const axis = normalize(longAxis.add(vec3(sin(seed.mul(12.9)), cos(seed.mul(7.3)), sin(seed.mul(3.1))).mul(0.25))).toVar();
      const per = tB.w.mul(fract(seed.mul(3.7)).mul(0.5).add(0.75)).toVar();
      const h = dot(Q, axis).mul(per).add(nq.g.sub(0.5).mul(1.1)).add(nm.r.sub(0.5).mul(0.3)).toVar();
      const id = floor(h).toVar();
      const t = h.sub(id).toVar();
      const fw = abs(dot(dQx, axis)).add(abs(dot(dQy, axis))).mul(per).add(fwNqG.mul(1.1)).toVar();
      const rA = hash11(id.add(seed.mul(17.0))).toVar();
      const rP = hash11(id.sub(1.0).add(seed.mul(17.0))).toVar();
      const cA = select(rA.lessThan(0.34), tA.rgb, select(rA.lessThan(0.68), tD.rgb, select(rA.lessThan(0.95), tB.rgb, tC.rgb)));
      const cP = select(rP.lessThan(0.34), tA.rgb, select(rP.lessThan(0.68), tD.rgb, select(rP.lessThan(0.95), tB.rgb, tC.rgb)));
      const edgeMix = smoothstep(0.0, max(fw.mul(1.5), 0.02), t).toVar();
      const layerCol = mix(cP, cA, edgeMix).toVar();
      const avgCol = tA.rgb.mul(0.34).add(tD.rgb.mul(0.34)).add(tB.rgb.mul(0.27)).add(tC.rgb.mul(0.05));
      layerCol.assign(mix(layerCol, avgCol, smoothstep(0.3, 0.8, fw)));
      const lamina = bandMask(h.mul(3.0).add(nd.r.mul(0.2)), float(0.3), fw.mul(3.0));
      layerCol.mulAssign(nd.r.mul(0.2).add(0.9).mul(float(1).sub(lamina.mul(0.14))));
      albedo.assign(mix(albedo, layerCol, 0.85));
      const ilm = select(rA.lessThan(0.34), edgeMix, float(0)).add(select(rP.lessThan(0.34), float(1).sub(edgeMix), float(0))).mul(float(1).sub(smoothstep(0.3, 0.8, fw))).toVar();
      const gold = select(rA.greaterThanEqual(0.95), edgeMix, float(0)).add(select(rP.greaterThanEqual(0.95), float(1).sub(edgeMix), float(0))).toVar();
      H.addAssign(id.add(smoothstep(0.78, 1.0, t)).sub(h).mul(relief).mul(featureFade(R.div(per).mul(0.25))));
      metal.assign(ilm.mul(tS.z).add(gold.mul(0.8)));
      metalF0.assign(mix(vec3(0.34, 0.35, 0.37), vec3(0.85, 0.62, 0.3), gold));
      specK.assign(ilm.mul(tA.w).add(gold.mul(0.8)).add(0.05));
      sparkCol.assign(vec3(1.0, 0.88, 0.67));
    }).ElseIf(type.equal(4), () => {
      // KRYSZTAŁ: ciemna skała, świecące szczeliny cyjan/fiolet, szron przy nich.
      const mixV = smoothstep(0.35, 0.65, n2.a);
      lf.assign(veinField);
      lw.assign(tP.y.mul(veinZone));
      lcol.assign(mix(tA.rgb, tB.rgb, mixV));
      lspec.assign(tA.w);
      lemit.assign(tC.w);
      const fr = float(1).sub(smoothstep(0.0, 0.05, abs(veinField))).mul(veinZone);
      H.subAssign(fr.mul(relief));
      const frost = float(1).sub(smoothstep(0.0, 0.1, abs(veinField))).mul(veinZone).toVar();
      albedo.assign(mix(albedo, tC.rgb.mul(0.5), frost.mul(0.25)));
      sparkK.assign(tP.z.mul(frost.mul(2.0).add(0.3)));
      sparkCol.assign(mix(tA.rgb, vec3(1.0), 0.5));
      specK.assign(0.1);
    }).ElseIf(type.equal(5), () => {
      // LÓD: szkliwo, pasy pyłu, penitenty, szczeliny głębokiego błękitu.
      const axis = normalize(longAxis.add(vec3(cos(seed.mul(5.1)), sin(seed.mul(9.7)), 0.4).mul(0.5))).toVar();
      const dh = dot(Q, axis).mul(1.6).add(nq.g.sub(0.5).mul(1.2));
      const dust = bandMask(dh, float(0.26), abs(dot(dQx, axis)).add(abs(dot(dQy, axis))).mul(1.6).add(fwNqG.mul(1.2))).mul(smoothstep(0.35, 0.6, nq.r)).toVar();
      dust.assign(max(dust, smoothstep(0.55, 0.9, float(1).sub(ao).mul(0.8).add(crater.mul(0.4))).mul(tB.w)));
      albedo.assign(mix(albedo, tD.rgb, smoothstep(0.55, 0.75, convex.mul(0.6).add(nd.r.mul(0.5))).mul(0.6)));
      albedo.assign(mix(albedo, tB.rgb.mul(n2.r.mul(0.4).add(0.8)), dust.mul(0.85)));
      const pen = smoothstep(0.55, 0.7, nq.a).mul(float(1).sub(dust));
      H.addAssign(nd.r.mul(nd.r).mul(nd.r).mul(relief).mul(2.0).mul(pen).mul(featureFade(90.0)));
      lf.assign(nq.g.sub(nq.a).add(n2.r.sub(0.5).mul(0.03)).add(nd.r.sub(0.5).mul(0.012)));
      lw.assign(tP.y.mul(veinZone));
      lcol.assign(tA.rgb);
      lspec.assign(0.2);
      specK.assign(mix(tA.w, 0.08, dust));
      gloss.assign(tS.y);
      sparkK.assign(tP.z.mul(float(1).sub(dust)));
      sparkCol.assign(vec3(0.85, 0.93, 1.0));
    }).ElseIf(type.equal(6), () => {
      // URAN: czarny smolinek z bąblami, świecąca skorupa autunitu/torbernitu.
      const bub = sqrt(clamp(nq.b.sub(0.15).div(0.85), 0.0, 1.0));
      const bub2 = sqrt(clamp(nm.b.sub(0.25).div(0.75), 0.0, 1.0));
      H.addAssign(bub.mul(0.75).add(bub2.mul(0.35)).mul(relief));
      albedo.mulAssign(nd.r.mul(0.2).add(0.9));
      const crust = smoothstep(float(0.8).sub(tP.x.mul(0.15)), float(0.86).sub(tP.x.mul(0.15)), nq.a.mul(0.7).add(nm.r.mul(0.35)).add(convex.mul(0.2)));
      const flake = smoothstep(0.35, 0.55, nd.b);
      const crustCol = mix(mix(tB.rgb, tA.rgb, smoothstep(0.3, 0.7, nd.r)), tD.rgb, smoothstep(0.75, 0.95, n2.r).mul(0.6));
      const cm = crust.mul(mix(0.6, 1.0, flake)).toVar();
      albedo.assign(mix(albedo, crustCol, cm));
      emit.addAssign(tC.rgb.mul(tC.w).mul(0.12).mul(cm));
      specK.assign(mix(tA.w, 0.12, cm));
      gloss.assign(mix(tS.y, 20.0, cm));
      lf.assign(veinField);
      lw.assign(tP.y.mul(smoothstep(0.6, 0.68, zoneN)));
      lcol.assign(tC.rgb);
      lspec.assign(0.4);
      lemit.assign(tC.w);
    }).ElseIf(type.equal(8), () => {
      // ENERGETYCZNA: szklisty bazalt z siecią pęknięć, ładunek pulsuje i trzaska.
      // Uderzenie pioruna obok (storm.js → S.strikes): pęknięcia rozbłyskują.
      const ph = seed.mul(43.7).toVar();
      const pulse = sin(S.time.mul(fract(seed.mul(7.1)).mul(1.4).add(1.1)).add(ph)).mul(0.4).add(0.6);
      const crackle = pow(max(0.0, sin(S.time.mul(19.0).add(ph.mul(3.0))).mul(sin(S.time.mul(6.1).add(ph)))), 14.0).toVar();
      const surge = S.strikeSurge(positionWorld, R.mul(2.4)).toVar();
      const charge = pulse.add(crackle.mul(1.6)).add(surge.mul(0.9)).toVar();
      lf.assign(veinField);
      lw.assign(tP.y.mul(veinZone));
      lcol.assign(mix(tB.rgb, tA.rgb, smoothstep(0.35, 0.8, nd.r.add(surge.mul(0.4)))));
      lspec.assign(0.4);
      lemit.assign(tC.w.mul(charge));
      const halo = float(1).sub(smoothstep(0.0, 0.1, abs(veinField))).mul(veinZone);
      emit.addAssign(tB.rgb.mul(tC.w).mul(0.06).mul(halo).mul(charge));
      albedo.assign(mix(albedo, tD.rgb, smoothstep(0.4, 0.8, nq.r).mul(0.6)));
      H.subAssign(float(1).sub(smoothstep(0.0, 0.06, abs(veinField))).mul(relief));
      specK.assign(0.18);
      gloss.assign(tS.y);
      sparkK.assign(tP.z.mul(crackle.mul(3.0).add(0.4).add(surge.mul(2.0))));
      sparkCol.assign(tA.rgb);
    }).Else(() => {
      // NEUTRALNA: odcień per skała, regolit, łaty wietrzenia, głazy.
      const cool = step(0.5, fract(seed.mul(7.13)));
      const hi = mix(tBase, tA.rgb, cool);
      const lo = mix(tBase2, tB.rgb, cool);
      albedo.assign(mix(lo, hi, smoothstep(0.25, 0.75, macro.mul(0.7).add(n1.r.mul(0.3)))));
      albedo.mulAssign(mix(0.78, 1.12, convex));
      albedo.assign(mix(albedo, albedo.mul(1.25).add(0.015), crater.mul(0.5)));
      albedo.assign(mix(albedo, tD.rgb, smoothstep(0.5, 0.8, nq.r).mul(0.45)));
      const boulder = smoothstep(0.55, 0.95, nq.b).mul(smoothstep(0.45, 0.65, nq.a)).toVar();
      albedo.assign(mix(albedo, tC.rgb, boulder.mul(0.25)));
      H.addAssign(boulder.mul(relief));
      specK.assign(tA.w);
    });

    // --- Relief i linie (pochodne w jednolitym przepływie sterowania) ---
    const hDetail = nd.r.mul(0.8).add(nd.b.mul(0.2));
    const detailAmt = S.detail.mul(smoothstep(1.5, 5.0, pxPerUnit.mul(11.0)));
    const Htot = hDetail.mul(4.0).mul(detailAmt).add(H.mul(S.detail)).toVar();
    const dpx = dFdx(vp).toVar();
    const dpy = dFdy(vp).toVar();
    const dhx = dFdx(Htot);
    const dhy = dFdy(Htot);
    const r1 = cross(dpy, Nv).toVar();
    const r2 = cross(Nv, dpx).toVar();
    const det = dot(dpx, r1).toVar();
    const grad = r1.mul(dhx).add(r2.mul(dhy)).mul(sign(det));
    If(abs(det).greaterThan(1e-12), () => {
      Nv.assign(normalize(Nv.mul(abs(det)).sub(grad)));
    });
    const distPx = abs(lf).div(max(fwidth(lf), 1e-5));
    const widthVar = mix(0.3, 1.45, smoothstep(0.3, 0.7, n2.a));
    const halfPx = lw.mul(0.5).mul(widthVar).mul(pxPerUnit).toVar();
    const wPx = max(halfPx, 0.5).toVar();
    const hasLine = step(0.001, lw).toVar();
    const line = float(1).sub(smoothstep(wPx.sub(0.5), wPx.add(0.6), distPx)).mul(min(1.0, halfPx.mul(2.0))).mul(S.veins).mul(hasLine).toVar();
    const lineTint = veinZone.mul(S.veins).mul(0.16).mul(float(1).sub(min(1.0, halfPx.mul(2.0)))).mul(hasLine).toVar();
    albedo.assign(mix(albedo, lcol, clamp(line.add(lineTint), 0.0, 1.0)));
    metal.assign(max(metal, line.mul(lmetal)));
    specK.assign(mix(specK, lspec, line.mul(smoothstep(1.5, 4.0, halfPx))));

    // --- Parametry światła ---
    const sunT = mix(float(1.0), V.misc.w, S.sunOcc).toVar();
    const sunVis = sunT;
    // Otoczenie: w tle razem ze słońcem; w warstwie gry słabsze w cieniu (0,22)
    // i gaśnie w mroku pola (× (1 − mrok · 0,96); w grze Core3D 0,92 — w demie
    // głęboka noc ma być czarna poza światłami, prośba użytkownika 2026-09-27).
    const fill = (this.backdrop ? sunT : mix(float(0.22), float(1.0), sunVis).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.96)))).toVar();
    const diffAlbedo = albedo.mul(float(1.0).sub(metal.mul(0.85))).toVar();
    const specTint = mix(vec3(1.0), metalF0, metal).toVar();
    const mu = max(dot(Nv, Vv), 0.02).toVar();
    const Ls = normalize(cameraViewMatrix.mul(vec4(S.sunDir, 0.0)).xyz).toVar();
    const NdotLs = dot(Nv, Ls).toVar();
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const ambient = S.ambientTop.mul(up.mul(0.45).add(0.55)).add(S.ambientBounce.mul(max(0.0, NdotLs.negate()))).mul(ao);
    // (Bez poświaty krawędzi w mroku: głęboka noc ma być czarna — skały widać
    // tylko w świetle reflektorów, flar i świecących skał.)
    const emissive = diffAlbedo.mul(ambient).mul(fill).toVar();
    // Metal odbija otoczenie: blask tylko tam, gdzie odbicie celuje blisko słońca.
    If(metal.greaterThan(0.001), () => {
      const Rv = reflect(Vv.negate(), Nv);
      const glare = pow(max(dot(Rv, Ls), 0.0), 6.0);
      const env = S.ambientTop.mul(0.5).add(S.sunColor.mul(0.35).mul(glare).mul(sunVis)).mul(fill);
      emissive.addAssign(metalF0.mul(env).mul(metal).mul(ao.mul(0.65).add(0.35)));
    });
    // Lód: prześwit przy terminatorze i w szczelinach, chłodna obwódka (słabe).
    If(tS.x.greaterThan(0.5), () => {
      const sss = pow(clamp(float(1.0).sub(abs(NdotLs)), 0.0, 1.0), 3.0).mul(0.08);
      const rim = pow(float(1.0).sub(mu), 3.0).mul(0.05);
      emissive.addAssign(tC.rgb.mul(0.45).mul(sss.mul(sunVis).add(rim).add(line.mul(0.05).mul(sunVis))).mul(ao));
    });
    // Emisja (kryształ, uran, energetyczna) — HDR tylko na samej linii.
    emissive.addAssign(lcol.mul(line.add(lineTint.mul(0.25))).mul(lemit).add(emit));
    // Iskry ziaren: rzadkie komórki, dopiero gdy komórka ma ≥ 2 px.
    const sparkBase = step(0.965, nd.b).mul(step(0.62, nd.a)).mul(sparkK).mul(0.5).mul(smoothstep(1.5, 3.0, pxPerUnit.mul(11.0))).toVar();

    return {
      N: Nv, V: Vv, mu, diffAlbedo, lunarK: S.lunar.mul(float(1.0).sub(metal)), wrap: S.wrap,
      gloss, specK, specTint, sparkBase, sparkCol, sunVis, emissive
    };
  }
}

/**
 * Mapa cienia reflektora (kafel atlasu spotShadows.js): skały gry renderowane
 * z pozycji lampy, wyjście = 100 / odległość od lampy (0 = brak zasłony;
 * skala 100 trzyma wartości w zakresie normalnym HalfFloat). Ten sam
 * wierzchołek co materiał skał (kształt z banku, obrót w czasie, próg pikseli).
 */
export class RockShadowMaterial extends THREE.NodeMaterial {
  static get type() { return 'RockShadowMaterial'; }

  /**
   * @param {RockNodeMaterial} source materiał skał (wierzchołki, uniformy warstwy)
   * @param {{atlas, size}|null} [carve] skały w wydobyciu (minedRocks.js): wykopane
   *   miejsca nie rzucają cienia (ten sam test atlasu co RockNodeMaterial._carveTest)
   */
  constructor(source, carve = null) {
    super();
    this.lights = false;
    this.fog = false;
    this.lightPos = uniform(new THREE.Vector3());
    this.S = source.S;
    this.L = source.L;
    this.V = source.V;
    this.carve = null;
    const SV = carve ? {
      objP: varyingProperty('vec3', 'vShadowObjP'),
      carve: varyingProperty('vec4', 'vShadowCarve'),
      grid: varyingProperty('vec4', 'vShadowGrid')
    } : null;
    this.positionNode = RockNodeMaterial.prototype._buildVertex.call(this, false, SV);
    this.fragmentNode = Fn(() => {
      if (carve) {
        const p = SV.objP;
        const len = max(length(p), 1.0);
        const pin = p.mul(float(1.0).sub(SV.carve.w.mul(0.8).div(len)));
        const uvw = SV.carve.xyz.add(pin.sub(SV.grid.xyz).div(SV.carve.w)).add(0.5).div(carve.size);
        If(texture3D(carve.atlas, uvw).level(0).r.lessThan(0.5), () => { Discard(); });
      }
      const d = positionWorld.sub(this.lightPos).length();
      return vec4(float(100.0).div(max(d, 1.0)), 0.0, 0.0, 1.0);
    })();
  }
}
