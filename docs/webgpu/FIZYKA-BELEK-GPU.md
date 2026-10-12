# Fizyka belek na GPU (compute WGSL) — demo i pomiary (2026-09-27)

Pytanie użytkownika: czy przeniesienie fizyki kadłubów (silnik belek, `destructorBeams3D.js`) na
compute shadery WebGPU da mocnego kopa. Odpowiedź sprawdzona na demie `destruktor2d` — ta sama
scena, ten sam model fizyki, pomiar CPU i GPU w tej samej przeglądarce.

**Uruchomienie:** `npm run dev` → `/dema/destruktor2d-webgpu.html` (Chrome/Edge z WebGPU, localhost).
Stare demo CPU zostaje bez zmian: `/destruktor2d.html` (link u góry obu dem).
**Pomiar:** `node scripts/bench-belki-gpu.mjs` (opcje w nagłówku skryptu; wynik w `.tmp/belki-gpu/bench.json`).

## Pliki

| Plik | Co |
|---|---|
| `dema/destruktor2d-webgpu.html` | strona dema (UI jak demo CPU + pokazy 1–4, telemetria GPU) |
| `dema/destruktor2d-webgpu/main.js` | klej: UI, sterowanie, kamera, pętla klatki, scenariusze, API pomiarów `window.__gpu2d` |
| `dema/destruktor2d-webgpu/gpuShaders.js` | wszystkie kernele WGSL fizyki + generator wiązań (nazwa bufora → deklaracja WGSL i układ bind groupy z jednej listy) |
| `dema/destruktor2d-webgpu/gpuWorld.js` | świat GPU: bufory, potoki, kodowanie kroków i podkroków, odczyty, rozpady (wyspy/mosty na CPU), profil kerneli |
| `dema/destruktor2d-webgpu/render.js` | render WebGPU wprost z buforów fizyki (skóra, belki, węzły, odłamki, pociski, tło) |
| `dema/destruktor2d-webgpu/build.js` | szybki budowniczy kadłuba (tablice typowane, czas liniowy) + kolorowanie belek |
| `dema/destruktor2d-webgpu/cpuReference.js` | te same sceny na silniku CPU (odniesienie pomiarów) |
| `scripts/bench-belki-gpu.mjs` | pomiar CPU vs GPU w headless Chrome na prawdziwym GPU (`--strona` — inna kopia dema do A/B) |
| `scripts/belki-gpu-zgodnosc.mjs` | zgodność fizyki: ta sama scena na GPU (warianty `--warianty`), CPU pełnym i lokalnym, próbki w czasie |
| `scripts/belki-gpu-profil.mjs` | czas karty na kernel (każdy dispatch we własnym przebiegu; `--siatki` — taran w podanych siatkach) |
| `scripts/belki-gpu-os.mjs` | oś czasu taranu: ms/krok, podkroki, obszar solvera lokalnego, kandydaci, zerwania co N kroków |
| `scripts/belki-gpu-ostrzal.mjs` | ostrzał bez styku (laser / rakiety) w wariantach strony — koszt i skutek |
| `tests/destruktor2dGpuBuild.test.mjs` | szybki budowniczy = `buildSpriteBeamStructure` belka w belkę; kolorowanie bez konfliktów |

## Model — ten sam co CPU (pełny solver)

Port 1:1 ścieżki `cfg.localSolver = false` (pełny solver) z trybem płaskim:
ciało sztywne (pozycja, prędkość, kąt) niesie ruch całości, węzły w układzie ciała odkształcają się
przez PBD na belkach; zgniot, granica plastyczności (`crushStrength`), zerwania, zmęczenie, mocowania
wręgów i grodzi, integralność po trafieniu, rozpady na wraki z przeniesieniem pędu, sen ciał,
sterowanie lotem, laser i rakiety z falą ciśnienia. Kolejność w podkroku jak `update()`:
integracja ciał → broń → PBD (predykcja, pomiar belek, rzutowanie, prędkości, przeniesienie
wspólnego ruchu na ciało) → 2 iteracje kontaktów (pierwsza ze zgniotem) → rozpady.

Co inaczej niż na CPU (świadomie):

