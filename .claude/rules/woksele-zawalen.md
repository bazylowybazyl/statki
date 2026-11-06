---
paths:
  - "src/3d/woksele/**"
  - "dema/woksele-zawalenia/**"
  - "dema/woksele-zawalenia.html"
  - "src/3d/pirateBaseGame.js"
  - "scripts/webgpu/woksele-*.mjs"
  - "tests/woksele*.test.mjs"
---

# Wiązane woksele: silnik zawaleń na GPU, obraz bazy piratów w misji 1

> Reguła obszaru. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów do `docs/` (`docs/PLAN-zawalenia-lod-miasto.md`, `docs/SPEC-woksele-zawalenia.md`). Zasady przekrojowe i indeks reguł: `AGENTS.md`.

## Co to jest i gdzie leży

- `src/3d/woksele/`: silnik. `solver.js` (kernele TSL: siły, wiązania, kontakt, kratery), `obraz.js` (bryły, gruz, cele głębi i AO, skóra z wypieku), `pyl.js`, `budowa.js` + `budowa.worker.js` (wypiek węzłów w osobnym wątku), `scena*.js` i `miasto.js` (sceny), `wGrze.js` (Core3D gry), `grupyGry.js` (kratery zdarzeń misji).
- `dema/woksele-zawalenia/` i `dema/woksele-zawalenia.html`: demo i jego narzędzia. Gra nie importuje nic z `dema/` (strażnik `tests/graBezGlsl.test.mjs`).

## W grze: obraz bazy misji 1

