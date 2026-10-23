# PROPOZYCJA — workforce w ekonomii ruchu v2 (E16)

Spisana 2026-10-23. To PROJEKT do decyzji użytkownika, nie zmiana gry: kodu w `src/` nie ruszałem. Stan wyjściowy to lokalny `main` z 2026-10-23 (`f9707ac8`): zadania E1–E14 scalone, E15 („widoczny ruch”) w toku. Plan ekonomii: `docs/PLAN-ekonomia-rynki.md` (zadanie E16 w § 4, decyzja z 2026-10-23 w § 8). Zasady obszaru: reguła `ruch-v2`.

**Ramy od użytkownika (nie do zmiany):**
- nazwa w grze: „workforce”;
- każdy budynek potrzebuje X workforce, żeby funkcjonować;
- workforce produkują ośrodki ludności: ringi Halo (Ziemia, Mars, Jowisz) i Mars ze strefami zielonymi, a w przyszłości także bazy w asteroidach;
- workforce trzeba dowieźć ze źródła do budynku. To jest prawdziwy ruch cywilny w jednej ekonomii, bez osobnych dekoracyjnych NPC.

Liczby policzyłem z danych świata (`STATION_INDUSTRY`, `PLANET_YIELD`, doki `buildTrafficWorld`) i prostą symulacją obsady. Skrypty leżą poza repozytorium (`.tmp/e16/analiza.mjs`, `.tmp/e16/bilans.mjs` w worktree E16), a bazę ruchu wziąłem z `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60`.

## 0. W skrócie

- **Jednostka:** 1 workforce = 1 osoba na kontrakcie. Tabele podaję w ludziach świata (gospodarka ×60), a w nawiasie w skali 1, bo tak trzyma to kod (jak receptury).
- **Model (§ 3):** obsada jako zapas, rotacja jako zużycie. Każdy budynek ma potrzebną obsadę N. Ludzie na miejscu to zapas towaru `workforce` w magazynie rynku. Co minutę `1/T` z nich kończy kontrakt i wraca do domu, więc dowóz musi stale uzupełniać rotację. Zakład pracuje z wydajnością `e = r` przy obsadzie `r = zapas / N`, a poniżej progu `r < 0,2` stoi.
- **Kontrakt `T` = 45 min gry** (rekomendacja). Krótszy daje więcej ruchu i szybszy skutek blokady.
- **Popyt:** ok. **305 tys. ludzi** obsady w całym układzie (§ 1). Najwięcej potrzebują Ziemia (68 tys.), Mars (62 tys.), Jowisz (40 tys.) i Ceres (37 tys.).
- **Podaż (§ 2):** ring Ziemi 168 tys./h, ring Marsa 121 tys./h, strefy zielone Marsa 81 tys./h, ring Jowisza 151 tys./h. Razem 521 tys./h wobec 407 tys./h rotacji, czyli **zapas 28%**: pokrywa 15% strat w transporcie i zostawia ~20% luzu.
- **Ruch (§ 4):** ok. **420 kursów z ludźmi na godzinę** i tyle samo powrotów z ludźmi kończącymi kontrakt. Daje to ~130 statków więcej w powietrzu (dziś ~1250, czyli +8–11%). Przy portach ringów widać prom co ~19 s przy Ziemi, ~12 s przy Marsie i ~11 s przy Jowiszu. Promy mają własne, cywilne kadłuby.
- **Bramka (§ 7):** wpływ szacuję jako mały. Przechwyty zostają w paśmie 14,6–15,9%, stanowiska są obciążone dodatkowo o 1–5%, a tick rośnie o ~8–10%. Dochodzi nowy próg obsady.
- **Plan (§ 8):** 7 kroków przez bramkę, jak w E10. W pierwszych dwóch obsada nic jeszcze nie dławi (`e = 1`), więc najpierw widać sam ruch. Skutek niedoboru wchodzi dopiero w kroku 3.

## 1. Zapotrzebowanie: X workforce na budynek

### 1.1 Co jest „budynkiem” w ruchu v2

Stacje świata nie mają listy budynków. Mają moc przerobową (`capacity`) i role (`roles`), a solver `composeIndustry` dzieli tę moc między linie receptur. Budynek liczę więc jako **budynek-ekwiwalent roli**: moc linii tej roli podzieloną przez moc jednego budynku archetypu (`INDUSTRY_ARCHETYPES[rola].capacity`, tę samą liczbę bierze `composeFromBuildings` dla stacji gracza). Dzięki temu stacja świata i stacja gracza z budynków liczą się tym samym wzorem: druga huta gracza to druga porcja obsady huty.

Poza rolami przemysłu obsady potrzebują:
- **kopalnia:** wydobycie planety (`PLANET_YIELD.rate`, 1,0 = 9 jedn. na cykl);
- **port:** stanowiska cywilne doku;
- **magazyn:** bazowy skład portu ×4 = 4 magazyny, do tego budynki magazynowe z siatki stacji;
- **stocznia (pochylnie):** waga stoczni (`SHIPYARD_WEIGHT`).

