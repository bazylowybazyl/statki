# Prompt (jedna sesja w chmurze): demo WebGPU — nowa tarcza (pole siłowe liczone na GPU)

Pracujesz w **Claude Code w chmurze**: świeży klon repozytorium gry w kontenerze Linux, **bez
prawdziwego GPU**. Kontener znika po sesji — co nie jest zacommitowane i wypchnięte, przepada.
**Wygląd i wydajność testuje użytkownik** lokalnie na Windowsie (RTX); Ty budujesz demo,
sprawdzasz w kontenerze, że działa bez błędów, i na końcu piszesz, że jest gotowe do testowania.

Stan repo: **port gry na WebGPU jest zakończony** (`docs/webgpu/README.md`): gra ma tylko
`WebGPURenderer` i TSL, a obok są działające dema WebGPU — przede wszystkim
`dema/bronie-webgpu.html` (Atlas ze sprite'a gry z mapą uszkodzeń, siatka świateł, silnik cząstek
GPU, 27 broni z gry). Nowe demo stoi na tych klockach.

**Cel:** `dema/tarcza-webgpu.html` — tarcza nowej generacji na kadłubie Atlasa, ostrzeliwana
prawdziwymi broniami z gry. Dzisiejsza tarcza gry (`src/3d/shield3D.js` + materiał TSL
`src/3d/shield3D.tsl.js`) to kopuła dopasowana do obrysu kadłuba z łatami trafień z tablicy
**24** pozycji (`SHIELD_MAX_HITS`), obramówką z fresnela i analitycznymi wstęgami iskier
(`src/3d/shieldImpactFx.js`) — przeniesiona z WebGL 1:1. Nowa tarcza ma być **ośrodkiem**,
a nie naklejką:

1. **stan pola na GPU (compute):** fale rozchodzą się po całej tarczy, nakładają się i odbijają
   od krawędzi; energia trafień nagrzewa pole, rozpływa się i stygnie; długi ostrzał w jedno
   miejsce przegrzewa je aż do **przebicia** — wtedy pociski przechodzą i ranią kadłub;
   liczba trafień nie jest ograniczona do 24;
2. **pole świeci na otoczenie:** każde trafienie jest światłem w siatce świateł, a rozgrzana
   tarcza podświetla kadłub pod sobą;
3. **pole załamuje światło:** to, co za tarczą (kadłub, tło), faluje w miejscach trafień;
4. **iskry ślizgają się po powierzchni** (cząstki GPU przyklejone do czaszy), a pęknięcie
   tarczy rozsypuje ją na heksy.

To pokaz możliwości, nie zmiana gry: nie ruszasz gry, `Core3D` ani istniejących dem.

---

## Zasady

- **Gałąź:** pracuj na gałęzi, którą przydzieliła ta sesja (nie twórz innych, nie pushuj na
  `main`, bez PR, bez force-push). **Commit i push po każdym etapie** (niżej) — kontener może
  zniknąć w każdej chwili, a użytkownik ściąga gałąź do testów. Push: `git push -u origin
  <gałąź>`; przy błędzie sieci ponów kilka razy z rosnącą przerwą. Commituj tylko swoje ścieżki
  (`git add <pliki>`, nigdy `git add -A`).
- **Nowe pliki:** `dema/tarcza-webgpu.html`, `dema/tarcza-webgpu.js`, moduły w
  `dema/tarcza-webgpu/`, skrypt `scripts/webgpu/tarcza-demo.mjs` i opis `docs/webgpu/DEMO-TARCZA.md`.
  Kod gry i innych dem tylko czytasz.
- **Importy z gry i z dema broni:**
  - `shieldSystem.js` — maszyna stanów tarczy i profil obrysu (sam importuje wyłącznie dane
    z `src/data/`). Importuj, nie kopiuj — kształt i czasy mają się zgadzać z grą co do joty.
  - `src/3d/shield3D.tsl.js` — materiał dzisiejszej tarczy (`createShieldNodeMaterial('hull',
    uniforms)`, importuje tylko three) — do uczciwego A/B (niżej). `shield3D.js`
    i `shieldImpactFx.js` ciągną `Core3D` — ich nie importujesz; geometrię czaszy
    (`buildHullShieldGeometry`) i komplet uniformów (`createHullShieldMaterial`) skopiuj
    z komentarzem, skąd są.
  - moduły `dema/bronie-webgpu/` (`hull.js`, `lightGrid.js`, `surfaceLighting.js`, `gpuFx.js`,
    `projectiles.js`, `beams.js`, `gunnery.js`, `recipes.js`, `arsenal.js`, `trails.js`,
    `fxLights.js`, `sky.js`, `noise.js`) — importuj wprost. Jeśli któryś trzeba zmienić (np.
    pocisk ma najpierw sprawdzić tarczę), **skopiuj go do `dema/tarcza-webgpu/`** z notką
    „kopia z dema/bronie-webgpu/<plik> @ <commit>” i zmieniaj kopię — demo broni zostaje
    nietknięte.
