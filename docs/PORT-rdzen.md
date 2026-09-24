# PORT: rdzeń statku (reaktor) — z dema do gry

Stan na 2026-09-24 (numery linii `index.html` z wieczornego stanu drzewa — plik zmienia się
równolegle, szukaj po nazwie funkcji). Demo: `npm run dev` → `/dema/rdzen-demo.html`
(`?scene=battleship|pirate_battleship|atlas|trio|formation`, `?weapon=<id>`).
Logika i efekt są gotowe do wpięcia bez przepisywania; ten dokument mówi, co
i gdzie w grze trzeba zmienić. Żaden plik gry nie został w tej fazie ruszony.

---

## 0. W skrócie

- **Model.** Rdzeń = punkt `cores[]` w przestrzeni PNG + promień komory `r`,
  `armorMul`, profil wybuchu. Komora = heksy w promieniu `r` od punktu
  (znacznik `shard.__coreId` nadawany raz, z pozycji startowej), z pancerzem
  `maxHp × armorMul`. Kilka rdzeni na kadłub wolno — każdy zabija.
- **Stany.** NOMINALNY → ODSŁONIĘTY (pierwszy martwy heks komory) →
  KRYTYCZNY (osłona < 60%) → STOPIENIE (osłona ≤ 30%, odliczanie 1,5 / 2,5 /
  3,5 s wg klasy) → DETONACJA **zawsze**, bez losowania.
- **Osłona** = suma HP żywych heksów komory ÷ suma pancerza komory (ważona HP,
  więc osłabiona fala też się liczy). Drugi, przełączalny warunek: dzisiejsza
  sonda punktu (5 punktów, 2 kontrole bez heksa).
- **Najważniejszy wynik benchmarku:** przy dzisiejszej puli HP (12 000, każde
  trafienie zdejmuje pełne obrażenia) **rdzeń nie jest pierwszą drogą killa w
  żadnym ze 144 przypadków**. Dokopać się do komory w 300 s potrafią tylko
  Valkyrie, Yamato i laser pulsacyjny; wszystko inne zabija pulą, zanim
  dotknie komory. Mechanika ożyje dopiero po decyzji o puli HP (§ 11, pyt. 1).
- **Znaleziska po drodze:** heksy-duchy (naprawione równolegle w drzewie:
  laser ciągły trafia teraz 361 zamiast 142 z ~400 spustów), opóźnienie wyniku
  solvera GPU gubi ~65% wgnieceń z czasu „w locie”, ukryta zależność solvera od
  `window.DestructorSystem`, rakiety 3D nie ruszają heksów, 4 uśpione błędy
  integracji rdzeni (§ 5).

---

## 1. Pliki

| plik | rola | zależności |
|---|---|---|
| `src/game/shipCore.js` | cała logika: znakowanie komory, pancerz, stany, odcięcie, łańcuch, wybuch (AoE / fala / kratery), rozpad, lock, eksport | tylko `destructor.js`; bez DOM i three |
| `src/3d/coreFx3D.js` | żar w wyrwie (InstancedMesh pod kadłubem, maskowany głębią), wyrzuty plazmy, podgrzewanie brzegu rany | `three`, `Core3D.scene` podana z zewnątrz; bez własnego renderera |
| `tests/shipCore.test.mjs` | 20 testów na prawdziwym destruktorze (18 zielonych + 2 `todo` = poprawki 1 i 3 do odblokowania przy integracji) | `tests/helpers/destructorHull.mjs` |
| `dema/rdzen-demo.html`, `dema/rdzen-demo.js` | demo: prawdziwy Core3D, hexShips3D, overlay + `reactorblow.js`, krok 120 Hz | — |
| `dema/rdzen-combat.js` | replika ścieżki trafień z `bulletsAndCollisionsStep` / `fireWeaponCore` (te same obrażenia, penetracja, tarcza, sufit heksów) | — |
| `dema/rdzen-scene.js`, `rdzen-hulls-data.js` | kadłuby, kandydaci rdzeni, sceny | — |
| `dema/rdzen-overlay2d.js` | nakładki: siatka, komora, sonda, stan, AoE, duchy błędów 1–2 | — |
| `dema/rdzen-bench*.js` | benchmark deterministyczny (node i przycisk w demie), tabele | — |
| `dema/rdzen-softbody-cpu.js` | lustro 1:1 kernela WGSL solvera sprężyn (node nie ma WebGPU) | — |
| `dema/rdzen-analyze.js` | mapa głębokości (EDT maski) i odstępy od hardpointów/dysz | — |
| `dema/rdzen-shots.js`, `rdzen-gpu-check.js`, `rdzen-cdp.js` | zrzuty, histogram HDR, koszt detonacji, walidacja lustra na WebGPU | headless Chrome (CDP) |

API `shipCore.js` (najważniejsze):

```js
attachShipCores(entity, markers, { pngWidth, pngHeight, classId?, killMode?, config?, color? }) // po initHexBody
updateShipCores(entity, dt, { time, entities, events })      // co krok integralności (gra: 0,08 s)
notifyCoreHostKilled(entity, time, reason, events)           // śmierć z puli HP → wymuszona detonacja od KRYTYCZNEGO
computeCoreBlast(core)            // profil wybuchu: AoE, fala na komory, kratery, rozmiar wizualny
applyBlastCoreShock(blast, x, y, entities, source)           // napęd łańcucha
planCoreBreakup / applyCoreBreakup                            // krater wokół RDZENIA + fragmenty od rdzenia
getCoreLockPoint(entity)          // punkt locka (najgorszy stan, najniższa osłona)
exportCoreMarkers(markers)        // JSON w przestrzeni PNG (edytor)
```

Zdarzenia (`events[]`): `state` (from/to/cause), `severed`, `reactorLost`,
`detonate` (`{ core, host, x, y, blast }`).

---

## 2. Model

### 2.1 Stany i przejścia

| stan | wejście | co widać / słychać |
|---|---|---|
| NOMINALNY | start | nic (pancerz komory nie świeci — świecąca sylwetka czytałaby się jak tarcza) |
| ODSŁONIĘTY | ≥ 1 martwy heks komory | żar dokładnie w wyrwie, kilka iskier z dziury |
| KRYTYCZNY | osłona < `criticalFrac` 0,6 (także bez dziury — fala sąsiada osłabia komorę bez zabijania heksów) | żar mocniejszy, puls, wyrzuty 3/s z martwych heksów komory |
| STOPIENIE | osłona ≤ `killFrac` 0,3 **albo** (tryb sondy) 2 kontrole bez heksa **albo** odcięcie **albo** fala łańcucha | odliczanie, puls 1,2→7 Hz, wyrzuty 8→60/s, brzeg rany rozgrzewa się, HUD; gracz: baner + przyspieszający alarm |
| DETONACJA | koniec odliczania | `reactorblow.js` (profil klasy), AoE, fala na komory sąsiadów, kratery, rozpad od rdzenia |

Odliczania nie da się przerwać (punkt bez powrotu). Śmierć kadłuba z puli HP
w czasie STOPIENIA albo przy rdzeniu KRYTYCZNYM = natychmiastowa detonacja
(`attritionDetonatesFrom: 'critical'`); przy NOMINALNYM/ODSŁONIĘTYM — kadłub
ginie „czysto”, bez losowania wybuchu.

