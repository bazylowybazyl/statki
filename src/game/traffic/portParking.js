/**
 * POSTÓJ W PORCIE — reda, hangar postojowy i zapas okrętów w halach.
 *
 * Statek bez zlecenia (`SHIP_STATE.PARKED` w firmach przewozowych) nie znika:
 * stoi w porcie, dopóki firma nie da mu kursu. Rdzeń ruchu nie dawał mu dotąd
 * żadnej pozycji — tylko demo rozrzucało go złotym kątem wokół planety
 * (`parkingSlotPosition`, chmura). Decyzja użytkownika 2026-09-26:
 *
 *   REDA     — duże porty (ring): strefy postoju w przestrzeni POZA ringiem,
 *              między kompleksem portowym a tranzytem. Statki stoją w rzędach
 *              dziobem od planety, w rozstawie padów K-7; w 3D boje (Z7).
 *   HANGAR   — porty o małym ruchu i bez ringu: pojemność abstrakcyjna, statek
 *              wlatuje i znika z renderu.
 *   WOJSKO   — zapas okrętów frakcji (`shipyards.js`) stoi w halach K-7
 *              (stanowiska `military`), nadmiar na osobnej redzie wojskowej.
 *
 * Zmierzone przy ×60 (`.tmp/pomiar-portu-x60.mjs`, 6 h): na Ziemi czeka śr. 256,
 * p95 385, max 408 statków (vany do ~300, haulery do ~290, bulk do 69, ciężkie
 * i mega do ~18); Mars max 330. Zapas okrętów po 6 h: Mars 155–300, hale mieszczą
 * 4 × 28. Stąd pojemności: reda cywilna Ziemi ~1100 slotów, wojskowa ~850.
 *
 * Moduł jest czysty (bez DOM, bez Three, bez stanu gry). `buildPortParking`
 * robi z układu portu PLAN (strefy i sloty), a rejestr pamięta, kto gdzie stoi —
 * STABILNIE: statek zostaje na swoim slocie, dopóki nie odleci, nowy dostaje
 * wolny. Bez tej pamięci każde przeliczenie przestawiałoby flotę na oczach
 * gracza (ta sama pułapka, przez którą kolejka portu żyje w rekordach, nie w bańce).
 */

import { hullFootprint, berthRole, BERTH_ROLE } from './dockLayout.js';
import { WARSHIP_CLASSES } from './shipyards.js';
import { SHIP_STATE } from './transportCompanies.js';

// ============================================================
// Sloty
// ============================================================

/**
 * Sloty redy w standardzie padów K-7 (`K7_BANK_SLOTS` w haloPortK7Layout.js:
 * pole × rozstaw) — reda i hala mówią tym samym językiem wymiarów, pilnuje tego
 * test. `maxLength` / `maxBeam` — co się mieści (jak limity padów), `depth` —
 * długość pola wzdłuż statku (promieniowo), `pitch` — rozstaw w rzędzie (wzdłuż
 * łuku). Capital = stanowisko K-7 pod Atlasa (1800 × 806), mega = pas MEGA
 * zatoki (megafrachtowiec 2760 × 912).
 */
export const PARKING_SLOT_CLASSES = Object.freeze({
  s: Object.freeze({ id: 's', rank: 0, maxLength: 300, maxBeam: 180, depth: 400, pitch: 300 }),
  m: Object.freeze({ id: 'm', rank: 1, maxLength: 500, maxBeam: 260, depth: 620, pitch: 440 }),
  l: Object.freeze({ id: 'l', rank: 2, maxLength: 850, maxBeam: 500, depth: 1000, pitch: 760 }),
  capital: Object.freeze({ id: 'capital', rank: 3, maxLength: 2050, maxBeam: 1030, depth: 2380, pitch: 1620 }),
  mega: Object.freeze({ id: 'mega', rank: 4, maxLength: 2900, maxBeam: 1100, depth: 2900, pitch: 1300 })
});

const SLOT_ORDER = Object.freeze(Object.values(PARKING_SLOT_CLASSES).sort((a, b) => a.rank - b.rank));

/** Najmniejszy slot redy, w który kadłub się mieści (limity padów K-7). */
export function parkingClassForHull(hullId) {
  const size = hullFootprint(hullId);
  for (const cls of SLOT_ORDER) {
    if (size.length <= cls.maxLength && size.width <= cls.maxBeam) return cls;
  }
  return null;
}

