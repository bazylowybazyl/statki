// Stocznia portowa (Z7) — układ według szkicu użytkownika (2026-09-27):
//
//   ring ══════╤═════════╤══════   galeria wzdłuż ringu: taśma kontenerów z obu stron
//              └─────┬───┘          skręca w trzon (wpięcie stoczni w ring)
//          ┌──────┐  ║  ┌──────┐
//          │  ▲   │  ║  │  ▲   │    dwie pochylnie po bokach trzonu: kadłub buduje RÓJ
//          │  ▲   │  ║  │  ▲   │    DRONÓW, jeden dźwig na pochylnię (tylko przenosi
//          └──────┘  ║  └──────┘    ciężkie moduły — dwa mijałyby się)
//                 \  ║  /
//              ───(  piasta )───    Ziemia: okrąg z wypustkami — na wypustkach i na
//                 /       \         tarczy place postoju / refitu różnych klas;
//                                   inne frakcje: litera U z basenem
//
// Czysta matematyka (bez Three i DOM): układ, stanowiska w formacie K-7
// (haloPortK7Layout.js / haloPortBays.js), bryły kolizji, trasy taśmy i stan
// budowy kadłuba z rejestru stoczni ruchu v2 (src/game/traffic/shipyards.js).
//
// Układ lokalny jak hub K-7: x wzdłuż ringu (albo lica megadoku), z na zewnątrz
// (korzeń wpięty w podłogę habitatu / w korpus stacji, piasta w kosmosie),
// y = wysokość nad pokładem (K7_HEIGHTS: kadłub 48–116, płaszczyzna gry y = 116 =
// z świata 0; nad nią ×0,42 — k7HeightToZ). Pokłady trzonu, pochylni i piasty są
// pod płaszczyzną gry (statki latają nad nimi); przeszkodami są wieże, kołnierz,
// rdzeń piasty i wieże serwisowe stanowisk.
//
// Ekonomia (shipyards.js): SHIPYARD_MODEL.slots = 2 pochylnie, tempo
// SHIPYARD_WEIGHT × √skala. Okręt schodzi z pochylni dziobem ku piaście i staje
// na placu postoju (flota frakcji), skąd leci do doku — albo przechodzi refit.
import { K7_ATLAS, K7_BANK_SLOTS, K7_PLACEMENT, k7BoxPoly } from '../haloRing/haloPortK7Layout.js';
import { WARSHIP_CLASSES } from '../../game/traffic/shipyards.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const DEG = Math.PI / 180;

// Wysokość kadłuba w budowie (K-7 y; z świata −6 — tuż pod płaszczyzną gry):
// czworokąt portHullBuild3D.js, rój dronów i dźwig odkładają na nim moduły.
export const SHIPYARD_HULL_Y = 110;

// Pola stanowisk: standard K-7 (capital, L, M) + pole nosiciela (sprite 1080 × 608).
export const SHIPYARD_PADS = Object.freeze({
  CAPITAL: Object.freeze({ size: 'CAPITAL', padLength: 2380, padBeam: 1330, maxLength: 2050, maxBeam: 1030 }),
  CARRIER: Object.freeze({ size: 'CAPITAL', padLength: 1500, padBeam: 720, maxLength: 1250, maxBeam: 500 }),
  L: Object.freeze({ ...K7_BANK_SLOTS.L }),
  M: Object.freeze({ ...K7_BANK_SLOTS.M })
});

