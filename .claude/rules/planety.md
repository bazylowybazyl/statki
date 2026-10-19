---
paths:
  - "src/3d/planet3d.assets*.js"
  - "src/3d/planetMaps.js"
  - "src/3d/earthPit*.js"
  - "src/data/earthPit.js"
  - "src/3d/moonSurface.tsl.js"
  - "src/3d/jupiterAtmosphere*.js"
  - "src/3d/saturnAtmosphere*.js"
  - "src/3d/gasGiantAtmosphere*.js"
  - "src/data/saturnAtmosphere.js"
  - "src/data/smallBodies.js"
  - "src/3d/smallBodyShape.js"
  - "scripts/planety/**"
  - "dema/planety-webgpu.html"
---

# Planety, słońce, księżyce i małe ciała; generator map planet

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`planet3d.assets.js`** — aktywna warstwa planet/słońca (API globalne: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`).

- **`scripts/planety/`** — generator map planet (Python + numpy, offline): Ziemia „zajechana” (oceany wypompowane na ring, przemysł, pył) z WIELKĄ KOPALNIĄ RINGU na Saharze (bryła 3D w grze: `src/3d/earthPit*.js`, dane `src/data/earthPit.js`) i Mars w trakcie terraformacji — z ETOPO 2022 i MOLA (domena publiczna). Ścieżki map `src/3d/planetMaps.js` (A/B: `?planety=stare`). Demo wypieku na materiałach gry (glob, płaskie warstwy, A/B, miejsca): `dema/planety-webgpu.html`. Opis: § „Planety i słońce”, `docs/PLANETY-GENERATOR.md`. Małe ciała (Ceres ze stolicą Unii Pasa, Westa, Pallas, Hygiea, Psyche, Pluton, Charon — mozaiki Dawn / New Horizons i proceduralnie): `male_ciala.py`, dane gry `src/data/smallBodies.js`.

## Planety i słońce

- MAPY Ziemi i Marsa z generatora (2026-10-08, `scripts/planety/`, `docs/PLANETY-GENERATOR.md`; decyzje użytkownika: Ziemia prawdziwa — kontynenty z ETOPO, Mars — stały wygląd, dziura po materiale na ring jako bryła 3D). Ścieżki, mgiełka, połysk i chmury per planeta: `PLANET_MAPS` (`src/3d/planetMaps.js` — gra i tło menu). Chmury: barwa z chromy tekstury (pył), jasność z maski. Mapy normalnych w konwencji shadera: R = wschód, G = północ (dawna `earth_normal.jpg` miała G odwrócony).

- WIELKA KOPALNIA RINGU (Ziemia): kula wycina obszar dziury (`uPitMode = 1`, discard), w nim ŁATA — siatka z profilu, dziecko siatki kuli, ten sam materiał i mapy (`uPitMode = 2`: normalna ze wzoru, cień samorzucany marszem ku słońcu, żar szybu, detal skały szumem). Tło menu ma to samo (`createMenuEarthMaterial(…, { pitMode })`). Profil w TRZECH kopiach — `scripts/planety/dziura.py`, `src/3d/earthPitShape.js` (CPU, siatka), `src/3d/earthPit.tsl.js` (shader) — dane jedne: `src/data/earthPit.js` (blok JSON czyta Python). Zmiana wzoru = wszystkie trzy + ponowny wypiek Ziemi (`tests/earthPit.test.mjs`). Nowy uniform w grafie powierzchni = klucz w `SURFACE_KEYS` i w `uniforms` KAŻDEGO `DirectPlanet` (perObject czyta `material.uniforms[klucz].value`).

- Zrzuty map w grze: `node scripts/webgpu/planety-mapy-gra.mjs [--query planety=stare --tag stare] [--obok stare]`.

- KSIĘŻYCE (2026-10-08, `scripts/planety/ksiezyce.py`, `MOON_MAPS` w `planetMaps.js`, `docs/PLANETY-GENERATOR.md` § Księżyce): mapy dzień / noc / normalne z rolą w ekonomii (Luna — stocznia, depoty i garnizony Terra Nova; Io — odkrywki metalu Konsorcjum; Europa — cięcia lodu Unii Pasa po prawdziwych lineae; Ganimedes, Kallisto — depoty Konsorcjum); materiał `src/3d/moonSurface.tsl.js` (MeshStandardNodeMaterial, hak modelu oświetlenia: słońce gry świeci z PŁASZCZYZNY GRY — Słońce − środek, z = 0, jak planety — otoczenie sceny × 0,12, światła nocne z `emissiveMap` zapalane zmrokiem i w cieniu planety; graf raz na wariant, kierunek w `material.uniforms.uSunDir`). Nowy księżyc = wpis w `MOON_MAPS` po `id` strojenia.

- MAŁE CIAŁA (2026-10-12, strumień C planu `docs/PLAN-pas-realizm.md`; decyzja użytkownika: duże ciała pasa jako ciała, na Ceres STOLICA UNII PASA): Ceres, Westa, Pallas, Hygiea, Psyche, Pluton z Charonem. Dane — JEDNO źródło `src/data/smallBodies.js` (AU mapy wg umowy planu: liniowo Mars 33 ↔ Jowisz 50,2 — Ceres 38,81, Westa 36,92, Pallas 38,84, Hygiea 40,55, Psyche 39,55, Pluton 127; promień = skala Luny 9 072 j. ściśnięta pierwiastkiem — Ceres 4 717 j., Psyche 2 293, Pluton 7 503; osie, typ, rola, stacje). KĄT: planety mają losowe kąty, więc `angle` to kąt preferowany, a ostateczny daje `resolveSmallBodyAngles` z położeń świata (blok „MAŁE CIAŁA” w `index.html`): ciało pasa poza torem kampanii (Ziemia → baza piratów — `StoryGame._shipyardCenter` na tych samych danych, studnia + 120 tys. j.), z dala od planet z księżycami i olbrzymów pasa (`planBeltGiantSites`), Pluton 90–180° od Neptuna; te same kąty dostaje ruch v2 (`planetAngles` → `trafficWorld.smallBodyOutposts`: węzły 'ceres' / 'vesta' w punkcie stacji gry). Gra: obiekty `window.smallBodies` (pola jak planety: x, y, r, `orbitZone` — `planetOrbitRadii` działa) w `detectZones` (warp × 0,3, hamowanie grawitacyjne), objazdach TRAVEL TO (`getCruiseGravityObstacles`, `getTravelWells`), celu / starcie i zwolnieniu skoku (`warpPlanetNear`, `planPlayerWarp`), podpisach, radarze i CIC (`hudRadarWorldFeatures`, `drawSolarSystem`). Stacje Unii (`createSmallBodyStations`: „Ceres — Stolica Unii” — bryła stacji Marsa z `MODEL_URLS.ceres`, ~7× większa od `r` stacji; „Westa — Huta Unii” — model domyślny) to zwykłe stacje gry (rynek, dok, frakcja `belt_union`). Skały pola omijają ciała i stacje: `field.setExclusions([...giants.exclusions(), ...smallBodyExclusions(...)])` po `createAsteroidBelt` (nowe wołanie `giants.applyExclusions` zdjęłoby wyłączenia ciał). Render: `DirectSmallBody` (`planet3d.assets.js`) — pass ring-planet (warstwa 6, ortho, bez paralaksy), środek pod płaszczyzną (szczyt z = −400), materiał księżyców z maską słońca (program Luny), kształt bryły z mapy promienia (`src/3d/smallBodyShape.js`: PNG 16 bitów RG, zakres w bloku `SMALL_BODY_SHAPE` `planetMaps.js` — czyta go też generator), doba i nachylenie osi, smuga cienia (`pushShaftDiscWorld`), soczewka świata, rozgrzewka `małe ciała (…)`. Mapy: `scripts/planety/male_ciala.py`, `SMALL_BODY_MAPS` (`docs/PLANETY-GENERATOR.md` § Małe ciała). Nowe ciało = wpis w `smallBodies.js` + `SMALL_BODY_MAPS` + generator. Testy `tests/smallBodies.test.mjs`, w grze `node scripts/webgpu/male-ciala-gra.mjs`, demo `dema/planety-webgpu.html?cialo=ceres|westa|pallas|hygiea|psyche|pluton|charon`.

- ŻYWA ATMOSFERA JOWISZA (2026-10-08, prośba użytkownika: „animowana atmosfera z wielkim wirującym okiem”; `src/3d/jupiterAtmosphere.js` — dane, pasy, wiry, zegar; `jupiterAtmosphere.tsl.js` — barwa dnia z przepływu). Rodzaj grafu `'jupiter'` w `planet3d.assets.tsl.js` = graf powierzchni z `flow` (te same oświetlenie, terminator, pas zachodu, cień ringu, bloom), tylko próbka mapy dnia idzie przez przepływ; inne planety mają WGSL bez zmian, klucze Jowisza (`JUPITER_UNIFORM_KEYS`) dopisuje `JupiterAtmosphere` tylko do jego `uniforms` (nie do `SURFACE_KEYS`). Dwie warstwy ruchu: (1) SZTYWNY, nieograniczony, liczony na CPU w double co klatkę (`_spin` → `jupiterAtm.step()`): pasy-segmenty między lokalnymi minimami profilu wiatru z Cassini (Porco 2003, tabela BAA) jadą każdy swoją średnią prędkością kątową (tablica uniformów `jupiterBands`, na granicy ±0,6° przenikanie barwą — bez narastającego ścinania), wiry leżą w segmentach-plateau (`jupiterBandSegments`), jądro GRS obraca się sztywnie po elipsie (`jupiterVortices`, kąt z CPU); (2) RESZTA w shaderze dwiema fazami przenikanymi (flow map): szybsze dżety w segmencie, kołnierz wirów, turbulencja curl3D ze ścinania — sama mapa przepływu NIE wystarcza (średni wiek próbki stały → w pierwszym rzędzie obraz stoi; zmierzone w zrzutach). Czas = czas gry (`SimClock.render`; w pauzie stoi) × `JupiterAtmTune.timeScale`, przy zbliżeniu wolniej (`zoomFollow`). Próbki mapy tylko z gradientem nieprzesuniętego uv albo poziomem (dowolny przepływ sterowania, bez szwu mipmap). Mapa `jupiter_cassini_color.jpg` (PIA07782 → `scripts/planety/jowisz.py`); położenia wirów zmierzone NA TEJ MAPIE — nowa mapa = nowy pomiar `JUPITER_VORTICES`. Strojenie `window.JupiterAtmTune` (`on: 0` — sama mapa), testy `tests/jupiterAtmosphere.test.mjs`, w grze `node scripts/webgpu/jowisz-gra.mjs` (arkusze ruchu, GIF GRS, A/B, zegar w pauzie, pipeline'y w klatce — 0, koszt GPU).

- ŻYWA ATMOSFERA SATURNA (2026-10-09, prośba użytkownika: „animowana atmosfera Saturna — cyklony, ruchoma atmosfera”; pierścienie przecinające płaszczyznę gry — następna tura). WSPÓLNY SILNIK gazowych olbrzymów `src/3d/gasGiantAtmosphere.js` (model planety: profil wiatru, granice pasów, wiry, czapy polarne, klucze uniformów, nazwy buforów; klasa zegara) + `gasGiantAtmosphere.tsl.js` (barwa dnia z przepływu) — Jowisz jest jego modelem (`JUPITER_MODEL`, API i WGSL bez zmian), Saturn — `src/3d/saturnAtmosphere.js` (rodzaj grafu `'saturn'`, klucze `uSat*`, bufory `saturnBands` / `saturnVortices`). Dane (profil wiatru Cassini, sześciokąt, czapy, burza 2011, wiry) — JEDNO źródło `src/data/saturnAtmosphere.js`, czyta je też generator mapy `scripts/planety/saturn.py` (zmiana położeń = ponowny wypiek). CZAPY POLARNE: za granicą czapy ruch po liniach prądu wokół bieguna (na północy po SZEŚCIOKĄCIE — kształt `polygonShapeCpu`, lustro w generatorze), jądro wiru polarnego obracane sztywnie (kąt w double), segment nad czapą bez ruchu sztywnego. Nowy gazowy olbrzym = nowy `GasGiantModel` + rodzaj w `BUILDERS` (`planet3d.assets.tsl.js`). Opis i źródła: `docs/PLANETY-GENERATOR.md` § Saturn, testy `tests/saturnAtmosphere.test.mjs`, demo `dema/planety-webgpu.html?cialo=saturn`, strojenie `window.SaturnAtmTune`.

- `initPlanets3D(planets, SUN)` — inicjalizacja.

- `updatePlanets3D(dt, cam)` — aktualizacja.

- Planety są częścią wizualnej warstwy 3D, gameplay nadal jest liczony w 2D.

- Halo (poświata limbu) Ziemi i Marsa: `createRingAtmosphere` w `planet3d.assets.js` — płaski dysk w passie ortho z modelem atmosfery z tła menu (cięciwa przez powłokę R + H, gęstość e^(−h/Hs)), gaśnie do zera na brzegu powłoki. Nie wracaj do powłoki-kuli z maską Fresnela: przy 1,21 R dawała kropkowany łuk, przy 1,034 R ~1% jasności (halo znikało).

- Noc i pas zachodu (2026-10-06, decyzja użytkownika po A/B: noc czarna i NIEprzezroczysta, „prawdziwy ładny pas zachodu”): powierzchnia bez światła otoczenia i szerokiego terminatora (dawne `uAmbient` / `uSunWrap` / `sunsetTint` powierzchni usunięte — dawały szaroniebieską noc Marsa i Jowisza i gruby czerwony pas Ziemi), nocą tylko miasta z mapy nocy (ląd w świetle księżyca odcięty progiem). Pas zachodu z przepuszczalności atmosfery (`SUNSET`, `sunTransmittance`, `sunsetGlow` w `planet3d.assets.tsl.js`): masa powietrza z wysokości słońca, współczynniki = `uHazeBeta × uHazeStrength` planety (Ziemia: złoto → pomarańcz → czerwień, Mars lekko błękitnieje), łuna powietrza tuż za terminatorem gruntu, chmury dłużej oświetlone i barwione tym samym światłem; planety bez mgiełki — zwykły terminator. Nie wracaj do doklejonego pasa barwy ani do przezroczystej nocy (w A/B mgławica przez planetę = hologram). Zrzuty w grze: `node scripts/webgpu/planety-noc-gra.mjs [--tag x --obok A,B]`.

- Materiały w TSL (port WebGPU, zadanie 05): `src/3d/planet3d.assets.tsl.js`. Graf RAZ na rodzaj (powierzchnia,
  chmury, poświata planet tła i księżyców, poświata limbu, słońce), każde ciało dostaje lekki `PlanetBodyNodeMaterial`
  z tymi samymi węzłami; wartości per ciało w `material.uniforms` (obiekty `{ value }` — kontrakt
  `window.EARTH.uniforms.*Texture.value` / `cloudUniforms` dla tła menu bez zmian), tekstury per ciało przez
  `PlanetObjectTextureNode`. Mgławica (`uniforms.map.value` pożycza tło menu) i gwiazdy — węzły za adapterem uniformów.
  Maska słońca: JEDEN import z `sunShadowMask.js` (TSL, zadanie 03) — `sunVisibility()` na ciałach przy ringu
  (`uSunShadowRecv = 1`; planety tła w perspektywie jej nie czytają), `sunShaftBackdrop()` na mgławicy i gwiazdach.

- Gwiazdy (`StarSystem`): WebGPU rysuje punkty zawsze po 1 px, więc to `Mesh` z `InstancedBufferGeometry` (kwadrat ×
  26 000, dane gwiazd w JEDNYM przeplecionym buforze instancji — limit 8 buforów wierzchołków) i kwadrat punktu z GL
  (bok gl_PointSize obcięty do ≥ 1 px, gl_PointCoord z rogów, t w dół). Nie wracaj do `THREE.Points` z rozmiarem.
  Skok (zadanie 22): smugi PŁASKIE wzdłuż kursu i front wyjścia od dziobu z `WARP_STARS` (`src/3d/warp/stars.js`, pisze
  tylko sterownik warpa — nie prędkość lotu); dawne rozciąganie i „bicz” przy wyjściu usunięte. Bez warpa gałąź punktu
  jak przed zadaniem 22.

- Poświata limbu: blend ONE/ONE przez `CustomBlending` — `NodeMaterial` z `premultipliedAlpha = true` mnożyłby kolor
  przez alfę w shaderze (ShaderMaterial z tą flagą zmieniał tylko blend).

- A/B planet, księżyców i stacji w prawdziwej grze (harness nie ma kadru z Ziemią przy ringu):
  `node scripts/webgpu/planety-gra.mjs [--root <worktree tagu webgl-baseline>]`, porównanie `porownaj.mjs`.
