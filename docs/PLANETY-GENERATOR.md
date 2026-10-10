# Generator map planet i wielka kopalnia ringu

Mapy Ziemi i Marsa w grze są wypiekane offline z prawdziwych danych wysokości (2026-10-08, decyzje
użytkownika: Ziemia **prawdziwa** — rozpoznawalne kontynenty, Mars — **stały wygląd**, dziura po materiale
na ring — „może 3D”, zrobiona jako bryła).

## Świat

- **Ziemia „zajechana”**: ludzkość żyje na ringu „Halo”, oceany wypompowano (woda poszła na ring), na Ziemi
  został przemysł i roboty. Szczątkowe morza w najgłębszych basenach (poziom −4 800 m, ~19% powierzchni —
  dziś 71%), dawne dno odsłonięte: szelfy, stoki kontynentalne jako wielkie skarpy, grzbiety śródoceaniczne
  jako łańcuchy gór, osady jak w prawdziwych oceanach (biały muł wapienny nad głębokością kompensacji
  ~4,5 km, czerwony ił głębiej, szary muł krzemionkowy na dużych szerokościach), solniska w wyschniętych
  basenach i wokół mórz (solanka różowa). Ląd martwy i wyschnięty, strefy przemysłu w miejscach dawnych
  metropolii, odkrywki w górach, pola odkrywkowe na dnie, drogi; nocą huty, pojedyncze posterunki robotów.
  Chmury rzadkie, pył i łukowe fronty burz piaskowych (barwa w chmurach — shader bierze chromę tekstury).
  Atmosfera zapylona (mgiełka płowa, `PLANET_MAPS.earth.haze` / `menuAir`).
- **Wielka kopalnia ringu** na Saharze (20,5° N, 13,5° E): ~1 700 km średnicy, 13 tarasów o nierównej
  szerokości, dno 38 km, szyb do gorącej skały (+45 km, ~900 °C — żarzy się, w dzień słabiej), wał hałd,
  spiralne drogi, trzy tory wyrzutni masy. Bryła 3D z przewyższeniem ×3.
- **Mars w trakcie terraformacji**: młody ocean na północnych nizinach (poziom −3 900 m MOLA, ~17%),
  morza Hellas i Argyre, jeziora w kraterach, zieleń od brzegów i równika w górę stoków (porosty → mech →
  trawa → las), rude wyżyny i Tharsis bez zmian, mniejsze czapy, miasta z polami, chmury i fale zawietrzne
  wulkanów. Atmosfera gęstsza (mocniejsza mgiełka, błękitne zachody zostają).

## Dane (pobierane raz, `.tmp/planety-dane/`, poza repo)

| Plik | Źródło | Licencja |
|---|---|---|
| `etopo/surface.tif`, `etopo/bed.tif` | NOAA ETOPO 2022, 60″ GeoTIFF (`ETOPO_2022_v1_60s_N90W180_surface/bed.tif`, ngdc.noaa.gov/mgg/global/relief/ETOPO2022/data/60s/) | domena publiczna |
| `mola/megt90n000fb.img` (+ `.lbl`) | NASA PDS, MOLA MEGDR 32 px/° (pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/) | domena publiczna |

Detal gruntu bierze generator z dotychczasowych map gry (`earth_color.jpg`, `mars_color.jpg`), miejsca dawnych
metropolii z `earth_nightmap.jpg`, chmury Ziemi z `earth_clouds.jpg`. Obecna `earth_normal.jpg` miała kanał G
odwrócony (północ ↔ południe) względem shadera — nowe mapy są w konwencji shadera (R = wschód, G = północ).

## Uruchomienie

```
python -m venv .tmp/venv-planety
.tmp/venv-planety/Scripts/python -m pip install -r scripts/planety/requirements.txt
.tmp/venv-planety/Scripts/python -I scripts/planety/ziemia.py --szer 2048            # podgląd → .tmp/planety/
.tmp/venv-planety/Scripts/python -I scripts/planety/ziemia.py --szer 8192 --do-gry   # mapy gry (~5 min)
.tmp/venv-planety/Scripts/python -I scripts/planety/mars.py --szer 8192 --do-gry     # (~2 min)
.tmp/venv-planety/Scripts/python -I scripts/planety/merkury.py --szer 8192 --do-gry  # (~2 min; podgląd 2048 ~30 s)
.tmp/venv-planety/Scripts/python -I scripts/planety/wenus.py --szer 8192 --do-gry    # (~5,5 min; podgląd ~25 s)
```

