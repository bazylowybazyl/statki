// src/3d/bridge3D.js
//
// MODEL 3D MOSTKA — jedyny element 3D na kadłubie (kadłuby to płaskie meshe
// heksów z teksturą sprite'a). Geometria: bridge3DShapes.js. Stan (strefy,
// heksy, oś czasu utraty dowodzenia) czyta z entity.bridgeState
// (src/game/shipBridge.js) — nic nie liczy od nowa i nic nie zmienia
// w gameplayu: obrażenia, kolizje i kill zostają w 2D. Opis i liczby:
// docs/PORT-mostki.md §8.
//
// RYSOWANIE (jeden renderer: Core3D; obiekty w podanej scenie):
//   • model — InstancedMesh na rodzaj (BRIDGE3D_KIND_ORDER: Bellator, Iron
//     Skull, Atlas rufowy i zapasowy, Custos, Hasta, Citadella, Colossus,
//     fregata i niszczyciel piratów, lokomotywa megafrachtowca): warstwa 0
//     (pass ortho, jak kadłuby), renderOrder 12 — rysuje się tylko rodzaj,
//     który ma widoczne instancje;
//   • cień na kadłubie — jeden InstancedMesh prostokątów tuż POD kadłubem
//     (renderOrder 11, test głębi GREATER): rysuje się tylko tam, gdzie
//     kadłub zapisał głębię, więc jest przycięty do sylwetki i nie wpada
//     w wyrwy. Kadłuby nie odbierają shadow map three.js — cień liczy marsz
//     po mapie wysokości modelu w stronę słońca;
//   • okna, lampy i listwy — jeden InstancedMesh na warstwie 2 (FG),
//     addytywnie, bez maski cienia: świecą też w cieniu planety.
//   Razem: widoczne rodzaje + 2 wywołania rysowania na całą flotę.
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
// OBRAŻENIA: tekstura obrażeń (RGBA8, wiersz na instancję — duży mostek
// zajmuje kilka kolejnych wierszy, blok leży w nich liniowo) trzyma stan
// komórek siatki heksów pod modelem: żywa (+ HP), żar, maska martwych
// sąsiadów, świeże cięcie. Fragment modelu nad martwą komórką znika (wyrwa),
// brzeg przy martwym sąsiedzie ciemnieje i żarzy się jak brzeg rany kadłuba.
// Wiersz odświeża się tylko, gdy w siatce zginął heks (ref shards /
// activeStructuralCount) albo co REFRESH_SEC.
//
// WRAK: finishBridgeKill (index.html) przekazuje heksy hulka wrakowi jako TE
// SAME obiekty (spawnWreckEntity). Rekord trzyma heksy swoich komórek, więc
// gdy gospodarz zniknie, znajduje nowego po przynależności heksów i zostaje
// na wraku — zgaszony, z wyrwami (łup do holowania). Tak samo przy rozpadzie
// kadłuba: część mostka na odłamku dostaje własny rekord.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import {
  BRIDGE_KILL_TIMELINE,
  BRIDGE_LAYOUT_PROPOSALS,
  bridgeGridToWorld,
  bridgeHash01,
  bridgeWaveDelay,
  sampleNavLight,
  sampleWindowLight
} from '../game/shipBridge.js';
import { resolveBridgeHullKey } from '../game/shipBridgeRuntime.js';
import { DESTRUCTOR_CONFIG, shardHeatNow } from '../game/destructor.js';
import {
  BRIDGE3D_EMIT,
  BRIDGE3D_KINDS,
  BRIDGE3D_KIND_ORDER,
  buildBridgeModel,
  hexCellOf,
  hexNeighborCell,
  resolveBridgeModelKind
} from './bridge3DShapes.js';
import { bridgeHullFxScale, spawnBridgeRoomFlash } from './bridgeFx3D.js';
import { SUN_SHADOW_GLSL, sunShadowUniforms } from './sunShadowMask.js';

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
  rimWidth: 1.8,            // szerokość przypalonego brzegu [px siatki]
  scorch: 0.6,              // przyciemnienie przy martwym sąsiedzie
  cutGlow: 0.42             // żar świeżego cięcia na samej krawędzi (0..1 jak żar heksa)
};

if (typeof window !== 'undefined') window.__bridge3DTune = BRIDGE3D_TUNE;

// ---------------------------------------------------------------------------
// Stałe
// ---------------------------------------------------------------------------

const DAMAGE_W = 768;          // komórek w wierszu tekstury obrażeń
const DAMAGE_ROWS = 512;       // wierszy (rekord: ceil(komórki / DAMAGE_W) kolejnych)
const DAMAGE_MAX_ROWS = 4;     // największy blok: 3072 komórki (lokomotywa ~2000)
const KIND_COUNT = BRIDGE3D_KIND_ORDER.length;
export const BRIDGE3D_DAMAGE_LIMITS = Object.freeze({ width: DAMAGE_W, rows: DAMAGE_ROWS, maxRows: DAMAGE_MAX_ROWS });
const RECEIVER_CAPACITY = 640;
const EMITTER_CAPACITY = 8192;
const MODEL_RENDER_ORDER = 12;     // kadłub 10, pancerz 9
const RECEIVER_RENDER_ORDER = 11;
const EMITTER_RENDER_ORDER = 51;   // jak okna bridgeFx3D; lampy pozycyjne 52
const MODEL_LIFT = 0.06;           // podstawa modelu tuż nad płaszczyzną kadłuba
const RECEIVER_Z = -0.6;           // pod kadłubem (0) i płytą pancerza (−0,25)
const REFRESH_SEC = 1.0;           // okresowo tylko HP i żar bez śmierci heksa
const ROW_RELEASE_SEC = 2;         // niewidziany gospodarz oddaje wiersz tekstury
const RECORD_TTL_SEC = 60;         // ...a po minucie rekord odchodzi całkiem
const MAX_ROOM_FLASHES_PER_FRAME = 6;
const DEG = Math.PI / 180;
const SQRT3 = Math.sqrt(3);

