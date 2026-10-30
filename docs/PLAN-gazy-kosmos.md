# Gaz w otwartej przestrzeni — port dema `gazy-transport-webgpu.html` do Core3D (plan, 2026-10-16)

Źródło: prototyp `dema/gazy-transport-webgpu.html` (transportowana gęstość, strefy ściśliwe — `docs/AUDYT-gazy-demo-2026-10-12.md`
§ 7), przegląd „production ready?” z 2026-10-15 (lista blokerów niżej, § 2) i decyzja użytkownika z 2026-10-16:
**„Wygląd akceptuję”**. Plan dotyczy etapów 2–4 `docs/PLAN-gazy.md` w otwartej przestrzeni (pas, ring, ławice mgły).
Hale K-7 mają osobną symulację 3D (`docs/BRIEF-gaz-hali-3d.md`) — ten moduł do hal nie wchodzi.

Demo zostaje jako wzorzec wyglądu i narzędzie A/B (zrzuty tych samych kadrów, skrypty audytu z `--demo transport`).

## 1. Co przenosimy, a czego nie

| Z dema | W grze |
|---|---|
| Pole gazu 2D: okno 256 × 256 po 64 j. wokół kamery, wiry → adwekcja RK2 → MacCormack → dywergencja − cel → Jacobi 31 → rzut | **1:1** (kernele, strojenie `SIMT`), jako krok `Core3D.addFxStep` |
| Strefy ściśliwe (stożek dyszy, front wybuchu, „pług” wokół kadłuba), ciśnienie gazu κ(ρ − ρ_ref) | **1:1** (D6) |
| Pole dalekie z szumu (start okna, komórki wjeżdżające, dopływ przez brzeg, gęstość odniesienia) | ten sam szum, ale **kafelkowany, z przesunięciem liczonym w double na CPU** (świat 5–10 mln j.); obwiednia z danych świata (pole pasa, plan ringu, ławice) |
| Faktura detalu na pozycjach spoczynkowych, próbka gęstości dwusześcienna, kolumna nad bryłą z otoczenia | **1:1** |
| Mapa gazu i mapa światła (marsz ku Słońcu odcinkami) jako cele renderu co klatkę | **compute do tekstur storage o stałym rozmiarze** (rozmiar z presetu), łańcuch mipmap liczony kernelem |
| Złożenie 8 plasterków w poście (głębia sceny, MRT „fx”) | **plasterki jako płaszczyzny w passie ortho** z testem głębi — wzór płytkich płatów mgły pasa (`src/3d/asteroids/fog.js`) i warstw pyłu hal; Core3D nie ma tekstury głębi sceny ani celu „fx” |
| Światła dynamiczne: pętla 96 świateł w każdym materiale i pikselu | **siatka świateł `Core3D.fx.grid`** na wysokości plasterka (z tłumieniem przez gaz nad nim) |
| Pył: 160 tys. drobin w bezwzględnych pozycjach float32 | wg D2; jeśli zostaje — pozycje względem `Core3D.fx.origin` (`FxPoolOrigin` + kernel przesunięcia) |
| Skały-koła, 5 kół na kadłub, ring jako łuk | przeszkody z gry: obrysy kadłubów z siatki belek, statyka budowli, przekrój olbrzymów pasa, płyta ringu, jądra komet |
| Własny `WebGPURenderer`, NeutralToneMapping, bloom 0,6, FXAA, winieta, tło | **nie** — Core3D (ACES gry, bloom gry); jasności stroimy A/B na zrzutach (§ 6) |
| Okręty-pudła, ring zastępczy, kominy rozstawione ręcznie, sceny 1–3 klawiszem | **nie** — źródła i obszary z danych świata (§ 5) |

## 2. Blokery z przeglądu 2026-10-15 → gdzie naprawiane

| # | Bloker (demo) | Naprawa | Etap |
|---|---|---|---|
| 1 | Pył w bezwzględnych pozycjach float32 — przy 8 mln j. stoi; szum z bezwzględnych współrzędnych | pozycje względem `fx.origin`, pula w `FxPoolOrigin`; szum kafelkowany z przesunięciem w double | GK-1, GK-4 |
| 2 | 64 źródła bez odcinania poza oknem, kolejność dysze → wybuchy → pociski (w bitwie wybuchy wypadają) | źródła tylko z okna; budżety na rodzaj (wybuchy pierwsze, potem dysze najbliżej kamery, kominy, pociski); przekroczenie liczone w statystykach | GK-2 |
| 3 | 16 kół = 3 okręty jako przeszkody | maski obrysu z żywych węzłów belek (`hullFootprint`) — wejście przeszkód gazu wybuchów `GAS_OBST_IN` (dziś 32 kadłuby na klatkę — dla okna 16 km podnieść do 64, najbliższe kamery pierwsze) | GK-2 |
| 4 | Złożenie zakłada perspektywę prosto w dół | plasterki to płaszczyzny świata w passie ortho — z góry pionowy promień (jedna próbka mapy na plasterek jest dokładna), w kamerach 3D paralaksa wychodzi sama z geometrii | GK-3 |
| 5 | Pole 60 Hz bez interpolacji (144 Hz: 84 ze 143 klatek bez kroku) | dwie tekstury obrazu (poprzedni i bieżący krok) + przenikanie wg ułamka kroku; przy przesunięciu okna obie w nowym początku w tej samej klatce | GK-1, GK-3 |
| 6 | `kAdvect` i `kProject` na 8 / 8 buforach storage | maski kadłubów jako tekstura (nie bufor); bufor `flagB` znika — komórka stała jako znacznik w `velB.w` (dziś waga strefy ściśliwej ≤ 1, stała = 2), prędkość ciała w `velB.xy`; strażnik w teście (≤ 7 na kernel — zapas jednego) | GK-1 |
| 7 | `fbm` → `gnoise` → `hash22` — funkcje z `setLayout` wołające inne z layoutem (pułapka 35) | z layoutem tylko `gnoise` (hash wklejony), `fbm` wklejana; strażnik „ten sam graf = ten sam kod” | GK-1 |
| 8 | Zaburzenia giną po wyjściu z okna 16 km; podzielony ekran ma okno tylko przy jednym graczu | świadomie: okno przy graczu 1, poza nim pole dalekie (D5, D8) | GK-3 |
| 9 | Brak stanu gazu na CPU (chowanie się) | funkcja pola dalekiego z lustrem CPU od początku (ta sama formuła na CPU i GPU — test); rozgrywka później (D7) | GK-1, później |
| 10 | Tone mapping i bloom dema ≠ gry | strojenie albedo / jasności / gęstości A/B: zrzut dema ↔ zrzut gry tego samego kadru | GK-3, GK-9 |

Drobiazg z przeglądu: pętla świateł per materiał (~270 KB wysyłki na klatkę) znika razem z siatką świateł gry.

