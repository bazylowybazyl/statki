# Projekt integracji broni z dema WebGPU (zadania 17 i 18)

> Opracowane 2026-09-27 (podagent-architekt, stan `main` 90fcdb0) jako materiał dla wykonawców zadań
> `zadania/17-bron-efekty-z-dema.md` i `zadania/18-bron-obrazenia-z-dema.md`. Ścieżki od katalogu repo; numery linii —
> stan z tego dnia (po zadaniach 01–04 mogą się przesunąć — szukaj grepem po nazwach). Decyzje z §5 podjął
> orkiestrator w imieniu użytkownika (śpi; „wierzę, że poprawnie to zrobisz”) — do przejrzenia rano.

## 0. Ustalenia z kodu, które zmieniają założenia zadań

1. **Obrona punktowa gracza nie przechodzi przez szynę strzałów.** `ciwsStep` (`index.html:18266`) sam tworzy pociski
   CIWS (`fireCIWSGun` 18408), strzały lasera (`firePointDefenseLaser` 18450, zestrzelenie rakiety 18376–18398) i salwy
   flaku (`fireFlakSalvo` 18485) i rysuje efekty na kanwie (`spawnLaserBeam`, `spawnPointDefenseLaserMuzzle` / `…Hit`
   18633/18653, `spawnFlakMuzzle` 18535, `spawnParticle` 18438). Przez `fireWeaponCore` (8962) i `WeaponShotBus` idzie
   tylko PD NPC, a laser PD NPC nie niesie danych wiązki w zdarzeniu (`if (!pdBeam)` 8995).
2. **Usunięcie `src/3d/weapon3DSystem.js` zabiera trzy obowiązki spoza broni** — trzeba je przenieść:
   - jedyne wywołanie `Fx3D.update(dt)` (1171) — bez niego stają iskry dysz MAIN, mostki, rdzenie;
   - zapis `window.__weapon3dCameraShake` (1129–1144) — czyta `index.html:23314`, pilnuje test `fighterCombatFixes`;
   - znacznik `bullet.__renderedByThree` (1210/1213) — czyta fizyka (`index.html:19618`, smugi kanwy plazmy i
     autokanonów) i rysowanie kanwy (23957).
3. **Pule dema łamią regułę nośnika.** Paczka dodaje `vel` do prędkości WŁASNEJ (`gpuFx.js:331`: `v = d·speed + b10`),
   a kernele iskier / dymu / odłamków tłumią całe `v` (482, 499, 519) — dym z lufy pędzącego okrętu zostawałby w tyle
   (łapie to test `carrierVelocity`: opór hamuje tylko ruch własny). Nośnik = osobny człon cząstki:
   `p = p_własne(t) + v_c·(T_zegar − t0)` z flagą zegara (wzór: `src/3d/fxParticles3D.js:273–281`,
   `src/3d/slugTrail3D.js:18–24, 255–262`). To samo dla smug dema (segment w `trails.js` bez nośnika) i długości pocisku
   (`projectiles.js:302–307` z |v| bezwzględnego — w grze smuga = ruch względem strzelca, `v − (ivx, ivy)`, jak
   `weapon3DSystem.js:1223–1226`).
4. **Receptury dema do przeróbki:** `Math.random` w `E()` (`recipes.js:37`), `rand`, `ricochet`, `hullArcs`, wtórnych
   wybuchach Yamato, `hexCharge`, `FxHull.stamp` (`hull.js:433`), `TrailSystem.begin` (`trails.js:185–186`),
   `FxLights.flash` (`fxLights.js:29`); alokacje na wywołanie (literał opcji i tablice `rng` w każdym `E()`,
   `scenePos(x, y, {})`, `off/rot/neg/perp/reflect` zwracają nowe obiekty, `lights.flash(…, {decay…})`); domknięcia w
   `ctx.after` (tempest 213, 256, 301; yamato 502); globalny stan ładowania `ctx._chargeT` (`recipes.js:592`) — w grze
   jeden na wszystkie działa; `beamP.impact` / `laserPD.impact` mają sygnaturę `(ctx, hull, hit)` bez `p`.
5. **Demo ma mniej mechaniki, niż zakładało zadanie 18:** `burstCount` czyta tylko salwa flaku (`gunnery.js:257`);
   Hexlance w demie strzela pojedynczo po 1,2 s ładowania (`arsenal.js:44`); `requiresStationary` nieczytane; pola
   `recoil` / `shake` / `impactScale` z `weapons.js` nieczytane (odrzut z kopii `FX_PROFILE`, `arsenal.js:21–31`,
   wstrząs z `ctx.shake`); rykoszet jest kosmetyczny (`noHit: true`, `recipes.js:352–356`); przebijają tylko Hexlance
   i Mjolnir (`pen: 1e6`, `speedLoss: 0`) oraz Valkyrie (`pen: 260`, `speedLoss: 0.35`); ładowanie Valkyrie 0,28 s tylko
   w demie (`arsenal.js:46`). „Serie Hexlance'a” i „jedno źródło odrzutu” trzeba zaprojektować w grze (§2.5–2.6, §5).
6. **Domyślne uzbrojenie NPC niczego nie przebija** (piraci: `armata_mk1`, `ciws_mk1`, `missile_rack`; Terra Nova:
   `railgun_mk2`, `laser_pd_mk1`, `missile_rack` — `index.html:9313–9320`; skrzydło wsparcia `heavy_autocannon`,
   `helios_laser`, `railgun_mk1`, `vulcan_minigun` + flak, 7382–7433). Przebicia dotyczą gracza (sloty special),
   rykoszet — Vulcana pancernika wsparcia (7431) i Vulcana / Gatlinga gracza.