### 2.2 Klasy (`CORE_CLASS_PROFILES`)

Klasa z promienia kadłuba (capital ≥ 210, cruiser ≥ 150, reszta escort) albo
z `marker.profile`. `r` w markerze jest w px PNG; domyślne `chamberR` w px siatki.

| klasa | r komory (px siatki) | armorMul | kryt. / kill | odliczanie | profil `reactorblow` | AoE HP | fala na komory | krater |
|---|---:|---:|---|---:|---|---|---|---|
| escort | 12 | 2,0 | 0,6 / 0,3 | 1,5 s | escort | max(700, R·6) / max(60, maxHp·0,45) | 150 w R·0,3 | r·2,0 |
| cruiser | 18 | 2,5 | 0,6 / 0,3 | 2,5 s | cruiser | jw. | 250 w R·0,35 | r·2,2 |
| capital | 26 | 3,0 | 0,6 / 0,3 | 3,5 s | capital | jw. | 400 w R·0,4 | r·2,5 |

AoE HP = dzisiejszy wzór z `tryTriggerCriticalReactorBlow` (index.html:18179),
tylko liczony od punktu rdzenia, nie od środka kadłuba. Kratery w kadłubach
sąsiadów: `applyImpact` w punkcie zwróconym do wybuchu (hexDamage 500/900/1400).

### 2.3 Odcięcie (zdefiniowane i przetestowane)

Gdy `processSplits` oddzieli fragment z **większością żywych heksów komory**,
rdzeń przechodzi na fragment (`wreck.shipCores`), stary kadłub dostaje
`reactorLost` (w demie: wrak bez napędu), a rdzeń na fragmencie wchodzi w
STOPIENIE z odliczaniem × 0,5 i detonuje z fragmentu. Drobnica bez komory nie
rusza rdzenia. Testy: „odcięcie: rdzeń idzie z fragmentem…”, „odcięcie drobnicy…”.

### 2.4 Łańcuch

Detonacja zapisuje na sąsiadach w promieniu AoE `__coreChain { depth, until }`
(okno 0,5 s); stopienie, które zacznie się w tym oknie, ma `cause: 'chain'` i
głębokość +1. Fala (`applyBlastCoreShock`) zdejmuje HP **żywym heksom komór**
sąsiadów w promieniu fali (spadek liniowy) — osłabia, nie kopie dziury. Wybuch
na głębokości ≥ `maxChainDepth` (1, jak dziś `_critChainDepth`) nie robi już
kraterów ani fali, a AoE maleje × 0,6^głębokość. W formacji (dwa Bellatory
+ dwa Iron Skulle, 720 j.): A detonuje → komora B spada do 13% → B detonuje
jako ogniwo 1 (AoE 3240, bez krateru) → C i D kończą na KRYTYCZNYM (52%),
żyją. Łańcuch nie przechodzi przez całą flotę.

---

## 3. Rozmieszczenie rdzeni

Głębokość = odległość od krawędzi maski alfa (px siatki renderu, EDT),
„hp” / „dysza” = odstęp od najbliższego hardpointu / dyszy z
`hardpointEditorDefaults.js`. Skrypt: `node dema/rdzen-analyze.js`
(mapy `.tmp/rdzen/placement-*.png`, liczby `placement.json`).

| kadłub | kandydat | PNG (x, y) | głębokość | hp | dysza | ocena |
|---|---|---|---:|---:|---:|---|
| Bellator | **A: blok rufowy** | (−320, 0) | 116 (max kadłuba 119) | 90 | 138 | **zalecany** — najgłębiej, między toroidami a dyszami |
| Bellator | B: właz grzbietu | (−219, −5) | 87 | 59 | 186 | dobry, płytszy |
| Bellator | C: para toroidów | (−192, ±112) | 30 / 34 | **1,4 / 3,8** | 171 | **odrzucony** — toroidy to podstawy wyrzutni rakiet (hardpoint `missile` dokładnie w środku), płytko pod krawędzią |
| Iron Skull | **A: kopuła i kratka rufowa** | (−205, 0) | 119 (max 124) | 75 | 162 | **zalecany** |
| Iron Skull | B: płyta z czaszką | (−80, 0) | 100 | 77 | 238 | dobry, przy środku masy |
| Iron Skull | C: śródokręcie | (40, 10) | 91 | 82 | 309 | możliwy |
| Atlas | **A: grzbiet między bankami ogniw** | (−830, 0) | 275 (max 285) | 116 | 340 | **zalecany** — najgłębiej w całym kadłubie |
| Atlas | B: grzbiet przed wieżą | (70, 0) | 202 | 186 | 701 | przy środku masy, płycej |
| Atlas | C: para w bankach ogniw | (−830, ±180) | ~210 | 83 | 293 | dwa rdzenie = dwa punkty killa (odradzam dla gracza) |

Dziś w danych **nie ma żadnego rdzenia**: `cores: []` dla `battleship`
(`hardpointEditorDefaults.js:1033`), `pirate_battleship` (`:1763`) i Atlasa
(`atlasHardpointDefaults.js:277`). Rdzenie istnieją tylko z edytora (`hpEditor.v1`).

Wpis do domyślnych (eksport z edytora dema, przestrzeń PNG):

```json
{
  "atlas":             { "cores": [{ "id": "atlas_A",    "x": -830, "y": 0, "r": 56, "armorMul": 3, "profile": "capital" }] },
  "battleship":        { "cores": [{ "id": "bellator_A", "x": -320, "y": 0, "r": 48, "armorMul": 3, "profile": "capital" }] },
  "pirate_battleship": { "cores": [{ "id": "skull_A",    "x": -205, "y": 0, "r": 42, "armorMul": 3, "profile": "capital" }] }
}
```

(`r` 56 / 48 / 42 px PNG = 26–27 px siatki = komora 36 / 32 / 34 heksów.)

---

## 4. Integracja krok po kroku

Kolejność ma znaczenie: najpierw dane i poprawki 1–4 (bez nich rdzeń wyląduje
w złym miejscu albo zgubi pola), potem pętla, śmierć, efekt.

1. **Dane rdzeni z polami.** `cores[]` z `r`, `armorMul`, `profile`,
   (opcjonalnie `meltdownSec`, `color`). Wymaga poprawki 3
   (`normalizeEditorCore`, `compactMarker`) — inaczej pola giną przy wczytaniu
   i przy zapisie z edytora. Edytor hardpointów: suwak `r` i `armorMul` przy
   markerze rdzenia (edytor dema pokazuje, jak).
2. **Podpięcie po `initHexBody`.** NPC: tam, gdzie `npcHardpointRuntime.js`
   ustawia `npc.editorCores` (`:304`–`:344`) i index.html ustawia
   `npc.__hardpointScaleX` (`index.html:22020`) — dopiero po nich
   `attachShipCores(npc, npc.editorCores, { pngWidth, pngHeight, color })`.
   Gracz: po `updatePlayerLayoutScaleFromRender` (`index.html:5902`) i po
   każdej zmianie kadłuba (`index.html:4244`). Markery podawać **w przestrzeni
   PNG** — skalę liczy `computeCoreLayout` z siatki (poprawka 1).
