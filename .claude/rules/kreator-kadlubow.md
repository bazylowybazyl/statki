---
paths:
  - "src/game/hullDesign/**"
  - "src/3d/hullDesign/**"
  - "dema/kreator-kadluba-*"
  - "tests/hullDesign*.test.mjs"
---

# Kreator kadłubów: projekt, klocki, kompozytor, stocznia

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Stan i podział

Kreator to demo z czystymi modułami, **niewpięte do gry**. Ma kiedyś zastąpić sprite'y kadłubów: z małego JSON-a liczy ten sam
pakiet co sprite (alfa → belki, albedo, mapa powierzchni HullSurface, emisja, mocowania). Opis formatu, wyglądu i narzędzi:
`docs/KREATOR-KADLUBA.md`; plan „stoczni z klocków” (etapy 1A–4): `docs/PLAN-KREATOR-STOCZNIA.md`.

- `src/game/hullDesign/` (czyste, bez three i DOM): `hullDesignSchema.js` (format, normalizacja, `expandHullDesign` — lustro,
  części, kasztele, klocki → zwykłe bryły), `hullDesignGeometry.js` (pola odległości poziomów, metryka ośmiokątna, alfa fizyki,
  komórki belek), `hullDesignBlocks.js` (KLOCKI: paleta, wielokąty, suma / różnica wielokątów, szczelina płyt),
  `hullDesignBuildable.js` (strażnik `isPlayerBuildable`), `hullDesignParts.js`, `hullDesignCastles.js`,
  `hullDesignSystems.js` (sieć systemów: kto z kim), `hullDesignSystemSlots.js` (sloty systemów presetów),
  `hullDesignPipes.js` (trasy sieci, kontrola `pipeNetworkCheck`, raster, martwe kable `markPipeNetPower`), `hullDesignRegularize.js` (standaryzacja wielokątów `reg`), `hullDesignPresets.js`
  (presety — tylko elementy edytora gracza), `hullDesignRecipe.js` (receptura, mocowania), `hullDesignClass.js` (klasa
  okrętu: limity mostka, bilans mocy rdzenia, straż akcji); dane klas i rdzeni — `src/data/shipClasses.js`;
  `hullDesignBuild.js` (budowa etapami z pamięcią — § „Budowa: worker i pamięć etapów”) z workerem
  `hullDesignBuild.worker.js` i klientem strony `hullDesignBuildClient.js`, `hullDesignHalf.js` (float16 bez three),
  `hullDesignPaint.js` (pędzel — § „Warstwa barw”).
