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

**Skład:** skorupa ~10% rudy (skała pospolita z domieszką i żyłami), płaszcz wzbogacony wokół rdzenia (do ~1,9
jego promienia, ~25%), **rdzeń = lita bryła czystej rudy (100%)**; lód: brudny wierzch 45%, czysty środek; skała
neutralna: bez rudy, ale z 22% szansą kryje **rdzeń pospolitej rudy** (niespodzianka dla skanera).

### Rdzeń (2026-09-28)

Prośba użytkownika: „każda asteroida ma rdzeń, mniejszy lub większy; skorupa daje ~10% surowca, rdzeń 100%;
wybuchniesz asteroidę — kawałki rdzenia niech latają; usuń spawnowanie asteroid z asteroidy”.

- Rdzeń to osobne pole siatki `coreFill` (Uint8: udział materiału rdzenia w komórce, powierzchnia = 128) — bryła
  z garbami (szum na kierunku), przesunięta od środka, wielkość losowa z przedziału typu (`coreRadius`, np. miedź
  0,16–0,38 promienia skały), zawsze cała w skale (skorupa nad nią ≥ `coreShell` promienia). Ruda komórki =
  skała × (1 − rdzeń) + 100% × rdzeń.
- Materiał rdzenia (`CORE_MATERIAL`, `coreMaterial()`): **metal** (miedź, żelazo, tytan) — ciągliwy, twardszy dla
  lasera niż skała (skała schodzi szybciej, bryłka „wychodzi” z otworu); **zbite kryształy** (kryształ, krzem) i
  **czysty lód** — kruche, łupliwe; **smółka uranowa** — średnio krucha; **plazma** — piorun kulisty (niżej).
  Gęstość rdzenia = gęstość skały (jedna na ciało).
- Laser: ta sama praca zdejmuje z komórki rdzenia (0,2 + twardość skały) / (0,2 + twardość rdzenia) tego, co ze skały.
- Ładunek: strefa spękań rośnie w SKALE (ładunek w otworze w rdzeniu też rozsadza skałę — dowiercenie się do rdzenia
  ma sens); zmiażdżenie każda komórka liczy po swojemu (metal × `coreMetalCrush` 0,45 — reszta bryły wylatuje,
  zmiażdżona część to śrut). Rdzeń w strefie spękań (`_coreRegions`): metal → 1 + log2(1 + E_rdzenia / E_pęknięcia)
  brył (≤ `coreMaxChunks` 4; E_pęknięcia = `chargeForDepth(rdzeń, promień rdzenia)`), kruchy → do `coreMaxShards` 24
  odłamków (Voronoi z łupliwością rdzenia). Wiązania rdzeń–skała: ze spękaną skałą pękają zawsze; gdy ≥ 50% otoczenia
  bryły jest spękane, bryła wypada z gniazda w całości (odrzut prowadzi ją ku wylotowi krateru), mniej odsłonięta
  zostaje w skale (z nienaruszoną pęka z szansą `coreEdgeBreak` 0,15). Pomiar (r 650, ładunek 1,25 promienia rdzenia
  nad jego środkiem): miedź L — jedna bryła 57 t (cały rdzeń), XL — 3 bryły; tytan XL — 3; kryształ L — 23 odłamki;
  lód M — 22; uran L — 12. Kawałki rdzenia to ~96–99% rudy (brzeg rdzenia jest mieszany).
- Okruch z przewagą rdzenia ma `core: true` i `coreType` (ruda rdzenia), ciało — `coreMass` (`isCorePiece(o)`); render
  rysuje je materiałem rdzenia, nie jak skałę.

### Piorun kulisty (rdzeń skały energetycznej)

Prośba użytkownika: „energetyczna — piorun kulisty, który ciężko złapać, trzeba mieć sprzęt, inaczej wybuchnie”.
Włącza go `config: { ballLightning: true }` (demo); **domyślnie wyłączony** — gra nie ma jeszcze jego obrazu ani
pułapki, więc tam rdzeń skały energetycznej to zbite kryształy. Skała energetyczna ma wtedy geodę z surowego
kryształu (płaszcz 55%), a w niej plazmę (komórki rdzenia bez rudy).

