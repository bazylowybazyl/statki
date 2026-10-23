# Demo warpa „Pęd” (2026-10-19)

`dema/warp-ped.html` (+ `dema/warp-ped.js`). Porównanie stylów skoku Atlasa i wyjścia z warpa — na PRAWDZIWYCH
modułach gry, bez kopii (inaczej niż `dema/warp-webgpu`, którego port do gry kosztował zadanie 22 i kilka rund
„w demie było inaczej”).

Skąd: user 2026-10-19 — „przekombinowałem z zawijanym efektem warp, nie podoba mi się; myślę, czy nie wrócić do
soczewki, lub zrobić po prostu dużą prędkość”. Analiza (rozmowa 2026-10-19, pamięć `warp-rulon.md`,
`warp-exit-momentum.md`): z góry prędkość czyta się z MIJANIA (smugi, paralaksa, planety w soczewce świata), rulon
zamienia mijanie na gięcie, rozlewa planety w klepsydry, działa tylko dla kamery gracza i siedzi hakiem w każdym
materiale. Propozycja: „Pęd” — prędkość jako rdzeń, soczewka najwyżej jako akcent na przejściach.

Start: `npm run dev` → `/dema/warp-ped.html`. Adres: `?styl=rulon|ped|akcent|soczewka`, `?trasa=jowisz|mars`,
`?ped=0` (wyjście do zatrzymania) albo `?ped=1..6` (k), `?kamera=up|right|off`, `?zoomSkoku=gracz` (dawny zoom skoku),
`?smugi=slad|klin` (wygląd smug skał pasa),
`?clean=1` (bez paneli), `?test=1` (klatki tylko z `__warpPed.runFrames` / `until` — harness).

## Co pokazuje

Podróż w pętli: Atlas stoi nad terminatorem Ziemi → ładowanie (0,8 s jak w grze) → skok z prędkością przelotową
z `planWarpCruise` (Ziemia → Jowisz ~10,9 s, Mars mijany ~75 tys. j. od kursu — statek zwalnia do 15%, planeta
przelatuje w soczewce świata) → wyjście (rampa: zwolnienie, wlot, hamowanie) → ślizg → od nowa.

| Klawisz | Styl skoku (`warpDrive.js`: `setWarpStyle`) | Co widać |
|---|---|---|
| 1 | `rulon` — dziś w grze | świat zwija się w walec i lejek do statku |
| 2 | `ped` — sama prędkość | nic się nie gnie: smugi gwiazd, ośrodek „Nurtu”, planety mijają, kop kamery |
| 3 | `akcent` — prędkość + akcenty | soczewka tylko na przejściach: NACIĄG (implozja 1,6 L przed dziobem w ładowaniu), PĘKNIĘCIE (fala z punktu skoku, statek przez nią przelatuje), SPRĘŻENIE (fala przed dziobem przy wyjściu, razem z frontem gwiazd) |
| 4 | `soczewka` — soczewka bańki | pierścień refrakcji na elipsie bańki przez cały skok (przód najmocniej, boki słabiej, tył prawie wcale); kadłub w elipsie bez zmian |

Inne: **K** — kamera w skoku (obrót kursem w górę / w prawo / bez obrotu — niżej), **Z** — zoom skoku stały / × zoom
gracza (niżej, „Skaczące planety”), **B** — wygląd smug skał pasa (ślad światła / klin — niżej, „Runda 2026-10-23”),
**P** — wyjście z pędem / do zatrzymania (suwak k: rampa hamuje do k × 500 j/s, potem zwykły lot zbiera
nadmiar hamowaniem 200 j/s² — przy k = 3 ślizg ~5 km / 5 s), **J / M** — trasa, **F** — lot swobodny (W/S ciąg,
A/D obrót, Shift dopalacz, CapsLock / 9 warp, drugi raz — wyjście), **spacja** — skok od nowa, **Esc** — pauza,
**T** — ×0,25, **H** — bez paneli, kółko — zoom gracza (kop i oddalenie warpa działają względem niego).

## Kamera w skoku — obrót kadru kursem w górę (2026-10-19)

