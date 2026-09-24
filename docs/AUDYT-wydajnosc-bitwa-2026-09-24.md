# Audyt wydajności — duża bitwa flotowa (2026-09-24)

Scenariusz: Terra Nova vs piraci, 50+50 fregat, 25+25 niszczycieli, 12+12 pancerników
(174 okręty, ~231 ciał heksowych z wrakami, ~100 tys. heksów w arenie). Dwa zrzuty PerfHUD:
69 fps / 14,4 ms oraz 39 fps / 25,9 ms. Kod czytany na stanie drzewa z 2026-09-24.

## 1. Model klatki z liczników

Zrzut 39 fps (25,9 ms):

| Składnik | ms/klatkę | Uwagi |
|---|---|---|
| Fizyka | 16,09 | = 3,59 kroku × 4,48 ms/krok |
| Rysowanie | 7,27 | R 3D upd 3,10 (U hex 2,61, tarcze 0,40) + Core render 2,35 + 2D ≈ 1,8 |
| Deformacja (updateVisuals) | 1,77 | raz na klatkę |
| VFX update + overlay FX | ≈ 0,4 | |
| Untracked | 0,34 | |

Koszt kroku 4,48 ms rozkłada się na trzy równe filary: **pociski 1,54**, **AI 1,42**,
**kolizje destruktora 1,08**, reszta (pre-AI 0,21, hardpointy 0,18, wraki 0,07, świat 0,08).

Pętla (`index.html:21048-21128`) ogranicza klatkę do 33 ms i wykonuje do 10 kroków po 1/120 s,
więc liczba kroków rośnie z czasem klatki. Punkt stały: `T = D / (1 − 120·S)`, gdzie S = koszt
kroku, D = koszt per klatkę (≈ 9,8 ms). Przy S = 4,48 ms: 120·S = 0,54 → T ≈ 21 ms
(zmierzone 25,9 przez ogon). Pochodne w tym punkcie:

- 1 ms zaoszczędzona **w kroku** = ~5,5 ms na klatce,
- 1 ms zaoszczędzona **per klatkę** = ~2,2 ms na klatce.

Dlatego priorytet ma koszt kroku, a zmiana 120 → 60 Hz sama w sobie zdejmuje ponad połowę
czasu fizyki (`?physHz=60` już jest, czeka na A/B).

Ogon: p50 15,3 ms, p95 31 ms, średnia 25,9 ms — średnia daleko nad medianą oznacza, że kilka
procent klatek to zatrzymania rzędu kilkudziesięciu ms (GC po alokacjach z p. 2.9, pula wiązek
z p. 2.2, tworzenie wraków).

## 2. Ustalenia (ranking wg zysku)

### 2.1 Sloty aux są 3–10× nad spec i produkują ~90% pocisków

Spis (pliki `src/data/hardpointEditorDefaults.js`, `index.html:8832-8856`):

| Klasa | Sloty w layoucie | Spec z ships.js (main/aux/missile) | Montowane |
|---|---|---|---|
| TN fregata | 4 main + **20 aux** | 4 / 2 / 2 | 4× railgun_mk2, 20× laser_pd_mk1 |
| TN niszczyciel | 9 main + **15 aux** | 10 / 4 / 4 | 9× railgun, 15× laser PD |
| TN pancernik | 13 main + **14 aux** + 4 missile | 12 / 6 / 6 | 13× railgun, 14× laser PD, 4× rack |
| PI fregata | 3 main + **16 aux** | 4 / 2 / 2 | 3× armata, 16× ciws_mk1 |
| PI niszczyciel | 9 main + **10 aux** | 10 / 4 / 4 | 9× armata, 10× CIWS |
| PI pancernik | 8 main + 6 aux + 5 special | 12 / 6 / 6 | 8× armata, 6× CIWS |

`equipNpcWeapons` (`index.html:8832-8856`) obsadza **każdy** slot main/aux/missile i nadpisuje
loadouty konfiguratorów klas (`index.html:7053-7127`, 2–3 bronie każdy). W bitwie: **3 765 dział**,
w tym 1 122 pirackich CIWS i 1 543 terrańskich laserów PD.

Konsekwencje liczbowe (`src/data/weapons.js`; mózg 20 Hz zaokrągla cooldown w górę do 0,05 s):

- CIWS: cooldown 0,06 → realnie 0,10 s = 10 strz/s/działo, życie 0,75 s → sufit **11 220 pocisków/s,
  ~8 400 żywych**; realnie (część poza zasięgiem 1 500 u) 4–7 tys. żywych. Każdy żywy pocisk =
  pełny przebieg kolizji w każdym ze 120 kroków. To jest ~92% zawartości `bullets`.
