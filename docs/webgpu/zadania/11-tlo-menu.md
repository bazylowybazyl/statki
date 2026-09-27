# Zadanie 11 — Tło menu: Ziemia z ringiem, niebo, rozgrzewka pipeline'ów
Zależności: 05, 10 | Równolegle z: 12–20 | Zalecany effort: max
Zakres: `src/3d/menuBackdrop3D.js` (200 linii GLSL, 3 materiały: Ziemia w układzie ringu, niebo; `compileAsync`
w `:345`, `:371`), rozgrzewka pieczenia (`createHaloBakeWarmup`, `haloRingWorldGen.js:526`), `Core3D.renderBackdrop`,
`tests/menuBackdrop.test.mjs` (nowy odpowiednik).

## Cel
Menu główne jak w bazie (scena `menu`), a start menu i gry bez przestojów kompilacji: rozgrzewka pipeline'ów WebGPU
(pieczenie map ringu, materiały ringu, Ziemia, niebo) przed pierwszą klatką — z testem, który tego pilnuje.

## Przeczytaj najpierw
`agents.md` (Menu główne i jego tło 3D — cały akapit, w tym „Rozgrzewka musi mieć te same źródła… i scenę BEZ świateł”),
`docs/webgpu/PLAN.md` §6, `docs/webgpu/SPIKE.md` (10), `docs/webgpu/POSTEP.md`, `src/3d/menuBackdrop3D.js`,
`haloRingWorldGen.js` (`createHaloBakeWarmup`), `tests/menuBackdrop.test.mjs`, memory o tle menu (bez ozdobnych
napisów — tylko tekst funkcjonalny).

## Kroki
1. Materiały Ziemi i nieba tła (dzieci grupy ringu, światło w układzie ringu: `uCamLocal`, `uSunDir`, `haloRingBlock`;
   tekstury Ziemi z `window.EARTH`, mgławica z `NebulaSystem`) → TSL (biblioteka ringu z 06).
2. **Rozgrzewka:** w WebGPU pipeline zależy od materiału (węzłów), geometrii (atrybutów), celu (format, MSAA) i stanu —
   nie od „klucza programu” WebGL. Rozgrzewaj `compileAsync` na PRAWDZIWYCH obiektach (quad pieczenia z tym samym
   materiałem i celem, grupa ringu w scenie z tymi samymi światłami co gra) przed pierwszą klatką. Zmierz czasy:
   gotowość menu, budowa ringu, pierwsza klatka gry (harness: czasy sesji; `MenuBackdrop3D.stats`) vs baza WebGL.
3. **Nowy `tests/menuBackdrop.test.mjs`:** niezmienniki w nowym świecie (rozgrzewka używa tych samych instancji
   materiałów / fabryk co pieczenie i ring; `MENU_BACKDROP_LAYER === 9`; `renderBackdrop` przez post Core3D;
   ring wypożyczony `showcaseRing`/`releaseShowcase`, bez drugiego ringu).
4. `renderBackdrop(camera)` — ta sama scena i post (bloom, ACES) co gra, tylko warstwa 9.

## Pułapki
- Nie twórz drugiego ringu dla menu (agents.md).
- `readRenderTargetPixelsAsync` / pieczenie w tle — menu nie może czekać na nie synchronicznie.
- Harness scena `menu` = 150 klatek intro kamery w zegarze wirtualnym — nie zmieniaj czasu intro.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"` (nowy `menuBackdrop`): bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/11 --baza .tmp/webgpu/baseline/webgl/p1`: `menu` w tolerancji,
  bez zamienników; czasy startu (menu gotowe, pierwsza klatka gry) nie gorsze niż baza (liczby w raporcie).
- `INWENTARZ.md`: `menuBackdrop3D.js` bez GLSL; `POSTEP.md`; `agents.md` (akapit o rozgrzewce przepisany na WebGPU);
  commit na `main`.

## Czego NIE robić
- Nie dodawaj napisów ani ozdobników do menu; nie zmieniaj kamery kinowej.

## Raport na koniec
Co zrobione; zrzut `menu` obok bazy; czasy startu przed/po; co zostało; pytania.
