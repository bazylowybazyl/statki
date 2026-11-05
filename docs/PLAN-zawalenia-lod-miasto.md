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

## 6. Decyzje do użytkownika po pokazie

- Czy zawalenie może kosztować kilka ms przez kilka sekund (bez tego demo zostaje demem).
- Tempo: budynek 37 j. spada przy g = 400 w około 0,4 s, szkło w około 0,9 s. Czy ma być szybko jak na tę skalę, czy spowolnione mniejszym g na ringu.
- Czy trwałe zniszczenie miasta ma się zapisywać, a jeśli tak, to czy odnawia się powoli jak porty (D10b).
- Domino w gęstym śródmieściu (§ 5, wynik prób 2–4): nietrafione wieże padają od gruzu jeszcze długo po ostrzale, przy t = 24 s około 95 z 382. Czy to zostaje jako zachowanie, czy osiadła hałda ma je zatrzymać.
