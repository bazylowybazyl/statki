// dema/bronie-webgpu/recipes.js
//
// Receptury efektów broni: wylot, pocisk, lot, trafienie, rzaz, wylot przestrzeliny,
// ładowanie, wiązki. Każda receptura wysyła PACZKI do pul GPU (gpuFx.js), światła
// (fxLights.js) i stemple ran na kadłubie (hull.js).
//
// Porty 1:1 z gry (liczby z recept): armata i Yamato (src/3d/muzzleFx3D.js,
// fireCannon), Hexlance (src/3d/railgunFx3D.js: charge/fire/impact/kerf), trafienie
// Yamato (src/effects3d/yamato.js, w skali). Reszta to nowe receptury pod WebGPU.
// W grze rozlanie światła (wash) było kwadem na poszyciu — tu to prawdziwe
// światło z siatki (kadłub, wieżyczki, dym i odłamki łapią błysk z reliefem).
//
// Wejście w świecie gry (x, y, kąt); scena = (x, −y), kierunek (cos a, −sin a).

import { K } from './gpuFx.js';
import { PSTYLE } from './projectiles.js';
import { BEAM } from './beams.js';
import { hexHdr, SIZE_POWER } from './arsenal.js';

export const Z = 15;
const FLAT = 0.18;
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Pomocnicze

const rng = (v, d) => (v === undefined ? [d, d] : Array.isArray(v) ? v : [v, v]);
const WHITE = [1, 1, 1];
const mulc = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const rand = (a, b) => a + Math.random() * (b - a);

/** Paczka cząstek. P, D — punkt i kierunek w SCENIE. */
function E(pool, kind, n, P, D, o = {}) {
  // Ułamek zaokrąglany losowo: emitery ciągłe (tempo × dt) przy 144+ FPS
  // dostają < 1 cząstki na klatkę i zwykłe zaokrąglenie gubiło je całkiem.
  if (!(n > 0)) return;
  n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
  if (n <= 0) return;
  const b = pool.begin(kind, n).at(P.x, P.y, o.z ?? Z).dir(D.x, D.y, D.z || 0).cone(o.cone ?? 0, o.flat ?? FLAT);
  let r = rng(o.v, 0); b.speed(r[0], r[1]);
  r = rng(o.life, 1); b.life(r[0], r[1]);
  if (o.l) b.orient(o.l[0], o.l[1], o.w[0], o.w[1]);
  else { const a = rng(o.s0, 1); const c = rng(o.s1 ?? o.s0, 1); b.size(a[0], a[1], c[0], c[1]); }
  const c0 = o.c0 || WHITE;
  b.colors(c0, o.c1 || c0);
  r = rng(o.a, 1); b.alpha(r[0], r[1]);
  r = rng(o.drag, 0); b.drag(r[0], r[1]);
  b.fade(o.fin ?? 0.06, o.fout ?? 1.5).grow(o.grow ?? 0.6).mix(o.mix ?? 4);
  r = rng(o.off, 0); b.offset(r[0], r[1]);
  if (o.jit || o.jz) b.jitter(o.jit || 0, o.jz || 0);
  if (o.spin) b.spin(o.spin);
  if (o.pre) b.preAge(o.pre);
  if (o.vel) b.vel(o.vel.x, o.vel.y, 0);
  if (o.bounce !== undefined) b.bounce(o.bounce);
  if (o.x) b.extra(o.x[0] || 0, o.x[1] || 0, o.x[2] || 0, o.x[3] || 0);
  b.emit();
}

// Scena ↔ świat gry
const _P = { x: 0, y: 0 };
const _D = { x: 1, y: 0 };
function scenePos(x, y, out = { x: 0, y: 0 }) { out.x = x; out.y = -y; return out; }
function sceneDir(a, out = { x: 1, y: 0 }) { out.x = Math.cos(a); out.y = -Math.sin(a); return out; }
function sceneVec(dx, dy) { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: -dy / l }; }
const off = (P, D, d) => ({ x: P.x + D.x * d, y: P.y + D.y * d });
const rot = (D, a) => ({ x: D.x * Math.cos(a) - D.y * Math.sin(a), y: D.x * Math.sin(a) + D.y * Math.cos(a) });
const neg = (D) => ({ x: -D.x, y: -D.y });
const perp = (D) => ({ x: -D.y, y: D.x });
function reflect(D, N) { const d = D.x * N.x + D.y * N.y; return { x: D.x - 2 * d * N.x, y: D.y - 2 * d * N.y }; }

// ---------------------------------------------------------------------------
// Palety (HDR; barwy do bieli tylko w rdzeniach)

const PAL = {
  armata: {
    core0: [3.4, 2.7, 2.0], core1: [2.2, 0.85, 0.30], halo0: [1.9, 0.95, 0.42], halo1: [0.75, 0.22, 0.05],
    cross: [2.9, 2.0, 1.2], plumeOuter: [2.8, 1.6, 0.75], plumeInner: [3.2, 2.4, 1.5],
    gas0: [2.5, 1.15, 0.40], gas1: [0.55, 0.16, 0.04], smokeHot: [1.7, 0.75, 0.30], puffHot: [1.1, 0.5, 0.22],
    soot: [0.24, 0.23, 0.22], flare0: [3.2, 2.5, 1.5], flare1: [2.0, 0.80, 0.28],
    spark: [2.8, 2.3, 1.6], sparkCool: [0.32, 0.06], ember0: [2.4, 1.0, 0.35], ember1: [1.0, 0.20, 0.04],
    fire0: [3.0, 1.55, 0.5], fire1: [0.85, 0.2, 0.03], light: [1.0, 0.6, 0.28]
  },
  yamato: {
    core0: [2.6, 3.2, 4.2], core1: [0.40, 1.15, 2.7], halo0: [0.55, 1.35, 2.7], halo1: [0.08, 0.28, 0.90],
    cross: [1.4, 2.4, 3.6], plumeOuter: [0.9, 1.9, 3.4], plumeInner: [2.0, 2.9, 4.0],
    gas0: [0.60, 1.5, 2.8], gas1: [0.08, 0.20, 0.60], smokeHot: [0.50, 1.0, 1.9], puffHot: [0.32, 0.65, 1.25],
    soot: [0.17, 0.19, 0.25], flare0: [2.4, 3.1, 4.2], flare1: [0.45, 1.30, 2.9],
    spark: [1.7, 2.6, 3.8], sparkCool: [1.0, 1.15], ember0: [1.3, 2.2, 3.4], ember1: [0.25, 0.60, 1.5],
    fire0: [0.8, 1.45, 2.4], fire1: [0.04, 0.16, 0.6], light: [0.45, 0.8, 1.0]
  },
  goliath: {
    core0: [3.6, 2.6, 1.6], core1: [2.4, 0.7, 0.15], halo0: [2.0, 0.85, 0.3], halo1: [0.8, 0.18, 0.03],
    cross: [3.0, 1.8, 0.9], plumeOuter: [3.0, 1.4, 0.45], plumeInner: [3.4, 2.3, 1.2],
    gas0: [2.7, 1.0, 0.3], gas1: [0.6, 0.14, 0.03], smokeHot: [1.9, 0.7, 0.2], puffHot: [1.2, 0.45, 0.15],
    soot: [0.2, 0.19, 0.18], flare0: [3.4, 2.4, 1.3], flare1: [2.2, 0.7, 0.18],
    spark: [3.0, 2.2, 1.3], sparkCool: [0.3, 0.05], ember0: [2.6, 0.9, 0.25], ember1: [1.0, 0.18, 0.03],
    fire0: [3.2, 1.4, 0.35], fire1: [0.9, 0.16, 0.02], light: [1.0, 0.52, 0.2]
  }
};
const BRASS = [0.78, 0.55, 0.22];
const STEEL = [0.30, 0.30, 0.33];

// ---------------------------------------------------------------------------
// Klocki wspólne

/** Armata prochowa (port fireCannon z src/3d/muzzleFx3D.js) + ogień, hamulec wylotowy, łuska, światło, fala. */
function cannonMuzzle(ctx, m, pal, S, I, dens, opts = {}) {
  const { fx } = ctx;
  const P = scenePos(m.x, m.y, {});
  const D = sceneDir(m.angle, {});
  E(fx.add, K.GLOW, 1, P, D, { v: 7 * S, life: 0.085, drag: 7, s0: 4 * S, s1: (11 + 7 * I) * S, c0: pal.core0, c1: pal.core1, mix: 16, fin: 0.004, fout: 2.2, grow: 0.4 });
  E(fx.add, K.GLOW, 1, off(P, D, 3 * S), D, { life: 0.21, drag: 5, s0: 7 * S, s1: (22 + 14 * I) * S, c0: pal.halo0, c1: pal.halo1, mix: 7, a: 0.8, fin: 0.01, fout: 2.0, grow: 0.5 });
  E(fx.add, K.FLARE, 1, P, D, { life: 0.13, s0: (14 + 6 * I) * S, s1: (46 + 30 * I) * S, c0: pal.flare0, c1: pal.flare1, mix: 12, a: 0.95, fin: 0.005, fout: 2.4, grow: 0.35, spin: 0.8 });
  E(fx.add, K.CROSS, 1, P, D, { life: 0.10, l: [14 * S, (40 + 24 * I) * S], w: [8 * S, (17 + 8 * I) * S], c0: pal.cross, a: 0.95 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.105, l: [5 * S, (26 + 16 * I) * S], w: [5 * S, 9.5 * S], c0: pal.plumeOuter });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.075, l: [4 * S, (12 + 5 * I) * S], w: [9 * S, 18 * S], c0: pal.plumeInner, a: 0.85 });
  // hamulec wylotowy: dwa boczne jęzory odchylone do tyłu
  if (opts.brake) {
    for (const s of [-1, 1]) {
      E(fx.add, K.PLUME, 1, off(P, D, -3 * S), rot(D, s * opts.brake), { life: 0.09, l: [3 * S, 18 * S * I], w: [3 * S, 8 * S], c0: pal.plumeOuter, a: 0.9 });
      E(fx.smoke, 0, 3 * dens, off(P, D, -3 * S), rot(D, s * opts.brake), { cone: 0.35, v: [20 * S, 55 * S], life: [1.0, 2.0], drag: 1.6, s0: [3 * S, 5 * S], s1: [12 * S, 22 * S], c0: pal.smokeHot, c1: pal.soot, a: [0.3, 0.5], fin: 0.04, fout: 1.4, grow: 0.45, spin: 1, x: [20 * S, 3.5] });
    }
  }
  // kula ognia prochowego (szum, stygnie z bieli w czerwień)
  E(fx.add, K.FIRE, 6 * dens, P, D, { cone: 0.45, v: [30 * S, 110 * S], life: [0.16, 0.36], drag: 4, s0: [5 * S, 9 * S], s1: [15 * S, 30 * S * I], c0: pal.fire0, c1: pal.fire1, mix: 6, a: [0.7, 1.0], fin: 0.02, fout: 1.3, grow: 0.45, spin: 2, off: [0, 8 * S] });
  E(fx.add, K.GLOW, 10 * dens, P, D, { cone: 0.55, v: [14 * S, 48 * S], life: [0.22, 0.52], drag: 3.4, s0: [2 * S, 5 * S], s1: [9 * S * (0.8 + 0.4 * I), 19 * S * (0.8 + 0.4 * I)], c0: pal.gas0, c1: pal.gas1, mix: 4.5, a: [0.45, 0.8], fin: 0.02, fout: 1.9, grow: 0.5, spin: 2.2, off: [0, 4 * S] });
  // dym: gorący na starcie, stygnie do sadzy; oświetla go błysk
  E(fx.smoke, 0, 18 * dens, P, D, { cone: 0.62, v: [5 * S, 26 * S], life: [1.6, 3.2], drag: 1.15, s0: [3 * S, 7 * S], s1: [15 * S, 32 * S], c0: pal.smokeHot, c1: pal.soot, a: [0.4, 0.7], fin: 0.05, fout: 1.35, grow: 0.45, spin: 0.9, off: [0, 6 * S], jit: 2 * S, x: [22 * S, 3.2] });
  E(fx.smoke, 0, 5 * dens, P, D, { cone: 0.85, v: [2 * S, 10 * S], life: [2.6, 4.4], drag: 0.85, s0: [8 * S, 14 * S], s1: [32 * S, 52 * S], c0: pal.puffHot, c1: mulc(pal.soot, 0.85), a: [0.16, 0.30], fin: 0.12, fout: 1.6, grow: 0.5, spin: 0.4, off: [0, 9 * S], x: [16 * S, 2.0] });
  // iskry: 82% wąski snop, 18% wolne i szerokie
  const vk = 0.75 + 0.35 * I;
  E(fx.spark, K.SPARK, 57 * dens, P, D, { cone: 0.30, v: [40 * S * vk, 175 * S * vk], life: [0.3, 1.0], drag: [0.5, 1.4], off: [0, 5 * S], c0: pal.spark, x: [9 * S, pal.sparkCool[0], pal.sparkCool[1], 1.5] });
  E(fx.spark, K.SPARK, 13 * dens, P, D, { cone: 0.85, v: [8 * S * vk, 45 * S * vk], life: [0.3, 1.0], drag: [0.5, 1.4], off: [0, 5 * S], c0: pal.spark, x: [6 * S, pal.sparkCool[0], pal.sparkCool[1], 1.3] });
  E(fx.add, K.GLOW, 10 * dens, off(P, D, 3 * S), D, { cone: 0.7, v: [10 * S, 52 * S], life: [0.8, 2.2], drag: 1.5, s0: [0.6 * S, 1.2 * S], s1: [0.9 * S, 2.2 * S], c0: pal.ember0, c1: pal.ember1, mix: 1.6, a: 0.9, fin: 0.02, fout: 1.2, grow: 1.0 });
  // fala i drganie powietrza (sama refrakcja)
  E(fx.dist, K.SHOCK, 1, P, D, { life: 0.3, s0: 8 * S, s1: (70 + 40 * I) * S, a: 0.85, fin: 0.01, fout: 1.2 });
  E(fx.dist, K.HEAT, 2, off(P, D, 6 * S), D, { cone: 0.6, v: [8 * S, 24 * S], life: [0.7, 1.3], s0: 10 * S, s1: 34 * S, a: 0.55, fin: 0.1, fout: 1.5, grow: 0.5 });
  // łuska z zamka
  if (opts.casing) {
    const side = rot(D, (opts.casingSide || 1) * 1.75);
    E(fx.debris, K.CASING, 1, off(P, D, -opts.casingBack * S), side, { cone: 0.35, v: [40 * S, 80 * S], life: [2.5, 3.5], drag: 0.35, s0: opts.casing * S, c0: [0.25, 0.1, 0.02], c1: BRASS, a: 1, spin: 12, x: [2.5] });
  }
  const lr = Math.min(620, (150 + 60 * I) * S);
  ctx.lights.flash(m.x, m.y, pal.light[0], pal.light[1], pal.light[2], 5 * I * (opts.lightK || 1), lr, 0.14, { decay: 2, z: 30 });
  ctx.lights.flash(m.x, m.y, pal.light[0], pal.light[1] * 0.8, pal.light[2] * 0.6, 1.0 * I * (opts.lightK || 1), lr * 0.6, 0.6, { decay: 1.4, flicker: 0.5, z: 30 });
}

