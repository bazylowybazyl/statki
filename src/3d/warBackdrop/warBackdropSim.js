// src/3d/warBackdrop/warBackdropSim.js — BITWA W GŁĘBI (scena „Wojna”, 2026-10-19): czysta symulacja WIDOKU tłumu
// okrętów nad i pod płaszczyzną gry.
//
// To NIE jest rozgrywka (zasada żelazna 1): okręty w pasmach głębokości (`WB_BANDS` — z < 0 pod płaszczyzną, z > 0
// między płaszczyzną a kamerą) nie mają fizyki, kolizji ani trafień gry. Każde pasmo to osobna bitwa dwóch stron po
// obu stronach kołyszącej się linii frontu: eskorta robi przeloty przez linię wroga, capitale stoją w linii i walą
// salwami, supercapitale co kilkanaście s tną capitala wroga wielkim laserem (jak u Venatora), myśliwce kotłują się
// przy froncie. Trafione okręty płoną, giną w łańcuchu wybuchów i rozpadają się na kawałki, a na ich miejsce wpadają
// z warpa nowe. Obraz (warBackdrop3D.js) rysuje stan tej symulacji, a efekty dostaje przez ZLEW (`sink`).
//
// BOHATEROWIE (`addHero(planWarHero(…))`, src/render/warBackdropPlan.js): dwa okręty ze skryptem (drogi, salwy,
// ładowanie, wiązki, śmierć) — ten sam plan liczy gra, żeby kamera wiedziała, gdzie patrzeć.
//
// Układ: GRA (x w prawo, y w dół), z — wysokość nad płaszczyzną gry, pozycje WZGLĘDEM środka sceny [j.], czas sceny
// [s] (czas gry — pauza stoi). Krok stały 1/30 s z akumulatorem; obraz ekstrapoluje pozycje o resztę (`acc`).
// Losowanie: własny mulberry32 z ziarna sceny (bez Math.random — zasada żelazna 9): ta sama scena wygląda tak samo
// w workerze i na wątku gry. Bez alokacji w kroku: tablice typowane, wolne listy, płaska kolejka zastępstw.
import { WB_CLASSES, WB_BANDS, WB_EV, WB_BEAM, WB_WARP, heroShipPose, warpSlideSpeed } from '../../render/warBackdropPlan.js';

export const WB_SHIP_CAP = 1024;
export const WB_CHUNK_CAP = 1024;
export const WB_FIGHTER_CAP = 768;
export const WB_STEP = 1 / 30;

const TAU = Math.PI * 2;

/** Tryby okrętu. */
export const WB_MODE = Object.freeze({ FREE: 0, WARPIN: 1, RUN: 2, LINE: 3, DYING: 4, HERO: 5 });

/** Rodzaje efektów zlewu (warBackdrop3D.js: barwy i kształty). */
export const WB_FX = Object.freeze({
  // smugi strzałów (shot.kind)
  SHOT_TN: 0, SHOT_PIR: 1, SHOT_FTR_TN: 2, SHOT_FTR_PIR: 3, SHOT_HEAVY_TN: 4, SHOT_HEAVY_PIR: 5,
  // błyski (flash.kind)
  FLASH_HIT: 0, FLASH_FIRE: 1, FLASH_WARP_TN: 2, FLASH_WARP_PIR: 3, FLASH_DEATH: 4, FLASH_CHARGE_TN: 5,
  FLASH_CHARGE_PIR: 6, FLASH_SHIELD: 7, FLASH_SMALL: 8,
  // odłamki (debris.kind)
  DEBRIS_SPARK: 0, DEBRIS_METAL: 1
});

export const WB_TUNE = {
  ships: 760,               // okręty przy gęstości 1 (WB_SHIP_CAP to sufit)
  fighters: 560,            // myśliwce przy gęstości 1
  frontSway: 9000,          // [j.] kołysanie linii frontu (× skala pasma)
  frontPeriod: 80,          // [s]
  tracerSpeed: 14000,       // [j/s] smuga (obraz)
  hitChance: 0.7,
  volley: [0.35, 0.65],     // ułamek wież w salwie
  respawn: [2.5, 8],        // [s] po śmierci — przylot zastępcy z warpa
  dying: 1.2,               // [s] łańcuch wybuchów przed rozpadem (duże kadłuby × 1,6)
  chunkLife: [14, 22],      // [s]
  fighterSpeed: 2400,
  fighterLife: [10, 40]
};

/** mulberry32 — losowanie widoku z ziarna sceny. */
function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Zlew bez obrazu (rozbieg, testy). */
export const WB_NOOP_SINK = Object.freeze({
  shot() {}, flash() {}, ring() {}, debris() {}, beam() {}, streak() {}
});

/**
 * Symulacja. o: { seed, density (mnożnik liczby okrętów), frontAxis (kąt osi stron w układzie gry; Terra Nova po
 * stronie −oś, piraci +oś), sink }.
 */
