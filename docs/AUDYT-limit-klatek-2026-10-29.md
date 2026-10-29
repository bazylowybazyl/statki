# Limit klatek — pomiary i decyzje (2026-10-29)

Opcja „Limit klatek” w Opcjach grafiki (Bez limitu / 240 / 144 / 120 / 60, domyślnie bez limitu). Powód: przy
5120 × 1440 i 240 kl/s RTX 5080 pracuje na pełnych obrotach i hałasuje (w nocy domownik wyłączył komputer
przyciskiem). Stan i zasady: reguła `opcje-grafiki`, § „Limit klatek”; kod: `src/render/frameLimiter.js`, blok
„OPCJE GRAFIKI” i `loop()` w `index.html`, `MenuBackdrop3D.setFrameLimit`, op `frameLimit` workera.

## Jak mierzone

`node scripts/webgpu/limit-klatek-gra.mjs` — tryb worker (jak u gracza), 5120 × 1440, okna 6–8 s po kolei
(`GraphicsQuality.apply` bez zapisu), nvidia-smi co 250 ms, strażnik ciszy (cudze harnessy) i wolnej karty.

- Z TAKTEM (domyślnie): headless bez flag `--disable-frame-rate-limit` / `--disable-gpu-vsync` — rAF ~240 Hz
  (częstotliwość monitora, znaczniki ±0,1 ms), czyli jak gra z VSync, bez okna na pulpicie (użytkownik pracował przy
  komputerze). Sprawdzone: przez 50 s limit 30 trzyma co 8. klatkę przy 240 wywołaniach rAF/s.
- BEZ VSYNC: `--takt 0 --bezVsync 1` — headless bez taktu (flagi jak w Electronie z VSync wył.) i atrapa mostu
  Electrona (`window.hullfallApp.vsync = false`).

Okno z prawdziwym vsync (`--okno 1`) i prawdziwy Electron bez VSync — nie mierzone (do zrobienia przy wolnym komputerze).

## Wyniki: VSync (takt 240 Hz)

Gra swobodna (start, scena lekka — bez limitu karta ma zapas):

| Limit | kl/s | Tryb | Odstępy klatek (vsynce) | Złożenia obrazu (vsynce) | GPU | Moc |
|---|---|---|---|---|---|---|
| bez limitu | 240,1 | — | 1 × 1924 | 1 × 1917, 2 × 3 | 48% | 163 W |
| 240 | 240,1 | każda | 1 × 1921 | 1 × 1912, 2 × 4 | 48% | 164 W |
| 144 | 144,1 | akumulator | 1 × 385, 2 × 769 | 1 × 384, 2 × 768 | 33% | 126 W |
| 120 | 120,0 | co 2. | 2 × 962 | 2 × 961 | 28,5% | 116 W |
| 60 | 59,9 | co 4. | 4 × 479, 5 × 1 | 4 × 477, 3/5 × 3 | 22% | 84 W |

Powtórzenie bez limitu / 120 w tym samym przebiegu: 48,1% / 28,3%. Wiek obrazu (pacer) 2.

Menu (tło Ziemi z ringiem, rysuje worker): bez limitu 239,9 kl/s, 63%, 229 W → 120: 119,9 kl/s, 36%, 149 W →
60: 60,0 kl/s, 21%, 101 W.

Bitwa flot 50 / 20 / 10 / 3 na stronę (166 okrętów, zoom 0,45), limity na przemian (bitwa się zagęszcza):

| Okno | kl/s | GPU | Moc |
|---|---|---|---|
| bez limitu | 239,1 | 67,5% | 199 W |
| 120 | 118,7 | 34,8% | 132 W |
| bez limitu | 238,4 | 74,3% | 208 W |
| 120 | 119,9 | 48,4% | 161 W |
| 60 | 60,0 | 25% | 104 W |
| bez limitu | 235,2 | 84,7% | 236 W |

Tryb `off` (render na wątku gry, `--tryb off`): gra 240,0 kl/s, 52%, 173 W → 120: 119,9 kl/s, odstępy 2 × 721,
28,6%, 119 W → 60: 60,0 kl/s, 22,4%, 85 W; menu 240 → 120: 65% → 37,6%, 232 → 154 W.

Limit 120 przy 240 Hz: zajętość karty ~55–65% wartości bez limitu, moc −45…−80 W. Dokładnie połowy nie ma, bo część
pracy nie zależy od liczby klatek (składanie obrazu w Chrome, spoczynek karty ~6%), a czas GPU klatki workera przy
mniejszej liczbie klatek lekko rośnie (efekty z dłuższym krokiem).

## Wyniki: bez VSync (atrapa Electrona, dawny budzik — kolejka)

