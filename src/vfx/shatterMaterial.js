/**
 * shatterMaterial.js
 *
 * Materiały rozpadu w TSL (port WebGPU, zadanie 16; docs/webgpu/PLAN.md §3):
 *  - rozpad na trójkąty (createShatterMaterial) — każdy trójkąt odlatuje od swojego
 *    centroidu, potem dryfuje jako szczątek; geometria z atrybutami aCentroid i aRandom3
 *    (shatterShaderBake.js);
 *  - implozja (createImplodeMaterial) — zapas Destruction3D przy wielu rozpadach naraz
 *    (Tier 3, dawny GLSL w destruction3D.js).
 * Obraz 1:1 z dawnym GLSL (tag webgl-baseline) — te same wzory w tej samej kolejności
 * działań. Odstępstwa tylko tam, gdzie WGSL liczy inaczej niż FXC w bazie WebGL:
 * `pow(x, 2.0)` z ujemną podstawą = mnożenie (FXC mnożył, WGSL daje NaN), smoothstep
 * z odwróconymi krawędziami wzorem (w WGSL stałe krawędzie low ≥ high to błąd shadera).
 *
 * GRAF RAZ, WARTOŚCI NA OBIEKT. W WebGL każdy rozpadany mesh dostawał własny
 * ShaderMaterial (program z cache po źródle). W WebGPU nowy graf na mesh = pełny
 * NodeBuilder na CPU w klatce rozpadu. Tu graf budowany raz na moduł, a każdy mesh ma
 * lekki materiał z TYMI SAMYMI węzłami (ten sam klucz programu — jeden NodeBuilder i jeden
 * pipeline na układ geometrii). Wartości per mesh siedzą w `material.uniforms` (obiekty
 * `{ value }` jak w ShaderMaterial — destruction3D.js zapisuje uShatterTime / uTime bez
 * zmian), węzły czytają je przy rysowaniu obiektu (`uniform().onObjectUpdate`, grupa
 * „object”); tekstura tDiffuse — węzeł tekstury per obiekt (src/3d/tsl/teksturaObiektu.js).
 *
 * Stan renderu jak ShaderMaterial w WebGL: przezroczysty, bez zapisu głębi, jeden draw
 * (forceSinglePass — WebGPU rysowałby przezroczysty DoubleSide dwa razy), bez świateł,
 * mgły i płaszczyzn cięcia (ShaderMaterial ma clipping = false — kawałek pękniętej skorupy
 * rozpada się w trójkąty cały, jak w WebGL). Wierzchołki liczy vertexNode (modelViewMatrix
 * three — z highPrecision składany na CPU w double), więc pass cienia słońca rysuje
 * nieprzesuniętą bryłę (domyślny wierzchołek) — jak WebGL, gdzie mapa cienia szła
 * MeshDepthMaterial po atrybucie position.
 *
 * Usage:
 *   import { createShatterMaterial } from './shatterMaterial.js';
 *   const mat = createShatterMaterial({ map: mesh.material.map });
 *   mesh.geometry = bakedGeo;
 *   mesh.material = mat;
 *   mat.uniforms.uShatterTime.value = worldTime;  // trigger!
 *
 * Uniforms (material.uniforms, jak dawniej):
 *   uTime          — current world time (seconds), co klatkę
 *   uShatterTime   — world time of the shatter (trigger)
 *   uDuration, uDebrisLifetime, uFragmentDrift, uSpin, uShrink, uHeatGlow, uGravity,
 *   uStaggerWindow, uBurstStrength — parametry efektu
 *   uHasTexture, tDiffuse, uBaseColor — barwa z mapy albo stała
 */

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, vec3, vec4, uniform, attribute, varyingProperty, uv,
  positionGeometry, normalGeometry, modelViewMatrix, cameraProjectionMatrix,
  clamp, cos, cross, dot, exp, fract, max, min, mix, normalize, sin, smoothstep, step
} from 'three/tsl';
import { teksturaObiektu, teksturaZastepcza } from '../3d/tsl/teksturaObiektu.js';

// Liczniki (rozgrzewka, spawn, testy): `materials` — lekkie materiały per mesh (tanie),
// `builds` — budowy NodeBuildera (drogie; tyle, ile układów geometrii i kontekstów renderu).
export const SHATTER_TSL_STATS = {
  materials: { shatter: 0, implode: 0 },
  builds: { shatter: 0, implode: 0 }
};

