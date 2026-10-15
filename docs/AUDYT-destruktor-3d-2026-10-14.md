# Audyt destruktora 3D — demo i wdrożenie w grze (2026-10-14)

Zgłoszenie użytkownika: „nie podoba mi się wdrożenie destruktora 3D: ciężko mi się miażdży rzeczy 3D moim statkiem,
często nienaturalnie się rozciągają, statek potrafi ugrzęznąć”. Cel dodatkowy (misja 1): „chcę rozwalić szyję
(środek habitatu w warstwie gameplayu) — jak ją rozwalę, góra ma SPAŚĆ na dolną platformę i zrobić w niej
dziurę / zgniecenie; wjeżdżam w szyję od prawej do lewej → góra od prędkości leci w prawo w dół i przebija dolną
strukturę; masa i wytrzymałość góry i dołu do dopasowania”.

Zakres: silnik `src/game/destructorBeams3D.js` (kontakt, zgniot, solver, kotwice), klej gry `src/game/hullBodies.js`,
ciała świata `src/game/worldBodies.js`, baza piratów `src/game/story/pirateBaseBodies.js` / `pirateBaseIntegrity.js` /
`storyGame.js`, demo `destruktor3d.html` (root) i 2D `destruktor2d.html`. Pomiary w Node na prawdziwym silniku
(`node scripts/destrukcja-taran-sym.mjs`, opis § 2). Bez zmian w kodzie gry.

---

## 1. Werdykt w trzech zdaniach

1. **„Ciężko miażdżyć” i „ugrzęźnięcie”** to głównie KOTWICE: węzły z `invMass 0` są nieskończenie mocne dla taranu
   (zgniot je pomija, hamowanie nie), a w habitacie misji 1 to 19–23% węzłów każdego kawałka: cały pierścień
   wewnętrzny bębna (r ≤ 572) i szyb H-C z kotwicą co 6 komórek. Atlas przebija ścianę i grodzie, po czym staje
   martwo na pierścieniu przy każdej prędkości; przy szarży WBIJA SIĘ w kratę kotwic (82–87 węzłów pierścienia
   wewnątrz kadłuba) i tkwi tam sekundami; z trzymanym W stoi w miejscu na 2–3 kontaktach.
2. **„Nienaturalne rozciąganie”** to trzy rzeczy naraz: (a) normalna styku = −prędkość względna dla KAŻDEJ pary
   z ciałem zakotwiczonym (i przy stosunku mas > 4) — muśnięcie ściany o 25 j. zabiera 40–70% prędkości wzdłuż
   ruchu i ciągnie materiał za statkiem; (b) zgniot przesuwa węzły pozycyjnie (do 9 j. na krok + prędkość) PO
   solverze, więc render dostaje belki rozciągnięte do 45–72% ponad długość bazową na klatkę przed zerwaniem
   (limity zerwania 20–47%); (c) plastyczność 0,55 na 1/120 s — materiał bez sprężystości, kit.
3. **Scenariusz „góra spada na dysk” dziś nie może zajść**: część techniczna (H-T) i sektory dysku (D-1…8) to
   duchy bez ciał i kolizji, ożywiane tylko w skryptowej implozji po zbiciu punktów; szyja (H-C) jest przypięta co
   6 komórek, więc taranem nie da się jej zerwać; żadne zdarzenie nie przenosi pędu taranu na odłączoną górę;
   w płaszczyźnie gry obrysy góry i dysku są współśrodkowe (nachodzą od razu), a „spadanie” (oś Z) nie istnieje.

---

## 2. Jak mierzyłem

`node scripts/destrukcja-taran-sym.mjs [--tryb kotwice,czolo,pchanie,musniecie,wycof,statek] [--dt 60,120]` — prawdziwy
`HullBodies` + `worldBodies` + układ i bryły bazy piratów (kawałki habitatu jako ciała w bańce), Atlas ze sprite'a gry
(1800 × 806 px, 3 121 węzłów, masa zderzeń 800 tys.), niszczyciel piracki. Krok 60 Hz (gra od 2026-10-12) i 120 Hz
(dema, testy). Bez przeglądarki, cała seria ~20 s. Miary: prędkość i głębokość nosa Atlasa w czasie, kontakty na krok,
węzły ściany żywe / w wrakach, `maxR` = długość żywej belki / bazowa (próbkowana co 0,1 s = to, co widzi render),
przemieszczenie węzłów od spoczynku, węzły ściany WEWNĄTRZ kadłuba Atlasa (bliżej niż 0,6 komórki od jego węzła).

Kawałek H-S (ćwiartka bębna): 1 397 węzłów, 269 kotwic (19%), masa 669 tys., pancerz 5, gęstość 2,4. Szyb H-C:
1 454 węzłów, 330 kotwic (23%, co 6 komórek od r = 145 do 509), pancerz 10, gęstość 3,2, masa 983 tys.

---

## 3. Wyniki

### 3.1 Taran czołowy w ścianę bębna (koasting)

