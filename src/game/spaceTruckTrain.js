// src/game/spaceTruckTrain.js
//
// CIĄGNIK KOSMICZNY — kinematyka zestawu (czysta: bez three i DOM; dane: src/data/spaceTrucks.js).
//
// Czoło (ciągnik) rusza właściciel: `stepTruckTrain(train, x, y, kąt)` podaje jego pozę z końca kroku, naczepy idą za nim
// krzywą pościgu jak naczepa za siodłem: punkt prowadzenia naczepy (`axleX`, „oś”) jest ciągnięty za przegub na sztywnym
// ramieniu, a zgięcie przegubu ogranicza `maxBend` (bez scyzoryka i wjeżdżania naczep w siebie — także przy cofaniu).
// To ten sam pomysł co pociąg megafrachtowca (megafreighterTrain.js), z dwiema różnicami: punkt prowadzenia nie jest
// środkiem bryły (ogon ścina łuki jak prawdziwa naczepa), a droga przegubu w jednym kroku dzieli się na odcinki
// najwyżej `maxSeg` j. — wynik prawie nie zależy od kroku fizyki (60 / 120 Hz; test). Stałych „na krok” nie ma.
//
// Stan w tablicach typowanych: indeks 0 = ciągnik, 1…n = naczepy; `x, y` = kotwica części (środek bryły), `a` = kurs.
// Poprzednia poza (`px, py, pa`) do interpolacji obrazu: `truckTrainPose(train, i, alpha, out)`. Bez alokacji w kroku.
import { TRUCK_TRACTORS, TRUCK_TRAILER } from '../data/spaceTrucks.js';

const TWO_PI = Math.PI * 2;

