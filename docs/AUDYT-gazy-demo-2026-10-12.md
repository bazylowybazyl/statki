# Audyt fizyki warstwy „gazy, mgła, pył” (demo `dema/gazy-webgpu.html`) — 2026-10-12

Zakres: demo gazów w płaszczyźnie gry — mapa gazu z szumu, „ruch gazu” (compute 256 × 256 komórek po 64 j.), mapa
światła (marsz ku Słońcu), złożenie 8 plasterków z głębią, pył (160 tys. drobin), sceny pas / ring (kominy, chłodnie,
pochodnie) / mgła. Warstwa ma wejść do gry jako mgła, drobiny pyłu i elementy przemysłowe (etapy 2–4 `docs/PLAN-gazy.md`).
Ocena użytkownika: „średnio mi się podoba jej feel, nie jest production ready”. Żadnych zmian w kodzie — sam audyt.
Poprzednia ocena (2026-10-06, pamięć sesji): „ściany” pyłu z pudła `fract`, pył stoi przy 8 mln j., koszt 1,2 ms przy
1600 × 900 — tamte ustalenia zostają w mocy, tu chodzi o FIZYKĘ i FEEL.

Metoda: przegląd kodu (cały plik, 1982 wiersze) i pomiar w działającym demie (headless Chrome, odczyt tekstur i buforów
z GPU: mapa gazu `rtA`, pole symulacji `simTex`, bufor prędkości, bufor drobin): `node scripts/webgpu/gazy-demo-audyt.mjs`
(sceny, strumień dyszy w skałę, korelacja pyłu z gazem; wyniki `.tmp/audyt-gazy/`) i `gazy-demo-audyt-mgla.mjs` (kanał po
przelocie przy wietrze 0, pas strumienia przy ciągu w miejscu; `.tmp/audyt-gazy3/`); dziura po wybuchu z wiatrem —
`.tmp/audyt-gazy2/raport.json`. Zrzuty w tych katalogach.

## 1. Werdykt w skrócie

1. **To nie jest symulacja gazu, tylko ZNIEKSZTAŁCANY SZUM.** Gęstość gazu to funkcja położenia w świecie (fbm), a
   „ruch gazu” liczy pole przemieszczeń D i mnożnik gęstości m, którymi szum jest przesuwany i skalowany przy próbkowaniu
   (`gasMap`: `q = p − D`, `acc · m`). D wraca do zera z τ = 12 s, m do 1 z τ = 5 s (`fldStep`). Gaz nie jest NIGDZIE
   transportowany: każde zaburzenie cofa się samo do stanu sprzed — kanał po okręcie i dziura po wybuchu goją się
   „gumowo”, choć prędkość gazu jest już zerowa. Pomiar (wiatr 0): kanał po przelocie 500–550 j. szerokości, gęstość
   w środku 0,30 → 0,00 → 0,19 → 1,26 → 1,49 (0,5 / 4,7 / 8,2 / 13,5 / 19 s; boki 1,75) przy prędkości gazu w środku
   23 → 3 → 1 → 0 j/s i D 1750 → 587 → 67 j. Gaz „wraca” bez ruchu — to jest sedno „feelu”, którego nie da się
   nastroić parametrami.
2. **Brak ciśnienia i przeszkód.** Pole prędkości to siły + adwekcja + wiry + opór, bez rzutu (dywergencja rms = 15 %
   rms prędkości, 3× więcej niż w polu hal). Skały i ring nie istnieją dla gazu (`velStep` nie ma komórek stałych):
   strumień dyszy przez skałę o promieniu 197 j. — prędkość wzdłuż osi przed 995, W skale 1274–1500, za skałą
   1597 j/s; D narasta 408 → 1056 → 1651 j. Sugestia, że to demo „fajnie omija przeszkody”, dotyczy dema wybuchów
   (gaz 3D z przeszkodami), nie tego.
3. **Dysza nie pcha gazu, tylko go kasuje.** Siła strumienia (`wake`) rozpędza gaz wzdłuż 1500 j. do 2000 j/s, a
   dywergencja rozrzedza m do 0,05 w CAŁYM pasie (6 s ciągu w miejscu: pas 0,07–0,10 wobec boków 1,6–1,7, bez
   żadnego zagęszczenia po bokach ani na końcu). Na ekranie: ostro obrysowana ciemna RURA za rufą i przed dziobem
   (`C1-ciag-6s.png`), nie pióropusz spychanej mgły.
