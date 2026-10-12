// src/3d/hallGas3d/hallGas3dLayout.js
//
// GAZ I PYŁ HALI K-7 v2 (prawdziwa wolumetria, docs/BRIEF-gaz-hali-3d.md, plan docs/PLAN-3d-gaz.md, demo dema/3d-gaz.html) —
// część CZYSTA: bez three, DOM i Core3D (testy node). Domena siatki 3D hali, wysokości K-7, wokselizacja przeszkód (udział
// zajętości komórki z 64 próbek), pole odległości 3D, wzór startowy kurzu na pokładzie, układ wejścia klatki (blok dachu),
// rekordy strumieni i LUSTRA CPU formuł kerneli (hallGas3dGrid.js — zmiana wzoru w kernelu = zmiana tutaj).
//
// Układ hali (createK7Layout): x w poprzek (±halfWidth), z w głąb — od ściany tylnej (backZ) do bramy G-01 (frontZ),
// y = wysokość K-7 nad pokładem (kadłub 48–116, lot 76, dach 711). SIATKA: komórka sześcienna h [j.]; osie tekstur 3D:
// x tekstury = x hali (nx), y tekstury = z hali — głąb (nd), z tekstury = wysokość (nh warstw od pokładu). Prędkości
// w komórkach/s: (vx — x hali, vd — z hali, vy — w górę). Domena = obrys hali z zapasem przy ścianach, pas PRÓŻNI za
// bramą (gaz, który wyleci, ginie — brief § 13 pkt 5) i warstwa nad dachem (wypływ przez otwarty dach).
import {
  createK7Layout, k7SolidList, K7_HEIGHTS, K7_ABOVE_SCALE, K7_FUEL_STATION
} from '../haloRing/haloPortK7Layout.js';
import { HALL_DUST_IN, HALL_DUST_MASK, HALL_DUST_SHIP, hallMaskBit } from '../gasField/hallDustLayout.js';

/** Siatka domyślna (decyzja brief § 13 pkt 1, pomiar E0 — docs/PLAN-3d-gaz.md). */
export const HALL_GAS3D_GRID = Object.freeze({
  cell: 56,        // bok komórki [j.] — pomiar E0 (docs/PLAN-3d-gaz.md): 48 j. — szkielet 0,52 ms, 56 j. — 0,37 ms, 64 j. — 0,27 ms
  margin: 320,     // zapas domeny za ścianami bocznymi i tylną [j.] (przypory na zewnątrz ścian: 59 + 75 j.)
  vacuum: 1700,    // pas próżni za bramą G-01 [j.] (fartuch 1180 j.)
  top: 768,        // wysokość domeny [j.] (zaokrąglana w górę do całych komórek): dach 711–793
  roofY: 720       // strop powietrza hali [j.] (hala: height 720) — komórki wyżej to dach (zamknięty) albo otwór (próżnia)
});

/** Wysokości K-7 w gazie: płyta kadłuba 48–116, lot 76 (dysze MAIN i SIDE). */
export const HALL_GAS3D_HULL = Object.freeze({ y0: K7_HEIGHTS.hullBottom, y1: K7_HEIGHTS.hullTop, flightY: K7_HEIGHTS.flightY });

/** Dach (spód płyty: haloPortK7Build — plate(footprint, 711, 82)) i otwory bram (nadproże G-01 od 600 j. wzwyż). */
export const HALL_GAS3D_ROOF = Object.freeze({ y0: 711 });
export const HALL_GAS3D_GATE = Object.freeze({ openY: 600 });

/** Wysokości źródeł gazu hali (hallGasSources.js nie zna wysokości): szpule, zawory magazynów, nawiewy. */
export const HALL_GAS3D_SOURCE_Y = Object.freeze({ reel: K7_FUEL_STATION.reel.y, wall: 100, fan: 360 });

/**
 * Domena siatki 3D w układzie hali dla komórki `cell` [j.]: wymiary nx × nd × nh (x, głąb, wysokość), róg (x0, z0),
 * rozmiar w × d × top [j.], liczba komórek i dispatch compute (wielokrotność 64 — grupy robocze; kernele mają strażnika
 * zakresu). nx i nd — wielokrotności 8; pole pokładu 2× drobniejsze (deckNx × deckNd).
 */
export function hallGas3dDomain(layout = createK7Layout(), cell = HALL_GAS3D_GRID.cell, grid = HALL_GAS3D_GRID) {
  const h = cell;
  const xMin = -layout.halfWidth - grid.margin;
  const xMax = layout.halfWidth + grid.margin;
  const zMin = layout.backZ - layout.wallThickness * 0.5 - grid.margin;
  const zMax = layout.frontZ + grid.vacuum;
  const nx = Math.ceil((xMax - xMin) / h / 8) * 8;
  const nd = Math.ceil((zMax - zMin) / h / 8) * 8;
  const nh = Math.ceil(grid.top / h);
  const w = nx * h;
  const d = nd * h;
  const x0 = (xMin + xMax) * 0.5 - w * 0.5;
  const z0 = zMin;
  const cells = nx * nd * nh;
  return Object.freeze({
    h, nx, nd, nh, x0, z0, w, d, top: nh * h, x1: x0 + w, z1: z0 + d, cells,
    dispatch: Math.ceil(cells / 64) * 64,
    deckNx: nx * 2, deckNd: nd * 2, deckCells: nx * nd * 4,
    roofY: grid.roofY
  });
}

/** Wysokość K-7 → z sceny (lustro haloPortK7Layout.k7HeightToZ — pod szczytem kadłuba 1:1, wyżej × K7_ABOVE_SCALE). */
export function hallGas3dHeightToZ(y) {
  const d = y - K7_HEIGHTS.hullTop;
  return d > 0 ? d * K7_ABOVE_SCALE : d;
}

/** z sceny → wysokość K-7 (odwrotność hallGas3dHeightToZ). */
export function hallGas3dZToHeight(z) {
  return z <= 0 ? z + K7_HEIGHTS.hullTop : K7_HEIGHTS.hullTop + z / K7_ABOVE_SCALE;
}

/** Pamięć GPU siatki [B]: tekstury 3D RGBA16F (8 B / komórkę) × `tex3`, statyczna RGBA8, bufory f32 / u32, pokład. */
export function hallGas3dMemory(dom, { tex3 = 8, statTex = 1, buf = 4, deckTex = 2 } = {}) {
  return dom.cells * 8 * tex3 + dom.cells * 4 * statTex + dom.cells * 4 * buf + dom.deckCells * 8 * deckTex;
}

