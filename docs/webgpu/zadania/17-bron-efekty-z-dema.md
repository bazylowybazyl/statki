# Zadanie 17 — Broń 1/2: efekty wszystkich broni z dema `bronie-webgpu` (wylot, pocisk, smuga, trafienie, wiązki, PD, flak)
Zależności: 12, 04 | Równolegle z: 05–11, 13–16, 19 (bez zmian w `src/3d/fx/` z 12 — inaczej po kolei) | Zalecany effort: max
Zakres: z dema do gry (`src/3d/weapons/`; wspólny silnik cząstek może iść do `src/3d/fx/`): `gpuFx.js` (pule ADD /
SPARK / SMOKE / DEBRIS / DIST / ARC, paczki rozwijane w kernelu), `recipes.js` (receptury rodzin: `preFire`, `muzzle`,
`projectile`, `fly`, `impact`), `projectiles.js` (TYLKO render: 8 stylów w jednym draw callu), `trails.js` (smugi —
zastępuje `slugTrail3D.js` / `BulletTrails`), `beams.js` (wiązka ciągła, pulsacyjna, laser PD). Wpięcie w grę:
`WeaponShotBus`, `bullets`, `spawnBulletImpactEffect` (`index.html`), wiązki (dziś `Weapon3DSystem._triggerBeamFx`),
Hexlance (`src/game/superweapon.js`), Yamato, flak (`src/vfx/flakBurstVfx.js`, dziś kanwa 2D), laser PD (dziś tylko
kanwa 2D). Usunięcie starych: `src/3d/weapon3DSystem.js` (cały), `slugTrail3D.js`, `muzzleFx3D.js`, `railgunFx3D.js`,
fabryki trafień w overlayu `railgunExplosion.js`, `armataImpact.js`, `autocannonImpact.js`, `yamato.js` i ich
`window.trigger*3D`, `FlakBurstVFX` i ścieżka kanwy lasera PD.

## Cel
Wszystkie 27 broni z dema — działa Capital / L / M / S (Yamato, Hexlance, Mjolnir, Valkyrie, Goliath, Ion Plasma
Gatling, Armata, Tempest, Helios, Autokanony, Vulcan, Gatling), wiązki, obrona punktowa (CIWS, Helios PD, flak) —
strzelają w grze efektami z dema (decyzja użytkownika 2026-09-27: „bronie — wszystkie super”). W tym zadaniu strona
BRONI (wylot, lot, smuga, trafienie, wiązki); strona KADŁUBA (mapa ran, przebicia, rykoszety, oświetlenie poszycia) i
mechanika z dema — zadanie 18. Strzał, lot, trafienie i obrażenia liczy gra jak dziś.

## Przeczytaj najpierw
`agents.md` (Nośnik prędkości — cały akapit; Pociski, kolizje, efekty; HDR), `docs/webgpu/DEMO-BRONIE.md` w całości
(receptury, pasma HDR, § Port do gry, § Znalezione w grze), `docs/webgpu/PLAN.md` §3, §6, `docs/webgpu/POSTEP.md`
(decyzje, wynik 12: siatka świateł, zniekształcenia, compute), `dema/bronie-webgpu.js` + moduły (grep: `RECIPES`,
`GpuFx`, `ProjectileSystem`, `TrailSystem`, `BeamSystem`, `Gunnery` — jak demo woła receptury), `src/game/weaponShotBus.js`,
w `index.html` grep: `WeaponShotBus.emit`, `spawnBulletImpactEffect`, `bulletsAndCollisionsStep`, `trigger*3D`,
`spawnLaserBeam`, `render3dOnly`; `src/3d/weapon3DSystem.js`, `src/game/superweapon.js`, `src/vfx/turret2D.js` (lufy,
`FX_PROFILE`), `src/vfx/flakBurstVfx.js`; testy: `weapon3DModelMaterials`, `turret2D`, `fighterCombatFixes`,
`carrierVelocity`, `weaponShotBus`, `beamRenderPath`, `pulseBeamPoolLimit`, `pdBeamFastPath`, `flakSystem`.

## Kroki
1. **Silnik cząstek** (`gpuFx`) do Core3D: pule jako siatki w passie ortho (warstwa 0, `renderOrder` z dema), paczki z
   `vel` nośnika (12), pozycje względem początku przy kamerze, krok compute z 12, pula DIST → zniekształcenia z 12,
   światła błysków → siatka świateł (12). Kolizje iskier / odłamków z kadłubami: demo ma 2 sloty SDF — w grze najpierw
   K najbliższych kadłubów w kadrze z pól odległości `HullShadowSdf` (te same kształty) albo bez kolizji; zmierz.
2. **Wystrzał:** słuchacz `WeaponShotBus` (strzelec, broń, lufa) → `preFire` / `muzzle`; lufy i kierunek z `Turret2D`
   (tylko wieżyczki strzelca — test `fighterCombatFixes`). Wieżyczki zostają 2D (kwady 3D z dema — poza zakresem).
