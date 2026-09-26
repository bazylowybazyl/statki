/**
 * ŚCIEŻKI PORTU — warstwa 3 (bańka), lot lekkiego statku w porcie.
 *
 * Rekord kursu zna tylko punkt stanowiska (`moveDwellTo` trzyma x, y — bez
 * kursu dziobu). To wystarcza gospodarce, ale statek w bańce musi WEJŚĆ na
 * stanowisko: podejście z przestrzeni → brama hali albo wylot zatoki → pas /
 * aleja → punkt skrętu → pole STOP dziobem do stanowiska. Przy odlocie to samo
 * w drugą stronę, z wycofaniem ze stanowiska (grzebienie: tyłem do alei, pasy
 * capital i MEGA: tyłem po własnym pasie — jak gracz w K-7).
 *
 * Geometria bierze się z tych samych szablonów, z których rysowany jest port:
 * `createK7Layout` (hala K-7) i `createBayLayout` (zatoka), osadzonych przez
 * doki układu ruchu (`buildHaloPortTrafficLayout`: dok = początek huba i kąt
 * osi x huba w grze). Pomosty stacji bez ringu (`buildStationDocks`) i nieznane
 * rodzaje doków dostają ścieżkę ogólną: oś stanowiska od punktu podejścia.
 *
 * Moduł jest czystą logiką (bez DOM, bez Three). Ścieżki pisze do buforów
 * `Float64Array` — bańka nie alokuje na krok.
 *
 * Format ścieżki (wspólny z `ringRouter.js`): punkt = [x, y, vmax, flagi, s],
 * gdzie `vmax` to sufit prędkości W punkcie, a `s` — droga od początku ścieżki
 * (liczona w `pathFinalize`). Punkt 0 to miejsce, z którego statek rusza.
 */

import { createK7Layout } from '../../3d/haloRing/haloPortK7Layout.js';
import { createBayLayout } from '../../3d/haloRing/haloPortBays.js';
import { PORT_SEQUENCE } from '../../3d/haloRing/haloPortDocking.js';

// ============================================================
// Format ścieżki
// ============================================================

export const PATH_STRIDE = 5;
const PX = 0;
const PY = 1;
const PV = 2;
const PF = 3;
const PS = 4;

/** Flagi punktu — opisują ODCINEK, który się w tym punkcie kończy. */
export const WP = Object.freeze({
  /** Odcinek w porcie (brama, pas, aleja): bez separacji, precyzyjne prowadzenie. */
  PORT: 1,
  /** Skręt w stanowisko — tu statek niemal staje i obraca się na kurs pola. */
  PRECISE: 2,
  /** Odcinek przejeżdżany TYŁEM (wycofanie ze stanowiska). */
  REVERSE: 4,
  /** Koniec ścieżki z zatrzymaniem. */
  STOP: 8,
  /** Pole STOP stanowiska — tu działa okno przechwytu. */
  BERTH: 16,
  /** Korytarz tranzytu przez ring. */
  TRANSIT: 32,
  /** Wejście do wspólnego korytarza portu (brama / wylot): tu się czeka na wolny. */
  GATE: 64,
  /** Punkt redy / oczekiwania — koniec ścieżki z postojem. */
  HOLD: 128
});

export function createPath(capacity = 96) {
  return { data: new Float64Array(capacity * PATH_STRIDE), count: 0, capacity };
}

/** Czyści ścieżkę i kładzie punkt startu. */
export function pathReset(path, x, y) {
  path.count = 0;
  pathPush(path, x, y, Infinity, 0);
}

/**
 * Dokłada punkt. Pełny bufor nadpisuje OSTATNI punkt — cel ścieżki jest
 * ważniejszy od gęstości łuku (bufor ma zapas na cały objazd ringu).
 */
