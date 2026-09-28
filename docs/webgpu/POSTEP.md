# Port WebGPU — postęp

> Plik ciągłości między sesjami. Każda sesja zaczyna od niego i kończy na nim:
> co zrobione, commit, co dalej. Stan zadań portu — tabela „Zadania portu”; świadome regresje
> przejściowe — sekcja niżej; dziennik sesji na końcu. Jak prowadzić zadania: `README.md`.

## Decyzje użytkownika (obowiązują cały port)

| Data | Decyzja |
|---|---|
| 2026-09-27 | **Jedna ścieżka renderu: WebGPU + TSL, GLSL usuwamy** (zmiana `PROMPT-START.md`, zasada 2). Bez dwóch równoległych ścieżek do końca portu. |
| 2026-09-27 | **Praca na `main`** (zasada 7); użytkownik ma lokalny backup (rar). |
| 2026-09-27 | **Warp poza portem** — stara soczewka do wyrzucenia, nowy warp (`dema/warp-demo.html`) wejdzie później od razu w TSL (`PROMPT-START.md` § Warp, `USTALENIA.md` §7). |
| 2026-09-27 | **Asteroidy poza portem** — nowe są gotowe w `dema/asteroidy.html` (i demo WebGPU `dema/asteroidy-webgpu.html`), więc starych nie przenosimy. |
| 2026-09-27 | **Stare pole asteroid WYŁĄCZONE w całości na czas portu** (rozgrywka i wygląd; odpowiedź na pytanie w Fazie 0). Wdrożone: `OLD_ASTEROIDS_ENABLED` w `index.html` (przy tworzeniu `AsteroidField` / `AsteroidBeltBackdrop`), `?asteroidyStare` przywraca je (pełny obraz tylko na tagu — na `main` od zadania 01 ich materiały są zamiennikami). Wszystkie haki gry znoszą brak pola. |
| 2026-09-27 | **Dema spoza gry zostają na tagu `webgl-baseline`** (odpowiedź na pytanie w Fazie 0): port obejmuje to, co ładuje gra, plus warsztaty przenoszonych modułów (`halo_ring_demo`, `mostki-demo`, `rdzen-demo`). `warp-demo`, `asteroidy.html`, `budowle-portowe` (Z7), `kontenery` (Z5), `scripts/proxy-batch` (Z4), `destruktor2d/3d` działają z tagu (osobny worktree); warp, nowe asteroidy i moduły Z4/Z5/Z7 przechodzą na TSL przy swojej integracji. |
| 2026-09-27 | Z listy zadań wypadły: Electron i build produkcyjny oraz przełączenie domyślnego backendu / polityka awaryjna (zmiana `PROMPT-START.md`). |
| 2026-09-27 | **Odpowiedzi na pytania planu (PLAN §12):** usuwać nieużywany kod, „przechodzimy w pełni na WebGPU”; **tylko WebGPU** (bez zapasu WebGL2 — komunikat); `modelBaker.js` usunąć; bez pushowania (użytkownik ma kopię na bieżąco, nie sprawdza po drodze); inne sesje skończyły — port prowadzi jedna sesja (z podagentami); **obrażenia i mechanika broni z dema wchodzą do rozgrywki** (mapa ran, przebicia, rykoszety, ładowanie, serie — zadanie 18); demo fizyki belek na GPU — później; warp czeka na poprawiony „Nurt” (osobna sesja). Cel końcowy: gra działa na WebGPU z nowymi brońmi, rakietami i ringiem. |
| 2026-09-27 | **Asteroidy i warp też wchodzą** („asteroidy zaraz będą production ready — zielone światło”, „warp też będzie ready do wgrania, jak skończy sesję”): zadania 21 (asteroidy z `dema/asteroidy-webgpu`) i 22 (warp „Nurt” z `dema/warp-webgpu`) po zakończeniu sesji dem; wydajność → 23, sprzątanie → 24. **Praca samodzielna do końca** („zostawiam ciebie samopas, od teraz rządzisz”); po wdrożeniu wszystkiego (WebGPU w grze, bronie, rakiety, asteroidy, warp, ringi) — **wyłączyć komputer** (po sprawdzeniu, że wszystko zacommitowane, a inne sesje bezczynne). |
| 2026-09-28 | Użytkownik wrócił rano: **„nie wyłączaj kompa — już wróciłem i pracuję”** — polecenie wyłączenia komputera po porcie odwołane. |
| 2026-09-27 | **Nowe efekty broni i rakiet wchodzą przy porcie** (po obejrzeniu dem: „bronie — wszystkie super”, „rakiety — super”, „można je śmiało wdrażać przy okazji skoku na WebGPU”): efekty z `dema/bronie-webgpu` i `dema/rakiety-webgpu` zastępują stare efekty broni, trafień, iskier, rakiet i Supernowej zamiast portu 1:1. Plan przebudowany: 12 = infrastruktura efektów, 17–18 = broń, 19 = rakiety, 20 = koniec overlaya (22 zadania). Rozgrywka bez zmian. |

## Faza 0 — kroki

| Krok | Co | Status | Commit |
|---|---|---|---|
| 1 | Rozpoznanie (agents.md, USTALENIA, core3d.js, narzędzia CDP) | zrobione | — |
| 2 | Środowisko + testy bazowe | zrobione | (commit kroków 2–4) |
| 3 | Spike techniczny (`dema/webgpu-spike.*`, `SPIKE.md`) | zrobione — 17/17, bez blokad | (commit kroków 2–4) |
| 4 | Inwentarz (`scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md`) | zrobione | (commit kroków 2–4) |
| 5 | Harness zrzutów + baza WebGL (`zrzuty.mjs`, `porownaj.mjs`, `baseline.json`) | zrobione — 48 zrzutów, szum ≤ 0,03% (>2/255), 0% (>8); tag `webgl-baseline` | (commit kroku 5) |
| 6 | Plan i zadania (`PLAN.md`, `zadania/NN-*.md`, `README.md`, sekcja w `agents.md`) | zrobione — 24 zadania (po decyzjach o nowych efektach, asteroidach i warpie) | 30e76b9 + przebudowa |
| 7 | Raport dla użytkownika | zrobione (w rozmowie); zadanie 01 czeka na zgodę | — |

## Zadania portu

Pliki: `zadania/NN-*.md`; kolejność i uzasadnienie: `PLAN.md` §9. Status: `czeka` → `w toku (sesja, data)` →
`zrobione` (commit). „Równolegle z” = rozłączne pliki, każda równoległa sesja we własnym worktree (`README.md`).

| # | Zadanie | Zależy od | Równolegle z | Effort | Status | Commit | Uwagi |
|---|---|---|---|---|---|---|---|
| 01 | Fundament: `WebGPURenderer` w Core3D, zamienniki, adapter uniformów, harness na WebGPU | — | nie | max | zrobione, scalone (159dd42) | fca136a, b9c95d2, be4ea80 | gra na WebGPU; magenta = nieprzeniesione; harness `--uuid osobne` + nowa baza (dziennik) |
| 02 | Post 1/2: bloom, pełny „uber”, pre-pass halo, MSAA, kalibracja tolerancji | 01 | 06 | max | zrobione, scalone (eb9370b) | a72b8fa, 777f86b, 77eef2b | `tolerancjaPortu` >8/255 ≤ 0,05%, średnia ≤ 0,03; `BloomNode` ×3 (zgodność z `UnrealBloomPass`); bloom ~1 ms CPU → 23 |
| 03 | Post 2/2: maska słońca, SDF kadłubów, refrakcja, fala uderzeniowa | 02 | 06 | max | zrobione, scalone (f487d2f) | 5adc702, 65d92a2 | maska = baza WebGL w grze (`maska-slonca.mjs`: maks. 5/255 na 2 pikselach); zastępnik z 04 podmieniony; SDF: wgrywanie jednej warstwy zamiast 4 MB |
| 04 | Kadłuby (belki + heksy), lakier, impostory, szczątki | 03 | 05–14, 16, 19 | max | zrobione, scalone (f7c3c77, poprawka 9841cbf); maska słońca = zastępnik `// AGENT: po 03` w `hexShips3D.tsl.js` (podmienia 03) | 3adcc5c, 7599a42 | graf na wariant (spawn 30 NPC 14 ms zamiast 389); haki `hullDamageSurface/Heat`, `hullEffectLights` (18), `hullVolume` (21) |
| 05 | Planety, słońce, mgławica, gwiazdy, stacje | 03 | 04, 06–10, 12–20 | xhigh | zrobione, scalone (2245c90) | b6eb4f3, 40224bb, 24d31b2 (scalenia `main` c0bc1d0, 970e800, 70551cb) | graf TSL na rodzaj ciała; gwiazdy = kwadraty instancjonowane; rozciąganie w skoku 1:1; `planeta-cien` przyjęte (poza progiem tylko szum stacji Wenus i kropkowany łuk bazy WebGL) |
| 06 | Ring 1/5: biblioteka TSL, pieczenie map, odczyt asynchroniczny, `halo_ring_demo` | 01 | 02–05, 12–20 | max | zrobione, scalone (070a407) | b7ecdc9…88d8df5 | kończy przejściową regresję terenu ringu z 01 |
| 07 | Ring 2/5: teren + zestaw przemysłowy | 06 | 04, 05, 12–20 | xhigh | zrobione, scalone (f735076) | 7b43733…96baa16 | |
| 08 | Ring 3/5: struktura + atmosfera | 07 | j.w. | xhigh | zrobione, scalone (979ed52) | 2c87915…fa8389b (scalenie `main` 60c7e4c) | nowe sceny bazy `ring-dach`, `ring-dach-z01`, `ring-habitat` (dopisane z tagu) |
| 09 | Ring 4/5: megastruktura + miasto (kopuły, landmarki, drzewa) | 08 | j.w. | xhigh | zrobione, scalone (ab3c820) | 5e3a666, 09e4b09, 8b915ed (scalenia `main` 7ac8d07, 11aaa9e, eb3d21d) | `haloFma` (fma WGSL = `mad` FXC): ziarna i hasze brył bit w bit; `wgslFn` wyjątkowo (TSL r183 nie ma `fma`) |
| 10 | Ring 5/5: K-7 + ringi-archetypy Marsa i Jowisza | 09 | j.w. | xhigh | zrobione, scalone (3794883) | 09b532c, f4d4bb5 (scalenie `main` 6092010) | ring bez zamienników i bez GLSL (poza `haloRingGLSL.js`: menu 11, Z7, narzędzie parzystości); K-7 = graf na ring; partie archetypów = Mesh + InstancedBufferGeometry; `haloFmaVec2` |
| 11 | Tło menu + rozgrzewka pipeline'ów | 05, 10 | 12–20 | max | zrobione, scalone (d62e275) | e58fc42…eeedba3 (scalenia `main` 9ebe362, e5cbe53, 80332bd) | tło menu w TSL (0 zamienników); rejestr `Core3D.warmup`; menu gotowe 11,6 → 7,7 s, przestój menu 2,9 → 0,13 s, 1. klatka gry 330 → 244 ms |
| 12 | Infrastruktura efektów GPU: compute w klatce, siatka świateł, zniekształcenia, Fx3D w TSL | 03 | 04–11, 13–16 | max | zrobione, scalone (12-A: moduły `src/3d/fx/`; 12-B: 72ec255 — wpięcie w Core3D, Fx3D w TSL) | 0f3d429…37953a6 (12-A); 819fd85, 0c67d84, ebc4211, a029a03, 59e0571, 7168783 (12-B) | podstawa pod 17–19 (i przyszłe asteroidy) |
| 13 | Silniki: MAIN, WARP (plazma), SIDE | 03 | 04–12, 14–20 | xhigh | zrobione, scalone (bd96586) | e844a7a, c85042f, 3ff03a4 (scalenia `main` 23ed7d5, 49e7fdf) | graf plazmy na pulę (0 budów przy skoku); iskry MAIN = Fx3D (sprawdzić po 12-B: `silniki.mjs --post` z Fx3D) |
| 14 | Tarcze i trafienia w tarczę | 03 | 04–13, 15–20 | xhigh | zrobione, scalone (7703490) | 9b8dad0, 9b95df5, e566f74, 02d6f02 | graf na wariant + wartości per obiekt; trafienia w `uniformArray` pakowanej w `onObjectUpdate` |
| 15 | Mostki, rdzenie, reaktory, światła (+ `mostki-demo`, `rdzen-demo`) | 04 | 05–14, 16–20 | xhigh | zrobione, scalone (ca83cd4) | 90b73f3, 67f5d8b, 0d20cf4, b366146, 0c292d4, f1bf060, 5e383a0, e39d5ab, 172d1d3 (scalenia `main` 45a927b, 7286401, c60ee1c, 7f49da8, ab7ca8a) | −998 linii GLSL w 5 modułach; jeden graf bryły mostka na 11 rodzajów; obrażenia mostka w buforze storage (µs zamiast 0,7–1,3 ms); `bitwa__fg` i `split` 0% vs baza |
| 16 | Zniszczenie stacji (+ scena bazy `stacja-rozpad`) | 03 | 04–15, 17–19 | xhigh | zrobione, scalone (82573e5) | 2dd8c5f, e676d1b, b00dd2f (scalenia `main` 99d1f12, 05f429b) | klatka rozpadu bez budów (Neptun 64 → 4,9 ms); kawałki tną się maską TSL; sesja bazy „stacja” (5 scen, szum 0%); odłamki paneli czarne jak w WebGL (decyzja wyglądu) |
| 17 | Broń 1/2 z dema `bronie-webgpu`: efekty wszystkich broni (pociski, smugi, trafienia, wiązki, PD, flak) | 12, 04 | 05–11, 13–16, 19 | max | zrobione, scalone (753700e) | 25123a4, e002a65, 5374728, 4e2d332, e575f23, 3992955, fae3257 (scalenia `main` 6ebbc29, 91d7964, 1bb1866, c243359) | 27 broni na recepturach dema (`src/3d/weapons/`, `WeaponFx`); PD i flak w 3D; −8 modułów; zero obiektów na strzał; nowe efekty — ocena obrazu zamiast tolerancji |
| 18 | Broń 2/2: obrażenia z dema — mapa ran, przebicia, rykoszety, ładowanie, serie; światła efektów na poszyciu | 17, 04 | 05–11, 13–16, 19 | max | część 18-A zrobiona i scalona (4e165fb): moduły mechaniki + zapytania `HullBodies` bez wpięcia; zrobione, scalone: 18-A (4e165fb), 18-C (1dd742a), 18-B + 18-D (f088bac) | 8eaa828…2da882d (18-A); 18-C: 7e7fd3d…ee1fc5d; 18-B/D: 56fb84e, cb65bbc, ae676eb, 1ead12b, 0bee2ae | zatwierdzona zmiana rozgrywki; wygląd przebić / rykoszetów / ładowania / ran do oceny użytkownika |
| 19 | Rakiety z dema `rakiety-webgpu`: dym GPU, dysze, kule ognia, Supernowa, iskry | 12 | 05–11, 13–18 | max | zrobione, scalone (2adf8fb) | 877f8ac, 1d60e1e, 079805c, 2025ba7, b2dabc4, b697ae9 (scalenia `main` 144b0f7, 6f0774a, 26636ce) | lot w `rocketSystem3D`; fala `shockwave3D` i `weapon3DSystem.js` usunięte; DIST przez OR; receptura tarczy (propozycja) |
| 20 | Koniec overlaya: wybuch reaktora w Core3D, usunięcie drugiego renderera | 17, 18, 19 | 13–16 | xhigh | zrobione, scalone (df965d6); wygląd wybuchu poza tolerancją — do oceny użytkownika | 36cd5de, 50891c4, 1c419f5, fee6883, 96f99d2 (scalenie `main` 121bd00) | jeden renderer, jeden bloom |
| 21 | Asteroidy z dema `asteroidy-webgpu` + kolizje z olbrzymami | 12, 04, 05 (+ commit dema) | 13–20 | max | zrobione, scalone (ee034ed); demo: 84198d3 | d6d7af1, 04cf318, 295f6fb, 55ea8d4, d9a27af, 41c62ac, 810c0a7, 111b917, 6ee3721, 7985de5, ab13869, ab22fb3, e7e824e | zielone światło użytkownika; pas w passach Core3D (18 modułów TSL), olbrzymy z kolizjami; stare pole (zderzenia z małymi skałami, niszczenie, łup) znika — do decyzji użytkownika |
| 21b | Fizyka wydobycia asteroid w grze (drony, piła, ładunki, urobek) — logika i demo od sesji „Asteroid lighting bug demo” | 21, 12 (+ commit dema) | 22–23 | max | zrobione, scalone (5cc94a7) — commity: 708bbdf, 87a883c, 9e1a8ba, 72f30ab, ce0f8b8, f3c573e (scalenia `main` b6cbe25, c5726c7) | | propozycja sesji fizyki skał; otwarte: kolizje odłamów, wpływ wybuchu, udźwig, ceny |
| 22 | Warp „Nurt” z dema `warp-webgpu` (iteracja 2) | 12, 13 (+ commit dema) | 14–21 | max | zrobione, scalone (e9f4285); demo: 68cc081 | 97f97b2, de2ed96, 3e8c98d, 83b3735, 4b08a27 (scalenia `main` 3b93795, f43d903) | ośrodek 1 mln drobin w compute, poza warpem 0 kroków i 0 draw calli; stara soczewka i API usunięte; wygląd iteracji 2 do oceny użytkownika | | „ready do wgrania, jak skończy sesję”; wygląd iteracji 2 jeszcze nieoceniony |
| 22b | Kop kamery przy skoku warpa i impuls zoomu przy wyjściu (z dema „Nurt”, w `cameraRig`) | 22 | 11, 18–21 | xhigh | zrobione, scalone (c7a7f6a) | 75af962, 8d3953f (scalenie `main` 575e550) | uwaga użytkownika do iteracji 1: wejście i wyjście „suche, bez kopa” |
| 23 | Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć | 04–22 | nie | max | zrobione, scalone (b41e4de) | 8fc9e77…56012bf (21 commitów) | duża bitwa 54% → 84% FPS bazy WebGL (Core3D 4,02 → 1,47 ms); bloom compute bit w bit; raport `WYDAJNOSC.md`; otwarte: przestoje > 100 ms przy pierwszej stacji modelu, partie tarcz, kolano bloomu (A/B) |
| 24 | Sprzątanie i domknięcie portu | 23 | nie | xhigh | w toku (podagent, worktree `statki-wt/24`) | | decyzje PLAN §12 p. 1, 3 |

