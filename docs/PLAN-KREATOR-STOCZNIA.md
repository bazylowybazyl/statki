# Kreator kadłubów → stocznia z klocków — plan (2026-10-20)

Kontynuacja `docs/KREATOR-KADLUBA.md` (demo `dema/kreator-kadluba-webgpu.html`, moduły `src/game/hullDesign/`,
kompozytor `src/3d/hullDesign/hullComposer.js`). Kreator nadal NIE jest wpięty do gry.

## Cel (użytkownik, 2026-10-20)

1. **Kształt z klocków.** Trójkąty prostokątne, prostokąty, trapezy i inne proste kształty, z których gracz sam
   złoży dowolny kadłub. Każdy okręt Terra Novy (np. lotniskowiec Citadella) musi dać się odtworzyć tymi samymi
   klockami, które ma gracz. Dziś się nie da: presety TN to obrys sprite'ów (`hullDesignTNTrace.js`).
2. **Systemy na stałych miejscach.** Rdzeń, mostki, silniki, ładownie i zbiorniki paliwa mają miejsca ustalone
   dla klasy i kadłuba. Wyjątek: okręt budowany od zera (tam gracz je stawia).
3. **Kable i rury wynikają z systemów.** Rdzeń daje prąd, więc kable idą od rdzenia do każdego urządzenia.
   Rury paliwa idą od zbiornika przez rdzeń do silników MAIN i bocznych (SIDE). Nic nie kończy się „donikąd”
   i nic nie wychodzi poza kadłub.
4. Później gracz dostaje edytor własnych okrętów, a stocznie pozwolą je budować (fabularnie, nie w demie).
5. **Klasa okrętu z mostka i rdzenia.** Mostek wyznacza klasę: maksymalną powierzchnię kadłuba i liczbę gniazd.
   Rdzeń też ogranicza kadłub. Ulepszanie mostka i rdzenia = awans na kolejną klasę i większy okręt.

## Diagnoza: rury „donikąd” (zrzut rufy Citadelli, 2026-10-20)

`buildPipeNetwork` (`src/game/hullDesign/hullDesignPipes.js`) rozpina drzewo od reaktora do gondol i modułów, ale
dokłada też cele bez żadnego urządzenia:

- **punkty grzbietu** (`spineStepDu` — co ~105 jd wzdłuż osi),
- **cele wypełnienia** (`fillPerDensity` — 11 na burtę: komórki rowów najdalej od sieci, z wagą ku rufie).

Każdy taki cel to gałąź zakończona zaślepką (`HD_PIPE_FIT.cap`) w przypadkowym miejscu rowu, często przy samej
krawędzi kadłuba. To są właśnie rury biegnące w dół do burty. Do tego zły sens przepływu: cel „zasila” najbliższa
gondola, a gondolę reaktor. Zbiornika paliwa w ogóle nie ma, a kabli nie ma wcale.

## Zasady przyjęte (orkiestrator, do potwierdzenia przy ocenie)

- **Bez czitowania** = preset zawiera tylko to, co gracz ma w edytorze: klocki z palety (parametry na siatce),
  kasztele, gotowe części, moduły, naklejki. Żadnego obrysu ze sprite'ów ani wielokątów z setkami punktów.
  Liczba elementów na tyle mała, żeby gracz ułożył okręt ręcznie (połowę — lustro robi drugą burtę).
  Strażnik w testach.
- **Wygląd**: zgodność ze sprite'ami co do STYLU i układu (sylwetka, sekcje płyt, kasztele, gondole), nie 1:1.
  Wzór czystego stylu — sprite Bellatora (decyzja z 2026-10-14).
- **Płyty pancerza** to klocki z automatyczną szczeliną (rowem maszynowni) między sąsiednimi płytami — tak Terra
  Nova dzieli kadłub na sekcje i tędy biegną rury i kable.
