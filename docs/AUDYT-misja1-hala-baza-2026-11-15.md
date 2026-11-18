# Wydajność misji 1: hala K-7, wylot, baza piratów (2026-11-15)

Zgłoszenie użytkownika (PerfHUD, 5120 × 1440, preset Ultra, render 125 %, bez limitu klatek, tryb worker):

1. start gry w hali K-7 — ~120 kl/s i duża kolejka GPU (59 ms),
2. po wylocie z hali gra laguje „jakby coś wczytywała”, po chwili drugi freeze,
3. po wylocie z hali skok kl/s,
4. przy bazie piratów 50–120 kl/s, „było 200”; doszły zasięgi radaru i „silnik fizyki 3D”.

Narzędzie: `node scripts/webgpu/misja1-trasa-gra.mjs [--etap hala|baza|oba] [--ab 1] [--profil 1]` — kampania jak
u gracza (samouczek, intro, ODDOKOWANIE, W przez bramę G-01), sonda GPU workera (`sondaGpuWorkera.mjs`), dziennik
klatek strony (rAF) i workera (przerwy między renderami z pipeline'ami, nowymi zasobami i wysyłkami tej klatki),
profile CPU strony i workera przez wylot, A/B w pauzie (każdy korzeń sceny workera i każdy krok `Core3D.fx` po kolei).
Warunki: headless w takcie monitora (240 Hz), `grafika=ultra`, 5120 × 1440, render w workerze. Na tej samej karcie
aplikacja ChatGPT (Codex) stale brała ~20–26 % silnika 3D (liczniki `\GPU Engine(*engtype_3D)`), u gracza też.
Przebiegi: `.tmp/misja1-trasa/run2` (przed poprawką, pełny), `run3-po` (hala i wylot po poprawce), `run4-baza-po`.

## 1. Hala K-7 — karta ~7,4 ms na klatkę

Okno `dok` (Atlas w stanowisku C-01): obraz 115 /s, karta 99 %, GPU render 7,47 ms + compute 0,57 ms, kolejka GPU
śr. 76 ms (gracz: 59 ms). Passy: gry (ortho) 3,0, tła 2,7, maska słońca 1,1–1,5, post 0,17, FG 0,12; compute: bloom
0,45, symulacja pyłu hali 0,12.

A/B w pauzie (Δ GPU render przy zdjęciu rzeczy; okna bazowe 7,35–7,56 ms, szum ±0,3 ms):

| rzecz | Δ render | gdzie |
|---|---|---|
| warstwy pyłu hali (`HallDust`: `HallDustBack` + `HallDustFront`) | −2,35 ms | pass gry 3,0 → 0,46 ms |
| ring Ziemi z halą K-7 (`HaloRing`) | −2,24 ms | pass tła 2,86 → 0,40 ms |
| kadłub Atlasa (`hullSkinBatch`, z lampami pokładowymi) | −0,22 ms | |
| niebo i gwiazdy (trzy korzenie) | −0,55 ms | |
| obudowa reaktora, cień i okna mostka | −0,44 ms | |

Pył hali: dwie płaskie siatki na całą domenę hali (`gasFieldLayer.js`) — każdy piksel hali przechodzi listę świateł
komórki siatki świateł (`grid.loop`) CZTERY razy: raz w warstwie przedniej, trzy w tylnej (światło + dwie wysokości
mgiełki snopów). Hala wrzuca do siatki 8 lamp (zasięg 2,5–2,7 km), 8 reflektorów (3,6–4,6 km) i do 193 migających
soczewek — każda komórka hali ma co najmniej kilkanaście świateł. Przy Ultra to ~11,5 Mpx (6400 × 1800). Dawny pomiar
warstw (~0,04 ms, reguła `pyl-hal-k7`) był przy 1600 × 900 i przed reflektorami podejścia.

„Duża kolejka” to zaległość karty zajętej w 99 % (wiek obrazu pacera + kompozytor × czas klatki GPU), nie osobny błąd
(jak `AUDYT-wydajnosc-baza-gpu-2026-10-28.md` § 9.1). Po wylocie z hali karta liczy 2,9–3,9 ms — stąd „boost”.

Pamięć karty (nvidia-smi, cała karta): w hali ~10,8–11,0 GB przy ~2–3 GB innych programów (po poprawce z § 3 — 11,8 GB:
woksele gotowe wcześniej). Pierwszy przebieg BEZ taktu (headless bez limitu klatek) brał ~10,6 GB samej przeglądarki i
kolejkę ~0,8 s — sztuczna zaległość; dlatego narzędzie domyślnie idzie w takcie (`--takt 1`).

## 2. Wylot z hali — dwa przestoje obrazu (przed poprawką)

Misja tworzy bazę piratów w chwili wylotu (faza `course`, `StoryGame._spawnSite`: budowle, teren skały, 48 okrętów —
9 fregat PD, 17 niszczycieli, 9 fregat laserowych, 10 pancerników, 3 supercapitale). Na stronie to 12,6 ms
(`spawnPirateBase` 7,4 ms, 48 × `spawnShip` łącznie 3 ms); kadłuby na belkach powstają leniwie z budżetem 6 ms na
klatkę, ale pierwsza budowa każdego typu czyta sprite (`getImageData` ~50–60 ms łącznie) i strona wysyła nowe obrazy
do workera (`createImageBitmap` ~45 ms) — kilka klatek po 40–50 ms.

Worker (render.worker.js) dostawał wtedy zdarzenia `attach` i `bodies`:

- **przerwa 623 ms** zaraz po wylocie: `attachWorldBodies` → `prebuildPirateBaseBodies` — kratownice 52 kawałków bazy
  (`pirateBaseSolidOf` 369 ms: wokselizacja brył wieży i dysku, `buildBeamStructure`; rastry płaskich kawałków
  `structureFor` 151 ms) jednym zadaniem; strona liczy te same kratownice na ekranie ładowania, worker nie;
- **przerwy 325 + 203 ms ~5 s później**: budowa wokseli przy attach (`wGrze.zbuduj`) — 468 MB nowych buforów i tekstur,
  27 pipeline'ów compute utworzonych synchronicznie w JEDNYM zadaniu (`for … await renderer.computeAsync(k)` — po init
  kończy się mikrozadaniem, więc pętla nie oddaje wątku), 29 modułów shaderów; worker potem stoi bezczynnie, a strona
  czeka na kompozytor — proces GPU kompiluje shadery.

