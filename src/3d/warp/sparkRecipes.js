// src/3d/warp/sparkRecipes.js
//
// DROBINY PRZYLOTU I ODLOTU NPC — receptury (czysty moduł, bez three: testy w Node). Decyzja użytkownika 2026-11-08
// („niepotrzebnie można dotykać i wpływać na cząstki z warp”, „wolałbym dać więcej cząsteczek, ale niewrażliwych”,
// „w misji pirackiej z 5 statków widzę efekt na jednym”): drobiny przylotu nie są już wzbudzeniem wspólnego ośrodka
// (medium.js — milion drobin, które pchały bańki, nici zwiastunów i zoom kamery), tylko WŁASNYMI drobinami każdego
// okrętu. Każda drobina ma tor ze wzoru (hasz indeksu + parametry rekordu + wiek), więc nic jej nie popycha: ani inny
// okręt, ani nić sąsiada, ani kamera. Rysuje je jedna siatka (sparks.js: WarpSparks), bez compute.
//
// REKORD (frame.addSparks — pula klatki, frame.js) to jedna „emisja”:
//   mode 0 (SHED) — drobiny rodzą się wzdłuż odcinka od (x, y) w kierunku (dirX, dirY): narodziny w odległości
//     dist · h^shape (h — hasz) w chwili T · (droga / dist)^p (+ rozrzut jit), punkt narodzin cofnięty o `back` i rozsiany
//     w poprzek o ±W; prędkość początkowa — kąt `ang` od kursu ± `cone` (cone < 0 — po obu stronach osi), udział `ring`
//     w pełnym kole, szybkość v0…v1, plus carry · (dist / T) wzdłuż kursu; opór τ = drag; życie life0…life1. Ślad
//     wlotu (narodziny w przejściu rufy), snop hamowania i błysk punktu skoku (dist = 0 — wszystkie w jednym punkcie).
//   mode 1 (INFLOW) — drobiny w pętli (okres life0…life1) spływają do punktu (x, y): prosto z odcinka za nim (dist wzdłuż
//     −kurs, ±W w poprzek — zbiegają do osi) albo po spirali z koła o promieniu R (udział `ring`, `swirl` obrotów). Nić zwiastuna i punkt
//     zbierania odlotu; jasność prowadzi `gain` z osi (CPU co klatkę).
// Pozycje rekordu w świecie gry WZGLĘDEM KAMERY (y w dół — jak reszta klatki „Nurtu”), wiek w sekundach osi rejestru
// ruchu warpa gry (ten sam zegar co poza okrętu — drobiny nie jadą względem kadłuba).
//
// Przełącznik z adresu: `?warpDrobiny=0` — dawny wygląd (przegródki ośrodka dla przylotów i odlotów NPC, bez drobin).

import { RenderWorld } from '../../render/renderWorld.js';

