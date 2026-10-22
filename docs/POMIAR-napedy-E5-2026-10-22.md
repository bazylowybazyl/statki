# Napędy E5 — przestrojenie 2026-10-22 (pomiary przed i po)

Decyzje użytkownika 2026-10-22: limity bojowe nieokrągłe wokół klasy (Atlas ~500), dopalacz 1000–1200, PRZELOT gracza
usunięty (zastępuje go hipercruise — odcinki `drive` TRAVEL TO tylko nim), warp Mk I / II / III = 100 / 175 / 250 tys. j/s
(id `warp_mk1..3` — kontrakt z E8), hipercruise bez zmian. Baza = `main` 4e1846af (osobny worktree), przebiegi po kolei.
Poprzednie pomiary E5: `docs/POMIAR-napedy-E5-2026-10-21.md`.

## Prędkości (do akceptacji użytkownika)

| | przed (`main`) | po |
|---|---|---|
| BOJOWY: fregata / niszczyciel / pancernik / lotniskowiec / superkapitał | 1400 / 1000 / 650 / 480 / 380 | 1412 / 994 / 643 / 487 / 374 |
| BOJOWY: Atlas / holownik | 500 / 520 | 507 / 514 |
| BOJOWY piraci: fregata / niszczyciel / pancernik / superkapitał | 1500 / 1080 / 700 / 380 | 1478 / 1067 / 692 / 383 |
| Terra Nova: lotniskowiec kapitałowy | 500 | 496 |
| dopalacz Atlasa (Shift) | 1000 (w PRZELOCIE 1800) | 1137 (jeden; bez wpisu kadłuba 2,24 × limit bojowy) |
| PRZELOT Atlasa (biegi) | 700 / 850 / 1000 / 1200 | — (usunięty; sektor koła = HIPERCRUISE) |
| hipercruise Mk I / II / III | 20 / 30 / 40 tys. | bez zmian |
| warp | 260 tys. (jeden) | Mk I 100 / Mk II 175 / Mk III 250 tys.; Atlas Mk II |

Fregata 1412 i niszczyciel 994 (nie 1386 / 1013): przy 1386 / 1013 dwa testy NPC (`npcCommandAvoidance` — szyk RTS,
`npcWorldCollisions` — ring) wychodziły poza tolerancję; obie wersje są nieokrągłe.

Domyślne napędy (`playerHullDrives`, `NPC_CLASS_DRIVE`): Atlas — hipercruise Mk I, warp Mk II; fregata i niszczyciel —
Mk I / Mk I, pancernik — Mk II / Mk II, lotniskowiec i superkapitał — Mk III / Mk III. Ruch v2 (`TRAFFIC_CLASS_DRIVE`):
van — hipercruise Mk II / warp Mk I, hauler — Mk I / Mk I, bulk i heavy — Mk I / Mk II, mega — Mk I / Mk III.

Krótkie odcinki TRAVEL TO (propozycja): < 6 km — autopilot bojowy; 6–30 km — hipercruise ze skróconym rozruchem
(4 s × odcinek / 30 km, nie mniej niż 1 s); dłuższe — pełny rozruch.

## Gra (`node scripts/webgpu/napedy-gra.mjs`, czas gry)

Pozycja startu gry swobodnej i kąty planet są losowe — porównuj odcinki tego samego przebiegu, nie dystanse planet.

| pomiar | przed (`main`) | po |
|---|---|---|
| BOJOWY, W | 500 j/s po 3,4 s | 506 j/s po 3,4 s |
| BOJOWY + Shift | 998 j/s po 2,2 s | 1137 j/s po 2,5 s |
| TRAVEL TO 5 km | 17,8 s (PRZELOT, szczyt 470) | 12,4 s (autopilot bojowy) |
| TRAVEL TO 10 km | 28,2 s (PRZELOT) | 21,8 s (rozruch 1,4 + hipercruise 8,2 + dolot 12,2) |
| TRAVEL TO 30 km | 43,9 s (start w strefie planety × 0,3) | 14,8 s (rozruch 4 + hipercruise 6,5 + dolot 4,2) |
| TRAVEL TO Mars | 74,8 s (2,30 mln j.; skok 12,5 s) | 51,4 s (2,03 mln j.; skok 19,4 s — warp Mk II) |
| TRAVEL TO Jowisz | 53,9 s (2,06 mln j.; skok 11,4 s) | 65,4 s (2,26 mln j.; skok 16,7 s) |
| TRAVEL TO Luna | 16,3 s (64 tys. j., sam warp) | 125,8 s (163 tys. j.; dolot w studni Ziemi w strefie × 0,3) |
| hipercruise ręczny | 6000 j/s (start w strefie planety) | 20 000 j/s po 16 s, wyjście 5,7 s |
| przechwyt (rajder 30 km) | blokada masy po 2,7 s | blokada masy po 2,8 s |
| pipeline'y synchroniczne | 1 (`AsteroidBelt:rocksSmear`) | 1 (to samo — smugi skał pasa z `main`, nie E5) |

Dolot końcowy (~4 km od wyjścia z hipercruise'u) leci autopilot bojowy przy ~470 j/s (`createApproachCommand`) —
na krótkich odcinkach to on dominuje.

## Bramka bilansu (`scripts/bramka-bilansu.mjs`, ziarna 7 / 11 / 23)

| próg | przed (`main`) | po |
|---|---|---|
| przechwyty ≤ 15% (kursy z ładunkiem) | 5,9 / 5,8 / 5,8% | 6,0 / 6,3 / 5,9% |
| głód ≤ 30 min | 39,9 / 39,8 / 35,9 min | 39,7 / 37,2 / 37,8 min |
| stocznie ≤ 30 min | 0 min | 0 min |
| średnia kolejka ≤ 2 | 5,5 Saturn / 6,7 Uran / 7,7 Uran | 7,4 Uran / 8,0 Uran / 6,3 Saturn |
| tick ≤ 25 ms (orientacyjnie — kilka sesji naraz) | 40,2 / 38,0 / 39,0 ms | 23,4 / 25,4 / 31,2 ms |
| dostawy | 20 225 / 20 124 / 19 150 | 19 593 / 19 898 / 20 392 |

Symulacja, ziarno 7 — napęd kursów w locie na koniec: przed hipercruise 1078, warp 63, brama 3, konw. 20; po
hipercruise 965, warp 72, brama 2, konw. 27; szczyt kursów w locie 1410 → 1394; kolejka na redzie 37 → 18.
Warp Mk I haulerów (100 tys.) i procedura bramy 30 s nie zmieniają rachunku: masówka hipercruise'em, cenne warpem.
