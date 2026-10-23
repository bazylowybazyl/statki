---
paths:
  - "src/3d/core3d.js"
  - "src/3d/fx/**"
  - "src/3d/tsl/**"
  - "src/3d/hexShips3D*.js"
  - "src/3d/sunShadowMask*.js"
  - "src/3d/hullShadowSdf.js"
  - "src/3d/bloomConfig.js"
  - "src/3d/rozgrzewka.js"
  - "src/3d/zakresyWysylki.js"
  - "src/3d/renderTargetResize.js"
  - "src/3d/sceneOrigin.js"
  - "scripts/webgpu/zrzuty.mjs"
  - "scripts/webgpu/koszt-klatki.mjs"
  - "scripts/profil-bitwy*.mjs"
---

# Core3D: klatka i passy, post i bloom, efekty GPU, maska słońca, wydajność renderu

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/core3d.js`** — **jedyny współdzielony rdzeń renderu 3D**: `WebGPURenderer` (`three/webgpu`), `scene`, kamery, passy scen do `composerTarget`, post jako `RenderPipeline` (TSL). Wspólne pomocniki TSL: `src/3d/tsl/`.

- **`src/3d/hexShips3D.js`** — aktualizacja i render statków/hexów 3D; końcowe wywołanie renderu 3D (`Core3D.render()`) i kopiowanie na 2D.

- **`src/3d/fx/`, `src/3d/weapons/`, `src/3d/rockets/`, `src/3d/warp/`** — efekty z dem WebGPU: infrastruktura efektów GPU (klatka `Core3D.fx`, siatka świateł, zniekształcenia, początek pul), broń (`WeaponFx`), rakiety (reżyser `RocketEffects`), warp „Nurt” (`WarpNurt`). Opisy: § „Miejsca do pracy” (Core3D), „Efekty broni”, „Rakiety”, „Wybuchy WebGPU”.

## Pipeline renderowania (aktualny)

1. **Gameplay i fizyka** dzieją się w 2D (`index.html`, kadłuby na belkach `hullBodies.js`, logika broni/NPC/HUD).

2. W `render(alpha, frameDt)` aktualizowane są moduły 3D:
   - `WarpNurt.update(…)` (warp „Nurt”: ośrodek, bańki, szczeliny, gwiazdy i mgławica skoku — przed planetami)
   - `updatePlanets3D(frameDt, cam)`
   - `SpaceDust3D.frame(dt, camNoShake, camera2, wł.)` (pył kosmiczny — prędkość kamery do smug; uniformy w haku passa ortho)
   - `haloRings.update(frameDt, cam, …)` (ring „Halo”)
   - `updateStations3D(stations)`
   - `updateWorld3D(frameDt, vfxTime)`
   - `updateHexShips3D(cam, hexEntities)`
   - `asteroidBelt.prepareFrame(frameDt, ship, …)` (pas asteroid — wejście klatki; praca w kroku `Core3D.fx` przed passami)

3. Finalna klatka 3D (kanwa WebGPU `#webgl-layer`) jest kopiowana na główny canvas przez `drawHexShips3D(ctx, W, H)` — w TYM SAMYM zadaniu JS co render (po `await` kanwa WebGPU bywa pusta). Podzielony ekran = 2× `Core3D.renderSingle` + wycinki (jeden render z nożyczkami nie istnieje: `clear()` w WebGPU czyści cały cel).

4. HUD/overlays 2D są rysowane na końcu.

## Core3D (`src/3d/core3d.js`)

- Modyfikacje renderera, passów scen (runner `_runScenePass`: tło → planety → halo → ring-planety → ortho → tarcze → FG, wszystko do `composerTarget` HalfFloat MSAA 4, czyszczona tylko głębia) i postu (`RenderPipeline`) rób wyłącznie tutaj.

