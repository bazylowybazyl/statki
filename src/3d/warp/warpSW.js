// src/3d/warp/warpSW.js
//
// PRZYLOT I WYLOT „JAK W GWIEZDNYCH WOJNACH” (2026-10-30; user: „a przylot i wylot jak z gwiezdnych wojen? dasz radę?”,
// po obejrzeniu prototypu: „ustaw domyślne”). WYGLĄD DOMYŚLNY — zastępuje decyzję z 2026-10-03 („BEZ portalu i BEZ
// smugi, normalnie widoczny statek”, arrivals.js); dawny wygląd z adresu: `?warpSW=0` (A/B).
//   PRZYLOT NPC  — w wlocie (tAppear → tBrake) kadłub ze światła (biało-błękitny HDR) i smuga za rufą wzdłuż kursu
//                  (~7 L, najwyżej do miejsca pojawienia się); przy hamowaniu ogon dojeżdża do kadłuba (zatrzask
//                  w ≤ 0,2 s), błysk jak dziś; kadłub ze światła gaśnie ~0,25 s po hamowaniu.
//   ODLOT NPC    — od nurkowania (tDive) kadłub ze światła narasta (0,1 s), smuga-ślad za rufą rośnie z prędkością;
//                  w punkcie skoku (tIn) smuga wystrzeliwuje do przodu na ~8 L i gaśnie w 0,35 s, błysk 1 L, kadłub
//                  wchodzi w nią, znikając od dziobu jak domyślnie (linia punktu skoku, szew, żar). Wieże, lampy i plazma
//                  dysz zostają do zniknięcia encji (tGone) — kadłub schowany cały od tIn zostawiał je bez kadłuba
//                  (tGone − tIn = 1,1 L / vEnd ≈ 0,06 s — ~15 klatek przy 240 Hz).
//   GRACZ        — przy kopie smuga za rufą (~6 L, 0,35 s) i mocniejszy szczyt smug gwiazd (1,4 → 2,2); przy hamowaniu
//                  przylotu krótka smuga za rufą zatrzaskująca się w kadłub — w tej samej chwili co reszta akcentów
//                  (PRZYLOT = JEDNO ZDARZENIE, reguła `warp`). Tylko warp (nie hipercruise), tylko kamera z góry jednego
//                  gracza.
// Obraz bez nowych pipeline'ów i pól migawki: smugi to kształt GLOW_STREAK duszków „Nurtu” (sprites.js — ten sam graf
// i rysunek co błyski), kadłub ze światła — szew szerszy niż kadłub w istniejącej gałęzi `hullWarp` (hexShips3D.tsl.js:
// tryb −1 z linią przed dziobem, szew w barwie HDR), osie przylotu i odlotu z rejestru gry (blok migawki `warp`). Rozgrywka
// bez zmian (osie, WARP_RUSH, createWarpDeparture, WARP_EXIT nietknięte). Czyste funkcje obwiedni niżej, wpięcie:
// arrivals.js (NPC), player.js (gracz), warpNurt.js (przełącznik, widoczność encji, rysunek smug).

import { RenderWorld } from '../../render/renderWorld.js';

