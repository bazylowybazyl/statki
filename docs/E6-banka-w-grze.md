# E6 — bańka ruchu v2 w grze (fala 3, wersja zwężona)

Zadanie E6 z `docs/PLAN-ekonomia-rynki.md` (§ 3.5, wiersz E6), 2026-10-22. Stan i zasady obszaru: reguła `ruch-v2`,
§ „Bańka w grze”. Ten dokument trzyma decyzje, pomiary i plan dalszych kroków.

## Krok 0 — prom kręcił się na stanowisku pomostu

- Objaw: prom na `luna:dok2:b1` stał w pozie (odchyłka 0 / 0,7 j., kurs 0°), a `angVel` 0,161 > 0,07, więc okno
  przechwytu (`berthCaptureOk`) go odrzucało; stanowisko łapał strażnik po 25 s. Test świata ×60 („bez wymuszonych
  przechwytów”) bywał przez to czerwony, zależnie od natężenia ruchu.
- Przyczyna (potwierdzona odtworzeniem: 3744 podejścia do pomostu, wymuszenia tylko przy kroku 0,2 s — 52):
  w `followPath` prawo kursu przy punkcie stopu przełączało się między pościgiem (cel `look` przed statkiem na osi
  — poprawka w poprzek) a gołą osią odcinka (gałąź `over`, gdy statek przeskoczył punkt). Statek przeskakiwał pole
  STOP o ~0,94 j., cofał się dokładnie na punkt i znów ruszał — cykl dwóch kroków, a kurs skakał co krok
  o atan(w poprzek / look) ≈ 2,8°.
- Poprawka: przy punkcie stopu poprawka pościgu wygasa liniowo na ostatnich `look` jednostkach, a od punktu dziób
  trzyma oś — przejście ciągłe. Odrzucony wariant: pościg także za punktem (dziób celujący w oś) — statek stał na
  polu z kursem 19° (okno ≤ 7°).
- Regresja: `scripts/tests/portPaths.test.mjs` — 312 podejść promu do 26 stanowisk pomostu przy kroku 0,2 s;
  przed poprawką 14 wymuszeń i 25,2 s przy polu, po niej 0 i 0,4 s. Port K-7: kurs przy przechwycie najgorzej
  0,09° (było 0,71°), w poprzek 3% okna (było 1%).

## Krok 1 — decyzje

- **Lot liczy worker ruchu, nie gra** (`workerBubble.js`). Odrzucony wariant: gra odtwarza kursy z bufora
  `COURSE_FIELD` i prowadzi `materializedFlight` u siebie, z `attach` / `progress` / `stage-done` w protokole —
  wymagałby kopii maszyny etapów (następny etap, czas postoju, przydział, kolejka) po stronie gry i dawał opóźnienie
  rundy wiadomości po każdym domknięciu etapu (encja „stoi” do odpowiedzi workera albo zgłasza etap dwa razy).
  W workerze bańka ma prawdziwe kursy, a dolot i koniec postoju rozlicza ta sama transakcja co zegar
  analityczny — dokładnie układ testu integracyjnego świata ×60. Zasada 1 zostaje: trafienia, taran i punkty życia
  liczy gra w 2D, na pozach z bufora (ekstrapolowanych do kroku fizyki).
- **Jeden port:** bańka żyje, gdy fokus jest bliżej niż 180 tys. j. od węzła Ziemi (`BUBBLE_PORTS`,
  `BUBBLE_PORT_RANGE`); dalej encje wracają do rekordów.
- **Promień bańki a życie NPC:** bańka 60 tys. j. (obraz: proxy w kadrze przy najmniejszym zoomie gry), trafienia
  i taran w promieniu 20 tys. j. od gracza (= `NPC_DESPAWN_RADIUS`) — dalej i tak nie ma czym trafić, a awans
  do NPC (niżej) będzie miał ten sam próg w obie strony.
- **Gabaryty:** `dockLayout.hullFootprint` przechodzi przez `trafficHullProfile` (klasy kursów bez własnego
  profilu: `freighter-capital` = ciężki frachtowiec 1800 × 660, nie kontenerowiec 312 × 216). Ten sam obrys mieści
  statek na stanowisku, rysuje proxy i dostaje trafienia.
