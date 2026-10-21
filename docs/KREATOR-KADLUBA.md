# Kreator kadłuba — demo i raport (2026-10-14, v2: flota Terra Novy)

Cel: sprawdzić na prawdziwym oświetleniu gry, czy kadłub złożony przez gracza z bloków, wielokątów, gotowych części,
modułów i naklejek może zastąpić sprite'y kadłubów (dzisiejsze są z AI albo cudze). Kreator liczy **ten sam pakiet
co sprite** (alfa → belki, albedo, mapa powierzchni, emisja, mocowania), więc reszta gry nie musi wiedzieć, skąd
kadłub przyszedł. **Nic nie jest wpięte do gry** — demo i czyste moduły.

v2 (prośba użytkownika: „poza Orbisem reszta jest tragiczna — zbliżyć się wyglądem do sprite'ów, odtworzyć statki
Terra Novy”): cztery poziomy (ciemna rama z maszynownią pod białymi płytami pancerza), wielokąty z otworami, skala
detalu, metryka ośmiokątna (linie i rury z fazami 45°), moduły w stylu TN, gotowe części, rowki, a w demie pięć
okrętów Terra Novy odtworzonych w kreatorze i porównanie A/B z ich sprite'ami.

## Jak uruchomić

- Demo: `npm run dev` → `/dema/kreator-kadluba-webgpu.html` (otwiera się z lotniskowcem Citadella; flota TN z siecią
  systemów — suwak „sieć rur”, ⟳ inne wiązki, I — graf sieci, panel „Sieć systemów”; narzędzie Rura W).
  `?preset=citadella|custos|hasta|bellator|colossus|klocki|tnparts|tnparts2|orbis|atlas2|destroyer|pirate|empty`,
  `?clean=1` bez paneli. A — A/B (kreator ↔ sprite tego samego okrętu), U — sprite jako podkład pod projektem.
- Zrzuty: `node scripts/webgpu/kreator-kadluba-demo.mjs [--out .tmp/kreator/demo] [--tylko citadella]
  [--etapy ab,rury,style,mapy,czesci,edycja]` → `.tmp/kreator/demo/` (flota TN: `<okręt>-ab.png` — oba w kadrze, ta sama
  skala; `<okręt>-a|b-fit|gra1|det.png` — kadr na okręt, zoom 1, zbliżenie ×3 przy rufie; części: `czesci-*.png`;
  mapy pakietu `*-mapa-*.png`; edycja `edycja-*.png`). Klocki: `--etapy klocki --tylko klocki` → `klocki-*.png`
  (fregata z klocków: edytor, kadr, zbliżenie, zoom 1, A/B z Custosem; arkusz palety; edycja myszą — stawianie,
  przeciąganie, obrót, cofanie i ponawianie, liczby w `raport.json` → `mysz_klocki`).
