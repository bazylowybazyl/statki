# BRIEF: gaz i pył hali K-7 v2 — prawdziwa wolumetria (2026-10-12)

> Prompt dla agenta. Zadanie: NOWA symulacja gazu i pyłu w halach K-7 — trójwymiarowa, na GPU, na Core3D — która
> zastępuje dzisiejsze pole 2D (`src/3d/gasField/`). Użytkownik ocenił dzisiejszy pył hali ORAZ oba dema gazów
> (`dema/gazy-webgpu.html`, `dema/gazy-transport-webgpu.html`) jako nie do przyjęcia („nie podoba mi się”). Nie poprawiasz
> ich — budujesz od nowa; z nich bierzesz tylko to, co wymienia § 4. Pytanie użytkownika „2D czy 3D, może prawdziwa
> wolumetria?” jest rozstrzygnięte w § 2: **prawdziwa siatka 3D, gruba (≈ 48 j.), a detal z faktury niesionej
> przepływem, z drobin i z osobnej, drobnej warstwy kurzu na pokładzie.**

## 0. Zanim napiszesz pierwszą linię

Przeczytaj (w tej kolejności, bez skrótów):

1. `AGENTS.md`: § „Render: WebGPU + TSL” z WSZYSTKIMI pułapkami (1)–(38), § „Pył i para w halach K-7, światła hali”
   (co dziś jest i jaki jest szew z grą), § „Wybuchy WebGPU” (gaz 3D, który użytkownik lubi: „fajnie omija przeszkody”),
   § „Obsługa paliwowa stanowisk K-7”, § „Odpalanie i gaszenie silników MAIN”, § „Rozgrzewka pipeline'ów”, § „Miejsca do
   pracy” pkt 1 (Core3D: efekty GPU, siatka świateł, warstwa DIST, maska słońca, rulon), pkt 4 (wydajność).
2. `docs/AUDYT-pyl-hali-2026-10-12.md` (cały) — co było złe w fizyce 2D, co poprawiono i co zostało z natury 2D (§ 3 pkt 5:
   „gaz pchany do ściany nie ma gdzie uciec”). `docs/AUDYT-gazy-demo-2026-10-12.md` § 3–6 — czego nie wolno powtórzyć
   (szum zamiast transportu, dysza, która zasysa, pył bez związku z gazem). `docs/AUDYT-wybuchy-gaz-2026-10-08.md` — lekcje
   kerneli gazu 3D. `docs/PLAN-gazy.md`, `docs/webgpu/FX-INFRA.md`.
3. Kod, który zastępujesz: `src/3d/gasField/gasField2D.js` (kernele 2D: RK2 + MacCormack, Jacobi z Neumannem, komórki
   stałe z prędkością kadłuba, źródło objętości dysz, zaokrąglanie stochastyczne f16), `hallDust.js` (krok efektów,
   `submit`, `interiorLightAt`, lampy do siatki), `hallDustLayout.js` (domena, rastr przeszkód, `HALL_DUST_IN`,
   `hallBodySolidCpu`), `hallGasSources.js` (źródła pary: złączki, szpule, zawory, nawiewy, buchy), `gasFieldLayer.js`
   (obraz: dwie płaskie siatki, faktura z pola pozycji spoczynkowych, snopy); `src/game/hallDustInput.js` (pakowanie
   wejścia po stronie gry, afiniczne hala → świat w double), `src/game/hullFootprint.js` (maska obrysu z żywych węzłów belek).
4. Kod, z którego bierzesz wzory: `src/3d/gas/gasGrid.js` (siatka 3D w `Storage3DTexture`, MacCormack skalarów i prędkości,
   spalanie / rozprężanie, Jacobi, przeszkody z flagą w komórce, zapis f16), `gasVolume.js` (marsz promienia, Kirchhoff,
   samocień, światła siatki `grid.loop`, głębia w kamerach 3D), `gasCommon.js`, `src/3d/tsl/zapisF16.js`,
   `src/3d/fx/lightGrid.js`, `src/3d/fx/gpuPoolOrigin.js`, `src/3d/engineFrame.js` (lista dysz MAIN klatki: `nzFrom`,
   `nzCount`, `nzX / nzY / nzDX / nzDY / nzR`, `power`, `spread`), `src/3d/sideNozzleFrame.js` (dysze SIDE klatki),
   `src/3d/haloRing/haloPortK7Layout.js` (`createK7Layout`, `k7SolidList`, `K7_HEIGHTS`, `k7HeightToZ`, `K7_FUEL_STATION`,
   `K7RoofFade`), `haloPortK7Lights.js` (`k7LightRig`, `K7_BEACON`, `k7BeaconLevel`, `k7VentEnvelope`),
   `src/3d/haloRing/haloRingGame.js` (`hallRoofOverride`, pozy obsługi z rejestru kolidera), `dema/dok-k7-webgpu.js`
   (demo samej hali NA Core3D — gospodarz twojego dema), `dema/wybuchy-webgpu.js` (jak demo pokazuje moduł gry na Core3D).
