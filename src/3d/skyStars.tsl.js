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
import {
  Fn, If, Loop, atan, clamp, dot, exp, float, floor, length, max, mix, normalize, pow, select, smoothstep, sqrt, tan, uint,
  vec2, vec3
} from 'three/tsl';

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

// ── Gwiazdy w PRZESTRZENI KIERUNKÓW (sfera nieba, DECYZJE-2 N3) ───────────────────────────────────────────
// Niebo-sfera (src/3d/sky3D.js, skySphere.tsl.js) liczy gwiazdy z KIERUNKU, nie z tekseli płaszczyzny: komórki na
// ścianach sześcianu w rzucie RÓWNOKĄTNYM (α = atan(u), β = atan(v) ∈ ±π/4 — komórka ma prawie stały kąt, kąt bryłowy
// komórki 0,71–1 nominalnego; gęstość poprawiona o niego, więc gwiazd na steradian jest tyle samo w środku i na brzegu
// ściany). Siatki 1–2 (drobne, bez halo) liczy się na piksel — 2 × 2 komórki każdej (8 komórek zamiast 26 płaszczyzny);
// siatki 3–4 (jasne z halo) rysują się jako kwady na sferze (skySphere.tsl.js — smuga wzdłuż kursu i front wyjścia), a
// w kamerach 3D (bez kwadów) — tu, z sąsiedztwem 3 × 3 (`bright`). Szew ściany obcina tylko gwiazdę leżącą w komórce
// sąsiedniej ściany (σ ≤ 0,55 px — niewidoczne). Profil: Gauss promieniowy o σ_eff² = σ² + 1/12 (piksel jak pudełko),
// znormalizowany — energia gwiazdy stała przy przesuwie podpikselowym (zmienność < 0,5 %).

/** Teksele equirect nieba na radian (6144 / 2π) — gęstości w „tekselach” jak siatki płaszczyzny. */
export const SKY_SPHERE_TEX_PER_RAD = 6144 / (2 * Math.PI);

/**
 * Siatki gwiazd sfery: komórka w TEKSELACH equirect (977,8 / rad), reszta jak SKY_STARS_TUNE.grids. Siatka 1 ma komórkę
 * 1,9 (płaszczyzna 1,6) przy prawdopodobieństwie 0,99 — ta sama liczba gwiazd na steradian, a 2 × 2 komórki mieszczą
 * profil także na brzegu ściany (komórka ≥ 0,7 nominalnej).
 */
export const SKY_SPHERE_STARS = Object.freeze({
  grids: Object.freeze([
    Object.freeze({ cell: 1.9, prob: 0.99, fmin: 0.06, fmax: 0.45, gamma: 2.6, sigma: 0.5, halo: 0, haloPx: 1, salt: 101 }),
    Object.freeze({ cell: 4.5, prob: 0.5, fmin: 0.25, fmax: 1.8, gamma: 2.2, sigma: 0.55, halo: 0, haloPx: 1, salt: 211 }),
    Object.freeze({ cell: 16, prob: 0.24, fmin: 1.0, fmax: 6.0, gamma: 1.9, sigma: 0.62, halo: 0.025, haloPx: 2.6, salt: 307 }),
    Object.freeze({ cell: 64, prob: 0.15, fmin: 4.0, fmax: 24.0, gamma: 1.6, sigma: 0.75, halo: 0.04, haloPx: 4.5, salt: 401 })
  ]),
  fine: 2          // siatki 0..fine-1 liczone na piksel; reszta — kwady (kamera z góry) albo 3 × 3 na piksel (kamery 3D)
});

/**
 * Ściana sześcianu kierunku d (dowolna długość): { A (oś ściany ze znakiem), B, C (osie u, v), face (0–5) } — d / |d_A| =
 * A + B·u + C·v. Węzły TSL (wklejane).
 */
