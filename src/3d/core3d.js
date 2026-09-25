// src/3d/core3d.js
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_DEFAULTS } from './bloomConfig.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Shockwave3DManager } from '../effects3d/shockwave3D.js';
import { HULL_SDF_MAX_STEPS, HULL_SDF_OCCLUDER_FLOATS, HULL_SDF_SHADOW_GLSL, HULL_SDF_SHAFT_CAP } from './hullShadowSdf.js';
import { sunShadowUniforms } from './sunShadowMask.js';
import { createWarpLensShader, computeWarpLensUniforms, packWarpSpacePrims, WARP_SPACE_MAX_PRIMS } from './warpLens3D.js';

const MAX_HEAT_HAZE_SOURCES = 24;
// Fale warpa w uberPassie (pierścień, szew, łuk) — drgają całą klatkę, także
// kadłuby. 16: przylot floty zgłasza naraz kilka fal na okręt.
const MAX_WARP_WAVES = 16;
// Soczewka skoku: zgłoszenie starsze niż tyle ms jest martwe (gra przestała
// wołać setWarpLensWorld, np. wyjątek w ramce) — soczewka nie zostaje w kadrze.
const WARP_LENS_STALE_MS = 250;
// Cel tła soczewki powstaje przy pierwszym skoku; po tylu ms bez skoku
// oddajemy go (HalfFloat + mipmapy + głębia, pełna rozdzielczość bufora).
const WARP_LENS_TARGET_IDLE_MS = 30000;
// Zastępcze flagi warstw dla wolnej kamery (lot nad miastem): renderuj wszystko.
const LAYERS_ALL_ACTIVE = Object.freeze({ planets: true, halo: true, ringPlanets: true, shields: true });
const PLANET_RENDER_LAYER = 3;
const PLANET_HALO_RENDER_LAYER = 5;
const RING_PLANET_RENDER_LAYER = 6;
// Tarcze: własna warstwa ortho (kamera ortho, bez czyszczenia głębi). Tarcza
// to emisja (blend addytywny), a nie powierzchnia oświetlana słońcem — maski
// cienia nie czyta i świeci w cieniu planety tak samo jak poza nim.
const SHIELD_RENDER_LAYER = 7;
// Shadow shafts: WSZYSTKIE okludery są analityczne (dyski / pola odległości
// kadłubów / pierścienie w world-space, liczone per piksel w shaderze passa).
// Pass NIE mnoży już obrazu — pisze maskę widoczności słońca (sunShadowTarget,
// sunShadowMask.js), a materiały same gaszą nią człon słońca albo kładą smugę
// na tło. Okluzja screen-space (sylwetki renderowane do maski) odeszła dawno:
// nie obejmowała okluderów poza kadrem, gubiła małe kadłuby po downresie
// i kosztowała 4 dodatkowe przejścia sceny na viewport.
const SHAFT_DISC_CAP = 48;      // planety + księżyce + największe asteroidy
// Kadłuby: pole odległości sylwetki (hullShadowSdf.js), jeden wpis na statek.
const SHAFT_HULL_CAP = HULL_SDF_SHAFT_CAP;
const SHAFT_RING_CAP = 2;       // ring city (Ziemia, Mars)
// Siła cienia kadłuba: planeta gasi scenę do czerni (umbra), statek ma tylko
// przygaszać — pełna siła robiła z każdego okrętu czarną kałużę na mgławicy.
const HULL_SHADOW_STRENGTH = 0.55;

// Poziomy jakości shadow shafts — po przejściu na pełną analitykę jedyne
// różnice to długość smug, budżet kadłubów-okluderów i liczba kroków marszu
// po SDF kadłuba (koszt = ALU i próbki w jednym fullscreen passie, zero
// rekompilacji, więc nawet Low wygląda poprawnie na każdym zoomie).
// discLenMul liczony w PROMIENIACH tarczy, capsuleLenMul w DŁUGOŚCIACH
// kadłuba, capsuleBudget w kadłubach (nazwy kluczy zostają — okluder statku
// to dziś pole odległości sylwetki, nie kapsuła). Poprzednie wartości
// (18 R / 10 kadłubów na medium) dawały smugi ciągnące się przez pół
// sektora — 400u fregata rzucała cień na 4000u.
export const SHADOW_SHAFTS_QUALITY = {
  off: { enabled: false, discLenMul: 3.5, capsuleLenMul: 2, capsuleBudget: 12, hullSteps: 16 },
  low: { enabled: true, discLenMul: 3.5, capsuleLenMul: 2, capsuleBudget: 12, hullSteps: 16 },
  medium: { enabled: true, discLenMul: 5, capsuleLenMul: 3, capsuleBudget: 24, hullSteps: 24 },
  high: { enabled: true, discLenMul: 7, capsuleLenMul: 4, capsuleBudget: 32, hullSteps: 32 }
};

export function resolveShadowShaftsQuality(level) {
  const key = String(level || '').toLowerCase();
  const norm = key === 'med' ? 'medium' : key;
  const cfg = SHADOW_SHAFTS_QUALITY[norm] || SHADOW_SHAFTS_QUALITY.medium;
  return { level: SHADOW_SHAFTS_QUALITY[norm] ? norm : 'medium', ...cfg };
}

