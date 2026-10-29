// src/3d/warp/warpEdgeFx.js
//
// BOKI KADRU W SKOKU GRACZA (2026-10-29; prośba użytkownika: „dodanie efektów haze lub cząsteczkowych do warpa … haze,
// ale mocniejszym po bokach ekranu, a nie na statku”; propozycje, zrzuty i decyzje — docs/PROPOZYCJA-efekty-warpa-2026-10-29.md).
// PRZEPŁYW RÓWNOLEGŁY DO KURSU (druga wersja, ocena użytkownika po pierwszej: „mamy 2D statek, który leci do góry, i wszystkie
// próby efektów zrobiły 3D … statek leci do góry, a wszystkie efekty są stworzone tak, jakby leciał w głąb ekranu”): widok
// z góry — świat przelatuje pod statkiem z góry na dół kadru, więc efekty płyną PRZECIWNIE do kursu w osiach ekranu (kurs gry
// obrócony o obrót kadru; przy kadrze „kurs w górę” — pion w dół, przy kadrze „Północ” — skośnie wzdłuż kursu). Bez
// współrzędnych biegunowych, bez punktu zbiegu i bez zależności od mapy O1 soczewki (jej pochylenie `hf` zmienia przełącznik
// `?warpSoczewka=` — efekty go nie czytają). Środek kadru — kolumna wzdłuż osi kursu przez statek — zostaje czysty.
//   W1 HAZE PĘDU     — warstwa DIST (FX_DISTORT_LAYER, cel Core3D.distortionTarget): pełnoekranowy quad pisze przesunięcie
//                      [px bufora, osie ekranu: x w prawo, y w górę; B = A = 0 — B / A należą do maskowania]: pasma refrakcji
//                      przy lewej i prawej krawędzi — szum tile2D (fxNoise — ta sama tekstura co broń) wydłużony wzdłuż kursu
//                      (× 7), płynący w dół; przesunięcie głównie w poprzek kursu (drżenie boczne), mniejsze wzdłuż;
//                      dwie oktawy, każda z własną fazą i limitem aliasingu (przesuw ≤ ¼ komórki na klatkę przy 60 kl/s).
//                      GŁADKO: duże komórki w poprzek (0,2 / 0,08 H) i poziom mip o 3 ponad 1 texel / px gaszą drobne oktawy
//                      fbm tekstury — stromy gradient przesunięcia w poprzek (≥ 1 = fałda obrazu) rozmazywał gwiazdy w poziome
//                      kreski i podwajał je („deszcz na szybie”); lustro CPU w teście pilnuje braku fałd.
//                      Aberracja R / B dochodzi w poście sama (≤ 2,5 px — postGry.js: LAYER_ABER_MAX_PX).
//   W2 DROBINY PĘDU  — jedna siatka (InstancedBufferGeometry, ~1800 instancji, sam kwad), pozycje ANALITYCZNE z haszu
//                      instancji i faz warstw: smugi równoległe do kursu w TRZECH warstwach paralaksy (daleka — krótkie,
//                      wolne, ciemne; średnia; bliska — długie, szybkie, jaśniejsze), gęściej przy bokach, zawijane wzdłuż
//                      kursu poza kadrem; smuga nie krótsza niż przesuw na klatkę (bez stroboskopu). Pass tła (warstwa 1),
//                      głębia przy dalekiej płaszczyźnie — pod planetami, ringiem, stacjami i kadłubami.
//   W3 ZORZA KRAWĘDZI — dwa pasy przy lewej i prawej krawędzi kadru (geometria tylko przy krawędziach): słaba addytywna
//                      poświata w barwie palety warpa, długie pasma dryfujące w dół; pass tła.
// MASKA BOKÓW (wspólna, lustro CPU warpEdgeSideMask): 0 w kolumnie wzdłuż osi kursu przez statek (pół szerokości z szerokości
// kadłuba na ekranie i szerokości kadru — warpEdgeLayout), rośnie ku krawędzi kadru po tej stronie osi; przy wyjściu FRONT
// prostopadły do kursu (ten sam co smug gwiazd i soczewki — warpLensPhase.js: warpExitFrontS) jedzie od dziobu ku rufie,
// za nim efekty gasną.
// FAZY CAŁKOWANE NA CPU (warpEdgePhaseStep: faza += prędkość · dt czasu efektu, zawijana) — do shadera jako uniformy, NIE
// czas × prędkość w shaderze (przy zmianie prędkości wzór „gotował się” klatka w klatkę — lekcja z hipercruise'u).
// OBWIEDNIA (czysta funkcja warpEdgeEnvelope): ładowanie — rozruch od 0, słabo; KOP — krótki impuls × 2 (siła i przepływ, bez
// pierścieni); LOT — stała × prędkość widoczna (przy mijanym ciele statek zwalnia — przepływ i siła z nim); WYJŚCIE — front;
// po zatrzymaniu 0. Tylko warp gracza (hipercruise — 0), tylko kamera z góry jednego gracza (sterownik: `o.lensAllowed`), czas —
// zegar efektu WarpNurt.time (stoi w pauzie).
//
// Sterownik (warpNurt.js) tworzy moduł w init i woła update na końcu klatki „Nurtu”; warstwę DIST zgłasza krok efektów
// Core3D „warp: boki kadru” (flagę kasuje klatka efektów na starcie — zgłoszenie z WarpNurt.update by przepadło).
// Render w workerze: bez window, GameState, DOM i Math.random (adres strony — RenderWorld.pageSearch, losowość — hasz
// instancji na GPU). Graf węzłów RAZ na materiał (wartości klatki w uniformach), bez alokacji w update.
// Strojenie na żywo: `WarpEdgeFxTune` (eksport; w trybie off także window.WarpNurt.edge.tune).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec4, uniform, texture, attribute, varyingProperty, instanceIndex, screenCoordinate, screenSize,
  exp, sqrt, dot, abs, max, min, clamp, mix, smoothstep, fract, step, hash, If
} from 'three/tsl';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { fxNoise } from '../fx/noise.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { RenderWorld } from '../../render/renderWorld.js';
import { warpExitFrontS, warpLensExitSlow } from '../../render/warpLensPhase.js';
import { warpPalette } from './palette.js';
import { WARP_FLOW } from './player.js';

// ── przełącznik z adresu ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Zestaw DOMYŚLNY (bez `?warpFx=` w adresie) — wybór po zrzutach (docs/PROPOZYCJA-efekty-warpa-2026-10-29.md): haze boków
 * i drobiny pędu; zorza krawędzi tylko z adresu (`?warpFx=zorza` / `wszystko`).
 */
export const WARP_EDGE_FX_DEFAULT = Object.freeze({ haze: true, czastki: true, zorza: false });

