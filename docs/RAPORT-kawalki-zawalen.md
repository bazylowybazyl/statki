# Kawałki i zbrojenie w obrazie zawaleń: demo A/B (2026-11-08)

Próba nowego OBRAZU zawaleń na wiązanych wokselach. Fizyka zostaje wokselowa: solver liczy te same węzły i wiązania, a zmienia się tylko to, co widać. Zamiast bloku na woksel rysują się nieregularne kawałki betonu, które jadą za swoimi węzłami, a w trzecim trybie także druty zbrojenia. Gra niczego nie dostaje: wpięcie w misję 1 to osobna decyzja.

## Jak obejrzeć

- `dema/woksele-zawalenia.html?kawalki=1` (dev server Vite). W panelu trzy przyciski: **Woksele** (dzisiejszy obraz), **Kawałki**, **Kawałki + zbrojenie**. Klawisz K przełącza je po kolei.
- Woksele i Kawałki to ta sama fizyka: przełączenie działa w biegu, także w pauzie (spacja), więc da się porównać jedną i tę samą chwilę. Kawałki + zbrojenie mają pręty w fizyce, więc przełączenie do nich i z nich zaczyna scenę od nowa (kamera zostaje).
- Sceny do porównania: **S1 podcięcie** (wieżowiec) i **S5 pochylona wieża** (wieża spada na dysk).
- Bez `?kawalki=1` strona jest taka jak dotąd (solver i obraz bez nowych gałęzi).
- Kadry, koszt i arkusze bez okna: `node scripts/webgpu/woksele-kawalki.mjs` (opis w `.claude/rules/woksele-zawalen.md`, „Jak sprawdzić”).

## Baza piratów z misji 1 (dopisane po pierwszym przeglądzie)

Użytkownik: „ciężko mi decydować, jak nie widzę gry”. Dlatego druga strona: `dema/baza-piratow-kawalki.html`, baza z misji 1 (85 tys. węzłów, dx = 40, ta sama budowa co w grze) bez skryptu zniszczeń, w barwach piratów, z kamery z góry jak w grze. Niszczy się ją narzędziami (klik w kadr bez przeciągania, klawisze 1–5):

- **Krater**: w miejscu kliknięcia, w pierwszy element na linii wzroku.
- **Działo** i **Ciężkie działo**: jak trafienie gracza w misji 1. Pocisk leci w płaszczyźnie gry od dołu kadru, krater w pierwszym elemencie pod nią, promień jak w grze (zwykłe około 80 j., ciężkie 200 j.). F trzymane: seria w kursor.
- **Taran (statek)**: statek wpada od dołu kadru, nurkuje przez kliknięty punkt i ryje kanał przez bazę.
- **U albo przycisk „Upadek (HP 0)”**: jak przy zniszczeniu bazy w grze. Szyja i sektory dysku pęknięte, po 3 s kotwice puszczają falą od osi habitatu i cała baza spada (w demie na podłogę 3,4 km niżej, w grze na planetoidę).

Różnice wobec gry: w grze baza ma skórę z wypieku starego modelu (lampy, okna, napisy) i wnętrza pomieszczeń, tu jest sama barwa piratów. Pod bazą jest płaska podłoga zamiast planetoidy. Tryb Woksele na tej stronie nie zaokrągla kół habitatu (w grze robi to shader gry), kawałki je zaokrąglają.

Sprawdzone bez okna (`node scripts/webgpu/woksele-baza-narzedzia.mjs`): działo, ciężkie działo, taran, upadek, w trybach Woksele i Kawałki, 0 pipeline'ów synchronicznych, bez błędów konsoli.

### Gumowa szyja i kruchość betonu (drugi przegląd)

Zgłoszenie: szyja habitatu wygięła się w łuk bez pękania. Przyczyny:
- Zginanie w solverze jest plastyczne bez osłabienia. Przy dx = 40 jedno złącze trzech wokseli gnie się sprężyście o około 30° i pęka dopiero przy około 70°, a we wnętrzu ziarna (wiązania ×6 mocniejsze) granica jest jeszcze 3 razy dalej. Długi element wygina się więc w łuk, bo każde złącze bierze tylko trochę.
- Rdzeń szyi i szybu w scenie bazy ma ×8 siły i ×8 granicy gięcia (pod zaplanowany upadek w grze: głowa ma się przewrócić, a nie skruszyć). Tej szyi nie da się złamać zginaniem.

