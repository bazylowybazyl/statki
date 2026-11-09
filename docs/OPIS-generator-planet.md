# Generator planet z ziarna — opis (2026-11-08, runda 2: grafika)

Prośba użytkownika (2026-11-07): „generator planet — demo … terrańska, gazowa, skalista, piaszczysta, lodowa itp.”.
Tło: układów gwiezdnych ma być dużo (podróż między układami jak w Starsectorze, świat buduje się przy przeładowaniu
strony). Planety Układu Słonecznego to ręczna produkcja (mapy 8K ze skryptów Pythona, ~232 MB na układ) — przy
dziesiątkach układów niewykonalne. Generator robi planetę z opisu `{ type, seed }` w przeglądarce, na GPU, pod
ISTNIEJĄCE materiały gry. Stan: demo do oceny, w grę niewpięty. Reguła obszaru: `.claude/rules/generator-planet.md`.

**Runda 2 (2026-11-08, ocena użytkownika: „planety mają słabą grafikę, są trochę spikselowane, nie widzę wypukłości”;
„mapy normalne?”).** Przyczyny: mapy 2048 × 1024 (rekomendacja 1024 × 512) wobec 8192 × 4096 planet Układu Słonecznego —
przy zbliżeniu teksel ma kilka pikseli, brzeg morza i maski z progu na mapie dają schodki; mapa normalnych RGBA8 z
nachyleniem PRZYCIĘTYM (graf gry nie ma samocienia — mocne normalne świeciły za terminatorem), więc rzeźby nie było
widać. Odpowiedź (§ 1a): materiały generatora nad grafami gry — rzeźba z mapy RGBA16F z cieniem terenu, detal liczony
w shaderze ponad rozdzielczość mapy, morze w shaderze, chmury z detalem; plus ruiny, bieguny olbrzymów, cień pierścieni.
Decyzje użytkownika 2026-11-08 — § 9.

## 1. Decyzja: wypiek map na GPU (nie szum liczony co klatkę)

| kryterium | wypiek do tekstur (wybrany) | szum w shaderze klatki |
|---|---|---|
| wpięcie w grę | te same wejścia co `PLANET_MAPS` — graf powierzchni, chmury, poświaty, mgiełka, pas zachodu, cień ringu, maska słońca, żywa atmosfera olbrzymów bez zmian | nowy graf planety (lub gałąź grafu gry) — drugi model światła do utrzymania |
| koszt klatki | jak dziś (próbki tekstur) | fbm 8–12 oktaw + kratery + normalne z różnic na każdy piksel tarczy: przy tarczy na cały ekran 5120 × 1440 kilka ms GPU co klatkę |
| czas generacji | układ 8 planet 2048 px: **~22 ms GPU, ~60 ms ściany** (+ kompilacja przejść ~1,2 s na zimno, potem z pamięci shaderów) | 0 (kompilacja grafu) |
| pamięć | 1024 px: **~5–9 MB na planetę skalną, 2,7 MB olbrzym, układ 8 planet ~42 MB**; 2048 px: układ ~170 MB (tabela §5) | ~0 |
| zbliżenie | rozdzielczość mapy (4096 px — teksel ~10 km przy Ziemi); detal drobniejszy niż teksel nie powstaje | nieograniczony detal |

Wybór: wypiek — generacja układu w ułamku ekranu ładowania; kształt planety (kontynenty, kratery, pasy) w mapach.
Pamięć załatwia poziom szczegółu wypieku (rekomendacja §6: wszystkie planety 1024 px pod ekranem ładowania, planeta,
przy której jest gracz, przepiekana do 2048 przy podejściu — 5 ms GPU, w strefach przez kilka klatek).

### 1a. Runda 2: materiały generatora nad grafami gry (detal i światło w shaderze klatki)

Sam wypiek (runda 1) dawał obraz ograniczony mapą: przy zbliżeniu rozmycie i schodki, rzeźba bez cienia. Teraz mapy
niosą KSZTAŁT, a materiał dokłada to, czego mapa nie uniesie:

