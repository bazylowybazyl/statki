# Testy a czas ściany (2026-10-29)

Zgłoszenie: pod obciążeniem (równoległe sesje Claude z harnessami Chrome, gra użytkownika na tym samym komputerze)
pełny zestaw `node --test "tests/*.test.mjs"` bywał czerwony z powodów niezwiązanych ze zmianą. Przegląd sesji
„Wydajność podczas niszczenia budowli” (commit a4a531cd — odłamy ciał świata, `runSubsets`) wskazał progi czasu
ściany w testach i wzorzec w kodzie: budżet czasu sprawdzany PRZED pierwszym krokiem. Cel: zestaw przechodzi przy
obciążonej maszynie, bez osłabiania tego, co testy pilnują.

## Metoda

- **Wolny zegar zamiast obciążania CPU** (`scripts/wolny-zegar.mjs`): preload, w którym każdy odczyt
  `performance.now()` / `Date.now()` przesuwa czas o `WOLNY_ZEGAR_MS` — wątek „wywłaszczany” między odczytami.
  Timery (`setTimeout`, `Atomics.wait`) płyną normalnie. Uruchomienie:
  `WOLNY_ZEGAR_MS=5 node --import ./scripts/wolny-zegar.mjs --test --test-concurrency=2 "tests/*.test.mjs"`.
- Pełny zestaw przy 5 ms na odczyt, poprawiane pliki przy 0 / 2 / 5 / 10 ms i 10 razy zwykle.
- Mutacje kodu: podmiana fragmentu (usunięcie budżetu, limitu, gwarancji kroku), test, przywrócenie pliku — test ma
  mutację złapać.
- Losowość rozpadów: preload z `Math.random` = LCG z ziarna (`LOSOWE_ZIARNO`), przegląd 150 ziaren.

Wolny zegar nie pokazuje progów z dwoma odczytami zegara i dużym zapasem („budowa < 400 ms”) — te wzięte ze spisu
asercji w `tests/` (wzorce `performance.now()`, `Date.now()`, `…Ms <`, stałe `setTimeout` przed asercją).

## Co padało (przed poprawkami)

| Test | Zegar | Objaw | Przyczyna |
|---|---|---|---|
| `cicBeltLayer` — wypiek kafli | od 2 ms | „upieczone 0” | KOD: budżet sprawdzany przed pierwszym krokiem; domknięcie kafla tylko z zapasem 0,6 ms — od ~0,5 ms na odczyt nigdy. TEST: próg 3 ms czasu ściany na klatkę (pod obciążeniem 5,84 ms — 2 z 3 pełnych zestawów 2026-10-28) |
| `hullShadowSdf` — warstwy, LRU | od 2 ms | drugie pieczenie klatki odrzucone | TEST: pierwsze pieczenie ≥ 2,5 ms czasu ściany wyczerpuje budżet |
| `warBackdrop` — klatka sceny | 10 ms | rozbieg nie kończy się w 400 klatkach | KOD: budżet `prewarmBudgetMs` sprawdzany przed pierwszym krokiem |
| `renderBuffers` — 3 testy wątków | 5 ms | za mało stron / rekordów / odczytów | TEST: okna 900 / 300 ms czasu ściany, każdy wątek od własnego startu (czytelnik ruszający > 50 ms przed pisarzem gubił jego ostatnią stronę) |

Ryzyko pod obciążeniem bez porażki przy wolnym zegarze: progi wydajności (`workerBubble` krok bańki < 50 ms,
`cargoPortOps` plan < 25 ms i odczyt < 200 µs, `asteroidMining` budowa i wybuch < 400 ms), stałe czekanie 60 ms
(`rozgrzewka`), limit 200 × 5 ms na hak rozgrzewki ringu (`menuBackdrop`), flush z limitem 150 ms < 2 s
(`rozgrzewka`), liczba kawałków rozgrzewki ruchu zależna od szybkości maszyny (`widocznyRuch` — tu ryzyko odwrotne:
bardzo szybka maszyna liczyła 600 s w jednym kawałku).

## Poprawki

- Kod — co najmniej jeden krok na klatkę: `warBackdrop3D` (rozbieg), `cicBeltLayer` (wypiek: wiersz albo domknięcie
  kafla; domknięcie jako pierwsza praca klatki bez zapasu budżetu). Zegar budżetu wstrzykiwany: `CicBeltLayer({ clock })`,
  `HullShadowSdf.clock`. Rozgrzewka ruchu (`trafficCore.warmupSlice`) i budowa ciał (`worldBodies.js`) miały gwarancję już
  wcześniej. Zasada przekrojowa: AGENTS.md, „Haki przekrojowe”.
- Testy — stan i liczba kroków zamiast czasu ściany: zegar deterministyczny (CIC: czas z próbkowania pola i domknięcia;
  SDF: `tick` na odczyt; ruch: 1 ms na odczyt), budżet 0 = dokładnie krok na klatkę (bitwa w głębi), testy
  zagłodzonego wątku (CIC, ruch: dokładnie jeden krok na klatkę / kawałek), czekanie na stan (kolejka rozgrzewki pusta,
  hak ringu do ~30 s), wątki z liczbą klatek, wspólnym startem i znakiem końca pisarza.
