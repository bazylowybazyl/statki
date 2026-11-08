/**
 * Planetoida Hidalgo pod bazą piratów (misja 1) w silniku belek, po stronie gry: TEREN skały i STUDNIA GRAWITACJI dla
 * odłamów brył bazy przed HP 0 habitatu, oraz stan upadku `_baseFall` (index.html), na którym stoją koniec misji i ujęcie.
 *
 *  - TEREN: skała (src/3d/portBuildings/pirateRockLayout.js: kula R z MAPĄ KSZTAŁTU, tą samą, z której render przesuwa
 *    siatkę skały: wierzchołki co 1,4°, między nimi dwuliniowo) jako teren statyczny silnika (DestructorBeams3D.addTerrain).
 *    Bryły zderzają się z powierzchnią w prawie v2. Teren jest od podpięcia bazy, więc odłamy sprzed śmierci habitatu
 *    (szyja, dysk) lądują na skale zamiast znikać pod dnem.
 *  - GRAWITACJA: odłam, który zszedł poniżej `wellBelowZ`, spada ku środkowi skały (gravityWell silnika). Wyżej bryły mają
 *    umowną grawitację habitatu (−z: przechył wieży, pirateBaseNeck.js).
 *  - SPOCZYNEK: bryła w styku ze skałą, wolniej niż `restSpeed` przez `restTime` → ZAMROŻENIE (freezeBody: koszt kroku 0,
 *    kształt po zgniocie zostaje).
 *
 * Sam upadek przy HP 0 rysują wiązane woksele (src/3d/woksele/wGrze.js), a gra idzie zegarem (`startVoxBaseFall`,
 * index.html; reguła `woksele-zawalen`). Bez three i DOM.
 */

import { createPirateRockLayout } from '../../3d/portBuildings/pirateRockLayout.js';

export const PIRATE_FALL_TUNE = {
  // grawitacja skały [j/s²] ku środkowi (stała; r0 > 0: malejąca z kwadratem odległości od środka, g przy r0),
  // `gravityVmax`: sufit prędkości ku środkowi (silnik: gravityWell.vmax)
  gravity: 260,
  gravityVmax: 2500,
  gravityR0: 0,
  // odłam spod habitatu (z poniżej) dostaje grawitację skały
  wellBelowZ: -1600,
  // skała w prawie kontaktu: tarcie, mnożnik pancerza bryły w granicy plastyczności (skała twardsza od blachy)
  rockFriction: 0.85,
  rockArmorMul: 2.0,
  rockRestAngDamp: 6,    // [1/s] tłumienie kołysania bryły leżącej na skale (szeroki styk — silnik: restAngDamp terenu)
  // spoczynek na skale → zamrożenie
  restSpeed: 30,           // [j/s] prędkość środka masy i obwodu (ω · r)
  restTime: 0.6,           // [s]
  restContactWindow: 0.3,  // [s] ostatni styk ze skałą (albo z inną bryłą — stos) najwyżej tyle temu
  restStackTime: 1.2,      // [s] spoczynek bryły leżącej na innej bryle (nie na skale)
  restStackMul: 3,         // próg prędkości bryły na innej bryle × tyle (stos drga od styków)
  restStackPad: 1200,      // [j.] stos zamarza tylko tak blisko skały (bryła na bryle na skale)
  restEmaRate: 4,          // [1/s] wygładzanie prędkości spoczynku
  restSmallNodes: 30,      // drobnica (mniej węzłów) — bez progu obrotu
  restSmallTime: 2,        // [s] drobnica w styku tyle — zamarza (o ile nie leci szybciej niż 8 × restSpeed)
  restTinyNodes: 12,       // drobina (mniej węzłów) na skale — zamarza od razu
  restAssistTime: 3,       // [s] w styku tyle — zamarza przy prędkości chwilowej poniżej 2 × progu
  freezePinCells: 3
};

