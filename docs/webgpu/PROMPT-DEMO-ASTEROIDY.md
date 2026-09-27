# Prompt (jedna sesja): demo WebGPU — gęste pole asteroid, fizyczny pył, setki świateł

Pracujesz lokalnie na Windowsie użytkownika, w repozytorium gry (three.js r183, Vite),
bezpośrednio na gałęzi `main`. **Testy robi użytkownik** — Ty budujesz demo i na końcu piszesz,
że jest gotowe do testowania.

**Cel:** nowe, samodzielne demo `dema/asteroidy-webgpu.html` na `WebGPURenderer` + TSL, które
pokazuje scenę **„5 · Gęste pole (Main Belt)”** z `dema/asteroidy.html` (Atlas w rdzeniu pola)
i dokłada dwie rzeczy, których dzisiejszy renderer WebGL gry nie robi:

1. **fizyczny pył** — setki tysięcy drobin liczonych na GPU (compute), które reagują na dysze,
   kadłub, skały i wybuchy;
2. **setki dynamicznych świateł** — każdy wybuch, strzał i świecąca skała oświetla skały, kadłub
   i pył (dziś pole ma limit 32 świateł w tablicy uniformów).

To pokaz możliwości, nie port gry: nie ruszasz gry, `Core3D` ani istniejącego dema. Obraz nie
musi zgadzać się z wersją WebGL co do piksela, ale ma wyglądać co najmniej tak dobrze jak scena 5
w `dema/asteroidy.html` (porówna je użytkownik).

---

## Zasady

- Tylko nowe pliki: `dema/asteroidy-webgpu.html`, `dema/asteroidy-webgpu.js` i ewentualnie
  moduły w `dema/asteroidy-webgpu/`. Kod gry i `dema/asteroidy.*` tylko czytasz. Jeśli moduł gry
  da się zaimportować (dane, generator pola), importuj; jeśli ciągnie kod renderu WebGL, skopiuj
  potrzebne czyste funkcje do katalogu dema z komentarzem, skąd pochodzą.
- **Pracuj na `main`** — nie twórz gałęzi ani worktree. Commit na `main` po każdym etapie
  (niżej), tak żeby w każdej chwili było działające demo. Bez push i bez force-push — wypchnie
  użytkownik po testach.
- Bez nowych zależności. Komentarze i teksty w UI po polsku.
- **Precyzja:** świat gry leży przy milionach jednostek (słońce w 6 mln, pas na 37–45 AU) —
  float32 na GPU tego nie uniesie. Wszystkie dane dla GPU (skały, pył, światła) trzymaj względem
  lokalnego początku przy kamerze, liczonego na CPU w double (`agents.md` §2, wzór
  `src/3d/sceneOrigin.js`); `renderer.highPrecision = true` dla obiektów ustawianych przez
  `Object3D`. Przy przesunięciu początku przesuń żywe dane pyłu, żeby nic nie skoczyło.
- Pipeline HDR-first jak w grze: emitery > 1.0, bloom z progiem ~0,9 (`src/3d/bloomConfig.js`
  jako punkt wyjścia), ACES na końcu. Bez `pow()` z ujemną podstawą, clamp tam, gdzie NaN
  rozlałby się przez bloom.
- Zero alokacji w pętli klatki; bufory i pule tworzone raz.
- Zatrzymaj się i zapytaj użytkownika tylko wtedy, gdy drzewo robocze na starcie nie jest czyste,
  strona nie może wystartować na WebGPU (brak adaptera) albo trafisz na blokadę bez obejścia.
  Poza tym pracuj samodzielnie do końca.

## Przeczytaj najpierw

- `agents.md` (precyzja, HDR, alokacje) i `docs/webgpu/USTALENIA.md` §4 (three r183 pod WebGPU).
- `dema/asteroidy.js` + `.html`: jak powstaje scena `field` (`SPOTS.field = freeSpotNear(CORE)`,
  `findSpot`, zoom 1,0, Atlas, eskorta, `CAVE_SHIP_LIGHTS` / `FIELD_SHIP_LIGHTS`, panel), API
  `window.__demo` (`setScene`, `setZoom`, `step`, `stats`) i parametry `?scene=field&shot=1`.
- `src/game/asteroidBeltField.js` (rozstawienie skał: `forEachRockInRect`, `BELT_BAND`,
  `sampleMacro`), `src/game/asteroidRockKinds.js` (typy, rodziny kształtów), `src/data/asteroidTypes.js`.
- Wygląd do odtworzenia w TSL: `src/3d/asteroidBelt3D.js` (warstwy PLAY / RUBBLE / MID / DEEP,
  kolejność w tle), `src/3d/rocks/rockMaterial3D.js`, `rockShapes3D.js`, `rockMinerals3D.js`
  (skały, żyły rud, lód, metal, świecące skały energetyczne), `src/3d/beltDust3D.js` (mgła, drobiny,
  rozpraszanie w przód, smugi reflektorów w pyle), `src/3d/fieldLights3D.js` (reflektory dalekie,
  dookólne, reflektory otoczenia, czerwone lampy pozycyjne), `src/game/asteroidFieldLight.js`
  (przesłanianie słońca przez pole).
