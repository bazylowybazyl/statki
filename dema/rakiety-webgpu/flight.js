// dema/rakiety-webgpu/flight.js
//
// Model lotu rakiet dema — port logiki z src/effects3d/rocketSystem3D.js
// (tam w scenie overlaya Y-up z kwaternionem; tu w płaszczyźnie gry, bo
// wysokość i tak nie jest widoczna w kamerze ortho z góry):
//   • zimny start z wyrzutni: wyrzut z rozrzutem ±150 j./s, zapłon po
//     `ignitionDelay` (0,12 s domyślnie);
//   • lot kinematyczny: prędkość idzie za nosem, szybkość goni desiredSpeed
//     z limitem przyspieszenia maxThrust / masa (hamowanie 0,8 ×);
//   • fazy launch → intercept → terminal → reacquire, wyprzedzenie celu
//     (leadHorizon / terminalLeadHorizon), obrót z limitem turnRate;
//   • UKŁAD RAKIETY = pęd wyrzutni (frameVx/Vy), stały; zasięg = droga własna;
//   • zapalnik zbliżeniowy z odcinka klatki (bez tunelowania) + kontaktowy
//     z pola odległości kadłuba celu (wybuch NA poszyciu).
// Parametry z src/data/weapons.js (resolveRocketProfile jak w grze).

import { MASTER_WEAPONS as WEAPONS } from '../../src/data/weapons.js';

const WS = 0.1;
const ROCKET = Object.freeze({
  mass: 8000,
  maxThrust: 28_000_000 * WS,
  ejectUp: 1500 * WS,
  ejectUpRandom: 1000 * WS,
  ejectSpread: 1500 * WS,
  hitRadius: 800 * WS,
  bodyLength: 160 * WS,
  maxAltitude: 500 * WS,
  gravity: 9.81 * 80 * WS
});
export const ROCKET_BODY_LENGTH = ROCKET.bodyLength;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Profil lotu z definicji broni — lustro resolveRocketProfile z gry. */
export function resolveRocketProfile(def) {
  const desiredSpeed = Math.max(400, Number(def?.baseSpeed) || Number(def?.speed) || 1200);
  const maxRange = Math.max(3000, Number(def?.baseRange) || Number(def?.range) || 12000);
  const blastRadius = Math.max(24, Number(def?.explodeRadius) || Number(def?.explosionRadius) || 48);
  const turnRateDeg = Math.max(25, Number(def?.turnRate) || 180);
  const speedFactor = clamp(desiredSpeed / 1200, 0.6, 4.0);
  const turnPenalty = clamp(180 / turnRateDeg, 0.45, 4.0);
  const homingDelay = clamp(Number(def?.homingDelay) || 0, 0, 3);
  const ignitionDelayRaw = Number(def?.ignitionDelay);
  const speedScale = Math.max(0.9, desiredSpeed / 900);
  const proximityDefault = Math.max(blastRadius * 0.9, 38 * speedFactor * Math.sqrt(turnPenalty));
  const proximityRadius = clamp(Number(def?.proximityRadius) || proximityDefault, 50, 320);
  const terminalRadius = clamp(
    Number(def?.terminalRadius) || Math.max(proximityRadius * 2.15, desiredSpeed * 0.16 * turnPenalty),
    proximityRadius * 1.2,
    Math.max(proximityRadius * 4.5, 900)
  );
  const reacquireRadius = clamp(
    Number(def?.reacquireRadius) || Math.max(terminalRadius * 1.45, desiredSpeed * 0.36 * turnPenalty),
    terminalRadius,
    Math.max(terminalRadius * 4.0, 2400)
  );
  const k = clamp(turnRateDeg / 420, 0, 1);
  return {
    desiredSpeed,
    maxRange,
    blastRadius,
    turnRateRad: turnRateDeg * Math.PI / 180,
    homingDelay,
    ignitionDelay: Number.isFinite(ignitionDelayRaw) ? clamp(ignitionDelayRaw, 0.05, 0.35) : 0.12,
    maxThrust: ROCKET.maxThrust * speedScale,
    proximityRadius,
    terminalRadius,
    reacquireRadius,
    reacquireTurnMultiplier: clamp(Number(def?.reacquireTurnMultiplier) || lerp(2.3, 1.55, k), 1.2, 3.2),
    reacquireSpeedFactor: clamp(Number(def?.reacquireSpeedFactor) || lerp(0.52, 0.72, k), 0.35, 0.95),
    terminalSpeedFactor: clamp(Number(def?.terminalSpeedFactor) || lerp(0.68, 0.86, k), 0.45, 1.0),
    leadHorizon: clamp(Number(def?.leadHorizon) || lerp(0.82, 0.38, k), 0, 1),
    terminalLeadHorizon: clamp(Number(def?.terminalLeadHorizon) || lerp(0.18, 0.06, k), 0, 0.5),
    bodyScale: clamp(Number(def?.bodyScale) || 1, 0.35, 3.0),
    exhaustScale: clamp(Number(def?.exhaustScale) || 1, 0.35, 3.0),
    explosionVisualScale: clamp(Number(def?.explosionVisualScale) || 1, 0.25, 4.0)
  };
}

