# Zadanie 12 — Infrastruktura efektów GPU w Core3D: compute w klatce, siatka świateł, zniekształcenia, Fx3D w TSL
Zależności: 03 | Równolegle z: 04–11, 13–16 | Zalecany effort: max
Zakres: nowy katalog `src/3d/fx/` (wspólne klocki nowych efektów, scalone z kopii w demach: `dema/bronie-webgpu/`
`lightGrid.js`, `fxLights.js`, `noise.js`; `dema/rakiety-webgpu/` `lights.js`, `post.js`, `noiseTex.js`, `common.js`
(`GlowSprites`); `dema/asteroidy-webgpu/` `lights.js`, `glowSprites.js`), `src/3d/core3d.js` (krok compute, siatka
świateł, zniekształcenia w „uber”, rozgrzewka, siatka bezpieczeństwa NaN), `src/3d/fxParticles3D.js` (Fx3D — port 1:1:
1 materiał / 67 linii GLSL + 2 `LineBasicMaterial`).

## Cel
Gra ma wspólną podstawę pod efekty z dem WebGPU (decyzja użytkownika 2026-09-27: nowe efekty broni i rakiet wchodzą do
gry przy porcie — zadania 17–19): krok compute w klatce Core3D, **jedną** siatkę świateł (efekty, dysze, lampy statków →
oświetlenie materiałów i dymu), źródła zniekształceń (fale, implozja, gorące powietrze, warstwa DIST) w „uber”,
precyzję pul GPU przy 5–10 mln j. i rozgrzewkę bez przestojów. Stary bank `Fx3D` (dysze MAIN, mostki, rdzenie) w TSL 1:1.
Samych efektów broni i rakiet tu nie ma.

## Przeczytaj najpierw
`agents.md` (Core3D — cały akapit, Moduły 3D: precyzja, Nośnik prędkości), `docs/webgpu/PLAN.md` §2–§6, §9,
`docs/webgpu/POSTEP.md`, `docs/webgpu/DEMO-BRONIE.md` (§ Port do gry, § ustalenia three), `docs/webgpu/DEMO-RAKIETY.md`
(§ Decyzje: światło dymu, HDR, rozgrzewka; § Do portu w grze), `docs/webgpu/DEMO-ASTEROIDY.md` (siatka świateł),
trzy kopie siatki świateł w demach (porównaj), `src/3d/core3d.js` po 02–03 (uber, heat haze, refrakcja),
`src/3d/sceneOrigin.js`, `src/3d/fxParticles3D.js`, test `carrierVelocity`.

## Kroki
1. **Siatka świateł** (`src/3d/fx/lightGrid.js`): scal trzy kopie (bronie, rakiety, asteroidy — różnią się dodatkami:
   reflektory statków `FIELD_SHIP_LIGHTS`, cienie reflektorów, `owner`) w jeden moduł gry: `LightGrid` (budowa CPU
   raz na klatkę dla prostokąta widoku, limity `LIGHT_CAP` / `ITEM_CAP` z dem), `GridLighting` / węzeł świateł dla
   materiałów. Współrzędne względem początku przy kamerze (`sceneOriginNearCamera`) — nie bezwzględne 5–10 mln j.
   Dema zostają na swoich kopiach (nie ruszaj `dema/*-webgpu`).
2. **Kto czyta siatkę:** dema ustawiają `renderer.lighting = new GridLighting(grid)` globalnie — w grze dotknęłoby to
   WSZYSTKICH oświetlanych materiałów (planety, stacje GLB, kadłuby po 04). Zdecyduj mechanizm: globalnie z wyłączeniem
   (planety, tło — nie) albo per materiał; zmierz koszt pętli siatki w passie ortho. Kadłuby zaczną ją czytać w 18,
   dym rakiet w 19 — tu tylko infrastruktura i test na materiale wbudowanym (scena `kalibracja` bez zmian obrazu, gdy
   siatka pusta).
3. **Źródła świateł** (`src/3d/fx/fxLights.js`): błyski i światła punktowe efektów (`flash`, `point`) → siatka co klatkę;
   API dla lamp statków (dzisiejszy payload `buildCombinedShipLightShaderPayload` zostaje w kadłubach do decyzji w 18).
