# Zasięg czujników (radarów) — plan i propozycje wyglądu

2026-11-03. Prośba użytkownika: „potrzebuję mechaniki zasięgu — jak w Starsectorze, że statki wykrywają ciebie, a ty je;
system radarów oraz UI pokazujące zasięg radarów; UI może łączyć radary np. wrogów, żeby nie pokazywać miliona znaczników.
Stwórz podwaliny w kodzie i jako etap pierwszy przygotuj kilka propozycji wyglądu do mojej oceny”.

Stan: **etap 0 (podwaliny), etap 1 (propozycje wyglądu — demo 2D) i etap 1b (prototyp w grze za flagą `?radarZasiegi`,
§ 4b) gotowe**. Rozgrywka, AI i mgła wojny działają jak dotąd — prototyp tylko rysuje. Etap 2 czeka na decyzje z § 5.

2026-11-04 użytkownik: „o to chodziło od początku — demo, które pokaże, jak to będzie wyglądać w grze i CIC; zbuduj
scenę w grze” + obrazek: trójkąty okrętów w narożnikach, przed nadajnikiem łuki fal (niebieski — swój radar, czerwony —
wroga), fala wroga nie sięga gracza.

## 1. Jak to jest w Starsectorze (punkt wyjścia)

- Każda flota ma **siłę czujników** (jak daleko widzi) i **profil** (jak daleko ją widać). Wiki podaje regułę kciuka:
  zasięg wykrycia = siła czujników obserwatora + profil celu; bez premii i kar dwie floty widzą się naraz.
- Profil i siłę zmieniają stan i zdolności: „Go Dark” (cisza — mniejszy profil, wolniej), „Sensor Burst” (chwilowo
  większy zasięg, ale i profil), walka (+1000 profilu), teren (mgławice, burze), modyfikacje kadłuba.
- Dwa poziomy: kontakt czujnikowy (wiadomo, że coś jest, i jak duże) i identyfikacja z bliska (skład, frakcja).
- Na mapie kampanii: krąg własnych czujników i krąg „wykryty z odległości” wokół floty.

## 2. Model w HULLFALL (`src/game/sensorDetection.js`)

```
zasięg wykrycia = CZUJNIKI obserwatora [j.] × SYGNATURA celu [×] × OSŁONA terenu przy celu [×]
```

- **Iloczyn, nie suma** — tę postać liczy już obraz sytuacji AI (`fleetAwareness.js`, `detectedBy`: zasięg pasywny ×
  wykrywalność klasy), a rozpiętość kadłubów od myśliwca po superkapitał jest za duża na sumę (Atlas widziałby myśliwiec
  z 80 km). W stanie neutralnym (bez ciągu, ostrzału, impulsu, ciszy) wszystkie mnożniki = 1 → dzisiejsze koło AI bit
  w bit (test „stan neutralny”).
- **CZUJNIKI** = `SHIP_SENSOR_PROFILES.passiveRange` (fregata 18 km, niszczyciel 30, pancernik 45, kapitałowy 60, Atlas 80,
  Corvus / `role: 'radar'` 42, myśliwiec 8); po impulsie skanera X rosną ku `activeRange` i gasną przez 3 s; cicha praca × 0,6.
- **SYGNATURA** = wykrywalność klasy (`getEntitySizeModifier`: myśliwiec 0,5, fregata 0,7, niszczyciel 0,85, pancernik 1,0,
  kapitałowy / Atlas 1,3, stacja 1,5) × stan: ciąg MAIN do +35%, dopalacz × 1,25, hipercruise × 2,5, warp × 4, świeży
  strzał +60% (gaśnie 4 s — jak odsłona mgły po trafieniu), impuls X +100% (3 s), cicha praca × 0,5, wrak × 0,3, podłoga 0,05.
  Ciepło gaśnie liniowo w czasie — wynik nie zależy od kroku fizyki (test 60 / 120 / 240 Hz).
- **OSŁONA** przy celu: otwarta przestrzeń 1, obrzeże pasa 0,8, gęste pole pasa 0,6, gaz 0,5 (wartość wybiera gra z pola).
- **Poziomy**: KONTAKT — cel w zasięgu wykrycia: przybliżone miejsce (błąd do 7% odległości przy granicy, płynnie
  wędrujący, deterministyczny — `contactOffset`) i rozmiar z sygnatury (MAŁY / ŚREDNI / DUŻY / OGROMNY);
  IDENTYFIKACJA — w zasięgu WZROKU (dzisiejsza mgła wojny: 5–18 km, dron 20 km) — klasa, strona, namiar.
