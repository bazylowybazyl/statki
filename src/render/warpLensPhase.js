// src/render/warpLensPhase.js
//
// OŚ β SOCZEWKI ŚWIATA w skoku gracza (DECYZJE P1 / P3 / E4, 2026-10-25; projekt D § 2, projekt B § 4.3).
// Czyste funkcje bez three i DOM — ten sam wynik w trybie `off` (strona), w workerze renderu (z pól migawki) i w HUD-zie
// strony (znaczniki świata gasną z β). Wejście to wyłącznie dane gry i ZEGAR GRY:
//
//   s = { state, charge, kickAge, exitAge, exitSlow, exitBeta, abortAge, abortBeta, hyper }
//     state     — automat warpa gracza: 'idle' | 'charging' | 'active'
//     charge    — postęp ładowania 0..1 (warp.charge / warp.chargeTime)
//     kickAge   — [s] czas gry od skoku (engageWarp); brak / NaN — kop już minął. Także w wyjściu (β wyjścia = β kopu
//                 w chwili wyjścia, gdy brak exitBeta).
//     exitAge   — [s] czas gry od wyjścia (exitWarp — wiek rampy wyjścia; wyjście BEZ rampy — wiek wirtualnej rampy
//                 ze stepWarpLensTrack); < 0 — brak wyjścia
//     exitSlow  — [s] koniec zwolnienia rampy (ramp.tSlowEnd, warpDrive.js WARP_EXIT.slow); brak — 0,7 s
//     exitBeta  — β w chwili wyjścia (wyjście w trakcie kopu: < 1); brak — z kickAge albo 1
//     abortAge  — [s] czas gry od przerwania ładowania (charging → idle bez wyjścia); < 0 / NaN — brak
//     abortBeta — β w chwili przerwania
//     hyper     — skok prowadzi efekt hipercruise'u (soczewka wyłączona)
//
// Fazy:
//   ładowanie   β = chargeBeta · smoothstep(charge)       — „świat wstaje” (dalekie ciała wynurzają się na horyzoncie)
//   kop         β = chargeBeta → 1, easeOut³ w kickTime s — domknięcie przy rozpędzie
//   lot         β = 1
//   wyjście     β = β wyjścia (1, w kopie — β kopu w chwili wyjścia), a każde ciało spoza celu zanurza się / wraca, gdy
//               minie je FRONT smug gwiazd (od dziobu ku rufie, w czasie ramp.slow — warpExitFrontS, warpBodySubmerge;
//               liczy soczewka per ciało), po froncie i zanurzeniu ostatniego ciała β = 0. Cel ma własne trzymanie
//               (worldLens.js: targetHold — sterownik trzyma soczewkę, póki > 0) — przylot = przekazanie celu kamerze.
//   przerwanie  β = abortBeta · (1 − smoothstep(0, abortTime, abortAge)) — ładowanie przerwane (nowa trasa, holownik):
//               świat opada w abortTime s, nie znika w jednej klatce.
// Wyjście bez rampy (exitWarp({ abrupt: true }) — warp.exitRamp = null) idzie tym samym frontem co zwykłe: stan minimalny
// stepWarpLensTrack (strona gry, raz na klatkę) daje mu wiek wirtualnej rampy.
//
// WPIĘCIE (etap 2, 2026-10-26): strona gry raz na klatkę renderu woła stepWarpLensPhase(track, s, GameState.warp,
// SimClock.render) (index.html: stepPlayerWarpLensPhase), klatka „Nurtu” niesie `s` (o.lensPhase), migawka — pola
// WARP_LENS_* (warpWorldMirror.js), WarpPlayerFx.lensBeta = warpLensBeta(s) — ten sam wynik w trybie off i w workerze.

