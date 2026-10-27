// src/data/lootGear.js
//
// SPRZĘT ZBIÓRKI — gniazdo ZBIÓRKA okrętu gracza (kontenery-łup, docs/PROPOZYCJA-kontenery-lup.md § 3.5; decyzja
// użytkownika 2026-10-27: „wiązka lub drony. dodaj opcje montowania dronów, wiązki do zbierania lootu”). Jedno gniazdo
// na kadłub, jeden wybór (D14, wzór: system F): pusto, wiązka ściągająca albo drony zbierające. Bez sprzętu kontenerów
// nie da się zebrać (D15). Sprzęt jest CZĘŚCIĄ jak moduł: leży w hangarze (`partStock`) albo w gnieździe kadłuba
// (`PLAYER.hullLootGear`); zdjęty wraca do hangaru. Atlas ma wiązkę fabrycznie (D16) — kadłub bez wpisu w zapisie
// dostaje `default`.
//
// Czyste dane (bez importów). Logika wiązki: src/game/lootContainers.js; drony — etap K3 (`ready: false`).

export const LOOT_GEAR = Object.freeze({
  loot_tractor: Object.freeze({
    id: 'loot_tractor',
    kind: 'tractor',
    label: 'WIĄZKA ŚCIĄGAJĄCA',
    short: 'WIĄZKA',
    desc: 'ściąga kontenery w zasięgu do luku · działa przy prędkości < 400 j./s',
    price: 8000,
    ready: true
  }),
  loot_drones: Object.freeze({
    id: 'loot_drones',
    kind: 'drones',
    label: 'DRONY ZBIERAJĄCE',
    short: 'DRONY',
    desc: 'drony z luku zbierają kontenery dalej, bez zwalniania · zatoka zabiera ładowność',
    price: 14000,
    dronePrice: 900,
    // Etap K3 (lot dronów, trafienia, obraz). Do tego czasu opcja widoczna, ale nie do zamontowania.
    ready: false
  })
});

export const LOOT_GEAR_IDS = Object.freeze(Object.keys(LOOT_GEAR));

/** Wspólne strojenie wiązki (liczby na sekundę; zasięg i liczba celów — z kadłuba). */
export const LOOT_TRACTOR_TUNE = Object.freeze({
  // Wiązka puszcza, gdy okręt leci szybciej (tryb BOJOWY bez dopalacza; Atlas: limit bojowy 507 j./s).
  maxShipSpeed: 400,
  // Przyspieszenie kontenera ku punktowi chwytu i sufit prędkości względnej [j./s², j./s].
  accel: 260,
  maxSpeed: 520,
  // Kontener bliżej punktu chwytu niż tyle [j.] wchodzi do ładowni.
  capture: 240
});

const tractor = (range, targets) => Object.freeze({ range, targets });
const drones = (count, range) => Object.freeze({ count, range });

// Kadłub gracza → opcje gniazda. `drones` tylko tam, gdzie luk mieści zatokę (src/data/cargoBays.js: Atlas, Bellator,
// Citadella, Colossus, Iron Skull, megafrachtowiec); fregaty, Hasta i Reaver — sama wiązka.
export const HULL_LOOT_GEAR = Object.freeze({
  atlas: Object.freeze({ default: 'loot_tractor', tractor: tractor(3600, 4), drones: drones(6, 8000) }),
  frigate: Object.freeze({ tractor: tractor(1500, 2) }),
  corvus: Object.freeze({ tractor: tractor(1500, 2) }),
  pirate_frigate: Object.freeze({ tractor: tractor(1500, 2) }),
  destroyer: Object.freeze({ tractor: tractor(2000, 2) }),
  pirate_destroyer: Object.freeze({ tractor: tractor(2000, 2) }),
  battleship: Object.freeze({ tractor: tractor(2500, 2), drones: drones(3, 6000) }),
  pirate_battleship: Object.freeze({ tractor: tractor(2500, 2), drones: drones(2, 6000) }),
  carrier: Object.freeze({ tractor: tractor(3000, 3), drones: drones(6, 6000) }),
  supercapital: Object.freeze({ tractor: tractor(3000, 3), drones: drones(4, 6000) }),
  megafreighter: Object.freeze({ tractor: tractor(3600, 4), drones: drones(6, 6000) })
});

export function lootGearById(id) {
  return LOOT_GEAR[String(id || '')] || null;
}

/** Opcje gniazda ZBIÓRKA kadłuba (id sprzętu, w kolejności: wiązka, drony). Kadłub spoza tabeli — sama wiązka. */
export function lootGearOptionsFor(hullId) {
  const h = HULL_LOOT_GEAR[String(hullId || '')];
  if (!h) return [LOOT_GEAR.loot_tractor.id];
  const out = [];
  if (h.tractor) out.push(LOOT_GEAR.loot_tractor.id);
  if (h.drones) out.push(LOOT_GEAR.loot_drones.id);
  return out;
}

/** Czy sprzęt da się zamontować na kadłubie (jest w opcjach i gotowy). */
export function lootGearFits(hullId, gearId) {
  const def = lootGearById(gearId);
  return !!def && def.ready && lootGearOptionsFor(hullId).includes(def.id);
}

/**
 * Sprzęt w gnieździe kadłuba: `chosen` — wpis z zapisu (`PLAYER.hullLootGear[kadłub]`): `undefined` = nigdy nie
 * ustawiony (domyślny kadłuba), `null` = gniazdo puste. Zwraca id albo null.
 */
export function mountedLootGear(hullId, chosen) {
  if (chosen === undefined) {
    const def = HULL_LOOT_GEAR[String(hullId || '')]?.default || null;
    return def && lootGearFits(hullId, def) ? def : null;
  }
  return chosen && lootGearFits(hullId, chosen) ? String(chosen) : null;
}

/**
 * Parametry sprzętu na kadłubie dla logiki zbiórki: `{ kind: 'tractor', range, targets, … LOOT_TRACTOR_TUNE }`
 * albo null (pusto, sprzęt niegotowy). `out` — obiekt wielokrotnego użytku.
 */
export function lootGearParams(hullId, gearId, out = {}) {
  const def = lootGearById(gearId);
  if (!def || !def.ready) return null;
  const h = HULL_LOOT_GEAR[String(hullId || '')] || null;
  if (def.kind === 'tractor') {
    const t = h?.tractor || HULL_LOOT_GEAR.frigate.tractor;
    out.kind = 'tractor';
    out.range = t.range;
    out.targets = t.targets;
    out.maxShipSpeed = LOOT_TRACTOR_TUNE.maxShipSpeed;
    out.accel = LOOT_TRACTOR_TUNE.accel;
    out.maxSpeed = LOOT_TRACTOR_TUNE.maxSpeed;
    out.capture = LOOT_TRACTOR_TUNE.capture;
    return out;
  }
  return null;
}
