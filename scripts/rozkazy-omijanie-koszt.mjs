// Koszt CPU omijania przeszkód przez rozkazy RTS (2026-10-08, src/ai/npcCommandPilot.js +
// capitalAI.js: capitalCommandSteer / capitalCommandFreePoint / capitalCommandSeparate).
//
// 170 okrętów (fregaty, niszczyciele, pancerniki) na rozkazach ruchu przez pole dużych wraków, prawdziwa
// siatka AI z migawką (aiSpatialGrid.js), indeks wraków (aiWreckIndex.js), separacja wycięta z index.html.
// Tick fizyki 120 Hz: co 6. tick przebudowa siatki i indeksu (takt AI), co tick pilot rozkazów każdego
// okrętu. Mierzony jest sam pilot rozkazów (lot stepShipFlight — ten sam w obu wariantach — poza
// pomiarem). Warianty na przemian, osobne kopie sceny: A — dawny pilot (setFlightArrive wprost),
// B — z omijaniem, M — dla porównania mózg (capitalArriveTo: przeszkody, separacja, unik CPA) raz na
// takt AI, fazowany jak w grze — tyle kosztował ten okręt bez rozkazu (okręt na rozkazie mózgu nie liczy).
// Wynik: µs na tick (= na klatkę przy 120 Hz) dla całej floty, mediana przebiegów.
//   node scripts/rozkazy-omijanie-koszt.mjs [--npc 170] [--wraki 0,100,300] [--przebiegi 7] [--ticki 1200]
import { readIndexHtml, sliceFunction } from '../tests/helpers/indexSource.mjs';

const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };
const NPC = Number(arg('npc', 170));
const WRAKI = String(arg('wraki', '0,100,300')).split(',').map(Number);
const PRZEBIEGI = Number(arg('przebiegi', 7));
const TICKI = Number(arg('ticki', 1200));
const DT = 1 / 120;

globalThis.window = {
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
  ship: null,
  __frameId: 1,
  bullets: [],
  __npcRocketThreats: [],
  __playerRocketThreats: []
};
const Grid = await import('../src/ai/aiSpatialGrid.js');
const { isEnemyUnit } = await import('../src/ai/aiUtils.js');
const { capitalCommandSteer, capitalCommandFreePoint, capitalCommandSeparate } = await import('../src/ai/capitalAI.js');
const Idx = await import('../src/ai/aiWreckIndex.js');
const { applyNpcCommandIntent } = await import('../src/ai/npcCommandPilot.js');
const { stepShipFlight } = await import('../src/game/flight/shipFlightModel.js');
window.isEnemyUnit = isEnemyUnit;

// Separacja z index.html (jak scripts/szyk-floty.mjs i tests/aiNeighborSnapshot.test.mjs).
const html = readIndexHtml();
const uid0 = html.indexOf('let __sepUidCounter = 0;');
const SEP_SOURCE = [
  sliceFunction(html, 'function isNpcCombatActive(npc) {'),
  sliceFunction(html, 'function clampVecLen(x, y, maxLen) {'),
  html.slice(uid0, html.indexOf('function sepPriority(u) {', uid0)),
  sliceFunction(html, 'function sepPriority(u) {'),
  sliceFunction(html, 'function sepYieldFactor(npc, other) {'),
  sliceFunction(html, 'function shieldPairStandoff(a, b) {'),
  sliceFunction(html, 'function applySeparationForces(npc, ax, ay) {')
].join('\n');

