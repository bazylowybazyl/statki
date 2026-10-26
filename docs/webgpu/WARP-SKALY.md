# Skały pasa w skoku: bryły, ślad światła, deflektor (DECYZJE-2 S1–S4, 2026-10-26)

Stan i zasady są w regule `pas-asteroid` (punkt „Pas w skoku: skały w przestrzeni widocznej”). Tu: skąd to się wzięło,
liczby i co sprawdzić w grze.

## Zgłoszenia i decyzje

- 2026-10-19 — „a co z resztą świata? asteroidy” → pas w skoku jako smugi skał w przestrzeni widocznej warpa
  (`warpDebris.js`, `docs/webgpu/DEMO-WARP-PED.md` § „Reszta świata w skoku”).
- 2026-10-23 — „słabo się rozciągają” → ogon wydłużony 3,4× (wygląd „ślad światła”, skała rozciągnięta w materiale).
- 2026-10-26 (test nowego warpa) — „zwykłe rozciągnięcia”; analiza (raport skał, opcje A–D): skała czytała się jak
  rozciągnięta pałka (najrzadsza siatka LOD rozciągnięta ~12×), płynęła równo jak paralaksa 2D (jedno pudło liczone dla
  najgłębszej warstwy — płytkie skały w kadrze w ~14%), w stałym tempie 14 tys. j/s (zwolnienia przy planecie nie było
  widać), a pas był płaski (gęstość 0,35 od 36 do 40,5 AU, luk Kirkwooda nie widać).
- DECYZJE-2 (odpowiedź użytkownika: „trzeba dodać odpychanie skał — skojarz tutaj »tarczę« grawitacyjną ze Star Trek”):
  S1 — opcja A (trzy pasma głębi, przepływ z prawdziwej prędkości, krótkie rozmycie bryły, LOD z rozmiaru bryły,
  hierarchia warstw W0); S2 — opcja C (bryła + osobny ślad światła, wygląd „ślad światła” zostaje domyślny, dawne
  „ślad” / „klin” do A/B); S3 — deflektor nawigacyjny (opływ wokół dziobu, ujawnienie pola refrakcją albo cienkim łukiem
  HDR, bez świecących okręgów i obrysów, bez zasłaniania statku, tylko warp gracza); S4 — pas jako zdarzenie trasy
  (bez planu trasy zespołu T: profil gęstości wzdłuż kursu w module renderu + notatka `AGENT:`).

## Przed i po (kadr skoku 1080p: zoom 0,2133 × 0,55 = 0,1173, ogniskowa 1712,7 px, camZ ≈ 14 600 j.)

| | przed (10-23) | po (10-26) |
|---|---|---|
| głębia | jedno pudło 2,5–24 tys. j., 360 skał; w kadrze 48% to najgłębsza trzecia | trzy pasma (k 0,96–0,78 / 0,78–0,56 / 0,56–0,37), każde we własnym pudle, 80 / 90 / 90 skał |
| tempo skał | 621–1402 px/s, zawsze 14 tys. j/s | q · (608–1576) px/s, q = 0,55–1 z prędkości kamery |
| skała | tylna półkula przesunięta o 2618 j. (11,2 klatki), LOD z samej głowy | rozmycie 1,25 klatki (~290 j. przy q = 1), LOD z promienia + połowy rozmycia |
| ślad | w materiale skały (pełny program powierzchni w ogonie) | osobna partia kwadów: barwa oświetlonej strony, HDR tylko na min(pół promienia, 5% śladu) za brzegiem skały, długość 0,16 s × przepływ × q (2240 j. przy q = 1) |
| gęstość | w punkcie kamery, wygładzona w czasie (wlot 0,12 s, wylot 0,8 s) | w punkcie kursu, który skała przedstawia (pas, luki, pola rodzin nadlatują) |
| przy statku | skały przepływają pod sylwetką | deflektor: pasmo bliskie omija statek, łuki i fale przy przejściu |

## Hierarchia warstw W0 (DECYZJE-2)

Gwiazdy gry w warpie jadą z kamerą gwiazd ograniczoną do 14 tys. j/s (`warpNurt.js: STAR_SPEED_CAP`), tempo na ekranie
= 14 tys. × paralaksa × zoom; skały — przepływ (14 tys. × q) × zoom × k. Głębokość skał jest w jednostkach camZ, więc
kolejność nie zależy od zoomu. Liczby (`opcje/asteroidy/s-w0.mjs` sesji, test `tests/warpDebrisLayers.test.mjs`):