const OFF_WORDS = new Set(['0', 'off', 'nie', 'brak', 'false', 'wyl', 'wył']);
const ALL_WORDS = new Set(['1', 'on', 'tak', 'true', 'wszystko', 'all']);
const TOKENS = {
  haze: 'haze', w1: 'haze', mgla: 'haze', 'mgła': 'haze',
  czastki: 'czastki', 'cząstki': 'czastki', drobiny: 'czastki', w2: 'czastki',
  zorza: 'zorza', w3: 'zorza'
};

/** Nowy rekord przełącznika: { haze, czastki, zorza, src: 'domyślnie' | 'adres' }. */
export function newWarpEdgeFxSwitch() {
  return { haze: WARP_EDGE_FX_DEFAULT.haze, czastki: WARP_EDGE_FX_DEFAULT.czastki, zorza: WARP_EDGE_FX_DEFAULT.zorza, src: 'domyślnie' };
}

/**
 * `?warpFx=` w adresie strony: `0` (wyłączone — obraz jak przed efektami), `haze` (tylko W1), `czastki` (tylko W2), `zorza`
 * (tylko W3), `wszystko`; kilka naraz po przecinku albo plusie (`haze,zorza`). Brak parametru albo same nieznane słowa —
 * zestaw domyślny (WARP_EDGE_FX_DEFAULT). Czysta funkcja (bez alokacji przy podanym `out`).
 */
