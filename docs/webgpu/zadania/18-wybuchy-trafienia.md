# Zadanie 18 — Wybuchy, trafienia i Yamato (effects3d w scenie overlay)
Zależności: 17 | Równolegle z: 04–16 | Zalecany effort: xhigh
Zakres: `src/effects3d/reactorblow.js` (2 materiały / 226 linii GLSL — śmierć okrętu, pule 100 000 / 15 000),
`src/effects3d/yamato.js` (2 / 328 — trafienie Yamato, pule 60 000 / 12 000), `src/effects3d/supernovaMissileBlow.js`
(2 / 230 — wybuch Supernowej, pule 40 000 / 4 000), trafienia na materiałach wbudowanych tworzonych na każdy strzał:
`railgunExplosion.js` (klony), `armataImpact.js`, `autocannonImpact.js`, `src/effects3d/reactorProfiles/`,
`src/effects3d/particlePool.js`. 6 materiałów / 784 linie + wbudowane.

## Cel
Wybuchy okrętów, trafienia Yamato i Supernowej oraz trafienia railguna / armaty / działka wyglądają jak w bazie; pierwszy
wybuch każdego typu bez przestoju kompilacji; koszt CPU trafień w bitwie nie gorszy niż w bazie. Po tym zadaniu scena
overlay nie ma zamienników.

## Przeczytaj najpierw
`agents.md` (Core3D: bloom, HDR; Nośnik — efekty z `followCarrier`), `docs/webgpu/PLAN.md` §3 (graf węzłów, materiały
wbudowane per wybuch), §6 (trzymacze), `docs/webgpu/POSTEP.md` (wynik 17 i decyzja o nowych efektach — PLAN §12 p. 6),
`src/effects3d/overlay.js` (po 17), pliki zakresu, `index.html` (grep: `makeReactorBlow`, `makeYamatoImpact`,
`makeSupernovaMissileBlow`, `prewarmSamples`), testy: `renderBugfixGuards` (haze reaktora w osi sceny, bloom overlaya
przez modyfikatory), `renderPerfGates`, `shaderPrewarm`.

## Kroki
1. **Pule cząstek** (`GPUInstancedParticleManager`, `GPUParticleManager`, `Nova*Manager`) → TSL: materiał na pulę
   tworzony raz w fabryce, ruch analityczny w wierzchołkach z atrybutów cząstek, zakresy uploadu jak dziś.
2. **Modyfikatory bloomu** z efektów (Supernowa: podbicie, Yamato: przygaszenie) — przez mechanizm overlaya z 17 (test).
3. **Gorące powietrze** reaktora (`pushHeatHazeWorld(expX, -expZ, -4, …)`) — test „w osi sceny”.
4. **Trafienia na materiałach wbudowanych** (`SpriteMaterial` / `MeshBasicMaterial` na każdy strzał, klony
   `railgunExplosion`): konwertują się z tym samym kluczem (PLAN §3) — zmierz koszt przy ~100 trafieniach/s (scena
   bitwy, PerfHUD „Overlay FX 3D” / „AI”) vs baza; zmieniaj tylko, jeśli jest gorzej.
5. **Rozgrzewka:** pule wiszą w scenie od startu, trzymacze próbek fabryk zostają — pierwszy wybuch każdego typu bez
   przestoju (zmierz: czas klatki pierwszego wybuchu w `wybuch` i w galerii niżej).
6. **Scena galerii** (jeśli bazy brakuje): `galeria-wybuchow` w `zrzuty.mjs` — `window.makeYamatoImpact`,
   `makeSupernovaMissileBlow`, `makeReactorBlow`, `makeRailgunExplosion`, `makeArmataImpact`, `makeAutocannonImpact`
   w stałych punktach kadru, ziarno sceny, N kroków; baza z tagu (`README.md` § Nowa scena bazy).
7. **Testy:** asercje GLSL → odpowiedniki; `yamatoSprite2D`, `projectileTrajectory`, `weaponAim`, `turret2D` czytają
   `yamato.js` / okolice — sprawdź, że przechodzą.

## Pułapki
- Pule 40–100 tys. instancji: koszt wierzchołków liczony zawsze, gdy siatka widoczna — pule chowają się, gdy puste
  (`flushParticlePools`) — zachowaj.
- `supernovaMissileBlow` celowo bez `PointLight` (światło zmieniało klucz programów) — w WebGPU tym bardziej (PLAN §3).
- `NormalBlending` dymu vs addytywny ogień — kolejność rysowania bez zmian.
- Nie zmieniaj profili wybuchów (`reactorProfiles`) ani czasów.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/18 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `wybuch` i `galeria-wybuchow` (jeśli dodana) bez zamienników, w tolerancji; `spis` overlaya = 0 zamienników.
- Pierwszy wybuch każdego typu bez przestoju > 50 ms; koszt trafień w bitwie ~ baza (liczby w raporcie).
- `INWENTARZ.md`: `src/effects3d/` bez GLSL (poza nieużywanym `stationDestructionEffects.js` — decyzja w 20);
  `POSTEP.md`; commit na `main`.

## Czego NIE robić
- Nie wprowadzaj efektów z `dema/rakiety-webgpu` / `dema/bronie-webgpu` bez decyzji użytkownika (PLAN §12 p. 6).
- Nie zmieniaj rozgrywki (obrażenia, promienie, zapalniki).

## Raport na koniec
Co zrobione; zrzuty wybuchów (tag vs main); czasy pierwszego wybuchu; koszt trafień; co zostało; pytania.
