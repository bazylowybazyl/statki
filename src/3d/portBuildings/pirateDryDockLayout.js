// Suchy dok piratów (misja 1 „Cicha stocznia”) — układ wg szkicu użytkownika (2026-10-05) i poprawki tego
// samego dnia („usuń suwnice — ma być PARKING, statki stoją obok siebie, Atlasem będę je rozwalał; zamknij je
// w prostokącie, zrób cienkie bramy, będę je taranował; dorób światła”):
//
//                 trzon (suchy dok)        parking (zamknięty prostokąt)
//                       ┃┃ ┌──────────────────────────────────────────┐
//          ╭──────╮     ┃┃ ‖ bramy ┊▮┊▮┊▮▮┊▮┊▮▮┊▮▮▮┊▮▮┊▮┊▮▮┊▮▮▮┊ bramy ‖   okręty burta w burtę, dziobem ku
//  ◄─ G-01 │ hala ├─────┨┃ ‖ G-W ══╪═══ tor taranu (środkiem) ═══╪═ G-E ‖   trzonowi, środkiem na osi toru:
//          ╰──────╯     ┃┃ └──── (bramy stanowisk w ogrodzeniu) ──────┘   G-W → okręty → G-E (cienkie bramy)
//
// Hala jak K-7 — tył wpięty w trzon, brama G-01 od kosmosu (decyzja użytkownika). Czysta matematyka (bez Three
// i DOM): układ, stanowiska w formacie K-7, bramy parkingu, pola hali, trasy wylotu, maszty reflektorów,
// KAWAŁKI (grupy pod silnik zniszczeń — docs/PLAN-zniszczenia-swiata-3d.md § 4.3) i bryły trafień.
//
// Układ lokalny jak hub K-7 / budowle Z7 (portBuildingScene.js): x wzdłuż trzonu, z w poprzek (+z — parking,
// −z — hala), y = wysokość nad pokładem w konwencji K-7 (płaszczyzna gry y = 116 = z świata 0, nad nią ×0,42 —
// k7HeightToZ). Kurs w układzie: od +x ku +z; okręt na parkingu stoi dziobem do trzonu (kurs −π/2), statki
// w hali — dziobem do bramy (też −π/2).
//
// W płaszczyźnie gry (przeszkoda dla przyszłych kolizji i dla pocisków): trzon, ogrodzenie parkingu z bramami
// (cienkie — do taranowania) i ściany hali. Pokład parkingu i kołyski leżą POD płaszczyzną (okręty stoją nad
// nimi), dach hali — NAD nią.
import { K7_BANK_SLOTS } from '../haloRing/haloPortK7Layout.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Klasa okrętu z klucza wezwania (SUPPORT_SHIP_TEMPLATES: frigate_pd, destroyer, battleship…).
export function dryDockBayClass(key) {
  const k = String(key || '');
  if (k.includes('battleship')) return 'battleship';
  if (k.includes('destroyer')) return 'destroyer';
  return 'frigate';
}

// Skład parkingu domyślny = rząd misji 1 (shipyardLayout.SHIPYARD_TUNE.parked).
export const DRYDOCK_DEFAULT_BAYS = Object.freeze(['frigate', 'frigate', 'destroyer', 'frigate', 'destroyer', 'battleship', 'destroyer', 'frigate', 'destroyer', 'battleship']);

export const DRYDOCK_SPEC = Object.freeze({
  endBlock: 650,            // bloki końcowe trzonu za parkingiem
  spineHalfDepth: 450,      // trzon: z ∈ [−450, 450]
  keelHalfDepth: 220,       // nadbudowa trzonu (kręgosłup) — środek trzonu
  // Parking: okręty burta w burtę (sprite'y piratów: fregata 192 × 80, niszczyciel 360 × 167, pancernik
  // 720 × 380 — z kolcami), dziobem przy kołnierzu trzonu; strefy wjazdu / wyjazdu przy bramach taranowych.
  // Głębokość 1100: światło bramy końcowej (między pylonami) = 880 > szerokość Atlasa (806) — Atlas wpada
  // torem taranu (laneZ = środek bramy) i rozbija samą bramę. Okręty stoją ŚRODKIEM na osi toru (burta
  // w burtę, dziobem ku trzonowi), więc Atlas miażdży każdy kadłub na całej długości; z nabrzeża trzonu
  // do dziobów prowadzą rękawy (pod płaszczyzną gry).
  parking: Object.freeze({
    entry: 900, exit: 900, depth: 1100, bayGap: 30,
    fence: 40, fenceTop: 260, post: 70, postTop: 340, pylon: 140, endGate: 40, bayGate: 26
  }),
  // length — długość okrętu klasy w grze (sprite × skala; shipyardLayout.parkedLengthOf), width — stanowisko
  // (szerokość sprite'ów piratów z kolcami: fregata 80, niszczyciel 167, pancernik 380)
  bay: Object.freeze({
    frigate: Object.freeze({ width: 150, length: 192, maxLength: 320, maxBeam: 150 }),
    destroyer: Object.freeze({ width: 230, length: 360, maxLength: 420, maxBeam: 230 }),
    battleship: Object.freeze({ width: 420, length: 720, maxLength: 800, maxBeam: 420 })
  }),
  // Hala (K-7 piratów): tył wpięty w trzon, boki, skosy z bramami logistycznymi, przód z bramą G-01.
  hall: Object.freeze({
    halfWidth: 2100, frontHalfWidth: 1300, bodyDepth: 2850, frontDepth: 800,
    wallHeight: 620, wallThickness: 88, height: 720, apronDepth: 900, sideApron: 600
  }),
  heights: Object.freeze({ hullBottom: -420, deck: 0, keelTop: 380, quayTop: 160, hallWallTop: 620, mastTop: 560 })
});