User: „obracajmy kamerę na czas warpu w kierunku lotu — możemy wtedy lepiej bawić się tym, co jest przed nami”.
Od startu ładowania do chwili po zatrzymaniu (`warpRollHold` 0,5 s) kadr obraca się tak, że kurs wskazuje GÓRĘ ekranu
(klawisz **K**: kurs w górę / kurs w prawo — wzdłuż dłuższego boku kadru / bez obrotu; `?kamera=up|right|off`),
potem wraca do północy. Sprężyna krytyczna kąta (`warpRollOmega` 3,2/s — 90° w ~1 s), najkrótszą drogą, w czasie gry
(`stepCameraRigRoll` w `cameraRig.js`). Rig liczy wyprzedzenie i kop w osiach EKRANU: demo obraca prędkość i kurs
o −roll, a offset kamery i wstrząs o +roll — przy kursie w górę statek siedzi w dolnej części kadru, przed dziobem
jest miejsce na to, co nadlatuje (planety w soczewce świata, cel).

Obrót jest w modułach gry (`cam.roll`, konwencja `src/3d/viewRoll.js`: ekran = R(−roll)·(świat − kamera)): Core3D
obraca kamery three (`rotation.z = −roll`, `up` kamery perspektywy), maska słońca liczy świat piksela z obrotem
(`uViewRot`), gorące powietrze dysz, źródła zniekształceń (`commit(…, roll)`), kadr efektów (`rolledHalfExtents`),
ośrodek warpa (pudła i odcinanie z pudła obróconego kadru), soczewka mgławicy, smugi gwiazd, rulon, soczewka świata
(liczy w osiach ekranu, `lensToWorld` w `planet3d.assets.js` rozstawia z powrotem) i culling planet. Bez obrotu (0) —
obliczenia bit w bit jak dawniej. Pas asteroid (okno pola) i ringi „Halo” (kamera ringu, pudło kadru) liczą z obrotem
od 2026-10-19. W GRZE kamera się jeszcze nie obraca: brakuje obrotu w HUD (`View3D` worldToScreen / screenToWorld,
nakładki 2D), w migawce workera (pole kamery), w rigu `index.html` i w modułach z własnym cullingiem CPU (stacje,
pył) — port po decyzji usera.

## Skaczące planety i zoom skoku (2026-10-19)

User: „mijane planety lubią dziwnie skakać; planeta docelowa pokazuje się na chwilę, potem jej nie widać i znowu
wskakuje — na przybliżonej kamerze największe skoki, na oddalonej w miarę OK; może ujednolicić kamerę na czas warpa”.
Pomiar klatka po klatce (`node scripts/webgpu/warp-ped-skoki.mjs`, raporty `.tmp/warp-ped/skoki-*`):

- **Przyczyna skoków — bramka ringu soczewki** (`_lensPrepare` w `planet3d.assets.js`): planeta z ringiem „Halo”
  wraca z soczewki na prawdziwe miejsce, gdy jej prawdziwy ring (+ port K-7) wchodzi w kadr — zamykanie natychmiast.
  Przy przelocie obok Marsa (75 tys. j. od kursu, ring ~61 tys.) i przy dolocie do Jowisza ring dochodził do kadru,
  a planeta w 2–3 klatkach leciała na prawdziwe miejsce za kadrem: szarpnięcie ~300 px przy zoomie skoku 0,03,
  ~2 tys. przy 0,11, ~10–30 tys. px przy 0,33–0,66 (prawdziwe miejsce jest dalej w px) — stąd „gorzej przy zbliżeniu”.
  Obrót kadru bez związku (to samo z `K` = bez obrotu). Teraz bramka raz otwarta w skoku zostaje otwarta
  (`gateOpenSession`): ring decyduje tylko o WEJŚCIU planety w soczewkę (planeta startu przy swoim ringu), z soczewki
  ciało schodzi z β. Mars po poprawce: najwyżej 1–2 px szarpnięcia przy każdym zoomie.
