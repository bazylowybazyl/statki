// Ring BUDOWA (Jowisz; decyzja użytkownika 2026-10-23: „ring w budowie oznacza zupełnie inny ring,
// z pojedynczymi »brudnymi« domami, wszędzie pył, gaz, małe części stoją”) — plan, czysta matematyka
// (testy node, teren kolidera gry).
//
// Większość obwodu to PRZERWY (`layout.construction`, haloRingConstruction.js). W przerwie stoi tylko
// KRĘGOSŁUP: dwa pasy kratownicy na krawędziach wstęgi (z = ±(zIn … uSide), h = −TB … 0 — przyszłe lica
// kadłuba; z góry lico +z w FG), pojedyncze PÓŁŻEBRA od pasów ku środkowi, pręty, rusztowania na pasach,
// płyty i belki zaparkowane na orbicie. Półżebra kończą się przed korytarzem |z| < BUD.slot, płyty
// i belki wiszą poza nim — w przerwie NIC nie przecina płaszczyzny gry (z = 0), więc przerwa jest
// przelotem dla statków i pocisków (kolider, radar, ruch v2 czytają te same przerwy).
// Zbudowane segmenty to WYSPY płyty: 4 przy kompleksach K-7 (port zbudowano pierwszy — zaopatruje
// budowę), małe przy tranzytach i kilka luźnych. Płyta wyspy jest kolizją jak dotąd (front budowy też:
// na nim pełne żebra przez całą szerokość), a baraki stojące w płaszczyźnie gry podnoszą teren
// (`heightAt`). Na wyspach POJEDYNCZE brudne baraki robotników (kontenery, prefabrykaty, moduły),
// rozrzucone i w małych obozach, bez miasta, parków i wody; ściany stoją tylko kawałkami.
//
// Układ jak w Fable: θ wzdłuż ringu, u = z w poprzek, h nad podłogą promieniowo NA ZEWNĄTRZ (h < 0 —
// kadłub od strony planety).
import { HALO_TRANSIT, haloPortComplexAngles, haloPortSites, haloTransitAngles } from '../haloRingConfig.js';
import { haloAngleDiff, haloGapEdgeDistance } from '../haloRingConstruction.js';
import { PORT_PAD_H } from '../haloRingRoofPlan.js';
import { ArchBatch, archBeamMatrix, archHex, archMatrix, archPoint, archRng } from './archFrame.js';

export const BUD = Object.freeze({
  // skala baraków: kontener ~200 j., barak 300–570 j. (okręt kapitałowy ~800 j.; mniejsze giną przy wstędze 3 000)
  house: 3.0,
  // korytarz przelotu w przerwie: nic z kręgosłupa nie wchodzi w |z| < slot (płaszczyzna gry z = 0)
  slot: 340,
  // długość przęsła kratownicy pasa [j. łuku podłogi]
  panel: 320,
  // pas kratownicy: od krawędzi podłogi o tyle do środka (z) aż do lica kadłuba
  chordIn: 70
});

const HS = BUD.house;

// Rodzaje materiału instancji (archTSL): 7 — barak (brud, rdza, okna), 8 — dron (lot w shaderze).
export const BUD_KIND = Object.freeze({ plain: 0, glow: 2, panel: 4, barak: 7, drone: 8 });

// Przekrój z układu: podłoga ±HW, ściany WH / WT, kadłub TB (z kratownicą — pokład TD).
export function budowaSection(layout) {
  const HW = layout.floor.spanZ * 0.5;
  const WT = layout.wallThickness;
  const TB = layout.hullThickness;
  const truss = layout.planetProfile?.hullTruss || null;
  return {
    HW, WT, TB,
    WH: layout.wallHeight,
    TD: truss ? Math.min(TB - 60, Math.max(40, Number(truss.deck) || 130)) : TB,
    uSide: HW + WT,
    zIn: HW - BUD.chordIn
  };
}

const subRngOf = (seed, tag) => {
  let h = (seed | 0) ^ 0x9E3779B9;
  for (let i = 0; i < tag.length; i++) { h = Math.imul(h ^ tag.charCodeAt(i), 0x01000193); h ^= h >>> 13; }
  const f = archRng(h >>> 0);
  return {
    next: f,
    range: (a, b) => a + (b - a) * f(),
    chance: (p) => f() < p,
    pick: (arr) => arr[Math.floor(f() * arr.length) % arr.length],
    int: (a, b) => a + Math.floor(f() * (b - a + 1))
  };
};

