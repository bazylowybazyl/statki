// src/3d/core3d.js
//
// Jedyny rdzeń renderu 3D gry: WebGPURenderer (three/webgpu) i TSL — port WebGPU,
// docs/webgpu/PLAN.md §2. Model klatki jak na WebGL: passy scen rysowane ręcznie
// po warstwach do JEDNEGO celu MSAA HalfFloat (composerTarget), czyszczona tylko
// głębia między passami, potem post jako węzły TSL w RenderPipeline
// (outputColorTransform = false — ACES i sRGB robi gra, kolorGry.js).
// Nieprzeniesione ShaderMaterial rysują się magentowym zamiennikiem
// (src/3d/tsl/zamiennik.js). Tylko WebGPU: bez adaptera renderer nie powstaje,
// gra pokazuje komunikat (Core3D.ready → false, gpuUnsupported).
import * as THREE from 'three/webgpu';
import {
  Continue, Fn, If, Loop, abs, clamp, dot, float, fract, int, length, max, screenCoordinate, screenSize, select,
  smoothstep, sqrt, texture, uniform, uniformArray, uv, vec2, vec4
} from 'three/tsl';
import { BLOOM_DEFAULTS } from './bloomConfig.js';
import {
  HULL_SDF_MAX_STEPS, HULL_SDF_OCCLUDER_FLOATS, HULL_SDF_SHAFT_CAP, HullShadowSdf, createHullSdfPlaceholderTexture, hullSdfShadow
} from './hullShadowSdf.js';
import { SUN_SHADOW_MAP_PLACEHOLDER, sunShadowUniforms } from './sunShadowMask.js';
import { installPlaceholders } from './tsl/zamiennik.js';
import { uniformNode, uniformsAdapter } from './tsl/uniformy.js';
import { BloomGry, MAX_HEAT_HAZE_SOURCES, createPostUniforms, createUberPost, hdrBezpieczny } from './tsl/postGry.js';
import { FxFrame, FX_DISTORT_LAYER } from './fx/fxFrame.js';
import { Rozgrzewka } from './rozgrzewka.js';

// Brama znaczników czasu GPU (_gpuTimerGate): tyle zapytań musi zostać w puli three
// (2 na pass), żeby zmieścić całą klatkę — dwa rendery podzielonego ekranu z modułami
// (pieczenie map ringu, SDF kadłubów) i z zapasem na passy kolejnych zadań.
const GPU_TIMER_FRAME_QUERIES = 512;
// Zastępcze flagi warstw dla wolnej kamery (lot nad miastem): renderuj wszystko poza
// ośrodkiem warpa (liczony wokół kamery gry w płaszczyźnie gry).
const LAYERS_ALL_ACTIVE = Object.freeze({ planets: true, halo: true, ringPlanets: true, shields: true, warp: false });
const PLANET_RENDER_LAYER = 3;
const PLANET_HALO_RENDER_LAYER = 5;
const RING_PLANET_RENDER_LAYER = 6;
// Ośrodek warpa „Nurt” (src/3d/warp/medium.js): pass perspektywiczny po planetach, przed
// passem ortho — rysowany tylko, gdy sterownik warpa zgłosi aktywność (setWarpLayerActive).
export const WARP_MEDIUM_RENDER_LAYER = 8;
// Tło menu głównego (menuBackdrop3D.js): Ziemia z ringiem w kamerze kinowej.
// Rysuje ją tylko renderBackdrop — passy gry tej warstwy nie widzą.
export const MENU_BACKDROP_LAYER = 9;
// Limity urządzenia brane z adaptera (PLAN §2, POSTEP § Limity): domyślne
// urządzenie WebGPU ma minimum ze specyfikacji — 8192 px tekstury (planety 8K,
// mapy ringu „Ultra” 16K), 16 tekstur i 16 varyingów na etap.
export const GPU_REQUIRED_LIMITS = Object.freeze([
  'maxTextureDimension2D', 'maxTextureArrayLayers', 'maxSampledTexturesPerShaderStage',
  'maxInterStageShaderVariables', 'maxVertexAttributes', 'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage', 'maxColorAttachmentBytesPerSample', 'maxBufferSize',
  'maxStorageBufferBindingSize', 'maxComputeInvocationsPerWorkgroup', 'maxComputeWorkgroupStorageSize',
  'maxComputeWorkgroupSizeX', 'maxComputeWorkgroupSizeY'
]);
// Tarcze: własna warstwa ortho (kamera ortho, bez czyszczenia głębi). Tarcza
// to emisja (blend addytywny), a nie powierzchnia oświetlana słońcem — maski
// cienia nie czyta i świeci w cieniu planety tak samo jak poza nim.
const SHIELD_RENDER_LAYER = 7;
// Warstwy rysowane kamerą ortho (reszta — perspektywą): świat gry, ring-planety,
// tarcze. Rozgrzewka passa (prewarmPass) bierze z tego kamerę dla warstwy.
const ORTHO_PASS_LAYERS = new Set([0, RING_PLANET_RENDER_LAYER, SHIELD_RENDER_LAYER, FX_DISTORT_LAYER]);
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

