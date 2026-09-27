// Stocznia portowa (Z7): dwie pochylnie okrętów z suwnicami bramowymi i żuraw
// wieżowy między nimi + SUCHY DOK — zamykana hala remontów i przezbrajania
// Atlasa i okrętów. Czysta matematyka (bez Three i DOM): układ, stanowiska
// w formacie K-7 (haloPortK7Layout.js / haloPortBays.js), bryły kolizji
// i stan budowy kadłuba z rejestru stoczni ruchu v2 (src/game/traffic/shipyards.js).
//
// Układ lokalny jak hub K-7: x wzdłuż (ringu albo lica megadoku), z na zewnątrz
// (tył budowli na podłodze habitatu / przy korpusie stacji, przód w kosmos),
// y = wysokość nad pokładem (K7_HEIGHTS: kadłub 48–116, płaszczyzna gry y = 116
// = z świata 0; nad nią wysokości ściśnięte ×0,42 — k7HeightToZ).
//
// Ekonomia (shipyards.js): stocznia ma SHIPYARD_MODEL.slots = 2 pochylnie, tempo
// SHIPYARD_WEIGHT × √skala (przy ×60 Ziemia ~22 okręty/h, Mars i Jowisz ~36/h) —
// kadłub na pochylni rośnie przez czas budowy klasy (WARSHIP_CLASSES.seconds).
// Okręt schodzi dziobem w kosmos (kąt pochylni +π/2), dalej zabiera go ruch.
//
// Proporcje suwnic (hangar-dock-demo): żaden profil suwnicy nie grubszy niż
// 1/20 rozpiętości jej mostu — pilnuje test.
import { K7_ATLAS, K7_PLACEMENT } from '../haloRing/haloPortK7Layout.js';
import { WARSHIP_CLASSES } from '../../game/traffic/shipyards.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Stanowisko capital K-7 (pole pod Atlasa) — ten sam standard w suchym doku.
const K7_CAPITAL_PAD = Object.freeze({ padLength: 2380, padBeam: 1330, maxLength: 2050, maxBeam: 1030 });

export const SHIPYARD_SPEC = Object.freeze({
  // Pochylnia: pole pod nosiciela (1080 × 384) z zapasem; łoże z blokami stępki.
  slip: Object.freeze({
    padLength: 1500, padBeam: 640, maxLength: 1250, maxBeam: 480,
    railOffset: 70,       // oś szyny suwnicy od krawędzi pola
    rail: 60,             // szerokość łoża szyny
    margin: 30,           // od szyny do krawędzi pasa pochylni
    blockPitch: 90,       // bloki stępki
    scaffoldPitch: 250    // wieże rusztowań wzdłuż burt
  }),
  // Suwnice bramowe pochylni: 2 na pochylnię, most nad kadłubem.
  slipGantry: Object.freeze({ leg: 34, girder: 26, girderH: 32, girderGap: 110, legTop: 470, count: 2 }),
  // Żuraw wieżowy na grzbiecie między pochylniami (wysięgnik nad obiema).
  tower: Object.freeze({ mast: 30, height: 600, jib: 650, counterJib: 220 }),
  spine: 240,             // grzbiet serwisowy między pochylniami
  yardGap: 300,           // droga między pochylniami a suchym dokiem
  workshop: 700,          // hala prefabrykacji bloków (tył, na całą szerokość pochylni)
  workshopH: 300,
  launchApron: 600,       // płyta przed dziobem pochylni (pas zejścia)
  // Suchy dok: hala pod Atlasa (pole capital K-7), drzwi teleskopowe, dach
  // zanikający, gdy statek w środku (jak dach K-7).
  drydock: Object.freeze({
    innerWidth: 1800,     // wzdłuż x (pole 1330 + chodniki pod ramiona)
    innerLength: 3000,    // wzdłuż z (pole 2380 + miejsce na obsługę i drzwi)
    wall: 110,
    wallTop: 620,         // jak ściany K-7 (y)
    roofBase: 711,        // płyta dachu jak w K-7 (y 711–793)
    door: Object.freeze({ leaves: 3, pocket: 330, thick: 60 }),
    gantry: Object.freeze({ girder: 44, girderH: 60, girderGap: 150, y: 470, count: 2 }),
    arms: 4,              // ramiona serwisowe na każdej ścianie bocznej
    apron: 600
  }),
  // Odstęp stanowiska od ściany tylnej suchego doku (obsługa, słupy paliwowe).
  drydockBackService: 260
});