5. Narzędzia pomiaru, których protokół kopiujesz: `scripts/webgpu/hala-pyl-audyt.mjs` + `hala-pyl-porownaj.mjs` (Atlas na
   C-01 rufą do ściany, trzy odpalenia MAIN, lot ku bramie, odczyt pól z GPU, bilans, profile, A/B), `hala-pyl-gra.mjs`,
   `hala-swiatla-gra.mjs`, `hala-obrys-gra.mjs`, `wybuchy-sonda.mjs` (odczyt tekstur 3D z GPU), `tests/hallDust.test.mjs`
   (lustra CPU kerneli, WGSL budowany w Node, strażnik „zero window / DOM”).

Stan drzewa: w repo leżą NIEZACOMMITOWANE zmiany z 2026-10-12 (`src/3d/gasField/gasField2D.js`, `src/3d/gas/gasGrid.js`,
`src/3d/explosions/explosionFx.js`, `src/3d/tsl/zapisF16.js`, `dema/gazy-transport-webgpu.html`, skrypty audytu). Nie
cofaj ich, nie „sprzątaj” i nie używaj `git stash`. Swoją pracę commituj osobno, etapami, z opisem.

## 1. Cel: jak to ma wyglądać (feel)

Hala K-7 to port kapitałowy pod otwieranym dachem, z kamerą gry z góry (ortho) i opcjonalnymi kamerami 3D (K). Gaz ma
być TYM, co robi z hangaru miejsce: gęstsza mgiełka przy pokładzie, rzadsza wyżej, snopy reflektorów i soczewek, cień
kadłuba w mgle, kurz, który WSTAJE od silników, toczy się, uderza w ścianę, wspina się po niej i opada. Zachowania, które
użytkownik ma zobaczyć w 5–10 s (to jest lista odbioru, nie inspiracja):

1. **Spokój.** Cienka, warstwowa mgiełka: kurz na pokładzie leży w plamach i smugach (więcej przy ścianach i w kątach),
   nawiewy wentylacji powoli nim mieszają; reflektory rysują w mgle KLINY (stożki), soczewki R / G / B barwią ją w takt
   migania; przez otwarty dach słońce kładzie w mgle jasny prostokąt z cieniem Atlasa — w mgle i na pokładzie.
2. **Zapłon MAIN na stanowisku (rufa do ściany tylnej).** Najpierw zimny gaz z dysz podrywa kurz w wachlarz, potem gorąca
   struga: spaliny z pyłem walą w ścianę, WSPINAJĄ SIĘ po niej (zawinięcie), rozlewają pod sufitem grzybem i wracają nad rufą
   Atlasa jako wysoki, rzadki obłok, który go NIE zasłania. Przy pokładzie kurz wypychany spod kadłuba na wszystkie strony
   (efekt przypowierzchniowy), za silnikami ciemny, wymieciony klin pokładu. Po zgaszeniu kurz osiada w ~30 s w smugach
   zgodnych z przepływem — nie w ostrych, stojących spiralach.
3. **Kołowanie i start.** Kadłub, który rusza, wydmuchuje kurz spod siebie; za rufą kilwater i para wirów; kadłub rozcina
   mgłę SWOIM OBRYSEM (maska z belek — zostaje), gaz przepływa nad nim i pod nim, nie „przez”.
4. **Dysze SIDE.** Krótkie, ostre pyknięcia kurzu przy każdym impulsie manewrowym.
5. **Paliwo.** Zimna para kriogeniczna z złączek na ramionach (są 44 j. NAD kadłubem) OPADA po burtach i zalega na pokładzie
   pod okrętem; przy odpięciu buch pary rozchodzi się promieniście i osiada. Upust z zaworów, sączenie szpul — jak dziś,
   tylko w 3D.
6. **Kamery 3D (K).** Mgła ma głębię, snopy są stożkami, otwarty dach daje widoczny słup światła, obłok przy ścianie to
   walec zawiniętego gazu, nie dwie płaskie warstwy.
7. **Brama.** Ku bramie mgła rzednie i powoli wypływa (próżnia); gwiazdy widać przez nią.

Czego NIE ma być: gęstej plamy chowającej okręt (lekcja dymu wraków: „dym nie może chować rozgrywki”), jednolitej szarej
zupy, obrazu „dwóch płaskich warstw”, pyłu, który stoi w miejscu na zawsze, rozmytych wokseli przy zoomie 3,2 (detal
niosą faktura i drobiny, nie siatka), bieli do bloomu (para przy słońcu — lekcja etapu 1b).