| warstwa / tryb | tempo w kadrze skoku [px/s] |
|---|---|
| gwiazdy deep | 16–46 |
| gwiazdy mid | 90–296 |
| skały — walka, hipercruise Mk I (20 tys.), Mk II (30 tys.) | brak (kamera ≤ 30 tys. j/s — prawdziwe pole pasa) |
| skały — hipercruise Mk III (40 tys., q 0,64) | 389–1010 |
| skały — mijana planeta (36 tys. j/s, q 0,61) | 369–958 |
| skały — warp Mk I w pasie (80 tys., q 0,86) | 522–1355 |
| skały — warp Mk II / Mk III w pasie (140 / 200 tys., q 1) | 608–1577 |
| gwiazdy speed | 1675–2923 |

Granice: pasmo dalekie przy q = 0,55 (334 px/s) > gwiazdy mid (296), pasmo bliskie przy q = 1 (1577) < gwiazdy speed
(1675). Mk II i Mk III w pasie mają to samo tempo (q nasycone przy 125 tys. j/s — strefa pasa × 0,8 × przelot planu
44–153 tys. daje 35–122 tys., q 0,60–0,99); różnicę napędów niesie profil pasa (szybszy statek przelatuje pas krócej).
Px/s w hipercruisie liczone przy zoomie skoku — przy innym zoomie wszystkie warstwy skalują się razem.

## Deflektor (liczby z `tests/warpDeflector.test.mjs`, kadłub 1800 × 400 j.)

- Elipsa: środek 0,45 L przed środkiem kadłuba, półosie A = 1,3 L = 2340 j., B = 0,55 L = 990 j. — przód pola 1,75 L
  przed środkiem statku (1,25 L przed dziobem), na ekranie ~550 × 230 px.
- Skała z pasma bliskiego na kursie: zjeżdża na bok najwyżej ~6,7 px na klatkę (przy ~26 px/kl. wzdłuż kursu), mija
  statek ~1,2 B od osi (~140 px), odstęp od obrysu kadłuba ≥ 4,2 (w półosiach kadłuba), za rufą wraca na swój tor
  (różnica 0 j.). Pasmo środkowe (głębokość 0,5 camZ) odpychane w ~2/3, dalekie (≥ 0,9 camZ) bez pola.
- Strona skały: ustala się przy wejściu w działające pole (znak Y∞) i jest zamknięta w całym zasięgu pola (ρ∞ < 7);
  na brzegu zasięgu obie strony dają Y∞, więc zamek zwalnia się bez skoku. Największy krok w poprzek kursu, WSZYSTKIE
  skały (także poza kadrem), kołysanie statku ±60 j., pas 0,3 (`opcje/asteroidy/s-poprawki.mjs` sesji, test
  „strona skały” w `tests/warpDeflector.test.mjs`): pole od startu 7,2 px/kl., pole włączone po 3 s przy skałach
  w pudle 8,5, klawisz G co 2 s 9,2, co 0,5 s 8,4, kurs w prawo 8,6 — to ruch skały przy brzegu pola (+ gaśnięcie pola
  0,6 s przy G), nie przeskok.
- Ujawnienie (125 tys. j/s, co klatkę przez 20 s): rzadki pas 1,5 łuku/s, rdzeń pola rodziny 2,1/s; świeci naraz
  średnio 0,5–0,7, najwyżej 2; łuk ±0,18 rad elipsy (cięciwa ≤ ~45 px), ~0,4 s, szczyt jasności 2,4 (HDR), pół grubości
  0,012 B (≥ 1,1 px); łuki pokrywają średnio 5–7% przodu pola (±62°), w szczycie 14–25%; fala refrakcji 2,6 px, front
  0,08 → 0,42 B w 0,45 s, zasięg ≤ 0,8 × odległość od obrysu kadłuba.

## Recenzja S (2026-10-26) — poprawki

- **Ślad świecił ponad progiem bloomu na całej długości.** Głowa zanikała exp(−(s − h) / (1,5 h + 0,04)) od brzegu
  skały (h = promień / długość), więc rosła z promieniem: przy q = 1 skały 560–1100 j. świeciły > 0,9 na 21–100%
  widocznego śladu (za bryłą z rozmyciem), przy zwolnieniu (q 0,61) już od 260 j. — pasy 25–35 px jak komety. Teraz
  głowa ma zwarty nośnik: (1 − x)² na g = min(h / 2, `trailGlow` 0,05) za brzegiem — HDR 7–79 j. za brzegiem skały
  (≤ ~9 px), w strefie gasnącego rozmycia bryły; za rozmyciem 0% śladu ponad progiem dla każdego promienia i q
  (`s-poprawki.mjs`, testy `tests/warpTrails.test.mjs`, „ślad światła: ponad progiem…” w `tests/warpDebris.test.mjs`).
  Jasność głowy (`trailHead` 5) i jej długość (`trailGlow`) do oceny w grze — głowa może teraz być za słaba.
