// Efekty rdzenia (reaktora) w scenie Core3D — bez własnego renderera.
// Stan i geometrię komory daje src/game/shipCore.js; tu jest tylko wygląd:
//
//   * ŻAR REAKTORA: kwad pod płaszczyzną kadłuba (z = -3). Kadłub heksowy
//     pisze głębię (hexShips3D: depthWrite, z = 0), więc żar przechodzi test
//     głębi TYLKO tam, gdzie heksu nie ma — prześwieca dokładnie przez dziurę,
//     bez żadnej maski z CPU. Dopóki komora jest cała (NOMINALNY), instancji
//     nie ma wcale.
//   * WARSTWA 7 (pass tarcz Core3D): ortho, bez maski cieni i bez
//     czyszczenia głębi. Na warstwie 0 (pass ortho) cień własnego kadłuba
//     mnożył żar w wyrwie o ~0,5 — emisja nie może dostać cienia, z tego
//     samego powodu tarcze mają ten pass. Głębia kadłuba z passa ortho zostaje
//     (shafts to quad bez testu i zapisu głębi), więc maskowanie działa dalej.
//     Kontrakt AGENTS.md: pass jest pomijany, gdy nikt nie zgłosi zawartości —
//     sync() woła options.markLayerActive(), gdy coś widać (patrz PORT).
//   * WYRZUTY PLAZMY: pula cząstek nad kadłubem (z = +3) z pozycji martwych
//     heksów komory — od KRYTYCZNEGO rzadko, w STOPIENIU coraz gęściej.
//   * BRZEG RANY: żar heksów przy martwych heksach komory idzie tym samym
//     kanałem co _heatWoundRim w destruktorze (shard.heat + heatStamp,
//     rampa w HEX_FRAGMENT_SHADER), więc współgra z nim zamiast go zagłuszać.
//
// Pasma HDR (przed ACES; próg bloomu gry 0,9 — bloomConfig.js): ciało żaru
// i dymy plazmy w paśmie barwy L 0,45–0,85 (bez bloomu), jedynym źródłem
// bloomu jest biały rdzeń L 8–12 (mały, rośnie w stopieniu). Zakaz poświaty
// wzdłuż sylwetki (memory hull-lacquer) spełniony z definicji: nic nie świeci
// poza komorą i jej wyrwami.
//
// Konwencja gry: świat (x, y) → scena (x, -y), kamera ortho z góry (+Z).
//
// AGENT: precyzja float32 przed integracją do gry (2026-09-25, sesja poprawek
// drżenia; kodu tu nie ruszałem). Sześć shaderów (żar, wyrzuty, strumienie,
// kule, pierścienie, błyski) liczy `projectionMatrix * viewMatrix * vec4(świat)`
// — przy 5–10 mln j. obraz drga ~1 px × zoom względem kadłuba (AGENTS.md,
// docs/PORT-mostki.md §8.12). Przepis: początek przy kamerze w mesh.position
// (src/3d/sceneOrigin.js → sceneOriginNearCamera), dane instancji względem
// niego (CPU w double), shader `projectionMatrix * modelViewMatrix * …`.
// Wyrzuty siedzą w buforze pierścieniowym (zapis przy emisji), więc początek
// „lepki” jak w sparkSystem3D.js / slugTrail3D.js: pusty bufor bierze kamerę,
// żywy przesuwa dane dopiero po odjeździe kamery. ventMesh ma
// matrixAutoUpdate = false — po zmianie position trzeba updateMatrix().
// Pomiar przed/po: dema/precyzja-drzenie.js (dopisać moduł jak `fx`).
import * as THREE from 'three';
import {
  getCoreWorld, getEntityHexAngle, CORE_STATE, coreStateRank,
  gridToLocal, localToWorld, isShardOnEntity, coreJetEnvelope, gridDirToWorld
} from '../game/shipCore.js';
import { Fx3D, FX_PLANE_Z, sp as fxParams, coneDir, makeBasis } from './fxParticles3D.js';
import { RailgunFX3D } from './railgunFx3D.js';
import { MuzzleFX3D } from './muzzleFx3D.js';
import { shardHeatNow, isHexShips3DActive } from '../game/destructor.js';
import { CORE_FX_BANDS, CORE_FX_LAYER, coreStateBand } from './coreBands.js';

// Pasma HDR (CORE_FX_BANDS), warstwa (CORE_FX_LAYER) i puls stanu żyją
// w coreBands.js — te same liczby bierze plazma modelu reaktora (reactor3D).
export { CORE_FX_BANDS, CORE_FX_LAYER };
const GLOW_Z = -3;
const VENT_Z = 3;
const GLOW_RENDER_ORDER = 11;   // kadłuby heksowe: 10, pancerz LOD: 9
const VENT_RENDER_ORDER = 12;
const RING_Z = 2;
const JET_Z = 4;
const ORB_Z = 5;
const RING_RENDER_ORDER = 13;
const JET_RENDER_ORDER = 14;
const ORB_RENDER_ORDER = 15;
const FLASH_Z = 6;
const FLASH_RENDER_ORDER = 16;

// Światło addytywne jak blend bloomu w three: kolor i alfa ONE/ONE
// (AdditiveBlending + premultipliedAlpha), alfa z shadera = max(rgb) liniowo.
// Alfa 1,0 na całym quadzie dawała na kanwie premultiplied twarde koło i
// prostokąt w poświacie bloomu: pod quadem poświata szła inną drogą niż obok.
const FX_BLEND = { blending: THREE.AdditiveBlending, premultipliedAlpha: true };
// Brzeg pęknięcia: heksy edgeShards do ~2,5 heksa od linii szczeliny (siatka
// 5 px: odstęp kolumn 7,5).
const CRACK_EDGE_GRID = 19;

const NOISE_GLSL = `
float cfxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cfxNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cfxHash(i);
  float b = cfxHash(i + vec2(1.0, 0.0));
  float c = cfxHash(i + vec2(0.0, 1.0));
  float d = cfxHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cfxFbm(vec2 p) {
  float v = 0.0;
  v += 0.55 * cfxNoise(p); p *= 2.03;
  v += 0.28 * cfxNoise(p); p *= 2.01;
  v += 0.17 * cfxNoise(p);
  return v;
}
`;

const GLOW_VERTEX = `
attribute vec4 aCore;    // x, y (scena), promień (świat), obrót
attribute vec4 aColor;   // barwa ciała (znormalizowana do pasma), ziarno
attribute vec4 aState;   // jasność ciała L, jasność rdzenia L, promień rdzenia (0-1), puls 0-1
uniform float uZ;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vState;
void main() {
  vUv = position.xy;
  vColor = aColor;
  vState = aState;
  float c = cos(aCore.w);
  float s = sin(aCore.w);
  vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * aCore.z;
  gl_Position = projectionMatrix * viewMatrix * vec4(aCore.x + p.x, aCore.y + p.y, uZ, 1.0);
}
`;

const GLOW_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vState;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float seed = vColor.w;
  float pulse = vState.w;
  // Wir plazmy we współrzędnych biegunowych: kąt obraca się, promień płynie do środka.
  float ang = atan(vUv.y, vUv.x);
  vec2 q = vec2(ang * 1.2 + uTime * 0.35 + seed * 13.0, r * 3.2 - uTime * (0.7 + pulse * 1.6));
  float n = cfxFbm(q * 1.7 + seed * 7.0);
  float bodyProfile = smoothstep(1.0, 0.1, r);
  float body = bodyProfile * (0.35 + 0.65 * n) * (0.86 + 0.14 * pulse);
  float coreR = max(0.02, vState.z) * (1.0 + 0.18 * pulse);
  // Ostra krawędź: mało pikseli w paśmie 0,9–8, które bloom brałby w całości.
  float core = smoothstep(coreR, coreR * CORE_EDGE, r);
  // Ciało pod progiem bloomu także przy rdzeniu (bez sumy ciało + rdzeń > 0,9 wokół).
  body *= smoothstep(coreR * 0.6, coreR * 1.6, r) * 0.35 + 0.65;
  vec3 col = vColor.rgb * (vState.x * body) + vec3(1.0, 0.97, 0.92) * (vState.y * core);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

const VENT_VERTEX = `
attribute vec4 aStart;   // x, y (scena), vx, vy
attribute vec4 aLife;    // t0, życie, rozmiar startowy, rozmiar końcowy
attribute vec4 aColor;   // barwa ciała (pasmo), jasność białego rdzenia
uniform float uTime;
uniform float uZ;
varying vec2 vUv;
varying vec4 vColor;
varying float vAge;
void main() {
  float age = uTime - aLife.x;
  if (age < 0.0 || age > aLife.y) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float t = age / aLife.y;
  float drag = 2.4;
  vec2 pos = aStart.xy + aStart.zw * ((1.0 - exp(-drag * age)) / drag);
  float size = mix(aLife.z, aLife.w, sqrt(t));
  vUv = position.xy;
  vColor = aColor;
  vAge = t;
  gl_Position = projectionMatrix * viewMatrix * vec4(pos + position.xy * size, uZ, 1.0);
}
`;

const VENT_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
#define VENT_HOT_LIFE ${CORE_FX_BANDS.ventHotLife.toFixed(3)}
#define VENT_HOT_R ${CORE_FX_BANDS.ventHotRadius.toFixed(3)}
varying vec2 vUv;
varying vec4 vColor;
varying float vAge;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float soft = pow(1.0 - r, 1.7);
  float fade = (1.0 - vAge) * (1.0 - vAge);
  // Głowica: ostra w przestrzeni i w czasie — piksele w paśmie 8–12 albo 0.
  float hot = step(vAge, VENT_HOT_LIFE) * (1.0 - smoothstep(VENT_HOT_R * CORE_EDGE, VENT_HOT_R, r));
  vec3 col = vColor.rgb * (soft * fade) + vec3(1.0, 0.96, 0.9) * (vColor.a * hot);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

// --- Efekty po detonacji: strumień plazmy, kula plazmy, pierścień plazmy ---
// Pasma jak żar: ciało w paśmie barwy (≤ ~1), biel 8–12 wyłącznie ostrymi
// krawędziami i tylko przy pełnej mocy (step), żeby nie przechodzić przez 2–8.