/**
 * Etapy budowy kadłuba (ułamki czasu budowy) — wspólne dla shadera kadłuba
 * (portHullBuild3D.js) i animacji suwnic: stępka, wręgi, poszycie, wyposażenie.
 */
export const HULL_BUILD_STAGES = Object.freeze({
  keel: Object.freeze([0, 0.08]),
  frames: Object.freeze([0.08, 0.32]),
  plating: Object.freeze([0.32, 0.86]),
  outfit: Object.freeze([0.86, 1])
});
export const HULL_BUILD_STAGE_LABELS = Object.freeze({ keel: 'STĘPKA', frames: 'WRĘGI', plating: 'POSZYCIE', outfit: 'WYPOSAŻENIE', done: 'GOTOWY' });

/** Etap budowy dla postępu 0..1 (klucz HULL_BUILD_STAGES albo 'done'). */
export function hullBuildStage(progress) {
  const p = Number(progress);
  if (!(p < 1)) return 'done';
  for (const [key, [, b]] of Object.entries(HULL_BUILD_STAGES)) if (p < b) return key;
  return 'outfit';
}

/**
 * Czoło budowy wzdłuż kadłuba (0 = rufa, 1 = dziób) dla postępu — gdzie pracują
 * suwnice i spawarki. Stępka i wręgi idą od rufy do dziobu, poszycie za nimi,
 * wyposażenie jeszcze raz od rufy.
 */
export function hullBuildFront(progress) {
  const p = clamp(Number(progress) || 0, 0, 1);
  const S = HULL_BUILD_STAGES;
  const span = (r) => clamp((p - r[0]) / (r[1] - r[0]), 0, 1);
  if (p < S.keel[1]) return span(S.keel);
  if (p < S.frames[1]) return span(S.frames);
  if (p < S.plating[1]) return span(S.plating);
  return span(S.outfit);
}

/**
 * Pochylnie z rejestru stoczni ruchu v2: `yard.building` = [{ classId, remaining }]
 * (shipyards.js). Wynik na każdą pochylnię: { classId, hullId, progress, stage }
 * albo null (pusta). `slots` — ile pochylni ma układ (reszta kolejki zostaje w rejestrze).
 */
export function slipStatesFromYard(yard, slots = 2) {
  const out = [];
  const building = Array.isArray(yard?.building) ? yard.building : [];
  for (let i = 0; i < slots; i++) {
    const slip = building[i];
    const cls = slip ? WARSHIP_CLASSES[slip.classId] : null;
    if (!cls) { out.push(null); continue; }
    const progress = clamp(1 - (Number(slip.remaining) || 0) / cls.seconds, 0, 1);
    out.push({ classId: cls.id, hullId: cls.hull, progress, stage: hullBuildStage(progress) });
  }
  return out;
}

// Pola stop i przechwytu jak w K-7 (capital) — automat dokowania bierze je stąd.
const CAPITAL_CAPTURE = Object.freeze({ halfWidth: 145, halfLength: 180, maxSpeed: 30, maxAngle: 7 * Math.PI / 180 });

/**
 * Układ stoczni. Opcje:
 *   id        'Y-1' — przedrostek stanowisk
 *   slips     liczba pochylni (0–4; domyślnie 2 jak SHIPYARD_MODEL.slots)
 *   drydock   true — suchy dok po stronie +x
 *   backZ     z tylnej krawędzi (podłoga habitatu = K7_PLACEMENT.backZ na ringu, 0 na megadoku)
 *   centered  true — środek obrysu na x = 0
 * Stanowiska (`berths`) w formacie K-7: id, size, kind, x, z, angle, width/length
 * (zasięg w osiach układu), padLength/padBeam, maxLength/maxBeam, capture,
 * approach, stopPoint, occupied, reserved, lane, serviceAnchors. Pochylnie mają
 * size 'SLIP' i kind 'slip' (produkcja — nie dokuje się na nich), suchy dok
 * size 'CAPITAL' i kind 'drydock' (rola ruchu 'service').
 */
