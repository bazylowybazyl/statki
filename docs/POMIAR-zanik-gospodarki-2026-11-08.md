# Zanik gospodarki Układu Słonecznego po 6–8 h — pomiar, przyczyna, poprawka (2026-11-08)

Zgłoszenie E18 (`docs/PROPOZYCJA-ekonomia-ukladow.md` § 2.3, § 11): pełna symulacja ruchu v2 po ~6–8 h gry traci
połowę kursów i połowę zapasu stali, a bramka bilansu liczy 4 h. Stan i zasady: reguła `ruch-v2`, § „Flota
przewoźników” i § „Bramka bilansu” (wariant długi).

Dwie niezależne przyczyny, dwie poprawki:
1. **Kursy i obsada** — przewoźnicy odkupywali każdą stratę najtańszym vanem, ładowność floty topniała
   (2,70 → 0,55 mln t w 12 h). Poprawka floty: odkup tej samej klasy, ryzyko kadłuba we frachcie (commit 0978dc48).
2. **Stal** — solver przemysłu liczył przetop złomu na Marsie jako źródło stali, a złom przychodzi tylko z wraków
   (plan 1,06, w biegu 0,93). Poprawka: złom poza podażą planu (commit e3706b08, § „Krok 2: stal”).

Warunki: skala gospodarki ×60, magazyny ×4, presja piractwa ×1, ziarna 7 / 11 / 23. Sonda co godzinę
(`.tmp/dlugi/sonda.mjs`, poza repo): kursy wg rodzaju, flota przewoźników wg klas i firm, zakupy i straty, rachunek
firm, zapasy, obsada, pola wydobywcze, kolejki, wraki, zlecenia. Bramka: `node scripts/bramka-bilansu.mjs --godziny 10`.

## Odtworzenie (baza = main d34344cc)

Ziarno 7, 12 h (sonda; ziarna 11 i 23 przebiegają tak samo, różnica do 1 h w chwili załamania):

| godz. | kursy (przewóz + górn.) | dostawy/h | ładowność floty, tys. t | vany / wszystkie statki | kapitał firm, mln CR | stal | obsada śr. / min |
|---|---|---|---|---|---|---|---|
| 0 | 0 | — | 2698 | 3518 / 9896 | 80,0 | 27,7% | 1,00 / 1,00 |
| 2 | 1080 | 5392 | 2478 | 4505 / 9880 | 74,2 | 26,2% | 1,00 / 1,00 |
| 4 | 1196 | 7448 | 1993 | 6080 / 9854 | 65,4 | 23,9% | 1,00 / 1,00 |
| 6 | 1441 | 8782 | 1419 | 7887 / 9625 | 54,4 | 20,8% | 1,00 / 1,00 |
| 8 | 1154 | 8220 | 585 | 8878 / 8968 | 46,2 | 18,0% | 0,99 / 0,83 |
| 10 | 670 | 5918 | 526 | 8714 / 8719 | 42,8 | 10,6% | 0,68 / 0,18 |
| 12 | 178 | 1613 | 554 | 9232 / 9232 | 39,9 | 6,8% | 0,38 / 0,02 |

Liczby kursów i stali zgadzają się co do sztuki ze śladem E18 (1559 w 6. h, 1648 w 7., 791 w 10.).

## Przyczyna

1. Firmy tracą ~1,2–2,3 tys. statków na godzinę (przechwyty w paśmie 12–20% kursów z ładunkiem — tak ma być).
   Piraci biorą chętniej duże ładunki (`pirateInterest` rośnie z wartością), więc giną głównie haulery, bulki,
   heavy i mega.
2. `maintainFleet` zastępował KAŻDĄ stratę najtańszą klasą (van 60 t), a liczył tylko liczbę statków (cel = średnia
   na firmę). Megafrachtowiec 2400 t wracał jako van. Liczba statków stoi (~9,9 tys.), ładowność topnieje:
   2,70 → 0,58 mln t w 8 h; po 12 h we flocie są same vany (9232 z 9232).
3. Vany 60 t nie przechodzą progu przerzutów pustych (`rebalanceFleet` żąda ładowni haulera, 160 t): puste
   przeloty spadają z 4,6 tys./h do 0,3 tys./h, statki stoją u importerów (Ziemia ~2,9 tys., Mars ~2,8 tys.),
   odmowy „brak jednostki” rosną z 18 tys./h (4. h) do 90 tys./h (12. h).
