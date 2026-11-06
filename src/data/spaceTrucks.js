// src/data/spaceTrucks.js
//
// CIĄGNIKI KOSMICZNE — dane (czyste, bez three i DOM). Małe ciężarówki à la truck simulator: ciągnik + 1–5 naczep
// z modułami kontenerów na przegubach =o=. Kinematyka: src/game/spaceTruckTrain.js, obraz: src/3d/spaceTrucks3D.js,
// sprite'y: scripts/ciagniki-sprite.mjs, demo: dema/ciagniki.html, opis: docs/PROPOZYCJA-ciagniki.md.
//
// UKŁAD LOKALNY (jak sprite'y kadłubów i markery edytora): j. świata, (0, 0) = kotwica części (środek bryły), +x = dziób,
// +y = w dół obrazka (prawa burta). W świecie gry: X = x·cos a − y·sin a, Y = x·sin a + y·cos a.
//
// ROZMIAR (uzasadnienie liczbami — docs/PROPOZYCJA-ciagniki.md § 1): naczepa wozi MODUŁ 2 × 2 kontenery gry (32,25 ×
// 16,25 j. — dokładnie chwyt drona L roju przeładunkowego), nie pojedynczy kontener 16 × 8 j. Pojedynczy kontener przy
// zoomie 0,1 to 1,6 × 0,8 px, a ciągnik z jedną naczepą ~3,5 px; moduł daje ~7 px z jedną naczepą i ~27 px z pięcioma.
// Wariant 1 × 1 do porównania: `TRUCK_SCALES.container` (ta sama grafika w skali 0,5).
import { CARGO_CONTAINER } from './cargoBays.js';
import { containerFamilyOf, isHazmatCargo } from './cargoContainers.js';

/** Moduł ładunku naczepy: nx × ny kontenerów gry w jednej warstwie (chwyt płaski drona L). */
export const TRUCK_MODULE = Object.freeze({
  nx: 2,
  ny: 2,
  containers: 4,
  L: CARGO_CONTAINER.L * 2 + CARGO_CONTAINER.gap,
  W: CARGO_CONTAINER.W * 2 + CARGO_CONTAINER.gap
});

/** Skale całego zestawu (grafika i kinematyka razem). `module` — domyślna; `container` — naczepa = jeden kontener gry. */
export const TRUCK_SCALES = Object.freeze({ module: 1, container: 0.5 });

/**
 * Tony na naczepę w rachunku ruchu v2 (propozycja): 5 naczep = 20 slotów ≈ kontenerowiec (18 slotów, klasa `hauler` 160 t),
 * 2 naczepy = 60 t ≈ klasa `van`. Kontener na obrazku jest widokiem liczby — jak w cargoContainers.js.
 */
export const TRUCK_TRAILER_TONNES = 30;

/**
 * Światła w układzie lokalnym: [x, y, rodzaj]. Rodzaje (`TRUCK_LIGHT_KINDS`): head — reflektor biały (z kwadem stożka),
 * tail — czerwone rufowe, marker — bursztynowe pozycyjne burt, roof — pięć lampek na dachu kabiny, beacon — pomarańczowy
 * sygnalizator (obrotowy błysk), side — lampki pozycyjne burt ciągnika (czerwona −y, zielona +y).
 */
export const TRUCK_LIGHT_KINDS = Object.freeze({
  head: Object.freeze({ color: [1.0, 0.93, 0.78], power: 4.2, radius: 1.5, minPx: 1.8 }),
  tail: Object.freeze({ color: [1.0, 0.09, 0.05], power: 3.4, radius: 1.3, minPx: 1.6 }),
  marker: Object.freeze({ color: [1.0, 0.52, 0.1], power: 2.4, radius: 0.85, minPx: 0.9 }),
  roof: Object.freeze({ color: [1.0, 0.6, 0.16], power: 2.8, radius: 0.62, minPx: 0 }),
  beacon: Object.freeze({ color: [1.0, 0.42, 0.04], power: 9.0, radius: 2.4, minPx: 2.6 }),
  portSide: Object.freeze({ color: [1.0, 0.08, 0.06], power: 2.6, radius: 0.9, minPx: 1.0 }),
  starSide: Object.freeze({ color: [0.1, 1.0, 0.32], power: 2.6, radius: 0.9, minPx: 1.0 })
});