/** Strojenie (długości w długościach kadłuba L, czasy w s, jasności HDR liniowo). */
export const WARP_SW = Object.freeze({
  light: Object.freeze([0.62, 0.84, 1.0]),   // barwa kadłuba ze światła i smug (biało-błękitna)
  hullHdr: 1.6,              // jasność kadłuba ze światła (szew HDR na całym kadłubie; 3 — przepalony biały kształt przy zoomie 0,13)
  streakHdr: 3.2,            // jasność głowy smugi
  widthK: 0.42,              // szerokość smugi × szerokość kadłuba …
  widthMinL: 0.06,           // … nie mniej niż tyle × L
  widthMaxL: 0.24,           // … i nie więcej
  // przylot NPC
  arriveLen: 7,              // smuga za rufą w wlocie [L] (najwyżej droga od miejsca pojawienia się)
  arriveSnapMax: 0.2,        // zatrzask ogona przy hamowaniu [s] (najwyżej tyle, nie dłużej niż hamowanie)
  arriveLightFade: 0.25,     // kadłub ze światła gaśnie po końcu hamowania [s]
  // odlot NPC
  departRise: 0.1,           // kadłub ze światła narasta od nurkowania [s]
  departTrailTime: 0.12,     // smuga-ślad = prędkość × tyle [s] (najwyżej przebyta droga)
  departShootLen: 8,         // smuga wystrzeliwuje w punkcie skoku do przodu [L]
  departShootRise: 0.08,     // [s]
  departShootTime: 0.35,     // [s] — gaśnie
  departFlashL: 1.0,         // błysk w punkcie skoku [L] (domyślnie 0,5 L)
  // gracz
  kickLen: 6,                // smuga za rufą przy kopie [L]
  kickRise: 0.06,            // [s]
  kickTime: 0.35,            // [s]
  starPeak: 2.2,             // szczyt smug gwiazd przy kopie (domyślny przestrzał 1,4)
  brakeLen: 3,               // smuga za rufą przy hamowaniu przylotu [L]
  brakeSnapMax: 0.2          // zatrzask [s]
});

/** Domyślny szczyt przestrzału smug gwiazd przy kopie (player.js: warpStarStretch). */
const STAR_PEAK_DEFAULT = 1.4;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth01 = (x) => { const u = clamp01(x); return u * u * (3 - 2 * u); };
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };

// ── przełącznik z adresu ────────────────────────────────────────────────────────────────────────────────────────────

/** Wygląd „jak w Gwiezdnych Wojnach” bez przełącznika w adresie (user 2026-10-30: „ustaw domyślne”). */
export const WARP_SW_DEFAULT = true;

/**
 * Adres strony (także w workerze renderu — RenderWorld.pageSearch): `?warpSW=0` — dawny wygląd przylotu i wylotu,
 * `?warpSW=1` — „jak w Gwiezdnych Wojnach”, brak — WARP_SW_DEFAULT.
 */
export function parseWarpSW(search) {
  const s = typeof search === 'string' ? search : '';
  if (/[?&]warpSW=0(?:&|$)/.test(s)) return false;
  if (/[?&]warpSW=1(?:&|$)/.test(s)) return true;
  return WARP_SW_DEFAULT;
}

let _swSearch = null;
let _swOn = WARP_SW_DEFAULT;
let _swForce = null;

/** Wymuszenie (testy, demo): true / false; null — wraca do adresu. */
export function setWarpSW(on) {
  _swForce = on === true || on === false ? on : null;
}

/** Czy wygląd „jak w Gwiezdnych Wojnach” jest włączony (adres strony; zapamiętane do zmiany adresu). */
export function warpSWOn(search = RenderWorld.pageSearch) {
  if (_swForce !== null) return _swForce;
  const s = typeof search === 'string' ? search : '';
  if (s !== _swSearch) {
    _swSearch = s;
    _swOn = parseWarpSW(s);
  }
  return _swOn;
}

// ── obwiednie (czyste funkcje, wynik w `out` — bez alokacji) ───────────────────────────────────────────────────────

/** Nowy rekord wyniku obwiedni (jeden na właściciela — ubiór rekordu warpa, efekt gracza). */
export function newWarpSWState() {
  return { len: 0, k: 0, light: 0, head: 0, gone: false };
}

/** Szerokość smugi [j.] dla kadłuba L × W. */
export function warpSWWidth(L, W) {
  const T = WARP_SW;
  const len = Math.max(40, Number(L) || 0);
  const w = (Number(W) > 0 ? W : len * 0.45) * T.widthK;
  return Math.max(T.widthMinL * len, Math.min(T.widthMaxL * len, w));
}

