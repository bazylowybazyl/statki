/**
 * PRZEŁADUNEK PRZY STANOWISKU PORTU — rój dronów, stoły przeładunkowe i taśmociąg (E12).
 *
 * Zadokowany frachtowiec (bańka ruchu E6) otwiera ładownię, drony roju (klasy, chwyty płaskie
 * i ramiona z dema `dema/roj-webgpu.html`) przenoszą WARSTWY kontenerów między ładownią a stołami
 * przy burcie, a taśmociąg wzdłuż placu wiezie je do portalu w grzbiecie zatoki (UNLOAD) albo
 * z niego (LOAD). Kontener to WIDOK liczby: liczba kontenerów = ładownia × wypełnienie z kursu,
 * nic stąd nie wraca do ekonomii (ładunek liczy świat ruchu).
 *
 * PLAN ANALITYCZNY (decyzja E12, przyjęta tymczasowo przez orkiestratora 2026-10-22): plan to funkcja
 * kontekstu (ziarno kursu, kadłub, tryb, wypełnienie, okno postoju, geometria stanowiska), a stan —
 * funkcja planu i zegara postoju. Statek zmaterializowany w połowie postoju ma od razu właściwy
 * obraz, bez dogrywania symulacji i bez odczytów z GPU. Ruch jak w demie: parametry lotu klasy
 * (`SWARM_DRONE_CLASSES.flight`, z ładunkiem × `SWARM_LOADED_SPEED` / `SWARM_LOADED_ACCEL`),
 * profile trapezowe przyspieszenia, czasy chwytu i odłożenia `SWARM_OP_TIMES`, rozkładanie ramion
 * i zacisk szczęk jak w kernelu `swarmSim.js` (lustro wzorów `eArm` / `gArm`), zegar roju = czas
 * gry × `clock` (4 — decyzja użytkownika 2026-10-06). Tory się nie krzyżują: drony jednej burty
 * dostają ciągłe przedziały wzdłuż osi statku (jak `cargoBayOps.planBayTransfer`), burty są
 * rozdzielone osią, sąsiednie drony latają w dwóch pasmach wysokości.
 *
 * INTERFEJS ŹRÓDŁA (pod późniejszą symulację GPU z dema — ORCA i wieża z dogrywaniem od przechwytu):
 * obraz (`src/3d/cargo/portCargo3D.js`) czyta przeładunek WYŁĄCZNIE przez
 *   berthTransferState(plan, dockTime, sink)
 * gdzie `sink` dostaje `door(p)`, `drone(i, rekord)` i `layer(rekord)` w układzie stanowiska.
 * Źródło z symulacji GPU musi dać te same rekordy (pozy dronów, LOOK e / g / ciąg / kod, warstwy
 * kontenerów z przewoźnikiem) — reszta obrazu (ładownie, taśmy, partie) zostaje bez zmian.
 *
 * UKŁAD STANOWISKA (wszystkie wyniki): u — wzdłuż osi stanowiska (dziobem do grzbietu zatoki),
 * v — w prawo jak +y sprite'a (świat gry, y w dół), z — wysokość sceny (płaszczyzna lotu z = 0,
 * pokład zatoki ≈ −114,5). Punkt gry: x = X + u·cos θ − v·sin θ, y = Y + u·sin θ + v·cos θ
 * (θ — kąt stanowiska). Kurs w układzie stanowiska jest kątem gry względem θ.
 *
 * Czysta logika: bez three, DOM i `window`.
 */

import { CARGO_CONTAINER, cargoBayDoorTimeline, cargoBayHull, cargoBaySlots, cargoHullBays } from '../../data/cargoBays.js';
import {
  SWARM_CELL_PITCH, SWARM_LOADED_ACCEL, SWARM_LOADED_SPEED, swarmClassForFootprint, swarmDroneClass
} from '../../data/swarmDrones.js';
import { SWARM_OP_TIMES } from './swarmExecCpu.js';
import { SWARM_PHASE, SWARM_STATUS_CODE } from './swarmPort.js';
import { CARGO_PORT, cargoTransferWindow } from '../cargoPortOps.js';

export const BERTH_TRANSFER_TUNE = Object.freeze({
  /** Zegar roju = czas gry × clock (decyzja użytkownika 2026-10-06: „×1 za wolno”). */
  clock: 4,
  /** Pokład zatoki (wierzch płyty pola) i wysokości placu [z sceny]. */
  deckZ: CARGO_PORT.deckZ,
  tableH: 1.6,
  beltH: 2.4,
  /** Grzbiet serwisowy (gniazda dronów — włazy w grzbiecie przy dziobie). */
  nestZ: CARGO_PORT.spineZ,
  /** Pasmo przelotu: hak nad płaszczyzną lotu (wieże i mostki frachtowców ≤ ~12 j.) + drugie pasmo. */
  bandZ: 14,
  /** Taśma [j. / s zegara roju], odstęp komórek ponad długość warstwy, wysunięcie za portal. */
  beltSpeed: 30,
  beltGap: 6,
  beltExit: 40,
  beltWidthPad: 3,
  /** Stoły: odstęp między stołami, odległość stołu od burty i taśmy od stołu [j.]. */
  tableGap: 5,
  hullClear: 10,
  beltClear: 3,
  /** Czasy [s zegara roju]: postój warstwy na stole przed zsunięciem, zsuw, uspokojenie po zsunięciu. */
  hold: 1.0,
  slide: 1.6,
  settle: 0.4,
  /** LOAD: warstwa na stole najwcześniej tyle przed dolotem drona. */
  lead: 3.0,
  /** Starty z gniazda co tyle [s roju]; drony na burtę (wg pracy), najwyżej. */
  launchStagger: 1.25,
  maxPerSide: 16,
  /** Praca ma zająć najwyżej taki ułamek okna (zapas na czekanie przy stołach i taśmie). */
  workShare: 0.62,
  /** Wrota: start roju po tej części przebiegu otwarcia; zapas przed zamknięciem [s gry]. */
  doorLead: 0.6,
  closeMargin: 0.6
});

