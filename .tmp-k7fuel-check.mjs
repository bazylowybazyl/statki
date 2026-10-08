import { createK7Layout, K7_SERVICE_DOCK, K7_SERVICE_UNDOCK, k7ServiceConnectPose, k7ServiceDisconnectPose, K7_ATLAS, K7_ATLAS_COLLISION, k7TransformHull, k7MakeHullBuffer } from 'file:///C:/Users/Szymon/Documents/GitHub/statki/src/3d/haloRing/haloPortK7Layout.js';
import { createK7FuelRig, stepK7FuelRig, k7FuelGeometry, k7ScaraTip, k7FuelJoints, K7_HOSE_NODES } from 'file:///C:/Users/Szymon/Documents/GitHub/statki/src/3d/haloRing/haloPortK7Fuel.js';
const L = createK7Layout();
const b = L.berths[0];
for (const a of b.serviceAnchors) {
  const g = k7FuelGeometry(b, a);
  const d = (q) => (q * 180 / Math.PI).toFixed(1);
  console.log('side', a.side, 'pedestal', a.x, a.z, 'port', g.port, 'reach', g.reach);
  console.log(' stow q1', d(g.q1s), 'q2', d(g.q2s), ' work q1', d(g.q1w), 'q2', d(g.q2w), 'dq1', d(g.dq1));
  const t = {}; const j = {};
  for (const e of [0, 0.25, 0.5, 0.75, 1]) { k7FuelJoints(g, e, j); k7ScaraTip(g, j.q1, j.q2, t); console.log('  e', e, 'elbow', t.ex.toFixed(0), t.ez.toFixed(0), 'tip', t.x.toFixed(0), t.z.toFixed(0)); }
}
const rig = createK7FuelRig(L);
const poses = new Map(L.berths.filter(b => b.size === 'CAPITAL').map(b => [b.id, { clamp: 0, extension: 0, seat: 0, lock: 0, flow: 0, vent: 0 }]));
const hullBuf = k7MakeHullBuffer();
const hull = k7TransformHull(K7_ATLAS_COLLISION, K7_ATLAS.w, K7_ATLAS.h, b.x, b.z, b.angle, hullBuf);
const pose = poses.get('C-01');
const dt = 1 / 60;
const report = (tag) => {
  for (const h of rig.hoses.slice(0, 2)) {
    const M = K7_HOSE_NODES; const c = (M - 1) * 3; const P = h.pos;
    let minY = 1e9; let nan = false;
    for (let i = h.k0; i < M; i++) { const y = P[i * 3 + 1]; if (!Number.isFinite(y)) nan = true; if (y < minY) minY = y; }
    let len = 0; for (let i = h.k0; i < M - 1; i++) len += Math.hypot(P[i*3+3]-P[i*3], P[i*3+4]-P[i*3+1], P[i*3+5]-P[i*3+2]);
    console.log(tag, h.berthId, h.side, 'nodes', M - h.k0, 'L', h.length.toFixed(1), 'poly', len.toFixed(1), 'C', P[c].toFixed(0), P[c+1].toFixed(0), P[c+2].toFixed(0), 'latched', h.latched, 'minY', minY.toFixed(1), 'nan', nan, 'asleep', h.asleep);
  }
};
report('init');
let t = 0;
for (; t < K7_SERVICE_DOCK.end + 1.5; t += dt) { k7ServiceConnectPose(K7_SERVICE_DOCK, t, null, pose); stepK7FuelRig(rig, dt, poses, hull); }
report('docked');
for (let i = 0; i < 180; i++) stepK7FuelRig(rig, dt, poses, hull);
report('docked+3s');
console.log('stats', rig.stats);
for (t = 0; t < K7_SERVICE_UNDOCK.end + 2; t += dt) { k7ServiceDisconnectPose(K7_SERVICE_UNDOCK, t, null, pose); stepK7FuelRig(rig, dt, poses, hull); if (Math.abs(t - 1.7) < dt/2) report('unlatched'); }
report('undocked');
for (let i = 0; i < 300; i++) stepK7FuelRig(rig, dt, poses, hull);
report('rest');
console.log('stats', rig.stats);
let ms = performance.now();
for (let i = 0; i < 600; i++) { k7ServiceConnectPose(K7_SERVICE_DOCK, (i % 360) / 60, null, pose); stepK7FuelRig(rig, dt, poses, hull); }
console.log('600 frames ms', (performance.now() - ms).toFixed(1));
