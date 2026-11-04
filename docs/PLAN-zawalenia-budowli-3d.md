# Plan: kruszenie i zawalenia budowli 3D („Teardown bez wokseli”), 2026-11-03

Stan: plan po weryfikacji (§ 1.4). Decyzje użytkownika 2026-11-03 (§ 8): D0 tak, D6 tak, D1 — dysk, D11 — przechył w stronę strzałów, D14 — nacisk na wieżowce i habitat, ale reszta bazy (wyłom bębna, magazyn, paliwo, pomosty) też ma się tak niszczyć. 2026-11-04 użytkownik rozstrzygnął WSZYSTKIE pozostałe decyzje (§ 8 — kolumna „decyzja użytkownika”); zmiany względem rekomendacji: wnętrza docelowo we wszystkich budowlach (D9), demo na szarych blokach przed E3 (D20), radar poza planem (D21), lina windy na kawałku dysku (D17), reszta habitatu dolatuje później niż wieża (D22), odbudowa portów dronami z mandatem (D10b), pełne zawalenie hal K-7 (D23), kolejność bez stacji (D10d), Mars z kolizjami budynków (D19). E0 (część CPU), E1 i E2 zrobione 2026-11-04, obie bramki go / no-go: go (§ 6.2). W części o budowlach zastępuje etapy F z `PLAN-zniszczenia-swiata-3d.md`.

Oznaczenia: **[P]** pomiar, **[S]** szacunek, **[D]** dokument albo reguła. Ufność liczb po zmianie: **wysoka** (pomiar tego mechanizmu), **średnia** (pomiar podobnego + przeliczenie), **niska** (szacunek).

Przeliczanie i warunki:
- Node → gra ×2 (GC, reszta kroku), w szczytach do ×3 [D: port silnika belek, 5 ms Node ↔ 10–17 ms w grze].
- Klastry w prawdziwym silniku (`collideBodies` v2) kosztują ×4–6 więcej niż bryły zabawkowe benchmarku [P]. Bryły z benchmarku nie wchodzą do budżetu.
- CPU mierzone przy obciążeniu maszyny 23–60% (inne sesje). GPU szczytu upadku przy presecie Wysoka; Ultra (preset użytkownika, 5120×1440) zmierzone w E0 headless (§ 6.2).
- Warianty eksperymentu upadku: **V0** dziś; **V1** dysk poza silnikiem belek; **V2** = V1 + H-C i bęben bez awansu; **V3** = V2 + H-T poza belkami po minięciu dysku.

Prośba: wieżowiec kruszy się od strzałów, gubi odłamki i runie pod grawitacją; habitat w upadku niszczy „tarczę” w kształcie tego, co spada; bez widocznych wokseli; potem ringi i wszystkie budowle 3D.

---

## 1. Werdykt

### 1.1 Damy radę? Tak, z warunkami

Nie strojeniem silnika belek, bo belki celowo nie przenoszą ciężaru (`destructorBeams3D.js:693-696`, `:120-122`). Pomiar [P]:
- góra wieżowca spada z 250 j/s na zakotwiczony dół: 0 wysp;
- swobodny upadek z 1095 j/s: 1–4 bryły;
- uderzenie wieży bokiem w szyi: dysk traci 0 węzłów.

Potrzebne są cztery rzeczy naraz:
- **gruby graf nośny CG**;
- **oderwana masa jako klastry sztywne** w tym samym silniku;
- **dysk poza belkami**;
- **obraz z prefraktury**.

Warunki (wszystkie konieczne):
1. **H-T schodzi z belek po minięciu dysku** (D6). Na belkach przy komórce 45 samo uderzenie wieży kosztuje 18–29 ms w grze [P ×2].
2. **Dźwignie silnika dla klastrów** (§ 3.5) zmierzone w E2. Dziś 200 klastrów w stosie: 3,3–3,7 ms p95, 12,7–13,5 ms max w Node [P].
3. **Kruszenie przed upadkiem jako jawna reguła gry** („fala w konstrukcji”, § 4.1). Sam graf go nie daje: w benchmarku wszystkie 53 zerwania przypadły na ostatnie 0,67 s przed oderwaniem.
4. **Poprawki modelu:**
   - kalibracja wiązań na każdym poziomie;
   - opór frontu κ 0,1–0,3;
   - pole grubości dysku zamiast bitu;
   - prototyp progu szyja / upadek przed E6.
5. **Decyzje D0 i D6 przed E1.**

Zakres uczciwie:
- W misji 1 wyłom bębna, magazyn, paliwo i pomosty dalej pękają po staremu (`breakPiece`, pełnowysokie plastry), chyba że D14 = tak.
- „Wszystkie budowle” to nie potok automatyczny: poza bazą żadne źródło nie ma dziś ciał gry (`worldBodies.addSite` tylko w `pirateDryDockGame.js:166` i `pirateBaseWorld.js:123`).
- Budynki Marsa nie są w kolizji gry (D19).
- Stacje nie mają grawitacji, więc tylko się rozpadają.

### 1.2 Ogarniemy wydajnościowo? Ostrzał tak, zawalenie i lądowanie warunkowo

- **Ostrzał i uśpione budowle: tak.**
- **Zawalenie i lądowanie: warunkowo.** Prawdziwy silnik daje ~2× więcej, niż plan zakładał przed weryfikacją. Max przy 200–256 klastrach (13–15 ms Node) łamie „nigdy > 16,7 ms” w grze. Rozstrzyga E2 (go / no-go).

**O ile spada szczyt upadku** [P, Node, najgorsze okno 1 s, p95 kroku, 3 przebiegi]:

| wariant | `stoi` | `lezy` | okno lądowania |
|---|---|---|---|
| V0 dziś | 17,7–20,2 | 23,0–26,0 | 15,9–24,4 |
| V1 bez dysku | 11,4–14,6 | 14,3–14,8 | 4,4–7,3 |
| V2 + bez awansu | 13,6–14,5 | 11,1–11,5 | 3,1–3,7 |
| V3 + H-T poza belkami | 0,3 | 0,3 | 0 |

Wprost:
- **Belki w szczycie:** z 17,7–26 ms p95 do ~0,3 ms (Node).
- **Klastry w ich miejsce:** 1,8 ms p95 (256 klastrów na 3,5 km) do 5,2 ms (256 w gęstym stosie) [P].
- **W grze:** z 15–25 ms/krok [D] (klatki 40–70 ms [P]) do **7–11 ms p95, max 25–40 bez dźwigni** [S z P]. Z dźwigniami cel to **≤ 5 ms p95 i ≤ 12 ms max** [S].
- **Krok HP 0** w Node z szablonami z ekranu ładowania (jak gra):
  - dziś 37–62 ms (zimny JIT) / 30–49 ms (ciepły) [P]; „149–194 ms” z map to symulator bez `prebuildPirateBaseBodies`;
  - V2: 8,2–12,6 / 3,8 ms [P];
  - ≤ 8 ms w grze tylko z kodem rozgrzanym lub przygotowanym.
- **GPU szczytu nie spada.** Przy Wysoka karta jest zajęta w 98–99% [P], przy Ultra 120 Hz szczyt przekracza 8,33 ms już dziś [S]. Cel: nie gorzej niż dziś.

### 1.3 Fazy × zasoby

**Wątek gry** [ms/krok w grze, ponad walkę ~1,0 [P]]:

| faza | dziś | po zmianie p50 / p95 / max | podstawa | ufność | limit | ocena |
|---|---|---|---|---|---|---|
| ostrzał wieżowca | krater ≤ 300 aktywnych węzłów [P] | +0,1–0,3 / +0,4–1,2 / +2,5 | [S z P] CG 25: przebieg 0,37 ms Chrome; p95 = pełny przebieg | średnia | +1 / +2 | ✓ z fazami CG |
| zawalenie wieżowca (3,5–6 s) | `breakPiece` 1,5–6,7 jednorazowo [P] | 1–3 / 3–7 / 10–14 | [S z P] 100 klastrów: 0,85 p95 / 6,6 max Node | niska | ≤ 12, nigdy > 16,7 | na granicy |
| krok HP 0 | Node 37–62 / 30–49 [P] | ≤ 8 | [P] V2 + [S] | średnia | nigdy > 16,7 | ✓ z rozgrzaniem |
| przebicie dysku | Node 3,7–4,1 / 16–17,5 [P] | 3–8 / 6–16 / > 16,7 możliwe | [S]; pole 0,05 p95 [P], graf 0,13 [P] | niska | ≤ 12 | ✓ tylko z reakcją na całe ciało H-T |
| uderzenie H-T, belki, komórka 45 | V0 Node p95 11,2–12,9 [P] | Node 5,1–6,8 / 9,0–14,5 / 22–31 → gra 18–29 | [P] V2 | wysoka | ≤ 12 | ✗; `gravityVmax` 1000–2000 nie ratuje |
| jw., komórka 67 (rezerwa) | — | Node p95 3,7–5,2, max 7,7 → gra ≤ 10,4; z klastrami w tym oknie 14–20 | [P] + [S] | średnia | ≤ 12 | ✓ bez zbiegu z klastrami |
| lądowanie, ≤ 200 klastrów (H-T też) | Node 15,9–24,4 [P]; gra 15–25 [D] | 4–6 / 7–11 / 25–40 | [S z P] 200 klastrów: 1,9 / 3,3–3,7 / 13 Node | średnia | ≤ 12, nigdy > 16,7 | ✗ max bez dźwigni |
| lądowanie, 256 klastrów | — | 6–9 / 10–15 / 30–45 | [S z P] Node 2,9 / 5,2 / 15,1 | średnia | jw. | ✗ → sufit 160 |
| po osiadaniu (misja 2) | ~2 po zamrożeniu [D] | ≤ 0,3 | [S] | średnia | — | bramka E7 |
| uśpione | — | 0 | [P] 30 budowli: 0,002 | wysoka | ≈ 0 | ✓ |
| aktywacja w bańce ringu | — | 1–5 na budynek | [S] | niska | ≤ 2 na krok | E9, kolejka |

**Pozostałe zasoby.** Limity: worker +0,5 p50 / +1 p95, GPU +1, VRAM +300 MB, rysunki +10, 0 pipeline'ów synchronicznych.

| faza | worker [ms/kl.] | GPU przy Ultra [ms] | VRAM [MB] | ufność |
|---|---|---|---|---|
| ostrzał | dziś 1,8–2,2 [P]; +0,1–0,3 [S] | +0,1–0,4 [S]; kratery bez wczesnego odrzutu +0,8–2 [S] | +5–15 [S] | średnia; kratery niska |
| zawalenie | +0,2–0,6 [S] | +0,4–1,2 (kawałki, żwir, kratery) [S] | 0 (pule) | niska |
| przebicie | −0,3…+0,3 (znika skóra dysku) [S] | +0,2–0,6 [S] | +20–40 [S] | niska |
| lądowanie | dziś 2,95–3,7 [P]; −0,3…+0,5 (do 256 encji) [S] | nasycone przy Ultra: każdy dodatek = gorsze klatki | +2 [S] | kierunek średnia |

Uzupełnienia:
- **Rysunki misji 1:** +8–14 przy 2 wariantach `discard`; w okresie przejściowym ze starą ścieżką ponad +10 [S].
- **Przygotowanie:**
  - prefraktura W-1 (2041 kawałków): 0,49 s [P, pudła], czas rośnie jak n^1,7–2,3 [P];
  - archetypy habitatu: 2,5–8 s ściany w 2 workerach przy pierwszym uruchomieniu [S z P], więc wypiek offline.
- **Pamięć:** archetyp W-1 269 KB plus egzemplarz 252 KB [P]; reszta do policzenia w E3.

