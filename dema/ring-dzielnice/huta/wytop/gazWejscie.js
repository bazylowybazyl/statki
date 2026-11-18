// HUTA — wytop: GAZ KOMORY — WEJŚCIE KROKU POLA ze stanu symulacji (czysty moduł, bez three i DOM).
//
// `createGasPacker()` → `pack(sim, rec, out, metal)`: po każdym kroku symulacji komory (i po `takeGas(rec)`) składa
// tablicę wejścia kroku pola gazu w układzie `GAZ_IN` (`gaz.js`). Krok pola (`gazKrok.js` → `gazSiatka.js`) czyta
// TYLKO tę tablicę — przy wpięciu w grę to blok migawki klatki o stałym układzie (pole nie widzi symulacji).
//
// Z symulacji bierze: tryb wentylacji i grawitacji, bryłę w środku (kupa albo kula — elipsoida ze środkiem, półosiami
// i prędkością; przy zrzucie kula spada i wypycha gaz), lustro masy w leju (średnia grubość pola masy na pierścieniach
// + prędkość lustra — rosnąca masa wypycha gaz), klatkę cewek (strefa porowata), światło bryły (te same liczby co
// `obraz.js` daje ścianom komory) i barwę wyświetlacza, a z rekordów źródeł — plamy, kierunki i masy tego kroku.
// (Osobny plik, a nie `gaz.js`: `komora.js` importuje `gaz.js`, więc `gaz.js` nie może importować komory.)
import { KOMORA } from './geometria.js';
import { LICZNIK, PROCES, STAN, UNITS_PER_TON } from './komora.js';
import { MASA, MASA_STRIDE } from './masa.js';
import {
  GAZ_FIZ, GAZ_IN, GAZ_IN_N, GAZ_LAKE_N, GAZ_PROCES, GAZ_REC, GAZ_SLOTS, GAZ_SRC, GAZ_STRIDE, gazHeatPower, gazVentCpu
} from './gaz.js';

/** Barwy wyświetlacza grawitacji (kopie `DISPLAY_COOL` / `DISPLAY_WARM` z `wyswietlacz.js` — test pilnuje równości). */
export const GAZ_DISPLAY_COOL = Object.freeze([0.14, 0.82, 1.0]);
export const GAZ_DISPLAY_WARM = Object.freeze([1.0, 0.56, 0.12]);
/** Moc światła kuli na komorze (`U.t3.z` w `wspolneTSL.js`). */
export const GAZ_LIGHT_GAIN = 0.6;
/** Wysokość kupy rudy względem promienia obrysu (elipsoida `heapA` × `heapB`, `komora.js`: `heapTop`). */
export const GAZ_HEAP_FLAT = PROCES.heapB / PROCES.heapA * 0.94;
/** Bryła stała pola jest o tyle mniejsza od bryły rysowanej (plamy źródeł leżą tuż nad powierzchnią). */
export const GAZ_BODY_SHRINK = 0.96;
/** Rampa grawitacji dla pola [s] (wypór narasta płynnie). */
export const GAZ_GRAV_RAMP = 0.15;

/**
 * BRYŁA W ŚRODKU komory ze stanu `S` (tablica `STAN` — także wymieszana między krokami dla klatki obrazu):
 * `out` = [x, y, z, półoś pozioma, półoś pionowa] bryły RYSOWANEJ — kupa rudy (elipsoida spłaszczona; w topieniu
 * obejmuje jądro) albo kula (przy zrzucie wydłużona w pionie); półoś 0 — bryły nie ma (pusta komora, masa w leju).
 */
export function gasBodyOf(S, out) {
  const pooling = S[STAN.impactT] >= 0;
  const R = S[STAN.radius];
  const ballOn = R > 0.5 && !pooling;
  const heapR = S[STAN.heapN] > 0 ? S[STAN.heapR] : 0;
  let rx = 0;
  let ry = 0;
  if (heapR > 1) {
    rx = Math.max(heapR, ballOn ? R : 0);
    ry = Math.max(heapR * GAZ_HEAP_FLAT, ballOn ? R : 0);
  } else if (ballOn) {
    rx = R * S[STAN.wide];
    ry = R * S[STAN.squash];
  }
  out[0] = S[STAN.offX];
  out[1] = S[STAN.offY];
  out[2] = S[STAN.offZ];
  out[3] = rx;
  out[4] = ry;
  return out;
}

/**
 * Pakowacz wejścia (trzyma stan między krokami: lustro masy z poprzedniego kroku, rampę grawitacji).
 * `pack(sim, rec, out, metal)`: `rec` — rekordy źródeł po `takeGas` (`Float32Array(32 × 12)`), `out` —
 * `Float32Array(GAZ_IN_N)`, `metal` — metal obrazu (barwa światła; domyślnie metal symulacji). Bez alokacji.
 */
