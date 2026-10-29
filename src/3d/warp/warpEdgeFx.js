// src/3d/warp/warpEdgeFx.js
//
// BOKI KADRU W SKOKU GRACZA (2026-10-29; prośba użytkownika: „dodanie efektów haze lub cząsteczkowych do warpa … haze,
// ale mocniejszym po bokach ekranu, a nie na statku”; propozycje i zrzuty — docs/PROPOZYCJA-efekty-warpa-2026-10-29.md).
// Środek kadru — statek, punkt zbiegu soczewki O1 przed dziobem (VP) i ciała mijane blisko osi kursu — zostaje czysty;
// efekty żyją po bokach. Trzy prototypy za przełącznikiem z adresu (`?warpFx=`, niżej):
//   W1 HAZE PĘDU     — warstwa DIST (FX_DISTORT_LAYER, cel Core3D.distortionTarget): pełnoekranowy quad pisze przesunięcie
//                      [px bufora, osie ekranu: x w prawo, y w górę; B = A = 0 — B / A należą do maskowania] z szumu
//                      tile2D (fxNoise — ta sama tekstura co broń) we współrzędnych biegunowych wokół VP: kąt × N,
//                      log(r) × k − zegar przepływu — fale załamania płyną od VP na zewnątrz jak ciała soczewki (mapa O1
//                      prowadzi obrazy po prostych z VP); przesunięcie głównie radialne, trochę w poprzek. Aberracja R / B
//                      dochodzi w poście sama (≤ 2,5 px — postGry.js: LAYER_ABER_MAX_PX).
//   W2 DROBINY PĘDU  — jedna siatka (InstancedBufferGeometry, ~2000 instancji), pozycje ANALITYCZNE z haszu instancji
//                      i zegara przepływu (bez compute i bez zapisu CPU poza uniformami): smugi radialne od VP, promień rośnie
//                      wykładniczo (tempo w log r stałe — perspektywa ciał soczewki), smuga wydłuża się z prędkością; pass
//                      tła (warstwa 1), głębia przy dalekiej płaszczyźnie — pod planetami, ringiem, stacjami i kadłubami.
//   W3 ZORZA KRAWĘDZI — dwa pasy przy lewej i prawej krawędzi kadru (geometria tylko przy krawędziach): słaba addytywna
//                      poświata w barwie palety warpa, płynąca na zewnątrz tym samym zegarem; pass tła.
// MASKA BOKÓW (wspólna, lustro CPU warpEdgeSideMask): 0 w kolumnie wzdłuż osi kursu przez statek (VP leży na niej),
// rośnie z odległością w bok (× wysokość kadru — na 21:9 / 32:9 boki szersze), za rufą słabiej; przy wyjściu FRONT smug
// gwiazd (ten sam co gwiazd i soczewki — warpLensPhase.js: warpExitFrontS) czyści kadr od dziobu ku rufie.
// OBWIEDNIA SIŁY (czysta funkcja warpEdgeEnvelope): ładowanie — słabo, z ładowaniem; KOP — impuls × 2 (siła i przepływ),
// gaśnie w ~0,6 s; LOT — stała × prędkość widoczna (przy mijanym ciele statek zwalnia — haze słabnie i zwalnia); WYJŚCIE —
// gaśnie z frontem smug gwiazd; po zatrzymaniu 0. Tylko warp gracza (hipercruise — 0), tylko kamera z góry jednego gracza
// (sterownik: `o.lensAllowed`), czas — zegar efektu WarpNurt.time (stoi w pauzie).
//
// Sterownik (warpNurt.js) tworzy moduł w init i woła update na końcu klatki „Nurtu”; warstwę DIST zgłasza krok efektów
// Core3D „warp: boki kadru” (flagę kasuje klatka efektów na starcie — zgłoszenie z WarpNurt.update by przepadło).
// Render w workerze: bez window, GameState, DOM i Math.random (adres strony — RenderWorld.pageSearch, losowość — hasz
// instancji na GPU). Graf węzłów RAZ na materiał (wartości klatki w uniformach), bez alokacji w update.
// Strojenie na żywo: `WarpEdgeFxTune` (eksport; w trybie off także window.WarpNurt.edge.tune).

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec4, uniform, texture, attribute, varyingProperty, instanceIndex, screenCoordinate, screenSize,
  atan, log, exp, cos, sin, length, dot, abs, max, clamp, mix, smoothstep, fract, step, hash, If
} from 'three/tsl';
import { Core3D } from '../core3d.js';
import { FX_DISTORT_LAYER } from '../fx/fxFrame.js';
import { fxNoise } from '../fx/noise.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { WARIANT_INSTANCJI } from '../rozgrzewka.js';
import { RenderWorld } from '../../render/renderWorld.js';
import { warpExitFrontS, warpLensExitSlow } from '../../render/warpLensPhase.js';
import { warpViewEdgePx } from '../../render/warpArrivalFrame.js';
import { WORLD_LENS_DEFAULTS, WARP_LENS_SHARED } from './worldLens.js';
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
 * false (wymuszenie), amplitudy i tempa niżej. Długości w ułamkach WYSOKOŚCI kadru albo px przy 1080 wierszach (skalują
 * się z rozdzielczością bufora).
 */
