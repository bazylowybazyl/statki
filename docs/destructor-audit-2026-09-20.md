# Audyt taranowania — 2026-09-20

Przypadek: Atlas przy zwykłej prędkości / boost, tarcze wyłączone, głębokie wejście w Pirate Battleship lub Terra Nova. Audyt obejmuje wykrywanie kontaktów heksów, odpowiedź kadłuba, deformację CPU/GPU i dodatkową separację AI.

## Potwierdzone przyczyny i poprawki

1. **Normalna kontaktu zmieniała znak wewnątrz kadłuba.** Po minięciu środka sąsiedniego heksa albo środka całego celu znikała obliczona prędkość zbliżania. Obrażenia spadały do zera, mimo dalszego ruchu przez metal. Przy głębokim taranie z przewagą masy normalna płynnie przechodzi teraz w kierunek przeciwny do ruchu względnego. Powierzchniowy kontakt zachowuje dotychczasową normalną.
2. **AI dokładało niezależne odpychanie.** `applySeparationForces` nadal odpychało NPC i uruchamiało unik sojusznika podczas fizycznego kontaktu. Para z kontaktem kadłubów pomija teraz te siły; pierwsze dotknięcie unieważnia też bufor decyzji AI. Nawigacja wraca po wygaśnięciu kontaktu (0,1 s czasu symulacji).
3. **Ograniczona próbka stale zaczynała od tych samych heksów.** Limit kontaktów zostaje, ale początek przeglądania siatki przesuwa się po zapełnieniu bufora. Przy głębokim wejściu kadłubów o różnej masie próbka obejmuje też wnętrze, ponieważ sam topologiczny brzeg może już być odgięty poza styk.
4. **Odkształcone heksy wypadały ze statycznego wyszukiwania.** Oryginalne indeksy kolumny/wiersza nie opisują aktualnego położenia po dużym zgniocie. Dla dryfu ponad dwie szerokości komórki działa lokalny indeks aktualnych pozycji. Bufory typowane są używane ponownie, a przebudowa następuje po zmianie siatki. Mało odkształcone kadłuby zachowują statyczną ścieżkę.
5. **Korekta wypychała statki przez już zniszczony materiał.** Po zgniocie korekta uwzględnia tylko żywe, nadal nakładające się kontakty. Jej tempo jest skalowane czasem. Podatność raz zgniecionej warstwy utrzymuje się podczas ciągłego kontaktu, więc zwolnienie wewnątrz celu nie przywraca nagle pełnej sztywności.
6. **Granice kolizji nie obejmowały całej deformacji.** Uwzględniony jest trwały dryf oraz większa z deformacji bieżącej i docelowej. Wyniki solvera GPU podbijają granicę natychmiast. OBB odświeża się po zmianie siatki także w tym samym kroku, a po przesunięciu ciała jego cache jest unieważniany. Broadphase również uwzględnia dryf.

Zachowano wcześniejszą poprawkę płynnego ustępowania lżejszego kadłuba, lokalnych obrażeń od przebytej drogi i błędnej interpretacji `searchRDriftMargin: null` jako zera. Pierścienie i kruche obiekty nie korzystają z podatności taranowanego metalowego kadłuba.

## Weryfikacja

- Odtworzenie przed audytem: dla prostokątnych siatek 640×180 i 320×100, mas 800000/50000 oraz prędkości względnej 600, część głębokich położeń dawała **0 obrażeń i 6–8 jednostek wypchnięcia w jednym kroku 1/120 s**.
- Po poprawce: test przechodzi przez położenia od −20 do 20 co 2 jednostki oraz obrót 0°/90°. W każdym położeniu obrażenia przekraczają 300, a korekta pozycji celu pozostaje poniżej 0,1 jednostki.
- **11 nowych testów** w `tests/destructorDeepContact.test.mjs`: kierunek taranu, zwolnienie, rotacja próbkowania, kontakt wnętrza, przemieszczone heksy, martwe kontakty, cache granic, bufory indeksu, trwała deformacja, publikowanie wyników GPU i separacja AI. Osiem izolowanych regresji sprawdzonych również na kodzie sprzed audytu: wszystkie osiem tam zawodziło.
- Zestaw destrukcji, rammingu, OBB, splitów, areny heksów, solvera, GPU, kroków fizyki, workerów, asteroid i pocisków: **83/84 zaliczone**. Jedyny błąd: istniejący wcześniej `billboard-oriented asteroid impacts map to the visible local side` w `tests/asteroidHexAdapter.test.mjs`, potwierdzony również na HEAD przed zmianami.
- `npm run build`: zaliczony; pozostaje ostrzeżenie Vite o rozmiarze bundla.

Nowe regresje można uruchomić przez:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/destructorDeepContact.test.mjs tests/destructorRamming.test.mjs
```

## Koszt wykrywania kontaktów

`scripts/benchmarkRamming.mjs`: 8988 heksów w parze, 300 wywołań rozgrzewki, mediana pięciu serii po 1000 wywołań. Każda próba resetuje pozycje i prędkości; obrażenia są wyłączone. W przypadku odkształconym rewizja siatki zmienia się przy każdym wywołaniu, więc koszt zawiera przebudowę indeksu. Baseline zawiera już pierwszą poprawkę taranowania, ale nie niniejszy audyt.

| Przypadek | Przed audytem, ms/parę | Po audycie, ms/parę | Kontakty przed → po |
|---|---:|---:|---:|
| Styk powierzchni | 0,0116 | 0,0106 | 23 → 23 |
| Głębokie wejście | 0,0019 | 0,0041 | 24 → 24 |
| Duża deformacja | 0,3596 | 0,1432 | 0 → 24 |
| Brak styku | 0,0073 | 0,0051 | 0 → 0 |

To syntetyczny pomiar Node, podatny na JIT i szum przy tak krótkich wywołaniach. Nie stanowi pomiaru FPS gry. Więcej pracy w głębokim kontakcie kosztuje w tym przebiegu około 0,0022 ms/parę; duża deformacja odzyskuje kontakty przy mniejszym koszcie wyszukiwania. Indeks nie tworzy obiektów na zapytanie; tablice alokuje dopiero dla mocno odkształconego kadłuba i zwiększa tylko w razie potrzeby.

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/benchmarkRamming.mjs
```

Pozostaje ocena płynności w rzeczywistej scenie Atlas–Pirate Battleship/Terra Nova i pomiar PerfHUD. Test GPU sprawdza zastosowanie wyniku solvera, nie uruchamia obliczeń na fizycznym GPU. Prostokątne siatki regresji nie zastępują masek sprite'ów tych konkretnych statków.
