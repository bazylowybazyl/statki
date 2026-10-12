// src/game/neaFlyby.js
//
// PRZELOT PLANETOIDY BLISKIEJ ZIEMI w stylu Apophisa (strumień E2, 2026-10-12 — docs/PLAN-pas-realizm.md
// § „E: projekt”). Prawdziwy przelot 99942 Apophis: 13.04.2029, ~32 tys. km od Ziemi, ~340 m — w skali gry
// 1:1 wypadłby w ringu i halach K-7, więc: jedna skała ~1500 j. na PROSTEJ przez okolicę Ziemi, największe
// zbliżenie 90–110 tys. j. od środka (za studnią ~56 tys., hale K-7 ~50 tys.), ~2000 j./s, BEZ KOLIZJI —
// sam obraz (skała z banku pasa: src/3d/neaFlyby3D.js), wpis na radarze i komunikaty.
//
// Bramki (decyzja użytkownika 2026-10-12): tylko gra swobodna — nigdy w kampanii ani przy fabule blokującej
// wejście; raz na sesję, po ≥ 20 min CZASU GRY (pauza stoi), gdy gracz jest przy Ziemi (inaczej nikt by
// przelotu nie zobaczył); `?apophis` — start po kilku sekundach (testy, pokaz).
//
// Księżyc Ziemi rysowany w grze (planet3d.assets.js — DirectMoon przy ringu) krąży na ~113 tys. j.
// (promień ~9 tys., okres 220 s), więc każda prosta z zbliżeniem 90–110 tys. przecina pierścień jego orbity
// dwa razy. Planista dobiera kąt i kierunek przelotu tak, żeby w chwilach przecięcia księżyc był daleko
// (przewidywanie z położenia i prędkości kątowej księżyca w chwili startu; księżyc krąży też w pauzie, więc
// po długiej pauzie przewidywanie się rozjeżdża — przy przelocie trwającym kilka minut to rzadkie).
//
// Moduł czysty: bez three, DOM i globali gry — klej w index.html (blok „PRZELOT NEA”), testy
// tests/neaFlyby.test.mjs. Losowanie — z podanej funkcji `rand` (gra: fxRandom — to wizualia).

import { ROCK_TYPE_INDEX, FAMILY, SHAPE_VARIANTS } from './asteroidRockKinds.js';

export const NEA_FLYBY_TUNE = Object.freeze({
  // Bramki
  minGameSec: 1200,        // raz na sesję po ≥ 20 min czasu gry (SimClock.sim)
  devDelaySec: 4,          // ?apophis: start po tylu s czasu gry
  nearEarth: 300000,       // gracz dalej od Ziemi [j.] — przelot czeka
  // Tor
  dMin: 90000,             // największe zbliżenie od środka Ziemi [j.]
  dMax: 110000,
  speed: 2000,             // [j./s]
  approachSec: 150,        // od pojawienia się do największego zbliżenia [s]
  departSec: 150,          // od zbliżenia do zniknięcia [s]
  stepDeg: 5,              // krok szukania kąta zbliżenia (od kierunku gracza) [°]
  sampleSec: 1,            // krok sprawdzania trasy [s]
  moonClear: 25000,        // odstęp powierzchni skały od powierzchni księżyca Ziemi na całej trasie [j.]
  moonPeriodSec: 220,      // okres księżyca Ziemi w renderze (planet3d.assets.js: MOON_TUNE.orbitPeriodSec)
  planetClear: 60000,      // zapas ponad zasięg innych planet (studnia, ring × 3) [j.]
  // Skała
  radius: 750,             // ~1500 j. średnicy (prawdziwy: ~340 m)
  stretch: Object.freeze([1.32, 0.92, 0.86]),   // wydłużony, dwupłatowy jak Apophis (obrazy radarowe 2012 / 2021)
  shapeVariant: 1,         // wariant rodziny `binary` banku kształtów
  tumbleSec: 96,           // obrót (prawdziwy: chaotyczny, ~30 h — w grze widoczny)
  wakePad: 4000,           // zapas budzenia pasa wokół skały [j.] (pas rysuje skałę — asteroidBeltField.wakeSpots)
  // Radar
  radarName: 'APOPHIS',
  radarCls: 'NEA'
});

