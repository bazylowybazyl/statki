// src/3d/warp/player.js
//
// Skok GRACZA w języku „Nurtu” (dema/warp-webgpu/scenes.js: createTripScene / createFreeScene,
// iteracja 3 — 2026-10-03) na automacie warpa gry (index.html: `warp.state` idle → charging →
// active → idle + rampa wyjścia `warp.exitRamp`). Czysty moduł (bez three, bez DOM): co klatkę
// dostaje stan gry, wypełnia klatkę efektu (frame.js) — gwiazdy, fale, błyski, żar kadłuba, oś β soczewki świata
// (worldLens.js); bańka w ośrodku tylko w hipercruisie z `?hcOsrodek=1` i w warpie z `?warpOsrodek=1` (A/B).
// JEDEN WARP (sprzątanie S1, 2026-10-26): bez stylów skoku — dawne 'rulon' (zwinięcie świata), 'akcent' (naciąg,
// pęknięcie, sprężenie) i 'soczewka' (soczewka bańki przez cały skok) usunięte; widowiskiem jest świat w soczewce.
//
// Fazy (widok ze środka):
//   ŁADOWANIE  gwiazdy wydłużają się płasko (0,32·ładowanie²), świat „wstaje” (β soczewki do 0,9). Kurs stoi od
//              ładowania (rozgrywka: bramka kursu). Ładowanie gry trwa `warp.chargeTime` (0,8 s) — krzywe dema (3 s)
//              biegną po ułamku ładowania; przerwane ładowanie opada w ~0,25 s (β — 0,3 s).
//   SKOK       kop: gwiazdy strzelają w smugi z przestrzałem ×1,4 → 1 (bez ząbka w klatce kopu), fala w punkcie
//              skoku, błysk za rufą, β domyka się do 1; przepływ widoczny rośnie z prędkością gry.
//   PODRÓŻ     smugi gwiazd, świat w soczewce; przepływ = prędkość WIDOCZNA (21 tys. j/s — WARP_FLOW), przy
//              mijanym ciele zwalnia ze statkiem.
//   WYJŚCIE    = PRZYLOT jak u okrętów NPC (warpDrive.js: WARP_EXIT, rampa rozgrywki):
//              ZWOLNIENIE (smugi gwiazd gasną frontem od dziobu, ciała soczewki zanurzają się z nim),
//              WLOT (statek naprawdę leci z prędkością wlotu),
//              HAMOWANIE = jedno zdarzenie (błysk dziobu, blask, fala, żar — WARP_ARRIVAL_ACCENT); dalej ślizg z pędem.
// Kamerą rządzi rig gry (cameraRig.js) — kop, oddalenie, kadr przylotu K1 i wysunięcie przy swobodnym wyjściu są tam.
// Wstrząsy kopu, wyjścia i hamowania zgłasza GRA (src/game/warpShakes.js — te same chwile i wartości; działają też
// w workerze renderu), efekt już nie wstrząsa.

import { warpPalette, heatColor } from './palette.js';
import { WARP_EXIT, warpArrivalSpeed, warpBrakeTime, warpBrakeBubbleFront, warpSizeScale } from '../../game/warpDrive.js';
import { RenderWorld } from '../../render/renderWorld.js';
import { WARP_LENS_PHASE, WARP_LENS_EXIT_SPAN, warpLensBeta, warpLensChargeBeta, warpLensKickBeta } from '../../render/warpLensPhase.js';

/** Kształt bańki względem kadłuba (demo: BUBBLE_SHAPE). */
export const WARP_BUBBLE = Object.freeze({ radiusK: 0.62, asp: 1.35 });
/**
 * Widoczna prędkość przepływu ośrodka w podróży [j/s]. Warp ma JEDNĄ prędkość (QOL 2026-10-03 — biegi
 * przeniesione do PRZELOTU), więc przepływ to `travel` (bieg II dema); `gear2` — normalizator smug gwiazd (demo).
 */