| Hz | v [j/s] | zatrzymanie | głębokość maks. / koniec [j.] | ściana: węzły stracone (z 1 397) | wraki | kontakty maks. | węzły ściany w kadłubie (szczyt) |
|---|---|---|---|---|---|---|---|
| 60 | 900 | 1,52 s | 542 / 471 | 291 | 2 | 51 | 0 |
| 60 | 1500 | 1,08 s | 631 / 471 | 337 | 2 | 85 | 0 |
| 60 | 3000 | 0,77 s | 879 / 489 | 432 | 17 | 247 | — |
| 120 | 900 | 1,54 s | 529 / 434 | 271 | 3 | 47 | 0 |
| 120 | 1500 | 1,10 s | 667 / 471 | 340 | 2 | 92 | 0 |
| 120 | 3000 | 0,82 s | 957 / 499 | 420 | 7 | 160 | — |

Głębokość w tej tabeli liczona od krawędzi obrazu sprite'a (900 j. od środka); prawdziwy nos leży 52 j. bliżej
środka, więc od każdej liczby odejmij ~50 (tak liczy już skrypt w repo i § 3.2–3.4).

Ściana zewnętrzna (90 j.) i grodzie ustępują. Koniec zawsze w tym samym miejscu: nos na promieniu ~500–530 =
zewnętrzne lico przypiętego pierścienia wewnętrznego (kotwice do r = 572). Przy 3000 j/s nos dojeżdża do r ≈ 40–120
(PRZEZ pierścień kotwic — kotwic nie da się zgnieść, więc Atlas po prostu je przenika), a potem przez 1,5–2 s jest
wypychany z powrotem (v ≈ 1, ~100 kontaktów na krok) — klasyczne „ugrzęźnięcie”.

### 3.2 Pchanie z ciągiem (start 900 j/s, ciąg 4 s, potem 2 s bez)

| Hz | ciąg | sekundy w miejscu przy ciągu (v < 20) | głębokość maks. / koniec | węzły ściany w kadłubie (szczyt) | szczyt maxR | wraki |
|---|---|---|---|---|---|---|
| 60 | W+Shift (150 j/s² do 1500) | **2,62** | 530 / 421 | 7 | 1,70 | 1 |
| 60 | szarża (1100 j/s² do 3000) | 1,38 | 753 / 426 | **87** | 1,63 | 2 |
| 120 | W+Shift | **2,59** | 507 / 419 | 9 | 1,53 | 5 |
| 120 | szarża | 2,63 | 781 / **748** | **84** | 1,49 | 2 |

W+Shift: po zatrzymaniu na pierścieniu Atlas stoi w miejscu na 1–3 kontaktach mimo ciągu — przy prędkości zbliżania
poniżej `crushSpeedThreshold` (45 j/s) styk nie gniecie, a impuls restytucji zeruje składową normalną prędkości CO KROK
niezależnie od liczby kontaktów; ciąg 150 j/s² daje 2,5 j/s na krok, więc statek pełza 0,04 j./krok i jest cofany
separacją. Szarża: Atlas wjeżdża w kratę kotwic (82–87 węzłów pierścienia wewnątrz kadłuba przez 1–4 s); przy 120 Hz
po zdjęciu ciągu nie wychodzi wcale (koniec 748 j. w głąb, ~95 kontaktów na krok).

### 3.3 Muśnięcie ściany (kurs styczny, burta 25 j. w ścianie w punkcie styczności)

| Hz | v | vx na końcu | spin [rad/s] | węzły ściany stracone | szczyt maxR |
|---|---|---|---|---|---|
| 60 | 300 | **81** | −0,16 | 38 | 1,41 |
| 60 | 600 | **246** | −0,37 | 136 | 1,43 |
| 60 | 1200 | 741 | −0,46 | 140 | 1,63 |
| 120 | 300 | 45 | −0,18 | 4 | 1,45 |
| 120 | 600 | 160 | −0,35 | 70 | 1,46 |
| 120 | 1200 | 1019 | −0,21 | 130 | 1,60 |

Muśnięcie o 25 j. (z 560 j. szerokości kadłuba) hamuje statek WZDŁUŻ RUCHU o 40–85% i wkręca go; składowa boczna
(odepchnięcie) jest pomijalna (vy 0–50). Fizycznie powinno być odwrotnie.

### 3.4 Wycofanie (taran 900 j/s, po zatrzymaniu ciąg wsteczny 300 j/s²)

60 Hz: kontakty kończą się 0,1 s po włączeniu wstecznego, nos wychodzi ze ściany po 1,8 s. 120 Hz: statek wisi
1 s przy v = 5–15 j/s (kontakty do 2,55 s), wychodzi po 2,6 s. Wycofanie z ciągiem bojowym działa, ale jest
hamowane tą samą regułą „normalna = −prędkość” (§ 4, F2); z kratą kotwic w kadłubie (szarża) wyjście trwa sekundy.

### 3.5 Atlas × niszczyciel piracki (stoi burtą; 151 węzłów, masa 60 tys. — stosunek mas 13)