export const PORT_PARKING_DEFAULTS = Object.freeze({
  /**
   * Odstęp redy od krawędzi ringu. Zostawia korytarz dla ruchu wzdłuż ringu
   * (wyloty tranzytów, dojścia do zatok). Ziemia: krawędź 43 752 → reda od 48 tys.
   */
  ringGap: 4250,
  /** Luz od płyt kompleksu (K-7 + zatoki) i tranzytu wzdłuż łuku [j. na floorMid]. */
  complexClearance: 0,
  transitClearance: 0,
  /**
   * Część sektora od strony kompleksu dla redy cywilnej; reszta, od strony
   * tranzytu, dla wojskowej — okręty „pilnują” przejść przez ring, a frachtowce
   * stoją blisko zatok, do których latają.
   */
  civilShare: 0.55,
  /** Przerwa między częścią cywilną a wojskową wzdłuż łuku [j.]. */
  roleGap: 1500,
  /** Rzędy na klasę slotu w strefie (od ringu na zewnątrz: S, M, L, capital, mega). */
  civilRows: Object.freeze({ s: 2, m: 2, l: 1, capital: 1, mega: 1 }),
  militaryRows: Object.freeze({ s: 2, m: 1, l: 1, capital: 1 }),
  /** Alejka między rzędami: ułamek głębokości slotu, nie mniej niż `aisleMin`. */
  aisleRatio: 0.25,
  aisleMin: 150,
  /** Margines skrajnego slotu od brzegu strefy wzdłuż łuku [j.]. */
  edgeMargin: 200,
  /**
   * Port z ringiem idzie do hangaru, gdy spodziewany postój (`expectedParked`,
   * np. p95 z pomiaru) nie przekracza progu. Port bez ringu — zawsze hangar.
   */
  hangarThreshold: 60,
  /** Pojemność hangaru (abstrakcyjna, statki znikają z renderu). */
  hangarCapacity: Infinity,
  /** Reda portu bez ringu (nadmiar ponad hangar): odstęp od zewnętrznej krawędzi portu. */
  openGap: 3000,
  /** Największa pół-rozpiętość strefy portu bez ringu (strefy leżą między dokami). */
  openZoneHalfAngle: Math.PI / 5
});

const TAU = Math.PI * 2;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** Kąt do [0, 2π). */
const wrapTau = (a) => ((a % TAU) + TAU) % TAU;

// ============================================================
// Plan redy
// ============================================================

/**
 * Plan postoju dla portu.
 *
 * `layout` — układ w formacie `buildStationDocks` (port ringu z
 * `buildHaloPortTrafficLayout` niesie `layout.ring`: kąty kompleksów i tranzytów,
 * krawędź ringu). `station` — środek portu ({ x, y }); dla ringu brany jest
 * środek z `layout.ring`.
 *
 * Opcje: wszystko z `PORT_PARKING_DEFAULTS` oraz `expectedParked` (do progu
 * hangaru), `mode` ('reda' | 'hangar' — wymusza), `hangar` ({ x, y, capacity }).
 */
export function buildPortParking(layout, station = null, options = {}) {
  if (!layout) return null;
  const cfg = { ...PORT_PARKING_DEFAULTS, ...options };
  const ring = layout.ring || null;
  const cx = ring ? ring.x : Number(station?.x) || 0;
  const cy = ring ? ring.y : Number(station?.y) || 0;
  const stationId = String(layout.stationId || station?.id || '');

  const zones = ring
    ? ringZones(stationId, ring, cfg)
    : openZones(stationId, layout, cx, cy, cfg);
  for (const zone of zones) {
    buildBands(zone, zone.role === BERTH_ROLE.MILITARY ? cfg.militaryRows : cfg.civilRows, cfg);
  }

  const mode = options.mode || (!ring
    ? 'hangar'
    : (Number.isFinite(cfg.expectedParked) && cfg.expectedParked <= cfg.hangarThreshold ? 'hangar' : 'reda'));

  // Wejście do hangaru: dopóki hangary nie stoją na ringu (Z7), punktem jest
  // pierwsza zatoka cywilna albo sama stacja.
  const civilDock = layout.docks?.find(d => (d.role || BERTH_ROLE.CIVIL) === BERTH_ROLE.CIVIL);
  const hangar = {
    id: `${stationId}:hangar`,
    x: Number.isFinite(options.hangar?.x) ? options.hangar.x : (ring && civilDock ? civilDock.x : cx),
    y: Number.isFinite(options.hangar?.y) ? options.hangar.y : (ring && civilDock ? civilDock.y : cy),
    capacity: options.hangar?.capacity ?? cfg.hangarCapacity
  };

  const capacity = { [BERTH_ROLE.CIVIL]: {}, [BERTH_ROLE.MILITARY]: {} };
  let maxR = 0;
  for (const zone of zones) {
    const bucket = capacity[zone.role] || (capacity[zone.role] = {});
    for (const band of zone.bands) {
      bucket[band.cls] = (bucket[band.cls] || 0) + band.slots.length;
      bucket.total = (bucket.total || 0) + band.slots.length;
    }
    maxR = Math.max(maxR, zone.r1);
  }

  return {
    stationId,
    x: cx,
    y: cy,
    hasRing: !!ring,
    mode,
    zones,
    hangar,
    capacity,
    /** Promień „przelewu” — gdy wszystko pełne, statek stoi dalej, w chmurze. */
    overflowRadius: Math.max(maxR, Number(layout.parkingRadius) || 0) + 5000
  };
}

