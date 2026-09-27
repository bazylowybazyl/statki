// src/3d/tsl/postGry.js
//
// Post gry w TSL (port WebGPU, zadanie 02 — docs/webgpu/zadania/02-post-bloom-uber.md):
// bloom (BloomNode z three + poprawki zgodności z dawnym passem bloomu WebGL) i
// „uber”: gorące powietrze (do 24 źródeł: dysze z maską z dema plazmy i źródła
// izotropowe — wybuchy, rakiety, tarcze), dyspersja dysz, ACES gry i LinearTosRGB
// (kolorGry.js). Port 1:1 dawnego UberPostShader z core3d.js (bez fal warpa —
// warp poza portem).
//
// Kolejność jak na WebGL (resolve → bloom → uber): bloom dokładał się addytywnie do
// kopii bufora sceny, a uber próbkował tę sumę z przesunięciem gorącego powietrza,
// potem ACES i sRGB. Tu bez celu pośredniego: scenę i teksturę bloomu próbkujemy
// TYM SAMYM przesuniętym UV i sumujemy (bez przesunięcia wynik jest identyczny, z
// przesunięciem różnica to interpolacja biliniowa gładkiego bloomu — pomijalna), a
// alfa dostaje max(rgb) bloomu jak przy dawnym blendzie (ONE, ONE).
//
// Zgodność BloomNode (three r183) z dawnym passem bloomu WebGL — ten sam algorytm:
// próg smoothstep(threshold, threshold + 0,01, luminancja) (bramkuje CAŁY teksel), 5 mipów
// połówkowych (Math.round), jądra 6…22 z tymi samymi współczynnikami, bloomFactors
// 1,0…0,2, lerp promienia, cele HalfFloat. Różnice (i co z nimi robimy):
//  1. kompozyt: dawny pass mnożył sumę mipów przez 3,0 („backwards compatibility with
//     previous alpha-based intensity”), BloomNode nie — BLOOM_ZGODNOSC_WEBGL = 3 mnoży
//     wyjście węzła (siła z bloomConfig.js bez zmian, ~9 × strength energii jak dotąd);
//  2. alfa: dawny kompozyt dawał max(rgb), BloomNode 3 × strength (stała) — alfę liczymy
//     z rgb sami;
//  3. rozmiar: BloomNode bierze bufor rysowania w KAŻDYM renderze (updateBefore) —
//     resolutionScale ≠ 1 przez nadpisane setSize (BloomGry);
//  4. aktualizacja raz na KLATKĘ rAF (NodeUpdateType.FRAME): drugi renderSingle
//     podzielonego ekranu dostałby bloom pierwszego widoku — BloomGry liczy go raz na
//     RENDER (jak dawny pass w każdym render()).
//
// Funkcje z `setLayout` są CZYSTE (bez uniformów z domknięcia — błąd r183, PLAN §3).
// WGSL nie przyjmuje smoothstep z odwróconymi krawędziami (stałe low ≥ high to błąd
// tworzenia shadera) — smoothstep(1, 0,15, t) z GLSL = 1 − smoothstep(0,15, 1, t).
//
// Zadanie 12-B (infrastruktura efektów, docs/webgpu/FX-INFRA.md §7–§8): „uber” próbkuje też
// ŹRÓDŁA ZNIEKSZTAŁCEŃ efektów (src/3d/fx/distortion.js — fala, implozja, gorące powietrze;
// przesunięcie z dyspersją ×0,82 / ×1 / ×1,22 jak dysze) i WARSTWĘ DIST (cel z przesunięciem
// w px w osiach sceny, aberracja ×1,12 / ×1 / ×0,88 jak demo broni) — tym samym przesuniętym UV
// dla sceny i bloomu, co gorące powietrze. Bez źródeł i bez warstwy obraz jest bit w bit jak
// wcześniej (przesunięcia są dokładnymi zerami). Siatka bezpieczeństwa HDR (`hdrBezpieczny`):
// NaN i ±Inf bufora sceny → 0 na wejściu bloomu i w odczytach „uber”.
import { Vector2, Vector4, NodeUpdateType } from 'three/webgpu';
import BloomNode from 'three/addons/tsl/display/BloomNode.js';
import {
  Continue, Fn, If, Loop, abs, clamp, dot, exp, float, floatBitsToUint, floor, fract, length, max, mix, select, smoothstep,
  texture, uint, uniform, uniformArray, uv, vec2, vec4
} from 'three/tsl';
import { uniformsAdapter, uniformNode } from './uniformy.js';
import { acesGry, linearDoSrgb } from './kolorGry.js';
import { distortionOffset } from '../fx/distortion.js';

