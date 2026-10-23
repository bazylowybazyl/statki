/**
 * DOKI PORTÓW BEZ RINGU (E14) — dane wspólne dla świata ruchu (worker), gry (kolizje) i obrazu (modele 3D).
 *
 * Port z ringiem „Halo” (Ziemia, Mars, Jowisz) cumuje w halach K-7 i zatokach. Reszta portów — planety bez ringu,
 * księżyce, Ceres, Westa, kryjówki, stacja gracza — dostaje JEDNĄ budowlę doku w jednym z trzech rodzajów (decyzja
 * użytkownika 2026-10-22):
 *
 *   cross  DOK KRZYŻOWY — cztery ramiona ze stanowiskami po obu stronach (grzebienie), na czubkach ramion
 *          stanowiska capital / MEGA;
 *   round  DOK OKRĄGŁY — obręcz ze stanowiskami na obwodzie (statki dziobem do obręczy, podejście promieniowe);
 *   wheel  KOŁO Z WLOTEM — płaska stacja Coriolis z Elite Dangerous: statek wlatuje szczeliną w obręczy do środka,
 *          stanowiska na wewnętrznej ścianie, w środku obraca się tylko piasta (sam obraz).
 *
 * Geometria (stanowiska, ścieżki, bryły kolizji, model) liczy się z tych danych w `src/3d/portDocks/portDockLayout.js`
 * — jeden czysty moduł po obu stronach szwu renderu. Ekonomia nie widzi rodzaju doku: liczba, klasy, kolejność i id
 * stanowisk są te same co przy dawnych pomostach (`buildStationDocks` bez modelu).
 *
 * Czyste dane: bez DOM, bez Three, bez logiki świata.
 */

/**
 * Klasy stanowisk (przeniesione z `src/game/traffic/dockLayout.js` — tam re-eksport). `rank` steruje dopasowaniem:
 * statek wchodzi na najmniejsze stanowisko, w które się mieści. `capital` — Atlas ma 1800 × 600 j.; `mega` —
 * megafrachtowiec (2760 j.) cumuje przodem składu.
 */
export const BERTH_CLASSES = Object.freeze({
  s: Object.freeze({ id: 's', rank: 0, length: 170, width: 140, label: 'S' }),
  m: Object.freeze({ id: 'm', rank: 1, length: 380, width: 280, label: 'M' }),
  l: Object.freeze({ id: 'l', rank: 2, length: 660, width: 400, label: 'L' }),
  capital: Object.freeze({ id: 'capital', rank: 3, length: 2000, width: 720, label: 'CAP' }),
  mega: Object.freeze({ id: 'mega', rank: 4, length: 3000, width: 1000, label: 'MEGA' })
});

export const BERTH_CLASS_ORDER = Object.freeze(
  Object.values(BERTH_CLASSES).sort((a, b) => a.rank - b.rank)
);

/**
 * Składy stanowisk jednego doku (przeniesione z `dockLayout.js` / `markets.js`). Port powiela skład `repeats` razy
 * (mnożnik z przeładunku) i ma `dockCount` doków o tym samym składzie — id stanowiska `<port>:dok<k>:b<i>`.
 *   default   pomosty planet, księżyców i małych ciał (przewaga M — kontenerowiec);
 *   megadock  jeden długi dok pod duże kadłuby (niewpięty w grę — Z8);
 *   hangar    mały dok kryjówki misji albo przyczółka.
 */
export const BERTH_MIXES = Object.freeze({
  default: Object.freeze(['s', 's', 'm', 'm', 'm', 'm', 'm', 'm', 'l', 'l', 'l', 'capital', 'mega']),
  megadock: Object.freeze(['m', 'm', 'l', 'l', 'l', 'capital', 'capital', 'mega', 'mega']),
  hangar: Object.freeze(['s', 's', 'm', 'm', 'l'])
});

/** Indeks składu w bloku migawki (stała kolejność po obu stronach szwu). */
export const BERTH_MIX_IDS = Object.freeze(Object.keys(BERTH_MIXES));