export function createBudowaPlan(layout, seed = layout.seed) {
  const R = layout.radii.floorMid;
  const W = layout.floor.spanZ;
  const HW = W * 0.5;
  const CIRC = layout.circumference;
  const section = budowaSection(layout);
  const subRng = (tag) => subRngOf(seed, tag);
  const hash1 = (n) => { const x = Math.sin(n * 12.9898 + seed * 0.001) * 43758.5453; return x - Math.floor(x); };
  const construction = layout.construction;
  const K = construction;
  const edgeDist = (theta) => haloGapEdgeDistance(theta, construction);
  const inFront = (theta, margin = 0) => edgeDist(theta) < K.front + margin;

  // ---- port (płyty doków, jak Fable) -----------------------------------------
  const sites = haloPortSites(R);
  const wrapD = (d) => d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  function portClass(theta, z, margin = 0) {
    let cls = 0;
    for (let i = 0; i < sites.length; i++) {
      const st = sites[i];
      const ds = Math.abs(wrapD(theta - st.theta)) * R;
      if (ds > st.halfS + 900 + margin) continue;
      if (ds < st.halfS + margin && z > st.zMin - 150 - margin && z < st.zMax + 250 + margin) return 2;
      if (ds < st.halfS + 600 + margin && z >= st.zMax + 250) cls = 1;
    }
    return cls;
  }
  const complexes = haloPortComplexAngles();
  const transits = haloTransitAngles();
  const transitHalf = (HALO_TRANSIT.halfWidth + HALO_TRANSIT.wall + HALO_TRANSIT.frame) / R;
  const nearTransit = (theta, margin = 0) => transits.some((t) => Math.abs(haloAngleDiff(theta, t)) < transitHalf + margin);

  // ---- wyspy (zbudowane segmenty) ---------------------------------------------
  const inside = (a, s) => { let d = a - s.a0; d -= Math.PI * 2 * Math.floor(d / (Math.PI * 2)); return d < s.a1 - s.a0; };
  const islands = (K.active ? K.segments : [{ a0: 0, a1: Math.PI * 2 }]).map((s, i) => {
    const port = complexes.findIndex((c) => inside(c, s));
    const transit = transits.findIndex((t) => inside(t, s));
    return { i, a0: s.a0, a1: s.a1, len: (s.a1 - s.a0) * R, kind: port >= 0 ? 'port' : transit >= 0 ? 'transit' : 'loose', port, transit };
  });

  // ---- baraki robotników ------------------------------------------------------
  // Typy: 0 kontenery (1–3 w stosie), 1 barak z prefabrykatów (długi, niski), 2 moduł mieszkalny (walec),
  // 3 buda piętrowa (skrzynki przesunięte). Wymiary: len wzdłuż (przed obrotem), dep w poprzek, hgt w górę.
  const houses = [];
  const hr = subRng('houses');
  const free = (theta, u, rad) => {
    for (let k = houses.length - 1; k >= 0 && k >= houses.length - 80; k--) {
      const o = houses[k];
      const ds = wrapD(theta - o.theta) * R;
      const du = u - o.u;
      const rr = rad + o.rad + 18 * HS;
      if (ds * ds + du * du < rr * rr) return false;
    }
    return true;
  };
  const okSpot = (theta, u, rad) => edgeDist(theta) > K.front + (rad + 60) / R
    && portClass(theta, u, rad + 120) !== 2
    && !nearTransit(theta, (rad + 160) / R)
    && Math.abs(u) < HW - rad - 40;
  const addHouse = (theta, u) => {
    const type = hr.chance(0.38) ? 0 : hr.chance(0.5) ? 1 : hr.chance(0.55) ? 2 : 3;
    let len; let dep; let hgt; let stack = 1;
    if (type === 0) { stack = hr.int(1, 3); len = hr.range(58, 74); dep = hr.range(23, 28); hgt = stack * hr.range(23, 27); }
    else if (type === 1) { len = hr.range(105, 190); dep = hr.range(38, 58); hgt = hr.range(27, 40); }
    else if (type === 2) { len = hr.range(38, 64); dep = len; hgt = hr.range(40, 92); }
    else { stack = hr.int(2, 3); len = hr.range(48, 80); dep = hr.range(36, 56); hgt = stack * hr.range(24, 32); }
    len *= HS; dep *= HS; hgt *= HS;
    const rad = Math.hypot(len, dep) * 0.5;
    if (!okSpot(theta, u, rad) || !free(theta, u, rad)) return false;
    houses.push({ theta, u, len, dep, hgt, stack, type, rad, yaw: hr.range(-0.35, 0.35) + (hr.chance(0.25) ? Math.PI * 0.5 : 0), seed: hr.next() });
    return true;
  };
  for (const isl of islands) {
    const span = isl.a1 - isl.a0;
    const at = (f) => isl.a0 + f * span;
    // obozy (2–7 baraków w promieniu ~400 j.) i pojedyncze baraki; port gęściej (robotnicy przy porcie)
    const camps = isl.kind === 'port' ? Math.max(3, Math.round(isl.len / 6000)) : isl.len > 2600 ? 1 : 0;
    const singles = Math.round(isl.len / (isl.kind === 'port' ? 1600 : 1100));
    for (let c = 0; c < camps; c++) {
      const th0 = at(hr.range(0.05, 0.95));
      const u0 = hr.range(-HW * 0.6, HW * 0.6);
      const n = hr.int(2, 6);
      for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
        if (addHouse(th0 + hr.range(-900, 900) / R, u0 + hr.range(-420, 420))) k++;
      }
    }
    for (let k = 0, tries = 0; k < singles && tries < singles * 6; tries++) {
      if (addHouse(at(hr.next()), hr.range(-HW + 80, HW - 80))) k++;
    }
  }
  houses.sort((a, b) => a.theta - b.theta);
  // obrys baraku w (s, u) po obrocie (pół-wymiary AABB) — teren kolidera
  for (const h of houses) {
    const c = Math.abs(Math.cos(h.yaw));
    const s = Math.abs(Math.sin(h.yaw));
    h.halfS = c * h.len * 0.5 + s * h.dep * 0.5;
    h.halfU = s * h.len * 0.5 + c * h.dep * 0.5;
  }
  const maxHalfS = houses.reduce((m, h) => Math.max(m, h.halfS), 0);
  const houseThetas = Float64Array.from(houses, (h) => h.theta);
  const lowerBound = (x) => {
    let lo = 0;
    let hi = houseThetas.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (houseThetas[mid] < x) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const scanHouses = (theta, z, a, b) => {
    let top = 0;
    for (let i = a; i < b; i++) {
      const h = houses[i];
      if (Math.abs(wrapD(theta - h.theta)) * R > h.halfS) continue;
      if (Math.abs(z - h.u) > h.halfU) continue;
      if (h.hgt > top) top = h.hgt;
    }
    return top;
  };
  // Wysokość terenu: płyty doków PORT_PAD_H, baraki stojące w (θ, z) — dach baraku (kolider gry pyta
  // z = 0: barak w płaszczyźnie gry jest przeszkodą). Poza wyspami 0 (przerwy wycina kolider).
  function heightAt(theta, z) {
    if (portClass(theta, z) === 2) return PORT_PAD_H;
    if (!houses.length) return 0;
    const t = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const w = maxHalfS / R;
    let top = scanHouses(t, z, lowerBound(t - w), lowerBound(t + w));
    // zawinięcie przy 0 / 2π
    if (t - w < 0) top = Math.max(top, scanHouses(t, z, lowerBound(t - w + Math.PI * 2), houses.length));
    if (t + w > Math.PI * 2) top = Math.max(top, scanHouses(t, z, 0, lowerBound(t + w - Math.PI * 2)));
    return top;
  }

  return {
    layout, R, W, HW, CIRC, seed, section,
    construction, edgeDist, inFront, islands, houses,
    sites, portClass, complexes, transits, nearTransit,
    subRng, hash1, heightAt
  };
}

