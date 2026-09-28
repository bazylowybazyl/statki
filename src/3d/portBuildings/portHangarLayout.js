// Hangar postojowy (Z7): magazyn statków bez zlecenia. Decyzja użytkownika
// 2026-09-26 (plan § 1.4, § 3.3): w portach o małym ruchu i przy stacjach bez
// ringu bezczynny statek wlatuje do hangaru i ZNIKA Z RENDERU — pojemność jest
// abstrakcyjna (portParking.js: `hangar`, `hangarCapacity`). Czysta matematyka.
//
// Pomysł z dema dema/dok_bebnowy_2d.html (dok bębnowy B-5): w hali obracają się
// BĘBNY z kołyskami wokół piasty — gniazdo ustawia się ku korytarzowi, kołyska
// przyjmuje statek, bęben obraca się o jedno gniazdo. Tu bęben ma kilka
// POZIOMÓW pod pokładem (głąb korpusu stacji), więc pojemność rośnie liczbą
// poziomów, nie powierzchnią; z góry widać tylko wierzch bębna w dachu
// (tarcza z kołyskami, która obraca się przy każdym przyjęciu) i wieniec lamp
// zajętości. Kołyski w standardzie padów K-7 (K7_BANK_SLOTS), ciężkie kadłuby
// (capital, mega) na dwóch windach w osobnej zatoce.
//
// Wejście: brama IN na jednym końcu lica, brama OUT na drugim. Statek wlatuje
// pod dach (dach rysuje się w FG, nad statkami — zasłania go sam) i na punkcie
// przechwytu system ruchu zdejmuje go z renderu; wylot odwrotnie z bramy OUT.
// Przed bramą IN pas kolejki z miejscami oczekiwania — w szczycie widać kolejkę.
//
// Potrzebna pojemność przy ×60 (plan § 2, parking p95 / max): Saturn 419 / 472,
// Uran 241 / 336, Ceres 190 / 317, Jowisz 183 / 266. Skład postoju (Ziemia):
// vany ~44%, haulery ~43%, bulk ~10%, ciężkie i mega ~3%.
//
// Układ lokalny jak hub K-7: x wzdłuż lica, z na zewnątrz (tył na podłodze /
// przy korpusie stacji, bramy od strony kosmosu), y = wysokość nad pokładem.
import { K7_BANK_SLOTS, K7_PLACEMENT } from '../haloRing/haloPortK7Layout.js';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export const HANGAR_SPEC = Object.freeze({
  // Bębny: kołyska = pad K-7 danej klasy (długość promieniowo, szerokość po
  // obwodzie piasty) + odstęp; gniazd na poziom, poziomów najwyżej.
  // `slots` — dopuszczalne liczby gniazd na poziom (mały port = mały bęben).
  drums: Object.freeze({
    s: Object.freeze({ cls: 's', cradleLength: K7_BANK_SLOTS.S.padLength - 80, cradleBeam: K7_BANK_SLOTS.S.padBeam - 70, maxLength: K7_BANK_SLOTS.S.maxLength, maxBeam: K7_BANK_SLOTS.S.maxBeam, gap: 70, slots: Object.freeze([8, 12, 16, 20, 24]), levelsMin: 1, levelsMax: 8 }),
    m: Object.freeze({ cls: 'm', cradleLength: K7_BANK_SLOTS.M.padLength - 100, cradleBeam: K7_BANK_SLOTS.M.padBeam - 120, maxLength: K7_BANK_SLOTS.M.maxLength, maxBeam: K7_BANK_SLOTS.M.maxBeam, gap: 90, slots: Object.freeze([8, 10, 12, 14, 16, 18]), levelsMin: 1, levelsMax: 8 }),
    l: Object.freeze({ cls: 'l', cradleLength: K7_BANK_SLOTS.L.padLength - 130, cradleBeam: K7_BANK_SLOTS.L.padBeam - 160, maxLength: K7_BANK_SLOTS.L.maxLength, maxBeam: K7_BANK_SLOTS.L.maxBeam, gap: 120, slots: Object.freeze([6, 8, 10, 12]), levelsMin: 1, levelsMax: 6 })
  }),
  // Zatoka ciężka: dwie windy pod megafrachtowiec (pas MEGA zatoki: 2900 × 1150).
  heavy: Object.freeze({ padLength: 3000, padBeam: 1200, maxLength: 2900, maxBeam: 1100, pads: 2, gap: 150, levelsMax: 8 }),
  // Skład postoju (udział w pojemności) — pomiar Ziemi: vany, haulery, bulk, ciężkie.
  mix: Object.freeze({ s: 0.44, m: 0.43, l: 0.10, heavy: 0.03 }),
  drumGap: 260,
  rim: 40,                // obręcz bębna za kołyskami
  wall: 100,
  wallTop: 560,
  roofBase: 640,
  backMargin: 150,        // od ściany tylnej do bębna
  corridor: 1000,         // korytarz transferowy pod dachem (przed bębnami)
  gate: Object.freeze({ width: 1300, jamb: 110 }),
  apron: 700,             // płyta przed bramami
  queue: Object.freeze({ slots: 12, pitch: 650, lead: 300 })
});