7. **Hexlance** porusza się i tnie raz na klatkę renderu (`index.html:22482`, `superweapon.js:332–433`), nie zadaje HP —
   HP spada przez sufit strukturalny (`index.html:19304–19321`, `ratio^2,2`).
8. **UV skóry belek = indeksy siatki** (`beamSpriteSkin2D.js:37–47`; `beamHullSkin.js:27–28` odwraca v: v = 0 to górny
   wiersz obrazu). Odłam dostaje `dims` i `spriteSkin` rodzica (`destructorBeams3D.js:2323–2331`), węzły zachowują
   `ix/iy` — wrak z `convertToWreck` (to samo ciało) i odłamy z `onWreck` leżą w przestrzeni uv rodzica. Mapa ran
   dziedziczy się przez wspólną warstwę pod kluczem rodu, bez kopiowania.
9. **Harness:** stare efekty kanwy wołane z fizyki zużywają `Math.random` (`FlakBurstVFX.spawn` `flakBurstVfx.js:178–227`,
   `spawnPointDefenseLaser*`, `spawnFlakMuzzle`, `spawnBulletTrail` `index.html:19496–19502`, `_updateCameraShake`
   `weapon3DSystem.js:1142`) — ich usunięcie zmienia sekwencję losowań w walce: `bitwa` i kolejne sceny sesji `kosmos`
   (`scripts/webgpu/zrzuty.mjs:201`) rozjadą się z poprzednim przebiegiem (`H.reseed` przed krokami walki). Sceny przed
   `bitwa` bez zmian. Nowy kod efektów ma własny generator (np. `src/3d/fx/fxRandom.js`, mulberry32), nie `Math.random`.

## 1. Mapa zdarzeń gry → receptury

### 1.1 Fasada `WeaponFx` i adapter `ctx`

Jeden moduł `src/3d/weapons/weaponFx.js` (`WeaponFx`) przyjmuje zdarzenia gry; receptury (`src/3d/weapons/recipes.js`)
dostają adapter `ctx`:

| `ctx` w demie | W grze |
|---|---|
| `fx.<pula>` | pule z członem nośnika: `WeaponFx` ustawia `ActiveCarrier` przed recepturą (jak Fx3D), `E()` kopiuje do paczki `vx, vy, t0, clock` (BSTRIDE 12 → 13); pozycje względem początku przy kamerze (12) |
| `lights.flash/point` | źródła świateł z 12, argumenty pozycyjne zamiast obiektu opcji, tylko w kadrze (`CAP` 512, `LIGHT_CAP` 1536) |
| `after(delay, fn)` | pula rekordów `{t, kind, a0…a5}` na zegarze efektów — bez domknięć |
| `shake(mag, dur)` | jeden zlew wstrząsu (strzelec = gracz / P2 albo punkt w kadrze) → `window.__weapon3dCameraShake.mag`, sufit 18 (jak `weapon3DSystem.js:1122`) |
| `stamp(...)` | w 17 pusty zlew (wywołania w recepturach zostają); w 18 → `HullDamageMap` (§3) |
| `burn(hull, …)` | płonąca wyrwa w układzie kadłuba (encja + przesunięcie lokalne z pozy trafienia, pozycja z pozy renderu co klatkę; demo trzyma ją w świecie, `gunnery.js:101–105`) |
| `spawnProjectile` (rykoszet) | kosmetyczna lista w `ProjectileSystem`, nigdy `window.bullets` |
| `hull.inside()` w `hullArcs` | `HullBodies.probe(entity, x, y)` — tylko odczyt |

Porządki przy porcie: barwy wiązek z `vfxColor` przez `hexHdr` (`arsenal.js:97`) z parserem `rgba(...)` dla
`laser_pd_mk1`; `p.power = SIZE_POWER[b.weaponSize]`; szerokość pocisku × `WEAPON_TIER_SCALE[tier].bullet`
(`weapon3DSystem.js:1235–1240`); LOD błysku i budżet na klatkę jak `MuzzleFX3D.fire` (`muzzleFx3D.js:399–429`);
bramki trafień `impactFxScreenPx` / `impactFxCooldownReady` (`index.html:9816–9863`) zostają.

### 1.2 Zdarzenia

