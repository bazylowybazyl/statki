---
paths:
  - "src/game/sector/**"
  - "dema/mapa-gwiezdna*"
  - "scripts/webgpu/mapa-gwiezdna-*.mjs"
  - "scripts/mapa-gwiezdna-*.mjs"
  - "tests/sector*.test.mjs"
  - "docs/PLAN-mapa-gwiezdna.md"
---

# Mapa gwiezdna — strefa międzygwiezdna między układami

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/PLAN-mapa-gwiezdna.md`.

## Stan

- Strefa międzygwiezdna (jak nadprzestrzeń Starsectora): moduł danych `src/game/sector/` (czysty — bez three i DOM,
  testy `tests/sector.test.mjs`) + demo `dema/mapa-gwiezdna.html` (obraz `dema/mapa-gwiezdna-obraz.js`). Do gry NIE
  wpięte — plan wpięcia, liczby i decyzje czekające na użytkownika: `docs/PLAN-mapa-gwiezdna.md`.
- Każdy układ ma własne pudło świata 0–12 mln j. (float32) — układy NIE leżą w jednej przestrzeni; przejście strefa ↔
  układ = przeładowanie strony z id układu (zapis gracza niesie położenie, paliwo, eksplorację i migawkę flot).

## Zasady

- DANE SEKTORA TYLKO Z ZIARNA: `generateSector({ seed })` — ten sam `opts` daje ten sam sektor bit w bit. Losowanie przez
  `SectorRng` / `rngStep` z hasza celu (`hashU32(ziarno, 'cel', …)`), osobny strumień na cel (pozycje, gwiazdy, nazwy,
  mgławice, piraci, ciała układu, każda flota) — nowa część generatora dostaje NOWY strumień, inaczej przesunie resztę.
  Nigdy `Math.random` (sekwencja rozgrywki) ani `fxRandom` (obraz). Ciała układu z ziarna (sektor, id układu) — nie z
  indeksu. Zmiana, która zmienia mapę przy tym samym ziarnie → `SECTOR_VERSION` + 1 (zapis gracza ją sprawdza).
- ID unikalne w całym sektorze: układy `sol`, nazwani po nazwie (`alfa-centauri`), proceduralni `hf-NNNN` (katalog
  numerowany od Słońca), planety `<idUkładu>:p<n>` (Słońce: `sol:<id z systemMap>`), pasy `<idUkładu>:pas<n>`, mgławice
  `mg-<n>`, burze `burza-<n>`, bramy `brama:<idUkładu>`.
- Rodzaje planet z listy WSPÓLNEJ z generatorem planet (`PLANET_TYPES`: terran, ocean, desert, rocky, ice, volcanic,
  barren, toxic, gas, ice_giant); opis planety `{ id, type, seed, orbitAU, r }` — orbity w AU MAPY (jak
  `SYSTEM_MAP_PLANETS`, do 122; pas lodowy do 140), `r` w j. świata. Układ Słoneczny bierze orbity i promienie z
  `src/data/systemMap.js` (tylko odczyt — tabeli nie zmieniać stąd).
- Jednostka strefy: rok świetlny; osie jak gra 2D (x w prawo, y w dół); scena dema: X = x, Y = −y.
- PUNKTY SKOKU = ROGI ŚWIATA UKŁADU: cztery na okręgu `ZONE.jumpRadius` pod 45° (NE / NW / SW / SE, `JUMP_CORNERS`) —
  wejście punktem K → róg K świata (`worldEntryFromJump`), wyjście rogiem K → punkt K strefy + `exitOffset` na zewnątrz
  (`zoneExitFromWorld`). Kierunek zostaje ten sam w obie strony.
- MGŁAWICE: rozgrywka liczy gęstość z elipsy i szumu (`nebulaDensityAt`, `fbm2`) — obraz to wypieki stylu „mgławica” w
  tej samej elipsie + MGIEŁKA ROZGRYWKI w TSL, port 1:1 `nebulaDensityAt` (hasz lowbias32 na u32, ziarno w dwóch
  połówkach 16-bitowych — float32 nie trzyma 32 bitów). Zmiana wzoru gęstości po stronie gry = ta sama zmiana w
  `_buildHaze` (`dema/mapa-gwiezdna-obraz.js`), inaczej HUD („mgławica 60%”) rozjedzie się z obrazem.
- FLOTY: krok STAŁY `FLEET_TICK` 0,1 s (`stepFleets` zbiera czas klatek, `advanceFleets` — przewijanie), decyzje tylko z
  `rng` rekordu floty → ten sam sektor i te same wejścia gracza = te same floty. Rekord floty = liczby i napisy (migawka =
  JSON); nowe pole stanu floty → inicjalizacja w `createFleets` (kształt obiektu stały, migawka je niesie). Krok bez
  alokacji poza zdarzeniami (`pushEvent`, rzadkie); gorące funkcje strefy (`zoneAt`, `nebulaDensityAt`) piszą do `out`.
- WPIS REJESTRU UKŁADÓW (`STAR_SYSTEMS`, `src/data/starSystems.js`, reguła `uklady-gwiezdne`) z opisu sektora:
  `systemRegistryEntry` / `sectorRegistryEntries` (`sectorRegistry.js`, funkcje czyste). Id planet w sektorze =
  `globalBodyId(idUkładu, idLokalny)` (lokalny `p<n>`, pas `pas<n>`), w grze id lokalne. Nazwy planet bez 'earth' / 'mars' /
  'jupiter' (dopasowanie ringu „Halo” po fragmencie nazwy). Moduł sektora NIE importuje `starSystems.js` (cykl) —
  Słońce (`SOL_SYSTEM`, ręczne) podaje wołający w `handmade`. Nowe pole wpisu → test `tests/sectorRegistry.test.mjs`
  (pola jak `SOL_SYSTEM`, `buildSystemMap` na planetach wpisu, orbity za studnią gwiazdy — `minOrbitAu`).
- Mgła eksploracji to dane zapisu gracza (`serializeExploration` z ziarnem i wersją sektora; inny sektor → stan
  startowy). Obraz i UI nie pokazują nic ponad poziom (`HIDDEN` — ani gwiazdy, `SEEN` — katalog i klasa, `SCANNED` —
  nazwa i planety, `VISITED` — właściciel, kryjówka, brama).

## Obraz dema (pułapki)

- PARALAKSA = model perspektywy: warstwa na głębokości k ma skalę s = z / (1 + k·z) (z — px na ly), współrzędna warstwy
  = `cam` + px / s — nowa warstwa tła liczy tak samo (zoom bez skoków). Ośrodek międzygwiezdny to TYLKO obraz (gra go nie
  widzi) i ma chłodne barwy — nie może udawać mgławicy rozgrywki.
- STATKI NA MAPIE (`dema/mapa-gwiezdna-floty.js`): skład floty z danych (`fleetComposition`), szyk i rozmiar ikon w obrazie
  (px CSS × `shipScaleFor(zoom)`); ogony z HISTORII w buforze storage (kolumny: info, teraz, próbki — przesuwane na CPU)
  — przesunięcia w szyku w px przeliczane w shaderze przez BIEŻĄCY zoom. Nowa klasa kadłuba w `FLEET_HULL_CLASSES` →
  sylwetka w `MAP_HULLS` (inaczej brak sprite'a w atlasie).
- Wstęga ogona składana z (styczna, normalna) i odbita do sceny (Y = −y) jest lustrzana — tył do kamery; materiał wstęgi
  ma `side: DoubleSide` (bez tego ogony nie rysowały się wcale, bez błędu).
- Harness z ręcznym zegarem: pass sceny (`pass()`, `PassNode`) renderuje się RAZ na klatkę rAF (pułapka 44 w regule
  `webgpu-tsl`) — `__mapa.runFrames` liczy wszystkie klatki, rysuje tylko ostatnią po `await` rAF. Kilka `render()` w
  jednym zadaniu JS = obraz GPU z pierwszej klatki serii pod nakładką 2D z ostatniej.

- `AdditiveBlending` three r183 to (SrcAlpha, One) bez premultiplied — `fragmentNode` addytywnego materiału zwraca alfę
  1 (alfa 0 = nic nie dochodzi; tak gwiazdy i mgławice dema nie rysowały się wcale). Pułapka 43 w regule `webgpu-tsl`.
- Wypieki (tło galaktyki 2560 × 1600, 6 wariantów mgławic 1280 × 800) idą PO KOLEI jednym `SkyBaker` na styl; wynik
  mgławicy kopiowany do własnego celu wariantu (`nebTargets`) — `SkyBaker.texture` to jeden cel nadpisywany przy
  każdym wypieku. Cele istnieją od startu (WebGPU zeruje teksturę) — materiały budowane raz, mgławice dochodzą po
  kolei bez przebudowy grafu.
- Nakładka 2D (etykiety, floty, statek) liczy rozmiar gwiazdy wzorem shadera (`STAR_SIZE`) — zmiana jednego = obu.

## Jak sprawdzić

- `node --test tests/sector.test.mjs tests/sectorRegistry.test.mjs tests/starSystems.test.mjs` (+ `tests/demaIndex.test.mjs`
  przy nowym demie).
- Liczby: `node scripts/mapa-gwiezdna-liczby.mjs [--seed N]` (odległości, czasy lotu, paliwo, koszt kroku flot).
- Obraz: `node scripts/webgpu/mapa-gwiezdna-demo.mjs --out .tmp/mapa-gwiezdna/<katalog>` (headless, ?test=1,
  `__mapa.runFrames`) — zrzuty scen + `raport.json` (wypieki, statystyki, błędy konsoli — ma być 0); sceny `floty`
  (sylwetki i ogony z bliska), `eskorta` (nurt w zakręcie). A/B warstw tła: `__mapa.image.mul` (`ism`, `layers`, `dust`).
