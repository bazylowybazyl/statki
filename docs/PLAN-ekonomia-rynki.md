# PLAN — ekonomia z rynkami (przebudowa ruchu v2)

Spisany 2026-10-21. Źródło prawdy dla sesji przebudowy ekonomii. Sesje raportują orkiestratorowi, a § 8 „Stan” prowadzi orkiestrator.

Poprzednie dokumenty obowiązują tam, gdzie ten plan ich nie zmienia:
- `docs/BRIEF-ruch-v2.md`: trzy warstwy (rekordy → węzły → bańka) i pułapki, których nie wolno powtarzać;
- `docs/PLAN-ruch-v2-w-grze.md`: zadania Z1–Z15, port K-7, liczby portów;
- `docs/SPEC-ekonomia-i-logistyka.md`;
- `docs/SPEC-kolejkowanie-slotowe.md`.

## 1. Decyzje użytkownika

Z 2026-10-21:
1. **Nie piszemy nowej ekonomii, tylko przebudowujemy ruch v2** wokół jednego obiektu „rynek”. Cel: nowy rynek dodaje się jednym wpisem w tabeli albo jednym wywołaniem w trakcie gry.
2. **Stocznie bez własnych podzespołów zaopatrują handlowcy, którzy szukają zysku.** Stocznia bez podzespołów płaci za nie więcej. Podaż ma przyjść z ceny (kupcy, `agentFleets`), a nie z planisty frakcji.
3. **Węgiel, nikiel i platyna idą w podzespoły.** Ekonomia ma konsumować różne wieżyczki, a nie tylko cztery abstrakcyjne klasy broni.
4. **Napędy:**
   - gracz lata trochę za szybko i zostanie zwolniony;
   - warp zostaje szybki (260 tys. j./s);
   - dochodzi **hipercruise**, czyli przelot z większym vmax dla statków (gracza i NPC). Napędzają go NOWE RODZAJE SILNIKÓW, które rozpędzają statek do 20–40 tys. j./s. Według decyzji z 2026-10-03 hipercruise przejmuje odcinki `'drive'` rozkazu TRAVEL TO, bez osobnej akcji na mapie.
5. **Górnicy NPC naprawdę uszczuplają pas i mogą robić w nim wyrwy** widoczne w polu.
6. **Orkiestracja:** sesje pracują równolegle, orkiestrator przegląda ich wyniki i scala.
7. **Receptury dostają osobną sesję (E8):** wieżyczki, silniki i nowe rodzaje silników, w tym silniki hipercruise.

Z 2026-10-22 (po fali 1):

8. **Prędkości:**
   - bojowy Atlasa około 500 j/s, ale nie równo 500 (nieokrągłe wartości także dla innych kadłubów);
   - dopalacz w walce ok. 1000–1200 j/s;
   - PRZELOT znika, zastępuje go hipercruise, więc dopalacz w PRZELOCIE przestaje obowiązywać;
   - warp 100–250 tys. j/s zależnie od napędu warp `warp_mk1`, `warp_mk2`, `warp_mk3`.
9. **Wpływ hipercruise** na trafienia, tunelowanie i wydajność sprawdza osobna sesja (E9).
10. **Receptury:** osobna sesja projektuje, jak naprawdę wyglądałyby receptury przy surowcach z kopalni i asteroid (E10). Potem rozmowa z użytkownikiem.
11. **Wyrwy:**
    - mgła i pył RZEDNĄ, bo bez asteroid nie ma pyłu; niektóre asteroidy produkują gazy, a niewdrożone demo gazów i mgieł sprawdzi i wpina sesja E11;
    - tona urobku = tona pasa;
    - regeneracja wyłączona.
12. **Więcej piractwa:** cel ok. 15% przechwytów (pasmo 12–20%).
13. **Zgoda na przerwę:** do bańki (fala 3) w grze nie widać statków ruchu.

Nadal obowiązują wcześniejsze decyzje (bez pytania użytkownika ich nie zmieniamy):
- wszystko, co lata, ma powód ekonomiczny;
- rekordy kursów są autorytatywne dla ekonomii, a bańka działa tylko wokół gracza;
- zator może opóźniać, ale nie głodzić;
- warp jest nietykalny;
- brama jest tańsza od warpa, ale nie szybsza;
- uran jest tylko w Kuiperze;
- Ziemia nic nie wydobywa;
- gospodarka działa w skali ×60;
- K-7 to port wojskowy.

## 2. Stan wyjściowy (2026-10-21)

Pomiar: `node scripts/symulacja-ruchu.mjs 240 1 4 60` (240 min gry, presja piratów ×1, magazyny ×4, skala ×60). Bieg trwa ok. 1 min.

| ziarno | dostawy | przechwycone | skuteczność | szczyt kursów | tick |
|---|---|---|---|---|---|
| 7 | 8274 | 5611 (40% rozstrzygniętych) | 60,8% | 4971 | 19,7 ms |
| 11 | 8327 | 5718 (41%) | 62,0% | 5063 | 21,9 ms |
| 23 | 8165 | 5717 (41%) | 61,2% | 4962 | 21,9 ms |

Kolejka na redzie na koniec biegu: 21 / 99 / 77 statków (ziarna 7 / 11 / 23). Na wszystkich trzech ziarnach te same 5 stoczni głoduje przez całe 240 min.