| Hz | wariant | v | niszczyciel: węzły stracone | wraki | prędkość niszczyciela po [j/s] | spin | szczyt maxR |
|---|---|---|---|---|---|---|---|
| 60 | czołowo | 600 | 21 | 0 | 627 (porwany) | −0,28 | 1,44 |
| 60 | czołowo | 1500 | 123 | 3 | 1494 | −0,75 | 1,52 |
| 60 | muśnięcie 20 j. | 600 | 8 | 0 | 84 | 2,19 | 1,37 |
| 60 | **muśnięcie 20 j.** | **1500** | **92** | **3** | **1390 (porwany)** | 0,33 | **1,72** |
| 120 | czołowo | 600 | 9 | 0 | 664 | −0,34 | 1,28 |
| 120 | czołowo | 1500 | 122 | 3 | 1545 | −0,69 | 1,52 |
| 120 | muśnięcie 20 j. | 600 | 8 | 0 | 108 | 1,89 | 1,32 |
| 120 | muśnięcie 20 j. | 1500 | 20 | 0 | 182 | 3,31 | 1,53 |

Ten sam 20-jednostkowy zakład przy 1500 j/s: przy 60 Hz niszczyciel traci 92 węzły, rozpada się na 3 wraki i jest
porywany z prędkością Atlasa; przy 120 Hz traci 20 węzłów i odbija się ze spinem. Zachowanie zależy od kroku, a gra
przeszła na 60 Hz bez testów taranu w tym kroku.

---

## 4. Znaleziska (bugi i wady projektowe), od najważniejszych

Numery linii — stan drzewa roboczego 2026-10-14.

**F1 — KRYTYCZNE. Kotwice są niezniszczalne dla taranu, a w habitacie jest ich 19–23% węzłów.**
`destructorBeams3D.js:1535,1541` — `_crushNode` pomija węzły z `invMass 0`; impuls hamowania (`jYield`, 1467) działa
dalej, więc przypięty węzeł to nieskończenie mocny słupek, którego statek nie może ani zgnieść, ani wypchnąć, ani
przez niego przejść inaczej niż przenikając (przy szarży kadłub mija kotwice i zostaje nabity). Trafienia bronią
zabijają kotwice przez HP (`applyImpact`, 1832) — tylko ostrzał otwiera drogę; `stepBaseIntegrity` nie dostaje punktów
za kotwice (nie da się ich stracić taranem). Kotwice bębna: `pirateBaseBodies.js:48` (`hypot ≤ innerR + 12` → cały
pierścień wewnętrzny), szybu: `:49` + `PIN_GRID_CELLS.core = 6` (`:38`, `worldBodies.js:91 anchorComponents`: siatka
fundamentów co 6 komórek po całym ciele) — szyja z prośby użytkownika jest kratą nie do ruszenia. Składowe bez
kotwicy dostają kotwice co 4 komórki (`worldBodies.js:105`). Zamysł „kotwica = spaw z resztą świata” jest słuszny,
wykonanie (masa ∞ bez progu zerwania) — nie.

**F2 — KRYTYCZNE. Normalna styku = −prędkość względna dla par z ciałem zakotwiczonym / statycznym / masami > 4.**
`destructorBeams3D.js:1418`: przy prędkości względnej > 45 j/s i penetracji > 0,2 · contactDist (3,3 j.) normalna to
kierunek przeciwny do ruchu — niezależnie od geometrii. Skutki: ruch styczny = hamowanie czołowe wzdłuż ruchu
(§ 3.3), wycofywanie = hamowanie (`velAlongNormal < 0` zawsze), zgniot wpychany wzdłuż ruchu („smużenie” materiału
za statkiem — porwany niszczyciel § 3.5), impuls restytucji zawsze przeciwny do prędkości. Reguła przyszła z dema 2D
(„w głębokim kontakcie środki węzłów mijają się”) i ma sens tylko dla czołowego, głębokiego zderzenia; dla Atlasa
(800 tys.) obejmuje KAŻDY okręt lżejszy niż 200 tys., czyli całą flotę poza supercapitalami. Statek nie ma pojęcia
powierzchni, w którą trafił — a `hullBodies.js:775 surfaceNormal` (gradient zajętości) już istnieje.

**F3 — WYSOKIE. Zgniot przesuwa węzły pozycyjnie PO solverze i render widzi stan przed rozstrzygnięciem.**
`update()` (1051): solver belek → kolizje → zgniot. `_crushNode` (1708) teleportuje węzeł o `depth` (do
0,65 · contactDist · 0,85 = 9,1 j. na krok na KAŻDY kontakt, 1532) i dodaje prędkość `d · 30` (1724, nie `d / dt`), a
belki tego węzła są mierzone i zrywane dopiero w NASTĘPNYM kroku solvera. Przy 60 Hz każda klatka renderu to jeden
krok: użytkownik ogląda każdą „przedzerwaniową” gumę. Pomiar: szczyt `maxR` 1,41–1,72 we wszystkich wariantach
(limity zerwania: poszycie 0,34 · 0,6 = 0,20, wręgi 0,35, grodzie 0,47 — `beamBody3D.js:32–35`,
`beamConstraintSolver3D.js:79`). Do tego `plasticRate 0,55` na 1/120 s (`:37`; przy 60 Hz 0,80 na krok) z
`maxRestDrift 0,75` (`:38`): długość spoczynkowa dogania odkształcenie w 2–3 krokach, materiał nie ma sprężystości —
ściana gnie się 5 komórek (76 j.) bez pęknięcia (§ 3.1, 120 Hz / 900: 211 węzłów > 1 komórki, maxR 1,09).