export function pathPush(path, x, y, vmax = Infinity, flags = 0) {
  let i = path.count;
  if (i >= path.capacity) i = path.capacity - 1;
  else path.count++;
  const o = i * PATH_STRIDE;
  const d = path.data;
  d[o + PX] = x;
  d[o + PY] = y;
  d[o + PV] = vmax;
  d[o + PF] = flags;
  d[o + PS] = 0;
  return i;
}

export function pathX(path, i) { return path.data[i * PATH_STRIDE + PX]; }
export function pathY(path, i) { return path.data[i * PATH_STRIDE + PY]; }
export function pathVmax(path, i) { return path.data[i * PATH_STRIDE + PV]; }
export function pathFlags(path, i) { return path.data[i * PATH_STRIDE + PF]; }
export function pathS(path, i) { return path.data[i * PATH_STRIDE + PS]; }
export function pathLength(path) { return path.count ? path.data[(path.count - 1) * PATH_STRIDE + PS] : 0; }

export function pathSetVmax(path, i, vmax) { path.data[i * PATH_STRIDE + PV] = vmax; }
export function pathAddFlags(path, i, flags) {
  const o = i * PATH_STRIDE + PF;
  path.data[o] = path.data[o] | flags;
}

/**
 * Domyka ścieżkę: zbędne punkty (zerowe odcinki) wypadają, a każdy punkt
 * dostaje przebytą drogę `s`. Wołane raz po złożeniu ścieżki.
 */
export function pathFinalize(path) {
  const d = path.data;
  let w = 1;
  for (let r = 1; r < path.count; r++) {
    const ro = r * PATH_STRIDE;
    const po = (w - 1) * PATH_STRIDE;
    const dx = d[ro + PX] - d[po + PX];
    const dy = d[ro + PY] - d[po + PY];
    if (dx * dx + dy * dy < 1e-6) {
      // Punkt pokrywa się z poprzednim — zostaje ostrzejszy z dwóch.
      d[po + PV] = Math.min(d[po + PV], d[ro + PV]);
      d[po + PF] = d[po + PF] | d[ro + PF];
      continue;
    }
    if (w !== r) {
      const wo = w * PATH_STRIDE;
      for (let k = 0; k < PATH_STRIDE; k++) d[wo + k] = d[ro + k];
    }
    w++;
  }
  path.count = Math.max(1, Math.min(w, path.count));
  d[PS] = 0;
  for (let i = 1; i < path.count; i++) {
    const o = i * PATH_STRIDE;
    const p = o - PATH_STRIDE;
    d[o + PS] = d[p + PS] + Math.hypot(d[o + PX] - d[p + PX], d[o + PY] - d[p + PY]);
  }
  return path;
}

/** Punkt na ścieżce w drodze `s` (do materializacji w miejscu rekordu). */
export function pathPointAt(path, s, out) {
  const d = path.data;
  const n = path.count;
  out.index = 1;
  if (n < 2) {
    out.x = d[PX]; out.y = d[PY]; out.angle = 0; out.index = 1;
    return out;
  }
  const total = d[(n - 1) * PATH_STRIDE + PS];
  const at = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < n - 1 && d[i * PATH_STRIDE + PS] < at) i++;
  const o = i * PATH_STRIDE;
  const p = o - PATH_STRIDE;
  const len = d[o + PS] - d[p + PS];
  const t = len > 1e-9 ? (at - d[p + PS]) / len : 1;
  out.x = d[p + PX] + (d[o + PX] - d[p + PX]) * t;
  out.y = d[p + PY] + (d[o + PY] - d[p + PY]) * t;
  let angle = Math.atan2(d[o + PY] - d[p + PY], d[o + PX] - d[p + PX]);
  if (d[o + PF] & WP.REVERSE) angle += Math.PI;
  out.angle = angle;
  out.index = i;
  return out;
}

