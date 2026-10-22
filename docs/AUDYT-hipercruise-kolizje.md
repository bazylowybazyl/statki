# Audyt: hipercruise a trafienia, tunelowanie i koszt kroku (E9, 2026-10-22)

Prośba użytkownika (2026-10-22): „hipercruise — niech osobny agent sprawdzi wpływ na hit, tunelowanie, wydajność — czy nie
będzie przepuszczać kolizji itp.” Hipercruise (E5, `src/game/flight/hypercruise.js`) to 20 / 30 / 40 tys. j/s — przy kroku
fizyki 60 Hz to 333 / 500 / 667 j. na krok. W grze ma go tylko gracz (NPC i ruch v2 jeszcze nie).

Narzędzia:
- `node scripts/hipercruise-kolizje-sym.mjs [--tryb pociski|rakiety|ring|koszt]` — Node, prawdziwe moduły (HullBodies.sweep,
  BulletSpatialGrid, zapalnik jak w `rocketSim.js`, HaloRingCollider), rastry kadłubów z `.tmp/tunelowanie/kadluby.json`;
- `node scripts/webgpu/hipercruise-gra.mjs [--etapy ring,duch,koszt]` — prawdziwa gra (CDP), Atlas z Mk III.

## 1. Trafienia

Pętla pocisków testuje cel w ruchu względnym (`segX0`), ale szeroka faza (siatka pocisków) pytała odcinkiem w ŚWIECIE
o cel wstawiony w pozie końca kroku. Zapalnik rakiet testował odcinek lotu w świecie przeciw pozie końca kroku gracza
(gracz rusza się w kroku przed rakietami).

Pociski ze stojącego działa (3 / 7 / 15 tys. j/s, kąty 90° / 135° / 180°), odsetek trafień ruchu względnego, które gra gubiła:

| cel (promień) | 20 tys. j/s | 30 tys. j/s | 40 tys. j/s | po poprawce |
|---|---|---|---|---|
| Atlas (863 j.) | 0% | 0% | 0% | 0% |
| niszczyciel (148 j.) | 1,1–3,7% | 0–2,6% | 3,2–5,9% | 0% |
| fregata (89 j.) | 0–2% | 0–1,1% | 1–2,6% | 0% |

Zapalnik rakiety (rakieta 2,5 / 6 tys. j/s), odsetek prób z trafieniem w układzie celu, które gra przepuszczała
(fałszywych detonacji: 0% wszędzie):

| zapalnik | 1,4 tys. j/s | 20 tys. j/s | 30 tys. j/s | 40 tys. j/s |
|---|---|---|---|---|
| 777 j. (Atlas) | 0% | 0–0,8% | 0–1,5% | 0–2,8% |
| 160 j. (niszczyciel) | 0–0,5% | 6–20% | 21–38% | 27–54% |
| 80 j. (fregata) | 0–3% | 24–57% | 31–70% | 36–77% |

Poprawki (E9): `BulletSpatialGrid.insertSwept` + `insertBulletGridTarget` (cel w siatce z drogą kroku v·dt);
zapalnik rakiety przeciw graczowi / P2 w ruchu względnym (`isInterpolatedEntity`). CIWS kontra rakiety był już w ruchu
względnym (`rocketIntercept.js`). Strażnik: `tests/hipercruiseTrafienia.test.mjs`.

## 2. Tunelowanie

- Kadłuby, wraki, budowle, olbrzymy pasa, komety: hipercruise jest DUCHEM (`updatePlayerWarpGhost`, jak warp) — gra:
  przelot 40 tys. j/s przez 12 okrętów — 0 styków, 0 straconych węzłów, po wyjściu zwykłe kolizje (duch gaśnie, gdy kadłub
  na nic nie zachodzi).
- Płyta ringu zostaje przeszkodą i zrywa hipercruise. Atlas (1800 j.) nie przebija płyty żadnego ringu do 40 tys. j/s
  (dziób wchodzi pierwszy, środek zostaje po stronie habitatu). Małe kadłuby na Ziemi (płyta 452 j.):

| kadłub | kąt | 20 tys. | 30 tys. | 40 tys. |
|---|---|---|---|---|
| niszczyciel (288 j.) | 90° | 0% | 25% | 42% |
| niszczyciel | 45° | 0% | 0% | 8% |
| fregata (192 j.) | 90° | 0% | 33% | 42% |
| fregata | 45° | 0% | 0% | 25% |

  Mars (1600 j.) i Jowisz (1900 j.) — 0%.