Profil workera przez wylot: ciągi pracy > 40 ms — 581, 201, 61, 50, 42 ms.

## 3. Poprawka (bez zmiany obrazu)

- Strona podaje workerowi w obu przygotowaniach sceny flagę `{ pirateBase: storyCampaign }` (`index.html`,
  `rwHost.prepare` — nowy szósty argument w `renderWorkerHost.js`).
- Worker w pierwszym przygotowaniu (pod kurtyną ładowania) robi `startPirateBasePrep`: moduły bazy, bryła
  (`pirateBasePrebuilt` — ta sama, którą weźmie attach), kratownice kawałków (pamięć po układzie bazy) i budowa
  wokseli w tle (`preparePirateBaseVoxels` → `wGrze.przygotuj()`); przygotowanie po klatce zero czeka na woksele
  najwyżej 6 s.
- `wGrze.start()` bierze tę samą obietnicę budowy; pierwszy start nie wczytuje węzłów drugi raz (`swieze`).
- Kernele rozgrzewki wokseli (`solver.rozgrzej`, `obraz.rozgrzejKernele`) po jednym na zadanie (`setTimeout` 0).

Wynik (`run3-po`, ta sama trasa):

| | przed | po |
|---|---|---|
| najdłuższa przerwa obrazu workera przy wylocie | 623 ms | 59 ms |
| przestój ~5 s po wylocie | 325 + 203 ms | brak (maks. 10 ms) |
| ciągi pracy workera > 40 ms przez wylot | 5 | 0 |
| start kampanii (klik → gra) | 23,3 s | 23,5 s |
| woksele | budowa po wylocie | gotowe pod kurtyną (7,9 s w tle, ~10 s przed grą) |
| GPU w hali (dok) | 7,47 + 0,57 ms | 7,36 + 0,57 ms |

