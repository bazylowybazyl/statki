# Zadanie 03 — Postprocessing 2/2 i biblioteki cieni: maska słońca, SDF kadłubów, refrakcja, fala uderzeniowa
Zależności: 02 | Równolegle z: 06 | Zalecany effort: max
Zakres: `src/3d/core3d.js` (`createShadowShaftsShader` 147 linii, `_renderSunShadowMask`, snapshot refrakcji),
`src/3d/sunShadowMask.js` (36 linii + `onBeforeCompile`), `src/3d/hullShadowSdf.js` (`HULL_SDF_SHADOW_GLSL` 69 linii,
lustro `traceHullShadowCpu`), `src/effects3d/shockwave3D.js` (50 linii). Razem ~300 linii GLSL, 4 pliki.

## Cel
Cienie słońca działają jak w bazie: maska widoczności (`sunShadowTarget`: R = cień powierzchni, G = smuga tła,
B = mrok pola) liczona raz na klatkę z tarcz planet, pól odległości kadłubów i okręgów ringów; biblioteka maski w TSL
dla materiałów (następne zadania jej używają); zamiennik `applySunShadowToBuiltinMaterial` dla materiałów wbudowanych;
refrakcja fal uderzeniowych. W `render()` zostaje opisane miejsce na przyszły pass zgięcia tła (nowy warp).

## Przeczytaj najpierw
`agents.md` (Core3D: „Cienie słońca… to MASKA widoczności”, „Cień kadłubów… pole odległości sylwetki”),
`docs/webgpu/PLAN.md` §2, §5, `docs/webgpu/SPIKE.md` (4b, 11, 12), `docs/webgpu/POSTEP.md`, memory/notatki:
`docs/AUDYT-bloom-kolizje-2026-09-26.md` (jeśli dotyczy), `src/3d/sunShadowMask.js`, `src/3d/hullShadowSdf.js`
(`packHullShaftOccluder`, `traceHullShadowCpu`, `HULL_SDF_*`), `tests/hullShadowSdf.test.mjs`,
`tests/shadowShaftsQuality.test.mjs`, `src/effects3d/shockwave3D.js`.

## Kroki
1. **Biblioteka maski (`sunShadowMask.js`):** `sunShadowUniforms` → wspólne węzły `uniform()` / `texture()` (to samo API
   `.value`, Core3D ustawia je raz na klatkę). `SUN_SHADOW_GLSL` → funkcje TSL `sunShadowSample()`, `fieldDarkness()`,
   `sunVisibility()`, `sunFill(vis)`, `sunShadeUnlit(color)`, `sunShaftBackdrop(color)` z próbkowaniem maski po
   **`screenUV`** (nie `gl_FragCoord * texel` wprost — w WebGPU oś Y ekranu rośnie w dół; `screenUV` odnosi się do
   aktualnego celu, więc snapshot refrakcji w połowie rozdzielczości sam trafia w teksel). Stałe `SUN_SHADOW_FILL`,
   `FIELD_FILL_CUT`, `SUN_SHAFT_BACKDROP_TINT` bez zmian. GLSL usuń.
2. **`applySunShadowToBuiltinMaterial(material, mode)`** (wołają `planet3d.assets.js`, a wyłączone
   `asteroidBeltBackdrop3D.js`): zwraca / podmienia na materiał węzłowy tej samej klasy (`MeshStandardNodeMaterial`
   itd.): tryb `'direct'` mnoży człon bezpośredni oświetlenia przez `sunVisibility()` (własny `LightingModel` albo
   nadpisanie `direct()` modelu fizycznego), `'backdrop'` mnoży kolor wyjściowy przez smugę. Zachowaj sygnaturę.
3. **Pass maski (`core3d.js`):** `QuadMesh` + `NodeMaterial` do `sunShadowTarget` (RGBA8, `NoBlending`): świat z UV
   (`camC + (uv − 0.5) · viewWS`, podzielony ekran usunięty w 01), tarcze (`uniformArray` vec4 ×48, `Loop(uDiscCount)`),
   kadłuby przez `hullSdfShadow` (krok 4), pole przesłaniające (`uFieldOcc` — zostaje dla nowych asteroid), okręgi
   ringów (tylko kanał G, pomijane wewnątrz tarczy), gain, dither ±0,5/255 tylko pod smugą (pełne słońce = dokładne 0).
   Sprawdź **orientację**: okluder w znanym punkcie świata ma ocieniać właściwe piksele (test albo scena `planeta-cien`
   i `bitwa` z SDF kadłubów).
