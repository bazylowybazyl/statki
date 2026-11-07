// src/game/sector/sectorExploration.js
//
// MGŁA EKSPLORACJI mapy gwiezdnej — co gracz wie o układach. Poziomy:
//   0 UKRYTY   — układ w gęstej mgławicy pogranicza: nie widać nawet gwiazdy, póki statek nie podleci
//                na zasięg czujników (× mnożnik mgławicy przy statku i przy gwieździe);
//   1 GWIAZDA  — widać gwiazdę (klasa = barwa i rozmiar kropki), numer katalogu, bez nazwy i zawartości;
//   2 ZESKANOWANY — nazwa, planety (rodzaje), pasy — po `scanTime` s w zasięgu skanu;
//   3 ODWIEDZONY — wszystko (właściciel, kryjówka piratów, brama), po wejściu w studnię układu
//                (`ZONE.jumpRadius`) albo do układu.
// Rdzeń zamieszkany jest znany od startu (3) — mapy rdzenia; pogranicze startuje od 1 (w mgławicy ≥ 0,45 — 0).
// Stan to dane ZAPISU GRACZA (`serializeExploration` — tablica poziomów w kolejności układów + wersja
// i ziarno sektora). Moduł czysty; `updateExploration` bez alokacji poza zdarzeniami (rzadkie).

import { SECTOR_FLIGHT } from './sectorFlight.js';
import { ZONE } from './sectorZone.js';

export const EXPLORE = Object.freeze({ HIDDEN: 0, SEEN: 1, SCANNED: 2, VISITED: 3 });
export const EXPLORE_LABELS = Object.freeze(['ukryty', 'gwiazda', 'zeskanowany', 'odwiedzony']);

/** Próg gęstości mgławicy przy gwieździe, od którego układ pogranicza startuje ukryty. */
export const HIDDEN_NEBULA_DENSITY = 0.45;

export function createExploration(sector) {
  const n = sector.systems.length;
  const level = new Uint8Array(n);
  const scan = new Float32Array(n);
  sector.systems.forEach((s, i) => {
    if (s.zone === 'core') level[i] = EXPLORE.VISITED;
    else level[i] = s.nebulaDensity >= HIDDEN_NEBULA_DENSITY ? EXPLORE.HIDDEN : EXPLORE.SEEN;
  });
  return { seed: sector.seed, version: sector.version, level, scan };
}

/**
 * Krok mgły eksploracji przy statku (x, y) z mnożnikiem czujników strefy `sensorMul`. Zmiany poziomu
 * dopisuje do `events` ({ index, level }), jeśli podane. Zwraca liczbę zmian.
 */
export function updateExploration(exp, sector, x, y, sensorMul, dt, events = null) {
  const F = SECTOR_FLIGHT;
  const S = sector.systems;
  const sense = F.sensorRange * sensorMul;
  let changes = 0;
  for (let i = 0; i < S.length; i++) {
    const lv = exp.level[i];
    if (lv === EXPLORE.VISITED) continue;
    const s = S[i];
    const dx = s.x - x;
    const dy = s.y - y;
    const d = Math.sqrt(dx * dx + dy * dy);
    let next = lv;
    if (d <= ZONE.jumpRadius) next = EXPLORE.VISITED;
    else {
      if (lv === EXPLORE.HIDDEN && d <= sense * (1 - 0.5 * s.nebulaDensity)) next = EXPLORE.SEEN;
      if (next >= EXPLORE.SEEN && lv < EXPLORE.SCANNED && d <= F.scanRange * Math.max(0.35, sensorMul)) {
        exp.scan[i] += dt;
        if (exp.scan[i] >= F.scanTime) next = EXPLORE.SCANNED;
      } else if (lv < EXPLORE.SCANNED) {
        // Skan przerwany — postęp gaśnie powoli (wróć bliżej, a dokończy).
        exp.scan[i] = Math.max(0, exp.scan[i] - dt * 0.5);
      }
    }
    if (next !== lv) {
      exp.level[i] = next;
      changes++;
      if (events) events.push({ index: i, level: next });
    }
  }
  return changes;
}

/** Ręczne odsłonięcie (wizyta w układzie po powrocie z gry, zakup map, skan aktywny). */
export function revealSystem(exp, index, level = EXPLORE.VISITED) {
  if (exp.level[index] < level) exp.level[index] = level;
}

/** Zapis gracza: { seed, version, level: [...] }. */
export function serializeExploration(exp) {
  return { seed: exp.seed, version: exp.version, level: Array.from(exp.level) };
}

/** Odczyt zapisu; inny sektor (ziarno / wersja / liczba układów) → stan startowy. */
export function restoreExploration(sector, data) {
  const exp = createExploration(sector);
  if (!data || data.seed !== sector.seed || data.version !== sector.version || !Array.isArray(data.level)) return exp;
  if (data.level.length !== exp.level.length) return exp;
  for (let i = 0; i < exp.level.length; i++) exp.level[i] = Math.max(exp.level[i], data.level[i] | 0);
  return exp;
}
