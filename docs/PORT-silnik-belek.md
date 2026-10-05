# Port: kadłuby na silniku belek (zamiast heksowego destruktora)

Stan: 2026-09-25, etap 1 wdrożony — **statki gracza, P2, NPC i ich wraki są na silniku belek**
(`src/game/destructorBeams3D.js`, tryb płaski, solver lokalny). Heksowy destruktor
(`src/game/destructor.js`) został wyłącznie dla asteroid (heksowe ciała skał) do etapu 7.
Nie ma flagi ani dwóch ścieżek dla statków: encja z kadłubem ma `beamHull`, nie `hexGrid`.

## Pliki

| Plik | Rola |
|---|---|
| `src/game/hullBodies.js` | adapter gry: budowa kadłuba (siatka 15 px, `hexPerNode`), synchronizacja ruchu, krok, trafienia, zapytania, wraki, łup, odłamki, naprawa, zdarzenia zderzeń |
| `src/3d/hullDebris3D.js` | odłamki z dema (pogięte płyty i kształtowniki, instancje), jedna pula na grę; `window.spawnHullDebris` |
| `src/game/destructorBeams3D.js` | silnik; haki gry: `pairFilter`, `onContact`, `onWreck`, `onNodeDebris`, `clock`; krater (`opts.hpBudget`); `sweepLocal2D` / `probeLocal2D`; żar zgniotu (`cfg.heatGain`) |
| `src/game/beamStore3D.js` | pola węzła `heat` / `heatStamp` (tylko render) |
| `src/3d/beamHullSkin.js` | skóra gry: czworokąt na węzeł, UV jak tekstury heksów (`flipY = false`), jasność blachy, żar |
| `src/3d/hexShips3D.js` | backend skóry (`createBeamSkinMesh` / `updateBeamSkinMesh`), materiał = graf TSL skóry belek (`hexShips3D.tsl.js`, rysunek w partiach `hullSkinBatch.js` — port WebGPU, zadania 04 i 23); cień SDF z komórek (`beamShadowGrid`) |
| `src/3d/hullShadowSdf.js` | siatka komórkowa (`cellX/cellY/cellActive/cellCount/cellRadius`) obok heksów |
| `shieldSystem.js` | tarcza-obrys z węzłów spoczynkowych (`hull.shieldCells`) |
| `src/game/salvage.js` | udziały w komórkach = `hull.baseNodes`, stawki materiałów i tempo cięcia na heks (`hexPerNode`), broń przypięta do komórki `ix,iy` |

## Układy i kotwica

- Silnik: `X = x gry`, `Y = −y gry`, `θ = −(angle + spriteRotation)`, `ω = −angVel`. To układ
  renderu Core3D (x, −y) — skóra stoi wprost na ciele.
