# Audyt pyłu i gazu w hali K-7 (pole gazu 2D) — 2026-10-12

Zakres: pole gazu 2D hal K-7 (`src/3d/gasField/gasField2D.js` — kernele, `hallDust.js` — strumienie dysz i źródła,
`hallDustLayout.js` — domena i rastr, `gasFieldLayer.js` — obraz) i wejście z gry (`src/game/hallDustInput.js`).
Zgłoszenie użytkownika: „ma braki w fizyce”: (1) OBJĘTOŚĆ — pył wypchnięty raz do tyłu wygląda ładnie, potem „już nie leci”;
(2) TUNEL, który zostawia za sobą Atlas, jest za wąski w stosunku do pięciu dysz MAIN; (3) demo wybuchów
(`dema/wybuchy-webgpu.html`, gaz 3D `src/3d/gas/gasGrid.js`) „fajnie omija przeszkody”. Żadnych zmian w kodzie — sam audyt.

Metoda: przegląd kernelów i kleju, pomiar w prawdziwej grze (`node scripts/webgpu/hala-pyl-audyt.mjs`, wyniki w
`.tmp/audyt-pyl/`): Atlas na C-01 hali 0 Ziemi rufą do ściany tylnej, trzy odpalenia MAIN po 5 s z przerwami 6 s, potem lot ku
bramie; po każdym kroku odczyt tekstur pola z GPU (gęstość pyłu w powietrzu i na pokładzie, prędkość, flagi) → bilans pyłu,
profil prędkości i gęstości w poprzek osi dysz, residuum dywergencji po rzucie; A/B liczby iteracji Jacobiego na tym samym
stanie; obrazy pól (`*-pole-pyl.png`, `*-pole-pokl.png`, `*-pole-v.png`) i zrzuty gry.

## 1. Werdykt w skrócie

1. **Oba zgłoszenia mają JEDNĄ przyczynę w modelu strumienia: dysza NARZUCA prędkość, ale nie wnosi gazu.** Strumień MAIN to
   stożek, w którym prędkość gazu jest dociągana do zadanej (`mix(vel, target, rate·dt·prof)`), a rzut ciśnienia trzyma pole
   nieściśliwe. Taki strumień nie wypycha pyłu na boki — ZASYSA go z boków (entrainment). W prawdziwym silniku rdzeń strugi to
   czysty gaz z dysz, który ROZPYCHA zapylone powietrze; w polu 2D czysty jest tylko szybki środek, a na flankach zasysany pył się
   zagęszcza. Pomiar w locie (5,5 s ciągu): pas prędkości (½ maks.) 500–950 j., kadłub 806 j., gromada dysz 454 j., **tunel bez
   pyłu 84–140 j.** (3–5 komórek) z jasnymi obwódkami po obu stronach — dokładnie to, co widać na zrzucie użytkownika. Gaz 3D
   wybuchów ma źródło OBJĘTOŚCI (`expansion` w celu dywergencji) — dlatego tam gaz „omija przeszkody”: jest pchany, nie ssany.
2. **„Nie leci”, bo pyłu już nie ma: budżet pyłu jest jednorazowy.** Pierwsze odpalenie zdejmuje z pokładu 990 jednostek (3,2 %
   kurzu hali) i podnosi pył w powietrzu z 1 do 1712; drugie — 173 (pył w powietrzu nie rośnie: 1262 → 1177), trzecie — 280.
   Pył w powietrzu GINIE (zanik 2,5 %/s — pół życia 28 s; z 1712 po 6 s zostaje 1015), na pokład wraca tylko tam, gdzie powietrze
   stoi (< 70–320 j/s) i tylko wewnątrz hali (6 s po ciągu wróciło 85 z 990), a kurz odrasta 0,6 % niedoboru na sekundę
   (minuty). Pas pod strumieniem i strefa przy ścianie zostają czyste, a kolejne odpalenia nie mają czego podnieść.
3. **Pył, który został, siedzi w dwóch wirach przy ścianie i stoi.** Strumień uderza w ścianę, rozlewa się na boki i zwija w dwa
   „grzyby” (zrzut `12-ciag-5s`); po zwolnieniu ciągu opór 0,45/s gasi przepływ w ~3 s (rms prędkości 106 → 27 → 12 j/s),
   turbulencja działa tylko tam, gdzie jest pył, a jawnej dyfuzji pyłu nie ma — spirale zastygają ostre („słoje”). Następne
   odpalenie trafia rdzeniem MIĘDZY wiry, więc je tylko lekko przesuwa.