4. **Pył jest jednorodną posypką niezwiązaną z gazem.** 160 tys. drobin w pudle wokół kamery, zawijanych `fract`; średnia
   gęstość gazu pod drobinami 1,069 wobec średniej mapy 1,053, 17,1 % drobin w pustych komórkach przy 17,1 % pustej
   powierzchni — korelacja zero. W pustej przestrzeni między ławicami pył jest tak samo gęsty jak w nich; do tego pudło
   zmienia rozmiar z zoomem i proporcją okna (znane „ściany”).
5. **Elementy przemysłowe to animowane stożki szumu.** Dym kominów i para chłodni (`jetDensity`) to stożek o stałej
   długości (5200 + 6 h j.), stałym wygięciu (`C.w`) i kłębach przesuwanych wzdłuż osi stałym tempem (`t · 0,9`). Nie
   reagują na wiatr (`uWind` tylko w gałęziach scen), nie rozpływają się w smogu, nie rzucają cienia (okludery to skały
   i 3 koła na okręt), ring nie zasłania Słońca w smogu. Pochodnie = światło punktowe + kwad. Wszystkie kominy dymią w
   tym samym rytmie.
6. **Wiatr nie jest przepływem.** `uWind · t` przesuwa WZÓR szumu (mgła 57 j/s = 3,4 km na minutę), a symulacja (D, m,
   wyrzut) stoi w świecie: dziura po wybuchu zostaje w miejscu, a ławica przepływa przez nią (po 25 s wzór odjechał
   o 1428 j., m w punkcie wybuchu wróciło do 1). Dym kominów wiatru nie widzi wcale.
7. **Obraz: płaskie białe plamy.** Jedno rozpraszanie (`alb · Lin · (1 − e^−τ)`), bez rozpraszania wielokrotnego, bez
   fazy HG (Słońce w mgle nie daje poświaty), bez samocienia w pionie, światła dynamiczne liczone w JEDNYM punkcie na
   piksel (z = 40) dla wszystkich plasterków i nie tłumione przez gaz. Ławice mgły (fbm 5 oktaw, skala 6500 j., brzeg
   `smoothstep(0,52; 0,6)`) wyglądają jak rozmyte białe kleksy; wybuch w gęstej ławicy (α 2,4) to po 0,4 s ledwie
   widoczny cień (m 0,11 → α ≈ 0,3 — wciąż mleczne), bo błysk gaśnie e^(−3,2 t), a dziura nie ma jasnego wału.
8. **Co jest dobre i zostaje do portu:** złożenie 8 plasterków przyciętych głębią z próbką-odcinkiem (po naprawie
   „rozwarstwienia” z 2026-10-06), mapa światła z marszem ku Słońcu po odcinkach, siatka świateł dynamicznych w ośrodku,
   gaz jako warstwa ±420 j. z profilem cos, albedo per gaz (pył rdzawy, siarka, lód amoniakalny), MRT „fx” przygaszane
   górną połową warstwy, koszt (227–267 kl/s bez limitu przy 1600 × 900 — ~4 ms klatki, wcześniej zmierzone 1,2 ms GPU).

## 2. Liczby

Strumień dyszy w skałę (pas, ciąg w miejscu W + S 4 s, skała r = 197 j., 700 j. od rufy; s — odległość od wylotu):

| s [j.] | gdzie | v wzdłuż [j/s] | D [j.] | m |
|---|---|---|---|---|
| 150 | przed | 528 | 150 | 0,06 |
| 400 | przed | 995 | 408 | 0,06 |
| 720–1074 | SKAŁA | 1274 → 1500 | 678 → 1056 | 0,07–0,14 |
| 1344 | za | 1597 | 1263 | 0,18 |
| 1794 | za | 1578 | 1651 | 0,37 |
| 2394 | za (koniec siły) | 0 | 0 | 1,00 |

Kanał po przelocie (mgła, wiatr 0, przelot 2 s do ~1200 j/s, przekrój w stałym punkcie P; boki = 16 skrajnych próbek
±1400 j.):

| t po zatrzymaniu [s] | α środek | α boki | kanał (< 35 % boków) | D środek [j.] | m środek | v gazu [j/s] |
|---|---|---|---|---|---|---|
| przed | 1,49 | 1,75 | — | 0 | 1,00 | 0 |
| 0,5 | 0,30 | 1,72 | 500 j. | 1750 | 0,23 | 23 |
| 4,7 | 0,00 | 1,75 | 550 j. | 1224 | 0,56 | 3 |
| 8,2 | 0,19 | 1,75 | 500 j. | 913 | 0,75 | 1 |
| 13,5 | 1,26 | 1,75 | 0 | 587 | 0,91 | 0 |
| 19,3 | 1,49 | 1,75 | 0 | 369 | 0,97 | 0 |
| 29,1 | 1,71 | 1,75 | 0 | 162 | 1,00 | 0 |

