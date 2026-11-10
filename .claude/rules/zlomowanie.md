---
paths:
  - "src/game/scrapPlan.js"
  - "src/game/scrapProcess.js"
  - "src/data/scrapRigs.js"
  - "src/game/trafficSalvage.js"
  - "src/3d/trafficWork3D.js"
  - "src/render/blocks/trafficWorkBlock.js"
  - "scripts/webgpu/zlomowanie-gra.mjs"
  - "tests/scrapPlan.test.mjs"
  - "tests/scrapProcess.test.mjs"
---

# Złomowanie jako proces: plan cięć, wysięgniki z laserami, sekcje, paszcza

> Reguła obszaru. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Złomiarze NPC w bańce (kto i kiedy pracuje, rejestr wraków gry, hol) — reguła `ruch-banka`, „Praca w bańce”; wraki — `wraki`; silnik belek (rzaz, rozpad) — `kadluby-belki`. Tu stan i zasady w czasie teraźniejszym; historia i pomiary — `docs/`.

## Decyzje użytkownika (2026-11-10)

- Złomowanie ma być „sztuką”, całym procesem — fizycznym, z bliska. Dawne cięcie (`cutOuterNode`: laser z kilometra, wrak znika od krawędzi) było „sucho, daleko, niefizycznie”. Holowanie — dopiero po złomowaniu.
- Najpierw POKAZ złomiarza NPC w scenie `?scena=holowanie`; sterowanie gracza później. Pomysł gracza: LPM „maluje” na wraku linie cięć, dźwigi podchodzą i tną wszystko naraz; „komputer złomiarski” pokazuje, jak ciąć; złe cięcie psuje część.
- Kolejność prac docelowo: złapać i usztywnić wrak → wypompować paliwo → zdemontować silniki, reaktor, bronie → pociąć kadłub.
- Odcięte sekcje łapie dźwig albo drony. Jeden statek może mieć różne gniazda — lasery i dźwigi: tnie, łapie i ładuje do własnej ładowni albo do statku obok.
- Laser tnący i dźwig to sprzęt w ZWYKŁYM gnieździe broni + program złomowania (nie nowy typ gniazda).
- Statki (do zrobienia, najpierw generator kadłubów): ładownia na środku ładowana dźwigiem OD GÓRY; statek z „paszczą”, która się otwiera i „zjada” cały wrak; młyn — daje ZŁOM (nie stal), obok niego statek-rafineria; frachtowiec z rampą jak w samolocie transportowym (wpychają holowniki / drony); statek-dźwig z damperami i wysuwanym dźwigiem. „Od góry” i „rampą / paszczą” to różne rzeczy.
- Czas pracy fizyczny, zależny od masy wraku; ekonomię trzeba do tego dograć. Limit wolnych sekcji, drobnica od razu w odłamki.
- Wysięgniki i drony: skłonność do „razem” — wysięgniki pierwsze, drony do demontażu modułów i drobnicy.

## Stan: etap 1 — fizyczne cięcie na sekcje (pokaz NPC)

