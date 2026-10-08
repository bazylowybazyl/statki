// Oprzyrządowanie świetlne hali K-7 i harmonogram zaworów gazu (2026-10-07, prośba użytkownika: „światła, które
// fajnie oświetlą gaz” i „czerwone / zielone / niebieskie mrygające, militarne”). Czysta matematyka, bez Three —
// JEDNO źródło dla trzech miejsc:
//   • bryły K-7 (haloPortK7Build.js): soczewki świateł z kodem migania w instancji (iC.yzw), oprawy reflektorów;
//   • shader K-7 (haloPortK7.js): miganie soczewek (lustro TSL `k7BeaconLevel`), lampy i reflektory na pokładzie;
//   • siatka świateł gry (gasField/hallDust.js): te same lampy, reflektory i migające światła oświetlają pył, parę
//     i kadłuby w hali (Core3D.fx.grid).
// Zegar migania: `clock` [s] zawinięty co K7_BEACON_WRAP (HaloRingGame liczy go raz na klatkę i podaje hali oraz
// wejściu pyłu — soczewka i jej światło w gazie migają w tej samej fazie).
//
// Układ: hub hali (x w poprzek, z w głąb: ściana tylna 250 → brama G-01 7400), wysokość y jak w K-7 (pokład 0,
// szczyt kadłuba 116); scena: z = k7HeightToZ(y).
import { K7_FUEL_STATION, k7HeightToZ } from './haloPortK7Layout.js';

export const K7_BEACON_WRAP = 3600;

/** Rodzaje migania (kod w instancji bryły i w siatce świateł). */
export const K7_BEACON = Object.freeze({
  NONE: 0,
  OBSTRUCTION: 1,   // czerwone przeszkodowe: wspólny takt 1,5 s (jak na masztach — wszystkie razem)
  CLEAR: 2,         // zielone podwójne mignięcie — stanowisko wolne
  RABBIT: 3,        // niebieskie stroboskopy podejścia biegnące ku stanowisku (faza = miejsce w ciągu)
  EDGE: 4,          // niebieskie krawędzie dróg kołowania (wolne „oddychanie”)
  STROBE: 5,        // białe podwójne błyski (wieża kontroli, boje podejścia)
  VENT: 6,          // pomarańczowy kogut zaworu: miga przed upustem i w jego trakcie (harmonogram zaworu)
  HOLD: 7           // czerwone ciągłe — stanowisko zajęte
});

/** Barwa soczewki (liniowo) i szczyt emisji HDR. */
export const K7_BEACON_LOOK = Object.freeze([
  null,
  Object.freeze({ color: [1.0, 0.07, 0.03], hdr: 7 }),
  Object.freeze({ color: [0.1, 1.0, 0.28], hdr: 6 }),
  Object.freeze({ color: [0.18, 0.38, 1.0], hdr: 9 }),
  Object.freeze({ color: [0.2, 0.42, 1.0], hdr: 2.6 }),
  Object.freeze({ color: [1.0, 0.96, 0.9], hdr: 10 }),
  Object.freeze({ color: [1.0, 0.36, 0.03], hdr: 7 }),
  Object.freeze({ color: [1.0, 0.08, 0.03], hdr: 3 })
]);

/** Światło w siatce gry na rodzaj: zasięg [j.], moc (× barwa × poziom), rozpraszanie w gazie. null = bez światła. */
export const K7_BEACON_GRID = Object.freeze([
  null,
  Object.freeze({ range: 760, gain: 0.7, scatter: 0.4 }),
  Object.freeze({ range: 560, gain: 0.8, scatter: 0.35 }),
  Object.freeze({ range: 640, gain: 2.4, scatter: 0.8 }),
  null,
  Object.freeze({ range: 1500, gain: 2.6, scatter: 0.6 }),
  Object.freeze({ range: 1050, gain: 2.2, scatter: 0.8 }),
  Object.freeze({ range: 420, gain: 0.45, scatter: 0.5 })
]);

// Harmonogram zaworu: ostrzeżenie (kogut) od początku cyklu, upust gazu po K7_VENT_WARN s przez K7_VENT_DUR s.
export const K7_VENT_WARN = 1.4;
export const K7_VENT_DUR = 2.6;