export const WARP_FLOW = Object.freeze({ gear2: 21000, travel: 21000, exitRest: 160, slowMin: 2500 });
/**
 * Hipercruise (E5, 2026-10-22 — ten sam efekt co skok warpa): przepływ ośrodka × (prędkość / ref), w [min, max] —
 * Mk I (20 tys.) ~14 tys., Mk III (40 tys.) ~28 tys. j/s widocznie; wstrząs kopu × shake (zgłasza gra — warpShakes.js:
 * WARP_SHAKE.hyperKickMul, ta sama wartość). Soczewka świata
 * (kompozycja skoku z celem) w hipercruisie wyłączona — gra obok statku zostaje czytelna (hipercruise da się przerwać).
 */
export const HYPER_FLOW = Object.freeze({ ref: 30000, min: 0.2, max: 1.4, shake: 0.5 });
/**
 * Hipercruise BEZ OŚRODKA (zgłoszenie użytkownika 2026-10-23: „usunięcie efektu cząsteczkowego”; zrzuty faz —
 * dominowały drobiny ośrodka: turkusowy front i pomarańczowy warkocz wokół statku od rozruchu do wyjścia): bańka
 * i iskry hamowania to przegródki ośrodka, więc w hipercruisie ich nie ma — zostają smugi gwiazd, soczewka bańki
 * na tle, fale, błyski i żar kadłuba. `?hcOsrodek=1` w adresie (także w workerze renderu) — ośrodek jak w E5 (A/B).
 */
let _hyperMediumSearch = null;
let _hyperMediumOn = false;
export function hyperMediumOn(search = RenderWorld.pageSearch) {
  const s = typeof search === 'string' ? search : '';
  if (s !== _hyperMediumSearch) {
    _hyperMediumSearch = s;
    _hyperMediumOn = /[?&]hcOsrodek=1(?:&|$)/.test(s);
  }
  return _hyperMediumOn;
}
/**
 * OŚRODEK W WARPIE GRACZA — domyślnie WYŁĄCZONY (DECYZJE O1, 2026-10-25: „świat w soczewce jest teraz głównym
 * widowiskiem”; projekt D § 2.7 — turkusowe czoło drobin leżało przed dziobem, w strefie punktu zbiegu soczewki, i rysuje
 * się po planetach): w skoku gracza bez przegródek ośrodka (bańka, iskry hamowania), bez poświaty drobin (`warpVis`)
 * i bez soczewki bańki na mgławicy — ośrodek w skoku gracza nie budzi się wcale. Przyloty i odloty NPC (nić zwiastuna,
 * bańki — arrivals.js) i hipercruise (`hyperMediumOn`) bez zmian. A/B: `?warpOsrodek=1` (adres strony — działa też
 * w workerze renderu); `setWarpMedium(true | false | null)` — wprost (testy, demo; null — wraca do adresu).
 */
let _warpMediumSearch = null;
let _warpMediumOn = false;
let _warpMediumForce = null;
export function setWarpMedium(on) {
  _warpMediumForce = on === true || on === false ? on : null;
}
export function warpMediumOn(search = RenderWorld.pageSearch) {
  if (_warpMediumForce !== null) return _warpMediumForce;
  const s = typeof search === 'string' ? search : '';
  if (s !== _warpMediumSearch) {
    _warpMediumSearch = s;
    _warpMediumOn = /[?&]warpOsrodek=1(?:&|$)/.test(s);
  }
  return _warpMediumOn;
}
// Soczewka świata (worldLens.js): oś β z ZEGARA GRY (src/render/warpLensPhase.js — DECYZJE P1, etap integracji
// 2026-10-26): ładowanie podnosi świat (β do 0,9 · smoothstep ładowania), kop domyka (0,9 → 1 easeOut³ w 0,45 s), lot 1,
// wyjście — front smug gwiazd (soczewka per ciało), przerwane ładowanie opada w 0,3 s. W grze rekord osi liczy strona
// gry (index.html: stepPlayerWarpLensPhase — game.lens, w workerze z migawki); bez niego (demo) — ten sam rekord
// z zegara efektu (WarpPlayerFx.lensPhase). Hipercruise — β = 0.
/**
 * PRZYLOT = JEDNO ZDARZENIE (2026-10-23, user: „przylot staje podwójnie: jeden wybuch haze i drugi wybuch heat”).
 * Pomiar w demie „Pęd”: przy hamowaniu błysk + fala refrakcji, a żar brzegu kadłuba (zanik τ 2,2 s) wyłaniał się
 * 0,6–1,5 s później, gdy kadr przylotu dosuwał kamerę — drugi „wybuch”. Teraz wszystko w chwili zatrzymania: fala
 * hamowania, błysk, wstrząs (gra — warpShakes.js), iskry (ośrodek — tylko A/B), żar kadłuba jako krótki impuls
 * (`heatTau`). Hipercruise — dawny zanik żaru.
 */