// Mapa kształtu skały (scripts/planety/male_ciala.py: hidalgo; ścieżka i zakres jak SMALL_BODY_MAPS.hidalgo
// w src/3d/planetMaps.js — test tests/pirateBaseFall.test.mjs pilnuje zgodności) i siatka renderu skały
// (SMALL_BODY_SEGMENTS w src/3d/smallBodyShape.js).
export const PIRATE_ROCK_SHAPE = Object.freeze({
  url: 'assets/planety/solar/small/hidalgo_hf_shape.png',
  range: Object.freeze([-0.05, 0.05]),
  segW: 256,
  segH: 128
});

/** Bajty RGBA mapy kształtu → { w, h, d: Float32Array, poleN, poleS } (jak decodeSmallBodyShape renderu). */
export function decodeRockShape(rgba, w, h, range = PIRATE_ROCK_SHAPE.range) {
  const d = new Float32Array(w * h);
  const lo = range[0];
  const k = (range[1] - range[0]) / 65535;
  for (let i = 0; i < w * h; i++) d[i] = lo + (rgba[i * 4] * 256 + rgba[i * 4 + 1]) * k;
  let sn = 0;
  let ss = 0;
  for (let i = 0; i < w; i++) { sn += d[i]; ss += d[(h - 1) * w + i]; }
  return { w, h, d, poleN: sn / w, poleS: ss / w };
}

// Promień względny mapy w (u, v) dwuliniowo (jak sampleSmallBodyShape renderu).
function sampleShape(s, u, v) {
  const fx = (((u % 1) + 1) % 1) * s.w - 0.5;
  const fy = Math.min(s.h - 1, Math.max(0, (1 - v) * s.h - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = ((x0 % s.w) + s.w) % s.w;
  const xb = (xa + 1) % s.w;
  const yb = Math.min(s.h - 1, y0 + 1);
  const a = s.d[y0 * s.w + xa] * (1 - tx) + s.d[y0 * s.w + xb] * tx;
  const b = s.d[yb * s.w + xa] * (1 - tx) + s.d[yb * s.w + xb] * tx;
  return a * (1 - ty) + b * ty;
}

/**
 * Mapa kształtu z pliku (przeglądarka: fetch + createImageBitmap + OffscreenCanvas). Promise → kształt albo null
 * (brak API / błąd — teren zostaje kulą).
 */
export async function loadPirateRockShape(url = PIRATE_ROCK_SHAPE.url, range = PIRATE_ROCK_SHAPE.range) {
  if (typeof fetch !== 'function' || typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close?.();
    return decodeRockShape(img.data, img.width, img.height, range);
  } catch (err) {
    console.warn('[planetoida] mapa kształtu skały:', err?.message || err);
    return null;
  }
}

// Kwaternion [x, y, z, w] → macierz 3×3 (wiersze), lokalne → nadrzędne.
function quatMat(q) {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)
  ];
}

/**
 * Teren skały dla silnika belek (świat silnika: X = x gry, Y = −y gry, Z = wysokość). rockLayout — createPirateRockLayout(),
 * place — placePirateBase (u, n, toGame), shape — decodeRockShape (null = kula R). Promień w kierunku = R · (1 + d), d —
 * mapa kształtu w WIERZCHOŁKACH siatki renderu skały (SphereGeometry segW × segH; bieguny — średnia wiersza), między
 * nimi dwuliniowo: powierzchnia zderzeń leży tam, gdzie rysuje się skała. Normalna z różnic promienia.
 */