- Laser PD: 5 strz/s/działo → sufit **7 715 wiązek/s** (bez pocisku, ale z kosztem strzału — p. 2.2).
- Działa główne: railgun 726/s, armata 185/s → ~1 800 żywych. To odpowiada spec.
- Aux strzela do kadłubów: `getTargetScoreForWeapon` (`src/ai/capitalAI.js:490-503`) daje
  nie-preferowanym celom wynik 0, więc okręt w zasięgu i tak jest wybierany. CIWS robi w kadłub
  20% obrażeń (2,4 pkt/trafienie) — cały zalew pocisków jest bezużyteczny bojowo.

**Rekomendacja (największy zysk, najmniejszy koszt):**
1. Broń aux/PD celuje **wyłącznie** w rakiety i myśliwce (score −∞ dla kadłubów zamiast 0).
   Samo to tnie ~90% pocisków i wiązek bez zmiany layoutów.
2. Layouty aux do spec (2/4/6) albo `equipNpcWeapons` obsadza co N-ty slot aux / respektuje
   loadout konfiguratora klasy.
3. Życie pocisku PD/CIWS = dystans do celu + margines, nie `range/speed`.

### 2.2 Laser PD: pełny skan świata na strzał i pula wizuali bez limitu

Każdy strzał wiązką przechodzi gałąź beam w `fireWeaponCore` (`index.html:8240-8600`):
4 domknięcia + 3 tablice per strzał, pętla po **wszystkich** NPC, stacjach, platformach, wrakach
i segmentach ringu (250–400 iteracji), klucz tekstowy cache ringu, sort kandydatów, raymarch po
heksach co 4,5 px, potem `spawnLaserBeam` (2D) **i** zdarzenie → `Weapon3DSystem._triggerBeamFx`
(`src/3d/weapon3DSystem.js:843-954`). Dla trybu pulse `_acquirePulseBeam` (`:815-822`) bierze
z puli albo **tworzy nowy** `Group` + 2 `Mesh` + 2 sklonowane materiały w scenie (`:444-471`),
`frustumCulled = false`, życie 0,15 s. Przy 3–7 tys. wiązek/s to 450–1 100 aktywnych grup =
900–2 200 draw calli i pula rosnąca na stałe. Koszt CPU strzału siedzi w kubełku **AI**
(`processAutonomousWeapons` → `spawnBulletAdapter`), koszt draw calli w **Core render**.

**Rekomendacja:** limit puli pulse (np. 96, recykling najstarszej); PD jako batch instancjonowany
jak pociski; strzał PD testuje tylko swój `cachedTarget` zamiast skanu świata; wyłączyć duplikat 2D
(`render3dOnly`) albo 3D dla PD.

### 2.3 Zdarzenie `game_weapon_fired` per strzał

`index.html:8695`: `new CustomEvent` + obiekt detail na każdy strzał (tysiące/s). Słuchacze:
- audio (`index.html:1875-1935`): `railgun_mk2` → `playDynamicSound` tworzy `BufferSource` + `Gain`
  na każdy strzał, bez limitu głosów i bez tłumienia odległością (300–700 źródeł/s);
- `Turret2D.triggerShot` (`src/vfx/turret2D.js:781-831`): pętla po **wszystkich** rekordach
  wieżyczek klatki, także gdy podano `owner` — O(wieżyczki na ekranie) per strzał.

**Rekomendacja:** indeks rekordów per encja (`Map entity → records`), limit głosów + tłumienie
odległością, bezpośrednie wywołania zamiast DOM eventów (albo jedno zdarzenie zbiorcze per krok).

### 2.4 Pętla pocisków — koszty per pocisk per krok (`index.html:18475-18963`)

Przy 4–7 tys. pocisków 1,54 ms/krok to ~0,3 µs na pocisk na krok — per pocisk jest już ciasno,
dźwignią jest liczba pocisków (2.1) i liczba kroków (2.7). Do sprzątnięcia mimo to:

- **B misc 0,20 ms/krok**: pętla po `stations` (i platformach) dla każdego pocisku w każdym kroku
  (`:18930-18960`). Fix: lista stacji w promieniu liczona raz na klatkę (stacje prawie stoją).
- **B ast 0,31 ms/krok**: `asteroidField.raycast` per pocisk per krok (`src/3d/asteroidField3D.js:1058`)
  bez early-outu `_isNearAnyBelt` (jest w `checkShipCollisions`, nie w `raycast`) + domknięcie i obiekt
  wyniku per kandydat. Fix: early-out + zero-alloc.