- **Uwolnienie** (`_releaseBall`): laser dotyka plazmy, piła przecina geodę albo strefa spękań ładunku sięga rdzenia
  (też ładunek za słaby na skorupę). Geoda pustoszeje (ściany to powierzchnia wycięta — fioletowy żar w renderze),
  w środku rdzenia powstaje `balls[i]`: energia = objętość rdzenia × `ballEnergyPerVolume` (jednostki ładunku; rdzeń
  r ≈ 190 j. ≈ 7–11), promień ½ promienia rdzenia. **Bezpiecznik**: wiercenie / piła 12–18 s, wybuch 1,2–3 s,
  zmiażdżenie 0,15–0,35 s.
- **Ruch**: unosi się nad skały tuż pod płaszczyznę gry, błądzi (`ballDrift`) z uskokami (`ballDart` co 0,5–1,6 s),
  wraca w okolice miejsca uwolnienia — trudno go złapać. Losowania z id pioruna i numeru kroku (determinizm).
- **Wiązka** `pullBalls(tx, ty, tz, zasięg, chwyt, dt, trap, miejsce)`: BEZ pułapki plazmy nie trzyma — bezpiecznik
  × `ballBeamDrain` 5, piorun szarpie się (uskoki częstsze), doprowadzony do statku wybucha (`where: 'beam'`); Z
  PUŁAPKĄ MAGNETYCZNĄ chwyt rośnie `ballTrapLock` 0,7/s (pełny ~1,4 s), piorun się uspokaja (bezpiecznik ×
  `ballTrapDrain` 0,3), przy pełnym chwycie w zasięgu `chwyt` trafia do pułapki (`miejsce` = wolne sloty; pełna —
  wisi przy statku). Pomiar: bez pułapki wybuch w wiązce po ~2 s, z pułapką złapany po ~3 s.
- **Wyładowanie** (`_discharge`): zdarzenie `{ kind: 'ball', outcome: 'discharge', where, energy, body }`, rozsadza
  najbliższą skałę w zasięgu (`detonate` z energią pioruna na jej powierzchni — reakcja łańcuchowa w polu) i skraca
  bezpieczniki innych piorunów obok. Zdarzenia: `release` (z `how`), `discharge`, `capture`.
- Co daje złapany piorun w ekonomii — **do decyzji** (nie ma surowca w `resources.js`; demo liczy je w pułapce).

### Rumowiska (2026-10-12, strumień D planu `docs/PLAN-pas-realizm.md`)

Decyzja użytkownika: „rumowiska w wydobyciu — robimy (inna taktyka niż przy monolicie)”. Prawda: ciała ≳ 200 m to
zwykle luźne kupy gruzu (porowatość 20–60%, bariera obrotu ~2,2 h; Bennu — próbnik zapadł się 0,5 m jak w basenie
z piłkami; Ryugu — głazy do 160 m na 900 m), mniejsze to monolity.

- **Które skały:** szansa rośnie od 0,8 do 1,3 × progu średnicy (`RUBBLE_CONFIG.minDiameter` 360 j. × (0,55 +
  odporność) × (0,75 + 0,1 · min(gęstość, 8)) × mnożnik typu `typeBias`, wspólny hash id skały — `rubbleChance`);
  progi: prymitywna (D) 169, węglowa (C) 190, lód 215, wypełniacz węglowy 226, kryształ 312, krzem 328, skała 367,
  bazalt (V) 424, uran 614, miedź 653, tytan 670, żelazo 744, metaliczna (M) 945, platynowce 1214 j.; skała
  energetyczna (geoda z piorunem) nigdy. `typeBias` (C / D / wypełniacz węglowy × 0,8–0,85 — jak Bennu i Ryugu, M i
  platynowce × 1,5 — lite żelazo-nikiel) liczy się po id typu z `ROCK_TYPES` ('rock_c' ma materiał 'rock'); pole
  `rubble` w `ROCK_FRACTURE` (mnożnik, 0 = nigdy) bierze górę — opcjonalne, dopisuje właściciel tabel typów. Wśród skał PLAY
  (80–2600 j., N ∝ D^−1,45) rumowiskiem jest ~co dziesiąta skała neutralna. `activate(rock, { rubble })` — na siłę;
  `new AsteroidMining({ config: { rubble: false } })` — same monolity (testy monolitów).
