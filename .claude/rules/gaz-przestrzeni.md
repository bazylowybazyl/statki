---
paths:
  - "src/3d/spaceGas/**"
  - "src/game/spaceGasInput.js"
  - "src/game/ringGasField.js"
  - "src/render/blocks/spaceGasBlock.js"
  - "scripts/webgpu/gaz-kosmos-gra.mjs"
  - "tests/spaceGas.test.mjs"
  - "dema/gazy-transport-webgpu.html"
---

# Gaz w otwartej przestrzeni: pole z transportem gęstości (port dema gazy-transport), sceny pasa i ringu Jowisza

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan

Port dema `dema/gazy-transport-webgpu.html` (wygląd zaakceptowany 2026-10-16) według planu `docs/PLAN-gazy-kosmos.md`. Decyzje D1–D8 przyjęte 2026-10-22, postęp w § 6 planu.

- Zrobione:
  - GK-1: rdzeń pola;
  - GK-2: wejście gry;
  - GK-3: mapy i dwie połowy warstwy;
  - GK-4: pył gazu;
  - GK-5: scena pasa z olbrzymami, wybuchami, pociskami i jedną mgłą;
  - GK-6: scena ringu Jowisza w budowie (2026-10-23, § „Scena ringu” niżej);
  - GK-8: opcja Wł. / Wył.
- Czekają:
  - GK-7: ławice mgły;
  - GK-8: okno i mapy z presetu;
  - GK-9: odbiór.
- Hale K-7 mają osobny gaz (reguła `pyl-hal-k7`, `src/3d/hallGas3d`). Ten moduł do hal nie wchodzi.
- DRŻENIE I ODDALENIE (2026-10-29, zgłoszenie z 5120 × 1440 @ 240 Hz w trybie worker: „gazy i mgła w polu asteroid mocno drżą”, „przy oddaleniu nie widać wypychania, ogon szybko znika”): zegar gry zamiast dt strony, klatka efektów raz na stronę, ciśnienie przenoszone przy przesunięciu okna, drabina teksla map i kolumny ośrodka pasa, okno pola przy okręcie pod śladem, siatka obwiedni pod mapą, zanik niezależny od proporcji kadru, miękki brzeg pyłu, dysze spoza okna poza budżetem. Każda zmiana ma przełącznik A/B na żywo (niżej, przy punkcie). Pomiary: `docs/PLAN-gazy-kosmos.md` § 6.

## Szew i układ

- Gra pakuje wejście klatki. `packSpaceGasFrame` w `src/game/spaceGasInput.js` daje Float64Array `SPACE_GAS_IN` (układ w czystym `src/3d/spaceGas/spaceGasLayout.js`):
  - scena (`SPACE_GAS_SCENE`: `belt` 1, `ring` 2 — `o.scene`, domyślnie pas) i kotwica sceny w double (`o.anchorX / anchorY`; bez nich Słońce — pas); zmiana kotwicy albo sceny = nowa siatka obwiedni;
  - kamera i kadr względem kotwicy;
  - ZEGAR GRY (`simTime` / `renderTime` = `SimClock.sim` / `.render`, w nagłówku — blok kopiuje go także bez gazu; brak = NaN): render bierze przyrost czasu renderu od ostatniej PRZETWORZONEJ strony (dt pyłu, wiatru, zaniku skoku) i liczy kroki pola z zegara fizyki. Dt jednej strony (`IN.dt`) gubił czas stron pominiętych przez workera (pole szło w 52–86% tempa) — nowa rzecz renderu z czasem gry bierze ten zegar, nie `dt`. A/B: `SpaceGas.tune.clock = false`;
  - ŚRODEK OKNA POLA (`winX / winY`, `placeGasWindow` w `spaceGasInput.js`): przy prowadzonym okręcie kamery statku (`o.focus*` — Atlas albo fregata zwiadu przy sterach, poza renderu i prędkość; `_spaceGasFocus` w `index.html`), przesunięty pod ślad (−v̂ · min(½ pół okna, 8 s · |v|), sprężyna: narasta w 1 s, gaśnie w 6 s), przycięty na oś do |pół okna − pół mapy|: okno większe od mapy obejmuje całą mapę kadru (domyślny kadr — jak dawniej), mniejsze leży w mapie (oddalenie — okręt i ślad za nim w oknie; dawniej środek = kamera, która wyprzedza okręt o ~880 px: przy zoomie 0,15 ślad w oknie ~2 km, od ~0,107 okręt poza oknem). Bez okrętu (RTS, fokus stacji, kamera fabuły, kamery 3D), okręt poza kadrem — kamera BEZ wstrząsu (`o.camNsX / camNsY`; wstrząs i kop przesuwały okno o ±1 komórkę). Tym środkiem liczą się: okno `sim.frame`, kadłuby (`_hulls`), prostokąt okna w domenach przeszkód (`packGasObstacles`), siatka obwiedni, wybuchy, odgazowanie, pociski i raster olbrzymów. A/B: `SpaceGasInputTune.followShip = false`;
  - wiatr wzdłuż orbity wokół kotwicy + od kotwicy (pole może podać własny: `field.wind`, `field.windOut`);
  - kierunek ku Słońcu z punktu kamery (`o.sunX / sunY`, niezależnie od kotwicy — dla pasa ten sam wynik bit w bit);
  - siatka obwiedni 32 × 32 z `field.sampleMacro`;
  - strugi odgazowania lodowych skał (`field.forEachRockInRect`; skała może podać kierunek wylotu `dx, dy`, pole — mnożnik wydajności `field.ventGain`);
  - wybuchy: pierścień `recent` / `count` w `src/game/explosionEvents.js` (`GameBlasts`), przyjęte raz i starzone czasem gry;
  - pociski z `bullets` w oknie;
  - RASTER PRZEKROJU OLBRZYMÓW (z = 0): 128 × 128 bitów na okno, z `giant.sampleWorld`, próbkowany tylko w pudłach gotowych olbrzymów i przesuwany przyrostowo.