- **Stanowiska:** jeden rejestr po obu stronach — worker (dyspozytor) jest źródłem przydziału, gra pisze lampki
  ringu (`'traffic'`) z encji i zgłasza stanowiska pod graczem (`berth-hold`), worker przenosi z nich kursy
  w podejściu. Statek już w korytarzu albo na polu zostaje (gra widzi stanowisko jako zajęte).

## Pomiary (2026-10-22, RTX 5080, headless Chrome, tryb gracza `renderWorker=1`)

`node scripts/webgpu/ruch-banka-gra.mjs --out .tmp/ruch-banka/run5` (świat ruchu ziarno 7 rozgrzany 40 min gry,
zegar krokowy harnessu — przebiegi 4 i 5 dają te same zdarzenia):

| | wynik |
|---|---|
| encji przy porcie Ziemi (40 s obserwacji) | 49 różnych, w kadrze bańki 29–41 naraz |
| dokowania | 15 statków zadokowanych w zatokach, 0 w halach K-7 (niżej) |
| lampki ringu (`occupied` / `reserved` = `'traffic'`) | 28–35 stanowisk zatok Ziemi w trakcie obserwacji |
| ostrzał (`fireWeaponCore` gracza, pociski w pętli kolizji gry) | trafienie → frachtowiec zniszczony; wrak z workera: `reason: player`, pozycja trafienia, ładunek `warp_mk3` × 5 (wartość 117 933) |
| taran (zbliżanie 600 j/s) | kontakt, frachtowiec zniszczony, gracz wypchnięty z obrysu |
| postój gracza na Z01-MG1 | `berth-hold` w workerze, żaden kurs nie wszedł na stanowisko |
| krok bańki w workerze ruchu | 0,04–0,13 ms (śr.), najwyżej ~1,7 ms |
| CPU workera renderu, ~37 proxy w bańce (kadr portu) | +0,13–0,27 ms z proxy (2,67 / 2,54 ms; przebieg 4: 2,05 / 1,78 ms) — A/B `TrafficBubble.hideRender` w tym samym miejscu |
| GPU klatki | 0,35 / 0,34 ms — różnica w szumie |
| wątek gry (dekodowanie, pozy kroku, pocisk, taran, stanowiska, pozy klatki) | ~8 µs na klatkę przy 40 encjach (mikrobenchmark Node — harness zamraża `performance.now()`) |
| błędy konsoli (strona i workery) | 0 |
| pipeline'y synchroniczne workera | 0 na starcie i w trakcie (przebieg 5). `start-sync-gra.mjs --ab` z bazą scalenia (A,B,A,B): A0 4 (`HallDust`, `SpaceDust` — pierwszy przebieg po zimnym starcie Vite, także na BAZIE), B1 0, A2 0, B3 0 |

Testy: `tests/workerBubble.test.mjs` (7, w tym przejęcie kursu przez `attach` gry), `tests/trafficBubble.test.mjs` (7), `scripts/tests/portPaths.test.mjs`
(nowa sekcja pomostu). Bramka bilansu po zmianie obrysów (`e6-obrysy`) — te same pozycje zaliczone i niezaliczone
co baza (`e6-baza`): przechwyty 15,6–16,4%, głód ≤ 14,7 min, stocznie 0 min; kolejki (Ceres 2,51–3,39 wobec
2,59–3,28) i tick (pod obciążeniem równoległym) niezaliczone jak w bazie. Wydzielenie `assignPortService`
w dyspozytorze bez zmiany zachowania: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczna z bazą liczba
w liczbę (przy starych obrysach w obu przebiegach).

## Czego nie ma (ryzyka i dalsze kroki)

- **Hale K-7 stoją puste.** Stanowiska K-7 mają rolę `military`, a w gospodarce nie cumuje nic wojskowego
  (pomiar: 0 / 112 zajętych przez 60 min gry). Bańka obsłuży K-7 bez zmian (ścieżki hal przetestowane
  w `portPaths`), gdy patrole albo floty frakcji dostaną postój w porcie domowym — zadanie gospodarki (zgłoszone
  orkiestratorowi: wariant „patrole i floty wracają do portu domowego”).
