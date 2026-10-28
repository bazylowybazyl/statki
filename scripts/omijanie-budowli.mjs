// OMIJANIE BUDOWLI przez pilota AI (src/ai/staticRoutes.js — trasy wokół budowli, src/ai/aiWreckIndex.js — kapsuły
// budowli w indeksie przeszkód) na PRAWDZIWEJ geometrii bazy piratów misji 1 (planPirateBase, pirateBaseObstacles),
// bez przeglądarki. Każdy przelot dwa razy: z budowlami w indeksie i bez nich (A/B). Pilot jak w grze: capitalArriveTo
// (mózgi, szyk, ucieczka okrętu misji) co takt AI 20 Hz, model lotu 120 Hz.
//
//   node scripts/omijanie-budowli.mjs [--trasy 0] [--png .tmp/omijanie-budowli.png]
//
// Przeloty: herszt (supercapital piratów) z końca trasy startu — ucieczka 30 km w stronę habitatu (0°, ±25°) i do gracza
// przy wylocie lejka, herszt ze stanowiska w zatoce, okręty z załogą z końców tras startu do gracza, pancernik, fregata
// i superkapitał Terra Novy od wylotu lejka za bazę. Miary: dolot [s], kroki 120 Hz ze środkiem okrętu w bryle trafień
// (`wBryle`) i bliżej bryły niż pół-szerokość korytarza (`styk`), najmniejszy luz [j.], najmniejsza prędkość w drodze;
// na końcu koszt grafu i zapytania o trasę. `--trasy 0` — bez tras (same kapsuły i omijanie lokalne): A/B pathfindingu.
// `--png` — mapa: bryły (szare), kapsuły (granat), tory bez budowli (czerwone) i z budowlami (błękitne).
import { writePng } from './webgpu/png.mjs';

globalThis.window = globalThis.window || {};
Object.assign(globalThis.window, {
  wrapAngle: (a) => Math.atan2(Math.sin(a), Math.cos(a)),
  queryAIGrid: null, ship: null, __frameId: 1, bullets: [], __npcRocketThreats: [], __playerRocketThreats: [], wrecks: []
});
const arg = (n, f) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : f; };

const { planPirateBase } = await import('../src/game/story/pirateBaseSite.js');
const BW = await import('../src/game/story/pirateBaseWorld.js');
const Idx = await import('../src/ai/aiWreckIndex.js');
const Routes = await import('../src/ai/staticRoutes.js');
await import('../src/ai/capitalAI.js');
const { stepShipFlight, resolveShipFlightSpec } = await import('../src/game/flight/shipFlightModel.js');
const { getHullRenderSize } = await import('../src/data/ships.js');

Routes.STATIC_ROUTE_TUNE.enabled = arg('trasy', '1') !== '0';

const plan = planPirateBase({ x: 0, y: 0 }, { x: -100000, y: 0 });
const place = plan.dock;
BW.attachPirateBaseWorld({ habitat: { id: 'habitat' }, fuel: { id: 'fuel' }, warehouse: { id: 'warehouse' }, piers: { id: 'piers' } }, place);
const statics = BW.pirateBaseObstacles().slice();
const shapes = place.hitShapes;

const segDist = (px, py, o) => {
  let s = (px - o.x) * o.ux + (py - o.y) * o.uy;
  if (s < -o.h) s = -o.h; else if (s > o.h) s = o.h;
  return Math.hypot(px - (o.x + o.ux * s), py - (o.y + o.uy * s));
};
function pointInPts(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function polyDist(pts, x, y) {
  let d = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j].x;
    const ay = pts[j].y;
    const ex = pts[i].x - ax;
    const ey = pts[i].y - ay;
    const L2 = ex * ex + ey * ey;
    const t = Math.max(0, Math.min(1, L2 > 0 ? ((x - ax) * ex + (y - ay) * ey) / L2 : 0));
    d = Math.min(d, Math.hypot(x - ax - ex * t, y - ay - ey * t));
  }
  return pointInPts(pts, x, y) ? -d : d;
}
const baseDist = (x, y) => { let d = Infinity; for (const sh of shapes) d = Math.min(d, polyDist(sh.pts, x, y)); return d; };

