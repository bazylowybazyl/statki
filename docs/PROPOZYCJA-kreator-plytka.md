# Propozycja: podstawa kadłuba jak płytka drukowana (kreator, temat 1)

Stan: PROPOZYCJA z makietą (2026-11-14), do oceny użytkownika. Kompozytor, schemat, sieć i presety bez zmian.
Prototyp generatora: `src/game/hullDesign/hullDesignBoard.js` (czysty, niewpięty), makieta:
`node scripts/kreator-plytka-makieta.mjs` → `.tmp/kreator/plytka-makieta/`, test: `tests/hullDesignBoard.test.mjs`.

## Co daje spójność wzoru, a czego brakuje dziś

We wzorze rów wzdłuż osi czyta się jako jeden układ, bo: (1) ścisłe lustro względem osi; (2) brzeg rowu „odbija się”
do środka — 2–3 linie równoległe do ściany, rogi pod 45°; (3) hierarchia: największe bryły na osi (kręgosłup), średnie
obok, drobnica ku brzegom; (4) cienkie ścieżki tylko 0° / 45° / 90° i każda gdzieś dochodzi (szyna, element) — nic nie
wisi w próżni; (5) stały krok i szerokość ścieżek.

Dzisiejsza maszynownia (`hullComposer.js`, „MASZYNOWNIA”) to komórki 18 jd z hasza — skrzynka, walec, para bloków albo
krata, każda komórka niezależna: bez osi, bez odniesienia do ścian rowu, bez klas wielkości, ten sam krok wszędzie.
Porządek dają tylko trasy sieci. W rowie 12 jd to wygląda jak detal, w rowie drednota (setki jd) jak szum
(`b2-row-1200-dzis.png`).

## Zasada generatora

Z pola kadłuba po etapach GEOMETRIA i SIEĆ, na siatce PÓŁ-kadłuba (y ≤ 0, druga burta to lustro z konstrukcji):

1. **Dziedzina** = rama bez płyt, minus moduły, kanały serwisowe i wiązki sieci (oś ± pół-szerokość + 0,4 jd).
2. **D** — odległość od ściany rowu [jd], metryka ośmiokątna (fazowanie 1 / √2) → izolinie mają rogi pod 45°. Ściany to
   też moduły i wiązki sieci, więc szyny obwodzą rdzeń i biegną obok rur.
3. **T** — grubość lokalna (średnica koła wpisanego, wygładzona) — „ile tu miejsca”.
4. **Szyny** = izolinie D = 3, 7,5, 12 jd (wariant A) tam, gdzie T na nie pozwala — w wąskim rowie mniej, w końcu żadna.
5. **Kręgosłup** — kapsuły na osi (96 / 48 / 24 jd), potem **kwartały**: drzewo czwórkowe wyrównane do osi i początku
   układu (96 → 48 → 24 → 12 → 6 jd); klasa wolno tylko tam, gdzie `T · k` (więcej na osi i przy rdzeniach) ją
   „chce” → duże w głębi, drobne przy brzegach. Najmniejsza klasa także na siatkach przesuniętych o pół komórki (skośne
   i wąskie rowy). Rodzaj z klasy: blok z gniazdami chipów, moduł z żaluzjami, chip z nóżkami, skrzynka, walec, krata,
   pad.
6. **Ulice** — izolinia E = odstęp / 2, gdzie E to odległość od ścian i elementów: ścieżka środkiem każdej ulicy
   i obwódka elementu w otwartym polu. **Ścieżki** od elementów do najbliższej szyny: start pod 90° z boku ku ścianie,
   skręt o 45° tylko gdy prosto nie zbliża, przed cudzym elementem skręt w ulicę, koniec przelotką.
7. Deterministycznie: hasz z ziarna projektu i całkowitych numerów komórek.

**Sieć systemów:** trasy A* bez zmian — szyny dopasowują się do wiązek (wiązka = ściana dla D), więc rury i kable
biegną pasami układu, a `pipeNetworkCheck` zostaje 0 z konstrukcji (test: układ nie rusza `pipeNet` ani pola).
Wariant na później: koszt A* tańszy na izoliniach D liczonego bez wiązek (trasy „wskakują” na pasy szyn) —
wymaga drugiego przebiegu układu, nie zalecam teraz.

