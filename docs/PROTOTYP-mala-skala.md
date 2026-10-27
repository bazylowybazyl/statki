# Prototyp: mała skala na fregacie zwiadu (`?malaSkala=1`)

2026-10-27. Prośba użytkownika: „zrób grywalny prototyp skali 650 j. na fregacie zwiadu (kamera 650 j., broń ~300 j.,
~600 j./s), pod flagą, do sprawdzenia w grze”. Pomysł: mały statek wielkości dużej wieży (fregata 152 j. ≈ wieża
Yamato ~137 j.) oblatuje okręt kapitałowy i wyłącza jego bronie po kolei, a kontener gry (16 × 8 j.) jest w tej skali
obiektem, nie kropką.

Kod: `src/game/smallScale.js` (liczby i czysta matematyka), klej — blok „MAŁA SKALA” w `index.html` (za blokiem
„ZWIAD: FREGATA W ŁADOWNI”), sufit prędkości sterów `SCOUT_TUNE.ctlSpeed` w `src/game/scoutBay.js`. Bez flagi gra
działa jak dotąd. Test: `node --test tests/smallScale.test.mjs`; w grze: `node scripts/webgpu/mala-skala-gra.mjs`.

## Jak zagrać

1. Adres gry z `?malaSkala=1` (gra swobodna; fregata zwiadu jest w ładowni Atlasa od startu — jak `?zwiad`).
2. **H** — start fregaty i przejęcie sterów. Kamera przechodzi na kadr 650 j. (kółko: do 320 j. bliżej, dalej jak w grze).
3. **W / S** zadają prędkość (sufit 600 j./s), **A / D** — kurs, **Q / E** — bok. **LPM** — działa fregaty strzelają
   w kursor (zasięg ~300 j., przerywany okrąg wokół fregaty). Reszta klawiszy zwiadu bez zmian (I, X, 3, 4, T).
4. Konsola przeglądarki: `MalaSkala.cel()` — pancernik piratów 1,6 km przed fregatą: uśpiony (stoi, wieże milczą,
   Atlas na auto go pomija), bez tarczy. Warianty: `MalaSkala.cel({ walka: true })` — z mózgiem i bronią,
   `{ tarcza: true }` — z polem, `{ typ: 'destroyer', odl: 1000 }`.
5. **H** — powrót do luku; zoom i limit kamery wracają do Atlasa.

Strojenie w biegu: `MalaSkala.tune` (np. `MalaSkala.tune.turretHp.L = 200`; kadr i prędkość — od następnego przejęcia
sterów; zasięg i pocisk — od następnego startu fregaty).

## Liczby (`SMALL_SCALE`)

| | wartość | skąd |
|---|---|---|
| kadr | 650 j. (najbliżej 320 j.) | 1/14 kadru Atlasa (9 km); kontener 16 j. ≈ 47 px przy 1080p, przy 320 j. ≈ 96 px |
| prędkość sterów | 600 j./s, zadawanie 700 j./s², obrót 1,6 rad/s | kadr w ~1,1 s, okrążenie Atlasa ~11 s; dziś fregata 1412 j./s przelatuje kadr 650 j. w 0,46 s |
| działa główne | Tempest Mk II, zasięg 300 j., pocisk 1800 j./s | źródło modyfikatorów `malaSkala` (`setModifierSource`); 300 j. ≈ pół kadru — jak bateria Atlasa (4,5 km w kadrze 9 km) |
| wieże fregaty | obrót 4 rad/s, strzał przy lufie ≤ 0,12 rad od kursora | wpisy `autoWeapons` broni głównej (fregata zwiadu bez mózgu dotąd ich nie miała — nie rysowała wież) |
| wieże NPC | S / M / L / Capital: 100 / 200 / 400 / 800 pkt życia; strefa = korpus × skala wież klasy + 20 j. | tylko pociski fregaty przy sterach gracza; wieża pada przez `markHardpointDestroyed` (jak przy wyrwie pod gniazdem) |
| strzał nad pokładem | kursor ≤ korpus + 12 j. od wieży wrogiego okrętu w zasięgu dział (≤ 320 j. od fregaty) w chwili strzału | pocisk mija kadłub tego okrętu do wieży i trafia pokład przy niej (krater, iskry; trafienie idzie do tej wieży, choć krater bywa krok pocisku ~30 j. przed nią); wieża dalej — zwykły strzał. Bez tego w 2D pierwsza burta zatrzymuje pocisk (w grze CIWS na rufie pancernika piratów stoi ~30 j. za krawędzią, a 42 z 42 trafień szły w burtę) |

