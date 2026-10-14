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

## 7. Prototyp: gęstość TRANSPORTOWANA (2026-10-12, etap 1 z § 5) — `dema/gazy-transport-webgpu.html`

Kopia dema (stare `dema/gazy-webgpu.html` zostaje jako A/B; wpis w `dema/index.html`). Bez zmian w grze. Pomiary: te same
skrypty z `--demo transport` (stare — bez flagi; nowe miary w skryptach działają dla obu dem): `node scripts/webgpu/gazy-demo-audyt.mjs
--demo transport` i `node scripts/webgpu/gazy-demo-audyt-mgla.mjs --demo transport` (w nim teraz także minimum przekroju kanału,
dopływ do osi, wał pióropusza jako maksimum profilu poprzecznego i wybuch w ławicy przy wietrze 0 — faza D), strojenie w locie
`--tune k=v,…`. Wyniki: `.tmp/gazy-transport/` (`audyt-stare|nowe/`, `mgla-stare|nowe/`, `zestawienie.md`, `fps.json`), zrzuty
obok siebie (lewa — stare, prawa — nowe): `.tmp/gazy-transport/ab/*.png`.

### 7.1 Co jest w prototypie

- **Pole gazu 2D z transportem** (compute, bufory f32 — zapis f16 do tekstury storage na RTX obcina ku zeru): okno 256 × 256
  komórek po 64 j. wokół kamery, przesuwane o całe komórki (osobny kernel przesunięcia; komórki wjeżdżające — pole dalekie).
  Kernele w jednym `renderer.compute(lista)`, krok stały 1/60 s (≤ 2 na klatkę): wiry → adwekcja RK2 prędkości + siły → MacCormack
  skalarów obcięty do sąsiadów + ciągłość + wstrzykiwanie → dywergencja − cel → Jacobi 31 (rozgrzanie 0,9, miękki rzut 0,004) →
  rzut (komórki stałe — Neumann, brzeg okna otwarty). Skalary: gęstość każdego gazu sceny (pas: pył, siarka, lód; ring: smog,
  dym, para; mgła: mgła) + wyrzut.
- **Pole dalekie** = dawny `gasMap` bez drobnej faktury (obwiednia gęstości gazów, wzór płynie z wiatrem): start okna, komórki
  wjeżdżające, dopływ przez brzeg (próbka wstecz poza oknem), gęstość odniesienia. **Faktura detalu** (włókna siarki i lodu,
  wnętrze ławic, kłęby dymu, ziarno) — w obrazie, na pozycjach spoczynkowych niesionych polem (jak `gasFieldLayer.js`).
  Mapa gazu (`rtA`) = gęstości z symulacji × albedo gazu × faktura; próbka gęstości dwusześcienna (dwuliniowa dawała schodki na
  brzegach ławic); kolumna gazu nad bryłami (kadłub, skała) z otoczenia — warstwa ±420 j. jest grubsza niż bryły, więc okręt
  dalej chowa się w mgle. Mapa światła, złożenie plasterków, MRT „fx” — bez zmian.
- **Ciśnienie gazu**: cel dywergencji κ·(ρ − ρ_ref)/max(ρ_ref, 0,3), κ = 0,012/s — rozrzedzony kanał / dziura zbiega się
  (gaz wpływa z boków), zagęszczony wał rozpływa się. To jedyny mechanizm „powrotu”: gaz płynie, nic nie wraca samo.
- **Strefy ściśliwe** (stożek dyszy i pocisku, front wybuchu z wnętrzem, pas „pługa” 130 j. wokół kadłuba; pamięć 1 s): rzut nie
  poprawia tam dywergencji — pchnięty gaz piętrzy się na brzegu strefy (wał), pas za strumieniem i ślad za rufą zostają puste.
  Gęstość: Dρ/Dt = −ρ·∇·v z faktycznej dywergencji prędkości, sufit zagęszczenia 3 × ρ_ref + 0,6.
- **Przeszkody** = komórki stałe: skały (koło r·0,9), wstęga ringu (R ± half, łuk sceny), kadłuby (5 kół na okręt, prędkość
  okrętu + ω × r); strumienie zasłonięte skałami i ringiem (odcinek komórka → wylot). „Pług”: gaz przy burcie od strony ruchu
  dostaje normalną prędkość burty (tylko pchanie).
- **Wiatr** = prędkość tła (cel oporu, prędkość na brzegu okna); wzór pola dalekiego płynie z nim tak samo — nic nie przesuwa
  się pod symulacją. Ring dostał wiatr wzdłuż orbity (−40, 6 j/s).
- **Opór**: ku wiatrowi 0,2/s; w próżni (ρ < 0,25) +2/s; kwadratowy 0,3·|v − wiatr| [1/komórka] poza stożkami. Zanik w próżni
  0,002/s (gaz zachowany), dym 0,02/s, para 0,12/s, wyrzut 0,04/s.
