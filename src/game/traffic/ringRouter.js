/**
 * ROUTER RINGU — trasa lekkiego statku bańki przy ringu „Halo”.
 *
 * Ring leży W PŁASZCZYŹNIE GRY (płaszczyzna przecina podłogę habitatu w połowie
 * szerokości wstęgi), więc dla statku jest pierścieniową ścianą:
 *
 *   planeta | korytarz wewnętrzny | PŁYTA (kadłub → podłoga + teren) | strefa portu | przestrzeń
 *   Ziemia:   37,8 tys.   …   41,8 (kadłub) … 42,25 (podłoga) + góry  … hale K-7 do ~51 tys.
 *
 * Habitat patrzy w kosmos, więc do bram hal i wylotów zatok dolatuje się z
 * przestrzeni bez przecinania płyty. Przez płytę prowadzą tylko 4 tranzyty
 * (korytarz ±570 j. na kącie stacji + 45° + k·90°, `HALO_TRANSIT`).
 *
 * Zasady trasy (sprawdzane testem `scripts/tests/ringRouter.test.mjs`):
 *  - w strefie portu statek porusza się tylko PROMIENIOWO: od punktu podejścia
 *    do „lejka” nad nim i z powrotem — nad kompleksami nie ma przelotów w poprzek;
 *  - dookoła planety lata się łukiem na promieniu `arcR` (za halami i redą);
 *    prosta między dwoma punktami na zewnątrz, która przecina dysk `keepR`,
 *    dostaje objazd: styczna → łuk → styczna (krótszą stroną) — jak objazdy
 *    okręgów w `planCruiseRoute` gracza, tylko analitycznie;
 *  - punkt po stronie planety wychodzi najtańszym tranzytem: łuk korytarza
 *    wewnętrznego → oś tranzytu → lejek.
 *
 * Czysta matematyka (bez DOM i Three). Pisze do bufora ścieżki z `portPaths.js`.
 */

import { HALO_TRANSIT, haloPortSites, haloTransitAngles } from '../../3d/haloRing/haloRingConfig.js';
import { createK7Layout, k7Frame } from '../../3d/haloRing/haloPortK7Layout.js';
import { createBayLayout } from '../../3d/haloRing/haloPortBays.js';
import { HALO_COLLISION } from '../haloRingCollision.js';
import {
  HALO_RING_PLANETS, haloRingKey, haloRingLayoutFor, createHaloRingPlacement, haloLocalToGame
} from '../haloRingPlanets.js';
import { resolveRingPlanetWorldRadius } from '../../3d/ringScale.js';
import { pathPush, WP, PATH_STRIDE } from './portPaths.js';

const TAU = Math.PI * 2;

export const RING_ROUTER_DEFAULTS = Object.freeze({
  /** Zapas nad płytą (kadłub od strony planety, teren od strony habitatu). */
  slabClearance: 250,
  /**
   * Ile ponad najdalszy punkt portu (podejście do bramy G-01 ≈ 51,2 tys. j.
   * na Ziemi) leży dysk objazdu. 8,5 tys. wyprowadza łuk ponad redę
   * (plan: r ≈ 48–58 tys.), więc statki okrążające planetę nie przecinają
   * czekających. TODO AGENT: gdy reda z Z2 (`portParking.js`) poda swój
   * promień zewnętrzny, `keepR` ma być ≥ niego.
   */
  arcMargin: 8500,
  /** Najdłuższy łuk wielokąta objazdu — cięciwa nie schodzi pod `keepR`. */
  arcStep: 10 * Math.PI / 180,
  /** Zapas od planety w korytarzu wewnętrznym. */
  planetMargin: 500,
  /** Wyrównanie przed wlotem tranzytu (statek musi wejść osią korytarza). */
  transitLead: 1800,
  /** Wlot / wylot tranzytu nad płytą. */
  transitMouth: 350,
  /** Sufit prędkości w tranzycie [j./s]. */
  transitSpeed: 260
});

