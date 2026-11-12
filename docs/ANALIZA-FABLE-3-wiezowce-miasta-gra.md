# FABLE-3: wieżowce miasta bazy piratów w grze (misja 1) — diagnoza i poprawki

Data: 2026-11-12. Stan repozytorium: main `545d9466`. Autor: sesja „Silnik fizyki 3D” (Fable 5.2), trzecie zlecenie sesji „Demo: ostre kawałki i zbrojenie na wokselach”.

Metoda: sam Node, bez GPU i bez edycji repozytorium. Wypiek dokładnie jak w grze (`scenaB1({ dx: 40, wGrze: true, gruntZ: -70000 })` → `zbudujPlan`), przepisy kraterów prosto z `grupyGry.js` (`createGrupyGry(...).kawalek(id, tryb)`), ustawienia z `wGrze.zaladuj` (fala względna w bryle oderwanej, lepkość do progu fali), krater jak `kKrater` + `kCzysc`, trafienie jak `wGrze.krokFizyki`. Solver: kopia wzorca CPU (`wzorzec-fable.mjs`). Liczony jest wycinek: cały wieżowiec-cel i wszystko w promieniu 520 j. od jego osi (taras dysku, sąsiednie wieżowce), brzeg wycinka unieruchomiony. Dawny układ: pliki z commita `111e708e` wyjęte `git archive` do scratchpada.

## Najważniejsze

1. **Główna przyczyna to błąd wypieku, nie przepis kraterów.** W main limit etykiety „oderwane od kotwic” (`capEtyk`) wynosi **90008** zamiast około 100. Powód: 106 węzłów pokładu pomostów N-P i F-P zamkniętych wewnątrz obudów reaktorów AG-1 i AG-2 nie ma drogi do żadnej kotwicy, więc dostają etykietę 60000, a limit liczy się jako 1,5 × największa etykieta + 8. Jest tak od commita `c2ad2b05` (reaktory na pomostach). Dawny układ (`111e708e`): `capEtyk` = 112, zero takich węzłów.
2. Skutek w grze: bryła odcięta kraterami potrzebuje 375 s, żeby solver uznał ją za oderwaną. Do tego czasu działa na nią tłumienie „stoi albo pęka” (`uLepV2` = próg fali 60 j./s, `uLepL` = 10 1/s), a prędkość graniczna spadku to g / lepL = **40 j./s, czyli poniżej progu 60**. Odcięta góra wieżowca opada więc 25–39 j./s i nigdy nie przyspiesza.
3. Pomiar (B-01, ostrzał): w main dach po 17 s od przekroju jest nadal 310 j. nad płaszczyzną gry, przechył do 2°, wiązania dachu 100 %. Po poprawce wypieku ten sam przepis zrzuca cały budynek pod pas gry w 2 s od przekroju. Dawny W-1 zachowuje się jak wariant po poprawce.
4. Poprawka limitu przywraca zawalenie, ale nie przewracanie: przepis tnie symetrycznie przez oś, więc budynek zapada się pionowo (przechył 10–15°). Dawny W-1 przewracał się dlatego, że stał na wąskim pomoście i góra zsuwała się z podestu w pustkę. Przewracanie w mieście daje czyste cięcie płaszczyzną z obrotem startowym (`solver.puscCzesc`, to samo, czym gra zrywa wieżę): 8° / 24° / 49° po 0,5 / 1,5 / 2,5 s.

## 1. Dowód głównej przyczyny

### 1.1 Skąd 90008

