// src/3d/bridge3D.js
//
// MODEL 3D MOSTKA — nadbudówka 3D na kadłubie (skóra sprite'a na silniku belek
// — hexShips3D.js). Geometria: bridge3DShapes.js. Stan (strefy, komórki siatki
// belek, oś czasu utraty dowodzenia) czyta z entity.bridgeState
// (src/game/shipBridge.js, shipBridgeBeams.js) — nic nie liczy od nowa i nic nie
// zmienia w gameplayu: obrażenia, kolizje i kill zostają w 2D. Opis i liczby:
// docs/PORT-mostki.md §8–9.
//
// RYSOWANIE (jeden renderer: Core3D; obiekty w podanej scenie):
//   • model — mesh instancjonowany na rodzaj (BRIDGE3D_KIND_ORDER: Terra Nova
//     na poziomy klas I–VI — tn_1 … tn_6, Iron Skull, Atlas rufowy i zapasowy,
//     fregata, niszczyciel i supercapital piratów, lokomotywa megafrachtowca): warstwa 0
//     (pass ortho, jak kadłuby), renderOrder 12 — rysuje się tylko rodzaj,
//     który ma widoczne instancje;
//   • cień na kadłubie — jeden mesh instancjonowany prostokątów tuż POD
//     kadłubem (renderOrder 11, test głębi GREATER): rysuje się tylko tam,
//     gdzie kadłub zapisał głębię, więc jest przycięty do sylwetki i nie wpada
//     w wyrwy. Kadłuby nie odbierają shadow map three.js — cień liczy marsz
//     po mapie wysokości modelu w stronę słońca;
//   • okna, lampy i listwy — jeden InstancedMesh na warstwie 2 (FG),
//     addytywnie, bez maski cienia: świecą też w cieniu planety.
//   Razem: widoczne rodzaje + 2 wywołania rysowania na całą flotę.
//
// PORT WEBGPU (zadanie 15): materiały w TSL (bridge3D.tsl.js) — jeden graf
// i jeden materiał bryły na wszystkie rodzaje (stałe rodzaju we wspólnej
// tablicy uniformów, rodzaj z danych instancji), meshe rodzajów i cienia to
// zwykłe Mesh z InstancedBufferGeometry (bez uuid obiektu w kluczu programu —
// jeden NodeBuilder i pipeline na całą flotę mostków). Dane instancji w jednym
// przeplecionym buforze na mesh (limit 8 buforów wierzchołków na pipeline).
//
// ŚWIATŁO: ten sam kierunek co kadłub (uLightDir = normalize(słońce − statek,
// z = 600) — słońce pada niemal poziomo) i te same stałe (otoczenie 0,24,
// rozproszone 1,18, połysk 0,30 — SHIP_LIGHT_DEFAULTS w hexShips3D.js).
// Dach modelu świeci jak kadłub pod środkiem strefy (hullLightAt — lustro
// „poduszkowej” normalnej HEX_FRAGMENT_SHADER), skosy od słońca dostają
// rozproszone. Przy tak niskim słońcu fizyczny cień miałby setki jednostek,
// a dachy i kadłub świecą niemal samym otoczeniem — dlatego cień rzucany
// liczymy ze „słońca cieni” (ten sam azymut, wysokość shadowElevDeg) i kładziemy
// go też na światło otoczenia (inaczej byłby niewidoczny).
//
// OBRAŻENIA: bufor obrażeń (storage u32 = RGBA8 w słowie, wiersz DAMAGE_W
// komórek — duży mostek zajmuje kilka kolejnych wierszy, blok leży w nich
// liniowo) trzyma stan komórek siatki belek pod modelem: R — żywa (HP), G — żar
// węzła (heat/heatStamp silnika), B — maska 8 martwych sąsiadów (boki
// i narożniki), A — świeże cięcie. Fragment modelu nad martwą komórką znika
// (wyrwa z poszarpanym brzegiem jak rozdarcia skóry kadłuba), brzeg przy martwym
// sąsiedzie ciemnieje i żarzy się jak brzeg rany kadłuba. Blok odświeża się tylko,
// gdy w ciele kadłuba zginął węzeł (ciało / activeNodes) albo co REFRESH_SEC, i na
// GPU idzie tylko on: jeden zakres bufora na rekord (writeBuffer). Dawniej tekstura
// RGBA8 768 × 512 — backend WebGPU ignoruje zakresy tekstur, więc każda zmiana
// wysyłałaby całe 1,5 MB (docs/PORT-mostki.md §8).
//
// WRAK (stan z shipBridgeBeams.js, docs/PORT-mostki.md § 9): komórki = kwadraty
// siatki belek (ix, iy) — tożsamość wspólna dla rodu (`hull.dmgKey`: kadłub, wrak,
// odłamy). convertToWreck oddaje wrakowi TO SAMO ciało silnika, więc gdy gospodarz
// zniknie, rekord znajduje nowego po komórkach rodu i zostaje na wraku — zgaszony,
// z wyrwami (łup do holowania). Tak samo przy rozpadzie kadłuba: część mostka na
// odłamku dostaje własny rekord.

import * as THREE from 'three/webgpu';
import { RenderWorld } from '../render/renderWorld.js';
import { Core3D } from './core3d.js';
import {
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  bridgeHash01,
  bridgeWaveDelay,
  sampleNavLight,
  sampleWindowLight
} from '../game/shipBridge.js';
import { resolveBridgeHullKey } from '../game/shipBridgeRuntime.js';
import { HULL_BODY_CONFIG } from '../game/hullBodies.js';
import {
  beamImageToLattice,
  beamLatticePose,
  beamLatticeToWorldPosed,
  bridgeBeamHull,
  bridgeCellNode
} from '../game/shipBridgeBeams.js';
import {
  BRIDGE3D_EMIT,
  BRIDGE3D_KINDS,
  BRIDGE3D_KIND_ORDER,
  buildBridgeModel,
  resolveBridgeModelKind
} from './bridge3DShapes.js';
import { bridgeHullFxScale, spawnBridgeRoomFlash } from './bridgeFx3D.js';
import { uniformsAdapter } from './tsl/uniformy.js';
import {
  B3_DAMAGE_W,
  B3_KIND_SLOT,
  B3_KIND_STRIDE,
  B3_MODEL_LAYOUT,
  B3_RECEIVER_LAYOUT,
  createBridge3DNodes,
  createBridgeEmitterMaterial,
  createBridgeModelMaterial,
  createBridgeReceiverMaterial,
  setInstanceLayout
} from './bridge3D.tsl.js';

// ---------------------------------------------------------------------------
// Strojenie (window.__bridge3DTune)
// ---------------------------------------------------------------------------

export const BRIDGE3D_TUNE = {
  enabled: true,
  // Cień rzucany (na kadłub i sam model).
  shadowElevDeg: 30,        // wysokość „słońca cieni” — azymut jak prawdziwe słońce
  shadowStrength: 0.5,      // przyciemnienie kadłuba w pełnym cieniu mostka
  shadowSoft: 0.1,          // półcień rośnie z odległością od przeszkody
  selfShadowAmbient: 0.55,  // ile cienia wpada w światło otoczenia na modelu
  aoRadius: 2.6,            // kontaktowe przyciemnienie u stóp brył
  aoStrength: 0.5,
  receiver: true,           // cień modelu na kadłubie
  drawModel: true,          // diagnostyka: rysowanie brył (CPU liczy dalej)
  drawEmitters: true,       // diagnostyka: rysowanie okien i lamp
  // Wygaszanie z odległością: szerokość strefy mostka na ekranie [px].
  // Poniżej ~20 px bryła nic nie dodaje, a tysiące pod-pikselowych trójkątów
  // z MSAA kosztowały najwięcej GPU (pomiar 174 okrętów: +0,58 ms przy 15 px).
  minPx: 18,
  fullPx: 30,
  lodPx: 70,                // mniejsza strefa: bez marszu cienia, AO i cienia na kadłubie
  // Okna (jak BRIDGE_FX_TUNE w bridgeFx3D.js — te same pasma HDR).
  winMinPx: 0.6,            // wielkość okna na ekranie, przy której gaśnie
  winFullPx: 1.8,
  winCoreGain: 1.8,
  winHaloGain: 0.09,
  winHaloScale: 1.1,        // zasięg poświaty w najmniejszym wymiarze szyby
  accentCoreGain: 0.75,     // listwy Atlasa: barwa bez bloomu
  accentHaloGain: 0.05,
  beaconCoreGain: 4.5,      // lampy na masztach: jak światła pozycyjne
  beaconHaloGain: 0.6,
  beaconHaloScale: 4.5,
  // Powierzchnia.
  ambient: 0.24,            // = SHIP_LIGHT_DEFAULTS.dayAmbient (hexShips3D)
  diffuse: 1.18,            // = dayDiffuseMul
  specular: 0.30,           // = specularMul
  // Podpięcie: tyle nowych okrętów na klatkę (reszta w kolejnych; do tego
  // czasu świecą szczeliny bridgeFx3D). ~60 µs na rekord.
  adoptPerFrame: 24,
  // Wyrwy.
  rimWidth: 1.8,            // szerokość przypalonego brzegu [px obrazu kadłuba]
  scorch: 0.6,              // przyciemnienie przy martwym sąsiedzie
  cutGlow: 0.42             // żar świeżego cięcia na samej krawędzi (0..1 jak żar węzła)
};

if (typeof window !== 'undefined') window.__bridge3DTune = BRIDGE3D_TUNE;

// ---------------------------------------------------------------------------
// Stałe
// ---------------------------------------------------------------------------

const DAMAGE_W = B3_DAMAGE_W;  // komórek w wierszu bufora obrażeń (768)
const DAMAGE_ROWS = 512;       // wierszy (rekord: ceil(komórki / DAMAGE_W) kolejnych)
const DAMAGE_MAX_ROWS = 4;     // największy blok: 3072 komórki (lokomotywa ~2000)
// Zakresów uploadu obrażeń na jedną wysyłkę; więcej — scalone w jeden obejmujący.
const DAMAGE_RANGE_CAP = 64;
const KIND_COUNT = BRIDGE3D_KIND_ORDER.length;
export const BRIDGE3D_DAMAGE_LIMITS = Object.freeze({ width: DAMAGE_W, rows: DAMAGE_ROWS, maxRows: DAMAGE_MAX_ROWS });
const RECEIVER_CAPACITY = 640;
const EMITTER_CAPACITY = 8192;
const MODEL_RENDER_ORDER = 12;     // kadłub 10, pancerz 9
const RECEIVER_RENDER_ORDER = 11;
const EMITTER_RENDER_ORDER = 51;   // jak okna bridgeFx3D; lampy pozycyjne 52
const MODEL_LIFT = 0.06;           // podstawa modelu tuż nad płaszczyzną kadłuba
const RECEIVER_Z = -0.6;           // pod kadłubem (0) i płytą pancerza (−0,25)
const REFRESH_SEC = 1.0;           // okresowo tylko HP i żar bez śmierci węzła
const ROW_RELEASE_SEC = 2;         // niewidziany gospodarz oddaje wiersz obrażeń
const RECORD_TTL_SEC = 60;         // ...a po minucie rekord odchodzi całkiem
const MAX_ROOM_FLASHES_PER_FRAME = 6;
const DEG = Math.PI / 180;
// Żar wyrwy w modelu: zanik żaru od zapisu wiersza obrażeń (shader: G i A × e^(−wiek·zanik); ten sam
// zanik co HULL_BODY_CONFIG.heatDecay — żar węzła, skóra kadłuba) i jasność białego żaru brzegu w HDR.
// Liczby sprzed usunięcia silnika heksów (2026-10-19) — obraz wyrwy bez zmian.
const BRIDGE3D_HEAT_DECAY = 0.35;      // 1/s
const BRIDGE3D_WOUND_GLOW_PEAK = 9.0;  // szczyt żaru brzegu (8–12 HDR jak brzeg rany kadłuba)

