# Demo WebGPU: rój dronów przeładunkowych (dema/roj-webgpu.html)

Polecenie użytkownika (2026-10-05): *„potrzebuję swarm futurystycznych dronów rozładunkowo-załadunkowych. Mam do
dyspozycji WebGPU, więc jest moc, której możemy użyć. Drony muszą omijać przeszkody i siebie, nie uderzać o różne
rzeczy i być »mądre«, żeby mądrze rozładować i załadować towary na ogromne statki.”* W trakcie: drony Z5 *„średnio mi
się podobają, są clumsy i za duże”*, *„wyglądają jak drony z wirnikami, a w kosmosie wirników nie ma”*, *„drony
S / M / L / Capital”*, *„ramiona, które łapią kontenery”*, *„musisz zaprojektować nowy model”*.

Decyzje z 2026-10-06 (zastępują „jeden dron = jeden kontener swojej klasy”): *„kontenery powinny leżeć na płasko, być
jednego wymiaru. S dron łapie 1 kontener, M 2, L 4, Capital 8; trzeba przerobić im łapy, żeby się bardziej rozciągały
(większe drony), żeby np. Capital był w stanie zabezpieczyć 8 kontenerów naraz”*, *„symulację dronów chcę do gry
wdrożyć na prędkości ×4 — ×1 wydaje mi się za wolno”*.

Demo pokazuje: **nowy model drona** (4 klasy, ramiona z chwytakami w gniazdach narożnych, w większych klasach
wysuwane), **jeden kontener standardowy** i **chwyt płaski** 1 / 2 / 4 / 8, **rój liczony w compute na GPU** (lot,
unikanie ORCA, tor pionowy w kolumnach, zamki kolumn — do 4096 dronów) i **wieżę portu** na CPU, która przydziela zadania
na poziomie pojedynczych kontenerów (podwójny cykl, sztauowanie z wyważeniem, plac wg towaru, przeładunek statek →
statek, wspólny plac dla wszystkich klas). Samodzielne demo (`WebGPURenderer` + TSL pod Vite), gry nie dotyka; moduły w
`src/3d/swarm/`, `src/game/swarm/`, `src/data/swarmDrones.js` gotowe do integracji.

## Jak otworzyć i sterować

`npm run dev` → `http://localhost:5173/dema/roj-webgpu.html` (spis: `dema/index.html`, grupa WebGPU).

- **Sceny (1–7):** 1 Galeria (dron każdej klasy ze swoim chwytem w pętli: zawis → zejście, ramiona się rozkładają
  i wysuwają → zacisk → podniesienie → odłożenie), 2 Załadunek Atlasa (504 kontenery chwytami L), 3 Wymiana (frachtowiec:
  import na plac, eksport do ładowni — podwójny cykl), 4 Statek → statek (przeładunek bezpośredni), 5 Megafrachtowiec
  (Capital po 8 kontenerów), 6 Port — wspólny plac C (7 statków, 4 klasy, 3 bloki placu), 7 Rój 2048 dronów S
  (4 bloki wymieniają 6000 kontenerów na krzyż N ↔ S, E ↔ W).
- **Tempo:** domyślnie **×4** (jak w grze), galeria ×1. ❚❚ / ×½ / ×1 / ×2 / ×4 / ×8, Spacja — pauza / wznowienie
  w tempie sceny.
- **Przełączniki:** **M** — wieża SMART / NAIWNA (ta sama księga i reguły bezpieczeństwa, bez optymalizacji),
  **V** — warstwy przelotu wg kursu wł. / wył., **U** — unikanie wł. / wył. (porównanie), **R** — scena od początku.
- **Kamera:** kółko — zoom do kursora, przeciąganie / WASD — przesuw, **F** — cała scena, **C** — kamera kinowa (Q/E
  obrót, suwak pochylenia), **T** — śledź drona (kolejny w ruchu), **H** — panel.
- **Panel:** kontenery / min, ETA, drony w locie, wolny lot / tor pionowy / czeka, ORCA (linie, drony w tłoku), puste
  przeloty, statek → statek, najmniejsza przerwa między obrysami, zderzenia, wyważenie statków (paski).
  Ustawienia: horyzont ORCA, zapas obrysów, słońce, bloom, cienie, światła.