/** Strefa punktu względem ringu. */
export const RING_ZONE = Object.freeze({
  /** Poza dyskiem objazdu — prosta albo objazd łukiem. */
  OUTER: 0,
  /** Między płytą a dyskiem objazdu (hale, zatoki, reda) — tylko promieniowo. */
  PORT: 1,
  /** W płycie, poza tranzytem. */
  SLAB: 2,
  /** W płycie, w korytarzu tranzytu. */
  TRANSIT: 3,
  /** Korytarz między planetą a kadłubem ringu. */
  INNER: 4,
  /** W planecie — punkt abstrakcyjny (środek węzła), nie fizyczny. */
  CORE: 5
});

/**
 * Najdalszy punkt konstrukcji portu od środka ringu: podejścia do bram hal
 * K-7 i wylotów zatok (szablony, z których rysowany jest port).
 */
function templatePortOuter(ringLayout) {
  const frame = k7Frame(ringLayout);
  const R0 = frame.radius;
  const hall = createK7Layout();
  let outer = R0 + hall.frontZ + hall.apronDepth + 600;
  for (const gate of hall.gates) {
    const x = gate.x + gate.nx * 900;
    const z = gate.z + gate.nz * 900;
    outer = Math.max(outer, Math.hypot(R0 + z, x));
  }
  const bay = createBayLayout();
  outer = Math.max(outer, Math.hypot(R0 + bay.openZ + 1500, bay.halfWidth));
  return outer;
}

/**
 * Przeszkoda-ring w układzie gry.
 *
 * `spec`: `{ key: 'earth' | 'mars', x, y }` (środek planety w układzie ruchu —
 * ten sam, od którego liczy port `buildHaloPortTrafficLayout`), opcjonalnie
 * `layout` (układ doków portu — z jego punktów podejścia liczy się zasięg
 * portu), `portOuter`, `keepR`, `planetRadius`, `ringLayout`.
 */
export function createRingObstacle(spec = {}, options = {}) {
  const config = { ...RING_ROUTER_DEFAULTS, ...options };
  const key = haloRingKey(spec.key || spec.id || spec);
  const ringLayout = spec.ringLayout || (key ? haloRingLayoutFor({ id: key }) : null);
  if (!ringLayout) return null;
  const x = Number(spec.x) || 0;
  const y = Number(spec.y) || 0;
  const radii = ringLayout.radii;
  const planetR = Number(spec.planetRadius) || (key ? resolveRingPlanetWorldRadius(key) : radii.back * 0.9);

  // Zasięg portu: z punktów podejścia układu doków, inaczej z szablonów.
  let portOuter = Number(spec.portOuter) || 0;
  if (!portOuter && spec.layout?.berths?.length) {
    for (const berth of spec.layout.berths) {
      const ax = Number(berth.approachX);
      const ay = Number(berth.approachY);
      if (Number.isFinite(ax) && Number.isFinite(ay)) portOuter = Math.max(portOuter, Math.hypot(ax - x, ay - y));
      portOuter = Math.max(portOuter, Math.hypot(Number(berth.x) - x, Number(berth.y) - y) || 0);
    }
  }
  if (!portOuter) portOuter = templatePortOuter(ringLayout);
  portOuter += 300;

  const slabInner = radii.back - config.slabClearance;
  const slabOuter = radii.floorMid + HALO_COLLISION.terrainReach + config.slabClearance;
  const keepR = Math.max(Number(spec.keepR) || 0, portOuter + config.arcMargin, slabOuter + 2000);
  const arcR = keepR / Math.cos(config.arcStep * 0.5);
  const planetBound = planetR + config.planetMargin;

  // Tranzyty: osie w układzie ringu (scena) → kąty w grze przez obrót grupy.
  const place = key ? createHaloRingPlacement({ id: key, x, y }) : { x, y, cos: 1, sin: 0, rot: 0 };
  const tmp = { x: 0, y: 0 };
  const gameAngle = (theta) => {
    haloLocalToGame(place, Math.cos(theta) * 1000, Math.sin(theta) * 1000, tmp);
    return Math.atan2(tmp.y - y, tmp.x - x);
  };
  const localAngles = haloTransitAngles();
  const transitAngles = new Float64Array(localAngles.length);
  localAngles.forEach((theta, i) => { transitAngles[i] = gameAngle(theta); });

  // Płyty portu (hale K-7, zatoki): w ich obrębie podłoga jest płaska (pad
  // +7 j.), a nie teren z górami — hale stoją NA podłodze, nie w płycie.
  const sites = haloPortSites(radii.floorMid).filter((site) => site.kind !== 'transit');
  const pads = new Float64Array(sites.length * 2);
  sites.forEach((site, i) => {
    pads[i * 2] = gameAngle(site.theta);
    pads[i * 2 + 1] = site.halfS / radii.floorMid;
  });

  return {
    key: key || String(spec.id || 'ring'),
    x,
    y,
    rot: place.rot || 0,
    planetR,
    planetBound,
    back: radii.back,
    floorMid: radii.floorMid,
    slabInner,
    slabOuter,
    portOuter,
    keepR,
    arcR,
    freeR: arcR + 40,
    funnelR: arcR + 120,
    innerR: (planetBound + slabInner) * 0.5,
    transitAngles,
    /** Pół-prześwit tranzytu (bez ścian) [j.] i jego kąt na promieniu podłogi. */
    transitHalfWidth: HALO_TRANSIT.halfWidth,
    transitHalf: HALO_TRANSIT.halfWidth / radii.floorMid,
    /** Płyty portu: [kąt w grze, pół-rozpiętość kątowa] × n. */
    pads,
    /** Wierzch płyty w portach (pad nad podłogą) i poza nimi (teren). */
    padTop: radii.floorMid + HALO_COLLISION.padHeight,
    terrainTop: radii.floorMid + HALO_COLLISION.terrainReach,
    config
  };
}