const T = BERTH_TRANSFER_TUNE;
const P = SWARM_PHASE;
const CODE = SWARM_STATUS_CODE;
const C = CARGO_CONTAINER;

export const BERTH_TRANSFER_MODE = Object.freeze({ LOAD: 'load', UNLOAD: 'unload' });

/** Stoły przy stanowisku wg klasy pola: obrys stołu (kontenery nx × ny) — największy moduł, który tu przyjmujemy. */
export const BERTH_TABLE_FOOTPRINT = Object.freeze({
  S: Object.freeze({ nx: 1, ny: 1 }),
  M: Object.freeze({ nx: 1, ny: 2 }),
  L: Object.freeze({ nx: 1, ny: 2 }),
  MEGA: Object.freeze({ nx: 2, ny: 2 }),
  CAPITAL: Object.freeze({ nx: 2, ny: 2 })
});

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const smoothstep = (a, b, x) => smooth((x - a) / (b - a));

function hash01(a, b = 0, c = 0) {
  let h = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ============================================================
// Geometria stanowiska: stoły, taśmy, gniazda
// ============================================================

/**
 * Plac stanowiska w układzie stanowiska (bez statku — infrastruktura portu, rysowana dla każdego pola
 * zatoki w kadrze). berth — { size ('S'|'M'|'L'|'MEGA'|'CAPITAL'), padLength, padBeam, halfBeam? }
 * (halfBeam — pół szerokości największego statku pola; domyślnie maxBeam / 2).
 * Zwraca { size, foot { nx, ny, L, W }, sides: [{ side, vTable, vBelt, tables: [u…], belt: { u0, u1, v,
 * width }, nest: { u, v, z } }], uPortal, beltPitch }.
 */
export function berthYardGeometry(berth) {
  const size = String(berth?.size || 'M').toUpperCase();
  const padLength = Number(berth?.padLength) || 620;
  const padBeam = Number(berth?.padBeam) || 380;
  const fp = BERTH_TABLE_FOOTPRINT[size] || BERTH_TABLE_FOOTPRINT.M;
  const L = fp.nx * C.L + (fp.nx - 1) * C.gap;
  const W = fp.ny * C.W + (fp.ny - 1) * C.gap;
  const halfBeam = Math.max(10, Number(berth?.halfBeam) || (Number(berth?.maxBeam) || padBeam * 0.68) / 2);
  const beltW = W + T.beltWidthPad;
  const v0 = halfBeam + T.hullClear;
  const vTable = v0 + W / 2;
  const vBelt = v0 + W + T.beltClear + beltW / 2;
  // Portal taśmy: lico grzbietu przed dziobem (grzebień zatoki — tuż za polem; pas MEGA — ściana tylna
  // 150 j. przed polem: berth.portalGap).
  const uPortal = padLength / 2 + (Number(berth?.portalGap) || 0);
  const pitch = L + T.tableGap;
  // Stoły od rufy ku dziobowi; przy dziobie zostaje miejsce na gniazdo dronów.
  const uLo = -padLength / 2 + 24 + L / 2;
  const uHi = padLength / 2 - 40 - L / 2;
  const n = Math.max(1, Math.floor((uHi - uLo) / pitch) + 1);
  const tables = [];
  const span = (n - 1) * pitch;
  const uMid = (uLo + uHi) / 2;
  for (let k = 0; k < n; k++) tables.push(uMid - span / 2 + k * pitch);
  const sides = [];
  for (const side of [-1, 1]) {
    sides.push({
      side,
      vTable: side * vTable,
      vBelt: side * vBelt,
      tables,
      belt: { u0: tables[0] - pitch * 0.75, u1: uPortal + T.beltExit, v: side * vBelt, width: beltW },
      nest: { u: uPortal + 26, v: side * Math.max(v0 * 0.5, 14), z: T.nestZ }
    });
  }
  return {
    size, foot: { nx: fp.nx, ny: fp.ny, L, W }, sides, uPortal, beltPitch: L + T.beltGap,
    // Pas MEGA (ciężkie frachtowce): szybsza taśma — inaczej przepustowość taśmy, nie dronów, wyznacza czas.
    beltSpeed: size === 'MEGA' ? T.beltSpeed * 1.8 : T.beltSpeed,
    padLength, padBeam, halfBeam
  };
}

// ============================================================
// Profil ruchu (trapez przyspieszenia)
// ============================================================

function profileTime(D, vmax, a) {
  if (!(D > 1e-6)) return 0;
  const dTri = (vmax * vmax) / a;
  return D < dTri ? 2 * Math.sqrt(D / a) : D / vmax + vmax / a;
}

/** Postęp s, prędkość i przyspieszenie na odcinku długości D w chwili t (profil trapezowy). */
function profileAt(D, vmax, a, t, out) {
  const Tt = profileTime(D, vmax, a);
  if (!(Tt > 0) || t >= Tt) { out.s = D; out.v = 0; out.a = 0; return out; }
  if (t <= 0) { out.s = 0; out.v = 0; out.a = 0; return out; }
  const dTri = (vmax * vmax) / a;
  let ta;
  let vp;
  if (D < dTri) { ta = Tt / 2; vp = a * ta; } else { ta = vmax / a; vp = vmax; }
  if (t < ta) { out.s = 0.5 * a * t * t; out.v = a * t; out.a = a; return out; }
  const tc = Tt - ta;
  if (t < tc) { out.s = 0.5 * a * ta * ta + vp * (t - ta); out.v = vp; out.a = 0; return out; }
  const r = Tt - t;
  out.s = D - 0.5 * a * r * r; out.v = a * r; out.a = -a;
  return out;
}

// ============================================================
// Plan
// ============================================================

/** Odcinek toru drona (czas roju). Ruch po prostej z p0 do p1 profilem trapezowym. */
function seg(list, t0, phase, x0, y0, z0, x1, y1, z1, vmax, acc, extra) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const D = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const dur = extra?.dur ?? profileTime(D, vmax, acc);
  const s = {
    t0, t1: t0 + dur, phase, x0, y0, z0, x1, y1, z1, D, vmax, acc,
    carry: extra?.carry ?? -1, code: extra?.code ?? CODE.EMPTY, arms: extra?.arms ?? 'fold',
    ref: extra?.ref ?? 0, bay: extra?.bay ?? 0, e0: extra?.e0 ?? 0
  };
  list.push(s);
  return s.t1;
}