const pts = (list) => Object.freeze(list.map((p) => Object.freeze(p)));

/**
 * Ciągniki. `hitchX` — przegub (siodło) na osi, `tail` — profil rufy pokładu [x, pół-szerokość] od rufy ku dziobowi (przy
 * zgięciu 50° narożniki naczepy zamiatają obszar za siodłem: ~6 j. wolnego koła wokół przegubu; test), `bounds` — obrys rysunku sprite'a [x0, x1, y0, y1] (z marginesem na fazy),
 * `body` — prostokąt bryły [x0, x1, hw] do obrysów i testów, `nozzles` — dysze MAIN [x, y, d] (wylot, średnica), `trailersMax`
 * — zalecana długość zestawu, `cruise` — prędkość przelotowa [j./s] w demie (w ruchu: `driveModes`).
 */
export const TRUCK_TRACTORS = Object.freeze({
  light: Object.freeze({
    id: 'light', label: 'Lekki', role: 'kurier portowy, kabina nad osią',
    hitchX: -8.5, body: Object.freeze([-11, 15.5, 8.5]), bounds: Object.freeze([-13, 18, -14, 14]),
    tail: pts([[-11, 5.2], [-8.5, 7.2], [-5, 8.5]]),
    nozzles: pts([[-4, -10.2, 2.6], [-4, 10.2, 2.6]]),
    lights: pts([
      [15.2, -5.6, 'head'], [15.2, 5.6, 'head'], [-10.7, -4.2, 'tail'], [-10.7, 4.2, 'tail'],
      [3.4, 0, 'beacon'], [1.5, -12.3, 'portSide'], [1.5, 12.3, 'starSide']
    ]),
    trailersMax: 2, cruise: 210
  }),
  standard: Object.freeze({
    id: 'standard', label: 'Szosowy', role: 'kabina z sypialnią, cztery naczepy',
    hitchX: -12, body: Object.freeze([-14.5, 20.5, 9.2]), bounds: Object.freeze([-16.5, 23, -16, 16]),
    tail: pts([[-14.5, 5.2], [-12, 7.2], [-8.5, 9.2]]),
    nozzles: pts([[-7.5, -11.4, 3.4], [-7.5, 11.4, 3.4]]),
    lights: pts([
      [20.2, -6.4, 'head'], [20.2, 6.4, 'head'], [-14.2, -4.2, 'tail'], [-14.2, 4.2, 'tail'],
      [14.7, -4.2, 'roof'], [14.7, -2.1, 'roof'], [14.7, 0, 'roof'], [14.7, 2.1, 'roof'], [14.7, 4.2, 'roof'],
      [5.4, 0, 'beacon'], [0.5, -14.5, 'portSide'], [0.5, 14.5, 'starSide']
    ]),
    trailersMax: 4, cruise: 175
  }),
  heavy: Object.freeze({
    id: 'heavy', label: 'Ciężki', role: 'długa maska z reaktorem, pociąg drogowy',
    hitchX: -15, body: Object.freeze([-17.5, 31, 9.6]), bounds: Object.freeze([-19.5, 34, -17.5, 17.5]),
    tail: pts([[-17.5, 5.2], [-15, 7.2], [-11.5, 9.6]]),
    nozzles: pts([[-10.5, -13.8, 3.1], [-10.5, -10.3, 2.5], [-10.5, 10.3, 2.5], [-10.5, 13.8, 3.1]]),
    lights: pts([
      [30.6, -6.8, 'head'], [30.6, 6.8, 'head'], [30.9, -3, 'head'], [30.9, 3, 'head'], [-17.2, -4.2, 'tail'], [-17.2, 4.2, 'tail'],
      [11.1, -4.6, 'roof'], [11.1, -2.3, 'roof'], [11.1, 0, 'roof'], [11.1, 2.3, 'roof'], [11.1, 4.6, 'roof'],
      [2.6, 0, 'beacon'], [1.5, -16, 'portSide'], [1.5, 16, 'starSide']
    ]),
    trailersMax: 5, cruise: 140
  })
});