- **Budowa** (`_buildRubble`, ta sama bryła z banku): GŁAZY — elipsoidy o losowej orientacji (osie 1 : 0,75–1 :
  0,55–0,9), promienie z rozkładu potęgowego N(> r) ∝ r^−2,3 w [max(2,2 komórki, 0,08 R); 0,26 R], upakowane do 62%
  objętości z nachodzeniem ≤ 18% sumy promieni (≤ 200 głazów); komórka należy do głazu o najmniejszej „odległości
  elipsoidalnej” < 1 (chropowaty brzeg z hasha), reszta to REGOLIT (~45–50%). Pole `boulder` (id głazu, 0 = regolit;
  pamięć budowy jak `orig`), SŁABE wiązania = bity 3–5 `bonds` (między różnymi głazami i w regolicie — trzymają kupę
  razem: `_label` ich nie rozcina), porowatość 25–50% (gęstość ciała × (1 − porowatość) — rumowisko jest lżejsze).
- **Ruda — w głazach, nie w jednym rdzeniu** (ciało macierzyste rozbito i posklejało, więc jego rdzeń leży w kawałkach):
  GŁAZY RDZENIOWE (2–8, objętość = rdzeń monolitu tego typu, komórki rdzenia = lita ruda materiału rdzenia — kawałki
  to `isCorePiece`), GŁAZY WZBOGACONE (2,5 × tyle, ruda płaszcza), reszta głazów — skorupa z rozrzutem (0,5–1,5 ×,
  co siódmy z żyłą × 2,5), regolit — 0,6 skorupy. Głębiej — częściej bogate. `body.core` = null; skaner:
  `oreBoulders(ciało)` (głazy rdzeniowe i wzbogacone obecne w ciele: pozycja, promień, masa, ruda), `probe` — strefy
  regolit / głaz / głaz wzbogacony / głaz rdzeniowy, `summary().rubble`. HUD (gra i demo): okrąg przy każdym głazie,
  podpis tylko przy rdzeniowych — bliskie na ekranie scalone w „GŁAZY RDZENIOWE ×n” z sumą rudy, masa < 0,1 t w kg.
- **Laser:** regolit schodzi `regolithDig` (3,5) razy szybciej niż lita skała (ta sama praca drona); w praktyce otwór
  w rumowisku rośnie ~1,3–1,9 × szybciej niż w monolicie; wykopany regolit odsłania głazy (odpadają, gdy nic ich nie
  trzyma — zwykły rozpad po cięciu).
- **Ładunek** (`_detonateRubble`): strefa ROZRZUTU rs = 1,2 × strefa spękań monolitu (porowata kupa tłumi falę, ale
  prawie nic jej nie trzyma); za słaby (rs < głębokość) — kupa się zagęszcza (uszkodzenie). Przebicie: zmiażdżenie jak
  w monolicie, REGOLIT w 0,65 · rs wylatuje (55% pyłem, reszta żwirem), głazy w 0,35 × strefa spękań pękają (bryły
  Voronoi), każdy głaz z ≥ 50% komórek (albo środkiem) w rs ODPADA CAŁY (słabe wiązania z resztą pękają), odłamy lecą
  × 0,4 prędkości monolitu. Pomiar (skała r 650, ładunek M przy wierzchu): rumowisko — kilkadziesiąt całych głazów,
  prędkość odłamów ~0,5 monolitu.
- **Wiązka ściągająca wyrywa głazy** (`_pluck`, w `tractor(…, pluck)`): zakotwiczonej kupy wiązka nie ciągnie
  w całości (luźna kupa rozpadłaby się w wiązce; monolit — jak dotąd). Co 1,2 s z najbliższego rumowiska w zasięgu,
  którego wiązka nie weźmie w całości (zakotwiczone albo cięższe niż udźwig — wyrwany wcześniej głaz też ma pole
  `boulder`), jeden ODSŁONIĘTY głaz (≥ 30% komórek na powierzchni, ≥ 8 komórek, lżejszy niż udźwig, nie cała kupa;
  głaz rdzeniowy × 0,4 odległości, wzbogacony × 0,7 — pierwszeństwo) — słabe wiązania pękają, głaz odpada z 25 j./s ku
  wiązce, wiązka go zbiera; próba bez kandydata — następna za pół odstępu (przegląd siatki ~1 ms nie idzie co krok).
  Wyrwanie to ciężka operacja (rozpad ciała ~1–3 ms) — gra podaje budżet klatki (`pluck = this._heavy > 0`).
