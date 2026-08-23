# Rozbiór `index.html` — co wywalić, co wyciągnąć do modułów

## Postęp

| | linie `index.html` | |
|---|---|---|
| start (2026-08-20) | 28 086 | |
| po kroku 1 (usunięcia) | 26 712 | −1374 |
| po kroku 2 (PerfHUD) | 24 571 | −2141 |
| po kroku 3 (`gameState` + 3 wyciągi) | 23 822 | −749 |
| **razem** | **23 822** | **−4264 (−15,2%)** |

Weryfikacja po każdym kroku:

```bash
node scripts/sprawdz-symbole.mjs && npm run build && npm test
```

`sprawdz-symbole.mjs` powstał po tym, jak wyciągi trzykrotnie wysypały grę na starcie:
`getAuToWorldUnits` i `targetingStrokeGlass` zostały w `index.html` bez deklaracji,
a `playerHullCatalog.js` wyjechał bez importów sprite'ów (`terranFrigateImg` i spółka).
`node --check` i `vite build` przepuszczają taki błąd — pierwszy sprawdza tylko
składnię, drugi nie rusza globalnych.

Skrypt sprawdza **główny skrypt ORAZ moduły wyciągnięte z niego** (lista `MODULY`
na górze pliku — **dopisuj tam każdy nowy moduł**, inaczej nie jest kontrolowany;
trzeci błąd wziął się właśnie stąd, że pierwsza wersja patrzyła tylko na `index.html`).