Bez obsady workforce zostają:
- stanowiska wojskowe K-7, bo obsadza je garnizon frakcji, a wojsko nie należy do workforce;
- stacje opuszczone (Neptun);
- pozostałe budynki siatki stacji (`InfrastructureUI`: doki, harvestery, rafinerie, panele słoneczne, stocznie S–SC). To obraz ról, które już liczę. Osobny X dla nich liczyłby tych samych ludzi drugi raz.

### 1.2 Tabela X

Wzór: X ≈ 2700 ludzi × moc budynku × pracochłonność. Wspólna podstawa daje proporcję do skali zakładu, a pracochłonność wyraża, ile tej skali robi automat, a ile człowiek.

| budynek (rola) | moc budynku | pracochłonność | **X (ludzie świata)** | X w skali 1 | uzasadnienie |
|---|---|---|---|---|---|
| huta (`foundry`) | 0,9 | 1,0 | **2400** | 40 | piece, walcownia, spiekanie ceramiki; ciężka praca przy wsadzie |
| elektronika (`electronics`) | 0,7 | 1,0 | **1800** | 30 | cleanroomy są zautomatyzowane, ale obsługa wymaga kwalifikacji i kontroli jakości |
| zakłady lotne (`volatiles`) | 0,7 | 0,5 | **900** | 15 | elektroliza i synteza to instalacja ciągła z małą załogą |
| gazownia (`gasworks`) | 0,7 | 0,6 | **1080** | 18 | czerpaki atmosferyczne, kraking i materiał wybuchowy (nadzór bezpieczeństwa) |
| wzbogacalnia (`enrichment`) | 0,5 | 0,9 | **1200** | 20 | wirówki, ochrona i obrót materiałem rozszczepialnym |
| stocznia — montaż (`shipworks`) | 1,1 | 1,6 | **4800** | 80 | największy zakład: płyty, napędy, warp; montaż ręczny w doku |
| zakłady systemowe (`systems`) | 1,0 | 1,1 | **3000** | 50 | awionika, reaktory i tarcze, czyli precyzyjny montaż i testy |
| przetop złomu (`recycling`) | 0,4 | 1,4 | **1500** | 25 | cięcie wraków ręcznie, sortowanie |
| zbrojownia (`armory`) | 0,8 | 1,1 | **2400** | 40 | lufy, wyrzutnie i wieżyczki, z próbami ogniowymi |
| rafineria pasa (`beltworks`) | 0,7 | 0,85 | **1620** | 27 | nadstop, kompozyt, katalizator |
| amunicjownia (`munitions`) | 0,9 | 0,8 | **1980** | 33 | elaboracja amunicji to taśma z nadzorem |
| zakład lotniczy (`aerospace`) | 0,6 | 1,5 | **2400** | 40 | płatowce; małe serie i dużo ręcznej roboty |
| kopalnia (na 1,0 `rate`) | — | — | **1200** | 20 | wiertnice, kolektory i czerpaki planety lub księżyca |
| port (na stanowisko cywilne) | — | — | **12** | 0,2 | kontrola ruchu, cumowanie, odprawa |
| magazyn (na budynek) | — | — | **180** | 3 | skład, dźwigi i drony przeładunkowe (E12) obsługiwane z ziemi |
| stocznia — pochylnie (na 1,0 wagi) | — | — | **2520** | 42 | wodowanie, odbiory, uzbrajanie kadłuba |

Przy wdrożeniu liczby w skali 1 dobiera się tak, żeby po ×60 dawały całych ludzi. Tabela niżej liczy na zaokrągleniach X 2400 / 1800 / 900 / 1100 / 1200 / 4800 / 3000 / 1500 / 2400 / 1600 / 2000 / 2400, magazyn 200 i pochylnie 2500. Różnica wobec kolumny X jest poniżej 1%.

### 1.3 Obsada rynków (ludzie świata)

Budynki-ekwiwalenty z `STATION_INDUSTRY`:
- Ziemia: 23,7 (huta 9,2, elektronika 6,8, stocznia 3,7, systemy 2,4, zbrojownia 1,6);
- Mars: 23,1 (przetop złomu 7,2, huta 5,7, elektronika 4,8, stocznia 2,6…);
- Jowisz: 13,6;
- Ceres: 13,0;
- Saturn: 10,4;
- Wenus: 7,1;
- Westa: 5,9;
- Uran: 5,1;
- Merkury: 1,2.

| rynek | przemysł | kopalnia | port | magazyny | pochylnie | **N razem** |
|---|---|---|---|---|---|---|
| Ziemia | 63 109 | 0 | 1344 | 800 | 3000 | **68 253** |
| Mars | 53 323 | 1286 | 1344 | 800 | 5000 | **61 753** |
| Jowisz | 32 835 | 1920 | 1344 | 800 | 2750 | **39 649** |
| Ceres | 30 294 | 2217 | 1560 | 800 | 2500 | **37 371** |
| Wenus | 15 031 | 1680 | 936 | 800 | 2000 | **20 447** |
| Saturn | 12 326 | 1800 | 1248 | 800 | 1500 | **17 674** |
| Westa | 10 552 | 2854 | 1248 | 800 | 1000 | **16 454** |
| Uran | 5321 | 1620 | 936 | 800 | 1250 | **9927** |
| Merkury | 2933 | 2940 | 936 | 800 | 1500 | **9109** |
| Luna | — | 1125 | 624 | 800 | — | **2549** |
| 9 księżyców-kopalni (Io, Europa, Tytan, Enceladus, Rea, Tetyda, Tytania, Ariel, Tryton) | — | 432–689 | 312 | 800 | — | **1544–1801** |
| Oberon | — | 504 | 624 | 800 | — | **1928** |
| 5 węzłów (Fobos, Dejmos, Ganimedes, Kallisto, Mimas) | — | — | 312 | 800 | — | **1112** |
| **układ** | | | | | | **≈ 305 500** |

