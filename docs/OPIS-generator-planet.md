# Generator planet z ziarna — opis (2026-11-08)

Prośba użytkownika (2026-11-07): „generator planet — demo … terrańska, gazowa, skalista, piaszczysta, lodowa itp.”.
Tło: układów gwiezdnych ma być dużo (podróż między układami jak w Starsectorze, świat buduje się przy przeładowaniu
strony). Planety Układu Słonecznego to ręczna produkcja (mapy 8K ze skryptów Pythona, ~232 MB na układ) — przy
dziesiątkach układów niewykonalne. Generator robi planetę z opisu `{ type, seed }` w przeglądarce, na GPU, pod
ISTNIEJĄCE materiały gry. Stan: demo do oceny, w grę niewpięty. Reguła obszaru: `.claude/rules/generator-planet.md`.

## 1. Decyzja: wypiek map na GPU (nie szum liczony co klatkę)

| kryterium | wypiek do tekstur (wybrany) | szum w shaderze klatki |
|---|---|---|
| wpięcie w grę | te same wejścia co `PLANET_MAPS` — graf powierzchni, chmury, poświaty, mgiełka, pas zachodu, cień ringu, maska słońca, żywa atmosfera olbrzymów bez zmian | nowy graf planety (lub gałąź grafu gry) — drugi model światła do utrzymania |
| koszt klatki | jak dziś (próbki tekstur) | fbm 8–12 oktaw + kratery + normalne z różnic na każdy piksel tarczy: przy tarczy na cały ekran 5120 × 1440 kilka ms GPU co klatkę |
| czas generacji | układ 8 planet 2048 px: **~22 ms GPU, ~60 ms ściany** (+ kompilacja przejść ~1,2 s na zimno, potem z pamięci shaderów) | 0 (kompilacja grafu) |
| pamięć | 1024 px: **~5–9 MB na planetę skalną, 2,7 MB olbrzym, układ 8 planet ~42 MB**; 2048 px: układ ~170 MB (tabela §5) | ~0 |
| zbliżenie | rozdzielczość mapy (4096 px — teksel ~10 km przy Ziemi); detal drobniejszy niż teksel nie powstaje | nieograniczony detal |

Wybór: wypiek — koszt klatki gry bez zmian, materiały gry bez zmian, generacja układu w ułamku ekranu ładowania.
Pamięć załatwia poziom szczegółu wypieku (rekomendacja §6: wszystkie planety 1024 px pod ekranem ładowania, planeta,
przy której jest gracz, przepiekana do 2048 przy podejściu — 5 ms GPU, w strefach przez kilka klatek).

## 2. Architektura (`src/3d/planetGen/`)

| plik | rola |
|---|---|
| `planetGenTypes.js` | rodzaje (id wspólne z mapą gwiezdną i `src/data/starSystems.js`), nazwy, typowe promienie |
| `planetGenRng.js` | losowanie z ziarna (mulberry32), strumienie per cel (`rngFor(seed, 'teren')`) — nie `Math.random`, nie `fxRandom` |
| `planetGenSpec.js` | `describePlanet({ type, seed, r?, rKm?, look?, clouds?, night? })` → pełny opis: wygląd rodzaju (podrodzaj, ukształtowanie, klimat, paleta), strojenie materiału gry, mgiełka, poświata (powłoka planet tła i dysk planet przy ringu), chmury, światła nocy, pasy / wiatr / wiry / pierścienie olbrzymów; `plannedMaps`, `plannedBytes` |
| `planetGenNoise.tsl.js` | szum TSL w 3D na kuli: gradientowy, z pochodnymi, komórki (zwykłe i gładkie), oktawa kraterów, fbm, fbm erozyjny, wielofraktal grzbietowy, odkształcenie dziedziny |
| `planetGenBake.tsl.js` | wspólne przejścia wypieku: współrzędne mapy, NORMALNE (z wysokości, nachylenie przycięte), POŁYSK (woda / lawa / lód), NOC (miasta, żar lawy), CHMURY (ziemskie z cyklonami / pokład / pył) |
| `planetGenSolid.tsl.js` | rodzaje z powierzchnią: graf POLA i DNIA na rodzaj + `uniformsFor(spec, ctx)` |
| `planetGenGasBake.tsl.js` | mapa dnia olbrzymów (pasy z adwekcją polem wirowym, wiry w miejscach rekordów silnika, mgła polarna) |
| `planetGenGas.js` | olbrzymy na wspólnym silniku `gasGiantAtmosphere`: graf `'genGas'` raz dla wszystkich, dane planety per obiekt, `GenGasAtmosphere` (zegar 1:1 z Jowiszem) |
| `planetGenRing.js` | pierścienie: profil z ziarna, materiał TSL z cieniem planety |
| `planetGenBaker.js` | `PlanetGenBaker`: grafy raz na klucz, `compile(rodzaje)`, `bakeSystem(opisy, { size })`, cele map, `releaseScratch()` |
| `planetGenBody.js` | uniformy materiałów gry z opisu i map (kształt `DirectPlanet`), siatki ciała dla dema |