Pierwszy budzik (sen setTimeout do chwili należnej − margines z 90. percentyla spóźnień, reszta kolejką
MessageChannel); po przeglądzie (też 2026-10-29) domyślnie wątek budzika — § „Budzik bez VSync”.

| Limit | kl/s | GPU | Moc | Budzik |
|---|---|---|---|---|
| bez limitu | 368 | 58% | 188 W | — |
| 240 | 235,8 | 49% | 161 W | tylko kolejka |
| 144 | 143,5 | 33% | 124 W | tylko kolejka |
| 120 | 114–115 | 27–28% | 111 W | sny ~100/s, spóźnienia p50 0,2 / p90 5,6–6,9 / maks. 12–14 ms |
| 60 | 59,9 | 22% | 81 W | sny 60/s |

Menu (rAF workera): 120 → 115–117 kl/s.

## Co wyszło po drodze

1. Chromium BEZ TAKTU (`--disable-frame-rate-limit`, czyli Electron z VSync wył. i zwykły headless narzędzi) po
   wywołaniu rAF bez zmiany obrazu odkłada następny o ~30 ms. Na pustej stronie z kanwą 2D (rysunek co 10. klatkę):
   36 wywołań/s od pierwszych sekund; w grze pierwsze ~15 s kręciło ~4500 wywołań/s (złożenia bitmap workera dawały
   zmiany), potem 64–97/s i ~32 kl/s przy limicie 120. Sen `setTimeout` → rAF: ~32 kl/s przy każdym limicie;
   budzik + rAF na końcu klatki: ~64 kl/s. Z taktem (headless bez tych flag) tego nie ma: pusta strona 235–240
   wywołań/s przez 30 s. Stąd bez VSync pętla gry w ogóle nie używa rAF (budzik `setTimeout` + kolejka MessageChannel).
2. `setTimeout` w stronie gry: zwykle 0,2 ms spóźnienia, ale w ~10% wywołań 6–15 ms (osobna strona testowa:
   `setTimeout(8)` → 8,5–9 ms). Margines snu z 90. percentyla spóźnień (1–6 ms); przy limitach 120–240 czekanie jest
   krótsze niż margines — idzie kolejką MessageChannel (~170–240 tys. zadań/s: rdzeń CPU zajęty, jak bez limitu).
   Pierwsza wersja (margines „szybko w górę”) trzymała pętlę cały czas w kolejce; ten sam znacznik czasu przy szybkich
   wywołaniach (rozdzielczość 5 µs) liczony jako „zegar stoi” wymuszał klatkę — limit przekraczany o 3–7%.
3. Okres ekranu z MINIMUM odstępów zaniżał się przy drganiach znaczników (247 Hz przy 241 Hz) i limit 120 wypadał na
   granicy tolerancji wielokrotności (stosunek 2,06) — mediana skupiska najkrótszych odstępów trzyma 240,1 Hz.
4. Złożenie obrazu workera (`rwHost.present()`) w KAŻDYM wywołaniu rAF zamiast tylko w klatkach narysowanych: ten sam
   równy takt (każda strona dokładnie N vsynców), mniejsze opóźnienie (symulacja `tests/framePacer.test.mjs`: limit
   120 — 3 vsynce zamiast 4, limit 60 — 3 zamiast 4–8 i jedna przeskoczona strona).
5. Przebiegi z 12:39–12:50 (dwa) nakładały się na cudze pomiary GPU (`gpu-pas-gra.mjs`, `gaz-kosmos-gra.mjs` innych
   sesji) — odrzucone; narzędzie ma od tego strażnika ciszy i oznacza okna, w których ruszył cudzy harness (`obce`).

## Budzik bez VSync — kolejka, sen strony, wątek budzika (2026-10-29)

Przegląd: dawny budzik przy limitach 120–240 dopinał czekanie kolejką MessageChannel — rdzeń CPU zajęty i
~170–240 tys. MessageEvent/s (alokacje w gorącej pętli, praca GC), a opcja ma dawać ciszę i mniej prądu. Budzik
przeszedł do `src/render/frameWake.js` z trzema strategiami (A/B: `?budzik=`, `FrameLimiter.wake.setStrategy`):
`kolejka` (dawna), `sen` (setTimeout strony do chwili należnej, w górę do pełnej ms, bez dopinania) i `worker` (wątek
budzika: sen setTimeout do chwili należnej − 1 ms, końcówka pętlą na wątku budzika, jeden komunikat na klatkę).
Klatka zawsze z zadania wiadomości — setTimeout wołany w klatce nie jest zagnieżdżony (próg 4 ms).

