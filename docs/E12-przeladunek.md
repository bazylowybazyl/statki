# E12 — przeładunek w portach: ładownie, rój dronów, taśmociągi

Zadanie E12 z `docs/PLAN-ekonomia-rynki.md` (§ 8), 2026-10-22. Polecenie użytkownika: „potrzebujesz jeszcze jednej
sesji, która wdroży roje przeładunkowe i taśmociągi; jest demo ładowni — trzeba dać ładownie”. Stan i zasady obszaru:
reguła `przeladunek-portow` (`.claude/rules/przeladunek-portow.md`). Ten dokument trzyma decyzje, pomiary i ryzyka.

## Co jest w grze

- **Ładownie frachtowców ruchu** przy stanowiskach zatok Ziemi (bańka E6): po klamrze wrota kieszeniowe rozjeżdżają
  się (przebieg i wygląd z dema ładowni — `cargoBayDoorTimeline`, `bay.tsl.js`), skóra proxy ma w otworze dziurę,
  pod nią wnętrze z ładunkiem. Wrota zamykają się, gdy ostatni dron wyjdzie z ładowni.
- **Rój dronów** (model, klasy S / M / L, chwyty płaskie 1 / 2 / 4, ramiona teleskopowe, światła, LOD — 1:1 z dema
  roju) przenosi warstwy kontenerów między ładownią a **stołami przeładunkowymi** po obu burtach. Klasa drona z obrysu
  modułu ładowni: prom — S, kontenerowiec i frachtowiec dalekiego zasięgu — M, ciężki frachtowiec — L.
- **Taśmociągi** wzdłuż placu po obu burtach wiozą kontenery do **portalu w grzbiecie zatoki** (UNLOAD) albo z niego
  na stoły (LOAD); listwy pasa jadą z zegarem roju, portal świeci bursztynową listwą (HDR — bloom).
- **Liczba kontenerów = ładunek kursu** (widok liczby): kontenery ładowni × wypełnienie (masa ładunku / ładowność klasy
  kursu) z kontraktu workera ruchu (`actors.cargo`, niżej). UNLOAD — ładownia pełna na starcie okna, LOAD — pusta.
- **Luk Atlasa** otwiera się przy postoju na polu stanowiska (`berth-hold`) albo przy otwartym terminalu stacji
  i pokazuje ładunek gracza (`PLAYER.cargo`: wypełnienie z masy, wygląd z surowców wg udziałów masy); pole myśliwców
  i stanowisko fregaty zwiadu (gdy w luku) zostają wolne — „okręty zabierają miejsce ładunkowi”.
- Hale K-7: bez przeładunku — cumuje tam tylko garnizon (REFUEL) i zapas floty (decyzja orkiestratora: OK).

## Decyzje

- **Plan analityczny zamiast symulacji GPU z dema** (orkiestrator 2026-10-22: przyjęty TYMCZASOWO, do decyzji
  użytkownika — „symulację dronów chcę do gry wdrożyć na prędkości ×4”). Powody: stanowiska pojawiają się i znikają
  w bańce, a statek zmaterializowany w połowie postoju musi od razu mieć właściwy obraz (symulacja musiałaby dogrywać
  postój od przechwytu); zero kerneli compute i odczytów MAP_READ w workerze renderu; koszt rośnie z liczbą dronów
  w kadrze, nie z portem. Warunki orkiestratora: (1) ruch wygląda jak w demie — te same parametry lotu
  (`SWARM_DRONE_CLASSES.flight`, z ładunkiem × 0,85 / × 0,75), profile przyspieszenia, czasy chwytu i odłożenia,
  rozkładanie ramion i zacisk szczęk wzorami kernela, zegar roju × 4 — test `tests/portCargo.test.mjs`;
  (2) interfejs pod symulację GPU: obraz czyta przeładunek tylko przez `berthTransferState(plan, dockTime, sink)`
  (`door`, `drone`, `layer`, `belt`) — źródło z dema (ORCA, wieża) musi dać te same rekordy; (3) porównanie z demem —
  niżej.
- **Tory bez krzyżowania**: drony burty dostają ciągłe przedziały slotów wzdłuż osi statku (granica tylko między
  slotami — LIFO ładowni), burty rozdziela oś, sąsiednie drony w dwóch pasmach wysokości. ORCA niepotrzebna.