- Siatka obwiedni korzysta z tego samego wzoru co płaty mgły `fog.js`, z `hole` i `gas` z E3. Przesuwa się przyrostowo: przy ruchu kamery próbkowane są tylko nowe wiersze i kolumny. Przy nowej `holeVersion` liczy się cała.
  - OBEJMUJE OKNO (× `envWindow` 1,15 — dopływ przez brzeg) I MAPĘ KADRU (× `mapCover` 1,25): krok = krok okna (704 j. przy oknie 256) × 2^k, k z histerezą `envShrink` 0,95 (pełne próbkowanie ~1 ms tylko na progu). Mapa przy oddaleniu sięgała poza dawną siatkę okna (±11 km) i jej pole dalekie czytało rozmazany brzeg (ClampToEdge — wyrwy, luki i brzeg pasa w poziome pasma). A/B: `SpaceGasInputTune.envCover = false`.
- Render (`SpaceGas`, `src/3d/spaceGas/spaceGas.js`, krok Core3D.fx „gaz przestrzeni”) czyta tylko:
  - to wejście;
  - kadłuby z `GAS_OBST_IN` (gra dokłada okno pola do prostokątów domen przeszkód);
  - dysze MAIN z `EngineFrame`.
- Budżet źródeł (64 na klatkę) w kolejności: wybuchy (front + wyrzut), dysze, odgazowanie, pociski. Stożek dyszy, którego pudło nie dotyka okna pola, nie wchodzi do budżetu (`stats.jetsSkipped`) — przy oddaleniu w bitwie dysze spoza okna wypychały źródła z okna.
- Pole pasa i pole ringu mają to samo API (`sampleMacro`, `rectTouchesBelt`, `holeVersion`, `forEachRockInRect`, raster przez `giants`) — packer i render są wspólne. Wybór sceny: `packSpaceGas` w `index.html` (blok „GAZ PRZESTRZENI”) — pas, gdy kadr go dotyka, inaczej ring w budowie przy kadrze.
- JEDNA MGŁA w pasie: `SpaceGasCover.belt` (`spaceGasState.js`) = zanik gazu w tej klatce (tylko scena pasa). Płytkie płaty `fog.js` (pass gry) mają alfę × (1 − pokrycie). Głębokie płaty tła zostają.
  - Gaz wyłączony (opcja, preset Niska) albo oddalenie — stara mgła wraca.
  - A/B: `SpaceGas.tune.fogReplace`.
