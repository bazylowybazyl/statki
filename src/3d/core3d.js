// src/3d/core3d.js
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BLOOM_DEFAULTS } from './bloomConfig.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Shockwave3DManager } from '../effects3d/shockwave3D.js';

const MAX_HEAT_HAZE_SOURCES = 24;
const PLANET_RENDER_LAYER = 3;
const OCCLUSION_RENDER_LAYER = 4;
const PLANET_HALO_RENDER_LAYER = 5;
const RING_PLANET_RENDER_LAYER = 6;
// Okludery rysowane kamerą ORTHO do maski shaftów (pasmo ringu, kadłuby
// statków) — layer 4 renderuje się kamerą persp, więc obiekty ekranowo-ortho
// muszą mieć własną warstwę, inaczej maska rozjeżdża się z tym, co widać na
// ekranie. Planety/księżyce NIE idą do maski: są liczone analitycznie jako
// dyski (uDiscs) — maska screen-space nie obejmuje okluderów poza kadrem
// i gubi cień planety przy przybliżeniu kamery.
const OCCLUSION_ORTHO_RENDER_LAYER = 7;
// Okludery-sprite'y (quad z alfą sylwetki, np. armor-LOD statku): renderowane
// do maski WŁASNYM materiałem (bez białego override'u), bo override zamieniłby
// quad w pełny prostokąt. Obiekty na tej warstwie NIE renderują się nigdzie
// indziej (layers.set, nie enable).
const OCCLUSION_SPRITE_RENDER_LAYER = 8;
// Jak wyżej, ale renderowane kamerą PERSP (np. asteroidy, które żyją
// w passie FG na layer 2 — ich sylwetka musi być rzutowana tą samą kamerą).
const OCCLUSION_SPRITE_PERSP_RENDER_LAYER = 9;
// Maks. liczba tarcz (planety + księżyce) zgłaszanych per klatkę przez
// pushShaftDiscWorld do analitycznych cieni w shaderze shaftów.
const SHAFT_DISC_CAP = 16;