4. **Liczba iteracji Jacobiego NIE jest wąskim gardłem.** Residuum dywergencji po rzucie = 5,3 % rms prędkości przy 31 iteracjach
   i 5,2 % przy 121 i 301 (rozgrzanie 0,9 wynikiem poprzedniego podkroku wystarcza). Reszta to cecha schematu z siatką
   kolokowaną i różnicami centralnymi (gradient o rozstawie 2 komórek nie znosi dokładnie dywergencji o rozstawie 2 — jak w
   gazie 3D). Nie dokładać iteracji.
5. **Rdzeń jest poprawny i spójny z gazem 3D** (RK2 wstecz, MacCormack z obcięciem, wiry, Jacobi z Neumannem na ścianach, otwarty
   brzeg, komórki stałe z prędkością kadłuba i obrotem, maska obrysu z żywych węzłów belek, jeden `renderer.compute(lista)`,
   szew gra ↔ render przez tablicę). Braki są w MODELU fizycznym (źródło gazu, bilans pyłu, tłumienie), nie w numeryce.

## 2. Liczby

Domena 400 × 336 komórek po 28 j. (11 200 × 9 408 j.), Jacobi 31, podkrok 1/60 s. Atlas: 5 dysz MAIN, promień dyszy 34 j.,
położenia w poprzek osi gromady 0, ±106, ±193 j. (gromada 454 j. szerokości), `EngineFrame.spread` 228, promień równoważny 75;
w polu JEDEN strumień na okręt: szerokość u nasady (228 + 75) · 1,15 = 349 j. (12,5 komórki), prędkość 2600 j/s, długość 2800 j.,
tempo narzucania 7/s. Kadłub 806 j. = 28,8 komórki. Ściana tylna ~700 j. (25 komórek) za wylotami.

| Krok | pył w powietrzu | kurz na pokładzie | maks. v [j/s] | rms v [j/s] |
|---|---|---|---|---|
| postój | 1 | 30 569 | 90 | 7,5 |
| 1. ciąg 1 / 2,5 / 5 s | 423 / 982 / 1712 | 30 309 / 29 911 / 29 579 | 2161–2247 | 91–106 |
| po 2 / 6 s | 1546 / 1015 | 29 578 / 29 664 | 440 / 365 | 27 / 12 |
| 2. ciąg 1 / 2,5 / 5 s | 1262 / 1297 / 1177 | 29 586 / 29 500 / 29 413 | 2174–2242 | 100–103 |
| po 2 / 6 s | 1004 / 661 | 29 421 / 29 465 | 358 / 435 | 21 / 20 |
| 3. ciąg 1 / 2,5 / 5 s | 632 / 653 / 1283 | 29 450 / 29 392 / 29 170 | 2161–2245 | 92–113 |
| po 2 / 6 s | 1172 / 792 | 29 166 / 29 229 | 398 / 175 | 30 / 12 |

(skoki pary — 1652 i 3176 — to upusty zaworów hali z harmonogramu, nie ciąg.)

Profil w poprzek osi dysz, Atlas trzymany na stanowisku, 5 s ciągu (d — odległość za wylotem w komórkach):

| d | szczyt v wzdłuż [j/s] | pas ½ maks. | pas bez pyłu (< 35 % tła) |
|---|---|---|---|
| 4 (112 j.) | 1011 | 17 kom. = 476 j. | 53 kom. (tuż za rufą — kadłub) |
| 10 (280 j.) | 1136 | 22 kom. = 616 j. | 17 kom. = 476 j. |
| 18 (504 j.) | 1587 | 7 kom. (ściana w linii) | 4 kom. = 112 j. |

W locie (5,5 s ciągu ku bramie, ~500 j/s), gęstość pyłu w 7 komórkach wokół osi: `0,16 0,06 0,01 0,01 0,05 0,16 0,26`
(d = 14), `0,20 0,09 0,03 0,03 0,08 0,19 0,22` (d = 40 i 60) — tunel ~4 komórki (≈ 110 j.) przy pasie prędkości ½ maks.
18–34 komórek (500–950 j.). Na flankach pył GĘSTSZY niż tło hali (0,03–0,06): zassany i zagęszczony.