| CPU | GPU | Skutek |
|---|---|---|
| Gauss-Seidel w kolejności belek | GS z **kolorowaniem krawędzi** (13–14 kolorów; belki jednego koloru nie dzielą węzłów) | ta sama zbieżność, inna kolejność → chaos po pierwszych zerwaniach |
| solver lokalny (tylko obszar w ruchu) | pełny poniżej 1 mln belek sceny, od 1 mln lokalny — ten sam model co CPU (§ „Solver lokalny na GPU”) | pełny: brak artefaktów solvera lokalnego (np. zamrożone sprężyste wgniecenie przy 7,5 j.), ale koszt nie spada w spoczynku |
| siatka węzłów per para ciał | **jedna siatka świata** dla wszystkich ciał + siatka statyczna budowana raz | ta sama definicja kontaktu (najbliższy węzeł drugiego ciała w promieniu), bez osobnej fazy szerokiej |
| sumy kontaktów w float, kolejność pętli | sumy w **stałym przecinku** (atomiki i32) | deterministycznie niezależnie od kolejności wątków |
| limit 384 kontaktów od kursora | ten sam: próg klucza cyklicznego szukany bisekcją w grupie roboczej | identyczny wybór kontaktów |
| odpowiedź par kolejno, zgniot po każdej parze | odpowiedzi kolejno (1 wątek, pary w kolejności kluczy), zgniot wszystkich par razem | węzeł w dwóch parach naraz dostaje maks. zgniot, nie sumę (rzadkie) |
| rozpady co 10 kroków, synchronicznie | GPU pakuje flagi zerwań → CPU liczy mosty i wyspy (te same algorytmy) → rozkazy wracają za 1–3 klatki; GPU przenosi węzły między ciałami (`reseat`) | opóźnienie rozpadu o 1–3 klatki; węzły nie są kopiowane (ciało = lista węzłów) |
| — | kadłub statyczny (ściana): tylko węzły, bez belek; nigdy nie „iteruje” kontaktu | bez różnicy przy ścianie większej od statku |

Pozycje ciał w buforach GPU jako **hi/lo** (hi = wielokrotność 16 j., lo ∈ [−8, 8]): f32 przy
100 tys. j. gubiłby powolny dryf wraków. Render liczy wszystko względem środka kamery, który
liczy kernel `camera` na GPU z ciała, za którym jedzie — kamera nie zostaje za statkiem mimo
opóźnionego odczytu stanu na CPU.

## Zgodność z CPU (taran Atlas–Atlas 800 j./s, burtą, siatka 15 j.)

`node scripts/belki-gpu-zgodnosc.mjs` (ta sama strona, te same obrazy):

| t | silnik | zerwania | v Atlasa | v kukły | żywe węzły A / K |
|---|---|---|---|---|---|
| 1 s | GPU | 505 | 685 | 85 | 3049 / 3093 |
| 1 s | CPU pełny | 510 | 693 | 81 | 3062 / 3081 |
| 1 s | CPU lokalny | 547 | 698 | 82 | 3053 / 3079 |
| 3 s | GPU | 1138–1244 | 358–363 | 362–366 | ~2935–2953 / ~3040 |
| 3 s | CPU pełny | 1165 | 364 | 366 | 2963 / 3032 |

Do pierwszego rozpadu GPU jest deterministyczne (dwa przebiegi — te same liczby); później rozjazd
wynika z momentu zastosowania rozpadu (odczyt asynchroniczny). Zmiana kolejności sumowania (redukcja
dwupoziomowa) przesunęła wynik po 1 s z 516 na 505 zerwań — to chaos zderzenia, nie błąd; CPU pełny
i lokalny różnią się między sobą bardziej (510 vs 547). Ściana przy 20 000 j./s: Atlas
rozbity do ~6 węzłów, jak na CPU („1–11 węzłów”). Flota z 6 taranami: 2062 zerwania GPU vs 1963 CPU.

## Wydajność

RTX 5080 (Blackwell), Chrome 153 headless, znaczniki czasu bez kwantyzacji
(`--enable-webgpu-developer-features`). Krok = 120 Hz; GPU = czas karty przebiegu fizyki (2 kroki na
polecenie jak gra 60 kl./s), CPU = czas ściany kroku silnika `DestructorBeams3D` w tej samej karcie
przeglądarki. „Styk” = okno 0,4–2,4 s (kadłuby się gniotą), „lot” = przed stykiem. Średnie ms/krok.

| Scena | węzły / belki | GPU | CPU lokalny | CPU pełny | GPU vs CPU lok. |
|---|---|---|---|---|---|
| taran Atlas–Atlas, 15 j. (styk) | 6,2 tys. / 25 tys. | **0,22** | 1,59 | 2,52 | 7× |
| taran, 7,5 j. (styk) | 24,6 tys. / 100 tys. | **0,31** | 14,7 | 25,0 | 48× |
| taran, 3,75 j. (styk) | 97 tys. / 397 tys. | **1,40** | 21,8 | 108 | 16× |
| taran, 1,9 j. (lot / styk) | 386 tys. / 1,58 mln | **6,4 / 10,7** | — | 382 (sam lot) | 60× (lot) vs pełny |
| flota 72 kadłuby, lot, 15 j. | 26 tys. / 101 tys. | 0,12 | **0,03** | 0,65 (po uśpieniu) | CPU 4× taniej |
| flota + 6 taranów, 15 j. (styk) | 35 tys. / 138 tys. | **0,20** | 2,41 | 3,91 | 12× |
| flota, lot, 7,5 j. | 100 tys. / 400 tys. | 0,15 | **0,04** | 2,7 | CPU 4× taniej |
| flota + 6 taranów, 7,5 j. (styk) | 136 tys. / 545 tys. | **0,59** | 22,8 | 31,2 | 39× |

