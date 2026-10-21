# Napędy E5 — pomiary przed i po (2026-10-21)

Zadanie E5 z `docs/PLAN-ekonomia-rynki.md` (§ 3.4): jedna tabela napędów (`src/data/driveModes.js`), zwolniony gracz,
hipercruise, ruch v2 na nowych prędkościach. Stan i zasady — reguła `statek-gracza` (§ „Statek gracza”).

## Propozycja liczb (do akceptacji użytkownika)

| tryb | przed | po | uzasadnienie |
|---|---|---|---|
| BOJOWY Atlasa | 500 j/s | 500 j/s | parytet z NPC (jedna tabela lotu); zasięgi broni 2–7 km = 4–14 s dolotu, walka bez zmian |
| PRZELOT (biegi) | 750 / 1000 / 1250 / 1500 | 700 / 850 / 1000 / 1200 | PRZELOT to teraz lot lokalny (port, pas, szyk); 9-km kadr mija się w 7,5 s zamiast 6 s |
| dopalacz w walce | 1500 | 1000 | 3× limitu bojowego wyrywał Atlasa z zasięgu każdej broni w 3 s; 2× zostawia ucieczkę, ale nie teleport |
| dopalacz w PRZELOCIE | 3000 (szczyt w grze 3971) | 1800 | daleki lot przejmuje hipercruise; dopalacz ma tylko skrócić dolot |
| hipercruise (Atlas, Mk I) | — | 20 000 j/s, 0 → vmax 12 s, rozruch 4 s | odcinki `drive` TRAVEL TO: Luna, dolot do portu w studni, przelot przez pas |
| hipercruise Mk II / Mk III | — | 30 000 / 40 000 j/s | towary E8; szybszy silnik rozpędza się mocniej (×1,3 / ×1,6) |
| warp | 260 000 j/s | 260 000 j/s | bez zmian (nietykalny) |

Hipercruise jest ~13× wolniejszy od warpa i da się go przerwać (blokada masy 12 km, trafienie), warp nie.
Strefy jak w warpie: pas × 0,8, okolice planet × 0,3 (Mk I przy planecie: 6000 j/s).

## Gracz w grze (`node scripts/webgpu/napedy-gra.mjs`, czas gry, Atlas)

Baza = czysty `HEAD` (9d0e61fd) w osobnym worktree, przebiegi po kolei. Każdy etap startuje z tej samej pozycji
(`devTeleportTo`); kąty planet gra losuje przy starcie, więc Marsa i Jowisza porównuj po fazie `drive`.

| pomiar | przed | po |
|---|---|---|
| PRZELOT, W trzymane | 1500 j/s po 5,7 s | 1200 j/s po 4,6 s |
| BOJOWY + Shift | 1500 j/s po 3,5 s | 1000 j/s po 2,2 s |
| PRZELOT + Shift | 3061 j/s (limit 3000; w innym miejscu 3971 — limit był miękki) | 1800 j/s po 2,4 s (limit twardy) |
| TRAVEL TO 30 tys. j. (odcinek `drive`) | 65 s, szczyt 470 j/s | 13 s: rozruch 4 + hipercruise 6,3 + dolot 2,6; szczyt 7500 j/s |
| TRAVEL TO Luna | 201 s (160 tys. j.; `drive` 198 s) | 46 s (117 tys. j.; `drive` 26 s) |
| TRAVEL TO Jowisz | 83 s (2,68 mln j.; `drive` 53 s) | 53 s (2,58 mln j.; `drive` 20 s) |
| TRAVEL TO Mars | 105 s (2,21 mln j.; `drive` 80 s) | 20 s (0,34 mln j.; `drive` 12 s, odcinek < 12 km — PRZELOT) |
| hipercruise ręczny (O) | — | 20 000 j/s po 16 s (rozruch 4 + rozpęd 12), wyjście 4,9 s |
| przechwyt: rajder 30 km przed dziobem | — | blokada masy po 2,9 s, statek staje 5,5 km od rajdera |
| pipeline'y synchroniczne po starcie | 0 | 0 |

Przejście domyślnego kadru (9 km): PRZELOT 6 s → 7,5 s. Przelot przez pas główny (~470 tys. j.): PRZELOT
5,2 min → 6,5 min, z dopalaczem 2,6 → 4,4 min, hipercruise'em Mk I (strefa pasa × 0,8) ~35 s; warp bez zmian.
Dolot autopilota w PRZELOCIE trzyma ~470 j/s (`createApproachCommand`) — to on robił z odcinków `drive` minuty.

## Ruch v2 — czasy kursów (skrypt w scratchpadzie, `driveLegSeconds`)

| trasa | przed: konw. 800 / warp 20 tys. | po: hipercruise van Mk II / hauler Mk I / mega Mk I | po: warp 260 tys. |
|---|---|---|---|
| Ziemia→Mars w linii (0,33 mln j.) | 6,9 min / 17 s | 17 / 24 / 30 s | 5 s |
| Ziemia→Mars kąt prosty (1,75 mln) | 36,4 min / 87 s | 65 / 95 / 100 s | 11 s |
| Ziemia→Mars naprzeciw (2,45 mln) | 51 min / 2 min | 88 s / 2,2 / 2,3 min | 13 s |
| Ziemia→Jowisz w linii (1,06 mln) | 22,1 min / 53 s | 42 / 61 / 66 s | 8 s |
| Ziemia→Jowisz kąt prosty (2,37 mln) | 49,4 min / 2 min | 85 s / 2,1 / 2,2 min | 13 s |
| Ziemia→Jowisz naprzeciw (3,18 mln) | 66,3 min / 2,6 min | 112 s / 2,8 / 2,9 min | 16 s |
| Ziemia→pas (0,46 mln) | 9,6 min / 23 s | 22 / 31 / 36 s | 6 s |

