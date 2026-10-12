// Baza piratów (misja 1) — układ wg szkicu użytkownika z 2026-10-11 (zastępuje suchy dok: „kopiowanie K-7 było złym
// pomysłem, trzeba stworzyć kompletnie nowy kompleks piracki”). Czysta matematyka (bez Three i DOM).
//
//                                         M (magazyn)
//            A1 ╲                          ┃ ▮▮▮▮        P1
//                ╲ ▮▮▮▮  (ramię A)          ┃     ▮▮▮▮ ┃ ▮▮▮▮   (supercapitale ▮ w zatoce między pomostami)
//   gracz →       F ━━━━━ ( HABITAT ) ━━━━━━ E ╲      N ━━━━━━━ P0 ▸ P (zbiorniki paliwa)
//                ╱ ▮▮▮▮▮ (ramię B)                 ╲ ▮▮▮ ╱
//            B1 ╱
//
// Układ lokalny jak budowle Z7 (portBuildingScene.js): x wzdłuż osi podejścia (gracz nadlatuje od −x — rozwidlenie Y
// otwiera się ku niemu, magazyn i zbiorniki są na drugim końcu, za habitatem), z w poprzek, y = wysokość K-7
// (płaszczyzna gry y = 116 = z świata 0, nad nią ×0,42 — k7HeightToZ). Kurs w układzie: kąt od +x ku +z.
//
// Decyzje użytkownika (2026-10-11):
//  - HABITAT: w płaszczyźnie gry BĘBEN — „rura” (ściana zewnętrzna, grodzie promieniowe, pierścień wewnętrzny, szyb),
//    otwarty od góry, żeby taran i ostrzał było widać z kamery gry; nad nim WĘŻSZA część techniczna (anteny, talerze,
//    pierścień z oknami — cywile), pod płaszczyzną DYSK MIESZKALNY kilka razy większy od bębna (nic go nie zasłania,
//    widać ogromną strukturę). Zniszczony bęben → góra i dół „implodują”.
//  - POMOSTY z okrętami po obu stronach (także na ramionach Y); większość okrętów w remoncie (bez załogi), kilkanaście
//    z załogą startuje na zegar; 3 supercapitale w zatoce przy zbiornikach — herszt i dwa w remoncie.
//  - P = zbiorniki paliwa, rury od P po pomostach, przez habitat do ramion Y. Wysadzony zbiornik = reakcja
//    łańcuchowa rurami (src/game/story/pirateBaseFuel.js); same rury wybuchają tylko lokalnie. Bez podpowiedzi —
//    zbiorniki mają po prostu wyglądać jak zbiorniki.
//  - M = magazyn — budynek do zniszczenia.
// W płaszczyźnie gry (przeszkoda, pociski, ciała świata): pomosty, ściany i grodzie bębna, szyb, zbiorniki, kolektor,
// ściany magazynu. Pod płaszczyzną: dno bębna, trzon i dysk mieszkalny, rury, rękawy do dziobów; nad nią: część
// techniczna, maszty, dach magazynu.

export const PIRATE_BASE_SHIP = Object.freeze({
  // długość × szerokość okrętu klasy w grze (sprite × 0,6; shipyardLayout.parkedLengthOf) i szerokość stanowiska
  frigate: Object.freeze({ length: 192, beam: 144, slot: 170 }),
  destroyer: Object.freeze({ length: 360, beam: 204, slot: 250 }),
  battleship: Object.freeze({ length: 720, beam: 264, slot: 440 }),
  supercapital: Object.freeze({ length: 1200, beam: 600, slot: 700 })
});

/** Klasa okrętu z klucza wezwania / kadłuba (frigate_pd, destroyer, battleship, pirate_supercapital…). */
export function pirateBaseShipClass(key) {
  const k = String(key || '');
  if (k.includes('supercapital')) return 'supercapital';
  if (k.includes('battleship')) return 'battleship';
  if (k.includes('destroyer')) return 'destroyer';
  return 'frigate';
}