| warstwa | gdzie | co robi |
|---|---|---|
| mapa rzeźby | wypiek (`relief`, RGBA16F) | wysokość [km], nachylenie na wschód / północ [km/km] (Sobel 3 × 3, bez przycięcia), szorstkość — zamiast normalnych RGBA8 (8 bitów dawało schodki na łagodnych stokach, przycięcie zjadało rzeźbę); mipmapy średniej nachylenia = nachylenie średniej wysokości |
| rzeźba i cień terenu | `planetGenSurface.tsl.js` (graf `'genSolid'`) | normalna z mapy × przesadzenie rodzaju; promień ku słońcu po mapie wysokości (12 kroków co ×1,5, próbki z mipmapy odpowiadającej odstępowi kroków, krzywizna kuli) i horyzont z wysokości nad okolicą (√(2h/R)) — szczyty łapią słońce za terminatorem, kratery i góry rzucają cień |
| detal ponad mapę | jw. | 5 oktaw szumu z pochodnymi od fali ~3 tekseli w dół (normalna i jasność), każda gaśnie, gdy jej fala spada poniżej ~3 px — z daleka obraz jak z samej mapy, z bliska bez rozmycia |
| morze | jw. | brzeg z progu wysokości + detalu, szerokość z pochodnej ekranu (ostry i fraktalny przy każdym zbliżeniu); barwa z głębokości (dno przez płycizny: mapa dnia ma pod morzem barwę gruntu, alfa = lód morski) |
| chmury z detalem | `planetGenClouds.tsl.js` (graf `'genClouds'`) | erozja BRZEGÓW chmur szumem ponad mapę (wnętrza pól bez zmian — izotropowy szum w środku rozbijał zawirowania na „popcorn”), lekkie cieniowanie kłębów |
| ruiny | `planetGenRuins.tsl.js` (w obu grafach) | § 4a |

Grafy gry zostały: generator dopisuje rodzaje przez haki (`registerPlanetFlowKind(…, { surface })`,
`registerPlanetCloudKind`) — to samo światło, terminator, pas zachodu, mgiełka, cień ringu, maska słońca, bloom. Bez
haka gałęzie JS nie budują nic nowego: WGSL Ziemi, Jowisza, Saturna i chmur gry porównany bajt w bajt przed i po.

Koszt klatki (RTX, 1920 × 1080, planeta z chmurami na CAŁY kadr, `renderer.render` sceny dema, mediana 24 klatek):
materiały generatora **0,37 ms**, te same mapy na materiałach gry **0,09 ms**, bez planety 0,02 ms. Rozkład: detal
powierzchni ~0,11 ms, detal chmur ~0,075 ms, cień terenu ~0,04 ms, ruiny ~0,004 ms. Przy 5120 × 1440 i tarczy na cały
ekran ~+1 ms; zwykle tarcza zajmuje część kadru. Dalsza oszczędność (niezrobiona): szum detalu z tekstury 3D (jedna
próbka na oktawę zamiast ~100 działań).

## 2. Architektura (`src/3d/planetGen/`)

| plik | rola |
|---|---|
| `planetGenTypes.js` | rodzaje (id wspólne z mapą gwiezdną i `src/data/starSystems.js`), nazwy, typowe promienie |
| `planetGenRng.js` | losowanie z ziarna (mulberry32), strumienie per cel (`rngFor(seed, 'teren')`) — nie `Math.random`, nie `fxRandom` |
| `planetGenSpec.js` | `describePlanet({ type, seed, r?, rKm?, look?, clouds?, night? })` → pełny opis: wygląd rodzaju (podrodzaj, ukształtowanie, klimat, paleta), strojenie materiału gry, mgiełka, poświata (powłoka planet tła i dysk planet przy ringu), chmury, światła nocy, pasy / wiatr / wiry / pierścienie olbrzymów; `plannedMaps`, `plannedBytes` |
| `planetGenNoise.tsl.js` | szum TSL w 3D na kuli: gradientowy, z pochodnymi, komórki (zwykłe i gładkie), oktawa kraterów, fbm, fbm erozyjny, wielofraktal grzbietowy, odkształcenie dziedziny |
| `planetGenBake.tsl.js` | wspólne przejścia wypieku: współrzędne mapy, RZEŹBA (RGBA16F: wysokość, nachylenie, szorstkość), POŁYSK (lawa / lód / solanka — bez morza), NOC (miasta, żar lawy), CHMURY (ziemskie z cyklonami / pokład / pył) |
| `planetGenSolid.tsl.js` | rodzaje z powierzchnią: graf POLA i DNIA na rodzaj + `uniformsFor(spec, ctx)` |
| `planetGenGasBake.tsl.js` | mapa dnia olbrzymów (pasy z adwekcją polem wirowym, wiry w miejscach rekordów silnika, mgła polarna) |
| `planetGenGas.js` | olbrzymy na wspólnym silniku `gasGiantAtmosphere`: graf `'genGas'` raz dla wszystkich, dane planety per obiekt, `GenGasAtmosphere` (zegar 1:1 z Jowiszem) |
| `planetGenRing.js` | pierścienie: profil z ziarna, materiał TSL z cieniem planety |
| `planetGenBaker.js` | `PlanetGenBaker`: grafy raz na klucz, `compile(rodzaje)`, `bakeSystem(opisy, { size })`, cele map, `releaseScratch()` |
| `planetGenSurface.tsl.js` | graf `'genSolid'`: hak powierzchni (rzeźba, cień terenu, detal, morze, ruiny) |
| `planetGenClouds.tsl.js` | graf `'genClouds'`: hak chmur (detal brzegów, kłęby) |
| `planetGenRuins.tsl.js` | ruiny w shaderze (rekordy `uRuin0…15`, poświata z daleka, zarys zburzonego kompleksu z bliska) |
| `planetGenNodes.js` | węzły per obiekt (tablica uniformów, tekstura) i tekstury 1 × 1 |
| `planetGenBody.js` | uniformy materiałów z opisu i map (kształt `DirectPlanet` + klucze generatora), siatki ciała dla dema, `gpuTextures()`, `setRuinValue` |