- **Cel znikał przy przylocie z pędem**: β wyjścia opada z czasem rampy (do zatrzymania na rampie), a statek z pędem
  ślizga się jeszcze ~5 km — cel jechał na prawdziwe miejsce za krawędzią kadru (Jowisz ~7,6 tys. j. dalej) i wracał,
  gdy ślizg go przybliżył. Teraz przy wyjściu cel trzyma się krawędzi kadru (obraz z pełnej soczewki), póki statek się
  zbliża, a prawdziwy obraz jest dalej (`WarpWorldLens._arrivalHold`, `worldLens.js`); dogonienie — przejście miękkim
  kolanem (bliski brzeg tarczy jedzie jak prawdziwy, tarcza rośnie z obrazu soczewki do prawdziwej — planeta staje się
  horyzontem); statek stanął przed dogonieniem — puszczenie w 0,8 s; cięcie (teleport, nowa podróż) — od razu.
  Sterownik trzyma soczewkę po wyjściu, póki trzyma cel (`WARP_WORLD_LENS.targetHold`, `_commitWorldLens`). Wynik:
  cel w kadrze przez cały przylot (381/381 klatek) przy każdym zoomie gracza i obu trasach.
- **Ujednolicony zoom skoku** (klawisz **Z**, domyślnie stały): od ładowania do końca ślizgu kadr liczy się od
  domyślnego zoomu statku (`stepCameraRigWarp`: `zoomRef` = `defaultShipZoom`, `zoomBase` = zoom gracza; `arriving` —
  ślizg z pędem), nie od zoomu gracza — soczewka, kop i przylot wyglądają zawsze jak przy zoomie domyślnym (w skoku
  0,098 przy 1600 px), potem powrót do zoomu gracza (easeOut³, 1,4 s). Z zoomem gracza 0,9 bez ujednolicenia (`Z`):
  kadłub zasłania pół kadru, a cel jest w kadrze 74–105 z 381 klatek przylotu. Arkusze: `.tmp/warp-ped/arkusz-zoom09-staly.jpg`
  / `-gracz.jpg`.

- **Kadr przylotu** (user po pierwszej wersji: „przelot nad planetami OK; dolot przy zoomie stałym źle — statek
  najpierw hamuje, a planeta powiększa się potem, opóźniona; przy zoomie gracza z maksymalnym oddaleniem OK”): przy
  stałym zoomie (0,1–0,18) prawdziwy Jowisz wchodził w kadr dopiero pod koniec ślizgu, a trzymanie przy krawędzi
  czekało na niego — planeta rosła ~3 s po hamowaniu. Teraz od wyjścia zoom skoku nie jest większy niż kadr przylotu:
  bliski brzeg prawdziwej tarczy celu na 0,75 drogi od statku do krawędzi kadru przed dziobem (`stepCameraRigWarp`:
  `arrivalDist` — odległość od brzegu tarczy, `viewW/H`; `warpArrivalFill`, sprężyna logarytmu zoomu: odsuwanie
  ω = 3, dosuwanie za dolotem 3× szybciej). Kamera odsuwa się w zwolnieniu (zoom 0,097 → 0,027 — statek ~45 px),
  a trzymanie celu w soczewce puszcza, gdy brzeg prawdziwej tarczy jest w kadrze (krawędź − kolano), nie dopiero przy
  obrazie z soczewki. Przebieg (Jowisz): zwolnienie — cel z soczewki rośnie 80 → 164 px; wlot i hamowanie (16,2 →
  1,5 tys. j/s) — prawdziwa planeta przejmuje i rośnie do ~1000 px; ślizg — kamera dosuwa się z dolotem (0,038 →
  0,174), planeta rośnie do horyzontu. Cel w kadrze 381/381 klatek na obu trasach. Arkusz:
  `.tmp/warp-ped/arkusz-przylot-staly.jpg`.

- **Cel bez obrotu** (user: „przy wejściu i gwałtownym powiększeniu planeta się obraca — powinna być taka sama, jak
  mi się pokazała”): cel dostawał w soczewce obrót przelotu (wirtualna kamera nad statkiem, przy przylocie ~30–45°,
  słońce obrócone z bryłą) i ustawienie tarczy pasami do statku — oba × udział soczewki, więc przy wejściu wracały do
  orientacji gry. Teraz cel i jego księżyce nie mają obrotu przelotu (światło z prawdziwego słońca), a ustawienie
  tarczy przy przylocie zostaje i po skoku jest własną orientacją planety (`_lensFace`). Pomiar (`warp-ped-skoki.mjs`,
  orientacja bryły klatka po klatce): obrót celu przez cały przylot = sama doba planety (0,019°/klatkę, 7,3° w 6,3 s),
  kierunek słońca na bryle 0°. Arkusz: `.tmp/warp-ped/arkusz-przylot-bez-obrotu.jpg` (pasy Jowisza poziomo od
  pokazania do horyzontu).

