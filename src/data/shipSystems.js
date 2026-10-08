// src/data/shipSystems.js
//
// Systemy okrętu pod klawiszem F — „specjale F” (jak ship system w Starsectorze). Każdy kadłub bojowy ma
// DOMYŚLNY system (pierwszy na liście kadłuba), niektóre także drugi do wyboru (fitowanie:
// shipSystemOptionsFor; gracz — setPlayerShipSystem w index.html, wybór w PLAYER.hullSystems).
// Decyzje użytkownika (2026-10-08): Atlas — szarża albo silniki manewrowe, Terra Nova — zryw silników,
// piraci — szybki ogień; Iron Skull i Colossus wg frakcji, szarża zostaje im jako druga opcja.
//
// Rodzaje (pole `id`) — logika stanu: src/game/shipSystem.js, gracz: index.html (blok „SYSTEM OKRĘTU (F)”),
// NPC: src/ai/npcShipSystem.js (używają tylko zrywu i szybkiego ognia — NPC_SHIP_SYSTEM_IDS):
//
//   ram_burn — SZARŻA (decyzja użytkownika 2026-10-01: „pełna prędkość zżerająca reaktor za krótki boost”):
//     speed     — prędkość zrywu [j/s] (limit napędu na czas zrywu); pomiar taranu na silniku belek:
//                 ~500 j/s miażdży fregaty, ~2000 niszczyciele, ~3000 pancerniki
//     accel     — przyspieszenie wzdłuż dziobu w trakcie zrywu [j/s²]
//     duration  — czas zrywu [s] (ładunek reaktora schodzi w tym czasie z 1 do 0)
//     recharge  — odbudowa ładunku od zera do pełna [s]; zryw rusza tylko z pełnego
//     turnScale — ułamek zwrotności w trakcie zrywu (okręt leci tam, gdzie patrzy dziób)
//     brake     — hamowanie napędu po zrywie, z powrotem do limitu bojowego [j/s²]
//
//   maneuver — SILNIKI MANEWROWE (Atlas, do wyboru): Q / E + F — skok w bok, A / D + F — szybki obrót w tę
//   stronę, aż dziób (albo burta z największą liczbą dział w łuku) wskaże cel priorytetowy, bez celu — kursor;
//   samo F — obrót najkrótszą drogą. Dysze SIDE pracują przy tym pełnym ciągiem.
//     charges      — ładunki (skok i obrót biorą po jednym)
//     recharge     — odnowa jednego ładunku [s] (po kolei)
//     jumpHullFrac — przesunięcie skoku w długościach kadłuba (0,5 = pół kadłuba)
//     jumpTime     — czas skoku [s]; jumpKick — ułamek czasu na wybicie (reszta to wyhamowanie)
//     turnRate     — prędkość obrotu manewru [°/s]; turnAccel — przyspieszenie kątowe [°/s²]
//     turnTimeout  — najdłuższy obrót [s] (cel ucieka szybciej, niż okręt się obraca)
//
//   engine_burst — ZRYW SILNIKÓW (Terra Nova): limit prędkości × speedMul i ciąg silników głównych × thrustMul
//   na `duration` s, potem ładowanie `recharge` s (od zera); po zrywie napęd hamuje do limitu z `brake` [j/s²].
//   Struga MAIN jak przy dopalaczu.
//
//   rapid_fire — SZYBKI OGIEŃ (piraci): szybkostrzelność całej broni okrętu × fireRateMul na `duration` s, potem
//   chłodzenie `recharge` s (od zera). Działa przez modyfikatory okrętu (src/game/shipModifiers.js — źródło
//   'system', fireRate = 1 / fireRateMul mnoży przeładowanie; składa się z modułami fitowania, źródło 'fit').
//
// Klucz kadłuba: id kadłuba gracza (PLAYER.activeHullId) albo profil renderu NPC (shipFrame) — aliasy niżej.
// Kadłub bez wpisu (Corvus, megafrachtowiec, frachtowce, myśliwce) nie ma systemu: F = rakieta.

export const SHIP_SYSTEM_IDS = Object.freeze(['ram_burn', 'maneuver', 'engine_burst', 'rapid_fire']);
/** Rodzaje, których używa AI (src/ai/npcShipSystem.js); szarżę i manewr ma tylko gracz. */
export const NPC_SHIP_SYSTEM_IDS = Object.freeze(['engine_burst', 'rapid_fire']);