- `src/3d/woksele/budowa.js:532–535`: etykieta każdego węzła grupy „wieza” startuje od 60000 (`NIEODWIEDZONY`), kotwice od 0, `rozlejEtykiete` (linie 326–343) rozlewa odległość po sąsiadach i zwraca największą etykietę, także nieodwiedzoną. Potem `capEtyk = max(capEtyk, ceil(mx · 1,5) + 8)`.
- `src/3d/woksele/scenaBazy.js:84–120` (`budujReaktory`) stawia obudowę reaktora okrakiem nad pomostem: ściany `KOLUMNA` na całym obwodzie od `zBell` (−276) do `zFg` (+203), czyli przez cały zakres pokładu pomostu (−156…+35). Reaktory powstają przed pomostami, a `budujPomosty` (linie 173–190) wypełnia potem wolne komórki pokładu, także te wewnątrz obudowy (własny pas pomostu i „podest”, linia 186). Części nie mają wiązań między sobą, więc pokład w środku obudowy to wyspa. Jej dolna warstwa nie jest dolną warstwą części (tam leży dno obudowy), więc wyspa nie ma kotwic.
- Pomiar (`etykiety.mjs`):

| wypiek | węzły | `capEtyk` | węzły bez drogi do kotwicy | gdzie |
|---|---|---|---|---|
| `111e708e` (dawne wieżowce na pomostach) | 85 020 | 112 | 0 | — |
| `c2ad2b05` (pierwszy commit miasta i reaktorów) | 124 115 | 90008 | 106 | N-P 54, F-P 52 |
| main `545d9466` | 123 867 | 90008 | 106 | N-P 54 (z −60…−20, środek (−3440, 0)), F-P 52 (środek (3305, 0)) |
| main + poprawka z 4.1 (kopia w scratchpadzie) | 123 578 | 103 | 0 | — |

  Wszystkie 106 węzłów leży wewnątrz rzutu obudów: AG-1 54 z 54, AG-2 52 z 52, poza obudowami 0. Największa prawdziwa etykieta w main to 63, więc limit powinien wyjść 103. Uboczny znak tej samej wady w obu wypiekach: `info.grupy.wieza.maxUgiecieLiniowe` = 5,3 · 10⁷ (osobna sprawa, w dawnym też).

### 1.2 Co robi solver z bryłą, która „nie jest oderwana”

Etykieta odciętej bryły rośnie o 1 na podkrok (`solver.js:475`), 4 podkroki na klatkę przy dx 40. Od 63 do 90008 to 375 s; przy limicie 103 to 0,2 s. Dopóki etykieta < limit:

- `solver.js:535`: lepkość spoczynkowa działa przy v² < `uLepV2`. Gra podnosi `uLepV2` do progu fali (`wGrze.js:189`), więc tłumienie działa do 60 j./s, a spadek swobodny z tłumieniem 10 1/s zatrzymuje się na 40 j./s. W demie B1R (bez tłumienia, próg 25 j./s) bryła przechodzi próg po 0,1 s, dlatego harness dema tego nie pokazał.
- `solver.js:431`: fala łamiąca liczy prędkość bezwzględną zamiast względnej (`uFalaWzgl` nie ma zastosowania).
- `solver.js:315`: sprężenie F0 nie jest wypiekane przy oderwaniu, więc odcięty kawałek niesie siły projektowe, które już się nie równoważą (stąd stały przyrost zerwanych wiązań podczas „wiszenia”: 1188 → 2704 między 3. a 20. sekundą).
- `solver.js:481`: odcięty kawałek dysku nie dostaje ciężaru (waży dopiero przy etykiecie = limit albo przy szkodzie).

Nie dotyczy to brył puszczanych przez `puscCzesc` (wieża przy `voxNeck`, zgniot pod wieżą, fala upadku): kernel wpisuje im etykietę = limit wprost (`solver.js:991`). Dlatego wieża i upadek bazy działają, a wszystko cięte samymi kraterami przed HP 0 (wieżowce, reaktory, pomosty, zbiorniki, sektory dysku) wisi.

### 1.3 Pomiar: ten sam przepis, trzy wypieki

Zdarzenie `voxBreak` w t = 0,5 s, przekrój przepisu w t = 2,9 i 3,02 s. „Dach” to trzy górne warstwy węzłów. „Nad pasem” to węzły celu z z > 150 (rysowane nad statkiem), „w pasie” to |z| ≤ 150.

B-01 (pierścień wewnętrzny, rzut 280 × 320, podstawa z −320, dach z 920), tryb 0 (ostrzał):

