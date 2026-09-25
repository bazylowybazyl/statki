# PORT: mostki — zniszczenie mostka = kill

Stan na 2026-09-25: **mechanika jest wpięta do gry** (§0), a **model 3D
mostka** (nadbudówka z oknami, cieniem i wyrwami z heksów 2D) też (§8) — na
**całej flocie bojowej** Terra Nova i piratów oraz na lokomotywie
megafrachtowca (§8.13). Reszta dokumentu to model, liczby z benchmarku i opis
kroków integracji — §4 opisuje, jak to zrobiono i czego jeszcze brakuje
(edytor stref). **Nowy kadłub → mostek:** `docs/BRIEF-mostek-nowego-kadluba.md`.

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
| `applyBridgeHulkVisuals` + `Bridge3D.update` (model 3D, §8) + `BridgeFx3D.update` | `render`, tuż przed `updateHexShips3D` |
| `Bridge3D.attach(Core3D.scene)` | zaraz po `BridgeFx3D.attach` |
| `Bridge3D.update(flightEntities, …)` (free3d) | gałąź lotu nad Ring City |
| mostek jako cel podsystemu (tryb SUB): `getTargetingBridgeTarget`, marker, chwyt 24 px | przy `findTargetingHoveredSubsystem` i rysowaniu trybu SUB |

