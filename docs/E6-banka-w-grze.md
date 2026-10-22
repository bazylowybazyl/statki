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
- **Jeden port (krok 1; od etapu 2 — wszystkie porty, niżej):** bańka żyła, gdy fokus był bliżej niż 180 tys. j.
  od węzła Ziemi (`BUBBLE_PORTS`, `BUBBLE_PORT_RANGE`); dalej encje wracają do rekordów.
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
- Okręty zapasu floty nie przyjmują obrażeń (zatrzymują pociski) i nie awansują — decyzja orkiestratora
  z 2026-10-22: zapas nietykalny; zestrzelony okręt garnizonu (kurs PATROL / WAR) = strata z zapasu frakcji
  (E4: `settleGarrisonLosses`).
- Wiązki, rakiety, wybuchy obszarowe i ogień NPC nie ranią statków ruchu (tylko pociski gracza i taran).
- Statki bez kursu (reda `portParking`, zapas floty `placeFleetStock`) nie są kursami — nie ma ich w bańce.
- Radar (`radarFeed.collect`), mgła wojny i obsługa K-7 (ramiona SCARA) nie znają statków ruchu.
- Opóźnienie bufora: pozy są klatkę za grą (ekstrapolacja prędkością, najwyżej 0,5 s). Przy zatkanym workerze
  ruchu (krok świata ~80 ms szczytowo) statek w zakręcie portu może być w grze kilka–kilkanaście j. obok obrazu
  workera — bez znaczenia dla trafień przy obrysach 200–1800 j.
- Encja zniszczona na obrysie (jeden strzał, cel spoza awansu) to wybuch bez wraku w grze (wrak i ładunek są
  rekordem w świecie ruchu); awansowany NPC zostawia wrak gry z kadłuba na belkach.

## Etap 2 (2026-10-22): wszystkie porty, strefa planety, kontrakt E12, awans do pełnego NPC

Zlecenie orkiestratora po scaleniu kroku 1 (`main` 9817a50a). Commity na gałęzi `claude/frosty-moser-69ca47`:
d3869cd4 (porty, strefa planety, stop bez przelotu), 08591b86 (kontrakt E12), awans — commit tego etapu.

### Porty

- `BUBBLE_PORTS = null` — bańka żyje przy każdym rynku z dokami świata (`world.docks`): ringi Marsa i Jowisza
  (archetypy z `main`, hale K-7 i zatoki), pomosty planet, księżyców, Ceres i Westy, hangary kryjówek. Fokus dalej
  niż 180 tys. j. od NAJBLIŻSZEGO portu — bańka pusta. Rynki dodane w biegu wchodzą przez `refreshWorldBubblePorts`.
  Megadoki i budowle Z7 nie są dokami świata (niewpięte w grę) — bańka ich nie zna.
- `ready` / `tick` niosą `bubblePorts` wszystkich portów (`stationId` w rekordzie stanowiska); gra buduje indeks
  stanowisk wszystkich portów (postój gracza) i pisze lampki ringów Marsa i Jowisza (`trafficRegistryBerth` po
  `stationId`); zapas floty stoi na padach K-7 każdego ringu.
- Dwie poprawki lotu wyszły dopiero przy portach bez ringu (Wenus, Westa — wymuszone etapy po zmianie portu):
  hamowanie z tabeli napędu tylko na profilu (nad profilem stopu — awaryjne jak dawniej; inaczej przelot punktu stopu
  o ~0,9 km po materializacji w biegu) i bez rozpychania na ostatnim odcinku przed punktem stopu (kilka kursów
  z jednym punktem odpychało się i żaden nie dochodził). Pomiar w Node: 15 portów × 2 ziarna — 0 wymuszeń, 0 błędów.

### Strefa planety (E5)

- `planetWells` w workerze — te same studnie co strefa `planet_gravity` gry (`planetOrbitRadii`): planeta z ringiem
  — obwiednia ringu + 12 tys. j., `orbitZone.gravity`, reszta `max(2,2 r, r + 1500) + 10 tys.` z r = `baseR ×
  planetScale`. W studni encja: hipercruise × `max(0,6; strefa)` (`HYPERCRUISE_TUNE.minZone`), warp × 0,3
  (`applyZone` w każdym kroku lotu, przed `followPath`). Rekordy kursów liczą czas bez strefy (bez zmiany gospodarki).

