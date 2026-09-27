# Fizyka wydobycia skał — kopanie, cięcie, ładunki, odłamy

Prośba użytkownika (2026-09-27): skały pola trzeba móc **ciąć** (w 3D drony), **wykopywać**, **dostać się do
rdzenia** (skała miedzi ma z zewnątrz mało miedzi, a rdzeń to czysta miedź — dużo surowca), **wysadzić rdzeń i łapać
odłamki**; skały mają się zachowywać **inaczej niż stal** — kruche jak lód albo mocne jak tytan, jedne potrzebują
mniejszego ładunku, inne większego.

Stan: logika w grze gotowa jako moduł bez three (`src/game/asteroidMining.js` + `asteroidMaterials.js`, testy
`tests/asteroidMining.test.mjs`), render i sterowanie w demie WebGPU (`dema/asteroidy-webgpu`, scena **Kopalnia**,
klawisz G). W grze jeszcze nie wpięte — patrz § „Wpięcie do gry”.

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
const hit = mining.raycast(ox, oy, oz, dx, dy, dz);        // przestrzeń skał; { body, x, y, z, nx.., ore }
mining.laser(hit.body, hit.x, hit.y, hit.z, dx, dy, dz, moc, dt, urobek);
mining.slice(body, px, py, pz, nx, ny, nz, szczelina, przesuw?, urobek);
const res = mining.detonate(body, x, y, z, E, straty);     // { outcome, rc, rf, bodies, pebbles, gravel, … }
mining.tractor(tx, ty, tz, zasięg, udźwig, chwyt, dt, urobek); // → złapane
mining.step(dt);                                            // masa, rozpady po cięciu, ruch, zderzenia
mining.probe(body, x, y, z); mining.summary(body);          // skaner: ruda, strefa, głębokość, rdzeń
mining.drainEvents();                                       // wybuchy, rozpady, zbiórka — do efektów
// render: mining.bodies (fill/ore/orig, version, dirtyBox, origin(), q), mining.pebbles (p, q, r, type)
```

Urobek: `createYield()` → `{ ore: { [surowiec]: t }, waste, lost }`. Koszt (Node, 1 rdzeń): budowa ciała 10–30 ms,
wybuch 10–60 ms (jednorazowo), krok symulacji po wybuchu ~0,07 ms, render ciał ~0,1 ms CPU na klatkę.

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

## Wpięcie do gry (propozycja zadania po 21)

1. Moduł pasa w Core3D (zadanie 21) daje: `bank.radiusAt`, `zOf` warstwy PLAY, transmitancję słońca, `playLayer.hide`.
2. `AsteroidMining` jako system gry (krok w `physicsStep` albo w `render()` z czasem symulacji — skały są pod
   płaszczyzną, nie kolidują z kadłubami). Zdarzenia (`drainEvents`) → efekty z `src/3d/fx/` (wybuch, iskry, światła).
3. Render: `minedRocks.js` do `src/3d/asteroids/` (atlas + materiały; te same passy co skały PLAY).
4. Drony: system gry z drone'ami 3D (zadanie modeli), sterowanie z UI (cel, bruzda, piła); w demie `miningRig.js` to
   wzór zachowania.
5. Ekonomia: urobek → ładownia (`cargo`, `resources.js`), ładunki jako przedmiot (S/M/L/XL), udźwig wiązki z modułu
   statku. Stare `asteroidDestructor.js` / heksy asteroid / `asteroidPhysics.js` HEX_* odchodzą (zadanie 24).

**Otwarte (do decyzji użytkownika):** czy odłamy mają zderzać się z kadłubami (dziś pod płaszczyzną — nie), czy
wybuch w polu ma ruszać sąsiednie skały, udźwig wiązki i ceny ładunków, czy skały pola w ogóle mają być przejmowane
wszystkie czy tylko „złoża” oznaczone skanerem.

## Braki (świadomie na później)

- Zderzenia przybliżone (punkty powierzchni vs pole zapełnienia, bez momentu); odłamy nie zderzają się ze skałami
  pola ani z kadłubami.
- Dron-piła to w demie sam drut i rozżarzona szczelina (bez modelu drona); drony to proste sześciokątne dyski.
- Pył z wybuchu i cięcia nie trafia do ośrodka (smugi) — tylko iskry i światło.