export const SHATTER_MATERIAL_NAMES = Object.freeze({ shatter: 'Shatter', implode: 'Implode' });

// Klucze `material.uniforms` czytane przez graf (typ węzła per obiekt).
const SHATTER_KEYS = Object.freeze({
  uTime: 'float', uShatterTime: 'float', uDuration: 'float', uDebrisLifetime: 'float',
  uFragmentDrift: 'float', uSpin: 'float', uShrink: 'float', uHeatGlow: 'float', uGravity: 'float',
  uStaggerWindow: 'float', uBurstStrength: 'float', uHasTexture: 'float', uBaseColor: 'color'
});
const IMPLODE_KEYS = Object.freeze({ uTime: 'float', uStartTime: 'float', uDuration: 'float', uColor: 'color' });
export const SHATTER_GRAPH_KEYS = Object.freeze({ shatter: Object.keys(SHATTER_KEYS), implode: Object.keys(IMPLODE_KEYS) });

// Wartość per obiekt: węzeł wspólny dla wszystkich materiałów grafu, wartość z
// material.uniforms[klucz].value rysowanego obiektu.
function perObject(key, type) {
  const init = type === 'color' ? new THREE.Color() : 0;
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

function perObjectUniforms(keys) {
  const U = {};
  for (const [key, type] of Object.entries(keys)) U[key] = perObject(key, type);
  return U;
}

// smoothstep wzorem (jak rozwija go HLSL): poprawny także dla e0 > e1 — smoothstep(0.20, 0.0, t).
const smoothRev = (e0, e1, x) => {
  const t = clamp(float(x).sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
};

// hash13 z GLSL (p = fract(p·0,1031); p += dot(p, p.yzx + 33,33); fract((p.x + p.y)·p.z)).
const hash13 = (p0) => {
  const p = fract(p0.mul(0.1031)).toVar();
  p.addAssign(dot(p, p.yzx.add(33.33)));
  return fract(p.x.add(p.y).mul(p.z));
};

// projectionMatrix · modelViewMatrix · vec4(p, 1) — węzeł modelViewMatrix three (highPrecision).
const project = (p) => cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(p, 1.0)));

// Poza obcięciem (z > w) — pozycja wierzchołka (0, 0, 9999, 1) jak w dawnym GLSL.
const CLIPPED = vec4(0.0, 0.0, 9999.0, 1.0);

// Mapa zastępcza (budowa grafu i meshe bez mapy — wtedy i tak uHasTexture = 0).
const PLACEHOLDER_DIFFUSE = teksturaZastepcza(255, 255, 255, 255, THREE.SRGBColorSpace);