| # | Zdarzenie | Gdzie | Dostępne | Brakuje recepturze | Jak dostarczyć bez zmiany rozgrywki |
|---|---|---|---|---|---|
| A | strzał pociskiem (gracz, P2, NPC) | `index.html:8886` → pocisk 9116–9164, szyna 9174–9182 | `weaponId`, `shooter`, wylot x/y; w `muzzleData`: `dir`, `baseVel`, `emitterUid` (`weaponController.js:20–25, 236–250`; `index.html:9346–9389`) | `m = {x, y, angle, scale}`, opis broni `w`, nośnik | `Turret2D.triggerShot(normalizeWeaponFxKey(id), x, y, shooter)` (`turret2D.js:816–882`) daje `m` dema + odrzut; nośnik `writeCarrier(shot.entity, x, y, true)` (`weapon3DSystem.js:1114`); bez rekordu wieżyczki (myśliwiec) i w kadrze → fallback z `detail` (dopisać na końcu `emit` `dirX, dirY` — test szyny sprawdza początek argumentów); poza kadrem nic; `w` z `src/3d/weapons/weaponFxTable.js` (port `arsenal.js:40–88`) |
| B | wiązka ciągła | 8958–9074 (`beam_continuous`, 20 Hz) | start, koniec, `emitterUid`, `mode` w `_beamEventScratch` (8635, 8997–9006); `hitEntity` lokalnie (8967) | punkt i normalna trafienia, kadłub, moc `beamOn` co klatkę | do scratcha `hitEntity`, `nx, ny`, `kind`; normalna `HullBodies.surfaceNormal` przed `applyHexImpact` (9026); stan na `emitterUid` jak `_continuousBeamActive` (`weapon3DSystem.js:931–1013`), rampa +8/s i −3,2/s; co klatkę `BeamSystem.add` + `beamC.emit(ctx, m, hit, beamOn, dt, hull)`; początek z `Turret2D.findTurretKey/resolveMuzzle` (892–943); encja najwyżej 0,55 s |
| C | wiązka pulsacyjna | jak B (`beam_pulse`) | jak B | `m`, trafienie | pierścień impulsów (≥ 512) z nośnikiem strzelca (jak `pulse.cvx…` 1025–1029); `beamP.impact` z kolejki `after` po `dist/42000` s — sam obraz |
| D | laser PD NPC | 8962–8993 | ścieżka kanwy `spawnLaserBeam` (8991); brak danych w szynie (8995) | wszystko | wypełnić `_beamEventScratch` także dla PD (`kind: 'pd'`), usunąć gałąź kanwy 8982–8993, `laserPD.muzzle/impact` |
| E | PD gracza | `ciwsStep` 18266–18406 | podstawa, `gun.angle`, `baseVel`, cel | `m`, receptury | w `fireCIWSGun`, `firePointDefenseLaser`, gałęzi rakiety 18377–18397 i `fireFlakSalvo`: `Turret2D.triggerShot(key, muzzle.x, muzzle.y, ship)` (rekordy `p_aux` są, `turret2D.js:776–797`) → `WeaponFx.muzzle / pdLaser` |
| F | pocisk w locie | co klatkę `src/3d/hexShips3D.js:2545` (`Weapon3DSystem.syncProjectiles`) | `x, y, vx, vy, ivx, ivy, clock, bornSim, age, life, vfxKey, type, weaponSize, color, source` | styl, stan (`flyAcc`, uchwyt smugi, ziarno), początek smugi | `WeaponFx.sync(bullets)`; styl po `vfxKey`, fallback po `type` (`rail`→tempest, `ciws`, `flak`, `autocannon`, `plasma`→helios, `armata`, brak→vulcan); `rocket`/`torpedo`/`forceCanvas` → `__renderedByThree = false` (kanwa do 19); stan w `bullet.__fx` z puli; pozycja `x − v·lag` dla `CLOCK_RENDER` (1201, 1217); początek smugi `x − v·age`; `fly()` i światła tylko w kadrze |
| G | trafienie w kadłub | `bulletsAndCollisionsStep` 19878–19911 | `hitX, hitY`, `hitNPC` (proxy lub `_realEntity`), `hitCarrier`, `_impactRelVel` (19885–19887) | normalna, kadłub, dane krateru | przed `applyHexImpact` (19892) `HullBodies.surfaceNormal(...)` do scratcha `_impactHit`; `spawnBulletImpactEffect(b, hitX, hitY, 1.0, _impactHit)` (19906) — piąty argument; w recepturze `p.vx/vy = _impactRelVel` |
| H | asteroida, płyta ringu, stacja, platforma | 19940–19947, 19956–19960, 19979, 20002 | punkt | normalna | promieniowo od środka obiektu; płyta ringu — oś płyty; `hull = null` = bez stempla |
| I | zestrzelona rakieta | 19706–19708, 18382–18384, 18612 | `rb` | — | do 19 mały `blast` (`droneBlast`, `recipes.js:971`) z nośnikiem `rb.ivx/ivy` |
| J | pęknięcie flaku | `detonateFlakShell` 18563–18629; trafienie bezpośrednie 19820–19827 | punkt, `flakBurstRadius`, `ivx/ivy` | — | `RECIPES.flak.burst(ctx, x, y, R)` zamiast `FlakBurstVFX.spawn` (18623) i dokładanej armaty (18624–18626); nośnik jak 18622; trafienie w kadłub → `flak.impact` |
| K | Hexlance | `superweapon.js`: ładowanie 284–306, kolejka 314–331, strzał 193–239, lot i cięcie 332–433 | `getMuzzlePos`, nośniki, `cutSegment` + `hullSweepResult` | stan ładowania na działo, zdarzenie wyjścia z kadłuba | `WeaponFx.hexlance.{charge, fire, beginSlug/stepSlug/endSlug, impact, kerf, exit}` w miejscach wywołań `RailgunFX3D` (import w linii 6); wyjście = pierwszy krok, gdy `cutSegment` dla celu z `bitten` zwraca 0, punkt = ostatni rzaz; `hexImpact` z kierunkiem lotu |
| L | Yamato | `queueSalvoBarrels` (`weaponController.js:82–111`), `index.html:9188–9204` | każda lufa = `fireWeaponCore` | — | jak A, F, G; `burn` w układzie kadłuba |
| M | Tempest (`leadIn` 0,03 s) | — | — | 30 ms przed strzałem | `preFire` i `muzzle` w chwili strzału, cewki po 0/9/18 ms (prawdziwe wyprzedzenie tylko dla gracza z podglądu `rail.queue`, `weaponController.js:274–279` — opcja) |
| N | Mjolnir, Valkyrie | dziś zwykłe pociski | — | ładowanie, `kerf/exit/stuck` | w 17 wylot, lot, trafienie; ładowanie i przebicie w 18 |
| O | warsztat rdzeni | `src/3d/coreFx3D.js:855–1011` | — | — | przepiąć na `WeaponFx` (zadanie 17, krok 6) |

