# Start gry w workerze: pipeline'y synchroniczne w klatce zero (2026-10-20)

Zadanie (z weryfikacji Promienia Śmierci, sesja „scena-wojna”): w trybie worker (domyślnym dla gracza) start gry tworzył
SYNCHRONICZNIE 5 pipeline'ów w pierwszej klatce gry — mostek Atlasa (bryła, cień, okna), partia dysz SIDE 3D i wieże
`tempest1@1` — na main `9d0e61fd` w każdym z 4 przebiegów ABBA (w jednym dłuższym na obciążonej maszynie — 14). Zasada
żelazna 5: 0 pipeline'ów kompilowanych synchronicznie w klatce gry. Gałąź `claude/hungry-kalam-e0761a`.

## 1. Odpowiedź w skrócie

1. **Przyczyna główna — zestaw świateł.** Latarnie stacji pirackiej (`world3d.js`, dwa `PointLight` z intensywnością 0 —
   „stałe światła sceny od startu gry”) strona tworzy przy starcie (`initWorld3D()`), a worker dopiero wpisem rozgrzewki
   „stacja piracka: bryła”, w środku kolejki. Zestaw świateł passa wchodzi do klucza KAŻDEGO materiału (pułapka 34),
   więc wszystko rozgrzane wcześniej miało w kluczu 5 świateł, a klatka zero rysowała z 7:
   - wieże i dysze SIDE (materiały oświetlane): rozgrzewka była, ale w klatce — NOWY pipeline, synchronicznie;
   - bryły gazu wybuchów (krok `Core3D.fx` rozgrzany przy tworzeniu fabryki): wpisy rejestru budowały je drugi raz,
     0,5–1,1 s CPU każda (na stronie te same wpisy — 30 siatek w 0,8 ms, bo trafiają w budowy kroku).
2. **Przyczyna druga — kolejka a klatka zero.** Przez bryły gazu `flush` przygotowań sceny stał na limicie 4 s, a wpis
   mostków był w kolejce ZA wybuchami. Strona czeka na `prepare` workera najwyżej 25 s — po tym czasie rysuje klatkę
   zero (pod kurtyną ładowania), a worker kompiluje w niej synchronicznie wszystko, czego kolejka nie zdążyła.
3. **Poprawki:** latarnie w scenie workera od jej powstania (jak strona); klatka zero workera rozgrzewa przed rysunkiem
   to, co widać (`Core3D.prewarmVisibleNow` → `Core3D.warmup.compileNow`); pamięć nieba mgławicy rusza dopiero z gotowym
   pipeline'em zapisu; wypiek banku skał kompiluje przejścia w tle. Narzędzie `scripts/webgpu/start-sync-gra.mjs`.
4. **Wynik (baza main `f5c11a13`, ABBA):** worker 5 / 2 → 0 / 0 pipeline'ów sync w klatce zero i po 120 krokach;
   `flush` ekranu ładowania 4,2 s + 1,2 s → 0,9–1,0 s + 0,01–0,02 s, od kliku do gry 16,9 → 11,0 s; przy kolejce
   rozgrzewki wolniejszej o 25 ms na zadanie (symulacja wolniejszej maszyny) main 7 / 8 → 0 / 0. Tryb `off`: w klatkach
   gry 0 przed i po; 4 pipeline'y sync wypieku banku skał na ekranie ładowania → 0; `flush` 2,3 s bez zmian (§ 5).

## 2. Metoda

- Prawdziwa gra: Vite + headless Chrome z WebGPU (RTX 5080, D3D12), 1600 × 900, bez limitu klatek, przez CDP; gra
  swobodna (bez kampanii), „Start” od razu po wstaniu strony — najgorszy przypadek: worker kończy kolejkę rozgrzewki
  razem z ekranem ładowania. Maszyna przed seriami: GPU 1–2%, CPU ~17%, bez innych przebiegów headless.
- **`scripts/webgpu/start-sync-gra.mjs`** (nowe; z doraźnego `start-sync-ab.mjs` sesji „scena-wojna”): łapie konsolę
  workera (`Target.setAutoAttach`, sesje płaskie) — pipeline'y sync w klatkach workera z jego dziennika
  (`[render.worker] pipeline sync #n k=…`) i czasy `flush` każdego przygotowania sceny; strona — `__harness.pipes`
  (sync bez compute, od wczytania; w trybie off strona to render, z ekranem ładowania). Start i stan po 120 krokach
  harnessu. A/B wersji kodu w tym samym drzewie przez `HULLFALL_AB_DIR` (A = oryginały plików, B = gałąź), ABBA,
  każdy przebieg na świeżym serwerze i profilu. `--stres <ms>` — każde zadanie kolejki rozgrzewki WORKERA dłuższe
  o <ms> (busy-wait w `Core3D.warmup._compileOne`, przez import modułu w sesji workera renderu).