// ── Graf: rozpad na trójkąty ─────────────────────────────────────────────────────
function buildShatterGraph() {
  const U = perObjectUniforms(SHATTER_KEYS);
  const aCentroid = attribute('aCentroid', 'vec3');
  const aRandom3 = attribute('aRandom3', 'vec3');
  const vUv = varyingProperty('vec2', 'vShatterUv');
  const vAlpha = varyingProperty('float', 'vShatterAlpha');
  const vHeat = varyingProperty('float', 'vShatterHeat');

  const vertexNode = Fn(() => {
    vUv.assign(uv());
    vAlpha.assign(0.0);
    vHeat.assign(0.0);
    const clip = vec4(CLIPPED).toVar();

    const t = U.uTime.sub(U.uShatterTime).toVar();
    const triSeed = hash13(aRandom3.mul(3.71).add(aCentroid.mul(0.017))).toVar();
    const triDelay = triSeed.mul(U.uStaggerWindow);
    const maxLife = U.uDebrisLifetime.add(U.uStaggerWindow);
    const localT = t.sub(triDelay).toVar();

    // Przed wyzwoleniem albo po całym życiu — niewidoczny (poza obcięciem).
    If(t.lessThan(0.0).or(t.greaterThan(maxLife)), () => {
      clip.assign(CLIPPED);
    }).ElseIf(localT.lessThanEqual(0.0), () => {
      // Trójkąt jeszcze nie puszczony — pierwotny kształt (rozpad stopniowany).
      vAlpha.assign(1.0);
      vHeat.assign(U.uHeatGlow.mul(smoothRev(0.20, 0.0, t)).mul(smoothstep(0.0, 0.02, t)));
      clip.assign(project(positionGeometry));
    }).ElseIf(localT.greaterThan(U.uDebrisLifetime), () => {
      clip.assign(CLIPPED);
    }).Else(() => {
      const dur = max(0.001, U.uDuration.mul(mix(0.72, 1.18, triSeed))).toVar();
      const activeT = min(localT, dur).toVar();
      const debrisT = max(0.0, localT.sub(dur)).toVar();
      const an = activeT.div(dur).toVar();   // 0→1 w fazie aktywnej

      // DRYF: centroid leci wzdłuż aRandom3 (wygładzony), potem impulsy wtórne.
      const driftCurve = an.mul(an).mul(float(3.0).sub(an.mul(2.0)));
      const activeDrift = aRandom3.mul(U.uFragmentDrift).mul(driftCurve);

      // exp(-pow(x, 2.0)) — potęga całkowita mnożeniem (x < 0 w WGSL: pow = NaN).
      const b1 = localT.sub(0.06).mul(8.0).toVar();
      const b2 = localT.sub(0.22).mul(5.2).toVar();
      const b3 = localT.sub(0.48).mul(3.7).toVar();
      const burst1 = exp(b1.mul(b1).negate());
      const burst2 = exp(b2.mul(b2).negate());
      const burst3 = exp(b3.mul(b3).negate());
      const burstPulse = burst1.mul(0.65).add(burst2.mul(0.45)).add(burst3.mul(0.25));
      const burstDrift = aRandom3.mul(U.uFragmentDrift).mul(U.uBurstStrength).mul(burstPulse);

      // Faza szczątka: bezwładność, potem wykładniczy opór.
      const debrisDrag = exp(debrisT.negate().mul(0.42));
      const debrisDrift = aRandom3.mul(U.uFragmentDrift).mul(float(0.45).add(triSeed.mul(0.55))).mul(debrisT).mul(debrisDrag);

      // KOZIOŁKOWANIE: obrót Rodriguesa wokół osi odchylonej od kierunku dryfu.
      const axis = normalize(aRandom3.add(vec3(0.311, 0.723, -0.461).mul(0.35))).toVar();
      const totalAngle = U.uSpin.mul(activeT.mul(1.15).add(debrisT.mul(0.35))).toVar();
      // Trójkąt kurczy się do centroidu w fazie aktywnej.
      const relPos = positionGeometry.sub(aCentroid).mul(float(1.0).sub(an.mul(U.uShrink))).toVar();
      const cosA = cos(totalAngle).toVar();
      const sinA = sin(totalAngle).toVar();
      const tumbled = relPos.mul(cosA)
        .add(cross(axis, relPos).mul(sinA))
        .add(axis.mul(dot(axis, relPos)).mul(float(1.0).sub(cosA)));

      // GRAWITACJA (opcjonalna): s = ½ g t².
      const drop = U.uGravity.mul(t).mul(t).mul(0.5);
      const centroidWorld = aCentroid.add(activeDrift).add(burstDrift).add(debrisDrift).toVar();
      centroidWorld.y.subAssign(drop);
      clip.assign(project(centroidWorld.add(tumbled)));

      // ALFA: faza aktywna — szybkie wejście, trzymanie, zanik w ostatnich 40%;
      // szczątek — powolny zanik wykładniczy. step(dur, t) — jak w GLSL (t, nie localT).
      const fadeIn = smoothstep(0.0, 0.06, an).toVar();
      const activeAlpha = fadeIn.mul(float(1.0).sub(smoothstep(0.58, 1.0, an)));
      const debrisAlpha = fadeIn.mul(exp(debrisT.negate().mul(0.22)));
      vAlpha.assign(mix(activeAlpha, debrisAlpha, step(dur, t)));

      // ŻAR (pierwsze ~200 ms po puszczeniu trójkąta).
      vHeat.assign(U.uHeatGlow.mul(smoothRev(0.24, 0.0, localT)).mul(smoothstep(0.0, 0.02, localT)));
    });
    return clip;
  })();

  const diffuse = teksturaObiektu('tDiffuse', PLACEHOLDER_DIFFUSE, vUv);

  const fragmentNode = Fn(() => {
    If(vAlpha.lessThan(0.005), () => {
      Discard();
    });
    // Warunek z uniformu (jednolity przepływ) — próbka tylko przy mapie, jak ternary w GLSL.
    const texColor = vec4(U.uBaseColor, 1.0).toVar();
    If(U.uHasTexture.greaterThan(0.5), () => {
      texColor.assign(diffuse);
    });
    // Żar: pomarańczowo-gorąca emisja, szybko gaśnie (HDR — bloom).
    const heatColor = vec3(1.0, 0.42, 0.06).mul(vHeat).mul(5.0);
    return vec4(texColor.rgb.add(heatColor), texColor.a.mul(vAlpha));
  })();

  return { vertexNode, fragmentNode, uniforms: U, diffuse };
}

