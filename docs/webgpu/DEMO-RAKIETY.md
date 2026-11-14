# Demo WebGPU: nowe efekty rakiet i rakiety specjalnej

`dema/rakiety-webgpu.html` (+ `dema/rakiety-webgpu.js`, moduły w `dema/rakiety-webgpu/`).
Rakieta manewrująca (`missile_rack`), szybka (`fast_missile_rack`) i specjalna Supernowa
(`supernova_missile`) na `WebGPURenderer` + TSL. Lot z logiki gry, efekty zrobione od nowa —
tak, jak pozwala WebGPU (compute, bufory storage, setki świateł). Gra, `Core3D` i inne dema
bez zmian. Start: `npm run dev` → `/dema/rakiety-webgpu.html`. Od 2026-11-10 także rakieta
„Niszczyciel” (tylko demo) z trzema głowicami do wyboru (domyślna „Fala”) — sekcja niżej.

Parametry adresu: `?scenario=salwa|szybkie|supernowa|deszcz|zblizenie|novaZoom|poscig|niszczyciel|niszczycielZoom`
(bez parametru — `niszczyciel`), `&glowica=fala|pulsar|gaz` (głowica „Niszczyciela”, bez parametru — `fala`),
`&loop=0` (bez pętli pokazu), `&zoom=1.5`, `&shot=1` (bez paneli).

## Scenariusze pokazu (klawisze 1–9, pętla — L)

| # | Scenariusz | Co pokazuje |
|---|---|---|
| 8 | Niszczyciel | jedna ciężka rakieta: zimny wyrzut, człon startowy, sprint, przebicie kadłuba i wybuch w środku — głowica z panelu (Fala / Pulsar / gaz 3D); pętla pokazu zaczyna od niego, czas ujęcia zależy od głowicy (`durationBy`) |
| 9 | Wybuch z bliska | ×0,45: wejście w kadłub i cały wybuch wybranej głowicy przy zoomie 0,62 |
| 1 | Salwa | 12 rakiet manewrujących w trzy okręty: smugi oświetlone dyszami, samocień chmur, trafienia |
| 2 | Szybkie rakiety | rój na fregaty w unikach (wyprzedzenie celu jak w grze) |
| 3 | Supernowa | Supernova Barrage jak w grze: 4 głowice na różne okręty grupy, kamera za pierwszą, odjazd na pozostałości |
| 4 | Deszcz rakiet | 96 rakiet w trybie „łuki kinowe” (skręt 240°/s, rozrzut 70° — NIE gameplay) |
| 5 | Zbliżenie trafienia | ×0,3: kontakt z poszyciem, kula ognia, odłamki, przypalenie |
| 6 | Supernowa z bliska | ×0,4: implozja wsysa stary dym, fala go wymiata, włókna pozostałości |
| 7 | Za rakietą | kamera w pościgu przy zoomie 1,6 (płomień, żar spalin, smuga) |

Mysz: LPM na okręcie — salwa w cel, w pustkę — w punkt, Shift+LPM — szybkie, PPM — Supernova Barrage (4 głowice),
środkowy przycisk albo Ctrl+LPM — Niszczyciel z głowicą wybraną w panelu (Fala / Pulsar / gaz 3D z gry).
Spacja — pauza, T — zwolnienie ×0,25, C — wyczyść, B — bloom, H — bez paneli, Z — zoom 1.
„Bitwa w ruchu”: cała flota leci 700 j./s, kamera za nią — test dziedziczenia pędu nośnika
(obraz ma wyglądać jak w bitwie stojącej).

**Supernowa = wersja z gry (2026-11-09).** Wybuch, światła, duszki, refrakcja i pozostałość
dema to kopia `src/3d/rockets/effects.js` + `nebula.js` z gry: skala ×2 (`NOVA_SCALE`), fala
z falą odbitą i sufitem siły z zoomu, gorące powietrze o grubszym wzorze (`PostFx.add(…, scale)`),
pozostałość 64 tys. cząstek na głowicę z WIREM, ramionami i dżetami pulsara, snopy pulsara z jądra,
sekwencja 2,8 s; salwa 4 głowic z `planBarrageTargets` (`src/game/barrage.js`) i wachlarzem
`dispersal`. Lot Supernowej też z gry (`flight.js`, `fire(…, { game: true, salvo })` →
`_stepGame`): zimny wyrzut z komory pod `launchElevation` 88° z zawisem, zapłon po `ignitionDelay`,
przechył w wachlarz salwy, obrót narastający po wachlarzu, wysokość przelotu i zejście przed celem;
obraz z wysokością jak w grze (kadłubek ze wzniesieniem nosa i skrótem perspektywy `LIFT_K`, płomień
× cos wzniesienia, łuna dyszy przy nosie w górę, słup dymu z pionu, para zawisu). Rakiety manewrujące
i szybkie latają starym modelem dema. Zmiana Supernowej w grze → przenieś ją tutaj.