3. **Pociski i smugi:** co klatkę z tablicy `bullets` gry (pozycja z `SimClock`, znaczniki `ivx/ivy`, `clock`, `bornSim`)
   → `ProjectileSystem` (styl z broni) i `TrailSystem` (początek / przyrost / koniec smugi w cyklu życia pocisku).
   Symulacja pocisków z dema (240 Hz, trafienia w SDF) NIE wchodzi — mechanikę przebić i rykoszetów robi 18 w logice gry.
4. **Trafienia:** `spawnBulletImpactEffect` → `impact` receptury; dołóż trafioną encję i normalną powierzchni (znane w
   `bulletsAndCollisionsStep` — tylko dla efektu). Trafienia w tarczę zostają na `ShieldImpactFX` (14). Iskry
   `SparkSystem3D.burst` przy trafieniu pocisku — zastąpione iskrami receptur.
5. **Wiązki:** `BeamSystem` — ciągła (płynąca plazma, pakiety energii, cięcie burty ze stopionym rowem), pulsacyjna,
   laser PD; barwy z danych broni (dziś zaszyte); limit równoczesnych jak dziś (test `pulseBeamPoolLimit` →
   odpowiednik). Laser PD i pęknięcia flaku przechodzą z kanwy 2D do 3D (decyzja o nowych efektach) — wyłącz ścieżki
   kanwy i przepisz testy (`beamRenderPath` „point-defence laser keeps its canvas-only beam path”) z opisem decyzji.
   Koszt PD w bitwie (tysiące wiązek/s — audyt bitwy §2.2): jeden draw call, zero alokacji na strzał.
6. **Hexlance, Yamato, Tempest:** `superweapon.js` (ładowanie, strzał, trafienie, rzaz — dziś `RailgunFX3D`) →
   receptura; łuki EMP Tempesta po kadłubie z końcami na poszyciu (punkty z `HullBodies.probe`); `coreFx3D.js` woła
   `RailgunFX3D.impact` / `kerf` i `MuzzleFX3D` (warsztat `rdzen-demo`) — przepnij na receptury.
7. **Usunięcie starych modułów** z zakresu, ich rozgrzewki (`hexShips3D.js:2247`: `RailgunFX3D.prewarm`,
   `BulletTrails.prewarm`), fabryk w `startOverlay3D` (`index.html`) i próbek w `prewarmSamples`.
8. **Harness:** scena `galeria-broni` w `zrzuty.mjs` (gracz / NPC strzela każdą rodziną, wiązkami, PD i flakiem w cel w
   stałym kadrze, ziarno sceny) — baza porównań dla przyszłych zmian = zatwierdzony obraz z `main` (nie tag).
9. **Testy:** `weapon3DModelMaterials` (pasma HDR → nowe style), `turret2D` (klucze efektów → receptury),
   `carrierVelocity` (dym z lufy → paczka z `vel`), `fighterCombatFixes`, `weaponShotBus`, `beamRenderPath`,
   `pulseBeamPoolLimit`; nowe — receptura dla każdej broni z `MASTER_WEAPONS` istnieje.

## Pułapki
- Pasma HDR z dema (ponad progiem tylko jądra i krótkie błyski, ciała 0,3–1,3) — bez `pow` z ujemną podstawą.
- Emitery ciągłe `tempo·dt` zaokrąglaj losowo (inaczej 0 przy 144+ FPS — memory demo broni).
- Liczba pocisków (setki) i trafień (~100/s) w bitwie ≫ demo — budżety pul i LOD po rozmiarze na ekranie (dziś
  `impactFxScreenPx`, cooldowny) zostają; zmierz bitwę `--wydajnosc` przed/po.
- Zero alokacji per klatka i per strzał; nie zmieniaj liczby ani kolejności `Math.random` w logice gry.
- Bugi starych efektów (czarny błysk wylotowy, brak tekstur trafienia railguna, Valkyrie cyjanem — `DEMO-BRONIE.md`)
  znikają z usunięciem modułów — nie naprawiaj ich osobno.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (testy z kroku 9 przepisane z opisem).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/17`: zero błędów walidacji; sceny bez broni (warianty `__tlo`,
  `__planety`, sceny ringu) bez regresji względem poprzedniego przebiegu; `galeria-broni`, `bitwa`, `bitwa-blisko` —
  zrzuty obok zrzutów dema (`scripts/webgpu/bronie-demo.mjs --tryb zrzuty`, te same bronie).
- Bitwa `--wydajnosc`: `coreRenderMs` / `gpuFrameMs` / draw calle przed i po; bez przestojów pierwszego strzału.
- W kodzie gry nie ma już `weapon3DSystem.js`, `slugTrail3D.js`, `muzzleFx3D.js`, `railgunFx3D.js` ani fabryk trafień
  overlaya; commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki broni w tym zadaniu (obrażenia, kadencja, rozrzut, zasięgi, trafienia) — mechanika z dema to
  zadanie 18; wieżyczki zostają 2D.
- Nie przenoś rakiet (19); nie ruszaj dema.

## Raport na koniec
Co zrobione; zrzuty gry obok dema dla każdej rodziny; wydajność bitwy przed/po; co zostało dla 18; pytania.
