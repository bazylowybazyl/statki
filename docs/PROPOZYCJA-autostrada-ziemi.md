# Autostrada wokół Ziemi — propozycja (demo)

Stan z 2026-11-12. Demo: `dema/autostrada.html`. Do gry nic nie jest wpięte. Reguła obszaru: `.claude/rules/autostrada.md`.

Sekcje 1–5 opisują układ „pierścień” i cztery style z panelu projektowego. Sekcja 6 to piąta propozycja „Rama” (2026-11-12): inny układ drogi pod stocznię wystającą daleko od ringu i inny wygląd.

Prośba użytkownika (2026-11-06): pasy ruchu wokół planet, najbardziej rozwinięte przy Ziemi. Jedna wielka autostrada-pierścień, którą przecinają wyloty z hal K-7 i z doków. Droga ze światła, latająca infrastruktura, skrzyżowania. Czerwone światło dla ruchu, gdy w misji 1 wylatuje Atlas. Jednostki: policja, ciężarówki (małe ciągniki z 1–5 kontenerami), frachtowce, workforce, turystyka. Wygląd jest najważniejszy.

## 1. Jak powstało

- **Panel projektowy:** pięć niezależnych kierunków wyglądu, dwie oceny (dyrektor artystyczny, render i rozgrywka) i inżynier ruchu. Inżynier zaprojektował sieć na prawdziwych liczbach gry i sprawdził ją skryptem: 0 kolizji z halami, zatokami, pylonami i redą.
- **Wyniki ocen:**
  - „Klisza” — 8,5 i 8;
  - „Nocne Podejście” (lampy) — 7,5 i 8;
  - „Malowanie światłem” — 6,5 i 7;
  - „Nawa” — 6 i 5,5;
  - „Tętnica” — 5 i 7 (odpadła: czyta się jak mapa korków).
- **Demo** stoi na prawdziwym `Core3D`: Ziemia gry, ring „Halo” z halami K-7, proxy statków ruchu, kadłub Atlasa na belkach.

## 2. Układ (liczby w j. gry, scena)

- **Przekrój:** r 59 500–63 980. Formalizuje dzisiejszy objazd planety w ruchu v2 (keepR ≈ 64 tys.); autostrada leży poza redą i poza studnią Ziemi.
  - Ruch prawostronny: jezdnia wewnętrzna jedzie CW, zewnętrzna CCW.
  - Na jezdnię: pobocze, L3 (240: ciężarówki, workforce, turyści), L2 (400: frachtowce), L1 (400: wyprzedzanie, policja).
  - Pas rozdziału ma 1600, z kieszeniami zawrotek.
- **Ciężkie (1800 × 660) i mega (2760 × 912) autostradą nie jadą.** Przecinają ją tylko w pudłach K-7 i dojeżdżają drogami przedpola do pasów MEGA zatok.
- **Węzły co 90°** (16 sztuk na obwodzie):
  - K-7: skrzyżowanie z sygnalizacją. 4 pasy promieniowe, linia stopu ±4200 po stronie napływu (z góry „czerwone Z”). Cykl uruchamiany wezwaniem ciężkiego: MAIN → YELLOW 3 s → CLEAR → BOX → CLEAR2.
  - Zatoki: zjazd i wjazd prawo-prawo z jezdni wewnętrznej.
  - Tranzyty: zjazd ku Ziemi tunelem ringu.
  - Wrota z kosmosu: wlot i wylot na jezdni zewnętrznej, aleja 38 tys. j. w głąb.
  - Zawrotki: zmiana jezdni bez przecięć.
- **Atlas (misja 1):**
  - F = żółte, po 3 s czerwone;
  - kolejka staje przed linią;
  - korytarz K-7 zapala się zielono-błękitnymi lampami;
  - zielone wraca 2 s po tym, jak rufa minie zewnętrzną krawędź.
  - Przy 507 j/s czerwone trwa ok. 38 s, a korek ma 4–10 tys. j.