export const WarpEdgeFxTune = {
  haze: null, czastki: null, zorza: null,
  // W1 haze
  hazeAmpPx: 16,        // [px przy 1080] przesunięcie przy krawędzi przy sile 1 (kop × 2)
  hazeAngN: 7,          // kafelki szumu na pełny obrót wokół VP (całkowite — szew atan bez skoku)
  hazeRadK: 0.55,       // kafelki szumu na jednostkę ln(r) (wydłużenie radialne: kąt 7 / 2π vs promień 0,55)
  hazeFlow: 0.85,       // [kafelki/s] przepływ szumu na zewnątrz przy prędkości 1 (ln r: 0,85 / 0,55 ≈ 1,5/s)
  hazeTan: 0.35,        // udział przesunięcia w poprzek promienia
  hazeFine: 0.6,        // udział drobnych zmarszczek (kanał B — okres 16)
  // W2 drobiny
  dustCount: 2048,      // instancji (stała — liczba w potoku ≥ 2; mniej rysuje się jako zwinięte kwady)
  dustBright: 0.34,     // jasność smugi (liniowo, HDR pod progiem bloomu ~0,9; rzadkie jaśniejsze × dustBrightRare)
  dustBrightRare: 2.4,  // mnożnik co ~25. drobiny (lekki blask)
  dustLogSpeed: 1.7,    // [ln r / s] przy prędkości 1 (ciała soczewki w trawersie: v / A ≈ 1,9 / s)
  dustShutter: 0.06,    // [s] migawka smugi (długość = tempo × migawka, w log r)
  dustWidthPx: 2.4,     // [px przy 1080] szerokość kwadu (profil gaussa — linia ~1,7 px)
  dustR0: 0.05,         // narodziny × wysokość od VP (w czystej kolumnie)
  dustAng0: 0.16,       // [rad] najmniejszy kąt od kierunku „za rufę” (oś kursu — czysta)
  dustAng1: 1.85,       // [rad] największy (VP blisko górnej krawędzi — dalej promienie wychodzą od razu za kadr)
  dustTint: 0.22,       // udział barwy palety warpa w bieli smug
  // W3 zorza
  auroraStrength: 0.1,  // jasność pasa przy krawędzi (liniowo)
  auroraStrip: 0.34,    // szerokość pasa × wysokość kadru (najwyżej 0,3 szerokości)
  auroraSat: 0.55,      // nasycenie barw palety (0 — szaroniebieska poświata, 1 — czysta barwa palety)
  // maska boków (WARP_EDGE_MASK — kopia do strojenia)
  maskClear: 0.15,
  maskFull: 0.8,
  maskBackFrom: 0.05,
  maskBackTo: 0.5,
  maskBackCut: 0.45,
  frontBand: 0.06       // pół szerokości przejścia frontu wyjścia × wysokość kadru
};

// ── maska boków (lustro CPU tego, co liczą shadery) ─────────────────────────────────────────────────────────────────

/** Parametry maski (ułamki wysokości kadru): czysta kolumna, pełna siła, osłabienie za rufą, pas frontu wyjścia. */
export const WARP_EDGE_MASK = Object.freeze({
  clear: 0.15,     // |odległość w bok od osi kursu| / H ≤ clear — 0 (statek, VP, ciała blisko osi)
  full: 0.8,       // ≥ full — 1 (na 16:9 krawędź boczna leży ~0,89 H od osi)
  backFrom: 0.05,  // za rufą (wzdłuż kursu, −) od tyle × H …
  backTo: 0.5,     // … do tyle × H siła maleje o backCut
  backCut: 0.45,
  frontBand: 0.06  // front wyjścia: przejście ± tyle × H
});

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