**Wąskie rowy (Bellator):** szyn brak (T < 16 jd), zostaje klasa 6–12 jd: skrzynki, walce, pady — drobny detal jak
dziś, ale ułożony w rzędach wzdłuż rowu (`c3-bellator.png`). Test pilnuje, że Bellator nie zostaje pusty.

## Miejsce w budowie i rysunek w kompozytorze

- **Etap UKŁAD** w `hullDesignBuild.js` po SIECI (potrzebuje `net0.pipeNet`, nie zależy od martwych kabli), klucz
  `kBoard = ${kNet}|${keyOf(d.board)}`, pamięć `lru(2)`; pakiet `packHullBoardTextures` w PAKIETACH (klucz `kBoard`).
  Przeciąganie (`fast`): układ z ostatniej pełnej budowy przy tej samej siatce (jak `pipesStale`), inaczej flaga
  „bez układu” → dzisiejsze komórki. Nowe pole projektu `board: { variant, seed?, glow? }` — w kluczu kształtu
  (czyta je czysty moduł, nie może trafić do pomijanych w `hullDesignLookKey`).
- **Tekstury** (siatka pola, tylko pół-kadłub — kompozytor próbkuje w (x, −|y|)):
  `boardA` RGBA8 liniowo: R = D (¼ jd, do 63 jd), G = E (1/16 jd), B = odległość od ścieżki (1/64 jd), A = T (jd, do 255);
  `boardB` RG8 bez filtra: numer elementu 16 bit (0 — brak); `boardElems` RGBA32F, 2 teksele na element
  (x, y, pół-wymiary; rodzaj, klasa, ziarno, faza). Numer 16-bitowy jak osprzęt sieci (`maxElems` 65 535).
- **Rysunek:** w sekcji „MASZYNOWNIA” `_point` zastępuje komórki hasza (linie ~1782–1807: `G = L.machine`, skrzynka /
  walec / para / krata) — 1 próbka liniowa + 3 odczyty `textureLoad` na teksel, pętla szyn o stałej długości
  (A: 3, B: 12); wiązki sieci, obejmy i osprzęt (`net.*`) rysują się dalej NA układzie, bez zmian. Barwy z palety
  (`pipeC`, `engC`, `metal`, `_pal(10)`) przez `glowSafeNode` — bez niebieskiego albedo.
- **Limity:** modules 160, pipeRuns 255, pipeFits 512 — bez zmian (układ ma własną tabelę). maxSide 8 192 →
  ~1,5 teksela/jd na KAŻDYM okręcie (drednot 1,02 teks./j. × 1,5 j./jd, Colossus 1,64 × 0,91, Bellator 4,06 × 0,37),
  dlatego ścieżki i szyny ≥ 1,3 jd (2 teksele); cieńsze migotałyby z daleka.

## Budżety (pomiar: `node scripts/kreator-plytka-makieta.mjs --pomiar`, CPU, minimum z 7, Node)

| okręt | A | B | C | elementy A (obie burty, z przelotkami) | siatka układu |
|---|---|---|---|---|---|
| drednot | 328 ms | 250 ms | 250 ms | 10 106 (3 114 ścieżek) | 3 559 × 850 |
| drednot, otwarty rów | 249 ms | 250 ms | 266 ms | 12 785 (4 778) | 3 559 × 850 |
| Colossus | ≤ 31 ms | ≤ 16 ms | ≤ 16 ms | 1 545 (440) | 1 133 × 234 |
| Citadella | ≤ 16 ms | ≤ 31 ms | ≤ 16 ms | 1 244 (390) | 1 119 × 233 |
| Bellator | ≤ 31 ms | ≤ 16 ms | ≤ 16 ms | 1 008 (444) | 1 118 × 345 |

Zegar CPU w Windows ma krok ~15,6 ms — małe okręty „≤”. Drednot: +0,25–0,33 s do budowy 2,8 s (~+10%), pakowanie
szacuję na ~30 ms. Pamięć tekstur (pół-kadłub na siatce pola): drednot ~14 MB `boardA` + ~7 MB `boardB` ≈ 20 MB —
dla porównania tekstury sieci drednota ~81 MB. Tabela elementów (pół-kadłub) < 100 KB.