Zmiana w kodzie gry: tylko DOPISEK w `src/3d/planet3d.assets.tsl.js` — `registerPlanetFlowKind(kind, { keys, color,
name })` (dodatkowy rodzaj grafu powierzchni z barwą dnia z przepływu) i nazwa materiału z rejestracji w
`PlanetBodyNodeMaterial`. Rodzaje gry, ich WGSL i `PLANET_GRAPH_KEYS` bez zmian (testy planet, Jowisza, Saturna przechodzą).

### Przebieg wypieku układu (`bakeSystem`)

1. **Próby** — dla każdej planety z powierzchnią graf POLA w 192 × 96 do osobnego celu RGBA32F, wszystkie naraz, jeden
   odczyt (`readRenderTargetPixelsAsync`): kwantyle kanału `w` ważone cos φ w ułamkach `probeQ` rodzaju → `uQ` (np. próg
   kontynentalności dający zadany udział oceanu — morze ma dokładnie `look.water` powierzchni).
2. **Pełna rozdzielczość** bez czekania: POLE (RGBA32F, cel wspólny), DZIEŃ, NORMALNE, POŁYSK (½), NOC (½), CHMURY —
   tylko mapy z `plannedMaps`; cele z mipmapami, `RepeatWrapping` w u.
3. Jedno czekanie na koniec pracy GPU. `releaseScratch()` zwalnia pole robocze (32 MB przy 2048) po układzie.

Kontrakt kanałów POLA: x — wysokość [km] (0 = poziom morza na planetach z wodą), y — ciecz poza morzem (solanka, lawa —
POŁYSK × `uSpec.z`, NOC × `uLava.x`), z — maska rodzaju, w — pole próby.

## 3. Rodzaje i zmienność z ziarna

Zmienność jest strukturalna (podrodzaj, układ lądów, klimat, gęstość i wiek kraterów, liczba pasów i burz), barwa — z
palety podrodzaju z rozrzutem. Test pilnuje, że 24 ziarna dają ≥ 12 różnych zestawów parametrów kształtu.