## 2. Decyzja architektoniczna: 3D, gruba siatka + detal pod siatką

**Dlaczego nie 2D (także nie „2D z trikami”)**: każda rzecz z § 1 to struktura PIONOWA — zawinięcie przy ścianie, grzyb pod
sufitem, kurz spod kadłuba, para opadająca ze złączek, snopy jako stożki, cień w mgle, przepływ nad i pod okrętem. Pole 2D
musi to udawać (miękki rzut, trzy wysokości snopów, ułamek `front` nad kadłubem) i użytkownik to widzi. Audyt 2D § 3 pkt 5
nazwał to wprost. Dwa i pół wymiaru (kilka warstw 2D ze stosunkiem wymiany) to ta sama siatka 3D z brzydszą dyskretyzacją
— nie rób tego osobno; jeśli budżet wymusi, siatka 3D z 6–8 warstwami nierównej wysokości jest tym samym kodem.

**Dlaczego nie pełne 3D przy 28 j. komórki**: hala 10 440 × 7 150 × 720 j. przy 28 j. to ≈ 2,5–3,5 mln komórek — rząd
5 ms GPU na krok (40 przebiegów po 100 MB). Nie mieści się nigdzie.

**Decyzja**: jedna siatka 3D na halę, komórka ≈ 48 j. (sześcienna), domena ≈ 240 × 192 × 16 (x w poprzek 11,5 km, z wzdłuż
z fartuchem 9,2 km, y 0–768 — jedna warstwa nad dachem na wypływ przez otwarty dach) ≈ 0,74 mln komórek; zapas: 56 j.
(≈ 0,48 mln) albo 64 j. (≈ 0,32 mln), wybór POMIAREM w etapie 0 wobec budżetu § 11. Anizotropia dozwolona (np. 56 × 56 × 40).
Odniesienie kosztu: atlas „fine” wybuchów 128² × 48 = 0,79 mln komórek z 41 iteracjami Jacobiego kosztuje w bitwie ≈ 0,6 ms
na klatkę razem z obrazem; pole 2D hali 134 tys. komórek — 0,17 ms na podkrok.

Detal poniżej komórki dają TRZY rzeczy (wszystkie obowiązkowe):
- **pole pozycji spoczynkowych 3D** (vec3, dwie fazy przenikane co ~8–12 s) niesione przepływem — marsz próbkuje nim szum
  3D, więc faktura jedzie z gazem i jest ostra przy każdym zoomie (dziś ten wzór działa w 2D w `gasFieldLayer.js`);
- **drobiny** (GPU, 256–512 tys.): rodzone z gęstości pyłu w powietrzu (budżet na komórkę, hasz — bez `Math.random`),
  niesione prędkością trójliniowo + opadanie + mały szum wirowy, oświetlone z objętości światła, z testem głębi; to one dają
  „pyłki w snopie” i ziarno. Masa pyłu mieszka TYLKO w siatce — drobina jest obrazem, nie drugim pyłem;
- **kurz na pokładzie** jako osobne pole 2D o drobnej komórce (≈ 24 j., np. 480 × 384, RG16F: depozyt + świeżość),
  wymieniające masę z dolną warstwą 3D (podrywanie ścinaniem, osiadanie).

## 3. Geometria i liczby (jedno źródło: `haloPortK7Layout.js`)

- Hala (`createK7Layout`): `halfWidth` 5 220, `frontHalfWidth` 3 200 (przy bramie), `backZ` 250, `bodyEndZ` 6 000, `frontZ` 7 400,
  `apronDepth` 1 180; `height` 720, `wallHeight` 620, `wallThickness` 88. Obrys sześciokątny (`footprint`). Bramy w ścianach
  (G-01 do próżni) — z `k7SolidList(layout)`; przedmioty kolizji mają zakres wysokości `y0..y1` (`addBox(…, y0, y1)`): słupki
  paliwowe do `K7_FUEL_STATION.shoulder.y1` = 352, zbiorniki-cygara (`shape: 'tank'`) przy ścianie tylnej, pylony, pompy,
  rurociągi na legarach (pod płaszczyzną lotu), człony ramion SCARA na 300 / 330 (cienkie — wolno pominąć).
- Wysokości K-7 (`K7_HEIGHTS`): kadłub 48–116, lot 76; złączki paliwowe na `couplerY` = 160 (NAD kadłubem). Scena:
  `k7HeightToZ(y)` — pod `hullTop` 1:1 (z ≤ 0), nad nim × `K7_ABOVE_SCALE` 0,42 (dach 720 → z ≈ 254). Kamera ortho ma `near` 1,
  przy zoomie 3,2 wisi 535 j. nad z = 0. Obraz objętości liczysz w wysokościach K-7, a głębię fragmentu i bryłę rysowania
  mapujesz tym samym `k7HeightToZ` co bryły hali — inaczej dach i ramiona zasłonią gaz nie tam, gdzie trzeba.
