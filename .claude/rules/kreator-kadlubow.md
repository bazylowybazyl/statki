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
  `hullDesignPipes.js` (trasy sieci, kontrola `pipeNetworkCheck`, raster), `hullDesignRegularize.js` (standaryzacja wielokątów `reg`), `hullDesignPresets.js`
  (presety — tylko elementy edytora gracza), `hullDesignRecipe.js` (receptura, mocowania).
- `src/3d/hullDesign/hullComposer.js` — kompozytor TSL (pakiet z pól), `hullDecalAtlas.js`.
- Demo `dema/kreator-kadluba-webgpu.html` / `.js` (edytor na Core3D, A/B ze sprite'ami), testy `tests/hullDesign.test.mjs`,
  `tests/hullDesignBlocks.test.mjs` i `tests/hullDesignNetwork.test.mjs`, zrzuty `scripts/webgpu/kreator-kadluba-demo.mjs`, pomiar floty TN (IoU alfy,
  podkład do układania klocków) `scripts/kreator-tn-ab.mjs`.

## Decyzje użytkownika

- Wygląd: STYL Terra Novy, nie kopia sprite'a 1:1; wzór czystego stylu — sprite Bellatora (2026-10-14). Fazy 45° zostają.
- „Stocznia z klocków” (2026-10-20): gracz składa każdy kadłub z palety prostych kształtów; flota TN ma się dać zbudować tym
  samym edytorem „bez czitowania” — preset zawiera tylko narzędzia gracza (klocki na siatce, kasztele, części, moduły,
  naklejki, pióro do 16 pkt), bez obrysu sprite'a. Pilnuje `isPlayerBuildable` na wszystkich presetach (test). Flota TN
  jest z klocków (etap 1B): IoU alfy ze sprite'em ≥ 0,9 (test), najwyżej 60 klocków na połowę okrętu.
- Systemy (rdzeń, mostki, silniki, ładownie, zbiorniki) mają stałe miejsca dla klasy i kadłuba; kable i rury wynikają
  z systemów i biegną rowami między płytami (etap 1C); klasa okrętu z mostka i rdzenia (etap 2, liczby do decyzji).

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

## Jak sprawdzić

- `node --test tests/hullDesign.test.mjs tests/hullDesignBlocks.test.mjs tests/hullDesignNetwork.test.mjs` (WGSL
  kompozytora buduje się w Node).
- Zrzuty: `node scripts/webgpu/kreator-kadluba-demo.mjs --out .tmp/kreator/<katalog> [--etapy ab,rury,...,klocki]
  [--tylko custos,…,klocki]` — A/B floty TN ze sprite'ami, arkusz palety i edycja myszą (`klocki`); raport `raport.json`
  (pipeline'y synchroniczne w klatkach — ma być 0, błędy konsoli).
- Demo: `npm run dev` → `/dema/kreator-kadluba-webgpu.html?preset=klocki`.