Zmiana w kodzie gry: tylko DOPISKI w `src/3d/planet3d.assets.tsl.js` — `registerPlanetFlowKind(kind, { keys, color?,
surface?, name })` (dodatkowy rodzaj grafu powierzchni: barwa dnia z przepływu i / albo hak powierzchni),
`registerPlanetCloudKind(kind, { keys, cloud, name })` (rodzaj grafu chmur z hakiem) i nazwa materiału z rejestracji
w `PlanetBodyNodeMaterial`. Rodzaje gry, ich WGSL i `PLANET_GRAPH_KEYS` bez zmian (porównanie WGSL, testy planet,
Jowisza, Saturna).

### Przebieg wypieku układu (`bakeSystem`)

1. **Próby** — dla każdej planety z powierzchnią graf POLA w 192 × 96 do osobnego celu RGBA32F, wszystkie naraz, jeden
   odczyt (`readRenderTargetPixelsAsync`): kwantyle kanału `w` ważone cos φ w ułamkach `probeQ` rodzaju → `uQ` (np. próg
   kontynentalności dający zadany udział oceanu — morze ma dokładnie `look.water` powierzchni).
2. **Pełna rozdzielczość** bez czekania: POLE (RGBA32F, cel wspólny), DZIEŃ, RZEŹBA (RGBA16F), POŁYSK (½), NOC (½), CHMURY —
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
zawinięcia, które silnik potem przesuwa. Ograniczenie: wspólny promień modelu (prędkości wiatru dobrane do niego).

Runda 2: **czapy polarne** silnika włączone (`GEN_GAS_POLES`, granica 72° na obu półkulach — stała w grafie): za granicą
ruch po okręgach wokół bieguna z profilu wiatru planety, jądro obracane sztywnie (kąt z CPU, `uGgPole`). **Bieguny z
ziarna** w mapie wypieku (`look.polar`, osobno N i S): gromada cyklonów — centralny + pierścień 5–9 (jak Jowisz),
sześciokąt dżetu z wirem w środku (jak Saturn) albo sama mgła; przepływ z mapą przepływu (fazy z okresowym resetem)
ich nie rozmywa. **Cień pierścieni na tarczy** (hak `surface` grafu `'genGas'`): pierścienie są równikowe, więc promień
ku słońcu przecina płaszczyznę y = 0 w układzie kuli niezależnie od doby; krycie z profilu pierścieni (`ringTexture` —
ta sama tekstura co siatka, `uGgRing`). **Ruiny unoszące się** — ten sam hak (§ 4a).

### 4a. Ruiny (decyzja użytkownika 2026-11-08)

„Ruiny na planetach — żeby było co eksplorować (przeszukiwać po surowce); ruiny świecą — po tym gracz pozna, czy warto
przeszukać planetę; dotyczy wszystkich planet”. Obraz w shaderze klatki (nie w mapie): ostry przy każdym zbliżeniu,
a wartość ruin gra zmienia w biegu bez wypieku.

- Opis: `spec.ruins` = lista { lat, lon, dir, radius [rad], value 0…1, seed, kind (0 — na gruncie, 1 — unoszące się nad
  olbrzymem) }. Domyślnie z ziarna (strumień `<rodzaj>:ruiny`; ~25% planet bez ruin, wartość zwykle skromna, rzadko
  bogata); `describePlanet({ …, ruins })` — `false` / liczba miejsc z ziarna / tablica { lat, lon, value, size? } z danych
  gry (np. z tabeli eksploracji). Do 8 miejsc (`RUIN_CAP`).
- Obraz: z daleka świecąca plama ≥ 2,5 px (energia zachowana do progu — widać ją z orbity), jasność = `value`, pulsuje;
  z bliska (promień > ~10 px) zarys zburzonego kompleksu: labirynt murów z wyrwami, część murów świeci („żyły”), jasne
  węzły, poszarpany obrys, ciemniejszy gruz (tylko na lądzie); poświata z orbity wtedy gaśnie do mgiełki. Świeci w dzień
  i w nocy (po mgiełce, przez samą ekstynkcję). Barwa `RUIN_GLOW` (turkus), siła planety `uGsMisc.y`.