const fract = (x) => x - Math.floor(x);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const pulse = (s, a) => smooth(a, a + 0.03, s) * (1 - smooth(a + 0.1, a + 0.15, s));

/** Poziom zaworu w chwili t: { warn, gas } (0..1). period, phase [s]. Lustro: k7VentLevel w shaderze nie istnieje —
 *  kogut liczy ostrzeżenie wzorem z k7BeaconLevel (VENT), gaz liczy tylko CPU (hallDust). */
export function k7VentEnvelope(t, phase, period, out = { warn: 0, gas: 0, u: 0 }) {
  const u = fract((t + phase) / period) * period;
  const end = K7_VENT_WARN + K7_VENT_DUR;
  out.u = u;
  out.warn = smooth(0, 0.1, u) * (1 - smooth(end - 0.2, end + 0.1, u));
  out.gas = smooth(K7_VENT_WARN, K7_VENT_WARN + 0.25, u) * (1 - smooth(end - 0.8, end, u));
  return out;
}

/**
 * Poziom świecenia soczewki (0..1) — LUSTRO CPU funkcji TSL w haloPortK7.js (k7BeaconLevelTSL): te same wzory,
 * te same stałe (test tests/hallLights.test.mjs pilnuje stałych w źródle shadera).
 */
export function k7BeaconLevel(kind, t, phase = 0, period = 0) {
  switch (kind | 0) {
    case K7_BEACON.OBSTRUCTION: {
      const f = fract((t + phase) / 1.5);
      return smooth(0, 0.05, f) * (1 - smooth(0.28, 0.46, f));
    }
    case K7_BEACON.CLEAR: {
      const s = fract((t + phase) / 2.4) * 2.4;
      return pulse(s, 0) + pulse(s, 0.3);
    }
    case K7_BEACON.RABBIT: {
      const s = fract((t - phase) / 1.8) * 1.8;
      return Math.exp(-s * 18);
    }
    case K7_BEACON.EDGE:
      return 0.6 + 0.4 * Math.sin(6.2831853 * (t + phase) / 3.2);
    case K7_BEACON.STROBE: {
      const s = fract((t + phase) / 1.4) * 1.4;
      return Math.exp(-s * 45) + (s >= 0.18 ? Math.exp(-(s - 0.18) * 45) : 0);
    }
    case K7_BEACON.VENT: {
      const p = period > 0 ? period : 30;
      const u = fract((t + phase) / p) * p;
      const end = K7_VENT_WARN + K7_VENT_DUR;
      const warn = smooth(0, 0.1, u) * (1 - smooth(end - 0.2, end + 0.1, u));
      const c = 0.5 + 0.5 * Math.cos(6.2831853 * 2.4 * u);
      return warn * (0.2 + 0.8 * c * c);
    }
    case K7_BEACON.HOLD:
      return 0.55;
    default:
      return 0;
  }
}

/** Zegar migania: czas ściany [s] zawinięty (float32 w shaderze trzyma ~0,5 ms). */
export function k7BeaconClock(nowMs) {
  return ((Number(nowMs) || 0) * 0.001) % K7_BEACON_WRAP;
}

const norm3 = (x, y, z) => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

// Zawory gazu hali (deterministyczne okresy i fazy — dzielniki K7_BEACON_WRAP, bez skoku przy zawinięciu zegara).
const VENT_PERIODS = [24, 30, 36, 40, 45, 48];

/**
 * Oprzyrządowanie hali `layout` (createK7Layout). Wynik (wszystko w hubie hali, wysokości K-7):
 *   lamps   — lampy dookólne nad pokładem: { x, y, z, range, color, intensity, k7Type (1 ciepła / 2 chłodna) };
 *   spots   — reflektory: { x, y, z, dir (hub x, wysokość sceny, hub z — jednostkowy w układzie sceny), range,
 *             cosOuter, cosInner, color, intensity, housing: { yaw } };
 *   beacons — soczewki: { x, y, z, kind, phase, period, set ('fg' nad płaszczyzną lotu / 'bg' na pokładzie), r,
 *             berthId (CLEAR ↔ HOLD), vent (indeks w vents) };
 *   vents   — zawory gazu: { id, kind ('reel' | 'wall'), x, z, dirX, dirZ, phase, period, berthId?, side? }.
 */