## 3. Architektura w grze

```
GRA (wątek główny, czyste moduły)                     RENDER (strona albo worker — ten sam kod)
src/game/spaceGasInput.js                             src/3d/spaceGas/
  obszar gazu przy kamerze (pas / ring / ławica),       spaceGasSim.js     — kernele pola (krok Core3D.addFxStep)
  wiatr, Słońce, skład → albedo,                        spaceGasMaps.js    — mapa gazu i światła (compute, mipmapy)
  źródła z danych świata (kominy, odgazowanie),         spaceGasLayer.js   — plasterki w passie ortho, rozgrzewka
  przeszkody: GAS_OBST_IN + olbrzymy, ring, komety      spaceGasDust.js    — pył (jeśli D2 = zostaje)
        │ blok migawki src/render/blocks/spaceGasBlock.js (Float64Array, stały układ)
        └────────────────────────────────────────────►  krok czyta TYLKO blok + EngineFrame (dysze) + WeaponFx
                                                        (pociski) + reżyser wybuchów (fronty, wyrzut) — dane renderu
```

- **Szew:** jak pył hal i `gasObst` (`docs/PLAN-render-worker.md` § 3.7): blok o stałym układzie w czystym module, pakowanie
  po stronie gry testowane w Node, w `src/3d/spaceGas` zero `window`, DOM i `requestIdleCallback`
  (`tests/szewRenderu.test.mjs`). Moduł działa w `?renderWorker=1` od pierwszego dnia (blok w migawce, bez gałęzi
  wyłączającej).
- **Przeszkody:** wejście `GAS_OBST_IN` już ma obrysy kadłubów z prędkością i ω, statykę hal K-7 (z polami siłowymi bram)
  i budowle misji, ale kadłuby tylko w prostokątach domen gazu — okno pola dokłada swój prostokąt do `domainRects`.
  Dochodzą: przekrój olbrzymów pasa na z = 0 (SDF w SharedArrayBuffer — jak radar), płyta ringu z koliderów
  `haloRingWorld`, obrysy jąder komet. Małe skały pasa leżą POD płaszczyzną (`zOf = −1,45 r`) — dla pola 2D nie są
  przeszkodą; zasłania je test głębi plasterków (dolne plasterki toną na skałach jak dziś płytka mgła pasa).
- **Źródła:** dysze z `EngineFrame` (płaska lista dysz klatki, moc strugi), pociski ze stanu `WeaponFx`, wybuchy i wyrzut
  z reżysera wybuchów (`__explosions` — fronty jak `blasts` dema), kominy / chłodnie / odgazowanie — z bloku (gra zna
  plan ringu i skały). Zapłon silnika (dym w domenie zapłonu) zostaje w gazie 3D wybuchów — pole 2D dostaje tylko pchnięcie.
- **Zegar:** krok 1/60 s czasu GRY (`SimClock`, pauza i sceny fabuły stoją), ≤ 2 kroki na klatkę; rozgrzanie 4× tylko przy
  wejściu w okno ze źródłami (kominy).
- **Precyzja:** róg okna i wszystkie pozycje w GPU względem `Core3D.fx.origin`; szum pola dalekiego i faktury kafelkowany
  (`fxNoise.tile2D` albo szum okresowy) z przesunięciem okresu liczonym na CPU w double (wzór chmur mgły wojny).
- **Okno:** przesuwane o całe komórki TYLKO w klatce z krokiem (lekcja drżenia z 2026-10-13); w warpie pole stoi, po
  wyjściu okno startuje z pola dalekiego.
- **Kiedy działa:** tylko przy obszarze gazu w kadrze (bramka jak `rectTouchesBelt`); poza nim 0 dispatchy i 0 rysunków.
  W hali K-7 (pod dachem) warstwa wyłączona — tam gaz hali.

## 4. Etapy

Każdy etap kończy się testami Node i jednym narzędziem w grze; zrzuty tylko z dotkniętych scen, pełny przebieg raz na
końcu toru.

**GK-1 Rdzeń pola jako moduł** (`src/3d/spaceGas/spaceGasSim.js`, bez obrazu). Kernele z dema; bufory f32, tekstury obrazu
(poprzedni + bieżący krok); okno względem `fx.origin`; maski kadłubów jako tekstura R8 (format z `GAS_OBST_IN`); pole
dalekie jako wstrzykiwana funkcja obwiedni (scena podaje swoją) z lustrem CPU; szum kafelkowany; funkcje z layoutem płaskie.
Testy: WGSL budowany w Node, liczba buforów storage ≤ 7 na kernel, uniformy ≤ 12 na etap, „ten sam graf = ten sam kod”,
lustra CPU (`farEnvCpu`, `srcShapeCpu`), reguła okna (brak przesunięcia bez kroku). Pomiar: skrypty audytu przepięte na
moduł w demie (`dema/gazy-transport-webgpu.html?modul=1` — ta sama scena, liczby jak § 7.3 audytu, bit w bit niewymagane).

**GK-2 Wejście klatki** (`src/game/spaceGasInput.js`, `src/render/blocks/spaceGasBlock.js`). Obszar i obwiednia, wiatr,
Słońce, albedo, źródła z danych świata, budżety źródeł (§ 2 pkt 2), przeszkody (`GAS_OBST_IN` + olbrzymy, ring, komety).
Testy: układ bloku, pakowanie, budżety (wybuch nie wypada przy 200 dyszach w oknie), przeszkody na rastrach z gry.

**GK-3 Obraz** (`spaceGasMaps.js`, `spaceGasLayer.js`). Mapy compute (rozmiar z presetu, bez zmiany rozmiaru przy zmianie
okna — omija pułapkę resize), N plasterków w passie ortho: dolne pod kadłubami, górne po efektach (gaz nad płaszczyzną
przygasza kadłuby i efekty — odpowiednik `Ttop` dema), dokładna całka profilu cos w paśmie plasterka, maska słońca
(`sunVisibility`), siatka świateł na wysokości plasterka, przenikanie kroków. Kamery 3D (mapa = ślad kamery na płaszczyźnie
z promieniem granicznym i zanikiem), rulon (płaszczyzny gną się same — `rulonClip`), podzielony ekran (okno przy graczu 1),
mgła wojny (post i tak kładzie się na gaz). Rozgrzewka: wpis `gaz przestrzeni` + `warm` kroku — pipeline'y synchroniczne 0.
Strojenie A/B z demem na tych samych kadrach (pas, ring, mgła; spoczynek, ciąg, wybuch).

**GK-4 Pył gazu** (wg D2). Drobiny rodzone z gęstości (przyjęcie ∝ (ρ/ρ₀)³ jak w demie), ruch z pola, światło z mapy światła
i siatki (bez pętli świateł na wierzchołek), początek przy kamerze, liczba z presetu. `SpaceDust3D` zostaje (wrażenie lotu
wszędzie); pył gazu — tylko w gazie.