// Palety (sRGB → liniowo przy starcie) z próbek stref na sprite'ach.
// Kolejność = BRIDGE3D_MAT: farba, panel, ciemny metal, akcent, szyba,
// rama okien, jasny detal, brud/rdza.
// Terra Nova — mostki na poziomy I–VI (jedna biel floty: próbki stref Bellatora, Citadelli i Colossusa).
const TN_STYLE = Object.freeze({ palette: ['#cbc9c2', '#adaaa3', '#4b4f53', '#8e9297', '#141c25', '#394045', '#e5e4de', '#7b7871'], spec: 1.0, seams: 0.12, grime: 0.1, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' });
export const BRIDGE3D_KIND_STYLE = {
  tn_1: TN_STYLE, tn_2: TN_STYLE, tn_3: TN_STYLE, tn_4: TN_STYLE, tn_5: TN_STYLE, tn_6: TN_STYLE,
  // Iron Skull i reszta rodziny: próbki NOWYCH sprite'ów (migracja 2026-09-24) —
  // ciemna stal z rdzą jako akcentem, kości kolców; łaty rdzy nie dominują.
  ironskull: { palette: ['#4a4440', '#39332f', '#15110f', '#7a4127', '#24130a', '#211b18', '#b6a595', '#4d3021'], spec: 0.6, seams: 0.22, grime: 0.28, rivets: 1, rust: 0.4, sky: 0.6, interior: '#140f0c' },
  atlas_main: { palette: ['#56606f', '#434b58', '#252a33', '#2c8ca4', '#0d1720', '#2a303a', '#8a94a2', '#343943'], spec: 1.0, seams: 0.14, grime: 0.08, rivets: 0, rust: 0, sky: 1.2, interior: '#0f1216' },
  atlas_backup: { palette: ['#56606f', '#434b58', '#252a33', '#2c8ca4', '#0d1720', '#2a303a', '#8a94a2', '#343943'], spec: 1.0, seams: 0.14, grime: 0.08, rivets: 0, rust: 0, sky: 1.2, interior: '#0f1216' },
  pirate_frigate: { palette: ['#4a4440', '#39332f', '#15110f', '#7a4127', '#24130a', '#211b18', '#b6a595', '#4d3021'], spec: 0.6, seams: 0.22, grime: 0.3, rivets: 1, rust: 0.4, sky: 0.55, interior: '#140f0c' },
  pirate_destroyer: { palette: ['#4b4541', '#3a3430', '#16120f', '#7c4328', '#24130a', '#211b18', '#b3a292', '#4f3122'], spec: 0.6, seams: 0.22, grime: 0.3, rivets: 1, rust: 0.4, sky: 0.55, interior: '#140f0c' },
  pirate_supercapital: { palette: ['#4a4440', '#39332f', '#15110f', '#7a4127', '#24130a', '#211b18', '#b6a595', '#4d3021'], spec: 0.6, seams: 0.22, grime: 0.3, rivets: 1, rust: 0.4, sky: 0.55, interior: '#140f0c' },
  // Megafrachtowiec: przemysłowa stal, pomarańczowe znaczniki.
  megafreighter: { palette: ['#555960', '#43474d', '#1c1e21', '#c8741e', '#10161c', '#2a2d31', '#a3a9b0', '#3a3530'], spec: 0.8, seams: 0.18, grime: 0.14, rivets: 0, rust: 0, sky: 0.9, interior: '#111316' }
};
const KIND_STYLE = BRIDGE3D_KIND_STYLE;

// Połysk per materiał: (wykładnik, mnożnik).
const MAT_SPEC = [[28, 0.35], [24, 0.3], [16, 0.2], [32, 0.35], [90, 1.2], [20, 0.15], [40, 0.45], [10, 0.08]];

const EMIT_COLOR_HEX = {
  accent: '#46dcff',
  beacon_red: '#ff3a26',
  beacon_white: '#e9f4ff',
  beacon_pirate: '#ff6a1c',
  beacon_amber: '#ffb030'
};
const DEFAULT_WINDOW_HEX = '#e4f3ff';

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinear(hex) {
  const raw = String(hex || '').replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) return [1, 1, 1];
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(raw.slice(i, i + 2), 16) / 255));
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1e-6)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Shadery: bridge3D.tsl.js (port WebGPU, zadanie 15 — TSL, wzory 1:1 z dawnym
// GLSL: bryła, cień na kadłubie z depthFunc GREATER, okna/lampy/listwy).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rekord = jedna instancja modelu (jeden mostek jednego gospodarza)
// ---------------------------------------------------------------------------

/**
 * Mapowanie przestrzeni modelu na obraz kadłuba („siatka” API mostków: px obrazu renderu od
 * lewego górnego rogu, Y w dół) dla strefy `def` (px PNG) i skal kx/ky (render/PNG). Dalej
 * obraz → komórki siatki belek: bridgeModelCellMap.
 */
export function bridgeModelGridMap(def, kx, ky, srcW, srcH, design) {
  const zoneW = def.w * kx;
  const zoneH = def.h * ky;
  const sxZ = zoneW / design.w;
  const syZ = zoneH / design.h;
  const r = (Number(def.rot) || 0) * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return {
    zgx: srcW * 0.5 + def.x * kx,
    zgy: srcH * 0.5 + def.y * ky,
    // M (x, y↑) → siatka (Y w dół), obrót strefy zgodnie z ruchem wskazówek.
    m00: sxZ * c, m01: syZ * s,
    m10: sxZ * s, m11: -syZ * c,
    sxZ, syZ, zoneW, zoneH
  };
}

export function bridgeModelToGrid(map, x, y, out = { x: 0, y: 0 }) {
  out.x = map.zgx + map.m00 * x + map.m01 * y;
  out.y = map.zgy + map.m10 * x + map.m11 * y;
  return out;
}

// ---------------------------------------------------------------------------
// Komórki siatki belek kadłuba (shipBridgeBeams.js)
// ---------------------------------------------------------------------------

/** Sąsiedzi komórki kwadratowej (lustro B3_SQUARE_DIRS w bridge3D.tsl.js; Y siatki w górę). */
export const BRIDGE3D_SQUARE_NEIGHBORS = Object.freeze([
  [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [-1, -1], [1, -1]
]);

const _sqTables = new Map();
function squareNeighbourTable(w, h) {
  const key = `${w}x${h}`;
  let nb = _sqTables.get(key);
  if (nb) return nb;
  nb = new Int16Array(w * h * 8).fill(-1);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = i + j * w;
      for (let d = 0; d < 8; d++) {
        const ni = i + BRIDGE3D_SQUARE_NEIGHBORS[d][0];
        const nj = j + BRIDGE3D_SQUARE_NEIGHBORS[d][1];
        if (ni >= 0 && nj >= 0 && ni < w && nj < h) nb[k * 8 + d] = ni + nj * w;
      }
    }
  }
  _sqTables.set(key, nb);
  return nb;
}

/**
 * Model → współrzędne komórek siatki belek (ciągłe; komórka = floor): obraz kadłuba (map) →
 * siatka (względem latticeMin, Y w górę) ÷ bok komórki. Wynik: { a0, b0, n00, n01, n10, n11 }.
 */
export function bridgeModelCellMap(map, st) {
  const k = st.spriteScale / st.cellSize;
  return {
    a0: (st.anchorDX + (map.zgx - st.srcW * 0.5) * st.spriteScale) / st.cellSize,
    b0: (st.anchorDY - (map.zgy - st.srcH * 0.5) * st.spriteScale) / st.cellSize,
    n00: map.m00 * k, n01: map.m01 * k,
    n10: -map.m10 * k, n11: -map.m11 * k
  };
}

function cellOfModel(cm, x, y, out) {
  out.x = cm.a0 + cm.n00 * x + cm.n01 * y;
  out.y = cm.b0 + cm.n10 * x + cm.n11 * y;
  return out;
}

/**
 * Rekord (dane CPU, bez three): mapowanie modelu, blok komórek siatki belek pod modelem (obrys
 * mapy wysokości + pierścień), sąsiedzi (8), emitery z komórkami pod nimi i położeniem w PNG
 * (fale gaśnięcia). `kind` — zasób rodzaju ({ index, name, model, emit }). Wiersz bufora
 * obrażeń przydziela wołający.
 */