// Pole przesłaniające zastępcze (1×1, T = 1 = pełne słońce), dopóki właściciel pola nie
// poda swojej tekstury: węzeł tekstury potrzebuje przy budowie tekstury tego samego rodzaju
// (2D, filtr liniowy); przy uFieldOccOn = 0 i tak nic jej nie czyta.
function createFieldOccPlaceholderTexture() {
  const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.name = 'Core3D.sunOcclusionField:zastepcza';
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

// Wyjście passa = MASKA (sunShadowMask.js): R = cień powierzchni (tarcze + kadłuby
// + pole), G = smuga tła (R + ringi), B = mrok gęstego pola; 0 = pełne słońce.
// Port 1:1 dawnego fragmentu GLSL (te same wzory w tej samej kolejności), bez gałęzi
// podzielonego ekranu (split = dwa renderSingle, każdy liczy swoją maskę — zadanie 01).
function shadowShaftsMaskNode(u) {
  const uSunActive = uniformNode(u.uSunActive);
  const uShaftGain = uniformNode(u.uShaftGain);
  const uSunWorld = uniformNode(u.uSunWorld);
  const uCamCenter = uniformNode(u.uCamCenter);
  const uViewWorldSize = uniformNode(u.uViewWorldSize);
  const uDiscLenMul = uniformNode(u.uDiscLenMul);
  const uDiscCount = uniformNode(u.uDiscCount);
  const uDiscs = uniformNode(u.uDiscs);
  const uRingCount = uniformNode(u.uRingCount);
  const uRings = uniformNode(u.uRings);
  const uFieldOcc = uniformNode(u.uFieldOcc);
  const uFieldOccOn = uniformNode(u.uFieldOccOn);
  const uFieldOccRect = uniformNode(u.uFieldOccRect);
  const hullUniforms = {
    uHullSdf: uniformNode(u.uHullSdf), uHullCount: uniformNode(u.uHullCount), uHullSteps: uniformNode(u.uHullSteps),
    uHullLenMul: uniformNode(u.uHullLenMul), uHullA: uniformNode(u.uHullA), uHullM: uniformNode(u.uHullM), uHullC: uniformNode(u.uHullC)
  };

  return Fn(() => {
    const out = vec4(0.0, 0.0, 0.0, 1.0).toVar('maskOut');
    If(uSunActive.notEqual(0), () => {
      // UV kwadu WebGPU ma v = 0 u GÓRY celu; świat liczymy jak GLSL z v od dołu —
      // wiersz 0 maski (góra) = największe y sceny, jak u materiałów czytających ją po
      // screenUV (też od góry). Orientację pilnuje scripts/webgpu/maska-slonca.mjs.
      const uvGl = vec2(uv().x, float(1.0).sub(uv().y));
      const worldP = uCamCenter.add(uvGl.sub(0.5).mul(uViewWorldSize)).toVar('maskWorldP');

      // Kierunek do słońca liczony PER PIKSEL (nie per kamera) — poprawna
      // paralaksa smug przy okluderach blisko słońca.
      const toSun = uSunWorld.sub(worldP).toVar();
      const sunDist = length(toSun).toVar();
      If(sunDist.greaterThanEqual(1.0), () => {
        const d = toSun.div(sunDist).toVar();
        const shadow = float(0.0).toVar('maskShadow');
        const insideDisc = float(0.0).toVar();

        // ── Dyski: planety, księżyce, największe asteroidy ───────────────
        // Wnętrze tarczy pomijane (along <= exitDist) — dzienna strona
        // planety zostaje przy własnym oświetleniu z jej shadera.
        // disc.w = siła cienia: planeta 1,0 (umbra), asteroida ~0,5 (skala
        // skały nie uzasadnia czarnej dziury w mgławicy).
        Loop({ start: int(0), end: uDiscCount, type: 'int', condition: '<', name: 'discIdx' }, ({ discIdx }) => {
          const disc = uDiscs.element(discIdx).toVar();
          const discR = disc.z.toVar();
          If(discR.lessThanEqual(0.0), () => { Continue(); });
          const axis = disc.xy.sub(uSunWorld).toVar();
          const axisLen = length(axis).toVar();
          If(axisLen.lessThan(1.0), () => { Continue(); });
          axis.divAssign(axisLen);
          const rel = worldP.sub(disc.xy).toVar();
          If(dot(rel, rel).lessThan(discR.mul(discR)), () => { insideDisc.assign(1.0); });
          const along = dot(rel, axis).toVar();
          If(along.lessThanEqual(0.0), () => { Continue(); });
          const perp = abs(dot(rel, vec2(axis.y.negate(), axis.x))).toVar();
          const exitDist = sqrt(max(discR.mul(discR).sub(perp.mul(perp)), 0.0)).toVar();
          If(along.lessThanEqual(exitDist), () => { Continue(); });
          const fallT = clamp(along.sub(exitDist).div(max(discR.mul(uDiscLenMul), 1.0)), 0.0, 1.0).toVar();
          const fall = float(1.0).sub(smoothstep(0.55, 1.0, fallT));
          // Rozmycie rośnie po ZNORMALIZOWANEJ długości smugi, więc po jej
          // skróceniu musi rosnąć wolniej — inaczej stożek rozlewa się na boki
          // zamiast być smugą.
          const soft = discR.mul(fallT.mul(0.14).add(0.04)).toVar();
          const edge = float(1.0).sub(smoothstep(discR.sub(soft), discR.add(soft), perp));
          shadow.assign(max(shadow, edge.mul(fall).mul(max(disc.w, 0.0))));
        });

        // ── Kadłuby statków: pole odległości sylwetki ───────────────────
        // hullSdfShadow (hullShadowSdf.js) idzie po SDF kadłuba promieniem
        // do słońca, więc smuga zaczyna się na burcie i obejmuje kolce oraz
        // rozwidlenia. Piksele na WŁASNYM kadłubie są pomijane — łańcuch
        // kapsuł pomijał tylko wnętrze tej samej kapsuły i każda rzucała cień
        // na kadłub pod sąsiednią.
        // Statek nie robi czarnej dziury jak planeta — smuga tylko przygasza.
        shadow.assign(max(shadow, hullSdfShadow(hullUniforms, worldP, d, sunDist).mul(HULL_SHADOW_STRENGTH)));

        // ── Pole przesłaniające słońce (gęsty pas asteroid) ─────────────
        // Transmitancja wzdłuż promienia do słońca liczona na CPU; tu tylko
        // mnoży widoczność — kadłuby, odłamki i skały gry gasną w głębi pola.
        // Kanał B = mrok pola (1 − T): w nim gaśnie też otoczenie (sunFill),
        // bo w rdzeniu pola nie ma już pyłu oświetlonego słońcem. Tekstura
        // = DataTexture (v = 0 w pierwszym wierszu danych, y świata rośnie z v).
        const fieldDark = float(0.0).toVar();
        If(uFieldOccOn.greaterThan(0.5), () => {
          const fuv = worldP.sub(uFieldOccRect.xy).mul(uFieldOccRect.zw).toVar();
          If(fuv.x.greaterThanEqual(0.0).and(fuv.y.greaterThanEqual(0.0)).and(fuv.x.lessThanEqual(1.0)).and(fuv.y.lessThanEqual(1.0)), () => {
            const fieldT = texture(uFieldOcc, fuv, float(0)).r.toVar();
            shadow.assign(float(1.0).sub(float(1.0).sub(shadow).mul(fieldT)));
            fieldDark.assign(float(1.0).sub(fieldT));
          });
        });

        // Cień POWIERZCHNI (kanał R) kończy się tutaj: tarcze + kadłuby + pole.
        const surfaceShadow = float(shadow).toVar();

        // ── Pierścienie (ring „Halo” wokół planety) — tylko smuga TŁA ─────
        // Okrąg to ściana 2D ze słońcem w płaszczyźnie gry. Ring liczy własne
        // słońce (zaćmienie + cień ścian, słońce 49°) i ten okrąg mu przeczy:
        // gasił wewnętrzną połowę ringu i statki między nim a planetą. Zostaje
        // tylko w kanale tła (G).
        // Piksele wewnątrz tarczy planety pomijamy: pas cienia ringu na
        // POWIERZCHNI rysuje analityczny term w shaderze planety (uRingShadow*)
        // — bez tego pas byłby liczony podwójnie.
        If(insideDisc.lessThan(0.5), () => {
          Loop({ start: int(0), end: uRingCount, type: 'int', condition: '<', name: 'ringIdx' }, ({ ringIdx }) => {
            const ring = uRings.element(ringIdx).toVar();
            const ringR = ring.z.toVar();
            If(ringR.lessThanEqual(0.0), () => { Continue(); });
            const rel = worldP.sub(ring.xy).toVar();
            const b = dot(rel, d).toVar();
            const c2 = dot(rel, rel).sub(ringR.mul(ringR)).toVar();
            const discriminant = b.mul(b).sub(c2).toVar();
            If(discriminant.lessThanEqual(0.0), () => { Continue(); });
            const sq = sqrt(discriminant).toVar();
            // wewnątrz okręgu: wyjście w stronę słońca; na zewnątrz: wejście
            const tHit = select(c2.lessThan(0.0), b.negate().add(sq), b.negate().sub(sq)).toVar();
            If(tHit.lessThanEqual(0.0).or(tHit.greaterThanEqual(sunDist)), () => { Continue(); });
            const ringShade = float(1.0).sub(smoothstep(0.0, max(ring.w, 1.0), tHit)).mul(0.85);
            shadow.assign(max(shadow, ringShade));
          });
        });

        const surfaceOut = clamp(surfaceShadow, 0.0, 1.0).mul(uShaftGain).toVar();
        const backdropOut = clamp(shadow, 0.0, 1.0).mul(uShaftGain).toVar();
        // Maska ma 8 bitów: długi gradient smugi na mgławicy robiłby schodki.
        // Statyczny szum ±0,5/255 (bez czasu — nie pełza), tylko pod smugą,
        // żeby pełne słońce zostało dokładnym zerem. Piksel jak gl_FragCoord
        // WebGL (y od dołu celu) — ten sam wzór szumu co w bazie.
        const fragCoordGl = vec2(screenCoordinate.x, screenSize.y.sub(screenCoordinate.y));
        const dither = fract(float(52.9829189).mul(fract(dot(fragCoordGl, vec2(0.06711056, 0.00583715))))).sub(0.5).div(255.0).toVar();
        surfaceOut.assign(select(surfaceOut.greaterThan(0.0), clamp(surfaceOut.add(dither), 0.0, 1.0), float(0.0)));
        backdropOut.assign(select(backdropOut.greaterThan(0.0), clamp(backdropOut.add(dither), 0.0, 1.0), float(0.0)));
        out.assign(vec4(surfaceOut, backdropOut, clamp(fieldDark, 0.0, 1.0).mul(uShaftGain), 1.0));
      });
    });
    return out;
  })();
}

// Pass maski widoczności słońca: QuadMesh + NodeMaterial do sunShadowTarget (RGBA8, bez
// MSAA i głębi, NoBlending — quad nadpisuje każdy teksel). Uniformy w kształcie
// `material.uniforms` (adapter uniformy.js) — _renderSunShadowMask ustawia `.value` jak na
// WebGL; tablice (dyski, kadłuby A/M/C, ringi) to uniformArray (`.value` → Vector4 gry,
// Vector4.set w miejscu, pakowane raz na render — jeden quad na render). Bufory uniformów
// etapu fragmentów: grupa obiektu + 5 tablic = 6 (limit 12).
export function createShadowShaftsPass() {
  const v4 = (n) => Array.from({ length: n }, () => new THREE.Vector4(0, 0, 0, 0));
  const uniforms = uniformsAdapter({
    uSunActive: uniform(0, 'int'),
    uShaftGain: uniform(1.0),
    uSunWorld: uniform(new THREE.Vector2(0, 0)),
    uCamCenter: uniform(new THREE.Vector2(0, 0)),
    uViewWorldSize: uniform(new THREE.Vector2(1, 1)),
    uDiscLenMul: uniform(5.0),
    uDiscCount: uniform(0, 'int'),
    uDiscs: uniformArray(v4(SHAFT_DISC_CAP), 'vec4'),
    uHullLenMul: uniform(3.0),
    uHullCount: uniform(0, 'int'),
    uHullSteps: uniform(24, 'int'),
    // Kadłuby: tablica warstw SDF (HullShadowSdf.texture — ustawiana w render(), do tego
    // czasu zastępcza tego samego rodzaju) i A/M/C na statek, układ jak w hullSdfShadow.
    uHullSdf: texture(createHullSdfPlaceholderTexture(), vec2(0.5)),
    uHullA: uniformArray(v4(SHAFT_HULL_CAP), 'vec4'),
    uHullM: uniformArray(v4(SHAFT_HULL_CAP), 'vec4'),
    uHullC: uniformArray(v4(SHAFT_HULL_CAP), 'vec4'),
    uRingCount: uniform(0, 'int'),
    // uRings[i]: xy = środek (three-space), z = promień pasma, w = zasięg cienia
    uRings: uniformArray(v4(SHAFT_RING_CAP), 'vec4'),
    // Pole przesłaniające słońce (gęste pola asteroid): tekstura transmitancji T (R8)
    // wokół kamery; xy = róg prostokąta (three-space), zw = 1 / rozmiar. Mnoży
    // widoczność w obu kanałach.
    uFieldOcc: texture(createFieldOccPlaceholderTexture(), vec2(0.5)),
    uFieldOccOn: uniform(0.0),
    uFieldOccRect: uniform(new THREE.Vector4(0, 0, 1, 1))
  });
  const material = new THREE.NodeMaterial();
  material.name = 'Core3D.sunShadowMask';
  material.uniforms = uniforms;
  material.fragmentNode = shadowShaftsMaskNode(uniforms);
  material.blending = THREE.NoBlending;
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.lights = false;
  const quad = new THREE.QuadMesh(material);
  quad.name = 'Core3D.sunShadowMask';
  return {
    name: 'shadowShafts', bucket: 'shafts', enabled: true, quad, material,
    hullSdfPlaceholder: uniforms.uHullSdf.value, fieldOccPlaceholder: uniforms.uFieldOcc.value
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

// Pełnoekranowy quad (QuadMesh + materiał węzłowy) dokładany do bieżącego celu —
// halo planet w passach sceny. Backend WebGPU trzyma zawartość celu MSAA między
// render() (storeOp store, SPIKE 4b), więc quad z blendingiem pisze wprost do
// composerTarget; obejście z WebGL (inwalidacja renderbuffera po resolve) znika.
function makeFullscreenBlendPass(name, bucket, sourceTexture, blendConfig) {
  const material = new THREE.NodeMaterial();
  material.name = name;
  material.fragmentNode = texture(sourceTexture);
  material.depthTest = false;
  material.depthWrite = false;
  material.transparent = true;
  material.fog = false;
  material.lights = false;
  Object.assign(material, blendConfig);
  const quad = new THREE.QuadMesh(material);
  quad.name = name;
  return { name, bucket, enabled: true, quad, material };
}

// Pass sceny: jedna warstwa, kamera ortho albo perspektywa passów Core3D, do
// bieżącego celu (composerTarget). clearColor = czyści kolor i głębię (tło),
// clearDepth = sama głębia; tarcze bez czyszczenia — testują głębię passa ortho.
function makeScenePass(name, bucket, layer, isOrtho, clearColor, clearDepth = true) {
  return { name, bucket, layer, ortho: isOrtho, clearColor, clearDepth, enabled: true };
}

function recordRenderDbg(name, ms) {
  const fn = (typeof globalThis !== 'undefined') ? globalThis.__renderDbgRecord : null;
  if (typeof fn !== 'function') return;
  if (!Number.isFinite(ms) || ms < 0) return;
  fn(name, ms);
}

// Gotowość urządzenia: Core3D.ready rozwiązuje się raz — true (WebGPU gotowe)
// albo false (brak WebGPU: gra pokazuje komunikat, renderer nie powstaje).
let resolveGpuReady = null;
const gpuReadyPromise = new Promise((resolve) => { resolveGpuReady = resolve; });

export const Core3D = {
  activeCam1: { x: 0, y: 0, zoom: 1 },
  // Druga kamera podzielonego ekranu (window.camera2) — ustawia ją syncCamera;
  // passy jej nie czytają: split to dwa renderSingle + wycinki (drawHexShips3D).
  activeCam2: null,

  canvas: null, renderer: null, scene: null, cameraOrtho: null, cameraPersp: null,
  // Część synchroniczna init() (scena, kamery, cele) → isInitialized; urządzenie
  // WebGPU → gpuReady / ready (render, kompilacja, wgrywanie tekstur czekają).
  ready: gpuReadyPromise, gpuReady: false, gpuUnsupported: false, gpuError: null,
  shadowCatcher: null, shadowCatcherFg: null, shadowCatchersDebug: false,
  composerTarget: null, _scenePasses: null, _post: null,
  planetHaloTarget: null, haloDepthMaskMaterial: null,

  renderPassBg: null, renderPassPlanets: null, planetHaloPass: null, renderPassRingPlanets: null, renderPassWarp: null, renderPassOrtho: null, renderPassShields: null, renderPassFg: null,
  heatHazeSources: null, heatHazeDirs: null, heatHazeCount: 0, heatHazeMaxSources: MAX_HEAT_HAZE_SOURCES, _heatHazeWorldScratch: new THREE.Vector3(),
  // shadowShaftsPass (QuadMesh + NodeMaterial, createShadowShaftsPass) pisze maskę
  // widoczności słońca do sunShadowTarget (RGBA8, rozmiar bufora sceny, bez MSAA) —
  // patrz sunShadowMask.js; materiały czytają ją po screenUV.
  shadowShaftsPass: null, sunShadowTarget: null,
  // Światło z mapą cienia (słońce gry, planet3d.assets.js): odświeżane raz na
  // klatkę na starcie render() — w WebGPU cień jest per światło (SPIKE 9).
  _sunShadowLight: null,
  // Analityczne okludery shaftów, zgłaszane co klatkę przez systemy gry:
  // dyski (planet3d.assets + asteroidField3D), kapsuły (hexShips3D),
  // pierścienie (ringi „Halo”, haloRingGame.js — Map po kluczu ringu, bez begin/reset).
  shaftDiscs: new Float32Array(SHAFT_DISC_CAP * 4), shaftDiscCount: 0,
  sunOcclusionField: null,
  shaftHulls: new Float32Array(SHAFT_HULL_CAP * HULL_SDF_OCCLUDER_FLOATS), shaftHullCount: 0,
  shaftHullTexture: null,
  shaftRings: new Map(),
  // Czy na warstwach planet / halo / ring-planet / tarcz jest w tej klatce coś
  // widocznego. Pusty pass to i tak pełny obchód grafu sceny, a do celu MSAA
  // także resolve + invalidate (three robi je na końcu KAŻDEGO render()).
  // Flagi ustawiają właściciele: planet3d.assets.js (tym samym cullingiem, którym
  // chowa planety) i shield3D.js — zachowawczo, w razie wątpliwości true. Ośrodek
  // warpa (warstwa 8) — odwrotnie: tylko gdy sterownik warpa zgłosi go w tej klatce.
  layerActivity: { planets: true, halo: true, ringPlanets: true, shields: true, warp: false },
  // Bloom: BloomGry (BloomNode three + zgodność z dawnym passem WebGL, tsl/postGry.js)
  // w grafie postu; siła / promień / próg to uniformy (_applyBloomPassConfig co klatkę
  // z bloomConfig.js albo tunera DevVFX.bloom), rozmiar = bufor rysowania ×
  // resolutionScale w każdym renderze. Powstaje z urządzeniem (_createPost).
  bloomPass: null, bloomResolutionScale: BLOOM_DEFAULTS.resolutionScale, bloomBaseStrength: BLOOM_DEFAULTS.strength, bloomBaseThreshold: BLOOM_DEFAULTS.threshold,
  // Post: dwa RenderPipeline zbudowane raz — z bloomem (_post) i bez (_postBezBloomu,
  // perfToggles.bloom = false: bez kosztu passów bloomu, bez przebudowy przy
  // przełączeniu). Wspólne uniformy „uber” (gorące powietrze, uHeatOn zamiast define).
  _postBezBloomu: null, _postUniforms: null,
  // Pomiar bloomu: jego passy lecą w updateBefore węzła, W ŚRODKU renderu postu —
  // haki BloomGry liczą je do kubełka 'bloom', a _renderPost odejmuje je od 'post'.
  _onBloomRenderBegin: null, _onBloomRenderEnd: null, _bloomT0: 0,
  _bloomInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 },
  _bloomInfoDelta: { calls: 0, triangles: 0, points: 0, lines: 0, ms: 0 },
  msaaSamples: 0,
  // Zegar GPU. Timery per pass mierzą czas CPU wokół pracy asynchronicznej, więc
  // gdy wąskim gardłem staje się karta, blokada wypada w losowym draw callu i
  // rozmazuje się po wszystkich passach — trzy razy w tej sesji wyglądało to jak
  // "wszystko nagle zwolniło 5x przy identycznej liczbie wywołań". To jest
  // jedyny pomiar, który rozstrzyga CPU vs GPU. WebGPU: znaczniki czasu
  // (trackTimestamp, cecha timestamp-query) rozwiązywane asynchronicznie —
  // najwyżej jedno zapytanie w locie na typ (render / compute), bez narastania
  // Promise (SPIKE 8); wynik = ms GPU ostatniej rozwiązanej klatki.
  gpuFrameMs: 0,
  gpuComputeMs: 0,
  _gpuTimerPending: { render: false, compute: false },
  _gpuTimerFrame: -1,
  _gpuTimerGateFrame: -1,
  _gpuTimestampFeature: false,
  _onGpuRenderTimestamp: null,
  _onGpuComputeTimestamp: null,
  _onGpuTimestampError: null,
  perfToggles: { bloom: true, heatHaze: true, fxDistortion: true, shadowShafts: true, threeShadows: true, bgPass: true, planetPass: true, orthoPass: true, fgPass: true, fgBuildings: true, fgStations: true, fgWeapons: true, fgShadows: true, enginePointLights: false },
  shadowShaftsQuality: 'medium',
  _shaftCfg: resolveShadowShaftsQuality('medium'),
  _passTogglesDirty: true,
  pixelRatio: 1, width: 0, height: 0, isInitialized: false,
  _clearColorScratch: new THREE.Color(),
  lastFramePerf: null,
  lastFrameRenderInfo: null,
  _renderInfoBefore: { calls: 0, triangles: 0, points: 0, lines: 0 },
  _renderInfoStart: { calls: 0, triangles: 0, points: 0, lines: 0 },
  _renderInfoFrame: -1,
  _renderInfoBucketNames: ['refraction', 'bg', 'planets', 'shafts', 'warp', 'ortho', 'fg', 'bloom', 'post', 'other'],
  // window.__rendererInfo — jeden obiekt na sesję (harness i PerfHUD go czytają).
  _rendererInfoOut: { calls: 0, triangles: 0, points: 0, lines: 0, passes: null },
  // Infrastruktura efektów GPU (zadanie 12-B, src/3d/fx/fxFrame.js, docs/webgpu/FX-INFRA.md): kroki
  // compute raz na klatkę przed passami (addFxStep), początek pul i zegar efektów (fx.origin, fx.time),
  // siatka świateł (fx.grid; renderer.lighting = GridLighting „optIn”), światła efektów (fx.lights),
  // źródła zniekształceń w „uber” (fxDistortion()) i warstwa DIST (FX_DISTORT_LAYER → distortionTarget).
  // fxStats — pomiar klatki (PerfHUD, harness).
  fx: null, fxStats: null, distortionTarget: null,

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

  // Na starcie render() / renderBackdrop(): kubełki na zero, stan liczników
  // renderera zapamiętany (suma = przyrost od tej chwili). Liczniki three zerujemy
  // RAZ na klatkę rAF (info.frame), nie na każdy render: podzielony ekran to dwa
  // renderSingle w klatce, a uid zapytań czasu GPU zawiera render.frameCalls —
  // reset w środku klatki dawał drugiej połówce te same uid (ms pierwszej ginęły).
  _beginRenderInfo() {
    const renderer = this.renderer;
    const frame = renderer.info.frame;
    if (frame !== this._renderInfoFrame) {
      renderer.info.reset();
      this._renderInfoFrame = frame;
    }
    this._resetRenderInfoBuckets();
    this._readRenderInfoInto(this._renderInfoStart);
  },

  _resetRenderInfoBuckets() {
    const info = this._ensureRenderInfoBuckets();
    this._zeroRenderInfoBucket(info.total);
    for (const name of this._renderInfoBucketNames) this._zeroRenderInfoBucket(info[name]);
  },

  // Liczniki renderera (info.autoReset = false, reset ręczny raz na klatkę —
  // _beginRenderInfo). WebGPU: draw calle = render.drawCalls — render.calls liczy
  // wywołania render() i reset() go nie zeruje (SPIKE 14). Pole `calls` kubełków
  // zostaje (harness i PerfHUD czytają window.__rendererInfo.calls).
  _readRenderInfoInto(target) {
    const src = this.renderer?.info?.render;
    target.calls = Number(src?.drawCalls) || 0;
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
    bucket.calls += Math.max(0, (Number(current?.drawCalls) || 0) - before.calls);
    bucket.triangles += Math.max(0, (Number(current?.triangles) || 0) - before.triangles);
    bucket.points += Math.max(0, (Number(current?.points) || 0) - before.points);
    bucket.lines += Math.max(0, (Number(current?.lines) || 0) - before.lines);
    bucket.ms += Math.max(0, Number(elapsedMs) || 0);
  },

  _finalizeRenderInfoBuckets() {
    const info = this._ensureRenderInfoBuckets();
    const total = this._readRenderInfoInto(info.total);
    const start = this._renderInfoStart;
    total.calls = Math.max(0, total.calls - start.calls);
    total.triangles = Math.max(0, total.triangles - start.triangles);
    total.points = Math.max(0, total.points - start.points);
    total.lines = Math.max(0, total.lines - start.lines);
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

  // Strojenie bloomu na żywo: węzły strength / radius / threshold BloomNode to
  // uniformy (.value — bez przebudowy pipeline'u), skala rozdzielczości wchodzi przy
  // najbliższym renderze bloomu (BloomGry.setSize).
  _applyBloomPassConfig() {
    const bloom = this.bloomPass;
    if (!bloom) return;
    const cfg = this._getBloomConfig();
    // Podbicie bloomu od efektów tej klatki (błysk Supernowej — Core3D.fx.post, zadanie 19).
    bloom.strength.value = cfg.strength + (Number(this.fx?.post?.bloomBoost) || 0);
    bloom.radius.value = cfg.radius;
    bloom.threshold.value = cfg.threshold;
    bloom.resolutionScale = cfg.resolutionScale;
  },

  // Haki pomiaru bloomu (przypięte raz w init — bez domknięć per klatka).
  _bloomRenderBegin() {
    this._readRenderInfoInto(this._bloomInfoBefore);
    this._bloomT0 = performance.now();
  },

  _bloomRenderEnd() {
    const ms = performance.now() - this._bloomT0;
    const before = this._bloomInfoBefore;
    const cur = this.renderer?.info?.render;
    const d = this._bloomInfoDelta;
    d.calls += Math.max(0, (Number(cur?.drawCalls) || 0) - before.calls);
    d.triangles += Math.max(0, (Number(cur?.triangles) || 0) - before.triangles);
    d.points += Math.max(0, (Number(cur?.points) || 0) - before.points);
    d.lines += Math.max(0, (Number(cur?.lines) || 0) - before.lines);
    d.ms += Math.max(0, ms);
    this._addRenderInfoDelta('bloom', ms, before);
  },

  // Passy bloomu siedzą w przyroście renderu postu (updateBefore węzła) — już
  // policzone w 'bloom', więc zdejmujemy je z 'post' (zostaje sam uber).
  _takeBloomOutOfPost() {
    const d = this._bloomInfoDelta;
    const post = this.lastFrameRenderInfo?.post;
    if (!post || !(d.calls > 0 || d.ms > 0)) return;
    post.calls = Math.max(0, post.calls - d.calls);
    post.triangles = Math.max(0, post.triangles - d.triangles);
    post.points = Math.max(0, post.points - d.points);
    post.lines = Math.max(0, post.lines - d.lines);
    post.ms = Math.max(0, post.ms - d.ms);
  },

  // Część synchroniczna: scena, kamery, światła, cele renderu, passy — moduły
  // wołają Core3D.init() i od razu dokładają obiekty (hexShips3D, planety, ring),
  // więc isInitialized = true zaraz po niej. Urządzenie WebGPU powstaje w tle
  // (_initGpu): gpuReady / ready bramkują wszystko, co go potrzebuje — render,
  // renderBackdrop, kompilację (prewarmPass), wgrywanie tekstur.
  init(canvasElement) {
    if (this.isInitialized) return this;

    this.canvas = canvasElement || document.getElementById('webgl-layer');

    const dpr = (typeof window !== 'undefined' ? Number(window.devicePixelRatio) : 1) || 1;
    this.pixelRatio = Math.min(1.0, Math.max(1, dpr));

    this.scene = new THREE.Scene();
    this.scene.background = null;
    // Jedna scena obsluguje 6 passow sceny + pre-pass halo + snapshot refrakcji,
    // czyli do 11 wywolan renderer.render(scene, ...) na klatke. Kazde z nich
    // robi scene.updateMatrixWorld(), a ten ZAWSZE schodzi do wszystkich dzieci
    // (takze niewidocznych) i dla kazdego wezla z matrixAutoUpdate=true robi
    // matrix.compose() + multiplyMatrices — nic sie nie cache'uje miedzy
    // przejsciami. Przy ~1000 wezlow (2 na cialo heksowe, pule asteroid, miasto
    // ringu) to byl caly rzad wielkosci pracy na darmo.
    // Aktualizujemy wiec macierze RECZNIE, raz na klatke, na gorze render().
    // Kto rusza transformem PO tym momencie (syncCamera -> shadowCatcher, pule
    // krokow efektow — np. rakiety, src/3d/rockets/), odswieza swoje wezly sam.
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

    const w0 = Math.max(1, window.innerWidth | 0);
    const h0 = Math.max(1, window.innerHeight | 0);

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

    // Bufor sceny: HalfFloat (HDR-first, próg bloomu ~0,9) + MSAA 4. Wszystkie
    // passy sceny piszą do niego; backend WebGPU trzyma MSAA między render()
    // (storeOp store) i rozwiązuje go do .texture na końcu każdego passa.
    const rt = new THREE.RenderTarget(w0, h0, {
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: true, stencilBuffer: false, samples: 4
    });
    this.composerTarget = rt;
    this.msaaSamples = Number(rt.samples) || 0;
    // Te same próbki co scena: przy samples=0 krawędź maski halo ząbkowała
    // inaczej niż wygładzona MSAA krawędź planety = przerywana obwódka na limbie.
    this.planetHaloTarget = new THREE.RenderTarget(w0, h0, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      samples: rt.samples
    });
    // Fala uderzeniowa z refrakcją (shockwave3D.js, snapshot sceny w połowie rozdzielczości)
    // usunięta w zadaniu 19: fale, implozja i gorące powietrze idą przez zniekształcenia
    // efektów (src/3d/fx/distortion.js — sama refrakcja, bez świecącego obrysu).
    // Maska widoczności słońca (sunShadowMask.js): rozmiar bufora sceny, żeby
    // piksel materiału trafiał w teksel 1:1 — w połowie rozdzielczości brzeg
    // kadłuba po stronie cienia łapał ciemną obwódkę z sąsiedniego teksela.
    this.sunShadowTarget = new THREE.RenderTarget(w0, h0, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: false,
      stencilBuffer: false,
      samples: 0
    });
    // Materiały wiążą cel maski dopiero po pierwszym jej narysowaniu (_renderSunShadowMask) —
    // do tego czasu maska zastępcza i uSunShadowOn = 0.
    sunShadowUniforms.uSunShadowMap.value = SUN_SHADOW_MAP_PLACEHOLDER;
    sunShadowUniforms.uSunShadowOn.value = 0;
    // Efekty GPU (fxFrame.js): klatka efektów przeżywa ponowny init (kroki i pule zostają).
    // Warstwa DIST: przesunięcie w px (osie sceny) w RG HalfFloat, rozmiar bufora sceny.
    this.fx = this.fx || new FxFrame();
    this.fxStats = this.fx.stats;
    this.distortionTarget = new THREE.RenderTarget(w0, h0, {
      format: THREE.RGFormat, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      generateMipmaps: false, depthBuffer: false, stencilBuffer: false, samples: 0
    });
    // Pre-pass halo: głębia planet bez koloru (overrideMaterial, SPIKE 12).
    this.haloDepthMaskMaterial = new THREE.MeshBasicNodeMaterial({ color: 0x000000 });
    this.haloDepthMaskMaterial.name = 'Core3D.haloDepthMask';
    this.haloDepthMaskMaterial.colorWrite = false;
    this.haloDepthMaskMaterial.depthWrite = true;
    this.haloDepthMaskMaterial.depthTest = true;

    // Passy sceny — wszystkie do JEDNEGO composerTarget (MSAA), w tej kolejności.
    //
    // Earth and Mars use an orthographic planet pass so their projected centre
    // and radius stay locked to the gameplay ring at every zoom level. The pass
    // still renders the real sphere/cloud/atmosphere meshes; only parallax is
    // removed. Later world/foreground passes clear depth and draw over the globe.
    //
    // Halo planet to quad blendowany addytywnie (nie pass czytający bufor
    // sceny) — patrz makeFullscreenBlendPass.
    //
    // Cieni słońca NIE MA w tym łańcuchu: pass maski liczy ją przed nim, a
    // materiały czytają ją same (sunShadowMask.js) — kadłub gasi tylko człon
    // słońca, tło dostaje smugę, emitery i ring nic. Dawniej był tu quad mnożący
    // gotowy obraz po warstwie 0: broń i dysze, które na niej siedzą, spadały
    // w umbrze pod próg bloomu, a ring dostawał drugi cień.
    //
    // Tarcze: własny pass zamiast warstwy FG, bo tarcza musi zostać w projekcji
    // ortho (kopuła/sfera w perspektywie rozjeżdżałaby się z kadłubem); bez
    // czyszczenia głębi — tarcza testuje głębię względem kadłubów zamiast kłaść
    // się na wszystkim.
    //
    // Warp „Nurt” (zadanie 22, src/3d/warp/): ośrodek (miliony drobin, compute) to pass
    // PERSPEKTYWICZNY warstwy 8 po planetach, przed ortho — pod płaszczyzną gry, addytywnie
    // (głębia = paralaksa), tylko gdy sterownik warpa zgłosi aktywność (setWarpLayerActive).
    // Zgięcie tła (bańka, szczeliny) liczy materiał mgławicy (skyBend.js) — zgina się tylko ona,
    // jak w demie; osobnego passa zgięcia i celu pośredniego nie ma. Fale warpa = źródła
    // zniekształceń „uber” (fxDistortion, zadanie 12). Szczeliny, błyski, smugi sylwetki —
    // warstwa 0 (ortho); odsłanianie, szew i żar — materiał kadłuba (hexShips3D.tsl.js).
    this.renderPassBg = makeScenePass('bg', 'bg', 1, false, true);
    this.renderPassPlanets = makeScenePass('planets', 'planets', PLANET_RENDER_LAYER, false, false);
    this.planetHaloPass = makeFullscreenBlendPass('Core3D.planetHaloBlend', 'planets', this.planetHaloTarget.texture, BLEND_ADD_ONE_ONE);
    this.renderPassRingPlanets = makeScenePass('ringPlanets', 'planets', RING_PLANET_RENDER_LAYER, true, false);
    // Bez czyszczenia głębi: ośrodek jej nie testuje ani nie pisze (ortho i tak ją czyści).
    this.renderPassWarp = makeScenePass('warp', 'warp', WARP_MEDIUM_RENDER_LAYER, false, false, false);
    this.renderPassOrtho = makeScenePass('ortho', 'ortho', 0, true, false);
    this.renderPassShields = makeScenePass('shields', 'ortho', SHIELD_RENDER_LAYER, true, false, false);
    this.renderPassFg = makeScenePass('fg', 'fg', 2, false, false);
    this._scenePasses = [
      this.renderPassBg,
      this.renderPassPlanets,
      this.planetHaloPass,
      this.renderPassRingPlanets,
      this.renderPassWarp,
      this.renderPassOrtho,
      this.renderPassShields,
      this.renderPassFg
    ];

    this.heatHazeSources = new Float32Array(this.heatHazeMaxSources * 4);
    this.heatHazeDirs = new Float32Array(this.heatHazeMaxSources * 2);

    // Maska słońca: pass TSL do sunShadowTarget (graf budowany raz; urządzenia nie
    // potrzebuje — pipeline powstaje przy pierwszym renderze).
    this.shadowShaftsPass = createShadowShaftsPass();

    const bloomCfg = this._getBloomConfig();
    this.bloomResolutionScale = bloomCfg.resolutionScale;

    // Handlery zegara GPU i pomiaru bloomu przypięte raz (bez domknięć per klatka).
    this._onGpuRenderTimestamp = (ms) => this._handleGpuTimestamp('render', ms);
    this._onGpuComputeTimestamp = (ms) => this._handleGpuTimestamp('compute', ms);
    this._onGpuTimestampError = () => {
      this._gpuTimerPending.render = false;
      this._gpuTimerPending.compute = false;
    };
    this._onBloomRenderBegin = () => this._bloomRenderBegin();
    this._onBloomRenderEnd = () => this._bloomRenderEnd();

    this._applyPassToggles();
    this.isInitialized = true;
    this.resize(window.innerWidth, window.innerHeight);

    if (this.renderer) {
      // Ponowny init po _disposeComposerChain: urządzenie zostaje, nowy post.
      this._post = this._createPost(this.renderer);
      return this;
    }
    this._initGpu().then(
      (ok) => resolveGpuReady?.(ok),
      (err) => { this._failGpu(err); resolveGpuReady?.(false); }
    );
    return this;
  },

  // Tylko WebGPU (decyzja użytkownika, PLAN §2 / §12 p. 2): przed utworzeniem
  // renderera adapter; bez niego renderer nie powstaje i gra pokazuje komunikat
  // „Gra wymaga przeglądarki z WebGPU” (index.html, Core3D.ready → false).
  // Zapasowego backendu WebGL2 three nie dopuszczamy (_getFallback = null,
  // po init() warunek backend.isWebGPUBackend).
  async _initGpu() {
    const gpu = (typeof navigator !== 'undefined') ? navigator.gpu : null;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return this._failGpu('brak navigator.gpu');
    let adapter = null;
    try {
      // Te same opcje co WebGPUBackend.init — limity z tego adaptera są ważne dla jego urządzenia.
      adapter = await gpu.requestAdapter({ featureLevel: 'compatibility' });
    } catch (err) {
      adapter = null;
    }
    if (!adapter) return this._failGpu('brak adaptera');
    const requiredLimits = {};
    for (const key of GPU_REQUIRED_LIMITS) {
      const value = adapter.limits?.[key];
      if (Number.isFinite(value)) requiredLimits[key] = value;
    }
    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas, alpha: true, antialias: false, trackTimestamp: true, requiredLimits
    });
    // Bez zapasowego backendu: nieudane urządzenie = odrzucone init(), nie WebGL2.
    renderer._getFallback = null;
    // Siatka świateł jako system oświetlenia (tryb „optIn” — fxFrame.js) PRZED init():
    // three r183 łapie renderer.lighting w init() (RenderLists) — podmiana później nic nie zmienia.
    this.fx?.attach(renderer, this);
    // Liczniki per klatka zeruje render() — przy autoReset = true wewnętrzna pętla
    // renderera zerowałaby je co rAF (SPIKE 14).
    renderer.info.autoReset = false;
    try {
      await renderer.init();
    } catch (err) {
      return this._failGpu(`init urządzenia: ${err?.message || err}`);
    }
    if (renderer.backend?.isWebGPUBackend !== true) return this._failGpu('backend nie jest WebGPU');
    this._configureRenderer(renderer);
    this.renderer = renderer;
    this._post = this._createPost(renderer);
    // Pieczenia SDF kadłubów wgrywają pojedyncze warstwy (uploadTextureLayer) zamiast całej tablicy.
    HullShadowSdf.layerUploader = (tex, layer) => this.uploadTextureLayer(tex, layer);
    this.gpuReady = true;
    this._passTogglesDirty = true;
    this._applyPassToggles();
    this._scheduleTextureUpload();
    // Rozgrzewka kroków efektów zarejestrowanych przed urządzeniem (puste dispatche, prewarmPass).
    this.fx?.warmAll();
    // Rejestr rozgrzewki pipeline'ów (src/3d/rozgrzewka.js, zadanie 11): wpisy modułów i passy Core3D w tle.
    this._registerPassWarmups();
    this.warmup.start();
    return true;
  },

  // Kamera i cel rozgrzewki dla warstwy passa (Core3D.warmup — src/3d/rozgrzewka.js), jak w prewarmPass:
  // typ kamery passa warstwy ('all' = perspektywa), cel composerTarget (warstwa DIST — distortionTarget).
  warmupCamera(layer, ortho) {
    const isOrtho = typeof ortho === 'boolean' ? ortho : (layer !== 'all' && ORTHO_PASS_LAYERS.has(layer));
    return this.getPassCamera(isOrtho);
  },
  warmupTarget(layer) {
    return layer === FX_DISTORT_LAYER && this.distortionTarget ? this.distortionTarget : this.composerTarget;
  },

  // Passy Core3D w rejestrze rozgrzewki (zadanie 11). W tle menu: to, co już widać w passach tła i planet (mgławica,
  // gwiazdy, planety, słońce, poświaty, ring-planety — przed pierwszą klatką gry culling niczego nie chowa), pre-pass
  // głębi halo (materiał zastępczy) i pełnoekranowe quady halo i maski słońca. Na ekranie ładowania (flush) — wszystkie
  // passy jeszcze raz (świat ortho, tarcze, FG). Tylko obiekty widoczne; rozgrzane wcześniej się nie powtarzają.
  _registerPassWarmups() {
    const w = this.warmup;
    if (!w || w._passWarmups) return;
    w._passWarmups = true;
    const scene = () => this.scene;
    for (const layer of [1, PLANET_RENDER_LAYER, PLANET_HALO_RENDER_LAYER, RING_PLANET_RENDER_LAYER]) {
      w.add({ name: `Core3D: warstwa ${layer}`, objects: scene, layer, visible: false });
    }
    w.add({ name: 'Core3D: pre-pass głębi halo', objects: scene, layer: PLANET_RENDER_LAYER, visible: false, split: false, override: this.haloDepthMaskMaterial });
    w.add({ name: 'Core3D: quad halo planet', objects: () => this.planetHaloPass?.quad });
    w.add({ name: 'Core3D: quad maski słońca', objects: () => this.shadowShaftsPass?.quad, target: () => this.sunShadowTarget });
    for (const layer of [0, SHIELD_RENDER_LAYER, 2, 1, PLANET_RENDER_LAYER, PLANET_HALO_RENDER_LAYER, RING_PLANET_RENDER_LAYER]) {
      w.add({ name: `Core3D: warstwa ${layer} (start gry)`, objects: scene, layer, visible: false, phase: 'loading' });
    }
  },

  _failGpu(reason) {
    this.gpuUnsupported = true;
    this.gpuReady = false;
    this.gpuError = String(reason?.message || reason || 'nieznany powód');
    if (typeof console !== 'undefined') console.warn(`[Core3D] Gra wymaga przeglądarki z WebGPU — ${this.gpuError}`);
    return false;
  },

  _configureRenderer(renderer) {
    // Precyzja (PLAN §4): modelViewMatrix składana na CPU w double — świat przy
    // 5–10 mln j. nie drga względem kadłubów. Wchodzi w program przy budowie
    // materiału, więc przed pierwszym renderem.
    renderer.highPrecision = true;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.info.autoReset = false;
    // Cecha timestamp-query (backend po init: trackTimestamp && hasFeature) — zapamiętana,
    // bo brama znaczników (_gpuTimerGate) przełącza flagę backendu na pojedyncze klatki.
    this._gpuTimestampFeature = renderer.backend?.trackTimestamp === true;
    installPlaceholders(renderer);
    this._guardPendingPipelines(renderer);
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(Math.max(1, this.width | 0), Math.max(1, this.height | 0), false);
  },

  // three r183: compileAsync wkłada do cache pipeline, którego obiekt GPU dopiero
  // powstaje (createRenderPipelineAsync). Zwykły render obiektu o tym samym kluczu
  // pipeline'u — a zamienniki i materiały wbudowane dzielą programy — woła wtedy
  // setPipeline(undefined) → TypeError i klatka pada (dym gry: rozgrzewka na ekranie
  // ładowania + render tła menu). Taki rysunek pomijamy, aż pipeline będzie gotowy
  // (klatka, dwie) — jak asynchroniczna kompilacja programu na WebGL. Bez alokacji:
  // backend.draw i tak pobiera te same dane pipeline'u.
  _guardPendingPipelines(renderer) {
    const backend = renderer?.backend;
    if (!backend || typeof backend.draw !== 'function' || backend.__core3dPendingPipelineGuard) return;
    const draw = backend.draw;
    backend.draw = function drawWhenPipelineReady(renderObject, info) {
      const pipelineData = this.get(renderObject.pipeline);
      if (pipelineData.pipeline === undefined && pipelineData.error !== true) return undefined;
      return draw.call(this, renderObject, info);
    };
    backend.__core3dPendingPipelineGuard = true;
    // three r183 połyka odrzucenie createRenderPipelineAsync (GPUPipelineError, np.
    // „Vertex buffer count (9) exceeds the maximum number of vertex buffers (8)”):
    // pusty catch, a błąd nie trafia do zakresu błędów walidacji — pipeline zostaje
    // „w budowie” na zawsze i osłona wyżej po cichu pomija rysunek (zadanie 04:
    // odłamki kadłubów znikały bez śladu). Błąd do konsoli (harness liczy go w
    // `bledy`), raz na etykietę pipeline'u; rysunek dalej pominięty.
    const device = backend.device;
    if (device && typeof device.createRenderPipelineAsync === 'function' && !device.__core3dPipelineErrorLog) {
      const createAsync = device.createRenderPipelineAsync.bind(device);
      const reported = new Set();
      device.createRenderPipelineAsync = (descriptor) => createAsync(descriptor).catch((err) => {
        const label = descriptor?.label || '?';
        if (!reported.has(label)) {
          reported.add(label);
          console.error(`[Core3D] pipeline „${label}” nie powstał: ${err?.message || err}`);
        }
        throw err;
      });
      device.__core3dPipelineErrorLog = true;
    }
  },

  // Post (tsl/postGry.js), kolejność jak dawny łańcuch WebGL resolve → bloom → uber:
  // bufor sceny (MSAA rozwiązane do .texture) → bloom (BloomGry z bloomConfig.js) →
  // „uber”: gorące powietrze przesuwa odczyt sceny RAZEM z bloomem, dyspersja dysz,
  // ACES gry → LinearTosRGB → kanwa. Dwa RenderPipeline (z bloomem i bez) zbudowane
  // raz — perfToggles.bloom wybiera w _renderPost, bez przebudowy i bez kosztu
  // bloomu, gdy wyłączony. outputColorTransform = false: renderer ma NoToneMapping
  // i wyjście liniowe, transformacji three nie dokładamy (byłaby podwójna).
  _createPost(renderer) {
    const cfg = this._getBloomConfig();
    const sceneTexture = this.composerTarget.texture;
    // Siatka bezpieczeństwa (12-B): NaN / ±Inf bufora sceny → 0 przed bloomem (i w „uber”) —
    // pojedynczy NaN w HalfFloat rozlewał bloom na cały ekran.
    const bloom = new BloomGry(hdrBezpieczny(texture(sceneTexture)), cfg.strength, cfg.radius, cfg.threshold);
    bloom.resolutionScale = cfg.resolutionScale;
    bloom.onRenderBegin = this._onBloomRenderBegin;
    bloom.onRenderEnd = this._onBloomRenderEnd;
    const uniforms = createPostUniforms();
    // Zniekształcenia efektów (fxFrame.js): blok źródeł i warstwa DIST — wspólne dla obu pipeline'ów.
    const distortion = this.fx ? this.fx.distortion.node : null;
    const distortionLayer = this.distortionTarget ? this.distortionTarget.texture : null;
    const post = new THREE.RenderPipeline(renderer, createUberPost({ sceneTexture, bloomTexture: bloom.getTextureNode(), uniforms, distortion, distortionLayer }));
    post.outputColorTransform = false;
    const postBezBloomu = new THREE.RenderPipeline(renderer, createUberPost({ sceneTexture, bloomTexture: null, uniforms, distortion, distortionLayer }));
    postBezBloomu.outputColorTransform = false;
    this.bloomPass = bloom;
    this._postUniforms = uniforms;
    this._postBezBloomu = postBezBloomu;
    return post;
  },

  _disposeComposerChain() {
    try {
      try { this.planetHaloPass?.material?.dispose?.(); } catch { }
      try { this.shadowShaftsPass?.material?.dispose?.(); } catch { }
      try { this._post?.dispose?.(); } catch { }
      try { this._postBezBloomu?.dispose?.(); } catch { }
      try { this.bloomPass?.dispose?.(); } catch { }
      try { this.sunShadowTarget?.dispose?.(); } catch { }
      try { this.distortionTarget?.dispose?.(); } catch { }
      try { this.composerTarget?.dispose?.(); } catch { }
      try { this.planetHaloTarget?.dispose?.(); } catch { }
      try { this.haloDepthMaskMaterial?.dispose?.(); } catch { }
    } catch { }
    this.isInitialized = false;
    this._post = null;
    this._postBezBloomu = null;
    this._postUniforms = null;
    this.bloomPass = null;
    this.shadowShaftsPass = null;
    this.sunShadowTarget = null;
    this.distortionTarget = null;
    // Węzeł tekstury nie przyjmuje null — materiały wracają do maski zastępczej.
    sunShadowUniforms.uSunShadowMap.value = SUN_SHADOW_MAP_PLACEHOLDER;
    sunShadowUniforms.uSunShadowOn.value = 0;
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
    if (this.renderPassPlanets) this.renderPassPlanets.enabled = t.planetPass !== false;
    if (this.planetHaloPass) this.planetHaloPass.enabled = t.planetPass !== false;
    if (this.renderPassRingPlanets) this.renderPassRingPlanets.enabled = t.planetPass !== false;
    if (this.renderPassOrtho) this.renderPassOrtho.enabled = t.orthoPass !== false;
    if (this.renderPassShields) this.renderPassShields.enabled = t.orthoPass !== false;
    if (this.renderPassFg) this.renderPassFg.enabled = t.fgPass !== false;
    if (this.shadowShaftsPass) this.shadowShaftsPass.enabled = t.shadowShafts !== false;
    // Post (ACES gry + sRGB) jest zawsze; bloom i gorące powietrze przełącza sam post
    // (_renderPost: pipeline z bloomem albo bez, uHeatOn) — bez przebudowy.
    // Mapa cienia: w WebGPU odświeżanie jest per światło (_requestSunShadowUpdate) —
    // globalnie tylko włącznik.
    if (this.renderer?.shadowMap) this.renderer.shadowMap.enabled = t.threeShadows !== false;
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
    // bloom / heatHaze czyta render() co klatkę (wybór pipeline'u postu, uniform
    // uHeatOn) — przełączenie nie przebudowuje pipeline'ów.
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

  // Rozmiar kanwy i celów. Renderer może jeszcze nie istnieć (urządzenie w
  // drodze) — wtedy _configureRenderer weźmie zapamiętany rozmiar.
  resize(w, h) {
    if (!this.isInitialized) return;
    const width = Math.max(1, w | 0);
    const height = Math.max(1, h | 0);
    this.pixelRatio = Math.min(1.5, Math.max(1, (typeof window !== 'undefined' ? window.devicePixelRatio : 1)));
    this.width = width; this.height = height;
    if (this.renderer) {
      this.renderer.setPixelRatio(this.pixelRatio);
      this.renderer.setSize(width, height, false);
    }
    const bufW = Math.max(1, Math.floor(width * this.pixelRatio));
    const bufH = Math.max(1, Math.floor(height * this.pixelRatio));
    if (this.composerTarget) this.composerTarget.setSize(bufW, bufH);
    if (this.sunShadowTarget) this.sunShadowTarget.setSize(bufW, bufH);
    if (this.distortionTarget) this.distortionTarget.setSize(bufW, bufH);

    if (this.planetHaloTarget) {
      this.planetHaloTarget.setSize(bufW, bufH);
    }
    // Bloom sam bierze rozmiar bufora rysowania w każdym renderze (BloomNode.updateBefore);
    // tu tylko skala rozdzielczości (tuner zmienia bloomResolutionScale i woła resize).
    if (this.bloomPass) this.bloomPass.resolutionScale = Math.max(0.1, Math.min(1, Number(this.bloomResolutionScale) || 1));
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

  // Czy renderer mierzy czas GPU (cecha timestamp-query; PerfHUD pokazuje stan).
  // Zapamiętane przy starcie urządzenia — brama (_gpuTimerGate) wyłącza
  // backend.trackTimestamp na pojedyncze klatki.
  get gpuTimerSupported() {
    return this._gpuTimestampFeature === true;
  },

  // Zegar GPU: po klatce (koniec render / renderBackdrop) rozwiązanie zapytań —
  // najwyżej jedno w locie na typ, nowe dopiero po rozwiązaniu poprzedniego.
  // Zapytania kumulują się do rozwiązania (pula 2048 = 1024 rendery), więc
  // rozwiązujemy stale; wynik three = suma ms GPU OSTATNIEJ klatki w paczce
  // (passy Core3D + rendery modułów w tej klatce, np. pieczenie map ringu).
  // Podzielony ekran to dwa renderSingle w klatce — pytamy po drugim, żeby
  // ostatnia klatka paczki była pełna.
  _gpuTimerAfterRender() {
    const renderer = this.renderer;
    if (!renderer) return;
    const frame = renderer.info.frame;
    const firstOfFrame = frame !== this._gpuTimerFrame;
    this._gpuTimerFrame = frame;
    const split = typeof window !== 'undefined' && !!window.splitScreenMode;
    if (!split || !firstOfFrame) this._gpuTimerPoll();
  },

  // Wynik zapytania: ms ostatniej klatki paczki. Pula three trzyma ms KAŻDEGO
  // renderu w mapie `timestamps` (klucz = uid z numerem klatki) i nigdy jej nie
  // czyści — przy rozwiązywaniu co klatkę rosłaby bez końca (~700 wpisów/s),
  // a gra używa tylko sumy klatki: czyścimy po każdym wyniku.
  _handleGpuTimestamp(type, ms) {
    this._gpuTimerPending[type] = false;
    if (Number.isFinite(ms) && ms > 0) {
      if (type === 'render') this.gpuFrameMs = ms;
      else this.gpuComputeMs = ms;
    }
    this.renderer?.backend?.timestampQueryPool?.[type]?.timestamps?.clear?.();
  },

  // Brama znaczników czasu na granicy klatki rAF (start render / renderBackdrop).
  // Pula three ma 2048 zapytań (2 na pass), a wynik zlecenia przychodzi po kilku–
  // kilkudziesięciu klatkach (harness headless: ~70 klatek, ~200 ms); klatka to dziś
  // ~25 passów (sceny, 12 bloomu, post), więc pula się przepełniała — three ostrzegało
  // „Maximum number of queries exceeded”, a passy po przepełnieniu dostawały indeks
  // null → pisały znaczniki do slotów 0/1 (psuły pierwszy pomiar paczki). Gdy w puli
  // brak miejsca na całą klatkę: bez wiszącego zlecenia — nowe od razu (zeruje pulę
  // synchronicznie), z wiszącym — ta klatka bez znaczników (backend.trackTimestamp =
  // false: initTimestampQuery nic nie dopisuje do passów), wynik zlecenia odblokowuje.
  // Zmierzone klatki zostają pełne; PerfHUD dostaje wynik rzadziej.
  _gpuTimerGate() {
    const renderer = this.renderer;
    const backend = renderer?.backend;
    if (!backend || this._gpuTimestampFeature !== true) return;
    const frame = renderer.info.frame;
    if (frame === this._gpuTimerGateFrame) return;
    this._gpuTimerGateFrame = frame;
    backend.trackTimestamp = true;
    const pool = backend.timestampQueryPool?.render;
    if (!pool || !(pool.maxQueries > 0)) return;
    if (pool.maxQueries - pool.currentQueryIndex >= GPU_TIMER_FRAME_QUERIES) return;
    if (!this._gpuTimerPending.render) this._gpuTimerPoll();
    else backend.trackTimestamp = false;
  },

  _gpuTimerPoll() {
    const renderer = this.renderer;
    const backend = renderer?.backend;
    if (!backend || backend.trackTimestamp !== true) return;
    const pools = backend.timestampQueryPool;
    const pending = this._gpuTimerPending;
    if (!pending.render && pools?.render) {
      pending.render = true;
      renderer.resolveTimestampsAsync('render').then(this._onGpuRenderTimestamp, this._onGpuTimestampError);
    }
    if (!pending.compute && pools?.compute) {
      pending.compute = true;
      renderer.resolveTimestampsAsync('compute').then(this._onGpuComputeTimestamp, this._onGpuTimestampError);
    }
  },

  // Słońce gry z mapą cienia (planet3d.assets.js, DirectSun) zgłasza się tu.
  // W WebGPU odświeżanie mapy jest per światło (renderer.shadowMap ma tylko
  // enabled / type): autoUpdate = false, needsUpdate raz na starcie render().
  // ShadowNode i tak aktualizuje najwyżej raz na klatkę rAF (SPIKE 9) — dawne
  // dwa odświeżenia z WebGL (przed ortho i FG) są zbędne.
  setSunShadowLight(light) {
    this._sunShadowLight = (light && light.isLight && light.shadow) ? light : null;
    if (this._sunShadowLight) this._sunShadowLight.shadow.autoUpdate = false;
  },

  _requestSunShadowUpdate(toggles) {
    const light = this._sunShadowLight;
    if (!light || !light.castShadow || !light.shadow) return;
    light.shadow.autoUpdate = false;
    if (toggles.threeShadows !== false) light.shadow.needsUpdate = true;
  },

  // Maska widoczności słońca (sunShadowMask.js): uniformy okluderów i jeden
  // quad do sunShadowTarget. Bez słońca, przy shaftach Off albo w wolnej kamerze
  // maska jest wyłączona uniformem — materiały dostają wtedy pełne słońce.
  // Materiały czytają maskę po screenUV (rozmiar aktualnego celu), więc snapshot
  // refrakcji w połowie rozdzielczości nie potrzebuje osobnego teksela.
  _renderSunShadowMask(active, sun, shaftCfg) {
    const pass = this.shadowShaftsPass;
    const target = this.sunShadowTarget;
    // Pole przesłaniające słońce to mechanika (ciemno w głębi pola), nie opcja
    // jakości: maska liczy się też przy wyłączonych smugach — wtedy bez tarcz,
    // kadłubów i ringów, sam term pola.
    const field = this.sunOcclusionField;
    const fieldOn = !!(field && field.texture && sun) && !this.isFreePerspectiveCamera();
    const raysOn = !!active && !!pass && pass.enabled !== false;
    if (!pass || !target || (!raysOn && !fieldOn)) {
      sunShadowUniforms.uSunShadowOn.value = 0;
      if (pass) pass.material.uniforms.uSunActive.value = 0;
      return false;
    }
    const uShafts = pass.material.uniforms;
    uShafts.uFieldOccOn.value = fieldOn ? 1 : 0;
    // Węzeł tekstury nie przyjmuje null — bez pola zastępcza (i tak nieczytana).
    uShafts.uFieldOcc.value = fieldOn ? field.texture : pass.fieldOccPlaceholder;
    if (fieldOn) {
      uShafts.uFieldOccRect.value.set(field.x0, field.y0, 1 / Math.max(1e-6, field.w), 1 / Math.max(1e-6, field.h));
    }
    const cam1 = this.activeCam1 || { x: 0, y: 0 };
    const zoom1 = Math.max(0.0001, Number(cam1.zoom) || 1);
    uShafts.uSunActive.value = 1;
    uShafts.uShaftGain.value = 1;
    uShafts.uSunWorld.value.set(sun.x, -sun.y);
    uShafts.uCamCenter.value.set(Number(cam1.x) || 0, -(Number(cam1.y) || 0));
    uShafts.uViewWorldSize.value.set(this.width / zoom1, this.height / zoom1);
    uShafts.uDiscLenMul.value = Math.max(1, Number(shaftCfg.discLenMul) || 5);
    uShafts.uHullLenMul.value = Math.max(1, Number(shaftCfg.capsuleLenMul) || 3);
    uShafts.uHullSteps.value = Math.max(1, Math.min(HULL_SDF_MAX_STEPS, Number(shaftCfg.hullSteps) || 24));

    const discCount = raysOn ? Math.min(this.shaftDiscCount | 0, SHAFT_DISC_CAP) : 0;
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
    const hullCount = (raysOn && this.shaftHullTexture)
      ? Math.min(this.shaftHullCount | 0, Math.max(0, Number(shaftCfg.capsuleBudget) || SHAFT_HULL_CAP), SHAFT_HULL_CAP)
      : 0;
    uShafts.uHullCount.value = hullCount;
    uShafts.uHullSdf.value = this.shaftHullTexture || pass.hullSdfPlaceholder;
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
      if (!raysOn || ringCount >= SHAFT_RING_CAP) break;
      if (!(rec.r > 0)) continue;
      ringVals[ringCount].set(rec.x, rec.y, rec.r, rec.reach);
      ringCount++;
    }
    uShafts.uRingCount.value = ringCount;

    // Quad do celu maski (NoBlending, każdy teksel nadpisany — bez czyszczenia);
    // kubełek 'shafts' w lastFrameRenderInfo (harness, PerfHUD).
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const before = this._renderInfoBefore;
    this._readRenderInfoInto(before);
    const t0 = performance.now();
    renderer.setRenderTarget(target);
    pass.quad.render(renderer);
    renderer.setRenderTarget(prevTarget);
    this._addRenderInfoDelta(pass.bucket, performance.now() - t0, before);
    sunShadowUniforms.uSunShadowMap.value = target.texture;
    sunShadowUniforms.uSunShadowOn.value = 1;
    return true;
  },

  // Jedna klatka: pre-pass halo, fale uderzeniowe, passy sceny do composerTarget,
  // post na kanwę. Kanwę kopiuje do #c drawHexShips3D W TYM SAMYM zadaniu JS
  // (po await kanwa WebGPU bywa już pusta — SPIKE 5). Przed gotowością
  // urządzenia nie robi nic (render() przed init() three rzuca / ostrzega).
  render() {
    if (!this.isInitialized || !this.gpuReady) return;
    const renderer = this.renderer;
    const dbgEnabled = typeof globalThis !== 'undefined' && typeof globalThis.__renderDbgRecord === 'function';
    const tRenderTotal0 = performance.now();
    this._gpuTimerGate();

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
    const freePerspective = this.isFreePerspectiveCamera();
    // Maska cieni mapuje świat gry 2D na ekran — w wolnej kamerze 3D jej nie ma.
    const raysEnabled = t.shadowShafts !== false && !freePerspective;
    const shaftCfg = this._shaftCfg || resolveShadowShaftsQuality(this.shadowShaftsQuality);

    // Warstwy bez widocznej zawartości (flagi od właścicieli). Wolna kamera lotu
    // nad miastem widzi scenę inaczej niż culling planet — tam rysujemy wszystko.
    const layerActivity = freePerspective ? LAYERS_ALL_ACTIVE : this.layerActivity;

    // Liczniki renderera zerujemy PRZED maską cieni, żeby jej quad trafił do
    // kubełka 'shafts' (pre-pass halo liczy się w 'other').
    this._beginRenderInfo();

    // Klatka efektów GPU (raz na klatkę rAF, przed passami): kroki compute, początek pul,
    // siatka świateł (fxFrame.js). Podzielony ekran: drugi renderSingle nic tu nie robi.
    this._runFxFrame(freePerspective);

    const prevAutoClear = renderer.autoClear;
    const prevClearAlpha = renderer.getClearAlpha();
    const prevClearColor = this._clearColorScratch;
    renderer.getClearColor(prevClearColor);
    // Czyszczenie tylko jawne (renderer.clear) — każdy render() dokłada do celu.
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;

    // Mapa cienia słońca: raz na klatkę, zanim pierwszy odbiorca ją przeczyta.
    this._requestSunShadowUpdate(t);

    // Maska widoczności słońca — PRZED pre-passem halo i passami sceny, bo
    // czytają ją materiały (kadłuby, tło, planety przy ringu, atmosfery).
    const sun = typeof window !== 'undefined' ? window.SUN : null;
    this._renderSunShadowMask(raysEnabled && !!sun, sun, shaftCfg);

    // Pre-pass halo tylko gdy planety są w ogóle renderowane — wcześniej te
    // 2 przejścia sceny wykonywały się ZAWSZE, nawet na ultrafast bez planet.
    // Ani gdy żadne ciało z poświatą nie jest w kadrze (bitwa w próżni): wtedy
    // pomijany jest też quad halo w _scenePasses, więc stary target nie wycieka.
    if (t.planetPass !== false && layerActivity.halo !== false && this.planetHaloTarget && this.planetHaloPass && this.haloDepthMaskMaterial) {
      this._renderPlanetHaloPrepass();
    }

    // Bloom: siła / promień / próg / skala z bloomConfig.js albo tunera (uniformy węzła).
    if (this.bloomPass && t.bloom !== false) this._applyBloomPassConfig();

    // Źródła gorącego powietrza: producenci (dysze, wybuchy, rakiety, tarcze)
    // tylko dorzucają, render zabiera wszystko, co uzbierało się od poprzedniej
    // klatki, do uniformów „uber” i kasuje licznik PRZY KONSUMPCJI (kasowanie u
    // producenta gubiło źródła z ticku overlaya, który leci już PO tym passie).
    // Mapowanie świat → ekran nie działa w wolnej kamerze 3D — tam bez zakłóceń.
    const nowSec = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
    const heatEnabled = t.heatHaze !== false && !freePerspective;
    this._updatePostUniforms(heatEnabled, heatEnabled ? this.heatHazeCount : 0, nowSec);
    this.heatHazeCount = 0;

    const tComposer0 = performance.now();

    // Scena → composerTarget (MSAA; backend rozwiązuje je do .texture na końcu
    // każdego passa), potem post bez MSAA na kanwę.
    this.syncCamera(this.activeCam1, this.composerTarget.width, this.composerTarget.height);
    renderer.setRenderTarget(this.composerTarget);
    for (const pass of this._scenePasses) {
      if (!pass || pass.enabled === false) continue;
      // Pusty pass (planety poza kadrem, zero widocznych tarcz) = zero pracy.
      if (!this._scenePassHasContent(pass, layerActivity)) continue;
      // Zgięcie tła warpa (zadanie 22) nie ma tu passa: w demie gnie się tylko mgławica, a pass tła
      // gry niesie też gwiazdy i dolną część ringu — zgina ją materiał mgławicy (skyBend.js).
      this._runScenePass(pass);
    }
    // Zniekształcenia efektów do „uber”: źródła rzutowane na kamerę tego renderu, warstwa DIST.
    this._renderFxDistortion(freePerspective || t.fxDistortion === false);
    renderer.setRenderTarget(null);
    this._renderPost();

    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    this._finalizeRenderInfoBuckets();
    const composerMs = performance.now() - tComposer0;
    const perf = this.lastFramePerf || (this.lastFramePerf = { renderTotalMs: 0, composerMs: 0 });
    perf.renderTotalMs = performance.now() - tRenderTotal0;
    perf.composerMs = composerMs;
    if (dbgEnabled) {
      recordRenderDbg('coreComposerRender', composerMs);
      recordRenderDbg('core3dRenderTotal', perf.renderTotalMs);
    }
    this._publishRendererInfo();
    this._gpuTimerAfterRender();
  },

  // Pass sceny albo pełnoekranowy quad; pomiar draw calli i czasu CPU do
  // kubełka passa (nazwy kubełków czytają harness i PerfHUD).
  _runScenePass(pass) {
    const renderer = this.renderer;
    const before = this._renderInfoBefore;
    this._readRenderInfoInto(before);
    const t0 = performance.now();
    if (pass.quad) {
      pass.quad.render(renderer);
    } else {
      if (pass.clearColor) {
        renderer.setClearColor(0x000000, 0.0);
        renderer.clear(true, true, true);
      } else if (pass.clearDepth) {
        renderer.clear(false, true, false);
      }
      const camera = this.getPassCamera(pass.ortho);
      camera.layers.set(pass.layer);
      renderer.render(this.scene, camera);
    }
    this._addRenderInfoDelta(pass.bucket, performance.now() - t0, before);
  },

  // Uniformy „uber” przed postem: źródła gorącego powietrza (≤ 24, dane z
  // pushHeatHazeWorld), uHeatOn = perfToggles.heatHaze (dawny define HEAT_HAZE),
  // zegar szumu, aspekt ekranu. nowSec niepodany = zegar bez zmian (tło menu).
  _updatePostUniforms(heatOn, sourceCount, nowSec) {
    const u = this._postUniforms;
    if (!u) return;
    const count = Math.max(0, Math.min(sourceCount | 0, this.heatHazeMaxSources | 0, MAX_HEAT_HAZE_SOURCES));
    u.uHeatOn.value = heatOn ? 1 : 0;
    u.uSourceCount.value = count;
    u.uGlobalStrength.value = 1.0;
    // Zawinięty zegar szumu: przy uTime·9,9 po godzinie gry hash tracił precyzję
    // float32 (kanciasty szum). Skok wzoru co 10 min jest niewidoczny.
    if (Number.isFinite(nowSec)) u.uTime.value = nowSec % 600;
    u.uAspect.value = this.width / Math.max(1, this.height);
    if (count > 0 && this.heatHazeSources && this.heatHazeDirs) {
      const dst = u.uHeatSources.value;
      const dstDirs = u.uHeatDirs.value;
      const src = this.heatHazeSources;
      const srcDirs = this.heatHazeDirs;
      for (let i = 0; i < count; i++) {
        const base = i * 4;
        dst[i].set(src[base], src[base + 1], src[base + 2], src[base + 3]);
        dstDirs[i].set(srcDirs[i * 2], srcDirs[i * 2 + 1]);
      }
    }
  },

  // Post na kanwę (bieżący cel = null): bloom (gdy włączony) i „uber”. Bloom liczy
  // się w updateBefore swojego węzła W ŚRODKU post.render() — haki BloomGry zbierają
  // jego passy do kubełka 'bloom', a _takeBloomOutOfPost zdejmuje je z 'post'.
  _renderPost() {
    const before = this._renderInfoBefore;
    this._readRenderInfoInto(before);
    const d = this._bloomInfoDelta;
    d.calls = 0; d.triangles = 0; d.points = 0; d.lines = 0; d.ms = 0;
    const post = (this.perfToggles?.bloom === false && this._postBezBloomu) ? this._postBezBloomu : this._post;
    const t0 = performance.now();
    post.render();
    this._addRenderInfoDelta('post', performance.now() - t0, before);
    this._takeBloomOutOfPost();
  },

  // Klatka efektów GPU (fxFrame.js) — raz na klatkę rAF, kamera gracza 1 (w podzielonym ekranie
  // siatka świateł obejmuje też kadr gracza 2: window.camera2). Pomiar w fxStats.
  _runFxFrame(freePerspective) {
    const fx = this.fx;
    if (!fx || !this.composerTarget) return;
    const split = typeof window !== 'undefined' && !!window.splitScreenMode;
    const cam2 = split && !freePerspective ? (window.camera2 || null) : null;
    fx.frame(this.renderer, this.activeCam1, cam2, this.composerTarget.width, this.composerTarget.height, !!freePerspective, performance.now());
  },

  // Na każdy render: źródła zniekształceń rzutowane na kamerę tego renderu (blok „uber”) i warstwa
  // DIST (FX_DISTORT_LAYER, kamera ortho) do distortionTarget — tylko gdy właściciel zgłosił w tej
  // klatce zawartość (setDistortLayerActive), inaczej „uber” jej nie próbkuje (uDistLayerOn = 0).
  _renderFxDistortion(off) {
    const fx = this.fx;
    const u = this._postUniforms;
    if (!fx || !u || !this.composerTarget) return;
    const w = this.composerTarget.width;
    const h = this.composerTarget.height;
    fx.commitDistortion(this.activeCam1, w, h, off, this.renderer?.info?.frame ?? 0);
    // Przygaszenie od efektów (implozja Supernowej, fx.post — gałąź efektów „uber”).
    if (u.uFxExposure) u.uFxExposure.value = off ? 1 : (Number(fx.post?.exposure) || 1);
    const target = this.distortionTarget;
    const layerOn = !off && fx.distortLayerActive === true && !!target;
    fx.stats.distortLayer = layerOn;
    u.uDistLayerOn.value = layerOn ? 1 : 0;
    if (!layerOn) return;
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const before = this._renderInfoBefore;
    this._readRenderInfoInto(before);
    const t0 = performance.now();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, false, false);
    const camera = this.getPassCamera(true);
    const prevMask = camera.layers.mask;
    camera.layers.set(FX_DISTORT_LAYER);
    renderer.render(this.scene, camera);
    camera.layers.mask = prevMask;
    renderer.setRenderTarget(prevTarget);
    this._addRenderInfoDelta('ortho', performance.now() - t0, before);
  },

  // Halo planet: głębia planet (warstwa 3, bez koloru) + poświaty (warstwa 5)
  // do planetHaloTarget; quad halo w passach sceny dokłada je addytywnie.
  _renderPlanetHaloPrepass() {
    const renderer = this.renderer;
    const scene = this.scene;
    const camera = this.cameraPersp;
    const target = this.planetHaloTarget;
    const prevOverrideMaterial = scene.overrideMaterial;
    const prevPerspLayerMask = camera.layers.mask;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, true, true);
    this.syncCamera(this.activeCam1, target.width, target.height);

    scene.overrideMaterial = this.haloDepthMaskMaterial;
    camera.layers.set(PLANET_RENDER_LAYER);
    renderer.render(scene, camera);

    scene.overrideMaterial = prevOverrideMaterial;
    camera.layers.set(PLANET_HALO_RENDER_LAYER);
    renderer.render(scene, camera);

    camera.layers.mask = prevPerspLayerMask;
  },

  _publishRendererInfo() {
    if (typeof window === 'undefined') return;
    // Expose renderer info for perf debugging — read with window.__rendererInfo
    const info = this.lastFrameRenderInfo?.total;
    const out = this._rendererInfoOut;
    out.calls = info ? info.calls : 0;
    out.triangles = info ? info.triangles : 0;
    out.points = info ? info.points : 0;
    out.lines = info ? info.lines : 0;
    out.passes = this.lastFrameRenderInfo;
    window.__rendererInfo = out;
  },

  // Podzielony ekran NIE jest jednym renderem: drawHexShips3D woła renderSingle
  // dla każdej kamery i kopiuje wycinki (clear() w WebGPU ignoruje nożyczki —
  // SPIKE 13; dawna ścieżka „split w jednym renderze” usunięta w porcie).
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

  // Tło menu głównego (menuBackdrop3D.js): ta sama scena, renderer i post co
  // gra (bloom z bloomConfig.js, ACES gry + sRGB), ale tylko warstwa
  // MENU_BACKDROP_LAYER i kamera kinowa tła. Bez passów gry, maski cieni,
  // refrakcji — przed startem gry nic ich nie zgłasza.
  renderBackdrop(camera) {
    if (!this.isInitialized || !this.gpuReady || !camera) return;
    const renderer = this.renderer;
    const tRenderTotal0 = performance.now();
    this._gpuTimerGate();
    if (this._passTogglesDirty) {
      this._applyPassToggles();
      this._passTogglesDirty = false;
    }
    this._syncSceneMatrices();
    this._beginRenderInfo();
    const prevAutoClear = renderer.autoClear;
    const prevClearAlpha = renderer.getClearAlpha();
    const prevClearColor = this._clearColorScratch;
    renderer.getClearColor(prevClearColor);
    const prevMask = camera.layers.mask;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.composerTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    camera.layers.set(MENU_BACKDROP_LAYER);
    this._readRenderInfoInto(this._renderInfoBefore);
    renderer.render(this.scene, camera);
    this._addRenderInfoDelta('bg', performance.now() - tRenderTotal0);
    camera.layers.mask = prevMask;
    if (this.bloomPass && this.perfToggles.bloom !== false) this._applyBloomPassConfig();
    // Tło menu: bez zniekształceń efektów i bez źródeł gorącego powietrza (przed startem gry
    // nic ich nie zgłasza).
    this._renderFxDistortion(true);
    this._updatePostUniforms(false, 0);
    renderer.setRenderTarget(null);
    this._renderPost();
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.autoClear = prevAutoClear;
    this._finalizeRenderInfoBuckets();
    const perf = this.lastFramePerf || (this.lastFramePerf = { renderTotalMs: 0, composerMs: 0 });
    perf.renderTotalMs = performance.now() - tRenderTotal0;
    perf.composerMs = 0;
    this._publishRendererInfo();
    this._gpuTimerPoll();
  },

  // Rozgrzewka pipeline'ów passa (PLAN §6): compileAsync odtwarza pass — kompiluje
  // dla BIEŻĄCEGO celu (format, MSAA), warstw kamery i frustum, pomija obiekty
  // niewidoczne. Tu: cel composerTarget, kamera passa z warstwą `layer`, obiekty
  // poddrzewa bez cullingu na czas projekcji (compileAsync projektuje
  // synchronicznie, gdy renderer jest gotowy — przełączniki widoczności wokół
  // wywołania działają). Nie blokuje: Promise<boolean>, błąd tylko do konsoli.
  // Przed gotowością urządzenia czeka na Core3D.ready (widoczność z tamtej chwili).
  // opts.camera — własna kamera (np. kinowa tła menu), opts.ortho — wymuszenie.
  prewarmPass(object3d, layer = 0, opts = {}) {
    if (!object3d) return Promise.resolve(false);
    if (!this.gpuReady) {
      if (this.gpuUnsupported) return Promise.resolve(false);
      return this.ready.then((ok) => (ok ? this.prewarmPass(object3d, layer, opts) : false));
    }
    const renderer = this.renderer;
    const isOrtho = typeof opts.ortho === 'boolean' ? opts.ortho : ORTHO_PASS_LAYERS.has(layer);
    const camera = opts.camera || this.getPassCamera(isOrtho);
    const prevMask = camera.layers.mask;
    const prevTarget = renderer.getRenderTarget();
    const culled = [];
    object3d.traverse((o) => {
      if (o.frustumCulled) {
        o.frustumCulled = false;
        culled.push(o);
      }
    });
    camera.layers.set(layer);
    renderer.setRenderTarget(this.composerTarget);
    // Warstwa DIST rysuje do własnego celu (RG HalfFloat bez MSAA i głębi) — inny klucz pipeline'u.
    if (layer === FX_DISTORT_LAYER && this.distortionTarget) renderer.setRenderTarget(this.distortionTarget);
    let promise;
    try {
      promise = renderer.compileAsync(object3d, camera, object3d.isScene ? null : this.scene);
    } catch (err) {
      promise = Promise.reject(err);
    } finally {
      for (let i = 0; i < culled.length; i++) culled[i].frustumCulled = true;
      camera.layers.mask = prevMask;
      renderer.setRenderTarget(prevTarget);
    }
    const done = promise.then(() => true, (err) => {
      console.warn('[Core3D] rozgrzewka passa nie wyszła:', err?.message || err);
      return false;
    });
    // flush() rejestru na ekranie ładowania czeka i na te pipeline'y (zadanie 11): pierwsza klatka gry
    // zapisująca do kolejki w trakcie ich kompilacji stawała na procesie GPU.
    return this.warmup ? this.warmup.track(done) : done;
  },

  // Jedna warstwa tablicy tekstur (DataArrayTexture) prosto na GPU — queue.writeTexture tej
  // warstwy. three r183 w WebGPU ignoruje texture.layerUpdates: needsUpdate wgrywa całą tablicę
  // (SDF kadłubów: 64 × 256² R8 = 4 MB, zmierzone ~3 ms CPU na każde pieczenie; jedna warstwa
  // to 64 KB). false = tablicy jeszcze nie ma na GPU albo czeka na pełne wgranie (needsUpdate
  // w toku) — wołający ustawia needsUpdate jak dotąd. Zapis idzie do kolejki urządzenia przed
  // najbliższym renderem (pieczenia lecą w updateHexShips3D, przed Core3D.render()).
  uploadTextureLayer(texture, layer) {
    const renderer = this.renderer;
    const backend = renderer?.backend;
    const queue = backend?.device?.queue;
    const image = texture?.image;
    const data = image?.data;
    if (!queue || !data || !texture.isDataArrayTexture || !(layer >= 0) || layer >= (image.depth | 0)) return false;
    const state = renderer._textures?.get?.(texture);
    const gpu = backend.get(texture);
    if (!state || state.initialized !== true || state.version !== texture.version || state.isDefaultTexture === true) return false;
    if (!gpu?.texture) return false;
    const texels = image.width * image.height;
    const bytesPerTexel = data.byteLength / (texels * image.depth);
    if (!(bytesPerTexel >= 1) || bytesPerTexel !== Math.floor(bytesPerTexel)) return false;
    queue.writeTexture(
      { texture: gpu.texture, mipLevel: 0, origin: { x: 0, y: 0, z: layer } },
      data,
      { offset: texels * bytesPerTexel * layer, bytesPerRow: image.width * bytesPerTexel, rowsPerImage: image.height },
      { width: image.width, height: image.height, depthOrArrayLayers: 1 }
    );
    return true;
  },

  // Maks. anizotropia próbkowania tekstur — także przed utworzeniem renderera
  // (tekstury planet i stacji powstają wcześniej niż urządzenie). Backend
  // WebGPU zwraca 16 (WebGL na tej karcie: też 16).
  getMaxAnisotropy() {
    const v = Number(this.renderer?.getMaxAnisotropy?.());
    return Number.isFinite(v) && v >= 1 ? v : 16;
  },

  beginShaftDiscFrame() { this.shaftDiscCount = 0; },
  // Pole przesłaniające słońce (gęste pola asteroid): tekstura transmitancji
  // (R, 1 = pełne słońce) na prostokącie w układzie sceny (x, −y świata).
  // Maska cienia mnoży nią widoczność słońca — wszystko, co czyta
  // sunVisibility()/sunShaftBackdrop(), ciemnieje w głębi pola. Właściciel
  // (asteroidBelt3D) ustawia co klatkę, gdy mapa się przesunie.
  setSunOcclusionField(texture, x0, y0, w, h) {
    if (!texture) { this.sunOcclusionField = null; return; }
    const f = this.sunOcclusionField || (this.sunOcclusionField = { texture: null, x0: 0, y0: 0, w: 1, h: 1 });
    f.texture = texture; f.x0 = x0; f.y0 = y0; f.w = w; f.h = h;
  },
  clearSunOcclusionField() { this.sunOcclusionField = null; },

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

  // Ośrodek warpa „Nurt” (warstwa 8, src/3d/warp/warpNurt.js): właściciel zgłasza co klatkę, czy
  // ośrodek jest widoczny — bez zgłoszenia pass warpa nic nie kosztuje (zero draw calli).
  setWarpLayerActive(active) { this.layerActivity.warp = !!active; },

  // ── Efekty GPU (zadanie 12-B, src/3d/fx/fxFrame.js — opis kroku i kontekstu tam) ──
  // Krok { name, spawn?(ctx), lights?(ctx), update?(ctx), warm?(ctx) } raz na klatkę przed
  // passami scen; warm raz przy gotowym urządzeniu (puste dispatche, prewarmPass siatek).
  addFxStep(step) { return this.fx ? this.fx.addStep(step) : step; },
  removeFxStep(step) { this.fx?.removeStep(step); },
  // Źródła zniekształceń tej klatki w świecie gry (shock / implode / heat — distortion.js);
  // dysze i tarcze zostają przy pushHeatHazeWorld.
  fxDistortion() { return this.fx ? this.fx.distortionSources() : null; },
  // Warstwa DIST (FX_DISTORT_LAYER): właściciel zgłasza co klatkę, czy ma widoczną zawartość.
  // Warstwa DIST: zgłoszenia właścicieli w klatce łączone przez OR (broń, rakiety, …) — FxFrame
  // kasuje flagę na starcie klatki efektów, właściciel zgłasza w swoim kroku (update).
  setDistortLayerActive(active) { if (this.fx && active) this.fx.distortLayerActive = true; },

  // Pass sceny bez widocznej zawartości pomijamy w całości.
  _scenePassHasContent(pass, activity) {
    if (pass === this.renderPassPlanets) return activity.planets !== false;
    if (pass === this.planetHaloPass) return activity.halo !== false;
    if (pass === this.renderPassRingPlanets) return activity.ringPlanets !== false;
    if (pass === this.renderPassShields) return activity.shields !== false;
    if (pass === this.renderPassWarp) return activity.warp === true;
    return true;
  },

  // Dawne API soczewki warpa (setWarpLensWorld, clearWarpLens, setWarpViewWorld, clearWarpView,
  // suppressShadowShafts, pushWarpSpaceWorld, pushWarpWaveWorld, setWarpStarsObject — no-opy od
  // zadania 01) usunięte w zadaniu 22 razem z warpLens3D / warpWorldLens / warpFx3D /
  // warpLensPass. Warp „Nurt”: setWarpLayerActive (ośrodek), addFxStep (krok compute),
  // fxDistortion (fale), materiał mgławicy i gwiazd (skyBend.js, stars.js), materiał kadłuba.

  beginShaftHullFrame() { this.shaftHullCount = 0; },

  // Ile kadłubów przyjmie pass shaftów w tej klatce. hexShips3D staje na
  // tej liczbie — nie ma sensu piec sylwetek, których pass i tak nie weźmie
  // (ani żadnych, gdy shafty są wyłączone albo leci wolna kamera).
  getShaftHullBudget() {
    const t = this.perfToggles || {};
    if (t.shadowShafts === false || this.isFreePerspectiveCamera()) return 0;
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
  // initTexture na wgranej teksturze tylko ją wiąże. initTexture wymaga gotowego
  // urządzenia: kolejka czeka na Core3D.ready (tekstury planet zgłaszają się,
  // zanim urządzenie powstanie).
  _textureUploadQueue: [],
  _textureUploadScheduled: false,
  _textureUploadWaiting: false,
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
    if (!this.gpuReady) {
      if (this._textureUploadWaiting || this.gpuUnsupported) return;
      this._textureUploadWaiting = true;
      this.ready.then((ok) => {
        this._textureUploadWaiting = false;
        if (ok) this._scheduleTextureUpload();
      });
      return;
    }
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

    // Źródło w UV całego kadru kamery gry. Podzielony ekran to dwa renderSingle
    // pełnego kadru (drawHexShips3D wycina środek każdego) — dawna gałąź „pół
    // ekranu na kamerę” z jednego renderu wkładała źródła w złe miejsce; zostaje
    // kamera gracza 1 (drugi widok gorącego powietrza nie dostaje — jak dotąd).
    this._pushHeatHazeForCamera(this.activeCam1, worldX, worldY, radiusWorld, strength, dirX, dirY);

    return true;
  },

  // Metoda zamiast domknięcia tworzonego przy każdym pushHeatHazeWorld.
  _pushHeatHazeForCamera(camData, worldX, worldY, radiusWorld, strength, dirX, dirY) {
    const zoom = Math.max(0.0001, camData.zoom || 1);
    const camW = this.width;
    const camH = this.height;
    const halfW = camW / 2 / zoom;
    const halfH = camH / 2 / zoom;

    const left = camData.x - halfW;
    const bottom = -(camData.y) - halfH;

    const worldW = halfW * 2;
    const worldH = halfH * 2;

    const u = (worldX - left) / worldW;
    const v = (worldY - bottom) / worldH;
    // Promien w jednostkach osi v: shader koryguje os u przez uAspect,
    // wiec mapowanie swiat->ekran jest izotropowe.
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

// Rejestr rozgrzewki pipeline'ów (zadanie 11): moduły zgłaszają się przy imporcie — `Core3D.warmup.add({...})`
// (src/3d/rozgrzewka.js, agents.md § Rozgrzewka); praca rusza przy gotowym urządzeniu (_initGpu).
Core3D.warmup = new Rozgrzewka(Core3D);