**GK-5 Scena: pas asteroid** (pierwsza wg D3). Obwiednia i skład z pola pasa (`AsteroidBeltField.sampleMacro`, mapa pola
`fieldMap.js`: gęstość pyłu, udział lodu; rodziny kolizyjne → proporcje pyłu krzemianowego, siarki, lodu amoniakalnego),
odgazowanie lodowych skał gry po stronie dziennej, wyrzut z trafień w olbrzymy i z wydobycia. Gaz ZAMIAST płytkich płatów
`fog.js` (nie obok — dwie mgły); głębokie płaty tła zostają. Ośrodek światła `beltMedium` zostaje (smugi reflektorów) —
A/B, czy z gazem nie robi się podwójna mgiełka.

**GK-6 Scena: ring Jowisza.** Pas smogu przy wstędze, kominy i chłodnie z planu Fable (strefy `FZ.INDUSTRIAL`, walce kominów
w `fablePlan.js` — położenia liczy gra), każdy z fazą i wydajnością, pochodnie jako światła siatki, płyta ringu jako przeszkoda
i okluder marszu ku Słońcu. Do sprawdzenia na początku etapu: kierunek wylotu kominów względem płaszczyzny gry (w demie
wylot przeniesiono na zewnętrzną krawędź wstęgi). Ziemia (zestaw przemysłowy wokół K-7) — opcjonalnie, tym samym wzorem.

**GK-7 Scena: ławice mgły.** Obiekty świata (kształt, gęstość, skład — funkcja wspólna CPU / GPU), rozmieszczenie wg D3 / D7.
Rozgrywka (chowanie się, zbieranie) — osobny etap planu gazów (etap 4 `PLAN-gazy.md`), nie w tym porcie.

**GK-8 Opcje grafiki.** Pole `spaceGas` w `GFX_SETTINGS` (`src/game/graphicsQuality.js`): Wył. / Niska / Wysoka / Ultra →
okno (128 / 256 / 256–384 wg D5), rozmiar map (0,4 / 0,6 / 0,8 bufora), plasterki (4 / 8 / 8), pył (0 / 80 / 160 tys.).
Zmiana okna przebudowuje kernele (stała w kodzie) — przy starcie albo pod kurtyną z rozgrzewką; reszta na żywo.
„Wysoka” = wartości dema (strażnik w `tests/graphicsQuality.test.mjs`).

**GK-9 Odbiór.** Narzędzie `node scripts/webgpu/gaz-kosmos-gra.mjs` (pas przy Atlasie, lot, ciąg w miejscu, wybuch, bitwa
40 × 40, zoomy, kamery 3D, podzielony ekran, warp w pas i z pasa, zmiana rozmiaru okna i presetu, `?renderWorker=1`):
- fizyka jak w prototypie (§ 7.3 audytu): kanał po przelocie zamyka się dopływem (minimum przekroju ≤ 0,15 boków po 17 s,
  dopływ > 0), gaz nie przechodzi przez olbrzyma (v za przeszkodą ≈ 0), dywergencja / prędkość pola nieściśliwego ≤ 0,02,
  pył ≥ 2× średniej mapy w pasie;
- koszt (RTX 5080, 1600 × 900, Wysoka): ≤ 1 ms GPU w polu gazu (pole ~0,15, mapy ~0,3, plasterki ≤ 0,5, pył ~0,05),
  0 poza obszarami gazu; bitwa — budżet źródeł nie rośnie z liczbą okrętów;
- pipeline'y synchroniczne 0, błędy konsoli 0, przy 8 mln j. drobiny i gaz bez drżenia (`drzenie-gra.mjs`), 144 Hz bez
  skoków (pomiar jak `gazy-transport-drzenie.mjs`);
- tryb worker: obraz jak w `off` (zrzuty obok siebie);
- wygląd: zrzuty dema ↔ gry tych samych kadrów — ocena użytkownika.

Kolejność: GK-1 → GK-2 → GK-3 (+ GK-4 wg D2) → GK-5 → GK-8 → GK-9 dla pasa; GK-6 i GK-7 jako kolejne tory po odbiorze pasa.
AGENTS.md dostaje sekcję modułu przy GK-5 (pierwsza scena w grze).

## 5. Decyzje dla użytkownika

D1–D6 z audytu (§ 6 i § 7.5), uzupełnione o to, co wyszło z prototypu i przeglądu. Przy każdej — rekomendacja.

- **D1. Jeden silnik dla gazów w otwartej przestrzeni?** Pas, ring i ławice na jednym polu 2D z transportem (ten moduł);
  hale K-7 osobno (3D, decyzja z 2026-10-12). Rekomendacja: **tak**. Dawny moduł hal 2D (`src/3d/gasField/`) nie jest
  bazą — rdzeniem są kernele prototypu (strefy ściśliwe, pole dalekie, przesuwane okno).
- **D2. Drobiny pyłu w gazie: zostają czy tylko faktura?** W prototypie pył rodzi się z gęstości (5,2× gęściej w gazie niż
  średnio w pasie). Gra ma już `SpaceDust3D` (wrażenie lotu wszędzie). Rekomendacja: **zostają, ale mniej** — 80 tys. na
  Wysokiej, 160 tys. na Ultra, 0 na Niskiej; `SpaceDust3D` bez zmian.
- **D3. Kolejność scen.** Rekomendacja: **pas → ring Jowisza → ławice mgły**. Pas jest tam, gdzie gracz lata najczęściej,
  i zastępuje istniejącą płytką mgłę (jedna mgła zamiast dwóch). Ring dokłada fabryki. Ławice potrzebują rozmieszczenia
  w świecie i wiążą się z rozgrywką (chowanie się).
- **D4. Wiatr jako prawdziwy przepływ?** W prototypie wiatr to prędkość tła — ławice, dym i dziury płyną razem. Rekomendacja:
  **tak** (tak działa zaakceptowany wygląd). W pasie wiatr wzdłuż orbity, przy ringu — wzdłuż wstęgi, odgazowanie od Słońca.
- **D5. Komórka i okno.** Rekomendacja: **komórka 64 j. stała** (strojenie jest w jednostkach komórek — inna komórka to
  przestrojenie), okno 256 (16 km) na Wysokiej, 128 (8 km) na Niskiej, 384 (24 km) na Ultra. Większe okno = więcej kadru
  z ruchem gazu przy oddaleniu; poza oknem pole dalekie bez ruchu (dziś domyślny kadr ~9 × 5 km mieści się w oknie 16 km).
- **D6. Strefy ściśliwe zamiast źródła objętości dysz?** W polu 2D bez ścian źródło objętości kumulowało się bez końca
  (6 s ciągu = ~3 km² wypchniętej mgły). Rekomendacja: **tak, strefy ściśliwe** — tak działa zaakceptowany wygląd
  (pusty pas za dyszą, wał po bokach). Źródło objętości zostaje w halach.

