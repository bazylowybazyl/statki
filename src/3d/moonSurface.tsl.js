// src/3d/moonSurface.tsl.js
//
// Powierzchnia księżyców (Luna, Io, Europa, Ganimedes, Kallisto — DirectMoon w planet3d.assets.js).
//
// Materiał = MeshStandardNodeMaterial: model oświetlenia three (PBR, mapa normalnych, światła sceny, cień
// mapy cienia, maska słońca), z jedną zmianą: SŁOŃCE PADA Z PŁASZCZYZNY GRY, jak na planetach (2026-10-08,
// ustalenie z naprawy cieni planet — światło kierunkowe sceny stoi ~49° nad płaszczyzną, więc księżyc był
// prawie pełny przy wyraźnej smudze cienia za nim). Hak modelu oświetlenia (wzór `applySunShadowToBuiltinMaterial`
// w sunShadowMask.js) podmienia w `direct()` światła słońca gry kierunek na Słońce − środek księżyca (z = 0,
// uniform per obiekt) i mnoży barwę każdego światła bezpośredniego przez maskę słońca (zaćmienie w cieniu
// planety) — zestaw świateł sceny bez zmian (pułapka 34), ciemna połowa przechodzi prosto w smugę cienia.
// map / normalMap / emissiveMap to wbudowane pola materiału — three czyta je przez odwołania do materiału
// RYSOWANEGO obiektu, więc tekstury są per księżyc, a program wspólny.
//
// ŚWIATŁA NOCNE: emissiveNode = mapa nocy (emissiveMap, liniowo) zapalana z zapadaniem zmroku — ten sam wzór co
// miasta planet (planet3d.assets.tsl.js: próg, poświata jasnych świateł, cityOn), z tego samego kierunku słońca co
// dzień (normalna geometryczna · kierunek do Słońca), więc światła są dokładnie po stronie ciemnej; w cieniu
// planety (maska słońca) zapalają się też za dnia. Emisja nie przechodzi przez model oświetlenia.
//
// GRAF RAZ NA WARIANT, WARTOŚCI PER OBIEKT: węzły (emisja, kierunek słońca) powstają raz na wariant (z maską
// słońca — ciała przy ringu; bez — tło perspektywy), wszystkie księżyce dzielą je (ten sam klucz programu);
// kierunek do Słońca to `material.uniforms.uSunDir` (świat sceny) czytany przy rysowaniu obiektu.
import * as THREE from 'three/webgpu';
import { cameraViewMatrix, dot, float, materialEmissive, normalWorldGeometry, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';

// Jak miasta planet (planet3d.assets.tsl.js — cityOn, cities): zmrok od μ = 0,06 do −0,10, światła poniżej
// luminancji 0,006 odcięte, jasne (> ~0,3) dostają poświatę ∝ L² (bloom).
export const MOON_NIGHT = Object.freeze({ dusk0: -0.10, dusk1: 0.06, cut0: 0.006, cut1: 0.025, base: 0.55, glow: 5.0 });

export const MOON_SURFACE_NAME = 'MoonSurface';
export const MOON_SURFACE_STATS = { materials: 0, graphs: 0 };

// Które światło sceny jest słońcem gry (DirectSun.sunLight) — jemu hak podmienia kierunek. Bez rejestracji:
// światło kierunkowe rzucające cień (fiolet wypełnienia Core3D cienia nie rzuca).
let _sunLight = null;
export function setMoonSunLight(light) { _sunLight = light || null; }
function isGameSun(light) {
  if (!light || light.isDirectionalLight !== true) return false;
  return _sunLight ? light === _sunLight : light.castShadow === true;
}

/** Kierunek do Słońca (świat sceny, normalizowany) w materiale księżyca. */
export function setMoonSunDirection(material, x, y, z) {
  const u = material?.uniforms?.uSunDir;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (!u || !(len > 1e-9)) return;
  u.value.set(x / len, y / len, z / len);
}

/** Lustro CPU emisji (testy): światło mapy nocy `n` (liniowo, rgb), μ = N·L, widoczność słońca `vis`. */
export function moonNightCpu(n, mu, vis = 1) {
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const on = 1 - ss(MOON_NIGHT.dusk0, MOON_NIGHT.dusk1, mu) * vis;
  const lum = n[0] * 0.299 + n[1] * 0.587 + n[2] * 0.114;
  const k = (MOON_NIGHT.base * ss(MOON_NIGHT.cut0, MOON_NIGHT.cut1, lum) + lum * lum * MOON_NIGHT.glow) * on;
  return [n[0] * k, n[1] * k, n[2] * k];
}

// Węzły wspólne: kierunek do Słońca per obiekt (świat i widok), emisja per wariant.
const _fallbackDir = new THREE.Vector3(0, 0, 1);
const sunDirWorld = uniform(new THREE.Vector3(0, 0, 1)).onObjectUpdate(({ material }) => material?.uniforms?.uSunDir?.value || _fallbackDir);
const sunDirView = cameraViewMatrix.mul(vec4(sunDirWorld, 0.0)).xyz.normalize();
const _emissive = new Map();

function nightEmissive(sunMask) {
  let node = _emissive.get(sunMask);
  if (node) return node;
  const mu = dot(normalWorldGeometry, sunDirWorld);
  const vis = sunMask ? sunVisibility() : float(1.0);
  const on = float(1.0).sub(smoothstep(MOON_NIGHT.dusk0, MOON_NIGHT.dusk1, mu).mul(vis));
  const n = vec3(materialEmissive).toVar('moonNight');
  const lum = dot(n, vec3(0.299, 0.587, 0.114));
  node = n.mul(smoothstep(MOON_NIGHT.cut0, MOON_NIGHT.cut1, lum).mul(MOON_NIGHT.base).add(lum.mul(lum).mul(MOON_NIGHT.glow))).mul(on);
  _emissive.set(sunMask, node);
  MOON_SURFACE_STATS.graphs++;
  return node;
}

// Noc czarna jak na planetach (decyzja 2026-10-06: noc planet bez światła otoczenia): światło otoczenia sceny
// (Core3D: granatowe 0,5) i pozostałe światła sceny (fioletowe wypełnienie, punktowe) świecą na księżycu
// z tym mnożnikiem — bez niego ciemna połowa była granatowa nad czarną smugą cienia. Słońce gry bez zmian.
export const moonLightTune = Object.freeze({ other: uniform(0.12) });

// Hak modelu oświetlenia (`this` = materiał; model klasy z prototypu — własne pole to ten hak).
function moonLightingModel(builder) {
  const model = Object.getPrototypeOf(this).setupLightingModel.call(this, builder);
  if (!model || typeof model.direct !== 'function') return model;
  const direct = model.direct;
  const indirect = model.indirect;
  const mask = this.moonSunMask === true;
  model.direct = function moonDirect(input, b) {
    if (isGameSun(input.lightNode?.light)) input.lightDirection = sunDirView;
    else input.lightColor = input.lightColor.mul(moonLightTune.other);
    if (mask) input.lightColor = input.lightColor.mul(sunVisibility());
    return direct.call(this, input, b);
  };
  if (typeof indirect === 'function') {
    model.indirect = function moonIndirect(b) {
      indirect.call(this, b);
      const { reflectedLight } = b.context;
      reflectedLight.indirectDiffuse.mulAssign(moonLightTune.other);
      reflectedLight.indirectSpecular.mulAssign(moonLightTune.other);
    };
  }
  return model;
}

function moonCacheKey() {
  return `${Object.getPrototypeOf(this).customProgramCacheKey.call(this)}|moon:${this.moonSunMask === true ? 'mask' : 'bg'}`;
}

/**
 * Materiał powierzchni księżyca. Tekstury: map (dzień, sRGB), nightMap (noc, sRGB), normalMap (styczne:
 * R = wschód, G = północ — konwencja map planet). sunMask — ciało przy ringu (pass ortho, maska słońca).
 */
export function createMoonSurfaceMaterial({ map, nightMap, normalMap, normalScale = 1, sunMask = true, roughness = 0.98 } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0.0, color: 0xffffff });
  m.name = MOON_SURFACE_NAME;
  m.map = map || null;
  m.normalMap = normalMap || null;
  m.normalScale.set(normalScale, normalScale);
  m.emissive.set(nightMap ? 0xffffff : 0x000000);       // bez mapy nocy materialEmissive = sama barwa
  m.emissiveIntensity = 1.0;
  m.emissiveMap = nightMap || null;
  m.emissiveNode = nightEmissive(sunMask === true);
  m.uniforms = { uSunDir: { value: new THREE.Vector3(0, 0, 1) } };
  m.moonSunMask = sunMask === true;
  m.setupLightingModel = moonLightingModel;
  m.customProgramCacheKey = moonCacheKey;
  MOON_SURFACE_STATS.materials++;
  return m;
}
