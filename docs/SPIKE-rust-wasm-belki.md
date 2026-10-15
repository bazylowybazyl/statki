# Spike: gorące jądra silnika belek w Rust → WebAssembly (2026-10-15)

Pytanie: czy przeniesienie fizyki belek (albo całej gry) do Rusta da rząd wielkości, np. fizykę ~0,4 ms na krok?
Odpowiedź z pomiaru: **nie**. Jądra przeniesione do WASM liczą się 1,1–1,2× szybciej (matematyka solvera) i 1,8–3,4×
szybciej (skan kandydatów kontaktu). Krok fizyki w oknie piku szyi habitatu spada z 9,9 do 8,5–8,7 ms, czyli ×1,13–1,16.
Rekomendacja: **no-go**. Gra zostaje w JS, Rusta nie dokładamy do budowania.

Kod spike'u: `experiments/rust-beams/` (Rust + hak ładowania modułów + skrypt pomiarowy). Żaden plik gry nie był zmieniany.

## 1. Profil: co dominuje

`node --cpu-prof` na `scripts/destrukcja-taran-sym.mjs --tryb szyja --dt 60 --v 3000` (cały przebieg 18 s symulacji):

| funkcja | self | z dziećmi |
|---|---:|---:|
| `collideBodies` (kolizje par) | 7,9% | **44,8%** |
| `_contactCandidates` (skan węzłów pary) | **25,0%** | 25,0% |
| `_collideMixed` (para bryła 3D × płaskie) | 4,1% | 29,4% |
| `solveSoftBody` → `_solveLocal` (solver lokalny) | 6,5% | **21,2%** |
| `prepareBeamConstraints` | 4,8% | |
| `projectBeamConstraints` (+2D) | 6,6% | |

Oś czasu szyi: przez większość sceny krok kosztuje 1–3 ms. Pik zaczyna się przy uderzeniu wieży bokiem (7,5–9 s,
~10 ms na krok przy 60 Hz). W piku solver i kolizje dzielą się mniej więcej po połowie (4,9 + 4,6 ms).
Na zwykłym taranie (`--tryb czolo,pchanie`) krok trwa 0,2–0,7 ms i dominuje pętla kontaktów `collideBodies` (self).

Do WASM poszły więc dwa jądra:

- **K1, matematyka solvera lokalnego**: `prepareBeamConstraints` (odkształcenie, zmęczenie, zerwania, plastyczność, wagi)
  i `projectBeamConstraints` / `projectBeamConstraints2D` (rzut Gaussa–Seidla). Księgowość `_solveLocal` (budowa A ∪ F,
  pierścień, zapis prędkości) została w JS.
- **K2, skan kandydatów kontaktu**: pętla po węzłach w `_contactCandidates`. Prolog z macierzami (O(1) na parę) został w JS.

Oba jądra razem to w oknie piku 4,3 z 9,9 ms kroku (43%).

## 2. Port

- Rust 1.99, `wasm32-unknown-unknown`, `cdylib` bez zależności (bez wasm-bindgen i wasm-pack), `opt-level 3`, LTO,
  `panic = abort`. Pamięć liniowa jest **importowana** z JS: jedna `WebAssembly.Memory` (1,5 GB, bez `grow`) dla obu wariantów.
- Magazyny SoA (`BeamNodeStore`, `BeamLinkStore`), bufory robocze solvera (`beamSolverScratch`), `region.constraints`
  i `_ncList` leżą w tej pamięci. JS czyta je zwykłymi widokami `Float64Array` / `Int32Array` / `Uint8Array`, więc nic nie
  jest kopiowane co krok. Wywołanie = zapis wskaźników do bloku parametrów (≤ 23 słowa u32 + 8 f64) i jeden eksport.
- Bez edycji repo: hak `node:module.register` (`js/hooks.mjs`) podmienia `beamStore3D.js`, `beamConstraintSolver3D.js`
  i `beamActiveRegion3D.js` na wersje spike'u. Wersje spike'u ładują oryginał przez `?orig`, więc tryb `js` uruchamia
  **dokładnie kod z `src/`**. `_contactCandidates` jest podmieniane na obiekcie silnika w skrypcie pomiarowym.