| t [s] | main (limit 90008): dach z, vz, nad pasem / w pasie | po poprawce (limit 103): dach z, vz, nad pasem / w pasie |
|---|---|---|
| 3 | 809, −33, 741 / 371 | 773, −178, 703 / 401 |
| 4 | 771, −39, 670 / 435 | 450, −411, 401 / 665 |
| 5 | 734, −35, 646 / 423 | 57, −344, **0** / 522 |
| 6 | 698, −36, 631 / 421 | −111, −64, 0 / 240 |
| 10 | 562, −31, 503 / 546 | −175, −7, 0 / 125 |
| 14 | 459, −24, 382 / 640 | −204, −5, 0 / 80 |
| 20 | 310, −27, 234 / 640 | (koniec biegu 14 s) |

W main dach ma przez cały czas 100 % wiązań i przechył 0,5–2,2°, a 1239 z 1293 żywych węzłów solver uważa za połączone z kotwicami. Po poprawce: przechył dachu 10–13°, wiązania dachu 16 %, gruz luzem na tarasie w z −370…−60, pokład tarasu trzyma (pod pokładem około 30 węzłów).

Pozostałe biegi:

| bieg | main (90008) | po poprawce (103) |
|---|---|---|
| B-01, tryb 2 (taran; przekrój w 0,55 i 0,63 s) | dach z 839 → 284 w 20 s, vz −24…−38, przechył ≤ 4,7° | dach z 596 (2 s), 157 (3 s), −85 (4 s); nad pasem 0 od 4. s |
| B-13 (pierścień zewnętrzny, 320 × 480, podstawa −400, dach 960), tryb 0 | dach z 886 → 414 w 16 s, vz −25…−38 | dach z 280 (5 s), −127 (6 s); nad pasem 0 od 6. s; taras nie trzyma: 757 węzłów pod pokładem, 286 poleciało dalej; w pasie po 16 s 2 węzły |
| B-01, 8 trafień po 300 przed pęknięciem | jak wyżej (dach z 409 po 16 s) | dach z −115 w 8. s (pęknięcie w 2,87 s, przekrój w 5,3 s) |

## 2. Pięć objawów: ranking przyczyn

**(1) „Strzelam, broń przebija wieżowiec i tyle, jakby nic się nie działo”**

1. Po wyzerowaniu puli kawałek w grze znika: `storyBaseBreak` (`index.html:36925–36957`) → `worldBodies.breakPiece`, a odłamy schodzą z silnika (`drainVoxBaseDrop`, `index.html:37004`). Pociski nie mają w co trafić, więc nie ma też `voxHit`. Obraz powinien wtedy paść, a przez błąd z punktu 1 stoi kilkadziesiąt sekund. To daje dokładnie „przebija i nic”.
2. Nawet po poprawce zostaje okno 2,4 s salw + około 2 s spadania, w którym budynku w grze już nie ma, a w obrazie jeszcze stoi (`grupyGry.js:53`: `tSalw` 2,2, `tCiecia` 2,4).
3. Przed wyzerowaniem puli (2500, `pirateBaseSite.js:36`) trafienia prawie nie zmieniają obrazu widzianego z góry: krater `voxHit` powstaje w pierwszym żywym węźle pod z = 150 (`wGrze.js:29`, `397–398`), promień przy 300 obrażeń to 73 j., rdzeń 0,5, więc znika 1–2 węzły, a 4–14 traci wiązania (osiem trafień: kratery w z 147 … −17). Nad tym miejscem jest 770 j. nietkniętej bryły i dach, więc kamera z góry tego nie widzi. Pocisk zdejmuje punkty habitatu raz na pocisk (`index.html:28900`), przebicie kolejnego wieżowca tym samym pociskiem nic nie zdejmuje.

**(2) „Potrafię przelecieć pod samymi dachami”**