Nowe, mają domyślną odpowiedź (do potwierdzenia przy okazji):

- **D7. Rozgrywka gazu** (chowanie się, wykrywanie, zbieranie) — osobny etap. Domyślnie: rozstrzyga gra na CPU z pola
  dalekiego (ta sama funkcja co GPU, bez opóźnienia); kanały i dziury po przelotach tylko w obrazie. Alternatywa: odczyt
  gęstości z GPU kanałem zwrotnym (opóźnienie 1–3 klatki, kanał po przelocie odsłania okręt naprawdę).
- **D8. Ślady okrętów ukrytych mgłą wojny.** Kadłuby i dysze okrętów spoza wzroku gracza też rozpychają gaz — kanał zdradza
  okręt („kanał zdradza okręt” z `PLAN-gazy.md`), ale pod nakładką mgły wojny widać go słabo. Domyślnie: **zostaje** (tak
  działa fizyka). Alternatywa: okręty ukryte nie są przeszkodą ani źródłem.

**Decyzje użytkownika 2026-10-22: rekomendacje D1–D8 przyjęte** („jedziemy, rekomendacje zaakceptowane”):

- jeden silnik w otwartej przestrzeni;
- pył zostaje (80 tys. drobin na Wysokiej);
- kolejność scen: pas → ring → ławice;
- wiatr jako przepływ;
- komórka 64 j., okno 128 / 256 / 384 komórek;
- strefy ściśliwe;
- rozgrywka gazu na CPU z pola dalekiego;
- kanały okrętów ukrytych mgłą wojny zostają.

Port prowadzi sesja E11 planu ekonomii (`docs/PLAN-ekonomia-rynki.md`).

## 6. Postęp

- **GK-1 (2026-10-22):** rdzeń pola `src/3d/spaceGas/spaceGasSim.js` i szum `spaceGasNoise.js`, testy `tests/spaceGas.test.mjs`.
  - Kernele są 1:1 z dema.
  - Układ: świat gry względem kotwicy sceny, liczony w double na CPU. Bufory trzymają tylko stan komórek, więc kernel przesunięcia początku pul nie jest potrzebny.
  - Bufor `flagB` zastąpił znacznik w `velB.w` (stała = 2). `kAdvect` i `kProject` mają po 7 buforów storage.
  - Kadłuby wchodzą jako maski obrysu z rekordów `GAS_HULL_REC`; „pług” liczy się od prostokąta maski.
  - Obraz ma dwie pary tekstur zapisywane na zmianę, każdą z własnym rogiem okna. Przenikanie idzie według ułamka kroku.
  - Szum: z layoutem jest tylko `gnoise`, a `fbm` jest wklejana (pułapka 35).
- **GK-2, GK-3 i GK-5, część pierwsza (2026-10-22):** gaz pasa w grze (commit `ecd3d672`).
  - Wejście gry: `src/game/spaceGasInput.js` → blok `spaceGas`. Kotwica to Słońce. Obwiednia 32 × 32 bierze się z `sampleMacro` (wzór płatów mgły × `hole` + `gas` z E3) i przesuwa się przyrostowo. Dochodzi do tego odgazowanie lodowych skał.
  - Render: `src/3d/spaceGas/spaceGas.js` (dysze `EngineFrame`, kadłuby z `GAS_OBST_IN`, gdy okno pola jest w prostokątach domen), mapy compute i warstwa.
  - Odstępstwo od planu: zamiast 8 plasterków są **dwie połowy warstwy** (dolna pod kadłubami, górna po efektach). W kamerze z góry to złożenie dema z głębią. Plasterki z paralaksą dla kamer 3D przyjdą później.
  - Pomiar (`scripts/webgpu/gaz-kosmos-gra.mjs`, RTX, 1600 × 900): w trybach off i worker obraz jest zgodny, pipeline'ów sync 0, błędów 0. GPU: render +0,08 ms, compute +0,16 ms.
- **GK-8, część pierwsza:** opcja „Gazy i mgły w pasie asteroid” (Wł. / Wył., preset Niska — Wył.).
- **Do zrobienia:**
  - GK-4: pył gazu (D2: 80 tys.).
  - GK-5, część druga:
    - przekroje olbrzymów pasa jako przeszkody;
    - wybuchy (reżyser) i pociski jako źródła;
    - gaz zamiast płytkich płatów `fog.js` (dziś są obie mgły) — po scaleniu E3, które zmienia `fog.js`.
  - GK-8, część druga: okno 128 / 256 / 384 i mapy z presetu.
  - GK-6 (ring Jowisza), GK-7 (ławice mgły), GK-9 (odbiór).
  - Kamery 3D: plasterki z paralaksą i mipmapy map.
- **GK-6 (2026-10-23): scena ringu Jowisza w budowie** (sesja ring-jowisza-budowa; ring = archetyp BUDOWA).
  - Pole `src/game/ringGasField.js` z API pola pasa: kotwica w środku Jowisza, obwiednia wokół obręczy, fronty budowy
    gęściej, hale K-7 rzadziej, strugi odgazowania z frontów, dryf wzdłuż obręczy.
  - Płyta wysp w rastrze przeszkód z kolidera gry (gaz płynie przerwami); kierunek ku Słońcu niezależny od kotwicy.
  - Wygląd sceny w uniformach (`createRingGasLook`) — bez nowych pipeline'ów; światła spawania ringu w siatce świateł.
  - Kominy i chłodnie z planu Fable (pierwotny zakres GK-6) odpadły razem z Fable; okluder ringu w marszu ku Słońcu — nie.
- **GK-4 (2026-10-22): pył gazu** (`src/3d/spaceGas/spaceGasDust.js`).
  - 80 tys. drobin rodzonych z gęstości (ρ/ρ₀)³, płynących z gazem.
  - Pozycje względem rogu okna pola, przesuwane razem z oknem — bez float32 przy 1,6 mln j.
  - Kwad instancji w passie ortho (renderOrder −40).
  - Światło: mapa światła, siatka świateł i maska słońca.
  - W grze w trybach off i worker: pipeline'ów sync 0, błędów 0.
  - GPU z pyłem: render +0,13 ms, compute +0,17 ms.
- **GK-5, część druga (2026-10-22, zlecenie orkiestratora po decyzjach użytkownika):**
  - Olbrzymy pasa jako przeszkody: raster przekroju 128 × 128 z SDF gry w teksturze R8 (komórki stałe i zasłona strug).
  - Wybuchy (`GameBlasts`: front + wyrzut, budżet przed dyszami) i pociski (`bullets`) jako źródła.
  - JEDNA MGŁA: płytkie płaty `fog.js` gasną pod gazem (`SpaceGasCover`).
  - Pył ławicy siarki o 30% ciemniejszy.
  - Rzednięcie w wyrwach E3 sprawdzone testem na prawdziwym polu: w środku wyrwy obwiednia < 5%, poza nią bez zmian; źródło `gas` pola dokłada gęstość.
  - Pomiar: off i worker — pipeline'ów sync 0, błędów 0. GPU: render +0,10 ms, compute +0,18 ms.