/**
 * Plan przeładunku. ctx:
 *   seed     — ziarno (numer kursu),
 *   hull     — klucz kadłuba z ładownią (`CARGO_BAY_HULLS`) albo obiekt kadłuba,
 *   mode     — 'load' | 'unload',
 *   fill     — 0…1: ładunek kursu / ładowność klasy,
 *   resourceId — surowiec (wygląd kontenerów),
 *   dwell, moveSeconds — postój z rekordu kursu [s gry] (okno: cargoTransferWindow),
 *   berth    — { size, padLength, padBeam, halfBeam? } pola,
 *   ship     — { u, v, angle } statku w układzie stanowiska (domyślnie 0, 0, 0).
 * Zwraca plan albo null (brak ładowni / ładunku).
 */
export function planBerthTransfer(ctx) {
  const H = typeof ctx.hull === 'string' ? cargoBayHull(ctx.hull) : ctx.hull;
  const geo = H ? cargoHullBays(H)[0] : null;
  const mode = ctx.mode === 'load' ? 'load' : ctx.mode === 'unload' ? 'unload' : null;
  if (!geo || !mode || !(geo.slots > 0)) return null;
  const seed = ctx.seed | 0;
  const fill = clamp(Number(ctx.fill) || 0, 0, 1);
  const containers = fill > 0 ? Math.min(geo.containers, Math.max(1, Math.ceil(geo.containers * fill - 1e-9))) : 0;
  const yard = berthYardGeometry(ctx.berth);
  const ship = { u: Number(ctx.ship?.u) || 0, v: Number(ctx.ship?.v) || 0, angle: Number(ctx.ship?.angle) || 0 };
  const sc = Math.cos(ship.angle);
  const ss = Math.sin(ship.angle);
  // Okno postoju (zegar stanowiska — czas gry od przechwytu).
  const win = cargoTransferWindow({ seconds: Number(ctx.dwell) || 90, moveSeconds: Number(ctx.moveSeconds) || 0 });
  const door = cargoBayDoorTimeline(geo);
  const doorOpen = win.start;
  const doorClose = Math.max(doorOpen + door.total, win.end - door.total);
  const swarmStart = doorOpen + door.total * T.doorLead;
  const workEnd = Math.max(swarmStart + 1, doorClose - T.closeMargin);
  const W = (workEnd - swarmStart) * T.clock;

  // Klasa drona z obrysu modułu; chwyt dzieli moduł (podbloki warstwy).
  const mod = geo.module;
  const cls = swarmDroneClass(swarmClassForFootprint(mod.nx, mod.ny));
  const pnx = cls.pack.nx;
  const pny = cls.pack.ny;
  const gx = Math.max(1, Math.floor(mod.nx / pnx));
  const gy = Math.max(1, Math.floor(mod.ny / pny));
  const perTier = mod.nx * mod.ny;

  // Sloty → układ stanowiska (środek slotu na dnie ładowni), kolejność załadunku.
  const slots = cargoBaySlots(geo).map((sl) => {
    const x3 = geo.cx + sl.a;
    const py = -(geo.cy + sl.b);            // +y obrazka = v
    return { ...sl, u: ship.u + x3 * sc - py * ss, v: ship.v + x3 * ss + py * sc };
  });
  // Warstwy (podbloki chwytu): kontenery w slotach piętrami — widok liczby jak cargoBays.
  const layers = [];
  let left = containers;
  for (let si = 0; si < slots.length && left > 0; si++) {
    const sl = slots[si];
    const inSlot = Math.min(left, mod.count);
    left -= inSlot;
    for (let tier = 0; tier < mod.nz; tier++) {
      for (let by = 0; by < gy; by++) {
        for (let bx = 0; bx < gx; bx++) {
          const ks = [];
          for (let py = 0; py < pny; py++) {
            for (let px = 0; px < pnx; px++) {
              const k = tier * perTier + (by * pny + py) * mod.nx + (bx * pnx + px);
              if (k < inSlot) ks.push(py * pnx + px);
            }
          }
          if (!ks.length) continue;
          // Środek podbloku w układzie modułu (oś a wzdłuż statku).
          const da = (bx * pnx + (pnx - 1) / 2 - (mod.nx - 1) / 2) * SWARM_CELL_PITCH.a;
          const db = (by * pny + (pny - 1) / 2 - (mod.ny - 1) / 2) * SWARM_CELL_PITCH.b;
          const pyb = -db;
          layers.push({
            id: layers.length, slot: si, tier, count: ks.length, ks,
            u: sl.u + da * sc - pyb * ss, v: sl.v + da * ss + pyb * sc,
            zBay: -geo.depth + tier * C.H, order: sl.order, side: 0, table: -1,
            // oś czasu (czas roju): chwyt, odłożenie, stół, taśma
            tGrip: Infinity, tRel: Infinity, carrier: -1, tSlide0: Infinity, tSlide1: Infinity,
            tBelt0: Infinity, tBelt1: Infinity, uBelt: 0, tableU: 0, tableV: 0
          });
        }
      }
    }
  }
  const plan = {
    seed, mode, hull: H, geo, cls, containers, yard, ship, resourceId: ctx.resourceId || null,
    window: win, doorOpen, doorClose, doorTotal: door.total, swarmStart, workEnd, clock: T.clock,
    layers, drones: [], speedScale: 1, makespan: 0, waits: 0, bayDone: 0
  };
  if (!layers.length) return plan;

  // Burta warstwy: strona osi statku (środkowy rząd — na zmianę wg kolumny).
  for (const ly of layers) {
    const dv = ly.v;
    ly.side = Math.abs(dv) > 1 ? Math.sign(dv) : ((slots[ly.slot].col & 1) ? 1 : -1);
  }
  // Kolejność pracy: LOAD — kolejność załadunku (dno przed piętrem), UNLOAD — odwrotnie.
  const work = layers.slice().sort((a, b) => (a.order - b.order) || (a.tier - b.tier) || (a.id - b.id));
  if (mode === 'unload') work.reverse();

  const sides = [-1, 1].map((side) => ({ side, yard: yard.sides[side < 0 ? 0 : 1], lifts: work.filter((l) => l.side === side) }));
  let perSide = sides.map((s) => estimateDrones(s.lifts.length, W, cls));
  for (let attempt = 0; attempt < 4; attempt++) {
    plan.drones.length = 0;
    plan.waits = 0;
    plan.bayDone = 0;
    for (const ly of layers) { ly.carrier = -1; }
    for (let i = 0; i < sides.length; i++) planSide(plan, sides[i], perSide[i]);
    plan.makespan = plan.drones.reduce((m, d) => Math.max(m, d.segs.length ? d.segs[d.segs.length - 1].t1 : 0), 0);
    if (plan.makespan <= W * 0.98) break;
    const before = perSide.slice();
    perSide = perSide.map((n, i) => (sides[i].lifts.length ? Math.min(T.maxPerSide, Math.ceil(n * plan.makespan / (W * 0.85))) : 0));
    if (perSide.every((n, i) => n === before[i])) break;
  }
  // Ostatecznie (okno za krótkie nawet przy limicie dronów i przepustowości taśm): rój szybciej niż ×4 —
  // skala czasu planu (zegar roju = czas gry × clock × speedScale).
  if (plan.makespan > W * 0.98) plan.speedScale = plan.makespan / (W * 0.98);
  // Wrota zamykają się, gdy ostatni dron wyjdzie z ładowni (nie czekają do końca okna).
  const bayDone = plan.swarmStart + plan.bayDone / (plan.clock * plan.speedScale) + T.closeMargin;
  if (bayDone < plan.doorClose) plan.doorClose = Math.max(plan.doorOpen + plan.doorTotal, bayDone);
  return plan;
}