- **Wariant A**: skalarny, ta sama kolejność działań co JS. `Math.max/min/sign` odwzorowane z obsługą NaN i ±0.
- **Wariant B**: `simd128`. W rzucie Gaussa–Seidla dwie kolejne belki bez wspólnego węzła idą naraz w pasach f64x2:
  druga nie czyta tego, co pisze pierwsza, więc wynik jest taki sam jak po kolei. Długości belek w `prepare` liczone
  są parami. Skan sprawdza po dwa węzły (f64x2 `lt/gt` + bitmaska, ta sama semantyka NaN co JS).
- **Wariant C** (wątki przez SharedArrayBuffer): niezrobiony, bo A i B nie przekroczyły progu. Warunek techniczny jest
  już spełniony: Vite dev i preview (`vite.config.js`) oraz Electron `app://` (`electron/main.js`) wysyłają
  `COOP: same-origin` + `COEP: require-corp`. Wątki nie ratują jednak Gaussa–Seidla (rzut jest sekwencyjny, kolorowanie
  grafu zmienia wynik), a skan jest za krótki (85 wywołań po ~10 µs na krok) na koszt synchronizacji.

## 3. Zgodność: bit w bit (A i B)

- `tests/beamLocalSolverExact.test.mjs` (złoty test solvera lokalnego z wzorcem `tests/helpers/beamLocalSolverReference.mjs`)
  przechodzi 4/4 w trybach `js`, `A` i `B`.
- Wszystkie `tests/beam*.test.mjs` (22 pliki) + `tests/destrukcjaTaran.test.mjs`: 133/133 w trybach `js` i `B`.
- Hash stanu po każdej scenie (bity x, y, z, vx, vy, vz wszystkich węzłów i poza ciał, 34 ciała i 46,6 tys. węzłów w szyi)
  jest identyczny w JS, A i B we wszystkich rundach. Rzut parami w SIMD nie zmienia wyniku, bo pasy liczą te same
  działania IEEE co skalar, a pary są niezależne. Tolerancja nie była potrzebna.
- Do porównywalności hashy skrypt podstawia w scenach deterministyczne `Math.random`: krater z budżetu HP losuje odrzut węzłów.

## 4. Pomiar

Node 22.20 (V8 12.4), Windows 11, 16 wątków, 60 Hz. Jeden proces, kolejność trybów rotuje co rundę, 6 rund, z czego
runda 0 to rozgrzewka (odrzucona). Dla każdego kroku liczona jest mediana z 5 rund, potem statystyki po krokach.
Trajektorie są w każdym trybie identyczne (bit w bit), więc krok k porównujemy krok w krok. Okno piku = kroki,
w których JS ≥ p90 JS. Pozostałe sesje dostały START / KONIEC na czas serii. Wynik surowy:
`experiments/rust-beams/wyniki/seria-60hz.json` (+ `.log`).

Sceny:

- **szyja**: Atlas szarżą w szyb habitatu, zerwanie, przechył wieży 3D, uderzenie bokiem, osiadanie (18 s, 1080 kroków).
- **taran**: Atlas 900 j/s + ciąg do 3000 j/s w ścianę bębna przez 4 s, potem 2 s.
- **ostrzał**: Atlas, 4 pancerniki i 8 niszczycieli, 6 kraterów broni na krok (co 5. ciężki z kraterem na miarę rany),
  czyli ogony trafień solvera lokalnego.

### Krok fizyki [ms]

| scena | tryb | średnio | p50 | p95 | max | **okno piku** | przyspieszenie piku |
|---|---|---:|---:|---:|---:|---:|---:|
| szyja | JS | 2,448 | 1,209 | 9,813 | 13,77 | **9,866** | — |
| szyja | A | 1,920 | 0,801 | 8,562 | 12,42 | **8,706** | **×1,13** |
| szyja | B | 1,722 | 0,659 | 8,418 | 12,81 | **8,490** | **×1,16** |
| taran | JS | 0,264 | 0,190 | 0,601 | 1,42 | 0,690 | — |
| taran | A | 0,242 | 0,182 | 0,573 | 1,37 | 0,599 | ×1,15 |
| taran | B | 0,247 | 0,184 | 0,579 | 1,40 | 0,618 | ×1,12 |
| ostrzał | JS | 0,173 | 0,114 | 0,496 | 0,80 | 0,516 | — |
| ostrzał | A | 0,176 | 0,120 | 0,509 | 0,85 | 0,528 | ×0,98 |
| ostrzał | B | 0,177 | 0,120 | 0,491 | 0,87 | 0,522 | ×0,99 |