Pomiar: `node scripts/webgpu/limit-klatek-gra.mjs --takt 0 --bezVsync 1 --menuLimity brak --limity 120,240,60
--budziki kolejka,sen,worker,worker:0 --okres 6` — atrapa Electrona bez VSync, tryb worker, 5120 × 1440, gra swobodna,
okna 6 s po kolei w jednym przebiegu (bez cudzych harnessów). CPU z CDP `Performance.getMetrics` (% rdzenia): wątek
strony (ThreadTime) i cały proces renderera (ProcessTime — z workerem renderu i wątkiem budzika). `worker:0` — wątek
budzika bez końcówki pętlą (sen do chwili należnej w dół do pełnej ms, reszta < 1 ms pętlą).

| Limit | Budzik | kl/s | Odstępy klatek p1 / p50 / p90 / p99 / maks. [ms] | Wątek strony | Proces | Zadania kolejki/s | Dopięcia na klatkę | Pętla wątku budzika [ms/klatkę] |
|---|---|---|---|---|---|---|---|---|
| 120 | kolejka | 120,0 | 8,23 / 8,33 / 8,36 / 8,44 / 8,63 | 27,7% | 187% | 33 910 | 282 | — |
| 120 | sen | 120,0 | 6,99 / 8,49 / 9,03 / 9,96 / 10,5 | 12,8% | 90% | 120 | 0 | — |
| 120 | **worker** | 120,0 | 8,13 / 8,33 / 8,35 / 8,55 / 9,93 | 12,0% | 94% | 0 | 0 | 0,97 |
| 120 | worker:0 | 119,5 | 7,11 / 8,34 / 8,88 / 9,14 / 35,4 | 12,1% | 83% | 0 | 0 | 0,18 |
| 240 | kolejka | 238,9 | 3,99 / 4,17 / 4,18 / 4,26 / 16,9 | 89,5% | 172% | 171 878 | 718 | — |
| 240 | sen | 238,4 | 2,50 / 4,01 / 5,01 / 5,80 / 30,1 | 21,8% | 104% | 238 | 0 | — |
| 240 | **worker** | 239,8 | 3,52 / 4,17 / 4,25 / 4,81 / 9,33 | 22,5% | 124% | 0 | 0 | 0,97 |
| 240 | worker:0 | 239,4 | 2,95 / 4,17 / 4,78 / 5,21 / 18,8 | 21,5% | 110% | 0 | 0 | 0,18 |
| 60 | kolejka | 60,0 | 16,60 / 16,67 / 16,70 / 16,73 / 16,77 | 15,1% | 81% | 22 017 | 366 | — |
| 60 | sen | 60,1 | 14,54 / 16,57 / 17,54 / 18,46 / 33,5 | 8,3% | 75% | 60 | 0 | — |
| 60 | **worker** | 59,9 | 13,37 / 16,67 / 16,77 / 19,92 / 48,2 | 9,2% | 84% | 0 | 0 | 0,79 |
| 60 | worker:0 | 59,9 | 15,25 / 16,60 / 17,51 / 18,03 / 30,7 | 7,5% | 78% | 0 | 0 | 0,11 |

Karta bez różnic między strategiami (120: 32–37%, 240: 54–55%, 60: 20–21%). Spóźnienia budzeń względem chwili
należnej (p50 / p90): kolejka 0,01 / 0,07 ms, worker 0,04–0,05 / 0,08–0,1 ms, sen 1,0 / 1,5–1,8 ms (pełne ms budzika
w górę + spóźnienie setTimeout strony), worker:0 0,1–0,4 / 0,8–1,1 ms (spóźnienie setTimeout wątku budzika).

Wnioski:

1. Wybór: `worker` (domyślny). Mediana i 90. percentyl odstępów jak przy dopinaniu kolejką (mediana = interwał
   limitu, 90. percentyl +0,02–0,1 ms), ale ogon gorszy: 99. percentyl przy 120 / 240 / 60 — 8,55 / 4,81 / 19,92 ms
   wobec 8,44 / 4,26 / 16,73 ms kolejki, maks. przy 60 — 48,2 wobec 16,77 ms (pkt 4). Wątek strony bez kręcenia: 27,7 → 12,0% rdzenia przy 120, 89,5 → 22,5% przy 240, zadania kolejki 34–172 tys./s
   → 0, proces renderera −93 p.p. przy 120 i −47 p.p. przy 240. Koszt: pętla wątku budzika ~1 ms na klatkę (12% rdzenia
   przy 120, 23% przy 240, 5% przy 60) — na osobnym wątku, bez zadań i alokacji.
2. `sen` jest najtańszy (proces 90% przy 120), ale odstępy klatek rozrzucone o ±1–1,5 ms (p1–p99 7,0–10,0 ms przy
   120, 2,5–5,8 ms przy 240) — budzik strony chodzi pełnymi ms i spóźnia się o ułamek ms. Zostaje zapasem: błąd wątku
   budzika albo trzy strażniki z rzędu (brak odpowiedzi w 100 ms po chwili należnej) — `sen` do końca sesji.
