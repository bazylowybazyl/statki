/**
 * Testy routera ringu „Halo” (bańka, warstwa 3).
 *
 * Ring leży w płaszczyźnie gry: płyta (kadłub → podłoga + teren) jest ścianą,
 * przez którą prowadzą tylko 4 tranzyty. Pilnujemy dwóch rzeczy naraz:
 * że PLANOWANA trasa nigdy nie wchodzi w płytę poza tranzytem (i w strefie
 * portu porusza się tylko promieniowo), i że PRAWDZIWY lot statku po niej —
 * z bezwładnością i ograniczonym skrętem — też nie wchodzi, a kadłub nie
 * zahacza ścian ani portali tunelu (świat kolizji gracza, `buildPortCollision`).
 */

import { createSuite, runIfMain } from './harness.mjs';
import { buildHaloPortTrafficLayout } from '../../src/3d/haloRing/haloPortTraffic.js';
import { createPortRegistry, buildPortCollision } from '../../src/3d/haloRing/haloPortDocking.js';
import { haloBayLayouts } from '../../src/3d/haloRing/haloPortBays.js';
import { createK7Layout, k7Frame, k7WorldToHub } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { haloPortComplexAngles } from '../../src/3d/haloRing/haloRingConfig.js';
import { haloRingLayoutFor, createHaloRingPlacement, haloGameToLocal } from '../../src/game/haloRingPlanets.js';
import {
  createRingObstacle, routeRing, pointInRingSlab, ringZoneAt, RING_ZONE, transitIndexAt
} from '../../src/game/traffic/ringRouter.js';
import {
  createPath, pathReset, pathFinalize, pathX, pathY, pathFlags, WP
} from '../../src/game/traffic/portPaths.js';
import {
  COURSE_KIND, COURSE_STATUS, createCourseRegistry, launchCourse, travelStage
} from '../../src/game/traffic/courseRegistry.js';
import { createBubble, updateBubble, getActorList } from '../../src/game/traffic/materializedFlight.js';

/** Powtarzalne losowanie (mulberry32). */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Port i ring planety w układzie ruchu (środek planety w dowolnym miejscu). */
export function ringWorld(key, cx, cy) {
  const ringLayout = haloRingLayoutFor({ id: key });
  const layout = buildHaloPortTrafficLayout(ringLayout, { id: key, x: cx, y: cy });
  const ring = createRingObstacle({ key, x: cx, y: cy, layout });
  // Świat kolizji gracza: hale, zatoki, tunele tranzytów (układ huba hali 0).
  const frame = k7Frame(ringLayout);
  const halls = haloPortComplexAngles().map((angle, index) => ({ index, frame: k7Frame(ringLayout, angle), layout: createK7Layout() }));
  const col = buildPortCollision({
    registry: createPortRegistry({ halls, bays: haloBayLayouts(ringLayout), frame }), frame, ringLayout
  });
  const place = createHaloRingPlacement({ id: key, x: cx, y: cy });
  const poly = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
  const local = {};
  const hub = {};
  const corners = [[0, 0], [0, 0], [0, 0], [0, 0]];
  /** Prostokąt kadłuba (×scale) w układzie gry → narożniki. */
  function hullCorners(a, scale = 0.9) {
    const c = Math.cos(a.angle);
    const s = Math.sin(a.angle);
    const hl = a.length * 0.5 * scale;
    const hw = a.width * 0.5 * scale;
    const pts = [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]];
    for (let i = 0; i < 4; i++) {
      corners[i][0] = a.x + pts[i][0] * c - pts[i][1] * s;
      corners[i][1] = a.y + pts[i][0] * s + pts[i][1] * c;
    }
    return corners;
  }
  /** Id bryły portu, w którą wchodzi kadłub, albo null. */
  function hullHitsPort(a, scale = 0.9) {
    const pts = hullCorners(a, scale);
    for (let i = 0; i < 4; i++) {
      haloGameToLocal(place, pts[i][0], pts[i][1], local);
      k7WorldToHub(frame, local.x, local.y, hub);
      poly[i].x = hub.x;
      poly[i].z = hub.z;
    }
    return col.test(poly);
  }
  function hullInSlab(a, scale = 0.9) {
    const pts = hullCorners(a, scale);
    for (let i = 0; i < 4; i++) if (pointInRingSlab(ring, pts[i][0], pts[i][1])) return true;
    return pointInRingSlab(ring, a.x, a.y);
  }
  return { key, cx, cy, ringLayout, layout, ring, hullHitsPort, hullInSlab };
}