Porównanie na scenariuszu „szyja” (dwa kratery z boku u podstawy szyi, `node scripts/webgpu/woksele-baza-narzedzia.mjs --scenariusz szyja`, arkusz `.tmp/woksele-demo/KAW/arkusz_szyja.png`):

| Wariant | Szyja |
|---|---|
| jak w grze (`giecieSzyi` 8) | zwija się w rurę |
| `giecieSzyi` 1 (demo bazy, domyślnie) | prawie to samo: zwija się dalej, bo zwykły beton też gnie się bez granic |
| beton kruchy (`?kruchosc=1`) | pęka po około 2 s, zostają wygięte odcinki |
| beton bardzo kruchy (`?kruchosc=2`) | łamie się u podstawy, głowa spada i się rozbija |

Ten sam przełącznik na wieżowcu S1 (`arkusz_s1_kruchosc_*.png`): wieża miażdży się we wszystkich wariantach. Przy „bardzo kruchym” hałda to prawie sam drobny żwir (94 % węzłów w bryłkach, dziś 70 %), czyli wraca „kupa jednakowych kształtów”. „Kruchy” jest pośrodku.

W demie przełącznik „Beton: dziś / Kruchy / Bardzo kruchy” przeładowuje stronę (wypiek od nowa). Gra zostaje bez zmian, dopóki nie wybierzesz.

### Przyczyna: za miękki beton (trzeci przegląd)

Użytkownik: „szyja nie może się aż tak wygiąć”, „ciągnie klocek za klockiem, cała struktura nie leci w dół ani się nie przechyla”, „gdzieś jest bug”. Pomiar wiązań szyi z GPU (`--scenariusz szyja --analiza 1`): twardy limit rozrywania działa (żadne żywe wiązanie ponad 50 %), ale żywe wiązania mają 30–47 % rozciągnięcia, a ich długość spoczynkowa urosła do 1,22 długości z budowy.

Przyczyna jest w materiale. Odkształcenie statyczne pod własnym ciężarem (z wypieku): szyja bazy do 23 %, wieżowce bazy i wieża S1 do 14 %, prawdziwy beton około 0,05 %. Na starcie tego nie widać, bo sprężenie trzyma kształt z budowy. Gdy szyja się przechyli, sprężenie zamienia się w dłuższą długość spoczynkową i zewnętrzna strona ma ponad 20 % luzu bez siły. Wzmocnienie szyi ×8 było obejściem właśnie tego (bez niego miękka szyja kruszyła się pod głową), a zrobiło z niej gumę. Użytkownik potwierdził: „to była sztywność”.

Poprawka w demie: sztywność betonu `?sztywnosc=2|3` (sztywność ×4 albo ×9 przy tej samej wytrzymałości, solver robi 2 albo 3 razy więcej podkroków):

| | Szyja po nacięciu (bez wzmocnienia ×8) | Wieżowiec S1 | Baza bez strzałów | Krok bazy (GPU) |
|---|---|---|---|---|
| ×1 (dziś, szyja ×8) | zwija się w rurę | miażdży się | stoi | 0,69 ms |
| ×2 | pęka u podstawy, głowa wpada do bębna | miażdży się, zaczyna później | stoi, 0 zerwanych wiązań | 1,0 ms |
| ×3 | pęka, prosta szyja z głową przechyla się w całości | miażdży się, górny blok zgniata piętra | stoi | 1,4 ms |

Arkusze: `.tmp/woksele-demo/KAW/arkusz_szyja_sztywna_bez_wzmocnienia.png`, `arkusz_s1_sztywnosc_ukos.png`. Strona bazy ma teraz domyślnie ×2 i szyję bez wzmocnienia. Gra zostaje przy ×1 i szyi ×8, dopóki nie zdecydujesz. Druga opinia: osobna sesja „Silnik fizyki 3D Opus 5.5” analizuje model materiału (sprężenie, wytrzymałość na rozciąganie, zginanie, kotwice).