/**
 * Sufit prędkości na zakrętach ścieżki.
 *
 * Statek bańki obraca się z ograniczoną prędkością kątową, więc na zakręcie
 * o kąt φ jedzie łukiem o promieniu v/ω i ścina róg o ≈ (v/ω)(1/cos(φ/2) − 1).
 * Dopuszczalne ścięcie zależy od miejsca: w alei portu kilkadziesiąt jednostek,
 * w tranzycie ~150 (prześwit ±570), w otwartej przestrzeni dużo. Zmiana
 * kierunku jazdy (przód ↔ tył) to zawsze zatrzymanie.
 */
export function pathApplyCornerSpeeds(path, turnFree, turnPort) {
  const d = path.data;
  for (let i = 1; i < path.count - 1; i++) {
    const o = i * PATH_STRIDE;
    const p = o - PATH_STRIDE;
    const q = o + PATH_STRIDE;
    const fIn = d[o + PF];
    const fOut = d[q + PF];
    if ((fIn & WP.REVERSE) !== (fOut & WP.REVERSE)) {
      d[o + PV] = Math.min(d[o + PV], 4);
      continue;
    }
    const ax = d[o + PX] - d[p + PX];
    const ay = d[o + PY] - d[p + PY];
    const bx = d[q + PX] - d[o + PX];
    const by = d[q + PY] - d[o + PY];
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    if (la < 1e-6 || lb < 1e-6) continue;
    const cos = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)));
    const phi = Math.acos(cos);
    if (phi < 0.02) continue;
    const inPort = ((fIn | fOut) & (WP.PORT | WP.PRECISE)) !== 0;
    const inTransit = ((fIn | fOut) & WP.TRANSIT) !== 0;
    const omega = inPort || inTransit ? turnPort : turnFree;
    const tol = (fIn & WP.PRECISE) ? 25 : inPort ? 90 : inTransit ? 140 : 1500;
    const cut = 1 / Math.cos(Math.min(phi, 3.0) * 0.5) - 1;
    const cap = phi > 2.6 ? 4 : omega * tol / Math.max(cut, 1e-6);
    d[o + PV] = Math.min(d[o + PV], Math.max(4, cap));
  }
  return path;
}

// ============================================================
// Prędkości i okna przechwytu
// ============================================================

/** Sufity prędkości na ścieżce portu [j./s]. Kadłub dokłada własny sufit „w porcie”. */
export const PORT_PATH_SPEED = Object.freeze({
  approach: 260,     // punkt podejścia przed bramą / wylotem
  gate: 180,         // brama hali, wylot zatoki
  aisle: 150,        // aleja grzebienia, pas capital / MEGA
  corner: 45,        // skręt z alei w stanowisko (90°)
  berth: 12,         // dojście na pole STOP — przechwyt przy ≤ 30
  reverse: 60,       // wycofanie ze stanowiska grzebienia
  reverseLane: 140   // wycofanie po pasie capital / MEGA
});

/**
 * Okno przechwytu stanowiska w osiach STATKU (wzdłuż / w poprzek kadłuba) —
 * te same liczby co automat dokowania gracza (`PortDocking.eligibility`).
 * Capital K-7: pole 145 × 180 j. (w poprzek × wzdłuż), MEGA 160 × 220,
 * reszta 70 × 55 (wzdłuż × w poprzek); prędkość ≤ 30, kurs ≤ 7°.
 */
export const CAPTURE_DEFAULTS = Object.freeze({
  capital: Object.freeze({ along: 180, across: 145 }),
  mega: Object.freeze({ along: 220, across: 160 }),
  other: Object.freeze({ along: 70, across: 55 }),
  maxSpeed: 30,
  maxAngle: 7 * Math.PI / 180,
  /** Po przechwycie poza pole STOP prowadzi interpolacja pozy (K-7: 1,1 s). */
  settleSeconds: 1.1
});

// ============================================================
// Indeks portów
// ============================================================

const K7_TEMPLATE = createK7Layout();
const K7_BERTHS = new Map(K7_TEMPLATE.berths.map(b => [b.id, b]));
const K7_GATES = new Map(K7_TEMPLATE.gates.map(g => [g.id, g]));
const K7_BANKS = new Map(K7_TEMPLATE.sideBanks.map(b => [b.side, b]));
const K7_LANES = new Map(K7_TEMPLATE.lanes.map(l => [l.berthId, l]));

