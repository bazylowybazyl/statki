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