- Dzisiejsza domena 2D: komórka 28 j., 400 × 336 (11 200 × 9 408 j.), przekształcenie hala → świat gry w double
  (`hallToGameAffine`) — zostaje. Jedna symulacja na grę: hala przy kamerze (wszystkie hale K-7 Ziemi, Marsa i Jowisza mają ten
  sam układ; zmiana hali = czyszczenie stanu). Zatoki (`registry.bays`, inny układ) — poza tym briefem.
- Dach: stan z `K7RoofFade` / `HaloRingGame.hallRoofOverride` (w kampanii dach otwiera się nad Atlasem) — otwór to brzeg
  wypływu i okno słońca; zamknięty dach to ściana.

## 4. Co zostaje z dzisiejszego kodu, co odchodzi

ZOSTAJE (używaj, nie przepisuj): szew gra ↔ render (`HALL_DUST_IN` jako `Float64Array` o stałym układzie, pakowany w
`src/game/hallDustInput.js`; rozszerz o stan dachu — ułamek otwarcia i prostokąt otworu w układzie hali — i podbij wersję
układu), maska obrysu kadłuba z żywych węzłów belek (`hullFootprint`, rekord `HALL_DUST_SHIP`, prędkość ciała + ω × r),
harmonogram i zdarzenia źródeł pary (`hallGasSources.js`: złączki tam, gdzie niesie je ramię, szpule, zawory z
`k7VentEnvelope`, nawiewy, buchy przy ryglowaniu / odryglowaniu), oprzyrządowanie hali (`k7LightRig`, soczewki z
`k7BeaconLevel` i zegar `HaloRingGame.clock` — ta sama faza co shader hali), kontrakt `interiorLightAt(x, y)` dla domen gazu
wybuchów pod dachem (`__explosions.interiorLight`), zaokrąglanie stochastyczne zapisu f16 (`src/3d/tsl/zapisF16.js`,
tryb sprzętu wykrywany raz), zasada „pył zimnego gazu przy zapłonie” (moc strumienia = max(`EngineFrame.power`,
`engineSmokeFlow`)), siatka świateł `Core3D.fx.grid` jako jedyna droga świateł dynamicznych, maska słońca `sunVisibility`.

ODCHODZI (po odbiorze, osobnym commitem): kernele 2D `gasField2D.js`, obraz `gasFieldLayer.js`, kłęby pary z puli dymu
rakiet (`HallDust.setVaporSmoke` — para jest teraz objętością; A/B przed usunięciem), miękki rzut i inne protezy pionu.
Do odbioru przez użytkownika stary moduł ZOSTAJE za przełącznikiem (`?gazHali=2d|3d`, domyślnie `3d`) — A/B na tej samej
klatce to część raportu.

Z dem gazów (`gazy-*`) NIE bierzesz silnika ani pyłu; wolno wziąć: próbkę-odcinek przy składaniu w perspektywie (pułapka
plasterków), albedo per gaz, pomysł na cel „fx” w MRT — tylko jeśli naprawdę pasuje do marszu objętości.

## 5. Model fizyczny (siatka 3D)

- Gaz nieściśliwy ze ŹRÓDŁAMI OBJĘTOŚCI (cel dywergencji > 0 przy dyszach i źródłach pary — jak `expansion` w `gasGrid.js`
  i krok 1 audytu 2D; dysza PCHA, nie zasysa), rzut ciśnienia Jacobi ≈ 24–31 iteracji z rozgrzaniem poprzednim wynikiem
  (audyt: więcej iteracji nic nie daje), Neumann na przeszkodach, p = 0 na brzegach otwartych (brama, otwarty dach, brzeg
  domeny poza halą), pokład y = 0 bez przenikania z tarciem, zamknięty dach bez przenikania. Adwekcja MacCormack z obcięciem
  dla skalarów I prędkości (lekcja wybuchów: bez tego wiry gasną), mała konfinacja wirów, opór 0,15–0,25/s + kwadratowy dla
  szybkiego frontu poza stożkami, dyfuzja pyłu i pary (mała, + ∝ |ω|), turbulencja także w czystym gazie przy ścinaniu.
- Skalary: PYŁ w powietrzu, PARA, SPALINY (czysty gaz z dysz — rozrzedza pył), TEMPERATURA (wyporność: gorące spaliny idą
  w górę i rozlewają się pod sufitem, para kriogeniczna jest CIĘŻKA i opada — stała opadania osobna od pyłu).