- **Skała po złej burcie i przeskok strony.** Strona losowana przy narodzinach i zamknięta tylko w strefie podłogi:
  skała narodzona w zasięgu albo zastana przy włączeniu pola (klawisz G) stała przy elipsie po drugiej burcie i za rufą
  wracała skokiem 3–4 B (27–28 px/kl. w kadrze, 350–400 px/kl. poza nim). Teraz strona = znak Y∞ przy wejściu w pole,
  zamek w całym zasięgu (wyżej), gaśnięcie pola wolniejsze (0,6 s) niż narastanie (0,35 s).
- **Łuki składały się w obrys przodu.** 6 naraz co 0,09 s po ±0,42 rad: 3–5,6 łuku/s, średnio 18–31% przodu elipsy,
  w szczycie 55–63% (dawne „~1 na sekundę” liczone co 30 klatek — niedoszacowanie). Teraz najwyżej 2 naraz, odstęp
  0,4 s ± 40% losowo, ±0,18 rad (liczby wyżej).

## Koszt

- CPU kroku pasa w skoku (Node 22, po recenzji; `opcje/asteroidy/s-koszt.mjs` sesji: deflektor + prawdziwa partia
  śladów bez GPU, zestaw skał — atrapa, `RockSet.update` poza pomiarem; 2400 klatek po rozgrzaniu JIT): rzadki pas
  91 skał — 0,013 ms średnio (p95 0,014), rdzeń pola rodziny 257 skał — 0,032 ms (p95 0,037). Wcześniejsze liczby
  wykonawcy (0,056–0,075 ms przy 60–90 skałach) mierzyły krótszy bieg z JIT w rozgrzewce. Profil pasa: ~0,6 nowej
  próbki `sampleMacro` na klatkę (2–6 µs), po zmianie kursu jednorazowo ~60–130 próbek.
- GPU: ślad liczy prosty shader zamiast pełnego programu powierzchni skały w ogonie (mniejsze wypełnienie programem skał);
  +1 rysunek (partia śladów), +1 pipeline (`AsteroidBelt:warpTrails`, rozgrzewany passem tła pasa), budowa NodeBuildera
  ~14 ms w Node. Fale deflektora: gałąź „uber” z istniejącymi źródłami (0 nowych pipeline'ów).
- Nie zmierzone w przeglądarce (gry nie uruchamiano w tej sesji).

## Co obejrzeć w grze

- Warp przez pas (Ziemia → Jowisz, `node scripts/webgpu/warp-ped-gra.mjs`, demo `dema/warp-ped.html` — klawisze B, G):
  czy skały czytają się jako bryły w głębi (trzy tempa), czy ślad światła nie wygląda jak komety / rakiety (jasność
  `trailGain` / `trailHead`), czy pas „nadlatuje” z góry kadru i luki są widoczne.
- Zwolnienie przy mijanej planecie (Mars na trasie do Jowisza): skały zwalniają, ślady krótsze.
- Deflektor: skała na kursie zjeżdża łukiem przed dziobem; łuki i fale — rzadkie, krótkie, nigdy na kadłubie; nie
  powinien powstać widoczny obrys elipsy (najgęściej — w polu rodziny). Klawisz G w demie: skały wracają na tor płynnie.
  A/B `?deflektor=0`.
- Ślad: czy głowa tuż za bryłą jeszcze łapie bloom (po recenzji krótka, w strefie gasnącego rozmycia) — za słaba →
  `trailGlow` 0,08 albo `trailHead` 6 w `WARP_DEBRIS_LOOKS.swiatlo`.
- Kolejność rysowania: wszystkie ślady (renderOrder 1,5) przed wszystkimi skałami — skała dalekiego pasma może przykryć
  ślad bliskiej (świadome uproszczenie; podział partii na pasma = trzy rysunki i trzy zestawy skał).
- Długość śladu bliskiej skały na ekranie (205–252 px przy q = 1) jest większa niż smuga gwiazd speed (~130 px), choć
  skała jest wolniejsza — ta sama niespójność długości smug co w krytyku § 1; świadomy wybór „ślad światła” (10-23),
  do oceny w A/B (`trail` 0,16 s).
- Hipercruise Mk III w pasie: skały bez deflektora (statek przepływa nad nimi).
- Pipeline'y synchroniczne przy pierwszym przelocie przez pas: 0 (`start-sync-gra.mjs --query renderWorker=1`,
  `warp-ped-gra.mjs`), w obu trybach renderu.

## A/B

- Gra: `?smugi=swiatlo|bryla|slad|klin` (wygląd), `?deflektor=0` (bez pola) — adres strony, działa też w workerze.
- Demo `warp-ped`: klawisz B (wyglądy), G (deflektor).
