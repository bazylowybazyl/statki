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

## 7. Tańsze dźwignie (2026-11-02, sesja „klatka workera pod 240 Hz”)

Zadanie: klatka workera w bitwie V1 przy 5120 × 1440 (Ultra, zoom 0,1, okno 240 Hz) śr. ≤ 3 ms i p95 ≤ 4 ms, bez zmiany
obrazu i bez pipeline'ów synchronicznych; najpierw dźwignie z § 5 pkt 1 (lustra, LOD dysz i świateł, `getStats`, zapisy
skór), dopiero potem dane per okręt na GPU albo pomocnik bez GPU. Monitor stał na 240 Hz (`CurrentRefreshRate 240`), maszyna
bez gier i obcych harnessów (GPU 1%, CPU 13%). **Wynik: −0,2 ms (−6%) w porównywalnym oknie 5–25 s (3,22 → 3,01 ms),
w szczycie ~3,3–3,9 ms zamiast 4,3 (okna szczytu różnią się między przebiegami liczbą rysunków — niżej), p95 bez zmiany
rzędu (4,0 → 3,8 w 5–25 s; w szczycie 5–7). Cel 3 ms / 4 ms NIEOSIĄGNIĘTY tanimi dźwigniami** — klatka to długi ogon
funkcji po 10–120 µs (żadna nie dominuje) i three / API GPU (~45%); co dalej — § 7.4.

### 7.1 Skład klatki przed zmianami (diagnostyka `klatka-workera-diag.js`, headless, 30–93 s bitwy)

Nowe narzędzie `scripts/webgpu/klatka-workera-diag.js` / `-odczyt.js` (`--wkZdarzenia`) liczy na klatkę: rysunki po nazwie
obiektu i materiału, wywołania `render` po masce warstw i celu, listy `compute` po nazwach kerneli, `writeBuffer` po
etykiecie bufora, pudła (encje w pudle rozgrzania / rysowania), LOD dysz MAIN, dysze klatki, światła siatki, wypieki
cienia SDF, czworokąty skór kopiowane do partii, obiekty sceny i najwolniejsze klatki ze składem.

- 61–65 rysunków na klatkę, każdy inny obiekt: 9 partii skór (typ kadłuba × frakcja + Atlas), 8 rodzin wież, 6 rysunków
  reaktorów (struktura / cień / plazma × 2 frakcje), 3 płaty mgły pasa, niebo 3, rakiety 4 (+ pass gęstości dymu), tarcze
  3, pył 2, strugi MAIN i SIDE, lampy pozycyjne, bronie, iskry, mostek, maska słońca, post. 8 `render()` na klatkę
  (tło, znaczek głębi skał gry, ortho, FG, tarcze, DIST, gęstość dymu rakiet, mapa cienia, post) i 9–11 `compute()`
  (44–54 kerneli: bloom + szum mgły jedną listą 13, gaz wybuchów po 22–48, bronie 1–6, rakiety 1–3, tarcze, pas, mapa ran).
- **242 `writeBuffer` na klatkę (525 KB)**: ~130 to sloty lamp kadłubów (`HullLightStore.markDirty` → `addUpdateRange` na
  slot; podpis payloadu zmienia się co klatkę, bo światła innych okrętów jadą względem kadłuba, a three wysyła KAŻDY
  zakres osobnym wywołaniem), ~60 to czworokąty skór w partiach (zakres na kadłub na atrybut), reszta — bufory uniformów
  rysunków (etykiety `bindingBuffer…`), siatka świateł, pule efektów.
- Okręty: 167–172 w pudle rozgrzania (0 odrzuconych), 18–38 tylko w pudle rozgrzania (poza kadrem), 107–130 kadłubów ze
  skórą (reszta smugi); dysz MAIN 300–450, SIDE 230–290 (świateł SIDE 46–64 przy limicie 64); świateł siatki 344–470
  (2,7–3,4 tys. wpisów komórek); lampy pozycyjne 512 (limit). **LOD strug MAIN za kadrem w workerze nie działał**
  (`MainLodStats.offBox = 0`): `prepareMainLod` czyta kamerę z `RenderWorld.camera`, a worker jej nie wystawiał
  (`globalThis.camera` puste) — ten sam brak gasił kierunek słońca odłamków (`hullDebris3D`) i tempo pasm olbrzymów
  gazowych z zoomu.