- Gra: przeszukane ruiny → `body.setRuinValue(i, 0)` (albo `uniforms['uRuin' + (2i + 1)].value.x = 0`) — gasną.
  Rozgrywka (co gracz znajduje, ile to trwa) — do zrobienia w grze; generator daje miejsca i obraz.

## 5. Czasy i pamięć (pomiar 2026-11-08, runda 2)

`node scripts/webgpu/generator-planet-pomiar.mjs` — headless Chrome, RTX (maszyna użytkownika), klatki dema wstrzymane,
czas GPU ze znaczników czasu (tylko przejścia wypieku), mediana 3 ziaren. Pamięć — mapy z mipmapami (`plannedBytes`).

| rodzaj | kompilacja na zimno [ms] | 1024: GPU / ściana [ms] / MB | 2048: GPU / ściana / MB | 4096: GPU / ściana / MB |
|---|---|---|---|---|
| terran | 401 | 1,0 / 16 / 11,3 | 3,8 / 15 / 45,3 | 18,8 / 32 / 181 |
| ocean | 482 | 1,0 / 15 / 10,7 | 4,0 / 15 / 42,7 | 19,7 / 34 / 171 |
| desert | 560 | 0,6 / 14 / 8,0 | 3,1 / 13 / 32,0 | 11,9 / 24 / 128 |
| rocky | 480 | 0,5 / 12 / 8,0 | 2,1 / 15 / 32,0 | 11,3 / 23 / 128 |
| ice | 378 | 0,5 / 15 / 8,2 | 1,9 / 14 / 32,7 | 9,4 / 21 / 131 |
| volcanic | 491 | 0,7 / 15 / 8,7 | 2,7 / 16 / 34,7 | 12,0 / 25 / 139 |
| barren | (przy starcie) | 0,5 / 13 / 8,0 | 2,1 / 13 / 32,0 | 11,0 / 23 / 128 |
| toxic | 291 | 0,5 / 13 / 10,7 | 2,2 / 15 / 42,7 | 10,8 / 22 / 171 |
| gas | 897 | 0,6 / 7 / 2,7 | 2,1 / 8 / 10,7 | 9,6 / 16 / 43 |
| ice_giant | (wspólny z gas) | 0,5 / 7 / 2,7 | 2,1 / 9 / 10,7 | 9,6 / 16 / 43 |

Runda 2: mapa rzeźby RGBA16F (8 B na teksel) zamiast normalnych RGBA8 — pamięć planety z powierzchnią +~40%, czas
wypieku bez zmian; terran i ocean bez mapy połysku (morze w shaderze).

- Kompilacja WSZYSTKICH przejść jednym wywołaniem (równolegle w tle): ~1,2 s na zimno; Chrome trzyma skompilowane
  shadery na dysku, więc kolejne starty płacą mniej. Na układ potrzeba tylko przejść rodzajów w nim obecnych.
- Układ 8 planet (terran, rocky, desert, gas ×2, ice_giant, ice, barren): **1024 px — GPU 5,0 ms, ściana 48 ms, mapy
  55,7 MB; 2048 px — GPU 21 ms, ściana 53 ms, mapy 223 MB** (+ pole robocze 8 / 32 MB do `releaseScratch`).
- Dla porównania: ręczny Układ Słoneczny ~232 MB map.
- Ściana zależy od taktu urządzenia: przy rysowanych klatkach odczyt próby czeka na takt (~1 klatka w grze; w headless
  z klatkami ~200 ms) — dlatego próby są na układ, nie na planetę.

## 6. Wpięcie w grę (dla orkiestratora — nie zrobione)

1. **Ekran ładowania**: `const baker = new PlanetGenBaker(Core3D.renderer)` (w workerze renderu — w workerze, jak reszta
   `Core3D`); `await baker.compile(rodzaje układu)` — przejścia przez `compileAsyncNaCelu` (pułapka 30); wpis w
   `Core3D.warmup` (`run('generator planet', …)`) albo w kroku przygotowania układu.
2. `const maps = await baker.bakeSystem(opisy, { size: 1024 })`, potem `baker.releaseScratch()`. Opisy z tabeli układów:
   `describePlanet({ type, seed, r })` — ziarno z ziarna układu i indeksu planety (np. `mix32(ziarnoUkładu, i)`).