Wycena (hauler 160 t, Ziemia→Mars 1,75 mln j.): hipercruise 415 CR + 29,5% × wartość, warp 2918 CR, brama 514 CR +
5,8% × wartość. Warp wygrywa od ~8,5 tys. CR ładunku (przed: ~8,3 tys.), brama — od ~0,4 tys. CR. Przechwyt liczy się
od DROGI (`interceptRatePerUnit` × dystans × ryzyko), więc stałe wyceny zostają: `interceptRatePerUnit` 2e-7,
paliwo warpa 1/60 000, brama 150 tys. j. (dolot hipercruise'em 15 s z każdej strony — brama wolniejsza od warpa dla
każdej klasy i pary hubów, strażnik w `scripts/tests/travelNetwork.test.mjs`).

## Symulacja `node scripts/symulacja-ruchu.mjs 240 1 4 60` (ziarna 7 / 11 / 23)

| | przed | po |
|---|---|---|
| wystawione przewozy | 12 773 / 12 682 / 12 582 | 18 755 / 18 860 / 18 680 |
| wyprawy górnicze | 840 / 757 / 750 | 1950 / 1895 / 2012 |
| dostarczone (= cumowania rozładunku) | 8274 / 8327 / 8165 (~2070 / h) | 17 279 / 17 385 / 17 362 (~4330 / h) |
| przechwycone (% rozstrzygniętych) | 5611 (40%) / 5718 (41%) / 5717 (41%) | 7001 (29%) / 7086 (29%) / 7145 (29%) |
| skuteczność dostaw | 60,8 / 62,0 / 61,2% | 83,5 / 83,8 / 83,9% |
| kursy w powietrzu: szczyt | 4971 / 5063 / 4962 | 1474 / 1457 / 1460 |
| kolejka na redzie na koniec | 21 / 99 / 77 | 242 / 289 / 228 |
| rajdy piratów / zrabowane | 55–58 / ~1,95 mln CR | 57–58 / 3,9–4,3 mln CR |
| napęd kursów w locie na koniec | konw. ~4000, warp ~75, brama ~140 | hipercruise ~1200, warp ~72, brama ~100, konw. ~30 (manewry) |
| koszt ticku (pierwszy przebieg) | 21,8 / 23,8 / 22,6 ms | 24,2 / 35,4 / 37,0 ms |
| koszt ticku A/B po kolei (11, 23) | 23,2 / 22,9 ms | 25,2 / 32,4 ms |

Wnioski:
- Kursy krótsze ~20–25× → 3,4× mniej statków w powietrzu, 2× więcej dostaw; rachunek napędów bez zmian (masówka
  hipercruise'em, cenne warpem, pod presją brama).
- Wąskim gardłem są teraz PORTY: kolejki na redzie ×3–10. Postój (`dockServiceSeconds` 90 s, załadunek, manewr 70 s)
  trwa dziś dłużej niż sam lot.
- Piractwo: odsetek przechwyceń spada z 40% do 29% (więcej kursów krótkich, konwoje), ale łup rośnie 2× razem z obrotem.
  Hipercruise da się przerwać (ryzyko 1), warpu nie — piractwo żyje na odcinkach hipercruise'u i dolotach bram.
- Koszt ticku rośnie mimo 3× mniej kursów: 26% czasu zjada `nextShipmentOrderId` (`src/game/cargoFleet.js:332` — przy
  każdym zleceniu buduje `Set` ze WSZYSTKICH zleceń; koszt rośnie kwadratowo z liczbą dostaw). Bramka 25 ms wymaga
  naprawy tam (plik E4 / E2) albo strojenia przepływu.

## Bramka bilansu E4 (`scripts/bramka-bilansu.mjs` z cf5b56e3, ziarna 7 / 11 / 23, po kolei)

Obie wersje nie zaliczają bramki (baza też nie); progi z `docs/PLAN-ekonomia-rynki.md` § 5. Na maszynie pracowało
5 sesji naraz — czas ticku orientacyjnie.

| próg | baza (9d0e61fd) | E5 |
|---|---|---|
| przechwyty ≤ 15% | 40,4 / 40,7 / 41,2% | 28,8 / 29,0 / 29,2% |
| głód ≤ 30 min | 240 min, 35 / 35 / 35 pozycji | 240 min, 33 / 32 / 32 pozycji |
| stocznie ≤ 30 min | 240 min (Merkury, Wenus, Saturn, Uran, Westa) | to samo (Wenus 234 min w ziarnie 11) |
| średnia kolejka ≤ 2 | 6,0 Westa / 12,9 Saturn / 4,8 Westa | 63,3 / 65,6 / 62,1 — Saturn |
| tick przy szczycie ≤ 25 ms | 26,7 / 18,5 / 23,5 ms | 48,3 / 42,8 / 44,7 ms |

- Saturn (26 stanowisk, w bazie zajęte 25) nie nadąża z 2× większym obrotem — średnia kolejka ×5–10.
- Tick mierzy bramka przy ≥ 90% szczytu kursów; w E5 szczyt przypada na koniec biegu, kiedy lista zleceń jest
  najdłuższa — kwadratowy `nextShipmentOrderId` (`src/game/cargoFleet.js:332`, 26% profilu) waży tam najwięcej.
- Głód i stocznie bez zmian: to braki struktury (stocznie bez podzespołów — zadanie E4/E8), nie prędkości.