- **B VFX 0,26 ms/krok**: smugi plasma/rocket/torpedo/autocannon spawnowane w **każdym kroku fizyki**
  z 2–3 obiektami `{x,y}` per pocisk (`:18566-18585`). Gęstość smug zależy od Hz. Fix: emisja raz na
  klatkę renderu z dt klatki, skalary zamiast obiektów.
- **B NPC hit 0,88 ms/krok**: per kandydat `segmentCircleToi` + `sweepImpact` (box ≥ 8×8 komórek) +
  profil tarczy. `getEntityShieldRadiusTowards` → `shieldGridAngleTowards` → `getEntityPos`
  (`shieldSystem.js:305-315, 428-433`) **alokuje `{x,y}` per kandydat per pocisk per krok**. Fix:
  wersja bez alokacji; test tarczy przed sweepem heksów (przy tarczy w górze sweep jest zbędny, gdy
  t tarczy < t okręgu kadłuba).
- B grid 0,19, B ring 0,21 (early-out jest), CIWS intercept 0,17 — akceptowalne, skalują się z liczbą pocisków.

### 2.5 AI 1,42 ms/krok

- `stepShipFlight` dla 174 okrętów w każdym kroku (`src/game/flight/shipFlightModel.js:369-497`) —
  konieczne (integracja), koszt umiarkowany.
- Mózgi 1/6 floty per krok: `processAutonomousWeapons` (`src/ai/capitalAI.js:759-939`) iteruje
  19–31 dział per okręt per tick → z 3 765 dział to ~75 tys. iteracji dział/s plus LOS (`queryAIGrid`
  z promieniem do ~4 200 u ≈ 200 komórek) przy każdym gotowym strzale i tysiące `fireWeaponCore`/s.
  Redukcja aux (2.1) tnie to proporcjonalnie.
- `saveState()` (`index.html:21045`) alokuje 3 obiekty + tablicę **per krok**.
- Separacja (`index.html:2853`): query 900 u + 2× WeakMap per kandydat — ok.

### 2.6 Kolizje destruktora 1,08 ms/krok

231 ciał × (`_queryBroadphase` hash 1 200 u, ~9 komórek, ~25 kandydatów) + bramki
(`src/game/destructor.js:3105-3300`); narrowphase tylko dla realnych kontaktów; drugi przebieg już
tylko dla ciał ruszonych. Koszt to sam skan kandydatów. Opcje: 60 Hz (2.7); pominięcie zapytania
dla ciała uśpionego/wolnego, w którego sąsiedztwie nic się nie ruszyło (rozszerzyć stempel
„ruszone” na iterację 0); wspólna siatka z pociskami (dziś dwie przebudowy per krok:
`BulletSpatialGrid` 1 000 u i hash destruktora 1 200 u).

### 2.7 Krok 120 Hz

Dźwignia numer jeden, już wdrożona za `?physHz=60` (stałe „na krok” przeliczane przez
`stepDecay120`/`ticksAt120`). Model: przy S60 ≈ 5 ms i D = 9,8 ms → T = 9,8 / (1 − 0,30) = 14 ms.
Alternatywa bez zmiany Hz: pociski i AI co 2. krok z podwójnym dt, kolizje 120 Hz. Ryzyko przy
8 000 u/s railgun: 133 u/krok przy 60 Hz — pociski mają swept-segment, więc trafienia zostają.

### 2.8 Koszty per klatkę (D ≈ 9,8 ms)

- **U hex 2,61 ms** (`src/3d/hexShips3D.js:1429-1800`): dla każdego z ~231 ciał co klatkę: payload
  świateł z tablicami i **stringiem podpisu** (`src/game/shipLightRuntime.js:267-315`, `:488-537`,
  bramka tylko ≥ 4 px), uniformy, pozycje; ciała „far” z `meshDirty` robią pełny `setAttrUpdateRange(-1)`
  mimo `count = 0`. Fix: podpis liczbowy zamiast `join('|')`; payload świateł tylko gdy encja ma lampy
  lub emiter drogowy w zasięgu (test bbox przed pętlą); brak odświeżania atrybutów dla LOD impostor.
- **Core render 2,35 ms CPU**: ~11 `renderer.render(scene)` na klatkę + 2 draw calle per ciało +
  pulse beams (2.2). Sprawdzone: w 3D trafienia **nie** wymuszają uploadu tekstur kadłubów
  (`destroyShard` nie kolejkuje erase gdy jest `armorImage`). Uwaga poboczna: sprite fregat
  2 400×1 792 / 2 816×1 536 (17 MB RGBA) jest 4× większy niż pancernika (1 158×714) — VRAM i mipmapy,
  nie koszt per klatkę.
