# Audyt myśliwców — 2026-10-14

Zgłoszenie użytkownika: myśliwce, gdy biją statek, „wpadają w szał”; do rozdzielenia role — bombowiec
przelatuje NAD statkiem i zrzuca bomby NA statek, torpedowiec wypuszcza torpedy dolatujące w statek,
kanonierki latają po orbicie; sprawdzić AI walki myśliwiec na myśliwca; „chyba za szybko manewrują”.

## Jak mierzono

`node scripts/webgpu/mysliwce-zachowanie-gra.mjs [--scen atak,obrona,kociol,role] [--czas 40]` — prawdziwa
gra w headless Chrome, pustka między Wenus a Ziemią, Atlas nieśmiertelny, myśliwce i cele nieśmiertelne (sam
tor, bez strat). Sonda w `npcStep` zapisuje KAŻDY krok fizyki (60 Hz) każdego myśliwca: położenie, prędkość,
kurs nosa, stan i podfazę mózgu, cel; strzały i trafienia z sond w kolizjach. Scenariusze:

- **atak** — 54 myśliwce Atlasa (6 eskadr wielozadaniowych) na piracki pancernik 4,5 km przed dziobem,
- **obrona** — 18 pirackich myśliwców (przechwytujące + wielozadaniowe) na Atlasa,
- **kociol** — 54 myśliwce Atlasa na 27 pirackich (myśliwiec na myśliwca),
- **role** — wezwane bombowce, torpedowce i kanonierki Terra Novy na piracki pancernik (po przebudowie).

Miary: prędkość, tempo skrętu WEKTORA prędkości (okno 0,1 s), przeciążenie boczne v·ω, obrót kadłuba,
rozjazd nos ↔ prędkość („lot bokiem” > 45°), zawrotki (kurs obrócony o > 150° w 1,2 s), zmiany stanów,
podfaz i celów na minutę, odległość od celu, czas nad kadłubem, strzały, trafienia, celność. Tory w układzie
celu: `tory-<scen>.png`.

## Stan przed (HEAD, 2026-10-14)

| | atak (54 na pancernik) | obrona (18 na Atlasa) | kocioł — gracz | kocioł — piraci |
|---|---|---|---|---|
| prędkość p50 [j/s] | 2800 (= maks.) | 2862 | 2802 | 3400 (= maks.) |
| tempo skrętu wektora p50 / p90 [°/s] | 177 / 280 | **280 / 280** | 260 / 370 | **370 / 370** |
| przeciążenie boczne p50 / p90 [j/s²] | 6 900 / 13 700 | 13 700 / 16 400 | 11 900 / 18 200 | 19 500 / 22 200 |
| obrót kadłuba p90 [°/s] | 225 | 347 | 361 | 369 |
| lot bokiem (nos > 45° od kursu) | **54%** | 35% | 37% | 46% |
| zawrotki na minutę | **44** | **47** | 38 | 41 |
| zmiany podfazy kotła na minutę | — | — | 32 | 32 |
| odległość od celu p10 / p50 / p90 | 573 / 1021 / 1399 | 515 / 853 / 1253 | 186 / 574 / 2417 | 65 / 414 / 1943 |
| celność | 22% | 51% (wszystko w tarczę) | 9% | 60% |

Przeciążenie boczne myśliwca przy własnym przyspieszeniu 1700–2600 j/s² sięgało 7–22 tys. j/s² (3,5–11×),
skręt przez cały czas na suficie gałęzi mózgu. Tor jednego myśliwca w nalocie: tor wyścigowy ±1,6 km przez
środek celu, pełne okrążenie co ~3 s (`tory-atak-1.png`).

## Przyczyny „szału”

1. **Nalot na okręt = ping-pong.** Stan `bombing`: punkty po obu stronach celu w odległości
   `zasięg × 1,1 + radius`, zawrotka, gdy maszyna zbliży się do punktu na `max(260, 0,32·v) + radius`. Przy
   2800 j/s i `radius` pancernika 140 (kadłub ma ~1,5 km!) maszyna zawracała tuż za kadłubem — co ~1,3 s, cały
   rój po losowych liniach przez środek celu.