W skali 1 to ok. 5100 osób. Dla porównania: Ziemia zużywa w tej skali ~0,2 tlenu na cykl (`STATION_UPKEEP`), więc workforce jest nowym „bytem” tej samej rangi co tlen i stal, a nie towarem masowym.

**Kryjówki piratów** (Gniazdo Hildy, Złomowisko) nie mają przemysłu. Proponuję im obsadę portu i magazynów (~1100) ze źródłem wyłącznie z porwań (§ 5). Decyzja D9.

## 2. Źródła i podaż

### 2.1 Gdzie mieszkają ludzie

| źródło | rynek | rola w świecie | udział |
|---|---|---|---|
| ring Ziemi (Halo) | `earth` | megastruktura, największe miasto układu; Terra Nova | 32% |
| ring Marsa (ECUMENE) | `mars` | miasto orbitalne Marsa | 23% |
| strefy zielone Marsa | `mars` | osady na powierzchni pod kopułami i w strefach terraformowanych; Mars ma DWA źródła w jednym rynku | 16% |
| ring Jowisza (Fable) | `jupiter` | zaplecze układu zewnętrznego; Konsorcjum Zewnętrzne | 29% |

Rynek-źródło obsadza swoje budynki na miejscu, bez kursu: ludzie z ringu dojeżdżają do zakładów portu K-7 tranzytem ringu. Lecą tylko nadwyżki do innych rynków. To uczciwe ograniczenie. Ruch, który widać przy ringu, to odloty na księżyce i planety oraz powroty, a nie udawane „dojazdy do pracy” (§ 4.2).

### 2.2 Ile daje każde źródło

Rotacja przy `T` = 45 min to N × 4/3 na godzinę. Kto kogo zaopatruje, wynika z rynku (cena i odległość, bez przypisania frakcyjnego). Do szacunku przyjąłem najbliższe źródło:
- **Ziemia** zaopatruje Lunę, Merkurego i Wenus;
- **Mars** — Fobosa, Dejmosa, Ceres i Westę (Unię Pasa);
- **Jowisz** — swoje księżyce, Saturna z księżycami, Urana z księżycami i Trytona.

| źródło | rotacja lokalna / h | eksport / h | wymagana podaż / h (straty 15% na eksporcie, luz 20%) | **propozycja** | w skali 1 na cykl |
|---|---|---|---|---|---|
| ring Ziemi | 91 004 | 42 807 | 168 278 | **168 000 / h** | 15,6 |
| ring Marsa | } 82 337 | } 74 732 | } 201 935 | **121 000 / h** | 11,2 |
| strefy zielone Marsa | | | | **81 000 / h** | 7,5 |
| ring Jowisza | 52 865 | 63 588 | 151 189 | **151 000 / h** | 14,0 |
| **razem** | 226 206 | 181 127 | — | **521 000 / h** | 48,3 |

**Bilans układu:** rotacja 407 333 / h, podaż 521 000 / h, więc zapas wynosi 28%. Najciaśniejszy jest Mars: eksportuje 74,7 tys./h, z czego 71,8 tys. do Unii Pasa. To dobry hak fabularny (Unia zależy od ludzi z Marsa) i jednocześnie powód, żeby pierwszą bazą w asteroidzie była Ceres (§ 2.3).

Liczby ludności (np. ring Ziemi „ok. 2 mld mieszkańców”) są tylko opisem. Gra liczy samą podaż kontraktów na godzinę.

### 2.3 Jak dodać źródło (baza w asteroidzie)

Źródło to **cecha rynku `population`**, a budynek-źródło tylko ją podnosi. Obie drogi kończą się jedną liczbą: podażą na cykl.

- **Świat:** tabela `POPULATION_CENTERS` obok `PLANET_YIELD`, np. `{ earth: { ring: 15.6 }, mars: { ring: 11.2, green: 7.5 }, jupiter: { ring: 14.0 } }`. Produkcja liczy się jak wydobycie (`runPopulation` obok `runExtraction`), POZA solverem mocy, więc obecny bilans linii zostaje nietknięty.
- **Nowy rynek:** pole `population` w `MarketDef` (`defineMarket`), np. `addMarket(world, { id: 'hygiea-baza', …, population: { habitat: 3.0 } })`.
- **Budynek:** rola `habitat` bez linii receptur, czyli moduł mieszkalny. `addMarketBuilding(id, 'habitat')` dokłada `HABITAT_RATE` (propozycja: 2,0 na cykl w skali 1 ≈ 21 600 ludzi/h) i sam potrzebuje obsady jak magazyn, dla serwisu (180). Tą drogą przyjdą bazy w asteroidach i stacja gracza.
- **Przykład:** habitat na Ceres o podaży 5,5 na cykl (~60 tys./h) pokrywa własną obsadę Ceres. Eksport Marsa spada wtedy o ~50 tys./h i odpada ~97 dalekich kursów na godzinę. Ruch przenosi się z trasy Mars → pas na lokalne promy wokół Ceres.