Wyjście: `public/assets/planety/solar/{earth,mars}/{earth,mars}_hf_{color,night,water,normal,clouds}.jpg`
(8192 × 4096, równoodległe: kolumna 0 = 180° W, wiersz 0 = biegun N). Podglądy 2048 px w `.tmp/planety/podglad-*`.
Moduły: `wspolne.py` (siatka, szum 3D na kuli bez szwów, normalne z wysokości, zapis), `ziemia.py`, `mars.py`,
`dziura.py` (profil kopalni + wypiek barw i świateł).

## Gra

- Ścieżki i ustawienia map: `src/3d/planetMaps.js` (`PLANET_MAPS`: mapy, `pit`, `haze`, `menuAir`,
  `specular`, `cloudOpacity`). A/B ze starymi zdjęciami NASA: `?planety=stare` albo
  `localStorage.sc_planet_maps = 'stare'` (bez dziury i bez map Marsa).
- **Dziura (bryła)**: kula Ziemi wycina obszar dziury (`uPitMode = 1`: discard dla s < `EARTH_PIT_CUT_S`), w tym
  miejscu leży ŁATA — siatka z profilu (`earthPit3D.js`, `earthPitShape.js`), dziecko siatki kuli (doba, soczewka
  warpa, skala grupy działają same), ten sam materiał i mapy co kula (`uPitMode = 2`), więc szew nie widać.
  Na łacie fragment liczy normalną ze wzoru profilu (tarasy ostre przy każdej gęstości siatki), cień
  samorzucany marszem promienia ku słońcu po bryle, światło nieba w cieniu, detal skały szumem i żar szybu
  z siecią pęknięć (`earthPit.tsl.js`). To samo w tle menu (`menuBackdrop3D.tsl.js`, `pitMode`).
- **Profil = JEDNO źródło danych, TRZY kopie wzoru**: `src/data/earthPit.js` (blok JSON między znacznikami
  `/*EARTH_PIT*/` — czyta go też Python), `scripts/planety/dziura.py` (`profil`), `src/3d/earthPitShape.js`
  (`earthPitProfileCpu`, siatka łaty) i `src/3d/earthPit.tsl.js` (`earthPitProfile`). Zmiana wzoru = zmiana we
  wszystkich trzech; zmiana liczb = ponowne wypieczenie Ziemi. Test `tests/earthPit.test.mjs`.
- Chmury: barwa z chromy tekstury (biel = chmura, brąz = pył), jasność niesie maska — dawne białe mapy bez zmian.
- Zrzuty w prawdziwej grze: `node scripts/webgpu/planety-mapy-gra.mjs [--tag nowe] [--query planety=stare --tag stare]
  [--obok stare]` (menu, cała Ziemia, dziura w dzień, przy brzegu tarczy, przy terminatorze, z bliska, Mars).

## Merkury i Wenus: rola w ekonomii na mapie (2026-10-08)

Prośba użytkownika: pozostałe planety mają pokazywać swoją rolę w ekonomii gry (`PLANET_YIELD` w
`src/data/resources.js`, `SYSTEM_INDUSTRY_SPEC` w `src/game/stationEconomy.js`), np. „Merkury silnie kopie — widoczne
sieci logistyczne kopalń w dzień i w nocy, globalne na całą planetę”.

| Plik (`.tmp/planety-dane/`) | Źródło | Licencja |
|---|---|---|
| `merkury/dem.tif` | NASA/USGS, Mercury MESSENGER USGS DEM Global 665 m v2 (planetarymaps.usgs.gov/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif) | domena publiczna |
| `wenus/dem.tif` | NASA/JPL/USGS, Venus Magellan Global Topography 4641 m v2 (planetarymaps.usgs.gov/mosaic/Venus_Magellan_Topography_Global_4641m_v02.tif) | domena publiczna |

