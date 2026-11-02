# Audyt: klatka workera renderu — co mógłby przejąć drugi wątek (2026-11-02)

Pytanie użytkownika (2026-10-28): „render worker dual core / dual worker — da się?”, a po odpowiedzi „Tak, zmierz” — ile
klatki workera to rysunki three, a ile praca modułów, którą mógłby przejąć pomocnik bez GPU. Bez zmian w grze; narzędzia
w `scripts/webgpu/klatka-workera-*`.

## 1. Odpowiedź w skrócie

- **Dwa workery renderu — nie.** WebGPU nie przekazuje `GPUDevice` / `GPUBuffer` / `GPUQueue` między wątkami (Chrome 156
  z izolacją COOP/COEP: `postMessage` i `structuredClone` → `DataCloneError … could not be cloned`; specyfikacja zapowiada
  wielowątkowość „później”). Drugi worker może mieć tylko WŁASNE urządzenie: osobne zasoby, podwójne pieczenie i
  kompilacje (stan sprzed RW-41c: start 18–33 s zamiast ~10 s), a polecenia obu urządzeń i tak dekoduje jeden wątek
  procesu GPU (`CrGpuMain`, audyt renderu § 7.3). Zasada żelazna 2.
- **Klatka workera w szczycie bitwy (1920 × 1080): 3,5–3,9 ms**, z czego **własny JS modułów 2,0–2,2 ms (53–63%)**,
  three + API GPU + maszyneria Core3D 1,2–1,8 ms (34–47%). Same rysunki three (`_renderObjectDirect`) to 0,6–1,0 ms przy
  39–71 rysunkach na klatkę (12–16 µs na rysunek) — partie działają, rysunków jest mało.
- Przed renderem three prawie nie występuje (0,03 ms na klatkę): moduły liczą dane do tablic, wysyłka idzie dopiero
  w `renderSingle`. Pomocnik bez GPU, który czyta strony migawki z SAB (już tam są) i pisze tablice dla workera, ma czym
  się zająć: **~1,0–1,2 ms na klatkę w szczycie V1 (25–30% klatki)** — dysze, światła kadłubów, rekordy kadłubów i wież,
  cząstki, siatka świateł efektów. Lustra (0,24–0,48 ms) worker potrzebuje i tak, a pomocnik musiałby mieć własne.
- **Zysk zależy od schematu:** fork-join z jednym pomocnikiem (praca po połowie, oba liczą swoje lustra) ≈ −0,6 ms
  (−15%); potok (pomocnik liczy stronę k+1, gdy worker rysuje k) ≈ −1,1 ms (−29%), ale praca pomocnika (~1,3 ms) wchodzi
  w drogę strony na ekran. Koszt: każdy moduł rozcięty na „obliczenia na SAB” i „wysyłkę” w workerze, drugi komplet luster,
  protokół na `Atomics`, pilnowanie zgodności z trybem `off` — projekt rzędu RW, tylko mniejszy.
- **Tańsze dźwignie najpierw** (§ 5): koszt modułów rośnie z liczbą WSZYSTKICH okrętów, nie tych w kadrze (2×V1 na
  podejściu: lustra 0,47 ms i dysze 0,29 ms przy 39 rysunkach). Rząd −0,5–1 ms bez nowego wątku.
- **Bitwa przy bazie piratów z planetoidą przy 5120 × 1440** (§ 6): szczyt 4,4–4,6 ms, tylko +0,1–0,2 ms wobec tej samej
  bitwy w pustce przy tych samych ustawieniach; skład ten sam (~56% własny JS). Przy 120 Hz worker ma zapas, spadki
  obrazu przy bazie idą ze strony (fizyka +0,6 ms na krok).

## 2. Metoda