/** Strojenie (L — długość kadłuba [j.], prędkości w j/s, czasy w s, barwy liniowe HDR). */
export const WARP_SPARKS = Object.freeze({
  // barwy ośrodka „Nurtu” (medium.js: colCyan / colAmber / colHot) — turkus przed dziobem i w nici, pomarańczowy warkocz za
  // rufą, biel świeżego pchnięcia; wspólne dla wszystkich palet (jak dawny ośrodek)
  cyan: Object.freeze([0.14, 0.7, 1.0]),
  amber: Object.freeze([1.0, 0.36, 0.07]),
  hot: Object.freeze([0.8, 0.92, 1.0]),
  sizeL: 0.004,          // pół-szerokość smugi drobiny w świecie [× L] (najmniej minPx na ekranie — sparks.js)
  // nić zwiastuna: drobiny spływają wzdłuż kursu do miejsca zatrzymania
  heraldLenL: 16,        // długość nici [L] (najwyżej zasięg nici z osi)
  heraldWidthL: 0.12,    // rozrzut w poprzek na początku nici [± L] (zbiega do osi)
  heraldRingL: 0.8,      // koło zbierania wokół punktu [L]
  heraldRing: 0.3,       // udział drobin z koła
  heraldSwirl: 0.4,      // obrotów zawirowania koła w drodze do punktu (nić płynie prosto)
  heraldLife: Object.freeze([0.7, 1.3]),
  heraldGain: 0.75,
  heraldFrac: 0.55,
  // ślad wlotu: drobiny zostają za rufą i rozchodzą się na boki
  trailShape: 0.45,      // rozkład narodzin wzdłuż drogi (h^0,45 — gęściej przy hamowaniu)
  trailSpeedL: Object.freeze([0.5, 3.2]),   // [L/s] na boki
  trailCone: 0.9,        // ±rad wokół prostopadłej (po obu stronach)
  trailRing: 0.12,
  trailCarry: 0.05,      // część prędkości okrętu niesiona do przodu
  trailDrag: 0.45,
  trailLife: Object.freeze([0.35, 1.0]),
  trailGain: 1.9,
  // snop hamowania: ośrodek przed dziobem leci dalej siłą bezwładności
  brakeJetK: 0.55,       // szybkość snopu × prędkość wlotu …
  brakeJetMin: 5200,     // … nie mniej niż tyle × skala kadłuba
  brakeSpeed: Object.freeze([0.18, 1.0]),   // × szybkość snopu
  brakeCone: 0.22,
  brakeRing: 0.28,
  brakeRingK: 0.22,      // szybkość koła × szybkość snopu (koło drobin wokół dziobu)
  brakeDrag: 0.16,
  brakeJit: 0.05,
  brakeLife: Object.freeze([0.35, 1.05]),
  brakeGain: 2.4,
  brakeFrac: 0.6,
  // odlot: punkt zbierania (ładowanie), ślad rozpędu, błysk w punkcie skoku
  gatherRingL: Object.freeze([0.5, 1.4]),   // promień koła [L] przy build 0 → 1
  gatherSwirl: 0.6,
  gatherLife: Object.freeze([0.55, 1.05]),
  gatherGain: 1.4,
  gatherFrac: 0.5,
  wakeSpeedL: Object.freeze([0.4, 2.6]),
  wakeAng: 2.2,          // kąt od kursu (ku rufie, po obu stronach)
  wakeCone: 0.55,
  wakeDrag: 0.4,
  // życie drobin odlotu ≤ zapasu osi po zniknięciu (WARP_DEPARTURE_BASE: close + tail = 0,65 s — potem rekord znika)
  wakeLife: Object.freeze([0.25, 0.6]),
  wakeGain: 1.7,
  goneSpeedK: 0.45,      // × prędkość końcowa rozpędu
  goneCone: 0.22,
  goneRing: 0.3,
  goneDrag: 0.14,
  goneLife: Object.freeze([0.25, 0.6]),
  goneGain: 2.8,
  goneFrac: 0.6
});

// ── przełącznik z adresu ────────────────────────────────────────────────────────────────────────────────────────────

/** Adres strony: `?warpDrobiny=0` — dawny wygląd (ośrodek „Nurtu” dla przylotów i odlotów NPC), inaczej drobiny. */
export function parseWarpSparks(search) {
  const s = typeof search === 'string' ? search : '';
  return !/[?&]warpDrobiny=0(?:&|$)/.test(s);
}

let _search = null;
let _on = true;
let _force = null;

/** Wymuszenie (testy, demo): true / false; null — wraca do adresu. */
export function setWarpSparks(on) {
  _force = on === true || on === false ? on : null;
}

/** Czy przyloty i odloty NPC mają drobiny (a nie przegródki ośrodka) — adres strony, zapamiętany do zmiany. */
export function warpSparksOn(search = RenderWorld.pageSearch) {
  if (_force !== null) return _force;
  const s = typeof search === 'string' ? search : '';
  if (s !== _search) {
    _search = s;
    _on = parseWarpSparks(s);
  }
  return _on;
}

// ── rekord ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nowy rekord emisji (pula klatki — frame.js). */
export function newSparkRecord() {
  return {
    mode: 0, x: 0, y: 0, dirX: 1, dirY: 0, age: 0,
    dist: 0, cap: 0, T: 1, p: 1, back: 0, W: 0, shape: 1,
    v0: 0, v1: 0, drag: 0.3, carry: 0, ang: 0, cone: 0, ring: 0, jit: 0,
    R: 0, swirl: 0, life0: 0.5, life1: 1, frac: 1, seed: 0,
    gain: 0, c0: [1, 1, 1], c1: [1, 1, 1], size: 1,
    reach: 0
  };
}

/** Wyzerowanie pól ruchu (receptura ustawia tylko swoje). */
function begin(frame, mode, x, y, dirX, dirY, age, seed) {
  const r = frame.addSparks();
  if (!r) return null;
  r.mode = mode; r.x = x; r.y = y; r.dirX = dirX; r.dirY = dirY; r.age = age;
  r.dist = 0; r.cap = 0; r.T = 1; r.p = 1; r.back = 0; r.W = 0; r.shape = 1;
  r.v0 = 0; r.v1 = 0; r.drag = 0.3; r.carry = 0; r.ang = 0; r.cone = 0; r.ring = 0; r.jit = 0;
  r.R = 0; r.swirl = 0; r.frac = 1; r.seed = seed;
  return r;
}