export const SHIPYARD_SPEC = Object.freeze({
  // Galeria wzdłuż ringu (taśma z obu stron) i trzon z taśmą pośrodku. Na ringu
  // korzeń przechodzi przez wąwóz habitatu (1500 j. od podłogi do krawędzi ścian).
  gallery: Object.freeze({ depth: 300, reach: 1400 }),
  spine: Object.freeze({ width: 900, rootDepth: 1650, collar: 360, collarDepth: 440, belt: 150, housing: 220 }),
  // Pochylnia (plac budowy): rama z łożem kadłuba, szyny dźwigu na dłuższych
  // krawędziach, wieże narożne, stojak dronów od strony trzonu.
  berth: Object.freeze({
    width: 1300, length: 1900, gap: 140, pitch: 2200,
    padLength: 1500, padBeam: 700, maxLength: 1250, maxBeam: 500,
    rail: 50, apron: 400, lane: 900
  }),
  // Jeden dźwig na pochylnię: most na szynach, wysięgnik nad trzonem do stacji taśmy.
  crane: Object.freeze({ leg: 44, girder: 30, girderH: 38, girderGap: 130, legTop: 470 }),
  // stojak dronów: odstępy z obrysu drona z blokami RCS (rama 60 × 25 + ramiona)
  rack: Object.freeze({ cols: 2, rows: 12, pitchX: 52, pitchZ: 76, inset: 115 }),
  // stacja taśmy przy krawędzi trzonu: trzy miejsca odbioru modułów (windy)
  // i miejsce bloku dźwigu dalej wzdłuż trzonu
  station: Object.freeze({ edge: 110, z: 300, spots: Object.freeze([-85, 0, 85]), heavy: 235 }),
  hubGap: 700,
  // Piasta Ziemi: tarcza z rdzeniem (terminal taśmy, gniazdo dronów, wieża),
  // wewnętrzne place M między wypustkami, wypustki ze stanowiskami (kąt 0 = +z,
  // od piasty w kosmos; +kąt ku +x), składy refitu przy rdzeniu od strony trzonu.
  radial: Object.freeze({
    disc: 1500,
    core: 380,
    inner: Object.freeze({ slot: 'M', angles: Object.freeze([-90, -30, 30, 90]), gap: 240 }),
    // tower: strona wieży serwisowej (nosiciele: od strony kosmosu, nie toru zejścia)
    prongs: Object.freeze([
      Object.freeze({ angle: 0, slot: 'CAPITAL', tower: -1 }),
      Object.freeze({ angle: -60, slot: 'L', tower: 1 }),
      Object.freeze({ angle: 60, slot: 'L', tower: -1 }),
      Object.freeze({ angle: -120, slot: 'CARRIER', tower: -1 }),
      Object.freeze({ angle: 120, slot: 'CARRIER', tower: 1 })
    ]),
    prongMargin: 100,
    depots: Object.freeze([-150, 150]),
    depotR: 820
  }),
  // Inne frakcje: litera U — belka u nasady trzonu z terminalem taśmy, dwa ramiona
  // w kosmos, basen między nimi (capital przy belce, L przy ramionach), M na zewnątrz.
  u: Object.freeze({ baseWidth: 5400, baseDepth: 700, armWidth: 760, armLength: 5000, terminal: Object.freeze({ w: 760, d: 520 }) }),
  approach: 1200
});

/**
 * Etapy budowy kadłuba (ułamki czasu budowy) — wspólne dla shadera kadłuba
 * (portHullBuild3D.js), roju dronów i dźwigu: stępka, wręgi, poszycie, wyposażenie.
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
 * Czoło budowy wzdłuż kadłuba (0 = rufa, 1 = dziób) dla postępu — gdzie pracuje
 * rój. Stępka i wręgi idą od rufy do dziobu, poszycie za nimi, wyposażenie
 * jeszcze raz od rufy.
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
 * albo null (pusta).
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

const CAPTURE = Object.freeze({
  big: Object.freeze({ halfWidth: 145, halfLength: 180, maxSpeed: 30, maxAngle: 7 * DEG }),
  small: Object.freeze({ halfWidth: 70, halfLength: 55, maxSpeed: 30, maxAngle: 7 * DEG })
});
// Kurs z kierunku (dx, dz) w układzie: kąt od +x ku +z (jak stanowiska K-7).
const headingOf = (dx, dz) => Math.atan2(dz, dx);

/** Obrys pola stanowiska (obrócony prostokąt padLength × padBeam wzdłuż kursu). */
export function shipyardPadPoly(b) {
  return k7BoxPoly(b.x, b.z, b.padLength, b.padBeam, b.angle);
}

