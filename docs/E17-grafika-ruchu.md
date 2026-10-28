# E17 — grafika statków ruchu (2026-10-28)

Zadanie E17 z `docs/PLAN-ekonomia-rynki.md`. Stan i zasady obszaru: reguły `ruch-banka` (§ „Obraz”) i
`oswietlenie-kadlubow`. Ten dokument trzyma diagnozę, decyzje, pomiary i to, co zostało.

Zgłoszenie użytkownika (2026-10-28): „NPC i statki stojące w doku nie mają oświetlenia, są szare, jakby nieżywe.
Statek leci i widać tylko silniki — brak lakieru i oświetlenia; dopiero jak do niego podlecę, to się wybudza”.

## 1. Diagnoza A/B

Narzędzie `scripts/webgpu/ruch-wyglad-gra.mjs` (tryb worker i `off`): ten sam statek ruchu w tym samym miejscu
i świetle jako proxy, wymuszony awans (kolejka `TrafficPromotion` — jak trafienie gracza), klatki przejścia, pełny
NPC, powrót do bańki. Zrzuty „przed”: `.tmp/e17/przed-worker/` (gra z 301 encjami przy Ziemi po zimnym starcie:
35 zapasu floty, 144 postoju, 122 kursy).

„WYBUDZANIE” = AWANS DO NPC, nie przełączenie LOD: kadłub na belkach jest gotowy w klatce 0 po awansie (sprite'y
wczytane), pełne kadłuby nie mają LOD-u wyglądu (dalekie smugi mają tylko wraki). Z bliska awans robi taran
(`stepTrafficRamAhead` — gracz na kursie kolizyjnym) albo trafienie.

Czego proxy brakowało względem pełnego NPC:

| # | Brak | Skutek |
|---|---|---|
| 1 | Oświetlenie v2 — proxy miało klasyczny model: otoczenie 0,24 × `sunFill` (0,4 w cieniu) | w cieniu hali K-7, ringu i planety proxy prawie czarne („szare, nieżywe”); v2 ma niebo × AO niezależne od maski słońca |
| 2 | Mapa powierzchni (normalne paneli, AO, samocień) — proxy miało „poduszkę” z uv | płaski, matowy kadłub |
| 3 | Lakier (odbicie kosmosu, odblask słońca, strefy dysz) | brak niebieskawego metalu pełnych kadłubów |
| 4 | Glow okien wg v2 (`hullGlowMask`) | inne okna |
| 5 | Lampy pozycyjne okrętów (fregata 8, niszczyciel 24 + reflektor, lotniskowiec 23, holownik 7; reflektory otoczenia z obrysu) — na blasze i billboardy FG | zapas floty w halach bez świateł |
| 6 | Modele 3D: dysze SIDE (sponson + dzwon), mostek, obudowa rdzenia reaktora, wieże okrętów | „dochodzą” przy awansie |
| 7 | Cień SDF kadłuba w masce słońca, światła efektów z siatki (błyski), mapa ran | — |

Cywile (wpisy edytora `sideOnly`: frachtowce, górnicy, tankowiec…) lamp nie mają — także jako NPC po awansie.

## 2. Poprawka (zrobione: 1–5 i lampy cywilów)

- Proxy rysuje się FRAGMENTEM PEŁNEGO KADŁUBA: `hullProxyFragmentNode` (`hexShips3D.tsl.js`) = fragment skóry
  belek bez mapy ran, świateł efektów, maskowania, warpa i żaru. Haki fragmentu: `perObject.uRotCS` (obrót z
  atrybutu), `opts.cutDiscard` (luk ładowni E12 z przenikaniem wrót), `hullWarp` bez danych warpa — pominięty.
- PARTIA ZOSTAJE: jeden rysunek na rodzaj (sprite), graf raz na moduł; instancja = 20 liczb w jednym buforze z
  przeplotem (osie, luk, obrót, krycie, środek, lampy w shaderze, odblask, slot lamp, strefy, waga lakieru);
  do fragmentu 5 × vec4 + offset świata (varyingi, liczby całkowite zaokrąglone).
