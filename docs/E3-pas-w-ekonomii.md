# E3 — pas w ekonomii: pola z danych pasa, uszczuplenie, wyrwy

Zadanie E3 z `docs/PLAN-ekonomia-rynki.md` (§ 3.3, § 4), 2026-10-21. Stan i zasady: reguła `.claude/rules/pas-asteroid.md`,
punkt „Pas w ekonomii”. Kod: `src/game/traffic/miningFields.js`; testy: `tests/miningFields.test.mjs`.

## Pomiar: symulacja przed i po

`SEED=<z> node scripts/symulacja-ruchu.mjs 240 1 4 60`. Bazę wydobycia (stary kod) policzono tym samym biegiem
na eksporcie HEAD: punkty postoju EXTRACT ocenione polem skał gry. „W skałach” oznacza gęstość skał PLAY w punkcie
≥ 1,1·10⁻⁶ j.⁻², czyli ok. ¼ rdzenia pola.

| ziarno | wyprawy | w skałach | urobek dowieziony [t] | dostawy | skuteczność | tick [ms] |
|---|---|---|---|---|---|---|
| 7 | 840 → 811 | 22,7% → 98,8% | 35 640 → 36 837 | 8274 → 8345 | 60,8% → 62,4% | 27,3 → 27,6 |
| 11 | 757 → 859 | 21,8% → 99,0% | 29 400 → 37 329 | 8327 → 8336 | 62,0% → 61,6% | 24,3 → 28,4 |
| 23 | 750 → 902 | 21,2% → 98,6% | 32 280 → 44 985 | 8165 → 8503 | 61,2% → 62,1% | 32,9 → 29,3 |

Tick mieści się w rozrzucie bazy (24–33 ms między ziarnami). Stacji na skraju jest 7 / 8 / 7 z 27 (baza 8 / 8 / 8).

Uszczuplenie po 4 h gry (×60): z pasa zeszło 52,6 / 54,6 / 63,7 tys. t rudy, powstało 144 / 166 / 195 wyrw,
w tym 97 / 94 / 97 pustych. Wyrwy skupiają się w 6–7 polach najbliżej stacji.

Urobek przed zmianą: Fe, Si, kryształ, U. Po zmianie dochodzą produkty uboczne ze składu miejsca: Cu, Ti, C, lód, Ni.
Wyprawy po kryształ przywożą ≥ 70% kryształu i szukają go dłużej. Przy pierwszej wersji (ładownia ściśle wg składu)
przywoziły 6 t kryształu na 120 t ładowni, więc dyspozytor słał ich 1062.

## Koszt pola skał w workerze ruchu

`AsteroidBeltField` jest czystą logiką (bez three i DOM). Koszty:
- konstruktor: ~2 ms;
- `familyPeaks`: ~33 ms;
- `typeSharesAt`: 2–6 µs na próbkę;
- tabela poszukiwań sektora pasa głównego (16 tys. j.): 5–12 ms;
- tabela sektora Kuipera (32 tys. j.): 6–12 ms.

Tabele liczą się leniwie. W symulacji 4 h powstaje 6–7 tabel, razem ok. 100 ms. Wstępnie policzona mapa gęstości
nie jest potrzebna.

## Zrzuty (`.tmp/webgpu/e3-wyrwy/`)

- `off/wyrwa-przed.png`, `off/wyrwa.png`, `off/wyrwa-blisko.png`: `node scripts/webgpu/asteroidy-gra.mjs --sceny wyrwa-przed,wyrwa,wyrwa-blisko`.
  - Skały PLAY w kole 9000 j.: 593 → 276, tyle samo w polu gry i w replice obrazu.
  - Model ruchu i pole gry zgadzają się co do skali AU, gęstości i rodziny.
  - Pipeline'y synchroniczne: 0, błędów brak.
- `worker/worker-przed.png`, `worker/worker-po.png`: render w workerze (tryb gracza), sonda w czasie rzeczywistym.
  Operacja `holes` dochodzi do repliki w workerze.

## Decyzje dla użytkownika

- **Wygląd wyrwy:**
  - koło 0,85 komórki rejestru (~7 tys. j.);
  - pełna głębokość do 0,6 brzegu, brzeg poszarpany szumem;
  - przerzedzone wszystkie pasma skał;
  - mgła, pył i cień pola zostają (gęstość `sampleMacro` bez zmian).

  Do wyboru: czy wyrwa ma też rozrzedzać mgłę i pył. Wymagałoby to przeliczenia cienia pól.
- **Tempo uszczuplania:** fizyczne (`depletionScale` 1), tona urobku = tona zasobu. Przy ×60 to ~55 tys. t
  i ~170 wyrw na 4 h, w polach przy stacjach.
- **Regeneracja:** brak (`regenPerHour` 0). Mechanizm jest gotowy: wyrwy płycieją i znikają.