/** Ringi planet ruchu (Ziemia, Mars) z węzłów sieci — `network.nodes` albo mapa. */
export function createRingObstaclesForNetwork(network, docks = null, options = {}) {
  const rings = [];
  for (const key of Object.keys(HALO_RING_PLANETS)) {
    const node = network?.nodes?.get?.(key) || null;
    if (!node) continue;
    const layout = docks?.get?.(key) || null;
    const ring = createRingObstacle({ key, x: node.x, y: node.y, layout: layout?.hasRing ? layout : null }, options);
    if (ring) rings.push(ring);
  }
  return rings;
}

// ============================================================
// Geometria
// ============================================================

function wrapPi(a) {
  let v = a;
  v -= TAU * Math.round(v / TAU);
  return v;
}

function wrap2Pi(a) {
  const v = a % TAU;
  return v < 0 ? v + TAU : v;
}

/** Odległość punktu (px, py) od odcinka AB. */
export function segmentPointDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 1e-12 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(ax + vx * t - px, ay + vy * t - py);
}

/** Indeks tranzytu, w którego korytarzu leży punkt (−1 = żaden). */
export function transitIndexAt(ring, x, y) {
  const angle = Math.atan2(y - ring.y, x - ring.x);
  const r = Math.hypot(x - ring.x, y - ring.y);
  const half = ring.transitHalfWidth / Math.max(1, r);
  for (let i = 0; i < ring.transitAngles.length; i++) {
    if (Math.abs(wrapPi(angle - ring.transitAngles[i])) < half) return i;
  }
  return -1;
}

/** Czy kąt (w grze, względem środka ringu) leży nad płytą portu. */
function onPortPad(ring, angle) {
  const pads = ring.pads;
  for (let i = 0; i < pads.length; i += 2) {
    if (Math.abs(wrapPi(angle - pads[i])) <= pads[i + 1]) return true;
  }
  return false;
}

/** Wierzch płyty ringu pod kątem punktu: płyta portu (+7 j.) albo teren (do ~1400 j.). */
export function ringFloorTopAt(ring, x, y) {
  return onPortPad(ring, Math.atan2(y - ring.y, x - ring.x)) ? ring.padTop : ring.terrainTop;
}