/** Drony na burtę z pracy: tyle, żeby przewozy zajęły ~workShare okna. */
function estimateDrones(lifts, W, cls) {
  if (!lifts) return 0;
  const f = cls.flight;
  // Kurs ~ (przelot 2 × 160 j., pion 4 × 130 j., operacje): z grubsza — dokładny czas daje planSide.
  const trip = 2 * profileTime(160, f.vMax * SWARM_LOADED_SPEED, f.accel * SWARM_LOADED_ACCEL)
    + 4 * profileTime(130, f.vVert, f.accelVert) + SWARM_OP_TIMES.grip + SWARM_OP_TIMES.release + 0.6;
  // Rój, nie pojedynczy dron — gęstość jak w demie (wymiana frachtowca: 96 dronów L na 760 kursów, ~1 dron na
  // 8 kursów): co najmniej 1 dron na 8 warstw burty; więcej, gdy okno ciasne; najwyżej maxPerSide.
  return clamp(Math.max(Math.ceil(lifts * trip / (W * T.workShare)), Math.ceil(lifts / 8)), 1, T.maxPerSide);
}

/**
 * Burta: drony z ciągłymi przedziałami warstw wzdłuż u, stoły i komórki taśmy tej burty. Symulacja
 * zdarzeń — dron z najwcześniejszym czasem planuje cały następny kurs; stół przyjmuje jedną warstwę
 * naraz, komórka taśmy jedną warstwę.
 */
