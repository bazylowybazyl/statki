# Klatkowanie po upadku bazy piratów (2026-10-27)

Zgłoszenie użytkownika: „po zniszczeniu bazy pirackiej i opadnięciu elementów bazy na planetę gra zaczęła strasznie
klatkować; perf pokazywał 240 fps, ale strzelanie, efekty, wszystko strasznie muliło”. Na zrzucie PerfHUD: pętla strony
239 kl/s, „Obraz 3D (worker) 180 kl/s · wiek 5 · CPU 7.1 · GPU 4.6 ms”, wraki gorące / śpiące / zimne 135 / 148 / 63;
konsola workera: 64 ostrzeżenia `[HullSurface] createImageBitmap …` / `wypiek na wątku gry nieudany … drawImage …`.

## 1. Odpowiedź w skrócie

1. **Mulenie = obraz 3D z workera nie nadąża za 240 Hz.** Strzały, efekty, kadłuby i tło rysuje worker renderu; pętla
   strony (i nagłówek PerfHUD) dalej ma 240 kl/s. Po upadku bazy każdy odłam (ciało świata) to osobne siatki skóry
   `worldBodies3D` — bryła 3D: dwie siatki na zestaw (pod / nad płaszczyzną gry, cięcie `clipZ` w shaderze). Nad polem
   gruzu worker rysował ~370 obiektów na klatkę zamiast ~36; three r183 kosztuje ~15–25 µs CPU na rysunek, więc klatka
   workera rosła z ~1,6 do ~4,6–5,8 ms (> 4,17 ms okresu 240 Hz). Obraz 3D ~180 kl/s przy 240 klatkach strony,
   framePacer na wieku maksymalnym (5) — co czwarta klatka powtórzona: judder całego obrazu 3D.
2. **~140–160 z tych rysunków nie dawało ani jednego piksela:** połówki „nad” (pass FG) brył leżących na planetoidzie
   24 km pod płaszczyzną — shader odrzucał każdy fragment, a CPU workera i tak płacił za rysunek (i GPU za wierzchołki).
3. **Ostrzeżenia HullSurface (osobny błąd, ten sam obszar):** pętla „pudła rozgrzania” `updateHexShips3D` zakładała
   skórę sprite'a (tekstura, partia, slot `HullObjectStore`, wypiek mapy powierzchni) także odłamom ciał świata, choć
   predykat skóry (`setBeamSkinSuppressor`) ich nie rysuje. `hull.image` kawałka to raster `{ width, height, data }`, nie
   obraz: `createImageBitmap` i zapasowy `drawImage` padają — raz na kawałek (35 kawałków bazy, ~32 płaskie → 64
   ostrzeżenia). W workerze dodatkowo w PIERWSZEJ klatce lustra odłamu: replika ciał świata dopisywała `hull.world`
   dopiero po kadłubach, więc odłam dostawał skórę sprite'a z pustą teksturą w partii „0|0|0” — po upadku 22 tys.
   niewidocznych czworokątów w partii (i jeden pusty rysunek przy każdym nowym odłamie).

## 2. Poprawki

- `src/3d/hexShips3D.js` — `createBeamSkinMesh` zwraca null dla ciała świata (`hull.world`): bez skóry sprite'a w
  pudle rozgrzania, na liście rysowania i przy przebudowie (obie ścieżki trybu: worker i `off`).
- `src/render/render.worker.js` — `renderPage`: replika ciał świata (stan bloku `worldBodies`, `hull.world` i raster
  luster) PRZED `updateHexShips3D`; `syncWorldBodies3D()` zostaje po kadłubach.
- `src/3d/worldBodies3D.js` — połówka bryły, której sfera egzemplarza (ta sama co przycinanie do kadru) leży cała po
  drugiej stronie płaszczyzny, nie idzie do rysowania (`halfReachesPlane`; licznik `WORLD_SKIN_STATS.halfCulled`, A/B
  `__worldSkinOptions.planeHalfCull = false`; trójkąty w statystyce — tylko rysowane siatki).
- Testy: `tests/worldBodies3D.test.mjs` — rachunek połówki (pod / nad / przecięcie / styk / obrót ciała) i strażnik
  „ciało świata bez skóry sprite'a, replika przed kadłubami” (oba padają na kodzie sprzed poprawki).

## 3. Metoda

Prawdziwa gra przez CDP: Vite + headless Chrome z WebGPU, 1600 × 900, bez limitu klatek, tryb worker (gracza), skok
dev `?story=shipyard`, Atlas nieśmiertelny. Scenariusz: okno „przed” (habitat cały), cztery progi punktów habitatu
(płaskie odłamy), HP 0 → upadek do osiadania, okno „po” (kamera fabuły), okno „nad gruzem” (Atlas nad środkiem bazy).
Odłamy rodzą się, gdy Atlas jest 16 km dalej (`--daleko 1`). Konsola workera przez `Target.setAutoAttach` (sesje
płaskie), czasy klatek workera z pierścienia `__rwFrameTimes`, rysunki wg obiektu z opakowania
`renderer._renderObjectDirect`, passy z `Core3D.lastFrameRenderInfo`, profil CPU workera (Profiler CDP, 250 µs).
Narzędzie: `node scripts/webgpu/baza-po-upadku-gra.mjs --daleko 1 [--profil 1] [--ab 1]` (`--ab 1` — A/B przycinania
połówek w pauzie, ten sam kadr, naprzemiennie ABABAB, zrzuty i porównanie `scripts/webgpu/porownaj.mjs`; tryb off:
`--query renderWorker=0`). Maszyna przed pomiarami: GPU 1%, bez innych przebiegów.