## Regresje przejściowe (świadome)

Stan zamierzony na `main` w trakcie portu — nie „naprawiać” poza zadaniem, które go kończy.

| Od | Do | Co | Kończy |
|---|---|---|---|
| 01 | 24 | Nieprzeniesione `ShaderMaterial` rysują się magentą (`spis.zamienniki` w harnessie) | zadania 02–22 |
| 01 | 03 | Maska słońca wyłączona (`uSunShadowOn = 0`): bez cienia słońca na materiałach, smug tła i SDF kadłubów; fala uderzeniowa bez passa refrakcji; kadłuby z 04 liczą pełne słońce (zastępnik `// AGENT: po 03` w `hexShips3D.tsl.js`) | 03 — ZAMKNIĘTE (f487d2f) |
| 03 | 24 | `src/3d/sunShadowMaskGLSL.js` — napis GLSL maski dla nieprzeniesionych `ShaderMaterial` (Z4/Z5/Z7) | ostatni odbiorca; plik usuwa 24 |
| 02 | 23 | Bloom = 12 osobnych `renderer.render()` (~0,9–1,0 ms CPU na render, GPU ~0,085 ms przy 1080p); znaczniki czasu ~15 µs CPU na pass | 23 — ZAMKNIĘTE (b41e4de): bloom = 12 kerneli w jednym passie compute, cele bit w bit |
| 01 | 11 | Rozgrzewka tylko „nie rzuca”: pipeline'y kompilują się asynchronicznie przy pierwszym użyciu, osłona `backend.draw` pomija rysunek do gotowości (obiekt pojawia się 1–2 klatki później) | 11 — ZAMKNIĘTE (d62e275): rejestr `Core3D.warmup`; zostały: cień Destruction3D rozgrzewany rysunkiem (16), bryła stacji GLB, kernele compute synchronicznie na ekranie ładowania, pas 21b |
| 01 | 06 | Brak synchronicznego odczytu → mapa CPU ringu pusta (`heightAtUV` = 0): płyta ringu koliduje bez rzeźby terenu, LOD terenu bez wysokości, landmarki i kopuły stawiane bez mapy (stała wysokość z `haloRingLandmarks.js`) | 06 — ZAMKNIĘTE (070a407): teren w koliderze po `ring.ready`, sprawdzone w grze |
| 01 | 20 | Overlay efektów na własnym `WebGLRenderer` (jedyny drugi renderer; stare efekty overlaya działają bez zamienników) | 20 — ZAMKNIĘTE (df965d6): wybuch reaktora w Core3D, overlay usunięty, jedyny renderer w `core3d.js` |
| 01 | 17–19 | Pociski i błyski ze starego `weapon3DSystem` (materiały wbudowane — rysują się; cyjanowe głowy pocisków nie rysują się na WebGPU), smugi `slugTrail3D` (zamiennik); dym i iskry Fx3D — ZAMKNIĘTE w 12-B | broń — ZAMKNIĘTE w 17 (753700e); rakiety — ZAMKNIĘTE w 19 (2adf8fb) |
| 17 | 23 | Sceny `wraki` i `warp` rozjeżdżają się ze stanem bazy (46%): wizualia losują z `Math.random` gry (pierwsza różnica w `mainExhaust3D.spawnSpark` — liczba iskier zależy od zajętości banku Fx3D, którego broń już nie używa); rozgrywka sama bez zmian | 23 — ZAMKNIĘTE (b41e4de): wizualia na `fxRandom`, nowa baza scen z nowymi efektami w `.tmp/webgpu/zadania/23/baza-main/` |
| 01 | 22 | Soczewka i fale warpa usunięte (API jako no-op), skok działa bez efektu zgięcia | 22 — ZAMKNIĘTE (e9f4285) |
| Faza 0 | 21 | Stare pole asteroid i tło pasa wyłączone (`?asteroidyStare`) | 21 — ZAMKNIĘTE (ee034ed): nowe pole z dema, stare usunięte |
| 21 | 23 | Mapy cienia reflektorów w polu renderowane osobno na każdą mapę (budżet `maxShadowShips` = 2: gracz + najbliższy) | 23 — częściowo: cień pomijany bez rzucających; atlas w jednym renderze otwarty (24 / później) |

## Zebrane dla zadań 11, 23 i 24 (z raportów podagentów)

Lista robocza orkiestratora — zadania 11 / 23 / 24 zaczynają od niej (i od dziennika).

**11 (rozgrzewka przed pierwszą klatką):** teren ringu na zimno 0,4–1,3 s (07); konstrukcja ringu 1,1–1,7 s na każdy z 2
wariantów, chmury ~1,1 s, powłoka ~0,85 s (08); 9 materiałów megastruktury i miasta ~2–3 s razem (09); K-7 i archetypy
(10: K-7 0,07–0,29 s na materiał, ring Marsa 3,3 s / 13 materiałów, Jowisza 3,0 s); dysze SIDE — 4 pipeline'y w pierwszej
klatce gry (13); materiał fali uderzeniowej (03 — pierwsza Supernowa);
menu nie czeka na `ring.ready` (ring dołącza 2–4,5 s po Ziemi) i pusta scena `createHaloBakeWarmup` do usunięcia (06).

**23 (wydajność, precyzja, poprawki renderu):**
- bloom = 12 osobnych `renderer.render()` (~0,9–1,0 ms CPU na render; 02);
- wgrywanie geometrii `hull:beam` 170 ms przy wejściu w skok (13, 12-B);
- `discard` w Tint nie przerywa shadera: zanikająca górna ściana ringu i puste chmury liczą pełne cieniowanie — pomijać
  rysunek przy pełnym zaniku, osłonić chmury (08);
- **jedna mapa cienia ze wszystkimi warstwami**: łapacz cienia warstwy 0 (`Core3D.shadowCatcher`) dostaje cień z FG
  (stacje po rozpadzie — 16);
- brama znaczników czasu (`_gpuTimerGate`) liczy miejsce raz na klatkę rAF, a dema renderują wiele razy — przepełnienie
  puli w `mostki-demo` / `rdzen-demo` (04, 15);
- harness zbiera błędy per scena — błędy startu sesji (przed pierwszą sceną) giną (13: SIDE z 12 buforami wierzchołków);
- żar krawędzi w demie rdzenia 1–3% ciemniejszy (materiał kadłuba, 15);
- resztkowe różnice krawędzi ringu (FXC scala `mad` także w wierzchołkach, pochodne na czwórkach pikseli — 09);
- pule efektów broni po zawinięciu rysują całą pojemność (trójkąty ×3), do 11 osobnych wywołań compute na klatkę (połączyć),
  pass zniekształceń przegląda całą scenę; wizualia losujące z `Math.random` gry (dysze, Fx3D, `shieldImpactFx`, rakiety,
  overlay) → `fxRandom` + nowa baza `wraki` / `warp` (17);
- pass maski słońca +1 draw call, ~0,1 ms GPU (03); cel refrakcji HalfFloat MSAA ~16 MB przy 1080p (03);
- iskry MAIN na dopalaczu 0,067% vs tag (linie 1 px: Dawn vs ANGLE — przyjęte, 12-B);
- kolano bloomu z 22 (`bloomKnee.js`) na żarze rany i świetle poszycia (18-C) razem z efektami 17 / 19 — decyzja dla
  całej broni (dema liczą bloom bez ×3 gry, więc w grze efekty świecą mocniej niż w demach); nowa baza `galeria-*` / `bitwa`
  z `main`;
- pas asteroid: mapy cienia w jednym renderze atlasu zamiast renderu na mapę, koszt passów pasa przy dalekim zoomie,
  obrót stacji Wenus w harnessie zależy od liczby klatek ładowania (pas wydłuża ładowanie — szum `planeta-cien`) (21);
- pierwsza klatka w gęstym polu ~400 ms = synchroniczna budowa ringu Marsa (`createArchRing` / `buildEcumeneRing` — pole
  w promieniu 420 tys. j. od Marsa); sam pas ~40 ms (21b);
- `LightGrid.add` przekracza limit wklejania V8 (~100 B obiektów na światło na producenta — wariant z buforem); kopie CPU
  buforów storage dymu i mgławicy rakiet ~71 MB; cień dymu rakiet na kadłubach (mapa gęstości gotowa, wymaga grafu
  kadłuba — po 18-C) (19);
- z-fighting współpłaszczyznowych brył tranzytów i zatok archetypów (`archPort.js`, migocze też w bazie — poprawka
  geometrią) i krawędzie napisów K-7 (mipmapy atlasu w WebGPU?) — 10.

**24 (sprzątanie):** `src/3d/sunShadowMaskGLSL.js` (po ostatnim odbiorcy); `src/3d/haloRing/haloRingGLSL.js` (615 linii —
czytają go tło menu do 11, budowle Z7 spoza gry, narzędzie parzystości i testy, 10); `HALO_GLSL_INDKIT` / `HALO_GLSL_STORM` tylko dla
narzędzia parzystości (08, 09); `beamDebris3D.js` — GLSL tylko w demach destruktora (04); brakujący
`assets/effects/glow.png` (404 sprite'a blasku słońca, 05); wyciek `_cloneShellHierarchy` (`__sharedTemplateAsset` w
klonach kawałków — nigdy niezwalniane, 16); skrypty dem z własnym startem Chrome bez sprzątania profilu → wspólny
`closeChrome` (incydent dysku); `dema/kontenery.html` na `main` nie działa (poza portem, 06); martwe metody broni w `CanvasVFX` (17); martwe `getProjectileImpactVfxPressure` w
`canvasParticleSystem.js` (czyta `window.overlay3D`), `dema/station-destruction-sandbox.html` tylko z tagu, baza sesji
„reaktor” z tagu do dopisania z `--powtorz 2` (pojedynczy przebieg w `.tmp/webgpu/zadania/20/baza-tag-reaktor/`) (20); pola starych efektów w puli
`rocketSystem3D` i `Math.random` w `collisionSparks.js` (19); `asteroidDestructor.js`, nieużywany kod asteroid w `cicDisplay.js`,
stare komentarze w `src/3d/fx/lightGrid.js` (21).

**Zmiany rozgrywki do decyzji użytkownika (21, asteroidy):** nowe pole nie ma zderzeń i obrażeń od małych skał (leżą pod
płaszczyzną), niszczenia i łupu ze skał (wydobycie — 21b), kontaktów skanera / radaru, namierzania ani holowania asteroid;
otwarte: czy pioruny i olbrzymy mają zadawać obrażenia (dziś nie — olbrzymy odpychają, odbicie 0,3), omijanie olbrzymów
przez AI (NPC ślizgają się po ścianie), rakiety / wiązki / wraki przelatują przez olbrzymy (zatrzymują się tylko pociski).

**Wydobycie (21b) — do decyzji użytkownika:** ceny ładunków (tymczasowe S 8 / M 25 / L 80 / XL 250 CR, zestaw startowy S6 M4
L3 XL1, ładunki nie liczą się do masy ładowni); ładownia Atlasa 20 t vs ~138 t rudy w jednej skale miedzi (r 650) —
mniej rudy w skałach, większa ładownia czy osobny magazyn rudy; udźwig wiązki 450 t (z dema); kolizje odłamów z
kadłubami (dziś nie); wpływ wybuchu na sąsiednie skały pola (dziś nie); czy przejmować każdą skałę PLAY, czy tylko złoża
ze skanera. Sterowanie: `N` — tryb wydobycia (w trybie LPM lasery, PPM ładunek / PPM + przeciągnięcie piła, `L` wielkość,
`F` detonacja, `T` wiązka — poza trybem `F` / `T` jak dawniej).

**Wybuch reaktora (20) — do decyzji użytkownika:** wygląd poza tolerancją bazy (`wybuch` 37,4% >8/255, 0,31% >32; sam
wybuch średnia 4,85; rozbłysk: mniejsza biała kula, final stacji bez zalania ekranu bielą, rdzeń maks. 228/255 zamiast
255, słabsza linia anamorficzna) — dokładny wygląd dałby tylko drugi bloom (sprzeczne z „jeden bloom”); stacje przykrywają
wybuch (warstwa FG po warstwie 0 — w bazie overlay leżał nad wszystkim): przenieść rdzeń i rozbłysk do FG?; pierścień
fraktalny i ciemna fala były w bazie niewidoczne (kwady tyłem do kamery) — zostawione 1:1, włączone = mocny cyjanowy
pierścień (podgląd `plaskie-kwady-tag-core3d-podglad.png`). Zrzuty: `.tmp/webgpu/zadania/20/obok/`.

**Decyzje wyglądu do potwierdzenia przez użytkownika:** odłamki paneli czarne jak w WebGL (`PANEL_SHARD_BASE_COLOR`, 16);
`planeta-cien` bez kropkowanego łuku poświaty z bazy WebGL (05); fala uderzeniowa (03) — usunięta w 19 razem ze
starą Supernową (obie uwagi znikły); receptura trafienia rakiety w tarczę (propozycja 19, demo jej nie miało); warp (22): wariant czysto wizualny na 3 otwarte pytania dema (wyrzut bez obrażeń, nić zwiastuna bez
radaru, punkt wyjścia z rozgrywki), **soczewka świata z dema (przeloty obok planet) i „kop” kamery przy skoku NIE weszły**
(kamerą rządzi `cameraRig` — został wstrząs), ładowanie w grze 0,8 s zamiast 3 s w demie (płaty wzmocnione).

## Środowisko (Krok 2, 2026-09-27)

Sonda: `node scripts/webgpu/srodowisko.mjs [--out plik.json]` (Vite + headless Chrome z flagami
`dema/rdzen-cdp.js`; adapter, cechy, limity, urządzenie z próbnym submit i znacznikiem czasu,
renderer WebGL2 dla porównania). Wynik JSON — do porównań na innych maszynach.

| Co | Wartość |
|---|---|
| System | Windows 11 Pro 10.0.26200 |
| CPU / RAM | AMD Ryzen 7 7800X3D / 31 GB |
| GPU | **NVIDIA GeForce RTX 5080**, sterownik 32.0.16.1088 (NVIDIA 610.88, 2026-07-22); obok iGPU AMD Radeon (Ryzen) |
| Node / npm | 22.20.0 / 11.6.2 (narzędzia CDP wymagają ≥ 22 — globalny `WebSocket`) |
| Chrome | 153.0.8010.54 (headless `--headless=new`, ANGLE D3D11 dla WebGL) |
| three | 0.183.2 (`npm install` — bez zmian w lockfile) |
| Adapter WebGPU | `nvidia` / `blackwell`, nie zapasowy; **`high-performance` i `low-power` dają ten sam adapter** (RTX 5080, nie iGPU) |
| Format canvasa | `bgra8unorm` |
| Cechy (wybrane) | `timestamp-query`, `float32-filterable`, `float32-blendable`, `shader-f16`, `rg11b10ufloat-renderable`, `texture-compression-bc`, `dual-source-blending`, `subgroups`, `clip-distances`, `depth32float-stencil8`, `texture-formats-tier1/2` |
| Urządzenie | próbny pass ze znacznikami czasu: 224 ns, bez błędów walidacji, urządzenie żyje po submit |
| WebGL2 (dziś) | ANGLE (NVIDIA RTX 5080, Direct3D11), `EXT_disjoint_timer_query_webgl2`, `EXT_color_buffer_float`, `EXT_float_blend` |