- `src/3d/hullDesign/hullComposer.js` — kompozytor TSL (pakiet z pól; mapy i passy barw), `hullDecalAtlas.js`.
- Demo `dema/kreator-kadluba-webgpu.html` / `.js` (edytor na Core3D, A/B ze sprite'ami) z dwoma interfejsami: STOCZNIA
  (domyślny, przyjazny: `dema/kreator-kadluba-stocznia.js` — § „Stocznia”) i WARSZTAT (pełny panel narzędzi,
  `?ui=warsztat`), podgląd przeciągania `dema/kreator-kadluba-podglad.js`, testy `tests/hullDesign.test.mjs`,
  `tests/hullDesignBuild.test.mjs`, `tests/hullDesignPaint.test.mjs`,
  `tests/hullDesignBlocks.test.mjs`, `tests/hullDesignNetwork.test.mjs`, `tests/hullDesignClass.test.mjs` i `tests/shipClasses.test.mjs`, zrzuty `scripts/webgpu/kreator-kadluba-demo.mjs`, pomiar floty TN (IoU alfy,
  podkład do układania klocków) `scripts/kreator-tn-ab.mjs`, gniazda broni TN z gry `scripts/kreator-gniazda-tn.mjs`.

## Decyzje użytkownika

- Wygląd: STYL Terra Novy, nie kopia sprite'a 1:1; wzór czystego stylu — sprite Bellatora (2026-10-14). Fazy 45° zostają.
- „Stocznia z klocków” (2026-10-20): gracz składa każdy kadłub z palety prostych kształtów; flota TN ma się dać zbudować tym
  samym edytorem „bez czitowania” — preset zawiera tylko narzędzia gracza (klocki na siatce, kasztele, części, moduły,
  naklejki, pióro do 16 pkt), bez obrysu sprite'a. Pilnuje `isPlayerBuildable` na wszystkich presetach (test). Flota TN
  jest z klocków (etap 1B): IoU alfy ze sprite'em ≥ 0,9 (test), najwyżej 60 klocków na połowę okrętu.
- Systemy (rdzeń, mostki, silniki, ładownie, zbiorniki) mają stałe miejsca dla klasy i kadłuba; kable i rury wynikają
  z systemów i biegną rowami między płytami (etap 1C).
- Edytor jak w Spore (2026-10-21): elementy przeciąga się z przyjaznej palety kart na okręt (drag & drop), BEZ siatki
  i kolorowych („zielonych”) obrysów — widać sam okręt i elementy; dużo podstawowych kształtów z przeciąganiem
  i powtarzaniem, żeby przyjemnie budowało się też od zera. Dawny panel zostaje jako „Warsztat”.
- Klasa okrętu z mostka i rdzenia (etap 2, 2026-10-21, `docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md`): klasy I–VI (Fregata,
  Niszczyciel, Krążownik, Pancernik, Kapitał — lotniskowiec to rola, Superkapitał); Atlas poza drabiną (unikat fabularny
  klasy VI); limity mostka TWARDE (edytor nie pozwala ich przekroczyć), moc rdzenia — limit MIĘKKI (urządzenia ponad moc
  gasną wg priorytetu gracza, zapas mocy w napęd); liczby z tabel propozycji, moc rdzeni skalibrowana na domyślnym
  uzbrojeniu NPC.
- Malowanie barwami nacji (2026-10-23): „teksturowanie osobno, żeby można było »malować« barwami nacji” — warstwa barw
  (paleta nacji, pędzel, naklejki) zmienia się bez przebudowy kadłuba; piraci mają własny znak BEZ czaszek.

## Budowa: worker i pamięć etapów

- Każda zmiana projektu → `requestBuild(fast)` (historia + `scheduleBuild`) → worker budowy: etapy z pamięcią po
  kluczu wejścia (`hullDesignBuild.js`: rozwinięcie → GEOMETRIA (bryły rozwinięte, styl, detal, rozdzielczość) →
  rowki → SIEĆ (moduły, rury, ustawienia sieci + geometria) → MOC (martwe kable) → klasa / receptura / mocowania →
  PAKIETY tekstur float16 → przy pełnej budowie alfa fizyki i komórki). Klucze pomijają odwołania `part` / `castle`
  i `mirrorOf`. Kontrola sieci, systemy i spójność ramy (`res.checks`, `field.integrity`) przychodzą PO obrazie —
  panele odświeżają się drugi raz; kod strony nie liczy `hullFrameIntegrity` na nowym polu sam (bierze ostatnią znaną).
- Nowa ścieżka edycji woła `requestBuild` (jak dotąd); nowe pole projektu czytane przez etap → do klucza tego etapu
  (`kGeo` / `kPipes` w `hullDesignBuild.js`), inaczej pamięć odda stary wynik. Pakiety (`packHull*`) muszą dawać te
  same bity co ścieżka bez pakietów w `HullComposer.setDesign` (test `hullDesignBuild`).
- Przeciąganie (`fast`): pole w połowie rozdzielczości, sieć z poprzedniego podglądu na tej samej siatce (`pipesStale`;
  A* dopiero po puszczeniu), kompozytor `render()` bez odczytu, obraz z celów kompozytora na kwadzie podglądu (ciało gry
  ukryte `hideHexVisual`), BEZ ciała gry. Nowsza praca przerywa starszą na granicy etapu, gdy nowa albo trwająca jest
  pełna; podgląd w toku kończy się i pokazuje.
- Pole na stronie (`S.field`) ma `levels`, `loops`, `grid`, pudła, `expanded`, `pipeNet`, `packed` — bez `oct`,
  `dome`, `groove`, `pipeTex` (są tylko w pakietach). Ciało gry: alfa fizyki i komórki z workera, albedo i mapa
  powierzchni z odczytu (ALB, SURF; emisja na żądanie widoku — `readEmission`), kanwy CPU (`willReadFrequently`:
  odczyt kanwy z GPU w `createHull` czekał na kolejkę), kanwy i kadłub w osobnych zadaniach.
- Miniatury palety (`composerExclusive`) zajmują kompozytor między budowami (`S.thumbBusy`); po nich cele kompozytora
  mają cudze mapy — `composer.mapsRev` ≠ `S.mapsRev`, ścieżka barw robi wtedy pełny render z pakietów `S.field`.
- Pomiar: `node scripts/webgpu/kreator-plynnosc.mjs` (rytm 60 Hz — bez niego headless zapycha kolejkę GPU; długie zadania
  ma być 0 przy edycjach Custosa…Colossusa), liczby — `docs/KREATOR-KADLUBA.md` § „Płynność edycji”.

## Warstwa barw (malowanie barwami nacji)

- Kompozytor: GEO, EMIS (bez barwy okien — siła okien w kanale A; okna i mostek dokładają `winE`, nie `winC`) i SURF to
  MAPY (tylko kształt); BASE, ALB i EOUT — PASSY BARW (`p.colors`). Barwy: `setColors(design, pędzel)` (paleta
  z nadpisaniami `design.paint` + tabela pędzla w wierszach 12+ `U.pal`, mapa pędzla przy nowym kluczu), `setDecals`,
  `renderColors()`, `bakeColors()`; gra (etap 3, niewpięte) — `bakeLiveries` (mapy raz, barwy po kolei).
- Nowa barwa używana w passach map → przenieś ją do passu barw (jak okna: siła w mapie, barwa w ALB / EOUT), inaczej
  zmiana palety nie odświeży obrazu ścieżką barw.
- Palety (`HD_PALETTES`): Terra Nova, frakcje gry (`HD_FACTION_PALETTE`: mars, inner, belt, outer, pirate), Atlas,
  Cywilny. Żadna barwa poza oknami nie może zapalać `hullGlowMask` (test `hullDesignPaint`); `glowSafeLinear` ścisza
  niebieski do 0,38 przy czerwonym < 0,25 (zgodnie z maską). Emblemat nacji `HD_PALETTE_EMBLEM` (piraci — `raider`,
  bez czaszek), barwa `HD_PALETTE_EMBLEM_COLOR`; emblemat z wyboru palety ma `nation: true`.
- Pędzel: `paint` na klocku (nie wycięciu) albo kasztelu — slot `HD_PAINT_SLOTS` albo '#rrggbb' (`normalizeHullPaint`);
  płyty w tej barwie zamiast płyty / nadbudówki palety (`plateC`). Raster `hullPaintLayer` na siatce pola (2 × 2
  próbki; R — indeks w tabeli, A — pokrycie), barwy slotów rozwiązuje kompozytor z palety w chwili wypieku. Nowy
  element do malowania → `hullPaintStrokes` + walidacja w normalizacji.
- Warstwa barw nie zmienia geometrii: `hullDesignShapeKey` pomija `palette`, `paint` (projekt, klocki, kasztele),
  `decals` i `name`. Nowe pole tylko-barwne → dopisz do pomijanych; pole zmieniające kształt, sieć albo mapy NIE może
  być na tej liście (ścieżka barw pokazałaby stary kształt).
- Demo, ścieżka barw (`runColors`): ten sam klucz kształtu co POKAZANY pełny obraz (`S.shownShapeKey`; podgląd go
  zeruje) i wolna budowa → passy barw, albedo z celu ALB kopiowane na GPU do tekstury skóry kadłuba
  (`acquireHullVisualTexture` + `copyTextureToTexture`, mipmapy robi three), kanwa CPU odczytem w tle tylko poza
  przeciąganiem. Obraz = pełna przebudowa (0 różnych bajtów — `kreator-barwy.mjs`, `zgodnosc`).

## Klocki

- Format: bryła `{ kind: 'block', shape: 'rect' | 'trap' | 'tri' | 'arc', x, y (środek), w, h (PEŁNE wymiary — inaczej niż
  'rect' i kasztele), rot (rad, przyciągany do 45°), flip, level (domyślnie 1), op, gap, mirror, c / a / b / arc / ri }`.
  Mało rodzajów, wpis palety (`HD_BLOCK_PALETTE`) = ustawienie parametrów. Nowy kształt: wpis palety (z `group` —
  `HD_BLOCK_PALETTE_GROUPS`) i rozpoznanie w `hullBlockPaletteId` (test: każdy wpis rozpoznaje się jako on sam); nowy
  rodzaj — dopiero gdy parametry nie wystarczą (`normalizeBlock`, `blockLocalLoops`, `blockGridViolations`,
  `hullBlockPaletteId`, test). Paleta: 22 kształty w grupach Proste / Skosy i kliny / Łuki — sześciokąt, romb i grot to
  prostokąt z fazami do połowy krótszego boku, ośmiokąt — fazy ~0,29 boku, owal — elipsa w pudle, łuk i narożnik — łuk
  z pierścieniem. `hullBlockPaletteId` patrzy też na proporcje (kwadrat, belka ≥ 4 : 1, kolec, owal), więc nazwa klocka
  zmienia się z rozmiarem.
- SIATKA: klocki w j. świata na siatce projektu `design.grid` — krok ustalany przy tworzeniu projektu
  (`hullDesignGridStep(detail)`: ~4 jd, potęga dwójki), potem stały. Suwak `detail` zmienia detal (rowy, płyty, nity), nie
  rozmiar okrętu. Strażnik: wymiary i parametry co krok, krawędzie pudła na siatce przy obrocie co 90°, środek co pół kroku
  przy 45°.
- Rozwinięcie (`expandHullBlocks`) w miejscu PIERWSZEGO klocka na liście brył: rama = suma pełnych obrysów, płyty poziomu L =
  suma płyt klocków z poziomem ≥ L, wycięcia = suma klocków-wycięć (tną wszystkie klocki, kolejność między klockami nie gra
  roli). Płyta klocka = obrys bez pasa `gap / 2` jd wokół SĄSIEDNICH klocków-płyt (różnica z poszerzonymi sąsiadami);
  nachodzące klocki scalają się w jedną płytę, klocek ramy (poziom 0) nie jest sąsiadem (płyta dochodzi do niego); przy burcie
  brzeg `rimDu` jd przez przycięcie do pola ramy (`clip: 0` + `clipIn`). Wartości domyślne z obrysu sprite'ów TN
  (`HD_BLOCK_TUNE`: rów 12 jd, brzeg 1,5 jd).
- **Pułapka: styk dwóch brył przez `min` pól daje SZEW** — na wspólnej krawędzi pole = 0 (kompozytor liczy profil płyty wprost
  z pola: rowek w płycie, w alfie półprzezroczysta kreska). Dlatego klocki łączą się sumą geometryczną (`polygonUnion`:
  kawałki krawędzi poza innymi wielokątami, wspólna krawędź o przeciwnym kierunku znika), a nie przez pole. Bryły spoza
  klocków (wielokąty, części) łączą się dalej `min` — stykające się dokładnie dają szew.
- Edytor warsztatu (narzędzie N): mysz i klawisze w sekcji „KLOCKI” na końcu `dema/kreator-kadluba-webgpu.js`; haki w kodzie
  dema są jednolinijkowe (`blockDown` / `blockDrag` / `blockUp`, `drawBlocks`, `syncBlockPanel`). R / F / X / Del działają
  tylko w narzędziu Klocki (poza nim R to rowek). Cofanie: zrzut JSON w `requestBuild` bez przeciągania — nowa ścieżka edycji
  ma po zakończeniu zmiany wołać `requestBuild(false)` (inaczej nie trafi do historii).

## Stocznia (przyjazny edytor dema)

- `dema/kreator-kadluba-stocznia.js` (`installShipyard(api)`; `api` = `shipyardApi()` w demie — stan, budowa, historia,
  `pick`, przekształcenia, fabryki elementów, `composerExclusive`). Domyślny interfejs; `?ui=warsztat` albo przycisk
  „Warsztat” — dawny panel (wybór pamięta `localStorage` `kreator.ui`). Skrypt zrzutów ładuje warsztat, etap `stocznia`
  przełącza sam (`__kreator.setUi`). Haki w demie: `installShipyard` przy starcie, `shipyard.draw(cam)` w `render()`,
  `shipyard.insets()` w `fit()`, `shipyard.refresh()` w `loadPreset`, bramka `S.ui === 'stocznia'` na początku obsług
  myszy i klawiszy warsztatu (`onDown`, `onMove`, `onUp`, `onWheel`, klawisze, `onBlockKey`) — nowa obsługa warsztatu
  też ją dostaje.
- Malowanie: „Barwy nacji” — klik: paleta + emblemat nacji (`applyNationEmblem`: emblematy z `nation` albo poprzedniej
  nacji podmienione w miejscu z barwą nacji, bez nich — para na pancerzu za śródokręciem); „Pędzel” (karty `brush:*`:
  sloty, Własna barwa = kolor naklejek, Gumka) — uzbrojona karta jak stempel, klik albo przeciągnięcie po klockach
  i kasztelach (`paintTargetAt`: kasztel, potem wierzchni klocek pod modułami) maluje `paint`, w trakcie
  `S.drag = { kind: 'stocznia-pedzel' }` + `requestBuild(true)` (ścieżka barw), na koniec jeden wpis cofania.
- Z lewej paleta kart (Kształty, Systemy, Uzbrojenie, Detale, Malowanie): przeciągnięcie karty na okręt stawia element
  (duch z kopią lustra w trakcie), klik w kartę — STEMPEL (klik na okręcie — kopia, przeciągnięcie — rząd stykających
  się kopii), kółko przy stawianiu klocka — rozmiar ×1–×4. Na okręcie: element pod kursorem świeci, przeciągnięcie
  przesuwa (Shift — kopia), upuszczenie na paletę usuwa, Esc przerywa; kółko nad zaznaczonym — rozmiar; Ctrl+D — powiel
  (po przesunięciu kopii kolejne powtarza przesunięcie), Ctrl+C / V — schowek; tło — przesuw widoku, Ctrl / Shift —
  ramka. Z prawej karta okrętu (klasa, rozmiar, gniazda, moc, wartość, lista kontrolna systemów, edytor gniazda),
  „Od zera” — kadłub wybranej klasy z kilem na osi.
- Bez siatki i obrysów poziomów (decyzja użytkownika): rysuje się tylko podświetlenie, zaznaczenie (akcent), duch,
  uchwyty i ramka; „Kontury” (O) — cienkie białe obrysy wszystkich elementów. Uchwyty rozmiaru tylko na klocku,
  który na ekranie ma ≥ 34 px krótszego boku — mniejszy chwyta się w całości (uchwyt zasłaniał środek: zamiast
  przesuwać, rozciągał).
- Wybór: moduły, części, kasztele i naklejki przed klockami, z klocków — wierzchni (ostatni na liście; `pick` dema
  bierze pierwszy). Moduły, kasztele i naklejki stawia się tylko na kadłubie (pole ramy ostatniej budowy ≤ 0) —
  upuszczone obok wracają; klocki wszędzie, z MAGNESEM: nowy klocek do 48 px od burty dosuwa się do niej po gradiencie
  pola ramy z zakładką pół kroku siatki (rama w jednym kawałku), Alt — bez magnesu, wycięcia nie przywierają.
- Nowy element palety: wpis w `buildCatalog` + fabryka w `makeObject` (moduły, kasztele, części i naklejki przez fabryki
  dema `newModule` / `newCastle` / `newPart` / `newDecal` — wspólne z warsztatem) + projekt miniatury `thumbDesign`.
  Zmiana z interfejsu kończy się `requestBuild(false)`; w trakcie przeciągania `S.drag = { kind: 'stocznia…' }`
  i `requestBuild(true)`. Stan trzymający obiekty projektu czyści się przy nowym obiekcie `S.design` (cofanie, preset,
  straż limitów mostka — `syncDesign`).
- Miniatury kart: ten sam kompozytor co okręt (projekt z jednym elementem w detalu 0,6, bez sieci), w barwach i stylu
  projektu, w tle — tylko przez `composerExclusive` (S.busy; zmiana projektu czeka w `S.pending`), wstrzymane
  w trakcie przeciągania. Drugie `composer.setDesign` poza `runBuild` bez tej osłony = wyścig z budową okrętu.

## Flota TN z klocków — zasady

- Układ z podkładu: `node scripts/kreator-tn-ab.mjs --kadlub <okręt> --kadr x0,y0,x1,y1 --px <px/j.> --krok <j.>`
  (`--bez-projektu` — sam sprite do odczytu wymiarów). Wzorem jest burta y < 0 (sprite'y z AI są niesymetryczne).
- Szwy płyt — styk klocków (`TN_SEAM` 4 jd); rowy maszynowni — odstęp między płytami nad klockiem ramy (poziom 0).
  Rowy to korytarze sieci systemów: rdzeń, gondole, zbiornik, mostek, ładownia i gniazda mają leżeć przy jednym
  spójnym korytarzu (przejście ≥ ~6 jd, inaczej rów się rwie), dysze SIDE — na prostym odcinku burty.
- Pozycje modułów, kasztelów i naklejek są stałe; siatka floty (`grid` w `tnShip`) drobniejsza niż z detalu.
- Rama każdego presetu = jedna bryła bez otworów (`hullFrameIntegrity`, test na `HD_PRESET_KEYS`, ostrzeżenie w panelu
  klocków; osobno od `isPlayerBuildable`). Szpara między płytami nad pustką → klocek ramy pod spód (rów), nie przesuwanie
  płyt: szparę na wylot generator sieci bierze za zewnętrze, a przesunięta płyta zmienia trasy A* (skośne odcinki rur —
  test sieci TN w `tests/hullDesign.test.mjs`).

## Sieć systemów (kable i rury)

- Sieć wynika z modułów (`hullDesignSystems.js`): rury paliwa zbiornik → reaktor → każda gondola MAIN i dysza SIDE, kable
  reaktor → każde urządzenie. Nowe urządzenie → `HD_POWER_LOAD` (waga = kabli w trasie), nowe źródło albo silnik →
  `HD_SYSTEM_ROLE` / `HD_FUEL_LOAD`. Kratki, klapy serwisowe TN (`hatch` v 1), naklejki i rowki nie są urządzeniami.
- Każda trasa ma dwa prawdziwe końce: przyłącze urządzenia albo węzeł / przyłącze reaktora; celów bez urządzenia nie ma.
  `pipeNetworkCheck` (wolne końce, poza obrysem, bez prądu, bez paliwa, widoczne przyłącza paliwa) daje 0 na każdym
  presecie — pilnuje `tests/hullDesignNetwork.test.mjs`.
- „Wewnątrz sylwetki” = cała szerokość wiązki (oś ± pół-szerokość) z zapasem, mierzona głębokością z transformaty
  odległości (`insideDepthSampler`), nie samym polem ramy: szew brył łączonych przez `min` udaje krawędź.
- Lustro sieci tylko wtedy, gdy każdy moduł poza osią ma bliźniaka (`modulesMirrored`); inaczej sieć liczy się na całym
  kadłubie.
- Przyłącza rur paliwa (MAIN, SIDE, zbiornik) są WIDOCZNE: ostatni odcinek biegnie rowem. Gdy przy urządzeniu rowu nie ma
  (płyta z klocków dochodzi do gondoli), generator wycina kanał serwisowy (`serviceChannel`, `HD_SERVICE_CHANNEL`)
  i liczy sieć jeszcze raz.
- Sloty systemów presetów trzyma `hullDesignSystemSlots.js` (dokładany w `hullDesignPreset()`), nie funkcje presetów;
  pozycje z tabel gry (px PNG przeliczone na układ projektu — tabela w nagłówku pliku). Moduły systemów presetu mają
  `lock`, projekt od zera (`empty`) jest wolny.
- Rysunek: bieg = materiał (3 — KABLE: korytko drabinkowe, opaski; 4 — rury paliwa) + 8 · „na płytach”, osprzęt = rodzaj
  (kody 1–9) + 16 · „na płytach”; nowy rodzaj osprzętu → gałąź w `_pipeNet` i wpis w `FIT_PRIO`. Opaski i moduły nie mogą
  być niebieskie: `hullGlowMask` zapala niebieskie albedo w grze. Przy włączonej sieci maszynownia nie ma izolinii rur
  (`HD_LOOK.net.isoCount` = 0).
- Wydajność: A* po komórkach z heurystyką na kolejce kubełkowej; zmiany mierzyć na przemian ze starą wersją (minimum
  z ≥ 9 przebiegów), w testach liczyć pracę A* albo czas CPU, nie zegar ścienny.
- Demo: graf sieci pod I, panel „Sieć systemów” (liczniki wolnych końców i wiązek poza obrysem).

## Klasy okrętów i gniazda broni (etap 2)

- Dane i rachunek w `src/data/shipClasses.js` (czysty, bez kreatora): klasy (limit powierzchni, gniazd, ciężkich, rozmiar
  broni), rdzenie (MW), utrzymanie `0,07 · pow^0,6`, tarcza `0,5 · utrzymanie`, pobór gniazda (`energyCost` broni; brak
  broni — mediana typu i rozmiaru; `weapon: ''` — 0; rakieta 2 MW), kolejka mocy `shipPowerBalance`, napęd 0,7–1,2.
  Kreator czyta je przez `hullDesignClass.js`; gra (etap 3) ma czytać te same funkcje.
- Projekt: `bridgeLevel` / `coreLevel` (0 — z powierzchni / jak mostek; rdzeń ≤ mostek + 1), `powerPriority`. Gniazdo =
  moduł `mount` { slot, size, weapon } albo wieża `turret_*` (główne S / M / L) albo wrota `hangar` (hangarowe) —
  zawsze przez `hullDesignMountOf`, nie po typie modułu. Nowy typ gniazda → `HD_MOUNT_SLOTS` / `HD_MOUNT_MODULES`,
  wygląd w kompozytorze (`_mountLook`), pobór w `shipClasses.js`.
- Gniazda floty TN są danymi (`HD_PRESET_MOUNTS` w `hullDesignSystemSlots.js`) z `SHIP_EDITOR_DEFAULTS` gry — po zmianie
  gniazd w grze albo obrysu presetu przelicz `node scripts/kreator-gniazda-tn.mjs --zapisz` (duplikaty, pary burt,
  sadzanie na kapsułach / ramach, dosuwanie od modułów i kanałów serwisowych); test pilnuje liczby na typ, broni = NPC
  i braku nakładania. Gniazda bez pary (Bellator) wyłączają lustro sieci.
- Każdy preset mieści się w limitach swojej klasy (`HD_PRESET_CLASS`, test); Atlas II — poza drabiną
  (`HD_PRESET_OUTSIDE_LADDER`). Kalibracja: preset TN na swoim rdzeniu ma ~20% zapasu (test ± 5%) — zmiana broni NPC,
  `energyCost` albo gniazd gry wymaga przeliczenia mocy `CORE_LEVELS`.
- Niedobór mocy: `hullDesignClass` → `applyHullDesignPower(field, cls)` PRZED `composer.setDesign` (oznacza martwe biegi
  i liczy raster od nowa; trasy bez zmian). Bieg kabli: `R2.w` = materiał + 8 · na płytach + 16 · martwy.
- Demo: każda zmiana projektu przechodzi przez `classGuard` w `runBuild` (akcja zwiększająca przekroczenie limitu mostka
  wraca); nowa ścieżka dokładania gniazd → `classMountPlace` (odmowa przed akcją).

## Rdzeń: gniazdo obudowy reaktora (v 2)

- Moduł `reactor`: v 0 — pancerna pokrywa z wentylami (rysunek kompozytora), v 1 — wewnątrz kadłuba (nic nie rysuje),
  v 2 — GNIAZDO OBUDOWY Terra Novy (domyślne `v` wpisu `HD_MODULES.reactor`, nowy moduł w demie je dostaje): ośmiokąt
  o apotemie r (= obrys kołnierza obudowy 3D gry, boki na osiach i przekątnych jak `sdOct`), szczelina, rama z nitami
  i żółtymi narożnikami, płyta pokładu ze śrubami i przepustami kabli. Gra rysuje w nim model 3D reaktora
  (`src/3d/reactor3D.js`, reguła `mostki-reaktor`). Dla sieci v 2 = v 1 (bez bryły, pień kończy się rozdzielnią w środku)
  — trasy i testy sieci bez zmian; zmiana `r` rdzenia presetu PRZESTAWIA trasy (komórki startu z `moduleBox`).
- Presety TN dostają v 2 ze slotów (`HOUSED` w `hullDesignSystemSlots.js`). Miejsca rdzeni TN to jedno źródło z grą:
  `REACTOR_CORE_MARKERS` (`src/data/reactorCores.js`) = rdzeń presetu przeliczony `HD_TN_SPRITE_FRAMES` (ta sama rama co
  sloty), `hr` = r / s — przesunięcie rdzenia w presecie TN wymaga tego samego w markerze (`tests/reactorCoreMarkers.test.mjs`).
- Demo: sekcja „REAKTOR 3D” w `dema/kreator-kadluba-webgpu.js` — ten sam model gry nad gniazdem v 2 (rozgrzewka w starcie,
  haki `reactorDemoCoresFrom` po wypieku, `reactorDemoSync` w `render()`, `window.__kreator.reactor3D`); zrzuty
  `--etapy reaktor` (z modelem, samo gniazdo, na tle okrętu).

## Mostek: gniazdo poziomu (v 2)

- Moduł `bridge`: v 0 — rysunek kompozytora (pas szyb, talerz radaru), v 2 — GNIAZDO MOSTKA Terra Novy (domyślne `v`
  wpisu, nowy moduł w demie dostaje je z poziomem klasy projektu): płyta pokładu w obrysie modelu 3D poziomu
  (`src/data/bridgeLevels.js`, ośmiokąt z fazą poziomu), szczelina, rama z nitami i żółtymi skosami, mocowania modelu
  (poziom + 1 na burtę, od IV — dziób i rufa), belki poziomu przy dziobowym brzegu, przepust kabli. Gra stawia na nim
  model 3D poziomu (`src/3d/bridge3D.js`, reguła `mostki-reaktor`).
- Poziom: `bridgeLevel` projektu (I–VI) ma pierwszeństwo, przy 0 albo klasie ponad drabiną modeli (drednot VII, tylko
  NPC) — `lv` modułu (domyślnie I; mostki drednota mają różne poziomy). `normalizeHullDesign`
  (`bridgeSocketModule`) wpisuje `lv`, pół-wymiary `w, h` = obrys / 2 i `rim` (szczelina + rama, `HD_BRIDGE_SOCKET`) —
  zmiana poziomu mostka w projekcie zmienia moduł; surowe `w, h` modułu v 2 nic nie znaczą. Bryła modułu (poziom 3)
  sięga ramy (faza poziomu + rim · (2 − √2)), trasy sieci omijają ramę (`pipeModuleSdf` z `rim`). Kompozytor: `B.z` =
  poziom + faza / 100.
- Presety TN mają mostek v 2 ze slotów (`SOCKET` w `hullDesignSystemSlots.js`), miejsca = strefy gry
  (`BRIDGE_LAYOUT_PROPOSALS`, `tests/bridgeLevels.test.mjs`): Custos −42, Hasta −64, Bellator −217, Citadella −339
  (środek rufowego kasztelu — kratka i kapsuły kasztelu zdjęte), Colossus −150 (napis TERRA NOVA skrócony). Gniazdo
  nie nachodzi na obudowę reaktora, zbiorniki, gniazda broni i dysze (test); przy zbiorniku zostaje rów dla rury paliwa
  (Hasta: mostek −64, przy −67 przyłącze zbiornika szło po płycie). Fregata z klocków ma dalej mostek v 0.
- Demo: sekcja „MOSTEK 3D” w `dema/kreator-kadluba-webgpu.js` — mostki na belkach kadłuba projektu z gniazd v 2
  (`attachBeamBridges`, skala 1) i `Bridge3D` jak w grze (rozgrzewka w starcie, haki `bridgeDemoAttach` po budowie,
  `bridgeDemoSync` w `render()`, `window.__kreator.setBridge3D(false)` — samo gniazdo); zrzuty `--etapy mostek`
  (flota TN z modelem i bez, galeria I–VI na jednym kadłubie — `--tylko mostki`).
- Do decyzji: w trybie „poziom z powierzchni” (`bridgeLevel` 0) gniazdo bierze `lv` modułu, a klasa — powierzchnię
  i gniazda (`hullDesignLevels`); mogą się rozjechać.


## Jak sprawdzić

- `node --test tests/hullDesign.test.mjs tests/hullDesignBlocks.test.mjs tests/hullDesignNetwork.test.mjs
  tests/hullDesignClass.test.mjs tests/shipClasses.test.mjs` (WGSL kompozytora buduje się w Node).
- Testy budowy i barw: `node --test tests/hullDesignBuild.test.mjs tests/hullDesignPaint.test.mjs`.
- Płynność: `node scripts/webgpu/kreator-plynnosc.mjs --out .tmp/kreator-plynnosc/<katalog> [--tylko custos,bellator,colossus]
  [--profil suwak]` (długie zadania strony — 0, przerwa klatek, czas do obrazu, hash albedo; A/B — ten sam skrypt
  w worktree drugiej wersji, przebiegi na przemian); barwy nacji i pędzel:
  `node scripts/webgpu/kreator-barwy.mjs --out .tmp/kreator/barwy [--tylko bellator,colossus]` (czas zmiany barw do GPU,
  zrzuty nacji, pędzel prawdziwą myszą, zgodność ścieżki barw z pełną przebudową).
- Klasy: `node scripts/webgpu/kreator-kadluba-demo.mjs --etapy klasa --out .tmp/kreator/klasa` (panel klasy, gniazda
  Bellatora i Colossusa, niedobór mocy z martwymi kablami, odmowy limitów; liczby w `raport.json` → `klasa`).
- Zrzuty: `node scripts/webgpu/kreator-kadluba-demo.mjs --out .tmp/kreator/<katalog> [--etapy ab,rury,...,klocki]
  [--tylko custos,…,klocki]` — A/B floty TN ze sprite'ami, arkusz palety i edycja myszą (`klocki`), gniazdo obudowy
  reaktora z modelem 3D (`reaktor`), gniazdo mostka z modelem 3D poziomu i galeria I–VI (`mostek`); raport `raport.json`
  (pipeline'y synchroniczne w klatkach — ma być 0, błędy konsoli).
- Stocznia: `node scripts/webgpu/kreator-kadluba-demo.mjs --etapy stocznia --tylko stocznia --out .tmp/kreator/stocznia`
  (prawdziwa mysz przez CDP: karta → okręt, stempel z rzędem, Ctrl+D, usunięcie na paletę, moduł poza kadłubem,
  Shift+przeciągnij, od zera; liczniki w `raport.json` → `stocznia`).
- Demo: `npm run dev` → `/dema/kreator-kadluba-webgpu.html?preset=klocki` (`&ui=warsztat` — pełny panel).