### 1.4 Co zweryfikowano

Syntezę panelu (cztery projekty, benchmark, trzech sędziów) sprawdziło pięć źródeł. **Eksperyment w Node** (macierz V0–V3 × `stoi`/`lezy` × 3, profil HP 0, `--prebuild`, A/B `gravityVmax` i komórki H-T) rozłożył szczyt upadku na dysk, awans i H-T, obalił „H-T na belkach do końca” i pokazał, że skok HP 0 z map to artefakt symulatora. **Sceptyk wydajności** puścił klastry przez prawdziwy `HullBodies`: ×4–6 wobec benchmarku, max 13–15 ms Node, 16 ukrytych kosztów. **Sceptyk fizyki** wykazał, że graf nie daje kruszenia przed upadkiem, model to laplasjan bez zginania, front z R = nośność staje, raster binarny nie zrobi rowu, korek wyprzedza wieżę, a elewacja ma 17–211 px zależnie od ekranu. **Sceptyk integracji** znalazł 3 błędne z 27 odnośników i przyczynę niedeterminizmu (`Math.random`; z ziarnem 3/3 identycznie), poprawił mechanizm szwu i sufit `szewRenderu`, a szacunek sesji podniósł ~1,7×. **Krytyk kompletności** wskazał 2 braki krytyczne (kto liczy archetyp, skrypt `_chainExplosion`) i ~25 ważnych. Po weryfikacji kierunek stoi, ale liczby lądowania, przygotowania i sesji wzrosły, a „zachowanie” modelu to szkic do sprawdzenia w E1, nie pomiar.

## 2. Diagnoza

**Wieżowiec W-1/W-2** to kawałek PŁASKI (453 węzły, komórka 15 j., `worldBodies.js:41`).
- Skóra `skin` ma 4 rogi (`portBuildings3D.tsl.js:548`), a z nie wchodzi do maski ani FFD. **Każdy krater to więc pionowa szczelina przez 2,24 km**, rany też biegną pasami (`:652-653`).
- Śmierć przebiega tak: `_structureCollapse` (`storyGame.js:1122-1141`) → `breakPiece` (`worldBodies.js:836-889`) → Voronoi 2D. Wychodzą ~4 pełnowysokie plastry, które dryfują bez grawitacji.
- Odłamki `hullDebris3D` mają z i vz (`:48-49`, `:211-212`), ale bez grawitacji (`:64`), więc nie spadają.
- Brak wnętrza: `floors()` dokłada tylko pasy zewnętrzne (`pirateBaseScene.js:763`).

**Dysk D-1…8** to ~25,7 tys. węzłów i ~105 tys. belek. Przebicie i składanie robi skrypt:
- `_chainExplosion` (`storyGame.js:996-1004`): H-C po 0,05 s, ćwiartki bębna co 0,3 s, `rockCollapse` po 1,5 s;
- `towerKick` (`pirateBaseFall.js:525-530`);
- `openDiscHole` / `holeWeaken` i korek `cutDiscHole` (`:643-777`);
- `releaseDisc` co 0,3 s (`:1094-1128`);
- reguła kolumny (`:1256-1308`);
- `towerTumblePass` (`:1172-1185`);
- fazy studni i `holdGravity` (`:455-473`).

Przyczyny w silniku:
- ciało zakotwiczone ma masę ∞ (`destructorBeams3D.js:1693`, `:1927-1929`);
- zgniot ∝ 1/pancerz² (`:1984`);
- front to suma kontaktów (`:2651-2664`);
- `DISC_PIN_GRID` (`pirateBaseBodies.js:176-181`) chroni szyję, więc upadek musi go odkręcać skryptem.

**Skąd szczyt** [P]:
- **Dysk** to 60–80% szczytu lądowania.
- **Awans H-C i bębna** daje skok HP 0 (z prebuild ~42 ms) i kroki 1–4 po 34–40 ms (solver 17–24 ms, kolizje 6–14 ms przy 27 bryłach).
- **H-T** to reszta. W oknie uderzenia: solver 3,6–4,0 ms, kolizje 2,2–2,4 ms, 3333 aktywne węzły; szczyty z `processSplits` (18,3 ms w kroku 23 ms).
- **`startHabitatFall`** to 15,2–16,2 ms przy zimnym JIT:
  - 45–50% dysk (`openDiscHole`, `bodyExtentZ`);
  - ~30% zimny JIT `_transferFragmentMotion` (`destructorBeams3D.js:4057`): 3,9–4,7 ms na zimno, 0,17 ms na ciepło.

**Niedeterminizm** daje `Math.random` bez ziarna w rozpadzie, a nie budżety zegarowe:
- miejsca: `hullBodies.js:1361`, `:2978-2982`, `:3016-3019`; `worldBodies.js:846-856`; `destructorBeams3D.js:3127-3133`, `:3213-3214`;
- symulator ustawia tylko `rnd` (`destrukcja-taran-sym.mjs:591-592`);
- z ziarnem 3/3 przebiegi identyczne [P]; samo ziarno zmienia wynik o ±20% brył;
- V2 i V3 są deterministyczne;
- budżet zegarowy `worldBodies.js:286` zostaje jako ukryte ryzyko przy obciążeniu.

## 3. Architektura

Skąd co bierzemy:
- **rdzeń z projektu B, solver CG** (GS na wieży: 18–35% błędu, 74–253 fałszywe zerwania [P]);
- **z A:** kaskada elewacji, HP → nośność, lista wycofań;
- **z C:** teren-płyta jako pole dysku, dyscyplina szwu, test zmienności;
- **z D:** wspólny materiał zewnętrza i przekroju, rysunek pośredni.

### 3.1 Archetyp: dwie części z jednego ziarna

1. **Dane gry liczy wątek gry** na ekranie ładowania (`prebuildPirateBaseWorld`, bez Core3D; w Node synchronicznie):
   - bloki L1 (SoA: masa, OBB, materiał, poziom, ≤ 32 punkty styku, zakres L2);
   - wiązania z limitami sprężystym i krytycznym (±15% z PRNG);
   - kotwice: `ground`, `support` (nośność utrzymania), `section` (do innej budowli);
   - mapa komórka pasa → L2/L1;
   - dla płyt pole grubości u8 na komórkę 45 j.
2. **Geometrię L2 liczy worker skór** po stronie renderu (Voronoi 3D przycięty do brył, twarze zewnętrza i przekroju). W trybie worker workery skór startuje worker renderu (`render.worker.js:64`). Dane z renderu do gry łamałyby zasadę 6, a tryb `off` i Node tych workerów nie mają.
3. **Wspólny kod bez three i to samo ziarno.** Strażnik `tests/structurePrefracture.test.mjs` porównuje bit w bit identyfikatory L2 i przypisanie L2→L1. Do renderu idą tylko numery.
4. **Archetypy misji 1 wypiekamy offline** skryptem w `scripts/` do `assets/` (nie `public/`):
   - klucz to hash brył i wersja generatora;
   - test „pamięć = świeży wypiek”;
   - wpływ na rozmiar paczki do oceny;
   - IndexedDB (profil Electrona przeżywa restart, bez IPC) tylko dla leniwych archetypów ringów.
5. **≥ 2 warianty prefraktury na archetyp z odbiciem**, żeby W-1, W-2 i budynki jednej klasy nie pękały identycznie.

### 3.2 Egzemplarz, graf, solver

- **Egzemplarz:** poza w f64, stan bloków i wiązań, ciepły start CG.
- **Grawitacja:**
  - budowle bazy biorą −z habitatu;
  - studnia skały działa tylko na klastry poza bazą, bo środek skały leży ~11° od pionu; daje to mimośród ~145 j. przy ramieniu podcięcia 190 [S].
- **Kalibracja na każdym poziomie:** przekroje ∝ obciążeniu, wykorzystanie ~0,5 na każdym poziomie. Globalny limit (`graf.mjs:244-260`) daje ~0,02 przy szczycie, więc grawitacja nie oderwie nic wysoko.
- **Solver CG:**
  - 25 iteracji co 4 kroki (`ticksAt120`), z przesunięciem faz (id + tick) mod 4, ≤ 2 przebiegi na krok;
  - p95 = koszt pełnego przebiegu;
  - błąd ≤ 5% także w krokach z zerwaniami (w benchmarku przy 16 s: 43%).
- **Granica modelu:**
  - 3 DOF i laplasjan izotropowy (`graf.mjs:67-78`): bez osiowego rozciągania i momentu;
  - wywracanie widzi tylko kontrola przekrojów poziomów;
  - dysk i budowle ogólne potrzebują wiązań osiowych k·n·nᵀ albo węzłów z obrotem (×3–4 kosztu [S]).
- **Zmęczenie:** wiązanie ponad limitem sprężystym traci HP w czasie (`stepDecay120`). Wyspy liczy union-find (≤ 0,015 ms [P]).
- **Zawias to reguła:**
  - powstaje przy ostatnim podparciu i pęka po kącie (jak `hingeBreakTilt` szyi);
  - czasy 5° / 15° z benchmarku to wzór na obrót, a w grafie oderwało się 100% masy naraz.
- **Front Bažanta:** d(mv)/dt = mg − R(z), gdzie **R = κ · nośność krytyczna**:
  - κ 0,1–0,3 to opór po wyboczeniu, strojony tak, żeby zawalenie doszło do końca;
  - przy κ = 1 front staje po jednym piętrze.
- **Oderwana wyspa:**
  - ≥ N poziomów dzieli się od razu po wiązaniach pięter, bez pełnowysokiego plastra;
  - przy styku solver z odciążeniem bezwładnościowym (−m·a, jeden węzeł przypięty), bo K wolnej wyspy jest osobliwa.

### 3.3 Klaster `rigid`

- **Ciało:** 6DoF, `gravityWell` + `vmax`, `addTerrain`, `freezeBody`, lustra pozy.
- **Kontakt:**
  - węzły to punkty styku bloków;
  - kontakt oddaje impuls do grafu (`onRigidContact(blok, J)`);
  - zawias przez `addJoint` ciało–świat.
- **Bit w bit dla statków:**
  - rozdział wyłącznie w `update()` (`destructorBeams3D.js:1346`);
  - osobne `_collideRigid` i `_collideTerrainRigid`;
  - `continue` w solverze (`:827`, `:958`), `processSplits` (`:3585`) i `repair`;
  - **zero zmian** w `collideBodies` (`:1505-2121`), `_collideMixed` (`:2443`) i `_collideTerrain` (`:2152`);
  - bez nowych losowań.
- **Pary:**
  - rigid × belki, rigid × płaskie, rigid × teren;
  - **rigid × rigid**, także w tej samej budowli; dziś `pairFilter` wyklucza takie pary (`hullBodies.js:3170`).
- **`HullBodies`:**
  - `createSolid`, `syncSolidOut` (`:2015`), `shatterSolid`, `onWreck`;
  - `sweep` / `probe` / `cutSegment` wobec klastra (§ 3.7);
  - pole `rigid` w `hullColdSnapshot.js`;
  - flaga lustra `BODY_FLAG.RIGID` (`snapshotPack.js:1093`): worker rysuje klaster partią, nie skórą belek.
- **Cykl życia:**
  - limit klastrów osobny od `maxWrecks` 400 (`hullBodies.js:100`);
  - klastry nie są zimnymi wrakami (`coldWrecks.js:298,311`);
  - po osiadaniu ruina uśpiona, już w E7.

### 3.4 Budżety liczbowe (na 1/120 s przez `ticksAt120`)

