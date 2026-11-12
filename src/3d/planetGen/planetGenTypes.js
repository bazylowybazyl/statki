// src/3d/planetGen/planetGenTypes.js
//
// RODZAJE PLANET generatora (2026-11-07, prośba użytkownika: „generator planet — terrańska, gazowa, skalista,
// piaszczysta, lodowa itp.”). Identyfikatory WSPÓLNE z mapą gwiezdną (`src/game/sector/` — sesja mapy gwiezdnej)
// i tabelą układów (`src/data/starSystems.js`): zmiana id = zmiana w obu miejscach. Moduł czysty (bez three) —
// czyta go gra, mapa gwiezdna, testy i demo.
//
//   kind: 'solid' — powierzchnia (wypiek: dzień, normalne, połysk, noc, chmury) na grafie 'surface' gry,
//         'gas'   — gazowy olbrzym (wypiek mapy dnia) na wspólnym silniku żywej atmosfery (gasGiantAtmosphere.js).
//   rKm  — typowy promień [km] (rozrzut z ziarna; obraz: skala rzeźby i chmur, nie rozmiar w grze — ten daje `r`).
export const PLANET_GEN_TYPES = Object.freeze([
  Object.freeze({ id: 'terran', name: 'terrańska', kind: 'solid', rKm: [5200, 7600],
    opis: 'kontynenty z płyt, oceany, pasy klimatu (lasy, stepy, pustynie, tundra), czapy lodowe, chmury, miasta' }),
  Object.freeze({ id: 'ocean', name: 'oceaniczna', kind: 'solid', rKm: [5600, 8400],
    opis: 'ocean na ~92–99% powierzchni, łańcuchy wysp wulkanicznych, atole i płycizny, gęste chmury z cyklonami' }),
  Object.freeze({ id: 'desert', name: 'piaszczysta', kind: 'solid', rKm: [3600, 6800],
    opis: 'morza wydm w nieckach, płaskowyże i góry, solniska, suche koryta, pył w powietrzu' }),
  Object.freeze({ id: 'rocky', name: 'skalista', kind: 'solid', rKm: [2600, 5200],
    opis: 'jak Mars: rdza i bazalt, wulkany tarczowe, kaniony, stare kratery, dychotomia półkul, małe czapy' }),
  Object.freeze({ id: 'ice', name: 'lodowa', kind: 'solid', rKm: [1800, 6200],
    opis: 'skorupa lodu: pęknięcia (lineae), teren chaosu, bruzdy, zamarznięte morza, góry spod lodu' }),
  Object.freeze({ id: 'volcanic', name: 'wulkaniczna', kind: 'solid', rKm: [1800, 6400],
    opis: 'siarka i bazalt (jak Io) albo zastygająca skorupa nad lawą: kaldery, potoki, żar nocą' }),
  Object.freeze({ id: 'barren', name: 'martwa', kind: 'solid', rKm: [1200, 3400],
    opis: 'jak Merkury i Księżyc: kratery wielu skal, morza lawy w basenach, promienie młodych kraterów' }),
  Object.freeze({ id: 'toxic', name: 'toksyczna', kind: 'solid', rKm: [4800, 7000],
    opis: 'gęste chmury jak Wenus (albo mgła jak Tytan): pokład chmur z pasmami, pod nim gorące równiny' }),
  Object.freeze({ id: 'gas', name: 'gazowy olbrzym', kind: 'gas', rKm: [55000, 82000],
    opis: 'pasy i strefy, dżety, burze i owale, czapy polarne; atmosfera żyje (wspólny silnik z Jowiszem)' }),
  Object.freeze({ id: 'ice_giant', name: 'lodowy olbrzym', kind: 'gas', rKm: [22000, 30000],
    opis: 'jak Uran i Neptun: błękit metanu, słabe pasy, ciemne plamy z jasnymi chmurami' })
]);

export const PLANET_GEN_TYPE_IDS = Object.freeze(PLANET_GEN_TYPES.map((t) => t.id));
export const PLANET_GEN_TYPE = Object.freeze(Object.fromEntries(PLANET_GEN_TYPES.map((t) => [t.id, t])));

/** Czy `id` to znany rodzaj generatora. */
export const isPlanetGenType = (id) => Object.prototype.hasOwnProperty.call(PLANET_GEN_TYPE, id);
