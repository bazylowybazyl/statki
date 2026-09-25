# BRIEF: Warp — hipercruise, skok-duch, efekty „Fałda”, przyloty i wezwania

> Dokument roboczy przebudowy napędu warp (2026-09-25). Samodzielny: nie zakłada
> znajomości rozmów. Numery linii są orientacyjne (`index.html` edytuje kilka
> sesji naraz) — szukaj po nazwie funkcji.

**Stan (2026-09-25): M1 (wyjście) i widok skoku z M3 (soczewka świata
w kropli, wyjście frontem) zrobione w demie, nic nie jest wpięte do gry.**
- `src/3d/warpWorldLens.js` — soczewka świata: `mapWorldLens` ustawia ciało po
  KRAWĘDZI BLIŻSZEJ STATKOWI: odstęp g = m + (B − m)·dₛ/(dₛ + L) (dₛ — do
  powierzchni, B — brzeg kropli w kierunku ciała, m — kadłub statku + odstęp),
  wielkość s = r·K/(d + d0)·mijanie, środek w g + s. Tarcza nigdy nie wjeżdża pod
  statek przed wyjściem (user: „spadasz na Jowisza, bo przesuwasz go pod statek,
  a nie trzymasz przed”; start „leci nad Ziemię”). L osobne: przed dziobem krótka
  (45 tys. — cel wisi wysoko aż do podejścia), z boku 220 tys., za rufą 90 tys.;
  mijanie: ciało z boku do ~2× większe (sin² kąta, maleje z odległością) i zgina
  tło wokół siebie (POINT w passie soczewki, `gravityLens`). Za rufą planeta,
  która zmieści się w ogonie, jest w nim CAŁA („dopiero pokażesz ją całą”);
  przed dziobem cel wystaje za krawędź i rośnie. Przejście β: odstęp liniowo,
  wielkość w logarytmie. `WarpWorldLens.update` nakłada to na encje planet PO
  `updatePlanets3D` (pozycja, skala, światło z prawdziwego kierunku słońca)
  + zasłona na tło. Testy: `tests/warpWorldLens.test.mjs`.
- Świat razem z TŁEM zwija się w **kroplę** wokół statku (user: „zamiast koła
  kropla” — cel mieści się wyżej): wypukła otoczka bańki z przodu i ogona za
  rufą (`warpDropGeometry` / `warpDropExit` w `warpLens3D.js`, lustro GLSL
  `wvDropExit`, uniform `uWVDrop`). Pass soczewki (`Core3D.setWarpViewWorld`
  z `drop`): promień piksela dzielony brzegiem kropli w jego kierunku — w kropli
  mgławica przez rybie oko (ścisk ≤ ~7×), na zewnątrz opływ (przepływ wokół
  walca liczony w układzie, w którym kropla jest kołem, dwie fazy flow mapy
  z fazą całkowaną na CPU). Przy β = 0 kropla obejmuje rogi kadru, przy β = 1
  dłuższy koniec sięga ~93% kadru wzdłuż osi lotu (`warpHorizonPx`). Stroiwo:
  `WarpWorldLens.view` (`WARP_VIEW_DEFAULTS`: dropFront/Back/Bulb/Tail).
- **Rozpęd przed skokiem = „dolly zoom”** (user: Ziemia ogromna ma stać przy
  krawędzi kadru i maleć powoli, „aż kopniesz”): `update({ bodyZoom, bodyBeta })`
  — zwykły widok ciał oddalony wokół statku o bodyZoom = dₛ₀/dₛ (krawędź planety
  startu stoi w miejscu, planeta maleje), ciała wchodzą w soczewkę dopiero przy
  kopnięciu (bodyBeta), tło zgina się już w rozpędzie (beta 0,32).