export function createBeamBridgeRecordCore(host, st, bridgeIndex, kind, row) {
  const hull = bridgeBeamHull(host);
  const bridge = st.bridges[bridgeIndex];
  const def = bridge.def;
  const model = kind.model;
  const map = bridgeModelGridMap(def, st.scaleX, st.scaleY, st.srcW, st.srcH, model.design);
  const cm = bridgeModelCellMap(map, st);
  const f = model.heightField;
  const x1 = f.x0 + (f.width - 1) * f.texel;
  const y1 = f.y0 + (f.height - 1) * f.texel;
  let u0 = Infinity; let v0 = Infinity; let u1 = -Infinity; let v1 = -Infinity;
  const p = { x: 0, y: 0 };
  for (const [x, y] of [[f.x0, f.y0], [x1, f.y0], [x1, y1], [f.x0, y1]]) {
    cellOfModel(cm, x, y, p);
    if (p.x < u0) u0 = p.x; if (p.x > u1) u1 = p.x;
    if (p.y < v0) v0 = p.y; if (p.y > v1) v1 = p.y;
  }
  const c0 = Math.floor(u0) - 1;
  const r0 = Math.floor(v0) - 1;
  const w = Math.floor(u1) + 1 - c0 + 1;
  const h = Math.floor(v1) + 1 - r0 + 1;
  const n = w * h;
  const existed = new Uint8Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (bridgeCellNode(hull, c0 + i, r0 + j) >= 0) existed[i + j * w] = 1;
    }
  }
  const E = kind.emit;
  const emCellX = new Int16Array(E.count).fill(-32768);
  const emCellY = new Int16Array(E.count);
  const emPngX = new Float32Array(E.count);
  const emPngY = new Float32Array(E.count);
  const g = { x: 0, y: 0 };
  for (let i = 0; i < E.count; i++) {
    bridgeModelToGrid(map, E.cx[i], E.cy[i], g);
    emPngX[i] = (g.x - st.srcW * 0.5) / st.scaleX;
    emPngY[i] = (g.y - st.srcH * 0.5) / st.scaleY;
    cellOfModel(cm, E.cx[i], E.cy[i], p);
    const ix = Math.floor(p.x);
    const iy = Math.floor(p.y);
    if (ix >= c0 && iy >= r0 && ix < c0 + w && iy < r0 + h && existed[(ix - c0) + (iy - r0) * w]) {
      emCellX[i] = ix;
      emCellY[i] = iy;
    }
  }
  const b = model.bounds;
  const reach = b.zMax / Math.tan(Math.max(5, BRIDGE3D_TUNE.shadowElevDeg) * DEG);
  return {
    kind, host, st, bridge, bridgeIndex, def,
    lineage: st.lineage,
    hullKey: st.hullKey || null,
    map, cellMap: cm,
    // aB3State.w: bok komórki siatki belek w px obrazu kadłuba (brzeg wyrwy w shaderze)
    cellPx: st.cellSize / Math.max(1e-6, st.spriteScale),
    srcW: st.srcW, srcH: st.srcH,
    c0, r0, blockW: w, blockH: h, cellCount: n,
    rowCount: Math.ceil(n / DAMAGE_W),
    existed, nb: squareNeighbourTable(w, h),
    alive: new Uint8Array(n),
    aliveWas: Uint8Array.from(existed),
    cutAt: new Float32Array(n).fill(-1),
    nodeOf: new Int32Array(n),
    row,
    rowTime: 0,
    anyDead: 0,
    moved: 0,
    lastBody: null,       // ciało gospodarza z ostatniego zapisu wiersza (i trop wraku)
    lastActive: -1,
    lastRefresh: -Infinity,
    moveSearchFrame: -1e9,
    emCellX, emCellY, emPngX, emPngY,
    emWas: new Uint8Array(E.count).fill(1),
    emDelayOwn: new Float32Array(E.count),
    emDelayCmd: new Float32Array(E.count),
    emDelayPower: new Float32Array(E.count),
    emOwnVent: null,
    emCmdVent: null,
    emPowerReady: false,
    winColor: [1, 1, 1],
    powerLostAt: -1,
    // Promień (obraz kadłuba) obejmujący model i jego cień — do kadrowania.
    radiusGrid: (Math.hypot(Math.max(-b.x0, b.x1), Math.max(-b.y0, b.y1)) + reach) * Math.max(map.sxZ, map.syZ),
    seenFrame: -1,
    lastSeenAt: 0,
    orphanSince: -1,
    maskLo: 0,
    maskHi: 0,
    index: -1,
    dead: false
  };
}

/** Żar węzła teraz (szczyt × zanik od znacznika — jak skóra kadłuba, beamHullSkin.js). */
function nodeHeatNow(ns, i, now, decay) {
  const peak = ns.heat[i];
  if (!(peak > 0)) return 0;
  const age = now - ns.heatStamp[i];
  return age > 0 ? peak * Math.exp(-age * decay) : peak;
}

/**
 * Odświeża stan komórek rekordu i zapisuje jego wiersze bufora obrażeń (RGBA8):
 *   R — 0: martwa / brak węzła; 64..255: żywa, HP 0..1,
 *   G — żar węzła (heat / heatStamp silnika) w chwili zapisu,
 *   B — maska 8 martwych sąsiadów (kierunki BRIDGE3D_SQUARE_NEIGHBORS),
 *   A — żar świeżego cięcia (sąsiad zginął) w chwili zapisu.
 * Zanik żaru od chwili zapisu liczy shader (aB3State.y). `hull` — kadłub gospodarza (null:
 * wszystko martwe), `data` — bajty całego bufora obrażeń (widok Uint8Array na słowach u32
 * bufora storage; wiersz = DAMAGE_W komórek). Zwraca true, gdy bajty wiersza się zmieniły.
 */
export function refreshBeamBridgeRecordDamage(rec, hull, data, heatNow, rowStride = DAMAGE_W) {
  const n = rec.cellCount;
  const alive = rec.alive;
  const w = rec.blockW;
  const nodeOf = rec.nodeOf;
  const body = hull ? hull.body : null;
  const ns = body ? body.nodeStore : null;
  let anyDead = 0;
  let missing = 0;
  for (let k = 0; k < n; k++) {
    let i = -1;
    if (rec.existed[k] && hull) i = bridgeCellNode(hull, rec.c0 + (k % w), rec.r0 + ((k / w) | 0));
    nodeOf[k] = i;
    alive[k] = i >= 0 ? 1 : 0;
    if (i < 0 && rec.existed[k]) { anyDead = 1; missing++; }
  }
  // Świeże cięcia: żywa komórka, której sąsiad zginął od ostatniego zapisu.
  const nb = rec.nb;
  for (let k = 0; k < n; k++) {
    if (!rec.aliveWas[k] || alive[k] || !rec.existed[k]) continue;
    for (let d = 0; d < 8; d++) {
      const m = nb[k * 8 + d];
      if (m >= 0 && alive[m]) rec.cutAt[m] = heatNow;
    }
  }
  const decay = Math.max(0, Number(HULL_BODY_CONFIG.heatDecay) || 0);
  const base = rec.row * rowStride * 4;
  let changed = false;
  for (let k = 0; k < n; k++) {
    const o = base + k * 4;
    let R = 0; let G = 0; let B = 0; let A = 0;
    if (alive[k]) {
      const i = nodeOf[k];
      const m = ns.maxHp[i];
      const hpFrac = m > 0 ? Math.max(0, Math.min(1, ns.hp[i] / m)) : 1;
      R = 64 + Math.round(hpFrac * 191);
      const heat = nodeHeatNow(ns, i, heatNow, decay);
      G = heat > 0 ? Math.min(255, Math.round(heat * 255)) : 0;
      for (let d = 0; d < 8; d++) {
        const mm = nb[k * 8 + d];
        if (mm >= 0 && rec.existed[mm] && !alive[mm]) B |= (1 << d);
      }
      const cut = rec.cutAt[k];
      if (cut >= 0) {
        const v = Math.exp(-(heatNow - cut) * decay);
        A = v > 0.004 ? Math.round(v * 255) : 0;
        if (!A) rec.cutAt[k] = -1;
      }
    }
    if (data[o] !== R || data[o + 1] !== G || data[o + 2] !== B || data[o + 3] !== A) {
      data[o] = R; data[o + 1] = G; data[o + 2] = B; data[o + 3] = A;
      changed = true;
    }
  }
  rec.aliveWas.set(alive);
  rec.anyDead = anyDead;
  rec.moved = missing;
  rec.rowTime = heatNow;
  rec.lastBody = body;
  rec.lastActive = body ? body.activeNodes : -1;
  return changed;
}

// Czy encja (kadłub rodu rekordu) ma któraś żywą komórkę bloku rekordu. `notAtHull` — liczą się
// tylko komórki martwe u tego kadłuba (szukanie odłamu z częścią mostka).
function beamEntityOwnsAny(rec, e, notAtHull = null) {
  const hull = bridgeBeamHull(e);
  if (!hull || hull.dmgKey !== rec.lineage || hull === notAtHull) return false;
  const w = rec.blockW;
  for (let k = 0; k < rec.cellCount; k++) {
    if (!rec.existed[k]) continue;
    const ix = rec.c0 + (k % w);
    const iy = rec.r0 + ((k / w) | 0);
    if (notAtHull && bridgeCellNode(notAtHull, ix, iy) >= 0) continue;
    if (bridgeCellNode(hull, ix, iy) >= 0) return true;
  }
  return false;
}

// Zimny wrak na belkach (src/game/coldWrecks.js) z rekordem tego rodu: kadłub żyje w migawce i wraca z nią (ten sam
// rekord kadłuba) — w kadrze jako ciało do rysowania, po odmrożeniu na stałe.
function beamHostParkedCold(rec, host) {
  return !!host && !host.dead && host.isCold === true && host._coldSnapshot?.hull?.dmgKey === rec.lineage;
}

const _lat = { x: 0, y: 0 };
const _bo = { x: 0, y: 0 };
const _bpx = { x: 0, y: 0 };
const _bpy = { x: 0, y: 0 };
const _bPose = { x: 0, y: 0, c: 1, s: 0 };

/**
 * Baza instancji: przestrzeń modelu → scena (x, −y świata). Kolumny osi X/Y modelu (ax, ay),
 * (bx, by), skala wysokości sz, początek (ox, oy) — z tej samej transformacji co okna i wyrzut
 * (obraz kadłuba → siatka belek rodu → świat: poza gracza, kotwica wraku, obrót sprite'a).
 * wx/wy — środek strefy w świecie gry.
 */
export function beamBridgeInstanceBasis(rec, host, pose, out = {}) {
  const hull = host.beamHull;
  const st = rec.st;
  const map = rec.map;
  // poza kadłuba raz na rekord (cos / sin), trzy punkty siatki
  const p = beamLatticePose(hull, pose, _bPose);
  beamImageToLattice(st, map.zgx, map.zgy, _lat);
  beamLatticeToWorldPosed(hull, p, _lat.x, _lat.y, _bo);
  beamImageToLattice(st, map.zgx + 1, map.zgy, _lat);
  beamLatticeToWorldPosed(hull, p, _lat.x, _lat.y, _bpx);
  beamImageToLattice(st, map.zgx, map.zgy + 1, _lat);
  beamLatticeToWorldPosed(hull, p, _lat.x, _lat.y, _bpy);
  const gxX = _bpx.x - _bo.x; const gxY = _bpx.y - _bo.y;
  const gyX = _bpy.x - _bo.x; const gyY = _bpy.y - _bo.y;
  out.sgx = Math.hypot(gxX, gxY);
  out.sgy = Math.hypot(gyX, gyY);
  out.ax = gxX * map.m00 + gyX * map.m10;
  out.ay = -(gxY * map.m00 + gyY * map.m10);
  out.bx = gxX * map.m01 + gyX * map.m11;
  out.by = -(gxY * map.m01 + gyY * map.m11);
  out.sz = Math.sqrt(out.sgx * out.sgy);
  out.wx = _bo.x;
  out.wy = _bo.y;
  out.ox = _bo.x;
  out.oy = -_bo.y;
  return out;
}

/**
 * Jasność emitera (0..1) w danej chwili — oś czasu jak szczeliny okien
 * w bridgeFx3D.js: rozbłysk i nierówne miganie po utracie dowodzenia, fala
 * gaśnięcia od wyrwy, mostek zapasowy gaśnie osobno, gdy padł wcześniej;
 * wrak (utrata zasilania bez utraty dowodzenia) gaśnie tak samo od środka
 * strefy. Przed tym: spokojne światło, uszkodzona komórka mruga.
 */
