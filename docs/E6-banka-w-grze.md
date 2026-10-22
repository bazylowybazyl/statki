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
- **Płynny obraz (uwaga orkiestratora: drgania przy 240 Hz):** bufor jest klatkę za grą, więc pozę trzeba
  ekstrapolować. Prędkość wzdłuż dziobu nie widzi rozpychania, dociągania przechwytu ani zmian rozpędu — nowy
  bufor przesuwał statek o p99 7,8 j. (najwyżej 22 j.) co klatkę fizyki. Teraz bufor niesie ruch faktyczny kroku
  i przyspieszenie, gra ekstrapoluje drugim rzędem: p99 0,19 j., > 2 j. w 0,036% klatek encji (zmiany etapu).
  Pomiar: 60 s klatek 1/60 s przy porcie, ~240 tys. par klatek encji. Wybór zamiast interpolacji między dwoma
  buforami (jak `renderPoses` NPC): bez dodatkowej klatki opóźnienia obrazu względem trafień.
- **Napęd z tabeli (uwaga E9):** encja leciała trybem klasy domyślnej (20 tys. j./s) z rozpędem 60% prędkości na
  sekundę (1,7 s do vmax). Teraz `driveModeFor(tryb, klasa ładowni kursu)` — van Mk II 30 tys. j./s i ~5,8 s
  rozpędu, hauler Mk I 20 tys. i 7 s (test w `scripts/tests/materializedFlight.test.mjs`).
- **Zapas floty na padach K-7** (prośba orkiestratora, opcjonalna — wyszła tania): `placeFleetStock` z rejestrem
  redy wojskowej daje gotowe pady; worker dokłada okręty jako encje `STOCK` bez kursów. Przy Ziemi po 40 min gry
  stoi 7 okrętów Terra Novy (niszczyciele, fregaty) — hale K-7 żyją, zanim przylecą kursy wojskowe (E4).
- **Stanowiska:** jeden rejestr po obu stronach — worker (dyspozytor) jest źródłem przydziału, gra pisze lampki
  ringu (`'traffic'`) z encji i zgłasza stanowiska pod graczem (`berth-hold`), worker przenosi z nich kursy
  w podejściu. Statek już w korytarzu albo na polu zostaje (gra widzi stanowisko jako zajęte).

## Pomiary (2026-10-22, RTX 5080, headless Chrome, tryb gracza `renderWorker=1`)