export function parseWarpEdgeFx(search, out = newWarpEdgeFxSwitch()) {
  out.haze = WARP_EDGE_FX_DEFAULT.haze;
  out.czastki = WARP_EDGE_FX_DEFAULT.czastki;
  out.zorza = WARP_EDGE_FX_DEFAULT.zorza;
  out.src = 'domyślnie';
  const s = typeof search === 'string' ? search : '';
  const m = /[?&]warpFx=([^&#]*)/.exec(s);
  if (!m) return out;
  let v = m[1];
  try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch { /* zostaje surowy napis */ }
  v = v.trim().toLowerCase();
  if (OFF_WORDS.has(v)) {
    out.haze = false; out.czastki = false; out.zorza = false; out.src = 'adres';
    return out;
  }
  if (ALL_WORDS.has(v)) {
    out.haze = true; out.czastki = true; out.zorza = true; out.src = 'adres';
    return out;
  }
  let haze = false;
  let czastki = false;
  let zorza = false;
  let known = false;
  for (const raw of v.split(/[,; ]+/)) {
    const k = TOKENS[raw];
    if (!k) continue;
    known = true;
    if (k === 'haze') haze = true;
    else if (k === 'czastki') czastki = true;
    else zorza = true;
  }
  if (!known) return out;
  out.haze = haze; out.czastki = czastki; out.zorza = zorza; out.src = 'adres';
  return out;
}

let _switchSearch = null;
const _switch = newWarpEdgeFxSwitch();
/** Przełącznik z adresu STRONY (RenderWorld.pageSearch — działa też w workerze renderu), pamiętany po napisie adresu. */
export function warpEdgeFxSwitch(search = RenderWorld.pageSearch) {
  const s = typeof search === 'string' ? search : '';
  if (s !== _switchSearch) {
    _switchSearch = s;
    parseWarpEdgeFx(s, _switch);
  }
  return _switch;
}

// ── strojenie na żywo ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Strojenie (na żywo, bez przebudowy grafu — same uniformy): `haze` / `czastki` / `zorza` = null (adres) albo true /
 * false (wymuszenie), wymiary i tempa niżej. Długości w ułamkach WYSOKOŚCI kadru (H) albo px przy 1080 wierszach (skalują
 * się z rozdzielczością bufora); tempa w H/s przy prędkości 1 (lot bez zwolnienia przy ciałach).
 */
export const WarpEdgeFxTune = {
  haze: null, czastki: null, zorza: null,
  // czysta kolumna osi kursu: pół szerokości = max(colHullK × pół szerokości kadłuba na ekranie, colMinW × szerokość kadru),
  // najwyżej colMaxW × szerokość; pełna siła na fullK drogi od osi do krawędzi kadru po tej stronie
  colHullK: 2.5,
  colMinW: 0.08,
  colMaxW: 0.3,
  fullK: 0.85,
  hullWidth: 0.8,       // szerokość kadłuba z pudła sprite'a (entityWarpHullWidth) × tyle — sprite ma margines
  frontBand: 0.06,      // pół szerokości przejścia frontu wyjścia × H
  aliasK: 15,           // faza wzoru haze ≤ aliasK komórek szumu na sekundę (przy 60 kl/s ¼ komórki na klatkę)
  // W1 haze — dwie oktawy pasm wydłużonych wzdłuż kursu (gładko: gradient przesunięcia w poprzek < 1 — bez fałd obrazu)
  hazeAmpPx: 8,         // [px przy 1080] przesunięcie w poprzek kursu przy krawędzi przy sile 1 (kop najwyżej × hazeKickMax)
  hazeKickMax: 1.4,
  hazeAlong: 0.35,      // udział przesunięcia wzdłuż kursu
  hazeFine: 0.4,        // udział drugiej (drobniejszej) oktawy
  hazeCell1: 0.2,       // komórka bazowa szumu w poprzek kursu × H (oktawa 1; kafelek = 4 komórki)
  hazeStretch1: 7,      // wydłużenie wzdłuż kursu (oktawa 1)
  hazeCell2: 0.08,      // oktawa 2
  hazeStretch2: 7,
  hazeLod1: 3,          // poziom mip ponad 1 texel / px w poprzek (+3 = 8 px na texel — gasi drobne oktawy fbm tekstury)
  hazeLod2: 3,
  hazeFlow: 1.6,        // [H/s] przepływ pasm oktawy 1 przy prędkości 1
  hazeFlow2: 1.3,       // oktawa 2 × tyle (najwyżej limit aliasingu)
  // W2 drobiny — trzy warstwy paralaksy: daleka, średnia, bliska
  dustFar: 1000, dustMid: 550, dustNear: 250,       // instancji (suma stała w potoku ≥ 2; zmiana liczby na żywo bez przebudowy)
  dustSpeedFar: 0.5, dustSpeedMid: 1.4, dustSpeedNear: 3.0,   // [H/s]
  dustLenFar: 30, dustLenMid: 90, dustLenNear: 200,           // [px przy 1080] przy prędkości 1
  dustBrightFar: 0.09, dustBrightMid: 0.16, dustBrightNear: 0.26,
  dustWidthFar: 1.4, dustWidthMid: 1.8, dustWidthNear: 2.4,   // [px przy 1080] kwadu (profil gaussa)
  dustBrightRare: 2.2,  // co ~33. bliska trochę jaśniejsza (lekki blask)
  dustTint: 0.22,       // udział barwy palety warpa w bieli smug
  // W3 zorza
  auroraStrength: 0.1,  // jasność pasa przy krawędzi (liniowo)
  auroraStrip: 0.34,    // szerokość pasa × H (najwyżej 0,3 szerokości)
  auroraSat: 0.45,      // nasycenie barw palety (0 — szaroniebieska poświata, 1 — czysta barwa palety)
  auroraFlow: 0.8,      // [H/s] dryf pasm
  auroraCell: 0.25,     // kafelek szumu w poprzek × H
  auroraStretch: 12     // wydłużenie wzdłuż kursu
};

// ── układ kadru, maska, fazy (czyste funkcje — lustra CPU tego, co liczą shadery) ────────────────────────────────────

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothCpu = (a, b, x) => {
  if (!(b !== a)) return x < a ? 0 : 1;
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** Nowy rekord układu kadru (wynik warpEdgeLayout). */
export function newWarpEdgeLayout() {
  return { cx: 0, cy: 1, nx: 1, ny: 0, lAxis: 0, aShip: 0, aExt: 1, lExt: 1, R: 1, clear: 1 };
}

/**
 * Układ efektów w osiach ekranu (px bufora od środka kadru, y w GÓRĘ): `course` — kąt kursu na ekranie (osie ekranu y w dół:
 * kurs gry − obrót kadru), statek (sx, sy — y w górę), kadr W × H, pół szerokości kadłuba na ekranie [px]. Wynik: kurs c
 * i poprzeczna n = (c.y, −c.x) (w prawo przy kursie w górę), oś kursu przez statek (lAxis = S · n), statek wzdłuż kursu
 * (aShip = S · c), pół-zasięgi kadru wzdłuż kursu i w poprzek (rzut prostokąta kadru), R — pół większego boku (zakres
 * rozstawienia drobin — nie zależy od kąta kursu: obrót kadru nie przetasowuje drobin), clear — pół szerokości czystej
 * kolumny. Bez alokacji.
 */
export function warpEdgeLayout(course, sx, sy, W, H, hullHalfPx, T = WarpEdgeFxTune, out = newWarpEdgeLayout()) {
  const a = num(course, Math.PI * -0.5);
  const cx = Math.cos(a);
  const cy = -Math.sin(a);
  const w = Math.max(1, num(W, 1));
  const h = Math.max(1, num(H, 1));
  const x = num(sx, 0);
  const y = num(sy, 0);
  out.cx = cx; out.cy = cy;
  out.nx = cy; out.ny = -cx;
  out.lAxis = x * out.nx + y * out.ny;
  out.aShip = x * cx + y * cy;
  out.aExt = Math.abs(cx) * w * 0.5 + Math.abs(cy) * h * 0.5;
  out.lExt = Math.abs(out.nx) * w * 0.5 + Math.abs(out.ny) * h * 0.5;
  out.R = Math.max(w, h) * 0.5;
  const hull = Math.max(0, num(hullHalfPx, 0));
  const lo = Math.max(num(T.colHullK, 2.5) * hull, num(T.colMinW, 0.08) * w);
  out.clear = Math.max(1, Math.min(lo, num(T.colMaxW, 0.3) * w));
  return out;
}

/**
 * Maska boków w punkcie: lRel — odległość w bok od osi kursu przez statek [px, + w prawo przy kursie w górę], along — wzdłuż
 * kursu od statku [px, + przed dziobem]; L — układ (warpEdgeLayout); front wyjścia: frontOn (0 / 1), frontPx (od statku
 * wzdłuż kursu), band [px]. 0 — czysto (kolumna osi), rośnie ku krawędzi kadru po tej stronie osi (pełna na fullK drogi).
 */
export function warpEdgeSideMask(lRel, along, L, frontOn = 0, frontPx = 0, band = 1, fullK = WarpEdgeFxTune.fullK) {
  const side = lRel >= 0 ? 1 : -1;
  const toEdge = Math.max(1, L.lExt - side * L.lAxis);
  const full = Math.max(L.clear + 1, fullK * toEdge);
  let m = smoothCpu(L.clear, full, Math.abs(lRel));
  if (frontOn > 0) {
    const b = Math.max(1, band);
    m *= 1 - frontOn * smoothCpu(frontPx - b, frontPx + b, along);
  }
  return m;
}

/** Zawijanie faz drobin [px] — precyzja float32 w shaderze; skok wzoru raz na kilka minut lotu, w szumie niewidoczny. */
export const WARP_EDGE_PHASE_WRAP = 1048576;

/**
 * Krok fazy wzoru [px]: faza += min(v, aliasK · komórka) · dt (czas efektu; dt ≤ 0 albo ≥ 0,25 s — bez przyrostu: pauza,
 * przerwa), zawijana co `wrap` (dla szumu = okres wzoru wzdłuż kursu — wzór bez skoku). Przy aliasK 15 i 60 kl/s wzór
 * przesuwa się najwyżej o ¼ komórki na klatkę — płynie, nie migocze.
 */
export function warpEdgePhaseStep(phase, v, dt, cellPx = Infinity, aliasK = WarpEdgeFxTune.aliasK, wrap = WARP_EDGE_PHASE_WRAP) {
  const lim = Number.isFinite(cellPx) ? Math.max(0, aliasK) * Math.max(1e-6, cellPx) : Infinity;
  const ve = Math.min(Math.max(0, num(v, 0)), lim);
  const d = num(dt, 0);
  const step = d > 0 && d < 0.25 ? d : 0;
  let p = num(phase, 0) + ve * step;
  if (wrap > 0 && p >= wrap) p -= wrap * Math.floor(p / wrap);
  return p;
}

/** Długość smugi [px]: bazowa × prędkość (0,6 + 0,4 · min(v, 2)), nie krótsza niż przesuw na klatkę × 1,3, najwyżej `cap`. */
export function warpEdgeStreakLen(basePx, speed, vPx, dt, cap) {
  const s = Math.max(0, num(speed, 0));
  const base = Math.max(0, num(basePx, 0)) * (0.6 + 0.4 * Math.min(2, s));
  const d = num(dt, 0);
  const strobe = d > 0 && d < 0.25 ? Math.max(0, num(vPx, 0)) * d * 1.3 : 0;
  return Math.min(Math.max(base, strobe), Math.max(1, num(cap, Infinity)));
}

// ── obwiednia siły ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Obwiednia siły i przepływu w fazach skoku gracza. */
export const WARP_EDGE_ENVELOPE = Object.freeze({
  chargeFrom: 0.25,    // ładowanie: siła rośnie od tego ułamka ładowania …
  chargeLevel: 0.35,   // … do tyle na końcu (słabo — świat dopiero wstaje)
  chargeSpeed: 0.3,    // przepływ w ładowaniu (× przepływ lotu) — rozruch od 0
  kickRise: 0.06,      // [s] narastanie impulsu kopu
  kickTime: 0.6,       // [s] impuls kopu wraca do lotu
  kickBoost: 1.0,      // szczyt kopu: siła i przepływ × (1 + kickBoost)
  kickBlend: 0.15,     // [s] siła ładowania → siła lotu
  flybyFloor: 0.5,     // lot: siła × (flybyFloor + (1 − flybyFloor) · przepływ widoczny / WARP_FLOW.travel)
  exitSpeedDrop: 0.7,  // wyjście: przepływ maleje o tyle do końca zwolnienia
  exitFade0: 0.6,      // wyjście: siła gaśnie od exitFade0 · zwolnienie …
  exitTail: 0.25       // … do zwolnienia + exitTail [s] (front czyści kadr wcześniej — maska frontu)
});

/** Nowy rekord obwiedni (wynik warpEdgeEnvelope). */
export function newWarpEdgeEnvelope() {
  return { strength: 0, speed: 0, kick: 0, frontOn: 0, frontS: 0 };
}

/**
 * Obwiednia efektów boków w chwili klatki (czysta funkcja, bez alokacji przy podanym `out`). Wejście `s` (stan WarpPlayerFx):
 *   mode      — 'idle' | 'charging' | 'warp' | 'exit'
 *   charge    — ładowanie 0..1 (w bezczynności po przerwanym ładowaniu gaśnie)
 *   kickAge   — [s] od kopu (zegar efektu)
 *   exitAge   — [s] od wyjścia
 *   exitSlow  — [s] zwolnienie rampy wyjścia (front smug gwiazd)
 *   flowRatio — przepływ widoczny lotu / WARP_FLOW.travel (1 — pełna prędkość, przy mijanym ciele mniej)
 *   hyper     — hipercruise (efekty boków tylko w warpie — 0)
 * Wynik: strength (0..~2 — mnożnik amplitud i jasności), speed (mnożnik przepływu wzorów i drobin), kick (impuls kopu 0..1),
 * frontOn / frontS — front wyjścia [j. świata wzdłuż kursu od statku, + przed dziobem — × zoom na ekranie].
 */
export function warpEdgeEnvelope(s, out = newWarpEdgeEnvelope(), P = WARP_EDGE_ENVELOPE) {
  out.strength = 0;
  out.speed = 0;
  out.kick = 0;
  out.frontOn = 0;
  out.frontS = 0;
  if (!s || s.hyper) return out;
  const flow = clamp01(num(s.flowRatio, 1));
  const lot = P.flybyFloor + (1 - P.flybyFloor) * flow;
  if (s.mode === 'warp') {
    const k = Math.max(0, num(s.kickAge, 1e9));
    const pulse = smoothCpu(0, P.kickRise, k) * (1 - smoothCpu(P.kickRise, P.kickTime, k));
    const base = P.chargeLevel + (lot - P.chargeLevel) * smoothCpu(0, P.kickBlend, k);
    out.kick = pulse;
    out.strength = base * (1 + P.kickBoost * pulse);
    out.speed = Math.max(P.chargeSpeed, flow) * (1 + P.kickBoost * pulse);
    return out;
  }
  if (s.mode === 'exit') {
    const tx = Math.max(0, num(s.exitAge, 0));
    const slow = warpLensExitSlow(s.exitSlow);
    out.strength = lot * (1 - smoothCpu(P.exitFade0 * slow, slow + P.exitTail, tx));
    out.speed = flow * (1 - P.exitSpeedDrop * smoothCpu(0, slow, tx));
    out.frontOn = 1;
    out.frontS = warpExitFrontS(tx, slow);
    return out;
  }
  // ładowanie (i bezczynność po przerwanym ładowaniu — charge gaśnie w 0,25 s)
  const c = smoothCpu(P.chargeFrom, 1, clamp01(num(s.charge, 0)));
  out.strength = P.chargeLevel * c;
  out.speed = P.chargeSpeed * c;
  return out;
}

// ── materiały ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Głębia NDC drobin i zorzy: przy dalekiej płaszczyźnie — wszystko z zapisem głębi w passie tła je zasłania. */
export const WARP_EDGE_FAR_DEPTH = 0.99999;
/**
 * Kolejka passa tła: po niebie, gwiazdach i zasłonie pola (< 0) — okno renderOrder (−0,5; 0) należy do pasa (skały tła,
 * zasłona; reguła `pas-asteroid`), każda inna rzecz tła ma ≥ 0. W skoku pas i tak nie jest rysowany.
 */
export const WARP_EDGE_RENDER_ORDER = 0.3;
/** Rozmiar tekstury tile2D (texele na kafelek) — poziom mip próbek haze liczony na CPU z rozmiaru kafelka na ekranie. */
const TILE_TEXELS = 256;

function newUniforms() {
  return {
    view: uniform(new THREE.Vector2(1, 1)),                 // bufor [px] — wierzchołki W2 / W3 (fragmenty: screenSize)
    axes: uniform(new THREE.Vector4(0, 1, 1, 0)),           // kurs c (xy), poprzeczna n (zw) — osie ekranu, y w górę
    frame: uniform(new THREE.Vector4(1, 1, 0, 0)),          // pół-zasięg kadru w poprzek (lExt), R, oś kursu (lAxis), statek wzdłuż (aShip)
    column: uniform(new THREE.Vector4(1, 0.85, 0, 0)),      // pół szerokości kolumny, fullK, front: on, px od statku
    band: uniform(50),                                      // pół szerokości przejścia frontu [px]
    haze: uniform(new THREE.Vector4(0, 0.35, 0.5, 0)),      // amp [px] (× siła), udział wzdłuż, udział oktawy 2, poziom mip 1
    haze1: uniform(new THREE.Vector4(1, 1, 0, 0)),          // kafelek w poprzek, wzdłuż [px], faza [px], poziom mip 2
    haze2: uniform(new THREE.Vector4(1, 1, 0, 0)),          // kafelek w poprzek, wzdłuż [px], faza [px], —
    dustPh: uniform(new THREE.Vector4(0, 0, 0, 1)),         // fazy warstw [px]: daleka, średnia, bliska; rozpiętość zawijania
    dustLen: uniform(new THREE.Vector4(1, 1, 1, 1)),        // długości smug [px]: daleka, średnia, bliska; zapas zawijania
    dustBr: uniform(new THREE.Vector4(0, 0, 0, 2)),         // jasności warstw, rzadkie jaśniejsze (bliska)
    dustW: uniform(new THREE.Vector4(1, 1, 1, 0)),          // szerokości kwadów [px]
    dustN: uniform(new THREE.Vector4(1, 2, 3, 0)),          // granice warstw (indeks instancji): daleka < x ≤ średnia < y ≤ bliska
    dustTint: uniform(new THREE.Vector3(0.75, 0.88, 1)),
    aurora: uniform(new THREE.Vector4(0, 200, 1, 1)),       // siła, pas [px], kafelek w poprzek, wzdłuż [px]
    auroraPh: uniform(0),                                   // faza dryfu [px]
    auroraA: uniform(new THREE.Vector3(0.3, 0.2, 1)),
    auroraB: uniform(new THREE.Vector3(1, 0.1, 0.8))
  };
}

/**
 * Maska boków w TSL (wklejana — bez setLayout; ta sama co warpEdgeSideMask): lRel — w bok od osi kursu [px], along — wzdłuż
 * kursu od statku [px].
 */
function sideMaskNode(U, lRel, along) {
  const side = step(0.0, lRel).mul(2.0).sub(1.0);
  const toEdge = max(U.frame.x.sub(side.mul(U.frame.z)), 1.0);
  const full = max(U.column.x.add(1.0), toEdge.mul(U.column.y));
  const m = smoothstep(U.column.x, full, abs(lRel)).toVar();
  m.mulAssign(float(1.0).sub(U.column.z.mul(smoothstep(U.column.w.sub(U.band), U.column.w.add(U.band), along))));
  return m;
}

/** Front wyjścia (zorza — pasy przy krawędziach, bez kolumny osi). */
function frontNode(U, along) {
  return float(1.0).sub(U.column.z.mul(smoothstep(U.column.w.sub(U.band), U.column.w.add(U.band), along)));
}

/** Piksel w osiach ekranu od środka kadru (y w górę) — fragmenty. */
function screenPointNode() {
  return vec2(screenCoordinate.x.sub(screenSize.x.mul(0.5)), screenSize.y.mul(0.5).sub(screenCoordinate.y));
}

function fullscreenPosition() {
  return Fn(() => vec4(attribute('position', 'vec3').xy, 0.5, 1.0))();
}

/** W1: quad pełnoekranowy w warstwie DIST — pasma refrakcji wzdłuż kursu przy krawędziach (drżenie w poprzek kursu). */
function buildHazeMaterial(U, tile) {
  const mat = new THREE.NodeMaterial();
  mat.name = 'warp:hazeBokow';
  // pełnoekranowy quad (4 wierzchołki w przestrzeni klipu) — hak rulonu (rulon.js) go nie zgina
  mat.rulonBend = false;
  mat.transparent = true;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.lights = false;
  mat.fog = false;
  mat.forceSinglePass = true;
  // warstwa DIST sumuje przesunięcia (ujemne też) — One / One także w alfie (B = A = 0 — maskowanie)
  blendAddytywnePremul(mat);
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.vertexNode = fullscreenPosition();
  mat.fragmentNode = Fn(() => {
    const P = screenPointNode().toVar();
    const c = U.axes.xy;
    const n = U.axes.zw;
    const a = dot(P, c).toVar();                   // wzdłuż kursu od środka kadru
    const l = dot(P, n).toVar();                   // w poprzek
    const m = sideMaskNode(U, l.sub(U.frame.z), a.sub(U.frame.w)).mul(U.haze.x).toVar();
    // brzeg kadru: post próbkuje p − o, a próbka spoza kadru to powielony brzeg (pasek „kodu kreskowego” przy krawędzi) —
    // przesunięcie gaśnie w pasie 4 × amplituda (szczyt przesunięcia ~1,6 × amplituda — próbka zostaje w kadrze)
    const edgeD = min(screenSize.x.mul(0.5).sub(abs(P.x)), screenSize.y.mul(0.5).sub(abs(P.y)));
    m.mulAssign(smoothstep(0.0, U.haze.x.mul(4.0).add(1.0), edgeD));
    const off = vec2(0.0).toVar();
    If(m.greaterThan(1.0e-4), () => {
      // pasma: kafelek szumu wydłużony wzdłuż kursu, faza wzdłuż kursu (całkowana na CPU) — wzór płynie w dół (przeciw
      // kursowi); próbki z poziomem mip z CPU (gałąź per piksel — bez pochodnych)
      const n1 = texture(tile, vec2(l.div(U.haze1.x), a.add(U.haze1.z).div(U.haze1.y))).level(U.haze.w);
      const n2 = texture(tile, vec2(l.div(U.haze2.x).add(0.37), a.add(U.haze2.z).div(U.haze2.y))).level(U.haze1.w);
      // fbm tekstury (0..1) skupione przy 0,5 — wzmocnienie do ~±0,5, szczyty ±1,6
      const lat = n1.r.sub(0.5).mul(3.2).add(n2.r.sub(0.5).mul(3.2).mul(U.haze.z));
      const alo = n1.g.sub(0.5).mul(3.2).mul(U.haze.y);
      off.assign(n.mul(lat).add(c.mul(alo)).mul(m));
    });
    return vec4(off, 0.0, 0.0);
  })();
  return mat;
}

/** W2: smugi równoległe do kursu w trzech warstwach paralaksy (kwady na instancjach, pozycje z haszu i faz warstw). */
function buildDustMaterial(U) {
  const mat = new THREE.NodeMaterial();
  mat.name = 'warp:drobinyBokow';
  mat.rulonBend = false;
  mat.transparent = true;
  mat.depthTest = true;
  mat.depthWrite = false;
  mat.lights = false;
  mat.fog = false;
  // kwady w przestrzeni klipu (obie strony — bez zależności od kolejności wierzchołków), jeden przebieg
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  blendAddytywnePremul(mat);   // kolor premultiplied One / One; alfa wyjścia 0 — cel sceny bez zmiany alfy
  const vA = varyingProperty('vec4', 'vWarpEdgeDustA');   // x: wzdłuż (1 głowa → 0 ogon), y: w poprzek (−1..1), z: jasność × maska
  mat.vertexNode = Fn(() => {
    const corner = attribute('position', 'vec3').xy;        // PlaneGeometry(1, 1): −0,5..0,5
    const fi = float(instanceIndex).toVar();
    const id = instanceIndex.mul(4).toVar();
    const h1 = hash(id).toVar();
    const h2 = hash(id.add(1)).toVar();
    const h3 = hash(id.add(2)).toVar();
    const h4 = hash(id.add(3)).toVar();
    const W = max(U.view.x, 1.0).toVar();
    const H = max(U.view.y, 1.0).toVar();
    // warstwa z indeksu instancji (daleka < dustN.x ≤ średnia < dustN.y ≤ bliska): wartość = v0 + k1·(v1 − v0) + k2·(v2 − v1)
    const k1 = step(U.dustN.x, fi).toVar();
    const k2 = step(U.dustN.y, fi).toVar();
    const pick = (v) => v.x.add(k1.mul(v.y.sub(v.x))).add(k2.mul(v.z.sub(v.y)));
    const phase = pick(U.dustPh).toVar();
    const len0 = pick(U.dustLen).toVar();
    const wPx = pick(U.dustW).mul(mix(0.85, 1.2, h4)).toVar();
    // w poprzek: strona osi kursu i odległość od niej — od brzegu czystej kolumny do krawędzi kadru po tej stronie (z zapasem
    // R — kąt kursu nie przestawia drobin), gęściej przy bokach (gęstość ∝ odległość)
    const side = step(0.5, h1).mul(2.0).sub(1.0);
    const dMin = U.column.x;
    const dMax = max(U.frame.y.add(abs(U.frame.z)), dMin.add(1.0));
    const d = mix(dMin, dMax, sqrt(fract(h1.mul(2.0)))).toVar();
    const l = U.frame.z.add(side.mul(d)).toVar();
    // wzdłuż: zawijanie w [−R − zapas, R + zapas], głowa jedzie w dół (przeciw kursowi), ogon za nią (ku dziobowi)
    const span = max(U.dustPh.w, 1.0);
    const rate = mix(0.88, 1.12, h3);
    const s = fract(h2.add(phase.mul(rate).div(span)));
    const aHead = U.frame.y.add(U.dustLen.w).sub(s.mul(span)).toVar();
    const len = len0.mul(mix(0.7, 1.3, fract(h4.mul(7.0)))).toVar();
    const t = corner.x.add(0.5);                             // 0 — głowa, 1 — ogon
    const a = aHead.add(t.mul(len)).toVar();
    const lq = l.add(corner.y.mul(wPx)).toVar();
    const P = U.axes.xy.mul(a).add(U.axes.zw.mul(lq)).toVar();
    // maska boków w wierzchołku (kolumna osi, front wyjścia), rzadkie jaśniejsze tylko w bliskiej warstwie
    const m = sideMaskNode(U, lq.sub(U.frame.z), a.sub(U.frame.w));
    const bright = pick(U.dustBr).mul(mix(0.7, 1.3, h4)).mul(mix(1.0, U.dustBr.w, step(0.97, h3).mul(k2)));
    vA.assign(vec4(float(1.0).sub(t), corner.y.mul(2.0), m.mul(bright), 0.0));
    return vec4(P.x.div(W.mul(0.5)), P.y.div(H.mul(0.5)), WARP_EDGE_FAR_DEPTH, 1.0);
  })();
  mat.fragmentNode = Fn(() => {
    const q = clamp(vA.x, 0.0, 1.0);
    const yy = clamp(vA.y, -1.0, 1.0);
    const k = clamp(vA.z, 0.0, 8.0);
    // gauss w poprzek, ogon → głowa narasta, koniec głowy miękki
    const across = exp(yy.mul(yy).mul(-4.0));
    const lengthK = q.mul(q).mul(float(1.0).sub(smoothstep(0.9, 1.0, q)));
    return vec4(U.dustTint.mul(across.mul(lengthK).mul(k)), 0.0);
  })();
  return mat;
}

/** W3: pasy przy lewej i prawej krawędzi — poświata palety, długie pasma szumu dryfujące w dół. */
function buildAuroraMaterial(U, tile) {
  const mat = new THREE.NodeMaterial();
  mat.name = 'warp:zorzaKrawedzi';
  mat.rulonBend = false;
  mat.transparent = true;
  mat.depthTest = true;
  mat.depthWrite = false;
  mat.lights = false;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.forceSinglePass = true;
  blendAddytywnePremul(mat);
  mat.vertexNode = Fn(() => {
    const p = attribute('position', 'vec3');                  // x: 0 (krawędź) → 1 (w głąb), y: −1..1, z: strona ±1
    const w = clamp(U.aurora.y.mul(2.0).div(max(U.view.x, 1.0)), 0.0, 0.6);
    return vec4(p.z.mul(float(1.0).sub(p.x.mul(w))), p.y, WARP_EDGE_FAR_DEPTH, 1.0);
  })();
  mat.fragmentNode = Fn(() => {
    const P = screenPointNode().toVar();
    const a = dot(P, U.axes.xy).toVar();
    const l = dot(P, U.axes.zw).toVar();
    const edge = screenSize.x.mul(0.5).sub(abs(P.x));                       // px do bliższej krawędzi bocznej
    const e = clamp(float(1.0).sub(edge.div(max(U.aurora.y, 1.0))), 0.0, 1.0);
    const fall = e.mul(e).mul(float(3.0).sub(e.mul(2.0)));
    const nz = texture(tile, vec2(l.div(max(U.aurora.z, 1.0)).add(0.21), a.add(U.auroraPh).div(max(U.aurora.w, 1.0)))).level(0);
    const wisps = smoothstep(0.3, 0.85, nz.r).mul(nz.a.mul(0.5).add(0.5));
    const k = fall.mul(wisps.mul(0.75).add(0.25)).mul(frontNode(U, a.sub(U.frame.w))).mul(U.aurora.x);
    return vec4(mix(U.auroraA, U.auroraB, nz.g).mul(k), 0.0);
  })();
  return mat;
}

function dustGeometry(count) {
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.index);
  geo.setAttribute('position', base.getAttribute('position'));
  geo.instanceCount = Math.max(2, count | 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

function auroraGeometry() {
  // dwa pasy: x 0 (krawędź) → 1 (w głąb), y −1..1, z strona (−1 lewa, +1 prawa)
  const pos = new Float32Array([
    0, -1, -1, 1, -1, -1, 1, 1, -1, 0, 1, -1,
    0, -1, 1, 1, -1, 1, 1, 1, 1, 0, 1, 1
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

const dustTotal = (T) => Math.max(2, Math.floor(num(T.dustFar, 0)) + Math.floor(num(T.dustMid, 0)) + Math.floor(num(T.dustNear, 0)));

// ── moduł ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Efekty boków kadru (jeden na wątek renderu — tworzy WarpNurt.init). update(c) raz na klatkę „Nurtu”, rekord `c`
 * (sterownik pisze go w miejscu): on (kamera z góry jednego gracza, gracz jest), t / dt (zegar efektu), player
 * (WarpPlayerFx), zoom [px bufora / j.], roll (obrót kadru), W / H (bufor), shipX / shipY (statek − kamera bez wstrząsu,
 * świat), hullWidth (szerokość pudła kadłuba [j.]), palette (id palety).
 */
export class WarpEdgeFx {
  constructor() {
    this.tune = WarpEdgeFxTune;
    this.U = newUniforms();
    const tile = fxNoise.tile2D();
    const U = this.U;
    this.hazeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), buildHazeMaterial(U, tile));
    this.hazeMesh.name = 'warp:hazeBokow';
    this.hazeMesh.frustumCulled = false;
    this.hazeMesh.layers.set(FX_DISTORT_LAYER);
    this.hazeMesh.visible = false;
    this.dustMesh = new THREE.Mesh(dustGeometry(dustTotal(WarpEdgeFxTune)), buildDustMaterial(U));
    this.dustMesh.name = 'warp:drobinyBokow';
    this.dustMesh.frustumCulled = false;
    this.dustMesh.renderOrder = WARP_EDGE_RENDER_ORDER;
    this.dustMesh.layers.set(1);
    this.dustMesh.visible = false;
    this.auroraMesh = new THREE.Mesh(auroraGeometry(), buildAuroraMaterial(U, tile));
    this.auroraMesh.name = 'warp:zorzaKrawedzi';
    this.auroraMesh.frustumCulled = false;
    this.auroraMesh.renderOrder = WARP_EDGE_RENDER_ORDER - 0.01;
    this.auroraMesh.layers.set(1);
    this.auroraMesh.visible = false;
    this.distLive = false;
    this._sw = newWarpEdgeFxSwitch();
    this._env = newWarpEdgeEnvelope();
    this._envIn = { mode: 'idle', charge: 0, kickAge: 0, exitAge: 0, exitSlow: 0, flowRatio: 1, hyper: false };
    this._lay = newWarpEdgeLayout();
    // fazy [px] (całkowane na CPU): haze — dwie oktawy, drobiny — trzy warstwy, zorza
    this._ph = { h1: 0, h2: 0, far: 0, mid: 0, near: 0, aurora: 0 };
    this._updated = false;
    this._fxStep = null;
    this.stats = { on: false, strength: 0, speed: 0, kick: 0, clear: 0, haze: false, czastki: false, zorza: false, src: '' };
  }

  /** Siatki do sceny, wpisy rozgrzewki (ekran ładowania) i krok efektów zgłaszający warstwę DIST. */
  attach(scene) {
    if (scene) {
      scene.add(this.hazeMesh);
      scene.add(this.dustMesh);
      scene.add(this.auroraMesh);
    }
    Core3D.warmup?.add({ name: 'warp: haze boków (DIST)', objects: () => [this.hazeMesh], layer: FX_DISTORT_LAYER, phase: 'loading' });
    Core3D.warmup?.add({ name: 'warp: drobiny i zorza boków', objects: () => [this.dustMesh, this.auroraMesh], layer: 1, phase: 'loading', variant: WARIANT_INSTANCJI });
    // Flagę warstwy DIST kasuje klatka efektów na starcie (FxFrame.frame) — zgłoszenie z kroku (wzór hullCloak.js).
    if (typeof Core3D.addFxStep === 'function') {
      this._fxStep = { name: 'warp: boki kadru', update: () => this._fxUpdate() };
      Core3D.addFxStep(this._fxStep);
    }
    return this;
  }

  // Krok efektów (raz na klatkę, po update sterownika tej klatki): zgłoszenie warstwy DIST; klatka bez update (sterownik
  // wyłączony — WarpNurt.enabled, tło menu) chowa siatki, żeby nie zostały z ostatnim stanem skoku.
  _fxUpdate() {
    if (!this._updated) this.off();
    this._updated = false;
    if (this.distLive) Core3D.setDistortLayerActive(true);
  }

  /** Siatki rozgrzewki (narzędzia, testy). */
  warmupMeshes() {
    return [this.hazeMesh, this.dustMesh, this.auroraMesh];
  }

  /** Wszystko schowane, fazy od zera (poza skokiem, wyłączony sterownik). */
  off() {
    this.hazeMesh.visible = false;
    this.dustMesh.visible = false;
    this.auroraMesh.visible = false;
    this.distLive = false;
    const ph = this._ph;
    ph.h1 = 0; ph.h2 = 0; ph.far = 0; ph.mid = 0; ph.near = 0; ph.aurora = 0;
    const s = this.stats;
    s.on = false;
    s.strength = 0;
    s.speed = 0;
    s.kick = 0;
  }

  /** Przełącznik tej klatki: adres strony, wymuszenia ze strojenia. */
  _switchNow() {
    const a = warpEdgeFxSwitch();
    const T = WarpEdgeFxTune;
    const sw = this._sw;
    sw.haze = T.haze === true || T.haze === false ? T.haze : a.haze;
    sw.czastki = T.czastki === true || T.czastki === false ? T.czastki : a.czastki;
    sw.zorza = T.zorza === true || T.zorza === false ? T.zorza : a.zorza;
    sw.src = a.src;
    return sw;
  }

  update(c) {
    this._updated = true;
    const sw = this._switchNow();
    const p = c ? c.player : null;
    const ei = this._envIn;
    if (p) {
      ei.mode = p.mode;
      ei.charge = p.charge;
      ei.kickAge = c.t - p.kickT;
      ei.exitAge = c.t - p.exitT;
      ei.exitSlow = p.ramp ? p.ramp.slow : 0;
      ei.flowRatio = num(p.flowGear, 0) / WARP_FLOW.travel;
      ei.hyper = p.hyper === true;
    }
    const env = p ? warpEdgeEnvelope(ei, this._env) : warpEdgeEnvelope(null, this._env);
    const any = sw.haze || sw.czastki || sw.zorza;
    const W = num(c && c.W, 0);
    const H = num(c && c.H, 0);
    const st = this.stats;
    st.haze = sw.haze; st.czastki = sw.czastki; st.zorza = sw.zorza; st.src = sw.src;
    if (!c || !c.on || !any || !(env.strength > 1e-4) || !(W > 1) || !(H > 1)) {
      this.off();
      return;
    }
    const T = WarpEdgeFxTune;
    const U = this.U;
    const dt = Math.max(0, Math.min(0.1, num(c.dt, 0)));
    // --- układ kadru: kurs i statek w osiach ekranu (obrót kadru — viewRoll.js), czysta kolumna z kadłuba ---
    const zoom = Math.max(1e-9, num(c.zoom, 1));
    const roll = num(c.roll, 0);
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    const wx = num(c.shipX, 0);
    const wy = num(c.shipY, 0);
    const sx = (rc * wx + rs * wy) * zoom;             // px od środka, y w dół
    const sy = (-rs * wx + rc * wy) * zoom;
    const hullHalf = 0.5 * Math.max(0, num(c.hullWidth, 0)) * num(T.hullWidth, 0.8) * zoom;
    const L = warpEdgeLayout(num(p.angle, 0) - roll, sx, -sy, W, H, hullHalf, T, this._lay);
    U.view.value.set(W, H);
    U.axes.value.set(L.cx, L.cy, L.nx, L.ny);
    U.frame.value.set(L.lExt, L.R, L.lAxis, L.aShip);
    U.column.value.set(L.clear, num(T.fullK, 0.85), env.frontOn, env.frontS * zoom);
    U.band.value = Math.max(1, num(T.frontBand, 0.06) * H);
    // --- fazy (całkowane czasem efektu; pauza: dt = 0) ---
    const s = env.strength;
    const speed = env.speed;
    const ph = this._ph;
    const aliasK = num(T.aliasK, 15);
    // W1: kafelki szumu [px] (4 komórki bazowe fbm na kafelek), faza zawijana co kafelek wzdłuż — wzór bez skoku; limit
    // aliasingu z komórki TRZECIEJ oktawy fbm tekstury wzdłuż (kafelek / 16 — najdrobniejsza, którą zostawia poziom mip)
    const t1x = Math.max(1, 4 * num(T.hazeCell1, 0.2) * H);
    const t1y = t1x * Math.max(1, num(T.hazeStretch1, 7));
    const t2x = Math.max(1, 4 * num(T.hazeCell2, 0.08) * H);
    const t2y = t2x * Math.max(1, num(T.hazeStretch2, 7));
    const v1 = speed * num(T.hazeFlow, 1.6) * H;
    ph.h1 = warpEdgePhaseStep(ph.h1, v1, dt, t1y / 16, aliasK, t1y);
    ph.h2 = warpEdgePhaseStep(ph.h2, v1 * num(T.hazeFlow2, 1.3), dt, t2y / 16, aliasK, t2y);
    // poziom mip: 1 texel kafelka na px w poprzek (wzdłuż — powiększenie) + przesunięcie (gładkość)
    const lod1 = Math.max(0, Math.log2(TILE_TEXELS / t1x) + num(T.hazeLod1, 3));
    const lod2 = Math.max(0, Math.log2(TILE_TEXELS / t2x) + num(T.hazeLod2, 3));
    const scale = H / 1080;
    U.haze.value.set(num(T.hazeAmpPx, 8) * scale * Math.min(s, num(T.hazeKickMax, 1.4)), num(T.hazeAlong, 0.35), num(T.hazeFine, 0.4), lod1);
    U.haze1.value.set(t1x, t1y, ph.h1, lod2);
    U.haze2.value.set(t2x, t2y, ph.h2, 0);
    // W2: trzy warstwy — prędkość [px/s], długość smugi (bez stroboskopu, najwyżej zapas zawijania), rozpiętość zawijania stała
    // na klatkę kadru (R + zapas — kąt kursu i prędkość jej nie zmieniają)
    const margin = 0.4 * H;
    const vF = speed * num(T.dustSpeedFar, 0.5) * H;
    const vM = speed * num(T.dustSpeedMid, 1.4) * H;
    const vN = speed * num(T.dustSpeedNear, 3) * H;
    ph.far = warpEdgePhaseStep(ph.far, vF, dt);
    ph.mid = warpEdgePhaseStep(ph.mid, vM, dt);
    ph.near = warpEdgePhaseStep(ph.near, vN, dt);
    U.dustPh.value.set(ph.far, ph.mid, ph.near, 2 * (L.R + margin));
    // smuga ≥ przesuw na klatkę × 1,3 — przy najszybszej drobinie warstwy (tempo × 1,12) i najkrótszej (× 0,7)
    U.dustLen.value.set(
      warpEdgeStreakLen(num(T.dustLenFar, 30) * scale, speed, vF * 1.12 / 0.7, dt, margin),
      warpEdgeStreakLen(num(T.dustLenMid, 90) * scale, speed, vM * 1.12 / 0.7, dt, margin),
      warpEdgeStreakLen(num(T.dustLenNear, 200) * scale, speed, vN * 1.12 / 0.7, dt, margin),
      margin);
    const bk = Math.min(1.35, s);
    U.dustBr.value.set(num(T.dustBrightFar, 0.09) * bk, num(T.dustBrightMid, 0.16) * bk, num(T.dustBrightNear, 0.26) * bk, num(T.dustBrightRare, 2.2));
    const ws = Math.max(0.75, scale);
    U.dustW.value.set(num(T.dustWidthFar, 1.4) * ws, num(T.dustWidthMid, 1.8) * ws, num(T.dustWidthNear, 2.4) * ws, 0);
    const nF = Math.max(0, Math.floor(num(T.dustFar, 1000)));
    const nM = Math.max(0, Math.floor(num(T.dustMid, 550)));
    const total = dustTotal(T);
    U.dustN.value.set(nF, nF + nM, total, 0);
    const geo = this.dustMesh.geometry;
    if (geo.instanceCount !== total) geo.instanceCount = total;
    const pal = warpPalette(c.palette);
    const tk = clamp01(num(T.dustTint, 0.22));
    const g = pal.glow;
    const gl = Math.max(1e-3, Math.max(g[0], g[1], g[2]));
    U.dustTint.value.set(0.72 * (1 - tk) + tk * g[0] / gl, 0.86 * (1 - tk) + tk * g[1] / gl, 1.0 * (1 - tk) + tk * g[2] / gl);
    // W3: dryf w dół, kafelki wydłużone wzdłuż kursu
    const ax = Math.max(1, num(T.auroraCell, 0.25) * H);
    const ay = ax * Math.max(1, num(T.auroraStretch, 12));
    ph.aurora = warpEdgePhaseStep(ph.aurora, speed * num(T.auroraFlow, 0.8) * H, dt, ay * 0.25, aliasK, ay);
    const strip = Math.min(0.3 * W, num(T.auroraStrip, 0.34) * H);
    U.aurora.value.set(num(T.auroraStrength, 0.1) * s, strip, ax, ay);
    U.auroraPh.value = ph.aurora;
    // barwy palety (otoczka, poświata) znormalizowane i przygaszone ku szaroniebieskiej mgiełce (auroraSat)
    const sat = clamp01(num(T.auroraSat, 0.45));
    const o = pal.outer;
    const ol = Math.max(1e-3, Math.max(o[0], o[1], o[2]));
    U.auroraA.value.set(0.55 + sat * (o[0] / ol - 0.55), 0.62 + sat * (o[1] / ol - 0.62), 0.8 + sat * (o[2] / ol - 0.8));
    U.auroraB.value.set(0.55 + sat * (g[0] / gl - 0.55), 0.62 + sat * (g[1] / gl - 0.62), 0.8 + sat * (g[2] / gl - 0.8));
    // --- widoczność ---
    this.hazeMesh.visible = sw.haze;
    this.dustMesh.visible = sw.czastki;
    this.auroraMesh.visible = sw.zorza;
    this.distLive = sw.haze;
    st.on = true;
    st.strength = s;
    st.speed = speed;
    st.kick = env.kick;
    st.clear = L.clear;
  }
}
