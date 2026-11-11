# Audyt zasięgów czujników jednostek (2026-11-11)

Zadanie użytkownika: „każda jednostka musi mieć zasięgi zrobione”, w obie strony, sprawdzone w prawdziwej grze. Reguła obszaru: `.claude/rules/zasieg-czujnikow.md`. Plan zasięgów: `docs/PLAN-zasieg-czujnikow.md`.

## Model w skrócie

- **KONTAKT**: zasięg wykrycia = moc czujników obserwatora × sygnatura celu × osłona przy celu (`src/game/sensorDetection.js`).
  - Moc: `SHIP_SENSOR_PROFILES.passiveRange`. Byt z własnym `sensors` / `sensorProfile` bierze go wprost, byt bez profilu przez `resolveAwarenessSensorRange` (`src/ai/fleetAwareness.js`).
  - Sygnatura: `getEntitySizeModifier` (`src/game/sensorSystem.js`).
- **IDENTYFIKACJA**: wzrok `visionRangeOf` (`src/game/fogOfWar.js`), czyli klasa `shipRangeClassOf` → `SHIP_RANGE_PROFILES.visionRange`. Jawne `visionRange`, rola radaru i myśliwiec mają pierwszeństwo.
- **Gałęzie awaryjne przed audytem**:
  - moc: profil zgadnięty z typu (domyślnie `frigate_combat`, 18 km);
  - sygnatura: kubełki promienia (≥ 100 → 1,0; 40–99 → 0,7; 20–39 → 0,85; < 20 → 0,5 — kubełki są odwrócone, patrz D6);
  - wzrok: byt bez klasy dostaje wzrok fregaty (5 km).

## Co zmieniono

Uzupełnienia są w danych, nie w ścieżkach kodu. Wartości są dzisiejsze, więc rozgrywka się nie zmienia.

- `src/data/sensorUnits.js` — jawne profile i wykrywalność jednostek bez profilu:
  - `SENSOR_PROFILE_BY_UNIT` — klucz to typ, potem kadłub. Profil to klucz `SHIP_SENSOR_PROFILES`.
  - `SENSOR_SIGNATURE_BY_UNIT` — liczba ze stanu ustalonego kubełków promienia.
  - `SIGNATURE_PENDING_DECISION` — jedyny wyjątek, patrz D1.
- `src/data/shipRanges.js` — kadłuby cywilne ruchu v2 dostały klasę `frigate`. Wzrok zostaje 5 km, mnożnik broni 1.
- `fleetAwareness.fallbackSensorProfile` i `getEntitySizeModifier` czytają tabele jednostek przed zgadywaniem. Zgadywanie zostaje tylko jako ostatnia deska; żadna jednostka gry już w nie nie trafia.
- Obraz czujników: wzrok stacji `SENSOR_PICTURE_TUNE.stationVision` = 30 km, tyle co źródło wzroku stacji w mgle. Wcześniej obraz pytał `visionRangeOf(stacja)` i dostawał 5 km. Moc aktywna jednostek bez `sensors` pochodzi z profilu jednostki (prototyp `?radarZasiegi`).
- Strażnik: `tests/zasiegiJednostek.test.mjs`.
  - Kadłuby `SHIPS`, szablony wezwań, kadłuby ruchu v2 i kształty bytów ze wszystkich miejsc tworzenia mają jawną moc, sygnaturę i wzrok.
  - Moc z tabeli = dawny profil awaryjny z typu, słowo w słowo.
  - Wzrok cywili = 5 km.

## Tabela jednostek

„Źródło” to skąd liczba pochodzi PO audycie. „Przed” mówi, czy wcześniej szła gałęzią awaryjną. Moc i wzrok w j. świata.