- Scena workera: 812–942 obiektów (560 siatek, 495–581 widocznych, 771–891 z `matrixAutoUpdate`), `_syncSceneMatrices`
  0,10–0,13 ms; największe poddrzewa niewidoczne (ring Ziemi 102 obiekty, ring Halo 81, bitwa w głębi, luk Atlasa) —
  pominięcie ukrytych gałęzi odrzucone już w § 7.1 audytu renderu (trzymacze rozgrzewki).
- Wypiek cienia SDF: 2,8–3,4 ms na wypiek (raster + EDT 256² + brzeg + wgranie warstwy), co ~100 klatek przy ostrzale —
  klatki 6,5–9 ms; najwolniejsze klatki 9–13 ms bez wypieku (GC, rozkazy wybuchów). Przy budżecie 240 Hz liczy się
  jednak masa: w szczycie 16% klatek 4–5 ms i 3% 5–6 ms (histogram diagnostyki), nie pojedyncze piki.
- Rozbicie `updateHexShips3D` (profil, szczyt 35–70 s, czas łączny na klatkę): dysze `EngineVfxSystem.update` 0,38 ms
  (`updateEffects` własny 0,12, `MainExhaust3D.push` 0,06, `resolveSlotForward` 0,04, SIDE 0,03, `getEngineVfxClassScale`
  0,02), `updateBeamSkinMesh` 0,30 (światła payloadu 0,13: `buildCombinedShipLightShaderPayload` 0,09 — własne 0,02,
  najbliższe emitery / grupy 0,03, pakowanie 0,02; zapis skóry 0,10), `WeaponFx.sync` 0,08, grupy lamp 0,06, emitery
  0,05, billboardy lamp 0,05, wypieki SDF 0,04, indeks świateł 0,02. Klatka efektów (0,73 ms): wybuchy 0,16 (gaz), rakiety
  0,24 (gęstość dymu 0,06, światło 0,04, krok 0,05, rakiety / poświaty / światła 0,06), pas 0,12 (światła statków 0,05),
  tarcze 0,06 (compute), siatka świateł `build` 0,04–0,07, bronie 0,07. Passy sceny: `renderer.render` 1,1 ms (~65 rysunków
  po ~13 µs + 8 renderów po ~35 µs), `HullObjectStore.commit` 0,10 (92 liczby na kadłub na klatkę, 130 kadłubów).

### 7.2 Zmiany (każda bez zmiany obrazu; A/B w tej samej bitwie tam, gdzie jest przełącznik)

1. **`MainExhaust3D.getStats` bez przeglądu 16 384 slotów** (`jetCount` tylko do pomiarów) — −30 µs na klatkę.
2. **Macierz nośnika skóry kadłuba wprost** (`updateBeamSkinMesh`: cos / sin, skala, przesunięcie do `matrixWorld`;
   `matrixAutoUpdate = false`, bez `rotation.set` → `setFromEuler` → `compose` na kadłub na klatkę) — `setFromEuler`
   22 µs → 0; `HullObjectStore.commit` pisze dla kadłuba niewidocznego (smuga, poza kadrem — ~60 ze 170) samą flagę
   widoczności (self 71 → ~52 µs). Kandydaci cienia SDF: test zasięgu przed siatką cienia i wymiarami, rekordy z puli.
3. **Lustra**: listy pochodne (SEEN ⊂ RENDER, NPCS_SEEN ⊂ NPCS…) biorą gotowe lustro bez drugiego wejścia w `_entity`
   (~5 wejść na encję na stronę → 1).
4. **Kamera gry w workerze** (`globalThis.camera` = kamera bez wstrząsu strony, `renderPage`): LOD strug MAIN za kadrem
   działa (diagnostyka po zmianie: 96 ze 400 dysz MAIN poza pudłem rysowania, 47 bez strug na klatkę); odłamki dostają
   kierunek słońca, olbrzymy gazowe tempo z zoomu — obraz workera jak w `off`. A/B `MainExhaust3D.offscreenLod = false`
   w tej samej bitwie (kanapki 4 s, n = 3): bez LOD +0,025 ms CPU klatki (p50).