Najgorsze kroki (p95 / maks.) mówią więcej o płynności niż średnie: taran 7,5 j. — CPU lokalny
p95 23 ms / maks. 32 ms, GPU p95 0,44 / maks. 0,65 ms; flota + tarany 7,5 j. — CPU p95 39 / maks.
43 ms, GPU p95 1,1 / maks. 1,5 ms. Koszt CPU przy fizyce na GPU to samo kodowanie poleceń:
0,02–0,05 ms na krok (0,16 ms przy 1,9 j. i 6 podkrokach).

Podkroki rosną przy gęstszej siatce (droga węzła na podkrok ≤ 0,53 komórki, jak 8 j. przy 15 j.):
przy 800 j./s — 1 podkrok (15 j.), 1,5 (7,5 j.), 2,7 (3,75 j.), 6,2 (1,9 j.). To one, nie liczba
węzłów, najbardziej podbijają koszt gęstych siatek (tak samo na CPU).

Profil kerneli (`world.profile`, każdy dispatch we własnym przebiegu — proporcje, nie suma):
taran 15 j. — Gauss-Seidel 42% (39 dispatchy × ~2,4 µs: 13 kolorów × 3 iteracje), wąska faza 16%,
agregat par 8%, redukcja 7%; taran 3,75 j. — GS 25%, redukcja na ciało 21% (przed rozbiciem na
grupy), odpowiedź par 21% (jeden wątek, dziesiątki par wraków), wąska faza 16%. Po optymalizacjach:
redukcja dwupoziomowa (grupy po 1024 węzły), flaga bliskości ciał (węzły kadłuba, którego kula nie
dotyka innego ciała, pomijają siatkę i wąską fazę: flota w locie 7,5 j. 0,24 → 0,15 ms).
**Nie pomogło**: GS małych kadłubów w jednej grupie roboczej (1 dispatch zamiast 39) — remis ±15%,
bo dwa kadłuby = dwa multiprocesory czekające na pamięć; zostaje jako opcja `?gs=40000`.

## Wnioski

1. **Zderzenia i niszczenie — mocny kop.** W taranie i przy flocie z taranami GPU liczy krok
   7–48× szybciej niż CPU z solverem lokalnym (12–80× niż pełny), a najgorsze kroki spadają z
   23–43 ms do ~1 ms. Właśnie te chwile dają dziś przycięcia w bitwie; na GPU CPU płaci tylko
   ~0,03 ms na zakodowanie kroku — główny wątek zostaje dla AI, gry i renderu.
2. **Spokojny lot — CPU wygrywa, ale oba są za darmo.** Solver lokalny usypia kadłuby i lot floty
   kosztuje 0,03–0,04 ms; GPU zawsze liczy wszystko (0,12–0,15 ms, głównie stały koszt ~60 dispatchy
   na podkrok). W liczbach bezwzględnych bez znaczenia.
3. **Gęstsze kadłuby stają się możliwe.** Siatka 7,5 j. (gęstość heksów gry) w czasie rzeczywistym
   za 0,3 ms/krok, 3,75 j. za ~1,4 ms/krok (~17% karty przy 120 Hz). 1,9 j. (386 tys. węzłów, 6
   podkroków) to już ~11 ms/krok — nie na 120 Hz. **Ale** model materiału zależy od siatki: przy
   3,75 j. ten sam taran 800 j./s rozbija kadłuby na dziesiątki wraków (limit 48), przy 15 j. na
   2–3. Zanim gęstsza siatka trafi do gry, materiał trzeba przestroić (progi zerwania / iteracje na
   rozmiar komórki) — to sprawa modelu, nie GPU (CPU zachowuje się tak samo).
4. **Efekty, których CPU nie uniesie**: pełny solver wszędzie (koniec artefaktów solvera lokalnego,
   np. zamrożonego sprężystego wgniecenia przy 7,5 j.), naprężenia wszystkich belek na żywo (widok
   „G”), skóra deformowana w shaderze wierzchołków bez przepisywania na CPU (w demie CPU 0,5–3,8
   ms/klatkę dla floty), żar brzegu rany, 84 kadłuby z 6 taranami naraz za 0,2 ms/krok.
