# Mechanika broni z dema w logice gry (zadanie 18-A)

> Stan 2026-09-27, gałąź `webgpu/18a`. Część 18-A zadania 18 (`zadania/18-bron-obrazenia-z-dema.md`,
> projekt: `PROJEKT-BRONI.md` §2, §4, §5): zapytania kadłubów, przebicia, rykoszety, ładowanie i serie
> jako moduły logiki **bez wpięcia w grę**. Po scaleniu gra zachowuje się jak dotąd (żadna ścieżka gry nie woła
> nowych funkcji ani nie czyta nowych pól danych). Wpięcie — 18-B (po 17), mapa ran — 18-C, odrzut / wstrząs /
> skala trafienia z danych — 18-D.

## 1. Zapytania kadłubów (`src/game/hullBodies.js`)

Tylko odczyt, bez `Math.random`, bez alokacji (wyniki we współdzielonych obiektach, ważne do następnego
wywołania; można podać własny `out`). Świat gry (y w dół).

| Funkcja | Wynik | Uwagi |
|---|---|---|
| `surfaceNormal(e, x, y, dirX, dirY, out)` | `hullNormalResult {nx, ny, node}` | gradient zajętości żywych węzłów w kole 2,5 komórki wokół najbliższego węzła (≤ 2 komórki od punktu); **wołać przed `impact()`**; normalna nie patrzy w stronę lotu (trafienie „od tyłu” krawędzi → styczna); brak węzła / pręt jednej komórki → −kierunek; bez kierunku → promieniście od kotwicy |
| `traceThrough(e, x0, y0, x1, y1, radius, out)` | `hullTraceResult {solidLen, entryT, exitT, node}` albo `null` bez kadłuba | marsz co pół komórki sondą 0,72 komórki (+ promień pocisku — przykrywa dziurki przy narożnikach komórek), przejścia połowione 4×; **pierwszy ciągły odcinek materiału**; `entryT` 0 = start w środku, −1 = brak materiału; `exitT` −1 = materiał do końca odcinka; droga ≥ grubości i ≤ grubość + 0,44 komórki |
| `spriteUvAt(e, x, y, nodeHint, out)` | `hullUvResult {u, v, ok, node}` | konwencja skóry gry (`beamHullSkin.js`, v = 0 u góry obrazu): `cx = ix + ½ + (l − x_węzła)/cs`, `u = cx·pitch/W`, `v = (ny − cy)·pitch/H`; względem bieżącej pozycji węzła — uv jedzie z wgnieceniem; wraki i odłamy w uv rodzica; `ok = false` — brak węzła (uv ze spoczynku siatki) |

`impact()` i `cutSegment()` — wynik i zachowanie bez zmian (A/B: hash stanu węzłów, encji i odłamków po
240 krokach z kraterami, rzazami, taranem, śmiercią i wybuchem reaktora identyczny z `HEAD`), dodatkowo
wypełniają `hullImpactResult {kind, hit, killed, radius, node, u, v, x, y, dmgKey}`:
`kind` `'impact'`/`'cut'`; `killed` — ubytek żywych węzłów w wywołaniu (krater + utrata oparcia; rozpad liczy
się w kroku); `node` — węzeł, od którego zaczyna krater (najbliższy w promieniu krateru) / węzeł wejścia rzazu;
`u, v` — liczone **przed** kraterem; `radius` — promień krateru (≥ komórka silnika) / półszerokość rzazu.
Hak `HullBodies.onImpact(entity, hullImpactResult)` (domyślnie `null`) — po każdym trafieniu, które coś
objęło (mapa ran 18-C, wybuchy rakiet 19).

`hull.dmgKey` — kolejny numer w `createHull`; `makeWreckEntity` kopiuje go z rodzica, więc wrak z
`convertToWreck`, odłamy z `onWreck` i odłamy `shatter` mają klucz rodu (jedna warstwa mapy ran w uv
rodzica). Ponowna budowa kadłuba encji (zmiana kadłuba gracza) = nowy klucz.