- Progi wydajności — osobne testy z opcją `WYDAJNOSC` (`tests/helpers/wydajnosc.mjs`): w zwykłym zestawie „skipped”
  z powodem, uruchamia `HULLFALL_TESTY_WYDAJNOSC=1`. Część funkcjonalna została w zwykłym biegu (duża skała r 1000:
  ładunek w środku zawarty, masa bez zmian).

## Mutacje (wszystkie złapane, chyba że opisano)

- `warBackdrop3D`: bez gwarancji kroku, bez budżetu.
- `hullShadowSdf`: bez budżetu czasu, bez limitu liczby pieczeń, bez sumy czasu. Przeżywa „bez warunku nie-pierwszego
  pieczenia” — mutacja równoważna (suma czasu klatki startuje od 0, budżet > 0).
- `cicBeltLayer`: bez gwarancji kroku, domknięcie bez gwarancji, wiersze bez budżetu, domknięcie bez zapasu (także po
  wierszach pierwszego kroku), pętla kafli bez terminu.
- `trafficCore`: kawałek bez budżetu, budżet przed pierwszym krokiem.
- `rozgrzewka`: flush ignoruje podany limit, wpis „loading” od razu w kolejce.
- `renderBuffers`: odczyt przebicia bez drugiego sprawdzenia seqlocka, czytelnik potrójnego bufora bez oddania strony,
  rozjechany licznik wzrostów pierścienia.

## Środowisko worktree (nie czas ściany)

W worktree sesji aplikacji pełny zestaw ma porażki niezależne od zmian: brak `node_modules` (4 testy czytają
`node_modules/three/src/…` ścieżką względną — `fxCore3D`, `rozgrzewka`, `renderTargetResize`, `warpNurt`) i CRLF w kopii
roboczej (`core.autocrlf=true` w systemowym gitconfig; `hallGas` „LF”, `shadowShaftsQuality` tnie źródło po `\n  }\n`).
Główny checkout ma `node_modules` i LF — tam zielone. Obejście w worktree: junction `node_modules` → katalog repo
(jak inne worktree) i pliki z indeksem LF przepisane na LF (po przepisaniu `git read-tree HEAD` — indeks pamiętał
rozmiar pliku z CRLF i `git status` pokazywał wszystko jako zmienione).

## Testy „bez alokacji” (kompilator V8 w osobnym wątku)

Pełny zestaw po poprawkach, puszczony obok przeglądu ziaren i 10 biegów zmienionych plików (prawdziwe obciążenie),
padł na `hullDamageMap` „bez alokacji: trafienie + klatka zadań” (1,18 MB zamiast < 96 KB na 2000 klatek). To ta
sama klasa co czas ściany: kompilator optymalizujący V8 pracuje w osobnym wątku, pod obciążeniem kod zoptymalizowany
wchodzi później, a interpreter pakuje liczby double. Symulacja bez obciążania CPU — flaga V8
`--concurrent-recompilation-delay=<ms>` (sztuczne opóźnienie każdej kompilacji w tle):

| Opóźnienie | Testy alokacji z porażką (11 plików, 124 testy) |
|---|---|
| 0 ms | 0 |
| 50 ms | 8 |
| 200 ms | 10 (w 9 plikach) |

Poprawka: `tests/helpers/alokacje.mjs` — `untilSteady(measure, ok)`: pomiar w rundach przedzielonych przerwą 100 ms,
koniec przy pierwszym pomiarze przechodzącym próg testu albo po 40 rundach (prawdziwa alokacja oblewa każdą — mutacje
łapane, porażka po 5–25 s). Po zmianie 0 porażek przy 0 / 50 / 200 / 500 ms. Przy okazji: testy porównujące dwa
pomiary miały luz — `rocketFx` „krok rakiety”: pierwsza runda 4 rakiet 366 KB przy ustalonych ~68 KB na 1000 klatek
(porównanie z 40 rakietami przepuszczało każdy przyrost), `fx3dTSL`: 49 KB przy ~32 KB; dziś pomiar bazowy idzie do
stanu ustalonego.

## Losowość rozpadów

`tests/worldBodies.test.mjs` (próg punktów, rozpad statyczny, dach) i `tests/hullBodies.test.mjs` (wybuch reaktora)
losują ziarna Voronoi bez ziarna. 40 zwykłych przebiegów i 150 ziaren (preload z `Math.random` = LCG z ziarna) —
0 porażek: te testy są stabilne, zostają bez zmian (inaczej niż kawałek Q-W z a4a531cd — ~15% rozbić z < 3 odłamami).

## Wynik

Pełny zestaw `node --test --test-concurrency=2 "tests/*.test.mjs"` (worktree z `node_modules` i LF): 3553 testy —
3548 zaliczonych, 0 porażek, 3 pominięte (progi wydajności), 2 TODO — zwykle, przy wolnym zegarze 5 ms na odczyt
i przy `--concurrent-recompilation-delay=200`. Poprawiane pliki: 0 / 2 / 5 / 10 ms na odczyt i 10 zwykłych biegów
bez porażki; tryb `HULLFALL_TESTY_WYDAJNOSC=1` przechodzi na tej maszynie. `npm test`: 1908 asercji OK.