// ---------------------------------------------------------------------------
// Barwy (sRGB dema → liniowe, przyciemnione jak konstrukcja Fable)
const STEEL = archHex(0x7c828a).map((v) => v * 0.7);
const DARK = archHex(0x4c5058).map((v) => v * 0.9);
const RUST = archHex(0x8a5a2a).map((v) => v * 0.5);
const IO = archHex(0xb59a45).map((v) => v * 0.5);
const HAZ = archHex(0xd9a21e).map((v) => v * 0.75);
const ROBOT = archHex(0xc9c2b0).map((v) => v * 0.55);
const COL_RED = [1.3, 0.16, 0.07];
const COL_GREEN = [0.14, 1.3, 0.4];
const COL_WHITE = [1.35, 1.28, 1.12];
const COL_AMBER = [1.3, 0.72, 0.16];
const COL_SODIUM = [1.35, 0.66, 0.22];
const WELD = [2.2, 2.45, 2.8];
// kontenery i prefabrykaty (sprane, brudne)
const HOUSE_COLS = [0x8a4a22, 0x3b5770, 0x5d6040, 0x6b6e70, 0x9a968a, 0x7a2a20, 0x8c7a52, 0x4a5a58].map((h) => archHex(h).map((v) => v * 0.62));

// Kręgosłup, półżebra, fronty budowy, płyty i belki na orbicie, sprzęt na wyspach.
// lights.add(x, y, z, barwa, rozmiar [j.], faza) — faza ≥ 1 = spawanie (archTSL: migotanie ~19 Hz).
export function buildBudowaStructure(plan, lights) {
  const { layout, R, HW } = plan;
  const { WH, TB, TD, uSide, zIn } = plan.section;
  const K = plan.construction;
  const zTop = layout.z.topIn;
  const bgAll = new ArchBatch('BudStruct');
  const fgAll = new ArchBatch('BudStructFG');
  const side = (z) => (z > zTop - 1 ? fgAll : bgAll);
  const m = new Array(16);
  const pa = {};
  const pb = {};
  const rng = plan.subRng('structure');
  const stats = { panels: 0, ribs: 0, parked: 0, fronts: 0, welds: 0, props: 0 };
  const beam = (th0, u0, h0, th1, u1, h1, w, color, kind = 0, p1 = 0.3) => {
    archBeamMatrix(archPoint(R, th0, u0, h0, pa), archPoint(R, th1, u1, h1, pb), w, m);
    side((u0 + u1) * 0.5).push16(m, color, kind, rng.next(), p1, 0);
  };
  const box = (th, u, h, yaw, sx, sy, sz, color, kind = 0, p1 = 0.3) => {
    archMatrix(R, th, u, h, sx, sy, sz, yaw, m);
    side(u).push16(m, color, kind, rng.next(), p1, 0);
  };
  const nav = (th, u, h, color, size, phase) => {
    const p = archPoint(R, th, u, h, pa);
    lights.add(p.x, p.y, p.z, color, size, phase);
  };
  const weld = (th, u, h, size = 20) => { nav(th, u, h, WELD, size, 1 + rng.next()); stats.welds++; };
  const open = (th) => plan.edgeDist(th) < K.front;   // przerwa albo front (goła kratownica)

  // ---- pasy kratownicy (kręgosłup): przęsła Warrena na czterech licach pasa ----
  const NP = Math.max(64, Math.round(layout.circumference / BUD.panel));
  const dA = (Math.PI * 2) / NP;
  const hTop = -8;
  const hBot = -TB + 8;
  for (let i = 0; i < NP; i++) {
    const a0 = i * dA;
    const a1 = a0 + dA;
    if (!open(a0 + dA * 0.5)) continue;
    stats.panels++;
    const up = (i & 1) === 0;
    for (const sd of [-1, 1]) {
      const zo = sd * (uSide - 10);
      const zi = sd * zIn;
      // słupki i krzyżulce lica zewnętrznego i wewnętrznego
      beam(a0, zo, hBot, a0, zo, hTop, 20, STEEL);
      beam(a0, zi, hBot, a0, zi, hTop, 16, STEEL);
      if (!rng.chance(0.05)) beam(a0, zo, up ? hBot : hTop, a1, zo, up ? hTop : hBot, 11, DARK);
      if (!rng.chance(0.08)) beam(a0, zi, up ? hTop : hBot, a1, zi, up ? hBot : hTop, 10, DARK);
      // poprzeczki i krzyżulce lica górnego i dolnego (w poprzek pasa)
      beam(a0, zi, hTop, a0, zo, hTop, 14, STEEL);
      beam(a0, zi, hBot, a0, zo, hBot, 14, STEEL);
      if (up) beam(a0, zi, hBot, a1, zo, hBot, 8, DARK);
      else beam(a0, zo, hTop, a1, zi, hTop, 8, DARK);
      // światła: bursztyn na narożach co kilka przęseł, nawigacja na licu zewnętrznym
      if (i % 6 === 0) nav(a0, zo + sd * 12, hTop + 10, COL_AMBER, 26, 0.3 + rng.next() * 0.6);
      if (i % 11 === 0) nav(a0, zo + sd * 12, hBot - 10, sd > 0 ? COL_GREEN : COL_RED, 22, rng.next() * 0.2);
    }
  }

  // ---- przerwy: półżebra, pręty, rusztowania, roboty, płyty i belki na orbicie ----
  if (K.active) {
    for (const gap of K.gaps) {
      const g0 = gap.center - gap.half;
      const gLen = gap.half * 2 * R;
      // półżebra: od pasa ku środkowi, koniec przed korytarzem przelotu (|z| ≥ BUD.slot)
      for (let s = rng.range(500, 1400); s < gLen - 400; s += rng.range(1300, 3400)) {
        const th = g0 + s / R;
        stats.ribs++;
        for (const sd of [-1, 1]) {
          if (rng.chance(0.18)) continue;
          const zi = sd * zIn;
          const zEnd = sd * rng.range(BUD.slot + 60, zIn - 260);
          beam(th, zi, hTop - 14, th, zEnd, hTop - 14, 30, STEEL);
          beam(th, zi, hBot + 14, th, zEnd, hBot + 14, 30, STEEL);
          if (rng.chance(0.65)) beam(th, zEnd, hBot + 14, th, zEnd, hTop - 14, 22, STEEL);
          if (rng.chance(0.7)) beam(th, zi, hBot + 14, th, zEnd, hTop - 14, 13, DARK);
          // pręty sterczące z końca żebra (zbrojenie czekające na płyty), nie dalej niż korytarz
          const nRod = rng.int(1, 4);
          for (let r = 0; r < nRod; r++) {
            const h = rng.chance(0.5) ? hTop - 14 : hBot + 14;
            const zz = sd * Math.max(BUD.slot, Math.abs(zEnd) - rng.range(60, 240));
            beam(th + rng.range(-12, 12) / R, zEnd, h, th + rng.range(-25, 25) / R, zz, h + rng.range(-20, 20), 5, RUST);
          }
          if (rng.chance(0.5)) weld(th, zEnd, rng.chance(0.5) ? hTop - 30 : hBot + 30, 22);
          if (rng.chance(0.35)) { box(th, zEnd + sd * 30, hTop - 4, rng.next() * Math.PI, 40, 18, 32, ROBOT, 0, 0.4); stats.props++; }
          if (rng.chance(0.4)) nav(th, zEnd, hTop + 6, COL_AMBER, 20, 0.3 + rng.next() * 0.6);
        }
      }
      // rusztowania na pasach (wieże nad licem górnym: h 0 … ~WH), z platformami
      for (let s = rng.range(800, 2500); s < gLen - 600; s += rng.range(2600, 6000)) {
        const th = g0 + s / R;
        const sd = rng.chance(0.5) ? 1 : -1;
        const u = sd * (zIn + (uSide - zIn) * 0.5);
        const top = WH * rng.range(0.7, 1.6);
        const w = 80;
        const d = (uSide - zIn) * 0.9;
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) beam(th + dx * w * 0.5 / R, u + dz * d * 0.5, 0, th + dx * w * 0.5 / R, u + dz * d * 0.5, top, 7, STEEL);
        for (let lv = 1; lv <= 3; lv++) box(th, u, (top * lv) / 3, 0, w + 8, 5, d + 8, lv === 3 ? HAZ : STEEL, 0, 0.2);
        if (rng.chance(0.6)) weld(th, u, top * 0.66, 22);
        nav(th, u, top + 8, COL_AMBER, 22, 0.4 + rng.next() * 0.5);
        stats.props += 7;
      }
      // płyty i belki zaparkowane na orbicie przy przerwie: poza korytarzem przelotu (|z| > BUD.slot + 100)
      const nPark = Math.max(1, Math.round(gLen / 3200));
      for (let k = 0; k < nPark; k++) {
        const th = g0 + rng.range(0.08, 0.92) * gap.half * 2;
        const sd = rng.chance(0.5) ? 1 : -1;
        const u = sd * rng.range(BUD.slot + 220, uSide + 500);
        const h = rng.range(-TB - 900, WH + 700);
        const n = rng.int(2, 6);
        const yaw = rng.range(-0.6, 0.6);
        const col = rng.chance(0.55) ? IO : rng.chance(0.5) ? STEEL : RUST;
        if (rng.chance(0.62)) {
          // stos płyt (lekko rozjechany)
          for (let q = 0; q < n; q++) box(th + rng.range(-14, 14) / R, u + rng.range(-14, 14), h + q * 18, yaw + rng.range(-0.08, 0.08), rng.range(260, 420), 14, rng.range(150, 250), col, 4, 0.25);
        } else {
          // wiązka belek
          for (let q = 0; q < n; q++) {
            const len = rng.range(380, 900);
            const dz = rng.range(-30, 30);
            const dh = rng.range(-30, 30);
            beam(th - len * 0.5 / R, u + dz, h + dh, th + len * 0.5 / R, u + dz + rng.range(-40, 40), h + dh + rng.range(-40, 40), rng.range(16, 26), col === IO ? STEEL : col);
          }
        }
        // linka do pasa i bursztynowy znacznik
        if (rng.chance(0.7)) beam(th, u, h, th + rng.range(-200, 200) / R, sd * zIn, hTop, 3, DARK);
        nav(th, u, h + 30, COL_AMBER, 20, 0.3 + rng.next() * 0.6);
        stats.parked++;
      }
    }

    // ---- fronty budowy (płyta, kolizja): pełne żebra przez szerokość, roboty spawalnicze na krawędzi
    // obłożenia, rusztowania, stosy płyt ----
    const Fw = K.front * R;
    for (const gap of K.gaps) {
      for (const sgn of [-1, 1]) {
        stats.fronts++;
        const edge = gap.center + sgn * gap.half;
        const at = (x) => edge + sgn * x / R;
        for (const u of [-uSide, 0, uSide]) nav(at(20), u, hTop + 12, COL_AMBER, 28, 0.3 + rng.next() * 0.6);
        for (let x = 30; x < Fw; x += rng.range(110, 190)) {
          beam(at(x), -uSide + 20, hTop - 12, at(x), uSide - 20, hTop - 12, 24, STEEL);
          beam(at(x), -uSide + 20, hBot + 12, at(x), uSide - 20, hBot + 12, 24, STEEL);
          if (x < Fw * 0.45 && rng.chance(0.5)) {
            const u = rng.range(-HW, HW);
            box(at(x), u, hTop - 4, rng.next() * Math.PI, 38, 16, 30, ROBOT, 0, 0.4);
            weld(at(x), u, hTop + 14, 18);
            stats.props++;
          }
        }
        // krawędź obłożenia podłogi: roboty spawalnicze w rzędzie w poprzek wstęgi
        for (let u = -HW * 0.85; u <= HW * 0.85; u += rng.range(190, 300)) {
          const x = rng.range(0.38, 0.55) * Fw;
          const th = at(x);
          box(th, u, 0, rng.next() * 0.6, 44, 32, 44, HAZ, 4, 0.3);
          const base = archPoint(R, th, u, 32, {});
          const elbow = archPoint(R, at(x - 50), u + rng.range(-30, 30), 110, {});
          const tip = archPoint(R, at(x - 105), u + rng.range(-25, 25), 12, {});
          archBeamMatrix(base, elbow, 12, m); side(u).push16(m, ROBOT, 0, 0, 0.4, 0);
          archBeamMatrix(elbow, tip, 8, m); side(u).push16(m, ROBOT, 0, 0, 0.4, 0);
          weld(at(x - 105), u, 16, 24);
          stats.props += 3;
        }
        // stosy płyt z Io i stali tuż za krawędzią obłożenia
        for (let i = 0; i < 4; i++) {
          const th = at(rng.range(0.7, 1.4) * Fw);
          const u = rng.range(-0.8, 0.8) * HW;
          const yaw = rng.range(-0.25, 0.25);
          const n = rng.int(1, 4);
          const col = rng.chance(0.6) ? IO : STEEL;
          for (let k = 0; k < n; k++) box(th, u, k * 20, yaw + k * 0.05, 170 - k * 16, 17, 110 - k * 10, col, 4, 0.2);
          stats.props++;
        }
      }
    }
  }

  // ---- wyspy: słupki ścian (gdzie ściany jeszcze nie ma), rury po podłodze, maszty świateł ----
  for (const isl of plan.islands) {
    const span = isl.a1 - isl.a0;
    for (let s = Fw0(plan); s < isl.len - Fw0(plan); s += rng.range(260, 420)) {
      const th = isl.a0 + s / R;
      if (plan.nearTransit(th, 0.004)) continue;
      for (const sd of [-1, 1]) {
        if (wallAt(plan, th, sd)) continue;
        if (rng.chance(0.3)) continue;
        beam(th, sd * (HW + 30), 0, th, sd * (HW + 30), WH * rng.range(0.55, 1.05), 14, STEEL);
      }
    }
    // maszty świateł roboczych
    const nMast = Math.max(1, Math.round(isl.len / 2200));
    for (let k = 0; k < nMast; k++) {
      const th = isl.a0 + rng.range(0.05, 0.95) * span;
      const u = rng.range(-HW + 120, HW - 120);
      if (plan.portClass(th, u, 80) === 2 || plan.nearTransit(th, 0.01) || plan.edgeDist(th) < K.front) continue;
      const hM = rng.range(80, 150);
      beam(th, u, 0, th, u, hM, 6, DARK);
      box(th, u, hM, rng.next(), 26, 5, 8, DARK, 0, 0.2);
      nav(th, u, hM + 6, COL_WHITE, 34, 0.1);
      nav(th + 10 / R, u, hM + 4, COL_WHITE, 26, 0.12);
    }
    // rury i kable po podłodze przy ścianach
    for (const sd of [-1, 1]) {
      const u = sd * (HW - 60 - rng.range(0, 40));
      for (let s = 0; s < isl.len; s += 420) {
        const th = isl.a0 + (s + 210) / R;
        if (plan.edgeDist(th) < K.front * 1.2 || plan.nearTransit(th, 0.004) || plan.portClass(th, u, 40) === 2) continue;
        archMatrix(R, th, u, 2, 424, 12, 12, 0, m);
        side(u).push16(m, sd > 0 ? RUST : DARK, 0, 0, 0.3, 0);
      }
    }
  }
  return { bg: bgAll, fg: fgAll, stats, NP };
}

