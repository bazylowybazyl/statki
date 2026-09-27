# Prompt startowy: port renderu 3D na WebGPU — Faza 0 (przygotowanie)

Pracujesz lokalnie na Windowsie użytkownika, w repozytorium gry „Super Capital: Battle for
Solar System” (three.js r183, Vite, Electron). Użytkownik chce przenieść warstwę renderu 3D
z `WebGLRenderer` + GLSL na `WebGPURenderer` + TSL. Masz prawdziwe GPU, Chrome i Node —
możesz sam uruchamiać grę w headless Chrome i oglądać zrzuty.

**Ta sesja NIE przenosi gry.** Jej produktem jest: sprawdzone środowisko, spike techniczny,
inwentarz, harness zrzutów z bazą odniesienia WebGL oraz plan podzielony na zadania — każde
jako gotowy prompt, który użytkownik odpali w osobnej sesji. Dopiero te zadania robią port.

Najpierw przeczytaj w całości `agents.md` i `docs/webgpu/USTALENIA.md`. `USTALENIA.md` to
fakty już sprawdzone w kodzie i w źródłach three — nie odkrywaj ich od nowa.

---

## Zasady twarde (obowiązują Fazę 0 i wszystkie zadania, które napiszesz)

1. **Gameplay się nie zmienia.** Fizyka, AI, kolizje, input, misje i HUD 2D są źródłem prawdy;
   port dotyczy wyłącznie warstwy renderu 3D.
2. **usuwaj GLSL.** 
3. **Jeden renderer, tylko w `Core3D`** — reguła z `agents.md` obowiązuje
4. **API three sprawdzaj w `node_modules/three`, nie z pamięci.** TSL szybko się zmienia
   (np. w r183 `PostProcessing` → `RenderPipeline`). Przy każdej niepewności czytaj źródło.
5. **Reguły z `agents.md` obowiązują w TSL tak samo jak w GLSL:** precyzja przy 5–10 mln j.,
   pipeline HDR-first i próg bloomu, zakaz `pow()` z ujemną podstawą i clamp varyingów
   (MSAA + HalfFloat), zero alokacji per klatkę, zgłaszanie aktywności warstw, maska cienia słońca.
6. **Bez nowych frameworków i bundlerów.** Narzędzia pisz jako skrypty Node `.mjs` bez zależności,
   jak istniejące (`dema/rdzen-cdp.js`). Jeśli jakaś zależność deweloperska jest naprawdę
   potrzebna, zapytaj użytkownika.
7. **Git:** pracuj na main użytkownik zrobil backup rar lokalnie
8. **Język:** dokumenty i komentarze po polsku (konwencja repo).
9. **Kontekst:** `index.html` ma ~26 tys. linii — nigdy nie czytaj go w całości, szukaj grepem.
    Szerokie przeszukiwania zlecaj subagentom.
10. **Ciągłość między sesjami:** sesja może się urwać na limicie. Po każdym kroku aktualizuj
    `docs/webgpu/POSTEP.md` (co zrobione, commit, co dalej). Jeśli ten plik już istnieje, zacznij
    od niego i kontynuuj od pierwszego niezakończonego kroku.

**Zatrzymaj się i zapytaj użytkownika**, gdy: nie ma adaptera WebGPU; spike pokaże blokadę bez
obejścia; decyzja zmienia to, co widzi gracz (np. sposób składania klatki, wygląd efektu, którego
nie da się odtworzyć 1:1); potrzebna jest nowa zależność; cokolwiek dotyka gameplayu.

## Warp — poza portem (decyzja użytkownika 2026-09-27)