// Poziomy jakości shadow shafts. `high` = parametry sprzed nerfa
// wydajnościowego z 2026-03 (50 sampli, maska /2, overscan 3.0) + dłuższe
// smugi. `off` trzyma parametry low, żeby ręczne włączenie passa booleanem
// (Core3DPerf/godRays) miało sensowną konfigurację.
// lengthWorld dotyczy TYLKO marszu po masce (statki + ring) — planety maja
// wlasne analityczne dyski (discLenMul). Krotszy marsz = gestsze kroki =
// wieksza szansa trafienia malego kadluba przy oddalonej kamerze.
export const SHADOW_SHAFTS_QUALITY = {
  off: { enabled: false, samples: 10, resDiv: 8, overscan: 1.2, lengthWorld: 12000, maxLenUv: 0.8, blurRadius: 3.5, discLenMul: 10 },
  low: { enabled: true, samples: 10, resDiv: 8, overscan: 1.2, lengthWorld: 12000, maxLenUv: 0.8, blurRadius: 3.5, discLenMul: 10 },
  medium: { enabled: true, samples: 24, resDiv: 4, overscan: 1.8, lengthWorld: 24000, maxLenUv: 1.0, blurRadius: 3.0, discLenMul: 18 },
  high: { enabled: true, samples: 50, resDiv: 2, overscan: 3.0, lengthWorld: 60000, maxLenUv: 1.5, blurRadius: 2.5, discLenMul: 30 }
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
      uOcclusionMap: { value: null },
      uTime: { value: 0 },
      uSplitScreen: { value: 0 },
      uSunDirection: { value: new THREE.Vector2(1.0, 0.0) },
      uSunDirection2: { value: new THREE.Vector2(1.0, 0.0) },
      uShadowLength: { value: 1.0 },
      uShadowDarkness: { value: 1.8 },
      uLengthMul: { value: 1.2 },
      uShadowDecay: { value: 0.935 },
      uShadowJitter: { value: 0.4 },
      uAspectRatio: { value: 1.0 },
      uOverscan: { value: 1.2 },
      uSunWorld: { value: new THREE.Vector2(0, 0) },
      uCamCenter: { value: new THREE.Vector2(0, 0) },
      uCamCenter2: { value: new THREE.Vector2(0, 0) },
      uViewWorldSize: { value: new THREE.Vector2(1, 1) },
      uViewWorldSize2: { value: new THREE.Vector2(1, 1) },
      uDiscLenMul: { value: 18.0 },
      uDiscCount: { value: 0 },
      uDiscs: { value: Array.from({ length: SHAFT_DISC_CAP }, () => new THREE.Vector4(0, 0, 0, 0)) }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      precision highp float;
      uniform sampler2D uOcclusionMap;
      uniform float uTime;
      uniform int uSplitScreen;
      uniform vec2 uSunDirection;
      uniform vec2 uSunDirection2;
      uniform float uShadowLength;
      uniform float uShadowDarkness;
      uniform float uLengthMul;
      uniform float uShadowDecay;
      uniform float uShadowJitter;
      uniform float uAspectRatio;
      uniform float uOverscan;
      uniform vec2 uSunWorld;
      uniform vec2 uCamCenter;
      uniform vec2 uCamCenter2;
      uniform vec2 uViewWorldSize;
      uniform vec2 uViewWorldSize2;
      uniform float uDiscLenMul;
      uniform int uDiscCount;
      uniform vec4 uDiscs[${SHAFT_DISC_CAP}];
      varying vec2 vUv;

      #ifndef NUM_SAMPLES
      #define NUM_SAMPLES 10
      #endif

      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

      void main() {
        vec2 dirVec = (uSplitScreen == 1 && vUv.x > 0.5) ? uSunDirection2 : uSunDirection;
        if(length(dirVec) < 0.001) {
          gl_FragColor = vec4(1.0);
          return;
        }

        vec2 dir = normalize(vec2(dirVec.x, dirVec.y * uAspectRatio));
        vec2 occUv;
        if (uSplitScreen == 1) {
          if (vUv.x < 0.5) {
            vec2 localOcc = (vec2(vUv.x * 2.0, vUv.y) - 0.5) / uOverscan + 0.5;
            occUv = vec2(localOcc.x * 0.5, localOcc.y);
          } else {
            vec2 localOcc = (vec2((vUv.x - 0.5) * 2.0, vUv.y) - 0.5) / uOverscan + 0.5;
            occUv = vec2(localOcc.x * 0.5 + 0.5, localOcc.y);
          }
        } else {
          occUv = (vUv - 0.5) / uOverscan + 0.5;
        }

        vec2 stepVec = dir * (((uShadowLength * uLengthMul) / uOverscan) / float(NUM_SAMPLES));
        float jitter = (hash12(vUv * vec2(191.13, 137.71) + uTime) - 0.5) * uShadowJitter;
        // Start POL KROKU W STRONE SLONCA (dawniej -0.35 wstecz): piksel nie
        // sampluje wlasnego okludera, wiec naslonecznina strona statku zostaje
        // jasna, a cien zaczyna sie od srodka/tylu kadluba ("pol na pol").
        vec2 sampleUv = occUv + stepVec * (jitter + 0.5);

        // Akumulacja MAX zamiast sredniej wazonej: srednia po calym marszu
        // karala okludery mniejsze niz krok (statek = ulamek kroku przy
        // oddalonej kamerze -> cien znikal). Jedno trafienie w kadlub daje
        // pelny cien; o dlugosci smugi decyduje falloff od odleglosci,
        // znormalizowany do 24 krokow referencyjnych (ta sama krzywa na
        // kazdym poziomie jakosci NUM_SAMPLES).
        float shadowAccum = 0.0;
        float falloff = 1.0;
        float stepFalloff = pow(uShadowDecay, 24.0 / float(NUM_SAMPLES));

        for(int i = 0; i < NUM_SAMPLES; i++) {
          if(sampleUv.x < 0.0 || sampleUv.x > 1.0 || sampleUv.y < 0.0 || sampleUv.y > 1.0) break;
          shadowAccum = max(shadowAccum, texture2D(uOcclusionMap, sampleUv).r * falloff);
          falloff *= stepFalloff;
          sampleUv += stepVec;
        }

        float marchShadow = clamp(shadowAccum * uShadowDarkness, 0.0, 1.0);

        // Analityczne cienie tarcz planet/ksiezycow w world-space: dzialaja na
        // kazdym zoomie i dla okluderow daleko poza kadrem (maska screen-space
        // nie ma szans ich objac). Wnetrze tarczy pomijane (along <= exitDist),
        // wiec dzienna strona planety zostaje przy wlasnym oswietleniu.
        bool rightHalf = (uSplitScreen == 1 && vUv.x > 0.5);
        vec2 localUv = (uSplitScreen == 1)
          ? (rightHalf ? vec2((vUv.x - 0.5) * 2.0, vUv.y) : vec2(vUv.x * 2.0, vUv.y))
          : vUv;
        vec2 camC = rightHalf ? uCamCenter2 : uCamCenter;
        vec2 viewWS = rightHalf ? uViewWorldSize2 : uViewWorldSize;
        vec2 worldP = camC + (localUv - 0.5) * viewWS;

        float discShadow = 0.0;
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
          float along = dot(rel, axis);
          if (along <= 0.0) continue;
          float perp = abs(dot(rel, vec2(-axis.y, axis.x)));
          float exitDist = sqrt(max(discR * discR - perp * perp, 0.0));
          if (along <= exitDist) continue;
          float fallT = clamp((along - exitDist) / max(discR * uDiscLenMul, 1.0), 0.0, 1.0);
          float fall = 1.0 - smoothstep(0.55, 1.0, fallT);
          float soft = discR * (0.04 + 0.30 * fallT);
          float edge = 1.0 - smoothstep(discR - soft, discR + soft, perp);
          discShadow = max(discShadow, edge * fall);
        }

        float rawShadow = clamp(max(marchShadow, discShadow), 0.0, 1.0);
        // Pass może wyłącznie przyciemniać piksele pod smugą. Dodawanie stałej
        // poświaty tutaj robiło pełnoekranową szarą mgłę niezależną od pozycji.
        gl_FragColor = vec4(mix(vec3(1.0), vec3(0.06, 0.10, 0.16), rawShadow), 1.0);
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

// dst.rgb = dst.rgb × src.rgb, alpha bez zmian. NIE używać THREE.MultiplyBlending:
// w three r183 daje efekt addytywny (zweryfikowane odczytem pikseli) — stąd jawne
// faktory ZERO/SRC_COLOR przez CustomBlending.
const BLEND_MULTIPLY_SCENE = {
  blending: THREE.CustomBlending,
  blendEquation: THREE.AddEquation,
  blendSrc: THREE.ZeroFactor,
  blendDst: THREE.SrcColorFactor,
  blendEquationAlpha: THREE.AddEquation,
  blendSrcAlpha: THREE.ZeroFactor,
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
    uHeatDirs: { value: Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new THREE.Vector2(0, 0)) }
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

    float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); float a = hash12(i); float b = hash12(i + vec2(1.0, 0.0)); float c = hash12(i + vec2(0.0, 1.0)); float d = hash12(i + vec2(1.0, 1.0)); vec2 u = f * f * (3.0 - 2.0 * f); return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y; }
    #endif

    void main() {
      vec2 uv = vUv;
      vec2 distortion = vec2(0.0);

      #ifdef HEAT_HAZE
      // Przestrzen skorygowana aspektem: dystanse izotropowe na ekranie
      // (radius zrodla jest w jednostkach osi v).
      vec2 asp = vec2(uAspect, 1.0);

      for (int i = 0; i < ${MAX_HEAT_HAZE_SOURCES}; i++) {
        if (i >= uSourceCount) break;
        vec4 src = uHeatSources[i];
        float radius = max(0.0001, src.z);
        vec2 p = (uv - src.xy) * asp;

        float maxExt = radius * 3.4;
        if (abs(p.x) > maxExt || abs(p.y) > maxExt) continue;

        // dir = kierunek wydechu w przestrzeni ekranu; (0,0) => zrodlo izotropowe
        // (eksplozje). Dla dyszy haze wydluza sie w stozek wzdluz osi.
        vec2 dir = uHeatDirs[i];
        float hasDir = step(0.25, dot(dir, dir));
        vec2 axis = mix(vec2(0.0, 1.0), dir, hasDir);
        vec2 perpAxis = vec2(-axis.y, axis.x);

        float along = dot(p, axis);
        float across = dot(p, perpAxis);

        float downLen = radius * mix(1.0, 3.2, hasDir);
        float upLen = radius * mix(1.0, 0.55, hasDir);
        float tAlong = clamp(along / downLen, 0.0, 1.0);
        float halfWidth = radius * mix(1.0, mix(0.55, 1.25, tAlong), hasDir);

        vec2 q = vec2(along / (along >= 0.0 ? downLen : upLen), across / max(0.0001, halfWidth));
        float t = length(q);
        if (t >= 1.0) continue;

        // Drobny szum adwektowany w dol smugi (uklad lokalny dyszy),
        // dwie niezalezne skladowe zamiast pierscieni sin() i szwow fract().
        vec2 nc = vec2(across, along) * (3.0 / radius);
        nc.y -= uTime * mix(2.2, 9.5, hasDir);
        nc.x += float(i) * 5.19;
        float n1 = noise(nc) * 0.65 + noise(nc * 2.17 + 11.3) * 0.35;
        float n2 = noise(nc * 1.31 + vec2(5.2, 8.7)) * 0.65 + noise(nc * 2.9 + vec2(1.7, 9.2)) * 0.35;
        vec2 wob = vec2(n1, n2) - 0.5;

        float fall = smoothstep(1.0, 0.15, t) * smoothstep(0.0, 0.1, t);
        float ampl = src.w * fall * uGlobalStrength;

        // "Kop" tylko dla dysz; izotropowe eksplozje zostaja przy bazowej sile.
        float punch = mix(1.0, 3.0, hasDir);
        vec2 disp = (perpAxis * (wob.x * 1.4) + axis * (wob.y * 0.6)) * (0.0035 * punch * ampl);
        distortion += disp / asp;
      }
      distortion = clamp(distortion, vec2(-0.022), vec2(0.022));
      #endif
      
      vec4 sceneColor = texture2D(tDiffuse, uv + distortion);
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

function makeSplitScreenRenderPass(pass, layerId, isOrtho, doClearColor) {
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
          } else {
              renderer.clear(false, true, false);
          }

          // KLUCZ: Przekazujemy halfW, aby aspekt kamery wynosiĹ‚ (halfW / th)
          Core3D.syncCamera(Core3D.activeCam1, halfW, th, 0);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);

          // GRACZ 2 (Prawa poĹ‚Ăłwka)
          renderer.setViewport(halfW, 0, tw - halfW, th);
          renderer.setScissor(halfW, 0, tw - halfW, th);
          if (doClearColor) {
              renderer.setClearColor(0x000000, 0.0);
              renderer.clear(true, true, true);
          } else {
              renderer.clear(false, true, false);
          }

          Core3D.syncCamera(Core3D.activeCam2, halfW, th, halfW);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
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
          } else {
              renderer.clear(false, true, false);
          }
          Core3D.syncCamera(Core3D.activeCam1, tw, th, 0);
          this.camera = isOrtho ? Core3D.cameraOrtho : Core3D.cameraPersp;
          this.camera.layers.set(layerId);
          renderer.render(this.scene, this.camera);
      }
      renderer.setClearColor(oldCol, oldAlpha);
      renderer.autoClear = oldAutoClear;
  };
}