- `scripts/profil-bitwy-flot.mjs --workerProf 1` (profil CPU workera renderu, próbki co 500 µs przez całą bitwę) + sonda
  klatki w workerze `scripts/webgpu/klatka-workera-sonda.js` (przez `--wkZdarzenia`): na każdą klatkę cała klatka workera
  (`globalThis.__rwFrameTimes` — lustra → bitmapa), `Core3D.renderSingle`, `renderer.render` / `renderer.compute` (czas
  i liczba wywołań), rysunki (`_renderObjectDirect`); to samo poza `renderSingle`. Odczyt `klatka-workera-odczyt.js`
  przed końcem bitwy (kubełki 5 s). Analiza `scripts/webgpu/klatka-workera-analiza.mjs`: okna w s od startu bitwy,
  moduły `renderPage`, podfazy `renderSingle`, kategorie liścia profilu — kod modułów (`src/`), maszyneria Core3D
  (`core3d.js`, `zbieraczZgloszen.js`, `tsl/kluczSwiatel.js`…), three (prebundel Vite `.tmp/vite-deps/deps/chunk-*.js`),
  API GPU (natywne `writeBuffer`, `setBindGroup`, `draw`…), wbudowane, GC.
- Headless Chrome bez limitu klatek (`startChrome` narzędzi), 1920 × 1080, preset z adaptera (RTX 5080), tryb gracza
  `?renderWorker=1`, `--seed 7`, bitwa 100 s. Klatka workera w headless bez limitu ≈ w oknie 240 Hz (audyt renderu
  § 7.1: p50 2,29 ↔ 2,32 ms). Maszyna: 7800X3D (8 wątków), przed przebiegami GPU 2–4%, CPU 11–25% (Razer); 0 obcych
  harnessów przed i po każdym przebiegu; gra użytkownika w Chrome zamknięta na czas pomiaru.
- Przebiegi: V1 `--sklad 50,20,10,3` przy zoomie 0,45 i 0,1; 2×V1 `--sklad 100,40,20,6` przy 0,45 — tu bitwa szybko
  wychodzi z kadru, więc szczyt workera wypada na podejściu flot.

```
node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3 --trwanie 100 --profile 999 --workerProf 1 --query renderWorker=1 \
  --zoom 0.45 --seed 7 --out <kat> \
  --wkZdarzenia "0@plik:scripts/webgpu/klatka-workera-sonda.js|92@plik:scripts/webgpu/klatka-workera-odczyt.js" > <kat>/przebieg.log
node scripts/webgpu/klatka-workera-analiza.mjs --profil <kat>/worker.cpuprofile --log <kat>/przebieg.log --szczyt 30 --funkcje 20
```

## 3. Wyniki (ms na klatkę workera)

| przebieg | okno | klatek/s | cała | `renderSingle` | przed renderem | rysunki / kl. | pod `_renderObjectDirect` | three + API GPU + Core3D | własny JS modułów | w tym lustra | własny JS w klatce efektów |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V1, zoom 0,45 | 5–25 s | 372 | 2,47 | 1,26 | 1,21 | 42 | 0,56 | 1,08 | 1,39 | 0,24 | 0,15 |
| V1, zoom 0,45 | **35–70 s (szczyt)** | 219 | **3,90** | 2,21 | 1,69 | 71 | 0,96 | 1,82 | **2,07** | 0,29 | 0,32 |
| V1, zoom 0,1 | 5–25 s | 325 | 2,90 | 1,34 | 1,55 | 41 | 0,57 | 1,16 | 1,73 | 0,22 | 0,16 |
| V1, zoom 0,1 | 40–70 s | 252 | 3,52 | 1,88 | 1,64 | 62 | 0,78 | 1,53 | 1,99 | 0,24 | 0,30 |
| 2×V1, zoom 0,45 | 0–30 s (podejście) | 228 | 3,52 | 1,50 | 2,01 | 39 | 0,61 | 1,20 | 2,21 | 0,47 | 0,17 |
| 2×V1, zoom 0,45 | 45–90 s | 249 | 2,38 | 1,22 | 1,15 | 33 | 0,50 | 0,98 | 1,39 | 0,48 | 0,14 |

Szczyt V1 (35–70 s) w `renderSingle`: passy sceny 1,12 ms (three 0,64, API GPU 0,26), klatka efektów 0,68 ms (własny JS
0,32, three 0,19, API GPU 0,13), macierze sceny 0,11, post 0,10, DIST 0,07, maska słońca 0,05; three `render()` 8 wywołań
na klatkę (1,20 ms), `compute()` 10,7 (0,32 ms). Poza `renderPage` worker stoi (idle) 0,5 ms na klatkę — w headless bez
limitu jest zajęty ~85% czasu. Kubełki 5 s w szczycie dochodzą do p95 5,8 ms (budżet 240 Hz: 4,17 ms).

