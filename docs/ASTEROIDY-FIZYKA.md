# Fizyka wydobycia skał — kopanie, cięcie, ładunki, odłamy

Prośba użytkownika (2026-09-27): skały pola trzeba móc **ciąć** (w 3D drony), **wykopywać**, **dostać się do
rdzenia** (skała miedzi ma z zewnątrz mało miedzi, a rdzeń to czysta miedź — dużo surowca), **wysadzić rdzeń i łapać
odłamki**; skały mają się zachowywać **inaczej niż stal** — kruche jak lód albo mocne jak tytan, jedne potrzebują
mniejszego ładunku, inne większego.

Stan: logika jako moduł bez three (`src/game/asteroidMining.js` + `asteroidMaterials.js`, testy
`tests/asteroidMining.test.mjs`), render i sterowanie w demie WebGPU (`dema/asteroidy-webgpu`, scena **Kopalnia**,
klawisz G) i **w grze od zadania 21b** (platforma `src/game/asteroidMiningRig.js`, render `src/3d/asteroids/
minedRocks.js` + `miningView.js`, tryb wydobycia `N`) — patrz § „W grze”.

## Dlaczego nie silnik belek

Destruktor 3D (`destructorBeams3D.js`) jest zbudowany pod **cienkościenne kadłuby**: poszycie, wręgi, grodzie, PBD,
plastyczność w długościach belek. Lita skała z warstwami i rdzeniem potrzebuje czegoś innego: objętości, której
komórki niosą **skład** (ile rudy), da się je **zdejmować** (kopanie) i które **pękają** (ładunek), a render musi
pokazać **wnętrze** (ściany otworu, przełomy). Z destruktora zostały idee: wiązania, które się zrywają, i rozpad na
składowe spójne (wyspy → nowe ciała).

## Model

**Ciało skały** (`RockBody`) = siatka komórek w układzie skały (układ obiektu z banku kształtów × promień, z
rozciągnięciem — ten sam, w którym materiał skał liczy `vRockObjP`), najdłuższy wymiar ~44 komórki (≤ 60 na oś):

| Pole | Co to |
|---|---|
| `fill` (Float32) | zapełnienie 0 … 1, gładki brzeg — powierzchnia = poziom 0,5 (z promienia kształtu banku) |
| `ore` (Uint8) | udział rudy: skorupa → płaszcz → rdzeń + żyły, wietrzenie tuż pod powierzchnią |
| `bonds` (Uint8) | 3 bity: wiązanie do sąsiada +x / +y / +z zerwane |
| `orig` (Uint8) | zapełnienie z chwili przejęcia — render odróżnia ścianę wyciętą od pierwotnej powierzchni |

Ciało sztywne 6DoF: środek masy, kwaternion układu skały, prędkości (przestrzeń skał = układ sceny bez przesunięcia
początku: **X = x, Y = −y, Z = z**). Przejęta skała obraca się dalej tak, jak w polu (ta sama faza co w shaderze);
**zakotwiczona** (platforma wydobywcza) gasi obrót i dryf.

**Skład:** rdzeń przesunięty lekko od środka (0,24–0,34 promienia), płaszcz do ~1,9 promienia rdzenia. Rudy
(`ROCK_COMPOSITION`): skorupa ~6%, płaszcz ~30%, rdzeń ~93%; lód: brudny wierzch 45%, czysty środek; skała
neutralna: bez rudy, ale z 22% szansą kryje **rdzeń pospolitej rudy** (niespodzianka dla skanera). Całość: ruda
~12% masy, z tego ~20% w rdzeniu (skupiona).

**Materiały** (`ROCK_FRACTURE` + gęstość/twardość z `src/data/asteroidPhysics.js`):

| Typ | gęstość | twardość | odporność | kruchość | uwagi |
|---|---|---|---|---|---|
| lód | 0,9 | 0,10 | 0,16 | 0,88 | kopie się najszybciej, sypie na drobnicę |
| kryształ | 2,7 | 0,20 | 0,30 | 0,92 | łupliwość (płytki) |
| krzem | 2,3 | 0,35 | 0,38 | 0,68 | |
| skała | 2,7 | 0,45 | 0,45 | 0,55 | |
| energetyczna | 3,0 | 0,50 | 0,34 | 0,85 | ładunek × 1,6 (wyładowanie), rdzeń z kryształu |
| uran | 19 | 0,60 | 0,55 | 0,40 | |
| miedź | 8,9 | 0,55 | 0,62 | 0,30 | |
| żelazo | 7,8 | 0,70 | 0,80 | 0,22 | |
| tytan | 4,5 | 0,95 | 1,00 | 0,12 | kopie się najwolniej, pęka na kilka brył |

