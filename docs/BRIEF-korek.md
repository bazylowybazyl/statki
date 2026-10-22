# BRIEF: elektrownia „KOREK” w wielkim gryzie Ziemi — megaprojekt klasy AAA

Prośba użytkownika (2026-10-22): „wymodeluj ją porządnie — dopracuj tę dziurę, żeby była production ready. Windy,
promień, obudowa dziury — megaprojekt godny gry AAA”. Wcześniejsze decyzje: zamiast dymu — geotermalna elektrownia,
czarna megabudowla w kształcie korka zatykająca jądro, z małym otworem pośrodku; zamiast buchania lawy — PROMIEŃ
wysyłający prąd do ringu; infrastruktura wokół korka i kilka wind kosmicznych; bez 4 klamer nad otworem (otwór trzyma
pole siłowe). Ring orbitalny Ziemi z gry; WINDY IDĄ DO RINGU („winda ma być do ringu planetarnego”).

ZIEMIA OBRACA SIĘ WOKÓŁ OSI RINGU (decyzja użytkownika 2026-10-22, `src/3d/earthSpin.js`): oś doby prostopadła do
płaszczyzny gry (ku kamerze), ring gry równikowy i NIERUCHOMY względem gruntu — liny wind i promień przekaźnikowy
odbiornik → ring są STAŁE w układzie Ziemi (geometria w grupie elektrowni). Ring rozgrywki stoi (kolizje, hale K-7),
z Ziemią obraca się tylko WEWNĘTRZNA SZYNA RINGU z wózkami wind (jak płaszcz prawdziwego pierścienia orbitalnego;
buduje ją rola wind). Magazyn odbiornika: `uPlantState.y` (naładowanie), `uPlantState.x` — przekaz 0…1 (przy ringu
równikowym zawsze 1; gdyby linia przechodziła przez planetę — 0 i magazyn się ładuje).

Obraz (zasada żelazna 1): rozgrywka tego nie widzi. Pliki: `src/3d/earthBitePlant*.js`, demo
`dema/planety-webgpu.html?korek=1` (dodatek `dema/planety-slup.js`), zrzuty `scripts/webgpu/slup-demo.mjs`,
test `tests/earthBitePlant.test.mjs`.

## Skala i kadr — co gracz naprawdę widzi

- Ziemia: R = 1 w układzie brył = 37 800 j. gry ≈ 6 371 km. 0,001 R ≈ 6,4 km ≈ 38 j.
- Gryz: kula o promieniu β ≈ 0,46 R ze środkiem C na powierzchni; dno na wysokości 0 ramy (z0 = 0,54 od środka Ziemi),
  płaszczyzna brzegu ~0,354 nad dnem, promień brzegu ~0,41–0,48 (brzeg nieregularny: płaty i ŁUKI ZĘBÓW). Dno to
  jezioro płaszcza ~2 500 K (żar, płyty skorupy, rzeki ze ścian) — rysuje je shader gryzu (`earthBite.tsl.js`), nie my.
- Korek: promień wierzchu 0,13 R (≈ 830 km), wierzch 0,053 nad dnem, krater wylotu 0,073. Odbiornik: 1,075 R od środka
  Ziemi (0,535 nad dnem, nad wylotem gryzu, pod ringiem 1,09–1,16 R), pierścień 0,05 R. Liny wind ~0,49 R (~3 100 km).
- Ring „Halo” Ziemi: wewnętrzna krawędź 41 800 j. = 1,1058 R (`PLANT_LAYOUT.ringInnerR`), zewnętrzna 43 752 j.
  (1,157 R), w płaszczyźnie gry przez środek Ziemi; od wnętrza Ziemi oddziela go SZCZELINA 1,0–1,106 R.
