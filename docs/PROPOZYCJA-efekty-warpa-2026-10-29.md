# PROPOZYCJA — nowe efekty warpa gracza (boki kadru), 2026-10-29

Prośba użytkownika: „Warp: dodanie efektów haze lub cząsteczkowych do warpa. Jest już w miarę fajny warp pokazujący planety, ale brak mu innych efektów. Myślę też o haze, ale mocniejszym po bokach ekranu, a nie na statku. Przygotuj propozycje nowych efektów.”

Dotyczy SKOKU WARPA GRACZA (nie hipercruise'u — ten dostaje efekty osobno). Trzy propozycje są zbudowane jako działające prototypy za przełącznikiem z adresu (W1–W3), reszta (W4–W9) to opisy do decyzji. Kod: `src/3d/warp/warpEdgeFx.js` (nowy moduł), wpięcie w `src/3d/warp/warpNurt.js` (init + koniec klatki), test `tests/warpEdgeFx.test.mjs`.

## 0. W skrócie

- **Zbudowane:** W1 „boczny haze pędu” (refrakcja w warstwie DIST), W2 „drobiny pędu” (smugi radialne od punktu zbiegu), W3 „zorza krawędzi” (słaba poświata palety przy bocznych krawędziach). Front wyjścia (W6) jest już wbudowany w maskę wszystkich trzech: przy wyjściu efekty znikają frontem od dziobu ku rufie razem ze smugami gwiazd.
- **Domyślnie (bez parametru w adresie): W1 + W2.** Uzasadnienie i zrzuty w § 4–5. W3 tylko z adresu (`?warpFx=zorza` / `wszystko`).
- **Przełącznik:** `?warpFx=0` (obraz jak przed zmianą), `?warpFx=haze` (W1), `?warpFx=czastki` (W2), `?warpFx=zorza` (W3), `?warpFx=wszystko`; kilka naraz po przecinku (`?warpFx=haze,zorza`). Działa w obu trybach renderu (`RenderWorld.pageSearch` — też w workerze).
- **Strojenie na żywo** (tryb `?renderWorker=0`, konsola): `WarpNurt.edge.tune` — amplitudy, tempa, szerokości, maska; `WarpNurt.edge.tune.haze = false` (wymuszenie W1 — `null` wraca do adresu), tak samo `czastki`, `zorza`. Stan klatki: `WarpNurt.edge.stats`.
- **Środek kadru zostaje czysty:** statek, punkt zbiegu soczewki świata przed dziobem i ciała mijane blisko osi kursu. Bez świecących okręgów i pierścieni, ośrodek „Nurtu” w skoku gracza dalej wyłączony.
- **Decyzje dla użytkownika:** § 6.

## 1. Wspólne zasady efektów boków

**Punkt zbiegu (VP).** Soczewka świata O1 prowadzi obrazy ciał po prostych z jednego punktu zbiegu przed dziobem (0,8 drogi od kotwicy kadru do krawędzi przed dziobem — `worldLens.js: warpLensFrame`). Efekty liczą ten sam punkt (`warpEdgeVanishPoint`: kurs w osiach ekranu z obrotem kadru, kotwica riga, ta sama stała `hf`) i płyną od niego na zewnątrz — haze i drobiny jadą tymi samymi promieniami co mijane planety. Bez danych: środek x, 0,15 wysokości od góry.

**Maska boków** (`warpEdgeSideMask`, ta sama w shaderach): 0 w kolumnie wzdłuż osi kursu przez statek (± 0,15 wysokości kadru — statek, VP, ciała blisko osi), rośnie z odległością w bok do 1 przy 0,8 wysokości (na 16:9 boczna krawędź leży ~0,89 H od osi; na 21:9 / 32:9 boki są szersze i w pełni objęte), za rufą słabiej (dół kadru × 0,55). Długości w ułamkach WYSOKOŚCI kadru — wygląd nie zależy od rozdzielczości ani proporcji.

**Obwiednia siły** (czysta funkcja `warpEdgeEnvelope`, testy):

| Faza | Siła (mnożnik amplitud) | Przepływ (tempo szumu i drobin) |
|---|---|---|
| ładowanie | 0 → 0,35 z ładowaniem (od 25%) — słabo, świat dopiero „wstaje” | 0 → 0,3 |
| kop | impuls × 2 w 0,06 s, wraca do lotu w 0,6 s | × 2 → 1 |
| lot | 1 × (0,5 + 0,5 · przepływ widoczny / 21 tys.) — przy mijanym ciele statek zwalnia, haze słabnie do połowy | przepływ widoczny / 21 tys. (przy ciele ~0,3) |
| wyjście | gaśnie od 0,6 zwolnienia do zwolnienia + 0,25 s; FRONT smug gwiazd (ten sam co gwiazd i soczewki — `warpExitFrontS`) czyści kadr od dziobu ku rufie | maleje do 30% |
| bezczynność, hipercruise | 0 (siatki schowane, zero rysunków) | — |

Tylko warp gracza (`WarpPlayerFx.hyper` = false), tylko kamera z góry jednego gracza (`o.lensAllowed` — bez podzielonego ekranu i kamer 3D). Czas z zegara efektu (`WarpNurt.time` — stoi w pauzie), zegary przepływu całkowane (zmiana prędkości nie przestawia wzoru), bez `Math.random` (hasz instancji na GPU).

## 2. Propozycje

### W1 „Boczny haze pędu” — ZBUDOWANE (domyślnie włączone)

- **Co widać:** po bokach kadru przestrzeń „faluje” — smugi gwiazd, mgławica, brzegi mijanych planet i ringów wyginają się falami biegnącymi od punktu zbiegu na zewnątrz, z lekkim rozszczepieniem barw (R / B) na gwiazdach. Na kopie impuls (dwa razy mocniej i szybciej), w locie stały, przy mijanym ciele spokojniejszy, przy wyjściu zwija się frontem. Statek i oś kursu ostre.
- **Jak zrobione:** pełnoekranowy quad w warstwie DIST (`FX_DISTORT_LAYER`, cel `Core3D.distortionTarget`) pisze przesunięcie w px (RG, osie ekranu; B = A = 0 — B / A należą do maskowania), mieszanie One / One. Szum `fxNoise.tile2D()` (ta sama tekstura co broń) we współrzędnych biegunowych wokół VP: kąt × 7 kafelków na obrót, ln(r) × 0,55 − zegar (anizotropia: komórki wydłużone promieniście — smugi „ciśnienia”), drugi próbnik drobniejszych zmarszczek (kanał B); przesunięcie głównie radialne, 35% w poprzek; × maska boków × siła × 16 px (przy 1080 wierszach). Próbki z poziomem 0 (`textureSampleLevel` — gałąź per piksel, szew `atan` bez linii: całkowita liczba kafelków na obrót). Post (`postGry.js`) dokłada aberrację R / B sam (≤ 2,5 px). Warstwę DIST zgłasza krok `Core3D.fx` „warp: boki kadru” (zgłoszenie z `WarpNurt.update` przepadałoby — flagę kasuje klatka efektów).
- **Koszt (szacunek, bez pomiaru):** 1 rysunek (quad) + przebieg warstwy DIST (jedno `renderer.render`, ~40 µs CPU, gdy nie ma innych źródeł DIST); GPU: kolumna osi wychodzi wcześnie, boki — 2 próbki tekstury + ~40 ALU / piksel: ~0,05–0,15 ms przy 1080p, ~0,2–0,4 ms przy 5120 × 1440; w poście warstwa DIST włącza ścieżkę z trzema próbkami sceny zamiast jednej (cały kadr): ~0,1–0,3 ms przy 5K. Tylko w skoku.
- **Przełącznik:** `?warpFx=haze` (sam), w zestawie domyślnym; `WarpNurt.edge.tune.hazeAmpPx` (16), `hazeFlow` (0,85), `hazeAngN` (7), `hazeRadK` (0,55), `hazeTan` (0,35), `hazeFine` (0,6).
- **Ryzyka:** na stopklatce efekt widać słabo (gwiazdy lekko pofalowane) — żyje w ruchu; za mocny (> ~25 px) zaczyna „rozmazywać” gwiazdy jak brudna szyba. Duża planeta mijana bokiem też faluje (świadomie — leży po boku). Maskowanie gracza w skoku (rzadkie) dzieli ten sam cel DIST — sumy się dodają, bez konfliktu kanałów.

### W2 „Drobiny pędu” — ZBUDOWANE (domyślnie włączone)

- **Co widać:** cienkie biało-błękitne smugi (z nutą barwy palety warpa) wylatujące promieniście z punktu zbiegu ku bokom i rogom kadru, przyspieszające z odległością (jak mijane ciała w soczewce), dłuższe przy większej prędkości; na kopie gęstszy, szybszy „wystrzał”; co ~25. trochę jaśniejsza (lekki blask). Pod planetami, ringiem, stacjami i kadłubem.
- **Jak zrobione:** jedna siatka `Mesh` z `InstancedBufferGeometry` (2048 instancji, sam kwad — bez atrybutów instancji), pozycje ANALITYCZNE w shaderze wierzchołków z haszu `instanceIndex` (kąt od kierunku „za rufę” 0,16–1,85 rad w obie strony, faza, tempo 0,75–1,3, szerokość, jasność) i zegara życia: ln r liniowo od 0,05 H do za róg kadru (promień rośnie wykładniczo, tempo 1,7 ln r / s przy prędkości 1 — ciała soczewki w trawersie ~1,9 / s), smuga = tempo × migawka 0,06 s. Pass tła (warstwa 1), głębia przy dalekiej płaszczyźnie z testem głębi, mieszanie `blendAddytywnePremul`, alfa wyjścia 0. HDR pod progiem bloomu (0,34 liniowo, rzadkie × 2,4). Zero zapisu CPU per klatka poza uniformami, bez compute.
- **Koszt:** 1 rysunek, 2048 instancji × 2 trójkąty; fill ~0,3–0,6 Mpx addytywnie przy 1080p, hasz w wierzchołkach — poniżej ~0,05 ms GPU.
- **Przełącznik:** `?warpFx=czastki`, w zestawie domyślnym; `tune.dustCount` (2048), `dustBright` (0,34), `dustLogSpeed` (1,7), `dustShutter` (0,06), `dustWidthPx` (2,4), `dustAng0` / `dustAng1`, `dustTint` (0,22).
- **Ryzyka:** łatwo przesadzić z gęstością („deszcz”) — dziś celowo słabe; drobiny rysowane POD planetami (pass tła) — gdyby miały być „bliżej kamery” niż mijane planety, trzeba je przenieść do passa gry (warstwa 0, nad planetami — patrz decyzja D3).

### W3 „Zorza krawędzi” — ZBUDOWANE (tylko z adresu)

- **Co widać:** bardzo słaba, przygaszona poświata w barwach palety warpa okrętu (otoczka i poświata plazmy WARP, przesunięte ku szaroniebieskiej mgiełce) w pasach przy lewej i prawej krawędzi, z pasmami płynącymi od punktu zbiegu na zewnątrz; za rufą słabiej, przy wyjściu zwija się frontem.
- **Jak zrobione:** dwa kwady przy krawędziach (geometria tylko przy krawędziach — pas 0,34 wysokości, najwyżej 0,3 szerokości), w passie tła; ten sam szum (kanały R / A / G) i zegar co W1, spadek ku środkowi gładki.
- **Koszt:** 1 rysunek, 4 trójkąty, ~0,7 Mpx przy 1080p, 1 próbka tekstury — pomijalny.
- **Przełącznik:** `?warpFx=zorza`, `?warpFx=wszystko`; `tune.auroraStrength` (0,1), `auroraStrip` (0,34), `auroraSat` (0,55).
- **Ryzyka:** to w praktyce barwna winieta — przy mocniejszym ustawieniu zaczyna wyglądać jak mgławica przyklejona do ekranu (pierwsza wersja 0,22 przy pełnym nasyceniu: fioletowe pasy). Gryzie się z mgławicą tła w innych barwach.

### W4 „Rozmycie promieniste tła przy krawędziach” — OPIS (wymaga zmiany `postGry.js`)

- **Co widać:** klasyczny „zoom blur” — po bokach obraz rozmyty wzdłuż promieni od punktu zbiegu (gwiazdy i planety ciągną się w smugi ku krawędziom), środek ostry.
- **Jak by było:** w „uber” (`postGry.js`) gałąź po uniformie: N próbek sceny (6–8) wzdłuż kierunku do VP, długość × maska boków × siła (te same uniformy co W1 — VP, oś, front). Nie da się tego zrobić warstwą DIST (ta tylko przesuwa jedną próbkę).
- **Koszt:** N dodatkowych próbek sceny na piksel w masce (przy 5K i N = 6: ~0,5–1 ms) — najdroższa propozycja; plus zmiana WGSL postu (przebudowa obu `RenderPipeline` pod rozgrzewką).
- **Ryzyka:** rozmycie zjada szczegóły mijanych planet (główne widowisko soczewki); `postGry.js` należy dziś do sesji wydajności. Proponuję tylko, jeśli W1 + W2 okażą się za słabe.

### W5 „Przebicie” przy kopie — OPIS

- **Co widać:** w chwili kopu po bokach kadru zbiegający do punktu zbiegu impuls: pierścień refrakcji (bez świecenia) kurczy się do VP w ~0,25 s, drobiny na moment zawracają ku VP, potem wybuchają na zewnątrz (dzisiejszy impuls × 2).
- **Jak by było:** dodatkowy składnik obwiedni `pierce` (0 → 1 → 0 w ~0,3 s od kopu): w W1 promień fali `exp(ln r0 − t · v)` z profilem pierścienia w masce boków (tylko refrakcja — reguła fal), w W2 znak tempa życia odwrócony na czas impulsu (zegar życia cofa się — bez nowych danych).
- **Koszt:** kilka instrukcji w istniejących shaderach, 0 nowych rysunków.
- **Ryzyka:** okrąg zbiegający się do VP jest blisko „świecących okręgów” (odrzuconych) — musi zostać czystą refrakcją i tylko po bokach.

### W6 „Zapadnięcie” przy wyjściu — CZĘŚCIOWO ZBUDOWANE

- **Co widać:** haze i drobiny zwijają się frontem od dziobu ku rufie razem ze smugami gwiazd — jest w W1–W3 (maska frontu: ten sam front co gwiazd i soczewki, `warpExitFrontS`, pas przejścia ± 0,06 H).
- **Rozszerzenie (opis):** na froncie krótki przypływ (haze × 1,5 w pasie frontu) i drobiny za frontem gwałtownie skracane (smuga → punkt), jak gwiazdy wracające do punktów.
- **Koszt:** kilka instrukcji; 0 nowych rysunków.

### W7 „Tempo napędu w obrazie” (pomysł własny) — OPIS

- **Co widać:** Mk I / II / III różnią się w skoku: szybszy napęd = gęstszy, szybszy haze i dłuższe smugi drobin. Dziś przepływ widoczny jest jeden (21 tys. j/s) dla wszystkich napędów, a soczewka tylko zmniejsza świat przy Mk III.
- **Jak by było:** mnożnik przepływu i jasności z `WARP_WORLD_LENS.driveSpeed` / 175 tys. (Mk II = 1) w obwiedni.
- **Koszt:** zero (uniformy). **Ryzyko:** Mk I wyglądałby „biedniej” — decyzja projektowa.

### W8 „Opływ mijanej planety” (pomysł własny) — OPIS

- **Co widać:** haze opływa dużą tarczę mijanej planety — przy jej brzegu fale gęstnieją i wyginają się wokół (jak opływ ciała w strudze), drobiny nie wchodzą na tarczę, tylko rozchodzą się wokół.
- **Jak by było:** obraz ciała z soczewki (środek i promień najbardziej widocznego mijanego ciała — `WarpWorldLens`, już liczony co klatkę) jako uniform; w W1 dodatkowy składnik przesunięcia stycznie do brzegu tarczy w pasie 0,1–0,3 R, w W2 maska tarczy w wierzchołkach.
- **Koszt:** kilka instrukcji, jeden uniform vec4. **Ryzyko:** brzeg planety już refrakcja (W1) — trzeba uważać, żeby nie zrobić „jajka” wokół tarczy.

### W9 „Skrzenie pyłu przy przejściu przez pas” (pomysł własny) — OPIS

- **Co widać:** gdy kurs skoku przecina pas planetoid (pas w skoku nie jest rysowany — decyzja 2026-10-27), drobiny W2 na czas przelotu przez strefę pasa gęstnieją i szarzeją (pył zamiast „gwiezdnych” iskier), haze krótko drga mocniej.
- **Jak by było:** plan trasy już zna pierwszy przelot przez strefę pasa (`warp.route` — drogi i chwile); mnożniki gęstości / barwy drobin w obwiedni.
- **Koszt:** zero (uniformy). **Ryzyko:** wraca motyw „skał w skoku”, który użytkownik odrzucił — tylko jako subtelna zmiana drobin.

## 3. Co zbudowane — szczegóły techniczne

| | W1 haze | W2 drobiny | W3 zorza |
|---|---|---|---|
| Warstwa / pass | DIST (10) → `distortionTarget` | tło (1), pod planetami | tło (1) |
| Rysunki | 1 quad (+ przebieg DIST) | 1 (2048 instancji) | 1 (2 pasy) |
| Głębia | bez testu | test, z = 0,99999 (NDC), bez zapisu | jak W2 |
| Mieszanie | One / One (kolor i alfa) | One / One, alfa wyjścia 0 | jak W2 |
| Rozgrzewka | `warp: haze boków (DIST)` | `warp: drobiny i zorza boków` (`WARIANT_INSTANCJI`) | — |
| Bufory uniformów | 1 / etap | 1 / etap | 1 / etap |

- Poza skokiem wszystkie trzy siatki są schowane: 0 rysunków, 0 przebiegów DIST (gdy nic innego nie zgłasza warstwy). W skoku: +3 rysunki i ewentualnie +1 `renderer.render` (DIST).
- Graf każdego materiału budowany RAZ (wartości klatki — uniformy), bez `defines`, bez alokacji w `update` (rekordy wejścia i wyniku w miejscu).
- Szew renderu bez zmian: moduł nie importuje `src/game`, nie czyta `window` / DOM; przełącznik z `RenderWorld.pageSearch` (strona i worker).
- Stan klatki: `WarpNurt.edge.stats` (`on`, `strength`, `speed`, `kick`, `vpX` / `vpY` — px bufora od środka, y w dół, `haze` / `czastki` / `zorza`, `src` — „domyślnie” / „adres”).
- Testy: `tests/warpEdgeFx.test.mjs` — obwiednia (fazy, kop, przelot, wyjście, hipercruise = 0), przełącznik, maska i VP (lustra CPU), WGSL trzech materiałów z Node (≤ 12 buforów uniformów, ≤ 8 wejść, bez `pow`, B = A = 0 w DIST, próbki z poziomem), strażnik szwu, wpięcie w sterownik (fazy z automatu gry, hipercruise, kamera bez soczewki, DIST z kroku, chowanie bez klatki sterownika).

## 4. Zrzuty

(uzupełnione po przebiegach — § 4 niżej)

## 5. Domyślny zestaw

(uzupełnione po przebiegach)

## 6. Decyzje dla użytkownika

(uzupełnione po przebiegach)