- **Adres:** `?scena=galeria|atlas|wymiana|przeladunek|mega|port|roj`, `?tryb=naive`, `?liczba=4096` (drony roju),
  `?test=1` (klatki tylko z `__demo.step`), `?dpr=1`.
- **Konsola:** `__demo.scene(nazwa, { mode, count, keepSpeed })`, `step(n)`, `run(sekundy, tempo)`, `speed(v)`,
  `pause()`, `layers(b)`, `avoid(b)`, `lookAt(x, y, zoom)`, `tilt(stopnie, azymut)`, `follow(k)`, `stats()`,
  `sim.setTune(klucz, wartość)` (`SWARM_SIM_TUNE`).

## Pliki

| Plik | Co robi |
|---|---|
| `src/data/swarmDrones.js` | **klasy dronów** (bez three): S / M / L / Capital, chwyt płaski klasy (`pack` nx × ny kontenerów standardowych), miejsca w chwycie (`swarmPackSlotOffset` — lustro shadera), klasa obrysu kolumny (`swarmClassForFootprint`, `swarmPackTiles`), lot (z ładunkiem × 0,85 / × 0,75), ramiona (bark na wysięgniku, l1, tuleja + teleskop, chwytak pojedynczy / podwójny, IK chwytu raz — `swarmArmPose`, lustro shadera), światła, zasięgi do unikania, masa kontenera (gęstość ładunku) |
| `src/3d/swarm/swarmDroneModel.js` | **bryła drona** (JS, też w Node): kadłub-loft o przekroju sześciokąta, silniki jonowe na rufie, płaskie bloki RCS w barkach (bez gondoli w narożach), wizjer, listwa stanu; ramiona (wysięgnik barku, ramię z siłownikiem, łokieć, tuleja, dwa człony teleskopu, słupek chwytaka ze stopką i czopami zamków, 2 szczęki); `aMat` + `aRig` (ramię, część); LOD hi / lo |
| `src/3d/swarm/swarmClassTable.js` | tablica klas GPU (`uniformArray`, stała nazwa bloku): wymiary, chwyt nx × ny, lot, zasięgi, obrysy, ramiona (10 × 5 wierszy: bark, cel, kąty złożenia i chwytu liczone raz na CPU, tuleja, wysuw, chwytak podwójny), światła |
| `src/3d/swarm/swarmDrones.tsl.js` | materiał drona (TSL): poza ramion w wierzchołkach z rozłożenia e i zacisku g (teleskop: człony przesuwane o pół / cały wysuw), chwytak w osiach drona, kadłub z pozy instancji, emisja (stan, dysze z ciągu, wizjer, lampki chwytaków), maska słońca; światła (billboardy HDR, 22 na drona) |
| `src/3d/swarm/swarmUnits.tsl.js` | kontenery roju — jeden standard 16 × 8 × 8 (materiał kontenerów ładowni z pozą z bufora jednostek) i cienie (dronów, kontaktu) |
| `src/3d/swarm/swarmSim.js` | **symulacja na GPU** (compute TSL): kernele `kClear` → `kBin` → `kSteer` → `kIntegrate`, pierścień zadań (8 × vec4, do 8 kontenerów chwytu), odczyt stanu (`SwarmReadback`), statystyki; ORCA (program liniowy w tablicach lokalnych) |
| `src/game/swarm/swarmPort.js` | **port** (bez three): siatki kolumn z komórkami (ładownie — obrys modułu × warstwy, plac — obrys chwytu klasy bloku × poziomy, gniazda), środki komórek i podbloków, poziomy wejścia w szachownicę, pasmo podejścia, warstwy przelotu, mapa przeszkód z masek sprite'ów, rekordy GPU (`SWARM_DRONE`, `SWARM_TASK`, `SWARM_UNIT`, fazy, kody), kontenery w kolumnach (`swarmFillColumns`, `swarmColumnCounts`, `swarmUnitRestPose`) |
| `src/game/swarm/swarmPlanner.js` | **wieża portu** — księga komórek, przydział chwytów (tryby smart / naive), kurs drona w chwycie i przy odłożeniu, place (obszary towarów, wolne stosy), wyważenie statków |
| `src/game/swarm/swarmExecCpu.js` | lustro CPU maszyny stanów (bez unikania) z niezależną kontrolą geometrii chwytu (komórka celu liczona z pozy) — testy planisty i scenariuszy |
| `src/game/swarm/swarmOrca.js` | lustro CPU unikania: linia ORCA pary prostokątów, program liniowy (RVO2 linearProgram2 / 3, linie twarde) |
| `src/game/swarm/swarmScenarios.js` | scenariusze dema (statki, place, gniazda, ładunek i cele) |
| `dema/roj-webgpu.html`, `dema/roj-webgpu.js`, `dema/roj-webgpu/sceny.js`, `dema/roj-webgpu/platforma.js` | strona, renderer, post jak gra (BloomGry → ACES → sRGB), kamera, panel, sceny, platforma portu (pokład, place, gniazda, światła); tło i kadłuby z `dema/ladownia-webgpu/` |
| `scripts/webgpu/roj-demo.mjs` | harness (Vite + Chrome na GPU): `--tryb test`, `metryki`, `zrzuty`, `wydajnosc` |
| `tests/swarmDrones.test.mjs`, `swarmOrca.test.mjs`, `swarmPlanner.test.mjs`, `swarmTsl.test.mjs` | testy (klasy, chwyty, ramiona i teleskop, obrysy; ORCA na CPU; scenariusze na wykonawcy CPU z kontrolą komórek; WGSL kerneli i materiałów w Node, limity, wysyłka zadań) |