- Tryb `off` w prawdziwym czasie: `scripts/webgpu/start-gry.mjs` (okna klatek: przed menu, menu, ładowanie, gra; menu
  2 s przed „Start”) na eksportach `git archive`.
- Diagnoza (tymczasowy dziennik w `render.worker.js`, nie w commicie): przy każdym pipeline'ie materiałów mostka, dysz
  i wież — kontekst renderu (id, MSAA, głębia), programy, klucz pipeline'u backendu (stan, formaty, wyznacznik macierzy,
  układ atrybutów), klucz materiału i klucz dynamiczny, kamera i światła (`renderObject.lightsNode.getLights()`), osobno
  dla `compileAsync` (rozgrzewka) i rysunku w klatce; stan kolejki rozgrzewki po każdym `prepare`.

## 3. Diagnoza (baza `9d0e61fd`)

| Pipeline w klatce zero | Rozgrzewka przed klatką | Różnica klucza rysunku i rozgrzewki |
|---|---|---|
| `broń 3D (partie)` @ `wieże 3D: tempest1@1` | tak — trzymacz partii (`turretBatchWarmHolder`, LOD 1) | klucz materiału, kontekst (MSAA 4, Depth24Plus), stan i układ atrybutów — identyczne; klucz dynamiczny inny: światła 5 → 7 (+ `PointLight` #1031, #1033 — latarnie stacji pirackiej) |
| `dysze SIDE 3D (partia)` @ `dysze SIDE 3D` | tak — trzymacz partii | jak wyżej: tylko światła |
| `bridge3D:model` / `:shadow` / `:windows` | NIE — wpis `mostki 3D` jeszcze w kolejce | — |

Przebieg workera (dziennik): przygotowanie „idle” w menu (20 s po starcie workera) — `flush` 4450 ms, 224 siatki, limit
czasu minął na „wybuchy: bryły gazu i duszki” (7 z 15); klatka zero przyszła w trakcie przygotowania „Start” (strona
przestała czekać na `prepare` po 25 s); `flush` „Start” 4339 ms — 5 siatek, same bryły gazu (budowy 1085, 882, 668, 729,
495 ms); po klatce zero `flush` 3499 ms. W trybie off ten sam wpis „wybuchy” — 30 siatek w 0,8 ms CPU (trafia w budowy
kroku fx, bo na stronie latarnie są w scenie od `initWorld3D()` przy starcie). To samo tłumaczy dawną obserwację z
reguły `webgpu-tsl`, że rozgrzewka z samego kroku fx „w workerze nie trafiała w klucz” brył gazu.

Sama poprawka świateł (2 przebiegi): 0 / 0 pipeline'ów sync, `flush` „Start” 1236 / 1505 ms (było 4339), po klatce zero
872 / 0 ms — kolejka kończy się przed klatką zero i mostki zdążają. Kolejka wolniejsza o 25 ms na zadanie (§ 5.2) pokazuje,
że to zależy od czasu: bez rozgrzewki klatki zero znów 4 sync (pamięć nieba + mostek ×3).

## 4. Poprawki

1. **Stałe światła w workerze od początku** — `render.worker.js`: `st.w3.initWorld3D()` zaraz po scenie
   (`hex.initHexShips3D`), przed urządzeniem i pierwszą kompilacją; jak `initWorld3D()` strony przy starcie.
2. **Klatka zero rozgrzewa to, co widać** — pierwsza strona gry w workerze (`renderPage`, flaga `st.firstPageWarm`)
   woła po aktualizacji modułów, przed rysunkiem `Core3D.prewarmVisibleNow()`: widoczne w passach gry
   (`GAME_PASS_LAYERS` — te same warstwy co wpisy „start gry”) i rzucające cień przez nowe `Core3D.warmup.compileNow`
   (budowy NodeBuildera od razu, pipeline'y w tle; rysunki z pipeline'em w budowie pomija `_guardPendingPipelines`,
   `flush` czeka na nie). Macierze i przełączniki passów jak w `render()` (wyznacznik w kluczu — pułapka 37).
3. **Pamięć nieba mgławicy** (`planet3d.assets.js`) — zapis do pamięci dopiero z gotowym pipeline'em (wpis
   „mgławica: pamięć nieba”, `cacheWriteReady`); do tego czasu niebo liczone wprost (ten sam obraz — różnica pamięci
   ≤ 0,0029 liniowo, commit `d6e165e7`). Rysunek modułu do własnego celu nie jest obiektem passa — siatka klatki zero
   go nie widzi.