/**
 * Strefy przy ringu: w każdym sektorze między kompleksem a sąsiednim tranzytem
 * (Ziemia: ±18°…±43° od środka kompleksu) część cywilna od strony kompleksu
 * i wojskowa od strony tranzytu. Obie zapełniają się OD ŚRODKA SEKTORA (od
 * wspólnej granicy): brzegi sektora to korytarze — podejścia do zatok i wylot
 * tranzytu — i mają zostać wolne, dopóki reda nie jest prawie pełna.
 */
function ringZones(stationId, ring, cfg) {
  const R = Math.max(1, Number(ring.floorMid) || 1);
  const r0 = (Number(ring.rim) || R) + cfg.ringGap;
  const zones = [];
  ring.complexAngles.forEach((complexAngle, c) => {
    for (const side of [-1, 1]) {
      // Najbliższy tranzyt po tej stronie kompleksu.
      let reach = Infinity;
      for (const transitAngle of ring.transitAngles || []) {
        const delta = wrapTau(side * (transitAngle - complexAngle));
        if (delta > 1e-9 && delta < reach) reach = delta;
      }
      if (!Number.isFinite(reach)) reach = Math.PI / Math.max(1, ring.complexAngles.length);
      const inner = (ring.complexHalfArc + cfg.complexClearance) / R;
      const outer = reach - (ring.transitHalfArc + cfg.transitClearance) / R;
      if (outer <= inner) continue;
      const split = inner + (outer - inner) * cfg.civilShare;
      const halfGap = cfg.roleGap / 2 / r0;
      const tag = `${c + 1}${side < 0 ? '-' : '+'}`;
      zones.push(makeZone({
        id: `${stationId}:reda-${tag}`, role: BERTH_ROLE.CIVIL, complex: c, side,
        cx: ring.x, cy: ring.y, r0,
        anchor: complexAngle + side * (split - halfGap), far: complexAngle + side * inner
      }));
      zones.push(makeZone({
        id: `${stationId}:reda-wojsk-${tag}`, role: BERTH_ROLE.MILITARY, complex: c, side,
        cx: ring.x, cy: ring.y, r0,
        anchor: complexAngle + side * (split + halfGap), far: complexAngle + side * outer
      }));
    }
  });
  return zones;
}

/**
 * Strefy portu bez ringu (nadmiar ponad hangar): za zewnętrzną krawędzią portu,
 * MIĘDZY dokami — tam, gdzie nie biegną podejścia do pomostów.
 */