Obecna soczewka skoku (w grze: `src/vfx/warpLensPass.js` → `Core3D.setWarpLensWorld` → pass
soczewki w `core3d.js` na bazie `src/3d/warpLens3D.js`) **idzie do wyrzucenia**. Zastąpi ją nowy
warp rozwijany w `dema/warp-demo.html` (`src/3d/warpFx3D.js`, `src/3d/warpWorldLens.js`, prymitywy
zgięcia tła `Core3D.pushWarpSpaceWorld`, widok skoku `setWarpViewWorld`, gwiazdy na warstwie 8
`setWarpStarsObject`, fale warpa w passie „uber” `pushWarpWaveWorld`; opis: `docs/BRIEF-warp.md`).
Nowy warp nie jest jeszcze wpięty do gry i wciąż się zmienia. W porcie:
- nie przenoś do TSL ani starej soczewki, ani nowego warpa: pass zgięcia tła, `warpLensTarget`,
  `warpStarTarget`, warstwa 8, fale warpa w „uber”, materiały `warpFx3D.js`;
- na WebGPU te wywołania `Core3D` są bezpiecznymi no-opami (nic nie rysują, nie rzucają
  wyjątków). Na WebGL działają jak dziś — nie usuwaj ich w porcie, wymianę zrobi integracja
  nowego warpa;
- w `RenderPipeline` zostaw opisane miejsce na pass zgięcia tła zaraz po tle — tam wejdzie
  nowy warp;
- plazma WARP z dysz (`warpPlume3D.js`) zostaje w nowym warpie, więc przenosimy ją normalnie;
- rozciąganie gwiazd w skoku (`StarSystem` w `planet3d.assets.js`) `BRIEF-warp.md` §1 też
  przeznacza do wymiany: gwiazdy przenosimy, samo rozciąganie tylko jeśli wychodzi przy okazji
  1:1 — inaczej pomiń i zapisz w `POSTEP.md`;
- inwentarz oznacza te pliki jako „poza portem (warp)”; `tests/warpLens3D.test.mjs`
  i `tests/warpSpace.test.mjs` zostają dla ścieżki WebGL.

---

## Krok 1 — Rozpoznanie

Przeczytaj (subagenci dla dużych plików):
- `agents.md`, `docs/webgpu/USTALENIA.md`;
- `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md` §1 (model klatki);
- `docs/PORT-halo-ring.md` (API ringu i sekcja „W grze”), `docs/PORT-mostki.md` §8.12 (precyzja);
- `src/3d/core3d.js` w całości — to serce portu;
- `src/3d/hexShips3D.js` (`drawHexShips3D`), `src/3d/sunShadowMask.js`, `src/3d/hullShadowSdf.js`,
  `src/3d/bloomConfig.js`, `src/3d/sceneOrigin.js`;
- narzędzia: `dema/rdzen-cdp.js`, `scripts/dym-gry-belki.mjs`, `scripts/halo-ring-shots.mjs`,
  `dema/precyzja-drzenie.js`.

## Krok 2 — Środowisko (zapisz wyniki w `POSTEP.md`)

- Wersje: Node (narzędzia CDP wymagają Node ≥ 22), Chrome, system, GPU i sterownik.
- `npm install`; potem `npm test` i `node --test tests/`. Zapisz stan wyjściowy — jeśli coś już
  pada, NIE naprawiaj, tylko zanotuj jako porażkę bazową.
- Headless Chrome z flagami z `dema/rdzen-cdp.js`: `navigator.gpu.requestAdapter()` → `info`,
  cechy (zwłaszcza `timestamp-query`, `float32-filterable`), limity.
- Brak adaptera WebGPU → STOP, raport dla użytkownika.

## Krok 3 — Spike techniczny (warsztat `dema/webgpu-spike.html` + `.js`, poza grą)

Sprawdź na prawdziwym GPU i zapisz w `docs/webgpu/SPIKE.md` tabelę: punkt / działa? / obejście /
pomiar (ms):

1. `three` + `three/webgpu` + `three/tsl` na jednej stronie: jeden rdzeń klas — pod Vite (dev)
   i przez import map (dodaj wpisy `three/webgpu` → `./node_modules/three/build/three.webgpu.js`,
   `three/tsl` → `./node_modules/three/build/three.tsl.js`).
2. `WebGPURenderer` na canvasie z alfą premultiplied, `await renderer.init()`,
   `renderer.highPrecision = true`.
