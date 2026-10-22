# E7 — gracz na rynku i zapis ekonomii (2026-10-22)

Zadanie z `docs/PLAN-ekonomia-rynki.md` (sesja E2, etap E7): terminal stacji na API rynku, komputer handlowy, stacja gracza jako rynek, zapis stanu ekonomii. Opis stanu i zasad — reguły `ruch-v2` (§ „Oferta portu dla gracza”, „Zapis ekonomii”, „Stacja gracza”, „Komputer handlowy”) i `radar-cic` (§ „Mapa CIC: komputer handlowy”). Tu: decyzje, propozycje i wyniki sprawdzenia.

## 1. Terminal stacji: oferta portu z księgi rynku

- Gracz handluje jak kupiec, na tej samej księdze (`director.book`) co NPC: port SPRZEDAJE zapas ponad rezerwę na własne potrzeby (`offerFloor`), SKUPUJE do celu uzupełnienia (`restockTarget`: 2 h zużycia albo porcja stoczni, z towarem w drodze) i tylko to, czego używa (`stationWantsResource`). Opuszczona stacja sprzedaje wszystko i nic nie skupuje. Liczy to worker (`portOfferFromQuote`) i wysyła w buforze rynku (`MARKET_FIELD.SELL` / `BUY`); gra nie liczy oferty sama.
- Dotąd gracz mógł wcisnąć do portu wszystko do pojemności magazynu (model „magazyn”). Teraz port płaci tylko za to, czego chce — ruda z pasa sprzedaje się w hutach, nie w każdym porcie. To zmiana zachowania dla gracza, nie dla świata (symulacja bez zmian).
- Widok: kolumny Towar / Ładownia / Port ma / Port sprzedaje (`N × cena CR`) / Port skupuje (`N × cena CR`, „ma dość” — używa, ale ma zapas do celu, albo „nie skupuje” — nie używa; w buforze skup −1), zielono — okazja dla gracza (kupno ≤ 85% wartości, sprzedaż ≥ 105%). Karta handlu zajmuje dwie kolumny siatki terminalu.
- Po kupnie lub sprzedaży oferta w kopii mostu przesuwa się od razu (`applyToMirror`), worker potwierdza w następnym `tick`.

## 2. Komputer handlowy: warstwa „HANDEL” mapy CIC (klawisz H)

- Forma: warstwa mapy CIC, nie osobny ekran terminalu — trasy i porty mają sens na mapie układu, a CIC ma już widok układu, zoom i panel. Terminal stacji zostaje do handlu w porcie.
- Dane: agregat z warstwy rekordów (`summarizeTrade` w workerze), na żądanie co 2 s czasu rzeczywistego i tylko przy włączonej warstwie. Trasy z ładunkiem w powietrzu (grubość — tony, barwa — kategoria towaru), przy portach ▼ najtańszy zakup i ▲ najlepszy skup, w panelu: kursy i tony w drodze, najgęstsze trasy, okazje dla ładowni 380 j., urobek pasa w drodze.
- Klawisz H tylko w kontekście CIC (przed zwiadem i dronem w `KEYDOWN_ORDER`); poza CIC H robi to co dotąd.

## 3. Stacja gracza jako rynek

- API: `foundPlayerStation(spec)` — encja stacji w grze (`style: 'player'`, statyczna, 2 doki) + `addMarket` rodzaju `player` z przemysłem z budynków (`composeFromBuildings`), frakcja Terra Nova; `addPlayerStationBuilding(id, rola)` → `addMarketBuilding`. Stacja jest w zapisie i wraca po F5.
- W grze nie ma ścieżki budowy stacji gracza, więc jest hak konsoli `?dev`: `DevEconomy.foundStation({ x, y, name, buildings })`, `DevEconomy.addStationBuilding(id, rola)`, `DevEconomy.playerStations()`.
- Bez modelu 3D: model stacji dodany w biegu kompilował 2 pipeline'y synchronicznie w workerze renderu (`Space_Station_Top…`), więc `stations3D` pomija `style: 'player'`, a na kanwie jest znacznik 2D (pierścień, doki, nazwa).

### Propozycja interfejsu (do decyzji)

1. **Założenie stacji** — w terminalu dowolnej stacji Terra Novy karta „Placówka”: „Załóż stację” → tryb wskazania na mapie CIC (punkt w płaszczyźnie gry; zakaz w płycie ringu i w promieniu 20 tys. j. od cudzej stacji), koszt kredytów + konstrukcja z ładowni (stal, elektronika — z tabeli budynków), czas budowy jako kurs ruchu v2 (frachtowiec z materiałem), potem `foundPlayerStation`.
2. **Budynki** — karta „Infrastruktura” stacji gracza: lista ról przemysłu z kosztem `buildingCost` i tym, co rola produkuje i zużywa (`composeFromBuildings` pokazuje skutek przed zakupem), `addPlayerStationBuilding` po zapłacie. Hak `?dev` budynków nie pobiera kosztu.
3. **Model 3D** — szablon modułowy (rdzeń + moduły ról) w rozgrzewce na ekranie ładowania; dopiero wtedy zdjęcie wyjątku `style: 'player'` w `stations3D`.
4. **Zysk gracza** — dziś stacja gracza to rynek frakcji Terra Nova (magazyn i ceny jak u NPC), bez kasy gracza. Propozycja: udział gracza w obrocie (marża portu na rachunek gracza) albo podatek dokowy — do decyzji razem z modelem imperium (`player-empire`).