// Obwiednia osiowa punktów (akumulator).
function bbox() {
  return { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
}
function take(bb, x, z) {
  if (x < bb.x0) bb.x0 = x;
  if (x > bb.x1) bb.x1 = x;
  if (z < bb.z0) bb.z0 = z;
  if (z > bb.z1) bb.z1 = z;
}
function takePoly(bb, poly) {
  for (const p of poly) take(bb, p.x, p.z);
}

// Stanowisko postoju / refitu: dir = zwrot „na zewnątrz” (skąd przylatuje
// statek), dziób do środka piasty / ku ramieniu. `towerSide` — strona wieży
// serwisowej (±1 względem prostopadłej (−dirZ, dirX)).
function makePad(id, spec, x, z, dirX, dirZ, towerSide, extra) {
  const big = spec.size === 'CAPITAL';
  const heading = headingOf(-dirX, -dirZ);
  const c = Math.abs(Math.cos(heading));
  const s = Math.abs(Math.sin(heading));
  const reach = spec.padLength / 2 + SHIPYARD_SPEC.approach;
  return {
    id, size: spec.size, kind: 'pad', x, z,
    angle: heading,
    // obwiednia osiowa pola (dla kodu, który zna tylko pola K-7 wzdłuż osi)
    width: c * spec.padLength + s * spec.padBeam,
    length: s * spec.padLength + c * spec.padBeam,
    padLength: spec.padLength, padBeam: spec.padBeam,
    maxLength: spec.maxLength, maxBeam: spec.maxBeam,
    dirX, dirZ, towerSide,
    occupied: null, reserved: null, lane: null,
    refit: true,
    approach: { heading, from: { x: x + dirX * reach, z: z + dirZ * reach }, to: { x, z }, width: spec.padBeam - 60 },
    capture: { ...(big ? CAPTURE.big : CAPTURE.small) },
    stopPoint: { x, z },
    serviceAnchors: [],
    ...extra
  };
}

/**
 * Układ stoczni. Opcje:
 *   id        'Y-1' — przedrostek stanowisk
 *   slips     liczba pochylni (0–4; domyślnie 2 = SHIPYARD_MODEL.slots; naprzemiennie po stronach trzonu)
 *   hub       'radial' (Ziemia: okrąg z wypustkami) albo 'u' (inne frakcje) — styl.shipyardHub
 *   backZ     z korzenia (podłoga habitatu = K7_PLACEMENT.backZ na ringu, 0 na megadoku)
 *   rootDepth długość korzenia trzonu przed pochylniami (ring: wąwóz habitatu)
 * Stanowiska (`berths`) w formacie K-7: pochylnie `size 'SLIP'`, `kind 'slip'`
 * (produkcja — nie cumuje się na nich), place piasty `kind 'pad'` (postój po
 * produkcji i refit; CAPITAL / L / M; `ring` inner | prong | basin | arm).
 */
export function createShipyardLayout(options = {}) {
  const S = SHIPYARD_SPEC;
  const P = S.berth;
  const id = String(options.id || 'Y-1');
  const hubKind = options.hub === 'u' ? 'u' : 'radial';
  const slipCount = clamp(Math.floor(options.slips ?? 2), 0, 4);
  const B = Number.isFinite(options.backZ) ? options.backZ : K7_PLACEMENT.backZ;
  const rootDepth = Number.isFinite(options.rootDepth) ? Math.max(S.gallery.depth + S.spine.collarDepth + 200, options.rootDepth) : S.spine.rootDepth;
  const half = S.spine.width / 2;
  const l = {
    id, kind: 'shipyard', hubKind, backZ: B,
    gallery: null, spine: null, slips: [], berths: [], lanes: [], belt: null, hub: null, depots: []
  };
  const bb = bbox();

  // ---- pochylnie: naprzemiennie po stronach trzonu, druga para dalej od ringu
  const bz0 = B + rootDepth + 200;
  const perSide = Math.ceil(slipCount / 2);
  const R = S.rack;
  for (let i = 0; i < slipCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const row = Math.floor(i / 2);
    const x = side * (half + P.gap + P.width / 2);
    const z0 = bz0 + row * P.pitch;
    const z1 = z0 + P.length;
    const z = (z0 + z1) / 2;
    const tag = `${id}-S${i + 1}`;
    const railX = P.width / 2 - P.rail / 2;
    const innerRail = x - side * railX;
    const outerRail = x + side * railX;
    const ST = S.station;
    const station = { x: side * (half - ST.edge), z: z0 + ST.z };
    station.spots = ST.spots.map((dz) => ({ x: station.x, z: station.z + dz }));
    station.heavy = { x: station.x, z: station.z + ST.heavy };
    const rackX = x - side * (P.width / 2 - R.inset);
    const rack = { x: rackX, z0: z0 + 140, slots: [] };
    for (let r = 0; r < R.rows; r++) {
      for (let c = 0; c < R.cols; c++) rack.slots.push({ x: rackX + (c - (R.cols - 1) / 2) * R.pitchX, z: rack.z0 + r * R.pitchZ });
    }
    rack.z1 = rack.z0 + (R.rows - 1) * R.pitchZ;
    const slip = {
      id: tag, index: i, side, x, z0, z1, z, width: P.width, length: P.length,
      padLength: P.padLength, padBeam: P.padBeam,
      rails: [Math.min(innerRail, outerRail), Math.max(innerRail, outerRail)],
      apronZ1: z1 + P.apron,
      crane: {
        span: 2 * railX, innerRail, outerRail, tipX: station.x,
        leg: S.crane.leg, girder: S.crane.girder, girderH: S.crane.girderH, girderGap: S.crane.girderGap, legTop: S.crane.legTop,
        homeZ: z0 + 90, z0: z0 + 90, z1: z1 - 90
      },
      station,
      rack
    };
    l.slips.push(slip);
    l.berths.push({
      id: tag, size: 'SLIP', kind: 'slip', slipIndex: i, x, z,
      width: P.padBeam, length: P.padLength, padLength: P.padLength, padBeam: P.padBeam,
      angle: Math.PI / 2, maxLength: P.maxLength, maxBeam: P.maxBeam,
      occupied: null, reserved: null, lane: 'LANE-' + tag,
      // zejście: dziobem ku piaście, prosto wzdłuż osi pochylni
      launch: { heading: Math.PI / 2, from: { x, z }, to: { x, z: z1 + P.lane } },
      approach: { heading: -Math.PI / 2, from: { x, z: z1 + P.lane }, to: { x, z }, width: P.padBeam - 60 },
      capture: { ...CAPTURE.big },
      stopPoint: { x, z },
      serviceAnchors: []
    });
    l.lanes.push({ id: 'LANE-' + tag, berthId: tag, x, width: P.padBeam, z0, z1: z1 + P.lane, reserved: null });
    take(bb, x - P.width / 2, z0);
    take(bb, x + P.width / 2, slip.apronZ1);
  }
  const berthsEnd = slipCount ? bz0 + (perSide - 1) * P.pitch + P.length : bz0;
  const hubStart = berthsEnd + S.hubGap;

  // ---- piasta
  const pads = [];
  let coreZ;
  let spineEnd;
  if (hubKind === 'radial') {
    const Rd = S.radial;
    const hz = hubStart + Rd.disc;
    const hub = { kind: 'radial', x: 0, z: hz, disc: Rd.disc, core: Rd.core, prongs: [] };
    const inner = SHIPYARD_PADS[Rd.inner.slot];
    const rIn = Rd.core + Rd.inner.gap + inner.padLength / 2;
    Rd.inner.angles.forEach((deg, k) => {
      const a = deg * DEG;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      pads.push(makePad(`${id}-P${k + 1}`, inner, dx * rIn, hz + dz * rIn, dx, dz, deg < 0 ? 1 : -1, { ring: 'inner' }));
    });
    Rd.prongs.forEach((pr, k) => {
      const spec = SHIPYARD_PADS[pr.slot];
      const a = pr.angle * DEG;
      const dx = Math.sin(a);
      const dz = Math.cos(a);
      const r0 = Rd.disc - 150;
      const r1 = Rd.disc + Rd.prongMargin + spec.padLength + 120;
      const rc = Rd.disc + Rd.prongMargin + spec.padLength / 2;
      const width = spec.padBeam + 2 * Rd.prongMargin;
      const prong = { index: k, angle: a, dirX: dx, dirZ: dz, r0, r1, width, slot: pr.slot };
      hub.prongs.push(prong);
      takePoly(bb, k7BoxPoly(dx * (r0 + r1) / 2, hz + dz * (r0 + r1) / 2, r1 - r0, width, headingOf(dx, dz)));
      pads.push(makePad(`${id}-W${k + 1}`, spec, dx * rc, hz + dz * rc, dx, dz, pr.tower, { ring: 'prong', prong: k }));
    });
    for (const deg of Rd.depots) {
      const a = deg * DEG;
      l.depots.push({ x: Math.sin(a) * Rd.depotR, z: hz + Math.cos(a) * Rd.depotR, angle: a, w: 300, d: 480 });
    }
    take(bb, -Rd.disc, hz - Rd.disc);
    take(bb, Rd.disc, hz + Rd.disc);
    l.hub = hub;
    coreZ = hz - Rd.core - 70;
    spineEnd = hz - Rd.disc + 200;
  } else {
    const U = S.u;
    const bz = hubStart;
    const ax = U.baseWidth / 2 - U.armWidth / 2;
    const hub = {
      kind: 'u', x: 0, z: bz + U.baseDepth / 2,
      base: { x0: -U.baseWidth / 2, x1: U.baseWidth / 2, z0: bz, z1: bz + U.baseDepth },
      arms: [-1, 1].map((s) => ({ side: s, x: s * ax, width: U.armWidth, z0: bz, z1: bz + U.armLength })),
      basin: { x0: -(ax - U.armWidth / 2), x1: ax - U.armWidth / 2, z0: bz + U.baseDepth, z1: bz + U.armLength },
      terminal: { x: 0, z: bz + U.baseDepth / 2, w: U.terminal.w, d: U.terminal.d }
    };
    const basinZ = hub.basin.z0;
    // basen: dwa capital przy belce (dziobem do belki), dalej L przy ramionach (dziobem do ramienia)
    const cap = SHIPYARD_PADS.CAPITAL;
    [-1, 1].forEach((s, k) => {
      const x = s * (cap.padBeam / 2 + 120);
      pads.push(makePad(`${id}-B${k + 1}`, cap, x, basinZ + 80 + cap.padLength / 2, 0, 1, -s, { ring: 'basin' }));
    });
    const Lp = SHIPYARD_PADS.L;
    const lz0 = basinZ + 80 + cap.padLength + 240;
    let n = 0;
    for (const s of [-1, 1]) {
      const innerEdge = s * (ax - U.armWidth / 2);
      for (let k = 0; k < 2; k++) {
        const z = lz0 + Lp.padBeam / 2 + k * (Lp.padBeam + 200);
        const x = innerEdge - s * (Lp.padLength / 2 + 60);
        pads.push(makePad(`${id}-L${++n}`, Lp, x, z, -s, 0, 1, { ring: 'basin', arm: s }));
      }
    }
    // na zewnątrz ramion: M dziobem do ramienia
    const Mp = SHIPYARD_PADS.M;
    let m = 0;
    for (const s of [-1, 1]) {
      const outerEdge = s * (ax + U.armWidth / 2);
      for (let k = 0; k < 4; k++) {
        const z = bz + 1100 + k * (Mp.pitch + 180);
        const x = outerEdge + s * (Mp.padLength / 2 + 60);
        pads.push(makePad(`${id}-M${++m}`, Mp, x, z, s, 0, -1, { ring: 'arm', arm: s }));
      }
    }
    // składy refitu po bokach terminalu (na belce)
    for (const s of [-1, 1]) l.depots.push({ x: s * (hub.terminal.w / 2 + 240), z: hub.terminal.z, angle: 0, w: 300, d: 480 });
    take(bb, hub.base.x0, hub.base.z0);
    take(bb, hub.base.x1, hub.base.z1);
    for (const a of hub.arms) { take(bb, a.x - a.width / 2, a.z0); take(bb, a.x + a.width / 2, a.z1); }
    l.hub = hub;
    coreZ = hub.terminal.z - hub.terminal.d / 2 - 70;
    spineEnd = hub.base.z0 + 200;
  }
  for (const p of pads) {
    l.berths.push(p);
    takePoly(bb, shipyardPadPoly(p));
  }

  // ---- galeria wzdłuż ringu, trzon, taśma
  const slipX = l.slips.length ? Math.max(...l.slips.map((s) => Math.abs(s.x) + s.width / 2)) : half;
  const stubHalf = Math.max(slipX, 1600) + S.gallery.reach;
  l.gallery = { x0: -stubHalf - 160, x1: stubHalf + 160, z0: B, z1: B + S.gallery.depth };
  l.spine = {
    x0: -half, x1: half, z0: B, z1: spineEnd, rootZ1: B + rootDepth,
    collar: { width: S.spine.collar, depth: S.spine.collarDepth, z: l.gallery.z1 + 40 + S.spine.collarDepth / 2, x: half + S.spine.collar / 2 + 40 }
  };
  const stubZ = B + S.gallery.depth / 2;
  const feed = (s) => [[s * stubHalf, stubZ], [0, stubZ], [0, coreZ]];
  l.belt = {
    width: S.spine.belt,
    housing: S.spine.housing,
    stubZ,
    stub: { x0: -stubHalf, x1: stubHalf, z: stubZ },
    junction: { x: 0, z: stubZ },
    // dwa podajniki z galerii (w grze przedłuża je ring) schodzą się w trzonie
    feeds: [feed(-1), feed(1)],
    path: feed(-1),
    end: { x: 0, z: coreZ },
    stations: l.slips.map((s) => ({ slip: s.index, x: 0, z: s.station.z, side: s.side }))
  };
  l.belt.length = pathLength(l.belt.path);
  take(bb, l.gallery.x0, l.gallery.z0);
  take(bb, l.gallery.x1, l.gallery.z1);
  take(bb, l.spine.collar.x + S.spine.collar / 2, l.spine.collar.z);
  take(bb, -l.spine.collar.x - S.spine.collar / 2, l.spine.collar.z);

  // ---- obrys
  l.x0 = bb.x0;
  l.x1 = bb.x1;
  l.frontZ = bb.z1;
  l.depth = l.frontZ - B;
  l.width = bb.x1 - bb.x0;
  l.halfWidth = Math.max(-bb.x0, bb.x1);
  l.footprint = [[bb.x0, B], [bb.x1, B], [bb.x1, l.frontZ], [bb.x0, l.frontZ]];
  l.capacity = {
    SLIP: l.slips.length,
    pads: pads.length,
    CAPITAL: pads.filter((p) => p.size === 'CAPITAL').length,
    L: pads.filter((p) => p.size === 'L').length,
    M: pads.filter((p) => p.size === 'M').length,
    total: l.berths.length
  };
  return l;
}

function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return s;
}

