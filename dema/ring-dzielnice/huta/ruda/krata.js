// HUTA — fizyczna ruda: krata kolumn 2,5D (ziarna w spoczynku). Czysty moduł: bez three i DOM, bez alokacji w biegu.
//
// Kolumna to stos ziaren na dnie: `n[c]` ziaren, poziom wierzchu `lvl[c] = base[c] + n[c]` (w warstwach po `layer` j.).
// Każde ziarno stosu pamięta bajt cech (bufor pierścieniowy `stack` — z dołu zdejmuje odbiór zasuwą, z góry ssawa i
// osypanie), a trzy wierzchnie ziarna także przesunięcie i obrót, z jakimi ciało stanęło (rysunek bez „pstryknięcia”).
//
// REGUŁA STATECZNOŚCI (kąt usypu) ma dwie części:
//   (A) miejscowa — wierzch kolumny nie może wystawać nad sąsiada w osi o więcej niż 1 warstwę (po przekątnej 2):
//       urwiska i kominy znikają, powierzchnia ma nierówność ± 1 ziarno. Dla rud o regule stromszej niż ok. 34°
//       rosnąca część kolumn (stały wybór z haszu kolumny) dopuszcza o warstwę więcej — bez tego kąt graniczny
//       skakałby przy 1 warstwie na komórkę (40,4°);
//   (B) wygładzona — średni poziom płatu 3 × 3 wokół kolumny nie może przewyższać średniego poziomu płatu odległego
//       o 2–2,8 komórki (16 kierunków) o więcej niż tg θ · odległość. Suma płatu ma rozdzielczość 1/9 warstwy, więc
//       nachylenie graniczne jest bliskie tg θ w każdym kierunku (kopiec okrągły, bez ośmiokąta; zmierzone w trybie
//       szybkim: 1–2,5° poniżej θ, rozrzut kierunków ± 1,5°) i nie potrzeba losowych progów.
//       Część B dotyczy tylko ziarna, które MOŻE zjechać: cel jest co najmniej 2 warstwy niżej, a komórki na drodze
//       nie leżą średnio wyżej niż ziarno (ziarno w dołku albo za garbem zostaje — ciało i tak by tam utknęło).
// Kratą nic samo się nie przesuwa: moduł tylko WSKAZUJE niestateczne kolumny (kolejka `markDirty` → `dequeue`),
// a ich wierzchnie ziarna stają się ciałami (`ciala.js`). Wyjątek — tryb szybki `relax()`: ziarno przeskakuje wprost
// do sąsiada (rozbieg, długie testy).
//
// DANE DLA OBRAZU: `rec` — 8 słów u32 na kolumnę (układ w `packColumn`), odświeżane leniwie w `flushRender()` tylko
// dla kolumn zmienionych i tych, których cieniowanie od nich zależy; `packList` — które kolumny przepakowano.

const S2 = Math.SQRT2;
const S5 = Math.sqrt(5);
const S8 = Math.sqrt(8);
// kierunki reguły: 0–3 oś (część A), 4–7 przekątna (część A), 8–23 płaty odległe o 2 / √5 / √8 komórki (część B)
export const NB_COUNT = 24;
export const NB_LOCAL = 8;
export const NB_DI = Int8Array.of(1, -1, 0, 0, 1, -1, 1, -1, 2, -2, 0, 0, 2, 2, -2, -2, 1, 1, -1, -1, 2, -2, 2, -2);
export const NB_DJ = Int8Array.of(0, 0, 1, -1, 1, 1, -1, -1, 0, 0, 2, -2, 1, -1, 1, -1, 2, -2, 2, -2, 2, 2, -2, -2);
export const NB_DIST = Float64Array.of(1, 1, 1, 1, S2, S2, S2, S2, 2, 2, 2, 2, S5, S5, S5, S5, S5, S5, S5, S5, S8, S8, S8, S8);
// DROGA ziarna ku kierunkowi k: komórki, między którymi ziarno musi się przetoczyć (0–3 komórek na kierunek).
// Ziarno może zjechać, gdy średni poziom tych komórek nie przewyższa poziomu, na którym samo leży — inaczej leży
// w dołku albo za garbem i reguła go nie rusza (ciało i tak by tam utknęło).
const PATH_N = Uint8Array.of(0, 0, 0, 0, 3, 3, 3, 3, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3);
const PATH_I = Int8Array.of(
  0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1,          // pierwsza komórka drogi
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 0, 0,              // druga
  0, 0, 0, 0, 1, -1, 1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, 1, -1);             // trzecia
const PATH_J = Int8Array.of(
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, 1, -1, -1,
  0, 0, 0, 0, 1, 1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, -1, -1);

/**
 * Hasz dwóch liczb całkowitych → i32 (stały, bez stanu). Wynik ze znakiem: zawsze mała liczba całkowita, więc zwrot
 * z funkcji nie alokuje; do reszty z dzielenia brać `>>> 0`.
 */
export function hash2(a, b) {
  let h = Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D);
  h ^= h >>> 12; h = Math.imul(h, 0x297A2D39);
  h ^= h >>> 15;
  return h | 0;
}