**Do usunięcia w 17 poza listą zadania:** błyski kanwy w obu kopiach `fireRailBarrel` (`weaponController.js:314–336`,
`index.html:18215–18237`, dziś bramkowane `MuzzleFX3D.handles`); `impactFx('beam', …)` (`index.html:9068–9073`);
`SparkSystem3D.burst` w `spawnBulletImpactEffect` (9897–9906; sam `SparkSystem3D` zostaje do 19 dla zderzeń);
`CanvasVFX.spawnProjectileImpact3D` (`canvasParticleSystem.js:293–322`) staje się martwy (woła `trigger*3D` przez
`window.x &&`) — posprząta 24.

## 2. Mechanika z dema → logika gry na belkach (zadanie 18)

### 2.1 Jak liczy demo
- **Przebicie** (`projectiles.js:238–271`): raycast w SDF w podkrokach 240 Hz; `impact` zwraca wynik; `penLeft > 0` →
  pocisk wchodzi (`inside`); w środku `penLeft −= odcinek`, rzaz co `kerfStep` (22 j.), hamowanie `v·exp(−speedLoss·6·h)`
  (211–215); wyjście poza sylwetką, zakleszczenie przy `penLeft ≤ 0` albo `|v| < 300`. Przy 15 000 j/s hamowanie ≈ 2% na
  160 j.; Valkyrie staje na budżecie 260 j., nie na prędkości.
- **Rykoszet** (`recipes.js:344–357`): `dn = kierunek·normalna`; brak przy `dn < −0,42` (kąt od normalnej < ~65°) albo
  losowaniu > 0,6; nowy pocisk `noHit` z prędkością ×0,35–0,6; tylko rodzina `vulcan`.
- **Ładowanie** (`gunnery.js:322–339`): licznik rośnie przy wciśniętym spuście i błędzie celowania < 0,08; strzał przy
  błędzie < 0,03; co klatkę `R.charge(ctx, m, u, dt)`.

### 2.2 Nowe zapytania `HullBodies` (tylko odczyt, bez `Math.random`, `src/game/hullBodies.js`)
```js
// Normalna na zewnątrz w punkcie trafienia: gradient zajętości żywych węzłów w oknie ±2 komórek (D._latticeIndex)
// wokół węzła; fallback = −kierunek pocisku. Wołać PRZED impact() (krater zabija węzły).
surfaceNormal(entity, x, y, dirX, dirY, out)          // → out {nx, ny, node}
// Przejście przez materiał wzdłuż odcinka: marsz co cellSize/2 z probeLocal2D.
traceThrough(entity, x0, y0, x1, y1, radius, out)     // → out {solidLen, entryT, exitT (−1 = dalej w środku)}
// UV sprite'a w konwencji skóry: cx = ix + 0,5 + (lRest − ox)/cs, u = cx·pitch/W, v = (ny − cy)·pitch/H (spriteSkin).
spriteUvAt(entity, x, y, nodeHint, out)               // → out {u, v, ok}
```
`impact()` i `cutSegment()` wypełniają współdzielony `hullImpactResult = {hit, killed, radius, node, u, v, dmgKey}`
(`killed` = różnica `activeNodes` przed/po; uv przed `D.applyImpact`; indeksy węzłów ważne do rozpadu w następnym
kroku, `destructorBeams3D.js:1684–1686`). `hull.dmgKey` — kolejny numer w `createHull` (rekord 280–307), kopiowany w
`makeWreckEntity` z `parentHull.dmgKey` (1196–1222) → obejmuje `convertToWreck`, `onWreck`, `shatter`. Opcjonalny hak
`HullBodies.onImpact` (domyślnie `null`) — dla wybuchów rakiet (19).

### 2.3 `src/game/projectileMechanics.js` i pola danych
Nowe pola w `weapons.js` (istniejące `penetration` = limit liczby przebitych kadłubów):
```
siege_railgun:            penDepth: Infinity, penSpeedLoss: 0     (penetration: 10)
special_valkyrie_railgun: penDepth: 260,      penSpeedLoss: 0.35  (penetration: 3)
vulcan_minigun, gatling_s: ricochet: { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 }
```
- `resolveHullHit(b, def, normal, relVel, node) → 'stop' | 'ricochet' | 'penetrate'`; rykoszet:
  `hash01(b.serial, node) ≤ chance`, `b.serial = ++_projectileSerial` w `fireWeaponCore` (9116) — bez losowania;
  przebicie: `b.pen = { entity, left, count, v0, dmg0 }`.
- `stepInsideHull(b)` po `stepProjectileKinematics` (19615): `traceThrough` → `left −= solidLen`, hamowanie po drodze
  (`t = len/|v|`), zdarzenie `kerf`, potem `exit` albo `stuck`; po wyjściu `damage = dmg0·(|v|/v0)²·(left/penDepth)`
  (przy nieskończonym `penDepth` bez ostatniego czynnika).
- Wpięcie w `bulletsAndCollisionsStep`: pętla kandydatów (19741–19815) pomija `b.pen.entity`; gałąź trafienia w kadłub
  (19878–19911) bierze decyzję z `resolveHullHit` zamiast `shouldRemoveProjectileAfterImpact` (gałąź „rail w coś bez
  kadłuba” w `projectileTrajectory.js:44–50` bez zmian); obrażenia przy wejściu jak dziś (`applyHexImpact`,
  `applyDamageToNPC`); przy rykoszecie oba dostają `× hullFrac`, pocisk znika, receptura dokłada kosmetyczny smugowiec
  z tym samym hashem.