4. **Wypiek banku skał pasa** (`rockBank.js`) — cztery przejścia (`proc`, `readback`, `normal`, `mask`) kompilowane
   `compileAsyncNaCelu` na celach swoich przejść przed pierwszym rysunkiem (tryb off: ekran ładowania; worker: menu).
5. Narzędzie `scripts/webgpu/start-sync-gra.mjs`, reguły `webgpu-tsl` („Stałe światła sceny są w niej przed pierwszą
   kompilacją”, „Klatka zero workera nie czeka na kolejkę rozgrzewki”) i `render-worker` („Start gry w workerze — co
   musi być przed klatką zero”), hak w `AGENTS.md`, testy w `tests/rozgrzewka.test.mjs` (`compileNow`, strażnik
   kolejności w workerze).

## 5. Wyniki A/B

Pipeline'y sync liczone bez compute. „Start” = po wejściu gry (ekran ładowania zszedł, ≥ 30 klatek), „po 120” = po
kolejnych 120 krokach harnessu. `flush` workera: przygotowanie w menu / „Start” / po klatce zero (limit 4 s każde).

### 5.1. Worker, baza main `f5c11a13` (A = main, B = gałąź), ABBA

| Przebieg | Worker sync: start / po 120 | `flush` menu / „Start” / po klatce zero [ms] |
|---|---|---|
| A0 | 5 / 5 (wieże `tempest1@1`, dysze SIDE 3D, mostek ×3) | 4418 / 4204 / 1244 |
| B1 | 0 / 0 | 2926 / 903 / 22 |
| B2 | 0 / 0 | 2803 / 954 / 12 |
| A3 | 2 / 2 (wieże, dysze — mostek tym razem zdążył) | 4375 / 4236 / 1152 |

Strona w trybie worker — 0 we wszystkich (strona nie ma urządzenia GPU), bez błędów.

### 5.2. Worker pod stresem kolejki (+25 ms na zadanie rozgrzewki)

Symulacja wolniejszej maszyny albo szybszego „Start” (`start-sync-gra.mjs --stres 25`, ~+9 s na całą kolejkę): kolejka
nie kończy się przed klatką zero — to, co zostaje, sprawdza siatkę bezpieczeństwa klatki zero i pamięci nieba.

| Przebieg | Worker sync: start / po 120 | `flush` menu / „Start” / po klatce zero [ms] |
|---|---|---|
| A0 (main) | 7 / 7 — pamięć nieba (`GameNebula:zapisPamieci`), wieże, dysze SIDE, mostek ×3, światła nawigacyjne (`shipNavLights`) | 4011 / 4004 / 4379 |
| B1 | 0 / 0 | 4027 / 4002 / 4016 |
| B2 | 0 / 0 | 4002 / 4029 / 4012 |
| A3 (main) | 8 / 8 — jak A0 + `ShadowMaterial` (pass mapy cienia) | 4018 / 4020 / 4476 |

Na bazie `9d0e61fd` (2026-10-20, etapy poprawki, `--stres 25`): sama poprawka świateł — 4 sync (pamięć nieba, mostek ×3);
światła + klatka zero — 1 (pamięć nieba: rysunek modułu do własnego celu, nie obiekt passa); wszystkie poprawki — 0 / 0
w dwóch przebiegach. Pod stresem każdy `flush` kończy się na limicie 4 s (przekroczenie ≤ jedno zadanie kolejki).

### 5.3. Tryb off — harness (zegar strony zamrożony: `flush` nie ma limitu czasu), ABBA

| Przebieg | Strona sync: start / po 120 | Lista |
|---|---|---|
| A0 (main) | 8 / 8 | PMREM ×4 (przed menu), `rockBankProc` / `Readback` / `Normal` / `Mask` (wypiek banku skał na ekranie ładowania) |
| B1 | 0 / 0 | — |
| B2 | 0 / 0 | — |
| A3 (main) | 4 / 4 | wypiek banku skał ×4 |