5. **Co to znaczy dla gry — prawdziwy koszt jest w integracji, nie w shaderach.** Gra czyta stan
   kadłubów synchronicznie co klatkę (`HullBodies.step` → pozycje encji, `sweep`/`probe`/`impact`
   dla pocisków, styk dla AI, holowanie). Na GPU stan wraca po 1–3 klatkach. Uczciwe warianty:
   - **(a) GPU jest właścicielem kadłubów** (jak w demie): ruch, trafienia, zgniot, rozpady na GPU;
     gra czyta migawkę opóźnioną o klatkę (pozycje można ekstrapolować prędkością), trafienia
     pocisków liczone na GPU (demo to robi: grupa robocza na pocisk), skutki dla rozgrywki (zabicia,
     łup, HP) przychodzą jako zdarzenia. Największa przebudowa, największy zysk.
   - **(b) hybryda**: ciała sztywne i rozgrywka na CPU, GPU tylko odkształcenie, kontakty węzłów i
     zniszczenia; impulsy kontaktów wracają z opóźnieniem — odbicia spóźnione o 1–3 klatki.
   - **(c) zostać na CPU** z solverem lokalnym: tanio w locie, drogo w zderzeniach (dzisiejszy stan).
   Rekomendacja: jeśli bitwy z taranami mają zostać sercem gry albo siatka ma zgęstnieć — (a), po
   porcie renderu (to samo urządzenie: `renderer.backend.device`; bufory fizyki podpinane do
   materiałów TSL przez `StorageBufferAttribute` z podstawionym `GPUBuffer` — do sprawdzenia).
   Jeśli nie — (c) wystarcza, a GPU można wziąć później tylko na gęste wraki i ciężkie sceny.
6. **Pamięć**: ~175 B na węzeł i ~56 B na belkę + siatka kontaktów; 2 Atlasy przy 1,9 j. to
   ~180 MB buforów — bez znaczenia dla 16 GB karty, ale warto pamiętać przy flocie w gęstej siatce.

## Gęste siatki (1,9 / 1,5 / 1 j.) — dlaczego „muliło” i co poprawione (2026-10-11)

Zgłoszenie: demo przy ~1,5 j. muli, a RTX 5080 „powinien dać radę i 1 j.”. Pomiar
(`bench-belki-gpu.mjs --siatki 960,1200,1800 --bez-cpu` i profil kerneli) pokazał, że koszt nie był
w liczeniu sprężyn, tylko w pracy, która rośnie z gęstością szybciej niż liczba węzłów:

1. **Podkroki od prędkości bezwzględnej.** Liczba podkroków = maks. prędkość dowolnego ciała / (0,53
   komórki); węzły leżą w układzie ciała, więc sam lot ich nie wymaga. Teraz: prędkość względna par,
   które mogą się zetknąć w oknie odczytu (stan sprzed 1–3 klatek, zapas 0,25 s), z dawną regułą jako
   górną granicą (przy styku podkroków nie przybywa — zgodność z CPU została na niej zmierzona).
   `?podkroki=abs` — dawna reguła. Lot bez sąsiadów: 1 podkrok przy każdej siatce.
2. **Wąska faza na wszystkich węzłach.** Kula Atlasa dotyka kuli kukły od startu (odstęp 420 j.), więc
   `insert` + `narrow` liczyły 600 tys. węzłów 2 × na podkrok (~5 ms/krok przy 1,5 j., zanim kadłuby
   się dotkną). Teraz `nearFlags` liczy strefę styku (`bodyBox`: obrysy bliskich ciał w układzie ciała
   + 4 zasięgi styku + 1 j.), węzeł spoza niej nie idzie do siatki (znacznik w `worldPos`).
3. **GS przez rozrzucone odczyty.** `colorBeams[k]` → `beamLen[e]`, `beamEnds[e]` (sektor 32 B na
   8–16 B danych) w 3 × 13 dispatchach na podkrok. Teraz `prepare` pisze rekord `gsPack[k]` (końce,
   rest, waga — 16 B, w kolejności kolorów) i GS czyta tylko jego. `prepare` pisze belkę tylko przy
   zmianie (rest, waga, zmęczenie), strain (tylko widok) raz na krok (`STEP.STRAIN`).
4. **Pocisk przeglądał wszystkie węzły kadłuba**, gdy tylko wszedł w kulę ciała. Teraz najpierw odcinek
   lotu kontra obrys węzłów (+ promień węzła).
5. **Agregat par O(par × kontaktów × 21).** Każda para przeglądała wszystkie kontakty w bisekcji limitu
   384; przy rozpadzie na dziesiątki wraków to była połowa kroku. Teraz kontakty w koszykach par
   (`keyCount` w `narrow`, skan w `pairArgs`, `contactBin`) i wybór pozycyjny po 8 bitach (3 przejścia
   histogramu) — ten sam próg co bisekcja.
