# Prompt (jedna sesja w chmurze): demo WebGPU — nowa tarcza (pole siłowe liczone na GPU)

Pracujesz w **Claude Code w chmurze**: świeży klon repozytorium gry (three.js r183, Vite)
w kontenerze Linux, **bez prawdziwego GPU**. Kontener znika po sesji — co nie jest
zacommitowane i wypchnięte, przepada. **Wygląd i wydajność testuje użytkownik** lokalnie na
Windowsie (RTX); Ty budujesz demo, sprawdzasz w kontenerze, że działa bez błędów, i na końcu
piszesz, że jest gotowe do testowania.

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

- **Gałąź:** pracuj na gałęzi, którą przydzieliła ta sesja (nie twórz innych, nie pushuj na
  `main`, bez PR, bez force-push). **Commit i push po każdym etapie** (niżej) — kontener może
  zniknąć w każdej chwili, a użytkownik ściąga gałąź do testów. Push: `git push -u origin
  <gałąź>`; przy błędzie sieci ponów kilka razy z rosnącą przerwą.
- Tylko nowe pliki: `dema/tarcza-webgpu.html`, `dema/tarcza-webgpu.js` i ewentualnie moduły
  w `dema/tarcza-webgpu/` (plus skrypt sprawdzający w `scripts/`, niżej). Kod gry tylko czytasz.
  **Wyjątek do importu:** `shieldSystem.js` (maszyna stanów tarczy i profil obrysu — importuje
  wyłącznie dane z `src/data/`, bez three); importuj go, nie kopiuj, żeby kształt i czasy
  zgadzały się z grą co do joty. Modułów, które ciągną renderer WebGL (`shield3D.js`,
  `shieldImpactFx.js`, `core3d.js`), nie importuj — z nich bierzesz wzory i liczby.
- Bez nowych zależności w `package.json`. Komentarze i teksty w UI po polsku.
- Demo działa pod Vite (`npm run dev`), importy gołe: `three/webgpu`, `three/tsl`,
  `three/addons/...` — jeden rdzeń three. Importów z CDN nie używaj (Vite wysyła nagłówek
  `Cross-Origin-Embedder-Policy: require-corp`, a gra i tak ma three w `node_modules`).
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
- Zatrzymaj się i napisz do użytkownika tylko wtedy, gdy nie da się zainstalować zależności
  (brak sieci do rejestru npm — to ustawienie środowiska w chmurze), WebGPU nie startuje nawet
  na SwiftShaderze z flagami niżej albo trafisz na blokadę bez obejścia. Poza tym pracuj
  samodzielnie do końca.

## Start (etap 0)

1. Sprawdź gałąź i czyste drzewo (`git status`).
2. **Dociągnij dema i notatki, na których opiera się ten prompt** — mogą jeszcze nie być na
   `main`. Jeśli brakuje któregoś z plików `dema/laser-webgpu.html`, `dema/gazy-webgpu.html`,
   `dema/tlo-kosmosu-webgpu.html` albo w `docs/webgpu/USTALENIA.md` nie ma sekcji
   „§9 Pułapki TSL”:
   `git fetch origin claude/webgpu-migration-assessment-oy1l44` i
   `git merge --no-edit FETCH_HEAD` (dodaje tylko te dema i dokumenty; scalenie z `main` jest
   czyste). Commit scalenia + push.
3. Zależności: jeśli nie ma `node_modules`, `npm ci`. Sprawdź `node_modules/three/package.json`
   (wersja 0.183.x).
4. Sprawdź, że WebGPU działa w kontenerze (niżej: „Sprawdzanie w kontenerze”) na pustej stronie
   z jednym przebiegiem compute i jednym renderem — zanim napiszesz resztę.

## Przeczytaj najpierw