const BAY_TEMPLATE = createBayLayout();
/** Stanowiska zatoki po przyrostku id („MG1”, „L03”) — wszystkie zatoki mają ten sam układ. */
const BAY_BERTHS = new Map(BAY_TEMPLATE.berths.map(b => [suffixOf(b.id), b]));
const BAY_LANES = new Map(BAY_TEMPLATE.lanes.map(l => [suffixOf(l.berthId), l]));

function suffixOf(id) {
  const text = String(id || '');
  const cut = text.indexOf('-');
  return cut >= 0 ? text.slice(cut + 1) : text;
}

/**
 * Indeks stanowisk portów bańki. Układy doków (`director.docks`: stacja →
 * układ) wystarczą — wpisy liczą się leniwie przy pierwszym stanowisku, na
 * które ktoś w bańce leci.
 */
export function createPortIndex(docks = null) {
  const index = {
    /** stationId → układ doków */
    layouts: new Map(),
    /** berthId → wpis ścieżki */
    entries: new Map(),
    /** berthId → { berth, dock, stationId } — z układów, bez liczenia ścieżek */
    berths: new Map(),
    /** klucz korytarza → liczba (porównania na krok bez napisów) */
    corridors: new Map()
  };
  if (docks) {
    const iterable = docks instanceof Map ? docks.entries() : Object.entries(docks);
    for (const [stationId, layout] of iterable) addPortLayout(index, stationId, layout);
  }
  return index;
}

/** Rejestruje (albo podmienia) układ doków stacji. */
export function addPortLayout(index, stationId, layout) {
  if (!index || !layout) return false;
  const sid = String(stationId ?? layout.stationId ?? '');
  const previous = index.layouts.get(sid);
  if (previous && previous !== layout) {
    for (const [id, ref] of index.berths) {
      if (ref.stationId === sid) { index.berths.delete(id); index.entries.delete(id); }
    }
  }
  index.layouts.set(sid, layout);
  const docksById = new Map((layout.docks || []).map(dock => [dock.id, dock]));
  for (const berth of layout.berths || []) {
    if (!berth?.id) continue;
    index.berths.set(String(berth.id), { berth, dock: docksById.get(berth.dockId) || null, stationId: sid });
  }
  return true;
}

function corridorId(index, key) {
  let id = index.corridors.get(key);
  if (id === undefined) {
    id = index.corridors.size + 1;
    index.corridors.set(key, id);
  }
  return id;
}

/**
 * Wpis stanowiska kursu. Kolejność: `course.berthId` w indeksie (to przeżyje
 * worker — sam identyfikator), potem `course.berthRef` (obiekt stanowiska
 * z dyspozytora na tym samym wątku), potem nic.
 */
export function findPortEntry(index, course) {
  if (!course) return null;
  const id = course.berthId != null ? String(course.berthId) : '';
  if (id && index) {
    const cached = index.entries.get(id);
    if (cached) return cached;
    const ref = index.berths.get(id);
    if (ref) return buildEntry(index, ref.berth, ref.dock, ref.stationId);
  }
  const berth = course.berthRef;
  if (berth && Number.isFinite(Number(berth.x)) && Number.isFinite(Number(berth.y))) {
    return portEntryForBerth(index, berth, null, course.portStationId || '');
  }
  return null;
}

/** Wpis dla obiektu stanowiska (także spoza indeksu — np. `berthRef` testu). */
export function portEntryForBerth(index, berth, dock = null, stationId = '') {
  if (!berth) return null;
  const id = berth.id != null ? String(berth.id) : '';
  if (id && index) {
    const cached = index.entries.get(id);
    if (cached && cached.berth === berth) return cached;
    const ref = index.berths.get(id);
    if (ref && ref.berth === berth) return buildEntry(index, berth, ref.dock, ref.stationId);
  }
  return buildEntry(index, berth, dock, stationId);
}

