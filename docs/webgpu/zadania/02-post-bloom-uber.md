# Zadanie 02 — Postprocessing 1/2: bloom, pełny „uber” (gorące powietrze), MSAA, kalibracja tolerancji
Zależności: 01 | Równolegle z: 06 (inne pliki) | Zalecany effort: max
Zakres: `src/3d/core3d.js` (post: `RenderPipeline`, bloom, uber), `src/3d/bloomConfig.js` (bez zmian wartości),
tuner bloomu (`DevVFX.bloom`, panel Bloom), `docs/webgpu/baseline.json` (tolerancja). GLSL: `UberPostShader` 143 linie.

## Cel
Obraz gry po poście zgadza się z bazą WebGL tam, gdzie nie ma zamienników: bloom z `bloomConfig.js` (siła, promień,
próg, `resolutionScale`, strojenie na żywo z `?dev`), „uber” z gorącym powietrzem (do 24 źródeł, maska dysz z dema
plazmy, dyspersja, clampy), ACES gry i sRGB, przełączniki `perfToggles` (bloom, heatHaze) i `setMsaaEnabled`.
Na końcu **skalibrowana tolerancja portu** w `baseline.json`.

## Przeczytaj najpierw
`agents.md` (Core3D, bloom HDR-first, „UnrealBloomPass przepuszcza CAŁY teksel…”), `docs/webgpu/PLAN.md` §2, §7,
`docs/webgpu/SPIKE.md` (4a, 4b), `docs/webgpu/POSTEP.md`, `src/3d/core3d.js` (`UberPostShader`, `_applyBloomPassConfig`,
`pushHeatHazeWorld`, `_pushHeatHazeForCamera`), `node_modules/three/examples/jsm/tsl/display/BloomNode.js` i
`examples/jsm/postprocessing/UnrealBloomPass.js` (porównaj: te same jądra 6…22, 5 mipów, `bloomFactors`, `smoothWidth`
0,01 — różnice zapisz), `src/3d/bloomConfig.js`.

## Kroki
1. **Bloom:** `bloom(sceneTex, strength, radius, threshold)` z `BloomNode` (węzły `strength/radius/threshold` to
   `uniform` — `_applyBloomPassConfig` ustawia `.value` co klatkę, bez przebudowy). UnrealBloomPass dokładał bloom
   addytywnie do bufora; tu: `scena + bloom` w `outputNode`. `resolutionScale` (dziś 1,0): BloomNode liczy rozmiar z
   bufora rysowania — skala ≠ 1 wymaga własnego `setSize` (zanotuj, jeśli nie robisz). Wyłączenie bloomu
   (`perfToggles.bloom`) = osobny `outputNode` albo mnożnik 0 — bez przebudowy co klatkę.
2. **Uber w TSL:** port 1:1 `UberPostShader` bez fal warpa: szum `hash12`/`noise` jako `Fn` z layoutem, pętla po
   źródłach `Loop(uSourceCount)` z `uniformArray` (`uHeatSources` vec4, `uHeatDirs` vec2 — adapter `node.array`), gałąź
   dysza vs izotropowe, clampy `±0,022` / `±0,012`, trzy odczyty dyspersji tylko przy `nozzleHaze ≠ 0`, `uTime`
   zawinięty `% 600`. `defines.HEAT_HAZE` → uniform `uHeatOn` (bez przebudowy przy przełączeniu).
3. **Kolejność jak dziś:** `_postPasses = [resolve, bloom, uber]` — bloom dokłada się do bufora, a uber próbkuje
   (z przesunięciem gorącego powietrza) **scenę razem z bloomem**, potem ACES i sRGB. W TSL: próbkuj teksturę sceny i
   teksturę bloomu (`bloomNode.getTextureNode()`) tym samym przesuniętym UV i sumuj, albo złóż scenę + bloom do celu
   (`rtt`/`convertToTexture`) i próbkuj go raz — wybierz tańsze, wynik ma być ten sam.
4. **MSAA:** `setMsaaEnabled(false/true)` na `composerTarget` i `planetHaloTarget` (SPIKE 17).
5. **Kalibracja tolerancji:** harness, porównanie `kalibracja__ortho` i `slonce` (+ inne warianty bez zamienników wg
   `spis`) z bazą; policz `roznePct8` i `srednia`; ustaw `tolerancjaPortu` w `docs/webgpu/baseline.json` jako
   ~1,5× zmierzonej różnicy renderer↔renderer (nie mniej niż szum), z polem `stan` i uzasadnieniem (skąd różnice:
   resolve MSAA, bloom, precyzja). Jeśli różnica bloomu jest duża i widoczna — najpierw ją usuń (np. parametry
   `BloomNode` vs `UnrealBloomPass`), dopiero potem kalibruj. Pole edytuj w pliku — `scripts/webgpu/baza.mjs` zachowuje
   skalibrowaną tolerancję przy przebudowie bazy (`--nowa-tolerancja` wraca do wstępnej).
6. **Testy:** `renderBugfixGuards` (model jasności dysz względem progu bloomu — przelicz pod `BloomNode`, jeśli
   algorytm progu jest ten sam, test zostaje), testy PerfHUD/`perfInstrumentation` dla kubełka `bloom`/`post`.

## Pułapki
- Próg `BloomNode` = `smoothstep(threshold, threshold + smoothWidth, luminance)` — jak w UnrealBloomPass (bramkuje,
  nie odejmuje kolana; `agents.md`: ~9 × strength energii). Nie zmieniaj wartości w `bloomConfig.js`.
- `outputColorTransform = false` — ACES gry to inna krzywa niż `acesFilmicToneMapping` three.
- Gorące powietrze: źródła w UV osi v z korektą aspektu — skopiuj wzory z `_pushHeatHazeForCamera` bez zmian.
- `uniformArray` przepisuje całą tablicę co render — `uSourceCount` ogranicza pętlę, nie rozmiar bufora.
- Bez `pow()` z ujemną podstawą; `LinearTosRGB` z `max(c, 0)` przed potęgą, jeśli wejście może być ujemne.
- Pomiary wydajności harnessu orientacyjne (inne sesje na GPU) — porównuj `gpuMs` z poprzednim przebiegiem.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek względem `POSTEP.md`.
- Harness `node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/zadania/02 --baza .tmp/webgpu/baseline/webgl/p1`:
  zero błędów walidacji WebGPU / WGSL i ostrzeżeń three; `kalibracja__ortho` i `slonce` w (nowej) tolerancji;
  HDR (`hdr.max`, `overFraction`) bufora sceny jak w bazie tam, gdzie nie ma zamienników; bez regresji względem
  `.tmp/webgpu/zadania/01/webgpu` poza zmianami postu.
- Gorące powietrze widoczne za dyszami w `bitwa-blisko` (A/B z `perfToggles.heatHaze`), bloom reaguje na tuner `?dev`.
- `tolerancjaPortu` w `baseline.json` skalibrowana i uzasadniona; `POSTEP.md`, `INWENTARZ.md`; commit na `main`.

## Czego NIE robić
- Nie przenoś maski słońca, SDF, refrakcji, fali uderzeniowej (03); nie wracaj do `EffectComposer`.
- Nie „poprawiaj” wyglądu bloomu względem WebGL — cel to zgodność 1:1.

## Raport na koniec
Co zrobione; różnice BloomNode vs UnrealBloomPass (jeśli są) i ich wpływ; tolerancja z uzasadnieniem; zrzuty
`.tmp/webgpu/zadania/02/webgpu/{kalibracja__ortho,slonce,bitwa-blisko}.png` vs baza (`porownanie-z-baza/*-obok.png`);
co zostało; pytania.