/**
 * Pomiar kąta usypu kopca na kracie (diagnostyka i testy — nie tautologia: dopasowanie nachylenia powierzchni,
 * nie odczyt reguły). Z wierzchołka kopca idzie `dirs` promieni; na każdym prosta najmniejszych kwadratów przez
 * punkty powierzchni leżące między `lo` a `hi` wysokości kopca (bez spłaszczonego szczytu i bez stopy).
 * @returns {{ apexX, apexZ, apexY, height, angles: number[], mean, min, max, radius }}  kąty w stopniach
 */
export function measureRepose(grid, { dirs = 16, lo = 0.25, hi = 0.75 } = {}) {
  const { nx, nz, N, n, lvl, cell, layer, x0, z0, floorY } = grid;
  let top = -1e9;
  for (let c = 0; c < N; c++) if (n[c] > 0 && lvl[c] > top) top = lvl[c];
  // wierzchołek: środek ciężkości kolumn o dwóch najwyższych poziomach
  let sx = 0;
  let sz = 0;
  let sw = 0;
  for (let c = 0; c < N; c++) {
    if (n[c] > 0 && lvl[c] >= top - 1) { const i = c % nx; sx += i; sz += (c - i) / nx; sw++; }
  }
  const ai = sx / sw;
  const aj = sz / sw;
  const apexY = top * layer;
  const angles = [];
  let radius = 0;
  let height = 0;
  for (let d = 0; d < dirs; d++) {
    const ang = (d + 0.5) / dirs * Math.PI * 2;
    const ux = Math.cos(ang);
    const uz = Math.sin(ang);
    // stopa: pierwsze miejsce, gdzie trzy kolejne próbki są puste
    let toe = -1;
    let toeY = 0;
    let empty = 0;
    const rs = [];
    const ys = [];
    for (let r = 0; r < 4000; r += 0.5) {
      const i = Math.round(ai + ux * r);
      const j = Math.round(aj + uz * r);
      if (i < 0 || j < 0 || i >= nx || j >= nz) break;
      const c = j * nx + i;
      if (n[c] === 0) { if (++empty >= 3) { toe = r - 1; toeY = floorY[c]; break; } } else { empty = 0; rs.push(r * cell); ys.push(lvl[c] * layer); }
    }
    if (toe < 0 || rs.length < 8) continue;
    const H = apexY - toeY;
    let m = 0;
    let sr = 0;
    let sy = 0;
    let srr = 0;
    let sry = 0;
    for (let k = 0; k < rs.length; k++) {
      const y = ys[k];
      if (y < toeY + lo * H || y > toeY + hi * H) continue;
      m++; sr += rs[k]; sy += y; srr += rs[k] * rs[k]; sry += rs[k] * y;
    }
    if (m < 4) continue;
    const slope = (m * sry - sr * sy) / (m * srr - sr * sr);
    angles.push(Math.atan(-slope) * 180 / Math.PI);
    radius += toe * cell;
    height += H;
  }
  const k = angles.length || 1;
  let mean = 0;
  let min = 1e9;
  let max = -1e9;
  for (const v of angles) { mean += v; if (v < min) min = v; if (v > max) max = v; }
  return { apexX: x0 + (ai + 0.5) * cell, apexZ: z0 + (aj + 0.5) * cell, apexY, height: height / k, angles, mean: mean / k, min, max, radius: radius / k };
}

/** Liczba słów u32 rekordu kolumny dla obrazu. */
export const REC_WORDS = 8;
// próbki marszu cienia słońca: odległości w komórkach (gęsto blisko, rzadko daleko)
const SUN_STEPS = Float64Array.of(1, 2, 3, 4, 6, 8, 11, 15, 20, 27, 36, 48);
const OCC_DI = Int8Array.of(1, -1, 0, 0, 1, -1, 1, -1);
const OCC_DJ = Int8Array.of(0, 0, 1, -1, 1, 1, -1, -1);

/**
 * @param {object} o
 *   nx, nz — liczba kolumn; x0, z0 — róg komórki (0, 0) w układzie stanowiska; cell, layer — bok i warstwa [j.]
 *   floor — wysokość dna: liczba albo funkcja (x, z) → y; wallY — korona murów wokół kraty (cień, zacienienie)
 *   maxLayers — pojemność stosu kolumny (potęga dwójki); salt — sól haszy (różne kraty = różny wzór progów)
 */