function hubToGame(dock, hx, hz, out) {
  const c = Math.cos(dock.angle);
  const s = Math.sin(dock.angle);
  out.x = dock.x + hx * c - hz * s;
  out.y = dock.y + hx * s + hz * c;
  return out;
}

function captureFor(templateBerth, cls) {
  const size = templateBerth?.size || (cls === 'capital' ? 'CAPITAL' : cls === 'mega' ? 'MEGA' : 'S');
  const cap = templateBerth?.capture;
  if (cap) {
    // `capture` K-7: halfWidth wzdłuż osi x huba, halfLength wzdłuż z — na osie
    // statku jak w PortDocking.eligibility.
    const axisX = Math.abs(Math.cos(templateBerth.angle)) > 0.5;
    return {
      along: axisX ? cap.halfWidth : cap.halfLength,
      across: axisX ? cap.halfLength : cap.halfWidth,
      maxSpeed: cap.maxSpeed ?? CAPTURE_DEFAULTS.maxSpeed,
      maxAngle: cap.maxAngle ?? CAPTURE_DEFAULTS.maxAngle
    };
  }
  const win = size === 'CAPITAL' ? CAPTURE_DEFAULTS.capital : size === 'MEGA' ? CAPTURE_DEFAULTS.mega : CAPTURE_DEFAULTS.other;
  return { along: win.along, across: win.across, maxSpeed: CAPTURE_DEFAULTS.maxSpeed, maxAngle: CAPTURE_DEFAULTS.maxAngle };
}

/**
 * Buduje wpis: poza stanowiska i szkielet ścieżki w układzie gry.
 *
 * `hub` — punkty w układzie huba doku (x wzdłuż ringu, z na zewnątrz), od
 * podejścia do stanowiska; `lane` — dla pasów (capital, MEGA) oś pasa i jego
 * wylot, bo tam wycofanie zależy od długości kadłuba.
 */