export const WARP_LENS_PHASE = Object.freeze({
  chargeBeta: 0.9,     // β na końcu ładowania
  kickTime: 0.45,      // [s] kop β chargeBeta → 1 (easeOut³)
  exitSlow: 0.7,       // [s] zwolnienie rampy wyjścia, gdy sterownik nie poda ramp.tSlowEnd (= WARP_EXIT.slow)
  frontFrom: 18000,    // [j.] FRONT smug gwiazd wzdłuż kursu od statku na początku wyjścia (player.js: st.frontS)
  frontTo: -18000,     // [j.] … na końcu zwolnienia
  submerge: 0.3,       // [s] zanurzenie / powrót ciała po przejściu frontu
  abortTime: 0.3,      // [s] przerwane ładowanie: β opada do 0
  virtualExitTail: 1.0, // [s] wyjście bez rampy: wiek wirtualnej rampy trwa exitSlow + submerge + tyle (trzymanie celu)
  hudBand: 120         // [px] HUD: szerokość przejścia znacznika na froncie
});

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth01 = (x) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const smoothstep = (e0, e1, x) => smooth01((x - e0) / (e1 - e0));
const easeOut3 = (x) => {
  const u = 1 - clamp01(x);
  return 1 - u * u * u;
};
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

/** β w ładowaniu (charge 0..1). */
export function warpLensChargeBeta(charge, P = WARP_LENS_PHASE) {
  return P.chargeBeta * smooth01(num(charge, 0));
}

/** β od skoku (kickAge [s] czasu gry): chargeBeta → 1 easeOut³ w kickTime. Brak wieku — 1. */
export function warpLensKickBeta(kickAge, P = WARP_LENS_PHASE) {
  const k = Number(kickAge);
  if (!Number.isFinite(k)) return 1;
  return P.chargeBeta + (1 - P.chargeBeta) * easeOut3(k / Math.max(1e-3, P.kickTime));
}

/** Koniec zwolnienia rampy [s] (domyślnie WARP_LENS_PHASE.exitSlow). */
export function warpLensExitSlow(exitSlow, P = WARP_LENS_PHASE) {
  const s = Number(exitSlow);
  return s > 0 ? s : P.exitSlow;
}

/** Czy wyjście jeszcze trwa dla soczewki (front + zanurzenie ostatniego ciała). */
export function warpLensExitLive(exitAge, exitSlow, P = WARP_LENS_PHASE) {
  const x = Number(exitAge);
  return x >= 0 && x < warpLensExitSlow(exitSlow, P) + P.submerge;
}

/**
 * β wyjścia (stałe przez całe wyjście): s.exitBeta; bez niego β kopu w chwili wyjścia (kickAge − exitAge); bez obu — 1.
 * Wyjście w trakcie kopu nie dociąga β do 1 (soczewka nie przestawia ciał w klatce wyjścia).
 */
export function warpLensExitBeta(s, P = WARP_LENS_PHASE) {
  if (!s) return 1;
  const eb = Number(s.exitBeta);
  if (Number.isFinite(eb)) return clamp01(eb);
  const k = Number(s.kickAge);
  const x = Number(s.exitAge);
  if (Number.isFinite(k) && x >= 0 && k - x >= 0) return warpLensKickBeta(k - x, P);
  return 1;
}

/** β po przerwanym ładowaniu (0, gdy brak przerwania). */
export function warpLensAbortBeta(s, P = WARP_LENS_PHASE) {
  if (!s) return 0;
  const a = Number(s.abortAge);
  const b = Number(s.abortBeta);
  if (!(a >= 0) || !(b > 0)) return 0;
  return clamp01(b) * (1 - smoothstep(0, Math.max(1e-3, P.abortTime), a));
}

/**
 * β soczewki świata w tej klatce (0 — prawdziwy widok, 1 — soczewka). Jedna funkcja dla sterownika renderu (strona
 * i worker) i HUD-u strony. Cel przy przylocie trzyma soczewka (targetHold) — tu go nie ma.
 */
export function warpLensBeta(s, P = WARP_LENS_PHASE) {
  if (!s || s.hyper) return 0;
  if (s.state === 'charging') return warpLensChargeBeta(s.charge, P);
  if (s.state === 'active') return warpLensKickBeta(s.kickAge, P);
  if (warpLensExitLive(s.exitAge, s.exitSlow, P)) return warpLensExitBeta(s, P);
  return warpLensAbortBeta(s, P);
}

/**
 * FRONT wyjścia [j. świata wzdłuż kursu od statku, + przed dziobem] w chwili exitAge — ten sam co front smug gwiazd
 * (player.js: st.frontS = lerp(18 000, −18 000, smooth(0, ramp.slow, tx))). Na ekranie: × zoom kamery.
 */