export function run() {
  const t = createSuite('ringRouter');

  // ----------------------------------------------------------
  t.section('Przeszkoda-ring: promienie, tranzyty, płyty portu');

  for (const [key, cx, cy] of [['earth', 179_542, 1_040_968], ['mars', -703_940, 1_203_629]]) {
    const w = ringWorld(key, cx, cy);
    const r = w.ring;
    t.check(`${key}: kolejność promieni planeta < płyta < port < objazd`,
      r.planetR < r.slabInner && r.slabInner < r.back && r.floorMid < r.slabOuter
      && r.slabOuter < r.portOuter && r.portOuter < r.keepR && r.keepR < r.arcR && r.arcR < r.funnelR,
      JSON.stringify({ planetR: r.planetR, back: r.back, slabOuter: r.slabOuter, portOuter: r.portOuter, keepR: r.keepR }));
    // Te same osie tranzytów co port z gry (obrót ringu Marsa −π).
    const portTransits = w.layout.ring.transitAngles;
    const ok = [...r.transitAngles].every(a => portTransits.some(b => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-9));
    t.check(`${key}: osie tranzytów zgodne z portem (layout.ring)`, ok);
    // Stanowiska i punkty podejścia leżą NAD płytą (płyty portu +7 j., nie góry).
    let inSlab = 0;
    let beyondKeep = 0;
    for (const b of w.layout.berths) {
      if (pointInRingSlab(r, b.x, b.y) || pointInRingSlab(r, b.approachX, b.approachY)) inSlab++;
      if (Math.hypot(b.approachX - cx, b.approachY - cy) >= r.keepR) beyondKeep++;
    }
    t.equal(`${key}: żadne stanowisko ani podejście w płycie`, inSlab, 0);
    t.equal(`${key}: port cały wewnątrz dysku objazdu`, beyondKeep, 0);
    t.equal(`${key}: stanowisko to strefa portu`, ringZoneAt(r, w.layout.berths[0].x, w.layout.berths[0].y), RING_ZONE.PORT);
  }

  // ----------------------------------------------------------
  t.section('Planowana trasa: płyta tylko tranzytem, w porcie tylko promieniowo');

  const earth = ringWorld('earth', 5_000, -3_000);
  const ring = earth.ring;
  const rnd = seeded(7);
  const path = createPath(128);
  const bands = [
    [ring.innerR - 600, ring.innerR + 600],          // korytarz wewnętrzny
    [ring.slabOuter + 500, ring.keepR - 500],        // strefa portu
    [ring.funnelR + 500, ring.funnelR + 60_000]      // przestrzeń
  ];
  let slabSamples = 0;
  let lateralPort = 0;
  let wrongEnd = 0;
  let transits = 0;
  let maxPoints = 0;
  const TRIALS = 1500;
  for (let trial = 0; trial < TRIALS; trial++) {
    const ba = bands[Math.floor(rnd() * 3)];
    const bb = bands[Math.floor(rnd() * 3)];
    const ra = ba[0] + rnd() * (ba[1] - ba[0]);
    const rb = bb[0] + rnd() * (bb[1] - bb[0]);
    const fa = rnd() * Math.PI * 2;
    const fb = rnd() * Math.PI * 2;
    const ax = earth.cx + Math.cos(fa) * ra;
    const ay = earth.cy + Math.sin(fa) * ra;
    const bx = earth.cx + Math.cos(fb) * rb;
    const by = earth.cy + Math.sin(fb) * rb;
    pathReset(path, ax, ay);
    routeRing(path, [ring], ax, ay, bx, by, 0, WP.STOP);
    pathFinalize(path);
    maxPoints = Math.max(maxPoints, path.count);
    if (Math.hypot(pathX(path, path.count - 1) - bx, pathY(path, path.count - 1) - by) > 1e-6) wrongEnd++;
    let usedTransit = false;
    for (let i = 1; i < path.count; i++) {
      const x0 = pathX(path, i - 1);
      const y0 = pathY(path, i - 1);
      const x1 = pathX(path, i);
      const y1 = pathY(path, i);
      if (pathFlags(path, i) & WP.TRANSIT) usedTransit = true;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.ceil(len / 25));
      let portSample = false;
      for (let k = 0; k <= n; k++) {
        const x = x0 + (x1 - x0) * k / n;
        const y = y0 + (y1 - y0) * k / n;
        if (pointInRingSlab(ring, x, y)) slabSamples++;
        const rr = Math.hypot(x - earth.cx, y - earth.cy);
        if (rr > ring.slabOuter && rr < ring.keepR - 1) portSample = true;
      }
      // Odcinek, który zahacza o strefę portu, musi być promieniowy.
      if (portSample) {
        const a0 = Math.atan2(y0 - earth.cy, x0 - earth.cx);
        const a1 = Math.atan2(y1 - earth.cy, x1 - earth.cx);
        if (Math.abs(Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0))) > 1e-6) lateralPort++;
      }
    }
    if (usedTransit) transits++;
  }
  t.note(`${TRIALS} tras, ${transits} przez tranzyt, najdłuższa ${maxPoints} punktów`);
  t.equal('żadna próbka trasy w płycie poza tranzytem', slabSamples, 0);
  t.equal('w strefie portu tylko odcinki promieniowe', lateralPort, 0);
  t.equal('trasa kończy się w celu', wrongEnd, 0);
  t.check('część tras idzie tranzytami (korytarz wewnętrzny ↔ przestrzeń)', transits > TRIALS * 0.2);
  t.check('bufor ścieżki wystarcza z zapasem', maxPoints < 96);

  // Prosta z przeciwnej strony planety okrąża dysk objazdu zamiast przecinać ring.
  pathReset(path, earth.cx + 90_000, earth.cy);
  routeRing(path, [ring], earth.cx + 90_000, earth.cy, earth.cx - 90_000, earth.cy + 1000, 0, WP.STOP);
  pathFinalize(path);
  let minR = Infinity;
  for (let i = 1; i < path.count; i++) {
    for (let k = 0; k <= 20; k++) {
      const x = pathX(path, i - 1) + (pathX(path, i) - pathX(path, i - 1)) * k / 20;
      const y = pathY(path, i - 1) + (pathY(path, i) - pathY(path, i - 1)) * k / 20;
      minR = Math.min(minR, Math.hypot(x - earth.cx, y - earth.cy));
    }
  }
  t.check('objazd przez przestrzeń trzyma się poza dyskiem objazdu', minR >= ring.keepR - 1,
    `(min r ${minR.toFixed(0)}, keepR ${ring.keepR.toFixed(0)})`);

  // ----------------------------------------------------------
  t.section('Prawdziwy lot: tranzyt kadłubem — bez płyty i bez ścian tunelu');

  const network = { nodes: new Map([['earth', { id: 'earth', x: earth.cx, y: earth.cy }]]) };
  const docks = new Map([['earth', earth.layout]]);
  const hulls = ['inter_station_shuttle', 'long_haul_freighter', 'megafreighter'];
  let flights = 0;
  let slabHits = 0;
  let wallHits = 0;
  let unfinished = 0;
  let firstHit = '';
  for (const hullId of hulls) {
    for (let k = 0; k < 4; k++) {
      const inward = k % 2 === 1;
      const a0 = 0.35 + k * 1.3;
      const inner = { x: earth.cx + Math.cos(a0) * ring.innerR, y: earth.cy + Math.sin(a0) * ring.innerR };
      const outer = { x: earth.cx + Math.cos(a0 + 2) * 90_000, y: earth.cy + Math.sin(a0 + 2) * 90_000 };
      const registry = createCourseRegistry();
      const course = launchCourse(registry, {
        kind: COURSE_KIND.HAUL, unitClass: hullId,
        stages: [travelStage('earth', 'earth', { fromPos: inward ? outer : inner, toPos: inward ? inner : outer, seconds: 200 })]
      });
      const bubble = createBubble({ rings: [ring], docks });
      const active = new Map([[course.id, course]]);
      let passedSlab = false;
      for (let step = 0; step < 900 * 15; step++) {
        updateBubble(bubble, network, registry, active, { x: earth.cx, y: earth.cy }, 200_000, 1 / 15);
        const a = getActorList(bubble)[0];
        if (!a) break;
        if (earth.hullInSlab(a)) { slabHits++; if (!firstHit) firstHit = `${hullId} płyta`; }
        const hit = earth.hullHitsPort(a);
        if (hit) { wallHits++; if (!firstHit) firstHit = `${hullId} ${hit}`; }
        const rr = Math.hypot(a.x - earth.cx, a.y - earth.cy);
        if (rr > ring.back && rr < ring.floorMid && transitIndexAt(ring, a.x, a.y) >= 0) passedSlab = true;
      }
      flights++;
      if (course.status !== COURSE_STATUS.DONE || !passedSlab) unfinished++;
    }
  }
  t.note(`${flights} przelotów przez tranzyt (prom, frachtowiec L, megafrachtowiec 2760 × 912)`);
  t.check('kadłub nigdy w płycie', slabHits === 0, `(${slabHits}) ${firstHit}`);
  t.check('kadłub nie zahacza ścian ani portali tunelu', wallHits === 0, `(${wallHits}) ${firstHit}`);
  t.equal('każdy przelot doleciał przez tranzyt', unfinished, 0);

  return t.results;
}

runIfMain(import.meta.url, run);