**Limity: domyślne urządzenie ≠ adapter.** Bez `requiredLimits` WebGPU daje minimum ze specyfikacji —
gra musi prosić o więcej (w demie asteroid WebGPU już tak jest):

| Limit | Domyślnie | Adapter | Dlaczego ważne w grze |
|---|---|---|---|
| `maxTextureDimension2D` | 8192 | 16384 | planety 8K, mapy ringu „Ultra” 16K |
| `maxTextureArrayLayers` | 256 | 2048 | tablice warstw (SDF kadłubów, skały) |
| `maxSampledTexturesPerShaderStage` | 16 | 48 | materiały ringu / planet z wieloma teksturami |
| `maxInterStageShaderVariables` | 16 | 28 | materiały z wieloma varyingami |
| `maxVertexAttributes` | 16 | 30 | instancje z wieloma atrybutami |
| `maxStorageBuffersPerShaderStage` | 8 | 16 | compute, pył |
| `maxStorageTexturesPerShaderStage` | 4 | 8 | |
| `maxColorAttachmentBytesPerSample` | 32 | 128 | MRT HalfFloat |
| `maxBufferSize` / `maxStorageBufferBindingSize` | 256 MB / 128 MB | 2 GB / 2 GB | |
| `maxComputeInvocationsPerWorkgroup` / `…WorkgroupStorageSize` | 256 / 16 KB | 1024 / 32 KB | |

## Testy bazowe (Krok 2, 2026-09-27, HEAD `cb02194`)

- `npm test` (= tylko `scripts/tests`, 32 zestawy): **OK — 1662 asercje, 0 błędów**.
- `node --test "tests/*.test.mjs"`: **1322 testy, 1313 OK, 7 porażek, 2 todo** (~23 s).
  Uwaga: `node --test tests/` na Node 22.20 NIE działa (`Cannot find module …\tests` — katalog nie jest
  już przeszukiwany); używać wzorca `"tests/*.test.mjs"`.

Porażki bazowe (znane sprzed portu — nie naprawiać w ramach portu; `weaponAim.test.mjs:144` zniknęła w 17, `asteroidHexAdapter.test.mjs:309` razem ze starym polem w 21 — od ee034ed jest ich 5):

| Test | Plik |
|---|---|
| HUD radar shell is compact and does not reserve an empty lower panel | `tests/hudRadarWiring.test.mjs:16` |
| HUD radar exposes clickable tactical range controls | `tests/hudRadarWiring.test.mjs:24` |
| X starts one scanner burst without scheduling recurring waves | `tests/scannerSingleBurst.test.mjs:5` |
| physical AU metadata does not collapse the stretched gameplay map | `tests/solarSystem.test.mjs:46` |
| targeting wheel exposes SINGLE, MULTI and SUB in the existing three sectors | `tests/targetingModes.test.mjs:14` |

Todo (2): „PORT poprawka 1 / 3 (TODO integracji)” w `tests/shipCore.test.mjs` (rdzenie, `docs/PORT-rdzen.md`).

## Dziennik sesji

### 2026-09-27 — Faza 0 (sesja 1)

- Krok 1: przeczytane `agents.md`, `USTALENIA.md`, `DEMO-ASTEROIDY.md`, `core3d.js` w całości,
  `drawHexShips3D`, `sunShadowMask.js`, `bloomConfig.js`, `sceneOrigin.js`, narzędzia CDP.
  Nowe względem `USTALENIA.md`: w grze są **jeszcze dwa renderery WebGL poza Core3D** —
  `src/effects3d/overlay.js:127` (`overlay3D` eksplozji z własnym composerem i bloomem oraz
  `rocketOverlay3D` rakiet; osobne kanwy nad `#c` z `mix-blend-mode: screen`) i narzędzie dev
  `src/3d/modelBaker.js` (z `src/ui/devTools.js`); legacy `planet3d.proc.js` też ma własny.
  three r183 ma `CanvasTarget` + `renderer.setCanvasTarget()` — jeden renderer może rysować do kilku kanw.
- Krok 2: środowisko i testy bazowe jak wyżej.
- Krok 3: spike — 17 punktów na RTX 5080, wszystkie działają w Vite i przez import map (`SPIKE.md`). Najważniejsze:
  model klatki Core3D (wiele `render()` do jednego celu MSAA) działa bez obejść WebGL; `CanvasTarget` wpina overlay
  w renderer Core3D; `highPrecision` + dotychczasowa reguła precyzji dają 0,001 px także dla `InstancedMesh`;
  WGSL (DXC) kompiluje się 2–9× szybciej niż ten sam GLSL przez ANGLE (pierwszy przebieg: 44 s = `mx_noise_float`
  rozwinięty 160× pętlą JS — do unikania); odczyty asynchroniczne z paddingiem 256 B i odwróconą osią Y; cień
  aktualizuje się najwyżej raz na klatkę; `clear()` ignoruje nożyczki.
- Krok 4: inwentarz — `node scripts/webgpu/inwentarz.mjs` → `INWENTARZ.md` (+ JSON w `.tmp/webgpu/`). Razem 117 miejsc
  tworzenia materiałów i ~14 tys. linii GLSL; **w porcie (ładuje gra, bez warpa i asteroid): 71 materiałów, 9061 linii
  w 44 plikach**; warp 364 linie, stare asteroidy 66, nowe asteroidy 1889, legacy `planet3d.proc.js` 392, poza grą 2226
  (dema: ładunek Z5, budowle Z7, proxy Z4, `beamShips3D` destruktorów). Graf importów pokazał: `beamShips3D`,
  `shipProxyBatch3D`, `voxelShips3D`, `cargoContainers3D`, `cargoDrones3D`, `portBuildings/*` NIE są w grze.
  Subagenci (dema, asteroidy, testy): gałąź heksów `hexShips3D` rysuje w grze tylko asteroidy; `coldWreckImpostors`
  uśpione; `DestructorGpuSoftBody` prosi o drugie urządzenie WebGPU co sesję; 5 dem na Core3D (warp, asteroidy,
  budowle, mostki, rdzeń) + 4 z własnym WebGLRenderer na modułach gry (ring, kontenery, destruktor 2D/3D).
- Pytania do użytkownika (odpowiedzi w tabeli decyzji): stare asteroidy → wyłączyć całe pole; dema spoza gry → tag.
- Krok 5: harness zrzutów prawdziwej gry.
  - Narzędzia: `scripts/webgpu/zrzuty.mjs` (sesje i sceny), `harness-strona.js` (wstrzykiwany przed skryptami
    strony), `porownaj.mjs` (porównanie katalogów: % pikseli > 2/8/32, średnia, maks, mapa różnic, obok siebie),
    `png.mjs` (PNG bez zależności), `baza.mjs` (składa `baseline.json`).
  - **Determinizm bez zmian w grze** (droga dojścia — zapisana, bo to łatwo zepsuć): zegar wirtualny
    (`performance.now`, `Date.now`, znacznik rAF) stoi od wczytania, sceny kroczą go o 1/60 s na klatkę;
    **stała baza czasu** (10 000 ms, nie `realNow()` — z bazą z chwili wczytania porównania `now − lastShot ≥ cooldown`
    rozstrzygały się o klatkę inaczej i pociski się rozjeżdżały); `Math.random` z ziarnem (mulberry32), **ponowne
    ziarno na starcie każdej sceny i przed krokami** (spawny losują rozrzut, a klatki ładowania zużywają losowania
    w zmiennej liczbie); **dyspozytor rAF „hold”** — strona dostaje klatki tylko na żądanie harnessu (efekty liczone
    na klatkę: iskry warpa, obrót stacji); **sprite'y kadłubów wczytane z góry** (kadłub NPC powstaje w
    `drawNPCPretty`, gdy sprite gotowy — inaczej kolejność tworzenia ciał zależy od sieci); CSS bez animacji.
    Efekt: dwa przebiegi WebGL różnią się ≤ 0,007% pikseli (> 2/255), bitwa co do bitu.
  - Haki w `index.html` (tylko `?dev`, rozgrywki nie zmieniają): `window.DevScene.teleport(x, y, kurs)`,
    `.syncCamera()` (RTS rysuje się z interpolacji `prevCameraState` zapisywanego w krokach fizyki),
    `.preloadHullSprites()`, `.startSplit()` (podzielony ekran bez padów).
  - Sceny (16 + 32 warianty warstw = 48 PNG): `menu`, `hud`, `ring-z02`, `ring-z1`, `k7-hala`, `planeta-cien`
    (Wenus i jej cień), `slonce`, `mars-ring` (ECUMENE), `jowisz-ring` (Fable), `kalibracja` (same wbudowane
    materiały three: Standard, emisja HDR, Basic HDR, addytywny, gradient sRGB, alfa — wariant `__ortho` nie ma
    zamienników już po zadaniach 01–02, na nim zadanie 02 kalibruje tolerancję), `bitwa`, `bitwa-blisko`, `wybuch`,
    `wraki`, `warp` (ładowanie, plazma WARP), `split`; warianty „jedna warstwa” (`scena__tlo|planety|ortho|fg`) dla
    ring-z02, k7-hala, planeta-cien, mars-ring, jowisz-ring, kalibracja, bitwa, wraki — harness owija `renderer.render` i pomija passy spoza warstw (Core3D `setPerfToggles` z `bgPass: false`
    zostawia starą klatkę — tylko pass tła czyści kolor). Każda scena: PNG, błędy/ostrzeżenia konsoli (z walidacją
    WebGPU przez domenę Log), draw calle i trójkąty (per pass), ms CPU `Core3D.render`, ms GPU, histogram HDR bufora
    sceny, spis widocznych materiałów per warstwa (na WebGPU policzy zamienniki), stan świata.
  - Pominięte względem prompta: gęste pole asteroid i burza pasa (asteroidy poza portem), mostek 3D z bliska
    (mostki na kadłubach belkowych nieaktywne — weryfikacja w `dema/mostki-demo.html`).
  - Baza: `node scripts/webgpu/zrzuty.mjs --backend webgl --powtorz 2 --wydajnosc --out .tmp/webgpu/baseline`
    → PNG w `.tmp/webgpu/baseline/webgl/p1` (+ `p2`, `szum-p1-p2/`), `node scripts/webgpu/baza.mjs` →
    `docs/webgpu/baseline.json`. Wydajność (bitwa 24×24, 1920×1080, headless): klatka 3,6–4,9 ms, fizyka 0,5–1,0,
    rysowanie 2,4–3,0, render Core3D 0,87–1,03 ms CPU, GPU 1,0–1,1 ms, 87–88 draw calli — rozrzut między
    przebiegami, bo inne sesje użytkownika pracowały na tym samym GPU/CPU; porównanie wydajności (zadanie 23) tylko
    naprzemiennie i bez innych obciążeń. Drżenie (`dema/precyzja-drzenie.js
    --variant po`): światła 0,003 px RMS, okna mostków 0,04–0,06 px, reszta ≈ 0.
  - Testy po hakach: bez zmian (7 porażek bazowych, `npm test` OK).
- Krok 6: `PLAN.md` (architektura z wyników spike'u, konwencje TSL, precyzja, cienie, asynchroniczność, weryfikacja,
  20 zadań + odłożony warp, ryzyka, pytania), `zadania/01…20`, `README.md`, sekcja „Port WebGPU (w toku)” w `agents.md`,
  tabela zadań i regresji przejściowych wyżej. Narzędzia: `baza.mjs --dopisz` (nowa scena bazy z tagu bez przebudowy
  całości) i ochrona skalibrowanej tolerancji przy przebudowie (sprawdzone na kopii: pełna przebudowa daje plik
  identyczny poza datą; dopisanie sceny + ponowna przebudowa ją zachowują). Ustalenia z planowania (źródło three r183
  albo sprawdzone w Node):
  - **Scena overlay** (osobny `WebGLRenderer` do 17) zawiera też **iskry** `SparkSystem3D` (`index.html:
    SparkSystem3D.init(ov.scene)`) — materiału w niej nie da się przenieść przed przeniesieniem overlaya, więc iskry są
    w 17 (nie w 12), wybuchy w 18. `rdzen-demo` ma własny overlay.
  - **Materiał na encję = budowa NodeBuilder na encję:** klucz materiału węzłowego to id węzłów — dwa materiały z
    osobnymi `uniform()` mają różne klucze, `clone()` i wspólny graf ten sam, `SpriteMaterial` o różnych kolorach ten
    sam (sprawdzone w Node, `customProgramCacheKey`). Dziś materiał na encję mają kadłuby, tarcze i plazma WARP →
    graf na wariant + `onObjectUpdate` (PLAN §3; zadania 04, 13, 14).
  - **`compileAsync` odtwarza pass:** pomija niewidoczne, spoza warstw kamery i spoza frustum, kompiluje dla bieżącego
    celu (format, MSAA) → rozgrzewka = cel `composerTarget` + kamera passa z warstwą (PLAN §6; pomocnik w 01).
    Trzymacze programów nadal potrzebne (`NodeManager` usuwa stan przy `usedTimes === 0`).
  - **Światła:** klucz materiałów oświetlanych zawiera id każdego widocznego światła (`LightsNode.customCacheKey`) —
    nie przełączać `visible` w biegu (dziś światła silników i trafień i tak wyłączone).
  - `Texture.updateRanges` backend ignoruje (tekstura obrażeń mostków 768 × 512 = 1,5 MB na zmianę — zadanie 15);
    zakresy atrybutów działają (`WebGPUAttributeUtils`). Kanwa WebGPU tylko premultiplied → overlay (dziś
    `premultipliedAlpha: false`) oddaje `kolor · alfa` (17). `three/webgpu` + `three/tsl` ładują się w Node (testy
    mogą czytać graf).
  - Gałąź heksów `hexShips3D` przechodzi w 04 (stoją na niej `mostki-demo`, `rdzen-demo` i pomiar drżenia), a
    `reactor3D` / `coreFx3D` w 15 (warsztat `rdzen-demo`) — zgodnie z decyzją o warsztatach; notatka inwentarza poprawiona.
  - Sesje równoległe tego dnia budują od nowa na WebGPU efekty broni (`dema/bronie-webgpu`), rakiet
    (`dema/rakiety-webgpu`) i warpa (`dema/warp-webgpu`) — pytanie do użytkownika (PLAN §12 p. 6); plan zakłada port 1:1.
- Po kroku 6 użytkownik obejrzał dema broni i rakiet: „bronie — wszystkie super”, „rakiety — super”, wdrażać przy porcie
  (tabela decyzji). Przebudowa planu: stare 12 (port 1:1 broni), 17 (overlay na `CanvasTarget`) i 18 (wybuchy) usunięte;
  nowe 12 = infrastruktura efektów (compute w klatce, jedna siatka świateł z trzech kopii w demach, zniekształcenia,
  Fx3D 1:1), 17–18 = broń z `bronie-webgpu`, 19 = rakiety z `rakiety-webgpu` (iskry `SparkSystem3D` → `sparks.js`),
  20 = koniec overlaya (wybuch reaktora do Core3D, drugi renderer znika); dawne 19–20 → 21–22. Ustalenia: dema
  ustawiają `renderer.lighting = GridLighting` globalnie (w grze decyzja „kto czyta siatkę” w 12); gra woła efekty przez
  `WeaponShotBus.emit`, `spawnBulletImpactEffect` (bez trafionej encji i normalnej — 17 je dokłada), `superweapon.js`
  (Hexlance), `rocketSystem3D` (lot i trafienia zostają); laser PD i flak są dziś na kanwie 2D (18 przenosi do 3D);
  wieżyczki zostają 2D, mapa ran w uv nie wchodzi. Nowe efekty nie mają bazy w tagu — ocena użytkownika, potem przebieg
  z `main` jako baza. `INWENTARZ.md` z adnotacjami „zastąpi / port w …”, wygenerowany z czystego eksportu HEAD (bez
  niezacommitowanych zmian innych sesji).
- Krok 7: raport dla użytkownika w rozmowie; zadanie 01 czeka na zgodę.

### 2026-09-27 (wieczór) — egzekucja portu: orkiestrator + podagenci

- Użytkownik: praca samodzielna do końca, potem wyłączenie komputera (tabela decyzji). Organizacja: każde zadanie robi
  podagent w worktree `C:/Users/Szymon/Documents/GitHub/statki-wt/NN` (gałąź `webgpu/NN`); `node_modules` kopiowane
  robocopy (NIE dowiązanie — `git worktree remove --force` kasuje zawartość celu dowiązania, sprawdzone); worktree
  tworzyć z `git -c core.autocrlf=false` (inaczej CRLF i fałszywe porażki strażników); POSTEP / INWENTARZ prowadzi
  orkiestrator (`bash scripts/webgpu/inwentarz-czysty.sh` — inwentarz z czystego HEAD).
