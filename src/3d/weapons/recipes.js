// src/3d/weapons/recipes.js
//
// Receptury efektów broni (port `dema/bronie-webgpu/recipes.js`, zadanie 17): wylot, pocisk,
// lot, trafienie, rzaz, wylot przestrzeliny, ładowanie, wiązki, pęknięcie flaku, ogień w
// wyrwie. Każda receptura wysyła PACZKI do pul GPU (gpuFx.js), błyski do świateł efektów
// (Core3D.fx.lights → siatka świateł) i wstrząs kamery przez adapter `ctx` fasady
// (weaponFx.js, PROJEKT-BRONI §1.1).
//
// Liczby 1:1 z dema (użytkownik 2026-09-27: „bronie — wszystkie super”). Zmiany pod grę:
//   • bez alokacji na wywołanie: opcje dema (`{ v: [a, b], life: …, c0: … }` i tablice `rng`)
//     → łańcuch budowniczego puli (`E(…).speed(a, b).life(…, …).colors(…).emit()`), punkty i
//     kierunki w obiektach roboczych modułu (demo: `scenePos(x, y, {})`, `off/rot/neg/perp`
//     zwracały nowe obiekty), światła z argumentami pozycyjnymi (FxLights gry);
//   • losowość z generatora warstwy efektów (`fxRandom`), nie z `Math.random` gry;
//   • zdarzenia opóźnione (`ctx.after`) bez domknięć: rodzaj + liczby, obsługa w `runAfter`;
//   • stan ładowania Hexlance'a / Mjolnira / Valkyrie na działo (demo: `ctx._chargeT` —
//     jeden na wszystkie działa);
//   • rykoszet Vulcana kosmetyczny przez `ctx.ricochet` (smugowiec bez trafień, zasady dema:
//     kąt > ~65° od normalnej, szansa 0,6 — decyzję mechaniczną z hasha wpina 18-B);
//   • `ctx.stamp` (mapa ran) w 17 pusty — wywołania zostają dla 18-C.
//
// Wejście w świecie gry (x, y, kąt); scena = (x, −y), kierunek (cos a, −sin a).

import { K } from './gpuFx.js';
import { PSTYLE } from './projectiles.js';
import { TRAIL } from './trails.js';
import { BEAM } from './beams.js';
import { SIZE_POWER } from './weaponFxTable.js';
import { fxRandom } from '../fx/fxRandom.js';

export const Z = 15;
const TAU = Math.PI * 2;
const rand = (a, b) => a + fxRandom.next() * (b - a);

// ---------------------------------------------------------------------------
// Punkty i kierunki w SCENIE (obiekty robocze — receptury czytają je od razu)

const v2 = () => ({ x: 0, y: 0 });
const _P = v2(); const _D = v2(); const _N = v2(); const _R = v2(); const _Q = v2();
const _T = v2(); const _T2 = v2(); const _A = v2(); const _B = v2(); const _H = v2(); const _V = v2();

/** Świat gry → scena. */
function sp(x, y, out) { out.x = x; out.y = -y; return out; }
/** Kąt świata → kierunek sceny. */
function sd(a, out) { out.x = Math.cos(a); out.y = -Math.sin(a); return out; }
/** Wektor świata → kierunek sceny (jednostkowy). */
function sv(dx, dy, out) { const l = Math.sqrt(dx * dx + dy * dy) || 1; out.x = dx / l; out.y = -dy / l; return out; }
function off(P, D, d, out) { out.x = P.x + D.x * d; out.y = P.y + D.y * d; return out; }
function rot(D, a, out) {
  const c = Math.cos(a); const s = Math.sin(a);
  const x = D.x * c - D.y * s; const y = D.x * s + D.y * c;
  out.x = x; out.y = y; return out;
}
function neg(D, out) { out.x = -D.x; out.y = -D.y; return out; }
function perp(D, out) { const x = -D.y; out.y = D.x; out.x = x; return out; }
function reflect(D, N, out) { const d = D.x * N.x + D.y * N.y; out.x = D.x - 2 * d * N.x; out.y = D.y - 2 * d * N.y; return out; }

/**
 * Paczka cząstek: pula, rodzaj, liczba (ułamek zaokrąglany losowo — emitery ciągłe
 * tempo · dt przy 144+ FPS dostają < 1 cząstki na klatkę), punkt i kierunek w SCENIE.
 * Zwraca budowniczego z domyślnymi dema (z = 15, stożek 0 spłaszczony do 0,18) —
 * wołający dokłada opcje i `.emit()`.
 */
function E(pool, kind, n, P, D) {
  return pool.begin(kind, fxRandom.round(n)).at(P.x, P.y).dir(D.x, D.y);
}

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
// Sadza puchu (× 0,85) liczona raz — demo robiło mulc(pal.soot, 0.85) na strzał.
for (const pal of Object.values(PAL)) pal.soot85 = pal.soot.map((c) => c * 0.85);
const BRASS = [0.78, 0.55, 0.22];
const STEEL = [0.30, 0.30, 0.33];
const PAL_KEYS = ['armata', 'yamato', 'goliath', 'flak'];

// ---------------------------------------------------------------------------
// Zdarzenia opóźnione (ctx.after) — rodzaje

export const AFTER = Object.freeze({ TEMPEST_COIL: 1, TEMPEST_TAIL: 2, HULL_ARCS: 3, YAMATO_SECONDARY: 4 });

// ---------------------------------------------------------------------------
// Klocki wspólne

/**
 * Armata prochowa (port fireCannon z dawnego muzzleFx3D.js) + ogień, hamulec wylotowy,
 * łuska, światło, fala. brake — kąt jęzorów hamulca (0 = bez), casing — rozmiar łuski
 * (0 = bez), casingBack — cofnięcie zamka, casingSide — strona wyrzutu, lightK — moc błysku.
 */
function cannonMuzzle(ctx, m, pal, S, I, dens, brake, casing, casingBack, casingSide, lightK) {
  const fx = ctx.fx;
  const P = sp(m.x, m.y, _P);
  const D = sd(m.angle, _D);
  E(fx.add, K.GLOW, 1, P, D).speed(7 * S, 7 * S).life(0.085, 0.085).drag(7, 7).s0(4 * S, 4 * S).s1((11 + 7 * I) * S, (11 + 7 * I) * S).colors(pal.core0, pal.core1).mix(16).fade(0.004, 2.2).grow(0.4).emit();
  E(fx.add, K.GLOW, 1, off(P, D, 3 * S, _T), D).life(0.21, 0.21).drag(5, 5).s0(7 * S, 7 * S).s1((22 + 14 * I) * S, (22 + 14 * I) * S).colors(pal.halo0, pal.halo1).mix(7).alpha(0.8, 0.8).fade(0.01, 2.0).grow(0.5).emit();
  E(fx.add, K.FLARE, 1, P, D).life(0.13, 0.13).s0((14 + 6 * I) * S, (14 + 6 * I) * S).s1((46 + 30 * I) * S, (46 + 30 * I) * S).colors(pal.flare0, pal.flare1).mix(12).alpha(0.95, 0.95).fade(0.005, 2.4).grow(0.35).spin(0.8).emit();
  E(fx.add, K.CROSS, 1, P, D).life(0.10, 0.10).s0(14 * S, (40 + 24 * I) * S).s1(8 * S, (17 + 8 * I) * S).colors(pal.cross).alpha(0.95, 0.95).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.105, 0.105).s0(5 * S, (26 + 16 * I) * S).s1(5 * S, 9.5 * S).colors(pal.plumeOuter).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.075, 0.075).s0(4 * S, (12 + 5 * I) * S).s1(9 * S, 18 * S).colors(pal.plumeInner).alpha(0.85, 0.85).emit();
  // hamulec wylotowy: dwa boczne jęzory odchylone do tyłu
  if (brake) {
    for (let s = -1; s <= 1; s += 2) {
      const Q = off(P, D, -3 * S, _Q);
      const R = rot(D, s * brake, _R);
      E(fx.add, K.PLUME, 1, Q, R).life(0.09, 0.09).s0(3 * S, 18 * S * I).s1(3 * S, 8 * S).colors(pal.plumeOuter).alpha(0.9, 0.9).emit();
      E(fx.smoke, 0, 3 * dens, Q, R).cone(0.35, 0.18).speed(20 * S, 55 * S).life(1.0, 2.0).drag(1.6, 1.6).s0(3 * S, 5 * S).s1(12 * S, 22 * S).colors(pal.smokeHot, pal.soot).alpha(0.3, 0.5).fade(0.04, 1.4).grow(0.45).spin(1).x01(20 * S, 3.5).emit();
    }
  }
  // kula ognia prochowego (szum, stygnie z bieli w czerwień)
  E(fx.add, K.FIRE, 6 * dens, P, D).cone(0.45, 0.18).speed(30 * S, 110 * S).life(0.16, 0.36).drag(4, 4).s0(5 * S, 9 * S).s1(15 * S, 30 * S * I).colors(pal.fire0, pal.fire1).mix(6).alpha(0.7, 1.0).fade(0.02, 1.3).grow(0.45).spin(2).offset(0, 8 * S).emit();
  const gk = 0.8 + 0.4 * I;
  E(fx.add, K.GLOW, 10 * dens, P, D).cone(0.55, 0.18).speed(14 * S, 48 * S).life(0.22, 0.52).drag(3.4, 3.4).s0(2 * S, 5 * S).s1(9 * S * gk, 19 * S * gk).colors(pal.gas0, pal.gas1).mix(4.5).alpha(0.45, 0.8).fade(0.02, 1.9).grow(0.5).spin(2.2).offset(0, 4 * S).emit();
  // dym: gorący na starcie, stygnie do sadzy; oświetla go błysk
  E(fx.smoke, 0, 18 * dens, P, D).cone(0.62, 0.18).speed(5 * S, 26 * S).life(1.6, 3.2).drag(1.15, 1.15).s0(3 * S, 7 * S).s1(15 * S, 32 * S).colors(pal.smokeHot, pal.soot).alpha(0.4, 0.7).fade(0.05, 1.35).grow(0.45).spin(0.9).offset(0, 6 * S).jitter(2 * S, 0).x01(22 * S, 3.2).emit();
  E(fx.smoke, 0, 5 * dens, P, D).cone(0.85, 0.18).speed(2 * S, 10 * S).life(2.6, 4.4).drag(0.85, 0.85).s0(8 * S, 14 * S).s1(32 * S, 52 * S).colors(pal.puffHot, pal.soot85).alpha(0.16, 0.30).fade(0.12, 1.6).grow(0.5).spin(0.4).offset(0, 9 * S).x01(16 * S, 2.0).emit();
  // iskry: 82% wąski snop, 18% wolne i szerokie
  const vk = 0.75 + 0.35 * I;
  E(fx.spark, K.SPARK, 57 * dens, P, D).cone(0.30, 0.18).speed(40 * S * vk, 175 * S * vk).life(0.3, 1.0).drag(0.5, 1.4).offset(0, 5 * S).colors(pal.spark).x01(9 * S, pal.sparkCool[0]).x23(pal.sparkCool[1], 1.5).emit();
  E(fx.spark, K.SPARK, 13 * dens, P, D).cone(0.85, 0.18).speed(8 * S * vk, 45 * S * vk).life(0.3, 1.0).drag(0.5, 1.4).offset(0, 5 * S).colors(pal.spark).x01(6 * S, pal.sparkCool[0]).x23(pal.sparkCool[1], 1.3).emit();
  E(fx.add, K.GLOW, 10 * dens, off(P, D, 3 * S, _T), D).cone(0.7, 0.18).speed(10 * S, 52 * S).life(0.8, 2.2).drag(1.5, 1.5).s0(0.6 * S, 1.2 * S).s1(0.9 * S, 2.2 * S).colors(pal.ember0, pal.ember1).mix(1.6).alpha(0.9, 0.9).fade(0.02, 1.2).grow(1.0).emit();
  // fala i drganie powietrza (sama refrakcja)
  E(fx.dist, K.SHOCK, 1, P, D).life(0.3, 0.3).s0(8 * S, 8 * S).s1((70 + 40 * I) * S, (70 + 40 * I) * S).alpha(0.85, 0.85).fade(0.01, 1.2).emit();
  E(fx.dist, K.HEAT, 2, off(P, D, 6 * S, _T), D).cone(0.6, 0.18).speed(8 * S, 24 * S).life(0.7, 1.3).s0(10 * S, 10 * S).s1(34 * S, 34 * S).alpha(0.55, 0.55).fade(0.1, 1.5).grow(0.5).emit();
  // łuska z zamka
  if (casing) {
    const side = rot(D, (casingSide || 1) * 1.75, _R);
    E(fx.debris, K.CASING, 1, off(P, D, -casingBack * S, _Q), side).cone(0.35, 0.18).speed(40 * S, 80 * S).life(2.5, 3.5).drag(0.35, 0.35).s0(casing * S, casing * S).s1(casing * S, casing * S).color(0.25, 0.1, 0.02).color1(BRASS[0], BRASS[1], BRASS[2]).alpha(1, 1).spin(12).x01(2.5, 0).emit();
  }
  const lk = lightK || 1;
  const lr = Math.min(620, (150 + 60 * I) * S);
  const L = ctx.lights;
  L.flash(m.x, m.y, pal.light[0], pal.light[1], pal.light[2], 5 * I * lk, lr, 0.14, 2, 0, 30);
  L.flash(m.x, m.y, pal.light[0], pal.light[1] * 0.8, pal.light[2] * 0.6, 1.0 * I * lk, lr * 0.6, 0.6, 1.4, 0.5, 30);
}

/**
 * Wybuch pocisku (armata, goliath, ciężki autokanon, flak, zestrzelona rakieta): ogień,
 * iskry, odłamki, dym, fala. N — normalna w scenie (null = w górę sceny).
 */
