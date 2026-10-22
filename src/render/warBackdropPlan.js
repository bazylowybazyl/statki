// src/render/warBackdropPlan.js — BITWA W GŁĘBI (scena „Wojna”, 2026-10-19): wspólny, CZYSTY plan obrazu dla gry
// i renderu (bez three, DOM i `window`).
//
// User (2026-10-19): „bitwa o Coruscant = masa statków na wielu płaszczyznach naparzająca się … statki poza zasięgiem
// gracza, duże blisko kamery (np. inny Atlas wali serię w battleshipa i go niszczy), wylot z warpa przyjaznego Atlasa
// i wrogiego supercapitala piratów — niszczą się obaj; masa statków w oddali i w przybliżeniu”. Rozgrywka zostaje
// w płaszczyźnie gry (floty sceny — src/game/warScene.js); tu jest plan OBRAZU nad i pod nią:
//   • klasy wyglądu (`WB_CLASSES` — wymiary jak `getHullRenderSize` gry, sprite'y z src/assets/ships),
//   • pasma głębokości (`WB_BANDS` — z < 0 pod płaszczyzną, z > 0 między płaszczyzną a kamerą),
//   • BOHATEROWIE (`planWarHero`) — dwa okręty ze skryptem (drogi, salwy, wiązki, śmierć) liczone z kilku liczb;
//     tę samą funkcję woła gra (kadr kamery: `heroFocus`) i render (symulacja tłumu: warBackdropSim.js), więc obie
//     strony mają identyczny plan bez przesyłania list zdarzeń.
// Układ: GRA (x w prawo, y w dół), z — wysokość nad płaszczyzną gry, czas sceny w sekundach (czas gry).

export const WB_SIDE = Object.freeze({ TN: 0, PIRATE: 1 });

/**
 * Klasy wyglądu. sprite — klucz obrazu (warBackdrop3D.js: SPRITES), len / wid — kadłub w j. świata (jak w płaszczyźnie
 * gry: długi bok = długość × 0,6, krótki z proporcji PNG), speed [j/s], hp — trafienia, guns — wieże na salwę,
 * rof — salwy / s, range [j.], role: 'escort' (przeloty), 'capital' (linia), 'carrier' (za linią), weight — udział
 * w losowaniu strony, ray — wielki laser (jak u Venatora) co ile s, shield — błysk tarczy przy trafieniu.
 */
export const WB_CLASSES = Object.freeze([
  { id: 'terran_frigate', sprite: 'terran_frigate', fac: 0, len: 192, wid: 143, speed: 1100, hp: 3, guns: 2, rof: 1.3, range: 6000, role: 'escort', weight: 10 },
  { id: 'terran_destroyer', sprite: 'terran_destroyer', fac: 0, len: 288, wid: 215, speed: 800, hp: 5, guns: 3, rof: 1.1, range: 7500, role: 'escort', weight: 7 },
  { id: 'terran_battleship', sprite: 'terran_battleship', fac: 0, len: 624, wid: 385, speed: 470, hp: 14, guns: 6, rof: 0.85, range: 10000, role: 'capital', weight: 4.5, shield: 1 },
  { id: 'terran_carrier', sprite: 'terran_carrier', fac: 0, len: 1080, wid: 608, speed: 330, hp: 20, guns: 4, rof: 0.6, range: 9000, role: 'carrier', weight: 1.6, shield: 1 },
  { id: 'terran_supercapital', sprite: 'terran_supercapital', fac: 0, len: 1560, wid: 878, speed: 260, hp: 40, guns: 10, rof: 0.7, range: 13000, role: 'capital', weight: 0.9, ray: 15, shield: 1 },
  { id: 'atlas', sprite: 'atlas', fac: 0, len: 1800, wid: 806, speed: 520, hp: 30, guns: 9, rof: 0.9, range: 11000, role: 'capital', weight: 1.0, shield: 1 },
  { id: 'pirate_frigate', sprite: 'pirate_frigate', fac: 1, len: 192, wid: 80, speed: 1250, hp: 3, guns: 2, rof: 1.4, range: 5500, role: 'escort', weight: 11 },
  { id: 'pirate_destroyer', sprite: 'pirate_destroyer', fac: 1, len: 360, wid: 167, speed: 860, hp: 5, guns: 3, rof: 1.15, range: 7000, role: 'escort', weight: 7 },
  { id: 'pirate_battleship', sprite: 'pirate_battleship', fac: 1, len: 720, wid: 380, speed: 500, hp: 14, guns: 6, rof: 0.95, range: 9500, role: 'capital', weight: 5 },
  { id: 'pirate_supercapital', sprite: 'pirate_supercapital', fac: 1, len: 1200, wid: 676, speed: 270, hp: 36, guns: 10, rof: 0.8, range: 12500, role: 'capital', weight: 0.9, ray: 17 }
]);