/**
 * PRZYLOT NPC w chwili t (oś `a` z rejestru gry: tAppear, tBrake, brake, tStop, hullLength), `along` — droga od miejsca
 * pojawienia się [j.]. Wynik: len — smuga za rufą [j.], k — jej jasność 0..1, light — kadłub ze światła 0..1.
 * Wlot: pełna smuga (≤ arriveLen · L, ≤ droga), kadłub ze światła. Hamowanie: ogon dojeżdża do kadłuba w ≤ arriveSnapMax
 * (nie dłużej niż hamowanie). Po końcu hamowania kadłub ze światła gaśnie w arriveLightFade.
 */
export function warpSWArrival(a, t, along, out) {
  const T = WARP_SW;
  out.len = 0; out.k = 0; out.light = 0; out.head = 0; out.gone = false;
  if (!a || !(t >= a.tAppear)) return out;
  const L = Math.max(40, Number(a.hullLength) || 0);
  const len0 = Math.min(T.arriveLen * L, Math.max(0, Number(along) || 0));
  const tb = t - a.tBrake;
  if (!(tb >= 0)) {               // wlot (także warp-in prowadzony przez grę przed hamowaniem: tBrake = ∞)
    out.len = len0;
    out.k = len0 > 0 ? 1 : 0;
    out.light = 1;
    return out;
  }
  const brake = Number(a.brake) > 0 ? a.brake : T.arriveSnapMax;
  const snap = Math.max(0.03, Math.min(T.arriveSnapMax, brake));
  const keep = 1 - smooth01(tb / snap);
  out.len = len0 * keep;
  out.k = keep;
  const tStop = Number.isFinite(a.tStop) ? a.tStop : a.tBrake + brake;
  const ts = t - tStop;
  out.light = ts <= 0 ? 1 : 1 - smooth01(ts / T.arriveLightFade);
  return out;
}

/**
 * ODLOT NPC w chwili t (oś `d`: tDive, tIn, hullLength), `s` — próbka osi (sampleWarpDeparture: dist, speed).
 * Wynik: przed punktem skoku — len = smuga-ślad za rufą [j.] (prędkość × departTrailTime, ≤ przebyta droga), k, light
 * (narasta od nurkowania w departRise); od punktu skoku (gone = true — bez światła kadłuba: kadłub znika od dziobu
 * domyślnym odsłanianiem) — smuga wystrzeliwuje do przodu: head = głowa przed punktem skoku [j.], len = długość od głowy
 * wstecz [j.], k gaśnie w departShootTime.
 */
export function warpSWDeparture(d, t, s, out) {
  const T = WARP_SW;
  out.len = 0; out.k = 0; out.light = 0; out.head = 0; out.gone = false;
  if (!d || !(t >= d.tDive)) return out;
  const L = Math.max(40, Number(d.hullLength) || 0);
  const ti = t - d.tIn;
  if (!(ti >= 0)) {
    const light = smooth01((t - d.tDive) / T.departRise);
    const dist = Math.max(0, Number(s && s.dist) || 0);
    const speed = Math.max(0, Number(s && s.speed) || 0);
    out.light = light;
    out.len = Math.min(dist, speed * T.departTrailTime);
    out.k = out.len > 0 ? light : 0;
    return out;
  }
  out.gone = true;
  if (ti >= T.departShootTime) return out;
  // ślad z chwili wejścia w punkt skoku (prędkość końcowa × departTrailTime) przechodzi w smugę wystrzeloną do przodu
  const trail0 = Math.min(Math.max(0, Number(d.rushDist) || 0), Math.max(0, Number(d.vEnd) || 0) * T.departTrailTime);
  const up = easeOut3(ti / T.departShootRise);
  const fade = 1 - ti / T.departShootTime;
  out.head = T.departShootLen * L * up;
  out.len = out.head + trail0 * (1 - up);
  out.k = fade * fade;
  return out;
}