### Druga opinia i poprawki (noc 2026-11-08/09)

Druga opinia (sesja „Silnik fizyki 3D Opus 5.5” na Fable 5.1, surowe wyniki w jej scratchpadzie: `ANALIZA-guma-wokseli.md`) potwierdziła przyczynę: beton za miękki wobec ciężaru (g · H), sprężenie jest w porządku. Co z niej wzięte do kodu (gałąź `claude/unruffled-goodall-c42310`, gra bez zmian):

1. **Prawdziwy uśpiony błąd:** wiązanie ze sprężeniem bez wypieku kończyło przez `Continue` i omijało twarde limity rozciągania (1,5 R0) i ściskania (0,45 R0). Takie wiązanie mogło się rozciągnąć ponad te limity, póki siła z F0 mieściła się w limicie wytrzymałości. Poprawka za flagą solvera `limityF0` (GPU i oba wzorce CPU, ta sama kolejność sprawdzeń). Test: bez flagi wiązanie z F0 przeciągnięte do 1,7 R0 przeżywa, z flagą pękają oba końce. W demie kawałków flaga jest domyślnie włączona (`?limityF0=0` wyłącza), gra jej nie ma (WGSL kF bez flagi bajt w bajt jak dotąd).
2. **Szyja bez wzmocnienia dalej była „wnętrzem ziarna”:** rdzeń szyi dostawał klasę + 6 także przy `mocSzyi` 1, więc nie pękał po granicach ziaren, a fala go nie łamała. Teraz klasa + 6 tylko przy wzmocnieniu (`wnetrzeSzyi`, domyślnie `mocSzyi > 1`). Gra ma `mocSzyi` 8, więc bez zmian.
3. **Demo bazy liczyło inaczej niż gra:** do gałęzi scalony `main` (fala względna z gry, puszczanie całych części, pole grawitacji). Baza B1R ustawia teraz to samo co `wGrze.zaladuj`: w bryle oderwanej od kotwic fala łamie od prędkości względnej, a stojąca konstrukcja wolniejsza niż próg fali jest tłumiona („stoi albo pęka”, `?jakWGrze=0` wyłącza). Narzędzie „Upadek” puszcza kotwice całymi częściami po kolei, jak gra (dawniej węzeł po węźle).
4. **Harness w nocy:** `--noc 1` (albo `HULLFALL_HARNESS_TAKT=1`) uruchamia Chrome w takcie monitora, bez flag zdejmujących limit klatek.

Czego nie wzięto (do decyzji, bez dowodu, że trzeba): sztywność 3 zamiast 2 (Fable poleca 3: odkształcenie statyczne 2,5 % zamiast 5,8 %), granica wytrzymałości w odkształceniu (Ft najwyżej K · R0 · 5 %: obciążone pręty dziś ustępują dopiero przy 20–130 % odkształcenia przy sztywności 1, przy 2 cztery razy mniej), granica gięcia malejąca ze sztywnością (przy sztywności 3 opór gięcia rośnie × 9, a wytrzymałość osiowa nie; ryzyko sztywnego, odbijającego się gruzu, na kadrach nie widać), pręty w ścianach szyi (przewracanie „jak drzewo” wymaga ciągliwej strony rozciąganej). Inne metody (dopasowanie kształtu, XPBD, solver niejawny) Fable odradza.

Pomiary w nocy (`--noc 1`, 960 × 540, 60 kl/s, sztywność 2, krótkie przebiegi po kolei):

