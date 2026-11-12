---
paths:
  - "src/data/spaceTrucks.js"
  - "src/game/spaceTruckTrain.js"
  - "src/3d/spaceTrucks3D.js"
  - "scripts/ciagniki-sprite.mjs"
  - "scripts/webgpu/ciagniki-demo.mjs"
  - "dema/ciagniki.*"
  - "assets/ships/trucks/**"
  - "tests/spaceTruck*.test.mjs"
---

# Ciągniki kosmiczne: małe ciężarówki z 1–5 naczepami na przegubach

> Reguła obszaru. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Propozycja wpięcia, liczby i decyzje użytkownika czekające na odpowiedź: `docs/PROPOZYCJA-ciagniki.md`.

## Stan

- Demo z czystymi modułami, **do gry nic nie jest wpięte**. Kierunek od użytkownika: „małe ciągniki à la truck simulator”, które odbierają towar od dronów i wożą go po ringu i do Ziemi; megafrachtowiec jako ciężarówka „za duży”.
- `src/data/spaceTrucks.js` (czyste dane: ciągniki `light` / `standard` / `heavy`, naczepa, moduł ładunku, malowania, światła, dysze, obrysy, atlas), `src/game/spaceTruckTrain.js` (kinematyka, bez three), `src/3d/spaceTrucks3D.js` (partia TSL), `scripts/ciagniki-sprite.mjs` (malarz PNG), `dema/ciagniki.html` / `.js`, testy `tests/spaceTruckTrain.test.mjs`, `tests/spaceTrucks3D.test.mjs`.

## Rozmiar

- Naczepa wozi MODUŁ 2 × 2 kontenery gry (`TRUCK_MODULE`, 32,25 × 16,25 j. = chwyt płaski drona L), nie pojedynczy kontener 16 × 8 j. Skala 1 × 1 zostaje jako A/B (`TRUCK_SCALES.container`, ta sama grafika × 0,5; `createTruckTrain(…, { scale })`). Liczby: `docs/PROPOZYCJA-ciagniki.md` § 1.

## Kinematyka

- Czoło rusza właściciel (`stepTruckTrain(train, x, y, kąt, dt)` z pozą końca kroku), naczepy idą krzywą pościgu: punkt prowadzenia `axleX` ciągnięty na sztywnym ramieniu za przegub, droga przegubu dzielona na odcinki `maxSeg` — wynik prawie nie zależy od kroku fizyki, stałych „na krok” nie ma (`PHYS_HZ` 60 / 120 — test).
- Ogranicznik `maxBend` 50°: geometria (zaczep tylny 4 j. za bryłą, oko dyszla 6 j. przed bryłą) daje przy nim odstęp obrysów. Zmiana `body`, `kingpinX`, `rearHitchX` albo `tail` ciągnika → test obrysów (rufa ciągnika i wyloty dysz nie mogą wchodzić w zamiatany obszar: ~6 j. wolnego koła wokół siodła, gondole co najmniej 3,5 j. przed przegubem albo poza 11 j. od osi).
- Najciaśniejszy łuk bez ogranicznika: `truckMinTurnRadius(ciągnik, naczepy)` (rachunek stanu ustalonego `truckSteadyBend`, test; 5 naczep ~78 j.). Kolejne przeguby ściskają się mocniej niż pierwszy — ścieżka ruchu ma mieć R co najmniej tyle.
- Bez alokacji w kroku: pętle zamiast `TypedArray.set`, `+x` przy wejściu do pętli (argument bez typu pakuje `lx`, `ly`, `la` na każdym przegubie), zawijanie kąta wprost.

## Obraz

- Dwa rysunki na wszystkie zestawy: sprite'y (`spriteMesh`, atlas, instancja 20 liczb z przeplotem: poza, wymiary, komórka, farba, akcent) i emitery (`emitMesh`, lampa / płomień / stożek, addytywnie, 12 liczb). Graf i materiały RAZ na moduł. Bez Core3D i bez `src/game` (szew renderu, test importów): właściciel daje scenę, rozgrzewkę (`warmupMeshes()` + `WARIANT_INSTANCJI` / `instanceCount ≥ 2`) i co klatkę `update({ x, y, ppu, viewW, viewH, time, alpha, sun })`. Poza klatki z `alpha` — interpolacja `px` → `x` z pociągu.
- Atlas (`trucks_atlas*.png`) rysuje malarz; albedo jest MNOŻONE PRZEZ ALFĘ w liniowym (mipmapy bez obwódek, mieszanie `ONE, 1 − alfa`), kanał `_n` — normalna + połysk, `_m` — maski farby, akcentu i emisji okien. Malowanie to mnożenie neutralnej farby przez barwę instancji: nowa linia = wpis `TRUCK_LIVERIES`, bez nowego PNG. Poziom mipmapy liczony z zoomu z sufitem `maxLod` — margines `pad` 64 px; zmiana `pad` albo układu komórek → `node scripts/ciagniki-sprite.mjs` (test wymiarów PNG).
- Daleki zoom: `minWidthPx` (naczepa ≥ 2,4 px) poszerza sprite'y i płomienie w poprzek, lampy mają najmniejszy promień w px i przygaszenie `farLight*`, poniżej `detailMinPpu` lampki dachu i środkowe markery wypadają. Zwykłe powierzchnie pod progiem bloomu (`sunPower` + `ambient` ≈ 1), emitery > 1. Słońce wyżej niż na kadłubach gry (`sunElevation`, jak łup).
- Wysyłka przez `zbierzZakres` (`zakresyWysylki.js`), nie `addUpdateRange` — bufor z przeplotem i tak by poszedł w całości na drugi atrybut.

## Wygląd

- Kreator kadłubów odpadł po próbie: daje płyty Terra Novy, kratownicę i „mały okręt”, bez kabiny i malowania na instancję. Malarz `scripts/ciagniki-sprite.mjs` (pola odległości → wysokość → normalne, wnęki, kontur, brud) rysuje z tych samych liczb co dane. Zmiana wyglądu: funkcja części w malarzu, potem `node scripts/ciagniki-sprite.mjs --podglad .tmp/ciagniki/podglad.png` (arkusz bez przeglądarki).
- Cechy sylwetki, które trzymają „ciężarówkę” przy małym zoomie: gondole dysz za szeroką kabiną, siodło, dyszel z okiem, kominy, lusterka, pięć lampek na daszku, długa maska ciężkiego ciągnika. Bez napisów i logo (konwencja `assets/ships/README.md`); linie fikcyjne.

## Jak sprawdzić

- `node --test tests/spaceTruckTrain.test.mjs tests/spaceTrucks3D.test.mjs` (także `WOLNY_ZEGAR_MS=5 node --import ./scripts/wolny-zegar.mjs …` i `node --concurrent-recompilation-delay=200 …`).
- Zrzuty: `node scripts/webgpu/ciagniki-demo.mjs --out .tmp/ciagniki/zrzuty [--tylko start,zoomy,luki,skala,daleko,galeria,kontener,panel] [--goly 1]`; raport `raport.json` (partia, zgięcia, błędy konsoli — ma być 0). Demo: `/dema/ciagniki.html` (`?view=1…5`, `?zoom=`, `?skala=kontener`, `?goly=1` — goły `WebGPURenderer`, bez bloomu i proxy).