- ≤ 64 zerwania na krok;
- ≤ 4 nowe klastry na krok;
- ≤ 1 piętro na krok na front;
- ≤ 8 solverów;
- ≤ 2 pełne zawalenia, habitat się wlicza;
- **≤ 160 aktywnych klastrów**; nadmiar idzie w gruz obrazu albo zamrożenie, po masie i id;
- ≤ 64 rekordy `STRUCT_*` na krok, nadmiar zbiorczo;
- ≤ 8 `ROCK_IMPACT` na krok.

### 3.5 Dźwignie silnika (warunek E2)

1. **Broadphase klastrów:** komórka 2–4 × promień zamiast 960 j. (`destructorBeams3D.js:1405`). Pary sfer rosną dziś 3,5k → 12k → 46k dla 100 → 200 → 400 klastrów [P].
2. **Narrowphase rigid** bez normalnej z okna i koszy frontu: ≤ 1,5 µs na parę (dziś 3,8–6,1 µs [P]).
3. **Teren:** normalna raz na ciało, nie 4 odczyty na węzeł (odczyt 38–41 ns [P]): ~−0,4 ms Node w szczycie.
4. **Usypianie i zamrażanie** z budżetem; `wreckPairEvery` dla wolnych par klastrów (zmienia rozgrywkę, decyzja jak w `AUDYT-przestoje` § 159).
5. **Reakcja przebicia na całe ciało H-T**; węzły tylko giną. Inaczej solver przekroju to +3–7 ms w grze [S].
6. **H-T → klastry jednorazowo z szablonu w swobodnym locie:** ≤ 8 ms w jednym kroku albo rozłożone bez kopiowania magazynu.
   - Odejmowanie po 1 klastrze to kopie O(N) (`:3705-3843`) [S].
   - Okno jest: 9,1–9,7 s lotu bez styków [P].
7. **Aktywacja:** ≤ 2 budowle na krok.
8. **Bez alokacji:** usunąć domknięcie `fill` przy styku z terenem (`pirateBaseFall.js:407-427`).

### 3.6 Gra ↔ render

| wątek gry (prawda) | worker renderu (obraz) |
|---|---|
| ciała pasa: kratery, pociski, taran, przeszkody | partie L1/L2, kratery SDF, rysy z wykorzystania |
| graf, wyspy, zawias, front, pole dysku | gruz: L2 w locie i żwir, balistycznie |
| klastry i lądowanie | pył: cząstki |
| H-T na belkach do minięcia dysku | łata kraterów skały (§ 4.3) |

- **Pozy klastrów** idą lustrami brył.
- **Stan budowli** to nowy blok migawki `structBlock`, nie pola encji: wzór `worldBodiesBlock.js:14-20`, `packer.addBlock`, replika w workerze. Niesie bloki zmienione od `structSeq`: żywy, klaster, wykorzystanie u8, żar.
- **Rekordy** z zakresu świata 74–127 (`rockImpactRecord.js:8`; wolne 78–111 i 116–127):
  - `STRUCT_SPAWN`, `STRUCT_RELEASE`, `STRUCT_CRUSH`, `STRUCT_CARVE`, `STRUCT_RUIN` / `STRUCT_RESTORE`;
  - `ROCK_DENT` w torze skały 113–115.
- **Pierścień rozkazów** ≥ 64 tys. słów od startu. Dziś ma 4096, a `_grow` alokuje SAB w klatce (`eventRing.js:52-60,148`).
- **Ukrycie:** `prov.hidden()` (mgła ∪ soczewka, `pirateBaseGame.js:282`) i `HIDDEN_KEEP_MS` (`worldBodies3D.js:863-874`). Gruz w soczewce jak `rockSite.fx`, pule zostają.
- **Czas gruzu** z `SimClock` (wzór `renderTime` gazu), więc pauza go zatrzymuje. Pozy z `Core3D.frameNowMs()`.
- **Sufit `szewRenderu` +2–3** z powodem (`tests/szewRenderu.test.mjs:17`, wzór `pirateVents`, `portDocks`). Parzystość `off` ≡ worker.
- **Okres przejściowy:** stare odłamy skór (`worldSkinBatch.js:29`) żyją obok nowych partii do E7.

### 3.7 Zasady i haki

| zasada / hak | miejsce |
|---|---|
| 1 | Graf, klastry i lądowanie liczy gra. Obraz z niczym się nie zderza. Bez rzutowania trafień po kamerze. |
| 4–5 | Graf TSL na rodzinę × BG/FG; dane w `ClusterStore` / `PieceStore`; wszystko w `Core3D.warmup` (`'loading'`). |
| 7 | SoA, pule, prealokowane stosy i wektory CG; test `untilSteady`. |
| 8 | Budżety i kadencje przez `ticksAt120` / `stepDecay120`; testy 60 / 120 Hz. |
| 9 | Wszystkie miejsca `Math.random` z § 2 dostają PRNG rozpadu z ziarnem; obraz używa `fxRandom`; strażnik dla `src/game/structure*.js` (jest od E0b: `tests/structureZasady.test.mjs`). Etap PRNG rozpadu: do decyzji (propozycja E5, przy bramce „4 wzory → 4 kierunki”); czy obejmuje wraki statków (`shatter`, sekwencja `Math.random` gry poza obszarem) — decyzja orkiestratora, a jeśli tak — na listę użytkownika. |
| baza piratów | Graf zgłasza zawalenie przez `pirateBaseWorld` (nowe `collapsePirateBaseChunk`: `_dockGone`, `noteBaseChunkBreak`, `markBaseBroken`, `pirateBaseObstacles`), bez `breakPiece`. |
| przeszkody AI | Klastry w ruchu → indeks wraków; ruina → `statics`, jeden przyrost `staticsVer` na partię (`flota-ai.md:22`). |
| broń wobec klastra | Pocisk: punkt styku → HP bloku + `STRUCT_CARVE`. Wiązka i Hexlance (`plowLance`): HP bloków po promieniu. Do tego rakiety, fala, taran. HP bloku oderwanego klastra (D4): miejsce stanu do ustalenia w E5 (np. `S.blockHp` egzemplarza z masy bloku × punkty budowli / masa); broń wobec klastra — E5 (klastry ranią okręty od E5, D5). |
| obszarowe | `STRUCT_CRUSH` → `RepairSwarm.blast`; w ogólności `damageTrafficActor`. |
| presety | Pula L2, żwir, cząstki, kule kraterów w `graphicsQuality.js` + test. |
| światła | Światła iglicy przypięte do bloku L1: jadą z klastrem albo `intensity = 0`. |
| obraz 3D | Kotwica soczewki `hidalgo`, offset w `mesh.position`, `updateMatrixWorld`, `sunVisibility`. Cień i `hullVolume` rozstrzyga E4. |
| n/d | Maskowanie: klastry ranią jak taran. `roofCover` tylko K-7. Radar: do decyzji. Dźwięk: hak w zdarzeniach (D18). |

### 3.8 Co wycofujemy (do E7 za `?zawalenieStare=1`)

- **`_chainExplosion`:** przy terenie skały zostaje tylko `habitatFall()` i wybuch szyi; rozpad H-C i bębna wynika z grafu.
- **`_habitatImplosion`** (`storyGame.js:1036-1049`) zostaje tylko dla atrapy bez terenu.
- **Z `pirateBaseFall.js`:** korek, `openDiscHole`, `releaseDisc` i `disc*`, `towerTumblePass`, fazy studni, `holdGravity`, `towerKick`, `plug*`, `promotePlanarPiece` przy HP 0.
- **`sweepTowerColumn` zostaje za flagą** do pomiaru v_odłamu / v_wieży ≤ 1,05. Lekkie ciało dostawało dotąd do 2× prędkości.
- **`debrisGate` zostaje do E7**, potem `onNodeDebris` → pula gruzu. Inaczej odłamki H-T trafiłyby do `hullDebris3D`.
- **Poza tym:**
  - `DISC_PIN_GRID` o nieskończonej wytrzymałości;
  - u wieżowców `baseBreak` + `breakPiece` i skóra `skin` na pełnej wysokości.

## 4. Sekwencje

### 4.1 Wieżowiec W-1/W-2

**Przygotowanie:**
- stropy co 126 j., rdzeń 120 × 120, słupy;
- graf ~18 poziomów × (8 sektorów + rdzeń) ≈ 160 bloków, zagęszczony w pasie i przy podstawie do ~200 [S];
- 1–2 tys. L2;
- ciałem gry w pasie zostaje dzisiejszy kawałek płaski.

1. **Strzał** (|z| ≤ 70). Krater w ciele pasa jak dziś. Martwe komórki zmniejszają pole wiązań bloków; kawałki L2 odpadają (`STRUCT_RELEASE`).
2. **Fala w konstrukcji** (nowa reguła, deterministyczna, niezależna od kamery). Trafienie, rakieta, torpeda albo fala reaktora (kula R 300–420 przy z ≈ 0) dają:
   - impuls J do grafu;
   - spadek wytrzymałości wiązań kawałków L2 nad trafieniem, malejący z wysokością;
   - kawałek odpada, gdy wiązanie straci wytrzymałość.

   Zgodne z F0: broń zmienia pęd i wytrzymałość, nie kasuje węzłów. Tylko ta reguła daje kruszenie wysoko: ponad z ≈ 420 (~75% widocznej wysokości) broń nie sięga. „8 zerwanych w 14 s” z benchmarku to wiązania wyzerowane wprost przez `hitSector`.
3. **Narastanie.** CG przenosi ciężar. Przy wykorzystaniu > 0,6: rysy, gasnące okna, strużka gruzu. Wiązania ponad limitem słabną.
4. **Kaskada elewacji.**
   - Panel bez podparcia odpada: 1 blok → L2 (obraz), ≥ 2 bloki → klaster gry.
   - Bez kalibracji per poziom grozi pionowy plaster pełnej wysokości (Ronan Point).
   - Test: uszkodzenie poziomu 15 daje przechył albo zgniot od góry.
5. **Utrata nośności.**
   - Kierunek przechyłu: od środka podparcia do środka masy. Podcięcie +x → +x, lustro → −x [P].
   - Z góry czytelny jest **przechył**: 15° przesuwa dach o ~354 j. (121 px na E1, 45 px na E2).
   - Zgniot w miejscu zmniejsza dach tylko o 6–18% [S].
   - Rekomendacja D11: przechył do 30–45° przed zgniotem.
6. **Zawalenie warstwowe.**
   - Zawias pęka, front z κ, 20–30% masy poziomu idzie w gruz; przy każdym piętrze pierścień gruzu, u podstawy pył.
   - Przy g 400 dach spada w 2,6 s i wygląda jak model. A/B z g 60–100 (5–7 s) — D12.
7. **Płaszczyzna gry.**
   - Front zjada ciało pasa po 5–20 węzłów na krok (+0,1–0,4 ms [S]). Rozpad płaskiego kawałka (1,5–6,7 ms [P]) wchodzi w budżet zerwań.
   - Przekrój klastra to przeszkoda i taran (D5). Pomost — D13.
8. **Fabuła.**
   - „Zniszczony” = HP 0 albo utrata nośności przekroju (pęknięty zawias, ruszony front). Oderwany panel się nie liczy, inaczej baner `mission01.js:280-289` wyskoczy po pierwszej kaskadzie. Etap liczy się raz.
   - `collapse` przy HP 0 = „graf, utrzymanie → 0”.
   - HP 0 poza bańką 7 km (`worldBodies.js:43`) aktywuje graf bez ciała pasa.
   - Ujęcie kamery — D15.

### 4.2 Dysk („tarcza”) i habitat