/** Ile źródeł gorącego powietrza przyjmuje uber w klatce (Core3D.pushHeatHazeWorld). */
export const MAX_HEAT_HAZE_SOURCES = 24;

/**
 * Mnożnik wyjścia BloomNode do zgodności z dawnym passem bloomu WebGL (three r183):
 * tamten kompozyt liczył 3,0 × strength × Σ mipów, BloomNode strength × Σ mipów.
 * Strażnik: tests/webgpuPost.test.mjs (gdy three wyrówna węzły, test każe to zdjąć).
 */
export const BLOOM_ZGODNOSC_WEBGL = 3.0;

/**
 * BloomNode gry: rozmiar z bufora rysowania × resolutionScale (bloomConfig.js /
 * tuner), aktualizacja raz na render (podzielony ekran = dwa rendery w klatce),
 * haki pomiaru (kubełek 'bloom' w Core3D — bloom renderuje się w updateBefore, czyli
 * W ŚRODKU renderu postu).
 */
export class BloomGry extends BloomNode {
  static get type() {
    return 'BloomGry';
  }

  constructor(inputNode, strength = 1, radius = 0, threshold = 0) {
    super(inputNode, strength, radius, threshold);
    /** Skala rozdzielczości bloomu (0,1…1) względem bufora rysowania. */
    this.resolutionScale = 1;
    /** Wołane przed i po passach bloomu (bez argumentów; przypięte raz, bez domknięć per klatka). */
    this.onRenderBegin = null;
    this.onRenderEnd = null;
    this.updateBeforeType = NodeUpdateType.RENDER;
  }

  setSize(width, height) {
    const s = Math.max(0.1, Math.min(1, Number(this.resolutionScale) || 1));
    super.setSize(Math.max(1, Math.floor(width * s)), Math.max(1, Math.floor(height * s)));
  }

  updateBefore(frame) {
    if (this.onRenderBegin) this.onRenderBegin();
    const result = super.updateBefore(frame);
    if (this.onRenderEnd) this.onRenderEnd();
    return result;
  }
}