export function warpExitFrontS(exitAge, exitSlow, P = WARP_LENS_PHASE) {
  const u = smoothstep(0, warpLensExitSlow(exitSlow, P), num(exitAge, 0));
  return P.frontFrom + (P.frontTo - P.frontFrom) * u;
}

/** Udział soczewki ciała po przejściu frontu (crossAge — wiek wyjścia, w którym front dotknął obrazu; < 0 — jeszcze nie). */
export function warpBodySubmerge(crossAge, exitAge, P = WARP_LENS_PHASE) {
  const c = Number(crossAge);
  if (!(c >= 0)) return 1;
  return 1 - smoothstep(c, c + Math.max(1e-3, P.submerge), num(exitAge, 0));
}

/**
 * HUD (E4): udział soczewki dla znaczników świata (kontakty, podpisy planet) — alfa znacznika = 1 − wynik.
 * alongPx — znacznik wzdłuż kursu od statku na ekranie [px, + przed dziobem] (bez niego — cała warstwa naraz);
 * zoom — zoom kamery (front smug gwiazd w px). W wyjściu znacznik wraca, gdy minie go front (od dziobu ku rufie).
 */
export function warpLensHudBeta(s, alongPx = NaN, zoom = NaN, P = WARP_LENS_PHASE) {
  if (!s || s.hyper) return 0;
  if (s.state === 'charging' || s.state === 'active') return warpLensBeta(s, P);
  const x = Number(s.exitAge);
  if (!(x >= 0)) return warpLensAbortBeta(s, P);
  return warpLensFrontBeta(warpLensExitBeta(s, P), x, s.exitSlow, alongPx, zoom, P);
}

/**
 * Udział soczewki ZNACZNIKA HUD-u w wyjściu (znaczniki strony): b0 — β wyjścia, exitAge / exitSlow — wiek wyjścia
 * i koniec zwolnienia [s], alongPx — znacznik wzdłuż kursu od statku [px, + przed dziobem; prawdziwe miejsce], zoom — px
 * na j. świata (front smug gwiazd w px). Znacznik wraca, gdy minie go front (pasmo hudBand px); bez położenia — cała
 * warstwa naraz (do końca zwolnienia + zanurzenia). Kropki flot i wraków — warpLensPointBeta (zanurzenie 0,3 s).
 */
export function warpLensFrontBeta(b0, exitAge, exitSlow, alongPx = NaN, zoom = NaN, P = WARP_LENS_PHASE) {
  const x = Number(exitAge);
  const b = clamp01(num(b0, 0));
  if (!(x >= 0) || !(b > 0)) return 0;
  const slow = warpLensExitSlow(exitSlow, P);
  const y = Number(alongPx);
  const z = Number(zoom);
  if (!Number.isFinite(y) || !(z > 0)) return b * (1 - smoothstep(0, slow + P.submerge, x));
  // Za frontem (front poniżej znacznika) — prawdziwy świat; pasmo hudBand px wokół frontu.
  if (x >= slow) return 0;
  const f = warpExitFrontS(x, slow, P) * z;
  return b * smoothstep(-P.hudBand, P.hudBand, f - y);
}

/**
 * Strona gry (E2): encja, którą soczewka zastępuje kropką — udział soczewki PUNKTU w miejscu encji (warpLensPointBeta)
 * powyżej tego progu: skóra, mostki, modele, tarcze, wieże i nakładki 2D schowane jak we mgle, render rysuje kropkę
 * (hexShips3D: HexBodyLensBatch). Przy 0,02 obraz soczewki ma ~97% prawdziwej skali w prawie tym samym miejscu.
 */
export const WARP_LENS_DOT_SWAP = 0.02;

/**
 * Wiek wyjścia [s], w którym FRONT smug gwiazd mija punkt `along` [j. świata wzdłuż kursu od statku, + przed dziobem]
 * — odwrotność warpExitFrontS (front monotoniczny: frontFrom → frontTo w exitSlow s po smoothstepie, więc bez stanu).
 * Punkt przed startem frontu — 0 (wraca od początku wyjścia), za jego końcem — exitSlow.
 */