// ── Graf: implozja (Tier 3) ──────────────────────────────────────────────────────
function buildImplodeGraph() {
  const U = perObjectUniforms(IMPLODE_KEYS);
  const vAlpha = varyingProperty('float', 'vImplodeAlpha');

  // noise3 z GLSL: fract(sin(dot(p, (12,9898; 78,233; 45,164))) · 43758,5453).
  const noise3 = (p) => fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))).mul(43758.5453));

  const vertexNode = Fn(() => {
    const t = clamp(U.uTime.sub(U.uStartTime).div(max(0.001, U.uDuration)), 0.0, 1.0).toVar();
    const n = noise3(positionGeometry.mul(0.01)).mul(2.0).sub(1.0);
    const disp = sin(t.mul(3.14159).mul(2.0).add(n.mul(4.0))).mul(80.0).mul(float(1.0).sub(t));
    const pos = positionGeometry.add(normalGeometry.mul(disp)).toVar();
    pos.mulAssign(float(1.0).sub(t.mul(t)));   // skala do zera
    vAlpha.assign(float(1.0).sub(t));
    return project(pos);
  })();

  const fragmentNode = Fn(() => {
    If(vAlpha.lessThan(0.01), () => {
      Discard();
    });
    return vec4(U.uColor.mul(vAlpha).mul(1.5), vAlpha);
  })();

  return { vertexNode, fragmentNode, uniforms: U };
}

const GRAPHS = { shatter: null, implode: null };

/** Graf ('shatter' | 'implode') — budowany raz, wspólny dla wszystkich materiałów rozpadu. */
export function getShatterGraph(kind = 'shatter') {
  const key = kind === 'implode' ? 'implode' : 'shatter';
  if (!GRAPHS[key]) GRAPHS[key] = key === 'implode' ? buildImplodeGraph() : buildShatterGraph();
  return GRAPHS[key];
}

function cloneHolders(src) {
  const out = {};
  for (const key of Object.keys(src || {})) {
    const v = src[key]?.value;
    out[key] = { value: (v && typeof v.clone === 'function' && !v.isTexture) ? v.clone() : v };
  }
  return out;
}

/**
 * Lekki materiał rozpadu: węzły wspólne dla grafu, wartości w `uniforms` (obiekty
 * `{ value }`). Stan renderu jak dawny ShaderMaterial (patrz nagłówek).
 */
export class ShatterNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'ShatterNodeMaterial';
  }

  constructor(kind = 'shatter', uniforms = null) {
    super();
    const key = kind === 'implode' ? 'implode' : 'shatter';
    const g = getShatterGraph(key);
    this.isShatterNodeMaterial = true;
    this._shatterKind = key;
    this.name = SHATTER_MATERIAL_NAMES[key];
    this.uniforms = uniforms || defaultUniforms(key);
    this.vertexNode = g.vertexNode;
    this.fragmentNode = g.fragmentNode;
    // Pass cienia (Renderer._getShadowNodes) bierze `material.map !== null` za mapę —
    // w gołym NodeMaterial pole jest undefined → texture(undefined) i błąd budowy cienia.
    this.map = null;
    this.alphaMap = null;
    this.transparent = true;
    this.depthWrite = false;
    this.side = key === 'implode' ? THREE.FrontSide : THREE.DoubleSide;
    // Jak ShaderMaterial w WebGL: jeden draw, nie dwa (tył + przód).
    this.forceSinglePass = true;
    this.lights = false;
    this.fog = false;
    SHATTER_TSL_STATS.materials[key]++;
  }

  // ShaderMaterial w WebGL: clipping = false — kontekst cięcia renderera (ClippingGroup) nie
  // dotyczy rozpadu na trójkąty. Kawałki skorupy tną się maską na klonach SWOICH materiałów
  // (destruction3D.js), której materiał rozpadu nie ma — kawałek rozpada się cały, jak w WebGL.
  setupClipping() {
    return null;
  }

  setupHardwareClipping() {
    this.hardwareClipping = false;
  }

  setup(builder) {
    // Wywoływane tylko przy budowie NodeBuildera (raz na klucz programu).
    SHATTER_TSL_STATS.builds[this._shatterKind]++;
    return super.setup(builder);
  }

  copy(source) {
    super.copy(source);
    this._shatterKind = source._shatterKind;
    this.name = source.name;
    this.uniforms = cloneHolders(source.uniforms);
    return this;
  }
}