/** Wybuch pocisku (armata, goliath, ciężki autokanon, flak): ogień, iskry, odłamki, dym, fala. */
function blast(ctx, x, y, R, pal, o = {}) {
  const { fx } = ctx;
  const P = scenePos(x, y, {});
  const N = o.normal || { x: 0, y: 1 };
  const k = R / 100;
  E(fx.add, K.GLOW, 1, P, N, { life: 0.09, s0: 18 * k, s1: 150 * k, c0: [3.6, 3.0, 2.2], c1: pal.core1, mix: 14, fin: 0.004, fout: 2.0, grow: 0.4 });
  E(fx.add, K.FLARE, 1, P, N, { life: 0.14, s0: 40 * k, s1: 200 * k, c0: pal.flare0, c1: pal.flare1, mix: 10, a: 0.85, fin: 0.004, fout: 2.3, grow: 0.35, spin: 1 });
  E(fx.add, K.FIRE, (o.fire ?? 10), P, N, { cone: o.cone ?? 2.2, v: [40 * k, 190 * k], life: [0.35, 0.75], drag: 3.2, s0: [14 * k, 24 * k], s1: [45 * k, 100 * k], c0: pal.fire0, c1: pal.fire1, mix: 3, a: [0.7, 1], fin: 0.02, fout: 1.3, grow: 0.4, spin: 1.5 });
  E(fx.add, K.GLOW, 8, P, N, { cone: 2.4, v: [20 * k, 80 * k], life: [0.25, 0.5], drag: 3, s0: 10 * k, s1: 50 * k, c0: pal.gas0, c1: pal.gas1, mix: 4, a: 0.6, fin: 0.02, fout: 1.8, grow: 0.5 });
  E(fx.spark, K.SPARK, (o.sparks ?? 80), P, N, { cone: o.sparkCone ?? 1.5, v: [260 * k, 1000 * k], life: [0.3, 1.0], drag: [0.6, 1.5], c0: pal.spark, x: [55 * k, pal.sparkCool[0], pal.sparkCool[1], 1.5], bounce: 0.3 });
  E(fx.debris, K.CHUNK, (o.debris ?? 10), P, N, { cone: 1.6, v: [120 * k, 480 * k], life: [1.4, 2.8], drag: 0.3, s0: [2 * k, 5.5 * k], c0: [2.8, 1.2, 0.35], c1: STEEL, a: 1, spin: 10, x: [1.1] });
  E(fx.smoke, 0, (o.smoke ?? 12), P, N, { cone: 2.4, v: [20 * k, 120 * k], life: [2.2, 4.2], drag: 1.1, s0: [20 * k, 34 * k], s1: [70 * k, 150 * k], c0: pal.smokeHot, c1: pal.soot, a: [0.45, 0.75], fin: 0.04, fout: 1.3, grow: 0.45, spin: 0.6, x: [40 * k, 2.2] });
  E(fx.dist, K.SHOCK, 1, P, N, { life: 0.42, s0: 20 * k, s1: 420 * k, a: 1.0, fin: 0.01, fout: 1.1 });
  E(fx.dist, K.HEAT, 3, P, N, { cone: 3, v: [10 * k, 40 * k], life: [1.0, 1.8], s0: 40 * k, s1: 120 * k, a: 0.6, fin: 0.1, fout: 1.5, grow: 0.5 });
  ctx.lights.flash(x, y, pal.light[0], pal.light[1], pal.light[2], 14 * (o.lightK || 1) * Math.min(2, k), 360 * k + 200, 0.22, { decay: 2, z: 50 });
  ctx.lights.flash(x, y, pal.light[0], pal.light[1] * 0.7, pal.light[2] * 0.4, 3 * Math.min(2, k), 260 * k + 120, 1.3, { decay: 1.3, flicker: 0.7, z: 50 });
}

/** Rzaz / wejście pocisku przebijającego (port RailgunFX.kerf, bez krzyża). */
function kerf(ctx, x, y, D, S, I, spark = [2.9, 2.1, 1.2]) {
  const { fx } = ctx;
  const P = scenePos(x, y, {});
  E(fx.add, K.GLOW, 1, P, D, { life: 0.13, drag: 6, s0: 22 * S, s1: (90 + 60 * I) * S, c0: [3.6, 3.0, 2.2], c1: [2.0, 0.7, 0.2], mix: 12, a: 0.9, fin: 0.004, fout: 2.2, grow: 0.4 });
  E(fx.spark, K.SPARK, 25 * I, P, neg(D), { cone: 1.2, v: [120 * S, 620 * S], life: [0.25, 0.8], drag: [0.6, 1.5], c0: spark, x: [60 * S, 0.32, 0.06, 1.6] });
  E(fx.spark, K.SPARK, 20 * I, P, D, { cone: 0.6, v: [200 * S, 900 * S], life: [0.25, 0.8], drag: [0.6, 1.5], c0: spark, x: [60 * S, 0.32, 0.06, 1.6] });
}

/** Łuki po poszyciu wokół trafienia (Tempest, plazma): końce na kadłubie. */
function hullArcs(ctx, hull, x, y, n, rMin, rMax, col, life = [0.12, 0.34], jit = 6) {
  const { fx } = ctx;
  for (let i = 0; i < n; i++) {
    let tx = x; let ty = y;
    for (let tries = 0; tries < 6; tries++) {
      const a = Math.random() * TAU;
      const r = rand(rMin, rMax);
      tx = x + Math.cos(a) * r; ty = y + Math.sin(a) * r;
      if (!hull || hull.inside(tx, ty)) break;
    }
    const P = scenePos(x, y, {});
    const D = sceneVec(tx - x, ty - y);
    E(fx.arc, 0, 1, P, D, { v: Math.hypot(tx - x, ty - y), life, c0: col, x: [jit, 1.4], z: 17 });
  }
}

// ---------------------------------------------------------------------------
// RODZINY

export const RECIPES = {};