- **Źródła** (do 64 na klatkę): dysze MAIN (ciąg ponad jałowy) i wsteczne — narzucona prędkość w stożku wzdłuż osi i na boki
  (pióropusz się rozchyla); pociski — gaz wleczony za pociskiem; wybuch — front wypychający gaz (1400 j/s × (1 − wiek/życie)²) +
  wyrzut z emiterów; kominy (dym) i chłodnie (para) — gęstość + wylot 420–520 j/s na zewnętrznej krawędzi wstęgi, każdy z własną
  fazą i wydajnością; odgazowanie lodowych skał — struga od Słońca z wylotem nad powierzchnią skały. Po zmianie sceny 3 s pola
  z 4× szybszym czasem (dym i dryf rozwinięte od razu).
- **Pył**: 160 tys. drobin rodzi się w kadrze × 1,25 w komórce przyjętej z prawdopodobieństwem (ρ/ρ₀)³ (do 6 prób na klatkę),
  leci z prędkością gazu, gaśnie po życiu 4–10 s (w rzednącym gazie do 6× szybciej), ginie poza oknem i w komórce stałej; światło
  ze Słońca przez mapę światła (samocień gazu i cienie brył) + światła dynamiczne. Pudło `fract` usunięte.
- Strojenie w konsoli: `__demo.simTune` (+ `__demo.syncSimTune()`); G — pole wyłączone = samo pole dalekie.

### 7.2 Co wyszło inaczej niż w planie (§ 5 pkt 1) — i dlaczego (pomiary)

1. **Źródło objętości dysz i wybuchów (cel dywergencji > 0) — odrzucone.** W polu 2D nieściśliwym objętość kumuluje się bez
   końca: przy wydatku dopasowanym do śladu kadłuba 6 s ciągu w miejscu wypchnęło ~3 km² mgły (α boków 1,5 → 0,04), a cały
   kadr płynął promieniście (faktura rozciągnięta w smugi). Przy małym wydatku strumień tylko przestawiał mgłę, a kanał po
   przelocie zasklepiał się w ~5 s. Zamiast tego STREFA ŚCIŚLIWA w stożku / na froncie (wał na jej brzegu, rozmiar = rozmiar
   strumienia). Parametr `jetVol` został (0).
2. **Kanał po przelocie** zamykał się w kilka sekund z trzech powodów, każdy zmierzony osobno: nieściśliwość domykała ślad za
   kadłubem (ślad ściśnięty w kreskę) → pas „pługa” jest ściśliwy; pas spalin po zgaszeniu silnika płynął dalej i zasysał mgłę
   od strony okrętu → opór w próżni; brzegi kanału błądziły (turbulencja 0,02, dyfuzja 0,15) → 0,008 i 0,05, κ 0,035 → 0,012.
   Jałowy płomień (0,12) nie dmucha w pole — stojący okręt wywiewał gaz za rufą.
3. **Dywergencja ≤ 0,06** dotyczy pola nieściśliwego (poza strefami pchanymi): 0,015–0,016, reszta rzutu 0,012–0,014. Surowa
   po całym oknie 0,11–0,14 (stare: 0,155) — strefy pchane są ściśliwe z założenia.
4. **Kominy** stoją na wstędze ringu, a wstęga jest przeszkodą — wylot przeniesiony na zewnętrzną krawędź wstęgi (150–290 j.
   od komina).

### 7.3 Miary A/B

| miara (cel) | stare | nowe |
|---|---|---|
| kanał po przelocie trwa > 30 s, zamyka się dopływem — minimum przekroju / boki (dopływ do osi [j/s]) | 0,03 (5 s) → 0,22 (9 s) → 0,66 (15 s) → 0,81 (30 s); dopływ 0 („guma”) | 0,02 (7 s) → 0,05 (11 s) → 0,12 (17 s) → 0,29 (34 s) → 0,37 (45 s); dopływ 2–12, raz −1 |
| pas strumienia (ciąg w miejscu 6 s): α pasu; wał = max profilu poprzecznego przed → po (s ≤ 1200 j.) | pas → 0,07; boki ±600–800 bez zmian (1,62 → 1,59); jasne obrzeża rury 3,5–5,9 tuż przy pasie (|y| 325–375 j.) | pas → 0–0,07; wał 1,54–1,71 → 1,65–2,02 (×1,0–1,3, s ≤ 1200 j.); dalej (s ≥ 1500) pióropusz szerszy niż sonda ±600–800 — tam sonda trafia w pas (1,86 → 1,21, 1,72 → 0,4) |
| gaz nie przechodzi przez skałę: v wzdłuż za skałą, przesunięcie w skale | 1603 / 1589 j/s; przesunięcie 898–1060 j. | −45 / −9 / 57 j/s; w skale v = 0, przesunięcie 0 |
| dywergencja / prędkość ≤ 0,06 | 0,155 | pole nieściśliwe 0,015–0,016 (reszta 0,012–0,013); całe okno 0,10–0,14 |
| pył: średnia α pod drobinami ≥ 2× średniej mapy | 1,02–1,03× (pas, ring, mgła); w pustych komórkach tyle, ile pustej powierzchni (15–60 %) | pas 5,2×, ring 2,1×, mgła 1,5×; w pustych 0–2 % przy 15–63 % pustej powierzchni |
| wybuch w ławicy (wiatr 0): środek, wał / dalej, zamykanie | środek 0,83 → 1,65 (10 s) → 3,0–5,1 (16–36 s, ponad α₀ 2,8); wał cienki, wędruje na r 1,6–1,7 km i znika | dziura α 0,04–0,13 przez 40 s; wał 1,6–2,2 na r 0,8–1,0 km wobec 0,7 dalej (12 s), potem rozpływa się (1,2 na r 1,4 km); krawędź (r 500 j.) 0,39 → 0,14 (4 s) → 0,46 (19 s) → 0,83 (40 s), prędkość promieniowa −1…−3 j/s (do środka) |