| Jednostka (miejsce tworzenia) | Czujniki (moc pasywna) | Sygnatura | Wzrok | Źródło wartości | Przed |
|---|---|---|---|---|---|
| Atlas gracza (`createShipEntity`) | 80 000 (`atlas_combat`) | 1,3 (`isCapitalShip` zawsze, także w kadłubie fregaty — D4) | 18 000 (supercapital) | `SHIPS.atlas.sensors`, klasa kadłuba | jawne |
| Gracz w innym kadłubie (Corvus, Custos, Hasta…) | profil kadłuba (Corvus 42 000 `frigate_radar`) | 1,3 | klasa kadłuba (Corvus 7 000 — rola radaru) | `SHIPS[id].sensors` | jawne |
| Fregata z wezwań `frigate_pd` / `frigate_laser` | 18 000 (`frigate_combat`) | 0,7 przy spawnie → **1,0** po kadłubie z belek | 5 000 | profil szablonu; sygnatura z kubełków promienia | **sygnatura awaryjna — zostaje do decyzji D1** |
| Fregata zwiadu z ładowni (ScoutBay) | 18 000 | jak fregata (D1) | **10 000** (jawne `visionRange`) | profil + `SCOUT_TUNE` | jawne (sygnatura — D1) |
| Niszczyciel z wezwań / `spawnPirate` | 30 000 (`destroyer_combat`) | 1,3 (`isCapitalShip` z konfiguratora — D2) | 8 000 | szablon / tabela jednostek | jawne; `spawnPirate` bez kopii profilu → teraz tabela (było z typu) |
| Pancernik, `pirate_battleship` | 45 000 | 1,3 (D2) | 11 000 | jw. | jw. |
| Lotniskowiec (wezwanie, tylko sojusznik) | 60 000 (`capital_combat`) | 1,3 | 14 000 | szablon kapitałowy | jawne |
| Colossus (`supercapital`, promień śmierci) | 80 000 (`atlas_combat`) | 1,3 | 18 000 | szablon kapitałowy | jawne |
| Iron Skull (`pirate_supercapital`) | 80 000 | 1,3 | 18 000 | szablon kapitałowy | jawne |
| Atlas z wezwań | 80 000 | 1,3 | 18 000 | szablon kapitałowy | jawne |
| Megafrachtowiec z wezwań (czoło, 6 wagonów, tył) | 60 000 (`capital_combat`) | 1,3 | 14 000 | szablon kapitałowy | jawne |
| Myśliwiec / bombowiec / torpedowiec / kanonierka z wezwań | 8 000 (`fighter_combat`) | 0,5 (typ `fighter`) | 5 000 | szablon | jawne |
| Myśliwiec przechwytujący z wezwań | 8 000 | **0,5** | 5 000 | szablon; sygnatura z tabeli jednostek | sygnatura z kubełka promienia |
| Myśliwce z hangaru NPC, hangaru gracza, drony bazy piratów | **8 000** | 0,5 | 5 000 | tabela jednostek (typ) | moc z typu |
| Holownik serwisowy | **18 000** (`frigate_combat`) | **1,0** | 18 000 (klasa lotu supercapital — D3) | tabela jednostek | moc i sygnatura awaryjne |
| Okręt z awansu ruchu (fregata, niszczyciel, pancernik — typ klasy) | profil szablonu | 0,7 / 0,85 / 1,0 z tabeli typów (D2) | klasa kadłuba | szablon + tabela typów | jawne |
| Lotniskowiec z awansu ruchu (bez `isCapitalShip`) | 60 000 | **1,0** (D2) | 14 000 | tabela jednostek | sygnatura awaryjna |
| Kadłuby cywilne ruchu v2 (awans, dev): shuttle, kontenerowiec, frachtowce, ciężki frachtowiec, harvester, belter, surveyor, tender, tankowiec, salvage hauler, holownik budowlany, statek ratunkowy, boja alarmowa | **18 000** (`frigate_combat`) | **0,7–1,0** (tabela jednostek, stan ustalony) | **5 000** (klasa fregaty) | tabela jednostek + `shipRanges` | wszystko awaryjne |
| Przemytnik, rajder, łowca, kuter policji (dev — typ kadłuba) | 18 000 | 1,0 | 5 000 (klasa lotu fregaty) | tabela jednostek | moc i sygnatura awaryjne |
| Dron naprawczy ruchu (`repair_drone`) | **8 000** (`fighter_combat`) | **0,7** | 5 000 (jak myśliwiec) | tabela jednostek | moc i sygnatura awaryjne |
| Megafrachtowiec z awansu ruchu | **18 000** (D5) | 1,0 | 14 000 | tabela jednostek | moc i sygnatura awaryjne |
| Stacje (planety, małe ciała, porty, baza piratów, stocznia) | 60 000 | 1,5 | **30 000** | `SENSOR_PICTURE_TUNE` (stacja) | wzrok w obrazie 5 000 (awaryjny) |
| Dron zwiadu (źródło bez bytu) | 25 000 | — (nie jest celem) | 25 000 | `SpotterDroneSystem` | jawne |
| Sonda (źródło) | 30 000 | — | 18 000 / 30 000 | `SENSOR_CONFIG.probeRange` | jawne; `deployProbe` nie ma wywołań (martwy kod) |
| Stacja czujników (infrastruktura) | 45 000 | — | 45 000 | `SENSOR_CONFIG.stationRange` | jawne |