/**
 * Bęben danej klasy z liczbą poziomów: promień piasty z obwodu (gniazda ×
 * (kołyska + odstęp) / 2π, jak dok B-5), promień zewnętrzny = piasta + kołyska + obręcz.
 */
export function hangarDrumGeometry(cls, levels, slots = null) {
  const d = HANGAR_SPEC.drums[cls];
  if (!d) return null;
  const n = Math.max(3, Math.floor(slots ?? d.slots[d.slots.length - 1]));
  const hubR = n * (d.cradleBeam + d.gap) / TAU;
  const outerR = hubR + d.cradleLength + HANGAR_SPEC.rim;
  return {
    cls, slots: n, levels, capacity: n * levels,
    hubR, outerR, cradleLength: d.cradleLength, cradleBeam: d.cradleBeam,
    maxLength: d.maxLength, maxBeam: d.maxBeam
  };
}

/**
 * Skład bębnów dla pojemności `capacity` (statków) i udziałów `mix`:
 * najmniej bębnów danej klasy, przy tej liczbie najmniejszy bęben (najmniej
 * gniazd na poziom), poziomów tyle, żeby starczyło (≤ levelsMax) — mały port
 * dostaje małe bębny, duży więcej i większych.
 * Zwraca { drums: [geometria…], heavy: { pads, levels, capacity }, capacity: { s, m, l, heavy, total } }.
 */
export function planHangarCapacity(capacity = 300, mix = HANGAR_SPEC.mix) {
  const C = Math.max(1, Math.floor(Number(capacity) || 0));
  const drums = [];
  const cap = { s: 0, m: 0, l: 0, heavy: 0, total: 0 };
  for (const cls of ['s', 'm', 'l']) {
    const share = Math.max(0, Number(mix?.[cls]) || 0);
    if (!share) continue;
    const d = HANGAR_SPEC.drums[cls];
    const need = Math.ceil(C * share);
    const maxSlots = d.slots[d.slots.length - 1];
    const count = Math.max(1, Math.ceil(need / (maxSlots * d.levelsMax)));
    const slots = d.slots.find((n) => count * n * d.levelsMax >= need) || maxSlots;
    const levels = clamp(Math.ceil(need / (count * slots)), d.levelsMin, d.levelsMax);
    for (let i = 0; i < count; i++) {
      const g = hangarDrumGeometry(cls, levels, slots);
      drums.push(g);
      cap[cls] += g.capacity;
    }
  }
  const H = HANGAR_SPEC.heavy;
  const needH = Math.ceil(C * Math.max(0, Number(mix?.heavy) || 0));
  const heavy = needH > 0 ? { pads: H.pads, levels: clamp(Math.ceil(needH / H.pads), 1, H.levelsMax) } : null;
  if (heavy) {
    heavy.capacity = heavy.pads * heavy.levels;
    cap.heavy = heavy.capacity;
  }
  cap.total = cap.s + cap.m + cap.l + cap.heavy;
  return { drums, heavy, capacity: cap };
}

/**
 * Układ hangaru. Opcje:
 *   id        'H-1'
 *   capacity  docelowa liczba statków (np. parking max portu); albo
 *   plan      gotowy wynik planHangarCapacity
 *   rows      1 (w szeregu — ring) albo 2 (megadok); domyślnie 1 przy ≤ 3 bębnach
 *   backZ     tył (podłoga ringu = K7_PLACEMENT.backZ, megadok 0)
 *   queueSlots, queuePitch — pas kolejki przed bramą IN
 * Wynik: bębny (środek, promienie, gniazda, poziomy), zatoka ciężka z windami,
 * bramy IN / OUT, `berths` w formacie K-7 (punkt przechwytu wejścia jako
 * stanowisko 'hangar-in', punkt wylotu 'hangar-out'), pas kolejki z miejscami,
 * obrys, pojemność.
 */