function blast(ctx, x, y, R, pal, N, cone, fire, sparks, debris, smoke, lightK, sparkCone = 1.5) {
  const fx = ctx.fx;
  const P = sp(x, y, _P);
  if (!N) { _N.x = 0; _N.y = 1; N = _N; }
  const k = R / 100;
  E(fx.add, K.GLOW, 1, P, N).life(0.09, 0.09).s0(18 * k, 18 * k).s1(150 * k, 150 * k).color(3.6, 3.0, 2.2).color1(pal.core1[0], pal.core1[1], pal.core1[2]).mix(14).fade(0.004, 2.0).grow(0.4).emit();
  E(fx.add, K.FLARE, 1, P, N).life(0.14, 0.14).s0(40 * k, 40 * k).s1(200 * k, 200 * k).colors(pal.flare0, pal.flare1).mix(10).alpha(0.85, 0.85).fade(0.004, 2.3).grow(0.35).spin(1).emit();
  E(fx.add, K.FIRE, fire, P, N).cone(cone, 0.18).speed(40 * k, 190 * k).life(0.35, 0.75).drag(3.2, 3.2).s0(14 * k, 24 * k).s1(45 * k, 100 * k).colors(pal.fire0, pal.fire1).mix(3).alpha(0.7, 1).fade(0.02, 1.3).grow(0.4).spin(1.5).emit();
  E(fx.add, K.GLOW, 8, P, N).cone(2.4, 0.18).speed(20 * k, 80 * k).life(0.25, 0.5).drag(3, 3).s0(10 * k, 10 * k).s1(50 * k, 50 * k).colors(pal.gas0, pal.gas1).mix(4).alpha(0.6, 0.6).fade(0.02, 1.8).grow(0.5).emit();
  E(fx.spark, K.SPARK, sparks, P, N).cone(sparkCone, 0.18).speed(260 * k, 1000 * k).life(0.3, 1.0).drag(0.6, 1.5).colors(pal.spark).x01(55 * k, pal.sparkCool[0]).x23(pal.sparkCool[1], 1.5).bounce(0.3).emit();
  E(fx.debris, K.CHUNK, debris, P, N).cone(1.6, 0.18).speed(120 * k, 480 * k).life(1.4, 2.8).drag(0.3, 0.3).s0(2 * k, 5.5 * k).s1(2 * k, 5.5 * k).color(2.8, 1.2, 0.35).color1(STEEL[0], STEEL[1], STEEL[2]).alpha(1, 1).spin(10).x01(1.1, 0).emit();
  E(fx.smoke, 0, smoke, P, N).cone(2.4, 0.18).speed(20 * k, 120 * k).life(2.2, 4.2).drag(1.1, 1.1).s0(20 * k, 34 * k).s1(70 * k, 150 * k).colors(pal.smokeHot, pal.soot).alpha(0.45, 0.75).fade(0.04, 1.3).grow(0.45).spin(0.6).x01(40 * k, 2.2).emit();
  E(fx.dist, K.SHOCK, 1, P, N).life(0.42, 0.42).s0(20 * k, 20 * k).s1(420 * k, 420 * k).alpha(1.0, 1.0).fade(0.01, 1.1).emit();
  E(fx.dist, K.HEAT, 3, P, N).cone(3, 0.18).speed(10 * k, 40 * k).life(1.0, 1.8).s0(40 * k, 40 * k).s1(120 * k, 120 * k).alpha(0.6, 0.6).fade(0.1, 1.5).grow(0.5).emit();
  const k2 = Math.min(2, k);
  ctx.lights.flash(x, y, pal.light[0], pal.light[1], pal.light[2], 14 * (lightK || 1) * k2, 360 * k + 200, 0.22, 2, 0, 50);
  ctx.lights.flash(x, y, pal.light[0], pal.light[1] * 0.7, pal.light[2] * 0.4, 3 * k2, 260 * k + 120, 1.3, 1.3, 0.7, 50);
}

/** Rzaz / wejście pocisku przebijającego (port RailgunFX.kerf, bez krzyża). D — kierunek w scenie. */
function kerf(ctx, x, y, D, S, I, spark) {
  const fx = ctx.fx;
  const P = sp(x, y, _H);
  E(fx.add, K.GLOW, 1, P, D).life(0.13, 0.13).drag(6, 6).s0(22 * S, 22 * S).s1((90 + 60 * I) * S, (90 + 60 * I) * S).color(3.6, 3.0, 2.2).color1(2.0, 0.7, 0.2).mix(12).alpha(0.9, 0.9).fade(0.004, 2.2).grow(0.4).emit();
  E(fx.spark, K.SPARK, 25 * I, P, neg(D, _T2)).cone(1.2, 0.18).speed(120 * S, 620 * S).life(0.25, 0.8).drag(0.6, 1.5).colors(spark).x01(60 * S, 0.32).x23(0.06, 1.6).emit();
  E(fx.spark, K.SPARK, 20 * I, P, D).cone(0.6, 0.18).speed(200 * S, 900 * S).life(0.25, 0.8).drag(0.6, 1.5).colors(spark).x01(60 * S, 0.32).x23(0.06, 1.6).emit();
}

/**
 * Łuki po poszyciu wokół trafienia (Tempest, plazma, Valkyrie): końce na kadłubie
 * (ctx.hullInside — HullBodies.probe, tylko odczyt). life0/life1 — życie łuku, jit — amplituda.
 */
function hullArcs(ctx, hull, x, y, n, rMin, rMax, col, life0 = 0.12, life1 = 0.34, jit = 6) {
  const fx = ctx.fx;
  for (let i = 0; i < n; i++) {
    let tx = x; let ty = y;
    for (let tries = 0; tries < 6; tries++) {
      const a = fxRandom.next() * TAU;
      const r = rand(rMin, rMax);
      tx = x + Math.cos(a) * r; ty = y + Math.sin(a) * r;
      if (!hull || ctx.hullInside(hull, tx, ty)) break;
    }
    const P = sp(x, y, _A);
    const dx = tx - x; const dy = ty - y;
    const D = sv(dx, dy, _B);
    E(fx.arc, 0, 1, P, D).speed(Math.sqrt(dx * dx + dy * dy), Math.sqrt(dx * dx + dy * dy)).life(life0, life1).colors(col).x01(jit, 1.4).z(17).emit();
  }
}

// ---------------------------------------------------------------------------
// RODZINY

export const RECIPES = {};

// Barwy łuków i iskier Tempesta (stałe — bez tablic na wywołanie)
const T_ARC = [1.2, 2.4, 3.8];
const T_ARC2 = [0.9, 2.0, 3.4];
const T_ARC_TAIL = [0.9, 2.0, 3.4];
const T_SPK_TAIL = [1.2, 2.2, 3.4];

// ── TEMPEST ION ──────────────────────────────────────────────────────────────
// Sekwencja cewek wzdłuż lufy, diamenty uderzeniowe w strumieniu jonów, łuki po lufie,
// pierścień refrakcji, igła z helisą łuków w locie, łuki EMP po kadłubie przy trafieniu.
RECIPES.tempest = {
  scale: 1.7,
  leadIn: 0.03,
  preFire(ctx, m) {
    const S = m.scale * this.scale;
    const len = 30 * m.scale;
    for (let k = 0; k < 3; k++) {
      // cewka k: punkt na lufie (świat), kierunek — kąt lufy
      ctx.after(k * 0.009, AFTER.TEMPEST_COIL, m.x, m.y, m.angle, S, len * (0.85 - k * 0.3), 0, null);
    }
  },
  muzzle(ctx, m, w) {
    const fx = ctx.fx;
    const I = SIZE_POWER[w.size] || 1;
    const S = m.scale * this.scale;
    const d = Math.min(1, 0.6 + 0.4 * I);
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.GLOW, 1, P, D).speed(10 * S, 10 * S).life(0.1, 0.1).drag(8, 8).s0(6 * S, 6 * S).s1((16 + 10 * I) * S, (16 + 10 * I) * S).color(3.2, 3.6, 4.2).color1(0.5, 1.7, 3.0).mix(18).fade(0.003, 2.0).grow(0.38).emit();
    E(fx.add, K.GLOW, 1, off(P, D, 4 * S, _T), D).life(0.32, 0.32).drag(4.2, 4.2).s0(8 * S, 8 * S).s1((30 + 20 * I) * S, (30 + 20 * I) * S).color(0.85, 2.1, 3.4).color1(0.1, 0.4, 1.1).mix(5.5).alpha(0.8, 0.8).fade(0.008, 1.8).grow(0.5).emit();
    E(fx.add, K.FLARE, 1, P, D).life(0.14, 0.14).s0(12 * S, 12 * S).s1((46 + 20 * I) * S, (46 + 20 * I) * S).color(2.4, 3.2, 4.4).color1(0.6, 1.6, 3.2).mix(10).alpha(0.9, 0.9).fade(0.004, 2.3).grow(0.35).spin(1).emit();
    E(fx.add, K.CROSS, 1, P, D).life(0.15, 0.15).s0(22 * S, (78 + 36 * I) * S).s1(6 * S, (13 + 6 * I) * S).color(2.3, 3.1, 4.3).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.18, 0.18).s0(14 * S, (88 + 40 * I) * S).s1(2.6 * S, 5 * S).color(3.4, 3.9, 4.6).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.23, 0.23).s0(10 * S, (58 + 28 * I) * S).s1(7 * S, 15 * S).color(0.7, 1.9, 3.5).alpha(0.8, 0.8).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.09, 0.09).s0(4 * S, 17 * S).s1(10 * S, 23 * S).color(1.8, 2.8, 4.0).alpha(0.8, 0.8).emit();
    // diamenty uderzeniowe w strumieniu jonów
    for (let k = 0; k < 4; k++) {
      const dk = k === 0 ? 9 : k === 1 ? 20 : k === 2 ? 33 : 48;
      const sz = (9 - k * 1.5) * S;
      E(fx.add, K.GLOW, 1, off(P, D, dk * S * (0.85 + 0.25 * I), _T), D).speed(45 * S, 45 * S).drag(6, 6).life(0.06 + k * 0.022, 0.06 + k * 0.022).s0(sz * 0.5, sz * 0.5).s1(sz, sz).color(2.6, 3.4, 4.2).color1(0.4, 1.4, 3.0).mix(14).alpha(0.9 - k * 0.14, 0.9 - k * 0.14).fade(0.004, 1.6).grow(0.5).emit();
    }
    // strugi jonów: wąski snop, długie smugi (nie rudzieją)
    const va = 160 * S * (0.7 + 0.4 * I); const vb = 460 * S * (0.7 + 0.4 * I);
    E(fx.spark, K.SPARK, 70 * d, P, D).cone(0.07, 0.18).speed(va, vb).life(0.25, 0.7).drag(0.3, 0.9).offset(0, 7 * S).color(1.5, 2.6, 3.8).x01(28 * S, 1.05).x23(1.25, 1.5).emit();
    E(fx.spark, K.SPARK, 22 * d, P, D).cone(0.34, 0.18).speed(va, vb).life(0.2, 0.55).drag(0.3, 0.9).offset(0, 7 * S).color(1.5, 2.6, 3.8).x01(22 * S, 1.05).x23(1.25, 1.3).emit();
    // łuki: z wylotu na zewnątrz i wstecz po lufie
    E(fx.arc, 0, 11 * d, P, D).cone(1.6, 0.18).speed(7 * S, 24 * S).life(0.14, 0.34).color(1.3, 2.6, 3.9).x01(2.4 * S, 1.4).emit();
    E(fx.arc, 0, 5, P, neg(D, _T)).cone(0.45, 0.18).speed(8 * S, 26 * S).life(0.08, 0.2).color(1.1, 2.2, 3.6).x01(1.8 * S, 1.1).emit();
    // opar jonowy: cienki welon wzdłuż strzału, chłodny błękit gasnący w granat
    E(fx.add, K.VAPOR, 12 * d, P, D).cone(0.35, 0.18).speed(20 * S, 70 * S).life(0.7, 1.5).drag(1.6, 1.6).s0(4 * S, 7 * S).s1(12 * S, 22 * S).color(0.35, 1.05, 1.9).color1(0.05, 0.12, 0.35).mix(2.2).alpha(0.08, 0.16).fade(0.04, 1.8).grow(0.45).spin(0.7).offset(4 * S, 30 * S).emit();
    E(fx.add, K.GLOW, 8 * d, off(P, D, 2 * S, _T), D).cone(1.1, 0.18).speed(6 * S, 30 * S).life(0.5, 1.4).drag(1.6, 1.6).s0(0.5 * S, 1.1 * S).s1(0.8 * S, 1.9 * S).color(1.4, 2.4, 3.6).color1(0.25, 0.55, 1.3).mix(1.4).alpha(0.85, 0.85).fade(0.02, 1.2).grow(1).emit();
    // ogon wyrzutu: gasnący strumień jonów, rozgrzana lufa, dogasające łuki
    E(fx.add, K.PLUME, 1, P, D).life(0.5, 0.5).s0(24 * S, (125 + 50 * I) * S).s1(4 * S, 11 * S).color(0.28, 0.95, 2.0).alpha(0.5, 0.5).fade(0.06, 1.3).emit();
    E(fx.add, K.GLOW, 1, P, D).life(0.65, 0.65).s0(7 * S, 7 * S).s1(11 * S, 11 * S).color(0.8, 1.9, 3.2).color1(0.08, 0.3, 1.0).mix(3.5).alpha(0.55, 0.55).fade(0.02, 1.6).grow(0.8).emit();
    ctx.after(0.07, AFTER.TEMPEST_TAIL, m.x, m.y, m.angle, S, 0, 0, null);
    ctx.after(0.15, AFTER.TEMPEST_TAIL, m.x, m.y, m.angle, S, 0, 0, null);
    ctx.after(0.26, AFTER.TEMPEST_TAIL, m.x, m.y, m.angle, S, 0, 0, null);
    E(fx.dist, K.SHOCK, 1, P, D).life(0.22, 0.22).s0(6 * S, 6 * S).s1(64 * S, 64 * S).alpha(0.7, 0.7).fade(0.01, 1.3).emit();
    E(fx.dist, K.HEAT, 1, off(P, D, 6 * S, _T), D).speed(12 * S, 12 * S).life(0.8, 0.8).s0(10 * S, 10 * S).s1(30 * S, 30 * S).alpha(0.5, 0.5).fade(0.1, 1.5).grow(0.5).emit();
    ctx.lights.flash(m.x, m.y, 0.45, 0.8, 1.0, 9 * I, 230 * S, 0.14, 2, 0, 30);
    ctx.lights.flash(m.x, m.y, 0.3, 0.6, 1.0, 1.4 * I, 140 * S, 0.6, 1.5, 0.5, 30);
    ctx.shake(2.5 * m.scale, 0.14);
  },
  projectile(size) {
    const I = SIZE_POWER[size] || 1;
    return { style: PSTYLE.ION, color: [0.35, 1.3, 2.6], width: 15 * I, len: 30 * I, streak: 0.0035,
      trail: TRAIL.tempest, trailWidth: 7 * I, trailSpacing: 36, trailPathUnit: 170, light: [0.4, 0.8, 1.0, 1.1, 150] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const ddx = x1 - x0; const ddy = y1 - y0;
    p.flyAcc += Math.sqrt(ddx * ddx + ddy * ddy);
    if (p.flyAcc < 110) return;
    p.flyAcc = 0;
    const P = sp(x1, y1, _P);
    const D = sv(p.rvx, p.rvy, _D);
    E(ctx.fx.arc, 0, 1, P, perp(D, _T)).cone(2.4, 0.18).speed(8, 22).life(0.05, 0.1).colors(T_ARC).x01(3, 1.1).emit();
    E(ctx.fx.spark, K.SPARK, 2, P, neg(D, _T)).cone(1.5, 0.18).speed(60, 200).life(0.15, 0.35).drag(1, 1).color(1.4, 2.4, 3.6).x01(14, 1.05).x23(1.2, 1.2).emit();
  },
  impact(ctx, p, hull, hit) {
    const fx = ctx.fx;
    const I = p.power;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    const Din = sv(p.vx, p.vy, _D);
    const R = reflect(Din, N, _R);
    E(fx.add, K.GLOW, 1, P, N).life(0.09, 0.09).s0(10, 10).s1(75 * I, 75 * I).color(3.2, 3.6, 4.4).color1(0.6, 1.6, 3.0).mix(16).fade(0.004, 2).grow(0.4).emit();
    E(fx.add, K.FLARE, 1, P, N).life(0.13, 0.13).s0(30 * I, 30 * I).s1(115 * I, 115 * I).color(2.4, 3.2, 4.4).color1(0.4, 1.3, 3.0).mix(10).alpha(0.9, 0.9).fade(0.004, 2.3).grow(0.35).spin(1).emit();
    E(fx.add, K.CROSS, 1, P, perp(N, _T)).life(0.12, 0.12).s0(30 * I, 150 * I).s1(10 * I, 26 * I).color(1.8, 2.8, 4.0).alpha(0.8, 0.8).emit();
    E(fx.add, K.VAPOR, 10, P, N).cone(1.2, 0.18).speed(20, 90).life(0.5, 1.2).drag(1.5, 1.5).s0(8, 14).s1(30 * I, 55 * I).color(0.6, 1.6, 2.8).color1(0.2, 0.1, 0.5).mix(2).alpha(0.25, 0.45).fade(0.03, 1.5).grow(0.45).spin(1).emit();
    E(fx.spark, K.SPARK, 40 * I, P, R).cone(1.0, 0.18).speed(150, 650).life(0.25, 0.8).drag(0.5, 1.4).color(2.9, 2.2, 1.4).x01(30, 0.32).x23(0.06, 1.5).bounce(0.3).emit();
    E(fx.spark, K.SPARK, 30 * I, P, N).cone(1.4, 0.18).speed(200, 700).life(0.2, 0.5).drag(0.8, 0.8).color(1.5, 2.6, 3.8).x01(24, 1.05).x23(1.25, 1.3).emit();
    E(fx.debris, K.CHUNK, 4 * I, P, N).cone(1.0, 0.18).speed(80, 260).life(0.8, 1.6).drag(0.4, 0.4).s0(1.5, 3).s1(1.5, 3).color(3, 1.6, 0.6).color1(STEEL[0], STEEL[1], STEEL[2]).alpha(1, 1).spin(12).x01(1.8, 0).emit();
    E(fx.smoke, 0, 3, P, N).cone(0.8, 0.18).speed(10, 40).life(1.2, 2.2).drag(1.2, 1.2).s0(6, 10).s1(22, 34).color(0.25, 0.6, 1.2).color1(0.22, 0.23, 0.25).alpha(0.25, 0.4).fade(0.05, 1.4).grow(0.5).spin(0.6).x01(15, 3).emit();
    E(fx.dist, K.SHOCK, 1, P, N).life(0.28, 0.28).s0(6, 6).s1(130 * I, 130 * I).alpha(0.7, 0.7).fade(0.01, 1.3).emit();
    hullArcs(ctx, hull, hit.x, hit.y, Math.round(9 * I), 25 * I, 95 * I, T_ARC);
    ctx.after(0.07, AFTER.HULL_ARCS, hit.x, hit.y, I, 0, 0, 0, hull);
    ctx.lights.flash(hit.x, hit.y, 0.55, 0.85, 1.0, 7 * I, 280 * I, 0.16, 2, 0, 40);
    ctx.lights.flash(hit.x, hit.y, 0.3, 0.65, 1.0, 1.2 * I, 180 * I, 0.7, 1.5, 0.8, 40);
    ctx.stamp(hull, hit.x, hit.y, 20 * I, 2.6, 0.5, 0.62, 1.0);
  }
};