2. **Zwrotność bez fizyki.** Mózg (20 Hz) obracał SAM wektor prędkości o 14–22° na tick (280–450°/s) bez
   zmiany prędkości — przeciążenie boczne 3,5–11× przyspieszenia, promień zawrotki ~600 j. przy 2800 j/s.
   Kadłub obracał się osobno, do 690°/s (`turn` 9,5–12 rad/s).
3. **Lot bokiem.** W nalocie nos patrzył na cel (`desiredAngle` = namiar), a maszyna leciała wzdłuż linii
   nalotu — 54% czasu nos > 45° od kursu, kadłub kręcił się nad celem jak bąk.
4. **Łamany tor i skoki obrazu.** Prędkość zmieniała się tylko w tickach mózgu (tor = łamana co 50 ms),
   a pozycja rysowała się bez interpolacji: przy kroku fizyki 60 Hz i ekranie 144 Hz myśliwiec stał 2–3
   klatki i przeskakiwał o ~47 j.
5. **Skala prędkości sprzed przebudowy lotu.** Karty eskadr strojone pod Atlasa 3000 j/s (komentarz
   w `fighterSquadrons.js`); od 2026-10-01 Atlas walczy przy 500 j/s (dopalacz 1500).
6. **Geometria z `radius`.** Okręty mają `radius` 140–300 przy kadłubach 1–2 km — atak liczony z niego
   celował w środek i zawracał nad kadłubem.
7. **Kocioł:** losowe zerwania walki (`break_off` 0,22/s po minimalnym czasie), drżenie kursu ±4° i „wir”
   ±10% — 32 zmiany podfazy na minutę; brak reakcji na wroga na ogonie; mijanki czołowe przez siebie.
8. **Rakiety szturmowych tylko z 1200 j.** (zasięg rakiety 6000) — `fast_missile_rack` odpalał się z bliska.

Przy okazji (nie „szał”, ale błędy):

9. **Rozkazy eskadr gracza martwe.** Z przełączało `SQUAD.order` (ESKORTA → ATAK → POWRÓT), ale mózg myśliwca
   go nie czytał (myśliwce gracza zawsze polowały w 16 km), a nikt nie lądował.
10. **Jeden start na grę.** `SQUAD.list` nie traciła poległych, a start był możliwy tylko przy pustej liście
    albo rozkazie `idle` (do którego nic nie wracało) — po pierwszym starcie hangary już nic nie wypuszczały;
    licznik „w powietrzu” w HUD liczył też zniszczone.
11. **Wszystkie myśliwce jednakowe wobec okrętów** — działko CIWS zadaje okrętom 20%, więc 54 myśliwce
    w szale robiły mało (2,4 obrażenia na trafienie); lotniskowce NPC wypuszczały tylko myśliwce.

## Co zmieniono

### Pilot (`src/game/flight/fighterFlight.js`, nowy)
Mózg ustawia ZAMIAR (wektor żądanej prędkości, sufit skrętu, opcjonalnie kurs nosa); pilot w KAŻDYM kroku
fizyki (`npcStep`) skręca z ograniczonym przeciążeniem bocznym (ω ≤ min(maxTurn, latAccel / v) — promień
v² / latAccel, wolniej = ciaśniej), skręt narasta z ograniczonym przyspieszeniem kątowym (bez załamań toru),
prędkość z przyspieszeniem / hamowaniem karty, nos wzdłuż prędkości (celowanie odchyla go najwyżej o 17°).
Karty lotu per rola w `fighterSquadrons.js` (`flight: { latAccel, maxTurnDeg, rollAccel, decel }`), strojenie
na żywo `window.FighterFlightTune` + `bumpFighterFlightTune()`. Rysunek z interpolacją między krokami.

