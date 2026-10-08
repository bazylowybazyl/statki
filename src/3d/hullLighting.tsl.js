// src/3d/hullLighting.tsl.js
//
// Oświetlenie kadłubów v2 w TSL (strona CPU i opis modelu: src/3d/hullLighting.js). Funkcje
// budujące węzły dla grafu kadłuba (hexShips3D.tsl.js) — graf raz na wariant, wartości wspólne
// z HullLighting.uniforms (grupa render).
//
// Układy: normalna LOKALNA = układ sprite'a (x w prawo obrazu, y W GÓRĘ obrazu, z do kamery);
// ŚWIAT = scena (x, −y gry, z) — normalna świata = obrót lokalnej o uRotation. Kamera ortho
// patrzy z góry: V = (0, 0, 1) w obu układach (obrót wokół z go nie zmienia), więc BRDF można
// liczyć w dowolnym z nich.
import {
  Fn, float, vec2, vec3,
  clamp, dot, max, min, mix, normalize, smoothstep, sqrt
} from 'three/tsl';
import { HullLighting } from './hullLighting.js';

const PI = Math.PI;

/**
 * GGX (Trowbridge–Reitz) + widoczność Smitha (skorelowana, przybliżenie) + Schlick (F0 0,04),
 * widz z góry (V = (0, 0, 1)). Zwraca π · D · Vis · F · N·L — w jednostkach gry (rozproszone =
 * albedo × natężenie × N·L, bez 1/π), więc mnożnik połysku jest „na oko” porównywalny z albedo.
 * Funkcja CZYSTA (wejścia tylko z parametrów) i płaska (nie woła innych funkcji z layoutem —
 * pułapka 35).
 */
export const hullGgx = /*@__PURE__*/ Fn(([N, L, rough]) => {
  const H = normalize(L.add(vec3(0.0, 0.0, 1.0)));
  const NdotL = max(dot(N, L), 0.0);
  const NdotV = max(N.z, 0.001);
  const NdotH = max(dot(N, H), 0.0);
  const VdotH = clamp(H.z, 0.0, 1.0);
  const a = rough.mul(rough);
  const a2 = a.mul(a);
  const d = NdotH.mul(NdotH).mul(a2.sub(1.0)).add(1.0);
  const D = a2.div(d.mul(d).mul(PI).add(1e-6));
  const one = float(1.0);
  const gv = NdotL.mul(sqrt(NdotV.mul(NdotV).mul(one.sub(a2)).add(a2)));
  const gl = NdotV.mul(sqrt(NdotL.mul(NdotL).mul(one.sub(a2)).add(a2)));
  const vis = float(0.5).div(max(gv.add(gl), 1e-5));
  // Schlick mnożeniem (bez pow — pułapka 3; podstawa i tak ≥ 0)
  const x = one.sub(VdotH);
  const x2 = x.mul(x);
  const F = float(0.04).add(float(0.96).mul(x2.mul(x2).mul(x)));
  return D.mul(vis).mul(F).mul(NdotL).mul(PI);
}).setLayout({
  name: 'hullGgx',
  type: 'float',
  inputs: [{ name: 'N', type: 'vec3' }, { name: 'L', type: 'vec3' }, { name: 'rough', type: 'float' }]
});

/** Lustro CPU hullGgx (testy). N, L — tablice [x, y, z] jednostkowe. */
export function hullGgxCpu(N, L, rough) {
  let hx = L[0]; let hy = L[1]; let hz = L[2] + 1;
  const hl = Math.hypot(hx, hy, hz) || 1;
  hx /= hl; hy /= hl; hz /= hl;
  const NdotL = Math.max(0, N[0] * L[0] + N[1] * L[1] + N[2] * L[2]);
  const NdotV = Math.max(0.001, N[2]);
  const NdotH = Math.max(0, N[0] * hx + N[1] * hy + N[2] * hz);
  const VdotH = Math.min(1, Math.max(0, hz));
  const a = rough * rough;
  const a2 = a * a;
  const d = NdotH * NdotH * (a2 - 1) + 1;
  const D = a2 / (d * d * PI + 1e-6);
  const gv = NdotL * Math.sqrt(NdotV * NdotV * (1 - a2) + a2);
  const gl = NdotV * Math.sqrt(NdotL * NdotL * (1 - a2) + a2);
  const vis = 0.5 / Math.max(gv + gl, 1e-5);
  const x = 1 - VdotH;
  const F = 0.04 + 0.96 * x * x * x * x * x;
  return D * vis * F * NdotL * PI;
}

/** Dekodowanie normalnej z mapy powierzchni (R, G = xy × 0,5 + 0,5; z odtworzone). */
export function surfaceNormal(surf) {
  const xy = surf.xy.mul(2.0).sub(1.0).toVar();
  return vec3(xy, sqrt(max(0.0, float(1.0).sub(dot(xy, xy)))));
}

