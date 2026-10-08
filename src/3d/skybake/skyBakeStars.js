// src/3d/skybake/skyBakeStars.js
//
// Pole gwiazd WYPIEKU NIEBA — wspólne dla stylów (galaktyka, mgławica): gwiazdy z komórek czterech
// siatek (od ziarna 1,4 teksela po jasne 64 teksele z halo), rozkład jasności potęgowy, barwa z
// „temperatury”, profil Gaussa całkowany po tekselu (bez migotania podpikselowego). Styl podaje
// funkcję `sampleAt(sp)` — co w punkcie gwiazdy (teksel) decyduje o gęstości (`prob`), barwie
// (`warm` — ciepło) i przepuszczalności pyłu przed gwiazdą TŁA (`trans`, vec3 — poczerwienienie);
// gwiazdy PRZEDNIE (udział `front`) pyłu nie widzą.
import { Fn, If, Loop, clamp, dot, exp, float, mix, pow, smoothstep, sqrt, step, uint, vec2, vec3 } from 'three/tsl';
import { skyHash } from './skyBakeNoise.js';

// Siatki gwiazd: komórka i profil w TEKSELACH eksportu (5120 × 3200), strumień w jednostkach poświaty
// pasa (rdzeń L ≈ 1). Rozkład jasności: F = Fmin · (Fmax/Fmin)^(u^γ) — większość słaba.
export const STAR_GRIDS = Object.freeze([
  { cell: 1.4, prob: 0.62, fmin: 0.6, fmax: 5.0, gamma: 2.6, sigma: 0.5, halo: 0, haloR: 1, salt: 101, bright: false },
  { cell: 4.5, prob: 0.5, fmin: 3.0, fmax: 25, gamma: 2.2, sigma: 0.55, halo: 0, haloR: 1, salt: 211, bright: false },
  { cell: 16, prob: 0.26, fmin: 15, fmax: 160, gamma: 1.9, sigma: 0.65, halo: 0.03, haloR: 2.2, salt: 307, bright: true },
  { cell: 64, prob: 0.15, fmin: 80, fmax: 1000, gamma: 1.6, sigma: 0.8, halo: 0.05, haloR: 3.5, salt: 401, bright: true }
]);

// erf (Winitzki, błąd < 2e-4) — do profilu Gaussa całkowanego po tekselu.
export const skyErf = /*@__PURE__*/ Fn(([x]) => {
  const x2 = x.mul(x);
  const ax2 = x2.mul(0.147);
  const t = exp(x2.negate().mul(ax2.add(4.0 / Math.PI)).div(ax2.add(1.0)));
  return sqrt(float(1.0).sub(t)).mul(x.sign());
}).setLayout({ name: 'skyErf', type: 'float', inputs: [{ name: 'x', type: 'float' }] });

/** Barwa gwiazdy z „temperatury” t ∈ [0, 1]: pomarańcz → biel → błękit. */
export const skyStarTint = /*@__PURE__*/ Fn(([t]) => {
  const warm = mix(vec3(1.0, 0.68, 0.45), vec3(1.0, 0.9, 0.78), smoothstep(0.0, 0.18, t));
  const white = mix(warm, vec3(0.98, 0.98, 1.0), smoothstep(0.18, 0.4, t));
  return mix(white, vec3(0.7, 0.8, 1.0), smoothstep(0.62, 1.0, t));
}).setLayout({ name: 'skyStarTint', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

/**
 * Suma gwiazd w pikselu (vec3, liniowo, jednostki strumienia siatek). Węzły budowane w miejscu wywołania
 * (wewnątrz Fn passu). Opcje (węzły / uniformy):
 *   px         — piksel celu (vec2, środki + 0,5), size — rozmiar celu (vec2), resScale — teksele celu / teksele eksportu,
 *   seed       — ziarno (uniform int), brightness — mnożnik strumienia, density — mnożnik gęstości,
 *   brightMul  — mnożnik jasnych siatek (gęstość ≤ 1,5×, strumień ≥ 1×), front — udział gwiazd przed pyłem,
 *   sampleAt(sp) → { prob, warm, trans } w punkcie gwiazdy (teksel sp obcięty do celu).
 */
export function starFieldNode({ px, size, resScale, seed, brightness, density, brightMul, front, sampleAt }) {
  const acc = vec3(0).toVar();
  const maxPx = size.sub(1.0);
  STAR_GRIDS.forEach((G, gi) => {
    const cs = resScale.mul(G.cell).toVar();
    const base = px.div(cs).floor().toVar();
    const salt = uint(seed).mul(uint(97)).add(uint(G.salt)).toVar();
    const prob = float(G.prob).mul(density).mul(G.bright ? brightMul.min(1.5) : float(1.0));
    const fluxMul = brightness.mul(G.bright ? brightMul.max(1.0) : float(1.0));
    const sigma = resScale.mul(G.sigma).toVar();
    const inv = float(1.0).div(sigma.mul(Math.SQRT2)).toVar();
    Loop({ start: -1, end: 2, type: 'int', condition: '<', name: `gy${gi}` }, (vy) => {
      Loop({ start: -1, end: 2, type: 'int', condition: '<', name: `gx${gi}` }, (vx) => {
        const cell = base.add(vec2(float(vx[`gx${gi}`]), float(vy[`gy${gi}`]))).toVar();
        const ix = uint(cell.x.add(32768.0)).toVar();
        const iy = uint(cell.y.add(32768.0)).toVar();
        const h0 = skyHash(ix, iy, salt);
        const h1 = skyHash(ix, iy, salt.add(uint(1)));
        const h2 = skyHash(ix, iy, salt.add(uint(2)));
        const sp = cell.add(vec2(h1, h2)).mul(cs).toVar();
        const s = sampleAt(clamp(sp, vec2(0.0), maxPx));
        If(h0.lessThan(prob.mul(s.prob)), () => {
          const h3 = skyHash(ix, iy, salt.add(uint(3)));
          const h4 = skyHash(ix, iy, salt.add(uint(4)));
          const h5 = skyHash(ix, iy, salt.add(uint(5)));
          const flux = pow(float(G.fmax / G.fmin), pow(h3, float(G.gamma))).mul(G.fmin).mul(fluxMul);
          const t = pow(h4, float(1.0).add(s.warm.mul(1.2)));
          const fg = step(h5, front);
          const T = mix(s.trans, vec3(1.0), fg);
          const dv = px.sub(sp).toVar();
          const gx = skyErf(dv.x.add(0.5).mul(inv)).sub(skyErf(dv.x.sub(0.5).mul(inv))).mul(0.5);
          const gy = skyErf(dv.y.add(0.5).mul(inv)).sub(skyErf(dv.y.sub(0.5).mul(inv))).mul(0.5);
          const prof = gx.mul(gy).toVar();
          if (G.halo > 0) {
            const R = resScale.mul(G.haloR);
            const rr = dot(dv, dv).div(R.mul(R));
            prof.addAssign(pow(rr.add(1.0), float(-2.2)).mul(G.halo));
          }
          acc.addAssign(skyStarTint(t).mul(T).mul(flux).mul(prof));
        });
      });
    });
  });
  return acc;
}