- **Gwiazdy = PRAWDZIWE gwiazdy gry** (user: fejkowe gwiazdy „osadzały się”
  w rzeczywistości przy wyjściu sztucznie). `StarSystem` z `planet3d.assets.js`
  idzie z tłem przez pass soczewki i rozciąga się sam (czyta `window.warp`:
  `active` od skoku do przejścia frontu przez statek). `_capStarParallax`
  ogranicza prędkość wzoru (wirtualna kamera gwiazd ≤ `starSpeedCap`
  14 tys. j/s — paralaksa 1,35× przy prędkości skoku to szum), trwale zostawia
  przesunięcie (bez skoku wzoru na końcu), w widoku skoku podbija wielkość,
  rozciągnięcie i jasność, a „bicz” gwiazd gry przy warp → idle przygasza
  (`starWhipCut` — jedna jasna gwiazda ciągnęła smugę przez pół kadru).
- **Wyjście = front od dziobu ku rufie** (user: statek nie może „spaść” do
  rzeczywistości — ta ma się wyprostować przed nim; wyjście dłuższe). Front
  w promieniach kuli wzdłuż osi lotu (`front`, pas ±`frontBand`): przed nim
  zwykły widok. Tło per piksel (`uWVFront` w passie soczewki, lustro CPU
  `sweepBeta`). Ciała: β z punktu stałego na POZORNYM położeniu
  (`solveSweepBodyBeta`, punkt tarczy najbliższy statkowi — `bodyFrontEdge` −1,
  ciągłość z poprzedniej klatki, przeskok wygładzony `bodyBetaK`/`bodyBetaRate`)
  — cel wiszący przed dziobem „wjeżdża” pod statek, gdy front dojdzie pod dziób
  (w ~0,6 s przy zatrzymaniu, user: „nagle się na końcu powiększyć”; punkt
  docelowy ma być pod statkiem), a ciała za rufą jadą na pasie frontu za kadr
  (liczone z prawdziwego położenia: cel znikał na starcie frontu, a Mars/Ziemia
  siedziały w kuli do końca i znikały skokiem).
  Zasłona, podbicie gwiazd i shadow shafts idą za `screenBeta` (najsilniejsza
  soczewka w kadrze) — wracają razem z frontem; shafty wygaszane stopniowo
  (`Core3D.suppressShadowShafts(amount)`, `uShaftGain`), bo cień z prawdziwego
  słońca kładł się klinem na przestawione planety.
- Demo, scena 4 (~20 s): Atlas od Ziemi do Jowisza. Rozpęd 2,6 s (hipercruise
  do 4 tys. j/s, ładowanie skoku, Ziemia trzymana przy krawędzi) → kopnięcie
  1,1 s do ~225 tys. j/s (soczewka ciał w 0,7 s) → przy Marsie (70 tys. j. od
  kursu) „grawitacja”: prędkość spada do ~38% w pasie ±60 tys. j. wokół punktu
  mijania (zależne od MIEJSCA na kursie), potem znowu szybko → hamowanie 3,2 s
  z wyhamowaniem (v ~ (1 − u)²) → front startuje 2,1 s przed zatrzymaniem,
  przechodzi kadr w 4,2 s i mija statek, gdy ten staje (wtedy wyrzut, żar
  kadłuba, trzask gwiazd; front mijający statek w ruchu zostawiał wyrzut za
  rufą). Położenie z tablicy (całkowanie co 1/240 s), prędkość przelotu dobrana
  siecznymi, żeby statek stanął w P1. Stroiwo: `TRAVEL` w `dema/warp-demo.js`,
  `WarpWorldLens.params` (K = 600, d0 = 30 tys., passBoost 1,1, aberracja 0,55).
  Uwaga: na końcu księżyc Jowisza bywa tuż przy statku i cienie shadow shafts
  gry (tarcze) przyciemniają kadłub — to istniejące cienie, nie warp.