const TAU = Math.PI * 2;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function wrapAngle(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

/**
 * Bramka startu. Zwraca '' (można startować) albo powód: 'done' (był w tej sesji), 'campaign' (kampania /
 * fabuła w toku), 'blocked' (fabuła blokuje wejście), 'time' (za mało czasu gry), 'far' (gracz daleko od Ziemi),
 * 'noEarth'.
 * ctx: { done, campaign, blocksInput, simTime, dev, devSince, playerX, playerY, earthX, earthY }.
 */
export function neaFlybyBlockReason(ctx, tune = NEA_FLYBY_TUNE) {
  if (ctx.done) return 'done';
  if (ctx.campaign) return 'campaign';
  if (ctx.blocksInput) return 'blocked';
  if (!Number.isFinite(ctx.earthX) || !Number.isFinite(ctx.earthY)) return 'noEarth';
  const t = Number(ctx.simTime) || 0;
  if (ctx.dev) {
    if (t - (Number(ctx.devSince) || 0) < tune.devDelaySec) return 'time';
    return '';
  }
  if (t < tune.minGameSec) return 'time';
  const dx = (Number(ctx.playerX) || 0) - ctx.earthX;
  const dy = (Number(ctx.playerY) || 0) - ctx.earthY;
  if (!(dx * dx + dy * dy <= tune.nearEarth * tune.nearEarth)) return 'far';
  return '';
}

/** Punkt toru w chwili t [s od pojawienia się] → out { x, y }. */
export function neaFlybyPoint(plan, t, out = { x: 0, y: 0 }) {
  const s = plan.speed * t;
  out.x = plan.x0 + plan.dx * s;
  out.y = plan.y0 + plan.dy * s;
  return out;
}

/**
 * Sprawdza tor (kąt zbliżenia phi wokół Ziemi, odległość d, zwrot sign): najmniejszy odstęp od księżyca
 * (przewidywanie ruchu) i od innych planet. Bez alokacji poza wynikiem.
 */
function evaluatePath(phi, d, sign, earth, moon, planets, tune) {
  const ex = earth.x, ey = earth.y;
  const cx = ex + Math.cos(phi) * d;
  const cy = ey + Math.sin(phi) * d;
  const dx = -Math.sin(phi) * sign;
  const dy = Math.cos(phi) * sign;
  const v = tune.speed;
  const x0 = cx - dx * v * tune.approachSec;
  const y0 = cy - dy * v * tune.approachSec;
  const duration = tune.approachSec + tune.departSec;
  const rockR = tune.radius * Math.max(tune.stretch[0], tune.stretch[1], tune.stretch[2]);
  let minMoon = Infinity;
  let minPlanet = Infinity;
  const step = Math.max(0.05, tune.sampleSec);
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const px = x0 + dx * v * t;
    const py = y0 + dy * v * t;
    if (moon) {
      const a = moon.angle + moon.w * t;
      const mx = ex + Math.cos(a) * moon.orbitR;
      const my = ey + Math.sin(a) * moon.orbitR;
      const sep = Math.hypot(px - mx, py - my) - moon.r - rockR;
      if (sep < minMoon) minMoon = sep;
    }
    for (let i = 0; i < planets.length; i++) {
      const p = planets[i];
      const sep = Math.hypot(px - p.x, py - p.y) - p.r;
      if (sep < minPlanet) minPlanet = sep;
    }
  }
  return { phi, d, sign, cx, cy, dx, dy, x0, y0, duration, minMoon, minPlanet };
}

