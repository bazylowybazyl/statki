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

## 5. Co zostaje

Nad polem gruzu worker ma dalej ~4,4 ms na klatkę (headless, ta maszyna): ~200 rysunków połówek „pod” i odłamów płaskich
w passie BG (~2 ms CPU). Na 240 Hz to wciąż na granicy; u gracza (DevTools otwarte, więcej odłamów) — zapewne poniżej.
Następny krok: PARTIA skór ciał świata — jeden rysunek na zestaw (kawałek × zestaw × połówka), dane egzemplarza (poza
ciała, slot pola skóry, mapa ran, cięcie) w buforze storage ze slotem, jak `hullSkinBatch.js` u kadłubów
(AGENTS.md: „Wiele obiektów jednego rodzaju → partia”). Odłamy jednego kawałka dzielą atrybuty skóry (podzbiory to
indeksy), więc partia jest naturalna per kawałek.