export function createHangarLayout(options = {}) {
  const S = HANGAR_SPEC;
  const id = String(options.id || 'H-1');
  const B = Number.isFinite(options.backZ) ? options.backZ : K7_PLACEMENT.backZ;
  const plan = options.plan || planHangarCapacity(options.capacity ?? 300, options.mix || S.mix);
  const units = plan.drums.map((g, i) => ({ type: 'drum', g, width: 2 * g.outerR, depth: 2 * g.outerR, i }));
  const H = S.heavy;
  if (plan.heavy) units.push({ type: 'heavy', width: H.pads * H.padBeam + (H.pads + 1) * H.gap, depth: H.padLength + 2 * H.gap });
  const rows = clamp(Math.floor(options.rows ?? (plan.drums.length > 3 ? 2 : 1)), 1, 2);
  // podział na rzędy (zachłannie po szerokości, w kolejności klas)
  const rowUnits = rows === 1 ? [units] : [[], []];
  if (rows === 2) {
    const total = units.reduce((a, u) => a + u.width, 0);
    let acc = 0;
    for (const u of units) {
      (acc + u.width / 2 <= total / 2 ? rowUnits[0] : rowUnits[1]).push(u);
      acc += u.width;
    }
    if (!rowUnits[1].length) rowUnits[1].push(rowUnits[0].pop());
  }
  const rowWidth = (list) => list.reduce((a, u) => a + u.width, 0) + Math.max(0, list.length - 1) * S.drumGap;
  const innerWidth = Math.max(...rowUnits.map(rowWidth), 2 * S.gate.width + 2400);
  const halfIn = innerWidth / 2 + S.backMargin;
  // rzędy od tyłu: tył hali → bębny rzędu 0 → (rzędu 1) → korytarz → lico
  let z = B + S.wall + S.backMargin;
  const l = {
    id, kind: 'hangar', backZ: B, drums: [], heavy: null, gates: [], berths: [], lanes: [],
    capacity: { ...plan.capacity }, levels: {}, rows
  };
  rowUnits.forEach((list, r) => {
    const depth = Math.max(...list.map((u) => u.depth));
    const zc = z + depth / 2;
    let x = -rowWidth(list) / 2;
    for (const u of list) {
      const xc = x + u.width / 2;
      if (u.type === 'drum') {
        const g = u.g;
        const tag = `${id}-${g.cls.toUpperCase()}${String(l.drums.filter((d) => d.cls === g.cls).length + 1)}`;
        l.drums.push({ id: tag, index: l.drums.length, row: r, x: xc, z: zc, ...g });
      } else {
        const pads = [];
        for (let k = 0; k < H.pads; k++) {
          const px = xc - u.width / 2 + H.gap + H.padBeam / 2 + k * (H.padBeam + H.gap);
          pads.push({ id: `${id}-HV${k + 1}`, x: px, z: zc, padLength: H.padLength, padBeam: H.padBeam, maxLength: H.maxLength, maxBeam: H.maxBeam });
        }
        l.heavy = { x: xc, z: zc, width: u.width, depth: u.depth, pads, levels: plan.heavy.levels, capacity: plan.heavy.capacity };
      }
      x += u.width + S.drumGap;
    }
    z += depth + S.drumGap;
  });
  const corridorZ0 = z - S.drumGap + 200;
  const frontZ = corridorZ0 + S.corridor;      // lico ściany przedniej (wewnętrzne)
  const outerFront = frontZ + S.wall;
  l.corridor = { z0: corridorZ0, z1: frontZ };
  l.halfWidth = halfIn + S.wall;
  l.innerHalf = halfIn;
  l.frontZ = outerFront;
  l.apronZ1 = outerFront + S.apron;
  l.wall = S.wall;
  l.wallTop = S.wallTop;
  l.roofBase = S.roofBase;
  l.depth = l.apronZ1 - B;
  l.footprint = [[-l.halfWidth, B], [l.halfWidth, B], [l.halfWidth, outerFront], [-l.halfWidth, outerFront]];
  for (const cls of ['s', 'm', 'l']) {
    const d = l.drums.find((v) => v.cls === cls);
    if (d) l.levels[cls] = d.levels;
  }
  if (l.heavy) l.levels.heavy = l.heavy.levels;

  // bramy: IN na lewym końcu lica (−x), OUT na prawym (+x)
  const gw = S.gate.width;
  const gx = halfIn - S.gate.jamb - gw / 2 - 250;
  for (const [gid, sx] of [['IN', -1], ['OUT', 1]]) {
    l.gates.push({ id: `${id}-${gid}`, kind: gid === 'IN' ? 'in' : 'out', x: sx * gx, z: frontZ + S.wall / 2, width: gw, jamb: S.gate.jamb });
  }
  const gin = l.gates[0];
  const gout = l.gates[1];
  const captureZ = frontZ - 650;
  const Q = S.queue;
  const qSlots = Math.max(0, Math.floor(options.queueSlots ?? Q.slots));
  const qPitch = Math.max(300, Number(options.queuePitch) || Q.pitch);
  const q0 = l.apronZ1 + Q.lead;
  l.queue = {
    gateId: gin.id,
    path: [[gin.x, q0], [gin.x, q0 + qPitch * Math.max(1, qSlots)]],
    pitch: qPitch,
    // miejsce 0 = tuż przed bramą; dziobem do bramy (−z)
    slots: Array.from({ length: qSlots }, (_, k) => ({ index: k, x: gin.x, z: q0 + qPitch * (k + 0.5), angle: -Math.PI / 2 }))
  };
  const capture = { halfWidth: 220, halfLength: 320, maxSpeed: 60, maxAngle: 12 * Math.PI / 180 };
  // wejście: stanowisko-przechwyt za bramą IN (statek jest już pod dachem)
  l.berths.push({
    id: gin.id, size: 'MEGA', kind: 'hangar-in', x: gin.x, z: captureZ,
    width: gw - 100, length: 1200, padLength: 1200, padBeam: gw - 100,
    angle: -Math.PI / 2, maxLength: H.maxLength, maxBeam: H.maxBeam,
    occupied: null, reserved: null, lane: 'LANE-' + gin.id,
    approach: { heading: -Math.PI / 2, from: { x: gin.x, z: q0 }, to: { x: gin.x, z: captureZ }, width: gw - 200 },
    capture, stopPoint: { x: gin.x, z: captureZ }, serviceAnchors: []
  });
  // wylot: punkt pojawienia się pod dachem za bramą OUT, dziobem w kosmos
  l.berths.push({
    id: gout.id, size: 'MEGA', kind: 'hangar-out', x: gout.x, z: captureZ,
    width: gw - 100, length: 1200, padLength: 1200, padBeam: gw - 100,
    angle: Math.PI / 2, maxLength: H.maxLength, maxBeam: H.maxBeam,
    occupied: null, reserved: null, lane: 'LANE-' + gout.id,
    launch: { heading: Math.PI / 2, from: { x: gout.x, z: captureZ }, to: { x: gout.x, z: l.apronZ1 + 1600 } },
    capture, stopPoint: { x: gout.x, z: captureZ }, serviceAnchors: []
  });
  for (const g of [gin, gout]) {
    l.lanes.push({ id: 'LANE-' + g.id, berthId: g.id, x: g.x, width: gw, z0: captureZ - 600, z1: g.kind === 'in' ? q0 + qPitch * Math.max(1, qSlots) : l.apronZ1 + 1600, reserved: null });
  }
  return l;
}

