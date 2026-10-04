# Demo rdzenia reaktora na WebGPU — `dema/rdzen-webgpu.html`

Stan 2026-09-30. Druga wersja dema rdzenia: **logika na silniku belek** (ten sam kadłub co w grze —
`HullBodies`) i **wybuch na pulach WebGPU** (objętości TSL, dym compute, siatka świateł, mapa ran).
Pierwsza wersja (heksy, `dema/rdzen-demo.html`, `src/game/shipCore.js`, `src/3d/coreFx3D.js`,
`docs/PORT-rdzen.md`) stanęła na silniku heksów, który od zadania 21 nie tworzy już ciał w grze — do
gry się nie dało jej wpiąć. Zostaje do porównania; liczby modelu (stany, profile klas, warianty)
są wspólne (`src/game/coreModel.js`).

**W grze od 2026-10-02** (klej `src/game/reactorCoreGame.js`, stan § 7) — zastąpił losowy wybuch reaktora przy śmierci okrętu.

## 1. Uruchomienie

`npm run dev` → `/dema/rdzen-webgpu.html` — parametry: `?scene=gallery|meltdown|chain|jet|orb|range`,
`?variant=shatter|halves|thirds|hole|jet|orb`, `?hull=battleship|pirate_battleship|atlas`,
`?clean=1` (bez paneli), `?test=1` (zegar ręczny dla harnessu).

| klawisz | scena / akcja |
|---|---|
| 1 | **Galeria wybuchów** (domyślna): każdy wariant po kolei, na zmianę Terra Nova (błękit), piraci (czerwień), Atlas (fiolet) |
| 2 | **Stopienie z bliska**: Iron Skull, reaktor w wyrwie, języki plazmy, łuki, płyta grzeje się do bieli, implozja, rozprysk |
| 3 | **Łańcuch w formacji**: 4 okręty; fala A osłabia komory sąsiadów, B wchodzi w stopienie jako ogniwo 1 |
| 4 | **Strumień plazmy tnie sąsiada**: wyrzut z Bellatora w Iron Skulla (rzaz z pędem, odrzut obraca wrak) |
| 5 | **Kula plazmy przetapia sąsiada**: torus wypada z komory, topi własną burtę, potem Bellatora, wybucha po zapalniku |
| 6 | **Strzelnica**: LPM strzela (1–5 broń), L — lock w komorę, G — ogień ciągły, K — kanał tnący |
| M / D / R | stopienie / detonacja od razu / scena od nowa |
| V | następny wariant (wymusza wariant detonacji) |
| Spacja / T / F / Z / H | pauza / zwolnienie ×0,25 / kadr / zbliżenie na reaktor / bez paneli |
| W | fala z refrakcją (domyślnie WYŁ. — § 6) |

Panel „Warstwy wybuchu (A/B)” wyłącza każdą warstwę obrazu osobno (kula plazmy, iskry, dym i opary,
odłamki, płonące odłamki, łuki, światła, żar ran, strumienie, implozja, fala, gorące powietrze,
bloom/ekspozycja, model reaktora).

## 2. Pliki