/** Punkt trasy taśmy (lista [x, z]) w odległości `s` od początku: x, z, kurs. */
export function shipyardPathPoint(path, s, out = {}) {
  let d = Math.max(0, s);
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1][0];
    const az = path[i - 1][1];
    const dx = path[i][0] - ax;
    const dz = path[i][1] - az;
    const len = Math.hypot(dx, dz);
    if (d <= len || i === path.length - 1) {
      const t = len > 0 ? Math.min(1, d / len) : 0;
      out.x = ax + dx * t;
      out.z = az + dz * t;
      out.angle = Math.atan2(dz, dx);
      return out;
    }
    d -= len;
  }
  out.x = path[0][0];
  out.z = path[0][1];
  out.angle = 0;
  return out;
}

/** Punkt głównej trasy taśmy (podajnik z galerii −x do terminalu). */
export function shipyardBeltPoint(l, s, out = {}) {
  return shipyardPathPoint(l.belt.path, Math.min(l.belt.length, s), out);
}

/** Stanowisko pochylni i (albo null). */
export function shipyardSlipBerth(l, i) {
  return l.berths.find((b) => b.kind === 'slip' && b.slipIndex === i) || null;
}
/** Place postoju / refitu piasty. */
export function shipyardPads(l) {
  return l.berths.filter((b) => b.kind === 'pad');
}

