# Zadanie 20 — Sprzątanie i domknięcie portu
Zależności: 19 | Równolegle z: nie | Zalecany effort: xhigh
Zakres: resztki GLSL i API WebGL w plikach gry, strażnicy testowi, moduły poza grą (wg decyzji użytkownika z PLAN §12),
dokumentacja (`agents.md`, `docs/PORT-*.md`, `docs/webgpu/*`), końcowy przebieg harnessu.

## Cel
Port zamknięty: gra bez GLSL i bez API WebGL, strażnik testowy tego pilnuje, dokumentacja opisuje stan WebGPU + TSL,
końcowe zestawienie z bazą w `POSTEP.md`.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/PLAN.md` (§1, §11, §12 — decyzje użytkownika zapisane w `POSTEP.md`), `docs/webgpu/POSTEP.md`,
`docs/webgpu/WYDAJNOSC.md`, `docs/webgpu/INWENTARZ.md` (świeży: `node scripts/webgpu/inwentarz.mjs`),
`tests/glslReservedWords.test.mjs`.

## Kroki
1. **Inwentarz:** grupa „port” = 0 linii GLSL, 0 `ShaderMaterial` / `RawShaderMaterial` / `onBeforeCompile`, 0
   `WebGLRenderTarget` / `WebGLRenderer` / `EffectComposer` — resztki usuń.
2. **Strażnik:** `glslReservedWords` → test „brak GLSL i API WebGL w plikach ładowanych przez grę” (graf importów jak w
   `inwentarz.mjs`, bez listy ręcznej), z allowlistą modułów poza portem zgodną z decyzją użytkownika (PLAN §12 p. 1).
3. **Moduły poza grą** — wyłącznie wg decyzji użytkownika (PLAN §12 p. 1, 3): nieużywane i legacy (`planet3d.proc.js`,
   `voxelShips3D.js`, `stationDestructionEffects.js`, resztki `Engineeffects.js`) usuń; `modelBaker.js` przenieś na
   renderer Core3D albo usuń; rozwijane (warp, nowe asteroidy, Z4 / Z5 / Z7, `beamShips3D` dla destruktorów) zostaw
   z `// AGENT:` o przejściu na TSL przy integracji. Bez decyzji — nic nie usuwaj, zapytaj.
4. **Zamiennik** (`src/3d/tsl/zamiennik.js`): zostaw jako bezpiecznik (błąd w konsoli + magenta dla przyszłego GLSL)
   albo usuń, jeśli strażnik wystarcza — opisz decyzję.
5. **`agents.md`:** przepisz Core3D i Moduły 3D na stan WebGPU (bez `UnrealBloomPass` / `EffectComposer` /
   `WebGLRenderer` / `ShaderMaterial` → odpowiedniki; zostają reguły precyzji, HDR, maski słońca, warstw,
   `forceSinglePass`, grafu współdzielonego, rozgrzewki passów); sekcję „Port WebGPU (w toku)” zamień na krótką
   „Render: WebGPU + TSL”. `docs/PORT-*.md` — fragmenty z instrukcjami GLSL.
6. **Końcowy harness** vs baza: wszystkie sceny i warianty, `spis.zamienniki` = 0, w tolerancji albo uzasadnienie per
   scena; zestawienie w `POSTEP.md`.
7. **`README.md` / `POSTEP.md`:** port zakończony; harness na przyszłość (bazy nowych scen robi się z `main`, nie z tagu).
8. Zaproponuj użytkownikowi tag `webgpu-port` i push (PLAN §12 p. 4) — bez zgody nie twórz i nie wypychaj.

## Pułapki
- Strażnik nie może łapać dem ani narzędzi spoza gry (graf importów, nie `glob`).
- Usuwanie plików, z których korzystają dema na tagu, nie psuje tagu (osobny worktree) — ale sprawdź dema na `main`.
- Normalizuj CRLF w strażnikach-regexach w teście, nie w plikach (memory: testy).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek; nowy strażnik zielony.
- `INWENTARZ.md`: grupa „port” bez GLSL i API WebGL.
- Harness końcowy: `spis.zamienniki` = 0 we wszystkich scenach; zestawienie w `POSTEP.md`.
- `agents.md`, `README.md`, `POSTEP.md` zaktualizowane; commit na `main`.

## Czego NIE robić
- Nie usuwaj niczego poza decyzjami użytkownika; nie zmieniaj rozgrywki; nie twórz tagu ani nie pushuj bez zgody.

## Raport na koniec
Co usunięto; decyzje (zamiennik, moduły poza grą); końcowe zestawienie z bazą; pytania.
