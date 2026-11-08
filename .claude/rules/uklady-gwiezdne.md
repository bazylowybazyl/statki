---
paths:
  - "src/data/starSystems.js"
  - "tests/starSystems.test.mjs"
---

# Układy gwiezdne: rejestr, układ strony, dom gracza

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan i zasady

- Decyzje użytkownika (2026-11-07): układów gwiezdnych ma być DUŻO (eksploracja), podróż między nimi jak w Starsectorze — przejście do strefy międzygwiezdnej (mapa gwiezdna, po której lata gracz), ekonomia między układami uproszczona: gospodarki układów niezależne, między nimi tylko floty kupieckie i wojsko.
- Rejestr `src/data/starSystems.js` (czysty moduł): `STAR_SYSTEMS` — dziś jeden wpis `sol` (`SOL_SYSTEM`: planety i księżyce z `systemMap.js`, gwiazda `r` / `color` / `spectral`, `label` 'SOL', `home`, `handmade: true`). `getStarSystem`, `resolveStarSystemId`, `systemHome`, `globalBodyId`.
- JEDEN UKŁAD NA STRONĘ: `index.html` buduje świat raz przy starcie (stałe `SUN`, planety, pasy, stacje, worker renderu buduje ciała przy pierwszej wiadomości), więc przejście do innego układu = przeładowanie strony. Układ strony (`CURRENT_SYSTEM`, `window.CURRENT_SYSTEM_ID`): `?uklad=<id>` → `systemId` z zapisu gracza (`game`, reguła `statek-gracza`, „Zapis gracza”) → `sol`; nieznany id → `sol` z ostrzeżeniem w konsoli.
- Identyfikatory ciał są LOKALNE dla układu ('earth', 'mars') — w obrębie strony nie zderzają się, bo drugi układ nie jest załadowany obok. Globalny id (mapa gwiezdna, zapis) = `<systemId>:<idLokalny>` (`globalBodyId`). Nie przerabiaj id w grze na globalne.
- Układy NIE leżą w jednej przestrzeni obok siebie: każdy ma własne pudło świata 0…12 mln j. Przy 100 mln j. float32 w shaderach ma krok 8 j. (maska słońca, siatka świateł, gwiazdy) — schodki i drganie.
- `SUN.r` i `SUN.color` biorą się z gwiazdy układu, `SUN.label` — z `label` (radar `buildHudRadarWorldFeatures`, CIC `cicDisplay.js`); planety — `buildSystemMap(…, { planets: CURRENT_SYSTEM.planets })`.
- DOM GRACZA (`SYSTEM_HOME` = `systemHome(CURRENT_SYSTEM)`): `stationId` — start gry swobodnej przy tej stacji, `planetId` — port wezwań wsparcia, rozkaz POWRÓT i holownik (`getSupportWarpHome`), `berthIds` — stanowiska domowe w ruchu v2 (`PLAYER_HOME_BERTHS` w `trafficProtocol.js` czyta je z `SOL_SYSTEM`). Układ bez domu: `home: null` — start przy gwieździe, wsparcie bez portu macierzystego.
- TREŚĆ RĘCZNA (`handmade`) istnieje tylko dla Układu Słonecznego: fabuła (`startGame` — kampania tylko gdy `CURRENT_SYSTEM.handmade`), ekonomia ruchu v2 z tabel `src/data/markets.js`, ringi „Halo” i hala K-7, przelot NEA, baza piratów. Tabele po id planet Sol (`SYSTEM_INDUSTRY_SPEC`, `PLANET_YIELD`, `homeStations` frakcji, `HALO_RING_PLANETS`…) to DANE tego układu, nie błąd do usuwania — układ proceduralny dostaje własne dane z generatora.

## Założenia Układu Słonecznego, które zostają (do zdjęcia przy pierwszym układzie proceduralnym)

Z analizy 2026-11-07 (gra, obraz, ekonomia). Każdy punkt trzeba osłonić albo przenieść do danych układu, zanim gra wystartuje w układzie bez Ziemi:
- Ekonomia: świat ruchu buduje się z rynków Układu Słonecznego — w układzie bez `handmade` trzeba go wyłączyć albo zbudować z rynków układu (`addMarket`); zapis ekonomii jest jeden (klucz `economy`) — przy wielu układach klucz na układ albo pole `systemId`.
- Obraz: barwy kuli i korony słońca są stałymi w grafie (`planet3d.assets.tsl.js` ~759–828) — do uniformów (bez nowego obiektu światła: zmiana `DirectSun` przebudowuje wszystkie pipeline'y); planeta bez `PLANET_MAPS` po nazwie — generator planet (`src/3d/planetGen/`, sesja „Generator planet”); niebo — jeden wypiek `nebula.webp` (wypiek na układ ~3,5–4,6 s GPU, podmiana tekstury bez nowych pipeline'ów); `RING_PLANET_NAMES`, `PORT_DOCK_ANCHOR_IDS`, `ringScale.js` (dopasowanie po fragmencie nazwy — id 'earth-2' dostałby ring Ziemi).
- Gra: przelot NEA i jego tor przy Ziemi (osłonięte `find`), komety omijają Trojańczyków Jowisza, zapasowe `planets[2]` / `[3]` / `[4]` (pas, cel zapasowy), tło menu z Ziemią i ringiem (menu zostaje Układem Słonecznym).
- Sektor i ciała proceduralne: opis układu z mapy gwiezdnej (`src/game/sector/`, sesja „Mapa gwiezdna”) → wpis rejestru z tymi samymi polami (planety `{ id, type, seed, orbitAU, r }`, rodzaje: `terran, ocean, desert, rocky, ice, volcanic, barren, toxic, gas, ice_giant`).

## Jak sprawdzić

- `node --test tests/starSystems.test.mjs` (rejestr, wybór układu, ta sama mapa Sol co tabela domyślna, stanowisko domowe workera z rejestru).
- Gra: konsola `CURRENT_SYSTEM_ID`; `?uklad=nieznany` → ostrzeżenie „[układ] nieznany układ” i Układ Słoneczny.
