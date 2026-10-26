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

- W wiadomości `actors` tylko zmiany: `docks: [DockRecord]` (`{ id, berthId, stationId, mode, cargo, fill, t0, dur,
  hull, unitClass }`; `fill` — masa ładunku / ładowność klasy kursu, 0…1, null bez ładowni) i `undocked: [id]`; most — `TrafficV2.actorDocks` (`Map`). Opis: `trafficProtocol.js` (`DockRecord`,
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

### Braki kadłubów ruchu (stan po E13, 2026-10-22)

Zrobione w E13 (gałąź `claude/e13-kadluby-ruchu-db21d9`; reguły `ruch-v2` § „Bańka w grze”, `mostki-reaktor`
§ „Kadłuby ruchu v2”):

1. **Mostki, rdzenie, zbiorniki, gniazda, dysze** — wszystkie 18 kadłubów ruchu bez `editorKey` (15 dawnych +
   `bounty_hunter`, `police_cutter`, `rescue_ship` z Z11) mają wpis edytora (klucz = rama), strefę mostka poziomu
   z pola kadłuba (model `tn_<poziom>`; strzał w mostek → hulk → wrak), rdzeń w maszynowni, zbiornik paliwa (śmierć
   wybucha z `fuelTankBlast`), dysze MAIN (osie proxy) i SIDE. Cywile: MAIN tylko do obrazu (`visual.mainVisualOnly`,
   lot bez zmian); okręty (przemytnik, rajder, łowca, kuter policji): gniazda broni i model lotu fregaty. Miejsca
   dobrane na sprite'ach (zrzuty `.tmp/e13/znaczniki_*.png`), strażnik `tests/trafficHullData.test.mjs`.
2. **Broń i AI bojowa** — okręt ruchu (`TRAFFIC_COMBAT_HULLS`: garnizon `terran_*`, łowca, policja, rajder,
   przemytnik) po awansie ma liczby szablonu wezwania swojej klasy, broń z gniazd i mózg klasy; okręt niepiracki
   dostaje urazę do gracza (`playerGrudge` — wrogi bez względu na reputację, cel tylko gracz widoczny i w zasięgu,
   wieże nie biją sojuszników frakcji). Cywile uciekają / stoją jak dotąd.
3. **Sprite'y Z11** — łowca, kuter policji i ratownik mają własne kadłuby (role `hunter`, `police`, `rescue`),
   ciężki frachtowiec — własny sprite (4 dysze MAIN, ładownia 3 × 8 z `cargoBays.js` — `TRAFFIC_CARGO_BAY_HULLS`
   wskazuje `heavy_freighter`, kopia `heavy_freighter_proxy` usunięta; obrys hali w `haloPortHulls.js`).

Dalej otwarte:

4. **Wyprawa wojenna** (`warfleet`) to jeden niszczyciel Terra Novy na kurs — rodziny frakcyjne z Z11 i szyk kilku
   proxy na kurs nie są zrobione. Modele mostków kadłubów ruchu to modele poziomów TN (także u piratów).
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

## Taran z awansem i encje bez kursu (2026-10-23)

Zgłoszenie użytkownika (gra na `main`): wlot Atlasa w duży frachtowiec bańki odpychał (SAT) albo od razu niszczył
statek (obrażenia `ramK · v²` na obrysie), zamiast ciąć go silnikiem belek jak dawniej; okręty zapasu, statki na
redzie i w odlocie były „niewrażliwe”. Zlecenie orkiestratora: awans PRZED kontaktem, pierwszeństwo taranu,
SAT tylko awaryjnie; bez nietykalnych — strata w ekonomii.

### Decyzje

- **Awans z czasu do kontaktu.** `trafficContactTime` (`trafficBubble.js`) — prostokąt encji powiększony o rzut
  obrysu gracza na osie encji, ruch względny prostoliniowy (test płyt). Pierwsza wersja liczyła gracza okręgiem
  pół długości Atlasa (~900 j.) — w zatłoczonej zatoce „kontakt” łapały wszystkie statki w promieniu ~1 km
  i limit się zapychał (139–1317 odmów w przebiegu, właściwy cel bez awansu). Próg `ramLead` 0,75 s.
- **Pierwszeństwo i zapas.** Taran wchodzi na początek kolejki (za wcześniejszymi taranami), limit
  `maxAlive + ramReserve` = 8 + 4; trafiony statek, na który gracz potem wlatuje, przechodzi na początek.
- **Szybki powrót awansu bez zderzenia** (`ramCalmSeconds` 4 s, `ramReleaseRadius` 5 tys. j., NPC nietknięty) —
  przelot przez port awansuje statki, obok których gracz tylko przeleciał; bez tego trzymały limit przez 20 s.
- **SAT awaryjnie.** Kontakt z obrysem encji do awansu, która nie zdążyła: odepchnięcie bez obrażeń + taran na
  początek kolejki. Encja bez awansu (megafrachtowiec, warp, hipercruise encji): jak dawniej.
- **Nietykalnych nie ma.** STOCK / PARKED / DEPARTED biorą obrażenia i awansują. Bez kursu: `entity-hold`
  (statek firmy poza pulą dyspozytora na czas walki — inaczej nowy kurs dałby drugi egzemplarz statku; odlot znika
  z bańki) i `entity-lost` (zapas floty i okręt garnizonu w odlocie → `settleGarrisonLosses` od razu; statek firmy →
  `loseShip`, jego nowy kurs ginie z nim). Zniszczony okręt zapasu przejmuje miejsce i id encji okrętu o ostatnim
  numerze klasy (`renameParkedShip`) — pad zniszczonego zostaje pusty, reszta stoi, gdzie stała.

### Pomiary (RTX 5080, headless Chrome, tryb gracza, ziarno 7)

`node scripts/webgpu/ruch-banka-gra.mjs --query renderWorker=1 --taran 1 --odlot 1 --obserwacja 8` (przebieg pełny;
`--taran tylko` — sam etap, 10 przebiegów strojenia harnessu i progu). Gracz 450 j/s względnie, prowadzony na cel
w każdej klatce do pierwszego kontaktu; zapis co klatkę, zrzuty co 4 klatki (`09-taran-<cel>-NNN.png`).

| cel | kadłub na belkach od klatki | pierwsze uderzenie (ubytek NPC) | kontakty SAT awaryjne | koniec |
|---|---|---|---|---|
| ciężki frachtowiec z kursem (kolejka portu) | 31 | 102 | 0 | NPC przeżył przecięty: 4000 → ~1690 pkt |
| okręt zapasu (fregata TN) na padzie K-7, od rufy | 32 | 101–103 | 0 | NPC zniszczony, wrak na belkach |
| statek firmy na redzie (frachtowiec dalekiego zasięgu) | 24 | 121 | 1 (inny statek obok) | NPC zniszczony, wrak na belkach |

- Bez odepchnięcia i bez wybuchu w pierwszej klatce: punkty NPC spadają klatkami (np. 1200 → 814 → 786), prędkość
  gracza maleje stopniowo; wybuch dopiero przy zniszczeniu kadłuba.
- Cywil w locie po awansie ucieka (frachtowiec dalekiego zasięgu: kadłub na belkach ~1 s przed kontaktem, Atlas
  ~500 j/s go nie dogonił) — zachowanie NPC, nie błąd.
- Kadłuby na belkach naraz: sufit 12 (8 + zapas taranu 4). Taran w tłum zatoki (gracz orze najbliższe statki przy
  stanowiskach 12 s): 0–4 kadłuby naraz po poprawkach (przed szybkim powrotem — do 12, limit zapchany awansami
  bez zderzenia). Worker renderu w tym czasie: CPU 2,3–3,8 ms, GPU 0,55–0,9 ms; koszt fizyki kadłubów na wątku gry
  zegar krokowy harnessu ukrywa (`performance.now` zamrożony).
- 0 błędów strony i workerów, 0 pipeline'ów synchronicznych (worker i strona) w całym przebiegu z przeglądem portów.
- Symulacja `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczna liczba w liczbę (poza czasem ticku) —
  straty bez gracza się nie dzieją.

## Taran w megafrachtowiec i szybki wlot (2026-10-26)

Zgłoszenie użytkownika: „wleciałem w capital frachtowiec i wybuchł od razu, jak go dotknąłem”. Przyczyna:
megafrachtowiec był na liście kadłubów bez awansu (`TRAFFIC_PROMOTION_SKIP_HULLS` — „pociąg modułów”), więc taran szedł
ścieżką awaryjną SAT z obrażeniami `ramK · v²` na obrysie: przy dopalaczu 0,02 · 1137² ≈ 25,9 tys. > 9000 punktów
encji — zniszczenie w pierwszej klatce kontaktu. Zlecenie orkiestratora: megafrachtowiec na belkach, próg awansu
z czasu budowy kadłuba i prędkości zbliżania, kontakt miękki do gotowości kadłuba, ścieżka awaryjna bez wybuchu
w pierwszej klatce.

### Decyzje

- **Megafrachtowiec = jeden kadłub na belkach ze sprite'a składu** (`TRAFFIC_HULLS.megafreighter`, 2760 × 1380 j.),
  nie pociąg `megafreighterTrain.js` — koszt pozwala (pomiar niżej), wariant z wagonami niepotrzebny. Mostek: wariant
  `sklad` strefy lokomotywy (`BRIDGE_LAYOUT_PROPOSALS.megafreighter.variants.sklad`, wybór `resolveBridgeVariant` —
  typ `megafreighter`; ten sam blok „C” dziobu, który na sprite'cie składu jest ×1,19 w px, strefa w świecie jak u
  lokomotywy, więc model `megafreighter` siada bez skalowania). Rdzeń i zbiornik z automatu. Bez dysz MAIN / SIDE
  po awansie (wpis edytora `megafreighter` to profil lokomotywy gracza — pusty) — tylko obraz.
- **Próg awansu = czas do gotowości kadłuba** (`trafficRamLead`, `trafficPromotion.js`): zapas `ramMargin` 0,3 s
  + (`ramFrames` 3 + tarany przed encją w kolejce + awansowane NPC bez kadłuba) × czas gry na klatkę renderu (średnia,
  nie mniej niż krok 60 Hz) + zmierzona budowa kadłuba tego typu (`hullBuildMs`, pomiar w `drawNPCPretty`; przed
  pierwszym pomiarem `ramBuildMs` 40 ms) + `ramSpriteSec` 0,5 s, gdy sprite jeszcze się wczytuje. Czas do kontaktu
  (`trafficContactTime`) to odległość obrysów / prędkość zbliżania — przy dopalaczu awans rusza ~1137 · 0,35 ≈ 400 j.
  przed kontaktem obrysów, przy 450 j/s ~160 j.
- **Kontakt miękki do gotowości kadłuba** (`stepTrafficSoftContact`): awansowany NPC bez `beamHull` (kolejka budowy,
  sprite, ponowna próba) odpycha gracza obrysem encji (`__trafficLen × __trafficWid`, `trafficRectContact`) bez obrażeń.
- **Ścieżka awaryjna bez wybuchu w pierwszej klatce**: encja do awansu, która nie zdążyła (w kolejce) — odepchnięcie bez
  obrażeń; bez awansu (holownik serwisowy, limit awansów pełny) — `trafficRamFallbackDamage`: `ramK · v²`, najwyżej
  `ramMaxFrac` 15% maks. punktów na kontakt i kontakt najwyżej co `ramCooldown` 0,5 s (tarcie zabija po kilku sekundach);
  encja w warpie i w hipercruisie (> `ramGhostSpeed` 2500 j/s) to duch — bez kontaktu (bezpiecznik E9 gracza zostaje).

### Koszt kadłuba megafrachtowca na wątku gry (Node, `node scripts/koszt-kadluba-ruchu.mjs`)

Prawdziwy `HullBodies` w Node: sprite ruchu przeskalowany do rozmiaru renderu (jak `getNpcHexInitSource`), budowa
(mediana z 5), krok w spoczynku (60 kroków) i taran drugim kadłubem (ciężki frachtowiec) w burtę — 120 kroków 60 Hz.

| kadłub | obraz [j.] | budowa | węzły / belki | krok w spoczynku | krok w taranie 450 j/s (śr. / p95 / maks.) | krok w taranie 1137 j/s |
|---|---|---|---|---|---|---|
| megafrachtowiec | 2760 × 1380 | 2,3–2,4 ms | 8729 / 35 542 | 0,04 ms | 0,88 / 3,0 / 6,3 ms | 1,5 / 5,0 / 6,9 ms |
| ciężki frachtowiec | 1800 × 900 | 1,0 ms | 3592 / 14 526 | 0,01 ms | 0,66 / 1,9 / 3,1 ms | 0,96 / 2,2 / 3,9 ms |
| frachtowiec dalekiego zasięgu | 540 × 270 | 0,3 ms | 262 | — | — | — |
| kontenerowiec | 312 × 156 | 0,1 ms | 110 | — | — | — |

(`--powtorz 7 --kroki 120`, Node 22, ten sam komputer co pomiary w grze; krok w taranie = oba kadłuby w `HullBodies.step`.)

Budowa w grze dokłada skalowanie sprite'a na kanwie i `getImageData` (pierwszy raz na rozmiar — potem z pamięci
`NPC_HEX_IMAGE_CACHE`). Jeden kadłub składu ma ~2,4× węzłów ciężkiego frachtowca — wagony nic by nie dały (suma węzłów
ta sama, dochodzą sprzęgi).

### Pomiary w grze (RTX 5080, headless Chrome, tryb gracza `renderWorker=1`, ziarno 7)

`node scripts/webgpu/ruch-banka-gra.mjs --query renderWorker=1 --taran tylko --taranV 450,1137 --taranCele frachtowiec,megafrachtowiec`
— gracz prowadzony na środek celu w każdej klatce do kontaktu, burtą; zapis co klatkę, zrzuty co 4 klatki i co klatkę
przez 12 klatek od kontaktu (`09-taran-<cel>@<v>-NNN.png`). Zegar krokowy harnessu zamraża `performance.now`, więc
zmierzona budowa kadłuba wynosi tam 0 ms — próg liczy same klatki i zapas.

| cel (ziarno 7) | v [j/s] | kadłub na belkach od klatki | kontakt (pierwszy ubytek NPC) | zapas | kontakty miękkie / awaryjne | punkty po kontakcie (klatki k, k+1, k+2…) | koniec |
|---|---|---|---|---|---|---|---|
| ciężki frachtowiec w kolejce portu | 450 | 55 | 101 | 46 klatek | 0 / 0 | 4000 → 3980 → … → 3881 (k+11) | przecięty, żyje (1640 pkt), 1 odłam na belkach |
| megafrachtowiec na redzie (PARKED) | 450 | 52 | 107 | 55 klatek | 0 / 0 | 9000 → 8941 → … → 8831 (k+14) | przecięty, żyje (7951 pkt), 2 odłamy |
| ciężki frachtowiec | 1137 | 60 | 99 | 39 klatek | 0 / 0 | 4000 → 3745 → … → 3335 (k+11) | rozcięty na 15 odłamów, zginął > 150 klatek po kontakcie |
| megafrachtowiec na redzie | 1137 | 66 | 97 | 31 klatek | 0 / 0 | 9000 → 8887 (k…k+14) | rozcięty: 20 odłamów, żyje (4272 pkt) |

- Żaden cel nie wybuchł w pierwszej klatce kontaktu: punkty spadają co kilka klatek (sufit konstrukcji), prędkość gracza
  maleje stopniowo (1137 → 853 j/s w 14 klatek w megafrachtowcu, 1137 → 897 w ciężkim frachtowcu). Kadłub na belkach był
  gotowy 31–55 klatek przed kontaktem (obrysy prostokątne są większe od sylwetek sprite'ów — próg wychodzi z zapasem),
  ścieżka awaryjna ani kontakt miękki nie zadziałały ani razu.
- Taran w tłum zatoki (36 statków, 500 j/s, 12 s): do 5 kadłubów na belkach naraz, 23 awanse na taran, 15 powrotów do
  bańki, 3 zniszczone, 0 odmów; worker renderu CPU 3,9 ms, GPU 1,9 ms.
- 0 błędów strony i workerów, 0 pipeline'ów synchronicznych (worker i strona).
- Symulacja `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` identyczna z bazą liczba w liczbę.

## Hala Atlasa: stanowisko domowe, hala domowa zapasu, bańka bez `advance` (2026-10-26)

Zgłoszenie użytkownika (start misji 1 w K-7): „na stanowisku, w którym stoi Atlas, jest lotniskowiec Citadella i nagle
skaczą”. Przyczyna: zapas floty (`placeFleetStock`) rozstawiał okręty Terra Novy na padach hal K-7 od budowy świata,
nosiciel trafiał na C-01 hali 1 (pierwszy wolny pad capital), a gracz dostawał pierwszeństwo dopiero po `berth-hold`,
wysyłanym z kroku fizyki. W odprawie świat stoi (`StoryGame.worldFrozen`) — bez `advance` worker nie publikował bańki
wcale, więc cała hala pojawiała się naraz w chwili odcumowania, z nosicielem w obrysie Atlasa (rozpychanie / taran).
Prośby użytkownika: wolne stanowisko dla Atlasa, reszta hali pełna okrętów Terra Novy, luk Atlasa domyślnie zamknięty.

- STANOWISKO DOMOWE: `PLAYER_HOME_BERTHS` (`trafficProtocol.js`) = `earth:K7-1:C-01` — C-01 hali K-7 nr 0 Ziemi
  (start misji 1 — `_dockPlace('C-01')`, powrót `dockReturn`, holownik serwisowy). Gra wysyła je w `init.homeBerths`;
  `setPlayerHomeBerths` (dyspozytor) trzyma je dla gracza (`occupantId = 'player'`) od budowy świata, PRZED pierwszym
  rozstawieniem zapasu; `setPlayerBerthHolds` dokłada je do każdego zbioru z `berth-hold`, więc pusty zbiór gracza
  ich nie zwalnia. Symulacja, bramka i testy `homeBerths` nie wysyłają — świat bez gracza bez zmian.
- HALA DOMOWA ZAPASU: hala stanowiska domowego (`homeDocks` z `director.homeBerths`, `homeStockOptions` w
  `workerBubble.js`) zapełnia się pierwsza i do końca: wygrywa wybór hali w `tryPad`, bez `keepFree` (wolnym
  stanowiskiem przylotu jest stanowisko gracza), z osobnym przejściem awansu klas aż do capital (krążownik i niszczyciel
  na padach capital, gdy frakcja ma jednego nosiciela). Pozostałe hale — równo, jak dotąd.
- BAŃKA BEZ `advance`: gałąź pauzy w `loop` (sceny fabuły, pauza) wysyła fokus i dekoduje bufor
  (`trafficBubbleStep(0)`, `stepTrafficBerths(0)`); rdzeń na `focus` otwiera NIEAKTYWNĄ bańkę krokiem 0
  (`stepBubble(0)` — `updateBubble` z dt = 0 tylko materializuje, czas świata stoi).
- Luk Atlasa: sam postój (`berth-hold`) go nie otwiera, tylko terminal stacji (reguła `przeladunek-portow`).

Pomiary (ziarno 7, godzina rozgrzewki: zapas TN 24 fregaty / 10 niszczycieli / 5 krążowników / 1 nosiciel):
- `placeFleetStock` z halą domową: hala K7-1 — 26 encji zapasu + kurs garnizonu na W-S01 = 27 / 27 padów poza C-01
  (C-02 nosiciel, C-03 krążownik, C-04 niszczyciel, L — krążowniki, M — niszczyciele, S — fregaty); w 10 min gry kurs
  garnizonu przestawił 1 okręt zapasu w tej hali.
- Prawdziwa gra (kampania od menu, tryb `off`): hala pełna (27 encji, żadna na C-01) od odsłonięcia dachu w intro, przez
  odprawę (świat stoi) do odcumowania; Atlas bez ruchu po odmrożeniu świata; `PortCargo.playerDoor` = 0 przy
  `berth-hold` C-01; 0 błędów konsoli.