- Pomiar floty TN: `node scripts/kreator-tn-ab.mjs [--kadlub custos,hasta,…] [--kadr x0,y0,x1,y1] [--px 10]
  [--krok 5] [--bez-projektu] [--tylko-iou]` → IoU alfy projektu i sprite'a (konsola, `iou.json`) i podkład
  `.tmp/kreator/tn/<okręt>-podklad.png` (sprite w j. świata z siatką i podpisami, kontury poziomów projektu, czerwień —
  sprite bez projektu, błękit — projekt bez sprite'a; `--bez-projektu` — sam sprite do odczytu wymiarów). Obrys płyt
  sprite'a (pomiar płyt i rowów): `node scripts/kreator-obrys-tn.mjs --kadlub terran_carrier` → `.tmp/kreator/obrys/`.
- Testy: `node --test tests/hullDesign.test.mjs tests/hullDesignBlocks.test.mjs tests/hullDesignNetwork.test.mjs` (klocki, suma
  wielokątów, szczelina, strażnik „bez czitowania”, sieć systemów).

## Format projektu v2 (`src/game/hullDesign/hullDesignSchema.js`)

| Pole | Co | Uwagi |
|---|---|---|
| poziomy 0–3 | **rama** (ciemna maszynownia), **pancerz** (białe płyty), **nadbudówka**, **mostek** | wyższy leży na niższym; v1 (3 poziomy) przechodzi na v2 przesunięciem o 1 (kadłub = pancerz) |
| `blocks` | bloki 60 j. (4 × 4 komórki belek) z poziomem | jak w v1 |
| `shapes` | **klocek** (`kind: 'block'` — § „Klocki”), koło, prostokąt (`r` łuk, `ch` faza rogów, `rot`), **wielokąt** (`pts`, `holes`, `sym`, `ch`, `r`) | `sym` — połowa od osi do osi (lustro nie dubluje); wielokąty łączą się z resztą ostro (wspólne krawędzie ramy i pancerza); `clip: C` — bryła przycięta do poziomu C (zgrubny wielokąt podnosi płyty o piętro, krawędzie zewnętrzne z płyt), `clipIn` — z odsunięciem w głąb [j.] |
| `parts` | **gotowe części** `{ id, x, y, s, rot, dl }` | `src/game/hullDesign/hullDesignParts.js`, rozwijane na bryły, moduły i naklejki |
| `modules` | wieże S/M/L (`v` 0 — **kapsuła TN**: ośmiokątna rama, kwadratowy właz z ciemnym oknem; 1 — płyta z rowkiem), gondola MAIN (`v` 0 — **beczka**: gęste żebra, kołnierze, rury, dzwon dyszy; 1 — blok z kratą; `n` dysz), luk (`v` 1 — **klapa TN**), reaktor (`v` 1 — wewnątrz), mostek, **kratka** (`v` 0 — prosta, 1 — **radiator TN**, 2 — **krata**), **wrota hangaru** (`doors`), **pierścień** (`v` 1 — **iluminator**, 2 — iluminator w ośmiokątnej ramie), **zbiornik paliwa** (`v` 0 — walec, 1 — kula), **dysza SIDE** (wydech wzdłuż +x modułu), **ładownia** (`v` 0 — wrota, 1 — klapa); `lock` — system na stałym miejscu (preset) | mocowania (gniazda, dysze MAIN i SIDE, rdzenie, zbiorniki, ładownie, lampy) z modułów — § „Sieć systemów” |
| `castles` | **kasztele** — schodkowe nadbudówki `{ x, y, w, h, rot, tiers, taper / taperF / taperB / taperIn, high, split, level, clip, vent, port, hatches }` | `src/game/hullDesign/hullDesignCastles.js` — § „Kasztele” |
| `grooves` | **rowki** — łamane linii podziału płyt `{ pts, w }` | płyta między rowkami ma własną fazę |
| `pipes` | **rury ręczne** — wiązka wzdłuż łamanej `{ pts, n (1–8), mat ('mix' / 'steel' / 'copper'), r (skala średnicy), over }` | domyślnie leżą też na płytach (`over: false` — tylko w rowach); lustro jak u rowków |
| `pipeNet` | **sieć systemów** generowana `{ density (0–2 — grubość wiązek), seed }` | brak pola = 0 (stare projekty bez zmian); flota TN: 1 — § „Sieć systemów” |
| `decals` | pasy, pas wzdłuż konturu, emblematy (+ **orzeł TN** — własny rysunek), napisy (`weight`) | jak w v1 |
| `detail` | skala detalu [j. / jd] | płyty, szwy, nity, rury, kratki i tarasy są w jd: fregata 150 j. ma tyle detalu na długość co lotniskowiec (jak sprite'y: detail ≈ długość / 1700) |
| `grid` | krok siatki klocków [j.] | ustalany przy tworzeniu projektu (brak pola — z detalu: ~4 jd, potęga dwójki: fregata 0,5, Bellator i Citadella 2, Colossus 4), potem stały — § „Klocki” |
| `bevel`, `round` | skala i profil fazy krawędzi płyt | TN: 1,9 i 1 (gruba, zaokrąglona „poduszka” jak w sprite'ach) |
| `panels` | widoczność losowego podziału płyt | 1 — pełny; TN: Citadella i Colossus 1, Custos i Hasta 0,55, Bellator 0,4 (jak w sprite'ach) |
| `windows` | okna tarasów (rząd świateł) | TN: 0 |

## Wygląd (kompozytor `src/3d/hullDesign/hullComposer.js`)

- **Rama bez pancerza = maszynownia**: SIEĆ SYSTEMÓW (§ „Sieć systemów” — rury paliwa i kable), skrzynki, żebrowane
  walce i kraty. Bez sieci (gęstość 0) — wiązki rur wzdłuż krawędzi płyt (izolinie pola — same zakręcają, ile się
  zmieszczą w szczelinie, do 4; po metryce ośmiokątnej `octagonalField`, więc w narożnikach wklęsłych z fazą 45°, nie
  łukiem — jak w sprite'ach); przy włączonej sieci izolinii nie ma — w rowach leżą tylko trasy sieci.
- **Płyty pancerza**: stroma ściana + zaokrąglona faza (`bevel`, `round`), linia przy krawędzi (metryka ośmiokątna)
  i nity na szerokich płytach, gruba płyta (wnętrze szerokiej płyty o stopień wyżej), segmenty w poprzek kadłuba
  (cięcia podłużne rzadkie) z „poduszką”, sprzęt na panelach (kratki, luki, skrzynki, płyty na płytach, szczeliny),
  piegi brudu, rdza przy stopach płyt.
- **Kopuła**: rozmyta sylwetka (jak `HullSurface` sprite'ów) w normalnych — bryła całego kadłuba łapie światło.
- **Poduszki płyt** (`HD_LOOK.panel.cushW`, `cushH`): od krawędzi płyty (za fazą) i od szwu panelu wierzch wznosi się
  łukiem, najstromiej przy krawędzi — płyty są „napompowane” jak w sprite'ach, nie płaskie jak papier.
- **Malowane światło** (`HD_LOOK.paint`, pass ALB): sprite'y TN mają wmalowane światło z lewej-góry obrazu (faza od
  światła biała, od cienia ciemna i chłodna — odbicie nieba), a gra dokłada swoje. Kreator robi to samo z normalnej
  SAMEGO reliefu (bez kopuły — sylwetka nie ciemnieje od dołu). Bez tego płyty projektu przegrywały A/B ze sprite'em
  głównie kontrastem.
- **Zużycie** (`HD_LOOK.dent`): rzadkie nieregularne wgniotki / zadrapania ~0,5–1,4 jd z jasnym brzegiem od światła,
  gęściej przy szwach i krawędziach, zamiast piasku drobnych kropek (piegi ściszone do 0,05).
- Moduły TN (z siatek współrzędnych na sprite'ach): **gondola-beczka** (żebra co ~P jd z ciemnymi szczelinami,
  2–3 brązowe kołnierze z nitami, para miedzianych rur wzdłuż bębna, dzwon dyszy z drobnymi pierścieniami — pod gondolą
  wysokość samej ramy: okruchy płyt z obrysu dokładały się do jej reliefu i w grze wychodziły czarne „klocki”),
  **radiator** (gruba rama, głęboka wnęka, zaokrąglone listwy w poprzek dłuższej osi, przegroda w dużych) i **krata**,
  **kapsuła wieży** (Colossus, Bellator), **iluminator** (gruba obręcz ze śrubami, ciemna wypukła szyba z blikiem;
  `v` 2 — w ośmiokątnej ramie), **klapa**, **wrota hangaru** (skrzydła z 5 wypukłymi pasami z ciemnymi szwami, jasne
  listwy boczne z rowkiem i 5 bursztynowymi lampkami, kolumny mechanizmu z tłokiem między skrzydłami, białe romby
  z krzyżem, zawiasy-trapezy).
- Obraz: dłuższy bok ~2560 tekseli (fregata ~16 tek./j., lotniskowiec ~2,4).

## Flota Terra Novy w kreatorze

Pięć okrętów TN jest złożonych wyłącznie z elementów edytora gracza — klocków palety (§ „Klocki”), kasztelów, modułów
i naklejek (`isPlayerBuildable`, test) — według podkładu sprite'a (`scripts/kreator-tn-ab.mjs`: sprite w j. świata
z siatką i podpisami, kontury poziomów projektu, różnice alfy). Klocki opisują połowę okrętu (burta y < 0), lustro
dopisuje drugą; klocek na osi jest symetryczny. Styl TN, nie kopia 1:1 (wzór czystego stylu — Bellator). Moduły,
kasztele, napisy i orły stoją jak w dawnych presetach z obrysu (kratki z wnęk obrysu przepisane jawnie). Projekt jest
w skali sprite'a (`getHullRenderSize`: długość ±4%, test).

| Okręt | Siatka | Klocki na połowę (rama + płyty) | Kasztele | IoU alfy ze sprite'em |
|---|---|---|---|---|
| Custos | 0,5 j. | 20 (4 + 16) | 1 | 0,916 |
| Hasta | 0,5 j. | 21 (5 + 16) | 1 | 0,957 |
| Bellator | 1 j. | 27 (6 + 21) | 1 | 0,919 |
| Citadella | 1 j. | 25 (5 + 20) | 4 | 0,960 |
| Colossus | 1 j. | 52 (7 + 45) | 5 | 0,970 |

Siatka floty jest drobniejsza niż z detalu (Bellator, Citadella, Colossus: 1 j. zamiast 2–4), żeby sekcje sprite'a
wypadły na siatce (`grid` w `tnShip`). IoU liczy się na całej alfie; sprite'y z AI są niesymetryczne (Custos, Bellator —
dolna burta inna niż górna), wzorem jest burta y < 0.

**Zasady układania:**

- szwy płyt wąskie — styk klocków z szczeliną `TN_SEAM` = 4 jd; ROWY maszynowni to odstęp między płytami nad klockami
  ramy (poziom 0), szerokie jak w sprite'ach (kilka do kilkudziesięciu jd), z rurami i maszynownią z kompozytora;
- rowy są korytarzami sieci systemów: rdzeń stoi we wnęce maszynowni albo przy kanale osi, a gondole, zbiornik, mostek,
  ładownia i gniazda leżą przy jednym spójnym korytarzu (skok pod płytą do korytarza: większość 0–60 jd, najdalej
  ~120 jd — mostek Hasty pod rufą). Wyjątek: gondole Citadelli wchodzą pod lite kasztele rufy (sprite: rufa
  z nadbudówek, kolumna z napisem nachodzi na kasztel centralny);
- dysze SIDE ze slotów sesji sieci systemów stoją na prostych odcinkach burty (Colossus: płaska burta x 408–482);
- nowego rodzaju klocka nie trzeba było: wszystko złożone z prostokątów (fazy rogów), trapezów (także obróconych
  o 90° — kliny dziobów, i równoległoboków — rampy, pasy szewronów), trójkątów i łuków.

**Odstępstwa od sprite'a:** Custos — wnęka rdzenia w grzbiecie, rów pod płytą dziobu, prosty zamiast ukośnego rów rur
za rufą; Hasta — rampa wieży jako trójkąt; Bellator — rampa jako trójkąt (w sprite'ie pas z maszynownią pod spodem),
rury między sponsonem a pasem burty pominięte (prześwit pusty); Citadella — skośna płyta dziobu z dwóch trapezów,
kasztel wysoki 3 j. niższy (rów z rurami nad kasztelem centralnym); Colossus — kilkadziesiąt bloków-szewronów
sprite'a sprowadzone do ~45 płyt, więcej kątów prostych niż w sprite'ie.

Standaryzacja obrysu (`reg` w wielokącie, `src/game/hullDesign/hullDesignRegularize.js`) zostaje w formacie projektu;
presety jej nie używają.

| Okręt | Kadłub [j.] | detail | Obraz | Węzły belek | Pole z siecią rur | Kompozytor | Razem |
|---|---|---|---|---|---|---|---|
| Custos | 151 × 56 | 0,089 | 2528 × 1024 | 40 | 226 ms | 45 ms | 352 ms |
| Hasta | 243 × 138 | 0,145 | 2560 × 1489 | 105 | 327 ms | 67 ms | 535 ms |
| Bellator | 612 × 377 | 0,366 | 2560 × 1607 | 805 | 294 ms | 76 ms | 509 ms |
| Citadella | 1056 × 438 | 0,630 | 2560 × 1102 | 1634 | 241 ms | 47 ms | 378 ms |
| Colossus | 1535 × 630 | 0,906 | 2560 × 1079 | 3298 | 252 ms | 42 ms | 389 ms |

(RTX, headless, 1600 × 900, `kreator-kadluba-demo.mjs --etapy ab`; rozwinięcie klocków w polu: 4–30 ms; przeciąganie
w edytorze liczy pole i obraz w połowie rozdzielczości.) Pipeline'y synchroniczne w klatkach: **0**, błędy konsoli: 0.
Arkusze A/B: `<okręt>-ab.png` (oba w kadrze, ta sama skala), `<okręt>-a|b-fit|gra1|det.png`.

## Sieć systemów: kable i rury paliwa (`hullDesignSystems.js`, `hullDesignPipes.js`, `hullDesignSystemSlots.js`)

Prośba użytkownika (2026-10-20): „kable idą od rdzenia do każdego elementu statku — rdzeń daje prąd, więc pokazujemy
kable; rury idą od zbiornika przez reaktor do silników MAIN i bocznych”, nic nie kończy się „donikąd” i nic nie wychodzi
poza kadłub; rdzeń, mostki, silniki, ładownie i zbiorniki stoją na stałych miejscach dla klasy i kadłuba (wolne tylko
w projekcie od zera). Wzór wyglądu — sprite'y TN: wiązki w rowach maszynowni między płytami, proste i 45°
z zaokrąglonymi kolanami, znikające pod płytami z kołnierzem na wejściu, osprzęt, najgęściej przy rufie.

**Kto z kim** (`hullDesignSystems.js`, czysty graf z listy modułów):

- PALIWO (rury): **dopływ** — każdy zbiornik → najbliższy reaktor; **do silników** — reaktor → każda gondola MAIN
  i każda dysza SIDE. Paliwo do silników płynie przez rdzeń.
- PRĄD (kable): reaktor → każde **urządzenie**: wieże i gniazda S / M / L, mostek, gondola MAIN, dysza SIDE, zbiornik
  (pompa), wrota hangaru, ładownia, pierścień i iluminatory (`well`), luk ładunkowy (`hatch` v 0). NIE są urządzeniami:
  kratki (wentylacja bierna), klapy serwisowe TN (`hatch` v 1), naklejki, rowki, rury ręczne.
- Waga trasy (rur / kabli do urządzenia): gondola MAIN 3 (zasilanie, powrót, chłodzenie dyszy), SIDE 1, zbiornik 3;
  kable: wieża L i mostek 2, reszta 1.
- Walidacja (`systemIssues`, ostrzeżenia receptury): brak reaktora, zbiornika, mostka albo MAIN.

**Moduły systemów** (`HD_MODULES`): **zbiornik paliwa** `fuel_tank` (walec poziomy z dennicami we wnęce maszynowni —
pod wnęką wysokość ramy jak pod gondolą; 3–5 obręczy ze śrubami, bursztynowy pas paliwa, króciec na dennicy −x; `v` 1 —
kula), **dysza SIDE** `thruster_side` (gniazdo-sponson przy burcie: wydech wzdłuż +x modułu, obręcz gniazda z ciemną
gardzielą na końcu przy burcie, od strony kadłuba przewód paliwa i kabel; dzwon i płomień rysuje gra w 3D), **ładownia**
`cargo` (rama z pasem ostrzegawczym, dwa skrzydła ze szwem na osi modułu i zazębieniem, żebra, szyny, bursztynowe lampy
w rogach; `v` 1 — klapa z krzyżem). Mocowania dla gry (`hullDesignMounts`): `sideThrusters` (jak `engines.side` edytora
gniazd: deg 0 — wydech na prawą burtę, 180 — na lewą), `cores`, `fuelTanks`, `cargoBays` (jak markery
`reactorCores.js` / `fuelTanks.js` / `cargoBays.js`, względem środka obrazu).

**Sloty presetów** (`hullDesignSystemSlots.js`, dokładane w `hullDesignPreset()` — osobno od funkcji presetów): markery
gry w px PNG sprite'a przeliczone na układ projektu jak obrys TN (skala `HULL_RENDER_PROFILES.length × 0,6 / dłuższy bok
płótna`, środek pudła alfy, oś symetrii; tabela przeliczeń w nagłówku pliku). Moduły systemów presetu mają `lock` —
edytor ich nie przesuwa, nie skaluje i nie usuwa (🔒 w nakładce).

| Okręt | Rdzeń | Mostek | Zbiornik | SIDE (na burtę) | Ładownia |
|---|---|---|---|---|---|
| Custos | preset −20 (automat gry) | preset −46 (w strefie gry) | oś −61 (automat gry) | 1 — tabela gry (x 29,8) | 22 ± 11 (gra: 3,7 ± 27 — nakryłaby gniazdo i kratkę) |
| Hasta | preset −30 | preset −82 (w strefie) | oś −98,5 (automat) | 2 — tabela gry | 31 ± 10 (gra: 3,2 ± 27) |
| Bellator | **−17 r 26** (`REACTOR_CORE_MARKERS`) | preset −205 (w strefie) | **oś −162** (`FUEL_TANK_MARKERS`) | 2 — automat (tabela gry pusta) | 95 ± 42 (gra: 75,7 ± 151 — nakryłaby gniazdo 40) |
| Citadella | preset −230 | preset −300 (strefa gry −387…−325: środek kasztelu z kratą i kapsułami — zostaje) | para ±75 przy komorze reaktora (automat) | 2 — tabela gry | pokłady ładowni gry = rzędy wrót hangarów presetu |
| Colossus | preset −330 | **−160** (strefa gry −238…85; preset −560) | para (−160, ±128) w maszynowni (automat) | 4 — tabela gry (bez dziobowej na skosie i 278 — gniazda) | −441 ± 40 między kratami osi kasztelu (gra: −493 ± 235) |

**Generator** (`buildPipeNetwork`, deterministyczny z `design.seed` + `pipeNet.seed`; wołany z `buildHullField` →
`field.pipeNet`, raster `field.pipeTex`):

1. siatka trasowania (komórka 5 jd) nad kadłubem — przy lustrze tylko burta y < 0, druga to lustro wyniku (gdy każdy
   moduł poza osią ma bliźniaka po drugiej burcie; część na osi bywa niesymetryczna — wtedy sieć na całym kadłubie,
   bez odbicia, inaczej odbita trasa kończyłaby się bez urządzenia). Koszt komórki:
   rów maszynowni 1 (najtaniej przy ścianie płyty), pod płytą 4, przez cudzy moduł 9, oś lustra +2,5, pas 14 jd przy
   burcie + do 1,2 (rośnie ku burcie), < 3 jd od sylwetki zakaz. Głębokość w sylwetce = max(−pole ramy, odległość do
   zewnętrza z transformaty fazowej) — szew stykających się brył (części) nie jest burtą;
2. TRZY SIECI po kolei: rury do silników, rury dopływu, kable. Każda to drzewo od PRZYŁĄCZY reaktora (komórki przy jego
   obrysie): urządzenie (najbliższe sieci pierwsze) dołącza najkrótszą trasą do najbliższego miejsca drzewa tej samej
   sieci albo do wolnego przyłącza reaktora (nowy pień; pnie co ≥ 2 komórki). A* po komórkach (kara za skręt 45° / 90° /
   135° względem kierunku wejścia, heurystyka = odległość do sieci × 1,25 dla rur, × 2,2 dla kabli; odległość
   aktualizowana Dijkstrą na kolejce kubełkowej w promieniu 48 komórek od nowej gałęzi). Komórka przyłącza urządzenia jest
   dla reszty sieci zamknięta — KAŻDA TRASA ma dwa prawdziwe końce (urządzenie i węzeł albo przyłącze reaktora).
   PRZYŁĄCZA RUR PALIWA WIDAĆ: płyty w pasie 5 komórek wokół silnika, dyszy i zbiornika +5 w koszcie, start trasy w głębi
   rowu przy urządzeniu, a przy urządzeniu z KANAŁEM SERWISOWYM (niżej) — na drugim końcu kanału, z rogami łamanej na
   osi kanału (ostatni odcinek biegnie całym kanałem prosto do urządzenia). Wiązki wcześniejszych sieci są przeszkodą
   dla następnych (+6 w koszcie, ślad w polu wolnego miejsca) — rury i kable we wspólnym rowie leżą obok siebie, krzyżują
   się tylko tam,
   gdzie inaczej się nie da (kabel chowa się pod wiązkę rur);
3. obciążenie krawędzi = suma wag tras od urządzenia do reaktora → wiązka 1 + 1,3 · log2(1 + obciążenie) rur / kabli
   (× 0,5 + 0,5 · gęstość; do 8) — kable gęstnieją przy rdzeniu, rury przy gondolach; rury dopełniają rów do połowy
   szerokości, najwyżej +2 rury ponad obciążenie;
4. biegi (odcinki drzewa między węzłami) → łamane proste: `straightenOctilinear` (schodki → prosty + 45°), `offsetRun`
   (jedno przesunięcie w poprzek na odcinek, luz od ścian i od wcześniejszych sieci), na końcu przy urządzeniu odcinek
   co 45° na 2,5 jd w moduł (przyłącze — dalej rysuje się moduł) w punkt ≥ 6 jd w głąb sylwetki, cały odcinek z zapasem
   (przewężenie przy zaokrąglonym rogu gondoli odpada — wtedy trasa jeszcze raz z innej komórki startu), kolana
   zaokrąglone. Cała szerokość wiązki z zapasem 0,6 jd w sylwetce (głębokość generatora z zapasem komórki pola —
   niezależna kontrola na innej siatce nie wychodzi mniejsza) — inaczej wiązka cieńsza (mniej rur, potem cieńsze rury);
5. osprzęt: rozgałęzienia — skrzynka rozdzielcza / obejma-trójnik (rury), puszka kablowa; wejścia pod płyty — kołnierz
   (rury), przepust (kable); przyłącza urządzeń — kołnierz (dysza SIDE), dławnica kablowa, pompa przy zbiorniku, KOLEKTOR
   na wejściu wiązki do gondoli (blok krótkich rur wzdłuż wiązki tuż za obrysem gondoli); zawory i pompy co ~95 jd rur,
   puszki co ~120 jd kabli; reaktor bez bryły (`v` 1) — rozdzielnia na końcu pnia, gdy widać go z rowu. Limity: 255
   biegów, 255 elementów osprzętu (przycinane parami lustra).

**Kanał serwisowy** (`serviceChannel`, `HD_SERVICE_CHANNEL` w `hullDesignSystems.js`): wycięcie w płytach od strony
kadłuba — przy dyszy SIDE (lokalne −x: 22 jd lub 1,8 · w, pół-szerokość ≥ 7 jd) i zbiorniku (od króćca −x; sloty TN
obracają zbiornik króćcem ku rdzeniowi) zawsze, przy gondoli MAIN (od szyjki +x) wtedy, gdy przy gondoli nie ma rowu
maszynowni (kadłuby z klocków: płyta rufy dochodzi do gondoli) albo gdy wejście rury okazało się niewidoczne — generator
sprawdza każde przyłącze MAIN zaraz po sieci rur do silników (`fuelEndVisible`: pierwsze 3 jd za obrysem i ≥ 60% z 12 jd
w rowie, oś i brzegi wiązki) i wtedy liczy sieć od nowa z kanałem (pola niezależne od kanałów z pamięci pierwszego
przebiegu); lista gondol z kanałem — `net.channels`. Generator traktuje kanał jak rów, kompozytor rysuje w nim
maszynownię (płyty zdjęte, wysokość ramy, obrzeże); kanał gondoli — znacznik +0,25 w kodzie typu modułu. Flota TN: kanał
gondoli tylko przy Bellatorze (−287, ±62) i Haście (−108, ±49,5) — szyjka za wąskim pasem płyty.

**Kontrola** (`pipeNetworkCheck` — testy i panel dema): wolne końce (koniec łamanej poza przyłączem urządzenia, który
nie styka się z innym biegiem), wiązki poza sylwetką (oś ± pół-szerokość bliżej krawędzi niż 0,5 jd; próbka, którą
ostrożny próbnik siatki uznał za płytką — szew sumy brył, komórka zapasu — sprawdzana dokładnie pierścieniami co ¼ jd
w polu ramy, inaczej fałszywe „poza” przy gondolach Hasty z klocków), urządzenia bez
drogi kablem do reaktora, silniki bez drogi rurą do reaktora albo reaktor bez dopływu ze zbiornika, WIDOCZNE
przyłącza rur paliwa (`fuelEnds` — MAIN, SIDE, zbiornik: [widoczne, wszystkie], `fuelHidden`). Wynik grafu:
`net.graph.nodes` (węzeł / przyłącze z indeksem modułu), `run.ends` (węzły końców każdej łamanej, lustro osobno).

**Rysunek** (`hullComposer.js`, `_pipeNet`): bieg ma materiał (0 mix, 1 stal, 2 miedź, 3 KABLE, 4 RURY PALIWA) + 8 ·
„na płytach”. Rury paliwa — jasna stal i miedź (bez rdzy i ciemnej stali: widać je na ciemnej maszynowni przy
silnikach), kołnierze w odcinkach, obejmy co 26 jd; rury ręczne — jak dotąd. KABLE: korytko drabinkowe (szyny po
bokach, szczeble co 3 jd widoczne między kablami), cienkie kable w ciemnej izolacji z połyskiem (pierwszy — grubszy
zasilający), kolorowe opaski co ~9 jd: czerwona, bursztynowa, zielona, biała — BEZ NIEBIESKIEJ (niebieskie albedo
świeci w grze, `hullGlowMask`). Osprzęt: kody 1–9 (skrzynka, kołnierz / przepust, zawór, pompa, kolektor, zaślepka rur
ręcznych, dławnica, puszka kablowa, rozdzielnia) + 16 · „na płytach”. Przy włączonej sieci maszynownia nie ma izolinii
rur (urywały się w rowach jak rury „donikąd”).

**Edytor (demo)**: systemy presetu zablokowane (🔒, komunikat przy próbie przesunięcia / usunięcia), projekt od zera —
wolne; nowe moduły w narzędziu M (dysza SIDE dostaje wydech ku najbliższej burcie); panel „Sieć systemów”: liczba
reaktorów / zbiorników / MAIN / SIDE / urządzeń, biegi kabli i rur, **wolne końce**, **poza obrysem**, bez prądu,
bez paliwa, bez trasy; walidacja kompletu w recepturze; **graf sieci** (I): linie źródło → odbiornik (kable żółte,
rury do silników pomarańczowe, dopływ zielony, odbiornik bez trasy — czerwony krzyżyk).

**Koszt** (generator na gotowym polu, minimum z 9 przebiegów na przemian ze starym generatorem, ta sama maszyna
obciążona innymi programami, 2026-10-20): Custos 38 ms (stary 65), Hasta 69 (82 — z kanałem gondoli: dwa przebiegi),
Bellator 64 (72 — dwa przebiegi), Citadella 52 (62), Colossus 64 (58); w przeglądarce (demo, pojedynczy wypiek)
63–123 ms; kontrola sieci ~10–20 ms (tylko przy pełnym wypieku). Test pilnuje pracy A* (rozwinięte komórki ≤ 1,5 ×
komórek siatki; dziś 0,4–0,8). Pipeline'y synchroniczne: 0.

**Narzędzia**: `node scripts/webgpu/kreator-kadluba-demo.mjs --tylko custos,hasta,bellator,citadella,colossus --etapy
ab,rury` → `<okręt>-a|b-rufa.png`, `<okręt>-a-rufa-bez.png` (bez sieci), Citadella `citadella-a-zgloszenie.png` (kadr
zgłoszenia: gondole, kolumna TERRA NOVA, kasztele) i `citadella-a-zgloszenie-edytor.png` (z nakładką i grafem sieci);
w raporcie zrzutu `siec` — wolne końce, poza obrysem, bez prądu / paliwa. Testy: `tests/hullDesignNetwork.test.mjs`
(graf, sloty, zero wolnych końców, pełna szerokość w sylwetce, zasilanie i paliwo, symetria, determinizm, koszt) i `rury:
…` w `tests/hullDesign.test.mjs` (format rur ręcznych, raster, rufa gęstsza niż dziób, proste wiązki).

**Do decyzji / dalej**: rury ręczne presetów kończą się zaślepkami (Citadella: rdzeń dziobu — ozdobny walec, nie
trasa); czy kable i rury mają kiedyś znaczenie w rozgrywce (przecięty kabel = urządzenie bez prądu) — etap 2; sloty TN
liczone na obrysie sprite'ów — po klockach (etap 1B) do sprawdzenia (tabela wyżej); ładownie gry na Custosie, Haście,
Bellatorze i Colossusie nakrywają moduły presetów — w kreatorze są mniejsze / przesunięte.

## Kasztele (`src/game/hullDesign/hullDesignCastles.js`)

Prośba użytkownika: „pomost o nieregularnych kształtach, które decydują o wyglądzie frakcji — Terra Nova rozłożyste
hulle z widocznymi rurami i podziałem na sekcje; nie wiem, jak nazwać te wzniesienia jak tył Citadelli”. Nazwa:
**kasztel** (jak nadbudówka rufowa żaglowca). Kasztel to blok-trapez na płytach albo lity:

- obrys piętra 1: prostokąt z fazami rogów — od burty `taper` (osobno róg dziobowy `taperF` i rufowy `taperB`, do
  prawie całej wysokości — blok-trapez jak kasztele Citadelli), od osi lekko (`taperIn`); kasztel na osi
  (|y| < 0,35 h) — symetryczny, bez kopii lustra;
- piętro 2 (`tiers` 2): węższe, przycięte do poziomu piętra 1; `high: 'out'` — wysoka część od burty (schodek w dół ku
  osi), `'in'` — przy osi; `split` — jaką część wysokości kasztelu zajmuje (0,4: górna półka z kratą jak kasztel
  rufowy Citadelli; kasztel na osi przy `'out'` dostaje dwie półki, po jednej przy każdej burcie; 1 — prawie cały);
- `clip: 1` — kasztel rośnie tylko na płytach pancerza (krawędzie z płyt obrysu — Colossus, wieże Bellatora i Hasty);
  bez `clip` — LITA bryła, przykrywa szczeliny obrysu pod sobą (rufa Citadelli: obrys dziedziczył ciemne szczeliny,
  więc przycięte kasztele się nie czytały);
- automat szczegółów: kratka-radiator na górnym piętrze (`vent`), iluminator (`port`), klapy na stopniu (`hatches`) —
  presety TN stawiają je ręcznie z siatek sprite'ów (`vent: 'none'`, `hatches: 0`).

Rozwinięcie (`expandHullDesign`) zamienia kasztel na wielokąty pięter i moduły — reszta kreatora o kasztelach nie
wie. Presety: Citadella — 4 lite kasztele rufowe (kolumna z pionowym napisem, jej górny blok z kratkami, wysoki
kasztel z półką i kratą, centralny trapez na osi z półkami i iluminatorami), Colossus — 5 kasztelów rufowych na
płytach, Custos / Hasta / Bellator — szczyty wież rufowych. Demo: narzędzie **Kasztel (Q)** (przeciąganie — przesuń,
kółko — skala), przełącznik „kasztel na płytach” (nowy kasztel z `clip: 1`).

## Klocki (`src/game/hullDesign/hullDesignBlocks.js`)

Prośba użytkownika (2026-10-20): „trójkąty prostokątne, różne kształty, z których gracz ułoży statek — lotniskowca Terra
Novy dziś sam nie odtworzę”. Klocek to bryła z palety prostych kształtów; z tych samych klocków gracz i presety składają
każdy kadłub (plan: `docs/PLAN-KREATOR-STOCZNIA.md`).

**Format**: `{ kind: 'block', shape, x, y, w, h, rot, flip, level, op, gap, mirror, … }` w `shapes`:

| Pole | Co |
|---|---|
| `shape` | `rect` — prostokąt, `c: [4]` — faza osobno na każdy róg (lewy-górny, prawy-górny, prawy-dolny, lewy-dolny); `trap` — trapez: górna krawędź wcięta o `a` z lewej i `b` z prawej (ujemne — wysunięta; równoległobok: `a = −b`); `tri` — trójkąt, wierzchołek `a` od lewego rogu górnej krawędzi (0 — prostokątny, `w / 2` — klin); `arc` — łuk `arc` 360 (koło / elipsa w pudle), 180 (półkole na dolnej krawędzi), 90 (ćwiartka z rogiem w lewym-dolnym), `ri` — pierścień (promień wewnętrzny / zewnętrzny) |
| `x`, `y`, `w`, `h` | środek i PEŁNE wymiary pudła w układzie klocka [j.] (inaczej niż `rect` i kasztele — pół-wymiary) |
| `rot`, `flip` | obrót [rad] przyciągany do 45°; odbicie lewo-prawo w układzie klocka (przed obrotem) |
| `level`, `op` | poziom (domyślnie 1 — pancerz), `cut` — wycięcie (na poziomie L usuwa poziomy ≥ L) |
| `gap` | szczelina płyty [jd] (domyślnie 12; 0 — płyta scala się z sąsiadem) |

Paleta (`HD_BLOCK_PALETTE` — ustawienia czterech rodzajów): prostokąt, prostokąt ze ściętymi rogami, trójkąt prostokątny,
klin, trapez prostokątny, trapez równoramienny, równoległobok, koło, półkole, ćwiartka koła, pierścień. Nowy kształt =
wpis palety; nowy rodzaj tylko wtedy, gdy parametry nie wystarczą.

**Siatka a `detail`** (decyzja 1A): klocki leżą w j. świata na siatce projektu `grid` — krok ustalany przy tworzeniu
projektu z detalu (`hullDesignGridStep`: ~4 jd, potęga dwójki) i zapisany w projekcie. Suwak detalu zmienia gęstość detalu
(płyty, nity, rury, szerokość rowów), ale nie rozmiar okrętu ani położenie klocków (gdyby klocki były w jd, zmiana detalu
skalowałaby okręt). Ta sama paleta służy fregacie (siatka 0,5 j.) i superkapitałowi (4 j.): jednostka palety to
wielokrotność dwóch kroków siatki najbliższa ~24 jd.

**Rozwinięcie** (`expandHullBlocks` z `expandHullDesign`, w miejscu PIERWSZEGO klocka na liście brył) — klocki znikają,
zostają zwykłe wielokąty, więc fazy, poziomy, pola, sieć rur i kompozytor działają bez zmian:

- **rama** (poziom 0, sylwetka) — suma pełnych obrysów wszystkich klocków dodających i ich kopii lustra,
- **płyty** poziomu L — suma płyt klocków z poziomem ≥ L. Płyta klocka to jego obrys bez pasa `gap / 2` jd wokół
  SĄSIEDNICH klocków-płyt (różnica z sąsiadami poszerzonymi o pół szczeliny; ostre szpice poszerzenia ścięte): między
  sąsiadami zostaje rów maszynowni `gapA / 2 + gapB / 2` — tędy pójdą rury i kable (etap 1C). Klocki nachodzące na siebie
  dają jedną płytę, klocek ramy (poziom 0) nie jest sąsiadem (płyta dochodzi do niego — klocek ramy to maszynownia). Przy
  burcie płyta kończy się 1,5 jd przed sylwetką (przycięcie do pola ramy: `clip: 0`, `clipIn`). Wartości z obrysu
  sprite'ów TN: rów między płytami — mediana 16–23 jd, dolny kwartyl 10–15 (domyślne 12); płyta przy burcie — mediana
  0,7–2,4 jd od sylwetki,
- **wycięcia** — suma klocków-wycięć z poziomem ≤ L (tną wszystkie klocki dodające).

Sumy są geometryczne (`polygonUnion`, `polygonDifference`): krawędzie tnie się w punktach przecięcia, kawałek zostaje, gdy
leży poza innymi wielokątami, wspólna krawędź o przeciwnym kierunku (styk) znika z obu stron, reszta sklejona w pętle.
Suma przez `min` pól dawałaby szew: na wspólnej krawędzi dwóch stykających się brył pole = 0, a kompozytor liczy profil
płyty wprost z pola (rowek w płycie, w alfie półprzezroczysta kreska).

**Koszt** (Node, pole bez sieci rur / z siecią): fregata z klocków — rozwinięcie 3,8 ms, pole 162 / 212 ms; 105 klocków
(210 z lustrem) w skali Colossusa — rozwinięcie 26 ms, pole 275 / 264 ms. W demie (RTX, headless) wypiek fregaty
0,43 s razem; pipeline'y synchroniczne w klatkach: 0.

**Strażnik „bez czitowania”** (`isPlayerBuildable(design)` w `src/game/hullDesign/hullDesignBuildable.js` → `{ ok,
violations }`): dopuszcza klocki z parametrami na siatce (wymiary i parametry co krok, krawędzie pudła na siatce przy
obrocie co 90°, środek co pół kroku przy 45°), wielokąt-pióro do 16 pkt na siatce bez otworów, kasztele, gotowe części,
moduły, naklejki, rowki i rury do 16 pkt, bloki 60 j., sieć rur; limity liczby elementów (`HD_BUILD_LIMITS`). Odrzuca obrys
sprite'a (wielokąty ze standaryzacją `reg`, setki punktów, otwory) i dawne bryły `circle` / `rect`. Przechodzą
wszystkie presety (test); dawne bryły w presetach Orbis, Atlas II, Hasta-D i Szakal są zamienione na klocki (koło
z wycięciem → klocek-pierścień, prostokąt z łukiem `r` → prostokąt z fazami).

**Preset `klocki`** — fregata TN z 10 klocków (połowa okrętu, lustro robi drugą burtę): rufa-nadbudówka na osi ze ściętymi
rogami, skrzydła rufy, grzbiet i burty z dwóch płyt każda, kliny dziobu (trapez), klocek ramy między klinami
(maszynownia), nadbudówka burty z iluminatorem, wieża mostka; moduły i naklejki jak w presetach TN.

## Gotowe części (`src/game/hullDesign/hullDesignParts.js`)

Odpowiedź na „brakuje kształtów kadłuba, mostka, modeli innych niż proste”: złożone elementy w stylu TN stawiane jak
moduł (skala, obrót, lustro, przesunięcie poziomów): wieża mostka, mostek schodkowy (3 piętra), mostek klinowy, dziób
z rozwidleniem, dziób klinowy, blok silników (3 gondole), silniki blokowe (Colossus), rufa (2 bębny), sekcja kadłuba,
sponson, rząd hangarów, blok wieży, grzbiet z portami, port. Presety `tnparts` (fregata z części na ramie z bloków)
i `tnparts2` (krążownik wyłącznie z części). Nowa część = wpis w `HD_PARTS` (bryły, moduły, naklejki w jej
układzie przy skali 1 ≈ detail 0,6).

## Demo — narzędzia

**Klocki (N)** — sekcja „Klocki” w panelu: paleta z ikonami, LPM na pustym stawia klocek (klik — rozmiar domyślny,
przeciąganie — pudło), LPM na klocku zaznacza i przesuwa (z przyciąganiem do siatki), Shift+klik dodaje do zaznaczenia,
Ctrl+przeciąganie — ramka, uchwyty — rozmiar (skosy 45° trapezu zostają 45°), R / Shift+R — obrót o 90° / 45° (grupa
wokół środka), F — odbicie, X — wycięcie, 1–4 — poziom zaznaczenia, Del — usuń, Ctrl+D — duplikat obok, strzałki — krok
siatki; suwak szczeliny zaznaczonych klocków; w panelu powierzchnia kadłuba [j.²], liczba klocków (i z lustrem), liczba
gniazd uzbrojenia i wynik strażnika „bez czitowania”. Oś lustra widoczna w narzędziu Klocki. **Ctrl+Z / Ctrl+Y** —
cofnij / ponów każdą zmianę projektu (zrzut JSON po zakończonej zmianie).

Bloki (B), przesuń / skala / obrót (V, kółko, Shift + kółko), koło (C, Shift — wycięcie), **wielokąt** (P; LPM punkty,
PPM / Enter zamyka, pierwszy i ostatni punkt na osi → symetryczny; „wielokąt-wycięcie”), **rowek** (R — łamana
linii płyt), **rura** (W — łamana wiązki; liczba rur i materiał w panelu, kółko nad rurą — średnica), **część** (K),
**kasztel** (Q; „kasztel na płytach” — z `clip: 1`), moduł (M — także zbiornik paliwa, dysza SIDE, ładownia), pas (S),
emblemat (E), napis (T); poziomy 1–4 (rama, pancerz, nadbudówka, mostek); suwaki detalu, fazy płyt, łuku, widoczności
paneli i **gęstości sieci** (⟳ — inne ziarno wiązek); **graf sieci** (I); podkład ze sprite'a (U) do odrysowania; A/B (A).
Systemy presetu (🔒) nie dają się przesunąć, przeskalować ani usunąć.

## Co trzeba zmienić w grze, żeby przyjęła projekt z kreatora

Projekt daje alfę, albedo, mapę powierzchni, emisję i mocowania. Gra dziś zakłada **sprite z pliku + tabele per
kadłub (klucz = profil renderu)**. Kolejno:

1. **Wejście kadłuba z danych zamiast pliku.** `HULL_SPRITE_PATHS_BY_ID` / `getNpcHullRenderProfileId`
   (`index.html`), `HULL_RENDER_PROFILES` (`src/data/ships.js` — długość z projektu, nie ze stałej tabeli),
   `getHullRenderSize` (rozmiar = pudło projektu × 1 j./px), kanwa fizyki = `rasterHullAlpha`. Projekt w zapisie
   gry (`loadout` / nowy klucz `hullDesigns`), kadłub odtwarzany z JSON przy wczytaniu (wypiek ~0,1–0,5 s — na
   ekranie ładowania, jak dziś `prebake`).
2. **`HullSurface.provide(image, data, w, h)`** — publiczne API zamiast wypieku ze sprite'a (demo wkłada mapę przez
   pola prywatne: `provideSurface` w demie). Lakier (`HullLacquer` — mapa kształtu z alfy) działa bez zmian.
3. **Kanał emisji skóry.** Dziś świeci tylko albedo z niebieskim (`hullGlowMask`): kreator wpisuje okna jako cyjan
   w albedo (przełącznik „okna→albedo”), a barwy palet i naklejek ścisza do b ≤ 0,38 (`glowSafeLinear`). Docelowo:
   tekstura emisji per kadłub w `createHullUniforms` / `HullObjectTextureNode`.
4. **Tabele per kadłub z mocowań projektu** (dziś ręcznie per sprite): mostki (`BRIDGE_LAYOUT_PROPOSALS`, model 3D
   z modułu „Mostek”), rdzenie reaktora (`src/data/reactorCores.js` — z modułu „Reaktor”: `hullDesignMounts().cores`),
   zbiorniki paliwa (`src/data/fuelTanks.js` — z modułu „Zbiornik paliwa”: `.fuelTanks`), dysze MAIN
   (`ENGINE_FX_DEFAULTS` — z gondol: `.mainThrusters`), dysze SIDE (`engines.side` — z modułów „Dysza SIDE”:
   `.sideThrusters`, deg jak edytor gniazd), gniazda broni (`SHIP_EDITOR_DEFAULTS` — z modułów wież; typ main / aux /
   special do dodania w module), lampy pozycyjne (`editorLights` — zrobione w demie, promień w jd), ładownie
   (`CARGO_BAY_HULLS` — z modułów „Ładownia”: `.cargoBays`; wrota gry do dobrania), `HULL_COLLISION_ARMOR`,
   `SHIP_FLIGHT_SPECS`, obrys 3D.
5. **Stocznia** — budowa od zera = ciało z wszystkimi komórkami martwymi ożywiane odrostem (`HullBodies.regrowCell`)
   z materiałem z receptury; refit = różnica komórek.
6. **Naprawa i rany** — bez zmian (mapa ran, łaty, odrost, wraki pracują na alfie i uv obrazu).

## Pytania do decyzji

1. Czy poziom zgodności floty TN z kreatora (arkusze A/B) wystarcza, żeby iść w stronę zastąpienia sprite'ów, i
   czy domknięcie luki „gęstości sprzętu” zestawem modułów / części (grafik) to dobry kierunek?
2. Gotowe części — rozwijać bibliotekę (warianty mostków, dziobów, rufy na każdą frakcję) czy dopuścić części
   rysowane przez gracza (zapis własnej części z zaznaczenia)?
3. Piętra płyt (schodki jak w sprite'ach) — wystarczy poziom klocka (pancerz / nadbudówka) i kasztele, czy dać graczowi narzędzie
   „podnieś płytę” (klik w płytę → piętro wyżej)?
4. Kanał emisji w skórze (pkt 3 listy) — robić od razu, czy na razie okna w albedo?

## Znane braki dema

- A/B: sprite referencyjny Custosa (i trochę Hasty, Bellatora) prześwietlony łuną bloomu — odbłysk oświetlenia gry na
  sprite'ach w scenie dema (lampy sprite'a są wyczyszczone, tarczy nie ma); błąd sceny porównania, nie kreatora — do
  zbadania. Projekt w A/B jest bez automatycznych reflektorów otoczenia (`autoFlood: false`; zalewały blachę
  plamami), lampy pozycyjne zostają.

- Na płytach poduszka liczona z odległości od krawędzi ma ostre załamania na dwusiecznych rogów (zagięcia „papieru”)
  — do wygładzenia.
- Moduły mają wygląd z reguł shadera; brak atlasu modułów od grafika. Wieże nie są rysowane (gniazda puste) — w grze
  rysuje je `Turret2D` / partie 3D w miejscach gniazd.
- JSON do zapisu / wczytania w panelu (bez zapisu do pliku).
- Pole odległości liczy się ~0,1–0,25 s na okręt (CPU, w wątku strony) — przy edycji przeciąganie liczy je w połowie
  rozdzielczości; w grze należałoby je przenieść do workera.