3. **DirectPlanet z opisu**: uniformy `planetSurfaceUniforms(spec, maps)` (klucze gry + generatora), materiał
   `createGenSolidSurfaceMaterial(uniforms)` (graf `'genSolid'`), chmury `planetCloudUniforms` +
   `createGenCloudMaterial` (graf `'genClouds'`), poświata `planetHaloUniforms` (planety tła) albo
   `planetRingAtmUniforms(spec, R)` (planety przy ringu); strojenie z `spec.surface` zamiast gałęzi po nazwie
   (`uBrightness`, `uSunIntensity`, `uSpecular`, bloom). Czas ruin: `uniforms.uGsMisc.value.x` (sekundy obrazu,
   `Core3D.frameNowMs()` — nie `performance.now()`).
   Zależności od nazw (`RING_PLANET_NAMES`, jasność i atmosfera po nazwie w `planet3d.assets.js` ~759–875) — dla planet
   generatora z opisu.
4. **Olbrzymy**: `createGenGasSurfaceMaterial(uniforms)` + `new GenGasAtmosphere(maps.gas, planet, null)` i co klatkę
   `atmosphere.step()` (czas gry z `SimClock` — jak Jowisz); **pierścienie — wpiąć razem z olbrzymami (decyzja
   użytkownika 2026-11-08: „pierścienie muszą być”)**: `createGenRingMesh(spec, uniforms.sunPosition)` do warstwy passa
   planety i do rozgrzewki, a w uniformach planety `uGgRing` + `ringTexture` (cień pierścieni na tarczy — robi to
   `createGenPlanetBody`; w grze to samo przy budowie DirectPlanet).
5. **Rozgrzewka materiałów** planet (`'genSolid'`, `'genClouds'`, `'genGas'`, pierścienie — wpisy `Core3D.warmup`);
   tekstury czytane węzłami per obiekt, które nie są celami wypieku (profil pierścieni), na GPU przed pierwszym
   rysunkiem — `renderer.initTexture` każdej z `body.gpuTextures()` (wzór: `compileBody` w demie).
6. **Poziom szczegółu** (zatwierdzony przez użytkownika 2026-11-08): wszystkie planety 1024 px pod ekranem ładowania;
   planeta, przy której jest gracz, przepiekana do 2048 przy podejściu (~2–5 ms GPU — w strefach przez 2–3 klatki albo
   w kroku efektów), stara mapa zwalniana. Detal w shaderze sprawia, że 2048 przy zbliżeniu nie rozmywa się jak dawniej;
   4096 tylko na życzenie (pamięć ×4).
7. Ekonomia, mapa gwiezdna i zapis używają tylko `type` i `seed` — wygląd odtwarza się z nich zawsze tak samo.

## 7. Demo i narzędzia

- `dema/generator-planet.html`: od razu siatka 15 losowych planet (mieszane rodzaje — każdy rodzaj co najmniej raz) w
  widoku gry (kamera z góry, biegun N u góry, słońce w płaszczyźnie gry z boku — terminator przez środek tarczy, 1024 px);
  wybór rodzaju (siatka 15 ziaren jednego rodzaju — zmienność), ziarno, „losuj”, klik w planetę → zbliżenie z obrotem
  (2048 / 4096), suwaki słońca, doby i tempa atmosfery; w rogu czas wypieku i pamięć.
- Zrzuty: `scripts/webgpu/generator-planet-demo.mjs` (siatki, zbliżenia, płaskie mapy `--mapy 1` — dzień, rzeźba
  cieniowana, połysk, noc, chmury), pomiar wypieku: `scripts/webgpu/generator-planet-pomiar.mjs`, testy:
  `tests/planetGen.test.mjs`.
- Próby A/B na JEDNYM kadrze: `scripts/webgpu/generator-planet-proby.mjs --planeta rocky:3 --kadr 1.6,0.6,0.15
  --wariant "bez-cienia=U.uGsShade.value.y=0;;bez-detalu=U.uGsGeo.value.w=0"` (`B` — ciało, `U` — jego uniformy,
  `G` — `window.__gen`; tekst z `window.__zrzut` → plik .txt — np. WGSL z `renderer.debug.getShaderAsync` albo czasy
  GPU klatki: `renderer.render` + `resolveTimestampsAsync` przy wstrzymanych klatkach dema).

## 8. Ograniczenia i dalsze kroki

- Detal w shaderze to szum ogólny (szorstkość z mapy); bez wydm, małych kraterów i rzek generowanych w biegu.
- Brak hydrologii (rzek dendrytycznych) i symulacji erozji — rzeźba z fbm erozyjnego i krzywizny.
- Brak cienia chmur na gruncie (chmury mają własny obrót — potrzebny kąt chmur względem gruntu w uniformie).
- Koszt detalu przy tarczy na cały ekran (§ 1a) — możliwa tekstura szumu 3D zamiast szumu liczonego.
- Sześciokąt i cyklony biegunowe są w mapie wypieku, nie w przepływie (Saturn gry ma sześciokąt w przepływie).