- Bloom jest JEDEN — w poście Core3D (od zadania 20 bez overlaya i jego bloomu). Parametry (strength/radius/threshold) żyją w `src/3d/bloomConfig.js` — jedyne źródło prawdy; na żywo — konsola `DevVFX.bloom` (Core3D strony, tryb `off`; panel Bloom z F12 usunięty 2026-10-19).

- Bloom przepuszcza przez próg CAŁY teksel (nie nadmiar) i dokłada ~3 × strength jego energii (suma wag mipów 3,0; radius tylko przesuwa wagę między mipami; rozmycia gubią ~3%): Core3D 0,85 → ~2,5×. Jasność nowego emitera dobieraj z tym w głowie. **Od zadania 25b (decyzja użytkownika 2026-09-28: „do poziomu dem”) bloom gry = bloom dem WebGPU:** `col + bloom(col, strength, radius, threshold)` bez mnożnika, jak `dema/bronie-webgpu`, `rakiety-webgpu`, `asteroidy-webgpu`, `warp-webgpu` (do 25b gra mnożyła bloom × 3 — `BLOOM_ZGODNOSC_WEBGL`, obraz 1:1 z dawnym `UnrealBloomPass`, ~7,5×). **Efekty z dem wchodzą 1:1 — bez kolan i mnożników kompensujących bloom** (dawne `warp/bloomKnee.js`, `beltBloomKnee` usunięte); stare emitery spoza dem mają ~1/3 dawnej poświaty — przestrojone tylko tam, gdzie zamierzona poświata znikała (korona słońca: `SUN_BLOOM_NADMIAR` w `planet3d.assets.tsl.js`). Algorytm BloomNode (strażnik różnic three i braku mnożnika: `tests/webgpuPost.test.mjs`); od zadania 23 liczony compute (`BloomGryCompute`, `tests/bloomCompute.test.mjs`).

- Post (`src/3d/tsl/postGry.js`): scena (`composerTarget`) → bloom → „uber” → kanwa, jako `RenderPipeline`. Bloom =
  `BloomGryCompute` (`src/3d/tsl/bloomCompute.js`: 12 kroków BloomNode jako kernele w JEDNYM `renderer.compute(lista)`, cele
  bit w bit — `scripts/webgpu/bloom-parzystosc.mjs`), liczony raz na RENDER (podzielony ekran = dwa `renderSingle`), rozmiar =
  bufor rysowania × `resolutionScale`, alfa = max(rgb) bloomu jak przy dawnym blendzie. „Uber” próbkuje scenę i bloom tym
  samym przesuniętym UV (gorące powietrze do 24 źródeł, dyspersja dysz, zniekształcenia efektów), potem ACES gry i sRGB;
  przed bloomem i w odczytach sceny siatka bezpieczeństwa NaN / ±Inf → 0 (`hdrBezpieczny` — test bitów wykładnika, nie
  `x != x` ani min / max). Dwa `RenderPipeline` zbudowane raz — z bloomem i bez (`perfToggles.bloom`, czytane w każdym
  renderze), gorące powietrze = uniform `uHeatOn`: przełączniki bez przebudowy. Strojenie bloomu = uniformy
  (`_applyBloomPassConfig` co klatkę, konsola `DevVFX.bloom`). Gorące powietrze w podzielonym ekranie ma tylko widok gracza 1.