- Bez nowych zależności w `package.json`. Komentarze i teksty w UI po polsku.
- Demo pod Vite (`npm run dev`), importy gołe (`three/webgpu`, `three/tsl`, `three/addons/...`),
  obrazy przez import modułu jak w `dema/bronie-webgpu.js`. Bez CDN (Vite wysyła
  `Cross-Origin-Embedder-Policy: require-corp`).
- **Zasady renderu gry obowiązują i w demie** — `agents.md` § „Render: WebGPU + TSL”
  i `docs/webgpu/PLAN.md` §3: graf węzłów RAZ na rodzaj, wartości per obiekt; addytywne
  przezroczyste siatki z `forceSinglePass: true`; kernele klatki w jednym
  `renderer.compute(lista)`; rozgrzewka pipeline'ów przed pierwszym strzałem (`compileAsync`),
  żeby pierwsza torpeda nie zamroziła strony; `highPrecision = true`; kolor jak w grze (ACES
  i sRGB w poście — `acesGame` z `dema/bronie-webgpu/surfaceLighting.js` /
  `src/3d/tsl/kolorGry.js`).
- **Model „niewidzialne pole” zostaje domyślnym wyglądem** (decyzja użytkownika, opis
  w `shield3D.js` przy `resolveHullFieldPhase`): w normalnej pracy tarczy nie widać; zdradza ją
  trafienie, rozruch, gaszenie, pęknięcie i puls przy niskim HP (< 35%). Stałą widoczność pola
  daj tylko jako przełącznik „pokaż pole” w panelu.
- **Kształt i stany z gry:** obrys z `getEntityShieldProfile` / `sampleShieldProfileRadius`,
  przejścia stanów przez `updateShieldFx` (off → activating → active → deactivating / breaking),
  trafienia przez `registerShieldImpact(encja, x, y, obrażenia, klasa)` z klasami `pd`, `main`,
  `special`, `shield`. Barwa jak w grze: pełne HP `#5992f7`, puste — `SHIELD_EMPTY_COLOR`,
  pęknięcie — `SHIELD_BREAK_COLOR`.
- HDR-first: emitery > 1.0, bloom z `BLOOM_DEFAULTS` (`src/3d/bloomConfig.js`). Bez `pow()`
  z ujemną podstawą, clamp tam, gdzie NaN rozlałby się przez bloom. Zero alokacji w pętli klatki.
- Zatrzymaj się i napisz do użytkownika tylko wtedy, gdy nie da się zainstalować zależności
  (brak sieci do rejestru npm — to ustawienie środowiska w chmurze), WebGPU nie startuje nawet
  na SwiftShaderze (niżej) albo trafisz na blokadę bez obejścia. Poza tym pracuj samodzielnie.

## Przeczytaj najpierw

- `agents.md` (§ „Render: WebGPU + TSL”, precyzja, alokacje), `docs/webgpu/README.md`,
  `docs/webgpu/PLAN.md` §3 (konwencja modułów i **pułapki three r183 z zadań portu**),
  `docs/webgpu/USTALENIA.md` §8–§9 (WebGPU w kontenerze, pułapki TSL z pierwszych dem).
- **Demo broni — fundament:** `docs/webgpu/DEMO-BRONIE.md` (moduły, pule GPU, sterowanie),
  `dema/bronie-webgpu.js` (szkielet: renderer, rozgrzewka, pętla, panel, `window.__demo`),
  `dema/bronie-webgpu/hull.js` (`FxHull`: kwad kadłuba, pole odległości, mapa uszkodzeń
  `stamp(...)`, `raycast`, `toLocal` / `toWorld`), `gunnery.js` + `projectiles.js` + `beams.js`
  (jak pocisk i wiązka szukają trafienia — tu wstawisz test tarczy), `lightGrid.js`,
  `gpuFx.js`, `scripts/webgpu/bronie-demo.mjs` (narzędzie testowe — wzór dla Twojego).