5. **Światła kadłubów bez alokacji** (`shipLightRuntime.js`: scratche pozycji / skal / kierunków, rekordy emiterów, grup
   i billboardów z puli per tablica `out`, pakiety zewnętrzne z pierścienia, id i hasz z pamięci rekordu źródła) — ~9 tys.
   obiektów na klatkę mniej, ale **bez mierzalnego zysku w średniej** (self budowniczych 17–24 µs przed i po; V8 alokuje
   tanio, koszt siedzi w arytmetyce i odczytach pól); zostaje dla GC (0,02–0,05 ms na klatkę).
6. **Siatka świateł**: pudło wycinka reflektora z końców łuku (obrót osi o ±połowę kąta z cosinusa stożka) i kierunków osi
   układu w wycinku zamiast 9 próbek łuku z `cos` / `sin` — nadzbiór dawnych pudeł (te same komórki lub więcej, światło
   poza zasięgiem daje 0 → obraz bit w bit); `build` 62–66 → 37–44 µs.
7. **Skóry kadłubów**: żar narożników z pamięci na jeden zapis skóry (`heatOf`, epoka — exp() raz na węzeł zamiast na
   każde odwiedziny narożnika, ~12 na czworokąt), partia kopiuje pozycje blokiem (`set`).
8. **Dysze**: skala klasy kadłuba z pamięci per encja (`entityClassScale` — `resolveEntityHullProfileId` z napisem typu
   małymi literami szedł na okręt na klatkę: 22 µs), dawny wygląd hipercruise'u i statek gracza raz na klatkę w `frameCtx`,
   `Math.hypot` → `sqrt`.
9. **Scalanie zakresów wysyłki** (`scalZakresy` w `zakresyWysylki.js`: po posortowaniu zakresy oddalone o < 8192 liczb
   jednym `writeBuffer`; `HullLightStore.commit`, `HullSkinBatch.flushRanges` z `syncSkinBatches`): `writeBuffer`
   242 → ~130 na klatkę. A/B `ZAKRESY_AB.scal = false` w tej samej bitwie (kanapki, n = 4): **CPU klatki −0,01 ms (szum),
   klatka GPU −0,10 ms** — zysk jest po stronie procesu GPU i karty, nie wątku workera.

### 7.3 Pomiary (RTX 5080, 7800X3D, okno 240 Hz 5120 × 1440, Ultra 1,25, bitwa 100 s, seed 7)

Okna tej samej bitwy w różnych przebiegach różnią się intensywnością (liczba rysunków 59–69, wraki, pociski) — dlatego
liczby „przed / po” obok liczby rysunków, a przełączniki osobno przez `--wkAb` (§ 7.2 pkt 4 i 9). Headless (bez limitu
klatek) daje te same czasy klatki co okno (§ 2), ale inne tempo stron.

| przebieg | okno | klatek / s | cała klatka śr. | p50 | p95 kubełków 5 s (maks. / śr.) | `renderSingle` | rysunki / kl. |
|---|---|---|---|---|---|---|---|
| baza (a9693758), okno | 5–25 s | 238 | 3,22 | 3,16 | 4,04 / 3,72 | 1,53 | 50,2 |
| baza, okno | 35–70 s | 197 | 3,55 | 3,45 | 5,83 / 4,31 | 1,83 | 62,2 |
| baza, okno | 65–95 s (szczyt) | 124 | 4,33 | 4,13 | 7,33 / 5,83 | 2,28 | 69,1 |
| po zmianach, okno, przebieg A/B (¾ okien z włączonym wszystkim) | 5–25 s | 237 | 3,01 | 2,94 | 3,83 / 3,52 | 1,44 | 49,5 |
| po zmianach, okno, przebieg A/B | 35–70 s | 150 | 3,86 | 3,64 | 6,07 / 5,09 | 2,03 | 68,9 |
| po zmianach, okno, przebieg A/B | 65–95 s | 170 | 3,32 | 3,15 | 4,96 / 4,27 | 1,83 | 63,9 |
| po zmianach, headless (etap 3) | 5–25 s | 263 | 2,98 | 2,91 | 3,85 / 3,45 | 1,40 | 45,8 |
| po zmianach, headless (etap 3) | 35–70 s | 216 | 3,36 | 3,24 | 4,68 / 4,22 | 1,82 | 59,1 |
| po zmianach, headless (etap 3) | 65–95 s | 140 | 4,32 | 4,11 | 7,76 / 6,05 | 2,38 | 67,7 |
| **po zmianach, okno (końcowy)** | 5–25 s | 239 | **3,10** | 3,04 | 3,88 / 3,61 | 1,53 | 47,7 |
| po zmianach, okno (końcowy) | 35–70 s | 184 | 3,64 | 3,52 | 6,08 / 4,49 | 1,95 | 61,5 |
| po zmianach, okno (końcowy) | 65–95 s | 137 | **4,07** | 3,91 | 5,63 / 5,26 | 2,23 | 67,9 |
| po zmianach, okno (końcowy) | 60–90 s (szczyt 30 s) | 148 | 4,14 | — | 6,09 / — | 2,25 | 68,1 |

