# Render w workerze — stan etapu 4 (2026-10-16, tor `rw-worker`)

Notatka przekazania dla następnej sesji etapu 4. Plan: `docs/PLAN-render-worker.md` (§ 3, § 4 — wpisy **Stan** RW-40,
RW-40a, RW-40b cz. 1–12, RW-41b cz. 1, RW-42 cz. 1; § 7 — decyzje i zasady). Prototyp: `docs/webgpu/RW-02-PROTOTYP.md`.

## Co jest w main

| commit | co |
|---|---|
| 8cffc9d5, e4dd955c | RW-40a: worker z modułami na lustrach + kompozycja B2cr |
| 9c09945e | RW-40b cz. 1: rozkazy (broń, rany, wybuchy), wieże, mostki, rdzenie — **bramka 1,62×** |
| (cz. 2), 81c68a61, a596afb8 | planety / niebo, pył kosmiczny, rakiety (blok `rockets`) |
| c547ebc0, 276e6af2, 6b167b8c | ringi „Halo” i hale K-7, pył hal, warp „Nurt” |
| a37cf9b9, 7793f40f | blok `view` + zimne wraki, rozpad stacji (Destruction3D) |
| (cz. 10), 4f3141f2 | podzielony ekran, CIC, poprawka łańcucha wiadomości, `scripts/webgpu/render-worker-gra.mjs` |
| aab11c53, cd84576d | komety; baza piratów (zdarzenia obrazu) + mgła wojny |
| 0f399b9a | RW-41b cz. 1: obraz pasa asteroid |
| 7b501d1f | ta notatka + bariera „narysowano k” w `zrzuty.mjs` (RW-44) |
| (cz. 13) | drony naprawcze: blok `repair` (id rigu = `RepairFxEvents.idOf`, wspólne z rekordami REPAIR_FX), lustro rigów w workerze |
| RW-41b cz. 2 | wydobycie: `src/render/miningSync.js` — strona pakuje ciała skał (siatki tylko po zmianie wersji, z pudłem zmian; `ackMinedUpload` po wysłaniu), pozy, okruchy, platformę (drony, piła, ładunki, wiązka), nowe zdarzenia pierścienia i `taken` do wiadomości klatki (`msg.mine`); worker — repliki (`RockBody`, platforma jako obiekt o polach MiningRig). `render-worker-gra.mjs --js` (skała testowa w polu, lasery) — cięcie i urobek jak w off |
| RW-41b cz. 3 | domeny gazu wybuchów workera (`__explosions.domainRects`) w wiadomości `frame` worker → strona (`RenderWorkerHost.copyDomainRects`) — strona pakuje z nich przeszkody kadłubów (`packGasObstacles`) |
| RW-44 (część) | `profil-bitwy-flot.mjs` — w trybie worker pola `fps3d` (złożenia obrazu workera / s), `workerCpuMs`, `workerRenderMs` w próbkach i medianach; `start-gry.mjs --query renderWorker=1` (chwila `obraz3DOdKliku`; gra swobodna — świeży profil to kampania, której odprawa zatrzymuje `__frameId`; `--kampania 1`); `fabula-gra.mjs --query renderWorker=1` (bariera złożenia przed zrzutem) |
| RW-41 (część) | przygotowanie sceny workera na ekranie ładowania: planety do workera od razu po starcie hosta (menu), `RenderWorkerHost.prepare(x, y)` — worker buduje ringi przy punkcie i dokańcza rozgrzewkę (`prepareScene`), strona zaczyna to przy kliknięciu i czeka przed „Start!”. `start-gry.mjs --query renderWorker=1`: gra od kliku 11,9 s (off 9,8–10,4 s), obraz workera 0,3 s po pierwszej klatce gry; ZOSTAJĄ przestoje strony 0,3–2 s w pierwszych ~3 s gry: LoAF (`start-gry.mjs` zapisuje `loafGra`) — klatki bez skryptów i bez blokady wątku, czyli strona czeka na proces GPU zajęty pracą workera (dwa urządzenia GPU do czasu przeniesienia tła menu i zasobów — reszta RW-41). Pipeline'y synchroniczne w klatkach workera: 0 (dziennik `[render.worker] pipeline sync` w konsoli workera; mostki 3D dostały wpis rozgrzewki w workerze). Ringi-archetypy w `prepareScene` krokami `pumpBuild`. Tło menu dalej na stronie |
| RW-44 (zrzuty) | pełne zrzuty worker vs inline (`.tmp/rw45/`): harness steruje sceną na stronie — dla workera kanał `RenderWorkerHost.dev(op)` (operacja doklejana do wiadomości tej strony: `seed` — fxRandom workera i zegar iskier z `H.reseed`, `wfxReset` — pule broni z `clear()` galerii, `eval` — kod w workerze z `Core3D`, `THREE`; czarna płyta galerii rakiet), zegar efektów workera = czas strony z migawki (`Core3D.fxNowMs` ← HEAD.WALL), bramka ringu w trybie worker = `RenderWorkerHost.prepare` przy statku (sesje `mars`, `jowisz`). Po tym: wyloty, pociski, rakiety jak w inline; różnią się wtórne błyski Yamato i iskry (ciąg fxRandom workera zużywany w innej kolejności — bez śledzenia, § 7.1). Warianty `__fg/__ortho/__planety/__tlo` to przechwyty passów Core3D STRONY — w trybie worker bez znaczenia; sesja `stacja-przygotowanie` woła funkcje stacji strony (nie przechodzi) |
| RW-45 (pomiar) | bitwa 50/20/10/3 ABAB: zoom 0,1 — obraz workera ~1,5× off (131/128 ↔ 96/74 kl/s po 15 s; 1,2–1,5× w pierwszych 15 s), p95 wątku głównego 7–9 ↔ 17–31 ms; zoom 0,45 — obraz workera 0,6–0,9× off w pierwszych 15 s; start gry +2–3 s; szczegóły i decyzja D8 — Stan RW-45 w planie |
| RW-45b (Fable, `claude/rw-fps045`) | przyczyna spadku przy 0,45: wiadomość `frame` szła z mikrozadania PO nakładkach 2D, a takt rAF workera brał najnowszą stronę — worker czekał na wiadomość ~35% czasu (`czek/s` ~700). Poprawka: wysyłka w zadaniu publikacji (`postFrame`, `_chainBusy`) + render wprost z odbioru wiadomości (`tryRender`), czekająca strona nie jest porzucana; A/B `?rwRender=raf`, `?rwSend=late`. Liczniki `RET_F64.W_*` (13–19), profil: `takt / czek / porz / msg / lag`. Para 1 (wolna maszyna): zoom 0,45 — 180/147 → 212/175 ↔ off 203/140; zoom 0,1 — 186/151 i 155/131 ↔ off 98/75 i 86/70 (1,8–2,1×). Zostają pojedyncze przestoje workera w bitwie (opóźnienie wiadomości 330–550 ms w próbce, 2–3 na przebieg) — Stan RW-45b w planie |
| (cz. 17) | skóry ciał świata bazy (`worldBodies3D`): lista migawki `WORLD_BODIES` (encje kawałków), blok `worldBodies` (stan kawałków, `allLive`, punkty uwagi — `src/render/blocks/worldBodiesBlock.js`), `worldRef` w opisie encji, poza i kwaternion ciała w BODY (bryły 3D); worker buduje REPLIKĘ miejsc z własnej bryły bazy (`createPirateBaseSites` + `prebuildPirateBaseBodies`, ~0,5 s przy zdarzeniu 'bodies') i podaje ją `setWorldBodiesSource`; raster / konstrukcja szablonu kawałka z repliki (klucz skóry). `render-worker-gra.mjs --kampania 1 --query story=ram --js` (dwa progi pomostów) — odłamy ze skórą jak w off |
| (cz. 16) | stacja piracka (`world3d.js`): strona znakuje stację podpiętą do world3d (`__world3dPirate` → opis `world3dPirate`), worker podpina bryłę do jej lustra (`_mesh3d` — rozpad Destruction3D działa), mgła z `fogHidden`; `DevScene.mercMission()` (?dev) |
| (cz. 15) | rdzenie: blok `hazards` (`src/render/blocks/hazardBlock.js` — lustra strumieni i kul z rejestru id `ReactorFxEvents.forEachHazard`), dekoder RX_* w workerze (wcześniej rekordy RX_* worker pomijał — bez detonacji rdzeni), model reaktora (`createReactor3D` na `rm.cores`). Detonacja niszczyciela (`--js` z `ReactorGame.forceMeltdown`): bez błędów, ale jednorazowy przestój workera ~1–2 s w chwili wybuchu (odebrane strony zostają w tyle) — do zbadania (pipeline'y w workerze?) |
| (cz. 14) | luk Atlasa: strona wysyła `bay` { door, hidden } w wiadomości klatki, worker — `createScoutBay3D` na lustrze gracza (`__bayCut`); poza fregaty jak dawniej w ENT |

Pomiary (`profil-bitwy-flot.mjs --sklad 50,20,10,3 --zoom 0.1 --seed 7`, obraz 3D w trybie worker = złożenia
`RenderWorkerHost.composed` na sekundę): bramka (cz. 1, ABAB) worker 146 / 133 kl/s ↔ off 87 / 85 fps (1,62×); po
dodaniu modułów (jedna para, maszyna wolniejsza) worker 107 kl/s ↔ off 50 fps (~2,1×), CPU klatki workera 5–7 ms.

## Architektura

- **`src/render/renderBridge.js`** — tryb z adresu: `?renderWorker=1` → `worker` (zapas `inline` z powodem: brak
  izolacji, SAB, `transferControlToOffscreen`, `ImageBitmapRenderingContext`), `?szew=inline|pakuj`, domyślnie `off`.
- **`index.html`**: `SZEW_MODE` z `resolveRenderMode`, `RW_WORKER`, `SZEW_LATE` (pakowanie jak `inline`: opisy encji,
  faza begin tuż przed kadłubami, blok `cloak`, `lastConsumed` z RET). Bloki migawki tylko w trybie worker:
  `rockets` (`src/render/blocks/rocketBlock.js`), `view` (`src/render/blocks/viewBlock.js`; `_snapFrame.viewList =
  renderEntities` przed begin). W `render()` każdy moduł 3D ma gałąź `if (!RW_WORKER)`; strona woła
  `rwHost.syncPlanets(...)`, ustawia `rwHost.dustOn` / `ringQuality`, `rwHost.postFrame()` po `renderSnapshot.finish`,
  `rwHost.commitOverlay(k)` na końcu `render()`. Zdarzenia obrazu bazy piratów → `rwHost.pirateBaseEvent`. Strumień
  rozkazów: pierścień przełączany na SAB przez host (strona bez dyspozytora).
- **`src/render/renderWorkerHost.js`** (strona): worker, RET (`returnLayout.js`), wiadomości `init` (wymiary, jakość,
  `pageBase`), `layout`, `frame` (k, `evFrame` = ostatnia zamknięta klatka pisarza rozkazów, opisy encji — ODKŁADANE,
  gdy obraz kadłuba się jeszcze wczytuje (`_pendDesc`), topologie, rdzenie, stacje, słownik, zasoby jako ImageBitmap
  z limitem 3 s, definicje broni rakiet, strefa nieba, opcje, mgła wojny, zegar pasa), `planets` (`plainData` ciał przy
  zmianie), `comets` (raz), `pbase`, `belt` / `beltOp` / `beltOcc` / `beltGiant`, `cmdRing`. Łańcuch obietnic
  wiadomości z `catch` (błąd jednej nie zatrzymuje kolejnych). Kompozycja B2cr: `OverlayRing` (`overlayRing.js`,
  5 kanw w DOM), `#c` z `opacity: 0` zostaje celem myszy, kopia `#c` → kanwa pierścienia na końcu `render()`;
  kanwa WebGPU strony (`#webgl-layer`) ukryta po pierwszym złożeniu.
- **`src/render/render.worker.js`**: podkładki (`window = globalThis`, `innerWidth`, rIC, `fetch` z adresami względem
  STRONY), `RenderWorld.setSource` przed importem modułów, Core3D na OffscreenCanvas. Kolejność klatki: SimClock z
  HEAD → widok (`view`) → pociski-lustra (SHOTS) → wieże (TURRETS) → rakiety (blok) → `drain(evFrame strony)` →
  `syncCamera` → warp → planety → ringi (+ blok `ring`) → pas → pył hal → pył kosmiczny → komety → stacje → mostki →
  Destruction3D → baza piratów (blok `pirateBase`) → kadłuby (+ zimne wraki) → modele 3D → tarcze → obraz rdzeni →
  render (podzielony ekran: dwa widoki na kanwie 2D workera; CIC: pusta klatka) → `transferToImageBitmap`. Strona
  workera czeka na wiadomość ze swoim k. `entityAt` czytelnika rozkazów szuka też stacji.

## Pułapki złapane
- Start kampanii w trybie worker: pierwsze ~6 s gry worker rysuje klatki po 200–400 ms (pipeline'y ringu, hali, bazy kompilowane w klatkach — rozgrzewka workera idzie przy jego starcie, przed budową tych obiektów). To RW-41 (ekran ładowania w workerze).
- Detonacja rdzenia: jednorazowy przestój workera ~1–2 s przy pierwszym wybuchu (prawdopodobnie ta sama przyczyna).
- `SnapshotDict` w workerze to obiekt z `value(c)`; rekordy układu mają pola `F64 / I32` (wielkie litery).
- Adresy `assets/…` w workerze rozwiązują się względem skryptu workera (Vite oddaje index.html → DOMException w
  `createImageBitmap`) — podmiana `fetch` z `pageBase`.
- Łańcuch wiadomości strony stał na `createImageBitmap` niewczytanego obrazu (podzielony ekran, kadłub gracza 2) —
  bez złożeń, bez błędów. Teraz opis czeka na stronie.
- Bez świata mgły w wiadomości klatki tryb worker nie miał mgły wojny (post Core3D workera bez danych).
- Build: `vite.config.js` `worker.format = 'es'`.
- Worker piecze dłużej niż strona (ringi, pas) — pierwsza scena sesji harnessu łapała kanwę strony; bariera w
  `zrzuty.mjs` (czeka na `RenderWorkerHost.ring.lastComposed >= lastPostedK`) — niesprawdzona przebiegiem.
- Statystyki dc / GPU w raportach harnessu są ze strony (w trybie worker nieaktualne) — RW-44: fasada z RET.
- Core3D strony nadal istnieje (tło menu, rozgrzewka, pas strony piecze bank skał dla fizyki wydobycia) — dwa
  urządzenia GPU; RW-41 przeniesie tło menu i zasoby.

## Do zrobienia (kolejność)
1. Wyłączone w workerze (`RW_WORKER_DISABLED` w `render.worker.js`, komunikat w konsoli):
   tło menu (RW-41). Cel soczewki warpa `targetBody` — AGENT w pakującym.
2. RW-41 (zasoby, ekran ładowania, tło menu w workerze — bez Core3D strony), RW-41b cz. 2.
3. RW-44 odchudzone (§ 7.1): w trybie worker tylko `zrzuty.mjs`, `start-gry.mjs`, `profil-bitwy-flot.mjs`,
   `fabula-gra.mjs`; fasada Core3D z RET, sprawdzić barierę.
4. RW-36 (panele F12, których używa użytkownik), RW-45 (pomiar końcowy, Electron, tryb domyślny D8).
5. Kryteria RW-42 (opóźnienie, rozjazd, równość klatek) zmierzone w grze — dziś zmierzone tylko w prototypie RW-02.

## Jak testować tryb worker
- Gra: `node scripts/webgpu/render-worker-gra.mjs --start single|split --czas 25` (stan hosta: złożenia, ostatnio
  odebrana / opublikowana strona, CPU klatki workera, pierścień kanw, błędy; logi workera przez Target.setAutoAttach;
  zrzut w `.tmp/rw40/gra/`); `--js plik.js --tag x` — wyrażenie po starcie gry (czeka na > 60 złożeń; kamera
  nadpisuje zoom ustawiony w wyrażeniu); kampania: `--kampania 1 --query story=scout`; porównanie bez workera: `--tryb off`.
- Zrzuty: `node scripts/webgpu/zrzuty.mjs --backend webgpu --uuid osobne --sceny <sceny> --query renderWorker=1
  --out .tmp/…` (porównywać z `--query szew=inline`; różnice z modułów wyłączonych i kompozycji).
- Wydajność: `node scripts/profil-bitwy-flot.mjs --sklad 50,20,10,3 --zoom 0.1 --seed 7 --profile 999
  [--query renderWorker=1] --zdarzenia "10@(window.RenderWorkerHost?(RenderWorkerHost.readStats(),[Math.round(performance.now()),RenderWorkerHost.composed,RenderWorkerHost.stats[6]]):-1)|20@…"`
  — obraz 3D = przyrost `composed` / czas; pary ABAB, START / KONIEC do aktywnych sesji.
- Testy: `node --test tests/overlayRing.test.mjs tests/szewRenderu.test.mjs tests/graBezGlsl.test.mjs`; pełne
  `node --test "tests/*.test.mjs"` (znane porażki: hallGas LF, gpuFx sun-mask, 2 TODO rdzeni), `npm test`, build.

## Co w trybie worker działa inaczej niż w off (2026-10-16, do D8)

- Jedno urządzenie GPU (RW-41c): Core3D strony bez urządzenia (`Core3D.noDevice`); tło menu, lot intro kampanii, ekran ładowania i gra — worker. Start (mediany 3 przebiegów `start-gry`, 2026-10-17): tło menu gotowe 10,5 s ↔ off 12,2 s, od kliku (2 s po menu) 9,9 ↔ 7,7 s, od wejścia do gry 22,4 ↔ 22,0 s; po ≥ 8 s w menu od kliku ~4,3 s (worker kończy przygotowanie w wolnym czasie menu). Przestoje w pierwszych 300 klatkach gry ≤ 0,28 s, pipeline'y synchroniczne 0.
- Wydajność: przy zoomie 0,1 obraz ~1,5× szybszy niż off (po RW-45b 1,8–2,1×), wątek gry dużo równiejszy (p95 7–10 ↔ 17–31 ms); przy zoomie 0,45 obraz workera 0,6–0,9× off w pierwszej fazie bitwy — po RW-45b 1,05–1,25× (uzgadnianie: wysyłka wiadomości przy publikacji, render po wiadomości).
- Obraz 3D złożony z nakładkami tej samej klatki (B2cr) — opóźnienie obrazu o 1–2 klatki strony względem wejścia nie zmierzone w grze (kryteria RW-42).
- Losowe efekty (iskry, wtórne błyski Yamato, odłamki) losują z ciągu workera — inny przebieg niż w off; rozgrywka bez zmian.
- Pierwszy wybuch rdzenia — jednorazowy przestój workera ~1–2 s.
- Panele F12, tunery renderu i konsolowe `*Tune` / `window.Core3D` / `__explosions` / `WeaponFx` działają na Core3D strony — na obraz workera nie wpływają (RW-36 bez mostu).
- Narzędzia: statystyki dc / GPU Core3D w raportach (zrzuty, profil) są ze strony; przechwyty passów (`__fg`, `__ortho`, `__planety`, `__tlo`) i sesja `stacja-przygotowanie` w trybie worker bez sensu / nie przechodzą; pamięć GPU workera niezmierzona (`pamiec.mjs` haczy tylko stronę).
- Baza piratów: worker przy zdarzeniu 'bodies' liczy rastry i bryły kawałków sam (~0,5 s pracy workera przy starcie misji).
- Wydobycie: siatki skał idą do workera całe przy każdej zmianie (laser — do ~0,5 MB na klatkę wiadomością).
- Soczewka świata warpa: cel `targetBody` nieustawiony w pakującym (AGENT) — planeta celu w skoku może się zachowywać inaczej niż w off.

## RW-41 — stan i plan (2026-10-16 wieczór, do wznowienia po resecie limitu)

D8 = worker (decyzja użytkownika) — WDROŻONE w RW-41c (tryb domyślny). Poprawka Fable (RW-45b) jest w main: worker rysuje od razu po wiadomości strony (`tryRender`, tryb `msg`), a strona wysyła wiadomość przy publikacji. Przy 0,45 obraz workera 212/175 kl/s ↔ off 203/140 (para 1). Przed przełączeniem sprawdzić opóźnienie przy vsync w prawdziwym oknie.

ZROBIONE w tym commicie (RW-41a):
- `startGame` w trybie worker pomija przygotowanie 3D strony (modele broni GLB, rozgrzewki kadłubów i tarcz, HullSurface, stacje, obraz komet — jądra komet dalej się budują jako przeszkody, tekstury planet, flush rozgrzewki strony).
- Pas: bank skał piecze worker (`attachBeltEarly` już w menu — blok tworzenia pasa w DOMContentLoaded); mapy promienia kształtów wracają do gry wiadomością `beltShape` (→ `beltWorld.attachShapeRadius`, wydobycie przez `beltWorld.onMining`), `beltReady` po `initGpu` workera.
- Klatka zero: na końcu ładowania strona robi `render(1, 0)` pod kurtyną, a `RenderWorkerHost.prepare(x, y, …, afterFrame = true)` czeka na jej rysunek w workerze i rozgrzewa passy sceny z tym, co w niej jest (`Core3D.warmup.now(scene, { layer, visible: false })`, warstwy 0, 7, 2, 1, 3, 5, 6 + perspektywa). Pipeline'y synchroniczne w grze: 0 (wszystkie w klatce zero, pod kurtyną).
- Znaczniki kroków startu `window.__startSteps` (ms od kliknięcia; `start-gry.mjs` → `kroki`, `render-worker-gra.mjs` → `startSteps`), czas `initGpu` pasa w konsoli workera.

WYNIK: przestoje w pierwszych sekundach gry prawie zniknęły (gra 2 / 899 klatek > 50 ms, maks 0,4 s; było 7 / 299, maks 2 s), ALE start jest DŁUŻSZY: worker piecze w menu ring Ziemi (~10–11 s) i bank pasa (~4 s) na swoim urządzeniu, a strona równolegle piecze własny ring dla tła menu — dwa urządzenia biją się o GPU. `start-gry` (klik 2 s po gotowym menu): 18–33 s od kliku (ostatni przebieg mógł się nałożyć z pomiarem Fable); `render-worker-gra`: krok `pas` ~17 s po kliknięciu.

ZROBIONE (RW-41c, 2026-10-17, gałąź claude/nifty-goldstine-cd3d91 → main) i tryb domyślny = worker:
1. Tryb renderu rozstrzygany w pierwszym module `index.html` (`window.__renderModeBoot`) — w trybie worker `Core3D.noDevice` (init bez `_initGpu`, `Core3D.ready` w toku); komunikat „wymaga WebGPU” z `rwHost.onFail`; preset pierwszego uruchomienia z adaptera WORKERA (`autoGfx` w `init` → `gfxAuto`).
2. Tło menu w workerze: `rwHost.createMenuBackdrop()` (pełnomocnik o API `MenuBackdrop3D`), w workerze `MenuBackdrop3D` z hakiem `onRendered` → `menuFrame` (bitmapa na kanwę obrazu 3D, poza kamery, słońce, `launchDone`); lot intro z DANYCH planu (`introCamera.menuIntroFlight`, `StoryGame.planMenuIntro().data`), `flight.devTime / t` przekazywane do workera (fabula-gra), ostatnia klatka lotu (`final`) = obraz przenikania. Póki tło działa, klatka zero gry spod kurtyny nie zasłania go (`compose` przy `host._menu`).
3. Teren ringu Ziemi: worker po odczycie map wysyła `ringTerrain` (mapa CPU) → `HaloRingWorld.setRingTerrainMap` (ta sama dwuliniowa próbka co obraz).
4. Ring Ziemi piecze się RAZ (worker, tło menu); kolejność w workerze: GPU → planety + tło menu (przed init efektów) → efekty po gotowym tle w porcjach → przygotowanie sceny (`prepare idle`) w wolnym czasie menu; pas (bank skał) na ekranie ładowania — pipeline'y compute three r183 powstają synchronicznie, w menu stawał proces GPU i strona.
5. Złapane po drodze: podkładka `requestIdleCallback` workera miała stałe `timeRemaining() = 8` (rozgrzewka robiła całą kolejkę naraz) i 50 ms przerwy między porcjami; klatka zero po RW-45b czekała ~5 s na KOLEJNĄ stronę (worker rysuje od razu po wiadomości) — teraz czeka na narysowanie strony k; bitmapy zasobów strony szły po kolei (teraz równolegle).
6. Domyślny tryb = worker (`renderBridge.js`, D8); `?renderWorker=0` = off; zapas `inline` z powodem bez izolacji. Narzędzia (`wspolne.mjs` → `window.__RENDER_MODE_DEFAULT`) domyślnie `off`; `startChrome({ headless: false })` — okno z vsync; `scripts/webgpu/okno-worker.mjs` — tryb worker w oknie.

POMIAR KOŃCOWY (2026-10-17, GPU w spoczynku 1%, w tle CefSharp / RazerCortex): bitwa 50/20/10/3 seed 7, 45 s, ABAB — zoom 0,1: obraz workera 252–254 (t ≤ 15) / 233–246 kl/s ↔ off 168–178 / 142–161 fps (1,4–1,7×); zoom 0,45: 227–228 / 215–217 ↔ 227–233 / 197–225 (≈1,0–1,1×). Okno z vsync (180 Hz): worker — rAF strony 5,5 ms p99 6,0, złożenia 180,8/s (każda klatka), 0 chybień pierścienia, obraz ≤ 1 stronę za nakładkami; off — ten sam rytm. `fabula-gra --query renderWorker=1`: menu, lot intro, cięcie, dach, odprawa, ODDOKUJ, wylot — bez błędów.

ZOSTAJE: szybki klik (≤ ~6 s po gotowym menu) czeka na init efektów i pas workera — od kliku +2 s względem off (od wejścia do gry wyrównane); przyspieszenie init efektów workera (~4,6 s CPU) skróciłoby i to.
