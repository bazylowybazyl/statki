# Mechanika broni z dema w logice gry (zadanie 18-A, wpięcie 18-B, dane odrzutu 18-D)

> Stan 2026-09-28. Część 18-A zadania 18 (`zadania/18-bron-obrazenia-z-dema.md`, projekt: `PROJEKT-BRONI.md`
> §2, §4, §5): zapytania kadłubów, przebicia, rykoszety, ładowanie i serie jako moduły logiki (gałąź `webgpu/18a`,
> scalone 4e165fb). **18-B (gałąź `webgpu/18b`) wpięło je w grę** — pętla pocisków, sterowanie ogniem gracza, P2
> i AI, HUD, seria Hexlance'a, efekty `kerf / exit / stuck / ricochet / charge` (§8); **18-D** — odrzut, wstrząs
> i skala trafienia z danych broni (§8.4). Mapa ran — 18-C; stemple wejścia, rykoszetu, wylotu, zakleszczenia
> i pasa rzazu z mechaniki 18-B — §8.6.

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

### Wpięcie w `bulletsAndCollisionsStep` (18-B, zrobione — §8.1) — kolejność ma znaczenie

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

Nowe pola 18-A (w 18-A nieczytane; od 18-B / 18-D czytane: `penDepth`, `penSpeedLoss`, `ricochet` — pętla
pocisków, `chargeTime` / `requiresStationary` — sterowanie ogniem gracza, P2 i AI, `burstCount` / `burstDelay`
Hexlance'a — `superweapon.js`, `recoil` / `shake` / `impactScale` — `src/game/weaponFeel.js`):

| Broń | Pola |
|---|---|
| `siege_railgun` (Mjolnir) | `penDepth: Infinity`, `penSpeedLoss: 0` (`penetration: 10`, `chargeTime: 3`, `requiresStationary` — były) |
| `special_valkyrie_railgun` | `chargeTime: 0.28`, `penDepth: 260`, `penSpeedLoss: 0.35`; `recoil / shake` 60 / 45 → **20 / 12** (FX_PROFILE) |
| `vulcan_minigun`, `gatling_s` | `ricochet: { cosMax: 0.42, chance: 0.6, hullFrac: 0.3 }` |
| `armata_mk1` | `recoil / shake` 15 / 8 → **12 / 6,5** (FX_PROFILE) |
| `special_yamato_cannon` | `recoil / shake` 90 / 65 → **60 / 20** (FX_PROFILE) |
| reszta z `FX_PROFILE` (`turret2D.js`) | `recoil / shake` dopisane 1:1 (rail, Vulcan, Helios, autokanon, CIWS, laser PD, flak ×4, rakiety ×6) |
| warianty S/L, `ciws_mk2`, `hexlance_siege` | wartości rodziny z dema (`arsenal.js`) — do 18-D gra dawała im fallback 3 / 1,8 (`fxProfileFor`); od 18-D czyta dane (§8.4) |

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

18-B / 18-D: `projectileMechanicsGame` (prawdziwe `bulletsAndCollisionsStep` z index.html na kadłubach belkowych:
Mjolnir = wzorzec 18-A co do węzła, Valkyrie stop na 3. kadłubie i zakleszczenie, rykoszety = decyzje wzorca,
reszta arsenału jak dotąd), `weaponChargeGame` (gracz — funkcje z index.html, P2, AI, HUD, komunikaty),
`weaponFxPierce` (rzaz, wyjście, zakleszczenie, `hit.through`, rykoszet z decyzji gry), `weaponRecoilSource`
(dane → Turret2D, kanał strzałów, wstrząs trafienia × `impactScale`, bramka, Hexlance), `hexlanceBurst` (+ seria
w `superweapon.js`); przepisane: `projectileTrajectory` (kadłub zatrzymuje wszystko poza bronią z `penDepth`),
`weaponAim` (piaskownica P1: `fireSpecialLoadout`, ładowanie), `destructorGhostHexes` (regex krateru wejścia).

## 8. Wpięcie w grę (18-B) i dane odrzutu (18-D) — stan 2026-09-28, gałąź `webgpu/18b`

### 8.1 Pętla pocisków (`index.html` `bulletsAndCollisionsStep`)

- `fireWeaponCore` nadaje pociskowi `serial: nextProjectileSerial()`, `mech: hasHullMechanics(def) ? def : null`
  (broń z `penDepth` albo `ricochet`: Mjolnir, Valkyrie, Vulcan, Gatling S) i `pen: null`.
- Pocisk z `b.pen` najpierw kroczy `stepInsideHull`; zdarzenie obsługuje `applyBulletHullPass` (znaki rzazu →
  `WeaponFx.kerf` i pas na mapie ran, krater wyjścia / zakleszczenia przez `applyHexImpact` → `HullBodies.impact`
  BEZ HP, efekt `pierceExit` / `pierceStuck`, nośnik = kadłub; stemple — §8.6). W materiale (`PASS_INSIDE`) pocisk nie widzi innych kolizji
  (kadłuby, olbrzymy pasa asteroid, płyta ringu, stacje); po wylocie kandydaci od punktu wyjścia.
- Pętla kandydatów działa w przebiegach `hullPass` (≤ 12): drugi i kolejne tylko po wylocie z kadłuba w tym samym
  kroku (następny okręt w kolumnie). Odcinek kandydatów `[candX0, b.x]` — dla każdego innego pocisku `candX0 =
  b.px` (arytmetyka identyczna jak przed 18-B). `skipsHull` pomija kadłub, w którym pocisk jest / z którego wyszedł.
- Trafienie w kadłub: `writeImpactHit` (normalna przed kraterem) → dla `mech` na kadłubie belkowym
  `resolveHullHit(b, mech, _impactHit, _impactRelVel, hitNode, …)` (`hitNode` — węzeł ze sweepa); przebicie →
  `stepInsideHull` PRZED kraterem wejścia; rykoszet → `writeImpactRicochet` (obraz z `ricochetBounce`, ten sam
  hash); obrażenia wejścia × `entryDamage` (rykoszet 0,3; ponowne wejście w ten sam kadłub — krater bez HP). Efekt
  wejścia dostaje `hit.through` (pocisk leci dalej — smuga nie kończy się na wejściu) albo `hit.ric…`.
- Cele bez kadłuba belkowego (myśliwce, heksy) i wszystkie bronie bez `mech` — ścieżka sprzed 18-B
  (`shouldRemoveProjectileAfterImpact`).
- A/B z b69c7ba (piaskownica pętli gry, 3 kadłuby, 200 strzałów 11 broni bez mechaniki, 3 ziarna): hash stanu
  węzłów (active / hp / x / y), obrażenia HP i sekwencja zdarzeń (z normalnymi) **identyczne**; z Mjolnirem,
  Valkyrie i Vulcanem — różne (oczekiwane). Harness: `bitwa`, `bitwa-blisko`, `wybuch`, `wraki`, `warp` — stan gry
  (`stan.suma`, NPC, wraki, pociski) identyczny z `main` (domyślne loadouty NPC nie mają broni z mechaniką).
- Piaskownica prawdziwej pętli gry (`tests/projectileMechanicsGame.test.mjs`) daje te same obrażenia, kratery
  (liczba węzłów) i zdarzenia co wzorzec `tests/helpers/hullFlight.mjs`, więc liczby bilansu z §6 obowiązują grę
  (`scripts/bilans-broni.mjs` po 18-B — wynik bit w bit jak przed).

### 8.2 Ładowanie (`weaponCharge.js` → gracz, P2, AI, HUD)

- Stan ładowania na hardpoincie: `getMountedWeaponAim(ship, loadout).charge` (`mountChargeState`), błąd
  celowania wieżyczki po kroku: `aim.aimErr` (`stepMountedWeaponAim`).
- Gracz: `_fireSpecialGroup(loadouts, manual)` dla broni z `chargeTime` tylko zgłasza (`requestMountCharge`);
  `updateSpecialWeaponCooldowns` → `stepSpecialCharge` co krok fizyki (przed licznikiem przeładowania):
  `stepMountCharge` → strzał (`fireSpecialLoadout` — ta sama salwa co dotąd), efekt `WeaponFx.charge` z wylotu
  lufy i nośnikiem okrętu, komunikat (jeden na krok dla grupy). Klawisze 2 i 5 = naciśnięcie (`manual`),
  auto-fire i spust pada zgłaszają co krok bez komunikatów. Naciśnięcie czeka do 1,5 s
  (`MOUNT_REQUEST_HOLD`), aż wieżyczka dojdzie do celu (≤ 0,08 rad). Skok (`warp.isBusy()`), śmierć i zniszczony
  zaczep przerywają. Ładowanie rusza dopiero po przeładowaniu (jak w demie).
- P2: `WeaponController.tryFireSpecialWeapons` / `update` → `_stepSpecialCharge` (efekt przez `window.WeaponFx`).
- AI: `capitalAI.processAutonomousWeapons` — działo gotowe, cel i czysta linia ognia → `stepNpcWeaponCharge`
  (strzał po naładowaniu, `requiresStationary` z |v| i ω okrętu; bez celu — przerwane), efekt przez hak gry
  `window.spawnWeaponChargeFx`. Domyślne loadouty NPC takich broni nie mają — ścieżka uśpiona.
- HUD (`_specialHudFromEntries`): w trakcie ładowania pasek slotu = postęp ładowania (`charging: true`).
- Komunikaty: „MJOLNIR: ŁADOWANIE — OKRĘT MUSI STAĆ” (start, broń ≥ 1 s), „…: WYMAGA POSTOJU OKRĘTU”
  (naciśnięcie w ruchu, przerwanie ruchem), „…: BRAK WYCELOWANIA” (naciśnięcie wygasło, naładowane zgasło po 2 s).

### 8.3 Seria Hexlance'a

`prepareSuperweaponSalvo` = `buildHexlanceBurst(HEXLANCE_DEF, gniazda, superweaponState.queue)`: 4 strzały co
0,25 s na gniazdo (Atlas: 1 gniazdo), podgląd ładowania przed każdym strzałem serii zostaje, przeładowanie 6 s
rusza po serii.

### 8.4 Odrzut, wstrząs, skala trafienia (18-D, `src/game/weaponFeel.js`)

- `recoil` / `shake` z danych broni: Turret2D (odrzut lufy i wstrząs strzału — kanał `__weapon3dCameraShake`;
  cache opisu broni śledzi pola), Hexlance (`camera.addShake(shake)`, `recoilOffset += recoil`). `FX_PROFILE`
  w `turret2D.js` = same klucze wieżyczek. Zmiana względem gry sprzed 18-D tylko dla broni bez dawnego wpisu
  FX_PROFILE (fallback 3 / 1,8 → wartości rodziny z dema): Tempest S/L 4 / 2,5, Helios S / Lance 6 / 3,
  Gatling S 3 / 2, Autokanon L 8 / 4, CIWS Mk II 1,5 / 1.
- `impactScale` (Mjolnir 5, Yamato 4,5, Valkyrie 3,5, plazmowy gatling 1,5, armata / Goliath 1, wiązki 0,4 / 0,7,
  reszta 1): rozmiar efektu w bramce LOD trafienia pocisku (`spawnBulletImpactEffect`) i wstrząs receptury przy
  trafieniu, wyjściu i zakleszczeniu (`WeaponFx._shakeScale`); cząstek receptur nie mnoży. Wstrząs trafienia
  (gdy strzelał gracz albo oberwał; kamera: 0,5 px na jednostkę, sufit 16 px): Mjolnir 10 → 50 (5 → 16 px),
  wyjście Mjolnira 8 → 40, Yamato 12 → 54 (6 → 16 px), Valkyrie 5 → 17,5 (2,5 → 8,75 px). Wiązki nie idą przez
  bramkę pocisków — ich `impactScale` dziś nic nie zmienia.

### 8.5 Decyzje 18-B / 18-D (samodzielne, do przejrzenia)

1. Mechanika tylko na kadłubach belkowych; cel bez kadłuba (myśliwiec) i heksy — jak dotąd (Mjolnir przez
   myśliwce dalej po staremu: `penetration` jako licznik celów bez kadłuba).
2. Pocisk w materiale nie widzi innych kolizji w kroku; kolejny kadłub w tym samym kroku po wylocie (≤ 12 przebiegów).
3. Krater wejścia z prędkością pocisku przed hamowaniem w materiale (wzorzec 18-A liczył po nim — różni się tylko
   długość wektora wgniecenia Valkyrie; Mjolnir bez hamowania — identycznie).
4. Rzaz na ekranie przerzedzony do gęstości dema (co v/240 j.: Mjolnir ~104 j., Valkyrie ~62 j.); licznik
   mechaniki (co 22 j., krater nie zależy od rzazu) bez zmian. Bez tego kolumna kadłubów zalewała kadr bielą.
5. Obraz rykoszetu tylko z decyzji gry; receptura Vulcana nie losuje już własnych rykoszetów (także na
   asteroidach i stacjach — tam mechaniki nie ma). Smugowiec przepada, gdy bramka / budżet efektu odrzuci trafienie.
6. Naciśnięcie broni z ładowaniem czeka do 1,5 s na wycelowanie wieżyczki (demo wymagało trzymania spustu);
   komunikaty tylko dla naciśnięć i przerwań, jeden na krok dla grupy zaczepów.
7. AI ładuje tylko przy widocznym celu i czystej linii ognia; cel znika — ładowanie gaśnie.
8. `impactScale` mnoży wstrząs trafienia bez dodatkowego limitu (sufit 16 px robi kamera) — Mjolnir i Yamato
   gracza dochodzą do sufitu (w demie 10–12 px bez mnożnika).
9. Stan przejścia przez materiał (`b.pen`) to jeden obiekt na pocisk przebijający (Mjolnir co 11 s, Valkyrie co
   3,3 s) — bez puli.
10. Rykoszet zostawia na mapie ran płytkie osmalenie (wariant `ricochet` Vulcana / Gatlinga S), nie ranę trafienia
    jak w demie — pocisk odbił się, poszycie jest tylko przypalone (§8.6).
11. Pas rzazu przebicia stempluje gra (`stampKerf` co krok w materiale, gęstość mapy: co ≤ 22 j., ≤ 8 znaków na
    krok), nie receptura efektu — mapa nie zależy od przerzedzenia i bramki kadru efektu (decyzja 4); receptura
    `kerf` dostaje kadłub `null`, żeby nie stemplować drugi raz.

### 8.6 Mapa ran (18-C) z mechaniką 18-B

Scalenie `main` z 18-C (8f8013d): kratery stempluje hak `HullBodies.onImpact` → `HullDamageMap.onHullImpact`,
rodzinę i wariant podaje `applyHexImpact(entity, x, y, damage, vel, shard, fxSource, fxVariant)` przez
`HullDamageMap.setSource(fxSource, fxVariant)` … `clearSource()`.

| Zdarzenie | Gdzie | Źródło, wariant | Wpis `hullDamageStamps.js` |
|---|---|---|---|
| Trafienie / wejście przebicia | `bulletsAndCollisionsStep` | pocisk, `impact` | rodzina broni, `impact` |
| Rykoszet (Vulcan, Gatling S) | `bulletsAndCollisionsStep` | pocisk, `ricochet` | `vulcan.ricochet` = r 9, żar 0,9, osmalenie 0,3, bez brzegu i otworu, wydłużenie 2,6 wzdłuż lotu (nowy) |
| Wylot | `applyBulletHullPass` | pocisk, `exit` | `mjolnir.exit` (r 56), `valkyrie.exit` (r 28) |
| Zakleszczenie | `applyBulletHullPass` | pocisk, `stuck` | `valkyrie.stuck` (r 40); receptura `stuck` z kadłubem — duplikat tej klatki pomija `_hookedHere` |
| Pas rzazu | `applyBulletHullPass` | `HullDamageMap.stampKerf(e, pierwszy znak, ostatni znak, rodzina)` | `mjolnir.kerf`, `valkyrie.kerf` |

Receptura `kerf` w `WeaponFx.kerf` dostaje kadłub `null` (sam obraz). Testy: `tests/projectileMechanicsGame.test.mjs`
(źródła i warianty kraterów, pasy rzazu z pętli gry), `tests/hullDamageMechanics.test.mjs` (wpisy tabeli przez
hak), `tests/weaponFxPierce.test.mjs` (efekt rzazu bez stempla).