// Kurs okrętu na parkingu i w hali: dziobem ku −z (trzon / brama).
export const DRYDOCK_BOW_HEADING = -Math.PI / 2;

/** Okręt (dł. × szer. sprite'a w grze) mieści się w stanowisku / polu. */
export function dryDockHullFits(berth, hull) {
  const L = Number(hull?.length) || 0;
  const B = Number(hull?.beam ?? hull?.width) || 0;
  return L <= berth.maxLength + 1e-6 && B <= berth.maxBeam + 1e-6;
}

function edgeList(footprint, center) {
  return footprint.map((a, i) => {
    const b = footprint[(i + 1) % footprint.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const length = Math.hypot(dx, dz);
    const ux = dx / length;
    const uz = dz / length;
    let nx = -uz;
    let nz = ux;
    const x = (a[0] + b[0]) / 2;
    const z = (a[1] + b[1]) / 2;
    // normalna NA ZEWNĄTRZ hali (jak edges K-7 — wzory detali ścian K-7 bez zmian)
    if ((x - center.x) * nx + (z - center.z) * nz < 0) { nx = -nx; nz = -nz; }
    return { i, a, b, x, z, ux, uz, nx, nz, length, angle: Math.atan2(dz, dx) };
  });
}

function boxPoly(x, z, w, d, angle = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => ({ x: x + a * c - b * s, z: z + a * s + b * c }));
}

/**
 * Układ suchego doku. opts: { id, bays (klucze / klasy okrętów parkingu, od strony wjazdu G-W), hallOffset }.
 * Wynik: {
 *   id, kind: 'drydock', spec, halfLength,
 *   spine: { x0, x1, z0, z1, keel, segments: [{ id, x0, x1 }] },
 *   parking: { x0, x1, z0 (lico trzonu), z1 (oś ogrodzenia), laneZ (tor taranu), bays, gates, posts },
 *   berths: [stanowisko K-7: id, size, kind 'drydock', cls, index, x, z, angle, padLength, padBeam, maxLength,
 *            maxBeam, bowZ, slot: { x0, x1 }, segment, gate]],
 *   hall: { footprint, edges, gates, pads, slips, halfWidthAt(z), backZ, bodyEndZ, frontZ, apron },
 *   lights: [{ x, y (wysokość K-7), z, kind: 'flood' | 'hall', color: [r, g, b], range }] — maszty reflektorów,
 *   chunks: [{ id, kind, group, label, box, anchors, weight }] — grupy renderu = przyszłe ciała silnika,
 *   hitSolids: [{ id, chunk, poly: [{x, z}] }] — bryły w płaszczyźnie gry (pociski, Hexlance, taran bram),
 *   defensePoints: [{ x, z, angle }], bounds: { x0, x1, z0, z1 }, center: { x, z }
 * }
 */
