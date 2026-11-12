# E15 — widoczny ruch w grze (2026-10-23)

Zadanie E15 z `docs/PLAN-ekonomia-rynki.md` (§ 4, wiersz E15). Stan i zasady obszaru: reguły `ruch-banka` i `ruch-v2`
(§ „Rozgrzewka świata”). Ten dokument trzyma decyzje, pomiary i ryzyka.

Diagnoza (orkiestrator): ruchu w grze prawie nie widać, bo (1) świat ruchu rusza pusty — po 15 min gry w powietrzu ~90
kursów, po 60 min ~740 aktywnych; harnessy maskowały to rozgrzewką narzędzia (`--rozgrzewka 2400`), (2) bańka rysuje
statki tylko 60 tys. j. od gracza, (3) statki bez kursu (reda, orbita postojowa, nadmiar zapasu floty) nie były
rysowane. Decyzja użytkownika z 2026-10-23: bez osobnych cywilnych NPC (druga, udawana ekonomia) — trzy poprawki
w ruchu v2 bez zmiany ekonomii.

## 1. Rozgrzewka świata przy ładowaniu

- Stała `TRAFFIC_WARMUP_SECONDS` = 3600 w `trafficProtocol.js` (protokół — czytają ją rdzeń i most; most w workerze
  nie ładuje rdzenia). Gra prosi o nią w `init` (`warmup: true`; `?trafficWarmup=N` — inne sekundy, 0 = bez).
- Liczy worker, kawałkami po ~12 ms pełnych kroków świata (5 s), z oddaniem sterowania przez `MessageChannel`
  (zagnieżdżony `setTimeout(0)` przeglądarka przycina do 4 ms). Wiadomości gry (`market`, `berth-hold`, zapis) czekają
  najwyżej kawałek + jeden krok (~45 ms). Świat buduje się przy starcie strony, więc rozgrzewka idzie w menu.
- WYBÓR: gracz, który kliknie Start przed końcem, nie czeka — czas gry dokłada się do świata normalnie, a bańka rusza
  dopiero po końcu rozgrzewki (nie „gdy kursy ją dogonią”). Powód: rozgrzewka przesuwa zegar świata o setki sekund na
  sekundę realną; encje bańki w takim świecie skakałyby (dolot, koniec postoju rozliczane hurtem), a zegar mostu
  musiałby gonić zegar świata w trakcie lotu encji. W pomiarze rozgrzewka kończy się w 9,5 s CPU workera — przed
  pierwszymi 30 s gry.
- DETERMINIZM: czas gry i rozgrzewka idą przez `world.pending`, kroki świata mają stałą długość, więc podział na kawałki
  nie zmienia kolejności kroków. Test (osobne procesy — moduły trzymają liczniki): kawałki z przeplecionym `advance`
  = zwykłe `advance` co do id kursów, magazynów i dostaw.
- ZEGARY: most dokłada przeliczone sekundy rozgrzewki do `time` przy każdym `tick` — czas mostu = czas świata;
  `actors.time`, `T0` kursów i `DockRecord.t0` w tym samym czasie (test mostu z workerem na niby). Czas gry od Startu
  to `time − warmup.seconds`.
- ZAPIS EKONOMII: `economy-restore` w trakcie rozgrzewki czeka do jej końca (odpowiedź też) — magazyny, flota i stacje
  gracza są wtedy dokładnie jak w zapisie. Rejestr pasa z zapisu jest przyrostowy (`recordExtraction`), więc dodaje
  się do urobku 60 min rozgrzewki — wyrwy mogą być nieco głębsze niż w zapisie.
- TRYB AWARYJNY (rdzeń na głównym wątku): bez rozgrzewki (`TRAFFIC_WARMUP_FALLBACK_SECONDS` = 0) — 720 kroków po 12–45 ms
  przycinałoby menu i pierwsze klatki; świat startuje pusty jak przed E15.
- Symulacja (`symulacja-ruchu.mjs`) i bramka bilansu nie proszą o rozgrzewkę — startują od zera (strażnik w teście).

## 2. Reda i orbita postojowa w bańce

- Statki firm `PARKED` w portach przy fokusie → rejestr postoju portu (`syncParking`, stabilny) → encje bez kursu
  (`ACTOR_FLAG.PARKED`, id ujemny, faza `hold`, stoją). Nadmiar zapasu floty na redzie wojskowej → `STOCK | PARKED`.