Kratownice pod kurtyną: 0,5–0,9 s (worker przygotowuje wtedy też ringi). Skok `?story=shipyard`: woksele gotowe od
razu (dawniej 5,7 s po starcie fazy), koszt GPU bazy bez zmian. Pipeline'y synchroniczne 0, błędy 0. Testy:
`szewRenderu`, `pirateBase*`, `rozgrzewka*`, `shaderPrewarm`, `woksele*Wgsl`, `wokseleLiny`, `wokseleBaza`,
`worldBodies3D` — zielone.

Zostaje na stronie: pierwsze kadłuby piratów przy wylocie (kilka klatek po ~45 ms: `getImageData` sprite'ów i wysyłka
obrazów do workera) — kandydat: w kampanii przygotować struktury kadłubów i bitmapy pięciu typów okrętów bazy pod
kurtyną.

## 4. Baza piratów — karta ~4,7 ms na klatkę (bez walki)

Skok `?story=shipyard`, Atlas 3,5 km od habitatu, mgła wojny wyłączona, kamera statku. Zoom 0,04 (jak u gracza):
obraz 172 /s, GPU 4,67 + 0,42 ms (tło 2,0, maska słońca 1,45, FG 0,81, post 0,19); zoom 0,14: 144 /s, GPU 5,75 +
0,56 ms (tło 2,35, maska słońca 2,05, FG 0,86).

A/B w pauzie przy zoomie 0,04 (okna bazowe 4,56–4,67 ms):

| rzecz | Δ render |
|---|---|
| woksele bazy — cały korzeń `Woksele bazy` | −2,96 ms (tło 1,9 → 0,5, FG 0,8 → 0, maska słońca −0,4) |
| woksele — same siatki `Wok*` | −1,51 ms (tło 1,9 → 0,78, FG → 0) |
| planetoida (`PirateRock`) | −0,26 ms |
| czujniki: krok `fx:czujniki` / tafla granicy | −0,18 / −0,12 ms |
| czujniki wył. (strona, `Czujka.input.off`) | +0,04 ms (szum) |

Woksele (124 tys. węzłów, dwa rysunki — tło i FG — każdy przez WSZYSTKIE instancje, węzeł z drugiej strony przekroju
zwija się w wierzchołku) kosztują 1,5–3 ms, prawie niezależnie od zoomu (0,04 ↔ 0,14: tło i FG ±0,3 ms, choć baza na
ekranie jest dużo większa) — koszt idzie z wierzchołków i instancji, nie z pikseli. Zasięgi radaru (czujniki) — ~0,1–0,2
ms, nie one obniżyły kl/s. Maska słońca 1,1–2,1 ms przy Ultra w każdym miejscu (pełna rozdzielczość, marsz SDF kadłubów).
U gracza w walce (39 NPC, wraki, tarcze, efekty) dochodzi reszta sceny — GPU 7,8 + 2,3 ms na zrzucie zgłoszenia.

## 5. Co zostaje (decyzje użytkownika)

1. Render 125 % (Ultra = nadpróbkowanie) — 1,56 × pikseli względem 100 %; największa pojedyncza dźwignia (pył, ring,
   maska słońca, bloom skalują się z pikselami).
2. Pył hali: trzy pętle świateł warstwy tylnej w jednej — ZROBIONE (§ 6); ze zmianą obrazu zostaje: warstwy w połowie
   rozdzielczości.