4. **`HULL_SDF_SHADOW_GLSL` → TSL** (`hullShadowSdf.js`): marsz po tablicy warstw SDF (`DataArrayTexture`,
   `texture(…).depth(warstwa)`), A/M/C per statek (`uniformArray` vec4 ×32), `uHullSteps`, siła 0,55 — **zgodnie z
   `traceHullShadowCpu`** (test lustra CPU ma przejść; jeśli test regexuje GLSL — przepisz na sprawdzenie kształtu
   funkcji TSL albo porównanie liczb z renderu w harnessie strony).
5. **Refrakcja:** snapshot tła + ortho + tarcz do `refractionTarget` (pół rozdzielczości) co drugą klatkę przy aktywnych
   falach; `shockwave3D.js` — materiał refrakcji w TSL (próbkowanie `refractionTarget`, `screenUV`). Fale i zwiastuny
   to sama przezroczysta refrakcja, bez świecących okręgów (`memory: shockwave-style`).
6. **Miejsce na nowy warp:** w `render()` komentarz + pusta gałąź „pass zgięcia tła” zaraz po passie tła (PLAN §9).
7. **Testy:** `shadowShaftsQuality` (asercje o shaderze shaftów, `HULL_SDF_SHADOW_GLSL`, `onBeforeCompile`, linie maski
   w shaderach kadłuba/planet/pasa — te ostatnie przepisują zadania 04/05; tu zmień tylko to, co dotyczy tych plików),
   `hullShadowSdf`, `sceneMatrixSync` (kolejność aktualizacji fal).

## Pułapki
- Maska jest MASKĄ widoczności — nie mnóż gotowego obrazu (agents.md: to gasiło broń z warstwy 0 i kładło drugi cień na
  ring). Emitery, tarcze i ring maski nie czytają.
- `uniformArray` z `Vector4` modyfikowanymi w miejscu — adapter `node.array` (SPIKE 3).
- Pusta tablica SDF czytałaby się jako „wszędzie kadłub” — `uHullCount = 0`, gdy brak tekstury (jak dziś).
- `pow`/`sqrt` z możliwie ujemnym argumentem: `max(…, 0)` jak w oryginale.
- Maska 8-bit: zachowaj dither (schodki na długich smugach).
- Do tego zadania `uSunShadowOn = 0` (01) — po włączeniu sprawdź, że materiały jeszcze nieprzeniesione (zamienniki) nie
  psują maski.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek; `tests/hullShadowSdf.test.mjs` (lustro CPU) przechodzi.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/03 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  smuga cienia Wenus w `planeta-cien__tlo` i cienie kadłubów w `bitwa__tlo`/`bitwa__ortho` w tolerancji tam, gdzie warstwa
  nie ma zamienników (inaczej: porównanie wzrokowe z bazą w miejscach cienia, opisane w raporcie); bez regresji względem 02.
- Fala uderzeniowa (`wybuch`) załamuje tło jak w bazie.
- `INWENTARZ.md`: `sunShadowMask.js`, `hullShadowSdf.js`, `shockwave3D.js` bez GLSL; `POSTEP.md`; `agents.md` (maska
  w TSL: `screenUV`, funkcje TSL zamiast `SUN_SHADOW_GLSL`); commit na `main`.

## Czego NIE robić
- Nie przenoś materiałów kadłubów, planet, ringu (zadania 04–10) — tylko bibliotekę, z której skorzystają.
- Nie przywracaj okluzji screen-space ani quada mnożącego obraz.

## Raport na koniec
Co zrobione; jak sprawdzona orientacja maski; zrzuty `planeta-cien`, `bitwa__tlo`, `wybuch` (przed/po, obok siebie);
co zostało; pytania.
