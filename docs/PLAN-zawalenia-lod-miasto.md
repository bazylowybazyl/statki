# Plan: zawalenia na skalę miasta (LOD wiązanych wokseli)

Prośba użytkownika 2026-11-05: „następnym krokiem po P4 i S5 LOD”, „będę potrzebował móc niszczyć całe miasto (zajrzyj na ring Ziemi)”, „większe woksele, mniejsza gęstość? jakie znasz metody optymalizacyjne?”, „w następnej scenie daj miasto na ringu i ostrzelaj je z góry lub zawal wiele budynków naraz”, „latając Atlasem tak naprawdę widzimy malutkie te budowle, co innego mniejszym statkiem, ale wtedy kamera też będzie bliższa”.

Liczby oznaczone **zm.** są zmierzone, **szac.** to rachunek. Specyfikacja dema: `docs/SPEC-woksele-zawalenia.md`.

## 1. Fakty

**Koszt (zm., RTX 5080, § 1.7 spec):** 0,41 ms na krok przy 20 622 węzłach, 0,44 ms przy 14 203 węzłach w hałdzie, czyli 20–30 ns na węzeł i krok przy 8 podkrokach. **1 ms GPU to 33–50 tys. węzłów.**

**Miasto ringu Ziemi (kod `src/3d/haloRing/`, rachunek w Node):**
- To nie obiekty, tylko reguła w shaderze wierzchołków: `haloRingCity.js:109-201`, 3 rysunki. 523 296 slotów, szac. 110–180 tys. budynków i około 10 tys. zakładów. Typ, maska i wysokość pochodzą z map GPU, więc lustra JS dziś nie ma.
- Ogród: rzut 33,6 × 42,5, wysokość 17–70, mediana 37 (`haloRingCity.js:157-169`). Szkło: ten sam rzut, 71–290, mediana 154. Hala: 64–80 × 60–84 × 16–26. Dziewięć megabudowli: 420–720 × 275–470 × 440–1230.
- Dla porównania wieża z dema: 380 × 420 × 1340, 14 942 węzły. **Zwykły budynek miasta jest około 10 razy mniejszy w każdym wymiarze.** Przy dx = 20 ogród ma szac. 27 węzłów, a szkło 80. Megabudowla ma około 19 tys., czyli tyle co wieża.
- Góra budynku to +r, czyli płaszczyzna gry, więc kamera widzi fasady (plan zawaleń, wiersz 667). Kod gry nie zna g ringu. Ziemia szac. 400.

**Budynek na ekranie przy 5120 px (zoom z `cameraRig.js`, `smallScale.js`, wzór `haloRingGame.js:322`, przy z = 0):**

| Tryb | px / j. | Kadr, j. | Budynków w kadrze, szac. | Ogród / szkło, px | Węzeł dx = 20, px |
|---|---|---|---|---|---|
| Atlas, najdalej | 0,035 | 146 000 | wszystko w tym kadrze | 1 / 5 | 0,7 |
| Atlas, reżyser × 0,3 | 0,171 | 30 000 | 40 tys. | 6 / 26 | 3,4 |
| Atlas, domyślny | 0,569 | 9 000 | 3–5 tys. | 21 / 88 | 11 |
| Limit gry | 3,2 | 1 600 | około 130 | 118 / 493 | 64 |
| Mały statek (`?malaSkala`) | 7,88 | 650 | około 20 | 291 / 1213 | 158 |

Budynki daleko od z = 0 mają sufit perspektywy 1,69 px / j. przy każdym zoomie (przy |z| = 1350).

**Odniesienie wyglądu:** film „petarda” i strona „trzyma” mają węzeł około 10–18 px, z odłamkami drobniej.

## 2. Wniosek

Użytkownik ma rację: rozdzielczość symulacji ma wynikać z **ekranu**, nie ze świata. Dzielnica 500 budynków przy dx = 20 to około 25 tys. węzłów, czyli **tyle co jedna scena S3, około 0,5 ms**. Miasto nie wymaga cudu, tylko trzech rzeczy: węzły istnieją wyłącznie dla budynków, które właśnie się walą, gęstość idzie za zoomem, a dalekie budynki w ogóle nie idą przez solver.

## 3. Metody, od największego zysku

| Metoda | Zysk | Koszt i haczyk |
|---|---|---|
| **A. Węzły na żądanie.** Cały budynek to wpis shadera miasta (0 ms). Trafiony dostaje węzły z puli stron, osiadły oddaje je i zostaje gruzem. | Z 5 mln do najwyżej 100–150 tys. węzłów. Największa dźwignia | Pula, alokator, siatka kontaktów haszowana zamiast gęstej, przejście shader → węzły bez skoku |
| **B. Zawalenie w shaderze dla dalekich.** Slot miasta ma „zniszczony w chwili t”, a wierzchołki ściągają budynek w dół z szumem, zostaje kopiec, kłąb pyłu z puli. | Dziesiątki tysięcy budynków naraz za około 0 ms | Bez prawdziwej fizyki, dobre od około 30 px wysokości w dół |
| **C. Sufit węzłów i kolejka.** Budżet na klatkę, nadmiar idzie do tieru B. | Twardy limit kosztu, koniec z niespodziankami | Bliskie mają pierwszeństwo |
| **D. Grubsze woksele, gęstość z zoomu.** Węzeł około 10–20 px: dx 20 przy Atlasie, 5 przy limicie gry, 2,5 małym statkiem. | Przy stałych podkrokach dx × 2 to 8 razy mniej węzłów | Wytrzymałości kalibrują się z budowy, ale zgodność zachowania z dx jest **niezmierzona**: to próba nr 1 |
| **E. Materiał miększy z dx (c ∝ dx).** Przy tej samej liczbie węzłów na wysokość budynek ugina się tak samo, a podkroki zostają 8. | Bez tego dx / 2 to 16 razy drożej, z tym 8 razy | Fala i tempo pękania zmieniają się z c, próba |
| **F. Wydmuszki.** Tylko ściany i stropy, bez wnętrza. | Przy dużym zbliżeniu koszt przestaje rosnąć z objętością: 2–3 razy mniej | Wygląda jak budynek, bo nim jest (rdzeń, stropy, fasada) |
| **G. Obraz z LOD.** Liczba slotów na węzeł z odległości: 1 blok daleko, 7 blisko, cień tylko bliskich, pył większymi kwadami. | Dziś 7n instancji: 150 tys. węzłów to 25 mln wierzchołków na przebieg, więc bez tego obraz padnie pierwszy | Uniform, bez nowego pipeline'u |
| **H. Gruz na stałe.** Osiadła hałda: najpierw instancje bez compute, potem daleka zamienia się w kopiec w shaderze. | Zniszczone miasto zostaje zniszczone za około 0 ms | Pamięć instancji, sufit bliskich hałd |
| **I. Filmy wypalone (VAT).** Kilka prawdziwych zawaleń na archetyp wypalonych do tekstury, odtwarzanych bez fizyki. | Prawie wygląd symulacji za koszt rysunku | Bez interakcji z sąsiadami, rezerwa, gdy B wygląda za słabo |
| **J. Rzadszy krok dla dalekich.** Co drugi krok dla dalszego tieru. | 2 razy mniej dla tej części | Stabilność wymaga większego dx, sens dopiero z D |
| **K. Inny solver (XPBD, VBD).** Stabilny przy 1–2 podkrokach. | Do kilku razy | Cała kalibracja i wygląd od nowa, a ta fizyka właśnie została oceniona dobrze. **Nie teraz** |

Rachunek dla pełnego ekranu, gdy wszystko wali się naraz (D + E + F): limit gry dx = 5, 130 budynków po około 300 węzłów, 39 tys. węzłów, około 1 ms; mały statek dx = 2,5, 20 budynków po około 1000 węzłów, 20 tys. węzłów, około 0,5 ms; Atlas dx = 20, ostrzał 500 budynków, 25 tys. węzłów, około 0,5 ms. Wszystko szac. i tylko fizyka. Budżet gry to dziś +1 ms przy nasyconym Ultra, a decyzja, czy zawalenie może kosztować kilka ms przez kilka sekund, należy do użytkownika (§ 12 spec).

## 4. Tiery

| Tier | Kiedy | Co liczy | Budynków naraz |
|---|---|---|---|
| 0, shader | budynek poniżej około 30 px | tylko zapis „zniszczony w t” do slotu | bez limitu |
| 1, gruby | około 30–150 px (Atlas) | dx 20 albo 10, 1–2 sloty obrazu | setki |
| 2, drobny | ponad 150 px (blisko) | dx 5 albo 2,5, 7 slotów | dziesiątki |

Tier wybiera się w chwili trafienia i nie zmienia się w trakcie walenia. Zoom w trakcie jedynie odsłania to, co już się liczy.

## 5. Próby tej nocy (tryb nocny: serie GPU ≤ 60 s, kadry ≤ 1280 × 720)

1. **Czy miękki materiał i gruby węzeł zachowują się tak samo.** S1 przy dx = 40 i 80, z c ∝ dx oraz c = 6000 (przy podkrokach z § 2.1). Liczby: dach t = 3…7, przechył, masa kawałków, na tle dx = 20. Zrzuty z dalekiej kamery. Warunek: wieża miażdży się, nie przewraca.
2. **Miasto: scena M1 „Ostrzał z góry”.** Prawdziwy układ kwartałów i wzory z `haloRingCity.js:157-169` w lustrze JS (maska 1, teren 0), około 500 budynków, grunt jako płyta ringu, g = 400. Salwa spada pasem przez dzielnicę. Budynki stoją, dopóki nie dostaną. Kamery: „Atlas” (kadr 9000 j. przy 5120 px, czyli węzeł 11 px) i „mały statek”.
3. **M2 „Wiele naraz”.** Ta sama dzielnica, każdemu budynkowi krater przy podstawie w ciągu 3 s. Najgorszy przypadek: wszystkie węzły naraz.
4. **A/B gęstości na M1:** dx = 20 kontra 10. Węzły, ms, zrzuty z obu kamer.
5. **Tier 0 w scenie, jeśli czas pozwoli:** dalsze kwartały jako zwykłe instancje z zawaleniem w shaderze, żeby zobaczyć przejście i skalę tysięcy budynków.

Poza zakresem tej nocy: wpięcie w grę, lustro generatora dla całego ringu, kolizje budynków z okrętami, odnawianie miasta.

### Wynik próby 1: grubszy woksel i mały budynek

GPU, RTX 5080, g = 400, scena S1, 2026-11-05. Narzędzie: `node scripts/webgpu/woksele-demo.mjs --testy lod --lody dx:materiał[:budynek],… [--lodW1 30] [--lodS 0.1] --out .tmp/woksele-demo/LOD`. Zrzuty i liczby: `.tmp/woksele-demo/LOD/` (`arkusz-S1.png`, `arkusz-rama.png`, `arkusz-miasto.png`, `arkusz-atlas.png`, `lod-liczby-*.txt`). Bez powtórek: rozrzut samego wyścigu w kWstaw przy dx = 20 to dach t = 5 w 592–603, t = 6 w 214–229.

**Dla następnego agenta (budynek miasta 33,6 × 42,5 × 17–290):**
- **Układ: `ukladMiasta(dx)` z `scena.js`, czyli rama z oknami, dwuwarstwowe stropy, rdzeń przy dx ≤ 8, podany do `wieza()`.** Nie zamknięta wydmuszka ani lita kostka, liczby niżej. Budynek poniżej 5 warstw (h / dx < 5) to kostka: niska się nie przewraca, a rama wyszłaby za wysoka.
- **Materiał: `MATERIAL_MIASTA` z `scena.js`, `{ cFroude: true, skalaBud: 0.1 }`, nakładka parametrów `zbuduj`.** Jeden na scenę, bo K i h to uniformy. c = 1897 j./s, podkroki wychodzą same ze stabilności. Jedna wartość dobrze niesie wszystkie wysokości 37–290.
- **dx: 10 przy Atlasie, 5 z bliska, 20 tylko przy dalekim kadrze.** dx = 10 przy domyślnym zoomie Atlasa to węzeł 5,7 px, budynek 88 px, rama z oknami jest czytelna i wali się jak wieża. Przy dx = 20 budynek to 2 × 2 × 8 bloków bez okien, fizyka zostaje dobra, ale budynek poniżej 100 j. nie mieści ramy.

| Kamera | dx | Podkroki | Rytm listy | Węzły h = 37 / 70 / 154 / 290 | Dzielnica 480 budynków, węzły | ms na krok, szac. |
|---|---|---|---|---|---|---|
| Atlas daleko (× 0,3) | 20 | 3 | 3 | 8 / 16 / 32 / 60 | 8188 | 0,13 |
| Atlas domyślny | 10 | 5 | 4 | 48 / 73 / 150 / 285 | 40 374 | 0,50 |
| Limit gry | 5 | 11 | 4 | 308 / 548 / 1156 / 2176 | 282 590 | 5,6 |

