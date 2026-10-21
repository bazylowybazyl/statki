# E3 — pas w ekonomii: pola z danych pasa, uszczuplenie, wyrwy

Zadanie E3 z `docs/PLAN-ekonomia-rynki.md` (§ 3.3, § 4), 2026-10-21. Stan i zasady: reguła `.claude/rules/pas-asteroid.md`,
punkt „Pas w ekonomii”. Kod: `src/game/traffic/miningFields.js`; testy: `tests/miningFields.test.mjs`.

## Pomiar: symulacja przed i po

`SEED=<z> node scripts/symulacja-ruchu.mjs 240 1 4 60`. Bazę wydobycia (stary kod) policzono tym samym biegiem
na eksporcie HEAD: punkty postoju EXTRACT ocenione polem skał gry. „W skałach” oznacza gęstość skał PLAY w punkcie
≥ 1,1·10⁻⁶ j.⁻², czyli ok. ¼ rdzenia pola.

Wersja domyślna: ładownia to sama chciana ruda (`minWanted` 1).

| ziarno | wyprawy | w skałach | urobek dowieziony [t] | dostawy | skuteczność |
|---|---|---|---|---|---|
| 7 | 840 → 804 | 22,7% → 98,6% | 35 640 → 33 960 | 8274 → 8304 | 60,8% → 60,4% |
| 11 | 757 → 808 | 21,8% → 98,5% | 29 400 → 37 440 | 8327 → 8282 | 62,0% → 63,1% |
| 23 | 750 → 827 | 21,2% → 98,4% | 32 280 → 40 920 | 8165 → 8487 | 61,2% → 61,7% |

Stacji na skraju: 7 / 7 / 7 z 27 (baza 8 / 8 / 8).

Uszczuplenie po 4 h gry (×60): z pasa zeszło 49,2 / 54,2 / 56,3 tys. t rudy. Powstało 140 / 149 / 170 wyrw, w tym
82 / 91 / 91 pustych. Wyrwy skupiają się w 6 polach najbliżej stacji.

**Bramka bilansu** (`scripts/bramka-bilansu.mjs` z gałęzi E4, przed: eksport HEAD, po: E3, przebiegi po kolei).

| ziarno | przechwyty | kolejka max (port) | tick [ms] |
|---|---|---|---|
| 7 | 40,4% → 40,8% | 6,01 (Westa) → 7,01 (Saturn) | 27,8 → 30,0 |
| 11 | 40,7% → 39,7% | 12,85 (Saturn) → 10,77 (Saturn) | 22,8 → 28,6 |
| 23 | 41,2% → 40,2% | 4,78 (Westa) → 5,64 (Saturn) | 32,4 → 28,8 |

Głód (35–36 pozycji, Merkury i Wenus po 240 min) i stocznie (5 stoczni po 240 min) są bez zmian.

Tick przy 5 sesjach na maszynie jest orientacyjny. Pomiar wprost (kopia kodu z licznikami czasu): funkcje E3 kosztują
0,05–0,12 ms na krok. Krok tych samych ziaren puszczonych po kolei to 29,0 → 29,6 ms i 32,0 → 32,3 ms.

**Urobek przy okazji** (`minWanted` 0,7: chciana ruda ≥ 70%, reszta ładowni wg składu miejsca) daje Cu, Ti, C, lód
i Ni bez popytu. Stacje mają z nich nadwyżki do wywiezienia, więc rośnie kolejka na redzie Saturna:
- ziarno 7: 5,59 → 8,02;
- ziarno 11: 12,85 → 16,3;
- ziarno 23: 4,44 → 12,58.

Wypraw z Saturna jest tyle samo (~205, sam uran). Przy czystej ładowni kolejka wraca do 5,64 / 10,77, dlatego
urobek przy okazji jest wyłączony do czasu receptur rud z widm (E4).

Wyprawy po kryształ (rzadka ruda) szukają dłużej, zamiast wozić skałę płonną. W pierwszej wersji (ładownia ściśle
wg składu) przywoziły 6 t kryształu na 120 t ładowni, więc dyspozytor słał ich 1062.

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
- **Tempo uszczuplania:** fizyczne (`depletionScale` 1), tona urobku = tona zasobu. Przy ×60 to ~53 tys. t
  i ~150 wyrw na 4 h, w polach przy stacjach.
- **Regeneracja:** brak (`regenPerHour` 0). Mechanizm jest gotowy: wyrwy płycieją i znikają.
- **Urobek przy okazji:** wyłączony (`minWanted` 1). Do decyzji przy recepturach węgla, niklu i platyny (E4).
