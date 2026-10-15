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
  rur — suwak „sieć rur”, ⟳ inny układ, narzędzie Rura W).
  `?preset=citadella|custos|hasta|bellator|colossus|tnparts|tnparts2|orbis|atlas2|destroyer|pirate|empty`,
  `?clean=1` bez paneli. A — A/B (kreator ↔ sprite tego samego okrętu), U — sprite jako podkład pod projektem.
- Zrzuty: `node scripts/webgpu/kreator-kadluba-demo.mjs [--out .tmp/kreator/demo] [--tylko citadella]
  [--etapy ab,rury,style,mapy,czesci,edycja]` → `.tmp/kreator/demo/` (flota TN: `<okręt>-ab.png` — oba w kadrze, ta sama
  skala; `<okręt>-a|b-fit|gra1|det.png` — kadr na okręt, zoom 1, zbliżenie ×3 przy rufie; części: `czesci-*.png`;
  mapy pakietu `*-mapa-*.png`; edycja `edycja-*.png`).
- Obrys sprite'ów TN: `node scripts/kreator-obrys-tn.mjs --kadlub terran_carrier` (podgląd maski i wnęk na
  sprite'cie → `.tmp/kreator/obrys/`), dane presetów: `node scripts/kreator-presety-tn.mjs` →
  `src/game/hullDesign/hullDesignTNTrace.js` (wygenerowany, nie edytować).
- Testy: `node --test tests/hullDesign.test.mjs`.

## Format projektu v2 (`src/game/hullDesign/hullDesignSchema.js`)