**Przygotowanie:**
- graf 6 pierścieni × wycinki ~300 j. × 2 warstwy = 300–500 bloków, z wiązaniami osiowymi (same 2 warstwy laplasjanu nie dadzą zginania);
- **pole grubości u8** (~5,9 tys. komórek po 45 j.): rów to ubytek grubości, otwór to 0;
- blok płyty niesie:
  - id modułu atmosfery (`pirateBaseAtmosphere.js:29`): przebicie → `breach` z punktem pola, klaster dziedziczy wyrwy (`rehomePirateBaseVents`);
  - opcjonalnie kotwicę windy (D17);
- `section` do H-C i bębna, `support` zamiast `DISC_PIN_GRID`;
- H-C i bęben mają grafy od ekranu ładowania.

1. **Szyja.**
   - Uderzenie bokiem przy 80–97° to ~0,8–1,4 km/s krawędzią talerza [S]: ten sam rząd energii co upadek z 900 j/s, a mniejszy styk. Jeden próg może nie rozdzielić „trzyma” od „przebija”.
   - **Prototyp progu z oboma scenariuszami przed E6.** Awaryjnie próg zależy od utrzymania.
   - Bok wieży ma się płaszczyć jak dziś (prośba z 10-15), co wymaga styku węzły H-T × pole dysku w E2/E6 (R5).
   - Rów w kształcie boku wieży (D7).
2. **HP 0.**
   - Wybuch szyi to prawdziwy impuls. Utrzymanie zanika w ~2–3 s (D8): to zegar i jedyny parametr fabularny.
   - Krok HP 0 ≤ 8 ms wymaga przygotowania na ekranie ładowania (`discMinZ`, rzut stojącej wieży, pominięcie `_transferFragmentMotion` dla ciała w spoczynku). Zostaje ~0,5–1 ms [P/S].
3. **Przebicie.**
   - Węzeł H-T czyta komórkę pod sobą. Ciśnienie ponad nośność zjada grubość, przy 0 komórka ginie.
   - Masa komórki przejmuje prędkość wieży, wieża traci ten pęd i energię zerwania; reakcja na całe ciało (§ 3.5 p. 5).
   - Otwór to suma przekrojów wieży w czasie.
   - Benchmark nie ma progu (`obrys.mjs:90-95`): 4,4–4,6 tys. komórek, 0,05 ms p95 [P]. Próg i styk sprężysty są niezmierzone.
4. **Korek** dokleja się do czoła wieży (obraz przypięty, kruszony przy lądowaniu), a brzeg dostaje składową promieniową. Inaczej gruz korka, startując pod wieżą, ląduje pierwszy, wbrew prośbie z 10-19. Kryterium E6: wieża ląduje przed pierwszym gruzem korka.
5. **Reszta dysku.**
   - Linie załomu to wzór prefraktury (ziarna promieniowe), nie wynik naprężeń.
   - Wyspa zewnętrzna opada wewnętrzną krawędzią na zawiasie.
   - „Nic nie przegoni wieży” dotyczy komórek; klastry H-C i bębna mierzy E6.
6. **H-T → klastry** z szablonu po minięciu dysku; odkształcenie zamrożone w kawałkach. Rezerwa: komórka 67 (§ 1.3).
7. **Lądowanie.**
   - Klastry pękają po wiązaniach prefraktury, potem `freezeBody` i ruina.
   - Uderzenia:
     - obrys z OBB bloków, nie `bodyFootprint` (`:331-371`);
     - `kind` dziedziczony (klaster H-T = `tower`, wstrząs i komunikat, `index.html:33825-33832`);
     - `deepBlast` z pola przebicia.
   - Fabuła:
     - `_baseFall.phase` bez zmian;
     - limit 40 s (`index.html:33813-33822`), `holdSec 26` (`storyGame.js:1022-1033`) i kadr `falling` (`:33887`) z pomiaru HP 0 → osiadanie, p95 + 20%;
     - tempo: wieża ~14 s, podsumowanie ~25–30 s, zniszczenie wieży ~16%, ±10%.

### 4.3 Kratery na planetoidzie (E8, po D1)

- **Łata wysokości:**
  - 256² × 60 j. w miejscu upadku;
  - `radius()` czyta ją dwuliniowo, a punkty styku klastrów wgniatają ją nadmiarem impulsu;
  - jest prawdą gry: test „teren = wierzchołki renderu”.
- **Render:**
  - 1 rysunek, r32f wierszami (`zakresyWysylki`), `ROCK_DENT`;
  - koszt < 0,1 ms CPU na uderzenie [S].
- **Bez łaty krateru nie będzie:** oczko siatki skały to ~785 j. [S].

### 4.4 Widoczność

Pas i trafienia zostają bez zmian. Rozmiar elewacji na ekranie [S]:
- **E1:** 5120 × 1440, zoom 0,341, kamera ~6,7 tys. j.
- **E2:** 1920 × 1080, zoom 0,128, kamera ~13,4 tys. j.

| element | E1, 1,5 km | E1, 3 km | E2, 1,5 km | E2, 3 km |
|---|---|---|---|---|
| widoczna elewacja | 99 px | 211 px | 17 px | 36 px |
| piętro 126 j. | 10 px | 22 px | 1,8 px | 3,7 px |
| pas broni | 4,7 px | 10 px | 0,9 px | 1,9 px |

- Widać tylko wewnętrzną ścianę, a gracz trafia głównie ją.
- **Kruszenie elewacji czyta się tylko na szerokim ekranie, przy wieżowcu ≥ ~3 km od statku.**
- Na 16:9 zostają dach, przechył, gruz poza obrysem i pył.

## 5. Obraz bez wokseli

- **Kawałki L2:**
  - Voronoi 3D przycięty do brył (box, cyl, cone, torus);
  - rozkład rozmiarów potęgowy, ziarna wyrównane do stropów i słupów;
  - ściany przełomu z szumem, spójne po obu stronach (dziś ~18 trójkątów na kawałek, co grozi „wielkimi kwadratami”);
  - twarze zewnętrza z atrybutami skóry, przekrój jako nowa gałąź grafu skóry (beton, pręty, żar HDR > 1). Zmienia to pipeline'y dzisiejszych skór (pułapki 15, 29);
  - woksele tylko jako nośnik dla GLB.
- **Rysunki:**
  - partia na archetyp × BG/FG (`clipZ`), **jeden rysunek pośredni** (`CrGpuMain` zajęty w 57% [P]);
  - `pieceId` → blok → poza klastra, f64 względem `sceneOriginNearCamera`;
  - martwy kawałek poza bryłą obcinania (pułapka 16);
  - podmiana przy aktywacji.
- **Kratery:**
  - ≤ 32–64 kule SDF z wczesnym odrzutem po odległości (bez niego +0,8–2 ms GPU [S]);
  - po przepełnieniu scalanie albo przejście w L2 (benchmark: 83 trafienia do zawalenia);
  - **osobny wariant pipeline'u z `discard`** (flaga nie przywraca early-Z): 8 kluczy na rodzinę w rozgrzewce;
  - rysy z u8 interpolowane między blokami.
- **Kontur dziury** z pola odległości: 45 j. z kamery upadku to 4,8 px, z bitu wyjdą schodki.
- **Gruz** (balistyczny, bez zderzeń między sobą):
  - nowa pula L2 w locie (kernel `addFxStep`, lądowanie analityczne jak `landTime`);
  - iskry, błyski i dym z `Fx3D` / `SparkSystem3D`, żwir i pył skały z pul `pirateRockImpactFx`; własny żwir 32k to 0,2–0,6 ms GPU [S];
  - **pył w szczycie to cząstki**, bo domeny wybuchów zajmują 14–16 z 18;
  - gruz FG może zasłaniać okręty — sprawdzi nagranie E5.
- **Rozgrzewka (`'loading'`):** materiały × BG/FG × indeks × `discard`, gruz z `WARIANT_INSTANCJI`, kernele w `warm`, łata; cel 0 pipeline'ów synchronicznych.
- **Rysunki netto:** +8–14 [S]; limit sprawdza się po wycofaniu starej ścieżki.

## 6. Etapy

| etap | zakres | bramki | sesje |
|---|---|---|---|
| E0 | ziarno w narzędziach (`ziarno.mjs`); baza w grze: GPU szczytu przy **Ultra** + CPU workera, 120 Hz | 3/3 identyczne; tabela bazowa (`gpu-baza-gra.mjs`, `upadek-gra.mjs --query renderWorker=1`); GPU w prawdziwym oknie, przy ciszy sesji, nie nocą | 0,25–0,5 |
| E0b | narzędzia, testy, reguły (§ 6.1) | lista pękających testów | 0,5 |
| E1 | `structureGraph.js`: CG z fazami, kalibracja per poziom, zawias, front κ, pękanie wysp; prototyp progu dysku | wspornik ≤ 5% (moment rośnie z długością); ≤ 5% przy zerwaniach; podcięcie ±x → ±x; poziom 15 → przechył albo zgniot; 60/120 Hz ±5%, bit w bit 3×; ≤ 0,1 ms średnio; wszystkie grafy misji ≤ 1 ms najgorszy krok w Chrome | 1–2 |
| E2 | `rigid`, dźwignie 1–4, rigid × rigid, styk H-T × pole | bit w bit `beamLocalSolverExact`, `beamNarrowphase`, `beamStore3D`; progi `destrukcjaTaran`, `pirateBaseFall`; stos 100 / 200 / 256: **p95 ≤ 1 / 2,5 / 3,5, max ≤ 6 ms Node**; para ≤ 1,5 µs; R11 | 3–4 |
| E3 | prefraktura (gra + worker), wnętrza, wypiek offline | ≤ 1 s na archetyp; misja ≤ 3 s ściany albo tylko offline; pokrycie ≥ 99%; bit w bit gra ↔ worker; walce i torusy; priorytet skór; pamięć; czas `'loading'` | 2–3 |
| E4 | `src/3d/structures/`, `structBlock`, rekordy, presety, rozgrzewka | 0 synchronicznych (`start-sync-gra.mjs --stres 25`); worker ≤ +0,5 / +1; kratery ≤ 0,3, żwir ≤ 0,5 ms GPU przy Ultra; GPU **w ruchu** (`--wkAb`); kodowanie, `off` ≡ worker, pauza, przepełnienie; szew +2–3 | 4–6 |
| E5 | wieżowce: fala, nośność, kaskada, zawias, front, pomost, HP 0 poza bańką; `window.StructureTune` z konsoli, bez suwaków F12 (o ile nie złoży go demo D20); HP bloków klastra i broń wobec klastra; PRNG rozpadu — propozycja, do decyzji (§ 3.7, zasada 9) | p95 ≤ 6, max ≤ 12 ms w grze (`baza-zniszczenie-gra.mjs --tryb etapy`); GPU i worker; 4 wzory strzałów → 4 kierunki (stałe ziarno); etap raz; nagranie E1/E2, A/B g | 2 |
| E6 | dysk: osiowe wiązania, grubość, `support`, rów, korek, atmosfera | IoU ≥ 0,7; szyja: ≤ 5% bloków, bok płaszczy się; wieża przed korkiem; v_odł / v_wieży ≤ 1,05; H-T ≤ 4 ms p95 Node, ≤ 1 tys. węzłów (`node scripts/destrukcja-taran-sym.mjs --tryb upadek --koszt 1`); GPU | 3–4 |
| E7 | H-C, bęben, H-T → klastry, lądowanie, `_chainExplosion`, ruina, wycofanie | HP 0 ≤ 8; krok ≤ 16,7; p95 ≤ 12; klatki ≤ 33 (`upadek-gra.mjs`, `przestoje-gra.mjs`); `grows` = 0; GPU ≤ dziś przy Ultra; „ostatni wieżowiec + HP 0 w jednym kroku”; po osiadaniu ≤ 0,3 ms, worker ≤ 2,7, rysunki ≤ 64; czasy fabuły z pomiaru; atrapa; `?physHz=120`; nagranie A/B | 2 |
| poprawki | rundy po ocenie użytkownika (F2, upadek i Wojna miały co najmniej jedną) | — | 2–3 |
| E8 | łata skały (po D1) | < 0,1 ms CPU, ≤ 0,1 ms GPU, 1 rysunek | 1–2 |
| E9 | bańka, ruiny, `worldDamageSave.js` (misja 1 nie ma zapisu, E9 nie blokuje E0–E7) | uśpione 0; F5 bit w bit; aktywacja ≤ 2 ms na krok | 1–2 |
| E10+ | ogólność (§ 10) | zrzuty, aktywacja, uśpione = 0 | 14–20 |