## 9. Decyzje użytkownika (2026-11-08, po ocenie dema)

1. Rozdzielczość map: 1024 px wszystkie, 2048 przy podejściu — zatwierdzone.
2. Mgiełka terrańskich słabsza i bielsza — zatwierdzone.
3. Światła miast z tabeli układów (frakcje), ziarno jako wartość domyślna — zatwierdzone; DO TEGO ruiny na wszystkich
   planetach, świecące, do eksploracji (§ 4a).
4. Obca roślinność na ~30% terrańskich — zatwierdzone.
5. Bieguny olbrzymów — użytkownik nie zrozumiał pytania; zrobione: czapy polarne obracają się, bieguny z ziarna
   (cyklony / sześciokąt / mgła), § 4.
6. Pierścienie wpiąć do gry razem z olbrzymami — „pierścienie muszą być” (§ 6, krok 4).
7. „Poprawiaj grafikę” — runda 2 (§ 1a).
- Księżyce i małe ciała z generatora — ten sam opis (`barren`, `ice`, `volcanic`) na materiale księżyców
  (`moonSurface.tsl.js`) — do zrobienia przy wpięciu.

## 10. Planeta z bliska: wycinek mapy pod kamerą, lawa, erupcja, chmury (2026-11-09, demo)

Prośba użytkownika (2026-11-09): „piękne proceduralne planety, z wolumetrycznymi chmurami, wulkanami … brakuje mi …
grafiki na zbliżeniu. Może cała proceduralna planeta 3D bez tekstur?” — i w trakcie pracy: „odpicuj też terrańską”.
Odpowiedź: planeta liczona w całości szumem co klatkę — nie (§ 1: duże kształty wymagają wypieku, koszt klatki);
potrzebę (ostry obraz przy każdym zbliżeniu) załatwia WYPIEK W BIEGU SAMEGO WYCINKA POD KAMERĄ. Demo:
`dema/planeta-zblizenie.html` (wulkaniczna w trzech stylach i terrańska), w grę niewpięte.

### 10.1. Wycinek pod kamerą (`planetGenPatch.js`, `PlanetGenBaker.bakePatchStep`)

- Te same grafy wypieku co mapa planety (to samo pole, progi z próby całej planety), cel = OKNO siatki długość /
  szerokość w układzie OBRÓCONYM (sześć układów — ściany sześcianu; okno leży przy „równiku” układu, teksele prawie
  kwadratowe także na biegunach planety). `bakeCoords` ma gałąź okna (`uWin`, `uFrX / Y / Z`): kierunek z kątów okna,
  prawdziwa szerokość i długość z kierunku (klimat, pasy), odległości tekseli w układzie siatki (`latGrid`, `stE`,
  `stN` — nachylenia). `fieldAt` w oknie przycina obie osie.
- SIATKA STAŁA: poziom k ma teksel = teksel mapy planety / 2^k, początek okna = wielokrotność 16 tekseli. Po
  przesunięciu okna ten sam punkt trafia w ten sam teksel — pomiar: kadr przed przesunięciem okna i po powrocie różni
  się o 0 / 255. Obraz zmienia się przy zmianie poziomu (zbliżenie o oktawę) i układu (krawędź ściany: średnio
  ~1 / 255, najwyżej ~24 / 255) — wtedy stare okno przenika w nowe (dwa miejsca A / B, 0,3 s).
- WYPIEK W PASACH: okno 4096 × 2048 to ~16 ms GPU naraz (wulkaniczna; terrańska z oknem chmur ~22 ms), okno
  2048 × 1024 — 4–5 ms. Kroki `patchSteps`: pasy pola, potem dnia, rzeźby, masek (nożyce, bez czyszczenia celu,
  mipmapy po ostatnim pasie), krok na klatkę (~1,6 ms GPU), ~10 klatek dla okna 4096; wypiek rusza, gdy kadr podejdzie
  na 6% okna do jego brzegu (okno = kadr × 1,5). Suma kosztu ta sama, obraz identyczny (pomiar jw.).
- Pamięć: dwa miejsca powierzchni (dzień sRGB, rzeźba RGBA16F, maski RGBA8, z mipmapami) i dwa okna chmur =
  107 MiB przy oknie 2048 × 1024 (ekran do ~3000 px szerokości) albo 427 MiB przy 4096 × 2048, do tego cel pola
  (RGBA32F) 32 / 128 MiB. DO DECYZJI przy wpięciu: okno 4096 tylko na Ultra albo jedno miejsce bez przenikania.
