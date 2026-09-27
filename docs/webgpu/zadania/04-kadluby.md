# Zadanie 04 — Kadłuby: hexShips3D (belki i heksy), lakier, światła, impostory wraków, szczątki
Zależności: 03 | Równolegle z: 05, 06–10, 12, 13, 14, 16, 17 | Zalecany effort: max
Zakres: `src/3d/hexShips3D.js` (445 linii GLSL, 4 materiały: `HEX_FRAGMENT_SHADER` 268 — wspólny, `BEAM_SKIN_VERTEX`,
`HEX_VERTEX`, `ARMOR_VERTEX`, pula szczątków GPU `DEBRIS_*`), `src/3d/hullLacquer.js`, `src/3d/beamHullSkin.js`,
`src/3d/hexBodyImpostorBatch.js` (37), `src/3d/hullDebris3D.js` (61), `src/3d/beamDebris3D.js` (64, jeśli jego materiał
rysuje się w grze), `src/3d/coldWreckImpostors.js` (uśpione). ~610 linii GLSL, 7 materiałów.

## Cel
Kadłuby graczy, NPC i wraków (silnik belek) wyglądają jak w bazie: tekstura sprite'a, lakier, światła statku (payload),
maska słońca, żar ran, cienie SDF (zgłaszanie okluderów), odblask; impostory dalekich wraków i szczątki kadłubów.
**Gałąź heksów** (HEX/ARMOR/DEBRIS) też przechodzi na TSL: w grze rysuje tylko wyłączone asteroidy, ale stoją na niej
`dema/mostki-demo.html`, `dema/rdzen-demo.html` i pomiar drżenia (zadanie 15).

## Przeczytaj najpierw
`agents.md` (Kadłuby na belkach, Moduły 3D — precyzja, Wydajność: „pętle każdy kadłub × każde światło”),
`docs/webgpu/PLAN.md` §3, §4, `docs/webgpu/SPIKE.md` (3, 11, 16), `docs/webgpu/POSTEP.md`, `docs/PORT-silnik-belek.md`,
`src/3d/hexShips3D.js` (grepem: `HEX_FRAGMENT_SHADER`, `BEAM_SKIN_VERTEX`, `createHullUniforms`, `updateEntityMesh`,
`buildCombinedShipLightShaderPayload`, `drawHexShips3D`), `src/3d/hullLacquer.js`, `docs/webgpu/INWENTARZ.md`
(wiersze plików zadania), testy: `hexShips3DShader`, `hexDebrisPool`, `renderBugfixGuards`, `hullLacquer`, `shipProxyBatch3D`.

## Kroki
1. Zinwentaryzuj uniformy i atrybuty obu gałęzi (belki: `BEAM_SKIN_VERTEX` + wariant `HEX_FRAGMENT`; heksy:
   `HEX_VERTEX`, `ARMOR_VERTEX`, `DEBRIS_*`) i miejsca, gdzie JS je aktualizuje — adapter `uniformsAdapter` utrzymuje
   `material.uniforms.X.value`.
2. `HEX_FRAGMENT_SHADER` → TSL (`hexShips3D.tsl.js` obok modułu, jeśli ciało jest duże): oświetlenie (payload świateł
   z `uniformArray`, własne lampy z cache per encja — tylko odczyt), lakier (`HullLacquer` — mapa kształtu), maska
   słońca (biblioteka z 03: `sunVisibility`/`sunFill`), `uBillboardLighting` (asteroidy/impostory wychodzą wcześnie),
   żar ran (HDR 8–12). Wariant belkowy vs heksowy: gałąź przy budowie węzłów (dwa materiały), nie `defines` w biegu.
3. Wierzchołki: `BEAM_SKIN_VERTEX` (kadłub na belkach — deformacja skóry), `HEX_VERTEX`, `ARMOR_VERTEX`, szczątki
   GPU (`DEBRIS_*`, `window.spawnGpuDebris`) — `positionNode` z `varyingProperty` dla danych instancji. Pozycje świata
   względem `mesh.position` (reguła precyzji, `sceneOrigin.js`); `modelViewMatrix` z kontekstu (nie składaj ręcznie).
4. Impostory (`hexBodyImpostorBatch.js`), szczątki (`hullDebris3D.js`, geometria `beamDebris3D`), uśpione
   `coldWreckImpostors.js` — materiały w TSL. Sprawdź, czy materiał `beamDebris3D.js` rysuje się w grze (graf importów:
   `hullDebris3D` bierze z niego geometrię); jeśli tylko w destruktorach — zostaw (poza portem, PLAN §1.5).