**Razem ~36–51 sesji, misja 1 ~20–27** [S] (przed weryfikacją: 21–28 i 14–18). D14 = tak poszerza E7.

Kolejność:
- E1–E2 dowodzą rdzenia przed obrazem;
- E4 daje obraz, zanim E5 trafi do oceny okiem.

**Go / no-go:**
- po E1 — brak przechyłu z grafu;
- po E2 — stos 200 ponad 2,5 / 6 ms Node.

Zapas na wypadek „no-go”: H-T z komórką 67, niższy sufit klastrów, część lądowania jako gruz obrazu.

### 6.1 Testy, narzędzia, reguły

- **Testy obszaru:**
  - już są (E1, E2): `structureGraph` (w tym bez alokacji — `untilSteady`, `--concurrent-recompilation-delay`), `beamRigid3D`, `beamRigid3DAlokacje` (osobny proces), `beamPlateField3D`;
  - E0b: `structureZasady` (gra nie losuje, bez three / DOM, importy z listy i przechodnio bez three, zegar tylko w `nowMs`, `Math.hypot` tylko w budowie archetypu; zastępuje dawny test „gra nie losuje” w `structureGraph`), `structureZegar` (szpieg zegara: przy `timing` false 0 odczytów, przy zegarze przesuwanym o 10 ms na odczyt wynik bit w bit — podcięcie W-1 z wyspą swobodną, stos 24 klastrów, klaster przez płytę), `beamRigid3DRozgrzewka` (rozgrzewka w środku przebiegu bez śladu: pola systemu, haki niewołane, hasz sceny 2× bez i 1× z rozgrzewką, numeracja ciał, drugie wołanie puste); w `structureGraph` determinizm archetypu rozszerzony o `k0`, `limT`, `limS`, `anchorCap`, `u0` (W-1 i dysk, po `structureReset` egzemplarza) i test `todo` 60 / 120 Hz w szyi dysku (do E6); budżety pod `WOLNY_ZEGAR_MS=0/2/5/10`;
  - później — „Testy później” niżej.
- **Testy innych obszarów, które zmienią się przy wpinaniu** (etap i przyczyna; aktualizować razem z kodem, nie wyłączać):
  - PĘKNĄ:
    - `pirateBaseFall`: E6 — `fallKindOf(mk('disc'))` (dysk przestaje być bryłą belek); E7 — obrys `bodyFootprint` → OBB bloków klastrów, „wrak dziedziczy studnię” potrzebuje wariantu `rigid`; E8 — powierzchnia skały w wierzchołkach renderu z łatą wysokości;
    - `pirateBaseIntegrity`: E5 — regex `breakPiece(…)) { markBaseBroken(wPiece)` → `collapsePirateBaseChunk`, `highrisesDown` i bezpiecznik z grafu; E7 — pule ćwiartek bębna (`createPiecePools`, `damagePool`) zmieniają rolę;
    - `storyMission`: E7 — `blows ≥ 12`, `≥ 40` / `< 25` liczą harmonogram `_chainExplosion`, czasy `holdSec` i limity z pomiaru (D22); E5 — etap wieżowca raz;
    - `pirateBase`: E3 — wnętrza (D9) a `SCENE.instances < 9000`, `PB_MAX_LAMPS`, pas ±4 `dryDockPlanarSolids`; E6 — „kotwice: każdy kawałek-ciało” dla dysku; E5 — kotwica `section` a „jeden kawałek”;
    - `portBuildingSkinBake`: E3 / E4 — przekrój, atrybuty L2 i wnętrza zmieniają wypiek (zmiana wzorca); E6 — przypadek „sektor dysku” przenieść na H-T;
    - `destrukcjaTaran`: E6 — „szyja habitatu … uderza bokiem” (dysk staje się polem płyty);
    - `hullDamageCommands`: E7 — „bramka odłamków (debrisGate)” (`habitatFallMutesDebris`); etap PRNG — „HULL_DEBRIS = dawna droga” podmienia `Math.random` (po PRNG rozpadu potrzebne API ziarna);
    - `worldBodies3D`: E4 — warianty WGSL `skin` / `skinBatch` / `skin3Batch` (przekrój jako nowa gałąź grafu skóry, § 5); etap PRNG — `withSeededRandom` / `SHATTER_SEED` przestaje sterować `shatter`; E7 — partie starych skór → L1/L2;
    - `szewRenderu`, `snapshotPack`, `mirrorBody`, `graphicsQuality`: E4, planowo (sufit +2–3, `BODY_FLAG.RIGID`, `structBlock`, pule w presetach).
  - WARUNKOWO:
    - `worldBodies`: etap PRNG — progi `fragments ≥ 2/3/4`, `debris ≥ 10%` (`breakPiece` losuje `Math.random`); tylko jeśli kolejka `_queue` przejdzie na budżet liczbowy (dziś `buildBudgetMs`) — `T.buildBudgetMs = 1e6`;
    - `beamSolidHits`: `T.buildBudgetMs = 1e6` — tylko przy tej samej zmianie budżetu;
    - `zegarKlatkiEfektow`: regex `structural, Core3D.frameNowMs() * 0.001` w `hullDebris3D.js` — tylko jeśli pula gruzu E4 / E7 przejdzie przez `hullDebris3D.js` / `window.spawnHullDebris`; nowa pula w `src/3d/structures/` testu nie rusza — wtedy analogiczny test (pozy z `frameNowMs`, czas gruzu z `SimClock`).
  - DO ROZSZERZENIA (nie pękną): `pirateBaseAtmosphere` — wariant klastra dla `rehomePirateBaseVents` (E6 / E7; testy wołają go na encjach z ręki, nie `promotePlanarPiece`); `pirateBaseWorld` — `collapsePirateBaseChunk` w API stanu kawałków (E5; tam też jest `collapsePirateRock`); `pirateRock` — lina windy reaguje na pęknięcie kawałka dysku (D17, E6); `pirateRockImpacts` — OBB bloków i `ROCK_DENT` (E7 / E8; test kodu 112 zostaje).
- **Testy później:**
  - E3: archetyp gra ↔ worker bit w bit (identyfikatory L2, L2 → L1); pamięć = świeży wypiek (hasz brył + wersja generatora); pokrycie ≥ 99%; walce i torusy;
  - E4: preset → pula; przepełnienie `STRUCT_*` (≤ 64, zbiorczo, dekoder); pauza gruzu (`SimClock`); `off` ≡ worker (`structBlock`, `BODY_FLAG.RIGID`);
  - E5: etap raz (baner `mission01.js` raz); 4 wzory strzałów → 4 kierunki przy stałym ziarnie (po PRNG rozpadu); broń wobec klastra (HP bloku, `STRUCT_CARVE`; stojący wieżowiec bez HP bloków); bez alokacji na ścieżce gry (`onClusterContact` → graf, `structureSolveIsland`, front; taran klaster × ciało płaskie — docisk bez zgniotu w stanie ustalonym, osobny proces — zgniot zabija węzły i rozpad alokuje z założenia, więc taran ze zgniotem stanu ustalonego nie ma); złote testy z `warmUpClusters` na ekranie ładowania; `StructureTune`, jeśli nie zrobi go D20 („klucz biegu nie zmienia kalibracji”, „łata od kroku 0 = archetyp z łatą”, klucz kalibracji → błąd, bez łaty `S.tune === A.tune`);
  - E5 / E7: klaster nie jest zimnym wrakiem; pole `rigid` w `hullColdSnapshot`;
  - E6: szyja na polu płyty (≤ 5% bloków, bok płaszczy się; zdjąć `todo` 60 / 120 Hz); IoU ≥ 0,7; lina windy (D17);
  - E7: implozja na atrapie (bez terenu `_habitatImplosion`, z terenem bez `_chainExplosion`); „ostatni wieżowiec + HP 0 w jednym kroku”; `grows` = 0; kolejność upadku (D22);
  - E8: teren = wierzchołki renderu z łatą (`ROCK_DENT`);
  - E9: F5 bit w bit z ruinami; uśpione = 0 ms; aktywacja ≤ 2 budowle na krok.
- **Narzędzia:**
  - już są: `scripts/struktura-sym.mjs` (graf nośny, E1), `scripts/klastry-sym.mjs` (klastry i pole płyty, E2; tryby `stos | plyta | taran | bryla` — trybu przy ringu jeszcze nie ma, dojdzie w kroku ringów § 10), `upadek-gra.mjs` (`--fall`, `--bramka`, `odlamki`), `destrukcja-taran-sym.mjs` (`--ziarno`, `--prebuild`, `--pct`, `--koszt`), `gpu-baza-gra.mjs` (sonda GPU na klatkę, `--odmroz`), `zniszczenia-gra.mjs --final`, `baza-zniszczenie-gra.mjs`;
  - zmiana w E6 / E7: kolumna sektorów → komórki pola, `--fall disc*` i `--bramka` znikają;
  - nowe: kolumny grafu w `destrukcja-taran-sym` (E5); prefraktura — `.tmp/destrukcja-2026-11-03/bench/prefraktura.mjs` (poza repo, z walcami i torusami) → w E3 `scripts/prefraktura-sym.mjs`.
- **Reguły:** `zawalenia-budowli` (od E0b; `paths:` `src/game/structure*.js`, `beamRigid3D.js`, `beamPlateField3D.js`, `tests/structure*.test.mjs`, `tests/beamRigid3D*.test.mjs`, `tests/beamPlateField3D.test.mjs`, `scripts/struktura-sym.mjs`, `scripts/klastry-sym.mjs`, ten plan; `src/3d/structures/**` dopiero z pierwszym plikiem w E4 — strażnik `agentsMd` wymaga śledzonego pliku pod każdym globem; wiersz indeksu w AGENTS.md z dopiskiem „niewpięte w grę do E5”). W E0b zaktualizowane: `ciala-swiata` (opis E1 przeniesiony, poprawka „bez dymu i wybuchów”), `kadluby-belki` (opis E2 przeniesiony, zostaje część silnikowa), `wybuchy-gaz`, `baza-piratow`. Później: `render-worker`, `core3d`, `opcje-grafiki` (E4), `electron-wydanie` (E3), `fabula` (E5 / E7), `flota-ai` (E5), `wraki` (E5 / E7).
- **Hak w AGENTS.md — w E5** (AGENTS.md ~30 tys. / 40 000 znaków; dawne „31 261” to bajty). Tekst do sekcji „Rozgrywka”, po punkcie o `storyBaseBreak`: „Zawalenie budowli z grafem nośnym (wieżowce bazy od E5, habitat od E7, potem każda budowla z archetypem) → graf `structureGraph` przez `pirateBaseWorld` (`collapsePirateBaseChunk`), masy jako klastry `HullBodies.createCluster`, nie `breakPiece`; pętle po wrakach i ciałach (AI, celowanie, zimne wraki) rozpoznają klaster (`rigidCluster`) — reguła `zawalenia-budowli`.” Część o potoku archetypów (`buildStructureArchetype`) — dopiero, gdy funkcja powstanie (E3 / § 10).
- **Dopisek w `PLAN-zniszczenia-swiata-3d.md`** — zrobiony w E0b (pod tabelą etapów § 7 i w nagłówku).