function openZones(stationId, layout, cx, cy, cfg) {
  let extent = Number(layout.dockRadius) || 0;
  for (const berth of layout.berths || []) {
    const reach = Math.max(berth.length || 0, berth.width || 0) / 2;
    extent = Math.max(extent,
      Math.hypot(berth.x - cx, berth.y - cy) + reach,
      Number.isFinite(berth.approachX) ? Math.hypot(berth.approachX - cx, berth.approachY - cy) + reach : 0);
  }
  const r0 = extent + cfg.openGap;
  const dockAngles = (layout.docks || [])
    .map(d => wrapTau(Number.isFinite(d.ringAngle) ? d.ringAngle : Math.atan2(d.y - cy, d.x - cx)))
    .sort((a, b) => a - b);
  const mids = [];
  if (dockAngles.length <= 1) {
    const base = dockAngles[0] ?? 0;
    mids.push({ angle: base + Math.PI / 2, half: Math.PI / 2 }, { angle: base - Math.PI / 2, half: Math.PI / 2 });
  } else {
    dockAngles.forEach((a, i) => {
      const next = i + 1 < dockAngles.length ? dockAngles[i + 1] : dockAngles[0] + TAU;
      mids.push({ angle: (a + next) / 2, half: (next - a) / 2 });
    });
  }
  const zones = [];
  mids.forEach((mid, k) => {
    const half = Math.min(cfg.openZoneHalfAngle, mid.half * 0.6);
    const split = -half + 2 * half * cfg.civilShare;
    const halfGap = cfg.roleGap / 2 / r0;
    // Jak przy ringu: zapełnianie od wspólnej granicy, brzegi (podejścia do doków) wolne.
    zones.push(makeZone({
      id: `${stationId}:reda-${k + 1}`, role: BERTH_ROLE.CIVIL, complex: -1, side: 0,
      cx, cy, r0, anchor: mid.angle + split - halfGap, far: mid.angle - half
    }));
    zones.push(makeZone({
      id: `${stationId}:reda-wojsk-${k + 1}`, role: BERTH_ROLE.MILITARY, complex: -1, side: 0,
      cx, cy, r0, anchor: mid.angle + split + halfGap, far: mid.angle + half
    }));
  });
  return zones;
}

function makeZone({ id, role, complex, side, cx, cy, r0, anchor, far }) {
  return {
    id, role, complex, side, cx, cy, r0, r1: r0,
    a0: Math.min(anchor, far),
    a1: Math.max(anchor, far),
    /** Brzeg, od którego strefa się zapełnia (granica części cywilnej i wojskowej). */
    anchorAngle: anchor,
    bands: [],
    corners: []
  };
}

/**
 * Pasma klas w strefie: od ringu na zewnątrz S, M, L, capital, mega. Rząd to
 * łuk na stałym promieniu; statki stoją obok siebie dziobem od planety.
 * Kolejność zapełniania = odległość od narożnika przy kotwicy strefy, więc
 * zajęte sloty tworzą zwarty blok w środku sektora, a nie sznurek przez całą strefę.
 */
function buildBands(zone, rowsByClass, cfg) {
  let r = zone.r0;
  const mid = (zone.a0 + zone.a1) / 2;
  for (const cls of SLOT_ORDER) {
    const rows = Math.max(0, Math.floor(rowsByClass?.[cls.id] || 0));
    if (!rows) continue;
    const aisle = Math.max(cfg.aisleMin, cls.depth * cfg.aisleRatio);
    const rowPitch = cls.depth + aisle;
    const band = { cls: cls.id, rank: cls.rank, r0: r, r1: r + rows * rowPitch, slots: [] };
    for (let row = 0; row < rows; row++) {
      const rc = r + aisle / 2 + cls.depth / 2 + row * rowPitch;
      const span = (zone.a1 - zone.a0) * rc - 2 * cfg.edgeMargin;
      const n = Math.max(0, Math.floor(span / cls.pitch));
      for (let j = 0; j < n; j++) {
        const theta = mid + ((j - (n - 1) / 2) * cls.pitch) / rc;
        band.slots.push({
          x: zone.cx + Math.cos(theta) * rc,
          y: zone.cy + Math.sin(theta) * rc,
          // Dziób od planety: z redy odlatuje się prosto w przestrzeń.
          angle: wrapPi(theta),
          r: rc,
          theta,
          row
        });
      }
    }
    const ax = zone.cx + Math.cos(zone.anchorAngle) * band.r0;
    const ay = zone.cy + Math.sin(zone.anchorAngle) * band.r0;
    band.slots.sort((p, q) =>
      Math.hypot(p.x - ax, p.y - ay) - Math.hypot(q.x - ax, q.y - ay) || p.row - q.row || p.theta - q.theta);
    band.slots.forEach((slot, index) => { slot.index = index; });
    zone.bands.push(band);
    r = band.r1;
  }
  zone.r1 = r;
  zone.corners = [[zone.r0, zone.a0], [zone.r0, zone.a1], [zone.r1, zone.a1], [zone.r1, zone.a0]]
    .map(([rr, a]) => ({ x: zone.cx + Math.cos(a) * rr, y: zone.cy + Math.sin(a) * rr }));
}

// ============================================================
// Rejestr: kto gdzie stoi
// ============================================================

