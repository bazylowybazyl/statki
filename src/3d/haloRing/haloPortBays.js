// Otwarte zatoki portu Ziemi (po bokach hal K-7) ze stanowiskami w standardzie
// K-7. Poprawka użytkownika 2026-09-23: gracz będzie latał frachtowcami
// i innymi statkami jak NPC, więc musi dokować także poza K-7 — „w K-7 masz
// sloty, takie same sloty muszą się pojawić w otwartych dokach”. Poprawka
// graficzna 2026-09-24: kompleks = K-7 pośrodku i po JEDNEJ zatoce z każdej
// strony (3 doki zamiast 4), zatoki powiększone tak, żeby pokryły stanowiska
// usuniętej trzeciej. Czysta matematyka, bez Three.
//
// Układ zatoki jak hub K-7 (k7Frame pod kątem zatoki): x wzdłuż ringu (0 =
// środek zatoki), z promieniowo na zewnątrz, z = K7_PLACEMENT.backZ = płyta
// portu na podłodze habitatu; wylot (otwarty bok, w kosmos) na z = floorZ +
// HALO_PORT.bayDepth. Wysokości (y) jak w K-7: pokład zatoki = pokład hali.
//
// Zatoka jest symetryczna (x od ściany do ściany):
//   [pas MEGA][grzbiet][grzebień ← aleja → grzebień][grzbiet][pas MEGA]
//  - 2 pasy MEGA przy ścianach, prosto od wylotu, dziobem do podłogi (jak
//    stanowiska capital K-7 z własnym pasem): megafrachtowiec 2760 × 912 j.,
//    też capital;
//  - podwójny grzebień jak boczne banki K-7: wspólna aleja od wylotu w głąb
//    i po obu jej stronach stanowiska L, M, S dziobem do grzbietu serwisowego
//    (wjazd dziobem z alei, wyjazd tyłem); grzbiet oddziela grzebień od pasa MEGA.
import { HALO_PORT, haloPortSites } from './haloRingConfig.js';
import { K7_BANK_SLOTS, K7_PLACEMENT, k7Frame, k7WorldToHub } from './haloPortK7Layout.js';

export const HALO_BAY = Object.freeze({
  innerHalf: (HALO_PORT.dockLength - 2 * HALO_PORT.sideWall) / 2,   // 2900: lica ścian bocznych
  aisleWidth: 900,          // aleja grzebienia (pośrodku zatoki)
  spine: 150,               // grzbiet serwisowy między grzebieniem a pasem MEGA
  // suwnice pasów MEGA (most od ściany do grzbietu, noga na grzbiecie): ułamek głębokości zatoki
  gantryAt: Object.freeze([0.42, 0.78]),
  mega: Object.freeze({ size: 'MEGA', padLength: 2900, padBeam: 1150, maxLength: 2900, maxBeam: 1100 }),
  // grzebień (po każdej stronie alei): od podłogi ku wylotowi (jak w K-7: duże najgłębiej)
  comb: Object.freeze([
    Object.freeze({ ...K7_BANK_SLOTS.L, count: 2 }),
    Object.freeze({ ...K7_BANK_SLOTS.M, count: 2 }),
    Object.freeze({ ...K7_BANK_SLOTS.S, count: 2 })
  ])
});

/**
 * Układ jednej zatoki (stanowiska w formacie K-7: id, size, x, z, angle,
 * width/length = zasięg pola w osiach huba, padLength/padBeam = wzdłuż/w poprzek
 * statku, maxLength/maxBeam, capture, approach, occupied, reserved). Wszystkie
 * wolne — zajętość daje system ruchu (NPC) albo gracz.
 */