- Przeszkody jako UDZIAŁ ZAJĘTOŚCI komórki 0–1 (nie bit): wokselizacja `k7SolidList` z zakresami `y0..y1` (ściany z bramami,
  słupki, zbiorniki, pylony, kolumny, pokład, dach z otworem), kadłuby jako PŁYTA 48–116 × maska obrysu z prędkością
  v + ω × r (slot masek R8 jak dziś). Dzięki ułamkowi płyta kadłuba i szczelina 48 j. pod nią istnieją także przy 48 j.
  komórki (warstwa 0 = szczelina pod kadłubem, gdzie kurz jest wyciskany). Lustro CPU zajętości dla testów.
- Dysze MAIN: KAŻDA dysza z listy klatki `EngineFrame` osobno (dziś: jeden stożek na okręt z profilem płaskim — to proteza),
  na wysokości lotu 76, oś wzdłuż `nzDX / nzDY` (świat gry → hala tym samym afinicznym, co dziś), wydatek objętości ∝ r² ×
  moc, pęd wzdłuż osi z profilem promieniowym, źródło temperatury i spalin, zasłanianie marszem po zajętości wzdłuż osi
  (za ścianą tylną i za zbiornikami strumienia nie ma). Fazy zapłonu / gaszenia z mocy w `EngineFrame` (zimny gaz: pęd bez
  temperatury). Dysze SIDE z `SideNozzleFrame` (położenie, kierunek, przepustnica — impulsy): małe źródła, krótkie.
- Źródła pary: rekordy `hallGasSources.js` przeniesione na 3D (złączki na 160, zawory, szpule, nawiewy z kierunkiem).
- Kurz na pokładzie (pole 2D § 2): podrywanie z naprężenia ścinającego dolnej warstwy (progi jak `liftLo / liftHi`,
  przeliczone na nową siatkę), zdjęta masa → pył warstwy 0; osiadanie pyłu warstwy 0 na depozyt z prędkością opadania —
  wszędzie, nigdy 0, bez zaniku w hali, zanik tylko w próżni za bramą i nad otwartym dachem; wzór startowy z rastru układu
  (więcej przy ścianach i w kątach). ZASADA ZACHOWANIA: masa pyłu (powietrze + pokład) stała z dokładnością ±2 % przez 60 s
  bez źródeł, poza wypływem przez bramę — mierzona, nie zakładana.
- Czas: `dt` czasu gry z wejścia (0 w pauzie i scenach fabuły), jeden krok na klatkę z sufitem `dt` (semi-Lagrange jest
  stabilna), budzenie / usypianie jak dziś (źródła hali trzymają ją obudzoną — zmierz, czy krok „bez ruchu” da się skrócić).
- Zapis f16 (`rgba16float` storage): KAŻDE pole zmieniane drobnymi przyrostami przez `sroundF16` — bez tego pył znika
  (pomiar 2026-10-12: RTX / D3D12 obcina ku zeru). Ciśnienie bez zaokrąglania (większość dispatchy).

## 6. Obraz i światło

- Marsz promienia przez płytę hali (16 warstw — tani): DWA rysunki jak u wybuchów — `back` (y < 116: pass ortho PRZED
  kadłubami, zapis głębi na górze bryły — kadłub (renderOrder 10, z ≈ 0) go zasłoni) i `front` (y ≥ 116: pass FG, warstwa 2,
  po bryłach FG, przezroczysty; zamknięty dach zasłania go głębią, dach wygaszony nad graczem (`K7RoofFade`, drugi stan
  materiału) — sprawdź kolejność i test głębi, gaz pod wygaszonym dachem MA być widoczny). Kamery 3D: perspektywa z głębią
  sceny jak `gasVolume.node(depthNode)` / bryła z `modelViewMatrix` — zrób oba widoki od razu, nie „potem”.
- OBJĘTOŚĆ ŚWIATŁA (tekstura 3D w połowie rozdzielczości siatki, liczona co klatkę w compute): słońce przez otwór dachu i
  bramę (× `sunVisibility`; cień w pionie = całka gęstości od góry — jeden kernel prefiksowy — plus cień płyty kadłuba z
  maski obrysu, zmiękczony odległością), lampy dookólne hali (`k7LightRig`), reflektory (stożek + cień 3–4 próbkami ku
  światłu przez zajętość i gęstość — okręt pod reflektorem rzuca w mgle CIEMNY KLIN), soczewki w takt migania, światła
  siatki `Core3D.fx.grid` przez `grid.loop` z kolanem (dysze — `pushEngineHullLights`, błyski, wybuchy), otoczenie wnętrza /
  próżni z wielokąta hali. Faza HG (g ≈ 0,3–0,5). Samocień gazu w marszu z objętości światła (wzór `gasVolume.js`).
  Lampy dookólne prawie bez rozpraszania (lekcja: szarzyły całą halę) — snopy dają reflektory, soczewki i dysze.