| plik | rola |
|---|---|
| `src/game/coreModel.js` | liczby i czyste funkcje modelu (stany, profile klas, warianty i ich wagi, wybuch, strumień, kula, wtórne) — wyjęte bez zmian z `shipCore.js`, który je re-eksportuje |
| `src/game/reactorCore.js` | **logika na belkach**: komora z komórek siatki, pancerz, stany, odcięcie, łańcuch, detonacja (rozpad, krater, pęknięcia), fala na sąsiadów, strumień, kula, wybuchy wtórne, lock; bez DOM i three |
| `src/3d/reactorBlast/reactorBlastFx.js` | **reżyser obrazu** (krok `Core3D.addFxStep` „reaktor-rdzen”): stopienie, detonacja, strumień, kula, wtórne |
| `src/3d/reactorBlast/plasmaFireballs.js` | nowa pula: kula plazmy / ognia z objętości (TSL, 22 kroki marszu, plazma → ogień → kłęby) i kula plazmy wariantu `orb` (wirujący torus) |
| `src/3d/reactorBlast/plasmaJets.js` | nowa pula: strumień plazmy (diamenty Macha, porcje płynące wzdłuż osi, czoło) |
| `src/3d/reactorBlast/palette.js` | barwy frakcji, paleta oparów metalu (miejsce 7 puli dymu rakiet), skale klas i wariantów |
| `src/3d/reactor3D.js` | model reaktora w wyrwie (z wersji heksowej) — nowe opcje `frameOf` / `hostReady` dla kadłubów belkowych, ziarno cewek z `uid` rdzenia |
| `dema/rdzen-webgpu.html`, `dema/rdzen-webgpu.js` | demo: pętla 120 Hz, kamera, HUD, panel, API `window.__rdzen2` |
| `dema/rdzen-webgpu/swiat.js` | świat dema = **wzorzec integracji** (§ 7): kadłuby ze sprite'ów, krok fizyki, zdarzenia rdzeni |
| `dema/rdzen-webgpu/bron.js`, `sceny.js`, `tlo.js` | broń strzelnicy (jak w grze: kratery, mapa ran, WeaponFx), sceny, nieprzezroczyste tło z gwiazdami |
| `tests/reactorCore.test.mjs` (+ `tests/helpers/reactorHulls.mjs`) | 15 testów logiki na prawdziwych kadłubach (Bellator, Iron Skull) |
| `scripts/webgpu/rdzen-webgpu.mjs` | harness (headless Chrome, prawdziwe GPU): `--tryb test / zrzuty / pasma / wydajnosc` |

## 3. Logika (`reactorCore.js`)

- **Komora = komórki siatki belek** (ix, iy) w promieniu `r` markera, liczone raz z pozycji
  spoczynkowych. Indeksy węzłów zmieniają się przy każdym rozpadzie, komórka nie — ten sam ród
  (`hull.dmgKey`) ma tę samą siatkę w kadłubie, wraku i odłamach (`reactorCellNode`).
- **Pancerz** = hp / maxHp węzłów komory × `armorMul` (węzeł = `hexPerNode` ≈ 4 heksy). Czyta go
  tylko krater z budżetu HP; ciężka broń z kraterem na miarę rany, rzazy, zgniot i rozpad zabijają
  węzły bez patrzenia na HP — koszt dojścia do komory to grubość kadłuba nad nią.
- **Stany** jak w wersji heksowej: NOMINALNY → ODSŁONIĘTY → KRYTYCZNY (< 60%) → STOPIENIE (≤ 30%,
  odliczanie klasy) → DETONACJA zawsze. **Odcięcie**: większość żywych komórek komory na odłamie →
  rdzeń przechodzi na odłam (odliczanie × 0,5), gospodarz dostaje `reactorLost`.
- **Detonacja** (`applyReactorDetonation(core, wariant, blast, { wrecks, exitDir, seed })`):
  kadłub → wrak, krater wokół RDZENIA (wyrwa — poszarpany), pęknięcia wg wariantu (rozprysk 2–5
  promieni, przełamanie jedną linią, rozerwanie trzema promieniami, wyrzut — kanał), belki
  ramowe przecinające szczelinę zrywane (`breakBeamsAcross` — bez tego ramy spinały odłamy),
  rozpad od razu (`processSplits`), pchnięcie odłamów od rdzenia i odrzut (strumień, kula). Zwraca
  odłamy, szczeliny (`cuts`) i próbki brzegów (`edges`) dla obrazu.
- **Fala na sąsiadów** (`applyReactorBlast`): krater od strony wybuchu (`HullBodies.sweep`),
  obrażenia komór (napęd łańcucha, × `hexPerNode`, zasięg ≥ 0,65 AoE), znacznik łańcucha,
  pchnięcie, pula HP przez hak `hullDamage`. Własny ród pomijany.
- **Strumień** (`createReactorJet` / `stepReactorJet`): źródło i kierunek w układzie wraku (odrzut
  wodzi strumieniem), pierwszy kadłub na promieniu dostaje rzaz z pędem (`cutSegment(…, push)`)
  co takt; własny ród pomijany (kanał wybiła detonacja — wcześniej strumień przez ~0,3 s ciął
  własny odłam i nie było go widać).
- **Kula** (`createReactorOrb` / `stepReactorOrbs`): topi wszystko w promieniu (`impact` z
  `craterRadius` — także własną burtę, którą wychodzi), zapalnik od wyjścia z kadłuba, tarcza
  trzyma plazmę; wybucha zdarzeniem `orbDetonate` (fala jak detonacja).