Szacunek z pomiarów tej próby: 9,5 µs na dispatch plus 1,7 ns na węzeł i podkrok. Same węzły dzielnicy to `budynkiDzielnicy` z ziarnem 1 bez uskoków, a uskoków rama nie sprawdzała. **§ 3 zaniżał węzły przy dx = 5:** średni budynek ma 589, nie około 300, więc 130 budynków z limitu gry to około 77 tys. węzłów przy 11 podkrokach, szac. 1,7 ms, nie 1 ms. dx = 10 to 40 tys. przy 5 podkrokach: tyle, ile miał kosztować ostrzał 500 budynków przy dx = 20. Dzielnica przy dx = 10 wymaga `?maxWez` ponad 40 tys.

**Wieża S1: ten sam budynek, inne dx.** Układ w jednostkach gry, więc przy dx = 40 i 80 ściany i stropy wychodzą grubsze.

| dx, c | Węzły | Podkroki | Dach t = 3…7 | Przechył | Masa %, 1 / 2–7 / 8–63 / 64–511 / 512+ | Kawałek | ms na krok, stoi / wali |
|---|---|---|---|---|---|---|---|
| **20, 6000** | 14 942 | 8 | 1295, 1046, 603, 220, 178 | 4,8° | 12 / 11 / 60 / 12 / 6 | 64 j. | 0,285 / 0,382 |
| 10, 6000 | 122 672 | 16 | 1302, 1238, 992, 546, 210 | 6,9° | 12 / 7 / 11 / 53 / 16 | 61 j. | 3,769 / 3,271 |
| **40, 6000** | 2832 | 4 | 1253, 1045, 572, 290, 241 | 10,2° | 13 / 27 / 52 / 8 / 0 | 86 j. | 0,115 / 0,163 |
| 40, 12 000 (c ∝ dx) | 2832 | 8 | 1258, 1156, 820, 390, 247 | 16,2° | 21 / 30 / 42 / 7 / 0 | 77 j. | 0,183 / 0,245 |
| **80, 6000** | 368 | 2 | 1319, 1147, 717, 332, 263 | 5,7° | 32 / 58 / 11 / 0 / 0 | 101 j. | 0,069 / 0,082 |
| 80, 24 000 (c ∝ dx) | 368 | 8 | 1319, 1302, 1134, 833, 503 | 12,6° | 53 / 37 / 10 / 0 / 0 | 80 j. | 0,153 / 0,195 |

Przechył to kąt górnych 30% przy reszcie dopasowania poniżej 30 j. Metryka `maxPrzechylSpojny` ma próg 1,5 dx, czyli przy dx = 80 aż 120 j., i liczy rozbitą górę jako całą (tam 16,6°). Kawałek to mediana po masie, bok sześcianu z węzłów. Wszędzie NaN 0, asymetrie 0, przed cięciem przemieszczenie 0,000 j. i 0 zerwanych wiązań. W1 przez 30 s stoi przy dx = 20, 40 i 80 w obu materiałach (0 zerwanych, dx = 20: 0,0103 j., reszta 0,0000 j.), dx = 10 bez W1. Po biegach wszystkich dx i materiałów 0 nowych pipeline'ów. S1 przy dx = 20 bez zmian, testy `wokseleBudowa`, `wokseleWgsl`, `wokseleObrazWgsl` zaliczone.

**Dla dx > 20 c = 6000: taniej i bliżej wieży.** Na zrzutach (`arkusz-S1.png`) dx = 40 i 80 walą się jak dx = 20, tylko większymi blokami. c ∝ dx przy dx > 20 nic nie daje: K zostaje, więc 8 podkroków, a góra trzyma się dłużej. Dziewięć megabudowli miasta: dx = 40, c = 6000, 2832 węzły i około 0,16 ms, jeśli liczą się osobną sceną. Przy wspólnym K z dzielnicą to osobna próba.

**Wzory, które się rozjechały:**
1. **Ziarna liczone w komórkach, poprawione raz w `budujZiarna`.** § 2.1 to zapowiadał, kod nie. Przy dx = 40 ziarno miało 280 j., strop był prawie cały wnętrzem ziarna (× 6) i góra zostawała sztywną płytą. Dach przed poprawką: dx = 40 1256, 1136, 766, 402, 262 i 18,4°; dx = 80 1319, 1281, 1033, 719, 553. To największy błąd.
2. **Podłoga wytrzymałości przy c ∝ dx, poprawiona raz w `zbuduj`.** `eMin·K·dx` to odkształcenie, a ma być siła względem ciężaru. Przed poprawką przy dx = 80 wieża stała po cięciu (dach t = 7 1313, 100% w jednym kawałku).
3. **Tempo fali: bez zmian.** Solver ma `tempo·h` z h po skali, więc pułapka z § 2.1 dotyczy tylko Node (`wzorzec-cpu.js` i tak liczy tylko dx = 20). Czoło biegnie jednak tempo · dx j./s, czyli 90, 180, 360, 720 j./s. Próba ze stałymi 180 j./s (`--lodNakladka '{"falaZaDx":true}'`) pogorszyła dach t = 5 przy dx = 40 z 572 na 647 i przy dx = 80 z 717 na 797 (wieża 603), a przy dx = 10 poprawiła t = 5, 6 tylko z 992, 546 na 973, 464. Zostaje `tempo·h`.
4. **Długości mięknięcia stałe w jednostkach gry: dobre dla tego samego budynku** (energia pękania na pole bez zmian, kawałek przy dx = 10 ma 61 j., przy dx = 20 ma 64 j.), **złe dla mniejszego budynku:** 1–3 j. przy dx = 5 to 20–60% odkształcenia zamiast 5–15%. Tak samo ziarna: 140 j. w budynku 154 j. to jeden blok. Stąd skala budynku niżej.
5. **Nie wyjaśnione: dx = 10 rusza później.** Dach t = 4 to 1238 zamiast 1046, potem to samo tempo. Fala tego nie tłumaczy (pkt 3). Bez znaczenia dla miasta, bo wieży przy dx = 10 nikt nie policzy (3,3 ms).

**Mały budynek: żaden z dwóch wariantów z zadania nie wystarcza, bo długości też muszą iść za budynkiem.** Budynek to model wieży w skali s = h / 1340 przy tym samym g, więc obowiązuje podobieństwo Froude'a: c ∝ √s, a nie c ∝ dx ani c stałe. `par.skalaBud = s` skaluje długości materiału (`skala = 20·s / dx`: ziarno, plama, mięknięcie, zginanie, rozlew), progi prędkości przez √s, tempa przez 1 / √s (`ustawUniformy`), `par.cFroude` daje c = 6000·√s i podkroki ze stabilności. Przy s = 1 nic się nie zmienia. Sprawdzenie na tych samych komórkach, dach / wysokość w czasie t* = (t − 2) / √s, cięcie √s razy szybsze:

| Budynek | c, podkroki | Dach / h przy t* = 0,5; 1; 2; 3; 4; 5 | Przechył | Masa % |
|---|---|---|---|---|
| Wieża dx = 20 | 6000, 8 | 0,98 0,97 0,78 0,44 0,17 0,13 | 4,8° | 12 / 11 / 59 / 13 / 5 |
| s = 0,5, dx = 10 | 4243, 11 | 0,98 0,97 0,78 0,44 0,16 0,13 | 5,0° | 13 / 11 / 60 / 12 / 5 |
| s = 0,125, dx = 2,5 | 2121, 23 | 0,98 0,96 0,77 0,43 0,16 0,14 | 4,1° | 13 / 11 / 60 / 11 / 5 |
| Wieża dx = 80 | 6000, 2 | 0,97 0,97 0,84 0,53 0,24 0,20 | 5,7° | 31 / 58 / 11 / 0 / 0 |
| s = 0,1, dx = 8, ten sam 5 × 5 × 17 | 1897, 6 | 0,97 0,97 0,84 0,52 0,24 0,20 | 5,8° | 32 / 57 / 11 / 0 / 0 |

Bez skali budynku te same komórki rozjeżdżają się: s = 0,25 i c = 6000 przewraca się (26,8°, potem 103°), c ∝ dx przy dx = 2,5 spada w mniej niż sekundę, 73% masy w dużych blokach.

**Układ budynku miasta, h = 154, s = h / 1340.** Zrzuty: `arkusz-miasto.png`, `arkusz-rama.png`.

| Układ | dx | Węzły | Podkroki | Dach / h przy t* = 0,5; 1; 2; 3; 4; 5 | Przechył, maks |
|---|---|---|---|---|---|
| Lita kostka | 5 | 1953 | 11 | 0,95 0,95 0,86 0,68 0,49 0,30 | 74,7°, 113° |
| Lita kostka | 10 | 180 | 6 | 0,97 0,96 0,82 0,69 0,59 0,43 | 11,9°, 110° |
| Wydmuszka, strop 2 warstwy | 5 | 1288 | 11 | 0,98 0,93 0,68 0,36 0,21 0,19 | 10,8°, 94° |
| Wydmuszka, strop 1 warstwa | 5 | 1078 | 11 | **W1 nie stoi:** 280 zerwanych wiązań, 1,39 j. | |
| **Rama** | 5 | 1156 | 11 | 0,92 0,95 0,80 0,38 0,22 0,19 | 3,4°, 14° |
| **Rama** | 7 | 516 | 8 | 0,98 0,98 0,84 0,46 0,21 0,18 | 3,9°, 26° |
| **Rama** | 10 | 150 | 6 | 0,97 0,96 0,81 0,40 0,22 0,19 | 3,4°, 9° |
| **Rama** | 20 | 32 | 3 | 0,93 0,90 0,77 0,54 0,27 0,26 | 1,1°, 18° |

Zamknięta rura jest sztywna na ścinanie i po podcięciu góra kładzie się w całości, a rama ma ten sam tryb gięcia co wieża. **Uwaga dla `miasto.js`:** `dlaKazdegoWezla` z `wydmuszka` ma strop jednowarstwowy, a jedna warstwa to mechanizm (wiązania centralne nie niosą prostopadle do płyty): budynek sam się rozpada. W W1 przy wydmuszce ze stropem 2 warstwy zerwań nie ma.

**Materiał na ramie h = 154.** Tu c ∝ dx jest blisko, bo przy dx = 7 to prawie to samo c. c = 6000 spóźnia się o około 1 w t*, przewraca bardziej i kosztuje 2–3 razy więcej podkroków.

| dx | Froude s = 0,115 | c ∝ dx | c = 6000 |
|---|---|---|---|
| 10 | pk 6: 0,81 0,40 0,22 (3,4°) | pk 8: 0,88 0,54 0,23 (2,5°) | pk 16: 0,91 0,64 0,33 (2,6°, maks 51°) |
| 7 | pk 8: 0,84 0,46 0,21 (3,9°) | pk 8: 0,84 0,47 0,21 (4,5°) | pk 23: 0,92 0,70 0,38 (11,2°, maks 58°) |
| 5 | pk 11: 0,80 0,38 0,22 (3,4°) | pk 8: 0,75 0,27 0,20 (2,3°) | pk 32: 0,90 0,64 0,31 (4,4°) |

Dach / h przy t* = 2, 3, 4. Wieża: 0,78 0,44 0,17.

**Jeden materiał na dzielnicę, `MATERIAL_MIASTA`, c = 1897:**

| dx, podkroki | h | Dach / h przy t* = 0,5; 1; 2; 3; 4; 5 | Przechył |
|---|---|---|---|
| 10, 5 | 37, kostka 3 × 4 × 4 | 0,88 0,87 0,77 0,63 0,54 0,52 | 15,2° |
| 20, 3 | 37, kostka 2 × 2 × 2 | 0,75 0,70 0,66 0,65 0,65 0,65 | 0°, prawie się nie wali: to tier 0 |
| 10, 5 | 70 | 0,92 0,89 0,64 0,42 0,38 0,37 | 2,7° |
| 10, 5 | 154 | 0,97 0,96 0,79 0,40 0,22 0,18 | 1,5° |
| 10, 5 | 290 | 0,95 0,95 0,85 0,62 0,25 0,11 | 0,4° |
| 5, 11 | 37 | 0,93 0,93 0,82 0,58 0,46 0,45 | 1,4° |
| 5, 11 | 154 | 0,92 0,94 0,82 0,43 0,19 0,17 | 2,1° |
| 5, 11 | 290 | 0,96 0,96 0,86 0,62 0,25 0,12 | 0,1° |
| 20, 3 | 154 | 0,94 0,90 0,75 0,50 0,31 0,22 | 0,9° |
| 20, 3 | 290 | 0,97 0,95 0,81 0,55 0,21 0,17 | 1,6° |

Niskie budynki kończą wyżej, bo hałda ma 2–3 węzły. Budynek 154 j. wali się w około 1 s od cięcia, co odpowiada pytaniu o tempo z § 6.

**Czego nie sprawdzono:** salwy z góry i kratera (tylko podcięcie z boku), uskoków, kontaktu między budynkami, ramy przy dx = 2,5, wspólnego K z megabudowlą. Zrzuty małych budynków są bez pyłu: `OPCJE_PYLU` ma rozmiary wieży, więc dzielnica potrzebuje własnych. Rytm listy (`rytmEf`: 0,5 klatki × dx / (20·√s)) to wzór bez osobnego pomiaru: we wszystkich biegach 0 NaN.