3. Maska słońca w połowie rozdzielczości (miększe brzegi cieni).
4. Woksele: gruz od pierwszego zdarzenia, listy węzłów na pass i lista głębi celu AO — ZROBIONE (§ 6, § 7); zostaje
   LOD przy dalekim zoomie.
5. Kadłuby piratów przy wylocie — przygotowanie pod kurtyną (§ 3).
6. Aplikacja ChatGPT zabiera ~25 % silnika 3D karty — gra jest ograniczona przez kartę.

## 6. Optymalizacje bez zmiany obrazu (wieczór 2026-11-15)

Przebiegi `.tmp/misja1-trasa/ab-oba` i `ab-oba2`: ta sama trasa i ustawienia co w § 1–4, ale karta bez obcych
obciążeń (liczniki silnika 3D: żaden proces poza przeglądarką narzędzia; aplikacja ChatGPT nie brała karty). Dlatego
liczby bezwzględne są niższe niż w § 1–4 (hala: GPU 4,44 + 0,41 ms zamiast 7,47 + 0,57; baza 2,26 + 0,35 ms zamiast
4,67 + 0,42) — porównuj tylko A/B z tego samego przebiegu. Przebieg z harnessem innej sesji w tle (compute pyłu w oknie
`dok` 32 ms, A/B rozjechane) odrzucony. A/B: okna 1,5 s w pauzie na zmianę z oknami bazowymi, każdy wariant 3–4 razy;
okna bazowe różniły się o ±0,01–0,05 ms. Narzędzie: `misja1-trasa-gra.mjs --abHala / --abBaza <plik wariantów>
--abPowt N`, `--abPoTrafieniu 1` (te same warianty po trafieniu), `--zrzutyHala / --zrzutyBaza <plik>` (zrzuty wyglądu).

**Pył hali — jedna pętla świateł** (`grid.loopHeights`, `lightGrid.js`; warstwa tylna: światło warstwy i dwie wysokości
mgiełki snopów z JEDNEGO przejścia listy świateł komórki — dawniej trzy przejścia; tłumienie, stożek i cień liczone
osobno na wysokość, więc wynik ten sam z dokładnością do kolejności sumowania). Hala K-7, dok C-01, okna bazowe
4,332–4,345 ms:

| wariant (`HallDust.layer.setHazeLoops`) | Δ GPU render (4 powtórzenia) |
|---|---|
| `'osobne'` — dawne trzy pętle | +0,347 / +0,369 / +0,384 / +0,397 ms |
| `'brak'` — bez mgiełki snopów (inny obraz) | −0,196 / −0,207 / −0,210 / −0,220 ms |

Mgiełka snopów kosztuje teraz ~0,21 ms zamiast ~0,58 ms: **−0,37 ms GPU na klatkę w hali** (~8 % klatki karty).

**Woksele — gruz od pierwszego zdarzenia** (`wGrze.js`: siatki gruzu tła i FG po `CAP_G` = 40 000 instancji
rysowały się w spoczynku, choć pula jest pusta do pierwszego kroku solvera — shader zwijał wszystkie). Baza, zoom 0,04,
okna bazowe 2,162–2,167 ms: gruz rysowany także w spoczynku (dawniej) +0,243 / +0,245 / +0,247 / +0,244 ms —
**−0,25 ms w spoczynku**. Woksele w spoczynku kosztują teraz 0,75 ms (zdjęte wszystkie siatki `Wok*`).

**Po pierwszym trafieniu** (`--trafienie 1`: `voxHit` w habitat — pełny obraz, 2 sloty na węzeł, 247 094 instancji
w każdym passie, solver co klatkę): GPU 4,19–4,43 + 0,73–0,97 ms (spoczynek 2,26 + 0,35): pass tła 1,6 ms (0,94),
FG 0,88 (0,39), cele głębi i AO 0,79 ms, solver 0,37–0,44 ms compute.

