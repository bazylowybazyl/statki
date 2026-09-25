# BRIEF: Naprawy po audycie wydajności dużej bitwy (pakiety A–F)

> Prompt dla agenta wykonawczego. Samodzielny: nie zakłada znajomości wcześniejszych rozmów.
> Diagnoza i liczby: `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md` (przeczytaj najpierw, sekcje 1–3).
> Numery linii są orientacyjne — `index.html` jest edytowany równolegle przez inne sesje; szukaj po
> nazwach funkcji.

## 0. Zasady pracy

1. Przeczytaj `AGENTS.md`: brak nowych rendererów WebGL poza `Core3D`, brak alokacji per klatka/krok tam,
   gdzie są bufory, gameplay liczony w 2D, stałe „na krok” tylko przez `stepDecay120`/`ticksAt120`
   (`src/game/stepDecay.js`), UTF-8, TODO z prefiksem `AGENT:`.
2. Nie uruchamiaj podglądu ani serwera dev — użytkownik testuje gameplay sam. Twoja weryfikacja:
   `npm test` przed i po każdym pakiecie oraz `npm run build`. `node --check` nie łapie błędów ESM.
3. Jeden pakiet = jeden commit (albo kilka małych). Po każdym pakiecie `npm test` zielony. Przed dużą
   edycją `index.html` sprawdź `git status`/`git diff`; nie cofaj cudzych zmian.
4. Zanim zaczniesz: plan w punktach (pliki, funkcje, kolejność). Na końcu raport wg sekcji 9.
5. Znane, cudze fail testów (nie naprawiaj): `tests/solarSystem.test.mjs`, `tests/shadowShaftsQuality.test.mjs`.

## 1. Kontekst i cel

Bitwa 50+50 fregat, 25+25 niszczycieli, 12+12 pancerników (174 okręty): klatka 25,9 ms, z czego
fizyka 16,1 ms = 3,6 kroku × 4,48 ms. Pętla dogania 120 Hz, więc `T = D / (1 − 120·S)`: 1 ms
zaoszczędzona w kroku daje ~5,5 ms na klatce, 1 ms per klatkę ~2,2 ms. Koszt kroku: pociski 1,54,
AI 1,42, kolizje 1,08 ms.

Główna przyczyna: 3 765 dział w bitwie, w tym 1 122 pirackich CIWS (10 strz/s każde → do 8 tys.
żywych pocisków, ~92% tablicy `bullets`) i 1 543 terrańskich laserów PD (do 7,7 tys. wiązek/s, każda
z pełnym skanem świata i osobną grupą meshy 3D). Broń aux strzela do kadłubów, bo
`getTargetScoreForWeapon` (`src/ai/capitalAI.js`) daje nie-preferowanym celom wynik 0, nie odrzucenie.

Kolejność pakietów wg zysk/ryzyko: **A → B → C → D → E → F**. Oczekiwany efekt z modelu:
A ≈ 14 ms, A+B+C+D ≈ 11–12 ms, całość ≈ 9–10 ms i krótszy ogon p95. Użytkownik zmierzy sam w grze
(PerfHUD, klawisz P; spawner bitwy to „Tryb LINIE” z `?dev`).

## 2. Pakiet A — obrona punktowa, PD CHIP, aux do spec, limit puli wiązek

### A1. PD strzela tylko do rakiet i myśliwców (bez chipa)

Klasa PD = broń `mountType === 'aux'` (`ciws_*`, `laser_pd_*`, flak, `aispacePdId`). Domyślny cel PD:
rakiety/torpedy i myśliwce. **Kadłuby (fregata i wyżej, gracz) tylko, gdy właściciel ma PD CHIP.**

- NPC: `initAutonomousWeapons` (`capitalAI.js` ~438–487) daje aux `prefers: ['rocket','fighter']`;
  `getTargetScoreForWeapon` (~490) musi dla broni PD bez chipa **odrzucać** cel spoza `prefers`
  (zwróć `-Infinity`/`null`, a pętla w `processAutonomousWeapons` ~830–845 pomija). Z chipem:
  kadłuby dozwolone, ale zawsze niżej w kolejności niż rakiety i myśliwce.
  `weapon.cachedTarget` sprzed zmiany może być kadłubem — przy braku chipa wymuś rescan.