/** Czy kadłub {length, beam} mieści się na stanowisku (standard K-7: najdłuższy × najszerszy). */
export function shipyardHullFits(berth, size) {
  return !!berth && !!size && size.length <= berth.maxLength && size.beam <= berth.maxBeam;
}

// Wymiary Atlasa (K-7) — plac capital piasty (refit) ma go mieścić.
export const SHIPYARD_ATLAS = Object.freeze({ length: K7_ATLAS.w, beam: K7_ATLAS.h });

/** Wieża serwisowa placu (przy wewnętrznym końcu pola, z boku — poza kadłubem). */
export function shipyardPadTower(b) {
  const px = -b.dirZ * b.towerSide;
  const pz = b.dirX * b.towerSide;
  const inset = b.padLength / 2 - 90;
  const off = b.padBeam / 2 + (b.size === 'CAPITAL' ? 50 : 70);
  return { x: b.x - b.dirX * inset + px * off, z: b.z - b.dirZ * inset + pz * off };
}

/**
 * Bryły stoczni w płaszczyźnie lotu (wysokości K-7: y środka, h) — wspólne dla
 * renderu i kolizji (jak baySolidList). Pokłady leżą pod kadłubami (y ≤ 0),
 * przeszkodami są kołnierz korzenia, wieże pochylni, rdzeń / terminal piasty,
 * wieże serwisowe placów i końce ramion U. Dźwigi jeżdżą (poza listą).
 */