- OBRÓT KADRU (`cam.roll`, 2026-10-19; obraca demo `dema/warp-ped.html` — kamera w skoku kursem w górę — i od
  2026-10-23 HIPERCRUISE gracza w grze, reguła `kamera`):
  kamera gry może nieść kąt `roll` [rad] (brak pola = 0); konwencja `src/render/viewRoll.js` (warstwa szwu — liczy z nią też
  HUD gry; `src/3d/viewRoll.js` to re-eksport dla modułów renderu) — ekran = R(−roll)·(świat −
  kamera)·zoom w osiach gry (y w dół): `cameraRoll(cam)`, `rollToScreen` / `rollToWorld`, `rolledHalfExtents` (pół pudła
  osi świata wokół obróconego kadru — culling i pudła). `syncCamera` obraca kamery three (`cameraOrtho.rotation.z =
  −roll`, `cameraPersp.up = (sin roll, cos roll, 0)` przed `lookAt`, `Core3D.viewRoll`); obrót znają: maska słońca
  (`uViewRot` — świat piksela), gorące powietrze (`_pushHeatHazeForCamera`), zniekształcenia (`DistortionField.commit(…,
  roll)` — pozycje i kierunki źródeł w osiach ekranu), kadr efektów (`FxFrame._viewRect`), warp „Nurt” (pudła ośrodka,
  odcinanie, mgławica, smugi, rulon), soczewka świata i culling planet (`planet3d.assets.js`: `lensToWorld`,
  `isCircleVisibleInGameCamera`), okno pola pasa (`AsteroidBelt._computeView`) i ringi „Halo” (kamera ringu, pudło
  kadru — `HaloRingGame.update`), mgła wojny w poście (`uFogRot` — punkt świata piksela, `packFogView` z pudłem
  obróconego kadru), pył kosmiczny (`G4.yz` — wzór drobin i smugi do osi ekranu, kontener z obróconego kadru), komety
  (`_inView`), proxy statków ruchu (`ShipProxyBatch3D.begin`), przeładunek w portach (`portCargo3D` — pudło kadru stanowisk), budżet marszu wybuchów, bitwa w głębi (`warBackdrop3D`). Przy roll = 0 każda z tych ścieżek daje te same liczby co bez obrotu. W grze kąt niesie migawka workera
  (`HEAD.CAM_ROLL` / `CAMNS_ROLL` → `cam.roll` / `camNs.roll` w `render.worker.js`); po stronie gry z obrotem liczą
  rzuty HUD-u (`worldToScreenInto` / `screenToWorld`, `screenAngleFor`), pudło cullingu kadłubów (`fillHexCullInfo`),
  bramka efektów trafień i okno gazu przestrzeni. Stacje (`updateStations3D` bez pudła) i dysze (pudło z `fillHexCullInfo`)
  nie potrzebują nic więcej. Nowy moduł rzutujący sam — `rollToScreen` / `rolledHalfExtents`.

- Efekty GPU (`src/3d/fx/`, opis `docs/webgpu/FX-INFRA.md`): `Core3D.fx` (`fxFrame.js`) raz na klatkę rAF na starcie
  `render()`, przed passami (drugi `renderSingle` podzielonego ekranu nic nie robi): kroki
  `Core3D.addFxStep({ name, spawn?(ctx), lights?(ctx), update?(ctx), warm?(ctx) })` → początek pul przy kamerze i zegary
  (`ctx.origin` = `FxPoolOrigin`; **pula GPU MUSI się w nim zarejestrować** z kernelem `createShiftKernel`, inaczej początek
  przestawia się pod jej danymi) → siatka świateł → update. Zegar efektów `ctx.time` / `Core3D.fx.time` biegnie z klatką
  rAF (krok ≤ 0,1 s, także w pauzie). `warm` idzie przez rejestr rozgrzewki (puste dispatche kerneli + `prewarmPass`).
  **Siatka świateł** (`Core3D.fx.grid`): `renderer.lighting = GridLighting` w trybie „optIn”, ustawiony PRZED
  `renderer.init()` (three r183 łapie `lighting` w init — podmiana później nic nie zmienia); czytają ją tylko materiały z
  `gridLights = true` (`enableGridLights(mat, owner)`) — reszta ma WGSL i obraz bez zmian. Światła efektów:
  `Core3D.fx.lights.flash(...)` / `.point(...)` (świat gry, nośnik z `ActiveCarrier`), własne światła kroku przez
  `ctx.grid.addWorld(...)`. **Zniekształcenia** (gałąź „uber” tylko przy źródłach): fala / implozja / gorące powietrze /
  soczewka bańki warpa (pierścień na elipsie, w środku 0 — kadłub ostry; 2026-10-19) —
  `Core3D.fxDistortion().shock / implode / heat / bubble(...)` (świat gry, co klatkę przed renderem; dysze i tarcze zostają przy
  `pushHeatHazeWorld`); warstwa DIST — siatki na `FX_DISTORT_LAYER` (10) piszą przesunięcie w px (osie sceny, RG) do
  `Core3D.distortionTarget` (RGBA16F: B / A — heksy-ekrany maskowania, B < 0 — refrakcja kadłuba bez aberracji;
  inne źródła piszą B = A = 0), właściciel co klatkę `Core3D.setDistortLayerActive(bool)`. Pomiar: `Core3D.fxStats` (PerfHUD
  „Efekty GPU”), kontrola na GPU: `scripts/webgpu/efekty-kontrola.mjs`. Bank `Fx3D` (`fxParticles3D.js`): cztery grafy
  (BB, PLUME, CROSS, WASH) wspólne dla systemów, tekstura per obiekt (`FxMapNode`).

