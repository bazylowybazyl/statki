# Zadanie 20 — Koniec overlaya: wybuch reaktora w Core3D, usunięcie drugiego renderera
Zależności: 17, 18, 19 | Równolegle z: 13–16 | Zalecany effort: xhigh
Zakres: `src/effects3d/reactorblow.js` (2 materiały / 226 linii GLSL — śmierć okrętu, pule 100 000 / 15 000),
`src/effects3d/particlePool.js`, `src/effects3d/reactorProfiles/`, `src/effects3d/overlay.js` (DRUGI `WebGLRenderer`,
`EffectComposer`, bloom overlaya, `RestoreAlphaShader`, warstwa raw, `prewarm`, jakość adaptacyjna — do usunięcia),
`index.html` (`startOverlay3D`, `overlay3D.tick`, `rocketOverlay3D`, `resizeOverlay3D`, `DevFlags.splitOverlayContexts`,
`triggerReactorBlow3D`, `Destruction3D.init({ reactorFactory })`), parametry `overlay*` w `src/3d/bloomConfig.js` i
tunerze (panel Bloom), PerfHUD („Overlay FX 3D”).

## Cel
Po zadaniach 17–19 w overlayu zostaje tylko wybuch reaktora (śmierć okrętu, też przy rozpadzie stacji). Przenosimy go
do sceny Core3D w TSL i usuwamy overlay: w grze zostaje JEDEN renderer, jedna kanwa 3D, jeden bloom. Wygląd wybuchu jak
w bazie (scena `wybuch`), mimo innego bloomu.

## Przeczytaj najpierw
`agents.md` (Core3D: bloom ~9 × strength, overlay3D 1,6 przy progu 0,15 → ~14× prawie wszystkiego; HDR-first),
`docs/webgpu/PLAN.md` §3, §6, `docs/webgpu/POSTEP.md` (wyniki 17–19), `src/effects3d/overlay.js` w całości,
`src/effects3d/reactorblow.js`, w `index.html` grep jak w zakresie, testy: `overlayContextMerge`, `shaderPrewarm`,
`renderBugfixGuards` („bloom overlaya: efekty tylko przez modyfikatory”, „haze reaktora … w osi sceny”),
`renderPerfGates`.

## Kroki
1. **Wybuch reaktora w TSL** w passie ortho Core3D (warstwa 0): pule cząstek z materiałem raz na pulę (fabryka), ruch
   analityczny w wierzchołkach, zakresy uploadu jak dziś; światło błysku → siatka świateł (12); gorące powietrze
   (`pushHeatHazeWorld(expX, -expZ, -4, …)`) → API zniekształceń (12). Profile (`reactorProfiles`) i czasy bez zmian.
2. **Dopasowanie wyglądu:** w overlayu wybuch przechodził przez bloom 1,6 / próg 0,15, ACES overlaya (× 1,2) i składanie
   `screen`; w Core3D bloom 0,85 / próg 0,9 i ACES gry. Dobierz mnożniki HDR wybuchu tak, żeby `wybuch` był w tolerancji
   bazy (harness, `porownaj.mjs`); jeśli się nie da bez zmiany charakteru — zrzuty obok siebie i pytanie do użytkownika.
3. **Modyfikatory bloomu z efektów** (dziś overlay: Supernowa podbija, Yamato przygasza) — po 17–19 sprawdź, czy ktoś
   jeszcze ich używa; jeśli tak — odpowiednik w Core3D, jeśli nie — usuń z testem.
4. **Usunięcie overlaya:** `overlay.js`, wpięcie w `index.html` (start, tick, resize, `rocketOverlay3D`,
   `splitOverlayContexts`), `rdzen-demo` (własny `initOverlay` — przepnij na Core3D), parametry `overlay*` w
   `bloomConfig.js` i tunerze (usuń albo oznacz jako martwe — opisz), kubełek PerfHUD.
5. **Testy:** `overlayContextMerge` → strażnik „w grze brak drugiego renderera” (`new WebGLRenderer` / `WebGPURenderer`
   tylko w `core3d.js`; wyjątek do decyzji: `modelBaker.js`), `shaderPrewarm` (overlay) → rozgrzewka wybuchu w Core3D,
   `renderBugfixGuards`.

## Pułapki
- Pule 100 000 / 15 000 instancji — koszt wierzchołków, gdy siatka widoczna; chowaj puste pule (jak `flushParticlePools`).
- Wybuch przy rozpadzie stacji (`Destruction3D`, scena `stacja-rozpad` z 16) — sprawdź oba wejścia.
- Kanwa `overlay3d` znika z DOM — sprawdź CSS i kod, który jej szuka (`#game-root`, `.overlay3d`).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (strażnik jednego renderera zielony).
- `grep` w `index.html` i `src/`: jedyny renderer w `core3d.js` (poza decyzją o `modelBaker.js`).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/20 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `wybuch` w tolerancji albo zatwierdzony przez użytkownika; bez regresji w pozostałych scenach.
- `INWENTARZ.md` (`src/effects3d/` bez GLSL i bez renderera), `POSTEP.md`, `agents.md` (zasada żelazna bez wyjątku
  overlaya, bloom tylko Core3D); commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki śmierci okrętu (wraki, detonacja reaktora, obrażenia obszarowe) ani profili wybuchu.

## Raport na koniec
Co zrobione; `wybuch` obok bazy (liczby porównania); co usunięto; decyzja o parametrach `overlay*`; pytania.