export function createBayLayout({ index = 0, complex = 0, depth = HALO_PORT.bayDepth } = {}) {
  const B = HALO_BAY;
  const P = HALO_PORT;
  const F = K7_PLACEMENT.backZ;
  const tag = 'Z' + String(index + 1).padStart(2, '0');
  const half = B.innerHalf;
  const backZ = F + P.backWall;
  const openZ = F + depth;
  const l = {
    id: 'Z-' + String(index + 1).padStart(2, '0'), tag, index, complex,
    floorZ: F, backZ, openZ, depth, halfWidth: half, berths: [], lanes: [], spines: []
  };
  // przekrój w x: aleja pośrodku, pola grzebienia, grzbiety, pasy MEGA przy ścianach
  const aisleHalf = B.aisleWidth / 2;
  const spineIn = aisleHalf + K7_BANK_SLOTS.L.padLength;     // nosy pól grzebienia
  const spineOut = spineIn + B.spine;
  const laneWidth = half - spineOut;
  l.aisle = { x: 0, width: B.aisleWidth, z0: backZ + 60, z1: openZ };
  const M = B.mega;
  // pole MEGA od 150 j. przed ścianą tylną (tam słupki paliwowe przed dziobem)
  const megaZ = backZ + 150 + M.padLength / 2;
  [-1, 1].forEach((s, k) => {
    const x = s * (spineOut + laneWidth / 2);
    const id = tag + '-MG' + (k + 1);
    l.lanes.push({ id: 'LANE-' + id, berthId: id, side: s, x, width: laneWidth, z0: backZ, z1: openZ + 1200, reserved: null });
    l.spines.push({ side: s, x: s * (spineIn + B.spine / 2), width: B.spine, z0: backZ, z1: openZ - 40 });
    l.berths.push({
      id, size: 'MEGA', bayId: l.id, side: s, x, z: megaZ,
      width: M.padBeam, length: M.padLength, padLength: M.padLength, padBeam: M.padBeam,
      angle: -Math.PI / 2, maxLength: M.maxLength, maxBeam: M.maxBeam,
      occupied: null, lane: 'LANE-' + id,
      approach: { heading: -Math.PI / 2, from: { x, z: openZ + 1400 }, to: { x, z: megaZ }, width: laneWidth - 150 }
    });
  });
  // podwójny grzebień: zachód (L01, L02, M01…) i wschód (L03, L04, M03…), dziobem do grzbietu
  [-1, 1].forEach((s, k) => {
    let cursor = backZ + 100;
    for (const spec of B.comb) {
      for (let i = 0; i < spec.count; i++) {
        const x = s * (spineIn - spec.padLength / 2);
        const z = cursor + spec.padBeam / 2;
        const id = tag + '-' + spec.size + String(k * spec.count + i + 1).padStart(2, '0');
        l.berths.push({
          id, size: spec.size, bayId: l.id, side: s, x, z, width: spec.padLength, length: spec.padBeam,
          padLength: spec.padLength, padBeam: spec.padBeam, angle: s < 0 ? Math.PI : 0,
          maxLength: spec.maxLength, maxBeam: spec.maxBeam, occupied: null,
          approach: { heading: s < 0 ? Math.PI : 0, from: { x: 0, z }, to: { x, z }, width: spec.padBeam - 35 },
          servicePoint: { x: s * (spineIn + B.spine / 2), z: z - spec.padBeam * 0.28 }
        });
        cursor += spec.pitch;
      }
    }
    l.combEndZ = cursor;
  });
  for (const b of l.berths) {
    const big = b.size === 'MEGA';
    b.capture = { halfWidth: big ? 160 : 70, halfLength: big ? 220 : 55, maxSpeed: 30, maxAngle: 7 * Math.PI / 180 };
    b.reserved = null;
    b.stopPoint = { x: b.x, z: b.z };
    b.serviceAnchors = [];
  }
  l.capacity = { MEGA: 2, L: 4, M: 4, S: 4, total: l.berths.length };
  // obrys wnętrza (do czynnika „w porcie” modelu lotu)
  l.footprint = [[-half, backZ], [half, backZ], [half, openZ], [-half, openZ]];
  return l;
}

// Pas MEGA stanowiska (albo null dla grzebienia).
export function bayLaneOf(bay, berth) {
  return bay.lanes.find((v) => v.berthId === berth.id) || null;
}