1. Błąd z punktu 1: odcięta góra opada 25–39 j./s. Dach B-01 jest nad pasem gry jeszcze po 17 s od przekroju (z 310), dach B-13 po 13 s (z 414).
2. Statek nie zderza się z wokselami (zasada 1), a ciała belek kawałka już nie ma, więc przelot jest zawsze możliwy. To poprawne, błędny jest tylko obraz.
3. Wysokość cięcia: przekrój wypada 460 i 660 j. nad podstawą (37 % i 53 % wysokości B-01), bo `budynek()` liczy od pokładu pomostu (`grupyGry.js:52`, `zNad` = 35,3; nie 84). Samo w sobie nie zostawia dachu w powietrzu (po poprawce limitu wszystko spada), ale zostawia kikut 240–250 j. przy podstawie i decyduje, gdzie ląduje gruz.

**(3) „Wieżowce nadal się nie przewracają”**

1. Błąd z punktu 1: w ogóle nie spadają.
2. Po poprawce: przepis jest symetryczny (dwie kule przez oś), a wieżowiec stoi na szerokim tarasie między sąsiadami (ulice 120–230 j.), więc zapada się pionowo, przechył dachu 10–15° (B-13: do 50°, dopiero gdy gruz przebija taras).
3. Tłumienie „stoi albo pęka” gasi powolny początek przechyłu bryły połączonej z kotwicami. Po czystym odcięciu nie ma znaczenia.

**(4) „Gruz się strasznie zbiera i nie mogę go uderzyć”**

1. Błąd z punktu 1: ziarna z pociętej strefy też są „połączone” i opadają najwyżej 40 j./s. W main w pasie gry wisi 420–660 węzłów B-01 przez co najmniej 20 s (B-13: 640–1020). Po poprawce w 3 s od przekroju zostaje 240, potem 80 (dolny skraj pasa, z −150…−60), reszta leży na tarasie 170–370 j. pod płaszczyzną albo spada pod dysk.
2. Gruz nie ma kolizji z założenia (zasada 1). Po poprawce leży pod statkiem i jest rysowany w passie tła, więc nie wygląda na przeszkodę.

**(5) „Piętra zapalają się na pomarańczowo, piętrami”** (ranking mniej pewny: nie widzę obrazu)

1. Żar kraterów przekroju. `kCzysc` (`solver.js:700–707`) wpisuje żar każdemu węzłowi, któremu krater zabrał wiązanie, a obraz świeci nim 1 s na pomarańczowo (`obraz.js:606–622`). Przekrój to kula o promieniu 233–308 j. ze znakiem S = 3 dla wszystkich węzłów z pasa. Pomiar dzisiejszego przepisu: B-01 żar na 248 węzłach w 13 warstwach (z −60…420) i 0,12 s później na 174 węzłach w 7 warstwach (z 300…540); B-13 624 węzły w 17 warstwach i 400 w 11. Wszystkie salwy razem dają 139–158 węzłów. Czyli 75–87 % żaru pochodzi z dwóch „cięć”, które nie są wybuchem, i zapala naraz 13–17 pięter od ściany do ściany.
2. Lampy wnętrz na węzłach uszkodzonych. Węzeł z obrazową szkodą > 0,001 rysuje się jako kawałek z wnętrzem (`obraz.js:402`, `823–836`), a lampy wnętrz (pasy co 62 j., barwa (1,5; 0,78; 0,28), `obraz.js:862–864`) świecą pełną mocą przy małej szkodzie i gasną do 0,3. Przy błędzie z punktu 1 blok miażdży się powoli, warstwa po warstwie (około jednej warstwy na sekundę), więc kolejne piętra przechodzą przez zakres jasnych lamp po kolei. To hipoteza, do sprawdzenia na kadrach.
3. Rozlew szkody solvera na sąsiadów NIE zapala pięter: obraz bierze `0,35 · szkoda` i próg 0,3 (`obraz.js:191–200`), więc sam rozlew (≤ 0,71) daje szkodę obrazu 0. Sprawdziłem, bo w profilu warstw wyglądało to groźnie.

## 3. Porównanie z dawnym W-1 (`111e708e`)

