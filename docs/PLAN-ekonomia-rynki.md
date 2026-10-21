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
| E2 | Jedna ekonomia: API rynku (oferty, rezerwacje), `planShipment` i stan zleceń przeniesione do ruchu v2, usunięcie starej ekonomii i flagi | 2 | E1, E4 | `trafficDirector.js`, `cargoFleet.js` i `transitController.js` (do usunięcia), `infrastructureUI.js`, `index.html` (stara ekonomia, gałęzie `trafficV2`) |
| E6 | Bańka w grze (Z13 zwężone, § 3.5) | 3 | E1, E2, E5 | nowy `src/game/trafficBubble.js`, `materializedFlight.js`, `shipProxyBatch3D.js` + `src/render/`, `haloPortDocking.js`, `index.html` |
| E7 | Gracz na rynku: terminal na ofertach, komputer handlowy, stacja gracza jako rynek, zapis stanu ekonomii i wyrw | 4 | E2 | `src/ui/`, `index.html`, zapis gry |

Fala 1 (E1, E3, E4, E5, E8) rusza równolegle, każda sesja we własnym worktree. Pliki wspólne (`trafficWorld.js`, `travelNetwork.js`, `trafficProtocol.js`, `trafficBridge.js`, `agentFleets.js`, `trafficDirector.js`) dzielimy po FUNKCJACH, jak w tabeli. Konflikty przy scalaniu rozwiązuje orkiestrator.

Kolejność scalania: E1 → E5 → E8 → E3 → E4. E4 kończy strojenie bilansu na prędkościach z E5 i recepturach z E8.

## 5. Bramka bilansu

Bramkę buduje E4, używają jej wszyscy. Skrypt w `scripts/` puszcza symulację na 3 ziarnach (7, 11, 23; 240 min, presja 1, magazyny ×4, skala ×60) i sprawdza progi. Wynik zapisuje w JSON do `.tmp/`, a przy niezaliczeniu kończy się kodem wyjścia ≠ 0.

Progi startowe to propozycja: E4 je stroi, użytkownik akceptuje.
- przechwycone ≤ 15% rozstrzygniętych kursów przy presji ×1;
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
