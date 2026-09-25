# PORT: rdzeń statku (reaktor) — z dema do gry

Stan na 2026-09-25 (numery linii `index.html` z bieżącego stanu drzewa — plik zmienia się
równolegle, szukaj po nazwie funkcji). Demo: `npm run dev` → `/dema/rdzen-demo.html`
(`?scene=battleship|pirate_battleship|atlas|trio|formation`, `?weapon=<id>`).
Logika, efekt i modele reaktora (§ 13) są gotowe do wpięcia bez przepisywania;
ten dokument mówi, co i gdzie w grze trzeba zmienić. Pliki gry ruszone w tej
fazie tylko na polecenie: zdjęcie fali z refrakcją (§ 12) — reszta czeka na
integrację.

---

## 0. W skrócie

- **Model.** Rdzeń = punkt `cores[]` w przestrzeni PNG + promień komory `r`,
  `armorMul`, profil wybuchu. Komora = heksy w promieniu `r` od punktu
  (znacznik `shard.__coreId` nadawany raz, z pozycji startowej), z pancerzem
  `maxHp × armorMul`. Kilka rdzeni na kadłub wolno — każdy zabija.
- **Miejsce (§ 3).** Reaktor stoi przy środku masy, poza strefami mostków we
  wszystkich wariantach. Dawne miejsca na rufie leżały w mostkach.
- **Stany.** NOMINALNY → ODSŁONIĘTY (pierwszy martwy heks komory) →
  KRYTYCZNY (osłona < 60%) → STOPIENIE (osłona ≤ 30%, odliczanie 1,5 / 2,5 /
  3,5 s wg klasy) → DETONACJA **zawsze**, bez losowania.
- **Osłona** = suma HP żywych heksów komory ÷ suma pancerza komory (ważona HP,
  więc osłabiona fala też się liczy). Drugi, przełączalny warunek: dzisiejsza
  sonda punktu (5 punktów, 2 kontrole bez heksa).
- **Najważniejszy wynik benchmarku:** przy dzisiejszej puli HP (12 000, każde
  trafienie zdejmuje pełne obrażenia) rdzeń zabija pierwszy **tylko 2 razy na
  144** — oba razy laserem ciągłym, który po poprawce heksów-duchów wierci
  tunel (w trybie sondy punktu: 6 z 8 na Bellatorze i Iron Skullu). Ciężkie
  działa dochodzą do komory 2–5× później niż pula pada, drobne — nigdy.
  Mechanika ożyje dopiero po decyzji o puli HP (§ 11, pyt. 1).
- **Znaleziska po drodze:** heksy-duchy (naprawione równolegle w drzewie:
  laser ciągły trafia teraz 361 zamiast 142 z ~400 spustów), opóźnienie wyniku
  solvera GPU gubi ~65% wgnieceń z czasu „w locie”, ukryta zależność solvera od
  `window.DestructorSystem`, rakiety 3D nie ruszają heksów, 4 uśpione błędy
  integracji rdzeni (§ 5).
- **Warianty detonacji (§ 12).** Wybuch nie jest już jeden: rozprysk (jak
  dziś), przełamanie na pół, rozerwanie na trzy, wyrwa bez rozpadu, wyrzut
  strumienia plazmy w losową stronę (rani, co spotka; odrzut obraca wrak) i
  kula plazmy, która wypada w losową stronę i topi wszystko na drodze.
  Losowane z wag klasy na starcie stopienia, do tego wybuchy wtórne w
  szczątkach. Iskry z pul gry (Hexlance, błyski wylotowe, trafienia), bez fali
  z refrakcją — tę zdjąłem już w grze ze wszystkiego poza rakietami supernova
  (wybuchy reaktorów, rozpad stacji, Yamato).
- **Modele reaktora (§ 13).** Przez wyrwę widać sam reaktor zamiast plamy
  żaru: tokamak Terra Nova, prowizorka piratów i podwójny pierścień Atlasa.
  Plazma krąży w torusie, w stopieniu pękają i żarzą się cewki, a po wyrzucie
  albo kuli zostaje wypalony wrak reaktora. 2 draw calle na rodzaj, warstwa 7,
  precyzja float32 z początkiem przy kamerze.

---

## 1. Pliki

| plik | rola | zależności |
|---|---|---|
| `src/game/shipCore.js` | cała logika: znakowanie komory, pancerz, stany, odcięcie, łańcuch, wybuch (AoE / fala / kratery), rozpad, lock, eksport | tylko `destructor.js`; bez DOM i three |
| `src/3d/coreFx3D.js` | żar w wyrwie (InstancedMesh pod kadłubem, maskowany głębią), wyrzuty plazmy, podgrzewanie brzegu rany; po detonacji strumień, kula, pierścień i rozbłysk plazmy oraz recepty iskier na pulach gry (§ 12) | `three`, `Core3D.scene` podana z zewnątrz; iskry z banku `Fx3D` (`fxParticles3D.js`), `RailgunFX3D`, `MuzzleFX3D` i (opcjonalnie) `SparkSystem3D`; bez własnego renderera |
| `src/3d/coreBands.js` | pasma HDR i puls stanu (`CORE_FX_BANDS`, `coreStateBand`), numer warstwy 7 — wspólne dla żaru i modelu reaktora | `shipCore.js` (stany); bez three i DOM |
| `src/3d/reactor3DShapes.js` | geometria modeli reaktora (§ 13): tokamak, prowizorka piratów, podwójny pierścień Atlasa | `three` (BufferGeometry); bez sceny i DOM |
| `src/3d/reactor3D.js` | modele w scenie Core3D: instancje pod kadłubem na warstwie 7, stany z runtime rdzeni, wrak reaktora po wyrzucie i kuli | `three`, `Core3D.scene` podana z zewnątrz, `shipCore.js`, `coreBands.js`; bez własnego renderera |
| `tests/shipCore.test.mjs` | 29 testów na prawdziwym destruktorze (27 zielonych + 2 `todo` = poprawki 1 i 3 do odblokowania przy integracji), w tym 9 na warianty detonacji | `tests/helpers/destructorHull.mjs` |
| `tests/reactor3D.test.mjs` | 14 testów: kształty (granice, cewki, przykrycie plazmy, determinizm) i runtime na prawdziwym destruktorze (stany, rodzaje, prześwietlenie, precyzja przy 8 mln j., wrak reaktora, przejście na wrak ze `spawnWreckEntity`, zimny wrak i pula, reset, dispose) | `three` w node, `tests/helpers/destructorHull.mjs` |
| `dema/rdzen-demo.html`, `dema/rdzen-demo.js` | demo: prawdziwy Core3D, hexShips3D, overlay + `reactorblow.js`, krok 120 Hz | — |
| `dema/rdzen-combat.js` | replika ścieżki trafień z `bulletsAndCollisionsStep` / `fireWeaponCore` (te same obrażenia, penetracja, tarcza, sufit heksów) | — |
| `dema/rdzen-scene.js`, `rdzen-hulls-data.js` | kadłuby, kandydaci rdzeni, sceny | — |
| `dema/rdzen-overlay2d.js` | nakładki: siatka, mostki (strefy wszystkich wariantów), komora, sonda, stan, AoE, duchy błędów 1–2 | `src/game/shipBridge.js` (tylko odczyt propozycji) |
| `dema/rdzen-bench*.js` | benchmark deterministyczny (node i przycisk w demie), tabele | — |
| `dema/rdzen-softbody-cpu.js` | lustro 1:1 kernela WGSL solvera sprężyn (node nie ma WebGPU) | — |
| `dema/rdzen-analyze.js` | mapa głębokości (EDT maski), odstępy od hardpointów, dysz i mostków, środek masy, miejsca przy nim (§ 3); `--probe kadłub:x,y,r` | `src/game/shipBridge.js` (tylko odczyt) |
| `dema/rdzen-shots.js`, `rdzen-gpu-check.js`, `rdzen-cdp.js` | zrzuty, histogram HDR, koszt detonacji, walidacja lustra na WebGPU | headless Chrome (CDP) |

API `shipCore.js` (najważniejsze):

```js
attachShipCores(entity, markers, { pngWidth, pngHeight, classId?, killMode?, config?, color? }) // po initHexBody
updateShipCores(entity, dt, { time, entities, events })      // co krok integralności (gra: 0,08 s)
notifyCoreHostKilled(entity, time, reason, events)           // śmierć z puli HP → wymuszona detonacja od KRYTYCZNEGO
computeCoreBlast(core)            // profil wybuchu: AoE, fala na komory, kratery, rozmiar wizualny
applyBlastCoreShock(blast, x, y, entities, source)           // napęd łańcucha
planCoreBreakup / applyCoreDetonation                        // krater wokół RDZENIA + rozpad wg wariantu (§ 12)
getCoreLockPoint(entity)          // punkt locka (najgorszy stan, najniższa osłona)
exportCoreMarkers(markers)        // JSON w przestrzeni PNG (edytor)
```

Zdarzenia (`events[]`): `state` (from/to/cause), `severed`, `reactorLost`,
`detonate` (`{ core, host, x, y, variant, blast }`); z kul plazmy
(`stepPlasmaOrbs`) — `orbDetonate`.

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

