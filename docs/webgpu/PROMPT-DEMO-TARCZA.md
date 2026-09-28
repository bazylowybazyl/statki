# Prompt (jedna sesja): demo WebGPU — nowa tarcza (pole siłowe liczone na GPU)

Pracujesz lokalnie na Windowsie użytkownika, w repozytorium gry (three.js r183, Vite),
bezpośrednio na gałęzi `main`. **Testy robi użytkownik** — Ty budujesz demo i na końcu piszesz,
że jest gotowe do testowania.

**Cel:** nowe, samodzielne demo `dema/tarcza-webgpu.html` na `WebGPURenderer` + TSL z tarczą
nowej generacji na kadłubie Atlasa. Dzisiejsza tarcza gry (`src/3d/shield3D.js`, GLSL) to kopuła
dopasowana do obrysu kadłuba, z łatami trafień z tablicy **24** uniformów, obramówką z fresnela
i analitycznymi wstęgami iskier (`src/3d/shieldImpactFx.js`). Nowa tarcza ma być **ośrodkiem**,
a nie naklejką:

1. **stan pola na GPU (compute):** fale rozchodzą się po całej tarczy, nakładają się i odbijają
   od krawędzi; energia trafień nagrzewa pole, rozpływa się i stygnie; długi ostrzał w jedno
   miejsce przegrzewa je aż do **przebicia**; liczba trafień nie jest ograniczona do 24;
2. **pole świeci na otoczenie:** każde trafienie jest dynamicznym światłem, a rozgrzana tarcza
   podświetla kadłub pod sobą;
3. **pole załamuje światło:** to, co za tarczą (kadłub, tło), faluje w miejscach trafień;
4. **iskry ślizgają się po powierzchni** (cząstki w compute przyklejone do czaszy), a pęknięcie
   tarczy rozsypuje ją na heksy.

To pokaz możliwości, nie port gry: nie ruszasz gry, `Core3D` ani istniejących dem.

---

## Zasady

- Tylko nowe pliki: `dema/tarcza-webgpu.html`, `dema/tarcza-webgpu.js` i ewentualnie moduły
  w `dema/tarcza-webgpu/`. Kod gry tylko czytasz. **Wyjątek do importu:** `shieldSystem.js`
  (maszyna stanów tarczy i profil obrysu — importuje wyłącznie dane z `src/data/`, bez three);
  importuj go, nie kopiuj, żeby kształt i czasy zgadzały się z grą co do joty. Modułów, które
  ciągną renderer WebGL (`shield3D.js`, `shieldImpactFx.js`, `core3d.js`), nie importuj — z nich
  bierzesz wzory i liczby.
- **Pracuj na `main`** — nie twórz gałęzi ani worktree. Commit na `main` po każdym etapie
  (niżej), tak żeby w każdej chwili było działające demo. Bez push i bez force-push — wypchnie
  użytkownik po testach.
- Bez nowych zależności. Komentarze i teksty w UI po polsku.
- Demo działa pod Vite (`npm run dev`), importy gołe: `three/webgpu`, `three/tsl`,
  `three/addons/...` — jeden rdzeń three (sprawdź, że Vite nie dociąga drugiej kopii).
- **Model „niewidzialne pole” zostaje domyślnym wyglądem** (decyzja użytkownika, opis
  w `shield3D.js` przy `resolveHullFieldPhase`): w normalnej pracy tarczy nie widać; zdradza ją
  trafienie, rozruch, gaszenie, pęknięcie i puls przy niskim HP (< 35%). Stałą widoczność pola
  daj tylko jako przełącznik „pokaż pole” w panelu.
- **Kształt i stany z gry:** obrys z `getEntityShieldProfile` / `sampleShieldProfileRadius`,
  przejścia stanów przez `updateShieldFx` (off → activating → active → deactivating / breaking),
  trafienia przez `registerShieldImpact(encja, x, y, obrażenia, klasa)` z klasami `pd`, `main`,
  `special`, `shield`. Barwa jak w grze: pełne HP `#5992f7`, puste — czerwień
  (`SHIELD_EMPTY_COLOR`), pęknięcie — `SHIELD_BREAK_COLOR`.
