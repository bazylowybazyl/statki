// src/render/blocks/spaceGasBlock.js — blok migawki: gaz w otwartej przestrzeni (docs/PLAN-gazy-kosmos.md GK-2).
//
// Gra pakuje wejście klatki gazu (`packSpaceGasFrame`, src/game/spaceGasInput.js → Float64Array `SPACE_GAS_IN`:
// kotwica, kamera, obwiednia pasa, wiatr, Słońce, odgazowanie skał, dt gry), a render (`SpaceGas.submit`,
// src/3d/spaceGas/spaceGas.js) czyta tylko tę tablicę. Blok ma TEN SAM układ co `SPACE_GAS_IN`; bez gazu w kadrze
// kopiowany jest sam nagłówek (`active` 0), z gazem — całość (siatka obwiedni ~16 KB).
//
// Rejestracja (strona gry): `packer.addBlock(createSpaceGasBlock())`, w fazie finish `frame.spaceGas = wejście`.
// Czysty moduł (bez three, DOM i `window`).
import { SPACE_GAS_IN } from '../../3d/spaceGas/spaceGasLayout.js';

const I = SPACE_GAS_IN;

/** Kopia wejścia gazu `src` do bloku `dst`; `src` null — gaz wyłączony. */
export function packSpaceGasBlock(dst, src) {
  if (!src || src.length < I.size) {
    dst.fill(0, 0, I.header);
    return;
  }
  if (src[I.active] > 0.5) dst.set(src.subarray(0, I.size), 0);
  else dst.set(src.subarray(0, I.header), 0);
}

/** Blok do `packer.addBlock` (faza finish — wejście pakuje render() strony). */
export function createSpaceGasBlock() {
  return {
    name: 'spaceGas', f64: I.size, phase: 'finish',
    pack(blk, frame) { packSpaceGasBlock(blk.f64, frame.spaceGas); }
  };
}

/** Strona renderu: wejście gazu z bloku strony albo null. */
export function spaceGasInputOf(view) {
  return view && view.blocks && view.blocks.spaceGas ? view.blocks.spaceGas.f64 : null;
}
