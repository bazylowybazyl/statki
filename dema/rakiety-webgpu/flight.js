// dema/rakiety-webgpu/flight.js
//
// Model lotu rakiet dema — port logiki z src/game/rockets/rocketSim.js
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
//
// WYRZUT Z GRY (`opts.game` w fire — dziś Supernova Barrage, 2026-11-09): lot jak
// w src/game/rockets/rocketSim.js (`_update`, stan 2026-11-09) — zimny wyrzut z komory pod
// `launchElevation` z zawisem (prędkość gaśnie e^(−1,8·t/ignitionDelay)), zapłon, przechył
// w kurs WACHLARZA salwy (`dispersal`, `dispersalTime`, obrót `launchTurnRate`), naprowadzanie
// z obrotem narastającym od 40 % przez 1 s, kluczenie `weave`, zejście z wysokości przelotu
// na płaszczyznę na granicy zapalnika. Nos sterowany osobno KURSEM i WZNIESIENIEM
// (`heading` = kurs, `nosePitch`), wysokość `z` to tylko obraz. Zmiana lotu w grze → przenieś tutaj.
//
// CZŁON SPRINTU (tylko demo, 2026-11-10 — rakieta „Niszczyciel”, karta w weaponsDemo.js, pole `sprint`):
// rakieta z lotem gry leci członem startowym (`stage` 1) do `sprint.range` od celu; gdy nos patrzy w punkt
// wyprzedzenia z błędem ≤ `sprint.align`, odpala człon sprintu (`stage` 2, zdarzenie onSprint): goni
// `sprint.speed` z przyspieszeniem `sprint.accel`, obrót `sprint.turnRate`, pełne wyprzedzenie celu, zejście
// na płaszczyznę. Bez zwalniania w fazie końcowej; cel minięty w sprincie = wybuch w miejscu (nawrót przy
// tej prędkości trwałby dłużej niż reszta zasięgu).