function createShadowShaftsShader() {
  return {
    name: 'ShadowShaftsCompositeShader',
    uniforms: {
      uSunActive: { value: 0 },
      uShaftGain: { value: 1 },
      uSplitScreen: { value: 0 },
      uSunWorld: { value: new THREE.Vector2(0, 0) },
      uCamCenter: { value: new THREE.Vector2(0, 0) },
      uCamCenter2: { value: new THREE.Vector2(0, 0) },
      uViewWorldSize: { value: new THREE.Vector2(1, 1) },
      uViewWorldSize2: { value: new THREE.Vector2(1, 1) },
      uDiscLenMul: { value: 5.0 },
      uDiscCount: { value: 0 },
      uDiscs: { value: Array.from({ length: SHAFT_DISC_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uHullLenMul: { value: 3.0 },
      uHullCount: { value: 0 },
      uHullSteps: { value: 24 },
      // Kadłuby: tablica warstw SDF (ustawiana w render() — klon tekstury
      // z UniformsUtils nie dostawałby aktualizacji warstw) i A/M/C na statek,
      // układ jak w HULL_SDF_SHADOW_GLSL (hullShadowSdf.js).
      uHullSdf: { value: null },
      uHullA: { value: Array.from({ length: SHAFT_HULL_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uHullM: { value: Array.from({ length: SHAFT_HULL_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uHullC: { value: Array.from({ length: SHAFT_HULL_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uRingCount: { value: 0 },
      // uRings[i]: xy = środek (three-space), z = promień pasma, w = zasięg cienia
      uRings: { value: Array.from({ length: SHAFT_RING_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform int uSunActive;
      uniform float uShaftGain;
      uniform int uSplitScreen;
      uniform vec2 uSunWorld;
      uniform vec2 uCamCenter;
      uniform vec2 uCamCenter2;
      uniform vec2 uViewWorldSize;
      uniform vec2 uViewWorldSize2;
      uniform float uDiscLenMul;
      uniform int uDiscCount;
      uniform vec4 uDiscs[${SHAFT_DISC_CAP}];
      uniform int uRingCount;
      uniform vec4 uRings[${SHAFT_RING_CAP}];
      varying vec2 vUv;
${HULL_SDF_SHADOW_GLSL}

      // Wyjscie = MASKA (sunShadowMask.js): R = cien powierzchni (tarcze
      // + kadluby), G = smuga tla (R + ringi); 0 = pelne slonce.
      void main() {
        if (uSunActive == 0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        bool rightHalf = (uSplitScreen == 1 && vUv.x > 0.5);
        vec2 localUv = (uSplitScreen == 1)
          ? (rightHalf ? vec2((vUv.x - 0.5) * 2.0, vUv.y) : vec2(vUv.x * 2.0, vUv.y))
          : vUv;
        vec2 camC = rightHalf ? uCamCenter2 : uCamCenter;
        vec2 viewWS = rightHalf ? uViewWorldSize2 : uViewWorldSize;
        vec2 worldP = camC + (localUv - 0.5) * viewWS;

        // Kierunek do slonca liczony PER PIKSEL (nie per kamera) — poprawna
        // paralaksa smug przy okluderach blisko slonca.
        vec2 toSun = uSunWorld - worldP;
        float sunDist = length(toSun);
        if (sunDist < 1.0) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        vec2 d = toSun / sunDist;

        float shadow = 0.0;
        bool insideDisc = false;

        // ── Dyski: planety, ksiezyce, najwieksze asteroidy ───────────────
        // Wnetrze tarczy pomijane (along <= exitDist) — dzienna strona
        // planety zostaje przy wlasnym oswietleniu z jej shadera.
        // disc.w = sila cienia: planeta 1.0 (umbra), asteroida ~0.5 (skala
        // skaly nie uzasadnia czarnej dziury w mglawicy).
        for (int i = 0; i < ${SHAFT_DISC_CAP}; i++) {
          if (i >= uDiscCount) break;
          vec4 disc = uDiscs[i];
          float discR = disc.z;
          if (discR <= 0.0) continue;
          vec2 axis = disc.xy - uSunWorld;
          float axisLen = length(axis);
          if (axisLen < 1.0) continue;
          axis /= axisLen;
          vec2 rel = worldP - disc.xy;
          if (dot(rel, rel) < discR * discR) insideDisc = true;
          float along = dot(rel, axis);
          if (along <= 0.0) continue;
          float perp = abs(dot(rel, vec2(-axis.y, axis.x)));
          float exitDist = sqrt(max(discR * discR - perp * perp, 0.0));
          if (along <= exitDist) continue;
          float fallT = clamp((along - exitDist) / max(discR * uDiscLenMul, 1.0), 0.0, 1.0);
          float fall = 1.0 - smoothstep(0.55, 1.0, fallT);
          // Rozmycie rośnie po ZNORMALIZOWANEJ długości smugi, więc po jej
          // skróceniu musi rosnąć wolniej — inaczej stożek rozlewa się na boki
          // zamiast być smugą.
          float soft = discR * (0.04 + 0.14 * fallT);
          float edge = 1.0 - smoothstep(discR - soft, discR + soft, perp);
          shadow = max(shadow, edge * fall * max(disc.w, 0.0));
        }

        // ── Kadluby statkow: pole odleglosci sylwetki ───────────────────
        // hullSdfShadow (hullShadowSdf.js) idzie po SDF kadluba promieniem
        // do slonca, wiec smuga zaczyna sie na burcie i obejmuje kolce oraz
        // rozwidlenia. Piksele na WLASNYM kadlubie sa pomijane — lancuch
        // kapsul pomijal tylko wnetrze tej samej kapsuly i kazda rzucala cien
        // na kadlub pod sasiednia.
        // Statek nie robi czarnej dziury jak planeta — smuga tylko przygasza.
        shadow = max(shadow, hullSdfShadow(worldP, d, sunDist) * ${HULL_SHADOW_STRENGTH.toFixed(2)});

        // Cien POWIERZCHNI (kanal R) konczy sie tutaj: tarcze + kadluby.
        float surfaceShadow = shadow;

        // ── Pierscienie (ring „Halo” wokol planety) — tylko smuga TLA ─────
        // Okrag to sciana 2D ze sloncem w plaszczyznie gry. Ring liczy wlasne
        // slonce (zacmienie + cien scian, slonce 49°) i ten okrag mu przeczy:
        // gasil wewnetrzna polowe ringu i statki miedzy nim a planeta. Zostaje
        // tylko w kanale tla (G).
        // Piksele wewnatrz tarczy planety pomijamy: pas cienia ringu na
        // POWIERZCHNI rysuje analityczny term w shaderze planety (uRingShadow*)
        // — bez tego pas bylby liczony podwojnie.
        if (!insideDisc) {
          for (int i = 0; i < ${SHAFT_RING_CAP}; i++) {
            if (i >= uRingCount) break;
            vec4 ring = uRings[i];
            float ringR = ring.z;
            if (ringR <= 0.0) continue;
            vec2 rel = worldP - ring.xy;
            float b_ = dot(rel, d);
            float c2 = dot(rel, rel) - ringR * ringR;
            float disc_ = b_ * b_ - c2;
            if (disc_ <= 0.0) continue;
            float sq = sqrt(disc_);
            // wewnatrz okregu: wyjscie w strone slonca; na zewnatrz: wejscie
            float tHit = (c2 < 0.0) ? (-b_ + sq) : (-b_ - sq);
            if (tHit <= 0.0 || tHit >= sunDist) continue;
            float ringShade = (1.0 - smoothstep(0.0, max(ring.w, 1.0), tHit)) * 0.85;
            shadow = max(shadow, ringShade);
          }
        }

        float surfaceOut = clamp(surfaceShadow, 0.0, 1.0) * uShaftGain;
        float backdropOut = clamp(shadow, 0.0, 1.0) * uShaftGain;
        // Maska ma 8 bitow: dlugi gradient smugi na mglawicy robilby schodki.
        // Statyczny szum ±0,5/255 (bez czasu — nie pelza), tylko pod smuga,
        // zeby pelne slonce zostalo dokladnym zerem.
        float dither = (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
        surfaceOut = surfaceOut > 0.0 ? clamp(surfaceOut + dither, 0.0, 1.0) : 0.0;
        backdropOut = backdropOut > 0.0 ? clamp(backdropOut + dither, 0.0, 1.0) : 0.0;
        gl_FragColor = vec4(surfaceOut, backdropOut, 0.0, 1.0);
      }
    `
  };
}

const BLEND_ADD_ONE_ONE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneFactor
};

const PLANET_HALO_BLEND_SHADER = {
  name: 'PlanetHaloBlendShader',
  uniforms: { tPlanetHalo: { value: null } },
  vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float; uniform sampler2D tPlanetHalo; varying vec2 vUv; void main() { gl_FragColor = texture2D(tPlanetHalo, vUv); }`
};

const SCENE_RESOLVE_SHADER = {
  name: 'SceneResolveShader',
  uniforms: { tDiffuse: { value: null } },
  vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `precision highp float; uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`
};

// Pełnoekranowy quad blendowany sprzętowo w bufor docelowy — zamiennik
// ShaderPassa czytającego tDiffuse w środku łańcucha scen. ShaderPass wymuszał
// tam resolve MSAA, a three po resolve INWALIDUJE renderbuffer multisample —
// kolejne passy blendowały w niezdefiniowaną pamięć (czarne kafle przy
// obciążeniu). Quad z blendingiem pisze wprost do bufora MSAA bez resolve.
class FullScreenBlendPass extends Pass {
  constructor(shader, blendConfig = {}) {
    super();
    this.needsSwap = false;
    this.material = new THREE.ShaderMaterial({
      name: shader.name || 'FullScreenBlendPass',
      uniforms: THREE.UniformsUtils.clone(shader.uniforms),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    Object.assign(this.material, blendConfig);
    this.uniforms = this.material.uniforms;
    this.fsQuad = new FullScreenQuad(this.material);
  }

  render(renderer, writeBuffer, readBuffer) {
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.fsQuad.render(renderer);
    renderer.autoClear = oldAutoClear;
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}

const UberPostShader = {
  name: 'UberPostShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSourceCount: { value: 0 },
    uGlobalStrength: { value: 1.0 },
    uAspect: { value: 1.0 },
    uHeatSources: { value: Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new THREE.Vector4(2, 2, 0, 0)) },
    uHeatDirs: { value: Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new THREE.Vector2(0, 0)) },
    uWaveCount: { value: 0 },
    uWaves: { value: Array.from({ length: MAX_WARP_WAVES }, () => new THREE.Vector4(2, 2, 0, 0)) },
    uWaveShape: { value: Array.from({ length: MAX_WARP_WAVES }, () => new THREE.Vector4(0, 0, 1, 0)) }
  },
  vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    precision highp float;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    vec3 ACESFilmicToneMapping(vec3 color) {
      return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
    }
    vec4 LinearTosRGB(in vec4 value) {
      return vec4(mix(pow(value.rgb, vec3(0.41666)) * 1.055 - vec3(0.055), value.rgb * 12.92, vec3(lessThanEqual(value.rgb, vec3(0.0031308)))), value.a);
    }

    #ifdef HEAT_HAZE
    uniform float uTime;
    uniform int uSourceCount;
    uniform float uGlobalStrength;
    uniform float uAspect;
    uniform vec4 uHeatSources[${MAX_HEAT_HAZE_SOURCES}];
    uniform vec2 uHeatDirs[${MAX_HEAT_HAZE_SOURCES}];
    uniform int uWaveCount;
    uniform vec4 uWaves[${MAX_WARP_WAVES}];
    uniform vec4 uWaveShape[${MAX_WARP_WAVES}];

    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0)); vec2 u = f * f * (3.0 - 2.0 * f); return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    #endif

    void main() {
      vec2 uv = vUv;
      vec2 distortion = vec2(0.0);   // izotropowe (wybuchy, rakiety, tarcze)
      vec2 nozzleHaze = vec2(0.0);   // dysze — z mikroskopijna dyspersja

      #ifdef HEAT_HAZE
      // Przestrzen skorygowana aspektem: dystanse izotropowe na ekranie
      // (radius zrodla jest w jednostkach osi v).
      vec2 asp = vec2(uAspect, 1.0);

      for (int i = 0; i < ${MAX_HEAT_HAZE_SOURCES}; i++) {
        if (i >= uSourceCount) break;
        vec4 src = uHeatSources[i];
        float radius = max(0.0001, src.z);
        vec2 p = (uv - src.xy) * asp;

        // dir = kierunek wydechu w przestrzeni ekranu; (0,0) => zrodlo izotropowe
        // (eksplozje, rakiety, trafienia w tarcze).
        vec2 dir = uHeatDirs[i];
        if (dot(dir, dir) > 0.25) {
          // DYSZA — port maski zaklocen z dema plazmy (dema/silniki): radius =
          // promien wylotu. Stozek 7R za dysza (szerokosc 1,25R -> 2,6R),
          // najsilniej tuz za wylotem, zanik exp(-2,4 z / 10R) i gasniecie
          // w drugiej polowie stozka; szum plynie w dol strumienia. Przesuniecie
          // ~0,12 promienia dyszy na ekranie — gorace powietrze ma ledwie zyc,
          // a nie falowac kadlubem (dawniej stozek 3,2R z kopem x3, do 0,022 UV).
          // W grze dysza siedzi na krawedzi kadluba (w demie kadlub byl daleko
          // przed dzwonem), wiec szczyt maski przesuniety ~1R za wylot — drga
          // powietrze za rufa, nie poszycie wokol dyszy.
          float along = dot(p, dir) / radius;
          if (along < 0.4 || along > 7.2) continue;
          float across = dot(p, vec2(-dir.y, dir.x)) / radius;
          float halfW = mix(1.25, 2.6, clamp(along / 7.0, 0.0, 1.0));
          float aw = abs(across) / halfW;
          if (aw >= 1.0) continue;
          float mask = exp(-along * 0.24)
                     * (1.0 - smoothstep(0.85, 1.25, halfW / 1.8))
                     * smoothstep(0.4, 1.6, along)
                     * (1.0 - smoothstep(0.55, 1.0, aw));
          vec2 nc = vec2(across * 2.2 + float(i) * 7.3, along * 0.9 - uTime * 9.9);
          float nx = noise(nc) * 0.65 + noise(nc * 2.03 + vec2(7.1, 3.3)) * 0.35;
          float ny = noise(nc + vec2(31.7, 11.9)) * 0.65 + noise(nc * 2.03 + vec2(17.3, 3.9)) * 0.35;
          vec2 off = (vec2(nx, ny) * 2.0 - 1.0) * (mask * src.w * uGlobalStrength * radius * 0.12);
          nozzleHaze += off / asp;
          continue;
        }

        float maxExt = radius * 3.4;
        if (abs(p.x) > maxExt || abs(p.y) > maxExt) continue;
        float t = length(p) / radius;
        if (t >= 1.0) continue;

        // Źródło izotropowe — bez zmian: drobny szum adwektowany (dwie
        // niezalezne skladowe zamiast pierscieni sin() i szwow fract()).
        vec2 nc = vec2(-p.x, p.y) * (3.0 / radius);
        nc.y -= uTime * 2.2;
        nc.x += float(i) * 5.19;
        float n1 = noise(nc) * 0.65 + noise(nc * 2.17 + 11.3) * 0.35;
        float n2 = noise(nc * 1.31 + vec2(5.2, 8.7)) * 0.65 + noise(nc * 2.9 + vec2(1.7, 9.2)) * 0.35;
        vec2 wob = vec2(n1, n2) - 0.5;

        float fall = smoothstep(1.0, 0.15, t) * smoothstep(0.0, 0.1, t);
        float ampl = src.w * fall * uGlobalStrength;
        vec2 disp = vec2(-wob.x * 1.4, wob.y * 0.6) * (0.0035 * ampl);
        distortion += disp / asp;
      }

      // Fale warpa (warpFx3D.js): W = (u, v, promien, amplituda) w osi v,
      // S = (typ, szerokosc, os). Typ 0 — pierscien: przesuniecie promieniowe
      // (pochodna gaussa) w pasmie wokol promienia; typ 2 — luk: to samo
      // z oknem katowym wokol osi (fala dziobowa); typ 1 — szew: drganie
      // wzdluz odcinka o polowie dlugosci W.z, zanik w poprzek na S.y.
      for (int i = 0; i < ${MAX_WARP_WAVES}; i++) {
        if (i >= uWaveCount) break;
        vec4 wv = uWaves[i];
        vec4 ws = uWaveShape[i];
        vec2 wp = (uv - wv.xy) * asp;
        if (ws.x < 0.5 || ws.x > 1.5) {
          float wr = length(wp);
          float wk = (wr - wv.z) / max(ws.y, 1e-5);
          if (abs(wk) < 3.0 && wr > 1e-5) {
            vec2 wdir = wp / wr;
            float wwin = ws.x > 1.5 ? smoothstep(0.15, 0.75, dot(wdir, ws.zw)) : 1.0;
            distortion -= wdir * (wv.w * wk * exp(-wk * wk) * wwin) / asp;
          }
        } else {
          vec2 wax = ws.zw;
          float wl = dot(wp, wax) / max(wv.z, 1e-5);
          float wc = dot(wp, vec2(-wax.y, wax.x)) / max(ws.y, 1e-5);
          if (abs(wl) < 1.0 && abs(wc) < 3.0) {
            float wm = (1.0 - wl * wl) * exp(-wc * wc);
            vec2 wn = vec2(wl * 5.0 - uTime * 3.1 + float(i) * 3.7, wc * 1.7 + uTime * 0.9);
            vec2 wo = vec2(noise(wn), noise(wn + vec2(9.2, 4.1))) - 0.5;
            distortion += wo * (wv.w * wm) / asp;
          }
        }
      }
      distortion = clamp(distortion, vec2(-0.022), vec2(0.022));
      nozzleHaze = clamp(nozzleHaze, vec2(-0.012), vec2(0.012));
      #endif

      // Dysze: mikroskopijna dyspersja, jak w demie plazmy — tylko tyle, zeby
      // gorace powietrze zylo. Poza strefa dysz jeden odczyt, jak dawniej.
      vec4 sceneColor;
      if (dot(nozzleHaze, nozzleHaze) > 1.0e-12) {
        vec2 base = uv + distortion;
        float cr = texture2D(tDiffuse, base + nozzleHaze * 0.82).r;
        vec4 cg = texture2D(tDiffuse, base + nozzleHaze);
        float cb = texture2D(tDiffuse, base + nozzleHaze * 1.22).b;
        sceneColor = vec4(cr, cg.g, cb, cg.a);
      } else {
        sceneColor = texture2D(tDiffuse, uv + distortion);
      }
      gl_FragColor = LinearTosRGB(vec4(ACESFilmicToneMapping(sceneColor.rgb), sceneColor.a));
    }
  `
};

function recordRenderDbg(name, ms) {
  const fn = (typeof globalThis !== 'undefined') ? globalThis.__renderDbgRecord : null;
  if (typeof fn !== 'function') return;
  if (!Number.isFinite(ms) || ms < 0) return;
  fn(name, ms);
}

// doClearDepth=false: pass dorysowuje się do bufora głębi zostawionego przez
// poprzedni pass (używane przez pass tarcz, żeby tarcza dalej testowała
// głębię względem świata ortho zamiast kłaść się na wszystkim).
function makeSplitScreenRenderPass(pass, layerId, isOrtho, doClearColor, doClearDepth = true) {
  pass.clear = false;

  pass.render = function(renderer, writeBuffer, readBuffer) {
      const oldAutoClear = renderer.autoClear;
      renderer.autoClear = false; 

      const target = this.renderToScreen ? null : readBuffer;
      renderer.setRenderTarget(target);

      const tw = target ? target.width : renderer.domElement.width;
      const th = target ? target.height : renderer.domElement.height;
      const isSplit = typeof window !== 'undefined' && window.splitScreenMode && Core3D.activeCam2;

      const oldCol = renderer.getClearColor(new THREE.Color());
      const oldAlpha = renderer.getClearAlpha();

      if (isSplit) {
          const halfW = Math.floor(tw / 2);
          renderer.setScissorTest(true);

          // GRACZ 1 (Lewa poĹ‚Ăłwka)
          renderer.setViewport(0, 0, halfW, th);
          renderer.setScissor(0, 0, halfW, th);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else if (doClearDepth) {
              renderer.clear(false, true, false);
          }

          // KLUCZ: Przekazujemy halfW, aby aspekt kamery wynosiĹ‚ (halfW / th)
          Core3D.syncCamera(Core3D.activeCam1, halfW, th, 0);
          this.camera = Core3D.getPassCamera(isOrtho);
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);

          // GRACZ 2 (Prawa poĹ‚Ăłwka)
          renderer.setViewport(halfW, 0, tw - halfW, th);
          renderer.setScissor(halfW, 0, tw - halfW, th);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else if (doClearDepth) {
              renderer.clear(false, true, false);
          }

          Core3D.syncCamera(Core3D.activeCam2, halfW, th, halfW);
          this.camera = Core3D.getPassCamera(isOrtho);
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);

          renderer.setScissorTest(false);
          renderer.setViewport(0, 0, tw, th);
      } else {
          // Tryb Single Player - bez zmian
          renderer.setViewport(0, 0, tw, th);
          renderer.setScissorTest(false);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else if (doClearDepth) {
              renderer.clear(false, true, false);
          }
          Core3D.syncCamera(Core3D.activeCam1, tw, th, 0);
          this.camera = Core3D.getPassCamera(isOrtho);
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);
      }
      renderer.setClearColor(oldCol, oldAlpha);
      renderer.autoClear = oldAutoClear;
  };
}

export const Core3D = {
  activeCam1: { x: 0, y: 0, zoom: 1 },
  activeCam2: null,

  canvas: null, renderer: null, scene: null, cameraOrtho: null, cameraPersp: null,
  shadowCatcher: null, shadowCatcherFg: null, shadowCatchersDebug: false,
  composerTarget: null, postTarget: null, sceneResolvePass: null, _scenePasses: null, _postPasses: null,
  refractionTarget: null, shockwave3DManager: null, _shockwavePrevTime: 0,
  _refractionValid: false, _refractionFlip: false,
  planetHaloTarget: null, haloDepthMaskMaterial: null,

  renderPassBg: null, renderPassPlanets: null, planetHaloPass: null, renderPassRingPlanets: null, renderPassOrtho: null, renderPassShields: null, renderPassFg: null,
  // Soczewka skoku (warpLens3D.js): tło (warstwa 1) renderuje się wtedy do
  // warpLensTarget, a warpLensPass kładzie je zakrzywione do bufora sceny.
  // Zgłoszenie z gry w świecie (setWarpLensWorld), uniformy liczone w render().
  warpLensTarget: null, warpLensPass: null, _warpLensActive: false, _warpLensLastUseMs: 0,
  _warpLensRequest: { x: 0, y: 0, angle: 0, radiusAlong: 0, radiusAcross: 0, swallow: 0, stampMs: -Infinity },
  _warpLensUniformScratch: { centerU: 0.5, centerV: 0.5, axisX: 1, axisY: 0, radiusAlong: 0, radiusAcross: 0, aspect: 1, swallow: 0 },
  // Efekty warpa (warpFx3D.js): prymitywy zgięcia tła (ten sam pass co soczewka)
  // i fale w uberPassie. Producent dorzuca co klatkę, render zabiera i zeruje.
  _warpSpaceReq: Array.from({ length: WARP_SPACE_MAX_PRIMS }, () => ({ type: 0, x: 0, y: 0, angle: 0, a: 0, b: 0, strength: 0 })),
  _warpSpaceCount: 0,
  _warpWaveReq: Array.from({ length: MAX_WARP_WAVES }, () => ({ type: 0, x: 0, y: 0, radius: 0, width: 0, amp: 0, angle: 0 })),
  _warpWaveCount: 0,
  // Widok skoku (warpWorldLens.js): kropla wokół statku + opływ tła — też w passie soczewki.
  _warpViewReq: { x: 0, y: 0, radiusPx: 0, beta: 0, angle: 0, phase: 0, travel: 1.2, blur: 0.3, gain: 0.8, fisheye: 1, front: 1000, band: 0.35, dropUa: 0, dropRa: 1, dropUb: 0, dropRb: 1, stampMs: -Infinity },
  heatHazeSources: null, heatHazeDirs: null, heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, _heatHazeWorldScratch: new THREE.Vector3(),
  // shadowShaftsPass pisze maskę widoczności słońca do sunShadowTarget (RGBA8,
  // rozmiar bufora sceny, bez MSAA) — patrz sunShadowMask.js.
  shadowShaftsPass: null, sunShadowTarget: null, _sunShadowTexelW: 1, _sunShadowTexelH: 1,
  // Analityczne okludery shaftów, zgłaszane co klatkę przez systemy gry:
  // dyski (planet3d.assets + asteroidField3D), kapsuły (hexShips3D),
  // pierścienie (ringi „Halo”, haloRingGame.js — Map po kluczu ringu, bez begin/reset).
  shaftDiscs: new Float32Array(SHAFT_DISC_CAP * 4), shaftDiscCount: 0,
  shaftHulls: new Float32Array(SHAFT_HULL_CAP * HULL_SDF_OCCLUDER_FLOATS), shaftHullCount: 0,
  shaftHullTexture: null,
  shaftRings: new Map(),
  // Czy na warstwach planet / halo / ring-planet / tarcz jest w tej klatce coś
  // widocznego. Pusty pass to i tak pełny obchód grafu sceny, a do celu MSAA
  // także resolve + invalidate (three robi je na końcu KAŻDEGO render()).
  // Flagi ustawiają właściciele: planet3d.assets.js (tym samym cullingiem, którym
  // chowa planety) i shield3D.js — zachowawczo, w razie wątpliwości true.
  layerActivity: { planets: true, halo: true, ringPlanets: true, shields: true },
  uberPass: null,
  bloomPass: null, bloomResolutionScale: BLOOM_DEFAULTS.resolutionScale, bloomBaseStrength: BLOOM_DEFAULTS.strength, bloomBaseThreshold: BLOOM_DEFAULTS.threshold,
  msaaSamples: 0,
  // Zegar GPU. Timery per pass mierzą czas CPU wokół pracy asynchronicznej, więc
  // gdy wąskim gardłem staje się karta, blokada wypada w losowym draw callu i
  // rozmazuje się po wszystkich passach — trzy razy w tej sesji wyglądało to jak
  // "wszystko nagle zwolniło 5x przy identycznej liczbie wywołań". To jest
  // jedyny pomiar, który rozstrzyga CPU vs GPU.
  gpuFrameMs: 0,
  _gpuTimerExt: null,
  _gpuQueryPool: null,
  _gpuQueryPending: null,
  _gpuQueryActive: null,
  perfToggles: { bloom: true, heatHaze: true, shadowShafts: true, threeShadows: true, bgPass: true, planetPass: true, orthoPass: true, fgPass: true, fgBuildings: true, fgStations: true, fgWeapons: true, fgShadows: true, enginePointLights: false },
  shadowShaftsQuality: 'medium',
  _shaftCfg: resolveShadowShaftsQuality('medium'),
  _passTogglesDirty: true,
  pixelRatio: 1, width: 0, height: 0, isInitialized: false,
  _clearColorScratch: new THREE.Color(),
  lastFramePerf: null,
  lastFrameRenderInfo: null,
  _renderInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 },
  _renderInfoBucketNames: ['refraction', 'bg', 'planets', 'shafts', 'ortho', 'fg', 'bloom', 'post', 'other'],

  _getBloomConfig() {
    const bloom = (typeof window !== 'undefined' && window.DevVFX?.bloom) ? window.DevVFX.bloom : null;
    const strength = Number.isFinite(Number(bloom?.strength)) ? Number(bloom.strength) : this.bloomBaseStrength;
    const radius = Number.isFinite(Number(bloom?.radius)) ? Number(bloom.radius) : BLOOM_DEFAULTS.radius;
    const threshold = Number.isFinite(Number(bloom?.threshold)) ? Number(bloom.threshold) : this.bloomBaseThreshold;
    const resolutionScale = Number.isFinite(Number(bloom?.resolutionScale))
      ? Number(bloom.resolutionScale)
      : this.bloomResolutionScale;
    return {
      strength: Math.max(0, strength),
      radius: Math.max(0, radius),
      threshold: Math.max(0, threshold),
      resolutionScale: Math.max(0.1, Math.min(1, resolutionScale))
    };
  },

  _makeRenderInfoBucket() {
    // ms — bez czasu per pass nie da się odróżnić kosztu GPU (rysowanie) od
    // kosztu CPU (przejście po grafie sceny). Pass rysujący 2 obiekty i pass
    // rysujący 300 mają ten sam koszt trawersu, bo three chodzi po CAŁEJ scenie
    // w każdym passie i dopiero testuje warstwy.
    return { calls: 0, triangles: 0, points: 0, lines: 0, ms: 0 };
  },

  _ensureRenderInfoBuckets() {
    if (!this.lastFrameRenderInfo) {
      this.lastFrameRenderInfo = { total: this._makeRenderInfoBucket() };
      for (const name of this._renderInfoBucketNames) {
        this.lastFrameRenderInfo[name] = this._makeRenderInfoBucket();
      }
    }
    return this.lastFrameRenderInfo;
  },

  _zeroRenderInfoBucket(bucket) {
    if (!bucket) return;
    bucket.calls = 0;
    bucket.triangles = 0;
    bucket.points = 0;
    bucket.lines = 0;
    bucket.ms = 0;
  },

  _resetRenderInfoBuckets() {
    const info = this._ensureRenderInfoBuckets();
    this._zeroRenderInfoBucket(info.total);
    for (const name of this._renderInfoBucketNames) this._zeroRenderInfoBucket(info[name]);
  },

  _readRenderInfoInto(target) {
    const src = this.renderer?.info?.render;
    target.calls = Number(src?.calls) || 0;
    target.triangles = Number(src?.triangles) || 0;
    target.points = Number(src?.points) || 0;
    target.lines = Number(src?.lines) || 0;
    return target;
  },

  _addRenderInfoDelta(bucketName, elapsedMs = 0, before = this._renderInfoBefore) {
    const info = this._ensureRenderInfoBuckets();
    const safeBucketName = (bucketName === 'fg' || bucketName === 'bloom' || bucketName === 'refraction' || info[bucketName])
      ? bucketName
      : 'other';
    const bucket = info[safeBucketName] || info.other;
    const current = this.renderer?.info?.render;
    bucket.calls += Math.max(0, (Number(current?.calls) || 0) - before.calls);
    bucket.triangles += Math.max(0, (Number(current?.triangles) || 0) - before.triangles);
    bucket.points += Math.max(0, (Number(current?.points) || 0) - before.points);
    bucket.lines += Math.max(0, (Number(current?.lines) || 0) - before.lines);
    bucket.ms += Math.max(0, Number(elapsedMs) || 0);
  },

  _finalizeRenderInfoBuckets() {
    const info = this._ensureRenderInfoBuckets();
    this._readRenderInfoInto(info.total);
    let knownCalls = 0;
    let knownTriangles = 0;
    let knownPoints = 0;
    let knownLines = 0;
    for (const name of this._renderInfoBucketNames) {
      if (name === 'other') continue;
      const bucket = info[name];
      knownCalls += bucket.calls;
      knownTriangles += bucket.triangles;
      knownPoints += bucket.points;
      knownLines += bucket.lines;
    }
    info.other.calls = Math.max(0, info.total.calls - knownCalls);
    info.other.triangles = Math.max(0, info.total.triangles - knownTriangles);
    info.other.points = Math.max(0, info.total.points - knownPoints);
    info.other.lines = Math.max(0, info.total.lines - knownLines);
  },

  _wrapRenderInfoPass(pass, bucketName) {
    if (!pass || pass.__core3dRenderInfoWrapped) return;
    const originalRender = pass.render;
    const core = this;
    pass.render = function (...args) {
      core._readRenderInfoInto(core._renderInfoBefore);
      const t0 = performance.now();
      const result = originalRender.apply(this, args);
      core._addRenderInfoDelta(bucketName, performance.now() - t0);
      return result;
    };
    pass.__core3dRenderInfoWrapped = true;
    pass.__core3dRenderInfoBucket = bucketName;
  },

  _instrumentComposerPasses() {
    this._wrapRenderInfoPass(this.renderPassBg, 'bg');
    this._wrapRenderInfoPass(this.warpLensPass, 'bg');
    this._wrapRenderInfoPass(this.renderPassPlanets, 'planets');
    this._wrapRenderInfoPass(this.planetHaloPass, 'planets');
    this._wrapRenderInfoPass(this.renderPassRingPlanets, 'planets');
    this._wrapRenderInfoPass(this.shadowShaftsPass, 'shafts');
    this._wrapRenderInfoPass(this.renderPassOrtho, 'ortho');
    this._wrapRenderInfoPass(this.renderPassShields, 'ortho');
    this._wrapRenderInfoPass(this.renderPassFg, 'fg');
    this._wrapRenderInfoPass(this.bloomPass, 'bloom');
    this._wrapRenderInfoPass(this.uberPass, 'post');
  },

  _applyBloomPassConfig() {
    if (!this.bloomPass) return;
    const cfg = this._getBloomConfig();
    this.bloomPass.strength = cfg.strength;
    this.bloomPass.radius = cfg.radius;
    this.bloomPass.threshold = cfg.threshold;
  },

  init(canvasElement) {
    if (this.isInitialized) return this;

    this.canvas = canvasElement || document.getElementById('webgl-layer');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false, powerPreference: 'high-performance', premultipliedAlpha: true, logarithmicDepthBuffer: false });
    this.renderer.localClippingEnabled = true;

    const dpr = (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1;
    this.pixelRatio = Math.min(1.0, Math.max(1, dpr));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Słońce (planet3d.assets.js) ma castShadow + layers.enableAll, więc przy
    // autoUpdate three przerysowywało mapę 4096² w KAŻDYM renderer.render(scene):
    // halo ×2, bg, planets, ringPlanets, ortho, shields, fg (+3 w refrakcji) —
    // za każdym razem pełny obchód grafu (renderObject) i clear mapy. Rzucający
    // żyją tylko na warstwach ortho i FG (stacje), więc mapę odświeżamy ręcznie
    // tuż przed tymi passami (render() i snapshot refrakcji).
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 0);
    // Disable per-render auto-reset so renderer.info accumulates across all
    // passes — we manually reset once per frame at the start of the pass chain.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = null;
    // Jedna scena obsluguje 6 RenderPassow + pre-pass halo + snapshot refrakcji,
    // czyli do 11 wywolan renderer.render(scene, ...) na klatke. Kazde z nich
    // robi scene.updateMatrixWorld(), a ten ZAWSZE schodzi do wszystkich dzieci
    // (takze niewidocznych) i dla kazdego wezla z matrixAutoUpdate=true robi
    // matrix.compose() + multiplyMatrices — nic sie nie cache'uje miedzy
    // przejsciami. Przy ~1000 wezlow (2 na cialo heksowe, pule asteroid, miasto
    // ringu) to byl caly rzad wielkosci pracy na darmo.
    // Aktualizujemy wiec macierze RECZNIE, raz na klatke, na gorze render().
    // Kto rusza transformem PO tym momencie (syncCamera -> shadowCatcher,
    // Shockwave3DManager.update), odswieza swoje wezly sam.
    this.scene.matrixWorldAutoUpdate = false;

    const sun = new THREE.DirectionalLight(0x8b79ff, 0.1);
    sun.position.set(30000, 20000, 45000);
    sun.layers.enableAll();
    this.scene.add(sun);
    const ambient = new THREE.AmbientLight(0x1b2c80, 0.5);
    ambient.layers.enableAll();
    this.scene.add(ambient);
    const coreLight = new THREE.PointLight(0x3366aa, 0.4, 120000);
    coreLight.position.set(0, 0, -2000);
    coreLight.layers.enableAll();
    this.scene.add(coreLight);

    this.cameraOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400000);
    this.cameraPersp = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 100, 500000);

    // Refrakcja w połowie rozdzielczości — to tylko źródło zniekształcenia
    // dla shockwave; half-res jest niezauważalny, a tnie fill-rate 4×.
    this.refractionTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(window.innerWidth * this.pixelRatio * 0.5)),
      Math.max(1, Math.floor(window.innerHeight * this.pixelRatio * 0.5)),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false
      }
    );
    this.shockwave3DManager = new Shockwave3DManager(this.scene, 8, this.refractionTarget);
    this._shockwavePrevTime = 0;
    if (typeof window !== 'undefined') {
      window.trigger3DShockwave = (x, y, z, scale, life, colorHex) => {
        if (this.shockwave3DManager) {
          this.shockwave3DManager.spawn(x, y, z, scale, life, colorHex);
        }
      };
    }
	
    const shadowGeo = new THREE.PlaneGeometry(500000, 500000);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.6, color: 0x000000, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcher = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadowCatcher.position.set(0, 0, -2);
    this.shadowCatcher.receiveShadow = true; this.shadowCatcher.renderOrder = 5; this.shadowCatcher.frustumCulled = false; this.shadowCatcher.layers.set(0);
    this.scene.add(this.shadowCatcher);

    const shadowMatFg = new THREE.ShadowMaterial({ opacity: 0.6, color: 0x000000, transparent: true, depthWrite: false, depthTest: false });
    this.shadowCatcherFg = new THREE.Mesh(shadowGeo, shadowMatFg);
    this.shadowCatcherFg.position.set(0, 0, -100);
    this.shadowCatcherFg.receiveShadow = true; this.shadowCatcherFg.renderOrder = 5; this.shadowCatcherFg.frustumCulled = false; this.shadowCatcherFg.layers.set(2);
    this.scene.add(this.shadowCatcherFg);

    const rt = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat, type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true, samples: this.renderer.capabilities.isWebGL2 ? 4 : 0
    });
    this.composerTarget = rt;
    this.msaaSamples = Number(rt.samples) || 0;
    // Te same próbki co scena: przy samples=0 krawędź maski halo ząbkowała
    // inaczej niż wygładzona MSAA krawędź planety = przerywana obwódka na limbie.
    this.planetHaloTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: rt.samples
    });
    // Post-łańcuch (bloom + uber) działa na buforze BEZ MSAA: bloom domalowuje
    // się addytywnie do bufora, z którego przed chwilą czytał — na buforze MSAA
    // three po resolve inwaliduje renderbuffer i blend trafiał w niezdefiniowane
    // kafle (czarne prostokąty przy szybkim ruchu kamery).
    this.postTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0
    });
    // Maska widoczności słońca (sunShadowMask.js): rozmiar bufora sceny, żeby
    // gl_FragCoord trafiał w teksel 1:1 — w połowie rozdzielczości brzeg
    // kadłuba po stronie cienia łapał ciemną obwódkę z sąsiedniego teksela.
    this.sunShadowTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0
    });
    sunShadowUniforms.uSunShadowMap.value = this.sunShadowTarget.texture;
    sunShadowUniforms.uSunShadowOn.value = 0;
    this.haloDepthMaskMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.haloDepthMaskMaterial.colorWrite = false;
    this.haloDepthMaskMaterial.depthWrite = true;
    this.haloDepthMaskMaterial.depthTest = true;

    this.renderPassBg = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassBg, 1, false, true);
    this.renderPassPlanets = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassPlanets, PLANET_RENDER_LAYER, false, false);
    this.planetHaloPass = new FullScreenBlendPass(PLANET_HALO_BLEND_SHADER, BLEND_ADD_ONE_ONE);
    this.renderPassRingPlanets = new RenderPass(this.scene, this.cameraOrtho);
    makeSplitScreenRenderPass(this.renderPassRingPlanets, RING_PLANET_RENDER_LAYER, true, false);
    this.renderPassOrtho = new RenderPass(this.scene, this.cameraOrtho);
    makeSplitScreenRenderPass(this.renderPassOrtho, 0, true, false);
    // Tarcze: ta sama kamera ortho co świat, ale BEZ czyszczenia głębi —
    // pass dokłada się do bufora zostawionego przez renderPassOrtho, więc
    // tarcza dalej testuje głębię względem kadłubów zamiast kłaść się na
    // wszystkim.
    this.renderPassShields = new RenderPass(this.scene, this.cameraOrtho);
    makeSplitScreenRenderPass(this.renderPassShields, SHIELD_RENDER_LAYER, true, false, false);
    this.renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassFg, 2, false, false);

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazeDirs = new Float32Array(this.heatHazeMaxSources * 2);

    // Shafty piszą maskę (bez blendingu, cały quad) do sunShadowTarget — raz na
    // klatkę, przed pre-passem halo i wszystkimi passami sceny (render()).
    this.shadowShaftsPass = new FullScreenBlendPass(createShadowShaftsShader(), { blending: THREE.NoBlending });
    // Soczewka skoku: quad bez blendingu zastępuje cały kolor bufora sceny
    // zakrzywionym tłem (warpLensTarget). Głębia zostaje nieczyszczona — każdy
    // pass z testem głębi po nim (planety, ring, ortho, FG) czyści ją sam.
    this.warpLensPass = new FullScreenBlendPass(createWarpLensShader(), { blending: THREE.NoBlending });

    // Earth and Mars use an orthographic planet pass so their projected centre
    // and radius stay locked to the gameplay ring at every zoom level. The pass
    // still renders the real sphere/cloud/atmosphere meshes; only parallax is
    // removed. Later world/foreground passes clear depth and draw over the globe.
    //
    // Wszystkie passy sceny piszą do JEDNEGO targetu MSAA, a halo to quad
    // blendowany sprzętowo (nie ShaderPass czytający tDiffuse).
    //
    // Cieni słońca NIE MA w tym łańcuchu: shadowShaftsPass liczy maskę przed
    // nim, a materiały czytają ją same (sunShadowMask.js) — kadłub gasi tylko
    // człon słońca, tło dostaje smugę, emitery i ring nic. Dawniej był tu quad
    // mnożący gotowy obraz po warstwie 0: broń i dysze, które na niej siedzą,
    // spadały w umbrze pod próg bloomu, a ring dostawał drugi cień.
    //
    // Tarcze: własny pass zamiast warstwy FG, bo tarcza musi zostać
    // w projekcji ortho (kopuła/sfera w perspektywie rozjeżdżałaby się
    // z kadłubem).
    //
    // warpLensPass zaraz po tle: zakrzywia tylko to, co leży daleko za
    // statkiem (mgławica, gwiazdy). Planety, statki i reszta kładą się na
    // wierzchu, a bloom liczy się z gotowego obrazu.
    this._scenePasses = [
      this.renderPassBg,
      this.warpLensPass,
      this.renderPassPlanets,
      this.planetHaloPass,
      this.renderPassRingPlanets,
      this.renderPassOrtho,
      this.renderPassShields,
      this.renderPassFg
    ];

    const bloomCfg = this._getBloomConfig();
    this.bloomResolutionScale = bloomCfg.resolutionScale;
    const bloomScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.floor(window.innerWidth * bloomScale), Math.floor(window.innerHeight * bloomScale)),
      bloomCfg.strength,
      bloomCfg.radius,
      bloomCfg.threshold
    );

    this.uberPass = new ShaderPass(UberPostShader);
    this.uberPass.material.defines = { HEAT_HAZE: 1 };
    this.uberPass.material.needsUpdate = true;
    this.uberPass.renderToScreen = true;

    this.sceneResolvePass = new FullScreenBlendPass(SCENE_RESOLVE_SHADER, { blending: THREE.NoBlending });
    this.sceneResolvePass.uniforms.tDiffuse.value = rt.texture;
    this._postPasses = [this.sceneResolvePass, this.bloomPass, this.uberPass];
    this.planetHaloPass.uniforms.tPlanetHalo.value = this.planetHaloTarget.texture;

    this._initGpuTimer();
    this._applyPassToggles();
    this._instrumentComposerPasses();
    this.isInitialized = true;
    this.resize(window.innerWidth, window.innerHeight);

    return this;
  },

  _disposeComposerChain() {
    try {
      for (const pass of [...(this._scenePasses || []), ...(this._postPasses || []), this.shadowShaftsPass]) try { pass?.dispose?.(); } catch { }
      try { this.sunShadowTarget?.dispose?.(); } catch { }
      try { this.composerTarget?.dispose?.(); } catch { }
      try { this.postTarget?.dispose?.(); } catch { }
      try { this.refractionTarget?.dispose?.(); } catch { }
      try { this.warpLensTarget?.dispose?.(); } catch { }
      try { this.shockwave3DManager?.dispose?.(); } catch { }
      try { this.planetHaloTarget?.dispose?.(); } catch { }
      try { this.haloDepthMaskMaterial?.dispose?.(); } catch { }
    } catch { }
    this.isInitialized = false;
    this.sunShadowTarget = null;
    sunShadowUniforms.uSunShadowMap.value = null;
    sunShadowUniforms.uSunShadowOn.value = 0;
    this.refractionTarget = null;
    this.warpLensTarget = null;
    this._warpLensActive = false;
    this.shockwave3DManager = null;
    this._shockwavePrevTime = 0;
  },

  // Reczna aktualizacja macierzy sceny. Wolana raz na klatke zamiast raz na
  // kazde renderer.render(scene, ...) — patrz komentarz przy
  // scene.matrixWorldAutoUpdate = false w init().
  _syncSceneMatrices() {
    if (this.scene) this.scene.updateMatrixWorld();
  },

  _applyPassToggles() {
    const t = this.perfToggles || {};
    if (this.renderPassBg) this.renderPassBg.enabled = t.bgPass !== false;
    // Bez passa tła soczewka nie ma czego zakrzywiać.
    if (this.warpLensPass) this.warpLensPass.enabled = t.bgPass !== false;
    if (this.renderPassPlanets) this.renderPassPlanets.enabled = t.planetPass !== false;
    if (this.planetHaloPass) this.planetHaloPass.enabled = t.planetPass !== false;
    if (this.renderPassRingPlanets) this.renderPassRingPlanets.enabled = t.planetPass !== false;
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
    if (this.renderPassShields) this.renderPassShields.enabled = t.orthoPass !== false;
    if (this.renderPassFg) this.renderPassFg.enabled = t.fgPass !== false;
    if (this.bloomPass) this.bloomPass.enabled = t.bloom !== false;
    if (this.shadowShaftsPass) this.shadowShaftsPass.enabled = t.shadowShafts !== false;
    if (this.uberPass) this.uberPass.enabled = true; // zawsze wlaczony — ACES + sRGB
    if (this.renderer?.shadowMap) {
      this.renderer.shadowMap.enabled = t.threeShadows !== false;
      this.renderer.shadowMap.needsUpdate = t.threeShadows !== false;
    }
    if (this.shadowCatcher) this.shadowCatcher.visible = t.threeShadows !== false;
    if (this.shadowCatcherFg) this.shadowCatcherFg.visible = (t.fgShadows !== false) && (t.threeShadows !== false);
    // FG sub-toggles: only FORCE-HIDE when toggle is OFF. When the toggle
    // is ON, leave visibility alone so per-system distance culling (e.g.
    // PlanetaryRing.updateFromPlanet) can manage visibility per-frame.
    // (Previously this loop unconditionally set child.visible = fgB every
    // render, undoing all distance-gate hides.)
    if (this.scene) {
      const fgB = t.fgBuildings !== false;
      const fgS = t.fgStations !== false;
      const fgW = t.fgWeapons !== false;
      const engineLights = t.enginePointLights !== false;
      for (const child of this.scene.children) {
        const cat = child.userData?.fgCategory;
        if (cat === 'buildings') { if (!fgB) child.visible = false; }
        else if (cat === 'stations') { if (!fgS) child.visible = false; }
        else if (cat === 'weapons') { if (!fgW) child.visible = false; }
        child.traverse?.((node) => {
          if (!node?.userData?.enginePointLight) return;
          node.visible = engineLights;
          if (!engineLights && node.isLight) node.intensity = 0;
        });
      }
    }
  },

  setPerfToggles(next = {}) {
    if (!next || typeof next !== 'object') return this.getPerfStatus();
    const t = this.perfToggles || (this.perfToggles = {});
    if ('godRays' in next) t.shadowShafts = !!next.godRays;
    if ('shadows' in next) t.threeShadows = !!next.shadows;
    Object.assign(t, next);
    this._passTogglesDirty = true;
    if (this.uberPass) {
      const hasHeatHaze = t.heatHaze !== false;
      const defines = { ...(this.uberPass.material.defines || {}) };
      if (hasHeatHaze && !defines.HEAT_HAZE) {
        defines.HEAT_HAZE = 1;
        this.uberPass.material.defines = defines;
        this.uberPass.material.needsUpdate = true;
      } else if (!hasHeatHaze && defines.HEAT_HAZE) {
        delete defines.HEAT_HAZE;
        this.uberPass.material.defines = defines;
        this.uberPass.material.needsUpdate = true;
      }
    }
    this._applyPassToggles();
    return this.getPerfStatus();
  },

  setMsaaEnabled(enabled = true, samples = 4) {
    const targetSamples = enabled ? Math.max(0, Number(samples) || 4) : 0;
    if (this.msaaSamples === targetSamples) return this.getPerfStatus();

    this.msaaSamples = targetSamples;

    const applySamples = (rt) => {
      if (rt && rt.samples !== targetSamples) {
        rt.samples = targetSamples;
        rt.dispose();
      }
    };

    applySamples(this.composerTarget);
    // Halo musi śledzić próbki sceny — rozjazd daje przerywaną obwódkę na limbie.
    applySamples(this.planetHaloTarget);

    return this.getPerfStatus();
  },

  // Po przejściu shaftów na pełną analitykę poziom jakości nie wymaga
  // rekompilacji shadera ani resizingu targetów — parametry (długości smug,
  // budżet kapsuł) idą co klatkę jako uniformy z _shaftCfg.
  setShadowShaftsQuality(level = 'medium') {
    const cfg = resolveShadowShaftsQuality(level);
    this.shadowShaftsQuality = cfg.level;
    this._shaftCfg = cfg;
    const t = this.perfToggles || (this.perfToggles = {});
    t.shadowShafts = cfg.enabled;
    this._passTogglesDirty = true;
    return this.getPerfStatus();
  },
  getPerfStatus() {
    const t = this.perfToggles || {};
    return {
      isInitialized: !!this.isInitialized,
      bloom: t.bloom !== false,
      heatHaze: t.heatHaze !== false,
      shadowShafts: t.shadowShafts !== false,
      godRays: t.shadowShafts !== false,
      shadowShaftsQuality: this.shadowShaftsQuality || 'medium',
      threeShadows: t.threeShadows !== false,
      bgPass: t.bgPass !== false,
      planetPass: t.planetPass !== false,
      orthoPass: t.orthoPass !== false,
      fgPass: t.fgPass !== false,
      fgBuildings: t.fgBuildings !== false,
      fgStations: t.fgStations !== false,
      fgWeapons: t.fgWeapons !== false,
      fgShadows: t.fgShadows !== false,
      enginePointLights: t.enginePointLights !== false,
      msaaSamples: Number(this.msaaSamples) || 0
    };
  },
  enableBackground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(1); }); },
  enablePlanet3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(PLANET_RENDER_LAYER); }); },
  enablePlanetHalo3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(PLANET_HALO_RENDER_LAYER); }); },
  enableRingPlanet3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(RING_PLANET_RENDER_LAYER); }); },
  enableForeground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(2); }); },
  enableShield3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(SHIELD_RENDER_LAYER); }); },

  isFreePerspectiveCamera(cameraData = this.activeCam1) {
    return cameraData?.mode === 'free3d' && cameraData?.position && cameraData?.quaternion;
  },

  getPassCamera(isOrtho = false) {
    // Ring City flight is a real perspective view through the same shared
    // scene/composer. In that mode even legacy layer-0 world objects must use
    // the perspective camera; no extra renderer or parallel scene is created.
    if (this.isFreePerspectiveCamera()) return this.cameraPersp;
    return isOrtho ? this.cameraOrtho : this.cameraPersp;
  },

  resize(w, h) {
    if (!this.isInitialized) return;
    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    this.pixelRatio = Math.min(1.5, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1)));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.width = width; this.height = height;
    this.renderer.setSize(width, height, false);
    const bufW = Math.max(1, Math.floor(width * this.pixelRatio));
    const bufH = Math.max(1, Math.floor(height * this.pixelRatio));
    if (this.composerTarget) this.composerTarget.setSize(bufW, bufH);
    if (this.postTarget) this.postTarget.setSize(bufW, bufH);
    if (this.sunShadowTarget) this.sunShadowTarget.setSize(bufW, bufH);

    if (this.refractionTarget) {
      this.refractionTarget.setSize(
        Math.max(1, Math.floor(width * this.pixelRatio * 0.5)),
        Math.max(1, Math.floor(height * this.pixelRatio * 0.5))
      );
    }
    if (this.planetHaloTarget) {
      this.planetHaloTarget.setSize(bufW, bufH);
    }
    if (this.warpLensTarget) this.warpLensTarget.setSize(bufW, bufH);
    if (this.bloomPass && typeof this.bloomPass.setSize === 'function') {
      const bScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
      this.bloomPass.setSize(Math.floor(width * this.pixelRatio * bScale), Math.floor(height * this.pixelRatio * bScale));
    }
  },

  syncCamera(gameCamera, viewWidth, viewHeight, viewOffsetX = 0) {
    if (!this.isInitialized || !gameCamera) return;
    
    if (viewWidth === undefined) {
       this.activeCam1 = gameCamera;
       if (typeof window !== 'undefined' && window.camera2) {
           this.activeCam2 = window.camera2;
       } else {
           this.activeCam2 = gameCamera;
       }
    }

    const w = viewWidth || this.width;
    const h = viewHeight || this.height;

    if (this.isFreePerspectiveCamera(gameCamera)) {
      const fov = Math.max(30, Math.min(90, Number(gameCamera.fov) || 58));
      this.cameraPersp.fov = fov;
      this.cameraPersp.aspect = w / Math.max(1, h);
      this.cameraPersp.near = Math.max(0.1, Number(gameCamera.near) || 0.5);
      this.cameraPersp.far = Math.max(this.cameraPersp.near + 1000, Number(gameCamera.far) || 500000);
      this.cameraPersp.position.copy(gameCamera.position);
      this.cameraPersp.quaternion.copy(gameCamera.quaternion);
      this.cameraPersp.updateProjectionMatrix();
      this.cameraPersp.updateMatrixWorld(true);
      return;
    }

    const zoom = Math.max(0.0001, gameCamera.zoom || 1);
    
    const halfW = (w / 2) / zoom;
    const halfH = (h / 2) / zoom;
    this.cameraOrtho.left = -halfW;
    this.cameraOrtho.right = halfW;
    this.cameraOrtho.top = halfH;
    this.cameraOrtho.bottom = -halfH;
    this.cameraOrtho.updateProjectionMatrix();

    this.cameraPersp.aspect = w / h;
    const fovRad = THREE.MathUtils.degToRad(this.cameraPersp.fov * 0.5);
    const targetZ = (h / 2) / Math.tan(fovRad) / zoom;
    this.cameraPersp.updateProjectionMatrix();

    // Wstrząs od strzałów (window.__weapon3dCameraShake) jest już w gameCamera:
    // render() w index.html dokłada go do `cam`. Dodawany TUTAJ ruszał tylko
    // sceny Three, a kanwa 2D (wieżyczki, myśliwce) stała — warstwy się rozjeżdżały.
    const camX = gameCamera.x;
    const camY = -gameCamera.y;

    this.cameraOrtho.position.set(camX, camY, 150000);
    this.cameraPersp.position.set(camX, camY, targetZ);
    this.cameraPersp.lookAt(camX, camY, 0);

    if (viewOffsetX === 0) {
      // syncCamera leci WEWNATRZ kazdego passa, wiec te dwa wezly ruszaja sie
      // po recznym scene.updateMatrixWorld() z gory render(). Odswiezamy je tu
      // punktowo (2 wezly), zamiast przechodzic caly graf jeszcze raz.
      if (this.shadowCatcher) {
        this.shadowCatcher.position.set(camX, camY, -2);
        this.shadowCatcher.updateMatrixWorld();
      }
      if (this.shadowCatcherFg) {
        this.shadowCatcherFg.position.set(camX, camY, -100);
        this.shadowCatcherFg.updateMatrixWorld();
      }
    }
  },

  _initGpuTimer() {
    this._gpuQueryPool = [];
    this._gpuQueryPending = [];
    this._gpuQueryActive = null;
    try {
      const gl = this.renderer?.getContext?.();
      if (gl && this.renderer.capabilities?.isWebGL2) {
        this._gpuTimerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') || null;
      }
    } catch (_) {
      this._gpuTimerExt = null;
    }
  },

  _gpuTimerBegin() {
    const ext = this._gpuTimerExt;
    if (!ext || this._gpuQueryActive) return;
    const gl = this.renderer.getContext();
    // Więcej niż kilka zapytań w locie znaczy, że wyniki nie nadążają — wtedy
    // odpuszczamy klatkę zamiast puchnąć w nieskończoność.
    if (this._gpuQueryPending.length > 4) return;
    const query = this._gpuQueryPool.pop() || gl.createQuery();
    if (!query) return;
    try {
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      this._gpuQueryActive = query;
    } catch (_) {
      this._gpuQueryPool.push(query);
      this._gpuQueryActive = null;
    }
  },

  _gpuTimerEnd() {
    const ext = this._gpuTimerExt;
    if (!ext || !this._gpuQueryActive) return;
    const gl = this.renderer.getContext();
    try {
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      this._gpuQueryPending.push(this._gpuQueryActive);
    } catch (_) { }
    this._gpuQueryActive = null;
  },

  _gpuTimerPoll() {
    const ext = this._gpuTimerExt;
    if (!ext || !this._gpuQueryPending?.length) return;
    const gl = this.renderer.getContext();
    // Disjoint = sterownik przerwał pomiar (zmiana zegarów, przełączenie
    // kontekstu). Wyniki z takiej klatki są śmieciem i trzeba je wyrzucić.
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    if (disjoint) {
      for (const q of this._gpuQueryPending) this._gpuQueryPool.push(q);
      this._gpuQueryPending.length = 0;
      return;
    }
    while (this._gpuQueryPending.length) {
      const query = this._gpuQueryPending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
      this.gpuFrameMs = Number(ns) / 1e6;
      this._gpuQueryPending.shift();
      this._gpuQueryPool.push(query);
    }
  },

  // Skala gl_FragCoord → UV maski cieni dla celu, do którego rysują materiały.
  _setSunShadowTexelFor(target) {
    const w = Math.max(1, Number(target?.width) || 1);
    const h = Math.max(1, Number(target?.height) || 1);
    sunShadowUniforms.uSunShadowTexel.value.set(1 / w, 1 / h);
  },

  // Maska widoczności słońca (sunShadowMask.js): uniformy okluderów i jeden
  // quad do sunShadowTarget. Bez słońca, przy shaftach Off, w wolnej kamerze
  // albo w pełnym skoku maska jest wyłączona uniformem — materiały jej wtedy
  // nie próbkują (stary target może zostać).
  _renderSunShadowMask(active, sun, shaftCut, shaftCfg, isSplit) {
    const pass = this.shadowShaftsPass;
    const target = this.sunShadowTarget;
    this._setSunShadowTexelFor(this.composerTarget);
    if (!pass || !target || pass.enabled === false || !active) {
      sunShadowUniforms.uSunShadowOn.value = 0;
      if (pass) pass.material.uniforms.uSunActive.value = 0;
      return false;
    }
    const uShafts = pass.material.uniforms;
    const cam1 = this.activeCam1 || { x: 0, y: 0 };
    const cam2 = this.activeCam2 || cam1;
    const zoom1 = Math.max(0.0001, Number(cam1.zoom) || 1);
    const zoom2 = Math.max(0.0001, Number(cam2.zoom) || 1);
    const viewW = isSplit ? this.width / 2 : this.width;
    uShafts.uSunActive.value = 1;
    uShafts.uShaftGain.value = 1 - shaftCut;
    uShafts.uSplitScreen.value = isSplit ? 1 : 0;
    uShafts.uSunWorld.value.set(sun.x, -sun.y);
    uShafts.uCamCenter.value.set(Number(cam1.x) || 0, -(Number(cam1.y) || 0));
    uShafts.uViewWorldSize.value.set(viewW / zoom1, this.height / zoom1);
    if (isSplit) {
      uShafts.uCamCenter2.value.set(Number(cam2.x) || 0, -(Number(cam2.y) || 0));
      uShafts.uViewWorldSize2.value.set(viewW / zoom2, this.height / zoom2);
    } else {
      uShafts.uCamCenter2.value.copy(uShafts.uCamCenter.value);
      uShafts.uViewWorldSize2.value.copy(uShafts.uViewWorldSize.value);
    }
    uShafts.uDiscLenMul.value = Math.max(1, Number(shaftCfg.discLenMul) || 5);
    uShafts.uHullLenMul.value = Math.max(1, Number(shaftCfg.capsuleLenMul) || 3);
    uShafts.uHullSteps.value = Math.max(1, Math.min(HULL_SDF_MAX_STEPS, Number(shaftCfg.hullSteps) || 24));

    const discCount = Math.min(this.shaftDiscCount | 0, SHAFT_DISC_CAP);
    uShafts.uDiscCount.value = discCount;
    const discVals = uShafts.uDiscs.value;
    for (let i = 0; i < discCount; i++) {
      const base = i * 4;
      discVals[i].set(this.shaftDiscs[base], this.shaftDiscs[base + 1], this.shaftDiscs[base + 2], this.shaftDiscs[base + 3]);
    }

    // Kadłuby: hexShips3D zgłasza od największych i sam staje na budżecie
    // jakości (getShaftHullBudget), min() tylko na wszelki wypadek. Bez
    // tablicy warstw nie ma czego próbkować — pusta tablica czytałaby się
    // jako „wszędzie kadłub” i zaciemniała cały prostokąt statku.
    const hullCount = this.shaftHullTexture
      ? Math.min(this.shaftHullCount | 0, Math.max(0, Number(shaftCfg.capsuleBudget) || SHAFT_HULL_CAP), SHAFT_HULL_CAP)
      : 0;
    uShafts.uHullCount.value = hullCount;
    uShafts.uHullSdf.value = this.shaftHullTexture;
    const hulls = this.shaftHulls;
    const hullA = uShafts.uHullA.value;
    const hullM = uShafts.uHullM.value;
    const hullC = uShafts.uHullC.value;
    for (let i = 0; i < hullCount; i++) {
      const base = i * HULL_SDF_OCCLUDER_FLOATS;
      hullA[i].set(hulls[base], hulls[base + 1], hulls[base + 2], hulls[base + 3]);
      hullM[i].set(hulls[base + 4], hulls[base + 5], hulls[base + 6], hulls[base + 7]);
      hullC[i].set(hulls[base + 8], hulls[base + 9], hulls[base + 10], hulls[base + 11]);
    }

    let ringCount = 0;
    const ringVals = uShafts.uRings.value;
    for (const rec of this.shaftRings.values()) {
      if (ringCount >= SHAFT_RING_CAP) break;
      if (!(rec.r > 0)) continue;
      ringVals[ringCount].set(rec.x, rec.y, rec.r, rec.reach);
      ringCount++;
    }
    uShafts.uRingCount.value = ringCount;

    const prevTarget = this.renderer.getRenderTarget();
    pass.render(this.renderer, null, target);
    this.renderer.setRenderTarget(prevTarget);
    sunShadowUniforms.uSunShadowMap.value = target.texture;
    sunShadowUniforms.uSunShadowOn.value = 1;
    return true;
  },

  render() {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tRenderTotal0 = performance.now();
    this._gpuTimerPoll();
    this._gpuTimerBegin();

    // Toggles zmieniają się tylko z panelu/presetu — aplikuj przy zmianie,
    // nie co klatkę (w środku jest m.in. traverse całej sceny po światłach).
    if (this._passTogglesDirty) {
      this._applyPassToggles();
      this._passTogglesDirty = false;
    }

    // JEDYNY obchod grafu na klatke (scene.matrixWorldAutoUpdate = false w init).
    // Cale ustawianie transformow konczy sie przed ta linia: updateHexShips3D,
    // updateShields3D, syncProjectiles, EngineVfxSystem i systemy planet/ringu
    // chodza wczesniej w render() z index.html.
    this._syncSceneMatrices();

    const t = this.perfToggles || {};
    const bloomOn = t.bloom !== false;
    const freePerspective = this.isFreePerspectiveCamera();
    // Both effects below map 2D gameplay-space coordinates to screen UVs.
    // Disable them only for the experimental free 3D camera; bloom and the
    // shared ACES resolve remain fully active.
    // Widok skoku (warpWorldLens.js) wygasza shafty na klatkę — patrz suppressShadowShafts.
    const shaftCut = Number(this._shaftsSuppressed) || 0;
    this._shaftsSuppressed = 0;
    const raysEnabled = t.shadowShafts !== false && !freePerspective && shaftCut < 1;
    const heatEnabled = t.heatHaze !== false && !freePerspective;
    const shaftCfg = this._shaftCfg || resolveShadowShaftsQuality(this.shadowShaftsQuality);
    let isSplit = false;

    // Warstwy bez widocznej zawartości (flagi od właścicieli). Wolna kamera lotu
    // nad miastem widzi scenę inaczej niż culling planet — tam rysujemy wszystko.
    const layerActivity = freePerspective ? LAYERS_ALL_ACTIVE : this.layerActivity;
    isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;

    // Liczniki renderera zerujemy PRZED maską cieni, żeby jej quad trafił do
    // kubełka 'shafts' (pre-pass halo liczy się teraz w 'other').
    this.renderer.info.reset();
    this._resetRenderInfoBuckets();
    this._instrumentComposerPasses();

    // Maska widoczności słońca — PRZED pre-passem halo i passami sceny, bo
    // czytają ją materiały (kadłuby, tło, planety przy ringu, atmosfery).
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    this._renderSunShadowMask(raysEnabled && !!sun, sun, shaftCut, shaftCfg, isSplit);

    // Pre-pass halo tylko gdy planety są w ogóle renderowane — wcześniej te
    // 2 przejścia sceny wykonywały się ZAWSZE, nawet na ultrafast bez planet.
    // Ani gdy żadne ciało z poświatą nie jest w kadrze (bitwa w próżni): wtedy
    // pomijany jest też quad halo w _scenePasses, więc stary target nie wycieka.
    if (t.planetPass !== false && layerActivity.halo !== false && this.planetHaloTarget && this.planetHaloPass && this.haloDepthMaskMaterial) {
      const prevAutoClear = this.renderer.autoClear;
      const prevTarget = this.renderer.getRenderTarget();
      const prevClearAlpha = this.renderer.getClearAlpha();
      const prevClearColor = this._clearColorScratch;
      this.renderer.getClearColor(prevClearColor);
      const prevOverrideMaterial = this.scene.overrideMaterial;
      const prevPerspLayerMask = this.cameraPersp.layers.mask;

      const renderPlanetHaloViewport = (camData, vpX, vpY, vpW, vpH) => {
        this.renderer.setViewport(vpX, vpY, vpW, vpH);
        this.renderer.setScissor(vpX, vpY, vpW, vpH);
        this.renderer.setScissorTest(true);
        this.renderer.clear(true, true, true);

        this.syncCamera(camData, vpW, vpH, vpX);

        this.scene.overrideMaterial = this.haloDepthMaskMaterial;
        this.cameraPersp.layers.set(PLANET_RENDER_LAYER);
        this.renderer.render(this.scene, this.cameraPersp);

        this.scene.overrideMaterial = prevOverrideMaterial;
        this.cameraPersp.layers.set(PLANET_HALO_RENDER_LAYER);
        this.renderer.render(this.scene, this.cameraPersp);
      };

      this.renderer.autoClear = false;
      this.renderer.setRenderTarget(this.planetHaloTarget);
      this.renderer.setClearColor(0x000000, 0.0);

      isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;
      const haloW = this.planetHaloTarget.width;
      const haloH = this.planetHaloTarget.height;
      if (isSplit) {
        const halfW = Math.floor(haloW / 2);
        renderPlanetHaloViewport(this.activeCam1, 0, 0, halfW, haloH);
        renderPlanetHaloViewport(this.activeCam2, halfW, 0, haloW - halfW, haloH);
      } else {
        renderPlanetHaloViewport(this.activeCam1, 0, 0, haloW, haloH);
      }

      this.renderer.setScissorTest(false);
      this.renderer.setViewport(0, 0, haloW, haloH);
      this.scene.overrideMaterial = prevOverrideMaterial;
      this.cameraPersp.layers.mask = prevPerspLayerMask;
      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      this.renderer.autoClear = prevAutoClear;
      this.planetHaloPass.uniforms.tPlanetHalo.value = this.planetHaloTarget.texture;
    }

    // UberPost zawsze wlaczony — ACES tonemapping + linear→sRGB
    // Composer dziala nawet gdy bloom/heatHaze/shadowShafts sa off (passes disabled).
    this.renderer.toneMapping = THREE.NoToneMapping;

    const tBloom0 = dbgEnabled ? performance.now() : 0;
    if (this.bloomPass && bloomOn) this._applyBloomPassConfig();
    if (dbgEnabled) recordRenderDbg('coreBloomConfig', performance.now() - tBloom0);

    const tPost0 = dbgEnabled ? performance.now() : 0;
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;

    if (this.uberPass) {
      const uPost = this.uberPass.material.uniforms;
      const heatCount = heatEnabled ? Math.max(0, Math.min(this.heatHazeCount | 0, this.heatHazeMaxSources | 0)) : 0;
      uPost.uSourceCount.value = heatCount;
      uPost.uGlobalStrength.value = 1.0;
      // Zawinięty zegar szumu: przy uTime·9,9 po godzinie gry hash tracił
      // precyzję float32 (kanciasty szum). Skok wzoru co 10 min jest niewidoczny.
      uPost.uTime.value = nowSec % 600;
      if (uPost.uAspect) uPost.uAspect.value = this.width / Math.max(1, this.height);

      if (heatCount > 0) {
        const dst = uPost.uHeatSources.value;
        const dstDirs = uPost.uHeatDirs ? uPost.uHeatDirs.value : null;
        const src = this.heatHazeSources;
        const srcDirs = this.heatHazeDirs;
        for (let i = 0; i < heatCount; i++) {
          const base = i * 4;
          dst[i].set(src[base], src[base + 1], src[base + 2], src[base + 3]);
          if (dstDirs && srcDirs) dstDirs[i].set(srcDirs[i * 2], srcDirs[i * 2 + 1]);
        }
      }
      if (uPost.uWaveCount) {
        uPost.uWaveCount.value = heatEnabled ? this._packWarpWaves(uPost.uWaves.value, uPost.uWaveShape.value) : 0;
      }
      this._warpWaveCount = 0;
      // Kasujemy licznik przy KONSUMPCJI, nie u producenta. Wcześniej zerował go
      // każdy, kto zamierzał coś dorzucić: EngineVfxSystem na starcie swojego
      // update, a potem jeszcze reactorblow i rocketSystem3D z ticku overlaya —
      // czyli już PO tym passie. Efekt: źródła z wybuchów i rakiet nigdy nie
      // trafiały na ekran (kasował je najbliższy update silników), a zafalowania
      // od dysz znikały na czas eksplozji. Teraz producenci tylko dorzucają, a
      // pass zabiera wszystko, co uzbierało się od poprzedniej klatki.
      this.heatHazeCount = 0;
    }
    if (dbgEnabled) recordRenderDbg('coreUberSetup', performance.now() - tPost0);

    // Liczniki renderera wyzerowane na górze render() (przed maską cieni).
    const tComposer0 = performance.now();

    if (this.shockwave3DManager) {
      const shockDt = this._shockwavePrevTime > 0
        ? Math.max(1 / 240, Math.min(1 / 20, nowSec - this._shockwavePrevTime))
        : 1 / 60;
      this._shockwavePrevTime = nowSec;
      this.shockwave3DManager.update(shockDt);

      const hasActiveShockwaves = this.refractionTarget && this.shockwave3DManager.hasActive();
      if (!hasActiveShockwaves) this._refractionValid = false;
      this._refractionFlip = !this._refractionFlip;
      // Snapshot refrakcji odświeżany co drugą klatkę (pierwsza fala wymusza świeży)
      // — źródło szybkiego zniekształcenia nie potrzebuje 60 Hz, a każdy render
      // to pełne przejścia sceny.
      if (hasActiveShockwaves && (!this._refractionValid || this._refractionFlip)) {
        this._refractionValid = true;
        const prevAutoClear = this.renderer.autoClear;
        const prevTarget = this.renderer.getRenderTarget();
        const prevClearAlpha = this.renderer.getClearAlpha();
        const prevClearColor = this._clearColorScratch;
        this.renderer.getClearColor(prevClearColor);
        const prevPerspLayerMask = this.cameraPersp.layers.mask;
        const prevOrthoLayerMask = this.cameraOrtho.layers.mask;

        // Snapshot tylko tła + świata ortho. Warstwy planet/FG pomijamy — wewnątrz
        // zniekształcenia shockwave ich brak jest niezauważalny, a FG potrafi nieść
        // ~1000 draw calli (bronie/budynki), które tu dublowaliśmy przy każdej fali.
        const layers = [];
        if (t.bgPass !== false) layers.push({ layer: 1, ortho: false });
        if (t.orthoPass !== false) layers.push({ layer: 0, ortho: true });
        if (t.orthoPass !== false && layerActivity.shields !== false) layers.push({ layer: SHIELD_RENDER_LAYER, ortho: true });

        const renderRefractionViewport = (camData, vpX, vpY, vpW, vpH) => {
          this.renderer.setViewport(vpX, vpY, vpW, vpH);
          this.renderer.setScissor(vpX, vpY, vpW, vpH);
          this.renderer.setScissorTest(true);
          this.renderer.clear(true, true, true);
          this.syncCamera(camData, vpW, vpH, vpX);
          for (const { layer, ortho } of layers) {
            const cam = ortho ? this.cameraOrtho : this.cameraPersp;
            cam.layers.set(layer);
            // Mapa cienia z rzucającymi warstwy ortho (patrz autoUpdate w init()).
            if (layer === 0) this.renderer.shadowMap.needsUpdate = true;
            this.renderer.render(this.scene, cam);
          }
        };

        this.shockwave3DManager.hideAll();
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.refractionTarget);
        this.renderer.setClearColor(0x000000, 0.0);
        // Snapshot ma połowę rozdzielczości: materiały czytają maskę cieni po
        // gl_FragCoord, więc skala teksela idzie za celem (i wraca niżej).
        this._setSunShadowTexelFor(this.refractionTarget);
        this._readRenderInfoInto(this._renderInfoBefore);

        if (isSplit) {
          const rtW = this.refractionTarget.width;
          const rtH = this.refractionTarget.height;
          const halfW = Math.floor(rtW / 2);
          renderRefractionViewport(this.activeCam1, 0, 0, halfW, rtH);
          renderRefractionViewport(this.activeCam2, halfW, 0, rtW - halfW, rtH);
        } else {
          renderRefractionViewport(this.activeCam1, 0, 0, this.refractionTarget.width, this.refractionTarget.height);
        }
        this._addRenderInfoDelta('refraction');

        this.shockwave3DManager.showAll();
        this._setSunShadowTexelFor(this.composerTarget);
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.refractionTarget.width, this.refractionTarget.height);
        this.cameraPersp.layers.mask = prevPerspLayerMask;
        this.cameraOrtho.layers.mask = prevOrthoLayerMask;
        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);
        this.renderer.autoClear = prevAutoClear;
      }
    }

    // Soczewka skoku: przy aktywnej tło idzie do warpLensTarget, a warpLensPass
    // (następny w łańcuchu) kładzie je zakrzywione do composerTarget.
    const warpLensOn = this._prepareWarpLens(freePerspective, nowSec);

    // Scena → composerTarget (MSAA, bez pośrednich resolve), potem jedyny
    // resolve klatki (sceneResolvePass sampluje composerTarget) i post bez MSAA.
    const shadowMap = this.renderer.shadowMap;
    for (const pass of this._scenePasses) {
      if (!pass || pass.enabled === false) continue;
      // Pusty pass (planety poza kadrem, zero widocznych tarcz) = zero pracy.
      if (!this._scenePassHasContent(pass, layerActivity)) continue;
      // Shadow mapa tylko przed passami z rzucającymi: ortho i FG (stacje →
      // shadowCatcherFg). Pozostałe passy nie mają odbiorców w zasięgu kamery
      // cienia, a three kasuje needsUpdate po pierwszym renderze mapy.
      if (pass === this.renderPassOrtho || pass === this.renderPassFg) shadowMap.needsUpdate = true;
      const target = (warpLensOn && pass === this.renderPassBg) ? this.warpLensTarget : this.composerTarget;
      pass.render(this.renderer, null, target);
    }
    for (const pass of this._postPasses) {
      if (pass && pass.enabled !== false) pass.render(this.renderer, null, this.postTarget);
    }
    this.renderer.setRenderTarget(null);
    this._gpuTimerEnd();
    this._finalizeRenderInfoBuckets();
    const composerMs = performance.now() - tComposer0;
    this.lastFramePerf = {
      renderTotalMs: performance.now() - tRenderTotal0,
      composerMs
    };
    if (dbgEnabled) {
      recordRenderDbg('coreComposerRender', composerMs);
      recordRenderDbg('core3dRenderTotal', this.lastFramePerf.renderTotalMs);
    }
    // Expose renderer info for perf debugging — read with window.__rendererInfo
    if (typeof window !== 'undefined') {
      const info = this.lastFrameRenderInfo?.total || this.renderer.info.render;
      window.__rendererInfo = {
        calls: info.calls,
        triangles: info.triangles,
        points: info.points,
        lines: info.lines,
        passes: this.lastFrameRenderInfo
      };
    }
  },

  _renderDirect(dbgEnabled, tRenderTotal0) {
    const renderer = this.renderer;
    const isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;

    this._syncSceneMatrices();

    // ShaderMaterial outputuje wartosci sRGB bezposrednio - nie zmieniamy colorSpace.
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, true, true);

    const t = this.perfToggles || {};
    const layers = [];
    if (t.bgPass !== false) layers.push({ layer: 1, ortho: false });
    if (t.planetPass !== false) layers.push({ layer: PLANET_RENDER_LAYER, ortho: false });
    if (t.planetPass !== false) layers.push({ layer: RING_PLANET_RENDER_LAYER, ortho: true });
    layers.push({ layer: 0, ortho: true }); // ortho always
    layers.push({ layer: SHIELD_RENDER_LAYER, ortho: true });
    if (t.fgPass !== false) layers.push({ layer: 2, ortho: false });

    const renderLayers = (camData, vpX, vpY, vpW, vpH) => {
      renderer.setViewport(vpX, vpY, vpW, vpH);
      renderer.setScissor(vpX, vpY, vpW, vpH);
      renderer.setScissorTest(true);

      this.syncCamera(camData, vpW, vpH, vpX);

      for (const { layer, ortho } of layers) {
        const cam = ortho ? this.cameraOrtho : this.cameraPersp;
        cam.layers.set(layer);
        renderer.render(this.scene, cam);
      }
    };

    const w = renderer.domElement.width;
    const h = renderer.domElement.height;

    if (isSplit) {
      const halfW = Math.floor(w / 2);
      renderLayers(this.activeCam1, 0, 0, halfW, h);
      renderer.clear(false, true, false);
      renderLayers(this.activeCam2, halfW, 0, w - halfW, h);
    } else {
      renderLayers(this.activeCam1, 0, 0, w, h);
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.autoClear = true;

    this.lastFramePerf = {
      renderTotalMs: performance.now() - tRenderTotal0,
      composerMs: 0
    };
    if (dbgEnabled) {
      recordRenderDbg('coreComposerRender', 0);
      recordRenderDbg('core3dRenderTotal', this.lastFramePerf.renderTotalMs);
    }
  },

  renderSingle(gameCamera = null) {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tCall0 = dbgEnabled ? performance.now() : 0;
    const prevCam1 = this.activeCam1;
    const prevCam2 = this.activeCam2;
    if (gameCamera) this.activeCam1 = gameCamera;
    this.activeCam2 = null;
    this.render();
    this.activeCam1 = prevCam1;
    this.activeCam2 = prevCam2;
    if (dbgEnabled) recordRenderDbg('coreRenderCall', performance.now() - tCall0);
  },

  renderSplitScreen(cam1 = null, cam2 = null) {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tCall0 = dbgEnabled ? performance.now() : 0;
    const prevCam1 = this.activeCam1;
    const prevCam2 = this.activeCam2;
    if (cam1) this.activeCam1 = cam1;
    if (cam2) this.activeCam2 = cam2;
    this.render();
    this.activeCam1 = prevCam1;
    this.activeCam2 = prevCam2;
    if (dbgEnabled) recordRenderDbg('coreRenderCall', performance.now() - tCall0);
  },

  beginShaftDiscFrame() { this.shaftDiscCount = 0; },

  // Planety: updatePlanets3D kasuje flagi na starcie, a każde ciało widoczne
  // w kadrze zapala swoje warstwy (patrz layerActivity).
  beginPlanetLayerFrame() {
    const a = this.layerActivity;
    a.planets = false;
    a.halo = false;
    a.ringPlanets = false;
  },

  markPlanetLayersActive(ringAnchored = false, withHalo = true) {
    const a = this.layerActivity;
    if (ringAnchored) {
      a.ringPlanets = true;
      return;
    }
    a.planets = true;
    if (withHalo) a.halo = true;
  },

  setShieldLayerActive(active) { this.layerActivity.shields = !!active; },

  // Pass sceny bez widocznej zawartości pomijamy w całości.
  _scenePassHasContent(pass, activity) {
    if (pass === this.warpLensPass) return this._warpLensActive;
    if (pass === this.renderPassPlanets) return activity.planets !== false;
    if (pass === this.planetHaloPass) return activity.halo !== false;
    if (pass === this.renderPassRingPlanets) return activity.ringPlanets !== false;
    if (pass === this.renderPassShields) return activity.shields !== false;
    return true;
  },

  // Soczewka skoku w świecie gry (y w dół): środek, kąt osi lotu, promienie
  // wzdłuż/w poprzek osi w jednostkach świata, siła „połknięcia” (warpLens3D.js).
  // Gra zgłasza ją co klatkę PRZED Core3D.render (src/vfx/warpLensPass.js),
  // a bez soczewki woła clearWarpLens. Zgłoszenie jest w świecie, więc dwa
  // rendery podzielonego ekranu (renderSingle na kamerę) liczą je każdy dla siebie.
  setWarpLensWorld(worldX, worldY, angle, radiusAlong, radiusAcross, swallow) {
    const req = this._warpLensRequest;
    req.x = Number(worldX) || 0;
    req.y = Number(worldY) || 0;
    req.angle = Number(angle) || 0;
    req.radiusAlong = Number(radiusAlong) || 0;
    req.radiusAcross = Number(radiusAcross) || 0;
    req.swallow = Number(swallow) || 0;
    req.stampMs = performance.now();
  },

  clearWarpLens() { this._warpLensRequest.stampMs = -Infinity; },

  // Widok skoku (warpWorldLens.js) w świecie gry: środek kuli (statek), promień
  // kuli w px ekranu, β (0 = zwykły widok), kąt lotu; o: { phase (faza
  // przepływu, całkowana przez producenta), travel, blur, gain, fisheye, front,
  // band, drop } — front wyjścia w promieniach kuli wzdłuż osi lotu (przed nim
  // zwykły widok), drop = kształt { ua, ra, ub, rb } z warpDropGeometry (bez: koło).
  // Co klatkę przed renderem; zgłoszenie starsze niż 250 ms jest martwe.
  setWarpViewWorld(worldX, worldY, radiusPx, beta, angle, o = {}) {
    const r = this._warpViewReq;
    r.x = Number(worldX) || 0;
    r.y = Number(worldY) || 0;
    r.radiusPx = Math.max(0, Number(radiusPx) || 0);
    r.beta = Math.max(0, Math.min(1, Number(beta) || 0));
    r.angle = Number(angle) || 0;
    r.phase = Number(o.phase) || 0;
    if (Number.isFinite(o.travel)) r.travel = o.travel;
    if (Number.isFinite(o.blur)) r.blur = o.blur;
    if (Number.isFinite(o.gain)) r.gain = o.gain;
    if (Number.isFinite(o.fisheye)) r.fisheye = o.fisheye;
    // Front wyjścia (promienie kuli wzdłuż osi lotu); bez frontu = daleko przed statkiem.
    r.front = Number.isFinite(o.front) ? o.front : 1000;
    r.band = Number.isFinite(o.band) ? Math.max(0.01, o.band) : 0.35;
    const g = o.drop;
    const dropOk = g && g.ra > 0 && Number.isFinite(g.ua) && Number.isFinite(g.ub) && Number.isFinite(g.rb);
    r.dropUa = dropOk ? g.ua : 0;
    r.dropRa = dropOk ? g.ra : 1;
    r.dropUb = dropOk ? g.ub : 0;
    r.dropRb = dropOk ? g.rb : 1;
    r.stampMs = performance.now();
  },

  clearWarpView() { this._warpViewReq.stampMs = -Infinity; },

  // Widok skoku (soczewka świata): cienie shadow shafts liczą się z prawdziwego
  // słońca i prawdziwych pozycji — na przestawionych planetach kładłyby się
  // klinem (cień kadłuba, tarcze planet). Zgłaszać co klatkę PRZED
  // updateHexShips3D (budżet sylwetek) i Core3D.render; render zeruje flagę.
  // amount: 1 = pass pominięty, ułamek = cienie przygaszone (płynny powrót
  // przy wyjściu ze skoku zamiast wskoczenia smugi w jednej klatce).
  suppressShadowShafts(amount = 1) {
    const a = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 1;
    if (a > (this._shaftsSuppressed || 0)) this._shaftsSuppressed = a;
  },

  // Prymityw zgięcia tła na tę klatkę (warpLens3D.js: WARP_SPACE_TYPE) —
  // świat gry (y w dół), długości w jednostkach świata. Zgłaszać co klatkę
  // PRZED Core3D.render; pass zabiera wszystko i zeruje listę.
  pushWarpSpaceWorld(type, worldX, worldY, angle, a, b, strength) {
    const n = this._warpSpaceCount | 0;
    if (n >= this._warpSpaceReq.length) return false;
    const r = this._warpSpaceReq[n];
    r.type = type | 0;
    r.x = Number(worldX) || 0;
    r.y = Number(worldY) || 0;
    r.angle = Number(angle) || 0;
    r.a = Number(a) || 0;
    r.b = Number(b) || 0;
    r.strength = Number(strength) || 0;
    this._warpSpaceCount = n + 1;
    return true;
  },

  // Fala warpa w uberPassie (drga cała klatka, także kadłuby): typ 0 —
  // pierścień o promieniu `radius` i szerokości pasma `width`; typ 1 — szew
  // o połowie długości `radius`, zasięgu w poprzek `width` i osi `angle`;
  // typ 2 — łuk: pierścień tylko po stronie osi `angle` (fala dziobowa).
  // amp w jednostkach świata (przesunięcie obrazu). Co klatkę przed renderem.
  pushWarpWaveWorld(type, worldX, worldY, radius, width, amp, angle = 0) {
    const n = this._warpWaveCount | 0;
    if (n >= this._warpWaveReq.length) return false;
    if ((this.perfToggles?.heatHaze) === false) return false;
    const r = this._warpWaveReq[n];
    r.type = type | 0;
    r.x = Number(worldX) || 0;
    r.y = Number(worldY) || 0;
    r.radius = Number(radius) || 0;
    r.width = Number(width) || 0;
    r.amp = Number(amp) || 0;
    r.angle = Number(angle) || 0;
    this._warpWaveCount = n + 1;
    return true;
  },

  // Zgłoszone fale → uniformy uberPassa (osie v ekranu jak źródła haze).
  _packWarpWaves(outW, outS) {
    const n = Math.min(this._warpWaveCount | 0, MAX_WARP_WAVES, outW?.length || 0, outS?.length || 0);
    if (n <= 0) return 0;
    if (typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2) return 0;
    const cam = this.activeCam1;
    if (!cam || this.isFreePerspectiveCamera(cam)) return 0;
    const zoom = Math.max(1e-4, Number(cam.zoom) || 1);
    const w = Math.max(1, this.width || 1);
    const h = Math.max(1, this.height || 1);
    const k = zoom / h;
    const aspect = w / h;
    let written = 0;
    for (let i = 0; i < n; i++) {
      const r = this._warpWaveReq[i];
      const width = r.width * k;
      const amp = r.amp * k;
      if (!(width > 1e-6) || !(Math.abs(amp) > 1e-6)) continue;
      const u = 0.5 + (r.x - (Number(cam.x) || 0)) * zoom / w;
      const v = 0.5 + ((Number(cam.y) || 0) - r.y) * zoom / h;
      const radius = r.radius * k;
      const reach = r.type === 1 ? Math.max(radius, width * 3) : radius + width * 3;
      const cx = u * aspect;
      const dx = Math.max(0, -cx, cx - aspect);
      const dy = Math.max(0, -v, v - 1);
      if (dx * dx + dy * dy >= reach * reach) continue;
      outW[written].set(u, v, radius, amp);
      outS[written].set(r.type, width, Math.cos(r.angle), -Math.sin(r.angle));
      written++;
    }
    return written;
  },

  // Ustawia uniformy passa soczewki na tę klatkę; false = tło idzie jak zwykle.
  // Pass pracuje, gdy jest świeża soczewka skoku ALBO prymitywy zgięcia.
  _prepareWarpLens(freePerspective, nowSec) {
    this._warpLensActive = false;
    const nowMs = nowSec * 1000;
    // Nieużywany cel oddajemy po dłuższej przerwie (patrz WARP_LENS_TARGET_IDLE_MS).
    if (this.warpLensTarget && nowMs - this._warpLensLastUseMs > WARP_LENS_TARGET_IDLE_MS) {
      this.warpLensTarget.dispose();
      this.warpLensTarget = null;
    }
    const req = this._warpLensRequest;
    const primCount = this._warpSpaceCount | 0;
    this._warpSpaceCount = 0;
    const lensFresh = nowMs - req.stampMs <= WARP_LENS_STALE_MS;
    const view = this._warpViewReq;
    const viewFresh = nowMs - view.stampMs <= WARP_LENS_STALE_MS && view.beta > 0.001 && view.radiusPx > 1;
    if (!lensFresh && primCount <= 0 && !viewFresh) return false;
    const pass = this.warpLensPass;
    if (!pass || pass.enabled === false || !this.composerTarget) return false;
    // Wolna kamera 3D nie ma mapowania świat→ekran passów 2D. Dwa widoki
    // w jednym renderze (renderSplitScreen) dzieliłyby jedną soczewkę na obie
    // połówki — tam jej nie ma; drawHexShips3D renderuje split jako dwa renderSingle.
    if (freePerspective) return false;
    if (typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2) return false;

    // Kamery passów liczą widok z rozmiaru celu w pikselach bufora — mapowanie
    // soczewki musi iść z tych samych liczb, żeby środek trafił w kadłub.
    const bufW = this.composerTarget.width;
    const bufH = this.composerTarget.height;
    const u = this._warpLensUniformScratch;
    const lu = pass.uniforms;
    const lensOn = lensFresh && computeWarpLensUniforms(req, this.activeCam1, bufW, bufH, u);
    const prims = (primCount > 0 && lu.uPrimA && lu.uPrimB)
      ? packWarpSpacePrims(this._warpSpaceReq, primCount, this.activeCam1, bufW, bufH, lu.uPrimA.value, lu.uPrimB.value)
      : 0;
    const viewOn = viewFresh && !!lu.uWV && !!this.activeCam1;
    if (!lensOn && prims <= 0 && !viewOn) return false;

    const target = this._ensureWarpLensTarget(bufW, bufH);
    lu.tSource.value = target.texture;
    if (lensOn) {
      lu.uCenter.value.set(u.centerU, u.centerV);
      lu.uAxis.value.set(u.axisX, u.axisY);
      lu.uRadius.value.set(u.radiusAlong, u.radiusAcross);
      lu.uAspect.value = u.aspect;
      lu.uSwallow.value = u.swallow;
    } else {
      // Same prymitywy: soczewka skoku poza kadrem, bez połknięcia (tożsamość).
      lu.uCenter.value.set(-10, -10);
      lu.uAxis.value.set(1, 0);
      lu.uRadius.value.set(1, 1);
      lu.uAspect.value = bufW / Math.max(1, bufH);
      lu.uSwallow.value = 0;
    }
    if (lu.uPrimCount) lu.uPrimCount.value = prims;
    if (lu.uWV) {
      if (viewOn) {
        // Świat → UV jak reszta passów tła: zoom = px ekranu (CSS) na jednostkę.
        const cam = this.activeCam1;
        const zoom = Math.max(1e-4, Number(cam.zoom) || 1);
        const cw = Math.max(1, this.width || bufW);
        const ch = Math.max(1, this.height || bufH);
        lu.uWV.value.set(
          0.5 + (view.x - (Number(cam.x) || 0)) * zoom / cw,
          0.5 + ((Number(cam.y) || 0) - view.y) * zoom / ch,
          view.radiusPx / ch,
          view.beta
        );
        const ph = view.phase - Math.floor(view.phase);
        lu.uWVFlow.value.set(Math.cos(view.angle), -Math.sin(view.angle), ph, (ph + 0.5) % 1);
        lu.uWVMisc.value.set(view.travel, view.blur, view.gain, view.fisheye);
        if (lu.uWVFront) lu.uWVFront.value.set(view.front, view.band, 0, 0);
        if (lu.uWVDrop) lu.uWVDrop.value.set(view.dropUa, view.dropRa, view.dropUb, view.dropRb);
        if (!lensOn) lu.uAspect.value = cw / ch;
      } else {
        lu.uWV.value.w = 0;
      }
    }
    this._warpLensLastUseMs = nowMs;
    this._warpLensActive = true;
    return true;
  },

  _ensureWarpLensTarget(width, height) {
    let rt = this.warpLensTarget;
    if (!rt) {
      // Bez MSAA (mgławica i gwiazdy nie mają krawędzi do wygładzania), za to
      // z mipmapami: przy środku soczewka ściska tło stycznie i bez nich
      // gwiazdy iskrzyłyby. Lustrzane zawijanie — soczewka ściąga obraz spoza
      // kadru (przy bliskim zoomie), a lustro mgławicy czyta się jak mgławica;
      // CLAMP rozmazywał krawędź ekranu w smugi.
      rt = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
        samples: 0,
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
        magFilter: THREE.LinearFilter
      });
      rt.texture.wrapS = THREE.MirroredRepeatWrapping;
      rt.texture.wrapT = THREE.MirroredRepeatWrapping;
      rt.texture.anisotropy = Math.max(1, Math.min(8, Number(this.renderer.capabilities.getMaxAnisotropy?.()) || 1));
      this.warpLensTarget = rt;
    } else if (rt.width !== width || rt.height !== height) {
      rt.setSize(width, height);
    }
    return rt;
  },

  beginShaftHullFrame() { this.shaftHullCount = 0; },

  // Ile kadłubów przyjmie pass shaftów w tej klatce. hexShips3D staje na
  // tej liczbie — nie ma sensu piec sylwetek, których pass i tak nie weźmie
  // (ani żadnych, gdy shafty są wyłączone albo leci wolna kamera).
  getShaftHullBudget() {
    const t = this.perfToggles || {};
    if (t.shadowShafts === false || this.isFreePerspectiveCamera() || this._shaftsSuppressed >= 1) return 0;
    const cfg = this._shaftCfg || resolveShadowShaftsQuality(this.shadowShaftsQuality);
    if (cfg.enabled === false) return 0;
    return Math.max(0, Math.min(SHAFT_HULL_CAP, Number(cfg.capsuleBudget) || SHAFT_HULL_CAP));
  },

  // Kadłub jako okluder SDF: HULL_SDF_OCCLUDER_FLOATS liczb z
  // packHullShaftOccluder (hullShadowSdf.js), już w three-space. hexShips3D
  // zgłasza co klatkę od największych statków; false = rejestr pełny.
  pushShaftHullSdf(packed, offset = 0) {
    const i = this.shaftHullCount | 0;
    if (i >= SHAFT_HULL_CAP || !packed || !this.shaftHulls) return false;
    const base = i * HULL_SDF_OCCLUDER_FLOATS;
    for (let k = 0; k < HULL_SDF_OCCLUDER_FLOATS; k++) this.shaftHulls[base + k] = packed[offset + k];
    this.shaftHullCount = i + 1;
    return true;
  },

  // Tablica warstw SDF kadłubów (HullShadowSdf.texture) — przypisywana do
  // uniformu w render(), bo materiał passa trzyma klony uniformów.
  setShaftHullSdfTexture(texture) { this.shaftHullTexture = texture || null; },

  // Pierścień (ring city) jako analityczny okrąg-okluder. Rejestrowany po
  // kluczu ringu (bez begin/reset — ring aktualizuje swój wpis co klatkę,
  // a przy dispose go zdejmuje), więc cień działa też przy ukrytych
  // wizualiach ringu (dystansowy gate).
  setShaftRingOccluder(key, cx, cy, radius, reach) {
    if (!key || !(Number(radius) > 0)) return;
    let rec = this.shaftRings.get(key);
    if (!rec) { rec = { x: 0, y: 0, r: 0, reach: 1 }; this.shaftRings.set(key, rec); }
    rec.x = Number(cx) || 0;
    rec.y = -(Number(cy) || 0);
    rec.r = Number(radius) || 0;
    rec.reach = Math.max(1, Number(reach) || 1);
  },

  removeShaftRingOccluder(key) { if (key) this.shaftRings.delete(key); },

  // Tarcza planety/księżyca (współrzędne GRY, y w dół) jako analityczny
  // okluder shaftów — zgłaszana co klatkę, także gdy ciało jest poza ekranem
  // (cień musi istnieć niezależnie od kadru i zoomu). strength < 1 dla ciał,
  // które mają tylko przygaszać scenę zamiast robić umbrę (asteroidy).
  pushShaftDiscWorld(worldX, worldY, radius, strength = 1) {
    const r = Number(radius) || 0;
    if (!(r > 0) || !this.shaftDiscs) return false;
    const i = this.shaftDiscCount | 0;
    if (i >= SHAFT_DISC_CAP) return false;
    const base = i * 4;
    this.shaftDiscs[base] = Number(worldX) || 0;
    this.shaftDiscs[base + 1] = -(Number(worldY) || 0);
    this.shaftDiscs[base + 2] = r;
    const s = Number(strength);
    this.shaftDiscs[base + 3] = Number.isFinite(s) ? Math.max(0, Math.min(1, s)) : 1;
    this.shaftDiscCount = i + 1;
    return true;
  },

  // Wgrywanie tekstur w tle: po jednej w wolnej chwili (requestIdleCallback),
  // zamiast przy pierwszym renderze obiektu w kadrze. Planety 8192×4096 dawały
  // w tej klatce upload 128 MB + mipmapy (Ziemia: pięć takich naraz). Jeśli
  // obiekt wejdzie w kadr wcześniej, three wgra teksturę samo, jak dotąd —
  // initTexture na wgranej teksturze tylko ją wiąże.
  _textureUploadQueue: [],
  _textureUploadScheduled: false,
  queueTextureUpload(texture) {
    if (!texture || texture.isRenderTargetTexture) return;
    if (this._textureUploadQueue.includes(texture)) return;
    this._textureUploadQueue.push(texture);
    // Zwolniona przed uploadem = wypada z kolejki (initTexture wgrałoby ją
    // ponownie i zostawiło w VRAM bez właściciela).
    texture.addEventListener('dispose', this._onQueuedTextureDispose);
    this._scheduleTextureUpload();
  },
  _onQueuedTextureDispose(event) {
    const texture = event.target;
    texture.removeEventListener('dispose', Core3D._onQueuedTextureDispose);
    const queue = Core3D._textureUploadQueue;
    const idx = queue.indexOf(texture);
    if (idx >= 0) queue.splice(idx, 1);
  },
  _scheduleTextureUpload() {
    if (this._textureUploadScheduled || this._textureUploadQueue.length === 0) return;
    this._textureUploadScheduled = true;
    const run = () => this._pumpTextureUpload();
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 100);
  },
  _pumpTextureUpload() {
    this._textureUploadScheduled = false;
    const texture = this._textureUploadQueue.shift();
    if (texture) {
      texture.removeEventListener('dispose', this._onQueuedTextureDispose);
      const image = texture.image;
      if (this.renderer && image && image.complete !== false) {
        try {
          this.renderer.initTexture(texture);
        } catch (err) {
          console.warn('[Core3D] Wstępny upload tekstury nie wyszedł — wgra się przy renderze:', err);
        }
      }
    }
    this._scheduleTextureUpload();
  },

  // Zostawione dla zgodności — licznik kasuje teraz pass w render(). Wołanie
  // tego z kodu producenta kasuje cudze źródła z tej klatki.
  beginHeatHazeFrame() { this.heatHazeCount = 0; },
  
  pushHeatHazeWorld(worldX, worldY, worldZ = -4, radiusWorld = 80, strength = 1.0, dirWorldX = 0, dirWorldY = 0) {
    if (!this.isInitialized || !this.heatHazeSources || !this.cameraOrtho) return false;
    if ((this.perfToggles?.heatHaze) === false) return false;
    // Bufor źródeł pełny: nic już nie trafi do passu. Dysze wołają to dla każdej
    // dyszy co klatkę, więc wychodzimy przed jakimkolwiek liczeniem.
    if ((this.heatHazeCount | 0) >= (this.heatHazeMaxSources | 0)) return false;

    // Kierunek wydechu w przestrzeni sceny; (0,0) => zrodlo izotropowe (eksplozje).
    let dirX = Number(dirWorldX) || 0;
    let dirY = Number(dirWorldY) || 0;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen > 0.0001) { dirX /= dirLen; dirY /= dirLen; } else { dirX = 0; dirY = 0; }

    const isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;
    if (isSplit) {
      this._pushHeatHazeForCamera(this.activeCam1, true, false, worldX, worldY, radiusWorld, strength, dirX, dirY);
      this._pushHeatHazeForCamera(this.activeCam2, true, true, worldX, worldY, radiusWorld, strength, dirX, dirY);
    } else {
      this._pushHeatHazeForCamera(this.activeCam1, false, false, worldX, worldY, radiusWorld, strength, dirX, dirY);
    }

    return true;
  },

  // Metoda zamiast dwóch domknięć tworzonych przy każdym pushHeatHazeWorld.
  _pushHeatHazeForCamera(camData, isSplit, isRightSide, worldX, worldY, radiusWorld, strength, dirX, dirY) {
    const zoom = Math.max(0.0001, camData.zoom || 1);
    const camW = isSplit ? this.width / 2 : this.width;
    const camH = this.height;
    const halfW = camW / 2 / zoom;
    const halfH = camH / 2 / zoom;

    const left = camData.x - halfW;
    const bottom = -(camData.y) - halfH;

    const worldW = halfW * 2;
    const worldH = halfH * 2;

    let u = (worldX - left) / worldW;
    const v = (worldY - bottom) / worldH;
    // Promien w jednostkach osi v: shader koryguje os u przez uAspect,
    // wiec mapowanie swiat->ekran jest izotropowe (takze w split-screen).
    const rUv = radiusWorld / worldH;
    // Źródło o promieniu poniżej ~1,5 px nie zniekształca niczego widocznego,
    // a zajmuje jeden z 24 slotów (daleki zoom, mała jednostka).
    if (rUv * camH < 1.5) return;

    // Dysza (kierunek != 0): rUv = promień WYLOTU, a przesunięcie w shaderze
    // jest ~0,12 promienia na ekranie — samo skaluje się z zoomem, więc bez
    // dodatkowego mnożnika. Poniżej ~3 px promienia drganie < 0,3 px: nie
    // zajmujemy slotu. Izotropowe źródła jak dawniej.
    const isNozzle = dirX !== 0 || dirY !== 0;
    if (isNozzle && rUv * camH < 3) return;
    const zoomNow = Math.max(0.0001, camW / worldW);
    const ampZoomScale = Math.max(0.22, Math.min(1.0, zoomNow));
    const amp = isNozzle ? strength : strength * ampZoomScale;

    if (isSplit) {
      u = isRightSide ? (u * 0.5 + 0.5) : (u * 0.5);
    }

    // Stożek dyszy sięga 7,2 R w dół wydechu (2,6 R w bok), źródło izotropowe
    // ~3,4 promienia — cullujemy z zapasem.
    const reach = rUv * (isNozzle ? 7.4 : 3.4);
    if (u < -reach || u > 1.0 + reach || v < -reach || v > 1.0 + reach) return;
    const maxSources = this.heatHazeMaxSources | 0;
    if (this.heatHazeCount >= maxSources) return;
    const outBase = this.heatHazeCount * 4;
    this.heatHazeSources[outBase + 0] = u;
    this.heatHazeSources[outBase + 1] = v;
    this.heatHazeSources[outBase + 2] = rUv;
    this.heatHazeSources[outBase + 3] = amp;
    if (this.heatHazeDirs) {
      const dirBase = this.heatHazeCount * 2;
      this.heatHazeDirs[dirBase + 0] = dirX;
      this.heatHazeDirs[dirBase + 1] = dirY;
    }
    this.heatHazeCount++;
  },

  pushGodRayWorld() { },
  setShadowCatchersDebug(enabled = true) { },
  toggleShadowCatchersDebug() { }
};