- Ten sam przepis i te same wysokości: W-1 miał podstawę w z −560, głębiej niż dzisiejsze wieżowce (−320 i −400), a przekrój 700 i 900 j. nad podstawą (40 % i 51 % wysokości). Wysokość cięcia nie jest więc tym, co się zmieniło.
- Zmieniły się dwie rzeczy: `capEtyk` 112 → 90008 oraz podłoże (pomost 170 j. z podestem ×30 i pustką dookoła → szeroki taras między sąsiadami).
- Bieg W-1: przekrój w 2,9 s, dach vz −293 w 4. s, przechył 8,8° (5 s), 14,6° (6 s), 50,7° (8 s), 71° (10 s), 85° (20 s), przesunięcie w bok 52 → 154 → 331 → 523 j. Góra zsuwa się z podestu, obraca i leci na planetoidę. To jest zachowanie, które użytkownik pamięta jako dobre.
- B-01 po samej poprawce limitu: zawalenie równie szybkie, ale pionowe (10–15°), gruz zostaje na tarasie.

## 4. Poprawki

### Obraz (woksele): wdrażać

**4.1 [krytyczna] Wyspy pokładu w obudowach reaktorów.** `src/3d/woksele/scenaBazy.js`, `budujPomosty`, po linii 184:

```js
      // Pokład wewnątrz obudowy reaktora to wyspa bez drogi do kotwicy (ściany obudowy są inną częścią): jej etykieta 60000 podbijała cap do 90008.
      for (const d of podesty) if (Math.abs(x - d.x) < d.pw - 0.5 * dx && Math.abs(y - d.y) < d.pd - 0.5 * dx) return -1;
```

(`dx` = `b.dx`; w funkcji trzeba go wyjąć z `b`.) Sprawdzone na kopii: `capEtyk` 103, zero węzłów bez kotwicy, 123 578 węzłów (N-P −81, F-P −208, w tym 79 kotwic). Zmienia węzły gry, więc test liczby węzłów w `tests/wokseleBaza.test.mjs` do aktualizacji. Spodziewany skutek: tabele „po poprawce” z punktu 1.3, także dla reaktorów, pomostów i sektorów dysku ciętych przed HP 0.

**4.2 [strażnik] Limit z odwiedzonych węzłów.** `src/3d/woksele/budowa.js:340–342`: `rozlejEtykiete` niech pomija etykiety ≥ 60000 przy liczeniu `mx` i zwraca też liczbę takich węzłów (`info.grupy.wieza.sieroty`); sierotom wpisać etykietę = limit. Bez sierot wypiek bajt w bajt jak dotąd. Do tego test: `sieroty === 0` i `capEtyk < 400` dla `scenaB1({ wGrze: true })` i B1R. Uwaga: wzorzec CPU trzyma etykiety w `Uint16Array`, więc limit ponad 65535 jest tam nieosiągalny z definicji.

**4.3 Przewracanie: cięcie płaszczyzną z obrotem zamiast kul przekroju.** `grupyGry.js` + `wGrze.js` (`voxBreak` kawałka `highrise`, tryb 0 i 2): zamiast dwóch kraterów „wieza” wstawić do kolejki `stan.puscCzesci` rekord `{ od, n, zMin, piv, om }` dla części o id wieżowca (`solver.puscCzesc` już to przyjmuje, tak pada wieża):

- `zMin` = dwie warstwy nad podstawą budynku (`k7HeightToZ(h.baseY)` + 80), nie nad pokładem pomostu;
- `piv` = krawędź rzutu po stronie upadku na wysokości `zMin`, `om` = 0,3 rad/s (`[-fy · 0,3, fx · 0,3, 0]`);
- kierunek (fx, fy): trzeci argument zdarzenia (`pirateBaseVoxEvent('voxBreak', id, tryb, kąt)`, liczba, przechodzi przez `plainData`): przy ostrzale od punktu trafienia `opts.at` ku osi budynku (pada od strzelającego), przy taranie wzdłuż prędkości statku, bez danych na zewnątrz od osi habitatu.

Pomiar (limit 103, cięcie w 0,5 s):