export function warpExitFrontCross(along, exitSlow, P = WARP_LENS_PHASE) {
  const slow = warpLensExitSlow(exitSlow, P);
  const span = P.frontFrom - P.frontTo;
  if (!(span > 0)) return 0;
  const u = (P.frontFrom - num(along, 0)) / span;
  if (!(u > 0)) return 0;
  if (u >= 1) return slow;
  // odwrotność smoothstepu 3x² − 2x³ = u
  return slow * (0.5 - Math.sin(Math.asin(1 - 2 * u) / 3));
}

/**
 * PUNKT w wyjściu (kropki flot, NPC i wraków — E2 jak ciała w P3): udział soczewki b0 · zanurzenie od chwili, gdy front
 * smug gwiazd minął PRAWDZIWE miejsce punktu (`along` [j. świata wzdłuż kursu]; warpBodySubmerge — `submerge` s). Każdy
 * punkt wraca w 0,3 s (dawne pasmo HUD-u ±120 px przenosiło kropkę z obrazu soczewki na prawdziwe miejsce w 2–3 klatki).
 * Jednostki świata — strona gry i render liczą to samo bez px (CSS / bufor).
 */
export function warpLensPointExitBeta(b0, exitAge, exitSlow, along, P = WARP_LENS_PHASE) {
  const x = Number(exitAge);
  const b = clamp01(num(b0, 0));
  if (!(x >= 0) || !(b > 0)) return 0;
  return b * warpBodySubmerge(warpExitFrontCross(along, exitSlow, P), x, P);
}

/**
 * Udział soczewki PUNKTU (E2) w klatce osi `s` — punkt `along` [j. świata wzdłuż kursu od statku]: ładowanie, kop i lot —
 * β osi (warpLensBeta), wyjście — front + zanurzenie (warpLensPointExitBeta), przerwane ładowanie — β przerwania.
 * Ta sama funkcja decyduje o kropce na stronie gry (warpLensDotFor) i o jej miejscu w renderze (worldLens.js: mapPoint).
 */
export function warpLensPointBeta(s, along, P = WARP_LENS_PHASE) {
  if (!s || s.hyper) return 0;
  if (s.state === 'charging' || s.state === 'active') return warpLensBeta(s, P);
  const x = Number(s.exitAge);
  if (!(x >= 0)) return warpLensAbortBeta(s, P);
  return warpLensPointExitBeta(warpLensExitBeta(s, P), x, s.exitSlow, along, P);
}

/**
 * Strona gry (E2): czy encję w (dx, dy) od statku [j. świata] zastępuje kropka soczewki — kurs (cu, cv) [wersor świata],
 * `hidden` — mgła wojny chowa encję (wtedy nigdy: ukryta encja nie pojawia się w soczewce). `zoom` — nieużywany (dawny
 * próg w px; decyzja liczy się w jednostkach świata, jak mapPoint renderu).
 */
export function warpLensDotFor(s, dx, dy, cu, cv, zoom, hidden = false, P = WARP_LENS_PHASE) {
  if (hidden) return false;
  const along = num(dx, 0) * num(cu, 0) + num(dy, 0) * num(cv, 0);
  return warpLensPointBeta(s, along, P) >= WARP_LENS_DOT_SWAP;
}

/** Stan minimalny osi β (stepWarpLensTrack) — jeden na gracza, po stronie gry. */
export function createWarpLensTrack() {
  return {
    prevState: 'idle', prevBeta: 0, prevExit: false, abortT: NaN, abortBeta: 0, exitT: NaN, exitBeta: NaN,
    // zegar wyjścia strony (stepWarpLensPhase): chwila wyjścia [s zegara gry] i rampa z tej chwili
    exitT0: NaN, exitRampT0: NaN, exitSlowAt: NaN, exitHaltAt: 0
  };
}

/**
 * Wiek wyjścia trwa po wyjściu jeszcze tyle s po zatrzymaniu rampy (trzymanie celu przy przylocie: ślizg z pędem ~5 s
 * + worldLens arrivalHoldMax 8 s + puszczenie) — rampa gry znika wcześniej (cameraRig: settle), wiek nie może.
 */