## 2. Przebicia i rykoszety (`src/game/projectileMechanics.js`)

| Eksport | Co robi |
|---|---|
| `nextProjectileSerial()` / `resetProjectileSerial()` | numer pocisku `b.serial` (18-B: w `fireWeaponCore` przy tworzeniu pocisku) |
| `hash01(serial, node, salt)` | deterministyczny „rzut” w [0, 1) — decyzje bez `Math.random` |
| `resolveHullHit(b, def, normal, relVel, node, entity, hitX, hitY)` | `HIT_RICOCHET` / `HIT_PENETRATE` / `HIT_STOP` (niżej) |
| `entryDamage(b, def, decision)` | mnożniki `b.damage` przy wejściu: `{hp, crater}` |
| `stepInsideHull(b, def)` | krok w materiale → `hullPassResult {event, entity, x, y, t, solidLen, kerfs, kerfX, kerfY, kerfDX, kerfDY, craterDamage}` |
| `skipsHull(b, entity)` / `isInsideHull(b)` | pętla kandydatów pomija kadłub, w którym pocisk jest / z którego wyszedł w tym kroku |
| `ricochetBounce(b, normal, relVel, node)` | obraz rykoszetu (kierunek, × prędkości, życie) z tego samego hasha — dla receptury z 17 |
| `settledDamage`, `penetrationDepthOf`, `penetrationLimitOf`, `ricochetDamageFactor`, `PENETRATION_CONFIG` | pomocnicze / strojenie |

Reguły (decyzje `PROJEKT-BRONI.md` §5 p. 1, 2, 7 i niżej „Decyzje 18-A”):
- **Rykoszet** (`def.ricochet`): kierunek względem kadłuba · normalna ≥ −`cosMax` (kąt od normalnej > 65,2°)
  i `hash01(b.serial, node) ≤ chance` → HP i krater × `hullFrac` (0,3), pocisk znika.
- **Przebicie** (`def.penDepth > 0`): budżet materiału `penDepth` (Infinity = bez limitu), hamowanie względem
  kadłuba `v·exp(−penSpeedLoss·6·t)`, `t = droga/|v|`; N-ty różny kadłub (`penetration`) zatrzymuje pocisk;
  po wyjściu `b.damage = dmg0·(|v|/v0)²·(left/penDepth)` (∞ bez ostatniego czynnika); krater wyjścia
  `craterDamage = 0,5 × b.damage` (bez HP); budżet wyczerpany w środku albo |v| < 300 j/s → `PASS_STUCK`,
  krater `0,5 × obrażenia niesione w tym kadłubie × (v/v_wejścia)²`; znaki rzazu co 22 j. drogi w materiale.
- Stan w `b.pen = {entity, body, lastBody, bodies, repeat, left, count, v0, dmg0, vIn, x, y, kerfAcc}` — jeden
  obiekt na pocisk przebijający (Mjolnir, Valkyrie). Pocisk trzyma **ciało**, więc gdy statek zginie z
  pociskiem w środku (`convertToWreck`), krok liczy się dalej w kadłubie wraku.

### Wpięcie w `bulletsAndCollisionsStep` (18-B) — kolejność ma znaczenie

Wzorzec działający na prawdziwych kadłubach: `tests/helpers/hullFlight.mjs` (`flyShot`, używają go testy i skrypt
bilansu).
1. `fireWeaponCore`: `bullet.serial = nextProjectileSerial()`.
2. Po `stepProjectileKinematics`: `if (b.pen) pass = stepInsideHull(b, def)` (`def = MASTER_WEAPONS[b.vfxKey]`).
   `PASS_INSIDE` → pocisk pomija pętlę kandydatów; `PASS_EXIT` → krater wyjścia
   `HullBodies.impact(pass.entity, pass.x, pass.y, pass.craterDamage, relVel)` (bez `applyDamageToNPC`),
   kandydaci od **punktu wyjścia** (`pass.x, pass.y` zamiast `b.px, b.py`); `PASS_STUCK` → krater, pocisk usunąć.