**F4 — WYSOKIE. Strojenie z 120 Hz, gra na 60 Hz (od 2026-10-12, `index.html:27560`), bez testów taranu w 60 Hz.**
`destruktor2d.html:241` i `destruktor3d.html:1125` — `FIXED_DT = 1/120`; `tests/hullCollisionArmor.test.mjs` (taran
rzędu misji 1), `tests/worldBodies.test.mjs`, `beamLocalSolverExact` — 1/120. W silniku część wielkości jest „na
krok”, nie „na sekundę”: cap zgniotu 9,1 j./krok (546 j/s przerabiania ściany przy 60 Hz, 1 090 przy 120 — szarża
3 000 j/s przewyższa oba, stąd nabijanie na kotwice), `speed = d · 30`, iteracje PBD na sekundę ×0,5, `crushTransfer`
i separacja przez `pow(…, dt · 60)`, `plasticRate` przez `dt · 120`. Pomiar § 3.5: ten sam taran daje inne zniszczenia
i inny los celu przy 60 i 120 Hz.

**F5 — ŚREDNIE. Hamowanie rośnie z liczbą węzłów ZANURZONYCH, nie z frontem.**
`jYield = crushStrength · count · nodeMass / cs · dt · armor` (1467): `count` to wszystkie węzły iterowanego ciała
bliżej niż contactDist od węzła drugiego — każdy węzeł ściany, który już jest w kadłubie, hamuje dalej. Im głębiej,
tym twardszy hamulec (kontakty 51 → 247 przy 3 000 j/s; 3 000 → 69 j/s w 0,25 s), a statek, który już przeniknął
pierścień, jest trzymany przez to, co ma w środku.

**F6 — ŚREDNIE. Separacja nie wyciąga wbitego statku.**
`corr = (penetration − slop) / Σ invMass · 0,9 · (1 − transfer)` (1558): przy zgniocie tylko 15% penetracji, a
`penetration` to maksimum JEDNEGO styku (≤ 16,5 j.), nie głębokość w materiale — ekstruzja 1–2 j. na krok (1,5–2 s)
albo wcale (120 Hz, szarża: koniec 748 j. w głąb).

**F7 — ŚREDNIE. Wyboczenie zgniotu w kierunku od POCZĄTKU ciała, nie od lokalnej powierzchni.**
`_crushNode` (1721): składowa boczna 0,65 · d wzdłuż rzutu pozycji spoczynkowej węzła (`ox, oy` względem środka masy
CIAŁA) — dla kadłuba to „na boki od osi”, dla kawałka budowli (środek masy ćwiartki bębna) to przypadkowy kierunek:
węzły ściany rozjeżdżają się wzdłuż ściany zamiast wyboczać się od statku.

**F8 — ŚREDNIE. Pełzanie przy docisku poniżej progu zgniotu.**
`crushing = approach > 45 j/s` (1440): poniżej statek dostaje pełną restytucję od ściany o masie ∞ — doskonale
niesprężysta ściana bez względu na siłę docisku. Trzymane W (150 j/s², 2,5 j/s na krok) nigdy nie przebije progu —
„statek stoi i nic się nie dzieje” (§ 3.2). Quasi-statyczny docisk nie gniecie wcale, a nagły skok powyżej progu
gniecie pełną parą (nieciągłość przy 45 j/s).

**F9 — NISKIE. Demo `destruktor3d.html` nie jest stanowiskiem gry.**
Inne prawo zgniotu: `applySlidersToConfig` (`:630`) nie ustawia `crushStrength` (= 0 → dawne prawo udziału masy
styku, 1476), gra ma 300 000 (`hullBodies.js:63`, 2D demo `sl-yield`); komórka ~2,7 j. (gra 15), 120 Hz, domyślny cel
to STATYCZNA stacja o masie ×100 000 (`beamCrashScene3D.js STATION_MASS_RATIO`), `maxContacts` 128 (gra 384),
`localSolver` wył. (gra wł.). Stanowiskiem bliższym grze jest `destruktor2d.html` (prawdziwy Atlas, 300 000, 384,
ale też 120 Hz). Wnioski z dema 3D nie przenoszą się na grę i odwrotnie.