### Kontrakt E12 (przeładunek)

- W wiadomości `actors` tylko zmiany: `docks: [DockRecord]` (`{ id, berthId, stationId, mode, cargo, t0, dur, hull,
  unitClass }`) i `undocked: [id]`; most — `TrafficV2.actorDocks` (`Map`). Opis: `trafficProtocol.js` (`DockRecord`,
  `DOCK_MODES`) i notatka orkiestratora `E6-E12-kontrakt-przeladunku.md`. Test: `tests/workerBubble.test.mjs`
  („postoje przy stanowisku (kontrakt E12)…”).

### Awans do pełnego NPC

- **Wyzwalacz:** trafienie gracza, po którym encja żyje (pocisk albo taran — hak `onHit` w `damageTrafficActor`).
  Strzał zabójczy (superbroń, taran z dużą prędkością) niszczy encję na obrysie jak dotąd. Zamek celu, rozkaz RTS
  i holownik — nie (bez nich gracz nie ma interakcji, która wymaga kadłuba).
- **Kto nie awansuje:** zapas floty (STOCK — nietykalny), encje w warpie i w hipercruise (> 2500 j./s — uciekają,
  trafienia zostają na obrysie), megafrachtowiec (w grze to pociąg modułów `megafreighterTrain.js`, proxy rysuje
  cały skład jednym sprite'em) i holownik serwisowy (8300 j., nie jest klasą ruchu).
- **Limity:** 1 awans na klatkę (kadłub na belkach ze sprite'a buduje się w `drawNPCPretty` w budżecie budowy
  kadłubów), 8 NPC z ruchu naraz (kolejne trafione encje zostają na obrysie).
- **NPC:** `makeNPCBase` w pozie i ruchu encji (prędkość ≤ 1,5 × prędkość NPC — encja w podejściu leci kilka
  razy szybciej niż NPC z `DEV_HULL_SPAWNS`), `devHull` + `shipFrame` = kadłub ruchu (sprite z `TRAFFIC_HULLS`,
  wczytany już przy trafieniu), liczby z `DEV_HULL_SPAWNS` (punkty życia, prędkość; kadłub spoza tabeli — punkty
  życia z obrysu), ułamek punktów życia encji, frakcja z bufora (`ACTOR_FIELD.FACTION` → `ready.factions` —
  reputacja za zestrzelenie przez `registerFactionKill`), `mission` (bez despawnu), `trafficCourse` = numer kursu.
  Do zbudowania kadłuba proxy rysuje się w pozie NPC (bez mignięcia). Rozkaz: przy stanowisku i w kolejce `hold`,
  w locie `move` 18 tys. j. od gracza (ucieczka), po dolocie — dalej, póki gracz bliżej niż 20 tys. j., potem stoi.
- **Worker:** `attach` — encja bańki wraca do rekordu, zegar kursu stoi (`actorId = game:N`), stanowisko zostaje
  przy kursie. Zginął NPC → `destroyed` (wrak z ładunkiem kursu w świecie ruchu; w grze — wrak z kadłuba).
  Koniec walki (20 s bez trafienia gracza) i dalej niż 20 tys. j. → `detach { progress: null, pose }` i cichy koniec
  NPC (bez wraku); bańka materializuje kurs w pozie NPC (`viewState.handoff`, tylko w etapie oddania — rekord, który
  zdążył pobiec dalej poza bańką, wraca z rekordu) i planuje ścieżkę od tego miejsca (przelot albo podejście
  na stanowisko; postęp etapu od postępu z chwili oddania — `pathStart`). Poprawka przy okazji: `detach` z
  `progress: null` zerował postęp etapu (`Number(null) = 0`).
- **Testy:** `tests/trafficPromotion.test.mjs` (5: kolejka, kto awansuje, rozkaz, werdykt, punkt ucieczki),
  `tests/trafficBubble.test.mjs` (hak `onHit`, frakcja, encja awansowana nie wraca z workera, zgon blokuje powrót),
  `tests/workerBubble.test.mjs` (attach zamraża rekord, `detach` z pozą bez postępu → encja w pozie NPC).

### Braki kadłubów ruchu (awans działa na minimum)

1. **Mostki, rdzenie, zbiorniki, gniazda:** w `src/data/hardpointEditorDefaults.js` z kadłubów cywilnych ruchu są
   tylko cztery frachtowce (`inter_station_shuttle`, `container_ship`, `long_haul_freighter`, `heavy_freighter`)
   i to z samymi dyszami (MAIN / SIDE). Reszta (`heavy_harvester`, `belter`, `surveyor`, `refinery_tender`, `tanker`,
   `salvage_hauler`, `construction_tug`, `smuggler`, `pirate_raider`, `distress_beacon_ship`, `repair_drone`) nie
   ma wpisu wcale. Żaden nie ma mostka (`attachEntityBridges` nic nie przypina — strzał w mostek nie robi hulka),
   rdzenia reaktora ani zbiornika paliwa (śmierć wybucha ze środka, nie z `fuelTankBlast`). Okręty Terra Novy
   i piratów (`terran_*`, `pirate_*` z `editorKey`) mają gniazda i dysze z edytora.
2. **Dysze:** kadłuby bez wpisu edytora mają w 3D dysze MAIN z `TRAFFIC_HULLS[].main` (`autoHulls3D`, jak proxy),
   bez SIDE.
3. **Broń i AI bojowa:** awansowane okręty (garnizon K-7, łowcy, rajdery) lecą jako `combatDisabled` bez broni —
   uciekają albo stoją jak cywile. Pełny okręt wojenny = spawn klasy z `WARSHIP_CLASSES` z bronią i mózgiem bojowym
   (osobne zadanie; rajder potrzebuje też mostka — `TRAFFIC_HULLS.pirate_raider`, TODO AGENT).
4. **Sprite'y zastępcze:** `heavy_freighter` (sprite `long_haul_freighter`), łowca i policja (fregata Terra Novy),
   ratownik (`distress_beacon_ship`), wyprawa wojenna (jeden niszczyciel) — `TRAFFIC_UNIT_HULLS`, TODO AGENT w
   `src/data/trafficHulls.js`. Z11 ma gotowe sprite'y (`bounty_hunter`, `police_cutter`, `rescue_ship`, nowy
   `heavy_freighter`) — czekają na akceptację i mostki.
