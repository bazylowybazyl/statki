# BRIEF — demo nowego ringu planetarnego „Halo” wokół Ziemi

> Dla agenta pracującego w tym repo (Claude Code / Codex). Decyzje ustalone z użytkownikiem 2026-09-23.
> Przeczytaj całość przed pierwszą linijką kodu. Obrazy referencyjne użytkownik dołącza do wiadomości
> (numeracja jak w §3); opisy w §3 są na wypadek, gdyby ich zabrakło.
>
> **Zmiana po M2 (2026-09-23, decyzja użytkownika): habitat jest obrócony w stronę kosmosu**
> (`habitatFacing: 'outward'`, domyślnie). Tam, gdzie brief mówi „wnętrze zwrócone do planety”,
> „łuk w niebo” albo „planetshine na habitacie”, obowiązuje §1 poniżej. Wariant Halo zostaje w demie
> do porównania (`?facing=in`, panel „Habitat”).

## 0. W skrócie

Zbuduj demo megastruktury w stylu Halo wokół Ziemi: wstęga z habitatem po wewnętrznej stronie
(zwróconym do planety), ściany brzegowe trzymające atmosferę, kadłub-megastruktura na zewnątrz.
Habitat dzieli się na sektory czterech rodzajów: krajobraz jak Halo, miasto-ogród, megastruktura
przemysłowa, szklane habitaty. Demo ma dwie kamery: kinową (ujęcia jak z referencji) i wierną
replikę kamery gry. Ring powstaje od razu w skali i osiach gry jako moduły w `src/3d/haloRing/`,
żeby później zastąpić obecny `planetaryRing3D` bez przepisywania.

Poprzeczka: grafika na poziomie referencji. Nie kolejne demo z pudełek.

## 1. Decyzje użytkownika — nie zmieniaj bez pytania