## 3. Model

### 3.1 Trzy warianty

| | A. stała obsada z rotacją | B. towar zużywany (godziny pracy) | **C. obsada jako zapas, rotacja jako zużycie (rekomendacja)** |
|---|---|---|---|
| co jest w magazynie | ludzie na miejscu (osobny licznik) | „roboczogodziny” do zużycia | ludzie na miejscu = zapas towaru `workforce` |
| zużycie | rotacja co `T` | partia receptury zjada godziny | rotacja `zapas / T` na sekundę |
| skutek niedoboru | `e = f(obsada / N)` | zakład staje, gdy godzin brak (urwisko jak przy wsadzie) | `e = f(zapas / N)`, łagodny spadek |
| kod | nowy licznik, nowe API, osobne zlecenia | towar + wejście każdej receptury (wszystkie 46) | towar + jedno zużycie bytowe + jeden mnożnik wydajności |
| ruch | rotacja | jak C | rotacja `N / T` |
| blokada | obsada maleje z `T` | zapas kończy się nagle | obsada maleje wykładniczo z `T` |

**Rekomendacja: C.** To wariant A zapisany językiem, który ruch v2 już zna. Workforce jest towarem z `RESOURCES`, więc planista, kupcy, księga rynku, terminal, zapis ekonomii i piractwo widzą go bez nowego kodu. Zużycie idzie torem bytowym (`systemDemandFor`, `runLifeSupport`), a nie przez receptury. Wydajność to jeden mnożnik w `runRecipes` i `runExtraction`.
- **Prostota:** jeden nowy towar, jedna funkcja potrzeby (`stationWorkforceNeed(industry)`, czysta, z tabeli X), jedna produkcja źródła i jeden mnożnik.
- **Ruch:** ten sam co w A i B (rotacja `N / T`), więc ilością ruchu wariant nie przegrywa. O tym, ile go jest, decyduje `T`.
- **Skutek blokady jest stopniowy:** po 30 min bez dowozu obsada spada do 51%, po 60 min do 30% (przy `T` = 45). Gracz i wojna mają czas zareagować, a mimo to blokada boli.

### 3.2 Krzywa niedoboru

`r = min(1, zapas / N)`. Do wyboru:
- **proporcjonalnie, `e = r`:** gładko, bez urwisk; solver i bramka to lubią, a gracz czyta „82% obsady = 82% produkcji”;
- **od progu, `e = 0` dla `r < p`, potem liniowo od 0 do 1:** dramatycznie, ale kaskada (mniej stali → mniej płyt → stocznie) robi się nieprzewidywalna;
- **rekomendacja — proporcjonalnie z progiem minimalnym:** `e = r` dla `r ≥ 0,2`, `e = 0` dla `r < 0,2`. Uzasadnienie: zakład z ~1/5 załogi nie spełnia norm bezpieczeństwa i staje. Próg jest nisko, więc w normalnym biegu nigdy się nie włącza, a działa tylko przy długiej blokadzie.

```
e
1.0 |                         ______
    |                    ___/
0.5 |               ___/
    |          ___/
0.2 |        |/
0.0 |________|
    0       0.2              1.0   r = zapas / N
```

Zakres działania `e`:
- obejmuje receptury (`runRecipes`), wydobycie (`runExtraction`) i tempo budowy w stoczni;
- port w kroku 3 nie dławi (decyzja D6): mniej obsady wydłużyłoby postoje i zatkało redy, a ten skutek trzeba osobno zmierzyć;
- byt (`STATION_UPKEEP`) zostaje bez zmian: tlen zużywa osada, nie zmiana robocza;
- obsada dzieli się po równo między budynki rynku, bez priorytetów (decyzja D5).

**Symulacja blokady** (`.tmp/e16/bilans.mjs`: krok 1 min, dowóz po blokadzie do 2× rotacji):

| `T` | po 15 min | 30 min | 45 min | 60 min | powrót do 100% po zniesieniu |
|---|---|---|---|---|---|
| 30 min | 0,58 | 0,35 | 0,21 | 0,19 → **stop** | ~25 min |
| **45 min** | 0,70 | 0,50 | 0,36 | 0,30 | ~25 min |
| 60 min | 0,76 | 0,59 | 0,46 | 0,39 | ~30 min |
| 90 min | 0,84 | 0,71 | 0,60 | 0,53 | ~40 min |

### 3.3 Pułapki modelu (dla wdrażającego)

1. **Próg niedoboru planisty.** `DEFICIT_FILL` (25% magazynu) i zapas bezpieczeństwa liczą się od POJEMNOŚCI. Gdyby pojemność workforce równała się N, planista wiózłby ludzi dopiero przy obsadzie ~25–30%. Dlatego:
   - pojemność (kwatery) = **2 N**;
   - wydajność liczy się od N, nie od pojemności;
   - `declareDemand(stacja, 'workforce', { floor: 1,3 N })`;
   - wtedy w ustalonym biegu zapas stoi przy 1,1–1,3 N, czyli `r = 1`.