/** GRACZ — kop: smuga za rufą [× L] narasta w kickRise i gaśnie do kickTime. age — czas od kopu [s]. */
export function warpSWKick(age, out) {
  const T = WARP_SW;
  out.len = 0; out.k = 0; out.light = 0; out.head = 0; out.gone = false;
  if (!(age >= 0) || age >= T.kickTime) return out;
  const f = 1 - age / T.kickTime;
  out.len = T.kickLen * easeOut3(age / T.kickRise);
  out.k = f * f;
  return out;
}

/** GRACZ — hamowanie przylotu: smuga za rufą [× L] zatrzaskuje się w kadłub (≤ brakeSnapMax, ≤ hamowanie). tb — od początku hamowania. */
export function warpSWBrake(tb, brake, out) {
  const T = WARP_SW;
  out.len = 0; out.k = 0; out.light = 0; out.head = 0; out.gone = false;
  if (!(tb >= 0)) return out;
  const snap = Math.max(0.03, Math.min(T.brakeSnapMax, Number(brake) > 0 ? brake : T.brakeSnapMax));
  if (tb >= snap) return out;
  const keep = 1 - smooth01(tb / snap);
  out.len = T.brakeLen * keep;
  out.k = keep;
  return out;
}

/**
 * GRACZ — mnożnik smug gwiazd przy kopie: 1 poza oknem przestrzału, na szczycie przestrzału starPeak / 1,4 (ten sam
 * kształt co przestrzał warpStarStretch: narasta w 0,12 s, wraca do lotu do 0,55 s). k — czas od kopu [s].
 */
export function warpSWStarGain(k) {
  if (!(k >= 0) || k >= 0.55) return 1;
  const bump = k < 0.12 ? easeOut3(k / 0.12) : 1 - smooth01((k - 0.12) / 0.43);
  return 1 + (WARP_SW.starPeak / STAR_PEAK_DEFAULT - 1) * bump;
}

/**
 * Kadłub ze światła w rekordzie kadłuba efektu (`hull` — pola jak WarpPlayerFx.hull / ubiór rekordu warpa, czyta je
 * warpNurt._applyHull) BEZ zmiany WGSL: gałąź `hullWarp` (hexShips3D.tsl.js) w trybie −1 z linią daleko przed dziobem
 * (cały kadłub widoczny) i szwem szerszym niż kadłub (exp(−(x / szerokość)²) ≈ 1 na całej długości) w barwie HDR —
 * kadłub dostaje światło addytywnie (żar brzegu z rekordu zostaje). k — siła 0..1.
 */
export function warpSWHullLight(hull, L, k) {
  const len = Math.max(40, Number(L) || 0);
  const T = WARP_SW;
  hull.on = true;
  hull.revealMode = -1;
  hull.revealLine = len * 1000;
  hull.seamLine = 0;
  hull.seamW = len * 60;
  hull.seam = clamp01(k);
  const c = T.light;
  hull.seamRGB[0] = c[0] * T.hullHdr;
  hull.seamRGB[1] = c[1] * T.hullHdr;
  hull.seamRGB[2] = c[2] * T.hullHdr;
  return hull;
}

/**
 * Smuga w klatce efektu (frame.addStreak — odcinanie do kadru): głowa (hx, hy) względem kamery (świat gry, y w dół),
 * kierunek (dx, dy) — smuga ciągnie się `len` [j.] WSTECZ od głowy; k — jasność 0..1 (× WARP_SW.streakHdr).
 */
export function addWarpSWStreak(frame, hx, hy, dx, dy, len, width, k) {
  if (!frame || !(len > 0) || !(k > 0.001)) return false;
  const c = WARP_SW.light;
  const h = WARP_SW.streakHdr * k;
  return frame.addStreak(hx, hy, dx, dy, len, width, c[0] * h, c[1] * h, c[2] * h);
}