- Wielkości przykładowe (Atlas, sygnatura 1,3): pancernik piratów wykrywa go z 58,5 km, Corvus z 54,6 km, fregata
  z 23,4 km; Atlas w ciszy (0,65) — z 29 / 27 / 12 km. Fregata zwiadu w ciszy (0,35) — Corvus z 14,7 km.

## 3. Podwaliny w kodzie (etap 0)

- `src/game/sensorDetection.js` — model (czysty): `createSensorState` (stan czujnikowy bytu: ciąg, napęd, ciepło ostrzału
  i impulsu, cisza, wrak), `noteSensorFire` / `noteSensorPing` / `stepSensorState`, `signatureMul` / `entitySignature`,
  `sensorStrength`, `detectionRange`, `detectionLevel`, `contactSizeClass`, `contactOffset`, obraz wykrycia stron
  `computeDetectionPicture` (tablice typowane: poziom, liczba źródeł, głębia w zasięgu / odległość do krawędzi, źródło).
- `src/game/sensorCoverage.js` — geometria dla UI (czysta): SUMA KÓŁ zasięgu → łuki brzegu (jeden obrys zamiast stosu
  okręgów; koła zawarte w innych odpadają — flota 40 okrętów to zwykle 1 łuk), skupiska (jeden podpis na skupisko,
  punkt podpisu na szczycie), `nearestCoverageEdge` (dokładna odległość do brzegu, także od środka strefy),
  `coverageCountAt`, grupy znaczników `groupPoints` („×12” zamiast 12 symboli). Bufory rosną skokowo, O(n log n + par).
- Testy: `tests/sensorDetection.test.mjs`, `tests/sensorCoverage.test.mjs` (m.in. losowe zestawy kół — łuki leżą na brzegu
  sumy, brak dziur, skupiska = składowe spójności).

## 4. Etap 1 — propozycje wyglądu (do oceny)

Demo: `dema/radar-zasiegi.html` (Vite: `npx vite --port 5199` → `http://localhost:5199/dema/radar-zasiegi.html`),
liczone na modułach z § 3, zasięgach z `SHIP_SENSOR_PROFILES`, wzroku z `FOG_TUNE` i symbolach radaru kokpitu. Scena:
Atlas z eskortą, dwa drony (A rozpoznaje środkową czatę, B pilnuje floty), stacja czujników; piraci — trzy czaty Corvus co
60 km (dolna w pasie asteroid), flota (pancernik, 2 niszczyciele, 5 fregat, 6 myśliwców) na patrolu, rajder, stacja; pas
asteroid (osłona 0,6) i obłok gazu (0,5). Piraci, którzy wykryją kogoś ze strony gracza, ruszają w pościg.
Klawisze: `1`–`5` propozycja, WASD lot, Shift dopalacz, spacja hipercruise, C cisza, F ostrzał, X impuls, H kadłub
(Atlas / fregata zwiadu), G dron do kursora, T „prawda” (wszystkie radary, także nieznane), Z kadr taktyczny / CIC.
Zrzuty: `node scripts/webgpu/radar-zasiegi-demo.mjs` → `.tmp/radar-zasiegi/`.

Wspólne dla wszystkich: pokazujemy tylko radary, o których gracz WIE (kontakt, duch przez 25 s, odkryta stacja); radar
zidentyfikowany ma prawdziwą moc, kontakt — moc zgadniętą z rozmiaru (MAŁY 18 km … OGROMNY 60 km), rysowaną inaczej
(kreski / „~” w podpisie). Strefy wroga liczą się dla OBECNEJ sygnatury gracza — cisza, ciąg i pas asteroid od razu je
zmieniają. Kontakty: zidentyfikowane — symbole NTDS z kodem klasy, niepewne — kwadrat w kole niepewności „?? DUŻY”,
duchy — „?”; bliskie na ekranie łączą się w jeden znacznik „×N”.

1. **KONTUR** (najbliżej Starsectora) — suma radarów wroga jako jeden obrys z lekkim wypełnieniem, podpis na skupisko
   („~3 RADARY · 78 km”), własne czujniki (cel BB) i wzrok cienkimi cyjanowymi liniami, wokół okrętu żółty pierścień
   WYKRYWALNOŚCI (z jakiej odległości widzi cię pancernik), pod okrętem „DO STREFY 5,4 km” / „W ZASIĘGU ×2”.
