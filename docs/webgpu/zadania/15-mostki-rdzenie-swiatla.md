# Zadanie 15 — Mostki, rdzenie, reaktory, światła pozycyjne (+ warsztaty mostki-demo i rdzen-demo)
Zależności: 04 | Równolegle z: 05–14, 16–20 | Zalecany effort: xhigh
Zakres: `src/3d/shipLights3D.js` (1 materiał / 43 linie: światła pozycyjne, billboardy FG, `NAV_LIGHT_CHASE`),
`src/3d/bridge3D.js` (3 / 420: `MODEL_FRAG` 148, `B3_FUNC_GLSL` 102, cień pod kadłubem `depthFunc GREATER`, tekstura
obrażeń 768 × 512 RGBA8 z uploadem wierszami), `src/3d/bridgeFx3D.js` (1 / 33: szczeliny okien, wyrzut atmosfery, FG),
`src/3d/reactor3D.js` (2 / 222) i `src/3d/coreFx3D.js` (3 / 280) — gra ich jeszcze nie ładuje (warsztat
`rdzen-demo`); warsztaty `dema/mostki-demo.html` i `dema/rdzen-demo.html` z narzędziami zrzutów. 9 materiałów / ~1000 linii.

## Cel
Światła pozycyjne w grze jak w bazie. Mostki (model 3D, cień, okna, wyrwy) i rdzenie/reaktory są w grze nieaktywne na
kadłubach belkowych (agents.md § Mostki — wymagają `hexGrid`), więc sprawdza się je w warsztatach: `mostki-demo` i
`rdzen-demo` działają na WebGPU bez zamienników w modułach tego zadania.

## Przeczytaj najpierw
`agents.md` (Mostki — cały akapit, w tym cień `depthFunc GREATER` i renderOrder kadłubów; Nośnik; precyzja
`Bridge3D._setOrigin`), `docs/PORT-mostki.md` (§8, §8.12), `docs/webgpu/PLAN.md` §3, §4, §10 p. 4, `docs/webgpu/SPIKE.md`
(16 — `GreaterDepth`), `docs/webgpu/POSTEP.md` (wynik 04: głębia kadłubów), pliki zakresu, testy: `bridge3D`,
`reactor3D`, `shipLights3D`, `shipLightRuntime`, `shadowShaftsQuality`.

## Kroki
1. **`shipLights3D`** → TSL: FG (warstwa 2), addytywne HDR, maski słońca nie czyta (test), zakresy uploadu atrybutów
   (`addUpdateRange` — backend WebGPU je respektuje: `WebGPUAttributeUtils.updateAttribute`).
2. **`bridge3D`:** `MODEL_FRAG` + `B3_FUNC_GLSL` → TSL; cień pod kadłubem przez `depthFunc = GreaterDepth` (działa w
   WebGPU — SPIKE 16) — zależy od głębi kadłubów z 04 (renderOrder 10, z ≈ 0): sprawdź na zrzucie; okna
   (`bridgeState.model3D`), paleta, precyzja `_setOrigin`.
3. **Tekstura obrażeń:** dziś upload wierszami przez `Texture.updateRanges` (`bridge3D.js:1331-1348`); backend WebGPU
   zakresy tekstur IGNORUJE — każda zmiana = pełny upload 1,5 MB. Zmierz w `mostki-demo` (ostrzał mostka). Jeśli koszt
   jest realny: dane obrażeń w buforze (`StorageBufferAttribute` / `instancedArray` — zakresy atrybutów działają)
   albo mniejsze tekstury per blok. Test `bridge3D` („uploads split per row, rows are reused”) przepisz na nowy
   mechanizm z zachowaniem sensu (upload tylko zmienionych wierszy).
4. **`bridgeFx3D`** → TSL (instancje, FG, wyrzut atmosfery zostaje także przy modelu 3D).
5. **`reactor3D`, `coreFx3D`** → TSL: warstwa 7 zgłaszana, instancje względem początku przy kamerze (test „precyzja: przy
   8 mln j.”), pasma HDR jak żar; grafy budowane raz na rodzaj (2 meshe na rodzaj — test).
6. **Warsztaty:** `mostki-demo` (+ `mostki-shots.js`, `mostki3d-shots.js`) i `rdzen-demo` (+ `rdzen-shots.js`,
   `rdzen-gpu-check.js`) startują na WebGPU. `rdzen-demo` ma własny overlay (iskry, wybuch reaktora) — do zadania 20
   działa na WebGL obok, sprawdź, że nie przeszkadza. `coreFx3D` woła `RailgunFX3D.impact` / `kerf` i `MuzzleFX3D` —
   zostaw; zadanie 17 przepina je na receptury broni. Zrzuty narzędziami dem na `main` i na tagu (worktree,
   `README.md`) — obok siebie w raporcie. `mostki3d-drzenie.js` / `precyzja-drzenie.js` mają ruszać (pełny pomiar
   drżenia — 23).

## Pułapki
- Cień mostka czyta głębię kadłubów — jeśli 04 zmieniło głębię/z kadłubów, cień zniknie lub zaleje kadłub.
- Mostki są w grze nieaktywne do portu mostków na belki (etapy 4–5 `PORT-silnik-belek.md`) — nie włączaj ich.
- Tekstura `RedFormat` + `UnsignedByteType` (`bridge3D.js:1053`) → `r8unorm` — filtrowanie i próbkowanie sprawdź.
- Nowy kadłub = mostek (checklista `BRIEF-mostek-nowego-kadluba.md`) — to zadanie nie dodaje kadłubów.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (`bridge3D`, `reactor3D`, `shipLights3D` przepisane
  tam, gdzie czytały GLSL / zakresy tekstur).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/15 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  warianty `__fg` scen z okrętami bez zamienników świateł; bez regresji względem poprzedniego przebiegu.
- `mostki-demo` i `rdzen-demo`: zrzuty narzędzi dem bez zamienników w modułach zadania, zgodne z tagiem (opis różnic);
  koszt uploadu obrażeń mostka zmierzony (liczby w `POSTEP.md`).
- `INWENTARZ.md`: pliki zadania bez GLSL; `POSTEP.md`; `docs/PORT-mostki.md` (jeśli mechanizm tekstury obrażeń się
  zmienił); commit na `main`.

## Czego NIE robić
- Nie zmieniaj logiki mostków, rdzeni, osi czasu kill ani AI; nie wpinaj reaktorów do gry.

## Raport na koniec
Co zrobione; zrzuty warsztatów (main vs tag) i `__fg` scen; koszt uploadu obrażeń; co zostało; pytania.
