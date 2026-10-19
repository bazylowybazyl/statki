---
paths:
  - "src/game/projectile*.js"
  - "src/game/weaponCharge.js"
  - "src/game/weaponFeel.js"
  - "src/game/carrierVelocity.js"
  - "src/game/simClock.js"
  - "src/game/friendlyFire.js"
  - "src/vfx/collisionSparks.js"
  - "src/game/deathRay.js"
---

# Pociski, kolizje i nośnik prędkości: przebicia, rykoszety, IFF, ładowanie broni

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pociski, kolizje, efekty

- Tablice `bullets`, `particles`.

- **Pocisk kontra cel w RUCHU WZGLĘDNYM** (2026-10-11): ruchome cele (gracz, gracz 2, wraki, NPC) przesuwają się w kroku PRZED `bulletsAndCollisionsStep`, a pętla kandydatów sprawdza je w pozie z końca kroku — więc odcinek pocisku w układzie celu zaczyna się `b.px + v_celu · t_odcinka` (`segX0 / segY0`, `projectileStepSpan` z `projectileTrajectory.js` — pocisk wystrzelony w kroku leci jego część); odcinek w świecie dawał odwrotny wynik na pasie v_celu·dt przy dziobie i rufie (fregata 1400 j/s przy 60 Hz: ~10% pocisków lecących na kadłub). Po wylocie z przebicia (odcinek od punktu wyjścia) — bez poprawki. Nowy test pocisku przeciw celowi w tej pętli — z `segX0`, nie `candX0`. Test: `tests/projectileMechanicsGame.test.mjs` („w poprzek kursu szybkiego celu”).

- `bulletsAndCollisionsStep(dt)` — ruch, trafienia, eksplozje, applyImpact.

- **Friendly fire i IFF lekkiej broni** (2026-10-11, `src/game/friendlyFire.js`; zgłoszenie „moje myśliwce mnie biły, mój CIWS atakował moje myśliwce”): friendly fire zostaje dla ciężkich dział okrętów (filtr drużynowy pocisków usunięty celowo 2026-03-15), flak — `FLAK_TUNING.FRIENDLY_FACTOR`. Broń MYŚLIWCÓW i pociski CIWS nie ranią własnej strony: pętla kolizji pocisków (`projectilePassesAlly`), wiązka (`beamPassesAlly` w `resolveBeamWorldHit`), rakiety 3D (`fighterSideSparesAlly` — strona zapamiętana przy wyrzucie w `r.fighterSide`, bo `shooter` jest zerowany po wyrzucie; trafienie głowicy i wybuch). **Nowa broń albo ścieżka obrażeń myśliwców → ten sam filtr z `friendlyFire.js`.** Myśliwce z hangarów gracza mają `playerOwned` — `resolveEntityFaction` zwraca null: reputacja ich nie przestawia na wrogie, a ich strata jej nie obniża (dawniej liczone jako Terra Nova — kilka strat od własnego ognia → TN „Wrogi” → eskadra biła gracza, CIWS i wieże w nią celowały). Nowa jednostka gracza poza frakcjami — `playerOwned = true`. Pomiar: `node scripts/webgpu/mysliwce-iff-gra.mjs [--przed 1] [--karta missile]`, testy `tests/friendlyFire.test.mjs`.

- Efekty zderzeń kadłubów idą przez `CollisionFX` (`grind` co krok styku, `impact` raz na zetknięcie). `bounceForce` w zdarzeniu to IMPULS (masa × v; na belkach 10⁵–10⁶) — nie skaluj nim efektów. Iskry tarcia (`src/vfx/collisionSparks.js`): budżet = TEMPO z prędkości styku (`COLLISION_SPARKS_TUNE`) w czasie symulacji pary, plus jednorazowy snop na `impact`; jasność iskry przez `gain` w `SparkSystem3D.emit` (atrybut `iGain`, tarcie < 1, trafienia 1). Dawny budżet „na wywołanie z impulsu” sypał 6–10 tys. iskier/s przy zwykłym taranie.

- Iskry (`SparkSystem3D`, API bez zmian) od zadania 19 na puli z dema rakiet (`src/3d/rockets/sparks.js`) w scenie Core3D (krok efektów „iskry”, zegar efektów — biegnie też w pauzie): barwa PER ISKRA — `emit(..., gain, [r, g, b])` albo barwa domyślna (`setColor`), `burst(..., kolor)` barwi tylko swoją serię (dawniej przemalowywał wszystkie żywe); losowość z fxRandom; pętle klatki piszą przez `stage()` + `pushStaged()`.

- Żar skóry kadłubów belkowych: szczyt `HULL_BODY_CONFIG.heatGlowPeak`.

