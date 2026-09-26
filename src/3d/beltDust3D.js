// src/3d/beltDust3D.js
//
// Mgła, pył i gaz pasa asteroid — warstwa tła (Core3D warstwa 1).
//
// Zamiast addytywnych plam: kilka PŁATÓW objętości na różnych głębokościach
// pod płaszczyzną gry (od kilkuset do ~20 tys. j.). Każdy płat to siatka
// rozpięta na kadrze w swojej głębokości, z testem głębi — skała tła leżąca
// głębiej tonie w płatach nad nią, płytsza przebija je (to samo, co dałby
// raymarch objętości, ale kamera gry patrzy zawsze z góry, więc wystarczy
// kilka warstw). Pył POCHŁANIA i ROZPRASZA: blend premultiplied „over”,
// gęsty obłok przygasza gwiazdy i mgławicę, a nie tylko świeci.
//
// Kształt: kafelkowany szum 2D pieczony raz na GPU (fbm, włókna z grzbietów,
// pole zawinięcia domeny), próbkowany w układzie świata z początkiem liczonym
// na CPU w double (bez drgań float32 przy 5–10 mln j.). Gęstość makro =
// AsteroidBeltField.sampleMacro (ten sam profil pasa i te same GĘSTE POLA co
// skały) w wierzchołkach siatki kotwiczonych w świecie.
//
// Światło: słońce w płaszczyźnie — samocień (gęstość w stronę słońca gasi
// rozproszenie), brzegi od słońca jaśniejsze; smuga cienia planet/skał z maski
// Core3D (sunShaftBackdrop), jak na mgławicy tła.
//
// Drobiny (Points) tuż pod płaszczyzną: pył w kadrze przy zoomie 1, daje
// czucie ruchu i paralaksę (skały gry nie muszą być gęste, żeby było widać,
// że się leci przez pas).

import * as THREE from 'three';
import { FIELD_LIGHTS_GLSL, attachFieldLightUniforms } from './fieldLights3D.js';
import { stormIntensity } from '../game/asteroidStorms.js';

// alpha = krycie płatu przy pełnej gęstości. Suma po płatach zostaje pod ~1,
// a gęstość w szumie rzadko dochodzi do 1 — w rdzeniu pola ~50–60% krycia,
// w zwykłym pasie pojedyncze smugi. Pierwsza wersja (0,30–0,66) robiła z tła
// szarą ścianę.
export const DUST_SLICES = Object.freeze([
  Object.freeze({ depth: 420, scale: 9000, alpha: 0.10, drift: 0.8 }),
  Object.freeze({ depth: 1300, scale: 14000, alpha: 0.11, drift: 0.6 }),
  Object.freeze({ depth: 2800, scale: 21000, alpha: 0.13, drift: 0.45 }),
  Object.freeze({ depth: 5200, scale: 31000, alpha: 0.15, drift: 0.35 }),
  Object.freeze({ depth: 8600, scale: 44000, alpha: 0.17, drift: 0.25 }),
  Object.freeze({ depth: 13500, scale: 62000, alpha: 0.19, drift: 0.18 }),
  Object.freeze({ depth: 20500, scale: 90000, alpha: 0.22, drift: 0.12 })
]);

export const DUST_LOOK_DEFAULTS = Object.freeze({
  // Pył skalny (Main Belt, Trojańczycy, Hildas): neutralny szary, NIE brązowy
  // (zgłoszenie: „brązowe plamy”). Jasna strona w słońcu, ciemna chłodna w cieniu.
  rockLit: [0.19, 0.186, 0.178],
  rockShade: [0.012, 0.015, 0.022],
  // Pył lodowy (Kuiper): chłodny, jaśniejszy w słońcu.
  iceLit: [0.16, 0.2, 0.26],
  iceShade: [0.011, 0.016, 0.028],
  density: 1.0,
  brightness: 1.0,
  shadow: 3.2,
  specks: 1.0
});

// Siatka płatu (GRID × GRID kwadratów): gęstość makro i rozpraszanie świateł
// statków liczone w wierzchołkach. 36, nie 20: przy 20 stożek reflektora
// w pyle miał kanciaste, prostokątne brzegi (węzeł co ~128 j. przy zoomie 1).
const GRID = 36;