export function bridgeEmitterLight(rec, i, now, hpFrac) {
  const E = rec.kind.emit;
  const st = rec.st;
  const bridge = rec.bridge;
  const seed = E.seed[i];
  const type = E.type[i];
  const age = st.commandLost ? now - st.commandLostAt : -1;
  const ownDead = bridge.dead && !(age >= 0 && bridge.deadAt >= st.commandLostAt);
  const powerAge = rec.powerLostAt >= 0 ? now - rec.powerLostAt : -1;
  if (type === BRIDGE3D_EMIT.BEACON) {
    // Stroboskop: krótki błysk co `period` s.
    const ph = (now / E.period[i] + E.phase[i] + seed * 0.37) % 1;
    let I = ph < 0.08 ? 1 : (ph < 0.13 ? 0.3 : 0);
    const T = BRIDGE_KILL_TIMELINE;
    if (ownDead) I *= sampleNavLight(now - bridge.deadAt, 0, seed) > 0.5 ? 1 : 0;
    else if (age >= 0) I *= sampleNavLight(age, 0, seed) > 0.5 ? 1 : 0;
    else if (powerAge >= 0) I *= powerAge < T.navDelay ? 1 : 0;
    return I;
  }
  let I;
  if (ownDead) {
    I = sampleWindowLight(now - bridge.deadAt, rec.emDelayOwn[i], seed);
  } else if (age >= 0) {
    I = sampleWindowLight(age, rec.emDelayCmd[i], seed);
  } else if (powerAge >= 0) {
    I = sampleWindowLight(powerAge, rec.emDelayPower[i], seed);
  } else {
    I = type === BRIDGE3D_EMIT.STRIP ? 1 : 0.82 + 0.18 * Math.sin(now * (0.7 + seed * 1.3) + seed * 40);
    if (hpFrac < 0.55) {
      const slot = Math.floor(now * (9 + seed * 7));
      if (bridgeHash01(slot, i + 101) < 0.45 * (1 - hpFrac / 0.55) + 0.1) I *= 0.18;
    }
  }
  return I * E.level[i];
}

// Opóźnienia fal gaśnięcia (liczone raz, gdy pojawi się ich źródło).
function prepareEmitterDelays(rec) {
  const E = rec.kind.emit;
  const speed = BRIDGE_KILL_TIMELINE.windowWaveSpeed;
  const bridge = rec.bridge;
  if (bridge.vent && rec.emOwnVent !== bridge.vent) {
    rec.emOwnVent = bridge.vent;
    for (let i = 0; i < E.count; i++) rec.emDelayOwn[i] = bridgeWaveDelay(bridge.vent.x, bridge.vent.y, rec.emPngX[i], rec.emPngY[i], speed);
  }
  const vent = rec.st.vent;
  if (vent && rec.emCmdVent !== vent) {
    rec.emCmdVent = vent;
    for (let i = 0; i < E.count; i++) rec.emDelayCmd[i] = bridgeWaveDelay(vent.x, vent.y, rec.emPngX[i], rec.emPngY[i], speed);
  }
  if (rec.powerLostAt >= 0 && !rec.emPowerReady) {
    rec.emPowerReady = true;
    const def = rec.def;
    for (let i = 0; i < E.count; i++) rec.emDelayPower[i] = bridgeWaveDelay(def.x, def.y, rec.emPngX[i], rec.emPngY[i], speed);
  }
}

// ---------------------------------------------------------------------------
// Zasoby GPU
// ---------------------------------------------------------------------------

function makeInstanceAttr(geometry, name, itemSize, capacity) {
  const array = new Float32Array(capacity * itemSize);
  // Domyślne użycie: WebGPU wysyła zakres po needsUpdate (DynamicDrawUsage
  // w backendzie WebGPU three r183 = pełny upload przy każdym renderze).
  const attr = new THREE.InstancedBufferAttribute(array, itemSize);
  geometry.setAttribute(name, attr);
  return attr;
}

// Przepleciony bufor instancji (jeden bufor wierzchołków na wszystkie dane
// instancji meshu — limit 8 buforów na pipeline). layout: bridge3D.tsl.js.
function makeInstanceBuffer(geometry, layout, capacity) {
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * layout.stride), layout.stride, 1);
  setInstanceLayout(geometry, buffer, layout);
  return buffer;
}

// Zakres uploadu bez alokacji: addUpdateRange tworzy obiekt {start, count}
// przy każdym wywołaniu — trzymamy jeden na atrybut (three czyści listę po
// wysłaniu, obiekt zostaje nasz). Bufor przepleciony: itemSize = stride.
function commitAttr(attr, count) {
  if (count <= 0) return;
  const ranges = attr.updateRanges;
  if (Array.isArray(ranges)) {
    const r = attr.__b3Range || (attr.__b3Range = { start: 0, count: 0 });
    r.start = 0;
    r.count = count * (attr.isInterleavedBuffer ? attr.stride : attr.itemSize);
    ranges.length = 0;
    ranges.push(r);
  }
  attr.needsUpdate = true;
}

// Emitery rodzaju jako tablice typowane (tylko zapalone — ciemne pokoje nie
// świecą nigdy; ich szyby są w geometrii).
function packEmitters(model) {
  const list = model.emitters.filter((e) => e.lit);
  const n = list.length;
  const E = {
    count: n,
    type: new Uint8Array(n),
    colorKey: new Array(n),
    cx: new Float32Array(n), cy: new Float32Array(n), cz: new Float32Array(n),
    tx: new Float32Array(n), ty: new Float32Array(n), tz: new Float32Array(n),
    bx: new Float32Array(n), by: new Float32Array(n), bz: new Float32Array(n),
    halfW: new Float32Array(n), halfH: new Float32Array(n),
    level: new Float32Array(n), seed: new Float32Array(n),
    period: new Float32Array(n), phase: new Float32Array(n),
    module: new Int16Array(n)
  };
  for (let i = 0; i < n; i++) {
    const e = list[i];
    E.type[i] = e.type;
    E.colorKey[i] = e.color;
    E.cx[i] = e.c[0]; E.cy[i] = e.c[1]; E.cz[i] = e.c[2];
    E.tx[i] = e.t[0]; E.ty[i] = e.t[1]; E.tz[i] = e.t[2];
    E.bx[i] = e.b[0]; E.by[i] = e.b[1]; E.bz[i] = e.b[2];
    E.halfW[i] = e.w * 0.5; E.halfH[i] = e.h * 0.5;
    E.level[i] = e.level ?? 1;
    E.seed[i] = e.seed ?? 0;
    E.period[i] = e.period ?? 1.5;
    E.phase[i] = e.phase ?? 0;
    E.module[i] = e.module ?? 0;
  }
  return E;
}

// Atlas map wysokości (R8, dwuliniowo). Wysokość poszerzona o teksel (max
// 3×3) — cienkie maszty nie przepadają między krokami marszu cienia; 8 bitów
// na szczyt rodzaju (uB3HmTop), więc fregata i lokomotywa mają ten sam krok
// względny.
function buildHeightAtlas(kinds) {
  let width = 0;
  let height = 0;
  for (const k of kinds) {
    width = Math.max(width, k.model.heightField.width);
    height += k.model.heightField.height + 2;
  }
  const W = Math.ceil(width / 4) * 4;
  const H = Math.ceil(height / 4) * 4;
  const data = new Uint8Array(W * H);
  let ay = 1;
  for (const k of kinds) {
    const f = k.model.heightField;
    const top = Math.max(1e-3, k.model.bounds.zMax);
    for (let j = 0; j < f.height; j++) {
      for (let i = 0; i < f.width; i++) {
        let h = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= f.height) continue;
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            if (ii < 0 || ii >= f.width) continue;
            const v = f.heights[ii + jj * f.width];
            if (v > h) h = v;
          }
        }
        data[(ay + j) * W + i] = Math.min(255, Math.round((h / top) * 255));
      }
    }
    k.hmRegion = new THREE.Vector4(0.5 / W, (ay + 0.5) / H, (f.width - 1) / W, (f.height - 1) / H);
    k.hmBounds = new THREE.Vector4(f.x0, f.y0, 1 / ((f.width - 1) * f.texel), 1 / ((f.height - 1) * f.texel));
    ay += f.height + 2;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------------------
// Moduł
// ---------------------------------------------------------------------------

const _basis = { ax: 0, ay: 0, bx: 0, by: 0, sz: 1, ox: 0, oy: 0, wx: 0, wy: 0, sgx: 1, sgy: 1 };
const _camR = new THREE.Vector3();
const _camU = new THREE.Vector3();
const _camP = new THREE.Vector3();