// ---------------------------------------------------------------------------------------------------------------
// WEJŚCIE KLATKI: nadzbiór HALL_DUST_IN (szew gra ↔ render — src/game/hallDustInput.js, bez zmian układu) + blok DACHU
// (fizyczny otwór: ułamek otwarcia i prostokąt w układzie hali) i wersja bloku. Pakuje src/game/hallGas3dInput.js.

/** Wersja bloku rozszerzenia (0 w tablicy = brak bloku — dach zamknięty). */
export const HALL_GAS3D_IN_VERSION = 1;

export const HALL_GAS3D_IN = Object.freeze({
  ...HALL_DUST_IN,
  roofOpen: HALL_DUST_IN.size,          // ułamek otwarcia dachu w prostokącie otworu (0 — zamknięty)
  roofX0: HALL_DUST_IN.size + 1,        // prostokąt otworu w układzie hali [j.]
  roofZ0: HALL_DUST_IN.size + 2,
  roofX1: HALL_DUST_IN.size + 3,
  roofZ1: HALL_DUST_IN.size + 4,
  version: HALL_DUST_IN.size + 5,       // HALL_GAS3D_IN_VERSION
  roofView: HALL_DUST_IN.size + 6,      // krycie dachu w OBRAZIE (K7RoofFade: 1 − fade) — gaz nad halą pod kryjącym dachem znika
  size: HALL_DUST_IN.size + 7
});

/**
 * STROJENIE FIZYKI (jednostki świata: j., j/s, 1/s; na komórki przelicza HallGas3dGrid.syncTune — zmiana komórki
 * nie wymaga przestrajania). Wartości startowe z pola 2D po audycie 2026-10-12 (gasField2D: opór, dyfuzja, progi
 * podrywania), reszta (wypór, ciężka para, opadanie, tarcie) — pomiar E1 (docs/PLAN-3d-gaz.md).
 */
export function createHallGas3dTune() {
  return {
    enabled: true,
    solver: 'sor',         // rzut ciśnienia: 'sor' (red-black SOR w miejscu) albo 'jacobi' (wybór przy budowie siatki)
    sorIters: 14,          // iteracje SOR (po dwa dispatche: czerwone, czarne — koszt jak 28 iteracji Jacobiego)
    sor: 1.7,              // ω nadrelaksacji
    velMacCormack: 1,      // udział korekcji MacCormacka prędkości (1 — pełny 2. rząd; 0 — semi-Lagrange)
    edgePush: 1.0,         // efekt przypowierzchniowy: wypływ spod płyty kadłuba w ruchu przez obrys = edgePush × prędkość
                           //   kadłuba (ciśnienie spiętrzenia ½ρv² daje wypływ najwyżej ~v)
    gapSourceMax: 20,      // sufit źródła szczeliny [1/s] (małe kadłuby: obwód / pole duże)
    gapLead: 0,            // przesunięcie źródła szczeliny ku krawędzi natarcia: × (1 + gapLead · l_x · znak ruchu)
    edgeRate: 12,          // tempo wleczenia w szczelinie [1/s] (tarcie pokładu i płyty — cel: ½ · v kadłuba)
    biharmonic: 1 / 300,   // filtr biharmoniczny prędkości (na krok 1/60 s): bez niego przy pełnym MacCormacku mod 2Δ
                           //   (niewidoczny dla dywergencji centralnej) rozkręcał energię po zgaszeniu dysz; stabilny do 1/150
    jacobi: 27,            // iteracje Jacobiego (solver 'jacobi'; nieparzyste — wynik w pB)
    warm: 0.9,             // rozgrzanie ciśnienia wynikiem poprzedniego kroku
    maxDt: 1 / 30,         // sufit kroku [s] (semi-Lagrange stabilna; jeden krok na klatkę)
    drag: 0.2,             // opór gazu [1/s]
    dragQuad: 1.43e-4,     // opór szybkiego frontu [1/j.] × |v| poza stożkami (2D: 0,004 na komórkę 28 j.)
    dragFrontLo: 600,      // pasmo prędkości frontu [j/s]
    dragFrontHi: 1500,
    vorticity: 12,         // wzmacnianie wirów ε [j.] (bez przy przeszkodach; 45 j. — energia rosła po zgaszeniu dysz)
    turbulence: 40,        // turbulencja z szumu [j/s²] w pyle, parze, spalinach … (200 — równowaga z oporem ~1000 j/s)
    turbShear: 0.15,       // … i w czystym gazie przy ścinaniu: waga |ω| [s]
    turbScale: 1 / 560,    // częstotliwość szumu turbulencji [1/j.]
    dustDiff: 700,         // dyfuzja pyłu i pary [j²/s] (strumienie symetryczne — zachowawcza)
    eddyDiff: 470,         // dyfuzja wirowa [j²] × |ω| (na ścianę komórki najwyżej 1/12 w kroku)
    maxSpeed: 4200,        // sufit prędkości gazu [j/s]
    buoyancy: 900,         // wypór gorących spalin [j/s² na jednostkę temperatury]
    vaporWeight: 3000,     // ciężar zimnej pary [j/s² na jednostkę pary], LINIOWO (gęsta przy złączce spływa z płyty po burtach;
                           //   ślad pary c ≤ 0,05 — prąd przy pokładzie √(g'·h) < 120 j/s, nie podrywa kurzu)
    vaporSettle: 80,       // OPADANIE pary kriogenicznej [j/s] — stała osobna od pyłu (dryf w dół, zalega przy pokładzie)
    dustWeight: 0,         // ciężar zapylonego powietrza [j/s² na jednostkę pyłu]
    cooling: 0.35,         // stygnięcie spalin [1/s]
    vaporDecay: 0.06,      // rozpływanie się pary w hali [1/s]
    exhaustDecay: 0.06,    // zanik spalin w hali [1/s] (mieszają się z powietrzem)
    vacuumDecay: 0.7,      // zanik pyłu w próżni (za bramą, nad otwartym dachem) [1/s]
    vaporVacuum: 0.9,
    exhaustVacuum: 0.9,
    tempVacuum: 2,
    friction: 0,           // tarcie liniowe przy pokładzie i płycie kadłuba [1/s] (pozioma prędkość ku prędkości ściany)
    wallCd: 0.01,          // PRAWO ŚCIANY: τ/ρ = Cd·|Δv|² (log: (κ / ln(28 j. / z0))² ≈ 0,01) — tempo Cd·|Δv| / h, przy 300 j/s
                           //   ~0,05/s (dawne 2,5/s liniowo gasiło strumienie przyścienne i wypływ spod kadłuba w ~1 s)
    porousDrag: 2,         // opór w komórce częściowo zajętej [1/s × zajętość]
    settleSpeed: 32,       // prędkość opadania pyłu [j/s] w spokojnym powietrzu
    settleMin: 0.3,        // opadanie przy szybkim przepływie (≥ settleHi): ułamek pełnego — nigdy 0
    settleLo: 70,          // [j/s]
    settleHi: 320,
    liftLo: 120,           // podrywanie kurzu z pokładu: prędkość dolnej warstwy (28 j. nad pokładem) [j/s] od …
    liftHi: 600,           // … do pełnego (2D: 150 / 650 dla prędkości uśrednionej w pionie)
    liftRate: 0.09,        // strumień erozji pokładu przy pełnym podrywaniu [depozytu / s] (do wyczerpania kurzu komórki)
    deckMass: 0.6,         // masa pełnej komórki pokładu (h/2)² w jednostkach pyłu komórki 3D (4 komórki pokładu pod komórką)
    hazeAir: 0,            // pył w powietrzu po wyczyszczeniu (przy pokładzie; maleje z wysokością) — E1: 0 (bilans pokładu)
    hazeH: 220,            // [j.]
    // strumienie dysz MAIN (każda dysza osobno — lista płaska EngineFrame)
    jetSpeed: 2600,        // prędkość u wylotu przy pełnym ciągu [j/s]
    jetLength: 2800,       // zasięg [j.] (× 0,6 + 0,4 · moc)
    jetWiden: 0.05,        // rozszerzanie stożka dyszy W PIONIE [na jedn. długości] — struga przy pokładzie (strumień
                           //   przyścienny: pół-wysokość ~0,05·x; struga okrągła w wolnej przestrzeni ~0,1·x)
    jetWidenLat: 0.3,      // rozszerzanie NA BOKI (strumień przyścienny 3D: ~0,3·x — Launder, Rodi 1983; Abrahamsson 1997)
    jetMinW: 1.2,          // szerokość stożka u nasady ≥ tyle komórek (dysza r 34 j. < komórka 56 j. — rozdzielczość)
    jetCore: 12,           // rdzeń strugi = jetCore × promień dyszy (≈ 6 średnic), dalej prędkość ∝ 1/x
    jetRate: 16,           // narzucanie prędkości w stożku [1/s]
    jetFlow: 2.5,          // wydatek objętości = jetFlow × moc × strumień ROZDZIELONEGO stożka u wylotu (v · π w0² / k) —
                           //   rdzeń strugi to spaliny (1 × — parcel w źródle dostaje 63 % nowego gazu, 2,5 × — 92 %)
    jetSourceLen: 320,     // zasięg źródła objętości od wylotu [j.]
    jetClean: 6,           // rozrzedzanie pyłu i pary w stożku dyszy [1/s] × profil (rdzeń strugi czysty — jak pole 2D)
    jetTemp: 1,            // temperatura spalin (zimny gaz zapłonu: 0)
    minPower: 0.2,         // moc dysz, od której dmuchają
    // dysze SIDE (impulsy manewrowe — SideNozzleFrame)
    sideSpeed: 1100,
    sideLength: 520,
    sideWiden: 0.1,        // dysze SIDE (też przy pokładzie): pion
    sideWidenLat: 0.3,     //   i boki
    sideRate: 14,
    sideFlow: 1.5,         // wydatek × ciąg × strumień stożka u wylotu (jak jetFlow)
    sideMin: 0.12,         // ciąg, od którego dysza SIDE dmucha
    // źródła hali (hallGasSources.js): wydatek objętości pary [j³/s na jednostkę pary/s]
    vaporFlow: 160000,
    vaporGain: 0.15,       // gęstość pary 3D na jednostkę tempa źródeł hali (tempa z pola 2D — komórka 28 j., inna objętość)
    sourceRate: 1          // mnożnik tempa narzucania prędkości źródeł hali
  };
}