6. Kernele po belkach w grupach 256 (przy 1 j. 5,5 mln belek / 64 > 65 535 grup — 1 j. wcześniej nie
   ruszał). Pętla dema: budżet GPU na klatkę (`?gpuBudget=0` — wył.), żeby przy przeciążeniu
   symulacja zwalniała zamiast nadrabiać 6 kroków w jednej klatce (12 kl./s). Bez pomiaru na
   prawdziwym ekranie (headless nie ma vsync).

Zgodność: stan taranu (zerwania, prędkości, żywe węzły) identyczny ze starą wersją do pierwszego
rozpadu przy 15 / 3,75 / 1,9 j., ostrzał identyczny w całości; po rozpadach rozjazd w tym samym
zakresie, w jakim stara wersja rozjeżdża się sama ze sobą (odczyt asynchroniczny). Lekkie sceny bez
regresji.

| ms/krok (RTX 5080) | przed | po |
|---|---|---|
| taran 15 j. (styk) | 0,22 | 0,15 |
| taran 3,75 j. (styk) | 1,40 | 0,88 |
| taran 1,9 j. (styk) | 10,7 | 3,4 |
| taran 1,5 j. (cały przebieg 2,5 s / p95) | 15,0 / 24 | 5,4 / 10 |
| taran 1 j. (cały przebieg / p95) | nie ruszał | 23,5 / 32 |
| 1,5 j. ostrzał laserem (bez styku) | 6,4 | 2,8 |
| 1,5 j. / 1 j. lot solo | 2,3 / — | 0,3 / 0,6 |
| flota + tarany 7,5 j. (styk) | 0,59 | 0,43 |

**Dlaczego 1 j. w taranie dalej nie idzie w 60 kl./s** (stan sprzed solvera lokalnego — następna sekcja) (demo liczy 2 kroki 120 Hz na klatkę): przy
800 j./s styk wymaga 13 podkroków, a każdy podkrok przechodzi CAŁĄ kratownicę — 5,5 mln belek
(`prepare` + 3 iteracje GS) i 1,35 mln węzłów. `prepare` i GS działają już blisko przepustowości
pamięci (~0,4 ms + ~0,4 ms na podkrok); sam przejazd kratownicy to ~10 ms na krok, zanim dojdą
kontakty. Następny krok to nie optymalizacja kerneli, tylko algorytm: podkroki i rozwiązywanie tylko
w strefie styku / aktywnym obszarze (lokalny solver na GPU, reszta kadłuba 1 podkrok albo sen).
Przy 1 j. zostają też szeregowe: `response` (1 wątek po parach) i agregat dużej pary (1 grupa robocza).

## Solver lokalny na GPU — siatka 1 j. (2026-10-11, druga część)

Cel: taran Atlas–Atlas 800 j./s przy siatce 1 j. (res 1800: 1,35 mln węzłów, 5,5 mln belek) w czasie
rzeczywistym, ok. ≤ 7 ms GPU na krok 120 Hz (było 23,5 ms średnio, p95 32 ms). Każdy z 13 podkroków
przechodził całą kratownicę, a kernele były już blisko przepustowości pamięci — zysk musiał przyjść
z algorytmu: liczyć tylko to, co się rusza, i tylko tam szukać kontaktów.

### Wynik

RTX 5080, ms/krok (krok 120 Hz, 2 kroki na polecenie), `bench-belki-gpu.mjs --bez-cpu`. „Przed” = kopia dema
sprzed tej pracy zmierzona w tej samej sesji (dla 1 j. i 1,5 j. — liczby z sekcji wyżej), „pełny” = obecne
demo z `?solver=pelny` (dostało wspólne poprawki kontaktów i rozpadów), „lokalny” = solver lokalny.
Pomiary są teraz deterministyczne (niżej), rozrzut między przebiegami to zegar karty: ±5%.

| Scena | przed | pełny | lokalny | domyślnie |
|---|---|---|---|---|
| taran 1 j. — średnio / p95 / maks | 23,5 / 32 / — | ~16 | **7,6–8,2 / 12–13 / 13–14** | lokalny |
| taran 1 j. — lot / styk (0,4–2,4 s) | 10,3 / 27–37 | | 1,3–1,6 / 9,4–10 | |
| taran 1,5 j. (1200) — średnio / p95 | 5,4 / 10 | | **3,1 / 5,2–5,9** | lokalny |
| taran 1,9 j. (960) | 3,12 / p95 5,7 | 2,48 / 4,5 | **1,87 / 3,2** | lokalny |
| taran 3,75 j. (480) | 0,99 | **0,59** | 0,93 | pełny |
| taran 7,5 j. / 15 j. | 0,22 / 0,139 | 0,33 (2,2 podkroku) / **0,136** | 0,42 / 0,235 | pełny |
| flota 15 j. / 7,5 j. (lot) | 0,098 / 0,117 | 0,100 / 0,118 | 0,134 / 0,143 | pełny |
| flota + tarany 15 j. / 7,5 j. | 0,150 / 0,372 | 0,146 / 0,379 | 0,265 / 0,439 | pełny |
| ostrzał laserem 1,5 j. (bez styku) | 2,64 | 2,56 | 2,31 | lokalny |