// Okres zawinięcia początku szumu (w kaflach). Shadery próbkują szum także
// w skalach ×0,55, ×1,9, ×4,3 (płaty), ×0,6, ×2,7 (zasłona) i ×3,1 (smugi
// reflektorów): początek liczony mod 1 przeskakiwał przy zawinięciu o 0,55
// kafla itd. — cały wzór mgły skakał co `scale` j. lotu. Każdy z tych
// mnożników × 20 jest całkowity, więc zawinięcie mod 20 jest bezszwowe.
// Nowy mnożnik w shaderze = sprawdzić, czy × DUST_NOISE_WRAP jest całkowity.
export const DUST_NOISE_WRAP = 20;

/** Początek szumu w kaflach, zawinięty bezszwowo (double na CPU). */
export function wrapDustNoise(v) {
  return v - Math.floor(v / DUST_NOISE_WRAP) * DUST_NOISE_WRAP;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep01(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Kafelkowany szum 2D (GPU, raz)

const NOISE2D_FRAGMENT = /* glsl */`
precision highp float;
precision highp int;
uniform float uSize;
uint hashu(uvec2 p) {
  p = p * uvec2(1597334673u, 3812015801u);
  uint h = (p.x ^ p.y) * 1597334673u;
  h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u;
  return h;
}
float h01(ivec2 c, int period, uint salt) {
  ivec2 w = ((c % period) + period) % period;
  return float(hashu(uvec2(w) + uvec2(salt, salt * 7u)) & 0xFFFFFFu) / 16777215.0;
}
float tnoise(vec2 p, int period, uint salt) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  ivec2 c = ivec2(i);
  float a = h01(c, period, salt);
  float b = h01(c + ivec2(1, 0), period, salt);
  float d = h01(c + ivec2(0, 1), period, salt);
  float e = h01(c + ivec2(1, 1), period, salt);
  return mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}
float tfbm(vec2 uv, int basePeriod, uint salt, int octaves, bool ridged) {
  float s = 0.0, amp = 0.5, n = 0.0;
  int period = basePeriod;
  for (int o = 0; o < 8; o++) {
    if (o >= octaves) break;
    float v = tnoise(uv * float(period), period, salt + uint(o) * 131u);
    if (ridged) { v = 1.0 - abs(v * 2.0 - 1.0); v *= v; }
    s += amp * v;
    n += amp;
    amp *= 0.52;
    period *= 2;
  }
  return s / n;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5) / uSize;
  float r = tfbm(uv, 4, 7u, 7, false);
  float g = tfbm(uv, 6, 19u, 6, true);
  float b = tfbm(uv, 3, 37u, 4, false);
  float a = tfbm(uv, 3, 59u, 4, false);
  gl_FragColor = vec4(r, g, b, a);
}
`;

export function bakeDustNoise2D(renderer, size = 512) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.RepeatWrapping
  });
  rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
  rt.texture.colorSpace = THREE.NoColorSpace;
  const material = new THREE.ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: NOISE2D_FRAGMENT,
    uniforms: { uSize: { value: size } },
    depthTest: false,
    depthWrite: false
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
  } finally {
    renderer.setRenderTarget(prev);
    material.dispose();
    quad.geometry.dispose();
  }
  return rt;
}

// ---------------------------------------------------------------------------
// Płat