- **Deformacja 1,77 ms**: `simulateElasticity` (`destructor.js:2387-2480`) dla każdego obudzonego ciała
  ≤ 500 heksów iteruje **wszystkie** heksy i 6 sąsiadów co klatkę; w bitwie każdy ostrzelany okręt jest
  budzony na 20 klatek. Fix: lista heksów „nie w spoczynku” per siatka i iteracja tylko po niej
  (wcześniej odnotowane jako punkt 2 audytu destruktora).

### 2.9 Alokacje w gorących pętlach (ogon p95)

Per krok/klatkę/strzał: smugi `{x,y}` per pocisk per krok; `getEntityPos` tarczy per kandydat;
`saveState` per krok; `fireWeaponCore` ~10 obiektów + domknięcia + string `emitterUid` + `CustomEvent`
per strzał; gałąź beam: 3 tablice + 4 domknięcia + obiekt per kandydat; payload świateł per encja per
klatkę; `raycast` asteroid: domknięcie + obiekt wyniku. Przy tysiącach strzałów/s to setki tysięcy
obiektów na sekundę → major GC = klatki 50–80 ms.

### 2.10 Drobne

- PerfHUD sam kosztuje ~0,3–0,5 ms przy otwartym panelu (profil co 8. pocisku × 12 odczytów zegara,
  ~30 `performance.now()` per krok).
- Pre-AI 0,21 ms/krok: ekonomia stacji, cargo, infrastruktura, `refreshWarpRoutes`,
  `InfrastructureUI.syncWorldPositions` liczone 120 Hz — mogą iść raz na klatkę (`runFrameLogic`).
- `npcShootingStep` (`index.html:18977-19015`) to martwa ścieżka dla tych okrętów (0,00 ms) — do usunięcia.

## 3. Plan wdrożenia i oczekiwany efekt (model z p. 1)

| Krok | Zmiana | S (ms/krok) | D (ms) | T modelu |
|---|---|---|---|---|
| 0 | stan obecny | 4,48 | 9,8 | ~21 ms (zmierzone 25,9) |
| 1 | PD/CIWS tylko rakiety+myśliwce, aux do spec, limit puli pulse | ~3,0 | ~8,8 | ~14 ms |
| 2 | + `?physHz=60` (lub pociski/AI co 2. krok) | ~3,3 @60 Hz | ~8,8 | ~11 ms |
| 3 | + zero-alloc (2.9), B misc/B ast early-out, smugi per klatkę | ~3,0 @60 Hz | ~8,8 | ~10,7 ms + krótszy ogon |
| 4 | + elastyczność po liście aktywnych, U hex bez stringów, event → wywołania | ~2,9 | ~7,5 | ~9 ms |

Kolejność wg zysk/ryzyko: 1 → 2 → 3 → 4. Krok 1 nie zmienia fizyki ani wyglądu bitwy z perspektywy
gracza (znika tylko bezużyteczny ostrzał CIWS w kadłuby), krok 2 wymaga testu A/B tarana i CIWS.

## 4. Zimne wraki (stan wdrożenia 2026-09-24)

Wdrożone wg `docs/BRIEF-zimne-wraki.md` (etap 1): wrak uśpiony ≥ 20 s (czas gry), bez odwołań
(hol, cięcie, locki, kursor, rozkazy, liny, ładunek w locie), poza kadrem albo już jako smuga i bez
obudzonego ciała w 2 500 j. przechodzi w stan zimny (`src/game/coldWrecks.js`): wypada z `wrecks`,
siatki pocisków, list destruktora, `renderEntities` i areny heksów (`hexGrid = null`, zrzut po
komórkach szablonu), a rysuje go tylko batch smug (`src/3d/coldWreckImpostors.js`, krycie 0,7).
Wraca wyłącznie jawnie — holowanie, cięcie, rozkaz na wrak, `window.thawWreck` — najwyżej jedno
odmrożenie na klatkę; zamrażanie idzie po 4 na klatkę, limit 1 500 zimnych (nadmiar: najdalszy od
gracza, nigdy z ładunkiem). Kontakt spoczynkowy nie zeruje już licznika snu wraku, a martwe NPC misji
wypadają z `npcs`. Pomiar w grze (PerfHUD: „Wraki gorące / śpiące / zimne”, Fizyka, Rysowanie) czeka
na użytkownika; strojenie na żywo: `window.ColdWreckConfig` (np. `clearRadius`, `afterSec`).

