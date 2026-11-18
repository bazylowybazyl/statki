# Standard ładunku: propozycja

> **MATERIAŁ WSTĘPNY — WYMIARY I TONY SĄ ROBOCZE.** Decyzja użytkownika (2026-11-16, wieczorem): „standaryzacja musi pójść później — to w trakcie budowy fabryk i stoczni wyjdą rozmiary transportowanych surowców, a nie na odwrót. Nie wiem, jaki nam wyjdzie zawijas stali czy jaki nam wyjdzie gaz przy rafineriach. Wszystko ułożymy naturalnie po kolei i później.”
>
> Co to znaczy dla tego dokumentu:
> - Liczby sekcji, naczep i nośników (§ 1) nie są ustalone. Zostaną przeliczone, gdy zakłady dadzą rozmiary prawdziwych wyrobów (pierwszy będzie krąg stali z huty, potem belka, zbiornik gazu, sekcja kadłuba).
> - Na podstawie tych liczb nie zmienia się istniejących danych (`src/data/spaceTrucks.js`, `cargoBays.js`, `cargoContainers.js`) ani dem. Zmiany z § 3 i decyzje S1, S2, S8–S10 są odłożone.
> - Kierunek, który użytkownik nazwał „fajnym”, zostaje: jeden standard ładunku, statki zostają i dostają sprzęg albo gniazdo na sekcję, kopacz z kruszarką.
> - Ocena dema ciągników (§ 4) czeka na decyzję użytkownika. Kolejnych elementów nie zaczynać bez niej.

Stan: propozycja wstępna (2026-11-16). Do gry nic nie jest wpięte, żadna istniejąca liczba nie została zmieniona. Plansza wymiarów: `/dema/standard-ladunku.html`. Dane: `src/data/cargoStandard.js`, test `tests/cargoStandard.test.mjs`. Reguła obszaru: `.claude/rules/transport-ladunku.md`.

Słowa użytkownika (2026-11-16): „Materiał będzie pakowany na ciężarówki — trzeba ustandaryzować naczepy — do rozwożenia po ringu i pobliskich baz, np. Księżyc”; „ustandaryzować rozmiary ładowni i robić z nich à la naczepy do ciągania przez większe trucki, czyli de facto zamienić frachtowce na ciągnik + kosmiczną naczepę”; „co ze statkami? W sumie nic. Kopaczom da się ustandaryzowaną naczepę, np. w środek budowy — kopacz też będzie mógł ciągać, odpinać. Podepnie sobie naczepę i np. kruszarkę.”

## 1. Standard w liczbach

Jedna drabina. Każdy stopień to 2 × 2 poprzedniego: dwa razy dłuższy, dwa razy szerszy, cztery razy cięższy.

| stopień | ładunek [j.] | kontenerów | tony | jeden chwyt drona | co to jest |
|---|---|---|---|---|---|
| kontener | 16 × 8 × 8 | 1 | 7,5 | S | kontener gry (bez zmian) |
| moduł | 32,25 × 16,25 | 4 | 30 | L | ładunek naczepy ciągnika (bez zmian) |
| **sekcja** | 64,75 × 32,75 | 16 | 120 | 2 × Capital | nowa: duża standardowa naczepa / ładownia |

- **Naczepa** (istnieje w demie ciągników): rama z dyszlem 36 × 18,2 j. na jeden moduł, 30 t, rozstaw przegubów 46 j.
- **Sekcja w ramie** (nowa): obrys 68 × 36 j., wysokość 10 j., sprzęgi na osi na obu końcach. Rozstaw sekcji spiętych na sztywno 72 j., na dyszlu z przegubem 80 j. (ogranicznik zgięcia 35°).
- **Gniazdo w kadłubie** (nowe): otwór 72 × 40 j. (2 j. luzu z każdej strony), głębokość 10 j.; kadłub musi mieć co najmniej 56 j. szerokości i 132 j. długości.
- **Odmiany nośnika** — te same cztery rodziny na każdym stopniu: skrzynia (sztuki, podzespoły; pasy hazmat dla amunicji i prętów), zbiornik (gazy, ciecze), zasobnik (ruda, urobek, złom, lód) i **platforma** (nowa rodzina: kręgi blachy, belki, płyty kadłuba). Nośnik zmienia wygląd i sposób przeładunku, nie tony.
- **Największa sztuka na platformie**: 15 × 7 j. (kontener), 31 × 15 j. (moduł), 63 × 31 j. (sekcja).
- **Sekcja narzędziowa: kruszarka** — ten sam obrys, sprzęg i gniazdo co sekcja ładunkowa; sama nie wozi ładunku, podaje urobek do sekcji-zasobnika za sobą (1 t/s — liczba robocza, do uzgodnienia z wydobyciem).
- **Ciągnik sekcyjny** („większy truck”, nowy): 52 × 34 j., ciągnie 1–3 sekcje; z trzema ma 292 j. i 360 t.