Taran 7,5 j. w trybie pełnym: na podkrok tyle samo co przed (0,147 ms), średnia wyższa, bo inny (już
deterministyczny) przebieg chaotycznego zderzenia ma więcej podkroków. **Tryb wybiera się sam** (`main.js`,
`LOCAL_SOLVER_MIN_BEAMS`): solver lokalny od 1 mln belek sceny, poniżej pełny — przy małych kadłubach obszar
w ruchu obejmuje większość kratownicy, a narzut list i dispatchy przewyższa zysk (lekkie sceny bez regresji).
`?solver=lokalny` / `?solver=pelny` wymusza tryb; tryb widać w telemetrii (wiersz kolorów).

**Cel 7 ms nie jest w pełni osiągnięty**: średnio 7,6–8,2 ms (3× szybciej), p95 12–13 ms (2,5×). Faza
zgniotu przy 1 j. to 9–10 ms/krok: pęka ~15% wszystkich belek (830 tys.), powstaje limit 48 wraków, obszar
w ruchu ma średnio 75 tys. węzłów (maks. 130 tys.), kandydatów do kontaktów jest 160–280 tys., a jedna para
(Atlas–kukła) ma 30–60 tys. kontaktów na przebieg; wirujące wraki trzymają 9–13 podkroków na krok.

### Projekt

1. **Solver lokalny = port `_solveLocal` (CPU) na GPU.** Na podkrok: A — węzły aktywne (lista zbierana
   w poprzednim podkroku: wciąż w ruchu, zgniecione, końce zerwanych belek, trafione, sąsiedzi zniszczonych),
   F — ich sąsiedzi przez całe belki (też ruchomi), O — pierścień: końce belek F poza A ∪ F (stoją, waga 0).
   Więzy = belki z końcem w A ∪ F, w **kubełkach kolorów** (kubełek = zakres koloru z pełnego solvera,
   dopisywanie zbiorcze w grupie roboczej, bez atomików na belkach: belkę dopisuje jeden ustalony koniec).
   GS jak w pełnym solverze (kolory po kolei, dispatch pośredni na kolor), małe kolory długich belek razem
   w jednej grupie roboczej (`gsTail`), a cały mały obszar w jednej grupie (`gsAll`, wybór z odczytu rozmiaru
   z histerezą). Reszta kadłuba jest sztywna: pęd węzłów oddany w podkroku (reakcja pierścienia, tłumienie,
   węzły wyzerowane) — m·(v przed − v po), w stałym przecinku (deterministycznie) — idzie na ciało sztywne.
   Węzeł wypada z A po 8 podkrokach ciszy; belki do węzłów spoza obliczeń przyjmują wtedy obecną długość
   (zapiekanie jak `_bakeRest`). Obrys i promień ciała tylko rosną; dokładne wracają przy wyrównaniu środka
   masy (raz na krok, gdy dryf masy > 0,25·bok·M albo obszar ciała opustoszał — jak `_recentre`).
2. **Próg ruchu skalowany liczbą podkroków** (domyślnie; `?prog=staly` — bez): 0,2 · bok komórki · podkroki
   j./s, czyli ten sam ruch na podkrok co na CPU przy 1 podkroku. Stały próg 0,2 j./s przy 1 j. i 13 podkrokach
   to ~1,3·10⁻⁴ j. na podkrok — poziom szumu f32 pozycji (ulp przy 900 j. ~6·10⁻⁵): cała kratownica zostawała
   „w ruchu” i solver lokalny był wolniejszy od pełnego.
3. **Rozpady w trybie lokalnym**: `reseat` dopasowuje ruch sztywny wraku / rodzica do pola prędkości węzłów, więc
   węzły, które spoczywały, dostają −(v₀ + ω×r) samego dopasowania — bez obsługi cały rodzic (670 tys. węzłów)
   lądował w A. `topoActivate` zeruje prędkość węzłów spoza A, a ich pęd liniowy **i moment pędu** oddaje ciału
   (całkowity moment pędu zachowany).