3. **Pętla.** `updateEntityCoreIntegrity` (`index.html:4515`, wołane z
   `updateHardpointIntegrity`, `:4587`, co 0,08 s) zastąpić przez
   `updateShipCores(entity, dt, { time, entities: dynamicDestructibles, events })`
   dla gracza i NPC; `events` zbierać i obsłużyć raz na krok (pkt 4–6).
   Tryb killa: `killMode: 'containment'` (zalecany) albo `'probe'` (1:1 dzisiejsza
   sonda: `probeEverySec` 0,08, `coreProbeRadius` 12, 2 kontrole).
4. **Śmierć z rdzenia = wymuszona detonacja.** Dziś `destroyEntityFromCore`
   (`index.html:4475`) zadaje `hp + 1` z przyczyną `'default'`, a
   `applyDamageToNPC` (`:18262`) i tak losuje wybuch w
   `tryTriggerCriticalReactorBlow` (`:18179`: bramka „severity” 0,48 i szansa
   26–78%). Zmiana: na zdarzenie `detonate` wołać
   `applyDamageToNPC(npc, npc.hp + 1, 'core', { bypassShield: true, coreBlast: ev.blast, coreAt: { x: ev.x, y: ev.y } })`,
   a w `applyDamageToNPC` przy `cause === 'core'` pominąć losowanie i wejść
   w gałąź wybuchu z parametrami z `blast` (punkt = **rdzeń**, nie `npc.x/y`;
   głębokość łańcucha = `blast.chainDepth`, nie globalny `_critChainDepth`).
   Wyniszczenie (każda inna przyczyna, `hp <= 0`): najpierw
   `notifyCoreHostKilled(npc, time, cause, events)` — jeśli zwróci
   `detonate`, to ta sama gałąź; jeśli nie, kadłub ginie bez wybuchu (albo, na
   czas przejściowy, dzisiejsze losowanie tylko dla kadłubów bez rdzeni).
   Gracz: `handlePlayerDestroyed` (`index.html:17783`) odpala dziś wybuch
   zawsze, w środku kadłuba i bez AoE — z rdzeniem: punkt rdzenia i profil
   z `computeCoreBlast` (AoE na sojuszników — § 11, pyt. 4).
   **Mostki (wpięte do gry 2026-09-24, `docs/PORT-mostki.md`):** hulk po
   utracie dowodzenia (`isBridgeHulk`) nie przyjmuje obrażeń —
   `applyDamageToNPC` wraca od razu — a `finishBridgeKill` (`:18246`) robi
   wrak bez losowania wybuchu. Rdzeń hulka dalej żyje (`updateShipCores` woła
   się też dla hulków), więc detonacji hulka nie wolno puszczać przez
   `applyDamageToNPC` (zatrzyma się na hulku) — gałąź wybuchu wołać
   bezpośrednio. W `finishBridgeKill` przed zrobieniem wraku:
   `notifyCoreHostKilled(npc, time, 'bridge', events)` — rdzeń KRYTYCZNY albo
   w STOPIENIU detonuje (brudny kill), każdy inny zostaje czystym wrakiem
   (§ 11, pyt. 7).
5. **Wybuch.** `triggerReactorBlow3D(x, y, blast.visualSize, { profile: blast.reactorProfile })`
   (`index.html:5662`). Fabryka `reactorblow.js` przyjmuje dziś tylko nazwę
   profilu (`spawn({ x, y, size, profile })`, `reactorblow.js:514`, zamrożone
   `PROFILE_CONFIGS`) — `chargeTime` (0,3 / 0,55 / 0,8 s) nie da się
   zsynchronizować z odliczaniem inaczej niż odpalając efekt `chargeTime`
   przed końcem odliczania (tak robi demo). Proponuję opcję `chargeTime`
   (albo obiekt profilu scalany z bazowym) w `spawn`. AoE HP:
   `applyAoeExplosionDamage` (`index.html:17822`) z punktem rdzenia; fala na
   komory: `applyBlastCoreShock`; kratery: `applyBlastHexDamage` na każdym
   kadłubie w promieniu (demo: `rdzen-combat.js` `applyCoreBlast`).
6. **Rozpad.** `spawnReactorBlowBreakup` (`index.html:18068`) dostaje dziś
   `explPos = npc.x/y`. Z rdzeniem: `planCoreBreakup(core)` +
   `applyCoreBreakup(core, plan, entities)` — krater `r · craterMul` wokół
   rdzenia wyparowuje, reszta idzie w 3–5 sektorów kątowych z pędem od rdzenia
   (fragmenty są zwykłymi wrakami `spawnWreckEntity`). Albo zostawić
   `spawnReactorBlowBreakup`, podając mu punkt rdzenia.
7. **Efekt.** `const coreFx = createCoreFx3D({ scene: Core3D.scene, colorFor, markLayerActive: () => Core3D.setShieldLayerActive(true) })`
   raz; co klatkę `coreFx.sync(allCores, nowSec, simDt)` przed renderem, a
   zdarzenia `state`/`detonate` → `coreFx.onEvent(ev)`. Pauza / zwolnienie:
   `simDt` = czas gry tej klatki (0 w pauzie). Kosztuje 1 draw call na
   wszystkie żary + 1 na wyrzuty (tylko gdy są). **Kolejność:** efekt siedzi
   na warstwie 7 (pass tarcz, § 9), a `shield3D.js:1193` ustawia flagę tej
   warstwy bezwzględnie (`setShieldLayerActive(anyDomeVisible || …)`) —
   `coreFx.sync` musi iść PO aktualizacji tarcz, bo tylko podnosi flagę;
   inaczej przy braku widocznych tarcz pass zostanie pominięty i żar zniknie.
8. **HUD i alarm.** Stany z `summarizeCore`; dla gracza baner STOPIENIA z
   odliczaniem i dźwiękiem jak w demie (`updateAlarm` w `rdzen-demo.js`).
9. **Lock.** Gracz: obok `getTargetingSubsystemTarget` (`index.html:14234`)
   dodać cel-rdzeń (ten sam kształt obiektu, `x/y` z `getCoreWorld`, etykieta
   `RDZEŃ`, `dead` gdy DETONACJA albo host martwy) i dopisać rdzenie do
   `findTargetingHoveredSubsystem` (`:14328`, tylko po skanie). Pociski z
   locka celują w losowy punkt komory (benchmark: lock na podsystem, nie
   piksel — w punkt drąży się tunel na 1 heks, który nie zbija osłony).
   AI: w `equipNpcWeapons` / wyborze celu (`index.html:8897`–`8950`,
   `fireWeaponCore(owner, target, …)`) podać jako `target` obiekt-rdzeń z
   `getCoreLockPoint(target)`, gdy rdzeń ≥ ODSŁONIĘTY, a broń jest ciężka
   (special / L) — „AI dobija odsłonięty rdzeń”.
10. **Zapis.** `hpEditor.v1` wygrywa z domyślnymi (poprawka 4) — po wgraniu
    nowych rdzeni domyślnych starsze zapisy trzeba zmigrować albo wyzerować.

---

## 5. Uśpione błędy 1–4