## 4. Zapis ekonomii

- Zakres: magazyny i długość głodu (`duress`) wszystkich rynków, rejestr uszczuplenia pasa (komórki → wyrwy), gotowe okręty flot frakcji, stacje gracza z budynkami. Kursy w locie, firmy, kupcy, stocznie i wojna startują od nowa (zgodnie z zadaniem).
- Wersja schematu `ECONOMY_SAVE_VERSION = 1` w workerze i w grze (strażnik testem). Brak zapisu, śmieci w `localStorage` albo obca wersja → świat od zera, bez wysypki. Inna skala gospodarki (`?trafficV2=N`) → magazyny przeliczone proporcją; inny rozmiar komórki pasa → rejestr pominięty.
- Kiedy: autozapis co 20 s czasu strony (stan z workera) i synchroniczny zapis przy `beforeunload` (magazyny z kopii mostu + reszta z ostatniego stanu workera). Klucz `economy`, czyszczenie `?reset=economy`.
- Rynki dodane po starcie (stacje gracza, kryjówki misji) dostają swój magazyn z zapisu po `market-add`. Wyrwy z zapisu worker wysyła zaraz po `ready`.

### 4a. „Nowa gra” = gospodarka od zera (decyzja użytkownika 2026-10-22)

- Droga: świat ruchu buduje się przy starcie strony ZAWSZE świeży (`initTrafficV2` bez `restore`). Zapis nakłada osobna wiadomość `economy-restore` na zbudowany świat (`restoreEconomyState`, potem księga, zapas floty bańki, `tick` z rynkiem i wyrwy od razu) — tylko po wyborze przed startem gry (`loadEconomyIntoWorld`; stacje gracza z zapisu dokłada gra). `startGame` woła `beginEconomySession`: bez wczytanego zapisu kasuje klucz `economy` i stan workera do zapisu (`economySaveCache`), więc autozapis i `beforeunload` nie mają z czego odtworzyć starego stanu; pierwszy autozapis nowej gry pisze świeży świat.
- Dlaczego nie restart workera: most, bańka, rynki misyjne, CIC i wyrwy pasa trzymają się jednego mostu i jednego świata — restart to ponowne wpięcie wszystkiego. Wczytanie „w drugą stronę” (świeży świat + nałożenie zapisu przed pierwszym krokiem) daje ten sam stan co `init.restore` (test w suicie `economySave`, § 2b).
- W menu nie ma dziś ścieżki „wczytaj”: „Kontynuuj” wraca do bitwy w tej samej karcie (świat dalej żyje, nic się nie kasuje), „Wczytaj grę” jest wyłączone („wkrótce”), a po F5 do gry wchodzi się tylko przez „Nową grę”. Zapis ekonomii wczytuje więc tylko hak `DevEconomy.loadEconomy()` (w menu, przed startem). Przycisk dla gracza — do decyzji (propozycja: włączyć „Wczytaj grę”, gdy jest zapis ekonomii; dalej wybór trybu jak w „Nowej grze”).

## 5. Sprawdzenie

- Symulacja `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` przed i po: identyczna liczba w liczbę (poza czasem ticku) — oferta, zapis i agregat nie zmieniają świata. Bramka bilansu wynika z tego samego (świat bez zmian).
- `npm test` — nowa suita `economySave` (24 sprawdzenia: zapis, wczytanie na świeży świat z innym ziarnem, stacja gracza po `market-add`, złe zapisy, wyrwy od razu po `ready`, oferta w buforze ze skupem −1 dla towaru nieużywanego, agregat); `node --test tests/graczNaRynku.test.mjs` (wersja zapisu, tolerancyjne wczytanie, klawisz H, rysunek warstwy).
- Gra w trybie gracza (`node scripts/webgpu/rynek-gra.mjs --query renderWorker=1`): terminal Ziemi (63 towary; port sprzedaje 54, skupuje 7), kupno i sprzedaż przesuwają ofertę od razu, stacja gracza z haka (rynek `player`, 41 towarów, skupuje 20), CIC „HANDEL” (8 tras, 28 portów), urobek gracza w pasie (6 wyrw), zapis (35 rynków, 13 KB) → F5 → wczytanie: magazyn Ziemi, stacja gracza i jej rynek, wyrwy wracają; 0 pipeline'ów synchronicznych (strona i worker renderu), 0 błędów.

## 6. Ryzyka i do zrobienia

- „Nowa gra” kasuje zapis od razu przy starcie (§ 4a) — przypadkowe kliknięcie po F5 traci poprzednią gospodarkę (jak nadpisanie zapisu w każdej grze).
- `MARKET_STRIDE` 5 → 7: każdy czytelnik bufora rynku musi brać stałą z protokołu (test `trafficCore` poprawiony).
- Na mapie CIC przy Słońcu stemple portów wewnętrznych planet nachodzą na siebie w widoku całego układu — czytelne po przybliżeniu; ewentualnie ukrywanie stempli przy gęstości > N na ekran.
- Stacja gracza nie ma własnych przewoźników (jak każdy rynek dodany w biegu — obsługują ją puste przeloty i kupcy).