| Pole | Co | Uwagi |
|---|---|---|
| poziomy 0–3 | **rama** (ciemna maszynownia), **pancerz** (białe płyty), **nadbudówka**, **mostek** | wyższy leży na niższym; v1 (3 poziomy) przechodzi na v2 przesunięciem o 1 (kadłub = pancerz) |
| `blocks` | bloki 60 j. (4 × 4 komórki belek) z poziomem | jak w v1 |
| `shapes` | koło, prostokąt (`r` łuk, `ch` faza rogów, `rot`), **wielokąt** (`pts`, `holes`, `sym`, `ch`, `r`) | `sym` — połowa od osi do osi (lustro nie dubluje); wielokąty łączą się z resztą ostro (wspólne krawędzie ramy i pancerza); `clip: C` — bryła przycięta do poziomu C (zgrubny wielokąt podnosi płyty o piętro, krawędzie zewnętrzne z płyt) |
| `parts` | **gotowe części** `{ id, x, y, s, rot, dl }` | `src/game/hullDesign/hullDesignParts.js`, rozwijane na bryły, moduły i naklejki |
| `modules` | wieże S/M/L (`v` 0 — **kapsuła TN**: ośmiokątna rama, kwadratowy właz z ciemnym oknem; 1 — płyta z rowkiem), gondola MAIN (`v` 0 — **beczka**: gęste żebra, kołnierze, rury, dzwon dyszy; 1 — blok z kratą; `n` dysz), luk (`v` 1 — **klapa TN**), reaktor (`v` 1 — wewnątrz), mostek, **kratka** (`v` 0 — prosta, 1 — **radiator TN**, 2 — **krata**), **wrota hangaru** (`doors`), **pierścień** (`v` 1 — **iluminator**, 2 — iluminator w ośmiokątnej ramie) | mocowania (gniazda, dysze, lampy) z modułów |
| `castles` | **kasztele** — schodkowe nadbudówki `{ x, y, w, h, rot, tiers, taper / taperF / taperB / taperIn, high, split, level, clip, vent, port, hatches }` | `src/game/hullDesign/hullDesignCastles.js` — § „Kasztele” |
| `grooves` | **rowki** — łamane linii podziału płyt `{ pts, w }` | płyta między rowkami ma własną fazę |
| `pipes` | **rury ręczne** — wiązka wzdłuż łamanej `{ pts, n (1–8), mat ('mix' / 'steel' / 'copper'), r (skala średnicy), over }` | domyślnie leżą też na płytach (`over: false` — tylko w rowach); lustro jak u rowków |
| `pipeNet` | **sieć rur** generowana `{ density (0–2), seed }` | brak pola = 0 (stare projekty bez zmian); flota TN: 1 — § „Rury” |
| `decals` | pasy, pas wzdłuż konturu, emblematy (+ **orzeł TN** — własny rysunek), napisy (`weight`) | jak w v1 |
| `detail` | skala detalu [j. / jd] | płyty, szwy, nity, rury, kratki i tarasy są w jd: fregata 150 j. ma tyle detalu na długość co lotniskowiec (jak sprite'y: detail ≈ długość / 1700) |
| `bevel`, `round` | skala i profil fazy krawędzi płyt | TN: 1,9 i 1 (gruba, zaokrąglona „poduszka” jak w sprite'ach) |
| `panels` | widoczność losowego podziału płyt | 1 — pełny; TN: Citadella i Colossus 1, Custos i Hasta 0,55, Bellator 0,4 (jak w sprite'ach) |
| `windows` | okna tarasów (rząd świateł) | TN: 0 |

## Wygląd (kompozytor `src/3d/hullDesign/hullComposer.js`)

- **Rama bez pancerza = maszynownia**: SIEĆ RUR (§ „Rury”), pod nią wiązki rur wzdłuż krawędzi płyt (izolinie pola —
  same zakręcają, ile się zmieszczą w szczelinie, do 4; przy włączonej sieci najwyżej 2, cieńsze i przerywane),
  obejmy, dalej skrzynki, żebrowane walce i kraty. Izolinie idą po metryce ośmiokątnej (`octagonalField`), więc
  w narożnikach wklęsłych mają fazę 45°, nie łuk — jak w sprite'ach.
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

Rama (sylwetka) i płyty pancerza są **obrysem sprite'ów** (`scripts/kreator-obrys-tn.mjs`): jasne, mało nasycone
piksele = płyty, maska symetryzowana względem osi okrętu (oś szukana po alfie), domknięta, małe dziury zalane,
rozcięta erozją na osobne PŁYTY, obrys konturami bloków na komórkach 1–2 px i Douglasem–Peuckerem → wielokąty płyt
z otworami (szczeliny maszynowni). Ciemne wnęki w płytach — kandydaci na moduły (kratki). Schodki płyt (płyta na
płycie — Custos, Hasta, Bellator): zgrubne wielokąty `tiers` w presecie przycięte do pancerza (`clip`). Reszta
ręcznie z siatek współrzędnych na sprite'ach: gondole, pierścienie, ośmiokątne gniazda, wrota hangarów (Citadella
2 × 5), mostki, reaktory, napisy TERRA NOVA, orły. Projekt jest w skali sprite'a (`getHullRenderSize`: długość ±4%,
test).

**STANDARYZACJA obrysu** (2026-10-14, prośba użytkownika: „ustandaryzować, poprostować i odszumić — sprite'y z AI były
zaszumione i szum przeszedł na generator: zygzak na kadłubie i w rurach”; wzór czystego stylu — sprite Bellatora).
Obrys 1:1 ze sprite'a niósł ząbki, krawędzie pod przypadkowymi kątami, piłę na skosach, okruchy płyt i różne burty —
a za nim szły fazy, linie paneli, rowy i rury. Teraz (`src/game/hullDesign/hullDesignRegularize.js`, wołane
w `treatLoop` dla brył z `reg`):

- krawędzie → linie co 45° (długie ≥ 48 jd — co 22,5°) na WSPÓLNEJ siatce linii (krok 2 jd: osiowe co krok, ukośne
  x ± y = n · krok) — sąsiednie płyty trafiają na te same linie, rów ma stałą szerokość;
- porządki MOCNE (`HD_REG_STRONG`: krawędź ≥ 4 kroki, ząbek / wcięcie do 3 kroków zalane, róg najdalej 4 kroki od
  oryginału — inaczej faza 45°), gdy kształt się nie da — łagodne (2 / 1,5 / 3 kroki);
- SCHODKI I PIŁA na skosach (ciąg ≥ 3 krawędzi ≤ 16 kroków w kierunkach ±45° od cięciwy, rogi po obu stronach
  cięciwy najwyżej 5 kroków) → jedna prosta; schody projektu (stopnie ≥ ~30 jd) zostają;
- LUSTRO burt: grupa obrysu na osi → połowa y ≤ 0 (`sym`), płyty burty y < 0 + lustro projektu, burta y > 0 odpada
  (`tnMirrorShape` w presetach); bryła dokładnie lustrzana zostaje lustrzana (wynik przycięty do połowy i odbity),
  łamana burty y > 0 liczona jako odbicie swojej pary — porządki zależą od obiegu, więc burty rozjeżdżały się do
  12 j. (Bellator) i odbite rury wychodziły poza kadłub;
- OKRUCHY znikają (`regDrop`): płyta / otwór, którego nie da się ustandaryzować, albo cieńszy niż 9 jd
  (`regThin`: 2 · pole / obwód) przy polu < 25 · 9² jd².

Efekt: obrys floty TN ma o 34–50% mniej wierzchołków, płyt jest mniej (Citadella 40 → 13 — okruchy-podkładki
znikają), burty równe do teksela (test), rury bez falowania. A/B: `hullDesignPreset(klucz, { raw: true })` — obrys
1:1 ze sprite'a (jak przed standaryzacją).

| Okręt | Kadłub [j.] | detail | Obraz | Węzły belek | Pole | Kompozytor | Razem |
|---|---|---|---|---|---|---|---|
| Custos | 152 × 60 | 0,089 | 2544 × 1024 | 40 | 212 ms | 87 ms | 306 ms |
| Hasta | 248 × 143 | 0,145 | 2560 × 1471 | 104 | 235 ms | 160 ms | 410 ms |
| Bellator | 629 × 397 | 0,366 | 2560 × 1613 | 848 | 234 ms | 169 ms | 424 ms |
| Citadella | 1073 × 441 | 0,630 | 2560 × 1077 | 1660 | 175 ms | 97 ms | 355 ms |
| Colossus | 1558 × 663 | 0,906 | 2560 × 1072 | 3338 | 189 ms | 98 ms | 326 ms |

(RTX, headless, 1600 × 900; przeciąganie w edytorze liczy pole i obraz w połowie rozdzielczości.) Pipeline'y
synchroniczne w klatkach: **0**, błędy konsoli: 0. Z siecią rur (pole + sieć, kompozytor, razem): Custos 236 / 102 /
345 ms, Hasta 237 / 156 / 401, Bellator 270 / 129 / 413, Citadella 183 / 87 / 288, Colossus 164 / 91 / 285 ms.

**A/B (arkusze `.tmp/kreator/demo/*-ab.png`, `*-a|b-fit.png`)**: sylwetka, układ płyt i szczelin maszynowni, hangary,
gondole, pierścienie, napisy i orły — zgodne. Citadella w kadrze na okręt jest najbliżej sprite'a. Co jeszcze odstaje:

- **piętra płyt** — w sprite'ach płyty nachodzą na siebie schodkami; automat tego nie wykryje (jasność nie mówi
  o wysokości), więc piętra są ręczne: `tiers` (Custos, Hasta, Bellator) i KASZTELE (§ „Kasztele”),