| id | nazwa | co zmienia ziarno | mapy |
|---|---|---|---|
| `terran` | terrańska | ocean 52–80%; płyty (10–26), kształt kontynentów (podwójne odkształcenie fbm, ryfty, archipelagi), pasma gór na granicach płyt, klimat (zimny ↔ gorący: czapy, pustynie podzwrotnikowe w komórkach Hadleya), wilgotność, roślinność (zielona / morska / oliwkowa / rdzawa), cywilizacja 0–100% (25% dzikich) | dzień, normalne, połysk, noc, chmury (cyklony tropikalne z okiem i pozatropikalne) |
| `ocean` | oceaniczna | ocean 92–99%, łańcuchy wysp nad plamami gorąca (stożki → atole), barwa wody (granat / turkus / zieleń / ciemna), gęste chmury, platformy na morzu | jak terran |
| `desert` | piaszczysta | podrodzaj płowa / ruda / biała (gips) / brązowa; morza wydm w nieckach (18–50%), mesy z tarasami, pasma gór, solniska / jeziora solanki, burze pyłowe | dzień, normalne, noc (oazy), pył, połysk (solanka) |
| `rocky` | skalista | jak Mars: rdza / ochra / szara / bazalt; dychotomia półkul, 0–4 wulkany tarczowe (Tharsis), kanion, stare kratery, plamy albedo (bazalt ↔ pył), czapy z rowami spiralnymi | dzień, normalne, rzadko pył i kolonie |
| `ice` | lodowa | pęknięta (Europa: łuki pasm, teren chaosu) / bruzdy (Ganimedes: wieloboki ciemnego i jasnego terenu) / śnieżka (góry spod lodu, zamarznięte morza) / pręgi (Enceladus) | dzień, normalne, połysk lodu |
| `volcanic` | wulkaniczna | siarka (Io: kaldery, potoki, pierścienie opadu), lawa (czarna skorupa z siatką żarzących się szwów, jeziora lawy), popiół (stożki z kanałami lawy) | dzień, normalne, NOC = żar lawy, połysk lawy |
| `barren` | martwa | Księżyc (morza w basenach i nizinach) / Merkury (skarpy płatowe) / Kallisto (jasne kratery) / ciemna; 0–6 basenów, kratery 7 oktaw (proste i złożone, wiek, świeże z wyrzutem i promieniami) | dzień, normalne, czasem noc (placówki) |
| `toxic` | toksyczna | Wenus / Tytan / chlor / smog: pokład chmur w barwach palety ze smugami „Y” i kołnierzem polarnym, pod nim bazalt i tessery | dzień, normalne, chmury (pokład), noc (czasem) |
| `gas` | gazowy olbrzym | paleta (Jowisz / Saturn / amoniak / siarka / rdza / gorący), kilkanaście pasów, kontrast, turbulencja, girlandy, wielka plama (55%), owale i barki, pierścienie (40%) | dzień (żywy — wspólny silnik) |
| `ice_giant` | lodowy olbrzym | Uran / Neptun / turkus / zielony, słabe pasy, ciemne plamy z jasnymi chmurami, smugi metanu, prąd wsteczny na równiku, pierścienie (45%, ciemne) | dzień (żywy) |

Mgiełka (`haze` → `uHazeStrength / Color / Beta` grafu gry): terran / ocean błękitno-biała 0,40–0,55 (współczynniki
0,05 / 0,075 / 0,12 — przy domyślnych grafu 0,05 / 0,10 / 0,22 suchy ląd wychodził fioletowy), pustynie płowa, rdza —
pyłowa jak Mars, lód — obojętna i słaba, toksyczne — gęsta w barwie podrodzaju, olbrzymy jak Saturn (słaba), lodowe —
metanowa.

## 4. Olbrzymy na wspólnym silniku żywej atmosfery