- Atlas: `assets/capital_ship_rect_v1.png`, dysze z `src/data/atlasHardpointDefaults.js`
  i `src/data/engineFx.js` (wpis `atlas`; kadłub ~1800 j. długości).

## three r183 — sprawdzaj w `node_modules/three`, nie z pamięci

- `three/webgpu`: `WebGPURenderer` (`await renderer.init()`), materiały węzłowe, **`RenderPipeline`**
  (w r183 zastąpił `PostProcessing`; uważaj na `outputColorTransform`).
- `three/tsl`: `Fn`, `instancedArray`, `storage`, `instanceIndex`, `atomicAdd`, `Loop`, `If`, `hash`,
  `mx_noise_float`, `uniform`, `uniformArray`, `pass`, `mrt`, `workgroupArray`, `workgroupBarrier`.
  Compute: `const krok = Fn(() => { … })().compute(N)` → `renderer.compute(krok)`.
- `examples/jsm/tsl/display/BloomNode.js` — bloom.
- `examples/jsm/lighting/TiledLighting.js` — `renderer.lighting = new TiledLighting()`: oświetlenie
  kafelkowe, **tylko światła punktowe**, domyślnie do 1024, kafel 32 px; działa z materiałami
  węzłowymi opartymi na standardowym modelu oświetlenia (np. `MeshStandardNodeMaterial`
  z własnymi węzłami koloru, szorstkości, normalnej, emisji).
- Znaczniki czasu GPU: opcja `trackTimestamp: true` + `renderer.resolveTimestampsAsync()`.
- Import map dema potrzebuje wpisów `three/webgpu` → `./node_modules/three/build/three.webgpu.js`
  i `three/tsl` → `./node_modules/three/build/three.tsl.js` (obie paczki dzielą `three.core.js`);
  pod Vite sprawdź, że rdzeń three jest jeden.
- Przykładów HTML (`webgpu_compute_particles*`, `webgpu_lights_tiled`) nie ma w paczce npm — jeśli
  sieć działa, podejrzyj je w repozytorium three.js na GitHubie (tag `r183`).

## Scena

- **Miejsce i skały:** dokładnie scena 5 — ten sam punkt (`freeSpotNear(CORE)` z tym samym polem),
  te same skały z `AsteroidBeltField` w kadrze z marginesem, instancing. Co najmniej warstwa gry
  (PLAY) i jedna warstwa tła dla głębi; RUBBLE / MID / DEEP, jeśli starczy czasu.
- **Kształty:** rodziny z `SHAPE_VARIANTS` — geometria z szumem (CPU albo compute), kilka
  wariantów na rodzinę, instancje z obrotem i skalą.
- **Materiał skał:** TSL na bazie `rockMaterial3D.js` — barwy typów z danych, żyły rud, lód, metal,
  połysk, świecenie skał energetycznych (HDR). Oprzyj go o standardowy model oświetlenia, żeby
  działały na nim wszystkie światła, łącznie z kafelkowymi.
- **Atlas:** w rdzeniu pola jak w scenie 5, sterowany W/S/A/D, kółko = zoom w zakresie dema.
  Render uproszczony: kwad z tekstury kadłuba (alfa), oświetlany tymi samymi światłami (normalna
  z luminancji), poświata dysz. Sylwetka jako pole odległości z kanału alfa (prosty transform
  odległości na CPU, raz) — służy pyłowi za przeszkodę. Eskorta opcjonalnie.
- **Tło:** gwiazdy + ciemna mgławica, proste. Przełącznik „słońce: pełne / przesłonięte” (jak
  suwak przesłaniania w demie WebGL), żeby w mroku było widać same światła.
- **Post:** `pass` sceny → `BloomNode` → ACES.

## Fizyczny pył (główny pokaz)

- Stan w buforach GPU (`instancedArray`: pozycja, prędkość, wiek / rozmiar / ziarno), start
  **250 tys.** drobin, suwak do ~2 mln (gdzie spada płynność, sprawdzi użytkownik).
- Obszar: pudło wokół kamery (XY ~1,5× kadru, gruba warstwa w Z wokół płaszczyzny gry dla
  paralaksy). Drobina, która wyjdzie z pudła, wraca po przeciwnej stronie z prędkością tła —
  pole wydaje się nieskończone, a zaburzenia nie teleportują się.