Pył w mgle (1,5×) nie spełnia progu 2×: ławice zajmują ~80 % kadru, więc górna granica to max α / średnia ≈ 2,3, a budżet drobin
∝ gęstości daje z definicji 1 + CV² ≈ 1,3×; przyjęcie ∝ ρ³ daje 1,5×. Wyższy wykładnik zgniótłby pył do samych rdzeni ławic —
do decyzji (D2).

### 7.4 Koszt (1600 × 900, bez limitu klatek — headless bez vsync; 2 rundy na przemian, średnia)

| scena | stare [kl/s] | nowe [kl/s] |
|---|---|---|
| pas | 240,6 | 291,3 |
| ring | 240,7 | 290,4 |
| mgła | 244,7 | 292,4 |
| mgła, ciąg w miejscu (W + S) | 246,6 | 292,3 |

Próg ≥ 150 kl/s bez limitu spełniony z zapasem (≥ 60 z vsync — tym bardziej). Nowe jest szybsze: mapa gazu nie liczy już pełnego fbm na piksel (pole dalekie tylko przy brzegu okna, faktura tańsza), a pole
liczy się 60 razy na sekundę, nie co klatkę. Z vsync (60 Hz) oba mają duży zapas.

### 7.5 Do oceny i dalej

- Wygląd strumienia: pas za dyszą jest pusty (czarny), po bokach wał i para wirów (rozruch strugi) — inny charakter niż „rura”
  starego dema; `ab/C1-ciag-6s.png`, `ab/C2-po-6s.png`. Szerokość pióropusza: `widen` 0,3, wypychanie na boki ×2,0 (`buildSimInputs`).
- Faktura mgły w spoczynku jest gładsza niż w starym demie (obwiednia na siatce 64 j. + faktura detalu) — `ab/10-fog.png`.
- Teleport okrętu w gaz (`__demo.place`) wycina dziurę w kształcie kadłuba — artefakt dema.
- DRŻENIE GAZU PRZY LOCIE (zgłoszenie użytkownika 2026-10-13, naprawione): okno symulacji przesuwało się o komórkę w KAŻDEJ
  klatce, w której kamera przekroczyła granicę komórki, a tekstury obrazu (`simTex`, `restTex`) zapisuje dopiero `kProject`
  w kroku 1/60 s — w klatce z przesunięciem bez kroku obraz czytał stare tekstury z nowym początkiem i cały gaz skakał
  o 64 j., po czym wracał w następnym kroku. Na 144 Hz ~2/3 przesunięć trafiało w klatkę bez kroku (przy 1500 j/s:
  kilkanaście skoków na sekundę; różnica obrazu między klatkami 2,3–2,9 wobec 1,2). Teraz okno przesuwa się tylko
  w klatce z krokiem (albo przy starcie sceny). Pomiar deterministyczny (rAF kroczony w zadanej częstotliwości, autopilot
  `__demo.move`): `node scripts/webgpu/gazy-transport-drzenie.mjs [--hz 144] [--scena belt|ring|fog]` — po naprawie 0
  przesunięć bez kroku, maks. różnica 1,36. Przy porcie okna wokół kamery do gry: początek okna i tekstury obrazu muszą
  zmieniać się w tej samej klatce.
- Dla portu (§ 5 pkt 2): nowa decyzja **D6** — w otwartej przestrzeni strefy ściśliwe (pchnięcie bez źródła objętości) zamiast
  źródła objętości dysz z hal K-7 (`gasField2D.js`). Czy źródło objętości z silniejszym miękkim rzutem (hale: soft 0,01) by
  wystarczyło w oknie 16 km — niesprawdzone.