function buildEntry(index, berth, dock, stationId) {
  const bx = Number(berth.x);
  const by = Number(berth.y);
  const angle = Number(berth.angle) || 0;
  const cls = String(berth.cls || '');
  const entry = {
    berthId: berth.id != null ? String(berth.id) : '',
    stationId: String(stationId || berth.stationId || ''),
    berth,
    dock,
    kind: 'pier',
    x: bx,
    y: by,
    angle,
    cls,
    crane: false,
    sequence: PORT_SEQUENCE.clamp,
    capture: null,
    corridor: 0,
    /** Szkielet wejścia: [x, y, vmax, flagi] × n, od podejścia do stanowiska. */
    inbound: new Float64Array(8 * 4),
    inboundCount: 0,
    /** Oś wyjścia z pola (jednostkowa, od stanowiska na zewnątrz). */
    axisX: -Math.cos(angle),
    axisY: -Math.sin(angle),
    /** Pas (capital / MEGA): wycofanie do wylotu pasa zamiast do alei. */
    lane: false,
    /** Droga od stanowiska do punktu, w którym kończy się wycofanie (grzebień). */
    reverseTo: 0,
    /** Dla pasa: odległość wzdłuż osi od stanowiska do wylotu konstrukcji. */
    mouthDepth: 0,
    laneEndDepth: 0
  };
  const tmp = { x: 0, y: 0 };
  const put = (hx, hz, vmax, flags) => {
    const k = entry.inboundCount++;
    hubToGame(dock, hx, hz, tmp);
    entry.inbound[k * 4] = tmp.x;
    entry.inbound[k * 4 + 1] = tmp.y;
    entry.inbound[k * 4 + 2] = vmax;
    entry.inbound[k * 4 + 3] = flags;
  };
  const S = PORT_PATH_SPEED;
  const kind = dock?.kind;
  const hasHub = !!dock && Number.isFinite(Number(dock.angle))
    && Number.isFinite(Number(berth.lx)) && Number.isFinite(Number(berth.ly));

  if (hasHub && kind === 'k7' && K7_BERTHS.has(String(berth.k7BerthId))) {
    const tb = K7_BERTHS.get(String(berth.k7BerthId));
    entry.kind = 'k7';
    entry.capture = captureFor(tb, cls);
    if (tb.size === 'CAPITAL') {
      const lane = K7_LANES.get(tb.id);
      const gateZ = K7_TEMPLATE.frontZ;
      const approachZ = K7_TEMPLATE.frontZ + K7_TEMPLATE.apronDepth + 600;
      entry.crane = true;
      entry.sequence = PORT_SEQUENCE.crane;
      entry.lane = true;
      entry.mouthDepth = gateZ - tb.z;
      entry.laneEndDepth = (lane ? lane.z1 : gateZ + K7_TEMPLATE.apronDepth) - tb.z;
      put(tb.x, approachZ, S.approach, WP.PORT);
      put(tb.x, gateZ, S.gate, WP.PORT | WP.GATE);
      put(tb.x, tb.z, S.berth, WP.PORT | WP.BERTH | WP.STOP);
      entry.corridor = corridorId(index, `${dock.id}|lane|${tb.id}`);
    } else {
      const gate = K7_GATES.get(tb.side < 0 ? 'G-03' : 'G-02');
      const bank = K7_BANKS.get(tb.side);
      put(gate.x + gate.nx * 900, gate.z + gate.nz * 900, S.approach, WP.PORT);
      put(gate.x, gate.z, S.gate, WP.PORT | WP.GATE);
      put(bank.aisleX, bank.z1, S.aisle, WP.PORT);
      put(tb.approach.from.x, tb.approach.from.z, S.corner, WP.PORT | WP.PRECISE);
      put(tb.x, tb.z, S.berth, WP.PORT | WP.BERTH | WP.STOP);
      entry.reverseTo = Math.hypot(tb.approach.from.x - tb.x, tb.approach.from.z - tb.z);
      entry.corridor = corridorId(index, `${dock.id}|bank|${tb.side}`);
    }
  } else if (hasHub && kind === 'bay' && BAY_BERTHS.has(suffixOf(berth.k7BerthId))) {
    const tb = BAY_BERTHS.get(suffixOf(berth.k7BerthId));
    entry.kind = 'bay';
    entry.capture = captureFor(tb, cls);
    const openZ = BAY_TEMPLATE.openZ;
    if (tb.size === 'MEGA') {
      const lane = BAY_LANES.get(suffixOf(tb.id));
      entry.lane = true;
      entry.mouthDepth = openZ - tb.z;
      entry.laneEndDepth = (lane ? lane.z1 : openZ + 1200) - tb.z;
      put(tb.x, openZ + 1500, S.approach, WP.PORT);
      put(tb.x, openZ, S.gate, WP.PORT | WP.GATE);
      put(tb.x, tb.z, S.berth, WP.PORT | WP.BERTH | WP.STOP);
      entry.corridor = corridorId(index, `${dock.id}|lane|${suffixOf(tb.id)}`);
    } else {
      const aisleX = BAY_TEMPLATE.aisle.x;
      put(aisleX, openZ + 700, S.approach, WP.PORT);
      put(aisleX, openZ, S.gate, WP.PORT | WP.GATE);
      put(tb.approach.from.x, tb.approach.from.z, S.corner, WP.PORT | WP.PRECISE);
      put(tb.x, tb.z, S.berth, WP.PORT | WP.BERTH | WP.STOP);
      entry.reverseTo = Math.hypot(tb.approach.from.x - tb.x, tb.approach.from.z - tb.z);
      entry.corridor = corridorId(index, `${dock.id}|comb`);
    }
  } else {
    // Pomost stacji bez ringu albo nieznany dok: oś stanowiska od punktu podejścia.
    entry.kind = 'pier';
    entry.capture = captureFor(null, cls);
    let ax = Number(berth.approachX);
    let ay = Number(berth.approachY);
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.hypot(ax - bx, ay - by) < 1) {
      const reach = Math.max(400, Number(berth.length) || 0);
      ax = bx - Math.cos(angle) * reach;
      ay = by - Math.sin(angle) * reach;
    }
    const len = Math.hypot(ax - bx, ay - by);
    entry.axisX = (ax - bx) / len;
    entry.axisY = (ay - by) / len;
    // Punkt podejścia pomostu leży 0,9 długości STANOWISKA od pola — dla
    // krótkiego kadłuba to za blisko na wyrównanie; przesunięcie dokłada
    // `writeInbound` z długości kadłuba.
    entry.inbound[0] = ax;
    entry.inbound[1] = ay;
    entry.inbound[2] = S.approach;
    entry.inbound[3] = WP.PORT;
    entry.inbound[4] = bx;
    entry.inbound[5] = by;
    entry.inbound[6] = S.berth;
    entry.inbound[7] = WP.PORT | WP.BERTH | WP.STOP;
    entry.inboundCount = 2;
    entry.reverseTo = len;
    entry.corridor = corridorId(index, `${entry.stationId}|pier|${entry.berthId || `${bx},${by}`}`);
  }

  if (entry.kind !== 'pier') {
    // Oś wyjścia: od stanowiska do poprzedniego punktu szkieletu (aleja / pas).
    const k = entry.inboundCount - 2;
    const px = entry.inbound[k * 4];
    const py = entry.inbound[k * 4 + 1];
    const len = Math.hypot(px - bx, py - by) || 1;
    entry.axisX = (px - bx) / len;
    entry.axisY = (py - by) / len;
  }
  if (entry.berthId && index) index.entries.set(entry.berthId, entry);
  return entry;
}