### 6.2 Stan etapów

- **E0 (2026-11-04, część CPU — zrobione).** `scripts/destrukcja-taran-sym.mjs`: `--ziarno` (domyślnie 12345 — Math.random z LCG; 0 = dawne losowanie), `--prebuild` (domyślnie 1 — szablony z ekranu ładowania jak w grze), `--pct 1` (percentyle kroku co 1 s i po HP 0). Upadek 60 Hz: 3/3 przebiegi identyczne (stan końcowy i zdarzenia), testy `destrukcjaTaran` i `pirateBaseFall` zielone. Baza w Node po HP 0 [P, 3 przebiegi]: `stoi` p50 0,40 / p95 11,7–12,1 / p99 15,3–16,1 / max 62–63 ms (krok HP 0); `lezy` p50 1,8 / p95 14,7–14,9 / p99 23,2–23,8 / max 48–50 ms; najgorsze okno 1 s (p95): `stoi` 17,2–17,6 ms (sekunda po HP 0), `lezy` 24,0–25,0 ms (lądowanie).
- **E0 (2026-11-04, część GPU — zrobione headless).** `gpu-baza-gra.mjs` (5120×1440, `grafika=ultra&limitKlatek=120`, worker, Yamato, finał „etapy” — 65 strzałów, habitat padł sam; `--slad 0`, sonda znaczników GPU w każdej klatce, `--odmroz 1`) i `upadek-gra.mjs --query renderWorker=1` (1600×900, CPU wątku gry). Headless w tle, po kolei; użytkownik pracował (CPU ~30%), obcych procesów GPU nie było. Raporty: `.tmp/zawalenia-e0/gpu-ultra-headless-2/raport.json` (powtórka, commit `ccbeae30`), `.tmp/zawalenia-e0/upadek-worker/raport.json`. GPU na klatkę, render + compute, p50 / p95 / maks. [P]:
  - przed ostrzałem 2,18 / 2,48 / 3,06 ms; ostrzał 4,3–7,9 / 6,2–12,0 / ≤ 17,1 ms (nvidia 97–99%, kolejka GPU do 236 ms — GPU nasycone);
  - **szczyt = lot z łańcuchem wybuchów, nie uderzenia:** ft 4,5–6,5 s — 9,85 / 18,16 / 20,88 ms (compute p50 5,62 ms, z tego `fx:wybuchy` 4,97 ms na klatkę przy 3,7 dispatchu; render 4,43 ms: ortho 1,33, bg 1,16, fg 0,76, maska słońca 0,74, post 0,52); ft 6,5–8,5 s — 10,03 / 15,49 / 20,07 ms;
  - uderzenia (wieża ft 13,45, dysk ft 15,97; ft 12,6–20,1 s): 4,9–6,2 / 9,2–10,7 / ≤ 13,1 ms; dalej 4,30 / 5,42 → 3,40 / 4,05 ms; osiadło ft ~25,7 s (184 uderzenia, 170 gorących / 145 śpiących wraków);
  - po osiadaniu (świat odmrożony) 2,67 / 3,08 ms, nad gruzem (zoom 0,3) 2,76 / 3,21 ms;
  - render w upadku 2,5–4,4 ms (p50) przy 190–330 rysunkach — budżet zawaleń na GPU ograniczają gaz i wybuchy, nie rysunki brył;
  - CPU workera p50 3,0–4,3 ms, p95 ≤ 10,2 ms; strona po upadku (ft 18–26 s) 48–55 kl./s przy GPU ~2,8 ms — wąskie gardło to wątek gry (do sprawdzenia w E3+);
  - pipeline'y synchroniczne w oknach 0; przy starcie fazy shipyard 9 × „kompilacja w grze” 27–103 ms (modele floty, okręt 3D, rozpad stacji: fade, neptune-station.glb) — poza rozgrzewką (zasada żelazna 5, poza obszarem);
  - CPU wątku gry w upadku (`upadek-gra`, `stoi` / `lezy`): uderzenie wieży 14,50 / 13,18 s, dysku 16,82 / 14,33 s, osiadło 24,92 / 26,10 s; najgorszy krok 21,8 / 31,4 ms (`lezy`: średnio 22,9–28,9 ms 1,3–2,1 s po uderzeniu dysku, 9–11 kroków na 0,25 s zamiast 15 — symulacja nie nadąża); klatek strony > 50 ms 4 / 24; po osiadaniu krok 0,3–0,7 ms.
  - Bramka E7 „GPU ≤ dziś przy Ultra” mierzy względem tych liczb (szczyt p95 ~18 ms w locie z wybuchami). Nie zmierzone: GPU w prawdziwym oknie z vsync (headless — kolejka i kompozycja Chrome inne; koszt kompozycji kanwy 2D jest poza znacznikami), przy 99% zajętości czasy passów są raczej górną granicą.
  - Znalezione poza obszarem (core3d / render-worker): `Core3D.gpuFrameMs` w workerze grupuje znaczniki po `renderer.info.frame` (takty rAF workera); przy zapchanym GPU worker tyka 22–69 razy na 2 s przy ~240 renderach, więc wartość jest sumą dziesiątek klatek (HUD 245 ms). Czyta ją PerfHUD „Obraz 3D (worker)” i rozdzielczość dynamiczna przez kanał zwrotny (`stepDynamicResolution`, `GPU_FRAME_MS`) — przy włączonej opcji skala spadłaby za mocno. Do sprawdzenia w oknie z vsync i poprawki w Core3D (np. licznik `renderSingle` zamiast `info.frame`).
  - Pierwszy przebieg (headless bez limitu klatek, ślad Chrome w oknach) nie dał znaczników GPU w ostrzale i fazie uderzeń; najgorsze ZMIERZONE okno 9,41 ms średnio (ft 5,0–7,2) zgadza się z powtórką. Sonda liczy teraz GPU na klatkę z własnego licznika (`naKlatke`, `SONDA_GPU_OKNA`).
- **E0b (2026-11-04 — zrobione).** Reguła `.claude/rules/zawalenia-budowli.md` (wiedza E1 z `ciala-swiata` i E2 z `kadluby-belki` przeniesiona — w starych regułach zostały odnośniki i część silnikowa), wiersz indeksu w AGENTS.md („niewpięte w grę do E5”), poprawki nieaktualnych zdań („bez dymu, ognia i wybuchów” — `ciala-swiata`, `wybuchy-gaz`; D2), punkt PRZEBUDOWA ZNISZCZEŃ w `baza-piratow`, dopisek w `PLAN-zniszczenia-swiata-3d.md`; testy `structureZasady`, `structureZegar`, `beamRigid3DRozgrzewka`, rozszerzony determinizm i `todo` szyi w `structureGraph` (§ 6.1); lista testów, które zmienią się przy wpinaniu, z etapami (§ 6.1). Bez zmian w kodzie gry. `StructureTune` przeszedł do demo D20 / E5, hak w AGENTS.md — do E5, PRNG rozpadu — do decyzji (§ 3.7).
- **E1 (2026-11-04 — zrobione, go).** `src/game/structureGraph.js` (czysty: bez three, DOM i `Math.random`), `tests/structureGraph.test.mjs`, `scripts/struktura-sym.mjs` (tryby `podciecie, wspornik, kondygnacja, front, fala, zawias, ciezkie, dysk-szyja, dysk-upadek, prog, koszt`). Bramki [P, Node]:
  - wspornik: moment 0,0% od Σ m·g·x przy `shearK` 1e-6 (laplasjan benchmarku tracił 60–85%, ścinanie 1e-4 — do 3,8%);
  - ≤ 5% przy zerwaniach: ocena tylko przy reszcie ≤ 0,02 (ciężkie losowe uszkodzenia, 8 ziaren: błąd ≤ 0,020); niezbieżne mechanizmy pękają trybem `MECH`;
  - podcięcie ±x → przechył ±x; D11 na 192 przebiegach (W-1, W-2, strony ±x / ±y, 8 ziaren × 3 warianty): 187 ku podciętej / 0 w inną / 5 pionowo przy 120 Hz (W-1 od −y — przełom w kondygnacjach 2–5), 190 / 0 / 2 przy 60 Hz;
  - poziom 15: symetrycznie front do ziemi, jednostronnie zawias ku podciętej; front κ 0,1–0,3 dochodzi do ziemi (12/12 z gruzem 0,2–0,3), przy κ 1 staje po 1–3 piętrach;
  - fala w konstrukcji: oderwanie przy 11,6 s zamiast 23,2 s (J 2000);
  - bit w bit 3×; 60 / 120 Hz ±5% — poza dyskiem w szyi (rów −20%, energia −34%; do sprawdzenia przed E6);
  - koszt: wieżowiec 0,03 ms średnio (max 0,39), dysk 0,10 (0,66), W-1 + W-2 + dysk naraz max 0,99–1,11 ms — Chrome nie mierzony, bramka „≤ 1 ms w Chrome” zostaje na E5.
  - **Ustalenie: jeden próg nośności dysku nie rozdziela szyi od upadku** (upadek przebija przy σ ≤ 6, szyja trzyma od σ ≥ 160 — luka ×27) → nośność płyty od utrzymania (D8): σ = σ_free + hold · (σ_held − σ_free), σ_held 200, σ_free 4. Szyja: 0 otworów, rów 154–195 z 5416 komórek, graf traci 0–2 bloki. Upadek: wieża dochodzi do dysku ≥ 3,46 s po HP 0 (utrzymanie 0), za dyskiem 550 / 843 / 1122 j/s z 900 / 1300 / 1700; IoU 0,983 w modelu 1-DOF nic nie dowodzi (kształt z konstrukcji) — prawdziwe IoU w E6.
  - Przyjęte przez orkiestratora, do sprawdzenia w E5 / E6: podpory dysku trzymają połowę nośności przy utrzymaniu 0 (`supportHoldFloor` 0,5 — dysk po HP 0 nie odpada sam, puszcza przeciążony wieżą i gruzem); `debrisFrac` 0,2 (przy 0,25–0,3 i κ 0,3 front staje); zapas dysku `u0` 0,15 (przy 0,5 szyja zjadała 134 z 316 bloków); duża wolna wyspa pęka 0,1–0,2 s po styku (zimny start `structureSolveIsland`: wołać co krok, aż wynik ≥ 0). Pokrętła E5: `waveJ` (~5% ciężaru), `waveVert` 0,15, przełożenie broni na J, `shearMech` 0,05.