Zachowanie:
- Mostki mają (NPC i gracz): Atlas (rufowy + zapasowy); Terra Nova — Custos
  (`frigate`), Hasta (`destroyer`), Bellator (`battleship`), Citadella
  (`terran_carrier`), Colossus (`terran_supercapital`); piraci — fregata
  (`pirate_frigate`), niszczyciel (`pirate_destroyer`), Iron Skull
  (`pirate_battleship`); **lokomotywa megafrachtowca** (`megafreighter`,
  tylko moduł `front` — wagony i moduł ogonowy to ładunek). Bez mostków:
  frachtowce cywilne i myśliwce. Układ stref z `BRIDGE_LAYOUT_PROPOSALS`
  (edytor hardpointów jeszcze ich nie zna, §4.1). Klucz = klucz edytora:
  NPC przez `resolveBridgeHullKey`, gracz przez `normalizeBridgeHullKey`
  (`carrier` → `terran_carrier`, `supercapital` → `terran_supercapital`,
  `corvus` na sprite'cie Custosa → `frigate`).
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

Model 3D mostka (§8) wystaje z kadłuba jako jedyny element 3D na kadłubie —
obrażenia nadal z heksów 2D, okna i światła z tej samej osi czasu; zastąpił
szczeliny okien z `bridgeFx3D.js` (wyrzut atmosfery został tam).

## 1. Co jest gotowe

| plik | rola |
|---|---|
| `src/game/shipBridge.js` | cała logika, bez DOM i bez three: strefy, znakowanie heksów, pancerz, integralność, kadencja, utrata dowodzenia, punkt celowania (lock), kierunek wyrzutu, oś czasu „czystej śmierci”, dryf hulka, okna (dane) |
| `src/game/shipBridgeRuntime.js` | klej gry: który kadłub ma mostki, podpięcie po `initHexBody`, hulk (agonia → wrak), stan wizualny hulka |
| `src/3d/bridgeFx3D.js` | okna mostka (1 × `InstancedMesh`, warstwa FG) i wyrzut atmosfery (bank `Fx3D`); scenę dostaje z zewnątrz (`BridgeFx3D.attach(Core3D.scene)`), własnego renderera nie ma. Kadłuby z modelem 3D (§8) — tylko wyrzut |
| `src/3d/bridge3D.js`, `src/3d/bridge3DShapes.js` | model 3D mostka (§8): nadbudówka, cień na kadłubie, okna FG, wyrwy z heksów, przejście na wrak |
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
| Iron Skull (`pirate_battleship`, sprite v2 1727×911) | mostek | −312.5, 0.5, 254, 150 | brudny pomarańcz `#ff9a4a` |
| Atlas — `rufowy` | mostek rufowy (kręgosłup) | −735, −13, 520, 80 | `#d6ecff` |
| Atlas — `srodokrecie` | mostek śródokręcia | 80, −8, 520, 84 | |
| Atlas — `dziobowy` | mostek dziobowy | 632, −8, 244, 66 | |
| Atlas — **`rufowy_z_zapasowym`** (domyślny) | rufowy + zapasowy na dziobie | jw. + 632, −8, 244, 66 | |
| Custos (`frigate`, 2400×1792 → 192×143) | rufowy blok: wieża + właz | −552, −5, 430, 220 | `#e4f3ff` |
| Hasta (`destroyer`, 768×573 → 288×215) | jw. | −193, 0, 150, 76 | `#e4f3ff` |
| Citadella (`terran_carrier`, 1672×941 → 1080×608) | cytadela na rufie: 2 kopuły + mechanizm | −552,5, −14,5, 95, 161 | `#e4f3ff` |
| Colossus (`terran_supercapital`, 1672×941 → 1560×878) | ośmiokątna wieża + blok TERRA NOVA + kapsuła | −81,5, 0, 347, 124 | `#e4f3ff` |
| fregata piratów (`pirate_frigate`, 1942×809 → 192×80) | najeżona kula + krata | −439, 2,5, 232, 195 | `#ff9a4a` |
| niszczyciel piratów (`pirate_destroyer`, 1840×854 → 360×167) | bunkier z czaszką + krata | −406, −7,5, 268, 175 | `#ff9a4a` |
| lokomotywa (`megafreighter`, 1672×941 → 2760×1553) | „C” z włazem + sterówka + kapsuły | 456, −6, 222, 212 | ciepłe `#ffe0b0` |

Test `proposed zones clear every hardpoint, engine slot and core` pilnuje, żeby
strefy nie nachodziły na hardpointy, sloty silników i rdzenie z zapasem
`bridgeZoneMargin(render/PNG, klasa)` — korpus wieżyczki 2D rysowanej nad
modelem wg klasy uzbrojenia (`WEAPON_TIER_BY_HULL`): S 6, M 10, L i Capital
14 px renderu. (Do 2026-09-24 test brał 14 px renderu dla wszystkich i opisywał
to jako sondę hardpointu — sonda ma 14 px PNG; dla fregat stałe 14 px renderu
to ~150 px PNG i nie zostawiało miejsca na mostek.) Test
`every hull with bridge zones has a known sprite…` czyta rozmiar PNG z pliku —
podmiana sprite'a wymusza przegląd strefy. W demie strefy można
przesuwać/obracać/skalować (`E`) i wyeksportować JSON w przestrzeni PNG.

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
2. klatka: `applyCommandLossVisuals` → `Bridge3D.update` (model 3D, §8) →
   `BridgeFx3D.update` → `updateHexShips3D` → `drawHexShips3D` → HUD 2D (strefy,
   % integralności).

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
- ~~Okna: osobny draw call czy `ShipLights3D`~~ — model 3D mostka z własnymi
  oknami (§8); szczeliny `bridgeFx3D.js` tylko dla kadłubów bez modelu.
- Model 3D mostka — otwarte kwestie w §8.11.
- Gracz ginie od razu (zwykła śmierć z wybuchem) — agonia gracza wymagałaby
  blokady sterowania w ścieżce wejścia gracza.
- Edytor hardpointów nie zna mostków (§4.1 p. 5) — strefy siedzą w
  `BRIDGE_LAYOUT_PROPOSALS`.
- Benchmark Node jest „sztywny” (bez deformacji → bez duchów z §6.1). W
  przeglądarce z deformacją liczby pocisków rosną tam, gdzie poprawka ratuje
  trafienia; przycisk „Benchmark” w demie liczy to samo w przeglądarce.

## 8. Model 3D mostka (2026-09-24)

Mostek jest **trójwymiarową nadbudówką wystającą z kadłuba** — jedynym
elementem 3D na kadłubie (kadłuby to płaskie meshe heksów). Model stoi dokładnie
w strefie mostka i zastępuje namalowaną nadbudówkę; obrażenia, kolizje i kill
zostają w 2D (heksy strefy), model tylko je pokazuje. Wpięty do gry.

### 8.1 Pliki

| plik | rola |
|---|---|
| `src/3d/bridge3DShapes.js` | geometria bez three i DOM: bryły (bloki z fazami i skosami, kopuły i elipsy, rury, kolce), rzędy okien na skosach, **11 modeli** (`KIND_DEFS` — rozmiar projektowy liczony ze strefy i skali render/PNG, `bridgePngMap` do czytania cech ze sprite'a), moduły, mapa wysokości, matematyka heksów (lustro GLSL) |
| `src/3d/bridge3D.js` | rysowanie i stan: `Bridge3D.attach(scene)` / `update(entities, opts)`, shadery, rekordy instancji, tekstura obrażeń (duży mostek = kilka kolejnych wierszy), okna/lampy na FG, przejście na wrak, palety `BRIDGE3D_KIND_STYLE`, strojenie `window.__bridge3DTune` |
| `src/3d/bridgeFx3D.js` | bez zmian w wyrzucie atmosfery; **szczeliny okien pomija**, gdy `bridgeState.model3D === true`; eksport `spawnBridgeRoomFlash` i `bridgeHullFxScale` (wspólne z modelem) |
| `src/game/shipBridge.js` | strefy całej floty w `BRIDGE_LAYOUT_PROPOSALS`, zapas od dział `bridgeZoneMargin`, `opts.hullKey` → `bridgeState.hullKey` |
| `src/game/shipBridgeRuntime.js` | `normalizeBridgeHullKey` (id gracza → klucz edytora), `resolveBridgeHullKey` (NPC, tylko lokomotywa składu) |
| `tests/bridge3D.test.mjs` | 16 testów: geometria każdego rodzaju (skończona, w strefie, wysokość względem strefy, nawinięcie, moduły), okna na skosach widocznych z góry, model stoi na swojej strefie i mieści się w teksturze obrażeń, paleta każdego rodzaju, przydział kolejnych wierszy, heksy vs destruktor, blok komórek, wiersz obrażeń i maska sąsiadów, baza instancji vs `bridgeGridToWorld`, wrak i rozpad, oś czasu okien, wyłączanie szczelin |
| `tests/shipBridge.test.mjs`, `tests/shipBridgeRuntime.test.mjs` | strefy vs hardpointy/silniki (zapas wg klasy), rozmiar sprite'ów z pliku, klucze kadłubów gracza i NPC |
| `dema/mostki-demo.*` | model w demie (`M` / „Model 3D”), 10 kadłubów (`HULLS` w `mostki-hulls.js`), hulk → wrak po 4 s jak `finishBridgeKill`, API: `damageBridge`, `killBridge`, `zoomModel`, `freeCam`, `measureWindows3D`, `bench174({ counts })` |
| `dema/mostki3d-shots.js` | zrzuty i pomiary (headless Chrome przez CDP) → `.tmp/mostki3d/`; `--only bench` = 174 okręty: stara flota i mieszana (wszystkie rodzaje) |
| `dema/mostki3d-gra.js` | test w samej grze (`index.html`): haki, modele gracza i piratów, hulk → wrak, cała flota (Terra Nova, piraci, skład megafrachtowca) |
| `dema/mostki3d-drzenie.js` | pomiar drżenia modelu względem kadłuba przy współrzędnych świata jak w grze (§8.12) → `.tmp/mostki3d/drzenie/` |

### 8.2 Modele

Przestrzeń modelu: środek strefy, +X wzdłuż strefy (dziób), +Y = góra sceny,
+Z = wysokość; jednostki = px renderu. Model jest zaprojektowany na strefę
z `BRIDGE_LAYOUT_PROPOSALS`; inną strefę (edytor) instancja dopasowuje skalą XY.

| rodzaj | strefa (j.) | trójkąty | moduły | okna / lampy / listwy | wysokość | styl |
|---|---|---|---|---|---|---|
| `bellator` | 127 × 50 | 1 320 | 6 | 61 okien (38 zapalonych) + czerwona lampa | bryły 22, maszt 31 | biel/szarość Terran: pokład z fazą, hala z pasami okien, wieża z koroną okien, kopuła sensorów, maszt, kopułki |
| `ironskull` | 106 × 63 | 893 | 9 | 19 szczelin (13) + pomarańczowa lampa | bryły 23, kolce 30 | łatanina stali i rdzy, nity, kraty, rury, najeżona kopuła, wielkie kolce |
| `atlas_main` | 250 × 38 | 644 | 6 | 115 (69) + 2 białe lampy + 8 cyjanowych listew | bryły 17, maszty 22 | granat/grafit, kręgosłup z tarasami, blok mostka z koroną okien, płetwy, maszty rufowe |
| `atlas_backup` | 117 × 32 | 320 | 4 | 36 (24) + biała lampa + 4 listwy | bryły 13, maszt 21 | zwężony ku dziobowi blok z koroną okien, czujnik dziobowy |
| `custos` | 34 × 18 | 844 | 6 | 22 (17) + czerwona lampa | wieża 6, maszt 10 | jak Bellator w małej skali: wieża z koroną okien, hala z pionowym włazem, kopuła |
| `hasta` | 56 × 29 | 886 | 6 | 44 (31) + czerwona lampa | wieża 9, maszt 14 | jw. |
| `citadella` | 61 × 104 | 758 | 5 | 51 (38) + czerwona i biała lampa | wieża 17, maszty 28 | cytadela w poprzek kadłuba: wieża z koroną okien, dwa posterunki z kopułami |
| `colossus` | 324 × 116 | 1 404 | 7 | 225 (155) + 3 lampy | wieża 30, górny mostek 37, maszty 57 | ośmiokątna wieża z kratą i górnym mostkiem, dwupoziomowa hala z rzędami okien, owalna kapsuła |
| `pirate_frigate` | 23 × 19 | 661 | 8 | 21 (20) + pomarańczowa lampa | kula 6, maszt 8 | najeżona kula z dwoma rogami na bunkrze ze szczelinami, budka z oknem, krata |
| `pirate_destroyer` | 52 × 34 | 695 | 8 | 23 (19) + pomarańczowa lampa | bunkier 6, maszt 15 | bunkier z płaskorzeźbą czaszki i piszczeli, kolce, krata, rury |
| `megafreighter` | 366 × 350 | 1 278 | 7 | 111 (78) + 4 lampy (bursztynowe na kapsułach) | sterówka 44, anteny 69 | przemysłowa stal: obręcz „C”, moduł z włazem i kopułą, sterówka z koroną ciepłych okien, kapsuły z pomarańczowymi znacznikami |

Rodzaj wybiera `resolveBridgeModelKind(hullKey, def)`: kadłub z jednym
rodzajem — ten rodzaj; Atlas — po id strefy, `role: 'backup'` → zapasowy,
warianty edytora po proporcjach strefy. Z góry wysokość czyta się
tylko przez światło i cień, więc bryły są z pochyłych płaszczyzn, a **okna
stoją na skosach ~40–55°** (n.z > 0,5; na stromych ścianach byłyby z góry
kreskami — pilnuje tego test). Okno zasłonięte z góry wyższą bryłą nie dostaje
emitera (filtr po mapie wysokości).

Odrzucone: przenoszenie rysunku sprite'a na dachy (nawet tylko drobnego
detalu luminancji) — kształty namalowanej nadbudówki prześwitywały przez model
jak „duch”. Powierzchnia jest proceduralna (palety z próbek stref, panele
w dwóch skalach, brud; piraci: płyty stal/ciemna stal/rdza, zacieki, nity).

### 8.3 Światło i cień

- **Ten sam kierunek co kadłub**: `normalize(słońce − statek, z = 600)` liczone
  w vertex shaderze z `window.SUN`; te same stałe (otoczenie 0,24, rozproszone
  1,18, połysk Blinna 0,30 — `SHIP_LIGHT_DEFAULTS`).
- **Dach świeci jak kadłub pod strefą** (`hullLightAt` — lustro „poduszkowej”
  normalnej `HEX_FRAGMENT_SHADER`), skosy od słońca dostają rozproszone, ściany
  odchylone mniej otoczenia. Zmierzone (HDR, bez bloomu) dach modelu / namalowana
  strefa w tym samym miejscu: Bellator 0,262 / 0,263, Iron Skull 0,039 / 0,052,
  Atlas 0,066 / 0,032 (Atlas ma ciemny kręgosłup na sprite'cie).
- **Nic na modelu nie świeci poza oknami i żarem**: miękkie ramię jasności
  dochodzi do ~0,86 (próg bloomu 0,9). Piksele powierzchni > 0,9 bez okien:
  Bellator 9, Iron Skull 0, Atlas 3 (to połyski na krawędziach 1-pikselowych).
- **Cień**: słońce leży prawie na horyzoncie — fizyczny cień miałby setki
  jednostek, a dachy i kadłub świecą niemal samym otoczeniem. Dlatego cień
  liczymy ze „**słońca cieni**”: ten sam azymut, wysokość `shadowElevDeg` 30°
  (cień ≈ 1,7 × wysokość), marsz 32 krokami po **mapie wysokości** modelu (R8,
  poszerzonej o teksel, żeby cienkie maszty nie przepadały), miękki półcień
  rosnący z odległością, plus AO u stóp brył. Na modelu cień kładzie się też na
  otoczenie (`selfShadowAmbient` 0,55).
- **Cień na kadłubie** (kadłuby nie odbierają shadow map): jeden `InstancedMesh`
  prostokątów tuż POD kadłubem (z = −0,6) z testem głębi `GREATER` — rysuje się
  tylko tam, gdzie coś bliżej kamery zapisało głębię, czyli **dokładnie na
  sylwetce kadłuba i nigdy w wyrwach**, bez stencila. Prostokąt = obrys modelu
  wydłużony od słońca o zasięg cienia; siła 0,5. Kolejność: kadłuby 10 → cień 11
  → model 12 (model przykrywa cień na sobie).
- Wyrwy są też w cieniu: wysokość mapy liczy się tylko nad żywą komórką.

### 8.4 Obrażenia z 2D (wyrwy)

Tekstura obrażeń RGBA8 768 × 512, **wiersz na instancję**; wiersz = blok
komórek siatki heksów pod modelem (obrys mapy wysokości + pierścień zapasu;
Bellator 21 × 11, Iron Skull 20 × 14, Atlas 37 × 10 i 20 × 9). Blok większy
niż wiersz leży liniowo w kilku **kolejnych** wierszach (`rowCount`,
przydział first-fit `_allocRows`, najwyżej `DAMAGE_MAX_ROWS` = 4): Colossus
2 wiersze (~1000 komórek), lokomotywa 4 (~2300); shader liczy teksel
z indeksu komórki (`idx % 768`, wiersz + `idx / 768`), upload idzie jednym
zakresem na wiersz (three wysyła zakres jako prostokąt o wysokości 1):

| kanał | znaczenie |
|---|---|
| R | 0 = martwa / brak heksa; 64..255 = żywa, HP 0..1 (przypalenie uszkodzonych) |
| G | żar heksa kadłuba (`shardHeatNow`) w chwili zapisu — ten sam kanał co `_heatWoundRim` |
| B | maska martwych sąsiadów (6 bitów, kierunki `HEX_NEIGHBOR_AXIAL`) |
| A | żar świeżego cięcia (sąsiad zginął) w chwili zapisu |

Fragment modelu nad martwą komórką znika (`discard`) — **wyrwa ma kanciasty
brzeg po heksach, dokładnie tam, gdzie wyrwa w kadłubie**. Przy krawędzi,
za którą leży martwy sąsiad: przypalenie (ciemnieje) i cienka żarząca się linia
(żar cięcia, zanik jak żar heksa `heatDecay`); heks rozgrzany na kadłubie świeci
też na modelu. Tył ścian widziany przez wyrwę (free3d) = ciemne wnętrze.
Heks należy do rekordu po przynależności do bieżącej siatki gospodarza
(`grid.shards[s.__meshIndex] === s`), więc heksy odcięte do odłamka znikają
z modelu kadłuba-matki. Komórka pod modelem, która nie jest heksem mostka
(„fartuch” z kadłuba), też otwiera wyrwę.
Wiersz odświeża się, gdy w siatce zginął heks (`shards` / `activeStructuralCount`),
a okresowo (HP, żar bez śmierci heksa) co 1 s tylko dla rysowanych — fazy
rozłożone po rekordach. Upload tylko zmienionych wierszy (`updateRanges`).

### 8.5 Okna, lampy, listwy

Jeden `InstancedMesh` na warstwie 2 (FG, po `shadowShaftsPass`), addytywnie,
`renderOrder` 51 — świecą też w cieniu planety i kadłubów. W kamerze ortho kwad
leży w płaszczyźnie z = 0 z rzutem szyby na XY (skos daje skrót perspektywiczny
i dokładnie pokrywa szybę modelu); w free3d — prawdziwa pozycja i orientacja
(`FrontSide`: okna odwrócone od kamery się nie rysują), lampy jako billboardy.
Szyby w geometrii modelu są ciemne (połysk), światło dokłada FG.

Oś czasu jak szczeliny `bridgeFx3D` (`sampleWindowLight`): przed utratą —
spokojne światło pomieszczeń (serie 2–5 zapalonych, 1–3 ciemne), uszkodzony heks
pod oknem mruga (HP < 55%), wybity — błysk pomieszczenia i gaśnie; po utracie —
rozbłysk, nierówne miganie, **fala gaśnięcia od wyrwy** (`bridgeWaveDelay`,
420 px PNG/s); **mostek zapasowy Atlasa gaśnie osobno** (fala od własnej wyrwy),
gdy padł wcześniej. Lampy (stroboskop) gasną jak światła pozycyjne
(`sampleNavLight`). Wrak bez utraty dowodzenia (zabity pulą) i odłamek z częścią
mostka: „utrata zasilania” — to samo gaśnięcie od środka strefy.
Uwaga: gra nie wołała `prepareWindowWave`, więc szczeliny gasły naraz — model
liczy fale sam (z `bridge.vent` / `st.vent`).

**Pasma HDR okien** (pomiar różnicowy: kadr z emiterami − bez, bez bloomu,
zbliżenie jak w §4.5):

| kadłub | p50 | p90 | p99 | max | piksele okien > 0,9 | powierzchnia > 0,9 bez okien |
|---|---|---|---|---|---|---|
| Bellator `#e4f3ff` | 0,41 | 0,92 | 1,36 | 1,40 | 316 / 2 781 (11%, rdzenie) | 9 px |
| Iron Skull `#ff9a4a` | 0,26 | 0,61 | 0,77 | 0,77 | 0 (brudny pomarańcz, bez bloomu) | 0 |
| Atlas `#d6ecff` | 0,32 | 0,53 | 1,13 | 1,42 | 128 / 4 237 (3%) | 3 px |

(szczeliny: Bellator p99 1,60, Iron Skull ≤ 0,83, Atlas p99 1,46 — ten sam
charakter, rdzeń tuż nad progiem, poświata pod nim, zero obwódki). Listwy Atlasa
0,75 × barwa (bez bloomu), lampy jak światła pozycyjne (rdzeń ~4,5).

### 8.6 Hulk → wrak (decyzja) i rozpad

**Zgaszony model zostaje na wraku** — to ta sama blacha i lepszy łup do
holowania; znikanie modelu przy `finishBridgeKill` byłoby „pyknięciem”. Nie ma
haka w `finishBridgeKill`: rekord trzyma obiekty heksów swoich komórek,
`spawnWreckEntity` przekazuje wrakowi **te same** heksy w tej samej pozie
(pivot), więc gdy hulk znika z listy, rekord znajduje nowego gospodarza po
przynależności heksów i rysuje się już w tej samej klatce. Na wraku okna są
zgaszone (oś czasu minęła), wyrwy dalej idą za heksami wraku.
**Rozpad** (heksy mostka w odłamku): rekord kadłuba-matki pokazuje swoje
komórki, na odłamku powstaje rekord-siostra (te same komórki, osobny wiersz,
utrata zasilania) — model pęka razem z kadłubem. Rekord bez żywych heksów
odchodzi od razu; gospodarz niewidziany 2 s oddaje wiersz tekstury (dostaje nowy,
gdy wróci), po 60 s rekord odchodzi. Gospodarz, który żyje i ma heksy, ale nie
ma go na liście (lot nad Ring City rysuje sam statek gracza), zatrzymuje rekord.

### 8.7 Wydajność

Wywołania rysowania: **widoczne rodzaje + 2 na całą flotę** — po jednym
`InstancedMesh` na rodzaj z widocznymi instancjami (z 11) w passie ortho + cień
na kadłubie (1, ortho) + okna (1, FG).
Zero alokacji w klatce (typowane bufory, pule zakresów uploadu, wspólna tabela
sąsiadów); `addUpdateRange` z three alokuje obiekt — zastąpione własnym zakresem.

Benchmark `bench174` (RTX 5080, headless Chrome, 80 Bellatorów + 80 Iron
Skulli + 14 Atlasów = 189 rekordów, mediana z 2 × 78 klatek, model wł./wył.):

| widok | modeli rysowanych | draw calle modelu | `Bridge3D.update` CPU | GPU klatki wł. / wył. |
|---|---|---|---|---|
| zoom 0,12 (cała flota) | 14 (reszta wygaszona < 18 px) | +1 ortho | 0,11 ms (p90 0,20) | 1,11 / 0,86 ms (szum ±0,3) |
| zoom 0,22 (110 w kadrze) | 110 (LOD) | +2 ortho | 0,11 ms (p90 0,21) | 0,74 / 0,56 ms |
| zoom 0,6 (bitwa z bliska) | 16 pełnych + 412 okien | +3 ortho, +1 FG | 0,105 ms (p90 0,19) | 0,81 / 0,70 ms |

**Mieszana flota** (2026-09-25, ten sam benchmark, 174 okręty ze wszystkimi
rodzajami: 40 Custosów, 32 fregaty i 30 niszczycieli piratów, 30 Hast,
po 14 Bellatorów i Iron Skulli, 6 Citadelli, 4 Colossusy, 3 Atlasy,
lokomotywa): `Bridge3D.update` 0,11–0,145 ms (p90 ≤ 0,21), modelu najwyżej
+4 ortho +1 FG, GPU +0,11–0,25 ms. Stara flota po zmianach: 0,11–0,125 ms
(p90 ≤ 0,175), GPU +0,07–0,23 ms — bez regresji.

Rozkład GPU przy zoomie 0,6 (wariant „bez brył” itd.): bryły ~0,09 ms, cień na
kadłubie ~0,01 ms, okna ~0,01 ms. Podpięcie nowych okrętów: ~60–70 µs na
rekord, najwyżej **24 na klatkę** (`adoptPerFrame`; zmierzone 25 rekordów =
1,87 ms), reszta w kolejnych klatkach — do tego czasu świecą szczeliny.

**LOD**: szerokość strefy na ekranie < 18 px → model znika (pełny od 30 px;
poniżej ~20 px bryła nic nie dodaje, a pod-pikselowe trójkąty z MSAA były
najdroższe); < 70 px → bez marszu cienia, AO i cienia na kadłubie; okna gasną
z wielkością szyby 0,6 → 1,8 px (jak `BRIDGE_FX_TUNE`). W free3d rozmiar
z odległości i pola widzenia kamery.

### 8.8 Haki w grze (`index.html`, szukaj `Bridge3D`)

| co | gdzie |
|---|---|
| `import { Bridge3D }` | obok importu `BridgeFx3D` |
| `Bridge3D.attach(Core3D.scene)` | zaraz po `BridgeFx3D.attach` (po `initHexShips3D`) |
| `Bridge3D.update(renderEntities, { nowSec: bridgeSimTime, dt, zoom, poseOf: bridgeRenderPose, cull: _hexCullInfo, camera: cam })` | `render`, **przed** `BridgeFx3D.update` (ustawia `bridgeState.model3D`) |
| `Bridge3D.update(flightEntities, { …, camera: flightCamera })` | gałąź lotu nad Ring City (free3d), przed `updateHexShips3D` |

Gracz idzie za pozą interpolowaną (`poseOf`), NPC — za fizyczną; kadrowanie
tym samym pudłem co `updateHexShips3D` (`_hexCullInfo.drawHalfW/H`).

### 8.9 Pod wizualny silnik destrukcji 3D

Każdy wierzchołek ma `aModule`, model ma tabelę `modules` (nazwa, zakres
wierzchołków i indeksów, obrys 3D) — `Bridge3D.getModel(rodzaj)`. Instancja
ma maskę modułów (48 bitów): `Bridge3D.setModuleHidden(rekord, moduł, true)`
chowa moduł w instancji (vertex shader zwija go), a silnik może w tym czasie
narysować go sam jako odłamek (zakres geometrii z tabeli). Rekordy encji:
`Bridge3D.recordsOf(encja)`. Wyrwy z heksów działają niezależnie od maski.

### 8.10 Strojenie i sprawdzanie

`window.__bridge3DTune` (`BRIDGE3D_TUNE`): `shadowElevDeg`, `shadowStrength`,
`aoStrength`, `minPx/fullPx/lodPx`, `winCoreGain/winHaloGain`,
`beaconCoreGain`, `rimWidth/scorch/cutGlow`, `enabled` (wył. = dawne
szczeliny), diagnostyka `drawModel/drawEmitters/receiver`.

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-shots.js              # wszystko
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-shots.js --only bench # 174 okręty
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-gra.js                # sama gra
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON dema/mostki3d-drzenie.js            # drżenie (§8.12)
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/bridge3D.test.mjs
```

W samej grze (`dema/mostki3d-gra.js`, headless Chrome): nowa gra → Atlas gracza
ma oba modele (`model3D` true, 4 wywołania, 105 okien, `Bridge3D.update`
0,02–0,05 ms), ciężka flota piracka → 3 modele Iron Skull, zniszczenie strefy
mostka pirata → hulk → po 4 s `ironskull@wrak` (model przeszedł na wrak), bez
błędów w konsoli (poza niezwiązanym dekodowaniem dźwięku w headless).

Zrzuty w `.tmp/mostki3d/`: `raport_<kadłub>_zblizenia.png` (cały / uszkodzony
/ hulk 0,3 s / hulk 1,5 s / wrak / dawne szczeliny), `raport_<kadłub>_kadlub.png`
(z daleka; Atlas także „padł rufowy — dowodzi zapasowy”), `raport_free3d.png`,
`bitwa_174_flota.png`. Pułapka pomiarowa: demo podmienia `performance.now` na
zegar wirtualny — wewnętrzne ms (`Bridge3D.stats.cpuMs`, `Core3D.lastFramePerf`)
wychodzą tam 0; demo mierzy `realNow`. Czas GPU (EXT timer) wymaga oddania
wątku między klatkami; przy małych kosztach porównywać z wariantem „nic”.

### 8.11 Otwarte kwestie

- Gracz obejrzał model w grze (2026-09-24) i zgłosił drżenie — przyczyna
  i poprawka w §8.12.
- Ten sam błąd precyzji (§8.12: pozycje świata w danych instancji, mesh
  w zerze, mnożenie na GPU we float32) jest w innych modułach 3D. Potwierdzone
  w kodzie: światła pozycyjne `shipLights3D` i szczeliny/wyrzut `bridgeFx3D`
  (translacja instancji = `x`, `−y` świata). Ten sam wzorzec, niemierzone:
  `engineExhaustBatch`, `hexBodyImpostorBatch`, `fxParticles3D`, `coreFx3D`.
  Przy 5–10 mln j. to ~1 px drgań względem kadłuba. Poza zakresem modelu mostka.
- Strefy przestawione edytorem: model skaluje się do strefy (XY), może wyglądać
  rozciągnięty; projektowany na strefy z `BRIDGE_LAYOUT_PROPOSALS`.
- Żar cięcia świeci na modelu także przy zabiciu pociskiem, podczas gdy brzeg
  rany kadłuba żarzy się tylko przy zderzeniach (`_heatWoundRim` bez kontekstu)
  — świadomy wybór (cienka linia, `cutGlow` 0,42); do zdjęcia jednym suwakiem.
- Cień modelu nie wchodzi do cieni kadłubów w passie shafts (SDF sylwetki) —
  mostek nie wydłuża długiego cienia statku na inne okręty (plik innej sesji).
- W trybie lotu nad Ring City `BridgeFx3D` nie jest wołany (było tak wcześniej)
  — jego szczeliny/wyrzut mają tam stan z ostatniej klatki; model jest wołany.
- Pojemność: 512 wierszy (okręty + wraki z modelem naraz). Po przekroczeniu nowy
  okręt dostaje szczeliny zamiast modelu (wszystko albo nic na kadłub).
- Palety są stałe w kodzie (próbki z obecnych sprite'ów) — przy zmianie sprite'a
  zaktualizować `BRIDGE3D_KIND_STYLE` w `bridge3D.js`. Iron Skull dostał
  2026-09-25 paletę nowej rodziny sprite'ów piratów (ciemna stal, mniej rdzy);
  poprzednia była próbkowana ze sprite'a sprzed migracji.
- Małe kadłuby mają mało heksów w strefie (Custos ~10, fregata piratów ~10,
  Hasta 28): przy `killFrac` 0,35 cięższe trafienie w strefę potrafi zdjąć
  mostek jednym strzałem. To konsekwencja promienia heksa (zawsze 5 px
  renderu) — dźwignią jest strefa albo `killFrac` per strefa, jeśli ma być
  inaczej.
- Lokomotywa po utracie mostka: skład dryfuje razem z hulkiem, po 4 s
  lokomotywa jest wrakiem i skład się rozpada (istniejąca ścieżka `headGone`
  w `updateMegafreighterTrains`) — wagony zostają bez kinematyki.
- Demo: przy zoomie powyżej ~14 warstwa FG (okna, światła pozycyjne) wypada
  przed `near` = 100 kamery perspektywicznej Core3D i znika. Gra kończy zoom
  na 3,2, więc to tylko ograniczenie zbliżeń w demie (`mostki3d-shots.js`
  zbliża najwyżej do 12).

### 8.12 Precyzja: drżenie modelu przy współrzędnych gry (2026-09-24)

**Objaw** (zgłoszony z gry): mostek cały czas drży względem kadłuba.

**Przyczyna**: świat gry leży przy 5–10 mln j. (start gracza ≈ 7,08 / 6,29 mln),
gdzie float32 ma krok 0,5 j. (powyżej 8,39 mln — 1 j.). Model wpisywał do
macierzy instancji bezwzględną pozycję świata, a shader liczył
`projectionMatrix * viewMatrix * (instancja · p)` we float32. GPU mnoży najpierw
`projectionMatrix * viewMatrix`, więc duże liczby znoszą się dopiero w NDC —
błąd wychodzi ~1 px przy każdym zoomie i zmienia się co klatkę, gdy kamera
drgnie (wychylenie za myszą, prowadzenie po prędkości, wstrząs). Kadłub jest
dokładny, bo stoi na `mesh.position`: three składa
`modelViewMatrix = kamera⁻¹ · mesh.matrixWorld` na CPU w double i do GPU idą
już małe liczby.

**Poprawka** (`Bridge3D._setOrigin`): co klatkę początek układu przy kamerze
(ortho: `cam.x`, `−cam.y`; free3d: pozycja kamery; awaryjnie środek `cull`)
trafia do `mesh.position` wszystkich 6 meshy, a translacje instancji — bryły,
cień na kadłubie, okna — są względem niego (małe liczby). Shadery:
`projectionMatrix * modelViewMatrix * instanceMatrix * p`. Kierunek światła
dalej z `modelMatrix * instanceMatrix` (słońce jest daleko, ±0,5 j. bez
znaczenia); kierunek widoku w przestrzeni kamery (ortho: prosto z góry, jak
`viewDir` kadłuba). Przy okazji: rozrzut startu marszu cienia był z
`gl_FragCoord` — szum stał w ekranie i „gotował się” na przesuwającym się
modelu; teraz `b3Dither` jest przyklejony do modelu (komórki ~1 px ekranu,
potęga 2 — stały przy drobnym zoomie).

**Pomiar** (`dema/mostki3d-drzenie.js`): kamera co klatkę o dokładnie 1 px,
16 klatek, kadłub tylko w głębi, maska = piksele zmieniane przez sam model,
przesunięcie modelu metodą Lucasa–Kanade (px ekranu):

| przypadek | przed: RMS / max | po: RMS / max |
|---|---|---|
| Atlas przy zerze, zoom 2 | 0,023 / 0,038 | 0,022 / 0,030 |
| Atlas 7,08 mln, zoom 2 | **0,69 / 1,04** | 0,022 / 0,030 |
| Atlas 7,08 mln, zoom 1 | **0,30 / 0,45** | 0,019 / 0,026 |
| Atlas 9,87 mln, zoom 2 | **1,03 / 1,66** | 0,022 / 0,030 |
| Bellator 7,08 mln, zoom 2 | **0,53 / 0,86** | 0,010 / 0,015 |

W samej grze (nowa gra, kamera RTS przesuwana co 1 px, ten sam pomiar): przed —
skoki między kolejnymi klatkami 0,2–0,9 px, po — ~0,03 px. Pasma HDR okien
i wygląd bez zmian (zrzuty kontrolne: średnia różnica 0,1–0,3 poziomu, sam
rozrzut w półcieniach).

Poprawka pomiaru (2026-09-25): tabela wyżej szła z **włączonym** bloomem —
zapis do `Core3D.perfToggles` nie przełącza passów, robi to dopiero
`Core3D.setPerfToggles(...)` (`_applyPassToggles`). Narzędzie już tak robi;
ponownie zmierzone „po”: RMS ≤ 0,021 px, max ≤ 0,029 px (Atlas 0 / 7 / 9,9
mln j., Bellator, Iron Skull), a szum jasności na masce spadł z 0,7–1,9 do
0,2–0,6 poziomu. Wniosek się nie zmienia (oba kolumny „przed/po” mierzone były
tak samo, model jest ciemny, więc bloom prawie go nie dotyka).

Reguła dla dalszych zmian: **żadnych bezwzględnych pozycji świata w danych
instancji ani atrybutach** — duży offset w `mesh.position`, dane względem niego.
Podzielony ekran: początek przy kamerze gracza 1, więc dla drugiego widoku błąd
rośnie z odległością między kamerami (1 mln j. → ~0,06 j.).

### 8.13 Reszta floty (2026-09-25) i nowy kadłub

Mostki (strefa + model) dostały: Custos, Hasta, Citadella, Colossus, fregata
i niszczyciel piratów, lokomotywa megafrachtowca (tabele w §2 i §8.2).
**Instrukcja dla nowego kadłuba: `docs/BRIEF-mostek-nowego-kadluba.md`.**

- **Dane z jednego miejsca**: rodzaj modelu (`KIND_DEFS` w
  `bridge3DShapes.js`) wskazuje kadłub, strefę, rozmiar PNG i profil renderu;
  rozmiar projektowy liczy się ze strefy × `getHullRenderSize` — przesunięcie
  strefy albo zmiana długości kadłuba nie rozjeżdża modelu. Builder dostaje
  `P` (`bridgePngMap`): położenia cech czyta się wprost ze sprite'a w px PNG.
- **Skala**: `detail` rodzaju (pierwiastek z pola strefy względem Bellatora,
  0,35–3) skaluje panele, brud, AO i margines cienia w shaderze (lokomotywa
  ma płyty ×3, fregata ×0,35). Wysokość w atlasie mapy normalizowana do
  szczytu rodzaju (8 bitów na model), teksel mapy rośnie z modelem (0,5 j.;
  Colossus i lokomotywa ~1 j.). Zniknął globalny limit wysokości 40 j.
- **Style**: Terra Nova = biel Bellatora (Custos i Hasta cieplejsze — próbki
  stref), wspólny zestaw `buildTerranCommand` (wieża z koroną okien + hala
  z pionowym włazem + kopuła + maszt); piraci = zestaw `spikedDome` / `grille`
  / `crookedMast`, paleta nowej rodziny sprite'ów (ciemna stal, rdza jako
  akcent — także Iron Skull); lokomotywa = przemysłowa stal, pomarańczowe
  znaczniki (`TRIM`), bursztynowe lampy, ciepłe okna `#ffe0b0`.
- **Pomiar cech ze sprite'a**: sprite z nałożonymi hardpointami, silnikami,
  kołami zapasu `bridgeZoneMargin` i siatką co 10 px PNG (skrypt PIL/kanwa —
  kilka linijek), potem współrzędne cech prosto do buildera. Pierwsze
  szacunki „z oka” na zgrubnej siatce myliły się o 20–50 px (Colossus: wieża
  przy −249…−140, nie −288…−188).
- **Sprawdzone** (demo, headless Chrome): zbliżenia, cały kadłub, uszkodzony
  (wyrwy po heksach także w 4-wierszowym bloku lokomotywy), hulk, wrak, wolna
  kamera; pasma HDR okien: Terra p99 1,33–1,57 (rdzeń tuż nad progiem),
  piraci ≤ 0,81 (brudny pomarańcz bez bloomu, jak Iron Skull), lokomotywa
  p99 1,21. Powierzchnia > 0,9 bez okien: 0 px. W grze (`mostki3d-gra.js`):
  każdy typ dostaje strefę, rekord i `model3D`, wagony i moduł ogonowy — nic;
  ciężka flota piracka ma teraz 5 niszczycieli z modelami.

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