import { MASTER_WEAPONS as WEAPONS } from '../../src/data/weapons.js';
import { DEMO_WEAPONS } from './weaponsDemo.js';

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
// Lot z gry (rocketSim.js): pułap obrazu, zawis, narastanie obrotu po wachlarzu.
const GAME_MAX_ALTITUDE = 600;
const POP_DECAY = 1.8;
const TURN_RAMP = 1.0;
const TURN_RAMP_START = 0.4;
const DEG = Math.PI / 180;
const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Liczba 0..1 z ziarna i klucza — jak seedHash w rocketSim.js (rozrzut wyrzutu i wachlarza salwy). */
export function seedHash(seed, k) {
  let h = ((seed * 4294967296) >>> 0) ^ Math.imul(k + 0x6D2B79F5, 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
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
  const cruiseAltitudeRaw = Number(def?.cruiseAltitude);
  const sp = def?.sprint;
  const pen = def?.penetration;
  return {
    // Człon sprintu i przebicie kadłuba (tylko demo — „Niszczyciel”); null = rakieta jednoczłonowa.
    sprint: sp && Number(sp.speed) > 0 ? {
      range: Math.max(200, Number(sp.range) || 2000),
      speed: Math.max(desiredSpeed, Number(sp.speed)),
      accel: clamp(Number(sp.accel) || 6000, 200, 40000),
      turnRateRad: clamp(Number(sp.turnRate) || turnRateDeg, 10, 720) * DEG,
      alignRad: clamp(Number(sp.align) || 12, 2, 60) * DEG
    } : null,
    penetration: pen ? { depth: Math.max(0, Number(pen.depth) || 0), delay: clamp(Number(pen.delay) || 0.15, 0, 1) } : null,
    // Wyrzut z gry (rocketSim.js resolveRocketProfile) — tylko lot `game`.
    launch: {
      accel: Number(def?.boostAccel) > 0 ? clamp(Number(def.boostAccel), 200, 20000) : (ROCKET.maxThrust * speedScale) / ROCKET.mass,
      elevation: clamp(numOr(def?.launchElevation, 70), 0, 90) * DEG,
      ejectSpeed: clamp(Number(def?.ejectSpeed) || 320, 40, 1500),
      ignitionDelay: clamp(numOr(def?.ignitionDelay, 0.12), 0.04, 0.8),
      launchTurnRateRad: clamp(Number(def?.launchTurnRate) || Math.max(240, turnRateDeg * 0.5), 60, 1440) * DEG,
      dispersalRad: clamp(Number(def?.dispersal) || 0, 0, 170) * DEG,
      dispersalTime: clamp(numOr(def?.dispersalTime, 0.2), 0, 1.5),
      weaveRad: clamp(Number(def?.weave) || 0, 0, 40) * DEG,
      weaveHz: clamp(Number(def?.weaveHz) || 0, 0, 8),
      cruiseAltitude: Number.isFinite(cruiseAltitudeRaw)
        ? clamp(cruiseAltitudeRaw, 0, GAME_MAX_ALTITUDE * 0.9)
        : Math.min(GAME_MAX_ALTITUDE * 0.2, Math.max(30, desiredSpeed * 0.03))
    },
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
 *   onSprint(m) — start członu sprintu (m.stage = 2),
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
   * Odpalenie. vfxKey: 'cruise' | 'fast' | 'supernova' | 'niszczyciel'.
   * target: { x, y, vx, vy, radius, dead, hull? } lub { x, y, point: true }.
   */
  fire(vfxKey, weaponId, x, y, target, opts = {}) {
    const def = WEAPONS[weaponId] || DEMO_WEAPONS[weaponId];
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
      // Człon: 1 — startowy (jedyny u rakiet jednoczłonowych), 2 — sprintu (profil `sprint`).
      stage: 1,
      sprintAt: 0,
      // Kadłub, w który trafiła (kamera pokazu jedzie z nim po wybuchu).
      hitHull: null,
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
    if (opts.game) this._initGameLaunch(m, opts.salvo || null, rnd);
    this.list.push(m);
    this.h.onLaunch?.(m);
    return m;
  }

  /**
   * Wyrzut jak w grze (rocketSim.fire, tryb LAUNCH_ELEVATED): kurs wachlarza salwy (złoty podział
   * numeru rakiety + obrót salwy z ziarna), zimny wyrzut z komory pod kątem launchElevation
   * (±4°, prędkość ±10 %), zawis do zapłonu. salvo: { index, count, seed } — jedna salwa = jedno ziarno.
   */
  _initGameLaunch(m, salvo, rnd) {
    const L = m.p.launch;
    const index = salvo ? salvo.index : 0;
    const count = salvo ? Math.max(1, salvo.count) : 1;
    const seed = salvo && Number.isFinite(salvo.seed) ? salvo.seed : rnd();
    const hk = index * 16;
    m.game = true;
    const aimAz = m.heading;
    let fan = (seedHash(seed, hk + 1) - 0.5) * 2 * (0.08 + 0.12 * L.dispersalRad);
    if (count > 1 && L.dispersalRad > 0) {
      const u = (index * 0.6180339887 + seedHash(seed, 4093)) % 1;
      fan += (u * 2 - 1) * L.dispersalRad;
    }
    m.dispAz = aimAz + fan;
    const el = clamp(L.elevation + (seedHash(seed, hk + 3) - 0.5) * 0.14, 0, Math.PI / 2);
    const az = aimAz + (seedHash(seed, hk + 4) - 0.5) * 0.4;
    const sp = L.ejectSpeed * (0.9 + 0.2 * seedHash(seed, hk + 5));
    const ce = Math.cos(el);
    m.vx = ce * Math.cos(az) * sp;
    m.vy = ce * Math.sin(az) * sp;
    m.vz = Math.sin(el) * sp;
    m.z = 0;
    m.ignitionDelay = L.ignitionDelay * (0.85 + 0.3 * seedHash(seed, hk + 6));
    m.popDrag = POP_DECAY / Math.max(0.04, m.ignitionDelay);
    m.heading = az;
    m.nosePitch = el;
    m.ignitedAt = 0;
    m.interceptAt = 0;
    m.weavePhase = seedHash(seed, hk + 7) * TAU;
    m.weavePhase2 = seedHash(seed, hk + 8) * TAU;
    m.speed = Math.hypot(m.vx, m.vy);
    m.throttle = 0;
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
    if (m.game) { this._stepGame(m, dt); return; }
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

    if (this._fuse(m, tgt, x0, y0, c, s)) return;
    if (m.travel >= p.maxRange) this._detonate(m, m.x, m.y, null, -c, -s);
  }

  /** Zapalnik po kroku (odcinek x0, y0 → m.x, m.y); true — rakieta wybuchła. */
  _fuse(m, tgt, x0, y0, c, s) {
    const p = m.p;
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
              return true;
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
          return true;
        }
      }
    }
    return false;
  }

  /** Krok lotu jak w grze (rocketSim._update, gałąź LAUNCH_ELEVATED; układ: x, y gry, z — wysokość). */
  _stepGame(m, dt) {
    const p = m.p;
    const L = p.launch;
    m.t += dt;
    const t = m.t;
    if (m.state === 'EJECTED' && t >= m.ignitionDelay) {
      m.state = 'POWERED';
      m.ignitedAt = t;
      this.h.onIgnite?.(m);
    }
    const speedNow = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz);
    let desired = Math.max(300, p.desiredSpeed);
    let desAz = m.heading;
    let desEl = 0;
    let azRate = Math.max(0.001, m.turnRateRad);
    let elRate = Math.max(azRate, L.launchTurnRateRad);
    let steer = false;
    const tgt = m.target;
    const live = !!tgt && !tgt.dead;
    const x0 = m.x;
    const y0 = m.y;

    // Faza wyrzutu: zawis, zapłon, przechył w kurs wachlarza salwy.
    if (m.phase === 'launch') {
      const sinceIgnition = m.state === 'POWERED' ? t - m.ignitedAt : -1;
      if (sinceIgnition >= L.dispersalTime && t >= p.homingDelay) {
        m.phase = 'intercept';
        m.interceptAt = t;
      } else {
        const look = Math.max(140, speedNow * 0.35);
        desAz = m.dispAz;
        desEl = Math.atan(clamp((L.cruiseAltitude - m.z) / look, -0.9, 1.2));
        // Przed zapłonem nos dopiero zaczyna się kłaść (stery gazowe), po zapłonie — pełny przechył.
        azRate = elRate = m.state === 'POWERED' ? L.launchTurnRateRad : L.launchTurnRateRad * 0.2;
        steer = true;
        if (live) m.lastDist = Math.hypot(tgt.x - m.x, tgt.y - m.y);
      }
    }

    if (!steer && live) {
      const point = !!tgt.point;
      const tx = tgt.x;
      const ty = tgt.y;
      const tr = point ? 0 : Math.max(0, tgt.radius || 0);
      const fuse = Math.max(p.proximityRadius, tr * 0.9);
      const terminalR = Math.max(p.terminalRadius || fuse * 2, fuse * 1.35);
      const reacqR = Math.max(p.reacquireRadius || terminalR * 1.4, terminalR);
      const dist = Math.hypot(tx - m.x, ty - m.y);
      if (point) {
        m.phase = 'intercept';
      } else {
        if (m.phase !== 'reacquire' && dist <= terminalR) {
          if (m.phase !== 'terminal') { m.phase = 'terminal'; m.missGrow = 0; }
        } else if (m.phase === 'reacquire' && (dist <= terminalR * 1.15 || t >= m.reacquireUntil)) {
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
              m.reacquireUntil = t + clamp(0.24 + m.missCount * 0.08, 0.24, 0.9);
              m.missGrow = 0;
            }
          } else {
            m.missGrow = Math.max(0, m.missGrow - dt * 2.5);
          }
        }
      }
      const planar = Math.max(300, Math.hypot(m.vx, m.vy), desired);
      const tuned = solveLeadAim2D(m.x, m.y, m.vx + m.fx, m.vy + m.fy, tgt, planar, m.fx, m.fy);
      let lx = tuned.x;
      let ly = tuned.y;
      const frameSpeed = Math.hypot(m.fx, m.fy);
      const drift = frameSpeed > 1e-6 ? frameSpeed / (frameSpeed + Math.hypot(tgt.vx || 0, tgt.vy || 0)) : 0;
      if (drift > 0) {
        const trueLead = solveLeadAim2D(m.x, m.y, m.fx, m.fy, tgt, planar, m.fx, m.fy);
        lx += (trueLead.x - lx) * drift;
        ly += (trueLead.y - ly) * drift;
      }
      let leadW = 0;
      let targetZ = L.cruiseAltitude;
      let dive = false;
      let turn = Math.max(0.001, m.turnRateRad);
      if (m.phase === 'intercept') {
        leadW = point ? 0 : p.leadHorizon;
        if (dist <= terminalR * 1.6) { targetZ = 0; dive = true; }
        // Po wachlarzu obrót narasta od 40 %: tory salwy zakręcają szerokimi łukami.
        turn *= Math.min(1, TURN_RAMP_START + (1 - TURN_RAMP_START) * (t - m.interceptAt) / TURN_RAMP);
      } else if (m.phase === 'terminal') {
        leadW = point ? 0 : p.terminalLeadHorizon;
        targetZ = 0; dive = true;
        desired *= p.terminalSpeedFactor;
        turn *= 1.25;
      } else if (m.phase === 'reacquire') {
        leadW = point ? 0 : Math.min(0.18, p.terminalLeadHorizon);
        targetZ = 0; dive = true;
        desired *= p.reacquireSpeedFactor;
        turn *= p.reacquireTurnMultiplier;
      }
      // Człon sprintu („Niszczyciel”): pełne wyprzedzenie celu i zejście na płaszczyznę; cel minięty
      // w sprincie — wybuch w miejscu (nawrót przy tej prędkości trwałby dłużej niż reszta zasięgu).
      const SP = p.sprint;
      if (SP && m.stage === 2) {
        if (m.phase === 'reacquire') {
          this._detonate(m, m.x, m.y, null, -Math.cos(m.heading), -Math.sin(m.heading));
          return;
        }
        leadW = point ? 0 : 1;
        targetZ = 0; dive = true;
      }
      const aimW = leadW + (1 - leadW) * drift;
      const aimAz = Math.atan2(lerp(ty, ly, aimW) - m.y, lerp(tx, lx, aimW) - m.x);
      desAz = aimAz;
      // Start sprintu: cel w zasięgu członu, nos patrzy w punkt wyprzedzenia.
      if (SP && m.stage === 1 && m.state === 'POWERED' && dist <= SP.range
        && Math.abs(wrapAngle(aimAz - m.heading)) <= SP.alignRad) {
        m.stage = 2;
        m.sprintAt = t;
        targetZ = 0; dive = true;
        this.h.onSprint?.(m);
      }
      // Kluczenie: dwie harmoniczne, gaśnie przed fazą końcową.
      if (L.weaveRad > 0 && m.phase === 'intercept') {
        const fade = clamp((dist - terminalR * 1.25) / (terminalR * 1.5), 0, 1);
        if (fade > 0) {
          const ph = TAU * L.weaveHz * t;
          desAz += L.weaveRad * fade * (Math.sin(m.weavePhase + ph) + 0.5 * Math.sin(m.weavePhase2 + ph * 1.73)) * 0.667;
        }
      }
      // Pułap: nachylenie z błędu wysokości; nurkowanie — zejście na płaszczyznę na granicy zapalnika.
      const look = dive ? Math.max(40, dist - fuse * 0.5) : Math.max(160, planar * 0.4);
      desEl = Math.atan(clamp((targetZ - m.z) / look, -1.2, 0.9));
      if (SP && m.stage === 2) {
        // Sprint nie zwalnia przed celem: pełna prędkość członu aż do trafienia.
        desired = SP.speed;
        turn = SP.turnRateRad;
      } else if (m.phase === 'reacquire' || m.phase === 'terminal') {
        desired *= lerp(1.0, 0.45, clamp(Math.abs(wrapAngle(aimAz - m.heading)) / Math.PI, 0, 1));
      }
      azRate = turn;
      elRate = Math.max(turn, L.launchTurnRateRad);
      steer = true;
      m.lastDist = dist;
      if (m.phase === 'terminal') m.terminalT += dt;
    } else if (!steer) {
      desAz = m.heading;
      desEl = Math.atan(clamp((L.cruiseAltitude - m.z) / Math.max(160, speedNow * 0.4), -0.9, 0.9));
      elRate = L.launchTurnRateRad;
      steer = true;
    }

    if (steer) {
      // Kurs: przy nosie w pionie zmiana kursu prawie nie rusza nosem — limit rośnie jak 1/cos(el).
      const azStep = azRate * dt / Math.max(0.2, Math.cos(m.nosePitch));
      m.heading = wrapAngle(m.heading + clamp(wrapAngle(desAz - m.heading), -azStep, azStep));
      const elStep = elRate * dt;
      m.nosePitch += clamp(desEl - m.nosePitch, -elStep, elStep);
    }

    const ce = Math.cos(m.nosePitch);
    const fx3 = ce * Math.cos(m.heading);
    const fy3 = ce * Math.sin(m.heading);
    const fz3 = Math.sin(m.nosePitch);
    let dx;
    let dy;
    let dz;
    if (m.state === 'POWERED') {
      // Lot kinematyczny: prędkość idzie za nosem, szybkość goni desired (hamowanie 0,8 ×).
      const want = Math.max(220, desired);
      const acc = m.stage === 2 && p.sprint ? p.sprint.accel : L.accel;
      const ns = speedNow < want ? Math.min(want, speedNow + acc * dt) : Math.max(want, speedNow - acc * 0.8 * dt);
      m.vx = fx3 * ns; m.vy = fy3 * ns; m.vz = fz3 * ns;
      m.throttle = clamp(((want - speedNow) / want) * 1.4 + 0.25, 0.12, 1.0);
      dx = m.vx * dt; dy = m.vy * dt; dz = m.vz * dt;
    } else {
      // Zimny wyrzut bez silnika: prędkość gaśnie wykładniczo (zawis nad komorą), droga analitycznie.
      const k = m.popDrag;
      const e = Math.exp(-k * dt);
      const f = (1 - e) / k;
      dx = m.vx * f; dy = m.vy * f; dz = m.vz * f;
      m.vx *= e; m.vy *= e; m.vz *= e;
      m.throttle = 0;
    }
    m.x += dx + m.fx * dt;
    m.y += dy + m.fy * dt;
    m.z = clamp(m.z + dz, 0, GAME_MAX_ALTITUDE);
    m.speed = Math.hypot(m.vx, m.vy);
    m.travel += Math.hypot(dx, dy);

    this.h.onFly?.(m, dt, x0, y0);

    const c = Math.cos(m.heading);
    const s = Math.sin(m.heading);
    if (live && this._fuse(m, tgt, x0, y0, c, s)) return;
    if (m.travel >= p.maxRange) this._detonate(m, m.x, m.y, null, -c, -s);
  }

  _detonate(m, x, y, hull, nx, ny) {
    m.alive = false;
    m.x = x;
    m.y = y;
    m.hitHull = hull || null;
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
