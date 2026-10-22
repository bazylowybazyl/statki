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
  wymagałyby podwójnej siatki z parzystością na GPU, przy czym pozy pisane z CPU (dołączenie, zaparkowanie, `snap`)
  zostawiałyby siatkę nieaktualną na krok.
- **Statek zastany w połowie postoju:** stan startowy z zegara — warstwy przeniesione = postęp postoju (UNLOAD na
  stołach, LOAD w ładowni), reszta czeka u źródła. Drony startują z gniazd (pierwsze 1–2 s to start roju) — bez
  przewijania symulacji. **Koniec okna** przed końcem pracy → `snap`: czekające i niesione kontenery znikają, drony
  slotu się chowają, wrota się zamykają — ładownia przy odlocie jest pełna / pusta zgodnie z ekonomią.
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

## Ryzyka i dalsze kroki

- **Ciężki frachtowiec z prawdziwym kontraktem nie mieści się w oknie**: kontrakt E6 daje mu 1320 kontenerów (dane
  demo dawały 848); 48 dronów na slot przenosi ~970 do zamknięcia wrót, resztę (~350) `snap` chowa naraz — skok
  obrazu raz na postój. Do decyzji: więcej dronów na slot dla MEGA (pula 8 × 96 — pamięć i GPU symulacji), dłuższy
  postój ciężkich kursów (świat ruchu, E6 / E2) albo zgoda na skok.
- **Wydajność wieży i ORCA w grze** zmierzona na 2 typach statków; prom i frachtowiec dalekiego zasięgu bez osobnego
  przebiegu harnessu. Zmierzone tempo (~60 s roju na kurs warstwy) siedzi w `swarmSecPerLayer`.
- **Snap na końcu okna** (rój nie zdążył) to skok obrazu — rzadki przy obecnej liczbie dronów, ale możliwy przy
  statku zastanym tuż przed końcem postoju (wtedy slotu się nie zakłada: ostatnia sekunda okna — stan z zegara).
- **Wyjątek w workerze może nie dotrzeć do strony** (limit 20 raportów na sesję) — `stats.err` modułu i `--diag 1`.
- Pomosty portów bez ringu (Merkury, Wenus, księżyce, Ceres, Westa…) przeładunku nie mają — potrzebują własnej
  geometrii placu (wpisy w `PORT_CARGO_PADS` / `bayBerthSize` i `berthYardGeometry`).
- Cieni kontaktu kontenerów nie ma (kontenery w grze stoją pod płaszczyzną cieni — ładownia, stoły na z −16).
