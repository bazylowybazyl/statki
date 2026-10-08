// src/3d/sideNozzleFrame.js
//
// DYSZE SIDE TEJ KLATKI (2026-10-07) — lista dla modeli 3D dysz bocznych (src/3d/ships3d/thrusters/sideThruster3D.js,
// partia: src/3d/ships3d/thrusterBatch3D.js, rysuje shipModels3DGame.js). Pisze EngineVfxSystem (engineVfxSystem.js)
// w tej samej pętli co płomień SIDE — ta sama oś obrotu (marker edytora), kierunek wydechu (nozzleDeg w zakresie
// gimbala), ciąg i żar, maskowanie i odpadanie dyszy z kadłubem (hullMounts.js). Model nie liczy dysz drugi raz.
//
// Układ SCENY (x w prawo, y w GÓRĘ = −y świata gry), pozycje w double (świat 5–10 mln j.). Bez three i DOM.
//
// Rozmiar: promień wylotu dzwonu = SIDE_NOZZLE_RADIUS × skala klasy kadłuba (engineVfxScale.js, jak płomień SIDE)
// × skala sprite'a × szerokość płomienia z tunera (VFX_TUNE.sideW) — rdzeń płomienia przy pełnym ciągu wypełnia wylot.
// Płomień zaczyna się w WYLOCIE: oś obrotu + kierunek wydechu × SIDE_NOZZLE_MOUTH × promień (gdy modele są włączone).

/** Promień wylotu dzwonu [j. świata] przy skali klasy 1 (Atlas): nieprzezroczysty rdzeń płomienia SIDE przy pełnym
 *  ciągu ma ±0,38 × 96 / 2 ≈ ±18 j. (engineExhaustBatch.js: szerokość kwadu 96 × (0,4 + 0,6 · ciąg)) — wylot nieco
 *  węższy, płomień w próżni rozchodzi się zaraz za wargą (A/B 2026-10-07: 18 j. — sponsony za duże na widłach Atlasa). */
export const SIDE_NOZZLE_RADIUS = 15;
/** Wylot dzwonu od osi obrotu dyszy (j. lokalne modelu: promień wylotu = 1) — tu zaczyna się płomień SIDE. */
export const SIDE_NOZZLE_MOUTH = 1.8;

export const SIDE_NOZZLE_CAP = 4096;

export const SideNozzleFrame = {
  /** Modele dysz SIDE (i płomień z wylotu dzwonu). Konsola: setSideNozzles3D(false) — A/B bez modeli. */
  enabled: true,
  /** Dysz w tej klatce. */
  count: 0,
  /** Numer klatki (rośnie przy begin) — czytający poznaje, czy lista jest świeża. */
  serial: 0,
  entity: new Array(SIDE_NOZZLE_CAP).fill(null),
  /** Obiekt dyszy (visual.torqueThrusters[i]) — klucz pamięci podręcznej mocowania na modelu 3D. */
  source: new Array(SIDE_NOZZLE_CAP).fill(null),
  // oś obrotu dyszy (marker edytora) w scenie
  x: new Float64Array(SIDE_NOZZLE_CAP),
  y: new Float64Array(SIDE_NOZZLE_CAP),
  // marker w układzie kadłuba (j. renderu przy skali 1, y w dół obrazka) — wysokość mocowania na modelu 3D
  ox: new Float32Array(SIDE_NOZZLE_CAP),
  oy: new Float32Array(SIDE_NOZZLE_CAP),
  // kierunek podstawy (wydech w spoczynku: baseDeg — na zewnątrz burty) i wydechu teraz, jednostkowe, scena
  baseX: new Float32Array(SIDE_NOZZLE_CAP),
  baseY: new Float32Array(SIDE_NOZZLE_CAP),
  dirX: new Float32Array(SIDE_NOZZLE_CAP),
  dirY: new Float32Array(SIDE_NOZZLE_CAP),
  /** Promień wylotu [j. świata] (= skala modelu: j. świata na jednostkę lokalną). */
  radius: new Float32Array(SIDE_NOZZLE_CAP),
  /** Ciąg (wygładzony, 0..1) i żar dyszy (0..1, rośnie przy ciągu, stygnie — stan płomienia SIDE). */
  throttle: new Float32Array(SIDE_NOZZLE_CAP),
  heat: new Float32Array(SIDE_NOZZLE_CAP),

  /** Początek klatki (EngineVfxSystem.update). */
  begin() {
    for (let i = 0; i < this.count; i++) { this.entity[i] = null; this.source[i] = null; }
    this.count = 0;
    this.serial++;
  },

  /** Jedna dysza (bez obiektów pośrednich — gorąca pętla klatki). Zwraca indeks albo −1. */
  push(entity, source, x, y, ox, oy, baseX, baseY, dirX, dirY, radius, throttle, heat) {
    if (this.count >= SIDE_NOZZLE_CAP || !(radius > 0)) return -1;
    if (!(Number.isFinite(x) && Number.isFinite(y))) return -1;
    const i = this.count++;
    this.entity[i] = entity;
    this.source[i] = source;
    this.x[i] = x;
    this.y[i] = y;
    this.ox[i] = ox;
    this.oy[i] = oy;
    this.baseX[i] = baseX;
    this.baseY[i] = baseY;
    this.dirX[i] = dirX;
    this.dirY[i] = dirY;
    this.radius[i] = radius;
    this.throttle[i] = throttle > 0 ? (throttle < 1 ? throttle : 1) : 0;
    this.heat[i] = heat > 0 ? (heat < 1 ? heat : 1) : 0;
    return i;
  },

  /** Czy wśród dysz [from, count) jest oś obrotu bliżej niż d od (x, y) — zdublowane markery edytora (jedna bryła). */
  near(from, x, y, d) {
    const d2 = d * d;
    for (let i = from; i < this.count; i++) {
      const dx = this.x[i] - x, dy = this.y[i] - y;
      if (dx * dx + dy * dy < d2) return true;
    }
    return false;
  }
};

/** Modele dysz SIDE wł./wył. (A/B: płomień wraca na marker edytora). */
export function setSideNozzles3D(on) {
  SideNozzleFrame.enabled = !!on;
  return SideNozzleFrame.enabled;
}

// diagnostyka z konsoli / narzędzi (scripts/webgpu/dysze-side-gra.mjs)
if (typeof window !== 'undefined') {
  window.SideNozzleFrame = SideNozzleFrame;
  window.setSideNozzles3D = setSideNozzles3D;
}