- Sesje dem: warp „Nurt” iteracja 2 gotowa (notatka w `DEMO-WARP.md` § Do portu w grze; sesja nie commituje bez zgody
  swojego użytkownika — pliki zacommituje orkiestrator przy starcie 22); asteroidy gotowe (`DEMO-ASTEROIDY.md` § Do portu
  w grze), ale sesja „Asteroid lighting bug demo” poprawia nocne światło dużych skał i robi fizykę / rozgrywkę skał
  (cięcie dronami, kopanie do rdzenia, ładunki, materiały) jako osobne API — **dema asteroid nie commitować przed jej
  sygnałem**, zadanie 21 = render + kolizje z olbrzymami, fizyka skał = osobne zadanie po jej meldunku.
- Projekt integracji broni (podagent-architekt) → `PROJEKT-BRONI.md`; decyzje §5 w imieniu użytkownika.
- **Zadanie 06 (ring 1/5) zrobione na gałęzi `webgpu/06`** (b7ecdc9, 0e53f47, 801317a, 446fbde, af86dd7, c1ad3d2) —
  czeka na scalenie 01 i weryfikację w grze:
  - biblioteka TSL ringu (`src/3d/haloRing/haloRingTSL.js`: całe `haloRingGLSL.js` + `SURFACE` / `CLOUDCOVER`),
    uniformy w jednym bloku (`createUniformBlock` — limit 12 buforów uniformów na etap; pieczenie miało 20 i pipeline
    się nie tworzył), pieczenie map i detal w TSL, odczyt CPU asynchroniczny (padding 256 B), budowa ringu
    asynchroniczna (`await ring.ready`; kolizje terenu po `ready`); `halo_ring_demo` na WebGPU (otoczenie w TSL);
  - mapa CPU vs WebGL z tagu: Mars i Jowisz bit w bit; Ziemia średnia różnica 0,0021 j., p99,9 0,075, maks. 0,569 j.,
    0 NaN; plan budowli (9 megabudowli, 12 kopuł) identyczny; naprawiony NaN z `pow(1-|n|, 3)` (ujemna podstawa);
  - czasy: kompilacja + mapa niska + odczyt 9,9 s (WebGL) → 1,4–2,5 s (WebGPU); demo do gotowości 31 s → 5,5 s;
  - pułapki: `setLayout` z uniformem w domknięciu (błąd r183 — PLAN §3), hasze float z niecałkowitych wejść różnią się
    między kompilatorami, v = 0 pieczenia u góry celu (bez odwracania osi), kolejność funkcji w WGSL zależy od kolejności
    budowy materiałów (jedna dodatkowa kompilacja na typ); `dema/kontenery.html` na `main` nie działa (dema poza portem —
    tag);
  - testy: 1337 / 7 porażek bazowych / 2 todo; nowe `haloRingTSL` (12, WGSL budowany w Node) i `haloRingAsync` (3);
    `menuBackdrop` (rozgrzewka) przepisany; inwentarz na gałęzi: port 42 pliki z GLSL, 68 materiałów, 8542 linie.
- **Część 18-A scalona do `main`** (8eaa828, 3c2ac69, 2da882d; scalenie 4e165fb): `HullBodies.surfaceNormal /
  traceThrough / spriteUvAt`, `hullImpactResult`, `hull.dmgKey` (dziedziczony przez wraki i odłamy), hak `onImpact`;
  `src/game/projectileMechanics.js` (`resolveHullHit`, `entryDamage`, `stepInsideHull`), `src/game/weaponCharge.js`
  (`stepCharge`, kolejka serii Hexlance'a); pola danych w `weapons.js` (penDepth / penSpeedLoss / ricochet / chargeTime
  Valkyrie / recoil i shake zgodne z `FX_PROFILE` — gra ich jeszcze nie czyta); `scripts/bilans-broni.mjs`, opis wpięcia
  `docs/webgpu/MECHANIKA-BRONI.md`. Fizyka kadłubów A/B z HEAD: identyczny hash stanu i sekwencja `Math.random` (240
  kroków). Testy na `main` po scaleniu: 1364 / 7 porażek bazowych / 2 todo, `npm test` OK.
  - Bilans (1000 strzałów, prawdziwe sprite'y): Mjolnir 312,5 → 227,3 dps (−27%), kolumna 3 okrętów ×5,0 straty na
    strzał; Valkyrie 166,7 → 152,5 dps (−8,5%), na wylot fregata 100% / niszczyciel 80% / pancernik 19%; Vulcan i
    Gatling S −1,5…−4,2% dps (rykoszety 2–6% trafień); Hexlance seria 4 cięć = +53…57% straty (nie ×4 — cięcia biegną
    tym samym pasem).
  - Decyzje podagenta (do przejrzenia): ponowne wejście w ten sam kadłub robi krater bez drugiego HP i bez liczenia do
    limitu przebić; krater zakleszczenia 0,5 × obrażeń × (v/v_wejścia)²; naładowane działo bez celu gaśnie po 2 s;
    kolejka serii z opóźnieniami względnymi; recoil/shake dopisane wszystkim broniom (warianty S/L, `ciws_mk2`,
    `hexlance_siege` dostały wartości rodziny z dema — dziś mają fallback 3/1,8, zmiana przy przełączeniu źródła w 18-D).
- **Zadanie 01 scalone do `main`** (fca136a, b9c95d2, be4ea80; scalenie 159dd42): Core3D na `WebGPURenderer`, tylko
  WebGPU (brak `navigator.gpu` / adaptera → komunikat w menu, przyciski startu wyłączone; `_getFallback = null`,
  `featureLevel: 'compatibility'`, limity z adaptera); `init()` synchroniczne, urządzenie w tle (`Core3D.gpuReady` /
  `Core3D.ready`); runner passów bez EffectComposer (tło → planety → quad halo → ring-planety → ortho → tarcze bez
  czyszczenia głębi → FG); post = `RenderPipeline` (ACES gry + sRGB gry, `outputColorTransform = false`), `renderBackdrop`
  tym samym postem; cienie per światło (`Core3D.setSunShadowLight`); `info.drawCalls`; zegar GPU = znaczniki czasu
  (1 zapytanie w locie; three nie czyści mapy `timestamps` — ~15,8 tys. wpisów — Core3D czyści sam); split tylko przez
  2× `renderSingle`; API warpa = no-opy + miejsce na pass zgięcia tła; `src/3d/tsl/` (`uniformy.js`, `zamiennik.js`,
  `kolorGry.js`); `Core3D.prewarmPass(obiekt, warstwa)` (rozgrzewka broni w `weapon3DSystem` wcześniej NIGDY się nie
  wykonywała — warunek `Core3D.camera` zawsze fałszywy); osłona `backend.draw` (three r183 wkłada pipeline z
  `compileAsync` do cache, zanim GPU go odda → `setPipeline(undefined)`, realny TypeError); `modelBaker.js` usunięty.
- Harness po 01: 16 scen / 32 warianty, renderer `webgpu`, 0 błędów WebGPU/WGSL, 0 ostrzeżeń three. Zamienniki: menu 80,
  hud 45, ring-z02 45, ring-z1 45, k7-hala 42, planeta-cien 10, slonce 8, mars-ring 69, jowisz-ring 75, kalibracja 14,
  bitwa 32, bitwa-blisko 24, wybuch 28, wraki 25, warp 51, split 15. `kalibracja__ortho` vs baza: >2 93,54%, >8 85,83%,
  >32 71,94%, średnia 75,96, maks 252 — sama poświata (brak bloomu), HDR > 0,9: 0,02515 vs 0,02525. Start: `gpuReady`
  ~4,3–4,5 s od nawigacji, tło menu ~5,6–5,9 s.
- **Nowa baza (tryb `--uuid osobne`):** three bierze 4 × `Math.random` na UUID każdego obiektu i węzła TSL, więc na
  WebGPU losowania gry przesuwały się (inne kąty planet, inne przebiegi wraków i warpa). Harness `--uuid osobne` daje UUID
  osobny strumień (podmiana w odpowiedzi serwera przez CDP — gra i tag bez zmian); bazę z tagu zrobiono ponownie w tym
  trybie (p1 = p2) — stan świata WebGPU zgodny w 16/16 scen. Przyjęta do `.tmp/webgpu/baseline/webgl/` (stara w
  `.tmp/webgpu/baseline-stara/`), `baseline.json` przebudowany (`losowanieUuid: 'osobne'`, `kodGry`). Harness wybiera tryb z
  bazy sam. Szum WebGPU p1/p2: 0 poza `planeta-cien` (0,06% — obrót stacji Wenus).
- Testy na `main` po scaleniu: `node --test` 1373 / 7 porażek bazowych + 1 niestabilny pod obciążeniem
  (`capitalAiFlight` „ship follows a moving target…”, sam przechodzi 3/3) / 2 todo; `npm test` OK. **Po każdym scaleniu:**
  `bash scripts/webgpu/lf-po-scaleniu.sh` — `git merge` przy `core.autocrlf=true` zapisuje zmienione pliki z CRLF i 4
  strażniki padają fałszywie (827, 828, 939, 941 po scaleniu 01).
- **Zadanie 06 scalone do `main`** (scalenie 070a407; na gałęzi po scaleniu 01: bc24e0b, f1aaa99, 88d8df5): ring w grze na
  WebGPU — 5 scen harnessu (ring-z02, ring-z1, k7-hala, mars-ring, jowisz-ring) bez błędów, `ringReady`, zrzuty piksel w
  piksel jak po 01 (materiały ringu to jeszcze zamienniki — 07–10). Kolider płyty dostaje teren dopiero po `ring.ready`
  (`scripts/webgpu/ring-kolizje-gra.mjs`): Ziemia 7060/7060 próbek ≠ 0 (−128…216), Mars 7036/7036 (1,5…171), Jowisz
  płaski pokład Fable (0…7) — wynik kolidera = `ring.terrainHeightAt`. Regresja „01 → 06” zamknięta. Czasy w grze:
  kompilacja pieczenia 2,5–3,7 s w tle, teren w koliderze 2,2–4,5 s od wstania gry (ring Ziemi piecze się już w menu).
  Adapter uniformów ringu = adapter z 01 (`src/3d/tsl/uniformy.js`, re-eksport w `haloUniformsAdapter.js`),
  `createUniformBlock` zostaje w `src/3d/haloRing/`. Otwarte dla 11: menu nie czeka na `ring.ready` (ring dołącza
  2–4,5 s po Ziemi), pusta scena `createHaloBakeWarmup` do usunięcia. Inwentarz po 06: port 42 pliki z GLSL, 66
  materiałów, 8504 linie. Testy na `main`: 1389 / 7 porażek bazowych / 2 todo + niestabilne pod obciążeniem całego
  zestawu (same przechodzą): `capitalAiFlight` („ship follows a moving target…”), `hullShadowSdf` („warstwy: wspólna dla
  świeżej floty…, LRU”).
- **Część 12-A scalona do `main`** (0f3d429, 4eb03d8, dba17aa, d086021, 37953a6): `src/3d/fx/` — `lightGrid.js` (jedna siatka
  świateł z trzech kopii dem; baza = wersja asteroid: wycinek koła reflektora, brzeg smoothstep², mapy cienia, profile
  `FIELD` / `CAVE`; układ lokalny przy kamerze liczony w double; 2 bufory storage; uniformy w grupie `render`; odrzucanie
  poza kadrem; naprawiony błąd wszystkich trzech kopii — przepełnienie granic komórek w `Int16Array` dla świateł daleko
  poza kadrem; właściciel 0 = brak; tryb `optIn`: siatkę czytają tylko materiały z flagą `gridLights` — reszta ma WGSL
  identyczny jak bez siatki), `fxLights.js` (błyski z nośnikiem, zero alokacji), `fxRandom.js` (mulberry32 dla efektów;
  harness ziarni go razem z `reseed` — 09f968c), `noise.js` (szumy bit w bit jak w demach), `carrier.js` (paczka nośnika +
  lustro CPU), `gpuPoolOrigin.js` (`FxPoolOrigin`: wspólny początek przy kamerze dla pul i siatki, przeskok co 20 tys. j.,
  kernel przesunięcia, epoki zegarów co 600 s — każda pula GPU MUSI się zarejestrować), `distortion.js`
  (`DistortionField`: fala, implozja, gorące powietrze z kierunkiem; jeden bufor, `DISTORT_CAP` 32). Opis:
  `docs/webgpu/FX-INFRA.md`. Koszt CPU siatki: 1024 światła 0,7 ms, 1536 — 1,1 ms. Ryzyko: `ITEM_CAP` nasyci się w dużej
  bitwie w polu asteroid (reflektory do 14 tys. j.) — ograniczyć reflektory do najbliższych / w kadrze (21). Testy na
  `main`: 1434 / 7 porażek bazowych / 2 todo.
- **Zadanie 07 scalone do `main`** (7b43733…96baa16; scalenie f735076): teren ringu (CDLOD z kaskadowym morphem w `Loop`,
  strefy, parki, zabudowa z odciskiem zestawu, konstrukcja, cienie chmur i terenu, burze, woda, światła miast, powietrze)
  i zestaw przemysłowy (`haloIndKitTSL`, liczby części z jednej definicji `kitParts` — bliźniak JS bit w bit; na GPU 0
  rozbieżnych decyzji w 20 480 częściach) w TSL; uniformy powierzchni w bloku `haloSurfU`; GLSL terenu usunięty,
  `HALO_GLSL_SURFACE` / `CLOUDCOVER` przeniesione do `haloRingGLSL.js` dla 08–09, `HALO_GLSL_INDKIT` zostaje dla miasta (09).
  Sam teren vs WebGL: demo p1–p9 ≤ 0,105% pikseli > 8/255 (tylko krawędzie MSAA), Ultra ≤ 0,048%; gra `k7-hala__teren`
  0,10% (harness `--teren-ringu`). Kompilacja terenu 0,4–1,3 s na zimno, 63–111 ms na ciepło (11: dodać teren do
  rozgrzewki — dziś pierwsza klatka przy ringu kompiluje go na zimno). Nowe pułapki (PLAN §3 / `agents.md`): stałe
  `smoothstep` z odwróconymi krawędziami są w WGSL błędem kompilacji (`haloSmooth`); `screenCoordinate` liczy y od góry
  (`haloFragCoordGL` dla ditheru 1:1); tekstura bez uv dostaje osobny uniform mat3 — uv-atrapa; FXC liczy `a·b + c` z
  jednym zaokrągleniem, DXC z dwoma — hasze z mnożenia i dodawania przez `haloFusedMulAddInt` (bit w bit z bazą);
  `haloStormFlash` (`cyc·1,37`) może mieć tę samą rozbieżność (burze tylko na Jowiszu z ringiem Fable — dziś niewidoczne).
  Inwentarz: port 41 plików z GLSL, 65 materiałów, 7979 linii. Testy na `main`: 1442 / 7 porażek bazowych / 2 todo.
- **Zadanie 04 scalone do `main`** (3adcc5c, 7599a42; scalenie f7c3c77 + 9841cbf — znaczniki konfliktu w `agents.md`
  trafiły do commitu scalenia, poprawione osobnym commitem): kadłuby belkowe i heksowe, lakier, odłamki GPU, smugi wraków i
  impostory ciał heksowych w TSL (`src/3d/hexShips3D.tsl.js`, −543 linie GLSL). Graf na wariant (skóra belek, siatka
  heksów, płyta pancerza, pula odłamków), każdy kadłub ma lekki `HullNodeMaterial` na wspólnych węzłach, wartości per
  kadłub przez `uniform().onObjectUpdate`; tekstury per obiekt przez `HullObjectTextureNode` (`texture().onObjectUpdate()`
  w r183 nie działa); lampy i strefy dysz w buforze storage `HullLightStore` (1024 sloty, zapis przy zmianie podpisu).
  Spawn 30 NPC: CPU pierwszej klatki 14,4 ms (WebGL 37 ms, graf na materiał 389 ms); bitwa 48 okrętów bez regresji, U hex
  niższe. Harness: 0 błędów, draw calle ortho = baza, `wraki__ortho` w tolerancji (0,44% >8/255… przed kalibracją 02 —
  sprawdzić ponownie), zamienniki bitwa 31 → 25, wybuch 28 → 22, wraki 22 → 18, warp 49 → 43. Znalezione: limit 8
  buforów wierzchołków (odłamki miały 9 — przeplecione), three połyka błąd `createRenderPipelineAsync` (Core3D loguje),
  pułapki w PLAN §3. Maska słońca: zastępnik pełnego słońca w jednym miejscu (`// AGENT: po 03`). `beamDebris3D.js`
  zostaje w GLSL (materiał tylko w demach destruktora). mostki-demo: kadłuby heksowe bez zamienników; odczyt HDR
  (`readRenderTargetPixels`) i przepełnienie puli znaczników w demie → 15 / 23.
- **Zadanie 02 scalone do `main`** (a72b8fa, 777f86b, 77eef2b; scalenie eb9370b): post w TSL (`src/3d/tsl/postGry.js`) —
  `BloomGry` na `BloomNode` (ten sam algorytm co `UnrealBloomPass`: próg, 5 mipów, jądra; kompozyt ×3 jak dawny pass —
  `BLOOM_ZGODNOSC_WEBGL`; alfa z rgb bloomu; bloom raz na render — split ma własny; skala rozdzielczości), pełny „uber”
  (24 źródła gorącego powietrza, dysze z kierunkiem, dyspersja, ACES gry + sRGB) 1:1 z GLSL (usunięty z `core3d.js`: 296
  → 148 linii GLSL, została maska słońca — 03); dwa `RenderPipeline` budowane raz (z bloomem i bez — wyłączony bloom nic
  nie kosztuje); MSAA 4 → 0 → 4 bez błędów; brama `_gpuTimerGate` (pula znaczników czasu three przepełniała się w
  headless). **Tolerancja portu skalibrowana:** `kalibracja__ortho` WebGL↔WebGPU >8/255 w 0,027% pikseli (średnia 0,0188;
  po 01 było 85,8%) — różnice tylko na krawędziach po resolve MSAA; `tolerancjaPortu` = >8/255 ≤ 0,05%, średnia ≤ 0,03
  (uwaga w `baseline.json`: sceny gęste w krawędzie mogą przekroczyć próg mimo zgodności — rozstrzyga mapa różnic).
  Gorące powietrze A/B: WebGL 0,0679% vs WebGPU 0,0676% pikseli zmienionych przez haze. Koszt: render Core3D z bloomem
  1,7–1,8 ms CPU / 0,19 ms GPU (bez 0,85 / 0,107) → regresja „02 → 23”. Narzędzia: `scripts/webgpu/post-kontrola.mjs`
  (16/16), `scripts/webgpu/gorace-powietrze.mjs`. Regresja „01 → 02” zamknięta. Testy na `main` po obu scaleniach: 1462 /
  7 porażek bazowych / 3 todo (nowe todo = parzystość proxy Z4 w `shipProxyBatch3D`, do Z13); `npm test` OK.
- **Zadanie 14 zrobione na gałęzi** (9b8dad0, 9b95df5): tarcze (sfera, obrys) i trafienia w tarczę (wstęgi, bańki) w TSL,
  graf na wariant + lekki materiał per tarcza; 24 trafienia w jednej `uniformArray` vec4 pakowanej per obiekt w
  `onObjectUpdate` (domyślnie pakuje się raz na `render()` — sprawdzone na GPU: bez tego wszystkie obiekty dostają dane
  pierwszego). Parzystość z GLSL tagu na GPU (cele RGBA32F): kopuły max |Δ| HDR 7e-5…2,9e-3, 0% pikseli >2/255 po ACES;
  wstęgi 0,01% (2 piksele wyładowań — hasz z niecałkowitych wejść). Spawn 30 NPC z tarczami: 0 nowych budów NodeBuildera
  tarcz, cache stały (51) przez 388 klatek. −583 linie GLSL. Uwaga dla 03: snapshot refrakcji rysuje warstwę tarcz do
  `refractionTarget` (inny kontekst renderu — osobna, nierozgrzana budowa tarcz przy pierwszej fali). Czeka na scalenie
  `main` i sprawdzenie z bloomem.
- **Zadanie 14 scalone do `main`** (9b8dad0, 9b95df5, scalenie `main` e566f74, 02d6f02; scalenie 7703490). Po 02 i 04
  (bloom, kadłuby w TSL) sama warstwa tarcz vs WebGL: 0% pikseli >8/255 (średnia 0,0154, z gorącym powietrzem z trafień —
  po 2 źródła `special` / `shield` na obu rendererach); kadłuby + tarcze 0,053% (jedyna różnica: kłąb dymu Fx3D —
  zamiennik do 12-B); `bitwa__ortho` 1,95% (po 01 było 14,5%; zostają dysze 13 i Fx3D 12-B), `wraki__ortho` 0,25%,
  `wraki__fg` 0%. Pełne sceny poza tolerancją przez tło (mgławica, gwiazdy, słońce — 05) i światła okrętów (15).
  Zamienniki: bitwa 26 → 20, bitwa-blisko 18 → 17, wybuch 22 → 16, wraki 19 → 15, warp 46 → 40; warstwa 7 bez
  zamienników. Narzędzie A/B tarcz w grze: `scripts/webgpu/tarcze-gra.mjs` (wymuszone trafienia 4 klas). Inwentarz z
  HEAD 7703490: port 36 plików z GLSL, 55 materiałów, 6743 linie. Testy: 1469 / 7 porażek bazowych / 3 todo; `npm test`
  OK. Wyniki: `.tmp/webgpu/zadania/14`, `14-po02`.
- **Zadanie 13 scalone do `main`** (e844a7a, c85042f, 3ff03a4; scalenia `main` 23ed7d5, 49e7fdf; scalenie bd96586): MAIN
  (`mainExhaust3D`), WARP (`warpPlume3D`: raymarch, poświaty, cząstki) i SIDE (`engineExhaustBatch`: płomień + 3
  poświaty) w TSL, −607 linii GLSL / −7 materiałów; `Engineeffects.js` bez martwego `getEngineVFX` (własny
  `WebGLRenderer`) — zostają tekstury. Plazma: jeden graf na rodzaj (`Loop(44)`, 3 oktawy jako stałe grafu), instancja
  puli = lekkie materiały na wspólnych węzłach (`onObjectUpdate`); cząstki = kwady na instancjach (punkty WebGPU mają
  1 px); pętla marszu za flagą (`discard` w WGSL nie kończy wykonania); mieszanie (ONE, ONE) przez
  `src/3d/tsl/mieszanie.js` (NodeMaterial z `premultipliedAlpha` mnoży wyjście przez alfę). Płomień SIDE miał 12 buforów
  wierzchołków (limit 8) — błąd pipeline'u i utracony bufor poleceń passa ortho, niewidoczny w harnessie (padł przed
  pierwszą sceną; harness zbiera błędy per scena — do poprawy w 23: błędy startu sesji). Weryfikacja
  (`scripts/webgpu/silniki.mjs`, same dysze vs tag): bufor HDR >8/255 ≤ 0,0014% (gracz 0%), energia RGB i piksele > 0,9
  równe; z postem 02 w tolerancji (warp 0,0007%, śr. 0,0055; bitwa 0,0004%; gracz 0%); gorące powietrze dysz A/B
  identyczne; SIDE w spoczynku 0 px > 0,9 (reguła jasności). Pierwszy skok i flota 16 instancji: 0 budów
  NodeBuilder/WGSL/pipeline'ów; najwolniejsze klatki to wgrywanie geometrii `hull:beam` 170 ms przy wejściu w skok (→ 23)
  i linie Fx3D 28 ms (12-B); tag WebGL: 132 ms (nowy program). Rozgrzewka SIDE (`EngineExhaustBatch`) niedopisana — 4
  pipeline'y w pierwszej klatce gry jak dawniej (→ 11). Zamienniki silników 0 (warp 49 → 13 po 02/04/13). Inwentarz z HEAD
  bd96586: port 32 pliki z GLSL, 48 materiałów, 6136 linii. Testy: 1477 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 08 scalone do `main`** (2c87915, 9dbb513, 4d501b9, e00dd1b, 0ce79e1, fa8389b; scalenie `main` 60c7e4c;
  scalenie 979ed52): konstrukcja ringu (`HaloStructure` = NodeMaterial z `makeHaloStructureNodes`: płyty, miasto na
  ścianie, odcisk brył dachu z pozornymi cieniami, pasy świateł, światło analityczne, powietrze na ścianach; warianty
  górna ściana FG i reszta bryły; wspólny wierzchołek pasów `haloStripVertexTSL`; reguły dachu jako czyste funkcje,
  `haloRoofTSL(u)`) i atmosfera (`makeHaloCloudNodes`, `makeHaloShellNodes`) w TSL; usunięte GLSL obu modułów,
  `HALO_GLSL_CLOUDCOVER`, `haloPaletteDefines` (`HALO_GLSL_SURFACE`/`INDKIT` zostają dla 09, `HALO_GLSL_STORM` tylko
  dla narzędzia parzystości). Zgodność: demo `--set mid` (22 kadry) konstrukcja + chmury + powłoka ≤ 0,15% >8/255 (tylko
  krawędzie MSAA), Ultra ≤ 0,047%, noc ≤ 0,055%; gra: sceny ringu vs po 07/13 0%, `k7-hala` 0,0081%; nowe sceny (baza z
  tagu dopisana `baza.mjs --dopisz`): `ring-dach__ring-fg` 0,019%, `ring-dach-z01__ring-fg` 0,0015%,
  `ring-habitat__ring` 0,039%. Parzystość GPU: reguły dachu 0 rozbieżnych decyzji (4096 komórek / działek, 8192 klasy),
  hasze z wejść całkowitych 100%, hasz okien 99,4% (FMA tylko na składowej y — najbliżej bazy), kreski tarasów 99,2%.
  Kompilacja na zimno 1,1–1,7 s na wariant konstrukcji (WebGL 2,9 s; → rozgrzewka 11). Znalezione: `discard` w Tint nie
  przerywa shadera — znikająca górna ściana i puste chmury liczą pełne cieniowanie (→ 23: pomijać rysunek, osłonić
  chmury); teren w wariancie „do planety” z bliska 1,43% (`in_p1`, obszar 07). Narzędzia: `zrzuty.mjs --czesci-ringu`
  (warianty `__ring`, `__ring-tlo`, `__ring-fg`), sesja `ziemia-ring`, `halo-ring-shots.mjs --czesci`. Zamienniki:
  ring-z02 / ring-z1 44 → 40, k7-hala 41 → 37. Inwentarz z HEAD 979ed52: port 30 plików z GLSL, 45 materiałów, 5417 linii.
  Testy: 1486 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 03 scalone do `main`** (5adc702, 65d92a2; scalenie f487d2f — konflikt w notatkach `inwentarz.mjs`): pass maski
  słońca w TSL (`QuadMesh` + NodeMaterial, graf raz w `init()`: dyski, SDF kadłubów, pole przesłaniające, ringi tylko w
  kanale G, szum ±0,5/255 z pikselem jak `gl_FragCoord`), `uSunShadowOn = 0` zdjęte, kubełek `shafts`; biblioteka
  `sunShadowMask.js` w TSL (`sunVisibility`, `sunFill`, `sunShadeUnlit`, `sunShaftBackdrop`, `sunShadowSample`,
  `fieldDarkness` po `screenUV`, wspólne węzły uniformów); `applySunShadowToBuiltinMaterial` z tą samą sygnaturą — hak
  w polach materiału (`setupLightingModel` gasi człon bezpośredni, `outputNode` kładzie smugę), bez `onBeforeCompile`;
  SDF kadłubów `hullSdfShadow` 1:1 z lustrem CPU; maska kadłubów z 04 podmieniona (w grafie wariantu); fala uderzeniowa w
  TSL (graf na menedżera); miejsce na pass zgięcia tła warpa w `render()` po passie tła (przepis dla 22). −303 linie
  GLSL; napis GLSL maski dla nieprzeniesionych w `sunShadowMaskGLSL.js` (regresja „03 → 24”). Three r183 w WebGPU
  ignoruje `layerUpdates` — pieczenie SDF wgrywało całą tablicę 4 MB (2,3–3,1 ms CPU) → `Core3D.uploadTextureLayer`
  (0,03–0,05 ms). **Weryfikacja:** `scripts/webgpu/maska-slonca.mjs` czyta cel maski w grze na tagu i na WebGPU —
  ring-z02 0%, planeta-cien 0% (maks. 1), bitwa (SDF) 2 piksele (maks. 5/255), pole syntetyczne 0,0001%; harness:
  `k7-hala__ortho` 3,31% → 0,0023% (w tolerancji), `kalibracja__ortho` 0,027%, `wraki__ortho` 0,061% (krawędzie i
  dither odłamków, tuż nad progiem), sceny bez kadłubów w cieniu bez zmian (0%), 0 błędów walidacji. Fala
  (`scripts/webgpu/fala-uderzeniowa.mjs`, tag ↔ WebGPU): 0,21–1,6% >8/255 (szum `sin` i krawędzie MSAA, obraz ten sam).
  Cel refrakcji = format / MSAA / głębia `composerTarget` (HalfFloat, ~16 MB przy 1080p przy pierwszej fali; odczyt
  obcięty do [0, 1] jak dawny RGBA8) — snapshot korzysta z rozgrzewki `prewarmPass`, pierwsza fala = 1 budowa (sama
  fala). Zostawione 1:1 z tagu (do rozstrzygnięcia w 19): snapshot bierze środkową połowę kadru (tło w fali ×2) i fala
  ma cyjanowy obrys (kłóci się z „bez świecących okręgów”). Materiał fali nierozgrzany (→ 11). Koszt passa maski: +1 draw
  call, ~0,1 ms GPU (→ 23). Inwentarz z HEAD f487d2f: port 27 plików z GLSL, 44 materiały, 5149 linii, `onBeforeCompile`
  0. Testy: 1495 / 7 porażek bazowych / 3 todo; `npm test` OK. Po scaleniu: 05, 15 i 12-B scalają `main` i podmieniają
  zastępniki maski.