### Wynik prób 2–4: miasto na stronie dema (M1, M2)

GPU, RTX 5080, 1280 × 720, MSAA 4, sufit 60 kl/s, 2026-11-06, tryb nocny, wentylator najwyżej 31%. Zrzuty i liczby: `.tmp/woksele-demo/LOD/miasto/ab/` (`arkusz-M1-atlas.png`, `arkusz-M1-bliska.png`, `arkusz-M2-atlas.png`, `arkusz-M2-bliska.png`, `liczby-*.txt`). Narzędzie: `node scripts/webgpu/woksele-demo.mjs --zrzut M1,M2 --miasto '{"dx":10}' --maxWez 64000 --chwile 2,4,8 --kamery atlas,bliska,maly --kosztMiasta 1 --rozmiar 1280x720 --out .tmp/woksele-demo/LOD/miasto/ab`; W1: `--testy miastoW1 --miasto '{"dx":10}' --maxWez 64000 --lodW1 5`.

**Jak obejrzeć.** Strona domyślna dalej startuje od S5. Przycisk „Miasto: ostrzał z góry” albo „Miasto: wszystko naraz” przeładowuje ją z `?scena=M1&maxWez=64000&nKom=65536&miasto={"dx":10}`, bo bufory solvera powstają raz. Na panelu dochodzą wtedy kamery „Atlas”, „Atlas z bliska”, „Mały statek” i gęstość „dx 20 / 10 / 5” (też przez przeładowanie, przy dx = 5 strona buduje scenę około minuty).

**Co jest (`scenaMiasta.js`).** `dzielnica(o)`: 480 budynków z `budynkiDzielnicy`, z uskokami, grunt z = 0, g = 400, węzły k = 0 na kotwicach. Budynek od 5 warstw w górę to `wieza()` z `ukladMiasta(dx)`, niższy to kostka, uskok stoi na stropie dachu tak samo. `MATERIAL_MIASTA` plus `kontaktSzok` 0,2. Siatka ijk jest wirtualna: każdy budynek ma własne pole, między polami co najmniej 2 komórki, więc wiązania i rozpoznawanie pary na liście nie widzą sąsiada przez ulicę. Statyka liczy się po budynku i raz na siatkę (`statykaBudynkow`): dx = 10 to 164 rozwiązania i 1,1 s budowy, dx = 5 to 206 i około 56 s, bo najwyższy budynek ma 6583 iteracji CG. Strona: `?maxWez`, `?nKom`, a ponad 220 tys. węzłów prośba o większe wiązanie storage (`glowny.js`). Bez nowych pipeline'ów: po rozgrzewce 0 nowych wpisów dziennika w każdym biegu, także przy przełączaniu M1 → M2 i kamer. S1–S5 mają domyślne bufory.

**M1.** Stoi 1,16 s, potem 20 salw po 6 pocisków idzie pasem do t = 7,6: start w głębi, środek przy przedniej krawędzi, koniec znów w głębi. Pocisk to przebijająca głowica: mały krater na dachu (r = 13), po 3 klatkach główny w 0,2 wysokości (r = 28, czyli cały przekrój), bo krater na samym dachu budynku nie przewróci. Budynek poniżej 60 j. dostaje jeden krater. Razem 120 trafień w 98 budynków (pozostałe to drugi pocisk w ruinę, a pocisk na martwy nosiciel przepada). **M2.** Każdy z 480 budynków: krater przy podstawie, losowo w t = 1–4 s, najwyżej 4 na klatkę z kolejki solvera, co czwarty z pełnym kłębem.

**W1 dzielnicy, 5 s (0 zerwanych wiązań, 0 NaN):**

| dx | Węzły | Rozwiązań CG | Budowa na stronie | Przemieszczenie maks., j. | v maks., j./s | Zajęte komórki kontaktów / nKom, maks. w komórce |
|---|---|---|---|---|---|---|
| 20 | 9 166 | 105 | 0,07 s | 0,0000 | 0,00002 | 4 679 / 65 536, 8 |
| 10 | 48 070 | 164 | 1,1 s | 0,00004 | 0,0004 | 18 737 / 65 536, 14 |
| 5 | 329 936 | 206 | 64 s | 0,004 | 0,014 | 122 655 / 524 288, 19 |

**A/B gęstości.** ms GPU na klatkę: compute to krok fizyki plus kernele obrazu i pyłu, rysunek to wszystkie passy z cieniem na zamrożonej klatce (`kosztLod`). Sloty i cień: Atlas (2, 1), z bliska (7, 2), mały statek (7, 7).

| dx | Węzły | Podkroki, rytm | Compute | Rysunek, Atlas | Rysunek, z bliska | Rysunek, mały statek |
|---|---|---|---|---|---|---|
| 20 | 9 166 | 3, 3 | 0,16–0,52 | 0,38 (do 1,6) | 0,62 (do 3,0) | 0,73 (do 3,1) |
| **10** | **48 070** | **5, 4** | **0,45–0,53 (do 1,5)** | **0,96–1,06** | **2,47–2,81 (do 3,3)** | **3,11–3,45 (do 3,9)** |
| 5 | 329 936 | 11, 4 | 4,70–5,20 | 5,68–6,02 | 16,4–17,4 | 21,3–22,4 |

Wartości „do” pojawiają się głównie przy pierwszym pomiarze w scenie, a ten sam stan w innym biegu daje wartość bez nawiasu (dx = 10, M1, t = 2: 1,51, 1,49, 1,28 i 0,42 ms). Najpewniej to zegar karty przy małym obciążeniu, a nie kratery: przy dx = 5 M2 z kraterem w każdej klatce (t = 2) to 4,70 ms, a bez nich (t = 8) 5,20 ms. Osobnym pomiarem tego nie sprawdzono. Poza tym koszt nie zależy od tego, czy miasto stoi, czy leży. 5120 × 1440 przechodzi na dzień, ale tu wierzchołki dominują nad pikselami (§ 5a). Przy dx = 5 cała dzielnica to za dużo, a tak gęsto liczy się tylko to, co w kadrze: 130 budynków z limitu gry to około 89 tys. węzłów, szac. 1,3 ms compute i 4,5 ms rysunku przy (7, 2) albo 1,6 ms przy (2, 1).

**Ile stoi przy t = 8** (środek masy budynku względem początkowego: stoi ≥ 0,9, leży < 0,55):

| dx | M1 trafione: stoi / częściowo / leży | M1 nietrafione | M2 |
|---|---|---|---|
| 20 | 0 / 0 / 98 | 303 / 41 / 38 | 0 / 23 / 457 |
| 10 | 0 / 0 / 98 | 323 / 14 / 45 | 0 / 0 / 480 |
| 5 | 0 / 0 / 98 | 340 / 8 / 34 | 0 / 0 / 480 |

**Wygląd (ocena z arkuszy, nie oceniał tego człowiek).**
- **Kamera Atlasa (0,569 px / j., budynek 21–88 px, a wycinek 1280 × 720 ma tę samą skalę co 5120 × 1440):** przy dx = 10 to wygląda jak zawalenie budynków. Wieże składają się w dół, góra zostaje chwilę w powietrzu i rozsypuje się w hałdę, między nimi błyski i pył, nad M2 kurz stoi jak po wyburzeniu. Stojące budynki czytają się jako ramy z oknami. dx = 5 ma bogatsze fasady, ale zawalenie wygląda z tej odległości tak samo. dx = 20 przy tej skali jeszcze się wali, ale budynek to dwa słupy bloków bez okien, a przy M2 zostaje 23 częściowo stojących pniaków.
- **Z bliska (3,2 px / j., budynek 118–493 px):** przy dx = 10 to już **sypiące się kostki**: węzeł ma 32 px, fasada to sztaple bloków, hałda to równe sześciany. Przy dx = 5 budynek ma słupy, okna i stropy, a góra spada całymi płytami, więc w trakcie walenia wygląda to jak budynek. Sama hałda to dalej drobne równe kostki, a nie gruz.
- **Mały statek (7,88 px / j.):** dx = 10 to wielkie kostki, dx = 5 trzyma tylko w ruchu. Tu potrzeba dx = 2,5 albo odłamków drobniejszych niż węzeł, czego ta próba nie ma.

**Wybór:** dx = 10 przy Atlasie (cała dzielnica: 0,5 ms compute i 1 ms rysunku), dx = 5 z bliska, tylko dla budynków w kadrze. dx = 20 tylko jako zapas dla tieru poniżej około 30 px. Tak samo mówiła próba 1, a próba 2–4 dodaje, że tiery trzeba przełączać zanim węzeł urośnie ponad około 16 px.

**Domino w środku dzielnicy.** Wieże stoją 13–16 j. od siebie przy wysokości do 480 j. (uskok dokłada do 70% korpusu), więc nietrafione padają od gruzu jeszcze długo po ostatniej salwie. Przy dx = 10 nietrafione leżące przy t = 8, 12, 24:

| Wariant | t = 8 | t = 12 | t = 24 |
|---|---|---|---|
| Kop rP = 48, `kontaktSzok` 0,5 | 72 | | |
| Kop rP = 35, `kontaktSzok` 0,5 | 56 | 98 | 161 |
| Kop rP = 35, `kontaktSzok` 0 | 35 | 50 | 98 |
| Kop rP = 35, `kontaktSzok` 0,2, `eMin` × 4 | 29 | 50 | 95 |

Zostało rP = 35 i 0,2. To nie jest utrata stabilności: W1 stoi, a padają wieże przy hałdzie, której boczny nacisk i uderzenia są większe niż wytrzymałość liczona z ciężaru własnego budynku. Podłoga wytrzymałości nic tu nie zmienia. Pełne zatrzymanie domina wymagałoby zamrożenia osiadłej hałdy (metoda H, sama zdejmuje też jej koszt) albo wytrzymałości bocznej, której kalibracja nie zna.

**Czego nie sprawdzono:** tierów w jednej scenie (każda scena ma jedno dx), dx = 2,5, 5120 × 1440 i pełnego pomiaru kosztu z rysunkiem i krokiem w jednej klatce. Pył i kłąb (`OPCJE_PYLU.M1`, `M2`) mają jeden zestaw na wszystkie dx, a zrzuty pyłu oceniał tylko agent. Domino rozstrzyga użytkownik (§ 6).

### Wynik próby 5: tier 0, tysiące budynków bez solvera (scena M3)

GPU, RTX 5080, 1280 × 720, MSAA 4, sufit 60 kl/s, 2026-11-06, tryb nocny, wentylator 0%. Zrzuty i liczby: `.tmp/woksele-demo/LOD/dalekie/` (`arkusz-M3-atlas.png`, `arkusz-M3-daleko.png`, `AB-tiery-t12.png`, `koniec2/`, `koniecSam/`, `liczby.txt`). Narzędzie: `node scripts/webgpu/woksele-demo.mjs --zrzut M3 --miasto '{"dx":10}' --maxWez 64000 --nKom 65536 --chwile 2,6,8,10,12,16 --kamery atlas,daleko --kosztMiasta 1 --kosztDalekie 1 --rozmiar 1280x720 --out …`. Wszystko w tierze 0: `--miasto '{"dx":10,"xSolver":40,"ySolver":40}'`. Droga z panelu: `--zrzut S1 --chwile 0 --przyciskM3 1 --panel 1`.

**Jak obejrzeć.** Przycisk „Miasto: tysiące” albo `?scena=M3&maxWez=64000&nKom=65536&miasto={"dx":10}`. Kamera „Atlas daleko” (0,171 px / j., reżyser × 0,3) pokazuje całe miasto. Moduł `miastoDalekie.js` ładuje się tylko na tej stronie, więc S1–S5 mają te same pipeline'y co dotąd. Stare sceny dostały tylko pusty hak na cień i dodatkowy przycisk kamery przy M1 i M2.

**Co jest.** `planM3` (`scenaMiasta.js`): 4842 budynki z tej samej reguły, 1854 w pasie, który idzie od lewej do prawej w t = 1–15. Pas jest jedną funkcją dla obu tierów. Prostokąt w środku kadru (354 budynki, z tego 276 trafionych, 38 977 węzłów przy dx = 10, kratery w t = 7–9,7) idzie przez solver jak M1, a pozostałe 4488 to 7088 instancji (korpus i uskok osobno) w jednym rysunku: `Mesh` z `InstancedBufferGeometry`, bufor storage z chwilą zniszczenia, 205 wierzchołków na pudło. Budynek solvera ma w buforze instancję z rodzajem „gaśnie”, wszystkie wierzchołki w jednym punkcie, a tier wybiera się raz, w planie. W biegu samej M3 po rozgrzewce 0 nowych wpisów dziennika. W drodze z panelu (`--przyciskM3`, S1 → przeładowanie → M3 → M1 → M3) 0 synchronicznych, a samą liczbę wpisów przeładowanie tam zaciera. Test Node sprawdza WGSL i plan (`tests/wokseleMiastoDalekie.test.mjs`).