W grze (wspólne moduły): bramka, trzymanie celu i cel bez obrotu działają też w grze; ujednolicony zoom i kadr
przylotu — tylko w demie (`updateCameraWarpKick` nie podaje `zoomRef` ani `arrivalDist`) — port po decyzji usera razem z resztą warpa.

## Reszta świata w skoku: ringi i pas (2026-10-19)

User: „no dobrze, a co z resztą świata? asteroidy, ringi”. Wybór: ring w soczewce z planetą, pas jako smugi skał.
Demo ma teraz ringi trzech planet (`HaloRingWorld` + `HaloRingGame`, jak gra) i pas asteroid (`createBeltWorld` +
`createAsteroidBelt`, `beltWorld.frame` i `prepareFrame` co klatkę); trasa Ziemia → Jowisz mija Marsa z ringiem i
przecina NEA, Hungarie i pas główny.

- **Ring w soczewce z planetą**: dawniej planeta w soczewce stała w kadrze skoku, a jej ring zostawał na prawdziwym
  miejscu (setki tys. j. dalej) — przy przelocie obok Marsa w kadrze był sam glob, przy przylocie ring dochodził
  osobno. Teraz `_lensPlace` planety z ringiem publikuje slot `WARP_RING_LENS` (środek obrazu, skala obrazu do
  prawdziwej, obrót przelotu, udział prawdziwego widoku), a `HaloRingGame` stawia grupę ringu w obrazie planety
  (pozycja, skala, obrót przelotu przed kątem portu). LOD i odcinanie części ring liczy z macierzy grupy — bez zmian
  w ringu. Cień ringu w masce słońca gaśnie w soczewce jak tarcza planety (siła okluderu = udział prawdziwego widoku).
  Kolizje i port zostają na prawdziwym miejscu.
- **Pas jako smugi skał**: prawdziwe pole przy prędkości warpa nie nadążało — 7,8–9 ms CPU pasa na klatkę (komórki
  doczytywane wokół kamery), w kadrze kilka migających skał, a maska zacienienia pola ze starego okna czerniła kadłub.
  W skoku (gwiazdy w smugach i kamera naprawdę leci) pas wyłącza pole i rysuje pulę 360 skał banku w przestrzeni
  widocznej warpa (`src/3d/asteroids/warpDebris.js`): pod płaszczyzną gry z paralaksą, płyną z prędkością kamery
  gwiazd, każda rozciągnięta w smugę (wariant materiału skał `smear`). Gęstość z pola pasa w punkcie kamery: sam pas
  ~35% puli (pas widać zawsze), pola rodzin do pełnej; wlot szybki, wylot ~0,8 s. Pomiar: CPU pasa w skoku ~0,06 ms;
  ~31 smug w NEA, ~175 w pasie głównym, po wylocie gasną.
- **Przy okazji**: okno pola pasa liczone bez obrotu kadru dawało przy kursie w górę czarny prostokąt (pole NEA
  urwane przy brzegu kadru) — teraz `rolledHalfExtents`; kamera i pudło kadru ringów też z obrotem. Statek startuje
  i kończy podróż przed zewnętrzną krawędzią ringu (`bodyStopRadius`; ring to w grze przeszkoda) — liczone od tarczy
  (2,6 tys. j.) wypadały po wewnętrznej stronie ringu. W harnessie CDP demo robi 8 klatek gry na jeden krok `Core3D.fx` — `prepareFrame` pasa sumuje
  dt (inaczej smugi wypełniały się 8× wolniej).
- Arkusz całej trasy: `.tmp/warp-ped/arkusz-calosc.jpg` (0 błędów konsoli). W grze ring w soczewce i smugi działają
  tak samo (wspólne moduły); podróż TRAVEL TO w obu trybach renderu bez błędów, 0 pipeline'ów kompilowanych
  w klatkach gry (materiał smug rozgrzewa się z passem tła pasa).