- **Ruch:** IDM + zmiana pasa, ok. 1400 pojazdów, 0,35 ms na krok 0,1 s. Ten sam świat dla wszystkich stylów.
  - Zmiana pasa to krzywa po przebytej drodze, a nie po czasie, więc jest gładka w każdej klatce.
  - Ślady idą prawdziwym torem z historii pozycji (bufor 2048 slotów × 32 chwile co 0,2 s).

## 3. Style w demie (klawisze 1–4; klawisz 5 — „Rama”, sekcja 6)

1. **Klisza** — długi czas naświetlania: włosy światła za pojazdami.
   - Kolor śladu według jednostki (domyślnie) albo według kierunku (K).
   - Ślady tylko z daleka (domyślnie), zawsze albo bez nich (T). Z daleka drogę niesie rzeka z pola gęstości.
2. **Nocne Podejście** — droga z tysięcy lamp jak na lotnisku: kurtyna lamp przy czerwonym, ścieżka zieleni przed dziobem Atlasa.
3. **Malowanie światłem** — oznakowanie poziome ze światła:
   - kreski, kliny zjazdów, STOP przy czerwonym;
   - fala przemalowania pod prąd przy zamknięciu.
4. **Nawa** — tafle i obręcze światła nad i pod płaszczyzną gry. Najmocniejsza w kamerze kinowej.

**Wspólna baza we wszystkich stylach:**
- podkład przyciemniający niebo pod drogą (niebo gry jest jasne);
- bar stopu z lamp, głowice sygnałów, bramownice nad jezdnią (statki przelatują pod nimi), wieże węzłów, boje, kocie oczy;
- kod świateł jednostek: policja błyska ≤ 2 Hz, frachtowiec ma dwa białe światła masztowe, workforce ciepłe okna, turystyka złotą girlandę.

## 4. Decyzje dla użytkownika

| # | Pytanie | Rekomendacja |
|---|---|---|
| A1 | Który styl (albo co z którego połączyć)? | Klisza jako baza, kurtyna i ścieżka zieleni z „Nocnego Podejścia”, fala przemalowania z „Malowania” przy K-7 |
| A2 | Ślady pojazdów | tylko z daleka (gasną od zoomu ~0,12 do 0,32); z bliska obraz niosą kadłuby i lampy |
| A3 | Kolor śladów | według jednostki, z lekką domieszką ciepła kierunku |
| A4 | Ruch na autostradzie w grze: tylko prawdziwe kursy ruchu v2 czy też statyści? | Reguła ringu mówi „bez ruchu zastępczego”. Pełna rzeka wymaga ok. 1000+ pojazdów na pierścieniu, a bańka ma limit 512 encji. Propozycja: kursy ruchu v2 jako encje przy graczu, a z daleka pole gęstości z rekordów kursów (bez encji). |
| A5 | Workforce: widoczne dojazdy do pracy | Rotacja jest w kodzie (W0–W4), ale dojazd w obrębie rynku-źródła nie ma kursu. Propozycja: wahadłowce 60 miejsc jako WIDOK rotacji (ok. 3800 kursów/h przy Ziemi, sektor ringu → tranzyt → zatoka), fala szczytu z doby sektora. |
| A6 | Ciągniki z sesji `ciagniki` | scalić gałąź `refs/heads/claude/ciagniki-kosmiczne-9e575a` i podpiąć ich partię w demie zamiast prostokątów zastępczych |
| A7 | Ciężkie i mega przez autostradę | tylko przecinają w K-7 (cykl ~180 s, czerwone ~34 s dla głównej) |

## 5. Wpięcie w grę (gdy zapadną decyzje)

- **Ruch v2:**
  - `routeRing` z objazdem po `arcR` zamienić na trasę przez węzły (wrota, zawrotki, zjazdy);
  - łuki oczekiwania `holdingSlotPosition` przenieść na osie wrót;
  - `approachSeconds` (45 s) jest krótszy niż przejazd autostradą (110–170 s).
