# AGENTS.md — rdzeń zasad dla agentów (HULLFALL)

> Ten plik ładuje się w każdej sesji i w każdym podagencie, więc trzyma tylko to, co dotyczy całej gry: zasady żelazne, haki przekrojowe, mapę repozytorium, testy i indeks reguł obszarów. Opisy obszarów (stan, decyzje użytkownika, pułapki, narzędzia) są w `.claude/rules/<obszar>.md` — Claude Code wczytuje regułę sam, gdy czytasz albo edytujesz plik pasujący do jej `paths:`. Pracujesz nad obszarem, a jego reguła jeszcze nie weszła (np. zmiana tylko w `index.html`)? Przeczytaj ją z indeksu na końcu. Rozmiar pilnuje `tests/agentsMd.test.mjs` (limit 40 000 znaków).

HULLFALL to gra o okrętach kapitałowych (gracz prowadzi Atlasa): rozgrywka na Canvas 2D, obraz 3D na three.js r183 (WebGPU, TSL). Pętla gry i klej modułów: `index.html`, moduły w `src/`. Teksty gry i dokumentacja po polsku, pliki w UTF-8.

## Gdzie dopisywać wiedzę

- Opis obszaru (jak działa, decyzje użytkownika, pułapki, jak sprawdzić) → jego reguła w `.claude/rules/`. Nowy obszar = nowa reguła z `paths:` (każdy glob w cudzysłowie — zepsuty YAML ładuje regułę ZAWSZE) + wiersz w indeksie niżej. Do tego pliku dopisuj tylko zasadę przekrojową (dotyczy kodu poza obszarem: „nowa ścieżka X musi wołać Y”) albo zmianę indeksu.
- Reguła opisuje STAN i ZASADY w czasie teraźniejszym. Historia („dawniej…”), wyniki pomiarów i A/B → `docs/` (audyty, plany); w regule zostaje wniosek i odnośnik.
- Odnośnik „§ X” — także „AGENTS.md § X” / „agents.md, pułapka N” w kodzie i w `docs/` sprzed podziału (2026-10-19) — to nagłówek sekcji w jednej z reguł: `grep -rn "## X" .claude/rules`. Pułapki three r183 (1–39) są w regule `webgpu-tsl`, nośnik prędkości — w `pociski`.
- Notatka dla kolejnych agentów w kodzie: komentarz z prefiksem `AGENT:`.

## Zasady żelazne