### 2.4 Ładowanie Mjolnira i Valkyrie
Czysty moduł `src/game/weaponCharge.js`: `stepCharge(state, dt, { wantFire, aimErr, speed, angVel }, def) →
idle | charging | fire | cancel`; `requiresStationary` przerywa przy `|v| > 30` j/s albo `|ω| > 0,05` rad/s. Wołający:
`WeaponController.tryFireSpecialWeapons` (388–427) i `update` (516–535); duplikaty w `index.html` `_fireSpecialGroup`
(9220–9250) i `updateSpecialWeaponCooldowns` (9188–9204); `capitalAI.js:921–961` (pole `weapon.charge`; domyślne
loadouty NPC tych broni nie mają); HUD `_specialHudFromEntries` (`index.html:5285`). Efekt:
`WeaponShotBus.emitCharge(weaponId, shooter, x, y, dirX, dirY, u, dt)` → `RECIPES[fx].charge` ze stanem na działo.

### 2.5 Seria Hexlance'a
`prepareSuperweaponSalvo` (`superweapon.js:241–253`): kolejka `burstCount × liczba gniazd` co `burstDelay`
(`getHexlanceStat('burstCount', 1)`); utrzymanie ładowania przed każdym strzałem (314–322) zostaje.

### 2.6 Jedno źródło odrzutu i wstrząsu
Odrzut: dane broni — `fxProfileFor` (`turret2D.js:428–434`) bierze `MASTER_WEAPONS[id].recoil ?? FX_PROFILE`,
`FX_PROFILE` zostaje tylko kluczem; wstrząs: `shake` z danych w zlewie z §1.1; brakujące pola z `turret2D.js:364–391`
(warianty S/L z `arsenal.js:21–31`). `impactScale`: mnożnik rozmiaru w bramce LOD trafienia (`fxSize` w
`spawnBulletImpactEffect`) i wstrząsu przy trafieniu — receptur nie mnożyć (obraz jak w demie).

### 2.7 Determinizm
Decyzje przebicia / rykoszetu / ładowania nie losują; obraz rykoszetu z tego samego hasha; `fxRandom` tylko w warstwie
efektów; `shatter` i `applyImpact` losują już dziś — bez zmian.

### 2.8 Balans (liczby do `POSTEP.md`)

| Broń | Zmiana |
|---|---|
| Mjolnir | 3 s ładowania + 8 s cooldownu: 2500/11 s = 227 dps zamiast 312 (−27%) + wymóg postoju; pełne 2500 HP w każdym z ≤ 10 kadłubów w linii (friendly fire włączony — trafia też sojuszników za celem) |
| Valkyrie | ładowanie 0,28 s: 152 zamiast 167 dps (−8,5%); 260 j. materiału — fregaty (192 j.) i niszczyciele w burtę na wylot, w kapitałach zakleszczenie (`stuck`: wybuch i krater) |
| Vulcan, Gatling | ~9% trafień pod kątem rykoszetu × 0,6 ≈ 5,5% trafień, przy `hullFrac` 0,3 ≈ −4% dps (więcej na płaskich burtach trafianych skosem) |
| Hexlance | ×`burstCount` (4) cięć na naciśnięcie; obrażenia tylko strukturalne (sufit HP `ratio^2,2`) |
| bitwy NPC | przebicia bez wpływu; rykoszet tylko Vulcan pancernika wsparcia |
| kratery wyjścia | każdy zabity węzeł obniża HP przez sufit strukturalny |

Pomiar: skrypt Node z pojedynkiem na prawdziwych sprite'ach (`readPng` z `scripts/webgpu/png.mjs` +
`HullBodies.createHull`), 1000 strzałów na broń, kąty z ziarnem — HP, zabite węzły, przebite kadłuby przed/po. Harness
`bitwa` nie mierzy balansu (inna realizacja losowa po zmianie sekwencji `Math.random`).

## 3. Mapa ran na kadłubach belkowych (zadanie 18)

### 3.1 Magazyn i teksel
**Pula w buforze storage** jak w demie (`hull.js:250`, próbkowanie ręcznie dwuliniowe 150–163), nie tablica tekstur:
kernel czyta i pisze ten sam teksel (zapis-odczyt tekstury storage w rdzeniu WebGPU tylko `r32*`; `rgba16float` wymaga
`texture-formats-tier2` — RTX 5080 ma, nie każda karta — albo 2 tekstur = 2× pamięci); warstwy tablicy mają jeden
rozmiar; ścieżka bufora sprawdzona w three r183. **Teksel 8 B:** `packHalf2x16(żar, jony)` + `packUnorm2x16(osmalenie,
przestrzelina)` (TSL r183 ma `packHalf2x16` / `unpackHalf2x16` / `packUnorm2x16`; żar w 8 bitach nie stygnie przy
144 FPS). **Klasy** (długość świata = `length × 0,6`, `src/data/ships.js:198, 336–362`): L 512×256 (≥ 900 j.: Atlas
1800, superkapitały 1200–1560, frachtowce), M 256×128 (400–900: pancerniki 624–720), S 128×64 (160–400: niszczyciele,
fregaty), bez mapy < 160 (myśliwce). Klasę wybiera kadłub-korzeń; odłamy dziedziczą ją z kluczem.

### 3.2 Przydział
Klucz `dmgKey` (rodzic, wrak, odłamy — jeden slot). Slot `{key, cls, base, w, h, lastSeenFrame, hotUntil, hotRect}`.
`acquire`: istnieje → zwróć; wolny w klasie → zadanie „wyczyść” i przydziel; inaczej LRU po `lastSeenFrame` spośród
slotów spoza kadru (wzór `src/3d/hullShadowSdf.js:821–872`); wszystkie w kadrze → stempel przepada (licznik).
`lastSeenFrame` odświeża `updateBeamSkinMesh` (`hexShips3D.js:2125`). Zimne wraki wypadają same (po odmrożeniu bez ran —
świadomy koszt). Naprawa R (`HullBodies.repair`, 373–382) → `HullDamageMap.heal` (wygaszenie osmalenia i przestrzelin).