// Palety (sRGB → liniowo przy starcie) z próbek stref na sprite'ach.
// Kolejność = BRIDGE3D_MAT: farba, panel, ciemny metal, akcent, szyba,
// rama okien, jasny detal, brud/rdza.
export const BRIDGE3D_KIND_STYLE = {
  bellator: { palette: ['#c9c9c3', '#aaaaa4', '#4c5358', '#8e939a', '#141c25', '#394045', '#e4e4de', '#7b776f'], spec: 1.0, seams: 0.12, grime: 0.1, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' },
  // Iron Skull i reszta rodziny: próbki NOWYCH sprite'ów (migracja 2026-09-24) —
  // ciemna stal z rdzą jako akcentem, kości kolców; łaty rdzy nie dominują.
  ironskull: { palette: ['#4a4440', '#39332f', '#15110f', '#7a4127', '#24130a', '#211b18', '#b6a595', '#4d3021'], spec: 0.6, seams: 0.22, grime: 0.28, rivets: 1, rust: 0.4, sky: 0.6, interior: '#140f0c' },
  atlas_main: { palette: ['#56606f', '#434b58', '#252a33', '#2c8ca4', '#0d1720', '#2a303a', '#8a94a2', '#343943'], spec: 1.0, seams: 0.14, grime: 0.08, rivets: 0, rust: 0, sky: 1.2, interior: '#0f1216' },
  atlas_backup: { palette: ['#56606f', '#434b58', '#252a33', '#2c8ca4', '#0d1720', '#2a303a', '#8a94a2', '#343943'], spec: 1.0, seams: 0.14, grime: 0.08, rivets: 0, rust: 0, sky: 1.2, interior: '#0f1216' },
  // Terra Nova: ta sama biel co Bellator; Custos i Hasta cieplejsze (próbki stref).
  custos: { palette: ['#c4c0b0', '#a19d8f', '#464a45', '#8a8a80', '#141c25', '#383c3a', '#e0dccb', '#77705f'], spec: 1.0, seams: 0.12, grime: 0.12, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' },
  hasta: { palette: ['#c0bba9', '#9d998a', '#474a47', '#8b897d', '#141c25', '#383c3a', '#ddd8c6', '#79725f'], spec: 1.0, seams: 0.12, grime: 0.12, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' },
  citadella: { palette: ['#d0cec7', '#b1aea6', '#4a4d50', '#8f9398', '#141c25', '#394045', '#e6e5df', '#7d7a73'], spec: 1.0, seams: 0.12, grime: 0.1, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' },
  colossus: { palette: ['#cfcdc7', '#b3b0a8', '#4a4c4f', '#8e9196', '#141c25', '#394045', '#e6e5e0', '#7b7870'], spec: 1.0, seams: 0.12, grime: 0.1, rivets: 0, rust: 0, sky: 1.0, interior: '#1a1d21' },
  pirate_frigate: { palette: ['#4a4440', '#39332f', '#15110f', '#7a4127', '#24130a', '#211b18', '#b6a595', '#4d3021'], spec: 0.6, seams: 0.22, grime: 0.3, rivets: 1, rust: 0.4, sky: 0.55, interior: '#140f0c' },
  pirate_destroyer: { palette: ['#4b4541', '#3a3430', '#16120f', '#7c4328', '#24130a', '#211b18', '#b3a292', '#4f3122'], spec: 0.6, seams: 0.22, grime: 0.3, rivets: 1, rust: 0.4, sky: 0.55, interior: '#140f0c' },
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
// GLSL
// ---------------------------------------------------------------------------

// Lustro HEAT_RAMP_GLSL z hexShips3D.js — ten sam metal ma tę samą barwę żaru
// na kadłubie i na modelu.
const B3_HEAT_RAMP_GLSL = `
vec3 b3HeatRamp(float h) {
  vec3 c = mix(vec3(0.55, 0.04, 0.01), vec3(1.0, 0.30, 0.04), smoothstep(0.0, 0.45, h));
  c = mix(c, vec3(1.0, 0.70, 0.22), smoothstep(0.45, 0.75, h));
  return mix(c, vec3(1.0, 0.93, 0.80), smoothstep(0.75, 1.0, h));
}
`;

// Wspólne dla modelu i cienia: przestrzeń modelu → siatka heksów, komórka,
// tekstura obrażeń, mapa wysokości, marsz cienia, AO. Lustro heksów:
// hexCellOf / hexCellCenterXY / HEX_NEIGHBOR_DIRS w bridge3DShapes.js.
// Deklaracje (vertex i fragment). vB3State.w = promień heksa siatki.
const B3_DECL_GLSL = `
#define B3_KINDS ${KIND_COUNT}
#define B3_DAMAGE_W ${DAMAGE_W}
#define B3_SHADOW_STEPS 32
uniform highp sampler2D uB3Damage;
uniform sampler2D uB3Height;
uniform vec4 uB3HmBounds[B3_KINDS];
uniform vec4 uB3HmRegion[B3_KINDS];
uniform float uB3HmTop[B3_KINDS];
uniform float uB3Detail[B3_KINDS];
uniform vec4 uB3Shadow;
uniform vec4 uB3Ao;

flat varying vec4 vB3GridA;
flat varying vec4 vB3GridB;
flat varying vec4 vB3Dmg;
flat varying vec4 vB3State;
`;

// Funkcje (tylko fragment — rozrzut marszu cienia liczy pochodne).
const B3_FUNC_GLSL = `
#define B3_HEXR (vB3State.w > 0.0 ? vB3State.w : 5.0)

const vec2 B3_HEX_DIRS[6] = vec2[6](
  vec2(0.8660254, 0.5), vec2(0.8660254, -0.5), vec2(0.0, -1.0),
  vec2(-0.8660254, -0.5), vec2(-0.8660254, 0.5), vec2(0.0, 1.0));

vec2 b3Grid(vec2 m) {
  return vB3GridA.xy + vec2(dot(vB3GridA.zw, m), dot(vB3GridB.xy, m));
}

vec2 b3HexCell(vec2 g) {
  float q = g.x * (2.0 / 3.0) / B3_HEXR;
  float r = (g.y * 0.5773502692 - g.x / 3.0) / B3_HEXR;
  float sc = -q - r;
  float rq = floor(q + 0.5);
  float rr = floor(r + 0.5);
  float rs = floor(sc + 0.5);
  float dq = abs(rq - q);
  float dr = abs(rr - r);
  float ds = abs(rs - sc);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return vec2(rq, rr + (rq - mod(rq, 2.0)) * 0.5);
}

vec2 b3HexCenter(vec2 cr) {
  return vec2(cr.x * 1.5 * B3_HEXR, (cr.y + 0.5 * mod(cr.x, 2.0)) * 1.7320508076 * B3_HEXR);
}

vec4 b3Cell(vec2 cr) {
  vec2 lc = cr - vB3GridB.zw;
  if (lc.x < 0.0 || lc.y < 0.0 || lc.x >= vB3Dmg.y || lc.y >= vB3Dmg.z) return vec4(0.0);
  // Blok leży liniowo od wiersza vB3Dmg.x (duży mostek — kilka wierszy).
  int idx = int(lc.x + lc.y * vB3Dmg.y + 0.5);
  return texelFetch(uB3Damage, ivec2(idx % B3_DAMAGE_W, int(vB3Dmg.x + 0.5) + idx / B3_DAMAGE_W), 0);
}

// Skala detalu rodzaju (panele, brud, AO) względem Bellatora.
float b3Detail() {
  return uB3Detail[int(vB3State.z + 0.5)];
}

float b3Height(vec2 m) {
  int k = int(vB3State.z + 0.5);
  vec4 bb = uB3HmBounds[k];
  vec2 t = (m - bb.xy) * bb.zw;
  if (t.x <= 0.0 || t.y <= 0.0 || t.x >= 1.0 || t.y >= 1.0) return 0.0;
  vec4 rg = uB3HmRegion[k];
  // Wysokość w atlasie normalizowana do szczytu rodzaju (8 bitów na model).
  float h = texture2D(uB3Height, rg.xy + t * rg.zw).r * uB3HmTop[k];
  // Bez uszkodzeń nie szukamy heksa (typowy przypadek: 1 odczyt na krok).
  if (h <= 0.02 || vB3Dmg.w < 0.5) return h;
  return b3Cell(b3HexCell(b3Grid(m))).r > 0.2 ? h : 0.0;
}

// Rozrzut startu marszu cienia (zamiast pasków): szum przyklejony do modelu
// w komórkach ~1 px ekranu (potęga 2 — stały przy drobnym zoomie). Szum
// z gl_FragCoord stał w ekranie i „gotował się” na modelu przy ruchu kamery.
// Wołać w jednolitym przepływie (pochodne), przed discard.
float b3Dither(vec3 p) {
  vec3 fw = fwidth(p);
  float cell = exp2(ceil(log2(max(max(fw.x, fw.y), max(fw.z, 1e-3)))));
  vec3 q = floor(p / cell);
  return fract(52.9829189 * fract(dot(q.xy, vec2(0.06711056, 0.00583715)) + q.z * 0.0182));
}

// Marsz w stronę słońca cieni po mapie wysokości. p — punkt (przestrzeń M),
// dir — jednostkowy azymut słońca (M, XY), jit — b3Dither. 1 = w pełni oświetlony.
float b3Shadow(vec3 p, vec2 dir, float jit) {
  int k = int(vB3State.z + 0.5);
  float top = uB3HmTop[k];
  float tanE = max(uB3Shadow.x, 0.05);
  if (p.z >= top) return 1.0;
  float maxT = (top - p.z) / tanE;
  float stepT = max(0.45, maxT / float(B3_SHADOW_STEPS));
  float t = stepT * (0.3 + 0.7 * jit);
  float lit = 1.0;
  for (int i = 0; i < B3_SHADOW_STEPS; i++) {
    if (t > maxT) break;
    float rayZ = p.z + t * tanE;
    float h = b3Height(p.xy + dir * t);
    lit = min(lit, clamp((rayZ - h) / (uB3Shadow.z * t + 0.3 * b3Detail()), 0.0, 1.0));
    if (lit <= 0.001) break;
    t += stepT;
  }
  return lit;
}

// Kontaktowe przyciemnienie: ile brył wokół punktu wystaje ponad niego.
float b3Occlusion(vec3 p) {
  float R = uB3Ao.x * b3Detail();
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982 + 0.3927;
    float rr = (i % 2 == 0) ? R : R * 2.2;
    vec2 q = p.xy + vec2(cos(a), sin(a)) * rr;
    occ += clamp((b3Height(q) - p.z) / (rr * 1.2), 0.0, 1.0);
  }
  return 1.0 - uB3Ao.y * occ * 0.125;
}
`;

const MODEL_VERT = `
attribute float aMat;
attribute float aModule;
attribute vec4 aB3GridA;
attribute vec4 aB3GridB;
attribute vec4 aB3Dmg;
attribute vec4 aB3State;
attribute vec2 aB3Mask;
attribute vec4 aB3Hull;
uniform vec2 uB3Sun;
${B3_DECL_GLSL}
flat varying vec3 vB3Light;
flat varying vec4 vB3Hull;
varying vec3 vB3Pos;
varying vec3 vB3Normal;
varying vec3 vB3View;
varying float vB3Mat;

void main() {
  vB3GridA = aB3GridA;
  vB3GridB = aB3GridB;
  vB3Dmg = aB3Dmg;
  vB3State = aB3State;
  vB3Pos = position;
  vB3Normal = normal;
  vB3Mat = aMat;
  vB3Hull = aB3Hull;
  // Pozycja: translacje instancji są względem początku przy kamerze
  // (mesh.position), więc liczby są małe; duże przesunięcie siedzi
  // w modelViewMatrix, które three składa na CPU w double. Przy współrzędnych
  // świata ~10⁷ float32 w shaderze dawał skoki ~1 px — drżenie względem kadłuba.
  mat4 mvI = modelViewMatrix * instanceMatrix;
  vec4 mv = mvI * vec4(position, 1.0);
  // Światło jak kadłub: kierunek do słońca z wysokością 600 (scena: y = −y
  // świata). Słońce jest daleko — pozycja instancji w float32 wystarcza.
  mat4 inst = modelMatrix * instanceMatrix;
  vB3Light = normalize(transpose(mat3(inst)) * normalize(vec3(uB3Sun - inst[3].xy, 600.0)));
  // Widok w przestrzeni kamery: ortho — prosto z góry (jak kadłub).
  vec3 viewV = isOrthographic ? vec3(0.0, 0.0, 1.0) : -normalize(mv.xyz);
  vB3View = transpose(mat3(mvI)) * viewV;
  // Maska modułów (przyszły wizualny silnik destrukcji 3D): ukryty moduł znika.
  float word = aModule < 24.0 ? aB3Mask.x : aB3Mask.y;
  bool hidden = mod(floor(word / exp2(mod(aModule, 24.0))), 2.0) > 0.5;
  gl_Position = hidden ? vec4(0.0, 0.0, -2.0, 1.0) : projectionMatrix * mv;
}
`;

const MODEL_FRAG = `
uniform vec3 uB3Palette[8];
uniform vec2 uB3Spec[8];
uniform vec3 uB3Light;
uniform vec4 uB3Surface;
uniform vec4 uB3Wound;
uniform vec3 uB3Interior;
uniform vec2 uB3Coat;
${B3_DECL_GLSL}
${B3_FUNC_GLSL}
${B3_HEAT_RAMP_GLSL}
${SUN_SHADOW_GLSL}
flat varying vec3 vB3Light;
flat varying vec4 vB3Hull;
varying vec3 vB3Pos;
varying vec3 vB3Normal;
varying vec3 vB3View;
varying float vB3Mat;

float b3Hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float b3Noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(b3Hash(i), b3Hash(i + vec2(1.0, 0.0)), f.x),
             mix(b3Hash(i + vec2(0.0, 1.0)), b3Hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void main() {
  float jit = b3Dither(vB3Pos);
  // Wyrwa: heks siatki pod fragmentem zginął (albo należy już do innej encji).
  vec2 g = b3Grid(vB3Pos.xy);
  vec2 cr = b3HexCell(g);
  vec4 cell = b3Cell(cr);
  if (cell.r < 0.2) discard;
  float hpFrac = clamp((cell.r * 255.0 - 64.0) / 191.0, 0.0, 1.0);

  // Brzeg rany: odległość do krawędzi heksa, za którą leży martwy sąsiad.
  float rim = 0.0;
  int nmask = int(cell.b * 255.0 + 0.5);
  if (nmask > 0) {
    vec2 off = g - b3HexCenter(cr);
    float ap = 0.8660254 * B3_HEXR;
    for (int i = 0; i < 6; i++) {
      if (((nmask >> i) & 1) == 1) {
        float d = ap - dot(off, B3_HEX_DIRS[i]);
        rim = max(rim, 1.0 - smoothstep(0.0, uB3Wound.x, d));
      }
    }
  }

  bool front = gl_FrontFacing;
  vec3 N = normalize(front ? vB3Normal : -vB3Normal);
  int mi = int(vB3Mat + 0.5);
  vec3 albedo = uB3Palette[mi];

  // Panele: szwy cegiełkowo na płaszczyźnie najbliższej ścianie, zmienność
  // jasności paneli, brud nisko w zagłębieniach, nity (piraci).
  vec3 an = abs(N);
  vec2 suv = an.z > max(an.x, an.y) ? vB3Pos.xy : (an.x > an.y ? vB3Pos.yz : vB3Pos.xz);
  float det = b3Detail();
  // Panele w dwóch skalach: duże płyty (9 × 6 × detal) dzielone losowo na pół.
  vec2 pp = suv / (vec2(9.0, 6.0) * det);
  pp.x += floor(pp.y) * 0.37;
  vec2 cell0 = floor(pp);
  float split = b3Hash(cell0 + 17.0);
  vec2 fp = fract(pp);
  if (split > 0.55) { fp.x = fract(fp.x * 2.0); cell0.x += step(0.5, fract(pp.x)) * 0.5; }
  vec2 dl = min(fp, 1.0 - fp);
  vec2 fw = fwidth(pp) * vec2(split > 0.55 ? 2.0 : 1.0, 1.0) + vec2(1e-4);
  float seam = max(1.0 - smoothstep(0.018, 0.018 + fw.x * 1.5, dl.x), 1.0 - smoothstep(0.025, 0.025 + fw.y * 1.5, dl.y));
  float panel = b3Hash(cell0);
  albedo *= (0.93 + 0.14 * panel) * (1.0 - uB3Surface.y * seam);
  float grime = smoothstep(0.45, 0.9, b3Noise(vB3Pos.xy * (0.19 / det) + vec2(3.1, 7.7)));
  float glassM = mi == 4 ? 0.0 : 1.0;
  albedo = mix(albedo, uB3Palette[7], uB3Surface.z * grime * glassM);
  // Piraci: łatanina płyt jak na sprite'cie — stal, ciemna stal albo rdza
  // (per płyta), zacieki rdzy przy szwach, duże nity w narożnikach części płyt.
  float plateM = (mi == 0 || mi == 1) ? 1.0 : 0.0;
  if (uB3Coat.x > 0.0) {
    float pick = b3Hash(cell0 + 3.7);
    vec3 plate = pick < 0.56 ? albedo : (pick < 0.8 ? albedo * 0.7 : uB3Palette[3] * (0.7 + 0.45 * panel));
    albedo = mix(albedo, plate, uB3Coat.x * plateM);
    float streak = smoothstep(0.6, 0.82, b3Noise(vec2(vB3Pos.x * 0.9, vB3Pos.y * 0.18) / det + cell0 * 3.1) + seam * 0.25);
    albedo = mix(albedo, uB3Palette[7], 0.55 * streak * uB3Coat.x * glassM);
  }
  if (uB3Surface.w > 0.5 && split <= 0.55 && b3Hash(cell0 + 9.1) > 0.45) {
    vec2 cq = (fp - vec2(0.5)) * vec2(9.0, 6.0);
    float rd = length(abs(cq) - vec2(3.5, 2.2));
    float head = 1.0 - smoothstep(0.36, 0.5, rd);
    float ring = smoothstep(0.36, 0.5, rd) * (1.0 - smoothstep(0.52, 0.7, rd));
    float onTop = step(0.5, an.z) * plateM;
    albedo = mix(albedo, uB3Palette[6] * 0.62, head * 0.6 * onTop);
    albedo *= 1.0 - 0.45 * ring * onTop;
  }

  // Światło kadłuba (hexShips3D): otoczenie + rozproszone + połysk Blinna.
  vec3 L = normalize(vB3Light);
  vec3 V = normalize(vB3View);
  float NdotL = dot(N, L);
  vec2 sunDir = L.xy / max(length(L.xy), 1e-4);
  // LOD (vB3Hull.y = 1): mała instancja — bez marszu cienia i AO.
  bool full = vB3Hull.y < 0.5;
  float sh = full ? b3Shadow(vB3Pos + (N * 0.35 + vec3(0.0, 0.0, 0.2)) * det, sunDir, jit) : 1.0;
  float ao = full ? b3Occlusion(vB3Pos + vec3(0.0, 0.0, 0.05 * det)) : 1.0;
  // Dach świeci jak kadłub w tym miejscu (vB3Hull.x = lightMul kadłuba pod
  // środkiem strefy: otoczenie + poduszkowa normalna HEX_FRAGMENT_SHADER),
  // ściany odchylone od pionu trochę mniej; słońce dokłada się na skosach.
  // W cieniu planety/innego kadłuba (maska Core3D) zostaje przygaszone
  // otoczenie — tak jak na kadłubie pod mostkiem; własny cień modelu gaśnie.
  float sunVis = sunVisibility();
  float hullLight = uB3Light.x * sunFill(sunVis) + (vB3Hull.x - uB3Light.x) * sunVis;
  float amb = hullLight * (0.55 + 0.45 * max(N.z, 0.0)) * ao * mix(1.0, sh, uB3Shadow.w * sunVis);
  float dif = max(0.0, NdotL) * uB3Light.y * sh * sunVis;
  vec3 col = albedo * (amb + dif);
  vec3 H = normalize(L + V);
  vec2 sp = uB3Spec[mi];
  col += vec3(pow(max(dot(N, H), 0.0), sp.x) * sp.y * uB3Light.z * smoothstep(-0.02, 0.08, NdotL) * sh * sunVis);
  // Chłodne odbicie nieba (kadłuby mają lakier z odbiciem kosmosu — bez tego
  // model wyglądał na matowy i cieplejszy od kadłuba). Szyby mocniej.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
  float skyK = uB3Coat.y * (mi == 4 ? 0.09 : 0.022 + 0.05 * fres) * (0.35 + 0.65 * max(N.z, 0.0)) * ao;
  col += vec3(0.55, 0.75, 1.0) * skyK;

  // Powierzchnia nie świeci: jasne skosy od słońca łagodnie dochodzą do
  // ~0,86 (pod progiem bloomu 0,9 — bez poświaty wzdłuż sylwetki). Ponad
  // próg wychodzi tylko żar brzegu wyrwy.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  if (lum > 0.62) col *= (0.62 + 0.24 * (1.0 - exp(-(lum - 0.62) / 0.24))) / lum;

  // Brzeg wyrwy: przypalony; żar kadłuba (G, cały heks jak na kadłubie)
  // i żar świeżego cięcia (A, cienka krawędź przy martwym sąsiedzie).
  col *= 1.0 - max(rim * uB3Wound.y, (1.0 - hpFrac) * 0.3);
  float hHull = cell.g * vB3State.y;
  float hCut = cell.a * uB3Wound.z * vB3State.y * rim * rim;
  float heat = max(hHull * (0.3 + 0.7 * rim), hCut);
  float glowK = uB3Wound.w * (0.26 * heat + 0.74 * heat * heat * heat * heat);
  col += b3HeatRamp(heat) * glowK;

  // Tył ścian widoczny przez wyrwę (wolna kamera): ciemne wnętrze.
  if (!front) col = uB3Interior * (0.35 + 0.65 * ao) + b3HeatRamp(heat) * glowK * 0.6;

  gl_FragColor = vec4(col, vB3State.x);
}
`;

const RECEIVER_VERT = `
attribute vec4 aB3GridA;
attribute vec4 aB3GridB;
attribute vec4 aB3Dmg;
attribute vec4 aB3State;
uniform vec2 uB3Sun;
${B3_DECL_GLSL}
flat varying vec2 vB3SunDir;
varying vec2 vB3Pos2;

void main() {
  vB3GridA = aB3GridA;
  vB3GridB = aB3GridB;
  vB3Dmg = aB3Dmg;
  vB3State = aB3State;
  int k = int(aB3State.z + 0.5);
  vec4 bb = uB3HmBounds[k];
  vec2 lo = bb.xy;
  vec2 hi = bb.xy + 1.0 / bb.zw;
  mat4 inst = modelMatrix * instanceMatrix;
  vec3 Lm = normalize(transpose(mat3(inst)) * normalize(vec3(uB3Sun - inst[3].xy, 600.0)));
  vec2 dir = Lm.xy / max(length(Lm.xy), 1e-4);
  vB3SunDir = dir;
  // Prostokąt: obrys modelu wydłużony w stronę od słońca o zasięg cienia.
  vec2 off = -dir * (uB3HmTop[k] / max(uB3Shadow.x, 0.05));
  float pad = uB3Ao.x * 2.5 * uB3Detail[k];
  vec2 qlo = min(lo, lo + off) - vec2(pad);
  vec2 qhi = max(hi, hi + off) + vec2(pad);
  vec2 m = mix(qlo, qhi, position.xy + 0.5);
  vB3Pos2 = m;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(m, ${RECEIVER_Z.toFixed(2)}, 1.0);
}
`;

const RECEIVER_FRAG = `
${B3_DECL_GLSL}
${B3_FUNC_GLSL}
${SUN_SHADOW_GLSL}
flat varying vec2 vB3SunDir;
varying vec2 vB3Pos2;

void main() {
  vec3 p = vec3(vB3Pos2, 0.0);
  float sh = b3Shadow(p, vB3SunDir, b3Dither(p));
  float ao = b3Occlusion(p);
  // Bez słońca (cień planety — maska Core3D) mostek nie rzuca cienia, AO zostaje.
  float dark = (1.0 - sh) * uB3Shadow.y * sunVisibility() + (1.0 - ao);
  dark = min(dark, 0.8) * vB3State.x;
  if (dark < 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, dark);
}
`;

const EMIT_VERT = `
attribute vec4 aParams;
attribute vec3 aColor;
attribute float aShape;
varying vec2 vLocal;
flat varying vec4 vParams;
flat varying vec3 vColor;
flat varying float vShape;

void main() {
  vParams = aParams;
  vColor = aColor;
  vShape = aShape;
  vLocal = position.xy * vec2(2.0 * (aParams.y + aParams.w), 2.0 * (aParams.z + aParams.w));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position.xy, 0.0, 1.0);
}
`;

// Rdzeń okna tuż nad progiem bloomu (0,9), poświata pod nim — świecą drobne
// punkty, nie sylwetka (zakaz obwódki). Lampa: jak światła pozycyjne.
const EMIT_FRAG = `
uniform vec3 uCore;
uniform vec3 uHalo;
varying vec2 vLocal;
flat varying vec4 vParams;
flat varying vec3 vColor;
flat varying float vShape;

void main() {
  int shape = int(vShape + 0.5);
  float d;
  if (shape == 1) {
    d = length(vLocal) - vParams.y;
  } else {
    vec2 q = abs(vLocal) - vParams.yz + vec2(0.16);
    d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.16;
  }
  float aa = max(fwidth(d), 1e-4);
  float core = 1.0 - smoothstep(-aa, aa, d);
  float halo = shape == 1
    ? pow(max(0.0, 1.0 - max(d, 0.0) / max(vParams.w, 1e-3)), 2.4) * (1.0 - core)
    : exp(-max(d, 0.0) / max(vParams.w * 0.45, 1e-3)) * (1.0 - core);
  float cg = shape == 0 ? uCore.x : (shape == 1 ? uCore.y : uCore.z);
  float hg = shape == 0 ? uHalo.x : (shape == 1 ? uHalo.y : uHalo.z);
  float I = vParams.x;
  vec3 col = vColor * I * (core * cg + halo * hg);
  float a = clamp(I * (core + halo * 0.5), 0.0, 1.0);
  if (a < 0.002) discard;
  gl_FragColor = vec4(col, a);
}
`;

// ---------------------------------------------------------------------------
// Rekord = jedna instancja modelu (jeden mostek jednego gospodarza)
// ---------------------------------------------------------------------------

const _cell = { c: 0, r: 0 };
const _nb = { c: 0, r: 0 };

/**
 * Mapowanie przestrzeni modelu na siatkę heksów kadłuba dla strefy `def`
 * (px PNG) i skal kx/ky (render/PNG). Siatka = układ szablonu kadłuba:
 * komórka (0, 0) w (0, 0), bez pivota (pivot wraku dolicza bridgeGridToWorld).
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

/**
 * Blok komórek siatki pod modelem: obrys mapy wysokości (M) + pierścień
 * zapasu (sąsiedzi komórek brzegowych). Wynik: { c0, r0, w, h }.
 */
export function bridgeCellBlock(map, field, R) {
  const x0 = field.x0;
  const y0 = field.y0;
  const x1 = field.x0 + (field.width - 1) * field.texel;
  const y1 = field.y0 + (field.height - 1) * field.texel;
  let gx0 = Infinity; let gy0 = Infinity; let gx1 = -Infinity; let gy1 = -Infinity;
  const p = { x: 0, y: 0 };
  for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) {
    bridgeModelToGrid(map, x, y, p);
    if (p.x < gx0) gx0 = p.x; if (p.x > gx1) gx1 = p.x;
    if (p.y < gy0) gy0 = p.y; if (p.y > gy1) gy1 = p.y;
  }
  const colW = 1.5 * R;
  const rowH = SQRT3 * R;
  const c0 = Math.floor(gx0 / colW) - 1;
  const c1 = Math.ceil(gx1 / colW) + 1;
  const r0 = Math.floor(gy0 / rowH) - 2;
  const r1 = Math.ceil(gy1 / rowH) + 1;
  return { c0, r0, w: c1 - c0 + 1, h: r1 - r0 + 1 };
}

// Sąsiedzi w obrębie bloku (−1 = poza blokiem → traktowany jak żywy).
// Tabela zależy tylko od wymiarów bloku i parzystości kolumny c0 — wspólna
// dla wszystkich rekordów tego kształtu.
const _nbTables = new Map();
function neighbourTable(block) {
  const key = `${block.w}x${block.h}|${block.c0 & 1}`;
  let nb = _nbTables.get(key);
  if (nb) return nb;
  const n = block.w * block.h;
  nb = new Int16Array(n * 6).fill(-1);
  for (let j = 0; j < block.h; j++) {
    for (let i = 0; i < block.w; i++) {
      const k = i + j * block.w;
      for (let d = 0; d < 6; d++) {
        hexNeighborCell(block.c0 + i, block.r0 + j, d, _nb);
        const ni = _nb.c - block.c0;
        const nj = _nb.r - block.r0;
        if (ni >= 0 && nj >= 0 && ni < block.w && nj < block.h) nb[k * 6 + d] = ni + nj * block.w;
      }
    }
  }
  _nbTables.set(key, nb);
  return nb;
}

function shardAliveIn(grid, s) {
  return !!s && s.active === true && s.isDebris !== true && s.hp > 0 && grid.shards[s.__meshIndex] === s;
}

function shardPhysicallyAlive(s) {
  return !!s && s.active === true && s.isDebris !== true && s.hp > 0;
}

/**
 * Tworzy rekord (dane CPU, bez three): mapowanie, blok komórek z heksami
 * gospodarza, sąsiedzi, emitery z heksami pod nimi. `kind` — zasób rodzaju
 * ({ index, name, model, emit }). Wiersz tekstury przydziela wołający.
 */
export function createBridgeRecordCore(host, st, bridgeIndex, kind, row) {
  const grid = host.hexGrid;
  const bridge = st.bridges[bridgeIndex];
  const def = bridge.def;
  const model = kind.model;
  const map = bridgeModelGridMap(def, st.scaleX, st.scaleY, grid.srcWidth, grid.srcHeight, model.design);
  const R = Number(st.hexRadius) || 5;
  const block = bridgeCellBlock(map, model.heightField, R);
  const n = block.w * block.h;
  const cellShard = new Array(n).fill(null);
  const existed = new Uint8Array(n);
  const cols = grid.cols | 0;
  const rows = grid.rows | 0;
  const cells = grid.grid;
  for (let j = 0; j < block.h; j++) {
    for (let i = 0; i < block.w; i++) {
      const c = block.c0 + i;
      const r = block.r0 + j;
      if (c < 0 || r < 0 || c >= cols || r >= rows || !cells) continue;
      const s = cells[c + r * cols];
      if (!s || (s.c | 0) !== c || (s.r | 0) !== r) continue;
      const k = i + j * block.w;
      cellShard[k] = s;
      existed[k] = shardAliveIn(grid, s) ? 1 : 0;
    }
  }
  const nb = neighbourTable(block);
  // Emitery: heks pod każdym (gaśnie z nim) i położenie w PNG (fale gaśnięcia).
  const E = kind.emit;
  const emShard = new Array(E.count).fill(null);
  const emPngX = new Float32Array(E.count);
  const emPngY = new Float32Array(E.count);
  const g = { x: 0, y: 0 };
  for (let i = 0; i < E.count; i++) {
    bridgeModelToGrid(map, E.cx[i], E.cy[i], g);
    emPngX[i] = (g.x - grid.srcWidth * 0.5) / st.scaleX;
    emPngY[i] = (g.y - grid.srcHeight * 0.5) / st.scaleY;
    hexCellOf(g.x, g.y, R, _cell);
    if (_cell.c < 0 || _cell.r < 0 || _cell.c >= cols || _cell.r >= rows || !cells) continue;
    const s = cells[_cell.c + _cell.r * cols];
    if (s && (s.c | 0) === _cell.c && (s.r | 0) === _cell.r) emShard[i] = s;
  }
  const b = model.bounds;
  const reach = model.bounds.zMax / Math.tan(Math.max(5, BRIDGE3D_TUNE.shadowElevDeg) * DEG);
  return {
    kind, host, st, bridge, bridgeIndex, def,
    hullKey: st.hullKey || null,
    map, hexR: R,
    srcW: grid.srcWidth, srcH: grid.srcHeight,
    c0: block.c0, r0: block.r0, blockW: block.w, blockH: block.h, cellCount: n,
    rowCount: Math.ceil(n / DAMAGE_W),
    cellShard, existed, nb,
    alive: new Uint8Array(n),
    aliveWas: Uint8Array.from(existed),
    cutAt: new Float32Array(n).fill(-1),
    row,
    rowTime: 0,
    anyDead: 0,
    moved: 0,
    lastShardsRef: null,
    lastActive: -1,
    lastRefresh: -Infinity,
    moveSearchFrame: -1e9,
    emShard, emPngX, emPngY,
    emWas: new Uint8Array(E.count).fill(1),
    emDelayOwn: new Float32Array(E.count),
    emDelayCmd: new Float32Array(E.count),
    emDelayPower: new Float32Array(E.count),
    emOwnVent: null,
    emCmdVent: null,
    emPowerReady: false,
    winColor: [1, 1, 1],
    powerLostAt: -1,
    // Promień (siatka) obejmujący model i jego cień — do kadrowania.
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

/**
 * Odświeża stan komórek rekordu i zapisuje wiersz tekstury obrażeń (RGBA8):
 *   R — 0: martwa / brak heksa; 64..255: żywa, HP 0..1,
 *   G — żar heksa (shardHeatNow) w chwili zapisu,
 *   B — maska martwych sąsiadów (6 bitów, kierunki HEX_NEIGHBOR_AXIAL),
 *   A — żar świeżego cięcia (sąsiad zginął) w chwili zapisu.
 * Zanik żaru od chwili zapisu liczy shader (vB3State.y). Zwraca true, gdy
 * bajty wiersza się zmieniły. `data` — cały bufor tekstury (szer. DAMAGE_W).
 */
export function refreshBridgeRecordDamage(rec, grid, data, heatNow, rowStride = DAMAGE_W) {
  const n = rec.cellCount;
  const alive = rec.alive;
  const shards = grid.shards;
  let anyDead = 0;
  let moved = 0;
  for (let k = 0; k < n; k++) {
    const s = rec.cellShard[k];
    let a = 0;
    if (s && s.active === true && s.isDebris !== true && s.hp > 0) {
      if (shards[s.__meshIndex] === s) a = 1;
      else if (rec.existed[k]) moved++;
    }
    alive[k] = a;
    if (!a && rec.existed[k]) anyDead = 1;
  }
  // Świeże cięcia: żywa komórka, której sąsiad zginął od ostatniego zapisu.
  const nb = rec.nb;
  for (let k = 0; k < n; k++) {
    if (!rec.aliveWas[k] || alive[k] || !rec.existed[k]) continue;
    for (let d = 0; d < 6; d++) {
      const m = nb[k * 6 + d];
      if (m >= 0 && alive[m]) rec.cutAt[m] = heatNow;
    }
  }
  const decay = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
  const base = rec.row * rowStride * 4;
  let changed = false;
  for (let k = 0; k < n; k++) {
    const o = base + k * 4;
    let R = 0; let G = 0; let B = 0; let A = 0;
    if (alive[k]) {
      const s = rec.cellShard[k];
      const hpFrac = s.maxHp > 0 ? Math.max(0, Math.min(1, s.hp / s.maxHp)) : 1;
      R = 64 + Math.round(hpFrac * 191);
      const heat = shardHeatNow(s, heatNow);
      G = heat > 0 ? Math.min(255, Math.round(heat * 255)) : 0;
      for (let d = 0; d < 6; d++) {
        const m = nb[k * 6 + d];
        if (m >= 0 && rec.existed[m] && !alive[m]) B |= (1 << d);
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
  rec.moved = moved;
  rec.rowTime = heatNow;
  return changed;
}

/**
 * Jasność emitera (0..1) w danej chwili — oś czasu jak szczeliny okien
 * w bridgeFx3D.js: rozbłysk i nierówne miganie po utracie dowodzenia, fala
 * gaśnięcia od wyrwy, mostek zapasowy gaśnie osobno, gdy padł wcześniej;
 * wrak (utrata zasilania bez utraty dowodzenia) gaśnie tak samo od środka
 * strefy. Przed tym: spokojne światło, uszkodzony heks mruga.
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
  const attr = new THREE.InstancedBufferAttribute(array, itemSize);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute(name, attr);
  return attr;
}

// Zakres uploadu bez alokacji: addUpdateRange tworzy obiekt {start, count}
// przy każdym wywołaniu — trzymamy jeden na atrybut (three czyści listę po
// wysłaniu, obiekt zostaje nasz).
function commitAttr(attr, count) {
  if (count <= 0) return;
  const ranges = attr.updateRanges;
  if (Array.isArray(ranges)) {
    const r = attr.__b3Range || (attr.__b3Range = { start: 0, count: 0 });
    r.start = 0;
    r.count = count * attr.itemSize;
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

const _o = { x: 0, y: 0 };
const _px = { x: 0, y: 0 };
const _py = { x: 0, y: 0 };
const _basis = { ax: 0, ay: 0, bx: 0, by: 0, sz: 1, ox: 0, oy: 0, wx: 0, wy: 0, sgx: 1, sgy: 1 };

/**
 * Baza instancji: przestrzeń modelu → scena (x, −y świata). Kolumny osi X/Y
 * modelu (ax, ay), (bx, by), skala wysokości sz, początek (ox, oy) — z tej
 * samej transformacji co okna i wyrzut (bridgeGridToWorld: poza gracza,
 * pivot wraku, obrót sprite'a). wx/wy — środek strefy w świecie gry.
 */
export function bridgeInstanceBasis(map, host, pose, out = {}) {
  bridgeGridToWorld(host, map.zgx, map.zgy, _o, pose);
  bridgeGridToWorld(host, map.zgx + 1, map.zgy, _px, pose);
  bridgeGridToWorld(host, map.zgx, map.zgy + 1, _py, pose);
  const gxX = _px.x - _o.x; const gxY = _px.y - _o.y;
  const gyX = _py.x - _o.x; const gyY = _py.y - _o.y;
  out.sgx = Math.hypot(gxX, gxY);
  out.sgy = Math.hypot(gyX, gyY);
  out.ax = gxX * map.m00 + gyX * map.m10;
  out.ay = -(gxY * map.m00 + gyY * map.m10);
  out.bx = gxX * map.m01 + gyX * map.m11;
  out.by = -(gxY * map.m01 + gyY * map.m11);
  out.sz = Math.sqrt(out.sgx * out.sgy);
  out.wx = _o.x;
  out.wy = _o.y;
  out.ox = _o.x;
  out.oy = -_o.y;
  return out;
}
const _camR = new THREE.Vector3();
const _camU = new THREE.Vector3();
const _camP = new THREE.Vector3();

export const Bridge3D = {
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
      return { name, index: spec.index, model, emit: packEmitters(model), style: KIND_STYLE[name] || KIND_STYLE.bellator, count: 0, capacity: spec.capacity, detail: spec.detail };
    });
    this.heightTex = buildHeightAtlas(this.kinds);

    // Tekstura obrażeń: rekord dostaje ceil(komórki / DAMAGE_W) kolejnych wierszy.
    const data = new Uint8Array(DAMAGE_W * DAMAGE_ROWS * 4);
    const dtex = new THREE.DataTexture(data, DAMAGE_W, DAMAGE_ROWS, THREE.RGBAFormat, THREE.UnsignedByteType);
    dtex.minFilter = THREE.NearestFilter;
    dtex.magFilter = THREE.NearestFilter;
    dtex.generateMipmaps = false;
    dtex.flipY = false;
    dtex.colorSpace = THREE.NoColorSpace;
    dtex.needsUpdate = true;
    const ranges = [];
    for (let i = 0; i < DAMAGE_ROWS * 2; i++) ranges.push({ start: 0, count: 0 });
    this.damage = { tex: dtex, data, rowUsed: new Uint8Array(DAMAGE_ROWS), rowsUsed: 0, ranges, used: 0 };
    // Pierwszy upload pełny, zanim pojawią się zakresy wierszy.
    try { Core3D.renderer?.initTexture?.(dtex); Core3D.renderer?.initTexture?.(this.heightTex); } catch { /* bez renderera (testy) */ }

    const U = {
      uB3Damage: { value: dtex },
      uB3Height: { value: this.heightTex },
      uB3HmBounds: { value: this.kinds.map((k) => k.hmBounds) },
      uB3HmRegion: { value: this.kinds.map((k) => k.hmRegion) },
      uB3HmTop: { value: this.kinds.map((k) => k.model.bounds.zMax) },
      uB3Detail: { value: this.kinds.map((k) => k.detail) },
      uB3Shadow: { value: new THREE.Vector4() },
      uB3Ao: { value: new THREE.Vector4() },
      uB3Sun: { value: new THREE.Vector2() },
      uB3Light: { value: new THREE.Vector3() },
      uB3Wound: { value: new THREE.Vector4() },
      // Maska widoczności słońca — wspólne obiekty z Core3D (sunShadowMask.js).
      ...sunShadowUniforms
    };
    this.uniforms = U;
    this._syncUniforms();

    // Model: InstancedMesh na rodzaj.
    for (const K of this.kinds) {
      const m = K.model;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
      geo.setAttribute('aMat', new THREE.BufferAttribute(m.mat, 1));
      geo.setAttribute('aModule', new THREE.BufferAttribute(m.module, 1));
      geo.setIndex(new THREE.BufferAttribute(m.index, 1));
      K.attrs = {
        gridA: makeInstanceAttr(geo, 'aB3GridA', 4, K.capacity),
        gridB: makeInstanceAttr(geo, 'aB3GridB', 4, K.capacity),
        dmg: makeInstanceAttr(geo, 'aB3Dmg', 4, K.capacity),
        state: makeInstanceAttr(geo, 'aB3State', 4, K.capacity),
        mask: makeInstanceAttr(geo, 'aB3Mask', 2, K.capacity),
        hull: makeInstanceAttr(geo, 'aB3Hull', 4, K.capacity)
      };
      const style = K.style;
      const palette = style.palette.map((h) => new THREE.Vector3(...hexToLinear(h)));
      const spec = MAT_SPEC.map(([e, mul]) => new THREE.Vector2(e, mul * style.spec));
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...U,
          uB3Palette: { value: palette },
          uB3Spec: { value: spec },
          uB3Surface: { value: new THREE.Vector4(0, style.seams, style.grime, style.rivets) },
          uB3Interior: { value: new THREE.Vector3(...hexToLinear(style.interior)) },
          uB3Coat: { value: new THREE.Vector2(style.rust, style.sky) }
        },
        vertexShader: MODEL_VERT,
        fragmentShader: MODEL_FRAG,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        side: THREE.DoubleSide,
        forceSinglePass: true
      });
      const mesh = new THREE.InstancedMesh(geo, mat, K.capacity);
      mesh.name = `BRIDGE3D_${K.name}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = MODEL_RENDER_ORDER;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.visible = false;
      scene.add(mesh);
      K.geometry = geo;
      K.material = mat;
      K.mesh = mesh;
    }

    // Cień na kadłubie: prostokąty pod kadłubem, test głębi GREATER.
    {
      const geo = new THREE.PlaneGeometry(1, 1);
      const attrs = {
        gridA: makeInstanceAttr(geo, 'aB3GridA', 4, RECEIVER_CAPACITY),
        gridB: makeInstanceAttr(geo, 'aB3GridB', 4, RECEIVER_CAPACITY),
        dmg: makeInstanceAttr(geo, 'aB3Dmg', 4, RECEIVER_CAPACITY),
        state: makeInstanceAttr(geo, 'aB3State', 4, RECEIVER_CAPACITY)
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...U },
        vertexShader: RECEIVER_VERT,
        fragmentShader: RECEIVER_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        depthFunc: THREE.GreaterDepth,
        blending: THREE.NormalBlending
      });
      const mesh = new THREE.InstancedMesh(geo, mat, RECEIVER_CAPACITY);
      mesh.name = 'BRIDGE3D_SHADOW';
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = RECEIVER_RENDER_ORDER;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.visible = false;
      scene.add(mesh);
      this.receiver = { geometry: geo, material: mat, mesh, attrs, count: 0, capacity: RECEIVER_CAPACITY };
    }

    // Okna, lampy, listwy: warstwa FG, addytywnie.
    {
      const geo = new THREE.PlaneGeometry(1, 1);
      const attrs = {
        params: makeInstanceAttr(geo, 'aParams', 4, EMITTER_CAPACITY),
        color: makeInstanceAttr(geo, 'aColor', 3, EMITTER_CAPACITY),
        shape: makeInstanceAttr(geo, 'aShape', 1, EMITTER_CAPACITY)
      };
      const mat = new THREE.ShaderMaterial({
        uniforms: { uCore: { value: new THREE.Vector3() }, uHalo: { value: new THREE.Vector3() } },
        vertexShader: EMIT_VERT,
        fragmentShader: EMIT_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.FrontSide
      });
      const mesh = new THREE.InstancedMesh(geo, mat, EMITTER_CAPACITY);
      mesh.name = 'BRIDGE3D_WINDOWS';
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = EMITTER_RENDER_ORDER;
      mesh.layers.set(2);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.visible = false;
      scene.add(mesh);
      this.emitters = { geometry: geo, material: mat, mesh, attrs, count: 0, capacity: EMITTER_CAPACITY };
    }
    this._emitColors = Object.fromEntries(Object.entries(EMIT_COLOR_HEX).map(([k, v]) => [k, hexToLinear(v)]));
    this.ready = true;
    return true;
  },

  _syncUniforms() {
    const T = BRIDGE3D_TUNE;
    const U = this.uniforms;
    const elev = Math.max(5, Math.min(85, Number(T.shadowElevDeg) || 30));
    U.uB3Shadow.value.set(Math.tan(elev * DEG), Math.max(0, T.shadowStrength), Math.max(0.01, T.shadowSoft), Math.max(0, Math.min(1, T.selfShadowAmbient)));
    U.uB3Ao.value.set(Math.max(0.5, T.aoRadius), Math.max(0, Math.min(1, T.aoStrength)), 0, 0);
    U.uB3Light.value.set(T.ambient, T.diffuse, T.specular);
    const peak = Math.max(0, Number(DESTRUCTOR_CONFIG.heatGlowPeak) || 0);
    U.uB3Wound.value.set(Math.max(0.2, T.rimWidth), Math.max(0, Math.min(1, T.scorch)), Math.max(0, T.cutGlow), peak);
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

  // Upload wierszy rekordu: jeden zakres na wiersz (three wysyła zakres jako
  // prostokąt o wysokości 1 — nie może przechodzić przez koniec wiersza).
  _markRows(rec) {
    let left = rec.cellCount;
    for (let i = 0; i < rec.rowCount && left > 0; i++) {
      const n = Math.min(DAMAGE_W, left);
      this._markRow(rec.row + i, n);
      left -= n;
    }
  },

  _markRow(row, texels) {
    const d = this.damage;
    const tex = d.tex;
    if (d.used >= d.ranges.length) {
      // Za dużo zakresów przed uploadem — cała tekstura.
      tex.clearUpdateRanges();
      d.used = 0;
      tex.needsUpdate = true;
      this._fullUpload = true;
      return;
    }
    if (this._fullUpload) { tex.needsUpdate = true; return; }
    const r = d.ranges[d.used++];
    r.start = row * DAMAGE_W * 4;
    r.count = texels * 4;
    tex.updateRanges.push(r);
    tex.needsUpdate = true;
    this.stats.rowUploads++;
  },

  // Nowy stan mostków na encji (nowa siatka, edytor przestawił strefy).
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
      // Część mostka na innym gospodarzu (odłamek): te same komórki i heksy.
      const row = this._allocRows(source.rowCount);
      if (row < 0) return null;
      rec = { ...source };
      rec.host = host;
      rec.row = row;
      rec.alive = new Uint8Array(source.cellCount);
      rec.aliveWas = Uint8Array.from(source.existed);
      rec.cutAt = new Float32Array(source.cellCount).fill(-1);
      rec.emWas = new Uint8Array(source.kind.emit.count).fill(1);
      rec.emDelayPower = new Float32Array(source.kind.emit.count);
      rec.emPowerReady = false;
      rec.lastShardsRef = null;
      rec.lastActive = -1;
      rec.lastRefresh = -Infinity;
      rec.moveSearchFrame = ctx.frame;
      rec.powerLostAt = ctx.now;
      rec.orphanSince = -1;
      rec.dead = false;
    } else {
      rec = createBridgeRecordCore(host, st, bridgeIndex, K, -1);
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
    this._refresh(rec, host.hexGrid, ctx);
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
    rec.lastShardsRef = null;
    // aliveWas zostaje z ostatniego zapisu: świeży żar dostaną tylko cięcia
    // powstałe pod nieobecność, nie wszystkie stare wyrwy.
    if (host.hexGrid) this._refresh(rec, host.hexGrid, ctx);
    return true;
  },

  _refresh(rec, grid, ctx) {
    if (refreshBridgeRecordDamage(rec, grid, this.damage.data, ctx.heatNow)) this._markRows(rec);
    rec.lastShardsRef = grid.shards;
    rec.lastActive = grid.activeStructuralCount;
    rec.lastRefresh = ctx.heatNow;
  },

  // Czy gospodarz nadal ma któryś heks rekordu (żywy, w bieżącej siatce).
  _hostOwns(rec, host) {
    const grid = host?.hexGrid;
    if (!grid || host.dead) return false;
    const shards = grid.shards;
    for (let k = 0; k < rec.cellCount; k++) {
      const s = rec.cellShard[k];
      if (rec.existed[k] && shardPhysicallyAlive(s) && shards[s.__meshIndex] === s) return true;
    }
    return false;
  },

  _anyAlive(rec) {
    for (let k = 0; k < rec.cellCount; k++) if (rec.existed[k] && shardPhysicallyAlive(rec.cellShard[k])) return true;
    return false;
  },

  // Nowy gospodarz dla rekordu, którego heksy przeszły do innej encji.
  _findHost(rec, entities, except) {
    const n = rec.cellCount;
    for (let k = 0; k < n; k++) {
      const s = rec.cellShard[k];
      if (!rec.existed[k] || !shardPhysicallyAlive(s)) continue;
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e || e === except || e.dead || !e.hexGrid) continue;
        if (e.hexGrid.shards?.[s.__meshIndex] === s) return e;
      }
      return null; // pierwszy żywy heks wystarczy: szukamy jednego gospodarza
    }
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
    ctx.flashes = 0;
    ctx.heatDecay = Math.max(0, Number(DESTRUCTOR_CONFIG.heatDecay) || 0);
    if (ctx.free && Core3D.cameraPersp) {
      const e = Core3D.cameraPersp.matrixWorld.elements;
      _camR.set(e[0], e[1], e[2]).normalize();
      _camU.set(e[4], e[5], e[6]).normalize();
      // Wolna kamera: rozmiar na ekranie z odległości i pola widzenia, nie z zoomu.
      const gc = opts.camera && opts.camera.position ? opts.camera : null;
      const cp = gc ? gc.position : Core3D.cameraPersp.position;
      _camP.set(cp.x, cp.y, cp.z);
      const fov = Math.max(10, Math.min(120, Number(gc?.fov) || Core3D.cameraPersp.fov || 50));
      const vh = Number(Core3D.height) || (typeof window !== 'undefined' ? window.innerHeight : 900) || 900;
      ctx.pxAtUnit = (vh * 0.5) / Math.tan(fov * 0.5 * DEG);
    }

    // Słońce jak w hexShips3D (window.SUN); bez niego — z lewej od góry.
    const sun = typeof window !== 'undefined' ? window.SUN : null;
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
    if (dmg.tex.updateRanges.length === 0) { dmg.used = 0; this._fullUpload = false; }
    const kinds = this.kinds;
    for (let k = 0; k < kinds.length; k++) kinds[k].count = 0;
    this.receiver.count = 0;
    this.emitters.count = 0;

    let adoptLeft = Math.max(1, T.adoptPerFrame | 0);
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e || e.dead) continue;
      const st = e.bridgeState;
      if (st && st.grid === e.hexGrid && e.__bridge3DState !== st && adoptLeft > 0) { this._adopt(e, st, ctx); adoptLeft--; }
      else if (st && e.__bridge3DFull && st.model3D !== true && e.__bridge3DState === st) st.model3D = true;
      const list = e.__bridge3D;
      if (!list || !list.length) continue;
      const hidden = e.hideHexVisual === true;
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

    // Rekordy bez gospodarza w tej klatce: wrak przejął heksy (hulk →
    // finishBridgeKill), rozpad, albo mostek zniknął na dobre.
    for (let i = this.records.length - 1; i >= 0; i--) {
      const rec = this.records[i];
      if (!rec || rec.seenFrame === frame) continue;
      // Gospodarz żyje i ma heksy mostka, tylko nie ma go na tej liście (lot
      // nad Ring City rysuje sam statek gracza, NPC zdjęty z listy) — rekord
      // czeka; po ROW_RELEASE_SEC oddaje wiersz, po RECORD_TTL_SEC odchodzi.
      if (this._hostOwns(rec, rec.host)) {
        rec.orphanSince = -1;
        const away = ctx.heatNow - rec.lastSeenAt;
        if (away > RECORD_TTL_SEC) this._retire(rec);
        else if (away > ROW_RELEASE_SEC && rec.row >= 0) this._freeRows(rec);
        continue;
      }
      if (!this._anyAlive(rec)) { this._retire(rec); continue; }
      const next = this._findHost(rec, entities, rec.host);
      if (next) {
        if (this._hostHas(next, rec.st, rec.bridgeIndex)) { this._retire(rec); continue; }
        const hosted = rec.host?.__bridge3D;
        if (hosted) { const k = hosted.indexOf(rec); if (k >= 0) hosted.splice(k, 1); }
        rec.host = next;
        if (!next.__bridge3D) next.__bridge3D = [];
        next.__bridge3D.push(rec);
        if (!rec.st.commandLost && rec.powerLostAt < 0) rec.powerLostAt = ctx.now;
        rec.lastShardsRef = null;
        rec.seenFrame = frame;
        rec.orphanSince = -1;
        if (next.hideHexVisual !== true) this._frameRecord(rec, next, ctx);
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
      K.mesh.count = n;
      K.mesh.visible = n > 0;
      this.stats.instances[K.index] = n;
      if (!n) continue;
      draws++;
      commitAttr(K.mesh.instanceMatrix, n);
      commitAttr(K.attrs.gridA, n);
      commitAttr(K.attrs.gridB, n);
      commitAttr(K.attrs.dmg, n);
      commitAttr(K.attrs.state, n);
      commitAttr(K.attrs.mask, n);
      commitAttr(K.attrs.hull, n);
    }
    const Rv = this.receiver;
    Rv.mesh.count = Rv.count;
    Rv.mesh.visible = Rv.count > 0;
    if (Rv.count) {
      draws++;
      commitAttr(Rv.mesh.instanceMatrix, Rv.count);
      commitAttr(Rv.attrs.gridA, Rv.count);
      commitAttr(Rv.attrs.gridB, Rv.count);
      commitAttr(Rv.attrs.dmg, Rv.count);
      commitAttr(Rv.attrs.state, Rv.count);
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
    const grid = host.hexGrid;
    if (!grid || rec.row < 0) return;
    const T = BRIDGE3D_TUNE;
    const pose = ctx.poseOf ? ctx.poseOf(host) : null;
    const B = bridgeInstanceBasis(rec.map, host, pose, _basis);
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
    const fade = smooth01(T.minPx, T.fullPx, zonePx);

    // Obrażenia: zawsze, gdy w siatce zginął heks (wyrwy, rozpad), a okresowo
    // (HP, żar) tylko dla rysowanych — fazy rozłożone przy tworzeniu rekordu,
    // więc flota nie odświeża się w jednej klatce.
    const changed = grid.shards !== rec.lastShardsRef || grid.activeStructuralCount !== rec.lastActive;
    if (changed || (fade > 0.002 && ctx.heatNow - rec.lastRefresh > REFRESH_SEC)) {
      this._refresh(rec, grid, ctx);
      // Heksy mostka na innym gospodarzu (rozpad) — jego część modelu.
      if (rec.moved > 0 && ctx.frame - rec.moveSearchFrame > 20) {
        rec.moveSearchFrame = ctx.frame;
        const other = this._findMoved(rec, ctx.entities, host);
        if (other && !this._hostHas(other, rec.st, rec.bridgeIndex)) this._createRecord(other, rec.st, rec.bridgeIndex, rec.kind, ctx, rec);
      }
    }
    if (fade <= 0.002) return;
    const lod = zonePx < T.lodPx ? 1 : 0;

    const ax = B.ax; const ay = B.ay; const bx = B.bx; const by = B.by;
    const sz = B.sz; const ox = B.ox; const oy = B.oy;
    // Instancja względem początku przy kamerze (_setOrigin).
    const rx = ox - ctx.orgX; const ry = oy - ctx.orgY;
    const heatMul = Math.exp(-Math.max(0, ctx.heatNow - rec.rowTime) * ctx.heatDecay);
    const K = rec.kind;

    if (T.drawModel && K.count < K.capacity) {
      const n = K.count++;
      writeInstance(K.mesh.instanceMatrix.array, n, ax, ay, bx, by, sz, rx, ry);
      writeInstanceData(K.attrs, n, rec, fade, heatMul);
      const mk = K.attrs.mask.array;
      mk[n * 2] = rec.maskLo;
      mk[n * 2 + 1] = rec.maskHi;
      const hl = K.attrs.hull.array;
      hl[n * 4] = hullLightAt(rec, host, pose, ctx);
      hl[n * 4 + 1] = lod; hl[n * 4 + 2] = 0; hl[n * 4 + 3] = 0;
    }
    const Rv = this.receiver;
    if (T.receiver && !lod && Rv.count < Rv.capacity) {
      const n = Rv.count++;
      writeInstance(Rv.mesh.instanceMatrix.array, n, ax, ay, bx, by, sz, rx, ry);
      writeInstanceData(Rv.attrs, n, rec, fade, heatMul);
    }

    // Emitery: okna (gasną z heksem pod sobą i wg osi czasu), lampy, listwy.
    const winFade = smooth01(T.winMinPx, T.winFullPx, 2.0 * sgx * zoomAt) * fade;
    this._emit(rec, host, grid, ctx, winFade, ax, ay, bx, by, sz, ox, oy);
  },

  _findMoved(rec, entities, host) {
    const grid = host.hexGrid;
    for (let k = 0; k < rec.cellCount; k++) {
      const s = rec.cellShard[k];
      if (!rec.existed[k] || !shardPhysicallyAlive(s) || grid.shards[s.__meshIndex] === s) continue;
      for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (!e || e === host || e.dead || !e.hexGrid) continue;
        if (e.hexGrid.shards?.[s.__meshIndex] === s) return e;
      }
    }
    return null;
  },

  _emit(rec, host, grid, ctx, winFade, ax, ay, bx, by, sz, ox, oy) {
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
    for (let i = 0; i < E.count; i++) {
      const s = rec.emShard[i];
      if (!shardAliveIn(grid, s)) {
        // Pomieszczenie wybite: krótki błysk w chwili śmierci heksa pod oknem.
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
      const hpFrac = s.maxHp > 0 ? s.hp / s.maxHp : 1;
      let I = bridgeEmitterLight(rec, i, ctx.now, hpFrac) * winFade;
      if (I <= 0.003) continue;
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
      for (const K of this.kinds) { K.mesh.count = 0; K.mesh.visible = false; }
      if (this.receiver) { this.receiver.mesh.count = 0; this.receiver.mesh.visible = false; }
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
      K.material?.dispose?.();
    }
    this.kinds = [];
    for (const part of [this.receiver, this.emitters]) {
      if (!part) continue;
      if (scene && part.mesh) scene.remove(part.mesh);
      part.geometry?.dispose?.();
      part.material?.dispose?.();
    }
    this.receiver = null;
    this.emitters = null;
    this.damage?.tex?.dispose?.();
    this.heightTex?.dispose?.();
    this.damage = null;
    this.heightTex = null;
    this.uniforms = null;
    this.scene = null;
    this.ready = false;
  }
};

function writeInstance(M, n, ax, ay, bx, by, sz, ox, oy) {
  const o = n * 16;
  M[o] = ax; M[o + 1] = ay; M[o + 2] = 0; M[o + 3] = 0;
  M[o + 4] = bx; M[o + 5] = by; M[o + 6] = 0; M[o + 7] = 0;
  M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = sz; M[o + 11] = 0;
  M[o + 12] = ox; M[o + 13] = oy; M[o + 14] = MODEL_LIFT; M[o + 15] = 1;
}

function writeInstanceData(attrs, n, rec, fade, heatMul) {
  const m = rec.map;
  const A = attrs.gridA.array;
  A[n * 4] = m.zgx; A[n * 4 + 1] = m.zgy; A[n * 4 + 2] = m.m00; A[n * 4 + 3] = m.m01;
  const B = attrs.gridB.array;
  B[n * 4] = m.m10; B[n * 4 + 1] = m.m11; B[n * 4 + 2] = rec.c0; B[n * 4 + 3] = rec.r0;
  const D = attrs.dmg.array;
  D[n * 4] = rec.row; D[n * 4 + 1] = rec.blockW; D[n * 4 + 2] = rec.blockH; D[n * 4 + 3] = rec.anyDead;
  const S = attrs.state.array;
  S[n * 4] = fade; S[n * 4 + 1] = heatMul; S[n * 4 + 2] = rec.kind.index; S[n * 4 + 3] = rec.hexR;
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
