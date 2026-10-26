# E12 — przeładunek w portach: ładownie, rój dronów, taśmociągi

Zadanie E12 z `docs/PLAN-ekonomia-rynki.md` (§ 8), 2026-10-22. Polecenie użytkownika: „potrzebujesz jeszcze jednej
sesji, która wdroży roje przeładunkowe i taśmociągi; jest demo ładowni — trzeba dać ładownie”. Stan i zasady obszaru:
reguła `przeladunek-portow` (`.claude/rules/przeladunek-portow.md`). Ten dokument trzyma decyzje, pomiary i ryzyka.

## Co jest w grze

- **Ładownie frachtowców ruchu** przy stanowiskach zatok ringów Ziemi, Marsa i Jowisza (bańka E6; pomosty pozostałych
  portów — bez przeładunku, inny układ pól): po klamrze wrota kieszeniowe rozjeżdżają
  się (przebieg i wygląd z dema ładowni — `cargoBayDoorTimeline`, `bay.tsl.js`), skóra proxy ma w otworze dziurę,
  pod nią wnętrze z ładunkiem. Wrota zamykają się, gdy rój skończy, najpóźniej na końcu okna postoju.
- **Rój dronów z dema liczony na żywo na GPU** (decyzja użytkownika 2026-10-22: „spróbujmy na żywo liczone na GPU”):
  ta sama symulacja (`swarmSim.js` — lot, ORCA na prostokątach, zamki i liczniki kolumn, kontenery w chwycie) i ta
  sama wieża portu (`swarmPlanner.js` — księga kontenerów, chwyty, sztauowanie), te same klasy, chwyty płaskie,
  ramiona teleskopowe, parametry lotu i zegar ×4. Przenosi warstwy kontenerów między ładownią a **stołami
  przeładunkowymi** po obu burtach. Cienie dronów na kadłubie jak w demie (`SwarmShadows`).
- **Taśmociągi** wzdłuż placu: przy załadunku przywożą ładunek z **portalu w grzbiecie zatoki** na stoły przed startem
  roju, przy rozładunku wywożą go do portalu po pracy roju; listwy pasa jadą, gdy taśma pracuje, portal świeci
  bursztynową listwą (HDR — bloom).
- **Liczba kontenerów = ładunek kursu** (widok liczby): kontenery ładowni × wypełnienie (masa ładunku / ładowność klasy
  kursu) z kontraktu workera ruchu (`actors.cargo`, niżej). UNLOAD — ładownia pełna na starcie okna, LOAD — pusta.
- **Luk Atlasa** otwiera się przy postoju na polu stanowiska (`berth-hold`) albo przy otwartym terminalu stacji
  i pokazuje ładunek gracza (`PLAYER.cargo`: wypełnienie z masy, wygląd z surowców wg udziałów masy); pole myśliwców
  i stanowisko fregaty zwiadu (gdy w luku) zostają wolne — „okręty zabierają miejsce ładunkowi”.
- Hale K-7: bez przeładunku — cumuje tam tylko garnizon (REFUEL) i zapas floty (decyzja orkiestratora: OK).

## Decyzje

- **Rój z symulacji GPU w puli slotów** (`src/3d/swarm/swarmBerthPool.js`). W grze stanowiska pojawiają się i znikają,
  więc `init` raz na scenę (demo) nie wystarcza. JEDNA symulacja liczy wszystkie stanowiska na żywo; stanowisko to
  SLOT: stałe zakresy dronów (48), zadań, kontenerów (1536), kolumn (640) i wierszy mapy przeszkód oraz własny
  prostokąt przestrzeni symulacji (oś statku wzdłuż x, bez obrotu — float32 bez drżenia, sloty daleko od siebie,
  ORCA ich nie łączy). Dołączenie i zwolnienie to wpisy zakresów buforów — bez przebudowy pipeline'ów. Wieża na slot
  pisze zadania przez adapter indeksów, stan dronów czyta z odczytu GPU (MAP_READ, asynchronicznie, co drugą klatkę).
  Krok compute: `Core3D.addFxStep`, rozgrzewka kerneli w `warm`. Obraz: materiały roju z ramą slotów
  (`swarmSlotFrame.js` — slot → świat względem początku przy kamerze; to zamiast `FxPoolOrigin`, bo dane slotu nie
  leżą w świecie), drony klas przez mapę indeksów, światła jednym rysunkiem. Demo bez zmian (rama opcjonalna).
