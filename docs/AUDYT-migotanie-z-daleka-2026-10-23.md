# Migotanie doków K-7 i bloków ringu przy oddalonej kamerze (2026-10-23)

Zgłoszenie użytkownika: „doki mrygają, chyba z-fighting; dotyczy praktycznie wszystkich bloków na oddalonej kamerze”.

## Diagnoza: aliasing, nie z-fighting

- **A/B near kamery perspektywy z góry** (passy tła i FG, kamera ringu): near podniesione ze 100 do „wysokość kamery − 15 000”
  (precyzja głębi przy z = 0 ×~250). Obraz całego kadru zmienił się w 0,008–0,016% pikseli przy zoomach 0,035–0,07 — gdyby
  warstwy pokładu walczyły w głębi, wzór przestawiłby się. Powód: three rysuje z `LessEqual`, pasy po polu stanowiska, a
  zaokrąglenie głębi jest monotoniczne — bliższa warstwa wygrywa stabilnie nawet poniżej kroku głębi. Zmiana near cofnięta.
- **Przesunięcie kamery o ułamek piksela** (¼ / ½ / ¾ px) zmieniało > 40/255 1,5 / 2,8 / 3,6–4% pikseli; MSAA 4× ↔ 0 prawie
  bez różnicy w liczbie (z MSAA jasność cienkich pasów „pływa”, bez MSAA pasy znikają i wracają). Mapa: cienkie bryły pokładu
  K-7 (pasy 5–8 j., znaczniki cyan 23 j., obrysy stanowisk), wzór płyt pokładu (losowa jasność płyty 65 j. bez filtra),
  punkty świateł na ringu. Bloom wyłączony — obraz różni się o 0,017% pikseli, reszta migotania nie jest z bloomu.

## Poprawki (`src/3d/haloRing/haloPortK7.js`, `haloRingMegastructure.js`)

1. **Płyty K-7** (`k7Plates`): jasność płyty filtrowana śladem piksela (4 sąsiednie płyty, wagi z pokrycia; z bliska ta sama
   płyta co dawniej), ślad większy niż płyta — odchylenie maleje jak średnia z płyt; zaciek i jasna krawędź płyty przechodzą
   w średnie (0,1255 i 0,10 — policzone w Node z wzoru) dla płyt mniejszych niż ~3 px.
2. **Cienkie bryły na pokładzie** (instancje K-7): prostopadłościan obrócony wokół pionu, spód ≤ 6 j. K-7 nad pokładem, oś
   pozioma < 3 px → wierzchołek poszerza go o 1 px z każdej strony, fragment liczy pokrycie piksela przez prawdziwą bryłę,
   reszta piksela = średni pokład (albedo, chropowatość, metal, emisja ważone pokryciem). Pierwsza wersja poszerzała też bryły
   nad listwami (szyny) — tło „pokład” rozjaśniało ciemne listwy przy zoomie 0,22; stąd warunek „na pokładzie”.
3. **Okna brył megastruktury** (emisja 1–2): ramka i zapalenie → średnia (0,3 · 0,45) przy oknie < ~1 px, jak okna fasad
   megabudowli.

## Pomiar (ten sam świat, `scripts/webgpu/migotanie-gra.mjs`, druga różnica |k2 − (k1 + k3) / 2| > 30/255)

| zoom | hala przed → po | ring przed → po | kadr przed → po |
|---|---|---|---|
| 0,035 | 2,23 → 1,04% | 0,57 → 0,57% | 1,25 → 0,66% |
| 0,05 | 2,05 → 1,04% | 1,24 → 1,22% | 1,43 → 0,83% |
| 0,07 | 2,21 → 1,02% | 2,62 → 1,93% | 1,53 → 0,82% |
| 0,12 | 0,84 → 0,36% | 0,94 → 0,69% | 0,82 → 0,43% |

Z bliska: zoom 1 — 0% pikseli zmienionych, 0,5 — 0,15%, 0,22 — 0,37% (wyłącznie wygładzone pasy i obrysy). Pipeline'y
synchroniczne 0, błędy konsoli 0.

## Dach ringu (druga runda, tego samego dnia)

Kadry dachu (`migotanie-gra.mjs`: pas ringu w środku, 15 tys. j. wzdłuż ringu po obu stronach portu — dachA po stronie
dziennej, dachB w cieniu planety). Źródła z map drugiej różnicy: w dzień pas przemysłowy (obiekty komórek 56 j. i ich
twarde cienie metodą płyt, z daleka cień zostawał w 60%), obwódki i siatka placów, krawędzie brył działek (`If(sd < 0)`),
kontenery (bok 12 j., `step`); nocą kropkowany pas świateł maglev (kreski co 40 j. przez `step` i linia ~1 px w poprzek)
i jadące pociągi z oknami co 5 j. Poprawki (`haloRingStructure.js`, `haloRingMegastructure.js`, `haloRingTSL.js`):
fala prostokątna filtrowana śladem ~2 px (`haloSquareWave` — kreski, światła maglev, okna pociągów; ślad 1 px zostawiał
okres ~3 px jako morę), cienkie linie z zachowaną całką w poprzek (`roofLine`; szersze niż pół śladu — dawny wzór bit w bit),
pokrycie piksela z SDF (brył działek, kontenery, końce narożników), brzegi cieni z dwóch próbek metody płyt i rozmyciem kół,
pas przemysłowy przy komórkach < ~6 → 3 px — średnia płyt, cieni (średni cień klasy 0,21 / 0,23 / 0,30 / 0,29 z Monte Carlo
na lustrze CPU) i plamek lamp; lampy liczą 3 sąsiednie komórki (plamka rośnie z `fw` i była ucinana granicą komórki).

Druga różnica (% pikseli kadru > 30/255), ten sam świat:

| zoom | dach w dzień (dachA) | dach nocą (dachB) | ring w kadrze hali |
|---|---|---|---|
| 0,035 | 0,40 → 0,24% | 0,42 → 0,35% | 0,57 → 0,43% |
| 0,05 | 0,78 → 0,32% | 0,42 → 0,34% | 1,22 → 0,82% |
| 0,07 | 1,05 → 0,45% | 0,52 → 0,47% | 1,93 → 1,51% |
| 0,12 | 0,83 → 0,72% | 0,69 → 0,69% | 0,69 → 0,69% |

Przy zoomie 0,12 kamera jest bliżej niż `HALO_ROOF.geomNear` (14 tys. j.) — dach rysują bryły, nie odcisk w shaderze, więc
ta runda go nie zmienia; dach z bliska (zoom 0,25 / 0,6, przed przez `HULLFALL_AB_DIR`) — 0% pikseli zmienionych. Nocą
reszta miary to w dużej części ruch (jadące pociągi, migające światła — zegar gry biegnie między klatkami harnessu): filtr
okien pociągów i szerszy filtr kresek nie zmieniły już liczby (0,462 → 0,469). Średnia jasność pasa przemysłowego z daleka
+3–5% w kilku próbkach (średni cień klasy z lustra CPU — shader liczy cień z 5 komórek). Pipeline'y synchroniczne 0, błędy 0;
budowa grafu dachu w Node 68–145 → 91–163 ms.

## Co zostało

- Pojedyncze kreski w hali (mapa drugiej różnicy „po”: znaczniki pasów, strzałki) — źródło nieustalone; bloom wykluczony
  (bez bloomu ta sama miara), MSAA prawie bez wpływu.