3. Pętla kandydatów: `if (skipsHull(b, realNpc)) continue;`.
4. Trafienie w kadłub (gałąź `!shieldActive && hexHit`): `n = HullBodies.surfaceNormal(real, hitX, hitY,
   relVel.x, relVel.y)` **przed** `applyHexImpact`, `decision = resolveHullHit(b, def, n, relVel,
   hullSweepResult.node, real, hitX, hitY)`, `k = entryDamage(b, def, decision)`; `dmgIn = npcDamage`.
   - `HIT_PENETRATE`: **najpierw** `pass = stepInsideHull(b, def)` (droga w nienaruszonym materiale — krater
     wejścia nie może jej skrócić), potem `applyHexImpact(…, dmgIn·k.crater)` i `applyDamageToNPC(…, dmgIn·k.hp)`,
     potem zdarzenie `pass` jak w p. 2; po `PASS_EXIT` ta sama pętla kandydatów dalej od punktu wyjścia
     (następny kadłub w tym samym kroku).
   - `HIT_RICOCHET`: obrażenia × `k`, pocisk usunąć, receptura dokłada smugowiec z `ricochetBounce`.
   - `HIT_STOP`: jak dziś.
   Zamiast `shouldRemoveProjectileAfterImpact` dla kadłubów; gałąź „rail w coś bez kadłuba” bez zmian.
5. Efekty (17): `kerf` — `pass.kerfs` znaków od `(kerfX, kerfY)` co `(kerfDX, kerfDY)`; `exit` / `stuck` w
   `pass.x, pass.y`; nośnik — trafiony kadłub (`pass.entity`).
6. Test `projectileTrajectory` („rail and plasma projectiles stop on the first solid hex”) przepisać: kadłub
   zatrzymuje wszystko poza bronią z `penDepth`.

## 3. Ładowanie i serie (`src/game/weaponCharge.js`)

- `stepCharge(state, dt, {wantFire, aimErr, speed, angVel, ready}, def)` → `CHARGE_IDLE` / `CHARGE_CHARGING` /
  `CHARGE_FIRE` / `CHARGE_CANCEL`; stan `createChargeState()` na działo (`{charge, u, hold, reason}`; `u` = postęp
  dla efektu ładowania, `reason` `'cooldown' | 'moving' | 'aim'` dla komunikatu HUD). Jak demo: start przy błędzie
  celowania ≤ 0,08 rad, strzał po `chargeTime` przy ≤ 0,03 rad; naciśnięcie raz wystarcza (klawisz 2 —
  zdarzenie, nie przytrzymanie). `requiresStationary`: |v| ≤ 30 j/s i |ω| ≤ 0,05 rad/s — ruch nie pozwala zacząć
  i przerywa. Naładowane działo bez celu gaśnie po `holdMax` 2 s. Broń bez `chargeTime` → `FIRE` od razu.
  `cancelCharge(state)` — zmiana broni, skok, śmierć.
- Wpięcie (18-B): `WeaponController.tryFireSpecialWeapons` i `update`, duplikaty `_fireSpecialGroup` /
  `updateSpecialWeaponCooldowns` w `index.html`, `capitalAI` (pole `weapon.charge`), HUD `_specialHudFromEntries`.
  Błąd celowania: `stepMountedWeaponAim` liczy `diff = wrap(desired − angle)`, ale go nie zapisuje — 18-B dopisze
  `state.aimErr = Math.abs(diff)` (`src/game/weaponAim.js`).
- Seria: `buildHexlanceBurst(def, mounts, out)` → kolejka `burstCount × gniazda` (4 × 1 na Atlasie) wpisów
  `{cannonIndex, delay}` gniazdo po gnieździe, opóźnienia **względne** (0, potem `burstDelay` 0,25 s);
  `stepBurstQueue(queue, dt, fire)` = pętla z `updateSuperweapon` (nadwyżka kroku przechodzi dalej, rytm bez
  dryfu). Wpięcie: `prepareSuperweaponSalvo` buduje kolejkę tą funkcją; podgląd ładowania przed strzałem
  (`delay ≤ 0,22`) zostaje.