/** Punkt podejścia wpisu (pierwszy punkt szkieletu) — tam kończy się trasa z przestrzeni. */
export function portApproachPoint(entry, hull, out) {
  if (entry.kind === 'pier') {
    const reach = pierReach(entry, hull);
    out.x = entry.x + entry.axisX * reach;
    out.y = entry.y + entry.axisY * reach;
    return out;
  }
  out.x = entry.inbound[0];
  out.y = entry.inbound[1];
  return out;
}

function pierReach(entry, hull) {
  const base = Math.hypot(entry.inbound[0] - entry.x, entry.inbound[1] - entry.y);
  const length = Math.max(40, Number(hull?.length) || 0);
  return Math.max(base, length * 1.2 + 300);
}

/**
 * Wejście: dokłada do ścieżki punkty od podejścia do pola STOP.
 * `fromIndex` = 1 pomija punkt podejścia (trasa z przestrzeni już go dała).
 */
export function writeInbound(entry, path, hull, fromIndex = 0) {
  if (!entry) return 0;
  const before = path.count;
  const cap = inPortCap(hull);
  if (entry.kind === 'pier') {
    const reach = pierReach(entry, hull);
    if (fromIndex <= 0) pathPush(path, entry.x + entry.axisX * reach, entry.y + entry.axisY * reach,
      Math.min(PORT_PATH_SPEED.approach, cap), WP.PORT);
    pathPush(path, entry.x, entry.y, PORT_PATH_SPEED.berth, WP.PORT | WP.BERTH | WP.STOP);
    return path.count - before;
  }
  for (let k = Math.max(0, fromIndex); k < entry.inboundCount; k++) {
    const o = k * 4;
    pathPush(path, entry.inbound[o], entry.inbound[o + 1], Math.min(entry.inbound[o + 2], cap), entry.inbound[o + 3]);
  }
  return path.count - before;
}

/**
 * Wyjście ze stanowiska. Statek stoi na polu (punkt 0 ścieżki = stanowisko):
 *  - grzebień: tyłem do alei, potem przodem aleją do bramy i do punktu podejścia;
 *  - pas capital / MEGA: tyłem po pasie aż kadłub wyjdzie z konstrukcji, potem
 *    obrót i przodem na zewnątrz osią pasa;
 *  - pomost: tyłem na długość kadłuba, potem przodem osią stanowiska.
 * Kończy się punktem na zewnętrznej osi (dalej prowadzi router ringu).
 */