### 3.3 Kernel
Kernel dema (`hull.js:279–315`) z listą zadań `(slot, prostokąt, stemple, pierwszy wątek)`: jeden dispatch na klatkę,
wątek znajduje zadanie wyszukiwaniem binarnym (jak `gpuFx._spawnCommon`), jedno zadanie na slot (bez wyścigów),
stygnięcie tylko w `hotRect` (suma AABB stempli, zasięg 1,6 r) do `hotUntil` (ostatni stempel + `ln(H/0,02)/0,45` ≈ 12 s
dla żaru 4). Opcja, jeśli drogo: stygnięcie analitycznie w materiale (`dH/dt = −(1,3H + 0,45)H` ma rozwiązanie
zamknięte; `t0` w tekselu).

### 3.4 Stempel a krater
Położenie i uv z `hullImpactResult` (ten sam węzeł i punkt co krater). Promień `r = killed > 0 ? max(rReceptury,
radius + 0,5·cs) : rReceptury` (żar obejmuje brzeg prawdziwej dziury). Przestrzelina: gdy `killed === 0` i
`r ≤ 0,6·cellSize` — z receptury, inaczej `min(hole, 0,45)` (bez przezroczystości; np. armata 150 obrażeń, budżet 135 HP
przy 320 HP na węzeł nie zabija węzła — 62-jednostkowa dziura z dema byłaby fałszywa). Rzaz Hexlance'a / Mjolnira: pas
żaru i osmalenia, dziurę robi geometria. Stemple opóźnione (wtórne Yamato, rzaz, `burn`): uv trafienia + przesunięcie w
układzie kadłuba (ciało i `dmgKey` zostają, nawet gdy encja zginęła). Parametry stempli z tabeli `STAMP[rodzina]`
(z wywołań `ctx.stamp`); stemple nie przechodzą przez bramkę LOD efektu.

### 3.5 Materiał skóry (po 04)
Uniformy na obiekt przez `onObjectUpdate`: `dmgBase`, `dmgW`, `dmgH`, `dmgOn` (odczyt tylko ze slotem); próbkowanie po
`uv()` skóry; przestrzelina przez `discard` przy `hole > 0,5` (nie alfa — zapis głębi i cień mostka); żar = `max()` z
żaru skóry (`hexShips3D.js:361–363`, szczyt 2,5) i żaru mapy (rampa dema `hull.js:202–205`) — jedno źródło na piksel,
brzeg rany 8–12 HDR.

### 3.6 Pamięć
Demo bez puli: 125 × 2 MB = 250 MB. Pula (8 B/teksel): L 12 × 1 MB + M 32 × 256 KB + S 64 × 64 KB = 24 MB. Najgorszy
compute: 20 gorących slotów L × 131 tys. tekseli = 2,6 mln wątków — zmierzyć „U hex” i compute w bitwie `--wydajnosc`.

### 3.7 Stan po 18-C (2026-09-28) — różnice względem projektu
Kod: `src/3d/hullDamageMap.js` (sloty, LRU, kolejka, zadania, krok klatki efektów, API), `src/3d/hullDamageMap.tsl.js`
(pula, kernel, próbkowanie i wygląd rany w materiale, światła efektów, lustra CPU), `src/3d/hullDamageStamps.js`
(tabela `STAMP` z wywołań `ctx.stamp` dema, rodzina broni ze źródła), haki w `hexShips3D.tsl.js` (tylko skóra belek:
`damage: true`), holdery `uDmgSlot` / `uDmgWorld` / `uGridOwner` w `createHullUniforms`, `bind` w `updateBeamSkinMesh`;
`hullBodies.js`: `hullImpactResult.dirX / dirY / len` i hak `onRepair`; `index.html`: haki `onImpact` / `onRepair` i
7. argument `applyHexImpact` (źródło stempla). Testy: `tests/hullDamageMap.test.mjs`; narzędzie: `scripts/webgpu/rany-gra.mjs`.

- **Teksel (§3.1):** słowo 0 bez zmian (`packHalf2x16(żar, jony)`), słowo 1 = 3 × unorm8 (osmalenie, **brzeg**, **otwór**)
  zamiast `packUnorm2x16(osmalenie, przestrzelina)`: kształt rany z receptury (lej + żarzący się pierścień) i
  przezroczystość to osobne kanały — reguła §3.4 bez fałszywych dziur, ale z wyglądem dema.
- **Reguła „dziura albo krater” (§3.4):** promień jak w projekcie; kanał otworu = przestrzelina receptury tylko przy
  `killed === 0` i `r ≤ 0,6 komórki` (Vulcan, CIWS, laser PD), inaczej 0; kanał brzegu = przestrzelina receptury
  zawsze. `min(hole, 0,45)` z projektu odrzucone: szum brzegu dema dokłada do +0,31 (`jag·0,62`), więc 0,45 i tak
  otwierało poszarpane dziury. Lej bez przezroczystości = ciemne (albedo × 0,08), NIEŚWIECĄCE dno — w demie była tam
  dziura, więc świeci sam pierścień; świecący środek dawał tarczę bieli 8–10 HDR na całą średnicę (bloom zalewał pół
  kadłuba — pomiar w grze).