- Złomiarz stoi (postój liczy świat ruchu), pracuje WRAK. Fazy (`src/game/scrapProcess.js`, stan w `job.scrap`): `plan` → `feed` (wiązki obracają wrak bliskim końcem do dziobu i dosuwają na `gap` przed dziób) → `cut` (dwa wysięgniki tną linię planu z obu burt naraz, spotykają się w środku) → `settle` (rozpad ciała w kroku silnika, sortowanie odłamów) → `chew` (odcięta sekcja ciągnięta do paszczy na dziobie i mielona) → `feed` … → `done`.
- Wszystko liczy się w 2D gry: ruch encji wraku (prędkość i obrót pisze proces, całkuje pętla wraków), rzaz `HullBodies.cutSegment` BEZ pędu (sekcja zostaje w miejscu — nie odlatuje jak po Hexlance), mielenie `HullBodies.cutNearest` przy punkcie paszczy, odłamy to zwykłe wraki tej samej pracy (`entry.extras` przez `noteTrafficWreck`). Obraz bierze ze stanu tylko pozy.
- KOMPUTER ZŁOMIARSKI (`src/game/scrapPlan.js`, czysty): z żywych komórek kadłuba (`HullBodies.activeCells` — pary ix, iy) liczy oś główną (przyciąganą do osi siatki) i linie W POPRZEK osi co ~długość sekcji; linia ma rozpiętość przekroju w swoim miejscu + zapas poza poszycie; `keepOut` odsuwa linię od stref modułów (hak pod etap z paliwem i modułami — dziś bez stref). Plan jest we współrzędnych SIATKI (komórka = tożsamość węzła, niezmienna przy przebudowie ciała i taka sama w każdym odłamie), więc jedna lista służy do końca pracy; linie malowane przez gracza mają być tą samą strukturą (`{ s, t0, t1 }` w układzie planu albo punkty siatki).
- OSPRZĘT kadłuba (`src/data/scrapRigs.js`): paszcza, dziób, podstawy i spoczynek dwóch wysięgników, emitery wiązek, długość sekcji — w UŁAMKACH długości kadłuba; człon wysięgnika dobiera się do zasięgu linii (`scrapArmSegment` — „wysuwany”). Kinematyka `scrapArmElbow` wspólna dla gry i obrazu. Dziś jeden zestaw (sprite `salvage_hauler`: paszcza na dziobie); nowy kadłub roboczy = wpis w `SCRAP_RIGS`.
- TEMPO: proces ma czas naturalny z wielkości wraku (`scrapNaturalSeconds`: ustawienie + linie + podawanie + mielenie powierzchni); `rate` (0,75–3,5) dopasowuje go do końca postoju z rekordu pracy (`lead` 10 s przed końcem). Zgłoszenie wraku niesie szacunek `work` (`estimateScrapSeconds`), a worker ruchu daje złomiarzowi taki postój przy CIĘCIU WRAKU GRY (`cutWorkSeconds` w `scrapperFleets.js`); wraki wojen w tle zostają na stałych `cutSeconds` — symulacja bez zgłoszeń gry identyczna.
- MIELENIE: zęby biorą tylko materiał, którego sięgają — sonda żywych węzłów przy paszczy (hak `touch` = `HullBodies.probe`, zasięg `mawR` zestawu albo `chewReachCells`); kawałek, który objął paszczę (środek masy na miejscu, w zasięgu pusto), po `chewStarve` s oddaje najbliższy węzeł.
- KONIEC: ostatni kęs (`keepNodes` 6 węzłów — mniejszy odłam silnik sam zamienia w odłamki) zostaje w paszczy do `salvage-taken`; gdy reszta wraku jest już w paszczy, wpis rejestru dostaje `loaded` — zniknięcie wszystkich kawałków to wtedy praca wykonana: wpis czeka jako `milled` (bez `wreck-gone`, złomiarz nie wraca pusty), praca składa wysięgniki, a wpis wypada z `salvage-taken` albo gdy praca się skończy.
- OBRAZ (`src/3d/trafficWork3D.js`, rekord CUT z flagą SCRAP i polem `aux` — `TRAFFIC_WORK_AUX` w `src/render/blocks/trafficWorkBlock.js`, pozy w UKŁADZIE STATKU): wysięgniki — partia `ArmStruts` (jeden rysunek, materiał nieprzezroczysty z głębią: kratownica malowana na pasie, przeguby — krążki; maska słońca `sunShadeUnlit`), laser od głowicy do rzazu i żar w miejscu cięcia (wiązki `BeamLines`), iskry `SparkSystem3D`, światło w siatce świateł, wiązki trzymające wrak, snop iskier i odłamki z paszczy. Żar rzazu na kadłubie to mapa ran: rodzina stempla `scrapTorch` (`hullDamageStamps.js`), źródło ustawia hak `cutLine` w `index.html`.
- SCENA `?scena=holowanie`: najpierw cięcia, potem hole; kamera przechodzi nad pierwszą pracę cięcia (`TOW_SCENE.workView` 1500 j. w 60% wysokości ekranu, `towSceneFollowWork`) i na następną po jej końcu — póki gracz nie ruszy kamery ani zoomu.
- WPIĘCIE: haki `trafficSalvageHooks.scrap` w `index.html` (`rig`, `cells`, `cellSize`, `cellWorld`, `cutLine`, `chew`, `touch`); bez nich (`?zlom=stary`, testy przepływu) moduł wraca do `cutOuterNode`. Strojenie na żywo: `TrafficSalvage.scrapTune` (logika), `TrafficWork3D.look` (obraz).