- Pomysł usera na później (M5): **widok podejścia w hipercruise** — lekka soczewka
  (β < 1) przy zbliżaniu do planety z ringiem; gra zna docelowy port, więc obraca
  planetę (tarcza jest 3D), żeby port był od strony podejścia, powiększa ją
  i przechodzi β → 0 do zwykłej kamery nad dachem doku.
- `src/game/warpDrive.js` — oś czasu przylotu + plan floty (testy: `tests/warpDrive.test.mjs`).
- `src/3d/warpFx3D.js` — render przylotu: glify (szew, poświata, pierścień, fala
  dziobowa, smuga anamorficzna — 1 draw call), smuga sylwetki, cząstki z `Fx3D`,
  żar brzegu kadłuba (`heatHullForWarp`), zgłoszenia zgięcia tła i fal.
- `src/3d/warpLens3D.js` + `core3d.js` — prymitywy zgięcia tła
  (`Core3D.pushWarpSpaceWorld`, POINT/SEAM/RING, do 16) w passie soczewki
  i fale w uberPassie (`Core3D.pushWarpWaveWorld`, pierścień/szew, do 8).
  Soczewka skoku gracza działa jak dawniej (testy: `tests/warpSpace.test.mjs`,
  `tests/warpLens3D.test.mjs`).
- `dema/warp-demo.html` — sceny: przylot okrętu (pętla), wezwanie floty (klik),
  zasadzka piratów; oś z przewijaniem, ×0,25, przełączniki warstw.
- Uwagi usera po pierwszym oglądaniu (2026-09-25): „w miarę spoko”, ale świecących
  okręgów za dużo — psuły efekt. Zwiastun bez pierścieni (punkt + ściągane światło +
  jedna przezroczysta fala dla większych okrętów), fala uderzeniowa i fala dziobowa
  WYŁĄCZNIE jako przezroczyste zakrzywienie, bez białego obramowania (uberPass:
  pierścień i łuk, `pushWarpWaveWorld` typ 0/2).
- Lekcje ze strojenia: duża powierzchnia nad progiem bloomu gry (0,9) = biała
  plama na pół ekranu — nad progiem tylko cienkie linie (rdzeń szwu ≤ ~6 px,
  zwężony ku końcom) i krótki błysk; poświata glifu musi zgasnąć przed brzegiem
  quada (inaczej widać prostokąt); samo zgięcie tła na ciemnym niebie prawie
  niewidoczne — czyta się na mgławicy, więc „zginanie” niosą też fale przez
  kadłuby, pył i smugi ściągane do punktu.

## 0. Zasady pracy

1. Najpierw `AGENTS.md`: jeden renderer (Core3D), gameplay w 2D, bez alokacji
   w gorących pętlach, stałe „na krok” tylko przez `stepDecay120`/`ticksAt120`,
   pozycje świata na GPU względem `sceneOrigin`, UTF-8, TODO z prefiksem `AGENT:`.
2. Nie uruchamiać podglądu gry — user testuje gameplay sam. Weryfikacja:
   `npm test`, `node --test tests/*.test.mjs` (8 znanych porażek na HEAD) i build
   gry przez tymczasowy config w scratchpadzie (`npm run build` pada na
   brakującym `AISPACE.html`). Shadery sprawdzać w headless Chrome (CDP).
3. Kilka sesji edytuje drzewo naraz: commit tylko własnych hunków.
4. Efekty sypać z istniejących pul (`Fx3D`, `SparkSystem3D`), nie z własnych.

## 1. Decyzje usera (2026-09-25)

- Obecny warp (biegi 10k/20k/35k/55k/80k j/s × mnożnik strefy) dzielimy:
  **biegi I–II → hipercruise**, **biegi III–V → warp**.
- Warp **pomija wszystko** (destruktor nie obsługuje zderzeń przy takich
  prędkościach) i jest **lotem-duchem w świecie**: statek naprawdę leci przez
  układ, ze sterowaniem, ale bez kolizji, trafień i celowania.