## „Niszczyciel” i jego wybuchy: „Fala”, „Pulsar”, gaz 3D (2026-11-10, tylko demo — niewpięte w grę)

Zamówienie użytkownika: „Supernowa będzie do niszczenia tarcz, w salwach; teraz jedna, potężna — «Niszczyciel».
Może wybuch w 3D?”. Trzy podejścia do wybuchu, wszystkie zostały jako głowice do wyboru:

1. **gaz 3D** — wybuch z gazu gry. Ocena: „fajnie, że na bazie gry, jednak chodziło mi o kompletnie nowy wybuch,
   odjechany, AAA, z super efektami, a nie z tego, co już mamy; skoro już go zrobiłeś — zostaw; stwórz kompletnie
   nowy duży wybuch, bardziej sci-fi, w kolorach jasny niebieski / pulsar”.
2. **Pulsar** — miniaturowy pulsar w 3D (ładowanie, powłoka z żyłami, dżety, spirala wiatru, linie pola, zapaść).
   Ocena: za dużo — „stricte: duże haze; wybuch od środka narastający; bez kombinowanych zawinięć, przecięć;
   od środka do zewnątrz, fala refrakcyjna; prostsze, szybsze, bardziej wybuchowe”.
3. **Fala** (domyślna) — to, co w tej ocenie: jedno zdarzenie, wszystko rośnie promieniście ze środka, ~1,4 s.

**Wybuch „Fala”** (`waveBlast.js`; bez compute, bez własnych cząstek, bez ładowania):

| Warstwa | Co widać |
|---|---|
| błysk | białe jądro (HDR, bloom) przez ~0,07 s i szeroka błękitna łuna od pierwszej klatki |
| jasne ciało | miękka kula światła (gauss) rozprężająca się do ~0,8 R (R = 760 j.), stygnie biel → lód → lazur |
| haze | duża rozmyta chmura błękitnego światła rosnąca tuż za czołem fali (do ~3,2 R), najjaśniejsza w środku, bez krawędzi; szum we współrzędnych P / Rh — wzór rozszerza się od środka razem z wybuchem, nic nie wiruje |
| fala refrakcji | czoło i dwa echa — trzy kręgi biegnące od środka na ~3,4 R (sama refrakcja, bez rysowanego obrysu, siła gaśnie liniowo, dyspersja 0,1), plus duże gorące powietrze o grubym wzorze rosnące z falą |
| dodatki | światło dookólne w siatce, 900 iskier promieniście od środka (pula dema), wymiatanie dymu, przygaszenie 0,07 s, podbicie bloomu, wstrząs, przypalenie wlotu |

- Chmura haze jest po to, żeby było co uginać: refrakcja nad czarnym niebem jest niewidoczna, a kręgi przechodzące
  przez chmurę widać jako biegnące zmarszczki. Chmura jest czysto addytywna (bez zasłaniania) — pierwsza wersja
  z otoczką uciętą na brzegu kwadu i z zasłanianiem dawała płaski krążek z ostrą krawędzią; profil musi zejść do
  zera przed brzegiem kwadu (`win`).
- Promienie od środka (szum po kierunku) wyglądały jak rysowana gwiazda — usunięte; ruch na zewnątrz niosą iskry.
- Głębia jak w „Pulsarze”: warstwa tylna przed kadłubami, przednia (×0,5) po nich.
- **Koszt** (RTX 5080, headless 1920 × 1080): GPU ~0,4 ms całej klatki w trakcie wybuchu (dwa rysunki, 2 próbki
  szumu na piksel); świeża strona (`--swiezy 1`): 55 potoków w rozgrzewce, 0 po gotowości, żadnej długiej klatki
  przy starcie rakiety, trafieniu i wybuchu.

Poniżej opis rakiety i dwóch starszych głowic.