Do tego przy ziarnie 7:
- Ziemia ma Fe 1,4% i Si 3,9%, a Merkury Fe 99,9% i Si 80,9%.
- Merkury, Wenus, Saturn, Uran i Westa to stocznie bez własnych podzespołów. Ich podzespoły stoją na 0% przez całe 4 h (przyduszenie ×2,6), choć w tym czasie zwodowano 563 okręty.
- Saturn ma zajęte 25 z 26 stanowisk, a w kolejce czeka 21 statków.
- Symulacja kończy się komunikatem „BILANS NIE DOMYKA SIĘ”, 8 z 27 stacji jest na skraju.
- `npm test`: 31 suit, 1668 asercji, wszystkie zielone. Testy bańki i portu też zielone.

Braki strukturalne:
- **Rynki.**
  - Nowy rynek wymaga zmian w 5–8 miejscach: węzeł (`systemMap` / `smallBodies` / `PIRATE_OUTPOSTS`), `SYSTEM_INDUSTRY_SPEC`, frakcja, `SHIPYARD_WEIGHT`, `DEFAULT_GATE_HUBS`, lista opuszczonych stacji i `stations[]` w `index.html`.
  - W trakcie gry nie da się dodać rynku. `addStationNode` i `addStationBuilding` wołają tylko testy, a protokół workera obsługuje `STATION` tylko przy zniszczeniu stacji.
  - Stacje misyjne piratów nie trafiają do ruchu v2.
- **Brak jednego modelu rynku.**
  - Dwie wyceny: `resourcePrice` i `getLocalBasePrice`.
  - Dwa planisty: `planShipment` z `cargoFleet` i planista dyspozytora.
  - Dwie produkcje: `runStationEconomy` i `applyEconomyProduction` (`infrastructureUI.js`).
  - `trafficDirector.js` importuje stary `cargoFleet.js`.
  - Bez `?trafficV2` gra działa na starej ekonomii.
- **Pas.**
  - `trafficFields()` jest wpisane na sztywno: pas sięga 35,5–47 AU, a skały kończą się na 41,5 AU, więc ok. 51% wypraw ląduje w pustce.
  - Skład pola jest płaski: 5 rud z wagą 1, bez rodzin, Hild i Trojańczyków.
  - `carbon_ore`, `nickel_ore` i `platinum_ore` nie mają receptur ani popytu.
  - Górnicy NPC wydobywają urobek z niczego i nie uszczuplają pasa.
- **Bańka (Z13)** nie jest wpięta i zna tylko ringi oraz siebie nawzajem.
  - Brak trafień i zderzeń z graczem.
  - Osobne rejestry stanowisk: gra w `haloPortDocking`, worker osobno, a `berth-hold` istnieje tylko jako komentarz w protokole.
  - Proxy nie działa w workerze renderu (`new Image()`, `window.SUN`).
  - Gabaryty kadłubów są tymczasowe.
  - NPC gry giną 20 tys. j. od gracza, a bańka ma promień 60 tys. j.
- **Prędkości.** Ruch v2 liczy napęd konwencjonalny 800 j./s i warp 20 tys. j./s. Gracz ma PRZELOT Atlasa do 1500 j./s (z dopalaczem 3000) i warp 260 tys. j./s (`src/data/shipFlightSpecs.js`, `src/game/shipModes.js`).

## 3. Architektura docelowa

### 3.1 Rynek (Market)

- **MarketDef** to jedna tabela danych (`src/data/markets.js`). Pola:
  - id i nazwa;
  - rodzaj: planeta, księżyc, małe ciało, placówka, kryjówka albo stacja gracza;
  - źródło położenia: orbita, ciało rodzica, kąt z gry;
  - frakcja;
  - przemysł: odnośnik do specyfikacji albo lista budynków;
  - stocznia (waga) i brama (hub);
  - doki: ring K-7, pomosty, megadok albo hangar, plus mnożnik stanowisk;
  - flagi: opuszczona, kryjówka.

  Tabele rozrzucone dziś po kodzie stają się polami tej definicji: `SHIPYARD_WEIGHT`, `PIRATE_OUTPOSTS`, `DEFAULT_GATE_HUBS`, lista opuszczonych stacji i zapasowe `['earth']`.
- **`addMarket(world, def)`** zakłada za jednym razem węzeł, gospodarkę z zapasem startowym, doki, redę albo hangar, stocznię, kryjówkę i porty domowe przewoźników. Builder świata to pętla `addMarket` po tabeli, więc start gry i dodanie rynku w trakcie gry idą tą samą ścieżką. Obok niej: `removeMarket`, `setMarketOwner`, `addMarketBuilding`.
- **Worker** dostaje wiadomości `MARKET_ADD`, `MARKET_BUILDING` i `MARKET_REMOVE`, a most `TrafficBridge.addMarket(def)` i pokrewne.
- **Jeden model handlu (fala 2).**
  - Rynek wystawia oferty sprzedaży (zapas ponad rezerwę) i skupu (poniżej celu) z ceną `resourcePrice`, a towar w drodze trzyma jako rezerwacje.
  - Wszyscy handlują przez to samo API: przewoźnicy frakcji, kupcy, gracz, stocznie, wojna, złomiarze i paser.
  - Producent sprzedaje, gdy oferta skupu przebija jego cenę rezerwacji; własna stocznia nie ma bezwzględnego pierwszeństwa. Z tego mechanizmu wynika decyzja 2.

### 3.2 Jedna ekonomia

Po fali 2 gra ma jedną symulację: ruch v2 w workerze, bez flagi `?trafficV2`. Usuwamy:
- vany i tranzyt z `cargoFleet`;
- `transitController.js`;
- `updateStationEconomies` i `getLocalBasePrice`;
- produkcję i pojemności z `infrastructureUI.js`.

