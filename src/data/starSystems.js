/**
 * UKŁADY GWIEZDNE — rejestr układów, które gra umie zbudować (2026-11-07, decyzja użytkownika: układów ma być
 * dużo, podróż między nimi jak w Starsectorze — strefa międzygwiezdna; najtańsza droga: przeładowanie strony).
 *
 * Strona gry buduje JEDEN układ przy starcie (świat, planety, pasy, stacje powstają raz), więc przejście do innego
 * układu = przeładowanie strony z innym `systemId` (zapis gracza `src/game/playerSave.js` albo `?uklad=<id>`).
 * W obrębie jednej strony identyfikatory ciał są lokalne dla układu ('earth', 'mars') — nie zderzają się, bo drugi
 * układ nigdy nie jest załadowany obok. Globalny identyfikator (mapa gwiezdna, zapis) = `<systemId>:<idLokalny>`
 * (`globalBodyId`).
 *
 * Układ Słoneczny (`sol`) to ręcznie zrobiony rdzeń: geometria z `systemMap.js` (orbity rozgrywkowe, księżyce,
 * gigantyczne słońce), a jego treść — fabuła, ekonomia ruchu v2 (rynki `src/data/markets.js`), ringi „Halo”,
 * hala K-7, przelot NEA — jest przypięta do jego lokalnych id. Układy proceduralne (sesje „Mapa gwiezdna”
 * — `src/game/sector/`, „Generator planet” — `src/3d/planetGen/`) dołączą tu przez opis układu z tymi samymi polami.
 *
 * Pola układu:
 *  - `id`, `name` (UI), `label` (krótki podpis gwiazdy na radarze i w CIC);
 *  - `star`: `r` (promień tarczy w j. — obraz, radar, CIC, studnia), `spectral`, `color` (rdzeń / środek / brzeg tarczy);
 *  - `planets`, `moons` — tabele w formacie `systemMap.js` (`buildSystemMap(…, { planets })`);
 *  - `home` — dom gracza w tym układzie: `planetId` (port wezwań, POWRÓT, holownik), `stationId` (start gry swobodnej
 *    przy tej stacji), `berthIds` (stanowiska domowe gracza w ruchu v2) — null, gdy układ nie ma domu;
 *  - `handmade` — treść ręczna (fabuła, ekonomia z tabel, ringi) istnieje tylko dla tego układu.
 *
 * Bez importów poza `systemMap.js` — moduł czysty (strona, worker ruchu, testy node).
 */
import { SYSTEM_MAP_CONSTANTS, SYSTEM_MAP_PLANETS, SYSTEM_MAP_MOONS } from './systemMap.js';

export const DEFAULT_STAR_SYSTEM_ID = 'sol';

export const SOL_SYSTEM = Object.freeze({
  id: 'sol',
  name: 'Układ Słoneczny',
  label: 'SOL',
  star: Object.freeze({
    id: 'sun',
    spectral: 'G2V',
    r: SYSTEM_MAP_CONSTANTS.sunRadius,
    color: Object.freeze({ core: '#ffe88a', mid: '#ffbe3b', rim: '#ff8c1a' })
  }),
  planets: SYSTEM_MAP_PLANETS,
  moons: SYSTEM_MAP_MOONS,
  home: Object.freeze({
    planetId: 'earth',
    stationId: 'earth',
    // C-01 hali K-7 nr 0 (reguła `ruch-banka`, STANOWISKO DOMOWE) — ten sam wpis czyta worker ruchu (trafficProtocol.js)
    berthIds: Object.freeze(['earth:K7-1:C-01'])
  }),
  handmade: true
});

export const STAR_SYSTEMS = Object.freeze({ [SOL_SYSTEM.id]: SOL_SYSTEM });

/** Układ po id albo null. */
export function getStarSystem(id) {
  const key = String(id || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(STAR_SYSTEMS, key) ? STAR_SYSTEMS[key] : null;
}

/**
 * Który układ zbudować przy starcie strony: `?uklad=<id>` (narzędzia, A/B), potem `savedSystemId` (zapis gracza),
 * potem domyślny. Nieznany id → domyślny, z polem `rejected` (do dziennika). Wynik: { id, source, rejected }.
 * `source`: 'url' | 'save' | 'default'.
 */
export function resolveStarSystemId(search, savedSystemId, systems = STAR_SYSTEMS) {
  let param = null;
  try { param = new URLSearchParams(String(search || '')).get('uklad'); } catch { param = null; }
  const known = (id) => {
    const key = String(id || '').trim().toLowerCase();
    return key && Object.prototype.hasOwnProperty.call(systems, key) ? key : null;
  };
  let rejected = null;
  if (param !== null && param !== '') {
    const id = known(param);
    if (id) return { id, source: 'url', rejected };
    rejected = String(param);
  }
  if (savedSystemId !== null && savedSystemId !== undefined && savedSystemId !== '') {
    const id = known(savedSystemId);
    if (id) return { id, source: 'save', rejected };
    rejected = rejected || String(savedSystemId);
  }
  return { id: DEFAULT_STAR_SYSTEM_ID, source: 'default', rejected };
}

/** Globalny identyfikator ciała (mapa gwiezdna, zapis): `<systemId>:<idLokalny>`. */
export function globalBodyId(systemId, localId) {
  return `${String(systemId || DEFAULT_STAR_SYSTEM_ID)}:${String(localId || '')}`;
}

/** Dom gracza w układzie albo null (układ bez domu — start i POWRÓT bez portu macierzystego). */
export function systemHome(system) {
  return system && system.home ? system.home : null;
}