- **Wybuchy wtórne**: `planReactorSecondaries` (komórki odłamów) → `locateReactorCell` w chwili
  wybuchu (odłam mógł odlecieć i przenumerować się).
- **Zdarzenia** z `updateReactorCores(e, dt, { time, entities, events, hooks })`: `state`,
  `severed`, `reactorLost`, `detonate`, `orbDetonate`. Śmierć z innej przyczyny:
  `notifyReactorHostKilled` (KRYTYCZNY / STOPIENIE → detonacja od razu, inaczej czysty wrak).
- Losowość: tylko generatory z ziarnem (`makeCoreRng`) — wariant, kierunek wyrzutu i rozpad
  powtarzalne.

## 4. Obraz (`reactorBlast/`)

Reżyser nie ma własnych passów ani rendererów — to krok klatki efektów Core3D z dwiema nowymi
pulami i pulami, które gra już ma:

| warstwa | skąd | co |
|---|---|---|
| kula plazmy / ognia | `PlasmaFireballSystem` (nowa) | plazma w barwie frakcji (biały rdzeń ~0,07 s) → ogień (ciało czarne) → kłęby rwące się z wiekiem i stygnące do przezroczystości; bryły wzdłuż pęknięć; kwad × 1,3 promienia — obrys z szumu, nie okrąg |
| kula plazmy (orb) | ta sama pula, rodzaj 1 | wirujący torus (obrót różnicowy), biała nić w osi rury, słaba powłoka kuli |
| strumień | `PlasmaJetSystem` (nowa) | nić rdzenia 4,5, ciało w barwie frakcji, otoczka pod progiem, diamenty Macha |
| błysk, blask kul | `GlowSprites` (własna instancja) | mały biały rdzeń, halo pod progiem, linia anamorficzna (ArcSystem) |
| dym i opary | `SmokeSystem` rakiet (compute, samocień) | opary metalu (paleta 7), sadza, dym z płonących odłamów |
| łuki | `ArcSystem` rakiet, pula ARC broni | szwy plazmy w szczelinach (tylko po metalu), łuki po poszyciu w stopieniu |
| iskry, odłamki | `SparkSystem3D`, DEBRIS broni | iskry w barwie plazmy / złota, rozżarzone odłamki oświetlane siatką |
| światła | `Core3D.fx.lights` | reaktor w wyrwie (puls 1,2 → 7 Hz), błysk 0,38 s, ogień kuli, żar; strumień i kula |
| mapa ran | `HullDamageMap` | płyta nad komorą (wiśnia → biel), brzegi pęknięć, rzaz strumienia, osmalenie sąsiadów, płonące rany (`ctx.burn`) |
| refrakcja | `Core3D.fxDistortion()` | implozja w ostatnich 0,35 s stopienia, gorące powietrze; fala — tylko opcja |
| model reaktora | `reactor3D.js` | tokamak / prowizorka piratów / podwójny pierścień Atlasa w wyrwie |

Zegar reżysera = czas symulacji (`advance(dt)`, pauza = 0), iskry na `SimClock`, łuki i dym na
zegarze reżysera rakiet. Pozycje w świecie gry (double), do GPU względem `Core3D.fx.origin`.
Rekordy SoA o stałej pojemności — bez alokacji na klatkę. Rozgrzewka: krok `warm` (`prewarmPass`
wszystkich trzech siatek z licznikiem instancji ≥ 2).

## 5. Pasma HDR i bloom — wnioski z pomiarów

Pomiary w buforze sceny przed bloomem (`__rdzen2.hdr(x, y, w, h, ukryte)`, harness `--tryb pasma`)
i A/B tej samej klatki z bloomem (`__rdzen2.still(ukryte)` — dt = 0, zegary stoją):

1. **Tło nieprzezroczyste.** Bez niego kanwa Core3D jest przezroczysta, a poświata bloomu w pustce
   (rgb > alfa na kanwie premultiplied) wychodzi ~2× jaśniej niż w grze — wybuch wyglądał na
   przepalony, choć bufor HDR był w pasmach (> 0,9 miał ~1% pikseli). Demo ma tło z gwiazdami
   (`tlo.js`); przy porównaniach z grą — pamiętać.
2. **Barwa plazmy normowana do największego kanału**, nie luminancji: czerwień piratów miała R × 2,6
   i przechodziła przez ACES w róż i biel.