### Poprawka 1 — podwójne skalowanie rdzeni gracza
- **Miejsce:** `buildPlayerDefaultEditorCores` (`index.html:3820`) mnoży
  `x·scaleX, y·scaleY` (skala z `getPlayerEditorScale`, `:3771` =
  `ship.__hardpointScaleX`), a `getEntityCoreLocalPos` (`:4373`) mnoży drugi
  raz przez `getEntityHardpointScale`. Hardpointy tego nie mają (mają `hp.pos`).
  Zależy od kolejności: przy wywołaniu z `:4094` skala bywa jeszcze 1, po
  zmianie kadłuba (`:4244`) jest już 0,48 → rdzeń Atlasa ląduje 0,48× bliżej
  środka (w demie: nakładka „błędy integracji”, fioletowy krzyżyk).
- **Poprawka:** nie skalować w `buildPlayerDefaultEditorCores` (markery
  zostają w PNG), skalę stosować raz — w `getEntityCoreLocalPos` albo w
  `attachShipCores` (`computeCoreLayout`).
- **Test:** `tests/shipCore.test.mjs` „PNG → siatka: gracz i NPC dają TEN SAM
  wynik” (zielony) + `todo` „PORT poprawka 1” (skan źródła; zdjąć `todo` po
  poprawce).

### Poprawka 2 — `toEditorHullAlias` zlewa Iron Skulla z Bellatorem
- **Miejsce:** `toEditorHullAlias` (`index.html:3586`) obcina `terran_` i
  `pirate_`: gracz na `pirate_battleship` dostaje klucz `battleship`, czyli
  układ (i rdzeń) Bellatora — na Iron Skullu punkt (−320, 0) wypada poza
  kadłubem (w demie: pomarańczowy duch na zrzucie `03-ironskull-komora.png`).
- **Poprawka:** obcinać tylko `terran_` (Bellator = `battleship` w edytorze),
  `pirate_*` zostawić jako osobne klucze (w `hardpointEditorDefaults.js`
  istnieją już `pirate_battleship`, `pirate_destroyer`, `pirate_frigate`).
- **Test:** „rdzeń poza obrysem jest nieważny i nigdy nie zabija” (zielony:
  `attachShipCores` oznacza taki rdzeń `invalid: 'poza-kadłubem'` — gra
  powinna to logować); po poprawce dodać test aliasu w teście edytora.

### Poprawka 3 — gubienie pól rdzenia
- **Miejsce:** `normalizeEditorCore` (`npcHardpointRuntime.js:126`) zwraca
  tylko `{ id, x, y }`; `compactMarker(…, 'core')` (`hardpointEditor.js:2434`)
  zapisuje tylko `{ id, x, y }`.
- **Poprawka:** przepuszczać `r`, `armorMul`, `profile`, `meltdownSec`,
  `color` (wzór: `normalizeCoreMarker` w `shipCore.js`).
- **Test:** `todo` „PORT poprawka 3” (zdjąć `todo`) + round-trip eksportu
  (zielony: „eksport markerów: przestrzeń PNG, zachowane r/armorMul/profile”).

### Poprawka 4 — `hpEditor.v1` bije domyślne
- **Miejsce:** `getPlayerEditorConfigFromStorage` (`index.html:3641`) i
  `npcHardpointRuntime.js:244` czytają `localStorage['hpEditor.v1']` przed
  domyślnymi; `?reset` / `resetGameSave('gniazda')` (`index.html:45`) czyści.
- **Poprawka:** wersja schematu w zapisie (`schema: 2` = rdzenie z `r`) i
  scalanie: brak `cores` albo rdzeń bez `r` w zapisie → rdzenie z domyślnych.
- **Test:** node-owy test `getPlayerEditorConfigFromStorage` z atrapą
  `localStorage` (stary zapis bez `r` → rdzeń z domyślnych).

---

## 6. Inne znaleziska (poza rdzeniem, mierzone)

1. **Heksy-duchy — naprawione w drzewie roboczym przez równoległą sesję
   („Fix ghost hexes…”, 2026-09-24).** Przed poprawką wgniecione heksy
   wypadały z okien sond (±3 komórki w `probeImpact` / `sweepImpact`, ±1 w
   raymarchu wiązki) i pocisk przelatywał przez wgniecenie: laser ciągły
   trafiał 142–164 razy na ~400 spustów (Bellator, 20 s, WebGPU), przy 144 FPS
   jeszcze rzadziej, a potrafił też „przestrzelić” pancerz i trafić heks
   komory głęboko (Atlas, skos: ODSŁONIĘTY po 67 trafieniach). Teraz okna sond
   rosną o zmierzony dryf (`getHexProbeDrift`, sufit
   `DESTRUCTOR_CONFIG.probeDriftCap` 120 — `destructor.js:106`, `:601`),
   wiązka szuka przez `findBeamHexShard` (`destructor.js:618`, wołane
   w `index.html:8546`), a trafiony heks idzie prosto do `applyImpact`
   (`opts.shard`; `applyHexImpact`, `index.html:8241`). Mój pomiar po zmianie:
   361 / ~400 na GPU przy 60 i przy 144 FPS, lustro CPU 362. A/B sprzed
   poprawki: `probeDriftCap = 0` + `gpuSoftBodyHz = 0` (demo: przełącznik
   „okna sond sprzed poprawki”, benchmark: `--legacy`).
2. **Solver sprężyn krokuje w czasie gry** (`DESTRUCTOR_CONFIG.gpuSoftBodyHz`
   60, `destructorGpuSoftBody.js` `tick`, `:674`) — ta sama sesja. Wcześniej
   dispatch szedł na klatkę renderu i przy 144 FPS wgniecenia rosły szybciej.
   Lustro CPU dema idzie tym samym zegarem.
3. **Opóźnienie wyniku GPU gubi część wgnieceń.** `_applyResult` nakłada wynik
   klatkę po dispatchu, mieszając 0,35·bieżący + 0,65·wynik i nadpisując
   `__vel`, więc ~65% uderzeń z CPU z czasu „w locie” przepada (opis i liczby:
   `AGENT: TODO` nad `_applyResult`). Synchroniczne lustro wgniatało przez to
   głębiej i rdzeń wychodził w nim 25–75% tańszy niż na WebGPU; lustro z tym
   samym opóźnieniem mieści się w rozrzucie przebiegów (§ 7). Czy to stroić
   (np. nakładaniem przyrostów), to decyzja poza tym zadaniem.
4. **Ukryty global.** `_applyResult` solvera GPU niszczy rozerwane heksy tylko
   przez `window.DestructorSystem` (`destructorGpuSoftBody.js:654`); gra go
   ustawia (`index.html:816`), dema i testy muszą pamiętać — bez niego heks
   dostaje `hp = 0`, ale zostaje aktywny (blokuje sondy, nie jest dziurą).
5. **Rakiety 3D nie ruszają heksów.** `rocketSystem3D._onHit` (`:815`) i
   `_applyBlastDamage` (`:847`) wołają tylko `applyDamageToNPC/Player`:
   torpedy i rakiety zabijają pulą, ale nigdy nie zrobią dziury ani nie
   odsłonią rdzenia. Do rozważenia `DestructorSystem.applyImpact` w punkcie
   trafienia.
6. **`explodeRadius` pocisków 2D nieużywany.** Ustawiany w `fireWeaponCore`
   (`index.html:8732`, np. Armata 140), nigdzie nieczytany przy trafieniu.