- Woksele są WYŁĄCZNIE obrazem (zasada żelazna 1). Punkty, kolizje, kawałki, etapy, szyja i upadek dalej liczy silnik belek, a jego bryły i skóry są schowane (`voxActive` w `src/3d/pirateBaseGame.js`). Wynik gry nie zależy od wokseli. `?woksele=0` zostawia stary obraz (`VOX_WYL` w `pirateBaseGame.js`), a gra przy HP 0 idzie tą samą ścieżką zegara.
- START przy zdarzeniu `attach`: wypiek węzłów (~4 s w wątku), rozgrzewka, wypiek skóry. Do końca stoi stary obraz, więc nic nie czeka. Błąd startu zostawia stary obraz.
- SKÓRA: stara baza narysowana raz z góry do celu HDR 4096² (`wypalSkore`, własna scena, maska słońca wyłączona) z głębią, drugi raz 2048² ze zgaszonym słońcem (`uSunVisS` = 0). `sunVisibility()` miesza oba, więc cienie okrętów i ciał padają jak na starej bazie, a lampy świecą dalej. Fragment górnej ściany bez sąsiada w spoczynku bierze kolor z wypieku po pozycji POCZĄTKOWEJ (`vP`), więc tekstura jedzie z kawałkiem. Dalej niż 300–500 j. pod powierzchnią z wypieku wypieku nie ma. Uszkodzony kawałek traci lampy (`sufit`). Nowy wygląd bazy nie wymaga zmian tutaj, wypiek bierze to, co rysuje `PirateBase3D`.
- WNĘTRZA (decyzja użytkownika 2026-11-06: „środek w klimatach budowli”, „żeby przy rozpadzie wyglądało, że coś tam w środku było”): `wnetrzeFn` w `obraz.js`, sam rysunek po pozycji początkowej, bez geometrii. Pomieszczenia 164 × 164 × 62 j. z palety piratów (`POKOJ`, przygaszona: pełne barwy dają konfetti), grodzie, szwy płyt, rury, lampy (gasną z uszkodzeniem i zasilaniem). Pomieszczenie rysuje się na przełomie (ściana z sąsiadem w spoczynku, `vS.w`), na uszkodzonym kawałku i na górnej ścianie bez wypieku, reszta to poszycie z mipmapy wypieku. Ściany fasad (rodzaj `FASADA`, wieżowce) mają pasy okien, bo wypiek z góry ich nie widzi. Linie gasną z odległości (`zan`), żeby z daleka nie migotały.
- KOŁA HABITATU: rogi nienaruszonych bloków części z bitem `BIT_KOLO` (bęben, szyb z wieżą, trzon, dysk) trafiają w promienie z układu (`ustawKola`, `uKola`, pas 0,8 dx), ściany dostają normalną promieniową. Rogi liczone z pozycji, więc sąsiednie bloki dzielą punkt. Uszkodzony blok wraca do kostki. Inne kształty (zbiorniki, skośne pomosty) jeszcze nie mają tabeli. K-7, ring i doki nie mają punktów ani trafień, więc nie mają też węzłów.
- PRZEKRÓJ: ta sama siatka w passie tła (węzły pod `uCiecieZ` = 150, kadłuby je przykrywają) i FG (nad nim), po węźle, bez `discard`. Znak `userData.znakZ` czyta uniform obiektu, pipeline jeden.
- KOSZT W SPOCZYNKU: do pierwszego zdarzenia ani solver, ani cele głębi i AO, sam rysunek. Poza kadrem (`wKadrze`) nic.
- ZDARZENIA idą kanałem `onPirateBaseEvent` (`pirateBaseVoxEvent`): `voxHit` (każde trafienie z `applyDamageToStation`, krater w pierwszym żywym węźle pod płaszczyzną gry, promień z góry), `voxBreak` (kawałek, `grupyGry.kawalek`), `voxNeck` (kierunek upadku), `voxFall` (sektory dysku, potem kotwice). Nowa ścieżka łamiąca kawałek bazy i tak idzie przez `storyBaseBreak`, więc obraz dostaje zdarzenie sam. Trafienie z pominięciem `applyDamageToStation` nie zrobi krateru.
- CO SPADA, A CO ZOSTAJE (decyzje użytkownika 2026-11-06): spada CAŁA baza („nie podobało mi się, że coś zostaje”). Grawitacja ciągnie wszystko, a odpycha się tylko to, co ma reaktor antygrawitacyjny i jest niezniszczone: okręt, który przeżył, stoi dalej przy pomoście, który właśnie spadł. Wraki okrętów nie spadają (decyzja 2026-11-06): nie są 3D i zostają na warstwie gry.
- UPADEK: `voxFall` tnie szyję i sektory dysku (`grupyGry.upadek`), a kotwice puszcza fala od osi habitatu (`puscKolo`, kernel `kPusc`: start 3 s, 1500 j./s, `FALA_*` w `wGrze.js`). Najpierw spada habitat, pomosty za nim po kolei. Wszystko naraz zostawiało kształt bazy w pyle jak szablon.
- GRAWITACJA: pod najniższym węzłem wypieku stała −z przechodzi na drodze `POLE_ZAKRES_J` w pole ku środkowi skały (`uGMiesz`, `ustawGinie`). Stała −z na kuli zsuwa gruz z każdego zbocza powyżej kąta tarcia (35°). Nad tym progiem budowla stoi w polu, w którym ją wypieczono, więc czeka na falę kotwic bez sił bocznych. Węzły spadają więc ku środkowi skały, a siatka kubełków i łata kraterów stoją na rzucie środka bazy na kulę (`ustawSkale`).
- LĄDOWANIE (uwagi użytkownika 2026-11-06: drobny gruz „odbija się jak piłeczki”, „fajnie wygląda, jak duża kupa spada i się rozwala”): kontakt w `kF` z prawdziwą bryłą skały, nie z kulą (`promienSkalyNa`, mapa kształtu 64², bo bryła odchodzi od kuli do ±1600 j.). Uderzenie prawie nieelastyczne (0,7 prędkości ku skale ginie w jednym kroku), sprężyna wypycha najwyżej z `KULA_V_WYJ`, a pas `KULA_PAS_J` nad skałą gasi odskok, także od wiązań małej grudki. Rozrzut na boki zostaje, a wielka bryła dalej się rozbija, bo jej góra leci ponad pasem. Około 70 % szybkich węzłów paruje przy uderzeniu (`KULA_PAR_*`, stałe po numerze węzła). Węzły spowolnione przez wiązania w dużej bryle nie parują, więc po dużym uderzeniu zostaje hałda. Węzeł i gruz głębiej niż R − 2000 giną (bezpiecznik, `kI`, `kGruz`). Gruz przy skale ma jej światło (`vNaSkale`, na wierzchołku), bo inaczej hałda świeci na nocnej stronie.
- ZEGAR UPADKU (`upadekT`) idzie z krokami solvera, nie z czasem gry: fala, odczyt uderzeń i zamrożenie nie wyprzedzą tego, co naprawdę spadło. Po HP 0 solver liczy także poza kadrem, najwyżej `ZGAS_PO_S` (38 s kroków) raz na grę, potem staje, a ruiny zostają w ostatniej pozie jako sam rysunek, tylko w passie tła. Cele głębi i AO tylko w kadrze. `wKadrze` po pierwszym zdarzeniu dolicza głębokość ruin, bo kadr perspektywy na skale jest dużo szerszy niż w płaszczyźnie gry.
- KRATERY: jeden na bryłę, nie na kubełek, od pierwszego zdarzenia, nie od HP 0: gruz zniszczonego wieżowca też zostawia ślad. Miejsce krateru liczy się z promienia skały w tym punkcie (`promienLok`), bo kierunek z samej kuli wypadał na zboczu do kilkuset jednostek obok gruzu. Co 0,25 s kroków solvera `kGinieLicz` liczy węzły przy powierzchni w kubełkach rzutu XY (64 × 64, 250 j.), a sąsiednie kubełki z przyrostem ≥ `PLAMA_KUBELEK_MIN` z jednego odczytu to jedna bryła (`czytajUderzenia`). Bryła ≥ `PLAMA_MIN` węzłów robi krater o promieniu `KRATER_J` · ∛węzłów, więc wielka bryła zostawia wielki krater, a sypki gruz sam pył. Uderzenie w istniejący krater dosypuje mu masę, a stempel idzie dopiero, gdy promień urósł o `KRATER_WZROST` (`pokazUderzenie`). Krater na kubełek dawał tysiące równych dołków.
- MAPA KRATERÓW (`PirateRock3D.setCraterPatch` / `addCrater` / `flushCraters`): tekstura RGBA16F 512², wysokość w jednostkach świata, spalenizna, wyrzut. Punkty sceny przelicza macierz `_naKule` z ramki bazy, nie `matrixWorld` siatki, bo w skoku gracza ta ma w sobie soczewkę i krater trafiłby obok ruin. Głębokość rośnie z promieniem, a rzeźba w `colorNode` liczy prawdziwy spadek terenu wobec słońca, więc duży krater jest cieniowany jak mały. Nowa misa wybija to, co było w jej środku. Mapa zostaje do nowej gry (`clearScars`).
- PYŁ UPADKU: `kPylSkala` (`pyl.js`, tylko `wGrze`). Węzeł pierwszy raz przy powierzchni (1 na 9) rodzi pył regolitu po stycznej w barwie skały, w passie tła. Starego dymu na skale już nie ma.
- GRA PRZY HP 0 (`index.html`, `startVoxBaseFall`): stare ciała bazy i ich wraki znikają od razu, wyrwy powietrza też (`detachPirateBaseAtmosphere`: jechały z ciałami), kawałki habitatu tracą statykę od razu, a reszta budowli po puszczeniu kotwic. Misja, komunikaty i ujęcie kamery idą tym samym `_baseFall` z zegara (`VOX_FALL_T`), bez czytania wokseli. Starej fizyki upadku nie ma, pomiar kosztu sprzed usunięcia: plan LOD § 5e.
- CZAS: `updatePirateBase3D` w workerze dostaje przyrost zegara strony od ostatniej przetworzonej strony (`pirateBaseClock`, `warpFxDt`), do 3 kroków solvera na klatkę obrazu: zawalenie nie zwalnia przy spadku klatek obrazu.