- **Układ danych**: oba DEM-y mają kolumnę 0 na 0° E (Merkury — przesunięcie o W/2 jak MOLA, do tego −0,13°: szczyt
  korelacji rzeźby z mapą koloru) albo 180° W (Wenus). Dawna `venus_color.jpg` jest **obrócona o 180°** względem IAU
  (korelacja rzeźby 0,42 tylko po odbiciu obu osi) — generator ją odwraca, mapy gry są w układzie IAU (Ishtar na
  północy). Wenus ma ~8% luk (wypełniane piramidą rozmyć).
- **Merkury — planeta-kopalnia** (`merkury.py`, ~2 min przy 8K): 26 węzłów-hut w rudnych prowincjach (szum + ciemny
  materiał LRM + gładkie równiny), ~690 odkrywek (tarasy, spiralna rampa, hałdy, CIEMNA AUREOLA wyrzutu z promienistymi
  smugami — widoczna z orbity), 8 wielkich odkrywek w dnach dużych kraterów, 22 pola odkrywkowe na gładkich równinach
  (front robót z wałami nadkładu), lód w 10 kraterach polarnych, farmy słoneczne (bloki paneli, tylko na płaskim, połysk
  przez `spec`), hałdy żużlu z żarem, 7 wyrzutni masy, 3 kotwice wyciągów na równiku, ciemny pył rudnych prowincji.
  GLOBALNA SIEĆ TRAS po terenie (`infrastruktura.graf_terenu` — Dijkstra po siatce 1024 × 512 z kosztem z nachylenia,
  trasy omijają ściany kraterów): magistrale = drzewo rozpinające hut + skróty, odnogi kopalń do huty z tańszą jazdą
  po magistralach (`odnogi_do_hub` — wpadają w magistrale pod kątem ostrym, sąsiednie kopalnie dzielą odnogę).
  Noc: huty (żar), PRZERYWANE łańcuchy świateł tras (odstęp i przerwy wg klasy drogi), światła odkrywek, cewki wyrzutni.
  Bez atmosfery (bez `haze`), `specular` 0,6 tylko na panelach i halach.
- **Wenus — planeta fabryk** (`wenus.py`, ~5,5 min przy 8K): przemysł NA POWIERZCHNI, na wyżynach (chłodniej,
  rzadsze powietrze, „szron metaliczny” — jasne w radarze siarczki metali na szczytach > ~2,5 km — tu kopie się miedź).
  24 węzły: połowa najwyżej położonych = fabryki elektroniki (długie hale o jasnych dachach, radiatory) z miastami,
  reszta = huty z żużlem; ~420 kopalń miedzi / krzemu, 90 pól kryształu w tesserach (rowy, szkliste odpady z połyskiem),
  34 zakłady amunicyjne (bunkry w wałach, 250–750 km od węzłów), 220+ osiedli przy drogach, wyrzutnie masy, ta sama
  sieć tras. Noc: więcej świateł niż Merkury — zimna biel miast i fabryk, osiedla, obwody zakładów amunicyjnych.
  Chmury: dawna `venus_atmosphere.jpg` jako półprzezroczysta warstwa z przerwami (`cloudOpacity` 0,4; barwa z chromy);
  shader chmur gasi je nocą, więc światła miast widać. Mgiełka bez zmian (0,85 z `planet3d.assets.js` — przy środku
  tarczy przepuszcza ~90% światła, infrastruktura i tak czytelna).
- **Skala detali**: Merkury i Wenus to planety tła (perspektywa, z = −50 000) — promień na ekranie ma sufit:
  Merkury 216–305 px, Wenus 401–427 px przy 1080 wierszach (zoom gry 0,08–3,2). Piksel ekranu ≈ 8 km na Merkurym,
  14 km na Wenus — stąd odkrywki ≥ 6–7 km promienia, huty 25–75 km, magistrale ~7–20 km szerokości pasa.
- Zrzuty w grze: `node scripts/webgpu/planety-mapy-gra.mjs --tylko merkury-caly,merkury-dzien,merkury-oddal,
  merkury-blisko,merkury-noc,merkury-noc-blisko,wenus-cala,wenus-dzien,wenus-ishtar,wenus-afrodyta,wenus-noc,
  wenus-noc-blisko` (`zoom` = zoom gry wprost, `sunH` — słońce w poziomie od planety, terminator pionowy).