// ── VULCAN / GATLING ─────────────────────────────────────────────────────────
RECIPES.vulcan = {
  scale: 1.0,
  muzzle(ctx, m) {
    const fx = ctx.fx;
    const S = m.scale * this.scale;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.FLARE, 1, P, D).life(0.045, 0.045).s0(9 * S, 9 * S).s1(22 * S, 22 * S).color(3.0, 2.2, 1.0).color1(2.2, 0.9, 0.2).mix(20).fade(0.003, 2).grow(0.3).spin(2).emit();
    E(fx.add, K.GLOW, 1, P, D).life(0.05, 0.05).s0(4 * S, 4 * S).s1(13 * S, 13 * S).color(3.2, 2.6, 1.6).color1(2.0, 0.8, 0.2).mix(20).fade(0.003, 2).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.05, 0.05).s0(4 * S, 16 * S).s1(3 * S, 6 * S).color(3.0, 1.8, 0.6).emit();
    E(fx.spark, K.SPARK, 4, P, D).cone(0.35, 0.18).speed(100 * S, 320 * S).life(0.1, 0.3).drag(1.2, 1.2).color(2.8, 2.1, 1.2).x01(8 * S, 0.32).x23(0.06, 1.2).emit();
    E(fx.smoke, 0, 1, off(P, D, 3 * S, _T), D).cone(0.5, 0.18).speed(10 * S, 30 * S).life(0.9, 1.6).drag(1.2, 1.2).s0(3 * S, 3 * S).s1(11 * S, 16 * S).color(0.9, 0.45, 0.15).color1(0.3, 0.29, 0.28).alpha(0.1, 0.18).fade(0.05, 1.3).grow(0.5).spin(1).x01(10, 5).emit();
    E(fx.debris, K.CASING, 1, off(P, D, -24 * m.scale, _T), rot(D, -1.7, _R)).cone(0.4, 0.18).speed(45 * S, 85 * S).life(1.6, 2.4).drag(0.4, 0.4).s0(1.1 * S, 1.1 * S).s1(1.1 * S, 1.1 * S).color(0.2, 0.08, 0.02).color1(BRASS[0], BRASS[1], BRASS[2]).spin(16).x01(3, 0).emit();
    ctx.lights.flash(m.x, m.y, 1.0, 0.7, 0.35, 2.4, 110 * S, 0.05, 1.5, 0, 25);
    ctx.shake(0.4, 0.06);
  },
  projectile(size) {
    const small = size === 'S';
    return { style: PSTYLE.TRACER, color: [2.6, 1.45, 0.35], width: small ? 5 : 6.5, len: small ? 12 : 16, streak: 0.006, trail: -1, light: null };
  },
  impact(ctx, p, hull, hit) {
    const fx = ctx.fx;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    const R = reflect(sv(p.vx, p.vy, _D), N, _R);
    E(fx.add, K.GLOW, 1, P, N).life(0.06, 0.06).s0(6, 6).s1(26, 26).color(3.2, 2.4, 1.3).color1(2, 0.7, 0.15).mix(20).fade(0.003, 2).emit();
    E(fx.spark, K.SPARK, 10, P, R).cone(1.1, 0.18).speed(150, 520).life(0.15, 0.5).drag(0.8, 1.6).color(2.8, 2.2, 1.3).x01(16, 0.32).x23(0.06, 1.2).bounce(0.3).emit();
    if (fxRandom.next() < 0.35) {
      E(fx.smoke, 0, 1, P, N).cone(0.8, 0.18).speed(8, 30).life(0.8, 1.6).drag(1.2, 1.2).s0(5, 5).s1(20, 20).color(0.8, 0.4, 0.15).color1(0.24, 0.23, 0.22).alpha(0.3, 0.3).fade(0.05, 1.3).grow(0.5).x01(10, 5).emit();
    }
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.7, 0.35, 1.6, 90, 0.06, 1.5, 0, 30);
    ctx.stamp(hull, hit.x, hit.y, 7, 1.5, 0.35, 0.3, 0);
    ricochet(ctx, p, hit);
  }
};

/**
 * Rykoszet przy płaskim kącie: smugowiec odbija się z iskrą (działka). Kosmetyczny —
 * decyzję mechaniczną (hash numeru pocisku, obrażenia × 0,3) wpina 18-B.
 */
function ricochet(ctx, p, hit) {
  const l = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
  const dx = p.vx / l; const dy = p.vy / l;
  const dn = dx * hit.nx + dy * hit.ny;
  if (dn < -0.42 || fxRandom.next() > 0.6) return;
  const rx = dx - 2 * dn * hit.nx; const ry = dy - 2 * dn * hit.ny;
  const a = Math.atan2(ry, rx) + rand(-0.15, 0.15);
  const spd = l * rand(0.35, 0.6);
  ctx.ricochet(hit.x + hit.nx * 3, hit.y + hit.ny * 3, Math.cos(a) * spd, Math.sin(a) * spd,
    p.style, p.r * 0.7, p.g * 0.7, p.b * 0.7, p.width * 0.8, p.len * 0.7, rand(0.2, 0.45));
}

// ── CIĘŻKI AUTOKANON (M, L) ──────────────────────────────────────────────────
RECIPES.autocannon = {
  scale: 1.3,
  muzzle(ctx, m, w) {
    const I = SIZE_POWER[w.size] || 1;
    const S = m.scale * this.scale * 0.8;
    cannonMuzzle(ctx, m, PAL.armata, S, 0.8 * I, 0.55 * (m.density || 1), 1.25, 2.0, 26 * m.scale / S, 1, 0.7);
    ctx.shake(1.6 * I, 0.12);
  },
  projectile(size) {
    const I = SIZE_POWER[size] || 1;
    return { style: PSTYLE.SHELL, color: [2.4, 1.35, 0.45], width: 9 * I, len: 18 * I, streak: 0.004,
      trail: TRAIL.shell, trailWidth: 6 * I, trailSpacing: 40, trailPathUnit: 160, light: null };
  },
  impact(ctx, p, hull, hit) {
    const I = p.power;
    blast(ctx, hit.x, hit.y, 55 * I, PAL.armata, sv(hit.nx, hit.ny, _N), 1.5, 6, 45, 5, 6, 0.6);
    ctx.stamp(hull, hit.x, hit.y, 24 * I, 2.4, 0.8, 0.64, 0);
    ctx.shake(1.2 * I, 0.12);
  }
};