- **podział na sekcje** (Colossus) — w sprite'ie dziesiątki bloków-szewronów rozdzielonych rowami z rurami i jasnymi
  szwami; obrys skleja bloki stykające się szwem (jasność nie mówi, gdzie kończy się blok) — środek Colossusa wychodzi
  dużą płaską płytą. Domknięcie: rowki (R) i wycięcia rowów (wielokąt-wycięcie na poziomie 1) ręcznie albo lepszy
  obrys (wykrywanie szwów — próba porzucona, niżej),
- **gęstość sprzętu na płytach** — sprite'y mają więcej kratek, skrzynek i ramek; kreator stawia sprzęt regułami —
  luka do zamknięcia zestawem modułów grafika (albo więcej części),
- **szwy płyt** — automatyczne wyciąganie szwów ze sprite'ów (próg, szkielet; potem segmentacja bloków płyt) daje
  poszarpane albo falujące linie — porzucone; rowki są narzędziem do ręcznego rysowania,
- Custos i Hasta: sprite'y mają niesymetryczne moduły pod jedną burtą (projekt jest lustrzany).

## Rury (`src/game/hullDesign/hullDesignPipes.js`, rysunek w kompozytorze)

Prośba użytkownika (po v2): „siatka rur i małych urządzeń wspierających rury przez cały statek / pół statku
z koncentracją przy silniku”. Wzór — sprite'y TN: wiązki 2–5 rur o różnych średnicach (grube stalowe, cieńsze
miedziane / rdzawe) w rowach między płytami, proste i 45° z zaokrąglonymi kolanami, znikające pod płytami
z kołnierzem na wejściu, obejmy, zawory, skrzynki rozdzielcze, pompy, kolektory przy gondolach; najgęściej przy
rufie, rzadko ku dziobowi (Colossus: rowy pełne równoległych rur jak ścieżki PCB).