2. **Skala ×60.** Rotacja to `zapas × sekundy / T` liczone w sekundach gry (`options.seconds`), a nie w „cyklach”: przy ×60 `cycles` jest mnożnikiem przepustowości (pułapka z `runStationEconomy`). Potrzeba N w świecie = N w skali 1 × `economyScale`.
3. **Zapas startowy.** `seedStationStock` (0,45 pojemności) dałby `r = 0,9`. Workforce trzeba siać do N (wypełnienie 0,5), a źródła do 0,45 swojego magazynu (1 h podaży).
4. **Rozmiar portów.** `stationHaulTonnage` liczy tonaż przeładunku z `systemDemandFor`. Workforce w tej sumie zmieni mnożniki stanowisk i rozjedzie całą symulację. W kroku 1 wyłączyć go z tonażu (pasażerowie zajmują stanowisko krótko, § 4.3) i włączyć dopiero świadomie, z pomiarem.
5. **Solver świata.** `buildIndustryMap` pomija towary bez producenta w liniach (jak uran i złom). Workforce ma producenta poza liniami, więc solver go nie widzi. Tak ma zostać.

## 4. Transport

### 4.1 Promy pasażerskie

Masa ekwiwalentna: **0,25 t na osobę**, czyli fotel, podtrzymywanie życia i bagaż. Dzięki temu workforce jedzie na klasach ładowni `VAN_CLASSES` bez nowego mechanizmu wyboru klasy. Ładunek z ludźmi to osobne zlecenie i nie miesza się z towarem (decyzja D7), bo kadłub, postój i skutek przechwytu są inne.

| klasa | ładowność (t) | pasażerów | kadłub docelowy (nowy sprite, opis jak Z11) | do czasu sprite'a | trasy |
|---|---|---|---|---|---|
| `crew-small` (van) | 60 | **240** | `crew_shuttle` — prom rotacyjny, rzędy okien, stanowisko S | `inter_station_shuttle` | księżyce, krótkie skoki |
| `crew-medium` (hauler) | 160 | **640** | `crew_liner` — liniowiec kontraktowy | `container_ship` | planety wewnętrzne, Unia Pasa |
| `crew-large` (bulk) | 380 | **1520** | `colony_liner` — liniowiec dalekiego zasięgu | `long_haul_freighter` | Saturn, Uran |
| heavy / mega | — | — | ludzi nie wozi się w megafrachtowcach | — | — |

- Postój pasażerski: **60 s zaokrętowania + 60 s wyokrętowania** (towar: 90 + 120 s), bo ludzie wchodzą rękawem, a nie dronami.
- Kadłuby pasażerskie są cywilne (wpis `sideOnly`, bez gniazd, mostek cywilny, reguła `ruch-v2` § E13). Po trafieniu uciekają jak frachtowiec.
- Okna świecą (emitery HDR > 1), więc prom odróżnia się od frachtowca także z daleka.
- **Rotacja kontraktu:** `T` = 45 min gry (decyzja D2).

### 4.2 Ile kursów i gdzie (przy `T` = 45 min)

Ładunek średnio 80% ładowności.

| źródło | dokąd | kursy z ludźmi / h |
|---|---|---|
| Ziemia | Luna 17,7, Merkury 23,7, Wenus 53,2 | **95** |
| Mars | Fobos 7,7, Dejmos 7,7, Ceres 97,3, Westa 42,8 | **155** |
| Jowisz | 13 księżyców Jowisza, Saturna, Urana i Neptuna 139,5; Saturn 19,4; Uran 10,9 | **170** |
| **razem** | | **≈ 420 / h** |

**Powroty.** Ludzie kończący kontrakt wracają z rynku pracy do źródła. Lecą na powrotnym przelocie tego samego przewoźnika, który i tak wraca do portu domowego. Taki przelot nie zmienia ekonomii: rotacja to już zużycie w rynku pracy, a powrót niesie tylko znacznik `returning` dla obrazu, piractwa i przewoźnika. Przy źródle zajmuje stanowisko na 60 s wyokrętowania.

Liczby (dziś w powietrzu ~1250 kursów, w szczycie ~1600, ~5500 przewozów na godzinę):

| miejsce | ruch z ludźmi | co ile |
|---|---|---|
| port ringu Ziemi | 95 odlotów + 95 powrotów / h | **prom co ~19 s** |
| port ringu Marsa | 155 + 155 / h | **co ~12 s** |
| port ringu Jowisza | 170 + 170 / h | **co ~11 s** |
| skoki ring → Luna, ring → Fobos / Dejmos, ring → Io / Europa / Ganimedes / Kallisto | 18–36 kursów / h na księżyc | — |

Księżyce leżą tuż przy ringach, więc te skoki widać w bańce od razu. W powietrzu jest średnio ~65 kursów z ludźmi i ~65 powrotów, czyli **~130 statków więcej (+8–11%)**. Kurs pasażerski trwa ~9 min: skok na księżyc 4–6 min, do pasa 10–12 min, do Saturna i Urana ~20 min.

**Więcej ruchu, jeśli trzeba (decyzja D2):**
- `T` = 30 min: 630 kursów / h i ~200 statków więcej, ale po 60 min blokady zakład staje;
- `T` = 60 min: 315 kursów / h.