const RAM = Object.freeze({
  id: 'ram_burn', label: 'SZARŻA', short: 'SZARŻA', icon: '⇶',
  desc: 'Zryw na wprost do prędkości taranu kosztem całego ładunku reaktora.'
});
const MANEUVER = Object.freeze({
  id: 'maneuver', label: 'SILNIKI MANEWROWE', short: 'MANEWR', icon: '⇄',
  desc: 'Q/E + F — skok w bok o pół kadłuba, A/D + F — szybki obrót burtą albo dziobem na cel.'
});
const BURST = Object.freeze({
  id: 'engine_burst', label: 'ZRYW SILNIKÓW', short: 'ZRYW', icon: '≫',
  desc: 'Silniki główne na kilka sekund ponad limit: wyższa prędkość i ciąg.'
});
const RAPID = Object.freeze({
  id: 'rapid_fire', label: 'SZYBKI OGIEŃ', short: 'OGIEŃ', icon: '✸',
  desc: 'Broń na kilka sekund przeładowuje się szybciej, potem chłodzenie.'
});
const def = (base, params) => Object.freeze({ ...base, ...params });

// Szarże (liczby sprzed 2026-10-08 bez zmian).
const RAM_ATLAS = def(RAM, { speed: 3000, accel: 1100, duration: 5, recharge: 28, turnScale: 0.22, brake: 650 });
// Iron Skull — ciężki taran piratów.
const RAM_IRON_SKULL = def(RAM, { speed: 2600, accel: 1200, duration: 4, recharge: 24, turnScale: 0.3, brake: 700 });
// Colossus.
const RAM_COLOSSUS = def(RAM, { speed: 2600, accel: 950, duration: 5, recharge: 30, turnScale: 0.22, brake: 600 });

// Atlas (zwykły obrót 18°/s, 12°/s²): obrót manewru 90° ~1,8 s, 180° ~3 s; skok 0,5 kadłuba (~900 j.) w 1,1 s.
const MANEUVER_ATLAS = def(MANEUVER, {
  charges: 2, recharge: 7,
  jumpHullFrac: 0.5, jumpTime: 1.1, jumpKick: 0.3,
  turnRate: 70, turnAccel: 160, turnTimeout: 7
});

// Zrywy Terra Nova: lżejszy kadłub — krótszy i częstszy.
const BURST_FRIGATE = def(BURST, { speedMul: 1.8, thrustMul: 2.2, duration: 3.5, recharge: 14, brake: 2400 });
const BURST_DESTROYER = def(BURST, { speedMul: 1.7, thrustMul: 2.0, duration: 4, recharge: 16, brake: 1300 });
const BURST_BATTLESHIP = def(BURST, { speedMul: 1.6, thrustMul: 2.0, duration: 5, recharge: 20, brake: 600 });
const BURST_CARRIER = def(BURST, { speedMul: 1.6, thrustMul: 2.2, duration: 6, recharge: 24, brake: 400 });
const BURST_SUPERCAPITAL = def(BURST, { speedMul: 1.6, thrustMul: 2.4, duration: 6, recharge: 26, brake: 320 });

// Szybki ogień piratów: im większy kadłub, tym dłużej, ale słabiej.
const RAPID_FRIGATE = def(RAPID, { fireRateMul: 2.0, duration: 4, recharge: 16 });
const RAPID_DESTROYER = def(RAPID, { fireRateMul: 1.8, duration: 5, recharge: 18 });
const RAPID_BATTLESHIP = def(RAPID, { fireRateMul: 1.7, duration: 6, recharge: 22 });
const RAPID_SUPERCAPITAL = def(RAPID, { fireRateMul: 1.6, duration: 7, recharge: 26 });

/** Kadłub → systemy do wyboru (pierwszy = domyślny). */
export const HULL_SHIP_SYSTEMS = Object.freeze({
  atlas: Object.freeze([RAM_ATLAS, MANEUVER_ATLAS]),
  // Terra Nova: Custos, Hasta, Bellator, Citadella, Colossus.
  frigate: Object.freeze([BURST_FRIGATE]),
  destroyer: Object.freeze([BURST_DESTROYER]),
  battleship: Object.freeze([BURST_BATTLESHIP]),
  carrier: Object.freeze([BURST_CARRIER]),
  supercapital: Object.freeze([BURST_SUPERCAPITAL, RAM_COLOSSUS]),
  // Piraci: Marauder, Reaver, Iron Skull, supercapital herszta (tylko NPC).
  pirate_frigate: Object.freeze([RAPID_FRIGATE]),
  pirate_destroyer: Object.freeze([RAPID_DESTROYER]),
  pirate_battleship: Object.freeze([RAPID_BATTLESHIP, RAM_IRON_SKULL]),
  pirate_supercapital: Object.freeze([RAPID_SUPERCAPITAL])
});