- **E2 (2026-11-04 — zrobione, go).** `src/game/beamRigid3D.js`, `src/game/beamPlateField3D.js`; wpięcie w `destructorBeams3D.js` tylko w `update` (rozdział par), `integrate`, `freezeBody` i `continue` dla `rigid`; `hullBodies.js`: `createCluster`, `clusterCount`, `freezeCluster`, hak `onClusterContact`, `warmUpClusters`; testy `beamRigid3D`, `beamRigid3DAlokacje` (osobny proces), `beamPlateField3D`; narzędzie `scripts/klastry-sym.mjs --tryb stos|plyta|taran|bryla`. Bramki [P, Node, mediana z 3]:
  - stos 100 / 200 / 256 klastrów: p95 0,48 / 1,31 / 1,74, max 0,76 / 1,65 / 2,21 ms (zimny proces max 2,6 / 3,4 / 5,3) — no-go „stos 200 ponad 2,5 / 6 ms” nie zachodzi;
  - para klaster × klaster 0,5–0,7 µs; broadphase w szczycie 400–690 par (zamiast 12–18 tys.); teren ~25 odczytów na klaster;
  - płyta z wieżą 13 286 węzłów: p95 1,15 ms w krokach ze stykiem;
  - R11: CCD punktów, test przez ścianę 15 j. do 9000 j/s;
  - złote testy bit w bit (`beamLocalSolverExact`, `beamNarrowphase`, `beamStore3D`), progi `destrukcjaTaran` i `pirateBaseFall`, hasz sceny bez klastrów identyczny, pełny zestaw zielony.
  - Otwarte na E6 / E7: para klaster × bryła belek 7–9 µs na wywołanie i 23–34 µs na parę ze stykiem (bramka 1,5 µs spełnia tylko klaster × klaster); taran klaster × ciało płaskie 10–25 µs na parę; resztkowe alokacje w parze z ciałem belek (~5 KB / 60 kroków) i w płycie (~4 KB); sufit 160 aktywnych dochodzi z opóźnieniem (zimny szczyt 199); broń wobec klastra (§ 3.7), pękanie klastra po wiązaniach, CCD z obrotem; `wreckPairEvery` dla wolnych par klastrów zmienia rozgrywkę — decyzja przy E7.
  - Rozgrzewka JIT klastrów (`HullBodies.warmUpClusters`, ~110 ms raz na proces) nie idzie w `init` — gra jej jeszcze nie woła. Wpiąć na ekranie ładowania razem z pierwszym `createCluster` w grze (E5) i powtórzyć złote testy z nią (przechodziły z nią w `init`).
  - Jednostki płyty: σ silnika ≈ σ E1 × masa węzła (45); wieża 43 mln przy 900 j/s przebija płytę 360 j. przy σ ≲ 2·10⁴ — strojenie w E6.
- **D20 krok 3 (2026-11-04 — gospodarz zawalenia, liczby tempa).** `src/game/structureCollapse.js` (gospodarz graf ↔ klastry, gotowy na E5), sceny 1–3 jako dane (`dema/zawalenia-budowli/scenariusze.js`, `symulacja.js`), `scripts/zawalenia-sym.mjs`, `tests/structureCollapse.test.mjs` (13 testów, ~3 s); w silniku pole `body.restDamping` + `HullBodies.setClusterDamping` (null bit w bit). Bateria sceny 1: krater r 110 / 0,3 + fala J 3000 × g/400 co 0,2 s z +x — oderwanie 2,33 s (120 Hz: 2,13) od startu, 0,83 s od pokazu (przewinięcie 1,5 s); 4 strony: 2,07–3,33 s. Scena 1 (W-1, bateria z +x), DACH NA ZIEMI od oderwania [P, Node] — tłumienie obrotu silnika (0,2/s) / bez:
  - g 400: 7,63 / 7,48 s (120 Hz: 7,65 / 7,45); przegub (zastój) 25,7° po 3,3 s, 40° po 5,7 s;
  - g 100: 15,80 / 15,07 s (120 Hz: 15,86 / 15,14);
  - g 80: 17,83 / 16,83 s (120 Hz: 17,28 / 17,77) — g 80 / g 400 = 2,34 / 2,25 (120 Hz: 2,26 / 2,39);
  - g 60: 20,90 / 19,90 s (120 Hz: 20,95 / 21,81).
  - **Decyzja (orkiestrator): tłumienie obrotu klastrów zostaje silnika (null)** — wpływ 1–6%. Tempo psuło tłumienie SPOCZYNKU i TOCZENIA w styku (`restDamp` 3/s, `restAngDamp` 2/s, `rollDamp` 3/s przy ≥ 2 stykach, bez progu prędkości): przewracanie po narożniku przy g 80 trwało dziesiątki sekund albo stało. Gospodarz zdejmuje je przewracanej wieży (`restDamping` 0) do 80° przechyłu.
  - **D12:** przy tym modelu już g 400 daje dach na ziemi 7,5–7,7 s po oderwaniu (przechył od zawiasu z małym ω0, równowaga chwiejna na narożniku, potem przewrócenie) — w paśmie „wolno 5–7 s” jest g ≥ 400; g 60–100 to 15–21 s. Do oceny okiem w demie (krok 4).
  - **D11:** podcięcie w pasie ±70 kładzie zawias 86–226 j. nad pokładem, a róg wieży (rzut 380) siada na ziemi przy 13–36° (bateria sceny 1: 25,7°) — przegub pęka ZASTOJEM, nie kątem 40°; wieża przewraca się po narożniku (bez frontu — front zrzucał ją w ziemię). 40° ± 3° z frontem tylko na pomoście nad pustką (test). Kikut pod krawędzią kruszy reguła geometryczna (wyspa na zawiasie bez par z kikutem — styk z nim zakleszczał przechył).
  - Front (scena 3, ładunek kondygnacji 13, g 400): κ 0,1–0,3 — 13 poziomów do ziemi, start 1,1 s, ziemia 4,68 s; κ 1 — staje po 2 poziomach. Scena 2 (W-2, działo J 1500 co 0,25 s): oderwanie 8,9 s (oderwany dach i górne piętra, potem zawias i przewrócenie).
  - Zakleszczenie (scena 1, 4 ziarna salwy × 4 strony, `--zakleszczenie 4`): g 400 — 13/16 wież na ziemi do 20 s, g 80 — 14/16 do 34 s; ziarno 104 (głębsze podcięcie) zostawia wieżę opartą narożnikiem przy 17–24° (stabilnie — środek masy nad podparciem), mimo pchnięć i nacisku na narożnik.
  - Uderzenie o ziemię do grafu wyspy × 0,5 (`impactScale`): przy 1 wieża rozpadała się w gruz (158 ze 178 bloków), przy 0,5 — 5–9 klastrów i ~60 bloków gruzu. Nacisk narożnika od początku przewracania (`staticEvery` 0,25) — wieża kruszyła się od podstawy, 60 / 120 Hz rozjeżdżały się o 35%; zostaje tylko dla zakleszczonych.
  - Koszt (Node, scena 1 — dwie wieże): krok razem p50 0,11–0,16, p95 0,35–0,9, max 1–11 ms (narodziny klastrów); gospodarz bez fizyki < 64 B alokacji na krok; `HullBodies.step` w tej scenie ~3 KB na krok (silnik — do E5). Wyniki: `.tmp/zawalenia-sym/` (`tempo-v4.jsonl`, `front-v3.jsonl`, `scena2-v3.jsonl`, `zakleszczenie-g400-v2.jsonl`, `zakleszczenie-g80-v2.jsonl`).
- **Następne (po decyzjach 11-04):** demo na szarych blokach (D20) — przed E3, do oceny okiem tempa (D12, skłania się ku wolno), przechyłu i „sztywnych klocków”; tam też `window.StructureTune` z konsoli (bez suwaków F12); E3 (prefraktura z wnętrzami — D9: docelowo wszystkie budowle). Do rozstrzygnięcia przed E5: etap i zakres PRNG rozpadu (§ 3.7, zasada 9), miejsce HP bloku klastra (D4). Opcjonalnie: GPU upadku w prawdziwym oknie z vsync, gdy użytkownik nie gra.

## 7. Ryzyka

| # | ryzyko | rozstrzyga |
|---|---|---|
| R1 | klastry jak sztywne klocki (blok ≥ 2 = płyta ≥ 400 j.) | strefy zgięcia, L2 potęgowe, kratery; nagranie E5 |
| R2 | klastry ×4–6 wobec benchmarku, max 13–15 ms Node [P] | E2 z dźwigniami, sufit 160 |
| R3 | jeden próg szyja / upadek | prototyp przed E6 |
| R4 | przeskok H-T belki → klastry | szablon w locie; rezerwa komórka 67; zwolnione tempo to nowa mechanika (D16) |
| R5 | zgniot H-T o krawędź płyty (szyja dziś 15,8–17,5 ms Node) | niezmierzony (w V1–V3 wieża przelatuje przez puste miejsce); E6 z polem |
| R6 | niedeterminizm | przyczyna znana; PRNG, budżety liczbowe, wolny zegar; zmienność ≠ ziarno (±20%) |
| R7 | GPU przy Ultra bez zapasu (E0 headless [P]: szczyt p95 ~18 ms w locie z łańcuchem wybuchów, `fx:wybuchy` ~5 ms; uderzenia p95 9–11 ms — § 6.2) | pył cząstkami; nie gorzej niż dziś; okno z vsync — do potwierdzenia |
| R8 | prefraktura walców, torusów i GLB (nieszczelne = skorupa) | E3, wypiek offline |
| R9 | brak zginania w grafie | wiązania osiowe lub obrót w E1 / E6 |
| R10 | „to dalej skrypt?” | `_chainExplosion` wycofany; zostają jawne: zegar utrzymania (D8), reguła fali |
| R11 | przenikanie przez kadłuby 15 j. (punkty co 30–60 j.) | E2: CCD albo gęstsze punkty |
| R12 | zbieg ostatniego wieżowca z HP 0 | bramka E7 |
| R13 | brak drogi po porażce | go / no-go po E1, E2 |
| R14 | kruszenie wysoko nie wynika z mechaniki | fala w konstrukcji, kalibracja; nagranie E5 |
| R15 | szyja w polu płyty (demo D20 krok 5 [P], `zawalenia-sym.mjs --scena 5 --hz 60,120`): (1) zależy od kroku — w czasie pokazu (18 s) przy 60 Hz graf dysku traci 1,6% bloków, przy 120 Hz 13% (ponad D7 ≤ 5%), przy ×3 przechyłu cały dysk; historia impulsów płyty prawie ta sama, a uderzenie zrywa ~6× więcej wiązań (do 9 s: 505 wobec 89); (2) PEŁZANIE — po spoczynku wieży (bez styku z płytą) uszkodzony graf pęka dalej pod własnym ciężarem: przy 60 Hz wiązania 1878 → ~1000 i 44 / 316 bloków (14%, wyspa 36 bloków przy ~24 s) po 40 s | E6: luka 60 / 120 Hz grafu w szyi i zmęczenie uszkodzonego grafu (testy `todo` w `structureGraph` i `structurePlate`), ocena wiązań przy impulsie styku niezależna od kroku |

## 8. Decyzje użytkownika (od najważniejszej)

Wszystkie decyzje rozstrzygnięte (2026-11-03: D0, D6, D1, D11, D14; 2026-11-04: reszta, odpowiedzi na listę 26 pytań). Kolumna „decyzja użytkownika” obowiązuje; tam, gdzie różni się od dawnej rekomendacji, opis jest dłuższy.