export function createShipyardLayout(options = {}) {
  const S = SHIPYARD_SPEC;
  const P = S.slip;
  const D = S.drydock;
  const id = String(options.id || 'Y-1');
  const slipCount = clamp(Math.floor(options.slips ?? 2), 0, 4);
  const withDock = options.drydock !== false;
  const B = Number.isFinite(options.backZ) ? options.backZ : K7_PLACEMENT.backZ;
  const slipHalf = P.padBeam / 2 + P.railOffset + P.rail / 2 + P.margin;
  const dockHalf = D.innerWidth / 2 + D.wall + D.door.pocket;
  // przekrój w x od lewej: pochylnie z grzbietami, droga, suchy dok
  let cursor = 0;
  const slipXs = [];
  for (let i = 0; i < slipCount; i++) {
    if (i > 0) cursor += S.spine;
    slipXs.push(cursor + slipHalf);
    cursor += 2 * slipHalf;
  }
  let dockX = null;
  if (withDock) {
    if (slipCount) cursor += S.yardGap;
    dockX = cursor + dockHalf;
    cursor += 2 * dockHalf;
  }
  const width = cursor;
  const shift = options.centered === false ? 0 : -width / 2;
  const l = {
    id, kind: 'shipyard', backZ: B, width,
    x0: shift, x1: shift + width,
    slips: [], berths: [], lanes: [], spines: [], towers: [], drydock: null, workshop: null
  };

  // ---- pochylnie
  const padZ0 = B + S.workshop + 60;
  const padZ1 = padZ0 + P.padLength;
  slipXs.forEach((sx, i) => {
    const x = sx + shift;
    const tag = id + '-S' + String(i + 1);
    const z = (padZ0 + padZ1) / 2;
    const railX = P.padBeam / 2 + P.railOffset;
    const apronZ1 = padZ1 + S.launchApron;
    const G = S.slipGantry;
    const span = 2 * railX;
    const slip = {
      id: tag, index: i, x, z0: padZ0, z1: padZ1, z, halfWidth: slipHalf,
      padLength: P.padLength, padBeam: P.padBeam, rails: [x - railX, x + railX],
      railZ0: B + S.workshop - 160, railZ1: apronZ1 - 40, apronZ1,
      gantry: {
        span, count: G.count, leg: G.leg, girder: G.girder, girderH: G.girderH, girderGap: G.girderGap, legTop: G.legTop,
        // miejsca postoju: przy hali prefabrykacji (tył) — mosty nad blokami
        homeZ: [padZ0 - 40, padZ0 + 150]
      }
    };
    l.slips.push(slip);
    const berth = {
      id: tag, size: 'SLIP', kind: 'slip', slipIndex: i, x, z,
      width: P.padBeam, length: P.padLength, padLength: P.padLength, padBeam: P.padBeam,
      angle: Math.PI / 2, maxLength: P.maxLength, maxBeam: P.maxBeam,
      occupied: null, reserved: null, lane: 'LANE-' + tag,
      // zejście z pochylni: dziobem w kosmos, prosto wzdłuż osi
      launch: { heading: Math.PI / 2, from: { x, z }, to: { x, z: apronZ1 + 1400 } },
      approach: { heading: -Math.PI / 2, from: { x, z: apronZ1 + 1400 }, to: { x, z }, width: P.padBeam - 60 },
      capture: { ...CAPITAL_CAPTURE },
      stopPoint: { x, z },
      serviceAnchors: []
    };
    l.berths.push(berth);
    l.lanes.push({ id: 'LANE-' + tag, berthId: tag, x, width: P.padBeam, z0: padZ0, z1: apronZ1 + 1400, reserved: null });
    if (i > 0) {
      const prev = l.slips[i - 1];
      const spineX = (prev.x + prev.halfWidth + x - slipHalf) / 2;
      l.spines.push({ x: spineX, width: S.spine, z0: B + S.workshop, z1: padZ1 });
    }
  });
  // żuraw wieżowy na grzbiecie (albo przy jedynej pochylni — po jej lewej)
  const T = S.tower;
  if (l.spines.length) {
    for (const sp of l.spines) l.towers.push({ x: sp.x, z: (padZ0 + padZ1) / 2 - 150, mast: T.mast, height: T.height, jib: T.jib, counterJib: T.counterJib });
  } else if (l.slips.length) {
    const s0 = l.slips[0];
    l.towers.push({ x: s0.x - s0.halfWidth + 60, z: (padZ0 + padZ1) / 2 - 150, mast: T.mast, height: T.height, jib: T.jib, counterJib: T.counterJib });
  }
  if (l.slips.length) {
    const xa = l.slips[0].x - slipHalf;
    const xb = l.slips[l.slips.length - 1].x + slipHalf;
    l.workshop = { x0: xa, x1: xb, z0: B, z1: B + S.workshop, height: S.workshopH };
  }

  // ---- suchy dok
  if (withDock) {
    const x = dockX + shift;
    const zIn0 = B + D.wall;
    const zIn1 = zIn0 + D.innerLength;
    const half = D.innerWidth / 2;
    const pad = K7_CAPITAL_PAD;
    const padZc = zIn0 + S.drydockBackService + pad.padLength / 2;
    const tag = id + '-D1';
    const G = D.gantry;
    const dock = {
      id: tag, x, backZ: B, z0: zIn0, z1: zIn1, frontZ: zIn1 + D.wall, halfWidth: half, wall: D.wall,
      wallTop: D.wallTop, roofBase: D.roofBase, apronZ1: zIn1 + D.wall + D.apron,
      outerHalf: half + D.wall, pocketHalf: half + D.wall + D.door.pocket,
      door: { leaves: D.door.leaves, pocket: D.door.pocket, thick: D.door.thick, z: zIn1 + D.wall / 2, opening: D.innerWidth },
      gantry: { span: D.innerWidth + D.wall, count: G.count, girder: G.girder, girderH: G.girderH, girderGap: G.girderGap, y: G.y,
        homeZ: [zIn0 + 260, zIn1 - 260] },
      arms: [],
      // obrys wnętrza (zanik dachu: statek w doku)
      footprint: [[x - half, zIn0], [x + half, zIn0], [x + half, zIn1 + D.wall], [x - half, zIn1 + D.wall]]
    };
    const armZs = [];
    for (let k = 0; k < D.arms; k++) armZs.push(zIn0 + 520 + k * ((D.innerLength - 1040) / Math.max(1, D.arms - 1)));
    for (const side of [-1, 1]) {
      for (const az of armZs) dock.arms.push({ side, x: x + side * (half - 20), z: az, reach: half - pad.padBeam * 0.18, y: 300 });
    }
    l.drydock = dock;
    const berth = {
      id: tag, size: 'CAPITAL', kind: 'drydock', x, z: padZc,
      width: pad.padBeam, length: pad.padLength, padLength: pad.padLength, padBeam: pad.padBeam,
      angle: -Math.PI / 2, maxLength: pad.maxLength, maxBeam: pad.maxBeam,
      occupied: null, reserved: null, lane: 'LANE-' + tag,
      approach: { heading: -Math.PI / 2, from: { x, z: dock.apronZ1 + 1400 }, to: { x, z: padZc }, width: D.innerWidth - 200 },
      capture: { ...CAPITAL_CAPTURE },
      stopPoint: { x, z: padZc },
      // słupy obsługi przy ścianie tylnej (wlewy paliwa na rufie Atlasa zostają
      // obsłużone ramionami — w doku statek stoi dziobem do ściany tylnej)
      serviceAnchors: [-1, 1].map((side) => ({ side, x: x + side * 360, z: zIn0 + 120, y: 224 }))
    };
    l.berths.push(berth);
    l.lanes.push({ id: 'LANE-' + tag, berthId: tag, x, width: D.innerWidth - 200, z0: zIn0, z1: dock.apronZ1 + 1400, reserved: null });
  }

  const front = Math.max(
    l.slips.length ? l.slips[0].apronZ1 : B,
    l.drydock ? l.drydock.apronZ1 : B
  );
  l.frontZ = front;
  l.depth = front - B;
  l.halfWidth = width / 2;
  l.footprint = [[l.x0, B], [l.x1, B], [l.x1, front], [l.x0, front]];
  l.capacity = { SLIP: l.slips.length, CAPITAL: l.drydock ? 1 : 0, total: l.berths.length };
  return l;
}