- Wiązki, rakiety, wybuchy obszarowe i ogień NPC nie ranią statków ruchu (tylko pociski gracza i taran).
- Statki bez kursu (reda `portParking`, zapas floty `placeFleetStock`) nie są kursami — nie ma ich w bańce.
- Radar (`radarFeed.collect`), mgła wojny i obsługa K-7 (ramiona SCARA) nie znają statków ruchu.
- Opóźnienie bufora: pozy są klatkę za grą (ekstrapolacja prędkością, najwyżej 0,5 s). Przy zatkanym workerze
  ruchu (krok świata ~80 ms szczytowo) statek w zakręcie portu może być w grze kilka–kilkanaście j. obok obrazu
  workera — bez znaczenia dla trafień przy obrysach 200–1800 j.
- Wybuch statku ruchu to `GameBlasts` bez wraku w grze (wrak i ładunek są rekordem w świecie ruchu).

## Plan: awans encji do pełnego NPC

Cel: statek ruchu, z którym gracz wchodzi w interakcję (cel ataku, abordaż, rozkaz, holowanie), staje się NPC
gry z kadłubem na belkach — trafienia kraterami, rozpad, wrak do złomowania — i wraca do bańki, gdy gracz odleci.

1. **Kiedy:** encja w promieniu `NPC_DESPAWN_RADIUS` (20 tys. j.) i jeden z wyzwalaczy: pierwsze trafienie
   (dziś punkty życia gry — po awansie obrażenia przechodzą na kadłub), zamek celu gracza, rozkaz RTS, holownik.
   Limit naraz (np. 8) — reszta zostaje proxy.
2. **Jak (protokół już jest):** gra wysyła `attach { course }` — kurs przechodzi na zegar gry, a bańka w workerze
   zwalnia encję tego kursu (nowa reguła w `workerBubble`: kurs z `actorId` gry nie materializuje się w bańce,
   encja bańki → `detach` bez postępu, pole stanowiska zostaje zajęte). Gra tworzy NPC w pozie i prędkości encji
   (`npc.shipFrame = resolveTrafficHullId(unitClass)`, sprite w `HULL_SPRITE_PATHS_BY_ID`, `getNpcHullRenderProfileId`
   po `shipFrame`), punkty życia z encji, ładunek i frakcja z kursu (nowe pola bufora: `PAYLOAD`, `ORDER` — albo
   zapytanie `snapshot` kursu). Proxy znika w tej samej klatce, w której NPC dostaje kadłub (bez mignięcia —
   wspólna tekstura `acquireHullVisualTexture`).
3. **Lot NPC:** mózg „kurs ruchu” — prowadzi NPC po tej samej ścieżce, co bańka (`portPaths` / `ringRouter` jako
   biblioteka po stronie gry, na ODCINKU, który worker wyśle przy `attach`: bieżący etap + następny), `progress`
   co ~1 s, `stage-done` przy dolocie / końcu postoju; dok i korytarze — przechwyt jak u gracza (`PortDocking`).
   Bojowy statek ruchu (rajder, łowca) dostaje mostek przed awansem (Z4: „rejder potrzebuje mostka”).
4. **Powrót:** NPC dalej niż 20 tys. j. od gracza (zamiast despawnu — `npc.trafficCourse` wyłącza despawn) albo
   koniec interakcji → `detach { course, progress }` i usunięcie NPC; bańka materializuje kurs od nowa z rekordu
   (pozycja z `detach` — `viewState`). Zniszczony NPC → `destroyed` (jak dziś), wrak gry z ładunkiem kursu
   (`convertToWreck` + łup z `payload`).
5. **Testy:** atrapa mostu (attach / detach / stage-done w kolejności), cykl awans → dok → powrót bez zamrożonych
   kursów i bez dwóch statków na stanowisku (jak test świata ×60), harness: trafienie → awans → krater → rozpad.