- Gracz: `ciwsStep` (`index.html`, `function ciwsStep`) — priorytet 1 rakiety zostaje; priorytet 2
  (flak: myśliwce) zostaje; priorytet 3 („dowolny pirat”) i flakowy fallback na kadłuby TYLKO z chipem.
- Zachowaj obniżone obrażenia CIWS w kadłub (20%, `bulletsAndCollisionsStep`, `_isCIWSBullet`).
- `getUnitKind`/`isFighterNPC` (`index.html`) definiują „myśliwiec” — użyj ich, nie własnych heurystyk.

### A2. PD CHIP — nowa zakładka „Chipy” w zakładce MECHANIC

Gameplay: gracz dostanie fregatę z 1 działem głównym i 2 PD; bez chipa PD nie robi obrażeń kadłubom,
z chipem ten dmg wraca. Chip jest **per kadłub** (jak `PLAYER.hullLoadouts`).

- Katalog: `src/data/chips.js` — `CHIPS = { pd_targeting: { id, name: 'PD CHIP', desc, cost } }`.
  Cena do ustalenia (start: 900 CR). Katalog ma być rozszerzalny (kolejne chipy później).
- Stan: `PLAYER.hullChips = { [hullId]: string[] }` (`const PLAYER = {` w `index.html`, ~10489);
  zapis/odczyt w `saveLoadout`/`loadLoadout` (`localStorage 'loadout'`, ~4727/4744) — dopisz pole
  `hullChips`, brak pola = brak chipów (kompatybilność wstecz).
- API: `hasShipChip(entity, chipId)` w `index.html`, wystawione jako `window.hasShipChip` (moduły AI
  wołają przez `window`, tak jak `window.getUnitKind`). Dla gracza czyta `PLAYER.hullChips[aktywny hull]`,
  dla NPC `entity.chips` (`Set`/tablica, opcjonalne, domyślnie brak). Zero alokacji w wywołaniu.
- UI: w `buildMechanicPanel` (`index.html`, ~11190) dodaj do rzędu `weapon-filter-tabs` przycisk
  `data-filter="chips"` z etykietą „Chipy”. Gdy aktywny, lewa karta zamiast magazynu broni pokazuje
  listę chipów z katalogu: nazwa, opis, cena, stan (zainstalowany / dostępny), przycisk „Zainstaluj”
  (pobiera `PLAYER.credits`, wzór: przyciski rynku w hangarze, `PLAYER.credits < cost → disabled`)
  i „Zdejmij” (bez zwrotu albo ze zwrotem 50% — wybierz i opisz). Z `?dev` instalacja darmowa
  (`isMechanicDevMode()`). Render przez `renderMechanic()` (istniejący `initMechanicFilter` przełącza filtr).
  Prawa karta (hardpointy) bez zmian.
- Test: `tests/shipChips.test.mjs` — katalog, `hasShipChip`, zapis/odczyt `hullChips` (wzór testów
  na `index.html`: `tests/playerDefaultLoadout.test.mjs`, `tests/mechanicDevWeapons.test.mjs`).

### A3. Sloty aux (i reszta) do spec kadłuba

`equipNpcWeapons(npc, faction)` (`index.html`, ~8897) obsadza KAŻDY slot z `npc.editorHardpoints`.
Layouty (`src/data/hardpointEditorDefaults.js`, także nadpisane przez `hpEditor.v1` z localStorage)
zostają bez zmian — to pozycje wizualne dla edytora. Zamiast tego **limituj liczbę obsadzonych
slotów per typ do `SHIPS[frame].spec`** (`src/data/ships.js`, np. `terran_frigate: main 4, aux 2,
missile 2`). Ramę bierz z `npc.shipFrame` (ustawia `applyCallInIdentity`), fallback po `npc.type`.
Wybór slotów: równomiernie po kadłubie (co k-ty w kolejności layoutu albo po kącie względem osi),
nie „pierwsze N”, bo to daje jednostronną burtę. Nieobsadzony slot ma `hp.mount` puste (Turret2D
rysuje tylko obsadzone). Efekt: ~3 765 → ~1 000 dział.