| Kwestia | Decyzja |
|---|---|
| Cel | pokaz + przygotowanie do portu (skala i osie gry, dwie kamery) |
| Kształt | ~~klasyczne Halo: habitat na wewnętrznej ścianie wstęgi, zwrócony do planety~~ → od 2026-09-23 (po M2): habitat na zewnętrznej stronie wstęgi, zwrócony w kosmos. Kamera gry (poza ringiem) widzi wtedy podłogę i dolną ścianę habitatu; łuk w niebo znika, dzień i noc habitatu idą za dniem i nocą planety pod nim |
| Doki i budowle | „przypinane” podstawy: dok (jak w demie ECUMENE wpięty w podłogę) łączy się z habitatem; chwytaki / tunele / łączniki habitat ↔ budynki gameplayowe. Zakres od M3. Poprawka 2026-09-23: dok wpięty w podłogę **na środku szerokości wstęgi** (kołnierz na podłodze + klin nośny pod pokładem), nie na dachu z mostem i zastrzałami |
| Port (2026-09-23) | sektor portowy zostaje pod kątem stacji Ziemi. Docelowo stacje orbitalne znikną z orbit planet (przeniesione w deep space), a **ring z portem zastąpi stację** — port ma więc pełnić rolę stacji: doki dla okrętów liniowych (Atlas 1800 × 806 j.), czytelne z kamery gry |
| Dolna ściana od środka | najwięcej widać jej z kamery gry → dostaje wystrój w M3 (konstrukcja, poziomy, okna, światła, wyloty tuneli), szklane tarasy z ogrodami w M4 |
| Kierunek wizualny | zaakceptowany po zrzutach obrotu (2026-09-23) — M3 rusza |
| Dok gameplayowy | **K-7 z dema ECUMENE** (`orbital_ring_gameplay_hub_v3.html`) — wygląd i rozgrywka zostają: suwnice, węże od rufy, sekwencje dokowania. Od 2026-09-23 **4 stanowiska capital** (28 stanowisk; hala szersza o dwa) |
| Port Ziemi (2026-09-23) | K-7 zastępuje dok „teoretyczny” ruchu v2: **4 kompleksy co 90°** (jak 4 doki stacji z ringiem w ruchu v2) — w każdym **3 doki: K-7 pośrodku i po jednej otwartej zatoce z każdej strony** (2026-09-24; zatoki ze stanowiskami w standardzie K-7: 2 pasy MEGA + 4 L, 4 M, 4 S). 224 stanowiska; symulacja ruchu v2 przy gospodarce ×60: kolejka na redzie 0 (teoretyczny port: 260). Planety bez ringu i zatłoczone (Merkury) — w przyszłości megadok zamiast ringu |
| Kadłuby gracza (2026-09-23) | gracz lata frachtowcami i innymi statkami jak NPC — dokuje na każdym stanowisku, na którym kadłub się mieści (hala K-7 i otwarte zatoki); demo: klawisz V, `?hull=` |
| Ruch statków (2026-09-24) | **ring nie udaje życia**: bez ruchu zastępczego (frachtowce wokół ringu, okręty liniowe w zatokach), bez zaparkowanych statków NPC i bez nocnych świateł aut na ulicach miast — statki i ruch wdrażane osobno (system ruchu v2 przez adapter `haloPortTraffic.js`). Pociągi maglevu na dachu zostają |
| Landmarki (2026-09-24) | ring dopracowujemy rzeczami „pożyczonymi” z innych dem (ECUMENE `orbital_ring_gameplay_hub_v3.html`, `orbital_ring_demo_2.html`). Pierwsze: **megabudowle ECUMENE** (9: brama, tarasy, iglica, most) jako punkty orientacyjne sektorów miast — w dolnej połowie wstęgi (w kamerze gry front ku kamerze, nie przecinają płaszczyzny lotu), na placu w podłodze |
| Strefy wokół doków (2026-09-23) | dok wbity w ziemię generuje wokół siebie **pas fabryczny**, który przechodzi w **domy**, a dopiero dalej w to, co ma sektor (nie park tuż przy doku). Przemysł **tylko wokół doków** — bez sektorów przemysłowych. **Góry sektora przy brzegach wstęgi (u góry i u dołu) mogą stać obok doków — nie muszą**; nad dokiem teren niski (w kamerze gry zasłoniłby dok) |
| Tranzyty przez ring (2026-09-23) | jak w K-7 z ECUMENE: **4 tunele co 90°** (±45° i ±135° od K-7) przez płytę podłogi z kadłubem — ring w płaszczyźnie gry jest przeszkodą, a tędy się przez niego przelatuje |
| Płaszczyzna gry i doki (2026-09-23, poprawka) | **doki NA ŚRODKU wstęgi, wpięte w podłogę habitatu** — nie na dachu i bez wsporników-balkonów. Płaszczyzna gry przecina ring w połowie szerokości (`flightLevel: 0.5`): gameplay „na środku ringu”, górna połowa wstęgi nad statkami (FG), dolna pod nimi |
| Dzielnica przemysłowa | nie „same kwadraty”: zestaw 7 rodzajów zakładów (hala szedowa, zbiorniki, silosy, kotłownia z kominem, chłodnia, rafineria, kontenery) |
| LOD budynków | budynki nie mogą znikać granicą w kadrze — kawałki z kadru i horyzontu, płynne znikanie |
| Zawartość | wszystkie cztery typy, jako sektory o różnym charakterze |

Przyjęte domyślnie, bez sprzeciwu użytkownika: Ziemia z teksturami z gry; ring częściowo w cieniu
planety (dzień / zaćmienie / noc ze światłami miast); ruch statków i porty; wszystko proceduralne,
bez nowych assetów zewnętrznych; panel jakości i licznik FPS.

Użytkownik wie, że klasyczne Halo jest zwrócone do kamery gry krawędzią (§5). Nie zamieniaj go
po cichu na płaski pokład — zadanie polega na tym, żeby wyglądał dobrze w obu kamerach.

## 2. Co już jest — i czego nie powtarzać

Ring w grze (`src/3d/planetaryRing3D.js` + `src/3d/ringCity*.js`, ~10 tys. linii, Ziemia i Mars):
- obręcz z miastem po stronie planety → kamera gry widzi miasto krawędzią; zewnętrzny pokład pusty
  (18 j. grubości);
- LOD twardymi cięciami; na „medium” przy zoomie < 0,233 miasto to płaskie nieoświetlone pudełka;
- siedzi w passie FG (layer 2), który rysuje się po świecie ortho → przykrywa statki;
- neon SynthCity w pastelowej tęczy, wieczna noc, zero zieleni i wody.

Dema w `dema/`:
- `orbital_ring_demo.html` (ECUMENE) — najładniejsze: zieleń, jeziora, biokopuły, presety kamer 1–8,
  wycieczka `C`, panel jakości. Bez planety; budynki to pudełka z oknami z shadera, drzewa to ikosaedry.