- **N stanowisk na żywo z presetu grafiki** (decyzja orkiestratora 2026-10-22, `GFX_EFFECTS.cargoSwarmSlots`):
  Niska 0 (sam stan z zegara), Średnia 4, Wysoka i Ultra 8 (= `SWARM_POOL_TUNE.slots`); najbliżej środka kadru,
  najwyżej 1 dołączenie na klatkę. Pozostałe w kadrze: ładownia w stanie z zegara postoju, bez dronów. Slot trzyma
  przeładunek, dopóki ten jest w ramce gry (pola z zapasem 0,85 kadru + 1800 j.); przy pełnej puli stanowisko poza
  kadrem ustępuje stanowisku w kadrze; po obniżeniu presetu nadmiar slotów się zwalnia.
- **Zero kosztu, gdy nie ma czego liczyć** (decyzja orkiestratora): krok symulacji i odczyt tylko wtedy, gdy któryś
  slot pracuje (rój ruszył i nie skończył). Sloty istnieją tylko dla stanowisk w ramce (kadr z zapasem), więc poza
  portem, przed startem roju, po jego końcu i przy samych ładowniach z zegara — 0 dispatchy i 0 odczytów. Po
  przerwie odczyt jest zerowany (faza PARKED, zadanie 0 = prawdziwy stan dronów w gniazdach), żeby nowy slot nie
  widział dronów poprzedniego właściciela zakresu. Odczyt bez statystyk symulacji (gra ich nie czyta).
- **Kernele: 3 dispatche na krok zamiast 4** (decyzja orkiestratora: scalić kClear + kBin; krok 1/30 s odpada —
  zmienia dynamikę dema). Zerowanie statystyk kroku przeszło do `kBin` (przepełnienie siatki liczy teraz `kSteer`),
  zerowanie siatki mieszającej — do `kIntegrate` (na krok następny; `kSteer` już ją przeczytał). Stan po kroku
  bit w bit jak przed zmianą (pomiar niżej). Dalej się nie da bez zmiany wyniku: `kSteer` czyta pozy sąsiadów, które
  pisze `kIntegrate` (w jednym dispatchu nie ma bariery globalnej), a `kIntegrate` + `kBin` kroku następnego
  wymagałyby podwójnej siatki z parzystością na GPU, przy czym pozy pisane z CPU (dołączenie, zaparkowanie, domknięcie)
  zostawiałyby siatkę nieaktualną na krok.
- **Statek zastany w połowie postoju:** stan startowy z zegara — warstwy przeniesione = postęp postoju (UNLOAD na
  stołach, LOAD w ładowni), reszta czeka u źródła. Drony startują z gniazd (pierwsze 1–2 s to start roju) — bez
  przewijania symulacji. **Koniec okna** (od rundy 3): od zamykania wrót wieża nie daje nowych zadań, drony kończą
  i lądują, ładownia chowa się za domkniętymi wrotami, resztki LOAD wraca taśma — ładownia przy odlocie jest pełna /
  pusta zgodnie z ekonomią, bez skoku w kadrze (pierwsza wersja: `snap` — skok; runda 3 niżej).
- **Liczba dronów:** gęstość jak w demie (dron na 8 warstw), a gdy okno jest ciasne — tyle, żeby pozostałe warstwy
  zdążyły (zmierzone ~60 s czasu roju na kurs warstwy z czekaniem); najwyżej 48 na slot. Kontenerowiec: 3–6 M,
  ciężki frachtowiec: 37 L.
- **Stoły pod płaszczyzną statku** (z −16 zamiast płyty pola −112,9): plac na płycie dawał cztery odcinki pionowe po
  ~115 j. na kurs i rój ~3,7× wolniejszy — ciężki frachtowiec rozładowywał 216 z 760 kontenerów w 50 s. Kamera z góry
  jest ortograficzna, więc wysokości nie widać; taśma zostaje na płycie pola. Stoły = kolumny placu roju (odstęp
  i liczba z `berthYardGeometry` — ten sam obraz stołów z rojem i bez).
- **Ciężki frachtowiec ruchu** rysuje się sylwetką dalekiego zasięgu w skali 1800 j. (`TRAFFIC_HULLS.heavy_freighter`,
  TODO AGENT tam) — ładownia `heavy_freighter_proxy` w `cargoBays.js` leży na TYM obrazku (moduły 2 × 2 × 2, drony L).
- **Plan analityczny** (`planBerthTransfer` — tory z ziarna i zegara, pierwsza wersja E12) zostaje jako zapas i do
  testów; gra bierze z `berthTransfer.js` geometrię placu i czasy postoju.
- **Partie, nie rig na statek**: wnętrza i skrzydła floty — jeden rysunek na kadłub (`bayBatch.tsl.js`, fragmenty
  wspólne z rigiem luku Atlasa), kontenery z zegara i gracza — jeden, rój — drony na klasę, światła, kontenery
  symulacji, taśmy / stoły / portale — jeden.

## Kontrakt danych z E6 (`actors.cargo`)