Test: `tests/npcWeaponSpecCap.test.mjs` — dla każdej ramy z `ships.js` liczba obsadzonych ≤ spec,
sloty rozłożone (nie wszystkie z jednej burty: sprawdź znak `hp.y`/kąt).

### A4. Limit puli wiązek pulse

`Weapon3DSystem._acquirePulseBeam` (`src/3d/weapon3DSystem.js`, ~815) tworzy nową grupę
(`Group` + 2 `Mesh` + 2 sklonowane materiały) gdy pula pusta — bez limitu. Dodaj
`MAX_PULSE_BEAM_VISUALS` (start: 96): po zapełnieniu recykling najstarszej aktywnej (jak dla
`_continuousBeamActive`, ~891–902). Pula nie rośnie ponad limit. Sprawdź `_preloadShaders`
(prewarm) i `disposeAll`.

## 3. Pakiet B — szybka ścieżka lasera PD

Dziś każda wiązka w `fireWeaponCore` (`index.html`, gałąź `weapon.category === 'beam'`, ~8240–8600)
buduje 3 tablice i 4 domknięcia, iteruje WSZYSTKIE NPC, stacje, platformy, wraki i segmenty ringu,
sortuje kandydatów, robi raymarch po heksach i na końcu spawnuje wiązkę 2D **oraz** przez zdarzenie
wizual 3D.

- **Szybka ścieżka PD**: `processAutonomousWeapons` zna cel (`bestTarget`). Przekaż go przez
  `spawnBulletAdapter` (opts) do `fireWeaponCore` jako `muzzleData.pdTarget`. Dla broni PD z celem:
  bez skanu świata — test tylko celu: tarcza przez `getEntityShieldBlockingRadiusTowards`
  (`shieldSystem.js`), kadłub przez `DestructorSystem.sweepImpact` wzdłuż odcinka wiązki do `range`;
  trafienie → ta sama ścieżka obrażeń co dziś (`applyDamageToNPC`/`applyDamageToPlayer`,
  `registerShieldImpact`). Pudło = wiązka do pełnego zasięgu bez trafienia. LOS na sojuszników
  jest już sprawdzany w AI przed strzałem — nie powtarzaj.
- **Jeden wizual, nie dwa**: dla PD zostaw wyłącznie tanią wiązkę 2D (`spawnLaserBeam`) i NIE wysyłaj
  wizualu pulse 3D (`weapon.render3dOnly` false + flaga `weapon.pdBeam2dOnly` albo po klasie).
  Główne działa wiązkowe bez zmian.
- **Zero alokacji w ogólnej gałęzi beam** (dla pozostałych wiązek): domknięcia `pushTarget`,
  `getBeamTargetRadius`, `getBeamShieldCheckRadius`, `classifyHitEntity` wynieś do funkcji
  modułowych z jawnymi argumentami; `targets`, `ringTargets`, `potentialHits` jako bufory wielokrotnego
  użytku (`length = 0`); klucz cache ringu jako liczba (np. `spatialCellKey` + kierunek), nie string;
  `beamEventData` jako obiekt-scratch; `emitterUid` policz raz i zapisz na `hp` (`hp.__emitterUid`).

Test: `tests/pdBeamFastPath.test.mjs` — strzał PD z celem nie dotyka `window.npcs`/`stations`/`wrecks`
(podstaw tablice z pułapką `Proxy`/getterem liczącym dostępy), trafia w tarczę/kadłub celu, pudło
przy celu poza zasięgiem. Istniejące: `tests/beamRenderPath.test.mjs`, `tests/lineOfFire.test.mjs`.

