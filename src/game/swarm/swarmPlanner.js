/**
 * PLANISTA ROJU — „wieża portu” (demo dema/roj-webgpu.html, opis docs/webgpu/DEMO-ROJ.md).
 * Czysta logika: bez three, bez DOM. Drony latają same (GPU: src/3d/swarm/swarmSim.js —
 * lot, unikanie, tor pionowy w kolumnie, zamki kolumn); planista mówi KTO, CO i DOKĄD,
 * i prowadzi księgę ładunku z odczytu stanu dronów (faza, wykonane zadania — z opóźnieniem
 * 1–3 klatek, jak radio).
 *
 * KSIĘGA = KONTENERY STANDARDOWE W KOMÓRKACH (decyzja użytkownika 2026-10-06: jeden wymiar, chwyt
 * płaski S 1 / M 2 / L 4 / Capital 8). Kolumna ma obrys cnx × cny komórek i poziomy; dron klasy
 * bierze PODBLOK swojego chwytu (wierzchnią warstwę tego podbloku — także niepełną) i kładzie go na
 * RÓWNYM podbloku celu (wszystkie komórki tej samej wysokości), więc chwyty się zagnieżdżają:
 * Capital rozładowuje wagon na plac C, a L / M / S biorą z tego samego placu połowy, ćwiartki
 * i pojedyncze kontenery do swoich statków. Kurs drona w chwycie i przy odłożeniu wybiera planista
 * (kurs kolumny albo +π — bliżej kursu, z którym dron skończy poprzednie zadanie), więc wie, który
 * kontener trafi w którą komórkę celu (lustro: RELEASE w kernelu kSteer i wykonawca CPU).
 *
 * CO ROBI „MĄDRZE” (tryb smart; tryb naive — ta sama księga i te same reguły bezpieczeństwa,
 * bez optymalizacji — do porównania w demie):
 *   • KOLEJKA Z WYPRZEDZENIEM (opcja lookahead 2; domyślnie wyłączona — SWARM_PLANNER_TUNE): dron
 *     dostaje następne zadanie, zanim skończy bieżące (pierścień 2 zadań na GPU);
 *   • PODWÓJNY CYKL: koszt zadania to głównie pusty dolot — po odłożeniu eksportu w statku
 *     najbliższe są importy tego statku, a po odłożeniu importu na placu — eksporty obok;
 *   • PEŁNE CHWYTY: kara za niepełny chwyt — duży dron woli pełną warstwę, resztki biorą mniejsze;
 *   • SZTAUOWANIE: ciężkie kontenery bliżej środka kadłuba, burty na zmianę (kara za przesunięcie
 *     środka masy po ruchu — wyważenie);
 *   • ROZPROSZENIE: kara za kolumny obok innych pracujących dronów;
 *   • PLAC WG TOWARU: każdy towar dostaje zwarte stosy placu (kolejność wężykiem od strony źródeł);
 *     LIFO — nic nie ląduje na kontenerze, który jeszcze ma odlecieć;
 *   • PRZEŁADUNEK BEZPOŚREDNI: kontenery ze statku do statku lecą od razu, gdy w celu jest równe
 *     miejsce — plac tylko jako bufor.
 * BEZPIECZEŃSTWO (oba tryby): jedna operacja na kolumnę naraz (rezerwacja od przydziału do
 * opuszczenia kolumny), stos zawsze od góry, w celu tylko równy podblok na kontenerach, które już
 * zostają (LIFO), klasa pracuje tylko w kolumnach, których obrys dzieli jej chwyt.
 */

import { SWARM_PHASE, SWARM_TASK, SWARM_TASK_FLOATS, swarmColumnNeighbors, swarmColumnToWorld, swarmSubBlockOffset } from './swarmPort.js';
import { swarmDroneClass, swarmPackTiles } from '../../data/swarmDrones.js';
import { CARGO_CONTAINER } from '../../data/cargoBays.js';

export const SWARM_PLANNER_MODE = Object.freeze({ SMART: 'smart', NAIVE: 'naive' });

export const SWARM_PLANNER_TUNE = Object.freeze({
  loadedWeight: 0.35,     // waga drogi z ładunkiem (pusty dolot liczy się 1)
  balanceWeight: 900,     // kara za przesunięcie środka masy (znormalizowane do półwymiarów kadłuba)
  spreadWeight: 70,       // kara za pracujące drony obok (na sąsiada)
  bufferPenalty: 900,     // bufor na placu zamiast miejsca w statku docelowym
  partialPenalty: 120,    // kara za każdy brakujący kontener niepełnego chwytu
  // Zadań na drona w trybie smart (1 — bez zapasu). Zapas (2) przy chwytach płaskich wydłużał
  // operację: rezerwuje kolumny drugiego zadania na cały kurs pierwszego, a pod koniec ostatnie
  // kursy czekają za zajętymi dronami (CPU, opóźnienie odczytu 0,2 s: port 131 → 168 s, wymiana
  // 97 → 101 s). Odczyt z GPU spóźnia się o 1–3 klatki — dron w tym czasie zaczyna powrót.
  lookahead: 1,
  candidates: 24,         // najwięcej w pełni ocenianych źródeł na przydział (najbliższe pustym dolotem)
  shipScan: 16,           // najwięcej ocenianych miejsc w ładowni (od środka kadłuba) na chwyt
  perFrame: 48            // najwięcej przydziałów na klatkę (start roju falami, stały koszt CPU)
});

const dist2 = (ax, ay, bx, by) => { const dx = ax - bx; const dy = ay - by; return dx * dx + dy * dy; };
const wrap = (a) => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

/** Kurs kolumny albo kurs + π — ten bliższy kursowi ref (dron obraca się o ≤ 90°). */
export function swarmClosestYaw(colYaw, ref) {
  const a = wrap(colYaw);
  return Math.abs(wrap(a - ref)) <= Math.PI / 2 + 1e-9 ? { yaw: a, flip: false } : { yaw: wrap(a + Math.PI), flip: true };
}

