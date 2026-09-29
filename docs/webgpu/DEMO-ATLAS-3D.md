# Demo WebGPU: Atlas 3D i modele 3D broni (dema/atlas3d-webgpu.html)

Polecenie użytkownika (2026-09-28): *„Zamierzam sprawdzić gameplay w 3D, tym samym potrzebuję model Atlasa w 3D.
Wrzuć go do dema — pamiętaj o zgodności z WebGPU.”* i zaraz potem: *„i jeszcze modele broni 3D”*.

Demo pokazuje **model 3D Atlasa** (okręt gracza) zbudowany ze sprite'a gry i **modele 3D wszystkich broni gry**
(23 rodziny z atlasów sprite'ów) w trzech trybach: oględziny, lot (rozgrywka w 3D: sterowanie, kamery, ogień, cele)
i galeria broni. Samodzielne demo (`WebGPURenderer` + TSL pod Vite), gry nie dotyka; modele leżą w `src/3d/ships3d/`
gotowe do integracji. Tylko WebGPU i TSL — bez GLSL, `ShaderMaterial` i API WebGL (pilnuje test).

## Jak otworzyć i sterować

`npm run dev` → `http://localhost:5173/dema/atlas3d-webgpu.html` (port wg Vite). Start: oględziny, orbita wokół Atlasa.

- **Tryby (O / L / G):** Oględziny (statek stoi, kamera orbitalna, wieże śledzą kursor), Lot (rozgrywka w 3D),
  Galeria broni (wszystkie modele na postumentach — rozmiar dopasowany ~80 j. albo skala gry z przełącznika; śledzą
  krążący punkt i strzelają).
- **Kamery (1–5):** 1 Z góry — jak kamera gry (prosto w dół, północ w górę, statek obraca się pod kamerą),
  2 Taktyczna 3/4 — kamera gry pochylona (suwak „pochylenie 3/4”, opcja „obraca się z kursem”), 3 Pościg — za rufą,
  4 Orbita — swobodna, 5 Kino — samoczynny przelot.
- **Lot:** W/S ciąg (przód / wsteczny), A/D skręt, Q/E ruch w bok, R/F góra / dół, Shift dopalacz. **LPM** — ogień
  wież głównych i specjalnych w punkt pod kursorem (cel pod kursorem — dron / skała — dostaje namiar, celownik
  czerwienieje), **PPM** albo **Spacja** — rakiety (samonaprowadzanie na namierzony cel), **X** — salwa Hexlance'a
  (4 strzały z działa osiowego), **T** — auto-obrona punktowa (wieże aux biją najbliższego drona z wyprzedzeniem).
  Kółko — zoom, **Alt + przeciąganie** albo **ŚPM** — obrót kamery (3/4: azymut i pochylenie).
- **Oględziny i galeria:** przeciąganie LPM — orbita, PPM — przesuw, kółko — zoom; Spacja — salwa wież głównych,
  M — rakiety, X — Hexlance.
- **Panel:** fit gry (jak `autoMountDefaults()` w `index.html`) albo wszystkie gniazda, broń per grupa gniazd
  (główne / specjalne / aux / rakietowe / Supernova), przełączniki (tekstura pokładu, mapa normalnych, szwy paneli, wieże,
  znaczniki gniazd, strugi, światła, cienie, bloom, przechył, szybki lot ×3, auto-PD, drony, **porównanie: płaski
  sprite jak w grze** — ten sam kadr z kwadem sprite'a zamiast modelu, galeria w skali gry), suwaki (skala wież,
  pochylenie 3/4, słońce, ekspozycja), **Eksport GLB**, statystyki (FPS, CPU / GPU, draw calle, trójkąty).
  **H** — panel i HUD, **P** — pauza.
- **Adres:** `?tryb=ogledziny|lot|galeria`, `?kamera=gra|taktyczna|poscig|orbita|kinowa`, `?fit=gra|pelny`,
  `?test=1` (klatki tylko przez `__demo.step`), `?dpr=1`, `?cienie=2048`.
- **Konsola:** `__demo.mode(tryb)`, `camera(kamera)`, `loadout('gra'|'pelny')`, `view({ az, el, dist, tilt, pan })`,
  `keys(['w','a'])`, `mouse(nx, ny, { lmb, rmb })`, `fire('main'|'special'|'aux'|'missile'|'hexlance')`, `step(n)`,
  `stats()`, `exportGLB()`.

## Pliki

| Plik | Co robi |
|---|---|
| `src/3d/ships3d/meshBuilder3D.js` | **budowniczy brył** (bez DOM, działa w Node): graniastosłupy z wielokątów (także wklęsłych — earcut) z fazami i pochyleniem, bryły wzdłuż X (lufy), walce, toczenia, kopuły, stos przekształceń z lustrem (ściany zawsze na zewnątrz — kolejność z „podpowiedzi” po macierzy normalnych), uv pokładu z rzutu sprite'a, atrybut `aMat` (numer materiału palety) |
| `src/3d/ships3d/atlasHull3D.js` | **kadłub Atlasa**: obrys ze sprite'a, płyta pokładu i widły, kil, cytadela, śródokręcie, rufa (bloki silnikowe, radiatory, platforma wieży), kręgosłup = działo Hexlance, płetwy startowe z hangarami, VLS, kopuły, okna burt, dysze MAIN i SIDE, mostki gry, gniazda z edytora; zapytania `heightAt`, `bottomAt`, `contains` |
| `src/3d/ships3d/weapons3D.js` | **modele broni**: 23 rodziny, części (podstawa, obudowa, lufa, wirnik), czop, osie luf, wylot, odrzut, zakres podniesienia; `WEAPON3D_FAMILY` (broń → rodzina), `weapon3DScale` (skala jak wieże gry) |
| `src/3d/ships3d/shipMaterials3D.tsl.js` | **materiały TSL**: jeden graf na kadłub (pokład ze sprite'em + paleta) i jeden na broń; paleta `SHIP3D_PALETTE`, szwy paneli, emisja, mapa normalnych pokładu z luminancji |
| `dema/atlas3d-webgpu.html`, `dema/atlas3d-webgpu.js` | strona, renderer, światło i cienie, post jak gra (pass MSAA 4 → siatka HDR → bloom gry → ACES gry → sRGB), tryby, wejście, celowanie, ogień, HUD, pętla, `window.__demo` |
| `dema/atlas3d-webgpu/statek.js` | Atlas w scenie: kadłub, wieże w gniazdach (celowanie, odrzut, wirniki, wyloty), fity, strugi MAIN, światła pozycyjne i reflektory, znaczniki gniazd |
| `dema/atlas3d-webgpu/lot.js` | model lotu (liczby `SHIP_FLIGHT_SPECS.atlas`) i kamery |
| `dema/atlas3d-webgpu/efekty.js` | pociski, rakiety (samonaprowadzanie, ślad), błyski, iskry — pule instancji addytywnych |
| `dema/atlas3d-webgpu/cele.js` | skały i drony wroga (cele, obrona punktowa) |
| `dema/atlas3d-webgpu/galeria.js` | galeria broni |
| `dema/atlas3d-webgpu/niebo.js` | niebo z kierunku widoku (gwiazdy, mgławica, słońce) i mapa otoczenia (PMREM) |
| `dema/atlas3d-webgpu/eksport.js` | eksport GLB (materiały standardowe z palety, pokład z teksturą sprite'a) |
| `scripts/webgpu/atlas3d-demo.mjs` | sprawdzenie w Chromium na SwiftShaderze (błędy konsoli / walidacji WebGPU, zrzuty do `.tmp/atlas3d/`, eksport GLB) |
| `tests/atlas3dModel.test.mjs` | testy bez GPU: geometria, rozmiar = kadłub gry, uv pokładu, gniazda = markery edytora, każda broń gry ma model, **wyloty luf = wyloty gry**, WGSL materiałów w Node i limity WebGPU, brak GLSL / API WebGL |

## Model kadłuba

- **Układ i skala jak warstwa 3D gry (Core3D):** X ku dziobowi, Y = −y obrazka, Z w górę (ku kamerze gry). Projekt
  w pikselach sprite'a (środek płótna 3747 × 1677 = 0 — te same liczby co markery edytora), wynik w jednostkach świata:
  `ATLAS3D_SCALE = 1800 / 3747` (dłuższy bok płótna = 1800 j., jak `getHullRenderSize('atlas')`). Kadłub zajmuje w
  świecie dokładnie miejsce sprite'a: 1700 × 594 j. (z dzwonami dysz 1727), wysokość od kila do masztu mostka ~230 j.
- **Z góry model = sprite:** dachy wszystkich brył mają materiał POKŁADU — teksturę sprite'a w rzucie z góry
  (uv = pozycja / płótno + 0,5), więc w kamerze gry (1 Z góry) widać rysunek sprite'a, a bryły tylko podnoszą albo
  obniżają jego fragmenty. Przezroczyste piksele sprite'a są czarne — fazy przy krawędzi mają ciemny obrys, bez obwódki.
  Mapa normalnych z luminancji (jasne płyty wyżej, ciemne szczeliny niżej, Sobel na połowie rozdzielczości) wydobywa
  rysunek płyt w skośnym świetle.
- **Obrys:** z kanału alfa (profil kolumn symetrycznej maski — sprite jest symetryczny w 99,3%, Douglas–Peucker 2,2 px),
  płetwy wycięte do osobnych brył; model symetryczny (lustro w osi).
- **Bryły (wysokości w px sprite'a):** płyta pokładu z = −40…48 (burta pionowa, faza 7 px na dachu, bez fazy na styku
  z widłami), widły dziobowe z pokładem opadającym ku czubkom (48 → 24), **kil** — pochyłe burty dolne do przekroju 62%
  szerokości i dno w pasach liniowych w x (−130 na rufie, −230 pod cytadelą, −100 u rozwidlenia; widły płytsze, −16 na
  czubkach).
  Nadbudówki: cytadela (104), śródokręcie (78), rufa — rdzeń silnika (132), skrzydła (100), moduły silnikowe burt (118)
  z radiatorami (146), kwadratowa platforma wieży w osi (124). Razem od dna kila do dachu radiatorów ~180 j. świata
  (~10% długości), z masztem mostka ~230 j.
- **Kręgosłup = działo Hexlance** (jak w grze: broń *builtin* jest wtopiona w kil sprite'a): moduły i korytarze od rufy
  do rozwidlenia (szyja, gniazdo wyrzutni rufowej, korytarz pod mostkiem, gniazdo Supernovej, szyna akceleratora z
  cewkami, gniazdo wyrzutni dziobowej, korytarz dziobowy) i wylot nad rozwidleniem — dwie szyny i soczewka (E_ICE).
- **Płetwy startowe** (3 na burtę; na sprite'cie „wieże” z przerywaną linią) = szyny myśliwców: cienkie płyty z
  wspornikiem i światłami, u nasady **wrota hangaru** (ciemne wnętrze, bursztynowa listwa) — tam, gdzie markery `hangar`.
- **Detale:** 5 komór VLS na burtę na cytadeli (rysunek sprite'a), kopuły czujników, rzędy okien w burtach (skala okrętu),
  dysze SIDE z markerów edytora (RCS na burtach), **dysze MAIN** — dzwony na tylnych ścianach bloków rufy (sprite nie ma
  namalowanych dysz, markery MAIN leżą na dachu rufy; dzwony stoją na ich wysokościach w osi Y, promień z
  `ENGINE_FX_DEFAULTS.atlas.mainNozzle`).
- **Mostki z gry:** `buildBridgeModel('atlas_main')` i `('atlas_backup')` z `src/3d/bridge3DShapes.js` (te same modele,
  które gra kładzie na kadłub), wysokość × 2,6 (w grze są płaskie — kamera z góry i słońce prawie poziomo), okna i paski
  akcentu z emiterów modelu jako świecące szyby.
- **Gniazda:** wszystkie 45 markerów `ATLAS_EDITOR_DEFAULTS` (15 main, 6 special, 14 aux, 2 missile, 1 special_missile,
  1 builtin, 6 hangar) w tych samych punktach (× skala), wysokość z dachu bryły pod markerem, barbeta (pierścień) na
  namalowanym gnieździe. Światła pozycyjne (42 czerwone, sekwencja „edge”) i reflektory dziobowe z tych samych danych.
- **Rozmiar:** ~23 tys. trójkątów kadłuba (z mostkami i barbetami), budowa ~100–170 ms (JS, raz).

## Modele broni

- **Rodziny = atlasy sprite'ów gry** (`assets/weapons/*-atlas-v*.png`, prompty `*.prompt.md`): Tempest Ion (1 i 2 lufy),
  Vulcan / Gatling, Helios, Heavy Autocannon, Armata, laser ciągły, laser pulsowy, CIWS Mk I / Mk II, Helios PD, Flak
  lekki i ciężki (Grad / Perun), wyrzutnie Cruise / Fast / Osa / Supernova, torpedy, Goliath, Ion Plasma Gatling,
  Valkyrie, Mjolnir, Yamato. Każda broń z `MASTER_WEAPONS` ma rodzinę albo świadomie `null` (hangary, Hexlance —
  wbudowany w kadłub, jak w `turret2D.js`).
- **Obrys i skala jak w grze:** model powstaje w jednostkach lokalnych wieży 2D (+X przód) z prostokątów `base` /
  `barrels` modułów sprite'ów (`mainWeaponSprite2D`, `specialWeaponSprite2D`, `tempestSprite2D`, `ciwsSprite2D`,
  `pdWeaponSprite2D`, `launcherSprite2D`, `yamatoSprite2D`; torpedy — sylwetka `Turret2D`), więc **wyloty luf są tam,
  gdzie gra liczy wystrzał** (test). Świat = lokalne × `weapon3DScale(def)` = `SCALE_BY_SIZE × CATEGORY_TRIM × klasa
  kadłuba` (te same liczby co `weaponScale` w `turret2D.js` i `WEAPON_TIER_SCALE`). Suwak „skala wież” (domyślnie 1 =
  gra) pozwala ocenić większe wieże w 3D.
- **Wygląd z promptów:** obudowy z fazami, magazyny i pakiety kondensatorów na burtach, kratki wentylacji, wloty luf,
  lufy z cewkami, obejmami, płaszczami i hamulcami wylotowymi, bloki luf obrotowych, pojemniki rakiet z pokrywami i
  obejmami; świecące paski w barwie rodziny (cyjan Tempest / Yamato / Plasma, bursztyn Vulcan / Flak / Goliath / Cruise,
  czerwień Helios / Pulse, mięta CIWS, magenta Valkyrie / Supernova, turkus lasera ciągłego, lodowy cyjan Mjolnir).
- **Części i ruch:** `ring` (podstawa, nieruchoma), `housing` (obrót w poziomie wokół (0, 0) — jak wieża 2D), `barrel`
  (podniesienie wokół czopu, odrzut wzdłuż osi; jedna geometria powielona w osiach luf), `spin` (wirnik gatlingów).
  Wyrzutnie podnoszą pojemniki do strzału (≥ 25°) i strzelają po jednym pojemniku. Geometrie części są wspólne dla
  wszystkich egzemplarzy broni (cache po rodzinie), materiał jeden na całą broń.
- **Rozmiar:** 170–1300 trójkątów na wieżę; fit gry (26 wież) ~29 tys. trójkątów.

## Materiały i render (WebGPU)

- **Jeden graf na rodzaj** (`createShipMaterial`): kadłub (z gałęzią pokładu) i broń — barwa, szorstkość, metaliczność i
  emisja z palety indeksowanej atrybutem `aMat` (3 bloki `uniformArray`), szwy paneli z uv (rzut pudełkowy, rzędy płyt
  o losowej szerokości, wygaszanie przy oddaleniu przez `fwidth` — bez mory), odcień płyt z hasha komórki, wnętrza dysz ×
  ciąg, chłodne podświetlenie krawędzi sylwetki (1 − |n·v|)⁴ — okręt nie znika w cieniu na czarnym tle. Graf bez gałęzi
  i bez przypisań poza `Fn()`; tekstury próbkowane poza warunkami. Wartości w biegu przez uniformy
  (`material.userData.uniforms`: `engine`, `seams`, `bump`, `emissive`, `deck`, `rim`, `panel`) — bez przebudowy
  pipeline'u.
- **Atrybuty:** `position`, `normal`, `uv`, `aMat` (4 bufory wierzchołków, limit 8), indeks 16/32-bit.
- **Scena:** `DirectionalLight` z cieniem (PCF, 4096², kamera cienia idzie za statkiem), światło wypełniające od spodu
  (bez cienia — kil czytelny z profilu), `HemisphereLight`, mapa otoczenia PMREM z funkcji nieba bez tarczy słońca
  (odblask słońca daje światło kierunkowe — tarcza w PMREM robiła z połyskliwej stali lustro), niebo jako
  `scene.backgroundNode` z kierunku widoku (gwiazdy z komórek 3D, bez paralaksy — działa w każdej kamerze 3D).
  Post jak gra i dema: `pass` MSAA 4 → `hdrBezpieczny` →
  `BloomGry` (`BLOOM_DEFAULTS`) → `acesGry` → `linearDoSrgb`.
- **Efekty:** pociski, błyski, iskry i ślady rakiet = dwie pule `InstancedMesh` z materiałem addytywnym (barwa HDR w
  `instanceColor`); strugi MAIN — stożki addytywne z paletą `plazma` z `MAIN_EXHAUST_PALETTES` (jak dysze gry), długość
  z ciągu.

## Rozgrywka w demie (do oceny „gameplayu w 3D”)

- **Lot jak w grze:** ruch w płaszczyźnie gry (kurs = obrót wokół Z) z liczbami `SHIP_FLIGHT_SPECS.atlas`
  (maxSpeed 400, accel 130, decel 160, strafe 60, reverse 50, turnRate 16°/s, turnAccel 11°/s²) + ruch w pionie
  (R/F) do sprawdzenia, jak czyta się trzeci wymiar. Przechył w skręcie tylko wizualny (gra nie ma przechyłu).
- **Celowanie jak w grze:** punkt pod kursorem na płaszczyźnie statku (albo cel pod kursorem); wieże obracają się z
  limitem prędkości (Capital 40°/s, reszta 70°/s, CIWS 360°/s) i strzelają, gdy są wycelowane; aux — auto-PD na drony.
- **Cele:** 18 skał (HP ∝ rozmiar, odrastają) i 8 dronów krążących wokół Atlasa na różnych wysokościach (ich ogień iskrzy
  na kadłubie — test trafień w bryłę: obrys `contains`, dach `heightAt`, dno `bottomAt`).
- Kamera „Z góry” pokazuje, jak model wygląda w obecnej kamerze gry; „3/4” — jak wyglądałaby gra z pochyloną kamerą;
  „Pościg” — pełne 3D.

## Eksport GLB

Przycisk **Eksport GLB** (albo `__demo.exportGLB()`) zapisuje `atlas3d.glb`: kadłub i wieże w bieżącej pozie, trójkąty
pogrupowane po materiale palety (`atlas_paint`, `atlas_deck` z teksturą sprite'a, `atlas_e_cyan` z emisją
`KHR_materials_emissive_strength`…), oś Z → Y (Blender przelicza z powrotem). Materiały TSL nie przechodzą do glTF —
to punkt wyjścia do dopracowania w Blenderze, nie źródło prawdy (źródłem jest kod w `src/3d/ships3d/`).

## Sprawdzanie

- `node --test tests/atlas3dModel.test.mjs` — bez GPU (geometria, gniazda, wyloty, WGSL w Node, brak GLSL).
- `npx vite --port 5199 --strictPort` w tle, potem `node scripts/webgpu/atlas3d-demo.mjs [--tylko start,gra,lot,poscig,galeria,pelny,glb]`
  — Chromium z Playwrighta na SwiftShaderze: błędy konsoli i walidacji WebGPU, zrzuty do `.tmp/atlas3d/`, rozmiar GLB.
  Sprawdza poprawność, nie wydajność (SwiftShader: klatka ~1–3 s).

## Do integracji z grą (gdy przyjdzie czas)

- Model jest w układzie i skali Core3D — kadłub gracza można podpiąć do `Core3D.scene` zamiast skóry belek
  (`hullSkinBatch`) bez przeliczeń; fizyka i kolizje zostają 2D na siatce belek ze sprite'a (`hullBodies.js`).
- Wieże: kąt z `Turret2D` (yaw), odrzut z `weaponRecoil`, wyloty z tych samych punktów — model ich nie zmienia.
- Materiały do rejestru rozgrzewki (`Core3D.warmup.add`), światła gry (`HullLightStore`, mapa ran `hullDamageMap`)
  trzeba by dołożyć do grafu (dziś paleta + oświetlenie standardowe three).
- Otwarte pytania do użytkownika: czy kamera gry ma zostać z góry (model tylko dla wyglądu), czy iść w 3/4 / pościg;
  czy ruch w pionie ma być rozgrywką; czy wieże powiększyć względem skali gry (suwak) — to decyduje o dalszych krokach.