- Składniki w obrazie: pył (szaro-beżowy, faktura kłębów + ziarno z drobin), para (chłodna, gładsza, rzadsza), spaliny
  (ciepłe, bez faktury), żar strugi — światło z siatki, nie gaz. Barwy w pasmach HDR gry (ciała 0,3–1,3; rdzenie świateł
  > 0,9 tylko tam, gdzie świeci światło, nie gaz).
- TWARDE OGRANICZENIE: przepuszczalność nad kadłubem gracza ≥ 0,7 poza chwilowymi buchami (≤ 2 s) — mierzone z objętości.
- Drobiny: kwady instancji (WebGPU rysuje punkty 1 px), rozmiar w px z sufitem i podłogą, światło z objętości światła,
  test głębi, bez zapisu głębi, mieszanie przez `blendAddytywnePremul` albo zwykła alfa — A/B.
- Faktura: szum 3D (`fxNoise` / tile) próbkowany polem pozycji spoczynkowych, dwie fazy przenikane; przy oddaleniu gaśnie
  (mipmapy / próg na px) — bez migotania.

## 7. Szew z grą i wpięcie

- Moduł `src/3d/hallGas/` (np. `hallGasGrid.js` — solver, `hallGasDeck.js` — kurz pokładu, `hallGasMotes.js` — drobiny,
  `hallGasLight.js` — objętość światła, `hallGasVolume.js` — obraz, `hallGas.js` — krok efektów i API `HallGas`). W module
  ZERO `window`, DOM, `requestIdleCallback` (strażnik w teście jak dla `gasField`) — render w workerze = przekazanie tablicy.
- Krok `Core3D.addFxStep({ name: 'gaz hali', spawn, lights, update, warm })`: czyta TYLKO tablicę wejścia (`HallGas.submit`),
  `EngineFrame` i `SideNozzleFrame`; `warm` = puste dispatche WSZYSTKICH kerneli + siatki obu passów z kamerą z góry i 3D
  (`Core3D.warmup`, faza `loading`); tekstury 3D alokowane na ekranie ładowania (nie w klatce wejścia do hali).
- Gra: `index.html` w `render()` pakuje wejście jak dziś (`packHallDustFrame` → rozszerzone pola) i woła `HallGas.submit`;
  przełącznik `?gazHali=2d|3d` (+ `OPTIONS` / localStorage `sc_hall_gas`), domyślnie `3d`; `__explosions.interiorLight`
  dostaje `HallGas.interiorLightAt`; `HallDust` (2D) zostaje do odbioru.
- Nowe dane per kadłub / źródło — pola w rekordach tablicy wejścia, nie referencje do encji.

## 8. Twarde zasady repo (złamanie = etap nieprzyjęty)

- Jeden renderer: `Core3D`. Tylko TSL (`three/tsl`): bez GLSL, `ShaderMaterial`, `onBeforeCompile`, własnych celów i passów;
  compute tylko w kroku `Core3D.fx`, jeden `renderer.compute(lista)` na krok. Światła tylko przez siatkę świateł.
- Graf węzłów raz, wartości per obiekt w `material.uniforms` / buforach ze slotem; `InstancedBufferGeometry`, nie
  `InstancedMesh`; ≤ 8 buforów wierzchołków na pipeline, ≤ 12 buforów uniformów na etap, ≤ 8 buforów storage na kernel
  (aliasuj role tekstur jak `gasGrid.js`); żaden kernel nie czyta i nie pisze tej samej tekstury.
- Zero alokacji na klatkę w gorących pętlach; bufory bez `DynamicDrawUsage` (zakresy przez `src/3d/zakresyWysylki.js`);
  pozycje hali lokalne (double → float dopiero w układzie hali; świat gry leży przy 5–10 mln j.).
- Losowość tylko `fxRandom` / hasze (strażnik `tests/wizualiaFxRandom.test.mjs`); determinizm: ten sam stan wejścia = ten sam
  obraz (sonda).
- Pipeline'y synchroniczne w klatkach gry = 0 (harness liczy `pipeline.sync`); każde `compileAsync` na celu przez
  `compileAsyncNaCelu`.
- Pułapki three r183 z `AGENTS.md`: `setLayout` tylko dla funkcji czystych i płaskich, `smoothstep` z krawędziami, `pow`
  z ujemną podstawą, zmienne `.toVar()` przed `If`, uuid węzłów (38), f16 (zapisF16), wyznacznik macierzy świata (37).
- Każda formuła kernela ma LUSTRO CPU w teście (`tests/hallGas.test.mjs`): profil i wydatek dyszy, zajętość z brył i
  zakresów y, mapowanie wysokości, zaokrąglanie f16, krok Jacobiego / rzutu na jednej komórce (jak `gasJacobiCellCpu`),
  WGSL budowany w Node (`renderer.backend.createNodeBuilder`, wzór `tests/haloRingTSL.test.mjs`).