Osobna tablica obok `data` w wiadomości `actors` (bez zmiany `ACTOR_STRIDE`), Float32Array, krok 8, rekord na encję
przy stanowisku: numer kursu, tryb (1 LOAD, 2 UNLOAD, 0 inne), `stage.seconds`, `stage.moveSeconds`, indeks surowca
w `resources`, wypełnienie (masa / ładowność klasy kursu), sztuki, flagi. Koder: `src/game/traffic/bubbleCargo.js`
(`writeBubbleCargo`), dekoder gry: `syncPortCargoContract` (`src/game/portCargoFrame.js`), test w
`tests/portCargo.test.mjs`. **Wpięte po stronie workera ruchu przez E6** na gałęzi `claude/frosty-moser-69ca47`
(d251c3e4, `packBubbleCargo` w `workerBubble.js`), w `main` od 34fcd98a (E6 etap 2 — bańka we wszystkich portach).
Przeładunek jest widoczny domyślnie; dawna flaga `?przeladunekDemo=1` (ładunek z ziarna kursu) usunięta. Alternatywa E6 —
`actors.docks` / `TrafficV2.actorDocks` (DockRecord: zdarzenia zmian postoju z `t0`, `dur`, `fill`) — nieużywana.

## Pomiary (2026-10-22, RTX 5080, headless Chrome 1600 × 900, tryb gracza `renderWorker=1`, ziarno ruchu 7)

`node scripts/webgpu/przeladunek-gra.mjs …` (zegar krokowy harnessu, świat ruchu rozgrzany 40 min). Inne sesje
pracowały w tym czasie — szum bazy CPU workera ±0,3 ms.

| | wynik |
|---|---|
| koszt roju GPU: 1 stanowisko na żywo (`?przeladunekStres=1`), A/B z `?przeladunek=0`, po 2 przebiegi | CPU workera: kadr 2600 j. 1,40 / 1,26 → 1,85 / 1,58 ms (+0,39), kadr 9000 j. 2,96 / 3,10 → 3,67 / 3,88 ms (+0,74); GPU passów: 0,27 / 0,28 → 0,30 / 0,30 ms (+0,03), 0,53 / 0,56 → 0,65 / 0,56 ms (+0,06) |
| koszt: 14 stanowisk w kadrze (8 na żywo + 6 z zegara, `?przeladunekStres=20` — wszystkie pola zatoki) | CPU workera: kadr 2600 j. 1,93 / 1,77 ms (+0,52), kadr 9000 j. 3,80 / 3,66 ms (+0,70); GPU passów +0,09 ms (oba kadry) |
| skąd koszt CPU | prawie stały, gdy jest choć jeden slot: 16 dispatchy compute na klatkę (4 kernele × 4 kroki 1/60 s przy zegarze ×4 i 60 kl./s), odczyt stanu, rysunki roju (drony na klasę, światła, kontenery) i wieże; pojedyncze stanowisko dokłada mało (B1 ≈ B20) |
| GPU compute roju | nie mierzony w workerze (znaczniki compute wyłączone — `gpuComputeMs` 0); demo: 0,1–0,3 ms przy 100–180 dronach |
| ocena wobec budżetu orkiestratora (≤ 0,3 ms CPU, ≤ 0,3 ms GPU) | GPU w budżecie; CPU powyżej (+0,4–0,7 ms) — stały narzut symulacji na żywo. Proponowane N = 8 (koszt prawie płaski w N); cięcia: krok 1/30 s w grze (połowa dispatchy — zmienia dynamikę dema, wymaga porównania), scalenie kClear + kBin, odczyt rzadziej |
| przepustowość roju (stoły pod pokładem) | ciężki frachtowiec 37 L: 844 / 848 kontenerów w ~78 s postoju (rozładunek); kontenerowiec 6 M: załadunek 48 / 48 w ~45 s; zegar ×4 bez przyspieszania |
| dołączenie slotu (CPU, jednorazowo) | kontenerowiec ~0,5–1 ms, ciężki ~3–5 ms (po rozgrzaniu JIT; pierwszy raz do ~14 ms) — najwyżej 1 na klatkę |
| pipeline'y synchroniczne workera | 0 w trakcie gry we wszystkich przebiegach (kernele roju rozgrzewa `warm` kroku Core3D.fx) |
| błędy konsoli (strona i workery) | 0 |

### Po scaleniu kerneli, bramce i cieniach (ta sama metoda, po 2 przebiegi, `--kosztPoza 1`)