Terminal i UI czytają rynek z mostu.

Do czasu bańki (fala 3) gracz nie zobaczy w grze statków ruchu, bo stare vany znikną razem ze starą ekonomią. E2 sprawdza, czy da się na ten czas zostawić je jako widok kursów v2. Jeśli tak, robi to; jeśli nie, zgłasza tę decyzję.

### 3.3 Pas w ekonomii

- **Pola wydobywcze z danych pasa:** `BELT_DEFINITIONS` (przystanki składu), `ASTEROID_YIELD`, szczyty rodzin (`familyPeaks`) i krawędź `mainOuterAu`, a także Hildy, Trojańczycy i Kuiper. Punkt wyprawy losuje się z gęstości pola, a urobek ze składu w tym miejscu.
- **Uszczuplenie.** Rejestr wydobycia w świecie ruchu jest autorytatywny dla ekonomii i trzyma masę zabraną z każdej komórki lub obszaru.
  - Po przekroczeniu progu pole dostaje WYRWĘ (mniejsza gęstość albo pusty obszar), w grze i w obrazie.
  - Wyrwa idzie przez konfigurację świata pasa: `beltWorld` → pole gry i replika obrazu (reguła `pas-asteroid`).
  - Wydobycie gracza liczy się do tego samego rejestru.
  - Domyślnie pas się nie regeneruje.

### 3.4 Napędy

Jedna tabela napędów (`src/data/driveModes.js`) obsługuje gracza, NPC gry i ruch v2:
- tryb bojowy i PRZELOT;
- **hipercruise**: przejmuje odcinki `'drive'` rozkazu TRAVEL TO. Dają go rodzaje silnika `hypercruise_mk1`, `hypercruise_mk2` i `hypercruise_mk3` z vmax 20 / 30 / 40 tys. j./s. Kontrakt E5 ↔ E8:
  - E5 może stroić liczby w zakresie 20–40 tys. j./s i dodaje przyspieszenia per klasa kadłuba;
  - E8 robi z silników towary z recepturami;
  - id się nie zmieniają;
- warp: 260 tys. j./s, kosztuje paliwo, nietykalny.

Ruch v2 liczy z tej tabeli czasy, paliwo i ryzyko przechwytu. Propozycja do potwierdzenia przez użytkownika: hipercruise da się przerwać (piractwo żyje na odcinkach poza warpem, przy portach i bramach), warpu nie.

### 3.5 Bańka (fala 3)

Z13 w wersji zwężonej:
- najpierw jeden port (Ziemia);
- trafienia i zderzenia z graczem na prostych obrysach 2D;
- wspólny rejestr stanowisk gra ↔ worker (`berth-hold`);
- proxy w workerze renderu: blok migawki, bez `window`, rozgrzewka w `Core3D.warmup`;
- gabaryty z `trafficHullFootprint`;
- promień bańki zgodny z czasem życia NPC.

Awans do pełnego NPC przyjdzie później.

## 4. Zadania