- Kamera gry: ORTO znad BIEGUNA OBROTU (oś ringu), Ziemia w passie ring-planet (warstwa 6, bez paralaksy), zoom
  0,035–3,2 px/j. Przy zoomie minimalnym 1 px ≈ 0,00076 R; przy typowym (0,2–0,5) 1 px ≈ 0,0001 R. Tarcza obraca się
  jak koło (doba ~314 s), gryz (10° N) leży 10° nad płaszczyzną ringu, więc krąży PRZY KRAWĘDZI TARCZY: z kamery gry
  widać WCIĘCIE W OBRYSIE (szerokie na ±25° obwodu), a przez nie górną część ścian, koronę brzegu z emiterami, promień
  wychodzący z wcięcia, odbiornik tuż za krawędzią tarczy (1,059 R od osi, w szczelinie pod ringiem), krótki promień
  przekaźnikowy do ringu, liny wind przez szczelinę do szyny ringu i samą szynę z wózkami. KOREK NA DNIE z kamery gry
  jest pod powierzchnią — widać go w kadrach szczegółów (perspektywa: przerywniki, demo, ewentualne ujęcia kinowe).
  Kadry `gra-*` w demie (`__slup.viewGame`) to widoki gry; ich jakość jest PRIORYTETEM, kadry szczegółów — jakość z bliska.
- FASADA BOHATERA (krytyk, runda 2): biegun obrotu jest stały w układzie Ziemi, więc w ramie gryzu kadr gry to ZAWSZE ten
  sam rzut — z północy, ~10° nad płaszczyzną elektrowni (zmienia się tylko obrót obrazu, zoom i światło). Gracz zawsze
  widzi od frontu fasadę POŁUDNIOWEJ korony i górny pas południowej ściany (h ≈ 0,19–0,354, azymut ≈ 200–340°), północną
  koronę od zewnątrz, promień z boku, pierścienie zamknięcia i odbiornik prawie z profilu. Południk gryzu (azymuty 90°
  i 270°) zawiera kierunek kamery — wszystko w nim rzutuje się na promień: tam nie ma wind (`L.elevators` = 0, 60, …, 300),
  a na osi 270° stoi BRAMA PROMIENIA obudowy (pylony od stopy ściany, wieże nad koroną, nadproże z cewkami).
- HIERARCHIA JASNOŚCI w kadrze gry: promień > liny wind (z pakietami energii) > korona i maszty pola > cięciwy pola i listwy.
- Wniosek: TRZY skale detalu, każda czytelna w swoim zakresie: (1) sylwetka i rytm świateł czytelne przy 0,00076 R/px
  (wcięcie z koroną świateł, promień, odbiornik, wachlarz lin do szyny ringu), (2) budowle 0,002–0,02 R w geometrii
  (hale, wieże, żebra, kratownice, doki, wózki), (3) mikro-detal w shaderze 0,0001–0,002 R (panele, okna, szwy, listwy),
  gasnący do średniej, gdy jest drobniejszy niż piksel (bez migotania).

## Kierunek artystyczny

- CZARNA MEGASTRUKTURA: metal prawie czarny (albedo 0,03–0,05), anodowany, z odmianą paneli; czytelność daje światło:
  krawędzie łapiące słońce, emisja i odblaski. Brutalizm przemysłowy science fiction (skala Forerunnerów / Diuny /
  Blade Runnera 2049), nie plastik i nie „kosmiczna stacja z klocków”.
- PALETA (bez tęczy): czerń + żar lawy (pomarańcz 2 500 K, od dołu i z boków) + energia (chłodny cyjan → biel w rdzeniu)
  + rzadkie ciepłe okna + czerwone / białe światła pozycyjne. Energia płynie: korek → promień → odbiornik → ring; przewody
  i cewki mają barwę energii, kadłuby i okna — ciepłe.
- ŚWIATŁO: słońce tylko przez otwór (ściany gryzu rzucają cień — `sunLit`), poza gryzem cień kuli Ziemi, maska słońca gry
  (`sunVisibility`); w gryzie — żar jeziora z dołu i z boków (słabnie z wysokością), poświata promienia (cyjan, przy
  osi); nocą zostaje emisja i lawa. Emisja HDR: > 1 świeci (próg bloomu ~0,9) — rdzeń promienia, cewki, światła
  pozycyjne; okna ~1–2; szwy i drobne listwy POD progiem (inaczej cała budowla rozmywa się w bloomie).
- KOMPOZYCJA: w kadrze gry — wcięcie w obrysie obramowane koroną świateł i masztami pola, z którego wybiega promień do
  odbiornika, a od brzegu wachlarz lin przez szczelinę do ringu (energia i ruch: pakiety, kabiny, wózki); w kadrach
  szczegółów — koncentryczne pierścienie (tarasy korka, cewki krateru, pierścienie zamknięcia, korona) i promieniste
  szprychy (mosty nad lawą, żebra ścian, przewody). Symetria 6-krotna z lekkim złamaniem (ziarna).