// ── TEMPEST ION ──────────────────────────────────────────────────────────────
// Stary efekt (muzzleFx3D fireIon) był poprawny, ale mały (S = skala wieżyczki
// 0,76) i płaski. Tu: sekwencja cewek wzdłuż lufy przed strzałem, diamenty
// uderzeniowe w strumieniu jonów, łuki pełzające po lufie, pierścień refrakcji,
// igła z helisą łuków w locie, a przy trafieniu łuki EMP po kadłubie i poświata
// jonowa na poszyciu.
RECIPES.tempest = {
  scale: 1.7,
  leadIn: 0.03,
  preFire(ctx, m, w) {
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    const len = 30 * m.scale;
    for (let k = 0; k < 3; k++) {
      ctx.after(k * 0.009, () => {
        const Pk = off(P, D, -len * (0.85 - k * 0.3));
        E(ctx.fx.add, K.GLOW, 1, Pk, D, { life: 0.07, s0: 5 * S, s1: 13 * S, c0: [1.4, 2.8, 4.2], c1: [0.2, 0.6, 1.6], mix: 20, a: 0.9, fin: 0.003, fout: 2 });
        E(ctx.fx.arc, 0, 2, Pk, perp(D), { cone: 2.6, v: [4 * S, 9 * S], life: [0.04, 0.09], c0: [1.2, 2.4, 3.8], x: [1.4 * S, 1.2] });
        ctx.lights.flash(m.x, m.y, 0.4, 0.75, 1.0, 1.8, 90 * S, 0.05, { decay: 1.5, z: 25 });
      });
    }
  },
  muzzle(ctx, m, w) {
    const { fx } = ctx;
    const I = SIZE_POWER[w.def.size] || 1;
    const S = m.scale * this.scale;
    const d = Math.min(1, 0.6 + 0.4 * I);
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.GLOW, 1, P, D, { v: 10 * S, life: 0.1, drag: 8, s0: 6 * S, s1: (16 + 10 * I) * S, c0: [3.2, 3.6, 4.2], c1: [0.5, 1.7, 3.0], mix: 18, fin: 0.003, fout: 2.0, grow: 0.38 });
    E(fx.add, K.GLOW, 1, off(P, D, 4 * S), D, { life: 0.32, drag: 4.2, s0: 8 * S, s1: (30 + 20 * I) * S, c0: [0.85, 2.1, 3.4], c1: [0.1, 0.4, 1.1], mix: 5.5, a: 0.8, fin: 0.008, fout: 1.8, grow: 0.5 });
    E(fx.add, K.FLARE, 1, P, D, { life: 0.14, s0: 12 * S, s1: (46 + 20 * I) * S, c0: [2.4, 3.2, 4.4], c1: [0.6, 1.6, 3.2], mix: 10, a: 0.9, fin: 0.004, fout: 2.3, grow: 0.35, spin: 1 });
    E(fx.add, K.CROSS, 1, P, D, { life: 0.15, l: [22 * S, (78 + 36 * I) * S], w: [6 * S, (13 + 6 * I) * S], c0: [2.3, 3.1, 4.3] });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.18, l: [14 * S, (88 + 40 * I) * S], w: [2.6 * S, 5 * S], c0: [3.4, 3.9, 4.6] });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.23, l: [10 * S, (58 + 28 * I) * S], w: [7 * S, 15 * S], c0: [0.7, 1.9, 3.5], a: 0.8 });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.09, l: [4 * S, 17 * S], w: [10 * S, 23 * S], c0: [1.8, 2.8, 4.0], a: 0.8 });
    // diamenty uderzeniowe w strumieniu jonów
    const dia = [9, 20, 33, 48];
    for (let k = 0; k < dia.length; k++) {
      const sz = (9 - k * 1.5) * S;
      E(fx.add, K.GLOW, 1, off(P, D, dia[k] * S * (0.85 + 0.25 * I)), D, { v: 45 * S, drag: 6, life: 0.06 + k * 0.022, s0: sz * 0.5, s1: sz, c0: [2.6, 3.4, 4.2], c1: [0.4, 1.4, 3.0], mix: 14, a: 0.9 - k * 0.14, fin: 0.004, fout: 1.6, grow: 0.5 });
    }
    // strugi jonów: wąski snop, długie smugi (nie rudzieją)
    const v = [160 * S * (0.7 + 0.4 * I), 460 * S * (0.7 + 0.4 * I)];
    E(fx.spark, K.SPARK, 70 * d, P, D, { cone: 0.07, v, life: [0.25, 0.7], drag: [0.3, 0.9], off: [0, 7 * S], c0: [1.5, 2.6, 3.8], x: [28 * S, 1.05, 1.25, 1.5] });
    E(fx.spark, K.SPARK, 22 * d, P, D, { cone: 0.34, v, life: [0.2, 0.55], drag: [0.3, 0.9], off: [0, 7 * S], c0: [1.5, 2.6, 3.8], x: [22 * S, 1.05, 1.25, 1.3] });
    // łuki: z wylotu na zewnątrz i wstecz po lufie
    E(fx.arc, 0, 11 * d, P, D, { cone: 1.6, v: [7 * S, 24 * S], life: [0.14, 0.34], c0: [1.3, 2.6, 3.9], x: [2.4 * S, 1.4] });
    E(fx.arc, 0, 5, P, neg(D), { cone: 0.45, v: [8 * S, 26 * S], life: [0.08, 0.2], c0: [1.1, 2.2, 3.6], x: [1.8 * S, 1.1] });
    // opar jonowy: cienki welon wzdłuż strzału, chłodny błękit gasnący w granat
    // (fiolet i gęsty kłąb czytały się jak kula przed lufą)
    E(fx.add, K.VAPOR, 12 * d, P, D, { cone: 0.35, v: [20 * S, 70 * S], life: [0.7, 1.5], drag: 1.6, s0: [4 * S, 7 * S], s1: [12 * S, 22 * S], c0: [0.35, 1.05, 1.9], c1: [0.05, 0.12, 0.35], mix: 2.2, a: [0.08, 0.16], fin: 0.04, fout: 1.8, grow: 0.45, spin: 0.7, off: [4 * S, 30 * S] });
    E(fx.add, K.GLOW, 8 * d, off(P, D, 2 * S), D, { cone: 1.1, v: [6 * S, 30 * S], life: [0.5, 1.4], drag: 1.6, s0: [0.5 * S, 1.1 * S], s1: [0.8 * S, 1.9 * S], c0: [1.4, 2.4, 3.6], c1: [0.25, 0.55, 1.3], mix: 1.4, a: 0.85, fin: 0.02, fout: 1.2, grow: 1 });
    // ogon wyrzutu: gasnący strumień jonów, rozgrzana lufa, dogasające łuki
    E(fx.add, K.PLUME, 1, P, D, { life: 0.5, l: [24 * S, (125 + 50 * I) * S], w: [4 * S, 11 * S], c0: [0.28, 0.95, 2.0], a: 0.5, fout: 1.3 });
    E(fx.add, K.GLOW, 1, P, D, { life: 0.65, s0: 7 * S, s1: 11 * S, c0: [0.8, 1.9, 3.2], c1: [0.08, 0.3, 1.0], mix: 3.5, a: 0.55, fin: 0.02, fout: 1.6, grow: 0.8 });
    for (const t of [0.07, 0.15, 0.26]) {
      ctx.after(t, () => {
        E(ctx.fx.arc, 0, 2, P, D, { cone: 1.9, v: [5 * S, 15 * S], life: [0.05, 0.12], c0: [0.9, 2.0, 3.4], x: [1.6 * S, 1.1] });
        E(ctx.fx.spark, K.SPARK, 5, P, D, { cone: 0.5, v: [60 * S, 200 * S], life: [0.15, 0.4], drag: 1, c0: [1.2, 2.2, 3.4], x: [14 * S, 1.05, 1.2, 1.2] });
      });
    }
    E(fx.dist, K.SHOCK, 1, P, D, { life: 0.22, s0: 6 * S, s1: 64 * S, a: 0.7, fin: 0.01, fout: 1.3 });
    E(fx.dist, K.HEAT, 1, off(P, D, 6 * S), D, { v: 12 * S, life: 0.8, s0: 10 * S, s1: 30 * S, a: 0.5, fin: 0.1, fout: 1.5, grow: 0.5 });
    ctx.lights.flash(m.x, m.y, 0.45, 0.8, 1.0, 9 * I, 230 * S, 0.14, { decay: 2, z: 30 });
    ctx.lights.flash(m.x, m.y, 0.3, 0.6, 1.0, 1.4 * I, 140 * S, 0.6, { decay: 1.5, flicker: 0.5, z: 30 });
    ctx.shake(2.5 * m.scale, 0.14);
  },
  projectile(w, m) {
    const I = SIZE_POWER[w.def.size] || 1;
    return {
      style: PSTYLE.ION, color: [0.35, 1.3, 2.6], width: 15 * I, len: 30 * I, streak: 0.0035,
      trailOpts: { style: 'tempest', width: 7 * I, spacing: 36, pathUnit: 170 },
      light: [0.4, 0.8, 1.0, 1.1, 150]
    };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    p.flyAcc += Math.hypot(x1 - x0, y1 - y0);
    if (p.flyAcc < 110) return;
    p.flyAcc = 0;
    const P = scenePos(x1, y1, {});
    const D = sceneVec(p.vx, p.vy);
    E(ctx.fx.arc, 0, 1, P, perp(D), { cone: 2.4, v: [8, 22], life: [0.05, 0.1], c0: [1.2, 2.4, 3.8], x: [3, 1.1] });
    E(ctx.fx.spark, K.SPARK, 2, P, neg(D), { cone: 1.5, v: [60, 200], life: [0.15, 0.35], drag: 1, c0: [1.4, 2.4, 3.6], x: [14, 1.05, 1.2, 1.2] });
  },
  impact(ctx, p, hull, hit) {
    const { fx } = ctx;
    const I = p.power;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    const Din = sceneVec(p.vx, p.vy);
    const R = reflect(Din, N);
    E(fx.add, K.GLOW, 1, P, N, { life: 0.09, s0: 10, s1: 75 * I, c0: [3.2, 3.6, 4.4], c1: [0.6, 1.6, 3.0], mix: 16, fin: 0.004, fout: 2, grow: 0.4 });
    E(fx.add, K.FLARE, 1, P, N, { life: 0.13, s0: 30 * I, s1: 115 * I, c0: [2.4, 3.2, 4.4], c1: [0.4, 1.3, 3.0], mix: 10, a: 0.9, fin: 0.004, fout: 2.3, grow: 0.35, spin: 1 });
    E(fx.add, K.CROSS, 1, P, perp(N), { life: 0.12, l: [30 * I, 150 * I], w: [10 * I, 26 * I], c0: [1.8, 2.8, 4.0], a: 0.8 });
    E(fx.add, K.VAPOR, 10, P, N, { cone: 1.2, v: [20, 90], life: [0.5, 1.2], drag: 1.5, s0: [8, 14], s1: [30 * I, 55 * I], c0: [0.6, 1.6, 2.8], c1: [0.2, 0.1, 0.5], mix: 2, a: [0.25, 0.45], fin: 0.03, fout: 1.5, grow: 0.45, spin: 1 });
    E(fx.spark, K.SPARK, 40 * I, P, R, { cone: 1.0, v: [150, 650], life: [0.25, 0.8], drag: [0.5, 1.4], c0: [2.9, 2.2, 1.4], x: [30, 0.32, 0.06, 1.5], bounce: 0.3 });
    E(fx.spark, K.SPARK, 30 * I, P, N, { cone: 1.4, v: [200, 700], life: [0.2, 0.5], drag: 0.8, c0: [1.5, 2.6, 3.8], x: [24, 1.05, 1.25, 1.3] });
    E(fx.debris, K.CHUNK, 4 * I, P, N, { cone: 1.0, v: [80, 260], life: [0.8, 1.6], drag: 0.4, s0: [1.5, 3], c0: [3, 1.6, 0.6], c1: STEEL, a: 1, spin: 12, x: [1.8] });
    E(fx.smoke, 0, 3, P, N, { cone: 0.8, v: [10, 40], life: [1.2, 2.2], drag: 1.2, s0: [6, 10], s1: [22, 34], c0: [0.25, 0.6, 1.2], c1: [0.22, 0.23, 0.25], a: [0.25, 0.4], fin: 0.05, fout: 1.4, grow: 0.5, spin: 0.6, x: [15, 3] });
    E(fx.dist, K.SHOCK, 1, P, N, { life: 0.28, s0: 6, s1: 130 * I, a: 0.7, fin: 0.01, fout: 1.3 });
    hullArcs(ctx, hull, hit.x, hit.y, Math.round(9 * I), 25 * I, 95 * I, [1.2, 2.4, 3.8]);
    ctx.after(0.07, () => hullArcs(ctx, hull, hit.x, hit.y, Math.round(5 * I), 15 * I, 60 * I, [0.9, 2.0, 3.4], [0.08, 0.2], 5));
    ctx.lights.flash(hit.x, hit.y, 0.55, 0.85, 1.0, 7 * I, 280 * I, 0.16, { decay: 2, z: 40 });
    ctx.lights.flash(hit.x, hit.y, 0.3, 0.65, 1.0, 1.2 * I, 180 * I, 0.7, { decay: 1.5, flicker: 0.8, z: 40 });
    ctx.stamp(hull, hit.x, hit.y, 20 * I, 2.6, 0.5, 0.62, 1.0);
  }
};

// ── VULCAN / GATLING ─────────────────────────────────────────────────────────
RECIPES.vulcan = {
  scale: 1.0,
  muzzle(ctx, m, w) {
    const { fx } = ctx;
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.FLARE, 1, P, D, { life: 0.045, s0: 9 * S, s1: 22 * S, c0: [3.0, 2.2, 1.0], c1: [2.2, 0.9, 0.2], mix: 20, fin: 0.003, fout: 2, grow: 0.3, spin: 2 });
    E(fx.add, K.GLOW, 1, P, D, { life: 0.05, s0: 4 * S, s1: 13 * S, c0: [3.2, 2.6, 1.6], c1: [2.0, 0.8, 0.2], mix: 20, fin: 0.003, fout: 2 });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.05, l: [4 * S, 16 * S], w: [3 * S, 6 * S], c0: [3.0, 1.8, 0.6] });
    E(fx.spark, K.SPARK, 4, P, D, { cone: 0.35, v: [100 * S, 320 * S], life: [0.1, 0.3], drag: 1.2, c0: [2.8, 2.1, 1.2], x: [8 * S, 0.32, 0.06, 1.2] });
    E(fx.smoke, 0, 1, off(P, D, 3 * S), D, { cone: 0.5, v: [10 * S, 30 * S], life: [0.9, 1.6], drag: 1.2, s0: 3 * S, s1: [11 * S, 16 * S], c0: [0.9, 0.45, 0.15], c1: [0.3, 0.29, 0.28], a: [0.1, 0.18], fin: 0.05, fout: 1.3, grow: 0.5, spin: 1, x: [10, 5] });
    E(fx.debris, K.CASING, 1, off(P, D, -24 * m.scale), rot(D, -1.7), { cone: 0.4, v: [45 * S, 85 * S], life: [1.6, 2.4], drag: 0.4, s0: 1.1 * S, c0: [0.2, 0.08, 0.02], c1: BRASS, spin: 16, x: [3] });
    ctx.lights.flash(m.x, m.y, 1.0, 0.7, 0.35, 2.4, 110 * S, 0.05, { decay: 1.5, z: 25 });
    ctx.shake(0.4, 0.06);
  },
  projectile(w) {
    const small = w.def.size === 'S';
    return { style: PSTYLE.TRACER, color: [2.6, 1.45, 0.35], width: small ? 5 : 6.5, len: small ? 12 : 16, streak: 0.006 };
  },
  impact(ctx, p, hull, hit) {
    const { fx } = ctx;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    const R = reflect(sceneVec(p.vx, p.vy), N);
    E(fx.add, K.GLOW, 1, P, N, { life: 0.06, s0: 6, s1: 26, c0: [3.2, 2.4, 1.3], c1: [2, 0.7, 0.15], mix: 20, fin: 0.003, fout: 2 });
    E(fx.spark, K.SPARK, 10, P, R, { cone: 1.1, v: [150, 520], life: [0.15, 0.5], drag: [0.8, 1.6], c0: [2.8, 2.2, 1.3], x: [16, 0.32, 0.06, 1.2], bounce: 0.3 });
    if (Math.random() < 0.35) E(fx.smoke, 0, 1, P, N, { cone: 0.8, v: [8, 30], life: [0.8, 1.6], drag: 1.2, s0: 5, s1: 20, c0: [0.8, 0.4, 0.15], c1: [0.24, 0.23, 0.22], a: 0.3, fin: 0.05, fout: 1.3, grow: 0.5, x: [10, 5] });
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.7, 0.35, 1.6, 90, 0.06, { decay: 1.5, z: 30 });
    ctx.stamp(hull, hit.x, hit.y, 7, 1.5, 0.35, 0.3, 0);
    return ricochet(ctx, p, hit);
  }
};

/** Rykoszet przy płaskim kącie: smugowiec odbija się z iskrą (działka). */
function ricochet(ctx, p, hit) {
  const l = Math.hypot(p.vx, p.vy) || 1;
  const dx = p.vx / l; const dy = p.vy / l;
  const dn = dx * hit.nx + dy * hit.ny;
  if (dn < -0.42 || Math.random() > 0.6) return;
  const rx = dx - 2 * dn * hit.nx; const ry = dy - 2 * dn * hit.ny;
  const a = Math.atan2(ry, rx) + rand(-0.15, 0.15);
  const sp = l * rand(0.35, 0.6);
  ctx.spawnProjectile({
    x: hit.x + hit.nx * 3, y: hit.y + hit.ny * 3, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    style: p.style, color: mulc(p.color, 0.7), width: p.width * 0.8, len: p.len * 0.7, life: rand(0.2, 0.45),
    noHit: true, recipe: null
  });
}

