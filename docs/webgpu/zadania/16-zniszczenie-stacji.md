# Zadanie 16 — Zniszczenie stacji: rozpad (shatter), panele, odłamki
Zależności: 03 | Równolegle z: 04–15, 17–19 | Zalecany effort: xhigh
Zakres: `src/vfx/shatterMaterial.js` (1 materiał / 143 linie GLSL: fragmenty rozlatujące się w shaderze),
`src/vfx/shatterShaderBake.js` (atrybuty fragmentów), `src/vfx/destruction3D.js` (1 / 29 — materiał w `:1572`, klony
materiałów GLB przy rozpadzie, `Destruction3D.shatter` / `detachChunk`), `src/vfx/panelShardManager.js` (materiały
wbudowane, klony, instancje), `src/vfx/destructionDebrisManager.js`, wywołanie `destroyStation3D`
(`src/3d/stations3D.js:487`). 2 materiały / 172 linie + wbudowane. Nowa scena harnessu i jej baza z tagu.

## Cel
Rozpad stacji (planetarnych GLB i pirackiej) wygląda jak na tagu, bez przestoju kompilacji w chwili rozpadu. Żadna scena
bazy nie pokazuje rozpadu — zadanie dodaje ją (i jej bazę z tagu), zanim cokolwiek przeniesie.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/PLAN.md` §3, §6, §7 (nowa scena bazy), `docs/webgpu/README.md` (worktree z tagu),
`docs/webgpu/POSTEP.md`, pliki zakresu, `scripts/webgpu/zrzuty.mjs` (budowa scen i sesji), testy:
`renderBugfixGuards` („destrukcja stacji nie rusza zasobów szablonu GLB”), `renderPerfGates` (`panelShardManager`).

## Kroki
1. **Scena `stacja-rozpad`** w `zrzuty.mjs` (sesja `kosmos` albo nowa): stacja z `_mesh3d` (`window.stations` —
   piracka albo planetarna spoza ringów), kamera RTS na nią, `const { destroyStation3D } = await import('/src/3d/stations3D.js')`
   (ta sama instancja modułu co w grze), `destroyStation3D(stacja, { shockwave: true })`, ziarno sceny, N kroków,
   zrzut (rozważ dwa momenty: rozpad trwa, fragmenty daleko). Bez zmian w kodzie gry (tylko harness).
2. **Baza sceny z tagu** (`README.md` § Nowa scena bazy): worktree z `webgl-baseline`, skopiuj tam `scripts/webgpu/`
   z `main`, `zrzuty.mjs --backend webgl --powtorz 2 --sceny stacja-rozpad --out <ścieżka bezwzględna>`, potem na `main`
   `node scripts/webgpu/baza.mjs --dopisz <ta ścieżka>` (PNG do bazy, scena i szum do `baseline.json`). Szum do
   `POSTEP.md`; jeśli dwa przebiegi różnią się więcej niż inne sceny bazy — popraw determinizm sceny, zanim pójdziesz dalej.
3. **`shatterMaterial`** → TSL (wierzchołki: środek i kierunek fragmentu, obrót, czas; oświetlenie jak dziś).
   Rozpad to zdarzenie jednorazowe, ale budowa grafu przy nim = przestój: graf budowany raz (przy starcie gry albo
   pierwszej stacji), rozpady go współdzielą (PLAN §3).
4. **`destruction3D.js:1572`** → TSL; klony materiałów GLB (wbudowane, ten sam klucz — tanie) bez zmian; szablon GLB
   nietknięty (`_cloneOwnedMaterial`, test).
5. **`panelShardManager`** — wbudowane (konwersja automatyczna): sprawdź `instanceColor`, emisję.
6. Wybuch reaktora przy rozpadzie (`reactorFactory` → `window.makeReactorBlow`, scena overlay na własnym WebGL do
   zadania 20) — nie przenoś go tutaj.

## Pułapki
- Fragmenty rzucają cień (`castShadow` kopiowane z oryginału) — mapa cienia słońca aktualizuje się raz na klatkę (01).
- `Math.random` w `Destruction3D` — ziarno sceny z harnessu; nie zmieniaj kolejności losowań w JS.
- Stacje ringów (Ziemia, Mars, Jowisz) nie mają brył (`ringPort`) — wybierz inną.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Scena `stacja-rozpad`: baza z tagu (szum 2 przebiegów zapisany), na `main` bez zamienników w modułach zadania,
  w tolerancji (z wyjątkiem wybuchu reaktora z overlaya — opisz).
- Brak przestoju budowy materiału w klatce rozpadu (czas klatki w raporcie).
- `INWENTARZ.md`: pliki zadania bez GLSL; `POSTEP.md`; commit na `main` (harness + moduły).

## Czego NIE robić
- Nie zmieniaj rozgrywki (HP stacji, progi odrywania fragmentów, misje) ani presetów rozpadu.
- Nie ruszaj nieużywanego `src/effects3d/stationDestructionEffects.js` (poza grą — decyzja w 24).

## Raport na koniec
Co zrobione; zrzuty `stacja-rozpad` (tag vs main); szum bazy; czas klatki rozpadu; co zostało; pytania.