## Pułapki

- Obraz wyrw (`pirateBaseVents3D.js`) dostaje czas klatki także bez wyrw. Odpięcie powietrza przy czasie 0 zamrażało parę i ogień na stałe w miejscu odpięcia, a wyglądało to jak świecące kule na skale.
- Licznik `kGinieLicz` nie przycina do siatki, tylko pomija węzły poza nią. Przycięcie robi z zabłąkanych węzłów proste rzędy kraterów wzdłuż brzegu, które łatwo wziąć za ślad spadających pomostów.
- `compileAsync` nie przelicza bryły widzenia podanej kamery: siatki z `frustumCulled` odpadają na starej i ich pipeline powstaje potem synchronicznie. Wypiek zdejmuje culling na czas kompilacji i rysunku.
- Siatki wokseli są niewidoczne do końca rozgrzewki: dodane widoczne rysują się w klatce gry przed końcem `warmup.now` i kompilują synchronicznie.
- Słońce gry leży prawie w płaszczyźnie, więc z góry beton dostaje samo otoczenie: `uBetonSwiatlo` (emisja z góry). Bez tego gruz jest czarny.
- Węzły TSL poza `Fn` (np. przy materiale): `.toVar('nazwa')`, nie pomocnik `fv` z `assign`, bo `assign` bez stosu `Fn` nic nie robi.
- `klatkiStronyS` z `gpu-baza-gra.mjs` nie jest czasem klatki gry: headless bez taktu odkłada rAF (okna 32 kl/s w każdym wariancie). O przestojach strony mówi pole `fizStrona`.
- Nowe pole zdarzenia przechodzi przez `plainData` strony: liczby i napisy, bez obiektów gry.