export const WARP_ARRIVAL_ACCENT = Object.freeze({ heatTau: 0.45, heatTauHyper: 2.2 });
/**
 * Cień kadłuba GRACZA w masce słońca w skoku (pisze advance, mnoży siłę okluderu `hexShips3D.js`): ładowanie gasi,
 * w locie 0, po zatrzymaniu wraca. Smuga cienia na tle (kanał G — „długa smuga cienia”) przy słońcu z boku kursu
 * jechała za statkiem jak ciemny prostokąt na całą długość kadłuba (demo „Pęd”, 2026-10-19) — tło skoku jest
 * w nieskończoności. Dawna soczewka (2026-09) robiła to samo (`suppressShadowShafts`, usunięte w zadaniu 22).
 */
export const WARP_HULL_SHADOW = { player: 1 };
/** Kadłub referencyjny dema (Atlas) — fale skalują się długością kadłuba. */
const REF_LENGTH = 1800;

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const easeOut3 = (x) => { const u = 1 - clamp01(x); return 1 - u * u * u; };
const lerp = (a, b, t) => a + (b - a) * t;
/** Impuls 0 → 1 → 0 (narasta w `rise`, gaśnie z czasem `fall`). */
export const pulse = (t, rise, fall) => (t <= 0 ? 0 : (1 - Math.exp(-t / rise)) * Math.exp(-t / fall));

/**
 * Rozciągnięcie gwiazd: ładowanie → przestrzał przy kopnięciu → lot → gaśnięcie przy wyjściu (demo 1:1).
 * `fromCharge` (warp gracza — poprawka ząbka, projekt D § 2.2): mnożnik prędkości tylko na przyrost ponad 0,32 z końca
 * ładowania — w klatce kopu smugi nie skracają się 0,32 → 0,18 (przepływ widoczny 900 j/s daje × 0,568), tylko rosną
 * z 0,32. Bez flagi (hipercruise, demo) — jak dawniej.
 */
export function warpStarStretch(tau, tKick, tExit, charge, speedFrac, exitDur = WARP_EXIT.slow, fromCharge = false) {
  if (tau < tKick) return 0.32 * charge * charge;
  let s;
  const k = tau - tKick;
  if (k < 0.12) s = lerp(0.32, 1.4, easeOut3(k / 0.12));
  else s = lerp(1.4, 1.0, smooth(0.12, 0.55, k));
  const mul = 0.55 + 0.45 * clamp01(speedFrac);
  s = fromCharge ? 0.32 + (s - 0.32) * mul : s * mul;
  if (tau >= tExit) {
    const u = (tau - tExit) / exitDur;
    s *= u >= 1 ? 0 : Math.pow(1 - u, 1.6);
  }
  return s;
}

const NEVER = -1e9;

/**
 * Stan skoku gracza. advance(t, dt, game, map, medium) → ruch kamery ośrodka → fill(...):
 *   game = { state: 'idle'|'charging'|'active', charge (0..1), chargeTime, speed (j/s),
 *            angle (kurs), x, y (poza renderu kadłuba, świat), length, width (kadłub, j.),
 *            palette (id), entity, vRelX/Y, exitRamp (warp.exitRamp gry albo null),
 *            flyby (zwolnienie przy mijanych ciałach 0..1), cruise (nominalna prędkość skoku) }
 *   map   = { camX, camY } — kamera gry (pozycje względem niej).
 */