// ── Szum gorącego powietrza (hash12 / noise z UberPostShader) ────────────────
// Wejścia haszu są całkowite (floor), więc wynik nie zależy od kompilatora.
export const hazeHash12 = /*@__PURE__*/ Fn(([p]) => {
  const p3 = fract(p.xyx.mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'hazeHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const hazeNoise = /*@__PURE__*/ Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const a = hazeHash12(i).toVar();
  const b = hazeHash12(i.add(vec2(1.0, 0.0))).toVar();
  const c = hazeHash12(i.add(vec2(0.0, 1.0))).toVar();
  const d = hazeHash12(i.add(vec2(1.0, 1.0))).toVar();
  const u = f.mul(f).mul(vec2(3.0).sub(f.mul(2.0))).toVar();
  return mix(a, b, u.x).add(c.sub(a).mul(u.y).mul(float(1.0).sub(u.x))).add(d.sub(b).mul(u.x).mul(u.y));
}).setLayout({ name: 'hazeNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

// ── Siatka bezpieczeństwa HDR (zadanie 12-B, jak demo rakiet) ────────────────
// NaN i ±Inf (wykładnik same jedynki) → 0 per składowa; skończone wartości bez zmian (bit w
// bit — także ujemne). Test bitów zamiast x != x: WGSL pozwala kompilatorowi zakładać brak NaN
// i zwinąć porównanie, a min / max z NaN oddają drugi argument (demo zamieniało NaN w 60 000 —
// jasną plamę po bloomie). Czysta funkcja z layoutem (bez uniformów — PLAN §3).
export const hdrBezpieczny = /*@__PURE__*/ Fn(([c]) => {
  const bits = floatBitsToUint(c).toVar();
  const wykladnik = uint(0x7f800000);
  const skonczona = (b, v) => select(b.bitAnd(wykladnik).equal(wykladnik), float(0.0), v);
  return vec4(skonczona(bits.x, c.x), skonczona(bits.y, c.y), skonczona(bits.z, c.z), skonczona(bits.w, c.w));
}).setLayout({ name: 'hdrBezpieczny', type: 'vec4', inputs: [{ name: 'c', type: 'vec4' }] });

/**
 * Uniformy postu w kształcie `material.uniforms` (adapter, uniformy.js): kod Core3D
 * ustawia `.value` jak na WebGL, bez przebudowy pipeline'u. uHeatOn zastępuje define
 * HEAT_HAZE (perfToggles.heatHaze), uSourceCount ogranicza pętlę (tablice zawsze po 24),
 * uDistLayerOn — warstwa DIST ma w tym renderze zawartość (12-B).
 * Bufory uniformów etapu: grupa obiektu + dwie tablice = 3 (+ blok źródeł zniekształceń = 4;
 * limit 12).
 */
export function createPostUniforms() {
  return uniformsAdapter({
    uTime: uniform(0),
    uSourceCount: uniform(0, 'int'),
    uGlobalStrength: uniform(1.0),
    uAspect: uniform(1.0),
    uHeatOn: uniform(1.0),
    uDistLayerOn: uniform(0.0),
    // xy = środek (UV, v od dołu ekranu), z = promień w jednostkach osi v, w = siła
    uHeatSources: uniformArray(Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new Vector4(2, 2, 0, 0)), 'vec4'),
    // kierunek wydechu dyszy w przestrzeni ekranu; (0, 0) = źródło izotropowe
    uHeatDirs: uniformArray(Array.from({ length: MAX_HEAT_HAZE_SOURCES }, () => new Vector2(0, 0)), 'vec2')
  });
}

/**
 * Węzeł wyjścia postu (RenderPipeline.outputNode, outputColorTransform = false):
 * scena (+ bloom × BLOOM_ZGODNOSC_WEBGL) próbkowana z przesunięciem gorącego powietrza,
 * ACES gry, LinearTosRGB. `bloomTexture` = bloomGry.getTextureNode() albo null (bloom
 * wyłączony — osobny RenderPipeline, bez kosztu passów bloomu).
 * `distortion` — blok źródeł zniekształceń efektów (`DistortionField.node`, fxFrame.js) albo null,
 * `distortionLayer` — tekstura warstwy DIST (Core3D.distortionTarget: RG, px w osiach sceny) albo
 * null; warstwa wymaga bloku (rozmiar celu z jego nagłówka) i uniformu uDistLayerOn.
 * @param {{ sceneTexture: any, bloomTexture?: any, uniforms: Record<string, any>, bloomGain?: number, distortion?: any, distortionLayer?: any }} o
 */
export function createUberPost({ sceneTexture, bloomTexture = null, uniforms, bloomGain = BLOOM_ZGODNOSC_WEBGL, distortion: fxBlock = null, distortionLayer = null }) {
  const uTime = uniformNode(uniforms.uTime);
  const uSourceCount = uniformNode(uniforms.uSourceCount);
  const uGlobalStrength = uniformNode(uniforms.uGlobalStrength);
  const uAspect = uniformNode(uniforms.uAspect);
  const uHeatOn = uniformNode(uniforms.uHeatOn);
  const uHeatSources = uniformNode(uniforms.uHeatSources);
  const uHeatDirs = uniformNode(uniforms.uHeatDirs);
  const uDistLayerOn = uniforms.uDistLayerOn ? uniformNode(uniforms.uDistLayerOn) : null;

  // UV kwadu WebGPU ma v = 0 u GÓRY; źródła i przesunięcia liczymy jak w GLSL (v od dołu),
  // przesunięcie wraca do UV tekstury z odwróconą składową y.
  const toTextureUv = (offset) => vec2(offset.x, offset.y.negate());

  // Scena + bloom w punkcie (to, co dawny uber czytał z bufora po blendzie bloomu).
  // Poziom 0 jawnie (textureSampleLevel): odczyty leżą w gałęziach zależnych od piksela,
  // a cele renderu nie mają mipmap — wynik jak textureSample, bez wymogu jednolitego
  // przepływu (Firefox nie wyłącza derivative_uniformity). Odczyty = klony węzła bazowego
  // przez texture(baza, uv, poziom): jedno wiązanie tekstury na wszystkie odczyty. Baza
  // sceny ma jawne UV — węzeł z domyślnym UV mnożyłby każdy odczyt przez macierz
  // tekstury (osobny uniform mat3 na klon). Tekstura bloomu to PassTextureNode: jego
  // clone() gubi uvNode, więc .sample(uv).level(0) wróciłoby do domyślnego UV.
  const sceneBase = sceneTexture.isTextureNode === true ? sceneTexture : texture(sceneTexture, uv());
  const level0 = (base, uvNode) => texture(base, uvNode, float(0));
  // Odczyt sceny przez siatkę bezpieczeństwa (NaN / Inf → 0) — ten sam węzeł co wejście bloomu.
  const sampleScene = (uvNode) => {
    const scene = hdrBezpieczny(level0(sceneBase, uvNode));
    if (!bloomTexture) return scene;
    const b = level0(bloomTexture, uvNode).rgb.mul(bloomGain).toVar();
    return vec4(scene.rgb.add(b), scene.a.add(max(b.r, max(b.g, b.b))));
  };
  // Warstwa DIST (baza z jawnym UV — bez macierzy tekstury), tylko z blokiem źródeł (rozmiar celu).
  const distLayerBase = (distortionLayer && fxBlock && uDistLayerOn)
    ? (distortionLayer.isTextureNode === true ? distortionLayer : texture(distortionLayer, uv()))
    : null;

  return Fn(() => {
    const uvTex = uv().toVar();
    const uvGl = vec2(uvTex.x, float(1.0).sub(uvTex.y)).toVar();
    const distortion = vec2(0.0).toVar();   // izotropowe (wybuchy, rakiety, tarcze)
    const nozzleHaze = vec2(0.0).toVar();   // dysze — z mikroskopijną dyspersją

    If(uHeatOn.greaterThan(0.5), () => {
      // Przestrzeń skorygowana aspektem: dystanse izotropowe na ekranie (promień
      // źródła jest w jednostkach osi v).
      const asp = vec2(uAspect, 1.0).toVar();

      Loop(uSourceCount, ({ i }) => {
        const src = uHeatSources.element(i).toVar();
        const radius = max(0.0001, src.z).toVar();
        const p = uvGl.sub(src.xy).mul(asp).toVar();
        const fi = float(i).toVar();

        // dir = kierunek wydechu w przestrzeni ekranu; (0,0) => źródło izotropowe.
        const dir = uHeatDirs.element(i).toVar();
        If(dot(dir, dir).greaterThan(0.25), () => {
          // DYSZA — maska zakłóceń z dema plazmy (dema/silniki): radius = promień wylotu.
          // Stożek 7R za dyszą (szerokość 1,25R → 2,6R), najsilniej tuż za wylotem,
          // zanik exp(−2,4 z / 10R) i gaśnięcie w drugiej połowie stożka; szum płynie
          // w dół strumienia; przesunięcie ~0,12 promienia dyszy na ekranie; szczyt
          // maski ~1R za wylotem (dysza siedzi na krawędzi kadłuba).
          const along = dot(p, dir).div(radius).toVar();
          If(along.lessThan(0.4).or(along.greaterThan(7.2)), () => { Continue(); });
          const across = dot(p, vec2(dir.y.negate(), dir.x)).div(radius).toVar();
          const halfW = mix(1.25, 2.6, clamp(along.div(7.0), 0.0, 1.0)).toVar();
          const aw = abs(across).div(halfW).toVar();
          If(aw.greaterThanEqual(1.0), () => { Continue(); });
          const mask = exp(along.negate().mul(0.24))
            .mul(float(1.0).sub(smoothstep(0.85, 1.25, halfW.div(1.8))))
            .mul(smoothstep(0.4, 1.6, along))
            .mul(float(1.0).sub(smoothstep(0.55, 1.0, aw))).toVar();
          const nc = vec2(across.mul(2.2).add(fi.mul(7.3)), along.mul(0.9).sub(uTime.mul(9.9))).toVar();
          const nx = hazeNoise(nc).mul(0.65).add(hazeNoise(nc.mul(2.03).add(vec2(7.1, 3.3))).mul(0.35));
          const ny = hazeNoise(nc.add(vec2(31.7, 11.9))).mul(0.65).add(hazeNoise(nc.mul(2.03).add(vec2(17.3, 3.9))).mul(0.35));
          const off = vec2(nx, ny).mul(2.0).sub(1.0).mul(mask.mul(src.w).mul(uGlobalStrength).mul(radius).mul(0.12));
          nozzleHaze.addAssign(off.div(asp));
          Continue();
        });

        const maxExt = radius.mul(3.4).toVar();
        If(abs(p.x).greaterThan(maxExt).or(abs(p.y).greaterThan(maxExt)), () => { Continue(); });
        const t = length(p).div(radius).toVar();
        If(t.greaterThanEqual(1.0), () => { Continue(); });

        // Źródło izotropowe: drobny szum adwektowany (dwie niezależne składowe).
        const k = float(3.0).div(radius);
        const nc = vec2(p.x.negate().mul(k).add(fi.mul(5.19)), p.y.mul(k).sub(uTime.mul(2.2))).toVar();
        const n1 = hazeNoise(nc).mul(0.65).add(hazeNoise(nc.mul(2.17).add(11.3)).mul(0.35));
        const n2 = hazeNoise(nc.mul(1.31).add(vec2(5.2, 8.7))).mul(0.65).add(hazeNoise(nc.mul(2.9).add(vec2(1.7, 9.2))).mul(0.35));
        const wob = vec2(n1, n2).sub(0.5).toVar();
        // smoothstep(1.0, 0.15, t) z GLSL (odwrócone krawędzie) = 1 − smoothstep(0.15, 1.0, t)
        const fall = float(1.0).sub(smoothstep(0.15, 1.0, t)).mul(smoothstep(0.0, 0.1, t));
        const ampl = src.w.mul(fall).mul(uGlobalStrength);
        const disp = vec2(wob.x.negate().mul(1.4), wob.y.mul(0.6)).mul(ampl.mul(0.0035));
        distortion.addAssign(disp.div(asp));
      });

      distortion.assign(clamp(distortion, vec2(-0.022), vec2(0.022)));
      nozzleHaze.assign(clamp(nozzleHaze, vec2(-0.012), vec2(0.012)));
    });

    // Dysze: mikroskopijna dyspersja (trzy odczyty); poza strefą dysz jeden odczyt.
    const sceneColor = vec4(0.0).toVar();
    const zDyszami = () => {
      If(dot(nozzleHaze, nozzleHaze).greaterThan(1.0e-12), () => {
        const base = uvTex.add(toTextureUv(distortion)).toVar();
        const nh = toTextureUv(nozzleHaze).toVar();
        const cr = sampleScene(base.add(nh.mul(0.82))).r;
        const cg = sampleScene(base.add(nh)).toVar();
        const cb = sampleScene(base.add(nh.mul(1.22))).b;
        sceneColor.assign(vec4(cr, cg.g, cb, cg.a));
      }).Else(() => {
        sceneColor.assign(sampleScene(uvTex.add(toTextureUv(distortion))));
      });
    };

    if (!fxBlock) {
      zDyszami();
    } else {
      // Źródła zniekształceń efektów (12-B) — tylko gdy w tym renderze są (licznik bloku) albo
      // warstwa DIST ma zawartość; inaczej dawna ścieżka co do instrukcji (obraz bit w bit jak
      // przed 12-B — kontrola A w scripts/webgpu/efekty-kontrola.mjs). fxOff.xy — całe przesunięcie
      // UV tekstury (y w dół), zw — jego część z dyspersją (×0,82 / ×1 / ×1,22 jak dysze). Warstwa
      // DIST: przesunięcie w px w osiach sceny (x w prawo, y w górę) — próbka z p − o w osiach sceny
      // w OBU osiach (demo broni odejmowało je od UV ekranu, co w osi y odwracało kierunek),
      // aberracja ×1,12 / ×1 / ×0,88 jak demo; rozmiar celu z nagłówka bloku.
      const layerOn = uDistLayerOn ? uDistLayerOn.greaterThan(0.5) : null;
      const fxOn = layerOn ? fxBlock.element(0).x.greaterThan(0.5).or(layerOn) : fxBlock.element(0).x.greaterThan(0.5);
      If(fxOn, () => {
        const fxOff = distortionOffset(fxBlock, uvTex).toVar();
        const layerOff = vec2(0.0).toVar();
        if (distLayerBase) {
          If(layerOn, () => {
            const size = max(fxBlock.element(1).xy, vec2(1.0));
            const o = level0(distLayerBase, uvTex).xy;
            layerOff.assign(vec2(o.x.negate(), o.y).div(size));
          });
        }
        const base = uvTex.add(toTextureUv(distortion)).add(fxOff.xy.sub(fxOff.zw)).add(layerOff).toVar();
        const nh = toTextureUv(nozzleHaze).add(fxOff.zw).toVar();
        If(dot(nh, nh).add(dot(layerOff, layerOff)).greaterThan(1.0e-12), () => {
          const cr = sampleScene(base.add(nh.mul(0.82)).add(layerOff.mul(0.12))).r;
          const cg = sampleScene(base.add(nh)).toVar();
          const cb = sampleScene(base.add(nh.mul(1.22)).sub(layerOff.mul(0.12))).b;
          sceneColor.assign(vec4(cr, cg.g, cb, cg.a));
        }).Else(() => {
          sceneColor.assign(sampleScene(base));
        });
      }).Else(zDyszami);
    }

    return vec4(linearDoSrgb(acesGry(sceneColor.rgb)), sceneColor.a);
  })();
}