export function wbClassIndex(id) {
  for (let i = 0; i < WB_CLASSES.length; i++) if (WB_CLASSES[i].id === id) return i;
  return -1;
}

/**
 * Pasma głębokości (z w j.; ujemne — pod płaszczyzną gry). Cienkie warstwy („wiele płaszczyzn”), każda z własną
 * bitwą: strony po obu stronach linii frontu, gęstość skupiona przy środku sceny (rozkład Gaussa: sigmaU / sigmaV
 * w ułamkach połowy pasma). share — udział okrętów, halfX / halfY — zasięg [j.], scale — powiększenie kadłubów
 * (dalekie linie to cięższe okręty: w perspektywie mają dalej czytelny kształt), fighters — udział myśliwców,
 * big — mnożnik wagi capitali (głębiej linie ciężkich okrętów, płyciej eskorta).
 */
export const WB_BANDS = Object.freeze([
  { name: 'nad', z0: 8500, z1: 12500, share: 0.07, halfX: 42000, halfY: 32000, sigmaU: 0.5, sigmaV: 0.6, scale: 1.0, fighters: 0.14, big: 0.6 },
  { name: 'pod', z0: -16000, z1: -12000, share: 0.2, halfX: 70000, halfY: 50000, sigmaU: 0.42, sigmaV: 0.5, scale: 1.25, fighters: 0.3, big: 1.0 },
  { name: 'gleboko', z0: -46000, z1: -39000, share: 0.25, halfX: 105000, halfY: 75000, sigmaU: 0.42, sigmaV: 0.5, scale: 1.8, fighters: 0.28, big: 1.6 },
  { name: 'dno', z0: -100000, z1: -90000, share: 0.27, halfX: 160000, halfY: 115000, sigmaU: 0.42, sigmaV: 0.5, scale: 2.6, fighters: 0.2, big: 2.4 },
  { name: 'otchlan', z0: -168000, z1: -152000, share: 0.21, halfX: 230000, halfY: 165000, sigmaU: 0.42, sigmaV: 0.5, scale: 3.6, fighters: 0.08, big: 3.2 }
]);
export const WB_BAND_FG = 0;

/**
 * Planeta w głębi (jak Coruscant pod bitwą): środek pod sceną na głębokości `z` (szczyt kuli z + r), przesunięty
 * w bok o `offset` prostopadle do kierunku słońca — terminator przechodzi pod środkiem bitwy (pół kadru dzień,
 * pół noc ze światłami miast), brzeg tarczy łukiem w kadrze. Wszystko w zasięgu `far` kamery perspektywy (500 tys.):
 * środek ~430 tys. pod kamerą z ~41 tys. j.
 */
export const WB_PLANET_DEFAULTS = Object.freeze({ maps: 'venus', r: 165000, z: -385000, offset: 150000, side: 1 });

/** Rodzaje scen bohaterów. */
export const WB_HERO = Object.freeze({ COMBO: 1, DUEL: 2 });

/** Zdarzenia skryptu bohaterów (kod liczbowy — symulacja obrazu). */
export const WB_EV = Object.freeze({ SALVO: 1, CHARGE: 2, BEAM: 3, KILL: 4, WARPOUT: 5, BURN: 6 });
/** Rodzaje wiązek (obraz: barwa, rdzeń). */
export const WB_BEAM = Object.freeze({ LANCE: 0, RAY_TN: 1, RAY_PIR: 2 });

/** Pęd po wyjściu z warpa (jak warpExitMomentum NPC w grze): k × marsz gaśnie wykładniczo ze stałą tau. */
export const WB_WARP = Object.freeze({ k: 3, tau: 0.75 });

/** Droga od wyjścia z warpa po czasie t [s] przy marszu v: v·t + v(k−1)·tau·(1 − e^(−t/tau)). */
export function warpSlideDist(v, t, k = WB_WARP.k, tau = WB_WARP.tau) {
  if (!(t > 0)) return 0;
  return v * t + v * (k - 1) * tau * (1 - Math.exp(-t / tau));
}
/** Prędkość po wyjściu z warpa po czasie t. */
export function warpSlideSpeed(v, t, k = WB_WARP.k, tau = WB_WARP.tau) {
  return v * (1 + (k - 1) * Math.exp(-Math.max(0, t) / tau));
}

const DEG = Math.PI / 180;

/**
 * Okręt bohatera: klasa, strona, skala, wysokość z; droga prosta: w chwili `tRef` środek w (xRef, yRef), kurs `ang`,
 * marsz `v`; od `tSpawn` (wyjście z warpa, gdy `warp`) — pęd k × v gaśnie (warpSlideDist). Przed tSpawn okrętu nie ma.
 */