Rozrzut rund w szyi (średni krok): JS 2,50–2,57, A 1,91–2,14, B 1,75–1,79 ms.

### Same jądra [ms na krok, mediana]

| scena | jądro | JS | A | B | A / JS | B / JS |
|---|---|---:|---:|---:|---:|---:|
| szyja, okno piku | K1 solver (prepare + rzut) | 2,826 | 2,326 | 2,560 | ×1,21 | ×1,10 |
| szyja, okno piku | K2 skan kandydatów | 1,457 | 0,801 | 0,426 | ×1,82 | ×3,42 |
| szyja, cała | K1 | 0,403 | 0,333 | 0,368 | ×1,21 | ×1,10 |
| szyja, cała | K2 | 0,923 | 0,483 | 0,264 | ×1,91 | ×3,50 |
| ostrzał, okno piku | K1 | 0,234 | 0,210 | 0,230 | ×1,11 | ×1,02 |

Wywołań na krok w szyi: 3 × prepare, 3 × rzut, 85 × skan. Lepsza średnia szyi (×1,28 / ×1,42) to prawie w całości skan
w spokojnych fazach (wieża stoi, kolizje ~1 ms bez solvera). Wyjaśnienie wyników:

- **Gauss–Seidel** to łańcuch zależności sqrt → dzielenie → zapis w pozycje, z których czyta następna belka. TurboFan
  kompiluje te pętle na `Float64Array` prawie do kodu natywnego, a w WASM ograniczenie jest to samo (opóźnienie sqrt
  i dzielenia, rozproszone odczyty). Pary f64x2 w B nie pomagają: składanie pasów z rozproszonych węzłów (12 wstawień
  i 12 wyciągnięć) zjada zysk z dwóch sqrt naraz. Na prostszych kadłubach ostrzału solver w WASM nie jest szybszy wcale.
- **Skan** to filtr przepustowości po ciągłych tablicach x / y / z: WASM bez sprawdzania zakresów daje ×1,8,
  a SIMD (2 węzły na porównanie) ×3,4.

### Koszt przejścia JS ↔ WASM

- Pusty eksport: 8,8 ns na wywołanie (zwykła funkcja JS w tej samej pętli: 9,1 ns), więc samo przejście jest darmowe.
- Pełne wywołanie `prepare` przez dyspozytor przy 0 belek (zapis ~31 parametrów, `byteOffset` widoków): 248 ns.
- W szyi to ~91 wywołań na krok, czyli ≲ 20 µs na krok, i jest już wliczone w czasy powyżej. Koszt przejścia nie jest
  powodem słabego wyniku.

## 5. Ile dałby port całości (Amdahl)

W oknie piku szyi (9,87 ms) przeniesione jądra to 4,28 ms. Reszta, 5,59 ms, to księgowość `_solveLocal` (~2,1),
reszta kolizji (`collideBodies`, `_collideMixed`, `_contactV2` — ~3,2) i drobne (~0,3). To kod rozgałęziony,
z rozproszonymi odczytami, podobny do K1, nie do skanu. Szacunek z pomiaru K1:

- reszta w WASM ×1,2, najlepsze warianty jąder (A solver, B skan): 4,66 + 2,33 + 0,43 ≈ **7,4 ms → ×1,33**;
- wariant optymistyczny, reszta ×1,5: ≈ 6,5 ms → **×1,52**.

Cała fizyka w Ruście dałaby więc w piku ~1,3–1,5×, nie ×25 potrzebne do 0,4 ms. Natywny Rust (bez WASM) mógłby dołożyć
trochę (FMA, AVX2 na skanie), ale wymagałby przepisania gry poza przeglądarką. Rząd wielkości w piku leży w algorytmie:
liczbie belek i par w solverze, 85 pełnych skanów węzłów na krok, kolizjach wieży leżącej w spoczynku. Język tu nie pomaga.

