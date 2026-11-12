// Baza piratów (misja 1) — układ wg szkicu użytkownika z 2026-10-11 (zastępuje suchy dok: „kopiowanie K-7 było złym
// pomysłem, trzeba stworzyć kompletnie nowy kompleks piracki”). Czysta matematyka (bez Three i DOM).
//
//              A1                                       M (magazyn)
//               ┃ ▮▮▮▮ (ramię A — na zewnątrz okręty z załogą)         ┃ ▮▮▮▮        P1
//               ┃                                                     ┃     ▮▮▮▮ ┃ ▮▮▮▮   (supercapitale ▮ w zatoce)
//   gracz →     F ━━━━━━━━━━━━ ( HABITAT ) ━━━━━━ E ╲      N ━━━━━━━ P0 ▸ P (zbiorniki paliwa)
//               ┃                                       ╲ ▮▮▮ ╱
//               ┃ ▮▮▮▮▮ (ramię B — na zewnątrz okręty z załogą)
//              B1
//
// 2026-10-14 (prośba użytkownika): zamiast rozwidlenia Y („>”) litera T — trzon od habitatu do F i SZEROKA poprzeczka
// (ramiona A i B w poprzek osi podejścia). Na ZEWNĘTRZNEJ stronie poprzeczki (ku graczowi) stoją okręty z załogą (te,
// które startują), w remoncie — od strony habitatu; gracz rozbija rząd szarżą (F) wzdłuż całej poprzeczki (l.ram).
//
// Układ lokalny jak budowle Z7 (portBuildingScene.js): x wzdłuż osi podejścia (gracz nadlatuje od −x — na poprzeczkę T,
// magazyn i zbiorniki są na drugim końcu, za habitatem), z w poprzek, y = wysokość K-7
// (płaszczyzna gry y = 116 = z świata 0, nad nią ×0,42 — k7HeightToZ). Kurs w układzie: kąt od +x ku +z.
//
// Decyzje użytkownika (2026-10-11):
//  - HABITAT (2026-11-11, prośba użytkownika — zastępuje bęben z głową na szyi): MIASTO wieżowców w dwóch pierścieniach
//    wokół dużej WIEŻY pośrodku, na DYSKU MIESZKALNYM (dolna warstwa pod płaszczyzną gry, większa od miasta). Gracz
//    przestrzeliwuje wieżowce z jednej strony (każdy to kawałek z pulą), trafia w podstawę wieży, a wieża pada na
//    wieżowce i przebija dysk. W miejscu dwóch wieżowców na pomostach stoją REAKTORY ANTYGRAWITACYJNE (trzymają bazę
//    nad planetoidą; osobne budowle — etap finału).
//  - POMOSTY z okrętami po obu stronach (także na ramionach Y); większość okrętów w remoncie (bez załogi), kilkanaście
//    z załogą startuje na zegar; 3 supercapitale w zatoce przy zbiornikach — herszt i dwa w remoncie.
//  - P = zbiorniki paliwa, rury od P po pomostach, przez habitat do ramion Y. Wysadzony zbiornik = reakcja
//    łańcuchowa rurami (src/game/story/pirateBaseFuel.js); same rury wybuchają tylko lokalnie. Bez podpowiedzi —
//    zbiorniki mają po prostu wyglądać jak zbiorniki.
//  - M = magazyn — budynek do zniszczenia.
// W płaszczyźnie gry (przeszkoda, pociski, ciała świata): pomosty, wieżowce miasta, podstawa wieży, obudowy reaktorów,
// zbiorniki, kolektor, ściany magazynu. Pod płaszczyzną: ulice (tarasy dysku), cokół wieży i dysk mieszkalny, dzwony
// emiterów reaktorów, rury, rękawy do dziobów; nad nią: górne piętra wieżowców, wieża z koroną, maszty, dach magazynu.