- **Źródło stempla:** zamiast pola w wyniku — „źródło otoczenia” jak `ActiveCarrier`: `setSource(pocisk | broń | id,
  wariant)` … `HullBodies.impact` … `clearSource()`; w grze robi to `applyHexImpact` (7. argument: `b` / `weapon`).
  Bez źródła: krater = stempel `generic`, rzaz (`cutSegment` — dziś tylko Hexlance) = znaki rzazu Hexlance'a wzdłuż
  cięcia (kierunek i droga z `hullImpactResult`). Rodzina: `WEAPON_STAMP_FAMILY` (27 broni = kolumna `fx` z 17),
  fallback po kategorii pocisku; moc rozmiaru jak `SIZE_POWER` dema; flak — promień 0,2 × `flakBurstRadius`.
- **Dla 18-B / 17:** przebicie — wariant w `setSource(…, 'exit' | 'stuck')` wokół krateru wyjścia / zakleszczenia, znaki
  rzazu w materiale — `stampKerf(e, x0, y0, x1, y1, rodzina)`, stempel bez krateru — `stampAt(e, x, y, rodzina,
  wariant, dirX, dirY)`. `ctx.stamp` receptur 17 zostaje pusty (inaczej stemple podwójne i zależne od bramki LOD).
  Wtórne wybuchy Yamato planuje mapa (kolejka opóźniona: uv trafienia + przesunięcie w układzie kadłuba, klucz rodu),
  `burn` (ogień w wyrwie) to efekt 17 bez stempla.
- **Przydział (§3.2):** jak w projekcie + klasa przy pierwszym stemplu rodu; kolejność: wolny slot swojej klasy →
  WOLNY slot większej (`upgrades`; nie wypycha dużych kadłubów — w bitwie niszczycieli S zapełnia się pierwsze) → LRU
  swojej klasy → mniejsza klasa (`downgrades`) → brak (`noSlot`); chronione też sloty ze stemplami tej klatki; przejęty slot
  czyści tylko swój **brudny prostokąt** (suma stempli od ostatniego czyszczenia), nie cały slot; trafienia dalej niż
  pół kadru poza ekranem nie stemplują (`DMG_VIEW_MARGIN` — bitwa poza kadrem nie mieli slotów); kopia CPU puli
  oddawana po utworzeniu bufora GPU (pamięć CPU 24 MB → 0).
- **Kernel (§3.3):** jak w projekcie (lista zadań, wyszukiwanie binarne, jedno zadanie na slot), ale stygnięcie wzorem
  zamkniętym `H·a·e^(−aΔ) / (a + b·H·(1 − e^(−aΔ)))` — dokładne dla dowolnego Δ: stygną tylko gorące sloty W KADRZE,
  sloty poza kadrem nadrabiają jednym krokiem przy powrocie / stemplu; po `DMG_HOT_SEC` (6,3 s od sufitu żaru 6)
  zadanie zeruje żar i jony, slot przestaje być gorący. Rozmiar dispatchu — potęga dwójki (three alokuje przy zmianie).
- **Materiał (§3.5):** jak w projekcie (slot per obiekt przez holder + `perObject`, próbka dwuliniowa, `discard` tylko z
  kanału otworu, żar = `max(żar skóry, żar rany)` + jony); osmalenie przyciemnia albedo przed wszystkimi światłami.
- **Światła efektów (krok 5):** `hullEffectLighting` — model powierzchni dema broni (Lambert z zawinięciem 0,25,
  Blinn–Phong 40, albedo 0,633, połysk × (1 − 0,8·osmalenie)) po `Core3D.fx.grid.loop` z pozycją z widoku (dokładna
  przy 5–10 mln j.) i węzłem właściciela `uGridOwner` (0 = nic nie pomija; dla przyszłych świateł statków w siatce);
  lampy statku zostają w payloadzie (bez zmian). Tylko skóra belek.
- **Naprawa R:** hak `HullBodies.onRepair(e, dt, changed)` → wygaszanie osmalenia / brzegu / otworu 0,8 na s, koniec
  naprawy (`changed = false`) czyści brudny prostokąt i zwalnia slot.

## 4. Podział pracy, kolejność, testy

- **17-A** (bez zależności): tabela broni + test „27 broni ma recepturę”; `fxRandom`; pola szyny (`dirX/dirY`, dane PD w
  `_beamEventScratch`); `_impactHit` z piątym argumentem (normalna z `HullBodies.surfaceNormal` z 18-A).
- **17-B** (po 12): pule z nośnikiem i początkiem przy kamerze, `TrailSystem` z nośnikiem, `ProjectileSystem` (≤ 4096),
  `BeamSystem` (≥ 512–1024, pierścień impulsów).
- **17-C:** receptury bez `Math.random` i alokacji — najpierw rodziny o dużej kadencji (PD, CIWS, Vulcan, flak,
  Tempest, autokanon, wiązka ciągła).
- **17-D:** wpięcie zdarzeń A–O. **17-E:** usunięcie starych modułów + przejęcie obowiązków z §0.2; rozgrzewka
  `hexShips3D.js:2247, 2264`, `disposeAll` 2751. **17-F:** harness i testy.