Ruch rośnie odwrotnie proporcjonalnie do `T`.

### 4.3 Zlecenia i API rynku

Wszystko idzie przez istniejące API, bez nowego planisty:
- **towar:** `workforce` na końcu swojej grupy w `RESOURCES` (nowa kategoria `CREW`, `mass: 0.25`, `value: 15` CR za osobę). Na końcu grupy, bo protokół i bufory liczą po indeksie (reguła `ruch-v2` § E8, E10).
- **podaż:** `runPopulation` dodaje do magazynu źródła `population × cycles`, do pojemności (1 h podaży). Źródło jest zwykłym sprzedawcą: oferta ponad `offerFloor`, cena `resourcePrice`.
- **popyt:** `systemDemandFor` dokłada rotację (`N × cykl / T`). Stąd `stationWantsResource`, skup (`postOffers`), kupcy i terminal widzą popyt same. Do tego `declareDemand(…, { floor: 1,3 N })` i pojemność 2 N (§ 3.3).
- **zlecenie:** `createShipmentOrder` z manifestem `{ workforce: n }` i znacznikiem `passengers: true`. `unitClassFor` wybiera dla niego klasę `crew-*`, a `TRAFFIC_UNIT_HULLS` mapuje ją na kadłuby z § 4.1. Postoje 60 / 60 s idą przez `stagesFromRoute(…, { loadSeconds: 60, unloadSeconds: 60 })`.
- **dostawa:** `tryDeliverShipmentOrder`, czyli `putStock`. Przechwyt idzie nową gałęzią `wreckShipmentOrder` (§ 5).
- **zużycie i wydajność:** `runLifeSupport` zjada rotację, a `econ.workforceRatio` (r) czytają `runRecipes`, `runExtraction` i stocznia.
- **zapis:** zapas workforce jest w magazynach, więc wchodzi do zapisu ekonomii bez zmian. Stary zapis bez tego towaru wczyta się, a workforce zostanie z zapasu startowego.

## 5. Piractwo i wojna

**Przechwyt przez piratów, czyli porwanie** (rekomendacja). Promu z ludźmi nie niszczy się: zabicie setek cywilów w tle ekonomii byłoby i ponure, i bez sensu dla piratów.
- Prom i ludzie trafiają do najbliższej kryjówki jako **zakładnicy** (zapas `workforce` kryjówki z rekordem okupu).
- Okup wynosi 1,5 × wartość ludzi (np. liniowiec, 512 osób: ~11,5 tys. CR). Płaci przewoźnik, czyli firma frakcji.
- Po zapłacie zakładnicy wracają do źródła z opóźnieniem 10 min.
- Bez zapłaty w 30 min zostają w kryjówce jako jej obsada (kryjówki nie mają innego źródła, D9). Porwania mają wtedy dla piratów powód ekonomiczny, zgodnie z zasadą „wszystko, co lata, ma powód”.
- Statystyka bramki liczy porwanie jako przechwyt.

**Wariant prostszy** (D8): strata kursu jak przy towarze, prom zawraca do źródła, a ludzie nie dolatują. Ten sam skutek dla rynku pracy, bez okupu.

**Ekspozycja.** Liniowce lecą głównie hipercruise'em i warpem, a skoki na księżyce trwają krótko, więc ryzyko na kurs będzie niższe niż przy towarze. Najbardziej narażona jest trasa Mars → pas (kryjówka Gniazdo Hildy na 52 AU). To dobra treść: Unia Pasa płaci za brak własnych ludzi.

**Wojna:**
- **prom wrogiej frakcji** jest internowany: zawraca do źródła bez strat w ludziach, kurs liczy się jako przechwyt;
- **blokada źródła** (flota wroga przy porcie ringu) wstrzymuje cały eksport ringu. Zgodnie z § 3.2 obsada odbiorców spada do 50% po 30 min i do 30% po 60 min. Uderzenie w ring Ziemi dławi Merkurego, Wenus i Lunę, a w ring Marsa — Unię Pasa. **Ringi stają się celami strategicznymi**;
- **blokada portu odbiorcy** ma ten sam skutek dla jednego rynku;
- nic nowego nie trzeba pisać: kursy przez zablokowany port są przechwytywane albo czekają tak samo jak dziś, a skutek bierze się sam z rotacji.

**Rekomendacja ochronna:** promy pasażerskie dostają mnożnik ekspozycji ×0,5 (eskorta i policja na liniach pasażerskich). Bez niego przechwyty pasażerów mogą podnieść wynik pasma o ~0,6 pp (§ 7). Decyzja D8.

## 6. Gracz

### 6.1 Kontrakty przewozu

Gracz handluje workforce jak towarem, przez tę samą księgę. Nazwa w UI to **„kontrakt rotacyjny”**, nigdy „kupno ludzi”.
- Gracz bierze kontrakt w porcie źródła (`takeStock`: N osób, cena `ask`) i oddaje go w porcie, który skupuje (`putStock`, cena `bid`). Zysk to różnica cen, a przy głodzie obsady dochodzi dopłata `duress`.
- Ludzie w ładowni potrzebują **modułu pasażerskiego**: karta WYPOSAŻENIE, ładownia kabinowa, np. 300 osób w Atlasie (decyzja D10). Bez modułu terminal nie sprzeda kontraktu.
- Ludzie w ładowni gracza zaliczają kontrakt w czasie: po `T` od zaokrętowania kontrakt wygasa. Nie da się więc przechować ludzi na zapas.