## 4. Wyniki

Przed poprawką (worker, ten sam scenariusz):

| okno | rysunki / klatkę | klatka workera [ms] | uwagi |
|---|---:|---:|---|
| przed | 36 | 1,57 | |
| po (kamera fabuły) | 30–37 | 2,2–5,4 | zależnie od kadru fabuły |
| nad gruzem | 370 (BG 196, FG 152) | 4,59–5,81 | skóry: 91 + 91 „bg pod / nad”, 48 + 48 „fg pod / nad”, 49 płaskich |

Profil workera nad gruzem (przed): klatka 5,81 ms, z tego `renderSingle` 4,58 ms (`_renderObjects` — koszt rysunków
three), `syncWorldBodies3D` 0,27 ms, `updateHexShips3D` 0,26 ms, lustra 0,39 ms. Partia „0|0|0” skóry sprite'a: 2,6 tys.
czworokątów po progach, 22,4 tys. po upadku.

Po poprawce, A/B przycinania połówek w pauzie nad gruzem (237 egzemplarzy skór, 136 połówek bez rysunku):

| | A1 | B | A2 | B2 | A3 | B3 |
|---|---:|---:|---:|---:|---:|---:|
| klatka workera [ms] | 4,72 | 5,89 | 4,45 | 5,80 | 4,38 | 5,72 |
| rysunki / klatkę | 233 | 367 | 233 | 367 | 233 | 367 |
| pass FG: rysunki / CPU [ms] | 14 / 0,32 | 148 / 1,65 | 14 / 0,30 | 148 / 1,62 | 14 / 0,30 | 148 / 1,59 |

Średnio −1,29 ms (−22%) klatki workera, −134 rysunki, −122 tys. trójkątów. Obraz A1↔B: piksele różne o > 8/255 —
0,0003% (maks. 11), szum A1↔A2 (efekty biegną w pauzie) — 0% (maks. 7); o > 2/255: 0,029% ↔ 0,021% — w szumie.
Partia „0|0|0”: 0 czworokątów (nie powstaje), wpisy HullSurface: tylko obrazy okrętów, ostrzeżeń 0.

## 5. Partia skór ciał świata (druga sesja, 2026-10-27)

Cel: nad polem gruzu kilka obiektów renderu skór zamiast ~200, klatka workera wyraźnie < 4 ms przy tym samym obrazie.
Kod: `src/3d/worldSkinBatch.js` (partia i bufor egzemplarzy), `src/3d/worldBodies3D.js` (wpisy, hak passa
`commitWorldSkinStore`), wariant grafu `skinBatch` / `skin3Batch` (`portBuildings3D.tsl.js`), materiał
`PortBuilding3D.skinBatchMaterial`. Opis i zasady: reguła `ciala-swiata` (PARTIE SKÓR).

**Partia (wersja końcowa).** Odłamy jednej skóry kawałka (geometria zestawu) rysują się jednym obiektem renderu na
połówkę: siatka partii stoi na WSPÓLNYCH atrybutach skóry kawałka, indeks partii to podzbiory odłamów, a odłam to
rysunek pośredni `drawIndexedIndirect` (rekord: liczba indeksów, 1 instancja, początek, 0, `firstInstance` = slot;
cecha `indirect-first-instance`, three r183: `geometry.setIndirect(rekordy, przesunięcia)`). Wierzchołek bierze slot
z `instance_index` i dane egzemplarza z bufora storage (`WorldSkinStore`: macierz model-widok, świata, ciało →
budowla, slot pola skóry, mapa ran, rany brył, flagi). Hak passów tła i FG układa co klatkę listę rysunków połówki
(odłamy w kadrze — ten sam test co three, połówka z `halfReachesPlane`, od najbliższych). Odłam poza kadrem nie
kosztuje nic; GPU dostaje nowe dane tylko przy wpisie (indeks + rekord) i slot egzemplarza co klatkę (~84 B).

**Pierwsze podejście — odrzucone.** Wierzchołki podzbiorów KOPIOWANE do wspólnych stron partii (budowla × zestaw ×
rodzaj skóry; slot w `aPbN.w`), jeden rysunek na stronę, niewidoczne odłamy pomijane w wierzchołku. Rysunków skór
~188 → 17, klatka workera −1,3…−1,6 ms, obraz bez zmian — ale kopie to ~1,5 mln wierzchołków (~200 MB, strony
alokowane w trakcie upadku), a GPU przy zajętej pamięci karty (inne procesy 9–10 GB z 16, z harnessem 15,2 GB):