- Wyjście: `public/assets/planety/solar/{mercury,venus}/*_hf_{color,night,normal,spec}.jpg` (+ `venus_hf_clouds.jpg`);
  stare mapy zostają (`?planety=stare`).

## Jowisz: mapa Cassini i żywa atmosfera (2026-10-08)

Prośba użytkownika: „animowana atmosfera Jowisza, z uwzględnieniem tego wielkiego wirującego oka” (bez
infrastruktury — planeta gazowa). Jowisz ma ring „Halo” (Fable), więc leży w passie ortho przy ringu.

**Mapa** — `scripts/planety/jowisz.py` (`.tmp/venv-planety/Scripts/python -I scripts/planety/jowisz.py`):

| Plik (`.tmp/jowisz-dane/`) | Źródło | Licencja |
|---|---|---|
| `PIA07782.tif` | NASA/JPL/Space Science Institute, „Cassini's Best Maps of Jupiter: Cylindrical Map” (XII 2000), 3601 × 1801, 0,1°/px, szerokość planetocentryczna, assets.science.nasa.gov/…/pia07782/PIA07782.tif | domena publiczna (NASA/JPL) |
| `jets.pdf` | J. Rogers, BAA Jupiter Section: „Latitudes and speeds of jets on Jupiter” (britastro.org/jupiter/reference/jup_jets/) — kolumna Cassini = Porco i in. 2003, Science 299, 1541 | dane (cytowane w kodzie) |

Dawna `jupiter_color.jpg` to ta sama mozaika (inne przetworzenie: cieplejsza, wyostrzona, stratna, w NEB inne
szczegóły; pochodzenie nieopisane). Skrypt: przeskalowanie 3601 → 4096 (bikubicznie, zawinięcie w długości),
wyrównanie do dawnej mapy korelacją fazową (GRS w tym samym miejscu tekstury; −0,93° / −0,24°), wyostrzenie
(maska nieostra drobna + lokalny kontrast), barwy dawnej mapy PASAMI SZEROKOŚCI (średnia i rozrzut kanału w każdym
wierszu jak w dawnej — jedna krzywa na całą mapę dawała błotnisty NEB), bieguny bez danych Cassini (N > 88,5°,
S < −81°) z dawnej mapy. Wynik: `public/assets/planety/solar/jupiter/jupiter_cassini_color.jpg` (`PLANET_MAPS.jupiter`;
`?planety=stare` — dawna mapa, wtedy położenia wirów są o ~1° obok).

**Atmosfera** — `src/3d/jupiterAtmosphere.js` (dane, pasy, wiry, zegar) + `jupiterAtmosphere.tsl.js` (barwa dnia
z przepływu w grafie powierzchni, rodzaj `'jupiter'`):

- Profil wiatru strefowego: szczyty z tabeli Cassini przeliczone na szerokość planetocentryczną (spłaszczenie
  (Rp/Re)² = 0,8745), między szczytami interpolacja kosinusowa, słabe prądy wsteczne (−8 m/s) wstawione między
  szczytami wschodnimi |φ| > 30° (tabela ich nie podaje), za ±80° zero. Tekstura 512 × 1: wiatr, ścinanie, maska
  turbulencji.
- RUCH SZTYWNY (spójny, bez końca — CPU w double): pasy-segmenty między lokalnymi minimami profilu, każdy ze średnią
  prędkością kątową (strefa równikowa z festonami ~85–95 m/s na wschód), na granicy ±0,6° przenikanie barwą dwóch
  sąsiednich segmentów (bez narastającego ścinania). Wiry w segmentach-plateau ze swoim dryfem (GRS −3 m/s),
  JĄDRO GRS obraca się sztywnie po elipsie przeciwnie do wskazówek zegara (prędkość wnętrza, ρ < 0,45…0,8).
- RESZTA (shader, dwie fazy przenikane, okres 9 s gry, rozsunięte szumem): prędkość prawdziwa − sztywna (dżety
  w środku segmentu płyną szybciej niż pas), kołnierz wirów (ω(ρ): obrzeże ~5,5 doby, wnętrze 0,3 tego), turbulencja
  z pola wirowego curl3D niesionego przez pas, siła ze ścinania. Korekta kontrastu przy przenikaniu różnych obrazów.