- Port z ringiem: reda świata (strefy cywilne za ringiem, rim + 4250 j.). Widać sloty o indeksie < 4 w paśmie strefy
  (zwarty blok przy kotwicy): przy Ziemi ~100–160 statków z ~450 czekających — reszta stoi bez obrazu. Widoczność zależy
  od slotu, nie od kamery (bez migania przy ruchu gracza).
- Port bez ringu z budowlą E14: orbita postojowa (`buildDockOrbitParking`) — łuk ±75° za dyskiem zapasu, po stronie od
  węzła portu (ciało za budowlą), 24 sloty (`parkingSlots`), z dala od ścieżek wejścia / wyjścia, lejków i odlotów; dok
  okrągły (wejścia promieniowe dookoła obręczy) — orbita 14 tys. j. za dyskiem. Nadmiar w hangarze (bez obrazu, jak
  dotąd). Hangar kryjówki — bez postoju w obrazie.
- Pierwszeństwo: gracz — nowy statek nie dostaje slotu pod graczem; kurs — kolejka stoi na łukach `holdingSlotPosition`
  (Ziemia ~64 tys. j., poza redą), orbita omija ścieżki bańki.
- Nietykalne jak STOCK: pocisk staje, bez obrażeń i awansu (gra: `damageTrafficActor`, `trafficActorPromotable`).
- PRZEJŚCIA: reda → kurs — `viewState.handoff` w pozie slotu, kurs materializuje się w tym samym buforze (Node, Ziemia,
  180 s: 28 z 30, skok ~1 j.). Odlot po kursie → reda — hak `departTarget`: odlot leci na swój slot, encja postoju
  zasłonięta do jego końca. Odlot → nowy kurs (najczęstsze przy Ziemi: statek dostaje kurs 5–15 s po rozładunku) —
  `handoffDepartures`: kurs przejmuje pozę odlotu (31 przejść, zwykle < 15 j.).

## 3. Szersza bańka

- `BUBBLE_PORT_FOCUS_RADIUS` = 100 tys. j. przy porcie (180 tys.) i w studni planety (gra prosi o 60 tys.). Studnie są
  dziś w całości w zasięgu portów (największa: Jowisz 67 tys. j.) — warunek studni działa przy planecie bez portu.
- Wybór promienia (Node, ziarno 7, po rozgrzewce 60 min, Ziemia, gracz 50 tys. j. od środka, 30 s):

| promień | encji (lot / postój / zapas) | najwyżej | różnych w 30 s | krok bańki śr. / maks. |
|---|---|---|---|---|
| 60 tys. (jak E6) | 110 (48 / 43 / 19) | 136 | 144 | 0,10 / 13,6 ms |
| 80 tys. | 185 (87 / 79 / 19) | 226 | 238 | 0,30 / 35 ms |
| **100 tys.** | 283 (134 / 109 / 40) | 325 | 351 | 0,18 / 14 ms |
| 120 tys. | 310 (138 / 132 / 40) | 365 | 387 | 0,20 / 16 ms |

  100 tys. obejmuje całą redę Ziemi i podejścia z obu stron ringu; 120 tys. dokłada mało (+10%). Limit encji:
  lot `maxActors` 400, razem `BUBBLE_ENTITY_LIMIT` 512 = blok migawki `traffic`.

## Pomiary w grze (2026-10-23, RTX 5080, headless Chrome, `renderWorker=1`, ziarno 7)

`node scripts/webgpu/ruch-banka-gra.mjs --query renderWorker=1 --rozgrzewka 0 --obserwacja 8` — zimny start jak
u gracza (Start klikany zaraz po menu, harness nie rozgrzewa świata). Przed E15 przy tym samym starcie świat był pusty
(~90 kursów w powietrzu po 15 min gry, przy Ziemi pojedyncze statki).

| czas gry od Startu | encji przy Ziemi | lot | postój (reda) | zapas floty | aktywne kursy |
|---|---|---|---|---|---|
| 30 s | 301 | 129 | 142 | 30 | 654 |
| 2 min | 337 | 137 | 160 | 40 | 610 |
| 5 min | 362 | 158 | 164 | 40 | 662 |

- Rozgrzewka 60 min świata: 9,5–10,3 s CPU workera ruchu, skończona przed 30 s gry. Dwa przebiegi dały te same liczby
  przy 30 s (powtarzalność w grze).
- Porty (po 8 s gry przy porcie; encje w locie / postój / zapas): Mars 118 / 169 / 74, Jowisz 22 / 92 / 62, Luna 79 / 84 /
  11, Ceres 10 / 24 / 0, Merkury 54 / 1 / 0, Westa 53 / 0 / 0, Tytan (krzyż) 14 / 24 / 0.