4. **Zniekształcenia** (`src/3d/fx/distortion.js` + „uber” Core3D): typy z `rakiety-webgpu/post.js` (fala, implozja,
   gorące powietrze z dyspersją, `DISTORT_CAP`) obok dzisiejszego `pushHeatHazeWorld` (dysze z kierunkiem — bez zmian
   dla dysz i tarcz) oraz warstwa DIST z `bronie-webgpu` (scena zniekształceń renderowana do celu, próbkowana w
   „uber”). Fale uderzeniowe = sama refrakcja (memory: styl fal). Stara fala `shockwave3D` (zadanie 03) zostaje do 19.
5. **Krok compute w klatce:** `Core3D` dostaje listę kroków compute (`renderer.compute`) wykonywaną RAZ na klatkę przed
   passami scen, z pomiarem (kubełek PerfHUD) i bez alokacji; zegar efektów względem epoki (float32), pule GPU względem
   początku przy kamerze z kernelem przesunięcia żywych danych, gdy początek się przestawia (wzór: `shift` w demie
   asteroid; dziś CPU robi to „lepkim” początkiem w `sparkSystem3D.js` / `slugTrail3D.js`).
6. **Nośnik:** paczki efektów dostają `vel` z `ActiveCarrier` (agents.md) — pomocnik w `src/3d/fx/`.
7. **Rozgrzewka:** klatka przez post Core3D z pustymi warstwami efektów + puste dispatche compute przy starcie (ustalenia
   dem: klucz potoku zależy od celu passu, `compileAsync` pomija niewidoczne; bez tego pierwszy wybuch kompilował ~40 ms).
8. **Siatka bezpieczeństwa NaN/Inf** przed bloomem (demo rakiet) — jeden węzeł w „uber”, koszt znikomy.
9. **Fx3D w TSL 1:1** (`fxParticles3D.js`): cztery grafy (BB, PLUME, CROSS, WASH) budowane raz, współdzielone przez
   systemy (PLAN §3); łuki / iskry Fx3D (`LineBasicMaterial`) konwertują się same. Użytkownicy po zadaniach 17–19: dysze
   MAIN (iskry), `bridgeFx3D`, `coreFx3D` — ich wygląd bez zmian. Test `carrierVelocity` (Fx3D) bez zmian.
10. **Testy:** nowe — budowa siatki (CPU: komórki, limity, `owner`), pakowanie źródeł zniekształceń, przesunięcie
    początku pul (dane żywe zostają w miejscu świata); stare bez nowych porażek.

## Pułapki
- Limit 8 buforów storage na etap (domyślny) — `requiredLimits` z 01; dema trzymają stan puli w jednym buforze z krokiem.
- `pow` z ujemną podstawą → NaN, MSAA ekstrapoluje varyingi (agents.md) — dema opisują dwa takie przypadki.
- `mesh.count` 1 ↔ > 1 zmienia klucz potoku (demo rakiet) — trzymaj 0 albo ≥ 2.
- Siatka świateł w przestrzeni świata gry (float32 przy 6 mln j. ≈ 0,5 j.) — licz względem początku przy kamerze.
- Nie zmieniaj jasności istniejących efektów (HDR, próg bloomu 0,9 — `bloomConfig.js`).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek; nowe testy zielone.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/12 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  bez regresji względem poprzedniego przebiegu (pusta siatka i brak źródeł = obraz bez zmian); zamienniki Fx3D znikają
  (`spis`).
- Krok compute i siatka zmierzone (ms CPU / GPU w `wyniki.json` i PerfHUD) w scenie bitwy — koszt pustej infrastruktury
  ≈ 0.
- `INWENTARZ.md`: `fxParticles3D.js` bez GLSL; `POSTEP.md`; `agents.md` (siatka świateł, krok compute, zniekształcenia —
  gdzie i jak zgłaszać); commit na `main`.

## Czego NIE robić
- Nie wpinaj efektów broni ani rakiet (17–19); nie zmieniaj dem `dema/*-webgpu` (ich sesje trwają).
- Nie zmieniaj oświetlenia kadłubów, planet ani stacji (siatka pusta = obraz bez zmian).

## Raport na koniec
Co zrobione; różnice trzech kopii siatki i wybrana wersja; mechanizm „kto czyta siatkę” z kosztem; koszt kroku compute;
co zostało dla 17–19; pytania.