- Wiry zmierzone na mapie Cassini (`JUPITER_VORTICES`): GRS (132,4° u, 20,5° S, półosie 7,9° × 5,3°), trzy białe
  owale 37° S, owal 37° N, owal i dwie brązowe barki NEB. Małe owale bez obrotu sztywnego (płyną w miejscu).
- Czas = czas gry (`SimClock.render`) × `timeScale` (5000 s rzeczywistych na s gry przy całej tarczy); przy zbliżeniu
  wolniej (pasy ×(1,5 / px na teksel)^0,75, wiry ^0,225), żeby ruch na ekranie został spokojny.
- Narzędzie: `node scripts/webgpu/jowisz-gra.mjs [--tylko caly,grs,grs-blisko,pas-blisko,owale] [--tune '{…}']` —
  arkusze ruchu, GIF GRS (40 klatek co 1,5 s gry), A/B z atmosferą wył., zegar (krok gry / pauza), pipeline'y
  w klatkach, koszt GPU (atmosfera ↔ zwykła powierzchnia).

## Saturn: mapa i żywa atmosfera (2026-10-09)

Prośba użytkownika: „brak danych w dobrej jakości Saturna (tak jak masz Jowisza) — zrób fajną animowaną atmosferę,
tam też są cyklony i ruchoma atmosfera”; najpierw sama planeta, pierścienie (przecinające płaszczyznę gry, pod kątem,
z asteroidami) — w następnej turze. Referencje od użytkownika: zdjęcia Cassini w barwach wzmocnionych (burza 2011
z pomarańczowymi włóknami nad kremowym równikiem; niebieski biegun płn. z okiem i pierścieniami chmur, drobne białe
chmurki) i kremowo-maślany Saturn z diagramu NASA.

**Dane** (`.tmp/saturn-dane/`, poza repo):

| Plik | Źródło | Licencja |
|---|---|---|
| `opal_<rok>.tif` (2019a, 2020a, 2022a, 2024a, 2025a) | Hubble OPAL (A. Simon, NASA GSFC), MAST HLSP `hlsp_opal_hst_wfc3-uvis_saturn-<rok>_f395n-f502n-f631n_v1_globalmap.tif`, doi:10.17909/T9G593 | dane publiczne (NASA/ESA HST) |
| `contzonal.csv` | Cassini ISS, wiatry strefowe 2004–2009 (García-Melendo i in. 2011, Icarus 215, 62), PDS Atmospheres `coiss_zonal_winds`, doi:10.17189/1518962 | domena publiczna (PDS) |

Globalnej mapy Saturna w dobrej jakości nikt nie wydał (Cassini — wycinki i bieguny; OPAL — 0,2°/px, jedna półkula
na rok, pas pierścieni czarny), więc `scripts/planety/saturn.py` mapę SKŁADA (8192 × 4096, ~10 min; podgląd 2048 ~2 min,
`--kadry` — wycinki burzy, równika, alei i biegunów w rzucie azymutalnym w `.tmp/planety/saturn/`):
- JASNOŚĆ PASÓW z OPAL (mediana wiersza po pikselach z danymi, szerokość planetograficzna → planetocentryczna,
  mapy wyrównane jasnością; płn. 2019–2022, płd. 2024–2025, pas ±9° bez danych — pierścienie i ich cień),
  BARWA z palety po szerokości (referencje użytkownika: złoto-pomarańczowe pasy, kremowy równik z chłodnym odcieniem,
  niebieski biegun płn.);
- DETAL z fizyki: wiry z adwekcji polem bezźródłowym (funkcja prądu ψ z szumu, 10 kroków Eulera, siła ze ścinania
  profilu Cassini i w pasie burzy) — zwinięte włókna jak w płynie, smugi wzdłuż równoleżników;