1. Rozgrywka (fizyka, kolizje, obrażenia, wejście, AI) liczy się w 2D i jest źródłem prawdy. 3D to wyłącznie obraz: model, kamera 3D ani ścieżka rysowania (np. czy pocisk rysuje `WeaponFx`) nie zmieniają wyniku gry.
2. Jeden renderer: `Core3D` (`src/3d/core3d.js`, `WebGPURenderer` z `three/webgpu`). Żadnych innych `WebGPURenderer` / `WebGLRenderer`, urządzeń GPU, kanw 3D, composerów ani drugiego bloomu — post i bloom są jedne, w Core3D (strażnik `tests/overlayContextMerge.test.mjs`).
3. Tylko TSL (`three/tsl`): bez GLSL, `ShaderMaterial` / `RawShaderMaterial`, `onBeforeCompile`, `EffectComposer` i API WebGL (strażnik `tests/graBezGlsl.test.mjs`). `wgslFn` tylko dla wyizolowanej czystej funkcji, z uzasadnieniem w commicie. Przed pisaniem materiału — pułapki three r183 / TSL / WGSL (reguła `webgpu-tsl`).
4. Graf węzłów RAZ na moduł / rodzaj / wariant (budowa NodeBuildera kosztuje ~1–12 ms CPU); obiekty dostają lekkie materiały na wspólnych węzłach, wartości per obiekt w `material.uniforms` (`{ value }`), w buforach storage ze slotem albo w atrybutach instancji. Bez `defines` / `needsUpdate` w biegu (każda kombinacja = nowy pipeline) i bez przełączania `light.visible` (gaś `intensity = 0`).
5. Zero pipeline'ów kompilowanych synchronicznie w klatce gry: każdy nowy materiał, siatka i kernel compute idzie do rozgrzewki (`Core3D.warmup`, krok `Core3D.addFxStep` z `warm`). Narzędzia gry liczą pipeline'y synchroniczne — ma być 0.
6. Render domyślnie w Web Workerze: moduły renderu nie czytają `window`, `GameState` ani DOM — stan gry przez fasadę `RenderWorld`, zdarzenia gry przez rekordy strumienia rozkazów i migawkę (strażnik `tests/szewRenderu.test.mjs`; sufit podnosi się tylko z powodem w linii sufitu, liczby: `node scripts/webgpu/szewRenderu.mjs`). Reguła `render-worker`.
7. Bez alokacji w gorących pętlach (render, kolizje, AI, efekty): pule, bufory, tablice typowane, `Math.sqrt` zamiast `Math.hypot`.
8. Krok fizyki `PHYS_HZ` = 60 Hz (`?physHz=120` — A/B). Stałe „na krok” tylko przez `stepDecay120` / `ticksAt120` (`src/game/stepDecay.js`) — inaczej zmiana kroku zmienia grę.
9. Losowość obrazu i wizualiów: `fxRandom` (moduły renderu) / `fxRandomGame` (wątek gry), nigdy `Math.random` — to sekwencja rozgrywki (strażnik `tests/wizualiaFxRandom.test.mjs`).
10. Bez nowych frameworków i bundlerów (Vite zostaje). Nie kopiuj do `public/` plików, które `index.html` ładuje z roota — Vite w dev podaje `public/` przed rootem (strażnik `tests/devPublicShadow.test.mjs`).

## Mapa repozytorium

- `index.html` — pętla gry i warstwa 2D Canvas (sterowanie, fizyka, strzały, HUD, UI) oraz klej modułów w blokach z nazwami („FABUŁA”, „KIEROWANIE OGNIEM”, „WEJŚCIE / PAD”, „OPCJE GRAFIKI”…) — plik duży, bloki znajduj grepem.
- `src/game/` — logika gry (moduły czyste: bez three i DOM, gdzie się da), `src/game/story/` — fabuła i baza piratów; `src/ai/` — mózgi NPC, szyk floty, myśliwce; `src/data/` — tabele (bronie, kadłuby, systemy, eskadry…); `src/ui/` — kokpit, radar, CIC, panele stacji; `src/input/` — akcje, konteksty, pady.
- `src/3d/` — obraz: `core3d.js` (renderer, passy, post, kroki efektów), `tsl/` (wspólne pomocniki TSL), moduły obszarów (`asteroids/`, `haloRing/`, `explosions/` + `gas/`, `shield/`, `weapons/`, `rockets/`, `warp/`, `ships3d/`, `cloak/`…), `planet3d.assets.js` (planety i słońce); `src/vfx/` — rekordy wieżyczek, rozpad stacji, sprite'y efektów.
- `src/render/` — szew gra ↔ render: migawka klatki, strumień rozkazów, sloty encji, worker renderu.
- `scripts/` — narzędzia i pomiary (`scripts/webgpu/*-gra.mjs` — harness w prawdziwej grze), `tests/` — testy `node:test`, `dema/` — dema WebGPU, `docs/` — plany, audyty, opisy portów, `assets/` — grafika, modele, CSS.
- `electron/`, `package.json` — paczka Electrona i wydanie (reguła `electron-wydanie`).
- Silnika heksów nie ma (usunięty 2026-10-19): kadłuby, wraki, budowle, mostki i rdzenie są na silniku belek (`src/game/hullBodies.js`, reguła `kadluby-belki`); strażnik `tests/graBezHeksow.test.mjs`.