**Pułapka, o której warto pamiętać:** jeden `ReferenceError` w trakcie ewaluacji
modułu przerywa resztę ciała — wszystkie późniejsze `const` zostają w TDZ
i sypie się lawina pozornie niezwiązanych błędów
(„Cannot access 'X' before initialization"). Szukaj **pierwszego** błędu w konsoli.

**Krok 1 — zrobione:**
- 93 martwe deklaracje (~1080 linii), w tym cały panel „Flota" i cały planet radar
  (obie funkcje usunięte wraz z markupem i CSS — decyzja użytkownika)
- 2 martwe gałęzie: `drawLegacySplitShipOverlay` (96 l.) i `if (false && warpBlackHoleFX)` (89 l.)
- bridge `window.*`: 56 → 15 symboli, 116 → 56 linii; 60 odczytów `window.X` w głównym
  skrypcie zamienionych na importy
- martwe `id` w markupie + osierocony `#bg-gen-status`

**Krok 2 — zrobione:**
- `assets/css/perf-hud.css` (174 l.) — cały inline `<style>` rozbity; reszta reguł
  (HUD dolny, radar, drive, menu) dopisana do `main.css`
- `src/ui/perfHud.js` (1581 l.) — obiekt `PerfHUD` + markup panelu jako template;
  stan świata wstrzykiwany przez `setPerfHudWorldSource()`
- `src/ui/liveDebug.js` (233 l.) — `RenderLiveDebug` + `AILiveDebug`
- zweryfikowane: wszystkie 168 `id` czytanych przez `PerfHUD.init()` są w markupie modułu

**Krok 3 — zrobione, ale w innej formie niż planowano.**

Plan mówił „przenieś ~10 obiektów stanu i przepisz odwołania". Pomiar to obalił:
`ship` **nigdy nie jest nadpisywany** (te 1027 wystąpień to same odczyty), a przepisanie
ich na `GameState.ship` to property lookup w hot-loopach za zero korzyści. Dodatkowo
`npcs` i `rail` **są** nadpisywane, więc `export const` i tak by nie przeszło.

Zrobione zamiast tego:
- `src/game/gameState.js` (47 l.) — kontener czytany **w momencie wywołania**, nie przy
  inicjalizacji modułu. `index.html` publikuje do niego w 13 miejscach (`publishGameState`);
  wewnętrzne odwołania głównego skryptu zostają nietknięte.
- `src/data/playerHullCatalog.js` (340 l.) — czyste dane, 3 wstrzykiwane parametry
- `src/ui/targetingReticles.js` (273 l.) — SINGLE/MULTI/SUB, czysty canvas 2D
- `src/vfx/warpLensPass.js` (204 l.) — pierwszy moduł oparty o `GameState`

**Do zrobienia osobno:** migracja `src/` z `window.*` na `GameState` —
147 odwołań w 25 plikach (`window.ship` 83, `window.camera` 13, `window.stations` 18…).
Nie skraca `index.html`, więc nie weszło w te kroki.

**Następne:** `render()` (1623 l.) i `physicsStep()` (1102 l.) — patrz §2.1.

> Uwaga do §2.2 poniżej: rozmiary grup były liczone zgrubnie („do następnej deklaracji")
> i **zawyżają**. Po dokładnym liczeniu (bilans nawiasów) celowniki to nie 828 linii tylko 265.
> Aktualną mapę daje `scratchpad/outline2.mjs`. Realny obraz po krokach 1–3: plik jest
> zdominowany przez cztery bloki — `render` 1623, `physicsStep` 1102,
> `bulletsAndCollisionsStep` 476, `npcStep` 286 — a reszta to długi ogon drobnicy.

---

Analiza poniżej powstała przy `index.html` = 28 077 linii; **numery linii są sprzed
kroków 1–2** i służą już tylko jako mapa, nie jako adresy.

```
L11–398      <style>              388   — w 100% CSS PerfHUD-a
L402–1471    markup <body>       1070
L1471–1478   importmap              8
L1479–1485   <script src=...>       7
L1486–1601   most window.*        116   — czysty bridge ES-module → globalne
L1605–28055  GŁÓWNY SKRYPT      26451   — 1150 deklaracji top-level
L28057–28073 devTools bootstrap    17
```

Wszystko poniżej odnosi się do numerów linii w obecnym `index.html`.

---

## 1. DO WYWALENIA

### 1.1 Martwy kod (zweryfikowany tranzytywnie)

Analiza: deklaracja top-level, której nazwa nie występuje nigdzie poza własnym ciałem
ani poza kodem już uznanym za martwy, plus sprawdzenie markupu i pozostałych `<script>`.
**93 deklaracje, ~1080 linii.** Największe skupiska:

| Linie | Co | Uwaga |
|---|---|---|
| `L4557–4740` | **cały panel „Flota”** — `renderFleetEntry`, `updateFleetUI`, `buildSupportEntries`, `buildCapitalEntries`, `SUPPORT_TYPE_LABELS`, `UNIMPLEMENTED_FLEET_TYPES`, `formatFleetNumber`, `FLEET_UI_REFRESH_MS` | `updateFleetUI()` nie jest wołane znikąd. Razem z `<div id="panel-fleet">` (L471–479) i `Fleet.ui`. |
| `L6984–7187` | **cały planet radar** — `updatePlanetRadar` (164 l.), `ensurePlanetRadarItem`, `projectToScreenEdge`, `formatAuDistance` | Pułapka: `togglePlanetRadarVisibility()` **jest** wołane (L16507, 16513, 18057, 18328), więc `<div id="planet-radar">` się pokazuje — tylko nigdy nic w nim nie ląduje, bo funkcja wypełniająca jest martwa. Do usunięcia razem z divem albo do naprawy. |
| `L3515–3545` | `setupSidePanel` + `fleetPanel`/`supportPanel`/`shieldPanel` | Zwracane obiekty nigdzie nie używane. |
| `L13754–13786`<br>`L14071–14128`<br>`L14391–14409`<br>`L15382–15393` | `buildHangarPanelLegacyUnused`, `buildMechanicPanelLegacy`, `updateHangarCardsLegacyUnused`, `purchaseShipLegacyUnused` | Same się nazwały. ~120 linii. |
| `L15636–15729` | `spawnWeaponPlatform` (94 l.) | Zero wywołań. |
| `L21295–21388` | `splitWreckIntoFragments` (94 l.) | Zero wywołań — rozpad wraka robi teraz destruktor. |
| `L19939–19956` | `FIGHTER_ORBIT_RADIUS`, `FIGHTER_ATTACK_RANGE`, `FIGHTER_ACCEL`, `FIGHTER_MAX_SPEED`, `FIGHTER_TURN_RATE`, `FIGHTER_DRAG_COEFF`, `FIGHTER_ESCORT_*`, `FIGHTER_FORMATION` | Zostały po starym AI myśliwców, teraz rządzi `src/ai/fighterAI.js`. **Mylące** — łatwo je pokręcić przy tuningu. |
| `L20535–20540` | `SIEGE_CANNON_COOLDOWN/DAMAGE/SPEED/RANGE/SPREAD/LIFE` | To samo — realne wartości siedzą w `src/data/weapons.js`. |
| `L26667–26774` | `uiText`, `hudTabs`, `uiRowButton`, `applyShipStats` | Resztki starego HUD-a rysowanego na canvasie. |
| `L27074–27107` | `limitSpeed`, `useRailPair`, `useRocketsPair`, `useCIWSPair`, `maybeFireRockets` | Puste/nieużywane skróty. |
| pojedyncze | `gravityBrakeCameraOffset`, `findPlanetScene3D`, `smoothstep`, `getEllipseRadiusAtAngle`, `drawHardpointGizmos`, `formatGameTime`, `shuffleArray`, `stationLaunchPose`, `MISSION_NPCS`, `makeRailgun/makeRocketPod/makeGatling`, `stationUnderCursor`, `positionStationUIPanel`, `setMechanicUIVisible`, `renderMechanicTab`, `mechanicIconForWeapon`, `buildUpgradesPanel`, `renderMissionJournal`, `triggerAgilityDash`, `getScannerLockRange`, `refreshScannerContacts`, `lockNearestVisibleContacts`, `drawPlayerApproachPath`, `computeTurretMuzzle`, `WEAPON_VISUAL_SCALE`, `updateLiveBackgroundProgress`, `shouldUseRawPlayerHullSprite`, `capitalLocalFromNormalized` | |

Uwaga na `renderMissionJournal` (L15760) — martwa jest **kopia w index.html**;
`src/ui/cockpitUI.js` ma własną metodę o tej samej nazwie i ta żyje.

### 1.2 Martwa gałąź warunkowa

`L25497–25592` (~96 linii): `const drawLegacySplitShipOverlay = false;` a zaraz pod
spodem `if (drawLegacySplitShipOverlay && …)` — cały render statku P2 na canvasie,
wyłączony flagą-stałą. Wykonanie nigdy nie wchodzi.

### 1.3 Bridge `window.*` (L1486–1601, 116 linii)

Osobny `<script type="module">`, który importuje ~40 rzeczy z `src/` **wyłącznie po to,
by je przypisać do `window.`**. Główny skrypt czyta je potem jako `window.Core3D`,
`window.DestructorSystem`, `window.updateHexShips3D`… mimo że sam jest modułem
i mógłby je zaimportować wprost. To relikt sprzed migracji na ESM.

Do usunięcia w całości po zamianie użyć na importy. Skala: bridge wystawia **56 symboli**,
główny skrypt czyta je **106 razy** — tyle miejsc do podmiany na `import`.
(Dla porównania: wszystkich `window.X` w głównym skrypcie jest 750, ale reszta to
prawdziwe międzyskryptowe globalne — `window.npcs`, `window.ship`, `window.OPTIONS`,
`window.__ai*Ms` — te zostają do osobnej rundy.)

### 1.4 Martwe `id` w markupie

`#planet-quality-group` (L626), `#shaft-quality-group` (L636) — kontenery, do których
nikt się nie odwołuje ani z JS, ani z CSS.

Reszta „podejrzanych" `id` **żyje** — obsługują je moduły w `src/`
(`hudSystem.js`, `infrastructureUI.js`, `zonePainterUI.js`) albo są składane
dynamicznie (`p1-ship-name` ← `prefix + '-ship-name'` w L27240).

---

## 2. DO WYCIĄGNIĘCIA

### 2.0 Najpierw: PerfHUD — jedna zmiana, ~1900 linii mniej

PerfHUD jest rozsmarowany po trzech miejscach i **nie ma żadnych zależności od stanu gry**
poza wywołaniami `PerfHUD.addTiming(...)`. To najtańszy duży zysk w całym pliku:

> Korekta z realizacji: `<style>` **nie** był w całości PerfHUD-em. Reguły `#perfPanel`
> to pierwsze 171 linii; pozostałe ~215 to HUD dolny, radar, drive-readout i menu —
> trafiły do `main.css`, nie do `perf-hud.css`.

| Linie | Co | Dokąd |
|---|---|---|
| `L11–398` | 388 linii CSS — pierwsze 171 to `#perfPanel`, reszta to HUD | `assets/css/perf-hud.css` + `main.css` |
| `L1085–1470` | 386 linii markupu `#perfPanel` — 82 wiersze `perf-row` + `perf-bar` klepane ręcznie | generować pętlą z listy metryk w module |
| `L1970–3127` | `PerfHUD` (1158 linii JS) | `src/ui/perfHud.js` |
| `L3128–3364` | `RenderLiveDebug` (119) + `AILiveDebug` (99) | `src/ui/liveDebug.js` |

Interfejs na zewnątrz to praktycznie `PerfHUD.addTiming(key, ms)` + `PerfHUD.toggle()`
(76 wywołań, wszystkie w `physicsStep`/`render`/`loop`). Import zamiast globalnej.

**Razem: ~1930 linii z pliku, ryzyko regresji ≈ 0.**

### 2.1 Dwie funkcje, które trzeba rozbić od środka

To jest właściwy powód, dla którego plik jest nieczytelny — nie liczba funkcji, tylko dwie z nich.

#### `render()` — `L24743–26619` (1877 linii)

Ma już gotowe szwy: `PerfHUD.addTiming` znaczy koniec każdego passu.

| Zakres | Pass | Moduł |
|---|---|---|
| L24743–24890 | setup + logika kamery | `src/render/renderCamera.js` |
| L24893–24981 | warp lens | `src/vfx/warpLensPass.js` (razem z L4140–4337) |
| L24982–25130 | unified 3D update & draw | `src/render/render3dPass.js` |
| L25131–25597 | pętla split-screen 2D: świat, NPC, statek gracza | `src/render/render2dWorld.js` |
| L25598–25638 | pociski + VFX | `src/render/renderProjectiles.js` |
| L25639–25837 | UI/HUD pass | `src/render/renderHud.js` |
| L25838–26365 | linie celowania + celowniki ostrzału | `src/ui/targetingReticles.js` (razem z L10544–11371) |
| L26366–26619 | koło wyboru celownika, CIC, PiP, contact markers | `src/ui/targetingWheel.js` |

Wewnątrz L25496–25592 leży wspomniana martwa gałąź P2 — usunąć przy okazji.

#### `physicsStep()` — `L23109–24213` (1105 linii)

Też ma szwy po `PerfHUD`:

| Zakres | Sekcja | Moduł |
|---|---|---|
| L23109–23202 | strefy świata | `src/game/step/worldZoneStep.js` |
| L23202–23263 | systemy gracza, auto-fire | `src/game/step/playerSystemsStep.js` |
| L23266–23464 | skan/radar/drony/sensory/CIC | `src/game/step/sensorStep.js` |
| L23494–23800 | lot gracza: stabilizator, thrustery, ładowanie warpa | `src/game/step/playerFlightStep.js` |
| L23801–23893 | fizyka P2 | `src/game/splitScreen.js` |
| L23898–23979 | wraki (sen/despawn) | `src/game/step/wreckStep.js` |
| L23985–24213 | AI: eskadry, support wing, `npcStep`, misje pirackie | orkiestracja zostaje |

### 2.2 Grupy gotowe do wyniesienia (posortowane: zysk ÷ ryzyko)

Kolumna „stan” mówi, ile obcego stanu modułowego trzeba przekazać.

**Niski koszt — samowystarczalne, bierz pierwsze:**

| Linie | ~ | Co | Dokąd | Stan |
|---|---|---|---|---|
| L10544–11371 | 828 | celowniki SINGLE/MULTI/SUB (`drawSubTargetingReticle` sam ma 556 l.) | `src/ui/targetingReticles.js` | `ctx`, `camera`, `targetingMode` |
| L12936–13330 | 395 | `createPlayerHullCatalog` — czyste dane | `src/data/playerHullCatalog.js` | brak |
| L5621–6241 | 621 | odczyt/normalizacja configu z edytora hardpointów (`*EditorEngine*`, `buildPlayerDefault*`) | `src/game/hardpointConfig.js` | localStorage |
| L4140–4337 | 198 | warp lens pass | `src/vfx/warpLensPass.js` | canvas |
| L8035–8343 | 309 | wybór sprite'a kadłuba / profil renderu | `src/game/hullSprites.js` | mapy sprite'ów |
| L15781–16366 | 586 | routing cruise: `planCruiseRoute`, `buildCruiseDetourPair`, `segmentCirclePenetration` — geometria, testowalna | `src/game/cruiseAutopilot.js` | `stations`, `planets` |
| L7301–7573 | 273 | budowa stanu HUD broni (`buildWeaponHudState` i spółka) | `src/ui/weaponHudState.js` | `ship` |
| L20360–20528 | 169 | kolejka strzałów rail | `src/game/railQueue.js` | `ship`, `rail` |
| L19828–19937 | 110 | rakiety i działa burtowe | `src/game/sideWeapons.js` | `ship` |

**Średni koszt — spójne domenowo, ale trzymają stan:**

| Linie | ~ | Co | Dokąd |
|---|---|---|---|
| L13331–14473 | 1143 | station overlay: taby, handel, hangar, mechanik, infrastruktura | `src/ui/stationOverlay/` (4–5 plików) |
| L12406–12935 | 530 | mechanik: montaż broni w UI, drag&drop, filtry | `src/ui/mechanicUI.js` |
| L11859–12405 | 547 | station UI + terminal + hover info | `src/ui/stationUI.js`, `src/ui/hoverInfoUI.js` |
| L14474–15039 | 566 | flota towarowa: zlecenia, vany, wraki cargo | `src/game/cargoFleetRuntime.js` (obok istniejącego `cargoFleet.js`) |
| L15040–15369 | 330 | salvage + holowanie wraków | `src/game/salvageRuntime.js` (obok `salvage.js`) |
| L16900–17640 | 741 | frakcje + skaner + dane celu radaru | `src/game/factionRuntime.js`, `src/ui/scannerUI.js` |
| L20529–20919 | 391 | CIWS, flak, point defense | `src/game/pointDefense.js` |
| L20920–21643 | 724 | damage resolver, debris, reactor blow, rozpad wraków | `src/game/damageResolver.js`, `src/game/wreckBreakup.js` |
| L9243–10420 | 1178 | fabryka NPC, hangary, spawn support/capital/megafreighter/piraci | `src/game/npcFactory.js` + `src/game/spawns/` |
| L4741–5620 | 880 | support wing AI, separacja, sterowanie NPC | `src/ai/supportWing.js`, `src/ai/separation.js` |
| L8344–8938 | 595 | Słońce, planety, strefy | `src/world/planets.js`, `src/world/zones.js` |
| L3598–4139 | 542 | `AudioSys`, muzyka menu, nawigacja gamepadem po menu, presety jakości | `src/audio/audioSystem.js`, `src/ui/mainMenu.js` |
| L27218–27894 | 677 | split screen: wybór statku, przypisanie padów, `setupPlayer2` (249 l.) | `src/game/splitScreen.js`, `src/ui/splitScreenUI.js` |
| L26620–27217 | 598 | profil kadłuba gracza, layout thrusterów, `startGame` | `src/game/playerHullProfile.js` |

**Wysoki koszt — najpierw uporządkować stan:**

| Linie | ~ | Co | Dlaczego trudne |
|---|---|---|---|
| L17641–19323 | 1683 | selekcja, RTS, world command menu, chmary myśliwców | dotyka `Selection`, `rtsState`, `worldCommandMenu`, `mouse`, `camera`, `npcs` naraz |
| L19324–19827 | 504 | handlery myszy (`_getMouseForScreen` + 6 listenerów) i gamepada | najgęstszy splot ze stanem UI; wyciągać dopiero po RTS |
| L21644–22354 | 711 | spatial grid, destructibles, `bulletsAndCollisionsStep` (477 l.) | hot path — ruszać osobno, z pomiarem |
| L22355–22877 | 523 | `npcStep` (287), `npcShootingStep`, `pirateMissionStep` | to samo |

### 2.3 Markup do przeniesienia

| Linie | ~ | Co |
|---|---|---|
| L1085–1470 | 386 | `#perfPanel` → generować z `src/ui/perfHud.js` |
| L579–838 | 260 | `#main-menu` → template w `src/ui/mainMenu.js` |
| L854–991 | 138 | `#ship-select-overlay` + `#controller-select-overlay` → `src/ui/splitScreenUI.js` |
| L1007–1077 | 71 | `#zone-painter-overlay` → moduł `src/ui/zonePainterUI.js` już istnieje, markup został |

---

## 3. Kolejność

Warunek wstępny każdego wyniesienia: rozbroić **`ship` (1027 odwołań)**, `ctx` (858),
`camera` (309), `stationUI` (183), `warp` (156), `targetingMode` (133), `mouse` (111).
Dopóki żyją jako `let` w zasięgu modułu, każdy wyciąg wymaga albo przekazywania ich
argumentem, albo kolejnego `window.`. Rekomendacja: jeden `gameState.js` eksportujący
te obiekty, importowany przez moduły — bez zmiany semantyki, samo przeniesienie deklaracji.

1. **Usunięcia z §1** — ~1300 linii, samodzielne, zero zależności. Zacznij tu.
2. **PerfHUD (§2.0)** — ~1930 linii, ryzyko ≈ 0.
3. **`gameState.js`** — przenieś ~10 głównych obiektów stanu.
4. **Grupy „niski koszt" (§2.2)** — ~3500 linii.
5. **Rozbicie `render()` i `physicsStep()` (§2.1)** — ~3000 linii.
6. Reszta.

Po krokach 1–5: **~28 000 → ~18 000 linii** bez ruszania trudnych części.

Weryfikacja po każdym kroku: `npm test` (81 plików testowych w `tests/`) i `npm run build`.
Gameplay testuje user.