export const WARP_LENS_EXIT_SPAN = 14;

/**
 * Rekord osi β (strona gry: stepWarpLensPhase, worker: lustro migawki — warpWorldMirror.js WARP_LENS_FIELDS). Pola
 * osi (warpLensBeta) i kadru soczewki z gry: `arriving` (ślizg z pędem / hamowanie grawitacyjne trwa — worldLens:
 * zatrzymanie), `zoomRef` / `zoomJump` (zoom odniesienia skoku i kadr skoku [px CSS / j.] — kamera gry),
 * `arrivalFill` (cameraRigTune.warpArrivalFill), `beta` (wynik tej klatki — diagnostyka; worker liczy β sam).
 */
export function createWarpLensPhase() {
  return {
    state: 'idle', charge: 0, kickAge: NaN, exitAge: -1, exitSlow: NaN, exitHalt: 0, exitBeta: NaN,
    abortAge: -1, abortBeta: 0, hyper: false, arriving: false, zoomRef: NaN, zoomJump: NaN, arrivalFill: NaN, beta: 0
  };
}

/**
 * DOLOT gracza po wyjściu (jedno źródło dla soczewki — `arriving` rekordu osi — i kamery gry — kadr przylotu K1,
 * index.html: updateCameraWarpKick): ślizg z pędem po rampie albo hamowanie grawitacyjne (wyjście bez rampy).
 */
export function warpPlayerArriving(w) {
  return !!(w && ((w.exitSlide && w.exitSlide.active) || (w.gravityBrake && w.gravityBrake.active)));
}

/**
 * STRONA GRY, raz na klatkę renderu: oś β gracza z obiektu warpa gry (GameState.warp: state, charge / chargeTime,
 * kickSim, exitRamp { t0, tSlowEnd, tHalt }, exitSlide.active, gravityBrake.active) i ZEGARA GRY `clock` (SimClock.render
 * — w pauzie stoi; kickSim i ramp.t0 to SimClock.sim). Wypełnia `s` (createWarpLensPhase) w miejscu i krokuje
 * stepWarpLensTrack; zwraca β.
 *   • wiek wyjścia: od chwili wyjścia (ramp.t0; wyjście bez rampy — exitWarp({ abrupt }), teleport — klatka przejścia
 *     lot → bezczynność) do zatrzymania rampy + WARP_LENS_EXIT_SPAN s — ciągły także po zdjęciu rampy (rampa żyje tylko
 *     do cameraRig settle), nowe ładowanie go kończy;
 *   • hyperOn — efekt prowadzi hipercruise (β = 0).
 * Gra publikuje `s` w migawce (worker liczy warpLensBeta z tych samych pól).
 */
export function stepWarpLensPhase(tr, s, warp, clock, hyperOn = false, P = WARP_LENS_PHASE) {
  const t = num(clock, 0);
  const w = warp || null;
  const st = w && (w.state === 'charging' || w.state === 'active') ? w.state : 'idle';
  s.state = st;
  const ct = w ? Number(w.chargeTime) : 0;
  s.charge = w && ct > 0 ? clamp01((Number(w.charge) || 0) / ct) : 0;
  const ks = w ? Number(w.kickSim) : NaN;
  s.kickAge = Number.isFinite(ks) ? Math.max(0, t - ks) : NaN;
  s.hyper = !!hyperOn && st === 'idle';
  const ramp = w ? w.exitRamp : null;
  if (st !== 'idle') {
    // nowy skok kończy wiek wyjścia; t0 rampy zostaje w pamięci — rampa poprzedniego skoku (nieaktywna, cameraRig zdejmuje
    // ją dopiero po settle) przy przerwanym ładowaniu nie udaje nowego wyjścia
    tr.exitT0 = NaN;
  } else {
    const r0 = ramp ? Number(ramp.t0) : NaN;
    if (Number.isFinite(r0) && r0 !== tr.exitRampT0) {
      // nowa rampa wyjścia (exitWarp): wiek od jej startu
      tr.exitRampT0 = r0;
      tr.exitT0 = r0;
      tr.exitSlowAt = Number(ramp.tSlowEnd) > 0 ? Number(ramp.tSlowEnd) : P.exitSlow;
      tr.exitHaltAt = Math.max(0, Number(ramp.tHalt) || 0);
    } else if (!Number.isFinite(tr.exitT0) && tr.prevState === 'active' && !s.hyper) {
      // lot → bezczynność bez rampy (hamowanie grawitacyjne, teleport): wirtualna rampa od tej klatki
      tr.exitT0 = t;
      tr.exitSlowAt = P.exitSlow;
      tr.exitHaltAt = 0;
    }
  }
  s.exitAge = -1;
  s.exitSlow = NaN;
  s.exitHalt = 0;
  if (Number.isFinite(tr.exitT0)) {
    const a = Math.max(0, t - tr.exitT0);
    if (a <= tr.exitHaltAt + WARP_LENS_EXIT_SPAN) {
      s.exitAge = a;
      s.exitSlow = tr.exitSlowAt;
      s.exitHalt = tr.exitHaltAt;
    } else {
      tr.exitT0 = NaN;
    }
  }
  s.arriving = warpPlayerArriving(w);
  s.exitBeta = NaN;
  s.abortAge = -1;
  s.abortBeta = 0;
  const b = stepWarpLensTrack(tr, s, t, P);
  s.beta = b;
  return b;
}