4. Gasną promy z obsadą (ludzie w drodze 14 tys. → 3 tys. w 8.–9. h), obsada spada (śr. 0,38, min 0,02 po 12 h),
   z nią wydobycie i receptury (W3: `e = r`), a dalej stal i kursy.

Rachunek firm (ziarno 7, 3. h): przychód 7,7 mln CR/h, paliwo 5,8 mln, opłaty 0,9 mln — zysk ~1 mln CR/h, a stracone
kadłuby w cenach klas to 15,3 mln CR/h. Fracht (`1,35 × koszt trasy`) niesie ryzyko ładunku, nie kadłuba, więc sam odkup
tej samej klasy też by nie wystarczył:

| wariant (ziarno 7) | kapitał 1 h | 3 h | 5 h |
|---|---|---|---|
| odkup tej samej klasy, fracht bez kadłuba (`freightHullRisk` 0) | 74,8 | 43,7 | 18,1 mln CR |
| odkup tej samej klasy, pełne ryzyko kadłuba (1,0) | 83,3 | 107,3 | 147,0 mln CR |

Szansa przechwytu trasy nie zna zainteresowania piratów ładunkiem, patroli ani konwojów; prawdziwe straty to
~0,3–0,4 kwoty z pełnym współczynnikiem → `freightHullRisk` 0,4.

Inne hipotezy sprawdzone tą samą sondą:
- **Kapitał firm** spada (80 → 40 mln CR w 12 h), ale na vany starcza — to skutek rachunku, nie przyczyna zaniku.
- **Pola wydobywcze** — urobek rośnie (wyrwy 20 → 310), ruda żelaza w magazynach rośnie (13 → 26%); nie ogranicza.
- **Wraki i zlecenia** rosną liniowo (17 tys. wraków, 78 tys. zleceń po 12 h); tick 11–20 ms w ciszy — koszt, nie przyczyna.
- **Obsada (W3)** trzyma 1,0 do chwili, w której gaśnie flota — sprzężenie zwrotne idzie dopiero za flotą.

## Poprawka (`transportCompanies.js`, `trafficDirector.js`)

- `loseShip` zapisuje klasę do odkupu (`company.toReplace`); `maintainFleet` odkupuje straty od największej ładowni
  i na droższą odkłada (`reserveRatio` 2,5); dopiero bez strat — dawna reguła (do średniej, od najtańszej).
- `SHIP_PRICE`: heavy 46 tys., mega 120 tys. CR (ceny tych samych kadłubów u kupców, `CARAVAN_SHIP_PRICE`).
- Fracht = 1,35 × (koszt trasy + 0,4 × szansa przechwytu trasy × cena klasy) — `hullRiskCost`, `freightHullRisk`.
- Do 4 zakupów na firmę na cykl (`fleetPurchasesPerCycle`): firmy na groźnych trasach traciły ~180 statków/h, tyle,
  ile wynosił dawny sufit jednego zakupu na cykl 20 s.

## Wynik: wariant długi bramki (10 h), przed → po

### Ziarno 7

| godz. | kursy w powietrzu | dostawy/h | ładowność floty, tys. t | kapitał firm, mln CR | stal, tys. | obsada śr. |
|---|---|---|---|---|---|---|
| 2 | 850 → 812 | 5392 → 5093 | 2558 → 2706 | 76,4 → 75,5 | 237 → 239 | 1,00 → 1,00 |
| 4 | 1196 → 1243 | 7448 → 7744 | 2140 → 2706 | 67,5 → 68,9 | 217 → 215 | 1,00 → 1,00 |
| 6 | 1456 → 1410 | 8782 → 8572 | 1597 → 2706 | 57,5 → 66,0 | 193 → 192 | 1,00 → 1,00 |
| 8 | 1249 → 1582 | 8220 → 10 213 | 715 → 2706 | 47,4 → 61,7 | 171 → 169 | 1,00 → 1,00 |
| 9 | 992 → 1615 | 6582 → 10 128 | 554 → 2688 | 45,2 → 61,1 | 152 → 159 | 0,94 → 1,00 |
| 10 | 809 → 1624 | 5918 → 10 801 | 532 → 2672 | 43,3 → 64,2 | 120 → 146 | 0,76 → 1,00 |

