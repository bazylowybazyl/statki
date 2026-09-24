# PORT: mostki — zniszczenie mostka = kill

Stan na 2026-09-24: **mechanika jest wpięta do gry** (§0). Reszta dokumentu
to model, liczby z benchmarku i opis kroków integracji — §4 opisuje, jak to
zrobiono i czego jeszcze brakuje (edytor stref, model 3D mostka).

## 0. Stan w grze (2026-09-24)

Klej gry: **`src/game/shipBridgeRuntime.js`** (bez DOM i three) + krótkie haki w
`index.html` (szukaj `shipBridgeRuntime` / `bridgeSimTime`):

| co | gdzie w `index.html` |
|---|---|
| import modułów | obok `createNpcHardpointRuntime` |
| `BridgeFx3D.attach(Core3D.scene)` | po `initHexShips3D` |
| zegar sekwencji `bridgeSimTime += dt` (czas symulacji, stoi w pauzie) | `physicsStep`, obok `gameTime` |
| `attachEntityBridges(npc)` | `drawNPCPretty`, po `initHexBody` + `prewarmHexShipVisual` |
| `attachEntityBridges(ship, { key })` | oba `initHexBody(ship, …)` (ładowanie sprite'a, zmiana kadłuba) |
| kadencja `tickShipBridges` → `onBridgeLost` / `onBridgeCommandLost` | `updateHardpointIntegrity` |
| hulk: `stepBridgeHulk` zamiast AI i modelu lotu, potem `finishBridgeKill` | `npcStep`, przed „LOGIKA MISJI I WALKI” |
| `finishBridgeKill` (wrak bez `tryTriggerCriticalReactorBlow`) + pula nie działa na hulka | przed / na początku `applyDamageToNPC` |
| sufit heksów pomija hulki | `enforceNpcHexIntegrityBalance` |
| `noteBridgeHit` (kierunek wyrzutu) | po `applyHexImpact` wiązki i pocisku |
| `applyBridgeHulkVisuals` + `BridgeFx3D.update` | `render`, tuż przed `updateHexShips3D` |
| mostek jako cel podsystemu (tryb SUB): `getTargetingBridgeTarget`, marker, chwyt 24 px | przy `findTargetingHoveredSubsystem` i rysowaniu trybu SUB |

Zachowanie:
- Mostki mają: Atlas (rufowy + zapasowy), Bellator (`battleship`), Iron Skull
  (`pirate_battleship`) — NPC i gracz. Układ stref z `BRIDGE_LAYOUT_PROPOSALS`
  (edytor hardpointów jeszcze ich nie zna, §4.1).
- **NPC:** utrata dowodzenia → hulk: bez AI, broni, ciągu i tarczy; dryf z
  reakcją strumienia; okna, dysze i światła gasną wg `BRIDGE_KILL_TIMELINE`;
  po **4 s** (`sequenceEnd`) — wrak bez wybuchu reaktora (łup). Zasługa i
  reputacja liczą się w chwili utraty dowodzenia; gracz dostaje komunikat
  „<NAZWA>: UTRATA DOWODZENIA”.
- **Gracz:** padnięty mostek główny Atlasa → komunikat „MOSTEK GŁÓWNY ZNISZCZONY
  — DOWODZENIE PRZEJMUJE ZAPASOWY”; utrata obu → zwykła śmierć gracza
  (`handlePlayerDestroyed`, z wybuchem reaktora — gra nie ma respawnu).
- **AI nie celuje w mostki** (decyzja 2026-09-24: za szybko zabijałoby gracza).
  Zostawione na przyszły „inteligentny boss”: `src/ai/capitalAI.js`
  `pickTargetSubsystem` — tylko dla wybranych przeciwników.
- **Gracz celuje w mostek** w trybie SUB (po skanie kadłuba): marker w środku
  strefy, etykieta z integralnością, broń celuje w odsłonięte heksy strefy.

Testy: `tests/shipBridge.test.mjs` (moduł), `tests/shipBridgeRuntime.test.mjs`
(klucze kadłubów, cykl hulka). Sprawdzone też w grze (headless Chrome):
pancernik piracki dostaje mostek przy inicjalizacji siatki (112 heksów),
po zniszczeniu strefy jest hulkiem ~4 s, potem wrakiem.

Następny krok: **model 3D mostka** wystający z kadłuba (jedyny element 3D na
kadłubie) — obrażenia nadal z heksów 2D, okna i światła z tej samej osi czasu;
zastąpi szczeliny okien z `bridgeFx3D.js`.

## 1. Co jest gotowe

| plik | rola |
|---|---|
| `src/game/shipBridge.js` | cała logika, bez DOM i bez three: strefy, znakowanie heksów, pancerz, integralność, kadencja, utrata dowodzenia, punkt celowania (lock), kierunek wyrzutu, oś czasu „czystej śmierci”, dryf hulka, okna (dane) |
| `src/game/shipBridgeRuntime.js` | klej gry: który kadłub ma mostki, podpięcie po `initHexBody`, hulk (agonia → wrak), stan wizualny hulka |
| `src/3d/bridgeFx3D.js` | okna mostka (1 × `InstancedMesh`, warstwa FG) i wyrzut atmosfery (bank `Fx3D`); scenę dostaje z zewnątrz (`BridgeFx3D.attach(Core3D.scene)`), własnego renderera nie ma |
| `tests/shipBridge.test.mjs`, `tests/shipBridgeRuntime.test.mjs` | 15 + 4 testy na prawdziwym destruktorze (`tests/helpers/destructorHull.mjs`) |
| `dema/mostki-*.js`, `dema/mostki-demo.html` | demo, symulacja walki (ścieżka trafień jak w grze), benchmark, zrzuty |

Uruchomienie: `npm run dev` → `http://localhost:5173/dema/mostki-demo.html`.
Parametry URL: `hull=battleship|pirate_battleship|atlas|all`, `variant=` (Atlas),
`armor=`, `kill=`, `pool=0.5` (eksperyment balansu z §3), `nofix=1` (trafienia
jak w grze dziś, §6.1), `weapon=`, `gun=dziob|skos|burta|rufa`, `lock=1`.
Klawisze: `1–4` kadłuby, `T` lock na mostek, `F` ogień ciągły, `[ ]` broń,
`Spacja` pauza, `R` reset, `E` edytor stref, `G/Z/B/H` nakładki.

Benchmark (deterministyczny, Node, ~2 min):

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-bench-node.js [--armor 1.5 --kill 0.35] [--pool 0.5] [--atlas] [--nofix]
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-bench-node.js --sens battleship --weapon heavy_autocannon --dir burta
```

Zrzuty i pomiary HDR (headless Chrome przez CDP): `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki-shots.js [--only zones,seq,seq_pirate,seq_atlas,far]`
→ `.tmp/mostki/*.png`, `results.json`.

## 2. Model

- **Strefa** = obrócony prostokąt `{id, label, role, x, y, w, h, rot, armorMul?, killFrac?}`
  w przestrzeni PNG sprite'a (jak hardpointy w `hardpointEditorDefaults`). Lista
  `bridges` obok `cores`. `role: 'backup'` = mostek zapasowy.
- **Znakowanie** raz, po `initHexBody`: heks należy do strefy, gdy środek jego
  komórki `(c, r)` (nie ruchomy `gridX`) leży w prostokącie. `shard.__bridgeId`,
  HP × `armorMul` (pierwotne HP zapamiętane — ponowne `attach` nie mnoży drugi raz).
- **Integralność** = żywe heksy strefy w BIEŻĄCEJ siatce encji ÷ liczba startowa.
  Przynależność tym samym testem co `_heatWoundRim`: `grid.shards[s.__meshIndex] === s`
  — mostek odstrzelony razem z kawałkiem kadłuba (rozpad → wrak) liczy się jako
  zniszczony, a kadłub-matka traci dowodzenie.
- **Kill**: mostek pada, gdy integralność ≤ `1 − killFrac`. Dowodzenie pada, gdy
  padną wszystkie mostki (`rule: 'all'`; Atlas z zapasowym wymaga obu).
- **Kadencja** co `probeEverySec = 0,08 s`, bez alokacji. Gdy od ostatniego
  sprawdzenia nie zginął żaden heks (`grid.shards` i `activeStructuralCount` bez
  zmian) — O(1).
- **Śmierć „czysta”** — oś czasu `BRIDGE_KILL_TIMELINE` (jedno źródło prawdy):
  broń milknie od razu; okna mrugają nierówno do 0,5 s, potem gasną falą od
  wyrwy (420 px PNG/s); wyrzut atmosfery z wyrwy tunelem ostrzału (narasta
  0,06 s, półokres 0,5 s, koniec 2,8 s); dysze dławią się od 0,25 s (coraz
  rzadsze pchnięcia) i milkną do ~2,4 s, płomyk postojowy gaśnie 0,7 s później;
  światła pozycyjne gasną falą od mostka od 0,8 s; hulk dryfuje (reakcja
  strumienia + tłumienie `pow(k, dt·120)` = semantyka `stepDecay120`). Bez
  wybuchu reaktora — wrak prawie cały (łup).

### Proponowane strefy (px PNG)

| kadłub | strefa | x, y, w, h | okna |
|---|---|---|---|
| Bellator (`battleship`) | mostek | −282, 0, 236, 92 | chłodna biel `#e4f3ff` |
| Iron Skull (`pirate_battleship`) | mostek | −242, −2, 176, 104 | brudny pomarańcz `#ff9a4a` |
| Atlas — `rufowy` | mostek rufowy (kręgosłup) | −735, −13, 520, 80 | `#d6ecff` |
| Atlas — `srodokrecie` | mostek śródokręcia | 80, −8, 520, 84 | |
| Atlas — `dziobowy` | mostek dziobowy | 632, −8, 244, 66 | |
| Atlas — **`rufowy_z_zapasowym`** (domyślny) | rufowy + zapasowy na dziobie | jw. + 632, −8, 244, 66 | |

Test `proposed zones clear every hardpoint, engine slot and core` pilnuje, żeby
strefy nie nachodziły na hardpointy, sloty silników i rdzenie z margin­esem sondy
hardpointu (14 px renderu). W demie strefy można przesuwać/obracać/skalować
(`E`) i wyeksportować JSON w przestrzeni PNG.

## 3. Rekomendacja: `armorMul 1,5`, `killFrac 0,35` (+ decyzja o puli)

Ustawione jako `BRIDGE_DEFAULTS` w `shipBridge.js` (wcześniej 3 / 0,6).

Najważniejszy wynik benchmarku: **koszt zabicia mostka to tunel do niego, nie
pancerz strefy**. Pula HP (12 000) kończy walkę po utracie kilku procent heksów
(wyniszczenie poza wiązkami: kill przy 92–99% żywego kadłuba), a do mostka
trzeba się przekopać przez kilkadziesiąt heksów. Czułość (Bellator, działko,
burta, pancerz ×1): killFrac 0,25 → 0,6 podnosi koszt tylko z 746 do 941
pocisków; pancerz ×1 → ×3 dokłada 25–50%. Dlatego:

- `killFrac 0,35` — mostek pada, gdy tunel dojdzie do strefy i trochę się
  rozszerzy (~⅓ heksów). Przy 0,25 pojedyncza torpeda / Yamato w odsłoniętą
  strefę potrafi zdecydować; przy 0,6 trzeba wyciąć większość pomieszczenia
  (+20–30% pocisków względem 0,35).
- `armorMul 1,5` — nadbudówka wyraźnie twardsza niż kadłub, ale bez zamiany
  mostka w „ścianę” (×3 przy tym samym killFrac to +20–35% pocisków bez zysku
  w rozgrywce).
- **Pula HP to decyzja balansu (Twoja):**
  - pula ×1 (gra dziś): mostek pierwszy w 17/72 przypadkach (Bellator + Iron
    Skull) — głównie od rufy i wiązkami; mediana 1,7× pocisków puli. Mostek jest
    niszą dla cierpliwych (lepszy łup), nie drugą drogą do killa.
  - pula ×0,5 (trafienie w kadłub zdejmuje z puli połowę obrażeń): 40/72,
    mediana 0,85× — prawdziwy wybór: z burty/rufy działko, railgun i wiązki
    szybciej zabijają przez mostek, od dziobu i bronią „ciężką” (Valkyrie,
    torpeda) szybciej pula. Koszt: czas zabicia z puli ×2 we wszystkich walkach.
- Rakiety (`missile_rack`) mostka nie zabiją nigdy — 3D rakiety zdejmują tylko
  pulę, nie heksy (§6.3).

Pełne tabele: aneks A–E niżej i `.tmp/mostki/bench-*.md`.

## 4. Kroki integracji

### 4.1 Dane

1. **`src/data/hardpointEditorDefaults.js`** — dopisać `bridges: [...]` do
   `ships.atlas`, `ships.battleship`, `ships.pirate_battleship` (JSON z eksportu
   edytora stref w demie; format jak §2). Dziś pliku nie ma czego czytać.
2. **`src/game/npcHardpointRuntime.js:338–345`** — obok `npc.editorCores`
   przepisać `cfg.bridges` → `npc.editorBridges` przez `normalizeBridgeList`
   z `shipBridge.js`. **Nie** przez `normalizeEditorCore` (`:126`) — ona zostawia
   tylko `id/x/y` (gubi `w/h/rot/role/armorMul/killFrac`).
3. **`index.html:3571 toEditorHullAlias`** — ucina `pirate_`; używa go
   `resolvePlayerEditorKey` (**`:3598`**), więc gracz na kadłubie Iron Skull
   czyta konfigurację Bellatora (`battleship`) — mostek (i hardpointy) z innego
   sprite'a. Zostawić `pirate_battleship` jako własny klucz (awaryjnie
   `battleship`, gdy brak wpisu). NPC są w porządku:
   `src/game/npcHardpointRuntime.js:180` mapuje pirata na `pirate_battleship`,
   a edytor (`src/ui/hardpointEditor.js:36`) zapisuje pod tym kluczem.
4. **`index.html:3587 hasEditorHullConfigContent`** i
   **`src/ui/hardpointEditor.js:46 shipDataHasContent`** — nie znają `bridges`:
   konfiguracja z samymi mostkami uchodzi za pustą i przegrywa z domyślną.
5. **Edytor** (`src/ui/hardpointEditor.js:2426 compactMarker`, eksport `:2470`,
   `:2494`) — nie zna mostków; albo nowy rodzaj znacznika (`x, y, w, h, rot,
   role`), albo edycja w demie i wklejenie JSON-u do defaults. Pułapki:
   - `hpEditor.v1` w localStorage **bije** defaults — zapis bez `bridges` schowa
     mostki z defaults (scalać per klucz albo `?reset`),
   - tryb „Current Ship” eksportuje w skali kanwy renderu (Atlas ×2,08 do PNG) —
     mostki muszą być w px PNG, jak hardpointy w defaults.

### 4.2 Podpięcie do encji

6. Po `initHexBody`:
   - NPC: **`index.html:21842`** (`drawNPCPretty`, leniwa inicjalizacja siatki),
   - gracz: **`index.html:5887`** i **`:24269`** (przebudowa kadłuba), drugi
     gracz **`:24976`**.

   ```js
   attachShipBridges(entity, entity.editorBridges, {
     scaleX: entity.__hardpointScaleX, scaleY: entity.__hardpointScaleY, // render px / PNG px
     windowColor: BRIDGE_LAYOUT_PROPOSALS[key]?.windowColor
   });
   ```

   Koszt: 0,5–0,7 ms (Iron Skull, Bellator: 2 267 / 2 923 heksów) – 2,1 ms
   (Atlas, 10 832) raz na statek.
   Przy każdej przebudowie siatki (`initHexBody` od nowa) — ponowny `attach`
   (stary stan odpina się sam, pancerz nie mnoży się drugi raz).
7. **Kadencja: `index.html:4526 updateHardpointIntegrity`** (wołana z `:20946`
   co 3. podkrok z akumulowanym dt) — dla gracza i każdej encji:

   ```js
   const flags = updateShipBridges(entity, dt, simTimeSec);
   if (flags & BRIDGE_EVENT.BRIDGE_LOST) { /* komunikat: mostek stracony / dowodzi zapasowy */ }
   if (flags & BRIDGE_EVENT.COMMAND_LOST) killByBridge(entity);
   ```

   Koszt: ~30 ns na statek, gdy nic nie zginęło; 1,5–6 µs po śmierci heksa.
   174 okręty = pomijalne.
8. **Trafienia** — `noteBridgeHit(entity, x, y, vx, vy, nowSec)` obok
   `applyImpact` pocisku (**`index.html:18814`**) i wiązki (**`:8568`**). Daje
   kierunek wyrzutu (strumień wychodzi tunelem, którym weszły pociski).

### 4.3 Śmierć przez mostek (bez losowego critu)

9. **`index.html:18097 applyDamageToNPC`** — dziś każda śmierć przechodzi przez
   `tryTriggerCriticalReactorBlow` (**`:18155`**, szansa `min(0,26 + 0,52·norm,
   0,78)` przy ≥ 48% żywych heksów; **`:18049`**). Kill mostkiem zostawia
   85–97% żywego kadłuba → zwykłą ścieżką wybuchłby w ~60–75% przypadków.
   Potrzebna osobna ścieżka `killByBridge(npc)`:
   - `npc.commandLost = true` (albo `deathCause = 'bridge'`), `registerFactionKill`,
     **bez** `tryTriggerCriticalReactorBlow`,
   - agonia ~`BRIDGE_KILL_TIMELINE.sequenceEnd` (3,2 s): AI i broń wyłączone
     (`bridgeWeaponsOnline`), `applyCommandLossVisuals` co klatkę,
     `stepCommandLossDrift` co krok fizyki zamiast sterowania; dopiero potem
     `createWreckage` + `releaseNpcHexBody` jak dziś (albo encja od razu staje
     się wrakiem, jeśli `bridgeState` przejdzie na wrak — prościej zostawić
     encję do końca sekwencji),
   - **`index.html:18179 enforceNpcHexIntegrityBalance`** musi pomijać hulki
     (`commandLost`), inaczej dobije je pulą i wróci do ścieżki z critem.
   - Wspólny punkt z `docs/PORT-rdzen.md` (rdzeń = wybuch): jedno miejsce
     rozdziela przyczyny `bridge` (czysto) i `core` (reaktor).
10. **Gracz** — utrata dowodzenia Atlasa = koniec gry (brak sterowania); stąd
    domyślny wariant z zapasowym mostkiem. Komunikat przy `BRIDGE_LOST`.

### 4.4 Celowanie

11. Gracz: **`index.html:14169 getTargetingSubsystemTarget`** — mostek jako cel
    podsystemu; punkt celowania `getBridgeAimPoint(entity, out, { mode: 'breach',
    fromX, fromY, memory })` (środek żywych heksów strefy, a po przebiciu —
    najbliższe wyrwie heksy z najmniejszą liczbą zasłaniających heksów; `memory`
    per strzelec trzyma cel między strzałami).
12. AI: **`src/ai/capitalAI.js:505 SUBSYSTEM_PRIORITY`** / **`:721
    pickTargetSubsystem`** — mostków NIE dodawać domyślnie. Ryzyko: AI
    „snajpuje” mostek gracza — wariant z samym mostkiem dziobowym pada od
    lasera z dziobu po 141 strzałach (pula: 534), stąd domyślnie rufowy +
    zapasowy. Jeśli kiedyś — tylko wybrane klasy (np. piraci, którym zależy na
    łupie).

### 4.5 Wizualia

13. **Okna** — `BridgeFx3D.attach(Core3D.scene)` raz; co klatkę
    `BridgeFx3D.update(entities, { nowSec, dt, zoom })` **przed**
    `updateHexShips3D` (**`index.html:22145`**). Jedno wywołanie rysowania na
    całą flotę (≤ 2 048 okien), warstwa 2 (FG), `renderOrder 51` (lampy
    pozycyjne 52), addytywnie. Alternatywa: dopisać okna do `ShipLights3D`
    (zero nowych draw calli) — wtedy `bridgeFx3D` zostaje tylko z wyrzutem.
14. **Pasma HDR okien** (pomiar różnicowy: klatka z oknami − bez, bez bloomu):

    | kadłub | p50 | p90 | p99 | max | piksele okien > 0,9 | kadłub > 0,9 bez okien |
    |---|---|---|---|---|---|---|
    | Bellator | 0,54 | 1,12 | 1,60 | 1,68 | 17% (same rdzenie szczelin) | 2 px |
    | Iron Skull | 0,23 | 0,60 | 0,80 | 0,83 | 0% (brudne, nie świecą) | 0 |
    | Atlas | 0,32 | 0,86 | 1,46 | 1,51 | 9% | 0 |

    Próg bloomu 0,9 łapie tylko rdzenie szczelin Terran — brak poświaty wzdłuż
    sylwetki. Z daleka okna gasną z wielkością na ekranie (`minPx 0,6 →
    fullPx 1,8`), bez mgiełki (`z_daleka`, zoom 0,18: pikseli > 0,9 — 0,00%; max 1,9 to dysze).
    Strojenie na żywo: `window.__bridgeFxTune` (`coreGain`, `haloGain`, `ventGain`…).
15. **Dysze** — `applyCommandLossVisuals` ustawia `thruster.__throttle`
    (`src/3d/engineVfxSystem.js:292`) i gasi płomyk postojowy przez
    `thruster.vfxScale → 0,001` (`:318`). Powód: `EngineExhaustBatch` rysuje przy
    ciągu 0 jasny rdzeń w wylocie (**`src/3d/engineExhaustBatch.js:144`**,
    `glowAlpha` nie zależy od ciągu). Czyściej w grze: mnożnik mocy slotu
    (`slot.source.__power`) w `push()`.
16. **Światła pozycyjne** — demo podmienia `entity.editorLights` (lista zmienia
    się tylko, gdy zmienia się zestaw zapalonych lamp); czyta je
    `src/game/shipLightRuntime.js:90`. Lepiej: mnożnik mocy lampy w
    `ShipLights3D` zamiast przebudowy listy.
17. **Wyrzut** — bank `Fx3D` (`plume`, `vapor`, `glow`, `spark`) — nic nowego w
    `Core3D`. Kolor/siła: `BRIDGE_FX_TUNE.ventGain/ventScale`.

## 5. Kolejność w klatce (jak w demie)

1. krok fizyki 120 Hz: ruch (hulk: `stepCommandLossDrift`), `DestructorSystem.update`,
   pociski (`noteBridgeHit`), co 3. podkrok `updateHardpointIntegrity` →
   `updateShipBridges`,
2. klatka: `applyCommandLossVisuals` → `BridgeFx3D.update` → `updateHexShips3D`
   → `drawHexShips3D` → HUD 2D (strefy, % integralności).

## 6. Znalezione po drodze (pliki gry — do decyzji)

### 6.1 Trafienia „w ducha” — `applyImpact` gubi trafienia w tunelach i wiązki

> 2026-09-24: przekazane sesji „Fix ghost hexes…”, która wprowadziła
> `applyImpact(..., { shard })` w `destructor.js` i helper `applyHexImpact` w
> `index.html` (heks ze sweepa / raymarchu wiązki). Limit siły (skutek uboczny
> niżej) zostawiła jako pytanie do usera.

`src/game/destructor.js:2763 applyImpact` szuka heksa od nowa
(`_probeImpactData`, **`:2584`**) w oknie ±3 komórek **pierwotnego** położenia
wokół punktu trafienia. Heksy przesunięte deformacją o więcej niż ~3 komórki
(22 px) są widoczne i łapie je `sweepImpact` (**`:2664`**), ale `applyImpact`
ich nie znajduje — trafienie przepada (brak obrażeń heksów; pula schodzi normalnie).
W demie (z deformacją) przepadało **46%** trafień działka w tunelu Bellatora i
**~60–90%** na Atlasie. Wiązki: promień sondy (2 × `hitRadius` ≈ 5,5–7 px)
< promień raymarchu (9,5 px) → trafienia brzegowe giną; w grze dziś wiązka nie
wykopie tunelu wcale (aneks E: > 3 000 strzałów).

Poprawka: `applyImpact(..., opts)` z `opts.shard` = heks znaleziony przez sweep
(`hexSweep.hitShard` przy **`index.html:18714/18814`**, heks raymarchu przy
**`:8568`**) — pominąć ponowne szukanie. Demo emuluje ją (`applyImpactOnShard`
w `dema/mostki-sim.js`, przełącznik „Poprawka sondy”, `?nofix=1`).
**Skutek uboczny:** po poprawce działają też siły ciężkich trafień — Valkyrie
na Atlasie rozrywa kadłub w poprzek na całej szerokości (dziś te trafienia w
większości przepadają). Rozważyć limit siły przy tej ścieżce.

### 6.2 Crash `HullShadowSdf.acquire` przy siatce bez żywych heksów

**`src/3d/hullShadowSdf.js:736`**: gdy ponowne pieczenie zwraca `null` (siatka
ma heksy, ale żaden nie jest aktywny), `_bake` ustawia `entry.layer = -1`, a
potem `if (sameShape) return this._touch(entry)` czyta `layers[-1]` → TypeError
w `updateHexShips3D`. Poprawka: `if (sameShape && entry.layer >= 0)`. W grze:
wrak bez heksów, który trzyma towar (`index.html:20692` — wyjątek
`ownsShipmentCargo`), zostaje na liście renderu. Demo usuwa puste wraki jak gra.

### 6.3 Rakiety 3D nie ruszają heksów

`src/effects3d/rocketSystem3D.js:834–842` i `:853–893` — tylko
`applyDamageToNPC` (pula), bez `applyImpact`. Rakiety nie zabiją mostka ani nie
zostawią dziury. Torpedy oblężnicze są pociskami 2D — heksy niszczą.

### 6.4 Silniki są niezniszczalne

Dysza, której kadłub zestrzelono, dalej świeci w próżni (płomyk postojowy,
§4.5 p. 15). Demo gasi dyszę, gdy zginie ≥ 66% heksów w promieniu 12 px od niej
(`nozzleAlive` w `dema/mostki-demo.js`) — w grze to temat warstwy „silniki” z
planu Destruction VFX.

## 7. Otwarte kwestie

- **Pula ×1 czy ×0,5** (§3) — od tego zależy, czy mostek jest niszą, czy drugą
  drogą do killa.
- Poprawka sondy (§6.1) — bez niej wiązki nie zabiją mostka, a pociski w
  tunelach tracą połowę trafień. Z nią — ciężkie działa rwą kadłuby.
- ~~Hulk: ile trwa agonia~~ — 4 s, pula nie działa, potem wrak (§0).
- ~~AI a mostek gracza~~ — AI nie celuje; boss w przyszłości (§0).
- ~~Okna: osobny draw call czy `ShipLights3D`~~ — docelowo model 3D mostka z
  własnymi oknami; do tego czasu `bridgeFx3D.js` (1 draw call).
- Gracz ginie od razu (zwykła śmierć z wybuchem) — agonia gracza wymagałaby
  blokady sterowania w ścieżce wejścia gracza.
- Edytor hardpointów nie zna mostków (§4.1 p. 5) — strefy siedzą w
  `BRIDGE_LAYOUT_PROPOSALS`.
- Benchmark Node jest „sztywny” (bez deformacji → bez duchów z §6.1). W
  przeglądarce z deformacją liczby pocisków rosną tam, gdzie poprawka ratuje
  trafienia; przycisk „Benchmark” w demie liczy to samo w przeglądarce.

## Aneks: benchmark

Pociski od zbitej tarczy do killa, cel stoi, jedno działo, deterministycznie
(ziarno 7, krok 120 Hz, sztywny kadłub). Komórka: **pociski do utraty
dowodzenia (lock na mostek) / pociski do śmierci z puli przy tym samym
ostrzale**; pogrubione = mostek pierwszy. `>3000` = limit. Wyniszczenie
(celowanie w środek, bez mostków) kończy się przy 92–99% żywych heksów (wiązki:
~50%, bo tną kadłub na pół).

### A. Stare domyślne: armorMul 3, killFrac 0,6, pula ×1

mostek pierwszy w 4/72 przypadków, mediana pocisków mostek/pula 2,56×

| kadłub | broń | dziób | skos 45° | burta | rufa |
|---|---|---|---|---|---|
| Bellator | działko ciężkie | 2349 / 429 | 1467 / 429 | 1402 / 427 | 985 / 427 |
| Bellator | railgun Mk II | >3000 / 1200 | 2290 / 1195 | 2498 / 1195 | 1613 / 1195 |
| Bellator | armata oblężnicza | 359 / 80 | 481 / 80 | 487 / 80 | 178 / 80 |
| Bellator | Valkyrie (special) | 192 / 24 | 120 / 24 | 128 / 24 | 93 / 24 |
| Bellator | laser puls | 424 / 267 | 340 / 267 | 440 / 267 | 648 / 267 |
| Bellator | laser ciągły | 1518 / 1500 | **922** / 1460 | **1259** / 1487 | 1590 / 1500 |
| Bellator | torpeda oblężnicza | 306 / 15 | 298 / 15 | 252 / 15 | 116 / 15 |
| Iron Skull | działko ciężkie | 2410 / 426 | 1223 / 423 | 1250 / 429 | 984 / 426 |
| Iron Skull | railgun Mk II | >3000 / 1183 | 1887 / 1192 | 2496 / 1200 | 1722 / 1192 |
| Iron Skull | armata oblężnicza | 415 / 80 | 371 / 80 | 429 / 80 | 177 / 80 |
| Iron Skull | Valkyrie (special) | 204 / 24 | 108 / 24 | 118 / 24 | 198 / 24 |
| Iron Skull | laser puls | 514 / 267 | 312 / 267 | 388 / 267 | 482 / 267 |
| Iron Skull | laser ciągły | 1570 / 1500 | **878** / 1456 | **1193** / 1489 | 1616 / 1500 |
| Iron Skull | torpeda oblężnicza | 358 / 15 | 171 / 15 | 232 / 15 | 114 / 15 |

### B. Rekomendacja: armorMul 1,5, killFrac 0,35, pula ×1 (gra bez zmian balansu)

mostek pierwszy w 17/72 przypadków, mediana pocisków mostek/pula 1,66×

| kadłub | broń | dziób | skos 45° | burta | rufa |
|---|---|---|---|---|---|
| Bellator | działko ciężkie | 1821 / 429 | 1011 / 429 | 845 / 427 | 511 / 427 |
| Bellator | railgun Mk II | 2346 / 1200 | 1418 / 1195 | 1235 / 1195 | **774** / 1195 |
| Bellator | armata oblężnicza | 270 / 80 | 182 / 80 | 158 / 80 | 90 / 80 |
| Bellator | Valkyrie (special) | 163 / 24 | 79 / 24 | 126 / 24 | 60 / 24 |
| Bellator | laser puls | 303 / 267 | 274 / 267 | **258** / 265 | 367 / 267 |
| Bellator | laser ciągły | **1172** / 1783 | **736** / 1382 | **730** / 1434 | **1210** / 1399 |
| Bellator | torpeda oblężnicza | 280 / 15 | 192 / 15 | 154 / 15 | 90 / 15 |
| Iron Skull | działko ciężkie | 1895 / 426 | 751 / 423 | 767 / 429 | 484 / 426 |
| Iron Skull | railgun Mk II | 2632 / 1183 | **1014** / 1192 | **1143** / 1200 | **697** / 1192 |
| Iron Skull | armata oblężnicza | 312 / 80 | 125 / 80 | 133 / 80 | **74** / 80 |
| Iron Skull | Valkyrie (special) | 169 / 24 | 62 / 24 | 116 / 24 | 45 / 24 |
| Iron Skull | laser puls | 532 / 267 | **234** / 259 | 316 / 267 | 396 / 267 |
| Iron Skull | laser ciągły | **1220** / 1413 | **642** / 1273 | **688** / 1295 | **1264** / 1702 |
| Iron Skull | torpeda oblężnicza | 329 / 15 | 133 / 15 | 141 / 15 | 85 / 15 |

### C. Rekomendacja + pula ×0,5 (trafienie w kadłub zdejmuje połowę obrażeń z puli)

mostek pierwszy w 40/72 przypadków, mediana pocisków mostek/pula 0,85×

| kadłub | broń | dziób | skos 45° | burta | rufa |
|---|---|---|---|---|---|
| Bellator | działko ciężkie | 1821 / 858 | 1011 / 850 | **845** / 854 | **511** / 854 |
| Bellator | railgun Mk II | **2346** / 2400 | **1418** / 2379 | **1235** / 2379 | **774** / 2390 |
| Bellator | armata oblężnicza | 270 / 160 | 182 / 160 | **158** / 160 | **90** / 160 |
| Bellator | Valkyrie (special) | 163 / 48 | 79 / 48 | 126 / 48 | 60 / 48 |
| Bellator | laser puls | **303** / 405 | **274** / 502 | **258** / 508 | **367** / 446 |
| Bellator | laser ciągły | **1172** / 1960 | **736** / 2168 | **730** / 1786 | **1210** / 1587 |
| Bellator | torpeda oblężnicza | 280 / 30 | 192 / 30 | 154 / 30 | 90 / 30 |
| Iron Skull | działko ciężkie | 1895 / 845 | **751** / 839 | **767** / 858 | **484** / 851 |
| Iron Skull | railgun Mk II | 2632 / 2365 | **1014** / 2365 | **1143** / 2335 | **697** / 2383 |
| Iron Skull | armata oblężnicza | 312 / 158 | **125** / 160 | **133** / 160 | **74** / 159 |
| Iron Skull | Valkyrie (special) | 169 / 48 | 62 / 48 | 116 / 48 | **45** / 48 |
| Iron Skull | laser puls | **532** / 535 | **234** / 461 | **316** / 498 | **396** / 468 |
| Iron Skull | laser ciągły | **1220** / 1607 | **642** / 1879 | **688** / 1424 | **1264** / 1953 |
| Iron Skull | torpeda oblężnicza | 329 / 30 | 133 / 30 | 141 / 30 | 85 / 30 |

### D. Atlas: warianty mostka, 1,5 / 0,35, pula ×0,5

mostek pierwszy w 33/144 przypadków, mediana pocisków mostek/pula 1,81×.
Najsłabszy jest mostek dziobowy (blisko obrysu), najtwardszy — rufowy z
zapasowym (trzeba dwóch tuneli). Stąd domyślny wariant gracza.

| kadłub | broń | dziób | skos 45° | burta | rufa |
|---|---|---|---|---|---|
| Atlas (rufowy) | działko ciężkie | >3000 / 858 | 2102 / 849 | 1723 / 854 | 1997 / 854 |
| Atlas (śródokręcie) | działko ciężkie | >3000 / 858 | 1542 / 851 | 1400 / 858 | >3000 / 854 |
| Atlas (dziobowy) | działko ciężkie | 1719 / 858 | 891 / 858 | 1206 / 851 | >3000 / 854 |
| Atlas (rufowy z zapasowym) | działko ciężkie | >3000 / 858 | >3000 / 849 | 2928 / 854 | >3000 / 854 |
| Atlas (rufowy) | Tempest Ion L | >3000 / 996 | 1380 / 988 | 1922 / 996 | 1332 / 992 |
| Atlas (śródokręcie) | Tempest Ion L | 1839 / 996 | 1778 / 1004 | 1406 / 1000 | 2664 / 996 |
| Atlas (dziobowy) | Tempest Ion L | **914** / 996 | **603** / 996 | **783** / 1000 | >3000 / 996 |
| Atlas (rufowy z zapasowym) | Tempest Ion L | >3000 / 996 | 1976 / 988 | 2704 / 996 | >3000 / 992 |
| Atlas (rufowy) | armata oblężnicza | 687 / 160 | 556 / 159 | 735 / 160 | 307 / 160 |
| Atlas (śródokręcie) | armata oblężnicza | 402 / 160 | 436 / 160 | 459 / 160 | 584 / 160 |
| Atlas (dziobowy) | armata oblężnicza | 211 / 160 | **154** / 160 | 184 / 160 | 783 / 160 |
| Atlas (rufowy z zapasowym) | armata oblężnicza | 687 / 160 | 709 / 159 | 919 / 160 | 789 / 160 |
| Atlas (rufowy) | Valkyrie (special) | 305 / 48 | 206 / 48 | 202 / 48 | 182 / 48 |
| Atlas (śródokręcie) | Valkyrie (special) | 148 / 48 | 176 / 48 | 148 / 48 | 336 / 48 |
| Atlas (dziobowy) | Valkyrie (special) | 61 / 48 | 68 / 48 | 146 / 48 | 443 / 48 |
| Atlas (rufowy z zapasowym) | Valkyrie (special) | 307 / 48 | 273 / 48 | 346 / 48 | 451 / 48 |
| Atlas (rufowy) | laser puls | 610 / 534 | **528** / 531 | **434** / 506 | **400** / 534 |
| Atlas (śródokręcie) | laser puls | **362** / 534 | **450** / 528 | **310** / 444 | 639 / 534 |
| Atlas (dziobowy) | laser puls | **141** / 534 | **280** / 510 | **318** / 515 | 749 / 534 |
| Atlas (rufowy z zapasowym) | laser puls | 644 / 534 | 808 / 531 | 762 / 506 | 865 / 534 |
| Atlas (rufowy) | torpeda oblężnicza | 695 / 30 | 526 / 30 | 432 / 30 | 330 / 30 |
| Atlas (śródokręcie) | torpeda oblężnicza | 426 / 30 | 436 / 30 | 296 / 30 | 598 / 30 |
| Atlas (dziobowy) | torpeda oblężnicza | 260 / 30 | 159 / 30 | 186 / 30 | 796 / 30 |
| Atlas (rufowy z zapasowym) | torpeda oblężnicza | 695 / 30 | 685 / 30 | 618 / 30 | 823 / 30 |

### E. Gra dziś (bez poprawki sondy), Bellator, 3 / 0,6, pula ×1

mostek pierwszy w 0/36 przypadków. Pociski wyglądają jak w A tylko dlatego, że
benchmark jest sztywny (bez duchów z §6.1) — w grze z deformacją byłoby gorzej.
Wiązki: mostka nie da się zabić wcale.

| kadłub | broń | dziób | skos 45° | burta | rufa |
|---|---|---|---|---|---|
| Bellator | działko ciężkie | 2349 / 429 | 1467 / 429 | 1402 / 427 | 985 / 427 |
| Bellator | railgun Mk II | >3000 / 1200 | 2290 / 1195 | 2498 / 1195 | 1613 / 1195 |
| Bellator | armata oblężnicza | 359 / 80 | 481 / 80 | 487 / 80 | 178 / 80 |
| Bellator | Valkyrie (special) | 192 / 24 | 120 / 24 | 128 / 24 | 93 / 24 |
| Bellator | laser puls | >3000 / 267 | >3000 / 267 | >3000 / 267 | >3000 / 267 |
| Bellator | laser ciągły | >3000 / 1500 | >3000 / 1500 | >3000 / 1500 | >3000 / 1500 |
| Bellator | torpeda oblężnicza | 306 / 15 | 298 / 15 | 252 / 15 | 116 / 15 |