### Kopanie i cięcie

- **Laser drona** (`laser`): zdejmuje objętość `moc · digVolumeRate / (0,2 + twardość)` [j.³/s] z komórek w kuli
  wiązki (jądro (1 − d²/R²)² z ziarnem — ściany chropowate), punkt kopania wchodzi pod powierzchnię wzdłuż wiązki,
  więc otwór pogłębia się tam, gdzie świeci dron. Urobek = zdjęta masa × udział rudy (reszta to skała płonna) — z
  wierzchu mało rudy, w rdzeniu prawie czysta. Drobinki odłupane laserem (< 3 okruchy) idą od razu do urobku.
- **Piła** (`slice`): drut między dronami wycina szczelinę w płaszczyźnie (opcjonalnie pasem — przesuw piły); materiał
  szczeliny to pył. Przecięcie na wylot = dwie części, rozsuwają się powoli.
- Po zdjęciu kilku komórek skała sprawdza spójność: przecięta bruzdą rozpada się na części.

### Ładunek

Ładunek energii E (S 0,5 · M 2 · L 8 · XL 32) w punkcie skały:

- **sprzężenie**: w otworze (≥ 1,2 komórki pod powierzchnią) cała energia, na powierzchni 35%;
- **strefa zmiażdżenia** `rc = 70 · ∛(E / (0,2 + twardość))` — drobnica (`fines`) przepada jako pył, reszta leci jako
  **żwir** (okruchy z rudą strefy — zmiażdżony rdzeń da się jeszcze wyłapać);
- **strefa spękań** `rf = 260 · ∛(E / (0,15 + odporność)) · (0,6 + 1,2 · kruchość) · ∛(1 + uszkodzenie)`;
- **za słaby** (rf < głębokość pod powierzchnią): skorupa trzyma, skała pęka w środku i SŁABNIE (kolejny ładunek sięga
  dalej), rudy nie ubywa;
- **przebicie**: strefa dzieli się na **bryły Voronoi** (≤ 80 ziaren; drobne przy ładunku, grubsze dalej; gdy strefa
  przerasta skałę, nadmiar energii rozdrabnia — jak w modelu Kuza–Rama), wiązania między bryłami pękają zawsze, na
  brzegu strefy z szansą 0,2 + 0,8 · kruchość (tytan zostaje z pękniętym kraterem, lód odpada); łupliwość spłaszcza
  bryły kryształu;
- składowe spójne: największa zostaje w ciele, do 14 kolejnych → **odłamy** (nowe ciała z siatką — można je dalej kopać
  i wysadzać), mniejsze → **okruchy**, najmniejsze → pył; odłamy lecą od ładunku (zasłonięte przez resztę skały — w stronę
  wylotu), z obrotem.

Najmniejszy ładunek, którego spękania sięgają głębokości d: `chargeForDepth(materiał, d)`. Skała r = 700 j. z ładunkiem
w środku (d ≈ 700): lód ~1,3, kryształ ~1,8, krzem ~3,6, skała ~5,9, miedź ~17, żelazo ~29, tytan ~54. Ładunek w
otworze przy rdzeniu sięga wylotu otworu — wystarczy mniejszy (dlatego najpierw się wierci).

### Ruch i zbieranie

- Odłamy i okruchy: ciało sztywne, lekkie tłumienie; **pod płaszczyzną gry** (wierzch ≤ `layerTop` = 0) jak skały PLAY;
  zderzenia odłam–odłam: punkty powierzchni lżejszego w polu zapełnienia cięższego (po `graceTime` od rozpadu),
  okruchy — kule.
- **Wiązka ściągająca** (`tractor`): ciągnie okruchy i odłamy lżejsze niż udźwig; złapane oddają rudę (tony surowca
  gry, `ASTEROID_YIELD`) i skałę płonną. Za ciężki odłam trzeba pociąć albo wysadzić.
- Skala ton: `tonnesPerVolume` 1,1e-7 t / (j.³ · g/cm³) — skała r = 300 j. żelaza ≈ 60–95 t, r = 650 j. miedzi ≈ 1050 t
  (rudy ~140 t, rdzeń ~ jedna piąta).