// ── HELIOS (plazma) ──────────────────────────────────────────────────────────
RECIPES.helios = {
  scale: 2.0,
  muzzle(ctx, m, w) {
    const fx = ctx.fx;
    const I = SIZE_POWER[w.size] || 1;
    const S = m.scale * this.scale;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.GLOW, 1, P, D).speed(12 * S, 12 * S).life(0.08, 0.08).drag(8, 8).s0(5 * S, 5 * S).s1((14 + 6 * I) * S, (14 + 6 * I) * S).color(4.0, 2.6, 3.0).color1(2.6, 0.2, 0.5).mix(16).fade(0.003, 2).emit();
    E(fx.add, K.GLOW, 1, off(P, D, 5 * S, _T), D).life(0.24, 0.24).drag(4, 4).s0(8 * S, 8 * S).s1((26 + 14 * I) * S, (26 + 14 * I) * S).color(2.0, 0.3, 0.6).color1(0.6, 0.02, 0.12).mix(5).alpha(0.75, 0.75).fade(0.01, 1.8).grow(0.5).emit();
    E(fx.add, K.FLARE, 1, P, D).life(0.12, 0.12).s0(10 * S, 10 * S).s1((38 + 18 * I) * S, (38 + 18 * I) * S).color(3.4, 1.4, 1.8).color1(2.2, 0.15, 0.4).mix(10).alpha(0.9, 0.9).fade(0.004, 2.2).grow(0.35).spin(1.5).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.12, 0.12).s0(8 * S, (46 + 20 * I) * S).s1(3 * S, 6 * S).color(3.6, 1.4, 1.8).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.16, 0.16).s0(6 * S, (30 + 14 * I) * S).s1(8 * S, 16 * S).color(2.2, 0.25, 0.5).alpha(0.8, 0.8).emit();
    E(fx.add, K.VAPOR, 8, P, D).cone(0.6, 0.18).speed(8 * S, 30 * S).life(0.6, 1.4).drag(1.6, 1.6).s0(4 * S, 4 * S).s1(14 * S, 26 * S).color(1.4, 0.2, 0.45).color1(0.3, 0.02, 0.18).mix(2).alpha(0.2, 0.35).fade(0.05, 1.5).grow(0.45).spin(0.8).emit();
    E(fx.spark, K.SPARK, 22, P, D).cone(0.3, 0.18).speed(120 * S, 380 * S).life(0.2, 0.5).drag(1, 1).color(3.0, 1.2, 1.4).x01(18 * S, 0.3).x23(0.45, 1.3).emit();
    E(fx.dist, K.HEAT, 1, off(P, D, 5 * S, _T), D).speed(10 * S, 10 * S).life(0.6, 0.6).s0(8 * S, 8 * S).s1(26 * S, 26 * S).alpha(0.5, 0.5).fade(0.1, 1.5).grow(0.5).emit();
    ctx.lights.flash(m.x, m.y, 1.0, 0.25, 0.35, 6 * I, 180 * S, 0.1, 2, 0, 30);
    ctx.shake(1.2 * I, 0.1);
  },
  projectile(size) {
    const I = SIZE_POWER[size] || 1;
    return { style: PSTYLE.BOLT, color: [2.6, 0.22, 0.55], width: 12 * I, len: 55 * I, streak: 0.004,
      trail: TRAIL.helios, trailWidth: 5 * I, trailSpacing: 40, trailPathUnit: 180, light: [1.0, 0.25, 0.35, 0.8, 120] };
  },
  impact(ctx, p, hull, hit) {
    const fx = ctx.fx;
    const I = p.power;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(fx.add, K.GLOW, 1, P, N).life(0.08, 0.08).s0(10, 10).s1(70 * I, 70 * I).color(4.0, 2.4, 2.6).color1(2.4, 0.3, 0.3).mix(16).fade(0.004, 2).emit();
    E(fx.add, K.FLARE, 1, P, N).life(0.11, 0.11).s0(20 * I, 20 * I).s1(90 * I, 90 * I).color(3.2, 1.2, 1.4).color1(2.0, 0.2, 0.3).mix(10).alpha(0.85, 0.85).fade(0.004, 2.2).grow(0.35).spin(1).emit();
    E(fx.add, K.FIRE, 5, P, N).cone(1.3, 0.18).speed(30, 130).life(0.25, 0.55).drag(3, 3).s0(10 * I, 10 * I).s1(30 * I, 55 * I).color(3.2, 1.0, 0.5).color1(0.8, 0.05, 0.05).mix(4).alpha(0.9, 0.9).fade(0.02, 1.3).grow(0.45).spin(1.5).emit();
    E(fx.spark, K.SPARK, 40 * I, P, N).cone(1.2, 0.18).speed(150, 600).life(0.25, 0.8).drag(0.6, 1.4).color(3.0, 1.6, 0.8).x01(26, 0.3).x23(0.1, 1.4).bounce(0.3).emit();
    E(fx.add, K.VAPOR, 6, P, N).cone(1.4, 0.18).speed(15, 70).life(0.6, 1.3).drag(1.5, 1.5).s0(8, 8).s1(26 * I, 44 * I).color(1.3, 0.2, 0.35).color1(0.25, 0.02, 0.12).mix(2).alpha(0.3, 0.3).fade(0.04, 1.5).grow(0.45).emit();
    E(fx.smoke, 0, 2, P, N).cone(1, 0.18).speed(10, 40).life(1.2, 2.0).s0(8, 8).s1(30, 30).color(1.4, 0.3, 0.2).color1(0.2, 0.19, 0.19).alpha(0.35, 0.35).fade(0.05, 1.4).grow(0.5).x01(15, 3).emit();
    E(fx.dist, K.SHOCK, 1, P, N).life(0.25, 0.25).s0(6, 6).s1(100 * I, 100 * I).alpha(0.6, 0.6).fade(0.01, 1.3).emit();
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.35, 0.3, 5 * I, 240 * I, 0.14, 2, 0, 40);
    ctx.stamp(hull, hit.x, hit.y, 18 * I, 2.9, 0.6, 0.5, 0);
  }
};

// ── ARMATA OBLĘŻNICZA ────────────────────────────────────────────────────────
RECIPES.armata = {
  scale: 1.5,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.armata, m.scale * this.scale, 1.0, 1.0 * (m.density || 1), 1.3, 1.5, 22, 1, 1);
    ctx.shake(5.0 * m.scale, 0.22);
  },
  projectile() {
    return { style: PSTYLE.SHELL, color: [2.8, 1.5, 0.5], width: 13, len: 26, streak: 0.004,
      trail: TRAIL.shell, trailWidth: 9, trailSpacing: 40, trailPathUnit: 150, light: [1.0, 0.6, 0.3, 0.8, 140] };
  },
  impact(ctx, p, hull, hit) {
    blast(ctx, hit.x, hit.y, 110, PAL.armata, sv(hit.nx, hit.ny, _N), 1.7, 12, 90, 14, 14, 1);
    ctx.stamp(hull, hit.x, hit.y, 62, 3.2, 0.95, 0.76, 0);
    ctx.burn(hull, hit.x, hit.y, hit.nx, hit.ny, 2.6, 0.9, 'armata');
    ctx.shake(4, 0.25);
  }
};

// ── GOLIATH (autokanon specjalny) ────────────────────────────────────────────
RECIPES.goliath = {
  scale: 1.1,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.goliath, m.scale * this.scale, 1.15, 0.9 * (m.density || 1), 1.2, 1.4, 30, 1, 1);
    ctx.shake(3.5, 0.2);
  },
  projectile() {
    return { style: PSTYLE.SHELL, color: [3.0, 1.25, 0.3], width: 17, len: 32, streak: 0.004,
      trail: TRAIL.shell, trailWidth: 12, trailSpacing: 44, trailPathUnit: 160, light: [1.0, 0.5, 0.2, 0.9, 160] };
  },
  impact(ctx, p, hull, hit) {
    blast(ctx, hit.x, hit.y, 90, PAL.goliath, sv(hit.nx, hit.ny, _N), 1.6, 9, 75, 9, 10, 1);
    ctx.stamp(hull, hit.x, hit.y, 48, 3.0, 0.9, 0.72, 0);
    if (fxRandom.next() < 0.4) ctx.burn(hull, hit.x, hit.y, hit.nx, hit.ny, 1.6, 0.6, 'goliath');
    ctx.shake(2.5, 0.18);
  }
};

// ── YAMATO ───────────────────────────────────────────────────────────────────
const Y_CROSS = [0.6 * 3.2, 0.85 * 3.2, 1.0 * 3.2];
RECIPES.yamato = {
  scale: 2.4,
  muzzle(ctx, m) {
    cannonMuzzle(ctx, m, PAL.yamato, m.scale * this.scale, 1.25, 1.0 * (m.density || 1), 1.35, 0, 0, 1, 1.6);
    const S = m.scale * this.scale;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    // energia działa: łuki i opar jak przy wyładowaniu (nie jonowa iglica)
    E(ctx.fx.arc, 0, 8, P, D).cone(1.4, 0.18).speed(8 * S, 26 * S).life(0.12, 0.3).color(1.3, 2.6, 3.9).x01(2.4 * S, 1.8).emit();
    E(ctx.fx.add, K.VAPOR, 12, P, D).cone(0.8, 0.18).speed(6 * S, 24 * S).life(1.2, 2.4).drag(1.3, 1.3).s0(5 * S, 5 * S).s1(20 * S, 36 * S).color(0.4, 1.2, 2.2).color1(0.1, 0.1, 0.4).mix(1.5).alpha(0.2, 0.34).fade(0.06, 1.5).grow(0.45).spin(0.6).emit();
    ctx.shake(7.0, 0.30);
  },
  projectile() {
    return { style: PSTYLE.ORB, color: [0.35, 1.45, 1.9], width: 64, len: 150, streak: 0.004,
      trail: TRAIL.yamato, trailWidth: 30, trailSpacing: 50, trailPathUnit: 220, light: [0.45, 0.85, 1.0, 3.5, 420] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const ddx = x1 - x0; const ddy = y1 - y0;
    p.flyAcc += Math.sqrt(ddx * ddx + ddy * ddy);
    if (p.flyAcc < 140) return;
    p.flyAcc = 0;
    const P = sp(x1, y1, _P);
    const D = neg(sv(p.rvx, p.rvy, _D), _D);
    E(ctx.fx.arc, 0, 2, P, D).cone(1.2, 0.18).speed(30, 80).life(0.06, 0.14).color(1.2, 2.6, 3.8).x01(8, 1.6).emit();
    E(ctx.fx.spark, K.SPARK, 4, P, D).cone(0.9, 0.18).speed(100, 400).life(0.2, 0.5).drag(1, 1).color(1.6, 2.6, 3.8).x01(30, 1.0).x23(1.1, 1.4).emit();
  },
  // Trafienie: port createYamatoImpactFactory (dawny effects3d/yamato.js) w skali ekranu gry,
  // plus światło, fala refrakcji, rana i ogień w wyrwie.
  impact(ctx, p, hull, hit) {
    const fx = ctx.fx;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(fx.add, K.GLOW, 1, P, N).life(0.16, 0.16).s0(60, 60).s1(420, 420).color(2.6, 3.0, 3.8).color1(0.4, 0.7, 1.0).mix(8).fade(0.004, 3).grow(0.25).emit();
    E(fx.add, K.CROSS, 1, P, perp(N, _T)).life(0.5, 0.5).s0(300, 2000).s1(18, 40).colors(Y_CROSS).alpha(0.9, 0.9).emit();
    E(fx.add, K.FLARE, 1, P, N).life(0.26, 0.26).s0(140, 140).s1(560, 560).color(2.0, 2.7, 3.8).color1(0.3, 0.9, 2.4).mix(6).alpha(0.75, 0.75).fade(0.004, 2.2).grow(0.3).spin(0.5).emit();
    E(fx.add, K.FIRE, 14, P, N).cone(2.3, 0.18).speed(60, 280).life(0.8, 1.4).drag(2.2, 2.2).s0(50, 100).s1(130, 300).color(1.0, 1.6, 2.5).color1(0.03, 0.12, 0.4).mix(1.6).alpha(0.7, 1).fade(0.02, 1.3).grow(0.4).spin(1).emit();
    E(fx.spark, K.SPARK, 90, P, N).cone(1.8, 0.18).speed(840, 3000).life(0.6, 1.1).drag(1.5, 3).color(2.0, 2.6, 3.4).x01(180, 1.0).x23(1.15, 2.0).bounce(0.25).emit();
    E(fx.spark, K.SPARK, 260, P, N).cone(2.0, 0.18).speed(500, 2400).life(1.0, 2.2).drag(0.6, 1.2).color(2.6, 2.4, 2.0).x01(60, 0.35).x23(0.2, 1.4).bounce(0.3).emit();
    E(fx.debris, K.CHUNK, 16, P, N).cone(1.9, 0.18).speed(300, 1100).life(1.2, 2.2).drag(0.3, 0.3).s0(7, 15).s1(7, 15).color(1.2, 1.9, 2.8).color1(STEEL[0], STEEL[1], STEEL[2]).alpha(1, 1).spin(6).x01(2.6, 0).emit();
    E(fx.smoke, 0, 18, P, N).cone(2.4, 0.18).speed(60, 220).life(1.8, 3.2).drag(1.0, 1.0).s0(80, 140).s1(260, 480).color(0.2, 0.45, 0.9).color1(0.06, 0.08, 0.12).alpha(0.45, 0.75).fade(0.05, 1.2).grow(0.45).spin(0.5).x01(80, 3.0).emit();
    E(fx.dist, K.SHOCK, 1, P, N).life(0.55, 0.55).s0(60, 60).s1(1200, 1200).alpha(1.3, 1.3).fade(0.01, 1.1).emit();
    E(fx.dist, K.HEAT, 4, P, N).cone(3, 0.18).speed(30, 100).life(1.4, 2.4).s0(120, 120).s1(360, 360).alpha(0.7, 0.7).fade(0.1, 1.5).grow(0.5).emit();
    // wtórne wybuchy (jak w demie: 4 w pierwszych 0,45 s)
    ctx.after(0.08 + fxRandom.next() * 0.06, AFTER.YAMATO_SECONDARY, hit.x, hit.y, hit.nx, hit.ny, 0, 0, hull);
    ctx.after(0.19 + fxRandom.next() * 0.06, AFTER.YAMATO_SECONDARY, hit.x, hit.y, hit.nx, hit.ny, 0, 0, hull);
    ctx.after(0.30 + fxRandom.next() * 0.06, AFTER.YAMATO_SECONDARY, hit.x, hit.y, hit.nx, hit.ny, 0, 0, hull);
    ctx.after(0.43 + fxRandom.next() * 0.06, AFTER.YAMATO_SECONDARY, hit.x, hit.y, hit.nx, hit.ny, 0, 0, hull);
    ctx.lights.flash(hit.x, hit.y, 0.55, 0.85, 1.0, 18, 1100, 0.3, 2, 0, 80);
    ctx.lights.flash(hit.x, hit.y, 0.35, 0.65, 1.0, 3, 700, 2.2, 1.4, 0.8, 60);
    ctx.stamp(hull, hit.x, hit.y, 130, 3.6, 1.0, 0.9, 0.4);
    ctx.burn(hull, hit.x, hit.y, hit.nx, hit.ny, 3.5, 1.6, 'yamato');
    ctx.shake(12, 0.4);
  }
};

/** Wtórny wybuch Yamato (zdarzenie opóźnione): punkt losowy wokół trafienia. */
function yamatoSecondary(ctx, hx, hy, nx, ny, hull) {
  const fx = ctx.fx;
  const pal = PAL.yamato;
  const a = fxRandom.next() * TAU;
  const r = rand(120, 460);
  const x = hx + Math.cos(a) * r + nx * r * 0.4;
  const y = hy + Math.sin(a) * r + ny * r * 0.4;
  const Q = sp(x, y, _Q);
  const N = sv(nx, ny, _N);
  const g1 = rand(140, 230);
  E(fx.add, K.GLOW, 1, Q, N).life(0.09, 0.09).s0(30, 30).s1(g1, g1).color(1.6, 2.0, 2.7).color1(0.3, 0.6, 1.2).mix(10).fade(0.004, 2.2).grow(0.35).emit();
  E(fx.add, K.FIRE, 6, Q, N).cone(3, 0.18).speed(30, 150).life(0.5, 1.0).drag(2.5, 2.5).s0(35, 35).s1(90, 170).colors(pal.fire0, pal.fire1).mix(2).alpha(0.9, 0.9).fade(0.02, 1.3).grow(0.4).spin(1).emit();
  E(fx.spark, K.SPARK, 40, Q, N).cone(3, 0.18).speed(400, 1500).life(0.5, 1.2).drag(1, 1).color(2.0, 2.6, 3.4).x01(70, 1).x23(1.1, 1.5).emit();
  E(fx.smoke, 0, 2, Q, N).cone(3, 0.18).speed(20, 80).life(1.6, 2.6).s0(80, 80).s1(220, 360).colors(pal.smokeHot, pal.soot).alpha(0.5, 0.5).fade(0.05, 1.2).grow(0.45).x01(60, 1.6).emit();
  const sr = rand(300, 500);
  E(fx.dist, K.SHOCK, 1, Q, N).life(0.35, 0.35).s0(30, 30).s1(sr, sr).alpha(0.9, 0.9).fade(0.01, 1.2).emit();
  ctx.lights.flash(x, y, 0.5, 0.8, 1.0, 10, 700, 0.18, 2, 0, 60);
  ctx.stamp(hull, x, y, rand(40, 70), 2.8, 0.9, 0.5, 0.3);
  ctx.shake(3, 0.15);
}

// ── PLAZMOWY GATLING (specjalny) ─────────────────────────────────────────────
const PG_ARC = [0.8, 2.8, 2.8];
RECIPES.plasmaGatling = {
  scale: 1.2,
  muzzle(ctx, m) {
    const fx = ctx.fx;
    const S = m.scale * this.scale;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.GLOW, 1, P, D).life(0.08, 0.08).s0(6 * S, 6 * S).s1(24 * S, 24 * S).color(2.6, 3.8, 3.8).color1(0.2, 1.8, 1.8).mix(14).fade(0.003, 2).emit();
    E(fx.add, K.GLOW, 1, off(P, D, 5 * S, _T), D).life(0.26, 0.26).drag(3, 3).s0(10 * S, 10 * S).s1(40 * S, 40 * S).color(0.3, 1.8, 1.8).color1(0.02, 0.3, 0.4).mix(4).alpha(0.75, 0.75).fade(0.01, 1.8).grow(0.5).emit();
    E(fx.add, K.FLARE, 1, P, D).life(0.11, 0.11).s0(14 * S, 14 * S).s1(46 * S, 46 * S).color(2.0, 3.6, 3.6).color1(0.2, 1.6, 1.8).mix(10).alpha(0.85, 0.85).spin(2).fade(0.004, 2.2).grow(0.35).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.12, 0.12).s0(8 * S, 40 * S).s1(6 * S, 13 * S).color(0.6, 3.0, 3.0).emit();
    E(fx.add, K.VAPOR, 8, P, D).cone(0.7, 0.18).speed(10 * S, 40 * S).life(0.8, 1.6).drag(1.5, 1.5).s0(5 * S, 5 * S).s1(18 * S, 32 * S).color(0.2, 1.3, 1.4).color1(0.02, 0.15, 0.3).mix(1.8).alpha(0.2, 0.35).fade(0.05, 1.5).grow(0.45).spin(0.8).emit();
    E(fx.spark, K.SPARK, 20, P, D).cone(0.4, 0.18).speed(120 * S, 360 * S).life(0.2, 0.5).drag(1, 1).color(1.2, 3.0, 3.0).x01(16 * S, 1.0).x23(1.0, 1.4).emit();
    E(fx.arc, 0, 3, P, D).cone(1.4, 0.18).speed(8 * S, 20 * S).life(0.08, 0.2).color(0.8, 2.8, 2.8).x01(2 * S, 1.3).emit();
    E(fx.dist, K.HEAT, 1, off(P, D, 6 * S, _T), D).speed(10 * S, 10 * S).life(0.7, 0.7).s0(12 * S, 12 * S).s1(36 * S, 36 * S).alpha(0.55, 0.55).fade(0.1, 1.5).grow(0.5).emit();
    ctx.lights.flash(m.x, m.y, 0.25, 1.0, 1.0, 6, 220 * S, 0.12, 2, 0, 30);
    ctx.shake(2.2, 0.12);
  },
  projectile() {
    return { style: PSTYLE.GLOB, color: [0.35, 2.1, 2.1], width: 38, len: 30, streak: 0.004,
      trail: TRAIL.plasmaGlob, trailWidth: 14, trailSpacing: 30, trailPathUnit: 140, light: [0.25, 1.0, 1.0, 1.3, 200] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const ddx = x1 - x0; const ddy = y1 - y0;
    p.flyAcc += Math.sqrt(ddx * ddx + ddy * ddy);
    if (p.flyAcc < 70) return;
    p.flyAcc = 0;
    const P = sp(x1, y1, _P);
    const D = neg(sv(p.rvx, p.rvy, _D), _D);
    E(ctx.fx.add, K.VAPOR, 1, P, D).cone(1.2, 0.18).speed(10, 40).life(0.3, 0.6).s0(8, 8).s1(22, 22).color(0.25, 1.5, 1.5).color1(0.02, 0.2, 0.3).mix(3).alpha(0.4, 0.4).fade(0.03, 1.5).grow(0.5).emit();
  },
  impact(ctx, p, hull, hit) {
    const fx = ctx.fx;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(fx.add, K.GLOW, 1, P, N).life(0.1, 0.1).s0(16, 16).s1(130, 130).color(3.0, 3.8, 3.8).color1(0.3, 1.6, 1.8).mix(12).fade(0.004, 2).emit();
    E(fx.add, K.FIRE, 7, P, N).cone(1.5, 0.18).speed(40, 160).life(0.35, 0.7).drag(3, 3).s0(16, 16).s1(44, 80).color(1.0, 2.6, 2.8).color1(0.02, 0.3, 0.6).mix(3).alpha(0.9, 0.9).fade(0.02, 1.3).grow(0.45).spin(1.2).emit();
    E(fx.spark, K.SPARK, 45, P, N).cone(1.3, 0.18).speed(200, 700).life(0.3, 0.8).drag(0.6, 1.3).color(1.2, 3.0, 3.0).x01(30, 1.0).x23(1.0, 1.5).bounce(0.3).emit();
    E(fx.add, K.VAPOR, 8, P, N).cone(1.5, 0.18).speed(20, 90).life(0.8, 1.6).drag(1.4, 1.4).s0(12, 12).s1(40, 70).color(0.25, 1.4, 1.5).color1(0.02, 0.15, 0.3).mix(1.6).alpha(0.35, 0.35).fade(0.04, 1.5).grow(0.45).emit();
    E(fx.dist, K.SHOCK, 1, P, N).life(0.3, 0.3).s0(10, 10).s1(180, 180).alpha(0.8, 0.8).fade(0.01, 1.2).emit();
    hullArcs(ctx, hull, hit.x, hit.y, 5, 20, 80, PG_ARC, 0.1, 0.25, 6);
    ctx.lights.flash(hit.x, hit.y, 0.3, 1.0, 1.0, 8, 360, 0.18, 2, 0, 40);
    ctx.stamp(hull, hit.x, hit.y, 34, 2.2, 0.55, 0.56, 0.8);
  }
};

