---
paths:
  - "src/3d/spaceGas/**"
  - "src/game/spaceGasInput.js"
  - "src/render/blocks/spaceGasBlock.js"
  - "scripts/webgpu/gaz-kosmos-gra.mjs"
  - "tests/spaceGas.test.mjs"
  - "dema/gazy-transport-webgpu.html"
---

# Gaz w otwartej przestrzeni: pole z transportem gęstości (port dema gazy-transport), scena pasa

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan

Port dema `dema/gazy-transport-webgpu.html` (wygląd zaakceptowany 2026-10-16) według planu `docs/PLAN-gazy-kosmos.md`. Decyzje D1–D8 przyjęte 2026-10-22, postęp w § 6 planu.

- Zrobione: GK-1 (rdzeń pola), GK-2 (wejście gry), GK-3 (mapy i dwie połowy warstwy), GK-4 (pył gazu), GK-5 (scena pasa, część pierwsza) i GK-8 (opcja Wł. / Wył.).
- Czekają:
  - GK-5: przekroje olbrzymów pasa jako przeszkody, wybuchy i pociski jako źródła;
  - GK-6: ring Jowisza;
  - GK-7: ławice mgły;
  - GK-8: okno i mapy z presetu;
  - GK-9: odbiór.
- Hale K-7 mają osobny gaz (reguła `pyl-hal-k7`, `src/3d/hallGas3d`). Ten moduł do hal nie wchodzi.

## Szew i układ

- Gra pakuje wejście klatki. `packSpaceGasFrame` w `src/game/spaceGasInput.js` daje Float64Array `SPACE_GAS_IN` (układ w czystym `src/3d/spaceGas/spaceGasLayout.js`):
  - kotwica sceny (pas — Słońce) w double;
  - kamera i kadr względem kotwicy;
  - wiatr wzdłuż orbity;
  - kierunek ku Słońcu;
  - siatka obwiedni 32 × 32 z `field.sampleMacro`;
  - strugi odgazowania lodowych skał.
- Siatka obwiedni korzysta z tego samego wzoru co płaty mgły `fog.js`, z `hole` i `gas` z E3. Przesuwa się przyrostowo: przy ruchu kamery próbkowane są tylko nowe wiersze i kolumny. Przy nowej `holeVersion` liczy się cała.
- Render (`SpaceGas`, `src/3d/spaceGas/spaceGas.js`, krok Core3D.fx „gaz przestrzeni”) czyta tylko:
  - to wejście;
  - kadłuby z `GAS_OBST_IN` (gra dokłada okno pola do prostokątów domen przeszkód);
  - dysze MAIN z `EngineFrame`.
- Tryb off woła `SpaceGas.submit` w `render()`. Worker bierze bloki `spaceGas` i `gasObst`.
- UKŁAD POLA: świat gry WZGLĘDEM KOTWICY.
  - Bufory GPU trzymają tylko stan komórek, więc kernel przesunięcia początku pul nie jest potrzebny.
  - Szum dostaje argumenty rzędu setek.
  - Mapy i warstwa są ustawiane przez `mesh.position` w double.
  - Nowe dane pola (źródło, przeszkoda) podajesz względem kotwicy, nie w świecie ani względem `fx.origin`.

## Pole (`spaceGasSim.js`)

- Kernele są 1:1 z dema, strojenie w `createSpaceGasTune` (= `SIMT` dema).
- Komórka stała = `velB.w` 2, prędkość ciała w `velB.xy` (bufora `flagB` nie ma). `kAdvect` i `kProject` mają po 7 buforów storage, limit to 8. Nowy bufor w tych kernelach = zmiana układu. Strażnik w teście.
- Okno przesuwa się TYLKO w klatce z krokiem (lekcja drżenia dema).
- Obraz: dwie pary tekstur kroków zapisywane na zmianę, każda z własnym rogiem okna (`sim.image`). Mapy przenikają poprzedni i bieżący krok według ułamka kroku, z opóźnieniem 1/60 s.
- Szum (`spaceGasNoise.js`): z `setLayout` jest tylko `gnoise`. `fbm` i funkcje scen są wklejane (pułapka 35, strażnik w teście).
- Lustra CPU: `srcShapeCpu`, `gnoiseCpu`, `fbmCpu`. Zmiana kernela = zmiana lustra.