- **Drżenie i oddalenie (2026-10-29, zgłoszenie z 5120 × 1440 @ 240 Hz w trybie worker: „gazy i mgła w polu asteroid mocno drżą”, „przy oddaleniu nie widać wypychania, ogon szybko znika”).**
  - Przyczyny zmierzone przed poprawkami (`scripts/webgpu/gpu-pas-gra.mjs`, headless, preset Wysoka, `.tmp/gpu-pas-baza`):
    - pole w workerze szło w 69–86% tempa (utrata czasu 14–31%, 41–52 kroków / s zamiast 60; Ultra 40–48%): dt jednej strony gubił czas stron pominiętych przez workera, a klatka `Core3D.fx` nie szła w 1–16% renderów (drugi render w tym samym takcie rAF workera);
    - faza kroku pola wobec fizyki losowa (R 0,02–0,16), zegar treści gazu wobec kadłubów przy złożeniach rozjechany średnio o 0,9–2,0 ms;
    - 100% klatek z ruchem zoomu przepróbkowywało mapy o > ¼ teksla (siatka tekseli od Słońca, teksel ciągły z zoomu);
    - okno pola przy kamerze: przy zoomie 0,15 tylna krawędź okna 3 km (459 px) za rufą, przy 0,0667 okręt 12 km od środka okna — poza nim;
    - zanik gazu na 32:9 od zoomu 0,064 (0,17 przy minZoom), wracały płytkie płaty mgły.
  - Poprawki (reguła `gaz-przestrzeni`): zegar gry w wejściu (`simTime` / `renderTime`) — przyrost czasu renderu od ostatniej przetworzonej strony, krok pola = krok fizyki, obraz w chwili renderu kadłubów; klatka `Core3D.fx` raz na stronę w workerze (`Core3D.fxFrameKey`); ciśnienie przenoszone przy przesunięciu okna; drabina teksla map i kolumny ośrodka pasa (2^(j / 8), histereza); okno pola przy okręcie, pod śladem, przycięte do kadru; kamera bez wstrząsu dla okna; siatka obwiedni obejmująca okno i mapę kadru; zanik niezależny od proporcji kadru; miękki brzeg pyłu przy brzegu okna; dysze spoza okna poza budżetem źródeł.
  - Pomiar po (`.tmp/gpu-pas-po`, ten sam przebieg narzędzia): utrata czasu 0 we wszystkich oknach, 57–60 kroków / s, faza R = 1, zegar treści gazu wobec kadłubów 0–0,33 ms; klatki efektów pominięte 0; przepróbkowanie map przy ząbkach kółka 2,5% klatek z ruchem zoomu (stopnie drabiny; A/B bez drabiny — 100%), ośrodka pasa 1,9% (bez drabiny 27%); okręt w oknie przy każdym zoomie, tylna krawędź okna ~13 km za rufą (zoom 0,15 — 1944 px, 0,0667 — 868 px, 0,035 — 454 px); zanik przy minZoom 1 (płytkie płaty mgły schowane); przesunięcia okna w locie 6–11 / s (było 10–20 / s). A/B w tym samym przebiegu: dawny zegar (S0) pod obciążeniem karty — utrata 81%, 11,8 kroków / s, R 0,08 (nowy 0 / 57 / 1); dawne okno (S1) przy zoomie 0,0667 — okręt 12 km od środka okna, poza nim (nowe: w oknie, krawędź 12,7 km za rufą).
  - Koszt GPU (okna bez obcego obciążenia — postój i przelot przy zoomie 0,341 i 0,15): compute gazu 0,16–0,23 ms (było 0,17–0,25 ms), obraz / s w granicach szumu (134–141 wobec 130–143). Okna przelotu przy oddaleniu (0,0667, 0,035) i A/B S1 / S3 (`.tmp/gpu-pas-po2`) szły równolegle z harnessem innej sesji (karta 14–15 GB, 52–111 obrazów / s) — ich czasy GPU nie są porównywalne, różnice A/B w granicach szumu. Przy oddaleniu okręt i jego dysze są teraz w oknie pola (dawniej poza nim), więc kernele liczą kadłub i strugę jak przy zbliżeniu.
  - Rzednięcie okna na postoju (`--rzedniecie 60`, zoom 0,1, okręt trzymany): średnie ρ / ρ_ref w głębi okna (≥ 32 komórki od brzegu) 0,80 po 5 s, 0,77 po 30 s, 0,72 po 60 s; przy brzegu (dopływ pola dalekiego) 0,99 → 0,93 → 0,91. To zachowanie pola sprzed poprawek (kernele dema): przy oddaleniu okno mniejsze od kadru może się odcinać jako rzadszy prostokąt z miękkim brzegiem 655 j. Poprawka (zanik tylko w próżni albo powolne dociąganie do pola dalekiego) zmienia gęstość w czasie — czeka na decyzję.
  - Zostaje do decyzji użytkownika: dłuższa pamięć faktury (`sim.tune.restRelax` 0,35 → 0,12–0,15 — „wir” we włóknach dłużej), mapy w proporcjach kadru (1086 × 305 przy 32:9 — ta sama liczba tekseli), faktura przy oddaleniu (wcześniejszy zanik drobnej oktawy), minimalny rozmiar drobin pyłu na ekranie, okno w walce (między okrętem a kamerą — okręty wroga przed dziobem przy oddaleniu dostają pole dalekie), zanik kanałów tylko w próżni.
  - Koszt doganiania: pod obciążeniem karty worker pomija strony, a pole dogania kroki fizyki — do `SPACE_GAS_MAX_SUB` (2) kroków na przetworzoną stronę (57–60 kroków / s wobec 11,8 dawnego zegara w S0), więc compute gazu rośnie właśnie wtedy, gdy kolejka GPU jest pełna; sufit ogranicza dokładkę do dwóch kroków na stronę, przy rzadszych stronach pole traci resztę czasu.