2. **STREFY** — mapa zagrożenia: im więcej radarów zachodzi na siebie, tym mocniejsza czerwień, brzeg świeci od środka;
   w strefie czerwona winieta i napis „WYKRYTY · 2 RADARY / WYJŚCIE ZE STREFY 6 km”.
3. **IZOLINIE** — trzy brzegi stref wroga: przy obecnej sygnaturze (ciągły), w ciszy (żółte kreski) i na pełnym ciągu
   (kropki) + słupki sygnatury przy okręcie; własne czujniki jako izolinie dla celu FF / BB / SC. Pokazuje, którędy
   przemknąć w ciszy (w scenie: luka między czatą a flotą).
4. **HUD BOJOWY** — bez plam: tylko brzeg stref blisko okrętu (gaśnie z odległością, kreski do środka strefy), pierścień
   wokół okrętu z namiarami radarów, które cię mają (jak RWR), grot do najbliższej krawędzi z odległością („STREFA 3,7 km”,
   w strefie „WYKRYTY ×1 · WYJŚCIE 10,4 km”), znacznik na brzegu ekranu, gdy krawędź jest poza kadrem.
5. **MGŁA RADAROWA** — zasięg wpisany w mgłę wojny: poza czujnikami ciemno i chmury, w zasięgu kontaktu półmrok,
   w zasięgu wzroku jasno; strefy wroga barwią mgłę na czerwono, brzeg z poszarpanym rytmem. Wariant pod post „uber”
   (`src/3d/fog/`) — w grze byłby w shaderze, nie na kanwie.

Propozycje można łączyć (np. 1 albo 5 na mapie CIC, 4 w widoku bojowym).

## 4b. Prototyp w grze (`?radarZasiegi`, 2026-11-04)

- Start: gra swobodna z adresem `index.html?radarZasiegi=scena` (scena sama po sekundzie) albo `?radarZasiegi` + konsola
  `RadarZasiegi.scena()` (z `?dev` także `DevScene.radar()`). Scena: pusta przestrzeń, Atlas z eskortą, czata piratów
  30 km na wschód (dwie fregaty, odsłonięte jak po zwiadzie — ich zasięg 23,4 km kończy się 6,7 km przed Atlasem), dalej
  radar Corvus i flota (KONTAKT — miejsce przybliżone, moc zgadnięta). Piraci uśpieni (bez walki). Kamera floty
  (G — powrót do lotu, wtedy WASD lata). `RadarZasiegi.cisza()` — cicha praca (sygnatura × 0,5): zasięg czaty względem Atlasa maleje.
  `RadarZasiegi.stan()` — liczby, `RadarZasiegi.stop()` — sprzątanie.
- W świecie (nakładka 2D nad obrazem 3D): ocena obustronna (trzy wyglądy niżej, klawisz `]`), narożniki i trójkąty okrętów
  (trójkąt, gdy kadłub mały), kontakty „?” w kole niepewności, ślad kropek za graczem, „STREFA 6,7 km” / „WYKRYTY ×2”.
- Ocena obustronna (użytkownik, 2026-11-04): „mój zasięg względem nich oraz ich zasięg względem mnie, żeby obustronnie można
  było ocenić”; „wachlarz ode mnie i OD przeciwnika, przeciwnik też ma swój, a nie że ja mam dwa”; „łuk, który zaczyna
  wibrować, coś à la linia serca na aparacie, tylko bardziej płynna — drgająca struna, tym mocniej, im bliżej wykrycia przez
  przeciwnika jesteś”. Propozycje na tych samych danych (`P.threats`: `them`, `me`, grupy po miejscu):
  - WACHLARZ — jeden na okręt: niebieski przy mnie ku wrogowi, czerwony przy wrogu ku mnie; pełny z grotem = sięga.
  - STRUNA — łuk przy mnie ku wrogowi; spokojny daleko, drga coraz mocniej przy progu, po sięgnięciu pęka.
  - BŁONA — zamknięta krzywa wokół mnie: promień z mojego śladu, wybrzuszenia ku grupom rosną z ich zasięgiem, sięgnięcie rozrywa.
  Wersje na shaderach WebGPU tych trzech robi sesja kontaktów w `dema/kontakty-czujnikow.html` (gałąź
  `claude/sad-gates-e62aae`); tutaj nakładka 2D na prawdziwych danych — do oceny w locie.