5. `renderer.compile` → `compileAsync` (zrobione w 01) — sprawdź rozgrzewkę kadłubów NPC (`prewarmHexShipVisual`).
6. `Texture.updateRanges` backend WebGPU ignoruje — jeśli tekstury pancerza/obrażeń aktualizują się częściowo, zmierz
   koszt pełnego uploadu na trafienie (bitwa) i zapisz (ew. osobna tekstura danych / storage buffer — tylko jeśli
   koszt jest realny).
7. Testy: `hexShips3DShader` (regexy GLSL → odpowiedniki: struktura węzłów / uniformy / zachowanie), `hexDebrisPool`
   (wycinek źródła `hexShips3D` w `vm` z atrapami `ShaderMaterial` → nowy kontekst z materiałem węzłowym),
   `renderBugfixGuards` (wycinki `updateEntityMesh`), `hullLacquer`; `shipProxyBatch3D` porównuje 9 linii shadera proxy
   (Z4, poza portem) z shaderem kadłuba — parzystość przestaje mieć sens: oznacz test `todo` z opisem „Z4 przejdzie na
   TSL przy integracji (PLAN §1.5)”, nie usuwaj.

## Pułapki
- Własne lampy kadłuba są w cache per encja — obiekty lamp z payloadu tylko do odczytu (agents.md).
- `forceSinglePass: true` dla przezroczystych `DoubleSide` (dotyczy też WebGPU).
- Cień mostka (`depthFunc GREATER`, zadanie 15) zakłada, że kadłuby (renderOrder 10) piszą głębię w passie ortho przy
  z ≈ 0 — nie zmieniaj głębi/z kadłubów.
- Nie zmieniaj `Math.random` w JS modułów (determinizm scen bitwy).
- **Materiał na encję = budowa węzłów na encję.** Dziś każdy kadłub ma własny `ShaderMaterial` (`createHullUniforms`,
  `hexShips3D.js:1437`, `:2006`) — WebGL brał program z cache po źródle. W WebGPU nowy graf węzłów na encję to pełny
  NodeBuilder na CPU przy każdym spawnie (PLAN §3; bitwy mają 125–174 okręty). Graf budowany raz na wariant (belki /
  heksy / pancerz), encje dostają wartości przez `uniform(...).onObjectUpdate(({ object }) => …)`; tekstury per kadłub
  (sprite wspólny dla typu przez `acquireSharedVisualTexture`, osobny dla wraków z `createManagedTexture`) — sprawdź w
  źródle three / małym teście, czy `TextureNode` z `onObjectUpdate` daje osobne wiązania na obiekt; jeśli nie — graf na
  teksturę (sprite typu), wraki osobno. Zmierz: czas spawnu 30 NPC (`?dev`) i `coreRenderMs` pierwszej klatki po nim.
- Liczba draw calli warstwy ortho ma zostać ~jak w bazie (mesh na encję zostaje — zmienia się tylko współdzielenie grafu).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (testy z kroku 7 przepisane, `shipProxyBatch3D`
  z opisanym `todo`).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/04 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `bitwa__ortho`, `bitwa-blisko`, `wraki__ortho`, `k7-hala__ortho`, `hud`, `split` — kadłuby w tolerancji (gdzie
  warstwa bez zamienników), draw calle warstwy ortho ~jak w bazie; bez regresji względem 03.
- Gałąź heksów sprawdzona: `dema/mostki-demo.html` rysuje kadłuby bez zamienników (mostki mogą jeszcze być magentą —
  zadanie 15) — zrzut w raporcie.
- `coreRenderMs` scen bitwy nie gorszy niż w 03 (± szum); brak alokacji per klatka.
- `INWENTARZ.md`: pliki zadania bez GLSL; `POSTEP.md`; `agents.md` (jeśli reguły kadłubów się zmieniły); commit na `main`.

## Czego NIE robić
- Nie usuwaj gałęzi heksów (mostki-demo, rdzen-demo, pomiar drżenia) ani ścieżki heksów w `destructor.js`.
- Nie przenoś mostków, rdzeni, świateł pozycyjnych (15), silników (13), tarcz (14).

## Raport na koniec
Co zrobione; zrzuty `bitwa-blisko`, `wraki`, `hud` (obok siebie z bazą) i mostki-demo; koszt uploadu tekstur przy
trafieniach; co zostało; pytania.