| | A (`przeladunek=0`) | B1 (`przeladunekStres=1`) | B14 (`przeladunekStres=20`: 14 w kadrze, 8 na żywo) |
|---|---|---|---|
| CPU workera, kadr 9000 j. | 3,31 / 3,54 ms | 3,23 / 3,38 (−0,12) | 3,45 / 3,66 (+0,13) |
| CPU workera, kadr 2600 j. | 1,39 / 1,77 ms | 1,61 / 1,56 (0,00) | 1,70 / 1,77 (+0,16) |
| CPU workera, poza portem (150 tys. j. od zatok, sloty zwolnione) | 0,98 / 1,05 ms | 0,94 / 0,88 (−0,10) | 1,02 / 0,94 (−0,04) |
| GPU passów, kadr 9000 / 2600 j. | 0,55 / 0,27 ms | +0,07 / +0,02 | +0,24 / +0,07 |
| GPU passów, poza portem | 0,147 ms | −0,008 | −0,008 |
| pula w pomiarze | — | 1 slot, w pracy 1, 4–8 kroków | 8 slotów, w pracy 6, 4–8 kroków; poza portem: 0 slotów, 0 kroków |

Narzut CPU roju spadł z +0,4–0,7 ms do szumu pomiaru (±0,2–0,4 ms między przebiegami A): 12 dispatchy zamiast 16
i odczyt bez statystyk (jedno polecenie kolejki i mapAsync mniej co drugą klatkę). Poza portem koszt = 0 (w szumie).
GPU przy 14 stanowiskach w szerokim kadrze +0,24 ms (jeden przebieg B14 0,86 ms — rozrzut), w bliskim +0,07 ms (przed
cieniami +0,09) — cienie dronów w szumie, zostają (1 rysunek, tylko gdy rój pracuje).

Równoważność kerneli (`scripts/webgpu/roj-stan-ab.mjs --krok`, demo, ten sam stan buforów po 600 klatkach sceny,
bez wieży): jeden krok — sceny `wymiana` (96 dronów) i `port` (180) bit w bit (drony, zadania, kontenery,
kolumny); `roj` (2048, gęsto) — 213 różnych liczb wobec 193 w A/A tego samego kodu (kolejność atomików w komórce).
4 kroki w jednym `renderer.compute` (jak klatka gry): `wymiana` bit w bit, `port` — 2 liczby (3,8e−6) tak samo
jak w A/A. Przebieg sceny po wielu klatkach rozjeżdża się już w A/A (odczyt asynchroniczny wieży) — nie dowodzi niczego.

