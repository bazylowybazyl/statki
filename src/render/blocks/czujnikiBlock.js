// src/render/blocks/czujnikiBlock.js — blok migawki: obraz czujników (czujka na PPM, granice wykrycia, kontakty).
//
// Strona gry liczy widok (`src/ui/czujkaView.js` → Float64Array `CZUJNIKI_IN`, src/3d/czujniki/czujnikiLayout.js) w
// świecie, a render (`Czujniki.submit`, src/3d/czujniki/czujniki3D.js) rzutuje go kamerą renderu. Blok ma TEN SAM układ
// co `CZUJNIKI_IN`; kopiowany jest nagłówek i zajęte części sekcji (liczniki z nagłówka), reszta strony trójbufora
// zostaje stara i jest poza licznikami. Brak wejścia — nagłówek zerowy (`active` 0, nic nie rysuje).
//
// Rejestracja (strona gry): `packer.addBlock(createCzujnikiBlock())`, w fazie finish `frame.czujniki = wejście`.
// Czysty moduł (bez three, DOM i `window`).
import { CZUJNIKI_IN, CZUJNIKI_MAX } from '../../3d/czujniki/czujnikiLayout.js';

const I = CZUJNIKI_IN;

function copySection(dst, src, base, stride, n, max) {
  const k = Math.max(0, Math.min(max, n | 0));
  if (k) dst.set(src.subarray(base, base + k * stride), base);
}

/** Kopia wejścia czujników `src` do bloku `dst`; `src` null — blok pusty. */
export function packCzujnikiBlock(dst, src) {
  if (!src || src.length < I.size) {
    dst.fill(0, 0, I.header);
    return;
  }
  dst.set(src.subarray(0, I.header), 0);
  if (!(src[I.active] > 0.5)) return;
  copySection(dst, src, I.strBase, I.strStride, src[I.nStr], CZUJNIKI_MAX.struna);
  copySection(dst, src, I.blnBase, I.blnStride, src[I.nBln], CZUJNIKI_MAX.blona);
  copySection(dst, src, I.grnBase, I.grnStride, src[I.nGrn], CZUJNIKI_MAX.granica);
  copySection(dst, src, I.konBase, I.konStride, src[I.nKon], CZUJNIKI_MAX.kontakty);
}

/** Blok do `packer.addBlock` (faza finish — wejście pakuje render() strony). */
export function createCzujnikiBlock() {
  return {
    name: 'czujniki', f64: I.size, phase: 'finish',
    pack(blk, frame) { packCzujnikiBlock(blk.f64, frame.czujniki); }
  };
}

/** Strona renderu: wejście czujników z bloku strony albo null. */
export function czujnikiInputOf(view) {
  return view && view.blocks && view.blocks.czujniki ? view.blocks.czujniki.f64 : null;
}