// ── HEXLANCE (superbroń wbudowana) ───────────────────────────────────────────
// Port RailgunFX (dawny railgunFx3D.js) 1:1 w liczbach (S = 3). W grze wycięto płatki
// sabotu jako bryły i światła punktowe — tu wracają (odłamki GPU, siatka świateł).
const HEX_S = 3.0;
const HEX_SPR = 0.10;
const HEX_COL = [1.4, 2.6, 3.9];
const HEX_PAL = {
  core0: [3.8, 4.1, 4.5], core1: [0.8, 1.9, 3.3], halo0: [1.0, 2.1, 3.5], halo1: [0.10, 0.30, 0.85],
  flare0: [3.2, 3.6, 4.4], flare1: [1.0, 2.0, 3.4], cross: [2.5, 3.2, 4.4],
  p1: [3.3, 3.9, 4.7], p2: [0.85, 2.1, 3.7], p3: [0.32, 0.85, 2.1], p4: [2.4, 3.0, 4.2],
  blob0: [2.2, 3.0, 4.2], blob1: [0.22, 0.30, 0.85], streak: [1.7, 2.7, 3.9], arc: [1.4, 2.5, 3.9],
  vap0: [0.55, 1.25, 2.1], vap1: [0.14, 0.09, 0.34], light: [0.5, 0.8, 1.0]
};

/** Stan ładowania działa (na działo, nie globalny jak w demie). */
export function createChargeState() { return { arcT: 0 }; }

/**
 * Ładowanie (Hexlance, Mjolnir, Valkyrie): iskry biegnące szynami w głąb kadłuba, łuki
 * między szynami, rozbłysk wylotu. u — postęp 0..1, dt — krok [s], cs — stan działa,
 * col — barwa iskier, glow — barwa rozbłysku przy u (null = domyślna), gk — [r0,dr,g0,dg,b0,db].
 */
function hexCharge(ctx, m, u, dt, cs, S, col, gk) {
  const fx = ctx.fx;
  const P = sp(m.x, m.y, _P);
  const D = sd(m.angle, _D);
  const px = -D.y * 12 * S; const py = D.x * 12 * S;
  const back = 541 * S; const front = 36 * S;
  const n = fxRandom.round((8 + 90 * u * u) * dt);
  for (let k = 0; k < n; k++) {
    const left = fxRandom.next() < 0.5;
    const t = rand(0, 0.9);
    const along = back + (front - back) * t;
    _Q.x = P.x - D.x * along + (left ? px : -px);
    _Q.y = P.y - D.y * along + (left ? py : -py);
    E(fx.spark, K.SPARK, 1, _Q, D).speed(500 * S, 1400 * S).life(0.12, 0.3).drag(0.2, 0.2).colors(col).x01(110 * S, 1.05).x23(1.25, 1.6).emit();
  }
  cs.arcT -= dt;
  if (cs.arcT <= 0) {
    cs.arcT = 0.16 + (0.02 - 0.16) * u;
    const t = fxRandom.next();
    const along = back + (front - back) * t;
    _A.x = P.x - D.x * along + px; _A.y = P.y - D.y * along + py;
    const bx = P.x - D.x * along - px; const by = P.y - D.y * along - py;
    const dx = bx - _A.x; const dy = by - _A.y;
    // demo: sceneVec(B − A w scenie, odbite y) — kierunek w scenie wprost
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    _B.x = dx / l; _B.y = dy / l;
    E(fx.arc, 0, 1, _A, _B).speed(l, l).life(0.05, 0.16).color(1.2 * u + 0.4, 2.3, 3.8).x01(rand(2, 10) * (0.3 + u) * S, 1.6).emit();
  }
  if (fxRandom.next() < 22 * dt) {
    const s0 = (16 + 90 * u * u) * S; const s1 = (12 + 70 * u * u) * S;
    E(fx.add, K.FLARE, 1, P, D).life(0.11, 0.11).s0(s0, s0).s1(s1, s1).color(gk[0] + gk[1] * u, gk[2] + gk[3] * u, gk[4] + gk[5] * u).color1(0.3, 0.9, 1.8).mix(9).alpha(0.3 + 0.6 * u, 0.3 + 0.6 * u).fade(0.02, 1.5).grow(0.7).spin(2).emit();
  }
  if (fxRandom.next() < 10 * dt) {
    E(fx.dist, K.HEAT, 1, P, D).speed(20, 20).life(0.5, 0.5).s0(30 * S * u + 10, 30 * S * u + 10).s1(60 * S * u + 20, 60 * S * u + 20).alpha(0.4 * u, 0.4 * u).fade(0.1, 1.5).grow(0.5).emit();
  }
  const lk = Math.sqrt(S / HEX_S);
  ctx.lights.point(m.x, m.y, 0.45, 0.75, 1.0, (0.8 + 3.5 * u * u) * lk, (120 + 260 * u) * Math.max(0.5, S / 2), 40);
}
const HEX_GLOW = [1.0, 2.2, 1.8, 1.8, 2.8, 1.6];

