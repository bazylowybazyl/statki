// src/game/hullDesign/hullDesignCargo.js
//
// KREATOR KADŁUBÓW — ŁADUNEK statków cywilnych (czysty: bez three i DOM; testy tests/hullDesignCargo.test.mjs).
//
//   ładownia `cargo`        v 0 — wrota, v 1 — klapa (ładunek w środku, niewidoczny), v 2 — STELAŻ KONTENERÓW (otwarty
//                           pokład: kontenery w siatce), v 3 — ZASOBNIKI (pudła n × n kontenerów, n — pole modułu,
//                           domyślnie 2);
//   zbiornik ładunku        `cargo_tank` v 0 — walce wzdłuż osi modułu, v 1 — kule; n — rzędów w poprzek (paliwo
//                           własne okrętu to `fuel_tank`; zbiornik ładunku nie ma rur do reaktora, tylko kabel pompy).
//
// Kontener = kontener gry (src/data/cargoBays.js — CARGO_CONTAINER 16 × 8 j., CARGO_TONNES_DEFAULT t), więc ładowność
// z kreatora mówi to samo co przeładunek w porcie (E12). Siatkę komórek liczy też kompozytor (src/3d/hullDesign/
// hullComposer.js — gałęzie ładowni i zbiornika, stałe z HD_CARGO): zmiana rachunku tu = zmiana rysunku tam.
// Załadunek (`cargoLoad` projektu, 0–1) to WYGLĄD: część komórek stelaża / zasobników pusta (hash komórki ≥ załadunek),
// pole, sieć i ciało gry bez zmian (hullDesignLookKey go pomija).

import { CARGO_CONTAINER, CARGO_TONNES_DEFAULT } from '../../data/cargoBays.js';

export const HD_CARGO = Object.freeze({
  L: CARGO_CONTAINER.L,            // kontener wzdłuż osi modułu [j.]
  W: CARGO_CONTAINER.W,            // w poprzek [j.]
  gap: 1.0,                        // odstęp między kontenerami / zasobnikami stelaża [j.]
  podGap: CARGO_CONTAINER.gap,     // szczelina między kontenerami w zasobniku [j.]
  frameDu: 2.2,                    // rama stelaża, ładowni i zbiorników [jd] (× detal projektu → j.)
  podN: 2,                         // zasobnik domyślnie 2 × 2 kontenery
  tonnes: CARGO_TONNES_DEFAULT,    // t na kontener
  // zbiorniki: ładunek w kontenerach zastępczych na siatce n = 1 tego samego obrysu × wypełnienie (walec / kula)
  tankFill: Object.freeze([0.785, 0.52])
});

/** Wariant ładowni z kontenerami na wierzchu (stelaż, zasobniki). */
export const isOpenCargo = (m) => m?.type === 'cargo' && (m.v || 0) >= 2;

/**
 * Siatka komórek ładowni (`cargo`) albo obrysu zbiornika przy detalu projektu `detail`: { n (kontenerów na bok komórki),
 * cellL, cellW (wymiary komórki [j.]), pitchX, pitchY, nx, ny, cells, containers, frame [j.] }. Komórka stelaża = 1
 * kontener, zasobnika = n × n; wrota i klapa liczą ładunek jak stelaż (kontenery pod pokrywą).
 */
export function hullCargoGrid(m, detail) {
  const n = m?.type === 'cargo' && (m.v || 0) === 3 ? Math.max(1, m.n || HD_CARGO.podN) : 1;
  const cellL = n * HD_CARGO.L + (n - 1) * HD_CARGO.podGap;
  const cellW = n * HD_CARGO.W + (n - 1) * HD_CARGO.podGap;
  const pitchX = cellL + HD_CARGO.gap, pitchY = cellW + HD_CARGO.gap;
  const frame = HD_CARGO.frameDu * detail;
  const iw = 2 * ((m?.w || 0) - frame), ih = 2 * ((m?.h || 0) - frame);
  const nx = Math.max(0, Math.floor((iw + HD_CARGO.gap) / pitchX));
  const ny = Math.max(0, Math.floor((ih + HD_CARGO.gap) / pitchY));
  return { n, cellL, cellW, pitchX, pitchY, nx, ny, cells: nx * ny, containers: nx * ny * n * n, frame };
}

/**
 * Pół-wymiary modułu ładunku `m` (typ, wariant, n) mieszczące `nx` × `ny` komórek siatki przy detalu `detail` —
 * hullCargoGrid w odwrotną stronę (kontener ma stały rozmiar 16 × 8 j., moduł skaluje się z detalem okrętu).
 */
export function hullCargoBox(m, detail, nx = 1, ny = 1) {
  const g = hullCargoGrid({ ...m, w: 0, h: 0 }, detail);
  const r1 = (v) => Math.ceil(v * 10) / 10;
  return { w: r1((nx * g.pitchX - HD_CARGO.gap) / 2 + g.frame + 0.2), h: r1((ny * g.pitchY - HD_CARGO.gap) / 2 + g.frame + 0.2) };
}

/** Moduł ładunku (`cargo`, `cargo_tank`) co najmniej na jedną komórkę siatki — zmienia `o.w` / `o.h`; inne typy bez zmian. */
export function hullCargoFit(o, detail) {
  if (o?.type !== 'cargo' && o?.type !== 'cargo_tank') return o;
  const min = hullCargoBox(o.type === 'cargo' ? o : { type: 'cargo_tank' }, detail, 1, 1);
  o.w = Math.max(o.w || 0, min.w);
  o.h = Math.max(o.h || 0, min.h);
  return o;
}

/**
 * Ładunek projektu z modułów rozwiniętych (kopie lustra osobno): { containers (miejsc na kontenery), tonnes, holds
 * (ładowni), tanks (zbiorników ładunku), tankTonnes }. Zbiornik: kontenery zastępcze siatki n = 1 × wypełnienie walca / kuli.
 */
export function hullDesignCargo(modules, detail) {
  let containers = 0, holds = 0, tanks = 0, tankTonnes = 0;
  for (const m of modules) {
    if (m.type === 'cargo') { holds++; containers += hullCargoGrid(m, detail).containers; }
    else if (m.type === 'cargo_tank') {
      tanks++;
      const g = hullCargoGrid({ w: m.w, h: m.h }, detail);
      tankTonnes += g.containers * HD_CARGO.tonnes * HD_CARGO.tankFill[(m.v || 0) >= 1 ? 1 : 0];
    }
  }
  tankTonnes = Math.round(tankTonnes);
  return { containers, holds, tanks, tankTonnes, tonnes: containers * HD_CARGO.tonnes + tankTonnes };
}