- `orbital_ring_gameplay_hub_v3.html` (K-7) — **nowszy generator ECUMENE** (≈ :224–1002): tekstura
  danych fasad (:224–277), 3 gatunki drzew (:279–337), plan miasta v2 (:368–505), megabudowle
  (:507–580), mapy sektorów do 4096 px (:640–712). ⚠️ Linia 209 to 2,6 MB base64 — nie czytaj jej.
- `hangar-ring.html` — idea doku we wcięciu pierścienia.

Żadne demo nie ma: realistycznej planety pod ringiem, nieba, atmosfery habitatu, zaćmienia, LOD
w skali planety, ujęcia ring + planeta.

## 3. Referencje — co brać z każdej

1. **Dwa pierścienie Halo nocą** — wnętrze wstęgi (ląd, jeziora, chmury) widziane pod kątem przez
   błękitną mgłę; kadłub prawie czarny z drobnymi niebieskimi światłami; błękitna poświata wzdłuż
   krawędzi; daleki pomarańczowy flar słońca. → ciemny kadłub, drobne światła, habitat czytany przez
   mgłę, poświata krawędzi.
2. **Halo z górskiego szczytu** — wstęga wstaje z horyzontu w niebo i zwęża się; chmury i morza na
   niej; tam, gdzie kończy się habitat, odsłonięta konstrukcja z niebieskimi liniami; olbrzymia planeta
   na niebie. → ujęcie z podłogi habitatu, perspektywa powietrzna.
3. **Paul Chadeisson** — gęsty szarobiały greeble megastruktury widziany z góry, pod spodem chmury
   planety. → gęstość dachu i kadłuba. **To najbliżej widoku z kamery gry.**
4. **Miasto-ring nad Ziemią nocą** — kratownice (szyny) górą i dołem, bloki z pomarańczowymi oknami,
   statki, poświata limbu Ziemi. → kratownice brzegowe, sodowy pomarańcz przemysłu.
5. **Ogrodowy ring** — tarasy z drzewami na górze, pod nimi kilka poziomów szklanych fasad ze
   światłem wnętrz, statki. → szklane habitaty wielopoziomowe.
6. **Krajobraz na ringu** — parki, jeziora, rzeki, mosty, wieże; powierzchnia zakrzywia się w dal;
   planeta z boku; statki. → miasto-ogród, krzywizna.

Referencje wygrywają skalą czytaną przez mgłę powietrzną, kontrastem ciemnego metalu i jasnego
habitatu, słońcem z połyskiem na wodzie i metalu oraz gęstością drobnych świateł — nie liczbą obiektów.

## 4. Geometria i skala (układ gry)

Płaszczyzna XY, +Z ku kamerze; świat 2D `(x, y)` → Three `(x, −y, z)`. Oś ringu = Z. Jednostki gry
(Atlas = 1800 × 806 j.). „Góra” dla mieszkańców = do osi ringu, czyli ku planecie.

Przekrój to profil 2D `(r(s), z(s))` obracany wokół Z. Z tej jednej definicji biorą się podłoga,
ściany, kadłub, mapowanie UV i przyszłe kolizje — dzięki temu `floorTilt` (§5) nie wymaga przepisywania.

Wartości domyślne (wszystko w jednym `CONFIG`, suwaki w demie):

| Element | Domyślnie | Skąd / dlaczego |
|---|---|---|
| promień planety | 37 800 | `RING_PLANET_WORLD_RADII.earth` w `src/3d/ringScale.js` — importuj, nie przepisuj |
| obwiednia promieniowa (bez doków) | 41 202–43 752 | `computePlanetaryRingLayout(earth)`; strefy orbit, spawn (57 252), orbita stacji (46 020), CIC i testy `scaleTuning` liczą się z tych liczb — port nie musi ich ruszać |
| zewnętrzna powierzchnia kadłuba | 43 752 | |
| podłoga habitatu | ≈ 43 300 | kadłub ≈ 450 grubości |
| wewnętrzna krawędź ścian | ≈ 41 800 | ściany ≈ 1 500 wysokości; suwak 800–2 100 (więcej wychodzi poza obwiednię) |
| szerokość wstęgi W (wzdłuż Z) | 6 000 | suwak 3 000–12 000 |
| położenie w Z | ~~od z = −W do z = 0~~ → od 2026-09-23 środek podłogi na z = 0 (−2 950 … +3 050) | decyzja użytkownika: gameplay na środku ringu (§1); dawny układ: `flightLevel: 'roof'` |
| środek planety | ~~z = −W/2~~ → z = 0 (środek podłogi) | w kamerze kinowej ring jest równikowy; w grze planeta jest ortho, więc jej z nic nie zmienia na ekranie |