export function ringZoneAt(ring, x, y) {
  const r = Math.hypot(x - ring.x, y - ring.y);
  if (r >= ring.freeR) return RING_ZONE.OUTER;
  if (r > ring.slabOuter) return RING_ZONE.PORT;
  if (r >= ring.slabInner) {
    if (transitIndexAt(ring, x, y) >= 0) return RING_ZONE.TRANSIT;
    // Nad płytą portu (wnętrze hali, zatoka) to już strefa portu, nie płyta.
    return r > ring.padTop + 40 && onPortPad(ring, Math.atan2(y - ring.y, x - ring.x))
      ? RING_ZONE.PORT : RING_ZONE.SLAB;
  }
  if (r > ring.planetR) return RING_ZONE.INNER;
  return RING_ZONE.CORE;
}

/**
 * Punkt w płycie ringu (kadłub → podłoga + teren; w portach → podłoga + pad)
 * POZA korytarzem tranzytu. Prześwit tranzytu liczony w jednostkach (±570).
 */
export function pointInRingSlab(ring, x, y) {
  const r = Math.hypot(x - ring.x, y - ring.y);
  if (r < ring.back || r > ring.terrainTop) return false;
  if (transitIndexAt(ring, x, y) >= 0) return false;
  return r <= ringFloorTopAt(ring, x, y);
}

/** Pierwszy ring, w którego dysku objazdu (albo wnętrzu) leży punkt. */
export function ringAt(rings, x, y) {
  if (!rings) return null;
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    const dx = x - ring.x;
    const dy = y - ring.y;
    if (dx * dx + dy * dy < ring.freeR * ring.freeR) return ring;
  }
  return null;
}

/**
 * Czy punkt jest ABSTRAKCYJNY — środek węzła planety z ringiem (kursy bez
 * własnych końców lecą „ze środka planety”). Taki punkt podmienia się na
 * lejek na promieniu w stronę drugiego końca, zamiast go dosłownie przelatywać.
 */
export function isRingCorePoint(rings, x, y) {
  const ring = ringAt(rings, x, y);
  return !!ring && Math.hypot(x - ring.x, y - ring.y) <= ring.planetR;
}

/** Lejek: punkt na promieniu `funnelR` pod kątem (x, y) względem środka ringu. */
export function ringFunnelPoint(ring, x, y, out) {
  let dx = x - ring.x;
  let dy = y - ring.y;
  let r = Math.hypot(dx, dy);
  if (r < 1e-6) { dx = 1; dy = 0; r = 1; }
  out.x = ring.x + dx / r * ring.funnelR;
  out.y = ring.y + dy / r * ring.funnelR;
  return out;
}

// ============================================================
// Trasa
// ============================================================

const _a = { x: 0, y: 0 };
const _b = { x: 0, y: 0 };

function pushPolar(path, ring, r, angle, vmax, flags) {
  pathPush(path, ring.x + Math.cos(angle) * r, ring.y + Math.sin(angle) * r, vmax, flags);
}

/** Łuk wielokątem na promieniu r od kąta a0 o przyrost `delta` (bez punktu startowego). */
function pushArc(path, ring, r, a0, delta, step) {
  const n = Math.max(1, Math.ceil(Math.abs(delta) / step));
  for (let k = 1; k <= n; k++) pushPolar(path, ring, r, a0 + delta * (k / n), Infinity, 0);
}

/**
 * Objazd dysku `keepR` między dwoma punktami na zewnątrz (oba ≥ freeR):
 * styczna → łuk po `arcR` → styczna, krótszą stroną. Zwraca false, gdy prosta
 * i tak omija dysk (nic nie dopisuje).
 */
function pushDetour(path, ring, px, py, qx, qy) {
  if (segmentPointDistance(ring.x, ring.y, px, py, qx, qy) >= ring.keepR) return false;
  const R = ring.arcR;
  const dp = Math.hypot(px - ring.x, py - ring.y);
  const dq = Math.hypot(qx - ring.x, qy - ring.y);
  const fp = Math.atan2(py - ring.y, px - ring.x);
  const fq = Math.atan2(qy - ring.y, qx - ring.x);
  const ap = Math.acos(Math.min(1, R / Math.max(R, dp)));
  const aq = Math.acos(Math.min(1, R / Math.max(R, dq)));
  // Przeciwnie do wskazówek (kąt rośnie): zejście ze stycznej przy fp + ap,
  // wejście na styczną do Q przy fq − aq. Zgodnie — lustrzanie.
  const ccw = wrap2Pi((fq - aq) - (fp + ap));
  const cw = wrap2Pi((fp - ap) - (fq + aq));
  const step = ring.config.arcStep;
  if (ccw <= cw) {
    const a0 = fp + ap;
    pushPolar(path, ring, R, a0, Infinity, 0);
    pushArc(path, ring, R, a0, ccw, step);
  } else {
    const a0 = fp - ap;
    pushPolar(path, ring, R, a0, Infinity, 0);
    pushArc(path, ring, R, a0, -cw, step);
  }
  return true;
}