export class WarpPlayerFx {
  constructor() {
    this.bubble = null;   // przegródka ośrodka (tworzy sterownik: newWarpSlot)
    this.push = null;     // przegródka iskier hamowania (tworzy sterownik)
    this.hull = { on: false, revealMode: 0, revealLine: 0, seamLine: 0, seamW: 0, seam: 0, seamRGB: [0, 0, 0], heat: 0, heatRGB: [0, 0, 0], rimW: 0 };
    this.ramp = { slow: WARP_EXIT.slow, coast: WARP_EXIT.coast, brake: 0.2, vArr: 16000, v0: 16000, tBrake: 1.15, tHalt: 1.35 };
    this.reset();
  }

  reset() {
    this.mode = 'idle';          // idle | charging | warp | exit
    this.charge = 0;
    this.kickT = NEVER;
    this.exitT = NEVER;
    this.kickMX = 0;             // punkt skoku w przestrzeni ośrodka (widocznej)
    this.kickMY = 0;
    this.flowAtExit = 0;
    this.lensAtExit = 0;          // β soczewki świata w chwili wyjścia
    this.flowGear = WARP_FLOW.travel;
    this.chargeBoost = 1;
    this.chargeK = 1;
    this.angle = 0;
    this.hyper = false;          // efekt prowadzi hipercruise (game.hyper — od rozruchu do końca wyjścia)
    this.lensGame = null;        // rekord osi β strony gry (game.lens — warpLensPhase.js) albo null (demo: z zegara efektu)
    this.abortT = NEVER;         // przerwane ładowanie (rekord własny — demo)
    this.abortBeta = 0;
    this.lensExitLive = false;   // wiek wyjścia rekordu własnego trwa po bezczynności (do zatrzymania + WARP_LENS_EXIT_SPAN)
    if (this._lensArriving === undefined) this._lensArriving = null;   // dolot rekordu własnego (setLensFrame — demo)
    if (!this._lensOwn) {
      this._lensOwn = { state: 'idle', charge: 0, kickAge: NaN, exitAge: -1, exitSlow: NaN, exitHalt: 0, exitBeta: NaN,
        abortAge: -1, abortBeta: 0, hyper: false, arriving: null, zoomRef: NaN, zoomJump: NaN, arrivalFill: NaN, beta: 0 };
    }
    this.hull.on = false;
    WARP_HULL_SHADOW.player = 1;
  }

  /** Czy skok gracza czegoś jeszcze potrzebuje (ośrodek, gwiazdy, kadłub). */
  get active() {
    return this.mode !== 'idle' || this.charge > 0.001;
  }

  /** Wiek wyjścia [s] (klatka efektu). */
  exitAge(t) {
    return t - this.exitT;
  }

  visibleFlowAt(t) {
    return lerp(900, this.flowGear, easeOut3((t - this.kickT) / 0.45));
  }

  /**
   * Rekord osi β soczewki świata (src/render/warpLensPhase.js — kształt createWarpLensPhase): w grze rekord strony gry
   * (game.lens — zegar gry, ten sam w trybie off i w workerze), bez niego (demo, testy) — własny z zegara efektu w chwili t
   * (stan automatu, wieki kopu i wyjścia, rampa, β wyjścia, przerwane ładowanie).
   */
  lensPhase(t) {
    if (this.lensGame) return this.lensGame;
    const s = this._lensOwn;
    const m = this.mode;
    s.state = m === 'charging' ? 'charging' : (m === 'warp' ? 'active' : 'idle');
    s.charge = m === 'charging' ? this.charge : 0;
    s.kickAge = this.kickT > NEVER * 0.5 ? Math.max(0, t - this.kickT) : NaN;
    // wiek wyjścia jak strona gry (stepWarpLensPhase): od wyjścia do zatrzymania + WARP_LENS_EXIT_SPAN, także po przejściu
    // automatu w bezczynność (trzymanie celu w soczewce trwa dłużej niż efekt wyjścia); nowe ładowanie go kończy
    const exitOn = m === 'exit'
      || (m === 'idle' && this.lensExitLive && t - this.exitT <= this.ramp.tHalt + WARP_LENS_EXIT_SPAN);
    s.exitAge = exitOn ? Math.max(0, t - this.exitT) : -1;
    s.exitSlow = this.ramp.slow;
    s.exitHalt = this.ramp.tHalt;
    s.exitBeta = exitOn ? this.lensAtExit : NaN;
    const a = t - this.abortT;
    s.abortAge = m === 'idle' && a >= 0 && a <= WARP_LENS_PHASE.abortTime ? a : -1;
    s.abortBeta = this.abortBeta;
    s.hyper = this.hyper;
    s.arriving = this._lensArriving;
    return s;
  }