- WYGLĄD RODZAJU (`acquireProxyHullLook` w `hexShips3D.js`): tekstura sprite'a, mapa powierzchni i mapa kształtu
  lakieru (te same obiekty `{ value }` co kadłub NPC z tego obrazu — licznik referencji), slot `HullLightStore` z
  WŁASNYMI lampami kadłuba (payload `buildShipLightShaderPayload` na widoku z blokiem lamp edytora i skalą
  hardpointu — jak NPC po awansie) i strefami dysz MAIN / SIDE. Siatka lamp = obraz fizyki NPC w j. świata
  (`getNpcHexInitSource`). Na instancję: bramka lamp na blasze (promień ≥ 4 px, jak `SHIP_LIGHT_SHADER_MIN_PX`)
  i odblask lakieru (`hullLacquerGlintAt` — flota z daleka to nie brokat).
- BILLBOARDY LAMP pozycyjnych (ShipLights3D, FG): widoki lamp proxy (`setProxyLightViews`) — po kadłubach w tej
  samej puli (512; pełne NPC mają pierwszeństwo), od promienia 2,5 px. Pod zamkniętym dachem hali K-7 / zatoki
  (gracza w niej nie ma) bez nich: dach zasłania kadłub (kolejność passów), billboardów FG — nie
  (`RoofCover.covers(x, y)`, `src/3d/roofCover.js`; źródło `HaloRingGame.roofCovers` — obrys hali w hubie, jak
  obrys gracza). Przed tym: czerwone lampy zapasu floty prześwitywały przez dach hali.
- LAMPY CYWILÓW (decyzja orkiestratora 2026-10-28: „jakby nieżywe” — światła są tu ważne): `src/data/trafficHullLights.js` —
  biała dziobowa i rufowa na osi, czerwona lewa i zielona prawa burta przy 60% długości, frachtowce druga para przy
  20%, kadłuby robocze (górnicy, holowniki, złomiarz, tankowiec, ratownik, dron) pomarańczowe sygnalizatory; bez
  reflektorów otoczenia. Pozycje ze sprite'ów (`scripts/lampy-cywilow.mjs`: alfa > 0,5, wcięcie od krawędzi, krzyż
  ±6 px na kadłubie — lampa wiąże się z komórką siatki belek). Wpisy edytora `sideOnly` je niosą; NPC po awansie
  (`applySideOnlyLayout` → `editorLights`, gasną z komórką kadłuba i z maskowaniem), proxy z bloku lamp rodzaju.
  BUDŻET: pula billboardów `ShipLights3D` ma 512 lamp na wszystko — przy porcie ~150 cywilów w kadrze × 6 lamp; proxy
  biorą najwyżej 384 (`PROXY_LIGHT_SPRITE_BUDGET`, po pełnych NPC), przy nadmiarze zostają kadłuby największe na
  ekranie (sort klucza w tablicy typowanej, bez alokacji). Z daleka (promień < 2,5 px) bez billboardów.
