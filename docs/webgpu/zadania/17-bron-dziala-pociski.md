# Zadanie 17 — Broń 1/2: działa i pociski z dema `bronie-webgpu` (wylot, pocisk, smuga, trafienie)
Zależności: 12, 04 | Równolegle z: 05–11, 13–16, 19 (bez zmian w `src/3d/fx/` z 12 — inaczej po kolei) | Zalecany effort: max
Zakres: z dema do gry (`src/3d/weapons/` albo `src/3d/fx/` — wspólny silnik cząstek): `gpuFx.js` (pule ADD / SPARK /
SMOKE / DEBRIS / DIST / ARC, paczki rozwijane w kernelu), `recipes.js` (receptury rodzin: `preFire`, `muzzle`,
`projectile`, `fly`, `impact`), `projectiles.js` (TYLKO render: 8 stylów w jednym draw callu), `trails.js` (smugi —
zastępuje `slugTrail3D.js` / `BulletTrails`). Wpięcie w grę: `WeaponShotBus`, `bullets`, `spawnBulletImpactEffect`
(`index.html`), Hexlance (`src/game/superweapon.js`), Yamato. Usunięcie starych: render pocisków i błysków w
`src/3d/weapon3DSystem.js` (wiązki zostają do 18), `slugTrail3D.js`, `muzzleFx3D.js`, `railgunFx3D.js`, fabryki trafień
w overlayu `railgunExplosion.js`, `armataImpact.js`, `autocannonImpact.js`, `yamato.js` i ich `window.trigger*3D`.

## Cel
Działa Capital / L / M / S (Yamato, Hexlance, Mjolnir, Valkyrie, Goliath, Ion Plasma Gatling, Armata, Tempest, Helios
bolt, Autokanony, Vulcan, Gatling) strzelają w grze efektami z dema (decyzja użytkownika 2026-09-27: „bronie — wszystkie
super”, wdrażać przy porcie). **Rozgrywka bez zmian:** strzał, lot, trafienie i obrażenia liczy gra jak dziś; demo
dostaje tylko zdarzenia gry.

## Przeczytaj najpierw
`agents.md` (Nośnik prędkości — cały akapit; Pociski, kolizje, efekty; HDR), `docs/webgpu/DEMO-BRONIE.md` w całości
(receptury, pasma HDR, § Port do gry, § Znalezione w grze), `docs/webgpu/PLAN.md` §3, §6, `docs/webgpu/POSTEP.md`
(wynik 12: siatka świateł, zniekształcenia, compute), `dema/bronie-webgpu.js` + moduły (grep: `RECIPES`, `GpuFx`,
`ProjectileSystem`, `TrailSystem`, `Gunnery` — jak demo woła receptury), `src/game/weaponShotBus.js`, w `index.html`
grep: `WeaponShotBus.emit`, `spawnBulletImpactEffect`, `bulletsAndCollisionsStep`, `trigger*3D`; `src/3d/weapon3DSystem.js`
(render pocisków i błysków, `BulletTrails.track`), `src/game/superweapon.js`, `src/vfx/turret2D.js` (lufy, `FX_PROFILE`),
testy: `weapon3DModelMaterials`, `turret2D`, `fighterCombatFixes`, `carrierVelocity`, `weaponShotBus`, `beamRenderPath`.

## Kroki
1. **Silnik cząstek** (`gpuFx`) do Core3D: pule jako siatki w passie ortho (warstwa 0, `renderOrder` z dema), paczki z
   `vel` nośnika (12), pozycje względem początku przy kamerze, krok compute z 12, pula DIST → zniekształcenia z 12,
   światła błysków → siatka świateł (12). Kolizje iskier / odłamków z kadłubami: demo ma 2 sloty SDF — w grze najpierw
   bez kolizji albo K najbliższych kadłubów w kadrze z pól odległości `HullShadowSdf` (te same kształty); zmierz.
2. **Wystrzał:** słuchacz `WeaponShotBus` (strzelec, broń, lufa) → `preFire` / `muzzle` receptury; lufy i kierunek z
   `Turret2D` (strzelec — tylko jego wieżyczki, test `fighterCombatFixes`). Wieżyczki zostają 2D (kwady 3D z dema —
   poza zakresem, decyzja użytkownika). Odrzut i wstrząs zostają z `FX_PROFILE` gry.
3. **Pociski i smugi:** co klatkę z tablicy `bullets` gry (pozycja z `SimClock`, znaczniki `ivx/ivy`, `clock`, `bornSim`)
   → `ProjectileSystem` (styl z broni) i `TrailSystem` (początek / przyrost / koniec smugi w cyklu życia pocisku).
   Symulacja pocisków z dema (240 Hz, trafienia w SDF, przebicia, rykoszety) NIE wchodzi.