## 5. Stan wdrożenia — naprawy bitwy A–F (2026-09-24)

Wdrożone wg `docs/BRIEF-bitwa-naprawy-2026-09-24.md`, commit na pakiet (A `0e6440f`, B `772af66`,
C `6916e19`, D `db6e66e`, E `ebe5b4a`, F `a085029`). Weryfikacja: `npm test` + `node --test tests/`
(te same 8 znanych faili co przed zmianami, żadnego nowego) + build samej gry. Pomiaru w grze
jeszcze nie ma — liczby „po” poniżej to rachunek i testy syntetyczne.

| Pakiet | Zrobione | Liczby |
|---|---|---|
| A | PD (aux) celuje tylko w rakiety/torpedy i myśliwce; kadłuby z PD CHIP (per kadłub, zakładka „Chipy” w MECHANIC, 900 CR, zwrot 50%), zawsze za rakietą i myśliwcem. NPC obsadzają najwyżej `SHIPS[rama].spec` gniazd na typ, równo po kącie. Pula wiązek pulse ≤ 96. | Działa w scenie z p. 2.1: **3 765 → 1 632** (aux 2 665 → 544, główne 1 052 → 1 040). NPC nie mają chipów, więc ich PD przestaje strzelać w kadłuby — znika zalew CIWS (~8 tys. żywych pocisków). |
| B | Laser PD z celem od AI: test samego celu (tarcza, sweep heksów), bez skanu świata; jeden wizual (smuga 2D). Ogólna gałąź beam bez domknięć/tablic per strzał, liczbowy klucz cache ringu, uid emitera na hp. | 132 strzały wiązką przed/po refaktorze: 0 różnic. |
| C | Szyna strzałów (`src/game/weaponShotBus.js`) zamiast `CustomEvent` per strzał (zostaje tylko superbroń); limit głosów audio (12/dźwięk, 40 ms, tłumienie 2 000–12 000 j.); indeks wieżyczek per encja w Turret2D. | — |
| D | Stacje/platformy po AABB pocisków kroku; raycast asteroid z early-outem pasa i bez alokacji; smugi raz na klatkę (gęstość jak przy 60 fps/120 Hz, niezależna od `?physHz`); tarcza przed sweepem, sweep przycięty do t tarczy / najlepszego trafienia. | — |
| E | `saveState` w miejscu; scratch wylotu, opcji strzału AI i punktu celowania; flak bez spreadu. | — |
| F | `simulateElasticity` po liście heksów w ruchu (wynik bit w bit jak pełna iteracja); podpis świateł = FNV-1a; cache bloku lamp; payload świateł zewnętrznych tylko w zasięgu emiterów; `pushRaw` impostorów. | Benchmark syntetyczny sprężystości (30 kadłubów po 154 heksy, trafienie + budzenie co 20 klatek): 315 → 257 ms (−18%). |

**Czego się spodziewać w PerfHUD (P, bitwa z „Tryb LINIE”, `?dev`):** największy spadek w `Pociski`
(CIWS znika) i `AI` (mniej luf, PD bez skanu świata), dalej `B NPC hit`, `B VFX`, `B misc`, `B ast`,
`Core render` (bez pulsów 3D PD), `U hex` (podpis liczbowy, mniej payloadów), `Deformacja`
(umiarkowanie — patrz niżej) i krótszy ogon p95 (mniej GC).

**Zostało / odchylenia od briefu:**
- Lista aktywnych sprężystości NIE zeruje się przy uśpieniu siatki ani po `spawnWreckEntity`/
  `recycleWreck` (brief, pułapka 8): uśpiona siatka może trzymać heksy w ruchu, a przeniesione heksy
  niosą wgniecenia — zerowanie łamałoby zgodność z pełną iteracją. Zamiast tego pełny rescan przy
  nowej tablicy `shards`. Zysk mniejszy niż w modelu, bo sprężyny zachowują sumę `targetDeformation`
  i wgniecenie rozlewa się po całym małym kadłubie (prawie każdy heks zostaje „w ruchu” > 0,1).
  Większy zysk wymagałby zmiany modelu (tłumienie/próg spoczynku) — to już zmiana fizyki.
- Laser PD NPC trafiający rakietę nadal jej nie niszczy (tak było; szybka ścieżka traktuje pocisk
  jako pudło). Rakiety przechwytuje CIWS i laser gracza.
- Pula obiektów pocisków (opcjonalna w E) — nie robiona.
- Poza zakresem briefu, bez zmian: A/B `?physHz=60` (p. 2.7, czeka na użytkownika) i drobne z p. 2.10.