## 6. Koszt wdrożenia (gdyby jednak)

- **Toolchain**: rustup + cel `wasm32-unknown-unknown`. Na tej maszynie zainstalowany do profilu użytkownika na potrzeby
  spike'u (`%USERPROFILE%\.rustup` 938 MB, `.cargo` 15 MB, host `x86_64-pc-windows-gnu`, bez MSVC). Każdy, kto buduje
  grę, musiałby mieć to samo. Usunięcie: `rustup self uninstall`.
- **Budowanie**: `node experiments/rust-beams/build.mjs`, oba warianty w ~1 s (cargo, bez wasm-pack i wasm-bindgen).
- **Rozmiar**: `beams_scalar.wasm` 2,9 KB, `beams_simd.wasm` 5,1 KB.
- **Vite / `npm run build`**: plik .wasm jako zasób przez `new URL(…, import.meta.url)` (jak GLB broni) i
  `WebAssembly.instantiate`. Krok cargo przed `vite build` albo .wasm commitowany do repo.
- **electron-builder**: .wasm ląduje w `dist/` razem z bundlem, a `app://` już podaje pliki. Paczka urosłaby o kilka KB.
- **Koszt ukryty, największy**: magazyny SoA muszą żyć w pamięci WASM. To oznacza alokator z ręcznym zwalnianiem
  (spike: FinalizationRegistry + wolne bloki, w szyi ~37 MB na przebieg) i pamięć bez `grow`: każde `grow` odłącza
  WSZYSTKIE widoki, więc trzeba z góry zarezerwować sufit pamięci albo przebudowywać widoki w całym silniku. Do tego
  podwójne utrzymanie każdego jądra (JS w testach i narzędziach, Rust w grze) oraz lustra przy każdej zmianie fizyki.

## 7. Rekomendacja: NO-GO

Kryterium z zadania: ≥ 2× na scenach z pikami → przenosić kolejne jądra; < 1,5× → zostajemy przy JS.

| scena z pikami | najlepszy wariant | przyspieszenie |
|---|---|---:|
| szyja habitatu (pik ~10 ms) | B | ×1,16 |
| taran | A | ×1,15 |
| ostrzał (ogony trafień) | — | ×0,98–0,99 |

Wszystkie wyniki są poniżej 1,5×, a szacunek dla portu całej fizyki to ~1,3–1,5×. **Zostajemy przy JS.** Rust / WASM
nie zamyka luki do 0,4 ms. Piki rozwiązują zmiany algorytmu w JS (mniej skanów par, tańszy spoczynek brył, mniej belek
w solverze lokalnym), a nie zmiana języka.

Jedyne miejsce, gdzie WASM wyraźnie wygrywa, to skan kandydatów (×3,4 z SIMD). Daje to jednak ×1,1–1,2 na kroku
i nie uzasadnia toolchaina Rusta w budowaniu gry. Ten sam zysk prawdopodobnie da się wyjąć algorytmicznie w JS
(ograniczenie zakresu skanu albo liczby par z bryłami 3D).

## 8. Jak powtórzyć

```bash
node experiments/rust-beams/build.mjs
node --expose-gc --import ./experiments/rust-beams/js/register.mjs experiments/rust-beams/bench.mjs --sceny szyja,taran,ostrzal --rundy 6 --out experiments/rust-beams/wyniki/seria-60hz.json
BEAMS_MODE=A node --import ./experiments/rust-beams/js/register.mjs --test tests/beamLocalSolverExact.test.mjs
```

`BEAMS_MODE` = `js` | `A` | `B` (tryb startowy; bench przełącza sam), `BEAMS_WASM_MB` = rozmiar pamięci WASM,
`BEAMS_CHECK=1` = sprawdzanie, czy każda tablica leży w pamięci WASM. Kopia `js/beamActiveRegion3D.mjs` pochodzi
z `src/game/beamActiveRegion3D.js` (jedyna zmiana: `region.constraints` w pamięci WASM). Przy zmianie oryginału trzeba
ją wygenerować od nowa.