function hexFire(ctx, m, S, I, c) {
  const fx = ctx.fx;
  const L = 1.0;
  const SPR = HEX_SPR;
  const P = sp(m.x, m.y, _P);
  const D = sd(m.angle, _D);
  E(fx.add, K.GLOW, 1, P, D).speed(220 * S, 220 * S).life(0.14, 0.14).drag(5, 5).s0(34 * S, 34 * S).s1((130 + 90 * I) * S, (130 + 90 * I) * S).colors(c.core0, c.core1).mix(13).fade(0.004, 2.1).grow(0.38).emit();
  E(fx.add, K.GLOW, 1, off(P, D, 60 * S, _T), D).speed(130 * S, 130 * S).life(0.40, 0.40).drag(3.4, 3.4).s0(70 * S, 70 * S).s1((280 + 190 * I) * S, (280 + 190 * I) * S).colors(c.halo0, c.halo1).mix(4.5).alpha(0.7, 0.7).fade(0.008, 1.9).grow(0.48).emit();
  E(fx.add, K.FLARE, 1, P, D).life(0.18, 0.18).s0(130 * S, 130 * S).s1((380 + 220 * I) * S, (380 + 220 * I) * S).colors(c.flare0, c.flare1).mix(11).alpha(0.95, 0.95).fade(0.005, 2.5).grow(0.35).spin(0.8).emit();
  E(fx.add, K.CROSS, 1, P, D).life(0.20, 0.20).s0(240 * S, (880 + 520 * I) * L * S).s1(55 * S, (95 + 55 * I) * S).colors(c.cross).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.30, 0.30).s0(140 * S, (600 + 340 * I) * L * S).s1(24 * S, 44 * S).colors(c.p1).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.44, 0.44).s0(100 * S, (410 + 250 * I) * L * S).s1(48 * S, 100 * S).colors(c.p2).alpha(0.85, 0.85).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.62, 0.62).s0(70 * S, (250 + 160 * I) * L * S).s1(95 * S, 205 * S).colors(c.p3).alpha(0.45, 0.45).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.17, 0.17).s0(45 * S, 160 * L * S).s1(115 * S, 250 * S).colors(c.p4).alpha(0.7, 0.7).emit();
  const vk = 0.7 + 0.4 * I;
  E(fx.add, K.GLOW, 44, P, D).cone(SPR, 0.18).speed(260 * S * vk, 900 * S * vk).life(0.3, 0.85).drag(1.6, 1.6).offset(0, 60 * S).s0(10 * S, 26 * S).s1(50 * S, 130 * S).colors(c.blob0, c.blob1).mix(3.4).alpha(0.4, 0.8).fade(0.02, 1.8).grow(0.5).spin(1.6).emit();
  E(fx.spark, K.SPARK, 128 * I, P, D).cone(SPR * 0.8, 0.18).speed(500 * S * vk, 1900 * S * vk).life(0.3, 0.9).drag(0.25, 0.7).offset(0, 80 * S).colors(c.streak).x01(150 * S, 1.05).x23(1.2, 1.8).emit();
  E(fx.spark, K.SPARK, 22 * I, P, D).cone(SPR * 2.4, 0.18).speed(500 * S * vk, 1900 * S * vk).life(0.3, 0.9).drag(0.25, 0.7).offset(0, 80 * S).colors(c.streak).x01(150 * S, 1.05).x23(1.2, 1.6).emit();
  // płatki sabotu — w grze były iskrami; tu wracają jako rozżarzone bryły
  E(fx.debris, K.PETAL, 6, off(P, D, 25 * S, _T), D).cone(SPR * 2.6, 0.18).speed(160 * S, 420 * S).life(1.6, 3.0).drag(0.2, 0.2).s0(5 * S, 8 * S).s1(5 * S, 8 * S).color(3.2, 2.0, 0.9).color1(0.4, 0.38, 0.36).alpha(1, 1).spin(5).x01(0.9, 0).emit();
  E(fx.arc, 0, 10, P, D).cone(0.55, 0.18).speed(20 * S, 90 * S).life(0.12, 0.38).colors(c.arc).x01(16 * S, 2.4).emit();
  E(fx.add, K.VAPOR, 18, P, D).cone(SPR * 3, 0.18).speed(30 * S, 150 * S).life(1.1, 2.6).drag(0.9, 0.9).offset(0, 120 * S).s0(30 * S, 70 * S).s1(130 * S, 290 * S).colors(c.vap0, c.vap1).mix(1.3).alpha(0.10, 0.24).fade(0.06, 1.5).grow(0.45).spin(0.4).emit();
  E(fx.dist, K.SHOCK, 1, P, D).life(0.5, 0.5).s0(40 * S, 40 * S).s1(520 * S, 520 * S).alpha(1.2, 1.2).fade(0.01, 1.1).emit();
  E(fx.dist, K.HEAT, 5, P, D).cone(SPR * 3, 0.18).speed(60 * S, 240 * S).life(0.8, 1.6).offset(0, 200 * S).s0(50 * S, 50 * S).s1(130 * S, 130 * S).alpha(0.6, 0.6).fade(0.1, 1.5).grow(0.5).emit();
  const lk = Math.sqrt(S / HEX_S);
  ctx.lights.flash(m.x, m.y, c.light[0], c.light[1], c.light[2], 12 * I * lk, 350 + 350 * S, 0.28, 2, 0, 80);
  ctx.lights.flash(m.x + Math.cos(m.angle) * 170 * S, m.y + Math.sin(m.angle) * 170 * S, c.light[0], c.light[1], c.light[2], 4 * I * lk, 300 * S, 0.45, 2, 0, 80);
}

const HEX_IMPACT_SPARK = [2.9, 2.2, 1.4];
/** Trafienie Hexlance'a (i Mjolnira, Valkyrie): D — kierunek lotu w scenie. */
function hexImpact(ctx, x, y, D, S, I, spark) {
  const fx = ctx.fx;
  const P = sp(x, y, _H);
  E(fx.add, K.GLOW, 1, P, D).life(0.16, 0.16).drag(5, 5).s0(30 * S, 30 * S).s1((180 + 120 * I) * S, (180 + 120 * I) * S).color(4.0, 3.6, 3.0).color1(2.4, 0.9, 0.3).mix(11).fade(0.004, 2.0).grow(0.4).emit();
  E(fx.add, K.CROSS, 1, P, D).life(0.2, 0.2).s0(150 * S, (500 + 300 * I) * S).s1(80 * S, (150 + 70 * I) * S).color(3.0, 2.2, 1.4).alpha(0.9, 0.9).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.35, 0.35).s0(90 * S, (330 + 200 * I) * S).s1(50 * S, 150 * S).color(2.8, 1.6, 0.7).alpha(0.9, 0.9).emit();
  E(fx.add, K.GLOW, 40 * I, P, D).cone(0.45, 0.18).speed(150 * S, 700 * S).life(0.3, 0.9).drag(1.8, 1.8).s0(8 * S, 20 * S).s1(40 * S, 110 * S).color(2.8, 1.5, 0.55).color1(0.45, 0.12, 0.03).mix(3.2).alpha(0.45, 0.85).fade(0.02, 1.8).grow(0.5).spin(2).emit();
  E(fx.spark, K.SPARK, 84 * I, P, D).cone(0.5, 0.18).speed(200 * S, 1000 * S).life(0.3, 1.0).drag(0.5, 1.4).colors(spark).x01(70 * S, 0.32).x23(0.06, 1.7).bounce(0.3).emit();
  E(fx.spark, K.SPARK, 36 * I, P, neg(D, _T2)).cone(1.0, 0.18).speed(80 * S, 400 * S).life(0.3, 1.0).drag(0.5, 1.4).colors(spark).x01(70 * S, 0.32).x23(0.06, 1.6).bounce(0.3).emit();
  E(fx.debris, K.CHUNK, 8 * I, P, D).cone(0.8, 0.18).speed(60 * S, 260 * S).life(1.8, 3.4).drag(0.25, 0.25).s0(4, 9).s1(4, 9).color(3.0, 1.7, 0.7).color1(STEEL[0], STEEL[1], STEEL[2]).alpha(1, 1).spin(8).x01(0.8, 0).emit();
  E(fx.smoke, 0, 6 * I, P, neg(D, _T2)).cone(1.4, 0.18).speed(20, 90).life(1.8, 3.2).drag(1.1, 1.1).s0(30, 30).s1(110, 200).color(1.8, 0.8, 0.3).color1(0.2, 0.19, 0.2).alpha(0.5, 0.5).fade(0.04, 1.3).grow(0.45).x01(40, 2).emit();
  E(fx.dist, K.SHOCK, 1, P, D).life(0.4, 0.4).s0(30, 30).s1(520 * I, 520 * I).alpha(1.0, 1.0).fade(0.01, 1.2).emit();
  ctx.lights.flash(x, y, 1.0, 0.75, 0.5, 16 * I, 800 * I, 0.22, 2, 0, 60);
}

/** Wylot przestrzeliny: stożek stopionego metalu, ognia i odłamków za kadłubem. */
function exitSpray(ctx, x, y, D, I, S) {
  const fx = ctx.fx;
  const P = sp(x, y, _H);
  E(fx.add, K.GLOW, 1, P, D).life(0.14, 0.14).s0(20 * S, 20 * S).s1(140 * S * I, 140 * S * I).color(3.8, 3.2, 2.4).color1(2.2, 0.8, 0.2).mix(12).fade(0.004, 2).emit();
  E(fx.add, K.PLUME, 1, P, D).life(0.3, 0.3).s0(60 * S, 260 * S * I).s1(30 * S, 110 * S).color(2.8, 1.5, 0.6).alpha(0.9, 0.9).emit();
  E(fx.add, K.FIRE, 8 * I, P, D).cone(0.6, 0.18).speed(100 * S, 400 * S).life(0.35, 0.8).drag(2.5, 2.5).s0(12 * S, 12 * S).s1(40 * S, 90 * S).color(3.0, 1.5, 0.5).color1(0.8, 0.15, 0.03).mix(3).alpha(0.9, 0.9).fade(0.02, 1.3).grow(0.45).spin(1.5).emit();
  E(fx.spark, K.SPARK, 120 * I, P, D).cone(0.55, 0.18).speed(300 * S, 1400 * S).life(0.4, 1.1).drag(0.4, 1.2).color(3.0, 2.3, 1.4).x01(80 * S, 0.32).x23(0.06, 1.7).emit();
  E(fx.debris, K.CHUNK, 12 * I, P, D).cone(0.6, 0.18).speed(150 * S, 600 * S).life(1.5, 3).drag(0.2, 0.2).s0(3 * S, 7 * S).s1(3 * S, 7 * S).color(3.0, 1.5, 0.5).color1(STEEL[0], STEEL[1], STEEL[2]).alpha(1, 1).spin(9).x01(0.9, 0).emit();
  E(fx.smoke, 0, 6 * I, P, D).cone(0.8, 0.18).speed(40 * S, 160 * S).life(2, 3.5).drag(1.2, 1.2).s0(20 * S, 20 * S).s1(70 * S, 140 * S).color(1.6, 0.6, 0.2).color1(0.18, 0.17, 0.17).alpha(0.55, 0.55).fade(0.04, 1.3).grow(0.45).x01(40, 2).emit();
  E(fx.dist, K.SHOCK, 1, P, D).life(0.35, 0.35).s0(20 * S, 20 * S).s1(240 * S * I, 240 * S * I).alpha(0.9, 0.9).fade(0.01, 1.2).emit();
  ctx.lights.flash(x, y, 1.0, 0.65, 0.35, 10 * I, 500 * I, 0.2, 2, 0, 50);
}

const HEX_TIP0 = [3.4, 3.8, 4.6];
const HEX_TIP1 = [1.6, 2.5, 3.8];
const HEX_FLY = [2.2, 2.8, 3.8];
RECIPES.hexlance = {
  scale: HEX_S,
  charge(ctx, m, u, dt, cs) { hexCharge(ctx, m, u, dt, cs, HEX_S, HEX_COL, HEX_GLOW); },
  muzzle(ctx, m) {
    hexFire(ctx, m, HEX_S, 1, HEX_PAL);
    ctx.shake(14, 0.4);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [1.0, 1.8, 2.8], width: 50, len: 120, streak: 0.002,
      trail: TRAIL.hexlance, trailWidth: 90, trailSpacing: 120, trailPathUnit: 660, light: [0.5, 0.8, 1.0, 4, 600] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const S = HEX_S;
    const ddx = x1 - x0; const ddy = y1 - y0;
    const seg = Math.sqrt(ddx * ddx + ddy * ddy);
    p.flyAcc += seg;
    const step = 180 * S;
    const D = sv(p.rvx, p.rvy, _D);
    while (p.flyAcc >= step) {
      p.flyAcc -= step;
      const f = seg > 1e-6 ? 1 - p.flyAcc / seg : 1;
      const P = sp(x0 + ddx * f, y0 + ddy * f, _P);
      E(ctx.fx.spark, K.SPARK, 1, P, rot(D, rand(-1.9, 1.9), _R)).speed(60 * S, 260 * S).life(0.25, 0.7).drag(0.5, 1.4).colors(HEX_FLY).x01(50 * S, 1.0).x23(1.1, 1.5).emit();
    }
    // rozgrzany czubek leci z pociskiem (prędkość własna pocisku względem nośnika)
    E(ctx.fx.add, K.GLOW, 1, sp(x1, y1, _P), D).vel(p.rvx, -p.rvy).life(0.05, 0.05).s0(120, 120).s1(96, 96).colors(HEX_TIP0, HEX_TIP1).mix(12).fade(0.01, 0.8).grow(1).emit();
  },
  impact(ctx, p, hull, hit) {
    hexImpact(ctx, hit.x, hit.y, sv(p.vx, p.vy, _D), HEX_S, 0.85, HEX_IMPACT_SPARK);
    ctx.stamp(hull, hit.x, hit.y, 70, 3.4, 1.0, 0.85, 0.2);
    ctx.shake(8, 0.3);
  },
  kerf(ctx, p, hull) {
    kerf(ctx, p.x, p.y, sv(p.vx, p.vy, _D), HEX_S, 0.7, HEX_KERF_SPARK);
    ctx.stamp(hull, p.x, p.y, 34, 3.2, 0.9, 0.85, 0, p.vx, p.vy, 2.2);
    ctx.lights.flash(p.x, p.y, 1.0, 0.7, 0.4, 6, 450, 0.12, 2, 0, 50);
  },
  exit(ctx, p) {
    exitSpray(ctx, p.x, p.y, sv(p.vx, p.vy, _D), 1.2, HEX_S);
  }
};
const HEX_KERF_SPARK = [2.9, 2.1, 1.2];