- **Poprawki po przeglądzie krytycznym zmian „drżenie i oddalenie” (2026-10-29; testy Node, bez pomiaru GPU):**
  - Krok pola z CAŁKOWITEGO numeru kroku fizyki (`SPACE_GAS_IN.physTick` / `physHz` = `physicsTickId` / `PHYS_HZ`), chwila obrazu z alfy renderu (1 − (sim − render) · hz). Dawne ⌊`SimClock.sim` · 60 + 1e-6⌋ dryfowało z sumą 1/60 (+1,1e-6 po 1 h, −1,06e-6 przy 7000 s, −1,4e-5 po 6 h): od kroku 415 676 (~1 h 55 min gry) krok wychodził o jeden za mały na stałe (w każdym kroku do 6 h — sprawdzone w Node) — obraz stał w ostatnim kroku (wagi 1 1 1 1 zamiast 0, ¼, ½, ¾ przy 240 Hz), gaz skakał co krok fizyki. Przy `?physHz=120` ułamek zakładał fizykę 60 Hz (pół kroku pola postoju, skok o pół kroku) — teraz obraz idzie stale o krok fizyki (1/120 s) za kadłubami. Test na prawdziwym `SimClock` (0 s, 7000 s, 6 h; 60 / 120 / 240 Hz) z mutacją dawnego wyrażenia pada dla 7000 s i 6 h przy 60 Hz i dla każdego czasu przy 120 / 240 Hz.
  - Miękki brzeg okna (4% boku = 655 j., `SPACE_GAS_WINDOW_EDGE` — ta sama stała co waga map `kw` i zanik pyłu) poza mapą kadru: luz środka okna max(0, pół okna − brzeg − komórka − pół mapy, pół mapy − pół okna). Wejście brzegu w kadr od strony lotu (1400 j/s, kamera 0,15 pół kadru przed okrętem) przed / po: 5120 × 1440 zoom 0,341 — 55 j. (19 px) / 0, 0,512 — 255 j. (131 px) / 0, 0,682 — 355 j. (242 px) / 0, 0,77 — 383 j. (295 px) / 0; 1920 × 1080 przy domyślnym kadrze w locie pionowym — 318 j. (41 px) / 0. Okno dalej schodzi pod ślad przy zbliżeniu (0,512–0,9: 2,1–4,4 km za kamerą, było 2,8–4,6 km), przy domyślnym kadrze 5120 × 1440 stoi w osi lotu przy kamerze.
  - Wyłączenie gazu przy oddaleniu w grze z tego samego pół kadru co zanik w renderze (`spaceGasViewHalf`, `spaceGasLayout.js`): na 5120 × 1440 gra cięła gaz przy zoomie < 0,0284 z zaniku 0,873 (kadr przylotu z warpa — płaty mgły wracały w jednej klatce, pole startowało od nowa); teraz obraz gaśnie do zera przy 0,016, a gra wyłącza pole przy 0,0142.
  - Pudło dyszy w budżecie źródeł z zasięgiem kernela w poprzek (2,6 × szerokość końca stożka, `SPACE_GAS_CONE_REACH` wspólne z kernelem i lustrem) — dysza do ~1,6 szerokości obok okna pcha komórki przy jego brzegu (strefa ściśliwa), a była pomijana.
  - Przesunięcie okna pod ślad od zera przy wyłączonym gazie (skok warpa — po przylocie okno stało do 4 km za okrętem w kierunku sprzed skoku przez ~6 s) i przy skoku okrętu dalej niż pół okna między klatkami (teleport, przesiadka na inny okręt).
- **Drugi przegląd i pomiar w grze po poprawkach (2026-10-29):**
  - Przegląd zatwierdził poprawki; dopisane jego uwagi: zapas na drogę okrętu w dwóch krokach pola w przycięciu okna (2 · |v| / 60 — render przesuwa okno tylko w kroku pola, a obraz przenika poprzedni krok; bez tego w hipercruisie Mk II–III waga okna na brzegu kadru od strony lotu spadała do 0,44–0,93), skok okrętu w czasie bez fokusu (kamera fabuły przy zamrożonym świecie, RTS) też zeruje przesunięcie pod ślad. Testy z mutacją dawnego kodu.
  - Pomiar (`scripts/webgpu/gpu-pas-gra.mjs`, headless z taktem monitora, tryb worker, `.tmp/gpu-pas-po-poprawki`): kroki pola 60,1 / s, faza R = 1, utrata czasu 0, waga przenikania = alfa renderu (różnica 0). Brzeg okna przy zoomie 0,512–0,77 (5120 × 1440, przelot 1400 i 507 j/s) ≥ 226 j. poza kadrem, waga okna na brzegu kadru 1. Domyślny kadr (5120 × 1440 zoom 0,341, 1920 × 1080 zoom 0,128 — okno przy kamerze): pas do ~68 j. w kadrze od strony +x (położenie okna na siatce komórek + ruch od kroku pola), waga okna na brzegu kadru ≥ 0,986, na zrzutach bez szwu — tak samo jak przed oknem przy okręcie. Progi zaniku i wyłączenia gazu przy oddaleniu (przeskalowane × 0,3 — rampy poniżej minZoom 0,035 nie da się zrobić z eval kamery): obraz gaśnie do 0 przy oczekiwanym zoomie, gra wyłącza gaz przy obrazie 0, bez cięcia i bez powrotu płatów mgły. Długiej sesji w grze nie da się ustawić (licznik kroków fizyki bez haka dev) — pokrywa ją test Node na prawdziwym `SimClock`.