- OBIEKTY z `src/data/saturnAtmosphere.js` (JEDNO źródło z grą — gra je obraca w tych miejscach): pas burzy 2010–2011
  (głowa 32,6° N, ogon dookoła planety), anticyklon 2011, fala wstęgowa 42° N, owale alei burz 41° S i 60° N / 52° S,
  SZEŚCIOKĄT 75,4° N (kształt = `polygonShapeCpu` z shadera — lustro `polygon_shape`), wiry polarne N i S (oko, ściana
  oka złamana szumem, spiralne ramiona), drobne chmury konwekcyjne.

**Atmosfera** — wspólny silnik gazowych olbrzymów `src/3d/gasGiantAtmosphere.js` + `.tsl.js` (od 2026-10-09 liczy
też Jowisza — jego API i WGSL bez zmian), model Saturna `src/3d/saturnAtmosphere.js` (rodzaj grafu `'saturn'`):
- profil wiatru z tabeli Cassini (co 0,5°, gauss σ = 0,7°; za 82,9° N — dżet wiru polarnego z literatury); dżet
  równikowy ~370 m/s (3× Jowisz) pocięty na pasy sztywne o rozrzucie ≤ 36 m/s (`SATURN_MAX_SPREAD`), granice
  na minimach profilu (głębszych niż 12 m/s);
- CZAPY POLARNE (69,5° N, 64,5° S — minima profilu): ruch po LINIACH PRĄDU wokół bieguna we współrzędnych azymutalnych
  (siatka równoodległa przy biegunie nie działa w pasach u), na północy wzdłuż SZEŚCIOKĄTA (dżet stoi w Systemie III,
  chmury płyną wzdłuż boków), jądro wiru polarnego obraca się sztywnie (kąt w double, cyklon — na wschód), reszta
  dwiema fazami; pas-segment nad czapą ma prędkość sztywną 0;
- wiry z danych (anticyklon 2011, owale) jak GRS Jowisza — jądra obracane sztywnie w swoich plateau.
- Strojenie `window.SaturnAtmTune` (`timeScale` 2000 — równik okrąża planetę w ~5 min gry, `poleSpeed`), testy
  `tests/saturnAtmosphere.test.mjs`. Mapa: `PLANET_MAPS.saturn` (`atmosphere: true`; `?planety=stare` — dawna mapa bez
  animacji). Saturn jest planetą tła (perspektywa) — tempo bez zależności od zoomu gry.
- Demo: `dema/planety-webgpu.html?cialo=saturn` (miejsca: sześciokąt, wir polarny, głowa burzy, anticyklon, owal,
  fala wstęgowa, dżet równikowy, wir płd.; suwak „Tempo atmosfery”; NOWE / STARE).

## Księżyce: rola w ekonomii na mapie (2026-10-08)

Prośba użytkownika: ciała mają pokazywać, czym się zajmują w ekonomii (src/data/systemMap.js, resources.js,
factions.js). Generator `scripts/planety/ksiezyce.py` (`--cialo luna|io|europa|ganimedes|kallisto|wszystkie`,
`--do-gry`; podgląd 2048 w `.tmp/planety/podglad-ksiezyce-2048/` z plikiem `<ciało>-miejsca.json`), mapy dzień +
noc + normalne w `public/assets/planety/solar/moons/<luna|io|europa|ganymede|callisto>_hf_*.jpg` — Luna 4096 × 2048
(14 j. świata na teksel jak Ziemia 8K), galileuszowe 2048 × 1024 (6–9 j. na teksel). Ścieżki: `MOON_MAPS` w
`src/3d/planetMaps.js` (`?planety=stare` — dawne mapy i dawny materiał).

| Plik (`.tmp/planety-dane/`) | Źródło | Licencja |
|---|---|---|
| `luna/lroc_color_poles_8k.tif`, `luna/ldem_16.tif` | NASA SVS „CGI Moon Kit” (svs.gsfc.nasa.gov/4720): LRO LROC WAC barwa, LRO LOLA wysokość 16 px/° (km) | domena publiczna (NASA) |
| `io/Io_GalileoSSI-Voyager_Global_Mosaic_1km.tif` | USGS Astrogeology, planetarymaps.usgs.gov/mosaic/ | domena publiczna (USGS/NASA) |
| `europa/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif` | jw. | jw. |
| `ganimedes/Ganymede_Voyager_GalileoSSI_global_mosaic_1km.tif` | jw. | jw. |
| `kallisto/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif` | jw. | jw. |