function heroShip(id, scale, z, ang, v, xRef, yRef, tRef, tSpawn, warp) {
  const cls = wbClassIndex(id);
  return { id, cls, fac: WB_CLASSES[cls].fac, scale, z, ang, v, xRef, yRef, tRef, tSpawn, warp: !!warp, tDie: Infinity, tGone: Infinity };
}

/** Pozycja okrętu bohatera w chwili t (out: x, y, ang, speed, live — 0 przed wejściem, 1 w scenie). */
export function heroShipPose(s, t, out = {}) {
  const dir = s.warp ? warpSlideDist(s.v, t - s.tSpawn) - warpSlideDist(s.v, s.tRef - s.tSpawn) : s.v * (t - s.tRef);
  const c = Math.cos(s.ang);
  const n = Math.sin(s.ang);
  out.x = s.xRef + c * dir;
  out.y = s.yRef + n * dir;
  out.ang = s.ang;
  out.speed = s.warp ? warpSlideSpeed(s.v, t - s.tSpawn) : s.v;
  out.live = t >= s.tSpawn && t < s.tGone ? 1 : 0;
  return out;
}

/**
 * Plan sceny bohaterów z kilku liczb (gra i render liczą to samo). p: { kind (WB_HERO), t0 (czas sceny), x, y (punkt
 * kulminacji względem środka sceny, układ gry), z (wysokość), heading (kurs celu, rad), seed, scale? }.
 * Zwraca { kind, t0, t1 (koniec), z, ships: [A, B], events: [{ t, type, from, to, … }] (rosnąco), keys: { … } }.
 */
export function planWarHero(p) {
  const kind = p.kind | 0;
  const t0 = Number(p.t0) || 0;
  const fx = Number(p.x) || 0;
  const fy = Number(p.y) || 0;
  const z = Number(p.z) || 9000;
  const phi = Number(p.heading) || 0;
  const seed = (Number(p.seed) >>> 0) || 1;
  if (kind === WB_HERO.DUEL) return planDuel(t0, fx, fy, z, phi, seed);
  return planCombo(t0, fx, fy, z, phi, seed);
}

// KOMBO: Atlas wychodzi z warpa za rufą pancernika piratów i podchodzi z ćwiartki pod kątem, wali salwy z wież (pancernik
// płonie, odpowiada słabo), dziób na cel — LANCA wzdłuż kila przez śródokręcie, pancernik pęka wzdłuż wiązki i wybucha;
// Atlas leci dalej przez chmurę odłamów i skacze (warp).
function planCombo(t0, fx, fy, z, phi, seed) {
  const tLance = t0 + 9.2;
  const vB = 330;
  const bScale = 1.55;
  const B = heroShip('pirate_battleship', bScale, z, phi, vB, fx, fy, tLance, t0, false);
  const side = (seed & 1) ? 1 : -1;                       // podejście od prawej albo lewej burty
  const psi = phi + side * 38 * DEG;
  const A = heroShip('atlas', 1.0, z, psi, 560, 0, 0, tLance, t0 + 0.35, true);
  const lenA = WB_CLASSES[A.cls].len;
  const D = 2500;                                         // dziób Atlasa → środek pancernika w chwili lancy
  A.xRef = fx - Math.cos(psi) * (D + lenA * 0.5);
  A.yRef = fy - Math.sin(psi) * (D + lenA * 0.5);
  const ev = [];
  const salvo = (t, from, to, shots, heavy) => ev.push({ t, type: WB_EV.SALVO, from, to, shots, heavy: heavy ? 1 : 0 });
  for (let k = 0; k < 4; k++) salvo(t0 + 2.2 + k * 1.45, 0, 1, 12, true);
  for (let k = 0; k < 3; k++) salvo(t0 + 2.9 + k * 1.6, 1, 0, 6, false);
  ev.push({ t: tLance - 1.25, type: WB_EV.CHARGE, from: 0, dur: 1.25, size: 1 });
  ev.push({ t: tLance, type: WB_EV.BEAM, from: 0, to: 1, dur: 1.35, width: 150, beam: WB_BEAM.LANCE, reach: 1.6 });
  ev.push({ t: tLance + 0.32, type: WB_EV.KILL, who: 1, cut: 1, delay: 0.45 });
  ev.push({ t: t0 + 17.5, type: WB_EV.WARPOUT, who: 0 });
  ev.sort((a, b) => a.t - b.t);
  B.tDie = tLance + 0.32;
  A.tGone = t0 + 17.5;
  B.tGone = tLance + 0.32 + 1.2;
  return { kind: WB_HERO.COMBO, t0, t1: t0 + 18, z, seed, ships: [A, B], events: ev,
    keys: { arrive: t0 + 0.35, salvo: t0 + 2.2, charge: tLance - 1.25, lance: tLance, kill: tLance + 0.32, out: t0 + 17.5 } };
}