let worst = 0;
for (const sh of shapes) {
  const o = statics.find((r) => r.chunk === sh.chunk) || statics.find((r) => r.chunk === 'habitat');
  for (const p of sh.pts) worst = Math.max(worst, segDist(p.x, p.y, o) - o.w);
}
console.log(`budowle: ${statics.length} przeszkód z ${shapes.length} brył trafień; wierzchołek bryły najdalej poza kapsułą: ${worst.toFixed(2)} j.; trasy: ${Routes.STATIC_ROUTE_TUNE.enabled ? 'tak' : 'NIE'}`);

const HULLS = {
  boss: { type: 'pirate_supercapital', shipFrame: 'pirate_supercapital', isPirate: true },
  pbs: { type: 'pirate_battleship', shipFrame: 'pirate_battleship', isPirate: true },
  pdd: { type: 'pirate_destroyer', shipFrame: 'pirate_destroyer', isPirate: true },
  pff: { type: 'pirate_frigate', shipFrame: 'pirate_frigate', isPirate: true },
  tsc: { type: 'supercapital', shipFrame: 'terran_supercapital' },
  tbs: { type: 'battleship', shipFrame: 'terran_battleship' },
  tff: { type: 'frigate_pd', shipFrame: 'terran_frigate' }
};
const radiusOf = (frame) => { const s = getHullRenderSize(frame); return Math.max(s?.w || 0, s?.h || 0) / 2 || 300; };
const makeShip = (kind, x, y, angle) => ({ x, y, vx: 0, vy: 0, angle, angVel: 0, radius: radiusOf(HULLS[kind].shipFrame), ...HULLS[kind] });
const kindOf = (cls) => ({ frigate: 'pff', destroyer: 'pdd', battleship: 'pbs', supercapital: 'boss' }[cls] || 'pff');

const HZ = 120;
function fly(kind, ax, ay, bx, by, { obstacles, maxT = 180, angle = null } = {}) {
  Idx.rebuildWreckIndex([], null, obstacles ? statics : null);
  const s = makeShip(kind, ax, ay, angle ?? Math.atan2(by - ay, bx - ax));
  if (!resolveShipFlightSpec(s)) throw new Error(`brak specyfikacji lotu: ${kind}`);
  const myW = Math.max(60, s.radius * 0.4);
  let arrived = -1;
  let inside = 0;
  let touch = 0;
  let minClr = Infinity;
  let vmin = Infinity;
  const track = [];
  for (let i = 0; i < HZ * maxT; i++) {
    window.__frameId++;
    if (i % 6 === 0) window.capitalArriveTo(s, bx, by, { dt: 1 / 20, speedMode: 'combat', arrival: 0 });
    stepShipFlight(s, 1 / HZ);
    const d = baseDist(s.x, s.y);
    if (d < 0) inside++;
    if (d < myW) touch++;
    minClr = Math.min(minClr, d - myW);
    if (i % 30 === 0) track.push([s.x, s.y]);
    if (i > HZ * 3 && Math.hypot(s.x - bx, s.y - by) > 2500) vmin = Math.min(vmin, Math.hypot(s.vx, s.vy));
    if (Math.hypot(s.x - bx, s.y - by) < 400) { arrived = i / HZ; break; }
  }
  Idx.resetWreckIndex();
  return { dolot: arrived >= 0 ? +arrived.toFixed(1) : null, brak: Math.round(Math.hypot(s.x - bx, s.y - by)), wBryle: inside, styk: touch,
    luz: Math.round(minClr), vMin: Math.round(vmin), track };
}

const tracks = [];
const fmt = (r) => `dolot ${r.dolot === null ? `NIE (zostało ${r.brak} j.)` : `${r.dolot} s`}, wBryle ${r.wBryle}, styk ${r.styk}, luz ${r.luz}, vMin ${r.vMin}`;
function run(name, kind, ax, ay, bx, by, opts = {}) {
  const off = fly(kind, ax, ay, bx, by, { ...opts, obstacles: false });
  const on = fly(kind, ax, ay, bx, by, { ...opts, obstacles: true });
  tracks.push({ off: off.track, on: on.track });
  console.log(`${name}\n  bez budowli: ${fmt(off)}\n  z budowlami: ${fmt(on)}`);
}

