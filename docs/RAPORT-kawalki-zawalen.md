# Kawałki i zbrojenie w obrazie zawaleń: demo A/B (2026-11-08)

Próba nowego OBRAZU zawaleń na wiązanych wokselach. Fizyka zostaje wokselowa: solver liczy te same węzły i wiązania, a zmienia się tylko to, co widać. Zamiast bloku na woksel rysują się nieregularne kawałki betonu, które jadą za swoimi węzłami, a w trzecim trybie także druty zbrojenia. Gra niczego nie dostaje: wpięcie w misję 1 to osobna decyzja.

## Jak obejrzeć

- `dema/woksele-zawalenia.html?kawalki=1` (dev server Vite). W panelu trzy przyciski: **Woksele** (dzisiejszy obraz), **Kawałki**, **Kawałki + zbrojenie**. Klawisz K przełącza je po kolei.
- Woksele i Kawałki to ta sama fizyka: przełączenie działa w biegu, także w pauzie (spacja), więc da się porównać jedną i tę samą chwilę. Kawałki + zbrojenie mają pręty w fizyce, więc przełączenie do nich i z nich zaczyna scenę od nowa (kamera zostaje).
- Sceny do porównania: **S1 podcięcie** (wieżowiec) i **S5 pochylona wieża** (wieża spada na dysk).
- Bez `?kawalki=1` strona jest taka jak dotąd (solver i obraz bez nowych gałęzi).
- Kadry, koszt i arkusze bez okna: `node scripts/webgpu/woksele-kawalki.mjs` (opis w `.claude/rules/woksele-zawalen.md`, „Jak sprawdzić”).

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
4. **Czy wpiąć w misję 1.** Z góry różnica jest mała, z bliska duża. Wpięcie to osobna praca: skóra z wypieku i wnętrza na kawałkach, przekrój wysokości, koła habitatu, LOD.

## Pliki

- `src/3d/woksele/kawalki.js`: prefraktura przy wypieku (poziomy, siatka narożników, geometria) i wybór prętów. Moduł czysty, bez three.
- `src/3d/woksele/kawalkiObraz.js`: kernele dopasowania sztywnego i wyboru poziomu, materiały kawałków i drutów w TSL.
- `src/3d/woksele/obraz.js`: opcja `kawalki` i tryb obrazu (sama widoczność siatek).
- `src/3d/woksele/solver.js`: flaga `ciagliwe` (klasy wiązań 12–17), `dema/woksele-zawalenia/wzorzec-cpu.js`: to samo na CPU.
- `src/3d/woksele/budowa.worker.js`: pole `kawalki` wiadomości.
- `dema/woksele-zawalenia/pokaz.js`, `glowny.js`: `?kawalki=1`, panel, klawisz K, API harnessu (`pokaz.tryb`, `pokaz.statKawalki`).
- `scripts/webgpu/woksele-kawalki.mjs`: kadry, koszt, arkusze. `tests/wokseleKawalki.test.mjs`: testy w Node.