| ID | zadanie | fala | zależy od | pliki (właściciel) |
|---|---|---|---|---|
| E1 | Rynek jako jeden obiekt: MarketDef, `addMarket` w trakcie gry, wiadomości workera | 1 | — | nowe `src/data/markets.js` i `src/game/traffic/markets.js`; `trafficWorld.js` (bez `trafficFields`); `travelNetwork.js` (węzły, bez `DRIVE_MODES` / wyceny tras i `randomFieldSpot`); rejestracja stacji w `trafficDirector.js`; `trafficCore.js`; `trafficProtocol.js`; `src/game/trafficBridge.js`; zapasowe id w `agentFleets.js` / `carrierRoster.js` / `transportCompanies.js`; blok „RUCH v2” w `index.html` |
| E3 | Pas w ekonomii: pola z danych pasa, uszczuplenie, wyrwy | 1 | — | nowy moduł pól wydobywczych; tylko funkcje `trafficFields()` i `randomFieldSpot()`; wydobycie w `trafficDirector.js` (`dispatchMining`, rozładunek urobku); wiadomość wyrw dopisana NA KOŃCU `trafficProtocol.js` i jej obsługa w moście; pliki pasa (`asteroidBeltField.js`, `beltWorld.js`, replika obrazu w `src/3d/asteroids/`); blok pasa i wydobycia w `index.html` |
| E4 | Ekonomia: stocznie zaopatrywane ceną (cena rezerwacji producenta, kupcy), piractwo, Saturn, bramka bilansu (§ 5), końcowe strojenie | 1 | końcowe strojenie po E5 i E8 | `stationEconomy.js` (`PRICE_MODEL`, progi i rezerwy — bez receptur, archetypów i list konsumpcji); logika licytacji stoczni w `shipyards.js` (bez `WARSHIP_CLASSES`); logika kupców w `agentFleets.js`; `tradeMarket.js`; `piracy.js`; progi nadwyżki w `cargoFleet.js`; planista dyspozytora (bez wydobycia i rejestracji stacji); nowy skrypt bramki w `scripts/` |
| E8 | Receptury: rafinaty z węgla, niklu i platyny; wieżyczki jako różne towary; silniki jako różne towary, w tym silniki hipercruise `hypercruise_mk1..3` | 1 | kontrakt id silników z E5 (§ 3.4) | `resources.js` (towary, receptury); `INDUSTRY_ARCHETYPES` i wpisy ról w `SYSTEM_INDUSTRY_SPEC` (bez zmiany struktury); listy konsumpcji (`MILITARY_UPKEEP`, `FLEET_DEMAND`) w `stationEconomy.js`; `weaponEconomy.js`; `WARSHIP_CLASSES` w `shipyards.js`; listy konsumpcji w `warDispatcher.js` |
| E5 | Napędy: jedna tabela, zwolniony gracz, hipercruise, ruch v2 na nowych prędkościach | 1 | — | nowy `src/data/driveModes.js`; `DRIVE_MODES` i wycena tras w `travelNetwork.js`; lot gracza (`src/data/shipFlightSpecs.js`, `src/game/shipModes.js`, `src/game/flight/*`, `src/game/travelNav.js`, bloki lotu, TRAVEL TO i HUD w `index.html`); wejście (`src/input/inputActions.js`, `GameActions`) |
| E2 | Jedna ekonomia: usunięcie starej ekonomii i flagi `?trafficV2`; `planShipment` i stan zleceń przeniesione z `cargoFleet.js` do ruchu v2; terminal i UI na rynku z mostu; reguła `ruch-v2` | 2 | E1 (strojenie E4 idzie równolegle, bez wspólnych plików) | `trafficDirector.js` (zależność od `cargoFleet`, stan zleceń); `cargoFleet.js` i `transitController.js` (do usunięcia); `infrastructureUI.js`; `index.html` (stara ekonomia, gałęzie `trafficV2`, terminal); `src/game/trafficBridge.js`; nowa reguła `.claude/rules/ruch-v2.md` + wiersz w indeksie `AGENTS.md` |
| E9 | Hipercruise: trafienia, tunelowanie, wydajność — pomiar i bezpieczne poprawki | 2 | E5 (prędkości przestrajane równolegle) | kolizje i trafienia (`hullBodies.js` i pokrewne, pętle kolizji i pocisków w `index.html`, kolizje `beltWorld`, `haloRingCollision.js`), testy |
| E10 | Receptury realistyczne — projekt do rozmowy z użytkownikiem, bez kodu | 2 | — | `docs/PROPOZYCJA-receptury-realistyczne.md` |
| E11 | Gazy i mgły: stan dema (czy gotowe do produkcji, co stoi) i wpięcie do gry | 2 | — (z wyrwami E3: źródła gazu z asteroid) | najpierw ocena i raport; dalej moduły gazu (reguła `wybuchy-gaz`) |
| E2b | Jeden model handlu: API rynku (oferty, rezerwacje) dla wszystkich — przewoźnicy, kupcy, gracz, stocznie, wojna, złomiarze, paser | 2 | E2 i końcowe strojenie E4 | moduły ruchu v2 (`agentFleets.js`, `shipyards.js`, `scrapperFleets.js`, `piracy.js`, planista) |
| E6 | Bańka w grze (Z13 zwężone, § 3.5) | 3 | E1, E2, E5 | nowy `src/game/trafficBubble.js`, `materializedFlight.js`, `shipProxyBatch3D.js` + `src/render/`, `haloPortDocking.js`, `index.html` |
| E7 | Gracz na rynku: terminal na ofertach, komputer handlowy, stacja gracza jako rynek, zapis stanu ekonomii i wyrw | 4 | E2 | `src/ui/`, `index.html`, zapis gry |

Fala 1 (E1, E3, E4, E5, E8) rusza równolegle, każda sesja we własnym worktree. Pliki wspólne (`trafficWorld.js`, `travelNetwork.js`, `trafficProtocol.js`, `trafficBridge.js`, `agentFleets.js`, `trafficDirector.js`) dzielimy po FUNKCJACH, jak w tabeli. Konflikty przy scalaniu rozwiązuje orkiestrator.

Kolejność scalania: E1 → E5 → E8 → E3 → E4. E4 kończy strojenie bilansu na prędkościach z E5 i recepturach z E8.

## 5. Bramka bilansu

Bramkę buduje E4, używają jej wszyscy. Skrypt w `scripts/` puszcza symulację na 3 ziarnach (7, 11, 23; 240 min, presja 1, magazyny ×4, skala ×60) i sprawdza progi. Wynik zapisuje w JSON do `.tmp/`, a przy niezaliczeniu kończy się kodem wyjścia ≠ 0.

Progi startowe to propozycja: E4 je stroi, użytkownik akceptuje.
- przechwycone 12–20% rozstrzygniętych kursów z ładunkiem przy presji ×1 (decyzja z 2026-10-22: więcej piractwa; wcześniej ≤ 15%);
- żaden surowiec, którego stacja chce, nie stoi na 0% dłużej niż 30 min gry;
- żadna stocznia nie stoi bez podzespołów dłużej niż 30 min;
- średnia kolejka na redzie ≤ 2 w każdym porcie;
- tick ≤ 25 ms przy szczycie kursów.

Zmiana gospodarki, która nie przechodzi bramki, nie wchodzi do main, chyba że użytkownik zdecyduje inaczej.

## 6. Zasady dla sesji