const JET_VERTEX = `
attribute vec4 aSeg;    // początek x, y; koniec x, y (scena)
attribute vec4 aJet;    // półszerokość (świat), obwiednia 0–1, ziarno, długość (świat)
attribute vec4 aColor;  // barwa ciała (pasmo), jasność białej żyły
uniform float uZ;
varying vec2 vUv;
varying vec4 vJet;
varying vec4 vColor;
void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 d = b - a;
  float len = max(1.0, length(d));
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  float u = position.x + 0.5;
  // w wyrwie zwężony, na celu rozlany (rozprysk na pancerzu)
  float w = aJet.x * (0.55 + 0.45 * smoothstep(0.0, 0.2, u)) * (1.0 + 0.7 * smoothstep(0.86, 1.0, u));
  vec2 p = a + dir * (u * len) + nrm * (position.y * 2.0 * w);
  vUv = vec2(u, position.y * 2.0);
  vJet = aJet;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, uZ, 1.0);
}
`;

const JET_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
uniform float uTime;
varying vec2 vUv;
varying vec4 vJet;
varying vec4 vColor;
${NOISE_GLSL}
void main() {
  float u = vUv.x;
  float across = abs(vUv.y);
  float flow = cfxFbm(vec2(u * vJet.w / 70.0 - uTime * 9.0 + vJet.z * 17.0, vUv.y * 2.2));
  float w = 0.6 + 0.4 * flow;
  float body = smoothstep(w, w * 0.2, across);
  // biała żyła tylko przy wylocie z wyrwy (pierwsze 30% długości): na całej
  // długości bloom z linii 8+ zjadał barwę frakcji i strumień robił się biały
  float vein = (1.0 - smoothstep(0.09 * CORE_EDGE, 0.09, across / max(0.4, w))) * (1.0 - smoothstep(0.26, 0.3, u));
  float tail = smoothstep(1.0, 0.9, u);
  float env = vJet.y;
  float on = step(0.4, env);
  vec3 col = vColor.rgb * (body * env * tail) + vec3(1.0, 0.97, 0.92) * (vein * vColor.a * on * tail);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

const ORB_VERTEX = `
attribute vec4 aOrb;    // x, y (scena), promień obrazu (świat), faza wirowania
attribute vec4 aOrbS;   // postęp zapalnika 0–1, ziarno, jasność ciała, jasność rdzenia
attribute vec4 aColor;  // barwa (pasmo)
uniform float uZ;
varying vec2 vUv;
varying vec4 vS;
varying vec4 vColor;
varying float vPhase;
void main() {
  vUv = position.xy;
  vS = aOrbS;
  vColor = aColor;
  vPhase = aOrb.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(aOrb.xy + position.xy * aOrb.z, uZ, 1.0);
}
`;

const ORB_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
uniform float uTime;
varying vec2 vUv;
varying vec4 vS;
varying vec4 vColor;
varying float vPhase;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float fuse = vS.x;
  // torus plazmy, który wypadł z komory: jasny pierścień wiruje, mgiełka wokół
  float ang = atan(vUv.y, vUv.x) + vPhase;
  vec2 q = vec2(ang * 1.6, r * 4.5 - uTime * 1.6 + vS.y * 9.0);
  float n = cfxFbm(q * 1.4 + vS.y * 5.0);
  float ring = exp(-pow((r - 0.5) / 0.19, 2.0));
  float haze = smoothstep(1.0, 0.0, r) * 0.28;
  float body = (ring * (0.55 + 0.45 * n) + haze) * vS.z;
  // serce pulsuje coraz szybciej, im bliżej zapalnika
  float pulse = 0.5 + 0.5 * sin(uTime * mix(6.0, 30.0, fuse * fuse) + vS.y * 6.0);
  float coreR = 0.08 + 0.05 * pulse * (0.4 + 0.6 * fuse);
  float core = 1.0 - smoothstep(coreR * CORE_EDGE, coreR, r);
  vec3 col = vColor.rgb * body + vec3(1.0, 0.97, 0.92) * (core * vS.w);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

const RING_VERTEX = `
attribute vec4 aRing;   // x, y (scena), promień frontu (świat), grubość względna
attribute vec4 aRingS;  // wiek 0–1, jasność ciała, jasność białej krawędzi, ziarno
attribute vec4 aColor;  // barwa (pasmo)
uniform float uZ;
varying vec2 vUv;
varying vec4 vS;
varying vec4 vColor;
varying float vTh;
void main() {
  vUv = position.xy * 1.25;
  vS = aRingS;
  vColor = aColor;
  vTh = aRing.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(aRing.xy + position.xy * aRing.z * 1.25, uZ, 1.0);
}
`;

const RING_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
varying vec2 vUv;
varying vec4 vS;
varying vec4 vColor;
varying float vTh;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.25) discard;
  float th = max(0.01, vTh);
  float age = vS.x;
  float ang = atan(vUv.y, vUv.x);
  float n = cfxNoise(vec2(ang * 5.0 + vS.w * 13.0, age * 3.0));
  float d = (r - 1.0) / th;
  // za frontem plazma ciągnie się dłużej niż przed nim
  float prof = d < 0.0 ? exp(-d * d * 0.6) : exp(-d * d * 4.0);
  float fade = pow(1.0 - age, 1.6);
  float body = prof * (0.65 + 0.35 * n) * fade * vS.y;
  float e = th * 0.22;
  float edge = step(age, 0.18) * (1.0 - smoothstep(e * CORE_EDGE, e, abs(r - 1.0)));
  vec3 col = vColor.rgb * body + vec3(1.0, 0.97, 0.92) * (edge * vS.z);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

const FLASH_VERTEX = `
attribute vec4 aFlash;   // x, y (scena), promień (świat), wiek 0–1
attribute vec4 aFlashS;  // jasność bieli, jasność ciała, ziarno, —
attribute vec4 aColor;   // barwa (pasmo)
uniform float uZ;
varying vec2 vUv;
varying vec4 vF;
varying vec4 vS;
varying vec4 vColor;
void main() {
  vUv = position.xy;
  vF = aFlash;
  vS = aFlashS;
  vColor = aColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(aFlash.xy + position.xy * aFlash.z, uZ, 1.0);
}
`;

// Rozbłysk plazmy: mała biała kula (ostra, 8–12, gaśnie po 30% życia) i barwny
// rozbłysk pod progiem pasma barwy — własny wybuch wariantów, które nie biorą
// pełnego reactorblow (przełamanie, rozerwanie, wyrzut, kula).
const FLASH_FRAGMENT = `
#define CORE_EDGE ${CORE_FX_BANDS.coreEdge.toFixed(3)}
varying vec2 vUv;
varying vec4 vF;
varying vec4 vS;
varying vec4 vColor;
${NOISE_GLSL}
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float age = vF.w;
  float coreR = mix(0.3, 0.07, clamp(age / 0.3, 0.0, 1.0));
  float white = step(age, 0.3) * (1.0 - smoothstep(coreR * CORE_EDGE, coreR, r));
  float ang = atan(vUv.y, vUv.x);
  float n = cfxNoise(vec2(ang * 4.0 + vS.z * 11.0, r * 3.0 + age * 2.0));
  float halo = pow(max(0.0, 1.0 - r), 1.6) * (0.75 + 0.25 * n);
  float body = halo * pow(1.0 - age, 1.8) * vS.y;
  vec3 col = vColor.rgb * body + vec3(1.0, 0.97, 0.92) * (white * vS.x);
  gl_FragColor = vec4(col, min(1.0, max(col.r, max(col.g, col.b))));
}
`;

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// ---------------------------------------------------------------------------
// Iskry z puli gry. Wspólny bank Fx3D (fxParticles3D.js) — ten sam, z którego
// sypią błyski wylotowe dział (muzzleFx3D) i Hexlance (railgunFx3D, klawisz 4);
// jedno wywołanie na system, bez własnych pul. Do tego iskry trafień i tarcia
// SparkSystem3D (overlay, 20 000 slotów), jeśli ktoś go zainicjował. Recepty
// rdzenia tylko rozsypują to samo tworzywo inaczej; palety wprost z tamtych
// recept: metal stygnie do czerwieni, plazma zostaje swoją barwą.
// ---------------------------------------------------------------------------
const SPARK_METAL = [2.9, 2.2, 1.4];   // odpryski przebicia (RailgunFX.impact)
const SPARK_KERF = [2.9, 2.1, 1.2];    // wiór rzazu (RailgunFX.kerf)
const SPARK_CHUNK = [3.0, 1.7, 0.7];   // rozżarzone odpryski poszycia (stygną do 0,4 / 0,1)
// Skala recept (S jak w muzzleFx3D; Hexlance na Atlasie ma 3) i moc wystrzału
// RailgunFX3D (jego skala jest wmurowana) na klasę rdzenia.
const FX_CLASS_SCALE = Object.freeze({ escort: 1.2, cruiser: 1.9, capital: 2.7 });
const FX_CLASS_POWER = Object.freeze({ escort: 0.45, cruiser: 0.7, capital: 1.0 });
// Spłaszczenie rozrzutu w Z jak w receptach broni: w widoku ortho z góry ruch
// w Z jest niewidoczny, rozrzut ma iść po płaszczyźnie gry.
const FX_FLAT = 0.18;

const _fp = new THREE.Vector3();
const _fd = new THREE.Vector3();
const _fv = new THREE.Vector3();
const _fq = new THREE.Vector3();
const _fb = new THREE.Vector3();
const _fw = { x: 0, y: 0 };
const _fl = { x: 0, y: 0 };

const frand = (a, b) => a + Math.random() * (b - a);
function fxScale(classId) { return FX_CLASS_SCALE[classId] || FX_CLASS_SCALE.capital; }
function fxPower(classId) { return FX_CLASS_POWER[classId] || FX_CLASS_POWER.capital; }

// Barwa plazmy rdzenia w paśmie strug jonów Hexlance'a: L ≈ 2,6, kanał ≤ 4,5
// (czerwień piratów nie może wyjść na 7 w jednym kanale).
function plasmaSparkColor(col, out = [0, 0, 0]) {
  const L = Math.max(1e-3, luminance(col));
  const mx = Math.max(col[0], col[1], col[2], 1e-3);
  const k = Math.min(2.6 / L, 4.5 / mx);
  out[0] = col[0] * k;
  out[1] = col[1] * k;
  out[2] = col[2] * k;
  return out;
}

