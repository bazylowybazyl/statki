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
// Układ jak w archFrame.js: θ wzdłuż ringu, u = z w poprzek, h nad podłogą promieniowo NA ZEWNĄTRZ (h < 0 —
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

// Rodzaje materiału instancji (archTSL): 7 — barak (brud, rdza, okna), 8 — dron (lot w shaderze), 9 — stal budowy
// (rdza plamami, sadza i ślady spawów przy węzłach).
export const BUD_KIND = Object.freeze({ plain: 0, glow: 2, panel: 4, barak: 7, drone: 8, steel: 9 });

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

  // ---- port (płyty doków, jak ECUMENE) -----------------------------------------
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
    // kąt w [0, 2π) — wyspa portu 0 leży na przejściu przez 2π (teren szuka baraków po posortowanym kącie)
    houses.push({ theta: ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), u, len, dep, hgt, stack, type, rad, yaw: hr.range(-0.35, 0.35) + (hr.chance(0.25) ? Math.PI * 0.5 : 0), seed: hr.next() });
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
// Barwy (sRGB → liniowe, przyciemnione). STEEL / DARK to znaczniki „stali budowy”: belka z taką barwą dostaje
// odcień przęsła (STEEL_TONES — szara, brunatna, ciemna, podkład czerwony, ocynk) i rodzaj 9 (rdza, sadza, spawy).
const STEEL = archHex(0x7c828a).map((v) => v * 0.7);
const DARK = archHex(0x4c5058).map((v) => v * 0.9);
const desat = (c, k) => { const g = (c[0] + c[1] + c[2]) / 3; return c.map((v) => v + (g - v) * k); };
const STEEL_TONES = [
  [0x6c737b, 0.62, 0.34], [0x6e655a, 0.6, 0.22], [0x4a4c50, 0.75, 0.2], [0x5f646a, 0.6, 0.12],
  [0x7a3424, 0.62, 0.1], [0x8d9196, 0.55, 0.02]
].map(([h, k, w]) => ({ c: archHex(h).map((v) => v * k), w }));
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
// kontenery i prefabrykaty: sprane, przygaszone (pół drogi do szarości), ciemne
const HOUSE_COLS = [0x8a4a22, 0x3b5770, 0x5d6040, 0x6b6e70, 0x9a968a, 0x7a2a20, 0x8c7a52, 0x4a5a58, 0x55524c].map((h) => desat(archHex(h), 0.5).map((v) => v * 0.5));
const PIPE = desat(archHex(0x6a5444), 0.3).map((v) => v * 0.5);
const DOOR = [0.018, 0.017, 0.016];

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
  // odcień stali bieżącego przęsła / żebra (tone()) i jego rdza — STEEL / DARK w beam() i box() → stal budowy
  let tone = STEEL_TONES[0].c;
  let rust = 0.3;
  const toneW = STEEL_TONES.reduce((s, t) => s + t.w, 0);
  const pickTone = () => {
    let x = rng.next() * toneW;
    let t = STEEL_TONES[0];
    for (const c of STEEL_TONES) { x -= c.w; if (x <= 0) { t = c; break; } }
    const v = 0.85 + 0.3 * rng.next();
    tone = t.c.map((c) => c * v);
    rust = rng.next() * rng.next();
  };
  const steelOf = (color, kind, p1) => (color === STEEL ? [tone, BUD_KIND.steel, rust] : color === DARK ? [tone.map((c) => c * 0.62), BUD_KIND.steel, rust + 0.2] : [color, kind, p1]);
  const beam = (th0, u0, h0, th1, u1, h1, w, color, kind = 0, p1 = 0.3) => {
    archBeamMatrix(archPoint(R, th0, u0, h0, pa), archPoint(R, th1, u1, h1, pb), w, m);
    const [c, k, p] = steelOf(color, kind, p1);
    side((u0 + u1) * 0.5).push16(m, c, k, rng.next(), p, 0);
  };
  const box = (th, u, h, yaw, sx, sy, sz, color, kind = 0, p1 = 0.3) => {
    archMatrix(R, th, u, h, sx, sy, sz, yaw, m);
    const [c, k, p] = steelOf(color, kind, p1);
    side(u).push16(m, c, k, rng.next(), p, 0);
  };
  const nav = (th, u, h, color, size, phase) => {
    const p = archPoint(R, th, u, h, pa);
    lights.add(p.x, p.y, p.z, color, size, phase);
  };
  // światła robocze dla siatki świateł gry (haloRingGame.js — spawanie oświetla pył i kadłuby): x, y, z lokalne, faza
  // (≥ 1 — spawanie, migocze jak sprite; < 0 — maszt, stałe)
  const work = [];
  const weld = (th, u, h, size = 20) => {
    const phase = 1 + rng.next();
    nav(th, u, h, WELD, size, phase);
    const p = archPoint(R, th, u, h, pa);
    work.push(p.x, p.y, p.z, phase);
    stats.welds++;
  };
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
    // przęsła montowane partiami: odcień i rdza zmieniają się co kilka przęseł
    if (i % 5 === 0 || rng.chance(0.12)) pickTone();
    // pasy wzdłużne (cztery naroża pasa): odcinek na przęsło, ciemniejsze dolne
    for (const sd of [-1, 1]) {
      for (const [z, h, r] of [[sd * (uSide - 10), hTop, 13], [sd * (uSide - 10), hBot, 16], [sd * zIn, hTop, 11], [sd * zIn, hBot, 13]]) {
        beam(a0, z, h, a1 + dA * 0.02, z, h, 2 * r, h > -TB * 0.5 ? STEEL : DARK);
      }
    }
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
        pickTone();
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
        pickTone();
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
        pickTone();
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
    pickTone();
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
      const p = archPoint(R, th, u, hM + 6, pa);
      work.push(p.x, p.y, p.z, -1);
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
  return { bg: bgAll, fg: fgAll, stats, NP, work: Float32Array.from(work) };
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