## Obraz (`spaceGasMaps.js`, `spaceGasLayer.js`)

- Mapy gazu i światła liczy compute w tekstury storage o stałym rozmiarze (`SPACE_GAS_TUNE.mapW/mapH`), na kadr z zapasem.
  - Mapa gazu: próbka dwusześcienna pola, kolumna nad bryłą z gazu otoczenia, pole dalekie poza oknem i faktura detalu. Faktura gaśnie, gdy teksel mapy przerasta jej skalę.
  - Mapa światła: marsz ku Słońcu z dwiema próbkami na odcinek.
- Warstwa to dwie połowy w passie ortho, z testem głębi i bez zapisu:
  - dolna: z −20, renderOrder −45 — kadłub ją zasłania, skały pasa w niej toną;
  - górna: z +200, renderOrder 900 — po efektach gry, przygasza okręty i strzały.
- W kamerze z góry to złożenie dema z głębią. 8 plasterków dema z paralaksą (kamery 3D) jeszcze nie przeniesiono.
- Światło: mapa światła × `sunVisibility()`, otoczenie × `sunFill`, siatka `Core3D.fx.grid` z kolanem. Gaz sam nie świeci.
- Zanik przy oddaleniu: `fadeView`.

## Pył gazu (`spaceGasDust.js`, GK-4)

- Działa 1:1 jak w demie (`dustStep`):
  - drobiny rodzą się z gęstości pola, z przyjęciem (ρ / ρ₀)³, w kadrze × 1,25;
  - lecą z prędkością gazu;
  - w rzednącym gazie gasną szybciej;
  - poza oknem i w komórce stałej giną.
- Liczba: `SPACE_GAS_TUNE.dustCount` = 80 000 (D2), ustalana przy budowie. A/B: `SpaceGas.tune.dust`.
- POZYCJE WZGLĘDEM ROGU OKNA POLA. Przesunięcie okna przesuwa drobiny w tym samym kroku (`U.shift`), siatka stoi w rogu okna (`mesh.position`, double). Nie zapisuj drobinom pozycji względem kotwicy ani świata — w pasie (1,6 mln j. od Słońca) drobny ruch ginąłby we float32.
- Obraz: kwad instancji (`Mesh` + `InstancedBufferGeometry`, pozycja z buforów storage w `positionNode`), mieszanie addytywne, renderOrder −40 (po dolnej połowie gazu, przed efektami — górna połowa go przygasza).
- Światło: mapa światła i siatka świateł w wierzchołkach, maska słońca we fragmencie. Wygląd: `look.dustColor`, `dustW`, `dustRho`, `SpaceGas.dust.U.gain`.

## Narzędzia

- Testy: `node --test tests/spaceGas.test.mjs` (WGSL w Node, limity wiązań, okno, wejście, mapy, warstwa).
- Gra: `node scripts/webgpu/gaz-kosmos-gra.mjs [--query renderWorker=1]`. Robi zrzuty z A/B bez gazu (postój, ciąg, kanał, przelot, oddalenie), liczy pipeline'y synchroniczne strony i workera (ma być 0) i podaje koszt GPU w trybie off.
- Konsola (`?dev`):
  - `SpaceGas.stats`, `SpaceGas.tune`;
  - `SpaceGas.scene.look` + `SpaceGas.syncLook()`;
  - `SpaceGas.sim.tune` + `syncTune()`;
  - `SpaceGasInputTune.enabled` — A/B dla całego gazu, działa też w workerze.
- Koszt (2026-10-22, RTX, 1600 × 900, okno 256, mapy 768 × 432, pył 80 tys.): render +0,13 ms, compute +0,17 ms na klatkę w gęstym polu (bez pyłu +0,08 / +0,16). Poza pasem: 0 dispatchy i 0 rysunków.