// ── MJOLNIR (oblężniczy railgun) ─────────────────────────────────────────────
const MJ_PAL = {
  core0: [3.6, 4.2, 4.4], core1: [0.9, 2.2, 2.6], halo0: [1.1, 2.3, 2.6], halo1: [0.08, 0.3, 0.5],
  flare0: [3.0, 3.8, 4.2], flare1: [0.9, 2.2, 2.6], cross: [2.6, 3.6, 4.0],
  p1: [3.4, 4.2, 4.6], p2: [0.9, 2.4, 2.8], p3: [0.3, 0.9, 1.3], p4: [2.4, 3.2, 3.6],
  blob0: [2.2, 3.2, 3.6], blob1: [0.2, 0.35, 0.6], streak: [1.8, 3.0, 3.4], arc: [1.4, 2.8, 3.4],
  vap0: [0.55, 1.3, 1.6], vap1: [0.1, 0.12, 0.3], light: [0.55, 0.9, 1.0]
};
const MJ_COL = [1.6, 2.8, 3.2];
const MJ_GLOW = [1.2, 2.2, 2.2, 1.8, 2.4, 1.8];
const MJ_SPARK = [2.6, 3.0, 3.2];
const MJ_KERF = [2.6, 2.8, 2.6];
RECIPES.mjolnir = {
  scale: 2.4,
  charge(ctx, m, u, dt, cs) {
    hexCharge(ctx, m, u, dt, cs, 1.4 + u, MJ_COL, MJ_GLOW);
    const P = sp(m.x, m.y, _P);
    // strumienie energii zbiegające do wylotu z otoczenia
    if (fxRandom.next() < 30 * dt * u) {
      const a = fxRandom.next() * TAU;
      const r = rand(120, 380);
      _Q.x = P.x + Math.cos(a) * r; _Q.y = P.y + Math.sin(a) * r;
      _T.x = (P.x - _Q.x) / r; _T.y = (P.y - _Q.y) / r;
      E(ctx.fx.arc, 0, 1, _Q, _T).speed(r, r).life(0.06, 0.16).color(1.2, 2.6, 3.2).x01(12 + 20 * u, 1.6).emit();
    }
    ctx.shake(1.5 * u * u, 0.1);
  },
  muzzle(ctx, m) {
    hexFire(ctx, m, 2.4, 1.3, MJ_PAL);
    ctx.shake(18, 0.6);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [1.6, 2.8, 3.0], width: 44, len: 380, streak: 0.001,
      trail: TRAIL.mjolnir, trailWidth: 70, trailSpacing: 110, trailPathUnit: 600, light: [0.55, 0.9, 1.0, 5, 700] };
  },
  impact(ctx, p, hull, hit) {
    hexImpact(ctx, hit.x, hit.y, sv(p.vx, p.vy, _D), 2.6, 1.2, MJ_SPARK);
    ctx.stamp(hull, hit.x, hit.y, 80, 3.8, 1.0, 0.9, 0.5);
    ctx.shake(10, 0.35);
  },
  kerf(ctx, p, hull) {
    kerf(ctx, p.x, p.y, sv(p.vx, p.vy, _D), 2.2, 0.8, MJ_KERF);
    ctx.stamp(hull, p.x, p.y, 38, 3.6, 1.0, 0.9, 0.2, p.vx, p.vy, 2.2);
  },
  exit(ctx, p) {
    exitSpray(ctx, p.x, p.y, sv(p.vx, p.vy, _D), 1.6, 2.4);
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
const VK_COL = [2.6, 1.2, 3.2];
const VK_GLOW = [2.0, 2.0, 0.6, 1.0, 2.2, 2.0];
const VK_SPARK = [3.0, 1.6, 2.6];
const VK_ARC = [2.6, 1.2, 3.4];
const VK_KERF = [3.0, 1.8, 2.6];
const VK_FLY = [2.8, 1.4, 3.0];
RECIPES.valkyrie = {
  scale: 0.55,
  charge(ctx, m, u, dt, cs) {
    hexCharge(ctx, m, u, dt, cs, 0.35, VK_COL, VK_GLOW);
  },
  muzzle(ctx, m) {
    hexFire(ctx, m, 0.42, 0.85, VK_PAL);
    ctx.shake(6, 0.3);
  },
  projectile() {
    return { style: PSTYLE.NEEDLE, color: [2.6, 0.45, 2.8], width: 16, len: 110, streak: 0.0015,
      trail: TRAIL.valkyrie, trailWidth: 24, trailSpacing: 60, trailPathUnit: 260, light: [1.0, 0.3, 1.0, 1.8, 260] };
  },
  fly(ctx, p, x0, y0, x1, y1) {
    const ddx = x1 - x0; const ddy = y1 - y0;
    p.flyAcc += Math.sqrt(ddx * ddx + ddy * ddy);
    if (p.flyAcc < 200) return;
    p.flyAcc = 0;
    const P = sp(x1, y1, _P);
    const D = sv(p.rvx, p.rvy, _D);
    E(ctx.fx.spark, K.SPARK, 3, P, rot(D, rand(-1.9, 1.9), _R)).speed(80, 300).life(0.25, 0.6).drag(1, 1).colors(VK_FLY).x01(40, 0.8).x23(1.1, 1.5).emit();
  },
  impact(ctx, p, hull, hit) {
    const D = sv(p.vx, p.vy, _D);
    hexImpact(ctx, hit.x, hit.y, D, 0.9, 1.0, VK_SPARK);
    hullArcs(ctx, hull, hit.x, hit.y, 6, 30, 110, VK_ARC, 0.1, 0.26, 8);
    ctx.stamp(hull, hit.x, hit.y, 40, 3.4, 0.9, 0.8, 0);
    ctx.shake(5, 0.25);
  },
  kerf(ctx, p, hull) {
    kerf(ctx, p.x, p.y, sv(p.vx, p.vy, _D), 0.9, 0.9, VK_KERF);
    ctx.stamp(hull, p.x, p.y, 18, 3.2, 0.8, 0.78, 0, p.vx, p.vy, 2.4);
  },
  exit(ctx, p) { exitSpray(ctx, p.x, p.y, sv(p.vx, p.vy, _D), 0.9, 0.9); },
  stuck(ctx, p, hull) {
    blast(ctx, p.x, p.y, 60, PAL.goliath, null, 3, 6, 50, 5, 5, 0.6);
    ctx.stamp(hull, p.x, p.y, 40, 3.2, 0.9, 0.7, 0);
  }
};

// ── WIĄZKA CIĄGŁA ────────────────────────────────────────────────────────────
// Barwa ciała z danych broni (vfxColor × BEAM_HDR_K — PROJEKT-BRONI §1.1), reszta z dema.
const BC_ARC = [0.5, 2.6, 2.2];
RECIPES.beamC = {
  beam: { style: BEAM.CONT, width: 8, hdr: 1.6, rampUp: 8, rampDown: 3.2 },
  // co klatkę przy włączonej wiązce: soczewka i punkt trafienia
  emit(ctx, m, hit, charge, dt, hull) {
    const fx = ctx.fx;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    if (fxRandom.next() < 14 * dt) E(fx.arc, 0, 1, P, D).cone(1.8, 0.18).speed(6, 18).life(0.05, 0.12).colors(BC_ARC).x01(2, 1.2).emit();
    ctx.lights.point(m.x, m.y, 0.3, 1.0, 0.85, 2.5 * charge, 160, 30);
    if (!hit) return;
    const H = sp(hit.x, hit.y, _H);
    const N = sv(hit.nx, hit.ny, _N);
    const k = charge;
    E(fx.add, K.GLOW, 1, H, N).life(0.07, 0.07).s0(22 * k, 22 * k).s1(30 * k, 30 * k).color(3.6, 4.0, 3.8).color1(0.8, 2.4, 2.0).mix(12).fade(0.01, 1.5).emit();
    E(fx.spark, K.SPARK, 380 * dt * k, H, N).cone(1.2, 0.18).speed(180, 720).life(0.2, 0.75).drag(0.6, 1.5).color(3.0, 2.3, 1.3).x01(26, 0.32).x23(0.06, 1.4).bounce(0.3).emit();
    E(fx.spark, K.SPARK, 60 * dt * k, H, N).cone(1.4, 0.18).speed(120, 400).life(0.15, 0.35).drag(1, 1).color(1.0, 3.0, 2.6).x01(16, 1.0).x23(1.0, 1.2).emit();
    E(fx.smoke, 0, 14 * dt * k, H, N).cone(0.6, 0.18).speed(30, 90).life(1.4, 2.4).drag(0.9, 0.9).s0(8, 8).s1(30, 50).color(1.6, 0.8, 0.3).color1(0.2, 0.2, 0.21).alpha(0.3, 0.5).fade(0.05, 1.4).grow(0.5).spin(0.8).x01(25, 3).emit();
    E(fx.add, K.VAPOR, 8 * dt * k, H, N).cone(1.1, 0.18).speed(20, 70).life(0.5, 1.0).drag(1.5, 1.5).s0(8, 8).s1(22, 36).color(0.2, 1.4, 1.1).color1(0.02, 0.2, 0.2).mix(2).alpha(0.3, 0.3).fade(0.04, 1.5).grow(0.45).emit();
    E(fx.dist, K.HEAT, 12 * dt * k, H, N).cone(0.8, 0.18).speed(20, 60).life(0.6, 1.1).s0(20, 20).s1(60, 60).alpha(0.6, 0.6).fade(0.1, 1.5).grow(0.5).emit();
    ctx.lights.point(hit.x, hit.y, 0.7, 1.0, 0.85, 5 * k, 260, 30);
    if (hull) ctx.stamp(hull, hit.x, hit.y, 11, 3.2 * k, 0.12, 0.6 * k, 0);
  }
};

// ── WIĄZKA PULSACYJNA ────────────────────────────────────────────────────────
RECIPES.beamP = {
  beam: { style: BEAM.PULSE, width: 7, hdr: 2.2, life: 0.15 },
  muzzle(ctx, m) {
    const fx = ctx.fx;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.GLOW, 1, P, D).life(0.08, 0.08).s0(6, 6).s1(30, 30).color(4.0, 2.0, 2.2).color1(2.4, 0.1, 0.3).mix(14).fade(0.003, 2).emit();
    E(fx.add, K.FLARE, 1, P, D).life(0.1, 0.1).s0(12, 12).s1(44, 44).color(3.0, 0.8, 1.0).color1(2.0, 0.05, 0.2).mix(10).alpha(0.85, 0.85).spin(2).fade(0.004, 2.2).grow(0.35).emit();
    E(fx.spark, K.SPARK, 6, P, D).cone(0.4, 0.18).speed(80, 260).life(0.1, 0.25).drag(1, 1).color(3.0, 0.8, 1.0).x01(10, 0.3).x23(0.4, 1.2).emit();
    ctx.lights.flash(m.x, m.y, 1.0, 0.2, 0.3, 4, 160, 0.12, 2, 0, 30);
    ctx.shake(1.0, 0.1);
  },
  impact(ctx, hull, hit) {
    const fx = ctx.fx;
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(fx.add, K.GLOW, 1, P, N).life(0.1, 0.1).s0(10, 10).s1(80, 80).color(4.0, 2.6, 2.6).color1(2.4, 0.2, 0.3).mix(14).fade(0.004, 2).emit();
    E(fx.add, K.FLARE, 1, P, N).life(0.12, 0.12).s0(20, 20).s1(100, 100).color(3.2, 1.0, 1.2).color1(2.0, 0.1, 0.2).mix(10).alpha(0.8, 0.8).fade(0.004, 2.2).grow(0.35).spin(1).emit();
    E(fx.spark, K.SPARK, 34, P, N).cone(1.2, 0.18).speed(160, 620).life(0.2, 0.7).drag(0.6, 1.4).color(3.0, 2.0, 1.1).x01(24, 0.32).x23(0.08, 1.4).bounce(0.3).emit();
    E(fx.smoke, 0, 2, P, N).cone(1, 0.18).speed(15, 50).life(1.2, 2.0).s0(8, 8).s1(28, 28).color(1.4, 0.4, 0.2).color1(0.2, 0.19, 0.19).alpha(0.35, 0.35).fade(0.05, 1.4).grow(0.5).x01(15, 3).emit();
    E(fx.add, K.VAPOR, 3, P, N).cone(1.2, 0.18).speed(15, 50).life(0.5, 1.0).s0(8, 8).s1(30, 30).color(1.2, 0.1, 0.25).color1(0.2, 0.01, 0.08).mix(2).alpha(0.3, 0.3).fade(0.04, 1.5).grow(0.45).emit();
    ctx.lights.flash(hit.x, hit.y, 1.0, 0.35, 0.3, 6, 240, 0.12, 2, 0, 40);
    if (hull) ctx.stamp(hull, hit.x, hit.y, 14, 3.0, 0.4, 0.6, 0);
  }
};

// ── LASER PD ─────────────────────────────────────────────────────────────────
RECIPES.laserPD = {
  beam: { style: BEAM.PD, width: 3.2, hdr: 2.2, life: 0.09 },
  muzzle(ctx, m) {
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(ctx.fx.add, K.GLOW, 1, P, D).life(0.07, 0.07).s0(3, 3).s1(16, 16).color(2.2, 3.2, 4.2).color1(0.2, 0.8, 2.0).mix(14).fade(0.003, 2).emit();
    ctx.lights.flash(m.x, m.y, 0.4, 0.7, 1.0, 1.5, 90, 0.08, 2, 0, 25);
  },
  impact(ctx, hull, hit) {
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(ctx.fx.add, K.GLOW, 1, P, N).life(0.07, 0.07).s0(5, 5).s1(30, 30).color(3.0, 3.6, 4.2).color1(0.4, 1.2, 2.4).mix(14).fade(0.003, 2).emit();
    E(ctx.fx.spark, K.SPARK, 12, P, N).cone(1.4, 0.18).speed(160, 360).life(0.15, 0.35).drag(1, 1).color(2.0, 2.6, 3.4).x01(14, 0.6).x23(0.9, 1.2).emit();
    if (hull) ctx.stamp(hull, hit.x, hit.y, 6, 2.2, 0.2, 0.3, 0);
  }
};

// ── CIWS ─────────────────────────────────────────────────────────────────────
RECIPES.ciws = {
  scale: 1.0,
  muzzle(ctx, m) {
    const fx = ctx.fx;
    const S = m.scale * this.scale;
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.FLARE, 1, P, D).life(0.04, 0.04).s0(6 * S, 6 * S).s1(16 * S, 16 * S).color(2.6, 3.2, 2.4).color1(0.9, 2.2, 1.4).mix(20).fade(0.003, 2).grow(0.3).spin(3).emit();
    E(fx.spark, K.SPARK, 2, P, D).cone(0.4, 0.18).speed(100 * S, 300 * S).life(0.08, 0.2).drag(1, 1).color(2.4, 3.0, 2.0).x01(6 * S, 0.8).x23(0.5, 1.1).emit();
    if (fxRandom.next() < 0.3) E(fx.smoke, 0, 1, P, D).cone(0.5, 0.18).speed(8, 24).life(0.6, 1.1).s0(2, 2).s1(9, 9).color(0.3, 0.5, 0.35).color1(0.28, 0.29, 0.28).alpha(0.12, 0.12).fade(0.05, 1.3).grow(0.5).x01(6, 5).emit();
    ctx.lights.flash(m.x, m.y, 0.6, 1.0, 0.75, 1.0, 60, 0.04, 1.5, 0, 20);
  },
  projectile() {
    return { style: PSTYLE.TRACER, color: [0.9, 2.6, 1.6], width: 3.6, len: 10, streak: 0.006, trail: -1, light: null };
  },
  impact(ctx, p, hull, hit) {
    const P = sp(hit.x, hit.y, _P);
    const N = sv(hit.nx, hit.ny, _N);
    E(ctx.fx.add, K.GLOW, 1, P, N).life(0.05, 0.05).s0(4, 4).s1(16, 16).color(2.6, 3.0, 2.4).color1(0.8, 1.6, 1.0).mix(20).fade(0.003, 2).emit();
    E(ctx.fx.spark, K.SPARK, 6, P, N).cone(1.2, 0.18).speed(120, 380).life(0.1, 0.35).drag(1, 1).color(2.8, 2.4, 1.6).x01(10, 0.32).x23(0.06, 1.1).emit();
    ctx.stamp(hull, hit.x, hit.y, 4, 1.2, 0.25, 0.2, 0);
  }
};