## 4. Pakiet C — zdarzenie na każdy strzał

`fireWeaponCore` kończy `window.dispatchEvent(new CustomEvent('game_weapon_fired', { detail }))`
(~8695). Słuchacze: audio (`index.html` ~1890) i `Weapon3DSystem._ensureShotListener`
(`weapon3DSystem.js` ~996). Dispatchuje też `src/game/superweapon.js`. Testy odwołujące się do
zdarzenia: `tests/beamRenderPath.test.mjs`, `tests/fighterCombatFixes.test.mjs` — zaktualizuj do
nowego kontraktu, nie usuwaj asercji o efekcie.

- **Szyna strzałów** `src/game/weaponShotBus.js`: `on(fn)`, `off(fn)`, `emit(detail)` z JEDNYM
  obiektem `detail` wielokrotnego użytku (pola nadpisywane; słuchacz nie może go zatrzymać — opisz
  w komentarzu). `fireWeaponCore` woła szynę; `Weapon3DSystem` i audio rejestrują się w niej.
  `CustomEvent` zostaje tylko dla rzadkich strzałów (superbroń, wiązki gracza) albo za flagą dev —
  wybierz i opisz. Hot path (bronie autonomiczne NPC) nigdy nie tworzy `CustomEvent`.
- **Audio** (`playDynamicSound`): limit głosów per klucz dźwięku (start: 12 równoczesnych,
  min. odstęp 40 ms), tłumienie odległością od środka kamery (pełna głośność do ~2 000 j., zero
  powyżej ~12 000 j.; liczby do strojenia), pomijaj gdy wynikowa głośność < 0,01. Bez tego każdy
  railgun w bitwie tworzy `BufferSource` + `Gain`.
- **`Turret2D.triggerShot`** (`src/vfx/turret2D.js` ~781): iteruje wszystkie rekordy klatki nawet
  z podanym `owner`. Dodaj indeks per encja (`Map<entity, rekordy[]>` wypełniany w `pushRecord`,
  czyszczony w `beginFrame`) i z `owner` iteruj tylko jego rekordy. `findTurretKey` analogicznie.

Test: `tests/weaponShotBus.test.mjs` — emisja bez alokacji nowego detail (ten sam obiekt),
słuchacze wołane w kolejności, `off` działa; limit głosów audio jako czysta funkcja (wydziel logikę
limitu do modułu testowalnego bez `AudioContext`).

## 5. Pakiet D — narzuty per pocisk per krok

`bulletsAndCollisionsStep` (`index.html`, ~18475–18963). Przy tysiącach pocisków każdy mikrokoszt
mnoży się przez 120 Hz.

- **Stacje i platformy** (~18930–18960): dziś pętla po wszystkich `stations` dla każdego pocisku.
  Raz na krok policz AABB chmury pocisków (jedno przejście po `bullets`), przefiltruj `stations`
  i `mercMission.weaponPlatforms` do bufora tych, których okrąg tnie AABB (zwykle 0–2). Pętla per
  pocisk używa bufora.
- **Raycast asteroid** (`src/3d/asteroidField3D.js`, `raycast` ~1058): dodaj early-out
  `_isNearAnyBelt(midX, midY, queryR + margines)` (istnieje w `checkShipCollisions`) oraz usuń alokacje:
  domknięcie w `forEachInRadius` → pętla z jawnym `cb` modułowym lub iteracja po komórkach na
  miejscu; `segmentCircleHitInfo` zwraca obiekt per kandydat → scratch/out-param.
- **Smugi pocisków** (~18566–18585): spawn cząstek w KAŻDYM kroku fizyki z 2–3 obiektami `{x,y}`.
  Emituj raz na klatkę renderu: `physicsStep(dt, runFrameLogic, frameLogicDt, …)` już dostaje
  `runFrameLogic = (steps === 0)` i `frameLogicDt` — spawnuj tylko wtedy, z `frameLogicDt`, gęstość
  jak dziś przy 60 fps. Dodaj `CanvasVFX.spawnParticleXY(x, y, vx, vy, life, color, size, flash)`
  (`src/vfx/canvasParticleSystem.js`, obok `spawnParticle`) i użyj bez obiektów.