- W warpie świat ma być widowiskiem: Ziemia maleje za rufą, Mars rośnie
  z oddali, przy mijaniu jest prawie pełnej wielkości i znowu maleje; potem
  kolejne planety i inne warte pokazania rzeczy. Planety mogą żyć w osobnym
  „świecie” (osobnym passie) — patrz §4.3.
- Hipercruise **bez rozciągania gwiazd**. Obecny wizual warpa (rozciąganie
  gwiazd + soczewka tła) jest do wymiany.
- Sterowanie: tapnięcie Shift = hipercruise I → II, Ctrl = bieg w dół / wyjście,
  przytrzymanie Shift = ładowanie warpa (cel z CIC albo pod kursorem); przy
  planetach Shift zostaje dopalaczem.
- Wezwania jak w Star Wars: Empire at War — na razie **sam efekt**, koszt,
  cooldown i ekonomia później (z produkcją bazy gracza).
- NPC i wrogowie będą warpować — efekt wyjścia jest wspólny dla wszystkich.
- Najpierw demo: ładowanie, podróż, wyjście; zaginanie przestrzeni i heat haze.

## 2. Stan zastany (sprawdzony w kodzie 2026-09-25)

- Warp gracza: obiekt `warp` w `index.html` (`state: idle|charging|active`,
  ładowanie 0,8 s, `gearSpeeds`, `W` = bieg w górę), fizyka w gałęzi
  `if (warp.state === 'active')` w `physicsStep`: prędkość co krok dociągana do
  `warp.speed × zoneState.current.warpMultiplier` (×2 strefa międzyplanetarna,
  ×0,3 planety/pas/słońce), `ship.angVel = 0`. Wejście w studnię grawitacyjną
  (`planet_gravity`, `pirate_gravity`, `sun`) → `triggerGravityWarpBrake`.
- **W warpie działa wszystko**: gracz jest pierwszy na liście destruktora,
  asteroidy (test statyczny, obrażenia ~v² kalibrowane na v = 200), pociski
  (proxy gracza w siatce), celowanie AI, CIWS. Destruktor nie clampuje prędkości
  zderzenia, zamiatanie dużych kadłubów ma max 2 próbki na krok; przy 160k j/s
  statek robi 1333 j. na krok 120 Hz.
- Autopilot warpa: `cruiseNav` + `updateWarpCruiseAutopilot` omija studnie planet
  (tylko planety), `warp.turnRate` π/5 rad/s.
- Wizual: `StarSystem` w `src/3d/planet3d.assets.js` (rozciąganie, „exit whip”),
  soczewka tła `src/3d/warpLens3D.js` + `src/vfx/warpLensPass.js` (tylko strefa
  z `wormholeVfx`), plazma WARP z dysz MAIN (`warpPlume3D.js`), przy wyjściu
  `spawnShockwave` (pierścień 2D na kanwie) i wstrząs kamery.
- NPC: jedyny przylot z warpa to `spawnPirateHeavyFleet` (`state:
  'warping_in'`, 4000 j/s ~1 s, `isCollidable = false`, AI pominięte, na końcu
  pierścień 2D). Bramy: `phase === 'warping'`, tylko plazma i snap pozycji.
- Wezwania: Rezerwa (Alt) w `cockpitUI.js` → `spawnSupport` →
  `window.spawnCallInShip` → natychmiastowy spawn w punkcie upuszczenia (kapitały
  bez punktu: 1 AU przed graczem). Bez efektu, kosztu i cooldownu.
- Zasoby do użycia: uberPass w `core3d.js` (24 źródła heat haze: dysza
  kierunkowa albo plama izotropowa), `Fx3D` (łuki, iskry, poświata, dym),
  kanał żaru heksów (`addShardHeat`, `heatDecay` 0,35: biel ~1 s, pomarańcz
  ~2,3 s, wiśnia ~5 s), `camera.addShake`. Refrakcyjna fala 3D
  (`Shockwave3DManager`) zarezerwowana dla supernowej — pilnuje test.