- **Taktyka** (inna niż przy monolicie): skaner pokazuje głazy rdzeniowe → laser w regolicie odsłania je szybko →
  mały ładunek blisko rozrzuca kupę (całe głazy, wolno) albo wiązka wyrywa odsłonięte głazy jeden po drugim; przy
  monolicie — wiercenie do jednego rdzenia i ładunek w otworze.
- **Render:** kanał A atlasu wydobycia = `rubbleCellCode` (64 — regolit i szwy między głazami; demo: rdzeń ≥ 128 bierze
  górę) → wnętrze (obie kopie `minedRocks.js`): regolit ciemniejszy, grube ziarno w normalnej, pory w AO, bez połysku
  i blasku rudy; ściana odsłoniętego głazu wychodzi jako zakurzona powierzchnia. Okruch-głaz (`pebble.boulder`):
  gra — kształt rodziny „bryła” banku, demo — rodzina okruchów BOULDER (`fragments.js`: obła bryła z zaokrąglonymi
  ścianami starych pęknięć, zwietrzały wierzch). Monolit — kanał A jak dawniej (gra 0, demo udział rdzenia).
- **Koszt** (Node, miedź r 650, mediana 16 skał): budowa rumowiska ~8 ms (monolit ~11 ms — rumowisko nie liczy rdzenia
  i żył w pętli komórek), wybuch 10–50 ms (jak monolit, jednorazowo).
- Strojenie: `RUBBLE_CONFIG` (`asteroidMaterials.js`, blok rumowisk), testy `tests/asteroidRubble.test.mjs`, zrzuty
  `node scripts/webgpu/wydobycie-gra.mjs --rumowisko [--demo]` (demo: przyciski „rumowisko (C)”, „rumowisko miedzi”
  w scenie Kopalnia — typ `rubble:<typ>` w `spawnTestRock`).

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
const body = mining.activate(rockRecord, { z, time, sunT, anchored: true, rubble? }); // skała pola → ciało (rumowisko wg progu)
const hit = mining.raycast(ox, oy, oz, dx, dy, dz, maxD?, tylko?, out?); // przestrzeń skał; { body, x, y, z, nx.., ore }
mining.laser(hit.body, hit.x, hit.y, hit.z, dx, dy, dz, moc, dt, urobek);
mining.slice(body, px, py, pz, nx, ny, nz, szczelina, przesuw?, urobek);
const res = mining.detonate(body, x, y, z, E, straty);     // { outcome, rc, rf, bodies, pebbles, gravel, … }
mining.tractor(tx, ty, tz, zasięg, udźwig, chwyt, dt, urobek, siła?, maxRudy?, wyrywaj?); // → złapane (tablica do następnego wywołania); rumowisko: wyrywa głazy
mining.oreBoulders(body, out?);                             // rumowisko: głazy rdzeniowe i wzbogacone (skaner)
mining.pullBalls(tx, ty, tz, zasięg, chwyt, dt, pułapka, miejsce); // pioruny kuliste → złapane (z pułapką)
mining.step(dt);                                            // masa, rozpady po cięciu, ruch, zderzenia, uśpienie, pioruny
mining.wake(obiekt);                                        // obudź ciało / okruch ruszane z zewnątrz
mining.probe(body, x, y, z); mining.summary(body);          // skaner: ruda, strefa, głębokość, rdzeń
mining.drainEvents();                                       // wybuchy, rozpady, zbiórka, pioruny (tablica do następnego wywołania)
// render: mining.bodies (fill/ore/orig/coreFill, coreMaterial, version, dirtyBox, origin(), q),
//         mining.pebbles (p, q, r, type, core, coreType, gravel, age), mining.balls (p, r, fuse, lock, energy)
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
  pył ośrodka jak nad skałą; kanał A atlasu = udział rdzenia — lita bryła materiałem rdzenia (`coreLook.js`:
  metal z połyskiem i patyną w zagłębieniach, kryształy świecące od środka, lód, smółka z żyłkami), kawałek rdzenia
  prosto z wybuchu żarzy się na brzegach ~3 s (metal i smółka; lód i kryształ nie), pusta geoda po piorunie —
  fioletowy żar ~6 s. **Okruchy** = odłamki (`fragments.js`, od 2026-09-28 — wcześniej zwykłe skały banku, czyli
  „mniejsze asteroidy” z wybuchu): skorupa — kanciaste odłamki (otoczka wypukła z płaszczyznami przełomu, relief i
  ziarno w skali świata, drobinki minerału), rdzeń — bryłki metalu z guzami, kiście graniastosłupów kryształu, bloki
  krzemu, bryłki lodu, bryły smółki. Jeden materiał TSL na wszystkie rodziny (17 siatek instancji). Jeden materiał
  na zewnętrze i jeden na wnętrze skał (nowy materiał skały = ~50 ms CPU, a wybuch daje kilkanaście odłamów).