## API (`src/game/asteroidMining.js`)

```js
const mining = new AsteroidMining({ radiusAt: (shape, x, y, z) => bank.radiusAt(shape, x, y, z) });
const body = mining.activate(rockRecord, { z, time, sunT, anchored: true }); // skała pola → ciało
const hit = mining.raycast(ox, oy, oz, dx, dy, dz, maxD?, tylko?, out?); // przestrzeń skał; { body, x, y, z, nx.., ore }
mining.laser(hit.body, hit.x, hit.y, hit.z, dx, dy, dz, moc, dt, urobek);
mining.slice(body, px, py, pz, nx, ny, nz, szczelina, przesuw?, urobek);
const res = mining.detonate(body, x, y, z, E, straty);     // { outcome, rc, rf, bodies, pebbles, gravel, … }
mining.tractor(tx, ty, tz, zasięg, udźwig, chwyt, dt, urobek, siła?, maxRudy?); // → złapane (tablica do następnego wywołania)
mining.step(dt);                                            // masa, rozpady po cięciu, ruch, zderzenia, uśpienie
mining.wake(obiekt);                                        // obudź ciało / okruch ruszane z zewnątrz
mining.probe(body, x, y, z); mining.summary(body);          // skaner: ruda, strefa, głębokość, rdzeń
mining.drainEvents();                                       // wybuchy, rozpady, zbiórka (tablica do następnego wywołania)
// render: mining.bodies (fill/ore/orig, version, dirtyBox, origin(), q), mining.pebbles (p, q, r, type)
```

Urobek: `createYield()` → `{ ore: { [surowiec]: t }, waste, lost }`. Koszt (Node, 1 rdzeń): budowa ciała 10–30 ms,
wybuch 10–60 ms (jednorazowo), krok symulacji po wybuchu ~0,07 ms, render ciał ~0,1 ms CPU na klatkę.

**Zmiany pod grę (21b, bez zmiany wyniku operacji):** ciała i okruchy **zasypiają** po `sleepTime` (0,6 s) w spoczynku
(`sleepSpeed` 3 j./s, `sleepSpin` 0,003 rad/s) — śpiące nie ruszają się i nie zderzają ze sobą, śpiący przy styku z
czuwającym jest nieruchomy, budzi go kopanie, wybuch, wiązka albo uderzenie (> 2 · `sleepSpeed`); obrót w styku
gaśnie (`contactSpin` 3/s — zderzenia nie mają momentu, zaklinowane odłamy kręciły się ~10 s i nie zasypiały: 0,3 ms na
krok bez końca). Sprawdzenie rozpadu najwyżej co `splitCheckInterval` (0,2 s — etykietowanie całej siatki ~1 ms), masa
po kopaniu co `massRecomputeInterval` (0,25 s), punkty powierzchni odświeża przeliczenie masy. Okruch–okruch:
zamiatanie po x zamiast O(n²). Bez alokacji na krok: `raycast` z obiektem `out`, `drainEvents` / `tractor` na tablicach
wielokrotnego użytku, zwarte `RockBody.sample` (bajtkod < 460 B — V8 wkleja je w marsz promienia; wcześniej każda
próbka lasera zwracała liczbę przez stertę), `sqrt` zamiast `Math.hypot`.

## Render w demie (`dema/asteroidy-webgpu/`)

- `minedRocks.js`: **atlas 3D** (Storage3DTexture 256 × 256 × 128 RGBA8, bloki 64³/32³/16³ z przydziałem
  bliźniaczym; zmiany przez bufor storage + compute — three r183 wgrywa teksturę 3D tylko w całości). **Zewnętrze** =
  materiał skał pola w trybie `carve` (instancje z blokiem atlasu, piksele wykopanego miejsca odpadają) — przejęta
  skała wygląda jak przed przejęciem. **Wnętrze** = raymarching po atlasie, tylko ściany wycięte (`orig > fill`):
  świeży przełom jaśniejszy niż zwietrzały wierzch, ziarno i mikrorzeźba z szumu, w płaszczu minerał typu (malachit…),
  w rdzeniu ruda właściwa (metal lśni, kryształ i uran świecą), AO w otworach, żar świeżego cięcia, światła siatki,
  pył ośrodka jak nad skałą. **Okruchy** = zwykłe skały banku (RockSet). Jeden materiał na zewnętrze i jeden na
  wnętrze (nowy materiał skały = ~50 ms CPU, a wybuch daje kilkanaście odłamów).