// Rozpraszanie świateł statków w pyle liczone W WIERZCHOŁKACH siatki płatu
// (37 × 37) i interpolowane: światło w pyle jest gładkie, a w pikselu płaty
// płaciły pętlę po wszystkich światłach na pełnym ekranie ×3 — to był prawie
// cały koszt świateł pola (pomiar 2026-09-26: 45 świateł +0,9–1,8 ms → z mgłą
// w wierzchołkach +0,3–0,45 ms przy 2560×1440 na RTX 5080).
const SLICE_VERTEX = /* glsl */`
attribute vec3 aMacro;       // x gęstość makro 0..1, y udział lodu, z burza (0..1)
uniform float uLightScatter;
varying vec2 vLocal;
varying vec3 vMacro;
varying vec3 vScatter;
${FIELD_LIGHTS_GLSL}
void main() {
  vLocal = position.xy;
  vMacro = aMacro;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vScatter = (uFieldLightCount > 0 && uLightScatter > 0.0) ? fieldLightsScatter(mv.xyz) * uLightScatter : vec3(0.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SLICE_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uNoise;
uniform vec2 uBase;          // początek płatu w kaflach szumu (mod DUST_NOISE_WRAP, z CPU w double)
uniform float uScale;        // j. świata na kafel
uniform vec2 uDrift;         // przesunięcie w czasie (kafle)
uniform vec2 uSunDir;        // kierunek do słońca w płaszczyźnie sceny
uniform vec3 uRockLit;
uniform vec3 uRockShade;
uniform vec3 uIceLit;
uniform vec3 uIceShade;
uniform float uAlpha;
uniform float uDensity;
uniform float uBright;
uniform float uShadowK;
uniform float uSeed;
// Słońce przesłonięte przez pole (mapa transmitancji; offset = środek płatu − róg mapy).
uniform sampler2D uFieldMap;
uniform float uFieldMapOn;
uniform vec2 uFieldMapOffset;
uniform vec2 uFieldMapInvSize;
varying vec2 vLocal;
varying vec3 vMacro;
varying vec3 vScatter;
// Burza energetyczna: naładowany pył tli się fioletem wzdłuż struktury chmur.
uniform vec3 uStormColor;
uniform float uStormGlow;
uniform float uStormTime;
void main() {
  float macro = vMacro.x;
  if (macro < 0.002) discard;
  vec2 p = uBase + vLocal / uScale + vec2(uSeed * 0.371, uSeed * 0.613);
  // Zawinięcie domeny: smugi i włókna zamiast okrągłych kłębów.
  vec2 w = texture(uNoise, p * 0.55 + vec2(0.13, 0.71)).ba * 2.0 - 1.0;
  vec2 q = p + w * 0.22 + uDrift;
  float body = texture(uNoise, q).r;
  float fil = texture(uNoise, q * 1.9 + w.yx * 0.1 + 0.37).g;
  float fine = texture(uNoise, q * 4.3 + 0.61).r;
  // Kompozyt znormalizowany (wagi sumują się do 1, średnia ~0,5). Próg zależny
  // od gęstości makro: rzadki pas = pojedyncze smugi, pole = obłoki z przerwami.
  float c = (body * 0.78 + fil * 0.32 + fine * 0.12) / 1.22;
  float thr = mix(0.62, 0.5, macro);
  float d = smoothstep(thr, thr + 0.16, c);
  d *= 0.35 + 0.65 * macro;
  if (d < 0.003) discard;
  // Samocień: ile pyłu leży w stronę słońca (gęsty obłok ma ciemną stronę).
  vec2 qs = q + uSunDir * 0.07;
  float toward = (texture(uNoise, qs).r * 0.78 + texture(uNoise, qs * 1.9 + w.yx * 0.1 + 0.37).g * 0.32) / 1.1;
  float occl = smoothstep(thr - 0.04, thr + 0.2, toward) * (0.4 + 0.6 * macro);
  float lit = exp(-occl * uShadowK);
  // Brzeg obłoku od strony słońca jaśniejszy (światło przechodzi przez cienką warstwę).
  float edge = clamp((d - occl) * 1.6, 0.0, 1.0);
  vec3 litC = mix(uRockLit, uIceLit, vMacro.y);
  vec3 shadeC = mix(uRockShade, uIceShade, vMacro.y);
  // Słońce przesłonięte przez pole: pył w głębi gaśnie (w cieniu zostaje ciemny,
  // pochłaniający), jasny tylko tam, gdzie słońce jeszcze dochodzi.
  float sunT = 1.0;
  if (uFieldMapOn > 0.5) {
    vec2 fuv = (vLocal + uFieldMapOffset) * uFieldMapInvSize;
    if (fuv.x >= 0.0 && fuv.y >= 0.0 && fuv.x <= 1.0 && fuv.y <= 1.0) sunT = texture(uFieldMap, fuv).r;
  }
  // W pełnym mroku pola pył nie świeci wcale (tylko pochłania i rozprasza
  // światła statków niżej) — całkowita ciemność w rdzeniu.
  vec3 col = mix(shadeC * sunT, litC * sunT, clamp(lit + edge * 0.35, 0.0, 1.0) * sunT) * uBright;
  // Bez smugi z maski cienia: słońce leży w płaszczyźnie, cień kadłuba nie
  // pada na pył setki–tysiące jednostek niżej (był prostokąt przez cały kadr).
  float a = clamp(1.0 - exp(-d * uDensity * 2.2), 0.0, 1.0) * uAlpha;
  // Światła statków rozpraszają się w pyle — reflektor widać w gęstej mgle
  // (natężenie z wierzchołków, faktura z gęstości pyłu w pikselu).
  vec3 scat = vScatter * (0.4 + 0.6 * d);
  // Naładowany pył w komórce burzy: poświata w gęstych kłębach, pulsuje
  // z czasem wzdłuż włókien (bez dodatkowych próbek szumu).
  vec3 storm = vec3(0.0);
  if (vMacro.z > 0.01 && uStormGlow > 0.0) {
    float breathe = 0.55 + 0.45 * sin(uStormTime * 1.9 + body * 13.0 + fil * 7.0);
    // Tylko gęste kłęby i włókna — nie jednolita fioletowa mgła na cały kadr.
    storm = uStormColor * vMacro.z * uStormGlow * smoothstep(0.45, 0.95, d) * smoothstep(0.5, 0.8, fil) * breathe;
  }
  gl_FragColor = vec4(col * a + scat * a + storm * a, a);
}
`;