- Proporcja Halo z ref. 1–2 to W/R ≈ 0,06–0,08 (W ≈ 3 000). Domyślne 6 000 to kompromis na rzecz
  widoczności z kamery gry — pokaż oba warianty na zrzutach.
- Doki siedzą we wcięciach kadłuba i wystają na zewnątrz w płaszczyźnie gry; nie mogą wejść na orbitę
  stacji Ziemi (46 020, kąt jak w `index.html` ≈ :6513).
- Jeśli dla wyglądu trzeba wyjść poza obwiednię — zaproponuj liczby i wypisz skutki dla portu.
- Mars (30 000) ma po porcie dostać ten sam ring: wszystko parametryzuj promieniem planety.

## 5. Kamera gry — replika 1:1 i wnioski

Tryb „Kamera gry” odtwarza Core3D (`src/3d/core3d.js`: `syncCamera` ≈ :1058–1110, kolejność passów ≈ :828):
- ortho: `halfW = (viewW/2)/zoom`, kamera na z = 150 000, patrzy w −Z;
- persp: FOV 35° (pion), wysokość `(viewH/2)/tan(17,5°)/zoom` (1080 px → 1 713/zoom),
  `lookAt(x, y, 0)`, near 100, far 500 000 — na z = 0 pokrywa się z ortho;
- zoom 0,035–3,2, domyślnie 1,0; kamera nigdy się nie pochyla;
- kolejność: BG persp (layer 1) → planety → halo → Ziemia i Mars w ortho → świat ortho (layer 0,
  statki) → cienie → tarcze → FG persp (layer 2).

Wynikają z tego wymagania:
1. ~~Nic z ringu nad płaszczyzną gry.~~ Od 2026-09-23 (decyzja użytkownika, §1) górna połowa wstęgi
   leży nad płaszczyzną gry. Przy zoomie 3,2 kamera persp wisi ≈ 535 j. nad z = 0, więc: dach nad
   wąwozem habitatu chowa się w kamerze gry przy zoomie rozgrywki (wraca przy dalekim), cały dach
   znika, gdy kamera zejdzie tuż nad niego, K-7 ma wysokości nad płaszczyzną ściśnięte ×0,42.
2. **Ring renderuje się w BG (layer 1), pod statkami** — poza górną ścianą z dachem (FG, layer 2),
   która przy zoomie rozgrywki jest schowana, a przy dalekim ma wycięcia nad graczem — to nadal
   naprawia przykrywanie statków przez obecny ring.
3. **Z góry widać głównie dach** (zewnętrzna strona górnej ściany, normalna +Z). Ma wyglądać jak
   ref. 3: gęsta megastruktura, doki, szyny, światła. Zostaw w greeblu czytelne działki pod przyszłe
   budynki gracza (krok 3 planu ekonomii: „budynki na ścianie ringu”).
4. **Habitat widać z góry tylko przez perspektywę**, przez otwór wstęgi od strony planety. Kamera
   nad środkiem planety widzi pas podłogi ≈ `d·W/(h+W) − H_ściany` (d = promień podłogi, h = wysokość
   kamery). Przy zoomie 0,035: 43 300·6/54,9 − 1 500 ≈ 3 200 j. (~110 px na 1920 px), dookoła całej
   planety. Z bliska (zoom > 0,2) nad dachem habitatu praktycznie nie widać.
5. **Dolna ściana od środka (normalna +Z) patrzy prosto w kamerę gry** — z pozycji nad szczeliną
   między planetą a ringiem widać ją na wprost (~180 px przy zoomie 0,2). Umieść tam szklane tarasy (ref. 5).
6. Planeta rysuje się PO ringu (ortho): dysk 37 800 + halo atmosfery przykrywa wewnętrzny skraj
   habitatu przy dużym oddaleniu. Sprawdź to na zrzutach i dobierz W oraz wysokość ścian.
7. Jeśli widok z gry okaże się za ubogi, dźwignią jest `floorTilt` (profil podłogi jak lejek;
   0° = klasyczne Halo). Zmierz warianty i pokaż je użytkownikowi, zamiast decydować.