- **Tarcza** (`shieldSystem.js`, `getEntityPos` ~428 zwraca `{x,y}`): wołane per kandydat per pocisk
  per krok przez `shieldGridAngleTowards`/`registerShieldImpact`. Zamień na odczyt do dwóch zmiennych
  (pomocnik zwracający x i y osobno albo inline). Zero alokacji w `getEntityShieldRadiusTowards`.
- Kolejność testów per kandydat w głównej pętli (~18690–18745): najpierw tarcza (tania), sweep po
  heksach tylko gdy tarcza nie blokuje albo `t` tarczy nie jest najmniejsze — bez zmiany wyniku
  (kandydat wygrywa najmniejszym `t`, jak dziś).

Testy: `tests/projectileHexSweep.test.mjs` i `tests/bulletSpatialGrid.test.mjs` muszą zostać zielone;
nowy `tests/bulletStepOverheads.test.mjs` — filtr stacji po AABB (stacja poza pudłem nie jest
odpytywana), raycast poza pasem zwraca `null` bez wejścia w hash (licznik wywołań `forEachInRadius`).

## 6. Pakiet E — alokacje w gorących pętlach (ogon p95)

- `saveState()` (`index.html`, w `loop`, per krok): mutuj prealokowany `prevState`
  (`pos.x/y`, kąty, `ciwsAngles` jako tablica wielokrotnego użytku).
- `spawnBulletAdapter` (~8918): `muzzlePos`, `muzzleDir`, `muzzle` jako scratch — sprawdź, że nikt
  nie zatrzymuje referencji (`rocketSystem3D.fire(gameX, gameY, …)` bierze liczby; `bullets.push`
  kopiuje pola; wiązki `beamEventData`). `aimPoint` w `fireWeaponCore` scratch.
- `fireWeaponCore`: `emitterUid` string per strzał → cache na `hp`; `flakProfile` spread `...(cond ? {} : null)`
  per pocisk → zwykłe przypisania.
- Podpisy świateł jako stringi per encja per klatkę — patrz pakiet F.
- Pula obiektów pocisków (opcjonalnie, jeśli zostanie czas): `bullets` dostają obiekty z puli z pełnym
  resetem pól; `removeBulletAt` oddaje do puli. Tylko jeśli test zero-alloc pokaże, że to reszta ogona.

Test: `tests/hotPathAllocations.test.mjs` — dla `saveState`-równoważnej funkcji i `spawnParticleXY`
sprawdź, że kolejne wywołania nie tworzą nowych obiektów (identyczność referencji scratch).

## 7. Pakiet F — koszty per klatkę

- **`simulateElasticity`** (`src/game/destructor.js`, ~2387–2480): dla każdego obudzonego ciała
  ≤ 500 heksów iteruje wszystkie shardy i 6 sąsiadów co klatkę; po trafieniu każdy okręt jest budzony
  na 20 klatek (`elasticWakeFrames`). Wprowadź per siatka listę aktywnych shardów
  (`grid._elasticActive`: indeksy shardów z `|targetDeformation| > eps` lub z takim sąsiadem),
  utrzymywaną przez wszystkie miejsca piszące `targetDeformation` (`collideEntities`,
  `distributeStructuralDamage`, `distributeBrittleDamage`, `noteHexDrift`, aplikacja wyników GPU
  w `destructorGpuSoftBody.js`). Pętla sprężystości iteruje tylko listę; shard w spoczynku wypada.
  Wynik ma być identyczny z pełną iteracją — test porównawczy (deepEqual deformacji po N klatkach
  na kadłubie z `tests/helpers/destructorHull.mjs`, seed `Math.random` jak w
  `tests/destructorCollisionRefine.test.mjs`).
