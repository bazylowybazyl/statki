# E24 — górnicy i złomiarze NPC w bańce gracza (2026-11-08)

Zadanie od orkiestratora ekonomii: górnicy i złomiarze NPC w bańce mają być widać w pracy, a złomiarze mają sprzątać
wraki, które widać w grze. Stan i zasady — reguła `ruch-banka`, § „Praca w bańce: górnicy i złomiarze (E24)”; wraki —
reguła `wraki`. Tu rozpoznanie, decyzje i pomiary.

## Rozpoznanie (przed kodem)

- Postój górnika przy polu (etap `EXTRACT` wyprawy `MINE`, punkt z `planExpedition`) i złomiarza przy wraku (`SERVICE`
  kursu `TUG`, pozycja wraku z rejestru) trafiał do bańki przez `planDwell` (`materializedFlight.js`): encja leciała do
  punktu i stała w fazie `station`. Bufor `actors` nie niósł rodzaju kursu ani powodu postoju — gra widziała tylko „stoi”.
- Pomiar (`SEED=7`, ×60, 2 h, kąty domyślne świata, skrypt jednorazowy w `.tmp/zlom/rekon.mjs`): 59 wypraw MINE, żadna
  ≤ 100 tys. j. od portu, 9 w 124–147 tys. (Ceres, Fobos); bańka żyła tylko ≤ 180 tys. od portu albo w studni planety, więc
  większości górników nie dało się zobaczyć nigdy. TUG: 48 kursów, wszystkie ≤ 2 tys. j. od węzła portu — wraki bitew
  kampanii (`emitWrecks`) leżą przy węźle stacji celu ±2000 j., przy ringach to środek planety (złomiarz staje w lejku).
- Złomiarze brali tylko `war.wrecks` (bitwy kampanii, kampanie rozbite w drodze, straty garnizonu z gry); `director.wrecks`
  (zestrzelone frachtowce) to dziennik ładunku. `assessWreck`: hol wygrywa zawsze z cięciem.
- Wraki gry: hak `HullBodies.onWreckSpawned` widzi każdy nowy (śmierć statku i odłamy), usuwanie `removeWreckFromWorld`,
  cięcie gracza `cutOuterNode`, hol gracza `TowSystem` (lina rysuje się sama na kanwie 2D).

## Decyzje (wariant domyślny wysłany orkiestratorowi)

1. Protokół: `actors.works` / `unworked` (tylko zmiany), `wreck-report` / `wreck-gone` (gra → worker), `salvage-taken`
   (worker → gra) — `SALVAGE_MSG` na końcu `trafficProtocol.js`.
2. Bańka żyje także przy miejscach pracy (`WORK_SITE_RANGE` 120 tys. j.). Bez gracza symulacja identyczna.
3. Wrak gry → wpis na początku `war.wrecks` z manifestem z ułamka kadłuba; odłam i cywil — sam złom (cięcie, gdy się
   opłaca); okręt garnizonu wiąże się ze stratą zapasu (bez drugiego wraku); rezerwa 2 holowników stacji tylko dla wraków
   gry; gracz zabrał wrak — złomiarz wraca pusty.
4. Obraz: górnik — `MiningView` pasa (te same partie dronów i wiązek), złomiarz — palniki, iskry, odłamki, wiązka przy
   linie (`trafficWork3D.js`).
5. Wraki wojen w tle — bez obrazu; propozycja na później: zimny wrak z szablonu klasy przy wejściu w bańkę.

## Pomiary