## 4. Na co idzie własny JS (V1, zoom 0,45, 35–70 s, czas własny na klatkę)

Przed renderem (1,62 ms): dysze `updateEffects` (`engineVfxSystem.js`) 105 µs, lustra (`renderMirror.js` `_entity` 75,
`applyEntityPage` 67, `applyNozzles` 25, `und` 19; `mirrorBody.applyBodyPage` 34), `updateHexShips3D` 61, `renderPage` 49,
wieże `syncTurrets` 39, cząstki `fxParticles3D.update` 33, `weaponFx.sync` 28, struga MAIN `push` 25, `syncShipModels3D` 24,
`applyTurrets` 23, światła `buildNavLightClusters` 23 i `buildRoadLightWorldEmitters` 20, tarcze `processEntity` 23,
przegląd slotów strug `MainExhaust3D.jetCount` 22 (wołany co klatkę z `getStats` dla `DrawCallStats`, choć komentarz mówi
„pomiar i testy, nie w klatce”), skóry `writeQuads` 20 / `writeQuad` 18, `entityPose` 18. Po plikach: lustra i bloki
migawki ~0,32, `render.worker.js` 0,10, światła kadłubów 0,19, silniki (dysze, strugi MAIN i SIDE) ~0,29, kadłuby
(rekordy, pozy, skóry, cień SDF, pudło rysowania) ~0,25, modele i wieże ~0,08, cząstki 0,05, efekty broni 0,04, mostki,
tarcze, reaktory i stacje ~0,16 (część z nich ustawia obiekty three wprost — do sprawdzenia przy podziale; profil tego
nie rozróżnia, bo zapis pola obiektu liczy się jako własny kod).

W klatce efektów (0,32 ms): siatka świateł `lightGrid.build` 74 µs, rakiety (`stageLights`, `addMissiles`) ~26, pas
asteroid i mgła ~0,04 ms, siatka gazu 0,02.

## 5. Co dalej — ranking

1. **Koszt modułów od okrętów spoza kadru** (bez nowego wątku): lustra tylko encji zmienionych albo w pudle rysowania
   (0,24–0,48 ms — rosną z liczbą wszystkich encji), LOD dysz i świateł kadłubów poza kadrem (2×V1 na podejściu: dysze
   0,29 ms przy 39 rysunkach), `getStats` bez przeglądu 16 384 slotów strug co klatkę. Szacunek −0,3–0,6 ms w szczycie.
2. **Gorące pętle danych** — światła kadłubów (`shipLightRuntime` 0,15–0,27 ms), dysze (`updateEffects`), siatka świateł
   (0,07–0,1 ms): pomiar funkcji A/B w tej samej bitwie (`profil-bitwy-flot --wkAb`). Część z nich może pójść na GPU
   jak struga MAIN (0,25 → 0,004 ms) — kosztem GPU, który przy 5120 × 1440 też jest blisko budżetu (audyt renderu § 7.4).
3. **Pomocnik bez GPU** — dopiero gdy 1–2 nie wystarczą: najpierw kadłuby i silniki (największy blok danych, wejście
   z luster encji), schemat fork-join (bez dodatkowego opóźnienia), wynik w SAB, wysyłka w workerze.

## 6. Bitwa przy bazie piratów i planetoidzie, 5120 × 1440 (2026-11-02, prośba użytkownika)

Użytkownik: „powtórz bitwę, ale inna scena — dodaj budynki i planetę piratów z pierwszej misji, 5120 × 1440”, przebieg
w widocznym oknie. `profil-bitwy-flot.mjs --scena baza` (skok dev `?story=shipyard`: 21 kawałków bazy na silniku belek,
obwiednia 9,7 × 13,6 km, 35 okrętów stoczni, planetoida Hidalgo w passie tła; Atlas nieśmiertelny 9,5 km na południe
od bazy, oś bitwy wschód–zachód, kamera RTS), ta sama flota V1, `--okno 1` (pełny ekran z vsync), `?grafika=ultra`
(skala renderu 1,25 — bufor 6400 × 1800), zoom 0,1. Porównanie: ta sama bitwa w pustej przestrzeni w identycznych
warunkach. Monitor użytkownika (Odyssey G93SD) był ustawiony w Windows na 120 Hz (`CurrentRefreshRate 120`, maks. 240),
więc okno szło w takcie 120 Hz — budżet klatki 8,33 ms.