## Klatka gry w skrócie

1. `loop()`: wejście (`pumpInput` — jedyny odczyt padów, raz na klatkę), kroki fizyki 60 Hz (`physicsStep`: gracz i NPC, `HullBodies.step`, pociski i kolizje, rakiety, fabuła), potem `render(alpha, frameDt)`.
2. `render()`: aktualizacja modułów 3D (warp, planety, pył, ringi, stacje, świat, kadłuby `updateHexShips3D`, modele, tarcze, pas…), `Core3D.render()` i kopia obrazu 3D na kanwę 2D w tym samym zadaniu JS (po `await` kanwa WebGPU bywa pusta), na końcu HUD i nakładki 2D.
3. Domyślnie `Core3D` działa w workerze (`src/render/render.worker.js`) i rysuje grę z luster migawki, a strona składa bitmapę z nakładkami tej samej klatki (`?renderWorker=0` — tryb `off` na wątku gry). Nowy moduł 3D wołany w `render()` dostaje gałąź `RW_WORKER`: pomiń albo przenieś do workera z blokiem migawki.
4. Passy Core3D (wszystkie do `composerTarget`): tło → planety → halo → ring-planety → warp → ortho (płaszczyzna gry) → tarcze → FG, potem post (bloom, „uber”, ACES, sRGB). Nie wracaj do osobnych finalnych passów (`drawPlanets3D` itp.).

## Haki przekrojowe: dodajesz X → musisz też Y

Obowiązują w każdym obszarze — tu najczęściej psuje się grę „obok”.