7. **`HullShadowSdf.acquire` na pustym wraku** — wyjątek przy wraku z zerem
   aktywnych heksów (zgłoszone osobno; demo usuwa takie wraki).
8. **Heksy ≫ pula HP.** Suma HP heksów: Bellator 222 724, Iron Skull
   170 271, Atlas 841 346 (heks 80 HP) przy puli 12 000 — pula kończy każdą
   walkę, zanim kadłub straci 2–10% heksów (w macierzy najwięcej 226 z 2920
   u Bellatora). Komora w chwili śmierci z puli: w 96% przypadków nietknięta,
   nigdy poniżej 79% osłony — reguła „wyniszczenie przy KRYTYCZNYM =
   detonacja” w pojedynku więc nie zadziała. Działa w formacji: fala sąsiada
   spycha komorę do KRYTYCZNEGO, a AoE HP dobija pulę → brudny kill.

---

## 7. Benchmark

Metoda (`node dema/rdzen-bench-node.js`; wyniki `.tmp/rdzen/bench-*.json/md`,
tabele `node dema/rdzen-bench-tables.js`; wyniki sprzed poprawki heksów-duchów
w `*-przed-poprawka.*`): bieżący kod gry — prawdziwy `DestructorSystem` z
poprawką heksów-duchów, trafiony heks podawany do `applyImpact` jak w grze —
na prawdziwych maskach kadłubów, krok 1/120, integralność co 3. krok,
`updateVisuals` + lustro solvera co 2. krok (60 Hz, opóźnienie wyniku jak GPU); działo 2500 j. od rdzenia
(≤ 80% zasięgu), strzał co przeładowanie z rozrzutem broni i salwami luf,
lock = losowy punkt komory; tarcza zbita od startu; limit 300 s gry; oba
progi mierzone na tej samej serii strzałów (wyniszczenie = pula HP albo sufit
heksów, co pierwsze). Rdzeń = domyślny A każdego kadłuba (r 26–27 px siatki,
armorMul 3).

### Macierz: próg osłony komory (30%), lock = losowy punkt komory, lustro solvera CPU

| kadłub | broń | dziób | skos | burta | rufa | wyniszczenie (pula 12 000 HP) |
|---|---|---:|---:|---:|---:|---|
| Bellator | Vulcan Minigun | — | — | — | — (odsł. 3413) | 3000 tr. / 210 s |
| Bellator | Heavy Autocannon | — | — | — | — | 429 tr. / 215 s |
| Bellator | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Bellator | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Bellator | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Bellator | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Bellator | Valkyrie Railgun (Special) | — | — (odsł. 88) | **67** | **49** | 24 tr. / 69 s |
| Bellator | Bateria Główna Klasy YAMATO | **116** | **92** | **58** | **22** | 15 tr. / 20 s |
| Bellator | Laser Wiązkowy (Ciągły) | — | — | — | — | > 300 s — trafia ~35–40% spustów (heksy-duchy, § 6) |
| Bellator | Laser Wiązkowy (Puls) | — | — | **430** | **368** | 267 tr. / 173 s |
| Bellator | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 171 s |
| Bellator | Cruise Missile Rack | — | — | — | — | 12 tr. / 29 s |
| Iron Skull | Vulcan Minigun | — | — (odsł. 3835) | — | — (odsł. 3808) | 3000 tr. / 210 s |
| Iron Skull | Heavy Autocannon | — | — | — | — | 429 tr. / 215 s |
| Iron Skull | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Iron Skull | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Iron Skull | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Iron Skull | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Iron Skull | Valkyrie Railgun (Special) | — | **65** | **73** | **55** | 24 tr. / 69 s |
| Iron Skull | Bateria Główna Klasy YAMATO | **115** | **51** | **44** | **42** | 15 tr. / 20 s |
| Iron Skull | Laser Wiązkowy (Ciągły) | — | — | — | — | > 300 s — trafia ~35–40% spustów (heksy-duchy, § 6) |
| Iron Skull | Laser Wiązkowy (Puls) | — | — (odsł. 311) | — (odsł. 296) | — (odsł. 268) | 267 tr. / 173 s |
| Iron Skull | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 171 s |
| Iron Skull | Cruise Missile Rack | — | — | — | — | 12 tr. / 29 s |
| Atlas | Vulcan Minigun | — | — | — | — | 3000 tr. / 210 s |
| Atlas | Heavy Autocannon | — | — | — | — | 429 tr. / 214 s |
| Atlas | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Atlas | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Atlas | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Atlas | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Atlas | Valkyrie Railgun (Special) | — | — | — | — | 24 tr. / 69 s |
| Atlas | Bateria Główna Klasy YAMATO | — | **160** | **91** | **132** | 15 tr. / 20 s |
| Atlas | Laser Wiązkowy (Ciągły) | — | — (odsł. 67) | — | — | > 300 s — trafia ~35–40% spustów (heksy-duchy, § 6) |
| Atlas | Laser Wiązkowy (Puls) | — | — | — | — | 267 tr. / 173 s |
| Atlas | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 170 s |
| Atlas | Cruise Missile Rack | — | — | — | — | 12 tr. / 28 s |

Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.

### Rozrzut między przebiegami (6 niezależnych ziaren, lustro CPU)

Pojedynczy przebieg jest chaotyczny (odłamki, podziały, rozrzut celowania):
ten sam przypadek na 6 ziarnach daje ±25% wokół mediany. W macierzy „22” dla
Yamato w rufę Bellatora to szczęśliwy przebieg — mediana 39. Wnioski niżej
opieram na medianach.

| kadłub | broń | kierunek | STOPIENIE osiągnięte | trafień min / mediana / max | wszystkie |
|---|---|---|---:|---|---|
| Bellator | Valkyrie Railgun (Special) | burta | 6/6 | 63 / 71 / 74 | 71, 69, 72, 74, 74, 63 |
| Bellator | Valkyrie Railgun (Special) | rufa | 6/6 | 38 / 49 / 62 | 49, 38, 62, 51, 47, 57 |
| Bellator | Bateria Główna Klasy YAMATO | burta | 6/6 | 41 / 54 / 86 | 86, 51, 79, 60, 41, 54 |
| Bellator | Bateria Główna Klasy YAMATO | rufa | 6/6 | 35 / 39 / 46 | 42, 39, 35, 44, 46, 36 |
| Iron Skull | Valkyrie Railgun (Special) | burta | 6/6 | 65 / 67 / 77 | 77, 66, 73, 69, 65, 67 |
| Iron Skull | Valkyrie Railgun (Special) | rufa | 6/6 | 46 / 60 / 63 | 63, 46, 55, 60, 61, 61 |
| Iron Skull | Bateria Główna Klasy YAMATO | burta | 6/6 | 41 / 51 / 68 | 52, 51, 68, 41, 51, 59 |
| Iron Skull | Bateria Główna Klasy YAMATO | rufa | 6/6 | 34 / 45 / 59 | 34, 45, 45, 47, 48, 59 |

### Wariant: sonda punktu (dzisiejszy warunek gry: 5 punktów, 2 kontrole bez heksa)