| scena | okno | obraz / s | cała | p95 kubełków | `renderSingle` | przed renderem | rysunki / kl. | pod `_renderObjectDirect` | three + API GPU + Core3D | własny JS | lustra | JS w klatce efektów |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pustka | 5–25 s | 120 | 3,21 | 4,15 | 1,48 | 1,73 | 51 | 0,65 | 1,26 | 1,92 (60%) | 0,22 | 0,19 |
| baza | 5–25 s | 120 | 3,39 | 4,53 | 1,67 | 1,72 | 63 | 0,82 | 1,47 | 1,90 (56%) | 0,28 | 0,13 |
| pustka | 40–70 s | 119 | 4,28 | 6,06 | 2,23 | 2,05 | 69 | 0,91 | 1,84 | 2,42 (57%) | 0,25 | 0,34 |
| baza | 40–70 s | 113 | 4,40 | 7,04 | 2,28 | 2,12 | 73 | 1,03 | 1,95 | 2,45 (56%) | 0,31 | 0,26 |

Z próbek PerfHUD (średnie okien): przed bitwą CPU workera 0,84 ↔ 1,16 ms, GPU workera 0,98 ↔ 1,33 ms (pustka ↔ baza);
w szczycie GPU 3,66 ↔ 3,62 ms, fizyka na krok 3,01 ↔ 3,63 ms, okręty 120 ↔ 149 (z 35 okrętami stoczni), wraki 49 ↔ 55,
pociski 394 ↔ 451.

- **Baza i planetoida prawie nie zmieniają klatki workera**: +0,1–0,2 ms (+3–6%) i +4–12 rysunków w bitwie, +0,3 ms przed
  bitwą (skóry ciał świata, planetoida i osada w passie tła, okręty stoczni). Klatkę dalej wyznacza bitwa, a skład
  zostaje ten sam: własny JS ~56%, rysunki three ~1 ms.
- Przy 5120 × 1440 widać ~2,7 × szerszy kadr przy tym samym zoomie: w pustce szczyt 4,28 ms wobec 3,52 ms przy
  1920 × 1080 (§ 3). Dochodzi praca na kadłubach w kadrze — skóry belek (`beamHullSkin.writeQuad` 66 µs, `hullSkinBatch.writeQuads`
  51 µs, `updateBeamSkinMesh` 33 µs), cień SDF (`hullShadowSdf` ~0,05 ms), światła kadłubów 0,30 ms.
- Przy 120 Hz worker ma zapas (szczyt 4,4–4,6 ms z 8,33 ms, w workerze ~4,4 ms bezczynności na klatkę). Spadki obrazu
  w szczycie przy bazie (101–113 obrazów / s zamiast 120) idą ze STRONY: worker czeka na wiadomość strony (13,6 / s
  w 50. s), wywołanie pętli gry p50 5,5 ms, p95 7,8 ms — fizyka przy bazie +0,6 ms na krok (35 okrętów stoczni, budowle
  w silniku belek, więcej pocisków). Przy 240 Hz (4,17 ms) szczyt workera 4,3–4,6 ms by się nie mieścił — tam limitem
  byłby worker.

Narzędzie: `node scripts/profil-bitwy-flot.mjs --scena baza --okno 1 --szer 5120 --wys 1440 --sklad 50,20,10,3 --trwanie 100
--profile 999 --workerProf 1 --query "renderWorker=1&grafika=ultra" --zoom 0.1 --seed 7 --out <kat> --zrzuty 3,50,86
--wkZdarzenia "0@plik:scripts/webgpu/klatka-workera-sonda.js|92@plik:scripts/webgpu/klatka-workera-odczyt.js" > <kat>/przebieg.log`.

Nie zmierzono: skala renderu 100% przy Ultra (ustawienie użytkownika według audytu renderu § 7.2) — tu 1,25 z presetu;
CPU workera to nie zmienia, GPU jest o tyle cięższe. Takt 240 Hz w oknie — monitor stał na 120 Hz.