export const TRUCK_TRACTOR_IDS = Object.freeze(Object.keys(TRUCK_TRACTORS));

/**
 * Naczepa (rama z dyszlem). `kingpinX` — oko dyszla (przegub z poprzednikiem), `rearHitchX` — zaczep tylny, `axleX` — punkt
 * prowadzenia (jak oś naczepy: po nim liczy się krzywa pościgu, ogon ścina łuki), `maxBend` — ogranicznik zgięcia przegubu
 * (test: przy tym kącie obrysy sąsiadów się nie dotykają), `body` — [x0, x1, hw] bryły.
 */
export const TRUCK_TRAILER = Object.freeze({
  kingpinX: 24,
  rearHitchX: -22,
  axleX: -8,
  maxBend: 50 * Math.PI / 180,
  body: Object.freeze([-18, 18, 9.1]),
  bounds: Object.freeze([-24.5, 27, -10.5, 10.5]),
  lights: pts([
    [17.4, -9.1, 'marker'], [17.4, 9.1, 'marker'], [0, -9.25, 'marker'], [0, 9.25, 'marker'],
    [-17.6, -8.1, 'tail'], [-17.6, 8.1, 'tail'], [-17.6, -5.6, 'marker'], [-17.6, 5.6, 'marker']
  ])
});

/** Ładunek naczepy: `family` jak CONTAINER_FAMILY + hazmat, `sprite` — komórki atlasu (warianty malowania). */
export const TRUCK_CARGO = Object.freeze({
  standard: Object.freeze({ id: 'standard', label: 'Standard', sprites: Object.freeze(['cargo_std_a', 'cargo_std_b']) }),
  hazmat: Object.freeze({ id: 'hazmat', label: 'Hazmat', sprites: Object.freeze(['cargo_hazmat']) }),
  tank: Object.freeze({ id: 'tank', label: 'Zbiornik', sprites: Object.freeze(['cargo_tank']) }),
  hopper: Object.freeze({ id: 'hopper', label: 'Zsyp', sprites: Object.freeze(['cargo_hopper']) })
});
export const TRUCK_CARGO_IDS = Object.freeze(Object.keys(TRUCK_CARGO));

/** Rodzina naczepy dla surowca (te same reguły co kontenery: cargoContainers.js). */
export function truckCargoForResource(resourceId) {
  if (isHazmatCargo(resourceId)) return 'hazmat';
  return containerFamilyOf(resourceId);
}

/**
 * Linie przewozowe (bez nazw prawdziwych armatorów): `paint` — korpus kontenera / kabina, `accent` — pasy i zderzak (sRGB).
 * Materiał zsypu (`accent` na hałdzie) nadpisuje `TRUCK_HOPPER_LOADS`.
 */
export const TRUCK_LIVERIES = Object.freeze([
  Object.freeze({ id: 'trans-luna', label: 'Trans-Luna', paint: '#1f5fa8', accent: '#e8edf0' }),
  Object.freeze({ id: 'helios', label: 'Helios Cargo', paint: '#d9701c', accent: '#22262b' }),
  Object.freeze({ id: 'ceres', label: 'Ceres Bulk', paint: '#a8301f', accent: '#ecdcb8' }),
  Object.freeze({ id: 'zenit', label: 'Zenit Linie', paint: '#12808a', accent: '#f2c531' }),
  Object.freeze({ id: 'kwarc', label: 'Kwarc', paint: '#d8dcdc', accent: '#2a63b0' }),
  Object.freeze({ id: 'orbita', label: 'Orbita', paint: '#3c4148', accent: '#f0a020' }),
  Object.freeze({ id: 'kuiper', label: 'Pas Kuipera', paint: '#2f7a4a', accent: '#e8edf0' })
]);