/** Rodzaje budowli doku. */
export const PORT_DOCK_KIND = Object.freeze({ CROSS: 'cross', ROUND: 'round', WHEEL: 'wheel' });
/** Indeks rodzaju w bloku migawki. */
export const PORT_DOCK_KIND_IDS = Object.freeze([PORT_DOCK_KIND.CROSS, PORT_DOCK_KIND.ROUND, PORT_DOCK_KIND.WHEEL]);

/**
 * PRZYDZIAŁ RODZAJU (propozycja E14, uzasadnienie w `docs/E14-doki-portow.md`): po wielkości portu, nie po rodzaju
 * ciała — liczba stanowisk to przeładunek portu (`suggestBerthMultiplier`), a wielkość budowli ma go oddawać.
 *   ≤ 1 komplet (do 26 stanowisk: 13 księżyców, kryjówki, stacja gracza, hangary misji) — KRZYŻ: mała placówka,
 *     wszystkie stanowiska capital i MEGA mieszczą się na czterech czubkach ramion;
 *   2–3 komplety (52–78: Luna, Oberon, Merkury, Wenus, Uran) — OKRĄG: średni port, stanowiska na obwodzie, podejście
 *     promieniowe z każdej strony;
 *   ≥ 4 komplety (104–130: Saturn, Westa, Ceres) — KOŁO: duże huby, ruch przez jedną szczelinę z pasami.
 */
export const PORT_DOCK_KIND_BY_REPEATS = Object.freeze([
  Object.freeze({ maxRepeats: 1, kind: PORT_DOCK_KIND.CROSS }),
  Object.freeze({ maxRepeats: 3, kind: PORT_DOCK_KIND.ROUND }),
  Object.freeze({ maxRepeats: Infinity, kind: PORT_DOCK_KIND.WHEEL })
]);

/** Rodzaj doku dla portu o `repeats` kompletach stanowisk; `override` (np. `docks.kind` rynku) ma pierwszeństwo. */
export function portDockKindFor(repeats, override = null) {
  if (override && PORT_DOCK_KIND_IDS.includes(override)) return override;
  const n = Math.max(1, Math.floor(Number(repeats) || 1));
  for (const row of PORT_DOCK_KIND_BY_REPEATS) if (n <= row.maxRepeats) return row.kind;
  return PORT_DOCK_KIND.WHEEL;
}

/**
 * Położenie budowli względem węzła portu. Węzeł planety to środek planety (tam stoi stacja gry), a wokół węzła
 * dyspozytor kładzie punkty manewrowe (`approachPoint`: 1,15 × promień redy ≈ 6,7 tys. j.) i pierwszy łuk kolejki
 * (1,12 × ≈ 6,5 tys. j.) — budowla stoi DALEJ: jej dysk zapasu (`keepR`) zaczyna się `nodeClearance` od węzła.
 * Kierunek: planeta, kryjówka, stacja gracza — ku Słońcu (strona dzienna, poza cieniem planety); księżyc — od
 * planety-rodzica; stacja małego ciała — od ciała (na przedłużeniu ciało → stacja).
 */
export const PORT_DOCK_PLACEMENT = Object.freeze({
  nodeClearance: 7600
});

/**
 * Styl budowli (`resolvePortBuildingStyle` — rodziny hal K-7) po frakcji właściciela: Terra Nova i Wewnętrzne
 * Konsorcjum — jasne płyty K-7 (Ziemia), Stocznie Marsa i Unia Pasa — rdza i sklepienia (Mars), Zewnętrzne
 * Konsorcjum — grafit i radiatory (Jowisz), piraci — żelazo z rdzą.
 */
export const PORT_DOCK_STYLE_BY_FACTION = Object.freeze({
  terra_nova: 'earth',
  inner_consortium: 'earth',
  mars_yards: 'mars',
  belt_union: 'mars',
  outer_consortium: 'jupiter',
  pirates: 'pirate'
});
export const PORT_DOCK_STYLE_IDS = Object.freeze(['earth', 'mars', 'jupiter', 'pirate']);

export function portDockStyleFor(factionId) {
  return PORT_DOCK_STYLE_BY_FACTION[factionId] || 'earth';
}