// Baraki: bryły (skrzynki i walce) per wyspa, detal i graty, światła drzwi i dachów.
// Barak składa się z modułów (bryła główna, dobudówki, stos kontenerów, piętra) i osprzętu przyczepionego do lic
// modułu głównego: drzwi z daszkiem, rury pionowe i pozioma, skrzynki na ścianach (klimatyzatory, rozdzielnie), łaty
// z innej blachy, drabina na dach; na dachu klimatyzatory, zbiornik, komin z sadzą, antena z lampą, talerz; w obozie
// kable z dachu na dach. Rama baraku: x wzdłuż jego osi (po obrocie `yaw`), z w poprzek (+z — lico z drzwiami).
// Zwraca { per: [{ island, box: ArchBatch, cyl: ArchBatch, theta }], count }.
export function buildBudowaHouses(plan, lights) {
  const { R } = plan;
  const m = new Array(16);
  const pa = {};
  const pb = {};
  const rng = plan.subRng('house-parts');
  const per = plan.islands.map((isl) => ({ island: isl, box: new ArchBatch('BudHouses'), cyl: new ArchBatch('BudHousesCyl'), theta: (isl.a0 + isl.a1) * 0.5 }));
  const islandOf = (theta) => {
    for (const p of per) { let d = theta - p.island.a0; d -= Math.PI * 2 * Math.floor(d / (Math.PI * 2)); if (d < p.island.a1 - p.island.a0) return p; }
    return per[0];
  };
  const nav = (th, u, h, color, size, phase) => { const p = archPoint(R, th, u, h, pa); lights.add(p.x, p.y, p.z, color, size, phase); };
  // punkt ramy baraku (x wzdłuż obróconej osi, z w poprzek) → (θ, u) — ta sama rama co archMatrix z yaw
  const off = (H, x, z) => {
    const c = Math.cos(H.yaw);
    const s = Math.sin(H.yaw);
    return [H.theta + (x * c + z * s) / R, H.u + (x * s - z * c)];
  };
  let n = 0;
  const tops = [];
  for (const H of plan.houses) {
    const P = islandOf(H.theta);
    const put = (x, z, h, sx, sy, sz, color, kind = 0, p1 = 0.3, dyaw = 0, cyl = false) => {
      const [th, u] = off(H, x, z);
      archMatrix(R, th, u, h, sx, sy, sz, H.yaw + dyaw, m);
      (cyl ? P.cyl : P.box).push16(m, color, kind, rng.next(), p1, 0);
    };
    const bar = (x0, z0, h0, x1, z1, h1, w, color, rustA = 0.5) => {
      const [t0, u0] = off(H, x0, z0);
      const [t1, u1] = off(H, x1, z1);
      archBeamMatrix(archPoint(R, t0, u0, h0, pa), archPoint(R, t1, u1, h1, pb), w, m);
      P.box.push16(m, color, BUD_KIND.steel, rng.next(), rustA, 0);
    };
    const col = HOUSE_COLS[Math.floor(H.seed * HOUSE_COLS.length) % HOUSE_COLS.length];
    const col2 = HOUSE_COLS[Math.floor(H.seed * 97) % HOUSE_COLS.length];
    // gęstość okien: kontener mieszkalny rzadko (część to magazyny bez okien), barak i moduł — co drugie pole
    const win = H.type === 0 ? (rng.chance(0.6) ? 0.3 : 0) : 0.5;
    let top = H.hgt;
    if (H.type === 0) {
      const lh = H.hgt / H.stack;
      for (let k = 0; k < H.stack; k++) {
        put(rng.range(-6, 6) * HS, rng.range(-3, 3) * HS, k * lh, H.len, lh - 1, H.dep, k === 0 ? col : (rng.chance(0.5) ? col2 : col), BUD_KIND.barak, win, rng.range(-0.06, 0.06));
      }
      // kontener obok, inny kolor, przesunięty (obóz z kontenerów)
      if (rng.chance(0.4)) put(rng.range(-0.3, 0.3) * H.len, H.dep + 6 * HS, 0, H.len * rng.range(0.6, 1), H.hgt / H.stack - 1, H.dep, col2, BUD_KIND.barak, 0, rng.range(-0.1, 0.1));
    } else if (H.type === 1) {
      put(0, 0, 0, H.len, H.hgt, H.dep, col, BUD_KIND.barak, win);
      // dobudówki: przedsionek przy końcu i niska przybudówka z tyłu
      if (rng.chance(0.65)) put(H.len * 0.5 + 12 * HS, rng.range(-0.2, 0.2) * H.dep, 0, 26 * HS, H.hgt * 0.75, H.dep * 0.6, col2, BUD_KIND.barak, 0.3);
      if (rng.chance(0.5)) put(rng.range(-0.25, 0.25) * H.len, -H.dep * 0.5 - 9 * HS, 0, H.len * rng.range(0.3, 0.55), H.hgt * 0.6, 18 * HS, rng.chance(0.5) ? col2 : col, BUD_KIND.barak, 0);
      // nadstawka na dachu (piętro z prefabrykatu, krótsze)
      if (rng.chance(0.35)) { put(rng.range(-0.2, 0.2) * H.len, 0, H.hgt, H.len * 0.4, H.hgt * 0.8, H.dep * 0.85, col2, BUD_KIND.barak, win); top = H.hgt * 1.8; }
    } else if (H.type === 2) {
      put(0, 0, 0, H.len, H.hgt, H.dep, col, BUD_KIND.barak, win, 0, true);
      put(0, 0, H.hgt, H.len * 0.6, 6 * HS, H.dep * 0.6, col2, 0, 0.2, 0, true);
      top += 6 * HS;
      // pierścienie łączeń segmentów modułu
      for (let k = 1; k < 3; k++) put(0, 0, H.hgt * k / 3 - 2 * HS, H.len * 1.04, 4 * HS, H.dep * 1.04, PIPE, BUD_KIND.steel, 0.6, 0, true);
      // śluza z boku
      put(0, H.dep * 0.5 + 8 * HS, 0, 18 * HS, 22 * HS, 16 * HS, col2, BUD_KIND.barak, 0);
    } else {
      const lh = H.hgt / H.stack;
      for (let k = 0; k < H.stack; k++) {
        const f = 1 - k * 0.22;
        put(rng.range(-12, 12) * k * HS, rng.range(-8, 8) * k * HS, k * lh, H.len * f, lh - 1, H.dep * f, rng.chance(0.4) ? col2 : col, BUD_KIND.barak, win, rng.range(-0.15, 0.15));
      }
      // schody zewnętrzne na piętro (skośna belka i podest)
      bar(-H.len * 0.5 - 4 * HS, H.dep * 0.3, 0, -H.len * 0.5 - 4 * HS, -H.dep * 0.2, lh, 5 * HS, PIPE);
      put(-H.len * 0.5 - 4 * HS, -H.dep * 0.25, lh - 2 * HS, 10 * HS, 2 * HS, 14 * HS, PIPE, BUD_KIND.steel, 0.5);
    }
    // wysokość modułu głównego (osprzęt lic) — kontenery: dolny kontener
    const hM = H.type === 0 ? H.hgt / H.stack : H.hgt;
    const len = H.len;
    const dep = H.dep;
    // drzwi z daszkiem i lampą (sód, czasem zepsuta — miga)
    {
      const dx = rng.range(-0.3, 0.3) * len;
      const dz = dep * 0.5 + 1.2 * HS;
      put(dx, dz, 0, 12 * HS, Math.min(22 * HS, hM * 0.8), 2 * HS, DOOR, 0, 0.1);
      put(dx, dz + 3 * HS, Math.min(23 * HS, hM * 0.82), 18 * HS, 1.6 * HS, 7 * HS, PIPE, BUD_KIND.steel, 0.7);
      const [th, u] = off(H, dx, dz + 4 * HS);
      nav(th, u, Math.min(top, 26 * HS) - 10, COL_SODIUM, rng.range(18, 28), rng.chance(0.15) ? 0.3 + rng.next() * 0.6 : 0.1);
    }
    // rury pionowe po licach (spływ, kable w peszlu) i pozioma wzdłuż tylnego lica
    const nPipe = rng.int(1, 3);
    for (let k = 0; k < nPipe; k++) {
      const pz = (rng.chance(0.5) ? 1 : -1) * (dep * 0.5 + 2 * HS);
      put(rng.range(-0.45, 0.45) * len, pz, 0, 3 * HS, hM + 4 * HS, 3 * HS, PIPE, BUD_KIND.steel, 0.7, 0, true);
    }
    if (rng.chance(0.6)) put(0, -dep * 0.5 - 2.5 * HS, hM * rng.range(0.5, 0.75), len * 0.9, 3 * HS, 3 * HS, PIPE, BUD_KIND.steel, 0.7);
    // skrzynki na licach (klimatyzatory, rozdzielnie) i łaty z innej blachy
    const nBox = rng.int(1, 3);
    for (let k = 0; k < nBox; k++) {
      const front = rng.chance(0.5) ? 1 : -1;
      const s = rng.range(7, 12) * HS;
      put(rng.range(-0.42, 0.42) * len, front * (dep * 0.5 + s * 0.3), hM * rng.range(0.25, 0.7), s, s * 0.8, s * 0.6, rng.chance(0.5) ? DARK : col2, 0, 0.2);
    }
    const nPatch = rng.int(0, 3);
    for (let k = 0; k < nPatch; k++) {
      const front = rng.chance(0.5) ? 1 : -1;
      const w = rng.range(10, 26) * HS;
      put(rng.range(-0.4, 0.4) * len, front * (dep * 0.5 + 0.6 * HS), hM * rng.range(0.05, 0.55), w, w * rng.range(0.4, 0.9), 1 * HS, desat(col2, 0.3), BUD_KIND.barak, 0);
    }
    // drabina na dach (dwie poręcze i szczeble)
    if (H.type !== 2 && rng.chance(0.35)) {
      const lx = len * 0.5 + 2 * HS;
      const lz = rng.range(-0.25, 0.25) * dep;
      for (const dz of [-4 * HS, 4 * HS]) bar(lx, lz + dz, 0, lx, lz + dz, hM + 8 * HS, 1.4 * HS, PIPE, 0.8);
      for (let h = 6 * HS; h < hM; h += 7 * HS) bar(lx, lz - 4 * HS, h, lx, lz + 4 * HS, h, 1 * HS, PIPE, 0.8);
    }
    // dach: klimatyzatory, zbiornik, komin z sadzą, antena z lampą, talerz łączności
    const nRoof = H.type === 0 ? rng.int(0, 2) : rng.int(1, 3);
    for (let k = 0; k < nRoof; k++) {
      const s = rng.range(9, 18) * HS;
      put(rng.range(-0.35, 0.35) * len, rng.range(-0.3, 0.3) * dep, top, s, s * 0.7, s, rng.chance(0.6) ? DARK : PIPE, 0, 0.3);
    }
    if (rng.chance(0.45)) {
      const d = rng.range(10, 17) * HS;
      put(rng.range(-0.3, 0.3) * len, rng.range(-0.25, 0.25) * dep, top, d, rng.range(14, 26) * HS, d, rng.chance(0.5) ? RUST : PIPE, BUD_KIND.steel, 0.8, 0, true);
    }
    if (rng.chance(0.35)) {
      const cx = rng.range(-0.35, 0.35) * len;
      const cz = rng.range(-0.3, 0.3) * dep;
      const ch = rng.range(18, 34) * HS;
      put(cx, cz, top, 5 * HS, ch, 5 * HS, PIPE, BUD_KIND.steel, 0.9, 0, true);
      put(cx, cz, top + ch, 5.6 * HS, 4 * HS, 5.6 * HS, DOOR, 0, 0.1, 0, true);
    }
    if (rng.chance(0.55)) {
      const ax = len * 0.4;
      const az = -dep * 0.3;
      const hA = rng.range(30, 80) * HS;
      put(ax, az, top, 2.5 * HS, hA, 2.5 * HS, DARK, 0, 0.3, 0, true);
      const [th, u] = off(H, ax, az);
      nav(th, u, top + hA + 6, COL_RED, 22, 0.3 + rng.next() * 0.6);
    }
    if (rng.chance(0.25)) {
      const dx = -len * 0.3;
      put(dx, 0, top, 3 * HS, 8 * HS, 3 * HS, DARK, 0, 0.3, 0, true);
      put(dx, 0, top + 8 * HS, 18 * HS, 2.5 * HS, 18 * HS, PIPE, BUD_KIND.steel, 0.4, 0, true);
    }
    // graty obok: butle, palety blach, skrzynie
    const nJunk = rng.int(1, 5);
    for (let k = 0; k < nJunk; k++) {
      const jx = rng.range(-0.8, 0.8) * len;
      const jz = (rng.chance(0.5) ? 1 : -1) * (dep * 0.5 + rng.range(10, 40) * HS);
      const ju = off(H, jx, jz)[1];
      if (Math.abs(ju) > plan.HW - 30) continue;
      const r = rng.next();
      if (r < 0.3) {
        const d = rng.range(5, 9) * HS;
        const nb = rng.int(1, 4);
        for (let q = 0; q < nb; q++) put(jx + q * d * 1.1, jz, 0, d, rng.range(12, 20) * HS, d, rng.chance(0.5) ? HAZ : PIPE, BUD_KIND.steel, 0.5, 0, true);
      } else if (r < 0.5) {
        const nb = rng.int(2, 5);
        for (let q = 0; q < nb; q++) put(jx, jz, q * 2.2 * HS, 40 * HS, 2 * HS, 24 * HS, rng.chance(0.6) ? IO : PIPE, BUD_KIND.steel, 0.7, rng.range(-0.1, 0.1));
      } else {
        const s = rng.range(8, 22) * HS;
        put(jx, jz, 0, s, s * rng.range(0.5, 0.9), s * rng.range(0.6, 1.2), rng.chance(0.3) ? col2 : DARK, BUD_KIND.barak, 0, rng.range(-0.6, 0.6));
      }
    }
    tops.push({ H, P, hM });
    n++;
  }
  // kable między barakami obozu (z dachu na dach, z ugięciem) — sąsiedzi w kolejności kąta na tej samej wyspie
  for (let i = 1; i < tops.length; i++) {
    const a = tops[i - 1];
    const b = tops[i];
    if (a.P !== b.P) continue;
    const ds = (b.H.theta - a.H.theta) * R;
    const du = b.H.u - a.H.u;
    const d = Math.sqrt(ds * ds + du * du);
    if (d > 900 || d < 1) continue;
    const h0 = a.hM * 0.92;
    const h1 = b.hM * 0.92;
    const p0 = archPoint(R, a.H.theta, a.H.u, h0, {});
    const p1 = archPoint(R, (a.H.theta + b.H.theta) * 0.5, (a.H.u + b.H.u) * 0.5, Math.min(h0, h1) * 0.6, {});
    const p2 = archPoint(R, b.H.theta, b.H.u, h1, {});
    archBeamMatrix(p0, p1, 1.2 * HS, m); a.P.box.push16(m, DOOR, 0, 0, 0.1, 0);
    archBeamMatrix(p1, p2, 1.2 * HS, m); a.P.box.push16(m, DOOR, 0, 0, 0.1, 0);
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