- `ballLightning.js`: piorun kulisty — kula plazmy w TSL (addytywnie: rdzeń, fioletowe ciało, sieć włókien
  wyładowań w ruchu, oddech kuli; niestabilna migocze i bieleje, w pułapce sinieje); poświata, światło z siatki,
  łuki pełzające po kuli (burza `storm._addArc`) i wyładowanie (fioletowy błysk, iskry, pioruny do powierzchni
  najbliższych skał) — `miningRig.js`.
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
ładunek w dnie otworu pod kursorem, C — wielkość ładunku, F — detonacja, **R — wysadź rdzeń** (ładunek w otworze tuż
nad rdzeniem skały i detonacja), T — wiązka ściągająca, **M — pułapka magnetyczna** (sprzęt na pioruny kuliste),
K — skaner (rdzeń z rodzajem i masą, piorun kulisty z bezpiecznikiem i chwytem, romby na lecących kawałkach rdzenia),
**J — galeria rdzeni** (kawałek rdzenia każdej rudy nad odłamkiem jej skorupy i piorun kulisty na pokaz); przyciski
typów stawiają skałę testową (lód … tytan, energetyczna). Zrzuty z harnessu: `scripts/webgpu/wydobycie-gra.mjs --demo`.

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
- **Pary z księżycem** (2026-10-12, etap D2 planu pasa, `src/game/asteroidRotation.js`): ~5% skał gry 300–2000 j.
  ma księżyc (`rock.moon`: 0,15–0,35 promienia, orbita 2,6–4,5 promienia, pozioma na głębokości środka skały, okres
  z Keplera 28 s × (a / r)^1,5, obrót synchroniczny). Trafienie lasera / ładunku w KSIĘŻYC (pozycja z `moonStateAt`
  w czasie pasa — tam, gdzie go rysuje warstwa) albo w skałę przejmuje PARĘ: trafione ciało od razu, partnera klatkę
  później (`_pendingPartner` — najwyżej jedna ciężka operacja na klatkę; do tego czasu warstwa rysuje go dalej na
  orbicie). Rekord księżyca do `activate` — `moonRockRecord(skała, t)` (oś obrotu = normalna orbity, tempo = tempo
  orbity, faza = faza orbity): orientacja ciała = orientacja shadera (test `asteroidRotation.test.mjs`). Id księżyca =
  2^52 + id skały (`rig.taken` chowa oba). Wolniejszy obrót skał nie zmienia przejęcia: `activate` i shader liczą tę
  samą fazę `phase + spin · t` z rekordu pola.
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

**Rdzeń w grze (2026-09-28):** fizyka jest wspólna, więc gra ma już rdzenie (skorupa ~10%, rdzeń 100%, bryła metalu
wypada w całości, kruche rdzenie sypią się na odłamki), ale **render gry (`src/3d/asteroids/minedRocks.js`) rysuje
okruchy dalej skałami banku** i nie zna kanału rdzenia ani piorunów — port `fragments.js` / `coreLook.js` /
`ballLightning.js` i pułapki (sprzęt gracza, HUD) czeka; do tego czasu gra ma `ballLightning: false`.

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