## Ograniczenia prototypu (świadome)

- Punkty życia wież działają tylko dla strzałów fregaty przy sterach gracza — reszta gry dalej niszczy wieże wyrwą pod
  gniazdem (sonda 14 j. × skala gniazd).
- Gra jest w 2D: pocisk trafia pierwszy kadłub na swojej drodze, więc bez wyjątku z boku dosięga się tylko wież tuż przy
  burcie. Prototyp robi wyjątek — STRZAŁ NAD POKŁADEM (strzał wycelowany w wieżę leci do niej nad kadłubem jej okrętu).
  To umowa rozgrywki („wieża stoi na pokładzie, mały statek strzela w nią z góry”), nie fizyka 2D; pudło obok wieży leci
  dalej nad pokładem, nie żłobi go. Czy tak ma zostać — do decyzji.
- Celownik i panel wież na dole ekranu pokazują dalej baterię Atlasa (kierowanie ogniem Atlasa), nie działa fregaty.
- Tarcza celu zatrzymuje małą broń (dlatego cel ćwiczebny jest domyślnie bez pola) — jak ma działać mały statek
  przeciw tarczy (pod polem, przebicie, wyłączenie generatora), to osobna decyzja.
- Kadr 650 j. wygląda dobrze na obecnych sprite'ach; przy 320 j. sprite Atlasa (~2 px tekstury na jednostkę) jest
  rozmyty, a dziury kadłuba mają schodki komórek belek po 15 j. (zrzuty: `.tmp/skala/`, sesja 2026-10-27).

## Wyniki próby w grze (2026-10-27)

`node scripts/webgpu/mala-skala-gra.mjs` (tryb workera jak u gracza, 1920 × 1080, zrzuty w `.tmp/skala/proto6/`):

- Przejęcie sterów: kadr 650 j. (zoom 2,954), limit przybliżenia 6 (kadr 320 j.); po powrocie fregaty zoom wraca do
  kadru Atlasa (0,213) i limitu 3,2.
- Lot: W trzymane 6 s — prędkość zadana 600 j./s, rzeczywista 630 (sufit pilota × 1,05). Kamera wyprzedza fregatę.
- Działa: 3 wieże Tempest Mk II fregaty (teraz rysowane), zasięg 300 j.; strzały prowadzone za kursorem.
- Cel ćwiczebny (uśpiony pancernik piratów, bez pola): bez strzału nad pokładem 42 z 42 trafień szło w krawędź rufy
  ~30 j. przed CIWS (0 trafień wieży). Ze strzałem nad pokładem: CIWS (100 pkt) padł po 10 trafieniach — wybuch, wieża
  znika z rysunku (14 → 13), okręt traci punkty kadłuba za gniazdo; następna wieża (400 pkt) dostała 30 trafień w
  pozostałym czasie próby — przy 3 działach (~3,75 strzału/s) to ~11 s ognia na wieżę L.
- 0 błędów strony, 0 pipeline'ów kompilowanych synchronicznie.

Wnioski do decyzji użytkownika: tempo wyłączania (punkty życia wież), strzał nad pokładem czy reguła 2D, tarcze celu,
własny celownik fregaty zamiast celownika Atlasa, ostrość dużych kadłubów przy kadrze 320 j.