Cienie: `.tmp/e12/v2-cienie/cienie-ab-M03.png` (siła 4 / 0 klatka po klatce — rufa pod dronem ciemnieje; w grze siła
0,5 jak w demie). Przebieg z kontraktem E6 bez flagi demo: `.tmp/e12/v2-wizual/` (ciężki frachtowiec, 0 błędów,
0 pipeline'ów sync), koszt: `.tmp/e12/v3-A1|A2|B1-1|B1-2|B20-1|B20-2/`.

Przebiegi: kontenerowiec LOAD + drugi UNLOAD (`.tmp/e12/gpu-kont8/`), ciężki frachtowiec UNLOAD
(`.tmp/e12/gpu-ciezki2/`, `gpu-ciezki3/`), koszt (`.tmp/e12/gk-A1|A2|B1-1|B1-2|B20-1|B20-2/`), „przed” w tej samej scenie
(`.tmp/e12/przed-kontenerowiec/`, `?przeladunek=0`), demo roju do porównania (`.tmp/e12/demo-roj/11-wymiana*.png`).
Pierwsza wersja z planem analitycznym: `.tmp/e12/po-*`, `koszt-*`.

## Runda 3 — przegląd kodu przed scaleniem (2026-10-22)

Znaleziska przeglądu orkiestratora — wszystkie potwierdzone w kodzie, poprawione, regresje w `tests/portCargo.test.mjs`
(każda pada na puli sprzed poprawki):

1. `snap()` wysyłał cały zakres jednostek slotu ze starej kopii CPU (przeniesione kontenery wracały) i parkował drony
   bez pierścienia zadań. Teraz `snap` nie istnieje: koniec okna = wieża bez nowych zadań, drony lądują, ładownia chowa
   się za domkniętymi wrotami; wysyłka tylko oznaczonych jednostek (`uploadMarked`), parkowanie z pierścieniem
   (`parkSlotDrones`); taśma pisze cały rekord z księgi wieży (kurs i ładownia światła też były stare).
2. Slot w fazie `capture` (poza w drodze na stanowisko) — bit `OP_CAPTURE` bloku, slot dopiero po przechwycie.
3. Odczyt poprzedniego właściciela slotu po wywłaszczeniu w tej samej klatce — `statusFrom` (odczyt ważny od polecenia
   po dołączeniu; wcześniej zerowy).
4. Resztki slotu na cudzym stanowisku (referencja do rekordu ramki z puli) i krok GPU stający przy slocie bez stanu —
   własna kopia stanowiska, slot bez stanu liczy się do pracy; poza kadrem zwolnienie od razu, w kadrze domknięcie.
5. `ensure()` wchodzący drugi raz (addFxStep → rozgrzewka → ensure przed `ready`) — 30 obiektów zamiast 15; `ready`
   przed rejestracją kroku.
6. Alokacje w klatce: napis-klucz `containerLookLinear` na kontener z zegara (pamięć wariantów `lookOf`), tablice
   w `bayBatch.end()`, literały w puli.
7. `?przeladunek=0` rozgrzewał i kompilował — worker nie importuje modułu, tryb off czyta flagę przez `RenderWorld`.
8. Kamery 3D: wpis rozgrzewki `ortho: false`; ładunek w luku Atlasa gaśnie z maskowaniem (próg luku).

Znalezione przy weryfikacji:
- **Gniazda pod kadłubem** — 24 kolumny gniazd ciężkiego frachtowca (96 dronów) wchodziły pod sylwetkę kadłuba; 20 dronów
  krążyło w `RETURN` bez końca, slot nie kończył (przy 48 dronach ten sam statek kończył się `snap`). Gniazda w więcej
  rzędach (`padColsMax` 12), gniazdo z przeszkodą nad wejściem bez drona; test dla każdego kadłuba ruchu.
- **Skok przy domknięciu wrót** (od rundy 1, na końcu każdego postoju): zamknięte skrzydła zamieniały się na skórę sprite'a
  w jednej klatce (różnica sąsiednich klatek 12,3 wobec ~1). Teraz przenikanie ditheringiem przez czas domkniętych
  skrzydeł (ostrzeżenie + zamki, u ciężkiego 1,6 s): proxy pokazuje skórę, skrzydło odpada w tych samych pikselach —
  różnice 2–3 przez 7 klatek, bez piku (`.tmp/e12/v7-koniec/przenikanie.png`).
- **Statek E6 znika ze stanowiska w jednej klatce przy odlocie** (różnica 37,6, cały kadłub) — po stronie bańki, nie
  przeładunku.

**Ciężki frachtowiec, 96 dronów (decyzja orkiestratora):** 1320 / 1320 kontenerów w ~60 s postoju, rój kończy ~65 s,
domknięcie wrót bez skoku (`--koniec 1`, zrzuty co 0,25 s: `.tmp/e12/v7-koniec/50-koniec-*.png`).

**Koszt** (A/B jak w rundzie 2, w ciszy innych sesji, po 2 przebiegi; `.tmp/e12/v5-*`):

| | A (`przeladunek=0`) | B1 | B14 (8 na żywo, 6–7 w pracy) |
|---|---|---|---|
| CPU workera, kadr 9000 j. | 3,62 / 3,43 ms | 2,73 / 2,89 | 2,67 / 2,71 |
| CPU workera, kadr 2600 j. | 1,29 / 1,18 ms | 1,19 / 1,49 | 1,24 / 1,24 |
| CPU workera, poza portem | 0,84 / 0,69 ms | 0,68 / 1,18 | 0,64 / 0,65 |
| GPU passów, kadr 9000 / 2600 / poza | 0,59–0,54 / 0,28–0,27 / 0,15–0,14 | +0,02 / +0,01 / 0 | +0,05 / +0,06 / 0 |

CPU w szumie; GPU przy 14 stanowiskach i 96 dronach na slot +0,06 ms (budżet ≤ +0,35).

**Ładowanie** (`start-sync-gra.mjs --query renderWorker=1`, Start od razu po wstaniu strony — najgorszy przypadek):
przed rundą rejestr miał w fazie `'loading'` 24 siatki przeładunku (147 ms CPU, wpis gotowy po 5,1 s pracy procesu GPU)
i pulę z kernelami (`ensure` 26 ms, kernele 5 / 127 / 10 ms CPU). Faza `'after'` nie pomaga: w workerze rusza już w menu
(pierwszy flush), a flush po „Start” czeka na pipeline'y w locie. Teraz: ekran ładowania — 1 siatka (taśmy, stoły,
portale); menu (`'after'`) — pula i kernele (CPU, bez pipeline'ów); ładownie, kontenery i siatki roju — na żądanie, przy
pierwszej ramce przeładunku, rysunek po rozgrzaniu (statki do tego czasu z zamkniętymi wrotami, bez roju). Drugi flush:
z przeładunkiem 1735 / 1255 ms, bez 1514 / 814 ms — parami +0,22 / +0,44 s (średnio +0,33), przy rozrzucie samych
przebiegów bez przeładunku 0,7 s. Dalszy krok, jeśli trzeba: kernele też na żądanie — kosztem jednego przestoju ~140 ms
przy pierwszym podejściu do portu.

Przegląd portów `ruch-banka-gra.mjs --obserwacja 8`: 0 pipeline'ów sync (worker i off), 0 błędów (`.tmp/e12/v7-banka/`).
W jednym przebiegu start-sync **bez** przeładunku worker skompilował synchronicznie `HallDustBack` / `HallDustFront`
(pył hal K-7) — poza E12.

## Runda 4 — „ogromny transportowiec i tylko kilka dronów” (zgłoszenie użytkownika, 2026-10-23)

Przyczyny (po scaleniu `main` z E15):
1. **Megafrachtowiec ruchu nie miał ładowni.** Kurs `megafreighter` (jeden sprite składu 2760 j., nie pociąg wagonów)
   nie był w `TRAFFIC_CARGO_BAY_HULLS` — 0 dronów; drony przy nim należały do sąsiednich stanowisk. Teraz kadłub
   `megafreighter` (pusty wariant sprite'a, jedna ładownia na dwa rzędy luków z grzbietem, 7128 kontenerów 33 × 27).
   Pole MEGA było dla niego za wąskie: stoły na ±318 j., kadłub ±456 j. — gniazda pod kadłubem (64 zablokowane).
   Plac stoi teraz za burtą najszerszego statku przy polu, a mapa przeszkód bez maski sprite'a bierze szerokość
   kadłuba (`beamPx`), nie płótna.
2. **Ciężki frachtowiec przy niskim wypełnieniu dostawał kilka dronów.** Kursy ciężkich niosą typowo 4–26% ładowni,
   a wzór liczył drony z warstw do przeniesienia: 4% → 6 dronów przy kadłubie 2000 j. Najmniej dronów idzie teraz
   z wielkości statku: 0,6 × √(kontenery ładowni), nie więcej niż warstw do przeniesienia, w limicie 96.
3. **Obcinanie kontenerów:** slot mieścił 1536 jednostek — pełny ciężki (3040) pokazywał połowę ładunku. Teraz 3072
   (pełny ciężki bez obcinania, megafrachtowiec do ~43%, nadmiar w `stats.unitsCut`).
4. **Pierwszeństwo do slotu** szło tylko po odległości od środka kadru — przy 4 slotach Średniej olbrzym przegrywał
   z kontenerowcem bliżej środka. Teraz odległość jest ważona wielkością ładowni (`op._prio`), a przy pełnej puli
   duży statek wywłaszcza slot ≥ 4× mniejszego, który nie pracuje (rój przed startem albo po końcu — drony w gniazdach).

Drony na slot (UNLOAD 120 s, `byTime` = reszta w oknie, „przed” = wzór bez `bySize`; megafrachtowiec przed rundą — 0):

| kadłub | kontenery | wypełnienie | warstwy | gęstość | byTime | bySize | przed | po | gniazda | zablok. | obcięte |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prom | 2 | 1 | 2 | 1 | 1 | 1 | 2 | 2 | 4 | 0 | 0 |
| kontenerowiec | 56 | 1 / 0,5 | 28 / 14 | 4 / 2 | 5 / 3 | 4 | 5 / 3 | 5 / 4 | 8 / 4 | 0 | 0 |
| dalekiego zasięgu | 108 | 1 / 0,5 | 54 / 27 | 7 / 4 | 9 / 5 | 6 | 9 / 5 | 9 / 6 | 12 / 8 | 0 | 0 |
| ciężki | 3040 | 1 | 760 | 95 | 133 | 33 | 96 | 96 | 96 | 0 | 0 (było 1504) |
| ciężki | 3040 | 0,25 / 0,14 / 0,04 | 190 / 107 / 31 | 24 / 14 / 4 | 34 / 19 / 6 | 33 / 33 / 31 | 34 / 19 / 6 | 34 / 33 / 31 | 36 / 36 / 32 | 0 | 0 |
| megafrachtowiec | 7128 | 0,4 / 0,2 | 713 / 357 | 90 / 45 | 125 / 63 | 51 | — (0) | 96 / 63 | 96 / 66 | 0 | 0 |

W grze (`przeladunek-gra.mjs`, tryb gracza; harness czeka na rozgrzewkę świata E15 i stawia gracza 7000 j. od pola):
- ciężki frachtowiec Z06-MG1, wypełnienie 1: 96 dronów, 2188 / 3040 kontenerów do odlotu (resztki za domkniętymi
  wrotami), `.tmp/e12/v10-ciezki/`;
- megafrachtowiec Z02-MG2, rozładunek 7%: 51 dronów, 524 / 524 w ~57 s, rój kończy, wrota domknięte,
  `.tmp/e12/v10-mega/` (plac i gniazda za burtą, ładownia w obrysie luków);
- 0 pipeline'ów sync, 0 błędów strony i workera w obu.

Koszt (bez ciszy innych sesji, po 1–2 przebiegach, `--tylkoKoszt 1 --kosztPoza 1`; `.tmp/e12/v11-*`): GPU passów
w kadrze 9000 j. — A 0,633 ms, B14 0,742 (drugi przebieg; pierwszy 1,43 — odstający jak w rundzie 2), B14 z dawnym
`unitsPerSlot` 1536 — 0,742, B14 z pojemnością 3072, a treścią obciętą do 1536 — 0,741: puste instancje nic nie
kosztują, narzut +0,11 ms (budżet ≤ +0,35). Kadr 2600 j.: A 0,28, B14 0,40 (+0,12). CPU workera w szumie przebiegów
bez ciszy (A 3,8 ms, B14 4,3–5,0 ms w kadrze 9000).

## Runda 5 — „dwa capitale w doku, jeden rozładowywany, drugi bezczynny” (zgłoszenie użytkownika, 2026-10-26)

**Odtworzenie** (`przeladunek-gra.mjs --dwa 1`, ziarno ruchu 7, zatoka Z-02 Ziemi; ta sama para w każdym przebiegu):

| statek | pole | tryb | wypełnienie | slot | dlaczego tak wygląda |
|---|---|---|---|---|---|
| megafrachtowiec 3336 | Z02-MG2 | rozładunek | 7% (512 kontenerów) | tak, 50–51 dronów | pracuje ~40 s, kończy 512 / 512 |
| ciężki frachtowiec 4144 | Z02-MG1 | załadunek | 1% (24 kontenery, ~9 t z 900 t) | tak | 24 kontenery to kilka kursów: 6 dronów L (runda 4), wrota otwarte do końca okna przy prawie pustej ładowni — „stał bezczynny i wyleciał” |

Pula slotów nie była zajęta (Wysoka: 3 sloty z 8), pole ma plac, slot powstał po przechwycie. To ekonomia (kurs niesie 1% ładowni), nie błąd przydziału. Inne przypadki „bezczynnego” olbrzyma na polu MEGA (świat ruchu w Node, 40 min przy Ziemi po rozgrzewce): odlot po rozładunku (faza `undock`, `DEPARTED`) i etap lotu po załadunku — kilkanaście sekund z zamkniętymi wrotami; promy z ludźmi (`crew-large` na sprite'cie frachtowca dalekiego zasięgu) — postój 60 s bez dronów z założenia (ludzie wchodzą rękawem). Wypełnienia kursów: ciężki rozładunek p50 0,75 (47% kursów ≥ 0,9), załadunek p50 0,07 (29% ≥ 0,9); megafrachtowiec p90 0,15.

**Okno postoju:** kursy w zatokach mają `move` = 45 s dojścia z postoju — przy stanowisku zostaje 75 s (rozładunek) i 45 s (załadunek); rój pracuje ~56 s i ~26 s gry (×4 — 225 i 105 s roju).

**Wystarczalność przed rundą** (`--proba unload|load --move 45`, pełna ładownia, `.tmp/e12/r5-proba-*`):

| kadłub | rozładunek | załadunek |
|---|---|---|
| prom, kontenerowiec, dalekiego zasięgu | 100% | 100% |
| ciężki (3040, drony L ×96) | 70,7% | 37% (plac mieścił 2528 — 512 kontenerów nie powstawało) |
| megafrachtowiec (slot 3072, L ×96) | 68% | 34% |

Plac pola MEGA miał 79 stołów 2 × 2 na burtę × 4 poziomy = 632 warstwy przy 760 warstwach pełnego ciężkiego — rozładunek nie mógł przekroczyć ~83% niezależnie od dronów. Tempo 96 dronów L: ~43 kontenery / s gry w obu trybach.

**Zegar roju gubił czas (błąd, poprawiony):** pula NADPISYWAŁA czas gry do kroku (`pendingDt = dt × 4`), a krok `Core3D.fx` idzie raz na klatkę rAF — gdy worker przetworzył kilka stron migawki na jedną klatkę rAF, czas przepadał. W harnessie rój szedł w 59–87% tempa gry (wiersz „zegar roju” próby), w grze — tyle, ile stron przypadało na klatkę rAF workera. Teraz czas się sumuje (test „regresja runda 5”). Próby z tabeli niżej przed poprawką mierzyły rój w ~87% tempa — wnioski o liczbie dronów są z nich, liczby końcowe — po poprawce.

**Próby przed poprawką zegara** (ciężki / megafrachtowiec, pełna ładownia, rój ~0,87 tempa):

| wariant | rozładunek | załadunek |
|---|---|---|
| moduł 4 × 2, Capital ×96 | 96,9% / 88,5% | 55% / 50,5% |
| + start załadunku z otwarciem wrót | — | 55,6% / 52,3% |
| Capital ×160 | 90% / 79,9% (tłok nad ładownią) | 87,5% / 81,5% |
| Capital ×192 | — | 89,7% / 85,2% |
| ×160 + ładunek na stołach najbliżej ładowni (pełne stosy) | — | 89,2% / 83,9% |
| ×160 + ładunek poziomami na stołach najbliżej ładowni | — | 91,7% / — |

**Wynik końcowy** (po poprawce zegara, `--krokiMax 64` — „zegar roju” 0,999–1,001; `.tmp/e12/r5-k64-*`; rozładunek do 96 dronów, załadunek do 192):

| kadłub | drony | rozładunek | drony | załadunek |
|---|---|---|---|---|
| prom | 2 | 100% | 2 | 100% |
| kontenerowiec | 8 | 100% | 15 | 100% |
| dalekiego zasięgu | 16 | 100% | 28 | 100% |
| ciężki (2880) | 96 C | **100%** | 192 C | **97,2%** |
| megafrachtowiec (slot 3072 z 6912) | 96 C | **98,7%** | 192 C | **100%** |

Przy 160 dronach po poprawce: załadunek ciężkiego 93,9%, megafrachtowca 97,4%.

**Mały ładunek na olbrzymie:** z modułem 4 × 2 kurs 1% dostawał 3 drony Capital i robił je do końca okna — teraz drony L (podbloki 2 × 2), gdy zdążą w oknie z 96 dronami: ciężki 25% rozładunku — 57 L, 720 / 720 w ~45 s; 1% załadunku — 8 L, 32 / 32 w ~22 s (wcześniej ładunek leżał w dwóch stosach na stołach od rufy i 6 dronów brało go po kolei przez całe okno); wrota zamykają się po pracy.

**Wygląd przy presetach** (`--dwa 1 --flaga grafika=…`, ta sama para): Wysoka i Średnia — oba statki ze slotem (3 sloty w użyciu), Niska — oba w stanie z zegara (wrota otwarte, ładunek ubywa, bez dronów); 0 pipeline'ów sync, 0 błędów. `.tmp/e12/r5-dwa-*`.

**Koszt** (A/B po kolei, bez ciszy innych sesji, po 1 przebiegu; `.tmp/e12/r5-koszt-A|B20`; B14: 8 slotów w pracy — ciężkie 0,85, załadunek 192 Capital, rozładunek 96):

| | A (`przeladunek=0`) | B14 | różnica |
|---|---|---|---|
| GPU passów, kadr 9000 j. | 0,595 ms | 0,806 ms | +0,21 |
| GPU passów, kadr 2600 j. | 0,301 ms | 0,564 ms | +0,26 |
| GPU passów, poza portem | 0,139 ms | 0,146 ms | 0 |
| CPU workera, kadr 9000 / 2600 j. | 3,34 / 1,49 ms | 3,80 / 2,04 ms | +0,46 / +0,56 |

GPU w budżecie (≤ +0,35). CPU workera rośnie, bo po poprawce zegara rój liczy pełne tempo (4 kroki na klatkę zamiast obciętych) i wieża prowadzi do 192 dronów — przy 14 stanowiskach naraz; typowy port ma mniej pełnych olbrzymów w kadrze.
## Ryzyka i dalsze kroki

- **Pełny załadunek ciężkiego frachtowca** (29% kursów załadunku ≥ 0,9) — rój przenosi ~97% w oknie, resztę taśma wywozi z placu po zamknięciu wrót. Rój przy < 30 kl./s workera zwalnia (`maxSteps` na klatkę) — wtedy olbrzymy nie zdążą.

- **Megafrachtowiec ponad ~44% wypełnienia** nie mieści się w slocie (3072 z 6912) — nadmiar ładowni jest pusty
  (`stats.unitsCut`). Kurs megafrachtowca w przebiegu harnessu niósł 7% ładowni.

- **Wydajność wieży i ORCA w grze** zmierzona na 2 typach statków; prom i frachtowiec dalekiego zasięgu bez osobnego
  przebiegu harnessu. Zmierzone tempo (~60 s roju na kurs warstwy) siedzi w `swarmSecPerLayer`.
- **Koniec okna, gdy rój nie zdążył:** resztki LOAD wraca taśma do portalu (widać, ale bez skoku), resztki UNLOAD
  chowają się za wrotami. Ostateczność (`freezeTimeout` 25 s bez powrotu dronów) chowa drony slotu naraz.
- **Ładownie pojawiają się po rozgrzewce na żądanie** — przy pierwszym podejściu do portu przez chwilę statki mają
  zamknięte wrota, a stanowiska są bez roju.
- **Wyjątek w workerze może nie dotrzeć do strony** (limit 20 raportów na sesję) — `stats.err` modułu i `--diag 1`.
- Pomosty portów bez ringu (Merkury, Wenus, księżyce, Ceres, Westa…) przeładunku nie mają — potrzebują własnej
  geometrii placu (wpisy w `PORT_CARGO_PADS` / `bayBerthSize` i `berthYardGeometry`).
- Cieni kontaktu kontenerów nie ma (kontenery w grze stoją pod płaszczyzną cieni — ładownia, stoły na z −16).
