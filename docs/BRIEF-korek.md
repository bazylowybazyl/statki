# BRIEF: elektrownia „KOREK” w wielkim gryzie Ziemi — megaprojekt klasy AAA

Prośba użytkownika (2026-10-22): „wymodeluj ją porządnie — dopracuj tę dziurę, żeby była production ready. Windy,
promień, obudowa dziury — megaprojekt godny gry AAA”. Wcześniejsze decyzje: zamiast dymu — geotermalna elektrownia,
czarna megabudowla w kształcie korka zatykająca jądro, z małym otworem pośrodku; zamiast buchania lawy — PROMIEŃ
wysyłający prąd do ringu; infrastruktura wokół korka i kilka wind kosmicznych; bez 4 klamer nad otworem (otwór trzyma
pole siłowe). Ring orbitalny Ziemi z gry; przekaz do ringu tylko przy widoku ringu z odbiornika — bez niego odbiornik
ŁADUJE MAGAZYN (`uPlantState.y`), z nim oddaje (`uPlantState.x` — przekaz 0…1, wygładzony).

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
- Kamera gry: ORTO z góry, Ziemia w passie ring-planet (warstwa 6, bez paralaksy), zoom 0,035–3,2 px/j. Przy zoomie
  minimalnym 1 px ≈ 0,00076 R — cały gryz to ~1 200 px; przy typowym (0,2–0,5) 1 px ≈ 0,0001 R — wierzch korka nie
  mieści się w ekranie. Gryz obraca się z Ziemią (oś doby w płaszczyźnie ekranu): nad środkiem tarczy patrzymy W OŚ
  dziury (z góry: korek, promień od czoła, odbiornik nad nim, liny zbiegają się w środku), przy limbie — z boku
  (promień poziomo, liny w poprzek). Kadry `gra-*` w demie to te widoki; kadry szczegółów (perspektywa) służą do
  jakości z bliska.
- Wniosek: TRZY skale detalu, każda czytelna w swoim zakresie: (1) sylwetka i rytm świateł czytelne przy 0,00076 R/px
  (koncentryczne pierścienie korka, szprychy, jasny pierścień brzegu, zbieg lin, punkt promienia), (2) budowle 0,002–
  0,02 R w geometrii (hale, wieże, żebra, kratownice, doki), (3) mikro-detal w shaderze 0,0001–0,002 R (panele, okna,
  szwy, listwy), gasnący do średniej, gdy jest drobniejszy niż piksel (bez migotania).

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
- KOMPOZYCJA z góry: mocne koncentryczne pierścienie (tarasy korka, cewki krateru, pierścienie zamknięcia promienia,
  korona brzegu), promieniste szprychy (przypory korka nad lawą, żebra ścian, przewody, liny wind) — gwiazda / koło
  w jeziorze ognia. Symetria 6-krotna z lekkim złamaniem (nie wszystko identyczne — ziarna).
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
  odbiornik, z — długość, w — pas kabin ±1). Metal: rodzaje 0–7, przepływ: 8–9.
- UNIFORMY (`PLANT_KEYS`, `earthBitePlantCommon.tsl.js`): wspólne obiekty `{ value }` wszystkich materiałów
  elektrowni; `uPlantTime`, `uPlantShape` (z0, światło jeziora, —, h korka), `uPlantBeam` (jasność, h wylotu, h odbiornika,
  promień rdzenia), `uPlantLayer` (warstwa siatki przezroczystej), `uPlantBeamLen`, `uPlantState` (przekaz, magazyn),
  `uPlantCork` (promień korka, h wierzchu, h wylotu, gardziel), `uPlantHub` (h odbiornika, pierścień), `uPlantMisc`
  (zapas). Nowy klucz = zmiana w Common i w orkiestratorze (zgłoś).
- Liny łączą się z odbiornikiem w `tetherHubPoint(L, b, φ)` (`earthBitePlantElevators.js`) — odbiornik stawia tam doki;
  kotwice stoją w `rimAngle(φ) + anchorPad` w azymutach `L.elevators`, przewody obudowy dochodzą do nich.

## Podział plików (każdy pisze TYLKO swoje)

| Rola | Pliki | Zakres |
|---|---|---|
| MAT | `earthBitePlant.tsl.js`, `earthBitePlantCommon.tsl.js` (tylko dopisywanie pomocników, eksporty zostają) | materiał metalu (wszystkie rodzaje 0–7) i przepływu (8–9), światło, mikro-detal |
| CORK | `earthBitePlantCork.js` (+ własny `.tsl.js` dodatków, jeśli trzeba) | korek: bryła, tarasy, budowle, krater i cewki wylotu, przypory nad lawą do stóp ścian |
| LINING | `earthBitePlantLining.js` | obudowa dziury: korona brzegu z emiterami pola, żebra i galerie ścian, przewody i podstacje |
| ELEV | `earthBitePlantElevators.js`, `earthBitePlantClimbers.tsl.js` (nowy) | windy: kotwice-stacje, wieże, liny / taśmy, kabiny na GPU (dodatek) |
| ORBIT | `earthBitePlantOrbital.js` | odbiornik: pierścień-stacja, czasza zbierająca, doki lin, radiatory, magazyn, nadajnik przekazu |
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
   (grupy: `gra` — widoki gry, `szczegoly` — kadry ramy; nazwy: nad-gryzem, korek-gora, korek-bok, korek-noc,
   korek-wylot, obudowa, brzeg, odbiornik, winda, promien, gra-cala, gra-dzien, gra-noc, gra-terminator, gra-krawedz,
   gra-przekaz, gra-przekaz-blisko). Porty: MAT 5431, CORK 5432, LINING 5433, ELEV 5434, ORBIT 5435, BEAM 5436,
   krytyk 5437 — jeden przebieg naraz na rolę. PNG oglądaj narzędziem Read. Na zrzutach widać też pracę innych ról
   (w toku) — oceniaj swoje. Demo nie wstało, bo ktoś ma błąd składni? Odczekaj minutę i powtórz; cudzych plików nie
   ruszaj.
4. Własny kadr szczegółu: `window.__slup.viewPlant({ at, from, fov, sun })` (punkty w ramie) — dopisz go do raportu,
   orkiestrator doda kadr do skryptu.
5. Nie commituj i nie używaj `git stash` — commituje orkiestrator po rundzie.