- **Drżenie przy zoomie i przy oddaleniu (2026-10-29 wieczór; zgłoszenie z 5120 × 1440 @ 240 Hz, worker, Ultra: „drżenie gazów przy poruszaniu kamerą zoom in / out”, „przybliżona kamera OK, oddalona — gazy drżą”).**
  - Przyczyny (dochodzenia w Node na prawdziwym kodzie i lustrach CPU, baza w grze `gpu-pas-gra.mjs --drzenie`, `.tmp/drzenie-baza*`):
    - MACIERZE (główna, znaleziona przy poprawkach): Core3D liczy macierze sceny raz na klatkę PRZED krokami `Core3D.fx` (`core3d.js` `render()`: `_syncSceneMatrices` → `_runFxFrame`), a krok gazu przestawiał warstwy i pył po tej chwili bez odświeżenia — klatka zmiany rysowała nową treść map starą macierzą. Na stopniu drabiny teksla obraz gazu w skali o 9% innej (w pauzie klatka po stopniu odstawała od obu sąsiadów: 13–31% pikseli > 4/255, następna wracała), przy przesunięciu środka mapy o teksel gaz o teksel obok, pył przy przesunięciu okna o komórkę. Pas, mgła, olbrzymy i bronie odświeżają swoje macierze w kroku same; przegląd poprawek znalazł dwa kroki z tym samym błędem poza gazem — opływ hipercruise'u (`hyperFlow.js`, krok „hipercruise: opływ”: siatka przy statku co klatkę, rysowana klatkę za nim — 83–167 j. przy 20–40 tys. j/s) i przelot NEA (`neaFlyby3D.js`: grupa na początku pul, skała obok na klatce przeskoku początku) — oba odświeżają macierz od tej poprawki (`updateMatrixWorld()` po zmianie pozycji). Pula roju przeładunkowego przestawia siatki przed `Core3D.render` (`portCargo3D.update` → `pool.update`), jej krok tylko liczy symulację — ten błąd jej nie dotyczy. Zasada przekrojowa: AGENTS.md (haki „Obraz i render”).
    - ALIASING MAPY: stała liczba tekseli; przy oddaleniu teksel (dawniej 76–215 j. w osi x — mapa 768 × 432 rozciągnięta na 32:9, teksel 7,2 × 3,6 px) przerasta komórkę pola, progi pola dalekiego (fbm do 250–325 j.) i grzbiety faktury (110–160 j.); jedna próbka w środku teksla i odczyt dwuliniowy — każdy stopień drabiny przestawiał wzór (lustro CPU `scripts/gazZoomSonda.mjs`: 4,4% / 10,4% pikseli > 4/255 przy zoomie 0,05 / 0,035, maks 29 / 45).
    - PYŁ: drobiny 5,8–13 j. mają przy oddaleniu 0,2–1,6 px bufora; raster z MSAA 4 i cieniowaniem w środku piksela — energia drobiny w obrazie skakała o 85–100% na klatkę przy zoomie 0,1–0,0667 (iskry 1 px), a średnio gubił energię drobin < 1 px (0,82 / 0,50 / 0,03 energii przy zoomie 0,1 / 0,0667 / 0,035).
    - KROK SIATKI OBWIEDNI raz na oktawę zoomu — całe pole dalekie z siatki dwa razy rzadszej w jednej klatce.
    - Drobne: wygaszona faktura szła do celów, które nie są średnimi kanałów — barwa „oddychała” przy zoomie (siarka +12%, lód −16% przy minZoom).
  - Poprawki (reguła `gaz-przestrzeni`, przełączniki A/B w `SpaceGas.tune`): `matrixSync` (macierze grupy warstw i pyłu w kroku); `mapTaps` (2 / 4 próbki na teksel przy tekslu > 64 / 150 j.; zbliżenie bit w bit jak dawniej); `layerCubic` (odczyt B-spline mapy gazu w warstwie przy tekslu > `layerCubicAt` 40 j.); `mapAspect` (mapy w proporcjach kadru: 32:9 — 1086 × 306, teksel kwadratowy, ta sama liczba tekseli; przy budowie, A/B `?gazMapa=stara`); `envBlend` (stara siatka obwiedni gaśnie w 0,35 s zegara efektów); `lodMean` (średnie kanałów faktury — po przeglądzie DOMYŚLNIE WYŁ.: przy oddaleniu zmienia barwę gazu, siarka −13%, lód +25%, wyrzut −30%, a gasi tylko powolny dryf barwy, nie drżenie; czeka na decyzję użytkownika); `dustMinPx` 2,5 + `dustFadePx` [0,4; 1,2] (bok drobiny ≥ 2,5 px bufora z zachowaniem energii, zanik drobin < 1 px oddaje dawną średnią jasność — po przeglądzie tylko z MSAA celu sceny: bez MSAA dawny raster był nieobciążony i zanik ściemniał pył do 0,50 / 0,19 / 0,02 dawnej jasności przy zoomie 0,0667 / 0,05 / 0,035). Bok 2 px odrzucony: w tym samym rastrze energia wciąż skacze o 14–18% na klatkę, a pył przy oddaleniu jaśniejszy o 15–40% (bez zaniku — do 4×).
  - Lustro CPU skoku na stopniu (pole dalekie, 5120 × 1440, % pikseli > 4/255 / maks): zoom 0,05 — dawniej 4,41% / 29, 4 próbki 1,83% / 25, 4 próbki + B-spline 0,11% / 8,5; zoom 0,035 — 10,38% / 45, 4,91% / 35, 0,78% / 12; z mapą 1086 × 306: 0,34% / 8. Zbliżenie 0,341: 0%.
  - Pomiar w grze (headless z taktem monitora, Ultra, worker; warianty dawnego zachowania w tym samym przebiegu, `dawne` = wszystkie przełączniki poza `mapAspect`, który jest przy budowie):
    - zoom na żywo (`.tmp/drzenie-po1`; rampa 0,12 → 0,06 i 0,06 → 0,035 w 1,5 s, kolejne strony bez przerw, różnica po usunięciu skali; dwa przebiegi): stopień map przy zoomie 0,113 — nowe 0,17–0,19% pikseli > 4/255 (rms 0,49–0,52 poziomu) w lewym wycinku, 0,02% w środkowym, 0,001% w prawym; dawne 48–52% (rms 18,6–19,6), 6–9%, 46–56%. Przy 0,056 — nowe 0,003–0,017%, dawne 15–20%. Ząbki kółka: 3,5 stopnia map na ząbek (osie kwadratowego teksla przeskakują w różnych klatkach; dawniej 2,2 — razem) — każdy na poziomie szumu.
    - pauza (pasma 29 kroków × 1/1,0037): stopień map w środku pasma 0,0398, środkowy wycinek — nowe 0,001–0,8%, dawne 5–33%, bez samej poprawki macierzy 21–32%; mapa różnic nowego stopnia prawie czarna (dawniej plamy całych ławic). Pierwsza para pasma po skoku zoomu o 16% z poprzedniego pasma odstaje w obu wersjach (6–7% nowe, 7–32% dawne) — przejściowe po skoku, którego sprężyna zoomu w grze nie robi. W pauzie przenikanie obwiedni (0,35 s zegara efektów) mija w 1–2 krokach narzędzia — jego zysk widać tylko na żywo.
    - oddalenie w locie z ciągiem (`.tmp/drzenie-po2`, 600 j/s, 40 kolejnych stron, kompensacja kamery): zoom 0,0667, tylne wnętrze okna (wycinek C) — nowe rms 0,33 poziomu, 0% pikseli > 4/255, 0 igieł / Mpx; dawny pył 0,87 / 1,07% / 1549, wszystko dawne 0,94 / 1,20% / 1627. Zoom 0,1 — nowe 0,44 / 0,06% / 1,8; dawny pył 1,03 / 1,67% / 1655; dawne 1,22 / 2,32% / 1920. Zoom 0,035 — 0 / 0. Środek okna przy okręcie (A, 0,1, druga różnica w czasie) — igły 6 / Mpx wobec 430–700.
    - przełączenie odczytu B-spline (teksel z drabiny > 40 j. — stopień przy zoomie ~0,134 na 5120 × 1440, `.tmp/drzenie-po3`): w pauzie środkowy wycinek 0,002% pikseli > 4/255 (maks 4,9), boczne na poziomie par bez zdarzeń; na żywo (rampy 0,17 → 0,11 i 0,15 → 0,12) stopnie map 0,03–0,7% wobec 40–44% dawniej (rms 0,6–0,8 wobec 6,3–7,4).
    - nieruchomy kadr (`--zrzutyAB`, `.tmp/drzenie-po2/zrzuty`, pauza, wobec pary kontrolnej nowe ↔ nowe po 1,5 s): pył — bez mierzalnej zmiany przy każdym zoomie; próbki + B-spline — +0,07 (0,0667) i +0,14 (0,035) średniego |Δ| luminancji ponad szum pauzy; średnie faktury — +0,09 (0,035); zbliżenie — w szumie.
  - Koszt (`--ab`, Ultra, Atlas trzymany z ciągiem, okna 3,5 s × 2 wobec sąsiednich okien bazy): zoom 0,035 (4 próbki + B-spline) — compute gazu +0,33–0,45 ms (0,57 → 0,88–0,92), render +0,1–0,15 ms, obraz / s 141 → 136 (−4%, karta 100%); zbliżenie (B-spline, teraz wyłączony przy tekslu ≤ 40 j.) — render +0,1–0,2 ms (−1% obrazów / s); pył ≈ 0; pipeline'y sync 0 (strona i worker).
  - Zostaje: przy oddaleniu w hipercruisie drobiny skaczą 5–24 px na klatkę (rozciągnięcie wzdłuż prędkości albo zanik z prędkością — osobna decyzja); pas brzegu okna (`kw`) stoi na siatce komórek — piła 63 j. wobec okrętu (2,8–7,9 px przy oddaleniu, mały kontrast; pomiar kontrastu w grze nie był robiony); ośrodek pasa (`volumetrics.js`, nie ten obszar) — szum bazowy kolumny nie jest ograniczony pasmem (kolumna > 54 j. przy zoomie < 0,2 — aliasing przy stopniach kolumny).
  - Po przeglądzie (2026-10-29): kernele map (`kGas`, `kLight`) wracają przy `instanceIndex` ≥ W · H — three r183 puszcza ceil(W · H / 64) grup bez sprawdzenia liczby, a mapa 32:9 (1086 × 306 = 332 316 tekseli) miała 36 wątków ponad, piszących wiersz j = H (poza teksturą: zapis odrzucony albo przycięty na ostatni wiersz — w marginesie mapy poza kadrem); `lodMean` domyślnie wył. i zanik pyłu tylko z MSAA (wyżej, „Poprawki”); macierze opływu hipercruise'u i przelotu NEA w kroku (wyżej, „MACIERZE”). Zmiany po przeglądzie nie przeszły jeszcze przebiegu na GPU.
