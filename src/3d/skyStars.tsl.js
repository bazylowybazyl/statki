// src/3d/skyStars.tsl.js
//
// Gwiazdy tła gry w ROZDZIELCZOŚCI EKRANU (materiał mgławicy NebulaSystem, createNebulaMaterial).
// Tekstura tła (public/assets/nebula.webp, wypiekacz nieba src/3d/skybake/, eksport bez gwiazd) niesie
// tylko gładkie warstwy (poświata pasa, pył, obłoki H II): gra powiększa ją 1,7× (1080p) do 3,5× (4K),
// więc gwiazdy wypieczone w tekselach wychodziły rozlane i nieostre (zgłoszenie użytkownika 2026-10-06).
// Tu gwiazdy liczy się per piksel: komórki w TEKSELACH tekstury (gwiazdy przyklejone do nieba — paralaksa,
// zgięcie warpa i rulon jak tekstura), profil Gaussa w PIKSELACH EKRANU całkowany po pikselu (ostre przy
// każdym powiększeniu, bez migotania przy przesuwie podpikselowym). Gęstość gwiazd z jasności gładkiej
// tekstury (pas gęsto, pasma pyłu rzadko — jak gwiazdy tła gasnące za pyłem), barwa z temperatury z odcieniem
// miejsca (poczerwienienie w pyle). Wynik: światło w obrazie WYŚWIETLANYM (liniowo) — dodawane przed
// powrotem do wartości tekstury (acesGryInv), więc jasne gwiazdy łapią bloom gry.
import { Fn, If, Loop, clamp, dot, exp, float, floor, max, mix, pow, smoothstep, sqrt, uint, vec2, vec3 } from 'three/tsl';

const LUMA = [0.2126, 0.7152, 0.0722];

/**
 * Siatki gwiazd: komórka w tekselach tekstury 5120 × 3200, jasność w obrazie wyświetlanym (całka profilu
 * po pikselach: F = Fmin · (Fmax/Fmin)^(u^γ)), profil σ i halo w PIKSELACH ekranu. `near: 2` — sąsiedztwo
 * 2 × 2 (gęste, małe profile), 3 — pełne 3 × 3 (jasne z halo).
 */
export const SKY_STARS_TUNE = Object.freeze({
  grids: Object.freeze([
    Object.freeze({ cell: 1.6, prob: 0.7, fmin: 0.06, fmax: 0.45, gamma: 2.6, sigma: 0.5, halo: 0, haloPx: 1, near: 2, salt: 101 }),
    Object.freeze({ cell: 4.5, prob: 0.5, fmin: 0.25, fmax: 1.8, gamma: 2.2, sigma: 0.55, halo: 0, haloPx: 1, near: 2, salt: 211 }),
    Object.freeze({ cell: 16, prob: 0.24, fmin: 1.0, fmax: 6.0, gamma: 1.9, sigma: 0.62, halo: 0.025, haloPx: 2.6, near: 3, salt: 307 }),
    Object.freeze({ cell: 64, prob: 0.15, fmin: 4.0, fmax: 24.0, gamma: 1.6, sigma: 0.75, halo: 0.04, haloPx: 4.5, near: 3, salt: 401 })
  ]),
  // Gęstość z luminancji gładkiej tekstury (obraz wyświetlany, liniowo): tło nieba → rdzeń pasa.
  densBg: 0.18, lumSky: 0.004, lumCore: 0.028, densMax: 1.25,
  tintMix: 0.35,          // udział odcienia miejsca w barwie gwiazdy (poczerwienienie w pyle)
  pxRef: 0.57,            // teksele na piksel przy 1080p i zoomie 0,45 (zmierzone — docs/webgpu/WYPIEK-NIEBA.md)
  fluxScaleMin: 0.6, fluxScaleMax: 2.0,
  gain: 1.0
});

/** Hasz komórki (lowbias32): u32 × 3 → [0, 1). Płaska funkcja z layoutem. */
const starHash = /*@__PURE__*/ Fn(([ix, iy, salt]) => {
  const h = ix.mul(uint(0x8da6b343)).bitXor(iy.mul(uint(0xd8163841))).bitXor(salt.mul(uint(0xcb1ab31f))).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(0x7feb352d)));
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.assign(h.mul(uint(0x846ca68b)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return float(h.shiftRight(uint(8))).mul(1.0 / 16777216.0);
}).setLayout({ name: 'skyStarHash', type: 'float', inputs: [{ name: 'ix', type: 'uint' }, { name: 'iy', type: 'uint' }, { name: 'salt', type: 'uint' }] });

/** erf (Winitzki, błąd < 2e-4). */
const starErf = /*@__PURE__*/ Fn(([x]) => {
  const x2 = x.mul(x);
  const ax2 = x2.mul(0.147);
  const t = exp(x2.negate().mul(ax2.add(4.0 / Math.PI)).div(ax2.add(1.0)));
  return sqrt(float(1.0).sub(t)).mul(x.sign());
}).setLayout({ name: 'skyStarErf', type: 'float', inputs: [{ name: 'x', type: 'float' }] });