- **Plac = stoły + taśma** (nie stosy jak w demie): stół trzyma jedną warstwę, warstwa zsuwa się na taśmę (UNLOAD) albo
  z niej (LOAD); taśma ma komórki (jedna warstwa na komórkę). Stoły rozstawione na polu (infrastruktura portu — rysują
  się przy każdym polu zatoki w kadrze, także bez statku), stół = obrys warstwy dla klasy pola.
- **Ciężki frachtowiec ruchu** rysuje się sylwetką dalekiego zasięgu w skali 1800 j. (`TRAFFIC_HULLS.heavy_freighter`,
  TODO AGENT tam) — ładownia `heavy_freighter_proxy` w `cargoBays.js` leży na TYM obrazku (moduły 2 × 2 × 2, drony L).
- **Liczba dronów — gęstość jak w demie** (wymiana frachtowca: 96 dronów L na 760 kursów, ~1 dron na 8 kursów): co
  najmniej 1 dron na 8 warstw burty, więcej, gdy praca nie mieści się w ~62% okna, najwyżej 16 na burtę (`maxPerSide`).
  Kontenerowiec: 3–4 drony M, frachtowiec dalekiego zasięgu: 8 M, ciężki: 32 L (1320 kontenerów — sylwetka ruchu;
  w demie pusty pokład Z11 ma 3040). Gdy okno jest za krótkie nawet przy limicie, rój dostaje skalę
  `speedScale` (ciężki LOAD: 1,06 — zegar ×4,2); taśma pasa MEGA × 1,8 (inaczej przepustowość taśmy wyznacza czas).
- **Partie, nie rig na statek**: wnętrza i skrzydła floty — jeden rysunek na kadłub (`bayBatch.tsl.js`, fragmenty
  wspólne z rigiem luku Atlasa), kontenery — jeden rysunek, drony — rysunek na klasę i LOD, światła dronów — na klasę,
  taśmy / stoły / portale — jeden rysunek.

## Kontrakt danych z E6 (`actors.cargo`)

Uzgodniony z orkiestratorem (E6 robi zmiany w bańce): osobna tablica obok `data` w wiadomości `actors` (bez zmiany
`ACTOR_STRIDE`), Float32Array, krok 8, rekord na encję przy stanowisku: numer kursu, tryb (1 LOAD, 2 UNLOAD, 0 inne),
`stage.seconds`, `stage.moveSeconds`, indeks surowca w `resources`, wypełnienie (masa / ładowność klasy kursu), sztuki,
flagi. Koder: `src/game/traffic/bubbleCargo.js` (`writeBubbleCargo` — gotowy dla E6), dekoder gry:
`syncPortCargoContract` (`src/game/portCargoFrame.js`), test w `tests/portCargo.test.mjs`. **Stan na koniec E12:
po stronie workera ruchu niewpięte** — do tego czasu obraz przeładunku pokazuje się tylko z `?przeladunekDemo=1`
(tryb, wypełnienie i surowiec z ziarna kursu). Statki bez kontraktu stoją z zamkniętymi wrotami, pola mają stoły
i taśmy.

## Pomiary (2026-10-22, RTX 5080, headless Chrome 1600 × 900, tryb gracza `renderWorker=1`, ziarno ruchu 7)

`node scripts/webgpu/przeladunek-gra.mjs …` (zegar krokowy harnessu, świat ruchu rozgrzany 40 min). Inne sesje
pracowały w tym czasie — szum bazy CPU workera ±0,27 ms w kadrze szerokim.