  /**
   * Kadr soczewki rekordu własnego (demo bez rekordu gry — dema/warp-ped.js; gra: index.html stepPlayerWarpLensPhase
   * wypełnia te pola w rekordzie strony gry): zoom odniesienia skoku i kadr skoku [px CSS / j.] (rig: zoomRef,
   * zoomRef × warpZoomOut), ułamek kadru przylotu (cameraRigTune.warpArrivalFill) i dolot (ślizg z pędem trwa — null:
   * worldLens bierze zatrzymanie z czasu). Bez kadru (NaN) podgląd kadru przylotu celu nie ma miękkiego minimum z kadrem
   * skoku — cel przy dolocie rośnie bez granicy, póki kamera go nie dogoni.
   */
  setLensFrame(zoomRef, zoomJump, arrivalFill, arriving = null) {
    const s = this._lensOwn;
    s.zoomRef = Number(zoomRef) > 0 ? Number(zoomRef) : NaN;
    s.zoomJump = Number(zoomJump) > 0 ? Number(zoomJump) : NaN;
    s.arrivalFill = Number(arrivalFill) > 0 ? Number(arrivalFill) : NaN;
    this._lensArriving = arriving === true || arriving === false ? arriving : null;
  }

  /** β soczewki świata (0 — prawdziwy widok planet, 1 — soczewka skoku) — warpLensBeta(lensPhase(t)); hipercruise — 0. */
  lensBeta(t) {
    if (this.hyper) return 0;
    return warpLensBeta(this.lensPhase(t));
  }

  /**
   * Prędkość WIDOCZNA kamery w ośrodku wzdłuż kursu [j/s] albo null (ośrodek idzie za prawdziwą
   * kamerą gry). Skok: 900 → bieg w 0,45 s; wyjście: w zwolnieniu z prędkości widocznej do
   * prędkości wlotu (= prawdziwa prędkość statku na końcu zwolnienia), dalej prawdziwa kamera —
   * statek naprawdę leci i hamuje (rampa rozgrywki).
   */
  visibleFlow(t) {
    if (this.mode === 'warp') return this.visibleFlowAt(t);
    if (this.mode === 'exit') {
      const tau = t - this.exitT;
      if (tau < this.ramp.slow) return lerp(this.flowAtExit, this.ramp.vArr, smooth(0, this.ramp.slow, tau));
    }
    return null;
  }