**Obraz i render**
- Nowe stałe światło sceny → w scenie przed pierwszą kompilacją (strona przy starcie, worker w init przed urządzeniem — jak `initWorld3D()`), gaszone `intensity = 0`; zestaw świateł jest w kluczu każdego materiału, światło dodane później przebudowuje wszystko rozgrzane (reguła `webgpu-tsl`, „Rozgrzewka pipeline'ów”).
- Nowy materiał, siatka albo pula → rejestr rozgrzewki `Core3D.warmup.add({ name, objects, phase })` (`'loading'` — pula tworzona na ekranie ładowania, `'after'` — rzeczy, których pierwsza klatka gry nie rysuje; `shadow: true` — siatki z `castShadow`; siatki instancjonowane z `variant: WARIANT_INSTANCJI`). Każde `compileAsync` na celu przez `compileAsyncNaCelu` (`src/3d/rozgrzewka.js`).
- Nowy efekt GPU → krok `Core3D.addFxStep({ name, spawn, lights, update, warm })` (compute raz na klatkę, przed passami); pula GPU rejestruje się w `FxPoolOrigin` z kernelem przesunięcia; światła przez `Core3D.fx.lights` / `ctx.grid`, refrakcja przez `Core3D.fxDistortion()` albo warstwę DIST. Nie własne `renderer.compute` w pętli gry, cele ani passy.
- Nowe zdarzenie efektu z gry → nowy typ rekordu strumienia rozkazów (`src/render/renderCommands.js` + dekoder + test kodowania), nie wywołanie modułu renderu (`WeaponFx`, `RocketEffects`…). Wybuch z gry → `GameBlasts.blast`; mapa ran → `HullDamageEvents` (+ `setSource` / `clearSource`); strzał z wieży → odrzut liczy gra (`Turret2D.recoilForShot`).
- Nowe pole encji czytane przez moduł renderu z luster → cały łańcuch: `snapshotLayout` (na końcu ENT), `_packEntity`, `applyEntityPage`, konstruktor `MirrorEntity`, test — inaczej obraz w workerze różni się od `off`.
- Moduł renderu potrzebuje stanu gry → getter w `RenderWorld` (`src/render/renderWorld.js`), nie `window.<zmienna>`; kanwy i obrazy przez `src/3d/canvas2d.js`, praca w tle i klatka przez `src/3d/harmonogram.js`.
- Rzecz rysowana przy obcym okręcie po stronie gry → poza z `bridgeRenderPose` (interpolowana), nie `npc.x / y`.
- Obiekt na warstwach planet (3), halo (5), ring-planet (6) albo tarcz (7) → zgłaszaj co klatkę (`Core3D.markPlanetLayersActive` / `setShieldLayerActive`), inaczej pass się pominie.
- Pozycje świata (5–10 mln j.) nie trafiają do shadera we float32: duży offset w `mesh.position` (three składa `modelViewMatrix` w double), dane względem niego (`sceneOriginNearCamera`), w grafie `modelViewMatrix` — nie `positionWorld` ani ręczne `cameraViewMatrix.mul(modelWorldMatrix)`; pozycje w pulach CPU — `Float64Array`.
- Układ gra → scena / silnik belek: `X = x`, `Y = −y`, `θ = −(kąt + obrót sprite'a)`; kotwica statku = środek sprite'a.
- Materiał oświetlany słońcem w płaszczyźnie gry → człon słońca × `sunVisibility()`, otoczenie × `sunFill(vis)` (`src/3d/sunShadowMask.js`); powierzchnia w passie gry z zapisem głębi → hak ośrodka pasa `hullVolume`.
- Rzecz rysowana przy kadłubie (efekt, światło, model) gaśnie z maskowaniem (`cloakVisAtWorld` / `entityCloakVisAt`); rzecz przypięta do sprite'a okrętu (lampa, emiter) → zestaw mocowań `createHullMountSet` / `bindHullMount` / `refreshHullMountSet` (gaśnie z komórką kadłuba pod sobą).
- Emiter ma świecić → luminancja > 1 (HDR, próg bloomu ~0,9), zwykłe powierzchnie pod progiem; efekty z dem wchodzą 1:1, bez kolan i mnożników bloomu. W shaderach efektów bez `pow()` z ujemną podstawą, varyingi z clampem — NaN w buforze HalfFloat rozlewa bloom na cały ekran.
- Wiele obiektów jednego rodzaju → partia (jeden rysunek, dane per obiekt w buforze storage ze slotem): każdy rysunek to ~15–25 µs CPU w three r183. Bufor zmieniany częściowo → zakresy przez `src/3d/zakresyWysylki.js`, nie `DynamicDrawUsage` (w WebGPU = pełna wysyłka przy każdym renderze).
- Przezroczysty `DoubleSide` → `forceSinglePass: true` (inaczej dwa rysunki i inna kolejność mieszania).
- Pole symulacji zmieniane drobnymi przyrostami w teksturze połówkowej → zapis przez `sroundF16` (`src/3d/tsl/zapisF16.js`; zapis f32 → f16 obcina ku zeru).
- HUD rzutuje przez `View3D` (`worldToScreen` / `screenToWorld`), nie przez `camera.zoom`; px bufora na j. świata = zoom · `Core3D.pxScale` (`Core3D.viewZoom(cam)`).
- Nowa kanwa w panelu UI → przebij globalną regułę `main.css` `canvas:not(#c)` (absolutne, bez myszy).

**Rozgrywka**
- Ścieżka, która pokazuje albo celuje we wroga → `SensorSystem.hides(byt)` (mgła wojny); celowanie w gracza i wybór celów AI → `isCloakHidden` (maskowanie).
- Obrażenia i zapytania kadłubów tylko przez `HullBodies` (`sweep`, `impact`, `probe`, `cutSegment`), budowli przez `worldBodies`; gra rusza encję, nie węzły ani `body.pos`. Kod piszący węzły wprost w magazynie → `body._hashTick = -1`.
- Nowy wrak → `convertToWreck` / `shatter` / hak `onWreck`; usuwanie → `recycleWreckEntity` i `coldWrecks` (`coldWreckSystem.forget`); nowe odwołanie do wraku (cel, lina, rozkaz) → `markColdWreckReferences`; nowe pole stanu węzła albo belki → do migawki zimnych wraków (`src/game/hullColdSnapshot.js`).
- Śmierć okrętu → wybuch z miejsca zbiornika paliwa (`fuelTankBlast`), nie ze środka; hulki mostka (`isBridgeHulk`) — nowe ścieżki śmierci, AI i celowania je respektują.
- Nowe źródło pocisków w `bullets` → `serial: nextProjectileSerial()`, `mech` (`hasHullMechanics`), `pen: null`, znaczniki nośnika (`ivx / ivy`, `clock`, `bornSim`) — wzór `fireWeaponCore`. Efekt z nośnikiem → `ActiveCarrier.set(writeCarrier(…))` … `clear()`. Test pocisku przeciw celowi w pętli kandydatów → odcinek w ruchu względnym (`segX0`).
- Broń i obrażenia myśliwców → filtr IFF z `src/game/friendlyFire.js`; jednostka gracza poza frakcjami → `playerOwned = true`.
- Obrażenia od broni gracza → `applyDamageToNPC(…, byPlayer)` (znacznik trafienia); obrażenia gracza od pocisku NPC → stempel `__fcHitPlayerAt` strzelca; obrażenia zatrzymywane przez tarczę → test przebicia `isShieldBreachedAt`; obrażenia obszarowe → też `RepairSwarm.blast` (drony naprawcze).
- Zestrzelenie rakiety lub torpedy → tylko `killRocketThreat`.
- Przylot, odlot, wezwanie NPC tunelem warpa → rejestr `warpTraffic` (nie `WarpNurt`); wyjście z warpa → `exitWarp`; przylot wroga spoza kolejki wezwań → `noteCameraDirectorCue`; sterowanie skrzydłem pomija jednostki z `__warpReturn`. Nowa ścieżka wyjścia NPC z warpa → pęd z `warpExitMomentum` (punkt przylotu = koniec ślizgu) i flaga `__warpExitSlide` (model lotu trzyma limit bojowy do końca ślizgu), nie zerowanie prędkości.
- Kamera: wejście ustawia `camera.targetZoom` (sprężyna raz na klatkę renderu, nie w `physicsStep`); offsety kamery tylko w rigu (`src/game/cameraRig.js`); wstrząs z modułu renderu → hak `onShake` (żądanie do gry), nie `window.camera`.
- Ciąg, skok, szarża, hipercruise → `mainEngineFraction` / `engineThrustScale` / `engineBlocksDrive` (uszkodzenie i stan silników).
- Prędkość przelotu, hipercruise'u albo warpa (gracz, NPC, ruch v2) → jedna tabela `src/data/driveModes.js`, nie stała w module.
- Modyfikatory okrętu → `setModifierSource`, nigdy `entity.modifiers =`; zasięg i prędkość pocisku broni → `weaponRangeFor` / `weaponSpeedMul`.
- Nowa ścieżka montażu broni u gracza (fitowanie, zapis wyposażenia, sklep, konsola dev) → przez `playerFitFits` / `savedHardpointBucket` / `weaponBuildCost`: broń `npcOnly` (promień śmierci Colossusa) do gracza nie trafia; broń z `npcFaction` uzbraja tylko tę frakcję (`equipNpcWeapons`).
- Mózgi NPC liczą się też w klatkach bez kroku fizyki — mózg pisze tylko ZAMIARY (intencja lotu, cel, wieże); mózg całkujący ruch sam musi zostać w kroku (`aiOffStepEligible`).
- Logika nie czyta klawiszy ani padów wprost: akcje (`Input.*`, rejestr `GameActions`); nowa akcja = wpis w `INPUT_ACTIONS` + układy + `GameActions`.
- Nowy rodzaj obiektu na radarze → rekord w `radarFeed.collect` (nie rysunek w kokpicie).
- Ruch statku przy Ziemi, Marsie i Jowiszu (spawn, teleport, autopilot) omija płytę ringu — przelot tylko tranzytami, a na Jowiszu (ring w budowie) także przerwami; kod zakładający pełny pierścień albo 4 tranzyty doliczy przerwy z `layout.construction` (reguła `ring-halo`).
- Kawałek bazy piratów łamie się przez `storyBaseBreak` / `pirateBaseWorld`; konfiguracja pola pasa idzie przez `beltWorld`, nie `asteroidBelt.field`.
- Stała efektu objęta presetem grafiki → zmiana tabeli w `src/game/graphicsQuality.js`.
- Ekonomia jest jedna — ruch v2 w workerze (reguła `ruch-v2`); gra nie trzyma magazynów stacji. Zmiana zapasu stacji z gry (handel, rozbiórka, zakup w porcie, łup) → `adjustStationStock` (most `trafficV2.stockDelta`); odczyt magazynu i ceny → `getTradeEconomy` / `getTradePrice` (kopia rynku z mostu); nowy rynek → `addMarket` / `TrafficBridge.addMarket`.

## Częste zadania

- Nowy kadłub: `HULL_RENDER_PROFILES` (`src/data/ships.js`), `HULL_SPRITE_PATHS_BY_ID` i `getNpcHullRenderProfileId` (`index.html`), gniazda w `src/data/hardpointEditorDefaults.js` (kadłub gracza spoza kluczy edytora — `EDITOR_HULL_KEY_BY_PLAYER_ID`, strażnik `tests/playerEditorKey.test.mjs`), dysze MAIN w `ENGINE_FX_DEFAULTS` (`src/data/engineFx.js`), mostek wg `docs/BRIEF-mostek-nowego-kadluba.md` (flota TN — strefa = obrys modelu poziomu klasy w miejscu gniazda `bridge` v 2 presetu kreatora, `src/data/bridgeLevels.js`), rdzeń reaktora — marker w `REACTOR_CORE_MARKERS` (`src/data/reactorCores.js`: komora `r`, obudowa nad kadłubem `hr`, poza wieżami i mostkami; kadłub z presetem kreatora — miejsce z presetu, reguła `mostki-reaktor`), obrys 3D (`node scripts/webgpu/obrysy-floty.mjs`).
- Nowa broń: `MASTER_WEAPONS` (`src/data/weapons.js`: `recoil`, `shake`, zasięg w paśmie swojej roli — reguła `bron-gracza`), `WEAPON_FX` (`src/3d/weapons/weaponFxTable.js`), klucz wieżyczki (`FX_PROFILE` w `src/vfx/turret2D.js`), rodzina 3D (`FAMILIES` w `src/3d/ships3d/weapons/weapons3D.js`).
- Nowa misja: skrypt w `src/game/story/missions/` + kwestie w `src/data/story/`; gry dotyka tylko przez `api` z `src/game/story/storyGame.js` (reguła `fabula`).
- Nowy typ skały pasa, nowy system F, nowa rola myśliwca, nowa formacja: lista kontrolna w regule obszaru (`pas-asteroid`, `systemy-f`, `mysliwce`, `flota-ai`).

## Testy i weryfikacja

- Testy: `node --test "tests/*.test.mjs"` (wzorzec w cudzysłowie — samo `tests/` na Node 22 nie działa); `npm test` to osobny zestaw (`scripts/test.mjs`). WGSL buduje się w Node bez GPU (`renderer.backend.createNodeBuilder`) — testy materiałów czytają wygenerowany kod.
- Prawdziwa gra: narzędzia `scripts/webgpu/*-gra.mjs` (Chrome przez CDP) — zrzuty, czasy klatek, pipeline'y synchroniczne (ma być 0). Domyślnie tryb `off` (render na wątku gry — `window.__RENDER_MODE_DEFAULT`), tryb gracza: `--query renderWorker=1` albo `HULLFALL_RENDER_DEFAULT=worker`. Haki `?dev`: `window.DevScene.*`. Kroki tylko przez `__harness.step()` — czekanie na `requestAnimationFrame` przy wstrzymanym zegarze harnessu nigdy nie wraca.
- Zrzuty i porównanie z bazą: `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/<katalog> --baza <katalog bazy>`, `scripts/webgpu/porownaj.mjs` (szczegóły: reguła `webgpu-tsl`, „Weryfikacja”). A/B dwóch wersji — przebiegi PO KOLEI, nie dwa harnessy naraz.
- Wydajność: PerfHUD (`P`), `Core3D.gpuFrameMs` (+ `gpuComputeMs`), `scripts/profil-bitwy.mjs`, `scripts/profil-bitwy-flot.mjs`, `scripts/webgpu/koszt-klatki.mjs` (reguła `core3d`). Porównuj czasy funkcji A/B na tej samej klatce, nie sam FPS.
- Zrzuty i wyniki pomiarów tylko do `.tmp/` albo scratchpada (`.tmp/`, `tmp/`, `output/` są w `.gitignore`); skrypt, który ma zostać narzędziem → `scripts/`.

## Konwencje PR i lista kontrolna

- Zmiany małe i izolowane; API bez zmian bez potrzeby i opisu skutków; zgodność rozgrywki 2D.
- [ ] Brak nowych rendererów poza `Core3D`; nowy kod renderu w TSL; nowe materiały i obiekty w rozgrzewce.
- [ ] Szew gra ↔ render nie rośnie (`tests/szewRenderu.test.mjs`): moduł `src/3d` / `src/vfx` nie czyta nowych zmiennych gry z `window` ani DOM, nie importuje nowych modułów `src/game` / `src/ai`; `index.html` nie dokłada odwołań do renderu.
- [ ] Brak alokacji w pętli render / update tam, gdzie były bufory i pule.
- [ ] Brak regresji sterowania i kolizji 2D; spójność osi i obrotów (sprite, dysze, trafienia).
- [ ] Mierzalna poprawa albo brak regresji FPS.
- [ ] Wiedza o obszarze dopisana do jego reguły w `.claude/rules/`, zasada przekrojowa — tutaj.

## Indeks reguł obszarów (`.claude/rules/`)

| Reguła | Obszar |
|---|---|
| `webgpu-tsl` | Render WebGPU + TSL: zasady, pułapki three r183 / TSL / WGSL (1–39), rozgrzewka pipeline'ów, pisanie modułów 3D (ładuje się przy całym `src/3d/`, `src/vfx/`, `dema/`) |
| `core3d` | Core3D: klatka i passy, post i bloom, efekty GPU (`Core3D.fx`), maska słońca i cień kadłubów, wydajność renderu |
| `render-worker` | Render w workerze: szew gra ↔ render, migawka, strumień rozkazów, sloty, rytm obrazu |
| `planety` | Planety, słońce, księżyce, małe ciała, atmosfery Jowisza i Saturna, generator map |
| `niebo` | Wypiekacz nieba, tło kosmosu |
| `ring-halo` | Ring „Halo” (Ziemia, Mars, Jowisz): świat ringów, kolizje, render |
| `k7-obsluga` | Hala K-7: obsługa paliwowa stanowisk, ramiona SCARA, przewody, hala z Blendera |
| `pyl-hal-k7` | Pył i para w halach K-7, źródła gazu, światła i pola siłowe hali |
| `gaz-przestrzeni` | Gaz w otwartej przestrzeni (port dema gazy-transport): pole z transportem gęstości, scena pasa, mapy i warstwa |
| `pas-asteroid` | Pas asteroid: pole, olbrzymy, wydobycie, rumowiska, populacje, NEA, nowy typ skały |
| `komety` | Komety |
| `ruch-v2` | Ruch v2 — jedyna ekonomia gry: rynki (`addMarket`), kursy i zlecenia, most i worker, napędy ruchu, pola górnicze i wyrwy, bramka bilansu |
| `baza-piratow` | Baza piratów (misja 1) i planetoida Hidalgo: budowle, szyja, upadek, powietrze, uderzenia |
| `fabula` | Fabuła: reżyser misji, intro w K-7, kampania |
| `kadluby-belki` | Kadłuby na silniku belek: trafienia, kratery, odrost, bryły 3D, mapa ran, integracja z grą |
| `kreator-kadlubow` | Kreator kadłubów (demo, niewpięty): format projektu, klocki i strażnik „bez czitowania”, kompozytor TSL, sieć systemów (kable i rury), przyjazny edytor „Stocznia” (przeciągnij i upuść) |
| `ciala-swiata` | Budowle na silniku belek: kawałki, kotwice, broń, rozpad, skóry |
| `wybuchy-gaz` | Wybuchy WebGPU i gaz 3D: domeny, przeszkody, zbiorniki paliwa, dym zgniotu |
| `flota-ai` | Szyk floty, formacje, omijanie przeszkód, rozkazy RTS, AI poza krokiem fizyki |
| `mysliwce` | Myśliwce: pilot, role, bomby, eskadry gracza |
| `bron-gracza` | Zasięgi broni, kierowanie ogniem, celownik, tryby okrętu pod ŚPM |
| `systemy-f` | Systemy F i modyfikatory okrętu |
| `statek-gracza` | Statek gracza: lot, zapis wyposażenia, WYPOSAŻENIE |
| `pociski` | Pociski, kolizje, nośnik prędkości, przebicia, IFF, ładowanie broni |
| `efekty-broni` | Efekty broni (WeaponFx), receptury, wygląd pocisków |
| `rakiety` | Rakiety i torpedy, salwy, Supernowa, obrona punktowa |
| `tarcze` | Tarcze: pula slotów, przebicie, wygląd |
| `maskowanie` | Maskowanie: wygląd, efekty, wizjer |
| `warp` | Warp gracza, TRAVEL TO, wezwania wsparcia, warp „Nurt” w Core3D |
| `scena-wojna` | Scena „Wojna”: floty z warpa, bitwa w głębi (tłum nad i pod płaszczyzną, planeta w głębi), bohaterowie, ujęcia kamery |
| `fregata-zwiadu` | Fregata zwiadu w ładowni Atlasa |
| `holownik` | Uszkodzenie silników i holownik serwisowy |
| `silniki` | Silniki MAIN / WARP / SIDE, zapłon i gaszenie |
| `drony-naprawcze` | Rój dronów naprawczych (R) |
| `roj-przeladunkowy` | Rój dronów przeładunkowych (demo) |
| `mostki-reaktor` | Mostki i rdzeń reaktora |
| `wraki` | Wraki: gorące, śpiące, zimne |
| `mgla-wojny` | Mgła wojny |
| `radar-cic` | Radar taktyczny kokpitu, skan X, mapa CIC |
| `kamera` | Kamera: zoom, rig, reżyser kadru, wstrząsy, kop warpa |
| `pyl-kosmiczny` | Pył kosmiczny |
| `menu` | Menu główne i jego tło 3D |
| `opcje-grafiki` | Opcje grafiki: presety, dobór automatyczny, rozdzielczość dynamiczna, VSync |
| `stacje` | Stacje i obiekty świata 3D, rozpad stacji |
| `modele-3d` | Modele 3D statków i broni, bronie z Blendera, kamery 3D |
| `oswietlenie-kadlubow` | Oświetlenie kadłubów v2 |
| `wejscie` | Warstwa wejścia, pad, skróty klawiszowe |
| `electron-wydanie` | Electron, paczka i wydanie |
