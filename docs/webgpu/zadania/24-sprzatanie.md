# Zadanie 24 — Sprzątanie i domknięcie portu
Zależności: 23 | Równolegle z: nie | Zalecany effort: xhigh
Zakres: resztki GLSL i API WebGL w plikach gry, strażnicy testowi, moduły poza grą (wg decyzji użytkownika z PLAN §12),
dokumentacja (`agents.md`, `docs/PORT-*.md`, `docs/webgpu/*`), końcowy przebieg harnessu.

## Cel
Port zamknięty: gra bez GLSL i bez API WebGL, strażnik testowy tego pilnuje, dokumentacja opisuje stan WebGPU + TSL
(z nowymi efektami broni, rakiet, asteroid i warpa z zadań 17–22), końcowe zestawienie z bazą w `POSTEP.md`. Sceny z nowymi efektami
porównuje się z zatwierdzonym obrazem z `main`, nie z tagiem.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/PLAN.md` (§1, §11, §12 — decyzje użytkownika zapisane w `POSTEP.md`), `docs/webgpu/POSTEP.md`,
`docs/webgpu/WYDAJNOSC.md`, `docs/webgpu/INWENTARZ.md` (świeży: `node scripts/webgpu/inwentarz.mjs`),
`tests/glslReservedWords.test.mjs`.

## Kroki
1. **Inwentarz:** grupa „port” = 0 linii GLSL, 0 `ShaderMaterial` / `RawShaderMaterial` / `onBeforeCompile`, 0
   `WebGLRenderTarget` / `WebGLRenderer` / `EffectComposer` — resztki usuń.
2. **Strażnik:** `glslReservedWords` → test „brak GLSL i API WebGL w plikach ładowanych przez grę” (graf importów jak w
   `inwentarz.mjs`, bez listy ręcznej), z allowlistą modułów poza portem zgodną z decyzją użytkownika (PLAN §12 p. 1).
3. **Nieużywany kod** (decyzja użytkownika: „usuwać nieużywane, przechodzimy w pełni na WebGPU”, PLAN §12 p. 1):
   usuń legacy `planet3d.proc.js`, `voxelShips3D.js`, `stationDestructionEffects.js`, martwe części `Engineeffects.js`,
   starą soczewkę warpa (`warpLens3D.js`, `warpWorldLens.js`, `warpFx3D.js`, `src/vfx/warpLensPass.js` — jeśli po 01
   nic ich nie woła; matematykę CPU z testów przenieś tam, gdzie żyje), stare tło pasa `asteroidBeltBackdrop3D.js`
   (wyłączone; rozgrywka asteroid w `asteroidField3D.js` zostaje do nowych asteroid). Graf importów z `inwentarz.mjs`
   decyduje, co jest nieużywane — nic, co ładuje gra albo demo w repo, nie znika bez zastąpienia. Moduły rozwijane
   (Z4 / Z5 / Z7, nowe asteroidy, `beamShips3D` dla destruktorów) zostają z `// AGENT:` o przejściu na TSL przy integracji.
4. **Zamiennik** (`src/3d/tsl/zamiennik.js`): zostaw jako bezpiecznik (błąd w konsoli + magenta dla przyszłego GLSL)
   albo usuń, jeśli strażnik wystarcza — opisz decyzję.
5. **`agents.md`:** przepisz Core3D i Moduły 3D na stan WebGPU (bez `UnrealBloomPass` / `EffectComposer` /
   `WebGLRenderer` / `ShaderMaterial` → odpowiedniki; zostają reguły precyzji, HDR, maski słońca, warstw,
   `forceSinglePass`, grafu współdzielonego, rozgrzewki passów); sekcję „Port WebGPU (w toku)” zamień na krótką
   „Render: WebGPU + TSL”. `docs/PORT-*.md` — fragmenty z instrukcjami GLSL.
6. **Końcowy harness** vs baza: wszystkie sceny i warianty, `spis.zamienniki` = 0, w tolerancji albo uzasadnienie per
   scena (sceny z nowymi efektami — `galeria-broni`, `galeria-rakiet`, bitwy — vs zatwierdzone przebiegi z 17–22);
   zestawienie w `POSTEP.md`.
7. **`README.md` / `POSTEP.md`:** port zakończony; harness na przyszłość (bazy nowych scen robi się z `main`, nie z tagu).
8. Tag `webgpu-port` na ostatnim commicie portu (lokalnie); bez `git push` (PLAN §12 p. 4).

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
- Nie usuwaj niczego, co ładuje gra albo demo w repo, bez zastąpienia; nie zmieniaj rozgrywki; bez `git push`.

## Raport na koniec
Co usunięto; decyzje (zamiennik, moduły poza grą); końcowe zestawienie z bazą; pytania.