### Ziarna 11 i 23 (godz. 10)

| ziarno | kursy | dostawy/h | ładowność, tys. t | kapitał, mln CR | stal, tys. | obsada |
|---|---|---|---|---|---|---|
| 11 | 708 → 1603 | 5260 → 10 562 | 538 → 2706 | 44,6 → 59,6 | 119 → 147 | 0,73 → 1,00 |
| 23 | 542 → 1593 | 3833 → 10 518 | 543 → 2705 | 43,5 → 62,7 | 103 → 152 | 0,68 → 1,00 |

### Próg „długi bieg” (średnia godz. 10 wobec średniej godz. 2–4, próg 80%)

| miara | ziarno 7 | ziarno 11 | ziarno 23 |
|---|---|---|---|
| kursy | 72% → 141% | 61% → 139% | 48% → 137% |
| dostawy/h | 82% → 147% | 70% → 142% | 52% → 143% |
| stal | 54% → **66%** | 54% → **66%** | 46% → **68%** |
| płyty kadłuba | 157% → 160% | 158% → 160% | 154% → 159% |
| ruda żelaza | 108% → 108% | 107% → 110% | 107% → 109% |
| paliwo fuzyjne | 98% → 99% | 98% → 99% | 98% → 99% |
| obsada | 76% → 100% | 73% → 100% | 68% → 100% |
| ładowność floty | 24% → 99% | 25% → 100% | 25% → 100% |

### Wariant długi 12 h po poprawce (`--godziny 12`, ziarna 7 / 11 / 23)

| godz. | kursy | ładowność, tys. t | kapitał, mln CR | obsada |
|---|---|---|---|---|
| 2 | 812 / 821 / 824 | 2706 / 2706 / 2706 | 75,5 / 72,6 / 75,2 | 1,00 / 1,00 / 1,00 |
| 4 | 1243 / 1237 / 1210 | 2706 / 2706 / 2706 | 68,9 / 64,6 / 69,7 | 1,00 / 1,00 / 1,00 |
| 6 | 1410 / 1385 / 1383 | 2706 / 2706 / 2706 | 66,0 / 61,7 / 66,2 | 1,00 / 1,00 / 1,00 |
| 8 | 1582 / 1476 / 1507 | 2706 / 2706 / 2706 | 61,7 / 55,8 / 61,8 | 1,00 / 1,00 / 1,00 |
| 10 | 1624 / 1603 / 1593 | 2672 / 2706 / 2705 | 64,2 / 59,6 / 62,7 | 1,00 / 1,00 / 1,00 |
| 12 | 1557 / 1594 / 1602 | 2650 / 2675 / 2638 | 69,3 / 66,6 / 70,4 | 1,00 / 1,00 / 1,00 |

Baza w 12. h (sonda): kursy 178 / 230 / 203, ładowność 554 / 560 / 570 tys. t, kapitał 39,9 / 40,9 / 40,2 mln CR,
obsada 0,38 / 0,39 / 0,42. Próg „długi bieg” (stal do wglądu, commit 58f0ffdf): zaliczony na 3 ziarnach — kursy
135–138%, dostawy 136–140%, obsada 100%, ładowność 98–99%, stal 58–60%. Cały bieg 12 h nie przechodzi na kolejce
(Wenus średnio 8,2 / 11,0 / 10,9, Ziemia 5,8 / 5,5 / 3,9) i głodzie w kryjówkach (O₂ 280 min, stal 133 min).

Bieg 20 h (sonda, ziarno 7, po): kursy 1600–2070, dostawy 10–11 tys./h, ładowność 2,56 mln t (−5%), obsada 1,00,
kapitał 60 → 119 mln CR (od ~10 h rośnie o ~5 mln CR/h).

## Bramka 4 h (3 ziarna), przed → po — zaliczona obie

