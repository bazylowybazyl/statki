// src/3d/planet3d.assets.tsl.js
//
// Materiały tła i ciał niebieskich w TSL (port WebGPU, zadanie 05; docs/webgpu/PLAN.md §3).
// Odpowiednik dawnego GLSL z planet3d.assets.js: powierzchnia planety (dzień/noc, mapa
// normalnych Ziemi, mgiełka, analityczny pas cienia ringu, uPlanetBloom), chmury Ziemi,
// poświata planet tła i księżyców (powłoka BackSide), poświata limbu planet przy ringu
// (createRingAtmosphere — model atmosfery z tła menu), słońce (kula z szumem fbm), mgławica
// (NebulaSystem) i gwiazdy z paralaksą warstw (StarSystem). Obraz 1:1 z WebGL — te same wzory
// w tej samej kolejności działań; odstępstwa tylko tam, gdzie WGSL liczyłby inaczej niż
// baza (potęgi całkowite mnożeniem — pow z ujemną podstawą to NaN; podstawa potęgi z varyingu
// obcięta do ≥ 0 — MSAA ekstrapoluje varyingi poza trójkąt).
//
// GRAF NA RODZAJ, WARTOŚCI NA OBIEKT (jak kadłuby 04 i tarcze 14). Planety, księżyce i ich
// poświaty to kilkanaście obiektów o tym samym shaderze — w WebGL wspólny program z cache po
// źródle. Tu graf każdego rodzaju (powierzchnia, chmury, poświata, poświata limbu, słońce)
// powstaje RAZ, a każde ciało dostaje lekki PlanetBodyNodeMaterial z tymi samymi węzłami (jeden
// NodeBuilder na rodzaj). Wartości per ciało zostają w `material.uniforms` (obiekty `{ value }`
// jak w ShaderMaterial — kod aktualizacji w planet3d.assets.js, devTools i tło menu bez zmian),
// węzły czytają je przy rysowaniu obiektu (`uniform().onObjectUpdate`), tekstury przez
// PlanetObjectTextureNode (`texture().onObjectUpdate()` w r183 nie działa — PLAN §3).
// Mgławica i gwiazdy są pojedyncze: węzły `uniform()` / `texture()` za adapterem uniformów
// (src/3d/tsl/uniformy.js).
//
// GWIAZDY. WebGPU rysuje punkty zawsze po 1 px, więc dawne THREE.Points z gl_PointSize to
// kwadraty instancjonowane (InstancedBufferGeometry: kwadrat 4 wierzchołki + dane gwiazd
// w JEDNYM przeplecionym buforze instancji — limit 8 buforów wierzchołków, PLAN §3). Kwadrat
// = kwadrat punktu z GL: środek w pozycji gwiazdy, bok gl_PointSize obcięty do ≥ 1 px (WebGL /
// ANGLE: ALIASED_POINT_SIZE_RANGE 1…1024), gl_PointCoord z rogów (t w dół, jak w GL).
// Rozciąganie w skoku: od zadania 22 smugi warpa „Nurt” (src/3d/warp/stars.js — płaskie wzdłuż
// kursu, front wyjścia; dawne rozciąganie i „bicz” z WebGL usunięte). Zgięcie tła w warpie
// liczy materiał mgławicy (src/3d/warp/skyBend.js). Bez warpa oba materiały liczą to samo co
// przed 22 (gałęzie po jednolitych warunkach z uniformów).
//
// Zasady TSL portu (PLAN §3): funkcje z setLayout CZYSTE (tu tylko hasze i szum słońca);
// próbkowanie tekstur i pochodne poza gałęziami — wybór wyniku przez select(); discard na końcu.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Discard,
  float, vec2, vec3, vec4, uniform, attribute, varying,
  positionLocal, positionGeometry, normalLocal, uv,
  modelWorldMatrix, modelViewMatrix, cameraProjectionMatrix, cameraViewMatrix, cameraPosition,
  transformNormalToView, screenCoordinate, screenSize, viewportSize,
  abs, atan, clamp, cos, sin, dot, exp, floor, fract, length, max, min, mix, mod, normalize, pow,
  select, smoothstep, sqrt, step, distance, dFdx, dFdy, texture, varyingProperty
} from 'three/tsl';
import { uniformNode } from './tsl/uniformy.js';
import { BLOOM_DEFAULTS } from './bloomConfig.js';
import { WARP_STARS } from './warp/stars.js';
import { WARP_SKY_BEND, warpSkyBendOffset } from './warp/skyBend.js';
// ── Maska słońca: JEDNO miejsce dla planet, chmur, poświat, mgławicy i gwiazd ──
// Biblioteka TSL maski (zadanie 03, sunShadowMask.js): odczyt po screenUV, wspólne węzły uniformów
// w grupie renderu. Planety tła (perspektywa, z = −50 000) maski nie czytają (uSunShadowRecv = 0 —
// maska liczona w płaszczyźnie gry trafiałaby w nie obok), ciała przy ringu (pass ortho) — tak;
// mgławica i gwiazdy dostają długą smugę tła.
import { sunShaftBackdrop, sunVisibility } from './sunShadowMask.js';

export const STAR_PLANET_MASK_CAP = 12;

// Liczniki (testy, spis): `materials` — lekkie materiały per ciało, `builds` — budowy
// NodeBuildera (ma ich być tyle co rodzajów × kontekstów renderu, nie tyle co ciał).
export const PLANET_TSL_STATS = {
  materials: { surface: 0, clouds: 0, atmosphere: 0, ringAtmosphere: 0, sun: 0 },
  builds: { surface: 0, clouds: 0, atmosphere: 0, ringAtmosphere: 0, sun: 0 }
};

export const PLANET_MATERIAL_NAMES = Object.freeze({
  surface: 'PlanetSurface',
  clouds: 'PlanetClouds',
  atmosphere: 'PlanetAtmosphere',
  ringAtmosphere: 'RingPlanetAtmosphere',
  sun: 'SunSurface',
  nebula: 'GameNebula',
  stars: 'GameStars'
});

// gl_FragCoord.xy z WebGL: wiersze od DOŁU celu (screenCoordinate w WebGPU liczy y od góry).
const fragCoordGL = () => vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));