/**
 * Maska boków w punkcie (px od środka kadru, y w GÓRĘ): statek (sx, sy), kurs (dx, dy — jednostkowy, y w górę), H —
 * wysokość kadru [px]; front = { on (0 / 1), px — położenie frontu wzdłuż kursu od statku [px] }. 0 — czysto, 1 — pełny efekt.
 */
export function warpEdgeSideMask(px, py, sx, sy, dx, dy, H, front = null, P = WARP_EDGE_MASK) {
  const h = Math.max(1, num(H, 1));
  const rx = px - sx;
  const ry = py - sy;
  const along = rx * dx + ry * dy;
  const lat = Math.abs(rx * dy - ry * dx);
  let m = smoothCpu(P.clear, P.full, lat / h);
  m *= 1 - P.backCut * smoothCpu(P.backFrom, P.backTo, -along / h);
  if (front && front.on > 0) {
    const band = Math.max(1, P.frontBand * h);
    m *= 1 - front.on * smoothCpu(front.px - band, front.px + band, along);
  }
  return m;
}

// ── obwiednia siły ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Obwiednia siły i przepływu w fazach skoku gracza. */
export const WARP_EDGE_ENVELOPE = Object.freeze({
  chargeFrom: 0.25,    // ładowanie: siła rośnie od tego ułamka ładowania …
  chargeLevel: 0.35,   // … do tyle na końcu (słabo — świat dopiero wstaje)
  chargeSpeed: 0.3,    // przepływ w ładowaniu (× przepływ lotu)
  kickRise: 0.06,      // [s] narastanie impulsu kopu
  kickTime: 0.6,       // [s] impuls kopu wraca do lotu
  kickBoost: 1.0,      // szczyt kopu: siła i przepływ × (1 + kickBoost)
  kickBlend: 0.15,     // [s] siła ładowania → siła lotu
  flybyFloor: 0.5,     // lot: siła × (flybyFloor + (1 − flybyFloor) · przepływ widoczny / WARP_FLOW.travel)
  exitSpeedDrop: 0.7,  // wyjście: przepływ maleje o tyle do końca zwolnienia
  exitFade0: 0.6,      // wyjście: siła gaśnie od exitFade0 · zwolnienie …
  exitTail: 0.25       // … do zwolnienia + exitTail [s] (front smug czyści kadr wcześniej — maska frontu)
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
 * Wynik: strength (0..~2 — mnożnik amplitud), speed (mnożnik przepływu szumu i drobin), kick (impuls kopu 0..1),
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

// ── punkt zbiegu ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Punkt zbiegu soczewki O1 (worldLens.js: warpLensFrame — E_f = hf · droga od kotwicy P0 do krawędzi kadru przed dziobem)
 * w px od środka kadru, osie ekranu (y w DÓŁ): kurs (cu, cv), kadr hw × hh, kotwica (ax, ay). Brak danych — środek x,
 * 0,15 wysokości od góry. Wynik w `out` { x, y, ok }.
 */
export function warpEdgeVanishPoint(cu, cv, hw, hh, ax, ay, hf = WORLD_LENS_DEFAULTS.hf, out = { x: 0, y: 0, ok: false }) {
  const ok = Number.isFinite(cu) && Number.isFinite(cv) && Number.isFinite(ax) && Number.isFinite(ay) && hw > 0 && hh > 0
    && cu * cu + cv * cv > 1e-6;
  if (!ok) {
    out.x = 0;
    out.y = -0.35 * Math.max(0, num(hh, 0)) * 2;
    out.ok = false;
    return out;
  }
  const ef = warpViewEdgePx(cu, cv, hw, hh, ax, ay);
  const E = Math.max(1, num(hf, WORLD_LENS_DEFAULTS.hf) * ef);
  out.x = ax + E * cu;
  out.y = ay + E * cv;
  out.ok = true;
  return out;
}

// ── materiały ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Głębia NDC drobin i zorzy: przy dalekiej płaszczyźnie — wszystko z zapisem głębi w passie tła je zasłania. */
export const WARP_EDGE_FAR_DEPTH = 0.99999;
/** Kolejka passa tła: po niebie (−1000 / −998) i gwiazdach (−1), po zasłonie pasa (−0,5). */
export const WARP_EDGE_RENDER_ORDER = -0.45;

function newUniforms() {
  return {
    view: uniform(new THREE.Vector2(1, 1)),    // bufor [px] — wierzchołki W2 / W3 (fragmenty: screenSize)
    vp: uniform(new THREE.Vector2(0, 0)),      // VP [px od środka, y w górę]
    ship: uniform(new THREE.Vector2(0, 0)),    // statek [px od środka, y w górę]
    dir: uniform(new THREE.Vector2(0, 1)),     // kurs na ekranie (y w górę, jednostkowy)
    mask: uniform(new THREE.Vector4(0.15, 0.8, 0.05, 0.5)),   // clear, full, backFrom, backTo (× H)
    front: uniform(new THREE.Vector4(0, 0, 50, 0.45)),        // on, px wzdłuż kursu od statku, pas [px], backCut
    haze: uniform(new THREE.Vector4(0, 1, 0.55, 0.35)),       // amp [px] (× siła), kąt N/2π, promień k, w poprzek
    hazeClock: uniform(0),                                      // zegar przepływu szumu (owinięty co 10)
    hazeFine: uniform(0.45),
    dust: uniform(new THREE.Vector4(0, 0.4, 0.1, 2.4)),       // zegar życia, jasność, smuga [ln r], szerokość [px]
    dustLife: uniform(new THREE.Vector4(-3, 0.8, 0.16, 1.85)),// ln r0 [× H], ln r1, kąt0, kąt1 [rad]
    dustTint: uniform(new THREE.Vector3(0.75, 0.88, 1)),
    dustRare: uniform(2.4),
    aurora: uniform(new THREE.Vector4(0, 200, 0, 0)),         // siła, pas [px]
    auroraA: uniform(new THREE.Vector3(0.3, 0.2, 1)),
    auroraB: uniform(new THREE.Vector3(1, 0.1, 0.8))
  };
}

/**
 * Maska boków w TSL (wklejana — bez setLayout; ta sama co warpEdgeSideMask): P — px od środka kadru (y w górę), H — wysokość.
 */
function sideMaskNode(U, P, H) {
  const rel = P.sub(U.ship);
  const along = dot(rel, U.dir).toVar();
  const lat = abs(rel.x.mul(U.dir.y).sub(rel.y.mul(U.dir.x)));
  const m = smoothstep(U.mask.x, U.mask.y, lat.div(H)).toVar();
  m.mulAssign(float(1.0).sub(U.front.w.mul(smoothstep(U.mask.z, U.mask.w, along.negate().div(H)))));
  m.mulAssign(float(1.0).sub(U.front.x.mul(smoothstep(U.front.y.sub(U.front.z), U.front.y.add(U.front.z), along))));
  return m;
}

/** Osłabienie za rufą i front wyjścia (zorza — bez kolumny osi: pasy i tak leżą przy krawędziach). */
function backFrontNode(U, P, H) {
  const along = dot(P.sub(U.ship), U.dir).toVar();
  const k = float(1.0).sub(U.front.w.mul(smoothstep(U.mask.z, U.mask.w, along.negate().div(H)))).toVar();
  k.mulAssign(float(1.0).sub(U.front.x.mul(smoothstep(U.front.y.sub(U.front.z), U.front.y.add(U.front.z), along))));
  return k;
}

function fullscreenPosition() {
  return Fn(() => vec4(attribute('position', 'vec3').xy, 0.5, 1.0))();
}

/** W1: quad pełnoekranowy w warstwie DIST — przesunięcie [px] z szumu w biegunowych wokół VP, × maska × siła. */
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
    const H = max(screenSize.y, 1.0);
    const P = vec2(screenCoordinate.x.sub(screenSize.x.mul(0.5)), screenSize.y.mul(0.5).sub(screenCoordinate.y)).toVar();
    const m = sideMaskNode(U, P, H).mul(U.haze.x).toVar();
    const off = vec2(0.0).toVar();
    If(m.greaterThan(1.0e-4), () => {
      const d = P.sub(U.vp).toVar();
      const r = max(length(d), 1.0).toVar();
      const dir = d.div(r).toVar();
      // kąt × N/2π (N całkowite: na szwie atan skok o N kafelków — ten sam teksel), ln(r / H) × k − zegar (na zewnątrz)
      const ua = atan(dir.y, dir.x).mul(U.haze.y).toVar();
      const ur = log(r.div(H)).mul(U.haze.z).sub(U.hazeClock).toVar();
      // próbka z poziomem (gałąź per piksel — bez pochodnych; boki: < 1 teksel na px)
      const n = texture(tile, vec2(ua, ur)).level(0);
      const nf = texture(tile, vec2(ua.mul(3.0).add(0.37), ur.mul(2.0).sub(U.hazeClock.mul(0.7)))).level(0);
      const rad = n.r.sub(0.5).mul(2.0).add(nf.b.sub(0.5).mul(2.0).mul(U.hazeFine));
      const tan = n.g.sub(0.5).mul(2.0).mul(U.haze.w);
      off.assign(dir.mul(rad).add(vec2(dir.y.negate(), dir.x).mul(tan)).mul(m));
    });
    return vec4(off, 0.0, 0.0);
  })();
  return mat;
}