// ── FLAK ─────────────────────────────────────────────────────────────────────
const FLAK_PAL = {
  core0: [3.4, 3.0, 2.2], core1: [2.4, 1.0, 0.3], flare0: [3.2, 2.6, 1.6], flare1: [2.2, 0.9, 0.25],
  fire0: [3.0, 1.7, 0.6], fire1: [0.9, 0.22, 0.04], gas0: [2.4, 1.2, 0.45], gas1: [0.5, 0.15, 0.04],
  spark: [2.9, 2.4, 1.6], sparkCool: [0.34, 0.08], smokeHot: [0.9, 0.34, 0.08], soot: [0.035, 0.032, 0.03], light: [1.0, 0.72, 0.4]
};
PAL.flak = FLAK_PAL;
const _FLAK_N = { x: 1, y: 0 };
RECIPES.flak = {
  scale: 1.0,
  muzzle(ctx, m, w) {
    const fx = ctx.fx;
    const S = m.scale * this.scale * (w.size === 'Capital' ? 1.4 : 1);
    const P = sp(m.x, m.y, _P);
    const D = sd(m.angle, _D);
    E(fx.add, K.GLOW, 1, P, D).life(0.07, 0.07).s0(5 * S, 5 * S).s1(22 * S, 22 * S).color(3.2, 2.6, 1.6).color1(2.0, 0.8, 0.2).mix(16).fade(0.003, 2).emit();
    E(fx.add, K.FLARE, 1, P, D).life(0.08, 0.08).s0(10 * S, 10 * S).s1(30 * S, 30 * S).color(3.0, 2.2, 1.2).color1(2.0, 0.7, 0.15).mix(12).alpha(0.85, 0.85).spin(2).fade(0.003, 2.2).grow(0.35).emit();
    E(fx.add, K.PLUME, 1, P, D).life(0.07, 0.07).s0(4 * S, 18 * S).s1(4 * S, 8 * S).color(3.0, 1.8, 0.7).emit();
    E(fx.spark, K.SPARK, 8, P, D).cone(0.4, 0.18).speed(100 * S, 320 * S).life(0.12, 0.3).drag(1, 1).color(2.8, 2.2, 1.3).x01(8 * S, 0.32).x23(0.06, 1.2).emit();
    E(fx.smoke, 0, 2, P, D).cone(0.6, 0.18).speed(10 * S, 40 * S).life(1.0, 1.8).drag(1.2, 1.2).s0(3 * S, 3 * S).s1(12 * S, 20 * S).color(1.2, 0.55, 0.2).color1(0.26, 0.25, 0.24).alpha(0.2, 0.3).fade(0.05, 1.3).grow(0.5).spin(1).x01(12, 4).emit();
    ctx.lights.flash(m.x, m.y, 1.0, 0.7, 0.35, 2.5 * S, 110 * S, 0.07, 1.5, 0, 25);
    ctx.shake(0.5 * S, 0.08);
  },
  projectile(size) {
    const big = size === 'Capital' ? 1.4 : size === 'L' ? 1.15 : 1;
    return { style: PSTYLE.FLAK, color: [2.6, 1.85, 0.75], width: 8 * big, len: 12 * big, streak: 0.008, trail: -1, light: null };
  },
  /** Pęknięcie pocisku: R = promień rażenia z MASTER_WEAPONS (95–480 j.). */
  burst(ctx, x, y, R) {
    const fx = ctx.fx;
    const P = sp(x, y, _P);
    const N = _FLAK_N;
    const s = Math.min(3.2, R / 165);
    const pal = FLAK_PAL;
    E(fx.add, K.GLOW, 1, P, N).life(0.08, 0.08).s0(0.1 * R, 0.1 * R).s1(0.55 * R, 0.55 * R).colors(pal.core0, pal.core1).mix(16).fade(0.003, 2.0).grow(0.4).emit();
    E(fx.add, K.FLARE, 1, P, N).life(0.12, 0.12).s0(0.2 * R, 0.2 * R).s1(0.9 * R, 0.9 * R).colors(pal.flare0, pal.flare1).mix(10).alpha(0.85, 0.85).spin(1).fade(0.004, 2.2).grow(0.35).emit();
    E(fx.add, K.FIRE, Math.min(16, 5 + 4 * s), P, N).cone(Math.PI, 0.25).speed(0.3 * R, 1.3 * R).life(0.22, 0.5).drag(3.5, 3.5).s0(0.1 * R, 0.1 * R).s1(0.2 * R, 0.36 * R).colors(pal.fire0, pal.fire1).mix(5).alpha(0.9, 0.9).fade(0.02, 1.3).grow(0.45).spin(1.5).emit();
    // odłamki: smugi po całej kuli rażenia (tak działa flak)
    E(fx.spark, K.SPARK, Math.min(260, 60 + 50 * s), P, N).cone(Math.PI, 0.3).speed(2.2 * R, 5.4 * R).life(0.26, 0.62).drag(2.4, 2.4).colors(pal.spark).x01(0.18 * R + 20, pal.sparkCool[0]).x23(pal.sparkCool[1], 1.6).emit();
    E(fx.debris, K.CHUNK, Math.min(14, 3 + 3 * s), P, N).cone(Math.PI, 0.3).speed(0.8 * R, 2.2 * R).life(0.8, 1.6).drag(1.2, 1.2).s0(1.5, 3).s1(1.5, 3).color(2.6, 1.3, 0.4).color1(0.2, 0.2, 0.2).alpha(1, 1).spin(12).x01(2.2, 0).emit();
    // czarny kłąb flak z ognistym jądrem
    E(fx.smoke, 0, Math.min(12, 4 + 2 * s), P, N).cone(Math.PI, 0.3).speed(0.08 * R, 0.5 * R).life(1.6, 3.0).drag(1.0, 1.0).s0(0.16 * R, 0.24 * R).s1(0.45 * R, 0.8 * R).colors(pal.smokeHot, pal.soot).alpha(0.7, 0.92).fade(0.03, 1.3).grow(0.4).spin(0.7).x01(0.15 * R, 5.0).emit();
    E(fx.dist, K.SHOCK, 1, P, N).life(0.35, 0.35).s0(0.1 * R, 0.1 * R).s1(1.7 * R, 1.7 * R).alpha(0.9, 0.9).fade(0.01, 1.2).emit();
    const ss = Math.sqrt(s);
    ctx.lights.flash(x, y, pal.light[0], pal.light[1], pal.light[2], 5 * ss, R * 2.2, 0.14, 2, 0, 40);
    ctx.lights.flash(x, y, pal.light[0], pal.light[1] * 0.6, pal.light[2] * 0.3, 1.2 * ss, R * 1.5, 0.6, 1.5, 0.6, 40);
    ctx.shake(0.5 * s, 0.12);
  },
  impact(ctx, p, hull, hit) {
    RECIPES.flak.burst(ctx, hit.x, hit.y, (p.flakR || 150) * 0.6);
    ctx.stamp(hull, hit.x, hit.y, (p.flakR || 150) * 0.2, 2.2, 0.8, 0.5, 0);
  }
};

// ── Ogień w wyrwie (po ciężkim trafieniu) ────────────────────────────────────
/**
 * Krok płonącej wyrwy: b = { x, y (świat, bieżąca poza kadłuba), nx, ny (normalna świata),
 * age, dur, power, pal (klucz palety), seed }.
 */
export function burnStep(ctx, b, dt) {
  const fx = ctx.fx;
  const pal = PAL[b.pal] || PAL.armata;
  const u = b.age / b.dur;
  const k = b.power * (1 - u) * (1 - u);
  const P = sp(b.x, b.y, _P);
  const N = sv(b.nx, b.ny, _N);
  const pw = b.power;
  E(fx.add, K.FIRE, 26 * dt * k * 3, P, N).cone(0.9, 0.18).speed(20, 70).life(0.3, 0.6).drag(2, 2).jitter(14 * pw, 0).s0(10 * pw, 10 * pw).s1(28 * pw, 46 * pw).colors(pal.fire0, pal.fire1).mix(4).alpha(0.85, 0.85).fade(0.04, 1.3).grow(0.45).spin(1.5).emit();
  E(fx.smoke, 0, 9 * dt * (0.4 + k), P, N).cone(0.7, 0.18).speed(30, 90).life(1.8, 3.2).drag(0.8, 0.8).jitter(10 * pw, 0).s0(14 * pw, 14 * pw).s1(50 * pw, 90 * pw).colors(pal.smokeHot, pal.soot).alpha(0.3, 0.5).fade(0.06, 1.3).grow(0.45).spin(0.5).x01(30, 2.2).emit();
  E(fx.spark, K.SPARK, 30 * dt * k, P, N).cone(1.2, 0.18).speed(60, 240).life(0.3, 0.8).drag(0.8, 0.8).color(2.8, 1.8, 0.8).x01(14, 0.32).x23(0.06, 1.2).emit();
  if (fxRandom.next() < 3 * dt) E(fx.dist, K.HEAT, 1, P, N).speed(30, 30).life(1.0, 1.0).s0(30 * pw, 30 * pw).s1(80 * pw, 80 * pw).alpha(0.5 * k, 0.5 * k).fade(0.1, 1.5).grow(0.5).emit();
  ctx.lights.point(b.x, b.y, pal.light[0], pal.light[1] * 0.75, pal.light[2] * 0.5, 2.2 * k * (0.75 + 0.25 * Math.sin(b.age * 23 + b.seed)), 220 * pw, 35);
}

/** Wybuch drona / zestrzelonej rakiety (PD, flak) — mały blast dema. */
export function droneBlast(ctx, x, y, size = 40) {
  blast(ctx, x, y, size, PAL.armata, null, 3.14, 7, 50, 7, 5, 0.5);
}

/**
 * Tani błysk (wylot poza LOD / ponad budżet klatki): jeden rdzeń GLOW w barwie broni —
 * odpowiednik dawnego instancjonowanego błysku z weapon3DSystem.
 */
export function cheapMuzzle(ctx, m, r, g, b) {
  const S = Math.max(0.3, m.scale || 1);
  E(ctx.fx.add, K.GLOW, 1, sp(m.x, m.y, _P), sd(m.angle, _D)).life(0.06, 0.06).s0(4 * S, 4 * S).s1(14 * S, 14 * S).color(r, g, b).color1(r * 0.6, g * 0.4, b * 0.3).mix(18).fade(0.003, 2).emit();
}

/** Tani błysk trafienia (ponad budżet klatki). */
export function cheapImpact(ctx, x, y, r, g, b, size = 24) {
  E(ctx.fx.add, K.GLOW, 1, sp(x, y, _P), _FLAK_N).life(0.07, 0.07).s0(size * 0.3, size * 0.3).s1(size, size).color(r, g, b).color1(r * 0.5, g * 0.3, b * 0.2).mix(16).fade(0.003, 2).emit();
}

// ---------------------------------------------------------------------------
// Zdarzenia opóźnione

/**
 * Obsługa zdarzenia opóźnionego (fasada woła ją z nośnikiem zapisanym przy planowaniu).
 * e = { kind, a0…a5 (liczby), ref (encja albo null) }.
 */
export function runAfter(ctx, e) {
  switch (e.kind) {
    case AFTER.TEMPEST_COIL: {
      // a0, a1 — wylot (świat), a2 — kąt, a3 — S, a4 — cofnięcie cewki wzdłuż lufy
      const P = sp(e.a0, e.a1, _P);
      const D = sd(e.a2, _D);
      const S = e.a3;
      const Pk = off(P, D, -e.a4, _Q);
      E(ctx.fx.add, K.GLOW, 1, Pk, D).life(0.07, 0.07).s0(5 * S, 5 * S).s1(13 * S, 13 * S).color(1.4, 2.8, 4.2).color1(0.2, 0.6, 1.6).mix(20).alpha(0.9, 0.9).fade(0.003, 2).emit();
      E(ctx.fx.arc, 0, 2, Pk, perp(D, _T)).cone(2.6, 0.18).speed(4 * S, 9 * S).life(0.04, 0.09).color(1.2, 2.4, 3.8).x01(1.4 * S, 1.2).emit();
      ctx.lights.flash(e.a0, e.a1, 0.4, 0.75, 1.0, 1.8, 90 * S, 0.05, 1.5, 0, 25);
      break;
    }
    case AFTER.TEMPEST_TAIL: {
      const P = sp(e.a0, e.a1, _P);
      const D = sd(e.a2, _D);
      const S = e.a3;
      E(ctx.fx.arc, 0, 2, P, D).cone(1.9, 0.18).speed(5 * S, 15 * S).life(0.05, 0.12).colors(T_ARC_TAIL).x01(1.6 * S, 1.1).emit();
      E(ctx.fx.spark, K.SPARK, 5, P, D).cone(0.5, 0.18).speed(60 * S, 200 * S).life(0.15, 0.4).drag(1, 1).colors(T_SPK_TAIL).x01(14 * S, 1.05).x23(1.2, 1.2).emit();
      break;
    }
    case AFTER.HULL_ARCS: {
      const I = e.a2;
      hullArcs(ctx, e.ref, e.a0, e.a1, Math.round(5 * I), 15 * I, 60 * I, T_ARC2, 0.08, 0.2, 5);
      break;
    }
    case AFTER.YAMATO_SECONDARY:
      yamatoSecondary(ctx, e.a0, e.a1, e.a2, e.a3, e.ref);
      break;
    default:
      break;
  }
}

/** Palety (testy, galeria). */
export { PAL, PAL_KEYS };