function defaultUniforms(kind) {
  if (kind === 'implode') {
    return { uTime: { value: 0 }, uStartTime: { value: 0 }, uDuration: { value: 1.2 }, uColor: { value: new THREE.Color(0.6, 0.65, 0.7) } };
  }
  return {
    uTime: { value: 0.0 }, uShatterTime: { value: -9999.0 }, uDuration: { value: 1.8 }, uDebrisLifetime: { value: 60.0 },
    uFragmentDrift: { value: 800 }, uSpin: { value: 4.0 }, uShrink: { value: 0.35 }, uHeatGlow: { value: 1.0 },
    uGravity: { value: 0 }, uStaggerWindow: { value: 0.55 }, uBurstStrength: { value: 0.65 },
    uHasTexture: { value: 0.0 }, tDiffuse: { value: null }, uBaseColor: { value: new THREE.Color(0.5, 0.55, 0.6) }
  };
}

/** Czy materiał to materiał rozpadu z grafu tego modułu (testy, spis). */
export function isShatterNodeMaterial(material) {
  return material?.isShatterNodeMaterial === true;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {THREE.Texture|null}  [opts.map]            Diffuse texture from source material
 * @param {THREE.Color|null}    [opts.color]          Fallback colour when no map
 * @param {number}  [opts.duration=1.8]
 * @param {number}  [opts.debrisLifetime=60]
 * @param {number}  [opts.fragmentDrift=800]
 * @param {number}  [opts.spin=4.0]
 * @param {number}  [opts.shrink=0.35]
 * @param {number}  [opts.heatGlow=1.0]
 * @param {number}  [opts.gravity=0]
 * @param {number}  [opts.staggerWindow=0.55]
 * @param {number}  [opts.burstStrength=0.65]
 * @returns {ShatterNodeMaterial}
 */
export function createShatterMaterial(opts = {}) {
    const {
        map           = null,
        color         = new THREE.Color(0.5, 0.55, 0.6),
        duration      = 1.8,
        debrisLifetime = 60.0,
        fragmentDrift = 800,
        spin          = 4.0,
        shrink        = 0.35,
        heatGlow      = 1.0,
        gravity       = 0,
        staggerWindow = 0.55,
        burstStrength = 0.65,
    } = opts;

    return new ShatterNodeMaterial('shatter', {
        uTime:          { value: 0.0 },
        uShatterTime:   { value: -9999.0 },  // trigger by setting to current time
        uDuration:      { value: duration },
        uDebrisLifetime:{ value: debrisLifetime },
        uFragmentDrift: { value: fragmentDrift },
        uSpin:          { value: spin },
        uShrink:        { value: shrink },
        uHeatGlow:      { value: heatGlow },
        uGravity:       { value: gravity },
        uStaggerWindow: { value: staggerWindow },
        uBurstStrength: { value: burstStrength },
        uHasTexture:    { value: map ? 1.0 : 0.0 },
        tDiffuse:       { value: map },
        uBaseColor:     { value: color instanceof THREE.Color ? color : new THREE.Color(color) },
    });
}

/**
 * Materiał implozji (Tier 3): siatka faluje wzdłuż normalnych i zapada się do zera
 * w `duration` sekund od `startTime`, barwa `color` gaśnie z alfą.
 * @param {object} opts
 * @param {number} opts.startTime  czas świata startu (s)
 * @param {number} [opts.duration=1.2]
 * @param {THREE.Color} [opts.color]
 * @returns {ShatterNodeMaterial}
 */
export function createImplodeMaterial({ startTime = 0, duration = 1.2, color = null } = {}) {
    return new ShatterNodeMaterial('implode', {
        uTime:      { value: startTime },
        uStartTime: { value: startTime },
        uDuration:  { value: duration },
        uColor:     { value: color ? color.clone() : new THREE.Color(0.6, 0.65, 0.7) },
    });
}

// Eksport węzłów do testów struktury grafu (bez GPU).
export const SHATTER_TSL_INTERNALS = Object.freeze({ smoothRev, PLACEHOLDER_DIFFUSE, SHATTER_KEYS, IMPLODE_KEYS });