/** Hałdy zsypu: barwa materiału (kanał `accent` instancji). */
export const TRUCK_HOPPER_LOADS = Object.freeze({ ore: '#8a5a3c', ice: '#a9d6e8', scrap: '#7c8086', sand: '#b89a60' });
/** Hazmat: farba stała (żółty), romb. */
export const TRUCK_HAZMAT_PAINT = Object.freeze({ paint: '#e8bb1c', accent: '#e8620c' });
/** Zbiornik: stal lub biel płaszcza, opaska = akcent linii. */
export const TRUCK_TANK_SHELLS = Object.freeze(['#d9dde1', '#b9c0c6']);

// ---------------------------------------------------------------------------
// Sprite'y: PNG + atlas partii. Rysuje je scripts/ciagniki-sprite.mjs z tych samych liczb.

const asset = {
  albedo: new URL('../../assets/ships/trucks/trucks_atlas.png', import.meta.url).href,
  normal: new URL('../../assets/ships/trucks/trucks_atlas_n.png', import.meta.url).href,
  mask: new URL('../../assets/ships/trucks/trucks_atlas_m.png', import.meta.url).href
};

/**
 * Pojedyncze PNG (płótno z alfą, jak kadłuby ruchu: +x = dziób, środek = (0, 0) lokalnie po uwzględnieniu `bounds`,
 * malowanie domyślne wypalone) — do podglądu, galerii i przyszłych wpisów `TRAFFIC_HULLS`.
 */
export const TRUCK_SPRITE_PNG = Object.freeze({
  tractor_light: new URL('../../assets/ships/trucks/tractor_light.png', import.meta.url).href,
  tractor_standard: new URL('../../assets/ships/trucks/tractor_standard.png', import.meta.url).href,
  tractor_heavy: new URL('../../assets/ships/trucks/tractor_heavy.png', import.meta.url).href,
  trailer_chassis: new URL('../../assets/ships/trucks/trailer_chassis.png', import.meta.url).href,
  cargo_std_a: new URL('../../assets/ships/trucks/cargo_std_a.png', import.meta.url).href,
  cargo_std_b: new URL('../../assets/ships/trucks/cargo_std_b.png', import.meta.url).href,
  cargo_hazmat: new URL('../../assets/ships/trucks/cargo_hazmat.png', import.meta.url).href,
  cargo_tank: new URL('../../assets/ships/trucks/cargo_tank.png', import.meta.url).href,
  cargo_hopper: new URL('../../assets/ships/trucks/cargo_hopper.png', import.meta.url).href
});

const CARGO_BOUNDS = Object.freeze([-17.2, 17.2, -9, 9]);

/** Obrys sprite'a [x0, x1, y0, y1] w układzie lokalnym części. */
export const TRUCK_SPRITE_BOUNDS = Object.freeze({
  tractor_light: TRUCK_TRACTORS.light.bounds,
  tractor_standard: TRUCK_TRACTORS.standard.bounds,
  tractor_heavy: TRUCK_TRACTORS.heavy.bounds,
  trailer_chassis: TRUCK_TRAILER.bounds,
  cargo_std_a: CARGO_BOUNDS,
  cargo_std_b: CARGO_BOUNDS,
  cargo_hazmat: CARGO_BOUNDS,
  cargo_tank: CARGO_BOUNDS,
  cargo_hopper: CARGO_BOUNDS
});

/** Atlas: px na j. świata (skala 1), rozmiar, margines komórek (mipmapy nie mieszają sąsiadów). */
export const TRUCK_ATLAS = Object.freeze({ size: Object.freeze([2048, 1024]), pxPerUnit: 12, pad: 16, urls: Object.freeze(asset) });

