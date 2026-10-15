// RW-23 / D2: trafienia salw przy różnym fps — dawny lot w klatce renderu (update(dtKlatki)) ↔ lot w kroku fizyki
// (step(1/60) + frameFx(dtKlatki)). Cele i strzelec ruszają się w krokach fizyki (jak w grze). Wynik: trafienia [%] i
// średni czas od salwy do trafienia — w D2 ten sam przy każdym fps, w dawnym liczony co klatkę renderu.
//   node scripts/rakiety-d2-fps.mjs [drzewo gry]
import { pathToFileURL, fileURLToPath } from 'node:url';
const R = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
globalThis.window = globalThis.window || globalThis;
const imp = (p) => import(pathToFileURL(R + '/' + p).href);
const { MASTER_WEAPONS } = await imp('src/data/weapons.js');
const { initRocketSystem3D } = await imp('src/game/rockets/rocketSim.js');
const { SimClock } = await imp('src/game/simClock.js');
function seed(v) { let s = v >>> 0; Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const PH = 1 / 60;
function run(mode, fps, id, tgt, n = 6) {
  seed(777); SimClock.reset?.();
  const sys = initRocketSystem3D(null, { effects: null });
  const def = MASTER_WEAPONS[id]; let hits = 0, fired = 0; const ht = []; let t0 = 0;
  const target = { radius: 60, dead: false, vx: 0, vy: 0, ...tgt };
  window.applyDamageToNPC = (npc) => { if (npc === target) { hits++; ht.push(SimClock.sim - t0); } };
  const shooter = { x: 0, y: 0, angle: 0, vx: 0, vy: 0, angVel: 0 };
  const fdt = 1 / fps;
  for (let s = 0; s < n; s++) {
    Object.assign(target, tgt, { dead: false });
    t0 = SimClock.sim;
    fired += sys.fireSalvo(shooter, 0, 0, target, def.baseDamage, def, 'blue', 0, 0, def.burstCount || 1, def.burstDelay || 0, 0, 0);
    let t = 0, acc = 0;
    while (t < 30 && (sys.activeRockets > 0 || sys.pendingLaunches > 0)) {
      acc += fdt; t += fdt;
      while (acc >= PH - 1e-12) {
        acc -= PH; target.x += target.vx * PH; target.y += target.vy * PH; SimClock.advance(PH);
        if (mode === 'D2') sys.step(PH);
      }
      SimClock.beginRender?.(acc / PH, PH, true);
      if (mode === 'D2') sys.frameFx(fdt); else sys.update(fdt);
    }
  }
  const m = ht.reduce((a, v) => a + v, 0) / Math.max(1, ht.length);
  return `${Math.round(100 * hits / Math.max(1, fired * (def.submunition ? def.submunition.count : 1)))}% t${m.toFixed(4)}`;
}
const CASES = [['missile_rack', { x: 5000, y: 0, vy: 300, radius: 40 }], ['fast_missile_rack', { x: 4000, y: 0, vy: 500, radius: 12 }],
  ['roj_pod', { x: 3000, y: 800, vy: 450, radius: 40 }], ['grad_launcher', { x: 6000, y: 0, vy: 350, radius: 150 }],
  ['hydra_mirv', { x: 9000, y: 0, vy: 250, radius: 150 }], ['supernova_missile', { x: 10000, y: 0, vy: 300, radius: 60 }]];
const rows = [];
for (const [id, tgt] of CASES) {
  const row = { id };
  for (const fps of [30, 60, 144]) { row['stary@' + fps] = run('old', fps, id, tgt); row['D2@' + fps] = run('D2', fps, id, tgt); }
  rows.push(row);
}
console.table(rows);