// ── CIĘŻKI AUTOKANON (M, L) ──────────────────────────────────────────────────
RECIPES.autocannon = {
  scale: 1.3,
  muzzle(ctx, m, w) {
    const I = SIZE_POWER[w.def.size] || 1;
    cannonMuzzle(ctx, m, PAL.armata, m.scale * this.scale * 0.8, 0.8 * I, 0.55, { brake: 1.25, casing: 2.0, casingBack: 26 * m.scale / (m.scale * this.scale * 0.8), lightK: 0.7 });
    ctx.shake(1.6 * I, 0.12);
  },
  projectile(w) {
    const I = SIZE_POWER[w.def.size] || 1;
    return { style: PSTYLE.SHELL, color: [2.4, 1.35, 0.45], width: 9 * I, len: 18 * I, streak: 0.004, trailOpts: { style: 'shell', width: 6 * I, spacing: 40, pathUnit: 160 } };
  },
  impact(ctx, p, hull, hit) {
    const I = p.power;
    blast(ctx, hit.x, hit.y, 55 * I, PAL.armata, { normal: sceneVec(hit.nx, hit.ny), cone: 1.5, fire: 6, sparks: 45, debris: 5, smoke: 6, lightK: 0.6 });
    ctx.stamp(hull, hit.x, hit.y, 24 * I, 2.4, 0.8, 0.64, 0);
    ctx.shake(1.2 * I, 0.12);
  }
};

// ── HELIOS (plazma) ──────────────────────────────────────────────────────────
RECIPES.helios = {
  scale: 2.0,
  muzzle(ctx, m, w) {
    const { fx } = ctx;
    const I = SIZE_POWER[w.def.size] || 1;
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.GLOW, 1, P, D, { v: 12 * S, life: 0.08, drag: 8, s0: 5 * S, s1: (14 + 6 * I) * S, c0: [4.0, 2.6, 3.0], c1: [2.6, 0.2, 0.5], mix: 16, fin: 0.003, fout: 2 });
    E(fx.add, K.GLOW, 1, off(P, D, 5 * S), D, { life: 0.24, drag: 4, s0: 8 * S, s1: (26 + 14 * I) * S, c0: [2.0, 0.3, 0.6], c1: [0.6, 0.02, 0.12], mix: 5, a: 0.75, fin: 0.01, fout: 1.8, grow: 0.5 });
    E(fx.add, K.FLARE, 1, P, D, { life: 0.12, s0: 10 * S, s1: (38 + 18 * I) * S, c0: [3.4, 1.4, 1.8], c1: [2.2, 0.15, 0.4], mix: 10, a: 0.9, fin: 0.004, fout: 2.2, grow: 0.35, spin: 1.5 });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.12, l: [8 * S, (46 + 20 * I) * S], w: [3 * S, 6 * S], c0: [3.6, 1.4, 1.8] });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.16, l: [6 * S, (30 + 14 * I) * S], w: [8 * S, 16 * S], c0: [2.2, 0.25, 0.5], a: 0.8 });
    E(fx.add, K.VAPOR, 8, P, D, { cone: 0.6, v: [8 * S, 30 * S], life: [0.6, 1.4], drag: 1.6, s0: 4 * S, s1: [14 * S, 26 * S], c0: [1.4, 0.2, 0.45], c1: [0.3, 0.02, 0.18], mix: 2, a: [0.2, 0.35], fin: 0.05, fout: 1.5, grow: 0.45, spin: 0.8 });
    E(fx.spark, K.SPARK, 22, P, D, { cone: 0.3, v: [120 * S, 380 * S], life: [0.2, 0.5], drag: 1, c0: [3.0, 1.2, 1.4], x: [18 * S, 0.3, 0.45, 1.3] });
    E(fx.dist, K.HEAT, 1, off(P, D, 5 * S), D, { v: 10 * S, life: 0.6, s0: 8 * S, s1: 26 * S, a: 0.5, fin: 0.1, fout: 1.5, grow: 0.5 });
    ctx.lights.flash(m.x, m.y, 1.0, 0.25, 0.35, 6 * I, 180 * S, 0.1, { decay: 2, z: 30 });
    ctx.shake(1.2 * I, 0.1);
  },
  projectile(w) {
    const I = SIZE_POWER[w.def.size] || 1;
    return { style: PSTYLE.BOLT, color: [2.6, 0.22, 0.55], width: 12 * I, len: 55 * I, streak: 0.004, trailOpts: { style: 'helios', width: 5 * I, spacing: 40, pathUnit: 180 }, light: [1.0, 0.25, 0.35, 0.8, 120] };
  },
  impact(ctx, p, hull, hit) {
    const { fx } = ctx;
    const I = p.power;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    E(fx.add, K.GLOW, 1, P, N, { life: 0.08, s0: 10, s1: 70 * I, c0: [4.0, 2.4, 2.6], c1: [2.4, 0.3, 0.3], mix: 16, fin: 0.004, fout: 2 });
    E(fx.add, K.FLARE, 1, P, N, { life: 0.11, s0: 20 * I, s1: 90 * I, c0: [3.2, 1.2, 1.4], c1: [2.0, 0.2, 0.3], mix: 10, a: 0.85, fin: 0.004, fout: 2.2, grow: 0.35, spin: 1 });
    E(fx.add, K.FIRE, 5, P, N, { cone: 1.3, v: [30, 130], life: [0.25, 0.55], drag: 3, s0: 10 * I, s1: [30 * I, 55 * I], c0: [3.2, 1.0, 0.5], c1: [0.8, 0.05, 0.05], mix: 4, a: 0.9, fin: 0.02, fout: 1.3, grow: 0.45, spin: 1.5 });
    E(fx.spark, K.SPARK, 40 * I, P, N, { cone: 1.2, v: [150, 600], life: [0.25, 0.8], drag: [0.6, 1.4], c0: [3.0, 1.6, 0.8], x: [26, 0.3, 0.1, 1.4], bounce: 0.3 });
    E(fx.add, K.VAPOR, 6, P, N, { cone: 1.4, v: [15, 70], life: [0.6, 1.3], drag: 1.5, s0: 8, s1: [26 * I, 44 * I], c0: [1.3, 0.2, 0.35], c1: [0.25, 0.02, 0.12], mix: 2, a: 0.3, fin: 0.04, fout: 1.5, grow: 0.45 });
    E(fx.smoke, 0, 2, P, N, { cone: 1, v: [10, 40], life: [1.2, 2.0], s0: 8, s1: 30, c0: [1.4, 0.3, 0.2], c1: [0.2, 0.19, 0.19], a: 0.35, fin: 0.05, fout: 1.4, grow: 0.5, x: [15, 3] });
    E(fx.dist, K.SHOCK, 1, P, N, { life: 0.25, s0: 6, s1: 100 * I, a: 0.6, fin: 0.01, fout: 1.3 });
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.35, 0.3, 5 * I, 240 * I, 0.14, { decay: 2, z: 40 });
    ctx.stamp(hull, hit.x, hit.y, 18 * I, 2.9, 0.6, 0.5, 0);
  }
};

// ── ARMATA OBLĘŻNICZA ────────────────────────────────────────────────────────
RECIPES.armata = {
  scale: 1.5,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.armata, m.scale * this.scale, 1.0, 1.0, { brake: 1.3, casing: 1.5, casingBack: 22 });
    ctx.shake(5.0 * m.scale, 0.22);
  },
  projectile() {
    return { style: PSTYLE.SHELL, color: [2.8, 1.5, 0.5], width: 13, len: 26, streak: 0.004, trailOpts: { style: 'shell', width: 9, spacing: 40, pathUnit: 150 }, light: [1.0, 0.6, 0.3, 0.8, 140] };
  },
  impact(ctx, p, hull, hit) {
    blast(ctx, hit.x, hit.y, 110, PAL.armata, { normal: sceneVec(hit.nx, hit.ny), cone: 1.7, fire: 12, sparks: 90, debris: 14, smoke: 14 });
    ctx.stamp(hull, hit.x, hit.y, 62, 3.2, 0.95, 0.76, 0);
    ctx.burn(hull, hit.x, hit.y, 2.6, 0.9, PAL.armata);
    ctx.shake(4, 0.25);
  }
};

// ── GOLIATH (autokanon specjalny) ────────────────────────────────────────────
RECIPES.goliath = {
  scale: 1.1,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.goliath, m.scale * this.scale, 1.15, 0.9, { brake: 1.2, casing: 1.4, casingBack: 30 });
    ctx.shake(3.5, 0.2);
  },
  projectile() {
    return { style: PSTYLE.SHELL, color: [3.0, 1.25, 0.3], width: 17, len: 32, streak: 0.004, trailOpts: { style: 'shell', width: 12, spacing: 44, pathUnit: 160 }, light: [1.0, 0.5, 0.2, 0.9, 160] };
  },
  impact(ctx, p, hull, hit) {
    blast(ctx, hit.x, hit.y, 90, PAL.goliath, { normal: sceneVec(hit.nx, hit.ny), cone: 1.6, fire: 9, sparks: 75, debris: 9, smoke: 10 });
    ctx.stamp(hull, hit.x, hit.y, 48, 3.0, 0.9, 0.72, 0);
    if (Math.random() < 0.4) ctx.burn(hull, hit.x, hit.y, 1.6, 0.6, PAL.goliath);
    ctx.shake(2.5, 0.18);
  }
};

