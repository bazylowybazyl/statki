/**
 * Testy ścieżek portu i dokowania lekkich statków bańki.
 *
 * Rekord kursu zna tylko punkt stanowiska — ścieżkę portu (podejście → brama
 * → aleja / pas → pole STOP), kurs dziobu i przechwyt bańka bierze ze
 * stanowiska. Sprawdzamy to, co widać na ekranie:
 *   - każde stanowisko portu K-7 dostaje prawdziwą ścieżkę hali albo zatoki;
 *   - dokowanie mieści się w oknie przechwytu jak u gracza (`PortDocking`:
 *     capital 145 × 180, MEGA 160 × 220, reszta 70 × 55; ≤ 30 j./s; ≤ 7°);
 *   - cały cykl (przylot, obsługa, odłączenie, wyjście) nie zahacza ścian
 *     hal i zatok (świat kolizji gracza) ani płyty ringu;
 *   - korytarz: wchodzący czeka, gdy wychodzi inny albo jego stanowisko nie
 *     opustoszało — kadłuby się nie nakładają i nikt nie czeka w nieskończoność.
 */

import { createSuite, runIfMain } from './harness.mjs';
import { ringWorld } from './ringRouter.test.mjs';
import { K7_BANK_SLOTS } from '../../src/3d/haloRing/haloPortK7Layout.js';
import { buildStationDocks, hullFitsBerth } from '../../src/game/traffic/dockLayout.js';
import {
  COURSE_KIND, COURSE_STATUS, DWELL_REASON, createCourseRegistry, launchCourse,
  travelStage, dwellStage, currentStage, moveDwellTo
} from '../../src/game/traffic/courseRegistry.js';
import {
  createPortIndex, findPortEntry, berthPoseError, CAPTURE_DEFAULTS, PORT_PATH_SPEED
} from '../../src/game/traffic/portPaths.js';
import { createBubble, updateBubble, getActorList, ACTOR_PHASE } from '../../src/game/traffic/materializedFlight.js';

const DT = 1 / 15;

/**
 * Kurs „przylot → obsługa → odlot” na stanowisko `berth`, z przydziałem jak
 * u dyspozytora (`moveDwellTo` z punktu przylotu, 45 s dojścia).
 */
function portCourse(w, registry, berth, hullId, angIn, angOut) {
  const { cx, cy, key } = w;
  const arrive = { x: cx + Math.cos(angIn) * 65_768, y: cy + Math.sin(angIn) * 65_768 };
  const depart = { x: cx + Math.cos(angOut) * 65_768, y: cy + Math.sin(angOut) * 65_768 };
  const course = launchCourse(registry, {
    kind: COURSE_KIND.HAUL, unitClass: hullId,
    stages: [
      dwellStage(key, 120, DWELL_REASON.UNLOAD, null, { entryPos: arrive }),
      travelStage(key, key, { fromPos: { x: cx, y: cy }, toPos: depart, seconds: 70 }),
      travelStage(key, 'far', { fromPos: depart, seconds: 1100, distance: 900_000 })
    ]
  });
  course.berthId = berth.id;
  course.berthRef = berth;
  course.portStationId = key;
  moveDwellTo(course, currentStage(course), { x: berth.x, y: berth.y }, 45);
  return course;
}