- Kotwica encji (`x, y` gry): statek = **środek sprite'a** (gniazda, dysze, światła liczą się od
  niego), wrak = **środek masy** ciała (`anchorMode: 'com'`, `hull.pivot` = piksel sprite'a środka masy).
- Środek sprite'a w układzie ciała = `latticeMin + (anchorDX, anchorDY)` — stały względem siatki,
  więc rozpad (przesunięcie `latticeMin` i `pos`) nie rusza kotwicy statku.
- Obraz kadłuba = ten sam, który dostawał `initHexBody` (sprite w rozmiarze renderu); komórka
  **15 px jak w demie** (`HULL_BODY_CONFIG.cellPx`, decyzja usera 2026-09-25). Tekstura skóry =
  pełny sprite (`visualImage`), UV znormalizowane.
- Dawna komórka 7,5 px (odstęp heksów) dawała 4× więcej węzłów (Atlas 12 288 zamiast 3 121):
  pchany okręt budził się cały i nie zasypiał (próg ruchu `0,2·cs` spada z komórką) — ciągły
  styk 2,7 ms/krok zamiast 0,13 — a kadłub pękał zamiast sprężynować jak w demie.
- Jednostką strojenia zostaje heks (`HEX_PITCH_PX` = 7,5): węzeł = `hull.hexPerNode` heksów
  (≈ 4). Tyle razy więcej HP (80 · pokrycie · hexPerNode = 320 — ten sam pancerz na
  powierzchnię), tyle waży w łupie (`salvage.js`: stawki na heks, udziały dalej w węzłach), tyle
  heksów zdejmuje cięcie wraku w polu (`fieldCutNodesPerSecond`). Krater liczy promień w heksach.

## Krok fizyki (`physicsStep`)

Gra całkuje ruch encji jak dotąd → `HullBodies.step(dt, allDestructibles)`:
`syncIn` (poza i prędkość encji → ciało), `DestructorBeams3D.update` (solver, kontakty, zgniot,
rozpady), `syncOut` (poprawka ruchu → encja; tylko gdy silnik coś zmienił). Potem heksowy
destruktor dostaje same ciała heksowe (`_hexDestructibles`, asteroidy).

## Trafienia i zapytania (świat gry, y w dół)

- `HullBodies.sweep(e, x0, y0, x1, y1, r)` — pierwszy żywy węzeł na odcinku (pociski, PD, wiązki);
  wynik współdzielony (`hullSweepResult`), `worldX/Y` = punkt wejścia.
- `HullBodies.impact(e, x, y, dmg, vel, {radius})` — KRATER: budżet HP = `0,9 · dmg` od
  najbliższego węzła (HP węzła 320 = 4 heksy po 80), promień `heks · clamp(1,5 + √(dmg/80), 1,5, 5)`
  (heks = `cs / √hexPerNode`, w j. świata jak dawniej), wgniecenie wzdłuż pocisku. Bez promienia
  zerwań: pękają belki zabitych węzłów, reszta wg oparcia. Lekkie działa najpierw wgniatają;
  dziurę (15 j.) robi dopiero kilka trafień w to samo miejsce. `opts.craterRadius` (zadanie 25c,
  ciężka broń — promień leja rany z `hullDamageStamps.craterRadiusFor`): bez budżetu, każdy węzeł
  w promieniu ginie (`D.applyImpact` `killRadius`, odrzut blachy z haszu węzła), zasięg dziury
  w `hullImpactResult.crater`.
- `HullBodies.probe(e, x, y)` — podparcie gniazd broni i rdzeni.
- `HullBodies.cutSegment` — rzaz Hexlance (pas 35 j.); `cutOuterNode` — cięcie wraku w polu.
- Sufit HP: `getHullStructuralState` → `HullBodies.structuralState` (żywe węzły / startowe).

## Masy (od 2026-09-26)

- **Masa ciała w silniku = masa ZDERZEŃ z powierzchni kadłuba**: `massPerArea` (1,19 / j.²) ×
  Σ pokrycie · cs² — jedna gęstość dla wszystkich kadłubów jak w demie (Atlas 672 400 j.² ≈ 800 tys.).
  Zderzenie i zgniot zależą wyłącznie od STOSUNKÓW mas (`jYield` ∝ masa węzła lżejszego ciała),
  a szablony gry dawały kapitałom ~0,3 masy/j.², fregatom i niszczycielom 1,3–1,6 — mały okręt
  przepychał Atlasa jak ciężki. A/B (niszczyciel 400 j./s w burtę Atlasa): Atlas dostawał
  13–21 j./s, teraz 2–3 j./s.
- **`entity.mass` zostaje masą GRY** (ciąg dysz ∝ masa, separacja AI `1/m^0,25`, holowanie,
  asteroidy) w dotychczasowej skali szablonów; transportowiec bez masy dostaje masę zderzeń.
- `syncOut`: gdy masa ciała spadnie (także trafienie MIĘDZY krokami — wcześniej nie liczone),
  masa gry i `inertia` encji maleją w tym samym stosunku (`_massRef`) — obrót uszkodzonego statku
  się nie zmienia (ciąg rośnie z masą, bezwładność była zapamiętana ze startu).
- Wrak: masa gry = masa jego ciała × skala gry rodzica (`gameMassScale`) — holowanie jak dotąd.
- Panel deweloperski mas (`destructorMassPanel.js`) USUNIĘTY 2026-09-26 (relikt heksów): startował
  zawsze i co 1 s nadpisywał masy gry NPC klasami (kapitały, też moduły megafrachtowca i Atlas
  NPC → 100 tys.) i wartościami z localStorage. Masy gry idą teraz wyłącznie z szablonów;
  klucz `devDestructorMassConfig` został na liście `SAVE_KEYS.dev`, żeby `?reset` go sprzątnął.

## Pancerz i zgniot (2026-10-04)

`src/data/hullArmor.js` przypisuje pancerz mechaniczny do profilu kadłuba: fregata 1,
niszczyciel 1,5, pancernik 3, lotniskowiec 4, superkapitał 10, Atlas 16. Frachtowce mają
własne słabsze poszycie — duży rozmiar i masa nie oznaczają pancerza okrętu bojowego.
Wszystkie ścieżki budowy w grze (gracz, zmiana kadłuba, P2, NPC) podają `hullProfileId`;
`HullBodies.createHull` zapisuje wartość w `body.collisionArmor`. Cały wrak i odłamki
dziedziczą ją po rodzicu. Nieznany/ręczny kadłub ma 1, jak przed zmianą.

Globalne `crushStrength` i `globalBreakMul` zostają strojeniem materiału. Opór zgniotu
jest mnożony przez pancerz słabszego uczestnika (przy ciele statycznym — statku).
Podatność każdego kadłuba maleje z kwadratem jego pancerza; udziały zgniotu są
normalizowane, więc mocne poszycie przekazuje zgniot słabszej stronie. Masa nadal
wpływa na podział, impuls i obrót. Równe pancerze zachowują podział według mas;
Atlas może się niszczyć w taranie innego ciężkiego okrętu. HP i kratery od broni
nie są zmienione przez ten parametr.

Test `tests/hullCollisionArmor.test.mjs`: rząd z misji 1, prawdziwe sprite'y, szarża
z `SHIP_SYSTEMS.atlas`, zgniecenie co najmniej trzech jednostek i strata <1% kadłuba
Atlasa; także taran Atlas–Atlas, dziedziczenie pancerza oraz niezmieniony budżet broni.

## Zderzenia

- Filtr par: `isCollidable`, moduły jednego właściciela (poza wrakami), liny holownicze,
  dwa zimne (stare i wolne) wraki. **Wraki zderzają się z rodzicem i rodzeństwem** (odłam leci po fizyce).
- `onContact` → `HullBodies.hasContact(a, b)` (AI ustępuje fizyce, okno 0,1 s) i `CollisionFX`
  (`grind` co krok z punktami szwu, `impact` przy pierwszym zetknięciu).
- Żar (poziom zderzenia = `min(1, zbliżanie / 150)`): biało świeci BRZEG RANY — końce belek
  zerwanych w solverze do 0,12 s po styku (+ pierścień sąsiadów 0,55); zgniatana powierzchnia tylko
  `heatContact` 0,35 (pomarańcz). W skórze żar narożnika = najgorętsza z 4 komórek wokół (bez
  kwadratów pojedynczych komórek). Zanik w shaderze (0,35/s).
- Odłamki: `src/3d/hullDebris3D.js` — pogięte płyty i kształtowniki z dema (`beamDebris3D.js`),
  kolor blachy komórki, światło słońca + maska cienia, jedna pula na grę, początek przy kamerze;
  bez żaru (świecące okruchy heksów czytały się jak „odpryski” shadera). Krater wybija blachę
  wstecz, w stronę strzelca (65%), reszta przelatuje wzdłuż pocisku.
- Naprawa (R): `HullBodies.repair` BEZ solvera — węzły, długości belek i HP zbiegają wprost do
  spoczynku (stała czasowa 0,4 s) z progami domknięcia. Dawne `D.repair` budziło cały kadłub
  (Atlas 4,5 ms/krok) i nie kończyło się (solver i naprawa ciągnęły długości w przeciwne strony).

## Wraki

- Rozpad kadłuba → `onWreck` → encja wraku (pola jak `spawnWreckEntity`, łup za komórkami,
  ładunek frachtowca do jednego wraku) w `window.wrecks`.
- Śmierć NPC → `createWreckage(npc)` → `HullBodies.convertToWreck` (cały kadłub przechodzi na wrak).
  Krytyczny wybuch → `HullBodies.shatter`: rdzeń w odłamki, promieniste rzazy, pchnięcie odłamów.
- Okruch (< `splitMinNodes` węzłów) idzie w odłamki i znika. Budżet: 600 tys. węzłów wraków.
- Sen wraku: `HullBodies.sleep` / `wake`. **Zimne wraki na belkach jeszcze nie zamarzają** (etap 3).

## Czego jeszcze nie ma (kolejne etapy)

3. Zimne wraki na belkach (zrzut magazynów), budżet i LOD wraków pod bitwę.
4. ~~Mostki~~ — **zrobione 2026-10-05**: logika na komórkach siatki belek (`src/game/shipBridgeBeams.js`, backend
   stanu dla funkcji `shipBridge.js`), model 3D z wyrwami po komórkach, efekty agonii na pulach WebGPU, demo
   `dema/mostki-webgpu.html` — `docs/PORT-mostki.md` § 9.
5. Rdzenie — wersja na belkach GOTOWA w demie (2026-09-30): logika `src/game/reactorCore.js`, wybuch
   WebGPU `src/3d/reactorBlast/`, `dema/rdzen-webgpu.html`; kroki wpięcia: `docs/webgpu/DEMO-RDZEN.md` § 7.
   Stare `shipCore` / `coreFx3D` (heksy) zostają dla dema heksowego.
6. Reszta: panel destruktora / devTools (dotyczą asteroid), radar (plan z węzłów już jest), perf HUD.
7. Asteroidy na belkach (materiał kruchy). Do tego czasu statek bez `hexGrid` ma z heksową
   asteroidą kolizję KOŁOWĄ (`asteroidField3D`), bez zgniotu.
8. Usunięcie starego silnika (`destructor.js`, GPU soft body, arena, `hexContactGrid`, testy).

Wydajność (zmierzone 2026-09-25, headless, bez profilera — sam start profilera CDP pauzuje
stronę na ~0,5 s i fałszuje pomiar klatek; skrypty były w scratchpadzie sesji):

| scenariusz (krok kadłubów) | 7,5 px | 15 px |
|---|---|---|
| taran pancernika 500 j./s: mediana / p95 / maks | 0,8 / 2,8 / 7 ms | 0,08 / 0,8 / 1,1 ms |
| gracz trzyma W w pancernik: 1. s / dalej / po puszczeniu | 3,0 / 2,7 / 2,3 ms | 0,7 / 0,14 / 0,13 ms |
| bitwa 10 okrętów: mediana / p95 | 0,05 / 0,8 ms | 0,06 / 0,25 ms |

Skoki klatek wokół kolizji, których silnik belek NIE powodował (były przed portem):
- ROZGRZANE 2026-09-26 (`tests/shaderPrewarm.test.mjs`): pierwsza kolizja w sesji ~50 ms
  (`overlayFx`: passy kompozytora `overlay3D` + materiał iskier), pierwszy Yamato 140–200 ms,
  pierwsza tarcza-obrys ~200 ms; rail / armata / działko i tarcze kompilowały się OD NOWA po
  każdej przerwie (dispose ostatniego materiału niszczy program three). Teraz `overlay3D.prewarm`
  (start overlaya, 23 programy, ~0,5 s w headless) i `prewarmShields3D` (ekran ładowania) z
  materiałami-trzymaczami — żaden efekt ani wróg nie kompiluje programu w grze.
- pierwsze pojawienie się wroga danego typu (po rozgrzewce): ~25–40 ms = budowa konstrukcji
  kadłuba w `drawNPCPretty` + skóra i cień SDF nowego kadłuba (bez kompilacji shaderów);
- pierwsze sekundy gry: `Core3D._pumpTextureUpload` wgrywa tekstury planet 8192×4096 po jednej
  w wolnej chwili — w headless 160–435 ms na teksturę (osobne zadanie, poza pętlą gry).
- Rozpady dużych kadłubów (`findBeamBridgesStore` + `findIslands` po całym grafie) → spójność przyrostowa.
- Biała plama na dziobie niszczyciela to REFLEKTOR (światło drogowe z edytora), nie lakier ani żar.

## Testy i narzędzia

- `tests/hullBodies.test.mjs` — układy, sweep, krater, taran i zdarzenia, filtr par, śmierć, okruchy, łup, wybuch reaktora.
- `tests/beamGameHooks.test.mjs` — haki silnika, krater, zapytania 2D, UV skóry, cień z komórek.
- `node scripts/dym-gry-belki.mjs [--scen taran|bitwa|oba] [--s 30]` — prawdziwa gra w headless
  Chrome: kadłuby, kratery, taran, bitwa, próbki kroku, zrzuty.