const _lead = { x: 0, y: 0, t: 0 };

/** Wyprzedzenie w układzie rakiety (frame): punkt = cel + (v_celu − układ)·t. */
function solveLeadAim2D(sx, sy, svx, svy, target, projectileSpeed, fx, fy, out = _lead) {
  const tx = target.x;
  const ty = target.y;
  const tvx = target.vx || 0;
  const tvy = target.vy || 0;
  const speed = Math.max(1, projectileSpeed);
  const rx = tx - sx;
  const ry = ty - sy;
  const rvx = tvx - svx;
  const rvy = tvy - svy;
  const a = rvx * rvx + rvy * rvy - speed * speed;
  const b = 2 * (rx * rvx + ry * rvy);
  const c = rx * rx + ry * ry;
  let t = 0;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) > 1e-6) t = -c / b;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      t = Math.min(t1, t2);
      if (t < 0) t = Math.max(t1, t2);
    }
  }
  if (!Number.isFinite(t) || t < 0) t = 0;
  out.x = tx + (tvx - fx) * t;
  out.y = ty + (tvy - fy) * t;
  out.t = t;
  return out;
}

let _nextId = 1;

/**
 * Rakiety w locie. Zdarzenia dla efektów:
 *   onLaunch(m), onIgnite(m), onFly(m, dt, x0, y0) (po kroku — odcinek lotu),
 *   onDetonate(m, x, y, hull | null, nx, ny) — (nx, ny) normalna poszycia.
 */
export class MissileFlight {
  constructor(handlers = {}) {
    this.list = [];
    this.h = handlers;
    this.cinematic = null; // { turnRateDeg, spreadDeg } — tryb „łuki kinowe”
  }

  get count() { return this.list.length; }

  /**
   * Odpalenie. vfxKey: 'cruise' | 'fast' | 'supernova'.
   * target: { x, y, vx, vy, radius, dead, hull? } lub { x, y, point: true }.
   */
  fire(vfxKey, weaponId, x, y, target, opts = {}) {
    const def = WEAPONS[weaponId];
    const p = resolveRocketProfile(def);
    const fx = opts.frameVx || 0;
    const fy = opts.frameVy || 0;
    const rnd = opts.rng || Math.random;
    const m = {
      id: _nextId++,
      vfx: vfxKey,
      def,
      p,
      x, y,
      z: 18,
      // Ruch własny (układ rakiety) + układ wyrzutni.
      vx: (rnd() - 0.5) * ROCKET.ejectSpread * 2 * (opts.ejectScale ?? 1),
      vy: (rnd() - 0.5) * ROCKET.ejectSpread * 2 * (opts.ejectScale ?? 1),
      vz: ROCKET.ejectUp + rnd() * ROCKET.ejectUpRandom,
      fx, fy,
      heading: opts.heading ?? 0,
      speed: 0,
      throttle: 0,
      state: 'EJECTED',
      phase: 'launch',
      t: 0,
      travel: 0,
      target,
      lastDist: Infinity,
      missGrow: 0,
      missCount: 0,
      reacquireUntil: 0,
      turnRateRad: p.turnRateRad,
      alive: true,
      terminalT: 0,
      seed: rnd(),
      userData: {}
    };
    if (this.cinematic) {
      m.turnRateRad = Math.min(m.turnRateRad, this.cinematic.turnRateDeg * Math.PI / 180);
    }
    // Nos w stronę celu przesuniętego o ruch względem układu wyrzutni.
    if (target && !target.dead) {
      const aim = target.point ? { x: target.x, y: target.y } : solveLeadAim2D(x, y, fx, fy, target, p.desiredSpeed, fx, fy);
      m.heading = Math.atan2(aim.y - y, aim.x - x);
    }
    if (this.cinematic && this.cinematic.spreadDeg > 0) {
      m.heading += (rnd() - 0.5) * 2 * this.cinematic.spreadDeg * Math.PI / 180;
    }
    if (Number.isFinite(opts.headingOffset)) m.heading += opts.headingOffset;
    this.list.push(m);
    this.h.onLaunch?.(m);
    return m;
  }