export const PIRATE_BASE_SPEC = Object.freeze({
  habitat: Object.freeze({
    drumR: 1000, wall: 90, innerR: 560, innerW: 60, coreR: 240,
    spokeW: 64, spokes: 10, innerSpokes: 6,
    floorY: -170, wallTop: 330, rimTop: 352,
    coreTop: 1150, ringR0: 360, ringR1: 560, ringY0: 760, ringY1: 900, mastTop: 2300,
    stemR: 560, discR: 3300, discY0: -1010, discY1: -720, tier1R: 2150, tier1Y: -620, tier2R: 1000, tier2Y: -540,
    discSectors: 8
  }),
  pier: Object.freeze({ halfW: 85, deckY0: -40, deckY1: 200, gap: 60, pipeOff: 132, pipeY: 34, pipeR: 26 }),
  fuel: Object.freeze({ tankR: 300, tankY0: -520, tankY1: 820 }),
  warehouse: Object.freeze({ w: 1500, d: 950, wallTop: 560, roofY: 600, wall: 70 }),
  heights: Object.freeze({ mastTop: 620 })
});

// Węzły układu (x, z) — szkielet pomostów.
const NODES = Object.freeze({
  Hw: [-1000, 0], He: [1000, 0], F: [-3300, 0], A1: [-5780, -2480], B1: [-5350, 2570],
  E: [3600, 0], N: [5100, -1450], Mp: [5100, -3550], P0: [7100, -1450], P1: [7100, -4200]
});

// Pomosty: kawałki (długie — dwa), klasy okrętów stanowisk po stronach (σ = −1 — strona −n, +1 — strona +n, gdzie
// n = kierunek pomostu obrócony o +90°), litera stanowisk, strona rury (pipe), napis.
const PIERS = Object.freeze([
  { id: 'Y-A', letter: 'A', from: 'F', to: 'A1', chunks: ['YA-1', 'YA-2'], pipe: -1, label: 'ramię A',
    sides: { '-1': ['destroyer', 'frigate', 'battleship', 'destroyer'], '1': ['frigate', 'destroyer', 'frigate', 'battleship'] } },
  { id: 'Y-B', letter: 'B', from: 'F', to: 'B1', chunks: ['YB-1', 'YB-2'], pipe: 1, label: 'ramię B',
    sides: { '-1': ['frigate', 'destroyer', 'battleship', 'frigate', 'destroyer'], '1': ['destroyer', 'frigate', 'destroyer', 'battleship', 'frigate'] } },
  { id: 'N-P', letter: 'C', from: 'Hw', to: 'F', chunks: ['NP'], pipe: 1, label: 'pomost wschodni',
    sides: { '-1': ['battleship', 'destroyer'], '1': ['destroyer', 'battleship'] } },
  { id: 'F-P', letter: 'D', from: 'He', to: 'E', chunks: ['FP'], pipe: -1, label: 'pomost zachodni',
    sides: { '-1': ['destroyer', 'battleship', 'frigate'], '1': ['frigate', 'destroyer', 'battleship'] } },
  { id: 'D-G', letter: 'E', from: 'E', to: 'N', chunks: ['DG'], pipe: -1, label: 'skos',
    sides: { '-1': ['frigate', 'destroyer', 'frigate'], '1': ['battleship', 'frigate', 'destroyer'] } },
  { id: 'M-P', letter: 'F', from: 'N', to: 'Mp', chunks: ['MP'], pipe: -1, label: 'pomost magazynu',
    sides: { '-1': ['destroyer', 'frigate', 'destroyer', 'frigate'] } },
  { id: 'P-S', letter: 'G', from: 'N', to: 'P0', chunks: ['PS'], pipe: 1, label: 'pomost paliwowy',
    sides: { '1': ['frigate', 'destroyer', 'frigate'] } },
  { id: 'P-P', letter: 'H', from: 'P0', to: 'P1', chunks: ['PP'], pipe: -1, label: 'pomost supercapitali',
    sides: { '1': ['destroyer', 'frigate', 'battleship', 'frigate'], '-1': ['supercapital', 'supercapital', 'supercapital'] } }
]);