// ── Wartości per obiekt ─────────────────────────────────────────────────────────
// Węzeł wspólny dla wszystkich materiałów rodzaju, wartość z material.uniforms[klucz].value
// rysowanego obiektu. Typ: 'float' | 'vec2' | 'vec3'.
function perObject(key, type) {
  const init = type === 'vec3' ? new THREE.Vector3() : (type === 'vec2' ? new THREE.Vector2() : 0);
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

function perObjectUniforms(keys) {
  const U = {};
  for (const [key, type] of Object.entries(keys)) U[key] = perObject(key, type);
  return U;
}

// Tekstura per obiekt (mapy planety, chmury). `texture().onObjectUpdate()` w three r183 NIE działa:
// TextureNode.setup sam ustawia updateType (OBJECT tylko przy macierzy uv), a NodeBuilder zbiera
// węzły do aktualizacji po budowie — każde ciało próbkowałoby teksturę z chwili budowy. Stąd
// updateType na stałe OBJECT i własne update() (wzór HullObjectTextureNode, hexShips3D.tsl.js).
class PlanetObjectTextureNode extends THREE.TextureNode {
  static get type() {
    return 'PlanetObjectTextureNode';
  }

  get updateType() {
    return THREE.NodeUpdateType.OBJECT;
  }

  set updateType(_value) { /* stałe OBJECT — patrz wyżej */ }

  update(frame) {
    // Bez tekstury w materiale (np. mapa nocy planety bez nocy) — zastępcza.
    const value = frame.material?.uniforms?.[this.planetKey]?.value;
    this.value = (value && value.isTexture === true) ? value : this.planetFallback;
  }

  clone() {
    const node = super.clone();
    node.planetKey = this.planetKey;
    node.planetFallback = this.planetFallback;
    return node;
  }
}

function perObjectTexture(key, placeholder, uvNode) {
  const node = new PlanetObjectTextureNode(placeholder, uvNode);
  node.planetKey = key;
  node.planetFallback = placeholder;
  return node;
}

// Tekstury zastępcze. Filtr liniowy: TSL wybiera ścieżkę próbkowania z tekstury obecnej przy
// BUDOWIE (NEAREST = textureLoad). Osobny obiekt na każde wiązanie (TextureNode dzieli wiązanie
// po uuid tekstury). Wartość (0, 0, 0, 1) jak pusty sampler w WebGL.
function placeholderTexture(colorSpace) {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}
const PLACEHOLDER = {
  day: placeholderTexture(THREE.SRGBColorSpace),
  night: placeholderTexture(THREE.SRGBColorSpace),
  specular: placeholderTexture(THREE.NoColorSpace),
  normal: placeholderTexture(THREE.NoColorSpace),
  clouds: placeholderTexture(THREE.SRGBColorSpace)
};

// ── Hasze i szum (funkcje czyste) ──────────────────────────────────────────────
// hash12 (Dave Hoskins) — dither terminatora z gl_FragCoord.
const hash12 = /*@__PURE__*/ Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'planetHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// Słońce: gradient szumu z haszem sin-fract na węzłach całkowitych (jak SUN_FRAGMENT).
const sunHash = /*@__PURE__*/ Fn(([p]) => {
  const q = vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6))
  );
  return float(-1.0).add(float(2.0).mul(fract(sin(q).mul(43758.5453123))));
}).setLayout({ name: 'sunHash', type: 'vec3', inputs: [{ name: 'p', type: 'vec3' }] });

const sunNoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const g = (x, y, z) => dot(sunHash(i.add(vec3(x, y, z))), f.sub(vec3(x, y, z)));
  return mix(
    mix(mix(g(0.0, 0.0, 0.0), g(1.0, 0.0, 0.0), u.x), mix(g(0.0, 1.0, 0.0), g(1.0, 1.0, 0.0), u.x), u.y),
    mix(mix(g(0.0, 0.0, 1.0), g(1.0, 0.0, 1.0), u.x), mix(g(0.0, 1.0, 1.0), g(1.0, 1.0, 1.0), u.x), u.y),
    u.z
  );
}).setLayout({ name: 'sunNoise', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

const sunFbm = /*@__PURE__*/ Fn(([p0]) => {
  const f = float(0.0).toVar();
  const amp = float(0.5).toVar();
  const p = vec3(p0).toVar();
  Loop(4, () => {
    f.addAssign(amp.mul(sunNoise(p)));
    p.mulAssign(2.02);
    amp.mulAssign(0.5);
  });
  return f;
}).setLayout({ name: 'sunFbm', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// ── Wspólne kawałki (wklejane — zależą od uniformów) ────────────────────────────
// Analityczny cień ringu na tarczy (pas od nawietrznej, słonecznej strony): promień do słońca
// w płaszczyźnie gry z punktu tarczy wychodzi z okręgu ringu po drodze rsT — im bliżej, tym
// głębiej. `lit` = oświetlenie punktu (terminator), mnoży zasięg cienia.
function applyRingShadow(color, worldPos, lit, U) {
  If(U.uRingShadowStrength.greaterThan(0.0005).and(U.uRingShadowRadius.greaterThan(1.0)), () => {
    const rsP = worldPos.xy.sub(U.uRingShadowCenter).toVar();
    const rsSun = U.sunPosition.xy.sub(worldPos.xy).toVar();
    const rsLen = length(rsSun).toVar();
    If(rsLen.greaterThan(1.0), () => {
      const rsD = rsSun.div(rsLen).toVar();
      const rsB = dot(rsP, rsD).toVar();
      const rsC = dot(rsP, rsP).sub(U.uRingShadowRadius.mul(U.uRingShadowRadius)).toVar();
      const rsDisc = rsB.mul(rsB).sub(rsC).toVar();
      If(rsC.lessThan(0.0).and(rsDisc.greaterThan(0.0)), () => {
        const rsT = rsB.negate().add(sqrt(rsDisc));
        const rsShade = float(1.0).sub(smoothstep(0.0, max(1.0, U.uRingShadowReach), rsT)).mul(U.uRingShadowStrength).mul(lit);
        color.mulAssign(float(1.0).sub(clamp(rsShade, 0.0, 0.95)));
      });
    });
  });
}

// ── Graf: powierzchnia planety (dawny EARTH_FRAGMENT) ───────────────────────────
const SURFACE_KEYS = {
  uPlanetBloom: 'float', sunPosition: 'vec3', sunsetTint: 'vec3', hasNightTexture: 'float',
  uBrightness: 'float', uAmbient: 'float', uSpecular: 'float', uSunWrap: 'float', uSunIntensity: 'float',
  uHazeStrength: 'float', uHazeColor: 'vec3', uHazeBeta: 'vec3',
  uRingShadowStrength: 'float', uRingShadowRadius: 'float', uRingShadowReach: 'float', uRingShadowCenter: 'vec2',
  uSunShadowRecv: 'float'
};

function buildSurfaceGraph() {
  const U = perObjectUniforms(SURFACE_KEYS);
  // Pozycja z modelViewMatrix (highPrecision: składana w double na CPU, jak w WebGL) — Ziemia
  // i Mars leżą w passie ortho przy 5–10 mln j.; pozycja świata (float32) tylko do światła.
  const vNormal = varying(transformNormalToView(normalLocal), 'vPlanetNormal');
  const vWorldPosition = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlanetWorld');
  const vViewPosition = varying(modelViewMatrix.mul(vec4(positionLocal, 1.0)).xyz.negate(), 'vPlanetView');
  const vUv = uv();
  const dayTex = perObjectTexture('dayTexture', PLACEHOLDER.day, vUv);
  const nightTex = perObjectTexture('nightTexture', PLACEHOLDER.night, vUv);
  const specTex = perObjectTexture('specularTexture', PLACEHOLDER.specular, vUv);
  const normalTex = perObjectTexture('normalTexture', PLACEHOLDER.normal, vUv);

  const fragmentNode = Fn(() => {
    const hasNight = U.hasNightTexture.greaterThan(0.5);
    const viewDir = normalize(vViewPosition).toVar();
    const sunViewPosition = cameraViewMatrix.mul(vec4(U.sunPosition, 1.0)).xyz;
    const lightDir = normalize(sunViewPosition.add(vViewPosition)).toVar();
    const halfVector = normalize(lightDir.add(viewDir)).toVar();

    // Mapa normalnych (tylko Ziemia, hasNightTexture) — pochodne i próbka poza gałęzią, wybór select().
    const rawN = normalTex.xyz.mul(2.0).sub(1.0);
    const mapN = vec3(rawN.xy.mul(0.8), rawN.z).toVar();
    const q0 = dFdx(vViewPosition.negate()).toVar();
    const q1 = dFdy(vViewPosition.negate()).toVar();
    const st0 = dFdx(vUv).toVar();
    const st1 = dFdy(vUv).toVar();
    const S = normalize(q0.mul(st1.y).sub(q1.mul(st0.y)));
    const T = normalize(q0.negate().mul(st1.x).add(q1.mul(st0.x)));
    const N = normalize(vNormal);
    const mappedNormal = normalize(S.mul(mapN.x).add(T.mul(mapN.y)).add(N.mul(mapN.z)));
    const normal = select(hasNight, mappedNormal, normalize(vNormal)).toVar();

    const NdotL = dot(normal, lightDir).toVar();
    const sunL = max(0.0, NdotL).toVar();
    const dayLight = clamp(U.uAmbient.add(sunL.mul(U.uSunIntensity)), 0.0, 1.2).toVar();
    // Próbki w jednolitym przepływie (toVar): select() niżej rozwija się w if/else, a próbka
    // z pochodnymi w gałęzi zależnej od piksela dawałaby nieokreślony poziom mipmapy.
    const dayColor = vec4(dayTex).toVar();
    const nightColor = vec4(nightTex).toVar();
    const specularMask = vec4(specTex).toVar().r;
    const waterMask = smoothstep(0.08, 0.82, specularMask);
    const NdotH = max(0.0, dot(normal, halfVector));
    const shininess = mix(16.0, 42.0, waterMask);
    const specular = select(sunL.greaterThan(0.0), pow(NdotH, shininess).mul(waterMask).mul(U.uSpecular).mul(sunL), float(0.0)).toVar();
    const terminatorCenter = float(-0.02).sub(U.uSunWrap.mul(0.45)).toVar();
    const terminatorSoft = float(0.26).add(abs(U.uSunWrap).mul(0.35)).toVar();
    const mixFactor = smoothstep(terminatorCenter.sub(terminatorSoft), terminatorCenter.add(terminatorSoft), NdotL).toVar();
    const sunVisP = mix(1.0, sunVisibility(), U.uSunShadowRecv).toVar();
    mixFactor.mulAssign(sunVisP);

    // Z mapą nocy (Ziemia): miasta nocą, połysk wody.
    const daySide = dayColor.rgb.mul(U.uBrightness).mul(dayLight).add(vec3(0.55, 0.62, 0.78).mul(specular));
    const nightMask = float(1.0).sub(mixFactor);
    const nightBase = nightColor.rgb;
    const cityBrightness = dot(nightBase, vec3(0.299, 0.587, 0.114));
    const cityGlow = nightBase.mul(cityBrightness.mul(cityBrightness)).mul(5.0);
    const nightSide = nightBase.mul(0.55).add(cityGlow).mul(nightMask);
    const withNight = mix(nightSide, daySide, mixFactor);
    // Bez mapy nocy: miękki zmierzch i zimna nocna poświata.
    const twilight = smoothstep(terminatorCenter.sub(terminatorSoft.add(0.06)), terminatorCenter.add(terminatorSoft), NdotL).mul(sunVisP);
    const minNightLight = max(0.006, U.uAmbient.mul(0.35));
    const lit = mix(minNightLight, dayLight, twilight);
    const nightBand = float(1.0).sub(smoothstep(-0.35, 0.08, NdotL));
    const nightTint = vec3(0.02, 0.03, 0.05).mul(nightBand);
    const withoutNight = dayColor.rgb.mul(U.uBrightness).mul(lit).add(nightTint);
    const finalColor = select(hasNight, withNight, withoutNight).toVar();

    const sunsetBand = smoothstep(-0.30, -0.02, NdotL).mul(float(1.0).sub(smoothstep(-0.02, 0.20, NdotL))).toVar();
    finalColor.assign(mix(finalColor, finalColor.mul(U.sunsetTint), sunsetBand.mul(0.45)));

    If(U.uHazeStrength.greaterThan(0.0005), () => {
      const geoN = normalize(vNormal).toVar();
      const mu = clamp(dot(geoN, viewDir), 0.0, 1.0);
      const airmass = U.uHazeStrength.div(mu.mul(0.95).add(0.05));
      const extinction = exp(airmass.negate().mul(U.uHazeBeta)).toVar();
      const geoNdotL = dot(geoN, lightDir);
      const dayHaze = smoothstep(-0.02, 0.30, geoNdotL).mul(sunVisP);
      const hazeCol = U.uHazeColor.mul(dayHaze).add(U.sunsetTint.mul(0.9).mul(sunsetBand).mul(0.6));
      finalColor.assign(finalColor.mul(extinction).add(hazeCol.mul(float(1.0).sub(extinction))));
    });

    const dither = hash12(fragCoordGL()).sub(0.5).div(1024.0);
    const ditherMask = mixFactor.mul(float(1.0).sub(mixFactor)).mul(4.0);
    finalColor.addAssign(dither.mul(ditherMask));
    finalColor.assign(max(finalColor, vec3(0.0)));

    applyRingShadow(finalColor, vWorldPosition, mixFactor, U);

    const luminance = dot(finalColor, vec3(0.299, 0.587, 0.114));
    const bloomPush = smoothstep(0.85, 1.0, luminance).mul(U.uPlanetBloom);
    finalColor.addAssign(finalColor.mul(bloomPush));
    return vec4(finalColor, 1.0);
  })();

  const textures = { dayTexture: dayTex, nightTexture: nightTex, specularTexture: specTex, normalTexture: normalTex };
  return { fragmentNode, uniforms: U, textures, state: {} };
}

// ── Graf: chmury Ziemi (dawny CLOUD_FRAGMENT) ──────────────────────────────────
const CLOUD_KEYS = {
  sunPosition: 'vec3', uOpacity: 'float', uHazeStrength: 'float', uHazeColor: 'vec3', uHazeBeta: 'vec3',
  uRingShadowStrength: 'float', uRingShadowRadius: 'float', uRingShadowReach: 'float', uRingShadowCenter: 'vec2',
  uSunShadowRecv: 'float'
};

function buildCloudGraph() {
  const U = perObjectUniforms(CLOUD_KEYS);
  const worldPos = modelWorldMatrix.mul(vec4(positionLocal, 1.0));
  const vNormal = varying(normalize(modelWorldMatrix.mul(vec4(normalLocal, 0.0)).xyz), 'vCloudNormal');
  const vWorldPosition = varying(worldPos.xyz, 'vCloudWorld');
  const cloudTex = perObjectTexture('cloudTexture', PLACEHOLDER.clouds, uv());

  const fragmentNode = Fn(() => {
    const texel = vec4(cloudTex).toVar();
    const mask = dot(texel.rgb, vec3(0.299, 0.587, 0.114)).toVar();
    const normal = normalize(vNormal).toVar();
    const lightDir = normalize(U.sunPosition.sub(vWorldPosition)).toVar();
    const lit = smoothstep(-0.02, 0.22, dot(normal, lightDir)).mul(mix(1.0, sunVisibility(), U.uSunShadowRecv)).toVar();
    const alpha = mask.mul(U.uOpacity).mul(pow(lit, 1.35)).toVar();
    const color = vec3(1.0).mul(float(0.08).add(lit.mul(0.92))).toVar();
    If(U.uHazeStrength.greaterThan(0.0005), () => {
      const viewDirW = normalize(cameraPosition.sub(vWorldPosition));
      const mu = clamp(dot(normal, viewDirW), 0.0, 1.0);
      const airmass = U.uHazeStrength.div(mu.mul(0.95).add(0.05));
      const extinction = exp(airmass.negate().mul(U.uHazeBeta)).toVar();
      const hazeDay = smoothstep(-0.02, 0.30, dot(normal, lightDir));
      color.assign(color.mul(extinction).add(U.uHazeColor.mul(hazeDay).mul(float(1.0).sub(extinction))));
    });
    applyRingShadow(color, vWorldPosition, lit, U);
    Discard(mask.lessThan(0.03).or(alpha.lessThan(0.01)));
    return vec4(color, alpha);
  })();

  return {
    fragmentNode,
    uniforms: U,
    textures: { cloudTexture: cloudTex },
    state: { transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending }
  };
}

// ── Graf: poświata planet tła i księżyców (dawny ATMOSPHERE_*) ─────────────────
const ATMOSPHERE_KEYS = {
  coef: 'float', power: 'float', glowColor: 'vec3', sunsetTint: 'vec3', uSunIntensity: 'float',
  sunPosition: 'vec3', uSunShadowRecv: 'float'
};

function buildAtmosphereGraph() {
  const U = perObjectUniforms(ATMOSPHERE_KEYS);
  const normalW = normalize(modelWorldMatrix.mul(vec4(normalLocal, 0.0)).xyz);
  const worldPos = modelWorldMatrix.mul(vec4(positionLocal, 1.0));
  const vNormalWorld = varying(normalW, 'vAtmNormal');
  const vWorldPosition = varying(worldPos.xyz, 'vAtmWorld');
  const viewDirV = normalize(cameraPosition.sub(worldPos.xyz));
  const facing = dot(normalW, viewDirV);
  const vRimMask = varying(clamp(facing.negate().sub(0.05), 0.0, 1.0), 'vAtmRim');

  const fragmentNode = Fn(() => {
    const nW = normalize(vNormalWorld).toVar();
    // Podstawa ≥ 0: varying z MSAA bywa ekstrapolowany poza trójkąt (pow → NaN).
    const radialFade = smoothstep(0.0, 1.0, pow(max(vRimMask, 0.0), max(0.35, U.power.mul(0.18))));
    const rim = radialFade.mul(clamp(U.coef, 0.0, 2.0));
    const lightDir = normalize(U.sunPosition.sub(vWorldPosition));
    const sunDot = dot(nW, lightDir).toVar();
    const dayFactor = smoothstep(-0.45, 0.25, sunDot);
    const sunsetFactor = smoothstep(-0.35, -0.05, sunDot).mul(float(1.0).sub(smoothstep(-0.05, 0.25, sunDot))).toVar();
    const baseColor = mix(U.glowColor, U.sunsetTint.mul(1.5), sunsetFactor.mul(0.8));
    const intensity = clamp(rim.mul(dayFactor.add(sunsetFactor.mul(0.3))), 0.0, 1.0);
    const alpha = intensity.mul(clamp(U.uSunIntensity, 0.2, 1.0)).mul(mix(1.0, sunVisibility(), U.uSunShadowRecv)).toVar();
    Discard(alpha.lessThanEqual(0.001));
    return vec4(baseColor, alpha);
  })();

  return {
    fragmentNode,
    uniforms: U,
    state: { transparent: true, side: THREE.BackSide, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending }
  };
}

// ── Graf: poświata limbu planet przy ringu (dawny RING_ATMOSPHERE_*) ───────────
// Płaski dysk w środku planety (pass ortho, promienie kamery równoległe): o poświacie decyduje
// odległość od środka tarczy ρ (w promieniach planety). Cięciwa przez powłokę R + H, gęstość
// e^(−h/Hs) — gaśnie do zera na brzegu powłoki (bez twardej krawędzi).
const RING_ATMOSPHERE_KEYS = {
  uSunDir: 'vec3', uRa: 'float', uHs: 'float', uDayColor: 'vec3', uSunsetColor: 'vec3', uGain: 'vec3',
  uSunShadowRecv: 'float'
};

function buildRingAtmosphereGraph() {
  const U = perObjectUniforms(RING_ATMOSPHERE_KEYS);
  const vOff = varying(positionLocal.xy, 'vRingAtmOff');

  const fragmentNode = Fn(() => {
    const rho = length(vOff).toVar();
    // promień pionowy nad punktem limbu: cięciwa przez powłokę i najniższa wysokość
    const h = max(rho.sub(1.0), 0.0);
    const chord = float(2.0).mul(sqrt(max(U.uRa.mul(U.uRa).sub(rho.mul(rho)), 0.0)));
    const tau = chord.mul(exp(h.negate().div(U.uHs))).div(U.uRa.sub(1.0)).mul(0.9);
    const n = vec3(vOff.div(max(rho, 1e-4)), 0.0);
    const nl = dot(n, U.uSunDir).toVar();
    const dayF = smoothstep(-0.22, 0.25, nl);
    const sunsetF = smoothstep(-0.28, -0.02, nl).mul(float(1.0).sub(smoothstep(-0.02, 0.22, nl))).toVar();
    const col = mix(U.uDayColor, U.uSunsetColor, sunsetF).mul(dayF.add(sunsetF.mul(0.6)));
    const glow = col.mul(U.uGain).mul(float(1.0).sub(exp(tau.negate().mul(vec3(0.35, 0.62, 1.0))))).toVar();
    // cień ringu z maski słońca tylko do połowy: słońce gry leży w płaszczyźnie ringu, więc
    // pełna maska gasiłaby cały limb od strony słońca
    glow.mulAssign(mix(1.0, sunVisibility(), U.uSunShadowRecv.mul(0.5)));
    const alpha = max(glow.r, max(glow.g, glow.b)).toVar();
    Discard(rho.greaterThanEqual(U.uRa).or(alpha.lessThanEqual(0.001)));
    return vec4(glow, alpha);
  })();

  // Blend ONE/ONE (kolor i alfa) jak dawne premultipliedAlpha + AdditiveBlending w WebGL; alfa
  // = max(rgb) (kanwa premultiplied). premultipliedAlpha = false: NodeMaterial z tą flagą mnożyłby
  // kolor przez alfę w shaderze, a ShaderMaterial tego nie robił.
  return {
    fragmentNode,
    uniforms: U,
    state: {
      transparent: true, depthWrite: false, depthTest: true, premultipliedAlpha: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor
    }
  };
}

// ── Graf: słońce (dawny SUN_FRAGMENT) ──────────────────────────────────────────
const SUN_KEYS = { uTime: 'float', uIsOcclusion: 'float' };
/** Wzmocnienie nadmiaru ponad próg bloomu na kuli słońca (zadanie 25b: bloom bez ×3 — korona wraca). */
export const SUN_BLOOM_NADMIAR = 3.0;

function buildSunGraph() {
  const U = perObjectUniforms(SUN_KEYS);
  const vLocalPos = varying(positionLocal, 'vSunLocal');
  const vNormal = varying(transformNormalToView(normalLocal), 'vSunNormal');

  const fragmentNode = Fn(() => {
    const p = normalize(vLocalPos).mul(4.0).toVar();
    const t = U.uTime.mul(0.15).toVar();
    const q = vec3(
      sunFbm(p.add(vec3(t))),
      sunFbm(p.add(vec3(t.negate(), t, 0.0))),
      sunFbm(p.add(vec3(0.0, t.negate(), t)))
    ).toVar();
    const n = clamp(sunFbm(p.add(q.mul(2.0)).add(t)).add(0.5).mul(1.2), 0.0, 1.0).toVar();
    const colorDark = vec3(0.4, 0.05, 0.0);
    const colorMid = vec3(1.5, 0.5, 0.1);
    const colorHot = vec3(4.0, 2.5, 0.5);
    const finalColor = mix(colorDark, colorMid, smoothstep(0.0, 0.6, n)).toVar();
    finalColor.assign(mix(finalColor, colorHot, smoothstep(0.5, 1.0, n)));
    const viewDot = dot(normalize(vNormal), vec3(0.0, 0.0, 1.0));
    // pow(1 − max(viewDot, 0), 3) mnożeniem (baza WebGL: FXC rozwija potęgę całkowitą)
    const fb = float(1.0).sub(max(viewDot, 0.0)).toVar();
    const fresnel = fb.mul(fb).mul(fb);
    finalColor.addAssign(vec3(1.5, 0.75, 0.25).mul(fresnel));
    // Korona = sama poświata bloomu kuli HDR. Zadanie 25b: bloom gry jak w demach (bez ×3 dawnego passu WebGL)
    // zostawiał ~1/3 korony (znikała) — nadmiar luminancji ponad próg bloomu × SUN_BLOOM_NADMIAR (L' = p + 3·(L − p)),
    // pod progiem bez zmian: poświata teksela 3L − 2p zamiast dawnych 3L (L = 2,7 → 78%); scena `slonce`: energia
    // kadru wokół słońca 0,50 → 0,70 dawnej, tarcza jak dotąd.
    const lum = dot(finalColor, vec3(0.2126, 0.7152, 0.0722)).toVar();
    const nadmiar = max(lum.sub(BLOOM_DEFAULTS.threshold), 0.0);
    finalColor.mulAssign(lum.add(nadmiar.mul(SUN_BLOOM_NADMIAR - 1)).div(max(lum, 1e-4)));
    // Dawna maska okluzji god rays (uIsOcclusion = 1: czysta biel) — nikt jej dziś nie włącza.
    return select(U.uIsOcclusion.equal(1.0), vec4(1.0), vec4(finalColor, 1.0));
  })();

  return { fragmentNode, uniforms: U, state: {} };
}

const BUILDERS = {
  surface: buildSurfaceGraph,
  clouds: buildCloudGraph,
  atmosphere: buildAtmosphereGraph,
  ringAtmosphere: buildRingAtmosphereGraph,
  sun: buildSunGraph
};
const GRAPHS = {};

/** Graf rodzaju ('surface' | 'clouds' | 'atmosphere' | 'ringAtmosphere' | 'sun') — budowany raz. */
export function getPlanetGraph(kind) {
  if (!BUILDERS[kind]) throw new Error(`planet3d.assets.tsl: nieznany rodzaj „${kind}”`);
  if (!GRAPHS[kind]) GRAPHS[kind] = BUILDERS[kind]();
  return GRAPHS[kind];
}

/** Klucze `material.uniforms` czytane przez graf rodzaju (testy, kontrakt z planet3d.assets.js). */
export const PLANET_GRAPH_KEYS = Object.freeze({
  surface: Object.freeze([...Object.keys(SURFACE_KEYS), 'dayTexture', 'nightTexture', 'specularTexture', 'normalTexture']),
  clouds: Object.freeze([...Object.keys(CLOUD_KEYS), 'cloudTexture']),
  atmosphere: Object.freeze(Object.keys(ATMOSPHERE_KEYS)),
  ringAtmosphere: Object.freeze(Object.keys(RING_ATMOSPHERE_KEYS)),
  sun: Object.freeze(Object.keys(SUN_KEYS))
});

/**
 * Lekki materiał ciała: węzły wspólne dla rodzaju, wartości w `uniforms` (obiekty `{ value }`
 * — jak w ShaderMaterial). Stan renderu jak dawny ShaderMaterial rodzaju.
 */
export class PlanetBodyNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'PlanetBodyNodeMaterial';
  }

  constructor(kind, uniforms) {
    super();
    const graph = getPlanetGraph(kind);
    this.isPlanetBodyNodeMaterial = true;
    this.planetKind = kind;
    this.name = PLANET_MATERIAL_NAMES[kind];
    this.uniforms = uniforms;
    this.lights = false;
    this.fog = false;
    // ShaderMaterial ma forceSinglePass = true — przezroczysty DoubleSide (chmury) w jednym
    // rysunku, jak w WebGL (NodeMaterial rysowałby tył i przód osobno).
    this.forceSinglePass = true;
    this.fragmentNode = graph.fragmentNode;
    Object.assign(this, graph.state);
    PLANET_TSL_STATS.materials[kind]++;
  }

  setup(builder) {
    // Wywoływane tylko przy budowie NodeBuildera (raz na klucz programu).
    PLANET_TSL_STATS.builds[this.planetKind]++;
    return super.setup(builder);
  }
}

export const createPlanetSurfaceMaterial = (uniforms) => new PlanetBodyNodeMaterial('surface', uniforms);
export const createPlanetCloudMaterial = (uniforms) => new PlanetBodyNodeMaterial('clouds', uniforms);
export const createPlanetAtmosphereMaterial = (uniforms) => new PlanetBodyNodeMaterial('atmosphere', uniforms);
export const createRingAtmosphereMaterial = (uniforms) => new PlanetBodyNodeMaterial('ringAtmosphere', uniforms);
export const createSunMaterial = (uniforms) => new PlanetBodyNodeMaterial('sun', uniforms);

// ── Mgławica (NebulaSystem, warstwa 1) ────────────────────────────────────────
/**
 * Materiał mgławicy na węzłach adaptera: `u.map` = texture(tex, uv()) (`.value` = tekstura —
 * tło menu ją pożycza), `u.warpFactor` = uniform (rozjaśnienie w skoku). Nieprzezroczysty,
 * bez testu i zapisu głębi (jak dawny ShaderMaterial).
 */
export function createNebulaMaterial(u) {
  const material = new THREE.NodeMaterial();
  material.name = PLANET_MATERIAL_NAMES.nebula;
  material.uniforms = u;
  material.lights = false;
  material.fog = false;
  material.depthWrite = false;
  material.depthTest = false;
  // Zgięcie tła warpa „Nurt” (skyBend.js): próbka mgławicy z piksela przesuniętego o `off`
  // [px celu] — mgławica to płaszczyzna, więc uv(p + off) = uv + J·off (pochodne uv w pikselu).
  // Tekstura z chwili budowy (NebulaSystem jej nie podmienia; tło menu tylko ją pożycza).
  const nebulaTex = u.map.value;
  material.fragmentNode = Fn(() => {
    const uvS = uv().toVar();
    const head = WARP_SKY_BEND.element(0);
    If(head.x.add(head.y).greaterThan(0.5), () => {
      const off = warpSkyBendOffset(screenCoordinate.xy);
      const base = uv();
      uvS.addAssign(dFdx(base).mul(off.x).add(dFdy(base).mul(off.y)));
    });
    const color = texture(nebulaTex, uvS).rgb;
    const boost = float(1.0).add(u.warpFactor.mul(0.8));
    // Tło dostaje długą smugę cienia z maski Core3D (sunShaftBackdrop).
    return vec4(sunShaftBackdrop(color.mul(boost)), 1.0);
  })();
  return material;
}

// ── Gwiazdy (StarSystem, warstwa 1) ───────────────────────────────────────────
// Dane gwiazdy w przeplecionym buforze instancji: pozycja (xyz), rozmiar, jasność, barwa (rgb),
// paralaksa, mnożniki warstwy (rozmiar, jasność, rozciąganie w skoku).
export const STAR_INSTANCE_STRIDE = 12;
export const STAR_INSTANCE_LAYOUT = Object.freeze({
  starPos: Object.freeze([0, 3]),
  size: Object.freeze([3, 1]),
  brightness: Object.freeze([4, 1]),
  color: Object.freeze([5, 3]),
  parallaxFactor: Object.freeze([8, 1]),
  layerSizeMul: Object.freeze([9, 1]),
  layerBrightnessMul: Object.freeze([10, 1]),
  layerStretchMul: Object.freeze([11, 1])
});

/** Przeplata osobne tablice atrybutów gwiazd (klucze STAR_INSTANCE_LAYOUT) w jeden bufor. */
export function packStarInstances(arrays, count) {
  const data = new Float32Array(count * STAR_INSTANCE_STRIDE);
  for (const [name, [offset, size]] of Object.entries(STAR_INSTANCE_LAYOUT)) {
    const src = arrays[name];
    if (!src || src.length < count * size) throw new Error(`packStarInstances: brak danych „${name}”`);
    for (let i = 0; i < count; i++) {
      const o = i * STAR_INSTANCE_STRIDE + offset;
      for (let k = 0; k < size; k++) data[o + k] = src[i * size + k];
    }
  }
  return data;
}

/**
 * Geometria gwiazd: kwadrat (4 wierzchołki ±0,5, 2 trójkąty CCW) × `count` instancji; dane gwiazd
 * (osobne tablice jak dawne atrybuty THREE.Points — klucze STAR_INSTANCE_LAYOUT) przeplecione
 * w JEDEN bufor instancji: razem dwa bufory wierzchołków (limit 8, PLAN §3).
 */
export function createStarGeometry(arrays, count) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0
  ]), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const buffer = new THREE.InstancedInterleavedBuffer(packStarInstances(arrays, count), STAR_INSTANCE_STRIDE, 1);
  for (const [name, [offset, size]] of Object.entries(STAR_INSTANCE_LAYOUT)) {
    geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  }
  geometry.instanceCount = count;
  return geometry;
}