- Planety: zwykłe w passie perspektywicznym na z = −50 000 (dlatego mają
  paralaksę), Ziemia i Mars (`RING_PLANET_NAMES`) w passie ortho na z = 0.

## 3. Mechanika

### 3.1 Drabina prędkości

| | napęd | hipercruise | warp |
|---|---|---|---|
| prędkość | tryb bojowy/manewrowy | I–II: 10k/20k × strefa | III–V: 35k/55k/80k × strefa |
| świat | pełna fizyka | w świecie, kolizje aktywne | duch: poza kolizjami i celowaniem |
| wejście | — | tap Shift | przytrzymanie Shift (ładowanie) |
| w trakcie | — | tap Shift = bieg w górę, Ctrl = w dół/wyjście, A/D skręt | W / tap Shift = bieg w górę, Ctrl = w dół, A/D skręt, autopilot do celu |
| wyjście | — | Ctrl, blokada masy, studnia | cel, studnia celu, Ctrl na III |

W strefach planet (`isPlanetOrbitZoneId`) Shift zostaje dopalaczem, hipercruise
jest zablokowany.

### 3.2 Hipercruise

- Rozruch ~1–1,5 s na bieg (plazma WARP na części mocy).
- **Blokada masy**: co krok test przemiatany odcinka ruchu na ~1,5 s do przodu
  (koła obiektów z siatki AI, asteroidy, stacje, wraki, planety). Trafienie →
  awaryjne wyjście: hamowanie do prędkości bojowej w ~1 s z efektem zapadnięcia
  łuku dziobowego. Destruktor nigdy nie widzi zderzenia przy 20–40k j/s.
- Mnożnik strefy jak dziś (×0,3 w pasie i przy słońcu).

### 3.3 Warp = lot-duch w świecie

- Ładowanie 2,5–4 s zależnie od masy (Atlas ~3 s) — okno przechwytu z modelu
  podróży, czas na narastanie efektu. Obrażenia w trakcie ładowania — do decyzji.
- Po skoku statek jest **duchem**: poza listą destruktora, siatką pocisków,
  kolizjami asteroid, `applyDamageToPlayer`, CIWS i celowaniem AI
  (`aiPickBestTarget`, lista wrogów `capitalAI`, domyślny cel `fighterAI`).
- **Systemy liczone od pozycji gracza** muszą w warpie stać albo być tanie:
  doczytywanie pasa (`asteroidBeltBackdrop3D._stream` — zamrozić/wygasić),
  promowanie asteroid do heksów (duch nie promuje), wake sweep wraków
  (osobne zadanie: `speed * 3` = 3 s), materializacja furgonetek cargo
  (wstrzymać), despawn wraków > 50 km (jak dziś).
- Wyjście: w celu (autopilot `cruiseNav`), na granicy studni grawitacyjnej celu
  (jak dziś hamulec grawitacyjny, ale z efektem wyjścia) albo ręcznie (Ctrl na
  biegu III). **Walidacja punktu wyjścia**: spirala szukania wolnego koła
  (promień kadłuba × 1,5) wśród NPC, wraków, stacji, asteroid i planet.
- **Skrzydło wsparcia** nie leci ścieżką: przy skoku gracza wykonuje własne
  ładowanie + skok (rozłożone w czasie) i znika; przy wyjściu gracza wychodzi
  w szyku wokół niego efektem przylotu, kilkaset ms po nim.

### 3.4 Automat stanów (`src/game/warpDrive.js`, czysty moduł, testy w node)

`idle → charging → jump → transit → exit → cooling → idle` dla gracza;
NPC używa fragmentów: przylot = `herald → tear → burst → cooling`,
odlot = `charging → jump`. Moduł zwraca krzywe intensywności warstw efektu
w czasie (0..1) — render ich tylko słucha, gra tylko je zgłasza.
Plan przylotu floty: `planFleetArrival(ships)` → czasy startu (eskorta
najpierw, okręt flagowy na końcu, odstęp 0,1–0,3 s).