3. Materiał TSL z adapterem uniformów zgodnym z dzisiejszym kodem aktualizacji:
   `material.uniforms.uFoo.value = …` działa co klatkę bez przebudowy pipeline'u; to samo dla
   `uniformArray` z `Vector4` modyfikowanymi w miejscu.
4. `RenderPipeline`: kilka `pass(scene, camera)` z różnymi warstwami kamery, cel HalfFloat
   z MSAA 4, `BloomNode`, własny pełnoekranowy pass TSL; bez podwójnego tone mappingu
   (`outputColorTransform`).
5. **Składanie klatki:** render do canvasa WebGPU i `ctx2d.drawImage(canvasWebGPU)` w tym samym
   zadaniu JS — także DWA razy na zadanie (wzorzec split-screen z `drawHexShips3D`). Sprawdź
   piksele. Alternatywa: canvas 3D pod przezroczystym canvasem 2D bez kopiowania (w
   `index.html` już tak leżą). Zmierz koszt obu.
6. `readRenderTargetPixelsAsync` z celu RGBA32F (wzorzec wysokości ringu).
7. Render do warstwy `RenderTarget3D` i do celu z `depth` > 1 (wzorce skał).
8. Znaczniki czasu GPU: `trackTimestamp: true` + `renderer.resolveTimestampsAsync()`.
9. Cień `DirectionalLight` z `shadow.autoUpdate = false` i `shadow.needsUpdate = true` tuż przed
   wybranym `render()` — odświeża się dokładnie w tym wywołaniu.
10. Koszt kompilacji: czas `compileAsync` dla dużego wygenerowanego shadera TSL (orientacyjnie).

Punkty 1, 2 albo 5 bez obejścia → STOP, raport dla użytkownika.

## Krok 4 — Inwentarz (`scripts/webgpu/inwentarz.mjs` → `docs/webgpu/INWENTARZ.md`)

Skrypt Node bez zależności, uruchamialny wielokrotnie (będzie mierzył postęp). Dla każdego
pliku w `src/`, `index.html`, `planet3d*.js`: liczba `ShaderMaterial` / `RawShaderMaterial`,
linie GLSL, `onBeforeCompile`, typy celów renderu, odczyty pikseli, wywołania `compile`, inne API
WebGL (`getContext`, rozszerzenia, `capabilities`, `properties`), użyte wspólne biblioteki GLSL
(np. `HULL_SDF_SHADOW_GLSL`, `SUN_SHADOW_GLSL`, eksporty `haloRingGLSL.js`) oraz to, czy plik ma
już odpowiednik TSL (według konwencji, którą ustalisz w planie). Na końcu sumy, graf zależności
bibliotek GLSL i lista miejsc przebudowy materiałów w locie (`clone`, `needsUpdate`, `defines`).
Porównaj sumy z `USTALENIA.md` (~105 materiałów, ~12,7 tys. linii) i wyjaśnij różnice.
Oznacz strony `dema/`, które korzystają z shaderów gry — przenosimy tylko te używane przez
harness albo będące warsztatem przenoszonego modułu (np. `dema/halo_ring_demo.html`).

## Krok 5 — Harness zrzutów i baza odniesienia

`scripts/webgpu/zrzuty.mjs` na bazie `dema/rdzen-cdp.js` i wzorców z `scripts/dym-gry-belki.mjs`
oraz `scripts/halo-ring-shots.mjs`:
- opcje: `--backend webgl|webgpu|oba`, `--sceny a,b,…`, `--out`, `--rozmiar 1920x1080`,
  `--port` (Vite) i `--baza <katalog>` — równoległe sesje w worktree nie widzą `.tmp/`
  głównego katalogu i nie mogą dzielić portu;
- **determinizm:** stały seed, zegar ręczny albo pauza, stała kamera i zoom, czekanie na
  asynchroniczny start (pieczenie ringu, kompilacja) i N klatek rozgrzewki. Znajdź, jak robią to
  istniejące skrypty. Jeśli gra nie ma potrzebnego haka, dodaj minimalny hak tylko pod `?dev`,
  bez zmiany gameplayu, i opisz go;