**F10 — NISKIE (koszt / jakość). Kontakty węzeł-węzeł bez pojęcia powierzchni.**
Para styku = najbliższy węzeł gospodarza w zasięgu 1,1 komórki; wewnątrz grubej bryły „najbliższy węzeł” jest
losowy, średnia normalna bez sensu (stąd F2 jako łata). `_contactCursor` + `maxContacts 384` przy zanurzeniu
zmienia podzbiór kontaktów z kroku na krok (drgania impulsu).

---

## 5. Scenariusz misji „rozwalam szyję → góra spada na dysk” — co dziś stoi na przeszkodzie

Geometria (`pirateBaseLayout.js:56–61`): bęben r 1000 (ściana 90), pierścień wewnętrzny r 560 ± 30, szyb H-C
r ≤ 560 do coreTop 640; SZYJA (część techniczna H-T, duch) — rura r 150 od y 560 do 3 500, GŁOWA talerz r 480–880
(y 3 550–4 080), piasta i maszty do 5 600; DYSK mieszkalny r 1 950 (y −940…−540) w 8 sektorach D-1…8 (duchy).
W płaszczyźnie gry głowa (r ≤ 880, obrys ±1 080) leży W CAŁOŚCI nad bębnem i dyskiem — współśrodkowo.

1. **Duchy bez ciał.** H-T i D-1…8 mają `ghost: true` (`pirateBaseLayout.js:318–325`): `worldBodies.js:234` buduje je
   tylko przy `site.allLive`, `:295` `isCollidable: false`, `:397` poza listą ciał kroku. Nic nie może na nie spaść
   ani ich przebić. Ożywia je wyłącznie `StoryGame._chainExplosion` (`storyGame.js:971`): skryptowa implozja
   (`baseBreak(…, dir: 'in')`) po zbiciu punktów habitatu — bez związku z fizyką taranu.
2. **Szyja niezrywalna taranem** (F1): H-C z kotwicą co 6 komórek, pierścień bębna cały przypięty. Przez
   `storyBaseBreak` (progi punktów) kawałek pęka skryptowo (`breakPiece` → `releaseAnchors` + `shatter`) — ale nie od
   uderzenia i nie w kierunku uderzenia.
3. **Brak przeniesienia pędu na odłączoną górę.** Wyspa z kotwicą startuje z `vel 0` (`_spawnWreck(…, anchored)`,
   2608), zwolniona kotwica przejmuje tylko prędkości węzłów (`_transferFragmentMotion`) — pęd Atlasa, który zerwał
   szyję, nigdzie nie trafia, bo zgniot nie przesuwa kotwic (F1).
4. **Brak osi Z.** Fizyka jest płaska; „spadanie” musi być pozą renderu (jak `__skinZ` wynurzania fregaty zwiadu,
   `scoutBay3D`), a przebicie dysku — zdarzeniem w płaszczyźnie: krater / orka w obrysie głowy przesuniętym o dryf
   z pędu taranu, potem zwykłe zderzenie płaskie głowy z resztą dysku.
5. **Materiały** (`pirateBaseBodies.js:21–31`): tech 1,2 / pancerz 1, disc 1,2 / pancerz 1 — równe, więc zgniot dzieliłby
   się 50/50 (podział ∝ 1/pancerz², 1503); masy przy tych gęstościach: głowa ≈ 2 mln (talerz π(880² − 480²) × 1,2 +
   szyja), sektor dysku ≈ 1,8 mln. Żeby głowa „przebijała” dysk, dysk musi być słabszy (pancerz, rzadkie kotwice,
   gęstość), a głowa twardsza i cięższa. Rozdzielczość duchów 45 j. (`GHOST_CELL`, `pirateBaseBodies.js:33`) —
   dziura w dysku będzie kanciasta; dysk jako prawdziwe ciało (15–22 j.) kosztuje węzły (sektor ≈ 1,49 mln j.² /
   225 ≈ 6 600 węzłów przy 15 j.) — do zmierzenia, może 30 j.

---

## 6. Zalecenia dla sesji naprawczej (kierunki, nie przepis)

Zasady: statki na belkach mają złote stany (`tests/beamLocalSolverExact.test.mjs`, `tests/beam*.test.mjs`,
`tests/hullBodies.test.mjs`, `tests/hullCollisionArmor.test.mjs`) — zmiana prawa kontaktu dla par ze statkami to
świadoma decyzja z aktualizacją wzorców, nie przypadek. Krok gry to 60 Hz; każdy nowy parametr w jednostkach
fizycznych (j/s, j/s², j/s² na kontakt), nie „na krok”.

- **R1 (F1) Kotwice o skończonej wytrzymałości.** Zamiast `invMass 0`: węzeł-kotwica trzymany do „gruntu” więzem
  z progiem zerwania (jak belka z `brk`) albo dużą, skończoną masą (wzór `anchorMassMul 20` z `worldChannels.js:35`)
  — zgniot i impuls taranu mogą ją ruszyć i oderwać, a `stepBaseIntegrity` naliczyć. Kotwice tam, gdzie konstrukcja
  naprawdę trzyma się reszty budowli (szyb — dysku i głowy; pierścień — szybu), rzadko (nie co 6 komórek po całym
  ciele). Habitat w misji: szyja ma pękać od taranu Atlasa w szarży (3 000 j/s, 800 tys.), nie od W+Shift.