- WARUNEK: przesunięcie dziedziny szumu MAŁE (`seedOffset` 1,5–6,5 zamiast 20–420). float32 przy wartościach rzędu
  setek ma krok ~3·10⁻⁵ rad — tyle, co teksel wycinka poziomu 6; rzeźba wychodziłaby w schodkach. Zmiana zakresu
  zmieniła wygląd WSZYSTKICH planet z ziarna (generator niewpięty — bez skutków w grze).
- WARUNEK: pole zgodne między poziomami — fbm z dzielnikiem stałym (`full`: suma całego szeregu, nie policzonych
  oktaw), sufity oktaw ponad mapy planety, obiekty rodzaju (wulkany, rzeki, kłęby) wchodzące bramką z rozmiaru
  w tekselach. Zrobione dla `volcanic` i `terran` / `ocean` (pole, dzień) i dla chmur; pozostałe rodzaje pieką się
  w oknie, ale bez tej zgodności (krzywizna w barwie zależy od teksela, normowanie do policzonych oktaw).

### 10.2. Błędy generatora odsłonięte przez zbliżenie (poprawione)

- RZEŹBA ODWRÓCONA W OSI PÓŁNOC–POŁUDNIE: `buildReliefGraph` negował pochodną na północ (komentarz zakładał wiersz
  celu rosnący ku południowi; wiersz rośnie ku północy). Przy słońcu z północy oświetlona ściana krateru była ciemna.
  W grze słońce leży w płaszczyźnie gry, więc światło z osi N–S pada na planetę zawsze, gdy stoi „nad” albo „pod”
  słońcem na mapie.
- SKOKI NA KRAWĘDZIACH KOMÓREK: stożki, kaldery, potoki i pierścienie opadu rodzaju `volcanic` liczyły się z „haszu
  najbliższej komórki × profil odległości” — profil urywał się na krawędzi komórki (uskoki ~100 m, wielokątne łaty
  osadów w stylu siarki). Teraz pętla po 27 komórkach, każde miejsce dokłada własny profil (`forSites`).
- NaN Z GAŁĘZI WYŁĄCZONEJ: gałąź okna w `bakeCoords` z zerami w uniformach (cała mapa) liczyła normalize(0) i
  atan2(0, 0) — kompilator GPU wykonał ją spekulatywnie i pole całej planety wyszło NaN (czarne mapy, bez błędu).

### 10.3. Rodzaj `volcanic` z bliska

- Trzy skale wulkanów (`volcanoLayer`): tarcze z kalderą (5 komórek / rad), stożki z kraterem, żlebami i strugami
  lawy (24), stożki żużlowe tylko w wycinku (105); styl siarki — w ich miejscu patery (niecka, jezioro lawy w części
  dna, płaty potoków, pierścień opadu). Pola zastygłych potoków: płaty jeden na drugim, czoło potoku = próg szumu
  (skarpa łapiąca niskie słońce). Styl lawy: szwy skorupy w czterech skalach, nie węższe niż teksel.
- LAWA W MATERIALE (`planetGenSurfaceNear.tsl.js`): żar z maski cieczy (HDR, w dzień i w nocy — mapa nocy piecze się
  wtedy bez lawy): jeziora — płyty skorupy (Worley dwóch skal) dryfujące w dół stoku (kierunek z mapy rzeźby, dwie
  fazy przenikane) i z wolnym wirem na płaskim; strugi — gorący rdzeń, ku brzegom kry. Barwa z temperatury; odcień
  z palety planety tylko słaby (pełna barwa palety, liniowo ~(1; 0,15; 0,01), zostawiała samą czerwień).
- ERUPCJA (`planetGenPlume.tsl.js`): pióropusz = jedna gęstość analityczna (kolumna + parasol znoszony wiatrem,
  szum kłębów) w trzech miejscach: bryła liczona marszem promienia (36 kroków w powłoce nad powierzchnią, światło
  3 krokami ku słońcu, cień planety — szczyt łapie słońce za terminatorem, wyładowania w parasolu), cień na gruncie
  (8 kroków ku słońcu w materiale powierzchni), światło fontanny lawy na okolicy.

### 10.4. Rodzaj `terran` z bliska

- Pole: rzeki (linia zera szumu z pochodnymi — odległość = |szum| / |gradient|, stała szerokość; dolina wycięta w
  rzeźbie, nie niżej niż 160 m n.p.m.) i jeziora w kanale cieczy; drobna plamistość lądu z oktaw rozdzielczości.