### Atak na okręt (`src/ai/fighterAI.js`, stan `strafe`)
Przelot: podejście z ogniem na punkt kadłuba (każda maszyna w inną część kadłuba), minięcie, DOBIEG prosto za
cel (dłuższy niż promień nawrotu), szeroki nawrót obok celu, kolejne podejście pod innym kątem. Geometria
z prawdziwego obrysu (`window.getFighterTargetGeom` — półosie z obrysu tarczy, oś kadłuba).

### Kocioł (`dogfight3D`)
Pościg z wyprzedzeniem i kontrolą zbliżania (prędkość celu + zapas; cel z boku — zwolnij do prędkości narożnej),
przestrzelenie → pościg z opóźnieniem i dobieg, mijanka czołowa z przesunięciem w bok (bez taranu), OBRONA:
wróg na ogonie (za nami, nosem w nas, w zasięgu) → ostry skręt w napastnika z unikami co 0,5–1 s. Bez
losowych zerwań i drżenia kursu. Działka w stożku 16° od nosa (było 43°).

### Role (karty w `fighterSquadrons.js`, broń — sesja pomocnicza „Bronie myśliwców”)
- **Bombowiec** (`bomb_run`): punkt wejścia na osi kadłuba (na zmianę wzdłuż i w poprzek), prosty spokojny
  przelot, bomba spada, gdy maszyna jest NAD kadłubem (`window.fighterOverHull` — żywa komórka kadłuba pod
  maszyną), 3 bomby na przelot, dobieg, kolejny nalot; bez bomb — powrót do nosiciela i przezbrojenie.
  Wieżyczka samoobrony na myśliwce. Broń `fighter_bomb` (tarcza zatrzymuje, dziura w poszyciu przepuszcza).
- **Torpedowiec** (`torp_run`): podejście z burty celu, torpeda `aerial_torpedo` z ~2,8 km na punkt
  wyprzedzenia, odwrót łukiem, drugie podejście, przezbrojenie.
- **Kanonierka** (`orbit`): orbita w stałej odległości od powierzchni kadłuba (0,62 zasięgu działka), stała
  strona obiegu, prędkość z zapasem przeciążenia; wieżyczka 360° (`gunship_autocannon`) bije z wyprzedzeniem,
  rakiety Osa na myśliwce, które ją atakują; uszkodzona trzyma się dalej.
- **Przechwytujący** woli maszyny uderzeniowe (premia w `scoreAiTarget`), bombowiec / torpedowiec / kanonierka
  nie biorą myśliwców za cel (−∞), szturmowy woli okręty.

### Rozkazy eskadr gracza (Z)
ESKORTA (po starcie): cele do 6 km, nie dalej niż 8 km od Atlasa; ATAK: 16 km, cel z namiaru T pierwszy;
POWRÓT: lot do wyrzutni startu i lądowanie (`window.landFighter`), po wylądowaniu ostatniej maszyny Z startuje
eskadry od nowa. Lista bez poległych, licznik HUD = maszyny w powietrzu.

### Lotniskowce NPC
Grupa lotnicza z listy strony (`CARRIER_WING_MIX`): Terra Nova — myśliwce wielozadaniowe, torpedowiec,
bombowiec, przechwytujący, kanonierka; piraci — przechwytujące, kanonierka, bombowiec, torpedowiec.

## Stan po (ten sam pomiar, ta sama scena, 40 s)

| | atak (54 na pancernik) | obrona (18 na Atlasa) | kocioł — gracz | kocioł — piraci |
|---|---|---|---|---|
| prędkość p50 [j/s] | 2471 | 2471 | 2339 | 2513 |
| tempo skrętu wektora p50 / p90 [°/s] | 30 / 139 (było 177 / 280) | 19 / 152 (280 / 280) | 132 / 160 (260 / 370) | 132 / 170 (370 / 370) |
| przeciążenie boczne p50 / p90 [j/s²] | 1 100 / 6 000 (6 900 / 13 700) | 830 / 7 200 (13 700 / 16 400) | 4 700 / 6 000 (11 900 / 18 200) | 5 500 / 7 200 (19 500 / 22 200) |
| obrót kadłuba p90 [°/s] | 139 (225) | 152 (347) | 160 (361) | 175 (369) |
| lot bokiem | **0%** (54%) | 0,3% (35%) | 0% (37%) | 0,3% (46%) |
| zawrotki na minutę | **15** (44) | **14** (47) | 20 (38) | 22 (41) |
| trafienia w 40 s | okręt: 7190 (4019 — 179%) | Atlas: 1498 (2047 — 73%) | myśliwce: 392 (740 — 53%) | myśliwce: 800 (1317 — 61%) |