- **Sygnał:** jedno źródło stanu dla bańki, kursów i obrazu (rekord strumienia rozkazów). Czerwone wyzwala pozycja okrętu, z limitem zamknięcia ok. 60 s.
- **Obraz:** w workerze renderu, w rejestrze kotwic soczewki warpa. Mgła wojny przyszarzy dalszy łuk (do decyzji).

## 6. Propozycja 5: „Rama” (2026-11-12)

Prośba użytkownika: jeszcze jedna propozycja, inna niż cztery z panelu, z miejscem na większy dok — hala K-7 ma zostać stocznią, która wystaje daleko od ringu. W demie: klawisz 5 albo `?styl=rama`.

### 6.1 Dlaczego inny układ

Brama hali K-7 leży dziś 7,4 tys. j. od początku huba (r ≈ 53,4 tys.), a pierścień drogi zajmuje r 59,5–64 tys., czyli zaczyna się 13,5 tys. j. od początku huba. Stocznia sięgająca dalej wchodzi w jezdnię. Rozgrywka jest w 2D, więc droga nie może przejść „nad” bryłą — musi ją objechać w płaszczyźnie gry.

### 6.2 Układ (liczby w j. gry)

- **Kształt:** kwadrat o zaokrąglonych narożach wokół ringu.
  - Cztery proste („prospekty”) są styczne do dzisiejszej drogi przy tranzytach: oś jezdni 61 740 od środka Ziemi, jak w pierścieniu.
  - Cztery naroża opływają głowice stoczni (kompleksy 45°, 135°, 225°, 315°) łukiem o promieniu osi 18 tys. j. Pas L1 nie musi zwalniać (granica: 16 tys.).
  - Wierzchołek osi drogi w narożu: r ≈ 79,9 tys.; krawędź jezdni wewnętrznej: 77,6 tys.
- **Stocznia (makieta):** głowica 29 tys. j. od początku huba (r ≈ 75 tys., prawie 4 × dzisiejsza hala), pół szerokości bryły 1,5 tys. Odstęp głowicy od jezdni: 2,6 tys.
- **Przekrój i pasy:** jak w pierścieniu (te same szerokości i prędkości). Pasy są krzywymi równoległymi: ta sama odległość w poprzek na prostej i na łuku.
- **Węzły:** wszystkie zjazdy, wjazdy, zawrotki i wrota leżą na prostych.
  - Tranzyty: w osi każdego boku, bez zmian wobec pierścienia.
  - Zatoki: spur promieniowy od grzebienia zatoki do prostej (23–24 tys. j.; w pierścieniu 13 tys.). Rampa po stronie naroża skręca o 58°, druga o 122°.
  - Wrota z kosmosu: aleje prostopadłe do boku, po dwie na bok.
  - Zawrotki: po cztery na bok, w pasie rozdziału.
- **Węzeł stoczni w narożu:** sześć pasów promieniowych przez jezdnię.
  - ±810: pochylnie w środku stoczni (wylot Atlasa i nowych kadłubów).
  - ±2 430: wyjazd ciężkich wzdłuż burt.
  - ±4 050: wjazd ciężkich.
  - Wyjazd leży bliżej osi niż wjazd, więc drogi przedpola do pasów MEGA zatok się nie przecinają. Drogi przedpola przy ringu zostają jak w pierścieniu.
  - Linia stopu 5 700 j. przed osią węzła, na łuku naroża.
- **Długość drogi:** pas odniesienia 454 tys. j. (wewnętrzny) i 472 tys. j. (zewnętrzny); w pierścieniu 379 i 397 tys.

### 6.3 Ruch (ta sama symulacja, 3 ziarna po 15 minut)

| | Pierścień | Rama |
|---|---|---|
| Średnia prędkość na pasach | 512–558 j./s | 657–662 j./s |
| Czerwone przy wylocie Atlasa | 34–49 s | zwykle 24–32 s, pojedyncze do 55 s (fazę wykorzystują też ciężkie) |
| Przejazdy na czerwonym | 0 | 0 |