- Bez nakładek debug, bez napisów, bez czaszek; wszystko powtarzalne (ziarna `plantRng`, czas `uPlantTime`).

## Kontrakt (nie łamać bez zgody orkiestratora)

- RAMA ELEKTROWNI (`earthBitePlantFrame.js`): Y = oś gryzu A, X = wschód E, Z = −N (południe); początek na dnie, y —
  wysokość nad dnem. Pomocnicy: `surfacePoint` / `surfaceUp` (kula Ziemi), `bowlPoint` (ściana / dno gryzu, dokładne
  β(φ, ψ) z płatami i zębami, `lift` — nad powierzchnię), `bowlInward`, `rimAngle(φ)` / `rimPsi(φ)` (brzeg w azymucie φ),
  `basisAt`, `cylinderBetween`, `plantRng(ziarno)`, `hubHeight`, `PLANT_LAYOUT` (wspólne wymiary).
- KOMPONENT = plik z `XXX_DEFAULTS` (klucze z przedrostkiem komponentu — test pilnuje) i `buildXxx(L, b)` →
  `{ metal: części[], flow: części[] }` w ramie. Opcjonalnie `export const extras = [fabryka]`, fabryka
  `(uniforms) → { object, applyLook(L, b, matrix), update(time, dt), meshes(), dispose() }` — własne siatki
  (np. kabiny wind na GPU); `object` jest dzieckiem grupy elektrowni (układ OBIEKTU kuli: geometria × `matrix`),
  `meshes()` idą do rozgrzewki. Każdy nowy materiał — graf RAZ na moduł (zmienna modułu), lekkie materiały na nim.
- CZĘŚĆ = geometria po `finalizePart(g, PART.X, ziarno, z, w)`: atrybuty position, normal, uv, `aPart` (rodzaj, ziarno
  0…1, z, w) + indeks. Znaczenie z / w i uv per rodzaj — `PART` w `earthBitePlantFrame.js`:
  HULL 0 (kadłub: panele, szwy, drobne światła), STRUCT 1 (stal konstrukcyjna, ciemniej, bez okien), WINDOW 2 (z —
  gęstość zapalonych), STRIP 3 (listwa: z — jasność ×, w — 0 ciepła / 1 chłodna), COIL 4 (cewka energii: z — faza, w —
  jasność ×; w = −1 → wskaźnik MAGAZYNU: jasność wg `uPlantState.y`, szybszy puls przy przekazie), HOT 5 (żar: z 0…1
  per wierzchołek), BEACON 6 (światło pozycyjne: z — częstotliwość, w — 0 czerwone / 1 białe), GLASS 7 (ciemne szkło),
  PIPE 8 (przewód: uv.y wzdłuż, z — długość [R], w — kierunek impulsów ±1), TETHER 9 (lina: uv.y 0 kotwica → 1
  ring (dok wózka na szynie), z — długość, w — pas kabin ±1). Metal: rodzaje 0–7, przepływ: 8–9. WŁASNE UV CZĘŚCI:
  z < 0 przy HULL, STRUCT, WINDOW, STRIP, HOT i COIL — wzór idzie po uv części w [R] (uv.x wzdłuż, uv.y w poprzek
  profilu — części przeciągane: korona, galerie, osłony, żebra; cewka: uzwojenia w poprzek uv.x — na małych walcach
  i pierścieniach rzut pudełkowy dawał ukośne paski jak litery), |z| to parametr rodzaju (cewka — faza; runda 5);
  z ≥ 0 — rzut pudełkowy w ramie.
- ŚWIATŁO POZYCYJNE NA BRYLE (runda 5): pudełko BEACON ma uv 0…1 na każdej ścianie, więc świecący środek KAŻDEJ ściany
  czytał się za dnia jak kostka do gry — światło to oprawa ze stali (STRUCT, pięć ścian) i soczewka na jednej ścianie
  (BEACON; windy: `lampBox`, odbiornik: `lamp` — oprawa sześciokątna z kopułką).
- UNIFORMY (`PLANT_KEYS`, `earthBitePlantCommon.tsl.js`): wspólne obiekty `{ value }` wszystkich materiałów
  elektrowni; `uPlantTime`, `uPlantShape` (z0, światło jeziora, —, h korka), `uPlantBeam` (jasność, h wylotu, h odbiornika,
  promień rdzenia), `uPlantLayer` (warstwa siatki przezroczystej), `uPlantBeamLen`, `uPlantState` (przekaz, magazyn),
  `uPlantCork` (promień korka, h wierzchu, h wylotu, gardziel), `uPlantHub` (h odbiornika, pierścień), `uPlantMisc`
  (zapas). Nowy klucz = zmiana w Common i w orkiestratorze (zgłoś).