export function writeOutbound(entry, path, hull) {
  if (!entry) return 0;
  const before = path.count;
  const cap = inPortCap(hull);
  const length = Math.max(40, Number(hull?.length) || 0);
  const S = PORT_PATH_SPEED;
  if (entry.lane) {
    // Wylot pasa: dziób (skierowany do wnętrza) musi minąć bramę / wylot zatoki.
    const clear = Math.max(entry.laneEndDepth, entry.mouthDepth + length * 0.5 + 260);
    pathPush(path, entry.x + entry.axisX * clear, entry.y + entry.axisY * clear,
      Math.min(S.reverseLane, cap), WP.PORT | WP.REVERSE);
    const out = clear + Math.max(700, length * 0.6);
    pathPush(path, entry.x + entry.axisX * out, entry.y + entry.axisY * out, Math.min(S.approach, cap), WP.PORT);
    return path.count - before;
  }
  if (entry.kind === 'pier') {
    const back = Math.max(entry.reverseTo * 0.5, length * 0.6 + 200);
    pathPush(path, entry.x + entry.axisX * back, entry.y + entry.axisY * back, Math.min(S.reverse, cap), WP.PORT | WP.REVERSE);
    const reach = Math.max(pierReach(entry, hull), back + 400);
    pathPush(path, entry.x + entry.axisX * reach, entry.y + entry.axisY * reach, Math.min(S.approach, cap), WP.PORT);
    return path.count - before;
  }
  // Grzebień: tyłem do punktu skrętu w alei, dalej szkielet wejścia wspak.
  const k = entry.inboundCount - 2;
  pathPush(path, entry.inbound[k * 4], entry.inbound[k * 4 + 1], Math.min(S.reverse, cap), WP.PORT | WP.REVERSE);
  for (let j = k - 1; j >= 0; j--) {
    const o = j * 4;
    // Brama przy wyjeździe nie jest punktem czekania — flaga GATE zostaje tylko dla wjazdu.
    pathPush(path, entry.inbound[o], entry.inbound[o + 1], Math.min(entry.inbound[o + 2], cap), WP.PORT);
  }
  return path.count - before;
}

/**
 * Sufit prędkości kadłuba w porcie — liczby modelu lotu K-7 (`haloPortHulls`:
 * prom 250, kontenerowiec 240, dalekiego zasięgu 230, ciężki 200, mega 170).
 */
export function inPortCap(hull) {
  const length = Math.max(40, Number(hull?.length) || 300);
  return Math.max(150, 252 - 0.03 * length);
}

/**
 * Błąd pozy względem pola STOP w osiach statku (wzdłuż / w poprzek) i kursu.
 * Wynik w `out` — bez alokacji.
 */
export function berthPoseError(entry, x, y, angle, out) {
  const c = Math.cos(entry.angle);
  const s = Math.sin(entry.angle);
  const dx = x - entry.x;
  const dy = y - entry.y;
  out.along = dx * c + dy * s;
  out.across = -dx * s + dy * c;
  let da = angle - entry.angle;
  da -= Math.PI * 2 * Math.round(da / (Math.PI * 2));
  out.angle = da;
  return out;
}

/** Czy statek mieści się w oknie przechwytu (pozycja, kurs, prędkość, obrót). */
export function berthCaptureOk(entry, x, y, angle, speed, angVel, scratch) {
  const cap = entry.capture;
  const e = berthPoseError(entry, x, y, angle, scratch);
  return Math.abs(e.along) <= cap.along
    && Math.abs(e.across) <= cap.across
    && Math.abs(e.angle) <= cap.maxAngle
    && Math.abs(speed) <= cap.maxSpeed
    && Math.abs(angVel) <= 0.07;
}