| | Wynik |
|---|---|
| Szyja po nacięciu (`--scenariusz szyja --analiza 1`) | Żywe wiązania szyi najwyżej 6–7 % rozciągnięcia (przed poprawkami 12–13 %), w 9 s zerwanych 8004 (przed 6293). Głowa zgniata podstawę szyi i spada w bęben, bęben pęka pod jej ciężarem (przed: głowa leżała na krawędzi bębna). Arkusze `arkusz_noc_szyja.png`, `arkusz_noc_szyja_t3.png`. |
| Baza bez strzałów (`--scenariusz stoi`) | 0 zerwanych z 1 037 806 wiązań przez 6 s, bez NaN. |
| Pełny scenariusz (działo, ciężkie działo, taran, upadek) | Trzy strzały z działa w środek habitatu niszczą podporę szyi i wieża z głową spada w bęben do 5 s. Tak samo we wszystkich wariantach: wszystkie poprawki, szyja jako wnętrze ziarna jak dawniej, bez `limityF0`, bez ustawień z gry. To skutek wieczornego ustawienia B1R (sztywność 2, szyja bez wzmocnienia), nie poprawek z nocy. Bez ustawień z gry wieżowiec W-1 sypie się bardziej (pękło 1292 kawałków wobec 1079 w 9 s). Arkusze `arkusz_noc_ab_ukos.png`, `arkusz_noc_pelny_ukos.png`. |
| Wieżowiec S1 z `limityF0` (sztywność 1) | Miażdży się tak samo jak bez poprawki (w 8 s pękło 582 wobec 596 kawałków poziomu 0). Arkusz `arkusz_noc_s1.png`. |
| Pipeline'y synchroniczne, błędy konsoli | 0 we wszystkich przebiegach (także po upadku całymi częściami). |
| Koszt kroku bazy | 1,02 ms GPU (8 podkroków), bez zmian. |

Arkusze leżą w worktree w `.tmp/woksele-demo/KAW/`.

### Baza bez bębna i klin w szyi (2026-11-09)

Prośba użytkownika: bez bębna (dysku z wyłomem), szyja trochę grubsza, beton kruchy przy sztywności ×2 albo ×3. Demo B1R ma teraz bez bębna szyję r 200 (było 150), domyślnie beton kruchy i sztywność 2. Baza bez strzałów stoi (0 zerwanych z 955 670 wiązań przez 6 s).

Uwaga użytkownika: „wieżowce, jak je podetnę klinem, potrafią spaść w bok, wieża nie, zawsze w dół. Może to kształt i podpory? Wieża w środku jest pusta, a wieżowiec nie.” Pomiar: klin dziesięcioma kraterami od +y u podstawy szyi (`--scenariusz klin`), przesunięcie środka głowy:

| Wariant (beton kruchy) | W bok | W dół | Co widać |
|---|---|---|---|
| sztywność 2, szyja pusta (dziś) | 30 j. w 5 s | 2108 j. | szyja miażdży się od dołu, głowa siada |
| sztywność 2, szyja ze stropami | 37 j. | 2034 j. | to samo |
| sztywność 2, szyja pełna | 43 j. | 1516 j. | to samo, trochę wolniej |
| sztywność 3, szyja pusta | 61 j. | 1935 j. | to samo |
| sztywność 2, `mocSzyi` 2 | 21 j. w 10 s, potem siada | 1888 j. w 15 s | stoi 10 s, potem siada |
| sztywność 2, `mocSzyi` 3 | 26 j. w 10 s | 38 j. | stoi, ledwo się przechyla |
| sztywność 2, `mocSzyi` 3, bez tłumienia | 508 j. w 10 s | 3114 j. | prosta szyja kładzie się ku klinowi, głowa sypie się po drodze |

Wniosek: pustka w szyi nie jest przyczyną. Głowa waży cztery razy tyle co szyja (6688 węzłów wobec 1618), a wytrzymałość wiązania to wielokrotność siły, którą niesie w spoczynku. Po klinie reszta przekroju jest przeciążona i miażdży się od dołu, a przechył od grawitacji rusza powoli (wieża 1,4 km). Mocniejsza szyja wytrzymuje, ale wtedy tłumienie „stoi albo pęka” z gry gasi powolny początek przechyłu. Wieżowiec jest prawie lity (stropy grube na dwie komórki co trzy warstwy) i nie ma ciężkiej głowy, więc klin go przechyla. Arkusze: `.tmp/woksele-demo/KAW/arkusz_klin.png`, `arkusz_klin_m3_ukos.png`.