function planSide(plan, S, nDrones) {
  const lifts = S.lifts;
  if (!lifts.length || !nDrones) return;
  const cls = plan.cls;
  const fl = cls.flight;
  const Y = S.yard;
  const unload = plan.mode === 'unload';
  const tableTop = T.deckZ + T.tableH;
  const H = C.H;
  // Stół warstwy: najbliższy w u (monotonicznie — tory się nie krzyżują).
  for (const ly of lifts) {
    let best = 0;
    for (let k = 1; k < Y.tables.length; k++) if (Math.abs(Y.tables[k] - ly.u) < Math.abs(Y.tables[best] - ly.u)) best = k;
    ly.table = best;
    ly.tableU = Y.tables[best];
    ly.tableV = Y.vTable;
  }
  // Przedziały dronów: sloty posortowane po u, podział na równe części pracy (ciągłe; granica tylko
  // między slotami — piętra jednego slotu bierze jeden dron, inaczej dolna warstwa mogłaby wyjść przed górną).
  const bySlot = new Map();
  for (const ly of lifts) {
    let e = bySlot.get(ly.slot);
    if (!e) { e = { u: ly.u, slot: ly.slot, n: 0 }; bySlot.set(ly.slot, e); }
    e.n++;
  }
  const slotsU = [...bySlot.values()].sort((a, b) => (a.u - b.u) || (a.slot - b.slot));
  const groups = [];
  const n = Math.min(nDrones, slotsU.length);
  let cursor = 0;
  let acc = 0;
  for (let g = 0; g < n; g++) {
    const target = ((g + 1) * lifts.length) / n;
    const set = new Set();
    while (cursor < slotsU.length && (acc < target - 1e-9 || !set.size)) {
      if (g < n - 1 && set.size && acc + slotsU[cursor].n / 2 > target) break;
      set.add(slotsU[cursor].slot);
      acc += slotsU[cursor].n;
      cursor++;
    }
    if (g === n - 1) while (cursor < slotsU.length) { set.add(slotsU[cursor].slot); cursor++; }
    // W grupie — kolejność pracy (LIFO ładowni).
    if (set.size) groups.push(lifts.filter((l) => set.has(l.slot)));
  }
  const tableFree = new Float64Array(Y.tables.length).fill(-Infinity);
  const usedCells = new Set();
  const bandH = cls.payload.H + cls.body.H + 2.5;
  const vE = fl.vMax;
  const aE = fl.accel;
  const vL = fl.vMax * SWARM_LOADED_SPEED;
  const aL = fl.accel * SWARM_LOADED_ACCEL;
  const vV = fl.vVert;
  const aV = fl.accelVert;
  const vVL = fl.vVert * SWARM_LOADED_SPEED;
  const aVL = fl.accelVert * SWARM_LOADED_ACCEL;
  const beltV = plan.yard.beltSpeed;
  const pitchT = (plan.yard.beltPitch) / beltV;
  const uPortal = plan.yard.uPortal;
  const uBelt0 = Y.belt.u0;
  const drones = groups.map((g, k) => {
    const idx = plan.drones.length;
    const band = T.bandZ + bandH + (k & 1) * (bandH + 1.5);
    const d = {
      index: idx, side: S.side, classIndex: cls.index, seed: hash01(plan.seed, idx, 7) * 0.9 + 0.05,
      segs: [], lifts: g, i: 0, band,
      time: k * T.launchStagger, x: Y.nest.u, y: Y.nest.v + S.side * (k % 3) * 3, z: Y.nest.z - cls.body.H - 2,
      started: false
    };
    plan.drones.push(d);
    return d;
  });
  const OP = SWARM_OP_TIMES;
  const payW = cls.payload.W;
  // Komórka taśmy: UNLOAD — komórka m mija punkt u w chwili (u − u0) / v + m · pitchT (m ↑ = później);
  // LOAD — wyjeżdża z portalu w m · pitchT, mija u po (uPortal − u) / v.
  const cellUnload = (u, t) => {
    let m = Math.ceil((t - (u - uBelt0) / beltV) / pitchT - 1e-9);
    while (usedCells.has(m)) m++;
    usedCells.add(m);
    return (u - uBelt0) / beltV + m * pitchT;
  };
  const cellLoad = (u, t) => {
    const travel = (uPortal - u) / beltV;
    let m = Math.ceil((t - travel) / pitchT - 1e-9);
    while (usedCells.has(m)) m++;
    usedCells.add(m);
    return m * pitchT + travel;
  };
  for (;;) {
    let d = null;
    for (const x of drones) if (x.i < x.lifts.length && (!d || x.time < d.time)) d = x;
    if (!d) break;
    const L = d.segs;
    let t = d.time;
    if (!d.started) {
      d.started = true;
      // Start z włazu w grzbiecie: pion w pasmo.
      t = seg(L, t, P.LAUNCH, d.x, d.y, d.z, d.x, d.y, d.band, vV, aV, { code: CODE.DOCKING });
      d.z = d.band;
    }
    const ly = d.lifts[d.i++];
    const tableX = ly.tableU;
    const tableY = ly.tableV;
    const bayHook = ly.zBay + H;
    const tableHook = tableTop + H;
    const src = unload ? { x: ly.u, y: ly.v, z: bayHook, bay: 1 } : { x: tableX, y: tableY, z: tableHook, bay: 0 };
    const dst = unload ? { x: tableX, y: tableY, z: tableHook, bay: 0 } : { x: ly.u, y: ly.v, z: bayHook, bay: 1 };
    // Lot do źródła (pusty) w paśmie.
    t = seg(L, t, P.TO_PICK, d.x, d.y, d.z, src.x, src.y, d.band, vE, aE, { code: CODE.EMPTY, arms: 'fold', e0: 0 });
    t = seg(L, t, P.ALIGN_PICK, src.x, src.y, d.band, src.x, src.y, d.band, 0, 1, { dur: OP.alignMin, code: CODE.DOCKING });
    if (!unload) {
      // LOAD: warstwa musi leżeć na stole — komórka taśmy dowozi ją przed zejściem drona.
      const want = Math.max(tableFree[ly.table], t - T.lead);
      const arrive = cellLoad(ly.tableU, want);
      ly.tBelt0 = arrive - (uPortal - ly.tableU) / beltV;
      ly.tBelt1 = arrive;
      ly.tSlide0 = arrive;
      ly.tSlide1 = arrive + T.slide;
      const ready = ly.tSlide1 + T.settle;
      if (ready > t) { plan.waits++; t = seg(L, t, P.ALIGN_PICK, src.x, src.y, d.band, src.x, src.y, d.band, 0, 1, { dur: ready - t, code: CODE.WAITING }); }
    }
    t = seg(L, t, P.DESC_PICK, src.x, src.y, d.band, src.x, src.y, src.z, vV, aV, { code: CODE.DOCKING, arms: 'descPick', ref: src.z, bay: src.bay });
    t = seg(L, t, P.GRIP, src.x, src.y, src.z, src.x, src.y, src.z, 0, 1, { dur: OP.grip, code: CODE.GRIP, arms: 'grip', bay: src.bay });
    ly.tGrip = t;
    ly.carrier = d.index;
    if (!unload) tableFree[ly.table] = t;
    t = seg(L, t, P.ASC_PICK, src.x, src.y, src.z, src.x, src.y, d.band, vVL, aVL, { code: CODE.DOCKING, arms: 'carry', carry: ly.id, bay: src.bay });
    if (unload) plan.bayDone = Math.max(plan.bayDone, t);
    t = seg(L, t, P.TO_DROP, src.x, src.y, d.band, dst.x, dst.y, d.band, vL, aL, { code: CODE.LOADED, arms: 'carry', carry: ly.id });
    t = seg(L, t, P.ALIGN_DROP, dst.x, dst.y, d.band, dst.x, dst.y, d.band, 0, 1, { dur: OP.alignMin, code: CODE.DOCKING, arms: 'carry', carry: ly.id });
    if (unload && tableFree[ly.table] > t) {
      plan.waits++;
      t = seg(L, t, P.ALIGN_DROP, dst.x, dst.y, d.band, dst.x, dst.y, d.band, 0, 1, { dur: tableFree[ly.table] - t, code: CODE.WAITING, arms: 'carry', carry: ly.id });
    }
    t = seg(L, t, P.DESC_DROP, dst.x, dst.y, d.band, dst.x, dst.y, dst.z, vVL, aVL, { code: CODE.DOCKING, arms: 'carry', carry: ly.id, bay: dst.bay });
    t = seg(L, t, P.RELEASE, dst.x, dst.y, dst.z, dst.x, dst.y, dst.z, 0, 1, { dur: OP.release, code: CODE.GRIP, arms: 'release', carry: ly.id, bay: dst.bay });
    ly.tRel = t;
    if (unload) {
      // Stół → taśma: komórka mija stół najwcześniej po postoju i zsuwie; stół wolny po zsuwie.
      const on = cellUnload(ly.tableU, t + T.hold + T.slide);
      ly.tSlide0 = on - T.slide;
      ly.tSlide1 = on;
      ly.tBelt0 = on;
      ly.tBelt1 = on + (uPortal + T.beltExit - ly.tableU) / beltV;
      tableFree[ly.table] = on;
    }
    t = seg(L, t, P.ASC_DROP, dst.x, dst.y, dst.z, dst.x, dst.y, d.band, vV, aV, { code: CODE.DOCKING, arms: 'ascDrop', ref: dst.z, bay: dst.bay });
    if (!unload) plan.bayDone = Math.max(plan.bayDone, t);
    d.x = dst.x; d.y = dst.y; d.z = d.band;
    if (d.i >= d.lifts.length) {
      // Powrót do włazu i zejście w grzbiet.
      const nx = Y.nest.u;
      const ny = Y.nest.v + S.side * (d.index % 3) * 3;
      t = seg(L, t, P.RETURN, d.x, d.y, d.z, nx, ny, d.band, vE, aE, { code: CODE.EMPTY });
      t = seg(L, t, P.LAND, nx, ny, d.band, nx, ny, Y.nest.z - cls.body.H - 2, vV * 0.7, aV, { code: CODE.DOCKING });
    }
    d.time = t;
  }
}