export const PIRATE_BASE_SHIP = Object.freeze({
  // długość × szerokość okrętu klasy w grze (sprite × 0,6) i szerokość stanowiska
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

// Habitat = MIASTO Z WIEŻĄ (2026-11-11, prośba użytkownika: „zwiększ środek — zrób z niego miasto z wieżowcami z dużą
// wieżą pośrodku; gracz przestrzeli wieżowce z jakiejś strony i walnie w wieżę — wieża upadnie na wieżowce i przebije
// dolną warstwę”). W płaszczyźnie gry: WIEŻOWCE w dwóch pierścieniach (city.rings) wokół PODSTAWY WIEŻY (kawałek H-C,
// koło coreR do coreTop); pierścienie przesunięte o pół kroku — żaden strzał z zewnątrz nie dochodzi do wieży bez
// przejścia przez wieżowiec (test). Wieżowce stoją na tarasach dysku mieszkalnego (dolna warstwa: tier2 — pierścień
// wewnętrzny, tier1 — zewnętrzny), wieża na cokole trzonu (stemR, plac na floorY). TARASY SĄ WYSOKIE (2026-11-12, uwaga
// użytkownika: „trzeba przesunąć wieżowce wyżej, żeby statkiem ścinać je niżej”): wierzch tarasu leży 300–400 j. pod
// płaszczyzną gry, więc statek i pociski tną wieżowiec tuż nad podstawą, a prawie cała bryła pada. KAŻDY WIEŻOWIEC TO
// OSOBNY KAWAŁEK z własną pulą punktów (jak dawne wieżowce na pomostach): w pierwszej wersji sześć wieżowców było jednym
// kawałkiem-ćwiartką i wieżowiec zniszczony w grze stał w obrazie do pęknięcia całej ćwiartki („zostaje dach”). Nad podstawą TRZON WIEŻY (część
// techniczna, FG) — rura neckR od neckY0 do neckY1, KORONA — pierścień ringR0..ringR1 (ringY0..ringY1), głowica do
// headTop, iglice do mastTop. Wysokości K-7 (nad płaszczyzną gry ×0,42: trzon ~1,4 km, szczyt iglic ~2,3 km; wieżowce
// 0,3–0,95 km). Nazwy pól sprzed miasta zostają tam, gdzie znaczą to samo miejsce: drumR — promień miasta (krawędź
// zabudowy w płaszczyźnie gry; dawny bęben), wall — pas obrzeża (maszty), neck* — trzon wieży, ring* / head* — korona.
export const PIRATE_BASE_SPEC = Object.freeze({
  habitat: Object.freeze({
    drumR: 1640, wall: 40, coreR: 340,
    floorY: -20,
    coreTop: 640, neckR: 240, neckY0: 560, neckY1: 3500,
    ringR0: 340, ringR1: 560, ringY0: 3550, ringY1: 4080, headR: 320, headTop: 4360, mastTop: 5600,
    stemR: 560, discR: 1950, discY0: -940, discY1: -720, tier1R: 1680, tier1Y: -290, tier2R: 1120, tier2Y: -200,
    discSectors: 8
  }),
  // Wieżowce miasta: pierścień = { r — promień osi, n — liczba, a0 — kąt pierwszego, w — dłuższy bok (wzdłuż tej osi
  // układu, która jest bliżej stycznej do pierścienia), d — krótszy bok, roofY0..roofY1 — dach (los z numeru), tier — taras
  // dysku pod spodem (podstawa = jego wierzch) }. Wieżowce stoją RÓWNOLEGLE DO OSI układu (siatka miasta; ściany leżą
  // wtedy na siatce wiązanych wokseli — bez schodków), środki i boki na siatce `grid` (komórka wokseli gry). wall —
  // ściana zewnętrzna w płaszczyźnie gry, coreW — rdzeń (kotwice ciała), fgY — od tej wysokości bryły idą do FG.
  city: Object.freeze({
    rings: Object.freeze([
      Object.freeze({ r: 930, n: 12, a0: Math.PI / 8, w: 320, d: 280, roofY0: 2000, roofY1: 3100, tier: 2 }),
      Object.freeze({ r: 1350, n: 12, a0: Math.PI / 24, w: 480, d: 320, roofY0: 1400, roofY1: 2400, tier: 1 })
    ]),
    wall: 46, coreW: 120, fgY: 600, grid: 40
  }),
  pier: Object.freeze({ halfW: 85, deckY0: -40, deckY1: 200, gap: 60, pipeOff: 132, pipeY: 34, pipeR: 26 }),
  fuel: Object.freeze({ tankR: 300, tankY0: -520, tankY1: 820 }),
  warehouse: Object.freeze({ w: 1500, d: 950, wallTop: 560, roofY: 600, wall: 70 }),
  // Reaktor antygrawitacyjny na pomoście (2026-11-11, prośba użytkownika: „w miejsce wieżowców postaw struktury
  // antygrawitacyjne — reaktory trzymające bazę na orbicie”; osobne budowle, cel finału obok habitatu): w — wzdłuż
  // pomostu, d — w poprzek (stoi okrakiem nad pokładem), wall — ściana obudowy w płaszczyźnie gry, coreR — komora
  // rdzenia; wysokości K-7: dzwon emitera pod pokładem (bellR, do baseY — pole ku planetoidzie), obudowa do fgY,
  // kolumna rdzenia do topY, pierścień pola ringR na ringY, piorunochron do spireTop.
  antigrav: Object.freeze({ w: 420, d: 520, wall: 50, coreR: 150, bellR: 250, ringR: 250, baseY: -760, fgY: 600, ringY: 1150, topY: 1500, spireTop: 1900 }),
  heights: Object.freeze({ mastTop: 620 })
});

// Węzły układu (x, z) — szkielet pomostów; pomosty zaczynają się na krawędzi miasta (±drumR), długości odcinków jak
// przed miastem (cała strona gracza i cała strona zbiorników odsunięte od osi habitatu o przyrost promienia).
const HAB_R = PIRATE_BASE_SPEC.habitat.drumR;
const NODES = Object.freeze({
  Hw: [-HAB_R, 0], He: [HAB_R, 0], F: [-HAB_R - 3600, 0], A1: [-HAB_R - 3600, -4200], B1: [-HAB_R - 3600, 4200],
  E: [HAB_R + 2600, 0], N: [HAB_R + 4100, -1450], Mp: [HAB_R + 4100, -3550], P0: [HAB_R + 6100, -1450], P1: [HAB_R + 6100, -4200]
});

// Pomosty: kawałki (długie — dwa), klasy okrętów stanowisk po stronach (σ = −1 — strona −n, +1 — strona +n, gdzie
// n = kierunek pomostu obrócony o +90°), litera stanowisk, strona rury (pipe), napis.
const PIERS = Object.freeze([
  { id: 'Y-A', letter: 'A', from: 'F', to: 'A1', chunks: ['YA-1', 'YA-2'], pipe: 1, label: 'ramię A',
    sides: { '-1': ['destroyer', 'frigate', 'battleship', 'destroyer'], '1': ['frigate', 'destroyer', 'frigate', 'battleship'] } },
  { id: 'Y-B', letter: 'B', from: 'F', to: 'B1', chunks: ['YB-1', 'YB-2'], pipe: -1, label: 'ramię B',
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
// herszt — supercapital przy otwartym końcu zatoki (startuje pierwszy na alarm, wyjazd wzdłuż zatoki). Rząd do taranu
// (samouczek, 2026-10-14) = ZEWNĘTRZNA strona poprzeczki T (ramię A σ = −1, ramię B σ = +1 — ku graczowi): same okręty
// z załogą — szarża wzdłuż poprzeczki zatrzymuje ich start; w remoncie stoją po stronie habitatu.
export const PIRATE_BASE_CREWED = Object.freeze(['A-L1', 'A-L2', 'A-L3', 'A-L4', 'B-R1', 'B-R2', 'B-R3', 'B-R4', 'B-R5', 'D-R1', 'E-R1', 'H-R3']);
export const PIRATE_BASE_BOSS = 'H-L3';
// offset: oś toru od osi pomostu — Atlas (szer. 806) mija pokład pomostu (pół 85 + rękawy), a miażdży każdy okręt rzędu
// (fregata sięga 337 j. od osi, pancernik 865).
// Tor: od końca ramienia A (z rozbiegiem runUp) przez F do końca ramienia B (+ runOut), po stronie zewnętrznej.
export const PIRATE_BASE_RAM = Object.freeze({ piers: Object.freeze([['Y-A', -1], ['Y-B', 1]]), offset: 600, runUp: 900, runOut: 300 });

// Reaktory antygrawitacyjne (budowle `antigrav1`, `antigrav2`; do 2026-11-11 stały tu dwa wieżowce): pomost i miejsce
// wzdłuż niego (ułamek długości) — środki wolnych przęseł między stanowiskami (obie strony pomostu wolne: N-P s 1176–2424,
// F-P s 1432–1896), poza torem taranu i trasami startów.
export const PIRATE_BASE_ANTIGRAVS = Object.freeze([
  Object.freeze({ id: 'AG-1', structure: 'antigrav1', pier: 'N-P', at: 0.5, label: 'reaktor antygrawitacyjny wschodni' }),
  Object.freeze({ id: 'AG-2', structure: 'antigrav2', pier: 'F-P', at: 0.64, label: 'reaktor antygrawitacyjny zachodni' })
]);

const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// Los z numeru (0..1) — wysokości i detale wieżowców; stały, bo układ jest wspólny dla gry, obrazu i wokseli.
const hash01 = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

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
 *   nodes, habitat { drumR…, quadrants [{ id, a0, a1 }], bays [{ id, x, z, angle }], buildings [{ id, ring, index,
 *            quadrant, chunk (= id — osobny kawałek), quadIndex, a, r, x, z, angle, u/n (styczna / promień), w, d, wall, coreW, fgY,
 *            baseY, roofY, setbackY | null, spireTop | null, seed }] },
 *   piers [{ id, letter, ax… (pirateBaseSegment), halfW, pipe, chunks, label }],
 *   berths [{ id, index, pier, chunk, side, s, cls, length, beam, slot, x, z, angle, tapX, tapZ, bowX, bowZ,
 *            crew, boss, repair, supercap, out: { x, z } (kierunek wyjazdu rufą) }],
 *   tanks [{ id, chunk, x, z, r }], manifold, warehouse, antigravs [{ id, chunk, structure, pier, pierChunk, s, x, z, angle,
 *   u/n (osie pomostu), w, d, wall, coreR, bellR, ringR, baseY, fgY, ringY, topY, spireTop }], fuel { nodes, edges, sluices }, lights,
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

  // ---- habitat: ćwiartki miasta (E — ku +x, S — +z, W — −x, N — −z), wieżowce, hangary dronów na obrzeżu
  const q = (id, c) => ({ id, a0: c - Math.PI / 4, a1: c + Math.PI / 4 });
  const hab = {
    x: 0, z: 0, ...Hs,
    quadrants: [q('H-E', 0), q('H-S', Math.PI / 2), q('H-W', Math.PI), q('H-N', -Math.PI / 2)],
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
  // Wieżowce: prostokąt w × d równoległy do osi układu (u — oś boku w: ta oś układu, która jest bliżej stycznej do
  // pierścienia; n — prostopadła, zwrócona na zewnątrz miasta), każdy osobnym kawałkiem (chunk = id); quadrant / quadIndex
  // — dzielnica (kanał świateł drumQ, moduł powietrza). Środek na siatce
  // wokseli (bok o parzystej liczbie komórek — między węzłami, o nieparzystej — w węźle: ściany schodzą się z komórkami).
  // Podstawa na wierzchu tarasu dysku, dach z losu numeru; wyższe mają zwężenie (setbackY) i iglicę (spireTop).
  const C = S.city;
  hab.buildings = [];
  C.rings.forEach((rg, ri) => {
    for (let k = 0; k < rg.n; k++) {
      const a = rg.a0 + (k / rg.n) * TAU;
      const h = hash01(ri * 17.3 + k * 3.1 + 0.7);
      const roofY = Math.round(rg.roofY0 + (rg.roofY1 - rg.roofY0) * h);
      const quadrant = hab.quadrantAt(a);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const alongX = Math.abs(sa) >= Math.abs(ca);   // styczna bliżej osi x → bok w wzdłuż x
      const snap = (v, len) => { const n = Math.round(len / C.grid); return (Math.round(v / C.grid - (n - 1) / 2) + (n - 1) / 2) * C.grid; };
      hab.buildings.push({
        id: `B-${String(hab.buildings.length + 1).padStart(2, '0')}`, ring: ri, index: hab.buildings.length,
        quadrant, quadIndex: hab.quadrants.findIndex((e) => e.id === quadrant),
        a, r: rg.r, x: snap(ca * rg.r, alongX ? rg.w : rg.d), z: snap(sa * rg.r, alongX ? rg.d : rg.w),
        angle: alongX ? 0 : Math.PI / 2, ux: alongX ? 1 : 0, uz: alongX ? 0 : 1,
        nx: alongX ? 0 : Math.sign(ca), nz: alongX ? Math.sign(sa) : 0,
        w: rg.w, d: rg.d, wall: C.wall, coreW: C.coreW, fgY: C.fgY,
        baseY: rg.tier === 2 ? Hs.tier2Y : Hs.tier1Y, roofY,
        setbackY: h > 0.35 ? Math.round(C.fgY + (roofY - C.fgY) * 0.66) : null,
        spireTop: h > 0.6 ? roofY + 420 : null,
        seed: ri * 100 + k
      });
      hab.buildings[hab.buildings.length - 1].chunk = hab.buildings[hab.buildings.length - 1].id;
    }
  });
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

  // ---- reaktory antygrawitacyjne okrakiem nad pomostami (osie pudła: u — wzdłuż pomostu, n — w poprzek)
  const AG = S.antigrav;
  l.antigravs = PIRATE_BASE_ANTIGRAVS.map((h) => {
    const p = l.piers.find((q) => q.id === h.pier);
    const s = p.len * h.at;
    return { id: h.id, chunk: h.id, structure: h.structure, pier: p.id, pierChunk: p.chunkAt(s), label: h.label, s,
      x: p.ax + p.ux * s, z: p.az + p.uz * s, angle: p.angle, ux: p.ux, uz: p.uz, nx: p.nx, nz: p.nz, ...AG };
  });

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
    // maszt obrzeża należy do najbliższego wieżowca zewnętrznego pierścienia (pada razem z nim)
    const mx = Math.cos(a) * r, mz = Math.sin(a) * r;
    const near = hab.buildings.filter((b) => b.ring === 1).sort((p, q) => ((p.x - mx) ** 2 + (p.z - mz) ** 2) - ((q.x - mx) ** 2 + (q.z - mz) ** 2))[0];
    return mast(id, mx, mz, near.id, Math.cos(a) * (r + 1300), Math.sin(a) * (r + 1300), 1900);
  };
  l.lights = [
    mast('L-F', nodes.F.x, nodes.F.z - 140, 'NP', nodes.F.x - 900, 0, 2000),
    habMast((5 * Math.PI) / 4, 'L-H1'),
    habMast((3 * Math.PI) / 4, 'L-H2'),
    mast('L-A', nodes.A1.x + 140, nodes.A1.z + 150, 'YA-2', nodes.A1.x - 1100, nodes.A1.z + 700),
    mast('L-B', nodes.B1.x + 140, nodes.B1.z - 150, 'YB-2', nodes.B1.x - 1100, nodes.B1.z - 700),
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
  // wieżowce miasta: każdy osobnym kawałkiem (pudło z rogów prostokąta, od tarasu po iglicę)
  for (const b of hab.buildings) {
    const pts = boxPoly(b.x, b.z, b.w, b.d, b.angle);
    add(b.id, 'highrise', 'habitat', `wieżowiec ${b.id.slice(2)}`,
      { x0: Math.min(...pts.map((v) => v.x)) - 40, x1: Math.max(...pts.map((v) => v.x)) + 40, y0: b.baseY, y1: (b.spireTop || b.roofY) + 60,
        z0: Math.min(...pts.map((v) => v.z)) - 40, z1: Math.max(...pts.map((v) => v.z)) + 40 }, ['H-C'], 1.2);
  }
  add('H-C', 'core', 'habitat', 'podstawa wieży habitatu', { x0: -Hs.stemR, x1: Hs.stemR, y0: Hs.discY1, y1: Hs.coreTop, z0: -Hs.stemR, z1: Hs.stemR },
    hab.buildings.filter((b) => b.ring === 0).map((b) => b.id), 3);
  add('H-T', 'tech', 'habitat', 'wieża habitatu', { x0: -Hs.ringR1 - 200, x1: Hs.ringR1 + 200, y0: Hs.neckY0, y1: Hs.mastTop, z0: -Hs.ringR1 - 200, z1: Hs.ringR1 + 200 },
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
  // reaktory antygrawitacyjne (każdy osobną budowlą) — pudło z obrotem pomostu, piorunochron nad kolumną rdzenia
  for (const h of l.antigravs) {
    const pts = boxPoly(h.x, h.z, h.w + 160, h.d + 160, h.angle);
    add(h.chunk, 'antigrav', h.structure, h.label, { x0: Math.min(...pts.map((v) => v.x)), x1: Math.max(...pts.map((v) => v.x)), y0: h.baseY, y1: h.spireTop,
      z0: Math.min(...pts.map((v) => v.z)), z1: Math.max(...pts.map((v) => v.z)) }, [h.pierChunk], 1.6);
  }
  l.chunks = chunks;
  l.chunkById = new Map(chunks.map((c) => [c.id, c]));
  l.structures = { habitat: [], fuel: [], warehouse: [], piers: [] };
  for (const h of l.antigravs) l.structures[h.structure] = [];
  for (const c of chunks) l.structures[c.structure].push(c.id);

  // ---- bryły w płaszczyźnie gry (pociski, Hexlance, radar, przeszkody gazu): miasto — prostokąt na wieżowiec (każdy
  // swoim kawałkiem; między wieżowcami pocisk leci dalej i trafia następny pierścień), podstawa wieży — koło, reaktory —
  // prostokąty (przed pomostami: test odcinka bierze pierwszą bryłę z listy), pomosty — prostokąty, zbiorniki — koła,
  // kolektor i magazyn — prostokąty
  const hits = [];
  for (const b of hab.buildings) hits.push({ id: `hit-${b.id}`, chunk: b.chunk, poly: boxPoly(b.x, b.z, b.w, b.d, b.angle) });
  hits.push({ id: 'hit-H-C', chunk: 'H-C', poly: circlePoly(0, 0, Hs.coreR, 16) });
  for (const h of l.antigravs) hits.push({ id: `hit-${h.chunk}`, chunk: h.chunk, poly: boxPoly(h.x, h.z, h.w, h.d, h.angle) });
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

  // ---- taran samouczka: wzdłuż zewnętrznej strony poprzeczki T (od końca ramienia A do końca ramienia B), w połowie
  // długości okrętów
  const RAM = PIRATE_BASE_RAM;
  const [[pa, sa], [pb, sb]] = RAM.piers;
  const ramA = l.piers.find((p) => p.id === pa);
  const ramB = l.piers.find((p) => p.id === pb);
  l.ram = {
    pier: ramA.id, side: sa, piers: RAM.piers,
    start: { x: ramA.bx + ramA.ux * RAM.runUp + ramA.nx * sa * RAM.offset, z: ramA.bz + ramA.uz * RAM.runUp + ramA.nz * sa * RAM.offset },
    end: { x: ramB.bx + ramB.ux * RAM.runOut + ramB.nx * sb * RAM.offset, z: ramB.bz + ramB.uz * RAM.runOut + ramB.nz * sb * RAM.offset },
    berths: l.berths.filter((b) => RAM.piers.some(([id, side]) => b.pier === id && b.side === side)).map((b) => b.id)
  };
  l.ram.dir = Math.atan2(l.ram.end.z - l.ram.start.z, l.ram.end.x - l.ram.start.x);
  // przedpole poprzeczki T (środek między końcami ramion, przed nią) — tam celuje podejście
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
