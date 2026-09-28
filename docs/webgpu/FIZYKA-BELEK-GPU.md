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
| `scripts/bench-belki-gpu.mjs` | pomiar CPU vs GPU w headless Chrome na prawdziwym GPU |
| `scripts/belki-gpu-zgodnosc.mjs` | zgodność fizyki: ta sama scena na GPU, CPU pełnym i lokalnym, próbki w czasie |
| `scripts/belki-gpu-profil.mjs` | czas karty na kernel (każdy dispatch we własnym przebiegu) |
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
| solver lokalny (tylko obszar w ruchu) | zawsze pełny | brak artefaktów solvera lokalnego (np. zamrożone sprężyste wgniecenie przy 7,5 j.), ale koszt nie spada w spoczynku |
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