Poza obrazem czujników (nie są bytami w `npcs`, więc nie mają czego wykrywać ani być wykryte):
- drony naprawcze roju (R) i drony przeładunkowe;
- statki ruchu v2 w bańce przed awansem — `trafficBubble.js` nie ma czujników;
- górnicy i złomiarze E24 — to aktorzy bańki (belter, heavy_harvester, salvage_hauler), a po awansie są wierszem „kadłuby cywilne”.

Ich kadłuby mają już jawne wpisy, więc w chwili awansu dostają gotowe wartości.

## Sprawdzenie w grze

`node scripts/webgpu/zasiegi-jednostek-gra.mjs` (`?radarZasiegi`, `RadarZasiegi.scenaJednostek()` + `RadarZasiegi.jednostki()`). Scena: każdy klucz wezwań, holownik i kadłuby dev jako uśpieni wrogowie na pierścieniach 4 / 9 / 16 / 30 / 60 km wokół Atlasa, do tego dron zwiadu. Każda para gracz ↔ byt dostaje dwa promienie (kontakt, wzrok) w obie strony i poziomy z odległości, porównane z obrazem czujników.

| Przebieg | Bytów | Bez zasięgów (0 / NaN) | Gałąź awaryjna | Do decyzji | Niezgodne poziomy | Pipeline'y sync | Błędy konsoli |
|---|---|---|---|---|---|---|---|
| przed (`.tmp/zasiegi-jednostek/przed`) | 68 | 0 | 37 bytów (30 jednostek + 7 stacji\*) | — | 0 | 0 | 0 |
| po (`.tmp/zasiegi-jednostek/po`) | 70 | **0** | **0** | 2 (fregaty, D1) | **0** | **0** | 0 |

- Przebieg „przed” nie miał lotniskowca ani Colossusa, bo piraci ich nie mają (`createCapitalShipEntry` → null). Scena tworzy je teraz jako sojuszników przestawionych na wroga.
- Moc pasywna, sygnatura i wzrok jednostek są przed i po równe dla każdego bytu; zmieniły się tylko źródła („awaryjna” → „jednostka:<klucz>”). Dwie zmiany dotyczą tylko obrazu czujników i nie wpływają na rozgrywkę:
  - wzrok stacji w obrazie: 5 → 30 km;
  - moc AKTYWNA jednostek bez `sensors`: dawne 1,2 × pasywna (21 600) → `activeRange` profilu (24 000; dron naprawczy 9 600 → 10 000). Liczy się tylko po impulsie X, a NPC go nie wysyłają.
- \* W przebiegu „przed” tabela audytu traktowała stacje jak okręty (18 km, 1,0). Sam obraz czujników liczył je już wtedy jako stacje (60 km, 1,5); jedyną realną luką był wzrok.
- MAŁY STATEK, czyli mechanika obustronna w grze: gracz z czujnikami 8 km i wzrokiem 5 km.
  - 31 wrogów z dłuższym czujnikiem ma gracza, a gracz ich nie: sama granica, bez obłoku (`P.watchers`, wiersz `bezTwarzy`).
  - 9 bytów: gracz ma je, one gracza nie.
  - Wszystkie poziomy obu stron zgadzają się z odległościami.