Zmiany poza nowymi plikami: `src/3d/cargo/containers.tsl.js` i `shadows.tsl.js` eksportują budowę materiału ze
źródłem pozy (`buildCargoContainerMaterial(source)`, `buildCargoHullShadowMaterial` / `ContactShadowMaterial`) —
ładownie bez zmian, rój podaje pozę z bufora jednostek; `src/data/cargoBays.js` — moduły ładowni obsługiwanych przez M
(Bellator, Iron Skull, kontenerowiec, frachtowiec dalekiego zasięgu) 1 × 1 × 2 → 1 × 2 × 2 (obrys = chwyt M; pojemność
i głębokość bez zmian). Drony Z5 (`src/3d/cargoDrones3D.js`) bez zmian.

## Kontener i chwyty (decyzje 2026-10-06)

- **Jeden kontener standardowy 16 × 8 × 8 j.** (`CARGO_CONTAINER`) — megakontenerów nie ma. Kontener jest jednostką
  księgi wieży, wyważenia, rysowania (jedna instancja na kontener) i masy (2 t × gęstość ładunku).
- **Chwyt płaski** — dron niesie JEDNĄ warstwę, dłuższym bokiem wzdłuż kadłuba: **S 1 × 1** (16 × 8), **M 1 × 2**
  (16 × 16,25 — dwa kontenery burta w burtę), **L 2 × 2** (32,25 × 16,25), **Capital 4 × 2** (64,75 × 16,25). M jest
  burtą w burtę, nie wzdłuż — obrys 1 × 2 dzieli dawne sloty 1 × 1 × 2 ładowni M bez zmiany pojemności.
- **Chwyty się zagnieżdżają** (C = 2 L = 4 M = 8 S): kolumnę (slot ładowni, stos placu) obsługuje każda klasa, której
  chwyt dzieli obrys kolumny bez reszty (`swarmPackTiles`) — bierze PODBLOK (część warstwy). Plac C obsłuży wszystkie
  klasy; Atlas (2 × 2) — S, M i L; wagon megafrachtowca (4 × 4) — dwa chwyty Capital na warstwę. W scenie Port Capital
  zdejmuje z wagonu po 8, a z tego samego placu L bierze po 4 do Atlasa, M po 2 do frachtowca, S po 1 do fregat.
- **Mocowanie:** każdy kontener trzymany za dwa gniazda narożne na swojej **zewnętrznej** dłuższej krawędzi (w chwycie
  płaskim każdy kontener ma taką krawędź na burcie chwytu); na styku dwóch kontenerów jedno ramię z chwytakiem
  **podwójnym** (belka z dwoma zamkami — jak środkowe zamki spreadera twin-lift). Na burtę nx + 1 ramion: S i M — 4,
  L — 6, Capital — 10 (test: każdy kontener trzymany za ≥ 2 gniazda).
- **Stosy** w ładowniach i na placach zostają (moduł ładowni = obrys × warstwy, plac — poziomy): dron kładzie warstwę na
  warstwie. Atlas: sloty 2 × 2 × 2 → 126 chwytów L na 504 kontenery.

## Model drona i klasy