// ---------------------------------------------------------------------------
// Drobiny

const SPECK_VERTEX = /* glsl */`
uniform vec2 uWrap;          // przesunięcie kamery mod pudło (CPU, double)
uniform float uBox;
uniform float uPxScale;
uniform float uCamZ;
uniform float uPixelRatio;
uniform vec3 uColor;         // barwa w słońcu
uniform float uSunLevel;     // słońce przy kamerze (transmitancja pola)
uniform float uLightGain;
attribute float aSize;
attribute float aPhase;
varying float vAlpha;
varying float vPhase;
varying vec3 vLit;
${FIELD_LIGHTS_GLSL}
void main() {
  vec3 p = position;
  // Pudło zawijane wokół kamery: drobiny zostają w świecie, kadr ich nie gubi.
  p.xy = mod(p.xy - uWrap + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float depth = -p.z;
  float pxPerUnit = uPxScale / (uCamZ + depth);
  gl_PointSize = clamp(aSize * pxPerUnit * uPixelRatio, 1.0, 6.0);
  // Gaśnie przy brzegu pudła i gdy drobina jest poniżej piksela.
  vec2 e = abs(p.xy) / (0.5 * uBox);
  vAlpha = (1.0 - smoothstep(0.8, 1.0, max(e.x, e.y))) * smoothstep(0.2, 0.9, aSize * pxPerUnit);
  vPhase = aPhase;
  // Drobina świeci tym, co na nią pada: słońce (w cieniu pola gaśnie)
  // i światła statków — w mroku rdzenia pył iskrzy w reflektorach.
  vLit = uColor * uSunLevel + (uFieldLightCount > 0 ? fieldLightsScatter(mv.xyz) * uLightGain : vec3(0.0));
}
`;

const SPECK_FRAGMENT = /* glsl */`
precision highp float;
uniform float uAmount;
uniform float uTime;
varying float vAlpha;
varying float vPhase;
varying vec3 vLit;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = dot(c, c) * 4.0;
  float m = exp(-r * 3.0);
  // Iskrzenie: drobiny obracają się w świetle.
  float tw = 0.55 + 0.45 * sin(uTime * (0.7 + vPhase * 1.9) + vPhase * 40.0);
  vec3 col = vLit * (m * vAlpha * uAmount * tw);
  float a = max(col.r, max(col.g, col.b));
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}
`;

// ---------------------------------------------------------------------------
// Zasłona tła w gęstym polu: zamiast mgławicy ciemny pył z delikatną strukturą
// (w rdzeniu pola widać tylko bliski pył i skały, nie galaktykę za nimi).