- Pipeline jest HDR-first: emitery (pociski, beamy, dysze) mnożą kolory >1.0, próg bloomu ~0.9 odcina zwykłe powierzchnie. Nowe efekty, które mają świecić, muszą wypychać luminancję >1.

- Nie duplikuj postprocessingu w innych modułach. Nowe efekty GPU: compute przez `Core3D.addFxStep` (raz na klatkę, przed passami), światła przez siatkę (`Core3D.fx.lights` / `ctx.grid`), refrakcja przez `Core3D.fxDistortion()` albo warstwę DIST (`FX_DISTORT_LAYER`) — nie własne `renderer.compute` w pętli gry, własne cele ani passy (`docs/webgpu/FX-INFRA.md` §10).

- Passy planet (warstwa 3), halo (5), ring-planet (6) i tarcz (7) są pomijane, gdy nikt nie zgłosi na nich widocznej zawartości (`Core3D.layerActivity`). Dodając obiekt na te warstwy, zgłaszaj go co klatkę (`Core3D.markPlanetLayersActive` / `Core3D.setShieldLayerActive`) — inaczej zniknie.

- Mapa cienia słońca: w WebGPU odświeżanie jest per światło (`renderer.shadowMap` ma tylko `enabled` / `type`). Słońce gry zgłasza się `Core3D.setSunShadowLight(light)` — dostaje własny węzeł cienia `PassShadowNode` (`autoUpdate = false`), a Core3D odświeża mapę PRZED passem, który ją czyta, z rzucającymi z warstw tego passa (ortho: warstwa 0; FG: warstwa 2 i trzymacze rozgrzewki cienia na warstwie 31), jak `WebGLShadowMap` w bazie — planety i ring-planety czytają ostatnią mapę (pułapka 23). Bez rzucających w kadrze cienia i bez innych odbiorców mapa i łapacz są pomijane (`_passSunShadow`). Nowe światło z cieniem zgłaszaj tak samo — bez tego ShadowNode three odświeża mapę raz na klatkę rAF ze wszystkimi warstwami kamery cienia.