- **Dzisiejsza tarcza:** `src/3d/shield3D.js` (geometria czaszy `buildHullShieldGeometry`:
  192 kroki kątowe × pierścienie `HULL_RADIAL_T`, wysokość `h·(1−t²)^0.62`, krawędź na z = 0,
  `y3d = −y_grid`; `createHullShieldMaterial` — uniformy; `resolveHullFieldPhase` — fala
  rozruchu 0→1,2, dopalenie 0,42 s; `SHIELD_FIELD_TUNING`; `SHIELD_DOME_MIN_PX`),
  `src/3d/shield3D.tsl.js` (graf na wariant, trafienia w jednej `uniformArray` pakowanej
  w `onObjectUpdate`), `src/3d/shieldImpactFx.js` (`PRESETS` klas trafień — punkt wyjścia dla
  iskier), `shieldSystem.js` (stany i czasy, `registerShieldImpact`, `buildShieldProfile`,
  `getEntityShieldRadiusTowards`, `setEntityShieldForcedOff`; **`shieldSystem` nie odejmuje
  HP — robi to wywołujący**), `docs/webgpu/zadania/14-tarcze.md` (jak tarcze przeszły port).
- Wzorce pól w compute i załamania: `dema/gazy-webgpu.html` (siatka pola w buforach +
  `StorageTexture`, odwrócone v celów renderowania — `mapUV`), `dema/laser-webgpu.html`.

## Scena

- Szkielet i wygląd jak demo broni: kamera z góry jak w grze, tło z `sky.js`, **Atlas jako
  `FxHull`** (sprite gry, siatka świateł, mapa uszkodzeń) w środku, nieruchomy. Kółko = zoom
  (od całej sceny po zbliżenie na łatę trafienia), WASD = przesuw kamery.
- **Napastnicy:** piracki okręt z dema broni (jeden albo dwa) i drony z `drones.js` — strzelają
  w Atlasa bronią wybraną w panelu. Jeden pirat dostaje własną tarczę-obrys (tą samą drogą
  co Atlas) — do zderzenia tarcza–tarcza.
- **Encja tarczy w konwencji gry:** `{ x, y, angle, type, visual: { spriteScale },
  hexGrid: { shards }, shield: { val, max, … } }`, współrzędne gry (y w dół), render
  w 3D z `y3d = −y`. `hexGrid.shards` zbuduj raz z kanału alfa sprite'a (komórki co ~12 px
  sprite'a, gdzie alfa > 0,5; `origLx`, `origLy` względem środka, y w dół; `radius` = pół
  odstępu) — wtedy `getEntityShieldProfile(encja)` daje **ten sam obrys co w grze**; sprawdź,
  że `maxR` ≈ pół długości kadłuba + odstęp i że obrys leży na `FxHull` (widok kontrolny niżej).

## Nowa tarcza (główny pokaz)

### A. Stan pola na GPU

- Siatka w **płaszczyźnie kadłuba** (klatka lokalna Atlasa, widok z góry), prostokąt obejmujący
  obrys z marginesem, ~512 komórek na dłuższy bok (suwak 256–1024). Komórki poza obrysem
  (`r > r(θ)`) to brzeg. Siatka kartezjańska — laplasjan izotropowy, fala nie rozciąga się przy
  krawędzi.
- Pola (bufory storage + `StorageTexture` rgba16f do odczytu w materiałach):
  - **fala** `h`, `dh/dt` — równanie falowe z tłumieniem, prędkość w j./s (suwak), odbicie od
    krawędzi obrysu, krok stały (np. 1/240 s, tyle kroków na klatkę, ile trzeba; pilnuj CFL);
  - **energia / obciążenie** `E` — trafienie dokłada energię ∝ obrażeniom, `E` rozpływa się
    (dyfuzja) i stygnie; steruje jasnością i barwą (chłodny błękit → biel → pomarańcz przy
    przeciążeniu);
  - **przebicie** `B` — rośnie tam, gdzie `E` długo przekracza próg (suwak), maleje poniżej
    ~60% progu. W przebiciu dziura z migoczącym, rozżarzonym brzegiem.
- **Zdarzenia trafień** z CPU co klatkę, do ~256 (pozycja lokalna, siła, promień, klasa);
  wiązka ciągła = źródło działające co krok. Rozruch i gaszenie (front jak
  w `resolveHullFieldPhase`) też wstrzykują pierścień fali — pole „budzi się” z drgnięciem.