- Siły (krok stały, np. 1/120 s, maks. kilka kroków na klatkę):
  - **dysze Atlasa** pchają pył stożkiem za rufą, proporcjonalnie do ciągu (W);
  - **kadłub** rozpycha pył (pole odległości sylwetki, poślizg wzdłuż burty);
  - **skały**: zderzenia z kulami skał w pobliżu — lista skał z pola co klatkę do bufora
    (względem lokalnego początku) + siatka komórek do szukania; odbicie z tłumieniem i tarciem;
  - **wybuch** (LPM w punkcie kursora): fala uderzeniowa rozchodząca się ze skończoną prędkością,
    impuls na froncie fali + błysk światła;
  - **strzał** (PPM): lecący pocisk-światło zostawia za sobą ślad w pyle — opcjonalnie;
  - łagodny dryf z szumu (curl noise) i słabe tłumienie, żeby pole uspokajało się po zaburzeniu.
- Render: drobne sprite'y z rozmiarem zależnym od głębi, test głębi ze skałami i kadłubem,
  zanik tuż przy kamerze, rozpraszanie w przód (jaśniej patrząc pod światło), jak w `beltDust3D`.
  **Pył musi być oświetlony wszystkimi światłami:** smugi reflektorów widać w samym pyle, błysk
  wybuchu rozświetla chmurę. Sposób (oświetlenie per drobina w compute z siatką świateł albo
  kwady w materiale z oświetleniem kafelkowym) wybierz sam.
- Mgła z `beltDust3D` jako osobna warstwa, jeśli wyjdzie tanio; fizyczny pył idzie na wierzchu.

## Oświetlenie (drugi pokaz)

- Światła statku jak w demie WebGL (`FIELD_SHIP_LIGHTS`): reflektory dalekie z przodu (kilka
  `SpotLight`), dookólne, reflektory otoczenia, czerwone lampy pozycyjne.
- Światła dynamiczne przez `TiledLighting`: błyski wybuchów (gasnące), pociski, świecące skały
  energetyczne (każda = światło), opcjonalnie pioruny burzy. Suwak „liczba świateł” do 1024.
  Każde oświetla skały, kadłub i pył.
- Opcjonalnie, jeśli starczy czasu: jeden reflektor z mapą cieni — skały rzucają cień w smugę
  w pyle.

## Sterowanie i panel

Panel jak w `dema/asteroidy.html` (po polsku): przełączniki (pył fizyczny, mgła, światła statku,
światła dynamiczne, słońce przesłonięte, bloom), suwaki (liczba drobin, liczba świateł, siła dysz,
siła wybuchu, tłumienie), statystyki: FPS, ms CPU, ms GPU, liczba drobin, liczba świateł,
draw calle — to narzędzia dla testów użytkownika. `window.__demo` (konsola): `setZoom`,
`step(n)`, `explode(x, y, moc)`, `setParticles(n)`, `setLights(n)`, `stats()`.

## Etapy (commit na `main` po każdym)

0. Sprawdź, że jesteś na `main` i drzewo robocze jest czyste.
1. Szkielet: renderer, kamera, skały w dobrym miejscu (prosty materiał), Atlas, bloom + ACES.
2. Wygląd skał w TSL (typy, żyły, lód, metal, świecące skały).
3. Fizyczny pył: symulacja, render, siły (dysze, kadłub, skały, wybuch).
4. Światła: statek + kafelkowe dynamiczne, oświetlenie pyłu.
5. Dopracowanie: panel, statystyki, sterowanie.
6. Jedno uruchomienie strony (`npm run dev` albo headless Chrome z narzędzi `dema/rdzen-cdp.js`)
   tylko po to, żeby sprawdzić, że startuje bez błędów w konsoli. Potem komunikat (niżej).

Jeśli limit sesji się kończy, dokończ bieżący etap, zacommituj i napisz, co jest gotowe do
testowania, a czego jeszcze brakuje.

## Kiedy gotowe

- Demo startuje przez `npm run dev` pod `/dema/asteroidy-webgpu.html`, bez błędów walidacji
  WebGPU / WGSL w konsoli.
- Kod pisany pod budżet 60 FPS w 1920×1080 przy 250 tys. drobin i 256 światłach; mierzy
  użytkownik (statystyki w panelu).
- **Zrzutów, porównań z wersją WebGL ani pomiarów wydajności nie robisz** — testuje użytkownik.
- `git status` pokazuje czyste drzewo, a commity na `main` dodają tylko nowe pliki dema
  (i ewentualnie notatkę w `docs/`).

## Komunikat na koniec (krótko)

Zacznij od **„Gotowe do testowania.”**, potem:
- jak uruchomić (polecenie i adres strony);
- sterowanie (klawisze, mysz, panel);
- co warto sprawdzić: wybuch w pyle (LPM), przelot Atlasa z ciągiem przez pył, suwaki liczby
  drobin i świateł, „słońce przesłonięte”;
- co jest uproszczone względem sceny 5 i znane braki.
