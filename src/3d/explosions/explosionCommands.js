// src/3d/explosions/explosionCommands.js
//
// Dekoder rekordu EXPLOSION (RW-22, src/render/hullCommands.js) po stronie RENDERU: opcje z rekordu → fabryka wybuchów
// WebGPU (createExplosionFactory, BEZ opakowania z dronami — obrażenia dronów liczy gra przy zapisie rekordu).

import { HC, EXPLOSION } from '../../render/hullCommands.js';

const _tint = [1, 1, 1];
const _opts = {
  x: 0, y: 0, size: 300, profile: 'capital', vx: 0, vy: 0, axisX: 0, axisY: 0, jetVelTau: NaN, tint: null,
  gasOnly: false, hostKey: 0
};

/**
 * @param reader — czytelnik rozkazów (RenderCommands.reader)
 * @param getFactory — () → fabryka wybuchów albo null (render jeszcze bez niej)
 */
export function installExplosionCommands(reader, getFactory) {
  const stats = { n: 0, ok: 0 };
  reader.on(HC.EXPLOSION, (rd, d, o) => {
    const E = EXPLOSION;
    const f = getFactory();
    stats.n++;
    if (!f) return;
    const p = _opts;
    p.x = d[o + E.X]; p.y = d[o + E.Y]; p.size = d[o + E.SIZE]; p.profile = rd.str(d[o + E.PROFILE]);
    p.vx = d[o + E.VX]; p.vy = d[o + E.VY]; p.axisX = d[o + E.AXIS_X]; p.axisY = d[o + E.AXIS_Y];
    p.jetVelTau = d[o + E.JET_TAU];
    if (d[o + E.HAS_TINT]) {
      _tint[0] = d[o + E.TINT_R]; _tint[1] = d[o + E.TINT_G]; _tint[2] = d[o + E.TINT_B];
      p.tint = _tint;
    } else p.tint = null;
    p.gasOnly = d[o + E.GAS_ONLY] === 1;
    p.hostKey = d[o + E.HOST_KEY];
    if (f(p)) stats.ok++;
  });
  return stats;
}