/** Punkt kolejki w odległości `d` od bramy wzdłuż pasa (dla ruchu: statki różnej długości). */
export function hangarQueuePoint(l, d, out = {}) {
  const [a, b] = l.queue.path;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const t = clamp(d / len, 0, 1);
  out.x = a[0] + (b[0] - a[0]) * t;
  out.z = a[1] + (b[1] - a[1]) * t;
  out.angle = Math.atan2(a[1] - b[1], a[0] - b[0]);
  return out;
}

/**
 * Bryły hangaru w płaszczyźnie lotu (wysokości K-7) — kolizje i render: ściany
 * z otworami bram, ościeża. Boje kolejki są bez kolizji.
 */
export function hangarSolidList(l) {
  const out = [];
  const add = (id, x, y, z, w, h, d) => out.push({ id, x, y, z, w, h, d, angle: 0 });
  const H = l.wallTop;
  const W = l.wall;
  const zc = (l.backZ + l.frontZ) / 2;
  const len = l.frontZ - l.backZ;
  add('HANGAR BACK ' + l.id, 0, H / 2, l.backZ + W / 2, 2 * l.halfWidth, H, W);
  for (const side of [-1, 1]) add('HANGAR WALL ' + l.id + (side < 0 ? ' W' : ' E'), side * (l.halfWidth - W / 2), H / 2, zc, W, H, len);
  // lico z otworami bram: odcinki między ościeżami
  const zf = l.frontZ - W / 2;
  const cuts = l.gates.map((g) => [g.x - g.width / 2 - g.jamb, g.x + g.width / 2 + g.jamb]).sort((a, b) => a[0] - b[0]);
  let x = -l.halfWidth;
  cuts.forEach(([c0, c1], k) => {
    if (c0 - x > 1) add(`HANGAR FRONT ${l.id}/${k}`, (x + c0) / 2, H / 2, zf, c0 - x, H, W);
    x = c1;
  });
  if (l.halfWidth - x > 1) add(`HANGAR FRONT ${l.id}/${cuts.length}`, (x + l.halfWidth) / 2, H / 2, zf, l.halfWidth - x, H, W);
  for (const g of l.gates) {
    for (const s of [-1, 1]) add(`GATE JAMB ${g.id}/${s}`, g.x + s * (g.width / 2 + g.jamb / 2), H / 2, zf, g.jamb, H, W + 60);
  }
  return out;
}