/** Stanowisko pochylni i (albo null). */
export function shipyardSlipBerth(l, i) {
  return l.berths.find((b) => b.kind === 'slip' && b.slipIndex === i) || null;
}
export function shipyardDrydockBerth(l) {
  return l.berths.find((b) => b.kind === 'drydock') || null;
}

/** Czy kadłub {length, beam} mieści się na stanowisku (standard K-7: najdłuższy × najszerszy). */
export function shipyardHullFits(berth, size) {
  return !!berth && !!size && size.length <= berth.maxLength && size.beam <= berth.maxBeam;
}

// Wymiary Atlasa (K-7) — suchy dok ma go mieścić z zapasem pola capital.
export const SHIPYARD_ATLAS = Object.freeze({ length: K7_ATLAS.w, beam: K7_ATLAS.h });

/**
 * Bryły stoczni w płaszczyźnie lotu (wysokości K-7: y środka, h) — wspólne dla
 * renderu i kolizji (jak baySolidList). `door: true` — skrzydła drzwi suchego
 * doku (host wyłącza je, gdy drzwi otwarte); `low` — poniżej kadłuba (nie
 * zderzają się z nim, K7CollisionWorld i tak pomija y1 < 48).
 */
export function shipyardSolidList(l) {
  const out = [];
  const add = (id, x, y, z, w, h, d, extra = null) => out.push({ id, x, y, z, w, h, d, angle: 0, ...(extra || {}) });
  if (l.workshop) {
    const w = l.workshop;
    add('WORKSHOP ' + l.id, (w.x0 + w.x1) / 2, w.height / 2, (w.z0 + w.z1) / 2, w.x1 - w.x0, w.height, w.z1 - w.z0);
  }
  for (const s of l.slips) {
    // rząd rusztowań przy każdej burcie (y 0–104): ściana pasa pochylni
    for (const side of [-1, 1]) {
      const x = s.x + side * (s.padBeam / 2 + 22);
      add('SCAFFOLD ' + s.id + (side < 0 ? ' W' : ' E'), x, 52, (s.z0 + s.z1) / 2, 30, 104, s.z1 - s.z0 - 40);
    }
  }
  for (const t of l.towers) add('TOWER CRANE ' + l.id, t.x, t.height / 2, t.z, t.mast + 30, t.height, t.mast + 30);
  for (const sp of l.spines) add('SPINE ' + l.id, sp.x, 40, (sp.z0 + sp.z1) / 2, sp.width - 40, 80, sp.z1 - sp.z0);
  const d = l.drydock;
  if (d) {
    const len = d.z1 - d.z0;
    const H = d.wallTop;
    add('DRYDOCK BACK ' + d.id, d.x, H / 2, d.backZ + d.wall / 2, 2 * d.outerHalf, H, d.wall);
    for (const side of [-1, 1]) {
      add('DRYDOCK WALL ' + d.id + (side < 0 ? ' W' : ' E'), d.x + side * (d.halfWidth + d.wall / 2), H / 2, (d.z0 + d.z1 + d.wall) / 2, d.wall, H, len + d.wall);
      // kieszeń drzwi teleskopowych za ścianą boczną (przy czole)
      add('DOOR POCKET ' + d.id + (side < 0 ? ' W' : ' E'), d.x + side * (d.outerHalf + d.door.pocket / 2), H / 2, d.door.z, d.door.pocket, H, d.wall + 40);
      // skrzydła drzwi (zamknięte): od lica ściany do osi — host wyłącza, gdy otwarte
      add('DOOR ' + d.id + (side < 0 ? ' W' : ' E'), d.x + side * d.halfWidth / 2, H / 2, d.door.z, d.halfWidth, H, d.door.thick, { door: true, side });
    }
    add('DRYDOCK SERVICE ' + d.id, d.x, 90, d.z0 + 70, 900, 180, 120);
  }
  // słupki świateł zejścia przy końcu płyty pochylni (niskie, poza polem)
  for (const s of l.slips) for (const side of [-1, 1]) add('LAUNCH BEACON ' + s.id + '/' + side, s.x + side * (s.padBeam / 2 + 60), 70, s.apronZ1 - 60, 50, 140, 50);
  return out;
}