/** W2: smugi radialne od VP (kwady na instancjach, pozycje z haszu instancji i zegara życia). */
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
  const vA = varyingProperty('vec4', 'vWarpEdgeDustA');   // x: wzdłuż (0 ogon → 1 głowa), y: w poprzek (−1..1), z: jasność × maska
  mat.vertexNode = Fn(() => {
    const corner = attribute('position', 'vec3').xy;        // PlaneGeometry(1, 1): −0,5..0,5
    const id = instanceIndex.mul(4).toVar();
    const h1 = hash(id).toVar();
    const h2 = hash(id.add(1)).toVar();
    const h3 = hash(id.add(2)).toVar();
    const h4 = hash(id.add(3)).toVar();
    const H = max(U.view.y, 1.0).toVar();
    // kierunek: „za rufę” (od VP ku statkowi) obrócony o ± kąt z [kąt0, kąt1] — oś kursu (czysta kolumna) pominięta
    const back = U.dir.negate().toVar();
    const sgn = step(0.5, h1).mul(2.0).sub(1.0);
    const ang = sgn.mul(mix(U.dustLife.z, U.dustLife.w, fract(h1.mul(2.0)))).toVar();
    const ca = cos(ang);
    const sa = sin(ang);
    const dirR = vec2(back.x.mul(ca).sub(back.y.mul(sa)), back.x.mul(sa).add(back.y.mul(ca))).toVar();
    // życie: ułamek z fazy i zegara (tempo instancji 0,75–1,3), ln r liniowo → promień rośnie wykładniczo
    const rate = mix(0.75, 1.3, h3).toVar();
    const f = fract(h2.add(U.dust.x.mul(rate))).toVar();
    const lnR = mix(U.dustLife.x, U.dustLife.y, f);
    const rHead = exp(lnR).mul(H).toVar();
    const rTail = rHead.mul(exp(U.dust.z.mul(rate).negate())).toVar();
    const along = mix(rTail, rHead, corner.x.add(0.5));
    const wPx = U.dust.w.mul(mix(0.8, 1.35, h4));
    const P = U.vp.add(dirR.mul(along)).add(vec2(dirR.y.negate(), dirR.x).mul(corner.y.mul(wPx))).toVar();
    const life = smoothstep(0.0, 0.1, f).mul(float(1.0).sub(smoothstep(0.92, 1.0, f)));
    // rzadkie jaśniejsze (~co 25.): lekki blask ponad progiem bloomu
    const bright = U.dust.y.mul(mix(0.55, 1.35, h4)).mul(mix(1.0, U.dustRare, step(0.96, h3)));
    const m = sideMaskNode(U, P, H);
    vA.assign(vec4(corner.x.add(0.5), corner.y.mul(2.0), m.mul(life).mul(bright), 0.0));
    return vec4(P.x.div(U.view.x.mul(0.5)), P.y.div(H.mul(0.5)), WARP_EDGE_FAR_DEPTH, 1.0);
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

/** W3: pasy przy lewej i prawej krawędzi — poświata palety, szum płynący od VP. */
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
    const H = max(screenSize.y, 1.0);
    const P = vec2(screenCoordinate.x.sub(screenSize.x.mul(0.5)), screenSize.y.mul(0.5).sub(screenCoordinate.y)).toVar();
    const edge = screenSize.x.mul(0.5).sub(abs(P.x));                       // px do bliższej krawędzi bocznej
    const e = clamp(float(1.0).sub(edge.div(max(U.aurora.y, 1.0))), 0.0, 1.0);
    const fall = e.mul(e).mul(float(3.0).sub(e.mul(2.0)));
    const d = P.sub(U.vp).toVar();
    const r = max(length(d), 1.0);
    const ua = atan(d.y, d.x).mul(U.haze.y).mul(0.5);
    const ur = log(r.div(H)).mul(U.haze.z.mul(0.6)).sub(U.hazeClock.mul(0.8));
    const n = texture(tile, vec2(ua.add(0.21), ur)).level(0);
    const wisps = smoothstep(0.3, 0.85, n.r).mul(n.a.mul(0.5).add(0.5));
    const k = fall.mul(wisps.mul(0.75).add(0.25)).mul(backFrontNode(U, P, H)).mul(U.aurora.x);
    return vec4(mix(U.auroraA, U.auroraB, n.g).mul(k), 0.0);
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
  // dwa pasy: x 0 (krawędź) → 1 (w głąb), y −1..1, z strona (−1 lewa, +1 prawa); trójkąty przednie (CCW na ekranie)
  const pos = new Float32Array([
    0, -1, -1, 1, -1, -1, 1, 1, -1, 0, 1, -1,
    0, -1, 1, 1, -1, 1, 1, 1, 1, 0, 1, 1
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // lewa: x_ndc = −1 + x·w (rośnie z x) — CCW: (0,−1) (1,−1) (1,1); prawa: x_ndc = 1 − x·w (maleje) — kolejność odwrotna
  geo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

// ── moduł ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Efekty boków kadru (jeden na wątek renderu — tworzy WarpNurt.init). update(c) raz na klatkę „Nurtu”, rekord `c`
 * (sterownik pisze go w miejscu): on (kamera z góry jednego gracza, gracz jest), t / dt (zegar efektu), player
 * (WarpPlayerFx), zoom [px bufora / j.], roll (obrót kadru), W / H (bufor), shipX / shipY (statek − kamera bez wstrząsu,
 * świat), anchorSX / anchorSY (kotwica kadru skoku, px CSS — NaN: statek), pxScale (bufor / CSS), palette (id palety).
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
    this.dustMesh = new THREE.Mesh(dustGeometry(WarpEdgeFxTune.dustCount), buildDustMaterial(U));
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
    this._vp = { x: 0, y: 0, ok: false };
    this._front = { on: 0, px: 0 };
    this._hazeClock = 0;
    this._dustClock = 0;
    this._updated = false;
    this._fxStep = null;
    this.stats = { on: false, strength: 0, speed: 0, kick: 0, vpX: 0, vpY: 0, vpOk: false, haze: false, czastki: false, zorza: false, src: '' };
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

  /** Wszystko schowane, zegary od zera (poza skokiem, wyłączony sterownik). */
  off() {
    this.hazeMesh.visible = false;
    this.dustMesh.visible = false;
    this.auroraMesh.visible = false;
    this.distLive = false;
    this._hazeClock = 0;
    this._dustClock = 0;
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
    // --- geometria kadru: kurs i statek w osiach ekranu (obrót kadru — viewRoll.js), kotwica, VP ---
    const zoom = Math.max(1e-9, num(c.zoom, 1));
    const roll = num(c.roll, 0);
    const rc = roll ? Math.cos(roll) : 1;
    const rs = roll ? Math.sin(roll) : 0;
    const wx = num(c.shipX, 0);
    const wy = num(c.shipY, 0);
    const sx = (rc * wx + rs * wy) * zoom;           // px od środka, y w dół
    const sy = (-rs * wx + rc * wy) * zoom;
    const course = num(p.angle, 0) - roll;
    const cu = Math.cos(course);
    const cv = Math.sin(course);
    const pxs = num(c.pxScale, 1) > 0 ? num(c.pxScale, 1) : 1;
    const anchorOk = Number.isFinite(c.anchorSX) && Number.isFinite(c.anchorSY);
    const ax = anchorOk ? c.anchorSX * pxs : sx;
    const ay = anchorOk ? c.anchorSY * pxs : sy;
    const hf = num(WARP_LENS_SHARED.params && WARP_LENS_SHARED.params.hf, WORLD_LENS_DEFAULTS.hf);
    const vp = warpEdgeVanishPoint(cu, cv, W * 0.5, H * 0.5, ax, ay, hf, this._vp);
    U.view.value.set(W, H);
    U.vp.value.set(vp.x, -vp.y);
    U.ship.value.set(sx, -sy);
    U.dir.value.set(cu, -cv);
    // --- maska: kolumna osi, za rufą słabiej, front wyjścia (j. świata × zoom → px bufora) ---
    U.mask.value.set(num(T.maskClear, WARP_EDGE_MASK.clear), num(T.maskFull, WARP_EDGE_MASK.full),
      num(T.maskBackFrom, WARP_EDGE_MASK.backFrom), num(T.maskBackTo, WARP_EDGE_MASK.backTo));
    const band = Math.max(1, num(T.frontBand, WARP_EDGE_MASK.frontBand) * H);
    U.front.value.set(env.frontOn, env.frontS * zoom, band, num(T.maskBackCut, WARP_EDGE_MASK.backCut));
    // --- zegary przepływu (całkowane — zmiana prędkości nie przestawia wzoru; pauza: dt = 0) ---
    const speed = env.speed;
    this._hazeClock += dt * speed * num(T.hazeFlow, 0.85);
    if (this._hazeClock > 10) this._hazeClock -= 10;   // okres 10: oba kafelki szumu (× 1 i × 0,7) wracają do siebie
    const r0 = Math.max(1e-3, num(T.dustR0, 0.05));
    const r1 = 1.08 * Math.sqrt((0.5 * W / H) * (0.5 * W / H) + 0.95 * 0.95);
    const ln0 = Math.log(r0);
    const ln1 = Math.log(Math.max(r0 * 2, r1));
    const span = ln1 - ln0;
    const logSpeed = num(T.dustLogSpeed, 1.7);
    this._dustClock += dt * speed * logSpeed / span;
    if (this._dustClock > 4096) this._dustClock = 0;
    const s = env.strength;
    const scale = H / 1080;
    // --- W1 ---
    U.haze.value.set(num(T.hazeAmpPx, 11) * scale * s, Math.round(num(T.hazeAngN, 7)) / (2 * Math.PI),
      num(T.hazeRadK, 0.55), num(T.hazeTan, 0.35));
    U.hazeClock.value = this._hazeClock;
    U.hazeFine.value = num(T.hazeFine, 0.45);
    // --- W2 ---
    const streak = Math.max(0.005, logSpeed * Math.max(0.15, speed) * num(T.dustShutter, 0.06));
    U.dust.value.set(this._dustClock, num(T.dustBright, 0.34) * Math.min(1.35, s), streak, num(T.dustWidthPx, 2.4) * Math.max(0.75, scale));
    U.dustLife.value.set(ln0, ln1, num(T.dustAng0, 0.16), num(T.dustAng1, 1.85));
    U.dustRare.value = num(T.dustBrightRare, 2.4);
    const pal = warpPalette(c.palette);
    const tk = clamp01(num(T.dustTint, 0.22));
    const g = pal.glow;
    const gl = Math.max(1e-3, Math.max(g[0], g[1], g[2]));
    U.dustTint.value.set(0.72 * (1 - tk) + tk * g[0] / gl, 0.86 * (1 - tk) + tk * g[1] / gl, 1.0 * (1 - tk) + tk * g[2] / gl);
    const want = Math.max(2, Math.floor(num(T.dustCount, 2048)));
    const geo = this.dustMesh.geometry;
    if (geo.instanceCount !== want) geo.instanceCount = want;
    // --- W3 ---
    const strip = Math.min(0.3 * W, num(T.auroraStrip, 0.34) * H);
    U.aurora.value.set(num(T.auroraStrength, 0.1) * s, strip, 0, 0);
    // barwy palety (otoczka, poświata) znormalizowane i przygaszone ku szaroniebieskiej mgiełce (auroraSat)
    const sat = clamp01(num(T.auroraSat, 0.55));
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
    st.vpX = Math.round(vp.x);
    st.vpY = Math.round(vp.y);
    st.vpOk = vp.ok;
  }
}