### Skąd 7,5 t i 120 t

Liczby nie są nowe — wynikają z tego, co już jest w grze:

| liczba | zgadza się z |
|---|---|
| 7,5 t na kontener | naczepa 30 t / 4 kontenery (`TRUCK_TRAILER_TONNES`); prom klasy `van` 60 t / 8 slotów pokładu |
| 30 t (moduł) | naczepa z dema ciągników; 2 naczepy = klasa `van` (60 t) |
| 120 t (sekcja) | jedna wyprawa górnicza ruchu v2 (`miningYieldUnits` 120); 4 naczepy ciągnika szosowego |
| 360 t (3 sekcje) | statek z dema rudy huty (360 t); klasa `bulk` 380 t z resztą 20 t |
| 900 t | klasa `heavy` = 7 sekcji + 2 moduły, bez reszty |
| 2400 t | klasa `mega` = 20 sekcji, bez reszty |

Obrys sekcji (4 × 4 kontenery) też już istnieje: to moduł ładowni wagonu megafrachtowca (`cargoBays.js`).

### Zestawy

| zestaw | długość [j.] | tony | odpowiada |
|---|---|---|---|
| lekki + 2 naczepy | 112 | 60 | prom, klasa `van` |
| szosowy + 4 naczepy | 213 | 120 | 1 sekcja |
| ciężki + 5 naczep | 272 | 150 | kontenerowiec (160 t) |
| sekcyjny + 3 sekcje | 292 | 360 | frachtowiec klasy `bulk` (380 t) |
| belter + 1 sekcja na sprzęgu | 193 | 120 | jedna wyprawa górnicza |
| kombajn + kruszarka + 2 sekcje | 490 | 240 | dwie wyprawy |

## 2. Co dziś do siebie nie pasuje

1. **Huta jest narysowana ok. 6 × większa niż kontener gry.** Ciężarówka w dzielnicy huty ma 431 × 112 j. (kontenerowiec ma 299 j., zestaw z jedną naczepą 66–88 j.). Krąg blachy ma 120 j., a na sekcję standardu wchodzi sztuka do 63 × 31 j. Ładownia statku w demie rudy ma 468 × 252 j. dla 360 t; te same 360 t w standardzie to 3 sekcje, czyli 6% tego pola. Ziarno rudy ma 6 j. i 1/128 t; przy ziarnie 1 j. objętość kontenera (1024 j.³) daje 8 t, czyli tyle, ile mówi standard. To jedna i ta sama różnica skali we wszystkich trzech miejscach.
2. **Ten sam rysunek kontenera oznacza dziś różne masy:** 2 t (`CARGO_TONNES_DEFAULT`: demo ładowni, kreator kadłubów, drony roju), 7,5 t (naczepa, prom), 8,9 t (kontenerowiec: 160 t / 18 slotów), 13,6 t (frachtowiec dalekiego zasięgu), 1,6 t (ciężki frachtowiec: 900 t / 576 kontenerów widoku), 5 t (megafrachtowiec), 0,33 t (luk Atlasa: 400 t / 1200 kontenerów). W grze kontener jest „widokiem liczby”, więc nic się nie psuje, ale standard potrzebuje jednej wartości.
3. **Duże statki wiozą mało jak na swój rozmiar.** Ciężki frachtowiec (1800 j.) ma 900 t, czyli 7,5 sekcji, a jego ładownia 657 × 349 j. mieści 72 sekcje w jednej warstwie. Atlas ma 400 t (3 sekcje + 1 moduł + 1 kontener), a luk 346 × 275 j. mieści 24 sekcje. Megafrachtowiec: 20 sekcji przy miejscu na 165.
4. **Belter jest za wąski na gniazdo** (sylwetka 121 × 42 j., gniazdo wymaga 56 j.): może tylko ciągnąć sekcję. Kombajn (346 × 118 j.) mieści gniazdo.
5. **Stal i przewód jadą dziś w zsypie** (wzór „sztaby” i „kręgi” w `cargoContainers.js`), stopy metali w zwykłym kontenerze. Według ustaleń o hucie to materiał w kręgach i belkach, więc powinien jechać na platformie.
6. **Dwie klasy ruchu nie dzielą się równo:** `hauler` 160 t = 1 sekcja + 1 moduł + 1 kontener + 2,5 t; `bulk` 380 t = 3 sekcje + 2 kontenery + 5 t.