4. **Kontakty bez przeglądu kratownicy** (tryb lokalny; `?kontakty=skan` — dawny przegląd, A/B): raz na krok
   lista kandydatów = węzły w strefie styku kroku (obrys AABB z zapasem na ruch w kroku) ∧ **zgrubna siatka
   zajętości świata**: każdy węzeł znaczy komórki (12 boków komórki) wzdłuż swojej drogi w 1,5 kroku (ruch
   ciała, obrót, własny), kandydat = węzeł, którego droga ±1 komórka mija drogę innego ciała. W przebiegu:
   czyszczenie tylko zajętych komórek siatki (po liście), wstawienie i wąska faza po liście, plus druga,
   drobna tablica zajętości z tej samej chwili (węzeł bez innego ciała w otoczeniu 3×3 nie szuka sąsiadów).
   Sama strefa AABB przy dziesiątkach wraków obejmowała cały kadłub, a komórka z prędkością końca wirującego
   wraku — dla wszystkich ciał (do 1 mln kandydatów).
5. **Wspólne (oba tryby)**: `response` poziomami niezależnych par w grupie roboczej (para czeka tylko na
   wcześniejsze pary dzielące z nią ciało — bit w bit jak jeden wątek; ciała w pamięci grupy, liczby kontaktów
   i rekordy par ładowane równolegle); agregat par z histogramem 12 górnych bitów klucza liczonym w `contactBin`
   (2 przejścia po kontaktach pary zamiast 4, grupa 1024 wątki, klucze w rejestrach); `reseat` po kawałkach
   listy (dawniej jedna grupa na ciało: ~7 ms przy każdym rozpadzie przy 1 j.); rekord węzła w siatce
   kontaktów 16 B (pozycja, ciało, następny — jeden odczyt na sąsiada zamiast trzech).
6. **Mniej dispatchy** (narzut ~3 µs z barierą razy 13 podkroków był większy niż praca małego obszaru):
   scalone `integrate` + `bodyEvents`, ciało + `nearFlags` (`bodyStage`, jedna grupa — wszystkie ciała),
   pierścień + zapiekanie frontu, prędkości + aktywacja pierścienia, czyszczenie siatki + reset par; `growF` /
   `growO` po 8 wątków na węzeł (dispatch 2D — limit 65 535 grup na wymiar). Przed stykiem przy 1 j.:
   1,3 ms/krok (pełny: 10,3).

### Determinizm i zgodność

Do tej pory przebiegi rozjeżdżały się po pierwszym rozpadzie. Przyczyny (naprawione, oba tryby): rozpad
stosowany w klatce zależnej od czasu mapowania odczytu (`benchSteps` czeka teraz na odczyt topologii), wyścig
w `crushApply` (węzeł w styku z kilkoma ciałami brał kierunek zgniotu pary, której wątek wygrał — teraz para
o najmniejszym kluczu) i 4 miejsca na ciała w wąskiej fazie (które 4 — zależało od kolejności łańcucha w
komórce; teraz 4 najmniejsze indeksy). **Dwa przebiegi dają teraz te same liczby także po dziesiątkach
rozpadów**, więc A/B jest porównywalne.

Lokalny ↔ pełny (oba deterministyczne; `belki-gpu-zgodnosc.mjs --warianty`), zerwania i v Atlasa (j./s):

| siatka | 0,6 s | 1 s | 2 s | 3 s |
|---|---|---|---|---|
| 15 j. (w nawiasie CPU pełny / lokalny) | 0 / 0 | 485 / 506 (510 / 547) | 1 113 / 1 130 (1 150 / 1 171) | 1 140 / 1 151 (1 165 / 1 188); v 360 / 364 (364 / 366) |
| 3,75 j. | 204 / 208 | 8 234 / 8 390 | 11 269 / 12 789; v 377 / 386 | v 369 / 371 |
| 1,9 j. | 879 / 858 | 44 540 / 44 735 | 83 009 / 82 598; v 383 / 382 | v 376 / 376 |
| 1 j. | 3 435 / 3 365 | 149 971 / 146 619; v 702 / 696 | 620 671 / 614 990; v 510 / 494 | 861 794 / 768 374; v 375 / 374 |

**Różnica świadomie opisana — przed rozpadem stan nie jest identyczny z pełnym solverem** (identyczny jest do
pierwszego styku: w locie żaden węzeł się nie rusza). Solver lokalny to inny model w tym samym sensie co
`_solveLocal` na CPU: reszta kadłuba jest sztywna (reakcja pierścienia od razu na ciało, sprężyste ugięcie
całego kadłuba nie powstaje: średnie przemieszczenie węzłów 2–3× mniejsze), pęd przechodzi na ciało w podkroku,
a nie przez średnią z całej kratownicy, a napięcie belek do węzłów wypadających z obliczeń jest zapiekane.
Zerwania po 2–3 s różnią się o −12% (3,75 j.) do +12% (1 j.), prędkości kadłubów o 0–3% — w rozrzucie, który
dzielą silniki między sobą (CPU pełny ↔ lokalny przy 15 j.: 7%). Niższy próg aktywności tej różnicy nie
zmniejsza (3,75 j., 2 s: próg ×0,25 — 11 448 zerwań, ×1 — 11 269, ×4 — 12 151, stały — 11 508, pełny 12 789) —
to model, nie próg; próg zmienia głównie rozmiar obszaru (średnio 22 / 9 / 3 tys. węzłów) i koszt.