- Ostrzał, awans do NPC, taran, powrót do bańki, odpowiedź ogniem, postój gracza (`berth-hold`) — bez zmian.
- Pipeline'y synchroniczne: 0 na starcie i na końcu (worker i strona); `start-sync-gra.mjs --query renderWorker=1`: 0 / 0.
  Błędy strony i workerów: 0.
- Koszt (bez ciszy — orientacyjnie, A/B w tym samym miejscu, `TrafficBubble.hideRender`): Ziemia ~300–340 encji — CPU
  workera renderu +0,23–0,31 ms z proxy, GPU w szumie (0,40 / 0,39 ms), krok bańki w workerze ruchu 0,1–0,5 ms.
- Zrzuty: `.tmp/e15/zimny/10-zimny-ziemia.png` (port Ziemi po 30 s), `.tmp/e15/zimny/12-reda.png` (reda z czekającymi
  frachtowcami), `.tmp/e15/doki/11-zimny-dok-tytan.png` (krzyż Tytana z orbitą postojową po 30 s),
  `.tmp/e15/doki/07-port-*.png` (Ceres, Luna, Tytan).

Ekonomia bez zmian: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczna z bazą liczba w liczbę (poza czasem
ticku); bramka bilansu na 3 ziarnach — wszystkie pozycje gospodarki identyczne z bazą bf1ca8a7, różni się tylko czas
ticku (dwie bramki liczone równolegle: ziarno 7 — 25,3 ms wobec 24,0 ms bazy, próg 25 ms; bramka nie używa rdzenia).

## Ryzyka i czego nie zrobiono

- Statek z orbity, któremu firma daje kurs zaczynający się w INNYM porcie (rekord: postój załadunku tam), znika
  z orbity bez lotu — skrót gospodarki; pokazanie przelotu wymagałoby zmiany ekonomii (Tytan: 6 takich w 3 min).
- Statki na postoju stoją (bez dryfu). Odlot na slot redy jest rzadki przy Ziemi (statki dostają kurs 5–15 s po
  rozładunku) — częstsze jest przejęcie pozy odlotu przez nowy kurs.
- Zapis z menu w trakcie rozgrzewki: wyrwy pasa z zapisu dodają się do urobku rozgrzewki.
- Statek na redzie może na chwilę nachodzić na kurs, który przelatuje przez redę (bańka nie rozpycha postoju).

## Koszt A/B w ciszy (2026-10-23 14:55–15:04)

A = baza bf1ca8a7 (bańka E6, harness rozgrzewa świat 60 min), B = E15 (rozgrzewka gry 60 min), przebiegi A/B/A/B
`ruch-banka-gra.mjs --query renderWorker=1 --obserwacja 8 --porty mars`. Koszt przy Ziemi w tym samym miejscu, z proxy /
bez proxy (`TrafficBubble.hideRender`). W tle przez cały pomiar chodził obcy harness `ringi-archetypy-gra.mjs`
(inna sesja użytkownika) — wartości bezwzględne zawyżone, porównanie A/B przeplatane.

| | encji przy Ziemi | CPU workera renderu ms (z / bez proxy) | GPU ms (z / bez) | krok bańki w workerze ruchu ms |
|---|---|---|---|---|
| A1 | 67 | 3,60 / 3,31 | 0,43 / 0,42 | 0,08 |
| B1 | 319 | 2,72 / 2,59 | 0,43 / 0,40 | 0,13 |
| A2 | 67 | 4,37 / 3,62 | 0,49 / 0,44 | 0,46 |
| B2 | 319 | 2,04 / 2,25 | 0,42 / 0,43 | 0,13 |

- Proxy ~320 encji: CPU workera renderu +0,13 / −0,20 ms (B) wobec +0,29 / +0,75 ms przy 67 encjach (A) — w szumie
  przebiegów; GPU bez różnicy. Całkowity CPU workera renderu w B nie wyższy niż w A.
- Krok bańki w workerze ruchu: 0,13 ms przy 319 encjach (A: 0,08–0,46 ms przy 67).
- Mars po 8 s: A 27–32 encje w locie + 34 zapasu; B 95 w locie, 161 postoju, 69 zapasu floty.
- Wątek gry (bańka, most): harness zamraża `performance.now()`, pomiar w nim = 0 — mikrobenchmark E6 (~8 µs na
  klatkę przy 40 encjach) skaluje się liniowo, przy ~320 encjach rzędu 60 µs.
- 0 pipeline'ów synchronicznych i 0 błędów we wszystkich czterech przebiegach.