5. **Lot po ścieżce kursu:** NPC nie leci kursem (dok, korytarze, etap dalej) — kurs stoi, dopóki NPC żyje; po
   powrocie do bańki leci dalej z rekordu. Plan z kroku 1 (mózg „kurs ruchu” na `portPaths` po stronie gry) — później.
6. **Stanowisko pod awansowanym NPC:** lampki ringu gasną (rejestr pisze tylko bańka), automat K-7 i postój gracza
   widzą pole jako wolne; worker trzyma je przy kursie (nikt inny nie dostanie przydziału).
7. **Pomosty portów bez ringu nie mają modeli w grze** (Luna, Merkury, Ceres, Westa…): statki dokują w pustej
   przestrzeni obok stacji (stacja w środku planety / ciała, pomost kilka tys. j. dalej) — zrzuty `07-port-*`.
8. **Ładunek i łup:** wrak gry awansowanego NPC nie niesie ładunku kursu (ładunek jest we wraku świata ruchu);
   rozbiórka wraku gry daje złom kadłuba jak każdy wrak NPC.

### Pomiary etapu 2 (2026-10-22, RTX 5080, headless Chrome, tryb gracza `renderWorker=1`)

`node scripts/webgpu/ruch-banka-gra.mjs --out .tmp/ruch-banka-e6b2` (ziarno 7, świat rozgrzany 40 min gry; przebiegi 3
i 4 — `--obserwacja 8 --porty -`, sam awans). Porty: gracz 5 tys. j. na zewnątrz od pierwszego stanowiska (K-7 przy
ringach), 8 s gry, potem 2 s próbek bez proxy i 2 s z proxy (`TrafficBubble.hideRender`):