3. `worker:0` (bez końcówki pętlą): pętla 0,18 ms na klatkę, takt jak `sen` — końcówka 1 ms jest tym, co daje równy
   takt; spóźnienia setTimeout wątku budzika (p90 ~1 ms) mieszczą się w niej.
4. Pojedyncze długie odstępy (20–48 ms przy 60, do 30 ms przy 240) we wszystkich strategiach poza kolejką: komunikat
   budzika i budzik strony czekają, gdy wątek strony robi coś innego. Kolejka trzyma wątek zajęty i w tym przebiegu
   ogona nie miała — przyczyna nie sprawdzona (podejrzenie: praca w czasie bezczynności wątku, np. GC). Okna 6 s —
   ogony to pojedyncze klatki; sprawdzić w prawdziwym Electronie bez VSync.
5. Dawny budzik w tym przebiegu miał przy 120 margines 1 ms (spóźnienia setTimeout strony małe: p90 0,07 ms), więc
   kolejka dopinała ~1 ms na klatkę; w pierwszym pomiarze (wyżej) spóźnienia budzika strony miały p90 5,6–6,9 ms
   i margines 6 ms — wtedy kolejką szło całe czekanie. Koszt dawnego budzika zależał od chwili; wątek budzika — nie.

## Poprawki po przeglądzie (2026-10-29)

- Tło menu na stronie (tryb off) omija limit przy zegarze wirtualnym harnessu jak pętla gry: `FrameLimiter.bypass` —
  funkcję podaje strona (`harnessClockVirtual`, trzeci argument `setFrameLimit`); przy zegarze `frozen` co N-ta klatka
  zatrzymywała obraz tła (znacznik stoi, odstęp od ostatniej narysowanej 0).
- Zmiana rozmiaru okna w trybie off: handler `resize` czyści kanwę `#c` i kanwę Core3D, a klatka pominięta przez limit
  ich nie odrysowywała (miganie do N−1 vsynców przy przeciąganiu okna) — `frameLimitResized`: najbliższa klatka gry
  i tła menu bez limitu (`forceNext`), bez VSync zamówienie budzika przepada i klatka idzie w rAF tej aktualizacji
  obrazu. Tryb worker bez zmian (resize nie czyści kanw obrazu i nakładek).
- Rozdzielczość dynamiczna: budżet z celu, a przy niższym limicie — z limitu (`gfxDynamicBudgetFps`); cel 120 przy
  limicie 60 obniżał skalę do budżetu 8,3 ms, choć gra rysowała 60 kl/s.

## Poprawki po drugim przeglądzie (2026-10-29)

- Start wątku budzika: wątek powstawał przy pierwszym zamówieniu, więc pierwsza klatka z limitem czekała na start
  modułu (symulacja recenzenta: start 60 ms → odstęp 68 ms), a start dłuższy niż ~330 ms dawał trzy strażniki z rzędu
  i `sen` do końca sesji. Teraz `applyFrameLimit` tworzy wątek z góry przy limicie bez VSync (`prepare`), a wątek budzi
  klatki dopiero po sygnale gotowości (komunikat 0 na końcu modułu) — do niego budzik strony, bez strażników; brak
  gotowości przez 240 zamówień → `sen` z ostrzeżeniem (`tests/frameWake.test.mjs`: start 400 ms bez dziury w takcie).
- Czekanie ≈ 0 (klatka dłuższa niż interwał): każda klatka robiła rundę przez wątek budzika (przesył w obie strony
  ~0,1 ms). Czekanie krótsze niż `hopMs` (0,1 ms) idzie jednym skokiem kolejką strony. Próg 0,1 ms, nie 0,5 ms:
  limiter rysuje dopiero w chwili należnej (`waitMs` już odlicza jego próg 0,5 ms), więc skok przed nią musiałby dopinać
  kolejką strony do chwili należnej — dłuższe czekanie dopina wątek budzika, wątek gry zostaje wolny.
- Bez limitu albo z VSync wątek budzika jest zamykany (`release`); zamówienie u wątku przechodzi na budzik strony
  (pętla na nie czeka), handlery zamkniętego wątku są zdjęte (spóźniony komunikat starego wątku nie udaje gotowości).
- Narzędzia: `FrameLimiter.wake.lateMax` / `lateOver` (budzenia spóźnione > 2 ms) i `frameMax` (najdłuższa klatka strony
  — od budzenia do następnego zamówienia); `limit-klatek-gra.mjs --budziki …+bariera` — strażnik dwustopniowy
  (`tune.workerFence`): pierwszy stopień budzika strony w chwili należnej (pełne ms w górę), drugi 100 ms dalej.