// szerokość frontu w j. łuku (plan bez przerw: 0)
function Fw0(plan) { return plan.construction.active ? plan.construction.front * plan.R : 0; }

// Ściany wyspy stoją kawałkami (płyty co ~640 j.: ~40% obwodu wysp; przy kompleksie portu pełniej).
// Ta sama funkcja wybiera pasy ścian w obrazie (budowa.js) i słupki rusztowań w miejscach bez ścian.
export function wallAt(plan, theta, sd) {
  const K = plan.construction;
  if (K.active && plan.edgeDist(theta) < K.front * 1.05) return false;
  const cell = Math.floor((theta * plan.R) / 640);
  let near = Infinity;
  for (const c of plan.complexes) near = Math.min(near, Math.abs(haloAngleDiff(theta, c)) * plan.R);
  const p = near < 4200 ? 0.85 : 0.4;
  return plan.hash1(cell * 1.731 + (sd > 0 ? 0.37 : 0.83)) < p;
}

// Baraki: bryły (skrzynki i walce) per wyspa, światła drzwi i dachów, graty wokół.
// Zwraca listę { island, box: ArchBatch, cyl: ArchBatch, center: {θ} }.
export function buildBudowaHouses(plan, lights) {
  const { R } = plan;
  const m = new Array(16);
  const pa = {};
  const rng = plan.subRng('house-parts');
  const per = plan.islands.map((isl) => ({ island: isl, box: new ArchBatch('BudHouses'), cyl: new ArchBatch('BudHousesCyl'), theta: (isl.a0 + isl.a1) * 0.5 }));
  const islandOf = (theta) => {
    for (const p of per) { let d = theta - p.island.a0; d -= Math.PI * 2 * Math.floor(d / (Math.PI * 2)); if (d < p.island.a1 - p.island.a0) return p; }
    return per[0];
  };
  const nav = (th, u, h, color, size, phase) => { const p = archPoint(R, th, u, h, pa); lights.add(p.x, p.y, p.z, color, size, phase); };
  // przesunięcie w ramie baraku (x wzdłuż obróconej osi, z w poprzek) → (θ, u)
  const off = (H, x, z) => [H.theta + (x * Math.cos(H.yaw) + z * Math.sin(H.yaw)) / R, H.u + (-x * Math.sin(H.yaw) + z * Math.cos(H.yaw))];
  let n = 0;
  for (const H of plan.houses) {
    const P = islandOf(H.theta);
    const col = HOUSE_COLS[Math.floor(H.seed * HOUSE_COLS.length) % HOUSE_COLS.length];
    const col2 = HOUSE_COLS[Math.floor(H.seed * 97) % HOUSE_COLS.length];
    // gęstość okien: kontener mieszkalny rzadko (część to magazyny bez okien), barak i moduł — co drugie pole
    const win = H.type === 0 ? (rng.chance(0.6) ? 0.3 : 0) : 0.5;
    let top = H.hgt;
    if (H.type === 0) {
      const lh = H.hgt / H.stack;
      for (let k = 0; k < H.stack; k++) {
        const [th, u] = off(H, rng.range(-6, 6) * HS, rng.range(-3, 3) * HS);
        archMatrix(R, th, u, k * lh, H.len, lh - 1, H.dep, H.yaw + rng.range(-0.06, 0.06), m);
        P.box.push16(m, k === 0 ? col : (rng.chance(0.5) ? col2 : col), BUD_KIND.barak, rng.next(), win, 0);
      }
    } else if (H.type === 1) {
      archMatrix(R, H.theta, H.u, 0, H.len, H.hgt, H.dep, H.yaw, m);
      P.box.push16(m, col, BUD_KIND.barak, rng.next(), win, 0);
      // dobudówka (łata innego koloru)
      if (rng.chance(0.55)) {
        const [th, u] = off(H, H.len * 0.5 + 12 * HS, rng.range(-H.dep * 0.2, H.dep * 0.2));
        archMatrix(R, th, u, 0, 26 * HS, H.hgt * 0.75, H.dep * 0.6, H.yaw, m);
        P.box.push16(m, col2, BUD_KIND.barak, rng.next(), 0.5, 0);
      }
    } else if (H.type === 2) {
      archMatrix(R, H.theta, H.u, 0, H.len, H.hgt, H.dep, H.yaw, m);
      P.cyl.push16(m, col, BUD_KIND.barak, rng.next(), win, 0);
      archMatrix(R, H.theta, H.u, H.hgt, H.len * 0.6, 6 * HS, H.dep * 0.6, H.yaw, m);
      P.cyl.push16(m, col2, 0, 0, 0.2, 0);
      top += 6 * HS;
    } else {
      const lh = H.hgt / H.stack;
      for (let k = 0; k < H.stack; k++) {
        const f = 1 - k * 0.22;
        const [th, u] = off(H, rng.range(-12, 12) * k * HS, rng.range(-8, 8) * k * HS);
        archMatrix(R, th, u, k * lh, H.len * f, lh - 1, H.dep * f, H.yaw + rng.range(-0.15, 0.15), m);
        P.box.push16(m, rng.chance(0.4) ? col2 : col, BUD_KIND.barak, rng.next(), win, 0);
      }
    }
    // dach: klimatyzatory, zbiornik, antena z lampą
    const nRoof = H.type === 0 ? rng.int(0, 1) : rng.int(1, 3);
    for (let k = 0; k < nRoof; k++) {
      const [th, u] = off(H, rng.range(-0.35, 0.35) * H.len, rng.range(-0.3, 0.3) * H.dep);
      const s = rng.range(9, 18) * HS;
      archMatrix(R, th, u, top, s, s * 0.7, s, H.yaw, m);
      P.box.push16(m, DARK, 0, 0, 0.3, 0);
    }
    if (rng.chance(0.45)) {
      const [th, u] = off(H, rng.range(-0.3, 0.3) * H.len, rng.range(-0.25, 0.25) * H.dep);
      const d = rng.range(10, 17) * HS;
      archMatrix(R, th, u, top, d, rng.range(14, 26) * HS, d, 0, m);
      P.cyl.push16(m, rng.chance(0.5) ? RUST : STEEL, 0, 0, 0.4, 0);
    }
    if (rng.chance(0.5)) {
      const [th, u] = off(H, H.len * 0.4, -H.dep * 0.3);
      const hA = rng.range(30, 80) * HS;
      archMatrix(R, th, u, top, 2.5 * HS, hA, 2.5 * HS, 0, m);
      P.cyl.push16(m, DARK, 0, 0, 0.3, 0);
      nav(th, u, top + hA + 6, COL_RED, 22, 0.3 + rng.next() * 0.6);
    }
    // lampa nad drzwiami (sód), czasem migająca (zepsuta)
    {
      const [th, u] = off(H, rng.range(-0.3, 0.3) * H.len, H.dep * 0.5 + 6);
      nav(th, u, Math.min(top, 26 * HS) - 10, COL_SODIUM, rng.range(18, 28), rng.chance(0.15) ? 0.3 + rng.next() * 0.6 : 0.1);
    }
    // graty obok: skrzynie, butle, generator
    const nJunk = rng.int(0, 4);
    for (let k = 0; k < nJunk; k++) {
      const [th, u] = off(H, rng.range(-0.8, 0.8) * H.len, (rng.chance(0.5) ? 1 : -1) * (H.dep * 0.5 + rng.range(10, 40) * HS));
      if (Math.abs(u) > plan.HW - 30) continue;
      if (rng.chance(0.3)) {
        const d = rng.range(5, 9) * HS;
        archMatrix(R, th, u, 0, d, rng.range(12, 20) * HS, d, 0, m);
        P.cyl.push16(m, rng.chance(0.5) ? HAZ : STEEL, 0, 0, 0.4, 0);
      } else {
        const s = rng.range(8, 22) * HS;
        archMatrix(R, th, u, 0, s, s * rng.range(0.5, 0.9), s * rng.range(0.6, 1.2), rng.range(-0.6, 0.6), m);
        P.box.push16(m, rng.chance(0.3) ? col2 : DARK, 0, 0, 0.25, 0);
      }
    }
    n++;
  }
  return { per, count: n };
}