- SKOK GRACZA (2026-10-27, jak pole pasa — reguła `pas-asteroid`, „Pas w skoku gracza nie jest rysowany”): gra wyłącza gaz na czas skoku (`o.enabled = warp.state !== 'active'` w `packSpaceGas`), a obraz gazu i jego pyłu gaśnie wcześniej, w ładowaniu — × `warpFieldVisibility` (`src/render/warpLensPhase.js`: 1 − β / chargeBeta soczewki `WARP_WORLD_LENS`, 0 na końcu ładowania), więc w kopie nic nie znika w jednej klatce. Po włączeniu (wyjście ze skoku, wejście w obszar gazu) obraz wraca od zera w `WARP_FIELD_FADE.reveal` s (`stepWarpFieldFade`, dt gry — pauza trzyma; `SpaceGas.stats.fade`). `SpaceGasCover.belt` zostaje PRZESTRZENNY (bez zaniku skoku): płaty i gaz gasną razem, płaty nie wracają w miejsce gazu. Test na funkcji `_update`: `tests/warpBezSkal.test.mjs`.
- Tryb off woła `SpaceGas.submit` w `render()`. Worker bierze bloki `spaceGas` i `gasObst`.
- Krok „gaz przestrzeni” idzie w klatce `Core3D.fx`, a ta w workerze idzie RAZ NA STRONĘ gry (`Core3D.fxFrameKey` = numer strony, `render.worker.js`) — dawniej raz na takt rAF workera, więc drugi render w tym samym takcie (11–16% renderów przy 240 Hz) był bez kroku (reguła `core3d`).
- UKŁAD POLA: świat gry WZGLĘDEM KOTWICY.
  - Bufory GPU trzymają tylko stan komórek, więc kernel przesunięcia początku pul nie jest potrzebny.
  - Szum dostaje argumenty rzędu setek.
  - Mapy i warstwa są ustawiane przez `mesh.position` w double.
  - Nowe dane pola (źródło, przeszkoda) podajesz względem kotwicy, nie w świecie ani względem `fx.origin`.

## Scena ringu (GK-6, ring Jowisza w budowie — decyzja użytkownika 2026-10-23 „wszędzie pył, gaz”)