- Pipeline HDR-first jak w grze: emitery > 1.0, bloom z progiem ~0,9 (`src/3d/bloomConfig.js`
  jako punkt wyjścia), tone mapping na końcu. Bez `pow()` z ujemną podstawą, clamp tam, gdzie NaN
  rozlałby się przez bloom.
- Zero alokacji w pętli klatki; bufory, pule i tekstury tworzone raz.
- Zatrzymaj się i zapytaj użytkownika tylko wtedy, gdy drzewo robocze na starcie nie jest czyste,
  strona nie może wystartować na WebGPU (brak adaptera) albo trafisz na blokadę bez obejścia.
  Poza tym pracuj samodzielnie do końca.

## Przeczytaj najpierw

- `agents.md` (precyzja, HDR, alokacje) i `docs/webgpu/USTALENIA.md` — **§4** (three r183 pod
  WebGPU) i **§9 (pułapki TSL wyłapane przy demach — przeczytaj koniecznie przed pierwszą linią
  TSL)**.
- Dzisiejsza tarcza, żeby wiedzieć, co przebijasz:
  - `src/3d/shield3D.js` — geometria czaszy na profilu (`buildHullShieldGeometry`: 192 kroki
    kątowe × pierścienie `HULL_RADIAL_T`, wysokość `h·(1−t²)^0.62`, krawędź na z = 0, oś y
    odwrócona: `y3d = −y_grid`), uniformy i ich wartości (`createHullShieldMaterial`),
    `resolveHullFieldPhase` (fala rozruchu 0→1,2, dopalenie 0,42 s), `SHIELD_FIELD_TUNING`,
    próg LOD `SHIELD_DOME_MIN_PX`;
  - `src/3d/shieldImpactFx.js` — klasy trafień `PRESETS` (pd / main / special / shield: liczba,
    życie, prędkość, szerokość w jednostkach promienia tarczy) — punkt wyjścia dla iskier;
  - `shieldSystem.js` — stany i czasy (`ACTIVATION_SPEED`, `DEACTIVATION_SPEED`,
    `BREAK_DURATION`), `registerShieldImpact`, budowa profilu (`buildShieldProfile`: 96 binów,
    odstęp od pancerza, wygładzanie), `getEntityShieldRadiusTowards`,
    `setEntityShieldForcedOff`. Uwaga: `shieldSystem` nie odejmuje HP — robi to wywołujący.
  - `dema/shieldhitgpu.html` — pierwowzór wstęg iskier (GPGPU, curl noise) — wzorzec wyglądu.
- Sprawdzone dema WebGPU w repo (wzorce, z których wolno kopiować kod do katalogu dema):
  - `dema/laser-webgpu.html` — pętla do 256 świateł w TSL (`shotLight` na powierzchni,
    `mediumLight` w ośrodku), pociski, wiązka, salwa, iskry w compute, przełącznik A/B,
    proceduralne okręty (`buildShip`), materiał kadłuba;
  - `dema/gazy-webgpu.html` — siatka pola w compute (bufory `instancedArray`, przebieg „out” +
    przebieg kopii, przesunięcie okna), zapis do `StorageTexture` i odczyt w materiale, osobny cel
    MRT „fx” z addytywnym mieszaniem, kamera z góry jak w grze (fov 35°);
  - `dema/tlo-kosmosu-webgpu.html` — tło (mgławica + gwiazdy), jeśli chcesz ładniejsze niż proste.
- Atlas: `public/assets/capital_ship_rect_v1.png` (3747×1677, alfa), rozmiar kadłuba z
  `HULL_RENDER_PROFILES.atlas` / `getHullRenderSize` w `src/data/ships.js`.

## three r183 — sprawdzaj w `node_modules/three`, nie z pamięci

- `three/webgpu`: `WebGPURenderer` (`await renderer.init()`, `trackTimestamp: true` +
  `renderer.resolveTimestampsAsync()` do ms GPU), materiały węzłowe, `RenderPipeline`,
  `StorageTexture`, `BlendMode`.
- `three/tsl`: `Fn` (+ `.setLayout` dla funkcji wołanych wiele razy), `instancedArray`,
  `instanceIndex`, `Loop` (z nazwanym licznikiem), `If`, `select`, `uniform`, `uniformArray`,
  `texture` (w vertex shaderze z jawnym `.level(0)`), `textureStore`, `pass`, `mrt`,
  `viewportSharedTexture` (kopia obrazu za obiektami przezroczystymi — do załamania),
  `screenUV`, `renderOutput`, `convertToTexture`.
  Compute: `const krok = Fn(() => { … })().compute(N)` → `renderer.compute(krok)`.
