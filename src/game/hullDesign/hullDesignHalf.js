// src/game/hullDesign/hullDesignHalf.js
//
// KREATOR KADŁUBÓW — liczby połówkowe (float16) bez three: ten sam algorytm tablicowy co `DataUtils.toHalfFloat`
// three r183 (fasthalffloatconversion, z obcięciem do ±65504), bit w bit — pilnuje tests/hullDesignBuild.test.mjs.
// Pakowanie tekstur kompozytora (pola poziomów, kopuła, rowki, sieć rur) liczy się dzięki temu w workerze budowy
// (hullDesignBuild.js), a strona tylko wysyła gotowe tablice.

const baseTable = new Uint32Array(512);
const shiftTable = new Uint32Array(512);
for (let i = 0; i < 256; ++i) {
  const e = i - 127;
  if (e < -27) {
    baseTable[i] = 0x0000; baseTable[i | 0x100] = 0x8000;
    shiftTable[i] = 24; shiftTable[i | 0x100] = 24;
  } else if (e < -14) {
    baseTable[i] = 0x0400 >> (-e - 14); baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000;
    shiftTable[i] = -e - 1; shiftTable[i | 0x100] = -e - 1;
  } else if (e <= 15) {
    baseTable[i] = (e + 15) << 10; baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000;
    shiftTable[i] = 13; shiftTable[i | 0x100] = 13;
  } else if (e < 128) {
    baseTable[i] = 0x7c00; baseTable[i | 0x100] = 0xfc00;
    shiftTable[i] = 24; shiftTable[i | 0x100] = 24;
  } else {
    baseTable[i] = 0x7c00; baseTable[i | 0x100] = 0xfc00;
    shiftTable[i] = 13; shiftTable[i | 0x100] = 13;
  }
}
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float → bity float16 (jak DataUtils.toHalfFloat three, bez ostrzeżenia poza zakresem). */
export function toHalfBits(val) {
  f32[0] = Math.max(-65504, Math.min(65504, val));
  const f = u32[0];
  const e = (f >> 23) & 0x1ff;
  return baseTable[e] + ((f & 0x007fffff) >> shiftTable[e]);
}

/** Bity float32 (Uint32, wartość w ±65504) → bity float16 — bez zapisu do widoku (pętle pakowania). */
export function halfFromF32Bits(f) {
  const e = (f >> 23) & 0x1ff;
  return baseTable[e] + ((f & 0x007fffff) >> shiftTable[e]);
}

/**
 * Kanał `c` (0–3) tekstury RGBA16F `out` (Uint16Array, 4 · n) z tablicy Float32Array `src` (n): bity wprost
 * z widoku Uint32 tej samej pamięci (wartości w ±65504 — pola, kopuła, rury; poza zakresem — przez obcięcie).
 */
export function packHalfChannel(out, c, src) {
  const n = src.length;
  const bits = new Uint32Array(src.buffer, src.byteOffset, n);
  for (let i = 0; i < n; i++) {
    const v = src[i];
    let f = bits[i];
    if (v > 65504 || v < -65504) { f32[0] = v > 0 ? 65504 : -65504; f = u32[0]; }
    const e = (f >> 23) & 0x1ff;
    out[i * 4 + c] = baseTable[e] + ((f & 0x007fffff) >> shiftTable[e]);
  }
  return out;
}