## 3. Co się zmieni w istniejących demach i danych (po akceptacji)

W etapie 1 nic nie zostało zmienione. Lista zmian, które wynikają ze standardu:

| miejsce | zmiana | kiedy |
|---|---|---|
| `src/data/spaceTrucks.js`, wygląd ciągników i naczep | nowa rodzina ładunku „platforma” (kręgi, belki); przydział towaru przez `cargoCarrierFor`; czwarty ciągnik „sekcyjny”; wygląd od nowa (ocena w § 4) | element 2 |
| `src/data/cargoBays.js` (`CARGO_TONNES_DEFAULT`), kreator kadłubów (`HD_CARGO.tonnes`), drony (`SWARM_TONNES_PER_STANDARD`) | 2 → 7,5 t na kontener; „Ładowność” presetów frachtowców w kreatorze rośnie 3,75 × | element 2, po decyzji S1 |
| `src/data/cargoContainers.js`, kontenery 3D | czwarta rodzina „platforma” w grze | przy wpięciu |
| dzielnica huty i jej dema (sesja produkcji) | skala wyrobów i ciężarówek; stanowisko rudy przyjmuje sekcję-zasobnik | po decyzji S2 |
| zestaw wspólny dzielnic (sesja produkcji) | zatoki `truckBay` pod zestawy standardu | element 6 |
| ruch v2 (`VAN_CLASSES`) | bez zmian; ewentualnie później `hauler` 160 → 150 t i `bulk` 380 → 360 t, tylko przez bramkę bilansu | nie teraz |

## 4. Poprzeczka i kolejność elementów

Poprzeczka (słowa użytkownika, 2026-11-16): „wszystko robimy od nowa — production ready”, „oceniamy i staramy się robić AAA”, „cokolwiek nie robimy, chcemy mieć dopieszczony output — powoli, ale dokładnie”. Wniosek z huty: jeden element naraz, własne demo, prawdziwa symulacja zamiast udawania ruchu, ocena użytkownika przed następnym elementem. Tymczasowy wygląd wolno zostawić tylko jawnie i z zaplanowaną turą; ruch, fizyka i czytelność z kamery gry mają być docelowe od razu. Kod pisany według zasad żelaznych (`AGENTS.md`), żeby wpięcie nie oznaczało pisania od nowa.

Transport dzieli się więc na elementy, każdy doprowadzany do poziomu „jest na czym zawiesić oko” (feel, fizyka, wygląd), zanim ruszy następny:

1. **Standard i plansza** (ten element): dane, test, plansza, decyzje.
2. **Naczepa i sekcja ze sprzęgiem, z bliska:** wygląd docelowy ramy, nośników (w tym platformy) i sprzęgu; sprzęganie i rozprzęganie jako widoczny mechanizm (zaczep, rygle), nie przeskok.
3. **Ciągnik w ruchu:** zestaw z masą — rozpędzanie i hamowanie zależne od ładunku, praca sprzęgu, manewry (cofanie pod rampę), dysze manewrowe, nowy wygląd strugi.
4. **Załadunek modułu i sekcji:** ładunek jako ciała w ruchu (rampa, suwnica albo drony), bilans bez znikania.
5. **Sekcja przy statku:** gniazdo i sprzęg na kombajnie i belterze, kruszarka, odstawianie pełnej sekcji przy hucie i branie pustej (styk ze stanowiskiem rudy).
6. **Ruch między dzielnicami:** jeden mechanizm z deklaracji zatok (`truckBay`: towar, kierunek) — zlecenia, trasy poboczem drogi, bilans masy. Potem pociągi.
7. **Dalekie zestawy:** statek jako ciągnik + sekcje (jeden sztywny kadłub, rozczepiany w porcie), dopiero potem wpięcie w ruch v2.