- **Pociski i wiązki najpierw w tarczę:** w kopii `projectiles.js` / `beams.js` / `gunnery.js`
  test tarczy przed kadłubem, jak w grze (promień w kierunku pocisku —
  `getEntityShieldRadiusTowards`, tarcza blokuje od progu `SHIELD_BLOCKING_ACTIVATION_THRESHOLD`).
  Trafienie w tarczę: zdarzenie pola + `registerShieldImpact` + `val −= obrażenia` + efekty
  na tarczy zamiast rany. **Przebicie:** mała mapa `B` (np. 64×64) czytana asynchronicznie na CPU
  co ~100 ms; pocisk w przebitą komórkę leci dalej i robi ranę w `FxHull` (`stamp`) — tak samo,
  gdy tarcza jest zgaszona albo pęknięta.
- HP: regeneracja z suwaka, stany przez `updateShieldFx(encja, dt)` co klatkę. Niskie HP
  (< 35%): pole migocze, fale słabsze.

### B. Render czaszy

- Geometria jak `buildHullShieldGeometry`, gęstsza (np. 384 kroki × 24 pierścienie), raz
  z profilu. W vertex shaderze przesunięcie wzdłuż normalnej o `h` (tekstura pola z `.level(0)`),
  normalna z gradientu `h` — fresnel, połysk i załamanie reagują na fale.
- Wygląd z modelu „niewidzialne pole”: krycie i emisja z `E`, `|h|`, frontów rozruchu/gaszenia,
  pulsu niskiego HP i przełącznika „pokaż pole”. Heksy (plaster miodu w płaszczyźnie kadłuba,
  komórka ~5% `maxR`) zapalają się tam, gdzie przeszła fala albo leży energia — każda komórka
  z własnym, losowym opóźnieniem i migotaniem, krawędzie jaśniejsze.
- **Załamanie:** `viewportSharedTexture` przesunięte o gradient `h` × `E` (suwak), lekka
  dyspersja barw; gdzie pole niewidoczne — zero załamania.
- Emisja HDR (bloom łapie rdzenie trafień i brzegi przebić).

### C. Pole świeci na otoczenie

- Każde trafienie w tarczę = światło w siatce świateł dema broni (`lightGrid.js` /
  `fxLights.js`) — oświetla kadłub Atlasa, pirata i drony; wiązka = mocne, stałe światło
  w gorącym punkcie.
- **Poświata pola na kadłubie:** materiał `FxHull` (w kopii `hull.js`, jeśli trzeba) czyta
  teksturę pola w swojej pozycji lokalnej i dodaje emisję ∝ `E` + |fala| w barwie tarczy —
  kadłub pod rozgrzaną łatą błękitnieje, fala przebiega po pancerzu jak odbicie.

### D. Iskry na powierzchni (GPU)

- Na silniku `gpuFx.js` (nowa pula albo nowy rodzaj w istniejącej): cząstki **ślizgają się po
  czaszy** — prędkość styczna, pozycja co krok rzutowana na wysokość czaszy z profilu, tarcie;
  mniejszość odlatuje wzdłuż normalnej. Smugi wzdłuż prędkości, addytywnie, HDR, barwa tarczy
  → biel w rdzeniu. Liczby na klasę z `PRESETS` w `shieldImpactFx.js`, przeliczone na nowy efekt.

### E. Stany

- **Rozruch** (`activating`, czas z `ACTIVATION_SPEED`): front od środka ku obrysowi „maluje”
  pole i wstrzykuje falę; **gaszenie** (`deactivating`, klawisz O przez
  `setEntityShieldForcedOff`): front wraca do środka, pole zapada się w sobie.
- **Pęknięcie** (`breaking`, `val` = 0): czasza rozpada się na heksy — fragmenty na GPU
  (kilka tysięcy heksów z siatki czaszy) lecą od ostatniego trafienia i na zewnątrz, obracają
  się i gasną w ~1,2 s; błysk + światło. Potem `off`, regeneracja, ponowny rozruch po progu
  z `shieldSystem`.

### F. Tarcza w tarczę (opcjonalnie, jeśli starczy czasu)

- Klawisz K: pirat z tarczą podpływa do Atlasa, tarcze się nachodzą. Wzdłuż krzywej przecięcia
  pól co krok odkłada się energia (pas interferencji na OBU tarczach), iskry klasy `shield`,
  okręty lekko się odpychają.