export function skyCubeFace(d) {
  const a = d.abs().toVar();
  const xMaj = a.x.greaterThanEqual(a.y).and(a.x.greaterThanEqual(a.z));
  const yMaj = xMaj.not().and(a.y.greaterThanEqual(a.z));
  const sx = select(d.x.greaterThanEqual(0.0), float(1.0), float(-1.0));
  const sy = select(d.y.greaterThanEqual(0.0), float(1.0), float(-1.0));
  const sz = select(d.z.greaterThanEqual(0.0), float(1.0), float(-1.0));
  const A = select(xMaj, vec3(sx, 0, 0), select(yMaj, vec3(0, sy, 0), vec3(0, 0, sz))).toVar();
  const B = select(xMaj, vec3(0, 1, 0), select(yMaj, vec3(0, 0, 1), vec3(1, 0, 0))).toVar();
  const C = select(xMaj, vec3(0, 0, 1), select(yMaj, vec3(1, 0, 0), vec3(0, 1, 0))).toVar();
  const face = select(xMaj, sx.mul(-0.5).add(0.5), select(yMaj, sy.mul(-0.5).add(2.5), sz.mul(-0.5).add(4.5))).toVar();
  return { A, B, C, face };
}

/** Lustro CPU skyCubeFace (testy, katalog jasnych gwiazd): zwraca face, pisze A, B, C do out (9 liczb). */
export function skyCubeFaceCpu(d, out) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2]);
  const xMaj = ax >= ay && ax >= az;
  const yMaj = !xMaj && ay >= az;
  const s = (v) => (v >= 0 ? 1 : -1);
  if (xMaj) { out.set([s(d[0]), 0, 0, 0, 1, 0, 0, 0, 1]); return d[0] >= 0 ? 0 : 1; }
  if (yMaj) { out.set([0, s(d[1]), 0, 0, 0, 1, 1, 0, 0]); return d[1] >= 0 ? 2 : 3; }
  out.set([0, 0, s(d[2]), 1, 0, 0, 0, 1, 0]); return d[2] >= 0 ? 4 : 5;
}

/** Kąt bryłowy komórki (α, β) względem środka ściany: (1+u²)(1+v²) / (1+u²+v²)^1,5 ∈ [0,71; 1]. */
export function skyCubeCellSolidAngleCpu(alpha, beta) {
  const u = Math.tan(alpha), v = Math.tan(beta);
  return (1 + u * u) * (1 + v * v) / Math.pow(1 + u * u + v * v, 1.5);
}

/**
 * Światło gwiazd piksela kierunku `d` (jednostkowy, układ nieba) w obrazie wyświetlanym (vec3, liniowo). Wklejana.
 * @param d        kierunek nieba
 * @param radPx    radiany na piksel ekranu (kamera z góry: 1 / f; kamery 3D — z pochodnych, liczone przed gałęziami)
 * @param smooth   gładki obraz wyświetlany (gęstość i odcień)
 * @param seed     ziarno (uint)
 * @param o.grids  które siatki (indeksy SKY_SPHERE_STARS.grids) i sąsiedztwo: [{ i, near }]
 */