- Gra (Atlas Mk III na płytę Ziemi z dala, strefa planety × 0,3): na wejściu w studnię 39,9 tys. j/s, uderzenie
  38,3 tys. (90°) / 37,3 tys. (30°) — sufit strefy hamuje automat za wolno (5,3 tys. j/s² na 13,5 km studni). Pod 30° po
  zerwaniu zostaje 31,9 tys. j/s wzdłuż płyty — po 1 s 2,2 tys., 17 km drogi w 10 s z włączonymi kolizjami kadłubów.
- Wyjście z hipercruise'u w głębi olbrzyma pasa (18–62 km szerokości): kolider olbrzyma widzi tylko pasmo SDF przy
  powierzchni (384–900 j.), w głębi gradient 0 — statek zostaje w skale bez wypchnięcia (ten sam stan zna warp).

## 3. Koszt

Siatka pocisków (Node, minimum 6 rund): budowa + 400 zapytań na krok — 60 celów 35–48 µs, 200 celów 82–100 µs, różnica
insert ↔ insertSwept w szumie; 50 z 200 celów w hipercruise: +10–20 µs, +10% kandydatów wąskiej fazy.

Gra (`hipercruise-gra.mjs --etapy koszt`): bitwa 54–57 okrętów 30 km od gracza, okna po 4 s gry na przemian (3 × A / B),
ms na krok fizyki (PerfHUD), inne sesje pracowały na tej samej maszynie — liczy się różnica w oknach na przemian:

| funkcja | A — lot bojowy | B — hipercruise 40 tys. j/s |
|---|---|---|
| physicsTime | 2,205 (1,94–2,59) | 2,242 (2,20–2,27) |
| playerFlightTime | 0,190 | 0,202 |
| collisionTime | 0,121 | 0,119 |
| destructorTime | 0,381 | 0,367 |
| projectileTime | 0,434 | 0,434 |
| bulletGridTime | 0,141 | 0,144 |
| aiTime | 0,925 | 0,980 |

Różnica w szumie (+1,7% przy rozrzucie okien A ±15%). Hipercruise gracza nie dokłada pracy szerokiej fazie silnika belek
(duch — para odfiltrowana), a długich zapytań `sweep` nie ma, bo gracz-duch ich nie robi. Pipeline'y kompilowane
synchronicznie: 0 (tryb `off`).

## 5. Propozycje (do decyzji — obszar E5 / użytkownika)

1. Hipercruise przed płytą ringu: automat hamuje do sufitu strefy 5,3 tys. j/s² i w studni Ziemi (13,5 km do płyty) prawie
   nie zwalnia. Wariant: wyjście wymuszone, gdy tor dziobu w drodze hamowania przecina płytę (`pointInSlab` wzdłuż kursu),
   albo profil `remaining` do granicy studni jak do celu TRAVEL TO.
2. Uderzenie w płytę: po zerwaniu hipercruise'u statek ma jeszcze do ~32 tys. j/s wzdłuż płyty, już z kolizjami kadłubów.
   Wariant: prędkość po uderzeniu przycięta do `exitSpeed` albo duch do zejścia poniżej ~3 tys. j/s.
3. Wyjście w głębi olbrzyma / komety: duch po hipercruise'ie (i warpie) trzymany także, gdy środek kadłuba jest w skale
   (`beltWorld.pointBlocked`, `cometField.pointBlocked`), albo wyjście przedłużane do wolnej przestrzeni.
4. Broń w hipercruise'ie: `env.canFire` patrzy tylko na postawę, a `setShipMode('combat')` w locie działa — gracz strzela przy
   40 tys. j/s (pociski dziedziczą 100% prędkości). Wariant: broń zimna, dopóki `hypercruiseBusy`, albo zmiana postawy
   przerywa hipercruise.
5. Małe kadłuby z hipercruise'em (każdy kadłub gracza z tabelą lotu ma Mk I) przebijają płytę Ziemi przy 30–40 tys. j/s.
   Jeśli zostaną, kolider płyty potrzebuje testu odcinka środka z poprzedniej pozy (strona płyty z początku kroku).

## 4. Ruch v2 (bańka, `materializedFlight.js`) — tylko obserwacje dla E6

- `cruiseFor(stage)` bierze `DRIVE_MODES[stage.mode].speed` — dla `hypercruise` to frachtowiec Mk I (20 tys.), bez
  `driveModeFor('hypercruise', vanClass)`: van Mk II (30 tys.) leci w bańce wolniej niż w rekordzie.
- Rozpęd i hamowanie `cruise × 0,6 / 0,9` — 12 / 18 tys. j/s²: 0 → 20 tys. w 1,7 s (tabela E5: 5–12 s).
- `separationRadius` 900 j. i `lookAheadMax` 4000 j. — przy 20 tys. j/s to 1,4 kroku i 0,2 s.