export const Bridge3D = {
  // (gospodarz, x, y świata gry) → 0…1: okno / lampa zasłonięta przez obraz nad okrętem (gra: fregata zwiadu nad
  // Atlasem). null — bez zasłaniania.
  emitterOcclusion: null,
  scene: null,
  ready: false,
  kinds: [],
  records: [],
  receiver: null,
  emitters: null,
  damage: null,
  heightTex: null,
  uniforms: null,
  _frame: 0,
  _disabled: false,
  stats: { records: 0, visible: 0, instances: new Array(KIND_COUNT).fill(0), receivers: 0, emitters: 0, drawCalls: 0, cpuMs: 0, rowsUsed: 0, rowUploads: 0, flashes: 0 },

  /** Podpina moduł do sceny (w grze: Core3D.scene). Bez własnego renderera. */
  attach(scene) {
    if (this.scene === scene && this.ready) return true;
    this.dispose();
    if (!scene) return false;
    this.scene = scene;

    // Rodzaje: model, emitery, zasoby.
    this.kinds = BRIDGE3D_KIND_ORDER.map((name) => {
      const model = buildBridgeModel(name);
      const spec = BRIDGE3D_KINDS[name];
      return { name, index: spec.index, model, emit: packEmitters(model), style: KIND_STYLE[name] || TN_STYLE, count: 0, capacity: spec.capacity, detail: spec.detail };
    });
    this.heightTex = buildHeightAtlas(this.kinds);

    // Bufor obrażeń (storage u32 = RGBA8 w słowie, bajty jak dawna tekstura):
    // rekord dostaje ceil(komórki / DAMAGE_W) kolejnych wierszy. `data` to
    // widok bajtowy na ten sam bufor (refreshBeamBridgeRecordDamage pisze RGBA).
    const words = new Uint32Array(DAMAGE_W * DAMAGE_ROWS);
    const attr = new THREE.StorageBufferAttribute(words, 1);
    const data = new Uint8Array(words.buffer);
    const ranges = [];
    for (let i = 0; i < DAMAGE_RANGE_CAP; i++) ranges.push({ start: 0, count: 0 });
    this.damage = { attr, words, data, rowUsed: new Uint8Array(DAMAGE_ROWS), rowsUsed: 0, ranges, used: 0, lo: Infinity, hi: -Infinity };

    // Węzły wspólne: uniformy (grupa render), tablica rodzajów, bufor obrażeń.
    const nodes = createBridge3DNodes({
      kindCount: this.kinds.length, damageAttribute: attr, damageCount: words.length, heightTex: this.heightTex
    });
    this._nodes = nodes;
    this._fillKindTable(nodes.kindValues);
    // Adapter jak ShaderMaterial: U.uB3Shadow.value.set(…) (wartości węzłów).
    this.uniforms = uniformsAdapter(nodes.U);
    this._syncUniforms();

    // Model: mesh instancjonowany na rodzaj, JEDEN materiał (graf) dla wszystkich.
    const modelMaterial = createBridgeModelMaterial(nodes);
    this._modelMaterial = modelMaterial;
    for (const K of this.kinds) {
      const m = K.model;
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      geo.setAttribute('aMat', new THREE.BufferAttribute(m.mat, 1));
      geo.setAttribute('aModule', new THREE.BufferAttribute(m.module, 1));
      geo.setIndex(new THREE.BufferAttribute(m.index, 1));
      K.inst = makeInstanceBuffer(geo, B3_MODEL_LAYOUT, K.capacity);
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, modelMaterial);
      mesh.name = `BRIDGE3D_${K.name}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = MODEL_RENDER_ORDER;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      scene.add(mesh);
      K.geometry = geo;
      K.material = modelMaterial;
      K.mesh = mesh;
    }

    // Cień na kadłubie: prostokąty pod kadłubem, test głębi GREATER.
    {
      const plane = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', plane.getAttribute('position'));
      geo.setIndex(plane.getIndex());
      const inst = makeInstanceBuffer(geo, B3_RECEIVER_LAYOUT, RECEIVER_CAPACITY);
      geo.instanceCount = 0;
      const mat = createBridgeReceiverMaterial(nodes, RECEIVER_Z);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'BRIDGE3D_SHADOW';
      mesh.frustumCulled = false;
      mesh.renderOrder = RECEIVER_RENDER_ORDER;
      mesh.visible = false;
      scene.add(mesh);
      this.receiver = { geometry: geo, material: mat, mesh, inst, count: 0, capacity: RECEIVER_CAPACITY };
    }

    // Okna, lampy, listwy: warstwa FG, addytywnie.
    {
      const geo = new THREE.PlaneGeometry(1, 1);
      // Shader czyta tylko pozycję — bez normalnych i uv (mniej buforów wierzchołków).
      geo.deleteAttribute('normal');
      geo.deleteAttribute('uv');
      const attrs = {
        params: makeInstanceAttr(geo, 'aParams', 4, EMITTER_CAPACITY),
        color: makeInstanceAttr(geo, 'aColor', 3, EMITTER_CAPACITY),
        shape: makeInstanceAttr(geo, 'aShape', 1, EMITTER_CAPACITY)
      };
      const { material: mat } = createBridgeEmitterMaterial();
      const mesh = new THREE.InstancedMesh(geo, mat, EMITTER_CAPACITY);
      mesh.name = 'BRIDGE3D_WINDOWS';
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = EMITTER_RENDER_ORDER;
      mesh.layers.set(2);
      mesh.visible = false;
      scene.add(mesh);
      this.emitters = { geometry: geo, material: mat, mesh, attrs, count: 0, capacity: EMITTER_CAPACITY };
    }
    this._syncUniforms();
    this._emitColors = Object.fromEntries(Object.entries(EMIT_COLOR_HEX).map(([k, v]) => [k, hexToLinear(v)]));
    this.ready = true;
    return true;
  },

  // Stałe rodzajów do wspólnej tablicy uniformów (układ: B3_KIND_SLOT).
  _fillKindTable(values) {
    for (const K of this.kinds) {
      const base = K.index * B3_KIND_STRIDE;
      const at = (slot) => values[base + slot];
      const style = K.style;
      at(B3_KIND_SLOT.bounds).copy(K.hmBounds);
      at(B3_KIND_SLOT.region).copy(K.hmRegion);
      at(B3_KIND_SLOT.topDetailCoat).set(K.model.bounds.zMax, K.detail, style.rust, style.sky);
      at(B3_KIND_SLOT.surface).set(0, style.seams, style.grime, style.rivets);
      const interior = hexToLinear(style.interior);
      at(B3_KIND_SLOT.interior).set(interior[0], interior[1], interior[2], 0);
      for (let i = 0; i < 8; i++) {
        const c = hexToLinear(style.palette[i]);
        const [e, mul] = MAT_SPEC[i];
        at(B3_KIND_SLOT.palette + i).set(c[0], c[1], c[2], e);
        at(B3_KIND_SLOT.specMul + i).set(mul * style.spec, 0, 0, 0);
      }
    }
  },

  _syncUniforms() {
    const T = BRIDGE3D_TUNE;
    const U = this.uniforms;
    const elev = Math.max(5, Math.min(85, Number(T.shadowElevDeg) || 30));
    U.uB3Shadow.value.set(Math.tan(elev * DEG), Math.max(0, T.shadowStrength), Math.max(0.01, T.shadowSoft), Math.max(0, Math.min(1, T.selfShadowAmbient)));
    U.uB3Ao.value.set(Math.max(0.5, T.aoRadius), Math.max(0, Math.min(1, T.aoStrength)), 0, 0);
    U.uB3Light.value.set(T.ambient, T.diffuse, T.specular);
    U.uB3Wound.value.set(Math.max(0.2, T.rimWidth), Math.max(0, Math.min(1, T.scorch)), Math.max(0, T.cutGlow), BRIDGE3D_WOUND_GLOW_PEAK);
    if (this.emitters) {
      this.emitters.material.uniforms.uCore.value.set(T.winCoreGain, T.beaconCoreGain, T.accentCoreGain);
      this.emitters.material.uniforms.uHalo.value.set(T.winHaloGain, T.beaconHaloGain, T.accentHaloGain);
    }
  },

  // n kolejnych wolnych wierszy (pierwszy pasujący) albo −1.
  _allocRows(n) {
    const d = this.damage;
    const used = d.rowUsed;
    let run = 0;
    for (let r = 0; r < DAMAGE_ROWS; r++) {
      run = used[r] ? 0 : run + 1;
      if (run === n) {
        const start = r - n + 1;
        used.fill(1, start, r + 1);
        d.rowsUsed += n;
        return start;
      }
    }
    return -1;
  },

  _freeRows(rec) {
    if (!rec || rec.row < 0) return;
    this.damage.rowUsed.fill(0, rec.row, rec.row + rec.rowCount);
    this.damage.rowsUsed -= rec.rowCount;
    rec.row = -1;
  },

  // Upload bloku rekordu: komórki leżą liniowo od początku jego pierwszego
  // wiersza, więc cały blok to JEDEN zakres bufora (writeBuffer tylko jego).
  _markRows(rec) {
    if (rec.row < 0 || !(rec.cellCount > 0)) return;
    this._markRange(rec.row * DAMAGE_W, rec.cellCount);
  },

  // Zakres [start, start + count) słów bufora obrażeń do wysłania. three czyści
  // listę zakresów po wysyłce (updateAttribute), więc pusta lista = pula od nowa.
  // Ponad DAMAGE_RANGE_CAP zakresów przed wysyłką — jeden obejmujący wszystkie
  // (dalej zakres, więc wysyłka zawsze obejmie zmiany sprzed niej).
  _markRange(start, count) {
    const d = this.damage;
    const attr = d.attr;
    const list = attr.updateRanges;
    if (list.length === 0) { d.used = 0; d.lo = Infinity; d.hi = -Infinity; }
    const end = start + count;
    if (start < d.lo) d.lo = start;
    if (end > d.hi) d.hi = end;
    if (d.used >= d.ranges.length) {
      const r = d.ranges[0];
      r.start = d.lo;
      r.count = d.hi - d.lo;
      list.length = 0;
      list.push(r);
      d.used = 1;
    } else {
      const r = d.ranges[d.used++];
      r.start = start;
      r.count = count;
      list.push(r);
    }
    attr.needsUpdate = true;
    this.stats.rowUploads++;
  },

  // Nowy stan mostków na encji (nowy kadłub, edytor przestawił strefy).
  _adopt(e, st, ctx) {
    const old = e.__bridge3D;
    if (old) for (let i = old.length - 1; i >= 0; i--) if (old[i].st !== st) this._retire(old[i]);
    e.__bridge3DState = st;
    const hullKey = st.hullKey || resolveBridgeHullKey(e);
    let wanted = 0;
    const made = [];
    for (let b = 0; b < st.bridges.length; b++) {
      const bridge = st.bridges[b];
      if (!bridge.total || bridge.missing) continue;
      wanted++;
      const kindName = resolveBridgeModelKind(hullKey, bridge.def);
      const K = kindName ? this.kinds[BRIDGE3D_KINDS[kindName].index] : null;
      if (!K) continue;
      const rec = this._createRecord(e, st, b, K, ctx);
      if (rec) made.push(rec);
    }
    // Wszystko albo nic: przy braku modelu dla któregoś mostka zostają
    // szczeliny bridgeFx3D (bez podwójnych okien na części kadłuba).
    if (made.length && made.length === wanted) {
      e.__bridge3DFull = true;
      st.model3D = true;
    } else {
      for (const r of made) this._retire(r, false);
      e.__bridge3DState = st; // bez ponawiania co klatkę
      e.__bridge3DFull = false;
      st.model3D = false;
    }
  },

  _createRecord(host, st, bridgeIndex, K, ctx, source = null) {
    let rec;
    if (source) {
      // Część mostka na innym gospodarzu (odłamek): te same komórki rodu.
      const row = this._allocRows(source.rowCount);
      if (row < 0) return null;
      rec = { ...source };
      rec.host = host;
      rec.row = row;
      rec.alive = new Uint8Array(source.cellCount);
      rec.aliveWas = Uint8Array.from(source.existed);
      rec.cutAt = new Float32Array(source.cellCount).fill(-1);
      rec.nodeOf = new Int32Array(source.cellCount);
      rec.emWas = new Uint8Array(source.kind.emit.count).fill(1);
      rec.emDelayPower = new Float32Array(source.kind.emit.count);
      rec.emPowerReady = false;
      rec.lastBody = null;
      rec.lastActive = -1;
      rec.lastRefresh = -Infinity;
      rec.moveSearchFrame = ctx.frame;
      rec.powerLostAt = ctx.now;
      rec.orphanSince = -1;
      rec.dead = false;
    } else {
      rec = createBeamBridgeRecordCore(host, st, bridgeIndex, K, -1);
      if (rec.rowCount > DAMAGE_MAX_ROWS) return null;
      rec.row = this._allocRows(rec.rowCount);
      if (rec.row < 0) return null;
      const cols = st.windows?.colorsLinear;
      rec.winColor = (cols && cols[bridgeIndex]) || hexToLinear(rec.def.windowColor || BRIDGE_LAYOUT_PROPOSALS[rec.hullKey || '']?.windowColor || DEFAULT_WINDOW_HEX);
    }
    rec.seenFrame = ctx.frame;
    rec.lastSeenAt = ctx.heatNow;
    rec.index = this.records.length;
    this.records.push(rec);
    if (!host.__bridge3D) host.__bridge3D = [];
    host.__bridge3D.push(rec);
    this._refreshFor(rec, host, ctx);
    // Faza okresowego odświeżenia rozłożona po rekordach.
    rec.lastRefresh -= ((rec.row * 7) % 16) / 16 * REFRESH_SEC;
    return rec;
  },

  _retire(rec, allowReadopt = true) {
    if (!rec || rec.dead) return;
    rec.dead = true;
    const list = this.records;
    const last = list.pop();
    if (last !== rec) { list[rec.index] = last; last.index = rec.index; }
    const hosted = rec.host?.__bridge3D;
    if (hosted) {
      const i = hosted.indexOf(rec);
      if (i >= 0) hosted.splice(i, 1);
    }
    this._freeRows(rec);
    if (rec.host && rec.host.bridgeState === rec.st && rec.st) {
      rec.st.model3D = false;
      rec.host.__bridge3DFull = false;
      // Encja z tym samym stanem mostków może dostać model od nowa.
      if (allowReadopt) rec.host.__bridge3DState = null;
    }
  },

  _reacquireRow(rec, host, ctx) {
    const row = this._allocRows(rec.rowCount);
    if (row < 0) return false;
    rec.row = row;
    rec.lastBody = null;
    // aliveWas zostaje z ostatniego zapisu: świeży żar dostaną tylko cięcia
    // powstałe pod nieobecność, nie wszystkie stare wyrwy.
    this._refreshFor(rec, host, ctx);
    return true;
  },

  // Odświeżenie wiersza: komórki rekordu w kadłubie gospodarza.
  _refreshFor(rec, host, ctx) {
    if (refreshBeamBridgeRecordDamage(rec, bridgeBeamHull(host), this.damage.data, ctx.heatNow)) this._markRows(rec);
    rec.lastRefresh = ctx.heatNow;
  },

  // Czy wiersz rekordu trzeba odświeżyć, bo w kadłubie gospodarza zginęła komórka (inne ciało albo
  // inna liczba żywych węzłów niż przy ostatnim zapisie).
  _hostChanged(rec, host) {
    const hull = host?.beamHull;
    const body = hull && hull.entity === host ? hull.body : null;
    return body !== rec.lastBody || (body ? body.activeNodes : -1) !== rec.lastActive;
  },

  // Czy gospodarz nadal ma którąś komórkę rekordu (żywą, w swoim kadłubie rodu).
  _hostOwns(rec, host) {
    return !!host && !host.dead && beamEntityOwnsAny(rec, host);
  },

  // Komórki rodu żyją u gospodarza albo u którejś encji z listy (wrak, odłam).
  _anyAlive(rec, entities) {
    if (this._hostOwns(rec, rec.host)) return true;
    return !!this._findHost(rec, entities, rec.host);
  },

  // Nowy gospodarz dla rekordu, którego komórki przeszły do innej encji (wrak, odłam).
  _findHost(rec, entities, except) {
    if (Array.isArray(entities)) {
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e || e === except || e.dead) continue;
        if (beamEntityOwnsAny(rec, e)) return e;
      }
    }
    // Trop ciała: convertToWreck oddaje wrakowi TO SAMO ciało silnika (body.entity = wrak),
    // a wrak trafia na listę renderu dopiero w kolejnej klatce (mgła wojny: po pierwszej ocenie).
    const body = rec.lastBody;
    const owner = body && !body.dead ? body.entity : null;
    if (owner && owner !== except && !owner.dead && beamEntityOwnsAny(rec, owner)) return owner;
    return null;
  },

  _hostHas(host, st, bridgeIndex) {
    const list = host.__bridge3D;
    if (!list) return false;
    for (let i = 0; i < list.length; i++) if (list[i].st === st && list[i].bridgeIndex === bridgeIndex) return true;
    return false;
  },

  /**
   * Raz na klatkę renderu, po ruchu encji, PRZED BridgeFx3D.update (ustawia
   * bridgeState.model3D — wtedy szczeliny okien bridgeFx3D się nie rysują).
   * opts:
   *   nowSec — czas symulacji (oś commandLostAt / deadAt),
   *   dt     — krok klatki w czasie symulacji,
   *   zoom   — piksele ekranu na jednostkę świata,
   *   poseOf — (encja) => {x, y, angle} | null (gracz: poza interpolowana),
   *   cull   — pudło rysowania {x, y, drawHalfW, drawHalfH} (_hexCullInfo),
   *   camera — kamera gry (tryb free3d: okna w prawdziwej wysokości).
   */
  update(entities, opts = {}) {
    if (!this.ready || !Array.isArray(entities)) return;
    const t0 = performance.now();
    const T = BRIDGE3D_TUNE;
    const frame = ++this._frame;
    if (!T.enabled) {
      if (!this._disabled) this._setDisabled(true);
      return;
    }
    if (this._disabled) this._setDisabled(false);
    this._syncUniforms();

    const ctx = this._ctx || (this._ctx = {});
    ctx.frame = frame;
    ctx.now = Number(opts.nowSec) || 0;
    ctx.dt = Math.max(0, Math.min(0.1, Number(opts.dt) || 0));
    ctx.zoom = Math.max(1e-6, Number(opts.zoom) || 1);
    ctx.poseOf = typeof opts.poseOf === 'function' ? opts.poseOf : null;
    ctx.cull = opts.cull && Number.isFinite(opts.cull.drawHalfW) ? opts.cull : null;
    ctx.free = !!Core3D.isFreePerspectiveCamera?.(opts.camera || Core3D.activeCam1);
    ctx.heatNow = performance.now() * 0.001;
    ctx.entities = entities;
    ctx.visibility = typeof opts.visibility === 'function' ? opts.visibility : null;
    ctx.vis = 1;
    ctx.flashes = 0;
    ctx.heatDecay = BRIDGE3D_HEAT_DECAY;
    if (ctx.free && Core3D.cameraPersp) {
      const e = Core3D.cameraPersp.matrixWorld.elements;
      _camR.set(e[0], e[1], e[2]).normalize();
      _camU.set(e[4], e[5], e[6]).normalize();
      // Wolna kamera: rozmiar na ekranie z odległości i pola widzenia, nie z zoomu.
      const gc = opts.camera && opts.camera.position ? opts.camera : null;
      const cp = gc ? gc.position : Core3D.cameraPersp.position;
      _camP.set(cp.x, cp.y, cp.z);
      const fov = Math.max(10, Math.min(120, Number(gc?.fov) || Core3D.cameraPersp.fov || 50));
      const vh = Number(Core3D.height) || (RenderWorld.viewHeight ?? 900) || 900;
      ctx.pxAtUnit = (vh * 0.5) / Math.tan(fov * 0.5 * DEG);
    }

    // Słońce jak w hexShips3D (window.SUN); bez niego — z lewej od góry.
    const sun = RenderWorld.sun;
    if (sun && Number.isFinite(sun.x) && Number.isFinite(sun.y)) {
      ctx.sunX = sun.x;
      ctx.sunY = sun.y;
    } else {
      const cam = opts.camera || null;
      ctx.sunX = (Number(cam?.x) || 0) - 60000;
      ctx.sunY = (Number(cam?.y) || 0) - 40000;
    }
    this.uniforms.uB3Sun.value.set(ctx.sunX, -ctx.sunY);

    // Początek układu instancji przy kamerze (scena: x, −y świata). Translacje
    // instancji liczone względem niego są małe (float32 w shaderze nie traci
    // precyzji), a duży kawałek niesie mesh.position → modelViewMatrix w double.
    this._setOrigin(opts.camera, ctx);

    const dmg = this.damage;
    const kinds = this.kinds;
    for (let k = 0; k < kinds.length; k++) kinds[k].count = 0;
    this.receiver.count = 0;
    this.emitters.count = 0;

    let adoptLeft = Math.max(1, T.adoptPerFrame | 0);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e || e.dead) continue;
      const st = e.bridgeState;
      // Stan mostków należy do kadłuba encji (backend: kadłub belkowy tego samego rodu).
      const owned = !!st && !!st.backend && st.backend.owns(e, st);
      if (owned && e.__bridge3DState !== st && adoptLeft > 0) { this._adopt(e, st, ctx); adoptLeft--; }
      else if (st && e.__bridge3DFull && st.model3D !== true && e.__bridge3DState === st) st.model3D = true;
      const list = e.__bridge3D;
      if (!list || !list.length) continue;
      // Widoczność modelu (gra: 0 — okręt rysuje model 3D statku, mnożnik — maskowanie).
      const vis = ctx.visibility ? ctx.visibility(e) : 1;
      ctx.vis = Number.isFinite(vis) ? Math.max(0, Math.min(1, vis)) : 1;
      const hidden = e.hideHexVisual === true || ctx.vis <= 0.002;
      for (let j = 0; j < list.length; j++) {
        const rec = list[j];
        rec.seenFrame = frame;
        rec.lastSeenAt = ctx.heatNow;
        rec.orphanSince = -1;
        // Wiersz oddany, gdy gospodarza długo nie było (lot, poza listą) — nowy.
        if (rec.row < 0 && !this._reacquireRow(rec, e, ctx)) continue;
        if (!hidden) this._frameRecord(rec, e, ctx);
      }
    }

    // Rekordy bez gospodarza w tej klatce: wrak przejął ciało kadłuba (hulk →
    // finishBridgeKill), rozpad, albo mostek zniknął na dobre.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i];
      if (!rec || rec.seenFrame === frame) continue;
      // Gospodarz to zimny wrak (bez ciała albo poza listą): rekord czeka bez limitu czasu — wrak nie ma własnego
      // stanu mostków (rekord przeszedł na niego z okrętu), więc oddanego nie przyjąłby ponownie. Wiersz obrażeń
      // oddaje jak gospodarz spoza listy; usunięty wrak (dead) — rekord odchodzi niżej.
      if (beamHostParkedCold(rec, rec.host)) {
        rec.orphanSince = -1;
        if (rec.row >= 0 && ctx.heatNow - rec.lastSeenAt > ROW_RELEASE_SEC) this._freeRows(rec);
        continue;
      }
      // Gospodarz żyje i ma komórki mostka, tylko nie ma go na tej liście (lot
      // nad Ring City rysuje sam statek gracza, NPC zdjęty z listy, wrak we
      // mgle wojny) — rekord czeka; po ROW_RELEASE_SEC oddaje wiersz, po
      // RECORD_TTL_SEC odchodzi — ale tylko u gospodarza z tym stanem mostków
      // (_adopt da mu model od nowa). Wrak i odłam (rekord przeszedł z okrętu)
      // nie przyjęłyby go ponownie: czekają bez limitu, jak zimny wrak wyżej.
      if (this._hostOwns(rec, rec.host)) {
        rec.orphanSince = -1;
        const away = ctx.heatNow - rec.lastSeenAt;
        if (away > RECORD_TTL_SEC && rec.host.bridgeState === rec.st) this._retire(rec);
        else if (away > ROW_RELEASE_SEC && rec.row >= 0) this._freeRows(rec);
        continue;
      }
      if (!this._anyAlive(rec, entities)) { this._retire(rec); continue; }
      const next = this._findHost(rec, entities, rec.host);
      if (next) {
        if (this._hostHas(next, rec.st, rec.bridgeIndex)) { this._retire(rec); continue; }
        const hosted = rec.host?.__bridge3D;
        if (hosted) { const k = hosted.indexOf(rec); if (k >= 0) hosted.splice(k, 1); }
        rec.host = next;
        if (!next.__bridge3D) next.__bridge3D = [];
        next.__bridge3D.push(rec);
        if (!rec.st.commandLost && rec.powerLostAt < 0) rec.powerLostAt = ctx.now;
        rec.lastBody = null;
        rec.seenFrame = frame;
        rec.orphanSince = -1;
        const vis = ctx.visibility ? ctx.visibility(next) : 1;
        ctx.vis = Number.isFinite(vis) ? Math.max(0, Math.min(1, vis)) : 1;
        // Gospodarz spoza listy (trop ciała) — rysuje go pętla encji, gdy pojawi się na liście.
        if (next.hideHexVisual !== true && ctx.vis > 0.002 && entities.includes(next)) this._frameRecord(rec, next, ctx);
        continue;
      }
      // Wrak może trafić na listę klatkę później (albo po powrocie z lotu).
      if (rec.orphanSince < 0) rec.orphanSince = ctx.heatNow;
      else if (ctx.heatNow - rec.orphanSince > 3) this._retire(rec);
    }

    // Wysyłka instancji.
    let draws = 0;
    for (let k = 0; k < kinds.length; k++) {
      const K = kinds[k];
      const n = K.count;
      K.geometry.instanceCount = n;
      K.mesh.visible = n > 0;
      this.stats.instances[K.index] = n;
      if (!n) continue;
      draws++;
      // Jeden przepleciony bufor instancji — jeden zakres.
      commitAttr(K.inst, n);
    }
    const Rv = this.receiver;
    Rv.geometry.instanceCount = Rv.count;
    Rv.mesh.visible = Rv.count > 0;
    if (Rv.count) {
      draws++;
      commitAttr(Rv.inst, Rv.count);
    }
    const Em = this.emitters;
    Em.mesh.count = Em.count;
    Em.mesh.visible = Em.count > 0;
    if (Em.count) {
      draws++;
      commitAttr(Em.mesh.instanceMatrix, Em.count);
      commitAttr(Em.attrs.params, Em.count);
      commitAttr(Em.attrs.color, Em.count);
      commitAttr(Em.attrs.shape, Em.count);
    }

    const S = this.stats;
    S.records = this.records.length;
    let visible = 0;
    for (let k = 0; k < this.kinds.length; k++) visible += this.kinds[k].count;
    S.visible = visible;
    S.receivers = Rv.count;
    S.emitters = Em.count;
    S.drawCalls = draws;
    S.rowsUsed = dmg.rowsUsed;
    S.flashes += ctx.flashes;
    const ms = performance.now() - t0;
    S.cpuMs = S.cpuMs > 0 ? S.cpuMs * 0.9 + ms * 0.1 : ms;
    S.lastMs = ms;
  },

  _setOrigin(cam, ctx) {
    let x = 0;
    let y = 0;
    if (ctx.free && Core3D.cameraPersp) { x = _camP.x; y = _camP.y; }
    else if (cam && Number.isFinite(cam.x) && Number.isFinite(cam.y)) { x = cam.x; y = -cam.y; }
    else if (ctx.cull && Number.isFinite(ctx.cull.x) && Number.isFinite(ctx.cull.y)) { x = ctx.cull.x; y = -ctx.cull.y; }
    if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 0; y = 0; }
    ctx.orgX = x;
    ctx.orgY = y;
    for (let k = 0; k < this.kinds.length; k++) this.kinds[k].mesh.position.set(x, y, 0);
    this.receiver.mesh.position.set(x, y, 0);
    this.emitters.mesh.position.set(x, y, 0);
  },

  _frameRecord(rec, host, ctx) {
    if (!bridgeBeamHull(host)) return;
    if (rec.row < 0) return;
    const T = BRIDGE3D_TUNE;
    const pose = ctx.poseOf ? ctx.poseOf(host) : null;
    const B = beamBridgeInstanceBasis(rec, host, pose, _basis);
    const sgx = B.sgx;
    const sgy = B.sgy;

    const cull = ctx.cull;
    if (cull) {
      const r = rec.radiusGrid * Math.max(sgx, sgy) + 96 / ctx.zoom;
      if (Math.abs(B.wx - cull.x) > cull.drawHalfW + r || Math.abs(B.wy - cull.y) > cull.drawHalfH + r) return;
    }
    // Piksele ekranu na jednostkę świata przy modelu: kamera ortho — zoom,
    // wolna kamera — z odległości (scena: y = −y świata).
    let zoomAt = ctx.zoom;
    if (ctx.free) {
      const d = Math.max(1, Math.hypot(_camP.x - B.ox, _camP.y - B.oy, _camP.z));
      zoomAt = ctx.pxAtUnit / d;
    }

    const zonePx = rec.map.zoneW * sgx * zoomAt;
    const fade = smooth01(T.minPx, T.fullPx, zonePx) * ctx.vis;

    // Obrażenia: zawsze, gdy w kadłubie zginął węzeł (wyrwy, rozpad), a okresowo
    // (HP, żar) tylko dla rysowanych — fazy rozłożone przy tworzeniu rekordu,
    // więc flota nie odświeża się w jednej klatce.
    const changed = this._hostChanged(rec, host);
    if (changed || (fade > 0.002 && ctx.heatNow - rec.lastRefresh > REFRESH_SEC)) {
      this._refreshFor(rec, host, ctx);
      // Komórki mostka na innym gospodarzu (rozpad — odłam rodu) — jego część modelu.
      if (rec.moved > 0 && ctx.frame - rec.moveSearchFrame > 20) {
        rec.moveSearchFrame = ctx.frame;
        const other = this._findMoved(rec, ctx.entities, host);
        if (other && !this._hostHas(other, rec.st, rec.bridgeIndex)) this._createRecord(other, rec.st, rec.bridgeIndex, rec.kind, ctx, rec);
      }
    }
    if (fade <= 0.002) return;
    const lod = zonePx < T.lodPx ? 1 : 0;

    let ax = B.ax; let ay = B.ay; let bx = B.bx; let by = B.by;
    let sz = B.sz; let ox = B.ox; let oy = B.oy;
    // Obraz okrętu mniejszy wokół środka (`__renderScale`) i podniesiony / opuszczony (`__skinZ`) — fregata zwiadu
    // w luku Atlasa i nad nim (src/3d/cargo/scoutBay3D.js); mostek jedzie z kadłubem.
    const rsH = Number(host.__renderScale);
    if (rsH > 0 && rsH !== 1) {
      const hx = pose ? pose.x : (host.pos ? host.pos.x : host.x);
      const hy = -(pose ? pose.y : (host.pos ? host.pos.y : host.y));
      ax *= rsH; ay *= rsH; bx *= rsH; by *= rsH; sz *= rsH;
      ox = hx + (ox - hx) * rsH; oy = hy + (oy - hy) * rsH;
    }
    const liftH = Number(host.__skinZ) || 0;
    // Instancja względem początku przy kamerze (_setOrigin).
    const rx = ox - ctx.orgX; const ry = oy - ctx.orgY;
    const heatMul = Math.exp(-Math.max(0, ctx.heatNow - rec.rowTime) * ctx.heatDecay);
    const K = rec.kind;

    if (T.drawModel && K.count < K.capacity) {
      const n = K.count++;
      const L = B3_MODEL_LAYOUT;
      const A = K.inst.array;
      const o = n * L.stride;
      writeInstance(A, o, ax, ay, bx, by, sz, rx, ry, liftH);
      writeInstanceData(A, o, L, rec, fade, heatMul);
      A[o + L.aB3Mask] = rec.maskLo;
      A[o + L.aB3Mask + 1] = rec.maskHi;
      A[o + L.aB3Hull] = hullLightAt(rec, host, pose, ctx);
      A[o + L.aB3Hull + 1] = lod; A[o + L.aB3Hull + 2] = 0; A[o + L.aB3Hull + 3] = 0;
    }
    const Rv = this.receiver;
    if (T.receiver && !lod && Rv.count < Rv.capacity) {
      const n = Rv.count++;
      const L = B3_RECEIVER_LAYOUT;
      const A = Rv.inst.array;
      const o = n * L.stride;
      writeInstance(A, o, ax, ay, bx, by, sz, rx, ry, liftH);
      writeInstanceData(A, o, L, rec, fade, heatMul);
    }

    // Emitery: okna (gasną z komórką pod sobą i wg osi czasu), lampy, listwy.
    // Okna i lampy (warstwa FG — nad passem ortho, bez głębi): mostek pod płaszczyzną kadłubów (fregata w luku) ich nie ma.
    const winFade = liftH < 0 ? 0 : smooth01(T.winMinPx, T.winFullPx, 2.0 * sgx * zoomAt) * fade;
    this._emit(rec, host, ctx, winFade, ax, ay, bx, by, sz, ox, oy);
  },

  // Encja z listy z komórkami rekordu martwymi u gospodarza (odłam rodu z częścią mostka).
  _findMoved(rec, entities, host) {
    const hostHull = bridgeBeamHull(host);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e || e === host || e.dead) continue;
      if (beamEntityOwnsAny(rec, e, hostHull)) return e;
    }
    return null;
  },

  _emit(rec, host, ctx, winFade, ax, ay, bx, by, sz, ox, oy) {
    const E = rec.kind.emit;
    if (!E.count) return;
    const T = BRIDGE3D_TUNE;
    const Em = this.emitters;
    const M = Em.mesh.instanceMatrix.array;
    const P = Em.attrs.params.array;
    const C = Em.attrs.color.array;
    const Sh = Em.attrs.shape.array;
    const st = rec.st;
    const zMode = ctx.free ? 1 : 0;
    const beforeLoss = !st.commandLost && rec.powerLostAt < 0;
    prepareEmitterDelays(rec);
    const beamHull = bridgeBeamHull(host);
    const ns = beamHull ? beamHull.body.nodeStore : null;
    for (let i = 0; i < E.count; i++) {
      // Węzeł komórki pod oknem (−1 = wybita albo poza gospodarzem).
      const node = bridgeCellNode(beamHull, rec.emCellX[i], rec.emCellY[i]);
      if (node < 0) {
        // Pomieszczenie wybite: krótki błysk w chwili śmierci komórki pod oknem.
        if (rec.emWas[i] && beforeLoss && ctx.flashes < MAX_ROOM_FLASHES_PER_FRAME && winFade > 0.05 && E.type[i] === BRIDGE3D_EMIT.WINDOW) {
          const wx = ox + ax * E.cx[i] + bx * E.cy[i];
          const wy = oy + ay * E.cx[i] + by * E.cy[i];
          spawnBridgeRoomFlash(wx, -wy, rec.winColor, bridgeHullFxScale(host));
          ctx.flashes++;
        }
        rec.emWas[i] = 0;
        continue;
      }
      rec.emWas[i] = 1;
      if (winFade <= 0.001 || Em.count >= Em.capacity || !T.drawEmitters) continue;
      const hpFrac = ns.maxHp[node] > 0 ? ns.hp[node] / ns.maxHp[node] : 1;
      let I = bridgeEmitterLight(rec, i, ctx.now, hpFrac) * winFade;
      if (I <= 0.003) continue;
      // Zasłonięte przez obraz nad okrętem (fregata zwiadu nad Atlasem — emitterOcclusion z gry).
      if (this.emitterOcclusion !== null) {
        I *= this.emitterOcclusion(host, ox + ax * E.cx[i] + bx * E.cy[i], -(oy + ay * E.cx[i] + by * E.cy[i]));
        if (I <= 0.003) continue;
      }
      const type = E.type[i];
      let col;
      let halo;
      if (type === BRIDGE3D_EMIT.WINDOW) {
        col = E.colorKey[i] === 'window' ? rec.winColor : (this._emitColors[E.colorKey[i]] || rec.winColor);
        halo = T.winHaloScale * Math.min(E.halfW[i], E.halfH[i]) * 2;
      } else if (type === BRIDGE3D_EMIT.BEACON) {
        col = this._emitColors[E.colorKey[i]] || this._emitColors.beacon_white;
        halo = T.beaconHaloScale * E.halfW[i] * 2;
      } else {
        col = this._emitColors[E.colorKey[i]] || this._emitColors.accent;
        halo = E.halfH[i] * 1.5;
      }
      const n = Em.count++;
      const cx = E.cx[i]; const cy = E.cy[i];
      // Względem początku przy kamerze (_setOrigin) — małe liczby dla float32.
      const px = ox - ctx.orgX + ax * cx + bx * cy;
      const py = oy - ctx.orgY + ay * cx + by * cy;
      const pz = zMode ? MODEL_LIFT + sz * E.cz[i] + 0.02 : 0;
      const e0 = 2 * (E.halfW[i] + halo);
      const e1 = 2 * (E.halfH[i] + halo);
      let t0; let t1; let t2; let b0; let b1; let b2;
      if (type === BRIDGE3D_EMIT.BEACON && zMode) {
        // Wolna kamera: lampa jako billboard.
        t0 = _camR.x * sz; t1 = _camR.y * sz; t2 = _camR.z * sz;
        b0 = _camU.x * sz; b1 = _camU.y * sz; b2 = _camU.z * sz;
      } else {
        t0 = ax * E.tx[i] + bx * E.ty[i]; t1 = ay * E.tx[i] + by * E.ty[i]; t2 = zMode ? sz * E.tz[i] : 0;
        b0 = ax * E.bx[i] + bx * E.by[i]; b1 = ay * E.bx[i] + by * E.by[i]; b2 = zMode ? sz * E.bz[i] : 0;
      }
      const o = n * 16;
      M[o] = t0 * e0; M[o + 1] = t1 * e0; M[o + 2] = t2 * e0; M[o + 3] = 0;
      M[o + 4] = b0 * e1; M[o + 5] = b1 * e1; M[o + 6] = b2 * e1; M[o + 7] = 0;
      M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
      M[o + 12] = px; M[o + 13] = py; M[o + 14] = pz; M[o + 15] = 1;
      P[n * 4] = I; P[n * 4 + 1] = E.halfW[i]; P[n * 4 + 2] = E.halfH[i]; P[n * 4 + 3] = halo;
      C[n * 3] = col[0]; C[n * 3 + 1] = col[1]; C[n * 3 + 2] = col[2];
      Sh[n] = type === BRIDGE3D_EMIT.WINDOW ? 0 : (type === BRIDGE3D_EMIT.BEACON ? 1 : 2);
    }
  },

  _setDisabled(disabled) {
    this._disabled = disabled;
    for (const rec of this.records) {
      if (rec.st && rec.host?.bridgeState === rec.st) rec.st.model3D = disabled ? false : rec.host.__bridge3DFull === true;
    }
    if (disabled) {
      for (const K of this.kinds) { K.geometry.instanceCount = 0; K.mesh.visible = false; }
      if (this.receiver) { this.receiver.geometry.instanceCount = 0; this.receiver.mesh.visible = false; }
      if (this.emitters) { this.emitters.mesh.count = 0; this.emitters.mesh.visible = false; }
    }
  },

  /**
   * Ukrywa / pokazuje moduł modelu na instancji (przyszły wizualny silnik
   * destrukcji 3D: odczepiony moduł rysuje on sam). moduleId — indeks
   * w modules modelu (≤ 47).
   */
  setModuleHidden(rec, moduleId, hidden) {
    if (!rec || moduleId < 0 || moduleId > 47) return;
    const lo = moduleId < 24;
    const bit = 2 ** (lo ? moduleId : moduleId - 24);
    const word = lo ? rec.maskLo : rec.maskHi;
    const has = Math.floor(word / bit) % 2 === 1;
    const next = hidden ? (has ? word : word + bit) : (has ? word - bit : word);
    if (lo) rec.maskLo = next; else rec.maskHi = next;
  },

  /**
   * Siatki do rejestru rozgrzewki (Core3D.warmup): bryła (jeden materiał na wszystkie rodzaje —
   * wystarczy pierwszy rodzaj), cień na kadłubie (pass ortho) i okna (FG). Bez tego pierwszy mostek
   * w kadrze kompilowałby pipeline'y synchronicznie w swojej klatce.
   */
  warmupMeshes() {
    if (!this.ready) return [];
    const out = [];
    if (this.kinds[0]?.mesh) out.push(this.kinds[0].mesh);
    if (this.receiver?.mesh) out.push(this.receiver.mesh);
    if (this.emitters?.mesh) out.push(this.emitters.mesh);
    return out;
  },

  /** Rekordy (instancje) hostowane przez encję — do debugowania i silnika destrukcji. */
  recordsOf(entity) {
    return entity?.__bridge3D ? entity.__bridge3D.slice() : [];
  },

  /** Model rodzaju (geometria, moduły, emitery) — tylko do odczytu. */
  getModel(kindName) {
    const K = this.kinds.find((k) => k.name === kindName);
    return K ? K.model : null;
  },

  dispose() {
    for (const rec of this.records.slice()) this._retire(rec);
    this.records.length = 0;
    const scene = this.scene;
    for (const K of this.kinds) {
      if (scene && K.mesh) scene.remove(K.mesh);
      K.geometry?.dispose?.();
    }
    // Jeden materiał bryły na wszystkie rodzaje.
    this._modelMaterial?.dispose?.();
    this._modelMaterial = null;
    this.kinds = [];
    for (const part of [this.receiver, this.emitters]) {
      if (!part) continue;
      if (scene && part.mesh) scene.remove(part.mesh);
      part.geometry?.dispose?.();
      part.material?.dispose?.();
    }
    this.receiver = null;
    this.emitters = null;
    this.heightTex?.dispose?.();
    this.damage = null;
    this.heightTex = null;
    this.uniforms = null;
    this._nodes = null;
    this.scene = null;
    this.ready = false;
  }
};

// Transformacja instancji (dawne instanceMatrix: kolumny (ax, ay, 0), (bx, by,
// 0), (0, 0, sz), przesunięcie (ox, oy, MODEL_LIFT)) w buforze przeplecionym:
// iBasis = (ax, ay, bx, by), iOrg = (ox, oy, sz, MODEL_LIFT). o — początek
// instancji w tablicy (n · stride); układ: bridge3D.tsl.js.
function writeInstance(A, o, ax, ay, bx, by, sz, ox, oy, lift = 0) {
  A[o] = ax; A[o + 1] = ay; A[o + 2] = bx; A[o + 3] = by;
  A[o + 4] = ox; A[o + 5] = oy; A[o + 6] = sz; A[o + 7] = MODEL_LIFT + lift;
}

function writeInstanceData(A, o, L, rec, fade, heatMul) {
  // Siatka belek: model → współrzędne komórek (shader: komórka = floor).
  const c = rec.cellMap;
  let k = o + L.aB3GridA;
  A[k] = c.a0; A[k + 1] = c.b0; A[k + 2] = c.n00; A[k + 3] = c.n01;
  k = o + L.aB3GridB;
  A[k] = c.n10; A[k + 1] = c.n11; A[k + 2] = rec.c0; A[k + 3] = rec.r0;
  k = o + L.aB3Dmg;
  A[k] = rec.row; A[k + 1] = rec.blockW; A[k + 2] = rec.blockH; A[k + 3] = rec.anyDead;
  k = o + L.aB3State;
  A[k] = fade; A[k + 1] = heatMul; A[k + 2] = rec.kind.index; A[k + 3] = rec.cellPx;
}

/**
 * Jasność kadłuba pod środkiem strefy — lustro HEX_FRAGMENT_SHADER bez normal
 * mapy: poduszkowa normalna normalize(p.x·0,45, −p.y·0,45, 1) z UV sprite'a,
 * obrót kadłuba (renderRotation = −kąt), uLightDir = normalize(słońce −
 * statek, 600) w scenie. lightMul = otoczenie + rozproszone·max(0, N·L).
 */
export function hullLightAt(rec, host, pose, ctx) {
  const T = BRIDGE3D_TUNE;
  const px = (rec.map.zgx / rec.srcW) * 2 - 1;
  const py = (rec.map.zgy / rec.srcH) * 2 - 1;
  let nx = px * 0.45;
  let ny = -py * 0.45;
  const nl = Math.hypot(nx, ny, 1);
  nx /= nl; ny /= nl;
  const nz = 1 / nl;
  const ang = -(pose ? pose.angle : (Number(host.angle) || 0));
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const wx = nx * c - ny * s;
  const wy = nx * s + ny * c;
  const ex = pose ? pose.x : (Number(host.x) || 0);
  const ey = pose ? pose.y : (Number(host.y) || 0);
  let lx = ctx.sunX - ex;
  let ly = -(ctx.sunY - ey);
  let lz = 600;
  const ll = Math.hypot(lx, ly, lz) || 1;
  lx /= ll; ly /= ll; lz /= ll;
  return T.ambient + T.diffuse * Math.max(0, wx * lx + wy * ly + nz * lz);
}

if (typeof window !== 'undefined') window.Bridge3D = Bridge3D;