  update(dt) {
    if (dt <= 0) return;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m.alive) continue;
      this._step(m, dt);
    }
    // Zdjęcie wybuchłych (kolejność listy bez znaczenia).
    let w = 0;
    for (let i = 0; i < list.length; i++) if (list[i].alive) list[w++] = list[i];
    list.length = w;
  }

  _step(m, dt) {
    const p = m.p;
    m.t += dt;
    if (m.state === 'EJECTED' && (m.t > p.ignitionDelay || m.vz < -0.5)) {
      m.state = 'POWERED';
      this.h.onIgnite?.(m);
    }
    let desired = Math.max(300, p.desiredSpeed);
    const tgt = m.target;
    const x0 = m.x;
    const y0 = m.y;
    if (tgt && !tgt.dead) {
      const point = !!tgt.point;
      const tx = tgt.x;
      const ty = tgt.y;
      const tr = point ? 0 : Math.max(0, tgt.radius || 0);
      const fuse = Math.max(p.proximityRadius, tr * 0.9);
      const terminalR = Math.max(p.terminalRadius || fuse * 2, fuse * 1.35);
      const reacqR = Math.max(p.reacquireRadius || terminalR * 1.4, terminalR);
      const dist = Math.hypot(tx - m.x, ty - m.y);
      if (point) m.phase = m.state === 'EJECTED' ? 'launch' : 'intercept';
      else if (m.phase === 'launch' && m.state === 'POWERED') m.phase = 'intercept';
      if (!point) {
        if (m.phase !== 'reacquire' && dist <= terminalR) {
          if (m.phase !== 'terminal') { m.phase = 'terminal'; m.missGrow = 0; }
        } else if (m.phase === 'reacquire' && (dist <= terminalR * 1.15 || m.t >= m.reacquireUntil)) {
          m.phase = dist <= terminalR ? 'terminal' : 'intercept';
          m.missGrow = 0;
        }
        if (m.phase === 'terminal' && Number.isFinite(m.lastDist)) {
          const missThr = Math.max(14, fuse * 0.1);
          const close = m.lastDist <= Math.max(reacqR, fuse * 1.9);
          if (dist > m.lastDist + missThr && close && dist > fuse * 1.08) {
            m.missGrow += dt;
            if (m.missGrow >= 0.06) {
              m.phase = 'reacquire';
              m.missCount++;
              m.reacquireUntil = m.t + clamp(0.24 + m.missCount * 0.08, 0.24, 0.9);
              m.missGrow = 0;
            }
          } else {
            m.missGrow = Math.max(0, m.missGrow - dt * 2.5);
          }
        }
      }
      const planar = Math.max(300, Math.hypot(m.vx, m.vy), desired);
      const svx = m.vx + m.fx;
      const svy = m.vy + m.fy;
      const tuned = solveLeadAim2D(m.x, m.y, svx, svy, tgt, planar, m.fx, m.fy);
      let lx = tuned.x;
      let ly = tuned.y;
      const frameSpeed = Math.hypot(m.fx, m.fy);
      const drift = frameSpeed > 1e-6 ? frameSpeed / (frameSpeed + Math.hypot(tgt.vx || 0, tgt.vy || 0)) : 0;
      if (drift > 0) {
        const tx0 = lx;
        const ty0 = ly;
        const trueLead = solveLeadAim2D(m.x, m.y, m.fx, m.fy, tgt, planar, m.fx, m.fy);
        lx = tx0 + (trueLead.x - tx0) * drift;
        ly = ty0 + (trueLead.y - ty0) * drift;
      }
      let leadW = 0;
      let turn = Math.max(0.001, m.turnRateRad);
      if (m.phase === 'launch') leadW = point ? 0 : 0.15;
      else if (m.phase === 'intercept') leadW = point ? 0 : p.leadHorizon;
      else if (m.phase === 'terminal') { leadW = point ? 0 : p.terminalLeadHorizon; desired *= p.terminalSpeedFactor; turn *= 1.25; }
      else if (m.phase === 'reacquire') { leadW = point ? 0 : Math.min(0.18, p.terminalLeadHorizon); desired *= p.reacquireSpeedFactor; turn *= p.reacquireTurnMultiplier; }
      const aimW = leadW + (1 - leadW) * drift;
      const ax = lerp(tx, lx, aimW);
      const ay = lerp(ty, ly, aimW);
      const want = Math.atan2(ay - m.y, ax - m.x);
      const err = wrapAngle(want - m.heading);
      if (m.phase === 'reacquire' || m.phase === 'terminal') desired *= lerp(1.0, 0.45, clamp(Math.abs(err) / Math.PI, 0, 1));
      if (m.t >= p.homingDelay || m.phase === 'reacquire' || m.phase === 'terminal') {
        const step = turn * dt;
        m.heading = wrapAngle(m.heading + clamp(err, -step, step));
      } else {
        m.heading = wrapAngle(m.heading + err * clamp(dt * 6, 0, 0.18));
      }
      m.lastDist = dist;
      if (m.phase === 'terminal') m.terminalT += dt;
    }

    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    if (m.state === 'POWERED') {
      const speed = Math.hypot(m.vx, m.vy, Math.max(0, m.vz));
      const want = Math.max(220, desired);
      const acc = p.maxThrust / ROCKET.mass;
      const ns = speed < want ? Math.min(want, speed + acc * dt) : Math.max(want, speed - acc * 0.8 * dt);
      m.vx = c * ns;
      m.vy = s * ns;
      m.vz = 0;
      m.speed = ns;
      m.throttle = clamp(((want - speed) / want) * 1.4 + 0.25, 0.12, 1.0);
    } else {
      m.vz -= ROCKET.gravity * dt;
      m.speed = Math.hypot(m.vx, m.vy);
      m.throttle = 0;
    }
    m.x += (m.vx + m.fx) * dt;
    m.y += (m.vy + m.fy) * dt;
    m.travel += Math.hypot(m.vx, m.vy) * dt;

    this.h.onFly?.(m, dt, x0, y0);

    // Zapalnik: kontakt z poszyciem (pole odległości) albo zbliżenie (odcinek).
    if (tgt && !tgt.dead) {
      const point = !!tgt.point;
      const tr = point ? 0 : Math.max(0, tgt.radius || 0);
      const fuse = Math.max(p.proximityRadius, tr * 0.9);
      const armT = point ? 0.7 : 0.18;
      const armD = point ? Math.max(320, fuse * 4.0) : Math.max(90, fuse * 1.1);
      const armed = m.t >= armT && m.travel >= armD;
      if (armed) {
        if (!point && tgt.hull && tgt.hull.sdfAt) {
          // Kontakt: pierwszy punkt odcinka na poszyciu (≤ 4 j. od sylwetki).
          const segL = Math.hypot(m.x - x0, m.y - y0);
          const n = Math.max(2, Math.min(24, Math.ceil(segL / 12)));
          for (let k = 1; k <= n; k++) {
            const u = k / n;
            const px = x0 + (m.x - x0) * u;
            const py = y0 + (m.y - y0) * u;
            const d = tgt.hull.sdfAt(px, py);
            if (d <= 4) {
              const g = tgt.hull.sdfGradAt(px, py);
              this._detonate(m, px, py, tgt.hull, g.x, g.y);
              return;
            }
          }
        }
        const sx = m.x - x0;
        const sy = m.y - y0;
        const L2 = sx * sx + sy * sy;
        let u = L2 > 1e-9 ? ((tgt.x - x0) * sx + (tgt.y - y0) * sy) / L2 : 1;
        u = clamp(u, 0, 1);
        const cx = x0 + sx * u;
        const cy = y0 + sy * u;
        if (Math.hypot(tgt.x - cx, tgt.y - cy) <= fuse) {
          // Zbliżenie nad kadłubem: wybuch na poszyciu, jeśli punkt leży na sylwetce.
          let hull = null;
          let nx = -c;
          let ny = -s;
          if (!point && tgt.hull && tgt.hull.sdfAt && tgt.hull.sdfAt(cx, cy) <= 8) {
            hull = tgt.hull;
            const g = hull.sdfGradAt(cx, cy);
            nx = g.x; ny = g.y;
          }
          this._detonate(m, cx, cy, hull, nx, ny);
          return;
        }
      }
    }
    if (m.travel >= p.maxRange) this._detonate(m, m.x, m.y, null, -c, -s);
  }

  _detonate(m, x, y, hull, nx, ny) {
    m.alive = false;
    m.x = x;
    m.y = y;
    this.h.onDetonate?.(m, x, y, hull, nx, ny);
  }

  /** Detonacja wszystkich (np. zmiana scenariusza). */
  clear(detonate = false) {
    for (const m of this.list) {
      if (!m.alive) continue;
      if (detonate) this._detonate(m, m.x, m.y, null, -Math.cos(m.heading), -Math.sin(m.heading));
      m.alive = false;
    }
    this.list.length = 0;
  }
}