- **Przebicia i rykoszety (mechanika z dema, zadanie 18-B, `src/game/projectileMechanics.js`, opis `docs/webgpu/MECHANIKA-BRONI.md`):** dotyczą tylko pocisków z `mech` (broń z `penDepth` albo `ricochet`: Mjolnir, Valkyrie, Vulcan, Gatling S) na kadłubach belkowych; reszta arsenału trafia bit w bit jak przed 18-B. W `bulletsAndCollisionsStep`: pocisk w materiale (`b.pen`) kroczy `stepInsideHull` (hamowanie, rzaz, wyjście / zakleszczenie → `applyBulletHullPass`: krater BEZ HP, efekt) i nie widzi innych kolizji; trafienie w kadłub → `resolveHullHit` (rykoszet: hash `b.serial` + węzeł, bez Math.random, × 0,3; przebicie: droga w materiale liczona PRZED kraterem wejścia; limit kadłubów = `penetration`), po wylocie kandydaci od punktu wyjścia w tym samym kroku (pętla `hullPass`). Nowe źródło pocisków w `bullets` nadaje `serial: nextProjectileSerial()`, `mech: hasHullMechanics(def) ? def : null`, `pen: null` (wzór: `fireWeaponCore`).

- **Ładowanie i serie (zadanie 18-B, `src/game/weaponCharge.js`):** broń z `chargeTime` (Mjolnir 3 s z `requiresStationary` — |v| ≤ 30 j/s, |ω| ≤ 0,05 rad/s; Valkyrie 0,28 s) nie strzela z naciśnięcia: `_fireSpecialGroup` / `WeaponController.tryFireSpecialWeapons` tylko zgłaszają, ładowanie i strzał idą w kroku fizyki (`stepSpecialCharge` w `updateSpecialWeaponCooldowns`, `WeaponController.update`, AI — `stepNpcWeaponCharge` w `capitalAI`); stan na hardpoincie (`getMountedWeaponAim(...).charge`), bramka celowania z `aim.aimErr` (`weaponAim.js`), HUD — postęp ładowania. Seria Hexlance'a z danych (`burstCount` × `burstDelay`, `buildHexlanceBurst` w `prepareSuperweaponSalvo`) — od 2026-09-29 `burstCount: 1` (jeden strzał na gniazdo, decyzja użytkownika; mechanizm serii zostaje dla innych broni).

- **Odrzut, wstrząs, skala trafienia — tylko dane broni** (`recoil`, `shake`, `impactScale` w `MASTER_WEAPONS`, odczyt przez `src/game/weaponFeel.js`, zadanie 18-D): Turret2D (odrzut lufy, wstrząs strzału → akumulator gry `WeaponShotShake`, RW-30), Hexlance, bramka `spawnBulletImpactEffect` (rozmiar × `impactScale`) i `WeaponFx.impact` (wstrząs trafienia × `impactScale`). `FX_PROFILE` w `turret2D.js` trzyma już tylko klucze wieżyczek — nie dopisuj tam liczb.

## Promień śmierci: czoło promienia, tarcze, rzaz belek (`src/game/deathRay.js`, 2026-10-19)

