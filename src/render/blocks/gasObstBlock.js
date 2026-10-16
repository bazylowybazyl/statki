// src/render/blocks/gasObstBlock.js — blok migawki: przeszkody gazu wybuchów (docs/PLAN-render-worker.md § 3.2, RW-11c).
//
// Gra pakuje wejście klatki przeszkód (`packGasObstacleFrame`, src/game/gasObstacleInput.js → Float64Array
// `GAS_OBST_IN`: statyka hal K-7 i budowli misji, obrysy ruszonych kawałków, kadłuby przy domenach gazu), a reżyser
// wybuchów (`explosionFx.js` → `setObstacleInput`) czyta tylko tę tablicę. Blok ma TEN SAM układ co `GAS_OBST_IN` —
// strona renderu podaje `view.blocks.gasObst.f64` wprost do `setObstacleInput` (`gasObstInputOf`). Kopiowane są
// nagłówek i zajęte zakresy (pudła, obrysy, kadłuby); reszta strony zostaje z poprzednich stron trójbufora i jest
// poza licznikami — konsument czyta tylko `boxes` / `foots` / `hulls` rekordów. Brak wejścia (gra bez reżysera
// wybuchów) = `serial` −1 → `gasObstInputOf` null (jak dawne `setObstacleInput` niewołane).
//
// Rejestracja (strona gry): `packer.addBlock(createGasObstBlock())`, w fazie finish `frame.gasObst = gasObstIn`.
// Czysty moduł (bez three, DOM i `window`).
import { GAS_HULL_REC, GAS_OBST_IN } from '../../3d/gas/gasObstacleLayout.js';

const I = GAS_OBST_IN;
const HS = GAS_HULL_REC.stride;

/** Kopia zajętej części wejścia przeszkód `src` do bloku `dst` (ten sam układ); `src` null — blok pusty. */
export function packGasObstBlock(dst, src) {
  if (!src || src.length < I.size) {
    dst.fill(0, 0, I.header);
    dst[I.serial] = -1;
    return;
  }
  dst.set(src.subarray(0, I.header), 0);
  const nb = Math.max(0, Math.min(I.maxBoxes, src[I.boxes] | 0));
  if (nb) dst.set(src.subarray(I.boxBase, I.boxBase + nb * I.boxStride), I.boxBase);
  const nf = Math.max(0, Math.min(I.maxFoots, src[I.foots] | 0));
  if (nf) dst.set(src.subarray(I.footBase, I.footBase + nf * HS), I.footBase);
  const nh = Math.max(0, Math.min(I.maxHulls, src[I.hulls] | 0));
  if (nh) dst.set(src.subarray(I.hullBase, I.hullBase + nh * HS), I.hullBase);
}

/** Blok do `packer.addBlock` (faza finish — przeszkody pakuje render() po wejściu pyłu hal). */
export function createGasObstBlock() {
  return {
    name: 'gasObst', f64: I.size, phase: 'finish',
    pack(blk, frame) { packGasObstBlock(blk.f64, frame.gasObst); }
  };
}

/** Strona renderu: wejście przeszkód z bloku strony (dla `setObstacleInput`) albo null. */
export function gasObstInputOf(view) {
  const f = view && view.blocks && view.blocks.gasObst ? view.blocks.gasObst.f64 : null;
  return f && f[I.serial] >= 0 ? f : null;
}
