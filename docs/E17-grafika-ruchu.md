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

## 5. Zostaje (decyzja orkiestratora, osobne zadanie)

- Modele 3D na proxy: dysze SIDE, mostek, obudowa rdzenia, wieże okrętów (partie instancji na rodzaj modelu; dane
  edytora po stronie renderu — dziś liczy je `npcHardpointRuntime.js` w grze).
- Cień SDF proxy w masce słońca, światła efektów (błyski) na proxy, rozlew lamp proxy na sąsiednie kadłuby
  (`buildNavLightClusters`, reflektory jako emitery drogowe).
- Lampy edytora użytkownika (`hpEditor.v1` w localStorage) — proxy bierze domyślne `SHIP_EDITOR_DEFAULTS`.