- Odrzucone: fale lecące ciągle ku wrogom i ku graczowi (nadają się na umiejętność „impuls czujników” — wysyłasz falę, ona
  sprawdza, co jest po drodze; kod zostaje) oraz dwie połówki wachlarza przy okręcie gracza z wariantami PULS / FALA / ISKRY.
- W CIC (Tab / M): warstwa ZASIĘGI (Z) — strefy wroga konturem (pewne / szacowane), podpis „~8 RADARÓW · 58,5 km”, ocena obustronna,
  własne czujniki, panel ZASIĘGI RADARÓW (sygnatura, wykrycie, krawędź, liczby).
- Zrzuty: `node scripts/webgpu/radar-zasiegi-gra.mjs` → `.tmp/radar-zasiegi/gra/`. Koszt: rysunek ~0,1–0,15 ms na klatkę,
  przebudowa obrazu ~0,035 ms co 0,2 s, pipeline'y synchroniczne 0.
- Uwaga do liczb: niszczyciele i pancerniki z wezwań mają w tabeli wykrywalności sygnaturę kapitałowca (1,3), fregaty
  z belkowym promieniem 1,0 — tak dziś liczy też AI (decyzja 6).

## 5. Decyzje dla użytkownika (lista „na strzała”)

1. Wygląd oceny obustronnej: WACHLARZ / STRUNA / BŁONA (albo połączenie) — osobno dla kadru bojowego i dla mapy CIC. Rozstrzygnięte: nieznany kontakt = OBŁOK, skały = ECHO (`docs/PLAN-kontakt-czujnikow.md`).
2. Czy gracz wie, że jest wykryty przez radar, którego sam nie widzi (ostrzeżenie typu RWR), czy tylko przez znane radary.
3. Cicha praca jako nowa umiejętność (klawisz, limit prędkości ~60%, broń / tarcze zgaszone?) — czy w ogóle.
4. Model dla AI: czy AI dostaje te same mnożniki (ciąg, ostrzał, cisza, pas) — wtedy zasadzki w pasie działają w obie
   strony, a dzisiejszy balans wykrywania się zmienia (dziś AI widzi kołem pasywnym × klasa).
5. Kontakty poza wzrokiem: czy gracz widzi je w świecie (niepewne kwadraty jak w demie) — dziś mgła chowa wszystko poza
   wzrokiem, a sygnatury masy stawia tylko fabuła (skaner masy „do zrobienia” — to byłby on).
6. Liczby: mnożniki stanu (§ 2) i zgadywana moc radaru z rozmiaru kontaktu.

## 6. Etap 2 — wpięcie w grę (po decyzjach)

- **Stan czujnikowy bytów**: `createSensorState` na graczu i NPC; zapis z gry — ciąg (`mainEngineFraction`), napęd
  (dopalacz / hipercruise / warp z `driveModes`), strzał (`fireWeaponCore`, rakiety → `noteSensorFire`), impuls X
  (→ `noteSensorPing`), cisza (nowa akcja w `INPUT_ACTIONS` + `GameActions`), wrak; `stepSensorState` w kroku czujników.
- **AI** (`fleetAwareness.js`): `detectedBy` → `detectionRange(sensorStrength(…), entitySignature(…), osłona)`; w stanie
  neutralnym bez zmian — `szyk-floty.mjs` bit w bit przed włączeniem mnożników.
- **Strona gracza** (`SensorSystem`): poziom KONTAKT poza wzrokiem → kanał sygnatur masy / nowa lista kontaktów dla
  radaru kokpitu (`radarFeed.collect`), CIC i znaczników krawędzi; `hides(byt)` zostaje testem IDENTYFIKACJI.
- **UI**: warstwa nakładek 2D (strona gry, nie moduł renderu — szew render ↔ gra nie rośnie), suma kół przeliczana
  ~4 Hz (jak obraz sytuacji AI), łuki w pamięci kadru; CIC — warstwa jak pasy asteroid; wariant 5 — rozszerzenie postu
  mgły (koła stref wroga w bloku uniformów, ≤ 24 jak koła wzroku).
- **Osłona terenu**: gęstość pola pasa (`sampleMacro`), gaz przestrzeni, cień planety (opcjonalnie — przecięcie odcinka
  z tarczą ciała).