- WINDY IDĄ DO RINGU PLANETARNEGO (decyzja użytkownika 2026-10-22: „winda ma być do ringu planetarnego”), nie do
  odbiornika — odbiornik nie ma doków lin (jest tylko odbiornikiem promienia, magazynem i nadajnikiem przekazu do ringu).
  Kotwice stoją w `rimAngle(φ) + anchorPad` w azymutach `L.elevators`, przewody obudowy dochodzą do nich
  (`liningTerminalPoint(L, b, φ)` — koniec wiązki rur na placu korony). Lina: szczyt wieży kotwicy → najbliższy punkt
  wewnętrznej krawędzi ringu: `ringPointObject(P, oś, L.ringInnerR)` w układzie OBIEKTU kuli (oś obrotu
  `earthSpinAxis()` z `src/3d/earthSpin.js`; rama ↔ obiekt: `plantFrameMatrix` / `objectToFrameMatrix`). Lina z kotwicy
  > ~35° nad płaszczyzną ringu przechodzi przez planetę (`segmentClearsSphere`) — przy biegunie w 90° N i windach
  w azymutach 0, 60, …, 300 wszystkie 6 lin sięga ringu bez rozwidleń (najwyżej ~32°, azymuty 60° i 120°).
  Z Ziemią obraca się SZYNA w wewnętrznej krawędzi ringu (oś w ringInnerR − 0,0045) z wózkami w punktach zaczepu lin;
  kabiny (48, jeden rysunek) jadą po linach na GPU z postojami w dokach (`earthBitePlantClimbers.tsl.js`).
- PROMIEŃ (rola BEAM, runda 1): warstwy `uPlantLayer` 0 — rdzeń / otoczka / włókna / pakiety, 1 — poświata,
  2 — przekaźnik, 3 — rozbłyski; pierścienie zamknięcia od y = 0,13 do ~0,48 (nad zębami-emiterami korka — w promieniu
  r < 0,05 od osi nic powyżej y ≈ 0,12); koniec promienia i rozbłysk uderzenia na `hubHeight − 0,01` (spód czaszy
  odbiornika), kula ładowania w środku nadajnika (r ≤ 0,0038). Przekaźnik w grupie elektrowni (`attachRing`).
- STOPA ŚCIANY (`wallFootPoint(L, b, φ)`, wysokość `L.footH`): korek stawia w azymutach `L.elevators` MOSTY nad lawą od
  swojego boku do stopy ściany i niesie po nich przewody (PIPE) od korka do stopy; obudowa zaczyna przy stopie: pierścień
  przewodu wokół stopy ściany, przewody główne w górę ścian do kotwic wind, boczne (`liningSideConduits`) do podstacji.

## Podział plików (każdy pisze TYLKO swoje)

| Rola | Pliki | Zakres |
|---|---|---|
| MAT | `earthBitePlant.tsl.js`, `earthBitePlantCommon.tsl.js` (tylko dopisywanie pomocników, eksporty zostają) | materiał metalu (wszystkie rodzaje 0–7) i przepływu (8–9), światło, mikro-detal |
| CORK | `earthBitePlantCork.js` (+ własny `.tsl.js` dodatków, jeśli trzeba) | korek: bryła, tarasy, budowle, krater i cewki wylotu, mosty nad lawą do stopy ściany z przewodami |
| LINING | `earthBitePlantLining.js` | obudowa dziury: korona brzegu z emiterami pola, żebra i galerie ścian, przewody od stopy ściany i podstacje |
| ELEV | `earthBitePlantElevators.js`, `earthBitePlantClimbers.tsl.js` (nowy) | windy do ringu: kotwice-stacje, wieże, liny, szyna ringu z wózkami, kabiny na GPU (dodatek) |
| ORBIT | `earthBitePlantOrbital.js` | odbiornik: pierścień-stacja, czasza zbierająca, radiatory, magazyn, nadajnik przekazu (bez doków lin) |
| BEAM | `earthBitePlantBeam.js`, `earthBitePlantBeam.tsl.js` | promień główny i przekaźnikowy: warstwy, spirale, impulsy, pierścienie zamknięcia (`buildBeamHardware`), rozbłyski |

