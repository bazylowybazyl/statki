// Symulacja salw rakiet w Node (bez obrazu, 2026-09-30): trafienia, wysokość wyrzutu i zapłonu, rozrzut
// wachlarza w bok, wysokość wybuchu, czas salwy — tabela do strojenia pól lotu w src/data/weapons.js.
//   node scripts/rakiety-salwy-sym.mjs
import * as THREE from 'three';
globalThis.window = globalThis.window ?? {};
const { MASTER_WEAPONS } = await import('../src/data/weapons.js');
const { initRocketSystem3D } = await import('../src/effects3d/rocketSystem3D.js');
const sys = initRocketSystem3D(new THREE.Scene());
const hDet = [];
const origExplode = sys._explode.bind(sys);
sys._explode = (r) => { hDet.push(r.position.y); return origExplode(r); };
function run(id, tgt, n = 6, { dt = 1 / 60, maxT = 30, vx = 0 } = {}) {
  const def = MASTER_WEAPONS[id];
  let hits = 0, splits = 0;
  const target = { radius: 60, dead: false, vx: 0, vy: 0, ...tgt };
  window.applyDamageToNPC = (npc) => { if (npc === target) hits++; };
  const shooter = { x: 0, y: 0, angle: 0, vx, vy: 0, angVel: 0 };
  const count = def.burstCount || 1;
  hDet.length = 0;
  let fired = 0; let maxH = 0; let hAtIgn = []; let spread = 0; let tHit = [];
  for (let s = 0; s < n; s++) {
    Object.assign(target, tgt, { dead: false });
    shooter.x = 0; shooter.y = 0;
    fired += sys.fireSalvo(shooter, 0, 0, target, def.baseDamage, def, 'blue', vx, 0, count, def.burstDelay || 0, 0, 0);
    let t = 0;
    const seen = new Set();
    while (t < maxT && (sys.activeRockets > 0 || sys.pendingLaunches > 0)) {
      target.x += target.vx * dt; target.y += target.vy * dt; shooter.x += vx * dt;
      sys.update(dt); t += dt;
      for (const r of sys.rockets) {
        if (!r.active) continue;
        maxH = Math.max(maxH, r.position.y);
        if (r.state === 'POWERED' && !seen.has(r)) { seen.add(r); hAtIgn.push(r.position.y); }
        // odchylenie w bok od linii wyrzutnia → cel (miara wachlarza)
        const lx = r.position.x - shooter.x, ly = r.position.z - shooter.y;
        const tx = target.x - shooter.x, ty = target.y - shooter.y; const tl = Math.hypot(tx, ty) || 1;
        spread = Math.max(spread, Math.abs(lx * ty / tl - ly * tx / tl));
      }
    }
    tHit.push(t);
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
  return { id, rakiet: fired, trafien: hits, procent: Math.round(100 * hits / Math.max(1, fired * (def.submunition ? def.submunition.count : 1))),
    maxWys: Math.round(maxH), wysZaplon: Math.round(avg(hAtIgn)), rozrzutBok: Math.round(spread), wysWybuch: Math.round(avg(hDet)), czasSalwy: +avg(tHit).toFixed(2) };
}
const rows = [];
rows.push(run('missile_rack', { x: 5000, y: 0, radius: 40 }));
rows.push(run('missile_rack', { x: 5000, y: 0, vy: 300, radius: 40 }));
rows.push(run('fast_missile_rack', { x: 4000, y: 0, vy: 500, radius: 12 }));
rows.push(run('roj_pod', { x: 4000, y: 0, vy: 250, radius: 90 }));
rows.push(run('roj_pod', { x: 3000, y: 800, vy: 450, radius: 40 }));
rows.push(run('grad_launcher', { x: 6000, y: 0, radius: 250 }));
rows.push(run('grad_launcher', { x: 6000, y: 0, vy: 350, radius: 150 }));
rows.push(run('grad_launcher', { x: 2500, y: 1500, vy: -300, radius: 120 }));
rows.push(run('hydra_mirv', { x: 9000, y: 0, vy: 250, radius: 150 }));
rows.push(run('hydra_mirv', { x: 1200, y: 300, radius: 150 }));
rows.push(run('supernova_missile', { x: 10000, y: 0, vy: 300, radius: 60 }));
rows.push(run('grad_launcher', { x: 6000, y: 0, vy: 350, radius: 150 }, 3, { vx: 3000 }));
console.table(rows);