- **R2 (F2, F10) Normalna z geometrii.** Normalna klastra kontaktów z gradientu zajętości gospodarza (okno komórek,
  jak `surfaceNormal`) albo z rzutu na najbliższą powierzchnię (znak = w głąb ciała); reguła „−prędkość” tylko dla
  czołowego kontaktu (`closing < 0 && dv·n ≥ 0`), nigdy dla ruchu stycznego ani wyjścia. Hamować wyłącznie składową
  w głąb; tarcie styczne osobno (dziś `friction 0,5` od impulsu normalnego).
- **R3 (F3) Zgniot w tym samym kroku co solver.** Zgniot jako prędkość / predykcja PBD (przed rzutowaniem) albo
  druga faza solvera po kolizjach dla węzłów zgniecionych, zrywanie belek przeciążonych od razu w kroku zgniotu;
  limit przesunięcia na krok ∝ `approach · dt`, prędkość `d / dt · k`. Miara: `peakMaxR` (próbkowany co klatkę)
  ≤ limit zerwania + mały zapas (np. ≤ 1,25) — render nie widzi gumy. Plastyczność i dryf spoczynkowy
  przeliczone na sekundy i sprawdzone sprężystością (odskok wgniecenia po lekkim uderzeniu).
- **R4 (F4) Krok 60 Hz jako główny.** Testy taranu i ciał świata w 60 Hz obok 120 (A/B w `destrukcja-taran-sym.mjs`:
  różnice ≤ ~20% w węzłach, prędkości końcowej, losie celu). Dema: `destruktor2d.html` z przełącznikiem 60 / 120
  i strojeniem gry; `destruktor3d.html` — wpisać `crushStrength` i limity gry albo oznaczyć w nagłówku, że to
  inne prawo (F9).
- **R5 (F5, F6) Hamowanie z frontu, ekstruzja z głębokości.** Siła oporu z węzłów WCHODZĄCYCH w materiał
  (nowe kontakty / przyrost penetracji), nie z zanurzonych; wypychanie wbitego kadłuba z głębokości w materiale
  (najkrótsza droga na zewnątrz), żeby statek nie tkwił sekundami.
- **R6 (F7) Wyboczenie od lokalnej powierzchni** (normalna klastra, nie środek ciała).
- **R7 (F8) Docisk quasi-statyczny.** Poniżej progu zgniotu stały docisk gniecie proporcjonalnie do siły (ciąg ×
  czas), płynnie od zera — trzymane W powoli wgniata, nie stoi; bez skoku przy 45 j/s.
- **R8 Scenariusz misji.** (1) Głowa + szyja (H-T) i dysk (D-1…8) jako prawdziwe ciała w bańce (nie duchy) — dysk
  rzadziej przypięty, słabszy; szyb H-C bez siatki kotwic, trzymany kotwicami o skończonej wytrzymałości do dysku.
  (2) Zerwanie szyi (utrata więzi szyb ↔ dysk pod taranem, albo próg punktów) → H-T swobodne z PĘDEM taranu
  (udział masy, kierunek uderzenia) i spinem. (3) „Spadanie”: poza renderu (Z od szyi do dysku, ~1–2 s, bez
  kolizji), fizyka w tle liczy dryf. (4) Lądowanie: w obrysie głowy przesuniętym o dryf — krater / orka w dysku
  (kanał pędu `worldChannels`, nie kasowanie węzłów), potem zwykłe płaskie zderzenie głowy z resztą dysku (głowa
  pancerz > dysk, masa ~2 mln); dysk ma pękać sektorami. (5) Punkty habitatu i misja (`StoryGame`, `pirateBaseIntegrity`)
  reagują na zerwanie szyi (finał misji może zacząć się od taranu, nie tylko od zbicia 36 000 punktów). Masy
  i wytrzymałość: tabela `PIRATE_BASE_BODY_MATERIAL` + kotwice, do strojenia z pomiarem.
- **R9 Narzędzia i odbiór.** `node scripts/destrukcja-taran-sym.mjs` przed / po; w grze `node scripts/webgpu/baza-zniszczenie-gra.mjs --tryb taran`,
  `scripts/webgpu/baza-gra.mjs` (taran jak gracz), `scripts/webgpu/zniszczenia-gra.mjs`; pipeline'y synchroniczne 0;
  koszt kroku jak dziś (`docs/AUDYT-wydajnosc-2026-10-11.md`). Miary sukcesu: taran 900–3 000 j/s — 0 węzłów ściany
  w kadłubie przez cały przebieg, przejście przez ścianę i grodzie, pierścień i szyja ustępują od energii szarży;
  muśnięcie 25 j. — strata prędkości wzdłuż ruchu < 15%, odepchnięcie boczne i spin; wycofanie ciągiem 150 j/s² z
  każdej pozy < 2 s; `peakMaxR` ≤ 1,25; 60 Hz ≈ 120 Hz; scenariusz § 5 w grze (taran szyi od prawej do lewej → głowa
  odpada z pędem, spada, robi dziurę w dysku zgodnie z kierunkiem taranu).