/**
 * Relief paneli z kanału A mapy powierzchni [px sprite'a] (hullSurfaceBake.js: A = 0,5 + h / 2R).
 */
export function surfaceRelief(a, heightRange) {
  return a.sub(0.5).mul(2.0 * heightRange);
}

// Kroki marszu samocienia [px sprite'a] — relief paneli ±5 px przy słońcu 35° rzuca cień ~7 px;
// dalsze kroki łapią wyższe wnęki i krawędzie kopuły przy sylwetce.
export const SELF_SHADOW_STEPS = Object.freeze([1.5, 3.0, 5.0, 8.0, 12.0, 18.0]);

/**
 * Samocień reliefu: marsz po wysokości ku słońcu (kierunek w układzie sprite'a, y w górę) w px
 * sprite'a; przeszkoda wyższa niż promień słońca (d · tg wysokości) gasi klucz z miękkim brzegiem.
 * `sampleA(uv)` — próbka kanału A mapy w uv (mipmapy z pochodnych: wołać w jednolitym przepływie).
 * Zwraca 0..1 (1 = bez cienia).
 */
export function hullSelfShadow({ uv, spriteSize, sunLocal, tanEl, lengthK, heightRange, sampleA }) {
  // krok uv na px sprite'a ku słońcu: x obrazu = x lokalne, y obrazu = −y lokalne
  const stepUV = vec2(sunLocal.x.div(spriteSize.x), sunLocal.y.negate().div(spriteSize.y)).mul(lengthK).toVar();
  const h0 = surfaceRelief(sampleA(uv), heightRange).toVar();
  const occ = float(0.0).toVar();
  for (const d of SELF_SHADOW_STEPS) {
    const hs = surfaceRelief(sampleA(uv.add(stepUV.mul(d))), heightRange);
    const rise = hs.sub(h0).sub(tanEl.mul(lengthK).mul(d));
    occ.assign(max(occ, rise.div(lengthK.mul(d * 0.12).add(1.2))));
  }
  return float(1.0).sub(clamp(occ, 0.0, 1.0));
}

/**
 * Model v2 dla słońca, nieba i wypełnienia (bez lamp i świateł efektów — te w pętlach grafu).
 *   albedo   vec3 — barwa blachy (liniowo, po osmaleniu ran)
 *   N        vec3 — normalna świata (szczegółowa)
 *   sunXY    vec2 — azymut słońca w świecie (jednostkowy)
 *   keyVis   float — widoczność słońca: maska Core3D × samocień
 *   ao       float — AO z mapy powierzchni
 *   skyField float — przygaszenie nieba w mroku pola asteroid (sunFill(1))
 *   rough    float — szorstkość (domyślnie farba z uMat.x; osmalona blacha — wyżej)
 * Zwraca { color, keyL } — kolor (bez emisji, lakieru i lamp) i kierunek klucza (świat).
 */
export function hullPbrSun({ albedo, N, sunXY, keyVis, ao, skyField, rough = null }) {
  const U = HullLighting.uniforms;
  const keyL = vec3(sunXY.mul(U.uKeyElev.x), U.uKeyElev.y).toVar();
  const ndl = max(dot(N, keyL), 0.0);
  const key = U.uKeyColor.mul(keyVis).toVar();
  const spec = hullGgx(N, keyL, rough || U.uMat.x).mul(U.uMat.y);
  const up = clamp(N.z, 0.0, 1.0);
  const sky = U.uSkyHorizon.add(U.uSkyZenith.sub(U.uSkyHorizon).mul(up)).mul(ao).mul(skyField);
  const fillL = vec3(sunXY.negate().mul(U.uFillElev.x), U.uFillElev.y);
  const fill = U.uFillColor.mul(max(dot(N, fillL), 0.0)).mul(ao).mul(skyField);
  const color = albedo.mul(key.mul(ndl).add(sky).add(fill)).add(key.mul(spec));
  return { color, keyL };
}

/**
 * Światło punktowe nad blachą (lampy kadłuba) w układzie LOKALNYM sprite'a.
 *   toFrag  vec2 — fragment − lampa [px obrazu, y w dół]
 *   zPx     float — wysokość lampy nad blachą [px]
 *   r0      float — promień jądra zaniku [px] (natężenie pełne bliżej, dalej ~1/d²)
 *   rangePx float — zasięg (okno do zera)
 * Zwraca { dir, att } — kierunek do lampy (lokalnie, jednostkowy) i tłumienie.
 */
export function hullLampFalloff(toFrag, zPx, r0, rangePx) {
  const toL = vec3(toFrag.x.negate(), toFrag.y, zPx).toVar();
  const d2 = max(dot(toL, toL), 1e-4).toVar();
  const dir = toL.div(sqrt(d2));
  const xr = min(sqrt(dot(toFrag, toFrag)).div(max(rangePx, 1.0)), 1.0);
  const win = float(1.0).sub(xr.mul(xr));
  const r02 = r0.mul(r0);
  const att = win.mul(win).mul(r02.div(d2.add(r02)));
  return { dir, att };
}