| port | stanowiska | encje (+ zapas K-7) | zadokowane w porcie | GPU ms bez / z proxy | CPU workera renderu ms bez / z |
|---|---|---|---|---|---|
| Ziemia (A/B po 8 s) | 224 (K-7, zatoki) | 48 (+6) | 26 w 40 s obserwacji | 0,35 / 0,39 | 2,20 / 2,18 |
| Mars | 224 (K-7, zatoki) | 8 (+20) | 6 | 0,28 / 0,43 | 3,29 / 3,70 |
| Jowisz | 224 (K-7, zatoki) | 4 (+12) | 3 | 0,44 / 0,42 | 10,55 / 9,46 |
| Luna | 52 (pomost) | 12 | 0 (encje przy stanowiskach Ziemi w promieniu bańki) | 0,21 / 0,18 | 1,19 / 1,65 |
| Ceres | 130 (pomost) | 11 | 11 | 0,85 / 0,85 | 2,37 / 3,53 |
| Merkury | 78 (pomost) | 19 | 7 (+9 w kolejce) | 0,23 / 0,26 | 1,34 / 1,53 |
| Westa | 104 (pomost) | 93 | 22 | 0,57 / 0,54 | 1,84 / 2,52 |

- Krok bańki w workerze ruchu: 0,008–0,08 ms (średnio) we wszystkich portach.
- Różnice z / bez proxy w portach to próbki 2 s jedna po drugiej (pierwsza zaraz po teleporcie) — w szumie; A/B
  w tym samym miejscu po 8 s (Ziemia, 48 encji): GPU +0,04 ms, CPU −0,02 ms. Jowisz ~10 ms CPU workera renderu
  z proxy i bez — koszt sceny Jowisza (ring, planeta), nie bańki (4 encje).
- Awans (przebiegi 2 i 3): lotniskowiec garnizonu w K-7 Ziemi, railgun 500 → NPC `terran_carrier` z kadłubem
  na belkach od pierwszej klatki odczytu (`hold`, 6412 / 6912 pkt), zestrzelony → wrak gry na belkach
  (`window.wrecks`) i wrak kursu `garrison-00032` w świecie ruchu (`reason: player` — strata zapasu frakcji, E4).
  Kontenerowiec Konsorcjum (lance_rail_l, 100) → NPC (720 / 900 pkt) ucieka (`move`, 113–172 j./s); gracz
  odlatuje 30 tys. j., koniec walki (narzędzie: 4 s) → `detach` z pozą, encja w bańce 15 j. (przebieg 2) / 32 j.
  (przebieg 3) / 88 j. (przebieg 4) od ostatniej odczytanej pozy NPC (odczyt co 0,5 s przy 137–172 j./s — ruch NPC
  między próbkami, nie skok).
- Taran (przebieg 4, gracz burtą 5 j. przed dziobem, zbliżanie 600 j/s): ciężki frachtowiec (9000 pkt obrysu)
  dostał 7200 pkt i awans. W przebiegu 2 (stary układ: 60 j. przed dziobem) dwa małe statki konwoju obok celu
  dostały taran i awans, a gracz z prędkością 600 j/s wszedł w nie jako w pełne kadłuby — kadłub Atlasa pękł
  (zderzenie kadłubów na belkach, jak z każdym NPC).
- Postój gracza (`berth-hold`): przebiegi 1, 2 i 4 — stanowisko zatoki trzymane, żaden kurs nie wszedł; przebieg 3
  — po 8 s gracz nie stał na polu (zbiór pusty). Nie powtórzyło się; harness zapisuje teraz pozę gracza względem
  pola i statki obok (`etapy.postoj.gracz`).
- Koszt przy Ziemi (przebieg 4, A/B po 8 s): CPU workera renderu 1,54 → 1,76 ms z ~46 proxy, GPU 0,344 / 0,346 ms.
- 0 błędów strony i workerów; 0 pipeline'ów synchronicznych na Ziemi (przebieg 3). Przegląd portów (przebieg 2):
  3 pipeline'y synchroniczne modeli stacji planet (`station009_low`, `Space_Station_Top` z `src/stations/*.glb`,
  `stations3D`) przy pierwszym wejściu w kadr odległego portu — poza bańką (obszar `stacje`), do rozgrzewki stacji.