// Bryły zatoki w płaszczyźnie lotu (wysokości K-7: y nad pokładem) — wspólne
// dla renderu (słupki serwisowe) i kolizji (ściany, kołnierz, słupki, paliwo).
// Ściany i kołnierz rysuje megastruktura (haloRingRoofPlan.js); grzbiety są
// niskie (poniżej kadłuba), więc nie są przeszkodą.
const yOfZ = (z) => (z <= 0 ? z + 116 : 116 + z / 0.42);
export function baySolidList(l) {
  const P = HALO_PORT;
  const out = [];
  const add = (id, x, y, z, w, h, d, mat = 'dark', angle = 0) => out.push({ id, x, y, z, w, h, d, mat, angle });
  const y0 = yOfZ(P.deckTop - 60);
  const y1 = yOfZ(P.wallTop);
  const depth = l.openZ - l.floorZ;
  for (const sd of [-1, 1]) {
    add('WALL ' + l.tag + (sd < 0 ? ' W' : ' E'), sd * (l.halfWidth + P.sideWall / 2), (y0 + y1) / 2, l.floorZ + depth / 2, P.sideWall, y1 - y0, depth);
    // słup kołnierza na podłodze (za ścianą boczną)
    const cy1 = yOfZ(P.wallTop + 80);
    add('COLLAR ' + l.tag + (sd < 0 ? ' W' : ' E'), sd * (l.halfWidth + P.sideWall + P.collar / 2), (y0 + cy1) / 2, l.floorZ + P.collarDepth / 2 - 30, P.collar, cy1 - y0, P.collarDepth + 60);
  }
  add('BACK ' + l.tag, 0, (y0 + y1) / 2, l.floorZ + P.backWall / 2, 2 * (l.halfWidth + P.sideWall), y1 - y0, P.backWall);
  for (const b of l.berths) {
    if (b.servicePoint) add('SERVICE ' + b.id, b.servicePoint.x, 79, b.servicePoint.z, 60, 158, 78, 'dark');
  }
  // słupki paliwowe przed dziobem każdego pasa MEGA
  for (const lane of l.lanes) {
    for (const side of [-1, 1]) add('FUEL ' + lane.berthId + '/' + side, lane.x + side * 400, 85, l.backZ + 70, 117, 170, 110, 'dark');
  }
  // nogi suwnic pasów MEGA na grzbietach (most wisi nad płaszczyzną lotu)
  for (const sp of l.spines) {
    for (const g of HALO_BAY.gantryAt) add('GANTRY LEG ' + l.tag + '/' + sp.side, sp.x, 239, l.floorZ + depth * g, 60, 478, 80, 'dark');
  }
  return out;
}

// Zatoki wszystkich kompleksów w kolejności haloPortSites (kompleks, potem
// zatoka): układ + ramka (k7Frame pod kątem zatoki).
export function haloBayLayouts(ringLayout) {
  const out = [];
  for (const site of haloPortSites(ringLayout.radii.floorMid)) {
    if (site.kind !== 'dock') continue;
    const l = createBayLayout({ index: site.index, complex: site.complex });
    l.theta = site.theta;
    l.frame = k7Frame(ringLayout, site.theta);
    // strona względem hali K-7 (−1 = zachód, +1 = wschód): pas MEGA od strony hali = wewnętrzny
    l.hallSide = Math.sign(HALO_PORT.dockOffsets[site.index % HALO_PORT.docks]) || 1;
    out.push(l);
  }
  return out;
}

// Przejście między układami dwóch ramek (np. zatoka → hub hali kompleksu):
// X = ox + x·c − z·s, Z = oz + x·s + z·c, kurs + phi.
export function haloFrameToFrame(src, dst) {
  const o = k7WorldToHub(dst, src.origin.x, src.origin.y, {});
  const ax = src.tx * dst.tx + src.ty * dst.ty;
  const az = src.tx * dst.rx + src.ty * dst.ry;
  const phi = Math.atan2(az, ax);
  return { ox: o.x, oz: o.z, c: Math.cos(phi), s: Math.sin(phi), phi };
}
export function haloXfPoint(xf, x, z, out = {}) {
  out.x = xf.ox + x * xf.c - z * xf.s;
  out.z = xf.oz + x * xf.s + z * xf.c;
  return out;
}