/**
 * Tor przelotu. Kąt największego zbliżenia — od strony gracza (gracz przy Ziemi), potem coraz dalej co
 * `stepDeg`; odległość — najbliższa odległości gracza w [dMin, dMax]; zwrot — losowy, drugi jako zapas.
 * Pierwszy kąt, przy którym tor omija księżyc (moonClear) i inne planety (r = zasięg planety + planetClear
 * podaje wołający), wygrywa; bez takiego — tor z największym odstępem od księżyca (ok = false).
 * @param {{x:number,y:number}} o.earth środek Ziemi
 * @param {{x:number,y:number}|null} [o.player] gracz (świat gry)
 * @param {{x:number,y:number,r:number,w?:number}|null} [o.moon] księżyc Ziemi w chwili startu (świat gry),
 *        r — promień bryły, w — prędkość kątowa [rad/s] (domyślnie 2π / moonPeriodSec)
 * @param {Array<{x:number,y:number,r:number}>} [o.planets] inne planety (r = odstęp od środka)
 * @param {() => number} [o.rand] [0, 1)
 */
export function planNeaFlyby({ earth, player = null, moon = null, planets = [], tune = NEA_FLYBY_TUNE, rand = Math.random } = {}) {
  const T = tune;
  let phi0 = NaN;
  let dPref = NaN;
  if (player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
    const px = player.x - earth.x;
    const py = player.y - earth.y;
    const pd = Math.hypot(px, py);
    if (pd > 1 && pd <= T.nearEarth) {
      phi0 = Math.atan2(py, px);
      dPref = clamp(pd, T.dMin, T.dMax);
    }
  }
  if (!Number.isFinite(phi0)) {
    phi0 = rand() * TAU;
    dPref = T.dMin + rand() * (T.dMax - T.dMin);
  }
  const sign0 = rand() < 0.5 ? 1 : -1;
  let m = null;
  if (moon && Number.isFinite(moon.x) && Number.isFinite(moon.y)) {
    const mx = moon.x - earth.x;
    const my = moon.y - earth.y;
    m = {
      angle: Math.atan2(my, mx),
      orbitR: Math.hypot(mx, my),
      r: Math.max(0, Number(moon.r) || 0),
      w: Number.isFinite(moon.w) ? moon.w : TAU / T.moonPeriodSec
    };
  }
  const dList = [dPref];
  for (const d of [T.dMin, (T.dMin + T.dMax) * 0.5, T.dMax]) if (Math.abs(d - dPref) > 1) dList.push(d);
  const rings = Math.round(180 / T.stepDeg);
  let best = null;
  let bestScore = Infinity;
  let fallback = null;
  for (let k = 0; k <= rings && !best; k++) {
    for (let side = 1; side >= -1; side -= 2) {
      if (k === 0 && side < 0) continue;
      const phi = wrapAngle(phi0 + side * k * T.stepDeg * Math.PI / 180);
      for (let i = 0; i < dList.length; i++) {
        for (let j = 0; j < 2; j++) {
          const sign = j === 0 ? sign0 : -sign0;
          const c = evaluatePath(phi, dList[i], sign, earth, m, planets, T);
          const ok = (!m || c.minMoon >= T.moonClear) && c.minPlanet >= 0;
          if (ok) {
            const score = Math.abs(dList[i] - dPref) / 1000 + (j ? 0.5 : 0);
            if (score < bestScore) { best = c; bestScore = score; }
          } else if (!fallback || Math.min(c.minMoon, c.minPlanet) > Math.min(fallback.minMoon, fallback.minPlanet)) {
            fallback = c;
          }
        }
      }
    }
  }
  const c = best || fallback;
  return {
    ok: !!best,
    x0: c.x0, y0: c.y0, dx: c.dx, dy: c.dy,
    speed: T.speed,
    tCA: T.approachSec,
    duration: c.duration,
    cx: c.cx, cy: c.cy,
    dCA: c.d,
    phi: c.phi,
    sign: c.sign,
    minMoon: c.minMoon,
    minPlanet: c.minPlanet,
    moon: m
  };
}