## A/B — uczciwy punkt odniesienia

Klawisz **T** przełącza między **tarczą z gry** (materiał z `src/3d/shield3D.tsl.js` na
skopiowanej geometrii, trafienia podawane tak jak `shield3D.js` — do 24 łat, wstęgi iskier
w uproszczeniu albo wcale) a **nową tarczą**. Stan tarczy (HP, stany, przebicia w gameplayu
dema) jest wspólny — zmienia się tylko obraz.

## Sterowanie

- Panel broni jak w demie broni (grupy PD / S / M / L / Capital, lista z `arsenal.js`) —
  wybrana broń strzela z pirata w Atlasa. Szybkie klawisze: **1** CIWS (`pd`), **2** Tempest
  (`main`), **3** railgun / Yamato (`special`), **4** wiązka ciągła.
- **LPM** — strzał w punkt kursora na tarczy; **PPM** — wiązka trzymana w kursorze;
  **Spacja** — salwa wszystkich napastników; **E** — ogień automatyczny wł./wył.
- **O** tarcza wł./wył., **B** pęknięcie (HP → 0), **R** pełne naładowanie, **K** tarcza
  w tarczę, **T** A/B, **P** iskry, **H** panel.
- Panel po polsku: pasek HP i stan tarczy, przełączniki (pokaż pole, fale, energia i przebicia,
  światła, poświata na kadłubie, załamanie, iskry, bloom), suwaki (prędkość fali, tłumienie,
  stygnięcie energii, próg przebicia, siła załamania, regeneracja HP, jakość siatki pola, liczba
  iskier). Statystyki: FPS, ms CPU, ms GPU, zdarzenia pola w klatce, żywe cząstki, siatka.
- `window.__demo`: `hit(x, y, dmg, klasa)`, `fire(broń)`, `salvo()`, `beam(x, y, on)`,
  `setHP(ułamek)`, `breakShield()`, `toggleShield()`, `setAB(nowa)`, `lookAt(x, y, zoom)`,
  `stats()`, **`step(n)`** (n klatek ze stałym dt 1/60 i renderem) i `S.ready`. Parametr
  **`?test=1`** wyłącza pętlę animacji (klatki tylko przez `step`); **`?debug=pole`** — widok
  kontrolny: tekstura pola jako barwa na czaszy + znacznik w znanym punkcie lokalnym kadłuba
  (np. dysk w dziobie) — sprawdza, że siatka pola, czasza i `FxHull` się pokrywają (odwrócone v
  i odwrócona oś y to najczęstsze błędy).

## Sprawdzanie w kontenerze (tylko poprawność)

Harness portu (`scripts/webgpu/wspolne.mjs` → `startChrome`) szuka `chrome.exe` i działa tylko na
Windowsie. W kontenerze jest Chromium **`/opt/pw-browsers/chromium`** i WebGPU na SwiftShaderze —
wolno (klatka ~0,5–2 s), ale poprawnie (compute, zapis do tekstur, odczyt pikseli).
**Nie uruchamiaj `playwright install`.**

- `scripts/webgpu/tarcza-demo.mjs` w stylu `bronie-demo.mjs` (tryby `--tryb test` i
  `--tryb zrzuty`, wyniki do `.tmp/tarcza-webgpu/`, katalog w `.gitignore`): `startVite`,
  `attachLogs`, `waitFor`, `evaluate`, `screenshotPng` z `wspolne.mjs`; przeglądarka —
  jeśli istnieje `/opt/pw-browsers/chromium`, własny starter w skrypcie (ten sam CDP co
  `startChrome`, zwraca `{ cdp, logs, close }`) z flagami `--headless=new --enable-unsafe-webgpu
  --enable-features=Vulkan --use-vulkan=swiftshader --use-webgpu-adapter=swiftshader
  --enable-unsafe-swiftshader --use-angle=swiftshader` (bez `--use-vulkan=swiftshader`
  urządzenie ginie po pierwszym `submit`); w przeciwnym razie `startChrome` z `wspolne.mjs`
  (Windows, prawdziwe GPU — użytkownik odpali go u siebie). `wspolne.mjs` nie zmieniaj.
- Tryb `test`: strona z `?test=1`, mały widok (np. 800×450), niskie ustawienia; `step`, potem po
  kolei: trafienie każdej klasy, salwa, wiązka przez kilka klatek, railgun, ostrzał w jedno
  miejsce do przebicia i pocisk przez przebicie, `breakShield`, regeneracja i ponowny rozruch,
  T (A/B), `?debug=pole`. Błędy konsoli, walidacji WebGPU / WGSL i wyjątki = błąd testu.