export function shipyardSolidList(l) {
  const out = [];
  const add = (id, x, y, z, w, h, d, angle = 0) => out.push({ id, x, y, z, w, h, d, angle });
  const c = l.spine.collar;
  for (const s of [-1, 1]) add(`COLLAR ${l.id}${s < 0 ? ' W' : ' E'}`, s * c.x, 300, c.z, c.width, 600, c.depth);
  for (const s of l.slips) {
    for (const cx of [-1, 1]) for (const cz of [-1, 1]) {
      add(`BERTH TOWER ${s.id}/${cx}/${cz}`, s.x + cx * (s.width / 2 - 45), 160, s.z + cz * (s.length / 2 - 45), 90, 320, 90);
    }
  }
  const h = l.hub;
  if (h.kind === 'radial') {
    add(`HUB CORE ${l.id}`, 0, 260, h.z, 2 * h.core * 0.72, 520, 2 * h.core * 0.72);
  } else {
    const t = h.terminal;
    add(`U TERMINAL ${l.id}`, t.x, 240, t.z, t.w, 480, t.d);
    for (const a of h.arms) add(`U ARM TIP ${l.id}/${a.side}`, a.x, 180, a.z1 - 150, a.width - 80, 360, 240);
    for (const s of [-1, 1]) add(`U BASE BLOCK ${l.id}/${s}`, s * (h.base.x1 - 350), 180, (h.base.z0 + h.base.z1) / 2, 500, 360, h.base.z1 - h.base.z0 - 120);
  }
  for (const b of l.berths) {
    if (b.kind !== 'pad') continue;
    const t = shipyardPadTower(b);
    add(`PAD TOWER ${b.id}`, t.x, 120, t.z, 70, 240, 70);
  }
  return out;
}