### 6.2 Rekrutacja załogi i fabuła

- **Start (oficer Terra Novy, Atlas):** załogę Atlasa daje frakcja, więc rekrutacji nie ma.
- **Po zdradzie gracz zaczyna od zera.** Ma minimalną załogę, a porty Terra Novy odmawiają rekrutacji (reputacja). Werbunek idzie tylko w neutralnych źródłach: strefy zielone Marsa, ring Jowisza, później bazy w asteroidach. Zabiera z rynku zapas `workforce` po cenie `ask`, tą samą drogą co kontrakt.
- **Skutek załogi:** propozycja minimalna to sam mnożnik napraw (rój dronów R, kontrola uszkodzeń) i szybkości przeładowania wież. Lot i celność zostają bez zmian. Decyzja D11, bo dotyka balansu walki.
- **Własna stacja (późno, z fabuły):** jej budynki potrzebują workforce według tej samej tabeli X (`composeFromBuildings`). Gracz zaopatruje ją na trzy sposoby:
  - z rynku: stacja gracza jest rynkiem, więc kupcy i puste przeloty przywiozą ludzi same;
  - własnymi kontraktami;
  - budynkiem `habitat` (§ 2.3), który daje własne źródło.

  Przy stacji gracza widać jego promy i to on jest celem porwań.

### 6.3 Terminal i CIC

- **Terminal, nowa karta „Kadry”:**
  - obsada portu (np. „Obsada 82%: jest 11 800 z 14 400”);
  - rotacja na godzinę i ludzie w drodze;
  - wydajność produkcji `e`;
  - oferta kontraktów (sprzedaż i skup, cena), z tych samych pól oferty portu (`sell` / `buy`).

  Workforce nie trafia na listę towarów karty „Handel”, żeby nie mieszać ludzi z rudą.
- **CIC, warstwa HANDEL (H):**
  - trasy pasażerskie osobnym kolorem;
  - porty z obsadą poniżej 80% na bursztynowo, poniżej 50% na czerwono;
  - w `summarizeTrade` dochodzi pozycja „ludzie w drodze”;
  - kryjówki z zakładnikami: znacznik po rozpoznaniu (mgła wojny, `SensorSystem.hides`).
- **Radar:** promy jak każdy statek ruchu, gdy radar dostanie statki ruchu (dziś ich nie ma, reguła `ruch-v2`).

## 7. Bilans i bramka

Baza (`SEED=7 … 240 1 4 60`, `main` `f9707ac8`):
- 22 035 przewozów, czyli ~5500 / h;
- skuteczność 92%;
- w powietrzu na koniec 1249, w szczycie 1619;
- średnia kolejka na redzie 2.

Bramka § 8 planu (`06f4d10a`) daje przechwyty 15,2–15,4%, kolejki 0,79–1,87 i tick 11,5–12,3 ms.

| próg bramki (§ 5 planu) | szacunek z workforce (`T` = 45) | jak policzone |
|---|---|---|
| przechwyty 12–20% | **14,6–15,9%** | 420 kursów z ludźmi na ~5500 przewozów (7% ładunków); przy ryzyku pasażera 5% / 15% / 25% wynik przesuwa się z 15,3% do 14,6 / 15,3 / 15,9% |
| głód ≤ 30 min | bez zmian w ustalonym biegu: zapas 28%, `r = 1` | ryzyko: dalekie odcinki (Tryton 120 AU, Uran) przy jednym źródle (Jowisz); w kroku 3 pilnować |
| stocznie ≤ 30 min | bez zmian przy `r = 1`; przy blokadzie pochylnie zwalniają z `e` | — |
| kolejka na redzie ≤ 2 | **+0,1–0,3** w portach ringów | stanowiska: Mars 310 ruchów × 60 s = 18 600 s/h na 403 200 s/h cywilnych = +4,6%; Ziemia +2,8%; Jowisz +5,1%; Ceres +1,2% |
| tick ≤ 25 ms | **~12,5–13,5 ms** (+8–10%) | kursów +7,6%, w powietrzu +8–11% |

**Nowy próg obsady** (propozycja, D12): w biegu bez wymuszonej blokady średnia obsada każdego rynku z budynkami ≥ 0,95, a żaden rynek nie stoi poniżej 0,8 dłużej niż 30 min. Głód samego towaru `workforce` łapie już istniejący próg głodu, bo to towar chciany.

## 8. Plan wdrożenia i ryzyka

Każdy krok to osobny commit z bramką na 3 ziarnach (7 / 11 / 23), jak w E10. Krok bez zmiany zachowania ma dać symulację identyczną liczba w liczbę.