**Ile kosztują węzły zwinięte w drugim passie** (`ab-oba2`; przekrój `uCiecieZ` przestawiony tak, żeby jeden pass
rysował wszystko, a drugi zwijał wszystko, i ta sama siatka zdjęta — różnica = koszt passa samych zwiniętych instancji):

| stan | wariant | Δ GPU (3 powtórzenia) | koszt zwiniętego passa |
|---|---|---|---|
| spoczynek (123 547 instancji) | C: przekrój −1e9 (tło zwija wszystko) | −0,272 / −0,276 / −0,286 | |
| | D: C + siatka tła zdjęta | −0,628 / −0,648 / −0,658 | **~0,37 ms** |
| | A: przekrój +1e9 (FG zwija wszystko) | +0,317 / +0,428 / +0,493 | |
| | B: A + siatka FG zdjęta | −0,065 / −0,299 / −0,641 | ~0,4–1,1 ms (rozrzut) |
| po trafieniu (247 094) | C | −0,074 / −0,252 / −0,266 | |
| | D | −1,007 / −1,025 / −1,041 | **~0,75–0,95 ms** |
| | A | +0,039 / +0,296 / +0,487 | |
| | B | −0,524 / −0,613 / −0,699 | ~0,6–1,2 ms |

W zwykłym przekroju tło zwija węzły nad płaszczyzną gry, a FG — pod nią; razem to tyle instancji, ile ma jeden pass,
więc **osobne listy węzłów dla passa tła i FG** zdjęłyby ~0,4 ms w spoczynku i ~0,8 ms w walce. Zwinięta instancja
robi w wierzchołku tylko dekodowanie id, jeden odczyt pozycji i porównanie (`naPassie` w `obraz.js`), ale razy 24
wierzchołki i 124–247 tys. instancji. Lista musi nadążać za ruchem węzłów po pierwszym zdarzeniu (węzły spadają przez
przekrój): kompakcja na GPU co klatkę i rysunek pośredni z licznikiem instancji z GPU, indeks z listy w wierzchołku
(szósty bufor storage etapu wierzchołków, limit 8). Sama lista statyczna (do pierwszego zdarzenia) dałaby tylko te
~0,4 ms w spoczynku.

**Wygląd** (zrzuty strony w pauzie, 5120 × 1440). Hala ma dużo pikseli zmiennych w czasie (soczewki, stroboskopy
podejścia, światła ramion), więc porównanie „baza ↔ wariant” musi je odróżnić od zmiany. Pierwsza metoda (dwie pary,
maska pikseli stojących między zrzutami jednego wariantu) przepuszczała światła migające w fazie z odstępem par:
kontrola zerowa (wariant, który nic nie zmienia) dawała w hali 3 % pikseli do 26/255. Narzędzie porównuje więc
przedziały wartości piksela z czterech zrzutów każdego wariantu (różnica tylko tam, gdzie przedziały się rozchodzą).
Baza: gruz w spoczynku — 0,004–0,013 % pikseli > 2/255 na stojących pikselach, tyle co kontrola zerowa (0,009–0,014 %;
różnice leżą na poruszającej się linii nakładki czujników), czyli bez zmiany. Hala, metoda przedziałów
(`.tmp/misja1-trasa/zab-hala3`, piksele zmienne w czasie: 50–60 % kadru): kontrola zerowa — 0 pikseli; trzy pętle ↔
jedna — 0 pikseli > 2/255, maks 1/255 (kolejność sumowania); kontrola „bez mgiełki” — 52,7 % kadru, maks 85.

## 7. Woksele: listy węzłów na pass (prośba użytkownika „zrób listy”, 2026-11-15)