// ============================================================
// Stan w chwili t
// ============================================================

const _pf = { s: 0, v: 0, a: 0 };

/** Zegar roju dla zegara postoju [s gry]. */
export function berthTransferClock(plan, dockTime) {
  return ((Number(dockTime) || 0) - plan.swarmStart) * plan.clock * (plan.speedScale || 1);
}

/** Postęp wrót [s osi przebiegu] w chwili postoju (0 — zamknięte). */
export function berthTransferDoor(plan, dockTime) {
  const t = Number(dockTime) || 0;
  if (!(t > plan.doorOpen)) return 0;
  const opened = Math.min(plan.doorTotal, t - plan.doorOpen);
  if (!(t > plan.doorClose)) return opened;
  return Math.max(0, plan.doorTotal - (t - plan.doorClose));
}

function findSeg(segs, t) {
  let lo = 0;
  let hi = segs.length - 1;
  if (hi < 0 || t < segs[0].t0 || t >= segs[hi].t1) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].t0 <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Rekord drona (wielokrotnego użytku) w chwili tau (czas roju): pozycja haka (x, y, z w układzie
 * stanowiska), kurs (względem osi stanowiska — kurs statku), rozłożenie e, zacisk g, ciąg, kod stanu,
 * przyspieszenie (ax, ay, az), niesiona warstwa (−1), ładownia (1 — światło wnętrza), widoczny.
 */