**Reguła (2026-09-25): reaktor przy środku masy, poza mostkami.** Dawne
miejsca („najgłębiej”, na rufie) leżały w strefach mostków, które druga sesja
kładzie na rufowych nadbudówkach (`BRIDGE_LAYOUT_PROPOSALS` w
`src/game/shipBridge.js`, `docs/PORT-mostki.md`). Warunki miejsca:
- komora (koło r) odsunięta od **każdej** strefy mostka **każdego** wariantu o
  ≥ `bridgeZoneMargin` klasy kadłuba (14 px renderu = 26 / 34 / 29 px PNG na
  Bellatorze / Iron Skullu / Atlasie). Heks należy albo do komory, albo do
  mostka;
- głębokość ≥ 2r (komora cała w kadłubie, z blachą dookoła);
- hardpointy i dysze ≥ r + 14 px renderu (sonda hardpointu poza komorą);
- z miejsc, które to spełniają — najbliżej środka masy.

Skrypt: `node dema/rdzen-analyze.js`. Rysuje mapy `.tmp/rdzen/placement-*.png`
(strefy mostków magenta, miejsca przy środku masy cyjan) i zapisuje liczby w
`placement.json`. `--probe kadłub:x,y,r` ocenia wskazany punkt.

Oznaczenia w tabeli:
- głębokość: odległość od krawędzi maski alfa w px siatki renderu (EDT);
- „hp” / „dysza”: odstęp od najbliższego hardpointu / dyszy z
  `hardpointEditorDefaults.js` [px siatki];
- „śr. masy”: odległość od środka masy maski [px siatki];
- „mostek”: odstęp brzegu komory od najbliższej strefy mostka [px PNG].

Środki masy (px PNG): Bellator (−28, 1), Iron Skull (−88, 0), Atlas (−221, −4).

| kadłub | kandydat | PNG (x, y), r | głęb. | hp | dysza | śr. masy | mostek (min) | ocena |
|---|---|---|---:|---:|---:|---:|---:|---|
| Bellator | **A: środek masy** | (−32, 0), 48 | 81 | 73 | 274 | 2 | 84 (26) | **zalecany** |
| Bellator | B: przed środkiem masy | (40, 0), 48 | 73 | 55 | 310 | 37 | 156 | zapas |
| Iron Skull | **A: przy środku masy** | (−60, 0), 62,6 | 107 | 64 | 296 | 12 | 63 (34) | **zalecany** — tuż przed mostkiem |
| Iron Skull | B: śródokręcie | (10, 0), 62,6 | 101 | 72 | 325 | 41 | 133 | największy zapas ze wszystkich warunków |
| Atlas | **A: pod grzbietem** | (−275, 94), 56 | 158 | 53 | 556 | 54 | 56 (29) | **zalecany** — poza wszystkimi wariantami mostka |
| Atlas | B: nad grzbietem | (−275, −110), 56 | 154 | 54 | 553 | 57 | 56 | lustro A |
| Atlas | C: grzbiet w środku masy | (−221, 0), 56 | 209 | 48 | 595 | 2 | **−15** | tylko jeśli wariant mostka „śródokręcie” odpadnie |

Atlas nie ma miejsca na samym grzbiecie przy środku masy. Od rufy stoi tam
hardpoint `special_missile` (~(−330, 0)), od dziobu strefa wariantu
„śródokręcie” (x −180…340). Stąd A obok grzbietu.

Odrzucone (w strefach mostków domyślnego wariantu):
- Bellator: dawne A (−320, 0) i B (−219, −5);
- Iron Skull: dawne A (−306, 0) i B (−119, 0) — B dotykał mostka;
- Atlas: dawne A (−830, 0) (mostek rufowy) i B (70, 0) (wariant „śródokręcie”).

Nowe miejsca są płytsze niż dawne „najgłębiej” (Bellator 81 zamiast 116 px
siatki), więc liczby benchmarku (§ 7) trzeba powtórzyć.

Strażnicy:
- `tests/shipCore.test.mjs` („rdzenie dema: komora poza strefami mostków we
  wszystkich wariantach”) liczy odstęp komory od każdej strefy na żywych
  `BRIDGE_LAYOUT_PROPOSALS` — przesunięty mostek na reaktor go wywróci;
- test mostków (`proposed zones clear … core of the editor defaults`)
  sprawdzi te same rdzenie, gdy trafią do `hardpointEditorDefaults.js` — ale
  tylko punkt rdzenia z marginesem sondy, bez r.

Mostki dostaje też 7 kolejnych kadłubów: Custos, Hasta, Citadella, Colossus,
fregata i niszczyciel piratów, lokomotywa megafrachtowca. Ich reaktory
wyznaczyć tą samą regułą — dopisać kadłub do `dema/rdzen-hulls-data.js` i
puścić `rdzen-analyze.js`.

Dziś w danych **nie ma żadnego rdzenia**: `cores: []` dla `battleship`,
`pirate_battleship` (`hardpointEditorDefaults.js`) i Atlasa
(`atlasHardpointDefaults.js`). Rdzenie istnieją tylko z edytora (`hpEditor.v1`).

Wpis do domyślnych (eksport z edytora dema, przestrzeń PNG):

```json
{
  "atlas":             { "cores": [{ "id": "atlas_A",    "x": -275, "y": 94, "r": 56,    "armorMul": 3, "profile": "capital" }] },
  "battleship":        { "cores": [{ "id": "bellator_A", "x": -32,  "y": 0,  "r": 48,    "armorMul": 3, "profile": "capital" }] },
  "pirate_battleship": { "cores": [{ "id": "skull_A",    "x": -60,  "y": 0,  "r": 62.64, "armorMul": 3, "profile": "capital" }] }
}
```

