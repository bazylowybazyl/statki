# Omijanie budowli przez AI — pomiar (2026-10-28)

Zgłoszenie użytkownika: „W pierwszej misji supercapital wbija się w habitat w środku zamiast okrążyć budowlę, stara się
przez nie przejść — nie działa zbyt dobrze pathfinding”.

Stan i zasady: reguła `flota-ai`, „OMIJANIE BUDOWLI I TRASY”. Tu przyczyna i liczby.

## Przyczyna

- Budowle bazy piratów nie były przeszkodami lotu AI — ogranicznik i objazd pilota znały gracza, okręty i wraki.
  Piraci przelatują przez ciała swojej bazy (`site.passes`), więc herszt leciał przez habitat bez kolizji, a okręty
  Terra Novy w bańce gracza w budowle wjeżdżały.
- Ucieczka herszta (`storyNpcControl.flee`) ustawiała intencję lotu wprost (`setFlightArrive`), bez żadnego omijania.
  Zatoka herszta leży po drugiej stronie trzonu bazy niż wejście gracza, więc i atak, i ucieczka szły przez bęben.
- Samo dodanie budowli jako kapsuł do omijania lokalnego nie wystarcza. Pomosty to kilkukilometrowe ściany (poprzeczka
  T 8,4 km, trzon ~9 km przez habitat), a objazd jednej kapsuły prowadzi w następną — okręty stawały przed bazą.
  Dlatego trasy: graf widoczności wokół budowli (`src/ai/staticRoutes.js`).

## Pomiar

`node scripts/omijanie-budowli.mjs` (Node, prawdziwa geometria bazy, pilot gry `capitalArriveTo` co takt AI 20 Hz,
model lotu 120 Hz). `wBryle` — kroki 120 Hz ze środkiem okrętu w bryle trafień bazy. „Stoi” — prędkość spadła do 0
przed bazą i okręt nie doleciał w 180 s.

| Przelot | Bez budowli | Same kapsuły (`--trasy 0`) | Kapsuły + trasy |
|---|---|---|---|
| herszt: ucieczka 30 km w stronę habitatu, 0° / +25° / −25° | 78,2 s, wBryle 621 / 71 / 58 | stoi 21–24 km przed celem | 90,6 / 82,1 / 92,7 s, wBryle 0 |
| herszt: z końca trasy startu do gracza przy wylocie lejka | 31,6 s, wBryle 67 | stoi 3 km przed celem | 37,0 s, wBryle 0 |
| herszt: ze stanowiska w zatoce do gracza | 37,5 s, wBryle 120 | stoi 14 km przed celem | 57,8 s, wBryle 0 |
| superkapitał Terra Novy: wylot lejka → za bazę | 48,8 s, wBryle 2867 | stoi 17 km przed celem | 61,9 s, wBryle 0 |
| pancernik Terra Novy: to samo | 28,4 s, wBryle 1666 | stoi 17 km przed celem | 36,3 s, wBryle 0 |
| fregata Terra Novy: to samo | 13,1 s, wBryle 758 | stoi 16 km przed celem | 17,5 s, wBryle 0 |
| 12 okrętów z załogą: koniec trasy startu → gracz | 12 / 12 dolatuje, 3 przez bryły | 9 / 12 | 12 / 12, 0 przez bryły |

Najmniejszy luz środka okrętu od bryły z trasami: 132–274 j. ponad pół-szerokość korytarza okrętu. Końce tras startu
z doku (48 stanowisk) leżą poza strefami przeszkód.

Ucieczka przez prawdziwy `storyNpcControl.flee` (pilot co krok fizyki, test `tests/buildingAvoidance.test.mjs`):
herszt objeżdża północny koniec poprzeczki T, dolot 92,6 s, 0 kroków w bryłach.

Koszt: graf (60–66 węzłów, 266–299 krawędzi) z pierwszą trasą 0,5–0,7 ms — raz na zestaw budowli i klasę okrętu
(4 kubełki luzu w bazie); zapytanie z trasą 4–5 µs; cel widoczny wprost albo okręt daleko od bazy ~0,1 µs.

## W grze

`node scripts/webgpu/wodowanie-gra.mjs --czas 150` (misja 1, skok dev `?story=defences`, mózg bojowy piratów; herszt na
60%, potem na 30% punktów — ucieczka i skok): herszt wystartował z zatoki, walczył, uciekł i skoczył w warp w 93,7 s
czasu gry; 9 okrętów z załogą wystartowało. Licznik `wBryle` (środek okrętu w bryle stojącego kawałka bazy, próbki co
100 ms, poza trasą wylotu z doku): herszt 0, załoga 0 na 1507 próbkach. W ucieczce herszt obszedł bazę od strony zatoki
(1,5 km od stanowiska w 70 s, potem 6,3 km i skok) — kadr z 70 s: obok pomostów przy zatoce, nie w habitacie. Bez
błędów konsoli. Czasów klatek nie brano: w trakcie przebiegu na komputerze trwał mecz League of Legends (procesy sesji
ograniczone do rdzeni 4–7, priorytet Idle).

## Czego nie sprawdzono

- Porównania „przed / po” w grze — stan sprzed zmiany jest tylko w pomiarze Node (wyżej).
- Doki portów bez ringu i inne stacje nie są przeszkodami AI (doki mają własne kolizje — reguła `doki-portow`).