PMREM mapy otoczenia modeli (`applyShipEnv`) powstaje przed tłem menu, w wyścigu z instalacją haka `__harness.pipes` — raz
policzony, raz nie, po obu stronach; gałąź go nie zmienia (§ 7). Wypiek banku skał: 4 → 0 w każdym przebiegu.

### 5.4. Prawdziwy czas — off i worker (`start-gry.mjs`, menu 2 s przed „Start”)

Eksport `git archive` main `f5c11a13` (A) i gałąź (B), przebiegi na przemian po rozbiegu każdej strony, mediany z 2
(min–maks). Okna: przed menu, ładowanie (klik → pierwsza klatka gry), gra (pierwsze 300 klatek gry); pipeline'y strony.

| Tryb `off` | main | gałąź |
|---|---|---|
| Pipeline'y sync: przed menu / ładowanie / gra | 0–4 (PMREM) / 4 / 0 | 0 / 0 / 0 |
| `flush` [ms] (limit 4000) | 2298 (2267–2329) | 2344 (2278–2409) |
| Od kliku do pierwszej klatki gry [ms] | 8066 (7991–8141) | 8016 (7743–8288) |
| Pierwsza klatka gry [ms] (CPU) | 217 (199–235), CPU 140 | 150 (150–151), CPU 131 |

| Tryb worker (strona bez urządzenia GPU — pipeline'y workera w § 5.1) | main | gałąź |
|---|---|---|
| Od kliku do pierwszej klatki gry [ms] | 16 874 (16 717–17 030) | 11 047 (10 950–11 143) |
| Od kliku do pierwszego obrazu workera [ms] | 11 015 / 12 767 | 10 137 / 9 927 |
| Najdłuższy przestój ekranu ładowania [ms] | 783 (645–920) | 645 (628–661) |

W trybie worker ekran ładowania jest krótszy o ~6 s: przygotowania sceny workera (menu, „Start”, po klatce zero) kończą
się przed limitami `flush` (§ 5.1), bo kolejka nie buduje drugi raz brył gazu wybuchów (§ 3).

## 6. Koszt

- Klatka zero workera (pod kurtyną): rozgrzewka widocznego — 8–38 ms CPU (13 siatek warstwy 0 i 5 rzucających cień;
  reszta już rozgrzana). Cała klatka zero (ABBA na bazie `9d0e61fd`, z poprawką świateł po obu stronach): z rozgrzewką
  127 i 398 ms, bez niej 137 i 153 ms — rozrzut robią moduły (109–363 ms), nie rozgrzewka.
- Ekran ładowania workera krótszy: `flush` „Start” 4,2 s → ~0,9 s, po klatce zero ~1,2 s → ~0,02 s, od kliku do gry
  16,9 → 11,0 s — kolejka nie buduje drugi raz brył gazu wybuchów. Pod stresem kolejki każdy `flush` kończy się na
  limicie 4 s (przekroczenie ≤ jedno zadanie). Tryb `off`: `flush` i czas do gry bez zmian (szum ±0,1 s); wypiek banku
  skał czeka na kompilację w tle zamiast stać na niej.

## 7. Co zostaje (poza zadaniem)

- Tryb off, przed menu: 4 pipeline'y sync PMREM mapy otoczenia modeli okrętów (`applyShipEnv`, `PMREMGenerator.fromScene`)
  — przed tłem menu, nie w klatce gry.
- Kernele compute na ekranie ładowania są synchroniczne z natury three r183 (rozgrzewają je kroki `Core3D.fx`).
- Worker: po starcie gry rejestr w tle buduje jeszcze wpisy `rozpad stacji: …` i `modele 3D floty` (30–160 ms CPU na
  budowę w wątku workera — przestoje obrazu, nie pipeline'y sync): stacje workera dostają wypiek rozpadu dopiero z
  migawki (strona w trybie worker pomija `prepareStations3D`).
- Pierwsza klatka gry po klatce zero: moduły 190–320 ms CPU w workerze (dziennik workera; w trybie off pierwsza klatka
  150–235 ms) — do zbadania osobno.
- Światła planet (słońce z cieniem, otoczenie) dochodzą w workerze przy wiadomości `planets`, zaraz po urządzeniu — już po
  rozgrzewce kroków fx zarejestrowanych przed urządzeniem; dziś bez pipeline'ów sync w pomiarach, ale to ten sam wzór co
  latarnie.