| próg | ziarno 7 | ziarno 11 | ziarno 23 |
|---|---|---|---|
| przechwyty (z ładunkiem) | 14,1 → 14,1% | 13,7 → 14,3% | 14,0 → 14,2% |
| najdłuższy głód | 6,5 → 6,4 min | 6,3 → 6,2 min | 6,3 → 5,9 min |
| stocznie bez pochylni | 0 → 0 min | 0 → 0 | 0 → 0 |
| kolejka na redzie (najwyższa) | 0,92 → 1,32 (Io) | 0,84 → 1,17 (Wenus) | 0,79 → 1,95 (Wenus) |
| tick przy szczycie (w ciszy, start przy 0 obcych procesach node) | 11,4 → 12,0 ms | 10,7 → 12,0 ms | 11,4 → 14,4 ms |
| obsada (najniższa średnia) | 1 → 1 | 1 → 1 | 1 → 0,999 |

Kolejka rośnie, bo w porcie zostają duże statki (w bazie po 4 h ubywa ~27% megafrachtowców). Wenus ma 6 stanowisk
capital i 6 mega i nie ma nadpisania `MARKET_DOCK_OVERRIDES`. A/B z jednym zakupem na cykl dał Wenus 3,18 na ziarnie 7
(bramka niezaliczona), więc limit 4 zakupów kolejki nie podnosi.

## Testy

- `npm test`: baza 1908 asercji OK → po 1917 OK (+9: odkup straconej klasy i `hullRiskCost` w suicie `transportCompanies`).
- `node --test --test-concurrency=4 "tests/*.test.mjs"`: 4016 testów, 4009 OK, 2 porażki znane z main (moduł hali —
  LF, maska słońca), 3 pominięte, 2 TODO. Worktree potrzebuje junctiona `node_modules` — bez niego pada 6 testów
  renderu, które czytają `node_modules/three` ścieżką względną.

## Krok 2: stal (commity e3706b08, 1f3f5a04)

Po poprawce floty stal dalej spadała (25 → 16% w 10 h, 7% po 20 h; w bazie do 8. h ta sama krzywa). Pomiar hut co 2 h
przez 16 h (`.tmp/dlugi/huty.mjs`: jeden cykl receptur przy bieżącym zapasie, jak `runRecipes`):

| | plan (na cykl, ×60) | w biegu |
|---|---|---|
| produkcja stali | 691 | 604 — wszystkie huty z rudy 100% planu, przetop złomu na Marsie 0 z 87 (brak złomu) |
| zużycie stali | 670 | 641–670 |

Przyczyna: solver przemysłu (`buildIndustryMap`) liczył przetop złomu jako źródło stali. Na Marsie ta linia miała
wagę 2,90 (wytop z rudy 1,09) — solver dzieli popyt stali Marsa między obie linie, a recykling robi 1 stali z 4 złomu.
Pokrycie stali w planie: 1,06 ze złomem, 0,927 bez niego. Złom przychodzi tylko z wraków, więc w biegu było ~0,93
i stal schodziła o ~12 tys./h. Pozostałe tropy z pierwszego kroku (próg sprzedaży 70%, zapas roboczy 25% odbiorców,
płyty kadłuba rosnące do pełnych magazynów) to skutki: bez nadwyżki huty nie sprzedają, a odbiorcy zjadają zapas.

Poprawka (`stationEconomy.js`): linia na wsadzie bez stałego źródła (`UNPLANNED_INPUTS`: złom) nie liczy się do
podaży planu (`isPlannedSupplyLine`). Solver dokłada stal hutom z rudy: pokrycie stali bez złomu 0,927 → 1,052,
wytop +10–27% (Merkury 0,49 → 0,55, Wenus 1,45 → 1,67, Ziemia 2,86 → 3,16, Ceres 1,09 → 1,22, Westa 0,58 → 0,73),
pozostałe towary 1,061–1,071 (było 1,067–1,079). Podział mocy w stacji bez zmian. Migawki testów: plan Ziemi +10%
rudy żelaza, huta Ziemi 9,24 → 9,55 ekwiwalentu; nowy strażnik § 12 (stal pokryta samymi hutami z rudy).

Ziarno 7, 12 h, obie poprawki (sonda): stal 27,7% (0 h) → 29,0% (4 h) → 29,2% (10 h) → 31,1% (12 h); bez kroku 2:
23,5 → 15,5 → 12,6%. Ładowność 2,67–2,74 mln t, obsada 1,00, kursy 1500–1740 od 7. h.

