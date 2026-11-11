// src/data/shipDeckLights.js
//
// LAMPY POKŁADOWE okrętów (prośba użytkownika 2026-11-11: „więcej oświetlenia na statek — mini lampy oświetlające
// kadłub, np. z mostka i innych elementów”). Małe stałe lampy, które świecą na blachę własnego kadłuba: przy mostku,
// przy obudowie rdzenia reaktora, przy skupiskach gniazd broni (main / special), przy hangarach i — dopełnienie —
// wzdłuż grzbietu kadłuba. Nie migają (to robią światła nawigacyjne, src/data/shipNavLights.js) i stoją z dala od nich,
// od dysz MAIN / SIDE, od wież i od stref mostków.
//
// Tabela jest generowana ze sprite'ów i danych kadłubów (strefy mostków, markery rdzeni, gniazda edytora, dysze, lampy
// nawigacyjne) — nie poprawiać ręcznie. Nowy kadłub, nowy sprite albo przesunięte gniazdo / mostek / rdzeń → przeliczyć:
//
//   node scripts/lampy-pokladowe.mjs --zapisz [--podglad .tmp/lampy-pokladowe/podglad]
//
// (strażnik tests/shipDeckLights.test.mjs: komplet kadłubów, lampy na alfie sprite'a, liczba, odstępy, `d`, `kind`).
//
// Moduł czysty (bez three, DOM i `window`). Lamp nie czyta jeszcze ani gra, ani render — wpięcie robi osobny etap.

/** Przy czym stoi lampa (`kind` w punkcie tabeli). Nowy rodzaj — na końcu, numery się nie zmieniają. */
export const DECK_LIGHT_KIND = Object.freeze({ BRIDGE: 0, REACTOR: 1, WEAPON: 2, HANGAR: 3, HULL: 4 });

/**
 * Klucz edytora (jak NAV_LIGHT_POINTS) → promień lampy `r` [px PNG] i lampy `p`: [x, y, d, kind].
 *   x, y  — px PNG od środka płótna sprite'a, +x ku dziobowi, +y prawa burta (dół obrazka) — układ markerów edytora;
 *   d     — odległość lampy od środka rdzenia reaktora / największa taka odległość na tym kadłubie (0 = przy reaktorze,
 *           1 = najdalsza lampa) — do fali światła przy rozruchu okrętu;
 *   kind  — DECK_LIGHT_KIND.
 * `r` = 0,8 promienia lamp nawigacyjnych tego kadłuba (ten sam rozmiar na ekranie niezależnie od rozdzielczości sprite'a;
 * lampa pokładowa jest mniejsza, świeci na blachę, nie ponad nią). Kolejność: rodzaj, potem od dziobu.
 */
export const SHIP_DECK_LIGHTS = Object.freeze({
  // <tabela>
  // </tabela>
});

const EMPTY = Object.freeze([]);

/** Lampy pokładowe kadłuba (klucz edytora) — tablica [x, y, d, kind]; brak w tabeli — pusta tablica. */
export function shipDeckLightPoints(key) {
  const row = SHIP_DECK_LIGHTS[key];
  return row ? row.p : EMPTY;
}
