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

## Wyniki: bez VSync (atrapa Electrona)

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