function sampleBerths(layout, complexes) {
  const pick = [];
  const seen = new Set();
  for (const berth of layout.berths) {
    if (!complexes.includes(berth.complex)) continue;
    const key = `${berth.hall}:${berth.cls}:${berth.side}:${berth.complex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pick.push(berth);
  }
  return pick;
}

function largestFitting(berth) {
  const hulls = ['megafreighter', 'heavy_freighter', 'long_haul_freighter', 'container_ship', 'inter_station_shuttle'];
  return hulls.find(h => hullFitsBerth(berth, h)) || 'inter_station_shuttle';
}

export function run() {
  const t = createSuite('portPaths');

  // ----------------------------------------------------------
  t.section('Indeks portów: każde stanowisko ma ścieżkę swojej hali albo zatoki');

  const earth = ringWorld('earth', 179_542, 1_040_968);
  const mars = ringWorld('mars', -703_940, 1_203_629);
  for (const w of [earth, mars]) {
    const index = createPortIndex(new Map([[w.key, w.layout]]));
    let generic = 0;
    let badWindow = 0;
    let badAxis = 0;
    for (const berth of w.layout.berths) {
      const entry = findPortEntry(index, { berthId: berth.id });
      if (!entry || entry.kind === 'pier') { generic++; continue; }
      const cap = entry.capture;
      const expect = berth.cls === 'capital' ? CAPTURE_DEFAULTS.capital
        : berth.cls === 'mega' ? CAPTURE_DEFAULTS.mega : CAPTURE_DEFAULTS.other;
      if (cap.along !== expect.along || cap.across !== expect.across
        || cap.maxSpeed !== 30 || Math.abs(cap.maxAngle - 7 * Math.PI / 180) > 1e-12) badWindow++;
      // Ostatni odcinek wejścia prowadzi dziobem w kurs stanowiska.
      const k = entry.inboundCount - 2;
      const dx = entry.x - entry.inbound[k * 4];
      const dy = entry.y - entry.inbound[k * 4 + 1];
      const along = Math.atan2(dy, dx);
      if (Math.abs(Math.atan2(Math.sin(along - entry.angle), Math.cos(along - entry.angle))) > 1e-6) badAxis++;
    }
    t.equal(`${w.key}: wszystkie ${w.layout.berths.length} stanowisk ze ścieżką hali / zatoki`, generic, 0);
    t.equal(`${w.key}: okna przechwytu jak u gracza (PortDocking)`, badWindow, 0);
    t.equal(`${w.key}: ostatni odcinek = kurs stanowiska`, badAxis, 0);
  }
  // Stanowisko pomostu (stacja bez ringu) — ścieżka ogólna wzdłuż osi stanowiska.
  const pier = buildStationDocks({ id: 'venus', x: 0, y: 0, r: 120 });
  const pierEntry = findPortEntry(createPortIndex(new Map([['venus', pier]])), { berthId: pier.berths[0].id });
  t.check('pomost: ścieżka ogólna', pierEntry?.kind === 'pier');
  t.equal('pas S grzebienia w standardzie K-7', K7_BANK_SLOTS.S.padLength, 400);

  // ----------------------------------------------------------
  t.section('Dokowanie mieści się w oknie przechwytu (każda klasa, Ziemia i Mars)');

  let captures = 0;
  let outside = 0;
  let forced = 0;
  let worst = { along: 0, across: 0, angle: 0, speed: 0 };
  let cycles = 0;
  let cycleFail = 0;
  let wallHits = 0;
  let slabHits = 0;
  let firstHit = '';
  let dwellAtBerth = [];
  for (const w of [earth, mars]) {
    const network = { nodes: new Map([[w.key, { id: w.key, x: w.cx, y: w.cy }], ['far', { id: 'far', x: w.cx - 900_000, y: w.cy + 150_000 }]]) };
    const docks = new Map([[w.key, w.layout]]);
    for (const berth of sampleBerths(w.layout, [0, 1])) {
      const hullId = largestFitting(berth);
      const registry = createCourseRegistry();
      const ang = Math.atan2(berth.y - w.cy, berth.x - w.cx);
      const course = portCourse(w, registry, berth, hullId, ang + 2.6, ang - 2.2);
      const bubble = createBubble({ rings: [w.ring], docks });
      const active = new Map([[course.id, course]]);
      let captured = null;
      let dockedAt = NaN;
      let undockAt = NaN;
      let left = false;
      for (let step = 0; step < 1400 / DT; step++) {
        if (course.stageIndex >= 1 && course.berthId) { course.berthId = null; course.berthRef = null; }
        updateBubble(bubble, network, registry, active, { x: w.cx, y: w.cy }, 90_000, DT);
        const a = getActorList(bubble)[0];
        if (!a) break;
        if (!captured && a.phase === ACTOR_PHASE.CAPTURE) {
          const e = a.dockedEntry;
          const err = berthPoseError(e, a.fromX, a.fromY, a.fromAngle, {});
          captured = { along: err.along, across: err.across, angle: err.angle, speed: a.captureSpeed, cap: e.capture };
        }
        if (a.phase === ACTOR_PHASE.DOCKED && !Number.isFinite(dockedAt)) dockedAt = step * DT;
        if (a.phase === ACTOR_PHASE.UNDOCK && Number.isFinite(dockedAt) && !Number.isFinite(undockAt)) undockAt = step * DT;
        const hit = w.hullHitsPort(a);
        if (hit) { wallHits++; if (!firstHit) firstHit = `${berth.id} ${hullId}: ${hit}`; }
        if (w.hullInSlab(a)) { slabHits++; if (!firstHit) firstHit = `${berth.id} ${hullId}: płyta`; }
        if (course.stageIndex >= 2 && Math.hypot(a.x - w.cx, a.y - w.cy) > 70_000) { left = true; break; }
      }
      if (captured) {
        captures++;
        const c = captured.cap;
        if (Math.abs(captured.along) > c.along || Math.abs(captured.across) > c.across
          || Math.abs(captured.angle) > c.maxAngle || Math.abs(captured.speed) > c.maxSpeed) outside++;
        worst.along = Math.max(worst.along, Math.abs(captured.along) / c.along);
        worst.across = Math.max(worst.across, Math.abs(captured.across) / c.across);
        worst.angle = Math.max(worst.angle, Math.abs(captured.angle) * 180 / Math.PI);
        worst.speed = Math.max(worst.speed, Math.abs(captured.speed));
      }
      if (Number.isFinite(dockedAt) && Number.isFinite(undockAt)) dwellAtBerth.push(undockAt - dockedAt);
      forced += bubble.stats.forcedCaptures + bubble.stats.forcedStages;
      cycles++;
      if (!captured || !left) cycleFail++;
    }
  }
  t.note(`${captures} przechwytów; najgorzej: wzdłuż ${(worst.along * 100).toFixed(0)}% okna, `
    + `w poprzek ${(worst.across * 100).toFixed(0)}%, kurs ${worst.angle.toFixed(2)}°, ${worst.speed.toFixed(1)} j./s`);
  t.equal('każdy przechwyt w oknie (pozycja, kurs ≤ 7°, prędkość ≤ 30)', outside, 0);
  t.equal('bez wymuszonych przechwytów i etapów', forced, 0);
  t.equal(`pełne cykle (przylot → obsługa → odlot): ${cycles}`, cycleFail, 0);
  t.check('kadłub nie zahacza ścian hal i zatok', wallHits === 0, `(${wallHits}) ${firstHit}`);
  t.check('ani płyty ringu', slabHits === 0, `(${slabHits}) ${firstHit}`);
  // Obsługa przy stanowisku = postój rekordu minus dojście, które zastąpił lot (120 − 45 s).
  const minDwell = Math.min(...dwellAtBerth);
  const maxDwell = Math.max(...dwellAtBerth);
  t.check('przy stanowisku tyle, ile rekord (120 s postoju − 45 s dojścia)',
    minDwell > 74 && maxDwell < 76.5, `(${minDwell.toFixed(1)}–${maxDwell.toFixed(1)} s)`);

  // ----------------------------------------------------------
  t.section('Korytarz portu: wchodzący czeka na wychodzącego, bez nakładania');

  const network = { nodes: new Map([['earth', { id: 'earth', x: earth.cx, y: earth.cy }], ['far', { id: 'far', x: earth.cx - 900_000, y: earth.cy }]]) };
  const docks = new Map([['earth', earth.layout]]);
  const byId = new Map(earth.layout.berths.map(b => [b.id, b]));
  const scenarios = [
    ['aleja zatoki: sąsiednie stanowiska', 'earth:Z-01:Z01-M01', 'earth:Z-01:Z01-M03', 'container_ship'],
    ['aleja zatoki: to samo stanowisko od razu dla następnego', 'earth:Z-01:Z01-L01', 'earth:Z-01:Z01-L01', 'long_haul_freighter'],
    ['pas MEGA: to samo stanowisko', 'earth:Z-02:Z02-MG1', 'earth:Z-02:Z02-MG1', 'megafreighter'],
    ['pas capital K-7: to samo stanowisko', 'earth:K7-1:C-02', 'earth:K7-1:C-02', 'heavy_freighter'],
    ['aleja boczna K-7', 'earth:K7-1:E-L02', 'earth:K7-1:E-S04', 'long_haul_freighter']
  ];
  for (const [name, outId, inId, hullId] of scenarios) {
    const registry = createCourseRegistry();
    const outB = byId.get(outId);
    const inB = byId.get(inId);
    const depart = { x: earth.cx + 70_000, y: earth.cy + 10_000 };
    const out = launchCourse(registry, {
      kind: COURSE_KIND.HAUL, unitClass: hullId,
      stages: [
        dwellStage('earth', 20, DWELL_REASON.LOAD, { x: outB.x, y: outB.y }),
        travelStage('earth', 'earth', { fromPos: { x: earth.cx, y: earth.cy }, toPos: depart, seconds: 70 }),
        travelStage('earth', 'far', { fromPos: depart, seconds: 1100, distance: 900_000 })
      ]
    });
    out.berthId = outB.id;
    out.berthRef = outB;
    out.portStationId = 'earth';
    const ang = Math.atan2(inB.y - earth.cy, inB.x - earth.cx) + 0.9;
    const inn = launchCourse(registry, {
      kind: COURSE_KIND.HAUL, unitClass: hullId,
      stages: [dwellStage('earth', 60, DWELL_REASON.UNLOAD, null, {
        entryPos: { x: earth.cx + Math.cos(ang) * 65_768, y: earth.cy + Math.sin(ang) * 65_768 }
      })]
    });
    inn.berthId = inB.id;
    inn.berthRef = inB;
    inn.portStationId = 'earth';
    moveDwellTo(inn, currentStage(inn), { x: inB.x, y: inB.y }, 45);
    const bubble = createBubble({ rings: [earth.ring], docks });
    const active = new Map([[out.id, out], [inn.id, inn]]);
    let overlaps = 0;
    let waited = false;
    for (let step = 0; step < 900 / DT; step++) {
      if (out.stageIndex >= 1 && out.berthId) { out.berthId = null; out.berthRef = null; }
      updateBubble(bubble, network, registry, active, { x: earth.cx, y: earth.cy }, 120_000, DT);
      const list = getActorList(bubble);
      const a = list.find(x => x.courseId === out.id);
      const b = list.find(x => x.courseId === inn.id);
      if (b?.waiting) waited = true;
      // Nakładanie liczymy tylko w porcie (w otwartej przestrzeni tory mogą się krzyżować).
      const nearPort = (s) => Math.hypot(s.x - earth.cx, s.y - earth.cy) < earth.ring.portOuter + 2000;
      if (a && b && nearPort(a) && nearPort(b) && rectsOverlap(a, b)) overlaps++;
      if (inn.status === COURSE_STATUS.DONE && out.stageIndex >= 2) break;
    }
    t.check(`${name}: bez nakładania kadłubów`, overlaps === 0, `(${overlaps} kroków)`);
    t.check(`${name}: oba kursy domknięte`, inn.status === COURSE_STATUS.DONE && out.stageIndex >= 2,
      `(wchodzący ${inn.status}/etap ${inn.stageIndex}, wychodzący etap ${out.stageIndex}, ${JSON.stringify(bubble.stats)})`);
    if (outId === inId) t.check(`${name}: wchodzący czekał przed korytarzem`, waited);
    t.equal(`${name}: bez wymuszeń`, bubble.stats.forcedCaptures + bubble.stats.forcedStages, 0);
  }
  t.check('sufit dojścia na pole STOP poniżej progu przechwytu', PORT_PATH_SPEED.berth < CAPTURE_DEFAULTS.maxSpeed);

  return t.results;
}

/** SAT dwóch prostokątów kadłubów (×0,9). */
function rectsOverlap(a, b) {
  const boxes = [a, b].map(s => {
    const c = Math.cos(s.angle);
    const n = Math.sin(s.angle);
    const hl = s.length * 0.45;
    const hw = s.width * 0.45;
    return [[hl, hw], [-hl, hw], [-hl, -hw], [hl, -hw]].map(([u, v]) => ({ x: s.x + u * c - v * n, y: s.y + u * n + v * c }));
  });
  for (const poly of boxes) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const nx = p.y - q.y;
      const ny = q.x - p.x;
      let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
      for (const v of boxes[0]) { const d = v.x * nx + v.y * ny; a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of boxes[1]) { const d = v.x * nx + v.y * ny; b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 < b0 || b1 < a0) return false;
    }
  }
  return true;
}

runIfMain(import.meta.url, run);