/**
 * Planista dla portu (buildSwarmPort + swarmFillColumns) i floty dronów:
 *   drones: [{ index, classId, pad }] — pad = indeks kolumny gniazda.
 * opts: { mode, tune }.
 */
export function createSwarmPlanner(port, drones, opts = {}) {
  const T = { ...SWARM_PLANNER_TUNE, ...(opts.tune || {}) };
  const mode = opts.mode === SWARM_PLANNER_MODE.NAIVE ? SWARM_PLANNER_MODE.NAIVE : SWARM_PLANNER_MODE.SMART;
  const smart = mode === SWARM_PLANNER_MODE.SMART;
  const cols = port.columns;
  const grids = port.grids;
  const units = port.units || [];
  const NC = cols.length;
  const H = CARGO_CONTAINER.H;

  // --- księga: komórki kolumn (stan planowany = rzeczywisty po zakończeniu przydzielonych zadań) ---
  const occBase = new Int32Array(NC);
  const hBase = new Int32Array(NC);
  let nOcc = 0;
  let nH = 0;
  for (let c = 0; c < NC; c++) { occBase[c] = nOcc; nOcc += cols[c].levels * cols[c].cells; hBase[c] = nH; nH += cols[c].cells; }
  const occ = new Int32Array(Math.max(1, nOcc)).fill(-1);
  const hgt = new Int32Array(Math.max(1, nH));
  const count = new Int32Array(NC);
  const unitCol = new Int32Array(units.length);
  const unitLevel = new Int32Array(units.length);
  const unitCell = new Int32Array(units.length);
  const unitState = new Uint8Array(units.length);           // 0 czeka, 1 w zadaniu, 2 na miejscu
  for (const u of units) {
    const c = cols[u.col];
    if (!(u.level < c.levels && u.cell < c.cells)) throw new Error('swarmPlanner: kontener poza kolumną');
    const k = occBase[u.col] + u.level * c.cells + u.cell;
    if (occ[k] >= 0) throw new Error('swarmPlanner: dwa kontenery w jednej komórce');
    occ[k] = u.id;
    unitCol[u.id] = u.col;
    unitLevel[u.id] = u.level;
    unitCell[u.id] = u.cell;
    count[u.col]++;
  }
  for (let c = 0; c < NC; c++) {
    const col = cols[c];
    for (let cell = 0; cell < col.cells; cell++) {
      let h = 0;
      while (h < col.levels && occ[occBase[c] + h * col.cells + cell] >= 0) h++;
      for (let lv = h; lv < col.levels; lv++) if (occ[occBase[c] + lv * col.cells + cell] >= 0) throw new Error('swarmPlanner: dziura w stosie');
      hgt[hBase[c] + cell] = h;
    }
  }
  const unitAt = (ci, level, cell) => occ[occBase[ci] + level * cols[ci].cells + cell];
  const reserved = new Int32Array(NC).fill(-1);            // zadanie, które trzyma kolumnę
  const busyNear = new Float32Array(NC);                   // rozproszenie: pracujące kolumny obok
  const neighbors = cols.map((c) => swarmColumnNeighbors(port, c.index));

  function destOk(u, col) {
    const d = u.dest;
    if (!d) return true;
    const c = cols[col];
    if (d.kind === 'yard') return c.kind === 'yard' && (d.grid === undefined || c.grid === d.grid);
    if (d.kind === 'ship') return c.kind === 'hold' && c.owner === d.ship;
    return true;
  }
  const needsMoveAt = (u, col) => !!u.dest && !destOk(u, col);
  for (const u of units) unitState[u.id] = needsMoveAt(u, u.col) ? 0 : 2;

  // Klucz celu (chwyt = kontenery jednego celu): statek, blok placu, dowolny plac; −1 — zostaje.
  const shipIndex = new Map(port.ships.map((s, i) => [s.id, i]));
  const KEY_SHIP = 1000;
  const KEY_GRID = 2000;
  const KEY_YARD = 3000;
  function destKey(u) {
    const d = u.dest;
    if (!d) return -1;
    if (d.kind === 'ship') return KEY_SHIP + (shipIndex.get(d.ship) ?? 999);
    if (d.kind === 'yard') return d.grid === undefined ? KEY_YARD : KEY_GRID + d.grid;
    return -1;
  }

  // --- wyważenie statków (masa i moment w układzie statku: a wzdłuż, b w poprzek) ---
  const shipState = new Map();
  function toShip(s, x, y, out) {
    const dx = x - s.center.x;
    const dy = y - s.center.y;
    const c = Math.cos(s.yaw);
    const si = Math.sin(s.yaw);
    out.a = c * dx + si * dy;
    out.b = -si * dx + c * dy;
    return out;
  }
  const _sp = { a: 0, b: 0 };
  for (const s of port.ships) {
    let halfA = 1; let halfB = 1; let cap = 0;
    for (const g of s.grids) {
      const gg = grids[g];
      for (const ci of gg.columns) {
        toShip(s, cols[ci].x, cols[ci].y, _sp);
        halfA = Math.max(halfA, Math.abs(_sp.a) + gg.pitchA / 2);
        halfB = Math.max(halfB, Math.abs(_sp.b) + gg.pitchB / 2);
        cap += cols[ci].cells * cols[ci].levels;
      }
    }
    // Masa własna kadłuba (środek w osi): ~1,5 × pełny ładunek — przy pustej ładowni jeden kontener
    // przy burcie przesuwa środek masy CAŁEGO statku o mało, nie o pół ładowni.
    const dry = 1.5 * cap * 2 * 1.3;
    shipState.set(s.id, { ship: s, M: 0, Ma: 0, Mb: 0, halfA, halfB, dry, maxTrim: 0, trim: 0, active: false });
  }
  const colShip = cols.map((c) => (c.kind === 'hold' ? shipState.get(c.owner) : null));
  // Środek komórki kontenera w układzie statku (masa w miejscu kontenera).
  const cellShip = (ci, cell, out) => {
    const c = cols[ci];
    const a = ((cell % c.cnx) - (c.cnx - 1) / 2) * (CARGO_CONTAINER.L + CARGO_CONTAINER.gap);
    const b = (Math.floor(cell / c.cnx) - (c.cny - 1) / 2) * (CARGO_CONTAINER.W + CARGO_CONTAINER.gap);
    const w = swarmColumnToWorld(c, a, b, {});
    return toShip(colShip[ci].ship, w.x, w.y, out);
  };
  for (const u of units) {
    const st = colShip[u.col];
    if (!st) continue;
    cellShip(u.col, u.cell, _sp);
    st.M += u.mass; st.Ma += u.mass * _sp.a; st.Mb += u.mass * _sp.b;
  }
  // Przesunięcie środka masy statku z ładunkiem (względem półwymiarów ładowni; w poprzek × 2 —
  // przechył burty waży więcej niż przegłębienie).
  const trimOf = (st, M, Ma, Mb) => {
    const tot = M + st.dry;
    if (tot <= 1e-6) return 0;
    const ca = Ma / tot / st.halfA;
    const cb = Mb / tot / st.halfB;
    return Math.sqrt(ca * ca + 4 * cb * cb);
  };
  for (const st of shipState.values()) st.trim = trimOf(st, st.M, st.Ma, st.Mb);
  // Statek „w obróbce” (do statystyki wyważenia): ma kontenery do wyjęcia albo do przyjęcia.
  for (const u of units) {
    if (unitState[u.id] !== 0) continue;
    const a = colShip[u.col];
    if (a) a.active = true;
    if (u.dest?.kind === 'ship') { const b = shipState.get(u.dest.ship); if (b) b.active = true; }
  }

  // --- klasy floty i ich podbloki (chwyt w kolumnie): { ci, ox, oy, x, y, cells[] } ---
  const classIds = [...new Set(drones.map((d) => d.classId))];
  const subs = new Map();          // klasa → wszystkie podbloki
  const colSubs = new Map();       // klasa → kolumna → podbloki kolumny
  for (const id of classIds) {
    const cls = swarmDroneClass(id);
    const { nx: pnx, ny: pny } = cls.pack;
    const all = [];
    const per = new Array(NC).fill(null);
    for (const c of cols) {
      if (c.kind === 'pad' || !swarmPackTiles(cls, c.cnx, c.cny)) continue;
      const list = [];
      for (let oy = 0; oy < c.cny; oy += pny) {
        for (let ox = 0; ox < c.cnx; ox += pnx) {
          const o = swarmSubBlockOffset(c.cnx, c.cny, ox, oy, pnx, pny, {});
          const w = swarmColumnToWorld(c, o.a, o.b, {});
          const cells = new Int32Array(pnx * pny);
          for (let py = 0; py < pny; py++) for (let px = 0; px < pnx; px++) cells[py * pnx + px] = (oy + py) * c.cnx + (ox + px);
          const sb = { ci: c.index, ox, oy, x: w.x, y: w.y, cells, order: list.length };
          list.push(sb);
          all.push(sb);
        }
      }
      per[c.index] = list;
    }
    subs.set(id, all);
    colSubs.set(id, per);
  }

  // Miejsca w ładowniach statków (klasa → statek → podbloki): smart — od środka kadłuba
  // (najpierw wąska oś burt), naive — w kolejności slotów ładowni (od rufy).
  const shipSubs = new Map();
  for (const id of classIds) {
    for (const s of port.ships) {
      const st = shipState.get(s.id);
      const list = [];
      for (const g of s.grids) for (const ci of grids[g].columns) for (const sb of colSubs.get(id)[ci] || []) list.push(sb);
      if (smart) {
        const key = (sb) => { toShip(s, sb.x, sb.y, _sp); const ca = _sp.a / st.halfA; const cb = _sp.b / st.halfB; return ca * ca + 3 * cb * cb; };
        const k = new Map(list.map((sb) => [sb, key(sb)]));
        list.sort((p, q) => k.get(p) - k.get(q) || p.ci - q.ci || p.order - q.order);
      }
      shipSubs.set(`${id}:${s.id}`, list);
    }
  }

  // --- plac: kolejność stosów (wężykiem od strony źródeł) i obszary towarów ---
  const yardGrids = grids.filter((g) => g.kind === 'yard');
  const yardTag = new Array(NC).fill(null);                // towar stosu placu (smart)
  const yardOrder = new Map();                             // blok → kolumny w kolejności zapełniania
  for (const g of yardGrids) {
    // Źródła: kontenery do tego bloku (albo do dowolnego placu) — wężyk od bliższego końca.
    let sx = 0; let sy = 0; let n = 0;
    for (const u of units) {
      if (unitState[u.id] !== 0 || u.dest?.kind !== 'yard') continue;
      if (u.dest.grid !== undefined && u.dest.grid !== g.index) continue;
      sx += cols[u.col].x; sy += cols[u.col].y; n++;
    }
    const list = g.columns.slice();
    if (smart && n) {
      sx /= n; sy /= n;
      const first = cols[g.cellMap[0]];
      const last = cols[g.cellMap[g.cols - 1]];
      const flipI = !!first && !!last && dist2(last.x, last.y, sx, sy) < dist2(first.x, first.y, sx, sy);
      list.sort((p, q) => {
        const A = cols[p]; const B = cols[q];
        const ia = flipI ? g.cols - 1 - A.i : A.i;
        const ib = flipI ? g.cols - 1 - B.i : B.i;
        if (ia !== ib) return ia - ib;
        return (ia & 1 ? B.j - A.j : A.j - B.j);
      });
    }
    yardOrder.set(g.index, list);
  }
  // Kontenery w kolumnie, które jeszcze NIE są na miejscu (czekają albo są w zadaniu) — na nich nic
  // nie ląduje (LIFO); stos z nimi nie przyjmuje ładunku.
  const pending = new Int32Array(NC);
  for (const u of units) if (unitState[u.id] !== 2) pending[u.col]++;
  const capacity = (ci) => cols[ci].cells * cols[ci].levels;
  /** Zbiór kolumn z szybkim dodaniem / usunięciem (tablica + pozycje). */
  function makeSet() {
    const list = [];
    const at = new Map();
    return {
      list,
      has: (ci) => at.has(ci),
      add(ci) { if (!at.has(ci)) { at.set(ci, list.length); list.push(ci); } },
      delete(ci) {
        const k = at.get(ci);
        if (k === undefined) return;
        const last = list.pop();
        if (last !== ci) { list[k] = last; at.set(last, k); }
        at.delete(ci);
      }
    };
  }
  // Stosy placu, które PRZYJMĄ ładunek (miejsce i wszystko pod spodem na miejscu) — na blok.
  const avail = new Map(yardGrids.map((g) => [g.index, makeSet()]));
  // Obszary towarów (smart): otwarte stosy towaru = oznaczone i przyjmujące — krótka lista na towar.
  const openCols = new Map();
  const openOf = (res) => { let s = openCols.get(res); if (!s) { s = makeSet(); openCols.set(res, s); } return s; };
  // Nowe stosy (smart): kopiec wolnych stosów bloku wg pozycji w kolejności wężyka (leniwy).
  const orderPos = new Int32Array(NC).fill(-1);
  for (const [, list] of yardOrder) list.forEach((ci, k) => { orderPos[ci] = k; });
  const freshHeap = new Map(yardGrids.map((g) => [g.index, []]));
  const inHeap = new Uint8Array(NC);
  const isFreshCol = (ci) => yardTag[ci] === null && count[ci] === 0;
  function heapPush(h, ci) {
    h.push(ci);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (orderPos[h[p]] <= orderPos[h[i]]) break;
      const t = h[p]; h[p] = h[i]; h[i] = t; i = p;
    }
  }
  function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && orderPos[h[l]] < orderPos[h[m]]) m = l;
        if (r < h.length && orderPos[h[r]] < orderPos[h[m]]) m = r;
        if (m === i) break;
        const t = h[m]; h[m] = h[i]; h[i] = t; i = m;
      }
    }
    return top;
  }
  function setTag(ci, res) {
    if (yardTag[ci] === res) return;
    if (yardTag[ci] !== null) openOf(yardTag[ci]).delete(ci);
    yardTag[ci] = res;
  }
  /** Po każdej zmianie licznika, oczekujących albo oznaczenia stosu placu. */
  function yardSync(ci) {
    const c = cols[ci];
    if (c.kind !== 'yard') return;
    if (smart && count[ci] === 0) setTag(ci, null);
    const ok = count[ci] < capacity(ci) && pending[ci] === 0;
    const av = avail.get(c.grid);
    if (ok) av.add(ci); else av.delete(ci);
    if (yardTag[ci] !== null) { const s = openOf(yardTag[ci]); if (ok) s.add(ci); else s.delete(ci); }
    if (smart && isFreshCol(ci) && !inHeap[ci]) { inHeap[ci] = 1; heapPush(freshHeap.get(c.grid), ci); }
  }
  if (smart) {
    // Stosy z kontenerami na starcie: towar spodu.
    for (const g of yardGrids) {
      for (const ci of g.columns) {
        const u = count[ci] ? unitAt(ci, 0, 0) : -1;
        if (u >= 0) setTag(ci, units[u].resource);
      }
    }
  }
  for (const g of yardGrids) for (const ci of g.columns) yardSync(ci);
  const gridPos = new Int32Array(NC).fill(-1);
  for (const g of grids) g.columns.forEach((ci, k) => { gridPos[ci] = k; });

  // --- drony ---
  const D = drones.map((d) => {
    const pad = cols[d.pad];
    return {
      index: d.index, classId: d.classId, cls: swarmDroneClass(d.classId), pad: d.pad,
      assigned: 0, completed: 0, phase: SWARM_PHASE.PARKED,
      tasks: new Map(),
      freeX: pad ? pad.x : 0, freeY: pad ? pad.y : 0, yaw: wrap(pad ? pad.yaw : 0)
    };
  });

  const stats = {
    mode, total: 0, assigned: 0, done: 0, tasks: 0, containers: 0,
    emptyDist: 0, loadedDist: 0, direct: 0, viaYard: 0, startTime: null, endTime: null,
    maxTrim: 0, events: 0
  };
  for (const u of units) if (unitState[u.id] === 0) stats.total++;
  const out = new Float32Array(SWARM_TASK_FLOATS);
  let taskSerial = 1;
  let rr = 0;

  function reserve(ci, taskId) {
    reserved[ci] = taskId;
    busyNear[ci] += 1;
    for (const n of neighbors[ci]) busyNear[n] += 0.6;
  }
  function release(ci, taskId) {
    if (reserved[ci] !== taskId) return;
    reserved[ci] = -1;
    busyNear[ci] -= 1;
    for (const n of neighbors[ci]) busyNear[n] -= 0.6;
  }

  /**
   * Chwyt z podbloku: wierzchnia warstwa (poziom L = najwyższy stos − 1) — kontenery w komórkach
   * o tej wysokości; wszystkie czekają i mają ten sam cel (inaczej — mniejsza klasa po kawałku).
   * Wynik w `o`: L, n, key, mass, units[k] (k = miejsce podbloku w układzie kolumny) / −1.
   */
  function pickAt(sb, o) {
    const ci = sb.ci;
    const c = cols[ci];
    const hb = hBase[ci];
    let top = 0;
    for (let k = 0; k < sb.cells.length; k++) top = Math.max(top, hgt[hb + sb.cells[k]]);
    if (top === 0) return false;
    const L = top - 1;
    let key = -2;
    let n = 0;
    let mass = 0;
    let res = null;
    for (let k = 0; k < sb.cells.length; k++) {
      const cell = sb.cells[k];
      o.units[k] = -1;
      if (hgt[hb + cell] !== top) continue;
      const u = occ[occBase[ci] + L * c.cells + cell];
      if (unitState[u] !== 0) return false;
      const kk = destKey(units[u]);
      if (key === -2) key = kk;
      else if (kk !== key) return false;
      o.units[k] = u;
      n++;
      mass += units[u].mass;
      if (res === null) res = units[u].resource;
    }
    if (key < 0) return false;
    o.L = L; o.n = n; o.key = key; o.mass = mass; o.resource = res;
    return true;
  }

  /** Poziom odłożenia na podbloku celu (wszystkie komórki równe, pod spodem tylko to, co zostaje) / −1. */
  function dropLevel(sb) {
    const ci = sb.ci;
    if (reserved[ci] >= 0) return -1;
    const c = cols[ci];
    const hb = hBase[ci];
    const L = hgt[hb + sb.cells[0]];
    if (L >= c.levels) return -1;
    for (let k = 1; k < sb.cells.length; k++) if (hgt[hb + sb.cells[k]] !== L) return -1;
    for (let lv = 0; lv < L; lv++) {
      for (let k = 0; k < sb.cells.length; k++) if (unitState[occ[occBase[ci] + lv * c.cells + sb.cells[k]]] !== 2) return -1;
    }
    return L;
  }

  /** Miejsce w ładowni statku dla chwytu (smart: środek kadłuba i wyważenie; naive: pierwsze wolne). */
  function chooseShipDrop(s, cls, cd) {
    const list = shipSubs.get(`${cls.id}:${s.id}`);
    if (!list) return null;
    const st = shipState.get(s.id);
    let best = null;
    let bestCost = Infinity;
    let seen = 0;
    const m = cd.mass;
    for (const sb of list) {
      const L = dropLevel(sb);
      if (L < 0) continue;
      if (!smart) return { sb, L };
      toShip(s, sb.x, sb.y, _sp);
      const ca = _sp.a / st.halfA;
      const cb = _sp.b / st.halfB;
      const t = trimOf(st, st.M + m, st.Ma + m * _sp.a, st.Mb + m * _sp.b);
      // Ciężkie najbliżej środka; wśród podobnie centralnych — ta burta, która wyważa; niżej najpierw.
      const cost = (ca * ca + 3 * cb * cb) * m + 6 * t * m + 0.05 * L * m;
      if (cost < bestCost) { bestCost = cost; best = { sb, L }; }
      if (++seen >= T.shipScan) break;
    }
    return best;
  }

  /** Najlepszy (najniższy) równy podblok kolumny placu dla klasy / null. */
  function bestColumnDrop(ci, cls) {
    const list = colSubs.get(cls.id)[ci];
    if (!list || reserved[ci] >= 0) return null;
    let best = null;
    for (const sb of list) {
      const L = dropLevel(sb);
      if (L >= 0 && (!best || L < best.L)) best = { sb, L };
    }
    return best;
  }

  /** Pierwszy wolny stos bloku w kolejności wężyka (kopiec; nieaktualne wpisy wypadają). */
  function freshDrop(gi, cls) {
    const h = freshHeap.get(gi);
    while (h.length) {
      const ci = h[0];
      if (!isFreshCol(ci) || pending[ci] > 0) { heapPop(h); inHeap[ci] = 0; continue; }
      // null — klasa nie pracuje w tym bloku (obrys) albo stos chwilowo zajęty: zostaje w kopcu.
      return bestColumnDrop(ci, cls);
    }
    return null;
  }

  // Opcje odłożenia na placu, liczone RAZ na klatkę (towar × blok × klasa) — kandydaci tylko wybierają
  // najbliższą; stos zarezerwowany w tej klatce (przydział) wypada przy odczycie.
  const dropCache = new Map();
  const resId = new Map();
  const resIndex = (res) => { let k = resId.get(res); if (k === undefined) { k = resId.size + 1; resId.set(res, k); } return k; };
  function cachedDrops(kind, res, grid, cls, build) {
    const key = ((kind * 4096 + (res === '' ? 0 : resIndex(res))) * 4096 + grid + 1) * 8 + cls.index;
    let list = dropCache.get(key);
    if (!list) { list = build(); dropCache.set(key, list); }
    return list;
  }
  function openDrops(res, grid, cls) {
    return cachedDrops(1, res, grid, cls, () => {
      const out = [];
      const open = openCols.get(res);
      if (open) for (const ci of open.list) { if (grid >= 0 && cols[ci].grid !== grid) continue; const b = bestColumnDrop(ci, cls); if (b) out.push(b); }
      return out;
    });
  }
  function availDrops(grid, cls) {
    return cachedDrops(2, '', grid, cls, () => {
      const out = [];
      for (const g of yardGrids) {
        if (grid >= 0 && g.index !== grid) continue;
        for (const ci of avail.get(g.index).list) { const b = bestColumnDrop(ci, cls); if (b) out.push(b); }
      }
      return out;
    });
  }

  /** Stos placu dla chwytu (blok `grid` albo dowolny plac, gdy −1). */
  function chooseYardDrop(cd, cls, grid) {
    if (!smart) {
      // Naiwnie: pierwszy przyjmujący stos bloku (w kolejności kolumn).
      let best = null;
      let bestPos = Infinity;
      for (const g of yardGrids) {
        if (grid >= 0 && g.index !== grid) continue;
        for (const ci of avail.get(g.index).list) {
          if (gridPos[ci] + g.index * 1e6 >= bestPos) continue;
          const b = bestColumnDrop(ci, cls);
          if (b) { best = b; bestPos = gridPos[ci] + g.index * 1e6; }
        }
        if (best) return best;
      }
      return null;
    }
    // Otwarte stosy tego towaru (zwarty obszar) — najbliższy chwytu, potem nowy stos w kolejności bloku.
    let best = null;
    let bestCost = Infinity;
    for (const b of openDrops(cd.resource, grid, cls)) {
      const ci = b.sb.ci;
      if (reserved[ci] >= 0) continue;
      const cost = Math.sqrt(dist2(cd.x, cd.y, b.sb.x, b.sb.y)) + T.spreadWeight * busyNear[ci] + 40 * b.L;
      if (cost < bestCost) { bestCost = cost; best = b; }
    }
    if (best) return { sb: best.sb, L: best.L };
    // Pierwszy wolny stos bloku w kolejności wężyka (bloki — wg odległości od chwytu).
    let fresh = null;
    let freshCost = Infinity;
    for (const g of yardGrids) {
      if (grid >= 0 && g.index !== grid) continue;
      const b = freshDrop(g.index, cls);
      if (!b) continue;
      const cost = Math.sqrt(dist2(cd.x, cd.y, b.sb.x, b.sb.y));
      if (cost < freshCost) { freshCost = cost; fresh = b; }
    }
    if (fresh) { fresh.tag = cd.resource; return fresh; }
    // Resztki (brak wolnych stosów): najbliższy przyjmujący stos — mieszany towar.
    for (const b of availDrops(grid, cls)) {
      if (reserved[b.sb.ci] >= 0) continue;
      const cost = Math.sqrt(dist2(cd.x, cd.y, b.sb.x, b.sb.y)) + 40 * b.L;
      if (cost < bestCost) { bestCost = cost; best = b; }
    }
    return best ? { sb: best.sb, L: best.L } : null;
  }

  /** Cel chwytu albo null, gdy teraz nie da się go odłożyć. */
  function chooseDrop(cd, cls) {
    const key = cd.key;
    if (key >= KEY_SHIP && key < KEY_GRID) {
      const s = port.ships[key - KEY_SHIP];
      if (!s) return null;
      const b = chooseShipDrop(s, cls, cd);
      if (b) { b.direct = cd.fromHold; return b; }
      // Miejsce w statku jeszcze zajęte (import nie wyjęty): ze statku na plac jako bufor.
      if (cd.fromHold) {
        const y = chooseYardDrop(cd, cls, -1);
        if (y) { y.buffer = true; return y; }
      }
      return null;
    }
    if (key >= KEY_GRID && key < KEY_YARD) return chooseYardDrop(cd, cls, key - KEY_GRID);
    if (key === KEY_YARD) return chooseYardDrop(cd, cls, -1);
    return null;
  }

  // Czy cel klucza jest TERAZ osiągalny dla klasy (pamięć na klatkę) — bez tego K najbliższych
  // źródeł bywa samymi eksportami, których miejsca w statku są jeszcze zajęte, i nikt nie dostaje
  // pracy (zakleszczenie wymiany).
  const possible = new Map();
  function anyYardDrop(cls, grid) {
    for (const g of yardGrids) {
      if (grid >= 0 && g.index !== grid) continue;
      for (const ci of avail.get(g.index).list) if (bestColumnDrop(ci, cls)) return true;
    }
    return false;
  }
  function dropPossible(key, cls, fromHold) {
    const mk = key * 8 + cls.index * 2 + (fromHold ? 1 : 0);
    let v = possible.get(mk);
    if (v !== undefined) return v;
    if (key >= KEY_SHIP && key < KEY_GRID) {
      const s = port.ships[key - KEY_SHIP];
      v = false;
      for (const sb of (s && shipSubs.get(`${cls.id}:${s.id}`)) || []) if (dropLevel(sb) >= 0) { v = true; break; }
      if (!v && fromHold) v = anyYardDrop(cls, -1);
    } else if (key >= KEY_GRID && key < KEY_YARD) v = anyYardDrop(cls, key - KEY_GRID);
    else v = key === KEY_YARD && anyYardDrop(cls, -1);
    possible.set(mk, v);
    return v;
  }

  // Kandydaci klasy (wierzchnie warstwy podbloków w wolnych kolumnach) — raz na klatkę.
  const cand = new Map(classIds.map((id) => [id, []]));
  const pool = [];
  let poolN = 0;
  const _pk = { units: new Int32Array(8), L: 0, n: 0, key: 0, mass: 0, resource: null };
  function buildCandidates() {
    poolN = 0;
    possible.clear();
    dropCache.clear();
    for (const id of classIds) {
      const list = cand.get(id);
      const cls = swarmDroneClass(id);
      list.length = 0;
      for (const sb of subs.get(id)) {
        if (reserved[sb.ci] >= 0 || count[sb.ci] === 0) continue;
        if (!pickAt(sb, _pk)) continue;
        if (!dropPossible(_pk.key, cls, cols[sb.ci].kind === 'hold')) continue;
        let c = pool[poolN];
        if (!c) { c = { units: new Int32Array(8) }; pool[poolN] = c; }
        poolN++;
        c.sb = sb; c.L = _pk.L; c.n = _pk.n; c.key = _pk.key; c.mass = _pk.mass; c.resource = _pk.resource;
        c.units.set(_pk.units);
        c.x = sb.x; c.y = sb.y; c.fromHold = cols[sb.ci].kind === 'hold';
        list.push(c);
      }
      if (!smart) {
        // Najpierw rozładunki (statek → …), potem reszta; w kolejności kolumn.
        list.sort((p, q) => (q.fromHold - p.fromHold) || (p.sb.ci - q.sb.ci) || (p.sb.order - q.sb.order));
      }
    }
  }

  const _near = [];
  /** Najlepszy ruch dla drona (stan planowany); null — nic gotowego. */
  function chooseMove(dr) {
    const list = cand.get(dr.classId);
    if (!list || !list.length) return null;
    const cls = dr.cls;
    if (!smart) {
      for (const cd of list) {
        if (reserved[cd.sb.ci] >= 0) continue;
        const drop = chooseDrop(cd, cls);
        if (drop) return { cd, drop };
      }
      return null;
    }
    // Smart: K najbliższych źródeł (pusty dolot) w kopcu maksymalnym, potem pełna ocena.
    const K = T.candidates;
    _near.length = 0;
    for (const cd of list) {
      if (reserved[cd.sb.ci] >= 0) continue;
      const d = dist2(dr.freeX, dr.freeY, cd.x, cd.y);
      if (_near.length < K) {
        _near.push([d, cd]);
        if (_near.length === K) _near.sort((a, b) => b[0] - a[0]);
        continue;
      }
      if (d >= _near[0][0]) continue;
      _near[0] = [d, cd];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < K && _near[l][0] > _near[m][0]) m = l;
        if (r < K && _near[r][0] > _near[m][0]) m = r;
        if (m === i) break;
        const t = _near[i]; _near[i] = _near[m]; _near[m] = t; i = m;
      }
    }
    let best = null;
    let bestCost = Infinity;
    const full = cls.pack.nx * cls.pack.ny;
    for (const [d2, cd] of _near) {
      const drop = chooseDrop(cd, cls);
      if (!drop) continue;
      const empty = Math.sqrt(d2);
      const loaded = Math.sqrt(dist2(cd.x, cd.y, drop.sb.x, drop.sb.y));
      let cost = empty + T.loadedWeight * loaded;
      cost += T.spreadWeight * (busyNear[cd.sb.ci] + busyNear[drop.sb.ci]);
      cost += T.partialPenalty * (full - cd.n);
      const sp = colShip[cd.sb.ci];
      if (sp) {
        toShip(sp.ship, cd.x, cd.y, _sp);
        cost += T.balanceWeight * (trimOf(sp, sp.M - cd.mass, sp.Ma - cd.mass * _sp.a, sp.Mb - cd.mass * _sp.b) - sp.trim);
      }
      const sd = colShip[drop.sb.ci];
      if (sd) {
        toShip(sd.ship, drop.sb.x, drop.sb.y, _sp);
        cost += T.balanceWeight * (trimOf(sd, sd.M + cd.mass, sd.Ma + cd.mass * _sp.a, sd.Mb + cd.mass * _sp.b) - sd.trim);
      }
      if (drop.buffer) cost += T.bufferPenalty;
      if (cost < bestCost) { bestCost = cost; best = { cd, drop }; }
    }
    return best;
  }

  function writeTask(dr, task, writer) {
    const pc = cols[task.pick];
    const dc = cols[task.drop];
    const o = out;
    o.fill(0);
    o[SWARM_TASK.PICK * 4 + 0] = task.px;
    o[SWARM_TASK.PICK * 4 + 1] = task.py;
    o[SWARM_TASK.PICK * 4 + 2] = pc.zBase + (task.pickLevel + 1) * H;
    o[SWARM_TASK.PICK * 4 + 3] = task.yawPick;
    o[SWARM_TASK.DROP * 4 + 0] = task.dx;
    o[SWARM_TASK.DROP * 4 + 1] = task.dy;
    o[SWARM_TASK.DROP * 4 + 2] = dc.zBase + (task.dropLevel + 1) * H;
    o[SWARM_TASK.DROP * 4 + 3] = task.yawDrop;
    o[SWARM_TASK.ALT * 4 + 0] = pc.entryZ;
    o[SWARM_TASK.ALT * 4 + 1] = dc.entryZ;
    o[SWARM_TASK.ALT * 4 + 2] = pc.bay;
    o[SWARM_TASK.ALT * 4 + 3] = dc.bay;
    o[SWARM_TASK.IDS * 4 + 0] = task.units.length;
    o[SWARM_TASK.IDS * 4 + 1] = task.serial;
    o[SWARM_TASK.IDS * 4 + 2] = task.pick;
    o[SWARM_TASK.IDS * 4 + 3] = task.drop;
    o[SWARM_TASK.LEVELS * 4 + 0] = task.pickBefore;
    o[SWARM_TASK.LEVELS * 4 + 1] = task.dropBefore;
    o[SWARM_TASK.LEVELS * 4 + 2] = H;
    o[SWARM_TASK.LEVELS * 4 + 3] = 0;
    o[SWARM_TASK.CEIL * 4 + 0] = pc.ceilZ;
    o[SWARM_TASK.CEIL * 4 + 1] = dc.ceilZ;
    for (let k = 0; k < 8; k++) o[SWARM_TASK.UNITS_A * 4 + k] = task.slotUnit[k];
    writer(dr.index, task.serial, o);
  }

  function assign(dr, time, writer) {
    const m = chooseMove(dr);
    if (!m) return false;
    const cd = m.cd;
    const sbP = cd.sb;
    const sbD = m.drop.sb;
    const pci = sbP.ci;
    const dci = sbD.ci;
    const pc = cols[pci];
    const dc = cols[dci];
    const { nx: pnx, ny: pny } = dr.cls.pack;
    // Kurs w chwycie i przy odłożeniu (kurs kolumny albo +π) → które miejsce chwytu, która komórka celu.
    const yp = swarmClosestYaw(pc.yaw, dr.yaw);
    const yd = swarmClosestYaw(dc.yaw, yp.yaw);
    const slotUnit = new Float32Array(8).fill(-1);
    const list = [];
    const pickBefore = count[pci];
    const dropBefore = count[dci];
    const Ld = m.drop.L;
    for (let k = 0; k < sbP.cells.length; k++) {
      const u = cd.units[k];
      if (u < 0) continue;
      const cx = k % pnx;
      const cy = Math.floor(k / pnx);
      const px = yp.flip ? pnx - 1 - cx : cx;
      const py = yp.flip ? pny - 1 - cy : cy;
      const dx = yd.flip ? pnx - 1 - px : px;
      const dy = yd.flip ? pny - 1 - py : py;
      const cellD = sbD.cells[dy * pnx + dx];
      slotUnit[py * pnx + px] = u;
      // Księga: zdjęte ze źródła, położone w celu.
      const cellP = sbP.cells[k];
      occ[occBase[pci] + cd.L * pc.cells + cellP] = -1;
      hgt[hBase[pci] + cellP]--;
      occ[occBase[dci] + Ld * dc.cells + cellD] = u;
      hgt[hBase[dci] + cellD]++;
      const sp = colShip[pci];
      if (sp) { cellShip(pci, cellP, _sp); const w = units[u].mass; sp.M -= w; sp.Ma -= w * _sp.a; sp.Mb -= w * _sp.b; }
      const sd = colShip[dci];
      if (sd) { cellShip(dci, cellD, _sp); const w = units[u].mass; sd.M += w; sd.Ma += w * _sp.a; sd.Mb += w * _sp.b; }
      unitCol[u] = dci;
      unitLevel[u] = Ld;
      unitCell[u] = cellD;
      unitState[u] = 1;
      list.push(u);
    }
    count[pci] -= list.length;
    count[dci] += list.length;
    pending[pci] -= list.length;
    pending[dci] += list.length;
    if (colShip[pci]) colShip[pci].trim = trimOf(colShip[pci], colShip[pci].M, colShip[pci].Ma, colShip[pci].Mb);
    if (colShip[dci]) colShip[dci].trim = trimOf(colShip[dci], colShip[dci].M, colShip[dci].Ma, colShip[dci].Mb);
    // Plac: obszary towarów (smart), przyjmujące stosy, wolne stosy.
    if (smart && m.drop.tag) setTag(dci, m.drop.tag);
    yardSync(pci);
    yardSync(dci);
    const id = taskSerial++;
    const task = {
      id, drone: dr.index, serial: dr.assigned, units: list, slotUnit, pick: pci, drop: dci,
      pickLevel: cd.L, dropLevel: Ld, pickBefore, dropBefore,
      px: sbP.x, py: sbP.y, dx: sbD.x, dy: sbD.y, yawPick: yp.yaw, yawDrop: yd.yaw,
      pickReleased: false, assignedAt: time, buffer: !!m.drop.buffer, direct: !!m.drop.direct
    };
    reserve(pci, id);
    reserve(dci, id);
    stats.emptyDist += Math.sqrt(dist2(dr.freeX, dr.freeY, sbP.x, sbP.y));
    stats.loadedDist += Math.sqrt(dist2(sbP.x, sbP.y, sbD.x, sbD.y));
    if (task.direct) stats.direct++;
    if (task.buffer) stats.viaYard++;
    dr.freeX = sbD.x;
    dr.freeY = sbD.y;
    dr.yaw = yd.yaw;
    dr.tasks.set(task.serial, task);
    dr.assigned++;
    stats.assigned++;
    stats.containers += list.length;
    if (stats.startTime === null) stats.startTime = time;
    writeTask(dr, task, writer);
    return true;
  }

  function finish(dr, task, time) {
    if (!task.pickReleased) { release(task.pick, task.id); task.pickReleased = true; }
    release(task.drop, task.id);
    for (const id of task.units) {
      const u = units[id];
      u.col = unitCol[id];
      u.level = unitLevel[id];
      u.cell = unitCell[id];
      // Bufor na placu: kontener czeka dalej (cel — statek); inaczej jest na miejscu.
      unitState[id] = needsMoveAt(u, u.col) ? 0 : 2;
      if (unitState[id] === 2) { stats.done++; pending[u.col]--; }
    }
    yardSync(task.drop);
    dr.tasks.delete(task.serial);
    stats.tasks++;
    stats.events++;
    if (stats.done >= stats.total && stats.endTime === null) stats.endTime = time;
  }

  /**
   * Klatka planisty: status — Float32Array (4 na drona: faza, wykonane zadania, niesione
   * kontenery, czas czekania) z odczytu GPU (albo wykonawcy CPU); writer(drone, serial, rekord)
   * — zapis zadania do pierścienia (slot serial % 2).
   */
  function update(time, status, writer) {
    for (const dr of D) {
      const o = dr.index * 4;
      const phase = status[o] | 0;
      const completed = Math.round(status[o + 1]);
      dr.phase = phase;
      while (dr.completed < completed && dr.completed < dr.assigned) {
        const t = dr.tasks.get(dr.completed);
        if (t) finish(dr, t, time);
        dr.completed++;
      }
      // Bieżące zadanie opuściło kolumnę źródła → zwolnij ją (następny może tam przylecieć).
      const cur = dr.tasks.get(dr.completed);
      if (cur && !cur.pickReleased && phase >= SWARM_PHASE.TO_DROP && phase <= SWARM_PHASE.ASC_DROP) {
        release(cur.pick, cur.id);
        cur.pickReleased = true;
      }
    }
    let mt = 0;
    for (const st of shipState.values()) {
      if (!st.active) continue;
      st.maxTrim = Math.max(st.maxTrim, st.trim);
      mt = Math.max(mt, st.trim);
    }
    stats.maxTrim = Math.max(stats.maxTrim, mt);
    // Przydziały: kolejka z wyprzedzeniem (smart) albo tylko wolne drony (naive).
    const depth = smart ? T.lookahead : 1;
    const n = D.length;
    buildCandidates();
    let budget = T.perFrame;
    // Dwa przejścia (przy lookahead 2): najpierw drony bez zadania, potem zadania „na zapas” —
    // pod koniec operacji wolny dron dostaje pracę przed tym, który i tak ma bieżące zadanie.
    for (let pass = 1; pass <= depth && budget > 0; pass++) {
      for (let k = 0; k < n && budget > 0; k++) {
        const dr = D[(rr + k) % n];
        // Odczyt może się spóźniać: nigdy więcej niż 2 zadania ponad widziane wykonane (pierścień 2).
        if (dr.assigned - dr.completed !== pass - 1) continue;
        if (assign(dr, time, writer)) budget--;
      }
    }
    rr = (rr + 1) % Math.max(1, n);
  }

  function shipTrims() {
    return [...shipState.values()].map((s) => ({ id: s.ship.id, trim: s.trim, maxTrim: s.maxTrim, mass: s.M, active: s.active }));
  }

  return {
    mode, tune: T, stats, update, shipTrims,
    /** Kontener w komórce (stan planowany) / −1. */
    unitAt,
    get counts() { return count; },
    get reserved() { return reserved; },
    columnHeight: (ci, cell) => hgt[hBase[ci] + cell],
    yardTag, unitState, unitCol, unitLevel, unitCell,
    drones: D,
    isDone: () => stats.done >= stats.total
  };
}