| kadłub | broń | dziób | skos | burta | rufa | wyniszczenie (pula 12 000 HP) |
|---|---|---:|---:|---:|---:|---|
| Bellator | Valkyrie Railgun (Special) | — | — (odsł. 88) | **63** | **43** | 24 tr. / 69 s |
| Bellator | Bateria Główna Klasy YAMATO | **129** | **84** | **48** | **21** | 15 tr. / 20 s |
| Bellator | Laser Wiązkowy (Puls) | — | **232** | **330** | **327** | 267 tr. / 173 s |
| Iron Skull | Valkyrie Railgun (Special) | — | **64** | **70** | **54** | 24 tr. / 69 s |
| Iron Skull | Bateria Główna Klasy YAMATO | **117** | **45** | **54** | **33** | 15 tr. / 20 s |
| Iron Skull | Laser Wiązkowy (Puls) | — | **426** | **348** | **434** | 267 tr. / 173 s |
| Atlas | Valkyrie Railgun (Special) | — | — | — | — | 24 tr. / 69 s |
| Atlas | Bateria Główna Klasy YAMATO | — | **164** | **87** | **120** | 15 tr. / 20 s |
| Atlas | Laser Wiązkowy (Puls) | — | — | — | — | 267 tr. / 173 s |

Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.

### Wariant: poprawka heksów-duchów (sondy z zapasem na dryf)

| kadłub | broń | dziób | skos | burta | rufa | wyniszczenie (pula 12 000 HP) |
|---|---|---:|---:|---:|---:|---|
| Bellator | Valkyrie Railgun (Special) | — | — (odsł. 88) | **67** | **49** | 24 tr. / 69 s |
| Bellator | Bateria Główna Klasy YAMATO | **122** | **72** | **56** | **22** | 15 tr. / 20 s |
| Bellator | Laser Wiązkowy (Puls) | — | — | **441** | **377** | 267 tr. / 173 s |
| Bellator | Laser Wiązkowy (Ciągły) | **4233** | **3123** | **2159** | **1877** | 1500 tr. / 75 s |
| Iron Skull | Valkyrie Railgun (Special) | — | **69** | **73** | **55** | 24 tr. / 69 s |
| Iron Skull | Bateria Główna Klasy YAMATO | **109** | **53** | **51** | **43** | 15 tr. / 20 s |
| Iron Skull | Laser Wiązkowy (Puls) | — | — (odsł. 346) | — (odsł. 348) | — (odsł. 270) | 267 tr. / 190 s |
| Iron Skull | Laser Wiązkowy (Ciągły) | — (odsł. 2407) | **2077** | **2637** | **2285** | 1500 tr. / 112 s |
| Atlas | Valkyrie Railgun (Special) | — | — | — (odsł. 100) | — | 24 tr. / 69 s |
| Atlas | Bateria Główna Klasy YAMATO | — | **107** | **85** | **143** | 15 tr. / 20 s |
| Atlas | Laser Wiązkowy (Puls) | — | — | — | — | 267 tr. / 173 s |
| Atlas | Laser Wiązkowy (Ciągły) | — | **2897** | **3141** | **4435** | 1500 tr. / 75 s |

Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.

### Czułość na r i armorMul (ogień z burty)

| kadłub | broń | r (px siatki) | ×1 | ×2 | ×3 | ×4 |
|---|---|---:|---:|---:|---:|---:|
| Bellator | Valkyrie Railgun (Special) | 18 (14 heksów) | **52** | **52** | **50** | **50** |
| Bellator | Valkyrie Railgun (Special) | 26 (32 heksów) | **69** | **69** | **69** | **69** |
| Bellator | Valkyrie Railgun (Special) | 36 (62 heksów) | **90** | **86** | **80** | **90** |
| Bellator | Bateria Główna Klasy YAMATO | 18 (14 heksów) | **88** | — (odsł. 146) | — (odsł. 146) | — (odsł. 146) |
| Bellator | Bateria Główna Klasy YAMATO | 26 (32 heksów) | **66** | **66** | **66** | **66** |
| Bellator | Bateria Główna Klasy YAMATO | 36 (62 heksów) | **75** | **78** | **75** | **66** |
| Bellator | Laser Wiązkowy (Puls) | 18 (14 heksów) | **258** | **285** | **303** | **328** |
| Bellator | Laser Wiązkowy (Puls) | 26 (32 heksów) | **337** | **396** | **431** | — (odsł. 299) |
| Bellator | Laser Wiązkowy (Puls) | 36 (62 heksów) | **456** | — (odsł. 341) | — (odsł. 351) | — (odsł. 360) |
| Iron Skull | Valkyrie Railgun (Special) | 18 (16 heksów) | **47** | **48** | **48** | **48** |
| Iron Skull | Valkyrie Railgun (Special) | 26 (34 heksów) | **61** | **61** | **61** | **61** |
| Iron Skull | Valkyrie Railgun (Special) | 36 (63 heksów) | **72** | **72** | **75** | **73** |
| Iron Skull | Bateria Główna Klasy YAMATO | 18 (16 heksów) | **36** | **36** | **43** | **36** |
| Iron Skull | Bateria Główna Klasy YAMATO | 26 (34 heksów) | — (odsł. 59) | — (odsł. 59) | — | — |
| Iron Skull | Bateria Główna Klasy YAMATO | 36 (63 heksów) | **63** | **63** | **64** | **65** |
| Iron Skull | Laser Wiązkowy (Puls) | 18 (16 heksów) | **340** | **367** | **387** | **410** |
| Iron Skull | Laser Wiązkowy (Puls) | 26 (34 heksów) | **361** | **410** | — (odsł. 296) | — (odsł. 298) |
| Iron Skull | Laser Wiązkowy (Puls) | 36 (63 heksów) | — (odsł. 366) | — (odsł. 372) | — (odsł. 383) | — (odsł. 390) |
| Atlas | Valkyrie Railgun (Special) | 18 (17 heksów) | **93** | **93** | **93** | **93** |
| Atlas | Valkyrie Railgun (Special) | 26 (34 heksów) | — (odsł. 100) | — (odsł. 100) | — (odsł. 100) | — (odsł. 100) |
| Atlas | Valkyrie Railgun (Special) | 36 (61 heksów) | — | — | — | — |
| Atlas | Bateria Główna Klasy YAMATO | 18 (17 heksów) | **93** | **83** | **95** | **75** |
| Atlas | Bateria Główna Klasy YAMATO | 26 (34 heksów) | **131** | **86** | **102** | **97** |
| Atlas | Bateria Główna Klasy YAMATO | 36 (61 heksów) | **133** | **129** | **129** | **123** |
| Atlas | Laser Wiązkowy (Puls) | 18 (17 heksów) | **444** | — (odsł. 421) | — (odsł. 425) | — (odsł. 428) |
| Atlas | Laser Wiązkowy (Puls) | 26 (34 heksów) | — | — | — | — |
| Atlas | Laser Wiązkowy (Puls) | 36 (61 heksów) | — | — | — | — |

Komórka = trafień do STOPIENIA; pula HP (wyniszczenie) jak w macierzy: Valkyrie 24, Yamato 15, laser pulsacyjny 267.

### Kalibracja lustra CPU na WebGPU