Mozaiki USGS są szare (Io też), 0 = brak danych (bieguny, luki) — wypełniane od brzegów rozmyciem + szum
o amplitudzie detalu. Konwencja jak mapy gry (180° W na lewej krawędzi); dawne mapy Europy, Ganimedesa i Kallisto
były przesunięte o 180° (nowe trzymają standard USGS). Barwa: Io — chroma dawnej `jupiterIo.jpg` (rozmyta 30 km,
nasycenie ×0,5) × jasność mozaiki; Europa — paleta (lód kremowy / chłodniejszy na półkuli wiodącej, lineae
i chaos brązowe, półkula wsteczna (apeks 90° E) ciemniejsza i rudsza); Ganimedes — ciemne regiony szarobrązowe,
pasma pręgowane jasnoszare, czapy szronu; Kallisto — ciemna szarość, jasne kratery. Jasność średnia `JASNOSC`
(Luna z LROC ~0,29, Io 0,45, Europa 0,52, Ganimedes 0,42, Kallisto 0,26 — albedo ściśnięte pierwiastkiem).
Rzeźba: Luna z LOLA (przewyższenie 2,2), galileuszowe z górnoprzepustowej jasności (Europa: ciemne lineae =
grzbiety) + bryły infrastruktury.

- **Luna — Terra Nova, węzeł bez wydobycia**: aneks stoczni na południu Mare Imbrium (5 suchych doków 30–66 ×
  8–13 km z kadłubami w budowie, plac, hale), 3 depoty z farmami zbiorników (Tranquillitatis, Serenitatis,
  Nubium), 4 garnizony (bunkry z wałami, kopuły radarów), port główny na Sinus Medii, ~30 placówek, trakty
  (przyciemniony regolit). Nocą chłodna biel, rzadkie czerwone znaki, ciepłe hale; światła przerywane.
- **Io — kopalnia metalu Konsorcjum Zewnętrznego**: 6 odkrywek (Fe / Ti / Cu — ton rudy w ścianach) 40–90 km
  z dala (> 420 km) od czynnych paterae: obrys z 2–3 płatów, stopnie nierówne (szum), wysokość schodkowa 5–8 km,
  hałdy płatami w barwie gruntu, zakład z hutą i żużlem, droga urobku, pył; 2 porty, tor wyrzutni masy (eksport).
  Nocą sód łukami na krawędziach, przodki, żar huty, fiolet Konsorcjum w znakach portu; słaby żar lawy w 15 gorących
  punktach (Loki, Pele, Prometeusz… — natura, nie przemysł).
- **Europa — kopalnia lodu Unii Pasa**: 4 pola cięć PO PRAWDZIWYCH SPĘKANIACH (lineae wykryte w mozaice —
  ciemne wąskie pasma; odcinki 50–160 km poszerzone w rowy 7–11 km, świeży lód jasny i chłodny, dno w cieniu, gruz),
  platformy przy przodkach, hub z lądowiskiem, w bazie Unii kopuły. Nocą zieleń / cyjan Unii (inna paleta niż sód).
- **Ganimedes, Kallisto — węzły Konsorcjum**: depot (farma zbiorników, magazyny, lądowisko; Ganimedes — Uruk
  Sulcus, Kallisto — Valhalla) + 2 pola lądowisk, jeden trakt. Nocą sód i fiolet znaków.
- Noc: kolano luminancji (sufit ~0,65 liniowo) — nakładające się światła nie zlewają się w białą plamę (emisja
  liczy L² → bloom). Lekcje jak przy Ziemi: cienkie obrócone pasy 1 teksela aliasują w „drabinki” (doki szersze,
  miękkie krawędzie), równe pierścienie świateł wyglądają na doklejone (łuki), światła nie wzdłuż całej drogi.