- Cienie słońca (shadow shafts) to MASKA widoczności, nie filtr obrazu: `Core3D._renderSunShadowMask` liczy ją raz na klatkę (pass TSL — `createShadowShaftsPass`, jeden quad) przed pre-passem halo (`sunShadowTarget`, `src/3d/sunShadowMask.js`; R = cień powierzchni, G = smuga tła z ringami, B = mrok pola). Nowy materiał (TSL) oświetlany słońcem w płaszczyźnie gry importuje z `sunShadowMask.js` funkcje i mnoży przez `sunVisibility()` człon słońca, a otoczenie przez `sunFill(vis)` (w pełnym cieniu `SUN_SHADOW_FILL` = 0,4); światła, żar i glow zostają; bez modelu światła — `sunShadeUnlit(color)`; tło — `sunShaftBackdrop(color)`; wbudowane materiały three — `applySunShadowToBuiltinMaterial` (hak w polach materiału: `setupLightingModel` gasi `direct()` modelu klasy, `outputNode` kładzie smugę — NodeLibrary kopiuje pola na materiał węzłowy). Funkcje czytają maskę po `screenUV` (tylko w węzłach fragmentów) na wspólnych węzłach `sunShadowUniforms` (`.value` jak dawniej; uniformy w grupie renderu). `SUN_SHADOW_GLSL` (`sunShadowMaskGLSL.js`) to napis tylko dla modułów GLSL poza grą (Z4/Z5/Z7) — gra go nie używa. Parzystość maski z bazą WebGL w grze: `scripts/webgpu/maska-slonca.mjs --root <worktree tagu>`. Emitery (broń, dysze, błyski, światła pozycyjne, tarcze) i ring „Halo” (własny model słońca) maski NIE czytają. Nie przywracaj quada mnożącego gotowy obraz — gasił broń z warstwy 0 pod progiem bloomu i kładł drugi cień na ring. Tarcze ciał (2026-10-08, zgłoszenie „cienie planet się rozjeżdżają”): `Core3D.pushShaftDiscWorld(x, y, r, siła, depth, axisX, axisY)` — `depth` = z ciała w scenie (planety i księżyce tła: −50 000), `_resolveShaftDiscs` rzutuje tarczę z perspektywy passa planet tam, gdzie ciało WIDAĆ w płaszczyźnie gry (dawniej smuga Saturna / Wenus była szersza od tarczy i jechała względem niej z kamerą), oś smugi (`uDiscAxis`) z prawdziwego środka ciała; w soczewce warpa tarczę zgłasza `_lensPlace` ciała (za ciałem w kadrze skoku, siła 1 − β). Kadr maski = rozmiar celu sceny / zoom (jak kamera ortho passów — przy devicePixelRatio > 1 px CSS dawały inną skalę niż obraz 3D). Ring „Halo” rzuca smugę (i pas na tarczy planety — `hasShaftRingOccluder`) dopiero od podpięcia brył (`e.shadowReady`); siła cienia ringu (`setShaftRingOccluder(…, strength)`, domyślnie 1; `uRings` = 2 vec4 na ring: okrąg i siła) — w soczewce warpa udział prawdziwego widoku (ring jedzie z obrazem planety, reguła `ring-halo`). Lustro CPU `discSunVisibilityCpu(…, axes)` czyta tarcze z kadru ostatniej maski. PUDŁA (2026-10-17): kadłub i tarcza ze smugą mają pudło cienia w świecie liczone na CPU (`hullShadowAabb`, `shaftDiscAabb`), pętle maski pomijają piksel poza pudłem (przy 5120 × 1440 maska 1,03 → 0,37 ms); zmiana zasięgu cienia w shaderze (długość smugi, miękkość, zasięg kadłuba) = zmiana pudła (testy `hullShadowSdf`, `shaftDiscAabb`); A/B `Core3D.shadowHullAabb` / `shadowDiscAabb = false`.

- Cień kadłubów w passie shadow shafts = pole odległości sylwetki (`src/3d/hullShadowSdf.js`: warstwa tablicy tekstur na kształt, pieczenie z budżetem w `updateHexShips3D`, wgranie jednej warstwy przez `Core3D.uploadTextureLayer`). Okluder statku zgłaszaj przez `Core3D.pushShaftHullSdf` z danymi z `packHullShaftOccluder` (to samo przekształcenie co mesh kadłuba). `hullSdfShadow` zwraca DWA kanały (2026-10-07): powierzchnia (R) pomija piksele na własnym kadłubie (bez samocienia), tło (G) nie — sylwetka SDF (koła na komórkach) jest szersza od skóry przy wyrwach (poszarpany brzeg `hullTearFray`), więc z pominięciem w tle tło przy brzegu każdej dziury wychodziło oświetlone, a głębiej w cieniu (jasna obwódka = „przezroczysty” kadłub). Zmieniając `hullSdfShadow` (TSL), zmień też lustro `traceHullShadowCpu` — na nim stoją testy; maskę w grze porównuje z bazą WebGL `scripts/webgpu/maska-slonca.mjs`.