- Morze w materiale: fale (normalna z czterech oktaw szumu), iskrzenie (wąski odblask na normalnej fal, płatami
  wiatru), przybój; szeroki odblask grafu gry słabnie z rozmiarem piksela (z bliska dawał mleczną taflę na cały kadr).
- CHMURY (`planetGenCloudsNear.tsl.js`): okno mapy chmur w układzie kuli chmur; z bliska drobne oktawy i kłęby w
  dziedzinie SUROWEJ (izotropowej) — w dziedzinie skręconej przez cyklony i odkształconej wychodziły rozmazane smugi,
  a komórki Worleya dawały równe owalne „cekiny”. Bryłowatość BEZ marszu promienia: maska = grubość, światło gaśnie
  z grubością chmur po drodze ku słońcu (dwie próbki maski przesunięte o wysokość chmur / tangens wysokości słońca).
  Cień chmur na gruncie: mapa chmur planety w punkcie przesuniętym ku słońcu (materiał powierzchni, `uGnCloud`).
- Pełny marsz promienia przez chmury świadomie nie: kamera gry patrzy z góry bez paralaksy — boków chmur nie widać,
  głębię niesie światło i cień. Marsz opłaca się tam, gdzie okręt wlatuje w chmury (pokład olbrzyma w płaszczyźnie
  gry, na polu gazu) — nie zrobione.

### 10.5. Koszt (headless Chrome, RTX; kadr w całości na planecie przy 1 px = 1 j. gry, promień planety 12 600 j.)

| kadr | 5120 × 1440, okno 4096 × 2048 [ms GPU] | 1920 × 1080, okno 2048 × 1024 [ms GPU] |
|---|---|---|
| wulkaniczna, wycinek | 1,7 | 0,53 |
| wulkaniczna, sama mapa planety (drabina detalu od poziomu 0) | 2,4 | 0,78 |
| wulkaniczna, pióropusz na cały kadr | 4,3 | 2,5 |
| wulkaniczna, pióropusz przy 0,45 px / j. | 2,7 | 1,2 |
| terrańska z chmurami, wycinek | 2,3 | 0,70 |
| terrańska, sama mapa planety | 3,5 | 1,0 |
| cała tarcza | 0,8–0,9 | 0,5–0,6 |
| wypiek okna (suma kroków): wulkaniczna / terrańska z chmurami | 15,8 / 21,6 | 4,2 / 5,3 |

Czasy klatki z postem dema (bloom, ACES — sam post 0,45 ms przy 5120 × 1440). Rozkład (A/B na jednym kadrze,
5120 × 1440): cień terenu ~0,6 ms (12 próbek rzeźby), morze ~0,3 ms, chmury ~0,35 ms; każdy szum liczony na cały
kadr to ~0,1–0,15 ms. Najdroższy jest pióropusz z bliska — przy wpięciu: mniej kroków albo pół rozdzielczości.

### 10.6. Narzędzia

- Demo: `dema/planeta-zblizenie.html` (`?styl=popiol|lawa|siarka|terran`, `?ziarno=N`, `?wycinek=2048|4096`,
  `?wycinki=0`, `?erupcja=0`, `?pora=`, `?x=&y=&zoom=`, `?test=1`, `?gpu=1`), `window.__zbl` (`setView`, `goVent`,
  `advance(s)`, `measureGpu(n)`, `snapshot()`, `viewDirs()`).
- Zrzuty: `node scripts/webgpu/planeta-zblizenie-demo.mjs --styl terran --kadry planeta,daleko,wulkan,blisko,bez-wycinka`
  (kadry: daleko, wulkan, blisko, bardzo-blisko, bez-wycinka, noc, planeta albo `nazwa:x,y,zoom`).
- Testy: `node --test tests/planetGenNear.test.mjs` (układy i siatka okna, wypiek w pasach, uniformy, WGSL).

### 10.7. Do decyzji i dalsze kroki

- Wpięcie: planeta, przy której jest gracz, na materiale `genSolidNear` (dalsze zostają na `genSolid`); kierunki
  kadru z kamery gry; kroki wypieku w kroku efektów Core3D; rozgrzewka trzech nowych materiałów.
- Rozgrywka (nie zrobiona): pióropusz sięgający płaszczyzny gry jako strefa (zagrożenie, osłona przed czujnikami),
  trwałe blizny po ostrzale (rekord krateru + ponowny wypiek okna).
- Zgodność poziomów dla pozostałych rodzajów (desert, rocky, ice, barren, toxic) — jak w § 10.1.
- Pasma cirrusów z bliska: smugi bez drobnego detalu (pręgowane łaty) — osłabione w wycinku, nie zastąpione.
- Wąskie zatoki-ryfty kontynentów (`rift` w `plates`) z bliska rwą się w łańcuch ciemnych odcinków morza.