- `examples/jsm/tsl/display/BloomNode.js` (bloom), `FXAANode.js` (gdy potrzebna głębia bez MSAA).

## Scena

- **Kamera z góry jak w grze** (perspektywa, fov 35°, patrzy prosto w dół — wzór
  `dema/gazy-webgpu.html`), kółko = zoom (od całego Atlasa z wrogami po zbliżenie na łatę
  trafienia), WASD = przesuw kamery.
- **Atlas w środku, nieruchomy:** kwad z tekstury kadłuba (alfa), oświetlony tymi samymi
  światłami co reszta (normalna z luminancji, jak w promptcie dema asteroid). Materiał kadłuba ma
  dodatkowo czytać stan pola (niżej: „pole świeci na kadłub”).
- **Encja tarczy Atlasa w konwencji gry:** `{ x, y, angle, type, visual: { spriteScale },
  hexGrid: { shards }, shield: { val, max, … } }`, współrzędne gry (y w dół), render
  w 3D z `y3d = −y`, jak w grze. `hexGrid.shards` zbuduj raz z kanału alfa sprite'a: komórki na
  siatce co ~12 px sprite'a tam, gdzie alfa > 0,5 (`origLx`, `origLy` względem środka, y w dół,
  `radius` = pół odstępu). Wtedy `getEntityShieldProfile(encja)` daje **dokładnie ten obrys co
  w grze** — sprawdź, że `maxR` ≈ pół długości kadłuba + odstęp.
- **Wrogowie:** 3 mniejsze okręty (proceduralne jak `buildShip` z dema lasera) na łuku 4–6 tys. j.
  od Atlasa, wieżyczki celują w Atlasa. Jeden z nich ma własną tarczę-obrys (profil z jego
  sylwetki tą samą drogą) — potrzebny do zderzenia tarcza–tarcza.
- **Tło:** gwiazdy + ciemna mgławica, dalekie i ciemne (tarcza ma być na nim czytelna).
- **Post:** `pass` sceny → bloom → tone mapping (Neutral albo ACES — wybierz, co lepiej trzyma
  błękit tarczy bez przepalenia).

## Nowa tarcza (główny pokaz)

### A. Stan pola na GPU

- Siatka w **płaszczyźnie kadłuba** (widok z góry, klatka lokalna Atlasa), prostokąt obejmujący
  obrys z marginesem, ~512 komórek na dłuższy bok (suwak jakości 256–1024). Komórki poza obrysem
  (`r > r(θ)`) to brzeg. Siatka kartezjańska, nie biegunowa — laplasjan jest wtedy izotropowy,
  a fala nie rozciąga się przy krawędzi.
- Pola (bufory + `StorageTexture` rgba16f do odczytu w materiale; wzorzec z dema gazów):
  - **fala** `h`, `dh/dt` — równanie falowe z tłumieniem, prędkość fali w j./s (suwak), odbicie
    od krawędzi obrysu, krok stały (np. 1/240 s, tyle kroków na klatkę, ile trzeba; pilnuj
    warunku CFL);
  - **energia / obciążenie** `E` — trafienie dokłada energię ∝ obrażeniom, `E` rozpływa się
    (dyfuzja) i stygnie; `E` steruje jasnością i barwą (chłodny błękit → biel → pomarańcz przy
    przeciążeniu);
  - **przebicie** `B` — rośnie tam, gdzie `E` długo przekracza próg (suwak), maleje, gdy
    spadnie poniżej ~60% progu. W przebiciu pole ma dziurę z migoczącym, rozżarzonym brzegiem.
- **Zdarzenia trafień:** co klatkę z CPU lista do ~256 zdarzeń (pozycja lokalna, siła, promień,
  klasa); wiązka ciągła = źródło działające co krok. Rozruch i gaszenie (fala `SWEEP` jak
  w `resolveHullFieldPhase`) też wstrzykują pierścień fali — pole „budzi się” z drgnięciem.
