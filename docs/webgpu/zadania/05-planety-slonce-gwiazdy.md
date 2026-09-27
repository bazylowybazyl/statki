# Zadanie 05 — Planety, słońce, mgławica, gwiazdy, stacje
Zależności: 03 | Równolegle z: 04, 06–10, 12–20 | Zalecany effort: xhigh
Zakres: `src/3d/planet3d.assets.js` (191 linii GLSL, 7 materiałów: powierzchnia planety dzień/noc + `uRingShadow*`,
chmury, halo planety, halo limbu Ziemi/Marsa `createRingAtmosphere`, słońce, mgławica `NebulaSystem`, gwiazdy
`StarSystem`), `src/3d/starParallax.js`, `src/3d/stations3D.js`, `src/3d/world3d.js`,
`src/space/pirateStation/pirateStationFactory.js` (materiały wbudowane).

## Cel
Tło i ciała niebieskie jak w bazie: planety (dzień/noc, chmury, pas cienia ringu, `uPlanetBloom`), słońce z koroną,
halo limbu (model atmosfery z menu), mgławica ze smugą cienia (maska z 03), gwiazdy z paralaksą; stacje i stacja
piracka (materiały wbudowane, cienie). Warstwy 1 / 3 / 5 / 6 zgłaszają aktywność jak dziś.

## Przeczytaj najpierw
`agents.md` (Planety i słońce; Halo limbu: `createRingAtmosphere` — NIE wracaj do powłoki-kuli z maską Fresnela;
kontrakt warstw 3/5/6/7), `docs/webgpu/PLAN.md` §3, §5, `docs/webgpu/POSTEP.md`, `src/3d/planet3d.assets.js`
(grepem: `NebulaSystem`, `StarSystem`, `createRingAtmosphere`, `uRingShadow`, `markPlanetLayersActive`,
`applySunShadowToBuiltinMaterial`, `sunLight`), `docs/BRIEF-warp.md` §1 (rozciąganie gwiazd — do wymiany), testy
`starParallax`, `ringPlanetAnchoring`, `shadowShaftsQuality` (linie maski w shaderach planet).

## Kroki
1. Planety: powierzchnia (tekstury dzień/noc 8K — limity z 01), chmury, halo (`coef/power/glowColor`), analityczny pas
   cienia ringu (`uRingShadow*`), `uPlanetBloom` (`bloomConfig.planetBloomMultiplier`) — materiały węzłowe; model
   ringowych planet (ortho, warstwa 6) i zwykłych (persp, warstwa 3) bez zmian.
2. Halo limbu Ziemi i Marsa (`createRingAtmosphere`): płaski dysk w passie ortho, cięciwa przez powłokę R + H, gęstość
   e^(−h/Hs), gaśnie do zera na brzegu — port 1:1.
3. Słońce (kula + korona, `uIsOcclusion`) i sprite blasku (wbudowany — sprawdź).
4. `NebulaSystem` (warstwa 1): tekstura mgławicy + `sunShaftBackdrop` (biblioteka z 03) + `warpFactor` (zostaje jako
   uniform; soczewka warpa poza portem). `StarSystem`: punkty z atrybutami (rozmiar, jasność, kolor, paralaksa warstw);
   **rozciąganie w skoku** — przenieś tylko, jeśli wychodzi 1:1 przy okazji, inaczej pomiń i zapisz w `POSTEP.md`
   (BRIEF-warp §1 przeznacza je do wymiany). `Core3D.setWarpStarsObject` zostaje no-opem.
5. Stacje (`stations3D.js` — GLB `MeshStandardMaterial`), stacja piracka (`pirateStationFactory.js`, `world3d.js`) —
   materiały wbudowane konwertują się same: sprawdź wygląd, cienie (`castShadow`, `ShadowMaterial` łapaczy w Core3D),
   `.capabilities` (anizotropia — odpowiednik w WebGPU sprawdź w źródle three).
6. `applySunShadowToBuiltinMaterial` na materiałach planet (tryb z 03).
7. Testy: `starParallax` (regexy shadera gwiazd → odpowiedniki TSL / zachowanie), `ringPlanetAnchoring` (tekst shadera
   atmosfery, `halo.material.uniforms.sunPosition` — adapter), `shadowShaftsQuality` (linie maski w planetach).

## Pułapki
- Warstwy 3/5/6 pomijane bez zgłoszenia aktywności (`Core3D.markPlanetLayersActive`) — obiekt zniknie.
- Planety tła leżą daleko (z = −50 000) — sprawdź precyzję i `logarithmicDepthBuffer: false` (bez zmian).
- Tekstury 8K: `maxTextureDimension2D` z limitów adaptera (01); upload w wolnej chwili (`queueTextureUpload` → `initTexture`).
- HDR: słońce i miasta nocne > 1, próg bloomu 0,9 — nie zmieniaj jasności.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/05 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `slonce`, `planeta-cien` (+ `__planety`, `__tlo`) w tolerancji; tło (`__tlo`) wszystkich scen bez zamienników
  mgławicy i gwiazd; bez regresji względem 03.
- `INWENTARZ.md`: `planet3d.assets.js` bez GLSL; `POSTEP.md` (w tym decyzja o rozciąganiu gwiazd); commit na `main`.

## Czego NIE robić
- Nie przenoś ringu (06–10) ani tła menu (11) — Ziemia menu pożycza tekstury z planety gry, ale jej shader jest w 11.
- Nie zmieniaj legacy `planet3d.proc.js` (decyzja o nim w zadaniu 22).

## Raport na koniec
Co zrobione; zrzuty `slonce`, `planeta-cien`, `hud` (obok siebie); stan rozciągania gwiazd; co zostało; pytania.