## Runda poprawek 2026-10-23

Zgłoszenie usera: „1. przebija się planeta przez statek; 2. asteroidy, przez które się przelatuje, słabo się
rozciągają — potrzebny lepszy wygląd; 3. przelot nad planetami ma wyglądać podobnie do dotarcia do celu: planeta
z daleka, powiększa się powoli, pod statkiem duża, potem ucieka za statek — obecnie się po prostu pojawia;
4. przylot staje »podwójnie«: jeden wybuch haze i drugi wybuch heat; 5. dopracować efekt lotu”. Arkusze:
`.tmp/warp-ped/r1023/` w worktree `warp-ped-poprawki` (narzędzia sesji — trwała sonda CDP, A/B passów odczytem
pikseli kanwy, wycinki wokół statku).

1. **Ring na statku** — A/B passów odczytem pikseli (maska kadłuba z samego passa ortho, różnica obrazu bez
   danego passa): kadłub przykrywał pass FG (warstwa 2, rysowany PO ortho) — górna ściana i moduły ringu Marsa,
   który jedzie w soczewce z planetą. Planeta (warstwa 6, przed ortho) kadłuba nie zasłania. Teraz ring w soczewce
   przekłada części FG na warstwę tła (`HALO_GAME.lensLayers`, `haloRingGame.js`) — jest tłem jak jego planeta;
   po soczewce zwykłe warstwy (FG nad statkiem w hali). Ta sama kamera perspektywy — 0 nowych pipeline'ów. Po
   poprawce pass FG zmienia w kadrze przelotu tylko lampy samego kadłuba (było ~9 tys. px ringu, w tym moduł na
   burcie).
2. **Smugi skał** — dawniej kapsuła: tylna półkula przesunięta o krótki wektor (długość × 1), tekstura tyłu
   rozciągnięta, ogon kryjący 1 → 0,3 — „rozmazany kamyk”. Teraz wariant `smear` materiału skał: tylna półkula
   ściągnięta do `taper` promienia (klin), głowa pełna, ogon od krycia `tail` gaśnie do zera, w ogonie tekstury
   kształtu z wyższego mipa (rozmycie wzdłuż ruchu), normalna ogona ku słońcu, jaśniejsza skała; skały do 800 j.
   Wyglądy (`WARP_DEBRIS_LOOKS`, uniformy — bez nowych pipeline'ów): **ślad światła** (domyślny — długość × 3,4,
   cienki ogon od oświetlonej strony) i **klin** (× 1,6, wyraźna oświetlona skała u czoła); klawisz **B**. Przy
   okazji: grupa smug była schowana w rozgrzewce passów pasa — pierwszy przelot przez pas kompilował
   `AsteroidBelt:rocksSmear` synchronicznie (zmierzone hakiem `createRenderPipeline`); teraz 0.
3. **Przelot z daleka** — pomiar klatka po klatce (obraz Marsa w soczewce): mijane ciało leżało liniowo (S ·
   odległość) — Mars wchodził górną krawędzią 4,3 s po skoku z promieniem ~38 px i w 1,5 s rósł do 150 px. Teraz
   mijane ciało przed dziobem ma perspektywę z punktem zbiegu na kursie (`approachEdge` 0,8 drogi od statku do
   krawędzi kadru, `worldLens.js`: k = A0 / (a + A0), A0 = E / S — w trawersie obraz jak dawniej, za rufą bez
   zmian), przy wejściu w soczewkę wyrasta w miejscu (wielkość × β). Po: Mars w kadrze od 0,2 s skoku (4 px), rośnie
   przez ~5,6 s do 150 px w trawersie, ucieka za rufę jak dotąd. Ciała daleko od kursu i cel — bez perspektywy.
   W rulonie tarcza z daleka siedzi u góry walca, w lejku rozlewa się jak dotąd. Arkusze `arkusz-przelot.jpg`,
   `arkusz-przelot-rulon.jpg`.