**Rakieta** (karta `dema/rakiety-webgpu/weaponsDemo.js` w układzie `MASTER_WEAPONS`; liczby rozgrywki to
propozycja): jedna na odpalenie, kadłubek ×3 z własnych siatek (`buildHeavyGeometry` — oba człony, sam
penetrator, sam człon startowy). Lot z gry (pionowy zimny wyrzut, zawis 0,8 s, ciężki zapłon nad pokładem,
powolny przechył), przelot członem startowym 1300 j./s z gęstym dymem, a 2,2 km od celu — gdy nos patrzy w punkt
wyprzedzenia — **sprint** (`sprint` w karcie; `flight.js`, zdarzenie `onSprint`): człon startowy odpada
i koziołkuje, penetrator przyspiesza do 4600 j./s (błękitna lanca, rozgrzane czoło, iskry zjonizowanego gazu),
bez zwalniania przed celem; cel minięty w sprincie = wybuch w miejscu. **Trafienie** (`penetration`): głowica
przebija poszycie (snop iskier z otworu, żar bije przez kadłub wzdłuż toru), leci w głąb do 170 j. i po 0,16 s
wybucha w środku — tor w układzie kadłuba, wybuch jedzie z okrętem.

**Wybuch „Pulsar”** (`pulsar.js`, `pulsarParticles.js`; wszystko od zera) — na ~4,5 s zapala się miniaturowy
pulsar, liczony w 3D:

| Faza | Czas | Co widać |
|---|---|---|
| ładowanie | 0,55 s | dysk akrecyjny (cząstki po spirali w ramionach + ramiona na dysku), klatka linii pola, soczewka i SKRĘCENIE przestrzeni, obraz przygasa, dym wsysany |
| detonacja | — | błysk, powłoka plazmy z siecią żył, pod nią wolniejsza bańka, przed nią fioletowy front jonów, fala (sama refrakcja), iskry |
| pulsar | 3,4 s | oś magnetyczna obraca się wokół nachylonej osi: dwa dżety omiatają stożki jak latarnia (3,2 → ~0,8 obr./s), dżet celujący w kamerę rozbłyska (puls), w płaszczyźnie równika dwuramienna spirala fal wiatru, snopy światła omiatają kadłuby |
| zapaść | 0,45 s | linie pola i cząstki zapadają się do jądra, obroty przyspieszają, ostatni błysk i fala, zostają gasnące drobiny |

- **Głębia przy kamerze z góry:** to, co leży pod płaszczyzną gry, rysuje się przed kadłubami (kadłub zasłania),
  co nad nią — po nich; wzór na przedniej i tylnej półkuli powłoki jedzie w przeciwne strony; dysk równika jest
  nachyloną elipsą; cząstki i linie pola mają test głębi.
- **Bez marszu promienia:** powłoki = trafienia promienia w sferę (dwa na piksel), dysk = przecięcie z płaszczyzną
  równika, dżety = najbliższe podejście promienia do osi (jasność × 1 / sin kąta osi do kamery — stąd puls).
  ~10 próbek szumu na piksel, ostre przy każdym zoomie. Ograniczenie: promień = oś kamery ortho z góry — kamery
  3D gry wymagają promienia z kamery (jak `GasVolume.createMeshes`).
- **Jasności:** wypełnienia w paśmie 0,1–0,5 (błękit zostaje błękitem po ACES), nad progiem bloomu tylko żyły,
  jądro i osie dżetów. Pierwsze wersje miały żyły z potęgi grzbietu szumu (ćwierć powłoki) i tysiące addytywnych
  iskier w bańce — z bloomem wychodziła biała kula; żyły to wąski pas wokół poziomicy szumu, iskry rozjaśniają
  się dopiero po rozejściu.
- **Koszt** (RTX 5080, headless 1920 × 1080): GPU +0,2–0,5 ms (szczyt wygładzony 1,7 ms przy detonacji),
  compute 0,02 ms, do ~40 tys. żywych cząstek z puli 131 072.
- **Post:** nowy typ źródła zniekształceń 3 — skręcenie (przesunięcie styczne wokół punktu, `post.js`).

