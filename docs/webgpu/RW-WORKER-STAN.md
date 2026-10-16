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
| RW-41 (część) | przygotowanie sceny workera na ekranie ładowania: planety do workera od razu po starcie hosta (menu), `RenderWorkerHost.prepare(x, y)` — worker buduje ringi przy punkcie i dokańcza rozgrzewkę (`prepareScene`), strona zaczyna to przy kliknięciu i czeka przed „Start!”. `start-gry.mjs --query renderWorker=1`: gra od kliku 11,9 s (off 9,8–10,4 s), obraz workera 0,3 s po pierwszej klatce gry; ZOSTAJĄ przestoje strony 0,5–1,4 s w pierwszych ~3 s gry przy CPU klatki < 2 ms (GPU zajęte przez worker — kompilacje w klatkach workera?), tło menu dalej na stronie |
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