/**
 * STAN MINIMALNY osi β (strona gry, raz na klatkę, `clock` — zegar gry [s], w pauzie stoi): uzupełnia `s` (w miejscu)
 * o to, czego automat warpa nie niesie:
 *   • exitBeta — β z klatki przed wyjściem (zwykłym i bez rampy) — wyjście w trakcie kopu bez przestawienia ciał;
 *   • abortAge / abortBeta — przerwane ładowanie (charging → idle bez wyjścia: nowa trasa, holownik, rozkaz);
 *   • exitAge / exitSlow wirtualnej rampy — wyjście bez rampy (active → idle bez exitAge: exitWarp({ abrupt: true }))
 *     idzie tym samym frontem co zwykłe; trwa exitSlow + submerge + virtualExitTail s.
 * Gra publikuje wynik (exitAge, exitBeta, abortAge, abortBeta) w migawce — worker liczy β z tych samych pól tą samą
 * funkcją (warpLensBeta). Zwraca β tej klatki.
 */
export function stepWarpLensTrack(tr, s, clock, P = WARP_LENS_PHASE) {
  const t = num(clock, 0);
  const st = s && !s.hyper ? s.state : 'idle';
  const exitOn = Number(s && s.exitAge) >= 0;
  if (st === 'charging' || st === 'active') {
    tr.abortT = NaN;
    tr.exitT = NaN;
    tr.exitBeta = NaN;
  } else if (exitOn) {
    tr.abortT = NaN;
    tr.exitT = NaN;
    if (!tr.prevExit) tr.exitBeta = tr.prevState === 'charging' || tr.prevState === 'active' ? tr.prevBeta : NaN;
  } else {
    if (tr.prevState === 'charging') {
      tr.abortT = t;
      tr.abortBeta = tr.prevBeta;
    } else if (tr.prevState === 'active') {
      tr.exitT = t;
      tr.exitBeta = tr.prevBeta;
    }
  }
  if (s) {
    if (Number.isFinite(tr.abortT)) {
      const a = t - tr.abortT;
      if (a <= P.abortTime) {
        s.abortAge = a;
        s.abortBeta = tr.abortBeta;
      } else tr.abortT = NaN;
    }
    if (!exitOn && Number.isFinite(tr.exitT)) {
      const x = t - tr.exitT;
      if (x <= P.exitSlow + P.submerge + P.virtualExitTail) {
        s.exitAge = x;
        if (!(Number(s.exitSlow) > 0)) s.exitSlow = P.exitSlow;
      } else {
        tr.exitT = NaN;
        tr.exitBeta = NaN;
      }
    }
    if (Number.isFinite(tr.exitBeta) && Number(s.exitAge) >= 0) s.exitBeta = tr.exitBeta;
  }
  const b = warpLensBeta(s, P);
  tr.prevState = st;
  tr.prevExit = Number(s && s.exitAge) >= 0;
  tr.prevBeta = b;
  return b;
}