let _rockLayout = null;
export function createPirateRockTerrain(rockLayout, place, shape = null, tune = PIRATE_FALL_TUNE) {
  // układ skały (czysty) — null: domyślny z pirateRockLayout
  if (!rockLayout) rockLayout = _rockLayout || (_rockLayout = createPirateRockLayout());
  const R = rockLayout.R;
  const c = rockLayout.center;
  const g = place.toGame(c[0], c[2], {});
  const ux = place.u.x, uy = place.u.y, nx = place.n.x, ny = place.n.y;
  // silnik → układ bazy (x, h, z): bx = EX·ux − EY·uy, bh = EZ, bz = EX·nx − EY·ny; baza → lokalne kuli: Rᵀ (meshQuat)
  const Q = quatMat(rockLayout.meshQuat);
  const B = [ux, -uy, 0, 0, 0, 1, nx, -ny, 0];   // wiersze: bx, bh, bz
  // M = Qᵀ · B
  const M = new Float64Array(9);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    M[r * 3 + k] = Q[0 * 3 + r] * B[0 * 3 + k] + Q[1 * 3 + r] * B[1 * 3 + k] + Q[2 * 3 + r] * B[2 * 3 + k];
  }
  const W = PIRATE_ROCK_SHAPE.segW, H = PIRATE_ROCK_SHAPE.segH;
  let grid = null;
  let dMax = 0;
  if (shape && shape.d) {
    grid = new Float32Array((W + 1) * (H + 1));
    for (let iy = 0; iy <= H; iy++) {
      for (let ix = 0; ix <= W; ix++) {
        const d = iy === 0 ? shape.poleN : iy === H ? shape.poleS : sampleShape(shape, ix / W, 1 - iy / H);
        grid[iy * (W + 1) + ix] = d;
        if (d > dMax) dMax = d;
      }
    }
  }
  const TWO_PI = Math.PI * 2;
  const relAt = (ex, ey, ez) => {
    if (!grid) return 0;
    const lx = M[0] * ex + M[1] * ey + M[2] * ez;
    const ly = M[3] * ex + M[4] * ey + M[5] * ez;
    const lz = M[6] * ex + M[7] * ey + M[8] * ez;
    let phi = Math.atan2(lz, -lx);
    if (phi < 0) phi += TWO_PI;
    const theta = Math.acos(ly > 1 ? 1 : ly < -1 ? -1 : ly);
    const fx = phi / TWO_PI * W, fy = theta / Math.PI * H;
    let x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    // krawędź siatki (φ = 2π, biegun płd. θ = π): ostatnie oczko z udziałem 1 jego dalszego wierzchołka
    if (x0 >= W) { x0 = W - 1; tx = 1; }
    if (y0 >= H) { y0 = H - 1; ty = 1; }
    const r0 = y0 * (W + 1), r1 = r0 + W + 1;
    const a = grid[r0 + x0] * (1 - tx) + grid[r0 + x0 + 1] * tx;
    const b = grid[r1 + x0] * (1 - tx) + grid[r1 + x0 + 1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const EPS = 0.004;   // [rad] różnice promienia (~64 j. na skale R 16 km)
  const terrain = {
    name: 'planetoida Hidalgo',
    cx: g.x, cy: -g.y, cz: c[1],
    R,
    rMax: R * (1 + Math.max(0, dMax)) + 1,
    friction: tune.rockFriction,
    armorMul: tune.rockArmorMul,
    restAngDamp: tune.rockRestAngDamp,
    onContact: null,
    radius(ex, ey, ez) { return R * (1 + relAt(ex, ey, ez)); },
    // n ∝ ω − (∂r/∂θ₁ / r) t₁ − (∂r/∂θ₂ / r) t₂ (styczne t₁, t₂ ⊥ ω; powierzchnia r(ω) · ω)
    normal(ex, ey, ez, r, out) {
      if (!grid) { out.x = ex; out.y = ey; out.z = ez; return out; }
      // styczna t₁ ⊥ ω (oś najmniej równoległa), t₂ = ω × t₁
      let ax = 0, ay = 0, az = 1;
      if (Math.abs(ez) > 0.9) { ax = 1; az = 0; }
      let t1x = ay * ez - az * ey, t1y = az * ex - ax * ez, t1z = ax * ey - ay * ex;
      const l1 = Math.sqrt(t1x * t1x + t1y * t1y + t1z * t1z) || 1;
      t1x /= l1; t1y /= l1; t1z /= l1;
      const t2x = ey * t1z - ez * t1y, t2y = ez * t1x - ex * t1z, t2z = ex * t1y - ey * t1x;
      const rr = (dx, dy, dz) => {
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        return R * (1 + relAt(dx / l, dy / l, dz / l));
      };
      const g1 = (rr(ex + t1x * EPS, ey + t1y * EPS, ez + t1z * EPS) - rr(ex - t1x * EPS, ey - t1y * EPS, ez - t1z * EPS)) / (2 * EPS);
      const g2 = (rr(ex + t2x * EPS, ey + t2y * EPS, ez + t2z * EPS) - rr(ex - t2x * EPS, ey - t2y * EPS, ez - t2z * EPS)) / (2 * EPS);
      const k = 1 / Math.max(1, r);
      let ox = ex - g1 * k * t1x - g2 * k * t2x;
      let oy = ey - g1 * k * t1y - g2 * k * t2y;
      let oz = ez - g1 * k * t1z - g2 * k * t2z;
      const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1;
      out.x = ox / l; out.y = oy / l; out.z = oz / l;
      return out;
    },
    /** Wysokość powierzchni (z świata) pod punktem gry (x, y) — z góry; −Infinity poza obrysem. */
    surfaceZAt(x, y) {
      const dx = x - terrain.cx, dy = -y - terrain.cy;
      const hd2 = dx * dx + dy * dy;
      if (hd2 > terrain.rMax * terrain.rMax) return -Infinity;
      let z = terrain.cz + Math.sqrt(Math.max(0, R * R - hd2));
      for (let it = 0; it < 3; it++) {
        const ez = z - terrain.cz, l = Math.sqrt(hd2 + ez * ez) || 1;
        const r = terrain.radius(dx / l, dy / l, ez / l);
        if (r * r <= hd2) return -Infinity;
        z = terrain.cz + Math.sqrt(r * r - hd2);
      }
      return z;
    }
  };
  return terrain;
}

// ------------------------------------------------------------------ STAN I KROK

/**
 * Stan upadku (jeden na habitat). Pola `t`, `phase`, `towerImpactT`, `discImpactT` prowadzi przy HP 0 zegar upadku na
 * wokselach (index.html, stepVoxBaseFall), a czyta je misja (`habitatFallDone`) i ujęcie kamery.
 */
export function createFallState() {
  return {
    phase: 'idle',            // 'idle' | 'falling' | 'settled'
    t: 0,                     // [s] od śmierci habitatu
    well: null,               // gravityWell silnika (wspólny obiekt)
    terrain: null,
    towerImpactT: -1,         // [s od startu] umowne uderzenie wieży w skałę
    discImpactT: -1,
    frozen: 0
  };
}

/**
 * Teren skały i zapis styków — raz przy podpięciu bazy (ctx: { engine, terrain, simTime() }). Zwraca terrain (ten sam
 * obiekt) z podpiętym onContact.
 */
export function attachPirateRockTerrain(st, ctx) {
  const T = ctx.terrain;
  if (!T || !ctx.engine) return null;
  st.terrain = T;
  const recs = st.recs || (st.recs = new Map());
  T.onContact = (body, info) => {
    if (!info.doDamage) return;
    let r = recs.get(body);
    if (!r) { r = newRec(); recs.set(body, r); }
    r.lastContact = ctx.simTime();
  };
  ctx.engine.addTerrain(T);
  return T;
}

/** Odpina teren (koniec misji, nowa gra). */
export function detachPirateRockTerrain(st, engine) {
  if (st?.terrain && engine) engine.removeTerrain(st.terrain);
  if (st?.terrain) st.terrain.onContact = null;
  if (st) { st.terrain = null; st.recs?.clear(); }
}

const newRec = () => ({ lastContact: -1e9, restSince: -1, vEma: -1, touchSince: -1 });

function wellFor(st, tune) {
  if (!st.well) st.well = { x: st.terrain.cx, y: st.terrain.cy, z: st.terrain.cz, g: tune.gravity, r0: tune.gravityR0, vmax: tune.gravityVmax };
  st.well.g = tune.gravity;
  st.well.r0 = tune.gravityR0;
  st.well.vmax = tune.gravityVmax;
  return st.well;
}

/**
 * Krok przed HP 0 habitatu (fizyka, po HullBodies.step): grawitacja skały dla odłamów spod habitatu, spoczynek na skale →
 * zamrożenie. ctx: { engine, terrain, simTime(), solids (bryły z ostatniego kroku — HullBodies._solids),
 * isBaseSite(site), tune }. dt — czas gry.
 */
export function stepRockDebris(st, ctx, dt) {
  if (!st || !st.terrain || !(dt > 0)) return;
  const tune = ctx.tune || PIRATE_FALL_TUNE;
  const well = wellFor(st, tune);
  const now = ctx.simTime();
  const solids = ctx.solids || [];
  const recs = st.recs;
  for (let k = 0; k < solids.length; k++) {
    const b = solids[k];
    if (!b || b.dead || b.planar || b.static || b.anchored) continue;
    const world = b.hull?.world;
    if (!world || !world.site || (ctx.isBaseSite && !ctx.isBaseSite(world.site))) continue;
    if (b.gravityWell !== well) {
      if (!(b.pos.z < tune.wellBelowZ)) continue;
      b.gravityWell = well;
    }
    let r = recs.get(b);
    const e = b.entity;
    const onRock = !!r && now - r.lastContact <= tune.restContactWindow;
    const onBody = !!e && Number(e.__contactT) >= now - tune.restContactWindow;
    if (!onRock && !onBody) { if (r) { r.restSince = -1; r.touchSince = -1; } continue; }
    if (!r) { r = newRec(); recs.set(b, r); }
    // stos (styk z bryłą, nie ze skałą) zamarza tylko przy skale: odłam leżący na dysku, który jeszcze trzyma, nie może
    // zamarznąć w powietrzu, kiedy dysk poleci
    if (!onRock && !nearTerrain(st.terrain, b, tune.restStackPad)) { r.restSince = -1; r.touchSince = -1; continue; }
    if (!(r.touchSince >= 0)) r.touchSince = now;
    // drobina (kilka węzłów) na skale — zamarza od razu: odbija się po rzeźbie skały bez końca, a nic nie znaczy w obrazie
    if (onRock && b.activeNodes < tune.restTinyNodes) { settleBody(st, ctx, b, tune); continue; }
    // drobnica w styku dłużej niż restSmallTime (podskakuje na skale, utknęła w zgniecionej wieży) — zamarza, gdy nie leci
    if (b.activeNodes < tune.restSmallNodes && now - r.touchSince >= tune.restSmallTime && (r.vEma < 0 || r.vEma < tune.restSpeed * 8)) {
      settleBody(st, ctx, b, tune);
      continue;
    }
    // prędkość środka masy i obwodu (drobnica: sam ruch — obrót punktu nic nie znaczy), wygładzona: stos brył na
    // skale drga od styków co krok, a leży
    const v = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z);
    const w = b.activeNodes < tune.restSmallNodes ? 0
      : Math.sqrt(b.angVel.x * b.angVel.x + b.angVel.y * b.angVel.y + b.angVel.z * b.angVel.z) * (b.radius || 0);
    const vNow = Math.max(v, w);
    r.vEma = r.vEma < 0 ? vNow : r.vEma + (vNow - r.vEma) * Math.min(1, dt * tune.restEmaRate);
    const lim = onRock ? tune.restSpeed : tune.restSpeed * tune.restStackMul;
    // długi styk (stos, rzeźba skały) — wystarczy prędkość chwilowa poniżej podwójnego progu
    if (now - r.touchSince >= tune.restAssistTime && vNow <= lim * 2) { settleBody(st, ctx, b, tune); continue; }
    if (r.vEma > lim) { r.restSince = -1; continue; }
    if (r.restSince < 0) { r.restSince = now; continue; }
    if (now - r.restSince < (onRock ? tune.restTime : tune.restStackTime)) continue;
    // spoczynek → zamrożenie (kształt po zgniocie zostaje, koszt kroku 0)
    settleBody(st, ctx, b, tune);
  }
}

// Bryła przy skale (odległość od powierzchni ≤ promień ciała + pad).
function nearTerrain(T, b, pad) {
  const dx = b.pos.x - T.cx, dy = b.pos.y - T.cy, dz = b.pos.z - T.cz;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return d - T.radius(dx / d, dy / d, dz / d) <= (b.radius || 0) + pad;
}

// Zamrożenie bryły w spoczynku (silnik: freezeBody).
function settleBody(st, ctx, b, tune) {
  const pins = ctx.engine.freezeBody(b, tune.freezePinCells);
  st.recs?.delete(b);
  if (pins > 0) st.frozen++;
}