export function createGasPacker() {
  const lakePrev = new Float32Array(GAZ_LAKE_N);
  const body = new Float64Array(5);
  const vent = new Float64Array(2);
  let lakeOn = false;
  let grav = 0;
  const NA = MASA.na;
  const NR = MASA.nr;

  function pack(sim, rec, out, metal = null) {
    const V = sim.view;
    const S = V.stan;
    const P = V.stanPrev;
    const C = V.counters;
    const M = metal || sim.metal;
    const dt = 1 / 60;
    const I = GAZ_IN;
    out[I.dt] = dt;
    out[I.pole] = S[STAN.dspSpeed];
    // grawitacja z rampą (wypór nie włącza się skokiem)
    const gTarget = S[STAN.grav] > 0.5 ? 1 : 0;
    const gStep = dt / GAZ_GRAV_RAMP;
    grav = gTarget > grav ? Math.min(gTarget, grav + gStep) : Math.max(gTarget, grav - gStep);
    out[I.grav] = grav;
    out[I.wentyl] = S[STAN.wentyl];

    // BRYŁA W ŚRODKU: kupa (elipsoida spłaszczona) albo kula (przy zrzucie wydłużona); po zetknięciu z lejem — brak
    const pooling = S[STAN.impactT] >= 0;
    const R = S[STAN.radius];
    const ballOn = R > 0.5 && !pooling;
    const heapR = S[STAN.heapN] > 0 ? S[STAN.heapR] : 0;
    gasBodyOf(S, body);
    const rx = body[3];
    const ry = body[4];
    out[I.bodyX] = S[STAN.offX];
    out[I.bodyY] = S[STAN.offY];
    out[I.bodyZ] = S[STAN.offZ];
    out[I.bodyRx] = rx * GAZ_BODY_SHRINK;
    out[I.bodyRy] = ry * GAZ_BODY_SHRINK;
    out[I.bodyVx] = (S[STAN.offX] - P[STAN.offX]) / dt;
    out[I.bodyVy] = (S[STAN.offY] - P[STAN.offY]) / dt;
    out[I.bodyVz] = (S[STAN.offZ] - P[STAN.offZ]) / dt;
    if (!(rx > 0) || Math.abs(out[I.bodyVy]) > 4000) { out[I.bodyVx] = 0; out[I.bodyVy] = 0; out[I.bodyVz] = 0; }
    // obrót bryły wokół osi pionowej: kupa obraca się w polu, kula wiruje (powierzchnia ω · R · (n.z, 0, −n.x))
    out[I.bodyOm] = !(rx > 0) ? 0 : heapR > 1 ? S[STAN.heapOm] : S[STAN.omega];
    // temperatura bryły dla gazu przy jej powierzchni: kula — temperatura kąpieli, kupa — jej średni żar
    out[I.bodyT] = !(rx > 0) ? 0 : heapR > 1 ? Math.min(1, 0.8 * S[STAN.heapHeat]) : Math.max(0, Math.min(1, S[STAN.temp]));

    // DZWON SSAWY: lokalny upust oparów, gdy ssawa ściąga czapę (stan 2)
    out[I.bellX] = S[STAN.mouthX];
    out[I.bellY] = S[STAN.mouthY];
    out[I.bellOn] = S[STAN.suck] === 2 ? 1 : 0;
    // OKAPY: drożność upustu (żaluzje poniżej najmniejszego otwarcia roboczego dławią odciąg — jak w symulacji)
    out[I.hood] = Math.max(0, Math.min(1, S[STAN.hood] / GAZ_PROCES.hoodMin));
    // CYKL ODCIĄGU (runda 6): siła ciągu — mnożnik wydatku wentylacji 0 g (1 poza cyklem)
    const draw = S[STAN.draw] > 0 ? S[STAN.draw] : 1;
    out[I.draw] = draw;
    // PASY ŚWIATŁA w gardłach okapów: ta sama jasność co pas w `odciag.js` (przepływ × ssanie 0 g × otwarcie żaluzji;
    // `OXY_FLOW_REF` 1,2 t/s z `obraz.js`) — pas oświetla gaz przy wlocie
    {
      const flowK = Math.min(1, Math.min(1, S[STAN.gasFlow] / 1.2) * 1.6);
      const suck = Math.max(0, Math.min(1, S[STAN.wentyl]));
      const hood = Math.max(0, Math.min(1, S[STAN.hood]));
      out[I.hoodGlow] = flowK * suck * (0.7 * hood + 0.3);
    }

    // CEWKI
    out[I.cageX] = S[STAN.cageX];
    out[I.cageY] = S[STAN.cageY];
    out[I.cageZ] = S[STAN.cageZ];
    out[I.coilR] = S[STAN.mach];
    out[I.coilY] = S[STAN.machY];

    // ŚWIATŁO bryły (jak `WytopObraz.frame`): kula, rozżarzona kupa albo masa w leju
    const funnelUnits = C[LICZNIK.funnel] + (pooling ? C[LICZNIK.metal] : 0);
    const massOn = pooling && V.masaOn === 1 && funnelUnits > 0;
    const pool = pooling ? Math.min(1, Math.max(0, S[STAN.impactT]) / 0.8) : 0;
    const rBall = ballOn ? R : massOn ? R + (Math.max(40, 0.55 * S[STAN.lakeR]) - R) * pool : 0;
    const fade = pooling ? Math.min(1, funnelUnits / (2 * UNITS_PER_TON)) : 1;
    const eBall = (3.4 + 5.2 * gazHeatPower(S[STAN.temp])) * rBall * rBall * fade;
    const rHeap = 0.7 * heapR * S[STAN.heapHeat];
    const eHeap = 3.0 * rHeap * rHeap;
    const lightR = Math.max(1, rBall, rHeap);
    const power = Math.max(eBall, eHeap) / (lightR * lightR) * GAZ_LIGHT_GAIN;
    out[I.lightX] = S[STAN.offX];
    out[I.lightY] = S[STAN.offY];
    out[I.lightZ] = S[STAN.offZ];
    out[I.lightR] = lightR;
    out[I.lightCr] = M.light[0] * power;
    out[I.lightCg] = M.light[1] * power;
    out[I.lightCb] = M.light[2] * power;

    // WYŚWIETLACZ: barwa × jasność (światło robocze komory)
    {
      let k = (S[STAN.dspTurn] - 0.35) / 0.6;
      k = k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k);
      const r = GAZ_DISPLAY_COOL[0] + (GAZ_DISPLAY_WARM[0] - GAZ_DISPLAY_COOL[0]) * k;
      const g = GAZ_DISPLAY_COOL[1] + (GAZ_DISPLAY_WARM[1] - GAZ_DISPLAY_COOL[1]) * k;
      const b = GAZ_DISPLAY_COOL[2] + (GAZ_DISPLAY_WARM[2] - GAZ_DISPLAY_COOL[2]) * k;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      out[I.dispR] = (r + (lum - r) * 0.4) * 0.46;
      out[I.dispG] = (g + (lum - g) * 0.4) * 0.46;
      out[I.dispB] = (b + (lum - b) * 0.4) * 0.46;
    }

    // ŹRÓDŁA: rekordy tego kroku (jednostki → tony dymu i oparów)
    let emit = 0;
    for (let q = 0; q < GAZ_SLOTS; q++) {
      const r = q * GAZ_STRIDE;
      const o = I.src + r;
      const units = rec[r + GAZ_REC.units];
      if (units > 0) {
        const t = units / UNITS_PER_TON;
        const sd = rec[r + GAZ_REC.dym];
        out[o + GAZ_SRC.x] = rec[r + GAZ_REC.x];
        out[o + GAZ_SRC.y] = rec[r + GAZ_REC.y];
        out[o + GAZ_SRC.z] = rec[r + GAZ_REC.z];
        out[o + GAZ_SRC.radius] = rec[r + GAZ_REC.radius];
        out[o + GAZ_SRC.dx] = rec[r + GAZ_REC.dx];
        out[o + GAZ_SRC.dy] = rec[r + GAZ_REC.dy];
        out[o + GAZ_SRC.dz] = rec[r + GAZ_REC.dz];
        out[o + GAZ_SRC.speed] = rec[r + GAZ_REC.speed];
        out[o + GAZ_SRC.dym] = t * sd;
        out[o + GAZ_SRC.opar] = t * (1 - sd);
        out[o + GAZ_SRC.temp] = rec[r + GAZ_REC.temp];
        out[o + GAZ_SRC.kind] = rec[r + GAZ_REC.kind];
        emit += t;
      } else {
        for (let k = 0; k < GAZ_STRIDE; k++) out[o + k] = 0;
      }
    }
    out[I.emitT] = emit;
    const qSrc = emit * GAZ_FIZ.volPerTon * 1e6 / dt;
    gazVentCpu(S[STAN.wentyl], qSrc, vent, draw);
    out[I.qRing] = vent[0];
    out[I.qHood] = vent[1];
    out[I.qSrc] = qSrc;
    out[I.metal] = M.index | 0;
    out[I.gasAirT] = S[STAN.gasAirT];
    out[I.time] = S[STAN.time];

    // MASA W LEJU: średnia grubość pola na pierścieniach (+ komórka nad gardzielą), prędkość lustra
    const lake = I.lake;
    if (massOn) {
      const m = V.masa;
      for (let j = 0; j <= NR; j++) {
        let h = 0;
        if (j === 0) h = m[NR * NA * MASA_STRIDE];
        else {
          const base = (j - 1) * NA;
          for (let i = 0; i < NA; i++) h += m[(base + i) * MASA_STRIDE];
          h /= NA;
        }
        const v = lakeOn ? (h - lakePrev[j]) / dt : 0;
        out[lake + j * 2] = h;
        out[lake + j * 2 + 1] = v > 1500 ? 1500 : v < -1500 ? -1500 : v;
        lakePrev[j] = h;
      }
      lakeOn = true;
    } else {
      for (let j = 0; j < GAZ_LAKE_N; j++) { out[lake + j * 2] = 0; out[lake + j * 2 + 1] = 0; lakePrev[j] = 0; }
      lakeOn = false;
    }
    return out;
  }

  return { pack, reset() { lakeOn = false; grav = 0; lakePrev.fill(0); } };
}

/** Nowa tablica wejścia (zera). */
export const createGasInput = () => new Float32Array(GAZ_IN_N);