/** Lustro CPU hullLampFalloff (testy): zwraca tłumienie. */
export function hullLampFalloffCpu(tx, ty, zPx, r0, rangePx) {
  const d2 = Math.max(1e-4, tx * tx + ty * ty + zPx * zPx);
  const xr = Math.min(Math.hypot(tx, ty) / Math.max(rangePx, 1), 1);
  const win = 1 - xr * xr;
  return win * win * (r0 * r0) / (d2 + r0 * r0);
}

/**
 * Zanik świateł efektów na kadłubach (siatka świateł): siatka podaje `att` z zaniku pola gry
 * win² / (1 + 4x²) (× stożek × cień) — tu skupiony do jądra: × (1 + 4x²) · c² / (x² + c²),
 * c = uEffect.y. Przy x = 0 bez zmian, przy x = 0,3 ~3× ciemniej, przy 0,5 ~4× — kałuża światła
 * przy wylocie zamiast białego kadłuba.
 */
export function hullEffectAtt(att, x) {
  const c = HullLighting.uniforms.uEffect.y;
  const x2 = x.mul(x);
  const c2 = c.mul(c);
  return att.mul(x2.mul(4.0).add(1.0)).mul(c2.div(x2.add(c2)));
}

/** Lustro CPU hullEffectAtt dla światła dookólnego bez cienia (testy). */
export function hullEffectAttCpu(x, c) {
  const win = 1 - x * x;
  const gridAtt = (win * win) / (x * x * 4 + 1);
  return gridAtt * (x * x * 4 + 1) * (c * c) / (x * x + c * c);
}

/** Maska emisji (niebieskie panele) z albedo — klasyczny model brał ją z koloru w pełnym słońcu.
 *  Krawędzie smoothstep rosnące (odwrócone stałe = błąd WGSL, pułapka 6). */
export function hullGlowMask(albedo) {
  return smoothstep(0.42, 0.55, albedo.z).mul(float(1.0).sub(smoothstep(0.15, 0.25, albedo.x)));
}

// Światła siatki dzielą się na BŁYSKI EFEKTÓW (lufy, trafienia, wybuchy, pociski, wiązki: moc 1–18 na
// zasięg 60–1100 j. → moc / zasięg ≥ ~0,01) i ŚWIATŁA POLA (światło dookoła okrętu, reflektory i lampy
// w pasie asteroid: ≤ ~0,003). Skupiony zanik i mnożnik efektów dotyczą tylko błysków — światło dookoła
// ma oświetlać kadłub w mroku pola równo, jak dawniej (EFFECT_FIELD_GAIN = albedo dema broni).
export const EFFECT_FLASH_RATIO = Object.freeze([0.002, 0.008]);
export const EFFECT_FIELD_GAIN = 0.85 * (1 - 0.3 * 0.85);

/** Lustro CPU wagi „błysk efektu” (0 = światło pola, 1 = błysk) — testy. */
export function effectFlashWeightCpu(peak, range) {
  const [e0, e1] = EFFECT_FLASH_RATIO;
  const t = Math.min(1, Math.max(0, (peak / Math.max(range, 1) - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Światła efektów (siatka świateł — błyski luf, trafienia, pociski, wiązki; światła pola) na kadłubie,
 * model v2: BRDF klucza (Lambert + GGX); błyski — zanik skupiony (hullEffectAtt) i mnożnik efektów,
 * światła pola — zanik siatki i dawny mnożnik.
 * ctx: albedo (po osmaleniu), worldNormal, woundScorch (opcjonalnie — osmalona blacha matowa).
 */
export function hullEffectLightingPbr(ctx, grid, owner) {
  const U = HullLighting.uniforms;
  const sum = vec3(0.0).toVar();
  const N = ctx.worldNormal;
  const albedo = ctx.albedo;
  const rough = ctx.woundScorch ? min(U.uMat.x.add(ctx.woundScorch.mul(0.45)), 1.0).toVar() : U.uMat.x;
  const P = grid.localPosition().toVar();
  grid.loop(P, ({ toL, att, col, x, range }) => {
    const peak = max(col.x, max(col.y, col.z));
    const flash = smoothstep(EFFECT_FLASH_RATIO[0], EFFECT_FLASH_RATIO[1], peak.div(max(range, 1.0))).toVar();
    const a = mix(att, hullEffectAtt(att, x), flash);
    const c = col.mul(a).mul(mix(float(EFFECT_FIELD_GAIN), U.uEffect.x, flash)).toVar();
    sum.addAssign(albedo.mul(c).mul(max(dot(N, toL), 0.0)));
    sum.addAssign(c.mul(hullGgx(N, toL, rough)).mul(U.uMat.y));
  }, owner);
  return sum;
}