// Drony i roboty montażowe (bez wirników): kadłub-skrzynka lata po krzywej Lissajous wokół punktu
// zawieszenia (shader, rodzaj 8: p1 = amplituda [j.], p2 = tempo). Wokół frontów, żeber i wysp.
export function buildBudowaDrones(plan) {
  const { R, HW } = plan;
  const { TB, uSide } = plan.section;
  const K = plan.construction;
  const rng = plan.subRng('drones');
  const batch = new ArchBatch('BudDrones');
  const m = new Array(16);
  const put = (th, u, h, big = false) => {
    const s = big ? rng.range(26, 40) : rng.range(12, 20);
    archMatrix(R, th, u, h, s, s * 0.4, s * rng.range(0.8, 1.3), rng.next() * Math.PI * 2, m);
    batch.push16(m, ROBOT, BUD_KIND.drone, rng.next(), rng.range(40, big ? 120 : 220), rng.range(0.08, 0.35));
  };
  if (K.active) {
    for (const gap of K.gaps) {
      const gLen = gap.half * 2 * R;
      // przy frontach gęsto, nad pasami kręgosłupa rzadziej
      for (const sgn of [-1, 1]) {
        const edge = gap.center + sgn * gap.half;
        for (let i = 0; i < 14; i++) put(edge - sgn * rng.range(-0.5, 1.2) * K.front, rng.range(-uSide, uSide), rng.range(-TB - 150, 320), rng.chance(0.2));
      }
      const n = Math.round(gLen / 900);
      for (let i = 0; i < n; i++) {
        const sd = rng.chance(0.5) ? 1 : -1;
        put(gap.center + rng.range(-1, 1) * gap.half, sd * rng.range(HW * 0.6, uSide + 200), rng.range(-TB - 200, 300), rng.chance(0.15));
      }
    }
  }
  for (const isl of plan.islands) {
    const n = Math.round(isl.len / 1800);
    for (let i = 0; i < n; i++) put(isl.a0 + rng.next() * (isl.a1 - isl.a0), rng.range(-HW, HW), rng.range(60, 280), rng.chance(0.2));
  }
  return batch;
}

export const BUD_COLORS = Object.freeze({ STEEL, DARK, RUST, IO, HAZ, ROBOT });