// ---------------------------------------------------------------------------------------------------------------
// WOKSELIZACJA PRZESZKÓD

/**
 * Bryły hali dla gazu: k7SolidList (te same co kolizje i rastr pyłu 2D) z zakresami wysokości y0..y1; ściany sięgają
 * stropu (wyżej — do szczytu domeny: hala zamknięta, nad ścianami nie ma szczeliny do próżni), nad otworami bram nadproże
 * (od HALL_GAS3D_GATE.openY), słupki paliwowe stanowisk capital (cokół z kolumną do barku ramienia — buildK7Collision).
 * Człony ramion SCARA (cienkie, 300–330 j.) pominięte (brief § 3).
 */
export function hallGas3dSolids(layout = createK7Layout(), top = 1e9) {
  const out = [];
  for (const s of k7SolidList(layout)) {
    const wall = s.id.startsWith('WALL-');
    out.push({ id: s.id, x: s.x, z: s.z, w: s.w, d: s.d, angle: s.angle || 0, y0: wall ? 0 : s.y - s.h / 2, y1: wall ? top : s.y + s.h / 2 });
  }
  for (const g of layout.gates) {
    out.push({ id: `LINTEL ${g.id}`, x: g.x, z: g.z, w: g.clearWidth + 4, d: layout.wallThickness, angle: g.angle, y0: HALL_GAS3D_GATE.openY, y1: top });
  }
  const P = K7_FUEL_STATION.plinth;
  for (const b of layout.berths) {
    if (b.size !== 'CAPITAL') continue;
    for (const a of b.serviceAnchors) out.push({ id: `FUEL PEDESTAL ${b.id}/${a.side}`, x: a.x, z: a.z, w: P.w, d: P.d, angle: 0, y0: 0, y1: K7_FUEL_STATION.shoulder.y1 });
  }
  return out;
}

