# PROPOZYCJA — nowe efekty warpa gracza (boki kadru), 2026-10-29

Prośba użytkownika: „Warp: dodanie efektów haze lub cząsteczkowych do warpa. Jest już w miarę fajny warp pokazujący planety, ale brak mu innych efektów. Myślę też o haze, ale mocniejszym po bokach ekranu, a nie na statku. Przygotuj propozycje nowych efektów.”

**Obowiązuje WERSJA 2 — przepływ równoległy do kursu (§ A–F).** Wersja 1 (efekty od punktu zbiegu soczewki, promieniście) została zastąpiona po ocenie użytkownika; jej opis (§ 0–6 pod linią „Wersja 1”) zostaje jako historia.

## A. Ocena wersji 1 i wybór użytkownika

Użytkownik po wersji 1: „hipercruise lepiej, warp gorzej, bo mamy 2D statek, który leci do góry, i wszystkie próby efektów zrobiły 3D. To się nie klei, nie pasuje. Statek leci do góry, a wszystkie efekty są stworzone tak, jakby leciał w głąb ekranu. Kamera jest za blisko na statek, trzeba ją oddalić, dopasować to tak, żeby było spójne”. Wybrane „1 + 2 i 3a” (opis kamery i soczewki — `docs/WARP-kadr-lotu-2026-10-29.md`):

1. **Efekty równoległe do kursu** (widok z góry, bez punktu zbiegu) — ta zmiana, `src/3d/warp/warpEdgeFx.js`.
2. **Kamera dalej** (gałąź orkiestratora `claude/hipercruise-warp-fx`, ea2b60a6): ładowanie w dawnym kadrze, po kopie kamera w 1,5 s odsuwa się do kadru lotu (`warpJumpFrame` 0,4 × domyślny zoom, szerokość najwyżej 16:9 × wysokość) — statek ~8% wysokości kadru przy każdej proporcji, wyprzedzenie 0,35.
3. **(3a) Przełącznik pochylenia soczewki** `?warpSoczewka=plaska` (`hf` 2,5) — efekty boków od niego nie zależą.

## B. Zasady wersji 2