## Ryzyka dla małych okrętów

- Ton rowów: układ ma więcej jasnych linii niż dzisiejsza czarna maszynownia — z daleka rów Colossusa i Citadelli
  robi się cieplejszy i jaśniejszy (`c1-colossus.png`, `c2-citadella.png`). Barwy makiety są zastępcze; w kompozytorze
  z palety. Zabezpieczenie: próg T, poniżej którego zostają dzisiejsze komórki.
- Projekt bez lustra (`design.mirror` = false): prototyp liczy tylko połowę — przy wpięciu pełna siatka (2× czasu).
- Szwy przy wiązkach: dziedzina kończy się 0,4 jd od wiązki; w kompozytorze szyna dochodzi do wspornika obejmy.

## Otwarte decyzje (dla użytkownika)

1. **Który wariant zasady?** A — hierarchia (kręgosłup + kwartały, 3 szyny), B — magistrale (rów wypełniony
   równoległymi obrysami, drobnica między nimi), C — płaska siatka (jednolite klasy, bez wzmocnienia osi). *Rekomendacja:
   A — jedyny ma czytelną hierarchię z daleka (kręgosłup, duże bloki przy osi) i obwódki przy ścianach jak wzór; B jako
   pomysł na szerokie pasy przy burtach.*
2. **Świecące ścieżki (`e1-*`, `e2-*`)?** *Rekomendacja: nie we flocie TN (biel nad ciemną maszynownią, świecenie
   zabiłoby kontrast płyt); jeśli tak — tylko drednoty / NPC, przez kanał emisji skóry (EMIS, maska szyn), barwa z palety,
   nigdy niebieskie albedo (`hullGlowMask`).*
3. **Małe okręty: układ wszędzie czy z progiem?** *Rekomendacja: wszędzie (Colossus z bliska wygląda porządniej —
   `c4-colossus-rufa.png`), ale z tonem bliższym dzisiejszemu ciemnemu rowowi; próg T jako zapas, gdyby Bellator
   stracił.*
4. **Drednot z otwartym rowem osi jak wzór (`b1`–`b4`)?** *Rekomendacja: tak — bez szerokiego rowu płytka nie ma gdzie
   pokazać hierarchii (`a1`, `a2`: dzisiejsze rowy drednota to głównie wąskie pasy). Zmiana pliku drednota — osobny
   krok (temat 2 albo 3).*
5. **Sieć systemów: A* bez zmian (szyny obchodzą wiązki) czy trasy przyciągane do pasów szyn?** *Rekomendacja: bez
   zmian teraz (`pipeNetworkCheck` = 0 z konstrukcji), przyciąganie dopiero gdy rury będą wyglądać „obok” układu.*
6. **Barwa szyn:** ciepły mosiądz jak opaski i rowy dziś (makieta) czy chłodna stal? *Rekomendacja: ciepły z palety
   (`_pal(10)`), jak obecny ton rowów TN.*

## Co w makiecie jest uproszczeniem

- Cieniowanie CPU wysokością (światło z lewej-góry, wnęki), bez światła gry, AO kompozytora, zużycia, rdzy, bloomu i cieni
  płyt na rowie; nakładka leży NAD poświatą dysz (biały placek przy gondolach w `a2`, `c3` — artefakt nakładki).
- Barwy zastępcze, nie z palety; rodzaje elementów (bloki z chipami, kapsuły, chipy) to szkic wyglądu.
- Raster w gęstości kompozytora z pełnymi liczbami; kompozytor czytałby pola 8-bitowe (kwantyzacja ¼ jd).
- Płyty, moduły, gniazda i trasy sieci są z prawdziwego kompozytora; przy brzegu wiązki może prześwitywać dzisiejsza
  maszynownia (pas 0,4 jd).
- Drednot z otwartym rowem to wariant budowany w skrypcie (zdjęte płyty osi: grzbiety, pokład-klin, wieża mostka) —
  nie zaprojektowany kadłub; rów na rufie jest prostokątny.
- „Miasto” na grzbiecie (temat 3) i obwódki płyt (temat 2) — poza makietą.
