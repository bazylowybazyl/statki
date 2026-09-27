# Demo WebGPU: nowe efekty rakiet i rakiety specjalnej

`dema/rakiety-webgpu.html` (+ `dema/rakiety-webgpu.js`, moduły w `dema/rakiety-webgpu/`).
Rakieta manewrująca (`missile_rack`), szybka (`fast_missile_rack`) i specjalna Supernowa
(`supernova_missile`) na `WebGPURenderer` + TSL. Lot z logiki gry, efekty zrobione od nowa —
tak, jak pozwala WebGPU (compute, bufory storage, setki świateł). Gra, `Core3D` i inne dema
bez zmian. Start: `npm run dev` → `/dema/rakiety-webgpu.html`.

Parametry adresu: `?scenario=salwa|szybkie|supernowa|deszcz|zblizenie|novaZoom|poscig`,
`&loop=0` (bez pętli pokazu), `&zoom=1.5`, `&shot=1` (bez paneli).

## Scenariusze pokazu (klawisze 1–7, pętla — L)

| # | Scenariusz | Co pokazuje |
|---|---|---|
| 1 | Salwa | 12 rakiet manewrujących w trzy okręty: smugi oświetlone dyszami, samocień chmur, trafienia |
| 2 | Szybkie rakiety | rój na fregaty w unikach (wyprzedzenie celu jak w grze) |
| 3 | Supernowa | kamera za rakietą specjalną, potem odjazd na pozostałość |
| 4 | Deszcz rakiet | 96 rakiet w trybie „łuki kinowe” (skręt 240°/s, rozrzut 70° — NIE gameplay) |
| 5 | Zbliżenie trafienia | ×0,3: kontakt z poszyciem, kula ognia, odłamki, przypalenie |
| 6 | Supernowa z bliska | ×0,4: implozja wsysa stary dym, fala go wymiata, włókna pozostałości |
| 7 | Za rakietą | kamera w pościgu przy zoomie 1,6 (płomień, żar spalin, smuga) |

Mysz: LPM na okręcie — salwa w cel, w pustkę — w punkt, Shift+LPM — szybkie, PPM — Supernowa.
Spacja — pauza, T — zwolnienie ×0,25, C — wyczyść, B — bloom, H — bez paneli, Z — zoom 1.
„Bitwa w ruchu”: cała flota leci 700 j./s, kamera za nią — test dziedziczenia pędu nośnika
(obraz ma wyglądać jak w bitwie stojącej).

## Moduły

| Plik | Co robi |
|---|---|
| `flight.js` | port naprowadzania z `src/effects3d/rocketSystem3D.js` do płaszczyzny gry (zimny start, lot kinematyczny, fazy launch/intercept/terminal/reacquire, wyprzedzenie w układzie wyrzutni, zapalnik z odcinka klatki) + zapalnik kontaktowy z pola odległości kadłuba; parametry z `MASTER_WEAPONS` |
| `smoke.js` | dym i żar na GPU: pierścień 2¹⁹ cząstek (compute: emisja z bufora zleceń, krok, światło), mapa gęstości (render do celu HalfFloat) → samocień, render kłębów-impostorów |
| `effects.js` | reżyser: receptury wyrzutu, zapłonu, smugi, wybuchu, supernowej; światła, duszki, siły w dymie, źródła zniekształceń |
| `plumes.js` | płomień dyszy: dyski Macha (chemiczne), plazma ze spiralną niestabilnością (supernowa) |
| `fireballs.js` | kula ognia: marsz promienia przez objętość (szum 3D, rampa ciała czarnego, sadza) |
| `sparks.js` | iskry w wyglądzie `sparkSystem3D.js` gry (tor analityczny z oporem i nośnikiem) |
| `nebula.js` | pozostałość supernowej: 110 tys. cząstek generowanych w compute, na grzbietach szumu, zorientowanych wzdłuż włókien |
| `arcs.js` | łuki wyładowań (łamana z odgałęzieniami) i linia anamorficzna błysku |
| `post.js` | refrakcja (fale, implozja, gorące powietrze) z dyspersją → bloom (`bloomConfig.js`) → ACES gry |
| `missileBodies.js` | model 3D kadłubka rakiety (instancje, światło słońca i siatki) |
| `noiseTex.js` | tekstury pieczone raz na CPU: pole wirowe dymu (3D, kafelkowe), szum 3D, faktura 2D |
| `hulls.js`, `lights.js`, `common.js` | kopie z dema asteroid (commit cb02194): kadłub z tekstury + cień dymu, siatka świateł, duszki, niebo, ACES |
| `palette.js` | profile wizualne rakiet i palety dymu (liniowe barwy, pasma HDR) |

## Decyzje

- **Smuga = porcje gazu, nie linia pozycji** (feedback usera przy prototypach silników).
  Cząstka ma NOŚNIK (pęd wyrzutni, stały — reguła `carrierVelocity.js`) i ruch własny
  (dziedziczony ruch rakiety + wylot ≈ prędkość rakiety, więc gaz prawie stoi w układzie
  wyrzutni); opór tylko na ruch własny. Wiek z ułamka klatki, przesunięcie doliczone
  analitycznie → równa smuga przy każdej liczbie FPS.