---

## 7. Czego NIE znalazłem (wykluczenia)

- Tunelowanie kadłub przez kadłub w prędkościach lotu — nie występuje (pomiar 2026-10-11, `tunelowanie-sym.mjs`);
  „przenikanie” z § 3 to przenikanie przez KOTWICE (F1), nie dziurawy narrowphase.
- Rozciągnięcie trwałe belek powyżej limitów po uspokojeniu — nie: końcowe `maxR` 1,02–1,31; guma jest przejściowa
  (F3) i na granicy plastyczności (F3).
- Kolizje ciał zakotwiczonych między sobą — poprawnie pomijane (`update`, 1059); swobodny odłam zderza się
  z zakotwiczonymi (potrzebne dla „góra na dysk”).
- Warp jako duch kolizji (2026-10-11) — poza zakresem, bez zmian.

---

## 8. Po poprawkach (2026-10-14, sesja „Silnik destrukcji 3D”)

Wdrożone: R1–R5 i R8, R4 częściowo, R6 (wyboczenie od środka styku), R7 (płynna granica plastyczności zamiast progu
45 j/s), R9 (skrypt + test odbiorczy + tryb gry). Prawo kontaktu v2 jest ZA FLAGĄ `contactV2` konfiguracji silnika
(`createBeamConfig`, włącza je tylko `HullBodies.init`) — dema (`destruktor3d.html`, `destruktor2d.html`) i testy silnika
liczą się po staremu bit w bit (F9: demo = inne prawo, opisane w `createBeamConfig`). Pełny zestaw testów: 2800 / 2802
(2 TODO jak przed), nowy test odbiorczy `tests/destrukcjaTaran.test.mjs` (ten sam skrypt, 60 i 120 Hz).

### Co zmieniło się w silniku (gra)

- **Normalna z geometrii (F2, F10):** różnica środków materiału obu ciał w oknie wokół styku (3–9 komórek, rośnie
  z rozrzutem styku); −prędkość tylko, gdy geometria nie rozstrzyga i ciała się zbliżają. Rozchodzenie się wzdłuż
  normalnej = brak impulsu; korekta pozycji tylko dla par zbliżających się / spoczywających (korekta wzdłuż normalnej
  boków wyłomu wciągała Atlasa w głąb pierścienia).
- **Granica plastyczności z frontu (F5, F8):** impuls ≤ crushStrength · pancerz · masa węzła / cs · szerokość frontu
  w komórkach (kosze w poprzek normalnej, węzły zanurzone za frontem nie liczą się) · dt; potrzebny impuls poniżej
  granicy = styk sprężysty (płynnie od zera, bez progu prędkości). Plus ZACHOWANIE PĘDU: materiał, któremu zgniot nadał
  prędkość frontu, oddaje reakcję drugiemu ciału (trzymany przez belki i kotwice płaci co krok, oderwany — raz).
- **Zgniot w kroku (F3, F4, F6):** przesunięcie o głębokość styku, ale nie mniej niż droga zbliżania w kroku
  (`crushTravelMul` — taran 50 j./krok nie przeskakuje węzłów), prędkość węzła dopasowana do frontu (węzeł jedzie
  z taranem zamiast zostawać w kadłubie), belki przeciążone pękają od razu w kroku zgniotu (`_breakOverloaded`).
- **Kotwice o skończonej wytrzymałości (F1):** zgniot rusza kotwicę (najwyżej o drogę zbliżania w kroku), we froncie
  liczy się × `pinYieldMul` (gra: 28); przesunięta o `pinBreakCells` (1 komórka) od spoczynku — spaw puszcza.
- Tarcie styku w grze 0,35 (silnik 0,5).
- Baza piratów: szyb H-C bez siatki kotwic co 6 komórek, kotwice tylko na pierścieniu rury szyi (96 zamiast 292);
  głowa (H-T) gęstość 3,0 / pancerz 8, dysk 1,0 / 1,5, duchy na komórce 30 j. (było 45).

### Tabela przed / po (`node scripts/destrukcja-taran-sym.mjs`, wyniki w `.tmp/destrukcja/przed.txt` / `po.txt`)

Głębokość = nos Atlasa od lica ściany bębna (r 1000); lico pierścienia wewnętrznego ≈ 410–470.