## 6. Światło

Fakty z gry (w kamerze gry odtwórz je wiernie):
- Planeta jest oświetlona słońcem **w płaszczyźnie XY** (`sunPosition.z` = z planety,
  `planet3d.assets.js` ≈ :672) → z góry terminator dzieli dysk na dzień i noc ze światłami miast.
- Obiekty 3D dostają `DirectionalLight` pod ≈ 49° (offset 2600 poziomo / 3000 w Z od celu kamery,
  `planet3d.assets.js` ≈ :817–835).

**Słońce w płaszczyźnie ringu nie oświetli habitatu wcale** — każdy promień z podłogi ku słońcu
trafia w przeciwległą stronę wstęgi albo w planetę. Habitat świeci tylko przy słońcu nad płaszczyzną. Dlatego:
- oświetlenie ringu bierze kierunek = azymut do prawdziwego Słońca + wysokość z parametru
  (domyślnie 49° jak w grze; suwak 10–70°);
- w kamerze kinowej jedno słońce dla wszystkiego (planeta + ring); presety mogą mieć własne;
- w kamerze gry planeta zostaje oświetlona w płaszczyźnie jak w grze, a ring z wysokością —
  sprawdź, czy dzień i noc na dachu zgadzają się z dniem i nocą planety obok.

Czego się spodziewać przy 49°: cień planety pada na habitat po stronie przeciwnej Słońcu w pasie
ok. ±40°; w pasach ok. 40–90° od punktu przeciwsłonecznego habitat jest w słońcu, a górna ściana
ocienia górną część podłogi; po stronie słonecznej habitat patrzy na dzienną stronę planety — to noc
rozjaśniona światłem planety, która zajmuje tam pół nieba.

Wymagane, bo w tej skali mapy cieni nie działają:
- **analityczna widoczność słońca**: promień do słońca testowany z planetą (sfera), podłogą (walec)
  i obiema ścianami (pierścienie w płaszczyznach z = 0 i z = −W) — cztery tanie testy w shaderze;
  cień planety z półcieniem i czerwonawym brzegiem jak przy zaćmieniu Księżyca;
- **światło planety** (planetshine) na habitacie i dachu zwróconych ku jej dziennej stronie;
- **światła miast** zapalają się z lokalnego oświetlenia (cień, zaćmienie, noc) — płynnie
  i z losowym opóźnieniem per budynek, nie jednym progiem;
- mapy cieni tylko lokalnie przy kamerze kinowej (budynki, drzewa), nigdy w trybie gry;
- cień ringu na planecie: w kamerze kinowej analitycznie; w grze jest dziś pas-hak w `EARTH_FRAGMENT`
  (`uRingShadow*`) — opisz w notatce do portu, jak go dostroić do nowej geometrii.

## 7. Zawartość

Mapa ringu (domyślnie, do strojenia): 16 sektorów po 22,5° (≈ 17 000 j. długości podłogi każdy).
Przejścia płynne — biomy mieszają się na ~⅓ sektora, morza i rzeki przechodzą przez granice.
Dziś (2026-09-24, `HALO_SECTOR_MIX`): krajobraz 7, miasto-ogród 5, szkło 4, przemysłowych 0 (§1).

- **Krajobraz jak Halo** — 5 sektorów: morza, pasma górskie rosnące ku osi (do ~60% wysokości ścian,
  śnieg na szczytach), lasy, pustynia, lodowiec; chmury z cieniem na ziemi.
- **Miasto-ogród** — 5 sektorów: tarasy schodzące do jezior, parki, wieże, mosty nad rzekami, arterie ze światłami.
- **Megastruktura przemysłowa** — ~~3 sektory habitatu (stocznie, huty, zakłady)~~ → od 2026-09-23
  przemysł tylko w pasie wokół doków (§1) + ZAWSZE: dach,
  kadłub, spód, kratownice wzdłuż krawędzi (ref. 4).
- **Szklane habitaty** — 3 sektory arkologii + na wewnętrznych stronach obu ścian, we wszystkich
  sektorach miejskich, wielopoziomowe szklane tarasy z ogrodami i światłem wnętrz (dolna ściana
  jest widoczna z kamery gry — §5).
- **Sektor portowy** pod kątem stacji Ziemi: duży dok we wcięciu kadłuba (idea z `hangar-ring.html`),
  w demie jako bryła wizualna.