- `agents.md` (precyzja, HDR, alokacje) i `docs/webgpu/USTALENIA.md` — **§4** (three r183 pod
  WebGPU), **§8** (jak uruchomić WebGPU w kontenerze) i **§9 (pułapki TSL wyłapane przy demach —
  przeczytaj koniecznie przed pierwszą linią TSL)**.
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
- Sprawdzone dema WebGPU (wzorce, z których wolno kopiować kod do katalogu dema):
  - `dema/laser-webgpu.html` — pętla do 256 świateł w TSL (`shotLight` na powierzchni,
    `mediumLight` w ośrodku), pociski, wiązka, salwa, iskry w compute, przełącznik A/B,
    proceduralne okręty (`buildShip`), materiał kadłuba;
  - `dema/gazy-webgpu.html` — siatka pola w compute (bufory `instancedArray`, przebieg „out” +
    przebieg kopii), zapis do `StorageTexture` i odczyt w materiale, osobny cel MRT „fx”
    z addytywnym mieszaniem, kamera z góry jak w grze (fov 35°), odwrócone v przy próbkowaniu
    celów renderowania (`mapUV`);
  - `dema/tlo-kosmosu-webgpu.html` — tło (mgławica + gwiazdy), jeśli chcesz ładniejsze niż proste.
  Te trzy pliki ładują three z CDN przez import map — w Twoim demie importy idą przez Vite.
- Atlas: `public/assets/capital_ship_rect_v1.png` (3747×1677, alfa; pod Vite adres
  `/assets/capital_ship_rect_v1.png`), rozmiar kadłuba z `HULL_RENDER_PROFILES.atlas` /
  `getHullRenderSize` w `src/data/ships.js`.

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
- Przykładów HTML three (`webgpu_*`) nie ma w paczce npm — jeśli sieć pozwala, podejrzyj je
  w repozytorium three.js na GitHubie (tag `r183`); jeśli nie, czytaj źródła w `node_modules`.

## Scena

- **Kamera z góry jak w grze** (perspektywa, fov 35°, patrzy prosto w dół — wzór
  `dema/gazy-webgpu.html`), kółko = zoom (od całego Atlasa z wrogami po zbliżenie na łatę
  trafienia), WASD = przesuw kamery.
- **Atlas w środku, nieruchomy:** kwad z tekstury kadłuba (alfa), oświetlony tymi samymi
  światłami co reszta (normalna z luminancji). Materiał kadłuba ma dodatkowo czytać stan pola
  (niżej: „pole świeci na kadłub”).
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

## Panel, statystyki, sterowanie z konsoli

Panel po polsku: pasek HP i stan tarczy (`off` / `activating` / …), przełączniki (pokaż pole,
fale, energia i przebicia, światła, poświata na kadłubie, załamanie, iskry, bloom), suwaki
(prędkość fali, tłumienie, stygnięcie energii, próg przebicia, siła załamania, regeneracja HP,
jakość siatki pola, liczba iskier, moc świateł). Statystyki: FPS, ms CPU, ms GPU, zdarzenia
w klatce, żywe iskry, rozdzielczość siatki.

`window.__demo`: `hit(x, y, dmg, klasa)`, `salvo()`, `beam(x, y, on)`, `setHP(ułamek)`,
`breakShield()`, `toggleShield()`, `lookAt(x, y, zoom)`, `stats()` oraz **`step(n)`** — n klatek
ze stałym dt 1/60 i renderem. Parametr adresu **`?test=1`** wyłącza pętlę animacji (klatki idą
tylko przez `step`) — to jest wejście dla sprawdzania w kontenerze. Dodaj też **widok kontrolny**
`?debug=pole`: tekstura pola jako barwa na czaszy + znacznik w znanym punkcie lokalnym kadłuba
(np. dysk w dziobie) — tym sprawdzisz, że siatka pola, czasza i kadłub się pokrywają
(odwrócone v i odwrócona oś y to najczęstsze błędy, patrz §9).

## Sprawdzanie w kontenerze (tylko poprawność)

Prawdziwego GPU nie ma. WebGPU działa na SwiftShaderze — wolno (klatka ~0,5–2 s), ale
poprawnie (compute, zapis do tekstur, odczyt pikseli):

- Serwer: `npx vite --port 5173 --strictPort` w tle; strona
  `http://localhost:5173/dema/tarcza-webgpu.html?test=1`.
- Przeglądarka: Playwright z globalnej instalacji (`$(npm root -g)/playwright`) i gotowy
  Chromium **`/opt/pw-browsers/chromium`** — **nie uruchamiaj `playwright install`**. Flagi:
  `--headless=new --enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
  --use-webgpu-adapter=swiftshader --enable-unsafe-swiftshader --use-angle=swiftshader`
  (bez `--use-vulkan=swiftshader` urządzenie ginie po pierwszym `submit`). Mały widok
  (np. 800×450), niskie ustawienia na czas testu.