- To NIE pocisk w `bullets` ani wiązka `resolveBeamWorldHit`: `fireWeaponCore` oddaje broń z polem `deathRay` systemowi promieni (`createDeathRaySystem(env)`, klej gry w index.html — blok „PROMIEŃ ŚMIERCI” przed pomocnikami wiązek, `deathRays.step(dt)` w `physicsStep` po `npcShootingStep`). Promień = odcinek od wylotu (przesunięcie w układzie strzelca — jedzie z kadłubem) w STAŁYM kierunku świata; czoło `frontSpeed` j/s przetwarza w kroku odcinek [poprzednie, nowe czoło]: stacja na drodze kończy promień (obrażenia raz), kandydaci (gracz, P2, NPC, wraki — bez strzelca) w kolejności wejścia; pierwszy kontakt z obwiednią (kadłub ∪ tarcza + pas) liczy `HullBodies.traceThrough` po cięciwie PRZED rzazem (do 6 odcinków materiału — wejście, wyjście, droga), okręt ponad `penetration` zatrzymuje promień na wejściu (`HullBodies.impact` z `craterRadius` = `endCrater`, ułamek `endDamageFrac`).
- Tarcza: blokująca w chwili kontaktu PADA DO ZERA, gdy czoło dojdzie do jej obrysu (`getEntityShieldRayEnter`; efekt `registerShieldImpact` klasy „special”, `regenTimer` od nowa) — świadomie bez testu przebicia `isShieldBreachedAt` (superbroń przepala pole); obrażenia kadłuba idą z `bypassShield`.
- Rzaz: `HullBodies.cutSegment(…, cutHalfWidth, { push: true })` na części kroku w [wejście − pas, wyjście + pas], źródło mapy ran `HullDamageEvents.setSource(broń, 'kerf')`; obrażenia przy wyjściu czoła (albo końcu promienia w środku celu): baseDamage × min(1, droga / `fullDepth`) ≥ `minFrac` przez `applyDamageToNPC(…, 'deathray', SHIELD_BREACH_DAMAGE_OPTS, byPlayer)` / `applyDamageToPlayer` (+ stempel `__fcHitPlayerAt` strzelca NPC) — śmierć, `createWreckage` (wrak) i wybuch zbiornika paliwa jak przy każdej śmierci; odcięte części to wraki z rozpadu (`onWreck`, pęd brzegu rzazu). Wraki cięte bez obrażeń i bez liczenia do przebić; cel bez kadłuba (myśliwiec) — obrażenia przy przejściu czoła. Friendly fire jak ciężkie działa okrętów (AI sprawdza linię ognia przed strzałem).
- Rozkazy scen: `order(strzelec, cel, opts)` — ładowanie przy wylocie strzelca (`env.muzzleOf` — gniazdo z promieniem / special + lufa sylwetki, inaczej dziób), strzał w AKTUALNĄ pozycję celu; `visual(x0, y0, x1, y1, opts)` — sam obraz (rekord z flagą VISUAL). Bez Math.random i bez alokacji w kroku (pule promieni 16, celów 32 na promień, rozkazów 16). Testy: `tests/deathRay.test.mjs` (prawdziwy kadłub belek pancernika z `tests/helpers/reactorHulls.mjs`).

## Nośnik prędkości: pociski i efekty lecą z tym, z czego wyszły

- Pocisk dziedziczy 100% prędkości lufy (ruch + obrót kadłuba, `writePointVelocity`, `src/game/carrierVelocity.js`) i niesie znaczniki: `ivx/ivy` (odziedziczona część), `clock` (gracz/P2 — `CLOCK_RENDER`, reszta `CLOCK_SIM`), `bornSim` (czas pozy lufy). Nowe źródło pocisków robi to samo — bez znaczników smuga, zasięg i kierunek trafienia liczą się w świecie.

- Efekt rodzi się z nośnikiem: `ActiveCarrier.set(writeCarrier(encja, x, y, zRekorduRenderu, scratch))` → spawn → `ActiveCarrier.clear()`, bez wołania w środku innych emiterów. Czytają go Fx3D, CanvasVFX, SparkSystem3D i pule broni `WeaponFx` (paczka niesie nośnik — `writeCarrierPacket`, rysunek `fxCarrierOffset`). Wylot = kadłub strzelca, trafienie = trafiony kadłub, pęknięcie i odłamki pocisku = jego `ivx/ivy`. Dysze MAIN celowo bez nośnika (smuga ma zostawać za statkiem).

- Rysowanie: `pos + v · (T − t0)` z `SimClock` (`src/game/simClock.js`): `sim` rośnie w `physicsStep` zaraz po całkowaniu pozycji gracza, `render` = czas interpolowanej pozy gracza (`beginRender` przed `render`). Nie przesuwaj niesionych efektów zegarem klatki — rozjadą się z kadłubem w pauzie i przy interpolacji. Czas pozy: z rekordów Turret2D `fromRender = true`, z pozy fizycznej `false`.

- Wyprzedzenie liczy ruch celu WZGLĘDEM strzelca (`getLeadAim(..., shooterVel)`, `leadTarget`), smuga pocisku = ruch względem strzelca, kierunek wgniecenia = prędkość pocisku względem celu, zasięg Hexlance'a i rakiet = droga własna.

- Rakiety 3D: `rocketSystem3D.fire(..., launchVx, launchVy)` — układ rakiety to pęd wyrzutni (stały, bez dopasowania do celu), lot kinematyczny w nim; przy wyrzutni w spoczynku zachowanie jak dawniej. Canvasowe rakiety i torpedy naprowadzają ruch własny w układzie `ivx/ivy`.

- Efekty rakiet (zadanie 19) niosą nośnik jawnie: smuga, wyrzut, zapłon i wybuch w próżni — układ rakiety (`r.frameVel`); wybuch na kadłubie i receptura tarczy — trafiony kadłub (`vx / vy`), iskry trafienia w gracza w `CLOCK_RENDER`, w NPC w `CLOCK_SIM`; pozostałość Supernowej stoi w świecie (jak w demie).