// Załogi (decyzja 2026-10-11: większość w remoncie): te stanowiska mają załogę i startują na zegar wodowania;
// herszt — supercapital przy otwartym końcu zatoki (startuje pierwszy na alarm, wyjazd wzdłuż zatoki). Rząd do taranu (samouczek) = wewnętrzna strona
// ramienia A (σ = −1, ku osi lejka): dwa z czterech okrętów z załogą — taran zatrzymuje start.
export const PIRATE_BASE_CREWED = Object.freeze(['A-L2', 'A-L4', 'B-R3', 'B-L2', 'C-L1', 'C-R2', 'D-L2', 'D-R1', 'E-R1', 'E-L2', 'F-L1', 'H-R3']);
export const PIRATE_BASE_BOSS = 'H-L3';
// offset: oś toru od osi pomostu — Atlas (szer. 806) mija pokład pomostu (pół 85 + rękawy), a miażdży każdy okręt rzędu
// (fregata sięga 337 j. od osi, pancernik 865).
export const PIRATE_BASE_RAM = Object.freeze({ pier: 'Y-A', side: -1, offset: 600, runUp: 900, stopFrac: 0.12 });

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function boxPoly(x, z, w, d, angle = 0) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => ({ x: x + a * c - b * s, z: z + a * s + b * c }));
}
function circlePoly(x, z, r, n = 16) {
  return Array.from({ length: n }, (_, k) => ({ x: x + Math.cos((k / n) * TAU) * r, z: z + Math.sin((k / n) * TAU) * r }));
}
// Wycinek pierścienia r0..r1 między kątami a0..a1 (rad): łuk zewnętrzny i powrót łukiem wewnętrznym.
function annulusPoly(r0, r1, a0, a1, step = 0.13) {
  const n = Math.max(2, Math.ceil((a1 - a0) / step));
  const out = [];
  for (let k = 0; k <= n; k++) { const a = a0 + ((a1 - a0) * k) / n; out.push({ x: Math.cos(a) * r1, z: Math.sin(a) * r1 }); }
  for (let k = n; k >= 0; k--) { const a = a0 + ((a1 - a0) * k) / n; out.push({ x: Math.cos(a) * r0, z: Math.sin(a) * r0 }); }
  return out;
}

/** Odcinek a → b z osiami: u (kierunek), n (u obrócone o +90°: (−uz, ux)). */
export function pirateBaseSegment(ax, az, bx, bz) {
  const len = Math.hypot(bx - ax, bz - az) || 1;
  const ux = (bx - ax) / len;
  const uz = (bz - az) / len;
  return { ax, az, bx, bz, len, ux, uz, nx: -uz, nz: ux, angle: Math.atan2(uz, ux) };
}

/**
 * Prostokąt okrętu w stanowisku (układ bazy): środek, kurs dziobu, długość i szerokość — `pirateBaseShipCorners`.
 */
export function pirateBaseShipCorners(b) {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const hl = b.length / 2;
  const hw = b.beam / 2;
  return [[hl, hw], [hl, -hw], [-hl, -hw], [-hl, hw]].map(([a, d]) => ({ x: b.x + a * c - d * s, z: b.z + a * s + d * c }));
}

/**
 * Układ bazy. opts: { id }. Wynik:
 *   nodes, habitat { drumR…, quadrants [{ id, a0, a1 }], bays [{ id, x, z, angle }], spokes, innerSpokes },
 *   piers [{ id, letter, ax… (pirateBaseSegment), halfW, pipe, chunks, label }],
 *   berths [{ id, index, pier, chunk, side, s, cls, length, beam, slot, x, z, angle, tapX, tapZ, bowX, bowZ,
 *            crew, boss, repair, supercap, out: { x, z } (kierunek wyjazdu rufą) }],
 *   tanks [{ id, chunk, x, z, r }], manifold, warehouse, fuel { nodes, edges, sluices }, lights,
 *   chunks [{ id, kind, structure, group, label, box, anchors, weight, ghost }], chunkById, structures,
 *   hitSolids [{ id, chunk, poly }], ram { start, end, dir }, mouth, bounds, center, width, depth.
 */