Bilans pierwszego odpalenia: pokład −990 × `liftGain` 2,4 = 2376 do powietrza; zmierzone 1712 — ~20–25 % ginie numerycznie
(adwekcja semi-Lagrange'a nie zachowuje masy w polu zbieżnym / rozbieżnym, obcięcie MacCormacka tego nie naprawia) plus zanik.

Jacobi A/B (ten sam stan, jeden podkrok): 31 → 0,053, 121 → 0,052, 31 → 0,052, 301 → 0,052 (dywergencja rms / prędkość rms).

## 3. Braki — ranking

1. **Strumień bez masy (zasysa zamiast pchać).** `advectNode`: w stożku `vel = mix(vel, target, …)`, cel dywergencji = 0.
   Skutek: wąski tunel, jasne obwódki pyłu na flankach, pył NIE jest spychany pod ściany i na boki hali, tylko ciągnięty do osi.
   W gazie 3D (`gasGrid.js`, `divergenceTarget`): `div − spalanie·expansion − dym·disperse` — kula ognia jest źródłem objętości.
   Naprawa: cel dywergencji > 0 w stożku przy wylotach (wydatek gazu ∝ Σ powierzchni dysz × moc — Atlas 5 dysz = 5× jedna),
   z otwartym brzegiem domeny (bramy) nadmiar wypływa; cały pył hali staje się wtedy czymś, co strumień rozpycha i prasuje na
   ścianie. To zarazem jedyna droga do „pył leci” przy drugim odpaleniu, bo pcha się ZAPYLONE powietrze, a nie podnosi kurz.
2. **Profil Gaussa jednego strumienia zamiast pięciu dysz.** `_jetProfile`: `exp(−2,2·(x/w)²)` z w = 349 j. — na skrajnych dyszach
   (±193 j., krawędź ±227) waga 0,5 / 0,4 środka. Rdzeń jest więc jedną wąską strugą, choć struga MAIN (obraz) rysuje pięć
   równych. Naprawa: profil płaski (super-Gauss, np. `exp(−(x/w)⁴·k)`) na szerokości gromady z rozszerzaniem stożka, albo
   strumień na DYSZĘ z listy płaskiej `EngineFrame.nz*` (jest; `maxJets` 56 − 40 źródeł hali = 16 — do podniesienia).
3. **Bilans pyłu: pył ginie, zamiast wracać na pokład.** `reactNode`: zanik `decay` 0,025/s wszędzie w hali, opadanie tylko przy
   v < `settleHi` 320 i tylko `inside`, odrastanie `regrow` 0,006/s. Naprawa: zasada zachowania — opadanie wszędzie (tempo
   malejące z prędkością, ale nigdy 0), zanik tylko w próżni za bramą (i co najwyżej śladowy dla „najdrobniejszego” pyłu),
   odrastanie zbędne albo dużo wolniejsze. Wtedy pył zdjęty przy pierwszym odpaleniu wraca na pokład przy ścianie i pod wirami,
   a drugie odpalenie ma co podnieść — tam, gdzie go zepchnęło pierwsze.
4. **Pył zastyga w wirach: silny opór, zero dyfuzji, turbulencja tylko w pyle.** `drag` 0,45/s (gaz 3D w grze: 0,2 + człon
   kwadratowy; „w próżni oporu nie ma”), brak członu dyfuzji pyłu, `turbW ∝ den` (czysty gaz jest laminarny — rdzenie wirów
   żyją bez zaburzeń). Naprawa: opór 0,15–0,25/s + opór kwadratowy dla szybkiego frontu (wzór gazu 3D), mała dyfuzja pyłu
   (jedna próbka 4 sąsiadów w `reactNode`, ~0,5–1 komórki²/s) albo dyfuzja wirowa ∝ |ω|, turbulencja także w czystym gazie przy
   dużym ścinaniu (|ω|). Spirale „słoje” znikają same (dawne `restMax` 14 to objaw tego samego).
5. **Dwuwymiarowość hali: gaz pchany do ściany nie ma gdzie uciec.** Prawdziwa hala ma 720 j. wysokości, a Atlas jest płaski:
   gaz od ściany ucieka W GÓRĘ nad kadłub. W płaszczyźnie wygląda to jak upust przy ścianie i dopływ gdzie indziej. W 2D cały
   powrót musi iść w płaszczyźnie obok okrętu — stąd przesadzone, trwałe wiry przy ścianie. Naprawa (tania): miękki rzut —
   cel dywergencji `−k·p` (słaba ściśliwość = „ucieczka w pion”), albo człon `disperse` jak w gazie 3D dla gęstego pyłu.
6. **Stożek nie widzi przeszkód.** Profil strumienia liczy się także za ścianą (margines 320 j. za ścianą tylną: 11 komórek
   dostaje narzuconą prędkość). Gaz 3D zasłania źródła marszem do początku kapsuły (`sourceOcclusionCpu`). Niewidoczne w obrazie
   (poza halą pył gaśnie), ale pompuje równanie ciśnienia po złej stronie ściany. Naprawa: w `_jetProfile` krótki marsz po
   rastrze przeszkód (kanał A rastru = odległość od przeszkody) albo po prostu `prof · (1 − info.x)` z odcięciem za pierwszą
   komórką stałą wzdłuż osi.
7. **Podrywanie z pokładu pełne dopiero od 900 j/s** (`liftHi`), a szczyt prędkości przy wylotach to ~1000–1140 j/s: pełne
   podrywanie tylko w rdzeniu, klin oczyszczonego pokładu za rufą ma ~280 j. szerokości (`12-ciag-5s-pole-pokl.png`), nie 450–800.
   Po poprawce 1–2 progi do przeliczenia (pełne podrywanie przy ~0,4 prędkości u wylotu).

Nieistotne w praktyce: usypianie po 25 s (`sleepAfter`) nie wchodzi w grę, bo hala ma stale 22 źródła gazu (sączenie złączek,
szpul, zaworów, wentylacja) — `moving = nj > 0` trzyma symulację obudzoną.

## 4. Czego NIE zmieniać

- Jacobi 31 z rozgrzaniem 0,9 — wystarcza (pkt 4 werdyktu); koszt zostaje.
- Komórki stałe z prędkością kadłuba i obrotem, maska obrysu z belek, Neumann na ścianach, brzeg p = 0 — poprawne.
- Szew gra ↔ render (tablica `HALL_DUST_IN`), krok w `Core3D.fx`, jeden `renderer.compute(lista)`, rozgrzewka pustymi
  dispatchami.
- Obraz (`gasFieldLayer.js`): faktura z pozycji spoczynkowych, snopy, siatka świateł — po poprawkach fizyki wymaga tylko
  przestrojenia `density` / `front` (więcej pyłu w powietrzu przy zasadzie zachowania).

## 5. Plan poprawek (kolejność; każdy krok z A/B tym samym narzędziem)

1. Źródło objętości w stożku MAIN + profil płaski na gromadę dysz (`advectNode`, `divNode` — cel dywergencji z nowej tablicy
   per strumień; `hallDust.js` — wydatek z liczby i promieni dysz). Miara: tunel bez pyłu ≈ szerokość gromady + rozszerzanie
   (≥ 450 j. przy d = 14), flanki NIE gęstsze od tła.
2. Zasada zachowania pyłu (opadanie wszędzie, zanik tylko w próżni) — miara: pokład po 1. odpaleniu i 30 s spoczynku wraca
   do ≥ 80 % stanu, drugie odpalenie podnosi ≥ 50 % tego, co pierwsze.
3. Opór + dyfuzja + turbulencja w czystym gazie — miara: po 6 s od ciągu wiry przy ścianie rozmyte (maks. gęstości w rdzeniu
   wiru ≤ 2× średniej w promieniu 10 komórek), bez „słoi”.
4. Miękki rzut (ucieczka w pion) — miara: trwałe wiry przy ścianie słabsze, pył rozchodzi się po hali, a nie tylko wzdłuż
   ściany; A/B na oko użytkownika.
5. Zasłanianie stożka przeszkodami, progi podrywania — porządki.

Koszt: wszystkie poprawki to arytmetyka w istniejących kernelach (bez nowych tekstur poza ewentualną tablicą celu dywergencji
na strumień); ~0,3 ms GPU na podkrok bez zmian.

Narzędzie: `node scripts/webgpu/hala-pyl-audyt.mjs [--zoom 0.32] [--out .tmp/audyt-pyl]` — bilans, profile, Jacobi A/B,
obrazy pól (PNG z GPU: pył w powietrzu, kurz na pokładzie, prędkość; czerwone — przeszkody, niebieskie — obrys kadłuba).

## 6. Po poprawkach (2026-10-12)

Wdrożone wszystkie pięć kroków planu z § 5, każdy z A/B tym samym narzędziem. Protokół narzędzia rozszerzony o 30 s
spoczynku po pierwszym odpaleniu (miara bilansu), ostrość wirów i tryby `--tune` / `--krotko`; porównanie raportów:
`node scripts/webgpu/hala-pyl-porownaj.mjs A/raport.json B/raport.json`. „Przed” = ten sam kod co w § 2, zmierzony nowym
protokołem (`.tmp/audyt-pyl-przed2`); kolejne kolumny — stan po kroku N (`.tmp/audyt-pyl-po-N`).

Miary (tunel: komórki ciągiem od osi z pyłem < 35 % tła, tło = mediana profilu |s| 24…40 komórek; flanka = maks. pyłu
w 10 komórkach za brzegiem tunelu / tło; wiry: maks. gęstości w r ≤ 3 komórek rdzenia / średnia w r ≤ 10, dwa
najsilniejsze rdzenie przy ścianie 6 s po ciągu):

| Miara | przed | po 1 | po 2 | po 3 | po 4 | po 5 (koniec) | cel |
|---|---|---|---|---|---|---|---|
| tunel w locie, d = 14 [j.] | 0 | 0 | 196 | 224 | 112 | **476** | ≥ 450 |
| flanka w locie, d = 14 (× tło) | 13,9 | 4,1 | 3,1 | 2,7 | 6,2 | **1,3** | ≤ ~1,2 |
| tunel na postoju, d = 10 / 18 [j.] | 476 / 112 | 700 / 1764 | 756 / 1372 | 784 / 1176 | 672 / 952 | **1428 / 1876** | — |
| podniesione z pokładu: 1. / 2. odpalenie | 913 / 247 | 1584 / 482 | 1476 / 699 | 1814 / 710 | 1600 / 597 | **2308 / 1168** | — |
| 2. odpalenie / 1. | 0,27 | 0,30 | 0,47 | 0,39 | 0,37 | **0,51** | ≥ 0,5 |
| wróciło na pokład po 30 s (część zdjętego) | −0,23 | 0,03 | 1,14 | 0,98 | 0,97 | **0,93** | ≥ 0,8 |
| pył w powietrzu przy 2. odpaleniu | 834 | 1452 | 3682 | 3389 | 3123 | **4252** | — |
| rdzenie wirów 6 s po ciągu (× średnia r10) | 1,67 / 3,14 | 6,9 / 2,6 | 2,4 / 1,4 | 1,6 / 1,0 | 1,25 / 1,28 | **0,91 / 1,26** | ≤ 2 |
| ostrość pyłu przy ścianie: p95 / maks. | 3,1 / 5,6 | 3,1 / 9,0 | 2,7 / 9,2 | 1,8 / 2,6 | 1,9 / 2,7 | **1,7 / 2,3** | — |
| residuum dywergencji / v (postój) | 0,052 | 0,057 | 0,054 | 0,049 | 0,054 | 0,048 | — |

Uwaga do „po 1” i „po 4”: każdy wiersz to jeden przebieg w czasie rzeczywistym (kolejność klatek, źródła gazu hali), więc
liczby lotu wahają się o kilka komórek między przebiegami; spadek tunelu w „po 4” to brak rozrzedzania spalinami
(dodane w kroku 5), nie miękki rzut.

Co wdrożono (szczegóły — AGENTS.md § „Pył i para w halach K-7”, „MODEL STRUMIENIA I BILANS PYŁU”):

1. **Źródło objętości + profil płaski.** Stożek MAIN ma profil `exp(−0,69·(x/w)⁴)` na szerokość gromady
   (`EngineFrame.spread` × `jetWidth` 1,35) i wydatek gazu `jetFlow` 260 × moc × Σ r² dysz / h² (Atlas ≈ 1880 komórek²/s),
   rozłożony od wylotu do `jetSourceLen` 600 j.; cel dywergencji z `velB.z` (nowa tablica `jetD` na strumień). Pył
   w komórce źródła rozrzedza się (Dc/Dt = −c·∇·v).
2. **Zasada zachowania pyłu.** Opadanie wszędzie (`settleMin` 0,3 przy szybkim przepływie, `settleRate` 0,09), zanik
   w hali śladowy (0,002/s), bez odrastania, opadanie nie ponad sufit pokładu 1 (nadmiar zostaje w powietrzu), próbki
   pyłu przy ścianach ważone udziałem gazu. **Główna przyczyna znikania pyłu** okazała się sprzętowa: zapis f32 → f16 do
   tekstury storage na RTX / D3D12 OBCINA ku zeru (pomiar: 1,00073 → 1,0). Pokład (0,25…1, odstęp liczb 2,4·10⁻⁴…4,9·10⁻⁴)
   tracił każdy przyrost z opadania (~10⁻⁵…10⁻⁴ na podkrok), a każdy ubytek zaokrąglał w dół o cały odstęp — stąd
   „~20–25 % ginie numerycznie” w § 2 i −1300 jednostek w 24 s spoczynku po samym kroku 2. Naprawa: zaokrąglanie
   stochastyczne zapisu pyłu, pokładu, pary i prędkości (`_sround`, wartość oczekiwana zachowana; tryb sprzętu wykrywa
   `probeHalfRounding` na urządzeniu — w grze `sim.halfRounding` = 'trunc').
3. **Opór, dyfuzja, turbulencja.** Opór 0,2/s + kwadratowy szybkiego frontu poza stożkami (`dragQuad` 0,004/komórkę,
   600…1500 j/s), dyfuzja pyłu i pary 0,6 + 0,12·|ω| komórki²/s (Neumann przy ścianach), turbulencja także w czystym
   gazie (`turbShear` 0,15 s).
4. **Miękki rzut.** `soft` 0,01/komórkę²: Jacobi rozwiązuje (∇² − soft)·p = div − cel (zasięg ciśnienia ~10 komórek).
   A/B na zrzutach pól (0 / 0,003 / 0,02): 0,003 bez różnicy, 0,02 wyraźnie słabszy trwały wir przy ścianie; zostaje 0,01.
5. **Porządki.** Zasłanianie stożka marszem po kanale A rastru (za ścianą tylną i za zbiornikami paliwa przed nią nie ma
   strumienia), progi podrywania `liftLo` 150 / `liftHi` 650 j/s (szczyt prędkości przy wylotach ~1150 j/s), rozrzedzanie
   spalinami w całym stożku dysz (`jetClean` 6/s × profil, `velB.w`) — kurz poderwany pod strumieniem nie zostaje w jego
   rdzeniu (bez tego tunel w locie miał ~250 j.).

Koszt (`node scripts/webgpu/hala-pyl-gra.mjs`, RTX klasy Blackwell, maszyna bez innych pomiarów): symulacja 0,17 ms GPU
na podkrok (było udokumentowane ~0,3 ms), warstwy z pyłem +0,24 ms na klatkę jak dotąd, pipeline'y synchroniczne po
starcie gry 0. Testy: `tests/hallDust.test.mjs` (profil płaski, suma celu dywergencji = wydatek, zasłanianie za ścianą
i zbiornikami, zaokrąglanie stochastyczne przy obcięciu i przy zaokrągleniu do najbliższej, WGSL kerneli).

Otwarte (do oceny użytkownika):
- Pyłu w powietrzu jest ~4× więcej niż przed zmianami (zasada zachowania) — obraz hali jest gęstszy. Gęstość warstwy
  stroi `HallDust.layer.look.density` / `front` + `syncLook()` (audyt § 4 to przewidział); fizyki to nie dotyczy.
- Trzecie odpalenie z rzędu prawie nic nie zdejmuje z pokładu pod strumieniem (pas jest już wymieciony, pył osiadł pod
  ścianami); w powietrzu pyłu dalej jest dużo, więc „leci”.
- W locie flanka 24 komórki za wylotem ma dalej ~3× tła (pył zepchnięty z toru osiada w wale wzdłuż śladu).