Pas strumienia (mgła, wiatr 0, ciąg w miejscu 6 s; α pasa = średnia ±120 j. od osi, boki ±600–800 j.):

| s [j.] | v wzdłuż | m | D [j.] | α pas przed | α pas po | α boki po |
|---|---|---|---|---|---|---|
| 100 | 398 | 0,07 | 83 | 0,30 | 0,10 | 1,60 |
| 600 | 1354 | 0,05 | 577 | 1,48 | 0,07 | 1,63 |
| 900 | 1607 | 0,05 | 821 | 1,71 | 0,07 | 1,72 |
| 1500 | 2062 | 0,05 | 1425 | 0,51 | 0,07 | 0,78 |
| 1900 | 2014 | 0,06 | 1782 | 0,01 | 0,08 | 0,77 |
| 2400 | −1 | 0,85 | 9 | 1,16 | 0,93 | 1,14 |

Dziura po wybuchu (mgła, wiatr 57 j/s, α₀ = 2,38): m w środku 0,11 / 0,28 / 0,44 / 0,71 / 0,90 / 1,0 po 0,9 / 3,3 / 5,2 /
9,5 / 16 / 25 s; wał zagęszczenia m = 2,4 przy r = 1500 j. (3–5 s) → 1,4 (16 s) → 1,1 (25 s); D do 819 j. przy
r = 1200 (3,3 s). Wzór mgły w tym czasie odpłynął o 186 / 297 / 537 / 902 / 1428 j.

Pył a gaz (mgła, 132 tys. drobin w mapie): średnia α pod drobinami 1,069, średnia α mapy 1,053; drobiny w komórkach
α < 0,08: 17,1 %, pole takich komórek: 17,1 %. Pudło pyłu: ±3476 × ±1955 × ±340 j. przy z = 4800.

Dywergencja / prędkość rms (komórki z |v| > 30 j/s): 0,154–0,155 w każdym pomiarze (hala K-7 z rzutem: 0,05).

## 3. Braki — ranking (co trzeba zmienić, żeby warstwa była „production ready”)

1. **Gęstość musi być TRANSPORTOWANA, nie zniekształcana.** Skalar gęstości (na gaz: pył, siarka, lód, dym, para)
   adwektowany polem prędkości z rzutem ciśnienia i komórkami stałymi — silnik ISTNIEJE w grze: `src/3d/gasField/gasField2D.js`
   (RK2 + MacCormack, Jacobi z Neumannem na przeszkodach, kadłuby maską obrysu z belek, źródła, pył zalegający, para).
   Szum zostaje jako (a) POLE DALEKIE poza oknem symulacji i warunek dopływu na brzegu okna (ławice, smog, mieszanka
   pasa z `fieldMap.js`), (b) faktura detalu niesiona polem pozycji spoczynkowych (jak w `gasFieldLayer.js`), nie jako
   gęstość. Okno symulacji jak w demie (siatka wokół kamery przesuwana o całe komórki), ale z inicjalizacją komórek
   wjeżdżających z pola dalekiego. Wtedy: kanał zostaje, póki gaz nie napłynie; dziura po wybuchu ma wał i zamyka się
   dopływem; przelot zostawia wiry, nie gumę.
2. **Dysze i wybuchy jako ŹRÓDŁA OBJĘTOŚCI** (cel dywergencji > 0 w stożku / kuli, jak `expansion` w `gasGrid.js` i
   poprawka 1 z `docs/AUDYT-pyl-hali-2026-10-12.md`): strumień wtedy SPYCHA mgłę (wał z boków i na czole), nie wysysa
   jej z pasa; wybuch robi jamę z jasnym wałem, która zostaje.
3. **Przeszkody:** skały (koła / obrysy SDF olbrzymów), ring (płyta ze ścianami jak K-7), kadłuby maską obrysu — w polu
   prędkości (komórki stałe), nie tylko dla cząstek i cieni.
4. **Wiatr jako prędkość tła** w polu (dryf wzdłuż orbity, odgazowanie od Słońca) — ławice, dym i dziury płyną razem;
   bez przesuwania wzoru pod symulacją.