/** Domyślny system kadłuba (zgodność wstecz: SHIP_SYSTEMS.atlas = szarża Atlasa). */
export const SHIP_SYSTEMS = Object.freeze(Object.fromEntries(
  Object.entries(HULL_SHIP_SYSTEMS).map(([hull, list]) => [hull, list[0]])
));

// Profil renderu NPC (shipFrame) → klucz kadłuba gracza.
const HULL_KEY_ALIASES = Object.freeze({
  player: 'atlas',
  terran_frigate: 'frigate',
  terran_destroyer: 'destroyer',
  terran_battleship: 'battleship',
  terran_carrier: 'carrier',
  capital_carrier: 'carrier',
  terran_supercapital: 'supercapital'
});

/** Klucz tabeli dla id kadłuba gracza albo profilu renderu ('' = bez systemu). */
export function shipSystemHullKey(hullId) {
  const raw = String(hullId || '').trim().toLowerCase();
  if (!raw) return '';
  const key = HULL_KEY_ALIASES[raw] || raw;
  return HULL_SHIP_SYSTEMS[key] ? key : '';
}

/** Domyślny system kadłuba (id kadłuba gracza albo profil renderu) albo null. */
export function shipSystemFor(hullId) {
  const key = shipSystemHullKey(hullId);
  return key ? HULL_SHIP_SYSTEMS[key][0] : null;
}

/** Systemy do wyboru dla kadłuba (pierwszy = domyślny); pusta lista — kadłub bez systemu. */
export function shipSystemOptionsFor(hullId) {
  const key = shipSystemHullKey(hullId);
  return key ? HULL_SHIP_SYSTEMS[key] : [];
}

/**
 * System `systemId` kadłuba — tylko z listy jego opcji (walidacja wyboru); bez `systemId` — domyślny.
 * Zwraca null, gdy kadłub nie ma takiego systemu.
 */
export function shipSystemDefFor(hullId, systemId = '') {
  const list = shipSystemOptionsFor(hullId);
  if (!list.length) return null;
  if (!systemId) return list[0];
  for (let i = 0; i < list.length; i++) if (list[i].id === systemId) return list[i];
  return null;
}

/**
 * Klucz kadłuba encji NPC (shipFrame, a bez niego typ i strona) albo '' — myśliwce, frachtowce, furgony
 * ładunku (rama fregaty) i nieznane typy nie mają systemu.
 */
export function shipSystemKeyOfEntity(e) {
  if (!e || e.fighter || e.isCargoVan || e.isWreck) return '';
  const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
  if (type === 'fighter' || type === 'interceptor' || type.startsWith('freighter') || type.startsWith('megafreighter')) return '';
  const frame = e.shipFrame || '';
  if (frame) return shipSystemHullKey(frame);
  const pirate = !!e.isPirate;
  if (type === 'battleship') return pirate ? 'pirate_battleship' : 'battleship';
  if (type === 'destroyer') return pirate ? 'pirate_destroyer' : 'destroyer';
  if (type.includes('frigate')) return pirate ? 'pirate_frigate' : 'frigate';
  if (type === 'pirate_supercapital') return 'pirate_supercapital';
  if (type === 'supercapital') return 'supercapital';
  if (type === 'carrier' || type === 'capital_carrier') return 'carrier';
  return '';
}

/**
 * System NPC: wybór encji (`e.shipSystemId`, z listy opcji kadłuba), a bez niego pierwszy system kadłuba,
 * którego używa AI (NPC_SHIP_SYSTEM_IDS). Atlas-NPC (szarża / manewr) — null.
 */
export function npcShipSystemFor(e) {
  const key = shipSystemKeyOfEntity(e);
  if (!key) return null;
  const list = HULL_SHIP_SYSTEMS[key];
  const want = e.shipSystemId || '';
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (want && d.id !== want) continue;
    if (NPC_SHIP_SYSTEM_IDS.includes(d.id)) return d;
  }
  return null;
}