## 4. Dane broni (`src/data/weapons.js`)

Nowe pola, dziś nieczytane (grep: żadna ścieżka gry nie czyta `penDepth`, `penSpeedLoss`, `ricochet`,
`recoil`, `shake`, `impactScale` z danych broni; `chargeTime` czyta tylko `superweapon.js` — wyłącznie z
`hexlance_siege`; `burstCount` czyta `fireWeaponCore` i flak — Hexlance nie przechodzi przez `fireWeaponCore`):

| Broń | Pola |
|---|---|
| `siege_railgun` (Mjolnir) | `penDepth: Infinity`, `penSpeedLoss: 0` (`penetration: 10`, `chargeTime: 3`, `requiresStationary` — były) |
| `special_valkyrie_railgun` | `chargeTime: 0.28`, `penDepth: 260`, `penSpeedLoss: 0.35`; `recoil / shake` 60 / 45 → **20 / 12** (FX_PROFILE) |
| `vulcan_minigun`, `gatling_s` | `ricochet: { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 }` |
| `armata_mk1` | `recoil / shake` 15 / 8 → **12 / 6,5** (FX_PROFILE) |
| `special_yamato_cannon` | `recoil / shake` 90 / 65 → **60 / 20** (FX_PROFILE) |
| reszta z `FX_PROFILE` (`turret2D.js`) | `recoil / shake` dopisane 1:1 (rail, Vulcan, Helios, autokanon, CIWS, laser PD, flak ×4, rakiety ×6) |
| warianty S/L, `ciws_mk2`, `hexlance_siege` | wartości rodziny z dema (`arsenal.js`) — **dziś gra daje im fallback 3 / 1,8** (`fxProfileFor`), więc po przełączeniu źródła w 18-D zmienią się na wartości dema |

## 5. Decyzje 18-A (samodzielne, do przejrzenia)

1. **Ponowne wejście w ten sam kadłub** (wklęsła sylwetka, dwa „ramiona”): kratery tak, HP drugi raz nie, nie
   liczy się do limitu `penetration` — bez tego Mjolnir w pancernik dawał średnio 2562 zamiast 2500 HP/strzał,
   Valkyrie we fregatę 512 zamiast 500 (zależnie od kształtu sprite'a).
2. **Droga w materiale liczona przed kraterem wejścia** (kolejność w 18-B, §2 p. 4) — krater wejścia Mjolnira
   (~37 j.) wycinałby cienkim kadłubom całą grubość i „wyjście” wypadałoby w punkcie wejścia.
3. **Krater zakleszczenia** = 0,5 × obrażeń niesionych w tym kadłubie × (v/v_wejścia)² (to samo prawo co krater
   wyjścia; w demie tylko obraz). Valkyrie w kapitale: ~0,7 węzła.
4. **Kolejka serii z opóźnieniami względnymi** — dzisiejsza `prepareSuperweaponSalvo` wpisuje opóźnienia
   narastające (0, d, 2d…), a pętla opróżniania czyta je względnie: przy 3+ gniazdach strzały szły w 0, d, 3d, 6d.
   Na Atlasie (1 gniazdo) bez znaczenia.
5. **`holdMax` 2 s** naładowanego działa bez celu (w demie czekało bez końca).
6. `recoil / shake` dopisane wszystkim broniom z `FX_PROFILE` / dema, nie tylko różniącym się (§5 p. 5: dane jedynym
   źródłem) — nieczytane do 18-D.

## 6. Bilans (skrypt `scripts/bilans-broni.mjs`, 1000 strzałów na scenariusz)

Prawdziwe sprite'y w rozmiarze renderu (piraci: fregata 192, niszczyciel 360, pancernik 720 j.; Terra Nova:
lotniskowiec 1080, superkapitał 1560 j.), strzelec pod losowym namiarem (ziarno), punkt celowania jak w demie,
rozrzut broni; PRZED = dzisiejsza gra, PO = mechanika z dema. Strata HP = obrażenia i sufit strukturalny
(`maxHp · ratio^2,2`). ~19 s.