Decyzja użytkownika (2026-11-09): demo B1R ma domyślnie szyję ×3 (`mocSzyi`) i bez tłumienia. Na tych ustawieniach baza bez strzałów stoi (0 zerwanych wiązań przez 6 s), a wieża podcięta klinem kładzie się ku klinowi (głowa 612 j. w bok w 10 s). Powrót: `?baza={"mocSzyi":1}&tlumienie=1`.

## Jak to działa (krótko)

- **Kawałki z fizyki.** Wiązania wewnątrz ziarna fizyki są sześć razy mocniejsze i się nie kruszą, więc budynek pęka głównie po granicach ziaren. Kawałek najwyższego poziomu to spójna grupa węzłów jednego ziarna: płyta stropu, odcinek słupa, płat ściany. Pękają tam, gdzie pęka fizyka.
- **Trzy poziomy.** Kawałek (poziom 0) dzieli się na mniejsze części (poziom 1, różnej wielkości), a te na bryłki pojedynczych węzłów (poziom 2). Kawałek pęka na stałe, gdy zniknie jego węzeł, gdy pęknie ponad 20 % jego wiązań wewnętrznych albo gdy jego węzły odejdą od ruchu sztywnego (zgniot, zginanie). Wtedy rysują go części, a w końcu bryłki. Kawałek nie jest więc sztywny na zawsze: obraz schodzi niżej tam, gdzie fizyka naprawdę miażdży.
- **Ruch.** Co krok fizyki kernel liczy dla każdego kawałka środek i obrót z pozycji jego węzłów (dopasowanie sztywne). Bryłka jedzie z ramą swojego węzła, jak dzisiejszy blok.
- **Kształt.** Jedna siatka narożników na wszystkich poziomach. Ściany budynku zostają płaskie, a granica kawałków zamiast schodka z wokseli dostaje skośną, falistą płaszczyznę przełomu. Po oderwaniu kawałka narożniki na jego brzegu się odłupują. Bryłki mają poszarpane narożniki, mocniej przy większym uszkodzeniu. Poziomy stykają się bez szpar (test liczy objętość bryłek: równa liczbie węzłów).
- **Zbrojenie.** Część wiązań osiowych na granicach kawałków (pręty w stropach i dysku poziomo, w słupach i rdzeniu pionowo) staje się ciągliwa: rozciąga się 4 razy dalej niż beton i ma 3 razy większą siłę zerwania. Rysuje się jako drut, który wygina się razem z kawałkami, a po zerwaniu zostają kikuty sterczące z przełomu. W solverze to nowy rodzaj wiązania za flagą (`ciagliwe`); wypiek bez prętów liczy się bit w bit jak dziś (sprawdzone na wzorcu CPU i na WGSL kerneli).

## Kryteria wyglądu (ustalone przed budową) i ocena

Arkusze kadrów: `.tmp/woksele-demo/KAW/koniec/arkusz_<scena>_<kamera>.png` (kolumny: Woksele, Kawałki, Kawałki + zbrojenie; kamery: z ukosa, z góry jak w misji 1, z bliska, zbliżenie na druty).

1. **Wieżowiec dalej miażdży się pod własnym ciężarem, a nie przewraca się w całości jak wydmuszka: SPEŁNIONE.** W trybie Kawałki ruch jest ten sam co dziś, bo to ta sama fizyka (kadry z ukosa są identyczne co do sylwetki). Ze zbrojeniem wieża też miażdży się piętro po piętrze, tylko około pół sekundy później, a stropy dłużej trzymają się jako całe płyty. Na S5 zbrojenie zmienia koniec sceny: dysk rwie się wokół dziury inaczej niż dziś, a łuk sekcji wisi dłużej w jednym kawałku.
2. **Kawałki ostre i różnej wielkości, nie pudełka: SPEŁNIONE W WIĘKSZOŚCI.** Z bliska widać lite płyty stropów, odcinki słupów i drobny gruz, bez dzisiejszej kratki co woksel. Przełomy są skośne i nierówne. Wyjątek: cienkie elementy (słupki fasady, słupy) mają przekrój 1–2 wokseli, więc dalej wyglądają jak prostokątne belki. Nierówne są tylko ich końce.
3. **Druty widać przy zbliżeniu: SPEŁNIONE CZĘŚCIOWO.** Przy zbliżeniu widać rdzawe pręty sterczące z przełomów. Długich drutów, na których wiszą kawałki, jest mało: przy obecnej sile pręt zrywa się, zanim kawałek zawiśnie. Przy sile ×10 kawałki trzymają się, ale cała wieża zmienia ruch (stropy schodzą jak naleśniki). To decyzja niżej.
4. **Gruz na ziemi nie zamienia się w kupę jednakowych kształtów: SPEŁNIONE.** Hałda to duże płyty i belki plus drobny, nieregularny gruz. Dziś to stos kostek z tą samą kratką.