export function hallGas3dInsidePolygon(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function popcount32(v) {
  v -= (v >>> 1) & 0x55555555;
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Udział zajętości (0..1) z masek próbek komórki: 4 × 4 próbki w (x, z) × 4 w pionie = 64 bity (lo — warstwy 0, 1). */
export function hallGas3dMaskFraction(lo, hi) {
  return (popcount32(lo >>> 0) + popcount32(hi >>> 0)) / 64;
}

const SQ2 = Math.SQRT2;
const SQ3 = Math.sqrt(3);

/**
 * Rastr statyczny siatki (RGBA8, kolejność tekstury 3D: x najszybciej, potem głąb, potem wysokość):
 *   R — udział zajętości przez bryły (64 próbki: 4 × 4 w poziomie × 4 w pionie; suma brył = suma zbiorów próbek),
 *   G — powietrze hali (środek komórki w obrysie hali i pod stropem roofY) — poza nim próżnia (gaz ginie),
 *   B — odległość od komórki stałej (zajętość ≥ 0,5) [komórki × 4, do 255] — marsz zasłaniania dysz,
 *   A — kolumna w obrysie hali (dla dachu: otwór i zamknięcie liczy kernel zajętości).
 * Deterministyczny, bez Math.random. Zwraca też liczniki (komórki stałe, powietrze).
 */
export function rasterizeHallGas3d(layout = createK7Layout(), dom = hallGas3dDomain(layout)) {
  const { nx, nd, nh, h, x0, z0, cells } = dom;
  const lo = new Uint32Array(cells);
  const hi = new Uint32Array(cells);
  const xzMask = new Uint32Array(Math.max(1, nx * nd));
  for (const s of hallGas3dSolids(layout, dom.top + h)) {
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    const hw = s.w * 0.5, hd = s.d * 0.5;
    const r = Math.hypot(hw, hd);
    const i0 = Math.max(0, Math.floor((s.x - r - x0) / h)), i1 = Math.min(nx - 1, Math.floor((s.x + r - x0) / h));
    const j0 = Math.max(0, Math.floor((s.z - r - z0) / h)), j1 = Math.min(nd - 1, Math.floor((s.z + r - z0) / h));
    if (i1 < i0 || j1 < j0) continue;
    const k0 = Math.max(0, Math.floor(s.y0 / h)), k1 = Math.min(nh - 1, Math.ceil(s.y1 / h) - 1);
    if (k1 < k0) continue;
    // maski (x, z) brył w jej pudle — raz, potem po warstwach
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let m = 0;
        for (let iz = 0; iz < 4; iz++) {
          const zs = z0 + (j + (iz + 0.5) / 4) * h - s.z;
          for (let ix = 0; ix < 4; ix++) {
            const xs = x0 + (i + (ix + 0.5) / 4) * h - s.x;
            const u = xs * ca + zs * sa;
            const v = -xs * sa + zs * ca;
            if (u <= hw && u >= -hw && v <= hd && v >= -hd) m |= 1 << (iz * 4 + ix);
          }
        }
        xzMask[j * nx + i] = m;
      }
    }
    for (let k = k0; k <= k1; k++) {
      let ym = 0;
      for (let iy = 0; iy < 4; iy++) {
        const ys = (k + (iy + 0.5) / 4) * h;
        if (ys >= s.y0 && ys <= s.y1) ym |= 1 << iy;
      }
      if (!ym) continue;
      for (let j = j0; j <= j1; j++) {
        const row = k * nx * nd + j * nx;
        for (let i = i0; i <= i1; i++) {
          const m = xzMask[j * nx + i];
          if (!m) continue;
          const c = row + i;
          if (ym & 1) lo[c] |= m;
          if (ym & 2) lo[c] |= m << 16;
          if (ym & 4) hi[c] |= m;
          if (ym & 8) hi[c] |= m << 16;
        }
      }
    }
  }
  // udział zajętości i komórki stałe
  const occ = new Float32Array(cells);
  const solid = new Uint8Array(cells);
  let solidN = 0;
  for (let c = 0; c < cells; c++) {
    const f = hallGas3dMaskFraction(lo[c], hi[c]);
    occ[c] = f;
    if (f >= 0.5) { solid[c] = 1; solidN++; }
  }
  // pole odległości (fazowane 1 / √2 / √3, dwa przebiegi) [komórki]
  const dist = new Float32Array(cells);
  const BIG = 1e6;
  for (let c = 0; c < cells; c++) dist[c] = solid[c] ? 0 : BIG;
  const sx = 1, sy = nx, sz = nx * nd;
  const pass = (forward) => {
    const kA = forward ? 0 : nh - 1, kB = forward ? nh : -1, st = forward ? 1 : -1;
    const sgn = forward ? -1 : 1;
    for (let k = kA; k !== kB; k += st) {
      for (let j = forward ? 0 : nd - 1; forward ? j < nd : j >= 0; j += st) {
        for (let i = forward ? 0 : nx - 1; forward ? i < nx : i >= 0; i += st) {
          const c = k * sz + j * sy + i;
          let d = dist[c];
          if (d === 0) continue;
          // sąsiedzi „przed” komórką w kolejności przebiegu: ta sama warstwa i wiersz (i − 1), wiersz poprzedni (3), warstwa
          // poprzednia (9)
          const ii = i + sgn, jj = j + sgn, kk = k + sgn;
          const okI = ii >= 0 && ii < nx, okJ = jj >= 0 && jj < nd, okK = kk >= 0 && kk < nh;
          if (okI) d = Math.min(d, dist[c + sgn * sx] + 1);
          if (okJ) {
            for (let di = -1; di <= 1; di++) {
              const i2 = i + di;
              if (i2 < 0 || i2 >= nx) continue;
              d = Math.min(d, dist[c + sgn * sy + di] + (di ? SQ2 : 1));
            }
          }
          if (okK) {
            for (let dj = -1; dj <= 1; dj++) {
              const j2 = j + dj;
              if (j2 < 0 || j2 >= nd) continue;
              for (let di = -1; di <= 1; di++) {
                const i2 = i + di;
                if (i2 < 0 || i2 >= nx) continue;
                const n = (di ? 1 : 0) + (dj ? 1 : 0);
                d = Math.min(d, dist[c + sgn * sz + dj * sy + di] + (n === 0 ? 1 : n === 1 ? SQ2 : SQ3));
              }
            }
          }
          dist[c] = d;
        }
      }
    }
  };
  pass(true);
  pass(false);
  // powietrze hali i kolumny w obrysie
  const poly = layout.footprint;
  const colIn = new Uint8Array(nx * nd);
  for (let j = 0; j < nd; j++) {
    const z = z0 + (j + 0.5) * h;
    for (let i = 0; i < nx; i++) colIn[j * nx + i] = hallGas3dInsidePolygon(poly, x0 + (i + 0.5) * h, z) ? 1 : 0;
  }
  const data = new Uint8Array(cells * 4);
  let airN = 0;
  for (let k = 0; k < nh; k++) {
    const below = (k + 0.5) * h < dom.roofY;
    for (let j = 0; j < nd; j++) {
      for (let i = 0; i < nx; i++) {
        const c = k * sz + j * sy + i;
        const col = colIn[j * nx + i];
        const air = col && below;
        const o = c * 4;
        data[o] = Math.round(occ[c] * 255);
        data[o + 1] = air ? 255 : 0;
        data[o + 2] = Math.min(255, Math.round(dist[c] * 4));
        data[o + 3] = col ? 255 : 0;
        if (air && !solid[c]) airN++;
      }
    }
  }
  return { data, solid: solidN, air: airN, occ, dist };
}