| | wynik |
|---|---|
| koszt obrazu, 14 jednoczesnych przeładunków (`?przeladunekStres=20` — wszystkie pola zatoki w kadrze: 2 ciężkie, 4 dalekiego zasięgu, 4 kontenerowce, 4 promy, stoły i taśmy 14 pól), A/B/A/B z `?przeladunek=0` | CPU workera renderu: kadr 9000 j. 2,47 / 2,74 → 2,76 / 2,72 ms (+0,13 ms), kadr 2600 j. 1,05 / 1,08 → 1,19 / 1,30 ms (+0,18 ms); GPU: 0,56 / 0,54 → 0,57 / 0,60 ms (+0,03), 0,272 / 0,268 → 0,279 / 0,276 ms (+0,008) |
| to samo po zagęszczeniu roju jak w demie (~110 dronów w kadrze, światła dronów jednym rysunkiem), maszyna obciążona (baza CPU 2,5 → 3,2–3,4 ms) | CPU workera: kadr 2600 j. +0,11 / +0,37 / +0,56 ms (B − A w parach A3 / B23, A5 / B25, A5 / B24), kadr 9000 j. −0,26…+0,99 ms (szum ±1 ms); GPU +0,01–0,05 ms |
| własna ścieżka CPU obrazu (Node, `.tmp/e12/bench.mjs`: 14 przeładunków, stan w klatce + rekordy 2158 kontenerów i 76 dronów) | 0,063 ms na klatkę |
| skąd reszta CPU workera | rysunki three (~15–25 µs każdy): w obciążeniu 14 — ładownie 4 rodzaje × 2, kontenery, taśmy, drony 3 klasy, światła 1; w zwykłym kadrze (1–3 statki, 1–2 kadłuby) 6–8; plus wysyłka bufora kontenerów (~170 KB na klatkę przy 2158 kontenerach) |
| ocena wobec budżetu (20 statków: ≤ 0,3 ms CPU, ≤ 0,3 ms GPU) | GPU w budżecie z zapasem; CPU w spokojnym pomiarze w budżecie (+0,13–0,18 ms przy 14), w obciążonym — na granicy i powyżej, głównie narzut rysunków. Dalsze cięcia: wnętrza ładowni wszystkich kadłubów jednym rysunkiem (wymiary w instancji: −3 rysunki), stałe regiony kontenerów na statek z wysyłką tylko zmienionych zakresów (ładunek w ładowni stoi) |
| plan na stanowisko (Node, raz na kurs w kadrze, ≤ 1 nowy plan na klatkę) | prom 0,1–2 ms (pierwszy — JIT), kontenerowiec 0,3–1,5 ms, dalekiego zasięgu 0,8–1,4 ms, ciężki 3,2–5,1 ms |
| stan w klatce (Node, na statek) | kontenerowiec 2–8 µs, dalekiego zasięgu 7–15 µs, ciężki 17–50 µs (+ wpis kontenerów do partii) |
| rysunki | ładownie: 2 na kadłub w kadrze; kontenery 1; drony 1 na klasę + światła 1 na klasę; taśmy 1 |
| pipeline'y synchroniczne workera | 0 w trakcie gry (wszystkie przebiegi); na starcie 0 (raz 1 — `SpaceDust` przy zimnym starcie Vite, znane z E6) |
| błędy konsoli (strona i workery) | 0 |

Przebiegi: kontenerowiec LOAD (`.tmp/e12/po-kontenerowiec/`), ciężki frachtowiec UNLOAD (`.tmp/e12/po-demo3/`),
zatoka i luk Atlasa (`40-luk-atlasa.png`), koszt (`.tmp/e12/koszt-A0|B20|A1|B21/`), „przed” w tej samej scenie
(`.tmp/e12/przed-kontenerowiec/`, `?przeladunek=0`), demo roju do porównania (`.tmp/e12/demo-roj/`).

## Ryzyka i dalsze kroki

- **Kontrakt E6 niewpięty** — bez niego przeładunku nie widać (tylko `?przeladunekDemo=1`).
- **Plan ciężkiego frachtowca 3–5 ms** w jednej klatce workera, gdy taki statek pierwszy raz wejdzie w kadr (raz na kurs).
  Dalszy krok: plan w kawałkach w czasie bezczynności (`harmonogram.requestIdle`) albo prostszy plan dla dalekiego kadru.
- **Statek opuszcza stanowisko wcześniej niż okno planu** (np. przeniesienie przez `berth-hold`) — drony w locie znikają
  z kadru razem z przeładunkiem (pop).
- Bańka żyje tylko przy Ziemi — porty, które doda E6, dostaną przeładunek, jeśli ich stanowiska mają id zatok
  (`…-MG1`, `…-L01`…) albo nowe wpisy w `PORT_CARGO_PADS` (klasa pola z id, `bayBerthSize`).
- Symulacja GPU z dema (ORCA, wieża) — do decyzji użytkownika; interfejs źródła jest gotowy.
- Cienie dronów i kontenerów na kadłubie (`SwarmShadows`, `shadows.tsl.js`) nie są wpięte — w demach są.