**Generator** (czysty, deterministyczny z `design.seed` + `pipeNet.seed`; wołany z `buildHullField` → `field.pipeNet`,
raster `field.pipeTex`):

1. siatka trasowania (komórka 5 jd) nad kadłubem — przy lustrze tylko burta y < 0, druga to lustro wyniku
   (symetria z konstrukcji). Koszt komórki: rów maszynowni 1 (najtaniej przy ścianie płyty, +0,6 przy sylwetce),
   pod płytą 4 (rura chowa się pod płytę), przez moduł 9, oś lustra +2,5, ≤ 3 jd od sylwetki zakaz; pas 2 komórek
   wokół istniejącej sieci +1,1 (równoległe wiązki nie nachodzą na siebie — dołączają albo trzymają odstęp);
2. drzewo od korzenia (reaktor → mostek → pierwsza gondola). Cele dołączają do NAJBLIŻSZEGO miejsca rosnącej sieci
   ważonym A* (stan komórka × kierunek: 8 kierunków = proste i 45°, kara za skręt 45° / 90° / 135°, heurystyka =
   odległość do sieci × 1,3): najpierw gondole silników, potem wieże, pierścienie, wrota, mostek i punkty wzdłuż
   grzbietu (co ~105 jd, zawsze najbliższy cel pierwszy), na końcu cele wypełnienia (11 × gęstość na burtę —
   komórki rowów najdalej od sieci, z wagą ku rufie 1 − 0,72 · u);
3. trasy: każdy cel karmi najbliższa po drzewie gondola (z wyrównaniem obciążenia), każda gondola — reaktor; liczba
   tras przez krawędź → rury w wiązce 1 + 1,3 · log2(1 + trasy), do 8 — koncentracja przy silnikach wychodzi sama;
   do tego pojemność rowu: wiązka nie szersza niż rów i wypełnia co najmniej 65% jego szerokości (mediana na
   widocznej długości) — rowy pełne rur jak w sprite'ach;
4. biegi (odcinki drzewa między węzłami) → łamane PROSTE (2026-10-14; dawniej przesuw w poprzek liczony co 1,5 jd
   i wygładzany — wiązka falowała za każdym ząbkiem ściany rowu): schodki trasy A* zastąpione najwyżej dwoma
   odcinkami (prosty + 45°), gdy koszt trasy nie rośnie (× 1,08) — `straightenOctilinear`; każdy prosty odcinek
   dostaje JEDNO przesunięcie w poprzek (najmniejsze z luzem od ścian na widocznej długości, oś w sylwetce), rogi =
   przecięcia przesuniętych prostych — wiązka biegnie równolegle do ściany, kolana zostają 45° / 90° —
   `offsetRun`; odcinek końcowy przez swój węzeł (węzły przesunięte w wolne miejsce, wspólne dla rozgałęzienia),
   bez luzu — kolano 45° tuż za węzłem; kolana zaokrąglone (promień 1,2 · (pół-szerokość + najgrubsza rura)).
   Promienie rur z sekwencji gondoli biegu — gruba rura ciągnie się przez rozgałęzienia;
