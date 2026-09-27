# Zadanie 13 — Silniki: MAIN (struga), WARP (plazma z dysz MAIN), SIDE (manewrowe)
Zależności: 03 | Równolegle z: 04–10, 12, 14, 16, 17 | Zalecany effort: xhigh
Zakres: `src/3d/mainExhaust3D.js` (1 materiał / 48 linii GLSL), `src/3d/warpPlume3D.js` (3 / 330: plazma — marsz
promienia w proxy z `defines: { PE_STEPS, PE_OCT }` z jakości, materiał na instancję puli ≤ `WARP_PLUME_CAP` = 16,
cząstki), `src/3d/engineExhaustBatch.js` (2 / 139: płomień i warstwy glow/ring/flare na instancjach, `ENGINE_HDR`),
`src/3d/engineVfxSystem.js` (rozdział dysz, źródła gorącego powietrza — bez shaderów), martwa część `Engineeffects.js`
(`getEngineVFX` z własnym `WebGLRenderer` i shaderem, 90 linii; gra bierze z pliku tylko tekstury `make*Texture`).
6 materiałów / 517 linii (+90 martwych).

## Cel
Dysze MAIN (struga, iskry z Fx3D), WARP (plazma z dysz MAIN podczas ładowania i skoku) i SIDE wyglądają jak w bazie;
w bloomie świeci tylko dysza, która odpala (`ENGINE_HDR` 0,6, mnożnik 1 + 1,5 · ciąg). Rozmiar i palety per statek z
`engineFx` bez zmian. Plazma WARP należy do silników i zostaje w porcie (soczewka i reszta warpa — poza portem).

## Przeczytaj najpierw
`agents.md` (Silniki: MAIN, WARP, SIDE — cały akapit; „Shadery efektów w passie ortho”), `docs/webgpu/PLAN.md` §3, §6,
`docs/webgpu/POSTEP.md`, `docs/AUDYT-bloom-kolizje-2026-09-26.md` (dysze SIDE), pliki zakresu, `src/data/engineFx.js`,
`dema/silniki/` (źródło plazmy — tylko do wglądu), testy: `warpPlume3D`, `renderBugfixGuards` (dysza SIDE),
`engineFx`, `engineVfxScale`, `engineSlotInputHash`, `shadowShaftsQuality`.

## Kroki
1. **`mainExhaust3D`:** struga w TSL (instancje dysz, `MAIN_EXHAUST_Z`), bez nośnika (smuga ma zostawać za statkiem —
   agents.md). Iskry dysz idą przez Fx3D (zadanie 12; do tego czasu zamienniki Fx3D).
2. **`warpPlume3D`:** marsz promienia → TSL z `Loop` (`PE_STEPS`) i oktawami szumu (`PE_OCT`) jako stałymi przy budowie;
   jakość = osobny graf budowany raz. Materiał na instancję puli (dziś `new ShaderMaterial` w konstruktorze
   `WarpPlumeFX`) → jeden graf + wartości per obiekt (`onObjectUpdate`, PLAN §3) — inaczej pierwsze 16 skoków buduje
   16 razy ciężki shader (przestój przy skoku). Faza strumienia całkowana na CPU (uniform) — test `warpPlume3D`.
3. **`engineExhaustBatch`:** płomień i warstwy na instancjach → TSL; `ENGINE_HDR` i próg bloomu pilnuje
   `renderBugfixGuards` — liczby bez zmian. Światła silników zostają wyłączone (`perfToggles.enginePointLights: false`,
   PLAN §3 — światła).
4. **`Engineeffects.js`:** usuń martwe `getEngineVFX` (renderer + shader), zostaw tekstury `make*Texture`. Najpierw grep
   w `index.html`, `src/`, `dema/`, `scripts/` (dema spoza portu działają z tagu — nie blokują usunięcia).
5. **Gorące powietrze dysz** (`pushHeatHazeWorld` z kierunkiem, zadanie 02) — sprawdź obraz na `warp` i `bitwa-blisko`.
6. **Testy:** asercje czytające GLSL → odpowiedniki; testy zachowania bez zmian.

## Pułapki
- NaN w HalfFloat + MSAA (agents.md; memory: plazma MAIN/WARP): bez `pow` z ujemną podstawą, clamp varyingów przed
  użyciem. TSL ma też interpolację `centroid` (`VaryingNode.setInterpolation(…, 'centroid')`) — nie zmieniaj metody
  bez pomiaru, przenieś to, co działa dziś.
- Przezroczyste `DoubleSide` → `forceSinglePass: true`.
- Kolejność rysowania (`renderOrder` plazmy 1, cząstek 4, strugi 0) — bez zmian.
- Nie zmieniaj jasności ani kształtu (`PLUME`) — tylko port.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/13 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `warp` (plazma WARP przy ładowaniu), `bitwa`, `bitwa-blisko`, `hud` — dysze bez zamienników, w tolerancji tam, gdzie
  warstwa jest czysta; `hdr` scen (piksele ponad progiem) ~ baza.
- Pierwszy skok bez przestoju kompilacji (czas klatki w `warp` / PerfHUD).
- `INWENTARZ.md`: pliki zadania bez GLSL, `Engineeffects.js` bez renderera; `POSTEP.md`; commit na `main`.

## Czego NIE robić
- Nie ruszaj soczewki, fal ani logiki warpa (poza portem); nie wprowadzaj efektów z `dema/warp-webgpu`.
- Nie dokładaj nośnika do MAIN; nie włączaj świateł silników.

## Raport na koniec
Co zrobione; zrzuty `warp` i `bitwa-blisko` obok bazy; czas pierwszego skoku; co zostało; pytania.