Wspólne (tylko orkiestrator): `earthBitePlant.js`, `earthBitePlantFrame.js`, `tests/earthBitePlant.test.mjs`,
`dema/planety-slup.js`, `scripts/webgpu/slup-demo.mjs`, ten brief. Potrzebujesz zmiany we wspólnym — opisz ją w raporcie.

## Budżet

- Wierzchołki (test): metal ≤ 600 tys., przepływ ≤ 150 tys., razem z dodatkami ≤ 900 tys. Orientacyjnie: korek ~220
  tys., obudowa ~180 tys. metalu + ~60 tys. przepływu, windy ~80 tys. + kabiny ≤ 48 × ≤ 400, odbiornik ~120 tys.,
  sprzęt promienia ~40 tys.
- Rysunki: metal 1, przepływ 1, promień ≤ 4 (+ przekaźnik ≤ 3), dodatki ≤ 2. Bez nowych świateł sceny.
- Fragment: bez pętli i raymarchingu, szum ≤ 3 oktawy, przezroczyste warstwy promienia tanie (zajmują duże pole ekranu
  przy zbliżeniu). Bez `pow` z ujemną podstawą, wyniki skończone (NaN w HalfFloat rozlewa bloom).

## Pułapki, które tu bolą

- TSL (reguła `webgpu-tsl`): funkcje wklejane (bez `setLayout`) albo czyste; `smoothstep` ze stałymi krawędziami
  low ≥ high — `sdown`; `fwidth` / `pix` PRZED gałęziami (wzór: `pix` na początku `Fn`); przezroczyste — `forceSinglePass`
  i `blendAddytywnePremul`; graf raz na moduł; bez `defines` / `needsUpdate` w biegu.
- Geometria: pozycje w ramie (małe liczby, float32 wystarcza — świat gry przesuwa grupę kuli); `bowlPoint` z `lift`
  0,001–0,004, żeby nic nie wisiało w powietrzu ani nie tonęło w ścianie; brzeg nieregularny — próbkuj `rimAngle(φ)` gęsto
  (≥ 256 na obwód); części jednego materiału scala orkiestrator (jeden rysunek).
- Bez `Math.random` (ziarna `plantRng`), bez `window` / DOM (render w workerze), bez alokacji w `update`.

## Weryfikacja (każda rola, po każdej większej zmianie)

1. `node --check <twój plik>` od razu po zapisie (inni agenci ładują to samo demo — błąd składni psuje im zrzuty).
2. `node --test tests/earthBitePlant.test.mjs` — zielony (budżet, kontrakt części, WGSL wszystkich siatek, ziarna).
3. Zrzuty: `node scripts/webgpu/slup-demo.mjs --out .tmp/korek/<rola>/<runda> --tag <rola> --tylko <kadry> --port <port>`
   (grupy: `gra` — widoki gry: gra-cala, gra-noc-cala, gra-dzien, gra-terminator, gra-noc, gra-blisko, gra-blisko-noc;
   `szczegoly` — kadry ramy: nad-gryzem, korek-gora, korek-bok, korek-noc, korek-wylot, obudowa, brzeg, odbiornik,
   winda, promien; grupy ról z rundy 1: `mat`, `cork`, `lining`, `orbit`, `beam`). Kadr gry z własnymi parametrami:
   `window.__slup.viewGame({ angle, phase, half, center: 'planet' | 'bite' | 'hub' })`. Porty: MAT 5431, CORK 5432,
   LINING 5433, ELEV 5434, ORBIT 5435, BEAM 5436, krytyk 5437 — jeden przebieg naraz na rolę. PNG oglądaj narzędziem Read. Na zrzutach widać też pracę innych ról
   (w toku) — oceniaj swoje. Demo nie wstało, bo ktoś ma błąd składni? Odczekaj minutę i powtórz; cudzych plików nie
   ruszaj.
4. Własny kadr szczegółu: `window.__slup.viewPlant({ at, from, fov, sun, up })` (punkty w ramie; góra kadru domyślnie
   wzdłuż osi gryzu) — dopisz go do raportu, orkiestrator doda kadr do skryptu.
5. Nie commituj i nie używaj `git stash` — commituje orkiestrator po rundzie.