**Wybuch z gazu gry** (`gasBlast.js`): `GasGrid` + `GasVolume` + `GasExplosions` + `GasEmbers` z `src/3d/gas/`
wprost (siatka jak atlas „fine”: 128² × 48, dwie domeny, alokacja leniwa), strojenie = kopia `tuneGasForSpace` /
`tuneLookForGame` (zmiana w grze → przenieś). Strumienie biją z otworu wlotowego, z wylotu po drugiej stronie
(do 460 j. toru) i z burt; w kadłubie 3–4 wybuchy wtórne, w otworach dogasające ogniska. Bez przeszkód: gaz
przenika kadłuby. Siatka świateł dema dostała w `loop` pola gry (`owner`, `x`, `flare`, `range`).

**Narzędzie:** `node scripts/webgpu/niszczyciel-demo.mjs [--glowica fala|pulsar|gaz] [--sc niszczyciel|niszczycielZoom]
[--zoom z] [--ruch 1] [--pustka 1] [--kadry …] [--pomiar 1] [--swiezy 1]` — jedno ładowanie strony, kadry przy
zdarzeniach lotu i w kolejnych chwilach wybuchu (cały ekran ×0,5 i wycinek 960 × 540 wokół miejsca trafienia), stan
przy każdym kadrze, błędy konsoli i WebGPU, z `--pomiar` koszt klatki co 0,5 s w czasie rzeczywistym. `--swiezy 1`
(zamiast zrzutów): świeża strona w czasie rzeczywistym w takcie monitora — najdłuższe klatki z czasem scenariusza
i potoki GPU utworzone po gotowości dema (ma być 0). Rozgrzewka dema czeka pod napisem ładowania na opróżnienie
kolejki GPU (`queue.onSubmittedWorkDone`) — bez tego pierwsza klatka pokazu stała ~0,6 s na świeżym profilu.

**Pod wpięcie w grę (nie zrobione):** karta do `src/data/weapons.js`; sprint i przebicie w
`src/game/rockets/rocketSim.js` (zdarzenie członu → rekord RKT_*); wybuch jako krok `Core3D.addFxStep` (pula
cząstek w `FxPoolOrigin` z kernelem przesunięcia, światła przez siatkę, typ „skręcenie” w `DistortionField`,
rozgrzewka w rejestrze, losowanie `fxRandom`, czas `Core3D.frameNowMs`); promień z kamery dla kamer 3D;
rozgrywka — do decyzji (obrażenia, magazynek, punkty życia PD w przelocie, interakcja z tarczą). „Fala” jest pod
wpięcie najprostsza: dwie siatki w rejestrze rozgrzewki, źródła fali i gorącego powietrza w `DistortionField` (typy
już są w grze), światło przez siatkę, iskry z puli gry — bez compute i bez nowego typu zniekształceń.

## Moduły

| Plik | Co robi |
|---|---|
| `waveBlast.js` | wybuch „Fala” (domyślna głowica „Niszczyciela”): błysk, jasne ciało i duża chmura haze w dwóch warstwach (pod i nad płaszczyzną gry), trzy kręgi refrakcji i gorące powietrze, światło, siła w dymie |
| `pulsar.js` | wybuch „Pulsar”: bryła 3D (dwie warstwy — pod i nad płaszczyzną gry), linie pola (wstęgi 3D), reżyseria faz, światła, zniekształcenia, siły w dymie |
| `pulsarParticles.js` | cząstki plazmy wybuchu „Pulsar” w compute: dopływ po spirali, dżety, rozbryzg równikowy, iskry powłoki, pył; zapaść do jądra |
| `gasBlast.js` | wybuch z gazu na siatce 3D gry (moduły `src/3d/gas/`): receptura ze strumieniami z otworów, wybuchy wtórne |
| `weaponsDemo.js` | karty broni istniejących tylko w demie („Niszczyciel”) |
| `flight.js` | port naprowadzania z `src/effects3d/rocketSystem3D.js` do płaszczyzny gry (zimny start, lot kinematyczny, fazy launch/intercept/terminal/reacquire, wyprzedzenie w układzie wyrzutni, zapalnik z odcinka klatki) + zapalnik kontaktowy z pola odległości kadłuba; parametry z `MASTER_WEAPONS` |
| `smoke.js` | dym i żar na GPU: pierścień 2¹⁹ cząstek (compute: emisja z bufora zleceń, krok, światło), mapa gęstości (render do celu HalfFloat) → samocień, render kłębów-impostorów |
| `effects.js` | reżyser: receptury wyrzutu, zapłonu, smugi, wybuchu, supernowej; światła, duszki, siły w dymie, źródła zniekształceń |
| `plumes.js` | płomień dyszy: dyski Macha (chemiczne), plazma ze spiralną niestabilnością (supernowa) |
| `fireballs.js` | kula ognia: marsz promienia przez objętość (szum 3D, rampa ciała czarnego, sadza) |
| `sparks.js` | iskry w wyglądzie `sparkSystem3D.js` gry (tor analityczny z oporem i nośnikiem) |
| `nebula.js` | pozostałość supernowej: 110 tys. cząstek generowanych w compute, na grzbietach szumu, zorientowanych wzdłuż włókien |
| `arcs.js` | łuki wyładowań (łamana z odgałęzieniami) i linia anamorficzna błysku |
| `post.js` | refrakcja (fale, implozja, gorące powietrze, skręcenie) z dyspersją → bloom (`bloomConfig.js`) → ACES gry |
| `missileBodies.js` | model 3D kadłubka rakiety (instancje, światło słońca i siatki); siatki „Niszczyciela”: oba człony, penetrator, człon startowy |
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
- **Ślad rakiety w dymie tylko w STARYM dymie** (> 0,8 s, pełna siła od 1,6 s). Odcinek
  śladu obejmuje świeży dym za własną dyszą i smugi poprzedniczek lecących gęsiego
  w salwie — bez progu rozpychał je na boki i każda rakieta miała dwa ogony w kształcie
  litery V (zgłosił user, potwierdzone A/B).
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