function setColors(r, a, ka, b, kb) {
  r.c0[0] = a[0] * ka; r.c0[1] = a[1] * ka; r.c0[2] = a[2] * ka;
  r.c1[0] = b[0] * kb; r.c1[1] = b[1] * kb; r.c1[2] = b[2] * kb;
}

/** Najdłuższa droga drobiny SHED z oporem: v · τ (dla v1 i carry). */
function shedReach(r) {
  const vmax = Math.max(r.v1, r.v0) + Math.abs(r.carry) * (r.T > 0 ? r.dist / r.T : 0);
  return r.dist + r.back + r.W + vmax * r.drag;
}

// ── przylot ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Nić zwiastuna: drobiny spływają wzdłuż kursu do miejsca zatrzymania (a.sx, a.sy), część z koła wokół niego.
 * k — siła zwiastuna 0..1 (oś: s.herald) × widoczność encji. Zwraca rekord albo null.
 */
export function sparksArrivalHerald(frame, a, t, k, camX, camY, seed) {
  if (!(k > 0.002)) return null;
  const T = WARP_SPARKS;
  const L = a.hullLength;
  const r = begin(frame, 1, a.sx - camX, a.sy - camY, a.dirX, a.dirY, t - a.t0, seed);
  if (!r) return null;
  const reach = Number(a.heraldReach) > 0 ? a.heraldReach : T.heraldLenL * L;
  r.dist = Math.min(reach, T.heraldLenL * L);
  r.W = T.heraldWidthL * L;
  r.R = T.heraldRingL * L;
  r.ring = T.heraldRing;
  r.swirl = T.heraldSwirl;
  r.life0 = T.heraldLife[0];
  r.life1 = T.heraldLife[1];
  r.frac = T.heraldFrac;
  r.gain = T.heraldGain * k;
  setColors(r, T.hot, 1.4, T.cyan, 1.3);
  r.size = T.sizeL * L;
  r.reach = r.dist + r.R + r.W;
  return r;
}

/**
 * Ślad wlotu: drobiny rodzą się za rufą w chwili przejścia okrętu (od miejsca pojawienia się do początku hamowania) i
 * rozchodzą się na boki. Start (x0, y0) i prędkość V stałe przez wlot; `cap` — droga do początku hamowania (∞, gdy
 * jeszcze nieznany: warp-in prowadzony przez grę), `dist` — skala rozkładu narodzin. vis — widoczność encji.
 */
export function sparksArrivalTrail(frame, a, t, x0, y0, V, dist, cap, vis, camX, camY, seed) {
  if (!(vis > 0.002) || !(t >= a.tAppear) || !(V > 1) || !(dist > 1)) return null;
  const T = WARP_SPARKS;
  const L = a.hullLength;
  const age = t - a.tAppear;
  // po ostatnich narodzinach (początek hamowania) + najdłuższe życie — koniec emisji
  const lastBirth = Math.min(dist, cap) / V;
  if (age > lastBirth + T.trailLife[1] + 0.05) return null;
  const r = begin(frame, 0, x0 - camX, y0 - camY, a.dirX, a.dirY, age, seed);
  if (!r) return null;
  r.dist = dist;
  r.cap = Number.isFinite(cap) ? cap : 1e9;
  r.T = dist / V;
  r.p = 1;
  r.shape = T.trailShape;
  r.back = L * 0.45;
  r.W = Math.max(8, Number(a.hullWidth) || L * 0.45) * 0.45;
  r.v0 = T.trailSpeedL[0] * L;
  r.v1 = T.trailSpeedL[1] * L;
  r.ang = Math.PI * 0.5;
  r.cone = -T.trailCone;          // < 0 — po obu stronach osi
  r.ring = T.trailRing;
  r.carry = T.trailCarry;
  r.drag = T.trailDrag;
  r.jit = 0.02;
  r.life0 = T.trailLife[0];
  r.life1 = T.trailLife[1];
  r.frac = 1;
  r.gain = T.trailGain * vis;
  setColors(r, T.cyan, 1.4, T.amber, 1.2);
  r.size = T.sizeL * L;
  r.reach = shedReach(r);
  return r;
}

/**
 * Snop hamowania: w chwili początku hamowania ośrodek przed dziobem leci dalej (iskry w stożku do przodu, część
 * w kole wokół dziobu). (bx, by) — dziób na końcu hamowania. vis — widoczność encji.
 */