function createSeparableBlurMaterial(direction = new THREE.Vector2(1, 0)) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uDirection: { value: direction.clone() },
      uRadius: { value: 4.0 }
    },
    vertexShader: `precision highp float; varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse; uniform vec2 uResolution; uniform vec2 uDirection; uniform float uRadius; void main() { vec2 off = (uDirection * uRadius) / max(vec2(1.0), uResolution); vec4 sum = vec4(0.0); sum += texture2D(tDiffuse, vUv - off * 4.0) * 0.05; sum += texture2D(tDiffuse, vUv - off * 3.0) * 0.09; sum += texture2D(tDiffuse, vUv - off * 2.0) * 0.12; sum += texture2D(tDiffuse, vUv - off * 1.0) * 0.15; sum += texture2D(tDiffuse, vUv) * 0.18; sum += texture2D(tDiffuse, vUv + off * 1.0) * 0.15; sum += texture2D(tDiffuse, vUv + off * 2.0) * 0.12; sum += texture2D(tDiffuse, vUv + off * 3.0) * 0.09; sum += texture2D(tDiffuse, vUv + off * 4.0) * 0.05; gl_FragColor = sum; }`,
    blending: THREE.NoBlending, transparent: false, depthTest: false, depthWrite: false
  });
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

  occlusionTarget: null, occlusionWhiteMaterial: null,
  occlusionBlurTargetA: null, occlusionBlurTargetB: null,
  occlusionBlurScene: null, occlusionBlurCamera: null, occlusionBlurQuad: null,
  occlusionBlurMatH: null, occlusionBlurMatV: null,

  renderPassBg: null, renderPassPlanets: null, planetHaloPass: null, renderPassRingPlanets: null, renderPassOrtho: null, renderPassFg: null,
  heatHazeSources: null, heatHazeDirs: null, heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, _heatHazeWorldScratch: new THREE.Vector3(),
  shadowShaftsPass: null,
  shaftDiscs: new Float32Array(SHAFT_DISC_CAP * 3), shaftDiscCount: 0,
  uberPass: null,
  bloomPass: null, bloomResolutionScale: BLOOM_DEFAULTS.resolutionScale, bloomBaseStrength: BLOOM_DEFAULTS.strength, bloomBaseThreshold: BLOOM_DEFAULTS.threshold,
  msaaSamples: 0,
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
    return { calls: 0, triangles: 0, points: 0, lines: 0 };
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

  _addRenderInfoDelta(bucketName, before = this._renderInfoBefore) {
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
      const result = originalRender.apply(this, args);
      core._addRenderInfoDelta(bucketName);
      return result;
    };
    pass.__core3dRenderInfoWrapped = true;
    pass.__core3dRenderInfoBucket = bucketName;
  },

  _instrumentComposerPasses() {
    this._wrapRenderInfoPass(this.renderPassBg, 'bg');
    this._wrapRenderInfoPass(this.renderPassPlanets, 'planets');
    this._wrapRenderInfoPass(this.planetHaloPass, 'planets');
    this._wrapRenderInfoPass(this.renderPassRingPlanets, 'planets');
    this._wrapRenderInfoPass(this.shadowShaftsPass, 'shafts');
    this._wrapRenderInfoPass(this.renderPassOrtho, 'ortho');
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
    this.renderer.setClearColor(0x000000, 0);
    // Disable per-render auto-reset so renderer.info accumulates across all
    // passes — we manually reset once per frame at the start of the pass chain.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.background = null;

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

    this.occlusionTarget = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(window.innerWidth / 8)),
      Math.max(1, Math.floor(window.innerHeight / 8)),
      {
        format: THREE.RGBAFormat,
        type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: true
      }
    );
    this.occlusionWhiteMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation, blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor
    });
    const blurRtOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: this.renderer.capabilities.isWebGL2 ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false };
    const blurW = Math.max(1, Math.floor(window.innerWidth / 8));
    const blurH = Math.max(1, Math.floor(window.innerHeight / 8));
    this.occlusionBlurTargetA = new THREE.WebGLRenderTarget(blurW, blurH, blurRtOptions);
    this.occlusionBlurTargetB = new THREE.WebGLRenderTarget(blurW, blurH, blurRtOptions);
    this.occlusionBlurScene = new THREE.Scene();
    this.occlusionBlurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.occlusionBlurMatH = createSeparableBlurMaterial(new THREE.Vector2(1, 0));
    this.occlusionBlurMatV = createSeparableBlurMaterial(new THREE.Vector2(0, 1));
    this.occlusionBlurMatH.uniforms.uResolution.value.set(blurW, blurH);
    this.occlusionBlurMatV.uniforms.uResolution.value.set(blurW, blurH);
    this.occlusionBlurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.occlusionBlurMatH);
    this.occlusionBlurScene.add(this.occlusionBlurQuad);

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
    this.renderPassFg = new RenderPass(this.scene, this.cameraPersp);
    makeSplitScreenRenderPass(this.renderPassFg, 2, false, false);

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazeDirs = new Float32Array(this.heatHazeMaxSources * 2);

    this.shadowShaftsPass = new FullScreenBlendPass(createShadowShaftsShader(), BLEND_MULTIPLY_SCENE);

    // Earth and Mars use an orthographic planet pass so their projected centre
    // and radius stay locked to the gameplay ring at every zoom level. The pass
    // still renders the real sphere/cloud/atmosphere meshes; only parallax is
    // removed. Later world/foreground passes clear depth and draw over the globe.
    //
    // Wszystkie passy sceny piszą do JEDNEGO targetu MSAA, a halo i shafts to
    // quady blendowane sprzętowo (nie ShaderPassy czytające tDiffuse) — w całej
    // klatce jest więc dokładnie jeden resolve MSAA: composerTarget → postTarget.
    //
    // shadowShaftsPass PO świecie ortho (statki/ring PRZYJMUJĄ cień),
    // ale PRZED FG: bronie, muzzle flashe i inne emisje rysują się już na
    // ocienionej scenie, więc świecą też W cieniu i bloom przez niego przebija.
    // (Na samym końcu pass gasił wszystko, łącznie z laserami.)
    this._scenePasses = [
      this.renderPassBg,
      this.renderPassPlanets,
      this.planetHaloPass,
      this.renderPassRingPlanets,
      this.renderPassOrtho,
      this.shadowShaftsPass,
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

    this._applyPassToggles();
    this._instrumentComposerPasses();
    this.isInitialized = true;
    // Poziom mógł zostać ustawiony (menu/localStorage) zanim init się wykonał
    // — dociśnij defines/rozmiary targetów do zapamiętanej jakości.
    this._applyShadowShaftsQuality();
    this.resize(window.innerWidth, window.innerHeight);

    return this;
  },

  _disposeComposerChain() {
    try {
      for (const pass of [...(this._scenePasses || []), ...(this._postPasses || [])]) try { pass?.dispose?.(); } catch { }
      try { this.composerTarget?.dispose?.(); } catch { }
      try { this.postTarget?.dispose?.(); } catch { }
      try { this.refractionTarget?.dispose?.(); } catch { }
      try { this.shockwave3DManager?.dispose?.(); } catch { }
      try { this.planetHaloTarget?.dispose?.(); } catch { }
      try { this.haloDepthMaskMaterial?.dispose?.(); } catch { }
      try { this.occlusionTarget?.dispose?.(); } catch { }
      try { this.occlusionBlurTargetA?.dispose?.(); } catch { }
      try { this.occlusionBlurTargetB?.dispose?.(); } catch { }
      try { this.occlusionBlurQuad?.geometry?.dispose?.(); } catch { }
      try { this.occlusionBlurMatH?.dispose?.(); } catch { }
      try { this.occlusionBlurMatV?.dispose?.(); } catch { }
    } catch { }
    this.isInitialized = false;
    this.refractionTarget = null;
    this.shockwave3DManager = null;
    this._shockwavePrevTime = 0;
  },

  _applyPassToggles() {
    const t = this.perfToggles || {};
    if (this.renderPassBg) this.renderPassBg.enabled = t.bgPass !== false;
    if (this.renderPassPlanets) this.renderPassPlanets.enabled = t.planetPass !== false;
    if (this.planetHaloPass) this.planetHaloPass.enabled = t.planetPass !== false;
    if (this.renderPassRingPlanets) this.renderPassRingPlanets.enabled = t.planetPass !== false;
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
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

  setShadowShaftsQuality(level = 'medium') {
    const cfg = resolveShadowShaftsQuality(level);
    this.shadowShaftsQuality = cfg.level;
    this._shaftCfg = cfg;
    const t = this.perfToggles || (this.perfToggles = {});
    t.shadowShafts = cfg.enabled;
    this._passTogglesDirty = true;
    if (this.isInitialized) this._applyShadowShaftsQuality();
    return this.getPerfStatus();
  },

  _applyShadowShaftsQuality() {
    const cfg = this._shaftCfg || resolveShadowShaftsQuality(this.shadowShaftsQuality);
    this._shaftCfg = cfg;
    const mat = this.shadowShaftsPass?.material;
    if (mat) {
      const defines = { ...(mat.defines || {}) };
      if (defines.NUM_SAMPLES !== cfg.samples) {
        defines.NUM_SAMPLES = cfg.samples;
        mat.defines = defines;
        mat.needsUpdate = true;
      }
    }
    this._resizeOcclusionTargets(this.width || (typeof window !== 'undefined' ? window.innerWidth : 1), this.height || (typeof window !== 'undefined' ? window.innerHeight : 1));
    const blurR = Math.max(0.5, Number(cfg.blurRadius) || 3.5);
    if (this.occlusionBlurMatH?.uniforms?.uRadius) this.occlusionBlurMatH.uniforms.uRadius.value = blurR;
    if (this.occlusionBlurMatV?.uniforms?.uRadius) this.occlusionBlurMatV.uniforms.uRadius.value = blurR;
  },

  _resizeOcclusionTargets(width, height) {
    const div = Math.max(1, Number(this._shaftCfg?.resDiv) || 8);
    const w = Math.max(1, Math.floor(width / div));
    const h = Math.max(1, Math.floor(height / div));
    if (this.occlusionTarget) this.occlusionTarget.setSize(w, h);
    if (this.occlusionBlurTargetA && this.occlusionBlurTargetB) {
      this.occlusionBlurTargetA.setSize(w, h);
      this.occlusionBlurTargetB.setSize(w, h);
      if (this.occlusionBlurMatH?.uniforms?.uResolution) this.occlusionBlurMatH.uniforms.uResolution.value.set(w, h);
      if (this.occlusionBlurMatV?.uniforms?.uResolution) this.occlusionBlurMatV.uniforms.uResolution.value.set(w, h);
    }
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
  enablePlanetOccluder3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.enable(OCCLUSION_RENDER_LAYER); }); },
  // Okluder rysowany kamerą ortho (ring-planety, pasmo ringu, kadłuby statków).
  // UWAGA: wołać PO enableRingPlanet3D/enableForeground3D — tamte robią
  // layers.set() i skasowałyby tę warstwę.
  enableOrthoOccluder3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.enable(OCCLUSION_ORTHO_RENDER_LAYER); }); },
  // Okluder-sprite (quad z alfą sylwetki, własny biały materiał) — renderuje
  // się WYŁĄCZNIE w przejściu maski bez override'u (layers.set, nie enable).
  enableSpriteOccluder3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(OCCLUSION_SPRITE_RENDER_LAYER); }); },
  // Wariant persp (np. asteroidy z passa FG) — rzutowanie tą samą kamerą,
  // którą obiekt jest rysowany na ekranie.
  enableSpriteOccluderPersp3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(OCCLUSION_SPRITE_PERSP_RENDER_LAYER); }); },
  enableForeground3D(object3d) { if (object3d) object3d.traverse((child) => { child.layers.set(2); }); },

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

    if (this.refractionTarget) {
      this.refractionTarget.setSize(
        Math.max(1, Math.floor(width * this.pixelRatio * 0.5)),
        Math.max(1, Math.floor(height * this.pixelRatio * 0.5))
      );
    }
    if (this.planetHaloTarget) {
      this.planetHaloTarget.setSize(bufW, bufH);
    }
    this._resizeOcclusionTargets(width, height);
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

    const shake = (typeof window !== 'undefined') ? window.__weapon3dCameraShake : null;
    const camX = gameCamera.x + (Number(shake?.x) || 0);
    const camY = -(gameCamera.y + (Number(shake?.y) || 0));

    this.cameraOrtho.position.set(camX, camY, 150000);
    this.cameraPersp.position.set(camX, camY, targetZ);
    this.cameraPersp.lookAt(camX, camY, 0);

    if (viewOffsetX === 0) {
      if (this.shadowCatcher) this.shadowCatcher.position.set(camX, camY, -2);
      if (this.shadowCatcherFg) this.shadowCatcherFg.position.set(camX, camY, -100);
    }
  },

  render() {
    if (!this.isInitialized) return;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tRenderTotal0 = performance.now();

    // Toggles zmieniają się tylko z panelu/presetu — aplikuj przy zmianie,
    // nie co klatkę (w środku jest m.in. traverse całej sceny po światłach).
    if (this._passTogglesDirty) {
      this._applyPassToggles();
      this._passTogglesDirty = false;
    }

    const t = this.perfToggles || {};
    const bloomOn = t.bloom !== false;
    const raysEnabled = t.shadowShafts !== false;
    const heatEnabled = t.heatHaze !== false;
    let occlusionTexture = this.occlusionTarget?.texture || null;
    const shaftCfg = this._shaftCfg || resolveShadowShaftsQuality(this.shadowShaftsQuality);
    const OVERSCAN = Math.max(1.0, Number(shaftCfg.overscan) || 1.2);
    let isSplit = false;
    let origTop = this.cameraOrtho.top;
    let origBottom = this.cameraOrtho.bottom;

    // Pre-pass halo tylko gdy planety są w ogóle renderowane — wcześniej te
    // 2 przejścia sceny wykonywały się ZAWSZE, nawet na ultrafast bez planet.
    if (t.planetPass !== false && this.planetHaloTarget && this.planetHaloPass && this.haloDepthMaskMaterial) {
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

    if (raysEnabled && this.shadowShaftsPass) {
      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;

      const prevTarget = this.renderer.getRenderTarget();
      const prevClearAlpha = this.renderer.getClearAlpha();
      const prevClearColor = this._clearColorScratch;
      this.renderer.getClearColor(prevClearColor);
      const prevLayerMask = this.cameraPersp.layers.mask;
      const prevOrthoLayerMask = this.cameraOrtho.layers.mask;
      const prevOverrideMaterial = this.scene.overrideMaterial;

      const origLeft = this.cameraOrtho.left;
      const origRight = this.cameraOrtho.right;
      origTop = this.cameraOrtho.top;
      origBottom = this.cameraOrtho.bottom;
      const origPerspZoom = this.cameraPersp.zoom;

      this.renderer.setRenderTarget(this.occlusionTarget);
      this.scene.overrideMaterial = this.occlusionWhiteMaterial;

      isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;

      if (isSplit) {
          const tw = this.occlusionTarget.width;
          const th = this.occlusionTarget.height;
          const halfW = Math.floor(tw / 2);

          this.renderer.setScissorTest(true);
          
          // --- Lewa Okluzja ---
          this.renderer.setViewport(0, 0, halfW, th);
          this.renderer.setScissor(0, 0, halfW, th);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam1, this.width / 2, this.height, 0);
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);

          this.renderer.render(this.scene, this.cameraPersp);
          this.cameraOrtho.layers.set(OCCLUSION_ORTHO_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.scene.overrideMaterial = null;
          this.cameraOrtho.layers.set(OCCLUSION_SPRITE_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.cameraPersp.layers.set(OCCLUSION_SPRITE_PERSP_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraPersp);
          this.scene.overrideMaterial = this.occlusionWhiteMaterial;

          // --- Prawa Okluzja ---
          this.renderer.setViewport(halfW, 0, tw - halfW, th);
          this.renderer.setScissor(halfW, 0, tw - halfW, th);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam2, this.width / 2, this.height, this.width / 2);
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);

          this.renderer.render(this.scene, this.cameraPersp);
          this.cameraOrtho.layers.set(OCCLUSION_ORTHO_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.scene.overrideMaterial = null;
          this.cameraOrtho.layers.set(OCCLUSION_SPRITE_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.cameraPersp.layers.set(OCCLUSION_SPRITE_PERSP_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraPersp);
          this.scene.overrideMaterial = this.occlusionWhiteMaterial;

          this.renderer.setScissorTest(false);
      } else {
          const tw = this.occlusionTarget.width;
          const th = this.occlusionTarget.height;
          this.renderer.setViewport(0, 0, tw, th);
          this.renderer.setScissorTest(false);
          this.renderer.setClearColor(0x000000, 0.0);
          this.renderer.clear(true, true, true);
          
          this.syncCamera(this.activeCam1, this.width, this.height, 0);
          this.cameraOrtho.left *= OVERSCAN; this.cameraOrtho.right *= OVERSCAN;
          this.cameraOrtho.top *= OVERSCAN; this.cameraOrtho.bottom *= OVERSCAN;
          this.cameraOrtho.updateProjectionMatrix();
          this.cameraPersp.zoom /= OVERSCAN; this.cameraPersp.updateProjectionMatrix();
          this.cameraPersp.layers.set(OCCLUSION_RENDER_LAYER);

          this.renderer.render(this.scene, this.cameraPersp);
          this.cameraOrtho.layers.set(OCCLUSION_ORTHO_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.scene.overrideMaterial = null;
          this.cameraOrtho.layers.set(OCCLUSION_SPRITE_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraOrtho);
          this.cameraPersp.layers.set(OCCLUSION_SPRITE_PERSP_RENDER_LAYER);
          this.renderer.render(this.scene, this.cameraPersp);
          this.scene.overrideMaterial = this.occlusionWhiteMaterial;
      }

      this.scene.overrideMaterial = prevOverrideMaterial;
      this.cameraPersp.layers.mask = prevLayerMask;
      this.cameraOrtho.layers.mask = prevOrthoLayerMask;

      this.cameraOrtho.left = origLeft;
      this.cameraOrtho.right = origRight;
      this.cameraOrtho.top = origTop;
      this.cameraOrtho.bottom = origBottom;
      this.cameraOrtho.updateProjectionMatrix();

      this.cameraPersp.zoom = origPerspZoom;
      this.cameraPersp.updateProjectionMatrix();

      occlusionTexture = this.occlusionTarget.texture;
      if (
        this.occlusionBlurTargetA && this.occlusionBlurTargetB &&
        this.occlusionBlurScene && this.occlusionBlurCamera &&
        this.occlusionBlurQuad && this.occlusionBlurMatH && this.occlusionBlurMatV
      ) {
        this.occlusionBlurMatH.uniforms.tDiffuse.value = this.occlusionTarget.texture;
        this.occlusionBlurQuad.material = this.occlusionBlurMatH;
        this.renderer.setRenderTarget(this.occlusionBlurTargetA);
        this.renderer.clear();
        this.renderer.render(this.occlusionBlurScene, this.occlusionBlurCamera);

        this.occlusionBlurMatV.uniforms.tDiffuse.value = this.occlusionBlurTargetA.texture;
        this.occlusionBlurQuad.material = this.occlusionBlurMatV;
        this.renderer.setRenderTarget(this.occlusionBlurTargetB);
        this.renderer.clear();
        this.renderer.render(this.occlusionBlurScene, this.occlusionBlurCamera);
        occlusionTexture = this.occlusionBlurTargetB.texture;
      }

      this.renderer.setRenderTarget(prevTarget);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      this.renderer.autoClear = prevAutoClear;

    }

    const tBloom0 = dbgEnabled ? performance.now() : 0;
    if (this.bloomPass && bloomOn) this._applyBloomPassConfig();
    if (dbgEnabled) recordRenderDbg('coreBloomConfig', performance.now() - tBloom0);

    const tPost0 = dbgEnabled ? performance.now() : 0;
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    const sun = typeof window !== 'undefined' ? window.SUN : null;

    if (this.shadowShaftsPass) {
      const uShafts = this.shadowShaftsPass.material.uniforms;
      if (raysEnabled) {
        uShafts.uOcclusionMap.value = occlusionTexture;
        uShafts.uAspectRatio.value = this.width / this.height;
        uShafts.uOverscan.value = OVERSCAN;

        const worldHeight = Math.abs(origTop - origBottom);
        const shaftLenWorld = Math.max(1, Number(shaftCfg.lengthWorld) || 20000);
        const shaftMaxLenUv = Math.max(0.2, Number(shaftCfg.maxLenUv) || 0.8);
        uShafts.uShadowLength.value = worldHeight > 0 ? Math.max(0.15, Math.min(shaftLenWorld / worldHeight, shaftMaxLenUv)) : 0.0;
        uShafts.uTime.value = nowSec;
        uShafts.uDiscLenMul.value = Math.max(1, Number(shaftCfg.discLenMul) || 18);

        if (sun) {
          const cam1 = this.activeCam1 || { x: 0, y: 0 };
          const cam2 = this.activeCam2 || cam1;
          const zoom1 = Math.max(0.0001, Number(cam1.zoom) || 1);
          const zoom2 = Math.max(0.0001, Number(cam2.zoom) || 1);
          const viewW = isSplit ? this.width / 2 : this.width;
          uShafts.uSunWorld.value.set(sun.x, -sun.y);
          uShafts.uCamCenter.value.set(Number(cam1.x) || 0, -(Number(cam1.y) || 0));
          uShafts.uViewWorldSize.value.set(viewW / zoom1, this.height / zoom1);
          if (isSplit) {
            uShafts.uSplitScreen.value = 1;
            uShafts.uSunDirection.value.set(sun.x - cam1.x, (-sun.y) - (-cam1.y));
            uShafts.uSunDirection2.value.set(sun.x - cam2.x, (-sun.y) - (-cam2.y));
            uShafts.uCamCenter2.value.set(Number(cam2.x) || 0, -(Number(cam2.y) || 0));
            uShafts.uViewWorldSize2.value.set(viewW / zoom2, this.height / zoom2);
          } else {
            uShafts.uSplitScreen.value = 0;
            uShafts.uSunDirection.value.set(sun.x - cam1.x, (-sun.y) - (-cam1.y));
            uShafts.uSunDirection2.value.set(0, 0);
            uShafts.uCamCenter2.value.copy(uShafts.uCamCenter.value);
            uShafts.uViewWorldSize2.value.copy(uShafts.uViewWorldSize.value);
          }
          const discCount = Math.min(this.shaftDiscCount | 0, SHAFT_DISC_CAP);
          uShafts.uDiscCount.value = discCount;
          const discVals = uShafts.uDiscs.value;
          for (let i = 0; i < discCount; i++) {
            const base = i * 3;
            discVals[i].set(this.shaftDiscs[base], this.shaftDiscs[base + 1], this.shaftDiscs[base + 2], 0);
          }
        } else {
          uShafts.uSplitScreen.value = 0;
          uShafts.uSunDirection.value.set(0, 0);
          uShafts.uSunDirection2.value.set(0, 0);
          uShafts.uDiscCount.value = 0;
        }
      } else {
        uShafts.uSplitScreen.value = 0;
        uShafts.uSunDirection.value.set(0, 0);
        uShafts.uSunDirection2.value.set(0, 0);
        uShafts.uShadowLength.value = 0.0;
        uShafts.uDiscCount.value = 0;
      }
    }

    if (this.uberPass) {
      const uPost = this.uberPass.material.uniforms;
      const heatCount = heatEnabled ? Math.max(0, Math.min(this.heatHazeCount | 0, this.heatHazeMaxSources | 0)) : 0;
      uPost.uSourceCount.value = heatCount;
      uPost.uGlobalStrength.value = 1.0;
      uPost.uTime.value = nowSec;
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
    }
    if (dbgEnabled) recordRenderDbg('coreUberSetup', performance.now() - tPost0);

    const tComposer0 = performance.now();
    // Reset renderer info once per frame; it will accumulate across all passes.
    this.renderer.info.reset();
    this._resetRenderInfoBuckets();
    this._instrumentComposerPasses();

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

        const renderRefractionViewport = (camData, vpX, vpY, vpW, vpH) => {
          this.renderer.setViewport(vpX, vpY, vpW, vpH);
          this.renderer.setScissor(vpX, vpY, vpW, vpH);
          this.renderer.setScissorTest(true);
          this.renderer.clear(true, true, true);
          this.syncCamera(camData, vpW, vpH, vpX);
          for (const { layer, ortho } of layers) {
            const cam = ortho ? this.cameraOrtho : this.cameraPersp;
            cam.layers.set(layer);
            this.renderer.render(this.scene, cam);
          }
        };

        this.shockwave3DManager.hideAll();
        this.renderer.autoClear = false;
        this.renderer.setRenderTarget(this.refractionTarget);
        this.renderer.setClearColor(0x000000, 0.0);
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
        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, this.refractionTarget.width, this.refractionTarget.height);
        this.cameraPersp.layers.mask = prevPerspLayerMask;
        this.cameraOrtho.layers.mask = prevOrthoLayerMask;
        this.renderer.setRenderTarget(prevTarget);
        this.renderer.setClearColor(prevClearColor, prevClearAlpha);
        this.renderer.autoClear = prevAutoClear;
      }
    }

    // Scena → composerTarget (MSAA, bez pośrednich resolve), potem jedyny
    // resolve klatki (sceneResolvePass sampluje composerTarget) i post bez MSAA.
    for (const pass of this._scenePasses) {
      if (pass && pass.enabled !== false) pass.render(this.renderer, null, this.composerTarget);
    }
    for (const pass of this._postPasses) {
      if (pass && pass.enabled !== false) pass.render(this.renderer, null, this.postTarget);
    }
    this.renderer.setRenderTarget(null);
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

  // Tarcza planety/księżyca (współrzędne GRY, y w dół) jako analityczny
  // okluder shaftów — zgłaszana co klatkę, także gdy ciało jest poza ekranem
  // (cień musi istnieć niezależnie od kadru i zoomu).
  pushShaftDiscWorld(worldX, worldY, radius) {
    const r = Number(radius) || 0;
    if (!(r > 0) || !this.shaftDiscs) return false;
    const i = this.shaftDiscCount | 0;
    if (i >= SHAFT_DISC_CAP) return false;
    const base = i * 3;
    this.shaftDiscs[base] = Number(worldX) || 0;
    this.shaftDiscs[base + 1] = -(Number(worldY) || 0);
    this.shaftDiscs[base + 2] = r;
    this.shaftDiscCount = i + 1;
    return true;
  },

  beginHeatHazeFrame() { this.heatHazeCount = 0; },
  
  pushHeatHazeWorld(worldX, worldY, worldZ = -4, radiusWorld = 80, strength = 1.0, dirWorldX = 0, dirWorldY = 0) {
    if (!this.isInitialized || !this.heatHazeSources || !this.cameraOrtho) return false;
    if ((this.perfToggles?.heatHaze) === false) return false;

    // Kierunek wydechu w przestrzeni sceny; (0,0) => zrodlo izotropowe (eksplozje).
    let dirX = Number(dirWorldX) || 0;
    let dirY = Number(dirWorldY) || 0;
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    if (dirLen > 0.0001) { dirX /= dirLen; dirY /= dirLen; } else { dirX = 0; dirY = 0; }

    const doPush = (u, v, rUv, amp) => {
        // Smuga siega ~3.2 * rUv w dol wydechu — cullujemy z zapasem.
        const reach = rUv * 3.4;
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
    };

    const mapToCamera = (camData, isSplit, isRightSide) => {
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

        const zoomNow = Math.max(0.0001, camW / worldW);
        const ampZoomScale = Math.max(0.22, Math.min(1.0, zoomNow));
        const ampScaled = strength * ampZoomScale;

        if (isSplit) {
            u = isRightSide ? (u * 0.5 + 0.5) : (u * 0.5);
        }
        doPush(u, v, rUv, ampScaled);
    };

    const isSplit = typeof window !== 'undefined' && window.splitScreenMode && this.activeCam2;
    if (isSplit) {
        mapToCamera(this.activeCam1, true, false);
        mapToCamera(this.activeCam2, true, true);
    } else {
        mapToCamera(this.activeCam1, false, false);
    }
    
    return true;
  },

  pushGodRayWorld() { },
  setShadowCatchersDebug(enabled = true) { },
  toggleShadowCatchersDebug() { }
};