- Symulacja `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po kroku 1 — identyczna (poza czasem ticku).

## W grze (`node scripts/webgpu/zlomiarze-gra.mjs`, tryb worker, 1600 × 900, ziarno ruchu 7)

- GÓRNIK: po 1 h świata nie było żadnej wyprawy w etapie wydobycia; po przewinięciu ~2 h — 57, wszystkie w Pasie Kuipera.
  Gracz 2,9 km od wyprawy: bańka żyje przy miejscu pracy, 6 encji w fazie `station` z rekordami pracy, drony nad
  skałami pola i lasery z iskrami. Kadłuby przy 130 AU są prawie czarne (słońce pasa) — widać światła nawigacyjne
  i lasery.
- CIĘCIE (wrak frachtowca `long_haul_freighter`, 262 węzły, 6 km od gracza przy Ziemi): zgłoszenie po 2 s, złomiarz
  (`salvage_hauler`) z portu po 48 s, palniki z dziobu do brzegu wraku, wrak maleje od krawędzi (260 węzłów w 120 s
  postoju — przy `--postoj 120`), po końcu pracy reszta znika. Dziennik: `zgloszony → koniec-pracy:cut → usuniety:cut`.
- HOL (wrak niszczyciela wezwania, 99 węzłów): lina przy dolocie, zaczepianie 120 s z wiązką, odlot — wrak jedzie z
  holownikiem (0 → 1200 j./s, wrak 1200 j./s), holownik kończy kurs na lejku ringu Ziemi ~5 km dalej i znika razem
  z wrakiem. Dziennik: `zgloszony → lina → koniec-pracy:tow → usuniety:towed`. Bez sprężyny odlotu sama lina
  zostawiała wrak kilka km z tyłu (pierwszy przebieg — lina rozciągnięta na całym kadrze).
- Pipeline'y synchroniczne: worker 0 / 0, strona 0 / 0 (start i koniec każdego przebiegu); błędy strony i workera: 0.
- Koszt klatki z obrazem pracy i bez (`TrafficSalvage.hideRender`, przebiegi na zmianę, 12 próbek): przy cięciu GPU
  0,299 / 0,287 ms wobec 0,293 / 0,279 ms, CPU klatki workera 1,77 / 1,74 ms wobec 1,55 / 1,89 ms; przy holu CPU
  1,81–2,69 wobec 2,14–2,39 ms — różnica w szumie pomiaru (jeden rysunek wiązek, kilka iskier na klatkę). Górnicy
  w Pasie Kuipera (4 rekordy w ramce, 24 próbki): GPU 1,22 / 0,78 ms wobec 0,73 / 0,74 ms (pierwsza próbka
  z wyskokiem), CPU klatki workera 2,49 / 2,60 wobec 2,41 / 2,46 ms — ~+0,1 ms CPU i ~+0,04 ms GPU (drony i lasery
  w partiach pasa, światła siatki najwyżej 6 + 6).
- Odłamy: w pierwszych przebiegach odłamy z cięcia zgłaszały się jako nowe wraki (encja rodzica w haku to jeszcze
  martwy statek) — wiązanie po ciele (`parentBody`). Pozostałe dodatkowe zgłoszenia w przebiegach przy Ziemi to wraki
  frachtowców zestrzelonych przez automatyczne baterie Atlasa w harnessie (rozpad frachtowca kapitałowego na ~20
  odłamów); próg drobnicy 120 j. odcina odłamy, których cięcie się nie opłaca (od 2026-11-09 tylko odłamy — cały kadłub, także fregata
  o promieniu wraku ~93 j., zgłasza się zawsze; wcześniej wrak fregaty przepadał).
- Narzędzie `snapshot.work` w pierwszej wersji ucinało listę na 80 kursach — przy ~63 górnikach kurs złomiarza po
  wrak gry był poza listą (przebieg „final”: „brak kursu złomiarza”); limit 600.

## Dopiski orkiestratora (2026-11-08, wieczór)

- Gracz ma pierwszeństwo: złomiarz nie leci po wrak gry wcześniej niż 300 s po zgłoszeniu (`gameWreckDelay`); wrak, przy
  którym gracz pracuje (tnie, holuje, zbiera łup), idzie jako `wreck-hold` — złomiarze czekają, holownik w drodze wraca
  pusty, wrak zostaje w rejestrze. Okręty fabuły (`__storyTag`, `__storyKey`, flagowy, wieże) i strażnicy misji
  najemniczej — bez zgłoszeń. Hak `onWreckSpawned` — własne opakowanie w bloku E24.
- Po scaleniu main (W5–W6): bramka 7 / 11 / 23 zaliczona z liczbami main (przechwyty 14,5 / 14,5 / 14,1%, kolejka
  1,48 / 1,42 / 1,85); harness cięcia i holu z pierwszeństwem skróconym do 20 s (`--opoznienie`) — lina 19 s po
  zgłoszeniu, odlot z wrakiem, 0 pipeline'ów synchronicznych, 0 błędów.

## Scena „holowanie” (2026-11-09, prośba orkiestratora: użytkownik nigdy nie widział holowania)

- Adres: `http://localhost:5173/?dev&scena=holowanie` (gra swobodna; scena rusza sekundę po wejściu do gry i rozstawia
  się po rozgrzewce świata ruchu), prędkość holu `&hol=1200` (dzisiejsza, domyślna) albo `&hol=wolny`. Konsola:
  `DevScene.holowanie({ angle })`, `holowanieStop()`, `holowanieKadr()`; stan `window.TowScene` (faza, kolejka, dziennik).