Node nie ma WebGPU, więc benchmark rwie heksy lustrem kernela
(`rdzen-softbody-cpu.js`) — z tym samym zegarem w czasie gry i tym samym
opóźnieniem wyniku co GPU (nałożenie na początku następnego ticku, mieszanie
0,35 / 0,65, nadpisanie `__vel`). Sprawdzenie na prawdziwym solverze
(`node dema/rdzen-gpu-check.js`, bieżący kod gry, zegar ręczny, Bellator,
lock na rdzeń, ogień z burty):

| pomiar | lustro CPU | WebGPU |
|---|---:|---:|
| Valkyrie: trafień do ODSŁ. / KRYT. / STOP. | 54 / 67 / 69 | 59 / 70 / 76 (czekając na odczyt po każdej klatce: 54 / 65 / 73) |
| Yamato: jw. | 45 / 57 / 57 | 45 / 48 / 63 (czekając: 51 / 72 / 75) |
| 20 s, laser ciągły: trafień z ~400 spustów | 362 | 361 (przy 60 i przy 144 FPS) |
| 20 s, ciężkie działko: trafienia / stracone heksy | 40 / 12 | 40 / 11–13 |
| kroków solvera na sekundę gry | 29–30 | 29–30 |

Różnice mieszczą się w rozrzucie pojedynczego przebiegu (±25%). Przed obiema
poprawkami (stary kod gry + synchroniczne lustro) było 65 vs 81 (Valkyrie) i
57 vs 99 (Yamato): synchroniczne lustro nie gubiło wgnieceń tak jak GPU
(§ 6 pkt 3) i zaniżało koszt rdzenia.

### Wnioski

1. **Pula HP decyduje o wszystkim.** Najtańszy rdzeń: Yamato w rufę —
   mediana 39 trafień na Bellatorze i 45 na Iron Skullu (WebGPU: ×1,5–1,75)
   wobec 15 do zbicia puli. Valkyrie: mediana 49–71 wobec 24. Laser
   pulsacyjny: 368–430 wobec 267.
2. **Drobne bronie nie dokopią się nigdy.** Działka, Tempest, Helios, rail
   Mk II, Armata, torpedy i rakiety (3D, bez heksów) — komora nietknięta w
   300 s na każdym kadłubie z każdego kierunku. Wyjątek: Vulcan odsłonił
   komorę Bellatora i Iron Skulla po ~3400–3800 trafieniach, długo po zbiciu
   puli (3000). Pancerz komory ma więc znaczenie tylko wobec ognia przez
   gotową wyrwę.
3. **Kierunek ma znaczenie.** Rufa i burta są 1,5–3× tańsze niż dziób
   (Bellator, Yamato: rufa ~39 / burta ~54 / skos 92 / dziób 116) — rdzeń
   rufowy ma sens taktyczny: „zajdź go od rufy”.
4. **Atlas jest praktycznie nietykalny od strony rdzenia** (275 px pancerza):
   tylko Yamato w 91–160 trafień, Valkyrie ani razu w 300 s.
5. **Próg osłony vs sonda punktu:** koszt podobny — różnice od −21% do +23%
   na przypadek, średnio sonda nieco taniej (wystarczy tunel przez środek), a
   laserem pulsacyjnym sonda kończy tam, gdzie próg osłony nie dochodzi (Iron
   Skull). Próg osłony jest odporny na „przestrzał jednego heksa” i działa z
   falą łańcucha (osłabione heksy liczą się, zanim zginą) — dlatego zalecany.
6. **armorMul nie gra roli dla ciężkich broni** (Valkyrie zadaje 450
   bezpośrednio, Yamato 765, heks komory ×4 ma 320) — koszt wyznacza grubość
   kadłuba nad komorą. Dla lasera pulsacyjnego (40 bezpośrednio) każdy stopień
   pancerza to +10–30% trafień. Mniejsza komora jest tańsza (Bellator,
   Valkyrie: r 18 → 50–52, r 26 → 69, r 36 → 80–90), bo próg 30% osłony
   wymaga krateru na ~70% komory, a railgun kopie wąski kanał.
7. **Poprawka heksów-duchów** nie zmienia kosztu dla ciężkich broni (±10%),
   ale laser ciągły zaczyna działać: pula w 75 s (1500 trafień), rdzeń po
   1900–4400 trafieniach.

---

## 8. Koszt detonacji (render)

Headless Chrome, RTX 5080, 1600×900, prawdziwy Core3D + overlay (`reactorblow.js`),
n Bellatorów detonowanych jednocześnie, 4 s po wybuchu (`node dema/rdzen-shots.js --only perf`):

| detonacji naraz | klatka śr. przed → w trakcie (ms) | p95 | max (ms) | z tego JS max | overlay max | draw calle śr. / max | trójkąty max |
|---:|---|---:|---:|---:|---:|---|---:|
| 1 | 0.65 → 0.74 | 1.15 | 119 | 118 | 89 | 24 / 32 | 36 574 |
| 3 | 0.8 → 1.12 | 1.8 | 100 | 99 | 19 | 42 / 72 | 152 218 |
| 6 | 0.77 → 1.77 | 2.64 | 59 | 55 | 19 | 56 / 111 | 285 870 |

Rozpad kadłuba (plan + 5 wraków `spawnWreckEntity`, node): Bellator 5,5 ms,
Iron Skull 3,3 ms, Atlas 14 ms — to większość szczytu JS przy kilku
detonacjach naraz. Przy integracji rozłożyć rozpady na kolejne klatki (1–2 na
klatkę; błysk `reactorblow` przykrywa opóźnienie o kilka klatek).

Szczyty w pierwszych klatkach to kompilacja/rozgrzewka efektu (overlay) — dotyczy
`reactorblow.js` tak samo jak dziś. Sam żar i wyrzuty rdzeni: 2 draw calle łącznie.

---

## 9. Wygląd i pasma HDR

- Żar jest **pod** kadłubem (z −3, test głębi, bez zapisu głębi) — widać go
  wyłącznie przez martwe heksy; nietknięty kadłub nie świeci wcale. Bez
  poświaty sylwetki (czytałaby się jak tarcza).
- **Warstwa 7 (pass tarcz), nie 0.** `shadowShaftsPass` mnoży scenę po passie
  ortho — na warstwie 0 cień własnego kadłuba przygaszał żar w wyrwie o
  połowę (biały rdzeń 4,5 zamiast 9 na Bellatorze i Iron Skullu). Pass tarcz
  jest ortho, idzie po cieniach i nie czyści głębi, więc maskowanie wyrwą
  działa bez zmian — ten sam powód, dla którego tarcze mają ten pass.
- Pasma (`CORE_FX_BANDS`): ciało żaru 0,62 / 0,72 / 0,84 (ODSŁ. / KRYT. /
  STOP.) — pod progiem 0,9; biały rdzeń 9 / 10 / 11,5 (× puls 0,92–1) z ostrą
  krawędzią (`coreEdge` 0,82). Wyrzuty: ciało 0,32 (2–3 nałożone zostają pod
  progiem), biała głowica 9 z ostrą krawędzią i tylko przez pierwsze 16%
  życia cząstki — gasnąc płynnie przechodziłaby przez 2–8, które bloom
  (bramkujący, memory hdr-band-plan) bierze w całości.