- **Worktree.** Każda sesja pracuje we własnym worktree i commituje na swoją gałąź. NIE scala do main i NIE pushuje; scala orkiestrator po przeglądzie.
- **Plan czytaj z głównego drzewa:** `C:\Users\Szymon\Documents\GitHub\statki\docs\PLAN-ekonomia-rynki.md`, bo w worktree go nie ma. Nie edytuj go: zmiany i wnioski idą do raportu.
- **node_modules.** Gdy w worktree ich brak, zrób junction do `C:\Users\Szymon\Documents\GitHub\statki\node_modules`. Przed usunięciem worktree usuń sam junction (Delete na linku), bo inaczej kasowanie pójdzie w prawdziwy katalog.
- **Testy.** Zanim cokolwiek zmienisz, zrób bazę w SWOIM worktree: `npm test` i `node --test "tests/*.test.mjs"`. Świeży worktree ma końce linii CRLF, przez co ok. 9 strażników opartych na regexach pada fałszywie. Raportuj różnicę względem bazy.
- **Symulacja.**
  - Przed zmianą zrób bazę: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60`.
  - Zmiany zachowania porównuj na co najmniej 3 ziarnach (7, 11, 23): po pierwszej innej decyzji pojedynczy przebieg rozjeżdża się chaotycznie.
  - Refaktor bez zmiany zachowania musi dać wynik identyczny liczba w liczbę.
- **Determinizm.** Losowość symulacji tylko z `rng` świata, bez `Math.random`. Nowe id bez liczników na poziomie modułu.
- **AGENTS.md obowiązuje:** szew gra ↔ render, rozgrzewka pipeline'ów, haki przekrojowe, wizualia przez `fxRandom`. Zrzuty i pomiary zapisuj tylko do `.tmp/` albo scratchpada.
- **Gameplay testuje użytkownik.** Sesja robi testy, build (`npm run build`; jeśli pada na `AISPACE.html`, użyj tymczasowego configu ze scratchpada z `input: ['index.html']`), pomiary i zrzuty narzędziami `scripts/webgpu/*-gra.mjs`.
- **Cudze pliki** z tabeli § 4 ruszaj tylko minimalnie i opisz to w raporcie. Gdy praca wymaga większej zmiany w cudzym obszarze, najpierw napisz do orkiestratora.
- **Raport końcowy** (do 400 słów):
  - nazwa gałęzi i commity;
  - co się zmieniło (pliki);
  - testy w liczbach względem bazy;
  - symulacja przed i po;
  - decyzje dla użytkownika;
  - ryzyka i to, czego nie zrobiono.

## 7. Otwarte (decyduje użytkownik, sesje zgłaszają propozycje)

- prędkości gracza po zwolnieniu i vmax hipercruise (E5 proponuje liczby z uzasadnieniem);
- czy hipercruise da się przerwać (propozycja: tak, warpu nie);
- lista wieżyczek jako towarów: rodzaje i liczba pozycji (E8 proponuje);
- rodzaje silników i ich receptury (E8);
- domyślne silniki hipercruise gracza i frachtowców ruchu (E5);
- progi bramki bilansu (§ 5);
- wygląd wyrw i ewentualna regeneracja pasa (domyślnie brak);
- statki ruchu widoczne w grze między falą 2 a 3 (§ 3.2);
- zapis stanu ekonomii i wyrw (E7).

## 8. Stan

- 2026-10-21: plan spisany, ruszyła fala 1 (E1, E3, E4, E5). Tego samego dnia użytkownik dołożył E8 (receptury: wieżyczki, silniki, silniki hipercruise 20–40 tys. j./s); receptury zdjęte z E4.
- 2026-10-21 E4: bramka bilansu gotowa — `scripts/bramka-bilansu.mjs` (commit cf5b56e3 na gałęzi `claude/e4-ekonomia-bilans-c1e481`). Użycie: `node scripts/bramka-bilansu.mjs [--etykieta X] [--ziarna 7,11,23] [--minuty 240] [--rownolegle]`; wynik w `.tmp/bramka-bilansu/`, kod 1 przy niezaliczeniu. Progi jak w § 5, przy czym „stocznia bez podzespołów” mierzy się jako stocznia z pustą pochylnią, a głód jako < 1% magazynu. Rozesłana do E3, E5 i E8 jako kopia bez commita.
- 2026-10-22 (noc): wszystkie gałęzie fali 1 wyszły z `origin/main` (9d0e61fd), który jest 55 commitów za lokalnym `main`. Sesje E3, E4 i E5 dostały polecenie, żeby przed raportem końcowym zrobić u siebie `git merge main`.
- 2026-10-22 E1 scalone do main (641f8dc7):
  - `src/data/markets.js` (`MARKET_DEFS`), `src/game/traffic/markets.js` (`addMarket` / `removeMarket` / `setMarketOwner` / `addMarketBuilding`);
  - wiadomości workera `market-*` i API mostu;
  - stacje misyjne piratów pod `?trafficV2` jako rynki.
  - Sprawdzone po scaleniu: `npm test` 1719 asercji zielone, symulacja na ziarnie 7 identyczna z bazą liczba w liczbę, `node --test` bez nowych porażek (2 testy padają tylko pod obciążeniem, osobno przechodzą).
  - Uwagi E1: rynek dodany w trakcie gry nie ma własnych przewoźników (obsługują go puste przeloty); śmierć stacji znanej mostowi zgłasza `stationDestroyed`; notatka API dla E2, E6 i E7 to `E1-rynek-API.md` w notatkach sesji.
- 2026-10-22 E8 scalone do main (34e758f1). Konflikt w `weaponEconomy.js` rozwiązany: blokada `npcOnly` z main plus `weaponGood` z E8.
  - Treść: 3 rafinaty (nadstop niklu, kompozyt węglowy, katalizator platynowy), 8 rodzin luf (rozmiar = liczba sztuk), silniki `drive_light`, `drive_heavy` i `hypercruise_mk1..3`, nowe składy okrętów.
  - Po scaleniu: `npm test` 1759 zielone; symulacja na ziarnie 7: 10 862 dostaw, przechwycone 35%, 567 okrętów (tyle samo co w raporcie E8, więc E1 nie zmienia zachowania), tick 33,6 ms.
  - Tick (+40%) to koszt O(n²) `nextShipmentOrderId` w `cargoFleet.js`; poprawka zlecona E4.
  - Odkrycie E8: podzespoły okrętowe w ruchu v2 w ogóle nie jeżdżą między stacjami (0 zleceń, także w bazie), więc silniki powstają w stoczniach.
  - Do akceptacji użytkownika: tabele towarów i składy okrętów (raport E8, `E8-receptury.md`).
- 2026-10-22 E5 scalone do main (6b816997): `src/data/driveModes.js`, `src/game/flight/hypercruise.js`.
  - Gracz: PRZELOT do 1200 j./s, dopalacz 1000 / 1800 j./s, hipercruise do 20 tys. j./s w 16 s (Atlas), TRAVEL TO na 30 tys. j. w 12,8 s, Luna w 46 s, blokada masy zatrzymuje statek w 2,8 s.
  - Ruch v2: szczyt kursów w powietrzu spada z 6285 do 1826, a dostaw jest dwa razy więcej.
  - Pomiary: `docs/POMIAR-napedy-E5-2026-10-21.md`. Liczby prędkości czekają na akceptację użytkownika.
- 2026-10-22 E3 scalone do main (9885ed90): `src/game/traffic/miningFields.js`, rejestr uszczuplenia, wyrwy przez `beltWorld`.
  - 96% wypraw kończy się w polach ze skałami (wcześniej 21–25%).
  - Opis: `docs/E3-pas-w-ekonomii.md`. Pokrętła są w `MINING_FIELDS_CONFIG`.
  - Wygląd wyrw czeka na ocenę użytkownika.
- 2026-10-22 E4 scalone do main (3d8a3dde): `scripts/bramka-bilansu.mjs`, cena rezerwacji producenta, kupcy zaopatrujący stocznie, piractwo, `nextShipmentOrderId` bez O(n²).
- **Wynik fali 1 na całości** (bramka `fala1-main`, ziarna 7 / 11 / 23, wobec bazy z § 2):
  - przechwyty: 5,8–5,9% kursów z ładunkiem (baza ~40%) — zaliczone;
  - stocznie: najdłuższy postój 0 min (baza: 5 stoczni stało 240 min) — zaliczone;
  - tick: 22–24 ms przy szczycie ~1400 kursów — zaliczone;
  - głód: 3–6 pozycji ponad 30 min, najdłużej ok. 40 min (Westa: nadstop niklu i `hypercruise_mk1`; Uran, Westa i Merkury: jeden z napędów) — niezaliczone;
  - kolejka na redzie: Saturn i Uran 5,2–7,7 (porty bez ringu) — niezaliczone;
  - dostawy ok. 20 tys. (baza 8,2 tys.), zwodowane 867–913 okrętów.
- Testy na całości:
  - `npm test`: 1 błąd. `materializedFlight` („bez wymuszonych przechwytów”) to UKRYTY BŁĄD BAŃKI, który ujawnił inny przebieg ruchu po E3 + E5 (osobno obie gałęzie są zielone). Prom na `luna:dok2:b1` stoi w pozie (odchyłka 0 / 0,7 j., kąt 0), ale kręci się w miejscu (`angVel` 0,161 > 0,07), bo goni punkt stanowiska bliższy niż 1 j. Strażnik wymusza przechwyt po 25 s. Bańki nie ma w grze, więc to pierwszy punkt E6.
  - `node --test`: 3100 testów, 1 porażka (`cicBeltLayer`, tylko pod obciążeniem; osobno przechodzi).
  - `npm run build`: przechodzi.
- Na jutro:
  - E4: końcowe strojenie (głód nowych towarów E8 w dalekich stoczniach, kolejki Saturna i Urana, saldo `thruster`);
  - decyzje użytkownika: tabele E8, prędkości E5, wygląd wyrw E3, progi bramki;
  - fala 2 (E2);
  - reguła ruchu v2 w `.claude/rules/` z wierszem w indeksie `AGENTS.md` (propozycja E1);
  - poza falą: 1 pipeline kompilowany synchronicznie w skoku warpa przez pas (`AsteroidBelt:rocksSmear`, z main sprzed fali 1) — brak rozgrzewki w obszarze pasa.
- 2026-10-22: użytkownik zlecił strojenie E4 i falę 2 na obecnych liczbach. Decyzje (prędkości, receptury, wyrwy, progi bramki, przerwa w widocznym ruchu § 3.2) poda w trakcie, a wtedy przestroimy.
  - E4: końcowe strojenie na `main` — skup stoczni, kupcy, kolejki Saturna i Urana, saldo `thruster`. Bez `cargoFleet.js` i bez planisty.
  - E2 ruszyło z worktree wyciętego z lokalnego `main`.
  - Wspólne API rynku dla wszystkich wydzielone jako E2b. Rusza po E2 i po strojeniu E4, żeby zmiany w kupcach i stoczniach się nie nakładały.
- 2026-10-22: decyzje użytkownika (§ 1, punkty 8–13) rozesłane:
  - E5: bojowy ok. 500 (nieokrągły), dopalacz 1000–1200, PRZELOT usunięty, warp Mk1–3 (100–250 tys.);
  - E8: towary `warp_mk1..3`;
  - E3: mgła i pył rzedną w wyrwach;
  - E4: piractwo w paśmie 12–20%;
  - E2: bez widoku vanów.
  - Ruszyły nowe sesje E9 (hipercruise a kolizje), E10 (receptury realistyczne) i E11 (gazy i mgły). Wszystkie z worktree wyciętego z lokalnego `main`.
- 2026-10-22 fala 2 scalona do `main` (78886901): E2, E5, E8, E4, E3, E9, E10, E11 i poprawka przeszkód gazu wybuchów w workerze.
  - Konflikty rozwiązane przy scalaniu: komentarz w `driveModes.js` (E2 / E5), sufity szwu renderu (E2 + E11: `index:aktualizacja` 114) i podwójny import `gasObst` w workerze.
  - Testy na całości:
    - `npm test` 1693 asercje zielone (znany błąd bańki tym razem się nie ujawnił, nadal jest ukryty);
    - `node --test` bez nowych porażek;
    - build przechodzi;
    - start gry w workerze: 0 pipeline'ów sync;
    - scena gazu w trybie gracza: gaz się rysuje, 0 pipeline'ów sync.
  - Bramka (`fala2-main`):
    - zaliczone: przechwyty 15,5–16,3%, głód ≤ 15 min, stocznie 0 min;
    - niezaliczone: kolejki (Ceres 3,2–3,3, Oberon 2,7) i tick 25–27 ms (mierzony pod obciążeniem).
- 2026-10-22: sesje nie pytają użytkownika — pytania idą do orkiestratora, a decyzje użytkownika zbierane są w jedną listę.
- 2026-10-22 użytkownik przyjął wszystkie rekomendacje orkiestratora:
  - prędkości E5: Atlas 507, dopalacz 1137, warp Atlasa Mk II, krótkie TRAVEL TO według propozycji;
  - hipercruise w strefie planety ×0,6;
  - gaz pasa: siarka −30% jasności, gaz zastępuje stare płaty mgły w pasie, etap GK-5b;
  - receptury E10 w wariancie grywalnym, krokami przez bramkę: Księżyc jako kopalnia, uran tylko z Kuipera przy połowie popytu, reaktor D–He-3, tarcze jako towar, azot z Tytana;
  - fregata z warpem Mk I;
  - bańka E6 rusza;
  - E2b w sesji E2.
- 2026-10-22 decyzja: hipercruise dostaje OBECNY efekt warpa (struga WARP, smugi, kamera). Nowe efekty warpa robi użytkownik, więc wyglądu warpa nie ruszamy.
- Zadania po tych decyzjach:
  - E4: kolejki i tick;
  - E5: Księżyc ×0,6 i efekt hipercruise;
  - E9: bezpieczniki hipercruise (płyta ringu, olbrzym);
  - E10: wdrożenie wariantu grywalnego razem z warpem fregaty i składem warpa;
  - E11: GK-5b, siarka, jedna mgła;
  - E2: E2b;
  - E6: bańka — najpierw prom przy Księżycu.
- 2026-10-22 do `main` (facd99cc) weszły:
  - E9: bezpieczniki hipercruise — przebicia płyty Ziemi spadły z 17–42% do 0%;
  - E11 GK-5b: olbrzymy jako przeszkody gazu, wybuchy i pociski jako źródła gazu, jedna mgła w pasie, siarka −30%, gaz rzednie w wyrwach.
  - Testy: `npm test` 1693 zielone, `node --test` bez nowych porażek, build przechodzi, start w workerze 0 pipeline'ów sync.
- 2026-10-22 E6 (sesja uruchomiona przez użytkownika):
  - krok 0: prom przy Księżycu naprawiony (`e71377f5`); poprawka kursu wygasa na ostatnich j., 312 podejść, 0 wymuszeń;
  - krok 1, zatwierdzony przez orkiestratora: lot bańki liczy worker ruchu, gra dostaje bufor aktorów i sama liczy trafienia, taran i rejestr stanowisk (`destroyed`, `berth-hold`), proxy rysuje worker renderu; tylko przy Ziemi.
- 2026-10-22 E5 w `main` (46299757): hipercruise ma OBECNY efekt warpa (plazma WARP, bańka i ośrodek „Nurtu”, smugi, kop kamery) i leci ×0,6 przy planetach.
  - Luna trwa 75 s; resztę czasu zabiera warp i końcowy dolot.
  - Przy scalaniu jeden konflikt w regule `statek-gracza`: opis efektu (E5) połączony z bezpiecznikami (E9).
  - Testy zielone, build przechodzi, w grze 0 pipeline'ów sync (`scripts/webgpu/hipercruise-efekt-gra.mjs`).
- 2026-10-22 E10: wszystkie 6 kroków receptur zacommitowane, bramki kroków biegną. Czysty pomiar ticku zrobi E4 na końcu, na scalonym `main`, w oknie ciszy.
- 2026-10-22 E4 w `main` (3d19d01a):
  - kolejki zaliczone: 1,75–1,96 (`MARKET_DOCK_OVERRIDES`: Ceres ×5, Oberon ×2);
  - pamięć `stationWantsResource`: symulacja identyczna, tick −30% pod tym samym obciążeniem.
  - Następne gorące miejsce, `findTradeOpportunities` (24% ticku), przekazane E2 do E2b jako indeks per surowiec bez zmiany wyniku.
  - Tick (50–68 ms pod obciążeniem innych sesji) zmierzymy w jednym oknie ciszy po E2b, E6 i E10.
- 2026-10-22 E10, krok 3: głód uranu na Saturnie spadł z 14,4 do 8,7 min, kolejka Ceres wróciła do poziomu bazy.
- 2026-10-22 E10 w `main` (4f42a2aa): wariant grywalny receptur.
  - Towary 55 → 63, receptur 46. Nowe: materiał wybuchowy, ruda glinu i glin, ceramika pancerna, ruda ziem rzadkich (Luna ~90%), taśma nadprzewodząca, emiter tarczy (okręty 1 / 3 / 6 / 9), azot (Tytan, Tryton).
  - Reaktor: 2 taśmy + 1 pręt.
  - Warp Mk I / II / III: 870 / 4000 / 7000 CR. Fregata ma warp Mk I.
  - Koszt na punkt siły: 6104 / 6424 / 7276 / 9105 CR.
  - Bramka po scaleniu: przechwyty 15,0–15,7%, głód maks. 6,8 min, kolejki ≤ 1,47, stocznie 0 min, zwodowane 785–881. Tick czeka na okno ciszy.
  - Bilans analityczny:

    | surowiec | przed | po |
    |---|---|---|
    | uran (na cykl) | 2,40 | 1,15 |
    | krzem | 130% | 191% |
    | nikiel (najciaśniejsza nowa ruda) | 131% | 111% |

  - Testy: `npm test` 1699 zielone, build przechodzi.
- 2026-10-22 do `main` (283129a0) weszły E2b i E4.
  - E2b — wspólne API rynku:
    - `marketBook.js`, `marketStock.js`, `director.book`: oferty i rezerwacje dla przewoźników, kupców, gracza, stoczni, wojny, złomiarzy i pasera;
    - indeks okazji handlowych per surowiec;
    - domyślny model `surplus`; wariant `reservation` za przełącznikiem, bo nie zalicza bramki (Wenus: kolejka 348–2059, głód rudy 42–71 min); opis A/B w `docs/E2b-api-rynku.md`.
  - E4 — garnizon K-7: patrole i floty frakcji mają postój i tankowanie w K-7.
  - Przy scalaniu dwa proste konflikty (`trafficWorld.js`, `warDispatcher.js`).
  - Bramka na całości (`e2b-e4`, ziarna 7 / 11 / 23):

    | próg | wynik | ocena |
    |---|---|---|
    | przechwyty | 15,0–15,7% | zaliczone |
    | głód | ≤ 6,8 min | zaliczone |
    | stocznie | 0 min | zaliczone |
    | kolejki | ≤ 1,47 | zaliczone |
    | tick | 24,3 / 24,8 / 29,2 ms | dwa ziarna zaliczone; ostatnie do okna ciszy |

  - Testy: `npm test` 1734 zielone, build przechodzi.
- 2026-10-22 E6 (`claude/frosty-moser-69ca47`):
  - płynne pozy przy 240 Hz: ekstrapolacja drugiego rzędu, p99 skoku 0,19 j.;
  - napęd z tabeli napędów;
  - zapas floty jako encje STOCK na padach K-7;
  - `berth-hold` gracza.
  - Czeka na `git merge main` po swojej stronie; scalenie po nim.
- 2026-10-22 E6 w `main` (9d9db47a): bańka przy Ziemi.
  - Harness w trybie gracza: 49 statków ruchu, 26 dokowań (24 w zatokach i 2 okręty garnizonu w K-7) obok 6 okrętów zapasu na padach.
  - Trafienie i taran niszczą cel, a worker oddaje wrak.
  - Gracz trzyma swoje stanowisko, ruch na nie nie wchodzi.
  - 0 błędów, 0 pipeline'ów sync. `npm test` 1749 zielone, build przechodzi.
  - Opis: `docs/E6-banka-w-grze.md`.
  - Decyzja orkiestratora: zestrzelony okręt garnizonu to strata z zapasu frakcji (księgowanie robi E4). Okręty zapasu (STOCK) zostają nietykalne jako widok zapasu.
- 2026-10-22 E4 w `main` (06f4d10a): BRAMKA ZALICZONA w całości na 3 ziarnach.

  | próg | wynik |
  |---|---|
  | przechwyty | 15,2–15,4% |
  | głód | 0 pozycji > 30 min, najdłużej 6,3 min |
  | stocznie | 0 min |
  | kolejki | 0,79–1,87 |
  | tick | 11,5–12,3 ms |

  - Tick spadł z 26,4 / 24,8 do 9,9 / 10,1 ms dzięki indeksom: zlecenia po id, manifest wraku per klasa, niedobory tylko po chcianych towarach. Wynik symulacji jest identyczny liczba w liczbę.
  - Zestrzelony okręt garnizonu zdejmuje okręt z zapasu frakcji i zostawia wrak.
  - Testy: `npm test` 1755 zielone.
- Dalej:
  - ~~E4: okno ciszy (tick ≤ 25 ms) i końcowe strojenie~~ — zrobione;
  - bańka dla pozostałych portów i awans do pełnego NPC (do zlecenia);
  - E7: gracz na rynku i zapis ekonomii.
- 2026-10-22 E6: hale K-7 Ziemi nie dostawały statków ruchu, bo nic wojskowego nie cumuje w porcie. Decyzja orkiestratora, zgodna z „K-7 = port wojskowy”: patrole i floty frakcji mają postój i tankowanie w K-7 portu domowego (zadanie E4). E6 może dodatkowo pokazać zapas okrętów stojący na padach K-7 (`placeFleetStock`).