  advance(t, dt, game, map, medium) {
    const state = game.state === 'active' ? 'active' : (game.state === 'charging' ? 'charging' : 'idle');
    // Oś β soczewki świata z gry (warpLensPhase.js — rekord strony gry; null — własny z zegara efektu).
    this.lensGame = game.lens || null;
    // Hipercruise przejmuje efekt od rozruchu; flaga trzyma się przez wyjście (do bezczynności).
    if (state !== 'idle') this.hyper = game.hyper === true;
    else if (this.mode === 'idle' && this.charge <= 0.001) this.hyper = false;
    if (state === 'charging') {
      if (this.mode !== 'charging') this.mode = 'charging';
      this.lensExitLive = false;
      this.charge = clamp01(game.charge);
      // Ładowanie gry trwa `chargeTime` (0,8 s), w demie 3 s: naprężenie ×k (całkowane przez całe
      // ładowanie), wzbudzenie (zanik 1,1 s) ×k^0,6.
      const ct = Number(game.chargeTime) > 0 ? game.chargeTime : 3;
      this.chargeK = Math.max(1, Math.min(4, 3.0 / ct));
      this.chargeBoost = Math.pow(this.chargeK, 0.6);
    } else if (state === 'active') {
      if (this.mode !== 'warp') {
        this.mode = 'warp';
        this.kickT = t;
        this.flowGear = WARP_FLOW.travel;
        this.kickMX = medium.camMX + (game.x - map.camX);
        this.kickMY = medium.camMY + (game.y - map.camY);
      }
      this.charge = 1;
      if (this.hyper) {
        // Hipercruise: przepływ za prędkością prowadzoną (rozpęd, strefy, dolot) — skala 20–40 tys. j/s.
        const k = (Number(game.cruise) || 0) / HYPER_FLOW.ref;
        this.flowGear = WARP_FLOW.travel * Math.max(HYPER_FLOW.min, Math.min(HYPER_FLOW.max, k));
      } else {
        // Przy mijanym ciele statek zwalnia (warpDrive.js: warpFlybySlowdown) — przepływ widoczny z nim
        // (demo: U = max(2500, bieg · (v / vc)^0,6)); strefy (pas, okolice planet) przepływu nie ruszają.
        const fly = Number.isFinite(game.flyby) ? clamp01(game.flyby) : 1;
        this.flowGear = Math.max(WARP_FLOW.slowMin, WARP_FLOW.travel * Math.pow(fly, 0.6));
      }
    } else {
      if (this.mode === 'warp') {
        this.mode = 'exit';
        this._beginExit(t, dt, game);
      } else if (this.mode === 'charging') {
        this.mode = 'idle';   // przerwane ładowanie — bańka zwija się niżej
        this.abortT = t;      // rekord własny osi β (demo): świat opada w WARP_LENS_PHASE.abortTime
        this.abortBeta = this.hyper ? 0 : warpLensChargeBeta(this.charge);
      }
      if (this.mode === 'exit' && t - this.exitT > this.ramp.tHalt + 2.4) this.mode = 'idle';
      if (this.mode !== 'exit') this.charge = Math.max(0, this.charge - dt / 0.25);
    }
    this.angle = Number(game.angle) || 0;
    // Cień kadłuba w skoku (WARP_HULL_SHADOW): ładowanie gasi, lot 0, po zatrzymaniu wraca.
    let shadow = 1;
    if (this.mode === 'warp') shadow = 0;
    else if (this.mode === 'exit') shadow = smooth(this.ramp.tHalt - 0.2, this.ramp.tHalt + 0.8, t - this.exitT);
    else shadow = 1 - smooth(0, 1, this.charge);
    WARP_HULL_SHADOW.player = shadow;
  }

  // Wyjście: oś z rampy rozgrywki (warp.exitRamp — ta sama prędkość wlotu i hamowanie), wiek
  // zsynchronizowany z jej zegarem (czas gry); bez rampy — zapas z kadłuba.
  _beginExit(t, dt, game) {
    const r = game.exitRamp;
    const R = this.ramp;
    const L = Math.max(40, Number(game.length) || REF_LENGTH);
    if (r && r.active) {
      R.slow = r.slow; R.coast = r.coast; R.brake = r.brake; R.vArr = r.vArr; R.v0 = r.v0;
      R.tBrake = r.tBrake; R.tHalt = r.tHalt;
      this.exitT = t - Math.max(0, Number(r.age) || 0);
    } else {
      R.slow = WARP_EXIT.slow; R.coast = WARP_EXIT.coast;
      R.vArr = warpArrivalSpeed(L); R.v0 = R.vArr;
      R.brake = warpBrakeTime(L, R.vArr);
      R.tBrake = R.slow + R.coast; R.tHalt = R.tBrake + R.brake;
      this.exitT = t;
    }
    this.flowAtExit = Math.max(WARP_FLOW.exitRest, this.visibleFlowAt(t - dt));
    // β wyjścia rekordu własnego (demo): β kopu z klatki przed wyjściem (warpLensPhase.js — wyjście w trakcie kopu < 1).
    this.lensAtExit = warpLensKickBeta(Math.max(0, t - dt - this.kickT));
    // Ładowanie zużyte (po wyjściu efekt nie wraca przez gałąź „przerwanego ładowania”).
    this.charge = 0;
    this.lensExitLive = !this.hyper;   // hipercruise — β = 0, bez trzymania
  }

  /** Przejścia i klatka naraz (testy, proste użycie). Sterownik woła advance → ruch kamery → fill. */
  update(t, dt, game, frame, map, medium) {
    this.advance(t, dt, game, map, medium);
    this.fill(t, game, frame, map, medium);
  }