export function berthDroneAt(plan, d, tau, out) {
  out.visible = false;
  const i = findSeg(d.segs, tau);
  if (i < 0) return out;
  const s = d.segs[i];
  const lt = tau - s.t0;
  let x = s.x0;
  let y = s.y0;
  let z = s.z0;
  let ax = 0;
  let ay = 0;
  let az = 0;
  let speed = 0;
  if (s.D > 1e-6 && s.vmax > 0) {
    profileAt(s.D, s.vmax, s.acc, lt, _pf);
    const k = _pf.s / s.D;
    x = s.x0 + (s.x1 - s.x0) * k;
    y = s.y0 + (s.y1 - s.y0) * k;
    z = s.z0 + (s.z1 - s.z0) * k;
    const ux = (s.x1 - s.x0) / s.D;
    const uy = (s.y1 - s.y0) / s.D;
    const uz = (s.z1 - s.z0) / s.D;
    ax = ux * _pf.a; ay = uy * _pf.a; az = uz * _pf.a;
    speed = _pf.v * Math.sqrt(ux * ux + uy * uy);
  }
  const cls = plan.cls;
  const payW = cls.payload.W;
  const OP = SWARM_OP_TIMES;
  let e = 0;
  let g = 0;
  switch (s.arms) {
    case 'descPick': e = 1 - smoothstep(payW * 0.15, payW * 1.3, z - s.ref); break;
    case 'grip': e = 1; g = clamp(lt / OP.grip, 0, 1); break;
    case 'carry': e = 1; g = 1; break;
    case 'release': e = 1; g = 1 - clamp(lt / OP.release, 0, 1); break;
    case 'ascDrop': e = 1 - smoothstep(payW * 0.3, payW * 1.6, z - s.ref); break;
    default: e = s.e0 * Math.exp(-3 * lt); break;
  }
  const aMax = s.carry >= 0 ? cls.flight.accel * SWARM_LOADED_ACCEL : cls.flight.accel;
  const aHor = Math.sqrt(ax * ax + ay * ay + az * az);
  out.x = x; out.y = y; out.z = z;
  out.yaw = plan.ship.angle;
  out.e = e; out.g = g;
  out.thrust = clamp(aHor / Math.max(aMax, 1e-3) * 0.75 + speed / Math.max(cls.flight.vMax, 1e-3) * 0.3, 0, 1);
  out.code = s.code;
  out.ax = ax; out.ay = ay; out.az = az;
  out.carry = s.carry;
  out.bay = s.bay > 0 && z < 0.5 ? 1 : 0;
  out.phase = s.phase;
  out.visible = true;
  return out;
}

const _drone = { x: 0, y: 0, z: 0, yaw: 0, e: 0, g: 0, thrust: 0, code: 0, ax: 0, ay: 0, az: 0, carry: -1, bay: 0, phase: 0, visible: false };
const _carriers = [];