- **Bez wirników:** wydłużony kadłub z silnikami jonowymi na rufie (2, Capital 4), RCS jako płaskie bloki wtopione w
  barki — z góry żadnych okrągłych gondoli w narożnikach. Drony są mniejsze od chwytu (S: kadłub 9,4 × 4,6 nad
  kontenerem 16 × 8; Capital: 35 × 13 nad 64,75 × 16,25) — „platforma z ramionami”, nie klocek.
- **Ramiona wysuwane** (M, L, Capital; S stałe): barki na **wysięgnikach** nad linią gniazd (ramię pracuje w pionowej
  płaszczyźnie wzdłuż burty — łokieć nie wystaje w bok poza obrys chwytu), ramię l1, łokieć, przedramię = **tuleja +
  dwa człony teleskopu**; wysuw rośnie z rozłożeniem (smoothstep 0,35…0,95 e). Ramiona narożne sięgają końców chwytu
  (Capital: wysuw 6,9 j. przy tulei 6,1 — końce chwytu 17 j. za kadłubem), ramiona styków i środka są krótsze, bez
  wysuwu. Długości: l1 + l2 w chwycie = 1,12 × odległość bark → cel (łokieć zgięty), ramiona teleskopowe — l1 i tuleja
  klasy (0,36 i 0,30 najdłuższego zasięgu).
- **Złożone** — teleskop schowany, ramię uniesione wzdłuż burty, szczęki zamknięte: obrys pustego drona mieści się w
  obrysie jego warstwy (Capital ±8,26 j. przy warstwie ±8,13) — pusty dron schodzi w szyb kolumny 1 j. obok pracującego.
- **Chwytak** w osiach drona (zamki w gniazdach narożnych, nie wzdłuż ramienia); szczęki rozwierają się przy rozkładaniu,
  zaciskają przy chwycie (lampka bursztyn → zieleń).
- Pozę liczy shader: kąty mieszane liniowo między złożoną a chwytem (IK chwytu raz na CPU, w tablicy klas), wysuw z e.
  Lustro CPU `swarmArmPose` — błąd chwytu ~1e-15.
- Wyższa klasa leci wolniej i bardziej bezwładnie (Capital 115 j/s, 50 j/s²; S 230 j/s, 200 j/s²) i ma wyższe
  pierwszeństwo w unikaniu (z ładunkiem — podwójne).

## Przestrzeń powietrzna portu

- **Kolumna** = stos (slot ładowni, pole placu, gniazdo) o obrysie cnx × cny **komórek** (kontenerów w warstwie) i kilku
  poziomach. Dron schodzi nad środek swojego **podbloku** (część warstwy jego chwytu); **zamek kolumny jest jeden** —
  w szybie kolumny pracuje najwyżej jeden dron, niezależnie od podbloku.
- Nad siatką kolumn: **wejścia** na dwóch poziomach w szachownicę ((i + j) & 1 — sąsiednie kolumny nie dzielą wysokości
  wejścia), nad nimi **pasmo podejścia** (`ceilZ = base + 2 Δ`, Δ = wysokość drona z ładunkiem + 2,5 j.) — **ruch w bok
  nad siatką tylko w paśmie**; zejście i wyjście **pionowo nad własnym podblokiem** (wyjście: trzyma środek, aż wzniesie
  się w pasmo — ale nie, gdy cel jest tuż obok: to dolot). Klasa siatki (wysokości wejść) = największa klasa, która ją
  obsługuje.
- **Warstwy przelotu wg kursu** (reguła półkolowa lotnictwa — 4 ćwiartki kursu, 4 wysokości): strumienie krzyżujące się
  mijają się w pionie. Krótkie odcinki (< 260 j.) — przeskok pół warstwy nad wyższym końcem.
