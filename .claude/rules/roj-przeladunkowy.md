---
paths:
  - "src/3d/swarm/**"
  - "src/game/swarm/**"
  - "src/data/swarmDrones.js"
  - "dema/roj-webgpu.html"
---

# Rój dronów przeładunkowych (demo): klasy, chwyty, wieża portu, ORCA

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/swarm/`, `src/game/swarm/`, `src/data/swarmDrones.js`** — rój dronów przeładunkowych (demo `dema/roj-webgpu.html`; w grze — model, chwyty i lot z planu analitycznego przy stanowiskach zatok, reguła `przeladunek-portow`): klasy S / M / L / Capital (jeden kontener standardowy, chwyt płaski 1 / 2 / 4 / 8, ramiona z chwytakami — wysuwane w większych klasach), symulacja i unikanie ORCA w compute (`swarmSim.js`), wieża portu na CPU (`swarmPlanner.js`, księga pojedynczych kontenerów). Opis: § „Rój dronów przeładunkowych” niżej, `docs/webgpu/DEMO-ROJ.md`.

## Rój dronów przeładunkowych (demo WebGPU 2026-10-06; `src/3d/swarm/`, `src/game/swarm/`, `docs/webgpu/DEMO-ROJ.md`)

- Decyzje użytkownika: (2026-10-05) drony Z5 odrzucone („clumsy”, „jak z wirnikami — w kosmosie wirników nie ma”), klasy S / M / L / Capital, ramiona chwytają kontenery; (2026-10-06) **JEDEN kontener standardowy 16 × 8 × 8** (bez megakontenerów), **chwyt płaski** — S 1, M 2 (1 × 2, burta w burtę), L 4 (2 × 2), Capital 8 (4 × 2), ramiona M / L / Capital **wysuwane** (teleskop), każdy kontener trzymany za dwa gniazda narożne zewnętrznej krawędzi (na styku — chwytak podwójny); w grze rój w **tempie ×4** (zegar roju = czas gry × 4, parametry lotu bez zmian — `DEMO-ROJ.md` § Integracja). Dane, chwyty i IK ramion: `src/data/swarmDrones.js` (`swarmArmPose`, `swarmPackSlotOffset` = lustra shadera), bryła `swarmDroneModel.js`, tablica klas GPU `swarmClassTable.js`.

- Chwyty się ZAGNIEŻDŻAJĄ (C = 2 L = 4 M = 8 S): kolumnę (slot ładowni = obrys modułu `cargoBays.js` × warstwy, stos placu = obrys chwytu klasy bloku) obsługuje każda klasa, której chwyt dzieli obrys bez reszty (`swarmPackTiles`) — bierze podblok; obrys modułu ładowni = wielokrotność chwytu klasy (moduły M: 1 × 2 × 2). Kurs drona w chwycie i przy odłożeniu wybiera wieża (kurs kolumny albo +π), więc wie, który kontener trafi w którą komórkę — GPU stawia je tą samą arytmetyką (hak + obrót × miejsce k), wykonawca CPU sprawdza komórkę z pozy. Pusty dron musi się mieścić w obrysie swojej warstwy (szyby sąsiednich slotów 1 j. obok — test).

- Podział: **wieża portu** (CPU, `swarmPlanner.js`) mówi kto / co / dokąd i prowadzi księgę komórek (kontenery na poziomach) z odczytu stanu (1–3 klatki opóźnienia); **drony latają same** (GPU, `swarmSim.js`: `kClear → kBin → kSteer → kIntegrate`, pierścień 2 zadań na drona — 8 × vec4 z listą do 8 kontenerów chwytu, zamki i liczniki kontenerów kolumn na atomikach). Nowa robota dronów (np. odłamki asteroid) = nowy rodzaj zadania w kernelu + lustro CPU + reguła wieży (`DEMO-ROJ.md` § Integracja, pkt 6). Lustro CPU maszyny stanów: `swarmExecCpu.js`; unikania: `swarmOrca.js` — zmiana w kernelu = zmiana w lustrze (testy `tests/swarm*.test.mjs`).

- Przestrzeń: ruch w bok nad siatką kolumn tylko w **paśmie podejścia** (nad dwoma poziomami wejść w szachownicę), zejście / wyjście pionowo nad własną kolumną, przelot w warstwach wg kursu. Unikanie: **ORCA na prostokątach obrysów** (suma Minkowskiego, τ = 1,5 s, koło prędkości osiągalnych w 1 s, linie twarde od dronów z pierwszeństwem), pion — hamowanie przy przewidzianym nakładaniu w poziomie.

- Pułapka (three r183): niepuste `updateRanges` = wysyłka TYLKO zakresów — po `init()` zakresy dopisane w tej samej klatce zjadały pełną wysyłkę i na GPU zostawały rekordy poprzedniej sceny. Bufor przebudowywany w całości + zapisy zakresami w tej samej klatce → wymuś pełną wysyłkę (`SwarmSim._tasksFull`).

- Narzędzia: `node scripts/webgpu/roj-demo.mjs --tryb test | metryki [--tune k=v] [--zastoj 90] | zrzuty | wydajnosc` (metryki: czas, puste przeloty, zderzenia obrysów, histogram faz, zrzut zastoju). Integracja z grą (ładownie, port K-7, `Core3D.addFxStep`, rozgrzewka) — plan w `DEMO-ROJ.md`.

- W GRZE (E12, 2026-10-22 — reguła `przeladunek-portow`): rój przy stanowiskach zatok Ziemi to model, chwyty, ramiona, parametry lotu i zegar ×4 z dema, ale ruch z PLANU ANALITYCZNEGO (`src/game/swarm/berthTransfer.js` — funkcja ziarna kursu i zegara postoju), nie z symulacji GPU (`swarmSim.js`, wieża) — decyzja orkiestratora „tymczasowo, do decyzji użytkownika”. Bryła i materiał dronów (`SwarmDroneMeshes`, `SwarmDroneLights`) czytają bufor storage pisany z CPU (`portCargoDrones`) — ten sam układ rekordu `SWARM_DRONE`; zmiana układu rekordu = zmiana w kernelu, w planie analitycznym i w `portCargo3D.js`.