- sceny (dopasuj po lekturze kodu): menu (Ziemia + ring), gra przy ringu Ziemi (tło + dach FG
  + wycięcie), hala K-7, gęste pole asteroid (światła pola, pył), burza pasa, bitwa (pociski,
  wiązki, wybuchy, tarcze, bloom, gorące powietrze), ładowanie i skok warp (plazma WARP
  z dysz; na WebGPU bez soczewki — tę scenę porównujesz z bazą tylko na WebGL),
  planety i słońce z shadow shafts, mostek 3D z bliska z uszkodzeniami, wraki i szczątki,
  split-screen, HUD 2D nad 3D;
- dla każdej sceny: PNG, błędy i ostrzeżenia konsoli (porażka przy błędach walidacji WebGPU,
  kompilacji WGSL i ostrzeżeniach three), draw calle i trójkąty, ms CPU na klatkę, ms GPU,
  histogram HDR, jeśli się da.

`scripts/webgpu/porownaj.mjs`: porównanie dwóch zestawów — odsetek różniących się pikseli,
maksymalna różnica, mapa różnic PNG, zestawienie obok siebie, raport JSON + Markdown. Porównanie
możesz liczyć w przeglądarce przez CDP (canvas + `getImageData`), żeby zostać bez zależności.

Baza odniesienia:
- uruchom WebGL dwa razy → **próg szumu** dla każdej sceny;
- PNG do `.tmp/webgpu/baseline/` (w `.gitignore`); do repo idzie `docs/webgpu/baseline.json`
  (commit, GPU, sterownik, Chrome, rozdzielczość, progi szumu, pomiary). Bazę da się zawsze
  odtworzyć z tagu `webgl-baseline`;
- pomiar wydajności na WebGL: scenariusz bitwy (CPU i GPU ms, draw calle);
- pomiar drżenia: `dema/precyzja-drzenie.js` na WebGL.

## Krok 6 — Plan i zadania

**`docs/webgpu/PLAN.md`** — decyzje architektoniczne oparte na spike'u:
- przełącznik backendu w `Core3D` (`?renderer=webgpu`), asynchroniczny start renderera, import
  map i Vite (jeden rdzeń three);
- konwencja materiałów: np. moduł eksportuje fabrykę, która na WebGL zwraca dzisiejszy
  `ShaderMaterial`, a na WebGPU materiał węzłowy z pliku `*.tsl.js` obok modułu; adapter
  `material.uniforms.X.value`, żeby kod aktualizacji się nie zmieniał;
- materiały jeszcze nieprzeniesione: na WebGPU widoczny zamiennik (np. magenta) liczony przez
  inwentarz — gra startuje na WebGPU od pierwszego zadania;