- **Incydent 2026-09-28 ~01:50–02:15: dysk C: pełny** (harness 12-B padł z ENOSPC). Przyczyna: narzędzia CDP (`dema/rdzen-cdp.js`,
  `scripts/webgpu/wspolne.mjs`, skrypty dem) zostawiały profil headless Chrome w `%TEMP%` po każdym przebiegu (~60 MB z
  pamięcią shaderów) — ~1000 profili. Usunięte profile starsze niż 60 min (C: 0,08 → ~170 GB wolne); poprawka aa500c7
  (`closeChrome` czeka na wyjście Chrome i kasuje profil). Skrypty dem z własnym startem Chrome (`halo-ring-shots.mjs`,
  `mostki-*.js`, `precyzja-drzenie.js` itd.) nadal zostawiają profile — do 24 (wspólny `closeChrome`); do tego czasu
  orkiestrator trzyma w tle pętlę kasującą profile starsze niż 45 min.
- **Część 12-B scalona do `main`** (819fd85, 0c67d84, ebc4211, a029a03, 59e0571, 7168783; scalenia `main` 2d0c845, f28c3ee,
  edf672e; scalenie 72ec255): Fx3D w TSL (`fxParticles3D.js`: 4 wspólne grafy wierzchołków BB / PLUME / CROSS / WASH + jeden
  fragmentu, tekstura per obiekt `FxMapNode`, wysyłana tylko żywa część atrybutów; −67 linii GLSL); `Core3D.fx`
  (`src/3d/fx/fxFrame.js`) = klatka efektów raz na rAF przed passami: spawn → początek pul → kernele przesunięcia → siatka
  świateł → update; API `Core3D.addFxStep({ spawn, lights, update, warm })`, `fx.grid` / `fx.lights` / `fx.origin`,
  wiersz „Efekty GPU” w PerfHUD. `GridLighting` w trybie „optIn” ustawiany PRZED `renderer.init()` (pułapka r183: three
  zapamiętuje `renderer.lighting` w `init()`, podmiana po nim po cichu nie działa) — 67 programów WGSL identycznych z
  siatką i bez. Zniekształcenia w „uber” (`Core3D.fxDistortion()` + warstwa DIST 10, cel RG HalfFloat,
  `setDistortLayerActive`) w osobnej gałęzi — bez źródeł „uber” bit w bit jak 02. Siatka bezpieczeństwa NaN/±Inf
  (`hdrBezpieczny`, test bitów wykładnika) na wejściu bloomu i przy odczytach sceny (kwad z NaN: 1600 px zamiast 1,78 mln).
  Kontrola GPU `scripts/webgpu/efekty-kontrola.mjs` A–F OK. Koszt: pusta siatka +0,006–0,009 ms GPU na pełny kadr 1080p,
  256 świateł +0,5 ms GPU / 0,25 ms CPU budowy; CPU pustej klatki efektów 0,005 ms, 0 dispatchy. Harness: zmiany tylko w
  scenach z Fx3D; zamienniki bitwa 15 → 9, bitwa-blisko 12 → 8, wybuch 11 → 8, wraki 10 → 8, warp 10 → 9; `bitwa__ortho`
  vs WebGL 1,30% → 1,02%. Iskry MAIN (`silniki.mjs --post` z Fx3D vs tag): HDR bitwa 0,016%, spoczynek 0,0056%, warp
  0,0017%, gracz na dopalaczu 0,067% (> 0,05% — linie 1 px rasteryzują się w Dawn inaczej niż w ANGLE, WebGL dawał ujemny
  HDR na brzegach linii; przyjęte). Decyzje: zegar efektów z klatką rAF (także w pauzie), kadr siatki = kadr kamery +15%
  (split: suma), NaN/Inf → 0 (demo dawało 60 000 → plama), osie DIST ujednolicone (demo broni miało y odwrócone). Znalezione:
  kwady WASH w Fx3D odwrócone tyłem (nie rysowały się też na WebGL — 1:1). Plan wpięcia dla 17/18/19/21:
  `docs/webgpu/FX-INFRA.md` §9 (każda pula GPU rejestruje się w `Core3D.fx.origin` z kernelem przesunięcia, efekty jako
  `addFxStep`, światła przez `fx.lights`, fale przez `fxDistortion()` / DIST; w 18 kadłuby czytają siatkę jawnie
  `grid.loop`). Inwentarz z HEAD 72ec255: port 26 plików z GLSL, 43 materiały, 5082 linie. Testy: 1509 / 7 porażek
  bazowych / 3 todo; `npm test` OK.