const VEIL_VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const VEIL_FRAGMENT = /* glsl */`
precision highp float;
uniform sampler2D uNoise;
uniform vec2 uBase;          // przesunięcie szumu (kamera × paralaksa, mod DUST_NOISE_WRAP)
uniform vec2 uSpan;          // rozpiętość kadru w kaflach szumu
uniform float uVeil;         // 0..1 — ile tła zasłania pył
uniform vec3 uDark;
uniform vec3 uLit;
uniform float uSunLevel;
uniform vec2 uSunDir;        // kierunek do słońca w kadrze (xy ekranu, y w górę)
uniform vec3 uGlow;          // barwa światła słońca przesianego przez pył
varying vec2 vUv;
void main() {
  vec2 q = uBase + (vUv - 0.5) * uSpan;
  vec2 w = texture(uNoise, q * 0.6 + vec2(0.21, 0.63)).ba * 2.0 - 1.0;
  float n = texture(uNoise, q + w * 0.25).r;
  float f = texture(uNoise, q * 2.7 + w * 0.1 + 0.4).g;
  float cloud = smoothstep(0.35, 0.75, n * 0.8 + f * 0.25);
  // Ciemne kłęby z lekką poświatą tam, gdzie słońce jeszcze dochodzi;
  // w rdzeniu pola (uSunLevel → 0) czysta czerń, bez gwiazd.
  vec3 col = mix(uDark, uLit, cloud * 0.8) * uSunLevel;
  // Słońce za polem: miękka łuna po stronie słońca, gaśnie w głąb pola.
  float side = clamp(dot(vUv - 0.5, uSunDir) * 1.4 + 0.5, 0.0, 1.0);
  col += uGlow * (side * side * (3.0 - 2.0 * side)) * uSunLevel * (0.6 + 0.4 * cloud);
  float a = uVeil * mix(mix(0.9, 0.99, cloud), 1.0, 1.0 - uSunLevel);
  gl_FragColor = vec4(col * a, a);
}
`;

// ---------------------------------------------------------------------------