/**
 * Rejestr postoju jednej roli (`civil` — przewoźnicy, `military` — nadmiar
 * floty) w jednym porcie. Trzymaj go między wywołaniami — to on daje stabilność.
 */
export function createParkingRegistry(plan, options = {}) {
  const role = options.role || BERTH_ROLE.CIVIL;
  const zones = (plan?.zones || []).filter(zone => zone.role === role);
  const state = new Map();
  for (const zone of zones) {
    const bands = new Map();
    let capacity = 0;
    for (const band of zone.bands) {
      bands.set(band.cls, { band, owners: new Array(band.slots.length).fill(null), taken: 0 });
      capacity += band.slots.length;
    }
    state.set(zone.id, { zone, bands, taken: 0, capacity, order: state.size });
  }
  return {
    plan,
    role,
    // Nadmiar floty przy ringu stoi na redzie wojskowej nawet w porcie, którego
    // mały ruch cywilny chowa się w hangarze — okręty mają być widać.
    mode: options.mode
      || (role === BERTH_ROLE.MILITARY && plan?.hasRing ? 'reda' : plan?.mode || 'reda'),
    zones,
    state,
    /** `shipId` → miejsce: { kind: 'reda' | 'hangar' | 'overflow', x, y, angle, ... }. */
    byShip: new Map(),
    hangar: new Set(),
    hangarCapacity: options.hangarCapacity ?? plan?.hangar?.capacity ?? Infinity,
    /** Zapas okrętów w halach: `shipId` → miejsce przy stanowisku (placeFleetStock). */
    stockBerths: new Map(),
    placedInZones: 0,
    overflowSeq: 0
  };
}

/**
 * Uzgadnia rejestr z listą statków stojących teraz w porcie.
 *
 * `ships` — [{ id, hullId, idleSince? }]. Kto zniknął z listy, zwalnia miejsce;
 * kto już stoi, zostaje tam, gdzie stał; nowi (w kolejności przylotu, potem id)
 * dostają najmniej obłożoną strefę i najbliższy kotwicy wolny slot swojej klasy
 * (albo większej, gdy klasa pełna wszędzie). Zwraca `registry.byShip`.
 */