Uwaga, którą trzeba znać przed decyzją: **z kamery z góry w skali misji 1 różnica jest mała.** Widać rysy między kawałkami na dachu i na pokładzie dysku i trochę mniej kratki, ale sylwetka zawalenia, pył i hałda wyglądają z góry prawie tak samo. Duża różnica jest od średniej odległości w dół (zbliżenie gracza, kamery reżysera). Ładny efekt uboczny: zanim kawałki się rozjadą, ich granice widać jako sieć cienkich rys (pokład S5 po uderzeniu wieży).

## Koszt GPU

RTX 5080, okno 1280 × 720, ta sama chwila zawalenia (S1: t = 5 s, S5: t = 4 s), kamera z ukosa, mediany ze znaczników czasu GPU. „Dziś” to strona bez `?kawalki`.

| Scena, chwila | Obraz | Krok fizyki + kernele obrazu [ms] | w tym kernele obrazu [ms] | Rysunek z cieniem [ms] | Razem [ms] |
|---|---|---|---|---|---|
| S1, t = 5 s | dziś (strona bez `?kawalki`) | 0,46 | 0,01 | 1,16 | 1,62 |
| | Woksele (strona z kawałkami) | 0,48 | 0,05 | 1,25 | 1,73 |
| | Kawałki | 0,48 | 0,04 | 0,30 | 0,78 |
| | Kawałki + zbrojenie | 0,48 | 0,05 | 0,36 | 0,84 |
| S5, t = 4 s | dziś (strona bez `?kawalki`) | 0,41 | 0,01 | 1,60 | 2,01 |
| | Woksele (strona z kawałkami) | 0,55 | 0,15 | 1,77 | 2,32 |
| | Kawałki | 0,56 | 0,15 | 0,29 | 0,85 |
| | Kawałki + zbrojenie | 0,51 | 0,14 | 0,49 | 1,00 |

- Kernele kawałków (dopasowanie sztywne i wybór poziomu) kosztują +0,03 ms na S1 i +0,14 ms na S5. Najdłuższy wątek liczy największy kawałek, dlatego wielkie składowe (sekcja dysku S5 miała 870 węzłów) dzielą się już przy wypieku do najwyżej 160 węzłów; przed tym podziałem S5 kosztował +0,58 ms.
- Rysunek jest 4–5 razy tańszy niż dzisiejsze bloki, także z passem cienia i głębi: jedna siatka 340–540 tys. trójkątów, a dziś w środku zawalenia każdy węzeł ma 7 instancji po 24 wierzchołki (blok, 5 odłamków, pręt) w każdym passie.
- Zastrzeżenia: pomiar w środku zawalenia, gdy dzisiejszy obraz rysuje już wszystkie sloty. Przed pierwszym zdarzeniem dziś rysuje się sam blok, więc tam różnica jest mniejsza. Wiersz ze zbrojeniem to inna fizyka, więc w tej samej chwili inny stan sceny. Mediany z 15 klatek (krok) i 11 klatek (rysunek), bez innych pomiarów GPU w tym czasie.

Pipeline'y synchroniczne po rozgrzewce: **0** (strona z kawałkami i strona dzisiejsza, wszystkie sceny i tryby, także po przełączeniach i resetach).

Pamięć: siatka kawałków S1 to 339 tys. trójkątów (9 MB), S5 540 tys. (15 MB), budowa w wątku 0,6–1,5 s na scenę.

## Co nie wyszło albo jest otwarte