// ---------------------------------------------------------------------------------------------------------------
// KURZ NA POKŁADZIE: wzór startowy (deckNx × deckNd, komórka h / 2) — jak rastr pyłu 2D (hallDustLayout): kłęby fBm ~900 j.,
// drobny szum, więcej przy ścianach i w kątach; zero pod bryłami stojącymi na pokładzie i poza obrysem hali.

function hash2(ix, iy, seed) {
  let v = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  v ^= v >>> 16;
  return (v >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed), c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, seed) {
  let sum = 0, amp = 0.5, norm = 0, f = 1;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * f, y * f, seed + o * 131);
    norm += amp;
    f *= 2.07;
    amp *= 0.5;
  }
  return sum / norm;
}

function segDist(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}

/**
 * Wzór startowy kurzu na pokładzie: Float32Array deckNx × deckNd (masa kurzu na komórkę pokładu, 0..1). `raster` —
 * rasterizeHallGas3d (komórki stałe warstwy 0 — pod nimi bez kurzu).
 */
export function hallGas3dDeckStart(layout, dom, raster, { seed = 0x5eed7 } = {}) {
  const { deckNx, deckNd, nx, h, x0, z0 } = dom;
  const out = new Float32Array(deckNx * deckNd);
  const poly = layout.footprint;
  const edges = poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);
  const hd = h * 0.5;
  for (let b = 0; b < deckNd; b++) {
    const z = z0 + (b + 0.5) * hd;
    for (let a = 0; a < deckNx; a++) {
      const x = x0 + (a + 0.5) * hd;
      if (!hallGas3dInsidePolygon(poly, x, z)) continue;
      const ci = a >> 1, cj = b >> 1;
      if (raster.occ[cj * nx + ci] >= 0.5) continue;   // pod bryłą stojącą na pokładzie
      // przy ścianach, bryłach i w kątach kurzu przybywa (sprzątanie nie sięga): odległość od brył warstwy 0 i od obrysu
      let dEdge = Infinity;
      for (const [p, q] of edges) dEdge = Math.min(dEdge, segDist(x, z, p, q));
      const dSolid = raster.dist[cj * nx + ci] * h;
      const big = fbm(x / 900, z / 900, seed);
      const fine = valueNoise(x / 260, z / 260, seed + 7);
      const near = Math.exp(-Math.min(dEdge, dSolid) / 520);
      const s = big * big * (3 - 2 * big);
      out[b * deckNx + a] = Math.min(1, Math.max(0, (0.22 + 0.78 * s) * (0.5 + 0.5 * near) * (0.75 + 0.5 * fine)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// REKORDY STRUMIENI (bufor storage vec4 — hallGas3dGrid): dysze MAIN (każda dysza osobno), dysze SIDE, źródła gazu hali.
// Jednostki: komórki domeny i sekundy (pakowanie przelicza świat [j.] → komórki).
//   A — wierzchołek / środek (x, głąb, wysokość), rodzaj (0 — stożek, 1 — buch promieniowy)
//   B — stożek: oś (jednostkowa, 3D), długość L; buch: przesunięcie szumu płatów (ox, oy), —, zasięg R
//   C — stożek: promień u nasady w0, rozszerzanie, prędkość, tempo narzucania [1/s]; buch: promień obwodu r0, —, prędkość, tempo
//   D — wydatek objętości na komórkę przy profilu 1 [1/s], zasięg źródła objętości Ls, zasłanianie (1 — tak), rozrzedzanie spalinami [1/s]
//   E — wstrzykiwanie [jedn./s przy profilu 1]: pył, para, spaliny, temperatura
//   MIN, MAX — pudło (komórki) — szybkie odrzucenie w kernelu; MIN.w — stożek: rozszerzanie NA BOKI (przekrój eliptyczny;
//              = rozszerzanie C.y — okrągły)

export const HALL_GAS3D_JET = Object.freeze({ stride: 28, A: 0, B: 4, C: 8, D: 12, E: 16, MIN: 20, MAX: 24 });
/** Profil Gaussa w poprzek stożka: exp(−JET_K · (ρ / w)²); obcięcie pudła przy ρ = JET_CUT · w (profil < 1e-4). */
export const HALL_GAS3D_JET_K = 2.2;
/**
 * Źródło objętości stożka: profil HALL_GAS3D_SRC_WIDE × szerszy niż pęd (1 — ten sam: rdzeń strugi = spaliny od wylotu;
 * 2 — gładsze ciśnienie przy dywergencji centralnej, zbędne od transportu po prędkościach ścian).
 */
export const HALL_GAS3D_SRC_WIDE = 1;
const JET_CUT = 2.1;

const smoothCpu = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * LUSTRO CPU profilu stożka (kernel reakcji): along [komórki] wzdłuż osi, aH² / aV² — kwadraty odległości od osi na boki
 * i w pionie (n_v = ẑ − (ẑ·b)·b); L, w0, widen (pion), widenLat (boki; domyślnie = widen — przekrój okrągły). Pół-szerokości
 * rosną z odległością, koniec wygaszany w drugiej połowie, nasada od −w0.
 */
export function hallGas3dConeProfileCpu(along, aH2, aV2, L, w0, widen, widenLat = widen) {
  if (!(along > -w0 && along < L)) return 0;
  const wv = w0 + Math.max(along, 0) * widen;
  const wh = w0 + Math.max(along, 0) * widenLat;
  return Math.exp(-HALL_GAS3D_JET_K * (aH2 / (wh * wh) + aV2 / (wv * wv))) * (1 - smoothCpu(0.5 * L, L, along)) * smoothCpu(-w0, 0, along);
}

/** LUSTRO CPU wagi źródła objętości wzdłuż osi stożka: od wylotu (along ≈ 0) do Ls, wygaszona w drugiej połowie. */
export function hallGas3dSourceAlongCpu(along, Ls) {
  return smoothCpu(-1, 2, along) * (1 - smoothCpu(0.5 * Ls, Ls, along));
}

/**
 * LUSTRO CPU prędkości narzucanej na osi stożka: struga okrągła (core > 0 — długość rdzenia potencjalnego ≈ 6 średnic
 * dyszy [kom.]: pełna prędkość w rdzeniu, dalej ∝ core / x, nie mniej niż 0,2) albo stożek źródeł hali (core 0:
 * prędkość × w0 / szerokość, nie mniej niż 0,25).
 */
export function hallGas3dConeSpeedCpu(speed, w0, width, along = 0, core = 0) {
  if (core > 0) return speed * Math.min(1, Math.max(0.2, core / Math.max(along, 1e-3)));
  return speed * Math.max(0.25, w0 / Math.max(width, 1e-6));
}

/**
 * Całka profilu źródła objętości stożka po objętości [komórki³]: ∫ prof · waga źródła dV (wzdłuż — 64 punkty środkowe, w
 * poprzek — analitycznie: ∫∫ exp(−k (h²/w_h² + v²/w_v²)) dh dv = π w_h w_v / k). Wydatek na komórkę = wydatek strumienia /
 * całka — suma celu dywergencji po komórkach = zadany wydatek (tests/hallGas3d.test.mjs; przekrój ucięty pokładem — mniej).
 */
export function hallGas3dSourceIntegralCpu(L, w0, widen, Ls, widenLat = widen) {
  const SW = HALL_GAS3D_SRC_WIDE;
  const a0 = -w0 * SW;
  const a1 = Math.min(L, Ls);
  if (!(a1 > a0)) return 0;
  const n = 64;
  const da = (a1 - a0) / n;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i + 0.5) * da;
    const wv = w0 + Math.max(a, 0) * widen;
    const wh = w0 + Math.max(a, 0) * widenLat;
    s += (Math.PI * SW * SW * wh * wv / HALL_GAS3D_JET_K) * (1 - smoothCpu(0.5 * L, L, a)) * smoothCpu(-w0 * SW, 0, a) * hallGas3dSourceAlongCpu(a, Ls);
  }
  return s * da;
}

/**
 * Stożek do bufora rekordów `J` (Float32Array) pod indeksem `n`. Świat (układ hali [j.], wysokość K-7) → komórki domeny.
 * o: { x, z, y — wylot; dx, dz, dy — kierunek (dowolna długość); len, w0, widen (pion) i widenLat (boki; brak — jak widen)
 *      [na jedn. długości], speed [j/s], rate [1/s], flow [j³/s] (wydatek objętości), srcLen [j.], occlude (bool), core [j.],
 *      dust, vapor, exhaust, temp [jedn./s] }.
 * Zwraca n + 1 (albo n, gdy rekord pusty).
 */
export function hallGas3dWriteCone(J, n, dom, o) {
  const h = dom.h;
  const R = HALL_GAS3D_JET;
  const b = n * R.stride;
  const ax = (o.x - dom.x0) / h, ay = (o.z - dom.z0) / h, az = o.y / h;
  let dx = o.dx, dy = o.dz, dz = o.dy || 0;
  const l = Math.hypot(dx, dy, dz);
  if (!(l > 1e-9) || !(o.len > 0)) return n;
  dx /= l; dy /= l; dz /= l;
  // oś prawie pionowa (kernel: |n_v| = √(1 − b_z²) < 0,2) — cały przekrój rozszerza się jak „na boki”
  const widen = Math.sqrt(Math.max(0, 1 - dz * dz)) < 0.2 ? widenLat : (o.widen || 0);
  const L = o.len / h;
  const w0 = Math.max(o.w0 / h, o.minW0 || 0.75);
  const widenLat = o.widenLat > 0 ? o.widenLat : (o.widen || 0);
  const speed = (o.speed || 0) / h;
  const Ls = Math.max(0.5, (o.srcLen || 0) / h);
  let q = 0;
  if (o.flow > 0) {
    const integ = hallGas3dSourceIntegralCpu(L, w0, widen, Ls, widenLat);
    q = integ > 0 ? (o.flow / (h * h * h)) / integ : 0;
  }
  J[b + R.A] = ax; J[b + R.A + 1] = ay; J[b + R.A + 2] = az; J[b + R.A + 3] = 0;
  J[b + R.B] = dx; J[b + R.B + 1] = dy; J[b + R.B + 2] = dz; J[b + R.B + 3] = L;
  J[b + R.C] = w0; J[b + R.C + 1] = widen; J[b + R.C + 2] = speed; J[b + R.C + 3] = o.rate || 0;
  J[b + R.D] = q; J[b + R.D + 1] = Ls; J[b + R.D + 2] = o.occlude ? 1 : 0; J[b + R.D + 3] = (o.core || 0) / h;
  J[b + R.E] = o.dust || 0; J[b + R.E + 1] = o.vapor || 0; J[b + R.E + 2] = o.exhaust || 0; J[b + R.E + 3] = o.temp || 0;
  const wd = Math.max(widen, widenLat);
  const wMax = Math.max(w0 + L * wd, (w0 + Math.min(L, Ls) * wd) * HALL_GAS3D_SRC_WIDE) * JET_CUT;
  const ex = ax + dx * L, ey = ay + dy * L, ez = az + dz * L;
  const pad = wMax + w0 * HALL_GAS3D_SRC_WIDE;
  J[b + R.MIN] = Math.min(ax, ex) - pad; J[b + R.MIN + 1] = Math.min(ay, ey) - pad; J[b + R.MIN + 2] = Math.min(az, ez) - pad; J[b + R.MIN + 3] = widenLat;
  J[b + R.MAX] = Math.max(ax, ex) + pad; J[b + R.MAX + 1] = Math.max(ay, ey) + pad; J[b + R.MAX + 2] = Math.max(az, ez) + pad; J[b + R.MAX + 3] = 0;
  return n + 1;
}

/**
 * Buch promieniowy (para dookoła złączki przewodu przy ryglowaniu / odryglowaniu) do `J` pod indeksem `n`. o: { x, z, y — środek,
 * ox, oz — przesunięcie szumu płatów, reach, ring [j.], speed [j/s], rate, flow [j³/s], vapor, dust [jedn./s] }.
 */
export function hallGas3dWriteRadial(J, n, dom, o) {
  const h = dom.h;
  const R = HALL_GAS3D_JET;
  const b = n * R.stride;
  const cx = (o.x - dom.x0) / h, cy = (o.z - dom.z0) / h, cz = o.y / h;
  const reach = Math.max(1, o.reach / h);
  const r0 = Math.max(0.6, o.ring / h);
  // wydatek objętości rozłożony w pierścieniu (r0 ± ~r0): ∫ exp(−((r − r0)/w)²) 4πr² dr ≈ 4π r0² w √π
  const wr = Math.max(r0 * 0.8, 1);
  const shell = 4 * Math.PI * r0 * r0 * wr * Math.sqrt(Math.PI) + 1e-6;
  J[b + R.A] = cx; J[b + R.A + 1] = cy; J[b + R.A + 2] = cz; J[b + R.A + 3] = 1;
  J[b + R.B] = o.ox || 0; J[b + R.B + 1] = o.oz || 0; J[b + R.B + 2] = 0; J[b + R.B + 3] = reach;
  J[b + R.C] = r0; J[b + R.C + 1] = 0; J[b + R.C + 2] = (o.speed || 0) / h; J[b + R.C + 3] = o.rate || 0;
  J[b + R.D] = o.flow > 0 ? (o.flow / (h * h * h)) / shell : 0; J[b + R.D + 1] = wr; J[b + R.D + 2] = 0; J[b + R.D + 3] = 0;
  J[b + R.E] = o.dust || 0; J[b + R.E + 1] = o.vapor || 0; J[b + R.E + 2] = 0; J[b + R.E + 3] = 0;
  J[b + R.MIN] = cx - reach; J[b + R.MIN + 1] = cy - reach; J[b + R.MIN + 2] = cz - reach; J[b + R.MIN + 3] = 0;
  J[b + R.MAX] = cx + reach; J[b + R.MAX + 1] = cy + reach; J[b + R.MAX + 2] = cz + reach; J[b + R.MAX + 3] = 0;
  return n + 1;
}

// ---------------------------------------------------------------------------------------------------------------
// LUSTRA CPU kerneli (hallGas3dGrid.js)

/** Udział warstwy k (komórka h) w przedziale wysokości [y0, y1]. */
export function hallGas3dLayerOverlapCpu(k, h, y0, y1) {
  const a = Math.max(k * h, y0), b = Math.min((k + 1) * h, y1);
  return b > a ? (b - a) / h : 0;
}

/**
 * Zajętość komórki w kernelu `occ`: max(statyka, dach, kadłub) — statyka z rastra, dach = kolumna w obrysie × udział
 * warstwy powyżej spodu dachu × (1 − otwarcie w prostokącie otworu), kadłub = maska obrysu (0..1, próbka liniowa) × udział
 * warstwy w płycie 48–116.
 */
export function hallGas3dOccCpu(stat, column, roofFrac, roofOpenHere, hullMask, hullFrac) {
  const roof = column * roofFrac * (1 - roofOpenHere);
  return Math.max(stat, roof, hullMask * hullFrac);
}

/** Kody sąsiadów w masce ciśnienia (2 bity na sąsiada x+, x−, głąb+, głąb−, wysokość+, wysokość−). */
export const HALL_GAS3D_NB = Object.freeze({ fluid: 0, solid: 1, open: 2, selfSolidBit: 12 });

/**
 * LUSTRO CPU jednej komórki Jacobiego: q — p komórki, nb[6] — p sąsiadów, codes[6] (płyn — p sąsiada, stały / pokład —
 * Neumann: p komórki, brzeg otwarty — 0), rhs, selfSolid → 0. Zwraca nowe p. (∇² p = div − cel; 6 sąsiadów.)
 */
export function hallGas3dJacobiCellCpu(q, nb, codes, rhs, selfSolid) {
  if (selfSolid) return 0;
  let s = 0;
  for (let k = 0; k < 6; k++) s += codes[k] === 0 ? nb[k] : codes[k] === 1 ? q : 0;
  return (s - rhs) / 6;
}

/**
 * LUSTRO CPU rzutu prędkości KOMÓRKI: vb[3] (x, głąb, w górę) po reakcji, q, nb[6], codes[6] jak wyżej, maxSpeed
 * [kom./s]. v = vb − ∇p / 2 (różnica centralna), sufit. Bez obcinania składowej w ścianę (transport idzie po prędkościach
 * ścian — hallGas3dFaceCpu). out[3].
 */
export function hallGas3dProjectCellCpu(vb, q, nb, codes, maxSpeed, out) {
  const P = (k) => (codes[k] === 0 ? nb[k] : codes[k] === 1 ? q : 0);
  let vx = vb[0] - (P(0) - P(1)) * 0.5, vy = vb[1] - (P(2) - P(3)) * 0.5, vz = vb[2] - (P(4) - P(5)) * 0.5;
  const c = Math.min(1, maxSpeed / Math.max(Math.sqrt(vx * vx + vy * vy + vz * vz), 1e-3));
  vx *= c; vy *= c; vz *= c;
  out[0] = vx; out[1] = vy; out[2] = vz;
  return out;
}

/**
 * LUSTRO CPU prędkości ŚCIANY przed rzutem (dywergencja w kernelu hallGas3dDiv): kod sąsiada 0 (płyn) — ½(vSelf + vNb),
 * 1 (bryła / pokład) — prędkość normalna przeszkody `obs` (pokład 0), 2 (brzeg otwarty) — vSelf.
 */
export function hallGas3dFacePriorCpu(vSelf, vNb, code, obs) {
  return code === 0 ? 0.5 * (vSelf + vNb) : code === 1 ? obs : vSelf;
}

/**
 * LUSTRO CPU prędkości ŚCIANY po rzucie (kernel rzutu → faceT, Rhie–Chow): płyn — ½(vSelf + vNb) − (pNb − pSelf),
 * bryła — obs, brzeg otwarty — vSelf + pSelf (za brzegiem p = 0). Dywergencja ścianowa Σ(F₊ − F₋) = cel S, gdy
 * laplasjan zwarty (hallGas3dJacobiCellCpu) zbiegł.
 */
export function hallGas3dFaceCpu(vSelf, vNb, pSelf, pNb, code, obs) {
  return code === 0 ? 0.5 * (vSelf + vNb) - (pNb - pSelf) : code === 1 ? obs : vSelf + pSelf;
}

/**
 * Stosunek OBWODU do POLA obrysu okrętu `s` z maski wejścia klatki [1/j.] — w rozdzielczości SIATKI GAZU: maska
 * (HALL_DUST_MASK, teksel tx × ty) zgrubiona do bloków ≈ komórki `cell` (blok ustawiony, gdy ≥ połowa tekseli), sąsiad poza
 * maską = pusty. Gaz widzi obrys w komórkach — drobny, poszarpany obwód maski zawyżałby wypływ na komórkę ~1,5×.
 * Pusta maska → 0.
 */
export function hallGas3dMaskPerimeterRatio(IN, s, cell = HALL_GAS3D_GRID.cell) {
  const M = HALL_DUST_MASK;
  const b = HALL_DUST_IN.header + s * HALL_DUST_IN.stride;
  const tx = IN[b + HALL_DUST_SHIP.tx] > 0 ? IN[b + HALL_DUST_SHIP.tx] : 1;
  const ty = IN[b + HALL_DUST_SHIP.ty] > 0 ? IN[b + HALL_DUST_SHIP.ty] : 1;
  const fx = Math.max(1, Math.round(cell / tx)), fy = Math.max(1, Math.round(cell / ty));
  const bw = Math.ceil(M.w / fx), bh = Math.ceil(M.h / fy);
  const bx = fx * tx, by = fy * ty;
  const block = (I, J) => {
    if (I < 0 || J < 0 || I >= bw || J >= bh) return 0;
    let n = 0, all = 0;
    for (let j = J * fy; j < Math.min(M.h, (J + 1) * fy); j++) for (let i = I * fx; i < Math.min(M.w, (I + 1) * fx); i++) { all++; n += hallMaskBit(IN, s, i, j); }
    return all > 0 && n * 2 >= all ? 1 : 0;
  };
  let n = 0, per = 0;
  for (let J = 0; J < bh; J++) for (let I = 0; I < bw; I++) {
    if (!block(I, J)) continue;
    n++;
    per += (2 - block(I - 1, J) - block(I + 1, J)) * by + (2 - block(I, J - 1) - block(I, J + 1)) * bx;
  }
  return n > 0 ? per / (n * bx * by) : 0;
}

/**
 * ŹRÓDŁO SZCZELINY pod płytą kadłuba w ruchu [1/s] (efekt przypowierzchniowy): ciśnienie spiętrzenia przed płytą wtłacza
 * powietrze pod kadłub, wypływ przez obrys (burty, dziób, rufa) ma prędkość edgePush·|v| — wydatek S·pole = u·obwód, więc
 * S = edgePush·|v|·obwód / pole (perRatio z hallGas3dMaskPerimeterRatio), z sufitem gapSourceMax. vx, vz [j/s].
 */
export function hallGas3dGapSourceCpu(perRatio, vx, vz, T) {
  return Math.min(T.gapSourceMax, T.edgePush * Math.hypot(vx, vz) * perRatio);
}

/**
 * LUSTRO CPU komórki SZCZELINY pod płytą kadłuba (kernel zajętości, warstwa 0, maska ustawiona): vb — prędkość płyty
 * w komórce [kom./s], ex — oś wzdłuż kadłuba (ku dziobowi), lx ∈ [−1, 1] — położenie rufa → dziób, source — źródło okrętu
 * [1/s] (hallGas3dGapSourceCpu); zwraca occT.yzw = (½·vb — cel wleczenia (Couette), 1 + źródło × waga krawędzi natarcia —
 * znacznik i źródło objętości).
 */
export function hallGas3dGapFlowCpu(vb, ex, lx, source, T, out = [0, 0, 0]) {
  const lead = vb[0] * ex[0] + vb[1] * ex[1] >= 0 ? 1 : -1;
  out[0] = 0.5 * vb[0];
  out[1] = 0.5 * vb[1];
  out[2] = 1 + source * Math.max(1 + T.gapLead * lx * lead, 0);
  return out;
}

/**
 * LUSTRO CPU sąsiada w laplasjanie FILTRA biharmonicznego (kernel wirów): komórka płynu — jej prędkość, bryła (velA.w ≥ 0,5)
 * i pokład (a = 2, deck) — ODBICIE względem prędkości przeszkody s: składowa osi `a` 2·s_a − v0_a, pozostałe v0 (filtr bez
 * tarcia ściany). nb, v0, out — [x, głąb, w górę].
 */
export function hallGas3dFilterNbCpu(nb, nbSolid, v0, a, out = [0, 0, 0]) {
  if (!nbSolid) { out[0] = nb[0]; out[1] = nb[1]; out[2] = nb[2]; return out; }
  out[0] = v0[0]; out[1] = v0[1]; out[2] = v0[2];
  out[a] = 2 * nb[a] - v0[a];
  return out;
}

/**
 * LUSTRO CPU współczynnika OPADANIA pyłu (ułamek masy komórki, który w kroku spada piętro niżej / na pokład): w spokojnym
 * powietrzu pełny, przy szybkim przepływie settleMin (nigdy 0). speed [j/s], T — strojenie (j/s), h [j.], dt [s].
 * Kernel (hallGas3dGrid: rzut i pokład) liczy to samo w komórkach (speed / h, progi / h — ten sam wynik).
 */
export function hallGas3dSettleCpu(speed, T, h, dt) {
  const k = T.settleMin + (1 - T.settleMin) * (1 - smoothCpu(T.settleLo, T.settleHi, speed));
  return Math.min(0.5, T.settleSpeed * k * dt / h);
}

/**
 * LUSTRO CPU wymiany pyłu jednej komórki POKŁADU (kernel hallGas3dDeck) z komórką warstwy 0 nad nią: D — depozyt
 * (0..1), c0 — pył komórki 3D nad (po reakcji), speed — prędkość warstwy 0 [j/s], inside — wnętrze hali (0 / 1).
 * Opadanie: ćwierć tego, co komórka 3D oddaje w kroku (4 komórki pokładu pod nią), nie ponad sufit pokładu 1;
 * podrywanie: strumień liftRate × smoothstep(liftLo, liftHi, speed) [depozytu / s] do wyczerpania kurzu, tylko w hali. Zwraca { D, e } — nowy depozyt i zmianę pyłu
 * komórki 3D w JEDNOSTKACH POWIETRZA (L − s: rzut dodaje sumę e czterech komórek pokładu — masa dokładnie zachowana).
 */
export function hallGas3dDeckExchangeCpu(D, c0, speed, inside, T, h, dt, out = { D: 0, e: 0 }) {
  const m = T.deckMass;
  const s = Math.min(c0 * hallGas3dSettleCpu(speed, T, h, dt) * 0.25, Math.max(1 - D, 0) * m);
  const L = m * Math.min(D, T.liftRate * smoothCpu(T.liftLo, T.liftHi, speed) * dt) * inside;
  out.D = D + (s - L) / m;
  out.e = L - s;
  return out;
}