- **Mapa przeszkód** (wierzchy kadłubów z alfy sprite'ów, plac, wieże): dół drona z ładunkiem zawsze nad nią.
- **Zamki kolumn** (atomiki): jedna operacja na kolumnę (od wyrównania do opuszczenia jej obrysu); dron dolatujący do
  zajętej kolumny czeka **pasmo wyżej** (wychodzący wznosi się w pasmo pod nim i odlatuje w bok). **Licznik kolumny** =
  kontenery w niej: dron schodzi, gdy licznik równa się stanowi „przed tym zadaniem” z rekordu (poprzednie operacje
  skończone); chwyt odejmuje, odłożenie dodaje liczbę kontenerów chwytu.

## Wieża portu (planista CPU)

Planista mówi KTO, CO i DOKĄD; drony latają same (GPU).

- **Księga komórek:** dla każdej komórki — kontener na każdym poziomie i wysokość stosu. Chwyt = wierzchnia warstwa
  podbloku (także niepełna — mniejsze drony biorą resztki), wszystkie jego kontenery czekają i mają ten sam cel; cel =
  **równy** podblok (wszystkie komórki tej samej wysokości), pod nim tylko kontenery, które już zostają (LIFO).
- **Kurs drona** w chwycie i przy odłożeniu wybiera wieża (kurs kolumny albo +π — bliższy kursowi, z którym dron kończy
  poprzednie zadanie), więc wie, który kontener (miejsce k chwytu) trafi w którą komórkę celu. GPU stawia kontenery
  z tej samej arytmetyki (punkt odłożenia + obrót kursem × miejsce k), wykonawca CPU sprawdza komórkę z pozy.
- Tryb **smart**: **podwójny cykl** (koszt zadania = pusty dolot, więc po eksporcie w statku najbliższy jest import tego
  statku), **pełne chwyty** (kara za każdy brakujący kontener), **sztauowanie** (ciężkie bliżej środka, burty na
  zmianę, kara za przesunięcie środka masy — wyważenie w panelu), rozproszenie (kara za pracujące drony obok), **plac wg
  towaru** (otwarte stosy towaru, nowe stosy wężykiem od strony źródeł — kopiec wolnych stosów), **przeładunek
  bezpośredni** statek → statek, filtr „cel możliwy teraz” (bez niego K najbliższych źródeł bywa samymi eksportami bez
  miejsca w statku — zakleszczenie wymiany). Tryb **naive** — ta sama księga i bezpieczeństwo, bez optymalizacji.
- **Bez zapasu zadań** (`lookahead: 1`): drugie zadanie „na zapas” rezerwowało kolumny na cały kurs pierwszego, a pod
  koniec ostatnie kursy czekały za zajętymi dronami (CPU, opóźnienie odczytu 0,2 s: port 131 → 168 s, wymiana 97 →
  101 s). Odczyt z GPU spóźnia się o 1–3 klatki — dron w tym czasie zaczyna powrót i zawraca do nowego zadania.
- Koszt CPU: rój 2048 dronów ~3,4 ms na klatkę (opcje odłożenia liczone raz na klatkę: towar × blok × klasa; zbiory
  stosów przyjmujących, otwartych i wolnych zamiast przeszukiwania placu), pozostałe sceny < 1 ms.

## Symulacja na GPU

- Krok stały 1/60 s, kilka kroków na klatkę w jednym `renderer.compute(lista)`: `kClear` (siatka i statystyki) →
  `kBin` (siatka mieszająca xy, komórka 64 j., ≤ 40 na komórkę) → `kSteer` (maszyna stanów, nawigacja, unikanie,
  zamki, chwyt i odłożenie) → `kIntegrate` (ruch, stan dla sąsiadów, niesione kontenery — każdy w swoim miejscu chwytu,
  status). Bez wyścigu: `kSteer` czyta stan sąsiadów z kroku poprzedniego.
- Zadania: pierścień 2 na drona (numer zadania % 2), 8 × vec4 (punkty i kursy chwytu i odłożenia, wejścia, kolumny,
  liczniki „przed”, do 8 kontenerów chwytu), wysyłka zakresami; **status** (faza, wykonane, niesione kontenery,
  czekanie) wraca do planisty trwałym odczytem (`SwarmReadback`: pierścień buforów MAP_READ, epoka sceny) z
  opóźnieniem 1–3 klatek.
- Fazy: gniazdo → start (pion) → lot do źródła → wyrównanie (pozycja, kurs, zamek, licznik kolumny) → zejście (ramiona
  się rozkładają i wysuwają) → chwyt → wzniesienie → lot do celu → … → odłożenie → wzniesienie → następne zadanie albo
  powrót → lądowanie. Tor pionowy w kolumnie jest **prowadzony** (bez unikania, pierwszeństwo bezwzględne).

## Unikanie: ORCA na prostokątach

- **ORCA** (van den Berg, Guy, Lin, Manocha; RVO2): każdy sąsiad, którego pas wysokości nakłada się z moim teraz albo
  w horyzoncie τ = 1,5 s, daje **półpłaszczyznę dozwolonych prędkości poziomych**; dron bierze prędkość najbliższą
  zamierzonej, spełniającą wszystkie (program liniowy 2D w tablicach lokalnych WGSL; tłok — RVO2 linearProgram3).
- **Prostokąty zamiast kół** (chwyt do 4 : 1 — koło opisane wielokrotnie powiększałoby odstępy): przeszkoda prędkości =
  stożek z początku styczny do sumy Minkowskiego obu obrysów z kursem (styczne przez wierzchołki podparcia, 4 kroki),
  ucięty τ łamaną przez wierzchołek najbliższy. Łamana leży w M — skuteczny horyzont ≥ 0,8 τ (pomiar: 5000 losowych
  par). Nakładanie (z zapasem) — linia wyjścia wzdłuż osi najmniejszego nakładania w 0,35 s.
- **Przyspieszenie klasy:** program liniowy liczy w kole prędkości **osiągalnych w 1 s** (wokół bieżącej prędkości),
  regulator śledzi wynik szybko (20 /s, sufit = przyspieszenie klasy). Klasyczne ORCA zakłada natychmiastową zmianę
  prędkości — z wolnym regulatorem (3,6 /s) w testach CPU było 147 klatek zderzeń na 20 dronach, z kołem i szybkim
  regulatorem 0.
- **Udziały:** sąsiad prowadzony albo wyrównany nad kolumną (gdy ja nie) — ustępuję w całości, a jego linia jest
  **twarda** (tłok rozluźnia tylko miękkie, jak linie przeszkód RVO2; sprzeczne twarde → wszystkie miękkie); obaj
  wolni — wg wag (cięższa klasa i ładunek ustępują mniej). Najwyżej 16 linii; linia, przy której całe koło osiągalnych
  prędkości jest dozwolone, pomijana; przy pełnej liście zastępuje najmniej wiążącą.
- **Pion:** obrysy nakładają się w poziomie teraz albo w horyzoncie (SAT w ruchu) → zbliżanie pasów ≤ √(2 a · przerwa);
  hamuje ten, kto się zbliża (dron w swoim paśmie nie zmienia wysokości przez przelatującego); wyrównany nad kolumną
  ma pierwszeństwo przed wolnym. Nakładanie w obu osiach — wyjście krótszą drogą (pion, jeśli w dół jest miejsce).

## Błędy znalezione przy pomiarach (warto pamiętać)

- **Rekordy zadań z poprzedniej sceny:** `init()` zlecał pełną wysyłkę bufora zadań, ale planista w tej samej klatce
  dopisywał zakresy, a three r183 przy niepustych `updateRanges` wysyła tylko je — na GPU zostawały stare rekordy, a
  dron z pasującym numerem zadania wykonywał cudze (zamki < 0, zastoje zależne od kolejności scen). Pierwsza wysyłka
  po `init()` jest teraz pełna (test w `swarmTsl.test.mjs`).
- Obrót do kursu slotu był zablokowany pod pasmem startu — nad celem z niższym pasmem dron czekał bez końca.
- Własny zamek kolumny (odłożył i bierze z tego samego stosu — bufor na placu) blokował wyrównanie.
- Dron w paśmie nad własną kolumną liczył pełny zapas 1,4 j. przy szybie obok (szczelina modułów S 0,76 j.) — z
  wychodzącym obok hamowali się nawzajem w pionie.
- Powrót do gniazda czekał na kurs slotu (gniazdo go nie wymaga) — po pracy na obróconym placu drony wisiały nad
  gniazdami.
- Odcięcie przeszkody prędkości końcem nakładania pasów (t4) zakładało stałe tempo wznoszenia — hamowanie w pionie je
  zmienia; odcięcie stałym τ.
- (2026-10-06) **Zadanie dostane w powrocie tuż nad kolumną źródła:** odcinek zaczynał się 3 j. od celu, a reguła
  „wyjście z kolumny — najpierw w górę, bez ruchu w bok” trzymała drona przy początku odcinka na zawsze (zastój Atlasa).
  Wyjście tylko, gdy cel jest dalej niż 6 j.
- (2026-10-06) **Pusty Capital szerszy od swojej warstwy** (ramiona złożone na zewnątrz, szczęki rozwarte: ±10,7 j.
  przy warstwie ±8,13): w wagonie (dwa chwyty na slot, szyby sąsiednich slotów 1 j. obok) pusty i załadowany dron
  blokowały się nawzajem. Ramiona składają się wzdłuż burty, szczęki złożonego ramienia zamknięte, barki z grubością
  ramienia w obrysie warstwy (test w `swarmDrones.test.mjs`).
- (2026-10-06) **Wieża na placach:** stosy, z których eksport częściowo odleciał, były „otwarte” i każde wyszukiwanie
  przeglądało ich setki (LIFO i tak je odrzucało) — rój: 447 ms na klatkę; licznik kontenerów jeszcze nie na miejscu
  (na kolumnę) i zbiory stosów przyjmujących / otwartych / wolnych — 3,4 ms.

## Pomiary (2026-10-06, RTX 5080, `roj-demo.mjs --tryb metryki`, tempo ×4; czas = czas roju, w grze ÷ 4)

| Scena | Wieża | Kontenery (kursy) | Czas | Puste przeloty | Klatki ze zderzeniem | Najgłębsze nakładanie |
|---|---|---|---|---|---|---|
| Atlas (28 dronów L) | smart | 504 (126) | 192 s | 45% | **0** | przerwa ≥ 0,7 j. |
| Atlas | naive | 504 (126) | 208 s | 46% | 67 | −2,1 j. |
| Wymiana (96 L) | smart | 3040 (760) | 341 s | 28% | 361 (≤ 2 pary) | −1,9 j. |
| Wymiana | naive | 3040 (760) | 396 s | 50% | 405 | −4,1 j. |
| Statek → statek (64 L) | smart | 1520 (380) | 330 s | 49% | **0** | przerwa ≥ 0,2 j. |
| Statek → statek | naive | 1520 (380) | 336 s | 50% | 208 | −1,2 j. |
| Megafrachtowiec (64 C) | smart | 3104 (388) | 384 s | 50% | 255 (1 para) | −2,6 j. |
| Megafrachtowiec | naive | 3104 (388) | 384 s | 50% | 213 | −3,2 j. |
| Port (180, 4 klasy) | smart | 2166 (~680) | 345 s | 48% | 192 (≤ 2 pary) | −7,8 j. |
| Port | naive | 2166 (~740) | 452 s | 50% | 94 | −1,8 j. |
| Rój (2048 S) | smart | 6000 (6000) | 230 s | 17% | 1953 (≤ 16 par z 2048) | −8,2 j. |
| Rój | naive | 6000 (6000) | 256 s | 36% | 2758 | −6,4 j. |

Wszystkie 12 przebiegów (6 scen × 2 wieże) do końca, bez zastojów, 0 błędów WebGPU. „Klatka ze zderzeniem” = klatka,
w której choć jedna para obrysów z kursem (SAT + pas pionowy) nachodzi na siebie; liczby mają duży rozrzut między
przebiegami (ten sam stan startowy, atomiki kolejności — w wymianie dawniej 76–352 klatek). Przed zmianą kontenera
(chwyt = moduł: L 8, Capital 32 kontenery): Atlas 63 kursy w 128 s (24 L), mega 234 kursy w 240 s, zderzenia: wymiana
352, statek → statek 181, mega 37, port 133 klatek. Chwyt płaski = więcej kursów na ten sam ładunek (Atlas ×2 kursów,
czas ×1,5 przy 28 zamiast 24 dronów). Megafrachtowiec ma więcej zderzeń niż dawniej (długie, wąskie chwyty Capitala
4 : 1 w przelocie z ładunkiem; τ = 2 s daje ~124 klatki — strojenie zostawione domyślne). Wydajność
(`--tryb wydajnosc`, 1920 × 1080): rój 2048 dronów — compute ~1,3 ms na klatkę (2 kroki), render 0,2 ms GPU; wymiana
/ port / mega — compute 0,1–0,3 ms.

**Co zostaje** (rzadkie): szybki dron w locie przy dronie na torze prowadzonym w szybie obok (prowadzony nie unika —
wolny musi go zobaczyć na tyle wcześnie, by wyhamować), gęste strumienie roju (tłok — najmniejsze naruszenie), długie
chwyty Capitala w przelocie. Dalsze kroki: AVO (przeszkody prędkości z przyspieszeniem, van den Berg 2011) zamiast koła
osiągalnych prędkości, uwzględnienie torów prowadzonych jako przeszkód „z planem” (znany profil zejścia / wzniesienia),
wyższe pasmo dla przelotu nad pracującymi szybami.

## Narzędzia

- `node scripts/webgpu/roj-demo.mjs --tryb test` — wszystkie sceny, błędy konsoli / WebGPU / WGSL.
- `--tryb metryki [--sceny atlas,wymiana] [--wieza smart,naive] [--limit 900] [--tune orcaTau=1.5,margin=2] [--zastoj 90]`
  — przebieg do końca: czas, puste przeloty, wyważenie, zderzenia (histogram faz najbliższych par), zastoje; przy
  zastoju — zrzut aktywnych dronów (faza, zadanie, kolumny, liczniki kolumn, zamki, kontenery chwytu).
- `--tryb zrzuty [--tylko 11,22]` — galeria, sceny z góry i kinowo, zbliżenia (`.tmp/webgpu/roj/`).
- `--tryb wydajnosc` — FPS, CPU, GPU, compute.
- Diagnostyka w kernelu: `sim.U.debug = 1` (w `MOTION`: prędkość zamierzona xy, liczba linii + 100 · tłok),
  `= 2` (składowe pionu).

## Integracja z grą (plan)

1. **Ładownie** (`docs/webgpu/DEMO-LADOWNIA.md`): kolumny = sloty modułów z `cargoBays.js` (obrys modułu =
   wielokrotność chwytu klasy, warstwy = nz; `buildSwarmPort` przyjmuje ładownie z przestrzeni PNG), drony roju zamiast
   Z5 w scenach przeładunku.
2. **Port K-7 / zatoki ringu** (ruch v2): plac (najlepiej w obrysie chwytu Capital — obsłuży każdą klasę) i gniazda przy
   stanowiskach; wieża = część `portControl` (tor zadań i księga kontenerów; ceny i umowy z ekonomii `resources.js`).
3. **Core3D:** kernele jako krok `Core3D.addFxStep` (raz na klatkę, przed passami), pula w `FxPoolOrigin` (początek
   przy porcie — float32 przy 5–10 mln j.), materiały w rejestrze `Core3D.warmup`, światła dronów w siatce
   `Core3D.fx.lights`, maska słońca jak dziś.
4. **Rozgrywka:** czas przeładunku z symulacji (zamiast stałego), ładunek widoczny w ładowni, wyważenie statku
   (`maxTrim`) jako warunek odlotu; mgła wojny i maskowanie — drony to obiekty portu (widoczne tylko w zasięgu wzroku).
   Ładunek gracza (`PLAYER.cargo` w tonach) → kontenery standardowe (widok liczby: ⌈masa / 2 t⌉ na towar).
5. **Tempo ×4** (decyzja użytkownika 2026-10-06: „×1 wydaje mi się za wolno”): zegar roju = czas gry × 4 (w pauzie 0),
   krok stały 1/60 s czasu roju jak w demie (240 kroków na sekundę gry; `maxSteps` na klatkę — przy niskim FPS rój
   zwalnia zamiast skakać). Parametrów lotu nie przestrajać (przyspieszenia rosłyby × 16, τ ORCA i czasy chwytu ÷ 4) —
   pomiary dema (tabela wyżej, czas roju) zostają ważne: w grze czas ÷ 4 (Atlas, 504 kontenery, 28 dronów L: ~48 s).
   Ruchome przeszkody spoza roju (statki w locie) podawać w czasie roju: prędkość ÷ 4, pozycja co krok. Demo startuje
   w ×4 (galeria ×1).
6. **Inne roboty dronów** (pytanie użytkownika: łapanie odłamków asteroid): podział wieża (CPU: kto / co / dokąd) ↔ drony
   (GPU: lot, unikanie, ramiona) jest ogólny, ale kernel zna dziś jedną robotę — przenieś kontenery z kolumny do kolumny
   (oba końce stoją). Odłamki = nowy rodzaj zadania: pościg i wyrównanie prędkości z ruchomym celem, chwyt nieregularnej
   bryły (punkty chwytu z obrysu odłamu), przekazanie ciała fizyki wydobycia ↔ dron, zrzut do otwartej ładowni →
   urobek w `PLAYER.cargo`; prawda gry zostaje na CPU, GPU wykonuje i melduje.