- **Podpisy świateł** (`src/game/shipLightRuntime.js`, `buildShipLightShaderPayload` ~267,
  `buildCombinedShipLightShaderPayload` ~488): `signatureParts.join('|')` per encja per klatkę →
  hash liczbowy (FNV-1a po liczbach przez `Math.imul`, kolizje pomijalne przy porównaniu z poprzednim
  podpisem tej samej encji). `getEntityLights` → `normalizeLightsBlock` alokuje blok przy każdym
  wywołaniu (2–3× per encja per klatkę): cache `WeakMap<źródło, znormalizowany blok>` unieważniany,
  gdy zmienia się obiekt źródłowy (`editorLights` jest podmieniany całościowo przez
  `npcHardpointRuntime`). W `syncEntityLightUniforms` (`hexShips3D.js` ~977) pomijaj budowę payloadu,
  gdy encja nie ma lamp i żaden emiter drogowy nie sięga jej pudła (test bbox przed pętlą).
- `HexBodyImpostorBatch.push({...})` per wrak per klatkę (`hexShips3D.js` ~1529) → `pushRaw(...)`
  z argumentami skalarnymi (`src/3d/hexBodyImpostorBatch.js` pisze do `Float32Array`).

Testy: `tests/hullLacquer.test.mjs`, `tests/hexShips3DShader.test.mjs`, `tests/sceneMatrixSync.test.mjs`
zielone; nowy test podpisu świateł (ten sam blok → ten sam hash; zmiana pozycji lampy → inny).

## 8. Pułapki

1. Zmiana zachowania gracza: bez PD CHIP jego CIWS/flak przestają strzelać do pirackich kadłubów —
   to zamierzone; napisz to w opisie chipa i w komunikacie zakładki.
2. `weapon.cachedTarget` i `_blockedTarget` w `processAutonomousWeapons` mogą wskazywać kadłub
   sprzed zmiany reguł — wymuś rescan przy braku chipa.
3. `equipNpcWeapons` musi zostawić `hp.mount` puste dla nieobsadzonych — inaczej Turret2D i integralność
   hardpointów (`updateHardpointIntegrity`) zobaczą broń, której nie ma.
4. `hpEditor.v1` w localStorage nadpisuje layouty NPC (`npcHardpointRuntime.js` ~268–291) — limit
   per spec działa niezależnie od źródła layoutu; test musi to pokryć.
5. Szyna strzałów: słuchacz nie może zatrzymać `detail` (jeden obiekt); jeśli musi, kopiuje pola.
   `superweapon.js` nadal działa (rzadki strzał — może zostać na `CustomEvent`).
6. Smugi raz na klatkę: przy `?physHz=60` i 120 gęstość ma być ta sama (zależy od `frameLogicDt`, nie
   od liczby kroków).
7. `getEntityPos` w `shieldSystem.js` jest używany też poza hot path — zmieniaj tylko wywołania
   z pętli pocisków albo dodaj wariant bez alokacji.
8. `simulateElasticity`: lista aktywnych musi wracać do zera przy uśpieniu siatki i po
   `initHexBody`/`spawnWreckEntity`/`recycleWreck` (nowa siatka = pusta lista).
9. Dwie sesje edytują `index.html` — zmiany punktowe, po nazwach funkcji, częste `git diff`.
10. Nic z tego nie ma zmieniać fizyki kolizji ani obrażeń — tylko koszt. Wyjątek: reguła celowania PD
    (A1) i limit slotów (A3), które są zmianą gameplayu na życzenie użytkownika.

## 9. Raport końcowy

Wypisz per pakiet: (a) pliki i funkcje, (b) testy dodane/zmienione, (c) co pominięte i dlaczego,
(d) instrukcja dla użytkownika, co i gdzie zmierzyć w PerfHUD (które wiersze mają spaść: `Pociski`,
`AI`, `B VFX`, `B misc`, `B ast`, `Deformacja`, `U hex`, `Core render`, p95), (e) dopisz sekcję
„Stan wdrożenia” w `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md` (co zrobione, liczby przed/po jeśli
znane, co zostało).