- **Sieci**: paliwo (rury) zbiornik → rdzeń → każdy MAIN i SIDE; zasilanie (kable) rdzeń → każde urządzenie
  (wieże, mostek, silniki, wrota, ładownie, porty). Kratki i naklejki nie są urządzeniami. Zero wolnych końców,
  cała szerokość wiązki wewnątrz obrysu, trasy rowami (widać je) albo pod płytami (wejście z kołnierzem).
- **Systemy w presetach są zablokowane** w edytorze; w projekcie od zera wolne, z walidacją (rdzeń, zbiornik,
  mostek i MAIN wymagane).
- **Rama w jednym kawałku**: kadłub (poziom ramy) to jedna bryła bez otworów na wylot — szpara między klockami to
  dziura w kadłubie i w strukturze belek, a sieć nie przejdzie przez nią do urządzeń. Test na wszystkich presetach,
  ostrzeżenie w panelu edytora.

## Etapy

Stan 2026-10-21: etapy 1A–1D zrobione i scalone do main. Flota TN z klocków: 20–58 klocków na połowę okrętu, IoU
sylwetki ze sprite'em 0,92–0,98; sieć na całej flocie bez wolnych końców i wiązek poza obrysem. Etap 2 (klasy z mostka
i rdzenia) wdrożony w kreatorze 2026-10-21 na gałęzi `claude/kreator-klasy-ba238b` (do oceny): dane `src/data/shipClasses.js`,
pełne gniazda broni floty TN z gry, panel klasy, twarde limity mostka, bilans mocy z martwymi kablami — opis
`docs/KREATOR-KADLUBA.md` § „Klasy okrętów”. Następny — etap 3 (kreator w grze).

| Etap | Co | Kto |
|---|---|---|
| 1A | Paleta klocków: format, rozwinięcie na bryły, edytor (siatka, obrót co 45°, odbicie, poziomy, wycięcia, szczelina płyty, cofanie) | sesja `klocki-tn` |
| 1B | Flota TN (Custos, Hasta, Bellator, Citadella, Colossus) złożona z klocków, A/B ze sprite'ami, strażnik „bez czitowania” | ta sama sesja, po przeglądzie 1A |
| 1C | Sieć systemów: nowe moduły (zbiornik, SIDE, ładownia), sloty TN z tabel gry, generator kabli i rur bez wolnych końców, rysunek kabli | sesja `siec-systemow`, równolegle |
| 1D | Scalenie: sieć na kadłubach z klocków, zrzuty A/B, ocena użytkownika | orkiestrator |
| 2 | Klasy z mostka i rdzenia: limity (powierzchnia, gniazda, moc rdzenia), ulepszenia, awans klasy | kreator: sesja `klasy-mostek-rdzen` (2026-10-21), gra — etap 3 |
| 3 | Kreator w grze: kadłub z danych zamiast sprite'a (lista w `KREATOR-KADLUBA.md` § „Co trzeba zmienić w grze”) | później |
| 4 | Stocznia gracza (fabuła): zamówienie kadłuba, budowa i przebudowa | później |

## Na etap 2 (do decyzji użytkownika)

Propozycja z pomiarem floty TN i tabelami klas mostka i poziomów rdzenia: `docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md`
(2026-10-21, przyjęta z rekomendacjami; wdrożenie w kreatorze — sesja `klasy-mostek-rdzen`).

- Tabela klas (fregata → niszczyciel → pancernik → lotniskowiec → superkapitał): maksymalna powierzchnia [j.²]
  i liczba gniazd na poziom mostka. Punkt wyjścia: pomiar obecnej floty TN (powierzchnia z alfy, gniazda
  z `SHIP_EDITOR_DEFAULTS`).
- Co daje rdzeń: moc (ilu odbiorników, jakie silniki), a może też wymiar komory, która wyznacza minimalny kadłub.
- Czy kable i rury mają kiedyś znaczenie w rozgrywce (przecięty kabel = urządzenie bez prądu). Dziś to tylko obraz.