- Cele pomocnicze, do których rysują materiały SCENY (pre-pass halo, zniekształcenia), mają format / typ / MSAA / głębię `composerTarget`: three buduje materiały (NodeBuilder) i pipeline'y per KONTEKST renderu, a kontekst to stan załączników celu — inny format = budowa wszystkiego w kadrze na zimno przy pierwszym użyciu. Tablice warstw (`DataArrayTexture`): three r183 w WebGPU ignoruje `layerUpdates` i na `needsUpdate` wgrywa całą tablicę — jedna warstwa przez `Core3D.uploadTextureLayer`; zakresy tekstur backend też ignoruje (każda zmiana = pełne `writeTexture`), zakresy buforów honoruje — dane zmieniane częściowo trzymaj w buforze storage (wzór: obrażenia mostków).

## Wydajność (CPU three r183, wysyłki, łaty Core3D, narzędzia)

- Bez nowych alokacji per-frame tam, gdzie da się użyć pooli/buforów.
- Profiluj przez `PerfHUD` (`performance.now()`), szczególnie: physics/draw/3D update.
- Pętle „każdy kadłub × każde światło/emiter” w `updateHexShips3D` (payload świateł, `buildCombinedShipLightShaderPayload`): dane celu (pozycja, promień) raz na kadłub, w pętli po światłach sama arytmetyka. Liczone per para kosztowały w bitwie ~125 okrętów większość „U hex” (4,5 ms). Własne lampy kadłuba są w cache per encja — obiekty lamp z payloadu tylko do odczytu. Światła INNYCH okrętów payload bierze z indeksu przestrzennego klatki (`buildExternalLightIndex` po zebraniu emiterów i grup lamp, 2026-10-07; wynik i podpis jak pełny przegląd list — `tests/shipLightIndex.test.mjs`): światło dopisane do tych list PO budowie indeksu go unieważnia (pełny przegląd) — dopisuj przed `buildExternalLightIndex`.
- **Koszt CPU three r183 na WebGPU** (zadanie 23, `docs/webgpu/WYDAJNOSC.md`): ~15–25 µs na rysunek (`Bindings._update` przegląda KAŻDE wiązanie grupy „object” — tekstury, samplery, bufory storage, uniformy; węzły OBJECT; wersje atrybutów) i ~40 µs na `renderer.render()` (lista, kontekst, klucze, pass, zgłoszenie) — 3–5 × WebGL. Dużo obiektów jednego rodzaju: dane per obiekt w buforze storage ze slotem (`HullObjectStore`, `HullLightStore`) i PARTIE — jeden rysunek na wspólny zestaw tekstur (`hullSkinBatch.js`; kolejność w partii = kolejność dodania). Seria przebiegów pełnoekranowych: kernele w JEDNYM `renderer.compute(lista)` (bloom — `tsl/bloomCompute.js`), nie osobne `QuadMesh.render`. Kernele klatki: lista zamiast wywołania na kernel (`gpuFx.update`; dispatch w passie to osobny zakres użycia — bariery jak między passami; wątków = `.count` węzła). Uniformy zmieniane między kernelami jednej listy muszą być per kernel.
- `DynamicDrawUsage` w WebGPU = pełna wysyłka atrybutu przy KAŻDYM renderze, który rysuje siatkę — zakresy przez `src/3d/zakresyWysylki.js` (`zbierzZakres` — jeden zbierany zakres, bezpieczny dla atrybutów bufora z przeplotem; `zbierzZakresy` — kilka), bez `DynamicDrawUsage`. Kopie CPU buforów storage liczonych tylko na GPU oddawaj po utworzeniu (`tsl/kopiaCpu.js`).
- Core3D łata three (zadanie 23): klucz węzła świateł z pamięci (`tsl/kluczSwiatel.js` — three liczył go przy każdym `render()`), jeden `writeBuffer` na bufor uniformów zamiast na zmieniony uniform (`_coalesceUniformUploads`), powtórna PEŁNA wysyłka tablicy uniformów (`uniformArray` — three wysyła ją przy każdym rysunku i dispatchu grupy obiektu, np. podkroki tarcz) z tą samą treścią co ostatnio wysłana pominięta (`uploadFullUnlessSame`, kopia porównawcza; bufor uniformów pisze tylko writeBuffer — 2026-10-07), mapa cienia słońca i łapacz pomijane, gdy na warstwach passa nie ma rzucającego w kadrze kamery cienia (`_passSunShadow`, `passShadowScan` — warunek jak `_projectObject`; sam odbiorca cienia — partie wież, trzymacze z `receiveShadow` — dostaje raz PUSTĄ mapę, od 2026-10-17; A/B `Core3D.shadowReceiverSkip = false`), bufor z przeplotem (InterleavedBuffer) wysyłany raz na wersję, nie raz na atrybut (`_dedupeInterleavedUploads`, 2026-10-17 — partia wież: 4 atrybuty = 4 × te same rekordy; A/B `Core3D.interleavedDedupe = false`), znaczniki czasu GPU co `gpuTimerSampleEvery` klatek. Wysyłki kontroluje `scripts/webgpu/sprawdz-wysylki.mjs` (stan GPU = CPU).
- Narzędzia: `scripts/profil-bitwy.mjs` (duża bitwa, A/B z tagiem naprzemiennie), `scripts/profil-bitwy-flot.mjs` (bitwa flot o zadanym składzie na stronę, z supercapitalami: `--sklad f,d,b,s`, profile `--profile t:dł`, `--diag 1` — pary narrowphase, wywołania WebGPU, mapy V8; `--query physHz=60`; wyniki i ranking wąskich gardeł: `docs/AUDYT-wydajnosc-bitwa-2026-10-07.md`), `scripts/webgpu/koszt-klatki.mjs` (`--fazy` µs na rysunek wg materiału, `--spis`, `--zapisy` writeBuffer / writeTexture wg źródła, `--graf`, `--ab`), `scripts/webgpu/profil-analiza.mjs` (drzewo `.cpuprofile` na klatkę), `scripts/webgpu/drzenie-gra.mjs` (drżenie efektów w grze), `scripts/webgpu/pamiec.mjs` (pamięć GPU w cyklach bitwy), `scripts/webgpu/przestoje-gra.mjs` (PRZESTOJE: każda klatka — odstęp rAF, CPU, GPU, fizyka, mostki, wypiek skór, longtask — w scenach finału misji 1, szyi habitatu i bitwy; `--ab <katalog oryginałów>` = A/B wersji kodu w tym samym drzewie przez `HULLFALL_AB_DIR` w `vite.config.js`; `--profil 1` — najdłuższe klatki rozbite na funkcje; wyniki 2026-10-15: `docs/AUDYT-przestoje-2026-10-15.md`). Profil CPU: przerwa w próbkowaniu (np. wywłaszczenie procesu przy obciążonej maszynie) przypisuje cały odstęp funkcji z ostatniej próbki — tak powstało „`Bridge3D.update` 102 ms w jednej klatce”; `przestoje-gra.mjs` wypisuje przerwy > 15 ms osobno.

## Kolejność rysowania

- 3D world pass -> 2D world/HUD.
- Nie przywracaj starych, równoległych ścieżek `drawPlanets3D`/`drawStations3D`/`drawWorld3D` jako osobnych finalnych passów, jeśli render jest już zunifikowany przez `Core3D`.