- Kolory frakcji: Terra Nova błękit (0,22, 0,72, 1,0), piraci czerwień
  (1,0, 0,16, 0,34), gracz fiolet (0,62, 0,42, 1,0).
- Współpraca z `_heatWoundRim`: żywi sąsiedzi martwych heksów komory dostają
  żar (`addShardHeat`) 0,3 / 0,38 / 0,42→0,8 — brzeg wyrwy żarzy się
  pomarańczowo, w ostatnich 25% stopienia do białego.
- Komora osłabiona **bez wyrwy** (fala z sąsiedniego wybuchu → KRYTYCZNY albo
  STOPIENIE przy 0 martwych heksów): grzeje się sama płyta nad komorą (żar
  0,27 / 0,42→0,8) — inaczej statek w stopieniu nie zdradzałby niczego do
  chwili wybuchu (zrzut `22-lancuch-plyta-nad-komora.png`). Plama wielkości
  komory, nie sylwetka.

Pomiar: bloom wyłączony, odczyt `postTarget` (HalfFloat, przed ACES) w oknie
wokół rdzenia, komora otwierana deterministycznie od środka (`rdzen-shots.js`
scenariusz `bands`; kanał kopany bronią wypada za każdym razem inaczej, więc
do porównań pasm się nie nadaje). Overlay `reactorblow` to osobny renderer —
nie wchodzi do pomiaru.

| kadłub | stan | max L | px > 0,9 | px 1,3–8 („zakazane”) | px 8–12 (biel) | px > 12 |
|---|---|---:|---:|---:|---:|---:|
| Bellator | ODSŁONIĘTY | 9.1 | 88 | 20 | 68 | 0 |
| Bellator | KRYTYCZNY | 9.5 | 250 | 24 | 88 | 0 |
| Bellator | STOPIENIE 50% | 10.4 | 2063 | 158 | 623 | 0 |
| Bellator | STOPIENIE 90% | 11.7 | 7364 | 1216 | 2191 | 0 |
| Bellator | STOPIENIE 90%, bez wyrzutów | 11.4 | 4060 | 163 | 812 | 0 |
| Bellator | STOPIENIE 90%, bez żaru | 10.2 | 5668 | 865 | 1365 | 0 |
| Iron Skull | ODSŁONIĘTY | 8.5 | 68 | 16 | 52 | 0 |
| Iron Skull | KRYTYCZNY | 9.5 | 112 | 24 | 88 | 0 |
| Iron Skull | STOPIENIE 50% | 10.1 | 1405 | 264 | 1075 | 0 |
| Iron Skull | STOPIENIE 90% | 19.7 | 3494 | 491 | 2199 | 209 |
| Iron Skull | STOPIENIE 90%, bez wyrzutów | 10.7 | 813 | 140 | 648 | 0 |
| Iron Skull | STOPIENIE 90%, bez żaru | 17.8 | 2729 | 413 | 1696 | 104 |
| Atlas | ODSŁONIĘTY | 8.7 | 80 | 20 | 60 | 0 |
| Atlas | KRYTYCZNY | 9.3 | 112 | 24 | 88 | 0 |
| Atlas | STOPIENIE 50% | 10.0 | 1530 | 303 | 1202 | 0 |
| Atlas | STOPIENIE 90% | 19.9 | 8427 | 1514 | 2587 | 180 |
| Atlas | STOPIENIE 90%, bez wyrzutów | 10.8 | 6388 | 134 | 716 | 0 |
| Atlas | STOPIENIE 90%, bez żaru | 12.9 | 7379 | 970 | 2117 | 3 |

- ODSŁONIĘTY / KRYTYCZNY: biel wyłącznie w paśmie 8–12 (52–88 px), w
  „zakazanym” paśmie 1,3–8 kilkanaście pikseli (antyaliasing krawędzi).
- STOPIENIE: biel rośnie (rdzeń + głowice wyrzutów). Pasmo 1,3–8: 160–300 px
  w połowie odliczania, 500–1500 px w ostatnich 10% (przed przeróbką wyrzutów
  ~5000); 0,9–1,3 to ciała wyrzutów i rozgrzany brzeg rany (pasmo barwy).
  W ostatnich 10% nakładające się głowice dają do ~20 na ≤ 200 px — łuk
  napięcia tuż przed błyskiem. Między przebiegami liczby w stopieniu wahają
  się o kilkadziesiąt procent (losowe wyrzuty i faza pulsu).
- Nietknięty kadłub: max 0,75, zero pikseli > 0,9 (`05-nominalny-zblizenie.png`).

---

## 10. Rekomendacje na klasę

| klasa | r (px siatki) | armorMul | kill | odliczanie | profil | uzasadnienie |
|---|---:|---:|---|---:|---|---|
| escort | 12 | 2 | osłona ≤ 30% | 1,5 s | escort | mała komora (~7 heksów), szybki koniec |
| cruiser | 18 | 2,5 | osłona ≤ 30% | 2,5 s | cruiser | |
| capital | 26 (Bellator 48, Iron Skull 42, Atlas 56 px PNG) | 3 | osłona ≤ 30% | 3,5 s | capital | ~32–36 heksów; 3,5 s = czas na reakcję (odepchnięcie, odlot), a łańcuch w formacji wciąż działa |

Miejsca: A każdego kadłuba (§ 3). `armorMul` 3 zostawiam jako ochronę przed
„snajpieniem” odsłoniętej komory lekką bronią — dla ciężkich nie ma znaczenia.

---

## 11. Otwarte kwestie (do decyzji)

1. **Pula HP.** Bez zmiany rdzeń nigdy nie wygrywa z wyniszczeniem. Opcje:
   (a) zostawić — rdzeń jako rzadki bonus specjali i łańcuchów;
   (b) pula HP kadłubów heksowych ×3–4 (36 000–48 000) — wtedy Valkyrie od
   rufy/burty (mediana 49–71 tr. w lustrze, ~60–90 na WebGPU = 30–45 tys.
   obrażeń) i Yamato od rufy (39 tr. ≈ 33 tys.; WebGPU ~60 ≈ 51 tys.) wyprzedzają
   pulę;
   (c) odciąć pulę od trafień w heksy (pula = tylko sufit z heksów) — kill
   tylko przez rdzeń / strukturę; największa zmiana balansu.
2. **Warunek killa:** próg osłony (zalecany) czy dzisiejsza sonda punktu?
3. **Gracz a odcięcie rdzenia:** utrata reaktora = koniec gry, czy „dryfujący
   kadłub” z ewakuacją?
4. **AoE detonacji gracza na sojuszników** (dziś wybuch gracza nie ma AoE).
5. **Rakiety 3D i kratery** (§ 6 pkt 4) — czy torpeda ma robić dziurę?
6. **Poprawka heksów-duchów** (już w drzewie roboczym) zmienia DPS wszystkich
   wiązek (laser ciągły ~2,5× więcej trafień) — balans broni do przejrzenia
   razem z nią.
7. **Hulk po utracie mostka z rdzeniem KRYTYCZNYM:** detonacja (zalecam —
   spójne z regułą wyniszczenia) czy czysty wrak jak dziś?
8. **Gubienie wgnieceń przez `_applyResult`** (§ 6 pkt 3): stroić czy
   zostawić? Zmienia koszt rdzenia na GPU (w pomiarach 5–30% trafień).