- `rockLayers.js`: `hide(id)` / `unhide(id)` — przejęta skała znika z warstwy pola (też z cieni, piorunów, świateł).
- `minerals.js`: `MineralLayer` / `MineralMaterial` w trybie `carve` — minerały przejętej skały (kryształy, lód, uran)
  zostają na niej; minerał znika, gdy jego podstawę wykopano albo odleciała w innym odłamie.
- `spotShadows.js`: `enableCarve` + `gatherCarved` — przejęte skały i odłamy rzucają cień w smugach reflektorów
  (materiał cienia z tym samym testem wycięć: przez otwór przechodzi światło).
- `miningRig.js`: drony (trzy, wiązki pod kątem — z góry pionowa byłaby punktem), reflektory robocze dronów, ładunki
  przyczepione do skały, detonacja z efektami dema, wiązka ściągająca, skaner (rdzeń, ruda pod kursorem, potrzebny
  ładunek), HUD.

**Sterowanie (Kopalnia / tryb G):** LPM trzymany — lasery dronów (skała pola pod kursorem przechodzi do fizyki),
Shift + przeciągnięcie LPM — piła wzdłuż linii (pas po pasie, rozpad po przecięciu na wylot), PPM —
ładunek w dnie otworu pod kursorem, C — wielkość ładunku, F — detonacja, T — wiązka ściągająca, K — skaner; przyciski
typów stawiają skałę testową (lód … tytan, energetyczna).

## W grze (zadanie 21b portu WebGPU)

- **Logika:** `AsteroidMining` (fizyka skał) i `MiningRig` (`src/game/asteroidMiningRig.js` — platforma gracza, bez
  three / DOM, testy `tests/asteroidMiningRig.test.mjs`) tworzy pas w `initGpu` (`asteroidBelt.mining` / `.rig`;
  kształty z banku GPU po pieczeniu). Krok w `physicsStep` (`stepAsteroidMining`, 120 Hz, czas symulacji — w pauzie
  stoi; stałe są na sekundę, wykładniki od dt), `rig.beginFrame()` z pętli gry przed krokami: **ciężka operacja
  (przejęcie skały, wybuch) najwyżej jedna na klatkę** — kolejne ładunki wybuchają w następnych klatkach (seria),
  przejęcie przy osadzaniu ładunku czeka klatkę. Bez `Math.random` (losowania z id ciała).
- **Skały pola:** przejmowana jest skała pasma PLAY pod celem z DANYCH pola (`AsteroidBeltField.forEachRockInRect` —
  najwyższy wierzch w obrysie; z = `belt.playZ`, faza obrotu z zegara shadera skał `belt.time`, transmitancja słońca
  `belt.sunT`), zakotwiczona (platforma gasi obrót i dryf). Id przejętych skał = `rig.taken` = `playLayer.hidden`
  (znikają z warstwy, cieni, piorunów i świateł). Ciała i okruchy dalej niż 60 tys. j. od statku są zwalniane —
  nietknięta skała wraca do pola, naruszona zostaje „rozebrana”.
- **Drony:** trzy (`MINING_RIG_CONFIG`): dok na grzbiecie statku, przy pracy krąg 300 j. nad celem na z = 170 (wiązki
  pod kątem), moc 1,5 × `digVolumeRate`, zasięg pracy 9 tys. j. od statku; przy pile dwa drony trzymają drut nad linią
  cięcia (cięcie co 0,1 s czasu symulacji — tempo 380 / (0,2 + twardość) j./s), trzeci może ciąć laserem.
- **Ładunki:** S 0,5 · M 2 · L 8 · XL 32 z magazynka gracza `PLAYER.miningCharges` (`src/data/miningCharges.js`,
  zestaw startowy S 6 · M 4 · L 3 · XL 1), najwyżej 8 osadzonych naraz; osadzony w dnie otworu pod kursorem
  (0,6 promienia lasera pod trafieniem). **Ceny tymczasowe** (do decyzji): S 8 · M 25 · L 80 · XL 250 CR (~E^0,8) —
  karta „Ładunki górnicze” na rynku doku, bez zapasu stacji, poza masą ładowni.