5. **Kominy, chłodnie, pochodnie, odgazowanie skał = ŹRÓDŁA w polu** (gęstość + prędkość wylotu + ciepło, każdy komin
   z własną fazą i wydajnością z harmonogramu, jak zawory hali `hallGasSources.js`): dym pochyla się z wiatrem, rozpływa
   w smogu, okręt go rozcina, pochodnia oświetla go z siatki świateł; ring jako okluder marszu ku Słońcu. Odgazowanie
   lodowych skał: źródło po stronie dziennej z kierunkiem od Słońca (dziś `jetDensity` — stożek-reflektor).
6. **Pył = drobiny TAM, GDZIE JEST GAZ.** Rodzenie / gaszenie z gęstości pola (budżet na komórkę), ruch z pola prędkości,
   światło z tej samej mapy światła i siatki (dziś: brak słońca i samocienia na drobinach), początek przy kamerze
   (`FxPoolOrigin`), bez pudła `fract`. Alternatywa do decyzji: rezygnacja z drobin w mgle (gra ma już `SpaceDust3D`
   dla wrażenia lotu) i tylko ziarno w fakturze gazu.
7. **Obraz:** rozpraszanie wielokrotne (przybliżenie jak w `gasVolume.js`), faza HG z poświatą Słońca, światła
   dynamiczne per plasterek z tłumieniem przez gaz nad nimi, samocień w pionie (profil warstwy), detal dwóch skal
   (duże ławice + kłęby 300–800 j. + ziarno) — a nie 5 oktaw jednego fbm. Błysk wybuchu w gazie dłuższy (0,5–1 s) i
   z jamą o wale.
8. **Drobiazgi:** `mediumLight` liczone raz na piksel (z = 40) dla wszystkich plasterków; okludery cienia to koła
   (3 na okręt); `bodyA` (3 koła, r 250 · skala) zamiast obrysu; sufit prędkości 2600 j/s; brak jakiegokolwiek zaniku
   dymu w próżni poza relaksacją m.

## 4. Co zostaje bez zmian (do portu 1:1)

Złożenie plasterków z próbką-odcinkiem i profilem cos (`hdrNode`), mapa światła (`lightMap`: marsz odcinkami, próbka
z gradientem), albedo per gaz i mieszanie barw w `acc`, cel „fx” w MRT przygaszany górną połową warstwy, siatka świateł
dynamicznych (w grze: `Core3D.fx.grid`), pas skal: SLAB ±420 j., komórka 64 j. (hala: 28 j.; dla mgły 48–64 j. wystarczy),
okno symulacji wokół kamery.

## 5. Zalecana droga do gry (etapy 2–4 planu gazów)

1. **Prototyp w demie (bez gry):** podmiana `velStep` / `fldStep` / warpu na transportowaną gęstość z `gasField2D.js`
   (port silnika do dema albo odwrotnie — demo na Core3D jak `dema/wybuchy-webgpu.html`), pole dalekie z dzisiejszego
   `gasMap`, źródła objętości dysz, przeszkody-skały, wiatr jako prędkość tła. Miary: kanał po przelocie trwa > 30 s i
   zamyka się dopływem (v > 0 w środku), pas strumienia z wałem po bokach (α boki > przed), gaz nie przechodzi przez
   skałę (v wzdłuż za skałą ≈ 0), dywergencja / prędkość ≤ 0,06. Narzędzia: oba skrypty audytu (ten sam odczyt z GPU).
2. **Moduł gry `src/3d/gasLayer/`** na szwie gra ↔ render jak hale (`Float64Array` wejścia: kamera, okręty z maską
   obrysu, źródła, przeszkody), krok `Core3D.addFxStep`, siatki w passie ortho (tył pod kadłubami, ułamek z przodu),
   rozgrzewka; pole dalekie z `fieldMap.js` (pas) / planu ringu (smog, kominy) / definicji ławic.
3. **Sceny:** pas (gaz z `fieldMap`, zamiast płatów `fog.js` — nie obok), ring Jowisza (kominy z planu Fable), ławice
   mgły (obiekt świata z czujnikami — decyzje w `PLAN-gazy.md`).

## 6. Decyzje dla użytkownika

- D1. Jeden silnik dla wszystkich gazów (pole 2D z transportem, jak hale) — tak / nie.
- D2. Drobiny pyłu: związane z gazem (rodzą się z gęstości) czy wycofane na rzecz faktury (gra ma `SpaceDust3D`).
- D3. Kolejność scen: ring (fabryki) / pas / ławice mgły.
- D4. Wiatr jako prawdziwy przepływ (ławice płyną, dym się pochyla) — tak / nie.
- D5. Skala komórki i okna: 64 j. × 256 (16 km, jak demo) czy 48 j. × 384 (18 km, drobniejsze kłęby, ~2× koszt).