export function createWarBackdropSim(o = {}) {
  const S = WB_SHIP_CAP;
  const C = WB_CHUNK_CAP;
  const F = WB_FIGHTER_CAP;
  const classes = WB_CLASSES;
  const bands = WB_BANDS;
  const T = WB_TUNE;
  const rnd = makeRng(o.seed);
  const range = (a, b) => a + (b - a) * rnd();
  let gaussSpare = NaN;
  const gauss = () => {
    if (Number.isFinite(gaussSpare)) { const g = gaussSpare; gaussSpare = NaN; return g; }
    const u = Math.max(1e-9, rnd());
    const v = rnd();
    const r = Math.sqrt(-2 * Math.log(u));
    gaussSpare = r * Math.sin(TAU * v);
    return r * Math.cos(TAU * v);
  };

  const sim = {
    time: 0,
    acc: 0,
    sink: o.sink || WB_NOOP_SINK,
    density: Number.isFinite(o.density) ? Math.max(0.05, o.density) : 1,
    axis: Number(o.frontAxis) || 0,
    // okręty
    n: 0,
    active: new Uint8Array(S), cls: new Int16Array(S), fac: new Uint8Array(S), band: new Uint8Array(S),
    mode: new Uint8Array(S), hero: new Int16Array(S).fill(-1), target: new Int16Array(S).fill(-1),
    x: new Float32Array(S), y: new Float32Array(S), z: new Float32Array(S),
    vx: new Float32Array(S), vy: new Float32Array(S), ang: new Float32Array(S), scale: new Float32Array(S),
    hp: new Float32Array(S), maxHp: new Float32Array(S), t: new Float32Array(S), gunT: new Float32Array(S),
    rayT: new Float32Array(S), retT: new Float32Array(S), laneV: new Float32Array(S), weave: new Float32Array(S),
    glow: new Float32Array(S), burn: new Float32Array(S), seed: new Uint32Array(S), slide: new Float32Array(S),
    runDir: new Int8Array(S), latDir: new Int8Array(S), cutAng: new Float32Array(S).fill(NaN), noRespawn: new Uint8Array(S),
    thrust: new Float32Array(S),
    // odłamy rozpadu: kawałek kadłuba (pas poprzeczny [b0, b1] z poszarpanym brzegiem, opcjonalnie strona cięcia)
    cActive: new Uint8Array(C), cCls: new Int16Array(C), cFac: new Uint8Array(C), cBand: new Uint8Array(C),
    cx: new Float32Array(C), cy: new Float32Array(C), cz: new Float32Array(C), cScale: new Float32Array(C),
    cvx: new Float32Array(C), cvy: new Float32Array(C), cAng: new Float32Array(C), cSpin: new Float32Array(C),
    cAge: new Float32Array(C), cLife: new Float32Array(C), cSeed: new Uint32Array(C),
    cB0: new Float32Array(C), cB1: new Float32Array(C), cS0: new Float32Array(C), cS1: new Float32Array(C),
    cSide: new Int8Array(C), cCut: new Float32Array(C), cPu: new Float32Array(C), cPv: new Float32Array(C),
    cHero: new Uint8Array(C),
    // myśliwce
    fActive: new Uint8Array(F), fFac: new Uint8Array(F), fBand: new Uint8Array(F),
    fx: new Float32Array(F), fy: new Float32Array(F), fz: new Float32Array(F),
    fvx: new Float32Array(F), fvy: new Float32Array(F), fT: new Float32Array(F), fGun: new Float32Array(F),
    fJink: new Float32Array(F),
    heroes: [],
    pending: [],
    stats: { alive: 0, dying: 0, chunks: 0, chunkAlive: 0, fighters: 0, kills: 0, shots: 0, rays: 0, warps: 0 }
  };

  const freeShips = [];
  for (let i = S - 1; i >= 0; i--) freeShips.push(i);
  const freeChunks = [];
  for (let i = C - 1; i >= 0; i--) freeChunks.push(i);
  const freeFighters = [];
  for (let i = F - 1; i >= 0; i--) freeFighters.push(i);

  // Oś stron (u — wzdłuż, TN po stronie ujemnej; v — w poprzek).
  const ax = Math.cos(sim.axis);
  const ay = Math.sin(sim.axis);
  const px = -ay;
  const py = ax;
  const toX = (u, v) => ax * u + px * v;
  const toY = (u, v) => ay * u + py * v;
  const uOf = (i) => sim.x[i] * ax + sim.y[i] * ay;
  const vOf = (i) => sim.x[i] * px + sim.y[i] * py;
  const frontAt = (t, bi) => T.frontSway * bands[bi].scale * Math.sin((TAU * t) / T.frontPeriod + bi * 1.7);

  const byFac = [[], []];
  for (let i = 0; i < classes.length; i++) if (classes[i].id !== 'atlas') byFac[classes[i].fac].push(i);
  // Klasa strony w paśmie: płyciej eskorta, głębiej linie ciężkich okrętów (band.big × waga capitali).
  function pickClass(fac, bi) {
    const list = byFac[fac];
    const b = bands[bi];
    let sum = 0;
    for (let k = 0; k < list.length; k++) {
      const c = classes[list[k]];
      if (b.z0 > 0 && c.len > 1300) continue;
      sum += c.weight * (c.role === 'escort' ? 1 : b.big);
    }
    let r = rnd() * sum;
    for (let k = 0; k < list.length; k++) {
      const c = classes[list[k]];
      if (b.z0 > 0 && c.len > 1300) continue;
      r -= c.weight * (c.role === 'escort' ? 1 : b.big);
      if (r <= 0) return list[k];
    }
    return list[list.length - 1];
  }

  function resetShip(i, cls, fac, bi, scale) {
    const c = classes[cls];
    sim.active[i] = 1;
    sim.cls[i] = cls;
    sim.fac[i] = fac;
    sim.band[i] = bi;
    sim.hero[i] = -1;
    sim.target[i] = -1;
    sim.scale[i] = scale;
    sim.maxHp[i] = c.hp * range(0.85, 1.2);
    sim.hp[i] = sim.maxHp[i];
    sim.t[i] = 0;
    sim.gunT[i] = range(0, 1.6);
    sim.rayT[i] = c.ray ? range(c.ray * 0.25, c.ray) : 0;
    sim.retT[i] = range(0, 1.2);
    sim.weave[i] = rnd() * TAU;
    sim.glow[i] = 0;
    sim.burn[i] = 0;
    sim.seed[i] = (rnd() * 4294967296) >>> 0;
    sim.slide[i] = 0;
    sim.cutAng[i] = NaN;
    sim.noRespawn[i] = 0;
    sim.thrust[i] = 0.6;
    sim.runDir[i] = fac === 0 ? 1 : -1;
    sim.latDir[i] = rnd() < 0.5 ? 1 : -1;
    if (i >= sim.n) sim.n = i + 1;
  }

  function spawnShip(fac, bi, cls, u, v, warp) {
    if (!freeShips.length) return -1;
    const i = freeShips.pop();
    const b = bands[bi];
    const c = classes[cls];
    resetShip(i, cls, fac, bi, b.scale);
    sim.x[i] = toX(u, v);
    sim.y[i] = toY(u, v);
    sim.z[i] = range(b.z0, b.z1);
    const dir = fac === 0 ? 1 : -1;
    const head = Math.atan2(ay * dir, ax * dir) + range(-0.15, 0.15);
    sim.ang[i] = head;
    sim.laneV[i] = v;
    const sp = warp ? warpSlideSpeed(c.speed, 0) : c.speed;
    sim.vx[i] = Math.cos(head) * sp;
    sim.vy[i] = Math.sin(head) * sp;
    sim.mode[i] = warp ? WB_MODE.WARPIN : (c.role === 'escort' ? WB_MODE.RUN : WB_MODE.LINE);
    if (warp) {
      sim.slide[i] = 0.0001;
      const L = c.len * sim.scale[i];
      sim.sink.streak(sim.x[i], sim.y[i], sim.z[i], Math.cos(head), Math.sin(head), L * 7, sim.time - 0.16, 0.34, fac);
      sim.sink.flash(sim.x[i] + Math.cos(head) * L * 0.5, sim.y[i] + Math.sin(head) * L * 0.5, sim.z[i], L * 0.9, sim.time, 0.35,
        fac === 0 ? WB_FX.FLASH_WARP_TN : WB_FX.FLASH_WARP_PIR);
      sim.stats.warps++;
    }
    return i;
  }

  // Miejsce w paśmie: strona za frontem, odległość od frontu |N(0, σ)| (eskorta bliżej, lotniskowce dalej).
  function placeU(fac, bi, role) {
    const b = bands[bi];
    const own = fac === 0 ? -1 : 1;
    const k = role === 'escort' ? 0.55 : (role === 'carrier' ? 1.25 : 0.85);
    const d = Math.min(0.98, Math.abs(gauss()) * b.sigmaU * k + 0.03) * b.halfX;
    return frontAt(sim.time, bi) + own * d;
  }
  function placeV(bi) {
    const b = bands[bi];
    return Math.max(-0.98, Math.min(0.98, gauss() * b.sigmaV)) * b.halfY;
  }

  function populate() {
    const total = Math.min(S - 32, Math.round(T.ships * sim.density));
    for (let bi = 0; bi < bands.length; bi++) {
      const count = Math.round(total * bands[bi].share);
      for (let k = 0; k < count; k++) {
        const fac = k & 1;
        const cls = pickClass(fac, bi);
        spawnShip(fac, bi, cls, placeU(fac, bi, classes[cls].role), placeV(bi), false);
      }
      const nf = Math.round(T.fighters * sim.density * bands[bi].fighters);
      for (let k = 0; k < nf; k++) spawnFighter(k & 1, bi);
    }
  }

  function spawnFighter(fac, bi) {
    if (!freeFighters.length) return -1;
    const j = freeFighters.pop();
    const b = bands[bi];
    sim.fActive[j] = 1;
    sim.fFac[j] = fac;
    sim.fBand[j] = bi;
    const u = frontAt(sim.time, bi) + gauss() * 0.16 * b.halfX;
    const v = placeV(bi) * 0.8;
    sim.fx[j] = toX(u, v);
    sim.fy[j] = toY(u, v);
    sim.fz[j] = range(b.z0, b.z1);
    const a = rnd() * TAU;
    sim.fvx[j] = Math.cos(a) * T.fighterSpeed;
    sim.fvy[j] = Math.sin(a) * T.fighterSpeed;
    sim.fT[j] = range(T.fighterLife[0], T.fighterLife[1]);
    sim.fGun[j] = range(0, 2);
    sim.fJink[j] = rnd() * TAU;
    return j;
  }

  function alive(k) {
    if (!sim.active[k]) return false;
    const m = sim.mode[k];
    return m !== WB_MODE.DYING && m !== WB_MODE.FREE;
  }

  function retarget(i) {
    const fac = sim.fac[i];
    const bi = sim.band[i];
    const c = classes[sim.cls[i]];
    const xi = sim.x[i];
    const yi = sim.y[i];
    const reach = c.range * sim.scale[i] * 1.6;
    let best = -1;
    let bestD = reach * reach;
    for (let k = 0; k < sim.n; k++) {
      if (sim.band[k] !== bi || sim.fac[k] === fac || sim.hero[k] >= 0 || !alive(k)) continue;
      const dx = sim.x[k] - xi;
      const dy = sim.y[k] - yi;
      const big = c.role !== 'escort' && classes[sim.cls[k]].role !== 'escort' ? 0.6 : 1;
      const d = (dx * dx + dy * dy) * big;
      if (d < bestD) { bestD = d; best = k; }
    }
    sim.target[i] = best;
  }

  // Punkt na kadłubie: u, v w ułamkach pół długości / pół szerokości (v ku prawej burcie — układ gry).
  function hullPoint(i, u, v, out) {
    const c = classes[sim.cls[i]];
    const s = sim.scale[i];
    const ca = Math.cos(sim.ang[i]);
    const sa = Math.sin(sim.ang[i]);
    const lu = u * c.len * 0.5 * s;
    const lv = v * c.wid * 0.5 * s;
    out[0] = sim.x[i] + ca * lu - sa * lv;
    out[1] = sim.y[i] + sa * lu + ca * lv;
    out[2] = sim.z[i];
    return out;
  }
  const _p0 = [0, 0, 0];
  const _p1 = [0, 0, 0];
  const _pose = { x: 0, y: 0, ang: 0, speed: 0, live: 0 };

  function damage(i, amount) {
    if (!alive(i)) return;
    sim.hp[i] -= amount;
    sim.glow[i] = Math.min(1, sim.glow[i] + 0.35);
    if (sim.hp[i] < sim.maxHp[i] * 0.4) sim.burn[i] = Math.min(1, sim.burn[i] + 0.2);
    if (sim.hp[i] <= 0 && sim.hero[i] < 0) startDying(i, NaN);
  }

  // Salwa: część wież wali w cel; smuga leci ~tracerSpeed, trafienie = błysk na kadłubie celu (tarcza — błysk tarczy).
  function volley(i, tg, shots, heavy, t0) {
    const c = classes[sim.cls[i]];
    const tc = classes[sim.cls[tg]];
    const ts = sim.scale[tg];
    const fac = sim.fac[i];
    const kind = heavy ? (fac === 0 ? WB_FX.SHOT_HEAVY_TN : WB_FX.SHOT_HEAVY_PIR) : (fac === 0 ? WB_FX.SHOT_TN : WB_FX.SHOT_PIR);
    const width = (heavy ? 1.6 : 1) * (c.len > 1100 ? 46 : (c.len > 500 ? 34 : 22)) * Math.sqrt(sim.scale[i]);
    const shield = tc.shield && sim.hp[tg] > sim.maxHp[tg] * 0.45 && sim.burn[tg] < 0.5;
    for (let s = 0; s < shots; s++) {
      const u = shots > 1 ? 0.8 - (1.6 * s) / (shots - 1) : 0;
      hullPoint(i, u * range(0.85, 1), (s & 1 ? 0.5 : -0.5) * range(0.6, 1), _p0);
      const hit = heavy || rnd() < T.hitChance;
      if (hit) hullPoint(tg, range(-0.8, 0.8), range(-0.7, 0.7), _p1);
      else {
        _p1[0] = sim.x[tg] + range(-1.2, 1.2) * tc.len * ts;
        _p1[1] = sim.y[tg] + range(-1.2, 1.2) * tc.len * ts;
        _p1[2] = sim.z[tg];
      }
      const dx = _p1[0] - _p0[0];
      const dy = _p1[1] - _p0[1];
      const dur = Math.sqrt(dx * dx + dy * dy) / (T.tracerSpeed * (heavy ? 1.3 : range(0.85, 1.15)));
      _p1[0] += sim.vx[tg] * dur;
      _p1[1] += sim.vy[tg] * dur;
      const tt = t0 + s * (heavy ? 0.05 : 0.07);
      const impact = hit ? (shield ? 0 : (heavy ? 1.6 : 1) * (150 + tc.len * ts * 0.12)) : 0;
      sim.sink.shot(_p0[0], _p0[1], _p0[2], _p1[0], _p1[1], _p1[2], tt, dur, kind, width, impact);
      if (hit && shield) sim.sink.flash(_p1[0], _p1[1], _p1[2], Math.min(tc.wid * ts * 0.35, 260 * Math.sqrt(ts)), tt + dur, 0.28, WB_FX.FLASH_SHIELD);
      if (hit && !shield && rnd() < (heavy ? 0.5 : 0.18)) {
        sim.sink.debris(_p1[0], _p1[1], _p1[2], sim.vx[tg], sim.vy[tg], 0, tt + dur, range(0.5, 0.9), 70 * ts, WB_FX.DEBRIS_SPARK);
      }
      sim.stats.shots++;
    }
  }

  function fireGuns(i, dt) {
    sim.gunT[i] -= dt;
    if (sim.gunT[i] > 0) return;
    const c = classes[sim.cls[i]];
    sim.gunT[i] = (1 / c.rof) * range(0.7, 1.3);
    const tg = sim.target[i];
    if (tg < 0 || !alive(tg)) return;
    const dx = sim.x[tg] - sim.x[i];
    const dy = sim.y[tg] - sim.y[i];
    const reach = c.range * sim.scale[i];
    if (dx * dx + dy * dy > reach * reach) return;
    const shots = Math.max(1, Math.round(c.guns * range(T.volley[0], T.volley[1])));
    volley(i, tg, shots, false, sim.time);
    const tc = classes[sim.cls[tg]];
    for (let s = 0; s < shots; s++) if (rnd() < T.hitChance) damage(tg, range(0.6, 1.2) * 2.2 / Math.max(0.5, tc.hp / 14));
  }

  // Wielki laser: ładowanie przy dziobie (~1 s), wiązka przez capitala wroga — cel ginie, pęka wzdłuż wiązki.
  function fireRay(i, dt) {
    const c = classes[sim.cls[i]];
    if (!c.ray) return;
    sim.rayT[i] -= dt;
    if (sim.rayT[i] > 0) return;
    sim.rayT[i] = c.ray * range(0.8, 1.3);
    const fac = sim.fac[i];
    const bi = sim.band[i];
    let best = -1;
    let bestD = (c.range * sim.scale[i] * 1.5) ** 2;
    for (let k = 0; k < sim.n; k++) {
      if (sim.band[k] !== bi || sim.fac[k] === fac || sim.hero[k] >= 0 || !alive(k)) continue;
      if (sim.mode[k] === WB_MODE.WARPIN || classes[sim.cls[k]].role === 'escort') continue;
      const dx = sim.x[k] - sim.x[i];
      const dy = sim.y[k] - sim.y[i];
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) return;
    const L = c.len * sim.scale[i];
    hullPoint(i, 0.95, 0, _p0);
    sim.sink.flash(_p0[0], _p0[1], _p0[2], L * 0.4, sim.time, 1.0, fac === 0 ? WB_FX.FLASH_CHARGE_TN : WB_FX.FLASH_CHARGE_PIR);
    const k = best;
    const dx = sim.x[k] - _p0[0];
    const dy = sim.y[k] - _p0[1];
    _p1[0] = _p0[0] + dx * 1.45;
    _p1[1] = _p0[1] + dy * 1.45;
    _p1[2] = sim.z[k];
    const width = 120 * Math.sqrt(sim.scale[i]) * (L / 1500 + 0.5);
    sim.sink.beam(_p0[0], _p0[1], _p0[2], _p1[0], _p1[1], _p1[2], sim.time + 1.0, 1.3, width, fac === 0 ? WB_BEAM.RAY_TN : WB_BEAM.RAY_PIR);
    sim.stats.rays++;
    // cel: śmierć ~0,5 s po starcie wiązki (t < 0 — czeka), cięcie wzdłuż promienia
    startDying(k, Math.atan2(dy, dx));
    sim.t[k] = -1.5;
  }

  function startDying(i, cut) {
    sim.mode[i] = WB_MODE.DYING;
    sim.t[i] = 0;
    sim.cutAng[i] = cut;
  }

  function dyingTime(i) {
    return T.dying * (classes[sim.cls[i]].len * sim.scale[i] > 2400 ? 1.6 : 1);
  }

  function finishDying(i) {
    const c = classes[sim.cls[i]];
    const L = c.len * sim.scale[i];
    const x = sim.x[i];
    const y = sim.y[i];
    const z = sim.z[i];
    sim.sink.flash(x, y, z, L * 0.62, sim.time, 0.42, WB_FX.FLASH_DEATH);
    // kłąb kul ognia: kilka nakładających się, z opóźnieniem i rozrzutem po kadłubie (nie jedna płaska tarcza)
    const ca = Math.cos(sim.ang[i]);
    const sa = Math.sin(sim.ang[i]);
    const nBall = L > 1500 ? 5 : (L > 600 ? 4 : 2);
    for (let k = 0; k < nBall; k++) {
      const u = range(-0.45, 0.45) * L;
      const v = range(-0.25, 0.25) * L;
      sim.sink.flash(x + ca * u - sa * v, y + sa * u + ca * v, z, L * range(0.2, 0.36), sim.time + range(0, 0.4), range(1.0, 1.8), WB_FX.FLASH_FIRE);
    }
    sim.sink.ring(x, y, z, L * 2.0, sim.time, 1.2);
    const nDeb = Math.min(40, 8 + Math.round(L / 70));
    for (let k = 0; k < nDeb; k++) {
      const a = rnd() * TAU;
      const sp = range(250, 1900) * (L > 1500 ? 1.3 : 1);
      sim.sink.debris(x, y, z, sim.vx[i] + Math.cos(a) * sp, sim.vy[i] + Math.sin(a) * sp, range(-0.4, 0.4) * sp,
        sim.time, range(1.0, 3.2), range(30, 110) * (L / 1500 + 0.4), (k % 3) === 0 ? WB_FX.DEBRIS_METAL : WB_FX.DEBRIS_SPARK);
    }
    spawnChunks(i);
    sim.stats.kills++;
    const fac = sim.fac[i];
    const bi = sim.band[i];
    const respawn = sim.hero[i] < 0 && !sim.noRespawn[i];
    releaseShip(i);
    if (respawn) sim.pending.push(sim.time + range(T.respawn[0], T.respawn[1]), fac, bi);
  }

  function releaseShip(i) {
    sim.active[i] = 0;
    sim.mode[i] = WB_MODE.FREE;
    sim.hero[i] = -1;
    freeShips.push(i);
  }

  // Rozpad: pasy poprzeczne kadłuba (granice b z poszarpanym brzegiem — ziarno s), przy cięciu wiązką każdy pas na
  // dwie strony linii cięcia (kąt względem kadłuba). Kawałek = cały kwad kadłuba z maską (obraz), obrót wokół środka
  // swojego kawałka (pu, pv — ułamki pół długości / szerokości, v ku prawej burcie).
  function spawnChunks(i) {
    const c = classes[sim.cls[i]];
    const s = sim.scale[i];
    const L = c.len * s;
    const cut = sim.cutAng[i];
    const hasCut = Number.isFinite(cut);
    const K = hasCut ? (L > 1400 ? 2 : 1) : (L > 2400 ? 4 : (L > 900 ? 3 : 2));
    const rel = hasCut ? cut - sim.ang[i] : 0;
    const nx = -Math.sin(rel);
    const ny = Math.cos(rel);
    const sides = hasCut ? 2 : 1;
    const ca = Math.cos(sim.ang[i]);
    const sa = Math.sin(sim.ang[i]);
    const fac = sim.fac[i];
    let bPrev = -1.4;
    let sPrev = rnd() * 60;
    for (let j = 0; j < K; j++) {
      const bNext = j === K - 1 ? 1.4 : -1 + (2 * (j + 1)) / K + range(-0.25, 0.25) / K;
      const sNext = rnd() * 60;
      for (let sd = 0; sd < sides; sd++) {
        if (!freeChunks.length) return;
        const k = freeChunks.pop();
        const side = hasCut ? (sd === 0 ? 1 : -1) : 0;
        let pu = (Math.max(-1, bPrev) + Math.min(1, bNext)) * 0.5;
        let pv = 0;
        if (side) { pu += nx * 0.35 * side; pv += ny * 0.45 * side; }
        pu = Math.max(-0.9, Math.min(0.9, pu));
        pv = Math.max(-0.7, Math.min(0.7, pv));
        sim.cActive[k] = 1;
        sim.cCls[k] = sim.cls[i];
        sim.cFac[k] = fac;
        sim.cBand[k] = sim.band[i];
        sim.cScale[k] = s;
        sim.cSeed[k] = sim.seed[i];
        sim.cB0[k] = bPrev;
        sim.cB1[k] = bNext;
        sim.cS0[k] = sPrev;
        sim.cS1[k] = sNext;
        sim.cSide[k] = side;
        sim.cCut[k] = rel;
        sim.cPu[k] = pu;
        sim.cPv[k] = pv;
        sim.cHero[k] = sim.hero[i] >= 0 ? 1 : 0;
        // środek kawałka w świecie
        const lu = pu * c.len * 0.5 * s;
        const lv = pv * c.wid * 0.5 * s;
        const wx = ca * lu - sa * lv;
        const wy = sa * lu + ca * lv;
        sim.cx[k] = sim.x[i] + wx;
        sim.cy[k] = sim.y[i] + wy;
        sim.cz[k] = sim.z[i];
        const dl = Math.sqrt(wx * wx + wy * wy) || 1;
        const sp = range(50, 200) * (1100 / Math.max(500, L) + 0.35) * (sim.hero[i] >= 0 ? 1.6 : 1);
        sim.cvx[k] = sim.vx[i] * 0.55 + (wx / dl) * sp;
        sim.cvy[k] = sim.vy[i] * 0.55 + (wy / dl) * sp;
        sim.cAng[k] = sim.ang[i];
        sim.cSpin[k] = range(-0.16, 0.16) * (900 / Math.max(500, L)) + (side ? side * 0.05 : 0);
        sim.cAge[k] = 0;
        sim.cLife[k] = range(T.chunkLife[0], T.chunkLife[1]);
        sim.stats.chunks++;
      }
      bPrev = bNext;
      sPrev = sNext;
    }
  }

  function stepShip(i, dt) {
    const m = sim.mode[i];
    if (m === WB_MODE.HERO) { sim.glow[i] = Math.max(0, sim.glow[i] - dt * 1.8); return; }
    const c = classes[sim.cls[i]];
    const b = bands[sim.band[i]];
    const s = sim.scale[i];
    const L = c.len * s;
    sim.t[i] += dt;
    sim.glow[i] = Math.max(0, sim.glow[i] - dt * 1.8);
    if (m === WB_MODE.DYING) {
      const damp = 1 - Math.min(1, dt * 0.45);
      sim.vx[i] *= damp;
      sim.vy[i] *= damp;
      sim.x[i] += sim.vx[i] * dt;
      sim.y[i] += sim.vy[i] * dt;
      sim.thrust[i] = 0;
      if (sim.t[i] >= 0) {
        sim.burn[i] = Math.min(1, sim.burn[i] + dt * 1.2);
        if (rnd() < dt * (L > 1500 ? 7 : 5)) {
          hullPoint(i, range(-0.85, 0.85), range(-0.7, 0.7), _p0);
          sim.sink.flash(_p0[0], _p0[1], _p0[2], L * range(0.12, 0.26), sim.time, range(0.45, 0.85), WB_FX.FLASH_FIRE);
          if (rnd() < 0.5) sim.sink.debris(_p0[0], _p0[1], _p0[2], sim.vx[i], sim.vy[i], 0, sim.time, 0.7, 60 * s, WB_FX.DEBRIS_SPARK);
        }
        if (sim.t[i] >= dyingTime(i)) finishDying(i);
      }
      return;
    }
    if (sim.slide[i] > 0) sim.slide[i] += dt;
    sim.retT[i] -= dt;
    if (sim.retT[i] <= 0) { sim.retT[i] = range(1.2, 2.2); retarget(i); }
    const tg = sim.target[i];
    const front = frontAt(sim.time, sim.band[i]);
    const u = uOf(i);
    const v = vOf(i);
    const own = sim.fac[i] === 0 ? -1 : 1;
    let wantU = 0;
    let wantV = 0;
    let wantSp = c.speed;
    if (c.role === 'escort') {
      // przeloty: na tyły wroga, zawrót, z powrotem za swoją linię
      const rear = front - own * b.halfX * 0.32;
      const home = front + own * b.halfX * 0.22;
      const toward = sim.runDir[i] === -own;
      if (toward && (own < 0 ? u > rear : u < rear)) sim.runDir[i] = own;
      else if (!toward && (own < 0 ? u < home : u > home)) sim.runDir[i] = -own;
      wantU = sim.runDir[i];
      wantV = Math.sin(sim.weave[i] + sim.t[i] * 0.33) * 0.4;
      if (tg >= 0 && alive(tg)) wantV += Math.max(-0.5, Math.min(0.5, (vOf(tg) - v) / (6000 * s)));
    } else {
      // linia: stanowisko przed frontem, potem burta i powolny dryf w poprzek
      const station = front + own * c.range * s * (c.role === 'carrier' ? 1.0 : 0.5);
      const du = station - u;
      if (Math.abs(du) > 1600 * s) {
        wantU = Math.sign(du);
        wantV = (sim.laneV[i] - v) / (18000 * s);
      } else {
        // w linii: burtą do wroga — marsz wzdłuż frontu (w poprzek osi stron), zawrót przy brzegu pasma
        if (sim.latDir[i] * v > b.halfY * 0.8) sim.latDir[i] = -sim.latDir[i];
        wantU = du / (6000 * s);
        wantV = sim.latDir[i] * (0.85 + 0.25 * Math.sin(sim.weave[i] + sim.t[i] * 0.07));
        wantSp = c.speed * 0.45;
      }
    }
    if (Math.abs(v) > b.halfY) wantV = -Math.sign(v) * 0.9;
    const wl = Math.sqrt(wantU * wantU + wantV * wantV) || 1;
    const wa = Math.atan2(toY(wantU / wl, wantV / wl), toX(wantU / wl, wantV / wl));
    const turnRate = L > 2400 ? 0.07 : (L > 1200 ? 0.13 : (L > 500 ? 0.25 : 0.55));
    let dA = wa - sim.ang[i];
    dA -= TAU * Math.round(dA / TAU);
    const maxTurn = turnRate * dt;
    const na = sim.ang[i] + Math.max(-maxTurn, Math.min(maxTurn, dA));
    sim.ang[i] = na;
    let sp = wantSp;
    if (sim.slide[i] > 0) {
      sp = Math.max(sp, warpSlideSpeed(c.speed, sim.slide[i]));
      if (sim.slide[i] > WB_WARP.tau * 4) {
        sim.slide[i] = 0;
        if (sim.mode[i] === WB_MODE.WARPIN) sim.mode[i] = c.role === 'escort' ? WB_MODE.RUN : WB_MODE.LINE;
      }
    }
    sim.thrust[i] = Math.min(1, sp / Math.max(1, c.speed));
    sim.vx[i] = Math.cos(na) * sp;
    sim.vy[i] = Math.sin(na) * sp;
    sim.x[i] += sim.vx[i] * dt;
    sim.y[i] += sim.vy[i] * dt;
    // poza pasmem wzdłuż osi — skok do warpa (zastępca wpadnie po swojej stronie)
    if (Math.abs(u - front) > b.halfX * 1.02) {
      sim.sink.flash(sim.x[i], sim.y[i], sim.z[i], L * 0.7, sim.time, 0.3, sim.fac[i] === 0 ? WB_FX.FLASH_WARP_TN : WB_FX.FLASH_WARP_PIR);
      const fac = sim.fac[i];
      const bi = sim.band[i];
      releaseShip(i);
      sim.pending.push(sim.time + range(0.5, 3), fac, bi);
      return;
    }
    fireGuns(i, dt);
    fireRay(i, dt);
    if (sim.burn[i] > 0.05 && rnd() < dt * 2.2 * sim.burn[i]) {
      hullPoint(i, range(-0.7, 0.7), range(-0.6, 0.6), _p0);
      sim.sink.flash(_p0[0], _p0[1], _p0[2], L * 0.16, sim.time, 0.7, WB_FX.FLASH_FIRE);
    }
  }

  function stepChunks(dt) {
    for (let k = 0; k < C; k++) {
      if (!sim.cActive[k]) continue;
      sim.cAge[k] += dt;
      if (sim.cAge[k] >= sim.cLife[k]) { sim.cActive[k] = 0; freeChunks.push(k); continue; }
      sim.cx[k] += sim.cvx[k] * dt;
      sim.cy[k] += sim.cvy[k] * dt;
      sim.cAng[k] += sim.cSpin[k] * dt;
      if (sim.cAge[k] < 4 && rnd() < dt * (sim.cHero[k] ? 4 : 1.2)) {
        const L = classes[sim.cCls[k]].len * sim.cScale[k];
        sim.sink.flash(sim.cx[k] + range(-0.25, 0.25) * L, sim.cy[k] + range(-0.25, 0.25) * L, sim.cz[k], L * 0.13, sim.time, 0.6, WB_FX.FLASH_FIRE);
      }
    }
  }

  function stepFighters(dt) {
    for (let j = 0; j < F; j++) {
      if (!sim.fActive[j]) continue;
      const bi = sim.fBand[j];
      const b = bands[bi];
      sim.fT[j] -= dt;
      if (sim.fT[j] <= 0) {
        if (rnd() < 0.7) sim.sink.flash(sim.fx[j], sim.fy[j], sim.fz[j], 140 * b.scale, sim.time, 0.35, WB_FX.FLASH_SMALL);
        const fac = sim.fFac[j];
        sim.fActive[j] = 0;
        freeFighters.push(j);
        spawnFighter(fac, bi);
        continue;
      }
      // kocioł przy froncie: punkt wędruje, myśliwiec skręca ku niemu z szarpnięciami
      sim.fJink[j] += dt * (0.7 + (j % 7) * 0.12);
      const front = frontAt(sim.time, bi);
      const cu = front + Math.sin(sim.fJink[j] * 0.37 + j) * b.halfX * 0.15;
      const cv = Math.cos(sim.fJink[j] * 0.21 + j * 1.7) * b.halfY * 0.55;
      const dx = toX(cu, cv) - sim.fx[j];
      const dy = toY(cu, cv) - sim.fy[j];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const spd = T.fighterSpeed * (0.8 + 0.4 * b.scale / 3);
      const steer = 1.5 * dt;
      let vx = sim.fvx[j] + ((dx / d) * spd - sim.fvx[j]) * steer + Math.cos(sim.fJink[j] * 3.1) * 1100 * dt;
      let vy = sim.fvy[j] + ((dy / d) * spd - sim.fvy[j]) * steer + Math.sin(sim.fJink[j] * 2.7) * 1100 * dt;
      const vl = Math.sqrt(vx * vx + vy * vy) || 1;
      vx *= spd / vl;
      vy *= spd / vl;
      sim.fvx[j] = vx;
      sim.fvy[j] = vy;
      sim.fx[j] += vx * dt;
      sim.fy[j] += vy * dt;
      sim.fGun[j] -= dt;
      if (sim.fGun[j] <= 0) {
        sim.fGun[j] = range(0.7, 2.4);
        const len = range(1800, 3200) * b.scale;
        const kind = sim.fFac[j] === 0 ? WB_FX.SHOT_FTR_TN : WB_FX.SHOT_FTR_PIR;
        const x1 = sim.fx[j] + (vx / spd) * len;
        const y1 = sim.fy[j] + (vy / spd) * len;
        sim.sink.shot(sim.fx[j], sim.fy[j], sim.fz[j], x1, y1, sim.fz[j], sim.time, len / (T.tracerSpeed * 1.2), kind, 10 * b.scale, 0);
      }
    }
  }

  // ── bohaterowie ────────────────────────────────────────────────────────────────────────────────────────────
  function heroSpawn(H, w) {
    if (!freeShips.length) return -1;
    const spec = H.plan.ships[w];
    const i = freeShips.pop();
    resetShip(i, spec.cls, spec.fac, 0, spec.scale);
    sim.hero[i] = H.index;
    sim.mode[i] = WB_MODE.HERO;
    sim.maxHp[i] = 1e6;
    sim.hp[i] = 1e6;
    sim.seed[i] = (Math.imul(H.plan.seed + 1, 2654435761) + w * 7919) >>> 0;
    sim.noRespawn[i] = 1;
    heroPlace(i, spec, sim.time);
    sim.z[i] = spec.z;
    if (spec.warp) {
      const L = classes[spec.cls].len * spec.scale;
      const ca = Math.cos(spec.ang);
      const sa = Math.sin(spec.ang);
      sim.sink.streak(sim.x[i], sim.y[i], sim.z[i], ca, sa, L * 8, sim.time - 0.2, 0.4, spec.fac);
      sim.sink.flash(sim.x[i] + ca * L * 0.5, sim.y[i] + sa * L * 0.5, sim.z[i], L * 1.1, sim.time, 0.45,
        spec.fac === 0 ? WB_FX.FLASH_WARP_TN : WB_FX.FLASH_WARP_PIR);
    }
    return i;
  }

  function heroPlace(i, spec, t) {
    heroShipPose(spec, t, _pose);
    sim.x[i] = _pose.x;
    sim.y[i] = _pose.y;
    sim.ang[i] = _pose.ang;
    sim.vx[i] = Math.cos(_pose.ang) * _pose.speed;
    sim.vy[i] = Math.sin(_pose.ang) * _pose.speed;
    sim.thrust[i] = Math.min(1, (_pose.speed / Math.max(1, spec.v)) * 0.7);
  }

  function heroSalvo(H, e) {
    const a = H.slots[e.from];
    const b = H.slots[e.to];
    if (a < 0 || b < 0 || !sim.active[a] || !sim.active[b]) return;
    volley(a, b, e.shots | 0, !!e.heavy, sim.time);
    sim.glow[b] = 1;
    sim.burn[b] = Math.min(1, sim.burn[b] + (e.heavy ? 0.12 : 0.05));
  }

  function heroBeam(H, e) {
    const a = H.slots[e.from];
    const b = H.slots[e.to];
    if (a < 0 || b < 0 || !sim.active[a] || !sim.active[b]) return;
    hullPoint(a, 0.97, 0, _p0);
    const dx = sim.x[b] - _p0[0];
    const dy = sim.y[b] - _p0[1];
    const reach = Number(e.reach) || 1.4;
    _p1[0] = _p0[0] + dx * reach;
    _p1[1] = _p0[1] + dy * reach;
    _p1[2] = sim.z[b];
    sim.sink.beam(_p0[0], _p0[1], _p0[2], _p1[0], _p1[1], _p1[2], sim.time, e.dur, e.width, e.beam | 0);
    sim.cutAng[b] = Math.atan2(dy, dx);
    sim.glow[b] = 1;
    // trafienie wiązki: seria błysków wzdłuż jej przejścia przez kadłub
    const L = classes[sim.cls[b]].len * sim.scale[b];
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    for (let k = 0; k < 5; k++) {
      const f = (k - 2) * 0.22 * L;
      sim.sink.flash(sim.x[b] + (dx / dl) * f, sim.y[b] + (dy / dl) * f, sim.z[b], L * range(0.25, 0.45),
        sim.time + 0.08 + k * 0.12, 0.7, WB_FX.FLASH_FIRE);
    }
    sim.stats.rays++;
  }

  function stepHeroes() {
    const t = sim.time;
    for (let h = 0; h < sim.heroes.length; h++) {
      const H = sim.heroes[h];
      if (H.done) continue;
      const ships = H.plan.ships;
      for (let w = 0; w < ships.length; w++) {
        const spec = ships[w];
        if (!H.spawned[w] && t >= spec.tSpawn) { H.spawned[w] = 1; H.slots[w] = heroSpawn(H, w); }
        const i = H.slots[w];
        if (i < 0 || !sim.active[i] || sim.hero[i] !== H.index) continue;
        if (sim.mode[i] === WB_MODE.HERO) heroPlace(i, spec, t);
      }
      const ev = H.plan.events;
      while (H.next < ev.length && ev[H.next].t <= t) {
        const e = ev[H.next++];
        if (e.type === WB_EV.SALVO) heroSalvo(H, e);
        else if (e.type === WB_EV.CHARGE) {
          const a = H.slots[e.from];
          if (a >= 0 && sim.active[a]) {
            hullPoint(a, 0.97, 0, _p0);
            const L = classes[sim.cls[a]].len * sim.scale[a];
            sim.sink.flash(_p0[0], _p0[1], _p0[2], L * 0.42 * (e.size || 1), t, e.dur,
              sim.fac[a] === 0 ? WB_FX.FLASH_CHARGE_TN : WB_FX.FLASH_CHARGE_PIR);
          }
        } else if (e.type === WB_EV.BEAM) heroBeam(H, e);
        else if (e.type === WB_EV.BURN) {
          const b = H.slots[e.who];
          if (b >= 0 && sim.active[b]) { sim.burn[b] = Math.min(1, sim.burn[b] + (e.amount || 0.5)); sim.glow[b] = 1; }
        } else if (e.type === WB_EV.KILL) {
          const b = H.slots[e.who];
          if (b >= 0 && sim.active[b] && sim.mode[b] !== WB_MODE.DYING) {
            const cut = e.cut ? sim.cutAng[b] : NaN;
            startDying(b, cut);
            sim.t[b] = Math.max(0, dyingTime(b) - (Number(e.delay) || 0.5));
          }
        } else if (e.type === WB_EV.WARPOUT) {
          const a = H.slots[e.who];
          if (a >= 0 && sim.active[a] && sim.mode[a] === WB_MODE.HERO) {
            const L = classes[sim.cls[a]].len * sim.scale[a];
            const ca = Math.cos(sim.ang[a]);
            const sa = Math.sin(sim.ang[a]);
            sim.sink.flash(sim.x[a] + ca * L * 0.5, sim.y[a] + sa * L * 0.5, sim.z[a], L * 1.0, t, 0.45,
              sim.fac[a] === 0 ? WB_FX.FLASH_WARP_TN : WB_FX.FLASH_WARP_PIR);
            sim.sink.streak(sim.x[a] + ca * L * 8, sim.y[a] + sa * L * 8, sim.z[a], ca, sa, L * 8, t, 0.35, sim.fac[a]);
            releaseShip(a);
          }
        }
      }
      // koniec sceny: bohaterowie, którzy zostali, znikają w skoku (bez wybuchu)
      if (t >= H.plan.t1 && H.next >= ev.length) {
        H.done = true;
        for (let w = 0; w < ships.length; w++) {
          const i = H.slots[w];
          if (i >= 0 && sim.active[i] && sim.hero[i] === H.index && sim.mode[i] === WB_MODE.HERO) releaseShip(i);
        }
      }
    }
  }

  function stepPending() {
    const P = sim.pending;
    let w = 0;
    for (let r = 0; r < P.length; r += 3) {
      if (P[r] <= sim.time) {
        const fac = P[r + 1];
        const bi = P[r + 2];
        const cls = pickClass(fac, bi);
        const b = bands[bi];
        const own = fac === 0 ? -1 : 1;
        const u = frontAt(sim.time, bi) + own * b.halfX * range(0.25, 0.7);
        spawnShip(fac, bi, cls, u, placeV(bi), true);
      } else {
        P[w++] = P[r]; P[w++] = P[r + 1]; P[w++] = P[r + 2];
      }
    }
    P.length = w;
  }

  /** Bohaterowie: plan z planWarHero (src/render/warBackdropPlan.js). Czasy planu = czas symulacji. */
  sim.addHero = function addHero(plan) {
    const H = { index: sim.heroes.length, plan, next: 0, done: false,
      spawned: new Uint8Array(plan.ships.length), slots: new Int16Array(plan.ships.length).fill(-1) };
    sim.heroes.push(H);
    return H;
  };

  /** Krok czasu sceny (dt — czas gry; 0 w pauzie); najwyżej `maxSteps` kroków, zaległość ponad to przepada. */
  sim.step = function step(dt, maxSteps = 12) {
    sim.acc += Math.max(0, Number(dt) || 0);
    let steps = 0;
    while (sim.acc >= WB_STEP && steps < maxSteps) {
      sim.acc -= WB_STEP;
      steps++;
      sim.time += WB_STEP;
      stepPending();
      stepHeroes();
      for (let i = 0; i < sim.n; i++) if (sim.active[i]) stepShip(i, WB_STEP);
      stepChunks(WB_STEP);
      stepFighters(WB_STEP);
    }
    if (sim.acc >= WB_STEP) {
      const skip = Math.floor(sim.acc / WB_STEP) * WB_STEP;
      sim.time += skip;
      sim.acc -= skip;
    }
    return steps;
  };

  /** Statystyka (debug, testy) — liczona na żądanie. */
  sim.count = function count() {
    let a = 0;
    let d = 0;
    for (let i = 0; i < sim.n; i++) {
      if (!sim.active[i]) continue;
      if (sim.mode[i] === WB_MODE.DYING) d++; else a++;
    }
    let f = 0;
    for (let j = 0; j < F; j++) if (sim.fActive[j]) f++;
    let c = 0;
    for (let k = 0; k < C; k++) if (sim.cActive[k]) c++;
    sim.stats.alive = a;
    sim.stats.dying = d;
    sim.stats.fighters = f;
    sim.stats.chunkAlive = c;
    return sim.stats;
  };

  /** Rozbieg: `seconds` symulacji bez obrazu (bitwa trwa już, gdy scena się zaczyna). */
  sim.prewarm = function prewarm(seconds) {
    const sink = sim.sink;
    sim.sink = WB_NOOP_SINK;
    const n = Math.max(0, Math.round((Number(seconds) || 0) / WB_STEP));
    for (let k = 0; k < n; k++) sim.step(WB_STEP, 1);
    sim.sink = sink;
  };

  populate();
  return sim;
}