- Zrzuty oglądasz sam, żeby wyłapać błędy geometrii i mapowania: tarcza nie nad kadłubem, pole
  odbite, fala w złym miejscu, czarne bryły, NaN w bloomie. **Nie oceniasz na nich wyglądu ani
  wydajności** (SwiftShader) i nie przedstawiasz ich jako dowodu — to robi użytkownik na RTX.
- Uruchamiaj po każdym etapie od 2 wzwyż; etap jest skończony, gdy test przechodzi bez błędów.

## Etapy (commit + push po każdym)

0. Gałąź sesji, czyste drzewo; `npm ci`, jeśli nie ma `node_modules`; pusta strona z jednym
   przebiegiem compute i jednym renderem przez starter SwiftShadera — zanim napiszesz resztę.
1. Szkielet na klockach dema broni: strona pod Vite, renderer i rozgrzewka, kamera, tło, Atlas
   (`FxHull`), pirat, drony, siatka świateł, bloom i kolor jak w grze; `?test=1` i `step`.
2. Tarcza z gry na nowym szkielecie: encja, `hexGrid` z alfy, profil z `shieldSystem`, geometria,
   materiał z `shield3D.tsl.js`, stany przez `updateShieldFx`, pociski najpierw w tarczę, HP;
   skrypt `tarcza-demo.mjs` i `?debug=pole`. To jest strona A dla przełącznika T.
3. Nowa tarcza: stan pola w compute (fala, energia, przebicie) + render (przesunięcie, normalne,
   heksy, barwy), pociski przez przebicie.
4. Światła trafień w siatce, poświata pola na kadłubie, załamanie.
5. Iskry na powierzchni, pęknięcie na heksy, fronty rozruchu i gaszenia.
6. Panel broni i sterowanie, statystyki, reszta `window.__demo`, `docs/webgpu/DEMO-TARCZA.md`
   (w stylu `DEMO-BRONIE.md`: moduły, co jest kopią czego, sterowanie, uruchomienie); tarcza
   w tarczę, jeśli starczy czasu.
7. Pełny przebieg `tarcza-demo.mjs --tryb test`, ostatni push, komunikat (niżej).

Jeśli limit sesji się kończy, dokończ bieżący etap, zacommituj, wypchnij i napisz, co jest
gotowe do testowania, a czego jeszcze brakuje.

## Kiedy gotowe

- Demo startuje przez `npm run dev` pod `/dema/tarcza-webgpu.html`; `tarcza-demo.mjs --tryb test`
  przechodzi na SwiftShaderze bez błędów walidacji WebGPU / WGSL i bez wyjątków.
- Kod pisany pod budżet 60 FPS w 1920×1080 na RTX przy siatce pola 512, pełnej puli cząstek
  dema broni i salwie Capital — mierzy użytkownik (statystyki w panelu, `tarcza-demo.mjs` na
  Windowsie).
- `npm test` i `node --test tests/graBezGlsl.test.mjs` przechodzą jak przed zmianą — demo nie
  może wejść w graf importów gry (strażnik „gra bez GLSL”).
- Wszystko zacommitowane i wypchnięte na gałąź sesji, `git status` czysty.

## Komunikat na koniec (krótko)

Zacznij od **„Gotowe do testowania.”**, potem:
- nazwa gałęzi i jak przetestować lokalnie na Windowsie: `git fetch origin <gałąź>`,
  `git checkout <gałąź>` (albo scalenie do `main`), `npm install`, `npm run dev`, adres strony;
  opcjonalnie `node scripts/webgpu/tarcza-demo.mjs --tryb test` na prawdziwym GPU;
- sterowanie (klawisze, mysz, panel broni);
- co warto sprawdzić: salwa w jedno miejsce aż do przebicia i pocisk ranią kadłub, wiązka
  trzymana w jednym punkcie, railgun (wgniecenie i fala przez całą tarczę), B (pęknięcie na
  heksy) i ponowny rozruch, T (A/B z tarczą z gry), zoom na łatę trafienia (załamanie, poświata
  na pancerzu);
- co sprawdziłeś w kontenerze (SwiftShader: startuje, akcje bez błędów), czego nie (wydajność
  i wygląd na prawdziwym GPU);
- co jest kopią z dema broni, co uproszczone względem gry i znane braki.