| # | pytanie | decyzja użytkownika |
|---|---|---|
| D0 | Odejście od wariantu A z 2026-10-15 (belki 3D dla K-7, ringu, budynków): masy zawaleń jako klastry | **11-03: tak** (belki: 0 wysp, 29–32 ms p95 [P]) |
| D6 | H-T schodzi z belek po dysku | **11-03: tak** (na belkach 18–29 ms [P]); rezerwa: komórka 67 |
| D1 | „Tarcza” to dysk czy skała? | **11-03: dysk mieszkalny**; kratery w skale (E8) — opcjonalnie później |
| D11 | Przechył i położenie się wieżowca ku stronie strzałów czy zgniot w miejscu? | **11-03: w stronę strzałów** (przechył 30–45°, potem zgniot) |
| D14 | Wyłom bębna, magazyn, paliwo, pomosty w misji 1? | **11-03: nacisk na wieżowce i habitat, reszta też** — wyłom bębna w E7, magazyn, paliwo i pomosty zaraz po E7 (ta sama ścieżka rejestratorów brył, przed ogólnością § 10) |
| D20 | Demo przed wpięciem w grę? | **11-04: tak** — małe demo na szarych blokach (graf E1 + klastry E2), zawalenie widać od razu po otwarciu, bez nakładek debug; przed E3, ocena okiem tempa (D12), przechyłu (D11) i „sztywnych klocków” (R1) |
| D9 | Wnętrza budowli | **11-04: docelowo WSZYSTKIE budowle mają wnętrza** („gracz zacznie coś rozwalać poza misją — to co?”): stropy, słupy, szyb / rdzeń z archetypu, nie tylko wg znacznika. Kolejność: wieżowce i habitat misji 1, potem każde źródło ogólności (§ 10) dostaje wnętrze przy swoim kroku; wypiek offline (E3) trzyma koszt n^1,7–2,3 poza grą |
| D2 | Pył przy zawaleniu | **11-04: cząstki** (bez obłoków gazu w szczycie). Ramka „uchylenie 10-05” była błędna: 10-05 to zakres jednego wdrożenia, nie zakaz |
| D18 | Dźwięk zawaleń | **11-04: później**, teraz hak w zdarzeniach |
| D3 | Pas ±70 podcina, wyżej kruszy fala i graf — wystarczy? | **11-04: tak**, bez rzutowania po kamerze |
| D4 | HP 8000 → nośność; fala jako impuls i osłabienie wiązań (F0), nie HP bloków stojącego wieżowca | **11-04: tak** (oderwane klastry mają HP bloków wg § 3.7) |
| D5 | Klastry ranią okręty (Atlas, sojusznicy, piraci)? | **11-04: tak, wszystkich, jak taran**; gruz obrazu nie. Dotyczy też ringów i stref stanowisk / hal (pyt. 26 — bez wyjątków) |
| D5b | Zabici zawaleniem zaliczani graczowi? | **11-04: wrogowie zabici zawaleniem, które wywołał gracz — tak; sojusznicy nie** (zawalenie pamięta sprawcę, np. kto doprowadził budowlę do HP 0 / zerwał podpory) |
| D13 | Zniszczony pomost odbiera wieżowcowi podparcie? | **11-04: tak**, kotwica `section` (kierunek z grafu — ku stronie bez podpory) |
| D15 | Ujęcie kamery przy zawaleniu wieżowca | **11-04: reżyser kadru** z przewidzianego czasu |
| D12 | g budowli 400 (dach 2,6 s) czy 60–100 (5–7 s)? | **11-04: A/B na nagraniu (demo D20 / E5), skłania się ku WOLNO (5–7 s)** |
| D21 | Radar a klastry i ruiny (§ 3.7) | **11-04: poza tym planem** — radar jest słaby i przerabiają go inne sesje; zawalenia nie dokładają rekordów radaru (ewentualny rekord `radarFeed.collect` — po ich przebudowie) |
| D7 | Rów w szyi w kształcie wieży | **11-04: tak** |
| D8 | Utrzymanie habitatu jako jeden zegar ~2–3 s | **11-04: tak** (~2,5 s) |
| D17 | Osada i winda: scenariusz (10-15) czy fizyka? | **11-04: scenariusz, ale lina windy przypięta do kawałka dysku** i reaguje, gdy ten kawałek pęknie (E6) |
| D16 | Zwolnione tempo jako mechanika | **11-04: nie** |
| D22 | Tempo upadku habitatu (cel E7) | **11-04: wieża jak dziś (~14 s do skały) — OK; RESZTA LECI ZA SZYBKO: wieża pierwsza, bęben, dysk i gruz dolatują wyraźnie później.** Bramka E7 „czasy fabuły” liczy kolejność i opóźnienie reszty względem wieży, nie ±10% dzisiejszych czasów reszty. Zgodne z 10-19 („w końcu wszystko spada na planetoidę” — `supportHoldFloor` 0,5 stroić w E6 tak, żeby reszta dysku w końcu spadła) |
| D10a | Ruiny w zapisie | **11-04: tak** |
| D10b | Odbudowa | **11-04: porty, ringi i hale odnawiają się POWOLI i WIDOCZNIE: uszkodzenie budowli przyjaznej → „mandat” (kara finansowa) + start dronów naprawczych, które naprawiają ścianę** (przykład usera: ściana hali K-7). Bazy z misji zostają ruiną (złom, plan fabuły 10-11). Nowa mechanika — E9 / krok K-7 (§ 10) |
| D10c | g ringu jako umowa (ring nie wiruje) | **11-04: według planety**: 400 × 0,29 (Mars) / × 1,9 (Jowisz) j/s², bez Coriolisa — z poprawką o skalę D12 |
| D23 | Hala K-7 (port domowy) | **11-04: PEŁNE ZAWALENIE** — po pęknięciu wszystkich podpór hala (i magazyny) ma się zawalić naprawdę; gracz może kiedyś być wrogiem Terra Novy i niszczyć hale i magazyny. Zniszczenie jako sojusznik → ogromna kara (D10b) |
| D10d | Kolejność ogólności | **11-04: kolejność planu BEZ STACJI** (stacje usunięte z planu zniszczeń): reszta bazy z dokami → Jowisz → Mars → K-7 → Ziemia; Z7 wg D24 |
| D19 | Mars: budynki stają się przeszkodami? | **11-04: tak** — budynki ringu Marsa (hale portów, kopuły i zabudowa ECUMENE) dostają kolizje gry i destrukcję |
| D24 | Budowle Z7 (stocznia, hangar, boje) | **11-04: najpierw użytkownik dopracowuje wygląd i wpięcie, potem zniszczalność**. Wymóg usera: potok archetypów ma przyjmować NOWE budowle bez ręcznej pracy (model + znaczniki → archetyp, wypiek offline) — § 10 |
| D16b | `wreckPairEvery` dla wolnych par klastrów | rozstrzyga orkiestrator: rezerwa, tylko gdy E7 nie zmieści się w budżecie (stos 256: p95 1,74 / max 2,21 ms Node) |

## 9. Odrzucone warianty

- **A, „belki wszędzie” dla mas** (D0):
  - wieżowiec z komórką 30: max 13,4–16,4 ms Node, 2 bryły [P];
  - lądowanie wymagałoby workera zawaleń;
  - kontakt v2 dotyka wszystkich kadłubów.
- **H-T na belkach przez cały upadek przy komórce 45** (propozycja sędziego): 18–29 ms w grze [P], niższe `gravityVmax` nie ratuje. Zostaje tylko rezerwa z komórką 67.
- **C, „obraz najpierw”:** znika zgniot o skałę i stosy, sprzeczne z decyzją 10-19.
- **D, DEM na GPU:**
  - obciąża najciaśniejszy zasób;
  - `off` ≠ worker;
  - prefraktura w sekundach [P: 4964 kawałki = 2,2 s].
- **GS:** 18–35% błędu [P].
- **Graf z 2000+ kawałków:** 2,7 / 5,3 ms na przebieg [P].
- **Belki z komórką ≤ 20:** 20–45 ms w grze [P/S].
- **Bez uzasadnienia liczbowego:**
  - solver belek na GPU (karta pełna);
  - strojenie silnika (0 wysp);
  - awans przez `PIRATE_BASE_FALL_SOLID` (szczeliny maski);
  - marching cubes (bąble);
  - pełny raymarch (bez early-Z).

## 10. Ogólność

Potok `buildStructureArchetype` jest wspólny, ale **każde źródło potrzebuje najpierw warstwy gry**: ciał pasa, kolidera i przeszkód.

| źródło | budowa | „w dół” | stan gry dziś | sesje [S] |
|---|---|---|---|---|
| reszta bazy, Z7, doki | rejestratory brył, L2 z półprzestrzeni [P: 0,6–7,6 ms na budynek] | studnia | brak ciał poza bazą | 2–3 |
| Jowisz BUDOWA | 20–64 archetypy z wypieku offline | promieniowo, w płaszczyźnie (widać z boku) | baraki w `heightAt` (`budowaPlan.js:185-198`): ruina nadpisuje `heightAt` | 2–3 |
| Mars ECUMENE | jw. | jw. | budynków brak w kolizji (`ecumenePlan.js:232-240`) → D19 | 3–4 |
| ~~stacje GLB~~ — usunięte z planu (D10d, 11-04) | — | — | punkty życia, `Destruction3D` (`stations3D.js:157`) — bez zmian | 0 |
| hala K-7 | jw. | studnia | port domowy, najpierw decyzja | 2–3 |
| miasto Ziemi | budynki z shadera (`haloRingCity.js:1-16`) | promieniowo | wymaga lustra JS generatora | 3–4 |

**Ringi:**
- Indeks „budynek → (partia, instancja)”.
- Instancję chowamy zerową skalą macierzy. Słowo 19 nie jest podpięte (`archTSL.js:41`), a jego użycie zmieniłoby wszystkie materiały `arch`.
- Bufor `arch` jest dziś statyczny (`archMaterials.js:135-142`), więc potrzebne są: wysyłka zakresem, blok ruin ringu i +szew.
- Klastry w pasie szybko do `freezeBody`.
- D5 osobno dla stref stanowisk i hal.
- `damageTrafficActor` i `RepairSwarm.blast`.

**Aktywacja:**
- Budynek ringu nie ma ciała. Aktywacja to ciało pasa z szablonu: ms, nie µs (benchmark klonował tylko graf).
- Limit ≤ 2 aktywacje na krok, reszta w kolejce.
- Archetypy offline, bo hipercruise mija 30 km w 0,75–1,5 s. Zachowanie przed gotowym archetypem ustala E9.
- Ruina zajmuje 1,1–69 KB, a uśpiona kosztuje 0 ms [P].

Kolejność (D10d, 11-04): reszta bazy z dokami, Jowisz, Mars (D19 = tak: budynki ringu z kolizjami), K-7 (D23: pełne zawalenie hal i magazynów; D10b: mandat + drony naprawcze), Ziemia. **Stacje GLB usunięte z planu zniszczeń.** Z7 dopiero po dopracowaniu wyglądu i wpięciu przez użytkownika (D24). Wymóg D24: nowa budowla = model + znaczniki (podpory, kotwice, wnętrze) → archetyp z wypieku offline, bez ręcznej pracy w kodzie gry poza warstwą gry danego źródła.

---

Dane i narzędzia panelu (lokalnie, poza gitem): `.tmp/destrukcja-2026-11-03/` — benchmark `bench/` (`run.mjs`, `przegladarka.mjs`, `podsumuj.mjs`, `stres.mjs`, `graf.mjs`, `bryly.mjs`, `obrys.mjs`, `prefraktura.mjs`, `ogolnosc.mjs`), pomiary dzisiejszego stanu `taran-pomiar.mjs`, `taran-hp0.mjs`, `wiezowiec-bryla.mjs`, eksperyment upadku `weryfikacja/upadek-warianty2.mjs` (V0–V3, `--prebuild`, `--prof`), klastry w prawdziwym silniku `weryfikacja/klastry-silnik.mjs`, ziarno `weryfikacja/ziarno.mjs`, wyniki `*.jsonl`; raporty: mapy stanu `mapa-*.md`, projekty panelu `w2-projekt-*.md`, benchmark `w2-bench.md`, oceny sędziów `w2-sedziowie.json`, weryfikacja `w3-*.md`. Skrypty importują moduły repo ścieżkami bezwzględnymi — uruchamiać z katalogu repo.