- **Zadanie 05 scalone do `main`** (b6eb4f3 port, 40224bb maska z 03, 24d31b2 A/B gwiazd w skoku; scalenia `main` c0bc1d0,
  970e800, 70551cb; scalenie 2245c90): planety (dzień/noc, mapa normalnych Ziemi, mgiełka, analityczny pas cienia ringu,
  `uPlanetBloom`), chmury, poświaty, poświata limbu, słońce z koroną, mgławica i gwiazdy w TSL
  (`src/3d/planet3d.assets.tsl.js`); `planet3d.assets.js` bez GLSL (−191 linii, 7 materiałów). Graf RAZ na rodzaj ciała
  (~20–27 ms CPU raz zamiast 9×), lekki `PlanetBodyNodeMaterial` per ciało, wartości w `material.uniforms` (kontrakt
  `window.EARTH` bez zmian), tekstury przez `PlanetObjectTextureNode`. Gwiazdy = kwadraty instancjonowane (punkty WebGPU
  mają 1 px; bok ≥ 1 px, `gl_PointCoord` jak GL); **rozciąganie gwiazd w skoku i bicz przy wyjściu przeszły 1:1** (A/B
  `gwiazdy-skok` 0% >8/255; `setWarpStarsObject` dalej no-op, wymiana w 22). Poświata limbu `CustomBlending` ONE/ONE z
  `premultipliedAlpha = false`; chmury `forceSinglePass`. Maska: `sunVisibility()` na ciałach przy ringu,
  `sunShaftBackdrop()` na mgławicy i gwiazdach. Stacje i stacja piracka — materiały wbudowane, bez zmian w kodzie.
  Harness (0 błędów): w tolerancji `slonce` (0,0028% / 0,0079), `hud`, `ring-z1`, `kalibracja`, `wybuch`,
  `bitwa-blisko`, `__tlo` scen kosmosu; tło bez zamienników. **`planeta-cien` przyjęte decyzją orkiestratora** (mapa
  różnic): 0,32% >8/255, z czego poza prostokątem stacji Wenus (szum obrotu, 1,2% kadru) 836 px = 0,041% w każdym
  przebiegu, przy krawędzi poświaty Wenus (średniej tego obszaru wg harnessu nie liczono); w wariancie `__planety` (762 px)
  to kropkowany łuk poświaty w bazie WebGL (451 px, artefakt MSAA, ten sam co zakazana w agents.md powłoka-kula; nie
  odtwarzany) + 1-px krawędź limbu (311 px); `__planety` 0,037% / śr. 0,0415 (łuk), `__tlo` 0,90% = przeciek
  poświaty w izolacji warstw na tagu (poza pierścieniem ±40 px: 3 px). A/B w grze (`scripts/webgpu/planety-gra.mjs`):
  planety i księżyce ≤ 0,040%, gwiazdy i gwiazdy w skoku 0%, stacja piracka 0,022%, stacja Wenus 0,25% (krawędzie).
  Pułapka: podzbiór `--sceny` zmienia drogę kamery gwiazd i czas słońca — porównywać w pełnych sesjach (PLAN §3).
  Znalezione: sprite blasku słońca ładuje brakujący `assets/effects/glow.png` (404, niewidoczny w obu rendererach — 24);
  `dema/asteroidy.html` i `dema/warp-demo.html` (WebGL, poza portem) dostają mgławicę i gwiazdy z TSL — nietestowane.
  Inwentarz z HEAD 2245c90: port 25 plików z GLSL, 36 materiałów, 4891 linii. Testy: 1515 / 7 porażek bazowych / 3 todo;
  `npm test` OK.
- **Zadanie 09 scalone do `main`** (5e3a666, 09e4b09, 8b915ed; scalenia `main` 7ac8d07, 11aaa9e, eb3d21d; scalenie ab3c820):
  megastruktura (bryły dachu FG i doków, szkło kopuł, pociągi, światła dachu i doków) i miasto (ogrody, przemysł, drzewa)
  w TSL; fragment brył `makeHaloPrimFragment` wspólny, dawne `defines` (HALO_FG, PRIM_FACE_FROM_LOCAL) = warianty
  budowane raz, wczesne `collapse(); return;` w wierzchołkach = zagnieżdżone gałęzie (mapy czyta tylko żywy
  wierzchołek), pochodne (`fwidth`) przed gałęziami. −966 linii GLSL, −7 miejsc `ShaderMaterial`; `HALO_GLSL_SURFACE`
  usunięty, `HALO_GLSL_INDKIT` tylko dla narzędzia parzystości (K-7 i archetypy go nie czytają). **`haloFma`**
  (`haloRingTSL.js`, wbudowane `fma()` WGSL przez `wgslFn` — TSL r183 nie ma `fma`; Tint → HLSL `mad`, ten sam rozkaz
  co FXC w bazie): bez niego fasady megabudowli nocą świeciły innymi oknami (71,7% ziaren zgodnych), z nim ziarna i
  hasze okien / paneli / fasad 100% bit w bit (`lm2_night` 0,65% → 0,14%). Zgodność (same bryły, demo): miasto z bliska
  ≤ 0,0012%, dachy / porty / megabudowle 0,07–1,25% (p9 2,3% — krawędzie MSAA, aliasing okien 1–2 px), miasto nocą
  0,010%, Ultra 0,02–0,46%; gra `__ring`: k7-hala 0,049%, ring-dach 0,060%, ring-dach-z01 0,39%, ring-habitat 0,107%.
  Draw calle = 08, HDR i NaN jak w bazie, 0 błędów walidacji; zamienniki `ring-z02` 35 → 24, `k7-hala` 32 → 21 (reszta
  = K-7 → 10). Kompilacja na zimno 0,12–0,50 s na materiał (→ 11: rozgrzewka 9 materiałów, ~2–3 s). Hipoteza do 23:
  resztkowe różnice krawędzi — FXC scala `mad` także w wierzchołkach, pochodne na czwórkach pikseli. `halo-ring-shots.mjs`
  kasuje swój profil Chrome, opcja `--repo` (baza dema z innego drzewa). Inwentarz z HEAD ab3c820: port 22 pliki z GLSL,
  29 materiałów, 3925 linii. Testy: 1524 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 15 scalone do `main`** (90b73f3, 67f5d8b, 0d20cf4, b366146, 0c292d4, f1bf060, 5e383a0, e39d5ab, 172d1d3; scalenia
  `main` 45a927b, 7286401, c60ee1c, 7f49da8, ab7ca8a; scalenie ca83cd4): światła pozycyjne (`shipLights3D`), szczeliny okien
  (`bridgeFx3D`), model mostka (`bridge3D` + `bridge3D.tsl.js`: bryła, cień na kadłubie GreaterDepth, okna), reaktor
  (`reactor3D.tsl.js`) i efekty rdzenia (`coreFx3D.tsl.js`) w TSL, −998 linii GLSL. Mostek: jeden graf bryły na 11
  rodzajów (Mesh + InstancedBufferGeometry, instancja = 30 liczb w jednym przeplecionym buforze, stałe rodzaju w
  `uniformArray`), maska słońca z `sunShadowMask.js`. **Obrażenia mostka w buforze storage u32 z zakresami** zamiast
  tekstury 768 × 512 (backend WebGPU ignoruje zakresy tekstur — każda zmiana = 1,5 MB): `benchDamageUpload` < 0,005–0,01 ms
  zamiast 0,72–1,35 ms na klatkę ze zmianą. Harness vs `main`: 0 błędów, stan i draw calle równe, zamienniki −1 w 12
  scenach (kalibracja, bitwa, warp, split bez zamienników); vs baza `bitwa__fg` 11,1% → 0%, `split` 4,49% → 0% (w
  tolerancji), `bitwa` 15,7% → 0,62%, `k7-hala__fg` 3,8% (reszta K-7 → 10). Dema obok tagu: pasma HDR okien 10 kadłubów
  równe, cień mostka na kadłubie 2,17% / 2,16% pikseli, rdzeń 0,33–1,27%, drżenie modelu ≤ 0,019 px (baza 0,021).
  Narzędzia dem (`precyzja-drzenie`, `mostki3d-drzenie`, `mostki-shots`, `mostki3d-shots`) na WebGPU i kasują profile
  Chrome. Pułapki (PLAN §3): `DynamicDrawUsage` = pełny `writeBuffer` przy każdym renderze (wysyłać tylko zakresy);
  macierz `InstancedMesh` > 1024 synchronizowana raz na klatkę rAF (narzędzia z wieloma renderami w klatce);
  `textureSample` w niejednolitym przepływie. Otwarte → 23: brama znaczników czasu liczy miejsce raz na klatkę rAF, a
  dema renderują wiele razy (ostrzeżenie o przepełnieniu); żar krawędzi w demie rdzenia 1–3% ciemniejszy (materiał
  kadłuba). Mostki i rdzenie na kadłubach belkowych nadal nieaktywne (etapy 4–5 portu belek). Inwentarz z HEAD ca83cd4:
  port 19 plików z GLSL, 24 materiały, 3429 linii. Testy: 1531 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 16 scalone do `main`** (2dd8c5f, e676d1b, b00dd2f; scalenia `main` 99d1f12, 05f429b; scalenie 82573e5): rozpad na
  trójkąty i implozja w TSL (`shatterMaterial.js`, `destruction3D.js`: grafy budowane raz, lekki `ShatterNodeMaterial` per
  mesh na wspólnych węzłach, mapa per obiekt przez nowy pomocnik `src/3d/tsl/teksturaObiektu.js`), −172 linie GLSL / −2
  materiały. **Kawałki skorupy po `detachChunk` tną się maską TSL** (`maskNode`, płaszczyzny per obiekt) — WebGPU ignoruje
  `material.clippingPlanes` (przed portem każdy kawałek rysował całą bryłę), a `ClippingGroup` r183 daje kawałkom o tym
  samym kluczu płaszczyzny pierwszego. Klony GLB dzielą węzły cienia z oryginałem; rozgrzewka przy `prebake`
  (`requestIdleCallback`) + pass cienia na warstwie 31 przez 2 klatki; `map = null` w cieniu (błąd `texture(undefined)`
  już na `main`). Klatka rozpadu (mediana): Wenus 80 → 22 ms, Merkury (trójkąty) 36 → 27 ms, podział fragmentu 29 → 4,4
  ms, Neptun 64 → 4,9 ms — wszędzie 0 budów (tag WebGL 171–378 ms). **Nowa sesja bazy „stacja”** (`stacja-rozpad`,
  `-odlamki`, `-trojkaty`, `-implozja`, `-ciecie` + warianty warstw i `__3d` / `__fg-3d` bez overlaya; baza z tagu
  `--uuid osobne`, szum p1↔p2 0% >2/255 w 35 zrzutach) — `baseline.json` ma 98 scen. Wynik `__fg-3d` vs tag: odłamki 0%,
  rozpad 0,54% (91% na krawędziach), trójkąty 6,5% (74 tys. trójkątów, 85% na krawędziach), implozja 1,57%, cięcie
  1,21% (`scripts/webgpu/krawedzie.mjs` dzieli różnice na sylwetki i wnętrza); 0 zamienników i 0 błędów (przed portem
  trójkąty 90% magenty). **Błąd do 23:** WebGPU liczy jedną mapę cienia ze wszystkimi warstwami, więc łapacz cienia
  warstwy 0 (`Core3D.shadowCatcher`) dostaje cień stacji z FG (WebGL: mapa per pass z warstwami kamery) — główne źródło
  różnic pełnych klatek po rozpadzie. Wygaszenie bryły (5 klatek): WebGPU rysuje wszystkie tyły, potem przody
  przezroczystych DoubleSide (WebGL obiekt po obiekcie). **Decyzja wyglądu dla użytkownika:** odłamki paneli czarne jak na
  tagu (WebGL przy `vertexColors` bez atrybutu mnożył przez 0, WebGPU daje biel — kolorowe odłamki `instanceColor`
  to jedna stała `PANEL_SHARD_BASE_COLOR` = 0xffffff). Znalezione, nienaprawione: `_cloneShellHierarchy` kopiuje
  `__sharedTemplateAsset` do klonów kawałków (geometria i materiały nigdy nie zwalniane — 24); stacja piracka bez sceny
  (`startMercenaryMission` nie na `window`); `dema/station-destruction-sandbox.html` tylko z tagu. Narzędzie
  `scripts/webgpu/rozpad-stacji.mjs`. Inwentarz z HEAD 82573e5: port 17 plików z GLSL, 22 materiały, 3257 linii. Testy:
  1542 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 10 scalone do `main`** (09b532c, f4d4bb5; scalenie `main` 6092010; scalenie 3794883): hala K-7 (instancje z
  kwaternionem i grupą ruchomą, płyty, napisy z atlasu, węże) i ringi-archetypy Marsa (ECUMENE) i Jowisza (Fable) —
  instancje, pasy z atlasem, szkło, kratownice, światła pozycyjne, powierzchnie dzielnic — w TSL; `arch/archGLSL.js` →
  `arch/archTSL.js`, −1067 linii GLSL. K-7: graf na ring (4 hale Ziemi = jeden NodeBuilder na rodzaj i stan), wartości hali
  per obiekt (`onObjectUpdate`, tablice `k7Groups` / `k7Surf` o stałych nazwach, atlas przez `teksturaObiektu`). Archetypy:
  partie = `Mesh` + `InstancedBufferGeometry` z jednym przeplecionym buforem (`InstancedMesh` = NodeBuilder na każdą z
  ~40/~100 partii), światła pozycyjne = kwadraty instancjonowane, hasze okien / paneli / kratek i ziarno instancji przez
  `haloFma` / nowe `haloFmaVec2` (parzystość GPU 100%, naiwnie 82,5–99,98%). **Harness vs baza:** `mars-ring` 0,036% (śr.
  0,011), `jowisz-ring` 0,028%, `ring-z02` 0,034% — w tolerancji z wariantami; `k7-hala` 0,108% = miasto 09 w rogu 0,078%
  (bit w bit jak po 09) + 0,030% (krawędzie strzałek i lampek), `__fg` 0,006%; `ring-dach` / `-z01` / `ring-habitat` 0,20 /
  0,55 / 0,35% (gęste krawędzie; przed 10: 8,4 / 6,1 / 7,2%). **Zamienniki: 0 we wszystkich scenach gry poza `menu`** (3 w
  tle menu → 11); 0 błędów, draw calle = `main`. Demo (tag vs port, bez otoczenia): hale i porty 0,05–0,42%, mediana
  kadrów 0,66–1,12%, maks. 3,1% (`transit` Jowisza — krawędzie MSAA i z-fighting brył w `archPort.js`, migocze też w bazie).
  Post dema = `BloomGry` ×3 (wcześniej 3× słabszy od bazy). Inwentarz z HEAD 3794883: port 12 plików z GLSL, 15
  materiałów, 2197 linii. Testy: 1549 / 7 porażek bazowych / 3 todo; `npm test` OK.
- **Limit sesji API (~04:00–04:40):** podagenci 17, 18-C, 19, 21, 22 przerwani w trakcie („session limit”) — wznowieni po
  resecie (`SendMessage` do ich id, praca z niezacommitowanymi zmianami w worktree); 10 skończyło przed limitem.