export class BeltDust3D {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.WebGLRenderer} o.renderer do pieczenia szumu
   * @param {import('../game/asteroidBeltField.js').AsteroidBeltField} o.field
   * @param {number} [o.renderLayer] 1 = tło
   * @param {number} [o.renderOrder] pierwszy płat (głębszy = mniejszy)
   */
  constructor(o) {
    this.scene = o.scene;
    this.field = o.field;
    this.look = { ...DUST_LOOK_DEFAULTS };
    this.enabled = true;
    this.noiseTarget = bakeDustNoise2D(o.renderer, 512);
    this.group = new THREE.Group();
    this.group.name = 'beltDust';
    this.slices = [];
    this._macroCache = new Map();
    const renderLayer = o.renderLayer ?? 1;
    const baseOrder = o.renderOrder ?? 10;
    DUST_SLICES.forEach((def, i) => {
      const geo = new THREE.PlaneGeometry(1, 1, GRID, GRID);
      geo.setAttribute('aMacro', new THREE.BufferAttribute(new Float32Array((GRID + 1) * (GRID + 1) * 3), 3));
      geo.getAttribute('aMacro').setUsage(THREE.DynamicDrawUsage);
      geo.getAttribute('position').setUsage(THREE.DynamicDrawUsage);
      const uniforms = attachFieldLightUniforms({
        uFieldMap: { value: null },
        uFieldMapOn: { value: 0 },
        uFieldMapOffset: { value: new THREE.Vector2() },
        uFieldMapInvSize: { value: new THREE.Vector2(1, 1) },
        // Reflektory (z ≈ +140) sięgają pyłem tylko płytkich płatów — w głębszych
        // pętla po światłach to czysty koszt na pełnym ekranie.
        // Płytkie płaty: reflektory i lampy statków; głębokie: błyski burzy
        // w chmurach (rozpraszanie w wierzchołkach — tanie także tam).
        uLightScatter: { value: def.depth <= 3000 ? 0.9 : 0.55 },
        uStormColor: { value: new THREE.Vector3(0.3, 0.2, 1.0) },
        uStormGlow: { value: 0.12 },
        uStormTime: { value: 0 },
        uNoise: { value: this.noiseTarget.texture },
        uBase: { value: new THREE.Vector2() },
        uScale: { value: def.scale },
        uDrift: { value: new THREE.Vector2() },
        uSunDir: { value: new THREE.Vector2(1, 0) },
        uRockLit: { value: new THREE.Vector3() },
        uRockShade: { value: new THREE.Vector3() },
        uIceLit: { value: new THREE.Vector3() },
        uIceShade: { value: new THREE.Vector3() },
        uAlpha: { value: def.alpha },
        uDensity: { value: 1 },
        uBright: { value: 1 },
        uShadowK: { value: 2.6 },
        uSeed: { value: i * 1.618 + 0.3 }
      });
      const material = new THREE.ShaderMaterial({
        vertexShader: SLICE_VERTEX,
        fragmentShader: SLICE_FRAGMENT,
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        premultipliedAlpha: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      // Najgłębszy płat najpierw (kolejka przezroczysta sortuje po renderOrder).
      mesh.renderOrder = baseOrder + (DUST_SLICES.length - 1 - i);
      mesh.layers.set(renderLayer);
      mesh.name = `beltDust_${i}`;
      this.group.add(mesh);
      this.slices.push({ def, mesh, geo, uniforms, step: 0, gx: NaN, gy: NaN });
    });
    this._buildSpecks(renderLayer, baseOrder + DUST_SLICES.length + 2);
    this._buildVeil(renderLayer);
    this.applyLook();
    this.scene.add(this.group);
    this.immersion = 0;
    this.veilEnabled = true;
    // Poświata naładowanego pyłu w komórkach burz (0 = bez).
    this.stormGlow = 0.12;
  }

  _buildVeil(renderLayer) {
    this.veilUniforms = {
      uNoise: { value: this.noiseTarget.texture },
      uBase: { value: new THREE.Vector2() },
      uSpan: { value: new THREE.Vector2(2, 1.2) },
      uVeil: { value: 0 },
      uDark: { value: new THREE.Vector3(0.0045, 0.005, 0.0065) },
      uLit: { value: new THREE.Vector3(0.028, 0.026, 0.024) },
      uSunLevel: { value: 1 },
      uSunDir: { value: new THREE.Vector2(1, 0) },
      uGlow: { value: new THREE.Vector3(0.05, 0.043, 0.034) }
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VEIL_VERTEX,
      fragmentShader: VEIL_FRAGMENT,
      uniforms: this.veilUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor
    });
    this.veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.veil.frustumCulled = false;
    // Po mgławicy (−999) i gwiazdach (−1), przed skałami tła (2) i płatami mgły.
    this.veil.renderOrder = -0.5;
    this.veil.layers.set(renderLayer);
    this.veil.name = 'beltDustVeil';
    this.group.add(this.veil);
  }

  _buildSpecks(renderLayer, renderOrder) {
    const count = 2600;
    const box = 9000;
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    let s = 0x5EC7;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * box;
      pos[i * 3 + 1] = (rnd() - 0.5) * box;
      pos[i * 3 + 2] = -(60 + Math.pow(rnd(), 1.6) * 1500);
      size[i] = 2.5 + Math.pow(rnd(), 3) * 9;
      phase[i] = rnd();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.speckUniforms = attachFieldLightUniforms({
      uWrap: { value: new THREE.Vector2() },
      uBox: { value: box },
      uPxScale: { value: 1 },
      uCamZ: { value: 1 },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Vector3(0.9, 0.86, 0.78) },
      uSunLevel: { value: 1 },
      uLightGain: { value: 0.9 },
      uAmount: { value: 0 },
      uTime: { value: 0 }
    });
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPECK_VERTEX,
      fragmentShader: SPECK_FRAGMENT,
      uniforms: this.speckUniforms,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor
    });
    this.specks = new THREE.Points(geo, mat);
    this.specks.frustumCulled = false;
    this.specks.renderOrder = renderOrder;
    this.specks.layers.set(renderLayer);
    this.specks.name = 'beltDustSpecks';
    this.speckBox = box;
    this.group.add(this.specks);
  }

  applyLook() {
    const L = this.look;
    for (const s of this.slices) {
      const u = s.uniforms;
      u.uRockLit.value.set(...L.rockLit);
      u.uRockShade.value.set(...L.rockShade);
      u.uIceLit.value.set(...L.iceLit);
      u.uIceShade.value.set(...L.iceShade);
      u.uDensity.value = L.density;
      u.uBright.value = L.brightness;
      u.uShadowK.value = L.shadow;
    }
  }

  setVisible(v) {
    this.enabled = !!v;
    this.group.visible = this.enabled;
  }

  _macro(wx, wy, step) {
    // Cache po punktach siatki świata (przesunięcie kadru o krok liczy tylko brzeg).
    const key = `${step}|${Math.round(wx / step)}|${Math.round(wy / step)}`;
    let v = this._macroCache.get(key);
    if (v === undefined) {
      const m = this.field.sampleMacro(wx, wy);
      // Gęstość mgły: rzadka zawiesina w całym pasie + gęste pola.
      const fog = m.weight * (0.22 + 0.78 * Math.min(1, m.cluster * 1.15));
      // Burza w węźle siatki (tylko w gęstych polach — poza nimi zero bez szumu).
      v = [fog, m.ice, stormIntensity(this.field.seed, wx, wy, m.cluster)];
      if (this._macroCache.size > 20000) this._macroCache.clear();
      this._macroCache.set(key, v);
    }
    return v;
  }

  /**
   * @param {object} f jak RockLayer3D.update: cam, viewW, viewH, focalPx, time, sunX, sunY
   */
  update(f) {
    if (!this.enabled) return;
    const zoom = Math.max(1e-5, f.cam.zoom || 1);
    const camZ = f.focalPx / zoom;
    const sdx = f.sunX - f.cam.x;
    const sdy = -(f.sunY - f.cam.y);
    const sl = Math.hypot(sdx, sdy) || 1;
    let anyVisible = false;
    for (const s of this.slices) {
      const def = s.def;
      const spread = (camZ + def.depth) / camZ;
      const halfW = (f.viewW * 0.5 / zoom) * spread * 1.08;
      const halfH = (f.viewH * 0.5 / zoom) * spread * 1.08;
      const span = Math.max(halfW, halfH) * 2;
      // Krok siatki = potęga 2 (stabilny przy małych zmianach zoomu). Kamera
      // bywa krok od środka płatu, więc (GRID/2 − 1) kroków musi pokryć pół kadru.
      const step = Math.pow(2, Math.ceil(Math.log2(span / (GRID - 2))));
      const gx = Math.floor(f.cam.x / step);
      const gy = Math.floor(f.cam.y / step);
      if (step !== s.step || gx !== s.gx || gy !== s.gy) {
        s.step = step; s.gx = gx; s.gy = gy;
        const pos = s.geo.getAttribute('position');
        const mac = s.geo.getAttribute('aMacro');
        const half = GRID / 2;
        let maxFog = 0;
        for (let j = 0; j <= GRID; j++) {
          for (let i = 0; i <= GRID; i++) {
            const idx = j * (GRID + 1) + i;
            const lx = (i - half) * step;
            const ly = (half - j) * step;       // PlaneGeometry: wiersz 0 na górze (+y)
            pos.setXYZ(idx, lx, ly, 0);
            const wx = (gx + 0.5) * step + lx;
            const wy = (gy + 0.5) * step - ly;  // scena y = −świat y
            const m = this._macro(wx, wy, step);
            mac.setXYZ(idx, m[0], m[1], m[2]);
            if (m[0] > maxFog) maxFog = m[0];
          }
        }
        pos.needsUpdate = true;
        mac.needsUpdate = true;
        s.maxFog = maxFog;
        s.mesh.position.set((gx + 0.5) * step, -(gy + 0.5) * step, -def.depth);
        s.mesh.updateMatrixWorld(true);
        // Początek szumu: środek płatu w kaflach, mod DUST_NOISE_WRAP — w double na CPU.
        s.uniforms.uBase.value.set(
          wrapDustNoise(((gx + 0.5) * step) / def.scale),
          wrapDustNoise((-(gy + 0.5) * step) / def.scale)
        );
      }
      const u = s.uniforms;
      u.uDrift.value.set(f.time * 0.0009 * def.drift, f.time * 0.0004 * def.drift);
      u.uStormTime.value = f.time;
      u.uStormGlow.value = this.stormGlow;
      u.uSunDir.value.set(sdx / sl, sdy / sl);
      // Mapa transmitancji pola: offset środka płatu względem rogu mapy (scena).
      const map = f.fieldMap;
      if (map && map.texture) {
        u.uFieldMap.value = map.texture;
        u.uFieldMapOn.value = 1;
        u.uFieldMapOffset.value.set((gx + 0.5) * step - map.x0, -(gy + 0.5) * step - map.y0);
        u.uFieldMapInvSize.value.set(1 / map.w, 1 / map.h);
      } else {
        u.uFieldMapOn.value = 0;
      }
      s.mesh.visible = s.maxFog > 0.002;
      if (s.mesh.visible) anyVisible = true;
    }
    // Drobiny: pudło wokół kamery, gęstość z makro w środku kadru.
    const su = this.speckUniforms;
    const box = this.speckBox;
    const wx = f.cam.x - Math.floor(f.cam.x / box) * box;
    const wy = -f.cam.y - Math.floor(-f.cam.y / box) * box;
    su.uWrap.value.set(wx, wy);
    su.uPxScale.value = f.focalPx;
    su.uCamZ.value = camZ;
    su.uPixelRatio.value = f.pixelRatio || 1;
    su.uTime.value = f.time;
    const m = this.field.sampleMacro(f.cam.x, f.cam.y);
    const sunT = Number.isFinite(f.sunTAtCamera) ? f.sunTAtCamera : 1;
    const near = Math.min(1, Math.max(0, (zoom - 0.12) / 0.25));
    su.uAmount.value = this.look.specks * near * m.weight * (0.35 + 0.65 * m.cluster);
    su.uSunLevel.value = sunT;
    // Barwy z udziału lodu płynnie (przełącznik na 0,5 dawał skok na granicy pasów).
    const ice = Math.min(1, Math.max(0, m.ice || 0));
    su.uColor.value.set(0.92 - 0.14 * ice, 0.86, 0.78 + 0.22 * ice);
    this.specks.position.set(f.cam.x, -f.cam.y, 0);
    this.specks.updateMatrixWorld(true);
    this.specks.visible = su.uAmount.value > 0.002;

    // Zasłona tła: w gęstym polu pył zasłania galaktykę (zanurzenie wygładzone
    // w czasie, ciemniej w cieniu pola). Szum przesuwa się wolno z kamerą.
    const dt = Math.min(0.25, Math.max(0, Number(f.dt) || 0));
    // W gęstym polu (pole ≳ 0,4) pył kryje galaktykę prawie całkiem.
    const target = this.veilEnabled ? m.weight * smoothstep01(0.06, 0.42, m.cluster) : 0;
    this.immersion += (target - this.immersion) * (dt > 0 ? 1 - Math.exp(-1.4 * dt) : 1);
    const vu = this.veilUniforms;
    vu.uVeil.value = Math.min(1, this.immersion * (0.85 + 0.15 * (1 - sunT)));
    vu.uSunLevel.value = sunT;
    // Kierunek słońca w kadrze (ekran: y w górę = −y świata).
    vu.uSunDir.value.set(sdx / sl, sdy / sl);
    const veilScale = 320000;
    vu.uBase.value.set(wrapDustNoise((f.cam.x * 0.08) / veilScale), wrapDustNoise((-f.cam.y * 0.08) / veilScale));
    const aspect = f.viewW / Math.max(1, f.viewH);
    vu.uSpan.value.set(1.1 * aspect, 1.1);
    // Barwy zasłony neutralne/chłodne — ciepłe dawały beżowo-brązowe tło
    // (dokładnie to, na co była skarga przy starym pyle).
    vu.uDark.value.set(lerp(0.0042, 0.004, ice), lerp(0.0048, 0.0055, ice), lerp(0.0062, 0.0085, ice));
    vu.uLit.value.set(lerp(0.019, 0.017, ice), lerp(0.02, 0.022, ice), lerp(0.023, 0.03, ice));
    vu.uGlow.value.set(lerp(0.03, 0.024, ice), 0.03, lerp(0.031, 0.04, ice));
    this.veil.visible = vu.uVeil.value > 0.003;
    this.group.visible = this.enabled && (anyVisible || this.specks.visible || this.veil.visible);
  }

  dispose() {
    this.scene.remove(this.group);
    for (const s of this.slices) { s.geo.dispose(); s.mesh.material.dispose(); }
    this.specks.geometry.dispose();
    this.specks.material.dispose();
    this.veil.geometry.dispose();
    this.veil.material.dispose();
    this.noiseTarget.dispose();
  }
}