export function skyStarFieldDir(d, radPx, smooth, seed, o = {}, tune = SKY_STARS_TUNE, sph = SKY_SPHERE_STARS) {
  const list = o.grids || [{ i: 0, near: 2 }, { i: 1, near: 2 }];
  const lum = max(dot(smooth, vec3(...LUMA)), 1e-5).toVar();
  const dens = clamp(
    float(tune.densBg).add(float(1.0 - tune.densBg).mul(smoothstep(tune.lumSky, tune.lumCore, lum))),
    0.0, tune.densMax
  ).toVar();
  const tintN = clamp(smooth.div(lum), vec3(0.4), vec3(1.8));
  const tint = mix(vec3(1.0), tintN, tune.tintMix).toVar();
  // teksele equirect na piksel (jak pxT płaszczyzny) → kompensacja rozdzielczości strumienia
  const pxT = max(radPx.mul(SKY_SPHERE_TEX_PER_RAD), 1e-4);
  const fluxScale = clamp(float(tune.pxRef).div(pxT), tune.fluxScaleMin, tune.fluxScaleMax).mul(tune.gain).toVar();
  const invRad = float(1.0).div(max(radPx, 1e-9)).toVar();
  const F = skyCubeFace(d);
  const dn = d.div(dot(d, F.A)).toVar();               // A + B·u + C·v
  const u = dot(dn, F.B);
  const v = dot(dn, F.C);
  const ab = vec2(atan(u), atan(v)).toVar();           // α, β ∈ ±π/4
  // kąt bryłowy w miejscu piksela (komórki obok mają prawie ten sam)
  const uu = u.mul(u), vv = v.mul(v);
  const sa = uu.add(1.0).mul(vv.add(1.0)).div(pow(uu.add(vv).add(1.0), 1.5)).toVar();
  const faceU = uint(F.face).toVar();
  const acc = vec3(0).toVar();
  for (const { i: gi, near } of list) {
    const G = sph.grids[gi];
    const cs = G.cell / SKY_SPHERE_TEX_PER_RAD;           // komórka [rad]
    const q = ab.div(cs).toVar();
    const base = (near === 2 ? floor(q.sub(0.5)) : floor(q).sub(1.0)).toVar();
    const sigEff = Math.sqrt(G.sigma * G.sigma + 1 / 12);
    const norm = 1 / (2 * Math.PI * sigEff * sigEff);
    const salt = seed.mul(uint(97)).add(uint(G.salt)).add(faceU.mul(uint(7919))).toVar();
    Loop({ start: 0, end: near, type: 'int', condition: '<', name: `dy${gi}` }, (vy) => {
      Loop({ start: 0, end: near, type: 'int', condition: '<', name: `dx${gi}` }, (vx) => {
        const cell = base.add(vec2(float(vx[`dx${gi}`]), float(vy[`dy${gi}`]))).toVar();
        const ix = uint(cell.x.add(65536.0)).toVar();
        const iy = uint(cell.y.add(65536.0)).toVar();
        const h0 = starHash(ix, iy, salt);
        If(h0.lessThan(dens.mul(sa).mul(G.prob)), () => {
          const h1 = starHash(ix, iy, salt.add(uint(1)));
          const h2 = starHash(ix, iy, salt.add(uint(2)));
          const h3 = starHash(ix, iy, salt.add(uint(3)));
          const h4 = starHash(ix, iy, salt.add(uint(4)));
          const sab = cell.add(vec2(h1, h2).mul(0.7).add(0.15)).mul(cs).toVar();
          // gwiazda komórki poza ścianą (|α| lub |β| > π/4) należy do sąsiedniej — bez dubli przy szwie
          If(max(sab.x.abs(), sab.y.abs()).lessThanEqual(Math.PI / 4), () => {
            const sd = normalize(F.A.add(F.B.mul(tan(sab.x))).add(F.C.mul(tan(sab.y))));
            // cięciwa ≈ kąt (dla kątów ~1e-3 rad dokładniej niż acos w float32)
            const r = length(d.sub(sd)).mul(invRad).toVar();
            const prof = exp(r.mul(r).mul(-0.5 / (sigEff * sigEff))).mul(norm).toVar();
            if (G.halo > 0) {
              const rr = r.mul(r).div(G.haloPx * G.haloPx);
              prof.addAssign(pow(rr.add(1.0), float(-2.0)).mul(G.halo));
            }
            const flux = pow(float(G.fmax / G.fmin), pow(h3, float(G.gamma))).mul(G.fmin);
            acc.addAssign(starTint(h4).mul(tint).mul(flux).mul(prof));
          });
        });
      });
    });
  }
  return acc.mul(fluxScale);
}

/** Lustro CPU gęstości (testy). */
export function skyStarDensityCpu(lum, tune = SKY_STARS_TUNE) {
  const t = Math.min(1, Math.max(0, (lum - tune.lumSky) / (tune.lumCore - tune.lumSky)));
  const s = t * t * (3 - 2 * t);
  return Math.min(tune.densMax, Math.max(0, tune.densBg + (1 - tune.densBg) * s));
}