const hab = place.habitat;
const boss = plan.parked.find((p) => p.boss);
const bossEnd = boss.launch.path[boss.launch.path.length - 1];
for (const deg of [0, 25, -25]) {
  const a = Math.atan2(hab.y - bossEnd.y, hab.x - bossEnd.x) + deg * Math.PI / 180;
  run(`herszt: ucieczka 30 km w stronę habitatu ${deg >= 0 ? '+' : ''}${deg}°`, 'boss', bossEnd.x, bossEnd.y, bossEnd.x + Math.cos(a) * 30000, bossEnd.y + Math.sin(a) * 30000);
}
run('herszt: z końca trasy startu do gracza przy wylocie lejka', 'boss', bossEnd.x, bossEnd.y, plan.mouth.x - 2000, plan.mouth.y);
run('herszt: ze stanowiska w zatoce do gracza', 'boss', boss.x, boss.y, plan.mouth.x - 2000, plan.mouth.y, { angle: boss.angle });
const farX = place.layout.width / 2 + 3000;
run('superkapitał TN: od wylotu lejka za bazę', 'tsc', plan.mouth.x - 1500, plan.mouth.y, farX, hab.y);
run('pancernik TN: od wylotu lejka za bazę', 'tbs', plan.mouth.x - 1500, plan.mouth.y, farX, hab.y);
run('fregata TN: od wylotu lejka za bazę', 'tff', plan.mouth.x - 1500, plan.mouth.y, farX, hab.y);

const crew = plan.parked.filter((p) => p.crew && !p.boss);
const crewStats = { bez: { dolot: 0, wBryle: 0 }, z: { dolot: 0, wBryle: 0 } };
for (const p of crew) {
  const e = p.launch.path[p.launch.path.length - 1];
  for (const [key, on] of [['bez', false], ['z', true]]) {
    const r = fly(kindOf(p.cls), e.x, e.y, plan.mouth.x - 2000, plan.mouth.y, { obstacles: on, maxT: 120 });
    if (r.dolot !== null) crewStats[key].dolot++;
    if (r.wBryle > 0) crewStats[key].wBryle++;
  }
}
console.log(`okręty z załogą (${crew.length}) z końców tras startu do gracza: ${JSON.stringify(crewStats)}`);

{
  const reps = 20;
  let t0 = performance.now();
  for (let i = 0; i < reps; i++) {
    Idx.resetWreckIndex();
    Idx.rebuildWreckIndex([], null, statics);
    Routes.staticRouteAim(makeShip('boss', plan.mouth.x - 1500, plan.mouth.y, 0), farX, hab.y, 240, {});
  }
  const buildMs = (performance.now() - t0) / reps;
  const s = makeShip('tbs', plan.mouth.x - 1500, plan.mouth.y, 0);
  const out = {};
  Routes.staticRouteAim(s, farX, hab.y, 125, out);
  const n = 20000;
  t0 = performance.now();
  for (let i = 0; i < n; i++) Routes.staticRouteAim(s, farX, hab.y, 125, out);
  const callUs = (performance.now() - t0) / n * 1000;
  const g = Routes.staticRouteStats().graphs;
  Idx.resetWreckIndex();
  console.log(`koszt: graf + pierwsza trasa ${buildMs.toFixed(2)} ms, zapytanie z trasą ${callUs.toFixed(2)} µs; grafy (luz → węzły / krawędzie): ${Object.entries(g).map(([k, v]) => `${k}: ${v.nodes}/${v.edges}`).join(', ')}`);
}

const out = arg('png', null);
if (out) {
  const W = 1400;
  const H = 1000;
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = 16; data[i * 4 + 1] = 16; data[i * 4 + 2] = 16; data[i * 4 + 3] = 255; }
  const X0 = -16000;
  const Y0 = -12000;
  const sc = Math.min(W / 32000, H / 24000);
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) { const k = (y * W + x) * 4; data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; } };
  const line = (x0, y0, x1, y1, c) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = X0 + x / sc;
      const gy = Y0 + y / sc;
      if (statics.some((o) => segDist(gx, gy, o) <= o.w)) put(x, y, [40, 46, 70]);
      if (shapes.some((sh) => pointInPts(sh.pts, gx, gy))) put(x, y, [120, 120, 130]);
    }
  }
  const px = (v) => Math.round((v - X0) * sc);
  const py = (v) => Math.round((v - Y0) * sc);
  for (const t of tracks) {
    for (const [tr, c] of [[t.off, [255, 80, 80]], [t.on, [80, 200, 255]]]) {
      for (let i = 1; i < tr.length; i++) line(px(tr[i - 1][0]), py(tr[i - 1][1]), px(tr[i][0]), py(tr[i][1]), c);
    }
  }
  writePng(out, { width: W, height: H, data });
  console.log(`mapa: ${out}`);
}