Bramka 4 h (obie poprawki): zaliczona — przechwyty 14,9 / 14,6 / 14,6%, kolejka 1,15 / 1,89 / 1,20 (Wenus),
głód ≤ 6,2 min, stocznie 0 min, obsada 1, tick 10,6 / 10,8 / 10,4 ms.

### Wariant długi 12 h, obie poprawki (`--godziny 12`, stal w progu, ziarna 7 / 11 / 23)

| godz. | kursy | ładowność, tys. t | kapitał, mln CR | stal, tys. | obsada |
|---|---|---|---|---|---|
| 2 | 831 / 795 / 825 | 2741 / 2741 / 2741 | 74,4 / 75,5 / 76,0 | 256 / 254 / 257 | 1,00 / 1,00 / 1,00 |
| 4 | 1206 / 1216 / 1214 | 2741 / 2741 / 2741 | 65,0 / 66,7 / 69,5 | 257 / 256 / 256 | 1,00 / 1,00 / 1,00 |
| 6 | 1461 / 1394 / 1404 | 2741 / 2741 / 2741 | 58,9 / 62,4 / 66,2 | 261 / 263 / 257 | 1,00 / 1,00 / 1,00 |
| 8 | 1520 / 1582 / 1609 | 2741 / 2741 / 2741 | 51,6 / 55,8 / 59,8 | 261 / 263 / 261 | 1,00 / 1,00 / 1,00 |
| 10 | 1568 / 1600 / 1613 | 2740 / 2732 / 2741 | 53,5 / 60,5 / 63,3 | 266 / 265 / 266 | 1,00 / 1,00 / 1,00 |
| 12 | 1627 / 1640 / 1546 | 2690 / 2675 / 2733 | 61,2 / 68,5 / 69,6 | 273 / 273 / 273 | 1,00 / 1,00 / 1,00 |

Próg „długi bieg” zaliczony na 3 ziarnach: ziarno 7: kursy 141%, dostawy/h 148%, stal 106%, płyty 162%, ruda Fe 111%, paliwo fuz. 98%, obsada 100%, ładowność 98%; ziarno 11: kursy 140%, dostawy/h 138%, stal 107%, płyty 161%, ruda Fe 111%, paliwo fuz. 98%, obsada 100%, ładowność 98%; ziarno 23: kursy 133%, dostawy/h 138%, stal 106%, płyty 161%, ruda Fe 112%, paliwo fuz. 98%, obsada 100%, ładowność 100%. Cały bieg 12 h dalej łamie kolejkę (Wenus 9,0 / 9,3 / 8,3, Ziemia 2,4 / 9,5 / 5,2 — więcej stali w ruchu) i głód kryjówek (O₂ 280 min, stal 133 min), jak bez kroku 2.

Testy po kroku 2: `npm test` 1919 OK (+2: strażnik stali w § 12); `node --test` 4016, 4009 OK, te same 2 znane porażki.

## Co zostaje (osobne zadania)

1. **Kolejki po 7. h**: ruch rośnie do ~11 tys. dostaw/h (+40% wobec 2–4 h), redy Wenus i Ziemi średnio 4–6 w biegu
   10 h (szczyt 487 kursów na Wenus w 17. h). W bazie zanik od 8. h to ukrywał (Wenus 1,3–3,3).
2. **Kryjówki bez tlenu**: Gniazdo Hildy i Złomowisko stoją na zerze O₂ od ~7,3 h (159,8 min do 10. h) — w bazie
   identycznie; bramka 10 h liczy je w progu głodu.
3. **Skala ×1** (`?trafficV2=1`): baza i poprawka gasną (ładowność 39 tys. → 4 tys. / 19 t w 8 h) — flota i kapitał
   za małe; gra liczy ×60.
4. Jedna z czterech dużych firm (firma-1) traci pieniądze od pierwszej godziny: kapitał 11,6 → 0,27 mln CR do 8. h,
   statki 445 → 105 po 20 h (pozostałe duże trzymają 422–445). Dopłata jest jedna dla wszystkich klas, a duże ładunki
   giną częściej; projekt przewoźników dopuszcza, że słaba firma wypada z rynku. Układ to wytrzymuje (−5% ładowności
   po 20 h).