// ── YAMATO ───────────────────────────────────────────────────────────────────
RECIPES.yamato = {
  scale: 2.4,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.yamato, m.scale * this.scale, 1.25, 1.0, { brake: 1.35, lightK: 1.6 });
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    // energia działa: łuki i opar jak przy wyładowaniu (nie jonowa iglica)
    E(ctx.fx.arc, 0, 8, P, D, { cone: 1.4, v: [8 * S, 26 * S], life: [0.12, 0.3], c0: [1.3, 2.6, 3.9], x: [2.4 * S, 1.8] });
    E(ctx.fx.add, K.VAPOR, 12, P, D, { cone: 0.8, v: [6 * S, 24 * S], life: [1.2, 2.4], drag: 1.3, s0: 5 * S, s1: [20 * S, 36 * S], c0: [0.4, 1.2, 2.2], c1: [0.1, 0.1, 0.4], mix: 1.5, a: [0.2, 0.34], fin: 0.06, fout: 1.5, grow: 0.45, spin: 0.6 });
    ctx.shake(7.0, 0.30);
  },
  projectile() {
    return { style: PSTYLE.ORB, color: [0.35, 1.45, 1.9], width: 64, len: 150, streak: 0.004, trailOpts: { style: 'yamato', width: 30, spacing: 50, pathUnit: 220 }, light: [0.45, 0.85, 1.0, 3.5, 420] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    p.flyAcc += Math.hypot(x1 - x0, y1 - y0);
    if (p.flyAcc < 140) return;
    p.flyAcc = 0;
    const P = scenePos(x1, y1, {});
    const D = sceneVec(p.vx, p.vy);
    E(ctx.fx.arc, 0, 2, P, neg(D), { cone: 1.2, v: [30, 80], life: [0.06, 0.14], c0: [1.2, 2.6, 3.8], x: [8, 1.6] });
    E(ctx.fx.spark, K.SPARK, 4, P, neg(D), { cone: 0.9, v: [100, 400], life: [0.2, 0.5], drag: 1, c0: [1.6, 2.6, 3.8], x: [30, 1.0, 1.1, 1.4] });
  },
  // Trafienie: port createYamatoImpactFactory (src/effects3d/yamato.js) w skali
  // ekranu gry (tam błysk 1728 j. — tu 760, ogień 160–420 j.), plus światło,
  // fala refrakcji, rana z przestrzeliną i ogień w wyrwie.
  impact(ctx, p, hull, hit) {
    const { fx } = ctx;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    const pal = PAL.yamato;
    E(fx.add, K.GLOW, 1, P, N, { life: 0.16, s0: 60, s1: 420, c0: [2.6, 3.0, 3.8], c1: [0.4, 0.7, 1.0], mix: 8, fin: 0.004, fout: 3, grow: 0.25 });
    E(fx.add, K.CROSS, 1, P, perp(N), { life: 0.5, l: [300, 2000], w: [18, 40], c0: [0.6, 0.85, 1.0].map((c) => c * 3.2), a: 0.9 });
    E(fx.add, K.FLARE, 1, P, N, { life: 0.26, s0: 140, s1: 560, c0: [2.0, 2.7, 3.8], c1: [0.3, 0.9, 2.4], mix: 6, a: 0.75, fin: 0.004, fout: 2.2, grow: 0.3, spin: 0.5 });
    E(fx.add, K.FIRE, 14, P, N, { cone: 2.3, v: [60, 280], life: [0.8, 1.4], drag: 2.2, s0: [50, 100], s1: [130, 300], c0: [1.0, 1.6, 2.5], c1: [0.03, 0.12, 0.4], mix: 1.6, a: [0.7, 1], fin: 0.02, fout: 1.3, grow: 0.4, spin: 1 });
    E(fx.spark, K.SPARK, 90, P, N, { cone: 1.8, v: [840, 3000], life: [0.6, 1.1], drag: [1.5, 3], c0: [2.0, 2.6, 3.4], x: [180, 1.0, 1.15, 2.0], bounce: 0.25 });
    E(fx.spark, K.SPARK, 260, P, N, { cone: 2.0, v: [500, 2400], life: [1.0, 2.2], drag: [0.6, 1.2], c0: [2.6, 2.4, 2.0], x: [60, 0.35, 0.2, 1.4], bounce: 0.3 });
    E(fx.debris, K.CHUNK, 16, P, N, { cone: 1.9, v: [300, 1100], life: [1.2, 2.2], drag: 0.3, s0: [7, 15], c0: [1.2, 1.9, 2.8], c1: STEEL, a: 1, spin: 6, x: [2.6] });
    E(fx.smoke, 0, 18, P, N, { cone: 2.4, v: [60, 220], life: [1.8, 3.2], drag: 1.0, s0: [80, 140], s1: [260, 480], c0: [0.2, 0.45, 0.9], c1: [0.06, 0.08, 0.12], a: [0.45, 0.75], fin: 0.05, fout: 1.2, grow: 0.45, spin: 0.5, x: [80, 3.0] });
    E(fx.dist, K.SHOCK, 1, P, N, { life: 0.55, s0: 60, s1: 1200, a: 1.3, fin: 0.01, fout: 1.1 });
    E(fx.dist, K.HEAT, 4, P, N, { cone: 3, v: [30, 100], life: [1.4, 2.4], s0: 120, s1: 360, a: 0.7, fin: 0.1, fout: 1.5, grow: 0.5 });
    // wtórne wybuchy (jak w demie: 4 w pierwszych 0,45 s)
    const T = [0.08, 0.19, 0.30, 0.43];
    for (const t of T) {
      ctx.after(t + Math.random() * 0.06, () => {
        const a = Math.random() * TAU;
        const r = rand(120, 460);
        const x = hit.x + Math.cos(a) * r + hit.nx * r * 0.4;
        const y = hit.y + Math.sin(a) * r + hit.ny * r * 0.4;
        const Q = scenePos(x, y, {});
        E(fx.add, K.GLOW, 1, Q, N, { life: 0.09, s0: 30, s1: rand(140, 230), c0: [1.6, 2.0, 2.7], c1: [0.3, 0.6, 1.2], mix: 10, fin: 0.004, fout: 2.2, grow: 0.35 });
        E(fx.add, K.FIRE, 6, Q, N, { cone: 3, v: [30, 150], life: [0.5, 1.0], drag: 2.5, s0: 35, s1: [90, 170], c0: pal.fire0, c1: pal.fire1, mix: 2, a: 0.9, fin: 0.02, fout: 1.3, grow: 0.4, spin: 1 });
        E(fx.spark, K.SPARK, 40, Q, N, { cone: 3, v: [400, 1500], life: [0.5, 1.2], drag: 1, c0: [2.0, 2.6, 3.4], x: [70, 1, 1.1, 1.5] });
        E(fx.smoke, 0, 2, Q, N, { cone: 3, v: [20, 80], life: [1.6, 2.6], s0: 80, s1: [220, 360], c0: pal.smokeHot, c1: pal.soot, a: 0.5, fin: 0.05, fout: 1.2, grow: 0.45, x: [60, 1.6] });
        E(fx.dist, K.SHOCK, 1, Q, N, { life: 0.35, s0: 30, s1: rand(300, 500), a: 0.9, fin: 0.01, fout: 1.2 });
        ctx.lights.flash(x, y, 0.5, 0.8, 1.0, 10, 700, 0.18, { decay: 2, z: 60 });
        ctx.stamp(hull, x, y, rand(40, 70), 2.8, 0.9, 0.5, 0.3);
        ctx.shake(3, 0.15);
      });
    }
    ctx.lights.flash(hit.x, hit.y, 0.55, 0.85, 1.0, 18, 1100, 0.3, { decay: 2, z: 80 });
    ctx.lights.flash(hit.x, hit.y, 0.35, 0.65, 1.0, 3, 700, 2.2, { decay: 1.4, flicker: 0.8, z: 60 });
    ctx.stamp(hull, hit.x, hit.y, 130, 3.6, 1.0, 0.9, 0.4);
    ctx.burn(hull, hit.x, hit.y, 3.5, 1.6, pal);
    ctx.shake(12, 0.4);
  }
};

// ── PLAZMOWY GATLING (specjalny) ─────────────────────────────────────────────
RECIPES.plasmaGatling = {
  scale: 1.2,
  muzzle(ctx, m) {
    const { fx } = ctx;
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.GLOW, 1, P, D, { life: 0.08, s0: 6 * S, s1: 24 * S, c0: [2.6, 3.8, 3.8], c1: [0.2, 1.8, 1.8], mix: 14, fin: 0.003, fout: 2 });
    E(fx.add, K.GLOW, 1, off(P, D, 5 * S), D, { life: 0.26, drag: 3, s0: 10 * S, s1: 40 * S, c0: [0.3, 1.8, 1.8], c1: [0.02, 0.3, 0.4], mix: 4, a: 0.75, fin: 0.01, fout: 1.8, grow: 0.5 });
    E(fx.add, K.FLARE, 1, P, D, { life: 0.11, s0: 14 * S, s1: 46 * S, c0: [2.0, 3.6, 3.6], c1: [0.2, 1.6, 1.8], mix: 10, a: 0.85, spin: 2, fin: 0.004, fout: 2.2, grow: 0.35 });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.12, l: [8 * S, 40 * S], w: [6 * S, 13 * S], c0: [0.6, 3.0, 3.0] });
    E(fx.add, K.VAPOR, 8, P, D, { cone: 0.7, v: [10 * S, 40 * S], life: [0.8, 1.6], drag: 1.5, s0: 5 * S, s1: [18 * S, 32 * S], c0: [0.2, 1.3, 1.4], c1: [0.02, 0.15, 0.3], mix: 1.8, a: [0.2, 0.35], fin: 0.05, fout: 1.5, grow: 0.45, spin: 0.8 });
    E(fx.spark, K.SPARK, 20, P, D, { cone: 0.4, v: [120 * S, 360 * S], life: [0.2, 0.5], drag: 1, c0: [1.2, 3.0, 3.0], x: [16 * S, 1.0, 1.0, 1.4] });
    E(fx.arc, 0, 3, P, D, { cone: 1.4, v: [8 * S, 20 * S], life: [0.08, 0.2], c0: [0.8, 2.8, 2.8], x: [2 * S, 1.3] });
    E(fx.dist, K.HEAT, 1, off(P, D, 6 * S), D, { v: 10 * S, life: 0.7, s0: 12 * S, s1: 36 * S, a: 0.55, fin: 0.1, fout: 1.5, grow: 0.5 });
    ctx.lights.flash(m.x, m.y, 0.25, 1.0, 1.0, 6, 220 * S, 0.12, { decay: 2, z: 30 });
    ctx.shake(2.2, 0.12);
  },
  projectile() {
    return { style: PSTYLE.GLOB, color: [0.35, 2.1, 2.1], width: 38, len: 30, streak: 0.004, trailOpts: { style: 'plasmaGlob', width: 14, spacing: 30, pathUnit: 140 }, light: [0.25, 1.0, 1.0, 1.3, 200] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    p.flyAcc += Math.hypot(x1 - x0, y1 - y0);
    if (p.flyAcc < 70) return;
    p.flyAcc = 0;
    const P = scenePos(x1, y1, {});
    const D = sceneVec(p.vx, p.vy);
    E(ctx.fx.add, K.VAPOR, 1, P, neg(D), { cone: 1.2, v: [10, 40], life: [0.3, 0.6], s0: 8, s1: 22, c0: [0.25, 1.5, 1.5], c1: [0.02, 0.2, 0.3], mix: 3, a: 0.4, fin: 0.03, fout: 1.5, grow: 0.5 });
  },
  impact(ctx, p, hull, hit) {
    const { fx } = ctx;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    E(fx.add, K.GLOW, 1, P, N, { life: 0.1, s0: 16, s1: 130, c0: [3.0, 3.8, 3.8], c1: [0.3, 1.6, 1.8], mix: 12, fin: 0.004, fout: 2 });
    E(fx.add, K.FIRE, 7, P, N, { cone: 1.5, v: [40, 160], life: [0.35, 0.7], drag: 3, s0: 16, s1: [44, 80], c0: [1.0, 2.6, 2.8], c1: [0.02, 0.3, 0.6], mix: 3, a: 0.9, fin: 0.02, fout: 1.3, grow: 0.45, spin: 1.2 });
    E(fx.spark, K.SPARK, 45, P, N, { cone: 1.3, v: [200, 700], life: [0.3, 0.8], drag: [0.6, 1.3], c0: [1.2, 3.0, 3.0], x: [30, 1.0, 1.0, 1.5], bounce: 0.3 });
    E(fx.add, K.VAPOR, 8, P, N, { cone: 1.5, v: [20, 90], life: [0.8, 1.6], drag: 1.4, s0: 12, s1: [40, 70], c0: [0.25, 1.4, 1.5], c1: [0.02, 0.15, 0.3], mix: 1.6, a: 0.35, fin: 0.04, fout: 1.5, grow: 0.45 });
    E(fx.dist, K.SHOCK, 1, P, N, { life: 0.3, s0: 10, s1: 180, a: 0.8, fin: 0.01, fout: 1.2 });
    hullArcs(ctx, hull, hit.x, hit.y, 5, 20, 80, [0.8, 2.8, 2.8], [0.1, 0.25], 6);
    ctx.lights.flash(hit.x, hit.y, 0.3, 1.0, 1.0, 8, 360, 0.18, { decay: 2, z: 40 });
    ctx.stamp(hull, hit.x, hit.y, 34, 2.2, 0.55, 0.56, 0.8);
  }
};

// ── HEXLANCE (superbroń wbudowana) ───────────────────────────────────────────
// Port RailgunFX (src/3d/railgunFx3D.js) 1:1 w liczbach (S = 3). W grze wycięto
// płatki sabotu jako bryły i światła punktowe — tu wracają (odłamki GPU, siatka
// świateł).
const HEX_S = 3.0;
const HEX_SPR = 0.10;
function hexCharge(ctx, m, u, dt, S = HEX_S, col = [1.4, 2.6, 3.9], glowCol = null) {
  const { fx } = ctx;
  const P = scenePos(m.x, m.y, {});
  const D = sceneDir(m.angle, {});
  const px = -D.y * 12 * S; const py = D.x * 12 * S;
  const back = 541 * S; const front = 36 * S;
  const rate = (8 + 90 * u * u) * dt;
  const n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const left = Math.random() < 0.5;
    const t = rand(0, 0.9);
    const along = back + (front - back) * t;
    const Q = { x: P.x - D.x * along + (left ? px : -px), y: P.y - D.y * along + (left ? py : -py) };
    E(fx.spark, K.SPARK, 1, Q, D, { v: [500 * S, 1400 * S], life: [0.12, 0.3], drag: 0.2, c0: col, x: [110 * S, 1.05, 1.25, 1.6] });
  }
  ctx._chargeT = (ctx._chargeT ?? 0) - dt;
  if (ctx._chargeT <= 0) {
    ctx._chargeT = 0.16 + (0.02 - 0.16) * u;
    const t = Math.random();
    const along = back + (front - back) * t;
    const A = { x: P.x - D.x * along + px, y: P.y - D.y * along + py };
    const B = { x: P.x - D.x * along - px, y: P.y - D.y * along - py };
    E(fx.arc, 0, 1, A, sceneVec(B.x - A.x, -(B.y - A.y)), { v: Math.hypot(B.x - A.x, B.y - A.y), life: [0.05, 0.16], c0: [1.2 * u + 0.4, 2.3, 3.8], x: [rand(2, 10) * (0.3 + u) * S, 1.6] });
  }
  if (Math.random() < 22 * dt) {
    const g = glowCol || [1.0 + 2.2 * u, 1.8 + 1.8 * u, 2.8 + 1.6 * u];
    E(fx.add, K.FLARE, 1, P, D, { life: 0.11, s0: (16 + 90 * u * u) * S, s1: (12 + 70 * u * u) * S, c0: g, c1: [0.3, 0.9, 1.8], mix: 9, a: 0.3 + 0.6 * u, fin: 0.02, fout: 1.5, grow: 0.7, spin: 2 });
  }
  if (Math.random() < 10 * dt) E(fx.dist, K.HEAT, 1, P, D, { v: 20, life: 0.5, s0: 30 * S * u + 10, s1: 60 * S * u + 20, a: 0.4 * u, fin: 0.1, fout: 1.5, grow: 0.5 });
  const lk = Math.sqrt(S / HEX_S);
  ctx.lights.point(m.x, m.y, 0.45, 0.75, 1.0, (0.8 + 3.5 * u * u) * lk, (120 + 260 * u) * Math.max(0.5, S / 2), 40);
}

