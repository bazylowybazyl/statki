// Wzorzec bit w bit FRONTU FALI na ciele płaskim sprzed optymalizacji 2026-10-15 (okno pełnego koła promienia frontu):
// dawne WorldChannels._blastBody skopiowane bez zmian (this → ch). Test porównuje kopnięcia, ciepło, aktywację
// i obrót z bieżącym kodem, który pomija komórki na pewno wewnątrz poprzedniego promienia
// (tests/worldBlastRing.test.mjs).
import { activateNode } from '../../src/game/beamActiveRegion3D.js';

export function referenceBlastBody(ch, B, blast, prevR, R) {
  const D = ch.D, t = ch.tune;
  const m = D._refreshRot(B), s = B.nodeStore, cs = B.cellSize;
  const rx = blast.x - B.pos.x, ry = blast.y - B.pos.y;
  const lx = m[0] * rx + m[3] * ry, ly = m[1] * rx + m[4] * ry;
  const fx = m[0] * blast.fx + m[3] * blast.fy, fy = m[1] * blast.fx + m[4] * blast.fy;
  const local = !!D.config.localSolver, free = !B.anchored && !B.static;
  const d0 = cs * 0.8, kickAt1 = t.blastKickCells * cs * blast.kick * cs * cs, kickMax = t.blastKickMaxCells * cs;
  // okno komórek wokół frontu
  const index = D._latticeIndex(B), cells = index.cells, lm = B.latticeMin, dims = B.dims;
  const pad = R + (B._maxDisp || 0) + cs;
  const x0 = Math.max(0, Math.floor((lx - pad - lm.x) / cs - 0.5)), x1 = Math.min(dims.x - 1, Math.ceil((lx + pad - lm.x) / cs - 0.5));
  const y0 = Math.max(0, Math.floor((ly - pad - lm.y) / cs - 0.5)), y1 = Math.min(dims.y - 1, Math.ceil((ly + pad - lm.y) / cs - 0.5));
  let tz = 0, any = false, hot = false;
  const R2 = R * R, P2 = prevR > 0 ? prevR * prevR : -1;
  for (let iy = y0; iy <= y1; iy++) {
    const rowBase = iy * dims.x;
    for (let ix = x0; ix <= x1; ix++) {
      const i = cells[rowBase + ix];
      if (i < 0 || !s.active[i]) continue;
      const qx = s.x[i] - lx, qy = s.y[i] - ly;
      const d2 = qx * qx + qy * qy;
      if (d2 > R2 || d2 <= P2) continue;
      const d = Math.sqrt(d2);
      const kick = Math.min(kickMax, kickAt1 / Math.max(d0 * d0, d2));
      if (s.invMass[i] > 0) {
        let ux = d > 1e-6 ? qx / d : fx, uy = d > 1e-6 ? qy / d : fy;
        ux += fx * t.blastForward; uy += fy * t.blastForward;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1;
        const vx = ux / ul * kick, vy = uy / ul * kick;
        s.vx[i] += vx; s.vy[i] += vy;
        if (free) {
          const wx = m[0] * s.x[i] + m[1] * s.y[i], wy = m[3] * s.x[i] + m[4] * s.y[i];
          const jx = (m[0] * vx + m[1] * vy) * s.mass[i], jy = (m[3] * vx + m[4] * vy) * s.mass[i];
          tz += wx * jy - wy * jx;
        }
        if (local) activateNode(B, i);
      }
      if (t.blastHeat > 0 && s.temp) {
        const T = t.blastHeat * kick / kickMax;
        if (T > s.temp[i]) { s.temp[i] = T; hot = true; }
      }
      any = true;
    }
  }
  if (!any) return;
  if (free && B.invInertiaLocal) B.angVel.z += B.invInertiaLocal[8] * tz / Math.max(1e-6, B.rammingMassMult || 1);
  D.wake(B, D.config.wakeHoldFrames);
  B.meshDirty = true;
  if (hot) ch.hot.add(B);
}