3. **Biały dysk z bliska to suma poświat, nie jedna warstwa** — każda warstwa osobno była w
   pasmach; razem iskry (gęste w pierwszych 0,1 s, bo startują z jednego punktu), szwy w
   szczelinach, rozżarzone brzegi przełomu i podbicie bloomu zalewały kadr. Po przycięciu (iskry
   750 → 480 × klasa, szwy 2,9 → 1,8 luminancji, żar brzegów 1,6–2,2 → 1,0–1,35, podbicie bloomu
   +0,3 → +0,1 z τ 0,14 s, błysk świateł 1,2 → 0,38 s) biały dysk trwa ~0,1 s, potem wybuch jest
   czytelny: płaty ognia, łuki, odłamy z żarzącymi się brzegami.
4. **Sadza kul ognia dawała szare „księżyce”** (gładkie kule, bo obrys ucinał okrąg kwadu, a promień
   uśrednia szum po głębi). Teraz kula stygnie do przezroczystości, rwie się na kłęby z wiekiem, a
   szary dym robi SmokeSystem.
5. Kadłub Bellatora jest z natury jasnoszary — „biały” wrak po wybuchu to poszycie, nie światła
   (pomiar ze światłami i bez: różnica < 0,1 średniej po 0,1 s).

## 6. Decyzje, które zostały z wersji heksowej

- **Fala z refrakcją — domyślnie WYŁ.** (decyzja usera 2026-09-24/25: w grze ma ją tylko supernowa
  rakiet, „ściągaj wszędzie”). W demie klawisz W / checkbox „fala” do porównania.
- Wariant losowany na starcie stopienia (`pendingVariant`) — obraz stopienia wie, co nadchodzi.
- Mechanika rdzenia ma sens dopiero przy decyzji o puli HP (pytanie nr 1 w `docs/PORT-rdzen.md`
  § 11) — na belkach koszt dojścia do komory liczy się inaczej (krater na miarę rany zabija węzły
  bez HP), benchmark „kto zabija pierwszy” trzeba powtórzyć na belkach.

## 7. Integracja w grze (kroki)

**Stan 2026-10-02:** zrobione 2–5 (montaż, krok fizyki, detonacja zamiast `reactorblow.js`, obraz i model z rozgrzewką). Krok 1 częściowo: markery z dema w `src/data/reactorCores.js` (Atlas, Bellator, Iron Skull), reszta kadłubów — komora z automatu (`autoReactorMarker`); poprawki 1–4 edytora otwarte. Krok 6: tylko komunikat stopienia reaktora gracza (bez banera i locka w komorę). Sprawdzenie w grze: Bellator (rozprysk, 4 odłamy), niszczyciel (strumień), fregata z puli (czysty wrak), śmierć gracza — bez błędów konsoli.

Wzorzec: `dema/rdzen-webgpu/swiat.js` (`createShip`, `World.step`, `_process`, `_detonate`).

1. **Markery.** Dziś wszystkie kadłuby mają `cores: []`. Miejsca z dema (`dema/rdzen-hulls-data.js`,
   reguła „komora poza strefami mostków we wszystkich wariantach”, strażnik w
   `tests/shipCore.test.mjs`) do `hardpointEditorDefaults.js`; poprawki 1–4 z `PORT-rdzen.md` § 5
   (podwójna skala rdzeni gracza, `pirate_` → Bellator, `normalizeEditorCore`, losowy crit).
2. **Montaż.** Po `HullBodies.createHull(encja, …)` (NPC, gracz):
   `attachReactorCores(encja, markery, { pngWidth, pngHeight, classId?, color })`.
3. **Krok fizyki** (`physicsStep`, po `HullBodies.step`): strumienie (`stepReactorJet`), kule
   (`stepReactorOrbs`), kolejka wtórnych, `updateReactorCores` dla encji z `reactorCores` (okręty
   i wraki — odcięty rdzeń stopi się na odłamie), obsługa zdarzeń. Hak `hullDamage` →
   `applyDamageToNPC` / `applyDamageToPlayer` (z `{ combat: false }` dla fal spoza walki?).