Dach i kadłub: ciemny metal z liniami paneli, anizotropowy połysk, pasy świateł (chłodny błękit jak
ref. 1–2, sodowy pomarańcz w przemyśle jak ref. 4), migające światła pozycyjne, maglev na dachu,
radiatory, anteny, zbiorniki, doki z oświetlonymi zatokami.

~~Życie: statki na pasach do doków (instancje + świecące dysze), kilka dużych frachtowców, ruch
świateł na arteriach miast.~~ → od 2026-09-24 ring nie udaje życia (§1): statki i ruch wdrażane
osobno; pociągi maglevu na dachu zostają.

## 8. Technika (rekomendacje — wolno lepiej, byle §5, §9 i §10 trzymały)

- **Habitat = jedna ciągła powierzchnia z mapami**, nie tysiące obiektów z daleka. Na kafle (u wzdłuż,
  v w poprzek) generuj na GPU (render-to-texture) mapy wysokości, biomu, wody, zabudowy, świateł
  i dróg; trzymaj je w cache LRU. Daleko: jedna wstęga + mapa niskiej rozdzielczości; blisko: dociągane
  kafle z detalem.
- **Teren**: kafle z LOD bez skoków (CDLOD / morphing wierzchołków). Screen-door dither bez TAA daje
  szachownicę (lekcja z `src/3d/asteroidBeltBackdrop3D.js`) — przenikanie rób morphingiem albo fade'em alfy.
- **Woda**: Fresnel, analityczne odbicie nieba i planety, odblask słońca (może przekraczać próg
  bloomu), głębia, piana przy brzegu.
- **Chmury**: animowana warstwa 400–900 j. nad podłogą, cień na ziemi liczony z tej samej mapy;
  w Ultra cienki wolumetryczny slab.
- **Atmosfera habitatu**: perspektywa powietrzna w każdym shaderze habitatu (Rayleigh/Mie wzdłuż
  odcinka promienia w warstwie powietrza między podłogą a krawędziami ścian); z zewnątrz błękitna
  poświata wzdłuż krawędzi (ref. 1–2).
- **Miasto**: instancje / `BatchedMesh` z teksturą danych fasad (jak K-7 v2). Z daleka zabudowa
  przechodzi w mapę (albedo + mapa świateł) — nie ma „pudełek na dalekim LOD”.
- **Drzewa**: siatka blisko, impostor średnio, las w mapie daleko.
- **Szkło**: Fresnel + odbicie, interior mapping (sztuczne pomieszczenia i ogrody za szybą), szprosy,
  wnętrza świecą nocą.
- **Megastruktura**: 8–12 bazowych brył greeble w instancjach, rozstawianych regułami; detal paneli w shaderze.
- **Niebo**: gwiazdy + Droga Mleczna (sprawdź najpierw `src/3d/ringCitySkyDome.js`), tarcza słońca
  z poświatą; Księżyc opcjonalnie.
- **Planeta**: w kamerze gry kopia shaderów z `planet3d.assets.js` (`EARTH_FRAGMENT`, `CLOUD_FRAGMENT`,
  `ATMOSPHERE_FRAGMENT`) i te same tekstury Ziemi z `public/assets/planety/` — ma wyglądać jak w grze.
  W kamerze kinowej wolno lepszą planetę (rozpraszanie w atmosferze, cienie chmur, połysk oceanu) —
  ta nie idzie do portu.
- **Precyzja głębi w kamerze kinowej**: renderer gry ma `logarithmicDepthBuffer: false` — nie opieraj
  się na fladze, której gra nie ma. Dynamiczny near (z analitycznej odległości do ringu) albo podział
  na dwa zakresy głębi. Lot `RingCityFlight` używa near 2 / far 160 000 — ujęcia z bliska mają się w tym mieścić.

## 9. HDR i bloom — zasady zmierzone w tym repo

- Bierz `BLOOM_DEFAULTS` z `src/3d/bloomConfig.js` (próg 0,9, siła 0,85, promień 0,4) — import,
  nie kopia. Tone mapping ACES jak w grze.
- `UnrealBloomPass` **bramkuje, nie odejmuje**: piksel nad progiem bloomuje pełną wartością.
  Oświetlone powierzchnie (także chmury, śnieg, lód) mają zostać < ~0,85 luminancji; nad progiem
  tylko emitery i odblaski słońca.
