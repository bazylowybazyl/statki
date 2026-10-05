// src/3d/fog/fogOfWarView.js
//
// Mgła wojny: świat (koła wzroku i sygnatury masy w j. świata gry, double — src/game/fogOfWar.js
// `createFogWorld` / `exportFogWorld`) → uniformy postu dla kamery JEDNEGO renderu (podzielony ekran: każdy widok swój).
// Czysta funkcja (bez GPU) — Core3D woła ją w render() po syncCamera; testy na liczbach.
//
// Układ w shaderze (fogOfWarPost.js): osie sceny (x w prawo, y w górę = −y gry), j. świata względem punktu
// odniesienia kamery — środka kadru (kamera z góry) albo rzutu oka na płaszczyznę gry (kamery 3D).
// Początki kafli szumu liczone tu w double i zawinięte do [0, 1) — shader nie widzi współrzędnych 5–10 mln j.
import { FOG_DATA_LEN, FOG_MAX_CIRCLES, FOG_MAX_MASSES, FOG_TILE_WORLD } from './fogOfWarPost.js';

// Wiatr mgły (kafle / s czasu gry): dwie warstwy w różne strony — chmury się przelewają, nie suną jak tapeta.
export const FOG_WIND_A = Object.freeze([0.00055, 0.00022]);
export const FOG_WIND_B = Object.freeze([-0.00030, 0.00045]);
// Zegar wzoru (wir sygnatur, puls): okres 200π s — sin(1,1 t) i obrót 0,04 t wracają bez skoku.
export const FOG_TIME_WRAP = 200 * Math.PI;

const wrap01 = (v) => v - Math.floor(v);

/**
 * Wpisuje mgłę do uniformów postu (`u` — wpisy createPostUniforms: `.value`). `view`:
 *  { persp, refX, refY — punkt odniesienia (świat gry), zoom, bufW, bufH, camZ (wysokość oka nad płaszczyzną,
 *    kamery 3D), inv — THREE.Matrix4 (obrót oka · odwrotność rzutu; kamery 3D) }.
 * Zwraca liczbę kół w kadrze (−1 — mgła wyłączona).
 */
export function packFogView(u, world, view) {
  if (!u || !u.uFogOn) return -1;
  if (!world || !world.on || !view) {
    u.uFogOn.value = 0;
    return -1;
  }
  const persp = !!view.persp;
  const zoom = Math.max(1e-6, Number(view.zoom) || 1);
  const bufW = Math.max(1, Number(view.bufW) || 1);
  const bufH = Math.max(1, Number(view.bufH) || 1);
  const refX = Number(view.refX) || 0;
  const refY = Number(view.refY) || 0;
  // Kadr w j. świata z zapasem na rulon (zgięty świat pokazuje więcej niż kadr): ×2.
  const halfW = persp ? Infinity : bufW / zoom;
  const halfH = persp ? Infinity : bufH / zoom;

  const dst = u.uFogData.value;
  const C = world.circles;
  let n = 0;
  const total = Math.max(0, world.count | 0);
  for (let i = 0; i < total && n < FOG_MAX_CIRCLES; i++) {
    const o = i * 4;
    const r = C[o + 2];
    if (!(r > 0)) continue;
    const dx = C[o] - refX;
    const dy = C[o + 1] - refY;
    if (Math.abs(dx) > halfW + r || Math.abs(dy) > halfH + r) continue;
    dst[n++].set(dx, -dy, r, C[o + 3] || 0);
  }
  const M = world.masses;
  let m = 0;
  const mTotal = Math.min(FOG_MAX_MASSES, Math.max(0, world.massCount | 0));
  for (let i = 0; i < mTotal; i++) {
    const o = i * 8;
    if (!(M[o + 3] > 0)) continue;
    const base = FOG_MAX_CIRCLES + m * 2;
    if (base + 1 >= FOG_DATA_LEN) break;
    dst[base].set(M[o] - refX, -(M[o + 1] - refY), M[o + 2], M[o + 3]);
    dst[base + 1].set(M[o + 4], M[o + 5], 0, 0);
    m++;
  }
  u.uFogCount.value = n;
  u.uFogMassCount.value = m;
  u.uFogZoom.value = zoom;
  u.uFogBuf.value.set(bufW, bufH);
  u.uFogPersp.value = persp ? 1 : 0;
  if (persp) {
    u.uFogCamZ.value = Math.max(1, Number(view.camZ) || 1);
    if (view.inv) u.uFogInv.value.copy(view.inv);
  }
  const t = Math.max(0, Number(world.time) || 0);
  const T = FOG_TILE_WORLD;
  // osie sceny: y w górę = −y gry
  u.uFogBaseA.value.set(wrap01(refX / T + FOG_WIND_A[0] * t), wrap01(-refY / T + FOG_WIND_A[1] * t));
  u.uFogBaseB.value.set(wrap01(refX / T + FOG_WIND_B[0] * t), wrap01(-refY / T + FOG_WIND_B[1] * t));
  u.uFogTime.value = t % FOG_TIME_WRAP;
  const L = world.look || {};
  u.uFogLook.value.set(
    Number.isFinite(L.density) ? L.density : 1,
    Number.isFinite(L.rim) ? L.rim : 1,
    Number.isFinite(L.under) ? L.under : 1,
    Number.isFinite(L.mass) ? L.mass : 1
  );
  u.uFogOn.value = 1;
  return n;
}