### 3.5 NPC, wrogowie, wezwania

- Przylot = **zwiastun 1,5–3 s** (skala z długością kadłuba) → wyjście.
  Zwiastun to też gameplay: gracz widzi, gdzie i jak duży okręt wyjdzie;
  u wroga — ostrzeżenie na radarze.
- Wezwanie (na razie sam efekt): przeciągnięcie z Rezerwy stawia ducha
  formacji; walidacja (zasięg, przeszkody, bliskość wroga) później razem
  z ekonomią. Wyjścia rozłożone w czasie.
- `spawnPirateHeavyFleet` i bramy przejdą na ten sam efekt przy porcie.

## 4. Wizual „Fałda”

### 4.1 Zasada

Napęd **fałduje przestrzeń**: przy ładowaniu przestrzeń ugina się przed dziobem,
przy skoku rozcina się w szew wzdłuż kursu, statek wchodzi w szew, przestrzeń
wraca falą. Wyjście = to samo od drugiej strony. W podróży cały świat jest
zgięty wokół statku (§4.3). Gwiazdy gry rozciąga warp (user: „dadzą fajny
efekt”), hipercruise nie.

Zgięcie tła samo w sobie słabo widać (tło to rzadkie punkty — dlatego obecna
soczewka jest „słaba”). Pokazujemy je tym, co się rusza i świeci: pył wciągany
w fałdę, tęczowa obwódka i jasny pierścień na brzegu soczewki, fala
przechodząca przez kadłuby (uberPass), kamera (szarpnięcie, wstrząs).

### 4.2 Fazy (okręt kapitalny; czasy skalowane masą)

| faza | czas | co widać |
|---|---|---|
| ładowanie | 2,5–4 s | plazma WARP narasta; łuki pełzają po kadłubie; przed dziobem soczewka z tęczową obwódką, pierścień zaburzenia zaciska się na kadłubie, pył ciągnie ku dziobowi; ostatnie 0,5 s: punkt przed dziobem rozcina się w szew |
| skok | ~0,3 s | smuga sylwetki wpada w szew, błysk; szew się zatrzaskuje → implozja, fala przez pobliskie kadłuby, szarpnięcie kamery; zostaje **blizna** (świecąca linia kursu, kilka sekund) |
| podróż | czas lotu | widok skoku (§4.3) + bańka wokół statku: z przodu ściśnięta (niebieski łuk dziobowy), z tyłu rozciągnięta (czerwony ślad); zmiana biegu = puls przez bańkę |
| zwiastun | 1,5–3 s | w punkcie wyjścia drga przestrzeń (soczewka + migotanie + iskry ciągnięte do środka), rozmiar ∝ długości kadłuba, znacznik na radarze |
| rozdarcie | ~0,5 s | szew wzdłuż kierunku przylotu: jasne krawędzie, aberracja chromatyczna, tło wciągane w szczelinę, łuki w poprzek |
| wyrzut | ~0,3 s | statek wychodzi z prędkością i smugą za sobą, kadłub biały od żaru, przed nim półksiężyc fali dziobowej, iskry do przodu, błysk w ujściu szwu, fala pierścieniowa, wstrząs ∝ masie i bliskości |
| zamknięcie + stygnięcie | 0,4 s + ~5 s | szew zamyka się za rufą; brzeg kadłuba biały → pomarańcz → wiśnia (kanał żaru heksów) |

Wariant wyjścia do porównania w demie: „brama” w stylu Homeworld (linia
odsłaniająca kadłub) — wymaga przycinania wszystkich warstw statku.

### 4.3 Widok skoku (soczewka świata) — „osobny świat”