| bieg | przechył dachu po 0,5 / 1,5 / 2,5 / 3,5 s | w bok [j.] | wiązania dachu | nad pasem gry |
|---|---|---|---|---|
| B-13 na zewnątrz, 0,3 rad/s | 7,8° / 23,7° / 49° / 49° | 180 / 560 / 1016 / 1469 | 100 / 89 / 58 / 48 % | 0 od 3,5 s; blok przelatuje nad krawędzią dysku (1566 z 2436 węzłów spada pod dysk) |
| B-01 na zewnątrz, 0,3 rad/s | 7,5° / 20° / 39° / 52° | 163 / 396 / 500 / 570 | 100 / 26 / 19 / 18 % | 30 węzłów po 3,5 s; kładzie się na sąsiada z pierścienia zewnętrznego (odstęp 120 j.) i rozbija o niego |
| B-01 na zewnątrz, 0,5 rad/s | 12,7° / 31° / 45° / 52° | 266 / 593 / 869 / 1138 | 88 / 26 / 21 / 20 % | 4 węzły po 3,5 s |
| B-01 ku wieży, 0,3 rad/s | 7,5° / 20° / 36° / 50° | 163 / 503 / 940 / 1399 | 100 / 98 / 94 / 93 % | 0 od 3,5 s |

Zalety poza przewracaniem: nie zależy od żywego nosiciela (dziś krater z martwym nosicielem przepada bez śladu, `solver.js:751`; w biegach przepadały 2–3 salwy na pęknięcie, przekroje ani razu, ale trafienie w rdzeń budynku zabija dokładnie węzeł-nosiciel dolnego przekroju), nie zostawia kikuta w pasie gry, nie daje żaru przekroju (objaw 5), a puszczona część dostaje etykietę = limit wprost. Salwy mogą zostać jako ozdoba, ale krótkie (4.5).

**4.4 Wariant mniejszy zamiast 4.3: przepis od podstawy.** `grupyGry.budynek`: `zNad` jako parametr, dla wieżowca miasta `k7HeightToZ(h.baseY)`. Pomiar: budynek zapada się pionowo przez taras (B-01: 1127 z 1312 węzłów spada pod dysk, w pokładzie ginie 343 węzły; B-13: 2237 z 2436, pokład 1053), w pasie gry 0 węzłów 2 s (B-01) i 3 s (B-13) po przekroju, przechył 2–15°. Czysto, ale bez przewracania i z dziurą w tarasie.

**4.5 Czas.** `grupyGry.js:53`: przy ostrzale przekrój (albo cięcie z 4.3) po około 0,6–0,8 s zamiast 2,4 s. Kawałek w grze znika w chwili zdarzenia, każda sekunda zwłoki to „duch”, przez którego lecą pociski.

**4.6 Żar.** Jeśli kule przekroju zostają (4.4): cięcie nie powinno żarzyć. Najprościej żar tylko dla S = 2 (`solver.js:707`: `sI.equal(2)` zamiast `sI.greaterThan(1)`), ale to zmienia też S5 w demie (kratka żaru po granicach ziaren w pasie wybuchu była tam zamierzona), więc lepiej osobny znak dla „cięcia bez żaru” albo rezygnacja z kul (4.3).

### Obraz: do decyzji, nie teraz

- Otwór w pokładzie pod rzutem budynku (gruz wpada do pustej skrzyni tarasu): po 4.1 niepotrzebny dla pierścienia wewnętrznego (gruz leży pod pasem), a w zewnętrznym taras i tak pęka. Nie liczyłem.
- Lampy wnętrz przy małej szkodzie (`obraz.js:823`, `863`): ewentualne podniesienie progu po obejrzeniu kadrów.

### Logika gry: ocena, bez wdrażania