Bryły bazy rysowały się dwa razy (pass tła i FG) przez WSZYSTKIE instancje: 123 547 w spoczynku, 247 094 po pierwszym
zdarzeniu (dwa sloty na węzeł), a wierzchołek zwijał to, co nie leży po stronie passa, węzły wewnątrz bryły (komplet
sąsiadów) i puste sloty kawałków. Teraz krok `woksele` na końcu klatki robi kompakcję na GPU (`obraz.js`: `kListyLicz`
— flagi instancji i suma na grupę 256, `kListySkan` — prefiks grup w jednej grupie i liczby instancji do argumentów,
`kListyZapis` — id na miejsce z prefiksu), a pass rysuje pośrednio tylko swoją listę (`geoTlo` / `geo.setIndirect`,
`drawIndexedIndirect`). Warunek flagi = warunek rysunku z `budujPozycje` (`flagaInstancji`). Bez atomików: listy idą
w kolejności id, więc remisy głębi rozstrzygają się jak przy pełnym rysunku. W spoczynku lista liczy się tylko po
zmianie (wczytanie, LOD, przekrój), w stanie aktywnym co klatkę. Wierzchołek: 6 buforów storage (limit 8). Demo bez
zmian. A/B `obraz.listyPelne(true)` — listy ze wszystkich id (dawny rysunek).

Przebieg `.tmp/misja1-trasa/listy` (baza, zoom 0,04, karta bez obcych obciążeń):

| stan | rysowane instancje tło + FG | dawny rysunek względem list (4 powtórzenia) |
|---|---|---|
| spoczynek | 79 312 + 29 528 (było 2 × 123 547) | +0,411 / +0,347 / +0,346 / +0,350 ms |
| po trafieniu | 80 055 + 29 528 (było 2 × 247 094) | +1,284 / +1,288 / +1,289 / +1,285 ms |

**Listy: −0,35 ms w spoczynku, −1,29 ms po pierwszym trafieniu (w walce).** Woksele w spoczynku kosztują teraz
~0,4 ms (zdjęte siatki `Wok*`), GPU bazy po trafieniu 3,0–3,2 + 0,65–0,92 ms. Wygląd (metoda przedziałów, cztery zrzuty
na wariant): listy ↔ dawny rysunek — 0 pikseli > 2/255 w spoczynku (maks 1) i po trafieniu (maks 2), kontrola zerowa
0 i 4 piksele. Pipeline'y synchroniczne 0.

**Trzecia lista — głębia celu AO** (prośba użytkownika „dorób”): głębia (`rysujCele`, cel AO po pierwszym trafieniu)
rysowała wszystkie 247 094 instancje bez przekroju. Kompakcja liczy teraz trzy listy naraz (pola po 10 bitów: tło,
FG, suma), głębia rysuje pośrednio listę sumy (`geoGleb`, rekord od 40 B, `budujPozycje({ lista: 'suma' })`), a krok
`woksele` liczy listy raz na klatkę PRZED `rysujCele` (inaczej głębia brałaby listę z poprzedniej klatki). Przebieg
`.tmp/misja1-trasa/listy3` (Chrome użytkownika brał ~7–22 % karty — liczby bezwzględne z zapasem, A/B na przemian):
po trafieniu dawny rysunek względem list **+1,588 / +1,588 / +1,590 / +1,590 ms** (przy dwóch listach +1,29), wiersz
`fx:woksele` render ~0,39 ms (było ~0,80); GPU bazy po trafieniu 2,67–2,69 + 0,61–0,66 ms. Zrzuty (spoczynek i po
trafieniu): 0 pikseli > 2/255, maks 1 — jak kontrola zerowa. Pipeline'y synchroniczne 0.

Razem w tym audycie (§ 3, § 6, § 7), bez zmiany obrazu: w hali −0,37 ms (pył), w bazie w spoczynku −0,6 ms (gruz
i listy), w bazie po pierwszym trafieniu ~−1,6 ms (listy) — wszystko na klatkę GPU przy Ultra 5120 × 1440.