/** Najmniejsza odległość punktu (px, py) od toru (odcinka) — do komunikatu „najbliżej ciebie”. */
export function neaFlybyDistanceTo(plan, px, py) {
  const len = plan.speed * plan.duration;
  const s = clamp((px - plan.x0) * plan.dx + (py - plan.y0) * plan.dy, 0, len);
  return Math.hypot(plan.x0 + plan.dx * s - px, plan.y0 + plan.dy * s - py);
}

/** „2:05” z sekund (≥ 0). */
export function formatNeaEta(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function kilo(v) {
  return `${Math.round(v / 1000)} tys. j.`;
}

/** Tekst komunikatu (rodzaj: 'start' | 'closest'). */
export function neaFlybyMessage(kind, flyby) {
  const p = flyby.plan;
  if (!p) return '';
  // Linia komunikatów kokpitu mieści ~70 znaków — odległość od gracza pokazuje radar.
  if (kind === 'start') return `PLANETOIDA APOPHIS — ZBLIŻENIE ZA ${formatNeaEta(p.tCA - flyby.t)}, ${kilo(p.dCA)} OD ZIEMI`;
  if (kind === 'closest') return `APOPHIS MIJA ZIEMIĘ — ${kilo(p.dCA)} OD ŚRODKA, ${Math.round(p.speed)} J./S, BEZ ZAGROŻENIA`;
  return '';
}

// Kwaternion (x, y, z, w) · obrót wokół osi a o kąt t → out.
function quatMulAxisAngle(q, ax, ay, az, t, out) {
  const h = t * 0.5;
  const s = Math.sin(h);
  const bx = ax * s, by = ay * s, bz = az * s, bw = Math.cos(h);
  out.qx = q.w * bx + q.x * bw + q.y * bz - q.z * by;
  out.qy = q.w * by - q.x * bz + q.y * bw + q.z * bx;
  out.qz = q.w * bz + q.x * by - q.y * bx + q.z * bw;
  out.qw = q.w * bw - q.x * bx - q.y * by - q.z * bz;
}

/**
 * Stan przelotu na sesję. `update(ctx)` raz na klatkę (render) — zwraca zdarzenie: null | 'start' |
 * 'closest' | 'end'. ctx: { simTime, renderTime, campaign, blocksInput, playerX, playerY, earth: {x, y},
 * moon: {x, y, r} | null, planets: [{x, y, r}] }. Skała (`rock`) ma pola rekordu skały pola (rysuje ją
 * RockSet pasa) i radaru (x, y, vx, vy, radius, radarName, radarCls, dead); `wake` — koło budzenia pasa.
 */
export class NeaFlyby {
  constructor({ tune = NEA_FLYBY_TUNE, dev = false, rand = Math.random } = {}) {
    this.tune = { ...NEA_FLYBY_TUNE, ...(tune || {}) };
    this.dev = !!dev;
    this.rand = rand;
    this.state = 'waiting';   // 'waiting' | 'active' | 'done'
    this.plan = null;
    this.tStart = 0;          // czas gry (SimClock.sim) pojawienia się
    this.t = 0;               // s od pojawienia się (czas renderu)
    this.devSince = null;
    this.playerDist = NaN;
    this.closestDone = false;
    this.reason = '';
    const T = this.tune;
    const r = T.radius;
    // Kształt: rodzina „podwójna” banku (bryła dwupłatowa), skała kamienna S — typ `silicon`.
    const q0 = { x: 0.21, y: -0.34, z: 0.12, w: 0.91 };
    const ql = Math.hypot(q0.x, q0.y, q0.z, q0.w);
    this._q0 = { x: q0.x / ql, y: q0.y / ql, z: q0.z / ql, w: q0.w / ql };
    const axl = Math.hypot(0.32, 0.58, 0.75);
    this._axis = [0.32 / axl, 0.58 / axl, 0.75 / axl];
    this.rock = {
      id: 99942, x: 0, y: 0, vx: 0, vy: 0, r, d: 2 * r,
      shape: FAMILY.binary * SHAPE_VARIANTS + T.shapeVariant,
      type: ROCK_TYPE_INDEX.silicon,
      qx: this._q0.x, qy: this._q0.y, qz: this._q0.z, qw: this._q0.w,
      ax: 0, ay: 0, az: 1, spin: 0, phase: 0,
      sx: T.stretch[0], sy: T.stretch[1], sz: T.stretch[2], seed: 0.4029,
      alive: false, dead: true,
      radius: r * T.stretch[0], radarName: T.radarName, radarCls: T.radarCls
    };
    this.wake = { x: 0, y: 0, r: r * T.stretch[0] + T.wakePad, active: false };
  }

  get active() { return this.state === 'active'; }

  /** Bramka dla ctx (powód albo ''). */
  blockReason(ctx) {
    if (this.dev && this.devSince === null) this.devSince = Number(ctx.simTime) || 0;
    return neaFlybyBlockReason({
      done: this.state !== 'waiting', campaign: !!ctx.campaign, blocksInput: !!ctx.blocksInput,
      simTime: ctx.simTime, dev: this.dev, devSince: this.devSince,
      playerX: ctx.playerX, playerY: ctx.playerY, earthX: ctx.earth?.x, earthY: ctx.earth?.y
    }, this.tune);
  }

  /** Start teraz (bramki kampanii i fabuły zostają; czas i odległość pomija — dev, harness). */
  start(ctx, opts = null) {
    if (this.state === 'active') return false;
    if (ctx.campaign || ctx.blocksInput || !ctx.earth) return false;
    const tune = opts ? { ...this.tune, ...opts } : this.tune;
    this.tune = tune;
    this.plan = planNeaFlyby({
      earth: ctx.earth,
      player: Number.isFinite(ctx.playerX) ? { x: ctx.playerX, y: ctx.playerY } : null,
      moon: ctx.moon || null, planets: ctx.planets || [], tune, rand: this.rand
    });
    this.tStart = Number(ctx.simTime) || 0;
    this.t = 0;
    this.closestDone = false;
    this.playerDist = Number.isFinite(ctx.playerX) ? neaFlybyDistanceTo(this.plan, ctx.playerX, ctx.playerY) : NaN;
    this.state = 'active';
    this.rock.alive = true;
    this.rock.dead = false;
    this.wake.active = true;
    this._place(0);
    return true;
  }

  /** Dev: przesuń przelot na chwilę t [s od pojawienia się] (zbliżenie — plan.tCA). */
  seek(t, simTime) {
    if (this.state !== 'active') return;
    this.tStart = (Number(simTime) || 0) - t;
    this.closestDone = t >= this.plan.tCA;
  }

  update(ctx) {
    if (this.state === 'waiting') {
      this.reason = this.blockReason(ctx);
      if (this.reason) return null;
      return this.start(ctx) ? 'start' : null;
    }
    if (this.state !== 'active') return null;
    const t = (Number.isFinite(ctx.renderTime) ? ctx.renderTime : ctx.simTime) - this.tStart;
    this.t = t;
    if (t >= this.plan.duration) {
      this.state = 'done';
      this.rock.alive = false;
      this.rock.dead = true;
      this.wake.active = false;
      return 'end';
    }
    this._place(Math.max(0, t));
    if (!this.closestDone && t >= this.plan.tCA) {
      this.closestDone = true;
      return 'closest';
    }
    return null;
  }

  _place(t) {
    const p = this.plan;
    const rock = this.rock;
    const s = p.speed * t;
    rock.x = p.x0 + p.dx * s;
    rock.y = p.y0 + p.dy * s;
    rock.vx = p.dx * p.speed;
    rock.vy = p.dy * p.speed;
    quatMulAxisAngle(this._q0, this._axis[0], this._axis[1], this._axis[2], t * TAU / this.tune.tumbleSec, rock);
    this.wake.x = rock.x;
    this.wake.y = rock.y;
  }
}