/**
 * Stan przeładunku w chwili postoju `dockTime` [s gry od przechwytu] → sink:
 *   sink.door(p)                     — postęp wrót [s osi `cargoBayDoorTimeline`],
 *   sink.drone(i, d, rec)            — rekord drona (berthDroneAt; tylko widoczne),
 *   sink.layer(ly, x, y, z, yaw, where, rec) — warstwa: środek podbloku (x, y), podstawa z, kurs;
 *                                      where 0 ładownia, 1 chwyt drona, 2 stół, 3 taśma; rec — dron
 *                                      niosący (where 1) albo null,
 *   sink.belt(phase)                 — przesunięcie taśmy [j.] (wzór pasa).
 * Zwraca zegar roju.
 */
export function berthTransferState(plan, dockTime, sink) {
  const tau = berthTransferClock(plan, dockTime);
  if (sink.door) sink.door(berthTransferDoor(plan, dockTime));
  if (sink.belt) sink.belt(plan.yard.beltSpeed * tau);
  const drones = plan.drones;
  _carriers.length = drones.length;
  for (let i = 0; i < drones.length; i++) {
    const rec = _carriers[i] || (_carriers[i] = { ..._drone });
    berthDroneAt(plan, drones[i], tau, rec);
    if (rec.visible && sink.drone) sink.drone(i, drones[i], rec);
  }
  if (!sink.layer) return tau;
  const unload = plan.mode === 'unload';
  const yaw = plan.ship.angle;
  const tableZ = T.deckZ + T.tableH;
  const beltZ = T.deckZ + T.beltH;
  const v = plan.yard.beltSpeed;
  for (const ly of plan.layers) {
    // Przed chwytem: UNLOAD — w ładowni; LOAD — na taśmie / stole (albo jeszcze w porcie).
    if (tau < ly.tGrip) {
      if (unload) { sink.layer(ly, ly.u, ly.v, ly.zBay, yaw, 0, null); continue; }
      if (tau < ly.tBelt0) continue;
      if (tau < ly.tBelt1) {
        const u = plan.yard.uPortal - v * (tau - ly.tBelt0);
        sink.layer(ly, u, plan.yard.sides[ly.side < 0 ? 0 : 1].vBelt, beltZ, yaw, 3, null);
        continue;
      }
      const k = smooth((tau - ly.tSlide0) / T.slide);
      const vb = plan.yard.sides[ly.side < 0 ? 0 : 1].vBelt;
      sink.layer(ly, ly.tableU, vb + (ly.tableV - vb) * k, beltZ + (tableZ - beltZ) * k, yaw, 2, null);
      continue;
    }
    if (tau < ly.tRel) {
      const rec = ly.carrier >= 0 ? _carriers[ly.carrier] : null;
      if (rec && rec.visible) sink.layer(ly, rec.x, rec.y, rec.z - C.H, rec.yaw, 1, rec);
      continue;
    }
    if (!unload) { sink.layer(ly, ly.u, ly.v, ly.zBay, yaw, 0, null); continue; }
    if (tau < ly.tSlide0) { sink.layer(ly, ly.tableU, ly.tableV, tableZ, yaw, 2, null); continue; }
    const vb = plan.yard.sides[ly.side < 0 ? 0 : 1].vBelt;
    if (tau < ly.tSlide1) {
      const k = smooth((tau - ly.tSlide0) / T.slide);
      sink.layer(ly, ly.tableU, ly.tableV + (vb - ly.tableV) * k, tableZ + (beltZ - tableZ) * k, yaw, 2, null);
      continue;
    }
    if (tau < ly.tBelt1) sink.layer(ly, ly.tableU + v * (tau - ly.tBelt0), vb, beltZ, yaw, 3, null);
  }
  return tau;
}

/** Stan statyczny planu (do testów i narzędzi): ile warstw gdzie w chwili postoju. */
export function berthTransferCounts(plan, dockTime) {
  const out = { bay: 0, carried: 0, table: 0, belt: 0, drones: 0, door: 0, containersBay: 0 };
  berthTransferState(plan, dockTime, {
    door(p) { out.door = p; },
    drone() { out.drones++; },
    layer(ly, x, y, z, yaw, where) {
      if (where === 0) { out.bay++; out.containersBay += ly.count; } else if (where === 1) out.carried++;
      else if (where === 2) out.table++; else out.belt++;
    }
  });
  return out;
}

/** Punkt układu stanowiska → świat gry (x, y) i kurs gry. berthPose { x, y, angle }. */
export function berthToGame(berthPose, u, v, out = {}) {
  const c = Math.cos(berthPose.angle);
  const s = Math.sin(berthPose.angle);
  out.x = berthPose.x + u * c - v * s;
  out.y = berthPose.y + u * s + v * c;
  return out;
}

/** Statek (poza gry) w układzie stanowiska → { u, v, angle }. */
export function shipInBerth(berthPose, shipPose, out = {}) {
  const c = Math.cos(berthPose.angle);
  const s = Math.sin(berthPose.angle);
  const dx = shipPose.x - berthPose.x;
  const dy = shipPose.y - berthPose.y;
  out.u = dx * c + dy * s;
  out.v = -dx * s + dy * c;
  let a = shipPose.angle - berthPose.angle;
  a = Math.atan2(Math.sin(a), Math.cos(a));
  out.angle = a;
  return out;
}