- kolejność: fundament → postprocessing → wspólne biblioteki GLSL → rodziny materiałów;
- składanie klatki (wynik spike'u), odświeżanie cieni per światło, `highPrecision`,
  asynchroniczne pieczenie i odczyty (ring, skały, rozgrzewka menu);
- poza zakresem: usuwanie GLSL, stara soczewka i nowy warp (sekcja Warp), nowe efekty (TSL daje
  np. oświetlenie kafelkowe — to później), zmiany gameplayu, wspólne urządzenie z solverem sprężyn;
- ryzyka i otwarte pytania do użytkownika.

**`docs/webgpu/zadania/NN-nazwa.md`** — każde zadanie to samodzielny prompt dla świeżej sesji
(sesja nie zna tej rozmowy). Szablon:

```
# Zadanie NN — <nazwa>
Zależności: <numery> | Równolegle z: <numery albo „nie”> | Zalecany effort: max | xhigh
Zakres: <pliki>, <liczba materiałów>, <linie GLSL>

## Cel
## Przeczytaj najpierw   (agents.md, docs/webgpu/USTALENIA.md, PLAN.md, POSTEP.md + pliki zadania)
## Kroki
## Pułapki              (konkretne dla tych plików — z agents.md, USTALENIA.md, SPIKE.md)
## Kryteria akceptacji
- `npm test` i `node --test tests/` bez nowych porażek względem bazy;
- `scripts/webgpu/zrzuty.mjs --backend oba`: WebGL = baza (w progu szumu) we WSZYSTKICH
  scenach; WebGPU w progu w scenach dotkniętych zadaniem;
- zero błędów walidacji WebGPU / WGSL w konsoli;
- brak regresji wydajności WebGL, brak nowych alokacji per klatkę;
- lustra CPU shaderów (jeśli dotyczy) zgodne;
- inwentarz pokazuje przeniesione materiały; POSTEP.md zaktualizowany; commit (+ push).
## Czego NIE robić
## Raport na koniec     (co zrobione, ścieżki zrzutów przed/po do obejrzenia, co zostało, pytania)
```

Zasady podziału: jedno zadanie = jeden podsystem albo jedna rodzina materiałów, do ~1500 linii
GLSL i ~8 plików; większe dziel (ring na kilka zadań). **Zalecany effort `max`** tylko dla zadań
architektonicznych i trudnych (fundament, postprocessing, shadow shafts, pieczenie
i odczyty asynchroniczne, precyzja, wydajność); mechaniczne porty materiałów — `xhigh`.
„Równolegle z” wpisuj tylko dla zadań na rozłącznych plikach, po zakończeniu wspólnych bibliotek
(równoległe sesje idą w osobnych worktree).

Proponowana kolejność — zweryfikuj i popraw po inwentarzu:
1. **Fundament:** przełącznik backendu, `WebGPURenderer` w `Core3D`, `highPrecision`, cienie per
   światło, `info`, znaczniki czasu GPU w PerfHUD, składanie klatki, zamienniki materiałów,
   adapter uniformów; harness działa na obu backendach.
2. **Postprocessing (1/2):** passy sceny po warstwach, bloom z parametrami z `bloomConfig.js`,
   „uber” (gorące powietrze, ACES; fale warpa pomiń — należą do nowego warpa), scene resolve,
   `setMsaaEnabled`.
3. **Postprocessing (2/2):** maska shadow shafts (`sunShadowTarget` + SDF kadłubów), refrakcja,
   halo planet, fala uderzeniowa; opisane miejsce na przyszły pass zgięcia tła (sekcja Warp).
4. **Wspólne biblioteki GLSL → TSL:** maska cienia słońca (+ zamiennik `onBeforeCompile`),
   cień SDF kadłubów (+ zgodność z `traceHullShadowCpu`), uniformy świateł pola, pomocniki
   `sceneOrigin`.
5. Kadłuby i ich partie (`hexShips3D`, `beamShips3D`, `hullLacquer`, `beamSkin*`, `shipProxyBatch3D`,
   `hexBodyImpostorBatch`, `coldWreckImpostors`, `voxelShips3D`).
6. Planety, słońce, gwiazdy, stacje, świat (`planet3d.assets.js`, `starParallax`, `stations3D`, `world3d`).
7–10. **Ring:** pieczenie map + asynchroniczny odczyt + kolejność startu; teren + atmosfera;
   struktura + megastruktura; miasto + K-7 + kopuły i budowle. Warsztat: `dema/halo_ring_demo.html`.
11. Tło menu (Ziemia, niebo, rozgrzewka pipeline'ów — nowy odpowiednik `tests/menuBackdrop.test.mjs`).
12. Skały (`rockMaterial3D` z pieczeniem 3D, `rockShapes3D` z celem warstwowym i odczytem,
    `giantRock3D`, `rockMinerals3D`, `rockLayer3D`, pole i pas asteroid).
13. Pył, burze, światła pola (`beltDust3D`, `beltStorm3D`, `fieldLights3D`).
14. Broń i cząstki (`weapon3DSystem` — przy okazji bez klonowania materiałów na strzał, audyt
    §2.2; `fxParticles3D`, `sparkSystem3D`, `railgunFx3D`, `muzzleFx3D`, `slugTrail3D`,
    `beamWeaponsVisual3D`).
15. Silniki (`mainExhaust3D`, `warpPlume3D` — plazma WARP, `engineExhaustBatch`).
16. Tarcze (`shield3D`, `shieldImpactFx`).
17. Mostki, reaktory, rdzenie, światła statków (`bridge3D`, `bridgeFx3D`, `reactor3D`, `coreFx3D`,
    `shipLights3D`; trik cienia mostka z `depthFunc GREATER`).
18. Szczątki i destrukcja (`hullDebris3D`, `beamDebris3D`, `vfx/destruction3D`, `vfx/shatterMaterial`,
    `effects3d/particlePool`).
19. `effects3d/*` (overlay, rakiety, wybuchy, Yamato, zniszczenie stacji, fala uderzeniowa).
20. Ładunek (`cargoContainers3D`, `cargoDrones3D`).
21. Wydajność i precyzja: bitwa WebGL vs WebGPU (CPU/GPU ms), `dema/precyzja-drzenie.js`
    na WebGPU, czasy kompilacji i rozgrzewka, pamięć.
22. **Odłożone:** nowy warp na WebGPU — dopiero po wpięciu nowego warpa do gry (decyzja
    użytkownika); pass zgięcia tła powstaje wtedy od razu w TSL.

Dodatkowo utwórz:
- **`docs/webgpu/README.md`** dla użytkownika: jak odpalać zadania (gałąź `webgpu/port`, jedno
  zadanie na sesję, `/clear` między zadaniami, effort z nagłówka zadania ustawiany przez `/effort`,
  linia startowa „Przeczytaj docs/webgpu/zadania/NN-….md i wykonaj to zadanie.”), jak wznowić po
  resecie limitu (POSTEP.md), jak odpalić zadania równoległe (`claude --worktree <nazwa>`, potem
  merge; każda sesja z innym `--port` i `--baza` wskazującą bazę z głównego katalogu; pomiary
  wydajności tylko wtedy, gdy nic innego nie obciąża GPU), gdzie oglądać zrzuty i jak czytać
  raport porównania;
- **`docs/webgpu/POSTEP.md`**: tabela zadań (numer, nazwa, zależności, effort, status, commit,
  uwagi) + dziennik sesji;
- w `agents.md` krótką sekcję „Port WebGPU (w toku)”: dwie ścieżki, każda zmiana shadera w obu
  ścieżkach, GLSL zostaje, flaga `?renderer=webgpu`, odnośnik do `docs/webgpu/PLAN.md`.

## Krok 7 — Raport dla użytkownika

Krótko: środowisko i GPU; wyniki spike'u (co działa, co wymaga obejścia, ewentualne blokady);
ile zadań, w jakiej kolejności, z jakim effortem, które mogą iść równolegle; gdzie obejrzeć
bazowe zrzuty; otwarte pytania. Zakończ dokładną linią startową zadania 01.

Nie zaczynaj zadania 01 bez zgody. Jeśli Faza 0 jest skończona, a zostało dużo limitu, zapytaj
użytkownika, czy zacząć.

## Definicja ukończenia Fazy 0

- [ ] tag `webgl-baseline`, gałąź `webgpu/port`, commity z każdego kroku
- [ ] `POSTEP.md` ze stanem środowiska i porażkami bazowymi testów
- [ ] `SPIKE.md` — 10 punktów sprawdzonych na prawdziwym GPU
- [ ] `scripts/webgpu/inwentarz.mjs` + `INWENTARZ.md`
- [ ] `scripts/webgpu/zrzuty.mjs`, `scripts/webgpu/porownaj.mjs`, baza WebGL z progami szumu, `baseline.json`
- [ ] `PLAN.md`, `README.md`, komplet `zadania/NN-*.md`
- [ ] sekcja w `agents.md`
- [ ] raport dla użytkownika z linią startową zadania 01