function hexFire(ctx, m, S = HEX_S, I = 1, pal = null) {
  const { fx } = ctx;
  const L = 1.0;
  const SPR = HEX_SPR;
  const P = scenePos(m.x, m.y, {});
  const D = sceneDir(m.angle, {});
  const c = pal || {
    core0: [3.8, 4.1, 4.5], core1: [0.8, 1.9, 3.3], halo0: [1.0, 2.1, 3.5], halo1: [0.10, 0.30, 0.85],
    flare0: [3.2, 3.6, 4.4], flare1: [1.0, 2.0, 3.4], cross: [2.5, 3.2, 4.4],
    p1: [3.3, 3.9, 4.7], p2: [0.85, 2.1, 3.7], p3: [0.32, 0.85, 2.1], p4: [2.4, 3.0, 4.2],
    blob0: [2.2, 3.0, 4.2], blob1: [0.22, 0.30, 0.85], streak: [1.7, 2.7, 3.9], arc: [1.4, 2.5, 3.9],
    vap0: [0.55, 1.25, 2.1], vap1: [0.14, 0.09, 0.34], light: [0.5, 0.8, 1.0]
  };
  E(fx.add, K.GLOW, 1, P, D, { v: 220 * S, life: 0.14, drag: 5, s0: 34 * S, s1: (130 + 90 * I) * S, c0: c.core0, c1: c.core1, mix: 13, fin: 0.004, fout: 2.1, grow: 0.38 });
  E(fx.add, K.GLOW, 1, off(P, D, 60 * S), D, { v: 130 * S, life: 0.40, drag: 3.4, s0: 70 * S, s1: (280 + 190 * I) * S, c0: c.halo0, c1: c.halo1, mix: 4.5, a: 0.7, fin: 0.008, fout: 1.9, grow: 0.48 });
  E(fx.add, K.FLARE, 1, P, D, { life: 0.18, s0: 130 * S, s1: (380 + 220 * I) * S, c0: c.flare0, c1: c.flare1, mix: 11, a: 0.95, fin: 0.005, fout: 2.5, grow: 0.35, spin: 0.8 });
  E(fx.add, K.CROSS, 1, P, D, { life: 0.20, l: [240 * S, (880 + 520 * I) * L * S], w: [55 * S, (95 + 55 * I) * S], c0: c.cross });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.30, l: [140 * S, (600 + 340 * I) * L * S], w: [24 * S, 44 * S], c0: c.p1 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.44, l: [100 * S, (410 + 250 * I) * L * S], w: [48 * S, 100 * S], c0: c.p2, a: 0.85 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.62, l: [70 * S, (250 + 160 * I) * L * S], w: [95 * S, 205 * S], c0: c.p3, a: 0.45 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.17, l: [45 * S, 160 * L * S], w: [115 * S, 250 * S], c0: c.p4, a: 0.7 });
  const vk = 0.7 + 0.4 * I;
  E(fx.add, K.GLOW, 44, P, D, { cone: SPR, v: [260 * S * vk, 900 * S * vk], life: [0.3, 0.85], drag: 1.6, off: [0, 60 * S], s0: [10 * S, 26 * S], s1: [50 * S, 130 * S], c0: c.blob0, c1: c.blob1, mix: 3.4, a: [0.4, 0.8], fin: 0.02, fout: 1.8, grow: 0.5, spin: 1.6 });
  E(fx.spark, K.SPARK, 128 * I, P, D, { cone: SPR * 0.8, v: [500 * S * vk, 1900 * S * vk], life: [0.3, 0.9], drag: [0.25, 0.7], off: [0, 80 * S], c0: c.streak, x: [150 * S, 1.05, 1.2, 1.8] });
  E(fx.spark, K.SPARK, 22 * I, P, D, { cone: SPR * 2.4, v: [500 * S * vk, 1900 * S * vk], life: [0.3, 0.9], drag: [0.25, 0.7], off: [0, 80 * S], c0: c.streak, x: [150 * S, 1.05, 1.2, 1.6] });
  // płatki sabotu — w grze były iskrami; tu wracają jako rozżarzone bryły
  E(fx.debris, K.PETAL, 6, off(P, D, 25 * S), D, { cone: SPR * 2.6, v: [160 * S, 420 * S], life: [1.6, 3.0], drag: 0.2, s0: [5 * S, 8 * S], c0: [3.2, 2.0, 0.9], c1: [0.4, 0.38, 0.36], a: 1, spin: 5, x: [0.9] });
  E(fx.arc, 0, 10, P, D, { cone: 0.55, v: [20 * S, 90 * S], life: [0.12, 0.38], c0: c.arc, x: [16 * S, 2.4] });
  E(fx.add, K.VAPOR, 18, P, D, { cone: SPR * 3, v: [30 * S, 150 * S], life: [1.1, 2.6], drag: 0.9, off: [0, 120 * S], s0: [30 * S, 70 * S], s1: [130 * S, 290 * S], c0: c.vap0, c1: c.vap1, mix: 1.3, a: [0.10, 0.24], fin: 0.06, fout: 1.5, grow: 0.45, spin: 0.4 });
  E(fx.dist, K.SHOCK, 1, P, D, { life: 0.5, s0: 40 * S, s1: 520 * S, a: 1.2, fin: 0.01, fout: 1.1 });
  E(fx.dist, K.HEAT, 5, P, D, { cone: SPR * 3, v: [60 * S, 240 * S], life: [0.8, 1.6], off: [0, 200 * S], s0: 50 * S, s1: 130 * S, a: 0.6, fin: 0.1, fout: 1.5, grow: 0.5 });
  const lk = Math.sqrt(S / HEX_S);
  ctx.lights.flash(m.x, m.y, c.light[0], c.light[1], c.light[2], 12 * I * lk, 350 + 350 * S, 0.28, { decay: 2, z: 80 });
  ctx.lights.flash(m.x + Math.cos(m.angle) * 170 * S, m.y + Math.sin(m.angle) * 170 * S, c.light[0], c.light[1], c.light[2], 4 * I * lk, 300 * S, 0.45, { decay: 2, z: 80 });
}

function hexImpact(ctx, x, y, Din, S, I, spark = [2.9, 2.2, 1.4]) {
  const { fx } = ctx;
  const P = scenePos(x, y, {});
  const D = Din;
  E(fx.add, K.GLOW, 1, P, D, { life: 0.16, drag: 5, s0: 30 * S, s1: (180 + 120 * I) * S, c0: [4.0, 3.6, 3.0], c1: [2.4, 0.9, 0.3], mix: 11, fin: 0.004, fout: 2.0, grow: 0.4 });
  E(fx.add, K.CROSS, 1, P, D, { life: 0.2, l: [150 * S, (500 + 300 * I) * S], w: [80 * S, (150 + 70 * I) * S], c0: [3.0, 2.2, 1.4], a: 0.9 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.35, l: [90 * S, (330 + 200 * I) * S], w: [50 * S, 150 * S], c0: [2.8, 1.6, 0.7], a: 0.9 });
  E(fx.add, K.GLOW, 40 * I, P, D, { cone: 0.45, v: [150 * S, 700 * S], life: [0.3, 0.9], drag: 1.8, s0: [8 * S, 20 * S], s1: [40 * S, 110 * S], c0: [2.8, 1.5, 0.55], c1: [0.45, 0.12, 0.03], mix: 3.2, a: [0.45, 0.85], fin: 0.02, fout: 1.8, grow: 0.5, spin: 2 });
  E(fx.spark, K.SPARK, 84 * I, P, D, { cone: 0.5, v: [200 * S, 1000 * S], life: [0.3, 1.0], drag: [0.5, 1.4], c0: spark, x: [70 * S, 0.32, 0.06, 1.7], bounce: 0.3 });
  E(fx.spark, K.SPARK, 36 * I, P, neg(D), { cone: 1.0, v: [80 * S, 400 * S], life: [0.3, 1.0], drag: [0.5, 1.4], c0: spark, x: [70 * S, 0.32, 0.06, 1.6], bounce: 0.3 });
  E(fx.debris, K.CHUNK, 8 * I, P, D, { cone: 0.8, v: [60 * S, 260 * S], life: [1.8, 3.4], drag: 0.25, s0: [4, 9], c0: [3.0, 1.7, 0.7], c1: STEEL, a: 1, spin: 8, x: [0.8] });
  E(fx.smoke, 0, 6 * I, P, neg(D), { cone: 1.4, v: [20, 90], life: [1.8, 3.2], drag: 1.1, s0: 30, s1: [110, 200], c0: [1.8, 0.8, 0.3], c1: [0.2, 0.19, 0.2], a: 0.5, fin: 0.04, fout: 1.3, grow: 0.45, x: [40, 2] });
  E(fx.dist, K.SHOCK, 1, P, D, { life: 0.4, s0: 30, s1: 520 * I, a: 1.0, fin: 0.01, fout: 1.2 });
  ctx.lights.flash(x, y, 1.0, 0.75, 0.5, 16 * I, 800 * I, 0.22, { decay: 2, z: 60 });
}

RECIPES.hexlance = {
  scale: HEX_S,
  charge(ctx, m, u, dt) { hexCharge(ctx, m, u, dt); },
  muzzle(ctx, m) {
    hexFire(ctx, m);
    ctx.shake(14, 0.4);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [1.0, 1.8, 2.8], width: 50, len: 120, streak: 0.002, trailOpts: { style: 'hexlance', width: 90, spacing: 120, pathUnit: 660 }, light: [0.5, 0.8, 1.0, 4, 600], pen: 1e6, speedLoss: 0 };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const S = HEX_S;
    const seg = Math.hypot(x1 - x0, y1 - y0);
    p.flyAcc += seg;
    const step = 180 * S;
    const D = sceneVec(p.vx, p.vy);
    while (p.flyAcc >= step) {
      p.flyAcc -= step;
      const f = seg > 1e-6 ? 1 - p.flyAcc / seg : 1;
      const P = scenePos(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, {});
      E(ctx.fx.spark, K.SPARK, 1, P, rot(D, rand(-1.9, 1.9)), { v: [60 * S, 260 * S], life: [0.25, 0.7], drag: [0.5, 1.4], c0: [2.2, 2.8, 3.8], x: [50 * S, 1.0, 1.1, 1.5] });
    }
    // rozgrzany czubek leci z pociskiem
    E(ctx.fx.add, K.GLOW, 1, scenePos(x1, y1, {}), D, { vel: { x: p.vx, y: -p.vy }, life: 0.05, s0: 120, s1: 96, c0: [3.4, 3.8, 4.6], c1: [1.6, 2.5, 3.8], mix: 12, fin: 0.01, fout: 0.8, grow: 1 });
  },
  impact(ctx, p, hull, hit) {
    hexImpact(ctx, hit.x, hit.y, sceneVec(p.vx, p.vy), HEX_S, 0.85);
    ctx.stamp(hull, hit.x, hit.y, 70, 3.4, 1.0, 0.85, 0.2);
    ctx.shake(8, 0.3);
  },
  kerf(ctx, p, hull, x0, y0) {
    kerf(ctx, p.x, p.y, sceneVec(p.vx, p.vy), HEX_S, 0.7);
    ctx.stamp(hull, p.x, p.y, 34, 3.2, 0.9, 0.85, 0, p.vx, p.vy, 2.2);
    ctx.lights.flash(p.x, p.y, 1.0, 0.7, 0.4, 6, 450, 0.12, { decay: 2, z: 50 });
  },
  exit(ctx, p, hull) {
    exitSpray(ctx, p, 1.2, HEX_S);
  }
};

/** Wylot przestrzeliny: stożek stopionego metalu, ognia i odłamków za kadłubem. */
function exitSpray(ctx, p, I, S = 1) {
  const { fx } = ctx;
  const P = scenePos(p.x, p.y, {});
  const D = sceneVec(p.vx, p.vy);
  E(fx.add, K.GLOW, 1, P, D, { life: 0.14, s0: 20 * S, s1: 140 * S * I, c0: [3.8, 3.2, 2.4], c1: [2.2, 0.8, 0.2], mix: 12, fin: 0.004, fout: 2 });
  E(fx.add, K.PLUME, 1, P, D, { life: 0.3, l: [60 * S, 260 * S * I], w: [30 * S, 110 * S], c0: [2.8, 1.5, 0.6], a: 0.9 });
  E(fx.add, K.FIRE, 8 * I, P, D, { cone: 0.6, v: [100 * S, 400 * S], life: [0.35, 0.8], drag: 2.5, s0: 12 * S, s1: [40 * S, 90 * S], c0: [3.0, 1.5, 0.5], c1: [0.8, 0.15, 0.03], mix: 3, a: 0.9, fin: 0.02, fout: 1.3, grow: 0.45, spin: 1.5 });
  E(fx.spark, K.SPARK, 120 * I, P, D, { cone: 0.55, v: [300 * S, 1400 * S], life: [0.4, 1.1], drag: [0.4, 1.2], c0: [3.0, 2.3, 1.4], x: [80 * S, 0.32, 0.06, 1.7] });
  E(fx.debris, K.CHUNK, 12 * I, P, D, { cone: 0.6, v: [150 * S, 600 * S], life: [1.5, 3], drag: 0.2, s0: [3 * S, 7 * S], c0: [3.0, 1.5, 0.5], c1: STEEL, a: 1, spin: 9, x: [0.9] });
  E(fx.smoke, 0, 6 * I, P, D, { cone: 0.8, v: [40 * S, 160 * S], life: [2, 3.5], drag: 1.2, s0: 20 * S, s1: [70 * S, 140 * S], c0: [1.6, 0.6, 0.2], c1: [0.18, 0.17, 0.17], a: 0.55, fin: 0.04, fout: 1.3, grow: 0.45, x: [40, 2] });
  E(fx.dist, K.SHOCK, 1, P, D, { life: 0.35, s0: 20 * S, s1: 240 * S * I, a: 0.9, fin: 0.01, fout: 1.2 });
  ctx.lights.flash(p.x, p.y, 1.0, 0.65, 0.35, 10 * I, 500 * I, 0.2, { decay: 2, z: 50 });
}