Jowisz i Saturn mają po modelu i grafie (`'jupiter'`, `'saturn'`). Planet z generatora może być wiele, więc jeden graf
`'genGas'`: `createGasGiantFlowDayColor(GEN_GAS_GRAPH_MODEL)` z modelem, którego `bandArray()` / `vortexArray()` to
węzły tablic uniformów aktualizowane NA OBIEKT (kopiują `material.uniforms.genGasBands / genGasVortices` przed
rysunkiem; bufor grupy obiektu three ma każdy obiekt renderu osobno), a `windTexture()` — węzeł tekstury per obiekt.
Strona CPU planety: `createGenGasEngine(spec)` (segmenty pasów z profilu wiatru opisu — minima profilu, plateau wirów)
i `GenGasAtmosphere` (zegar `GasGiantAtmosphere` 1:1: pasy jadą sztywno, wiry obracają się, reszta płynie fazami).
Mapa dnia rysuje wiry w miejscach rekordów silnika; pasy z profilu szerokości próbkowanego w szerokości cofniętej
polem wirowym (8 kroków adwekcji przez rot szumu dwóch skal) i zaburzonej turbulencją strefową — wiry i marmurkowe
zawinięcia, które silnik potem przesuwa. Ograniczenia: wspólny promień modelu (prędkości wiatru dobrane do niego), czapy
polarne bez osobnego obrotu (pas przy biegunie prawie stoi), bez sześciokąta.

## 5. Czasy i pamięć (pomiar 2026-11-08)

`node scripts/webgpu/generator-planet-pomiar.mjs` — headless Chrome, RTX (maszyna użytkownika), klatki dema wstrzymane,
czas GPU ze znaczników czasu (tylko przejścia wypieku), mediana 3 ziaren. Pamięć — mapy z mipmapami (`plannedBytes`).

| rodzaj | kompilacja na zimno [ms] | 1024: GPU / ściana [ms] / MB | 2048: GPU / ściana / MB | 4096: GPU / ściana / MB |
|---|---|---|---|---|
| terran | 446 | 0,9 / 16 / 8,8 | 4,6 / 18 / 35,3 | 21,2 / 34 / 141 |
| ocean | 911 | 1,0 / 15 / 8,2 | 4,0 / 17 / 32,7 | 22,9 / 35 / 131 |
| desert | 624 | 0,6 / 12 / 5,3 | 2,5 / 16 / 21,3 | 13,8 / 25 / 85 |
| rocky | 513 | 0,5 / 14 / 5,3 | 2,1 / 15 / 21,3 | 12,6 / 25 / 85 |
| ice | 410 | 0,5 / 12 / 5,5 | 1,9 / 15 / 22,0 | 9,9 / 22 / 88 |
| volcanic | 519 | 0,7 / 16 / 6,0 | 2,7 / 16 / 24,0 | 13,4 / 29 / 96 |
| barren | (przy starcie) | 0,5 / 16 / 5,3 | 2,1 / 13 / 21,3 | 11,8 / 24 / 85 |
| toxic | 313 | 0,5 / 15 / 8,0 | 2,1 / 15 / 32,0 | 12,1 / 24 / 128 |
| gas | 901 | 0,6 / 7 / 2,7 | 2,1 / 8 / 10,7 | 10,7 / 17 / 43 |
| ice_giant | (wspólny z gas) | 0,5 / 5 / 2,7 | 2,1 / 9 / 10,7 | 10,5 / 17 / 43 |

- Kompilacja WSZYSTKICH przejść jednym wywołaniem (równolegle w tle): ~1,2 s na zimno; Chrome trzyma skompilowane
  shadery na dysku, więc kolejne starty płacą mniej. Na układ potrzeba tylko przejść rodzajów w nim obecnych.
- Układ 8 planet (terran, rocky, desert, gas ×2, ice_giant, ice, barren): **1024 px — GPU 4,9 ms, ściana 48 ms, mapy
  42,5 MB; 2048 px — GPU 22,4 ms, ściana 58 ms, mapy 170 MB** (+ pole robocze 8 / 32 MB do `releaseScratch`).
- Dla porównania: ręczny Układ Słoneczny ~232 MB map.
- Ściana zależy od taktu urządzenia: przy rysowanych klatkach odczyt próby czeka na takt (~1 klatka w grze; w headless
  z klatkami ~200 ms) — dlatego próby są na układ, nie na planetę.

## 6. Wpięcie w grę (dla orkiestratora — nie zrobione)