- Atlas stoi na pochylni tuż przed głowicą i ma do jezdni krócej niż z głębi hali, stąd krótsze czerwone.
- Ciężkie i mega przecinają jezdnię tylko w pudle naroża i tylko w fazie przejazdu (test).

### 6.4 Wygląd: ciemna tafla

Cztery style z panelu rysują drogę światłem na przyciemnionym niebie. „Rama” odwraca zasadę: droga jest ciemną płytą ze szczotkowanej stali o ostrych krawędziach, a światło pojawia się tam, gdzie pada.

- **Płyta:** dwie jezdnie prawie czarne, pas rozdziału to przydymiona szczelina (widać przez nią niebo). Krawężniki i przerywane linie pasów jak na prawdziwej autostradzie.
- **Połysk:** zależy od kąta jezdni do Słońca. Jezdnia w poprzek kierunku do Słońca błyszczy, a na łuku naroża połysk wędruje.
- **Odbicia świateł:**
  - stożek reflektorów przed dziobem każdego pojazdu, dłuższy z prędkością;
  - czerwone odbicie za rufą przy hamowaniu;
  - niebieski i czerwony rozbłysk policji na płycie;
  - czerwone albo żółte odbicie baru stopu przed linią;
  - chłodna łuna pod Atlasem, gdy przecina jezdnię.
- **Pasy stoczni:** poza fazą przejazdu ledwie zarys. W fazie przejazdu krawędzie pochylni świecą zielono-biało, pasy ciężkich słabiej.
- **Z daleka:** linie pasów gasną, zostaje obrys płyt. Stożki reflektorów rosną do 2,6 ×, żeby ruch był czytelny.
- **Makieta stoczni:** burty, grzbiet, suwnice bramowe nad pochylniami, portal głowicy, ciemne dno doku, lampy robocze. To obrys i zasięg do oceny układu, nie projekt bryły.

### 6.5 Parametr zasięgu

`?zasieg=<j. od początku huba>` przelicza całą sieć. Do 29,6 tys. j. proste zostają na 61 740. Dalej naroże zacieśnia się do 16 tys., a potem cały kwadrat rośnie:

| Zasięg stoczni | Oś jezdni na prostej | Promień naroża |
|---|---|---|
| 22–29,6 tys. | 61 740 | 18 000 |
| 35 tys. | 64 960 | 16 000 |
| 40 tys. | 68 500 | 16 000 |
| 50 tys. | 75 570 | 16 000 |

### 6.6 Decyzje dla użytkownika

| # | Pytanie | Rekomendacja |
|---|---|---|
| A8 | Układ drogi: pierścień czy rama? | Rama, jeśli stocznia ma sięgać dalej niż ok. 11 tys. j. od początku huba (jezdnia pierścienia zaczyna się na 13,5 tys.); inaczej pierścień wystarcza |
| A9 | Prawdziwe wymiary i kształt stoczni: zasięg od ringu i szerokość | Makieta: 29 tys. j. i ±1,5 tys. Sieć przelicza się z jednej liczby. Uwaga: koncept `dema/stocznia-ringu.html` (2026-11-12, do oceny) stawia stocznię skrzydłami PO ŁUKU ringu, do r ≈ 52,3 tys. — taka nie sięga jezdni; wtedy pierścień może zostać, a przepiąć trzeba rampy zatok (skrzydła stoją w ich miejscu) |
| A10 | Ciężkie wzdłuż burt stoczni (nabrzeża zaopatrzenia) czy osobny węzeł dla zatok? | Wzdłuż burt: jeden węzeł z sygnałem na naroże, stocznia dostaje ruch przy burtach |
| A11 | Skąd Atlas wylatuje w misji 1: z pochylni stoczni czy z hali K-7? | Z pochylni (krótsze czerwone, kadr z głowicą i jezdnią naraz) |
| A12 | Wygląd tafli jako baza? | Można ją łączyć ze śladami „Kliszy” w dalekim kadrze — do oceny po obejrzeniu |