export function syncParking(registry, ships = []) {
  if (!registry) return null;
  const present = new Map();
  for (const ship of ships) if (ship?.id != null) present.set(String(ship.id), ship);

  for (const [id, spot] of registry.byShip) {
    const ship = present.get(id);
    if (!ship || (ship.hullId && spot.hullId && ship.hullId !== spot.hullId)) releaseSpot(registry, id, spot);
  }

  const newcomers = [];
  for (const [id, ship] of present) if (!registry.byShip.has(id)) newcomers.push(ship);
  newcomers.sort((a, b) => (Number(a.idleSince) || 0) - (Number(b.idleSince) || 0)
    || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  for (const ship of newcomers) assignSpot(registry, ship);
  return registry.byShip;
}

/** Miejsce postoju statku (albo `null`, gdy nie stoi w tym porcie). */
export function parkingSpot(registry, shipId) {
  return registry?.byShip?.get(String(shipId)) || null;
}

function assignSpot(registry, ship) {
  const id = String(ship.id);
  const cls = parkingClassForHull(ship.hullId);
  const hullId = ship.hullId || null;
  const hangarFirst = registry.mode === 'hangar';

  if (hangarFirst && tryHangar(registry, id, hullId)) return;
  if (cls && tryZones(registry, id, hullId, cls)) return;
  if (!hangarFirst && tryHangar(registry, id, hullId)) return;

  // Wszystko pełne: statek stoi dalej, w chmurze za redą — nie znika z rachunku.
  const plan = registry.plan;
  const k = registry.overflowSeq++;
  const angle = k * Math.PI * (3 - Math.sqrt(5));
  const radius = (plan?.overflowRadius || 0) + (k % 4) * 2500;
  registry.byShip.set(id, {
    shipId: id, hullId, kind: 'overflow', role: registry.role,
    x: (plan?.x || 0) + Math.cos(angle) * radius,
    y: (plan?.y || 0) + Math.sin(angle) * radius,
    angle: wrapPi(angle)
  });
}

function tryHangar(registry, id, hullId) {
  if (!(registry.hangar.size < registry.hangarCapacity)) return false;
  const hangar = registry.plan?.hangar;
  registry.hangar.add(id);
  registry.byShip.set(id, {
    shipId: id, hullId, kind: 'hangar', role: registry.role,
    hangarId: hangar?.id || null,
    // Punkt wejścia — sam statek w hangarze nie jest rysowany.
    x: hangar?.x ?? registry.plan?.x ?? 0,
    y: hangar?.y ?? registry.plan?.y ?? 0,
    angle: 0
  });
  return true;
}

function tryZones(registry, id, hullId, cls) {
  for (const slotCls of SLOT_ORDER) {
    if (slotCls.rank < cls.rank) continue;
    let best = null;
    for (const entry of registry.state.values()) {
      const band = entry.bands.get(slotCls.id);
      if (!band || band.taken >= band.owners.length) continue;
      if (!best || lighterZone(registry, entry, best)) best = entry;
    }
    if (!best) continue;
    const band = best.bands.get(slotCls.id);
    const index = band.owners.indexOf(null);
    const slot = band.band.slots[index];
    band.owners[index] = id;
    band.taken++;
    best.taken++;
    registry.placedInZones++;
    registry.byShip.set(id, {
      shipId: id, hullId, kind: 'reda', role: registry.role,
      zoneId: best.zone.id, cls: slotCls.id, index,
      x: slot.x, y: slot.y, angle: slot.angle
    });
    return true;
  }
  return false;
}

/** Równy rozkład między strefy: mniejsze obłożenie, remis — rotacja. */
function lighterZone(registry, a, b) {
  const lhs = a.taken * b.capacity;
  const rhs = b.taken * a.capacity;
  if (lhs !== rhs) return lhs < rhs;
  const n = registry.state.size;
  const shift = registry.placedInZones % n;
  return ((a.order - shift + n) % n) < ((b.order - shift + n) % n);
}

function releaseSpot(registry, id, spot) {
  if (spot.kind === 'hangar') registry.hangar.delete(id);
  if (spot.kind === 'reda') {
    const entry = registry.state.get(spot.zoneId);
    const band = entry?.bands.get(spot.cls);
    if (band && band.owners[spot.index] === id) {
      band.owners[spot.index] = null;
      band.taken--;
      entry.taken--;
    }
  }
  registry.byShip.delete(id);
}

/** Migawka do panelu i pomiaru: ile gdzie stoi. */
export function summarizeParking(registry) {
  const out = { reda: 0, hangar: 0, overflow: 0, berth: registry?.stockBerths?.size || 0, byZone: {}, byClass: {} };
  if (!registry) return out;
  for (const spot of registry.byShip.values()) {
    out[spot.kind] = (out[spot.kind] || 0) + 1;
    if (spot.kind === 'reda') out.byClass[spot.cls] = (out.byClass[spot.cls] || 0) + 1;
  }
  for (const entry of registry.state.values()) out.byZone[entry.zone.id] = { taken: entry.taken, capacity: entry.capacity };
  return out;
}

/**
 * Statki przewoźników stojące bez zlecenia w porcie `stationId` — wejście dla
 * `syncParking`. Jedno przejście po flocie; `out` pozwala nie alokować co tick.
 */
export function collectParkedShips(fleetRegistry, stationId, out = []) {
  out.length = 0;
  const station = String(stationId);
  for (const company of fleetRegistry?.companies || []) {
    for (const ship of company.ships) {
      if (ship.state === SHIP_STATE.PARKED && ship.stationId === station) out.push(ship);
    }
  }
  return out;
}

// ============================================================
// Zapas okrętów frakcji: hale K-7, nadmiar na redzie wojskowej
// ============================================================

/** Kolejność obsadzania: największe pierwsze, żeby fregaty nie zajęły padów nosicieli. */
export const STOCK_CLASS_ORDER = Object.freeze(['carrier', 'cruiser', 'destroyer', 'frigate']);

export const FLEET_STOCK_DEFAULTS = Object.freeze({
  /**
   * Ile stanowisk danej klasy w każdej hali zostaje wolnych dla przylotów
   * (gracz na Atlasie, dostawy ze stoczni) — zapas nie zamyka hali na głucho.
   */
  keepFree: Object.freeze({ capital: 1 }),
  /** O ile klas wyżej wolno postawić okręt, gdy jego pady są pełne (fregata na M). */
  maxUpgrade: 1,
  /** Ile okrętów z redy wolno na jedno wywołanie przenieść do zwolnionych padów. */
  promote: 2
});

/**
 * Zapas frakcji jako lista okrętów o stałych id (`frakcja:klasa:n`). Ubytek
 * zapasu (`takeShips`) zabiera najwyższe numery, więc reszta zachowuje miejsca.
 * `fleets` — { frakcja: { frigate: n, ... } } albo Map (jak `shipyards.fleets`).
 */
export function fleetStockShips(fleets) {
  const entries = fleets instanceof Map ? [...fleets.entries()] : Object.entries(fleets || {});
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const ships = [];
  for (const [factionId, stock] of entries) {
    const classes = [...STOCK_CLASS_ORDER, ...Object.keys(stock || {}).filter(k => !STOCK_CLASS_ORDER.includes(k))];
    for (const classId of classes) {
      const cls = WARSHIP_CLASSES[classId];
      const count = Math.max(0, Math.floor(Number(stock?.[classId]) || 0));
      if (!cls || !count) continue;
      for (let n = 1; n <= count; n++) {
        ships.push({ id: `${factionId}:${classId}:${n}`, factionId, classId, hullId: cls.hull });
      }
    }
  }
  return ships;
}

/**
 * Rozstawia zapas okrętów frakcji w porcie: najpierw pady hal K-7 (stanowiska
 * `military`, z ich limitami — fregata 192 × 144 staje na S 300 × 180,
 * niszczyciel na M, krążownik na L, nosiciel na capital), nadmiar na redzie
 * wojskowej (`registry` z rolą `military`).
 *
 * Zapas to WIDOK liczby, jak kontenery — nie rezerwuje stanowisk w dyspozytorze.
 * Kurs wojskowy, który dostanie pad zajęty przez okręt z zapasu, ma pierwszeństwo:
 * przy następnym wywołaniu okręt przenosi się na inny pad albo na redę.
 * Hale zapełniają się równo (najmniej obłożona hala), pady w hali — na przemian
 * burtami. Zwraca { placements: Map(shipId → miejsce), berthed, reda, hangar, overflow }.
 */
export function placeFleetStock(layout, registry, fleets, options = {}) {
  const cfg = { ...FLEET_STOCK_DEFAULTS, ...options };
  const ships = fleetStockShips(fleets);
  const halls = militaryHalls(layout);
  const memory = registry.stockBerths;
  const present = new Set(ships.map(ship => ship.id));
  for (const id of [...memory.keys()]) if (!present.has(id)) memory.delete(id);

  // Kto już stoi przy stanowisku i nadal może (pad wolny od kursu, kadłub się mieści).
  for (const ship of ships) {
    const spot = memory.get(ship.id);
    if (!spot) continue;
    const pad = halls.byId.get(spot.berthId);
    if (!pad || pad.berth.occupantId || pad.stock || !fitsPad(pad.berth, sizeOf(ship.hullId))) {
      memory.delete(ship.id);
      continue;
    }
    pad.stock = ship.id;
    pad.hall.stock++;
  }

  // Nowi i wypchnięci przez kurs — do padów (najpierw własna klasa, potem wyżej).
  const pending = ships.filter(ship => !memory.has(ship.id) && !registry.byShip.has(ship.id));
  for (let upgrade = 0; upgrade <= cfg.maxUpgrade; upgrade++) {
    for (const ship of pending) {
      if (!memory.has(ship.id)) tryPad(halls, memory, ship, upgrade, cfg);
    }
  }
  // Zwolnione pady przyjmują okręty z redy — po kilka na wywołanie, żeby hala
  // zapełniała się na oczach, a nie skokiem.
  let promoted = 0;
  for (const ship of ships) {
    if (promoted >= cfg.promote) break;
    if (memory.has(ship.id) || !registry.byShip.has(ship.id)) continue;
    for (let upgrade = 0; upgrade <= cfg.maxUpgrade; upgrade++) {
      if (tryPad(halls, memory, ship, upgrade, cfg)) { promoted++; break; }
    }
  }

  syncParking(registry, ships.filter(ship => !memory.has(ship.id)));

  const placements = new Map();
  const result = { placements, berthed: 0, reda: 0, hangar: 0, overflow: 0 };
  for (const ship of ships) {
    const spot = memory.get(ship.id) || registry.byShip.get(ship.id);
    if (!spot) continue;
    placements.set(ship.id, { ...spot, factionId: ship.factionId, classId: ship.classId, hullId: ship.hullId });
    if (spot.kind === 'berth') result.berthed++;
    else result[spot.kind] = (result[spot.kind] || 0) + 1;
  }
  return result;
}

const sizeCache = new Map();
function sizeOf(hullId) {
  let size = sizeCache.get(hullId);
  if (!size) sizeCache.set(hullId, size = hullFootprint(hullId));
  return size;
}

function fitsPad(berth, size) {
  const maxLength = Number(berth.maxLength) || Number(berth.length) || 0;
  const maxBeam = Number(berth.maxBeam) || Number(berth.width) || 0;
  return size.length <= maxLength && size.width <= maxBeam;
}

/**
 * Hale wojskowe portu: dok → pady wg klasy, na przemian burtami. Liczone od
 * nowa przy każdym wywołaniu, bo zajętość kursami zmienia się co tick.
 */
function militaryHalls(layout) {
  const byDock = new Map();
  const byId = new Map();
  for (const berth of layout?.berths || []) {
    if (berthRole(berth) !== BERTH_ROLE.MILITARY) continue;
    let hall = byDock.get(berth.dockId);
    if (!hall) {
      hall = { id: berth.dockId, order: byDock.size, total: 0, course: 0, stock: 0, byRank: new Map() };
      byDock.set(berth.dockId, hall);
    }
    hall.total++;
    if (berth.occupantId) hall.course++;
    const pad = { berth, hall, stock: null };
    byId.set(berth.id, pad);
    const list = hall.byRank.get(berth.rank) || [];
    list.push(pad);
    hall.byRank.set(berth.rank, list);
  }
  // Na przemian burtami: W-S01, E-S01, W-S02… — hala nie zapełnia się jedną ścianą.
  for (const hall of byDock.values()) {
    for (const [rank, list] of hall.byRank) {
      const sides = new Map();
      for (const pad of list) {
        const side = pad.berth.side || 0;
        if (!sides.has(side)) sides.set(side, []);
        sides.get(side).push(pad);
      }
      const lanes = [...sides.values()];
      const interleaved = [];
      for (let i = 0; interleaved.length < list.length; i++) {
        for (const lane of lanes) if (i < lane.length) interleaved.push(lane[i]);
      }
      hall.byRank.set(rank, interleaved);
    }
  }
  return { halls: [...byDock.values()], byId, placed: 0, baseRank: new Map() };
}

/** Najniższa ranga padu, na który okręt w ogóle wchodzi. */
function baseRankFor(halls, size) {
  let best = Infinity;
  for (const hall of halls.halls) {
    for (const [rank, list] of hall.byRank) {
      if (rank < best && list.some(pad => fitsPad(pad.berth, size))) best = rank;
    }
  }
  return best;
}

function tryPad(halls, memory, ship, upgrade, cfg) {
  const size = sizeOf(ship.hullId);
  let base = halls.baseRank.get(ship.hullId);
  if (base === undefined) halls.baseRank.set(ship.hullId, base = baseRankFor(halls, size));
  if (!Number.isFinite(base)) return false;
  const rank = base + upgrade;
  let bestHall = null;
  let bestPad = null;
  for (const hall of halls.halls) {
    const list = hall.byRank.get(rank);
    if (!list) continue;
    let free = 0;
    let first = null;
    for (const pad of list) {
      if (pad.berth.occupantId || pad.stock) continue;
      free++;
      if (!first && fitsPad(pad.berth, size)) first = pad;
    }
    const keep = Number(cfg.keepFree?.[list[0].berth.cls]) || 0;
    if (!first || free <= keep) continue;
    if (!bestHall || lighterHall(halls, hall, bestHall)) { bestHall = hall; bestPad = first; }
  }
  if (!bestPad) return false;
  bestPad.stock = ship.id;
  bestHall.stock++;
  halls.placed++;
  const berth = bestPad.berth;
  memory.set(ship.id, {
    shipId: ship.id, hullId: ship.hullId, kind: 'berth', role: BERTH_ROLE.MILITARY,
    berthId: berth.id, dockId: berth.dockId, cls: berth.cls,
    x: berth.x, y: berth.y, angle: berth.angle
  });
  return true;
}

function lighterHall(halls, a, b) {
  const lhs = (a.course + a.stock) * b.total;
  const rhs = (b.course + b.stock) * a.total;
  if (lhs !== rhs) return lhs < rhs;
  const n = halls.halls.length;
  const shift = halls.placed % n;
  return ((a.order - shift + n) % n) < ((b.order - shift + n) % n);
}