- **Zadanie 17 scalone do `main`** (17-A 25123a4, 17-B e002a65, 17-C 5374728, 17-D 4e2d332, 17-E e575f23, 17-F 3992955, fae3257;
  scalenia `main` 6ebbc29, 91d7964, 1bb1866, c243359; scalenie 753700e): efekty wszystkich 27 broni z dema w
  `src/3d/weapons/` (8 plików): tabela `WEAPON_FX` (broń → rodzina receptury), pule GPU ADD / SPARK / SMOKE / DEBRIS /
  DIST / ARC z nośnikiem i początkiem przy kamerze (`Core3D.fx`), receptury na `fxRandom` bez obiektów na strzał (fasada
  `WeaponFx` — słuchacz `WeaponShotBus`), pociski 8 stylów w 1 draw callu, smugi, wiązki (ciągła, impulsowa, laser PD);
  **laser PD i flak z kanwy 2D do 3D**; Hexlance (rzaz + wyjście za burtą), `coreFx3D` i `rdzen-demo` na recepturach;
  limit 48 pełnych wylotów i trafień na klatkę (ponad limit tani błysk). Usunięte: `slugTrail3D`, `muzzleFx3D`,
  `railgunFx3D`, `railgunExplosion`, `armataImpact`, `autocannonImpact`, `yamato`, `flakBurstVfx` (3536 linii), `trigger*3D`
  broni, fabryki broni w `startOverlay3D`, `spawnLaserBeam`; `weapon3DSystem.js` = 15-liniowy łącznik wstrząsu dla
  `supernovaMissileBlow.js` (do usunięcia w 19). −403 linie GLSL. Harness: 0 błędów; sceny bez broni ≤ 0,02% wobec `main`
  (planeta-cien 0,16% — szum stacji, słońce 0,05%); `bitwa`, `bitwa-blisko`, `wybuch` — stan gry identyczny z `main`;
  `wraki` / `warp` rozjeżdżają się (regresja „17 → 23”). Nowa sesja harnessu `galeria` (15 rodzin + przegląd) — zrzuty
  gry obok dema w `.tmp/webgpu/zadania/17/` (`webgpu/galeria-*.png`, `demo/`) **do oceny użytkownika**. Wydajność (bitwa
  deterministyczna 48 okrętów): CPU Core3D +0,3–0,6 ms (w rozrzucie ~1,5 ms), GPU 0,647 → 0,671 ms, draw calle 80 → 84;
  pierwsze salwy bez przestojów (maks. 19,5–47 ms; `main` 26–74 ms). Decyzje: iskry bez kolizji z kadłubami, barwy wiązek z
  `vfxColor`, torpedy w `bullets` stylem armatnim, zestrzelona rakieta i śmierć NPC = wybuch drona z dema, wstrząs przy
  trafieniu tylko gdy gracz strzelał / oberwał. Dla 18-B: receptury `kerf` / `exit` / `stuck` i `WeaponFx.charge` gotowe;
  dla 18-C: `ctx.stamp` w `WeaponFx._createCtx` pusty (do wpięcia w mapę ran); dla 19: flaga warstwy zniekształceń łączona
  przez OR (dziś ostatni zapis wygrywa), przejąć rakiety z `bullets`. Inwentarz z HEAD 753700e: port 10 plików z GLSL, 12
  materiałów, 1794 linie. Testy: 1566 / **6** porażek bazowych (`weaponAim:144` zniknęła) / 3 todo; `npm test` OK.
- **Zadanie 22 scalone do `main`** (97f97b2, de2ed96, 3e8c98d, 83b3735, 4b08a27; scalenia `main` 3b93795, f43d903; scalenie
  e9f4285): warp „Nurt” w grze (`src/3d/warp/`, sterownik `WarpNurt` w `warpNurt.js`): ośrodek (`medium.js`, 1 mln drobin
  w compute, krok 1/240 s, pass `warp` na warstwie 8; włącza się tylko przy bańce / szczelinie blisko kadru, zasypia 4 s
  po ostatniej, po wybudzeniu i skoku kamery zaczyna od nowa, przy oddalaniu dosypuje drobiny na brzegi), skok gracza na
  automacie `GameState.warp` (`player.js`), przyloty i odloty NPC (`arrivals.js`; oś odlotu = czysta funkcja
  `createWarpDeparture` / `sampleWarpDeparture` w `warpDrive.js`, 1:1 z dema), szczeliny / błyski / smugi sylwetki
  (`sprites.js`), płaskie smugi gwiazd i front wyjścia (`stars.js`), zgięcie mgławicy w jej materiale (`skyBend.js`), fale
  = sama refrakcja, kadłub: odsłanianie / szew / żar brzegu (uniformy per obiekt; żar z mipmapy sprite'a — świeży okręt
  nie ma jeszcze SDF), plazma WARP z `warpPlume3D`, kolano bloomu (`bloomKnee.js`: dema liczą bloom bez ×3 gry). Usunięte:
  `warpLens3D`, `warpWorldLens`, `warpFx3D`, `warpLensPass`, no-opowe API warpa w Core3D, stare `dema/warp-demo.*` (zostają
  na tagu), dawne efekty 2D warpa w `index.html`, testy `warpLens3D` / `warpSpace` / `warpWorldLens` (−364 linie GLSL; grupa
  „warp” inwentarza = 0). Koszt (RTX 5080, 1080p): poza warpem 0 kroków compute i 0 draw calli (`passes.warp` = 0 w 41
  scenach bez warpa); w locie rysowanie ośrodka ~0,57 ms + compute 0,24 ms (60 Hz) / ~0,1 ms (144 Hz) + reszta ~0,1 ms —
  klatka GPU 1,01 ms (poza warpem 0,32 ms); 5 s po wyjściu wraca do 0,33 ms. Harness: 50 scen, 0 błędów, sceny bez warpa
  identyczne z przebiegiem po 17 (lub w szumie); zrzuty gry obok dema (9 chwil: ładowanie, skok, lot, wyjście, po wyjściu,
  zwiastun, przylot, ładowanie odlotu, odlot) w `.tmp/webgpu/zadania/22/obok-dema/` — **do oceny użytkownika**. Decyzje:
  soczewka świata i kop kamery nie weszły (lista decyzji wyglądu); przyloty w rozgrywce z wyrzutem „od razu” (gra zna okręt
  dopiero przy spawnie — pełna oś ze zwiastunem w API `planArrival` / `planFleetArrival`); odloty = gotowe API (gra nie
  odsyła okrętów); ładowanie 0,8 s w grze (demo 3 s) — naprężenie ×3,75, wzbudzenie ×3,75^0,6. Otwarte → 23: krok ośrodka
  przy fizyce 120 Hz niesprawdzony; split — efekty „Nurtu” tylko dla gracza 1. → 24: martwy panel „Warp Wormhole VFX”
  (`devTools.js`), wpis `warpLens` w `liveDebug.js`, reguła `warp` w `inwentarz.mjs`, wzmianka w `planety-gra.mjs`.
  Inwentarz z HEAD e9f4285: port 10 plików z GLSL, 12 materiałów, 1794 linie; razem 28 / 51 / 5865. Testy: 1544 / 6
  porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 19 scalone do `main`** (877f8ac, 1d60e1e, 079805c, 2025ba7, b2dabc4, b697ae9; scalenia `main` 144b0f7, 6f0774a,
  26636ce; scalenie 2adf8fb): wygląd rakiet z dema w Core3D — `src/3d/rockets/` (13 modułów TSL: dym compute, płomienie,
  kadłubki, kule ognia, łuki, mgławica pozostałości, duszki blasku, iskry, reżyser efektów, krok „rakiety”); `rocketSystem3D.js`
  dalej prowadzi lot, trafienia i obrażenia i tylko zgłasza zdarzenia (losowanie wyrzutu przez `Math.random` gry bez zmian —
  test). Dym: pula na początku przy kamerze z kernelem przesunięcia, mapa gęstości z samocieniem, światło z siatki; siła
  śladu tylko na dym > 0,8 s (bug V usunięty). Supernowa: przygaszenie / podbicie bloomu przez nowe `Core3D.fx.post`, fala =
  sama refrakcja przez `fxDistortion()`. Iskry: `SparkSystem3D` z tym samym API na puli z dema, barwa per iskra
  (`burst` barwi swoją serię). Usunięte: `rocketFireGPU.js`, `rocketSmokeGPU.js`, `supernovaMissileBlow.js`,
  `shockwave3D.js` (fala z refrakcją — rozwiązuje obie uwagi z 03), `weapon3DSystem.js`, `fala-uderzeniowa.mjs`, warstwa raw
  rakiet w overlayu; −629 linii GLSL, −5 `ShaderMaterial`. Flaga DIST łączy zgłoszenia przez OR (`FxFrame` kasuje ją na
  starcie klatki). Pierwsza salwa i pierwsza Supernowa: 0 budów (poprawka rozgrzewki — licznik instancji jak w rysowaniu;
  kula ognia 115 ms → 0), narzędzie `scripts/webgpu/rakiety-pierwsza.mjs`. Bitwa z ~17 rakietami (36 tys. cząstek dymu):
  klatka 13,2 → 14,2 ms, GPU 0,66 → 0,73 ms, draw calle 85 → 89 (dawne rakiety w osobnym kontekście overlaya — ich koszt nie
  wliczał się do coreRender); po scaleniu z 17: klatka 10,1 ms, rakiety 0,2 ms. Receptura trafienia w tarczę (propozycja):
  głowica pęka na obrysie pola, błysk w barwie pola, iskry stycznie, krótka fala i sadza, bez kuli ognia. Nowa sesja
  harnessu „rakiety” (5 scen, 0 błędów, 0 NaN); zrzuty gry obok dema w `.tmp/webgpu/zadania/19/obok/` — **do oceny
  użytkownika**. Sceny bez rakiet bez zmian (planeta-cien 0,11% — przesunięcie losowań: iskry na `fxRandom`). Torpedy i Osa
  (2D, `bullets`) z tymczasowym wyglądem z 17 — poza zakresem. Dla 20: w overlayu został tylko `reactorblow`,
  `withRawLayer` nieużywany (pilnuje go `overlayContextMerge` 1–3), martwa gałąź `useShockwave3D` w `reactorblow`.
  Inwentarz z HEAD 2adf8fb: port 6 plików z GLSL, 7 materiałów, 1165 linii. Testy: 1561 / 6 porażek bazowych / 3 todo;
  `npm test` OK.
- **Część 18-C scalona do `main`** (7e7fd3d, d4c20d5, b8320cb, 86f2314, fdeb3fc, ef66506, 2bf83c8, 38b8d01, ee1fc5d; scalenia
  `main` 942f1d5, cfaebf1, 51139f0, 4852806; scalenie 1dd742a): mapa ran z dema broni na skórze kadłubów belkowych
  (`src/3d/hullDamageMap.js`, `hullDamageMap.tsl.js`, `hullDamageStamps.js`) — żar stygnący z bieli w czerwień, osmalenie,
  lej (ciemne dno, brzeg 8–12 HDR; dziury robi geometria belek), przestrzeliny małego kalibru bez zniszczonego węzła,
  poświata jonowa; w uv skóry (rana jedzie z odkształceniem), wrak i odłamy dziedziczą rany (`dmgKey`), naprawa R je
  wygasza (hak `onRepair`). Pula slotów L/M/S z LRU w jednym buforze storage (24 MB GPU, kopia CPU oddana po wgraniu),
  kernel w kroku efektów tylko dla slotów ze stemplami i gorących w kadrze (stygnięcie wzorem zamkniętym). Stemple: hak
  `HullBodies.onImpact` po każdym kraterze i rzazie (rodzina z `HullDamageMap.setSource` — 7. argument `applyHexImpact`),
  `ctx.stamp` receptur 17 → `stampRecipe` (duplikat krateru z tej klatki pomijany), API `stampAt` / `stampKerf` dla 18-B.
  Światła efektów z siatki (12) jako dodatkowe światła poszycia (lampy statku bez zmian); lakier gaśnie na osmaleniu i w
  leju; płonąca wyrwa tli się, póki płonie. Koszt (bitwa 24 × 24): compute +0,003 ms GPU, klatka GPU 0,63 vs 0,62 ms, krok
  efektów CPU +0,04 ms, U hex bez mierzalnej zmiany. Harness 55 scen, 0 błędów, stan świata = `main`; obraz różni się
  tylko przy trafieniach (bitwa 10,4% — błyski luf na poszyciu, Supernowa 27% — jej światło na pancerniku). Zrzuty obok
  dema: `.tmp/webgpu/zadania/18c/rany-obok-dema.png`, `rany-gra/` — **do oceny użytkownika**. Testy: 1578 / 6 porażek
  bazowych / 3 todo; `npm test` OK. **Dopięte przez orkiestratora** (2758313): trafienie rakiety w kadłub zostawia ranę
  (stempel `rocket` w `src/3d/rockets/effects.js` — rakiety nie robią krateru, więc bez tego nie zostawiały śladu); harness
  sesji rakiety 0 błędów, 0 NaN.
- **Zadanie 22b scalone do `main`** (75af962, 8d3953f; scalenie `main` 575e550; scalenie c7a7f6a): kop kamery przy skoku
  warpa i impulsy zoomu z dema „Nurt” W RIGU kamery (`src/game/cameraRig.js`: `stepCameraRigWarp` — oś w czasie gry, w
  pauzie stoi; zdarzenia `noteCameraRigWarp` z `engageWarp` / `exitWarp`). Skok: kamera cofa się wzdłuż kursu o 140 px ×
  impuls(0,05 / 0,42 s) PO sprężynie riga (szczyt 96 px po 0,11 s przy 1080 wierszach), zoom ×(1 − 0,1·impuls); ładowanie:
  zoom lerp(1 → 0,55) po ułamku ładowania, drżenie do 4 px; wyjście: powrót 0,55 → 1 (easeOut³, 1,4 s) z impulsem +10%.
  Zoom = przejściowy człon log(zoom) w sprężynie zoomu (`camera.zoom = zoomBase·e^człon`; zoom gracza i `targetZoom`
  nietknięte — po wyjściu dokładnie zoom gracza). Warp „Nurt”: bańka z prędkością statku, nie kamery (inaczej przygasała
  przy kopie). Opcja menu → Sterowanie „Kop kamery przy warpie” (`OPTIONS.cameraWarpKick`), strojenie `warp*` w
  `cameraRigTune` (F12 → Kamera). Pomiar w grze = demo ±0,005 zoomu w 13 chwilach; sesje harnessu `warp-kop` i
  `warp-kop-wyl` (A/B); zrzuty gry obok dema w `.tmp/webgpu/zadania/22b/obok-dema/` — **do oceny użytkownika**. Otwarte:
  po skoku statek zostaje przed środkiem kadru ~0,5 s (demo ~0,2 s — sprężyna nawigacji riga), po wyjściu statek leci
  dalej (demo staje). Testy: 1589 / 6 / 3; `npm test` OK.
- **Zadanie 21 scalone do `main`** (d6d7af1…e7e824e; scalenia `main` ed4e2c0, 6702206, db70f87, cabeb69, fe4e126; scalenie
  ee034ed): pas asteroid z dema w grze — 18 modułów TSL w `src/3d/asteroids/`, klej `asteroidBelt.js` jako krok `Core3D.fx`
  w kolejności klatki dema; PLAY w passie gry pod płaszczyzną, RUBBLE / MID / DEEP i zasłona w passie tła; ośrodek
  objętościowy (`beltMedium.js`) czytają skały, minerały, olbrzymy i kadłuby (hak `hullVolume`); mapa pola w masce słońca;
  cień pól i start GPU na ekranie ładowania; z nieba dema tylko zasłona, nocna łuna i błyski burzy. **Rozgrywka:**
  `src/game/asteroidBeltGiants.js` — 5 olbrzymów przy rdzeniach pasa (pierwszy = Labirynt dema), siatki SDF w workerach
  (budowa, gdy kamera / statek < 420 tys. j.), kolidują gracz, P2 i NPC bez obrażeń (odbicie 0,3; Atlas 900 j/s w litą
  skałę: 803 j. drogi zamiast 5400, nigdy w skale), pociski gasną w skale; małe skały bez kolizji. Usunięte:
  `asteroidField3D`, `asteroidBeltBackdrop3D`, `asteroidBelt3D`, `rocks/*`, `beltDust3D`, `beltStorm3D`, `fieldLights3D`,
  `asteroidHexAdapter` + 34 testy starego pola (przepisane na olbrzymy: npcWorldCollisions, bulletStepOverheads,
  shadowShaftsQuality, renderBugfixGuards); −16 materiałów, −1955 linii GLSL. Poprawki wydajności: bufory pasa bez
  `DynamicDrawUsage` (~1 MB uploadu na klatkę), mapy cienia skał tylko dla 2 statków, kolano bloomu z 22 na barwach pasa.
  Koszt (A/B w jednej stronie, bitwa): pas +0,9 ms CPU Core3D, +1,4 ms GPU; gęste pole: GPU 1,5–1,85 ms, CPU pasa 0,5–0,7
  ms. Zrzuty pola obok dema (pole, noc, burza, olbrzym) w `.tmp/webgpu/zadania/21/porownanie-demo-gra/` i kolizja
  `gra/kolizja.png` — **do oceny użytkownika**; noc ciemniejsza niż w demie (gra nie ma flar dema). Harness: 59 scen, 0
  błędów, pas bez zamienników, 118 zrzutów scen bez pola identycznych z `main`. Zmiany rozgrywki względem starego pola —
  lista „do decyzji użytkownika” wyżej. Inwentarz z HEAD ee034ed: wszystkie pliki z GLSL 16 (było 24), materiały 30,
  3281 linii; port bez zmian (6 / 7 / 1165). Testy: 1563 / **5** porażek bazowych (`asteroidHexAdapter:309` zniknęła
  z modułem) / 3 todo; `npm test` OK.