Przelot nad okrętem: podejście 35%, dobieg 22%, nawrót 36% czasu, mediana odległości od celu 2,2 km (było 1 km —
rój wisiał w kuli 1,4 km). Celność w okręt 98% (było 22%): strzał tylko z nosem na kadłubie. Więcej trafień niż
w „szale” dało też usunięcie testu linii ognia przez sojuszników — broń myśliwców ma IFF, a test w gęstym
przelocie eskadry blokował większość strzałów. Kocioł: pościg 56–63%, obrona 27–28%, mijanki i przestrzelenia
po 1–3%; walka w łukach o promieniu ~800 j., dłuższa (trafień ~55–60% dawnych).

Role (wezwane skrzydło Terra Novy na piracki pancernik ~680 × 240 j., 40 s, cele nieśmiertelne; pomiar po
poprawkach punktów życia i naprowadzania torped — niżej):

| | bombowce (6) | torpedowce (6) | kanonierki (4) |
|---|---|---|---|
| tempo skrętu p50 / p90 [°/s] | 44 / 95 | 42 / 110 | 39 / 54 |
| zawrotki na minutę | 0 | 0 | 0 |
| stany | nalot 95% (ustawienie 67%, nad celem 22%, dobieg 9%), przezbrojenie 3% | atak 52%, przezbrojenie 46% | orbita 95% |
| wynik | 31 bomb: 26 w kadłub, 4 w tarczę, 1 chybiona | 34 torpedy: 23 trafienia (68%, 5 w tarczę), 10 strąconych | 719 trafień z 728 strzałów (99%), orbita 1681–1999 j. (p10–p90) |

**Torpedy a obrona punktowa** (scenariusz `torpedy`: 12 torpedowców na pancernik z obroną punktową): torpeda kanwy
ginęła od JEDNEGO trafienia działka obrony — 72 odpalone, 57 strąconych (79%), 14 trafień. Bez obrony punktowej celu
(`--celBezPd 1`) — 59 z 62 trafień (95%, dwa chybienia o 23–29 j.): geometria ataku jest dobra. Poprawka: punkty
życia obrony punktowej dla pocisków kanwy z `pdHp` (jak rakiety 3D w modelu V3 — te same mnożniki przyczyny),
torpeda lotnicza `pdHp: 60` (jak rakieta manewrująca: CIWS Mk I — 5 trafień, laser PD — 8). Po: 48 odpalonych,
38 trafień (79%), 10 strąconych (21%).

**Naprowadzanie torped** (znalezisko sesji pomocniczej „Bronie myśliwców”): blok naprowadzania w pętli pocisków
(`bulletsAndCollisionsStep`) siedział w warunku ścieżki KANWY (`!threeVisual`), a WeaponFx rysuje każdy pocisk bez
`forceCanvas` — więc od pierwszej klatki renderu torpeda lotnicza (22°/s) leciała prosto (rozgrywka zależała od
ścieżki rysunku). Poprawka: wspólna funkcja `steerHomingBullet` i osobna, wąska gałąź dla pocisków z WeaponFx —
tylko jawny `turnRate > 0` i WŁASNY cel pocisku (bez zapasowego celu z namiaru gracza). Salwy trybu torped gracza
(`turnRate: 0`, bez celu) zostają niekierowane; torpedy okrętowe (oblężnicze, salwa) strzela dziś tylko ten tryb,
NPC ich nie noszą. Test `tests/fighterTorpedoHoming.test.mjs`. Po (punkty życia + naprowadzanie, ten sam
scenariusz): 72 odpalone, 60 trafień (83%, 9 w tarczę), 8 strąconych (11%), 4 w locie przy końcu pomiaru; bez
obrony punktowej celu — 66 z 66 rozstrzygniętych w cel, zero chybień (przed: 59 z 62, dwie mijały kadłub o 23–29 j.).