4. **Przylot = jedno zdarzenie** — wycinki wokół statku co 0,05 s: przy hamowaniu błysk + fala refrakcji
   („haze”), a żar brzegu kadłuba (zanik τ 2,2 s) wyłaniał się 0,6–1,5 s później, gdy kadr przylotu dosuwał kamerę
   („heat”); styl `akcent` dokładał SPRĘŻENIE na starcie wyjścia (1,15 s przed hamowaniem). Teraz
   (`WARP_ARRIVAL_ACCENT`, `player.js`) wszystko w chwili zatrzymania: w `akcent` SPRĘŻENIE zastępuje falę hamowania
   (jedna fala), błysk, blask, iskry, wstrząs, żar kadłuba jako impuls τ 0,45 s. Hipercruise — dawny żar.
   Arkusze `kl/prz-ham-arkusz.jpg` (przed), `kl/prz-ham-po-arkusz.jpg` (po).
5. **Lot** — obrót kadru kursem w górę (sprężyna 3,2/s) przy kursie ~150° miał w chwili skoku jeszcze ~40° do
   zrobienia i kręcił się przez pierwszą sekundę lotu (kop, pęknięcie, wybuch smug gwiazd w obracającym się
   kadrze); w demie `warpRollOmega` 5/s — przy skoku zostaje 12°, kadr stoi ~0,4 s po kopie (domyślne strojenie
   riga bez zmian — obrót w grze niewpięty). Sprawdzone i odrzucone: mocniejsze wzbudzenie ośrodka w równym locie
   (`excite` bańki 1 → 1,5) — na obrazie bez różnicy. Smugi skał (2) i przelot z daleka (3) to główne nowe
   wskazówki prędkości w locie.

Koszt (headless 1600 × 900, RTX 5080, dwa przebiegi trasy Jowisz, średnio na fazę; równolegle szły harnessy dwóch
innych sesji — CPU zaszumione): przed rundą (`main` 99a30b09) lot GPU 0,89 ms / CPU 1,3 ms / 40 rysunków, przelot
1,34 / 4,5 / 95, pas 1,0 / 1,9 / 61, wyjście 1,1 / 2,7 / 73. Po: lot 0,9–1,0 / 2,1–2,7 / 49–56 (mijany Mars jest
w kadrze od początku skoku — tarcza z atmosferą; jego ring „Halo” w soczewce rysuje się dopiero od 30 px promienia,
`HALO_GAME.lensMinPx`: bez progu ring kosztował ~3 ms CPU aktualizacji i ~50 rysunków przez cały lot — 82 rysunki,
CPU ~5,6 ms), przelot 1,2–1,4 / 5–6 / 94, pas 1,0 / 1,9–2,7 / 48–58, wyjście 1,1–1,3 / 4,1–4,5 / 73. Pipeline'y
kompilowane synchronicznie w skoku: przed — `AsteroidBelt:rocksSmear` (+ dwa `WarpPlume`), po — tylko dwa
`WarpPlume` / `WarpPlumeParticles` (plazma WARP na dyszach, `warpPlume3D.js` — obszar sesji hipercruise'u, do sprawdzenia
tam). Gra (TRAVEL TO,
`travel-gra.mjs`): podróż do celu (błąd 10 j.), wezwanie i POWRÓT bez błędów konsoli.

## Z czego jest zbudowane (wszystko z gry)

- `Core3D` + `hexShips3D` (Atlas na belkach — `dema/mostki-webgpu/swiat.js`, jak demo dronów naprawczych),
- planety, mgławica, gwiazdy i soczewka świata — `planet3d.assets.js` (`initPlanets3D` / `updatePlanets3D`), układ
  z `buildSystemMap` (te same promienie i odległości co gra; kąty ustawione pod trasę),
- warp „Nurt” — `WarpNurt` (`src/3d/warp/`): ośrodek, bańka, smugi gwiazd, fale, plazma z dysz (dysze czytają
  `window.warp` jak w grze),
- kamera — rig gry (`stepCameraRigWarp` + `stepCameraRig`: kop, oddalenie, wyprzedzenie, wstrząs),
- automat skoku — jak `physicsStep` w `index.html` (ładowanie, `engageWarp` z planem prędkości, zwolnienie przy
  ciałach `warpFlybyFactor`, wyjście, gdy do końca zostaje `warpExitRampDistance`, rampa `createWarpExitRamp`).