// POJEDYNEK: przyjazny Atlas i supercapital piratów wychodzą z warpa na kursach zbieżnych (przesunięcie w bok ~1,7 km),
// salwy z obu stron, supercapital tnie Atlasa swoim wielkim laserem, Atlas odpowiada lancą — obaj płoną i mijając się
// burta w burtę giną (supercapital pierwszy, Atlas ~0,7 s później).
function planDuel(t0, fx, fy, z, phi, seed) {
  const tMeet = t0 + 8.4;
  const side = (seed & 2) ? 1 : -1;
  const lat = 1700;
  const nx = -Math.sin(phi) * side;
  const ny = Math.cos(phi) * side;
  const A = heroShip('atlas', 1.0, z, phi, 520, fx - nx * lat * 0.5, fy - ny * lat * 0.5, tMeet, t0, true);
  const B = heroShip('pirate_supercapital', 1.45, z, phi + Math.PI, 300, fx + nx * lat * 0.5, fy + ny * lat * 0.5, tMeet, t0 + 0.7, true);
  const ev = [];
  const salvo = (t, from, to, shots, heavy) => ev.push({ t, type: WB_EV.SALVO, from, to, shots, heavy: heavy ? 1 : 0 });
  for (let k = 0; k < 4; k++) salvo(t0 + 2.0 + k * 1.3, 0, 1, 10, true);
  for (let k = 0; k < 4; k++) salvo(t0 + 2.5 + k * 1.3, 1, 0, 12, true);
  ev.push({ t: t0 + 3.8, type: WB_EV.CHARGE, from: 1, dur: 1.4, size: 1.2 });
  ev.push({ t: t0 + 5.2, type: WB_EV.BEAM, from: 1, to: 0, dur: 1.6, width: 210, beam: WB_BEAM.RAY_PIR, reach: 1.4 });
  ev.push({ t: t0 + 5.4, type: WB_EV.BURN, who: 0, amount: 0.8 });
  ev.push({ t: t0 + 4.9, type: WB_EV.CHARGE, from: 0, dur: 1.1, size: 1 });
  ev.push({ t: t0 + 6.0, type: WB_EV.BEAM, from: 0, to: 1, dur: 1.3, width: 150, beam: WB_BEAM.LANCE, reach: 1.5 });
  ev.push({ t: t0 + 6.2, type: WB_EV.BURN, who: 1, amount: 0.9 });
  for (let k = 0; k < 3; k++) {
    salvo(tMeet - 0.6 + k * 0.45, 0, 1, 14, true);
    salvo(tMeet - 0.4 + k * 0.45, 1, 0, 14, true);
  }
  ev.push({ t: tMeet + 0.9, type: WB_EV.KILL, who: 1, cut: 0, delay: 0.9 });
  ev.push({ t: tMeet + 1.6, type: WB_EV.KILL, who: 0, cut: 0, delay: 0.9 });
  ev.sort((a, b) => a.t - b.t);
  A.tDie = tMeet + 1.6;
  B.tDie = tMeet + 0.9;
  A.tGone = A.tDie + 2;
  B.tGone = B.tDie + 2;
  return { kind: WB_HERO.DUEL, t0, t1: tMeet + 6, z, seed, ships: [A, B], events: ev,
    keys: { arrive: t0, salvo: t0 + 2.0, ray: t0 + 5.2, lance: t0 + 6.0, meet: tMeet, killB: tMeet + 0.9, killA: tMeet + 1.6, out: tMeet + 6 } };
}

const _pa = {};
const _pb = {};
/** Punkt kadru sceny bohaterów w chwili t (środek między żywymi okrętami; out: x, y, extent — rozpiętość [j.]). */
export function heroFocus(hero, t, out = {}) {
  const A = hero.ships[0];
  const B = hero.ships[1];
  heroShipPose(A, Math.min(t, A.tDie), _pa);
  heroShipPose(B, Math.min(t, B.tDie), _pb);
  const aOn = t >= A.tSpawn;
  const bOn = t >= B.tSpawn;
  if (aOn && bOn) { out.x = (_pa.x + _pb.x) * 0.5; out.y = (_pa.y + _pb.y) * 0.5; }
  else if (aOn) { out.x = _pa.x; out.y = _pa.y; }
  else { out.x = _pb.x; out.y = _pb.y; }
  const dx = _pa.x - _pb.x;
  const dy = _pa.y - _pb.y;
  const la = WB_CLASSES[A.cls].len * A.scale;
  const lb = WB_CLASSES[B.cls].len * B.scale;
  out.extent = Math.sqrt(dx * dx + dy * dy) + 0.5 * (la + lb);
  return out;
}