| miara | 60 Hz przed | 60 Hz po | 120 Hz przed | 120 Hz po |
|---|---|---|---|---|
| czołowo 900 j/s: głębokość maks. / koniec | 481 / 416 | 471 / 466 | 469 / 372 | 466 / 417 |
| czołowo 1500 j/s (W+Shift): koniec | 419 (staje na kotwicach) | 523 (wgniata pierścień) | 418 | 482 |
| czołowo 3000 j/s (szarża): maks. / koniec | 825 / 443 (wypchnięty z kotwic) | 998 / 998 (przez pierścień w szyb) | 904 / 448 | 1026 / 996 |
| węzły ściany w kadłubie (szczyt), 900 / 1500 / 3000 | 26 / 66 / 108 | 0 / 0 / 131 | 18 / 69 / 99 | 0 / 1 / 80 |
| peakMaxR (render), czołowo | 1,52–1,69 | 1,24–1,25 | 1,42–1,79 | 1,24–1,25 |
| pchanie W+Shift: sekundy w miejscu / koniec | 2,62 / 420 | 2,97 / 480 | 2,59 / 418 | 2,47 / 450 |
| pchanie szarżą: koniec / szyb H-C (węzły) | 426 / 1454 | 899 / 1378 | 748→352, wypchnięty / 1446 | 889 / 1400 |
| muśnięcie 25 j.: strata wzdłuż ruchu 300 / 600 / 1200 | 73 / 59 / 38% | 12 / 5 / 3% | 85 / 73 / 15% | 14 / 5 / 2% |
| muśnięcie: odepchnięcie boczne vy (300 / 600) | 45 / 27 | 30 / 36 | 49 / 106 | 32 / 34 |
| wycofanie ciągiem wstecznym: czas wyjścia | 1,68 s | 1,78 s | 1,73 s | 1,91 s |
| niszczyciel, muśnięcie 1500 j/s: węzły / prędkość po | 59 z 151, 1390 j/s (porwany) | 139, 76 j/s | 131, 191 j/s | 136, 89 j/s |
| niszczyciel czołowo 1500: prędkość po | 1494 | 1295 | 1545 | 1186 |
| szyja (szarża 3000 z ciągiem, od prawej): zerwanie | niemożliwe | tak, głowa ląduje +900 j. w prawo | niemożliwe | tak, +906 j. |
| szyja: krater w dysku (węzły) / głowa jedzie dalej przez dysk | — | 3,2 tys. / do +1815 | — | 3,2 tys. / do +1552 |
| szyja przy W+Shift (ciąg 150 j/s²) | — | nie zrywa | — | nie zrywa |

### Gra (`node scripts/webgpu/baza-zniszczenie-gra.mjs --tryb szyja [--zoom 0.3] [--kamery 3]`)

Szarża F + W z prawej strony ekranu: szyja zerwana po ~1,1–1,3 s, habitat 100 → ~55% (30% za szyję + progi punktów),
głowa ląduje ~650 j. w prawo (kurs taranu w lewo), krater ~2,8 tys. węzłów dysku, skóry głowy i trafionych sektorów
dysku gotowe, 0 pipeline'ów synchronicznych w klatkach scenariusza (4 synchroniczne przy przełączeniu na kamery 3D —
modele okrętów, osobna sprawa). Szczyt kroku przy zerwaniu (budowa ciała głowy, 3,4 tys. węzłów) 18–26 ms w Node,
wypiek skóry głowy ~40 ms (pierwsza klatka spadania).

**2026-10-15 — szyja na silniku 3D** (prośba użytkownika: „góra nie ma spadać centralnie, tylko przechylić się jak wieża
i uderzyć bokiem, a bok ma się płaszczyć jak w Teardown”): wieża (H-T) i dysk (D-1…8) to bryły 3D, wieża przewraca się
na przegubie w nasadzie, uderza bokiem w koronę bębna (~6 s po zerwaniu, przechył 80–97°) i zamarza w spoczynku;
dawne spadanie głowy w warstwie z −1 z kraterem `carveUnder` usunięte. Wiersze „szyja” w tabeli wyżej dotyczą wersji
z 2026-10-14. Opis i pomiary: `docs/PORT-silnik-belek.md` § „Ciała 3D”, odbiór `tests/destrukcjaTaran.test.mjs`.

### Co zostaje otwarte

- Przy 3000 j/s / 60 Hz po zatrzymaniu ~25 węzłów (odłamy ściany) zostaje w obrysie kadłuba Atlasa (szczyt 131
  w trakcie przebijania) — miara audytu „0 przez cały przebieg” spełniona przy 900 i 1500 j/s, nie przy 3000.
- W+Shift staje na pierścieniu bębna z ciągiem (pierścień trzyma: ciąg 150 j/s² < granica kotwic) — to zamierzone
  (W+Shift tylko wgniata), ale „sekundy w miejscu” w tabeli zostają.
- peakMaxR > 1,25 zdarza się pojedynczo (do ~1,4) przy 3000 j/s — grodzie mają próg zerwania 0,47 (× 0,6 = 0,28),
  więc belka może być rozciągnięta o 28% bez pęknięcia.
- R4 do końca: iteracje PBD na sekundę nadal zależą od kroku (pomiar: × 2 iteracje przy 60 Hz nie zmienia wyniku);
  niszczyciel czołowo 600 j/s traci przy 60 Hz 34 węzły, przy 120 Hz 11.
- R9: `destruktor2d.html` / `destruktor3d.html` bez przełącznika 60 / 120 Hz i bez prawa v2 (różnica opisana przy `createBeamConfig` — `contactV2`).