export function createPirateBaseLayout(opts = {}) {
  const S = PIRATE_BASE_SPEC;
  const Hs = S.habitat;
  const Ps = S.pier;
  const l = { id: String(opts.id || 'PB-1'), kind: 'pirateBase', spec: S };
  const nodes = {};
  for (const [k, [x, z]] of Object.entries(NODES)) nodes[k] = { x, z };
  l.nodes = nodes;

  // ---- habitat: ćwiartki bębna (E — ku +x, S — +z, W — −x, N — −z), grodzie, hangary dronów
  const q = (id, c) => ({ id, a0: c - Math.PI / 4, a1: c + Math.PI / 4 });
  const hab = {
    x: 0, z: 0, ...Hs,
    quadrants: [q('H-E', 0), q('H-S', Math.PI / 2), q('H-W', Math.PI), q('H-N', -Math.PI / 2)],
    spokes: Array.from({ length: Hs.spokes }, (_, k) => ((k + 0.5) / Hs.spokes) * TAU),
    innerSpokes: Array.from({ length: Hs.innerSpokes }, (_, k) => (k / Hs.innerSpokes) * TAU),
    bays: [Math.PI / 3, (2 * Math.PI) / 3, -Math.PI / 3, (-2 * Math.PI) / 3].map((a, i) => ({
      id: `HD-${i + 1}`, angle: a, x: Math.cos(a) * Hs.drumR, z: Math.sin(a) * Hs.drumR
    }))
  };
  hab.quadrantAt = (a) => {
    const w = Math.atan2(Math.sin(a), Math.cos(a));
    if (w >= -Math.PI / 4 && w < Math.PI / 4) return 'H-E';
    if (w >= Math.PI / 4 && w < (3 * Math.PI) / 4) return 'H-S';
    if (w >= -(3 * Math.PI) / 4 && w < -Math.PI / 4) return 'H-N';
    return 'H-W';
  };
  l.habitat = hab;

  // ---- pomosty i stanowiska
  l.piers = [];
  l.berths = [];
  const crew = new Set(opts.crewed || PIRATE_BASE_CREWED);
  const boss = opts.boss || PIRATE_BASE_BOSS;
  for (const def of PIERS) {
    const a = nodes[def.from];
    const b = nodes[def.to];
    const p = { ...pirateBaseSegment(a.x, a.z, b.x, b.z), id: def.id, letter: def.letter, from: def.from, to: def.to,
      halfW: Ps.halfW, pipe: def.pipe, chunks: def.chunks.slice(), label: def.label };
    p.chunkAt = (s) => (p.chunks.length > 1 && s > p.len / 2 ? p.chunks[1] : p.chunks[0]);
    l.piers.push(p);
    for (const sideKey of Object.keys(def.sides)) {
      const side = Number(sideKey);
      const list = def.sides[sideKey];
      const n = list.length;
      list.forEach((cls, k) => {
        const C = PIRATE_BASE_SHIP[cls];
        // równo po długości, z zapasem przy końcach (węzły, maszty)
        const s = p.len * (0.08 + (0.84 * (k + 0.5)) / n);
        const px = p.ax + p.ux * s;
        const pz = p.az + p.uz * s;
        const off = Ps.halfW + Ps.gap + C.length / 2;
        const ox = p.nx * side;
        const oz = p.nz * side;
        const id = `${def.letter}-${side < 0 ? 'L' : 'R'}${k + 1}`;
        const berth = {
          id, index: l.berths.length, pier: p.id, chunk: p.chunkAt(s), side, s, cls,
          length: C.length, beam: C.beam, slot: C.slot,
          x: px + ox * off, z: pz + oz * off,
          // dziób ku pomostowi
          angle: Math.atan2(-oz, -ox),
          tapX: px, tapZ: pz,
          bowX: px + ox * (Ps.halfW + Ps.gap), bowZ: pz + oz * (Ps.halfW + Ps.gap),
          out: { x: ox, z: oz },
          supercap: cls === 'supercapital',
          boss: id === boss,
          crew: crew.has(id) || id === boss
        };
        berth.repair = !berth.crew;
        l.berths.push(berth);
      });
    }
  }
  l.berthById = new Map(l.berths.map((b) => [b.id, b]));

  // ---- paliwo: trzy zbiorniki za narożnikiem P0 (od strony +z, za pomostem paliwowym) i kolektor z pompami
  const F = S.fuel;
  const P0 = nodes.P0;
  l.manifold = { id: 'P-M', chunk: 'P-M', x: P0.x + 260, z: P0.z + 330, w: 420, d: 380, angle: 0 };
  l.tanks = [
    { id: 'P-1', chunk: 'P-1', x: P0.x + 260, z: P0.z + 1050, r: F.tankR },
    { id: 'P-2', chunk: 'P-2', x: P0.x + 960, z: P0.z + 700, r: F.tankR },
    { id: 'P-3', chunk: 'P-3', x: P0.x + 960, z: P0.z + 1420, r: F.tankR }
  ];
  nodes.P = { x: l.manifold.x, z: l.manifold.z };

  // ---- magazyn za końcem pomostu M-P (−z)
  const W = S.warehouse;
  const Mp = nodes.Mp;
  l.warehouse = {
    x: Mp.x - 250, z: Mp.z - 120 - W.d / 2, w: W.w, d: W.d, wallTop: W.wallTop, roofY: W.roofY, wall: W.wall,
    annex: { x: Mp.x - 250 - W.w / 2 - 330, z: Mp.z - 120 - W.d * 0.3, w: 560, d: W.d * 0.6 }
  };
  nodes.M = { x: l.warehouse.x, z: l.warehouse.z };

  // ---- sieć paliwowa: węzły (zbiorniki, rozgałęzienia, śluzy habitatu, zawory stanowisk) i krawędzie wzdłuż pomostów
  const fnodes = new Map();
  const fedges = [];
  const addNode = (id, x, z, kind, extra = {}) => { if (!fnodes.has(id)) fnodes.set(id, { id, x, z, kind, ...extra }); return id; };
  const addEdge = (a, b, pier = null) => {
    const A = fnodes.get(a);
    const B = fnodes.get(b);
    fedges.push({ a, b, pier, len: Math.hypot(B.x - A.x, B.z - A.z) });
  };
  addNode('P', nodes.P.x, nodes.P.z, 'tank');
  for (const k of ['P0', 'N', 'E', 'F', 'A1', 'B1', 'Mp', 'P1']) addNode(k, nodes[k].x, nodes[k].z, 'junction');
  addNode('M', nodes.M.x, nodes.M.z, 'warehouse');
  addNode('Hw', nodes.Hw.x, nodes.Hw.z, 'sluice');
  addNode('He', nodes.He.x, nodes.He.z, 'sluice');
  addNode('H', 0, 0, 'habitat');
  addEdge('P', 'P0');
  addEdge('Mp', 'M');
  addEdge('He', 'H');
  addEdge('H', 'Hw');
  for (const p of l.piers) {
    // zawory stanowisk pomostu po kolei wzdłuż pomostu (obie strony — jedna rura)
    const taps = l.berths.filter((b) => b.pier === p.id).sort((x, y) => x.s - y.s);
    let prev = p.from;
    for (const b of taps) {
      const id = `t:${b.id}`;
      addNode(id, b.tapX, b.tapZ, 'tap', { berth: b.id });
      addEdge(prev, id, p.id);
      prev = id;
    }
    addEdge(prev, p.to, p.id);
  }
  l.fuel = { nodes: fnodes, edges: fedges, sluices: ['Hw', 'He'], source: 'P', habitat: 'H' };

  // ---- maszty reflektorów (FG) i światła siatki gry; pierwsze PB_MAX_LAMPS (8) to też lampy budowli
  const warm = [1.0, 0.74, 0.46];
  const red = [1.0, 0.32, 0.22];
  const mast = (id, x, z, chunk, aimX, aimZ, range = 1800, color = warm) => ({ id, x, y: S.heights.mastTop, z, kind: 'flood', color, range, chunk, aim: { x: aimX, z: aimZ } });
  const habMast = (a, id) => {
    const r = Hs.drumR - Hs.wall / 2;
    return mast(id, Math.cos(a) * r, Math.sin(a) * r, hab.quadrantAt(a), Math.cos(a) * (r + 1300), Math.sin(a) * (r + 1300), 1900);
  };
  l.lights = [
    mast('L-F', nodes.F.x, nodes.F.z - 140, 'NP', nodes.F.x - 900, 0, 2000),
    habMast((5 * Math.PI) / 4, 'L-H1'),
    habMast((3 * Math.PI) / 4, 'L-H2'),
    mast('L-A', nodes.A1.x + 260, nodes.A1.z + 200, 'YA-2', nodes.A1.x + 900, nodes.A1.z + 1100),
    mast('L-B', nodes.B1.x + 260, nodes.B1.z - 200, 'YB-2', nodes.B1.x + 900, nodes.B1.z - 1100),
    mast('L-E', nodes.E.x, nodes.E.z + 140, 'FP', nodes.E.x - 600, 900),
    mast('L-N', nodes.N.x - 140, nodes.N.z + 140, 'DG', nodes.N.x - 900, nodes.N.z - 900),
    mast('L-P', P0.x + 150, P0.z - 150, 'PP', P0.x - 900, P0.z - 1100, 2000, [1.0, 0.62, 0.32]),
    habMast(Math.PI / 4, 'L-H3'),
    habMast(-Math.PI / 4, 'L-H4'),
    mast('L-M', Mp.x + 150, Mp.z + 120, 'MP', Mp.x - 900, Mp.z + 700),
    mast('L-P1', nodes.P1.x + 150, nodes.P1.z + 120, 'PP', nodes.P1.x - 700, nodes.P1.z + 900, 1700, red)
  ];

  // ---- kawałki (grupa renderu na kawałek; kolejność = numer grupy; grupa 0 — podłoże, które zostaje)
  const chunks = [];
  const add = (id, kind, structure, label, box, anchors, weight = 1, ghost = false) => {
    chunks.push({ id, kind, structure, label, box, anchors, weight, ghost, group: chunks.length + 1 });
  };
  const R = Hs.drumR;
  const yDrum = { y0: Hs.floorY - 40, y1: Hs.rimTop + 60 };
  for (const qd of hab.quadrants) {
    const xs = [];
    const zs = [];
    for (let k = 0; k <= 8; k++) {
      const a = qd.a0 + ((qd.a1 - qd.a0) * k) / 8;
      xs.push(Math.cos(a) * R, Math.cos(a) * Hs.innerR * 0.85);
      zs.push(Math.sin(a) * R, Math.sin(a) * Hs.innerR * 0.85);
    }
    add(qd.id, 'drum', 'habitat', `bęben habitatu ${qd.id.slice(2)}`,
      { x0: Math.min(...xs) - 40, x1: Math.max(...xs) + 40, ...yDrum, z0: Math.min(...zs) - 40, z1: Math.max(...zs) + 40 }, ['H-C'], 2);
  }
  add('H-C', 'core', 'habitat', 'szyb habitatu', { x0: -Hs.innerR, x1: Hs.innerR, y0: Hs.discY1, y1: Hs.coreTop, z0: -Hs.innerR, z1: Hs.innerR },
    hab.quadrants.map((qd) => qd.id), 3);
  add('H-T', 'tech', 'habitat', 'część techniczna habitatu', { x0: -Hs.ringR1 - 200, x1: Hs.ringR1 + 200, y0: Hs.coreTop - 400, y1: Hs.mastTop, z0: -Hs.ringR1 - 200, z1: Hs.ringR1 + 200 },
    ['H-C'], 1, true);
  const ds = Hs.discSectors;
  for (let k = 0; k < ds; k++) {
    const a0 = ((k - 0.5) / ds) * TAU;
    const a1 = ((k + 0.5) / ds) * TAU;
    const pts = annulusPoly(0, Hs.discR, a0, a1);
    add(`D-${k + 1}`, 'disc', 'habitat', `dysk mieszkalny ${k + 1}/${ds}`,
      { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Hs.discY0, y1: Hs.tier2Y + 30,
        z0: Math.min(...pts.map((p) => p.z)), z1: Math.max(...pts.map((p) => p.z)) },
      [`D-${((k + ds - 1) % ds) + 1}`, `D-${((k + 1) % ds) + 1}`, 'H-C'], 1, true);
  }
  // pomosty (bez okrętów; z rękawami i rusztowaniami stanowisk)
  for (const p of l.piers) {
    const parts = p.chunks.length;
    for (let i = 0; i < parts; i++) {
      const s0 = (p.len * i) / parts;
      const s1 = (p.len * (i + 1)) / parts;
      const pts = [];
      for (const s of [s0, s1]) {
        for (const o of [-1, 1]) {
          const ext = Ps.halfW + Ps.gap + 120;
          pts.push({ x: p.ax + p.ux * s + p.nx * o * ext, z: p.az + p.uz * s + p.nz * o * ext });
        }
      }
      const anchors = [];
      if (i > 0) anchors.push(p.chunks[i - 1]);
      if (i + 1 < parts) anchors.push(p.chunks[i + 1]);
      add(p.chunks[i], 'pier', 'piers', parts > 1 ? `${p.label} ${i + 1}/${parts}` : p.label,
        { x0: Math.min(...pts.map((v) => v.x)), x1: Math.max(...pts.map((v) => v.x)), y0: -160, y1: S.heights.mastTop + 80,
          z0: Math.min(...pts.map((v) => v.z)), z1: Math.max(...pts.map((v) => v.z)) }, anchors, 1.2);
    }
  }
  // sąsiedztwo pomostów w węzłach (dla rozpadu)
  const pierEndChunks = (nodeId) => {
    const out = [];
    for (const p of l.piers) {
      if (p.from === nodeId) out.push(p.chunks[0]);
      if (p.to === nodeId) out.push(p.chunks[p.chunks.length - 1]);
    }
    return out;
  };
  const chunkById0 = new Map(chunks.map((c) => [c.id, c]));
  for (const nodeId of ['F', 'E', 'N', 'P0']) {
    const ids = pierEndChunks(nodeId);
    for (const a of ids) for (const b of ids) if (a !== b && !chunkById0.get(a).anchors.includes(b)) chunkById0.get(a).anchors.push(b);
  }
  chunkById0.get('NP').anchors.push('H-W');
  chunkById0.get('FP').anchors.push('H-E');
  // zbiorniki i kolektor
  const yTank = { y0: F.tankY0, y1: F.tankY1 + 60 };
  for (const t of l.tanks) add(t.chunk, 'tank', 'fuel', `zbiornik paliwa ${t.id.slice(2)}`, { x0: t.x - t.r - 60, x1: t.x + t.r + 60, ...yTank, z0: t.z - t.r - 60, z1: t.z + t.r + 60 }, ['P-M'], 1.4);
  const M0 = l.manifold;
  add('P-M', 'manifold', 'fuel', 'kolektor paliwa', { x0: M0.x - M0.w / 2 - 80, x1: M0.x + M0.w / 2 + 80, y0: -300, y1: 520, z0: M0.z - M0.d / 2 - 80, z1: M0.z + M0.d / 2 + 80 },
    ['P-1', 'P-2', 'P-3', 'PS', 'PP'], 1.2);
  // magazyn
  const WH = l.warehouse;
  add('M-1', 'warehouse', 'warehouse', 'magazyn', { x0: WH.x - WH.w / 2 - 60, x1: WH.x + WH.w / 2 + 60, y0: -300, y1: WH.roofY + 140, z0: WH.z - WH.d / 2 - 60, z1: WH.z + WH.d / 2 + 60 }, ['M-2', 'MP'], 2);
  const AX = WH.annex;
  add('M-2', 'annex', 'warehouse', 'plac kontenerów magazynu', { x0: AX.x - AX.w / 2 - 40, x1: AX.x + AX.w / 2 + 40, y0: -200, y1: 420, z0: AX.z - AX.d / 2 - 40, z1: AX.z + AX.d / 2 + 40 }, ['M-1'], 1);
  l.chunks = chunks;
  l.chunkById = new Map(chunks.map((c) => [c.id, c]));
  l.structures = { habitat: [], fuel: [], warehouse: [], piers: [] };
  for (const c of chunks) l.structures[c.structure].push(c.id);

  // ---- bryły w płaszczyźnie gry (pociski, Hexlance, radar, przeszkody gazu): bęben — wycinki pierścienia ściany
  // i grodzi, szyb — koło, pomosty — prostokąty, zbiorniki — koła, kolektor i magazyn — prostokąty
  const hits = [];
  for (const qd of hab.quadrants) hits.push({ id: `hit-${qd.id}`, chunk: qd.id, poly: annulusPoly(Hs.innerR - Hs.innerW, R, qd.a0, qd.a1) });
  hits.push({ id: 'hit-H-C', chunk: 'H-C', poly: circlePoly(0, 0, Hs.innerR - Hs.innerW, 16) });
  for (const p of l.piers) {
    const parts = p.chunks.length;
    for (let i = 0; i < parts; i++) {
      const s0 = (p.len * i) / parts;
      const s1 = (p.len * (i + 1)) / parts;
      const cx = p.ax + p.ux * (s0 + s1) / 2;
      const cz = p.az + p.uz * (s0 + s1) / 2;
      hits.push({ id: `hit-${p.chunks[i]}`, chunk: p.chunks[i], poly: boxPoly(cx, cz, s1 - s0, 2 * Ps.halfW + 16, p.angle) });
    }
  }
  for (const t of l.tanks) hits.push({ id: `hit-${t.id}`, chunk: t.chunk, poly: circlePoly(t.x, t.z, t.r, 16) });
  hits.push({ id: 'hit-P-M', chunk: 'P-M', poly: boxPoly(M0.x, M0.z, M0.w, M0.d, M0.angle) });
  hits.push({ id: 'hit-M-1', chunk: 'M-1', poly: boxPoly(WH.x, WH.z, WH.w, WH.d) });
  hits.push({ id: 'hit-M-2', chunk: 'M-2', poly: boxPoly(AX.x, AX.z, AX.w, AX.d) });
  l.hitSolids = hits;

  // ---- taran samouczka: wzdłuż wewnętrznej strony ramienia A (od końca ku rozwidleniu), w połowie długości okrętów
  const ramPier = l.piers.find((p) => p.id === PIRATE_BASE_RAM.pier);
  const rs = PIRATE_BASE_RAM.side;
  const ro = PIRATE_BASE_RAM.offset;
  const rx = ramPier.nx * rs * ro;
  const rz = ramPier.nz * rs * ro;
  l.ram = {
    pier: ramPier.id, side: rs,
    start: { x: ramPier.bx + ramPier.ux * PIRATE_BASE_RAM.runUp + rx, z: ramPier.bz + ramPier.uz * PIRATE_BASE_RAM.runUp + rz },
    end: { x: ramPier.ax + ramPier.ux * ramPier.len * PIRATE_BASE_RAM.stopFrac + rx, z: ramPier.az + ramPier.uz * ramPier.len * PIRATE_BASE_RAM.stopFrac + rz },
    berths: l.berths.filter((b) => b.pier === ramPier.id && b.side === rs).map((b) => b.id)
  };
  l.ram.dir = Math.atan2(l.ram.end.z - l.ram.start.z, l.ram.end.x - l.ram.start.x);
  // wylot lejka (środek między końcami ramion) — tam celuje podejście
  l.mouth = { x: Math.min(nodes.A1.x, nodes.B1.x) - 600, z: (nodes.A1.z + nodes.B1.z) / 2 };

  // ---- obwiednia: kawałki, okręty stanowisk, dysk
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const take = (x, z) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
  for (const c of chunks) { take(c.box.x0, c.box.z0); take(c.box.x1, c.box.z1); }
  for (const b of l.berths) for (const p of pirateBaseShipCorners(b)) take(p.x, p.z);
  l.bounds = { x0: x0 - 200, x1: x1 + 200, z0: z0 - 200, z1: z1 + 200 };
  l.center = { x: (l.bounds.x0 + l.bounds.x1) / 2, z: (l.bounds.z0 + l.bounds.z1) / 2 };
  l.width = l.bounds.x1 - l.bounds.x0;
  l.depth = l.bounds.z1 - l.bounds.z0;
  l.capacity = { berths: l.berths.length, crewed: l.berths.filter((b) => b.crew).length };
  return l;
}

/** Kawałek pod punktem układu (x, z) — trafienie w bryłę (filter(chunk) — np. kawałki jednej budowli). */
export function pirateBaseChunkAt(l, x, z, filter = null) {
  for (const h of l.hitSolids) {
    if (filter && !filter(l.chunkById.get(h.chunk))) continue;
    if (pointInPoly(h.poly, x, z)) return h.chunk;
  }
  return null;
}

/** Najbliższy kawałek (środek pudła) do punktu układu; filter(chunk) → bool. */
export function pirateBaseNearestChunk(l, x, z, filter = null) {
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

export function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export { clamp as pirateBaseClamp };