4. **Trafienia:** `spawnBulletImpactEffect` → `impact` receptury; dołóż do wywołania trafioną encję i normalną
   powierzchni, jeśli gra je zna w `bulletsAndCollisionsStep` (informacja tylko dla efektu). Trafienia w tarczę zostają
   na `ShieldImpactFX` (14). Dziś zbędne po recepturach: iskry `SparkSystem3D.burst` przy trafieniu pocisku.
5. **Hexlance i Yamato:** `superweapon.js` (ładowanie, strzał, trafienie, rzaz — dziś `RailgunFX3D`) → receptura;
   `coreFx3D.js` woła `RailgunFX3D.impact` / `kerf` (dżety rdzeni, warsztat `rdzen-demo`) — przepnij na recepturę.
6. **Usunięcie starych modułów** z zakresu i ich rozgrzewki (`hexShips3D.js:2247`: `RailgunFX3D.prewarm`,
   `BulletTrails.prewarm`), fabryk w `startOverlay3D` (`index.html`) i próbek w `prewarmSamples`.
7. **Zdarzenia, których gra nie ma** (rykoszety, przebicie z wylotem, ładowanie Mjolnira — `chargeTime` nieczytane,
   `burstCount` Hexlance'a, pola `recoil` / `shake` / `impactScale` z `weapons.js`): nie dokładaj do rozgrywki —
   lista w raporcie do decyzji użytkownika; efekt wizualny tylko tam, gdzie gra daje zdarzenie.
8. **Harness:** scena `galeria-broni` w `zrzuty.mjs` (gracz / NPC strzela każdą rodziną w cel w stałym kadrze, ziarno
   sceny) — baza porównań dla przyszłych zmian = zatwierdzony obraz z `main` (nie tag — stare efekty są inne).
9. **Testy:** `weapon3DModelMaterials` (pasma HDR pocisków → nowe style), `turret2D` (klucze efektów → receptury),
   `carrierVelocity` (dym z lufy Fx3D → paczka z `vel`), `fighterCombatFixes`, `weaponShotBus`; nowe — receptura dla
   każdej broni z `MASTER_WEAPONS` (bez wiązek i PD — 18) istnieje.

## Pułapki
- Pasma HDR z dema (ponad progiem tylko jądra i krótkie błyski, ciała 0,3–1,3) — bez `pow` z ujemną podstawą.
- Emitery ciągłe `tempo·dt` zaokrąglaj losowo (inaczej 0 przy 144+ FPS — memory demo broni).
- Liczba pocisków w bitwie (setki) i trafień (~100/s) ≫ demo — budżety pul i LOD po rozmiarze na ekranie (dziś
  `impactFxScreenPx`, cooldowny) zostają; zmierz bitwę `--wydajnosc` przed/po.
- Zero alokacji per klatka i per strzał; nie zmieniaj liczby ani kolejności `Math.random` w logice gry.
- Bugi starych efektów (czarny błysk wylotowy, brak tekstur trafienia railguna, Valkyrie cyjanem — `DEMO-BRONIE.md`)
  znikają z usunięciem modułów — nie naprawiaj ich osobno.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (testy z kroku 9 przepisane z opisem).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/17`: zero błędów walidacji; sceny bez broni (warianty `__tlo`,
  `__planety`, sceny ringu) bez regresji względem poprzedniego przebiegu; `galeria-broni`, `bitwa`, `bitwa-blisko` —
  zrzuty obok zrzutów dema (`scripts/webgpu/bronie-demo.mjs --tryb zrzuty`, te same bronie) do oceny użytkownika.
- Bitwa `--wydajnosc`: `coreRenderMs` / `gpuFrameMs` / draw calle przed i po w raporcie; bez przestojów pierwszego
  strzału każdej broni.
- `INWENTARZ.md` (usunięte moduły), `POSTEP.md`, `agents.md` (Pociski / efekty: gdzie są receptury, jak dodać efekt
  broni); commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki broni (obrażenia, kadencja, rozrzut, zasięgi, trafienia) ani wieżyczek 2D.
- Nie przenoś wiązek, obrony punktowej, flaku (18) ani rakiet (19); nie ruszaj dema.

## Raport na koniec
Co zrobione; zrzuty gry obok dema dla każdej rodziny; wydajność bitwy przed/po; lista zdarzeń, których gra nie ma;
co zostało dla 18; pytania.