- ACES odbarwia do bieli powyżej ~1,5. Barwne światła (pomarańczowe okna, niebieskie pasy): 0,9–1,3
  (bloomują i zostają barwne). Białe rdzenie (światła pozycyjne, dysze, tarcza słońca): 8–12.
- Barwy z hexów przeliczaj na liniowe. Zieleń trzymaj ciemniej (waga luminancji 0,7152).
- Nie strój na oko: render do RT `HalfFloat`/`Float`, `readRenderTargetPixels`, histogram luminancji
  dla każdego presetu.
- **Każdy NaN w HDR = czarne prostokąty rozmazane przez bloom.** Clampuj argumenty `pow`/`sqrt`/`log`,
  nie normalizuj zera.

## 10. Wydajność

Tryb gry (to pójdzie do portu):
- cały ring ≤ 40 draw calli przy każdym zoomie (obecny ≈ 50); passy gry są związane submisją —
  liczą się draw calle bardziej niż trójkąty;
- zero dodatkowych passów i map cieni; zero alokacji na klatkę (pule, bufory);
- przy zoomie 0,035 (cały ring w kadrze) nadal bogato — to robota map i shaderów, nie instancji;
- LOD bez twardych cięć; ring poza kadrem nic nie kosztuje;
- bez `PointLight` (gra ma `enginePointLights: false`) — światła to emisja + analityka.

Tryb kinowy: „Wysoka” ≥ 60 FPS w 1440p na przeciętnym GPU; „Ultra” może zejść do 30 (zrzuty, wycieczka).

## 11. Architektura pod port

- Moduły w `src/3d/haloRing/` (niepodpięte do `index.html`); demo tylko jako host:
  `dema/halo_ring_demo.html` + `dema/halo_ring_demo.js`.
- Proponowany podział:
  - `haloRingLayout.js` — czysta matematyka bez Three: profil, promienie, sektory, (u,v) ↔ świat;
    getter obwiedni zgodny z polami `computePlanetaryRingLayout` (`innerRadius`, `outerRadius`, …);
  - `haloRingConfig.js` — jedyne źródło liczb (skala, sektory, presety jakości, pasma HDR);
  - moduły renderu: powierzchnia; miasto/zieleń/szkło; megastruktura; ruch; wspólne chunki GLSL światła;
  - `index.js`: `createHaloRing({ planetRadius, seed, quality })` →
    `{ group, layout, update(dt, view), setSun(azimuth, elevation), setQuality(q), setLayers(map), dispose() }`.
- Moduły nie tworzą renderera ani canvasu (zasada z `AGENTS.md`); scenę, kamerę i renderer dostają
  od hosta; warstwy ustawia host.
- Three.js: gra ma `three@0.183.2` z `node_modules`. Demo importuje to samo
  (`import * as THREE from 'three'` przez Vite), nie CDN r169/r180 jak starsze dema.
- Buduj od razu w osiach gry. Dema Y-up wymagały przy porcie przepisywania shaderów (`makeBasis`,
  `coneDir`, shadery „na pokładzie”). Shader liczący pozycję z atrybutów instancji bez `modelMatrix`
  ignoruje transform rodzica — trzymaj się `modelMatrix` albo zapisz to w komentarzu.
- Deterministyczny seed: ten sam ring przy każdym uruchomieniu.

## 12. Demo: kamery, presety, UI (po polsku)

- Przełącznik **Kamera gry / Kamera kinowa**.
- Kamera gry: pan WASD / przeciąganie, kółko = zoom 0,035–3,2, `0` = reset; sprite Atlasa
  (`/assets/capital_ship_rect_v1.png`, 1800 × 806 j.) w środku kadru dla skali; odczyt zoomu i wysokości kamery.
- Kamera kinowa: orbita myszą + lot WASD/QE, Shift = szybciej, prędkość skaluje się z odległością
  od ringu, kółko = FOV.
- Presety (klawisze 1–8, każdy z własnym słońcem): 1 „Łuk w niebo” (z podłogi, ref. 2);
  2 „Wnętrze przez mgłę” (z zewnątrz, pod kątem, ref. 1); 3 „Dach z góry” (ref. 3); 4 „Nocne miasto
  nad Ziemią” (ref. 4); 5 „Szklane tarasy” (ref. 5); 6 „Miasto-ogród” (nisko, ref. 6); 7 „Kamera gry”
  (zoom 0,035, cała Ziemia); 8 „Planeta z ringiem” (szeroki plan ze słońcem). `C` = wycieczka po
  presetach z płynnymi przejazdami.