function wrapAngle(v) {
  let a = v % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

/** Długość odcinka drogi przegubu [j., skala 1]: krótszy niż ~1/10 ramienia daje błąd kąta rzędu 0,1°. */
export const TRUCK_TRAIN_TUNE = Object.freeze({ maxSeg: 1.5, maxSegs: 32 });

/**
 * Nowy zestaw. `tractorId` — klucz TRUCK_TRACTORS, `trailers` — liczba naczep (0–5 i więcej: bez limitu w kinematyce),
 * `opts`: { scale (domyślnie 1), maxBend (domyślnie z danych) }.
 */
export function createTruckTrain(tractorId, trailers, opts = {}) {
  const tractor = TRUCK_TRACTORS[tractorId] || TRUCK_TRACTORS.standard;
  const scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
  const n = Math.max(0, trailers | 0) + 1;
  const T = TRUCK_TRAILER;
  return {
    tractorId: tractor.id,
    count: n,
    scale,
    maxBend: Number.isFinite(opts.maxBend) ? Number(opts.maxBend) : T.maxBend,
    hitchHead: tractor.hitchX * scale,
    hitchRear: T.rearHitchX * scale,
    kingpin: T.kingpinX * scale,
    arm: (T.kingpinX - T.axleX) * scale,
    maxSeg: TRUCK_TRAIN_TUNE.maxSeg * scale,
    x: new Float64Array(n),
    y: new Float64Array(n),
    a: new Float64Array(n),
    px: new Float64Array(n),
    py: new Float64Array(n),
    pa: new Float64Array(n),
    /** Punkt prowadzenia naczepy (stan pościgu; indeks 0 nieużywany). */
    axX: new Float64Array(n),
    axY: new Float64Array(n),
    /** Przegub poprzednika z końca poprzedniego kroku (start odcinków drogi). */
    hX: new Float64Array(n),
    hY: new Float64Array(n),
    /** Zgięcie przegubu i (naczepa i względem poprzednika) [rad, znak]. */
    bend: new Float32Array(n),
    /** Prędkość czoła z różnicy póz [j./s] i bieg wstecz (cofanie). */
    vx: 0,
    vy: 0,
    speed: 0,
    reverse: false,
    /** Ile razy w ostatnim kroku zadziałał ogranicznik zgięcia (do testów i debug). */
    limited: 0
  };
}

/** Ustawia zestaw w linii za czołem (bez historii ruchu). */
export function placeTruckTrain(train, x, y, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  train.x[0] = x;
  train.y[0] = y;
  train.a[0] = angle;
  let along = train.hitchHead;
  for (let i = 1; i < train.count; i++) {
    const hx = x + c * along;
    const hy = y + s * along;
    train.hX[i] = hx;
    train.hY[i] = hy;
    train.x[i] = hx - c * train.kingpin;
    train.y[i] = hy - s * train.kingpin;
    train.a[i] = angle;
    train.axX[i] = hx - c * train.arm;
    train.axY[i] = hy - s * train.arm;
    train.bend[i] = 0;
    along += train.hitchRear - train.kingpin;
  }
  train.px.set(train.x);
  train.py.set(train.y);
  train.pa.set(train.a);
  train.vx = train.vy = train.speed = 0;
  train.reverse = false;
  train.limited = 0;
  return train;
}

/**
 * Krok kinematyki: czoło w pozie (x, y, angle) z końca kroku, `dt` [s] — tylko do odczytu prędkości. Poza z początku
 * kroku zostaje w `px, py, pa` (interpolacja obrazu).
 */
export function stepTruckTrain(train, x, y, angle, dt) {
  const n = train.count;
  // Pętla, nie TypedArray.set: `set` alokuje ~96 B na wywołanie (pomiar V8, test „bez alokacji”).
  for (let i = 0; i < n; i++) {
    train.px[i] = train.x[i];
    train.py[i] = train.y[i];
    train.pa[i] = train.a[i];
  }
  const invDt = dt > 1e-9 ? 1 / dt : 0;
  const hdx = x - train.x[0];
  const hdy = y - train.y[0];
  train.vx = hdx * invDt;
  train.vy = hdy * invDt;
  train.speed = Math.sqrt(train.vx * train.vx + train.vy * train.vy);
  // Cofanie: ruch przeciw kursowi (próg 1 j./s — postój nie przełącza świateł).
  if (train.speed > 1) train.reverse = train.vx * Math.cos(angle) + train.vy * Math.sin(angle) < 0;
  train.x[0] = x;
  train.y[0] = y;
  train.a[0] = angle;
  train.limited = 0;
  const arm = train.arm;
  const king = train.kingpin;
  const maxBend = train.maxBend;
  const maxSeg = train.maxSeg;
  const maxSegs = TRUCK_TRAIN_TUNE.maxSegs;
  let lx = x;
  let ly = y;
  let la = angle;
  let along = train.hitchHead;
  for (let i = 1; i < n; i++) {
    const hx = lx + Math.cos(la) * along;
    const hy = ly + Math.sin(la) * along;
    // Droga przegubu w tym kroku — odcinki, ramię ciągnięte jak krzywa pościgu (zbieżne niezależnie od kroku fizyki).
    const h0x = train.hX[i];
    const h0y = train.hY[i];
    const ddx = hx - h0x;
    const ddy = hy - h0y;
    const dist = Math.sqrt(ddx * ddx + ddy * ddy);
    let segs = maxSeg > 0 ? Math.ceil(dist / maxSeg) : 1;
    if (segs < 1) segs = 1;
    else if (segs > maxSegs) segs = maxSegs;
    let ax = train.axX[i];
    let ay = train.axY[i];
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const sx = h0x + ddx * t;
      const sy = h0y + ddy * t;
      const dx = sx - ax;
      const dy = sy - ay;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 1e-9) {
        const q = arm / d;
        ax = sx - dx * q;
        ay = sy - dy * q;
      }
    }
    let ang = Math.atan2(hy - ay, hx - ax);
    // Zawinięcie wprost (nie wrapAngle): wywołanie nie wchodzi w kod zoptymalizowany i pakuje liczby — alokacje na przegub.
    let bend = ang - la;
    bend -= TWO_PI * Math.round(bend / TWO_PI);
    if (bend > maxBend) { bend = maxBend; ang = la + maxBend; train.limited++; }
    else if (bend < -maxBend) { bend = -maxBend; ang = la - maxBend; train.limited++; }
    ang -= TWO_PI * Math.round(ang / TWO_PI);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    train.axX[i] = hx - c * arm;
    train.axY[i] = hy - s * arm;
    train.hX[i] = hx;
    train.hY[i] = hy;
    const cx = hx - c * king;
    const cy = hy - s * king;
    train.x[i] = cx;
    train.y[i] = cy;
    train.a[i] = ang;
    train.bend[i] = bend;
    lx = cx;
    ly = cy;
    la = ang;
    along = train.hitchRear;
  }
  return train;
}

/** Poza części `i` w chwili klatki renderu (alpha 0 = początek kroku, 1 = koniec). `out`: { x, y, a }. */
export function truckTrainPose(train, i, alpha, out) {
  const k = alpha >= 1 ? 1 : (alpha <= 0 ? 0 : alpha);
  out.x = train.px[i] + (train.x[i] - train.px[i]) * k;
  out.y = train.py[i] + (train.y[i] - train.py[i]) * k;
  const da = wrapAngle(train.a[i] - train.pa[i]);
  out.a = train.pa[i] + da * k;
  return out;
}

/** Punkt przegubu `i` (i = 1 … count − 1: między częścią i − 1 a i) — hak w chwili końca kroku. */
export function truckTrainHitch(train, i, out) {
  out.x = train.hX[i];
  out.y = train.hY[i];
  return out;
}