**Materiał** (`src/3d/moonSurface.tsl.js`, DirectMoon w `planet3d.assets.js`): MeshStandardNodeMaterial z mapą
dnia, normalnych (R = wschód, G = północ) i nocy w `emissiveMap`; graf emisji raz na wariant (z maską słońca / bez),
wartości per obiekt (`material.uniforms.uSunDir`). SŁOŃCE W PŁASZCZYŹNIE GRY jak na planetach (ustalenie z naprawy
cieni planet): hak modelu oświetlenia podmienia w `direct()` słońcu gry kierunek na Słońce − środek księżyca (z = 0;
w soczewce warpa obrócone z bryłą jak poświata) i mnoży światła bezpośrednie przez maskę słońca; otoczenie i
pozostałe światła sceny × `moonLightTune.other` (0,12) — noc czarna jak planet, ciemna połowa przechodzi w smugę
cienia. Światła nocne = wzór miast planet (próg, poświata L²), zapalane z zapadaniem zmroku z tego samego kierunku
słońca i w cieniu planety (maska). Test `tests/moonSurface.test.mjs`. Zrzuty: `node scripts/webgpu/planety-mapy-gra.mjs
--tylko luna-cala,luna-noc-blisko,luna-stocznia,io-cale,io-noc-blisko,europa-ciecia,europa-noc-blisko,…` (widoki
`moon:` — słońce w poziomie po stronie dalej od planety macierzystej, `km` — kadr wokół celu, `eclipse` — za planetą).

## Demo (2026-10-09)

`dema/planety-webgpu.html` (`npm run dev` → /dema/planety-webgpu.html): wypieczone mapy wszystkich ciał na materiałach
GRY, bez kopii shaderów — powierzchnia, chmury i poświata z `planet3d.assets.tsl.js`, dziura jako bryła (`earthPit3D.js`),
żywy Jowisz (`jupiterAtmosphere.js`, suwak tempa), księżyce (`moonSurface.tsl.js`); post jak w grze (bloom gry → ACES →
sRGB). Własny `WebGPURenderer` (jak `niebo-webgpu`), kula o promieniu 1 z biegunem N na +Y, słońce względem kamery
(„pora dnia”: 0 — pełnia, ±90° — terminator, 180° — noc). Widok MAPA — warstwy wypieku płasko (dzień, noc ze
wzmocnieniem, noc na dniu, woda / połysk, normalne, chmury; kursor podaje szerokość i długość), NOWE / STARE — A/B
z dawnymi mapami (tabela dawnych ścieżek w demie, jak `?planety=stare`), MIEJSCA — skok do miejsc z generatora
(księżyce: współrzędne z `<ciało>-miejsca.json` podglądu `ksiezyce.py` — po zmianie ziarna / miejsc przepisać listę
w demie). Parametry: `?cialo=`, `?widok=mapa`, `?mapy=stare`, `?warstwa=`, `?miejsce=N`, `?pora=`, `?odl=`, `?test=1`;
konsola `window.__planety`.

## Otwarte

- Księżyce: światła nocne przy całej tarczy (zoom < ~0,05) giną w mipmapach (pojedyncze teksele uśrednione);
  widoczne od średniego zbliżenia. Z bardzo bliska (zoom > 1) mapa 2048 galileuszowych ma teksel ~10 px.
  Szwy łat mozaik Voyager/Galileo (Europa, Ganimedes) zostają widoczne jako proste krawędzie kontrastu.
- Jowisz: obrys GRS na mapie to nieidealna elipsa — jądro obraca się wewnątrz stałego owalu, kołnierz tylko płynie;
  pełny obrót całej plamy wymagałby mapy tła bez GRS (inpainting). Festony i owale spoza listy jadą z pasem.
- Z bliska (domyślny zoom przy ringu) teksel mapy 8K ma ~6 px — poza dziurą Ziemia nie ma detalu z shadera
  (tło menu ma szum `dn`). AGENT: detal powierzchni planety z bliska (szum wg klasy powierzchni).
- Dema (`dema/halo_ring_demo_env.js`, `dema/warp-webgpu/planets.js`) czytają stare mapy.
- Merkury / Wenus: kotwice wyciągów orbitalnych to tylko ślad na mapie — sam wyciąg (lina na orbitę) w 3D nie
  istnieje. Strona nocna wychodzi tylko przy położeniu słońca, w którym planeta ma noc w kadrze (planety tła).
- Strona nocna dziury zależy od położenia Ziemi względem Słońca (doba obraca kulę wokół osi pionowej ekranu,
  dziura leży na 20,5° N).