// Kierunek z płaszczyzny gry do sceny (y odwrócone) + baza dla coneDir.
function sceneDir(out, dx, dy) {
  out.set(dx, -dy, 0);
  const l = out.length();
  if (l > 1e-6) out.divideScalar(l); else out.set(1, 0, 0);
  makeBasis(out);
  return out;
}

function luminance(c) {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function parseColor(value, fallback) {
  if (Array.isArray(value) && value.length >= 3) return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  if (typeof value === 'string' && /^#?[0-9a-f]{6}$/i.test(value)) {
    const v = value.replace('#', '');
    // sRGB → liniowe (barwy z edytora są w hex sRGB)
    const lin = (x) => { const c = parseInt(x, 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return [lin(v.slice(0, 2)), lin(v.slice(2, 4)), lin(v.slice(4, 6))];
  }
  return fallback;
}

function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 0x2545f491;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// Kopia markGridHeatDirtyRange z destructor.js (nieeksportowana): żar to tylko
// atrybut renderu — rozszerzamy zakres uploadu instancji, bez rewizji siatki.
function markHeatDirty(grid, index) {
  if (!grid || !isHexShips3DActive()) return;
  const count = Array.isArray(grid.shards) ? grid.shards.length : 0;
  if (count <= 0 || index < 0 || index >= count) return;
  grid.meshDirty = true;
  if (grid.meshDirtyAll) return;
  const s = Number(grid.meshDirtyStart);
  const e = Number(grid.meshDirtyEnd);
  if (!Number.isFinite(s) || !Number.isFinite(e) || s < 0 || e < s) {
    grid.meshDirtyStart = index;
    grid.meshDirtyEnd = index;
    return;
  }
  if (index < s) grid.meshDirtyStart = index;
  if (index > e) grid.meshDirtyEnd = index;
}

function raiseHeat(shard, value, nowSec) {
  if (!shard || !(value > 0)) return false;
  if (shardHeatNow(shard, nowSec) >= value) return false;
  shard.heat = Math.min(1, value);
  shard.heatStamp = nowSec;
  return true;
}

/**
 * @param {object} options
 *   scene     — THREE.Scene (Core3D.scene)
 *   layer     — warstwa (0 = ortho, jak kadłuby)
 *   colorFor  — (core) => [r, g, b] liniowe, barwa frakcji
 *   ventCapacity — sloty puli wyrzutów
 */
export function createCoreFx3D(options = {}) {
  const scene = options.scene;
  if (!scene) throw new Error('createCoreFx3D: wymagana scena');
  const layer = Number.isFinite(options.layer) ? options.layer : CORE_FX_LAYER;
  // Zgłoszenie widocznej zawartości warstwy (Core3D.setShieldLayerActive(true)).
  // Tylko podnosi flagę — gasi ją ten, kto zaczyna klatkę (shield3D / demo).
  const markLayerActive = typeof options.markLayerActive === 'function' ? options.markLayerActive : null;
  // Przełączniki diagnostyczne (pomiar udziału w histogramie HDR).
  const debug = { glow: true, vents: true, rim: true, blast: true };
  const colorFor = typeof options.colorFor === 'function' ? options.colorFor : () => [0.3, 0.7, 1.0];
  // glowFilter(core) === false → bez żaru (rdzeń ma model reactor3D: światło
  // daje plazma w torusie); wyrzuty i żar brzegu rany zostają.
  const glowFilter = typeof options.glowFilter === 'function' ? options.glowFilter : null;
  const maxGlows = Math.max(1, options.maxGlows | 0 || 64);
  const ventCap = Math.max(64, options.ventCapacity | 0 || 2048);
  const rng = makeRng(options.seed || 0x5eed);

  // --- żar (jedno wywołanie na wszystkie odsłonięte rdzenie) ---
  const glowBase = new THREE.PlaneGeometry(2, 2);
  const glowGeo = new THREE.InstancedBufferGeometry();
  glowGeo.index = glowBase.index;
  glowGeo.setAttribute('position', glowBase.attributes.position);
  const glowCore = new Float32Array(maxGlows * 4);
  const glowColor = new Float32Array(maxGlows * 4);
  const glowState = new Float32Array(maxGlows * 4);
  const aCore = new THREE.InstancedBufferAttribute(glowCore, 4).setUsage(THREE.DynamicDrawUsage);
  const aColor = new THREE.InstancedBufferAttribute(glowColor, 4).setUsage(THREE.DynamicDrawUsage);
  const aState = new THREE.InstancedBufferAttribute(glowState, 4).setUsage(THREE.DynamicDrawUsage);
  glowGeo.setAttribute('aCore', aCore);
  glowGeo.setAttribute('aColor', aColor);
  glowGeo.setAttribute('aState', aState);
  glowGeo.instanceCount = 0;
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uZ: { value: GLOW_Z } },
    vertexShader: GLOW_VERTEX,
    fragmentShader: GLOW_FRAGMENT,
    ...FX_BLEND,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const glowMesh = new THREE.Mesh(glowGeo, glowMat);
  glowMesh.frustumCulled = false;
  glowMesh.renderOrder = GLOW_RENDER_ORDER;
  glowMesh.visible = false;
  glowMesh.layers.set(layer);
  glowMesh.matrixAutoUpdate = false;
  glowMesh.name = 'coreFx3D:glow';
  scene.add(glowMesh);

  // --- wyrzuty plazmy (ring bufor, upload tylko dotkniętego wycinka) ---
  const ventBase = new THREE.PlaneGeometry(2, 2);
  const ventGeo = new THREE.InstancedBufferGeometry();
  ventGeo.index = ventBase.index;
  ventGeo.setAttribute('position', ventBase.attributes.position);
  const ventStart = new Float32Array(ventCap * 4);
  const ventLife = new Float32Array(ventCap * 4);
  const ventColor = new Float32Array(ventCap * 4);
  const vStart = new THREE.InstancedBufferAttribute(ventStart, 4).setUsage(THREE.DynamicDrawUsage);
  const vLife = new THREE.InstancedBufferAttribute(ventLife, 4).setUsage(THREE.DynamicDrawUsage);
  const vColor = new THREE.InstancedBufferAttribute(ventColor, 4).setUsage(THREE.DynamicDrawUsage);
  ventGeo.setAttribute('aStart', vStart);
  ventGeo.setAttribute('aLife', vLife);
  ventGeo.setAttribute('aColor', vColor);
  ventGeo.instanceCount = 0;
  const ventMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uZ: { value: VENT_Z } },
    vertexShader: VENT_VERTEX,
    fragmentShader: VENT_FRAGMENT,
    ...FX_BLEND,
    transparent: true,
    depthTest: true,
    depthWrite: false
  });
  const ventMesh = new THREE.Mesh(ventGeo, ventMat);
  ventMesh.frustumCulled = false;
  ventMesh.renderOrder = VENT_RENDER_ORDER;
  ventMesh.visible = false;
  ventMesh.layers.set(layer);
  ventMesh.matrixAutoUpdate = false;
  ventMesh.name = 'coreFx3D:vents';
  scene.add(ventMesh);

  const pool = { cursor: 0, highWater: 0, liveUntil: -Infinity, lo: -1, hi: -1 };
  // Zegar efektów = czas SYMULACJI (pauza zatrzymuje wyrzuty i puls, zwolnienie
  // czasu je zwalnia). Żar brzegu idzie osobno, na bazie czasu shadera kadłubów.
  let clock = 0;
  const perCore = new WeakMap();
  const stats = { glows: 0, vents: 0, drawCalls: 0, rimHeated: 0, jets: 0, orbs: 0, rings: 0, flashes: 0 };
  const scratch = { x: 0, y: 0 };
  const ventCenter = { x: 0, y: 0 };
  const ventPoint = { x: 0, y: 0 };
  const band = { prog: 0, bodyL: 0, coreL: 0, coreR: 0, rim: 0, pulseHz: 0 };
  const colorCache = new WeakMap();

  function coreColor(core) {
    let c = colorCache.get(core);
    if (!c) {
      c = parseColor(core.color, null) || parseColor(colorFor(core), [0.3, 0.7, 1.0]);
      colorCache.set(core, c);
    }
    return c;
  }

  function spawnVent(t0, x, y, vx, vy, size0, size1, life, col, coreL, bodyL = CORE_FX_BANDS.ventBodyL) {
    const i = pool.cursor;
    pool.cursor = (pool.cursor + 1) % ventCap;
    if (i + 1 > pool.highWater) pool.highWater = i + 1;
    if (pool.lo < 0 || i < pool.lo) pool.lo = i;
    if (i > pool.hi) pool.hi = i;
    const b = i * 4;
    ventStart[b] = x; ventStart[b + 1] = -y; ventStart[b + 2] = vx; ventStart[b + 3] = -vy;
    ventLife[b] = t0; ventLife[b + 1] = life; ventLife[b + 2] = size0; ventLife[b + 3] = size1;
    const norm = bodyL / Math.max(1e-3, luminance(col));
    ventColor[b] = col[0] * norm; ventColor[b + 1] = col[1] * norm; ventColor[b + 2] = col[2] * norm; ventColor[b + 3] = coreL;
    if (t0 + life > pool.liveUntil) pool.liveUntil = t0 + life;
  }

  // --- efekty po detonacji: strumienie, kule, pierścienie (po 1 wywołaniu) ---
  function makeInstanced(base, attrs, count, vertexShader, fragmentShader, z, renderOrder, name) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    const bufs = {};
    for (const key of attrs) {
      const arr = new Float32Array(count * 4);
      const attr = new THREE.InstancedBufferAttribute(arr, 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(key, attr);
      bufs[key] = { arr, attr };
    }
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uZ: { value: z } },
      vertexShader,
      fragmentShader,
      ...FX_BLEND,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = renderOrder;
    mesh.visible = false;
    mesh.layers.set(layer);
    mesh.matrixAutoUpdate = false;
    mesh.name = name;
    scene.add(mesh);
    return { base, geo, mat, mesh, bufs };
  }
  const MAX_JETS = 8;
  const MAX_ORBS = 16;
  const MAX_RINGS = 24;
  const jetFx = makeInstanced(new THREE.PlaneGeometry(1, 1, 24, 1), ['aSeg', 'aJet', 'aColor'], MAX_JETS, JET_VERTEX, JET_FRAGMENT, JET_Z, JET_RENDER_ORDER, 'coreFx3D:jets');
  const orbFx = makeInstanced(new THREE.PlaneGeometry(2, 2), ['aOrb', 'aOrbS', 'aColor'], MAX_ORBS, ORB_VERTEX, ORB_FRAGMENT, ORB_Z, ORB_RENDER_ORDER, 'coreFx3D:orbs');
  const ringFx = makeInstanced(new THREE.PlaneGeometry(2, 2), ['aRing', 'aRingS', 'aColor'], MAX_RINGS, RING_VERTEX, RING_FRAGMENT, RING_Z, RING_RENDER_ORDER, 'coreFx3D:rings');
  const MAX_FLASHES = 16;
  const flashFx = makeInstanced(new THREE.PlaneGeometry(2, 2), ['aFlash', 'aFlashS', 'aColor'], MAX_FLASHES, FLASH_VERTEX, FLASH_FRAGMENT, FLASH_Z, FLASH_RENDER_ORDER, 'coreFx3D:flashes');
  const flashList = [];
  const jetList = [];
  const orbList = [];
  const ringList = [];

  function bandColor(col, bodyL, out, k) {
    const norm = bodyL / Math.max(1e-3, luminance(col));
    out[k] = col[0] * norm;
    out[k + 1] = col[1] * norm;
    out[k + 2] = col[2] * norm;
  }

  function ownerOf(shard, owners) {
    for (let i = 0; i < owners.length; i++) {
      const e = owners[i];
      if (e && !e.dead && e.hexGrid && isShardOnEntity(shard, e)) return e;
    }
    return null;
  }

  // Iskry trafień i tarcia (overlay) — z opcji albo globalny SparkSystem3D gry.
  const impactSparksOpt = options.impactSparks || null;
  function impactSparks() {
    const ss = impactSparksOpt || globalThis.SparkSystem3D;
    return ss && ss.isInitialized ? ss : null;
  }
  // Rozdzierane szczeliny: snopy z brzegów przez pierwsze ułamki sekundy.
  const tearList = [];

  // Wybuch w komorze: iskry na pełne koło (metal i plazma), rozżarzone
  // odpryski poszycia, łuki plazmy i opar — tworzywo trafienia Hexlance'a
  // rozsypane dookoła, plus flara („huk”) jak u błysku wylotowego.
  function blastSparks(x, y, o = {}) {
    if (!debug.blast || !Fx3D.ensure()) return;
    const S = fxScale(o.classId) * finite(o.scale, 1);
    const plasma = plasmaSparkColor(parseColor(o.color, null) || [0.3, 0.7, 1.0]);
    const bvx = finite(o.vx, 0);
    const bvy = -finite(o.vy, 0);
    _fp.set(x, -y, FX_PLANE_Z);
    if (o.flare !== false) {
      const s = fxParams();
      s.x = _fp.x; s.y = _fp.y; s.z = _fp.z;
      s.life = 0.2; s.drag = 5;
      s.s0 = 90 * S; s.s1 = 330 * S;
      s.rot = Math.random() * 6.283; s.vrot = frand(-0.8, 0.8);
      s.r0 = 3.2; s.g0 = 3.4; s.b0 = 3.8;
      s.r1 = plasma[0] * 0.45; s.g1 = plasma[1] * 0.45; s.b1 = plasma[2] * 0.45; s.mix = 10;
      s.alpha = 0.9; s.fadeIn = 0.005; s.fadeOut = 2.4; s.grow = 0.35;
      Fx3D.star.spawn(s);
    }
    for (let i = 0, n = Math.round(finite(o.sparks, 220)); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const metal = Math.random() < 0.6;
      const v = (metal ? frand(250, 1100) : frand(400, 1600)) * S;
      _fv.set(c * v + bvx, sn * v + bvy, frand(-0.05, 0.05) * v);
      const r0 = frand(0, 22) * S;
      _fq.set(_fp.x + c * r0, _fp.y + sn * r0, _fp.z);
      if (metal) Fx3D.spark.spawn(_fq, _fv, frand(0.35, 1.0), frand(0.5, 1.4), frand(20, 70) * S, SPARK_METAL);
      else Fx3D.spark.spawn(_fq, _fv, frand(0.3, 0.8), frand(0.25, 0.7), frand(45, 140) * S, plasma, 1.05, 1.2);
    }
    for (let i = 0, n = Math.round(finite(o.chunks, 18)); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = frand(60, 280) * S;
      _fv.set(Math.cos(a) * v + bvx, Math.sin(a) * v + bvy, 0);
      Fx3D.spark.spawn(_fp, _fv, frand(1.6, 3.2), 0.3, frand(50, 120) * S, SPARK_CHUNK, 0.4, 0.1);
    }
    for (let i = 0, n = Math.round(finite(o.arcs, 10)); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = frand(40, 170) * S;
      _fq.set(_fp.x + Math.cos(a) * r, _fp.y + Math.sin(a) * r, _fp.z);
      Fx3D.arcs.spawn(_fp, _fq, frand(0.12, 0.38), frand(6, 24) * S, plasma);
    }
    for (let i = 0, n = Math.round(finite(o.vapor, 14)); i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = frand(20, 120) * S;
      const r0 = frand(0, 40) * S;
      const s = fxParams();
      s.x = _fp.x + Math.cos(a) * r0; s.y = _fp.y + Math.sin(a) * r0; s.z = _fp.z;
      s.vx = Math.cos(a) * v + bvx; s.vy = Math.sin(a) * v + bvy; s.vz = 0;
      s.life = frand(1.0, 2.4); s.drag = 1.0;
      s.s0 = frand(30, 70) * S; s.s1 = frand(120, 260) * S;
      s.rot = Math.random() * 6.283; s.vrot = frand(-0.4, 0.4);
      s.r0 = plasma[0] * 0.45; s.g0 = plasma[1] * 0.45; s.b0 = plasma[2] * 0.45;
      s.r1 = 0.14; s.g1 = 0.09; s.b1 = 0.34; s.mix = 1.3;
      s.alpha = frand(0.10, 0.24); s.fadeIn = 0.06; s.fadeOut = 1.5; s.grow = 0.45;
      Fx3D.vapor.spawn(s);
    }
    const ss = impactSparks();
    if (ss) ss.burst(x, y, Math.round(finite(o.hitSparks, 60)), 260 * S, 0.5, 0.7);
  }

  // Świat → punkty brzegów szczeliny: [x, y, wzdłuż.x, wzdłuż.y, w szczelinę.x, w szczelinę.y].
  function pushCrackPoint(out, host, shard, ax, ay, gx, gy) {
    gridToLocal(host, shard.gridX, shard.gridY, _fl);
    localToWorld(host, _fl.x, _fl.y, _fl);
    out.push(_fl.x, _fl.y, ax, ay, gx, gy);
  }

  // Jeden snop z losowych punktów szczeliny: wiór wzdłuż niej na zewnątrz
  // i w szczelinę (rozdzierana blacha), co któryś — rozżarzony odprysk.
  function emitTear(tear, count) {
    const P = tear.points;
    const np = (P.length / 6) | 0;
    if (np <= 0 || count <= 0 || !Fx3D.ensure()) return;
    const S = tear.S;
    for (let k = 0; k < count; k++) {
      const b = ((Math.random() * np) | 0) * 6;
      const along = Math.random() < 0.6;
      const dx = along ? P[b + 2] * 0.85 + P[b + 4] * 0.35 : P[b + 4] * 0.9 + P[b + 2] * 0.3;
      const dy = along ? P[b + 3] * 0.85 + P[b + 5] * 0.35 : P[b + 5] * 0.9 + P[b + 3] * 0.3;
      sceneDir(_fd, dx, dy);
      coneDir(_fq, _fd, along ? 0.55 : 0.9, FX_FLAT);
      const v = frand(150, 720) * S;
      _fv.copy(_fq).multiplyScalar(v);
      _fp.set(P[b], -P[b + 1], FX_PLANE_Z);
      if (Math.random() < 0.1) Fx3D.spark.spawn(_fp, _fv.multiplyScalar(0.35), frand(1.4, 2.8), 0.3, frand(50, 110) * S, SPARK_CHUNK, 0.4, 0.1);
      else Fx3D.spark.spawn(_fp, _fv, frand(0.25, 0.8), frand(0.6, 1.5), frand(18, 60) * S, SPARK_KERF);
    }
  }

  // Przełamanie / rozerwanie: iskry z brzegów pęknięć (plan.cuts + edgeShards)
  // od razu i przez tearSec rozchodzenia się kawałków, a wzdłuż każdego
  // pęknięcia snop tarcia SparkSystem3D (grindingSeam — jak ocierające się
  // kadłuby). Woła się PRZED applyCoreDetonation, póki kadłub jest cały.
  function crackSparks(core, plan, o = {}) {
    const host = core?.host;
    if (!debug.blast || !host?.hexGrid || !plan?.cuts?.length || !plan.edgeShards?.length) return;
    const S = fxScale(core.classId);
    const tear = { until: clock + finite(o.tearSec, 0.45), rate: finite(o.rate, 240), acc: 0, S, points: [] };
    const across = CRACK_EDGE_GRID;
    const ss = impactSparks();
    for (const cut of plan.cuts) {
      gridDirToWorld(host, cut.dx, cut.dy, _fw);
      const wx = _fw.x;
      const wy = _fw.y;
      const start = tear.points.length;
      for (const s of plan.edgeShards) {
        const dx = s.gridX - cut.x;
        const dy = s.gridY - cut.y;
        const t = dx * cut.dx + dy * cut.dy;
        if (!cut.both && t < 0) continue;
        const d = -dx * cut.dy + dy * cut.dx;
        if (Math.abs(d) > across) continue;
        const sg = t >= 0 ? 1 : -1;
        const side = d >= 0 ? 1 : -1;
        // brzeg po stronie +normalnej patrzy w szczelinę przeciwnie do normalnej
        pushCrackPoint(tear.points, host, s, wx * sg, wy * sg, wy * side, -wx * side);
      }
      if (ss && tear.points.length > start) {
        const n = Math.min(24, (tear.points.length - start) / 6);
        const seam = new Float32Array(n * 4);
        const stride = ((tear.points.length - start) / 6) / n;
        for (let i = 0; i < n; i++) {
          const b = start + Math.floor(i * stride) * 6;
          seam[i * 4] = tear.points[b];
          seam[i * 4 + 1] = tear.points[b + 1];
          seam[i * 4 + 2] = -tear.points[b + 4];
          seam[i * 4 + 3] = -tear.points[b + 5];
        }
        ss.grindingSeam(seam, n, wx, wy, 320, 140, finite(host.vx), finite(host.vy));
      }
    }
    if (!tear.points.length) return;
    emitTear(tear, Math.round(finite(o.count, 120)));
    if (tearList.length >= 16) tearList.shift();
    tearList.push(tear);
  }

  // Wyrwa: roztopiony metal sypie z obwodu krateru na zewnątrz.
  function rimSparks(core, plan, o = {}) {
    const host = core?.host;
    if (!debug.blast || !host?.hexGrid || !plan?.edgeShards?.length || !Fx3D.ensure()) return;
    const S = fxScale(core.classId);
    getCoreWorld(core, ventCenter);
    const edges = plan.edgeShards;
    const ss = impactSparks();
    for (let k = 0, n = Math.round(finite(o.count, 110)); k < n; k++) {
      const s = edges[(Math.random() * edges.length) | 0];
      gridToLocal(host, s.gridX, s.gridY, _fl);
      localToWorld(host, _fl.x, _fl.y, _fl);
      sceneDir(_fd, _fl.x - ventCenter.x, _fl.y - ventCenter.y);
      coneDir(_fq, _fd, 0.8, FX_FLAT);
      _fp.set(_fl.x, -_fl.y, FX_PLANE_Z);
      if (Math.random() < 0.12) {
        _fv.copy(_fq).multiplyScalar(frand(60, 240) * S);
        Fx3D.spark.spawn(_fp, _fv, frand(1.6, 3.2), 0.3, frand(50, 120) * S, SPARK_CHUNK, 0.4, 0.1);
      } else {
        _fv.copy(_fq).multiplyScalar(frand(160, 800) * S);
        Fx3D.spark.spawn(_fp, _fv, frand(0.3, 0.9), frand(0.5, 1.4), frand(20, 65) * S, SPARK_METAL);
      }
      if (ss && k % 6 === 0) ss.burst(_fl.x, _fl.y, 4, 200 * S, 0.45, 0.6);
    }
  }

  // Wybuch wtórny (amunicja, paliwo): 2–3 wystrzały armaty prochowej w losowe
  // strony — ta sama recepta co błysk wylotowy Armaty — i rozżarzone odpryski.
  function cookOff(x, y, o = {}) {
    if (!debug.blast) return;
    const S = fxScale(o.classId) * finite(o.scale, 1);
    const shots = 2 + (Math.random() < 0.5 ? 1 : 0);
    const a0 = Math.random() * Math.PI * 2;
    if (MuzzleFX3D.available) {
      for (let i = 0; i < shots; i++) {
        MuzzleFX3D.fire('armata', x, y, a0 + i * (Math.PI * 2 / shots) + frand(-0.45, 0.45), S * 0.75);
      }
    }
    if (Fx3D.ensure()) {
      _fp.set(x, -y, FX_PLANE_Z);
      for (let i = 0, n = 6 + ((Math.random() * 5) | 0); i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = frand(80, 320) * S;
        _fv.set(Math.cos(a) * v + finite(o.vx), Math.sin(a) * v - finite(o.vy), 0);
        Fx3D.spark.spawn(_fp, _fv, frand(1.2, 2.6), 0.3, frand(40, 100) * S, SPARK_CHUNK, 0.4, 0.1);
      }
    }
    const ss = impactSparks();
    if (ss) ss.burst(x, y, 28, 180 * S, 0.4, 0.6);
  }

  // Wystrzał reaktora: tworzywo wystrzału Hexlance'a (RailgunFX.fire — strugi
  // jonów, płatki, łuki, mgła plazmy i plazma przed wylotem) bez jego lancy
  // (lancą jest sam strumień) i z mniejszym rdzeniem, flarą i krzyżem —
  // pełna recepta ma lancę ~2800 j. i wybielała kadłub.
  function jetShot(jet, plasma) {
    if (!Fx3D.ensure()) return;
    const S = fxScale(jet.classId);
    const I = fxPower(jet.classId);
    sceneDir(_fd, jet.dirWX, jet.dirWY);
    _fp.set(jet.originX, -jet.originY, FX_PLANE_Z);
    let o = fxParams();
    o.x = _fp.x; o.y = _fp.y; o.z = _fp.z;
    o.vx = _fd.x * 160 * S; o.vy = _fd.y * 160 * S;
    o.life = 0.12; o.drag = 5;
    o.s0 = 20 * S; o.s1 = (70 + 40 * I) * S;
    o.r0 = 3.4; o.g0 = 3.8; o.b0 = 4.3;
    o.r1 = plasma[0] * 0.3; o.g1 = plasma[1] * 0.3; o.b1 = plasma[2] * 0.3; o.mix = 13;
    o.alpha = 1; o.fadeIn = 0.004; o.fadeOut = 2.1; o.grow = 0.38;
    Fx3D.glow.spawn(o);
    o = fxParams();
    o.x = _fp.x; o.y = _fp.y; o.z = _fp.z;
    o.life = 0.16; o.drag = 6;
    o.s0 = 60 * S; o.s1 = (170 + 90 * I) * S;
    o.rot = Math.random() * 6.283; o.vrot = frand(-0.8, 0.8);
    o.r0 = 3.0; o.g0 = 3.4; o.b0 = 4.2;
    o.r1 = plasma[0] * 0.35; o.g1 = plasma[1] * 0.35; o.b1 = plasma[2] * 0.35; o.mix = 11;
    o.alpha = 0.9; o.fadeIn = 0.005; o.fadeOut = 2.5; o.grow = 0.35;
    Fx3D.star.spawn(o);
    Fx3D.cross.spawn(_fp, _fd, 0.18, 110 * S, (360 + 200 * I) * S, 30 * S, (55 + 30 * I) * S, [2.4, 3.1, 4.3], 0.9);
    // plazma wyrzucona przed wylot
    for (let i = 0; i < 30; i++) {
      coneDir(_fq, _fd, 0.14, FX_FLAT);
      const v = frand(260, 900) * S * (0.7 + 0.4 * I);
      o = fxParams();
      o.x = _fp.x + _fq.x * frand(0, 60) * S; o.y = _fp.y + _fq.y * frand(0, 60) * S; o.z = _fp.z;
      o.vx = _fq.x * v; o.vy = _fq.y * v; o.vz = _fq.z * v;
      o.life = frand(0.3, 0.8); o.drag = 1.6;
      o.s0 = frand(10, 24) * S; o.s1 = frand(45, 110) * S;
      o.rot = Math.random() * 6.283; o.vrot = frand(-1.6, 1.6);
      o.r0 = plasma[0] * 0.85; o.g0 = plasma[1] * 0.85; o.b0 = plasma[2] * 0.85;
      o.r1 = 0.22; o.g1 = 0.30; o.b1 = 0.85; o.mix = 3.4;
      o.alpha = frand(0.35, 0.7); o.fadeIn = 0.02; o.fadeOut = 1.8; o.grow = 0.5;
      Fx3D.glow.spawn(o);
    }
    // strugi jonów — długie smugi, wąski snop
    for (let i = 0, n = Math.round(150 * I); i < n; i++) {
      coneDir(_fq, _fd, 0.1 * (Math.random() < 0.15 ? 2.4 : 0.8), FX_FLAT);
      _fv.copy(_fq).multiplyScalar(frand(500, 1900) * S * (0.7 + 0.4 * I));
      _fb.copy(_fp).addScaledVector(_fq, frand(0, 80) * S);
      Fx3D.spark.spawn(_fb, _fv, frand(0.3, 0.9), frand(0.25, 0.7), frand(45, 150) * S, plasma, 1.05, 1.2);
    }
    // płatki — rozżarzone odłamki pokrywy komory, szerszy stożek, długo widoczne
    for (let i = 0; i < 8; i++) {
      coneDir(_fq, _fd, 0.26, FX_FLAT);
      _fv.copy(_fq).multiplyScalar(frand(160, 420) * S);
      _fb.copy(_fp).addScaledVector(_fq, frand(10, 40) * S);
      Fx3D.spark.spawn(_fb, _fv, frand(1.6, 3.0), 0.25, frand(60, 130) * S, [3.2, 2.0, 0.9], 0.45, 0.12);
    }
    // łuki dogasające przy wylocie
    for (let i = 0; i < 10; i++) {
      coneDir(_fq, _fd, 0.55, FX_FLAT);
      _fb.copy(_fp).addScaledVector(_fq, frand(20, 90) * S);
      Fx3D.arcs.spawn(_fp, _fb, frand(0.12, 0.38), frand(6, 26) * S, plasma);
    }
    // mgła plazmowa — zostaje na dłużej, dryfuje do przodu
    for (let i = 0; i < 18; i++) {
      coneDir(_fq, _fd, 0.3, FX_FLAT);
      const v = frand(30, 150) * S;
      o = fxParams();
      o.x = _fp.x + _fq.x * frand(0, 120) * S; o.y = _fp.y + _fq.y * frand(0, 120) * S; o.z = _fp.z;
      o.vx = _fq.x * v; o.vy = _fq.y * v; o.vz = 0;
      o.life = frand(1.1, 2.6); o.drag = 0.9;
      o.s0 = frand(30, 70) * S; o.s1 = frand(130, 290) * S;
      o.rot = Math.random() * 6.283; o.vrot = frand(-0.4, 0.4);
      o.r0 = plasma[0] * 0.45; o.g0 = plasma[1] * 0.45; o.b0 = plasma[2] * 0.45;
      o.r1 = 0.14; o.g1 = 0.09; o.b1 = 0.34; o.mix = 1.3;
      o.alpha = frand(0.10, 0.24); o.fadeIn = 0.06; o.fadeOut = 1.5; o.grow = 0.45;
      Fx3D.vapor.spawn(o);
    }
  }

  // Strumień: przy starcie wystrzał (jetShot), strugi jonów i łuki przy
  // wylocie, a na celu — rzaz jak Hexlance tnący kadłub (RailgunFX3D: rozbłysk
  // wejścia raz na kadłub, potem wiór co 0,05 s).
  function jetSparks(rec, jet, env, simDt) {
    if (!debug.blast) return;
    const power = fxPower(jet.classId);
    if (!rec.fired) {
      rec.fired = true;
      jetShot(jet, rec.plasma);
    }
    if (!(simDt > 0) || env <= 0.05 || !Fx3D.ensure()) return;
    const S = fxScale(jet.classId);
    sceneDir(_fd, jet.dirWX, jet.dirWY);
    _fp.set(jet.originX, -jet.originY, FX_PLANE_Z);
    rec.streamAcc += simDt * 260 * env;
    const cnt = Math.min(40, Math.floor(rec.streamAcc));
    rec.streamAcc -= cnt;
    for (let k = 0; k < cnt; k++) {
      coneDir(_fq, _fd, Math.random() < 0.15 ? 0.3 : 0.1, FX_FLAT);
      _fv.copy(_fq).multiplyScalar(frand(500, 1900) * S);
      _fb.copy(_fp).addScaledVector(_fq, frand(0, 60) * S);
      Fx3D.spark.spawn(_fb, _fv, frand(0.25, 0.7), frand(0.25, 0.7), frand(45, 150) * S, rec.plasma, 1.05, 1.2);
    }
    rec.arcAcc += simDt * 14 * env;
    while (rec.arcAcc >= 1) {
      rec.arcAcc -= 1;
      coneDir(_fq, _fd, 0.9, FX_FLAT);
      _fb.copy(_fp).addScaledVector(_fq, frand(30, 120) * S);
      Fx3D.arcs.spawn(_fp, _fb, frand(0.08, 0.22), frand(4, 16) * S, rec.plasma);
    }
    const hit = jet.hitEntity;
    if (!hit || !RailgunFX3D.available) return;
    const ss = impactSparks();
    if (!rec.bitten.has(hit)) {
      rec.bitten.add(hit);
      rec.kerfCd = 0.05;
      RailgunFX3D.impact(jet.endX, jet.endY, jet.dirWX, jet.dirWY, 0.85 * power);
      if (ss) ss.burst(jet.endX, jet.endY, 40, 520, 0.4, 0.7);
      return;
    }
    rec.kerfCd -= simDt;
    if (rec.kerfCd > 0) return;
    rec.kerfCd = 0.05;
    RailgunFX3D.kerf(jet.endX, jet.endY, jet.dirWX, jet.dirWY, 0.7 * power);
    if (ss) ss.burst(jet.endX, jet.endY, 10, 420, 0.35, 0.6);
  }

  // Kula: przy wypadnięciu wyładowanie działa jonowego (recepta Tempesta),
  // w locie opar, iskry i łuki wokół kuli, a przy topieniu — wiór i krople
  // z czoła kuli plus snop tarcia jak przy ocierających się kadłubach.
  function orbSparks(rec, orb, simDt) {
    if (!debug.blast) return;
    const S = fxScale(orb.classId);
    if (!rec.fired) {
      rec.fired = true;
      const hvx = finite(orb.host?.vel?.x ?? orb.host?.vx);
      const hvy = finite(orb.host?.vel?.y ?? orb.host?.vy);
      if (MuzzleFX3D.available) MuzzleFX3D.fire('tempest', orb.x, orb.y, Math.atan2(orb.vy - hvy, orb.vx - hvx), S * 1.3);
    }
    if (!(simDt > 0) || !Fx3D.ensure()) return;
    const sp = Math.hypot(orb.vx, orb.vy);
    const ux = sp > 1e-3 ? orb.vx / sp : 1;
    const uy = sp > 1e-3 ? orb.vy / sp : 0;
    _fp.set(orb.x, -orb.y, FX_PLANE_Z);
    // ślad: opar plazmy zostaje za kulą
    rec.trailAcc += simDt * 26;
    while (rec.trailAcc >= 1) {
      rec.trailAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const s = fxParams();
      s.x = _fp.x + Math.cos(a) * orb.radius * 0.4; s.y = _fp.y + Math.sin(a) * orb.radius * 0.4; s.z = _fp.z;
      s.vx = -ux * frand(20, 70) * S + Math.cos(a) * 20; s.vy = uy * frand(20, 70) * S + Math.sin(a) * 20; s.vz = 0;
      s.life = frand(0.8, 1.8); s.drag = 1.2;
      s.s0 = orb.radius * frand(0.8, 1.4); s.s1 = orb.radius * frand(2.6, 4.2);
      s.rot = Math.random() * 6.283; s.vrot = frand(-0.8, 0.8);
      s.r0 = rec.plasma[0] * 0.45; s.g0 = rec.plasma[1] * 0.45; s.b0 = rec.plasma[2] * 0.45;
      s.r1 = 0.14; s.g1 = 0.09; s.b1 = 0.34; s.mix = 1.5;
      s.alpha = frand(0.16, 0.32); s.fadeIn = 0.05; s.fadeOut = 1.5; s.grow = 0.45;
      Fx3D.vapor.spawn(s);
    }
    // iskry plazmy zrywane z powierzchni, głównie wstecz
    sceneDir(_fd, -ux, -uy);
    rec.sparkAcc += simDt * 70;
    const cnt = Math.min(20, Math.floor(rec.sparkAcc));
    rec.sparkAcc -= cnt;
    for (let k = 0; k < cnt; k++) {
      coneDir(_fq, _fd, 1.1, FX_FLAT);
      _fb.copy(_fp).addScaledVector(_fq, orb.radius * 0.8);
      _fv.copy(_fq).multiplyScalar(frand(120, 520) * S);
      Fx3D.spark.spawn(_fb, _fv, frand(0.2, 0.55), frand(0.6, 1.4), frand(15, 45) * S, rec.plasma, 1.05, 1.2);
    }
    // trzaskające łuki wokół kuli
    rec.arcAcc += simDt * 18;
    while (rec.arcAcc >= 1) {
      rec.arcAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const r = orb.radius * frand(1.3, 2.6);
      _fb.set(_fp.x + Math.cos(a) * r, _fp.y + Math.sin(a) * r, _fp.z);
      Fx3D.arcs.spawn(_fp, _fb, frand(0.06, 0.16), orb.radius * frand(0.15, 0.4), rec.plasma);
    }
    // topienie: wiór i krople z czoła kuli; rozbłysk i snop tarcia dławione
    // (co klatkę nakładały się w białą plamę)
    rec.meltCd -= simDt;
    const m = orb.meltCount | 0;
    if (m <= 0) return;
    orb.meltCount = 0;
    const pulse = rec.meltCd <= 0;
    if (pulse) rec.meltCd = 0.07;
    const fx = orb.x + ux * orb.radius * 0.9;
    const fy = orb.y + uy * orb.radius * 0.9;
    _fp.set(fx, -fy, FX_PLANE_Z);
    sceneDir(_fd, -ux, -uy);
    for (let k = 0, n = Math.min(60, 6 + m * 3); k < n; k++) {
      const back = Math.random() < 0.65;
      if (back) coneDir(_fq, _fd, 1.2, FX_FLAT);
      else { _fb.copy(_fd).negate(); coneDir(_fq, _fb, 1.4, FX_FLAT); }
      _fv.copy(_fq).multiplyScalar((back ? frand(120, 620) : frand(80, 360)) * S);
      Fx3D.spark.spawn(_fp, _fv, frand(0.25, 0.8), frand(0.6, 1.5), frand(18, 60) * S, SPARK_KERF);
    }
    for (let k = 0, n = Math.min(6, 1 + (m >> 2)); k < n; k++) {
      coneDir(_fq, _fd, 1.6, FX_FLAT);
      _fv.copy(_fq).multiplyScalar(frand(40, 200) * S);
      Fx3D.spark.spawn(_fp, _fv, frand(1.4, 3.0), 0.3, frand(40, 100) * S, SPARK_CHUNK, 0.4, 0.1);
    }
    if (!pulse) return;
    const s = fxParams();
    s.x = _fp.x; s.y = _fp.y; s.z = _fp.z;
    s.life = 0.14; s.drag = 5;
    s.s0 = orb.radius * 0.8; s.s1 = orb.radius * 2.2;
    s.r0 = 2.6; s.g0 = 1.9; s.b0 = 1.1;
    s.r1 = 1.6; s.g1 = 0.5; s.b1 = 0.15; s.mix = 12;
    s.alpha = 0.6; s.fadeIn = 0.004; s.fadeOut = 2.2; s.grow = 0.4;
    Fx3D.glow.spawn(s);
    const ss = impactSparks();
    if (ss) ss.grindingBurst(fx, fy, -ux, -uy, -uy, ux, 60 + m * 6, 40, orb.vx * 0.3, orb.vy * 0.3);
  }

  // Żar heksów (brzegi pęknięć, wyrwy) u ich obecnego właściciela.
  function heatShards(shards, owners, value, nowSec) {
    if (!Array.isArray(shards) || !Array.isArray(owners)) return 0;
    let n = 0;
    for (const s of shards) {
      if (!s || !s.active || s.isDebris) continue;
      const owner = ownerOf(s, owners);
      if (!owner) continue;
      if (raiseHeat(s, value, nowSec)) {
        markHeatDirty(owner.hexGrid, s.__meshIndex);
        n++;
      }
    }
    stats.rimHeated += n;
    return n;
  }

  function spawnJet(jet, color) {
    if (!jet || jetList.length >= MAX_JETS) return;
    const col = parseColor(color ?? jet.color, null) || [0.3, 0.7, 1.0];
    jetList.push({
      jet, color: col, plasma: plasmaSparkColor(col), seed: rng(),
      fired: false, streamAcc: 0, arcAcc: 0, kerfCd: 0, bitten: new Set()
    });
  }

  function spawnOrb(orb, color) {
    if (!orb || orbList.length >= MAX_ORBS) return;
    const col = parseColor(color ?? orb.color, null) || [0.3, 0.7, 1.0];
    orbList.push({ orb, color: col, plasma: plasmaSparkColor(col), seed: rng(), fired: false, trailAcc: 0, sparkAcc: 0, arcAcc: 0, meltCd: 0 });
  }

  // Rozbłysk plazmy (patrz FLASH_FRAGMENT): promień rośnie do `radius`.
  function flash(x, y, radius, color, duration = 0.45, o = {}) {
    if (!(radius > 0)) return;
    if (flashList.length >= MAX_FLASHES) flashList.shift();
    flashList.push({
      x, y, radius, t0: clock, dur: Math.max(0.05, duration), seed: rng(),
      color: parseColor(color, null) || [0.3, 0.7, 1.0],
      whiteL: finite(o.whiteL, CORE_FX_BANDS.flashCoreL), bodyL: finite(o.bodyL, CORE_FX_BANDS.flashBodyL)
    });
  }

  function spawnRing(x, y, maxRadius, color, duration = 0.7, o = {}) {
    if (ringList.length >= MAX_RINGS) ringList.shift();
    ringList.push({
      x, y, maxR: Math.max(10, maxRadius), t0: clock, dur: Math.max(0.05, duration),
      color: parseColor(color, null) || [0.3, 0.7, 1.0], seed: rng(),
      bodyL: finite(o.bodyL, 0.75), whiteL: finite(o.whiteL, CORE_FX_BANDS.ringEdgeL), th: finite(o.thickness, 0.09)
    });
  }

  function syncBlastFx(simDt) {
    // strumienie
    let n = 0;
    const js = jetFx.bufs;
    for (let i = jetList.length - 1; i >= 0; i--) {
      const rec = jetList[i];
      const jet = rec.jet;
      if (jet.done) { jetList[i] = jetList[jetList.length - 1]; jetList.pop(); continue; }
      if (!(jet.age > 0)) continue;
      const env = coreJetEnvelope(jet);
      const b = n * 4;
      js.aSeg.arr[b] = jet.originX; js.aSeg.arr[b + 1] = -jet.originY;
      js.aSeg.arr[b + 2] = jet.endX; js.aSeg.arr[b + 3] = -jet.endY;
      const len = Math.hypot(jet.endX - jet.originX, jet.endY - jet.originY);
      js.aJet.arr[b] = jet.width * 0.5; js.aJet.arr[b + 1] = env; js.aJet.arr[b + 2] = rec.seed; js.aJet.arr[b + 3] = len;
      bandColor(rec.color, CORE_FX_BANDS.jetBodyL, js.aColor.arr, b);
      js.aColor.arr[b + 3] = CORE_FX_BANDS.jetCoreL;
      n++;
      jetSparks(rec, jet, env, simDt);
    }
    jetFx.geo.instanceCount = n;
    jetFx.mesh.visible = n > 0 && debug.blast;
    if (n > 0) for (const k of ['aSeg', 'aJet', 'aColor']) { js[k].attr.clearUpdateRanges(); js[k].attr.addUpdateRange(0, n * 4); js[k].attr.needsUpdate = true; }
    jetFx.mat.uniforms.uTime.value = clock;
    stats.jets = n;

    // kule
    n = 0;
    const os = orbFx.bufs;
    for (let i = orbList.length - 1; i >= 0; i--) {
      const rec = orbList[i];
      const orb = rec.orb;
      if (orb.detonated) { orbList[i] = orbList[orbList.length - 1]; orbList.pop(); continue; }
      const b = n * 4;
      os.aOrb.arr[b] = orb.x; os.aOrb.arr[b + 1] = -orb.y;
      os.aOrb.arr[b + 2] = orb.radius * 2.8; os.aOrb.arr[b + 3] = orb.age * orb.spin;
      os.aOrbS.arr[b] = Math.min(1, orb.age / Math.max(0.05, orb.fuse)); os.aOrbS.arr[b + 1] = rec.seed;
      os.aOrbS.arr[b + 2] = CORE_FX_BANDS.orbBodyL; os.aOrbS.arr[b + 3] = CORE_FX_BANDS.orbCoreL;
      bandColor(rec.color, 1, os.aColor.arr, b);
      os.aColor.arr[b + 3] = 0;
      n++;
      orbSparks(rec, orb, simDt);
    }
    orbFx.geo.instanceCount = n;
    orbFx.mesh.visible = n > 0 && debug.blast;
    if (n > 0) for (const k of ['aOrb', 'aOrbS', 'aColor']) { os[k].attr.clearUpdateRanges(); os[k].attr.addUpdateRange(0, n * 4); os[k].attr.needsUpdate = true; }
    orbFx.mat.uniforms.uTime.value = clock;
    stats.orbs = n;

    // rozdzierane szczeliny: snopy z brzegów gasną przez tearSec
    for (let i = tearList.length - 1; i >= 0; i--) {
      const tear = tearList[i];
      if (clock >= tear.until) { tearList[i] = tearList[tearList.length - 1]; tearList.pop(); continue; }
      if (!(simDt > 0)) continue;
      tear.acc += simDt * tear.rate;
      const cnt = Math.min(24, Math.floor(tear.acc));
      tear.acc -= cnt;
      emitTear(tear, cnt);
    }

    // pierścienie
    n = 0;
    const rs = ringFx.bufs;
    for (let i = ringList.length - 1; i >= 0; i--) {
      const r = ringList[i];
      const age = (clock - r.t0) / r.dur;
      if (age >= 1) { ringList[i] = ringList[ringList.length - 1]; ringList.pop(); continue; }
      if (age < 0) continue;
      const b = n * 4;
      const grow = 1 - Math.pow(1 - age, 2.4);
      rs.aRing.arr[b] = r.x; rs.aRing.arr[b + 1] = -r.y;
      rs.aRing.arr[b + 2] = Math.max(4, r.maxR * grow); rs.aRing.arr[b + 3] = r.th * (1 + age * 1.2);
      rs.aRingS.arr[b] = age; rs.aRingS.arr[b + 1] = r.bodyL; rs.aRingS.arr[b + 2] = r.whiteL; rs.aRingS.arr[b + 3] = r.seed;
      bandColor(r.color, 1, rs.aColor.arr, b);
      rs.aColor.arr[b + 3] = 0;
      n++;
    }
    ringFx.geo.instanceCount = n;
    ringFx.mesh.visible = n > 0 && debug.blast;
    if (n > 0) for (const k of ['aRing', 'aRingS', 'aColor']) { rs[k].attr.clearUpdateRanges(); rs[k].attr.addUpdateRange(0, n * 4); rs[k].attr.needsUpdate = true; }
    stats.rings = n;

    // rozbłyski
    n = 0;
    const fs = flashFx.bufs;
    for (let i = flashList.length - 1; i >= 0; i--) {
      const f = flashList[i];
      const age = (clock - f.t0) / f.dur;
      if (age >= 1) { flashList[i] = flashList[flashList.length - 1]; flashList.pop(); continue; }
      if (age < 0) continue;
      const b = n * 4;
      fs.aFlash.arr[b] = f.x; fs.aFlash.arr[b + 1] = -f.y;
      fs.aFlash.arr[b + 2] = f.radius * (0.6 + 0.4 * (1 - Math.pow(1 - age, 3))); fs.aFlash.arr[b + 3] = age;
      fs.aFlashS.arr[b] = f.whiteL; fs.aFlashS.arr[b + 1] = f.bodyL; fs.aFlashS.arr[b + 2] = f.seed; fs.aFlashS.arr[b + 3] = 0;
      bandColor(f.color, 1, fs.aColor.arr, b);
      fs.aColor.arr[b + 3] = 0;
      n++;
    }
    flashFx.geo.instanceCount = n;
    flashFx.mesh.visible = n > 0 && debug.blast;
    if (n > 0) for (const k of ['aFlash', 'aFlashS', 'aColor']) { fs[k].attr.clearUpdateRanges(); fs[k].attr.addUpdateRange(0, n * 4); fs[k].attr.needsUpdate = true; }
    stats.flashes = n;
    return (jetFx.mesh.visible ? 1 : 0) + (orbFx.mesh.visible ? 1 : 0) + (ringFx.mesh.visible ? 1 : 0) + (flashFx.mesh.visible ? 1 : 0);
  }

  // Punkt martwego heksa komory w świecie (pozycja spoczynkowa + bieżący gospodarz).
  function deadChamberPoint(core, out) {
    const n = core.chamber.length;
    if (n === 0) return false;
    for (let tries = 0; tries < 6; tries++) {
      const i = Math.floor(rng() * n);
      if (core.chamberAlive[i]) continue;
      const host = core.host;
      const grid = host.hexGrid;
      const lx = core.chamberGridX[i] - grid.srcWidth * 0.5 - (grid.pivot?.x || 0);
      const ly = core.chamberGridY[i] - grid.srcHeight * 0.5 - (grid.pivot?.y || 0);
      const ang = getEntityHexAngle(host);
      const c = Math.cos(ang), s = Math.sin(ang);
      const sx = host.visual?.spriteScaleX ?? host.visual?.spriteScale ?? 1;
      const sy = host.visual?.spriteScaleY ?? host.visual?.spriteScale ?? 1;
      const px = host.pos ? host.pos.x : host.x;
      const py = host.pos ? host.pos.y : host.y;
      out.x = px + lx * sx * c - ly * sy * s;
      out.y = py + lx * sx * s + ly * sy * c;
      return true;
    }
    return false;
  }

  // hotFrac: część wyrzutów z białą głowicą (jasność coreL), reszta sam dym barwy.
  function emitVents(core, count, speedMul, sizeMul, lifeMul, coreL, hotFrac = 1) {
    const host = core.host;
    const center = getCoreWorld(core, ventCenter);
    const col = coreColor(core);
    const hvx = host.vel ? host.vel.x : (host.vx || 0);
    const hvy = host.vel ? host.vel.y : (host.vy || 0);
    const hexR = 5 * Math.max(host.visual?.spriteScale ?? 1, 0.1);
    const p = ventPoint;
    // Wyrzut tylko z prawdziwej wyrwy komory — bez dziury plazma nie ma którędy wyjść.
    if (core.deadCount <= 0) return;
    for (let k = 0; k < count; k++) {
      if (!deadChamberPoint(core, p)) continue;
      let dx = p.x - center.x;
      let dy = p.y - center.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3) { const a = rng() * Math.PI * 2; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= d; dy /= d; }
      // rozrzut ±40° od kierunku promieniowego
      const jitter = (rng() - 0.5) * 1.4;
      const cj = Math.cos(jitter), sj = Math.sin(jitter);
      const ux = dx * cj - dy * sj;
      const uy = dx * sj + dy * cj;
      const speed = (40 + rng() * 110) * speedMul;
      spawnVent(clock, p.x, p.y, hvx + ux * speed, hvy + uy * speed,
        hexR * (1.2 + rng() * 0.8) * sizeMul, hexR * (3.5 + rng() * 3.0) * sizeMul,
        (0.35 + rng() * 0.5) * lifeMul, col, (coreL > 0 && rng() < hotFrac) ? coreL : 0);
    }
  }

  function heatRim(core, nowSec, value) {
    const host = core.host;
    const grid = host?.hexGrid;
    if (!grid) return;
    const shards = grid.shards;
    // Komora osłabiona BEZ wyrwy (fala z sąsiedniego wybuchu): żaru nie ma
    // którędy zobaczyć, więc grzeje się sama płyta nad reaktorem — jedyny
    // widomy znak KRYTYCZNEGO / STOPIENIA, zanim coś pęknie. Tylko heksy komory
    // (plama wielkości komory), nie sylwetka.
    if (core.deadCount === 0 && (core.state === CORE_STATE.CRITICAL || core.state === CORE_STATE.MELTDOWN)) {
      const v = value * (core.state === CORE_STATE.MELTDOWN ? 1 : 0.7);
      for (let i = 0; i < core.chamber.length; i++) {
        const s = core.chamber[i];
        if (!s || !s.active || s.isDebris) continue;
        const idx = s.__meshIndex;
        if (shards[idx] !== s) continue;
        if (raiseHeat(s, v, nowSec)) {
          markHeatDirty(grid, idx);
          stats.rimHeated++;
        }
      }
      return;
    }
    for (let i = 0; i < core.chamber.length; i++) {
      if (core.chamberAlive[i]) continue;
      const dead = core.chamber[i];
      const nbs = dead.neighbors;
      if (!nbs) continue;
      for (let k = 0; k < nbs.length; k++) {
        const n = nbs[k];
        if (!n || !n.active || n.isDebris) continue;
        const idx = n.__meshIndex;
        if (shards[idx] !== n) continue;
        if (raiseHeat(n, value, nowSec)) {
          markHeatDirty(grid, idx);
          stats.rimHeated++;
        }
      }
    }
  }

  // Pasmo stanu do współdzielonego obiektu `band` (bez alokacji na klatkę).
  function stateBand(core) {
    return coreStateBand(core, band);
  }

  /**
   * Raz na klatkę renderu, przed Core3D.render().
   * @param {Array} cores  runtime rdzeni (shipCore) do pokazania
   * @param {number} nowSec  performance.now()/1000 — baza uTime kadłubów (żar brzegu)
   * @param {number} simDt   krok symulacji tej klatki (0 = pauza: wyrzuty i puls stoją)
   */
  function sync(cores, nowSec, simDt = 1 / 60) {
    clock += Math.max(0, simDt);
    let n = 0;
    const list = Array.isArray(cores) ? cores : [];
    for (const core of list) {
      if (!core || core.invalid || !core.host?.hexGrid || core.host.dead) continue;
      const rank = coreStateRank(core.state);
      if (rank < coreStateRank(CORE_STATE.EXPOSED) || core.state === CORE_STATE.DETONATED) continue;
      stateBand(core);
      let st = perCore.get(core);
      if (!st) { st = { phase: rng() * Math.PI * 2, ventAcc: 0, rimAt: -1, seed: rng() }; perCore.set(core, st); }
      st.phase += Math.PI * 2 * band.pulseHz * Math.max(0, simDt);
      const pulse = 0.5 + 0.5 * Math.sin(st.phase);
      const host = core.host;
      // Rdzeń z modelem reaktora (glowFilter === false): bez żaru, a wyrzuty
      // rzadziej i prawie bez białych głowic — w stopieniu dawały ~90% bieli
      // nad wyrwą i chowały model; światło daje plazma w torusie.
      const modeled = !!glowFilter && glowFilter(core) === false;
      const drawGlow = n < maxGlows && !modeled;
      if (drawGlow) {
        getCoreWorld(core, scratch);
        const scale = Math.max(host.visual?.spriteScaleX ?? host.visual?.spriteScale ?? 1, host.visual?.spriteScaleY ?? host.visual?.spriteScale ?? 1);
        const G = CORE_FX_BANDS.glowGrowth;
        const growth = core.state === CORE_STATE.MELTDOWN
          ? G.meltdownStart + (G.meltdownEnd - G.meltdownStart) * band.prog
          : G.nominal;
        const col = coreColor(core);
        const norm = 1 / Math.max(1e-3, luminance(col));
        const b = n * 4;
        glowCore[b] = scratch.x;
        glowCore[b + 1] = -scratch.y;
        glowCore[b + 2] = core.gridR * scale * growth;
        glowCore[b + 3] = -getEntityHexAngle(host);
        glowColor[b] = col[0] * norm;
        glowColor[b + 1] = col[1] * norm;
        glowColor[b + 2] = col[2] * norm;
        glowColor[b + 3] = st.seed;
        glowState[b] = band.bodyL;
        glowState[b + 1] = band.coreL * (0.92 + 0.08 * pulse);
        glowState[b + 2] = band.coreR;
        glowState[b + 3] = pulse;
        n++;
      }

      if (simDt > 0) {
        // wyrzuty: KRYTYCZNY rzadko, STOPIENIE 8 → 60 na sekundę
        const rate = (core.state === CORE_STATE.MELTDOWN ? 8 + 52 * band.prog * band.prog
          : core.state === CORE_STATE.CRITICAL ? 3 : 0) * (modeled ? 0.6 : 1);
        st.ventAcc += rate * simDt;
        const count = Math.min(24, Math.floor(st.ventAcc));
        if (count > 0) {
          st.ventAcc -= count;
          const meltdown = core.state === CORE_STATE.MELTDOWN;
          emitVents(core, count, meltdown ? 1 + band.prog : 0.6, meltdown ? 1 + band.prog * 0.8 : 0.7, 1,
            meltdown ? CORE_FX_BANDS.ventCoreL : 0, (0.15 + 0.6 * band.prog) * (modeled ? 0.2 : 1));
        }
        if (debug.rim && nowSec - st.rimAt >= 0.1) {
          st.rimAt = nowSec;
          heatRim(core, nowSec, band.rim);
        }
      }
    }
    stats.glows = n;
    glowGeo.instanceCount = n;
    glowMesh.visible = n > 0 && debug.glow;
    if (n > 0) {
      aCore.clearUpdateRanges(); aCore.addUpdateRange(0, n * 4); aCore.needsUpdate = true;
      aColor.clearUpdateRanges(); aColor.addUpdateRange(0, n * 4); aColor.needsUpdate = true;
      aState.clearUpdateRanges(); aState.addUpdateRange(0, n * 4); aState.needsUpdate = true;
    }
    glowMat.uniforms.uTime.value = clock;
    // strumienie, kule i pierścienie PRZED flush — ich iskry idą w tę samą klatkę
    const blastCalls = syncBlastFx(Math.max(0, simDt));
    flushVents(clock);
    stats.drawCalls = (glowMesh.visible ? 1 : 0) + (ventMesh.visible ? 1 : 0) + blastCalls;
    if (markLayerActive && stats.drawCalls > 0) markLayerActive();
  }

  function flushVents(t) {
    if (pool.lo >= 0) {
      const lo = pool.lo;
      const count = pool.hi - lo + 1;
      for (const attr of [vStart, vLife, vColor]) {
        if (attr.updateRanges.length >= 8) attr.clearUpdateRanges();
        else attr.addUpdateRange(lo * 4, count * 4);
        attr.needsUpdate = true;
      }
      pool.lo = -1;
      pool.hi = -1;
    }
    const live = t < pool.liveUntil;
    ventMesh.visible = live && debug.vents;
    if (live) {
      ventMat.uniforms.uTime.value = t;
      ventGeo.instanceCount = pool.highWater;
    } else if (pool.highWater !== 0) {
      pool.highWater = 0;
      pool.cursor = 0;
      ventGeo.instanceCount = 0;
    }
    stats.vents = live ? pool.highWater : 0;
  }

  // Zdarzenia z updateShipCores: pierwsze przebicie, początek stopienia, detonacja.
  function onEvent(ev) {
    const core = ev?.core;
    if (!core || !core.host?.hexGrid) return;
    if (ev.type === 'state' && ev.to === CORE_STATE.EXPOSED) {
      emitVents(core, 6, 0.8, 0.8, 0.8, 0);
    } else if (ev.type === 'state' && ev.to === CORE_STATE.MELTDOWN) {
      emitVents(core, 14, 1.3, 1.1, 1.1, CORE_FX_BANDS.ventCoreL, 0.5);
    } else if (ev.type === 'detonate') {
      emitVents(core, 40, 3.2, 2.2, 1.4, CORE_FX_BANDS.ventCoreL * 1.2, 0.6);
    }
  }

  // Nowa scena (demo): własne listy efektów. Wspólny bank Fx3D zeruje ten,
  // kto go posiada (w grze trzymają w nim też bronie).
  function reset() {
    jetList.length = 0;
    orbList.length = 0;
    ringList.length = 0;
    flashList.length = 0;
    tearList.length = 0;
  }

  function dispose() {
    scene.remove(glowMesh);
    scene.remove(ventMesh);
    glowGeo.dispose(); glowBase.dispose(); glowMat.dispose();
    ventGeo.dispose(); ventBase.dispose(); ventMat.dispose();
    for (const fx of [jetFx, orbFx, ringFx, flashFx]) {
      scene.remove(fx.mesh);
      fx.geo.dispose(); fx.base.dispose(); fx.mat.dispose();
    }
  }

  return {
    sync, onEvent, reset, dispose, stats, debug, layer,
    spawnJet, spawnOrb, spawnRing, flash, heatShards,
    blastSparks, crackSparks, rimSparks, cookOff,
    meshes: { glow: glowMesh, vents: ventMesh, jets: jetFx.mesh, orbs: orbFx.mesh, rings: ringFx.mesh, flashes: flashFx.mesh },
    bands: CORE_FX_BANDS
  };
}