| Broń / scenariusz | PRZED | PO |
|---|---|---|
| Mjolnir, pojedynczy pancernik | 2500 HP/strzał, 7,6 węzła; 312,5 dps | 2500 HP, 12,8 węzła (4,9 z krateru wyjścia); **227,3 dps (−27,3%)** — ładowanie 3 s, wymóg postoju |
| Mjolnir, kolumna fregata + niszczyciel + pancernik (±60 j., oś ±3°) | 1,00 kadłuba/strzał, strata HP 1200 (tylko fregata) | 2,94 kadłuba, strata 6043 (1200 / 2345 / 2498); 549 dps (+266%) |
| Valkyrie, fregata / niszczyciel | 500 HP/strzał; 166,7 dps | na wylot 100% / 80% (20% zakleszczeń wzdłuż osi); **152,7 / 152,4 dps (−8,4 / −8,5%)** — ładowanie 0,28 s |
| Valkyrie, pancernik / lotniskowiec / superkapitał | 500 HP/strzał | zakleszczenie 83% / 99% / 100% (na wylot 19% / 3% / 2%); −8,5% dps |
| Valkyrie, kolumna | 1,00 kadłuba, strata 500 | 2,52 kadłuba, strata 869 (502 / 292 / 75); 265 dps (+59%) |
| Vulcan, niszczyciel / pancernik | 4,0 HP/trafienie | rykoszety 5,9% / 2,2% trafień; −4,2% / −1,5% dps |
| Gatling S, niszczyciel / pancernik | 3,0 HP/trafienie | rykoszety 5,6% / 3,2%; −4,0% / −2,2% dps |
| Hexlance, pancernik (cel dryfuje 0–150 j/s, ±0,05 rad/s) | 1 cięcie: 136 węzłów utraconych, strata HP 4225 | 4 cięcia: 230 węzłów, strata 6457 (+53%); kolejne cięcia serii niszczą 124 / 21 / 20 / 19 węzłów (pas 70 j. prawie się pokrywa) |
| Hexlance, lotniskowiec | 207 węzłów, strata 10 577 | 349 węzłów, strata 16 584 (+57%) |

Wnioski: przebicia zmieniają bilans tylko w szyku (kolumna: Mjolnir ×5,0 straty HP na strzał, ×3,7 dps z
ładowaniem; Valkyrie ×1,74 na strzał, ×1,59 dps); w pojedynku Mjolnir traci 27% dps przez ładowanie. Valkyrie w kapitałach prawie zawsze grzęźnie (260 j. < grubość
wzdłuż toru). Rykoszet działek to 2–6% trafień (więcej na mniejszych, bardziej zaokrąglonych kadłubach),
−1,5…−4,2% dps. Seria Hexlance'a przy stojącym Atlasie daje +53–57% na naciśnięcie, nie ×4 — kolejne cięcia
biegną tym samym pasem; cykl wydłuża się o 0,75 s serii (cooldown rusza po opróżnieniu kolejki). Bitwy NPC bez
zmian (domyślne loadouty NPC nie mają Mjolnira ani Valkyrie; rykoszet dotyczy Vulcana pancernika wsparcia).

## 7. Testy

`tests/hullSurfaceQueries.test.mjs` (normalne burt, dziobu, rogów wypukłych i wklęsłych po obrocie, pręt,
grubość płyt 160 / 400, dziura po kraterze, uv pikseli, zgodność ze skórą, wgniecenie, wrak i odłam w uv rodzica,
`hullImpactResult`, hak, brak `Math.random`), `projectilePenetration`, `projectileRicochet`, `weaponCharge`,
`hexlanceBurst`, `hullBodies` (+ `dmgKey` wraków: śmierć, taran, łup, wybuch reaktora, nowy kadłub).