- **18-A** (równolegle z 17, tylko `src/game`, `src/data`, `tests`): `surfaceNormal`, `traceThrough`, `spriteUvAt`,
  `hullImpactResult`, `dmgKey`; `projectileMechanics.js`, `weaponCharge.js`; kolejka serii w `superweapon.js`; pola
  danych; testy w Node (płyty `plate()` z `tests/hullBodies.test.mjs` i prawdziwe sprite'y). Bez wpięcia w `index.html`.
- **18-B** (po 17): wpięcie w `index.html`, AI, HUD; zdarzenia `kerf/exit/stuck/ricochet/charge` do `WeaponFx`.
- **18-C** (po 04 i 12): `HullDamageMap`, materiał, światła siatki. **18-D:** odrzut / wstrząs / skala trafienia z
  danych; pomiary; `POSTEP.md`.
- 17-D i 18-B po kolei (te same funkcje `index.html`: `fireWeaponCore`, `bulletsAndCollisionsStep`, `ciwsStep`,
  `detonateFlakShell`).

**Ryzyka:** rozjazd harnessu po zmianie sekwencji `Math.random` (§0.9) — spisać sceny, które się zmieniły; koszt PD
(jeden draw call, odcięcie poza kadrem); limity świateł siatki; precyzja 5–10 mln j.; fałszywe dziury (§3.4); balans
Hexlance'a ×4; obrażenia Hexlance'a zależne od FPS (istniejący problem, poza zakresem); testy regexujące źródła.

**Testy w 17 do przepisania:** `weapon3DModelMaterials` (odpowiedniki dla `src/3d/weapons/*`: bez siatek wieżyczek,
pocisk w jednej siatce z `CustomBlending`, pasma HDR, błysk z puli ADD); `pulseBeamPoolLimit` (pierścień o stałej
pojemności, nadpisywany najstarszy, limit `BeamSystem.add`); `beamRenderPath` (brak ścieżki kanwy dla wiązek, każda
broń `beam` ma recepturę, odwrócony test „point-defence laser keeps its canvas-only beam path” z opisem decyzji
2026-09-27); `pdBeamFastPath` („jedna wiązka 2D, bez pulsu 3D” i „render3dOnly: bez smugi 2D” → `kind: 'pd'` w
zdarzeniu szyny); `turret2D` (nazwa testu „…weapon3DSystem asks for”); `fighterCombatFixes` (test 1: regexy na nowym
słuchaczu; test 2 zostaje, jeśli zlew pisze `__weapon3dCameraShake.mag`); `weaponShotBus` (część o `weapon3DSystem.js`);
`renderPerfGates` (92–101 podpis `spawnBulletImpactEffect` i `trigger*3D`, 148–152 `yamato.js`, 173–180 pociski);
`renderBugfixGuards` (49–60, 82–92: bez `yamato.js`); `shaderPrewarm` (38–53: bez fabryk broni); `shadowShaftsQuality`
(265–266: nowa lista plików); `pointDefenseTargeting` (atrapa fasady w zakresie `ciwsStep` 156–194); `carrierVelocity`
(nowy test paczki z nośnikiem — lustro wzoru kernela na CPU); porażka bazowa `weaponAim.test.mjs:144`
(`MuzzleFX3D is not defined`) powinna zniknąć po usunięciu `MuzzleFX3D.handles` (`index.html:18219`) — poprawić tabelę
porażek bazowych w `POSTEP.md`. **Nowe w 17:** tabela 27 broni i fallbacki po `type`; brak `Math.random` w modułach
broni (skan + szpieg) i brak wzrostu pul po 10 tys. strzałów; cykl życia smugi i `__renderedByThree`; stan wiązki
ciągłej na `emitterUid`.

**Testy w 18:** przepisać `projectileTrajectory` („rail and plasma projectiles stop on the first solid hex” → decyzja z
`penDepth`), `hullBodies` (śmierć, wybuch reaktora: asercja `dmgKey` wraku); nowe `hullSurfaceQueries` (normalne burty,
dziobu, rogu, po obrocie; grubość płyty 160/400; uv wycięcia `NOTCHED`), `projectilePenetration`, `projectileRicochet`,
`weaponCharge`, `hexlanceBurst`, `hullDamageMap` (klasy, LRU, wspólny klucz, reguła „dziura albo krater”, stygnięcie),
`weaponRecoilSource`; bez nowych porażek: `projectileHexSweep`, `lineOfFire`, `fleetBattle`, `npcWeaponSpecCap`,
`pointDefenseTargeting`, `flakSystem`, `beam*`.

## 5. Decyzje (podjęte przez orkiestratora 2026-09-27 — do przejrzenia przez użytkownika)

1. **Rykoszet** = obrażenia kadłuba `× 0,3` + kosmetyczny smugowiec z tym samym hashem (nie żywy odbity pocisk) —
   deterministycznie, bez nowych trafień w inne cele.
2. **Krater wyjścia przy przebiciu: tak** — budżet samego krateru `0,5 × obrażenia` (bez HP; HP spada tylko przez sufit
   strukturalny od zabitych węzłów), jak przebicie na wylot w demie.
3. **Seria Hexlance'a z danych** (`burstCount` 4 co `burstDelay`) — pole istnieje w danych, demo pokazuje serie
   ładowania; jeśli pomiar balansu (§2.8) pokaże przesadę, zmniejszyć `burstCount` w danych, nie w kodzie.
4. **Ładowanie Valkyrie 0,28 s** — dopisać do `weapons.js` (`chargeTime`), jak w demie.
5. **Konflikty odrzutu / wstrząsu:** wartości z `FX_PROFILE` (to, co widać dziś i w demie, które użytkownik
   zaakceptował) — przepisać je do `weapons.js`, żeby dane były jedynym źródłem.
6. **`impactScale`:** mnożnik rozmiaru w bramce LOD trafienia i wstrząsu przy trafieniu; receptur nie mnożyć.
7. **Postój dla `requiresStationary`:** `|v| ≤ 30` j/s i `|ω| ≤ 0,05` rad/s; **limit przebitych kadłubów** = istniejące
   pole `penetration`.