export function k7LightRig(layout) {
  const l = layout;
  const capital = l.berths.filter((b) => b.size === 'CAPITAL');
  const lamps = [];
  const spots = [];
  const beacons = [];
  const vents = [];
  const WARM = [1.0, 0.78, 0.55];
  const COOL = [0.66, 0.85, 0.92];
  const WORK = [0.86, 0.93, 1.0];

  // --- lampy: nad stanowiskami capital (jak dawne 4 lampy K-7, 310 j. na zewnątrz od osi stanowiska),
  // nad polem manewrowym i nad alejami grzebieni bocznych
  [-1120, 1120, -2740, 2740].forEach((x, i) => {
    const warm = i === 0 || i === 3;
    lamps.push({ x, y: 390, z: 1930, range: 2600, color: warm ? WARM : COOL, intensity: 1.0, k7Type: warm ? 1 : 2 });
  });
  for (const x of [-1620, 1620]) lamps.push({ x, y: 430, z: 4750, range: 2700, color: COOL, intensity: 0.9, k7Type: 2 });
  for (const bank of l.sideBanks) lamps.push({ x: bank.aisleX, y: 400, z: 3300, range: 2500, color: WARM, intensity: 0.85, k7Type: 1 });

  // --- reflektory (oprawy na ścianach, nad płaszczyzną lotu): snop w gazie z góry wygląda jak klin światła
  const spot = (x, y, z, tx, ty, tz, range, outerDeg, innerDeg, color, intensity) => {
    const sy = k7HeightToZ(y);
    const dir = norm3(tx - x, k7HeightToZ(ty) - sy, tz - z);
    spots.push({
      x, y, z, dir, range, cosOuter: Math.cos(outerDeg * Math.PI / 180), cosInner: Math.cos(innerDeg * Math.PI / 180),
      color, intensity, housing: { yaw: Math.atan2(dir[0], dir[2]) }
    });
  };
  // ściana tylna: nad każdym stanowiskiem capital, snop wzdłuż stanowiska ku bramie
  for (const b of capital) spot(b.x, 470, l.backZ + 70, b.x, 40, b.z + 500, 4300, 23, 9, WORK, 2.3);
  // brama G-01: od wewnętrznych ościeżnic w głąb hali, na pasy podejścia
  for (const side of [-1, 1]) {
    spot(side * (l.frontHalfWidth - 150), 540, l.frontZ - 90, side * 1300, 30, 4100, 4600, 27, 11, WORK, 2.0);
  }
  // ściany boczne: nad alejami grzebieni, skośnie ku środkowi hali
  for (const bank of l.sideBanks) {
    const s = bank.side;
    spot(s * (l.halfWidth - 70), 500, 4700, s * (l.halfWidth - 2600), 30, 3500, 3600, 26, 10, WARM, 1.7);
  }

  // --- soczewki
  const beacon = (x, y, z, kind, set, extra = {}) => beacons.push({ x, y, z, kind, phase: 0, period: 0, set, r: 11, ...extra });
  // ościeżnice wszystkich bram (szczyt słupa)
  for (const g of l.gates) {
    for (const end of [g.jamb, g.length - g.jamb]) {
      const x = g.a[0] + g.ux * end;
      const z = g.a[1] + g.uz * end;
      beacon(x - g.nx * 30, 616, z - g.nz * 30, K7_BEACON.OBSTRUCTION, 'fg', { r: 15 });
    }
  }
  // obrotnice ramion paliwowych na słupkach (ramię SCARA sięga nad płaszczyznę lotu; suwnic nie ma od 2026-10-07)
  for (const b of capital) {
    for (const a of b.serviceAnchors) beacon(a.x - a.side * 30, K7_FUEL_STATION.column.top + 52, a.z + 30, K7_BEACON.OBSTRUCTION, 'fg', { r: 10 });
  }
  // szczyt ścian bez bram: co ~1300 j. (wewnętrzna krawędź)
  for (const e of l.edges) {
    if (l.gates.some((g) => g.edge === e.i)) continue;
    const n = Math.max(1, Math.round(e.length / 1300));
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) * e.length / n;
      beacon(e.a[0] + e.ux * a + e.nx * 40, 600, e.a[1] + e.uz * a + e.nz * 40, K7_BEACON.OBSTRUCTION, 'fg', { r: 13 });
    }
  }
  // narożniki pól stanowisk capital: zielone (wolne) / czerwone (zajęte) — przełącza lampka stanowiska
  for (const b of capital) {
    const hw = b.width / 2 - 40;
    const hl = b.length / 2 - 40;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      beacon(b.x + sx * hw, 5, b.z + sz * hl, b.occupied ? K7_BEACON.HOLD : K7_BEACON.CLEAR, 'bg', { r: 12, berthId: b.id, phase: 0 });
    }
  }
  // stroboskopy podejścia: oś każdego pasa capital od fartucha bramy ku stanowisku (błysk biegnie ku stanowisku)
  for (const lane of l.lanes) {
    const b = l.berths.find((v) => v.id === lane.berthId);
    const z1 = l.frontZ + l.apronDepth - 140;
    const z0 = b.z + b.length / 2 + 160;
    const n = Math.max(2, Math.floor((z1 - z0) / 330));
    for (let k = 0; k <= n; k++) {
      const z = z1 - (z1 - z0) * k / n;
      beacon(lane.x, z > l.frontZ ? 1 : 5, z, K7_BEACON.RABBIT, 'bg', { r: 10, phase: k * 0.055 });
    }
  }
  // krawędzie dróg kołowania grzebieni bocznych (niebieskie)
  for (const bank of l.sideBanks) {
    for (const s of [-1, 1]) {
      for (let z = bank.z0 + 80; z < bank.z1 - 60; z += 310) {
        beacon(bank.aisleX + s * (bank.aisleWidth / 2 + 24), 5, z, K7_BEACON.EDGE, 'bg', { r: 8, phase: (z / 310) * 0.11 });
      }
    }
  }
  // wieża kontroli portu i boje podejścia przed bramą G-01: białe błyski
  beacon(0, 352, 583, K7_BEACON.STROBE, 'fg', { r: 16 });
  for (const side of [-1, 1]) beacon(side * (l.frontHalfWidth + 160), 316, l.frontZ - 90, K7_BEACON.STROBE, 'fg', { r: 14, phase: side > 0 ? 0.7 : 0 });

  // --- zawory gazu: szpule przewodów paliwowych (na piedestałach) i upusty magazynów przy ścianie tylnej
  let vi = 0;
  for (const b of capital) {
    for (const a of b.serviceAnchors) {
      const period = VENT_PERIODS[vi % VENT_PERIODS.length];
      const phase = fract(Math.sin((vi + 1) * 12.9898) * 43758.5453) * period;
      vents.push({ id: `reel-${b.id}-${a.side}`, kind: 'reel', x: a.x, z: a.z, dirX: a.side, dirZ: -0.35, phase, period, berthId: b.id, side: a.side });
      beacon(a.x + a.side * (K7_FUEL_STATION.column.w * 0.5 + 8), 246, a.z - 34, K7_BEACON.VENT, 'fg', { r: 11, phase, period, vent: vents.length - 1 });
      vi++;
    }
  }
  for (const x of [-3400, -1620, 1620, 3400]) {
    const period = VENT_PERIODS[vi % VENT_PERIODS.length];
    const phase = fract(Math.sin((vi + 1) * 78.233) * 43758.5453) * period;
    vents.push({ id: `wall-${x}`, kind: 'wall', x, z: l.backZ + 70, dirX: 0, dirZ: 1, phase, period });
    beacon(x, 430, l.backZ + 60, K7_BEACON.VENT, 'fg', { r: 14, phase, period, vent: vents.length - 1 });
    vi++;
  }

  return { lamps, spots, beacons, vents };
}

/** Wysokość soczewki / światła w scenie (z) — pomocnik dla siatki świateł. */
export function k7RigZ(y) {
  return k7HeightToZ(y);
}