**Zawalenie (metoda B).** Bez fizyki, ale kształt z pomiaru solvera: dach / h przy t* = t / √(h / 1340) to 0,96; 0,79; 0,42; 0,20 przy t* = 1, 2, 3, 4, a `u = smoothstep(1; 4,2; t*)` trzyma tę krzywą w granicach 0,03. Wysokość Z ≤ H·u idzie do kopca (Z' = Hm·Z / H), powyżej sztywna góra spada o (H − Hm)·u, a obie gałęzie spotykają się przy Z = H·u, więc nic się nie rozrywa. Kopiec Hm = 14 + 0,085·H jak hałda przy dx = 10. Do tego pochylenie 2–11°, zniesienie, szum na wierzchołkach wspólny dla ścian, podstawa do 2,3 razy szersza. Budynek 154 j. wali się w około 1,7 s, 290 j. w około 2,3 s. Fasada: ten sam wzór co rama solvera przy tym dx (dwie warstwy stropu, pas fasady z dziurą między słupkami), a budynek poniżej 5 warstw to kostka bez okien, jak w `wezlyBudynku`. Kopiec i rozsypująca się góra: barwa i normalna z komórek świata 6,5 j., bez geometrii. Kernel emisji pisze do istniejących pul: dwa rekordy błysku z kłębem (ten sam pierścień 64 co kratery), cztery fale po 4 cząstki pyłu i 3 kawałki gruzu.

**Koszt.** ms GPU na klatkę, mediana z 5, wszystkie passy (rysunek, cień, głębia). Partia: 1,45 mln wierzchołków na przebieg, 4,35 mln na klatkę.

| Stan | Atlas, z partią | Atlas, bez partii | Daleko, z partią | Daleko, bez partii |
|---|---|---|---|---|
| t = 2, wszystko stoi | 1,02–1,04 | 0,53 | 1,10 | 0,52 |
| t = 6 | 1,06 | 0,54–0,56 | 1,08 | 0,55 |
| t = 12 | 1,37–1,38 | 0,89 | 1,32–1,34 | 0,78–0,79 |
| t = 16 | 1,30 | 0,80 | 1,33–1,34 | 0,81 |

- **Sama partia 5000 budynków: około 0,5 ms** (rysunek +0,2, cień +0,2, głębia +0,1), czyli 0,115 ms na milion wierzchołków, zgodnie z § 5a, i nie zależy to od tego, czy miasto stoi, czy leży.
- **Kernel emisji: 0,005–0,022 ms.** Compute z solverem 38 977 węzłów: 0,39–0,50 ms, tyle co M1 przy tym dx.
- **Wszystko w tierze 0, 4842 budynki, 0 węzłów:** rysunek 0,69–0,80 ms, compute 0,01–0,07 ms.
- Część prób daje 2,4–3,2 ms rysunku, a ten sam stan w innym biegu wartość normalną. Pasuje do zegara karty przy małym obciążeniu jak w próbach 2–4: `wyjście`, stały kwad pełnoekranowy, rośnie wtedy z 0,01 do 0,09 ms. Compute tak samo przy t = 2, bez żadnego krateru: 0,39 albo 1,36–1,39 ms. Ale przy t = 8, w środku kraterów solvera, compute to 1,33–2,47 ms we wszystkich czterech biegach, więc tam część może być prawdziwą ceną kraterów. Tego nie rozdzielono.
- **Szacunek dla całego ringu:** 110–180 tys. budynków w tej partii to około 15 ms, więc nie tak. W grze `haloRingCity` ma już swoje sloty, a 205 wierzchołków potrzebuje tylko to, co się wali: stojące po 24 wierzchołki w osobnym rysunku to około 8 razy mniej. To kolejny krok, nie ta próba.

**Czy z kamery Atlasa da się odróżnić tiery (ocena ze zrzutów, nie oceniał tego człowiek, sam ruch niesprawdzony):**
- **Stoją (t = 2, 6): nie.** Przy 1:1 granicy prostokąta nie widać, po powiększeniu × 4 tylko tyle, że dziury solvera mają głębię.
- **Walą się (t = 8, 10): tak, jak się patrzy.** W solverze wieża rozsypuje się na bloki, a ogień jest silniejszy, bo dochodzą światła błysków i żar na węzłach. W shaderze to postrzępiona bryła z drobnym wzorem. Przy budynku 88 px widać różnicę, przy 26 px (Atlas daleko) już nie.
- **Pył (t = 10, 12): największa różnica.** Pióropusz solvera jest gęstszy i trzyma się 3–5 s, a tier 0 ma na budynek 16 cząstek pyłu i kłąb z 8 albo 24.
- **Gruz (t = 16): prawie nie.** Pierwsza wersja była za jasna i prostokąt solvera dało się obrysować. Po przyciemnieniu barwy i komórkach 6,5 j. granicy praktycznie nie widać.
- **Domino jest tylko w solverze.** Przy t = 16 z 78 nietrafionych w prostokącie stoi 40, a nietrafione instancje stoją wszystkie. `AB-tiery-t12.png` pokazuje ten sam stan z solverem i bez: sam tier 0 w środku kadru też czyta się jak zawalenie, ale kopce są wyższe i jaśniejsze, a dywan gruzu rzadszy.

**Wniosek:** tier 0 działa i dla kamery Atlasa wystarcza, a pół milisekundy to cena tej próby, nie górna granica. Szew między tierami przy tej odległości jest do przyjęcia, bo najbardziej widać go w pyle i ogniu, a to dwa parametry do strojenia.

**Czego nie sprawdzono:** obrazu w ruchu, 5120 × 1440, kamery bliskiej dla tieru 0 (przy 3,2 px / j. ma być już tier 1), zmiany tieru w biegu (bufor ma rodzaj „gaśnie”, ale węzły powstają tylko w planie), kolizji gruzu solvera ze stojącymi instancjami (przelatuje), ceny cienia przy 1,8 j. na teksel w całym mieście poza tymi kadrami.

## 5a. Wynik: obraz z LOD (metoda G)

**Co jest.** Parametr sceny `lod: { sloty, cien }` w `SCENY` (`pokaz.js`), w biegu `obraz.ustawLod`, do oglądania `?sloty=1|2|7&cienSloty=0|1|2|7` przy każdej scenie. `sloty`: 7 jak dotąd (blok, 5 odłamków, pręt), 2 (uszkodzony węzeł to komórka przecięta raz na dwa kawałki), 1 (uszkodzony węzeł to jeden kawałek, kurczy się z d). `cien`: osobno dla mapy cienia, 0 to `castShadow = false`. Uniform i `instanceCount`, bez nowego pipeline'u, zm. 0 nowych wpisów dziennika po rozgrzewce przy przełączaniu w biegu. Scena bez `cien` w `SCENY` dostaje kamerę cienia z rozmiaru węzłów (`ustawCienZSceny`), a stare sceny mają swoje stałe. Pył w `OPCJE_PYLU`: `kwady` (sufit pierścienia), `emisja`, `rozmiar`, `sufitPx`, `lodDuze`. Przy wielu budynkach `pod: 0, grunt: 0`: te dwa pchają pył od osi z = 0, czyli jedną wieżę, a dzielnicę zwiałyby w jedną stronę. Rozlew od środka własnego budynku jeszcze nie istnieje.

**Pomiar (zm., RTX 5080, 1280 × 720, MSAA 4, sufit 60 kl/s, ms GPU ze znaczników na klatkę, sam rysunek bez fizyki).** Scena `LOD60`: 4 wieże S1, 59 768 węzłów, `?maxWez=61000`. Kamera 5200 j., cztery budynki w kadrze, węzeł około 5 px. Wszystkie passy: rysunek, mapa cienia, głębia, okluzja, pył, wyjście.

| Stan | 7 slotów, cień 7 | 2, cień 2 | 2, cień 1 | 2, cień 0 | 1, cień 1 | 1, cień 0 |
|---|---|---|---|---|---|---|
| t = 0, wszystko stoi (n instancji) | 0,99 | 0,98 | 0,98 | 0,60 | 1,00 | 0,60 |
| t = 5,5, trzy wieże w połowie, jedna leży | **4,34** | 1,55 | 1,36 | 0,99 | **1,00** | 0,64 |
| Każdy węzeł uszkodzony, górna granica | **4,84** | 1,57 | 1,36 | 1,02 | **0,98** | 0,63 |
| Wierzchołków na klatkę, mln | 30,1 | 8,6 | 7,2 | 5,7 | 4,3 | 2,9 |

Przy t = 5,5 i 7 slotach: rysunek 1,48, cień 1,53, głębia 1,18, pył 0,03. Przy 1 slocie: 0,38, 0,38, 0,19, 0,03. Koszt idzie za wierzchołkami, około 0,14 ms na milion, więc na tej karcie **wierzchołki dominują nad pikselami**. Zbliżenie 2600 j., t = 8: 4,47 / 1,47 (2, cień 1) / 1,13 (1, cień 1), czyli prawie tyle samo. Ekstrapolacja liniowa, szac.: 150 tys. węzłów to 12 ms przy 7 slotach, 3,4 ms przy (2, 1), 2,5 ms przy (1, 1). 5120 × 1440 jeszcze niezmierzone (noc): rysunek urośnie, wierzchołki nie.

**Pył, A/B na tej samej kamerze 2600 j., t = 8, cztery wieże:** opcje filmu (16 000 kwadów) 0,30 ms i mgła zasłania pół kadru. `LOD60` (6000 kwadów, emisja 0,35, rozmiar 1,5, sufit 90 px) 0,10 ms, hałda czytelna, chmura nad każdym budynkiem osobno. Cel pyłu ma stałe 720 wierszy, więc to się z oknem nie zmienia.

**Wygląd (zrzuty `.tmp/woksele-demo/LOD/pomiar/`: `a_*`, `c_*`, 7 / 2 / 1 slot na tym samym stanie).** Z 5200 j. wszystkie trzy warianty są prawie nie do odróżnienia. Z 2600 j. przy 7 slotach widać płytki i kawałki z wzoru k-d, przy 2 płytki zostają, przy 1 hałda to kostki: wiarygodne z daleka, gorsze z bliska. Nie oceniał tego człowiek. Wniosek: tier 1 (Atlas) to (2, 1) albo (1, 1), tier 2 (blisko) to 7.

**S1–S5 przy 7 slotach bez zmian wyglądu (zm.).** Klatka bez kroków, 921 600 px, kod sprzed zmiany kontra teraz: S5 t = 0: 0 px różnych. Z migawki Node: S1 t = 3,5: 14 px, S3 t = 0,8: 65 px. To szum: ten sam kod dwa razy daje S1 15 px, S3 102 px, a różnica w S1 mieści się w jednym prostokącie 5 × 4 px, czyli jedna kostka gruzu (`atomicAdd` w kObraz to wyścig o to, który kawałek dostaje który slot, a kształt kostki zależy od slotu).

**Sprostowanie liczb sprzed tej pracy.** `rysunekGpuMs` z `diag` i `renderGpuMs` z `kosztKlatki` (§ 1.9–1.13 spec) idą w pętli szybszej niż rAF, a mapa cienia odświeża się najwyżej raz na klatkę rAF. Mediana tych pomiarów nie zawiera więc passa cienia, a dla S1 to około 0,4 ms. `kosztLod` czeka na rAF przed każdą próbą.

## 5b. Zestawienie nocy: co potwierdzone liczbami

Wszystko RTX 5080, 1280 × 720, MSAA 4, ms GPU na klatkę, szczegóły i rozrzut w § 5 i § 5a. 5120 × 1440 nie mierzono, a oceny wyglądu są agenta, nie człowieka.

| Scena | Budynki | Węzły | Compute | Rysunek, Atlas (2, 1) | Rysunek, z bliska (7, 2) |
|---|---|---|---|---|---|
| M1, M2, dx = 20 | 480 | 9 166 | 0,16–0,52 | 0,38 | 0,62 |
| **M1, M2, dx = 10** | 480 | 48 070 | 0,45–0,53 | 0,96–1,06 | 2,47–2,81 |
| M1, M2, dx = 5 | 480 | 329 936 | 4,70–5,20 | 5,68–6,02 | 16,4–17,4 |
| **M3, dx = 10** | 4842: 354 w solverze, 4488 w partii | 38 977 | 0,39–0,50, przy kraterach 1,33–2,47 | 1,02–1,38 | nie dotyczy |
| M3, sam tier 0 | 4842 | 0 | 0,01–0,07 | 0,69–0,80 | nie dotyczy |

**Metody z § 3:**

| Metoda | Stan | Liczby |
|---|---|---|
| A. Węzły na żądanie | **Szacunek, niezbudowana** | Węzły stoją od startu sceny. Puli, alokatora ani siatki haszowanej nie ma, a tier wybiera się raz, w planie. M3 pokazuje tylko, że 354 budynki solvera kosztują tyle co M1 |
| B. Zawalenie w shaderze | **Potwierdzona, ale nie „około 0 ms”** | 4488 budynków w jednej partii: 0,5 ms rysunku, kernel emisji 0,005–0,022 ms. Cały ring tą partią: szac. 15 ms, więc stojące budynki potrzebują tańszej siatki |
| C. Sufit i kolejka | **Tylko część** | Kolejka kraterów: najwyżej 4 na klatkę (M2, 480 kraterów w t = 1–4 s). Budżetu węzłów i przelewu do tieru 0 nie ma |
| D. Grubsze woksele | **Potwierdzona** | dx 20 → 10: 5,2 razy więcej węzłów. dx 10 → 5: 6,9 razy, a compute około 10 razy, bo podkroki nie są stałe (3, 5, 11). Próba 1: dach wieży przy dx = 40 i 80 z c = 6000 blisko dx = 20. Gęstości z zoomu w biegu nie ma, dx zmienia przeładowanie strony |
| E. c ∝ dx | **Obalona w tej postaci** | Przy dx > 20 nic nie daje, a dla małego budynku działa c ∝ √s, czyli `MATERIAL_MIASTA` z c = 1897 (próba 1). Dach / h przy s = 0,5 i 0,125 zgadza się z wieżą do 0,01 |
| F. Wydmuszki | **Zysk mniejszy, inny układ** | Zamknięta rura kładzie się w całości (10,8°, maks 94°). Rama przy h = 154: 1156 węzłów wobec 1953 kostki przy dx = 5 (1,7 razy), 150 wobec 180 przy dx = 10 (1,2 razy), nie 2–3 razy |
| G. Obraz z LOD | **Potwierdzona** | 60 tys. węzłów, t = 5,5: 4,34 ms przy 7 slotach, 1,36 przy (2, 1), 1,00 przy (1, 1), 0 nowych pipeline'ów. 150 tys. węzłów: szac. |
| H. Gruz na stałe | **Tylko w tierze 0** | Kopiec z shadera kosztuje tyle co stojący budynek. Hałda solvera liczy się dalej, compute nie spada, gdy miasto leży. Zamrożenie hałdy jest niesprawdzone, a miałoby też zatrzymać domino |
| I. Filmy wypalone | Nie próbowana | Z kamery Atlasa wystarcza B, więc rezerwa bez zmian |
| J. Rzadszy krok dla dalekich | Nie próbowana | Sam rytm listy za dx (3, 4) to co innego |
| K. Inny solver | Nie teraz | Bez zmian |

**Tiery z § 4:** tier 0 i tier 1 stoją w jednej scenie (M3) i z kamery Atlasa szew jest do przyjęcia. Tier 2 (dx = 5 lub drobniej) ma tylko osobną stronę z całą dzielnicą, więc 130 budynków z limitu gry to dalej szac.: 89 tys. węzłów, 1,3 ms compute, 4,5 ms rysunku przy (7, 2). Mały statek przy 7,88 px / j. nie ma dobrego rozwiązania: dx = 10 to wielkie kostki, dx = 5 trzyma tylko w ruchu, dx = 2,5 niesprawdzone.

**Domknięcie:** przyciski, interakcje i drogi z panelu na 18 scenach bez porażek, 0 nowych pipeline'ów, S1 i S5 na tle `pokaz2` w szumie dwóch biegów tego samego kodu (spec § 1.14). Tryb nocny: serie do 65 s, wentylator 0% w tym domknięciu.

**Na dzień:** `--pomiar` i 5120 × 1440 dla M1 i M3, ocena na żywo w ruchu, rozdzielenie ceny kraterów od zegara karty (compute 1,33–2,47 ms przy t = 8).

## 5c. Benchmark misji 1: scena B1

GPU, RTX 5080, 1280 × 720, MSAA 4, sufit 60 kl/s, 2026-11-06, tryb nocny. Wentylator 0% i serie 7–23 s to odczyty z ręki, w logach ich nie ma. Zrzuty i liczby: `.tmp/woksele-demo/BAZA/` (`arkusz-B1-cala.png`, `arkusz-B1-atlas.png`, `arkusz-B1-dx80.png`, `koszt40.txt`, `szczyt40.txt`, `koszt80.txt`, `w1b.txt`, `bok1`–`bok4`; `w1.txt` to bieg sprzed podestu). Narzędzie: `node scripts/webgpu/woksele-demo.mjs --zrzut B1 --maxWez 86000 --nKom 131072 --chwile 0,4,8,12,16,20,26 --kamery bCala,bAtlas [--kosztMiasta 1] --rozmiar 1280x720 --out …`. W1: `--baza '{"dx":40,"stoi":true}' --chwile 5`. dx = 80: `--baza '{"dx":80}' --maxWez 26000 --nKom 65536`. Droga z panelu: `--zrzut S1 --chwile 0 --przyciskB1 1 --panel 1`.

**Jak obejrzeć.** Przycisk „Baza piratów” przeładowuje stronę z `?scena=B1&maxWez=86000&nKom=131072`. Strona domyślna dalej startuje od S5. Kamery: „Atlas” (0,14 px / j., w oknie 5120 px to cała baza, a w 1280 px wycinek wokół habitatu), „Cała baza” (0,085 px / j., dla okna 1280 × 720, poza zadaniem, bo inaczej arkusz nie obejmuje całości), „Z bliska” (0,5 px / j., W-1, sloty 7).

**Wywołanie bez strony.** `scenaB1({ dx })` z `src/3d/woksele/scenaBazy.js` zwraca plan, a `zbudujPlan(plan)` z `budowa.js` daje `{ w, g }` dla `solver.wczytaj(w)` i `solver.ustawPlan(g)`. Bez DOM, bez `pokaz.js`, moduł importuje prawdziwe `createPirateBaseLayout` i `k7HeightToZ`. Części z zakresami węzłów: `plan.miasto.budynki`, kolejka zdarzeń: `plan.gpu.kratery`, `plan.gpu.puscKotwiceF`. Budowa w Node: 2,4 s przy dx = 40 (18 rozwiązań CG, najwięcej 653 iteracji), 0,2 s przy dx = 80.

**Układ.** X = x, Y = −z, Z = `k7HeightToZ(h)`, więc wysokości nad płaszczyzną gry są jak w grze (× 0,42): dach wieżowców 1211 j., głowa 1782 j., maszt 2303 j. To wartości nominalne, bez pokrycia w logu. Najwyższy węzeł przy dx = 40 odczytany z `zbudujPlan`: wieżowce 1180 j., H-C + H-T 2300 j. Wszystkie części leżą na jednej siatce świata i żadne dwie nie dzielą komórki. Pole ijk jest wirtualne jak w dzielnicy, więc między częściami nie ma wiązań, a statyka liczy się po części. Część wisi na swojej dolnej warstwie, dysk na ośmiu łukach kotwicy przy trzonie, jak S5. c = 6000, g = 400, dx = 40: 4 podkroki, rytm listy 4.

| Część | dx = 40 | dx = 80 |
|---|---|---|
| W-1, W-2 (rama `wieza()`), każda | 3 772 | 464 |
| H-C + H-T (szyb, szyja, głowa, maszt), z tego szyb 994 / 178 | 10 109 | 1 560 |
| Bęben (ściana, pierścień, grodzie) | 7 568 | 1 668 |
| Trzon pod bębnem | 1 376 | 272 |
| Pomosty: Y-A, Y-B, N-P, F-P | 2 650, 2 625, 2 275, 1 725 | 318, 312, 416, 317 |
| Pomosty: D-G, M-P, P-S, P-P | 1 090, 1 035, 975, 1 360 | 162, 156, 147, 201 |
| Zbiorniki P-1, P-2, P-3 | 2 228, 2 208, 2 208 | 468, 456, 456 |
| Kolektor P-M, magazyn M-1 | 966, 4 840 | 170, 1 104 |
| Dysk z tierami, 8 sektorów | 30 948 | 6 578 |
| **Razem** | **83 730** | **15 689** |

**W1, 5 s, dx = 40:** 0 zerwanych wiązań, 0 NaN, po rozgrzewce 0 nowych wpisów dziennika. Największe przemieszczenie 6,2 j., tylko w N-P i F-P, wszystkie pozostałe części 0. Przyczyny nie sprawdzono bezpośrednio. Najpewniej to komórki podestu uwięzione między słupami wieżowca, które nie mają wiązania do dolnej warstwy i osiadają na najbliższym stropie, bo przed dołożeniem podestu reszta sceny miała 3,5 · 10⁻⁶ j.

**Sekwencja, 138 kraterów:** t = 1–4 salwy w dół W-1, t = 4–7 W-2, t = 7–10 wyłom w H-S (9 kul po łuku ściany, 5 po pierścieniu), t = 10 nacięcie nasady szyi od strony wyłomu, t = 14 przecięcie zawiasu i szybu, t = 15–20 dysk puszcza sektorami od strony uderzenia, t = 17–21,5 ogień w rurach (zbiorniki, magazyn, co 620 j. wzdłuż pomostów), t = 21,5 `puscKotwiceF` i reszta spada. Czas szyi różni się od zadania (10–12): przecięcie zawiasu wcześniej niż przy uderzeniu głowy kosztowałoby prowadzenie upadku, tego wariantu nie mierzono.

**Koszt, ms GPU na klatkę, dx = 40.** Compute to krok fizyki z kernelami obrazu i pyłu, 12 kolejnych klatek od tej chwili. Rysunek to wszystkie passy z cieniem na zamrożonej klatce.

| Chwila | Compute | Rysunek, Atlas (2, 1) | Rysunek, Cała baza (2, 1) | Rysunek, Z bliska (7, 2) |
|---|---|---|---|---|
| t = 0, stoi | 0,68 | 1,01 | | 0,92 |
| t = 3,5, ostrzał W-1 | 0,54 | 1,45 | | 3,93 |
| t = 8, wyłom | 0,55 | 1,46 | | 3,92 |
| t = 14, uderzenie głowy | 0,50 | 1,47 | | 3,93 |
| t = 15 | 0,50 | 1,49 | 1,46 | |
| t = 18, sektory i ogień | 0,45 | 1,48 | | 3,95 |
| t = 19 | 0,44 | 1,45 | 1,49 | |
| t = 22, wszystko spada | 0,39 | 1,46 | 1,50 | |
| t = 24 | 0,39 | 1,48 | | 3,96 |
| t = 25,5, lądowanie pomostów | 0,47 | 1,49 | 1,53 | |

Rysunek przy (2, 1) to 10 mln wierzchołków na klatkę, a t = 0 ma 6 mln, bo stojąca scena rysuje tylko bloki. Przy (7, 2) 32 mln. Wychodzi 0,12–0,17 ms na milion, blisko 0,14 z § 5a. Szacunek 3,4 ms dla 150 tys. węzłów przy (2, 1) daje po przeskalowaniu na 83 730 węzłów 1,90 ms, a zmierzone jest 1,45–1,49 ms, czyli mniej, niż przewidywał. **Całość z kamery Atlasa: około 2 ms GPU (0,4–0,7 + 1,5).** t = 0 ma najwyższy compute przy braku jakichkolwiek kraterów, więc to raczej zegar karty przy małym obciążeniu z § 5 niż praca, ale osobno tego nie sprawdzono. Koszt nie rośnie w szczycie upadku.

dx = 80, 15 689 węzłów: compute 0,17–0,50, rysunek przy (2, 1) z kamery Cała baza 0,33–0,44, z kamery Atlas 0,35–0,45, oprócz t = 8 i t = 14, gdzie jest 0,92 i 0,88. Te dwa odczyty mają te same 1,9 mln wierzchołków, a wszystkie składniki około dwa razy wyższe, więc to raczej zegar karty niż praca; nie sprawdzono tego. Compute nie spada proporcjonalnie, bo przy kraterach i pyle (0,46–0,50 przy t = 8–18, 0,17–0,18 poza nimi) koszt kerneli zdarzeń i obrazu przestaje zależeć od liczby węzłów, ale przyczyny też nie rozdzielono pomiarem. Wniosek: przy tej scenie dx = 40 nie jest za drogie, a dx = 80 oszczędza z kamery Atlas 0,6–1,3 ms razem z compute (t = 0, 8, 14, 18, 24), głównie w rysunku. Sprostowanie: wcześniej stało tu „około 1,4 ms” i rysunek „0,35–0,45”, bez dwóch wyższych odczytów.

**Wygląd (ocena z arkuszy, nie oceniał tego człowiek, ruchu nie oglądano).** Baza czyta się jako baza: bęben z grodziami, trzon, schodkowy dysk, głowa na szyi, dwa wieżowce na pomostach, poprzeczka T, skos, magazyn, zbiorniki. Upadek czyta się jako upadek: wieżowce składają się na podest, część gruzu spływa na planetoidę, szyja przez wyłom kładzie się ku kamerze, głowa przebija dysk i ląduje z sektorem na podłodze, sektory odpadają, wybucha paliwo, reszta spada w jednej chwili. Przy dx = 80 to te same zdarzenia, tylko dużymi blokami. Z kamery z bliska rama wieżowca wali się tak, jak S1.

**Co nie wyszło od razu (przydatne przy grze):**
1. **Kratery nie przechylą wieży kopem:** pchnięcie krateru ma zerowy pęd. Przechył wziął się dopiero z nacięcia po stronie upadku, nad płytą na szybie. Trzy wcześniejsze próby: krater w płytę, dół szyi wpada w pusty szyb, a głowa spada pionowo (`bok1`–`bok3`).
2. **Wytrzymałość z ciężaru własnego nie wystarcza nośnym częściom pod obciążeniem przypadkowym.** Bez zapasu szyja kruszy się po nacięciu, głowa zsuwa się po szyi, a podest nie zatrzymuje gruzu. `plan.poWypieku` (hak w `zbudujPlan`) daje szyi i środkowi głowy × 8, podestowi × 30, bez wyprowadzenia z fizyki. W grze jest to samo pytanie, co przegub z `pirateBaseNeck.js`: jawny zawias kontra zapas w budowie.
3. **`uRDysk` w obrazie dociąga do koła każdy węzeł dalej od osi niż R,** nie tylko dysk. Stąd `meta.dysk.R = 1e9` w B1. Dopóki scena ma dysk i coś poza nim, trzeba o tym pamiętać.

**Czego w scenie nie ma:** statków, dna bębna, placu kontenerów M-2, iglic i zwężenia wieżowców, rur, kratownicy, anten, osady i windy z planetoidy. Planetoida to płaska podłoga na z = −3400 ze stałym g = 400, a nie kula 32 km ze studnią, bo w kernelu grunt jest płaszczyzną. Zrzuty pokazują ją jako ciemne tło, więc gruz bez cienia wygląda, jakby wisiał.

**Czego nie sprawdzono:** obrazu w ruchu, 5120 × 1440, ziaren innych niż 21, W1 przy dx = 80 (sam bieg sekwencji przeszedł bez NaN), przebiegu w prawdziwej grze ze statkami i ostrzałem. Test przycisków miasta raz nie przeszedł, gdy harness szedł z priorytetem BelowNormal: S1 budowało się dłużej niż 4 s stałego czekania przy powrocie, a powtórka bez tego priorytetu dała 0 porażek. Stare sceny nie były porównywane pikselami, zmiany w nich to tylko widoczność przycisków kamer.

## 5d. Benchmark misji 1: w grze

Pomiar B1 z § 5c w prawdziwej misji 1: `scripts/webgpu/gpu-baza-gra.mjs --woksele 1`, 2026-11-06, RTX 5080, 1280 × 720, `limitKlatek=60`, tryb gracza (render w workerze), preset grafiki bez nadpisania, headless, tryb nocny. Bieg po kolei: a1, b1, a2, b2 (A = gra, B = gra + woksele), dodatkowo c1 (B z sygnałem 18 s później). Liczby i zrzuty: `.tmp/woksele-demo/BAZA/gra/<bieg>/` (`raport.json`, `log.txt`, `01-przed.png`, `03-ostrzal-koniec.png`, `04-upadek.png`, `06-nad-gruzem.png`).

**Co to mierzy.** Kod gry bez zmian. Moduł `src/3d/woksele/wGrze.js` ładuje harness po starcie misji operacją dev, w workerze. To wariant A z zadania: 83 730 węzłów (dx = 40), bryły i gruz w passie FG Core3D (warstwa 2, perspektywa, światła, cień słońca i post gry), obraz (2, 1), krok `Core3D.addFxStep` 60 Hz, najwyżej 2 kroki na klatkę, a głębia, AO i pył w celach własnych z tego samego kroku. Skład pyłu to kwad w FG. Stara baza zostaje w kadrze i wszystko liczy się dalej, więc to **koszt dołożony do starego silnika, górna granica, nie zamiana**. Ostrzał gry nie trafia wokseli: sekwencja B1 idzie z planu, od sygnału w chwili pierwszej serii.

**Tabela, ms GPU na klatkę, średnia z dwóch biegów, rozrzut to różnica S p50 między powtórzeniami.** R to render, C compute, S suma, wszystko z klatek pełnych. CPU to klatka workera p50. Każde okno ma 96–122 klatki, `przed` 361–362, `nad-gruzem` 402–409.

| Okno | A: R | A: C | A: S p50 / p95 | A: CPU | B: R | B: C | B: S p50 / p95 | B: CPU | B − A, S p50 | Rozrzut a1 ↔ a2 | Rozrzut b1 ↔ b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| przed | 0,35 | 0,06 | 0,41 / 2,19 | 1,51 | 1,61 | 0,58 | 2,30 / 2,61 | 1,77 | **1,89** | 0,00 | 0,02 |
| ostrzał 1 (pierwsze) | 1,79 | 2,43 | 4,22 / 5,72 | 2,54 | 3,61 | 3,06 | 6,77 / 8,50 | 3,20 | **2,56** | 0,17 | 0,14 |
| ostrzał 3 (środek) | 1,88 | 3,77 | 5,66 / 7,86 | 3,01 | 3,43 | 4,59 | 7,97 / 8,93 | 3,56 | **2,31** | 0,61 | 0,24 |
| ostrzał 4 (ostatnie) | 1,58 | 4,12 | 5,71 / 6,20 | 3,76 | 3,38 | 4,92 | 8,29 / 8,80 | 4,03 | **2,58** | 0,07 | 0,19 |
| upadek 1 (szczyt p50) | 1,67 | 5,21 | 6,91 / 7,20 | 4,46 | 3,51 | 5,86 | 9,41 / 9,73 | 4,69 | **2,50** | 0,41 | 0,40 |
| upadek 2 (szczyt p95) | 1,35 | 4,99 | 6,49 / 10,01 | 3,22 | 3,33 | 5,85 | 9,31 / 12,86 | 3,46 | **2,82** | 0,65 | 0,79 |
| osiadłe 1 | 0,72 | 0,30 | 1,02 / 1,23 | 2,50 | 2,49 | 1,09 | 3,51 / 4,14 | 2,75 | **2,49** | 0,45 | 0,24 |
| nad gruzem | 0,62 | 0,06 | 0,69 / 3,51 | 2,25 | 2,45 | 0,56 | 3,08 / 3,60 | 2,43 | **2,39** | 0,04 | 0,15 |

**Czy baza a1 ↔ a2 pozwala mówić o różnicy b − a? O sumie tak, o szczegółach nie.** Bez statystyki, po dwa biegi. W ośmiu oknach tabeli rozrzut S p50 w A to najwyżej 0,65 ms, w B najwyżej 0,79 ms, a różnica 1,89–2,82 ms. Także w najgorszym ułożeniu, gorszy bieg B minus lepszy bieg A, zostaje tam 1,88–2,45 ms.

**Sprostowanie: to wybór okien, więc „w każdym oknie” było za mocne.** Przeliczenie z surowych `raport.json` potwierdza tabelę co do setnych, ale raport ma 27 okien z co najmniej 60 pełnymi klatkami w każdym biegu i dwa z nich, poza tabelą, mają rozrzut A znacznie większy: ostrzał 2 (S p50 6,24 w a1 i 1,07 w a2, `fx:wybuchy` 3,24 i 0,37) oraz seria 3 (2,62 i 6,69, `fx:wybuchy` 1,52 i 2,90). Upadek 2 leży na granicy 0,65 ms. W ostrzale 2 B − A wychodzi −0,08 ms, a to nic nie znaczy, bo decyduje o tym, czy gaz wybuchów wpadł w okno biegu A. Po tych 27 oknach B − A to najmniej −0,08, mediana 2,49, najwięcej 3,30 ms. Wniosek „około 2,4–2,5 ms” zostaje jako typowy koszt, ale tylko tam, gdzie gaz gry nie przykrywa różnicy; gaz sam zmienia S o kilka ms między biegami tego samego kodu.

Czego z tej bazy nie wolno odczytać:
- Różnic między oknami. Rozpiętość 2,31–2,82 ms mieści się w rozrzucie, więc „płasko” znaczy tylko: zmiany nie widać przy rozdzielczości około ± 0,7 ms.
- Podziału na compute przy samej sumie. Compute B − A to 0,64–0,85 ms, a rozrzut compute 0,54 ms w A i 0,57 ms w B (głównie `fx:wybuchy`, np. upadek 1: 4,84 w a1 i 5,40 w a2). Pewne jest 0,46–0,61 ms z etykiety `fx:woksele-fizyka`. Render B − A (1,26–1,98 ms przy rozrzucie najwyżej 0,22 w A i 0,39 w B) jest pewny.
- P95. Różnica p95 skacze od 0,09 do 2,91 ms, a rozrzut p95 w A sięga 1,14 ms (ostrzał 3: 8,44 i 7,29). `przed` i `nad gruzem` mają w A p95 2,2–3,6 przy p50 0,4–0,7, więc tam p95 nie mówi nic o wokselach.
- Względnych liczb przy osiadłym gruzie: A to 1,25 i 0,80 ms, czyli rozrzut około 44% średniej.

Pipeline'y synchroniczne po rozgrzewce: **0 render, 0 compute** we wszystkich pięciu biegach (sonda, okno po oknie), a w B także lista `syncPipeline` z nazwami jest pusta. Rozgrzewka nie jest jednak darmowa: w b1, b2 i c1 dziennik workera ma raz, przy s ≈ 34,5, przed oknem `przed`, „kompilacja w grze” 30–34 ms na „woksele: bryły”. Bieg A ma takie wpisy dla innych modułów (26–75 ms). Węzły: 83 730. Kraterów wykonanych 138 z 138, pominiętych 0. Kroki solvera: dwa na klatkę w 903–966 klatkach z 5800–6100, przepadło 29–37 kroków; w c1 prawie wszystkie (30 z 31) w oknie upadek 7. Rozgrzewka: moduł gotowy 4,6 s po sygnale w b0, 4,2 s w c1, budowa w osobnym wątku. Wszystkie biegi: finał z etapów po 65–69 strzałach (limit 120 nie zadziałał), `obce` 0, błędów 0.

**Co robi różnicę (etykiety sondy, ms na klatkę):**

| Okno | `fx:woksele-fizyka` (C) | `fx:woksele-cele` (R) | Cień słońca (R) | `pass:fg` A → B (R) |
|---|---|---|---|---|
| przed, same bloki | 0,59 | 0,30 | 0,32 | 0,03 → 0,71 |
| ostrzał 1 | 0,61 | 0,58 | 0,34 | 0,79 → 1,66 |
| ostrzał 3 | 0,48 | 0,59 | 0,31 | 0,77 → 1,46 |
| upadek 1 | 0,46 | 0,61 | 0,30 | 0,57 → 1,39 |
| upadek 2 | 0,54 | 0,59 | 0,31 | 0,39 → 1,28 |
| nad gruzem | 0,56 | 0,59 | 0,37 | 0,02 → 0,87 |

Kolumny `Cień słońca` nie wolno dodawać do `pass:fg`: cień to etykieta `pass:fg>…renderShadow`, czyli część tego passa. `fx:woksele-cele` 0,30 → 0,6 to przejście z bloków na (2, 1). Razem około 2,4 ms, a compute rośnie o 0,64–0,85 ms w oknach z pracą i 0,49–0,52 ms w `przed` i `nad gruzem`. W oknach z pracą to więcej niż sama fizyka, bo `fx:wybuchy` w parach a1 ↔ b1 i a2 ↔ b2 jest o −0,03 do +0,29 ms wyżej, a to mniej niż 0,57 ms rozrzutu tej etykiety między biegami, więc tej nadwyżki nie można przypisać wokselom. Demo dało około 2 ms (§ 5c), gra daje 2,3–2,8 ms przy p50. **Koszt jest prawie płaski: od sygnału do osiadłego gruzu 2,3–2,8 ms przy p50, różnice w granicach rozrzutu.**

**Szczyt na szczycie (bieg c1, sygnał 18 s po pierwszej serii).** W a i b szczyt wokseli (t = 14–25) wypadał w ostrzale 2–3, a nie w prawdziwym upadku. W c1 stan modułu po oknach upadek 1–4 to t = 17,6, 19,6, 21,7, 23,7, a ostrzał 4 kończy się przy t = 14,8, więc te okna pokrywają około t = 15,6–23,7 (sprostowanie: wcześniej stało 17,6–23,7, a to są końce okien): S 9,18 / 9,47, 8,93 / 12,17, 8,48 / 12,02, 8,16 / 11,59. To tyle samo co b1 i b2, więc **nałożenie szczytów niczego nie dokłada**. Jeden bieg, bez powtórzenia.

**Co odpadłoby po zamianie, GPU w 720p.** Compute starego silnika zniszczeń prawie nic nie kosztuje: `fx:pole skóry 3D (rozrzut)` najwyżej 0,003 ms, `fx:hullDamageMap` najwyżej 0,016 ms. Największy compute to `fx:wybuchy` (w A 2,0–4,0 ms w ostrzale 1, 3 i 4, 4,8–5,9 w upadku 1–4): to gaz wybuchów, nie silnik zniszczeń, i bez osobnej decyzji zostaje. Render: sonda nie dzieli passów na moduły, więc skór nie da się odczytać wprost. Górna granica tego, co mogą być skóry w A: `pass:bg` 0,20–0,52 ms, `pass:ortho` 0,08–0,88 ms, `pass:fg` 0,02–0,79 ms, a w tym są jeszcze niebo, skała, okręty i efekty. Stojąca baza to razem R 0,35 ms przy p50, osiadły gruz 0,72 ms. **W GPU przy 720p zamiana odzyskałaby najwyżej ułamek tych liczb, więc w tej rozdzielczości nie spłaci 2,4 ms wokseli.** Czego stąd nie widać: CPU wątku gry (fizyka belek i budowli, nie ta sonda), wysyłek skór (`hullSkin3DScatterVal` 31–36 KB na klatkę w upadku 1, a w upadku 7 aż 177–229 KB) i wzrostu liczby rysunków (40–42 → 222–260 w `nad gruzem` w A, 254–297 w `osiadłe 1`; woksele dokładają 7 w `przed` i 5–13 w ostrzale i upadku, a przy gruzie rozrzut A przykrywa różnicę; sprostowanie: wcześniej stało 6–9) przy 5120 × 1440. Tu nie zmierzono, co odpadnie na CPU.

**Pamięć.** Wokselowe bufory i cele: +89–90 MB buforów i +3,7 MB tekstur wg sondy (`przed`), +92–112 MB wg `nvidia-smi`. Moc, najwyższa średnia okna (nie chwilowy szczyt): 181–186 W w A, 201–214 W w B.

**Co można wnioskować o 5120 × 1440, a czego nie.** Tabela E0 (2,2 ms przed, 7–8 ms ostrzał, 9,9 / 18,2 ms upadek) jest z 5120 × 1440, `grafika=ultra&limitKlatek=120`, i **nie porównuje się wprost** z tymi liczbami. Te liczby pochodzą z treści zadania. W repozytorium pokrycie ma tylko p95 około 18 ms (`docs/PLAN-zawalenia-budowli-3d.md`, R7), a surowego raportu tej tabeli przy tym sprawdzeniu nie znaleziono, więc trzeba je traktować jak cytat. Compute z założenia nie zależy od rozdzielczości, więc około +0,5–0,85 ms powinno przejść 1:1, ale to szacunek: w § 5d pewne jest tylko 0,46–0,61 ms z etykiety fizyki, a przy 5120 × 1440 nikt tego nie mierzył. Render zależy: większość `pass:fg` i cienia to wierzchołki (§ 5c: około 0,15 ms na milion), a cele własne mają sufit 720 wierszy i 2560 szerokości, więc nie rosną 8 razy, ale kwad składu pyłu i cieniowanie brył rosną z pikselami, a 5120 × 1440 to 8 razy więcej pikseli. Szacunek, nie pomiar: dołożone R około 2–5 ms. Tego też nie wolno dodać do E0: stary silnik sam zmienia się z rozdzielczością, a w E0 p95 upadku to 18,2 ms. Rozstrzyga pomiar dzienny.

**Co wynik jest wart, a czego nie:**
- Prawda: pełen silnik i pełny obraz (2, 1) wokseli na tym samym urządzeniu, w tym samym workerze, passach i poście, z prawdziwą walką, wybuchami i upadkiem, kosztuje około 2,4 ms GPU w 720p przy 60 kl/s i 0 pipeline'ów synchronicznych.
- Nieprawda: woksele nie są tu grą. Ostrzał ich nie trafia, nie kolidują z okrętami i starą bazą, sekwencja jest z planu. Fizyka B1 jest płaska kosztowo (§ 5c), ale prawdziwe kratery z pocisków mogą mieć inny rytm: `KRATER_N`, `BLAST_N` i pierścień slotów nie są tu sprawdzone pod ogniem.
- Obraz wobec dema: światło błysku na bryłach nie działa (`emissiveNode` czyta `positionWorld`, przy 5–10 mln j. to nie trafia w dane lokalne; koszt zostaje, obrazu nie ma), a grunt solvera z = −3400 jest niewidzialny, więc gruz leży na nim, a nie na skale gry. Materiał nie ma `sunVisibility` ani haków ośrodka pasa.
- W kadrze widać obie bazy naraz. Woksele zasłaniają starą, gaz wybuchów gry kładzie się na wokselach. Ocena ze zrzutów, nikt tego nie oglądał w ruchu.
- **Gruz przykrywa Atlasa.** W `06-nad-gruzem.png` narzędzie stawia Atlasa nad środkiem bazy z kamerą statku: w a1 i a2 stoi na środku kadru, w b1 i b2 widać tam tylko hałdę i czerwone lampy okrętu. Bryły idą w passie FG, czyli po kadłubach, mimo że leżą pod płaszczyzną gry. To wniosek z czterech zrzutów, nie z osobnej próby; kosztu nie zmienia (kadłub i tak się rysuje), ale przy podłączeniu do gry bryły muszą iść przed kadłubami.
- **Z kamery gry wygląda to dziś znacznie gorzej niż w demie z ukosa.** Hałda zakrywa Marsa i większość kadru, kostki dx = 40 na zoomie statku to wielkie ciemne bloki, a stojący dysk z góry ma schodkowy brzeg i szachownicę w miejscu starej bazy (`b0/01-przed.png`). Ciemności nie rozdzielono: materiał nie ma `sunVisibility`, a słońce gry świeci inaczej niż własne słońce dema. Ten bieg odpowiada na pytanie o koszt, nie o wygląd.
- Okna upadku różnią się między biegami, bo upadek jest chaotyczny: czas do osiadania ft 21,3 / 32 w A i 20,9 / 26,6 w B. Okna z 50 kl/s workera i bimodalny compute (p95 8–10 ms w upadku 2–4) są i w A, i w B, więc to nie woksele.

**Pomiar dzienny, 5120 × 1440 (nie wolno go puszczać nocą):** `node scripts/webgpu/gpu-baza-gra.mjs --rozmiar 5120x1440 --query grafika=ultra --strzalyMaks 120 --slad 0 --out .tmp/woksele-demo/BAZA/gra-5120/a1`, potem to samo z `--woksele 1` do `b1`, potem `a2`, `b2`. Bez `limitKlatek` headless biegnie bez sufitu klatek, a GPU na 99%. Do wprost porównania z E0 zamiast tego `--query "grafika=ultra&limitKlatek=120"`.

## 5e. Wpięcie w grę: obraz bazy misji 1 (2026-11-06)

Decyzja użytkownika: „wgrajmy silnik do gry”, na domyślnej kamerze z góry, bez przełącznika w adresie, z teksturami starej bazy. W gałęzi `claude/woksele-wiazane`, `main` bez zmian. Stan i zasady: reguła `woksele-zawalen`.

Zrobione: moduły silnika w `src/3d/woksele/`, klej w `src/3d/pirateBaseGame.js`, skóra z wypieku starej bazy, przekrój tło / FG (Atlas nad gruzem), kratery ze zdarzeń gry, węzły i gruz giną na skale, pełna rozgrywka dalej na silniku belek.

Pomiar: 1280 × 720, `limitKlatek=60`, worker, jeden bieg `GRA/t1` (kadry z t2). Sama suma GPU klatki, nie koszt dołożony.

| Okno | S p50 ms | S p95 ms |
|---|---:|---:|
| przed (baza stoi) | 1,19 | 1,35 |
| ostrzał 1 | 6,69 | 8,13 |
| ostrzał 4 | 9,86 | 10,53 |
| upadek 2 | 9,32 | 13,28 |
| po | 3,01 | 3,55 |
| nad gruzem | 2,94 | 3,40 |

Dla porównania bieg z § 5d (stara baza + woksele dołożone) miał 2,30 przed ostrzałem, a sama stara baza 0,41. Tu nie ma A/B z tej samej chwili: pomiar A/B przy 5120 × 1440 wciąż do zrobienia (`--woksele 0` / `1`, § 5d), a w oknach ostrzału i upadku większość to gaz wybuchów (`fx:wybuchy` 4–7 ms). W t2 po poprawkach 0 pipeline'ów synchronicznych.

Znane braki: kolizje dalej stare (Atlas może uderzyć w schowaną bryłę tam, gdzie woksele już spadły), brak usypiania gruzu, po zawaleniu pomost i dysk drgają, ściany boczne bez wypieku (poszycie i okna fasad z shadera), moc okien tylko z zasilania habitatu.

**Po próbie użytkownika (ten sam dzień).** Uwagi: środek szary (ma być w klimacie budowli albo z prostymi wnętrzami), spadek całej bazy zostaje, a przy upadku spadki do ~20 kl/s, podejrzany stary dym na planecie. Zrobione: wnętrza z shadera i paleta piratów, drugi wypiek skóry ze zgaszonym słońcem, upadek na wokselach (stare ciała i ich wraki znikają przy HP 0, a dym i ślady powstają tam, gdzie węzły wpadają w kulę skały), do tego poprawki z przeglądu.

Czas `HullBodies.step` na stronie gry, ms na krok, 720p (`GRA/f-stary`, `GRA/f-nowy`, po jednym biegu, `--woksele 0 / 1`, pole `fizStrona`):

| Okno | Stary upadek: średnia / maks | Woksele: średnia / maks |
|---|---:|---:|
| upadek-1 | 3,42 / 9,5 | 0,08 / 0,1 |
| upadek-2 | 4,36 / 7,0 | 0,07 / 0,1 |
| upadek-6 | 6,48 / 16,0 | 0,01 / 0 |
| upadek-7 | 8,33 / 15,8 | 0,01 / 0 |
| upadek-8 (lądowanie, 226 gorących wraków) | 13,51 / 24,7 | 0,01 / 0,1 |

GPU S p50 / p95, ms, 5120 × 1440, Ultra, `limitKlatek=120`, worker (`GRA/k-stary`, `GRA/k-nowy`, po jednym biegu; upadek jest chaotyczny, a gaz zmienia S o kilka ms między biegami tego samego kodu, § 5d):

| Okno | Stara baza | Woksele |
|---|---:|---:|
| przed | 2,01 / 2,18 | 3,13 / 3,20 |
| ostrzał 1 | 7,36 / 10,47 | 9,19 / 11,85 |
| ostrzał 3 | 6,88 / 10,38 | 9,05 / 12,21 |
| upadek 1 | 10,03 / 15,09 | 16,45 / 17,37 |
| upadek 2 | 12,22 / 12,81 | 9,75 / 15,87 |
| upadek 3 | 7,87 / 9,80 | 7,79 / 10,98 |
| po | 2,56 / 2,84 | 2,35 / 4,27 |
| nad gruzem | 3,03 / 3,59 | 2,33 / 2,96 |

Rozbicie przy 5120 × 1440: `fx:wybuchy` 2,6 ms w ostrzale, 8,7 ms w oknie upadek 1 nowego biegu, 4,9–6,0 ms w starym; sam `fx:woksele` około 1 ms (cele 0,65, kernele 0,3–0,8). Stojąca baza dokłada 1,1 ms: dwa passy rysują te same węzły. Klatka CPU workera spada: p50 przy upadku 1,4–2,6 ms wobec 2,8–4,5 ms.

AGENT: `klatkiStronyS` z tego narzędzia nie jest czasem klatki gry. Okna z 32 kl/s i `raf max` około 30 ms są w obu wariantach, to odkładanie rAF przez headless bez taktu (pamięć `headless-takt-raf`). O przestojach strony mówi `fizStrona` i `raf.slow`, nie to pole.

**Nowe lądowanie (ten sam dzień).** Uwaga użytkownika: resztki dymu i iskry na planecie są niepotrzebne, a trzeba napisać nowy upadek, pył i kratery. Zrobione: kula kontaktu, fala kotwic od habitatu, pył regolitu z węzłów, mapa kraterów, zamrożenie ruin po 38 s, a do tego wyniki przeglądu (grawitacja ku skale, zegar upadku z kroków solvera, upadek liczony także poza kadrem, kadr z głębokością ruin, kratery poza soczewką). Woksele nie karmią już `RockImpactFx`. Stan i zasady: reguła `woksele-zawalen`.

Trzy błędy widoczne w kadrach, wszystkie znalezione sondami, nie zgadywaniem:

- Dwie jasne kule i biała smuga po HP 0 to para i ogień wyrw (`--sonda 1`, gaszenie grup materiałów, `GRA/t9`). Worker podawał obrazowi wyrw czas 0, gdy wyrw nie było, więc odpięcie powietrza zamrażało cząstki na stałe.
- Kratery na kubełek: ~3500 stempli równej wielkości, wygląd folii bąbelkowej (`GRA/t10`). Po zmianie na krater na bryłę: 53–70 kraterów o promieniu 190–900 j. (`GRA/t13`, `k7`).
- Proste łańcuchy kraterów wzięte w `GRA/t12` za ślad pomostów to był błąd. Przegląd pokazał, że gruz zsuwał się ze skały (stała −z na kuli, kąt tarcia 35°), a `kGinieLicz` przycinał go do brzegu siatki. Węzły na brzegu siatki w szczycie: 29 tys. przed zmianą pola (`GRA/t11`, liczone przez przegląd z logu `GRA/t12`), około 430 po niej (`GRA/t13`, `GRA/t14`).

GPU S p50 / p95, ms, 5120 × 1440, Ultra, `limitKlatek=120`, worker, po jednym biegu (`GRA/k-stary`, `GRA/k8`). `k8` to ostateczny kod. Wybuchy zmieniają szczyt o kilka ms między biegami tego samego kodu: `upadek 1` wyszło 11,8, 11,0 i 11,9 w `k3`, `k4` i `k7`, a 17,7 w `k8`.

| Okno | Stara baza | Nowe lądowanie |
|---|---:|---:|
| przed | 2,01 / 2,18 | 3,48 / 3,78 |
| ostrzał 1 | 7,36 / 10,47 | 10,91 / 13,80 |
| upadek 1 | 10,03 / 15,09 | 17,73 / 19,05 |
| upadek 2 | 12,22 / 12,81 | 11,13 / 16,85 |
| upadek 3 | 7,87 / 9,80 | 9,19 / 13,61 |
| upadek 6 | 5,03 / 6,85 | 5,18 / 5,99 |
| po | 2,56 / 2,84 | 4,88 / 5,84 |
| nad gruzem | 3,03 / 3,59 | 3,16 / 3,74 |

Światło gruzu przy skale (`vNaSkale`) dołożyło około 0,4 ms w oknie `przed` (3,07 w `k6`, 3,48–3,52 w `k7`, `k8`), także po przeniesieniu z fragmentu na wierzchołek. Da się je wyłączyć do pierwszego zdarzenia uniformem, jeśli stojąca baza będzie za droga. Fizyka na stronie w upadku ≤ 0,2 ms na krok.

**Po próbie użytkownika (scalenie do main, `ab78bf2b`).** Ocena: „powiedziałbym, że jest płynnie”, a przerwy z punktu niżej nie były widoczne w oknie. Uwagi i przyczyny znalezione w kodzie:

- Gruz za mało maleje w locie: w ujęciu upadku kamera stoi ~21 km nad płaszczyzną, więc na skale 24 km niżej zostawało ~0,45 rozmiaru. `PIRATE_ROCK_SPEC.scale` 2 → 3: szczyt skały 40 km pod płaszczyzną, ~0,34, lot wieży ~17 s zamiast ~13 s.
- Drobny gruz skacze: kontakt z sufitem wypychania i pasem gaszenia odskoku (reguła, „LĄDOWANIE”). Węzły przy brzegu siatki w szczycie: 33–51 (`GRA/t15`, `t16`).
- Brak kraterów po wieżowcu: odczyt uderzeń ruszał dopiero przy HP 0. Teraz od pierwszego zdarzenia, a próg spadł do 8 węzłów w kubełku i 20 w bryle (95–127 kraterów w misji).
- Efekty obok miejsca upadku: gruz lądował na kuli o średnim promieniu, a bryła skały odchodzi od niej do ±1600 j. Teraz kontakt, licznik uderzeń, pył i miejsce krateru czytają ten sam kształt.

Nie sprawdzone w grze: krater po wieżowcu przed HP 0 (w teście z narzędzia gruz doleciał już po HP 0).

**Kształty inne niż sześciany (pytanie użytkownika: prawdziwe koło habitatu, ukosy K-7, nie wokselizować wszystkiego).** Analiza czytając kod, bez uruchamiania, trzy drogi i sceptyk (przebieg `wf_f5b9e420-758`). Wniosek:

- Najpierw dociąganie rogów bloków do prawdziwego obrysu. Jest już w `obraz.js` (`uRDysk`), wyłączone przez R = 1e9, działa w rysunku, głębi i cieniu, szac. poniżej 0,02 ms. Schodek 40 j. staje się cięciwami 40 j., które przy R = 1000 odstają od łuku o 0,2 j. Trzeba podnieść próg z 0,5 dx do ~0,75 dx i dodać tabelę kształtów (numer w wolnych bitach flag 18–23). Działa tylko przy d ≤ 1e-3: uszkodzony blok wraca do kostki.
- Potem, jeśli będzie trzeba: stara siatka do pierwszego trafienia w całości (`aktywuj()`), kilka linii. Oddaje ~1,1–1,5 ms w spoczynku, ale przeskok przy pierwszym trafieniu widać.
- K-7, ring i doki nie mają dziś punktów ani trafień, więc nie potrzebują węzłów: zostają siatką. Ich zawalenie to osobna praca, najpierw w warstwie gry.
- Odłożone: wycinanie fragmentu po wypieku (dziurawi skorupę, brak ściany z boku) i prawdziwa siatka na węzłach (800–1200 linii, a przełom i tak zostaje kostką).

Tego nie da się obiecać: koła po uszkodzeniu, zawalenia bez węzłów, prawdziwych fasad i podcięć pod nawisem.

Próba na habitacie (ten sam dzień, `GRA/kolaZ-*`, 5120 × 1440, zoom 0,5, porównanie `GRA/kolaZ-prawo.png`): rogi bloków czterech części habitatu trafiają w 12 promieni z układu (`uKola`, `BIT_KOLO`), pas 0,8 dx. Zewnętrzny brzeg bębna z poszarpanego staje się czystym kołem. Koszt stojącej bazy: 2,99 ms z dociąganiem, 2,96 ms bez, po jednym biegu, różnica w granicach szumu; stara baza 2,04 ms. Zostaje: wewnętrzne krawędzie w bębnie częściowo schodkowe, a kolce starej bazy nie mają węzłów, więc w wypieku zostawiają klinowe wcięcia na okrągłych hangarach (widoczne z dociąganiem i bez). Zbiorniki i skośne pomosty jeszcze bez kształtów.

**Otwarte: przerwy między klatkami strony w 5120 × 1440.** W oknach upadek 2–4 (około 3–8 s po HP 0) rAF strony ma przerwy 100–290 ms, co około 0,5 s, a procesor graficzny pracuje na 99 % (`k3`, `k4`, `k7`, `k8`). W 720p ich nie ma (`t11`–`t14`), w `k-stary` i `k-nowy` też nie. Sprawdzone:

- To nie JS strony: `long-animation-frame` pokazuje 0 ms blokady i brak skryptów, cała przerwa przypada przed `renderStart`.
- To nie odczyt uderzeń: bez `odczytGinie` przerwy są takie same, do 241 ms (`k9`).
- W śladzie Chrome (`k5`) w tych sekundach rośnie rastrowanie warstw strony: `DoRasterCHROMIUM` 6600 na 3 s wobec 613 przed ostrzałem, najdłuższe zadanie procesu GPU 47 ms. W samym `k5` przerw nie było, bo ślad przestawia czasy.

Hipoteza, niepotwierdzona: GPU nasycone klatkami workera (`S` ≈ 10 ms przy około 100 kl/s) głodzi kompozytor, który przerysowuje HUD w bardzo szerokich kafelkach. `k-stary` nie nasycał GPU, bo worker był wolniejszy (`S` 12 ms przy 46 kl/s). Pomiar jest bez okna, więc nie wiadomo, czy gracz to widzi. Następny krok, jeśli widać: limit klatek w kolejce GPU po stronie workera (reguła `render-worker`) i test przy tym samym oknie.

## 5f. Wybuchy misji 1 po próbie użytkownika (2026-11-06)

Zgłoszenie: wybuchy wyglądają na oskryptowane i jest ich za dużo, dym zakrywa habitat, a powinna być widoczna wieża, reakcja łańcuchowa miała być nagrodą za wysadzenie zbiorników, wokół rozwalonego habitatu lata białe powietrze.

Przyczyny (przegląd kodu, potwierdzony drugim czytaniem):

- `_chainExplosion` zapalał rury z habitatu (`_fuelChain 'H'`) po 0,6 s. Około 140 wybuchów w 10 s po HP 0 (85 w rurach, 35 okrętów, 13 kroków pomostów, 5 habitatu, 2 magazynu) i około 195 wtórnych, do tego 13 na osadzie.
- Dym nie jest 2D: to gaz 3D rysowany w płaskim pudle bez testu głębi. Część nad płaszczyzną gry idzie w passie FG po wokselach FG, więc kładzie się też na wieży. Kula `capital` ma promień 1,6 · size, a przy 640 przykrywa cały bęben.
- Białe powietrze to wyrwa przyczepiona do niewidocznych starych ciał świata: leciała z nimi i przeskakiwała na odłamy (`rehome`). Świecące źródło to jej żar. Nie jest to pozostałość po odpięciu: widać ją tylko przed HP 0, w ruchu kawałków.

Wyniki (1280 × 720, ta sama droga: Yamato po etapach, 0 błędów konsoli, 0 pipeline'ów synchronicznych, podsumowanie po ~33 s od HP 0):

| Droga | wybuchy w całym przebiegu | z gazem | wtórne | obraz |
|---|---|---|---|---|
| finał bez zbiorników | 24 | 11 | 0 | bęben i wieża widoczne we wszystkich kadrach, w `t17` przykryte szarą chmurą |
| wysadzone zbiorniki (`--zbiorniki 1`) | 191 | 105 | 42 | baner, 35 okrętów, magazyn, habitat pada od ognia po kilku sekundach |

Bez zbiorników gazu bazy nie widać już po około 4 s upadku. Do oceny użytkownika: upadek bez wybuchów może być teraz zbyt cichy, a dym `baza` zbyt rzadki. Niebieski obłok na kadrach to trafienia plazmy Yamato, której używa narzędzie (`--bron`), a nie gaz bazy.

## 6. Decyzje do użytkownika po pokazie

Nowe po benchmarku misji 1 (§ 5c, § 5d):

- **B1 z życia.** Czy baza z przycisku „Baza piratów” po obejrzeniu w ruchu nadal „trzyma”, bo oglądał ją dotąd tylko agent ze zrzutów.
- **Pomiar dzienny.** Czy puścić a1, b1, a2, b2 przy 5120 × 1440 (polecenie w § 5d), bo w 720p dołożone 2,4 ms mówi niewiele o renderze w Twojej rozdzielczości.
- **Zamiana czy dokładka.** Czy woksele mają docelowo zastąpić bazę na belkach i skórach, skoro w GPU w 720p zamiana nie spłaci kosztu, a zysk na CPU wątku gry jest jeszcze niezmierzony.
- **Następny krok w grze.** Czy najpierw podłączyć prawdziwe kratery z pocisków do wokseli (ostrzał dziś ich nie trafia), czy najpierw zmierzyć wariant zamiany bez starej bazy.
- **Szyja.** Czy wieża ma padać z jawnego przegubu jak w grze (`pirateBaseNeck.js`), czy z zapasu wytrzymałości w budowie, jak dziś w B1 (§ 5c, punkt 2).
- **Kamera gry.** Demo pokazuje upadek z ukosa, a gra z góry, skąd gruz to dziś ciemna hałda na cały kadr (§ 5d). Czy stroić obraz pod kamerę gry (drobniejszy woksel przy statku, światło, sprzątanie gruzu), czy upadek ma mieć własne ujęcie z boku.

Wcześniejsze:

- **Ocena na żywo M1, M2, M3 z kamery Atlasa.** Żaden człowiek tego nie oglądał w ruchu. Od tego zależy wybór dx = 10 przy Atlasie, wygląd tieru 0 i czy szew w pyle i ogniu trzeba stroić.
- Czy zawalenie może kosztować kilka ms przez kilka sekund (bez tego demo zostaje demem).
- Tempo: budynek 37 j. spada przy g = 400 w około 0,4 s, szkło w około 0,9 s. Czy ma być szybko jak na tę skalę, czy spowolnione mniejszym g na ringu.
- Czy trwałe zniszczenie miasta ma się zapisywać, a jeśli tak, to czy odnawia się powoli jak porty (D10b).
- Domino w gęstym śródmieściu (§ 5, wynik prób 2–4): nietrafione wieże padają od gruzu jeszcze długo po ostrzale, przy t = 24 s około 95 z 382. Czy to zostaje jako zachowanie, czy osiadła hałda ma je zatrzymać.
- Domino jest tylko w solverze, a gruz solvera przelatuje przez stojące instancje tieru 0 (§ 5, wynik próby 5). Czy granica tierów może się tak różnić, skoro z kamery Atlasa widać to słabo.
- Czy mały statek ma kiedyś oglądać miasto z 7,88 px / j. Jeśli tak, potrzeba dx = 2,5 albo odłamków drobniejszych niż węzeł, a to osobna praca. Decyzja o `?malaSkala` i tak czeka.
- Kolejny krok po tej próbie: węzły na żądanie i sufit (metody A i C, nadal w demie) czy lustro generatora całego ringu. Pierwsze sprawdza koszt przy tierach przełączanych w biegu, drugie dotyka już gry.