export function sparksArrivalBrake(frame, a, t, bx, by, vis, camX, camY, seed) {
  const tb = t - a.tBrake;
  const T = WARP_SPARKS;
  if (!(vis > 0.002) || !(tb >= 0) || tb > T.brakeLife[1] + T.brakeJit + 0.05) return null;
  const L = a.hullLength;
  const r = begin(frame, 0, bx - camX, by - camY, a.dirX, a.dirY, tb, seed);
  if (!r) return null;
  const jet = Math.max(T.brakeJetMin * (Number(a.sizeScale) || 1), (Number(a.v0) || 0) * T.brakeJetK);
  r.W = Math.max(8, Number(a.hullWidth) || L * 0.45) * 0.25;
  r.v0 = jet * T.brakeSpeed[0];
  r.v1 = jet * T.brakeSpeed[1];
  r.ang = 0;
  r.cone = T.brakeCone;
  r.ring = T.brakeRing;
  r.R = T.brakeRingK;             // SHED: R — mnożnik szybkości drobin koła
  r.drag = T.brakeDrag;
  r.jit = T.brakeJit;
  r.life0 = T.brakeLife[0];
  r.life1 = T.brakeLife[1];
  r.frac = T.brakeFrac;
  r.gain = T.brakeGain * vis;
  setColors(r, T.hot, 1.7, T.cyan, 1.1);
  r.size = T.sizeL * L * 1.2;
  r.reach = shedReach(r);
  return r;
}

// ── odlot ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Punkt skoku w ładowaniu: drobiny zbierane po spirali (siła build × widoczność). */
export function sparksDepartGather(frame, d, t, k, build, camX, camY, seed) {
  if (!(k > 0.002)) return null;
  const T = WARP_SPARKS;
  const L = d.hullLength;
  const r = begin(frame, 1, d.cx - camX, d.cy - camY, d.dirX, d.dirY, t - d.t0, seed);
  if (!r) return null;
  r.dist = 0;
  r.W = 0;
  r.R = L * (T.gatherRingL[0] + (T.gatherRingL[1] - T.gatherRingL[0]) * Math.max(0, Math.min(1, build)));
  r.ring = 1;
  r.swirl = T.gatherSwirl;
  r.life0 = T.gatherLife[0];
  r.life1 = T.gatherLife[1];
  r.frac = T.gatherFrac;
  r.gain = T.gatherGain * k;
  setColors(r, T.hot, 1.4, T.cyan, 1.3);
  r.size = T.sizeL * L;
  r.reach = r.R * 1.1;
  return r;
}

/** Ślad rozpędu odlotu: drobiny za rufą w chwili przejścia (droga ∝ t³ do punktu skoku), rozchodzą się ku rufie. */
export function sparksDepartWake(frame, d, t, vis, camX, camY, seed) {
  const T = WARP_SPARKS;
  const age = t - d.tDive;
  if (!(vis > 0.002) || !(age >= 0) || age > d.accel + T.wakeLife[1] + 0.05) return null;
  const L = d.hullLength;
  const r = begin(frame, 0, d.x - camX, d.y - camY, d.dirX, d.dirY, age, seed);
  if (!r) return null;
  r.dist = d.rushDist;
  r.cap = d.rushDist;
  r.T = d.accel;
  r.p = 1 / 3;                    // droga D · (τ / accel)³ → narodziny w τ = accel · (s / D)^(1/3)
  r.shape = 0.6;
  r.back = L * 0.45;
  r.W = Math.max(8, Number(d.hullWidth) || L * 0.45) * 0.45;
  r.v0 = T.wakeSpeedL[0] * L;
  r.v1 = T.wakeSpeedL[1] * L;
  r.ang = T.wakeAng;
  r.cone = -T.wakeCone;
  r.ring = 0.08;
  r.drag = T.wakeDrag;
  r.jit = 0.02;
  r.life0 = T.wakeLife[0];
  r.life1 = T.wakeLife[1];
  r.frac = 1;
  r.gain = T.wakeGain * vis;
  setColors(r, T.cyan, 1.4, T.amber, 1.2);
  r.size = T.sizeL * L;
  r.reach = shedReach(r);
  return r;
}