- PAMIĘĆ: mapy proxy mniejsze niż NPC — powierzchnia 768 px (1,6 MB zamiast ~6 MB na kadłub), kształt lakieru
  192 px (wypiek na wątku renderu ~3 ms zamiast ~10); obraz proxy to osobny obiekt (gra nie podaje resolvera
  obrazków; worker — własne ImageBitmap), mapy się nie mieszają. Wypieki są niezależne od rozdzielczości (ułamki
  boku sprite'a) — ten sam wygląd.
- Zrzuty „po”: `.tmp/e17/po-worker/`, `.tmp/e17/po-off/` (te same nazwy co „przed”).

## 3. Przejścia

- PROXY → NPC: kadłub wygląda tak samo (A/B 12-dok, 13-reda: ta sama barwa, lakier, światło). Skóra NPC czyta mapy
  proxy tego samego kadłuba ruchu (`shipFrame`), póki własne się pieką (`mapWithFallback` w `acquireSkinBatch`) —
  bez ~0,3 s płaskiego światła po awansie. Klatka awansu: proxy w pozie NPC do zbudowania kadłuba (bez zmian).
  „Dochodzą” modele 3D (§ 1, punkt 6) i tarcza okrętu (warship: aktywacja tarczy przy spawnie).
- NPC → PROXY: NPC znikał w klatce powrotu, a encja przychodziła z kolejnym buforem workera ruchu — 1–2 klatki bez
  statku (zrzut `12-dok-powrot-001.png` „przed”). `noteTrafficReturn` / `trafficReturnPose` (`trafficBubble.js`):
  proxy w ostatniej pozie NPC do pierwszego bufora z encją, najwyżej `returnHold` 1,5 s.
- ZOSTAJE (bańka, nie obraz): statek z redy (`entity-hold` off) wraca na DOWOLNY wolny slot postoju (raz 50 tys. j.
  dalej, raz poza slotami z obrazem), kurs w podejściu po `detach` nie zawsze wraca do kandydatów bańki — znika.
  Powrót do bańki zachodzi tylko > 20 tys. j. od gracza (`releaseRadius`), więc widać to najwyżej przy najdalszym
  zoomie; narzędzie wymusza powrót w kadrze.

## 4. Koszt

Pomiar A/B (2026-10-28; worker renderu: GPU klatki, CPU aktualizacji modułów i mediana całej klatki, z proxy i bez —
`hideRender` w tym samym kadrze; A = stary kod przez `HULLFALL_AB_DIR`, B = drzewo; przebiegi przeplatane A/B/A/B,
headless Chrome 1600 × 900, ~300 encji przy Ziemi po zimnym starcie; `ruch-wyglad-gra.mjs --sceny koszt`):

| kadr | Δ CPU aktualizacji (proxy) A → B | Δ mediany klatki workera A → B | GPU klatki z proxy A / B |
|---|---|---|---|
| port Ziemi 0,045 (seria 2, 40 próbek, bez obcych procesów) | 0,30 → 0,41 ms | 0,33 → 0,65 ms | 0,48 / 0,44 ms (jedna próbka B 1,31 — szum) |
| zatoki 0,12 (seria 1) | 0,05 → −0,10 ms | ≈ 0 | 0,30 / 0,26 ms |
| hala K-7 0,2 (seria 1) | 0,06 → 0,06 ms | 0,09 → 0,10 ms | 0,78 / 0,78 ms |
| hala z bliska 0,5 (seria 2, najgorszy przypadek GPU) | 0,04 → ≈ 0 ms | 0,05 → 0,06 ms | 1,15 / 0,97 ms (szum ±0,3) |

Wnioski: GPU — bez mierzalnej różnicy (fragment pełnego kadłuba na małych proxy to mało pikseli; szum próbek
większy niż efekt). CPU workera renderu — w kadrze portu ~+0,1 ms aktualizacji i ~+0,3 ms mediany klatki (widoki
i billboardy lamp proxy, odblask na instancję, przegląd dachów hal); w kadrach zatok i hali bez różnicy.
`ruch-banka-gra.mjs --query renderWorker=1`: CPU workera 1,52 ms z proxy, 1,42 bez. Seria 1 szła częściowo obok
obcego harnessu (przebiegi 3–4) — rozrzut tego samego kodu w kadrze portu 0,07–0,89 ms; seria 2 bez obcych.
Start w workerze (`start-sync-gra.mjs --query renderWorker=1`): 0 pipeline'ów synchronicznych na starcie i po
120 krokach.

## 5. Zostaje

- Światła efektów z siatki świateł na proxy — w tym LAMPY HALI K-7 (`hallDust.js` → `grid.addWorld`): fragment proxy
  czyta je tylko w wariancie z mapą ran (`hullEffectLights`), więc zapas floty na padach jest ciemnogranatowy, a po
  awansie lotniskowiec robi się biały (największy skok przy awansie w hali; § 6.3).
- Rozlew lamp proxy na sąsiednie kadłuby (`buildNavLightClusters`, reflektory jako emitery drogowe).
- Lampy i gniazda edytora użytkownika (`hpEditor.v1` w localStorage) — proxy bierze domyślne `SHIP_EDITOR_DEFAULTS`.
- Wieże proxy stoją w spoczynku (bez celowania i odrzutu); po awansie okręt z urazą obraca je na gracza — ruch, nie skok.

## 6. E17b — modele 3D i cień na proxy (2026-10-28)

Decyzja orkiestratora: „partie modeli na proxy bliżej kamery (dysze SIDE, mostek, obudowa rdzenia, wieże, cień SDF);
dane w `src/data` albo w migawce, bez importu `src/game` w `src/3d`; awans w kadrze bez dokładania widocznych
elementów”. Każdy element proxy stoi tam, gdzie u NPC po awansie, i pojawia się od tego samego progu rozmiaru
(ten sam moduł rysuje oba). Kolejność w klatce (strona `off` i worker): `Bridge3D.update` → proxy
(`ShipProxyBatch3D.drawList`) → `updateHexShips3D` → modele 3D i wieże → reaktor — każdy element proxy wchodzi tam,
gdzie ta kolejność daje pozę tej klatki.

### 6.1 Elementy

| Element | Jak | Dane | Strażnik |
|---|---|---|---|
| Dysze SIDE (sponson + dzwon) | `setProxyNozzleSource` (hexShips3D) → `SideNozzleFrame` po `EngineVfxSystem.update`, próg `modelMinPx` | markery edytora — czyste funkcje przeniesione do `src/data/editorEngines.js` (`buildSideThrusters`; runtime NPC importuje je stamtąd) | `sideThrusters3D`, `freighterSideThrusters` |
| Obudowa rdzenia reaktora | rdzeń Z WŁASNĄ RAMĄ (`createFramedReactorCore`, źródło `setFramedReactorCoreSource` w `reactor3D.js`), stały obiekt na kurs (ziarno i fazy plazmy), rama jak `reactorCoreFrame` NPC z pozą renderu | `trafficCoreMarker`: `REACTOR_CORE_MARKERS` albo `TRAFFIC_AUTO_CORE_MARKERS` (megafrachtowiec, holownik serwisowy, fregata i niszczyciel piratów — automat liczony na prawdziwym kadłubie: `scripts/rdzenie-auto-ruchu.mjs`); barwa plazmy po fladze piratów (`FLAG_PIRATE` w polu FLAGS bloku `traffic` — bez zmiany układu) | `reactorCoreProxy` |
| Mostek | `Bridge3D.drawProxyBridges` z `ShipProxyBatch3D.end` — dopisuje instancje do partii tej klatki (raz na update); rekord z `host = null` (`pristine`: komórki pod modelem nietknięte, stały blok bufora obrażeń na kadłub), baza `proxyBridgeBasis`; okna gasną pod zamkniętym dachem (`RoofCover`) | strefa i wariant jak `attachEntityBridges` NPC (`proxyBridgeState`: fałszywa encja `{ type: id, shipFrame: id }` — megafrachtowiec dostaje wariant `sklad`) | `bridgeProxy` (punkty modelu i emitery proxy = NPC na prawdziwym kadłubie, 6 kadłubów) |
| Wieże okrętów (11 kadłubów `TRAFFIC_COMBAT_HULLS`) | grupy w `ProxyTurretFrame` (`src/3d/proxyTurretFrame.js`) → `syncTurrets` w `syncShipModels3D` (te same partie, LOD 2 px, rodziny, warstwa głębi), uchwyt stanu wież na kurs | `src/data/trafficProxyTurrets.js` — broń, pozycja, kąt spoczynku, skala i promień rekordu Turret2D, zestaw terran / pirate; liczone PRAWDZIWYM kodem gry `scripts/wieze-proxy-ruchu.mjs` (gniazda edytora, `equipNpcWeapons` ze źródła index.html, `initAutonomousWeapons` — teraz eksport `capitalAI.js`, `Turret2D.sync`) | `turretProxy` (tabela = gra, pozy rekordów jak Turret2D) |
| Cień SDF | `setProxyShadowSource` (hexShips3D) → kandydaci okluderów obok kadłubów (od największych, limit passa, kadr + 30 tys. j. — także proxy tuż poza kadrem) | siatka komórek rodzaju 15 j. ∩ alfa sprite'a (`HullShadowSdf` — jak NPC: komórki z tej alfy), warstwa szablonu na rodzaj | `reactorCoreProxy` (kandydaci), w grze `ruch-wyglad-gra.mjs` scena `port` (tryb off): 32 okludery z proxy, 1 bez |

Zrzuty proxy i NPC w tym samym przebiegu (worker, `ruch-wyglad-gra.mjs --sceny awans`): `.tmp/e17b/` — `rdzen-w`,
`mostek-w`, `wieze-w`, `cien-w` (`11-zapas` lotniskowiec na padzie K-7, `12-dok` wahadłowiec w zatoce, `13-lot`
kontenerowiec), cienie na tle redy: `cien-off/03-reda.png`. 0 pipeline'ów synchronicznych w grze (worker i strona),
jedyny błąd konsoli — brak `favicon.ico`.

### 6.2 Koszt

Pomiar A/B (2026-10-28; A = drzewo sprzed E17b przez `HULLFALL_AB_DIR` — 12 plików z 2130e523, B = drzewo; przebiegi
po kolei A/B/A/B; worker renderu, headless 1600 × 900, ~290–350 encji przy Ziemi; `ruch-wyglad-gra.mjs --sceny koszt
--kadry port,hala,halaBlisko`, 24 próbki na wariant). Δ = z proxy − bez proxy (`hideRender`) w tym samym kadrze,
średnia z dwóch przebiegów:

| kadr | Δ CPU aktualizacji A / B | Δ mediany klatki workera A / B | GPU klatki z proxy A / B |
|---|---|---|---|
| port Ziemi 0,045 | 0,38 / 0,29 ms | 0,53 / 0,50 ms | 0,69 / 0,68 ms |
| hala K-7 0,2 | 0,06 / 0,08 ms | 0,11 / 0,23 ms | 1,23 / 1,33 ms |
| hala z bliska 0,5 (zapas floty na pół ekranu) | −0,01 / 0,08 ms | −0,25 / 0,18 ms | 1,75 / 1,47 ms |

Wnioski: modele i cień proxy kosztują ~0,03–0,09 ms CPU workera w kadrach hali (mostki, wieże, rdzenie, dysze widocznych
okrętów zapasu), w kadrze portu bez mierzalnej różnicy (modele poniżej progów rozmiaru); mediana klatki i GPU — w szumie
próbek (±0,3 ms; ten sam kod w kolejnych przebiegach różni się bardziej niż A od B). Cień: w porcie proxy wypełniają limit
passa shadow shafts (32 okludery) — GPU maski słońca w szumie powyżej. 0 pipeline'ów synchronicznych (worker i strona).

### 6.3 Czego awans dalej nie wyrównuje

- Światła hali K-7 i efektów (§ 5) — lotniskowiec zapasu: proxy ciemnogranatowe, NPC biały; to oświetlenie, nie
  element, ale skok jest największy ze wszystkich.
- Mostek proxy rysuje się na wszystkich komórkach pod modelem (u NPC część modelu nad brzegiem kadłuba bez węzła
  znika) — strefy leżą na kadłubie (strażnik `trafficHullData`), różnica tylko na krawędzi.
- Wieże i lampy z edytora użytkownika (`hpEditor.v1`) — proxy domyślne.