- Skrypt sprawdzający `scripts/tarcza-webgpu-dym.mjs` (commit razem z demem): ładuje stronę,
  czeka na `__demo`, woła `step`, potem po kolei akcje — trafienie każdej klasy, salwa, wiązka
  przez kilka klatek, torpeda, `breakShield`, regeneracja i ponowny rozruch, T (A/B),
  `?debug=pole` — zbiera błędy konsoli i wyjątki (walidacja WebGPU / WGSL = błąd) i zapisuje
  zrzuty do `.tmp/` (katalog w `.gitignore`, zrzutów nie commituj).
- Zrzuty oglądasz sam, żeby wyłapać błędy geometrii i mapowania: tarcza nie nad kadłubem, pole
  odbite, fala w złym miejscu, czarne bryły, NaN w bloomie. **Nie oceniasz na nich wyglądu ani
  wydajności** (SwiftShader) i nie przedstawiasz ich jako dowodu — to robi użytkownik na RTX.
- Uruchom skrypt po każdym etapie od 2 wzwyż; etap jest skończony, gdy przechodzi bez błędów.

## Etapy (commit + push po każdym)

0. Start (wyżej): gałąź, dociągnięcie dem i notatek, `npm ci`, WebGPU na SwiftShaderze.
1. Szkielet: strona pod Vite, `WebGPURenderer` (komunikat, jeśli nie ma WebGPU), `?test=1`
   i `__demo.step`, kamera z góry, tło, Atlas z tekstury z oświetleniem, wrogowie, bloom + tone
   mapping.
2. Tarcza jak w grze na nowym rendererze: encja, `hexGrid` z alfy, profil z `shieldSystem`,
   czasza, model „niewidzialne pole”, stany przez `updateShieldFx`, trafienia przez
   `registerShieldImpact`, HP; skrypt sprawdzający i `?debug=pole`. Od tego miejsca T ma sens.
3. Stan pola w compute (fala, energia, przebicie) + render: przesunięcie, normalne, heksy, barwy.
4. Światła trafień, poświata pola na kadłubie, załamanie.
5. Iskry na powierzchni, pęknięcie na heksy, fronty rozruchu i gaszenia.
6. Bronie i ogień wrogów, panel, statystyki, reszta `window.__demo`; tarcza w tarczę, jeśli
   starczy czasu.
7. Pełny przebieg skryptu sprawdzającego, ostatni push, komunikat (niżej).

Jeśli limit sesji się kończy, dokończ bieżący etap, zacommituj, wypchnij i napisz, co jest
gotowe do testowania, a czego jeszcze brakuje.

## Kiedy gotowe

- Demo startuje przez `npm run dev` pod `/dema/tarcza-webgpu.html`; skrypt sprawdzający
  przechodzi na SwiftShaderze bez błędów walidacji WebGPU / WGSL i bez wyjątków we wszystkich
  akcjach.
- Kod pisany pod budżet 60 FPS w 1920×1080 na RTX przy siatce pola 512, 64 tys. iskier
  i 256 światłach — mierzy użytkownik (statystyki w panelu).
- Wszystko zacommitowane i wypchnięte na gałąź sesji, `git status` czysty; commity dodają tylko
  nowe pliki dema, skrypt sprawdzający (i ewentualnie notatkę w `docs/`).

## Komunikat na koniec (krótko)

Zacznij od **„Gotowe do testowania.”**, potem:
- nazwa gałęzi i jak przetestować lokalnie na Windowsie: `git fetch origin <gałąź>`,
  `git checkout <gałąź>` (albo scalenie do `main`), `npm install`, `npm run dev`, adres strony;
- sterowanie (klawisze, mysz, panel);
- co warto sprawdzić: salwa w jedno miejsce aż do przebicia, wiązka trzymana w jednym punkcie,
  torpeda (wgniecenie i fala przez całą tarczę), B (pęknięcie na heksy) i ponowny rozruch,
  T (A/B), zoom na łatę trafienia (załamanie, poświata na pancerzu);
- co sprawdziłeś w kontenerze (SwiftShader: startuje, akcje bez błędów), czego nie (wydajność
  i wygląd na prawdziwym GPU);
- co jest uproszczone względem gry i znane braki.