W widoku z góry (ortho, i perspektywa patrząca pionowo w dół) planeta NIE zmienia
wielkości, gdy statek ją mija — to tylko przesunięcie. Efekt „mała → rośnie →
prawie pełna przy mijaniu → maleje” wymaga rzutu zależnego od **odległości od
statku**. Dlatego w warpie dalekie obiekty rysuje osobny świat:

- położenie: kierunek od statku bez zmian, krawędź bliższa statkowi w odstępie
  `g = m + (B − m) · dₛ / (dₛ + L)` — nieskończoność ląduje na **brzegu kropli**
  `B` (zrobione: kropla zamiast pierścienia horyzontu, L zależne od kierunku);
- wielkość: `s(d) = r · K / (d + d0)` (prawo perspektywy) × mijanie;
- przejście: `β` 0 → 1 przy skoku (świat „zwija się” wokół statku); wyjście
  frontem od dziobu — rzeczywistość prostuje się przed statkiem, a nie cała
  naraz (patrz „Stan”); pozycja i wielkość = lerp(płaski, zgięty, β)
  w logarytmie;
- gwiazdy: prawdziwe gwiazdy gry zwinięte z tłem w kulę, rozciągane przez grę
  (zrobione — pierwsza wersja z osobnym niebem skoku, Dopplerem i łukiem na
  horyzoncie odrzucona przez usera);
- warstwa gry (okręty, asteroidy, wraki, pociski) wygasa przy β → 1 (duch mija
  je przy 100k+ j/s); zostaje statek gracza w płaskiej „kieszeni” bańki;
- obiekty: słońce, planety, księżyce, stacje, pas jako pasmo, bramy, duże floty
  (znaczniki). Kilka obiektów = odwzorowanie na CPU (pozycja/skala grupy);
  planety w passie perspektywicznym dostają głębokość i x,y dające żądane `ρ`
  i `s`; Ziemia/Mars (pass ortho) — pozycja i skala wprost.

### 4.4 Flota, frakcje, skala

- Wejście floty: wszystkie zwiastuny naraz, rozdarcia co 0,1–0,3 s; eskorta
  pierwsza, okręt flagowy ostatni z największym rozdarciem i falą.
- Barwy: Atlas magenta (jak jego plazma WARP), piraci karmazyn, Terra Nova biel
  z błękitem. Piraci „brudni”: szew migocze, więcej iskier.
- Wszystkie wymiary w długościach kadłuba (świat) — efekt rośnie z okrętem.

### 4.5 Hipercruise

Plazma WARP na części mocy, lekkie ściśnięcie przestrzeni przed dziobem
z niebieską obwódką, cienkie linie opływu wzdłuż kadłuba, gorące powietrze za
rufą. Awaryjne wyjście: łuk dziobowy zapada się z błyskiem. Gwiazdy tylko
z fizycznym rozmyciem ruchu, jeśli zaczną migać.

## 5. Technika

### 5.1 Zgięcie tła — lista prymitywów

`warpLens3D.js` + pass w `core3d.js` (dziś jedna soczewka `setWarpLensWorld`)
→ lista prymitywów zgłaszanych co klatkę w świecie: **punkt** (połknięcie, jak
dziś), **szew** (odcinek wciągający tło), **fala** (pierścień przesunięcia
promieniowego), **bańka** (ściśnięcie z przodu / rozciągnięcie z tyłu). Dalej
tylko warstwa tła, nigdy próbkowanie gotowej klatki (lekcja „jajka”). Lustro CPU
shadera do testów (jak `warpLensSampleUv`).

### 5.2 Drganie całej klatki — uberPass

Nowe typy źródeł obok dyszy i plamy: **fala pierścieniowa** (przesunięcie
promieniowe w pasie wokół promienia R) i **szew** (drganie wzdłuż odcinka).
Bez nowego passa. Clamp przesunięcia jak dziś.

### 5.3 `src/3d/warpFx3D.js`