## Port w grze (zadanie 19 — wpięte 2026-09-28)

- **Gdzie:** `src/3d/rockets/` — pule dema (`smoke.js`, `plumes.js`, `missileBodies.js`, `fireballs.js`, `arcs.js`,
  `nebula.js`, `glow.js`, `sparks.js`, `palette.js`), reżyser receptur `effects.js` (port `Effects` z dema) i krok klatki
  efektów Core3D „rakiety” (`rocketFx.js`, `createRocketFx(Core3D)`). Lot, naprowadzanie, trafienia i obrażenia zostają
  w `src/effects3d/rocketSystem3D.js`; zgłasza zdarzenia `onLaunch / onIgnite / onFly / prepareContact / onDetonate /
  update`. Usunięte: `RocketFireGPU`, `RocketSmokeGPU`, siatka rakiet, `supernovaMissileBlow.js`, fala `shockwave3D`
  (629 linii GLSL, 5 `ShaderMaterial`). Iskry gry (`SparkSystem3D`, to samo API) stoją na puli iskier dema.
- **Kolejność w klatce:** `rocketSystem3D.update(frame)` przed `render()` (zdarzenia → kolejki CPU), potem krok efektów:
  spawn (siły w dymie, krok dymu o dt lotu, wysyłka zleceń — stara rama początku) → początek pul i przesunięcie →
  światła do siatki → update (mapa gęstości 480 × 270 nad kadrem + długość cienia, światło cząstek, instancje tej klatki,
  łuki, mgławica, zniekształcenia, post Supernowej).
- **Różnice względem dema:** pozycje w świecie gry (double), na GPU względem `Core3D.fx.origin` (kernel przesunięcia dymu
  i mgławicy, przesunięcie CPU iskier i łuków); zegar reżysera = suma dt lotu rakiet (smuga jedzie z rakietą co do kroku,
  w pauzie stoi), iskry — zegar efektów + nośnik z `SimClock`; losowość z fxRandom; zero alokacji na klatkę i rakietę;
  LOD smugi przy dalekim zoomie (poniżej 0,25: porcje rzedną do ×4, krycie rośnie tak, że gęstość zostaje); dym, iskry
  i odłamki spoza kadru z zapasem 1500 j. nie powstają (wybuch daleko zostawia tylko światło); wstrząs kamery tylko od
  Supernowej w kadrze; wybuch na poszyciu w punkcie i z normalną z `HullBodies.traceThrough / surfaceNormal` (tylko
  odczyt, przed obrażeniami — krater zabija węzły); człon słońca dymu, kul ognia i kadłubków × `sunVisibility()`;
  kadłubki z własnym oświetleniem (słońce + siatka) na zwykłym `Mesh` z atrybutami instancji (w r183 `InstancedMesh`
  stosuje macierz instancji przed `positionNode`); pas kadłubka: sojusznik — niebieski dema, wróg — czerwony,
  Supernowa — różowa.
