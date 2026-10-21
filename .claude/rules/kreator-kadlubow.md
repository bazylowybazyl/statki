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
  okrętu: limity mostka, bilans mocy rdzenia, straż akcji); dane klas i rdzeni — `src/data/shipClasses.js`.
- `src/3d/hullDesign/hullComposer.js` — kompozytor TSL (pakiet z pól), `hullDecalAtlas.js`.
- Demo `dema/kreator-kadluba-webgpu.html` / `.js` (edytor na Core3D, A/B ze sprite'ami), testy `tests/hullDesign.test.mjs`,
  `tests/hullDesignBlocks.test.mjs`, `tests/hullDesignNetwork.test.mjs`, `tests/hullDesignClass.test.mjs`, `tests/hullDesignDreadnought.test.mjs` i `tests/shipClasses.test.mjs`, zrzuty `scripts/webgpu/kreator-kadluba-demo.mjs`, pomiar floty TN (IoU alfy,
  podkład do układania klocków) `scripts/kreator-tn-ab.mjs`, gniazda broni TN z gry `scripts/kreator-gniazda-tn.mjs`.

## Decyzje użytkownika

- Wygląd: STYL Terra Novy, nie kopia sprite'a 1:1; wzór czystego stylu — sprite Bellatora (2026-10-14). Fazy 45° zostają.
- „Stocznia z klocków” (2026-10-20): gracz składa każdy kadłub z palety prostych kształtów; flota TN ma się dać zbudować tym
  samym edytorem „bez czitowania” — preset zawiera tylko narzędzia gracza (klocki na siatce, kasztele, części, moduły,
  naklejki, pióro do 16 pkt), bez obrysu sprite'a. Pilnuje `isPlayerBuildable` na wszystkich presetach (test). Flota TN
  jest z klocków (etap 1B): IoU alfy ze sprite'em ≥ 0,9 (test), najwyżej 60 klocków na połowę okrętu.
- Systemy (rdzeń, mostki, silniki, ładownie, zbiorniki) mają stałe miejsca dla klasy i kadłuba; kable i rury wynikają
  z systemów i biegną rowami między płytami (etap 1C).
- Klasa okrętu z mostka i rdzenia (etap 2, 2026-10-21, `docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md`): klasy I–VI (Fregata,
  Niszczyciel, Krążownik, Pancernik, Kapitał — lotniskowiec to rola, Superkapitał); Atlas poza drabiną (unikat fabularny
  klasy VI); limity mostka TWARDE (edytor nie pozwala ich przekroczyć), moc rdzenia — limit MIĘKKI (urządzenia ponad moc
  gasną wg priorytetu gracza, zapas mocy w napęd); liczby z tabel propozycji, moc rdzeni skalibrowana na domyślnym
  uzbrojeniu NPC.

- Drednoty (2026-10-21, `docs/BRIEF-drednot.md`): klasa VII ponad drabiną, TYLKO NPC — gracz jej nie wybierze; drednot
  Terra Novy i piracki „Vengeance” w kreatorze z klocków (styl floty, „bez czitowania”, rama w jednym kawałku) do oceny.

## Klocki

- Format: bryła `{ kind: 'block', shape: 'rect' | 'trap' | 'tri' | 'arc', x, y (środek), w, h (PEŁNE wymiary — inaczej niż
  'rect' i kasztele), rot (rad, przyciągany do 45°), flip, level (domyślnie 1), op, gap, mirror, c / a / b / arc / ri }`.
  Mało rodzajów, wpis palety (`HD_BLOCK_PALETTE`) = ustawienie parametrów. Nowy kształt: wpis palety; nowy rodzaj — dopiero
  gdy parametry nie wystarczą (`normalizeBlock`, `blockLocalLoops`, `blockGridViolations`, `hullBlockPaletteId`, test).
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
- Edytor (demo, narzędzie N): mysz i klawisze w sekcji „KLOCKI” na końcu `dema/kreator-kadluba-webgpu.js`; haki w kodzie
  dema są jednolinijkowe (`blockDown` / `blockDrag` / `blockUp`, `drawBlocks`, `syncBlockPanel`). R / F / X / Del działają
  tylko w narzędziu Klocki (poza nim R to rowek). Cofanie: zrzut JSON w `requestBuild` bez przeciągania — nowa ścieżka edycji
  ma po zakończeniu zmiany wołać `requestBuild(false)` (inaczej nie trafi do historii).

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

## Drednoty: klasa VII tylko dla NPC

- Klasa VII (`NPC_SHIP_CLASSES`, rdzeń R7 w `NPC_CORE_LEVELS` — moc dwóch rdzeni razem) stoi OBOK `SHIP_CLASSES`:
  drabina gracza (`SHIP_CLASSES`, `SHIP_CLASS_MAX`, `coreLevelMax` ≤ 6, `classForHull`) jej nie zna. Funkcje poziomu
  (`shipClass`, `coreLevel`, `shipClassCheck`) przyjmują 7; projekt dostaje go tylko z polem `npc: true` (normalizacja
  obcina mostek i rdzeń do VI / R6), w demie opcje VII / R7 są ukryte poza projektem NPC, `setBridgeLevel` odmawia.
  Nowa klasa NPC → wpis w `NPC_SHIP_CLASSES` + `NPC_CORE_LEVELS`, nie w drabinie.
- Superbroń klasy (`superweapon`): gniazdo wbudowane BEZ przypisanej broni bierze jej planowany pobór
  (`mountPowerMW(…, cls)`, `shipPowerBalance({ bridgeLevel })`). Gniazda nowych broni briefu (superlaser, jony,
  promienie ściągające) zostają bez broni — liczą się typową bronią gniazda — póki gra ich nie ma (etapy E2–E5).
- Urządzenia spoza gniazd: kategoria mocy `device` (`DEVICE_MW`, `hullDesignDeviceList`) — projektor studni
  grawitacyjnej `grav_proj`; generator tarczy `shield_gen` to źródło tarczy (bierze pobór tarczy; tarcza bez prądu →
  generatory martwe). Oba są systemami presetu (`HD_SYSTEM_TYPES`, `lock`) i urządzeniami sieci (`HD_POWER_LOAD`);
  wygląd TN w kompozytorze (kody 15, 16 — gałęzie po ładowni).
- Gniazda drednotów to dane briefu (`HD_NPC_PRESET_MOUNTS`: typ, rozmiar, promień [j.] i broń na gniazdo, wrota hangarów)
  POZA blokiem `@gniazda` narzędzia TN (`kreator-gniazda-tn.mjs` ich nie liczy). Gniazdo o promieniu > ~41 j. nie
  przejdzie testu głębokości: pole ramy jest obcięte do pasma 48 j. (`bandMax`).
- SKALA DETALU: drednot TN ma `detail` 1,25 j./jd (nie długość / 1700 ≈ 3,2 — płyty, nity i rowy 3,5× większe niż
  u Colossusa, „powiększony Colossus”); sekcje płyt w skali floty, więc okręt 3,5× dłuższy ma ich więcej. Przy
  1,2 teksela/j. (`HD_TEX.min`) daje to ~1,5 teksela/jd — jak Colossus. Obraz drednota (6 539 × 2 056) mieści się
  dopiero pod sufitem `HD_COMPOSER_LIMITS.maxSide` = 8 192 (gwarantowane minimum WebGPU; 4 096 dawało 0,76 teksela/j.).
  Pomiary wypieku i pamięci: `docs/KREATOR-KADLUBA.md` § „Drednoty”.
- Osprzęt sieci ma numer 16-bitowy w rastrze (`pipeB`: G + 256 · A; `HD_PIPE_TUNE.maxFits` 511, kompozytor `pipeFits`
  512) — drednot ma ~430 elementów, Colossus ~290 (8 bitów obcinało nadmiar od najniższego priorytetu). Biegi zostają
  8-bitowe (`maxRuns` 255; drednot ~130).
- Ostrze z pasów równoległych do burty: trapez obrócony o 90° (lewy bok klocka = zewnętrzna krawędź pasa), skos 1 : 3,
  x co 12 j. — wierzchołki na siatce 4 j. (`band` / `bandIn` w `dreadnought()`).

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

## Jak sprawdzić

- `node --test tests/hullDesign.test.mjs tests/hullDesignBlocks.test.mjs tests/hullDesignNetwork.test.mjs
  tests/hullDesignClass.test.mjs tests/hullDesignDreadnought.test.mjs tests/shipClasses.test.mjs` (WGSL kompozytora buduje się w Node).
- Drednoty: `node scripts/webgpu/kreator-kadluba-demo.mjs --etapy drednot --tylko dreadnought --out .tmp/kreator/drednot
  [--detale 1,1.25,3.2]` (cały okręt, A/B z Colossusem, dziób, rufa, burta, sponson, sieć, panel klasy; czasy wypieku
  i pamięć w `raport.json` → `drednot`). Szybki podgląd układu bez GPU (poziomy, moduły, sieć) — wystarczy
  `buildHullField` + `pipeNetworkCheck`; preset drednota liczy się w Node ~0,5 s (z siecią ~0,8 s).
- Klasy: `node scripts/webgpu/kreator-kadluba-demo.mjs --etapy klasa --out .tmp/kreator/klasa` (panel klasy, gniazda
  Bellatora i Colossusa, niedobór mocy z martwymi kablami, odmowy limitów; liczby w `raport.json` → `klasa`).
- Zrzuty: `node scripts/webgpu/kreator-kadluba-demo.mjs --out .tmp/kreator/<katalog> [--etapy ab,rury,...,klocki]
  [--tylko custos,…,klocki]` — A/B floty TN ze sprite'ami, arkusz palety i edycja myszą (`klocki`), gniazdo obudowy
  reaktora z modelem 3D (`reaktor`); raport `raport.json`
  (pipeline'y synchroniczne w klatkach — ma być 0, błędy konsoli).
- Demo: `npm run dev` → `/dema/kreator-kadluba-webgpu.html?preset=klocki`.