- Panel: jakość (Niska / Średnia / Wysoka / Ultra); słońce (azymut, wysokość, animacja doby); warstwy
  (chmury, atmosfera, światła miast, statki, drzewa, szkło, megastruktura, bloom); geometria (W, wysokość
  ścian, `floorTilt`, sektory) + „Przebuduj”; seed; ekspozycja.
- HUD: FPS, ms, draw calle, trójkąty, aktywne kafle, pamięć tekstur.
- URL: `?preset=3&quality=high&seed=…&shot=1` — do automatycznych zrzutów.
- Pierwsza klatka szybko, resztę map dociągaj w tle.
- Serwowanie przez Vite (`npm run dev`); z `file://` moduły ES nie działają.

## 13. Etapy

1. **M1 — szkielet**: layout + profil (podłoga, ściany, kadłub), planeta jak w grze, niebo, obie kamery
   z presetami-zaślepkami, UI, HUD. Zrzuty z kamery gry przy zoomie 0,035 / 0,2 / 1,0 / 3,2.
2. **M2 — habitat**: sektory, mapy, teren z LOD, woda, chmury, atmosfera, model światła z §6.
   **Tu zatrzymaj się: zrzuty presetów 1, 2, 6, 7, 8 i czekaj, aż użytkownik zaakceptuje kierunek wizualny.**
3. **M3 — megastruktura**: dach, kadłub, kratownice, doki, pasy świateł; widok z kamery gry bogaty na każdym zoomie.
4. **M4 — miasta, zieleń, szkło**: budynki, tarasy, drzewa, szklane habitaty, światła nocne.
5. **M5 — życie i szlif**: statki, światła pozycyjne, wycieczka, presety jakości, pomiar budżetów,
   notatka do portu (§16).

Po każdym etapie: zrzuty do `.tmp/halo-ring/` + tabela: preset → draw calle, trójkąty, FPS.

## 14. Weryfikacja

- Test czystej matematyki: `tests/haloRingLayout.test.mjs` (`node --test`) — obwiednia w 41 202–43 752,
  profil domknięty, sektory pokrywają 360° bez dziur, determinizm seeda, formuła widoczności habitatu z §5.
- `node --check plik.js` w tym repo NIC nie sprawdza (brak `"type": "module"` w `package.json`) —
  składnię sprawdzaj na kopii `.mjs` albo przez załadowanie w Vite.
- Headless Chrome na serwerze Vite: `renderer.debug.onShaderError`, skan NaN i histogram HDR (§9),
  `renderer.info` dla każdego presetu, zrzuty. Spróbuj GPU (`--use-angle=d3d11`); swiftshader tylko
  do poprawności, nie do wydajności.
- Wygląd ocenia użytkownik na zrzutach i w przeglądarce — nie pisz „wygląda świetnie” bez zrzutu,
  który to pokazuje.

## 15. Poza zakresem i pułapki repo

- Nie ruszaj `index.html`, `planetaryRing3D.js`, `ringCity*.js`, `core3d.js` ani starych dem.
  Port to osobne zadanie.
- `npm run build` pada dziś na brakującym `AISPACE.html` w `vite.config.js` (dema przeniesiono do
  `dema/`) — nie naprawiaj przy okazji.
- W `tests/` są testy czerwone już na czystym HEAD — nie naprawiaj cudzych.
- Nie commituj bez prośby. UTF-8 wszędzie.

## 16. Na później: port (zaprojektuj API tak, żeby był prosty)

Obecny ring spina się z grą przez: importy w `index.html` (≈ :1179–1188: init/update, zapytania
o encje i cele, `getPlanetaryRing`, `computeRingStationOrbitRadius`, `computePlanetaryRingLayout`,
`resolveRingPlanetWorldRadius`), pas cienia ringu w `planet3d.assets.js`, okluder ringu w `core3d.js`
(shadow shafts), tryb `free3d` (lot `RingCityFlight` z kokpitu — naturalny dom kamery kinowej),
panele stref i kolorów, hook `__planetaryRingsDebug` oraz testy `tests/ring*.mjs`, które częściowo
dopasowują tekst źródła.

Na koniec M5 zapisz `docs/PORT-halo-ring.md` (1 strona): co zastępuje co, w którym passie żyje ring
(BG, layer 1), co usunąć i które testy przepisać.