1. **Ekran ładowania**: `const baker = new PlanetGenBaker(Core3D.renderer)` (w workerze renderu — w workerze, jak reszta
   `Core3D`); `await baker.compile(rodzaje układu)` — przejścia przez `compileAsyncNaCelu` (pułapka 30); wpis w
   `Core3D.warmup` (`run('generator planet', …)`) albo w kroku przygotowania układu.
2. `const maps = await baker.bakeSystem(opisy, { size: 1024 })`, potem `baker.releaseScratch()`. Opisy z tabeli układów:
   `describePlanet({ type, seed, r })` — ziarno z ziarna układu i indeksu planety (np. `mix32(ziarnoUkładu, i)`).
3. **DirectPlanet z opisu**: uniformy `planetSurfaceUniforms(spec, maps)` (te same klucze), chmury
   `planetCloudUniforms`, poświata `planetHaloUniforms` (planety tła) albo `planetRingAtmUniforms(spec, R)` (planety przy
   ringu); strojenie z `spec.surface` zamiast gałęzi po nazwie (`uBrightness`, `uSunIntensity`, `uSpecular`, bloom).
   Zależności od nazw (`RING_PLANET_NAMES`, jasność i atmosfera po nazwie w `planet3d.assets.js` ~759–875) — dla planet
   generatora z opisu.
4. **Olbrzymy**: `createGenGasSurfaceMaterial(uniforms)` + `new GenGasAtmosphere(maps.gas, planet, null)` i co klatkę
   `atmosphere.step()` (czas gry z `SimClock` — jak Jowisz); pierścienie `createGenRingMesh(spec, uniforms.sunPosition)` —
   w grze do warstwy passa planety i do rozgrzewki.
5. **Rozgrzewka materiałów** planet (graf `'surface'` gry już rozgrzewany; `'genGas'`, pierścienie — wpisy `Core3D.warmup`).
6. **Poziom szczegółu** (rekomendacja): wszystkie planety 1024 px pod ekranem ładowania; planeta, przy której jest
   gracz, przepiekana do 2048 przy podejściu (~2–5 ms GPU — w strefach przez 2–3 klatki albo w kroku efektów), stara mapa
   zwalniana. 4096 tylko na życzenie (pamięć ×4).
7. Ekonomia, mapa gwiezdna i zapis używają tylko `type` i `seed` — wygląd odtwarza się z nich zawsze tak samo.

## 7. Demo i narzędzia

- `dema/generator-planet.html`: od razu siatka 15 losowych planet (mieszane rodzaje — każdy rodzaj co najmniej raz) w
  widoku gry (kamera z góry, biegun N u góry, słońce w płaszczyźnie gry z boku — terminator przez środek tarczy, 1024 px);
  wybór rodzaju (siatka 15 ziaren jednego rodzaju — zmienność), ziarno, „losuj”, klik w planetę → zbliżenie z obrotem
  (2048 / 4096), suwaki słońca, doby i tempa atmosfery; w rogu czas wypieku i pamięć.
- Zrzuty: `scripts/webgpu/generator-planet-demo.mjs` (siatki, zbliżenia, płaskie mapy `--mapy 1`), pomiar:
  `scripts/webgpu/generator-planet-pomiar.mjs`, testy: `tests/planetGen.test.mjs`.

## 8. Ograniczenia i dalsze kroki

- Detal przy największym zoomie ograniczony rozdzielczością mapy (jak mapy ręczne); szum detalu w shaderze klatki
  wymagałby gałęzi grafu gry.
- Brak hydrologii (rzek dendrytycznych) i symulacji erozji — rzeźba z fbm erozyjnego i krzywizny.
- Cień pierścieni na tarczy olbrzyma i sześciokąt polarny — poza zakresem.
- Księżyce i małe ciała z generatora — ten sam opis (`barren`, `ice`, `volcanic`) na materiale księżyców
  (`moonSurface.tsl.js`) — do zrobienia przy wpięciu.