`node scripts/webgpu/ruch-banka-gra.mjs --out .tmp/ruch-banka/run7` (świat ruchu ziarno 7 rozgrzany 40 min gry,
zegar krokowy harnessu; przebiegi 4–5 przed poprawkami napędu, póz i zapasu floty, 6–7 po nich; przebieg 8 po
scaleniu `main` 283129a0 z garnizonem E4: 49 statków, 26 dokowań — 24 w zatokach, 2 okręty garnizonu w K-7 — obok
6 okrętów zapasu na padach, trafienie i taran niszczą cel, postój gracza bez wejścia ruchu, 0 błędów, 0 pipeline'ów sync):

| | wynik |
|---|---|
| encji przy porcie Ziemi (40 s obserwacji) | 62 różne (przebieg 5: 49), w bańce ~30–45 naraz |
| dokowania | 15 statków zadokowanych w zatokach; w halach K-7 kursów brak (niżej), zapas floty: 7 okrętów na padach K-7 |
| lampki ringu (`occupied` / `reserved` = `'traffic'`) | 28–35 stanowisk zatok Ziemi w trakcie obserwacji |
| ostrzał (`fireWeaponCore` gracza, pociski w pętli kolizji gry) | trafienie → statek zniszczony; wrak z workera: `reason: player`, pozycja trafienia, ładunek kursu (przebieg 5: `warp_mk3` × 5, wartość 117 933; przebieg 7: pusty górnik w drodze na pole) |
| taran (zbliżanie 600 j/s) | kontakt, frachtowiec zniszczony, gracz wypchnięty z obrysu |
| postój gracza na wolnym MG1 zatoki | `berth-hold` w workerze, żaden kurs nie wszedł na stanowisko |
| krok bańki w workerze ruchu | 0,04–0,13 ms (śr.), najwyżej ~1,7 ms |
| CPU workera renderu, ~37–45 proxy w bańce (kadr portu) | +0,11–0,27 ms z proxy (przebiegi 4, 5, 7) — A/B `TrafficBubble.hideRender` w tym samym miejscu |
| GPU klatki | 0,35–0,39 ms, różnica z proxy i bez w szumie (±0,03 ms) |
| wątek gry (dekodowanie, pozy kroku, pocisk, taran, stanowiska, pozy klatki) | ~8 µs na klatkę przy 40 encjach (mikrobenchmark Node — harness zamraża `performance.now()`) |
| błędy konsoli (strona i workery) | 0 |
| pipeline'y synchroniczne workera | 0 na starcie i w trakcie (przebieg 5). `start-sync-gra.mjs --ab` z bazą scalenia (A,B,A,B): A0 4 (`HallDust`, `SpaceDust` — pierwszy przebieg po zimnym starcie Vite, także na BAZIE), B1 0, A2 0, B3 0 |

Testy: `tests/workerBubble.test.mjs` (8: m.in. przejęcie kursu przez `attach` gry, zapas floty na padach K-7),
`tests/trafficBubble.test.mjs` (8: m.in. ekstrapolacja drugiego rzędu, zapas floty bez obrażeń),
`scripts/tests/portPaths.test.mjs` (nowa sekcja pomostu), `scripts/tests/materializedFlight.test.mjs` (napęd z tabeli). Bramka bilansu po zmianie obrysów (`e6-obrysy`) — te same pozycje zaliczone i niezaliczone
co baza (`e6-baza`): przechwyty 15,6–16,4%, głód ≤ 14,7 min, stocznie 0 min; kolejki (Ceres 2,51–3,39 wobec
2,59–3,28) i tick (pod obciążeniem równoległym) niezaliczone jak w bazie. Wydzielenie `assignPortService`
w dyspozytorze bez zmiany zachowania: `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczna z bazą liczba
w liczbę (przy starych obrysach w obu przebiegach).

## Czego nie ma (ryzyka i dalsze kroki)

- **Kursy do hal K-7 — od scalenia `main` 283129a0 są** (garnizon E4: patrole i floty frakcji z postojem
  i tankowaniem w K-7 portu domowego). Bańka dokuje je bez zmian w kodzie (role `military`, ścieżki hal
  z `portPaths`): ziarno 7, po 40 min gry 24 kursy PATROL z przydziałem w K-7 Ziemi; 5 min gry nad halą K7-1 —
  12 różnych okrętów zadokowanych (do 6 naraz) obok do 7 okrętów zapasu, 0 próbek z dwoma statkami na jednym
  padzie (zapas ustępuje padu kursowi przy następnym rozstawieniu). Test: `tests/workerBubble.test.mjs`
  („garnizon K-7…”). Przed garnizonem (pomiar sprzed scalenia): 0 / 112 stanowisk K-7 zajętych przez 60 min.
- Okręty zapasu floty nie przyjmują obrażeń (zatrzymują pociski) — strata zapasu frakcji wejdzie z awansem.
- Okręt garnizonu K-7 (kurs PATROL / WAR) da się zestrzelić jak każdy kurs: kurs kończy się wrakiem bez ładunku,
  `tickGarrison` usuwa wizytę i wysyła następną, ale zapas frakcji się nie zmniejsza (garnizon to widok zapasu —
  reguła `ruch-v2`, § „Garnizon w K-7”). Do decyzji: strata okrętu z zapasu frakcji albo garnizon nietykalny
  jak zapas na padach.
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
