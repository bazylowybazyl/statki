// src/game/loadoutSave.js
//
// Zapis fitu gracza w localStorage['loadout'] — czyste pomocniki (etap 0 planu fitowania,
// docs/PLAN-fitowanie.md § 4.7). Dwie rzeczy, które do 2026-10-08 nie działały:
//  - MAGAZYN BRONI nie był zapisywany: po F5 wracał zapas startowy, a broń z wraków przepadała (zamontowana
//    zostawała). Teraz `weaponStock: { id: n }` z zapisu jest źródłem prawdy razem z gniazdami — zapas startowy
//    dostaje tylko czysty start i zapis bez tego pola (migracja);
//  - gniazda wracały KOLEJNOŚCIĄ w rodzaju: puste albo zniszczone gniazdo w środku przesuwało resztę broni
//    (mieszany rodzaj, np. 4× Valkyrie + 2× Mjolnir, przesiadał się po F5), a przebudowa tablicy gniazd po
//    wczytaniu sprite'a robiła to samo. Teraz wpis wraca do gniazda o tym samym `id` (układ z edytora gniazd ma
//    stałe id); kolejność w rodzaju zostaje tylko dla wpisów bez pary (inny kadłub, zmieniony układ).
// Bez DOM i three (testy node).

/** Magazyn broni do zapisu: { id: n } (tylko n > 0), klucze po kolei — stabilny JSON. */
export function serializeWeaponStock(inventory) {
  const out = {};
  if (!inventory) return out;
  const counts = typeof inventory.toObject === 'function' ? inventory.toObject() : inventory;
  for (const id of Object.keys(counts).sort()) {
    const n = Math.floor(Number(counts[id]) || 0);
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Magazyn z zapisu albo null, gdy zapis go nie ma (zapis sprzed 2026-10-08 — dawny start z zapasu startowego).
 * Pusty obiekt to prawdziwy, pusty magazyn (NIE null). `isKnown(id)` odsiewa broń, której nie ma już w katalogu.
 */
export function readSavedWeaponStock(raw, isKnown = () => true) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const [id, value] of Object.entries(raw)) {
    const n = Math.floor(Number(value) || 0);
    if (n > 0 && isKnown(id)) out[id] = n;
  }
  return out;
}

/**
 * Odczyt magazynu broni z zapisu — para do serializeWeaponStock, jedyne miejsce reguły migracji. Zapis z polem:
 * magazyn = zapis + `mounts` (broń zapisanych gniazd liczona sztukowo — montaż zaraz ją zdejmie; broń, dla której
 * zabraknie gniazda, zostaje w magazynie), bez zapasu startowego; zwraca true (montaż nie tworzy sztuk z powietrza).
 * Zapis bez pola (sprzed 2026-10-08): magazyn bez zmian (dawny start: zapas startowy − zamontowane), zwraca false —
 * montaż gniazd zapisu sam dokłada brakujące sztuki. Kolejne magazyny w zapisie (etap 2 planu fitowania: części,
 * komplety) dostają własne pary funkcji w tym stylu, obok.
 */
export function restoreWeaponStock(inventory, raw, { isKnown = () => true, mounts = [] } = {}) {
  const stock = readSavedWeaponStock(raw, isKnown);
  if (!stock || !inventory) return false;
  inventory.clear();
  inventory.merge(stock);
  for (const id of mounts) if (id && isKnown(id)) inventory.give(id, 1);
  return true;
}

/**
 * Pary gniazdo ↔ wpis (wpis z zapisu albo z migawki sprzed przebudowy tablicy gniazd).
 * `bucketOf(wpis)` → rodzaj gniazda, do którego wpis pasuje DZIŚ (aktualny mountType broni — broń bywa
 * przenoszona między rodzajami, hexlance: special → builtin), albo null = wpis pusty (gniazdo bez broni,
 * zniszczone, broń spoza katalogu).
 *  1) wpis z `id` gniazda wraca do tego gniazda: z bronią — gdy rodzaj się zgadza; pusty — gniazdo zostaje
 *     PUSTE (rezerwacja, kolejka go nie obsadzi);
 *  2) pozostałe wpisy z bronią — kolejnością w rodzaju do gniazd bez pary (jak przed 2026-10-08);
 *  3) wpisy bez miejsca (mniej gniazd danego rodzaju) wracają w `unplaced` — ich broń należy do magazynu.
 * Wynik: { pairs: [{ hp, entry }] w kolejności tablicy gniazd, reserved: [hp], unplaced: [entry] }.
 */
export function assignHardpointEntries(slots, entries, { bucketOf } = {}) {
  const list = Array.isArray(slots) ? slots : [];
  const source = Array.isArray(entries) ? entries : [];
  const kindOf = typeof bucketOf === 'function' ? bucketOf : (entry) => entry?.type || null;
  const byId = new Map();
  for (let i = 0; i < list.length; i++) {
    const id = list[i]?.id;
    if (id != null && id !== '' && !byId.has(String(id))) byId.set(String(id), i);
  }
  const taken = new Array(list.length).fill(null);   // null | { entry } | 'reserved'
  const queues = new Map();                          // rodzaj → wpisy bez pary po id
  for (const entry of source) {
    if (!entry) continue;
    const bucket = kindOf(entry) || null;
    const id = entry.id != null && entry.id !== '' ? String(entry.id) : null;
    const at = id !== null ? byId.get(id) : undefined;
    if (at !== undefined && taken[at] === null) {
      if (bucket === null) { taken[at] = 'reserved'; continue; }
      if (list[at]?.type === bucket) { taken[at] = { entry }; continue; }
    }
    if (bucket === null) continue;
    let queue = queues.get(bucket);
    if (!queue) queues.set(bucket, queue = []);
    queue.push(entry);
  }
  for (let i = 0; i < list.length; i++) {
    if (taken[i] !== null) continue;
    const queue = queues.get(list[i]?.type);
    if (queue && queue.length) taken[i] = { entry: queue.shift() };
  }
  const pairs = [];
  const reserved = [];
  for (let i = 0; i < list.length; i++) {
    const t = taken[i];
    if (t === 'reserved') reserved.push(list[i]);
    else if (t) pairs.push({ hp: list[i], entry: t.entry });
  }
  const unplaced = [];
  for (const queue of queues.values()) unplaced.push(...queue);
  return { pairs, reserved, unplaced };
}