- **Kolizja z gruzem.** (a) Odczyt zajętości z wokseli do gry (siatka kubełków jak `kGinieLicz`): łamie zasadę 1, wynik zależałby od GPU, od tego, czy solver w ogóle liczy (poza kadrem stoi), i wymaga nowego kanału render → gra; odradzam. (b) Deterministyczna atrapa po stronie gry: po pęknięciu koło „gruzowiska” na N sekund, które łyka pociski z efektem trafienia i hamuje statek; koszt mały (lista kół, test w pętli pocisków, `voxHit` na gruz), ale po poprawkach obrazu w pasie gry nie zostaje nic, co by tę kolizję uzasadniało. Zalecenie: nie robić, wrócić do tematu po próbie użytkownika.
- **Widoczność ostrzału przed pęknięciem.** Krater na 1–2 węzły pod dachem jest niewidoczny z góry, a pula 2500 to kilka–kilkanaście trafień bez żadnej zmiany obrazu. Tani sygnał bez zmiany wyniku gry: przy 50 % puli zdarzenie obrazu „nadłamany” (same salwy na obwodzie, bez cięcia; uszkodzone węzły tracą okna). Decyzja użytkownika; wartość puli też.
- **Kierunek upadku** z punktu trafienia albo z prędkości taranu (4.3) to jedna liczba więcej w zdarzeniu, bez wpływu na rozgrywkę.
- Ciała belek wieżowca (ściany, rdzeń, słupy) i schodzenie odłamów nie wymagają zmian: po poprawkach obraz znika z pasa gry w 2–4 s od pęknięcia, czyli zgadza się z kolizjami.

## 5. Zastrzeżenia

- Wszystko policzone na wzorcu CPU w wycinku 520 j. z unieruchomionym brzegiem. Wartość `capEtyk` jest dokładna (ten sam kod wypieku co w grze). Czasy i wysokości spadania to rząd wielkości: bez skały, bez kernela gruzu i obrazu, a to, co wylatuje poza wycinek (dach przewróconego B-01 dalej niż 520 j.), spada w pustkę zamiast na sąsiadów i taras.
- Nie widziałem ani jednego kadru. Ranking objawu 5 opiera się na kodzie obrazu i licznikach, do potwierdzenia na GPU.
- Nie sprawdzałem reaktorów, pomostów i sektorów dysku po poprawce limitu (powinny wrócić do zachowania z 11-08, bo dawny limit był 112).
- Pierwsze sprawdzenie na GPU po wdrożeniu: `gpu-baza-gra.mjs` z ostrzałem jednego wieżowca i taranem; w Node wystarczy `zbudujPlan(scenaB1({ dx: 40, wGrze: true })).w.capEtyk`.

## 6. Pliki

Katalog: `C:\Users\Szymon\AppData\Local\Temp\claude\1b581a3602c16e73\713ec631-945e-4033-a021-c3276919f62b\scratchpad\`

- `miasto-gra.mjs`: symulacja wieżowca (opcje w nagłówku: `--cel`, `--tryb`, `--root stare|popr|c2ad`, `--cap`, `--hity`, `--zBaza`, `--pusc`, `--profil`).
- `etykiety.mjs`: węzły bez drogi do kotwicy i limit (`node etykiety.mjs [stare|c2ad|popr]`).
- `wzorzec-fable.mjs`: kopia wzorca CPU z licznikami (z poprzedniego zlecenia).
- `stare\`, `c2ad\`: pliki sceny z commitów `111e708e` i `c2ad2b05`; `popr\`: kopia z main z poprawką 4.1 (`popr\src\3d\woksele\scenaBazy.js`).
- Wyniki: `E-main.txt`, `E-stare.txt`, `E-c2ad.txt`, `E-popr.txt`; `M1-B01-t0-main.txt`, `M2-B01-t0-cap103.txt`, `M3-B01-t2-main.txt`, `M4-B01-t2-cap103.txt`, `M5-B01-hity-main.txt`, `M6-B13-t0-main.txt`, `M7-B01-zar-main.txt`, `M8-B13-zar-main.txt`, `P1-B01-t0-popr.txt`, `P2-B01-hity-popr.txt`, `P3-B13-t0-popr.txt`, `S1-W1-t0-stare.txt`, `V1a-B01-zBaza.txt`, `V1b-B13-zBaza.txt`, `V2a-B01-pusc-om03.txt`, `V2b-B01-pusc-om05.txt`, `V2c-B13-pusc-om03.txt`, `V2d-B01-pusc-dosrodka.txt`.