Instancjonowane quady (jeden mesh na rodzaj): szew, błysk, fala dziobowa
(półksiężyc), pierścień, blizna, smuga sylwetki. Cel: ≤ 6 draw calli, gdy coś
trwa, 0 gdy nic. Zasady: HDR wg `hdr-band-plan` (biel 8–12, barwa 0,4–1,3,
alfa = max(rgb), blend ONE/ONE), `sceneOrigin` (dane względem początku przy
kamerze, `Float64Array` na CPU), clamp varyingów i bez `pow()` z ujemną
podstawą (NaN z MSAA w HalfFloat rozlewa bloom na cały ekran).

### 5.4 Kadłub

- **Nie skalujemy prawdziwego kadłuba** (mostek, wieżyczki 2D, światła,
  tarcza by się rozjechały). Smuga = kopia sylwetki (sprite kadłuba) rozmyta
  wzdłuż osi, addytywnie, w barwie żaru.
- Żar: `addShardHeat`/podniesienie `shard.heat` + `heatStamp` na brzegu (albo
  całości) siatki + oznaczenie `meshDirty` — zero nowego shadera.

### 5.5 Kamera

Ładowanie: lekkie zbliżenie + winieta; skok: szarpnięcie (zoom punch) +
wstrząs; podróż: stały „zoom warpa” (statek ~12–15% wysokości ekranu), zapamiętany
zoom gry wraca przy wyjściu; wyjście: wstrząs ∝ masie i bliskości.

### 5.6 Pułapki

- MSAA + HalfFloat → NaN (clampy, `x*x` zamiast `pow`).
- UnrealBloomPass bramkuje (nie odejmuje knee), ACES bieli > 1,5.
- Kanwa Core3D premultiplied: zrzuty przez CDP `Page.captureScreenshot`.
- Precyzja: świat przy 5–10 mln j.; wszystko względem `sceneOrigin`.
- Pula plazmy WARP ma limit 16 (`WARP_PLUME_CAP`) — flota warpująca naraz
  dostanie część strug MAIN z dopalaczem.

## 6. Demo i kamienie milowe

`dema/warp-demo.html` + `dema/warp-demo.js` na prawdziwym Core3D, hexShips3D,
kadłubach z gry i tle z `planet3d.assets.js` (gwiazdy, mgławica). Kod efektu
od początku w `src/` (`warpDrive.js`, `warpFx3D.js`, rozszerzenia Core3D) —
port do gry = podpięcie. Na górze panelu przyciski ze skrótami, oś czasu
z przewijaniem, zwolnienie ×0,25, wybór frakcji i kadłuba, przełączniki warstw.

- **M1 — wyjście z warpa**: pojedynczy przylot, wezwanie floty (klik =
  formacja), zasadzka piratów.
- **M2 — ładowanie i skok**: Atlas, odlot NPC, blizna.
- **M3 — podróż**: widok skoku (soczewka świata z planetami), bańka, biegi;
  hipercruise z awaryjnym wyjściem.
- **M4 — gra**: automat w `index.html`, duch, walidacja wyjścia, zawieszenie
  systemów od pozycji gracza, skrzydło wsparcia, przylot piratów, wezwania.

## 7. Otwarte

- Wejście w skok (M2): w demie rozpęd = dolly zoom ciał + kopnięcie (Ziemia już
  nie przesuwa się pod statek). W grze bodyZoom liczy się od planety/stacji
  startu — kto ją wskazuje (automat warpa?) i co z ringiem „Halo” (osobny system,
  soczewka go nie przestawia).
- Obrażenia w trakcie ładowania: przerywają skok czy nie?
- Prędkości warpa gracza vs. rekordy ruchu (warp NPC 20k j/s w `travelNetwork.js`).
- Paliwo gracza (dziś `fuelMax` 60 / regen 5 — w praktyce cooldown).
- Czy warp-duch jest widoczny dla czujników wroga (sygnatura)?