Na jeden hangar (eskadrę) role uderzeniowe zadają okrętom 4–6× więcej niż myśliwce wielozadaniowe (CIWS bije
okręty w 20%): kanonierki ~440 obr./s, torpedowce ~330, bombowce ~250 (seriami), 9 myśliwców ~70.

Pilot i role w testach (`tests/fighterAI.test.mjs`, 27 przypadków na mini-symulacji z prawdziwym mózgiem):
skręt ≤ latAccel / v, narastanie skrętu, ten sam lot przy 60 i 120 Hz, przelot ≤ 16 zawrotek na minutę, bomby
tylko nad kadłubem w prostej serii, torpeda z dystansu z odwrotem, orbita w stałej odległości, przezbrojenie,
lądowanie, dobór celów ról.

## Do decyzji użytkownika

1. **Siła myśliwców wobec okrętów** — przelot wielozadaniowych bije okręt mocniej niż dawny „szał” (179%
   trafień), piraci na Atlasa słabiej (73%). Strojenie: `FighterAITune.strafeSpeed` (wolniej = dłuższe okno
   ognia), stożek działek `GUN_CONE` w `fighterAI.js`.
2. **Zwrotność** — przeciążenie boczne ~2–3× mniejsze niż dawniej, prędkości maks. −7…12% (przechwytujący
   3400 → 3000, wielozadaniowy 2800 → 2600, szturmowy 2400 → 2300). Więcej / mniej:
   `FighterFlightTune.latAccelMul` (+ `bumpFighterFlightTune()`) albo `flight` w `fighterSquadrons.js`.
3. **Ponowny start po POWROCIE** — dziś startują pełne eskadry (straty uzupełnione za darmo); do decyzji:
   czas odbudowy / koszt maszyn w hangarze.
4. **Liczby ról** — bomba 420 obr., torpeda 1100, przezbrojenie przy nosicielu 8 s (bez nosiciela 22 s),
   eskadra: 6 bombowców / 6 torpedowców / 4 kanonierki, koszt eskadry = liczba maszyn (cięższa maszyna
   kosztuje jak myśliwiec).
5. **ESKORTA naprawdę eskortuje** — myśliwce gracza po starcie biją cele do 6 km i nie dalej niż 8 km od
   Atlasa (dawniej, przy martwym rozkazie, polowały w 16 km); ATAK = dawne zachowanie.
6. **Rysunki ról** — warianty jednego rysunku myśliwca (bez nowej grafiki); dedykowane sprite'y do zamówienia.
7. **Torpedy a obrona punktowa** — torpeda lotnicza ma 60 punktów życia obrony (model V3 rakiet 3D); inne
   torpedy kanwy (oblężnicze, salwa) dalej giną od jednego trafienia — do decyzji, czy dać im `pdHp`. Torpedy
   okrętowe mają w danych `turnRate` 60–120°/s: gdyby strzelał nimi ktoś z celem (NPC, ogień na auto), po
   naprawie naprowadzania będą skręcać na cel (dawniej przez ten sam błąd leciały prosto).

## Narzędzia

- `node scripts/webgpu/mysliwce-zachowanie-gra.mjs [--scen atak,obrona,kociol,role,torpedy] [--czas 40]
  [--niesmiertelne 0] [--celBezPd 1]` — raport.json, tory-*.png, zrzuty (atak i role — zbliżenie na cel);
  `torpedy` — 12 torpedowców na pancernik, los każdej torpedy (trafiona, w tarczę, strącona, chybiona).
- Konsola: `FighterFlightTune`, `bumpFighterFlightTune()`, `FighterAITune`, `FighterBombs.stats`, karty
  testowe Rezerwy (`?dev`): Bomber / Torpedo / Gunship Wing (Terra Nova i piraci).