- **Pomiar w grze po poprawkach i domyślne (2026-10-30; drzewo po przeglądzie, siedem przebiegów headless po kolei, worker, 5120 × 1440 — liczby: `docs/AUDYT-drzenie-swiatel-2026-10-29.md` § 6).**
  - Wniosek: drżenie przy zoomie i oddaleniu usuwa odświeżanie macierzy warstw i pyłu w kroku (`matrixSync`) i najmniejszy bok drobiny pyłu (`dustMinPx`); rozmiar mapy i próbki na teksel go nie zmieniają — stopnie map na żywo ≤ 0,8% pikseli > 4/255 dla każdej mapy (dawniej 13–56%), lot przy oddaleniu ≤ 0,007%, igły pyłu przy oddaleniu 674–1735 / Mpx → 0. Render: 0 pipeline'ów synchronicznych; compute: 1 na sesję — pieczenie światła pierwszego olbrzyma pasa (`GiantView.bake`, sprzed tych zmian).
  - Domyślne od 2026-10-30: mapa bazowa 768 × 432 przy każdym kadrze (`mapAspect` false — koszt jak mapy z kadru, teksel pionowy przy domyślnym zoomie 11,3 j. zamiast 16 j., ~40% mniej stopni drabiny (53 wobec 87 na 24 ząbki)); mapy w proporcjach kadru zostają jako A/B (`?gazMapa=proporcje` — 1086 × 306 na 32:9, `?gazMapa=szeroka` — 1536 × 432, opcja jakości: compute map +0,07–0,15 ms); jedna próbka na teksel (`mapTaps` 1 — 4 próbki kosztowały 0,48 ms compute przy największym oddaleniu, drżenia nie zmieniały); B-spline w warstwie zostaje wł.; zanik drobin pyłu [0,3; 1,2] px (było [0,4; 1,2] — na Wysokiej pył przy oddaleniu 17–36% ciemniejszy niż dawniej, [0,3; 1,2] — ±5% z interpolacji kalibracji).
  - Po przeglądzie: zanik faktury z mapy bazowej przy każdym rozmiarze mapy i w połowie podzielonego ekranu (`SpaceGasMaps` `lodW / lodH` — mapa z kadru przesuwała zanik: lod przy minZoom 0,819 → 0,392, przy oddaleniu więcej włókien); okno pola i liczba drobin pyłu zaokrąglane do wielokrotności, którą kernele bez strażnika liczby wątków wymagają (N do 8, drobiny do 64 — `spaceGasLayout.js`, gra liczy okno tą samą funkcją); pieczenie światła olbrzymów pasa — jeden kernel dla wszystkich olbrzymów, rozgrzany na ekranie ładowania (`GiantBakeKernel`, reguła `pas-asteroid`). Testy Node; po tych zmianach bez przebiegu GPU (do potwierdzenia: 0 pipeline'ów compute po starcie, kadry domyślnej mapy, jasność pyłu z [0,3; 1,2] — `--drzenieCzesci jasnosc --jasnoscSkale 1.25,1 --jasnoscFade "0.3,1.2"`).
  - Do decyzji użytkownika (zmieniają wygląd przy oddaleniu; lista z 2026-10-29 — mapy w proporcjach kadru i najmniejszy rozmiar drobin — rozstrzygnięta wyżej):
    - `lodMean` — średnie kanałów wygaszonej faktury (domyślnie wył.: przy oddaleniu siarka −13%, lód +25%, wyrzut −30%; gasi tylko powolny dryf barwy przy zoomie). A/B: `SpaceGas.tune.lodMean = true`;
    - `layerCubic` — odczyt B-spline mapy gazu w warstwie (domyślnie wł.: najmniejszy skok na stopniu drabiny i bez schodków teksla, ale gaz przy oddaleniu miękkszy o ~½ teksla — na 5120 × 1440 z mapą 768 × 432 ~5 px bufora w poziomie, ~2,5 px w pionie; koszt passu ortho +0,06–0,15 ms przy zoomie 0,035, tylko przy oddaleniu). A/B: `SpaceGas.tune.layerCubic = false`;
    - mapa szeroka 1536 × 432 jako opcja jakości (`?gazMapa=szeroka`; teksel kwadratowy 4,8 px);
    - z wcześniejszych list: pył w hipercruisie przy oddaleniu (drobiny skaczą 5–24 px na klatkę), dłuższa pamięć faktury, okno w walce, zanik kanałów tylko w próżni.