/** Komórki atlasu w pikselach: nazwa → { x, y, w, h } (półkami, kolejność jak TRUCK_SPRITE_BOUNDS). */
export const TRUCK_ATLAS_CELLS = (() => {
  const cells = {};
  const [W] = TRUCK_ATLAS.size;
  const { pad, pxPerUnit: P } = TRUCK_ATLAS;
  let x = pad;
  let y = pad;
  let row = 0;
  for (const [name, b] of Object.entries(TRUCK_SPRITE_BOUNDS)) {
    const w = Math.ceil((b[1] - b[0]) * P);
    const h = Math.ceil((b[3] - b[2]) * P);
    if (x + w + pad > W) { x = pad; y += row + pad; row = 0; }
    cells[name] = Object.freeze({ x, y, w, h });
    x += w + pad;
    row = Math.max(row, h);
  }
  return Object.freeze(cells);
})();

// ---------------------------------------------------------------------------
// Rachunki

/** Długość zestawu [j.] od dzioba ciągnika do tyłu ostatniej naczepy (skala 1). */
export function truckRigLength(tractorId, trailers) {
  const t = TRUCK_TRACTORS[tractorId] || TRUCK_TRACTORS.standard;
  const n = Math.max(0, trailers | 0);
  const nose = t.body[1];
  if (!n) return nose - t.body[0];
  const span = TRUCK_TRAILER.kingpinX - TRUCK_TRAILER.rearHitchX;
  return nose - t.hitchX + (n - 1) * span + TRUCK_TRAILER.kingpinX - TRUCK_TRAILER.body[0];
}

/** Największa szerokość zestawu (ciągnik z gondolami) [j.]. */
export function truckRigWidth(tractorId) {
  const t = TRUCK_TRACTORS[tractorId] || TRUCK_TRACTORS.standard;
  let w = t.body[2];
  for (const n of t.nozzles) w = Math.max(w, Math.abs(n[1]) + n[2] * 0.75);
  return w * 2;
}

/** Odległość przegub → punkt prowadzenia (ramię krzywej pościgu). */
export function truckTrailerArm() {
  return TRUCK_TRAILER.kingpinX - TRUCK_TRAILER.axleX;
}

/**
 * Zgięcia w stanie ustalonym na łuku promienia R (środek ciągnika na łuku): przegub i dostaje atan(e / Ra) + atan(D / Rf),
 * gdzie e — ramię zaczepu za punktem prowadzenia poprzednika, D — ramię pościgu, Ra / Rf — promienie punktów prowadzenia.
 * Zwraca największe zgięcie zestawu [rad] (bez ogranicznika).
 */
export function truckSteadyBend(tractorId, trailers, R) {
  const t = TRUCK_TRACTORS[tractorId] || TRUCK_TRACTORS.standard;
  const D = truckTrailerArm();
  const eRear = Math.abs(TRUCK_TRAILER.rearHitchX - TRUCK_TRAILER.axleX);
  let Ra = R;
  let e = Math.abs(t.hitchX);
  let worst = 0;
  for (let i = 0; i < Math.max(0, trailers | 0); i++) {
    const Rh2 = Ra * Ra + e * e;
    if (Rh2 <= D * D) return Math.PI;
    const Rf = Math.sqrt(Rh2 - D * D);
    worst = Math.max(worst, Math.atan2(e, Ra) + Math.atan2(D, Rf));
    Ra = Rf;
    e = eRear;
  }
  return worst;
}

/** Najmniejszy promień łuku czoła [j., skala 1], przy którym zgięcia ustalają się poniżej ogranicznika. */
export function truckMinTurnRadius(tractorId = 'heavy', trailers = 5) {
  let lo = 20;
  let hi = 400;
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2;
    if (truckSteadyBend(tractorId, trailers, m) > TRUCK_TRAILER.maxBend) lo = m;
    else hi = m;
  }
  return hi;
}

/** Ładowność zestawu w rachunku ruchu [t]. */
export function truckRigTonnes(trailers) {
  return Math.max(0, trailers | 0) * TRUCK_TRAILER_TONNES;
}

/** sRGB '#rrggbb' → liniowe [r, g, b]. */
export function truckHexLinear(hex, out = [0, 0, 0]) {
  const v = parseInt(String(hex).slice(1), 16);
  for (let i = 0; i < 3; i++) {
    const c = ((v >> (16 - i * 8)) & 255) / 255;
    out[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return out;
}