/**
 * Materiał gwiazd (dawne STARS_VERTEX / STARS_FRAGMENT) na węzłach adaptera `u` (pointTexture,
 * time, cameraOffset, containerSize, perspectiveScale, globalBrightness, zoomComp, viewportSize,
 * baseSizeMul, planetMasks[STAR_PLANET_MASK_CAP]). Kwadrat punktu z GL: środek w pozycji gwiazdy,
 * bok gl_PointSize ≥ 1 px, gl_PointCoord z rogów.
 * Warp (zadanie 22, src/3d/warp/stars.js — WARP_STARS): przy `stretch` > 0 gwiazda to płaska smuga
 * wzdłuż kursu (głowa w miejscu gwiazdy, ogon do tyłu, długość stretch · stretchPx · mnożnik warstwy),
 * front wyjścia prostuje smugi od dziobu (dema/warp-webgpu/stars.js). Dawne rozciąganie z WebGL
 * (warpFactor, moveDir, bicz przy wyjściu — uniformy zostają w adapterze, shader ich nie czyta)
 * usunięte. Bez warpa gałąź punktów liczy to samo co przed 22.
 */
export function createStarMaterial(u) {
  const planetMasks = uniformNode(u.planetMasks);
  const aPos = attribute('starPos', 'vec3');
  const aSize = attribute('size', 'float');
  const aBrightness = attribute('brightness', 'float');
  const aColor = attribute('color', 'vec3');
  const aParallax = attribute('parallaxFactor', 'float');
  const aLayerSize = attribute('layerSizeMul', 'float');
  const aLayerBrightness = attribute('layerBrightnessMul', 'float');
  const aLayerStretch = attribute('layerStretchMul', 'float');

  // Wzór gwiazd przesunięty z paralaksą warstwy i zawinięty w kwadrat containerSize.
  // Oddalenie kamery nie zagęszcza gwiazd: wzór rozszerza się razem z kadrem
  // (starZoomCompensation w starParallax.js).
  const halfSize = u.containerSize.div(2.0);
  const layeredOffset = u.cameraOffset.mul(aParallax);
  const posX = mod(aPos.x.sub(layeredOffset.x).add(halfSize), u.containerSize).sub(halfSize);
  const posY = mod(aPos.y.sub(layeredOffset.y).add(halfSize), u.containerSize).sub(halfSize);
  const pos = vec3(vec2(posX, posY).mul(u.zoomComp), aPos.z);

  // Maska planet: gwiazda za tarczą planety znika (odległość w świecie, xy).
  const planetMask = Fn(() => {
    const worldPos = modelWorldMatrix.mul(vec4(pos, 1.0)).toVar();
    const m = float(1.0).toVar();
    Loop(STAR_PLANET_MASK_CAP, ({ i }) => {
      const pm = planetMasks.element(i);
      If(pm.z.greaterThan(0.0), () => {
        m.mulAssign(step(pm.z, distance(worldPos.xy, pm.xy)));
      });
    });
    return m;
  })();

  const finalSize = aSize.mul(u.baseSizeMul).mul(aLayerSize);
  const distFactor = u.perspectiveScale.div(1000.0);
  const pointSize = finalSize.mul(distFactor);

  // Warp „Nurt” (WARP_STARS, grupa renderu): jednolity warunek — bez warpa dawne punkty.
  const W = WARP_STARS;
  const warpOn = W.stretch.greaterThan(0.001);
  const vAlong = varyingProperty('float', 'vStarAlong');
  const vSide = varyingProperty('float', 'vStarSide');
  const vLen = varyingProperty('float', 'vStarLen');
  const vWidth = varyingProperty('float', 'vStarWidth');
  const vSt = varyingProperty('float', 'vStarSt');

  const vertexNode = Fn(() => {
    const mvPosition = modelViewMatrix.mul(vec4(pos, 1.0));
    const clipPosition = cameraProjectionMatrix.mul(mvPosition).toVar();
    const out = vec4(0.0).toVar();
    If(warpOn, () => {
      // Smuga PŁASKA w pikselach celu (y w górę): głowa w gwieździe, ogon wstecz kursu;
      // front wyjścia — gwiazdy przed nim (wzdłuż kursu od statku) wracają do punktów.
      const half = viewportSize.mul(0.5).toVar();
      const s0 = clipPosition.xy.div(clipPosition.w).mul(half).toVar();
      const sAlong = dot(s0.sub(W.shipPx), W.heading);
      const real = W.frontOn.mul(smoothstep(W.frontPx.sub(60.0), W.frontPx.add(60.0), sAlong));
      const st = W.stretch.mul(float(1.0).sub(real)).toVar();
      // Szerokość jak w demie (rozmiar × 0,62, ≥ 0,55 px; smuga grubieje z rozciągnięciem ×(1 + st/4));
      // bok punktu gry to ~1,6 × rozmiar dema — stąd 0,38.
      const w = max(pointSize.mul(0.38).mul(st.mul(0.25).add(1.0)), 0.55).toVar();
      const L = st.mul(W.stretchPx).mul(aLayerStretch).toVar();
      const dir = W.heading.negate();
      const perp = vec2(dir.y.negate(), dir.x);
      const g = positionGeometry.xy;
      const alongPx = g.x.add(0.5).mul(L.add(w.mul(2.0))).sub(w);
      const side = g.y.mul(2.0).mul(w);
      const pix = s0.add(dir.mul(alongPx)).add(perp.mul(side));
      vAlong.assign(alongPx);
      vSide.assign(side);
      vLen.assign(L);
      vWidth.assign(w);
      vSt.assign(st);
      out.assign(vec4(pix.div(half).mul(clipPosition.w), clipPosition.zw));
    }).Else(() => {
      // Kwadrat punktu: bok gl_PointSize obcięty do ≥ 1 px jak w WebGL (ALIASED_POINT_SIZE_RANGE).
      const quadSize = max(pointSize, 1.0);
      const offset = positionGeometry.xy.mul(quadSize).mul(2.0).div(viewportSize).mul(clipPosition.w);
      out.assign(vec4(clipPosition.xy.add(offset), clipPosition.zw));
    });
    return out;
  })();

  const flat = (node, name) => varying(node, name).setInterpolation('flat', 'either');
  const vBrightness = flat(aBrightness.mul(aLayerBrightness), 'vStarBrightness');
  const vColor = flat(aColor, 'vStarColor');
  const vPlanetMask = flat(planetMask, 'vStarPlanetMask');
  // gl_PointCoord: (0, 0) w lewym GÓRNYM rogu punktu (GL), t rośnie w dół.
  const vPointCoord = varying(vec2(positionGeometry.x.add(0.5), float(0.5).sub(positionGeometry.y)), 'vStarPointCoord');

  const fragmentNode = Fn(() => {
    const out = vec4(0.0).toVar();
    const twinkle = float(0.82).add(float(0.18).mul(sin(u.time.mul(3.0).add(vBrightness.mul(10.0))))).toVar();
    If(warpOn, () => {
      // Profil smugi dema (dema/warp-webgpu/stars.js): gauss w poprzek, ogon gaśnie; energia
      // rozłożona na długość, barwa bieleje w skoku.
      const da = max(max(vAlong.negate(), vAlong.sub(vLen)), 0.0);
      const d2 = da.mul(da).add(vSide.mul(vSide)).div(max(vWidth.mul(vWidth), 1e-4));
      const prof = exp(d2.mul(-2.6));
      const taper = mix(float(1.0), float(0.08), clamp(vAlong.div(max(vLen, 1.0)), 0.0, 1.0));
      const tint = mix(vColor, vec3(0.72, 0.86, 1.0), clamp(vSt.mul(W.warpTint).mul(0.75), 0.0, 1.0));
      const energy = float(1.0).add(vSt.mul(0.9)).div(sqrt(float(1.0).add(vLen.div(max(vWidth.mul(3.0), 1.0)).mul(0.35))));
      const a = prof.mul(taper).mul(vBrightness).mul(u.globalBrightness).toVar();
      Discard(vPlanetMask.lessThan(0.5).or(a.lessThan(0.002)));
      out.assign(vec4(sunShaftBackdrop(tint).mul(twinkle).mul(energy), a));
    }).Else(() => {
      const rawUV = vPointCoord.sub(0.5).toVar();
      const distFromCenter = length(rawUV);
      const mask = float(1.0).sub(smoothstep(0.4, 0.5, distFromCenter)).toVar();
      const texUV = rawUV.add(0.5).toVar();
      const tex = u.pointTexture.sample(texUV).toVar();
      const finalColor = sunShaftBackdrop(vColor).toVar();
      const outside = texUV.x.lessThan(0.0).or(texUV.x.greaterThan(1.0)).or(texUV.y.lessThan(0.0)).or(texUV.y.greaterThan(1.0));
      Discard(mask.lessThan(0.01).or(vPlanetMask.lessThan(0.5)).or(outside).or(tex.a.lessThan(0.05)));
      out.assign(vec4(finalColor.mul(twinkle), tex.a.mul(vBrightness).mul(u.globalBrightness).mul(mask)));
    });
    return out;
  })();

  const material = new THREE.NodeMaterial();
  material.name = PLANET_MATERIAL_NAMES.stars;
  material.uniforms = u;
  material.lights = false;
  material.fog = false;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.forceSinglePass = true;
  material.vertexNode = vertexNode;
  material.fragmentNode = fragmentNode;
  return material;
}