| przebieg (A/B w pauzie nad gruzem) | GPU partii [ms] | GPU własnych siatek [ms] |
|---|---:|---:|
| #1 (inne procesy ~3,7 GB VRAM) | 0,79–0,80 | 0,78–0,86 |
| #2 | 4,82–4,99 | 0,97–1,48 |
| #3 | 9,74–11,18 | 2,41–3,88 |
| #4 | 10,29–12,24 | 3,03–3,85 |

Rozkład w #4 (ta sama pauza, dwa obiegi): partia 10,3–10,9 ms, własne siatki 3,1–3,4, partia z flagami zerowymi
(wierzchołki tylko odczytane i pominięte — nic nie rasteryzuje) 10,9–11,8, bez skór 0,5–0,6 — cały koszt to samo
przejście wierzchołków stron (świeże bufory czytane jak spoza pamięci karty). Kolejność rysowania (three bez
sortowania) dokładała najwyżej ~0,3 ms (`--ab sortowanie`). Wersja końcowa nie alokuje wierzchołków (indeks ~15 MB).

**Wynik wersji końcowej** (przebieg #5, `--daleko 1 --ab partia,diag`, A/B w pauzie nad gruzem; maszyna obciążona —
klient LoL, inne procesy 8,9–9,3 GB pamięci karty; liczą się pary z tej samej pauzy):

| | A1 | B | A2 | B2 | A3 | B3 |
|---|---:|---:|---:|---:|---:|---:|
| klatka workera [ms] | 4,56 | 8,00 | 3,91 | 8,51 | 5,00 | 10,16 |
| GPU [ms] | 1,00 | 1,53 | 0,76 | 2,03 | 0,92 | 1,89 |
| rysunki / klatkę | 67 | 244 | 67 | 244 | 67 | 244 |

A — partie, B — własne siatki. Skóry: 264 egzemplarze, 257 w partiach (33 partie; w kadrze 18 obiektów renderu partii
+ 4 własne siatki brył bez podzbioru) zamiast ~220 siatek; indeks partii 3,6 mln (25 MB z zapasem), wierzchołków
nie przybywa. Rozkład w tej samej pauzie (dwa obiegi): partia — GPU 0,96 / 1,51 ms, klatka 4,6 / 6,0 ms; własne siatki
— 1,99 / 2,12 i 10,2 / 10,6; bez skór — 0,61 / 0,54 i 5,3 / 4,1. Skóry w partii kosztują workera tyle co ich brak
(różnice w szumie obciążonej maszyny), GPU +0,4–0,9 ms ponad brak skór wobec +1,4–1,6 ms własnymi siatkami. Obraz
A1↔B: piksele różne o > 8/255 — 0%, maks. 6/255; szum A1↔A2 — 0,0004%, maks. 12. Pipeline'y synchroniczne 0,
ostrzeżeń HullSurface 0. Klatka workera w liczbach bezwzględnych (3,9–5,0 ms) to tu głównie obciążenie maszyny — bez
skór w tej pauzie 4,1–5,3 ms; na cichej maszynie (przebieg #1, ten sam scenariusz) klatka bez skór ~1,7 ms, a partia
z kopiami (tyle samo obiektów renderu co do rzędu wielkości) 2,0 ms przy 3,3–3,65 ms własnymi siatkami.

Tryb off (`--query renderWorker=0 --progi 0 --czasPo 2 --ab partia`, Core3D na stronie): nad gruzem 70 rysunków z
partiami wobec 276 własnymi siatkami (262 odłamy w 40 partiach, 24 obiekty renderu partii w kadrze), GPU ~0,8 ms w obu
wariantach, obraz A1↔B > 8/255 — 0%, maks. 7 (szum A1↔A2 — 0,0001%, maks. 9), pipeline'y: 31 nowych, 0
synchronicznych.

## 6. Co zostaje

- W workerze 7–8 pokazanych odłamów brył (13–17 narastająco) nie ma podzbioru (`fragmentSkinSubset3D` → null: żaden
  aktywny węzeł ciała nie wpada w kratownicę skóry kawałka) i rysuje się dalej własnymi siatkami z PEŁNĄ skórą kawałka
  (4–6 rysunków, cała geometria bryły maskowana w shaderze) — jak przed partiami. W trybie off takich odłamów nie było
  (tylko 2 z pustym podzbiorem), więc trop: podzbiór liczony na replice workera, zanim lustro ma węzły odłamu — wtedy
  liczyć podzbiór ponownie, gdy węzły dojdą.
- Pozostałe rysunki nad gruzem to nie skóry (~45: bryły bazy i osady, skała, pył uderzeń, domeny gazu, wyrwy,
  wieże 3D) — próg „≤ ~40 rysunków” dotyczy skór; razem ~65 przy 36 przed upadkiem.
- Pomiary GPU na maszynie użytkownika zależą od zajętości pamięci karty przez inne programy — porównywać tylko A/B
  w tej samej pauzie (`--ab partia,diag`, wiersz „GPU na starcie / przed A/B” z nvidia-smi).