- Pole `src/game/ringGasField.js` (`createRingGasField(haloWorld.entries[i])`, tylko ring z `construction.active`): kotwica = środek planety; obwiednia = pas wokół obręczy (`RING_GAS_TUNE`: σ 3 200 j. od planety, 5 200 od habitatu i doków) × (tło budowy + fronty), ×0,45 przy halach K-7 (hala ma własny gaz); `ice` (kanał z — odgazowanie) rośnie przy frontach; strugi odgazowania po dwie na front (habitat i strona planety, wylot ku przerwie i od obręczy, typ `RING_GAS_VENT_TYPE`, bez progu rozmiaru skały, `ventGain` 0,16); dryf 22 j/s wzdłuż obręczy, 6 j/s od planety.
- PRZESZKODA: płyta ringu jako jeden „olbrzym” rastra przekroju (`field.giants`) z próbką z kolidera gry (`pointInSlab` — przerwy, tranzyty, teren): gaz płynie przerwami, płyta wysp go zatrzymuje (ta sama płyta co statki i pociski).
- Render: ta sama klasa sceny i kernele co pas (pole dalekie i detal pasa) — scena różni się obwiednią z gry i WYGLĄDEM (`createRingGasLook` w `spaceGasBelt.js`: szarobrunatny pył budowy, żółtawe opary cięcia płyt z Io, sinawe odgazowanie; więcej otoczenia — poświata Jowisza). `SpaceGas.looks[scena]` przełącza `scene.look` + `syncLook()` przy zmianie sceny (uniformy — bez nowych pipeline'ów i rozgrzewki).
- Światła spawania i masztów ringu idą do siatki świateł (`HaloRingGame._workLights` → `Core3D.fx.lights.point`), więc gaz i pył przy kratownicy błyskają spawaniem.
- Skutków rozgrywki gaz nie ma (jak w pasie). Testy: `tests/haloRingBudowa.test.mjs` (pole, strugi, przeszkoda, pakowanie sceny `ring`).

## Pole (`spaceGasSim.js`)

- Kernele są 1:1 z dema, strojenie w `createSpaceGasTune` (= `SIMT` dema).
- Raster olbrzymów to tekstura R8 (`sim.setRaster`, wysyłka tylko przy nowej wersji). Daje komórki stałe i zasłonę strug, buforów storage nie przybywa.
- Komórka stała = `velB.w` 2, prędkość ciała w `velB.xy` (bufora `flagB` nie ma). `kAdvect`, `kProject`, `kShift` i `kShiftCopy` mają po 7 buforów storage, limit to 8. Nowy bufor w tych kernelach = zmiana układu. Strażnik w teście.
- Okno przesuwa się TYLKO w klatce z krokiem (lekcja drżenia dema). Przesunięcie PRZENOSI CIŚNIENIE: `kShift` kładzie q komórki źródłowej w `velB.z` (kAdvect pisze `velB` od nowa), `kShiftCopy` przepisuje je do `prsB` — rozgrzanie Jacobiego (`warm`) zostaje. Dawniej `prsB` = 0 przy każdym przesunięciu (w locie 10–20 razy na sekundę) i przepływ wokół kadłuba pulsował z tempem przesunięć. A/B: `SpaceGas.sim.tune.shiftPrs = 0` + `syncTune()`.
- ZEGAR GRY (`sim.frame(…, clock)`, `clock` = { sim, render } z wejścia): krok k pola = krok k fizyki (⌊sim · 60⌋, kroki od ostatniej klatki, ≤ `SPACE_GAS_MAX_SUB`, × 4 w rozgrzaniu) — kadłuby w polu są w pozie tego kroku; ułamek przenikania obrazu = chwila renderu kadłubów ((render − (k − 1) / 60) · 60, w pauzie 1); zegar cofnięty (nowa sesja) — bez kroku. Bez zegara (`clock` null) — dawny akumulator z dt (faza wobec fizyki losowa).
- Obraz: dwie pary tekstur kroków zapisywane na zmianę, każda z własnym rogiem okna (`sim.image`). Mapy przenikają poprzedni i bieżący krok według ułamka kroku, z opóźnieniem 1/60 s.
- Szum (`spaceGasNoise.js`): z `setLayout` jest tylko `gnoise`. `fbm` i funkcje scen są wklejane (pułapka 35, strażnik w teście).
- Lustra CPU: `srcShapeCpu`, `gnoiseCpu`, `fbmCpu`. Zmiana kernela = zmiana lustra.

## Obraz (`spaceGasMaps.js`, `spaceGasLayer.js`)

- Mapy gazu i światła liczy compute w tekstury storage o stałym rozmiarze (`SPACE_GAS_TUNE.mapW/mapH`), na kadr z zapasem.
  - DRABINA TEKSLA (`spaceGasTexelLevel`): bok teksla = 2^(j / 8) j., stopień j z histerezą 3% — siatka tekseli stoi w świecie przez cały stopień (~9% zoomu), mapa pokrywa kadr × 1,08…1,21. Teksel liczony wprost z kadru zmieniał się przy KAŻDEJ zmianie zoomu (kółko, sprężyna, reżyser kadru, kop, obrót kadru), a siatka tekseli liczy się od kotwicy (pas: ~76 tys. tekseli od kamery) — gaz „gotował się” o ±½ teksla. Nowe wyliczenie prostokąta mapy — przez `place` (nie wprost z zoomu). A/B: `SpaceGas.tune.texelLadder = false`.
  - Mapa gazu: próbka dwusześcienna pola, kolumna nad bryłą z gazu otoczenia, pole dalekie poza oknem i faktura detalu. Faktura gaśnie, gdy teksel mapy przerasta jej skalę — teksel do zaniku (`U.lodTexel`) jest wprost z kadru (ciągły, bez skoku na stopniu drabiny).
  - Mapa światła: marsz ku Słońcu z dwiema próbkami na odcinek.
- Warstwa to dwie połowy w passie ortho, z testem głębi i bez zapisu:
  - dolna: z −20, renderOrder −45 — kadłub ją zasłania, skały pasa w niej toną;
  - górna: z +200, renderOrder 900 — po efektach gry, przygasza okręty i strzały.
- W kamerze z góry to złożenie dema z głębią. 8 plasterków dema z paralaksą (kamery 3D) jeszcze nie przeniesiono.
- Światło: mapa światła × `sunVisibility()`, otoczenie × `sunFill`, siatka `Core3D.fx.grid` z kolanem. Gaz sam nie świeci.
- Zanik przy oddaleniu: `fadeView` [40, 80 tys. j.] od pół kadru (`spaceGasViewFade`): kadr szerszy niż `fadeAspect` (16 : 9) liczy się jak kadr o tej samej wysokości — 21:9 i 32:9 gasną jak 16:9, kadry ≤ 16:9 bit w bit jak dawny max(pół szer., pół wys.). Dawniej na 5120 × 1440 gaz gasł od zoomu 0,064 (0,17 przy minZoom) i wracały statyczne płaty mgły pasa. A/B: `SpaceGas.tune.fadeAspect = 0`.

## Pył gazu (`spaceGasDust.js`, GK-4)

- Działa 1:1 jak w demie (`dustStep`):
  - drobiny rodzą się z gęstości pola, z przyjęciem (ρ / ρ₀)³, w kadrze × 1,25;
  - lecą z prędkością gazu;
  - w rzednącym gazie gasną szybciej;
  - poza oknem i w komórce stałej giną.
- Liczba: `SPACE_GAS_TUNE.dustCount` = 80 000 (D2), ustalana przy budowie. A/B: `SpaceGas.tune.dust`.
- POZYCJE WZGLĘDEM ROGU OKNA POLA. Przesunięcie okna przesuwa drobiny w tym samym kroku (`U.shift`), siatka stoi w rogu okna (`mesh.position`, double). Nie zapisuj drobinom pozycji względem kotwicy ani świata — w pasie (1,6 mln j. od Słońca) drobny ruch ginąłby we float32.
- Brzeg okna: drobiny gasną w pasie 4% okna przed brzegiem (jak waga okna mapy `kw`) — przy oddaleniu okno jest mniejsze od kadru, a twardy brzeg pyłu rysował prostokąt. A/B: `SpaceGas.tune.dustEdge = false`.
- Obraz: kwad instancji (`Mesh` + `InstancedBufferGeometry`, pozycja z buforów storage w `positionNode`), mieszanie addytywne, renderOrder −40 (po dolnej połowie gazu, przed efektami — górna połowa go przygasza).
- Światło: mapa światła i siatka świateł w wierzchołkach, maska słońca we fragmencie. Wygląd: `look.dustColor`, `dustW`, `dustRho`, `dustSulfurDim`, `SpaceGas.dust.U.gain`.
- Pył w ławicy siarki jest ciemniejszy: jasność × (1 − `dustSulfurDim` · udział siarki w gazie komórki drobiny). `dustSulfurDim` = 0,3 (decyzja użytkownika 2026-10-22).

## Narzędzia

- Testy: `node --test tests/spaceGas.test.mjs`. Sprawdzają WGSL w Node, limity wiązań, okno, wejście, mapy, warstwę, pył, wybuchy, pociski, raster olbrzyma i rzednięcie w wyrwie E3 (prawdziwe pole pasa).
- Gra: `node scripts/webgpu/gaz-kosmos-gra.mjs [--query renderWorker=1]`. Robi zrzuty z A/B bez gazu (postój, ciąg, kanał, przelot, oddalenie, wybuch, olbrzym, ciąg przy olbrzymie), liczy pipeline'y synchroniczne strony i workera (ma być 0) i podaje koszt GPU w trybie off.
- Tryb gracza (worker) przy rozdzielczości użytkownika: `node scripts/webgpu/gpu-pas-gra.mjs [--okno 0|1] [--okna …] [--ab S0,S1,…]` — dziennik gazu klatka po klatce w workerze (ΔK stron, utrata czasu gazu, kroki / s, faza kroku wobec fizyki R — 1 = zatrzaśnięty, przesunięcia okna, przepróbkowanie map i ośrodka przy ruchu zoomu), dane oddalenia (zanik, pokrycie kadru oknem, teksel, LOD), przekroje śladu za rufą; warianty A/B dawnego zachowania: S0 zegar, S1 okno przy kamerze, S2 bez drabiny (mapy i ośrodek), S3 ciśnienie od zera, S4 klatka efektów po taktach rAF, S5 dawny zanik.
- Konsola (`?dev`):
  - `SpaceGas.stats`, `SpaceGas.tune`;
  - `SpaceGas.scene.look` + `SpaceGas.syncLook()`;
  - `SpaceGas.sim.tune` + `syncTune()`;
  - `SpaceGasInputTune.enabled` — A/B dla całego gazu, działa też w workerze.
- Koszt (2026-10-22, RTX, 1600 × 900, okno 256, mapy 768 × 432, pył 80 tys.): render +0,13 ms, compute +0,17 ms na klatkę w gęstym polu (bez pyłu +0,08 / +0,16). Poza pasem: 0 dispatchy i 0 rysunków.