- **Kierunek:** przeciw kursowi w osiach ekranu — kurs gry obrócony o obrót kadru (`cam.roll`, `viewRoll.js`). W kadrze „kurs w górę” efekty płyną pionowo w dół; w kadrze „Północ” skośnie, wzdłuż kursu. Świat przelatuje pod statkiem z góry na dół kadru — tak, jak widzi go kamera z góry.
- **Bez współrzędnych biegunowych, punktu zbiegu i zbiegania do punktu.** `warpEdgeVanishPoint` usunięty razem z testami; moduł nie czyta soczewki O1 (`worldLens`, `WARP_LENS_SHARED`, `hf`) — test zmienia `params.hf` na 2,5 i porównuje uniformy klatki.
- **Czysta kolumna osi kursu przez statek** (`warpEdgeLayout`): pół szerokości = max(2,5 × pół szerokości kadłuba na ekranie przy zoomie TEJ klatki, 8% szerokości kadru), najwyżej 30%; efekty rosną ku krawędzi po tej stronie osi (pełne na 0,85 drogi). Kamera odsuwa się po kopie, więc kolumna maleje razem z kadłubem; w kadrze lotu trzyma ją dolna granica 8% (przy 1600 × 900 — 128 px).
- **Fazy całkowane na CPU** (`warpEdgePhaseStep`: faza += prędkość · dt czasu efektu, zawijana) → uniformy; nie czas × prędkość w shaderze (lekcja z hipercruise'u — „gotowanie się” wzoru przy zmianie prędkości). Limit aliasingu: przesuw wzoru ≤ ¼ komórki na klatkę przy 60 kl/s.
- **Obwiednia** (`warpEdgeEnvelope`, bez zmian względem v1, ale przepływ ma teraz znaczenie wprost): ładowanie — rozruch od 0 (siła ≤ 0,35, przepływ ≤ 0,3); kop — impuls × 2 przez ~0,6 s (siła i przepływ, bez pierścieni); lot — stała × przepływ widoczny (przy mijanej planecie statek zwalnia: efekty płyną wolniej i słabną najwyżej do połowy); wyjście — FRONT prostopadły do kursu (ten sam co smug gwiazd, `warpExitFrontS`) jedzie w dół kadru, za nim efekty gasną; hipercruise, podzielony ekran i kamery 3D — 0.

## C. Co zbudowane (wersja 2)

### W1 „Pasma pędu” (haze, warstwa DIST) — domyślnie

- **Co widać:** przy lewej i prawej krawędzi tło (smugi gwiazd, mgławica, brzegi mijanych ciał) drga na boki w długich pasmach płynących w dół kadru — jak gorące powietrze w strudze opływającej statek. Kolumna statku ostra. Na stopklatce subtelnie (smugi gwiazd lekko faliste, mapa przesunięć to gładkie pionowe „kurtyny”), w ruchu — falowanie płynące w dół.
- **Jak:** pełnoekranowy quad w warstwie DIST (RG w px w osiach ekranu; B = A = 0), szum `tile2D` w osiach (wzdłuż kursu, w poprzek): dwie oktawy — komórka 0,2 H i 0,08 H w poprzek, × 7 wzdłuż kursu, poziom mip +3 (8 px na texel — gasi drobne oktawy fbm tekstury), fazy wzdłuż kursu 1,6 H/s (druga × 1,3); przesunięcie w poprzek kursu + 35% wzdłuż; 8 px przy 1080 wierszach (kop najwyżej × 1,4). Przy samej krawędzi kadru przesunięcie gaśnie w pasie 4 × amplituda — post próbkuje p − o, a próbka spoza kadru to powielony brzeg (pierwszy przebieg pokazał przy lewej krawędzi pasek „kodu kreskowego”).
- **Wygładzenie po pierwszym zrzucie v2:** komórki 0,05 / 0,02 H z mip 1:1 i 10 px dawały „deszcz na szybie” — gwiazdy rozmazane w poziome kreski z tęczą aberracji. Lustro CPU fragmentu (tekstura `tile2D` z mipmapami jak na GPU, pole przesunięć z uniformów prawdziwej klatki): gradient przesunięcia w poprzek kursu p99 1,4 (w kopie 2,0), fałdy obrazu (det(I − J) ≤ 0 — obraz zawija się, gwiazdy się podwajają) na 3% boków (w kopie 8%). Po: p99 ~0,28 (kop ~0,39), bez fałd (det(I − J) ≥ ~0,55), przesunięcie ~6 px w pasie pełnej siły (p50), najwyżej ~15 px (kop ~20 px) przy 1080 wierszach. Test `W1 gładko` w `tests/warpEdgeFx.test.mjs` liczy to z uniformów klatki (także: 0 w kolumnie, próbka nie wychodzi poza kadr, a dawne nastawy dają fałdy — kontrola czułości lustra).
- **Strojenie** (`WarpNurt.edge.tune`): `hazeAmpPx` 8, `hazeKickMax` 1,4, `hazeCell1` 0,2, `hazeCell2` 0,08, `hazeStretch1` / `hazeStretch2` 7, `hazeLod1` / `hazeLod2` 3, `hazeFine` 0,4, `hazeAlong` 0,35, `hazeFlow` 1,6, `hazeFlow2` 1,3. Mniejsze komórki albo mip bez przesunięcia wracają do „deszczu na szybie”.

### W2 „Smugi pędu” (drobiny) — domyślnie

- **Co widać:** cienkie chłodne, biało-błękitne smugi równoległe do kursu, płynące w dół kadru w trzech warstwach paralaksy; gęściej przy bokach, w kolumnie statku żadnych; w kopie szybsze i dłuższe, przy mijanej planecie zwalniają, przy wyjściu znikają frontem. Pod planetami, ringiem, stacjami i kadłubem (pass tła — D3 bez zmian).

| Warstwa | Smug | Tempo [H/s] | Długość [px przy 1080] | Jasność (liniowo) | Szerokość [px] |
|---|---|---|---|---|---|
| daleka | 1000 | 0,5 | 30 | 0,09 | 1,4 |
| średnia | 550 | 1,4 | 90 | 0,16 | 1,8 |
| bliska | 250 | 3,0 | 200 | 0,26 (co ~33. × 2,2) | 2,4 |

- **Jak:** jedna siatka (`InstancedBufferGeometry`, 1800 instancji, sam kwad — bez atrybutów instancji), pozycje analityczne z haszu `instanceIndex`: warstwa z indeksu, odległość od osi kursu od brzegu kolumny do krawędzi kadru (rozkład √ — gęściej przy bokach), pozycja wzdłuż kursu = faza warstwy (CPU) × tempo drobiny (0,88–1,12), zawijanie poza kadrem (zapas 0,4 H na długość smugi); smuga nie krótsza niż 1,3 × przesuw na klatkę (bez stroboskopu przy każdym tempie klatek); maska kolumny i frontu w wierzchołkach; gauss w poprzek, zanik ku ogonowi. Pass tła (warstwa 1, `renderOrder` 0,3 — okno (−0,5; 0) należy do pasa), głębia przy dalekiej płaszczyźnie. Barwa: biel (0,72; 0,86; 1) z 22% barwy palety warpa okrętu. Jasność w kopie najwyżej × 1,35.
- **Strojenie:** `dustFar` / `dustMid` / `dustNear` (liczby, na żywo bez przebudowy), `dustSpeed*`, `dustLen*`, `dustBright*`, `dustWidth*`, `dustBrightRare`, `dustTint`.

### W3 „Pasma krawędzi” (zorza) — tylko z adresu

- Długie barwne pasma przy lewej i prawej krawędzi (pas 0,34 H, najwyżej 0,3 szerokości), szum × 12 wzdłuż kursu dryfujący w dół 0,8 H/s, siła 0,1, nasycenie palety 0,45; pass tła, za frontem wyjścia gaśnie. `?warpFx=zorza` / `wszystko`.

## D. Zrzuty i sonda DIST (wersja 2)

Narzędzie: kopia robocza `warp-ped-gra.mjs` z sondą warstwy DIST (`.tmp/warp-ped-sonda.mjs` w worktree — nie w repo): po każdej fazie odczyt `Core3D.distortionTarget` (`readRenderTargetPixelsAsync`, połówki), mapa `<faza>-dist.png` (|przesunięcie|, czerwień = NaN) i statystyki kolumny osi kursu oraz pasów 15% szerokości przy lewej i prawej krawędzi w `raport.json` → `sondaDist`. TRAVEL TO Ziemia → Mars z przelotem obok Merkurego, `ziarno=7` (ta sama trasa w każdym przebiegu), 1600 × 900, tryb `off` (poza przebiegiem w workerze), gałąź na `claude/hipercruise-warp-fx` 2cbed460 (kadr lotu ea2b60a6 — kamera odsuwa się po kopie: zoom w locie 0,039 zamiast ~0,047). Katalogi w `.tmp/` worktree:

| Katalog | Zestaw | Uwagi |
|---|---|---|
| `rk2-baza` | `?warpFx=0` | obraz bez efektów boków (baza porównań); warstwa DIST pusta |
| `rk3-dom` | domyślny (W1 + W2) | wartości końcowe |
| `rk3-wszystko` | W1 + W2 + W3 | sonda DIST jak w `rk3-dom` (W3 nie pisze do DIST); zorza — słaba szaroniebieska mgiełka przy krawędziach, pod planetami |
| `rk2-worker` | domyślny, `renderWorker=1` | tryb gracza na kodzie sprzed wygaszenia W1 przy krawędzi kadru: 0 błędów konsoli strony i workera, 0 pipeline'ów sync w workerze przed i po starcie, 0 klatek z NaN; przebieg `rk3-worker` (kod końcowy) przerwany na prośbę użytkownika — do powtórzenia |
| `rk-dom` | domyślny, pierwsze nastawy v2 (przed wygładzeniem W1, kamera sprzed ea2b60a6) | „deszcz na szybie” — do porównania |
| `rk2-dom` | domyślny, przed wygaszeniem W1 przy krawędzi kadru | pasek powielonego brzegu przy lewej krawędzi |
| `rk3-porownania` | zestawienia | `0x-…_baza-dom.png` (fazy 01–06, baza │ domyślny), `04-dolot_prawy-bok_baza-dom.png`, `02-kop_lewy-bok_baza-dom.png` (boki 1:1), `02-kop_prawy-bok_v2-pierwsza_vs_gladka.png`, `03-przelot_dist_v2-pierwsza_vs_gladka.png` (mapa przesunięć: drobna sieczka → gładkie pionowe „kurtyny”), `02-kop_lewa-krawedz_x3_przed-po-wygaszeniu.png`, `04-dolot_baza-wszystko.png` |

Sonda DIST (`rk3-dom`, przesunięcie w px bufora przy 900 wierszach — amplituda 8 px × 900 / 1080 = 6,7 px):

| Faza | Siła / przepływ | Pas lewy: średnia / max | Pas prawy: średnia / max | Kolumna osi | NaN, B / A |
|---|---|---|---|---|---|
| 01 ładowanie | 0,16 / 0,14 | 0,91 / 1,9 | 0,87 / 1,9 | 0 | 0, 0 |
| 02 kop | 1,44 / 1,43 | 5,1 / 12,7 | 5,9 / 12,7 | 0 | 0, 0 |
| 03 przelot (Merkury, Słońce z boku) | 0,97 / 0,95 | 5,4 / 11,3 | 6,2 / 11,3 | 0 | 0, 0 |
| 04 dolot | 1 / 1 | 4,3 / 10,3 | 4,6 / 10,3 | 0 | 0, 0 |
| 05 zwolnienie (front wyjścia) | 1 / 0,63 | 1,7 / 11,5 | 1,7 / 11,5 | 0 | 0, 0 |
| 06–10 hamowanie, ślizg, po | 0 | 0 | 0 | 0 | 0, 0 (warstwa nie idzie) |

Czysta kolumna w każdej fazie skoku: 128 px pół szerokości (8% z 1600 — kadłub w kadrze lotu jest mniejszy). Pipeline'y synchroniczne po starcie: 0 we wszystkich przebiegach.

Co widać: środek kadru (statek, cel, oś kursu) bez zmian; W2 daje po bokach pionowe smugi pędu w trzech warstwach — w locie wyraźne, w kopie gęste (krótko), pod planetami (Merkury, tarcza Słońca je zasłaniają); W1 na stopklatce tylko lekko faluje gwiazdy i brzegi ciał po bokach (gwiazdy zostają punktami — bez kresek i tęczy pierwszej wersji), w ruchu płynie w dół; w zwolnieniu (05) efekty znikają frontem od góry kadru, w hamowaniu (06) i dalej kadr jest jak bez efektów. Uwaga do porównań: ring Marsa w fazie 05 bywa w kadrze albo nie zależnie od przebiegu (także w bazie: `rk-baza` z ringiem, `rk2-baza` bez) — chwila zatrzymania zrzutu względem zegara soczewki, nie efekt boków.

**Nie sprawdzone dla wersji 2** (przerwane — użytkownik gra): przebieg w workerze na kodzie końcowym (`--query "renderWorker=1&ziarno=7"`), kadr 32:9 (`--rozmiar 2560x720`), koszt GPU (ABAB `scripts/webgpu/warp-ped-gra.mjs --koszt 1` z `--query "ziarno=7"` i `"warpFx=0&ziarno=7"`; pomiar wersji 1 — różnica w szumie, § 3 niżej). Koszt wersji 2 powinien być podobny: W1 — te same dwie próbki tekstury na piksel boków, ale z wyższego poziomu mip; W2 — dalej jeden rysunek, 1800 zamiast 1600 instancji.

## E. Dalsze propozycje w wersji równoległej (opisy)

- **W4 „Rozmycie wzdłuż kursu przy krawędziach”** — w „uber” (`postGry.js`) N próbek sceny wzdłuż kursu (nie ku punktowi) × maska boków: tło po bokach rozciąga się w pionowe smugi. Najdroższe (N próbek na piksel boków, przy 5K ~0,5–1 ms), zmiana postu (sesja wydajności). Tylko, jeśli W1 + W2 za słabe.
- **W5 „Szarpnięcie” przy kopie** — zamiast pierścienia: pas refrakcji prostopadły do kursu przelatuje raz z góry na dół kadru w ~0,3 s (fala uderzeniowa „przelotu”), drobiny na moment rozciągają się × 2. Kilka instrukcji w W1 / W2, uniform impulsu z obwiedni.
- **W6 „Zapadnięcie” przy wyjściu** — front jest (W1–W3 gasną za frontem smug gwiazd); rozszerzenie: krótki przypływ haze w pasie frontu i smugi drobin skracane do punktów za frontem.
- **W7 „Tempo napędu w obrazie”** — mnożnik przepływu i długości smug z prędkości napędu (Mk I–III; dziś przepływ widoczny jest jeden — 21 tys. j/s). Zero kosztu; decyzja projektowa (Mk I „biedniej”).
- **W8 „Opływ mijanej planety”** — smugi i pasma haze rozchodzą się wokół tarczy mijanego ciała jak struga wokół walca (składnik w poprzek kursu przy brzegu tarczy, smugi drobin omijają tarczę). Obraz ciała z soczewki jako uniform; uważać na „jajko” wokół tarczy.
- **W9 „Pył przy przejściu przez pas”** — na czas przelotu przez strefę pasa (plan trasy zna chwile) smugi gęstnieją i szarzeją, haze krótko drga mocniej; tylko subtelnie (pas w skoku nie jest rysowany — decyzja 2026-10-27).

## F. Decyzje dla użytkownika (wersja 2)

- **D1 — zestaw domyślny:** W1 + W2 (dziś) / + W3 / sam W2 / sam W1. Ocena w grze: bez parametru, `?warpFx=wszystko`, `?warpFx=czastki`, `?warpFx=haze`.
- **D2 — siła i ziarno haze (W1):** dziś 8 px przy 1080 wierszach, gładkie pasma (komórki 0,2 / 0,08 H). Mocniej (`tune.hazeAmpPx`) — wyraźniejsze falowanie, ale rośnie aberracja na gwiazdach; drobniej (`hazeCell*`, `hazeLod*`) — szybko wraca „deszcz na szybie”.
- **D3 — smugi pod planetami czy nad nimi:** dziś pod (pass tła — mijana tarcza je zasłania, „daleki pył”); nad (pass gry, pod kadłubami) czytają się jak pył tuż przy kamerze, ale rysują się po tarczach.
- **D4 — gęstość, długość i jasność warstw W2:** tabela w § C; w kopie po bokach bywa gęsto („deszcz” — świadomie krótko, 0,6 s).
- **D5 — szerokość czystej kolumny:** dziś max(2,5 × kadłub, 8% kadru); w kadrze lotu decyduje 8% (`tune.colMinW`, `colHullK`).
- **D6 — które opisy z § E budować dalej** (W5 szarpnięcie przy kopie, W6 przypływ na froncie, W7 tempo napędu, W8 opływ planety, W9 pył pasa, W4 rozmycie wzdłuż kursu).
- **D7 — preset grafiki:** efekty nie są w presetach (`src/game/graphicsQuality.js`); propozycja: preset Niska bez W1 (bez przebiegu DIST i trzech próbek sceny w poście), smugi × 0,5.

---

# Wersja 1 — punkt zbiegu (historia, zastąpiona 2026-10-29)

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
| kop | impuls × 2 w 0,06 s, wraca do lotu w 0,6 s (haze najwyżej × 1,4, jasność drobin × 1,35) | × 2 → 1 |
| lot | 1 × (0,5 + 0,5 · przepływ widoczny / 21 tys.) — przy mijanym ciele statek zwalnia, haze słabnie do połowy | przepływ widoczny / 21 tys. (przy ciele ~0,3) |
| wyjście | gaśnie od 0,6 zwolnienia do zwolnienia + 0,25 s; FRONT smug gwiazd (ten sam co gwiazd i soczewki — `warpExitFrontS`) czyści kadr od dziobu ku rufie | maleje do 30% |
| bezczynność, hipercruise | 0 (siatki schowane, zero rysunków) | — |

Tylko warp gracza (`WarpPlayerFx.hyper` = false), tylko kamera z góry jednego gracza (`o.lensAllowed` — bez podzielonego ekranu i kamer 3D). Czas z zegara efektu (`WarpNurt.time` — stoi w pauzie), zegary przepływu całkowane (zmiana prędkości nie przestawia wzoru), bez `Math.random` (hasz instancji na GPU).

## 2. Propozycje

### W1 „Boczny haze pędu” — ZBUDOWANE (domyślnie włączone)

- **Co widać:** po bokach kadru przestrzeń „faluje” — smugi gwiazd, mgławica, brzegi mijanych planet i ringów wyginają się falami biegnącymi od punktu zbiegu na zewnątrz, z lekkim rozszczepieniem barw (R / B) na gwiazdach. Na kopie impuls (mocniej i szybciej), w locie stały, przy mijanym ciele spokojniejszy, przy wyjściu zwija się frontem. Statek i oś kursu ostre. Na stopklatce widać wygięte smugi gwiazd; pełny efekt (falowanie tła) — w ruchu.
- **Jak zrobione:** pełnoekranowy quad w warstwie DIST (`FX_DISTORT_LAYER`, cel `Core3D.distortionTarget`) pisze przesunięcie w px (RG, osie ekranu; B = A = 0 — B / A należą do maskowania), mieszanie One / One. Szum `fxNoise.tile2D()` (ta sama tekstura co broń) we współrzędnych biegunowych wokół VP: kąt × 7 kafelków na obrót, ln(r) × 0,55 − zegar (anizotropia: komórki wydłużone promieniście — smugi „ciśnienia”), drugi próbnik drobniejszych zmarszczek (kanał B, udział 0,3); przesunięcie głównie radialne, 35% w poprzek; × maska boków × siła × 13 px (przy 1080 wierszach; kop najwyżej × 1,4). Próbki z poziomem 0 (`textureSampleLevel` — gałąź per piksel, szew `atan` bez linii: całkowita liczba kafelków na obrót). Post (`postGry.js`) dokłada aberrację R / B sam (≤ 2,5 px). Warstwę DIST zgłasza krok `Core3D.fx` „warp: boki kadru” (zgłoszenie z `WarpNurt.update` przepadałoby — flagę kasuje klatka efektów).
- **Strojenie po zrzutach:** pierwsza wersja (16 px, zmarszczki 0,6, kop × 2) „topiła” małe planety z boku przy kopie (Ziemia z wgryzem — kształt rozmyty o ~20 px) i robiła ze smug gwiazd „robaczki” — stąd 13 px, 0,3 i sufit kopu × 1,4.
- **Koszt (szacunek, bez pomiaru):** 1 rysunek (quad) + przebieg warstwy DIST (jedno `renderer.render`, ~40 µs CPU, gdy nie ma innych źródeł DIST); GPU: kolumna osi wychodzi wcześnie, boki — 2 próbki tekstury + ~40 ALU / piksel: ~0,05–0,15 ms przy 1080p, ~0,2–0,4 ms przy 5120 × 1440; w poście warstwa DIST włącza ścieżkę z trzema próbkami sceny zamiast jednej (cały kadr): ~0,1–0,3 ms przy 5K. Tylko w skoku.
- **Przełącznik:** `?warpFx=haze` (sam), w zestawie domyślnym; `WarpNurt.edge.tune.hazeAmpPx` (13), `hazeKickMax` (1,4), `hazeFlow` (0,85), `hazeAngN` (7), `hazeRadK` (0,55), `hazeTan` (0,35), `hazeFine` (0,3).
- **Ryzyka:** na stopklatce efekt widać słabo (gwiazdy lekko pofalowane) — żyje w ruchu; za mocny (> ~25 px) zaczyna „rozmazywać” gwiazdy jak brudna szyba. Duża planeta mijana bokiem też faluje (świadomie — leży po boku). Maskowanie gracza w skoku (rzadkie) dzieli ten sam cel DIST — sumy się dodają, bez konfliktu kanałów.

### W2 „Drobiny pędu” — ZBUDOWANE (domyślnie włączone)

- **Co widać:** cienkie biało-błękitne smugi (z nutą barwy palety warpa) wylatujące promieniście z punktu zbiegu ku bokom i rogom kadru, przyspieszające z odległością (jak mijane ciała w soczewce), dłuższe przy większej prędkości; na kopie gęstszy, szybszy „wystrzał”; co ~25. trochę jaśniejsza (lekki blask). Pod planetami, ringiem, stacjami i kadłubem.
- **Jak zrobione:** jedna siatka `Mesh` z `InstancedBufferGeometry` (1600 instancji, sam kwad — bez atrybutów instancji), pozycje ANALITYCZNE w shaderze wierzchołków z haszu `instanceIndex` (kąt od kierunku „za rufę” 0,16–1,85 rad w obie strony, faza, tempo 0,75–1,3, długość smugi 0,55–1,6, szerokość, jasność) i zegara życia: ln r liniowo od 0,05 H do za róg kadru (promień rośnie wykładniczo, tempo 1,7 ln r / s przy prędkości 1 — ciała soczewki w trawersie ~1,9 / s), smuga = tempo × migawka 0,06 s. Pass tła (warstwa 1, renderOrder 0,3 — okno (−0,5; 0) należy do pasa), głębia przy dalekiej płaszczyźnie z testem głębi, mieszanie `blendAddytywnePremul`, alfa wyjścia 0. HDR pod progiem bloomu (0,28 liniowo, w kopie najwyżej × 1,35, co ~25. × 2,4). Zero zapisu CPU per klatka poza uniformami, bez compute.
- **Koszt:** 1 rysunek, 1600 instancji × 2 trójkąty; fill ~0,3–0,5 Mpx addytywnie przy 1080p, hasz w wierzchołkach — poniżej ~0,05 ms GPU.
- **Przełącznik:** `?warpFx=czastki`, w zestawie domyślnym; `tune.dustCount` (1600, na żywo bez przebudowy — byle ≥ 2), `dustBright` (0,28), `dustLogSpeed` (1,7), `dustShutter` (0,06), `dustWidthPx` (2,4), `dustAng0` / `dustAng1`, `dustTint` (0,22).
- **Strojenie po zrzutach:** na ciemniejszym niebie skoku z `main` (niebo-sfera) 2048 drobin o jasności 0,34 dawało „śnieżycę” — 1600 i 0,28 zostawia wyraźny pęd bez zasłaniania gwiazd.
- **Ryzyka:** łatwo przesadzić z gęstością („deszcz”); drobiny rysowane POD planetami (pass tła) — gdyby miały być „bliżej kamery” niż mijane planety, trzeba je przenieść do passa gry (warstwa 0, nad planetami — decyzja D3).

### W3 „Zorza krawędzi” — ZBUDOWANE (tylko z adresu)

- **Co widać:** bardzo słaba, przygaszona poświata w barwach palety warpa okrętu (otoczka i poświata plazmy WARP, przesunięte ku szaroniebieskiej mgiełce) w pasach przy lewej i prawej krawędzi, z pasmami płynącymi od punktu zbiegu na zewnątrz; za rufą słabiej, przy wyjściu zwija się frontem.
- **Jak zrobione:** dwa kwady przy krawędziach (geometria tylko przy krawędziach — pas 0,34 wysokości, najwyżej 0,3 szerokości), w passie tła; ten sam szum (kanały R / A / G) i zegar co W1, spadek ku środkowi gładki.
- **Koszt:** 1 rysunek, 4 trójkąty, ~0,7 Mpx przy 1080p, 1 próbka tekstury — pomijalny.
- **Przełącznik:** `?warpFx=zorza`, `?warpFx=wszystko`; `tune.auroraStrength` (0,1), `auroraStrip` (0,34), `auroraSat` (0,45).
- **Ryzyka:** to w praktyce barwna winieta — przy mocniejszym ustawieniu zaczyna wyglądać jak mgławica przyklejona do ekranu (pierwsza wersja 0,22 przy pełnym nasyceniu: fioletowe pasy). Gryzie się z mgławicą tła w innych barwach. Na ciemnym niebie skoku (niebo-sfera z `main`) przy 0,1 czyta się jako niebieskofioletowa mgiełka pola warpa — to najbliższe „haze” w sensie mgły (W1 to „haze” w sensie gorącego powietrza / refrakcji).

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
| Kolejka passa tła | — | renderOrder 0,3 | 0,29 |
| Mieszanie | One / One (kolor i alfa) | One / One, alfa wyjścia 0 | jak W2 |
| Rozgrzewka | `warp: haze boków (DIST)` | `warp: drobiny i zorza boków` (`WARIANT_INSTANCJI`) | — |
| Bufory uniformów | 1 / etap | 1 / etap | 1 / etap |

- Poza skokiem wszystkie trzy siatki są schowane: 0 rysunków, 0 przebiegów DIST (gdy nic innego nie zgłasza warstwy). W skoku z zestawem domyślnym: +2 rysunki (+1 z W3) i +1 `renderer.render` (przebieg DIST, gdy nic innego go nie zgłasza). Pipeline'y synchroniczne w grze: 0 (wszystkie przebiegi zrzutów, oba tryby renderu — § 4).
- Graf każdego materiału budowany RAZ (wartości klatki — uniformy), bez `defines`, bez alokacji w `update` (rekordy wejścia i wyniku w miejscu).
- Szew renderu bez zmian: moduł nie importuje `src/game`, nie czyta `window` / DOM; przełącznik z `RenderWorld.pageSearch` (strona i worker).
- Stan klatki: `WarpNurt.edge.stats` (`on`, `strength`, `speed`, `kick`, `vpX` / `vpY` — px bufora od środka, y w dół, `haze` / `czastki` / `zorza`, `src` — „domyślnie” / „adres”).
- Testy: `tests/warpEdgeFx.test.mjs` — obwiednia (fazy, kop, przelot, wyjście, hipercruise = 0), przełącznik, maska i VP (lustra CPU), WGSL trzech materiałów z Node (≤ 12 buforów uniformów, ≤ 8 wejść, bez `pow`, B = A = 0 w DIST, próbki z poziomem), strażnik szwu, wpięcie w sterownik (fazy z automatu gry, hipercruise, kamera bez soczewki, DIST z kroku, chowanie bez klatki sterownika).

**Pomiar (orkiestrator, 2026-10-29):** `warp-ped-gra.mjs --koszt 1` (2,5 s próbek `Core3D.gpuFrameMs` od kopu w locie skoku, tryb off, headless 1600 × 900, ziarno 7, ABAB przy ciszy innych harnessów): zestaw domyślny 0,577 / 0,580 ms, `?warpFx=0` 0,603 / 0,567 ms (mediany) — różnica w szumie pomiaru przy tej rozdzielczości; pipeline'y synchroniczne po starcie 0 we wszystkich przebiegach. Przy 5120 × 1440 (~5 × pikseli) koszt W1 rośnie z pikselami — do sprawdzenia w grze (PerfHUD, `P`) przed decyzją D6.

## 4. Zrzuty

Narzędzie: `node scripts/webgpu/warp-ped-gra.mjs --out .tmp/<katalog> --query "warpFx=…&ziarno=7"` (TRAVEL TO Ziemia → Mars z przelotem obok Merkurego, stałe ziarno układu planet — ta sama trasa w każdym przebiegu; fazy 00–10: ładowanie, kop, przelot, dolot, zwolnienie, hamowanie, ślizg, po). Wszystkie na `main` 31f20c7a + ta gałąź (niebo-sfera w skoku, bez skał), 1600 × 900, tryb `off` (poza jednym przebiegiem w workerze). Katalogi w `.tmp/` worktree (nie w repo):

| Katalog | Zestaw | Uwagi |
|---|---|---|
| `nb-baza` | `?warpFx=0` | obraz przed zmianą (baza porównań) |
| `nb-dom2` | domyślny (W1 + W2) | wartości końcowe |
| `nb-haze` | W1 | |
| `nb-czastki` | W2 | |
| `nb-zorza` | W3 | |
| `nb-wszystko` | W1 + W2 + W3 | |
| `nb-dom-329` | domyślny, 2560 × 720 (32:9) | boki szerokiego kadru (wartości końcowe): drobiny i haze sięgają krawędzi, środek czysty |
| `nb-dom-worker` | domyślny, `renderWorker=1` | tryb gracza: obraz jak w `off`, 0 błędów konsoli strony i workera, 0 pipeline'ów sync w workerze przed i po starcie |
| `nb-baza-worker` | `?warpFx=0`, `renderWorker=1` | kontrola workera (skok β soczewki o 1 w jednej klatce przy końcu trzymania celu jest też tutaj — zastany, nie od tej zmiany) |
| `nb-porownania` | zestawienia | `0x-…_przed-po.png` (baza │ domyślny, fazy 01–06), `04-dolot_bok_warianty-1/2.png` (prawy bok w locie, 1:1: baza, W1, W2 / W3, domyślny, wszystko), `02-kop_planeta_z_boku.png` (mała planeta z boku w kopie), `04-dolot_off-worker.png`, `04-dolot_32-9.png` |

Co widać na zrzutach: środek kadru (statek, punkt zbiegu z celem, oś kursu) bez zmian w każdym wariancie; W2 daje wyraźne smugi pędu po bokach od kopu do wyjścia (pod planetami — mijany Merkury i ogromna tarcza Słońca je zasłaniają); W1 wygina smugi gwiazd i brzegi ciał z boku (na stopklatce subtelnie — efekt żyje w ruchu); W3 kładzie niebieskofioletową mgiełkę przy krawędziach; w zwolnieniu (05) wszystko znika frontem od dziobu ku rufie razem ze smugami gwiazd, w hamowaniu (06) i ślizgu kadr jest jak przed zmianą. Ładowanie (01) — prawie niewidoczne (siła 0,35 dopiero pod koniec).

## 5. Domyślny zestaw: W1 + W2

- **W1** jest wprost tym, o co chodziło („haze mocniejszy po bokach, nie na statku”) — w słowniku gry „haze” to refrakcja (gorące powietrze, fale), a ta siedzi tylko po bokach i nie tknie statku. Sam W1 na stopklatce jest subtelny, w ruchu tło faluje.
- **W2** daje to, czego najbardziej brakowało: czytelne poczucie pędu po bokach, spójne z soczewką (te same promienie z punktu zbiegu co mijane planety), pod planetami — nic nie rysuje się po ciałach (dawna skarga na drobiny ośrodka przed dziobem), bez świecących okręgów.
- **W3 poza domyślnym:** to barwna winieta — ładnie wygląda na ciemnym niebie skoku, ale to najbardziej „ozdobny” element, a wcześniejsze decyzje (ośrodek przed dziobem, świecące pierścienie) szły w stronę mniej ozdób na rzecz soczewki. Jest pod `?warpFx=wszystko` / `?warpFx=haze,czastki,zorza` do oceny.

## 6. Decyzje dla użytkownika

- **D1 — zestaw domyślny:** W1 + W2 (dziś) / + W3 (zorza krawędzi jako „mgiełka” pola warpa) / inny. Ocena w grze: `?warpFx=wszystko` vs bez parametru.
- **D2 — siła haze (W1):** dziś 13 px przy 1080 wierszach (≈ 17 px przy 1440), kop × 1,4. Mocniej = wyraźniejsze falowanie, ale małe planety z boku zaczynają się „topić”; na żywo `WarpNurt.edge.tune.hazeAmpPx` (tryb `?renderWorker=0`).
- **D3 — drobiny pod planetami czy nad nimi:** dziś pod (pass tła — planeta z boku je zasłania, „daleki pył”); nad planetami (pass gry, pod kadłubami) czytają się jak pył tuż przy kamerze, ale wtedy rysują się po tarczach mijanych ciał.
- **D4 — gęstość i jasność drobin:** dziś 1600 / 0,28; `tune.dustCount`, `tune.dustBright` na żywo.
- **D5 — które opisy budować dalej:** W5 (przebicie przy kopie), rozszerzenie W6 (przypływ na froncie wyjścia), W7 (tempo napędu Mk I–III w obrazie), W8 (opływ mijanej planety), W9 (pył przy przejściu przez pas), W4 (zoom blur — tylko jeśli W1 + W2 za słabe; zmiana `postGry.js`).
- **D6 — preset grafiki:** efekty nie są dziś w presetach (`src/game/graphicsQuality.js`); propozycja: preset Niska bez W1 (oszczędza przebieg DIST i trzy próbki sceny w poście), drobiny × 0,5.

Nie mierzyłem wydajności (FPS, `gpuFrameMs`) — szacunki w § 2; pomiar zostaje dla sesji wydajności.
