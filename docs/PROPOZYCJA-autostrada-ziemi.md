# Autostrada wokół Ziemi — propozycja (demo)

Stan z 2026-11-07. Demo: `dema/autostrada.html`. Do gry nic nie jest wpięte. Reguła obszaru: `.claude/rules/autostrada.md`.

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

## 3. Style w demie (klawisze 1–4)

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