## Zasady i pułapki

- Proces rusza encje wraków (prędkość, obrót), nigdy węzły ani `body.pos`; węzły giną tylko przez `HullBodies` (`cutSegment`, `cutNearest`).
- Kawałek, który proces prowadzi, nie może zasnąć (`noWreckSleep`, `_wreckSleeping = false`) — uśpiony wypada z kroku i wiązki go nie ruszą; koniec albo przerwanie pracy (`releaseScrapJob`, `haltScrap`) zdejmuje flagę i zeruje prędkość, inaczej kawałek dryfuje dalej.
- Praca stempluje w `markColdWreckReferences` wszystkie swoje kawałki (`forEachTrafficSalvageWreck`: reszta wraku, sekcja w paszczy, kolejka).
- Rzaz woła się co `cutStepCells` drogi głowicy (nie co krok): każde wywołanie to rekord mapy ran i przegląd węzłów pasa.
- Odłam poniżej `splitMinNodes` (4) silnik zamienia w odłamki — mielona sekcja kruszy się na okruchy; licznik „zdjęte przez palniki i paszczę” jest przez to mniejszy niż liczba węzłów wraku (test: ≥ 70%).
- Sekcja mielona od środka pęka — nowe odłamy pracy idą do kolejki paszczy (`adoptPieces`), także te, których sortowanie po linii nie widziało.
- `convertToWreck` sam dopisuje wrak do `window.wrecks` — test, który dopisze go drugi raz, całkuje ruch podwójnie.
- Złomiarz to encja bańki (proxy, bez ciała na belkach): wrak i sekcje nie zderzają się z nim; sekcja wjeżdża na obraz dziobu, gdy idzie do paszczy.

## Braki (następne etapy)

- Etap 2: zawartość wraku i kolejność prac — zbiornik paliwa (wypompować; błąd = wybuch `fuelTankBlast`), rdzeń, bronie z manifestu łupu, dysze: strefy `keepOut` planu, demontaż modułów w całości, skutki złego cięcia.
- Chwyt i przenoszenie sekcji dźwigiem albo dronami, ładowanie do własnej ładowni od góry i do statku obok (dziś sekcję ciągnie wiązka wprost do paszczy; sekcja szersza niż kadłub złomiarza wystaje na boki).
- Gracz: laser tnący i dźwig w gniazdach broni (sprzęt-narzędzie pomijany przez kierowanie ogniem i AI), malowanie linii LPM, widok komputera złomiarskiego.
- Statki robocze (paszcza otwierana, młyn, rafineria, frachtowiec z rampą, dźwig) — kadłuby z generatora (reguła `kreator-kadlubow`, niewpięty do gry), ruchome części jako modele na mocowaniach.
- Ekonomia: czas cięcia wraków wojen w tle z klasy, młyn daje złom, rafineria obok — przez bramkę bilansu (reguła `ruch-v2`).
- Cięcie przez gracza (`startFieldSalvage` w `index.html`) dalej zdejmuje węzły od krawędzi.

## Jak sprawdzać

- Testy: `node --test tests/scrapPlan.test.mjs tests/scrapProcess.test.mjs tests/trafficSalvage.test.mjs tests/trafficWorkRender.test.mjs` (plan z komórek; proces na PRAWDZIWYM silniku belek — ustawienie, linie, sekcje, mielenie, tempo; zgłoszenie z czasem pracy; blok i rysunek; WGSL wysięgników w Node).
- W grze: `node scripts/webgpu/zlomowanie-gra.mjs [--query renderWorker=1] [--out .tmp/zlomowanie]` — scena `?scena=holowanie`, narzędzie idzie za pierwszym cięciem: fazy w czasie, zbliżenia (podawanie, cięcie, mielenie, koniec), film GIF, pipeline'y synchroniczne, błędy. A/B z dawnym cięciem: `--query "renderWorker=1&zlom=stary"`.
- Konsola: `TrafficSalvage.jobs` (stan `scrap`: faza, linia, `stats`), `TrafficSalvage.scrapTune`, `TrafficWork3D.stats` (`scrap`, `struts`).