| krok | co | sprawdzenie |
|---|---|---|
| **W0** | dane bez skutku: towar `workforce` (koniec grupy), tabela X, `stationWorkforceNeed`, `POPULATION_CENTERS`, pole `population` w `MarketDef`, testy czystych funkcji | symulacja na ziarnie 7 identyczna liczba w liczbę; `npm test`, `resources.test` (producent i odbiorca) |
| **W1** | źródła i popyt: `runPopulation`, rotacja w `systemDemandFor` (bez `stationHaulTonnage`), pojemność 2 N, `declareDemand` 1,3 N, zapas startowy N; **`e = 1` zawsze** | bramka: przechwyty, kolejki, tick; nowy pomiar obsady (sam licznik) |
| **W2** | promy: zlecenia `passengers`, klasy `crew-*` na obecnych sprite'ach, postoje 60 / 60 s, powroty z `returning` | bramka + `ruch-banka-gra` (promy przy Ziemi, Lunie i Marsie, 0 pipeline'ów sync) |
| **W3** | skutek niedoboru: `e = r` od progu 0,2 w recepturach, wydobyciu i stoczni | bramka z nowym progiem obsady; scenariusz blokady (pomiar spadku i powrotu, § 3.2) |
| **W4** | piractwo i wojna: porwania z okupem albo strata kursu (D8), internowanie, ekspozycja ×0,5, potrzeba kryjówek (D9) | bramka (pasmo przechwytów), suita `piracy` |
| **W5** | UI: karta „Kadry”, warstwa CIC, oferta kontraktów w buforze rynku | `rynek-gra` (karta, kontrakt, zapis → F5) |
| **W6** | gracz: moduł pasażerski, kontrakty, werbunek po zdradzie (D10, D11), budynek `habitat` dla stacji gracza i baz asteroid | testy gracza na rynku; gameplay testuje użytkownik |
| **W7** | kadłuby `crew_shuttle`, `crew_liner`, `colony_liner`: sprite'y (opisy jak Z11) i komplet tabel E13 (mostek cywilny, rdzeń, zbiornik, dysze, `sideOnly`) | `trafficHullData.test`, `freighterSideThrusters.test`, przegląd portów |

**Ryzyka:**
1. **Chroniczna niedoobsada** przez progi planisty liczone od pojemności (§ 3.3, p. 1). Lekarstwem są pojemność 2 N i podłoga 1,3 N. Jeśli to nie wystarczy, workforce dostaje własne `inventorySafetyFill`.
2. **Rozjechanie portów,** gdy workforce wejdzie do `stationHaulTonnage`. Dlatego w W1 zostaje poza tonażem.
3. **Kaskada przy `e < 1`:** mniej stali, mniej płyt, stocznie stają. Pomaga próg nisko (0,2) i zapas 28%, a W3 osobno mierzy blokadę.
4. **Mars jako jedyne źródło Unii Pasa:** 155 kursów / h i jeden punkt awarii. Proponuję habitat na Ceres jako pierwszą bazę w asteroidzie (D4).
5. **Indeksy towarów:** nowy towar na końcu grupy; protokół workera i bufory rynku trzeba przejrzeć (reguła `ruch-v2`, pułapki 4 i 6).
6. **Ton narracji:** ludzie to nie ruda. UI mówi o kontraktach i rotacjach, porwania kończą się okupem albo werbunkiem, nie śmiercią.
7. **Tick:** +8–10%, z zapasem do progu 25 ms.
8. **Bańka:** promy przy ringach to więcej encji w bańce przy Ziemi. Limit encji i koszt proxy E6 / E15 zmierzyć w W2.

## 9. Decyzje dla użytkownika „na strzała”

| # | pytanie | rekomendacja domyślna |
|---|---|---|
| D1 | Model workforce? | **C — obsada jako zapas, rotacja jako zużycie** (§ 3.1) |
| D2 | Długość kontraktu `T`? | **45 min gry** (420 kursów / h); 30 min — więcej ruchu i ostrzejsza blokada, 60 min — łagodniej |
| D3 | Krzywa niedoboru? | **proporcjonalnie (`e = r`) z progiem 0,2** |
| D4 | Pierwsza baza w asteroidzie jako źródło? | **Ceres (habitat), w kroku W6** — odciąża Marsa o ~50 tys./h |
| D5 | Priorytety obsady między budynkami jednego rynku? | **brak, wszystkie po równo** |
| D6 | Czy brak obsady portu wydłuża postoje? | **nie w W3**, osobny pomiar później |
| D7 | Ludzie i towar w jednym statku? | **nie, osobne zlecenia pasażerskie** |
| D8 | Przechwyt promu przez piratów? | **porwanie z okupem** (zakładnicy w kryjówce, bez zapłaty zostają jej obsadą) i ekspozycja promów ×0,5 |
| D9 | Czy kryjówki piratów potrzebują workforce? | **tak, ~1100, tylko z porwań** |
| D10 | Moduł pasażerski gracza? | **tak, karta WYPOSAŻENIE, Atlas ~300 osób** |
| D11 | Co daje załoga gracza po zdradzie? | **tylko naprawy (rój R, kontrola uszkodzeń) i przeładowanie wież**; werbunek w neutralnych źródłach |
| D12 | Nowy próg bramki? | **obsada ≥ 0,95 średnio, żaden rynek < 0,8 dłużej niż 30 min** |
| D13 | Tabela X i podaż źródeł (§ 1.2, § 2.2)? | **przyjąć jak w dokumencie**, stroić w W1–W3 przez bramkę |
| D14 | Nowe sprite'y promów? | **tak (W7)**; do tego czasu obecne kadłuby frachtowców |