- Plac 70,5 tys. j. od Ziemi w kierunku, w którym żaden inny port nie leży bliżej niż 150 tys. j. (złomiarz leci z portu
  Ziemi; przy ziarnie 7 — poziomo, na zachód), wraki w linii wzdłuż kierunku holu, Atlas 7,2 km dalej od Ziemi na tej
  samej linii, dziobem do placu. Kamera floty: lejek ringu, plac i Atlas w ~60% wysokości ekranu, nad kokpitem.
- Wraki ścieżką gry: niszczyciel, fregata, frachtowiec `freighter-large` — pula HP (`applyDamageToNPC` →
  `convertToWreck`, wybuch zbiornika); pancernik piratów — stopienie rdzenia `ReactorGame.forceMeltdown(…, 1,2 s,
  'thirds')`: trzy części (184, 214, 201 j.), wszystkie do cięcia (ułamek kadłuba < 0,6).
- Punkt zrzutu: holownik kończy kurs na lejku ringu (`funnelR` w `ringRouter.js` — ~64,5 tys. j. od środka Ziemi,
  zmierzone: holownik znika 64,4–64,5 tys. j. od Ziemi) i znika razem z wrakiem na linie (`usuniety:towed`) —
  ~5 km od placu, w kadrze. Wyjście z bańki byłoby poza kadrem (bańka portu sięga 180 tys. j.).
- Kolej (dziennik sceny, oba przebiegi): niszczyciel puszczony po 5,3 s, lina po 14,7 s, odłam po 20,7 s, palniki po
  32,6 s, fregata po 38,7 s, lina po 44,7 s, frachtowiec po 50,7 s, palniki po 61 s, reszta (2 odłamy) po 67 s.
- Prędkość holu (`holowanie-gra.mjs`, próbki co 0,5 s gry): `hol=1200` — holownik obraca się o 180° w ~3,5 s, potem
  do 1200 j./s, wrak 1207 j./s (sprężyna `towFollow`), wrak cały czas za holownikiem (kąt π), zrzut 8,5 s po początku
  holu; `hol=wolny` — najwyżej 409 j./s (900 / 2,2), wrak 410 j./s, zrzut po 16 s. Pipeline'y synchroniczne: worker
  0 / 0, strona 0 / 0; błędy strony i workera: 0; tarcza Atlasa 18 000 przed i po (wybuchy go nie sięgają).
- Próby z placem 68 i 64 tys. j. pokazały, że lejek leży PRZY placu (hol trwał 1–2 km); plac przesunięty na
  70,5 tys. j. Wraki w dwóch rzędach w poprzek holu dawały kadr za wysoki na ekran 32:9 (niszczyciel ~30 px przy
  720 px wysokości) — linia wzdłuż holu podnosi zoom ~1,5×.