export function createPirateDryDockLayout(opts = {}) {
  const S = DRYDOCK_SPEC;
  const P = S.parking;
  const H = S.hall;
  const zq = S.spineHalfDepth;
  const hallX = Number(opts.hallOffset) || 0;
  const bayKeys = (Array.isArray(opts.bays) && opts.bays.length ? opts.bays : DRYDOCK_DEFAULT_BAYS).map(dryDockBayClass);
  const n = bayKeys.length;
  const baysW = bayKeys.reduce((s, c) => s + S.bay[c].width, 0) + P.bayGap * Math.max(0, n - 1);
  const parkLen = P.entry + baysW + P.exit;
  const halfLen = Math.max(parkLen / 2 + S.endBlock, H.halfWidth + 450);
  const l = { id: String(opts.id || 'PD-1'), kind: 'drydock', spec: S, halfLength: halfLen };

  // ---- trzon i jego odcinki (6 równych + bloki końcowe) — kawałki zniszczeń
  const px0 = -parkLen / 2;
  const px1 = parkLen / 2;
  l.spine = {
    x0: -halfLen, x1: halfLen, z0: -zq, z1: zq,
    keel: { x0: -halfLen + 200, x1: halfLen - 200, z0: -S.keelHalfDepth, z1: S.keelHalfDepth },
    segments: []
  };
  const segN = 6;
  const sx0 = -halfLen + S.endBlock;
  const sx1 = halfLen - S.endBlock;
  l.spine.segments.push({ id: 'S-W', x0: -halfLen, x1: sx0 });
  for (let k = 0; k < segN; k++) l.spine.segments.push({ id: `S-${k + 1}`, x0: sx0 + (k * (sx1 - sx0)) / segN, x1: sx0 + ((k + 1) * (sx1 - sx0)) / segN });
  l.spine.segments.push({ id: 'S-E', x0: sx1, x1: halfLen });
  const segAt = (x) => l.spine.segments.find((s) => x >= s.x0 - 1e-6 && x <= s.x1 + 1e-6)?.id || 'S-1';

  // ---- parking: stanowiska burta w burtę od strony wjazdu (−x), okręty środkiem na osi toru taranu
  const zf = zq + P.depth;            // oś ogrodzenia (strona kosmosu)
  const zPy = zq + P.pylon / 2 + 10;  // pylony ram końcowych przy trzonie
  const gz0 = zPy + P.pylon / 2;      // światło bram końcowych
  const gz1 = zf - P.pylon / 2;
  const laneZ = (gz0 + gz1) / 2;
  const parking = { x0: px0, x1: px1, z0: zq, z1: zf, laneZ, gateZ0: gz0, gateZ1: gz1, bays: [], gates: [], posts: [], pylons: [] };
  l.berths = [];
  let cx = px0 + P.entry;
  for (let k = 0; k < n; k++) {
    const cls = bayKeys[k];
    const B = S.bay[cls];
    const x = cx + B.width / 2;
    const padLength = Math.min(B.maxLength, zf - zq - 120);
    const b = {
      id: `D-${String(k + 1).padStart(2, '0')}`, size: cls === 'battleship' ? 'L' : 'M', kind: 'drydock', cls, index: k,
      x, z: laneZ, angle: DRYDOCK_BOW_HEADING,
      width: B.width - 10, length: padLength, padLength, padBeam: B.width - 10,
      maxLength: B.maxLength, maxBeam: B.maxBeam,
      shipLength: B.length, bowZ: laneZ - B.length / 2,
      slot: { x0: cx, x1: cx + B.width },
      segment: segAt(x),
      gate: `B-${String(k + 1).padStart(2, '0')}`,
      // wyjazd rufą przez bramę stanowiska w ogrodzeniu
      approach: { heading: Math.PI / 2, from: { x, z: zf + 900 }, to: { x, z: laneZ } },
      occupied: null
    };
    l.berths.push(b);
    parking.bays.push(b);
    cx += B.width + P.bayGap;
  }
  // słupy ogrodzenia: narożniki, granice wjazdu / wyjazdu i między stanowiskami
  const postXs = [px0, px0 + P.entry - P.bayGap / 2];
  for (let k = 0; k + 1 < n; k++) postXs.push((l.berths[k].slot.x1 + l.berths[k + 1].slot.x0) / 2);
  postXs.push(px1 - P.exit + P.bayGap / 2, px1);
  // sekcje ogrodzenia (kawałki P-1…P-3) po stanowiskach
  const third = (k) => (k < Math.ceil(n / 3) ? 'P-1' : k < Math.ceil((2 * n) / 3) ? 'P-2' : 'P-3');
  // słupy pośrednie (narożniki ogrodzenia to pylony ram końcowych — niżej)
  postXs.forEach((x, i) => {
    if (i === 0 || i === postXs.length - 1) return;
    parking.posts.push({ x, z: zf, chunk: third(clamp(i - 1, 0, n - 1)), mast: false });
  });
  // pylony ram końcowych: przy trzonie i w narożniku ogrodzenia (kawałki Q-W / Q-E)
  for (const [x, chunk] of [[px0, 'Q-W'], [px1, 'Q-E']]) {
    parking.pylons.push({ x, z: zPy, chunk, corner: 'spine' });
    parking.pylons.push({ x, z: zf, chunk, corner: 'fence' });
  }
  // bramy taranowe na końcach toru (oś z, między pylonami) i bramy stanowisk w ogrodzeniu (oś x)
  parking.gates.push({ id: 'G-W', chunk: 'G-W', kind: 'ram', axis: 'z', x: px0, z: (gz0 + gz1) / 2, w: gz1 - gz0, d: P.endGate, out: -1 });
  parking.gates.push({ id: 'G-E', chunk: 'G-E', kind: 'ram', axis: 'z', x: px1, z: (gz0 + gz1) / 2, w: gz1 - gz0, d: P.endGate, out: 1 });
  // brama stanowiska między słupami (słup wchodzi (post − bayGap) / 2 w każde sąsiednie stanowisko)
  for (const b of l.berths) {
    parking.gates.push({ id: b.gate, chunk: b.gate, kind: 'bay', axis: 'x', x: b.x, z: zf, w: b.slot.x1 - b.slot.x0 - (P.post - P.bayGap), d: P.bayGate, berth: b.id, out: 1 });
  }
  l.parking = parking;

  // ---- hala (K-7 piratów): tył na licu trzonu od strony −z
  const backZ = -zq;
  const bodyEndZ = backZ - H.bodyDepth;
  const frontZ = bodyEndZ - H.frontDepth;
  const hw = H.halfWidth;
  const fhw = H.frontHalfWidth;
  const footprint = [[hallX - fhw, frontZ], [hallX + fhw, frontZ], [hallX + hw, bodyEndZ], [hallX + hw, backZ], [hallX - hw, backZ], [hallX - hw, bodyEndZ]];
  const hallCenter = { x: hallX, z: (frontZ + backZ) / 2 };
  const edges = edgeList(footprint, hallCenter);
  const hall = {
    x: hallX, backZ, bodyEndZ, frontZ, halfWidth: hw, frontHalfWidth: fhw,
    wallHeight: H.wallHeight, wallThickness: H.wallThickness, height: H.height,
    footprint, edges, center: hallCenter,
    backEdge: 3   // edge 3 = tył (lico trzonu) — bez ściany hali
  };
  hall.halfWidthAt = (z) => (z >= bodyEndZ ? hw : hw + (fhw - hw) * clamp((bodyEndZ - z) / (bodyEndZ - frontZ), 0, 1));
  hall.gates = [0, 1, 5].map((edge, i) => {
    const e = edges[edge];
    const jamb = i === 0 ? 110 : 135;
    return { ...e, id: ['G-01', 'G-02', 'G-03'][i], name: ['WYLOT / CAPITAL', 'WSCHÓD / LOGISTYKA', 'ZACHÓD / LOGISTYKA'][i], jamb, clearWidth: e.length - 2 * jamb, edge, main: i === 0 };
  });
  hall.apron = { x0: hallX - fhw + 110, x1: hallX + fhw - 110, z0: frontZ - H.apronDepth, z1: frontZ };
  // Pola eskorty (M) dziobem do bramy i dwie pochylnie (pancerniki w budowie — portHullBuild3D.js).
  const M = K7_BANK_SLOTS.M;
  const L = K7_BANK_SLOTS.L;
  const pad = (id, x, z) => ({
    id, size: 'M', kind: 'hall', x: hallX + x, z, angle: DRYDOCK_BOW_HEADING,
    width: M.padBeam, length: M.padLength, padLength: M.padLength, padBeam: M.padBeam,
    maxLength: M.maxLength, maxBeam: M.maxBeam, occupied: null
  });
  hall.pads = [
    pad('H-M1', 0, backZ - 760),
    pad('H-M2', -1550, backZ - 2000),
    pad('H-M3', -760, backZ - 2000),
    pad('H-M4', 760, backZ - 2000),
    pad('H-M5', 1550, backZ - 2000)
  ];
  hall.slips = [-1, 1].map((s, i) => ({
    id: `H-P${i + 1}`, index: i, size: 'L', kind: 'slip', x: hallX + s * 1150, z: backZ - 980, angle: Math.PI / 2,
    padLength: L.padLength, padBeam: L.padBeam, maxLength: L.maxLength, maxBeam: L.maxBeam
  }));
  // trasy wylotu (punkty układu): przez G-01, skrajne pola — bramami logistycznymi na skosach
  for (const p of hall.pads) {
    const dx = p.x - hallX;
    const side = Math.sign(dx) || 1;
    if (Math.abs(dx) > 1300) {
      const g = hall.gates[side > 0 ? 1 : 2];
      const ox = g.nx;            // normalna krawędzi — na zewnątrz
      const oz = g.nz;
      p.launch = { gate: g.id, path: [
        { x: p.x, z: p.z - p.padLength * 0.6 },
        { x: g.x - ox * 320, z: g.z - oz * 320 },
        { x: g.x + ox * 700, z: g.z + oz * 700 },
        { x: g.x + ox * 2200, z: g.z + oz * 2200 }
      ] };
    } else {
      const xg = hallX + clamp(dx, -fhw + 420, fhw - 420) * 0.6;
      p.launch = { gate: 'G-01', path: [
        { x: p.x, z: p.z - p.padLength * 0.6 },
        { x: xg, z: bodyEndZ - 120 },
        { x: hallX + dx * 0.35, z: frontZ - H.apronDepth * 0.6 },
        { x: hallX + dx * 0.3, z: frontZ - H.apronDepth - 1700 }
      ] };
    }
  }
  l.hall = hall;

  // ---- maszty reflektorów na pylonach ram końcowych (narożniki parkingu) i na dwóch słupach ogrodzenia,
  // światła pochylni w hali. Każde światło: lampa budowli (pokład, trzon) + światło siatki gry (kadłuby
  // okrętów na parkingu i w hali czytają siatkę świateł — pirateDryDockGame.js). aim — punkt, w który
  // patrzy głowica reflektora (układ doku).
  const warm = [1.0, 0.74, 0.46];
  const lights = [];
  const lz = parking.laneZ;
  for (const p of parking.pylons) {
    const inX = p.x < 0 ? 1 : -1;
    lights.push({ x: p.x, y: S.heights.mastTop, z: p.z, kind: 'flood', color: warm, range: 1700, chunk: p.chunk, aim: { x: p.x + inX * 1300, z: lz } });
  }
  // słupy z masztem: najbliższe ćwiartek parkingu
  for (const q of [-0.25, 0.25]) {
    const want = q * parkLen;
    let best = null;
    for (const p of parking.posts) if (!best || Math.abs(p.x - want) < Math.abs(best.x - want)) best = p;
    if (!best || best.mast) continue;
    best.mast = true;
    lights.push({ x: best.x, y: S.heights.mastTop, z: best.z, kind: 'flood', color: warm, range: 1600, chunk: best.chunk, aim: { x: best.x, z: lz - 200 } });
  }
  for (const s of hall.slips) lights.push({ x: s.x, y: 420, z: s.z, kind: 'hall', color: warm, range: 1500, chunk: null, aim: { x: s.x, z: s.z } });
  l.lights = lights;

  // ---- kawałki (grupa renderu na kawałek; kolejność = numer grupy) — przyszłe ciała silnika belek
  const hh = S.heights;
  const chunks = [];
  const add = (id, kind, label, box, anchors, weight = 1) => {
    chunks.push({ id, kind, label, box, anchors, weight, group: chunks.length + 1 });
  };
  const segIds = l.spine.segments.map((s) => s.id);
  for (let i = 0; i < l.spine.segments.length; i++) {
    const s = l.spine.segments[i];
    add(s.id, 'spine', i === 0 || i === segIds.length - 1 ? 'blok końcowy trzonu' : 'odcinek trzonu',
      { x0: s.x0, x1: s.x1, y0: hh.hullBottom, y1: hh.keelTop + 140, z0: -zq, z1: zq }, [segIds[i - 1], segIds[i + 1]].filter(Boolean), i === 0 || i === segIds.length - 1 ? 1.2 : 2);
  }
  // parking: ramy końcowe (słupy przy trzonie i w narożniku ogrodzenia), bramy taranowe, sekcje ogrodzenia,
  // bramy stanowisk
  const yPark = { y0: -120, y1: S.heights.mastTop + 60 };
  add('Q-W', 'frame', 'rama wjazdu', { x0: px0 - 130, x1: px0 + 130, ...yPark, z0: zq - 20, z1: zf + 130 }, [segAt(px0), 'P-1', 'G-W'], 0.8);
  add('Q-E', 'frame', 'rama wyjazdu', { x0: px1 - 130, x1: px1 + 130, ...yPark, z0: zq - 20, z1: zf + 130 }, [segAt(px1), 'P-3', 'G-E'], 0.8);
  add('G-W', 'gate', 'brama taranowa — wjazd', { x0: px0 - 90, x1: px0 + 60, y0: -60, y1: P.fenceTop + 80, z0: gz0, z1: gz1 }, ['Q-W'], 0.4);
  add('G-E', 'gate', 'brama taranowa — wyjazd', { x0: px1 - 60, x1: px1 + 90, y0: -60, y1: P.fenceTop + 80, z0: gz0, z1: gz1 }, ['Q-E'], 0.4);
  const pRange = (id) => {
    const xs = parking.posts.filter((p) => p.chunk === id).map((p) => p.x);
    if (id === 'P-1') xs.push(px0 + P.pylon / 2 + 10);
    if (id === 'P-3') xs.push(px1 - P.pylon / 2 - 10);
    return { x0: Math.min(...xs) - 80, x1: Math.max(...xs) + 80 };
  };
  for (const id of ['P-1', 'P-2', 'P-3']) {
    const r = pRange(id);
    const anchors = id === 'P-1' ? ['Q-W', 'P-2'] : id === 'P-2' ? ['P-1', 'P-3'] : ['P-2', 'Q-E'];
    add(id, 'fence', 'ogrodzenie parkingu', { ...r, ...yPark, z0: zf - 90, z1: zf + 130 }, anchors, 0.6);
  }
  for (const b of l.berths) {
    add(b.gate, 'gate', `brama ${b.id}`, { x0: b.slot.x0, x1: b.slot.x1, y0: -60, y1: P.fenceTop + 60, z0: zf - 40, z1: zf + 90 }, [third(b.index)], 0.3);
  }
  const wallBox = (e, s0, s1) => {
    const ax = e.a[0] + e.ux * s0;
    const az = e.a[1] + e.uz * s0;
    const bx = e.a[0] + e.ux * s1;
    const bz = e.a[1] + e.uz * s1;
    const pad2 = 160;
    return { x0: Math.min(ax, bx) - pad2, x1: Math.max(ax, bx) + pad2, y0: -116, y1: hh.hallWallTop, z0: Math.min(az, bz) - pad2, z1: Math.max(az, bz) + pad2 };
  };
  const eW = edges[4];       // lewy bok (−x): od tyłu (a) ku przodowi (b)
  const eE = edges[2];       // prawy bok (+x): od przodu (a) ku tyłowi (b)
  add('K-W', 'collar', 'złącze hali z trzonem (zachód)', { x0: hallX - hw - 260, x1: hallX - hw + 160, y0: hh.hullBottom, y1: hh.hallWallTop + 60, z0: backZ - 420, z1: backZ + 120 },
    [segAt(hallX - hw), 'H-W1'], 1.2);
  add('K-E', 'collar', 'złącze hali z trzonem (wschód)', { x0: hallX + hw - 160, x1: hallX + hw + 260, y0: hh.hullBottom, y1: hh.hallWallTop + 60, z0: backZ - 420, z1: backZ + 120 },
    [segAt(hallX + hw), 'H-E1'], 1.2);
  add('H-W1', 'wall', 'ściana hali — zachód (tył)', wallBox(eW, 0, eW.length / 2), ['K-W', 'H-W2'], 1);
  add('H-W2', 'wall', 'ściana hali — zachód (przód)', wallBox(eW, eW.length / 2, eW.length), ['H-W1', 'H-SW'], 1);
  add('H-E1', 'wall', 'ściana hali — wschód (tył)', wallBox(eE, eE.length / 2, eE.length), ['K-E', 'H-E2'], 1);
  add('H-E2', 'wall', 'ściana hali — wschód (przód)', wallBox(eE, 0, eE.length / 2), ['H-E1', 'H-SE'], 1);
  add('H-SW', 'wall', 'skos z bramą G-03', wallBox(edges[5], 0, edges[5].length), ['H-W2', 'H-G1'], 0.8);
  add('H-SE', 'wall', 'skos z bramą G-02', wallBox(edges[1], 0, edges[1].length), ['H-E2', 'H-G1'], 0.8);
  add('H-G1', 'hallgate', 'brama G-01', wallBox(edges[0], 0, edges[0].length), ['H-SW', 'H-SE'], 0.8);
  const roofZ = [backZ, backZ - H.bodyDepth / 3, backZ - (2 * H.bodyDepth) / 3, frontZ];
  for (let r = 0; r < 3; r++) {
    const z1 = roofZ[r];
    const z0 = roofZ[r + 1];
    const anchors = r === 0 ? ['K-W', 'K-E', 'H-W1', 'H-E1', 'R-2'] : r === 1 ? ['R-1', 'R-3', 'H-W1', 'H-W2', 'H-E1', 'H-E2'] : ['R-2', 'H-W2', 'H-E2', 'H-SW', 'H-SE', 'H-G1'];
    add(`R-${r + 1}`, 'roof', `dach hali ${r + 1}/3`, { x0: hallX - hw, x1: hallX + hw, y0: H.height - 20, y1: H.height + 260, z0, z1 }, anchors, 0.6);
  }
  add('T-W', 'tower', 'wieża zachodnia', { x0: -halfLen, x1: -halfLen + 520, y0: 0, y1: 1500, z0: -300, z1: 300 }, ['S-W'], 0.5);
  add('T-E', 'tower', 'wieża wschodnia', { x0: halfLen - 520, x1: halfLen, y0: 0, y1: 1500, z0: -300, z1: 300 }, ['S-E'], 0.5);
  l.chunks = chunks;
  l.chunkById = new Map(chunks.map((c) => [c.id, c]));

  // ---- bryły w płaszczyźnie gry (pociski, Hexlance, taran bram): odcinki trzonu, słupy i sekcje ogrodzenia,
  // bramy (cienkie), ramy końcowe, przęsła ścian hali, złącza
  const hits = [];
  for (const s of l.spine.segments) hits.push({ id: `hit-${s.id}`, chunk: s.id, poly: boxPoly((s.x0 + s.x1) / 2, 0, s.x1 - s.x0, 2 * zq) });
  for (const g of parking.gates) {
    const w = g.w;
    const d = Math.max(60, g.d * 2);
    hits.push({ id: `hit-${g.id}`, chunk: g.chunk, gate: g.id, poly: g.axis === 'z' ? boxPoly(g.x, g.z, d, w) : boxPoly(g.x, g.z, w, d) });
  }
  for (const p of parking.posts) hits.push({ id: `hit-post-${Math.round(p.x)}`, chunk: p.chunk, poly: boxPoly(p.x, p.z, P.post + 20, P.post + 20) });
  // ogrodzenie ciągłe w strefach wjazdu i wyjazdu (bez bram stanowisk), od pylonu do pierwszego słupa
  const fw0 = px0 + P.pylon / 2;
  const fw1 = parking.posts[0].x - P.post / 2;
  const fe0 = parking.posts[parking.posts.length - 1].x + P.post / 2;
  const fe1 = px1 - P.pylon / 2;
  hits.push({ id: 'hit-fence-W', chunk: 'P-1', poly: boxPoly((fw0 + fw1) / 2, zf, fw1 - fw0, Math.max(60, P.fence * 1.5)) });
  hits.push({ id: 'hit-fence-E', chunk: 'P-3', poly: boxPoly((fe0 + fe1) / 2, zf, fe1 - fe0, Math.max(60, P.fence * 1.5)) });
  for (const p of parking.pylons) hits.push({ id: `hit-${p.chunk}-${p.corner}`, chunk: p.chunk, poly: boxPoly(p.x, p.z, P.pylon + 20, P.pylon + 20) });
  const wallT = Math.max(160, H.wallThickness + 60);
  const wallHit = (id, chunk, e, s0, s1) => {
    const len = s1 - s0;
    const x = e.a[0] + e.ux * (s0 + s1) / 2;
    const z = e.a[1] + e.uz * (s0 + s1) / 2;
    hits.push({ id, chunk, poly: boxPoly(x, z, len, wallT, e.angle) });
  };
  wallHit('hit-H-W1', 'H-W1', eW, 0, eW.length / 2);
  wallHit('hit-H-W2', 'H-W2', eW, eW.length / 2, eW.length);
  wallHit('hit-H-E1', 'H-E1', eE, eE.length / 2, eE.length);
  wallHit('hit-H-E2', 'H-E2', eE, 0, eE.length / 2);
  for (const g of hall.gates) {
    const e = edges[g.edge];
    const chunk = g.edge === 0 ? 'H-G1' : g.edge === 1 ? 'H-SE' : 'H-SW';
    wallHit(`hit-${g.id}-a`, chunk, e, 0, g.jamb + 40);
    wallHit(`hit-${g.id}-b`, chunk, e, e.length - g.jamb - 40, e.length);
  }
  for (const id of ['K-W', 'K-E']) {
    const c = l.chunkById.get(id).box;
    hits.push({ id: `hit-${id}`, chunk: id, poly: boxPoly((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, c.x1 - c.x0, c.z1 - c.z0) });
  }
  l.hitSolids = hits;
  // obszar hali (bryła przelotu Hexlance'a — pręt przebija dach i ściany)
  l.hallArea = { id: 'hit-hall', chunk: 'R-2', poly: footprint.map(([x, z]) => ({ x, z })) };

  // ---- obrona: proponowane miejsca wieżyczek (za końcami trzonu i po bokach bramy hali)
  const dz = zf + 700;
  l.defensePoints = [
    { x: -halfLen - 900, z: dz, angle: Math.PI * 0.75 },
    { x: halfLen + 900, z: dz, angle: Math.PI * 0.25 },
    { x: -halfLen - 900, z: -1500, angle: -Math.PI * 0.75 },
    { x: halfLen + 900, z: -1500, angle: -Math.PI * 0.25 },
    { x: hallX - fhw - 1500, z: frontZ - 600, angle: -Math.PI * 0.7 },
    { x: hallX + fhw + 1500, z: frontZ - 600, angle: -Math.PI * 0.3 }
  ];

  l.bounds = { x0: -halfLen, x1: halfLen, z0: frontZ - H.apronDepth, z1: zf + 200 };
  l.center = { x: 0, z: (l.bounds.z0 + l.bounds.z1) / 2 };
  l.width = l.bounds.x1 - l.bounds.x0;
  l.depth = l.bounds.z1 - l.bounds.z0;
  l.capacity = { berths: n, hallPads: hall.pads.length };
  return l;
}

/**
 * Poza okrętu w stanowisku: środkiem na osi toru taranu (berth.z), dziobem ku trzonowi. Okręt dłuższy niż
 * pozwala parking (od nabrzeża do ogrodzenia) przesuwa się ku ogrodzeniu, tak by dziób nie wszedł w trzon.
 */
export function dryDockShipPose(berth, length) {
  const L = Math.max(0, Number(length) || berth.shipLength || berth.maxLength);
  const minZ = berth.z - berth.padLength / 2 + L / 2;
  return { x: berth.x, z: Math.max(berth.z, minZ), angle: berth.angle };
}

/** Kawałek pod punktem układu (x, z) — trafienie w bryłę: odcinek trzonu, brama, ogrodzenie, ściana, złącze. */
export function dryDockChunkAt(l, x, z) {
  for (const h of l.hitSolids) if (pointInPoly(h.poly, x, z)) return h.chunk;
  if (pointInPoly(l.hallArea.poly, x, z)) {
    const h = l.hall;
    const t = (h.backZ - z) / (h.backZ - h.frontZ);
    return t < 1 / 3 ? 'R-1' : t < 2 / 3 ? 'R-2' : 'R-3';
  }
  return null;
}

/** Najbliższy kawałek danego rodzaju (albo dowolny) środkiem pudła do punktu układu. */
export function dryDockNearestChunk(l, x, z, filter = null) {
  let best = null;
  let bd = Infinity;
  for (const c of l.chunks) {
    if (filter && !filter(c)) continue;
    const cx = (c.box.x0 + c.box.x1) / 2;
    const cz = (c.box.z0 + c.box.z1) / 2;
    const d = (cx - x) ** 2 + (cz - z) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/**
 * Łańcuch rozpadu doku (do czasu ciał silnika zniszczeń): kawałki po kolei od `startId` po kotwicach (BFS),
 * czas = głębokość × krok + rozrzut z haszu kawałka (bez Math.random). Zwraca [{ id, kind, t, size }]
 * (size — rozmiar wybuchu w j. świata; 0 = kawałek odpada bez wybuchu). Pominięte kawałki z `skip`.
 */
export function planDryDockChain(l, startId = 'R-2', { step = 0.55, jitter = 0.3, skip = null } = {}) {
  const start = l.chunkById.has(startId) ? startId : 'R-2';
  // sąsiedztwo symetryczne (kotwice są zapisane z jednej albo obu stron)
  const nb = new Map(l.chunks.map((c) => [c.id, new Set()]));
  for (const c of l.chunks) {
    for (const a of c.anchors) {
      if (!nb.has(a)) continue;
      nb.get(c.id).add(a);
      nb.get(a).add(c.id);
    }
  }
  const depth = new Map([[start, 0]]);
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const nid of nb.get(id)) {
      if (depth.has(nid)) continue;
      depth.set(nid, depth.get(id) + 1);
      queue.push(nid);
    }
  }
  // kawałki bez połączenia z początkiem — na końcu
  let maxD = 0;
  for (const d of depth.values()) maxD = Math.max(maxD, d);
  for (const c of l.chunks) if (!depth.has(c.id)) depth.set(c.id, maxD + 1);
  // wybuch tylko przy dużych kawałkach (36 wybuchów naraz zalewało kadr bielą)
  const SIZE = { spine: 250, collar: 220, hallgate: 200, tower: 150, frame: 0, roof: 0, wall: 0, fence: 0, gate: 0 };
  const out = [];
  for (const c of l.chunks) {
    if (skip && skip.has?.(c.id)) continue;
    const h = Math.sin((c.group + 1) * 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    const size = c.id === start ? 320 : (SIZE[c.kind] ?? 0);
    out.push({ id: c.id, kind: c.kind, t: depth.get(c.id) * step + r * jitter, size });
  }
  out.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  return out;
}

export function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