// ── MJOLNIR (oblężniczy railgun) ─────────────────────────────────────────────
const MJ_PAL = {
  core0: [3.6, 4.2, 4.4], core1: [0.9, 2.2, 2.6], halo0: [1.1, 2.3, 2.6], halo1: [0.08, 0.3, 0.5],
  flare0: [3.0, 3.8, 4.2], flare1: [0.9, 2.2, 2.6], cross: [2.6, 3.6, 4.0],
  p1: [3.4, 4.2, 4.6], p2: [0.9, 2.4, 2.8], p3: [0.3, 0.9, 1.3], p4: [2.4, 3.2, 3.6],
  blob0: [2.2, 3.2, 3.6], blob1: [0.2, 0.35, 0.6], streak: [1.8, 3.0, 3.4], arc: [1.4, 2.8, 3.4],
  vap0: [0.55, 1.3, 1.6], vap1: [0.1, 0.12, 0.3], light: [0.55, 0.9, 1.0]
};
RECIPES.mjolnir = {
  scale: 2.4,
  charge(ctx, m, u, dt) {
    hexCharge(ctx, m, u, dt, 1.4 + u, [1.6, 2.8, 3.2], [1.2 + 2.2 * u, 2.2 + 1.8 * u, 2.4 + 1.8 * u]);
    const { fx } = ctx;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    // strumienie energii zbiegające do wylotu z otoczenia
    if (Math.random() < 30 * dt * u) {
      const a = Math.random() * TAU;
      const r = rand(120, 380);
      const Q = { x: P.x + Math.cos(a) * r, y: P.y + Math.sin(a) * r };
      E(fx.arc, 0, 1, Q, { x: (P.x - Q.x) / r, y: (P.y - Q.y) / r }, { v: r, life: [0.06, 0.16], c0: [1.2, 2.6, 3.2], x: [12 + 20 * u, 1.6] });
    }
    ctx.shake(1.5 * u * u, 0.1);
  },
  muzzle(ctx, m) {
    hexFire(ctx, m, 2.4, 1.3, MJ_PAL);
    ctx.shake(18, 0.6);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [1.6, 2.8, 3.0], width: 44, len: 380, streak: 0.001, trailOpts: { style: 'mjolnir', width: 70, spacing: 110, pathUnit: 600 }, light: [0.55, 0.9, 1.0, 5, 700], pen: 1e6, speedLoss: 0 };
  },
  fly: null,
  impact(ctx, p, hull, hit) {
    hexImpact(ctx, hit.x, hit.y, sceneVec(p.vx, p.vy), 2.6, 1.2, [2.6, 3.0, 3.2]);
    ctx.stamp(hull, hit.x, hit.y, 80, 3.8, 1.0, 0.9, 0.5);
    ctx.shake(10, 0.35);
  },
  kerf(ctx, p, hull) {
    kerf(ctx, p.x, p.y, sceneVec(p.vx, p.vy), 2.2, 0.8, [2.6, 2.8, 2.6]);
    ctx.stamp(hull, p.x, p.y, 38, 3.6, 1.0, 0.9, 0.2, p.vx, p.vy, 2.2);
  },
  exit(ctx, p, hull) {
    exitSpray(ctx, p, 1.6, 2.4);
    ctx.shake(8, 0.3);
  }
};

// ── VALKYRIE (railgun specjalny, magenta) ────────────────────────────────────
const VK_PAL = {
  core0: [4.2, 3.2, 4.4], core1: [2.6, 0.5, 2.8], halo0: [2.4, 0.6, 2.6], halo1: [0.5, 0.05, 0.6],
  flare0: [4.0, 2.6, 4.2], flare1: [2.2, 0.4, 2.4], cross: [3.6, 1.8, 3.8],
  p1: [4.0, 3.0, 4.2], p2: [2.4, 0.5, 2.6], p3: [0.9, 0.12, 1.1], p4: [3.0, 1.6, 3.2],
  blob0: [3.0, 1.2, 3.2], blob1: [0.5, 0.05, 0.6], streak: [3.0, 1.4, 3.2], arc: [2.6, 1.2, 3.4],
  vap0: [1.3, 0.3, 1.5], vap1: [0.25, 0.04, 0.35], light: [1.0, 0.35, 1.0]
};
RECIPES.valkyrie = {
  scale: 0.55,
  charge(ctx, m, u, dt) {
    hexCharge(ctx, m, u, dt, 0.35, [2.6, 1.2, 3.2], [2.0 + 2.0 * u, 0.6 + 1.0 * u, 2.2 + 2.0 * u]);
  },
  muzzle(ctx, m) {
    hexFire(ctx, m, 0.42, 0.85, VK_PAL);
    ctx.shake(6, 0.3);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [2.6, 0.45, 2.8], width: 16, len: 110, streak: 0.0015, trailOpts: { style: 'valkyrie', width: 24, spacing: 60, pathUnit: 260 }, light: [1.0, 0.3, 1.0, 1.8, 260], pen: 260, speedLoss: 0.35 };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    p.flyAcc += Math.hypot(x1 - x0, y1 - y0);
    if (p.flyAcc < 200) return;
    p.flyAcc = 0;
    const P = scenePos(x1, y1, {});
    const D = sceneVec(p.vx, p.vy);
    E(ctx.fx.spark, K.SPARK, 3, P, rot(D, rand(-1.9, 1.9)), { v: [80, 300], life: [0.25, 0.6], drag: 1, c0: [2.8, 1.4, 3.0], x: [40, 0.8, 1.1, 1.5] });
  },
  impact(ctx, p, hull, hit) {
    const D = sceneVec(p.vx, p.vy);
    hexImpact(ctx, hit.x, hit.y, D, 0.9, 1.0, [3.0, 1.6, 2.6]);
    hullArcs(ctx, hull, hit.x, hit.y, 6, 30, 110, [2.6, 1.2, 3.4], [0.1, 0.26], 8);
    ctx.stamp(hull, hit.x, hit.y, 40, 3.4, 0.9, 0.8, 0);
    ctx.shake(5, 0.25);
  },
  kerf(ctx, p, hull) {
    kerf(ctx, p.x, p.y, sceneVec(p.vx, p.vy), 0.9, 0.9, [3.0, 1.8, 2.6]);
    ctx.stamp(hull, p.x, p.y, 18, 3.2, 0.8, 0.78, 0, p.vx, p.vy, 2.4);
  },
  exit(ctx, p) { exitSpray(ctx, p, 0.9, 0.9); },
  stuck(ctx, p, hull) {
    blast(ctx, p.x, p.y, 60, PAL.goliath, { cone: 3, fire: 6, sparks: 50, debris: 5, smoke: 5, lightK: 0.6 });
    ctx.stamp(hull, p.x, p.y, 40, 3.2, 0.9, 0.7, 0);
  }
};

// ── WIĄZKA CIĄGŁA ────────────────────────────────────────────────────────────
RECIPES.beamC = {
  beam: { style: BEAM.CONT, width: 8, col: [0.0, 1.6, 1.15], rampUp: 8, rampDown: 3.2 },
  // co klatkę przy włączonej wiązce: soczewka i punkt trafienia
  emit(ctx, m, hit, charge, dt, hull) {
    const { fx } = ctx;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    if (Math.random() < 14 * dt) E(fx.arc, 0, 1, P, D, { cone: 1.8, v: [6, 18], life: [0.05, 0.12], c0: [0.5, 2.6, 2.2], x: [2, 1.2] });
    ctx.lights.point(m.x, m.y, 0.3, 1.0, 0.85, 2.5 * charge, 160, 30);
    if (!hit) return;
    const H = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    const k = charge;
    E(fx.add, K.GLOW, 1, H, N, { life: 0.07, s0: 22 * k, s1: 30 * k, c0: [3.6, 4.0, 3.8], c1: [0.8, 2.4, 2.0], mix: 12, fin: 0.01, fout: 1.5 });
    E(fx.spark, K.SPARK, 380 * dt * k, H, N, { cone: 1.2, v: [180, 720], life: [0.2, 0.75], drag: [0.6, 1.5], c0: [3.0, 2.3, 1.3], x: [26, 0.32, 0.06, 1.4], bounce: 0.3 });
    E(fx.spark, K.SPARK, 60 * dt * k, H, N, { cone: 1.4, v: [120, 400], life: [0.15, 0.35], drag: 1, c0: [1.0, 3.0, 2.6], x: [16, 1.0, 1.0, 1.2] });
    E(fx.smoke, 0, 14 * dt * k, H, N, { cone: 0.6, v: [30, 90], life: [1.4, 2.4], drag: 0.9, s0: 8, s1: [30, 50], c0: [1.6, 0.8, 0.3], c1: [0.2, 0.2, 0.21], a: [0.3, 0.5], fin: 0.05, fout: 1.4, grow: 0.5, spin: 0.8, x: [25, 3] });
    E(fx.add, K.VAPOR, 8 * dt * k, H, N, { cone: 1.1, v: [20, 70], life: [0.5, 1.0], drag: 1.5, s0: 8, s1: [22, 36], c0: [0.2, 1.4, 1.1], c1: [0.02, 0.2, 0.2], mix: 2, a: 0.3, fin: 0.04, fout: 1.5, grow: 0.45 });
    E(fx.dist, K.HEAT, 12 * dt * k, H, N, { cone: 0.8, v: [20, 60], life: [0.6, 1.1], s0: 20, s1: 60, a: 0.6, fin: 0.1, fout: 1.5, grow: 0.5 });
    ctx.lights.point(hit.x, hit.y, 0.7, 1.0, 0.85, 5 * k, 260, 30);
    if (hull) ctx.stamp(hull, hit.x, hit.y, 11, 3.2 * k, 0.12, 0.6 * k, 0);
  }
};

// ── WIĄZKA PULSACYJNA ────────────────────────────────────────────────────────
RECIPES.beamP = {
  beam: { style: BEAM.PULSE, width: 7, col: [2.2, 0.0, 0.18], life: 0.15 },
  muzzle(ctx, m) {
    const { fx } = ctx;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.GLOW, 1, P, D, { life: 0.08, s0: 6, s1: 30, c0: [4.0, 2.0, 2.2], c1: [2.4, 0.1, 0.3], mix: 14, fin: 0.003, fout: 2 });
    E(fx.add, K.FLARE, 1, P, D, { life: 0.1, s0: 12, s1: 44, c0: [3.0, 0.8, 1.0], c1: [2.0, 0.05, 0.2], mix: 10, a: 0.85, spin: 2, fin: 0.004, fout: 2.2, grow: 0.35 });
    E(fx.spark, K.SPARK, 6, P, D, { cone: 0.4, v: [80, 260], life: [0.1, 0.25], drag: 1, c0: [3.0, 0.8, 1.0], x: [10, 0.3, 0.4, 1.2] });
    ctx.lights.flash(m.x, m.y, 1.0, 0.2, 0.3, 4, 160, 0.12, { decay: 2, z: 30 });
    ctx.shake(1.0, 0.1);
  },
  impact(ctx, hull, hit) {
    const { fx } = ctx;
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    E(fx.add, K.GLOW, 1, P, N, { life: 0.1, s0: 10, s1: 80, c0: [4.0, 2.6, 2.6], c1: [2.4, 0.2, 0.3], mix: 14, fin: 0.004, fout: 2 });
    E(fx.add, K.FLARE, 1, P, N, { life: 0.12, s0: 20, s1: 100, c0: [3.2, 1.0, 1.2], c1: [2.0, 0.1, 0.2], mix: 10, a: 0.8, fin: 0.004, fout: 2.2, grow: 0.35, spin: 1 });
    E(fx.spark, K.SPARK, 34, P, N, { cone: 1.2, v: [160, 620], life: [0.2, 0.7], drag: [0.6, 1.4], c0: [3.0, 2.0, 1.1], x: [24, 0.32, 0.08, 1.4], bounce: 0.3 });
    E(fx.smoke, 0, 2, P, N, { cone: 1, v: [15, 50], life: [1.2, 2.0], s0: 8, s1: 28, c0: [1.4, 0.4, 0.2], c1: [0.2, 0.19, 0.19], a: 0.35, fin: 0.05, fout: 1.4, grow: 0.5, x: [15, 3] });
    E(fx.add, K.VAPOR, 3, P, N, { cone: 1.2, v: [15, 50], life: [0.5, 1.0], s0: 8, s1: 30, c0: [1.2, 0.1, 0.25], c1: [0.2, 0.01, 0.08], mix: 2, a: 0.3, fin: 0.04, fout: 1.5, grow: 0.45 });
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.35, 0.3, 6, 240, 0.12, { decay: 2, z: 40 });
    if (hull) ctx.stamp(hull, hit.x, hit.y, 14, 3.0, 0.4, 0.6, 0);
  }
};