## Mechanika obustronna w obrazie czujników

Słowa użytkownika: „zależy kto ma dalszy sensor”. Dane w `src/game/sensorPicture.js`, wygląd zostaje w demie innej sesji.

- Grupa zagrożeń (`P.threats`), czyli znani wrogowie:
  - `them` / `themR` — ich granica kontaktu wobec mnie (ułamek odległości / j.);
  - `themId` / `themIdR` — ich granica wzroku (zgadnięta z rozmiaru, gdy `est`, `SENSOR_PICTURE_TUNE.visionGuess`);
  - `themLvl` — czy oni mają mnie: 0 / 1 kontakt / 2 identyfikacja, prawda gry;
  - `meLvl` — mój poziom wobec nich: 1 = X-y, 2 = cały okręt;
  - `me`, `meR`, `meId`, `meIdR` — moje granice.
- `P.watchers` — wróg, którego strona gracza NIE wykrywa, a który ma gracza:
  - środek koła (do rysowania granicy, nie wroga);
  - `R` — jego kontakt wobec mnie;
  - `idR` — jego wzrok;
  - `lvl` — 1 albo 2.
  Przy kilku takich wrogach UI łączy granice sumą kół. Nakładka i CIC prototypu tego nie czytają.
- Testy: `tests/sensorPicture.test.mjs` („obustronnie: …”).

## Decyzje dla użytkownika (zmiany liczb wpływające na rozgrywkę — NIE wprowadzone)

- **D1. Wykrywalność fregaty z wezwań, w tym zwiadu i wieżyczki misji.**
  - Dziś: 0,7 zaraz po spawnie (promień szablonu 45 j.), potem 1,0, gdy kadłub z belek nadpisze promień (kotwica ≥ 100 j.). W grze to praktycznie zawsze 1,0, czyli tyle co pancernik.
  - Tabela klas i test AI zakładają 0,7.
  - Do wyboru: 0,7 (fregaty trudniej wykryć — AI zobaczy je z ~70% obecnego zasięgu) albo 1,0 (stan gry). Wybór wpisuje się jedną linią w `SENSOR_SIGNATURE_BY_UNIT`.
- **D2. Niszczyciel i pancernik mają 1,3**, jak okręty kapitałowe, przez `isCapitalShip` z konfiguratora wezwań. Tabela klas daje 0,85 / 1,0, i tyle dostają okręty z awansu ruchu. Lotniskowiec z awansu ma 1,0, a z wezwania 1,3. Ujednolicić?
- **D3. Holownik serwisowy widzi 18 km** (klasa lotu supercapital), choć czujniki ma jak fregata (18 km) i sygnaturę 1,0. Wzrok 18 km w mgle wojny to dziś tyle, co Atlas.
- **D4. Gracz ma zawsze sygnaturę 1,3**, także w kadłubie fregaty (Custos, Corvus), bo `isCapitalShip` jest ustawione na stałe. Mały statek gracza powinien mieć sygnaturę swojej klasy (fregata 0,7 / 1,0 — D1), inaczej „latamy małym statkiem” nie da przewagi ukrycia.
- **D5. Megafrachtowiec z awansu ruchu ma czujniki 18 km**, a z wezwania 60 km (`capital_combat`).
- **D6. Kubełki promienia są odwrócone**: 20–39 j. → 0,85, a 40–99 j. → 0,7. Dziś żadna jednostka poza fregatami (D1) w nie nie trafia. Poprawka nic by nie zmieniła; zostaje jako uwaga.
- **D7. Kadłuby cywilne mają klasę fregaty** (wzrok 5 km, czujniki 18 km). Klasy wg rozmiaru dałyby np. ciężkiemu frachtowcowi 14 km wzroku i 60 km czujników.

## Inne uwagi

- `SensorSystem.deployProbe` nie ma wywołań; sondy czyta tylko CIC.
- Okręt z awansu ruchu nie ma `isCapitalShip`, nawet pancernik.