- **Supernowa w poście gry:** przygaszenie (implozja) i podbicie bloomu (błysk) przez `Core3D.fx.post` — mnożnik gałęzi
  efektów „uber” (`uFxExposure`) i dodatek do siły bloomu w `_applyBloomPassConfig`. Fala = sama refrakcja
  (`Core3D.fxDistortion().shock`), bez świecącego obrysu; wymiatanie dymu tą samą falą (siły w kernelu dymu).
- **Tarcza (nowe, propozycja — demo jej nie miało):** głowica pęka na obrysie pola (`getEntityShieldRadiusTowards`):
  błysk z halo w barwie pola (pełne — niebieskie `#5992f7`, puste — czerwień, liniowo z życia tarczy), światło pola,
  iskry plazmy rozlane stycznie (±90° od normalnej), garść sadzy na zewnątrz, krótka fala i gorące powietrze; bez kuli
  ognia i przypalenia (pole ma własne wstęgi i bańkę — `shieldImpactFx`). Zrzut: sesja harnessu „rakiety”,
  `galeria-rakiet-tarcza`.
- **Jasność:** bloom gry = `BloomGry` (×3 zgodności z WebGL), demo — goły `BloomNode`; przy nieprzezroczystym tle obraz
  galerii zgadza się z demem (mgławica: średnie R 158 vs 157), więc bez kompensacji HDR. Uwaga do porównań: wariant
  harnessu bez passu tła (kanwa przezroczysta, premultiplied) pokazuje blask addytywny (rgb > alfa) ~2× jaśniej.
- **Otwarte:** dym nie opływa kadłubów (leci nad nimi); dym vs asteroidy — pominięte (nowe asteroidy: zadanie 21);
  cień dymu na kadłubach — nie wpięty (próbka mapy gęstości w grafie kadłuba `hexShips3D.tsl.js`, w którym pracuje
  18-C; mapa gęstości i `dRect` są gotowe w `smoke.js`); kopie CPU buforów storage (`instancedArray`: dym ~50 MB,
  mgławica ~21 MB) zostają w pamięci po pierwszej wysyłce — do rozważenia zwolnienie; `LightGrid.add` przekracza
  limit wklejania V8, więc każde światło (wszystkich producentów) opakowuje liczby argumentów (~100 B) — kandydat na
  wariant z buforem (infrastruktura 12).

## Feel rakiet, salwy, nowe typy, wir Supernowej, torpedy (2026-09-30)

Zgłoszenie użytkownika: rakiety „po prostu się pojawiają i lecą” — mają być wystrzeliwane do góry i zwinnie manewrować
w stronę celu, lecieć salwami; więcej typów (drobne, zasypujące cel gradem); lepszy wyrzut manewrujących; „wir” Supernowej
bez animacji (tylko rósł). W trakcie: torpedy z celowaniem jak w World of Warships.

**Lot (`src/effects3d/rocketSystem3D.js`).** Cztery fazy: zimny wyrzut z komory pod `launchElevation` (VLS 84–88°, kasety
64–78°) z zawisem — prędkość gaśnie wykładniczo i przy zapłonie zostaje ~16 %, rakieta stoi nad kadłubem (40–130 j.); zapłon
po `ignitionDelay`; przechył z pionu w kurs WACHLARZA (numer w salwie na złotym podziale kąta ±`dispersal`, rozrzut z ziarna)
i rozpędzanie z `boostAccel`; naprowadzanie (fazy intercept / terminal / reacquire jak dawniej) z obrotem narastającym od 40 %
przez 1 s po wachlarzu (tory salwy zakręcają szerokimi łukami i zbiegają się na cel z kilku stron) i kluczeniem `weave`
(dwie harmoniczne, gaśnie przed fazą końcową); zejście na płaszczyznę na granicy zapalnika. Nos sterowany kursem i wzniesieniem
osobno — kwaternion po najkrótszym łuku przy nawrotach robił pętle „przez zenit” (Grad wznosił się do 290 j. przy pułapie 55).
Wysokość jest obrazem: zapalnik, zasięg i obrażenia w 2D. Symulacja (Node, `scripts/rakiety-salwy-sym.mjs`): 100 % trafień
wszystkich typów w cele stojące i płynące 200–500 j/s, 93–96 % Gradu z okrętu lecącego 3000 j/s; rozrzut wachlarza w bok:
manewrujące 170–230 j., Rój ~300, Grad ~700, Hydra 330–690.