/** Barwa z „temperatury” t ∈ [0, 1]: pomarańcz → biel → błękit (jak wypiekacz). */
const starTint = /*@__PURE__*/ Fn(([t]) => {
  const warm = mix(vec3(1.0, 0.68, 0.45), vec3(1.0, 0.9, 0.78), smoothstep(0.0, 0.18, t));
  const white = mix(warm, vec3(0.98, 0.98, 1.0), smoothstep(0.18, 0.4, t));
  return mix(white, vec3(0.7, 0.8, 1.0), smoothstep(0.62, 1.0, t));
}).setLayout({ name: 'skyStarTint', type: 'vec3', inputs: [{ name: 't', type: 'float' }] });

/**
 * Światło gwiazd piksela w obrazie wyświetlanym (vec3, liniowo). Wklejana (woła funkcje z layoutem).
 * @param p       położenie w tekselach tekstury tła (uv · rozmiar)
 * @param pxT     teksele na piksel ekranu (z pochodnych uv — liczone PRZED gałęziami)
 * @param smooth  gładki obraz wyświetlany w tym miejscu (gęstość i odcień)
 * @param seed    ziarno (uint) — inne niebo, ten sam rozkład
 */
export function skyStarField(p, pxT, smooth, seed, tune = SKY_STARS_TUNE) {
  const lum = max(dot(smooth, vec3(...LUMA)), 1e-5).toVar();
  const dens = clamp(
    float(tune.densBg).add(float(1.0 - tune.densBg).mul(smoothstep(tune.lumSky, tune.lumCore, lum))),
    0.0, tune.densMax
  ).toVar();
  const tintN = clamp(smooth.div(lum), vec3(0.4), vec3(1.8));
  const tint = mix(vec3(1.0), tintN, tune.tintMix).toVar();
  const invPx = float(1.0).div(max(pxT, 1e-4)).toVar();
  // Strumień w pikselach, z częściową kompensacją rozdzielczości (4K: mniejszy profil — jaśniejszy szczyt).
  const fluxScale = clamp(float(tune.pxRef).mul(invPx), tune.fluxScaleMin, tune.fluxScaleMax).mul(tune.gain).toVar();
  const acc = vec3(0).toVar();
  tune.grids.forEach((G, gi) => {
    const cs = float(G.cell);
    const q = p.div(cs).toVar();
    // 2 × 2: blok komórek, których środki otaczają piksel; 3 × 3: komórka piksela ± 1.
    const base = (G.near === 2 ? floor(q.sub(0.5)) : floor(q).sub(1.0)).toVar();
    const span = G.near;
    const inv = float(1.0 / (G.sigma * Math.SQRT2));
    const salt = seed.mul(uint(97)).add(uint(G.salt)).toVar();
    Loop({ start: 0, end: span, type: 'int', condition: '<', name: `sy${gi}` }, (vy) => {
      Loop({ start: 0, end: span, type: 'int', condition: '<', name: `sx${gi}` }, (vx) => {
        const cell = base.add(vec2(float(vx[`sx${gi}`]), float(vy[`sy${gi}`]))).toVar();
        const ix = uint(cell.x.add(65536.0)).toVar();
        const iy = uint(cell.y.add(65536.0)).toVar();
        const h0 = starHash(ix, iy, salt);
        If(h0.lessThan(dens.mul(G.prob)), () => {
          const h1 = starHash(ix, iy, salt.add(uint(1)));
          const h2 = starHash(ix, iy, salt.add(uint(2)));
          const h3 = starHash(ix, iy, salt.add(uint(3)));
          const h4 = starHash(ix, iy, salt.add(uint(4)));
          // Gwiazda w [0,15; 0,85] komórki; odległość w PIKSELACH ekranu.
          const sp = cell.add(vec2(h1, h2).mul(0.7).add(0.15)).mul(cs);
          const d = p.sub(sp).mul(invPx).toVar();
          const gx = starErf(d.x.add(0.5).mul(inv)).sub(starErf(d.x.sub(0.5).mul(inv))).mul(0.5);
          const gy = starErf(d.y.add(0.5).mul(inv)).sub(starErf(d.y.sub(0.5).mul(inv))).mul(0.5);
          const prof = gx.mul(gy).toVar();
          if (G.halo > 0) {
            const rr = dot(d, d).div(G.haloPx * G.haloPx);
            prof.addAssign(pow(rr.add(1.0), float(-2.0)).mul(G.halo));
          }
          const flux = pow(float(G.fmax / G.fmin), pow(h3, float(G.gamma))).mul(G.fmin);
          acc.addAssign(starTint(h4).mul(tint).mul(flux).mul(prof));
        });
      });
    });
  });
  return acc.mul(fluxScale);
}

/** Lustro CPU gęstości (testy). */
export function skyStarDensityCpu(lum, tune = SKY_STARS_TUNE) {
  const t = Math.min(1, Math.max(0, (lum - tune.lumSky) / (tune.lumCore - tune.lumSky)));
  const s = t * t * (3 - 2 * t);
  return Math.min(tune.densMax, Math.max(0, tune.densBg + (1 - tune.densBg) * s));
}