- UTF-8, LF (CRLF psuje testy i regexy), teksty po polsku, notatki dla następnych agentów z prefiksem `AGENT:`.
- Pomiary GPU: maszyna bez innych obciążeń, A/B naprzemiennie w JEDNYM przebiegu, mediany; nie edytuj kodu w trakcie
  pomiaru (Vite przeładuje stronę).

## 9. Etapy z bramkami (każdy etap kończy się zrzutami i liczbami dla użytkownika, w `.tmp/hala-gaz/<etap>/`)

**E0 — rozpoznanie i szkielet (krótko).** Przeczytane § 0. `docs/PLAN-gaz-hali-3d.md` (1 strona: siatka, tekstury i role,
kernele i kolejność, passy, budżety). Szkielet modułu z PUSTYMI kernelami o docelowym rozmiarze przy 48 / 56 / 64 j.
(adwekcja + 30 iteracji Jacobiego) zmierzony w demie → wybór komórki wobec § 11. Bramka: liczby w planie.

**E1 — solver w demie hali.** `dema/hala-gaz-webgpu.html` na gospodarzu `dema/dok-k7-webgpu.js` (hala na Core3D, Atlas, lot
W / S / A / D, automat stanowisk, ODDOKUJ, widoki z góry i 3D). Zajętość z brył i dachu, płyta kadłuba z maską, dysze MAIN
per dysza i SIDE, temperatura i wyporność, pył + kurz pokładu z zachowaniem masy, para ciężka ze źródeł hali, brama i dach
jako wypływ. Obraz NAJPROSTSZY (gęstość, otoczenie, słońce) — ma pokazać fizykę. Harness `scripts/webgpu/hala-gaz-demo.mjs`
z miarami § 10 i odczytem pól 3D z GPU (wzór `wybuchy-sonda.mjs`). Bramka: wszystkie miary fizyki z § 10, koszt symulacji
w budżecie, determinizm sondy.

**E2 — detal i światło.** Pole pozycji spoczynkowych 3D, drobiny, objętość światła (słońce przez dach z cieniem kadłuba,
lampy, reflektory z cieniem, soczewki, siatka), HG, `back` / `front`, kamery 3D, współpraca z wygaszanym dachem; przełączniki
A/B każdej warstwy (`HallGas.look`, `HallGas.tune`). Bramka: zrzuty z § 10 (obraz) przy zoomach 0,32 / 1 / 3,2 i w kamerze 3D,
koszt obrazu w budżecie, przepuszczalność nad kadłubem.