4. **Detonacja** zamiast dzisiejszej śmierci z `reactorblow.js`: `applyReactorDetonation` (wrak idzie
   przez `convertToWreck` — `onWreck` gry tworzy encje wraków), usunięcie gospodarza z `npcs` bez
   `createWreckage`, `applyReactorBlast`, `fx.detonation(ev, res, hits)`, strumień / kula, wtórne.
   Śmierć z puli HP → `notifyReactorHostKilled`. Hulk mostka omija `applyDamageToNPC` — detonacja
   rdzenia hulka musi iść obok tej ścieżki.
5. **Obraz.** W `startGame` (po `createRocketFx` i `WeaponFx.ensure`):
   `createReactorBlastFx(Core3D, { rocketFx, weaponFx: WeaponFx })`, co klatkę w `render()`:
   `fx.advance(simDt)`, `fx.syncCores(rdzenie, simDt)`, `fx.syncHazards(simDt)`; `onShake` →
   `camera.addShake`. Model: `createReactor3D({ …, frameOf: reactorCoreFrame, hostReady })` +
   `reactor3D.sync(…)`. Rozgrzewka idzie przez krok `warm` sama.
6. **HUD i AI.** Baner stopienia (odliczanie), lock w komorę (`getReactorLockPoint`) — AI celowo nie
   celuje w komory (jak w mostki). Zimne wraki: rekord rdzenia zostaje, nie rysować.

## 8. Wydajność (headless, RTX 5080, 1600×900)

- Klatka poza detonacją: CPU 1,6–1,7 ms (mediana), GPU 0,45–0,66 ms (mediana), p95 < 1 ms.
- **Detonacja kapitałowca: 21–32 ms CPU w klatce wybuchu, potem 20 / 15 / 11 ms.** Z profilu
  (5 klatek, 92 ms): pieczenie SDF cieni nowych odłamów (`hullShadowSdf.js`) ~27 ms, fizyka belek po
  rozpadzie (solver, zderzenia sąsiadujących odłamów) ~24 ms, przebudowa skór ~6 ms — to koszt
  KAŻDEGO rozpadu kadłuba w grze, nie tej eksplozji. Sama detonacja ~12 ms: rozpad w silniku 2,7,
  pęknięcia 2,6 (`breakBeamsAcross` przegląda wszystkie belki na odcinek), emisja obrazu 3,5.
  Do rozważenia przy integracji: pieczenie SDF poza wątkiem głównym / na GPU albo rozłożone.
- Pula kul ognia: kwad × 1,3 promienia (× 1,69 fragmentów) — przy wielu wybuchach naraz w grze
  kandydat do obniżenia liczby kroków marszu.

## 9. Harness

```
node scripts/webgpu/rdzen-webgpu.mjs --tryb test
node scripts/webgpu/rdzen-webgpu.mjs --tryb zrzuty --scena jet --czasy 3.1,3.5 [--sledz orb --zoom 1.3] [--czyste 1]
node scripts/webgpu/rdzen-webgpu.mjs --tryb pasma --scena meltdown --czasy 7.25,7.3 --grupy "ReactorPlasmaFireballs;ReactorGlow"
node scripts/webgpu/rdzen-webgpu.mjs --tryb wydajnosc --wariant shatter
node --test tests/reactorCore.test.mjs tests/shipCore.test.mjs tests/reactor3D.test.mjs
```

Wyniki w `.tmp/rdzen-webgpu/<tryb>/` (poza repo). API strony: `window.__rdzen2` (`scene`, `setVariant`,
`meltdown`, `detonate`, `runFrames(n, fps)`, `hdr`, `still`, `stats`, `meshNames`).

## 10. Otwarte decyzje usera

1. Pula HP vs rdzeń (jak w `PORT-rdzen.md` § 11) — czy integrujemy przed decyzją.
2. Fala z refrakcją dla reaktorów: zostaje wyłączona (decyzja z 2026-09-24) czy wraca w tej wersji.
3. Łańcuch: ogniwo wchodzi w stopienie z pełnym odliczaniem klasy i wybucha słabiej (× 0,6 na
   ogniwo, `maxChainDepth` 1 — drugie ogniwo rani już tylko pulę HP); w scenie 3 z czterech okrętów
   pęka jeden sąsiad, dwa zostają KRYTYCZNE — czy łańcuch ma być łatwiejszy (formacje) czy rzadki.
4. Jasność: błysk ~0,1 s biały, rozżarzone brzegi przełomu pomarańczowe (biel tylko na krawędziach
   dziur) — do oceny w ruchu.