- HP tarczy liczysz na CPU (`val −= obrażenia`, regeneracja z suwaka); przejścia stanów przez
  `updateShieldFx(encja, dt)` co klatkę. Niskie HP (< 35%): pole migocze, fale słabsze.
- Przepuszczanie pocisków przez przebicie (opcjonalnie, jeśli starczy czasu): asynchroniczny
  odczyt małej mapy `B` (np. 64×64, co ~100 ms) na CPU; pocisk trafiający w przebitą komórkę
  leci dalej i trafia w kadłub (gorący punkt + iskry na pancerzu).

### B. Render czaszy

- Geometria jak `buildHullShieldGeometry`, ale gęstsza (np. 384 kroki kątowe × 24 pierścienie),
  budowana raz z profilu. W vertex shaderze przesunięcie wzdłuż normalnej o `h` (odczyt
  tekstury pola z `.level(0)`), normalna z gradientu `h` — fresnel, połysk i załamanie reagują
  na fale.
- Wygląd z modelu „niewidzialne pole”: krycie i emisja z `E`, `|h|`, frontów rozruchu/gaszenia,
  pulsu niskiego HP i przełącznika „pokaż pole”. Heksy (plaster miodu w płaszczyźnie kadłuba,
  komórka ~5% `maxR`) zapalają się tam, gdzie przeszła fala albo leży energia — każda komórka
  z własnym, losowym opóźnieniem i migotaniem, krawędzie komórek jaśniejsze.
- **Załamanie:** `viewportSharedTexture` przesunięte o gradient `h` × `E` (suwak siły), lekka
  dyspersja barw; gdzie pole jest niewidoczne — zero załamania.
- Emisja HDR (bloom łapie rdzenie trafień i brzegi przebić).

### C. Pole świeci na otoczenie

- Każde trafienie = krótkie światło dynamiczne (pętla z `dema/laser-webgpu.html`, do 256
  świateł) oświetlające kadłub Atlasa i wrogów; wiązka = mocne, stałe światło w gorącym punkcie.
- **Poświata pola na kadłubie:** materiał Atlasa czyta teksturę pola w swojej pozycji lokalnej
  i dodaje emisję ∝ `E` + |fala| w barwie tarczy — kadłub pod rozgrzaną łatą błękitnieje, fala
  przebiega po pancerzu jak odbicie. Tanie, a sprzedaje „pole tuż nad pancerzem”.

### D. Iskry na powierzchni (compute)

- Pula ~64 tys. cząstek (pierścień, narodziny zgłaszane z CPU — wzorzec iskier z dema lasera).
  Większość **ślizga się po czaszy**: prędkość styczna, pozycja co krok rzutowana na wysokość
  czaszy z profilu, tarcie; mniejszość odlatuje w przestrzeń wzdłuż normalnej. Rysowane jako
  smugi wzdłuż prędkości (addytywnie, HDR, barwa tarczy → biel w rdzeniu). Liczby na klasę
  z `PRESETS` w `shieldImpactFx.js`, przeliczone na nowy efekt.

### E. Stany

- **Rozruch** (`activating`, czas z `ACTIVATION_SPEED`): front od środka ku obrysowi „maluje”
  pole i wstrzykuje falę; **gaszenie** (`deactivating`, klawisz O przez
  `setEntityShieldForcedOff`): front wraca do środka, pole zapada się w sobie.
- **Pęknięcie** (`breaking`, gdy `val` spadnie do 0): czasza rozpada się na heksy — fragmenty
  w compute (kilka tysięcy kwadów-heksów z siatki czaszy) lecą od ostatniego trafienia i na
  zewnątrz, obracają się i gasną w ~1,2 s; błysk + światło. Potem `off`, regeneracja, ponowny
  rozruch po przekroczeniu progu z `shieldSystem`.

### F. Tarcza w tarczę (opcjonalnie, jeśli starczy czasu)

- Klawisz K: wróg z tarczą podpływa do Atlasa, tarcze się nachodzą. Wzdłuż krzywej przecięcia
  obu pól co krok odkłada się energia (pas interferencji na OBU tarczach), iskry klasy `shield`,
  okręty lekko się odpychają.

## Broń do testów (sterowanie)

- **1–4 klasa broni:** 1 PD (szybkie drobne trafienia, `pd`), 2 laser (pociski, `main`),
  3 torpeda (wolny pocisk, wielkie wgniecenie i fala, `special`), 4 wiązka (ciągła).