- **Urobek:** ruda z lasera (drobinki odłupane laserem też) i złapanych odłamów w pełnych tonach surowców
  `resources.js` do ładowni gracza (`addToPlayerCargo`, udźwig kadłuba — Atlas 20), ułamki czekają na pełną tonę,
  skała płonna odpada. Pełna ładownia: urobek laserów przepada (komunikat), wiązka nie łapie odłamu z rudą ponad
  wolne miejsce (czeka przy statku). Wiązka ściągająca: zasięg 3600 j., **udźwig 450 t** (najcięższy odłam — do
  decyzji), chwyt 260 j.
- **Sterowanie** (`index.html`, blok „WYDOBYCIE SKAŁ”): `N` — tryb wydobycia (gaśnie przy stacji, skoku, śmierci,
  podzielonym ekranie); w trybie **LPM trzymany** — lasery na skale pod kursorem (przeciąganie = bruzda), **PPM** —
  ładunek, **PPM + przeciągnięcie** — piła wzdłuż linii, `L` — wielkość ładunku, `F` — detonacja (zamiast rakiet), `T`
  — wiązka. HUD na kanwie 2D: skaner (rdzeń ciała z głębokością i ładunkiem potrzebnym z rdzenia, skład i ładunek pod
  kursorem, osadzone ładunki), panel (narzędzia, magazynek, ładownia, urobek, ostatnie komunikaty platformy). Wybuch
  blisko statku trzęsie kamerą.
- **Render:** `src/3d/asteroids/minedRocks.js` (port dema — atlas 3D, zewnętrze w trybie `carve`, wnętrze raymarching z
  głębią przez `modelViewMatrix`, minerały i cień w trybie wycięć, okruchy `RockSet`; wysyłka atlasu z budżetem 300 tys.
  komórek / 4 wysyłek na klatkę) i `miningView.js` (drony z części, wiązki, efekty zdarzeń: iskry i duszki pasa, światło
  wybuchu w siatce gry z krzywą dema, fala = refrakcja `fxDistortion().shock`). Obraz w krokach `Core3D.fx` pasa.
- **Koszt** (gra, czas rzeczywisty, RTX 5080, 1080p, GPU/CPU dzielone z innymi sesjami — `wydobycie-gra.mjs --koszt`):
  przejęcie skały r ≈ 300–600 ~18 ms (najdłuższa klatka 18 ms), wybuch L ~28 ms (klatka maks. 40 ms < 50), klatka po
  wybuchu 0,13–0,25 ms CPU platformy + skał w wydobyciu (15 ciał, 21 okruchów; do ~0,1 ms, gdy odłamy zasną),
  cięcie laserem ~0,09 ms (skoki do ~4 ms przy sprawdzeniu rozpadu co 0,2 s), tryb bez pracy 0,015 ms, bez trybu 0.
- **Zrzuty obok dema:** `scripts/webgpu/wydobycie-gra.mjs` (etapy skała → laser → piła → ładunek → urobek w miejscu
  sceny „pole” z tą samą skałą testową co Kopalnia dema; `--demo` — te same etapy w demie), sesja `wydobycie` w
  `zrzuty.mjs`.

**Otwarte (do decyzji użytkownika — w grze wariant najprostszy):** odłamy nie zderzają się z kadłubami (leżą pod
płaszczyzną jak skały PLAY), wybuch nie rusza sąsiednich skał pola, udźwig wiązki 450 t (z dema), ceny ładunków
tymczasowe, przejmowana jest każda skała PLAY (nie tylko „złoża” ze skanera), ładownia Atlasa (20 t) mieści ułamek
rudy jednej skały (miedź r 650: ~140 t rudy) — skala ton fizyki vs udźwig kadłubów do ustalenia.

## Braki (świadomie na później)

- Zderzenia przybliżone (punkty powierzchni vs pole zapełnienia, bez momentu — obrót gasi tarcie w styku); odłamy
  nie zderzają się ze skałami pola ani z kadłubami.
- Dron-piła to w demie sam drut i rozżarzona szczelina (bez modelu drona); drony to proste sześciokątne dyski. W grze
  (21b) drut trzymają dwa drony platformy (bryła z części: kadłub, pas, ramiona z gondolami, światła, kopuła).
- Pył z wybuchu i cięcia nie trafia do ośrodka (smugi) — tylko iskry i światło.
- Kopanie laserem (`dig` — za duże na wklejenie) i sprawdzenie rozpadu co 0,2 s tworzą drobne obiekty (~80 B na
  klatkę gry przy pracy trzech laserów); bezczynna platforma — zero.