Przy tej samej liczbie rysunków: 5–25 s −0,12 ms (−4%), szczyt −0,26 ms (−6%), 35–70 s bez zmiany (szum ±0,1).
Skład końcowy w szczycie (60–90 s, profil): `renderSingle` 2,25 (passy sceny 1,12 — `renderer.render` 1,25 ms z sondy
dla 8 renderów i 68 rysunków; klatka efektów 0,71; macierze 0,12; post 0,11; DIST 0,07; maska 0,05), przed renderem 1,89
(`updateHexShips3D` 1,06, lustra 0,26, modele i wieże 0,14, mostki 0,07, reaktory 0,05, tarcze 0,05, rozkazy 0,05);
po plikach: światła kadłubów 0,30, lustra 0,23, dysze 0,20 + 0,06, `hexShips3D` 0,16, worker 0,11, modele 0,11, skóry 0,07.
Wywołań `writeBuffer` 135 na klatkę (było 242), dysz MAIN 367 (66 poza pudłem rysowania, 24 bez strug), świateł siatki
444 (3,5 tys. wpisów), kadłubów ze skórą 119, smug 15.

A/B przełączników w TEJ SAMEJ bitwie (okno 240 Hz, 100 s, kanapki 4 s):
`node scripts/profil-bitwy-flot.mjs --okno 1 --szer 5120 --wys 1440 --sklad 50,20,10,3 --trwanie 100 --profile 999
--workerProf 1 --query "renderWorker=1&grafika=ultra" --zoom 0.1 --seed 7 --out <kat> --wkAb "plik:baza.js|plik:scal0.js|plik:baza.js|plik:lod0.js"
--wkZdarzenia "0@plik:scripts/webgpu/klatka-workera-sonda.js|96@plik:scripts/webgpu/klatka-workera-odczyt.js"` — pliki
wyrażeń: `(async () => { const z = await import('/src/3d/zakresyWysylki.js'); z.ZAKRESY_AB.scal = …; const m = await
import('/src/3d/mainExhaust3D.js'); m.MainExhaust3D.offscreenLod = …; })()`. Warianty (cała klatka p50 / śr. / p95):
wszystko 3,12 / 3,32 / 4,61 i 3,12 / 3,31 / 4,51; bez scalania 3,14 / 3,30 / 4,40 (kanapki n = 4: CPU −0,01, klatka GPU
+0,10 ms); bez LOD strug 3,21 / 3,37 / 4,52 (n = 3: CPU +0,025, GPU −0,10 — szum pomiaru GPU co 8 klatek).

Obraz: `zrzuty.mjs --backend webgpu --sceny bitwa,bitwa-blisko,wraki,wybuch,pas-pole,pas-noc --uuid osobne` — baza z worktree
a9693758 (`--root`) kontra nowy kod: 0% pikseli > 2/255 w każdej scenie i warstwie (maks. różnica 0–1/255), pipeline'y
synchroniczne 0 (harness w trybie `off`; w workerze dochodzi kamera gry — LOD strug i światło odłamków jak w `off`).
Testy: `node --test "tests/*.test.mjs"` — 3693 / 3699 (2 TODO rdzeni, 3 pominięte); nowe testy `scalZakresy`,
`HullSkinBatch.flushRanges`, strażnik macierzy nośnika w `hullSkinBatch.test.mjs`.

### 7.4 Dlaczego nie 3 ms i co dalej