(`r` 56 / 48 / 62,64 px PNG = 26–27 px siatki = komora 35 / 34 / 32 heksy;
Iron Skull na nowym sprite'cie 1727 × 911.)

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
   Model reaktora (`reactor3D`, § 13) tworzy się przed `coreFx3D` i
   synchronizuje tuż przed nim — ta sama warstwa, ta sama uwaga o kolejności.
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
   walkę, zanim kadłub straci 2–10% heksów (w macierzy najwięcej 256 z 2920
   u Bellatora). Komora w chwili śmierci z puli: w 90% przypadków nietknięta;
   reguła „wyniszczenie przy KRYTYCZNYM = detonacja” zadziałała w pojedynku
   tylko 2 razy (laser ciągły, osłona 0,43–0,50). Działa za to w formacji:
   fala sąsiada spycha komorę do KRYTYCZNEGO, a AoE HP dobija pulę → brudny kill.
9. **Alfa wyjścia Core3D nie jest poprawnym premultiplied.**
   - Kanwa WebGL ma `premultipliedAlpha: true` (`core3d.js:646`), a uber
     pass wypuszcza `ACES(rgb)` z alfą sceny.
   - Poświata bloomu w pustej przestrzeni ma alfę = max(rgb) liniowo (blend
     bloomu w three), więc po ACES i sRGB wychodzi rgb > a.
   - Chrome pokazuje taki piksel ~2× jaśniej niż wynik ACES: zmierzone HDR
     0,07 → po ACES i sRGB 77/255, na ekranie 167. Pod kadłubem (a = 1) obraz
     jest dokładnie według ACES.
   - Skutek dla efektów: addytywny quad, który zapisuje a = 1 na całej
     powierzchni, wycina w poświacie ciemniejszą plamę w kształcie quada.
     Tak znalazłem ciemne koło wokół kadłuba przy wyrzucie. `coreFx3D` pisze
     teraz alfę = max(rgb) z blendem ONE/ONE, jak bloom.
   - Innych modułów pod tym kątem nie przeglądałem — każdy efekt z alfą 1 na
     quadzie ma ten problem w skali swojego sprite'a.
   - Naprawa w potoku (`a = max(a, max(rgb_out))` w uber passie) zmieniłaby
     wygląd całej gry (poświaty ciemnieją ~2×) — do decyzji (§ 11, pyt. 10).

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

> **Uwaga (2026-09-25):** liczby niżej są dla DAWNYCH miejsc rdzeni (rufa,
> „najgłębiej”: Bellator (−320, 0), Iron Skull (−205, 0) na starym
> sprite'cie, Atlas (−830, 0)). Te miejsca leżały w strefach mostków, więc
> rdzenie przeszły przy środek masy (§ 3). Tam są płytsze — benchmark do
> powtórzenia.

### Macierz: próg osłony komory (30%), lock = losowy punkt komory, bieżący kod gry

| kadłub | broń | dziób | skos | burta | rufa | wyniszczenie (pula 12 000 HP) |
|---|---|---:|---:|---:|---:|---|
| Bellator | Vulcan Minigun | — | — | — | — (odsł. 3396) | 3000 tr. / 210 s |
| Bellator | Heavy Autocannon | — | — | — | — | 429 tr. / 215 s |
| Bellator | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Bellator | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Bellator | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Bellator | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Bellator | Valkyrie Railgun (Special) | — | — (odsł. 92) | **64** | **49** | 24 tr. / 69 s |
| Bellator | Bateria Główna Klasy YAMATO | **170** | **115** | **73** | **46** | 15 tr. / 20 s |
| Bellator | Laser Wiązkowy (Ciągły) | **3391** | **1883** | **1679** | **1417** | 1500 tr. / 75 s |
| Bellator | Laser Wiązkowy (Puls) | — | — (odsł. 441) | **423** | **329** | 267 tr. / 173 s |
| Bellator | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 171 s |
| Bellator | Cruise Missile Rack | — | — | — | — | 12 tr. / 29 s |
| Iron Skull | Vulcan Minigun | — | — (odsł. 3782) | — (odsł. 4252) | — (odsł. 3795) | 3000 tr. / 210 s |
| Iron Skull | Heavy Autocannon | — | — | — | — | 429 tr. / 215 s |
| Iron Skull | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Iron Skull | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Iron Skull | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Iron Skull | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Iron Skull | Valkyrie Railgun (Special) | — | **69** | **66** | **56** | 24 tr. / 69 s |
| Iron Skull | Bateria Główna Klasy YAMATO | **157** | **79** | **66** | **49** | 15 tr. / 20 s |
| Iron Skull | Laser Wiązkowy (Ciągły) | **3063** | **1291** | **1817** | **1613** | 1500 tr. / 75 s |
| Iron Skull | Laser Wiązkowy (Puls) | — | **400** | **420** | **377** | 267 tr. / 173 s |
| Iron Skull | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 171 s |
| Iron Skull | Cruise Missile Rack | — | — | — | — | 12 tr. / 29 s |
| Atlas | Vulcan Minigun | — | — | — | — | 3000 tr. / 210 s |
| Atlas | Heavy Autocannon | — | — | — | — | 429 tr. / 214 s |
| Atlas | Tempest Ion Mk II | — | — | — | — | ~1200 tr. / ~480 s (analit.) |
| Atlas | Tempest Ion — Ciężki | — | — | — | — | ~500 tr. / ~700 s (analit.) |
| Atlas | Helios Laser | — | — | — | — | ~1000 tr. / ~550 s (analit.) |
| Atlas | Armata Oblężnicza | — | — | — | — | 80 tr. / 198 s |
| Atlas | Valkyrie Railgun (Special) | — | — | — (odsł. 98) | — | 24 tr. / 69 s |
| Atlas | Bateria Główna Klasy YAMATO | — | **163** | **145** | — (odsł. 171) | 15 tr. / 20 s |
| Atlas | Laser Wiązkowy (Ciągły) | — | **2181** | **2545** | **3465** | 1500 tr. / 75 s |
| Atlas | Laser Wiązkowy (Puls) | — | — | — | — | 267 tr. / 173 s |
| Atlas | Siege Torpedo Mk I | — | — | — | — | 15 tr. / 170 s |
| Atlas | Cruise Missile Rack | — | — | — | — | 12 tr. / 28 s |

Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.

### Rozrzut między przebiegami (niezależne ziarna)

Pojedynczy przebieg jest chaotyczny (odłamki, podziały, rozrzut celowania): ten
sam przypadek na 6 ziarnach daje ±25% wokół mediany, więc wnioski opieram na
medianach (np. „46” dla Yamato w rufę Bellatora w macierzy to jeden przebieg,
mediana 48).

| kadłub | broń | kierunek | STOPIENIE osiągnięte | trafień min / mediana / max | wszystkie |
|---|---|---|---:|---|---|
| Bellator | Valkyrie Railgun (Special) | burta | 6/6 | 57 / 71 / 77 | 71, 66, 77, 71, 74, 57 |
| Bellator | Valkyrie Railgun (Special) | rufa | 6/6 | 44 / 53 / 55 | 55, 44, 55, 54, 53, 48 |
| Bellator | Bateria Główna Klasy YAMATO | burta | 6/6 | 66 / 72 / 82 | 67, 72, 73, 82, 78, 66 |
| Bellator | Bateria Główna Klasy YAMATO | rufa | 6/6 | 46 / 48 / 56 | 54, 46, 48, 56, 52, 47 |
| Iron Skull | Valkyrie Railgun (Special) | burta | 6/6 | 66 / 66 / 73 | 66, 66, 66, 73, 71, 67 |
| Iron Skull | Valkyrie Railgun (Special) | rufa | 6/6 | 46 / 53 / 66 | 56, 46, 50, 55, 53, 66 |
| Iron Skull | Bateria Główna Klasy YAMATO | burta | 6/6 | 67 / 72 / 82 | 82, 76, 67, 72, 72, 77 |
| Iron Skull | Bateria Główna Klasy YAMATO | rufa | 6/6 | 51 / 58 / 68 | 63, 58, 68, 51, 55, 58 |

### Wariant: sonda punktu (dzisiejszy warunek gry: 5 punktów, 2 kontrole bez heksa)

| kadłub | broń | dziób | skos | burta | rufa | wyniszczenie (pula 12 000 HP) |
|---|---|---:|---:|---:|---:|---|
| Bellator | Valkyrie Railgun (Special) | — | **93** | **56** | **41** | 24 tr. / 69 s |
| Bellator | Bateria Główna Klasy YAMATO | **171** | **117** | **69** | **45** | 15 tr. / 20 s |
| Bellator | Laser Wiązkowy (Puls) | — | — (odsł. 441) | **369** | **306** | 267 tr. / 173 s |
| Bellator | Laser Wiązkowy (Ciągły) | **2673** | **1241** | **979** | **815** | 1500 tr. / 75 s |
| Iron Skull | Valkyrie Railgun (Special) | — | **63** | **62** | **51** | 24 tr. / 69 s |
| Iron Skull | Bateria Główna Klasy YAMATO | **162** | **86** | **72** | **54** | 15 tr. / 20 s |
| Iron Skull | Laser Wiązkowy (Puls) | — | **347** | **369** | **356** | 267 tr. / 173 s |
| Iron Skull | Laser Wiązkowy (Ciągły) | **2365** | **713** | **1073** | **933** | 1500 tr. / 75 s |
| Atlas | Valkyrie Railgun (Special) | — | — | — (odsł. 98) | — | 24 tr. / 69 s |
| Atlas | Bateria Główna Klasy YAMATO | — | **153** | **123** | **180** | 15 tr. / 20 s |
| Atlas | Laser Wiązkowy (Puls) | — | — | — | — | 267 tr. / 173 s |
| Atlas | Laser Wiązkowy (Ciągły) | **5883** | **1661** | **1831** | **2775** | 1500 tr. / 75 s |

Komórka = trafień w kadłub do STOPIENIA (punkt bez powrotu); „— (odsł. N)” = w limicie 300 s tylko ODSŁONIĘTY po N trafieniach; „—” = komora nietknięta; † = rdzeń odcięty z fragmentem.

### Przed i po poprawce heksów-duchów (ta sama metoda, trafień do STOPIENIA)

| kadłub | broń | dziób | skos | burta | rufa |
|---|---|---|---|---|---|
| Bellator | Valkyrie Railgun (Special) | — → — | — (odsł. 88) → — (odsł. 92) | **67** → **64** | **49** → **49** |
| Bellator | Bateria Główna Klasy YAMATO | **116** → **170** | **92** → **115** | **58** → **73** | **22** → **46** |
| Bellator | Laser Wiązkowy (Puls) | — → — | — → — (odsł. 441) | **430** → **423** | **368** → **329** |
| Bellator | Laser Wiązkowy (Ciągły) | — → **3391** | — → **1883** | — → **1679** | — → **1417** |
| Iron Skull | Valkyrie Railgun (Special) | — → — | **65** → **69** | **73** → **66** | **55** → **56** |
| Iron Skull | Bateria Główna Klasy YAMATO | **115** → **157** | **51** → **79** | **44** → **66** | **42** → **49** |
| Iron Skull | Laser Wiązkowy (Puls) | — → — | — (odsł. 311) → **400** | — (odsł. 296) → **420** | — (odsł. 268) → **377** |
| Iron Skull | Laser Wiązkowy (Ciągły) | — → **3063** | — → **1291** | — → **1817** | — → **1613** |
| Atlas | Valkyrie Railgun (Special) | — → — | — → — | — → — (odsł. 98) | — → — |
| Atlas | Bateria Główna Klasy YAMATO | — → — | **160** → **163** | **91** → **145** | **132** → — (odsł. 171) |
| Atlas | Laser Wiązkowy (Puls) | — → — | — → — | — → — | — → — |
| Atlas | Laser Wiązkowy (Ciągły) | — → — | — (odsł. 67) → **2181** | — → **2545** | — → **3465** |

Przed: stary destruktor (okna sond bez dryfu, solver co klatkę) i synchroniczne lustro solvera. Po: bieżący kod gry i lustro z opóźnieniem wyniku jak na GPU.

### Czułość na r i armorMul (ogień z burty)

| kadłub | broń | r (px siatki) | ×1 | ×2 | ×3 | ×4 |
|---|---|---:|---:|---:|---:|---:|
| Bellator | Valkyrie Railgun (Special) | 18 (14 heksów) | **52** | **52** | **52** | **52** |
| Bellator | Valkyrie Railgun (Special) | 26 (32 heksów) | **60** | **60** | **60** | **60** |
| Bellator | Valkyrie Railgun (Special) | 36 (62 heksów) | **80** | **81** | **88** | **80** |
| Bellator | Bateria Główna Klasy YAMATO | 18 (14 heksów) | **49** | **49** | **49** | **49** |
| Bellator | Bateria Główna Klasy YAMATO | 26 (32 heksów) | **71** | **65** | **71** | **69** |
| Bellator | Bateria Główna Klasy YAMATO | 36 (62 heksów) | **91** | **91** | **93** | **93** |
| Bellator | Laser Wiązkowy (Puls) | 18 (14 heksów) | **258** | **285** | **304** | **325** |
| Bellator | Laser Wiązkowy (Puls) | 26 (32 heksów) | **331** | **389** | **423** | — (odsł. 292) |
| Bellator | Laser Wiązkowy (Puls) | 36 (62 heksów) | **437** | — (odsł. 302) | — (odsł. 319) | — (odsł. 325) |
| Iron Skull | Valkyrie Railgun (Special) | 18 (16 heksów) | **52** | **53** | **53** | **53** |
| Iron Skull | Valkyrie Railgun (Special) | 26 (34 heksów) | **66** | **66** | **66** | **66** |
| Iron Skull | Valkyrie Railgun (Special) | 36 (63 heksów) | **69** | **80** | **81** | **75** |
| Iron Skull | Bateria Główna Klasy YAMATO | 18 (16 heksów) | **48** | **62** | **53** | **53** |
| Iron Skull | Bateria Główna Klasy YAMATO | 26 (34 heksów) | **62** | **65** | **65** | **56** |
| Iron Skull | Bateria Główna Klasy YAMATO | 36 (63 heksów) | **86** | **82** | **81** | **79** |
| Iron Skull | Laser Wiązkowy (Puls) | 18 (16 heksów) | **251** | **279** | **300** | **321** |
| Iron Skull | Laser Wiązkowy (Puls) | 26 (34 heksów) | **329** | **379** | **418** | — (odsł. 283) |
| Iron Skull | Laser Wiązkowy (Puls) | 36 (63 heksów) | **425** | — (odsł. 300) | — (odsł. 302) | — (odsł. 314) |
| Atlas | Valkyrie Railgun (Special) | 18 (17 heksów) | **93** | **93** | **93** | **93** |
| Atlas | Valkyrie Railgun (Special) | 26 (34 heksów) | — (odsł. 100) | — (odsł. 100) | — (odsł. 100) | — (odsł. 100) |
| Atlas | Valkyrie Railgun (Special) | 36 (61 heksów) | — | — | — | — |
| Atlas | Bateria Główna Klasy YAMATO | 18 (17 heksów) | **100** | **117** | **99** | **101** |
| Atlas | Bateria Główna Klasy YAMATO | 26 (34 heksów) | **131** | **147** | **136** | **123** |
| Atlas | Bateria Główna Klasy YAMATO | 36 (61 heksów) | **154** | **150** | **168** | **153** |
| Atlas | Laser Wiązkowy (Puls) | 18 (17 heksów) | **442** | — (odsł. 421) | — (odsł. 424) | — (odsł. 428) |
| Atlas | Laser Wiązkowy (Puls) | 26 (34 heksów) | — | — | — | — |
| Atlas | Laser Wiązkowy (Puls) | 36 (61 heksów) | — | — | — | — |

Komórka = trafień do STOPIENIA (pojedynczy przebieg, ±25%); pula HP (wyniszczenie) jak w macierzy: Valkyrie 24, Yamato 15, laser pulsacyjny 267.

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

1. **Pula HP decyduje prawie o wszystkim.** W macierzy progu osłony rdzeń
   zabija pierwszy tylko 2 razy na 144 — i za każdym razem laserem ciągłym
   (rufa Bellatora 1417 vs 1500 trafień do zbicia puli, skos Iron Skulla 1291
   vs 1500). Ciężkie działa są daleko: Yamato w rufę — mediana 48 trafień
   (Bellator) i 58 (Iron Skull) wobec 15, Valkyrie — mediana 53–71 wobec 24,
   laser pulsacyjny 329–423 wobec 267.
2. **Poprawka heksów-duchów zrobiła z lasera ciągłego wiertło.** Przed nią
   w ogóle nie dochodził (trafiał ~40% strzałów i zatrzymywał się na
   wgnieceniach); teraz trafia każdym strzałem, bez rozrzutu wierci wąski
   tunel i w trybie sondy punktu (dzisiejszy warunek gry) zabija rdzeniem
   PRZED zbiciem puli w 6 z 8 przypadków na Bellatorze i Iron Skullu
   (713–1241 vs 1500 trafień). Na dziś to jedyna broń, która realnie gra
   „lock na rdzeń”.
3. **Drobne bronie nie dokopią się nigdy.** Działka, Tempest, Helios, rail
   Mk II, Armata, torpedy i rakiety (3D, bez heksów) — komora nietknięta w
   300 s z każdego kierunku; Vulcan odsłania komorę dopiero po ~3400–4250
   trafieniach, długo po zbiciu puli (3000).
4. **Kierunek ma znaczenie.** Rufa jest 2–4× tańsza niż dziób (Bellator,
   Yamato: rufa 46 / burta 73 / skos 115 / dziób 170) — rdzeń rufowy ma sens
   taktyczny: „zajdź go od rufy”.
5. **Atlas jest praktycznie nietykalny od strony rdzenia** (275 px pancerza):
   Yamato 145–163 trafień, laser ciągły 2181–3465, Valkyrie ani razu w 300 s.
6. **Próg osłony vs sonda punktu:** dla ciężkich dział koszt podobny (±20%),
   dla lasera ciągłego sonda jest ~1,5–2× tańsza — wąski tunel przez środek
   wystarcza, a próg osłony wymaga wypalenia 70% komory. Próg osłony jest
   odporny na „przestrzał jednego heksa” i działa z falą łańcucha — dlatego
   dalej go zalecam; przy sondzie laser ciągły byłby bronią od rdzeni.
7. **armorMul nie gra roli dla ciężkich broni** (Valkyrie zadaje 450
   bezpośrednio, Yamato 765, heks komory ×4 ma 320) — koszt wyznacza grubość
   kadłuba nad komorą. Dla lasera pulsacyjnego (40 bezpośrednio) każdy stopień
   pancerza to +8–10% trafień. Mniejsza komora jest tańsza (Bellator,
   Valkyrie: r 18 → 52, r 26 → 60, r 36 → 80–88).

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
| capital | 26 (Bellator 48, Iron Skull 62,64 na sprite'cie 1727 × 911, Atlas 56 px PNG) | 3 | osłona ≤ 30% | 3,5 s | capital | ~32–36 heksów; 3,5 s = czas na reakcję (odepchnięcie, odlot), a łańcuch w formacji wciąż działa |

Miejsca: A każdego kadłuba (§ 3) — przy środku masy, poza mostkami. `armorMul` 3 zostawiam jako ochronę przed
„snajpieniem” odsłoniętej komory lekką bronią — dla ciężkich nie ma znaczenia.

---

## 11. Otwarte kwestie (do decyzji)

1. **Pula HP.** Bez zmiany rdzeń nigdy nie wygrywa z wyniszczeniem. Opcje:
   (a) zostawić — rdzeń jako rzadki bonus specjali i łańcuchów;
   (b) pula HP kadłubów heksowych ×3–4 (36 000–48 000) — wtedy Valkyrie od
   rufy/burty (mediana 53–71 tr. = 27–36 tys. obrażeń) i Yamato od rufy
   (mediana 48–58 tr. ≈ 41–49 tys.) wyprzedzają pulę;
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
9. **Wagi wariantów detonacji** (§ 12). Dziś capital ma rozprysk tylko w 20%.
   Czy dawny obraz ma zostać dominujący, i czy gracz ma dostawać te same
   warianty co NPC?
10. **Alfa w potoku Core3D** (§ 6 pkt 9): poprawić premultiplied w uber
    passie (poświaty ciemnieją, trzeba przestroić bloom) czy zostawić i
    pilnować alfy = max(rgb) w efektach?
11. ~~**Fala z refrakcją poza rakietami**~~ — rozstrzygnięte 2026-09-24:
    zdjęta wszędzie poza rakietami supernova, także z Yamato i rozpadu stacji
    (§ 12).

---

## 12. Warianty detonacji

Demo: sekcja „Detonacja” w panelu — Wariant (losowy albo jeden z sześciu),
Wtórne (losowo / zawsze / nigdy), „Galeria wariantów” (sześć detonacji po
kolei na świeżych kadłubach). Z konsoli: `__rdzen.detonateAs('orb', 0, 0.9, 2)`
— czwarty argument to indeks kadłuba, w który ma pójść wyrzut albo kula.

Zrzuty (`node dema/rdzen-shots.js --only variants,formationHazards`):
- `.tmp/rdzen/v1…v6-<wariant>-{a-wybuch,b-po,c-koniec}.png` — 0,15 / 1,4 /
  3,0 s po wybuchu; wyrzut i kula mają dodatkowo klatkę `a2` (0,6 s: cięcie,
  wytapianie wyjścia);
- `v7-kula-topi-*` — formacja: kula z Bellatora A przetapia Iron Skulla C aż do
  jego reaktora (stopienie w łańcuchu);
- `v8-strumien-tnie-*` — strumień z A tnie Bellatora B; odsłonięty reaktor B
  wchodzi w stopienie.

Zegar zrzutów: `runFrames(n, fps, { realtime: true })`. `reactorblow.js`
liczy fazy z `performance.now()`, więc bez tempa czasu rzeczywistego jego
wybuch był na zrzutach „młodszy” niż czas symulacji (fałszywe wybielenia).

Plazma krąży w komorze jak torus w polu utrzymującym. Przy detonacji pole
puszcza za każdym razem inaczej (`CORE_DETONATION_VARIANTS`):

| wariant | kadłub | krater × | AoE / heksy × | `reactorblow` | własny obraz (`coreFx3D`) | wtórne |
|---|---|---:|---|---|---|---:|
| `shatter` rozprysk | 2–5 sektorów kątowych (dawny jedyny rozpad) | 1 | 1 / 1 | profil klasy, ×1 | pierścień 0,45 AoE, iskry | 55% |
| `halves` przełamanie | pęknięcie przez rdzeń, zwykle w poprzek; połowy odchodzą od szczeliny i rozchylają się | 0,55 | 0,9 / 0,85 | fighter ×0,7 | rozbłysk 0,26, pierścień 0,4, snopy z brzegów pęknięcia i tarcie wzdłuż szczeliny | 50% |
| `thirds` rozerwanie | trzy pęknięcia co ~120° od rdzenia, trzy części | 0,7 | 0,95 / 0,9 | fighter ×0,7 | jak wyżej | 50% |
| `hole` wyrwa | zostaje jednym martwym wrakiem z dużą poszarpaną dziurą | 1,5 | 1,15 / 1 | fighter ×0,9 | rozbłysk 0,3, pierścień 0,6, roztopiony metal z obwodu | 70% |
| `jet` wyrzut | zostaje; strumień plazmy w losową stronę, odrzut i obrót kadłuba | 0,45 | 0,55 / 0,6 | brak | wystrzał (tworzywo Hexlance), strumień, rzaz na celu, rozbłysk 0,14 | 35% |
| `orb` kula | zostaje; kula plazmy wypada w losową stronę i topi wszystko na drodze | 0,35 | 0,5 / 0,5 | brak (kula ma własny) | wypadnięcie (recepta Tempesta), kula ze smugą, krople i wiór przy topieniu, rozbłysk 0,12, pierścień 0,25 | 25% |

„AoE / heksy ×” to udział wybuchu w komorze — resztę energii niesie strumień
albo kula. Wagi losowania (`CORE_VARIANT_WEIGHTS`, kolejność jak w tabeli):
escort 45/30/0/15/10/0, cruiser 28/24/14/14/12/8, capital
20/20/16/14/16/14. Ogniwo łańcucha (`chainDepth > 0`): strumień i kula ×0,5,
wyrwa ×1,5 — bez kaskady wyrzutów przez formację.

**Dlaczego nie pełny `reactorblow`.**
- Rozprysk zostaje 1:1 jak dziś, łącznie z wybieleniem ekranu kolcami przez
  pierwsze 0,3–0,5 s przy zbliżeniu 0,35–0,5.
- Przełamanie, rozerwanie i wyrwa biorą najmniejszy profil (fighter). Kolce
  escort, cruiser i capital wybielały ekran i chowały pęknięcie albo dziurę;
  ich obraz niesie teraz `coreFx3D`.
- Strumień i kula nie mają `reactorblow`: błysk capital (×12 przez 1,2 s)
  zakrywałby ich start.

**Fala z refrakcją — w grze tylko dla rakiet supernova (decyzja 2026-09-24,
wdrożona w plikach gry).**
- Co to jest: `Shockwave3DManager` (`core3d.js:711`, `window.trigger3DShockwave`).
  Sfera renderowana do celu refrakcji — ta sama, która w klatkach „po”
  powiększała kawałki kadłuba.
- Zdjęta (jedyna zmiana plików gry w tej fazie, na polecenie):
  - `reactorblow.js` — `shockwave3D: null` i `heatHaze: null` w profilach
    escort / cruiser / capital (`PROFILE_CONFIGS`, `:399`, `:427`, `:457`;
    fighter nie miał fali nigdy). Zdejmuje falę i jej zapas `heatHaze` ze
    wszystkich wybuchów reaktora, także z dzisiejszego losowego critu. Kod
    spawnu zostaje — profil z polami `shockwave3D` / `heatHaze` włącza go z
    powrotem;
  - `reactorProfiles/stationCutProfile.js` i `stationFinalProfile.js` — to
    samo (`stationChainProfile.js` fali nie miał);
  - `yamato.js:506` — wywołanie fali usunięte;
  - `index.html`, `Destruction3D.init` (`:5672`) — `shockwaveManager: null`,
    więc rozpad stacji (`shatter`, `implodeMass` w `destruction3D.js`) jej
    nie odpala.
- Zostaje: rakiety (`rocketSystem3D.js:927`, styl „supernova”) wołają
  `trigger3DShockwave` same.
- Koszt: bez aktywnej fali Core3D pomija snapshot refrakcji (`hasActive()`,
  `core3d.js:1410`) — do 3 renderów sceny co drugą klatkę mniej przy każdym
  z tych wybuchów.
- Strażnik: `tests/renderBugfixGuards.test.mjs` („…fala z refrakcją tylko
  dla supernovy”). Dawny test osi fali Yamato zastąpiłem sprawdzeniem, że
  fali nie ma nigdzie poza supernovą; oś `heatHaze` reaktora i rakiet jest
  pilnowana dalej.
- Demo: `spawnReactorBlow` to zwykłe `overlay3D.spawn(window.makeReactorBlow(opts))`
  — profile same nie mają już fali.

**Strumień** (`CORE_JET_PROFILES`, escort / cruiser / capital):
- długość 0,75 / 0,8 / 0,85 × promień AoE, min. 500 j. (Bellator: 1669 j.,
  wcześniej 2159);
- czas 0,65 / 1,0 / 1,4 s (wcześniej 0,8 / 1,2 / 1,8); narasta przez 0,06 s,
  gaśnie w ostatnich 30%;
- energia bez zmian: 1,2 / 1,4 / 1,6 × bazowe obrażenia AoE, rozłożona na
  krótszy czas (Bellator: 6171 HP/s, wcześniej 4800);
- trafia pierwszy kadłub na promieniu (`sweepImpact`); co 0,05 s dostaje on
  krater `applyImpact` 160 / 260 / 380 i obrażenia puli;
- odrzut 200 / 140 / 90 j/s plus obrót; źródło i kierunek siedzą w układzie
  kadłuba, więc odrzut wodzi strumieniem po okolicy;
- kierunek: losowy (`coreExitDirection`, tryb `'random'`). Tryb `'wound'`
  (przez wyrwę komory, ±25°) zostaje w `planCoreBreakup(..., { exit })`;
  `exitDir` wymusza kierunek (testy, ujęcia).

**Kula** (`CORE_ORB_PROFILES`):
- prędkość 320–480 / 280–420 / 240–380 j/s względem kadłuba;
- zapalnik 0,8–1,2 / 1,0–1,6 / 1,2–2,0 s, liczony od WYJŚCIA z własnego
  kadłuba; najpóźniej wybucha po zapalniku + 3 s, gdyby nie wyszła;
- **topi wszystko.** Co krok heksy w promieniu kuli giną rozżarzone:
  - wyszukiwanie: `collectHexesInDisc`, okno komórek jak `findBeamHexShard`
    poszerzone o dryf wgnieceń;
  - `addShardHeat` 0,7, potem `destroyShard` z `_woundHeatContext =
    meltRimHeat` (0,8 / 0,82 / 0,85). Brzeg kanału świeci natywnym
    mechanizmem destruktora (`_heatWoundRim`), a odłamek GPU leci jako
    świecąca, stygnąca kropla (`debrisHeatGlow`), rozpryśnięta na boki
    60–180 j/s. Z żarem 1 setki kropli zlewały się w białą plamę;
- własny kadłub topi przy wyjściu: bez puli HP i bez hamowania. Plan kuli nie
  wycina kanału — kula wytapia go sama;
- cudzy kadłub (także wrak):
  - dostaje `meltDps` 700 / 1100 / 1600 HP/s puli;
  - kula w nim grzęźnie (`meltDrag` 1,4 / 1,2 / 1,0 na sekundę);
  - kadłub jest oznaczany do łańcucha (depth + 1) — kula, która dotopi się
    do komory, odpala tamten reaktor (v7);
- `splitQueue` nie częściej niż co 0,12 s (flood fill), ostatni raz przy
  wybuchu kuli;
- tarcza (`hooks.blocksHexes`) trzyma plazmę jak ostrzał: kula wybucha na niej;
- wybuch: 0,6 / 0,65 / 0,7 × promień AoE i 0,6 × obrażenia, `reactorblow`
  fighter / escort / cruiser (bez refrakcji).

**Wtórne** (`CORE_SECONDARY_PROFILES`) — amunicja i paliwo w tym, co zostało
(fragmenty albo wrak):
- 1–2 / 2–3 / 2–5 wybuchów w 0,2–1,8 s po detonacji;
- krater 220 / 320 / 420;
- mały `reactorblow` fighter (rozmiar 22 / 34 / 48) oraz `cookOff`
  (§ „Iskry z puli gry”);
- heks mógł w międzyczasie przejść do innego wraku — `locateShard` go
  odnajduje.

### Iskry z puli gry

Efekty rdzenia nie mają już własnych iskier: stare `burst` i
`sparksFromShards` (pula wyrzutów) są usunięte. Iskry pochodzą z pul, z
których sypie gra.

- **`Fx3D`** (`fxParticles3D.js`) — wspólny bank błysków wylotowych
  (`muzzleFx3D.js`) i Hexlance (`railgunFx3D.js`, klawisz 4).
  - Tworzywo: iskry-smugi, rozżarzone odpryski, łuki, opar, flara, krzyż.
  - Palety z tamtych recept: metal stygnie do czerwieni, plazma zostaje barwą
    rdzenia (L ≈ 2,6, kanał ≤ 4,5).
  - Skala recept na klasę (`FX_CLASS_SCALE`): 1,2 / 1,9 / 2,7.
- **`SparkSystem3D`** (overlay, 20 000 slotów) — iskry trafień (`burst`) i
  tarcia kadłubów (`grindingSeam`, `grindingBurst`). `coreFx3D` bierze
  `options.impactSparks` albo globalny `window.SparkSystem3D`, który gra
  inicjuje w `index.html:5654`.

Recepty (`coreFx3D`):

| funkcja | kiedy | co sypie |
|---|---|---|
| `blastSparks(x, y, o)` | wybuch w komorze, wybuch kuli | iskry na pełne koło (60% metal, 40% plazma), rozżarzone odpryski, łuki, opar, flara; `SparkSystem3D.burst` |
| `crackSparks(core, plan)` | przełamanie, rozerwanie — **przed** `applyCoreDetonation` | wiór z brzegów pęknięć wzdłuż szczeliny i w nią, dalej przez 0,45 s rozchodzenia się kawałków; `grindingSeam` wzdłuż każdego pęknięcia |
| `rimSparks(core, plan)` | wyrwa — **przed** `applyCoreDetonation` | roztopiony metal z obwodu krateru na zewnątrz |
| `cookOff(x, y, o)` | wybuch wtórny | 2–3 wystrzały `MuzzleFX3D` „armata” w losowe strony i rozżarzone odpryski |
| (start strumienia) | pierwsza klatka strumienia | tworzywo `RailgunFX.fire`: strugi jonów, płatki, łuki, mgła plazmy, plazma przed wylotem. Bez lancy (lancą jest strumień), z mniejszą flarą — pełna recepta ma lancę ~2800 j. i wybielała kadłub |
| (strumień w locie) | co klatkę | strugi jonów i łuki przy wylocie; na celu `RailgunFX3D.impact` przy wejściu w kadłub, potem `kerf` co 0,05 s — jak Hexlance tnący kadłub |
| (kula) | wypadnięcie, lot, topienie | `MuzzleFX3D` „tempest” przy wypadnięciu; w locie opar, iskry i łuki wokół kuli; przy topieniu wiór i krople z czoła kuli, a co 0,07 s rozbłysk i `grindingBurst` |

**Kto przesuwa pule:**
- w grze `Fx3D.update(dt)` i `MuzzleFX3D.beginFrame()` woła `Weapon3DSystem`
  raz na klatkę (`weapon3DSystem.js:1101`). `coreFx3D` nie może robić tego
  drugi raz;
- demo nie ma systemu broni 3D, więc woła je samo w `render()`, czasem
  symulacji (pauza zatrzymuje iskry);
- `coreFx.reset()` czyści tylko własne listy. Bank `Fx3D` zeruje ten, kto go
  posiada.

### API

```js
core.pendingVariant                      // wybrany na starcie STOPIENIA (beginMeltdown)
chooseCoreDetonationVariant(core, { force, seed, rng, time, weights })
applyVariantToBlast(blast, variant)      // AoE/krater ×, reactorProfile (null = bez), flashRadius, ringRadius, visualSize; base* = przed
planCoreBreakup(core, { mode: variant, seed, exit: 'random' | 'wound', exitDir })  // krater, pęknięcia, grupy, dirGridX/Y, edgeShards
applyCoreDetonation(core, plan, entities, { seed, kickSpeed, recoilSpeed, recoilSpin })   // → { wrecks, keptHost, recoil }
createCoreJet(core, plan, blast); stepCoreJet(jet, dt, entities, { hooks: { hullDamage, blocksHexes }, time }) // false = wygasł
createPlasmaOrb(core, plan, blast); stepPlasmaOrbs(orbs, dt, entities, { events, time, hooks })   // 'orbDetonate' { orb, hit, x, y, blast }
//   orb.meltCount (heksy od ostatniego odczytu — efekt zeruje), meltTotal, meltEntity, left, flight
rollSecondaryBlasts(variant, classId, rng); planSecondaryBlasts(pieces, opts); locateShard(shard, entities)
// coreFx3D:
coreFx.blastSparks(x, y, { classId, color, vx, vy, sparks, chunks, arcs, vapor, flare, hitSparks, scale })
coreFx.crackSparks(core, plan); coreFx.rimSparks(core, plan); coreFx.cookOff(x, y, { classId, vx, vy })
coreFx.spawnJet(jet, color); coreFx.spawnOrb(orb, color); coreFx.flash(...); coreFx.spawnRing(...); coreFx.reset()
```

Zdarzenie `detonate` niesie `variant`, a jego `blast` jest już przeskalowany
wariantem. `applyCoreBreakup` zostaje (zwraca same `wrecks`).

### Integracja (uzupełnia § 4 pkt 5–7)

1. **Wyprzedzenie `reactorblow`**: profil i rozmiar z
   `applyVariantToBlast(computeCoreBlast(core), core.pendingVariant)`. Dla
   `reactorProfile === null` (strumień, kula) nie odpalać nic, w pozostałych
   wariantach `chargeTime` przed końcem odliczania, jak w demie. Dlatego
   wariant jest losowany na starcie stopienia, a nie w chwili wybuchu. Bez
   fali z refrakcją (wyżej).
2. **Na `detonate`**:
   - `planCoreBreakup(core, { mode: ev.variant, seed })`;
   - dla przełamania i rozerwania `coreFx.crackSparks(core, plan)`, dla wyrwy
     `coreFx.rimSparks(core, plan)` — póki kadłub jest cały;
   - potem `applyCoreDetonation(...)`.
   - `keptHost` (wyrwa, strumień, kula): NPC ginie jako jeden wrak, BEZ
     `spawnReactorBlowBreakup`. Wzorem jest tworzenie wraku w
     `finishBridgeKill` (`index.html:18246`). Wyspy odcięte kraterem odpadną
     same w `processSplits` (kadłub trafia do `splitQueue`).
   - W pozostałych wariantach fragmenty to zwykłe `spawnWreckEntity` z pędem od
     szczeliny i przeciwnym obrotem.
3. **Strumienie i kule to zagrożenia fizyczne** — krokować je w kroku fizyki
   po `DestructorSystem.update` (demo: `stepHazards`), z tymi samymi
   `hooks` dla obu:
   - `hullDamage` → `applyDamageToNPC(e, dmg, 'core_jet' | 'core_orb')` albo
     obrażenia gracza; hulk mostka i tak zwraca od razu (§ 4 pkt 4);
   - `blocksHexes` → tarcza w górze. Tarcza trzyma ostrzał, więc i plazmę:
     strumień nie robi krateru (pulę bierze tarcza), kula wybucha na tarczy;
   - `orbDetonate` → ta sama gałąź co wybuch rdzenia (AoE HP,
     `applyBlastCoreShock`, kratery), z `source = null`.
   - Kula topi przez `destroyShard` kadłuby i wraki z listy encji. Zimne wraki
     (`coldWrecks`) nie mają `hexGrid` i nie ma ich na tej liście — kula ich
     nie widzi. Żeby topiła też je, zimny wrak na drodze kuli trzeba jawnie
     obudzić: `thawWreck(w, 'core_orb')` (najwyżej 1 na klatkę, AGENTS.md).
4. **Obraz** — przepis w `detonate()` w `rdzen-demo.js`:
   - `coreFx.flash` / `coreFx.spawnRing` według `blast.flashRadius` /
     `blast.ringRadius`;
   - `coreFx.blastSparks` (ilości na wariant: `BLAST_SPARKS` w demie);
   - `spawnJet` / `spawnOrb`;
   - `heatShards(plan.edgeShards)` — żarzące się brzegi pęknięć;
   - wybuch wtórny: `cookOff`.
5. **Łańcuch**: kadłub trafiony strumieniem albo topiony przez kulę dostaje
   `markCoreChainExposure(depth + 1)`.
6. **Koszt**: +1 draw call na rodzaj własnego efektu (strumienie, kule,
   pierścienie, rozbłyski), tylko gdy jest aktywny; limity instancji
   8 / 16 / 24 / 16. Iskry idą do istniejących pul gry (bez nowych draw
   calli). W szczycie wybuchu ~250–430 iskier `Fx3D` z 5200.

### Pasma HDR

Bloom wyłączony, okno 8 × promień komory, klatka „po” (1,4 s).

- **Strumień**: ciało 1,05 (pasmo barwy), żyła 8,0 z ostrą krawędzią tylko w
  pierwszych 30% długości — cały strumień w bieli czytał się jak biały laser.
  - max 8,5–17; szczyt tylko tam, gdzie żyła nachodzi na iskry wylotu (≤ 5 px);
  - 1,3–8: 4–22 px;
  - 8–12: 22–46 px.
- **Kula**: ciało 1,0, rdzeń 8,0 (promień 0,08–0,13 z pulsem).
  - max 9,5;
  - 1,3–8: 4 px;
  - 8–12: 6 px.
- **Pierścień i rozbłysk**:
  - pierścień: krawędź 8,5, ciało pod progiem;
  - rozbłysk: biel 9 tylko przez pierwsze 30% życia (promień bieli maleje
    0,3 → 0,07), ciało 0,9.
- **Iskry z puli gry** mają barwy 2–4,6, jak w receptach broni. To cienkie
  smugi (1 px): w oknie kuli ~60–400 px w paśmie 1,3–8. Świadomie tak jak
  wystrzały, bez przestrajania.
- **Alfa** wszystkich efektów rdzenia = max(rgb), blend ONE/ONE jak bloom w
  three (§ 6 pkt 9). Z alfą 1 na całym quadzie rozbłysk wycinał w poświacie
  strumienia ciemne koło wokół kadłuba, a koniec strumienia — prostokąt.

---

## 13. Modele reaktora

Przez wyrwę w komorze widać reaktor zamiast samej plamy żaru. Model leży pod
pancerzem, jest oświetlony własną plazmą i przechodzi przez stany rdzenia.
Nic nie zmienia w gameplayu — stan czyta z runtime `shipCore.js`.

Demo: sekcja „Model reaktora” na górze panelu:
- **„Galeria modeli”** — każdy model na swoim kadłubie przez wszystkie stany,
  z bliska: prześwietlenie → ODSŁONIĘTY → KRYTYCZNY → STOPIENIE → wrak
  reaktora po wyrzucie (~18 s na model; drugi klik przerywa);
- **„Zbliż na reaktor” (Z)** — kamera jedzie za reaktorem celu, komora na
  ~30% wysokości ekranu; drugi raz albo przesuw kamery — powrót;
- „Model” (M — następny): wg kadłuba (Bellator → tokamak, Iron Skull →
  prowizorka, Atlas → podwójny pierścień) albo wymuszony jeden z trzech;
- „model reaktora”: wyłączony wraca do dawnego żaru `coreFx3D`;
- „prześwietlenie” (X): cały model nad kadłubem, niezależnie od wyrwy i
  stanu (podgląd, także dla rdzenia NOMINALNEGO).

Dlaczego tak: przy zoomie ~1 komora ma ~50 px, model leży pod pancerzem, a
nakładka „komora” (kontury heksów, okrąg, krzyżyk) rysowała się dokładnie na
wyrwie — model czytał się jak zaślepka. Nakładki „komora” i „punkty sondy” są
teraz domyślnie wyłączone, a kółko myszy zbliża do ×12 (było ×4).

HUD pokazuje `model N (dc)` i linię „model reaktora (M)”. Z konsoli:
`__rdzen.reactor3D` (`debug.enabled`, `xray`, `structure`, `plasma`,
`stats`), `__rdzen.focusReactor()`, `__rdzen.runModelGallery()`, strojenie
`window.__reactor3DTune`.

Zrzuty (`node dema/rdzen-shots.js --only reactorModels`), `.tmp/rdzen/`:
`m1-terran-*`, `m2-pirate-*`, `m3-atlas-*`, klatki
`a-przeswietlenie`, `a2-przeswietlenie-zblizenie`, `b-odsloniety`,
`c-krytyczny`, `d-stopienie` (80% odliczania), `e-wrak-po-wyrzucie` i
`f-wrak-przeswietlenie`.

### Rodzaje (`reactor3DShapes.js`)

Jednostka modelu = promień komory `r`, osie = osie siatki heksów kadłuba,
z ≤ 0 w głąb (0 = dach modelu, −1 = podłoga przedziału). Kamera patrzy z
góry, więc liczą się dachy, skosy i to, co przykrywa co. Spodów nie ma.
Plazma krąży w torusie pod cewkami: między cewkami ją widać.

| rodzaj | dla kogo | plazma | cewki | reszta | akcent |
|---|---|---|---|---|---|
| `terran` tokamak | Terra Nova (Bellator i reszta niepirackich NPC) | pierścień R 0,55, rura 0,1 | 16 równych na dwóch szynach | solenoid w środku, 6 wsporników, grodź z 8 zaciskami i 4 sprzęgłami mocy | barwa plazmy |
| `pirate` prowizorka | piraci (Iron Skull) | eliptyczny 1,07 × 0,93, rura 0,115, migocze (35%) | 11 w nierównych odstępach; piątej brak (plazma tam wystaje), ósma podwójna | kanciasty rdzeń na śrubach, 7 kabli w poprzek, grodź z przerwą i 5 łatami, 2 zbiorniki | pomarańcz `#ff7a2a` |
| `atlas` podwójny pierścień | gracz | dwa przeciwbieżne pierścienie (R 0,64 i 0,38) i kula rdzenia 0,12 | 20 + 12 | kołnierz kuli, 4 szyny, 8 wsporników, grodź z 6 listwami | błękit `#46dcff` |

Geometria jest deterministyczna (bez `Math.random`). Cewek najwyżej 32
(limit tablic uniformów shadera plazmy).

### Render (`reactor3D.js`)

- **Pod kadłubem, widać go tylko przez wyrwę.**
  - Dach modelu na z −1,2: pod kadłubem (z 0) i płytą pancerza (−0,25).
  - Głębokość: 0,45 × promień komory w świecie.
  - Kadłub pisze głębię na z ≈ 0, więc model przechodzi test głębi tylko
    pod martwymi heksami. Maskowanie jest za darmo, jak u żaru (§ 9).
- **Warstwa 7** (pass tarcz), z tego samego powodu co żar: na warstwie 0
  cień własnego kadłuba przygaszałby wnętrze o ~0,5. `sync()` zgłasza
  warstwę przez `markLayerActive` (kontrakt AGENTS.md), tylko gdy coś rysuje.
- **Koszt: 2 draw calle na rodzaj** (najwyżej 6), tylko gdy rodzaj ma
  widoczną instancję:
  - konstrukcja: nieprzezroczysta, z zapisem głębi, `renderOrder` 8;
  - plazma: addytywna (ONE/ONE, alfa = max(rgb)), `renderOrder` 9.
  Cewki przykrywają pierścień, a między nimi plazmę widać. Do 64 instancji
  na rodzaj; bufory instancji stałe, bez alokacji na klatkę.
- **Światło daje plazma.** Liczone w układzie modelu, więc nie zależy od
  obrotu kadłuba. Pierścień działa jak źródło liniowe, u Atlasa świeci też
  kula. Otoczenie 0,05, bo pod pancerzem słońca nie ma. Model nie rzuca ani
  nie przyjmuje cieni.
- **Odbita baza.** Scena ma odwrócone y, więc baza instancji odbija model i
  odwraca nawinięcie trójkątów. Oba materiały są dwustronne, a plazma
  odrzuca dolną połowę rury po normalnej modelu (`vFace`), nie po
  nawinięciu. Nie przełączać na `FrontSide` — z nim znikał wierzch rury.
- **Precyzja float32** (AGENTS.md, świat przy 5–10 mln j.):
  - środki instancji są względem początku przy kamerze
    (`sync(..., { sceneOrigin })` z `sceneOriginNearCamera`,
    `src/3d/sceneOrigin.js`); bez niego początkiem jest pierwszy widoczny
    rdzeń. Dane przepisywane co klatkę, więc początek też co klatkę;
  - początek siedzi w `mesh.position`, a shader liczy
    `modelViewMatrix × pozycja` (wzór `Bridge3D._setOrigin`);
  - test: „precyzja: przy 8 mln j. …”.
- **Kiedy widać:** instancja jest tylko dla rdzeni ODSŁONIĘTYCH i wyżej (w
  prześwietleniu — dla wszystkich) oraz dla wraków reaktora.
- **Żar `coreFx3D` przy modelu.** Dla rdzenia z modelem `coreFx3D` wyłącza
  swój żar (`glowFilter`) — światło daje plazma. Wyrzuty zostają, ale
  rzadsze (×0,6) i z białą głowicą ×0,2: bez tego wyrzuty dawały ~90% bieli
  stopienia i zalewały model.

### Stany

| stan | plazma | cewki | reszta |
|---|---|---|---|
| ODSŁONIĘTY | krąży 0,35 obr./s, ciało 0,62 | pękają z utratą osłony (niżej) | — |
| KRYTYCZNY | 0,6 obr./s, ciało 0,72, rura faluje | przy osłonie < 60% pękniętych jest ≥ 44% | — |
| STOPIENIE | 0,8 → 2,5 obr./s, ciało 0,72 → 0,84, rura się rozlewa (niestabilność 0,25 → 0,9) | wszystkie żarzą się pomarańczem (0,25 → 0,85) | puls 1,2 → 7 Hz, jak żar |
| po `jet` albo `orb` | gaśnie w 0,25 s | — | wrak reaktora: żar stygnie (τ 2,2 s); wyrzut wyrywa łuk konstrukcji ±0,42 rad (~±24°) w swoją stronę, z żarzącym się brzegiem |
| po pozostałych wariantach | — | — | model wyparowuje razem z komorą |

Pęknięte cewki: (1 − osłona) × 1,1, najwyżej 85%, w każdym stanie od
ODSŁONIĘTEGO. Pęknięta jest ciemniejsza, lekko się żarzy i sypie iskrami, a
plazma wypycha się z rury przy niej. U piratów przy brakującej cewce wystaje
zawsze. Pasma plazmy są te same co żaru (`coreBands.js`):
- ciało pod progiem bloomu 0,9;
- biel 9–11,5 tylko w pakietach plazmy na szczycie rury: próg pasma 0,9,
  linia ±0,016 obwodu rury. Ciągła nić przez cały obwód zalewała model
  bloomem;
- metal oświetlony plazmą ≤ ~0,8.

### Pomiar HDR

Bloom wyłączony, zbliżenie ×8, okno 1,4 × promień komory (2,0 × w
stopieniu), komora otwierana od środka (`openChamber`).

| model | stan | max L | px > 0,9 | px 1,3–8 | px 8–12 | px > 12 |
|---|---|---:|---:|---:|---:|---:|
| tokamak | ODSŁONIĘTY | 8,6 | 145 | 30 | 77 | 0 |
| tokamak | KRYTYCZNY | 10,4 | 1965 | 134 | 438 | 0 |
| tokamak | STOPIENIE 80% | 11,3 | 26 937 | 1310 | 741 | 0 |
| prowizorka | ODSŁONIĘTY | 8,5 | 74 | 25 | 41 | 0 |
| prowizorka | KRYTYCZNY (klatka migotania) | 6,6 | 512 | 488 | 0 | 0 |
| prowizorka | STOPIENIE 80% | 11,2 | 4127 | 187 | 946 | 0 |
| Atlas | ODSŁONIĘTY | 9,6 | 343 | 74 | 261 | 0 |
| Atlas | KRYTYCZNY | 10,0 | 1015 | 220 | 776 | 0 |
| Atlas | STOPIENIE 80% | 11,9 | 12 885 | 265 | 1305 | 0 |

- Biel siedzi w paśmie 8–12. Pasmo 0,9–1,3 w stopieniu to barwa: żar cewek,
  rozgrzany brzeg rany, ciała wyrzutów i plazma wypychana przy pękniętych
  cewkach (do ~1,13).
- Migotanie prowizorki (14% chwil po 1/18 s) mnoży plazmę × 0,65. Biel spada
  wtedy do ~6 (pasmo 4–8) na tej samej, małej powierzchni. Bloom jest wtedy
  mniejszy, nie szerszy, więc zostawiłem.
- Między przebiegami liczby wahają się o ~30% (losowe wyrzuty, faza pulsu,
  migotanie). W stopieniu Atlasa bywa do ~200 px > 12 tam, gdzie głowice
  wyrzutów nachodzą na biel plazmy.

### API

```js
import { createReactor3D, resolveReactorKind, REACTOR3D_TUNE } from './src/3d/reactor3D.js';
const reactor3D = createReactor3D({
  scene,               // Core3D.scene
  layer,               // domyślnie 7 (CORE_FX_LAYER)
  markLayerActive,     // () => Core3D.setShieldLayerActive(true)
  kindFor,             // (core) => 'terran' | 'pirate' | 'atlas'; domyślnie resolveReactorKind
  colorFor             // (core) => [r, g, b] liniowo; core.color ma pierwszeństwo
});
reactor3D.sync(cores, nowSec, simDt, { sceneOrigin })       // co klatkę; sceneOrigin = sceneOriginNearCamera(_o) — układ SCENY (x, −y)
reactor3D.sync(cores, nowSec, simDt, { origin: { x, y } })  // to samo w układzie świata gry (y w dół) — demo
reactor3D.detonated(core, { variant, dirGridX, dirGridY, host }) // po planCoreBreakup; host = obiekt z kadłubem po wybuchu
reactor3D.rehost(core, host)   // wrak reaktora na inny obiekt kadłuba (false = brak wraku reaktora)
reactor3D.covers(core)         // czy rdzeń ma model (glowFilter coreFx3D)
reactor3D.reset(); reactor3D.dispose();
reactor3D.stats                // { instances, drawCalls, burnt }
reactor3D.debug                // { enabled, xray, structure, plasma }
```

`resolveReactorKind(core)`:
- `host.isPlayer` albo kadłub `atlas` → `atlas`;
- `pirate` / `skull` w kluczu kadłuba (`__hullId`, `shipFrame`, `type`) albo
  frakcja `pira…` → `pirate`;
- reszta → `terran`.

Barwa plazmy: `core.color` → `colorFor(core)` → błękit. Jest normowana do
luminancji 1, jasność daje pasmo stanu.

### Integracja

1. **Tworzenie**, raz po `Core3D.init`, PRZED `coreFx3D` (żar pyta model):
   ```js
   const reactor3D = createReactor3D({ scene: Core3D.scene, markLayerActive: () => Core3D.setShieldLayerActive(true), kindFor, colorFor });
   const coreFx = createCoreFx3D({ scene: Core3D.scene, colorFor, markLayerActive: () => Core3D.setShieldLayerActive(true), glowFilter: (core) => !reactor3D.covers(core) });
   ```
   `colorFor` ten sam co dla `coreFx3D` (barwy frakcji, § 9).
2. **Co klatkę**, w `render()` obok `updateHexShips3D`:
   `reactor3D.sync(allCores, nowSec, simDt, { sceneOrigin: sceneOriginNearCamera(_reactorOrigin) })`
   tuż przed `coreFx.sync(...)`.
   - Obie po aktualizacji tarcz: `shield3D.js` ustawia flagę warstwy 7
     bezwzględnie (§ 4 pkt 7).
   - `simDt` = czas gry tej klatki (pauza = 0).
   - `sceneOriginNearCamera` (`src/3d/sceneOrigin.js`, wspólny dla modułów
     3D) sam obsługuje wolną kamerę (pozycja kamery perspektywicznej).
     Zwraca układ SCENY — podawać jako `sceneOrigin`, nie `origin` (ten jest
     w układzie gry i `sync` odwraca mu y).
   - `reactor3D.js` nie importuje `sceneOrigin.js` (ciągnie `core3d.js`),
     żeby testy node szły na samej scenie — początek podaje gra.
   - Split-screen: jeden początek na klatkę. Przy dwóch odległych kamerach
     druga widzi dawny błąd float32.
3. **Na `detonate`**, po `planCoreBreakup`:
   `reactor3D.detonated(core, { variant: ev.variant, dirGridX: plan.dirGridX, dirGridY: plan.dirGridY, host })`.
   - W grze zabity NPC oddaje heksy NOWEMU obiektowi:
     `window.createWreckage(npc, shards)` → `spawnWreckEntity` (wzór:
     `finishBridgeKill`).
   - Ten wrak trzeba podać jako `host` albo zawołać
     `reactor3D.rehost(core, wreck)`. Bez tego wrak reaktora znika razem z
     NPC (`dead`).
   - Wrak żyje na komórkach rodzica (te same `srcWidth/srcHeight`, inny
     pivot), więc `core.gridX/gridY` dalej pasują.
4. **`kindFor`** — sprawdzić, które pole NPC w grze niesie klucz kadłuba
   (demo: `__hullId`). Nie brać aliasu edytora: `toEditorHullAlias` zlewa
   `pirate_` z Bellatorem (§ 5, poprawka 2).
5. **Wraki.** Wrak reaktora trwa, póki trwa jego kadłub:
   - obiekt martwy (`dead`) albo w puli (`_inPool` — `recycleWreck` wyda go
     potem jako INNY wrak) → rekord znika;
   - zimny wrak (`hexGrid === null`) → model się nie rysuje, rekord czeka;
     po `thawWreck` wraca (już wystygły);
   - model nie trzyma wraku przy życiu, więc stempel w
     `markColdWreckReferences` nie jest potrzebny.
6. **Reset świata** / nowa gra: `reactor3D.reset()` (obok `coreFx.reset()`).
7. **Lista kontrolna AGENTS.md:** bez nowego renderera; warstwa 7 zgłaszana
   co klatkę; początek przy kamerze; bez alokacji na klatkę (poza iteracją
   `Map` rekordów — kilka iteratorów na klatkę).

### Otwarte

- **`coreFx3D` pisze pozycje bezwzględne**
  (`projectionMatrix * viewMatrix * vec4(świat)` w 6 shaderach). Dotyczy
  żaru rdzeni bez modelu, wyrzutów, strumienia, kuli, pierścienia i
  rozbłysku. Przy 5–10 mln j. to ~1 px drgań miękkich efektów — ta sama klasa
  co cząstki gry sprzed poprawek precyzji. Twardą krawędź (model w wyrwie)
  naprawia już początek przy kamerze w `reactor3D`. Przepis dla `coreFx3D`
  zostawiła sesja precyzji w notatce `AGENT:` w jego nagłówku (2026-09-25):
  - `sceneOriginNearCamera` → `mesh.position`, dane względem niego;
  - wyrzuty siedzą w buforze pierścieniowym, więc początek „lepki” jak w
    `sparkSystem3D.js` / `slugTrail3D.js`;
  - pomiar przed/po: `dema/precyzja-drzenie.js`.
  Zrobić przy integracji.
- Model nie reaguje na wgniecenia kadłuba (heksy dryfują do `_maxHexDrift`).
  Widać go tylko przez martwe heksy, więc tego nie widać.