5. osprzęt: skrzynki rozdzielcze w dużych rozgałęzieniach (≥ 6 rur), obejmy-trójniki w małych, kołnierze na
   przejściach rów ↔ płyta / moduł, zaślepki na wolnych końcach, zawory (siłownik z dźwignią), podwójne kołnierze
   i pompy co ~95 jd widocznej wiązki, kolektory (stos krótkich rur) przy szyjce gondoli. Limity: 255 biegów,
   255 elementów osprzętu.

**Rysunek** (`hullComposer.js`, `_pipeNet`): tekstura `pipeA` (RGBA16F na siatce pola, dwuliniowo — przesunięcie
w poprzek od osi biegu ze znakiem [j.], cos / sin fazy długości łuku, numer odcinka między obejmami) i `pipeB`
(RGBA8, `textureLoad` — numer biegu, numer osprzętu); tablice uniformów `hullDesignPipeRuns` (promienie 8 rur,
pół-szerokość, odstęp, najgrubsza, materiał + na płytach) i `hullDesignPipeFits`. Wiązka: rura pod punktem z sum
promieni (bez zmiennych zmienianych w miejscu), walec, materiał z haszu (jasna stal / miedź / rdza / ciemna stal;
grube zwykle stalowe; ręczne — materiał rury), kołnierze rur w połowie odcinków, obejmy co 26 jd (taśma nad
wiązką, przy ścianie płyty bliżej niż 4,5 jd — wspornik do ściany). Sieć generowana tylko w rowach (pod płytą jej
nie widać), rury ręczne `over` — także na płytach. Kopia lustra biegu dzieli numer biegu (przesunięcie zmienia znak →
kolejność rur odbita). Dno rowu przy sieci cieplejsze (brąz-szarość). Paleta: nowy wiersz `steel` (jasne rury).

**Koszt** (RTX, headless, sieć + raster w polu): generator ~65–90 ms, raster ~20 ms na okręt; wypiek okrętu
z siecią 0,29–0,43 s (tabela wyżej + sieć). Pipeline'y synchroniczne: 0.

**Proste wiązki** (po standaryzacji obrysu i prostowaniu, flota TN): 81–86% długości rur leży na odcinkach co 45°
(reszta to łuki kolan), skośne odcinki > 4 jd — 0,3–2,4% długości (test: > 75% i < 5%).

**Narzędzia**: `node scripts/webgpu/kreator-kadluba-demo.mjs --tylko custos,hasta,bellator,citadella,colossus --etapy
ab,rury` → `<okręt>-a|b-rufa.png` (rufa z gondolami A/B), `<okręt>-a-rufa-bez.png` (ta sama klatka bez sieci);
testy: `rury: …` w `tests/hullDesign.test.mjs` (format i lustro rur ręcznych, determinizm, oś wewnątrz kadłuba, rufa
gęstsza niż dziób, symetria biegów i osprzętu, raster).

**Do decyzji / dalej**: piraci i inne frakcje — dziś ta sama sieć (gęstość 0 w presetach poza TN); skrzynki
rozdzielcze są proste (płyta z pokrywą) — wariantów można dodać przy atlasie modułów; rury nie rzucają cienia na
płyty (relief tylko w rowach, poza rurami ręcznymi `over`).

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

## Gotowe części (`src/game/hullDesign/hullDesignParts.js`)

Odpowiedź na „brakuje kształtów kadłuba, mostka, modeli innych niż proste”: złożone elementy w stylu TN stawiane jak
moduł (skala, obrót, lustro, przesunięcie poziomów): wieża mostka, mostek schodkowy (3 piętra), mostek klinowy, dziób
z rozwidleniem, dziób klinowy, blok silników (3 gondole), silniki blokowe (Colossus), rufa (2 bębny), sekcja kadłuba,
sponson, rząd hangarów, blok wieży, grzbiet z portami, port. Presety `tnparts` (fregata z części na ramie z bloków)
i `tnparts2` (krążownik wyłącznie z części). Nowa część = wpis w `HD_PARTS` (bryły, moduły, naklejki w jej
układzie przy skali 1 ≈ detail 0,6).

## Demo — narzędzia