- **LPM** — strzał wybraną bronią z najbliższego wroga w punkt kursora; punkt trafienia na
  obrysie liczony jak w grze (`getEntityShieldRadiusTowards`). **PPM** — wiązka ciągła w kursor.
  **Spacja** — salwa wszystkich wrogów. **E** — automatyczny ogień wrogów wł./wył.
- **O** tarcza wł./wył., **B** pęknięcie (HP → 0), **R** pełne naładowanie, **K** tarcza
  w tarczę, **T** nowe efekty wł./wył. (A/B: bez fal, energii, świateł, załamania i iskier
  zostaje sama czasza z łatami — punkt odniesienia), **P** iskry, **H** panel.

## Panel i statystyki

Panel po polsku: pasek HP i stan tarczy (`off` / `activating` / …), przełączniki (pokaż pole,
fale, energia i przebicia, światła, poświata na kadłubie, załamanie, iskry, bloom), suwaki
(prędkość fali, tłumienie, stygnięcie energii, próg przebicia, siła załamania, regeneracja HP,
jakość siatki pola, liczba iskier, moc świateł). Statystyki: FPS, ms CPU, ms GPU, zdarzenia
w klatce, żywe iskry, rozdzielczość siatki. `window.__demo` (konsola): `hit(x, y, dmg, klasa)`,
`salvo()`, `beam(x, y, on)`, `setHP(ułamek)`, `breakShield()`, `toggleShield()`, `step(n)`,
`lookAt(x, y, zoom)`, `stats()`.

## Etapy (commit na `main` po każdym)

0. Sprawdź, że jesteś na `main` i drzewo robocze jest czyste.
1. Szkielet: strona pod Vite, `WebGPURenderer` (komunikat, jeśli nie ma WebGPU), kamera z góry,
   tło, Atlas z tekstury z oświetleniem, wrogowie, bloom + tone mapping.
2. Tarcza jak w grze na nowym rendererze: encja, `hexGrid` z alfy, profil z `shieldSystem`,
   czasza, model „niewidzialne pole”, stany przez `updateShieldFx`, trafienia przez
   `registerShieldImpact`, HP. Od tego miejsca T ma sens (A/B).
3. Stan pola w compute (fala, energia, przebicie) + render: przesunięcie, normalne, heksy, barwy.
4. Światła trafień, poświata pola na kadłubie, załamanie.
5. Iskry na powierzchni, pęknięcie na heksy, fronty rozruchu i gaszenia.
6. Bronie i ogień wrogów, panel, statystyki, `window.__demo`; tarcza w tarczę, jeśli starczy
   czasu.
7. Jedno uruchomienie strony (`npm run dev` albo headless Chrome z narzędzi `dema/rdzen-cdp.js`)
   tylko po to, żeby sprawdzić, że startuje bez błędów w konsoli. Potem komunikat (niżej).

Jeśli limit sesji się kończy, dokończ bieżący etap, zacommituj i napisz, co jest gotowe do
testowania, a czego jeszcze brakuje.

## Kiedy gotowe

- Demo startuje przez `npm run dev` pod `/dema/tarcza-webgpu.html`, bez błędów walidacji
  WebGPU / WGSL w konsoli.
- Kod pisany pod budżet 60 FPS w 1920×1080 przy siatce pola 512, 64 tys. iskier i 256 światłach;
  mierzy użytkownik (statystyki w panelu).
- **Zrzutów, porównań z grą ani pomiarów wydajności nie robisz** — testuje użytkownik.
- `git status` pokazuje czyste drzewo, a commity na `main` dodają tylko nowe pliki dema
  (i ewentualnie notatkę w `docs/`).

## Komunikat na koniec (krótko)

Zacznij od **„Gotowe do testowania.”**, potem:
- jak uruchomić (polecenie i adres strony);
- sterowanie (klawisze, mysz, panel);
- co warto sprawdzić: salwa w jedno miejsce aż do przebicia, wiązka trzymana w jednym punkcie,
  torpeda (wgniecenie i fala przez całą tarczę), B (pęknięcie na heksy) i ponowny rozruch,
  T (A/B), zoom na łatę trafienia (załamanie, poświata na pancerzu);
- co jest uproszczone względem gry i znane braki.