**E3 — gra.** `HallGas` za przełącznikiem, rozszerzony szew, rozgrzewka, `interiorLightAt`, `scripts/webgpu/hala-gaz-gra.mjs`
(protokół `hala-pyl-audyt.mjs` + miary pionu + A/B `2d` ↔ `3d` na tej samej klatce + koszt + pipeline'y), testy, sekcja
w `AGENTS.md` (zastępuje § „Pył i para w halach K-7” — stary opis przenieś do „dawne”), notatka w pamięci projektu.
Bramka: pipeline'y synchroniczne 0, budżety § 11, p95 klatki poza halą bez zmian (±0,3 ms), zrzuty A/B.

**E4 (osobny brief, nie teraz):** zatoki portu (`registry.bays`), hale Marsa i Jowisza w ubiorze archetypów, domeny gazu
wybuchów pod dachem na wspólnej objętości światła, render w workerze.

## 10. Miary (liczby, które raportujesz; „cel” = bramka)

Fizyka (Atlas na C-01 rufą do ściany tylnej, pełny MAIN 5 s, potem 30 s spoczynku; drugie i trzecie odpalenie; lot ku bramie —
protokół `hala-pyl-audyt.mjs`):
- ZAWINIĘCIE przy ścianie: 2 s po pełnym ciągu ≥ 25 % masy spalin w pasie 1,5 km od ściany leży NAD y = 300; szczyt prędkości
  pionowej przy ścianie ≥ 0,3 × prędkości u wylotu. (Nowa miara — to jest cały sens 3D.)
- Grzyb pod sufitem: po 4 s masa spalin w warstwach y > 500 rośnie, a nad kadłubem przepuszczalność ≥ 0,7.
- Tunel w locie ≥ 450 j. szerokości (pył < 35 % tła), flanka ≤ 1,3 × tło (jak audyt 2D § 6).
- Drugie odpalenie / pierwsze (zdjęte z pokładu) ≥ 0,5; wróciło na pokład po 30 s ≥ 0,8; masa pyłu zachowana ±2 % / 60 s
  bez źródeł (poza wypływem przez bramę).
- Kurz spod kadłuba: po starcie z postoju (0 → 300 j/s) pas poderwanego kurzu po obu burtach ≥ 200 j. szerokości.
- Para ze złączek: po 10 s sączenia ≥ 60 % masy pary poniżej y = 116 (opadła), nie nad okrętem.
- Residuum dywergencji / v_rms ≤ 0,06; rdzenie stojących wirów ≤ 2 × średnia (6 s po ciągu).
- Determinizm: dwie sondy tego samego wejścia — identyczne liczby.

Obraz (zrzuty, te same klatki `2d` i `3d` obok siebie): spokój (wentylacja, soczewki, snopy, słońce przez dach z cieniem),
zapłon na stanowisku (zimny gaz), 2 s i 6 s ciągu (zawinięcie, grzyb), 30 s po (smugi osiadania), kołowanie / start (kurz
spod kadłuba, kilwater), impuls SIDE, buch pary przy odpięciu, lot ku bramie, kamera 3D (pościg, orbita) — każdy przy zoomie
0,32 / 1 / 3,2. Do tego 2–3 krótkie sekwencje klatek (GIF / arkusz) z odpalenia i odpięcia.

Koszt (RTX klasy Blackwell, 1600 × 900 i 2560 × 1440; `Core3D.gpuFrameMs`, mediany, ABAB): symulacja na krok, objętość
światła, obraz `back` / `front`, drobiny, CPU kroku, pamięć GPU, pipeline'y synchroniczne po starcie gry, liczba rysunków
i dispatchy na klatkę.

## 11. Budżety

| Co | Limit |
|---|---|
| GPU na klatkę w hali (symulacja + światło + obraz + drobiny), 1600 × 900 | ≤ 1,0 ms (symulacja ≤ 0,6) |
| GPU na klatkę, 2560 × 1440 | ≤ 1,6 ms |
| CPU kroku na klatkę (pakowanie wejścia + krok) | ≤ 0,25 ms |
| Pamięć GPU modułu | ≤ 80 MB |
| Pipeline'y synchroniczne w klatkach gry | 0 |
| Alokacje na klatkę w kroku | 0 |
| Klatka wejścia do hali (pierwsza aktywacja) | bez przestoju > 2 ms ponad zwykłą |

Nie zmieścisz się → najpierw grubsza komórka (56, 64 j.), potem rzadsza objętość światła, potem mniej drobin. Nigdy powrót
do 2D.

## 12. Czego nie robić

Nie naprawiaj pola 2D ani dem `gazy-*`. Nie buduj drugiego silnika obok (`gasGrid.js` ma zostać silnikiem wybuchów — kopiuj
kernele, które pasują, z tą samą konwencją zapisu f16; nie forkuj całego pliku). Nie rób dymu ze sprite'ów jako ośrodka.
Nie rób pełnego 3D przy 28 j. Nie dokładaj mgły „na wierzch” (jedno medium, jeden marsz). Nie zasłaniaj rozgrywki. Nie
czekaj na decyzje — § 13 ma domyślne; pytaj tylko, gdy coś z § 13 okaże się niemożliwe. Nie uruchamiaj pomiarów przy innych
obciążeniach maszyny. Nie zmieniaj rozgrywki (kolizje, sterowanie, obrażenia) — gaz to obraz.

## 13. Decyzje domyślne (zmień tylko na polecenie użytkownika)

1. Komórka 48 j., sześcienna; zapas 56 / 64 wg budżetu (pomiar E0).
2. Drobiny: tak, 256–512 tys., przełącznik A/B; masa tylko w siatce.
3. Para kriogeniczna: ciężka, opada; spaliny: gorące, wypływne.
4. Słońce przez otwarty dach z cieniem kadłuba: tak, gdy stan dachu jest w wejściu.
5. Brama = przepuszczalne „pole” (fikcja gry): gaz, który wyleci, ginie w próżni; nic nie wraca. Otwarty dach tak samo.
6. Stary moduł 2D zostaje za przełącznikiem do odbioru; usunięcie — osobny commit po „OK” użytkownika.
7. Czas fizyki = czas gry (pauza stoi); migotanie drobin i soczewek — zegar efektów.
8. Nazwa modułu `src/3d/hallGas/`, API `HallGas` (`submit`, `interiorLightAt`, `stats`, `tune`, `look`, `warmupMeshes`).

## 14. Raport na koniec każdego etapu

Lista plików (nowe / zmienione), tabela miar z § 10 „cel / wynik”, koszty z § 11, zrzuty i sekwencje w `.tmp/hala-gaz/<etap>/`,
co nie wyszło i dlaczego (bez upiększania), polecenia do powtórzenia pomiaru (`node scripts/webgpu/…`), commit per etap
z opisem po polsku. Żadnych „gotowe” bez liczb i zrzutów.