function rngOf(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const KINDS = [
  ['frigate_pd', 'terran_frigate', 111.5],
  ['destroyer', 'terran_destroyer', 180.5],
  ['battleship', 'terran_battleship', 400.5]
];

// Scena: pola liczbowe od początku jako double (inaczej V8 zmienia reprezentację pól w trakcie
// i pomiar łapie wolne ścieżki, których w grze nie ma).
function makeScene(nWrecks, seed) {
  const rnd = rngOf(seed);
  const ships = [];
  for (let i = 0; i < NPC; i++) {
    const [type, shipFrame, radius] = KINDS[i % 7 < 4 ? 0 : (i % 7 < 6 ? 1 : 2)];
    const x = -12000.5 + rnd() * 6000;
    const y = -12000.5 + rnd() * 24000;
    ships.push({
      id: i, x, y, vx: 0.5, vy: 0.5, angle: 0.25, angVel: 0.0, radius, mass: 1000.5,
      mission: true, friendly: true, isCapitalShip: true, type, shipFrame, state: 'idle', dead: false,
      command: { type: 'move', target: { x: 12000.5 + rnd() * 6000, y: -12000.5 + rnd() * 24000 }, arrival: radius + 25 }
    });
  }
  const wrecks = [];
  for (let k = 0; k < nWrecks; k++) {
    wrecks.push({
      x: -6000.5 + rnd() * 12000, y: -12000.5 + rnd() * 24000, vx: 0.5, vy: 0.5,
      radius: 120.5 + rnd() * 330, angle: rnd() * 6.28, dead: false, isCollidable: true
    });
  }
  return { ships, wrecks };
}

function run(scene, mode) {
  const withSteer = mode === 'B';
  const scope = {
    window, npcs: scene.ships, HullBodies: { hasContact: () => false }, aiDecisionTickId: 0, performance,
    getEntityShieldBlockingProgress: () => 0, getEntityShieldBaseRadius: () => 0
  };
  const sep = new Function('__scope', `with (__scope) {\n${SEP_SOURCE}\nreturn { applySeparationForces };\n}`)(scope);
  window.applySeparationForces = sep.applySeparationForces;
  window.queryAIGrid = Grid.queryAIGrid;
  const deps = {
    getTargetPos: (u, c) => c.target,
    pickTarget: () => null,
    triggerRam: () => {},
    defaultOrbitRadius: 900
  };
  if (withSteer) {
    deps.steer = capitalCommandSteer;
    deps.freePoint = capitalCommandFreePoint;
    deps.separate = capitalCommandSeparate;
  }
  const L = scene.ships;
  let ms = 0;
  for (let t = 0; t < TICKI; t++) {
    window.__frameId++;
    if (t % 6 === 0) {
      scope.aiDecisionTickId++;
      Grid.rebuildAIGrid(L, false);
      Idx.rebuildWreckIndex(scene.wrecks);
    }
    const t0 = performance.now();
    if (mode === 'M') {
      for (let i = t % 6; i < L.length; i += 6) {
        const s = L[i];
        window.capitalArriveTo(s, s.command.target.x, s.command.target.y, { dt: 6 * DT, arrival: s.command.arrival });
      }
    } else {
      for (let i = 0; i < L.length; i++) {
        const s = L[i];
        if (s.command) applyNpcCommandIntent(s, s.command, deps, DT);
      }
    }
    ms += performance.now() - t0;
    for (let i = 0; i < L.length; i++) stepShipFlight(L[i], DT);
  }
  Idx.resetWreckIndex();
  return (ms * 1000) / TICKI;
}

const median = (a) => { const b = [...a].sort((p, q) => p - q); return b[b.length >> 1]; };
const wyniki = [];
for (const nW of WRAKI) {
  const R = { A: [], B: [], M: [] };
  for (let r = 0; r < PRZEBIEGI; r++) {
    // Na przemian (kolejność obraca się), każdy na świeżej kopii tej samej sceny.
    const order = ['A', 'B', 'M'];
    for (let k = 0; k < r % 3; k++) order.push(order.shift());
    for (const m of order) R[m].push(run(makeScene(nW, 11 + r), m));
  }
  const a = median(R.A);
  const b = median(R.B);
  wyniki.push({
    wraki: nW, dawny_us: +a.toFixed(1), omijanie_us: +b.toFixed(1), roznica_us: +(b - a).toFixed(1),
    na_okret_us: +((b - a) / NPC).toFixed(2), mozg_us: +median(R.M).toFixed(1)
  });
}
console.log(`${NPC} okrętów na rozkazach ruchu, µs na tick fizyki (120 Hz), mediana ${PRZEBIEGI} przebiegów po ${TICKI} ticków:`);
console.table(wyniki);