- Słupki fasady i słupy zostają prostokątne (przekrój 1–2 wokseli, ich boki to ściany budynku).
- W miejscach mocnego zgniotu duża część węzłów schodzi do bryłek (S1 pod koniec około 70 % węzłów). Bryłka to poszarpany kamień, nie kostka, ale z bliska widać, że są podobnej wielkości.
- Druty: mało długich, rozciągniętych drutów przy obecnej sile prętów (punkt 3).
- Żadnej pracy nad wejściem do gry: skóra z wypieku, wnętrza, przekrój wysokości i koła habitatu z `wGrze` nie mają jeszcze odpowiednika w kawałkach.

## Decyzje dla użytkownika

1. **Czy ten obraz w ogóle idzie dalej** (obejrzeć demo z bliska i z góry).
2. **Gęstość kawałków.** Dziś: kawałek z ziarna fizyki (płyta 7 × 7 wokseli stropu, odcinek słupa 6 wokseli), części poziomu 1 po 4–14 węzłów. Większe kawałki = mniej szczegółu w zgniocie, mniejsze = bliżej dzisiejszych kostek.
3. **Ile zbrojenia:** (a) bez prętów w fizyce, druty tylko jako kikuty w obrazie, ruch jak dziś; (b) obecne pręty (40 % linii, ×4 rozciąganie, ×3 siła): ruch trochę inny, kikuty z przełomów; (c) mocne pręty (siła ×10): kawałki wiszą na drutach, stropy schodzą całymi płytami, ruch wyraźnie inny niż dziś. Dla (c) przebieg: `--zbrojenie '{"gestosc":0.5,"ciagl":6,"sila":10}'`.
4. **Kruchość betonu:** dziś, kruchy czy bardzo kruchy (szyja i hałda wyżej). Możliwe też osobne ustawienie: bardzo kruchy tylko dla smukłych elementów (szyja, słupy), reszta jak dziś.
5. **Czy wpiąć w misję 1.** Z góry różnica jest mała, z bliska duża. Wpięcie to osobna praca: skóra z wypieku i wnętrza na kawałkach, przekrój wysokości, koła habitatu, LOD.
6. **Szyja w demie bazy:** przy sztywności 2 bez wzmocnienia wieża spada po trzech strzałach w środek habitatu. Zostawić tak, przywrócić część wzmocnienia (np. `?baza={"mocSzyi":2}`) czy spróbować sztywności 3 (Fable).
7. **Co przenieść do gry** (dziś gra nie ma żadnej z tych zmian): sztywność betonu, poprawkę limitów w gałęzi sprężenia, szyję bez wzmocnienia ×8. W grze szyję i tak zrywa skrypt (`voxNeck`), więc gumową szyję widać w grze tylko wtedy, gdy zegnie się przed zerwaniem.

## Pliki

- `src/3d/woksele/kawalki.js`: prefraktura przy wypieku (poziomy, siatka narożników, geometria) i wybór prętów. Moduł czysty, bez three.
- `src/3d/woksele/kawalkiObraz.js`: kernele dopasowania sztywnego i wyboru poziomu, materiały kawałków i drutów w TSL.
- `src/3d/woksele/obraz.js`: opcja `kawalki` i tryb obrazu (sama widoczność siatek).
- `src/3d/woksele/solver.js`: flagi `ciagliwe` (klasy wiązań 12–17) i `limityF0` (twarde limity w gałęzi sprężenia), `dema/woksele-zawalenia/wzorzec-cpu.js` i `wzorzecF32.js`: to samo na CPU.
- `src/3d/woksele/scenaBazy.js`: `wnetrzeSzyi` (klasa wnętrza ziarna rdzenia szyi tylko przy wzmocnieniu). `dema/woksele-zawalenia/narzedzia.js`: upadek całymi częściami jak w grze.
- `src/3d/woksele/budowa.worker.js`: pole `kawalki` wiadomości.
- `dema/woksele-zawalenia/pokaz.js`, `glowny.js`: `?kawalki=1`, panel, klawisz K, API harnessu (`pokaz.tryb`, `pokaz.statKawalki`).
- `scripts/webgpu/woksele-kawalki.mjs`: kadry, koszt, arkusze. `tests/wokseleKawalki.test.mjs`: testy w Node.
