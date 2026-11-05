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

## 6. Decyzje do użytkownika po pokazie

- Czy zawalenie może kosztować kilka ms przez kilka sekund (bez tego demo zostaje demem).
- Tempo: budynek 37 j. spada przy g = 400 w około 0,4 s, szkło w około 0,9 s. Czy ma być szybko jak na tę skalę, czy spowolnione mniejszym g na ringu.
- Czy trwałe zniszczenie miasta ma się zapisywać, a jeśli tak, to czy odnawia się powoli jak porty (D10b).