// ── LASER PD ─────────────────────────────────────────────────────────────────
RECIPES.laserPD = {
  beam: { style: BEAM.PD, width: 3.2, col: [0.2, 0.9, 2.2], life: 0.09 },
  muzzle(ctx, m) {
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(ctx.fx.add, K.GLOW, 1, P, D, { life: 0.07, s0: 3, s1: 16, c0: [2.2, 3.2, 4.2], c1: [0.2, 0.8, 2.0], mix: 14, fin: 0.003, fout: 2 });
    ctx.lights.flash(m.x, m.y, 0.4, 0.7, 1.0, 1.5, 90, 0.08, { decay: 2, z: 25 });
  },
  impact(ctx, hull, hit) {
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    E(ctx.fx.add, K.GLOW, 1, P, N, { life: 0.07, s0: 5, s1: 30, c0: [3.0, 3.6, 4.2], c1: [0.4, 1.2, 2.4], mix: 14, fin: 0.003, fout: 2 });
    E(ctx.fx.spark, K.SPARK, 12, P, N, { cone: 1.4, v: [160, 360], life: [0.15, 0.35], drag: 1, c0: [2.0, 2.6, 3.4], x: [14, 0.6, 0.9, 1.2] });
    if (hull) ctx.stamp(hull, hit.x, hit.y, 6, 2.2, 0.2, 0.3, 0);
  }
};

// ── CIWS ─────────────────────────────────────────────────────────────────────
RECIPES.ciws = {
  scale: 1.0,
  muzzle(ctx, m) {
    const { fx } = ctx;
    const S = m.scale * this.scale;
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.FLARE, 1, P, D, { life: 0.04, s0: 6 * S, s1: 16 * S, c0: [2.6, 3.2, 2.4], c1: [0.9, 2.2, 1.4], mix: 20, fin: 0.003, fout: 2, grow: 0.3, spin: 3 });
    E(fx.spark, K.SPARK, 2, P, D, { cone: 0.4, v: [100 * S, 300 * S], life: [0.08, 0.2], drag: 1, c0: [2.4, 3.0, 2.0], x: [6 * S, 0.8, 0.5, 1.1] });
    if (Math.random() < 0.3) E(fx.smoke, 0, 1, P, D, { cone: 0.5, v: [8, 24], life: [0.6, 1.1], s0: 2, s1: 9, c0: [0.3, 0.5, 0.35], c1: [0.28, 0.29, 0.28], a: 0.12, fin: 0.05, fout: 1.3, grow: 0.5, x: [6, 5] });
    ctx.lights.flash(m.x, m.y, 0.6, 1.0, 0.75, 1.0, 60, 0.04, { decay: 1.5, z: 20 });
  },
  projectile() {
    return { style: PSTYLE.TRACER, color: [0.9, 2.6, 1.6], width: 3.6, len: 10, streak: 0.006, hitsTargets: true };
  },
  impact(ctx, p, hull, hit) {
    const P = scenePos(hit.x, hit.y, {});
    const N = sceneVec(hit.nx, hit.ny);
    E(ctx.fx.add, K.GLOW, 1, P, N, { life: 0.05, s0: 4, s1: 16, c0: [2.6, 3.0, 2.4], c1: [0.8, 1.6, 1.0], mix: 20, fin: 0.003, fout: 2 });
    E(ctx.fx.spark, K.SPARK, 6, P, N, { cone: 1.2, v: [120, 380], life: [0.1, 0.35], drag: 1, c0: [2.8, 2.4, 1.6], x: [10, 0.32, 0.06, 1.1] });
    ctx.stamp(hull, hit.x, hit.y, 4, 1.2, 0.25, 0.2, 0);
  }
};

// ── FLAK ─────────────────────────────────────────────────────────────────────
const FLAK_PAL = {
  core0: [3.4, 3.0, 2.2], core1: [2.4, 1.0, 0.3], flare0: [3.2, 2.6, 1.6], flare1: [2.2, 0.9, 0.25],
  fire0: [3.0, 1.7, 0.6], fire1: [0.9, 0.22, 0.04], gas0: [2.4, 1.2, 0.45], gas1: [0.5, 0.15, 0.04],
  spark: [2.9, 2.4, 1.6], sparkCool: [0.34, 0.08], smokeHot: [0.9, 0.34, 0.08], soot: [0.035, 0.032, 0.03], light: [1.0, 0.72, 0.4]
};
RECIPES.flak = {
  scale: 1.0,
  muzzle(ctx, m, w) {
    const { fx } = ctx;
    const S = m.scale * this.scale * (w.def.size === 'Capital' ? 1.4 : 1);
    const P = scenePos(m.x, m.y, {});
    const D = sceneDir(m.angle, {});
    E(fx.add, K.GLOW, 1, P, D, { life: 0.07, s0: 5 * S, s1: 22 * S, c0: [3.2, 2.6, 1.6], c1: [2.0, 0.8, 0.2], mix: 16, fin: 0.003, fout: 2 });
    E(fx.add, K.FLARE, 1, P, D, { life: 0.08, s0: 10 * S, s1: 30 * S, c0: [3.0, 2.2, 1.2], c1: [2.0, 0.7, 0.15], mix: 12, a: 0.85, spin: 2, fin: 0.003, fout: 2.2, grow: 0.35 });
    E(fx.add, K.PLUME, 1, P, D, { life: 0.07, l: [4 * S, 18 * S], w: [4 * S, 8 * S], c0: [3.0, 1.8, 0.7] });
    E(fx.spark, K.SPARK, 8, P, D, { cone: 0.4, v: [100 * S, 320 * S], life: [0.12, 0.3], drag: 1, c0: [2.8, 2.2, 1.3], x: [8 * S, 0.32, 0.06, 1.2] });
    E(fx.smoke, 0, 2, P, D, { cone: 0.6, v: [10 * S, 40 * S], life: [1.0, 1.8], drag: 1.2, s0: 3 * S, s1: [12 * S, 20 * S], c0: [1.2, 0.55, 0.2], c1: [0.26, 0.25, 0.24], a: [0.2, 0.3], fin: 0.05, fout: 1.3, grow: 0.5, spin: 1, x: [12, 4] });
    ctx.lights.flash(m.x, m.y, 1.0, 0.7, 0.35, 2.5 * S, 110 * S, 0.07, { decay: 1.5, z: 25 });
    ctx.shake(0.5 * S, 0.08);
  },
  projectile(w) {
    const big = w.def.size === 'Capital' ? 1.4 : w.def.size === 'L' ? 1.15 : 1;
    return { style: PSTYLE.FLAK, color: [2.6, 1.85, 0.75], width: 8 * big, len: 12 * big, streak: 0.008, hitsTargets: true };
  },
  /** Pęknięcie pocisku: R = promień rażenia z MASTER_WEAPONS (95–480 j.). */
  burst(ctx, x, y, R) {
    const { fx } = ctx;
    const P = scenePos(x, y, {});
    const N = { x: 1, y: 0 };
    const s = Math.min(3.2, R / 165);
    const pal = FLAK_PAL;
    E(fx.add, K.GLOW, 1, P, N, { life: 0.08, s0: 0.1 * R, s1: 0.55 * R, c0: pal.core0, c1: pal.core1, mix: 16, fin: 0.003, fout: 2.0, grow: 0.4 });
    E(fx.add, K.FLARE, 1, P, N, { life: 0.12, s0: 0.2 * R, s1: 0.9 * R, c0: pal.flare0, c1: pal.flare1, mix: 10, a: 0.85, spin: 1, fin: 0.004, fout: 2.2, grow: 0.35 });
    E(fx.add, K.FIRE, Math.min(16, 5 + 4 * s), P, N, { cone: Math.PI, flat: 0.25, v: [0.3 * R, 1.3 * R], life: [0.22, 0.5], drag: 3.5, s0: 0.1 * R, s1: [0.2 * R, 0.36 * R], c0: pal.fire0, c1: pal.fire1, mix: 5, a: 0.9, fin: 0.02, fout: 1.3, grow: 0.45, spin: 1.5 });
    // odłamki: smugi po całej kuli rażenia (tak działa flak)
    E(fx.spark, K.SPARK, Math.min(260, 60 + 50 * s), P, N, { cone: Math.PI, flat: 0.3, v: [2.2 * R, 5.4 * R], life: [0.26, 0.62], drag: 2.4, c0: pal.spark, x: [0.18 * R + 20, pal.sparkCool[0], pal.sparkCool[1], 1.6] });
    E(fx.debris, K.CHUNK, Math.min(14, 3 + 3 * s), P, N, { cone: Math.PI, flat: 0.3, v: [0.8 * R, 2.2 * R], life: [0.8, 1.6], drag: 1.2, s0: [1.5, 3], c0: [2.6, 1.3, 0.4], c1: [0.2, 0.2, 0.2], a: 1, spin: 12, x: [2.2] });
    // czarny kłąb flak z ognistym jądrem
    E(fx.smoke, 0, Math.min(12, 4 + 2 * s), P, N, { cone: Math.PI, flat: 0.3, v: [0.08 * R, 0.5 * R], life: [1.6, 3.0], drag: 1.0, s0: [0.16 * R, 0.24 * R], s1: [0.45 * R, 0.8 * R], c0: pal.smokeHot, c1: pal.soot, a: [0.7, 0.92], fin: 0.03, fout: 1.3, grow: 0.4, spin: 0.7, x: [0.15 * R, 5.0] });
    E(fx.dist, K.SHOCK, 1, P, N, { life: 0.35, s0: 0.1 * R, s1: 1.7 * R, a: 0.9, fin: 0.01, fout: 1.2 });
    ctx.lights.flash(x, y, pal.light[0], pal.light[1], pal.light[2], 5 * Math.sqrt(s), R * 2.2, 0.14, { decay: 2, z: 40 });
    ctx.lights.flash(x, y, pal.light[0], pal.light[1] * 0.6, pal.light[2] * 0.3, 1.2 * Math.sqrt(s), R * 1.5, 0.6, { decay: 1.5, flicker: 0.6, z: 40 });
    ctx.shake(0.5 * s, 0.12);
  },
  impact(ctx, p, hull, hit) {
    RECIPES.flak.burst(ctx, hit.x, hit.y, (p.flakR || 150) * 0.6);
    ctx.stamp(hull, hit.x, hit.y, (p.flakR || 150) * 0.2, 2.2, 0.8, 0.5, 0);
  }
};

// ── Ogień w wyrwie (po ciężkim trafieniu) ────────────────────────────────────
export function burnStep(ctx, b, dt) {
  const { fx } = ctx;
  const u = b.age / b.dur;
  const k = b.power * (1 - u) * (1 - u);
  const P = scenePos(b.x, b.y, {});
  const N = b.N;
  E(fx.add, K.FIRE, 26 * dt * k * 3, P, N, { cone: 0.9, v: [20, 70], life: [0.3, 0.6], drag: 2, jit: 14 * b.power, s0: 10 * b.power, s1: [28 * b.power, 46 * b.power], c0: b.pal.fire0, c1: b.pal.fire1, mix: 4, a: 0.85, fin: 0.04, fout: 1.3, grow: 0.45, spin: 1.5 });
  E(fx.smoke, 0, 9 * dt * (0.4 + k), P, N, { cone: 0.7, v: [30, 90], life: [1.8, 3.2], drag: 0.8, jit: 10 * b.power, s0: 14 * b.power, s1: [50 * b.power, 90 * b.power], c0: b.pal.smokeHot, c1: b.pal.soot, a: [0.3, 0.5], fin: 0.06, fout: 1.3, grow: 0.45, spin: 0.5, x: [30, 2.2] });
  E(fx.spark, K.SPARK, 30 * dt * k, P, N, { cone: 1.2, v: [60, 240], life: [0.3, 0.8], drag: 0.8, c0: [2.8, 1.8, 0.8], x: [14, 0.32, 0.06, 1.2] });
  if (Math.random() < 3 * dt) E(fx.dist, K.HEAT, 1, P, N, { v: 30, life: 1.0, s0: 30 * b.power, s1: 80 * b.power, a: 0.5 * k, fin: 0.1, fout: 1.5, grow: 0.5 });
  ctx.lights.point(b.x, b.y, b.pal.light[0], b.pal.light[1] * 0.75, b.pal.light[2] * 0.5, 2.2 * k * (0.75 + 0.25 * Math.sin(b.age * 23 + b.seed)), 220 * b.power, 35);
}

/** Wybuch drona-celu (PD). */
export function droneBlast(ctx, x, y, size = 40) {
  blast(ctx, x, y, size, PAL.armata, { cone: 3.14, fire: 7, sparks: 50, debris: 7, smoke: 5, lightK: 0.5 });
}

export { PAL };