export function createGrid(o) {
  const nx = o.nx | 0;
  const nz = o.nz | 0;
  const N = nx * nz;
  const cell = o.cell || 6;
  const hL = o.layer || 5.1;
  const LMAX = o.maxLayers || 64;
  if (LMAX & (LMAX - 1)) throw new Error('krata: maxLayers musi być potęgą dwójki');
  const MASK = LMAX - 1;
  const x0 = +o.x0;
  const z0 = +o.z0;
  const salt = (o.salt | 0) * 7919;
  const inv = 1 / cell;

  const n = new Uint8Array(N);                 // liczba ziaren kolumny
  const base = new Int16Array(N);              // poziom dna [warstwy]
  const lvl = new Int16Array(N);               // poziom wierzchu = base + n
  const floorY = new Float32Array(N);          // ciągła wysokość dna w środku komórki [j.]
  const surf = new Float32Array(N);            // wysokość powierzchni: wierzch kolumny (lvl × warstwa) albo dno, gdy pusta
  const stack = new Uint8Array(N * LMAX);      // bajty cech, pierścień na kolumnę
  const bot = new Uint8Array(N);               // indeks dolnego ziarna w pierścieniu
  const drop = new Uint32Array(N);             // ile ziaren zdjęto z dołu (tożsamość ziarna = drop + warstwa)
  const topOff = new Int8Array(N * 9);         // trzy wierzchnie ziarna: dx, dy, dz (±127 = ±pół komórki / warstwy)
  const topQuat = new Int8Array(N * 12);       // trzy wierzchnie ziarna: kwaternion × 127
  let count = 0;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      const fy = typeof o.floor === 'function' ? o.floor(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell) : (+o.floor || 0);
      floorY[c] = fy;
      base[c] = Math.round(fy / hL);
      lvl[c] = base[c];
      surf[c] = fy;
    }
  }
  const wallLvl = Math.round((o.wallY === undefined ? 1e4 : o.wallY) / hL);

  // ------------------------------------------------------------------ reguła stateczności
  const NBOFF = new Int32Array(NB_COUNT);
  const PATHOFF = new Int32Array(NB_COUNT * 3);
  for (let k = 0; k < NB_COUNT; k++) {
    NBOFF[k] = NB_DJ[k] * nx + NB_DI[k];
    for (let q = 0; q < 3; q++) PATHOFF[q * NB_COUNT + k] = PATH_J[q * NB_COUNT + k] * nx + PATH_I[q * NB_COUNT + k];
  }
  /** Czy ziarno z poziomu `lc` kolumny c może zjechać ku kierunkowi k (komórki drogi leżą w obrębie c … cel). */
  function passable(c, k, lc) {
    const m = PATH_N[k];
    if (m === 0) return true;
    let sum = lvl[c + PATHOFF[k]];
    if (m > 1) sum += lvl[c + PATHOFF[NB_COUNT + k]];
    if (m > 2) sum += lvl[c + PATHOFF[2 * NB_COUNT + k]];
    return sum <= m * (lc - 1);
  }
  const sum9 = new Int32Array(N);              // suma poziomów płatu 3 × 3 wokół kolumny (na brzegu: tylko istniejące)
  const thr9 = new Int32Array(NB_COUNT);       // próg różnicy sum płatów dla kierunku k (część B)
  let limBase = 1;                             // część A: dopuszczalna różnica do sąsiada w osi (po przekątnej + 1)
  let limExtra = 0;                            // udział kolumn (× 256), które dopuszczają o warstwę więcej
  let tanRule = 0.7;
  function setRule(tan) {
    tanRule = tan;
    const T = tan * cell / hL;                 // graniczne nachylenie [warstwy na komórkę]
    // część A: do T = 0,8 różnica 1 w każdej kolumnie; między 0,8 a 1,2 rośnie udział kolumn z różnicą 2 (stały
    // wybór z haszu kolumny) — kąt graniczny zmienia się płynnie także w okolicy 1 warstwy na komórkę (40,4°)
    const f = (T - 0.8) / 0.4;
    limBase = f < 1 ? 1 : Math.floor(T - 0.2) + 1;
    limExtra = f <= 0 ? 0 : f < 1 ? Math.round(f * 256) : Math.round((T - 0.2 - Math.floor(T - 0.2)) * 256);
    for (let k = NB_LOCAL; k < NB_COUNT; k++) thr9[k] = Math.round(9 * T * NB_DIST[k]);
  }
  setRule(o.tan === undefined ? 0.7 : o.tan);
  function rebuildSums() {
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let b = j > 0 ? j - 1 : 0; b <= (j < nz - 1 ? j + 1 : j); b++) for (let a = i > 0 ? i - 1 : 0; a <= (i < nx - 1 ? i + 1 : i); a++) sum += lvl[b * nx + a];
        sum9[j * nx + i] = sum;
      }
    }
  }
  rebuildSums();
  /** Poziom kolumny c zmienił się o `d`: poprawka sum płatów, w których kolumna leży. */
  function bump(c, d) {
    const i = c % nx;
    const j = (c - i) / nx;
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) {
      const r0 = c - nx;
      const r2 = c + nx;
      sum9[r0 - 1] += d; sum9[r0] += d; sum9[r0 + 1] += d;
      sum9[c - 1] += d; sum9[c] += d; sum9[c + 1] += d;
      sum9[r2 - 1] += d; sum9[r2] += d; sum9[r2 + 1] += d;
    } else {
      for (let b = j > 0 ? j - 1 : 0; b <= (j < nz - 1 ? j + 1 : j); b++) for (let a = i > 0 ? i - 1 : 0; a <= (i < nx - 1 ? i + 1 : i); a++) sum9[b * nx + a] += d;
    }
  }

  const excess = new Float64Array(1);          // nadwyżka z ostatniego `unstableDir` (w tablicy: zapis ułamka nie alokuje)
  /**
   * Kierunek, ku któremu kolumna c (podniesiona o `extra` ziaren) jest najbardziej niestateczna: indeks 0…23 tablic
   * NB_* albo −1 (stateczna). `lastExcess` — nadwyżka w warstwach (część A: całe warstwy, część B: dziewiąte części).
   * Sąsiedzi poza kratą to mury — pomijani; część B liczy się tylko między kolumnami o pełnych płatach.
   */
  function unstableDir(c, extra) {
    const lc = lvl[c] + extra;
    const i = c % nx;
    const j = (c - i) / nx;
    let best = -1;
    let bestEx = 0;
    let limAxis = limBase;
    if (limExtra !== 0) {
      let h = Math.imul(c + salt, 0x9E3779B1);
      h ^= h >>> 15; h = Math.imul(h, 0x85EBCA6B);
      if ((h >>> 24) < limExtra) limAxis++;
    }
    const limDiag = limAxis + 1;
    if (i >= 3 && i < nx - 3 && j >= 3 && j < nz - 3) {
      // wnętrze kraty: bez sprawdzania granic
      let d = lc - lvl[c + 1] - limAxis; if (d > bestEx) { bestEx = d; best = 0; }
      d = lc - lvl[c - 1] - limAxis; if (d > bestEx) { bestEx = d; best = 1; }
      d = lc - lvl[c + nx] - limAxis; if (d > bestEx) { bestEx = d; best = 2; }
      d = lc - lvl[c - nx] - limAxis; if (d > bestEx) { bestEx = d; best = 3; }
      d = lc - lvl[c + nx + 1] - limDiag; if (d > bestEx && passable(c, 4, lc)) { bestEx = d; best = 4; }
      d = lc - lvl[c + nx - 1] - limDiag; if (d > bestEx && passable(c, 5, lc)) { bestEx = d; best = 5; }
      d = lc - lvl[c - nx + 1] - limDiag; if (d > bestEx && passable(c, 6, lc)) { bestEx = d; best = 6; }
      d = lc - lvl[c - nx - 1] - limDiag; if (d > bestEx && passable(c, 7, lc)) { bestEx = d; best = 7; }
      const sc = sum9[c] + extra;
      let e9 = bestEx * 9;
      // przy remisie wygrywa pierwszy — przegląd zaczyna się od kierunku z haszu kolumny i poziomu
      let k = NB_LOCAL + ((Math.imul(c + lc, 0x9E3779B1) >>> 28) & 15);
      for (let m = 0; m < 16; m++) {
        if (++k === NB_COUNT) k = NB_LOCAL;
        const t = c + NBOFF[k];
        const e = sc - sum9[t] - thr9[k];
        // ziarno schodzi tylko na kolumnę wyraźnie niższą i tylko wtedy, gdy ma drogę (nie leży w dołku ani za garbem)
        if (e > e9 && lc - lvl[t] >= 2 && passable(c, k, lc)) { e9 = e; best = k; }
      }
      excess[0] = e9 / 9;
      return best;
    }
    for (let k = 0; k < NB_LOCAL; k++) {
      const a = i + NB_DI[k];
      const b = j + NB_DJ[k];
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const d = lc - lvl[b * nx + a] - (k < 4 ? limAxis : limDiag);
      if (d > bestEx && passable(c, k, lc)) { bestEx = d; best = k; }
    }
    let e9 = bestEx * 9;
    if (i >= 1 && i < nx - 1 && j >= 1 && j < nz - 1) {
      const sc = sum9[c] + extra;
      for (let k = NB_LOCAL; k < NB_COUNT; k++) {
        const a = i + NB_DI[k];
        const b = j + NB_DJ[k];
        if (a < 1 || b < 1 || a >= nx - 1 || b >= nz - 1) continue;
        const e = sc - sum9[b * nx + a] - thr9[k];
        if (e > e9 && lc - lvl[b * nx + a] >= 2 && passable(c, k, lc)) { e9 = e; best = k; }
      }
    }
    excess[0] = e9 / 9;
    return best;
  }

  // kolejka kolumn do sprawdzenia (każda najwyżej raz — pojemność N wystarcza zawsze)
  const queue = new Int32Array(N);
  const inQ = new Uint8Array(N);
  let qHead = 0;
  let qTail = 0;
  let qCount = 0;
  function enqueue(c) {
    if (inQ[c] !== 0) return;
    inQ[c] = 1;
    queue[qTail] = c;
    qTail = qTail + 1 === N ? 0 : qTail + 1;
    qCount++;
  }
  function dequeue() {
    const c = queue[qHead];
    qHead = qHead + 1 === N ? 0 : qHead + 1;
    qCount--;
    inQ[c] = 0;
    return c;
  }
  /** Kolumna c zmieniła wysokość: kolumny w zasięgu reguły (kwadrat 7 × 7) idą do sprawdzenia stateczności. */
  function markDirty(c) {
    const i = c % nx;
    const j = (c - i) / nx;
    if (i >= 3 && i < nx - 3 && j >= 3 && j < nz - 3) {
      for (let r = c - 3 * nx - 3, e = c + 3 * nx - 3; r <= e; r += nx) {
        enqueue(r); enqueue(r + 1); enqueue(r + 2); enqueue(r + 3); enqueue(r + 4); enqueue(r + 5); enqueue(r + 6);
      }
    } else {
      const a0 = i > 3 ? i - 3 : 0;
      const a1 = i < nx - 4 ? i + 3 : nx - 1;
      const b0 = j > 3 ? j - 3 : 0;
      const b1 = j < nz - 4 ? j + 3 : nz - 1;
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) enqueue(b * nx + a);
    }
  }
  /** Kolumna c urosła: sumy płatów zmieniły się tylko w kwadracie 3 × 3 wokół niej — tyle idzie do sprawdzenia. */
  function markNear(c) {
    const i = c % nx;
    const j = (c - i) / nx;
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) {
      enqueue(c - nx - 1); enqueue(c - nx); enqueue(c - nx + 1);
      enqueue(c - 1); enqueue(c); enqueue(c + 1);
      enqueue(c + nx - 1); enqueue(c + nx); enqueue(c + nx + 1);
    } else {
      for (let b = j > 0 ? j - 1 : 0; b <= (j < nz - 1 ? j + 1 : j); b++) for (let a = i > 0 ? i - 1 : 0; a <= (i < nx - 1 ? i + 1 : i); a++) enqueue(b * nx + a);
    }
  }
  function markAll() { for (let c = 0; c < N; c++) if (n[c] > 0) enqueue(c); }

  // ------------------------------------------------------------------ rekordy wierzchnich ziaren
  const popOff = new Float32Array(3);          // przesunięcie ostatnio zdjętego wierzchu [j.]: dx, dy, dz
  const popQuat = new Float32Array(4);         // jego kwaternion
  const argQuat = new Float64Array(4);         // kwaternion ziarna dla `push` (przez tablicę: argumenty ułamkowe alokują)
  const offXZ = cell / 254;
  const offY = hL / 254;

  function writeHashed(c, slot, serial) {
    const h = hash2(c + salt, serial);
    const o9 = c * 9 + slot * 3;
    topOff[o9] = (((h & 255) - 128) * 0.84) | 0;                 // ±0,42 komórki
    topOff[o9 + 1] = ((((h >>> 8) & 255) - 128) * 0.6) | 0;      // ±0,3 warstwy (rzędy i tarasy kraty giną w rozrzucie)
    topOff[o9 + 2] = ((((h >>> 16) & 255) - 128) * 0.84) | 0;
    const g = hash2(serial + 17, c);
    let qa = (g & 255) - 127.5;
    let qb = ((g >>> 8) & 255) - 127.5;
    let qc = ((g >>> 16) & 255) - 127.5;
    let qd = (g >>> 24) - 127.5;
    const s = 127 / Math.sqrt(qa * qa + qb * qb + qc * qc + qd * qd);
    const o12 = c * 12 + slot * 4;
    topQuat[o12] = Math.round(qa * s); topQuat[o12 + 1] = Math.round(qb * s);
    topQuat[o12 + 2] = Math.round(qc * s); topQuat[o12 + 3] = Math.round(qd * s);
  }

  function shiftDown(c) {
    const o9 = c * 9;
    const o12 = c * 12;
    topOff[o9 + 6] = topOff[o9 + 3]; topOff[o9 + 7] = topOff[o9 + 4]; topOff[o9 + 8] = topOff[o9 + 5];
    topOff[o9 + 3] = topOff[o9]; topOff[o9 + 4] = topOff[o9 + 1]; topOff[o9 + 5] = topOff[o9 + 2];
    topQuat[o12 + 8] = topQuat[o12 + 4]; topQuat[o12 + 9] = topQuat[o12 + 5]; topQuat[o12 + 10] = topQuat[o12 + 6]; topQuat[o12 + 11] = topQuat[o12 + 7];
    topQuat[o12 + 4] = topQuat[o12]; topQuat[o12 + 5] = topQuat[o12 + 1]; topQuat[o12 + 6] = topQuat[o12 + 2]; topQuat[o12 + 7] = topQuat[o12 + 3];
  }

  /**
   * Ziarno staje na wierzchu kolumny c z przesunięciem (ix, iy, iz — jednostki Int8) i obrotem z `argQuat`
   * (kwaternion jednostkowy x, y, z, w — wołający wpisuje go przed wywołaniem). Wołający sprawdza wcześniej
   * pojemność (`n[c] < LMAX − 1`).
   */
  function push(c, tr, ix, iy, iz) {
    const nn = n[c];
    stack[c * LMAX + ((bot[c] + nn) & MASK)] = tr;
    shiftDown(c);
    const o9 = c * 9;
    const o12 = c * 12;
    topOff[o9] = ix; topOff[o9 + 1] = iy; topOff[o9 + 2] = iz;
    topQuat[o12] = Math.round(argQuat[0] * 127); topQuat[o12 + 1] = Math.round(argQuat[1] * 127);
    topQuat[o12 + 2] = Math.round(argQuat[2] * 127); topQuat[o12 + 3] = Math.round(argQuat[3] * 127);
    n[c] = nn + 1;
    surf[c] = ++lvl[c] * hL;
    bump(c, 1);
    count++;
    touch(c);
  }
  /** Ziarno staje na wierzchu z przesunięciem i obrotem z haszu (tryb szybki, załadunek statku). */
  function pushHashed(c, tr) {
    const nn = n[c];
    stack[c * LMAX + ((bot[c] + nn) & MASK)] = tr;
    shiftDown(c);
    writeHashed(c, 0, drop[c] + nn);
    if (nn === 0) {
      // pierwsze ziarno leży na ciągłym dnie, nie na poziomie warstwy
      let iy = Math.round((floorY[c] + 3 - (base[c] + 0.5) * hL) / offY);
      if (iy > 127) iy = 127; else if (iy < -127) iy = -127;
      topOff[c * 9 + 1] = iy;
    }
    n[c] = nn + 1;
    surf[c] = ++lvl[c] * hL;
    bump(c, 1);
    count++;
    touch(c);
  }
  /** Zdejmuje wierzchnie ziarno: zwraca bajt cech, a w `popOff` / `popQuat` zostawia jego przesunięcie i obrót. */
  function popTop(c) {
    const nn = n[c] - 1;
    const tr = stack[c * LMAX + ((bot[c] + nn) & MASK)];
    const o9 = c * 9;
    const o12 = c * 12;
    popOff[0] = topOff[o9] * offXZ; popOff[1] = topOff[o9 + 1] * offY; popOff[2] = topOff[o9 + 2] * offXZ;
    const qa = topQuat[o12];
    const qb = topQuat[o12 + 1];
    const qc = topQuat[o12 + 2];
    const qd = topQuat[o12 + 3];
    const s = qa * qa + qb * qb + qc * qc + qd * qd;
    if (s > 0) { const k = 1 / Math.sqrt(s); popQuat[0] = qa * k; popQuat[1] = qb * k; popQuat[2] = qc * k; popQuat[3] = qd * k; } else { popQuat[0] = 0; popQuat[1] = 0; popQuat[2] = 0; popQuat[3] = 1; }
    topOff[o9] = topOff[o9 + 3]; topOff[o9 + 1] = topOff[o9 + 4]; topOff[o9 + 2] = topOff[o9 + 5];
    topOff[o9 + 3] = topOff[o9 + 6]; topOff[o9 + 4] = topOff[o9 + 7]; topOff[o9 + 5] = topOff[o9 + 8];
    topQuat[o12] = topQuat[o12 + 4]; topQuat[o12 + 1] = topQuat[o12 + 5]; topQuat[o12 + 2] = topQuat[o12 + 6]; topQuat[o12 + 3] = topQuat[o12 + 7];
    topQuat[o12 + 4] = topQuat[o12 + 8]; topQuat[o12 + 5] = topQuat[o12 + 9]; topQuat[o12 + 6] = topQuat[o12 + 10]; topQuat[o12 + 7] = topQuat[o12 + 11];
    if (nn >= 3) writeHashed(c, 2, drop[c] + nn - 3);          // odsłonięte trzecie ziarno: rekord z haszu
    n[c] = nn;
    lvl[c]--;
    surf[c] = nn > 0 ? lvl[c] * hL : floorY[c];
    bump(c, -1);
    count--;
    touch(c);
    return tr;
  }
  /** Zdejmuje dolne ziarno kolumny (odbiór zasuwą): stos zjeżdża o warstwę, wierzchnie rekordy zostają. */
  function popBottom(c) {
    const tr = stack[c * LMAX + bot[c]];
    bot[c] = (bot[c] + 1) & MASK;
    drop[c]++;
    lvl[c]--;
    surf[c] = --n[c] > 0 ? lvl[c] * hL : floorY[c];
    bump(c, -1);
    count--;
    touch(c);
    return tr;
  }

  /**
   * Tryb szybki: niestateczne wierzchy przeskakują wprost do sąsiada, aż kolejka się opróżni (albo po `maxMoves`).
   * Zwraca liczbę przeskoków.
   */
  function relax(maxMoves) {
    let moves = 0;
    while (qCount > 0 && moves < maxMoves) {
      const c = dequeue();
      if (n[c] === 0) continue;
      const k = unstableDir(c, 0);
      if (k < 0) continue;
      const i = c % nx;
      const t = ((c - i) / nx + NB_DJ[k]) * nx + i + NB_DI[k];
      if (n[t] >= LMAX - 1) continue;
      const tr = popTop(c);
      pushHashed(t, tr);
      markDirty(c);
      markNear(t);
      moves++;
    }
    return moves;
  }

  /** Liczba kolumn łamiących regułę stateczności (pełny przegląd — testy i diagnostyka). */
  function unstableCount() {
    let u = 0;
    for (let c = 0; c < N; c++) if (n[c] > 0 && unstableDir(c, 0) >= 0) u++;
    return u;
  }

  function clear() {
    n.fill(0);
    lvl.set(base);
    rebuildSums();
    surf.set(floorY);
    bot.fill(0);
    count = 0;
    qHead = 0; qTail = 0; qCount = 0;
    inQ.fill(0);
    rAll = true;
  }

  /** Indeks kolumny pod punktem (x, z); punkt poza kratą jest dociskany do brzegu. */
  function colAt(x, z) {
    let i = ((x - x0) * inv) | 0;
    let j = ((z - z0) * inv) | 0;
    if (i < 0) i = 0; else if (i >= nx) i = nx - 1;
    if (j < 0) j = 0; else if (j >= nz) j = nz - 1;
    return j * nx + i;
  }

  /**
   * Kolumna z miejscem na ziarno najbliżej kolumny c (sama c, gdy ma miejsce): pierścienie kwadratowe o rosnącym
   * promieniu, w pierścieniu kolumna najniższa. Bezpiecznik trybu szybkiego i `settleAll` — ziarno nigdy nie jest
   * dopisywane ponad pojemność stosu. Zwraca −1 tylko wtedy, gdy cała krata jest pełna po sufit.
   */
  function findRoom(c) {
    if (n[c] < LMAX - 2) return c;
    const i = c % nx;
    const j = (c - i) / nx;
    const rMax = nx > nz ? nx : nz;
    for (let r = 1; r <= rMax; r++) {
      let best = -1;
      let bn = LMAX - 2;
      for (let dj = -r; dj <= r; dj++) {
        const b = j + dj;
        if (b < 0 || b >= nz) continue;
        const edge = dj === -r || dj === r;
        for (let di = -r; di <= r; di += edge ? 1 : 2 * r) {
          const a = i + di;
          if (a < 0 || a >= nx) continue;
          const q = b * nx + a;
          if (n[q] < bn) { bn = n[q]; best = q; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // ------------------------------------------------------------------ dane dla obrazu (leniwe)
  const rec = new Uint32Array(N * REC_WORDS);
  const recF = new Float32Array(rec.buffer);
  const RCAP = Math.min(N, 16384);
  const rList = new Int32Array(RCAP);
  const rFlag = new Uint8Array(N);
  let rCount = 0;
  let rAll = true;
  const packList = new Int32Array(N);
  const pFlag = new Uint8Array(N);
  let packCount = 0;
  const sunDi = new Int16Array(SUN_STEPS.length);
  const sunDj = new Int16Array(SUN_STEPS.length);
  const sunRise = new Float64Array(SUN_STEPS.length);
  const sunSoft = new Float64Array(SUN_STEPS.length);     // półcień: tym szerszy, im dalej stoi to, co zasłania słońce
  for (let m = 0; m < SUN_STEPS.length; m++) sunSoft[m] = 1 / (1.8 + 0.3 * SUN_STEPS[m]);

  function touch(c) {
    if (rAll || rFlag[c] !== 0) return;
    if (rCount < RCAP) { rFlag[c] = 1; rList[rCount++] = c; } else rAll = true;
  }

  /**
   * Kierunek KU słońcu w układzie stanowiska (x, y — w górę, z). Cień własny stosu liczy marsz po polu wysokości
   * w tym kierunku; wysokość słońca nad horyzontem jest ograniczona od dołu (tg ≥ 0,3), żeby cień nie był nieskończony.
   */
  function setSun(sx, sy, sz) {
    const hl = Math.sqrt(sx * sx + sz * sz);
    const ux = hl > 1e-6 ? sx / hl : 1;
    const uz = hl > 1e-6 ? sz / hl : 0;
    let tanEl = hl > 1e-6 ? sy / hl : 10;
    if (tanEl < 0.3) tanEl = 0.3;
    for (let m = 0; m < SUN_STEPS.length; m++) {
      sunDi[m] = Math.round(ux * SUN_STEPS[m]);
      sunDj[m] = Math.round(uz * SUN_STEPS[m]);
      sunRise[m] = SUN_STEPS[m] * cell * tanEl / hL + 0.5;      // + pół warstwy: płaska powierzchnia nie cieniuje sama siebie
    }
    rAll = true;
  }
  setSun(-0.5, 0.62, -0.6);

  /**
   * Rekord kolumny (8 słów u32):
   *   słowo 0: bity 0–7 liczba ziaren n, 8–15 otwarcie szczelin (255 = nic nie zasłania, 0 = dno szczeliny),
   *            16–23 słońce (255 = oświetlona, 0 = w cieniu stosu albo muru), 24–31 zapas (0)
   *   słowa 1–2: wierzchnie ziarno — [cechy | dx << 8 | dy << 16 | dz << 24] (dx, dz: Int8, ±127 = ±pół komórki;
   *            dy: ±127 = ±pół warstwy), [kwaternion x | y << 8 | z << 16 | w << 24] (Int8, × 1/127)
   *   słowa 3–4: drugie ziarno od góry, słowa 5–6: trzecie (zera, gdy kolumna jest niższa)
   *   słowo 7: f32 — wysokość y środka wierzchniego ziarna bez przesunięcia (pusta kolumna: wysokość dna);
   *            ziarno k od góry leży na y − k · warstwa
   */
  function packColumn(c) {
    const o8 = c * REC_WORDS;
    const nn = n[c];
    const lc = lvl[c];
    const i = c % nx;
    const j = (c - i) / nx;
    let occ = 0;
    for (let k = 0; k < 8; k++) {
      const a = i + OCC_DI[k];
      const b = j + OCC_DJ[k];
      let d = (a < 0 || b < 0 || a >= nx || b >= nz ? wallLvl : lvl[b * nx + a]) - lc;
      if (d > 0) occ += d > 3 ? 3 : d;
    }
    let open = 255 - occ * 10;
    if (open < 0) open = 0;
    let sh = 0;
    for (let m = 0; m < SUN_STEPS.length; m++) {
      const a = i + sunDi[m];
      const b = j + sunDj[m];
      const ex = ((a < 0 || b < 0 || a >= nx || b >= nz ? wallLvl : lvl[b * nx + a]) - lc - sunRise[m]) * sunSoft[m];
      if (ex > sh) sh = ex;
    }
    const lit = sh >= 1 ? 0 : Math.round(255 * (1 - sh));
    rec[o8] = nn | (open << 8) | (lit << 16);
    const o9 = c * 9;
    const o12 = c * 12;
    for (let s = 0; s < 3; s++) {
      if (s < nn) {
        const tr = stack[c * LMAX + ((bot[c] + nn - 1 - s) & MASK)];
        rec[o8 + 1 + s * 2] = (tr | ((topOff[o9 + s * 3] & 255) << 8) | ((topOff[o9 + s * 3 + 1] & 255) << 16) | ((topOff[o9 + s * 3 + 2] & 255) << 24)) >>> 0;
        rec[o8 + 2 + s * 2] = ((topQuat[o12 + s * 4] & 255) | ((topQuat[o12 + s * 4 + 1] & 255) << 8) | ((topQuat[o12 + s * 4 + 2] & 255) << 16) | ((topQuat[o12 + s * 4 + 3] & 255) << 24)) >>> 0;
      } else {
        rec[o8 + 1 + s * 2] = 0;
        rec[o8 + 2 + s * 2] = 0;
      }
    }
    recF[o8 + 7] = nn > 0 ? (lc - 0.5) * hL : floorY[c];
  }

  function addPack(c) {
    if (pFlag[c] !== 0) return;
    pFlag[c] = 1;
    packList[packCount++] = c;
  }

  /**
   * Przepakowuje rekordy kolumn zmienionych od poprzedniego wywołania oraz tych, których cieniowanie od nich zależy
   * (8 sąsiadów — szczeliny, kolumny „za” zmienioną względem słońca — cień). Zwraca liczbę przepakowanych kolumn:
   * ich indeksy są w `packList[0 … wynik)`. Wynik −1 = przepakowano CAŁĄ kratę (pierwsze wywołanie, zmiana słońca,
   * przepełnienie listy zmian — np. po rozbiegu trybem szybkim).
   */
  function flushRender() {
    if (rAll) {
      for (let k = 0; k < rCount; k++) rFlag[rList[k]] = 0;
      rCount = 0;
      rAll = false;
      for (let c = 0; c < N; c++) packColumn(c);
      packCount = 0;
      return -1;
    }
    packCount = 0;
    for (let q = 0; q < rCount; q++) {
      const c = rList[q];
      rFlag[c] = 0;
      addPack(c);
      const i = c % nx;
      const j = (c - i) / nx;
      for (let k = 0; k < 8; k++) {
        const a = i + OCC_DI[k];
        const b = j + OCC_DJ[k];
        if (a >= 0 && b >= 0 && a < nx && b < nz) addPack(b * nx + a);
      }
      for (let m = 0; m < SUN_STEPS.length; m++) {
        const a = i - sunDi[m];
        const b = j - sunDj[m];
        if (a >= 0 && b >= 0 && a < nx && b < nz) addPack(b * nx + a);
      }
    }
    rCount = 0;
    for (let q = 0; q < packCount; q++) { const c = packList[q]; pFlag[c] = 0; packColumn(c); }
    return packCount;
  }

  /**
   * Zakresy przepakowanych kolumn do wysyłki na GPU: sortuje `packList[0 … count)` i scala kolumny odległe o nie
   * więcej niż `maxGap`. Zapisuje pary (pierwsza kolumna, liczba kolumn) do `out`, zwraca liczbę par.
   */
  function packRanges(cnt, maxGap, out) {
    if (cnt <= 0) return 0;
    packList.subarray(0, cnt).sort();
    let m = 0;
    let start = packList[0];
    let end = start;
    for (let q = 1; q < cnt; q++) {
      const c = packList[q];
      if (c - end <= maxGap + 1) end = c;
      else {
        if (m * 2 + 1 < out.length) { out[m * 2] = start; out[m * 2 + 1] = end - start + 1; }
        m++;
        start = c; end = c;
      }
    }
    if (m * 2 + 1 < out.length) { out[m * 2] = start; out[m * 2 + 1] = end - start + 1; }
    return m + 1;
  }

  return {
    nx, nz, N, cell, layer: hL, LMAX, x0, z0, x1: x0 + nx * cell, z1: z0 + nz * cell, wallLvl,
    n, base, lvl, floorY, surf, stack, bot, drop, topOff, topQuat, popOff, popQuat, argQuat, excess,
    rec, recF, packList,
    get count() { return count; },
    get queued() { return qCount; },
    get lastExcess() { return excess[0]; },
    get tanRule() { return tanRule; },
    setRule, unstableDir, markDirty, markNear, markAll, dequeue, relax, unstableCount,
    push, pushHashed, popTop, popBottom, clear, colAt, findRoom,
    setSun, flushRender, packRanges
  };
}