  fill(t, game, frame, map, medium) {
    const hull = this.hull;
    hull.on = false;
    if (!this.active && t - this.kickT > 1.5) return;
    const L = Math.max(40, Number(game.length) || REF_LENGTH);
    const R = L * WARP_BUBBLE.radiusK;
    const a = R * WARP_BUBBLE.asp;
    const sizeK = L / REF_LENGTH;
    const pal = warpPalette(game.palette);
    const c = Math.cos(this.angle);
    const sn = Math.sin(this.angle);
    const sx = game.x - map.camX;   // statek względem kamery (świat, y w dół)
    const sy = game.y - map.camY;
    const mode = this.mode;
    const cT = mode === 'charging' ? this.charge : (mode === 'idle' ? this.charge : 1);
    const exiting = mode === 'exit';
    const tx = t - this.exitT;
    const ramp = this.ramp;
    const tb = tx - ramp.tBrake;   // czas od początku hamowania (wyjście)
    // Hipercruise bez ośrodka (HYPER_FLOW wyżej: hyperMediumOn) — bez przegródek i poświaty drobin; warp gracza też
    // (DECYZJE O1 — warpMediumOn, `?warpOsrodek=1`), w warpie dodatkowo bez soczewki bańki na mgławicy.
    const medOn = this.hyper ? hyperMediumOn() : warpMediumOn();
    const bubbleLensOn = this.hyper || medOn;

    // --- bańka gracza w ośrodku ---
    const bub = this.bubble;
    if (bub) {
      const inhale = smooth(0.78, 1.0, cT) * (mode === 'charging' ? 1 : 0);
      let A = 0;
      if (mode === 'charging' || mode === 'idle') A = Math.pow(smooth(0, 0.85, cT), 1.2);
      else if (mode === 'warp') A = 1;
      else if (exiting) A = tx < ramp.tHalt + 0.2 ? 1 : 0;
      bub.on = A > 0.001 && (!exiting || tx < ramp.tHalt + 0.35);
      bub.x = sx; bub.y = sy;
      bub.angle = this.angle;
      // Prędkość bańki w przestrzeni ośrodka: prędkość widoczna kamery + ruch statku w kadrze.
      bub.vx = medium.flowX + (Number(game.vRelX) || 0);
      bub.vy = medium.flowY + (Number(game.vRelY) || 0);
      bub.R = R;
      bub.asp = WARP_BUBBLE.asp;
      bub.A = A;
      // Po wyjściu jak bańka przylotu NPC: zapada się od dziobu przy hamowaniu.
      bub.front = exiting ? warpBrakeBubbleFront(tb, ramp.brake) : 3;
      bub.strain = mode === 'warp' ? 0.9 : exiting ? 1.1 : (1.25 + 3.2 * inhale) * this.chargeK;
      bub.excite = mode === 'warp' ? 1 : exiting ? 1.4 : (1.6 + 1.2 * inhale) * this.chargeBoost;
      bub.turb = 0.13;
      bub.pullR = 1; bub.pullGain = 0; bub.jetSpeed = 0; bub.heraldLen = 0; bub.heraldGain = 0;
      bub.releaseT = Infinity;
      bub.rearT = exiting ? this.exitT + ramp.tHalt + 0.05 : Infinity;
      bub.lensAmp = 26 * A;
      if (bub.on) {
        if (medOn) frame.pushBubble(bub);
        if (bubbleLensOn) frame.addLens(sx, sy, this.angle, a, R, bub.lensAmp, bub.front);
      }
    }

    // --- gwiazdy: płaskie smugi wzdłuż kursu, front wyjścia ---
    const st = frame.stars;
    st.angle = this.angle;
    st.refX = sx;
    st.refY = sy;
    const visFlow = this.visibleFlow(t);
    const speedFrac = clamp01((visFlow !== null ? visFlow : (Number(medium.flow) || 0)) / WARP_FLOW.gear2);
    if (mode === 'charging' || mode === 'idle') {
      st.stretch = 0.32 * cT * cT;
      st.warpTint = cT * 0.4;
    } else if (mode === 'warp') {
      // warp gracza — bez ząbka w klatce kopu (fromCharge); hipercruise jak dawniej (DECYZJE O3)
      st.stretch = warpStarStretch(t, this.kickT, Infinity, 1, speedFrac, WARP_EXIT.slow, !this.hyper);
      st.warpTint = 1;
    } else {
      st.stretch = warpStarStretch(t, this.kickT, this.exitT, 1, 1, ramp.slow);
      st.warpTint = 1 - smooth(0, ramp.slow, tx);
      st.frontOn = 1;
      st.frontS = lerp(18000, -18000, smooth(0, ramp.slow, tx));
    }

    if (medOn) {
      frame.warpVis = Math.max(frame.warpVis, mode === 'warp' ? smooth(this.kickT, this.kickT + 0.4, t)
        : (exiting ? 1 - smooth(0, ramp.slow, tx) : 0));
    }
    // Po zatrzymaniu (i iskrach hamowania) ośrodek gaśnie — bez chmury drobin wokół okrętu.
    if (exiting && tx >= ramp.tHalt + 0.6 && tx < ramp.tHalt + 2.2) frame.mediumFade = Math.max(frame.mediumFade, 4);

    // --- kop: fala w punkcie skoku (przestrzeń widoczna), błysk za rufą ---
    const age = t - this.kickT;
    if (age >= 0 && age < 1.4) {
      const kx = this.kickMX - medium.camMX;
      const ky = this.kickMY - medium.camMY;
      frame.addWave(kx, ky, 9000 * age * sizeK, 320 * sizeK, 8 * (1 - age / 1.4) ** 2);
      if (age < 0.35) frame.addFlash(kx - c * L * 0.62, ky - sn * L * 0.62, R * 0.5, (1 - age / 0.35) ** 2, pal, false);
    }

    // --- wyjście: hamowanie jak przylot NPC (arrivals.js: brakeEffects) ---
    if (exiting) {
      const size = warpSizeScale(L);
      const p = this.push;
      if (p) {
        p.on = medOn && tb > -0.05 && tb < 0.5;
        if (p.on) {
          p.x = sx; p.y = sy;
          p.angle = this.angle;
          p.vx = 0; p.vy = 0;
          p.R = L * 0.62;
          p.asp = 1.35;
          p.A = 0;
          p.jetSpeed = Math.max(5200 * size, ramp.vArr * 0.55);
          p.excite = 1;
          p.heraldGain = 0; p.heraldLen = 0; p.pullGain = 0;
          p.releaseT = this.exitT + ramp.tBrake + 0.02;
          p.rearT = Infinity;
          frame.pushBubble(p);
        }
      }
      if (tb >= 0 && tb < 0.35) {
        const k = Math.pow(1 - tb / 0.35, 2);
        const bx = sx + c * L * 0.52;
        const by = sy + sn * L * 0.52;
        frame.addFlash(bx, by, L * 0.55, k * 1.8, pal, false);
        frame.addGlare(bx, by, this.angle + Math.PI * 0.5, L * 1.6, k * 1.2, pal);
      }
      if (tb >= 0 && tb < 1.3) {
        const ag = tb / 1.3;
        frame.addWave(sx + c * L * 0.5, sy + sn * L * 0.5, L * (0.25 + 3.2 * easeOut3(ag)), L * 0.24, 11 * (1 - ag) ** 2 * Math.min(1.2, size * 1.2));
      }
      // Żar przy hamowaniu (cała energia w kadłub) — impuls razem z błyskiem (WARP_ARRIVAL_ACCENT), nie osobny żar
      // wyłaniający się po nim.
      const heatTau = this.hyper ? WARP_ARRIVAL_ACCENT.heatTauHyper : WARP_ARRIVAL_ACCENT.heatTau;
      if (tb >= 0 && tb < 8) {
        hull.on = true;
        hull.revealMode = 0;
        hull.revealLine = 0;
        hull.seamLine = -L * 4;
        hull.seam = 0;
        hull.seamW = Math.max(5, L * 0.007);
        hull.heat = 0.95 * smooth(0, 0.06, tb) * Math.exp(-Math.max(0, tb - 0.06) / heatTau);
        heatColor(hull.heat, hull.heatRGB);
        hull.rimW = Math.max(8, L * 0.011);
        if (hull.heat < 0.003 && tb > 0.1) hull.on = false;
      }
    }
  }
}