**Salwy.** `burstCount` / `burstDelay` broni rakietowej = ripple z kolejnych komór (`launchPorts` × rzędy, `cellSpacing`):
`fireSalvo` (z `fireWeaponCore`, jeden przebieg pętli strzału) odpala pierwszą, resztę kolejkuje w układzie strzelca
(komora i kierunek wyrzutni obracają się z kadłubem, pęd komory v + ω × r); myśliwiec odpala jedną z belki (`LAUNCH_RAIL`).
Balans: DPS wyrzutni ~400–480 jak dawniej (manewrująca 3 × 1000 / 7,5 s, szybka 4 × 700 / 6 s, Rój 8 × 170 / 3,4 s, Grad
24 × 180 / 9 s, Hydra 2 × 6 × 240 / 7 s); amunicja zaczepu liczy salwy.

**Nowe typy.** Rój (S, 8 mikrorakiet), Grad (L, 24 mikrorakiety — wachlarz ±78°, „pająk” krętych smug nad okrętem), Hydra
(M, nosiciel pęka 1,7 km przed celem na 6 głowic — `submunitionDef`, efekt `onSplit`). Wygląd `micro` (cienka jasna smuga —
paleta dymu 6, mały płomień, mały wybuch) i `hydra`. Grafika wyrzutni 2D — warianty atlasów istniejących kaset
(`launcherSprite2D.js`). Atlas startuje z Gradem na pierwszym zaczepie rakietowym; Rój, Hydra i torpedy są w ładowni
(mechanik). NPC: pierwsze dwa zaczepy rakietowe — broń klasy okrętu.

**Wyrzut w obrazie (`effects.js`, `missileBodies.js`).** Chłodny błysk komory i pierścień pary, szarpnięcie kasety przy
każdej rakiecie (Turret2D), para zimnego wyrzutu za wznoszącą się rakietą, kadłubek z wzniesieniem (z góry w pionie — krążek
z krzyżem stateczników, przy przechyle „rozwija się” na pełną długość) i skrótem perspektywy z wysokości, łuna dyszy zamiast
płomienia, gdy nos patrzy w górę, pierścień spalin rozlany po pokładzie przy zapłonie, słup dymu z pionu rozlany na boki,
płomień skrócony cos(el), światło dyszy na wysokości rakiety (plama na kadłubie szerzeje, gdy rakieta się wznosi).

**Wir Supernowej (`nebula.js`, `effects.js`).** Obrót różnicowy wokół jądra (ω = spin·(0,28 + 0,72·(1 − ρ)²), ρ — promień
rzutu), materia ściągnięta przy wybuchu do 2–3 ramion (waga ramienia mnoży jasność — ciemne przerwy), kłęby wzdłuż ramion
spirali, przepływ z szumu 3D współporuszającego się z wirem, fala jasności i migotanie zagęszczeń, turkusowy brzeg; dżety
pulsara (14 % cząstek, wyrzut przez 4,2 s z osi obracającej się ~2,3 rad/s — podwójna spirala, kładzione wzdłuż śladu
strumienia) i wirujące snopy z jądra; większe, ciemniejsze kłęby (gaz zamiast „sierści” kresek). Sekwencja 6,4 s.

**Torpedy (`src/game/torpedoAim.js`, index.html).** Tryb jak w World of Warships: klawisz 8, wachlarz niekierowanych torped
(`burstCount` rur, `torpedoSpread` wąski / szeroki), nakładka z torami do zasięgu, stanem wyrzutni i duchem celu w punkcie
przechwycenia; kilwater w dymie rakiet. Torpedy przyspieszone do grywalnego dolotu (1000–1400 j/s, zasięg 14–22 tys. j.).

**Otwarte.** Obrona punktowa nie strzela do rakiet 3D (tylko do pocisków z `bullets`) — przy salwach Gradu to kandydat na
kontrę; wyrzutnie 3D (opcja „Bronie 3D”, `src/3d/ships3d/weapons/weapons3D.js`) nie znają nowych id (Rój, Grad, Hydra) —
spadają na model zastępczy; kamery 3D rysują płaskie płomienie i dym (wysokość rakiet jest już w danych).