- **Części 18-B i 18-D scalone do `main`** (56fb84e, cb65bbc, ae676eb, 1ead12b, 0bee2ae; scalenia `main` 7bb3c20, cc1ffe8;
  scalenie f088bac) — **zatwierdzona zmiana rozgrywki**: przebicia Mjolnira / Valkyrie na wylot (`bulletsAndCollisionsStep`:
  `b.mech`, `stepInsideHull`, przebiegi `hullPass`, limit kadłubów = `penetration`, krater wylotu / zakleszczenia bez HP),
  rykoszety Vulcana / Gatlinga S (hash numeru pocisku, obrażenia × 0,3, smugowiec z tego samego hasha — bez
  `Math.random`), ładowanie Mjolnira (3 s, postój |v| ≤ 30 j/s, |ω| ≤ 0,05 rad/s) i Valkyrie (0,28 s) u gracza, P2 i AI
  (AI tylko przy widocznym celu i czystej linii ognia) z paskiem na HUD i komunikatami, seria Hexlance'a z `burstCount` (4);
  18-D: odrzut / wstrząs / `impactScale` tylko z danych broni (`src/game/weaponFeel.js`, `FX_PROFILE` = same klucze
  wieżyczek). Mapa ran: warianty `impact` / `ricochet` (nowe płytkie osmalenie `vulcan.ricochet`) / `exit` / `stuck`
  (8. argument `applyHexImpact`), pas rzazu `stampKerf` z gry (Mjolnir przez kolumnę 3 okrętów: 21 stempli, 0 przepadło).
  **Bilans (1000 strzałów):** Mjolnir kolumna fregata + niszczyciel + pancernik 150 → 549 dps (+266%, 2,94 kadłuba na strzał),
  pojedynczy cel 312,5 → 227,3 dps (−27% — ładowanie w cyklu); Valkyrie pojedynczy −8,5% (166,7 → 152,4), kolumna +59%
  (przebija fregatę w 100%, grzęźnie w pancerniku 83%, w lotniskowcu 99%); Vulcan / Gatling S rykoszetują 2,2–5,9% trafień
  (dps −1,5…−4,2%); Hexlance na naciśnięcie +53% (pancernik) / +57% (lotniskowiec). Odrzut / wstrząs zmienione tylko dla
  broni bez wpisu w dawnym `FX_PROFILE` (Tempest S/L 4 / 2,5, Helios S / Lance 6 / 3, Gatling S 3 / 2, Autokanon L 8 / 4,
  CIWS Mk II 1,5 / 1); wstrząs trafienia × `impactScale`: Mjolnir 5 → 16 px (sufit kamery), Yamato 6 → 16 px, Valkyrie 2,5
  → 8,75 px. Bitwa floty: stan gry i obraz scen `bitwa` / `bitwa-blisko` / `wybuch` / `wraki` / `warp` = `main`; A/B pętli
  pocisków dla broni bez mechaniki bit w bit (3 ziarna). Harness 85 scen, 0 błędów, 0 NaN; zrzuty obok dema (przebicie,
  rykoszet, ładowanie, seria) w `.tmp/webgpu/zadania/18b/obok-dema/` — **do oceny użytkownika**. Decyzje (MECHANIKA-BRONI
  §8.5–8.6): mechanika tylko na kadłubach belkowych (myśliwce i heksy bez zmian), pocisk w materiale nie widzi innych
  kolizji, rzaz przerzedzony do gęstości dema, naciśnięcie broni z ładowaniem czeka do 1,5 s na wycelowanie, rykoszet na
  mapie ran = osmalenie. Otwarte: ścieżka AI z ładowaniem uśpiona (domyślne loadouty NPC nie mają tych broni),
  `impactScale` nie działa na wiązki, nowa baza galerii z `main`. Testy: 1590 / 5 porażek bazowych / 3 todo; `npm test` OK.
- **Zadanie 11 scalone do `main`** (e58fc42, 69f2792, 5e98401, 5c19642, 6c57e60, 17f5ac2, c16c10b, 3493ec9, 0be809b, 7a16199,
  eeedba3; scalenia `main` 9ebe362, e5cbe53, 80332bd; scalenie d62e275): tło menu w TSL (`menuBackdrop3D.tsl.js`: Ziemia w
  układzie ringu, poświata, niebo; −200 linii GLSL, −3 `ShaderMaterial`; menu nie czyta już `haloRingGLSL.js`,
  `createHaloBakeWarmup` usunięte). **Rejestr rozgrzewki** `src/3d/rozgrzewka.js` = `Core3D.warmup`: `add` (moduł dopisuje
  się jedną linią), `now` (pilne, Promise), `run(nazwa, fn)` (istniejąca rozgrzewka modułu z pomiarem czasu i pipeline'ów),
  `flush()` na ekranie ładowania (limit 4 s), `stats.lista`; każda siatka osobnym `compileAsync` na prawdziwym celu i
  kamerą swojego passa; kroki `Core3D.fx` z `warm` przechodzą przez rejestr same (17, 18-C, 19, 22), kadłuby / tarcze /
  start GPU pasa (21) przez `run` w `startGame`, bryły ringów przed podpięciem. Poprawki z pomiaru:
  `compileAsyncNaCelu` (three r183 bierze głębię z renderera przy `compileAsync`, a z celu przy renderze — na celach bez
  głębi pierwszy rysunek tworzył drugi pipeline synchronicznie: pieczenie i detal ringu, maska słońca, warstwa DIST),
  kernele przesunięcia pul rejestrowanych po `warmAll`, post (uber z bloomem i bez) przy urządzeniu pod kurtyną menu.
  **Start (mediany 3 przebiegów, czas rzeczywisty):** menu gotowe 11,56 → 7,65 s (obciążone GPU 14,66 → 8,24 s; tag WebGL
  17,3 s), najdłuższy przestój menu 2,90 → 0,13 s, pierwsza klatka gry 330 → 244 ms (tag 711 ms), pipeline'y synchroniczne
  w menu / 300 klatkach gry 24 / 8 → 0 / 0, budowy NodeBuilder w klatkach gry 8 → 0. Harness (77 scen): zamienniki 3 → 0,
  pipeline'y synchroniczne w pierwszych klatkach gry 139 → 16 i budowy 155 → 36 (reszta = rozgrzewka cienia Destruction3D
  rysunkiem — świadomie, pass cienia nie ma `compileAsync`), przestoje > 50 ms 15 → 8 (`mars-ring` 552 ms → 0,
  `jowisz-ring` 496 ms → 0). `menu` vs baza: 0,34% >8/255 (Ziemia 0%, niebo 0,0004%, sam ring 0,38% — resztki jak w
  scenach ringu, → 23). Narzędzia: harness i `scripts/webgpu/start-gry.mjs` spisują pipeline'y synchroniczne i budowy per
  klatka z nazwami materiałów, `zrzuty.mjs --root` (pomiar „przed” na eksporcie `main`). Decyzje: `prewarmHexShips3D`
  zostaje na ekranie ładowania (2081 × `Math.random` w cząstkach — wcześniej przesunąłby świat `startGame`); gotowość ringów
  obejmuje rozgrzewkę (teren Marsa / Jowisza w koliderze ~0,5–1 s później); mgławica nieba menu `.level(0)` jak WebGL.
  Otwarte: 21b (mapy cienia skał, `sparks.stepNode`), 16 (cień Destruction3D, bryła stacji GLB), 20 (wybuch reaktora w
  rejestrze), 23 (asynchroniczne kernele compute, ~200–250 ms CPU pierwszej klatki gry — nie kompilacja). Inwentarz z HEAD
  d62e275: port 4 pliki z GLSL, 4 materiały, 361 linii; razem 15 / 27 / 3081. Testy: 1605 / 5 porażek bazowych / 3 todo
  (+1 niestabilny pod obciążeniem w jednym przebiegu); `npm test` OK.
- **Zadanie 21b scalone do `main`** (708bbdf, 87a883c, 9e1a8ba, 72f30ab, ce0f8b8, f3c573e; scalenia `main` b6cbe25, c5726c7;
  scalenie 5cc94a7): fizyka skał z dema (`AsteroidMining`) jako system gry — krok w `physicsStep` (czas symulacji 120 Hz,
  bez alokacji na krok; usypianie skał, tarcie obrotu w styku, rzadsze sprawdzenia rozpadu); platforma gracza
  `src/game/asteroidMiningRig.js` (3 drony z laserami, piła na drucie między dwoma dronami, ładunki S–XL detonowane serią,
  wiązka ściągająca, urobek w tonach surowców `resources.js` do ładowni; ciężka operacja najwyżej raz na klatkę); render
  `src/3d/asteroids/minedRocks.js` (port dema: atlas 3D siatek ciał, zewnętrze `carve`, wnętrze raymarching, minerały, cień
  reflektorów, okruchy) i `miningView.js` (drony TSL, wiązki, efekty z pul pasa); przejęte skały znikają z warstwy PLAY.
  Ładunki = nowy przedmiot (`src/data/miningCharges.js`, rynek doku „Ładunki górnicze”). Koszt: przejęcie skały ~21 ms,
  wybuch L ~22 ms (klatka maks. 29 ms), klatka po wybuchu 0,145 → 0,045 ms, cięcie laserem 0,08 ms, tryb bez pracy 0,01 ms.
  Rozgrzewka (sprawy z 11): wpisy `pas asteroid: …` w `Core3D.warmup` — wszystkie mapy atlasu cienia naraz, krok iskier z
  dt = 0, siatki wydobycia; `pas-pole` bez budów pasa, `pas-burza` 0 compute na zimno, `wydobycie-*` 0 budów. Harness 90
  scen, 0 błędów, 0 zamienników; zrzuty gry obok sceny „Kopalnia” dema w `.tmp/webgpu/zadania/21b/proba1/`, `final/` —
  **do oceny użytkownika**; pytania o ekonomię i fizykę wyżej („Wydobycie (21b) — do decyzji użytkownika”). Stary
  `asteroidDestructor.js` — importuje go już tylko jeden test (notatka `AGENT:` dla 24). Testy: 1620 / 5 porażek bazowych /
  3 todo; `npm test` OK.
- **Zadanie 20 scalone do `main`** (36cd5de, 50891c4, 1c419f5, fee6883, 96f99d2; scalenie `main` 121bd00; scalenie df965d6):
  **jeden renderer, jedna kanwa 3D, jeden bloom.** Wybuch reaktora w scenie Core3D (`reactorblow.js` + `reactorblow.tsl.js`,
  `particlePool.js`): dwie pule (100 000 i 15 000) w passie ortho (warstwa 0), materiał TSL raz na pulę, ruch w
  wierzchołkach, początek puli przy wybuchu, krok klatki efektów „reaktor” (rdzeń i rozbłysk świecą do siatki świateł,
  gorące powietrze przez `fxDistortion()`); profile, czasy i kolejność `Math.random` bez zmian; oba wejścia
  (`triggerReactorBlow3D` — śmierć okrętu, `Destruction3D` — rozpad stacji). Usunięte: `src/effects3d/overlay.js` (607 linii:
  drugi `WebGLRenderer`, EffectComposer, bloom overlaya, `RestoreAlphaShader`), GLSL wybuchu (226) i `RestoreAlphaShader`
  (36), wpięcie overlaya w `index.html` i `shipEntity.js`, kanwa `overlay3d`, parametry `overlay*` w `bloomConfig.js` i
  tunerze (stare zapisy localStorage kasowane); kubełek PerfHUD „Overlay FX 3D” → „Rakiety (lot)”; `rdzen-demo` na Core3D;
  `overlayContextMerge` = strażnik jednego renderera. Rozgrzewka przez rejestr (`warm` kroku; `prewarmPass` na
  `compileAsyncNaCelu`) — pierwszy wybuch: 0 budów i 0 pipeline'ów w klatce gry. **Wygląd:** model = odwzorowanie obrazu
  overlaya pod ACES / sRGB gry, poświata rdzenia w shaderze, rdzeń z sufitem 0,88 pod progiem bloomu gry, rozlanym iskrom od
  0,6 s poświata o wzmocnieniu mipów 0–1 bloomu overlaya; poza tolerancją — pytania w „Wybuch reaktora (20) — do decyzji
  użytkownika”. Wydajność (1080p): klatka bez wybuchu 1,61 ms, faza iskier (4063 cząstki) 1,38 ms / GPU 0,27 ms, trzy wybuchy
  (12 189) 1,55 / 0,33 ms; pierwsza klatka pierwszego wybuchu +~3 ms (tag +2,6). Nowa sesja harnessu „reaktor” (9 scen,
  wariant `__reaktor` — sam wybuch na czarnym tle), `scripts/webgpu/wybuch-reaktora.mjs`. Harness 94 sceny, 0 błędów, 0 NaN;
  sceny bez wybuchu identyczne z `main` (poza szumem `planeta-cien` / `warp`); warianty warstw scen z wybuchem
  (`__tlo` / `__planety` / `__fg`) nieporównywalne z bazą (tam kanwa overlaya leżała nad każdym wariantem) — do
  przebazowania. Inwentarz z HEAD df965d6: **port 2 pliki z GLSL (`beamDebris3D.js` 64 linie — materiał tylko w demach
  destruktora, `sunShadowMaskGLSL.js` 35 — napis dla modułów poza grą), 1 materiał, 99 linii**; razem 13 / 24 / 2819;
  renderer tworzy się tylko w `core3d.js`. Testy: 1633 / 5 porażek bazowych / 3 todo; `npm test` OK.
- **Użytkownik (rano 2026-09-28): duża bitwa na WebGPU 68 FPS vs ~200 FPS na WebGL** (PerfHUD: GPU 1,5 ms, Ortho 183 dc ·
  5,6 ms CPU, U hex 2,6 ms, fizyka 2,9 ms/krok) → priorytet nr 1 zadania 23.
- **Zadanie 23 scalone do `main`** (21 commitów 8fc9e77…56012bf; scalenie b41e4de): **duża bitwa (148 okrętów, A/B
  naprzemiennie z tagiem, mediany 9 próbek): FPS main/tag 54% → 84% (146/79 → 198/167 FPS), Core3D 4,02 → 1,47 ms (tag
  0,79–0,95), rysunki 117 → 49.** Poprawki bez zmiany obrazu (harness 191 zrzutów ≤ 2/255 po każdej): dane kadłuba w jednym
  buforze storage ze slotem + skóry kadłubów rysowane partiami — jeden rysunek na zestaw tekstur (`src/3d/hullSkinBatch.js`;
  ~145 rysunków skór → 5–8); klucz świateł three z pamięci (`src/3d/tsl/kluczSwiatel.js`), mapa cienia i łapacze pomijane
  bez rzucających w kadrze cienia; jeden `writeBuffer` na bufor uniformów (295 → 213 wywołań na klatkę); **bloom = 12 kerneli
  w jednym passie compute** (`src/3d/tsl/bloomCompute.js`; `scripts/webgpu/bloom-parzystosc.mjs`: 11 celów bit w bit z
  `BloomNode`; CPU bloomu ~0,5 → 0,03 ms); spawn pul efektów i krok dymu rakiet w jednym passie compute; zakresy wysyłki
  zamiast pełnych buforów, kopie CPU buforów liczonych tylko na GPU oddane (~140 MB); ringi Marsa i Jowisza budowane w
  kawałkach (przestój 528 / 690 → ~200 ms); znaczniki czasu GPU co 4. klatkę; wizualia na `fxRandom` (nowa baza scen z
  nowymi efektami: `.tmp/webgpu/zadania/23/baza-main/`); harness zapisuje błędy startu sesji. Fizyka na krok = baza (tag
  2,6–3,4 ms/krok, main 2,9) — więcej na klatkę tylko przez dłuższą klatkę. Sceny bez ognia: CPU renderu +0,15–0,4 ms nad
  bazą (stały koszt renderów / rysunków three), GPU 1,5–5× taniej. Drżenie (`scripts/webgpu/drzenie-gra.mjs`, w grze):
  ≤ 0,008 px RMS poza smugami pocisków przy zoomie 1,8 (0,018 px — nie precyzja float32) i dymem rakiet przy 7 mln / zoomie 2
  (0,029 px — mapa samocienia przesuwa się z kamerą). Start: urządzenie 3,7–4,2 s, pierwsza klatka gry 12,0–13,4 s. Pamięć
  stabilna w 3 cyklach bitwa → sprzątanie; 8 tekstur planet 8K = 1,37 GB, tekstury razem ~2,6 GB VRAM. Kopia kanwy
  `#webgl-layer` → `#c` ≤ 0,1 ms — rekomendacja: zostawić. Tylko WebGPU: w 3 wariantach bez WebGPU komunikat w menu, gra nie
  startuje. **Niedomknięte:** CPU scen bez ognia +0,15–0,4 ms; 5 przestojów > 100 ms (120–213 ms, ~15 klatek po teleporcie
  obok stacji — prawdopodobnie kompilacja materiałów pierwszej stacji modelu w procesie GPU → rozgrzać szablony stacji na
  ekranie ładowania); drżenie smug i dymu nad progiem 0,01 px. Do decyzji użytkownika: kolano bloomu dla broni / rakiet / ran
  (A/B w `.tmp/webgpu/zadania/23/kolano/` — np. `galeria-mjolnir` 69% pikseli >8/255), siatka mapy samocienia dymu. Raport:
  `docs/webgpu/WYDAJNOSC.md`. Testy: 1662 / 5 porażek bazowych / 3 todo; `npm test` OK.