/** Błysk punktu skoku: drobiny wystrzelone do przodu z punktu, w którym okręt znika. */
export function sparksDepartGone(frame, d, t, vis, camX, camY, seed) {
  const T = WARP_SPARKS;
  const ti = t - d.tGone;
  if (!(vis > 0.002) || !(ti >= 0) || ti > T.goneLife[1] + 0.1) return null;
  const L = d.hullLength;
  const r = begin(frame, 0, d.cx - camX, d.cy - camY, d.dirX, d.dirY, ti, seed);
  if (!r) return null;
  const v = Math.max(T.brakeJetMin * (Number(d.sizeScale) || 1), (Number(d.vEnd) || 0) * T.goneSpeedK);
  r.W = Math.max(8, Number(d.hullWidth) || L * 0.45) * 0.3;
  r.v0 = v * 0.15;
  r.v1 = v;
  r.ang = 0;
  r.cone = T.goneCone;
  r.ring = T.goneRing;
  r.R = 0.25;
  r.drag = T.goneDrag;
  r.jit = 0.04;
  r.life0 = T.goneLife[0];
  r.life1 = T.goneLife[1];
  r.frac = T.goneFrac;
  r.gain = T.goneGain * vis;
  setColors(r, T.hot, 1.6, T.cyan, 1.1);
  r.size = T.sizeL * L * 1.2;
  r.reach = shedReach(r);
  return r;
}

// ── lustro CPU toru drobiny (testy; ten sam wzór co shader sparks.js) ─────────────────────────────────────────────────

/**
 * Położenie drobiny rekordu w wieku rekordu `age` dla haszy h[0..7] (0..1): { x, y, alive, k } — k: jasność 0..1 kształtu
 * (bez gain). Kolejność i znaczenie haszy jak w shaderze (sparks.js). Pozycje w układzie rekordu (świat, y w dół).
 */
export function sparkPositionCpu(r, h, age, out = {}) {
  const dx = r.dirX;
  const dy = r.dirY;
  const px = -dy;
  const py = dx;
  if (r.mode === 1) {
    const period = r.life0 + (r.life1 - r.life0) * h[2];
    const u = fract(age / period + h[0]);
    const inRing = h[4] < r.ring;
    const th = h[5] * Math.PI * 2;
    const rr = r.R * (0.6 + 0.4 * h[3]);
    const sx = inRing ? Math.cos(th) * rr : -dx * r.dist * h[1] + px * (h[3] - 0.5) * 2 * r.W;
    const sy = inRing ? Math.sin(th) * rr : -dy * r.dist * h[1] + py * (h[3] - 0.5) * 2 * r.W;
    const ang = inRing ? r.swirl * u * Math.PI * 2 : 0;   // zawirowanie tylko koła — nić płynie prosto
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    out.x = r.x + (sx * c - sy * s) * (1 - u);
    out.y = r.y + (sx * s + sy * c) * (1 - u);
    out.alive = true;
    out.k = smoothstepJs(0, 0.15, u) * (1 - smoothstepJs(0.85, 1, u)) * (0.35 + 0.65 * u);
    return out;
  }
  const along = r.dist * Math.pow(h[0], r.shape);
  const tb = r.T * Math.pow(r.dist > 0 ? along / r.dist : 0, r.p) + h[1] * r.jit;
  const a = age - tb;
  const life = r.life0 + (r.life1 - r.life0) * h[2];
  out.alive = a >= 0 && a < life && along <= (r.dist > 0 ? r.cap : 1e9) + 1e-6;
  const inRing = h[4] < r.ring;
  const both = r.cone < 0;
  const cone = Math.abs(r.cone);
  const side = both && h[6] < 0.5 ? -1 : 1;
  const th = inRing ? h[5] * Math.PI * 2 : r.ang * side + (h[5] * 2 - 1) * cone;
  const spd = (r.v0 + (r.v1 - r.v0) * h[7] * h[7]) * (inRing && r.R > 0 ? r.R : 1);
  const vx = (dx * Math.cos(th) - dy * Math.sin(th)) * spd + dx * r.carry * (r.T > 0 ? r.dist / r.T : 0);
  const vy = (dx * Math.sin(th) + dy * Math.cos(th)) * spd + dy * r.carry * (r.T > 0 ? r.dist / r.T : 0);
  const aa = Math.max(0, a);
  const k = r.drag * (1 - Math.exp(-aa / r.drag));
  out.x = r.x + dx * (along - r.back) + px * (h[3] - 0.5) * 2 * r.W + vx * k;
  out.y = r.y + dy * (along - r.back) + py * (h[3] - 0.5) * 2 * r.W + vy * k;
  const q = Math.max(0, Math.min(1, a / life));
  out.k = out.alive ? smoothstepJs(0, 0.04, aa) * (1 - q) * (1 - q) : 0;
  return out;
}

function fract(x) { return x - Math.floor(x); }
function smoothstepJs(e0, e1, x) {
  const u = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return u * u * (3 - 2 * u);
}