## Otwarte

- Gruz po zawaleniu dalej się rusza (brak usypiania). Na skale kończy to zamrożenie po 38 s, ale hałda na pomoście i dysku drga, zanim baza spadnie. Usypianie: metoda H w planie LOD.
- Przed HP 0 kolizje są stare: gracz może uderzyć w schowaną bryłę tam, gdzie woksele już spadły.
- W 5120 × 1440 w pierwszych sekundach upadku strona ma przerwy 100–290 ms między klatkami, bez JS i bez związku z odczytem uderzeń (plan LOD § 5e). Czy widać je w oknie gracza, jeszcze nie wiadomo.
- Woksele, które nie wstały (błąd budowy): stary obraz zostaje, ale przy HP 0 gra i tak idzie ścieżką `startVoxBaseFall`, więc baza znika kawałkami bez spadania. Rzadka ścieżka błędu, naprawa po stronie `pirateBaseGame.js` (flaga błędu, `breakChunk` kawałków).

## Jak sprawdzić

- `node scripts/webgpu/gpu-baza-gra.mjs --rozmiar 1280x720 --query limitKlatek=60 --strzalyMaks 120 --slad 0 --czasPo 6 --out .tmp/woksele-demo/GRA/<katalog>`: cała misja bez okna, kadry przed, trafienia, upadek, nad gruzem, liczniki, pipeline'y synchroniczne (ma być 0). `--seria 2.5`: kadr co 2,5 s, do oglądania ruchu (zaburza czasy). `--sonda 1`: na końcu misji gaśnie po kolei każda grupa materiałów sceny, kadry `sonda-NNN.png`: tak ustala się, co świeci w kadrze, zamiast zgadywać. `--wkStart` / `--wkKoniec <plik>`: wyrażenie JS w workerze po starcie wokseli i na końcu misji (wynik w `wk-koniec.json`), `--stronaStart` / `--stronaKoniec <plik>`: to samo na stronie gry od HP 0 (`strona-koniec.json`, np. obserwator `long-animation-frame` na zacięcia), `--sladUpadek 1`: ślad Chrome po trzech pierwszych oknach upadku.
- Testy: `node --test "tests/woksele*.test.mjs"`.