- **Ciągła wstęga**: 60% krótkich porcji (gorący ogon), 20% średnich, 20% długich; kłęby
  zorientowane i wydłużone wzdłuż toru (kąt w części ułamkowej indeksu palety), faktura
  i erozja narastają z wiekiem. Turbulencja z pola wirowego (bez źródeł w płaszczyźnie)
  rośnie z wiekiem — świeża smuga gładka, stara się kłębi.
- **Światło dymu per cząstka w compute**: słońce z samocieniem (marsz ku słońcu po mapie
  gęstości), wszystkie światła siatki (dysze, błyski, reflektory statków) z kierunkiem
  dominującym, nasycenie światła punktowego pod progiem bloomu. Ta sama mapa daje cień dymu
  na kadłubach.
- **Fale uderzeniowe = sama refrakcja** (feedback usera: bez świecących okręgów). Pozostałość
  supernowej to powłoka z włókien — pojaśnienie brzegu wychodzi z geometrii, nie z rysowanego
  pierścienia.
- **Plan pasm HDR** (próg 0,9 bramkuje pełną wartością): nad progiem tylko rdzenie dysz,
  mały rdzeń błysku, iskry, łuki, linia anamorficzna; oświetlony dym ≤ ~0,85, halo błysku
  pod progiem. Przed bloomem siatka bezpieczeństwa na NaN/Inf.
- **Supernowa** — sekwencja: implozja 0,24 s (soczewka do środka, wsysanie dymu,
  przygaszenie) → błysk z linią anamorficzną i światłem na pół kadru → fala (refrakcja +
  wymiatanie dymu, front hamuje) → pozostałość (Hα na włóknach, [O III] na powłoce,
  [S II] w zagęszczeniach, gorące wnętrze) → stygnące jądro z pulsowaniem. W locie: plazma,
  dym chemiczny, jony, łuki wyładowań, pulsująca głowica w fazie końcowej (faza pulsu
  całkowana — częstotliwość rośnie).
- **Precyzja**: stały początek sceny O w środku areny (świat ~6,7 mln j.), wszystko na GPU
  względem O, `renderer.highPrecision = true`. Tryb „bitwa w ruchu” wraca do O po 60 tys. j.
- **Rozgrzewka**: jedna klatka przez `RenderPipeline` z pustymi warstwami i puste dispatche
  compute przy starcie (klucz potoku zależy od celu passu, a `compileAsync` pomija obiekty
  niewidoczne) — bez niej pierwszy wybuch kompilował shadery w trakcie pokazu (~40 ms).

## Pomiary (RTX 5080, headless Chrome 153, 1920×1080, bez vsync)

- Salwa: GPU render 0,2–0,5 ms, compute ≤ 0,03 ms, CPU ~2 ms.
- Deszcz 96 rakiet: 165 tys. cząstek dymu, 21 tys. iskier, ~340 świateł — GPU ~1,1 ms,
  compute 0,1 ms, CPU ~2,7 ms.
- Pozostałość supernowej (110 tys. cząstek): GPU ~0,6 ms.

## three r183 pod WebGPU — ustalenia z dema

- `mesh.count` zwykłego `Mesh` to liczba instancji, ale `count > 1` wchodzi do klucza obiektu
  renderu — przejście 1 ↔ >1 przebudowuje potok; trzymać 0 (niewidoczny) albo ≥ 2.
- `compileAsync` pomija obiekty `visible = false`; potok zależy od celu (MSAA, format) —
  rozgrzewać prawdziwą klatką przez `RenderPipeline`.
- `backend.trackTimestamp` można przełączać w biegu (zapytania nie są alokowane). Pula ma
  1024 pary; przy ~15 przebiegach renderu na klatkę (bloom) i setkach FPS bez vsync zapełnia
  się, zanim wróci odczyt — ostrzeżenie tylko w headless.
- `Loop` z liczbą-węzłem + `Break()` w compute działa (próbkowanie z odrzucaniem).
- Przypisania do swizzla (`v.xy.addAssign`) działają (WGSL bez swizzle-assign → rozbicie).

## Do portu w grze (propozycja, nic nie jest wpięte)

- `SmokeSystem` zastępuje `RocketFireGPU` + `RocketSmokeGPU` (`rocketSystem3D.js`): ta sama
  rola `spawn(...)`, ale stan na GPU i oświetlenie siatką świateł; wymaga siatki świateł
  w Core3D (dziś tablica uniformów świateł pola) i passu mapy gęstości.
- Receptury (`effects.js`) wołają pule — w grze: `Fx3D`/`SparkSystem3D` po porcie na TSL
  (zadanie 14 planu), światła przez Core3D, zniekształcenia przez uberPass
  (`pushHeatHazeWorld` + nowy typ „implozja”).
- Model lotu zostaje w `rocketSystem3D.js` (gameplay) — demo go tylko odtwarza.
- Otwarte: dym nie opływa kadłubów (jest nad nimi), zderzenia dymu z asteroidami, tarcze
  (dziś rakieta w tarczę nie pokazuje kuli ognia — receptura tarczy do zrobienia), LOD
  gęstości smug przy dalekim zoomie.