Demo ma tylko: automat podróży (pętla, koniec skoku przed tarczą celu z poprawką na drogę ślizgu), lot swobodny,
panel i HUD. Gra nie ma tu nic własnego dema — po wyborze stylu nie ma portu.

## W grze dziś (bez decyzji usera nic się nie zmienia)

- Styl skoku z adresu: `?warp=ped|akcent|soczewka|rulon`, `?rulon=0` = `ped` (`warpStyle(RenderWorld.pageSearch)` —
  działa też w workerze renderu). Bez parametru — `rulon`, jak dotąd. Kamera bez rulonu trzyma zwykłe wyprzedzenie
  (`stepCameraRigWarp`: `input.rulon`).
- Rampa wyjścia ma `vEnd` (`createWarpExitRamp`, `sampleWarpExitRamp`, `warpExitRampDistance`) — gra podaje 0
  (statek staje jak dotąd); gałąź rampy w `physicsStep` po zakończeniu zostawia prędkość z rampy (= vEnd).
- Soczewka bańki = nowy typ źródła zniekształceń `DISTORT.BUBBLE` (`src/3d/fx/distortion.js`: `bubble(...)`, TSL
  i lustro CPU), akcenty i soczewka — `player.js` (`WARP_ACCENT`, `WARP_LENS_BUBBLE`), fale z rodzajem w `frame.js`
  (`addImplode`, `addBubbleLens`).

## Po decyzji usera (do zrobienia)

1. Domyślny styl w `warpStyle` (dziś `'rulon'`).
2. Jeśli rulon odpada: `rulon.js`, hak `installRulonGlobal`, culling, horyzont w poście, kopuła i rozprysk ośrodka,
   środek lejka w rigu kamery, `rulonBoostCpu` w soczewce świata — z 15 plików (lista: `grep -rln "RULON\|rulonBend\|
   rulonBoost\|warpRulonBend" src`). Zysk: w skoku ~2× mniej rysunków, budowa materiałów bez funkcji rulonu.
3. Wyjście gracza z pędem: `exitWarp` w `index.html` podaje `vEnd` (k × prędkość bojowa), TRAVEL TO liczy wyjście z
   `warpExitRampDistance(v, L, vEnd)` i wlicza ślizg w koniec odcinka. Przyloty NPC z pędem i scena „Wojna” —
   osobna sesja (gałąź `scena-wojna`).

## Cień kadłuba w skoku (poprawione w grze i w demie)

Smuga cienia kadłuba na tle (kanał G maski słońca — „długa smuga cienia”, z założenia) w skoku jechała za statkiem jak
ciemny prostokąt na całą długość kadłuba, gdy słońce świeciło z boku kursu (kadłub burtą do słońca); przy kursie od
słońca cień jest wąski i chowa się za rufą — dlatego w jednym przebiegu gry go nie było. A/B w demie:
`Core3D.perfToggles.shadowShafts = false` — znika. Teraz cień kadłuba GRACZA gaśnie w skoku: `WARP_HULL_SHADOW`
(`player.js`: ładowanie gasi, lot 0, po zatrzymaniu wraca) mnoży siłę jego okluderu w `hexShips3D.js`
(`packHullShaftOccluder(…, strength)`). Dawna soczewka (2026-09) robiła to samo (`suppressShadowShafts`, usunięte
w zadaniu 22).

## Narzędzia

- `node scripts/webgpu/warp-ped-demo.mjs [--style ped,akcent] [--ped 3|0] [--trasa jowisz|mars] [--fazy …] [--wolny 1]`
  — zrzuty faz (ładowanie, skok, lot, przelot, wyjście, hamowanie, po) dla każdego stylu, `raport.json` (prędkość,
  plan, zwolnienie, ośrodek, GPU), błędy konsoli.
- `node scripts/webgpu/travel-gra.mjs --query rulon=0` (także `renderWorker=1`) — podróż TRAVEL TO w prawdziwej grze.
- Pomiar (RTX 5080, headless 1600 × 900): GPU ~0,9–1,3 ms, CPU ~1 ms na klatkę, ~38 rysunków; 0 błędów konsoli.