Głębia kosztuje: element w rundach „budowa → niezależny krytyk obrazu → poprawki dużych wad” to praca wieloagentowa, według sesji produkcji ok. 10 punktów tygodniowego limitu na rundę. O każdej takiej rundzie decyduje użytkownik.

### Ocena tego, co już jest, względem poprzeczki

Demo ciągników (`dema/ciagniki.html`), obejrzane na świeżych kadrach `node scripts/webgpu/ciagniki-demo.mjs --out .tmp/ciagniki/ocena`:

| część | ocena | co dalej |
|---|---|---|
| Kinematyka naczep (`spaceTruckTrain.js`) | **zostaje** jako geometria: krzywa pościgu, ogranicznik zgięcia, wynik niezależny od kroku fizyki, bez alokacji, testy | to tor, nie fizyka: zestaw nie ma masy, nie hamuje, sprzęg nie pracuje, nie ma cofania ani sprzęgania — dynamika powstaje w elemencie 3 na tej podstawie |
| Partia TSL (`spaceTrucks3D.js`) | **zostaje**: dwa rysunki na wszystkie zestawy, atlas z normalnymi i maskami farby, daleki zoom; bez Core3D i bez importów gry | rozszerzenie o nowe części po elemencie 2 |
| Dane (`spaceTrucks.js`): moduł 2 × 2, 30 t, trzy ciągniki | **zostają** | dochodzi platforma i ciągnik sekcyjny |
| Wygląd ciągników i naczep (malarz sprite'ów) | **poniżej poprzeczki**: sylwetka i malowania czytelne, ale płaskie, czyste wypełnienia bez materiału (zużycie, przewody, śruby, głębia między częściami); z bliska wygląda jak ikona (kadr `05-zoom-3.2`), obok statków gry to inny styl (kadr `09-skala`) | od nowa w elemencie 2; sposób do wyboru po próbie: bogatszy malarz albo model 3D wypiekany do sprite'a |
| Strugi silników i światła | **poniżej poprzeczki**: proste addytywne plamy i smugi; użytkownik ocenił żar i plazmę w grze jako słabe | nowy wygląd w elemencie 3, nie wzorowany na strugach gry |
| Scena i ruch | **poniżej poprzeczki**: zestawy jadą po pętli w pustce ze stałą prędkością (kadr `08-luki-c`); nie ma drogi, zatoki, rampy ani ładunku w ruchu | każdy element dostaje własną scenę przy ringu |
| Czytelność z daleka | **niesprawdzona tam, gdzie trzeba**: przy zoomie 0,1 zestaw to kilka pikseli ze światłami (kadr `02-zoom-0.1`), ale na tle pustki, nie drogi ringu o szerokości 2600 j. | sprawdzenie w scenie ringu w elemencie 3 |

Plansza standardu — ocena własna:

- Liczby i układ są docelowe (dane z testem).
- Bryły proponowane (sekcja w ramie, nośniki sekcji, platforma, kruszarka, ciągnik sekcyjny) to **rysunek techniczny na kanwie 2D, nie wygląd docelowy i nie kod gry**. Ich wygląd docelowy ma zaplanowaną turę: elementy 2 i 5.
- Na planszy nie ma ruchu ani fizyki — to plansza wymiarów.

## 5. Decyzje dla użytkownika

| # | decyzja | rekomendacja | dlaczego |
|---|---|---|---|
| S1 | Wymiary i tony: kontener 7,5 t, sekcja 2 × 2 moduły (65 × 33 j., w ramie 68 × 36 j.), 120 t | tak | liczby już zgadzają się z naczepą, promem, wyprawą górniczą, statkiem rudy i klasami `heavy` / `mega`; sekcja jest tej samej szerokości co belter i mieści się w kombajnie. Inne możliwości: sekcja dłuższa (130 × 33 j., 240 t) albo dwie warstwy (ten sam obrys, 240 t) |
| S2 | Skala huty: (a) huta przechodzi na standard — wyrób pakowany na sekcje i moduły, krąg do ø 31 j., ciężarówki z dema ciągników; maszyny (piec, walcownia) mogą zostać duże; (b) huta zostaje w swojej skali i dostaje własne, 6 × większe pojazdy | (a) | (b) oznacza dwa niezgodne standardy i ciężarówkę dłuższą od kontenerowca, czyli to, co przy megafrachtowcu było „za duże” |
| S3 | Sekcja przy statku: w kadłubie, ciągnięta czy obie | obie | gniazdo dla kadłubów szerszych niż 56 j. (kombajn), sprzęg dla mniejszych (belter); to ta sama sekcja |
| S4 | Ciężarówki tylko ring i pobliskie bazy (Księżyc), bez eksportu między planetami | tak | tysiące małych jednostek zapchałyby symulację ruchu; między planetami lecą statki z tymi samymi sekcjami |
| S5 | Duże zestawy: sztywne czy przegubowe | sztywne | zestaw statku to jedna bryła w fizyce, kolizjach i warpie, rozczepiana w porcie; przeguby zostają dla zestawów drogowych, gdzie są tylko obrazem |
| S6 | Odczepianie w przestrzeni | tylko w wyznaczonych miejscach (stanowisko rudy, plac sekcji, kotwicowisko pola górniczego) | sekcja porzucona gdziekolwiek wymaga własnego bytu w świecie, w ruchu v2 i w zapisie; do rozważenia później |
| S7 | Pociągi na ringu | po ciężarówkach; pociąg jako skład tych samych sekcji na kratownicy pod drogą | jeden standard, dwa nośniki; nie blokuje elementów 2–5 |
| S8 | Jedna skala ciężarówek we wszystkich dzielnicach | tak, zestawy z dema ciągników (66–292 j.) | wynika z S2 (a); dziś huta ma 431 j., demo ciągników 80 j. |
| S9 | Ciągnik sekcyjny jako czwarty ciągnik | tak | to „większy truck” z rozmowy: 3 sekcje = ładunek frachtowca klasy `bulk` |
| S10 | Tony w starych danych: 2 → 7,5 t na kontener w demie ładowni i kreatorze | tak, w elemencie 2 | jedna wartość w całym projekcie; ruch v2 bez zmian |
| S11 | Wygląd ciągników i naczep od nowa (ocena w § 4) | tak, jako element 2; sposób (bogatszy malarz albo model 3D wypiekany do sprite'a) po krótkiej próbie obu | dzisiejszy styl z bliska wygląda jak ikona i odstaje od statków gry |
| S12 | Rundy z niezależnym krytykiem obrazu (praca wieloagentowa, ok. 10 punktów tygodniowego limitu na rundę) | tak dla elementów 2 i 3, po jednej rundzie; decyzja przy każdym elemencie | tak powstała ruda huty, którą użytkownik ocenił „to jest to” |

## 6. Styk z sesją produkcji (huta)

Do uzgodnienia po decyzjach S1 i S2 — pliki huty należą do sesji produkcji:

1. **Pakowanie wyrobu:** blacha w kręgach i belki na platformie, tlen w zbiorniku, żużel i granulat w zasobniku, ceramika w skrzyni. Jednostką wyjazdu z huty jest moduł (naczepa, 30 t) albo sekcja (120 t). Największa sztuka: 31 × 15 j. na module, 63 × 31 j. na sekcji.
2. **Stanowisko rudy:** przyjmuje sekcję-zasobnik (obrys 68 × 36 j., wsad 64,75 × 32,75 j., 120 t). Statek z dema rudy (360 t) to trzy sekcje. Pełna sekcja zostaje przy stanowisku, kopacz bierze pustą.

## 7. Jak sprawdzić

- `node --test tests/cargoStandard.test.mjs` — zgodność standardu z kontenerem gry, modułem naczepy, chwytami dronów, klasami ruchu v2 i wyprawą górniczą.
- Plansza: `/dema/standard-ladunku.html` (kółko — zoom, przeciągnięcie — przesuw, klawisze 0–5 — widoki).
- Zrzuty: `node scripts/webgpu/standard-ladunku-demo.mjs --out .tmp/standard-ladunku` (własny Vite 5461; raport z błędami konsoli — ma być 0).