Tanie dźwignie z § 5 pkt 1 dały ~5%, bo klatka nie ma dominanty: w szczycie ~45% to three i API GPU (65–70 rysunków
po ~13 µs, 8 renderów po ~35 µs, 10–11 list compute po ~30 µs, wysyłki), a ~1,8 ms kodu modułów rozkłada się na ~60
funkcji po 10–120 µs (największe: `updateEffects` 0,12 własnego, lustra `_entity` + `applyEntityPage` 0,12, wieże 3D
`syncTurrets` 0,07, światła kadłubów ~0,3 w sumie, skóry 0,07–0,17 przy ostrzale). Alokacje nie ważą (pkt 5); LOD poza
kadrem dotyczy przy zoomie 0,1 tylko ~20% okrętów (pudło rysowania 51 × 14 km obejmuje bitwę). Ranking następnych
kroków (szacunki z profilu końcowego):

1. **Mniej rysunków i renderów** (−0,3–0,5 ms, bez zmiany obrazu, każdy to osobny projekt): partie skór przez tablicę
   tekstur / atlas sprite'ów (9 → 1 rysunek; obrazy kadłubów różnych rozmiarów), rodziny wież 3D w jednym rysunku
   (8 → 1–2: wspólna geometria z zakresami per rodzina), reaktory bez podziału na frakcje (6 → 3: paleta w atrybucie
   instancji), płaty mgły pasa (3 → 1), pass gęstości dymu rakiet razem z passem światła dymu. Każdy rysunek three r183
   to ~13 µs CPU (`Bindings._update` po wszystkich wiązaniach grupy obiektu) + praca procesu GPU.
2. **Dane per okręt na GPU** (−0,2–0,3 ms): wybór świateł zewnętrznych kadłuba (K najbliższych emiterów i grup —
   `buildCombinedShipLightShaderPayload`, pakowanie, zapis slotu: ~0,15 ms + 130 zakresów wysyłki) jako kernel po
   kadłubach × światłach (170 × 450 testów) ze stabilnym remisem po indeksie jak CPU (parzystość do sprawdzenia bit w
   bit — f32 kontra f64 na granicy zasięgu); pozycje dysz MAIN / SIDE w świecie z pozy okrętu w kernelu (dziś CPU liczy
   je dla 370 + 270 dysz na klatkę, a potem jeszcze raz dla świateł, gorącego powietrza i poświaty na pyle).
3. **Dysze w rytmie fizyki** (−0,15 ms): `updateEffects` (ciąg, moc, LOD, haze, światła) raz na krok fizyki (60 Hz,
   zmiana `physicsTickId`), na każdą stronę tylko transformacja wylotów pozą renderu do wierszy właścicieli strug,
   `EngineFrame` i źródeł gorącego powietrza — rampy mocy dają ten sam wynik dla stałego celu między krokami, flicker
   próbkowany co krok (obraz: faza migotania strugi co 1/60 s zamiast co stronę).
4. **Lustra**: encje poza pudłem rysowania (20–40) tylko poza i flagi (−0,03); pola poziomu B (wymiary, kody) tylko gdy
   strona je odświeżyła (bit w `FLAGS2` z pakującego, −0,02).
5. **p95 / p99**: wypiek cienia SDF rozłożony na dwie klatki (raster + EDT kolumn w jednej, EDT wierszy + brzeg +
   wgranie w następnej; cień damage'u o klatkę później) — zdejmuje klatki 6,5–9 ms przy ostrzale; sortowanie 168
   kandydatów cienia co stronę (`updateHexShips3D` własny 0,04–0,08) zamiast raz na krok fizyki.
6. **Pomocnik bez GPU** (§ 1, ~1,0–1,2 ms do przejęcia w szczycie) — dopiero po 1–3, bo przejmuje właśnie te moduły;
   po nich zostaje mu ~0,6–0,8 ms.

Sprawdzone, odrzucone albo bez zysku w tej sesji: usuwanie alokacji świateł (pkt 5 — bez zysku w średniej);
pominięcie ukrytych gałęzi w `_syncSceneMatrices` (ring Ziemi 102 obiekty, ring Halo 81 — ~0,04 ms; odrzucone w § 7.1
audytu renderu przez trzymacze rozgrzewki: macierz świata skompilowana w ukryciu z innym wyznacznikiem = pipeline w
klatce; bezpieczna wersja wymaga znacznika „macierz policzona po ustawieniu” na obiekcie); porównania okien różnych
przebiegów tej samej bitwy (seed 7) — chaos daje ±0,5 ms, rozstrzyga tylko `--wkAb`.