Bloki (B), przesuń / skala / obrót (V, kółko, Shift + kółko), koło (C, Shift — wycięcie), **wielokąt** (P; LPM punkty,
PPM / Enter zamyka, pierwszy i ostatni punkt na osi → symetryczny; „wielokąt-wycięcie”), **rowek** (R — łamana
linii płyt), **rura** (W — łamana wiązki; liczba rur i materiał w panelu, kółko nad rurą — średnica), **część** (K),
**kasztel** (Q; „kasztel na płytach” — z `clip: 1`), moduł (M), pas (S), emblemat (E), napis (T); poziomy 1–4 (rama,
pancerz, nadbudówka, mostek); suwaki detalu, fazy
płyt, łuku, widoczności paneli i **gęstości sieci rur** (⟳ — inne ziarno sieci); podkład ze sprite'a (U) do
odrysowania; A/B (A).

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
   z modułu „Mostek”), rdzenie reaktora (`src/data/reactorCores.js` — z modułu „Reaktor”), zbiorniki paliwa
   (`src/data/fuelTanks.js`), dysze MAIN (`ENGINE_FX_DEFAULTS` — z gondol: `hullDesignMounts().mainThrusters`),
   dysze SIDE (automat z obrysu), gniazda broni (`SHIP_EDITOR_DEFAULTS` — z modułów wież; typ main / aux / special
   do dodania w module), lampy pozycyjne (`editorLights` — zrobione w demie, promień w jd), ładownie
   (`CARGO_BAY_HULLS` — z wrót hangaru / luków), `HULL_COLLISION_ARMOR`, `SHIP_FLIGHT_SPECS`, obrys 3D.
5. **Stocznia** — budowa od zera = ciało z wszystkimi komórkami martwymi ożywiane odrostem (`HullBodies.regrowCell`)
   z materiałem z receptury; refit = różnica komórek.
6. **Naprawa i rany** — bez zmian (mapa ran, łaty, odrost, wraki pracują na alfie i uv obrazu).

## Pytania do decyzji

1. Czy poziom zgodności floty TN z kreatora (arkusze A/B) wystarcza, żeby iść w stronę zastąpienia sprite'ów, i
   czy domknięcie luki „gęstości sprzętu” zestawem modułów / części (grafik) to dobry kierunek?
2. Gotowe części — rozwijać bibliotekę (warianty mostków, dziobów, rufy na każdą frakcję) czy dopuścić części
   rysowane przez gracza (zapis własnej części z zaznaczenia)?
3. Piętra płyt (schodki jak w sprite'ach) — wystarczy ręcznie w presetach (`tiers`), czy dać graczowi narzędzie
   „podnieś płytę” (klik w płytę → piętro wyżej)?
4. Kanał emisji w skórze (pkt 3 listy) — robić od razu, czy na razie okna w albedo?

## Znane braki dema

- A/B: sprite referencyjny Custosa (i trochę Hasty, Bellatora) prześwietlony łuną bloomu — odbłysk oświetlenia gry na
  sprite'ach w scenie dema (lampy sprite'a są wyczyszczone, tarczy nie ma); błąd sceny porównania, nie kreatora — do
  zbadania. Projekt w A/B jest bez automatycznych reflektorów otoczenia (`autoFlood: false`; zalewały blachę
  plamami), lampy pozycyjne zostają.

- Po standaryzacji obrysu: sąsiednie płyty standaryzowane osobno potrafią zostawić wąski KLIN rowu (jedna krawędź na
  45°, sąsiednia na 0°) — fazy i światło brzegów robią z niego „kolec” przy rogu płyty; na płytach poduszka liczona
  z odległości od krawędzi ma ostre załamania na dwusiecznych rogów (zagięcia „papieru”) — do wygładzenia.
- Moduły mają wygląd z reguł shadera; brak atlasu modułów od grafika. Wieże nie są rysowane (gniazda puste) — w grze
  rysuje je `Turret2D` / partie 3D w miejscach gniazd.
- Brak cofania (undo); JSON do zapisu / wczytania w panelu.
- Pole odległości liczy się ~0,1–0,25 s na okręt (CPU, w wątku strony) — przy edycji przeciąganie liczy je w połowie
  rozdzielczości; w grze należałoby je przenieść do workera.