/** Tranzyt najtańszy dla drogi z kąta `fromAngle` (po stronie planety) do punktu `(tx, ty)`. */
function pickTransit(ring, fromAngle, tx, ty) {
  let best = 0;
  let bestCost = Infinity;
  const toAngle = Math.atan2(ty - ring.y, tx - ring.x);
  const toR = Math.hypot(tx - ring.x, ty - ring.y);
  for (let i = 0; i < ring.transitAngles.length; i++) {
    const t = ring.transitAngles[i];
    const inner = Math.abs(wrapPi(t - fromAngle)) * ring.innerR;
    let outer;
    if (toR < ring.freeR * 1.5) {
      outer = Math.abs(wrapPi(toAngle - t)) * Math.max(ring.arcR, Math.min(toR, ring.funnelR));
    } else {
      outer = Math.hypot(tx - (ring.x + Math.cos(t) * ring.funnelR), ty - (ring.y + Math.sin(t) * ring.funnelR));
    }
    const cost = inner + outer;
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  return best;
}

/** Łuk korytarza wewnętrznego od kąta a0 do a1 krótszą stroną (bez punktu startowego). */
function pushInnerArc(path, ring, a0, a1) {
  const delta = wrapPi(a1 - a0);
  if (Math.abs(delta) < 1e-4) return;
  pushArc(path, ring, ring.innerR, a0, delta, ring.config.arcStep * 1.5);
}

/** Oś tranzytu `i` od strony planety na zewnątrz (albo odwrotnie), z lejkiem. */
/**
 * Oś tranzytu `i`. Od strony planety wyrównaniem jest sam koniec łuku
 * korytarza wewnętrznego (na osi, `innerR`) — korytarz ma ~3,2 tys. j., więc
 * osobny punkt wyrównania wypadałby POD łukiem i kazał zawracać o 180°
 * (duże kadłuby krążyły wokół niego). Od strony przestrzeni — `transitLead`
 * nad płytą.
 */
function pushTransit(path, ring, i, outward) {
  const a = ring.transitAngles[i];
  const c = ring.config;
  const v = c.transitSpeed;
  const F = WP.TRANSIT;
  const inMouth = ring.slabInner - c.transitMouth;
  const outMouth = ring.slabOuter + c.transitMouth;
  const outLead = ring.slabOuter + c.transitLead;
  if (outward) {
    pushPolar(path, ring, inMouth, a, v, F);
    pushPolar(path, ring, outMouth, a, v, F);
    pushPolar(path, ring, outLead, a, v, F);
    pushPolar(path, ring, ring.funnelR, a, Infinity, 0);
  } else {
    pushPolar(path, ring, ring.funnelR, a, Infinity, 0);
    pushPolar(path, ring, outLead, a, v, F);
    pushPolar(path, ring, outMouth, a, v, F);
    pushPolar(path, ring, inMouth, a, v, F);
    pushPolar(path, ring, ring.innerR, a, v, F);
  }
}

/**
 * Wyjście z punktu A do przestrzeni (≥ freeR) względem jego ringu. Dopisuje
 * punkty (bez samego A) i zwraca w `out` punkt, od którego trasa jest wolna.
 * `tx, ty` — dokąd dalej (wybór tranzytu).
 */
function pushExit(path, ring, ax, ay, tx, ty, out) {
  const zone = ringZoneAt(ring, ax, ay);
  const r = Math.hypot(ax - ring.x, ay - ring.y);
  if (zone === RING_ZONE.OUTER) { out.x = ax; out.y = ay; return; }
  if (zone === RING_ZONE.PORT || (zone === RING_ZONE.SLAB && r >= (ring.slabInner + ring.slabOuter) * 0.5)) {
    ringFunnelPoint(ring, ax, ay, out);
    pathPush(path, out.x, out.y, Infinity, 0);
    return;
  }
  if (zone === RING_ZONE.TRANSIT) {
    const i = transitIndexAt(ring, ax, ay);
    const a = ring.transitAngles[i];
    const c = ring.config;
    pushPolar(path, ring, ring.slabOuter + c.transitMouth, a, c.transitSpeed, WP.TRANSIT);
    pushPolar(path, ring, ring.slabOuter + c.transitLead, a, c.transitSpeed, WP.TRANSIT);
    pushPolar(path, ring, ring.funnelR, a, Infinity, 0);
    out.x = ring.x + Math.cos(a) * ring.funnelR;
    out.y = ring.y + Math.sin(a) * ring.funnelR;
    return;
  }
  // Strona planety: na łuk korytarza, do osi tranzytu i przez ring.
  const fa = Math.atan2(ay - ring.y, ax - ring.x);
  if (Math.abs(r - ring.innerR) > 50) pushPolar(path, ring, ring.innerR, fa, Infinity, 0);
  const i = pickTransit(ring, fa, tx, ty);
  pushInnerArc(path, ring, fa, ring.transitAngles[i]);
  pushTransit(path, ring, i, true);
  out.x = ring.x + Math.cos(ring.transitAngles[i]) * ring.funnelR;
  out.y = ring.y + Math.sin(ring.transitAngles[i]) * ring.funnelR;
}

/**
 * Wejście do punktu B z przestrzeni — lustro `pushExit`. Liczy punkt wejścia
 * `out` (≥ freeR) BEZ dopisywania; dopisuje dopiero `pushEntryTail`, po
 * objeździe, żeby kolejność punktów była od A do B.
 */
function entryPoint(ring, bx, by, fx, fy, out) {
  const zone = ringZoneAt(ring, bx, by);
  const r = Math.hypot(bx - ring.x, by - ring.y);
  if (zone === RING_ZONE.OUTER) { out.x = bx; out.y = by; out.transit = -1; out.mode = 0; return out; }
  if (zone === RING_ZONE.PORT || (zone === RING_ZONE.SLAB && r >= (ring.slabInner + ring.slabOuter) * 0.5)) {
    ringFunnelPoint(ring, bx, by, out);
    out.transit = -1;
    out.mode = 1;
    return out;
  }
  if (zone === RING_ZONE.TRANSIT) {
    const i = transitIndexAt(ring, bx, by);
    out.x = ring.x + Math.cos(ring.transitAngles[i]) * ring.funnelR;
    out.y = ring.y + Math.sin(ring.transitAngles[i]) * ring.funnelR;
    out.transit = i;
    out.mode = 2;
    return out;
  }
  const fb = Math.atan2(by - ring.y, bx - ring.x);
  const i = pickTransit(ring, fb, fx, fy);
  out.x = ring.x + Math.cos(ring.transitAngles[i]) * ring.funnelR;
  out.y = ring.y + Math.sin(ring.transitAngles[i]) * ring.funnelR;
  out.transit = i;
  out.mode = 3;
  return out;
}

function pushEntryTail(path, ring, entry, bx, by, vmax, flags) {
  if (entry.mode === 1) {
    pathPush(path, entry.x, entry.y, Infinity, 0);
  } else if (entry.mode === 2) {
    const a = ring.transitAngles[entry.transit];
    const c = ring.config;
    pathPush(path, entry.x, entry.y, Infinity, 0);
    pushPolar(path, ring, ring.slabOuter + c.transitLead, a, c.transitSpeed, WP.TRANSIT);
  } else if (entry.mode === 3) {
    const a = ring.transitAngles[entry.transit];
    pushTransit(path, ring, entry.transit, false);
    const fb = Math.atan2(by - ring.y, bx - ring.x);
    pushInnerArc(path, ring, a, fb);
  }
  pathPush(path, bx, by, vmax, flags);
}

/**
 * Trasa z A do B z objazdem ringów. Dopisuje do `path` punkty PO A (A jest już
 * w ścieżce jako ostatni punkt) aż do B włącznie. B dostaje `vmax` i `flags`.
 *
 * Oba końce po stronie planety tego samego ringu — łuk korytarza wewnętrznego.
 * Przy kilku ringach po drodze objazd każdego, w kolejności wzdłuż trasy.
 */
export function routeRing(path, rings, ax, ay, bx, by, vmax = Infinity, flags = 0) {
  if (!rings || !rings.length) {
    pathPush(path, bx, by, vmax, flags);
    return path;
  }
  const ringA = ringAt(rings, ax, ay);
  const ringB = ringAt(rings, bx, by);

  // Oba końce w korytarzu wewnętrznym jednego ringu: bez tranzytu.
  if (ringA && ringA === ringB) {
    const za = ringZoneAt(ringA, ax, ay);
    const zb = ringZoneAt(ringA, bx, by);
    const innerA = za === RING_ZONE.INNER || za === RING_ZONE.CORE
      || (za === RING_ZONE.SLAB && Math.hypot(ax - ringA.x, ay - ringA.y) < (ringA.slabInner + ringA.slabOuter) * 0.5);
    const innerB = zb === RING_ZONE.INNER || zb === RING_ZONE.CORE
      || (zb === RING_ZONE.SLAB && Math.hypot(bx - ringA.x, by - ringA.y) < (ringA.slabInner + ringA.slabOuter) * 0.5);
    if (innerA && innerB) {
      const fa = Math.atan2(ay - ringA.y, ax - ringA.x);
      const fb = Math.atan2(by - ringA.y, bx - ringA.x);
      if (Math.abs(Math.hypot(ax - ringA.x, ay - ringA.y) - ringA.innerR) > 50) pushPolar(path, ringA, ringA.innerR, fa, Infinity, 0);
      pushInnerArc(path, ringA, fa, fb);
      pathPush(path, bx, by, vmax, flags);
      return path;
    }
    // Ten sam lejek (np. przestawienie w strefie portu na tym samym kącie):
    // wystarczy prosta promieniowa.
    const fa = Math.atan2(ay - ringA.y, ax - ringA.x);
    const fb = Math.atan2(by - ringA.y, bx - ringA.x);
    if ((za === RING_ZONE.PORT && zb === RING_ZONE.PORT) && Math.abs(wrapPi(fa - fb)) * ringA.slabOuter < 60) {
      pathPush(path, bx, by, vmax, flags);
      return path;
    }
  }

  // Punkt wejścia do B liczony przed wyjściem z A — wybór tranzytu A patrzy na niego.
  const entry = ringB ? entryPoint(ringB, bx, by, ax, ay, _b) : null;
  const tx = entry ? entry.x : bx;
  const ty = entry ? entry.y : by;
  if (ringA) pushExit(path, ringA, ax, ay, tx, ty, _a);
  else { _a.x = ax; _a.y = ay; }

  // Wolny odcinek między wyjściem a wejściem: objazdy ringów po drodze.
  let cx = _a.x;
  let cy = _a.y;
  for (let guard = 0; guard < rings.length; guard++) {
    let hit = null;
    let hitT = Infinity;
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      if (segmentPointDistance(ring.x, ring.y, cx, cy, tx, ty) >= ring.keepR) continue;
      // Kolejność wzdłuż odcinka — rzut środka ringu.
      const vx = tx - cx;
      const vy = ty - cy;
      const t = ((ring.x - cx) * vx + (ring.y - cy) * vy) / Math.max(1e-9, vx * vx + vy * vy);
      if (t < hitT) { hitT = t; hit = ring; }
    }
    if (!hit) break;
    const before = path.count;
    if (!pushDetour(path, hit, cx, cy, tx, ty)) break;
    const last = (path.count - 1) * PATH_STRIDE;
    cx = path.data[last];
    cy = path.data[last + 1];
    if (path.count === before) break;
  }

  if (entry) pushEntryTail(path, ringB, entry, bx, by, vmax, flags);
  else pathPush(path, bx, by, vmax, flags);
  return path;
}