### Co zostało i co dalej

Profil fazy zgniotu przy 1 j. (każdy dispatch we własnym przebiegu): GS 21% (27 dispatchy na podkrok —
narzut barier), wąska faza 15%, `growF` 10%, agregat par 9%, odpowiedź 9% (pary wraków z Atlasem tworzą
łańcuch ~40 poziomów — kolejność par jest częścią modelu CPU), `prepareLocal` 5%, czyszczenie i wstawianie
do siatki 8%. Dalsze kroki, od najbardziej obiecującego: (1) druga iteracja kontaktów tylko dla par z pierwszej
(zmienia semantykę przy popchnięciu ciała na trzecie); (2) GS bez dispatcha na kolor (bariera między grupami
roboczymi — WebGPU nie gwarantuje współbieżności grup, ryzyko zawieszenia); (3) broń pod ostrzałem: kernele
trafień przeglądają całą kratownicę przy każdym trafieniu (ostrzał 1,5 j.: 2,3 ms, obszar ~100 węzłów) —
listy z promienia trafienia; (4) mocowania wręgów tylko po zmianie struktury.

Nie pomogło: odczyt liczników raz na grupę roboczą zamiast `atomicLoad` w każdym wątku (bez zmian — to nie
atomiki, tylko narzut dispatchy); ciała par w pamięci grupy w `response` (koszt to łańcuch poziomów); kolory
8–9 (po ~25 tys. belek w obszarze przy 1 j.) w jednej grupie roboczej — wolniej niż dwa dispatche (ogon
kolorów tylko < 5% największego koloru).

Parametry strony: `?solver=lokalny|pelny`, `?aktywnosc=k` (próg k × bok komórki, domyślnie 0,2),
`?cisza=n` (podkroki ciszy, 8), `?prog=staly`, `?kontakty=skan`, `?gsAll=n` (belek obszaru dla GS w jednej
grupie, 20 000; 0 — wył.). Narzędzia: `belki-gpu-os.mjs` (oś czasu), `belki-gpu-ostrzal.mjs`,
`belki-gpu-zgodnosc.mjs --warianty "a=…;b=@strona?…"`, `belki-gpu-profil.mjs --siatki 1800`,
`bench-belki-gpu.mjs --strona`.

## Pułapki złapane po drodze

- **Vite przepisuje ``new URL(`…${x}`, import.meta.url)``** na import globem — obraz przestaje się
  dekodować. Adres liczyć bez szablonu w `new URL` (w demie: korzeń repo z `import.meta.url`).
- **Jednorodność WGSL**: bariera po pętli z granicą z bufora storage jest dozwolona, ale wartość
  czytana z `var<workgroup>` bez `workgroupUniformLoad` jest niejednorodna — warunek pętli z barierą
  w środku musi przyjść przez `workgroupUniformLoad`.
- **Limit 16 buforów storage na etap** liczy się z UKŁADU potoku, nie z tego, co shader używa —
  jeden wspólny układ na wszystkie kernele się nie mieści; każdy kernel ma własny (generator wiązań).
- **Znaczniki czasu**: bez `--enable-webgpu-developer-features` Chrome kwantuje je do 100 µs;
  w headless pętla rAF (~3000 kl./s) nadpisywała querySet i stan — pomiary zatrzymują pętlę
  (`__gpu2d.setLoop(false)`).
- **Git Bash (MSYS) zamienia argument `//…` na `/…`** (konwersja ścieżek) — skrypt podmieniający
  tekst po znacznikach `// …` zjadł ukośnik. `MSYS_NO_PATHCONV=1` albo znaczniki bez `//` na początku.
- Profil per kernel (`world.profile = true`, każdy dispatch we własnym przebiegu ze znacznikami)
  zawyża koszt drobnych dispatchy — do proporcji, nie do sumy.
- **Limit 65 535 grup na wymiar** dotyczy też dispatchy pośrednich: przy 8 wątkach na węzeł i ~580 tys.
  węzłów w A dispatch był odrzucany (błąd walidacji tylko w konsoli), a stan zamarzał (prędkości bez
  całkowania, 50 podkroków). Dispatch 2D (`GROW_SPLIT`).
- **`move` to słowo zastrzeżone WGSL** (jak `pass`, `active`, `target`, `meta`, `filter`, `type`).
