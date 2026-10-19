---
paths:
  - "src/3d/rockets/**"
  - "src/game/rockets/**"
  - "src/game/barrage.js"
  - "src/game/torpedoAim.js"
  - "src/game/rocketIntercept.js"
---

# Rakiety i torpedy: lot w grze, efekty, salwy, Supernowa, obrona punktowa

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Rakiety (`src/3d/rockets/`, port WebGPU zadanie 19; opis `docs/webgpu/DEMO-RAKIETY.md` § Port w grze)

- Lot, naprowadzanie, trafienia i obrażenia zostają w GRZE — `src/game/rockets/rocketSim.js` (RW-23, 2026-10-15: dawniej `src/effects3d/rocketSystem3D.js`; bez three — `rocketMath.js` z wzorami three r183, wynik bit w bit; profil lotu z `weaponDef`, pula
  rakiet bez pól wyglądu); obraz z dema `rakiety-webgpu` to reżyser `RocketEffects` (`effects.js`) na zdarzeniach lotu
  (`onLaunch / onIgnite / onFly / prepareContact / onDetonate / update`) i krok efektów „rakiety” (`rocketFx.js`): dym compute
  (mapa gęstości, samocień, światło z siatki, siła śladu tylko w dymie > 0,8 s), płomienie, kadłubki (słońce × `sunVisibility`
  + siatka), kule ognia, łuki, mgławica Supernowej, duszki, światła → `grid.addWorld`, fale / implozja / gorące powietrze →
  `Core3D.fxDistortion()`. Rodzaj efektów i barwy reżyser bierze z `weaponDef` (`palette.js`: Supernowa, szybka rakieta,
  `bodyScale`). Zegar reżysera = suma dt klatek reżysera (w pauzie stoi). RW-23 (2026-10-15): LOT W KROKU FIZYKI (`window.rocketSystem3D.step(dt)` w `physicsStep` po `SimClock.advance`, decyzja D2 — trafienia niezależne od fps; pozy w czasie symulacji; pomiar `node scripts/rakiety-d2-fps.mjs`: czas salwa → trafienie ten sam przy 30 / 60 / 144 fps), klatka reżysera raz na klatkę renderu (`frameFx(frame)` w `loop()` przed `render()`); dawny `update(dt)` (lot + klatka reżysera w czasie renderu) zostaje dla dem i testów. Zdarzenia lotu idą do reżysera REKORDAMI RKT_* strumienia rozkazów (adapter gry `src/game/rockets/rocketCommandAdapter.js` → dekoder `src/3d/rockets/rocketFxCommands.js`, rakieta = indeks w puli; kolejność 1:1, także `onFly` każdej rakiety), szarpnięcie kasety wyrzutni (`Turret2D.triggerShot`) robi adapter gry (`director.opts.launcherKick = false` w grze), kilwater torpedy — rekord RKT_WAKE. pozycje w świecie gry (double), do GPU względem
  `Core3D.fx.origin`. Supernowa przygasza obraz i podbija bloom przez `Core3D.fx.post` (exposure = min, bloomBoost = max;
  FxFrame kasuje co klatkę). Losowość efektów z fxRandom — `Math.random` gry (wyrzut) bez zmian.

- **Zero alokacji na klatkę i rakietę:** w pętlach klatki bez liczb zmiennoprzecinkowych w argumentach / wyniku wywołań (V8
  opakowuje je w obiekty, gdy nie wklei funkcji) — wpisy robocze pul (`pool.s` + `push()`), bufor świateł (`stageLights` /
  `flushLights`), kinematyka rakiet w tablicach (`_kin`), liczby losowe `fillRandom` (ten sam ciąg co fxRandom), `Math.sqrt`
  zamiast `Math.hypot`. Harness: sesja „rakiety”. Pułapka (2026-09-30): stała `NaN` złączona z liczbą w jednym wyrażeniu
  (`p.angle = pion ? NaN : kąt`) kazała V8 pakować wynik przy każdej porcji dymu (97 B na rakietę na klatkę) — kąt losowy z bufora.

- **„Feel” rakiet (2026-09-30, `docs/webgpu/DEMO-RAKIETY.md` § Feel):** lot w 4 fazach — ZIMNY WYRZUT z komory pod
  `launchElevation` (90° = VLS) z zawisem (prędkość gaśnie e^(−1,8·t/ignitionDelay)), ZAPŁON, PRZECHYŁ w kurs WACHLARZA salwy
  (`dispersal`, `dispersalTime`, obrót `launchTurnRate`), NAPROWADZANIE (obrót narasta od 40 % przez 1 s — szerokie łuki;
  kluczenie `weave` / `weaveHz` gaśnie przed fazą końcową), ZEJŚCIE na płaszczyznę na granicy zapalnika. Nos sterowany osobno
  KURSEM i WZNIESIENIEM (`noseAz`, `nosePitch` — kwaternion po najkrótszym łuku robił pętle „przez zenit”). Wysokość (Y) to tylko
  obraz: zapalnik, zasięg i trafienia w 2D bez zmian. SALWA = `burstCount` / `burstDelay` broni rakietowej: `fireSalvo`
  (z `fireWeaponCore`) — pierwsza rakieta od razu, reszta z kolejki komór (`launchPorts`, `cellSpacing`) w UKŁADZIE STRZELCA
  (pęd komory v + ω × r; strzelec zniszczony — reszta przepada); myśliwiec — jedna rakieta z belki (`LAUNCH_RAIL`). Amunicja
  zaczepu liczy salwy; ekonomia: `weaponAmmoPerShot` × salwa, mikrorakieta `ordnancePerMissile`, eskadry — `weaponAmmoPerMissile`.
  Losowanie gry: JEDNO ziarno na rakietę / salwę (`seedHash`). Typy: manewrująca (3), szybka (4), Rój (8 mikro, S), Grad
  (24 mikro, L), Hydra (MIRV: nosiciel pęka `splitRange` przed celem na `submunition.count` głowic — `submunitionDef`, efekt
  `onSplit`), Supernova Barrage (4 głowice — niżej). Wygląd: rodzaj z `rocketVfx` (`cruise | fast | supernova | micro | hydra`, `palette.js`), kadłubek
  z wzniesieniem (krążek w pionie → pełna długość) i skrótem perspektywy z wysokości (`LIFT_K`), płomień skrócony cos(el), łuna
  dyszy przy nosie w górę, słup dymu z pionu rozlany na boki, para zimnego wyrzutu, szarpnięcie kasety (`Turret2D.triggerShot`),
  światło dyszy na wysokości rakiety; tłok salw (> 150 rakiet) rzedzi smugi (`beginUpdate`, `crowd`). NPC: pierwsze 2 zaczepy
  rakietowe — broń klasy okrętu (`equipNpcWeapons`: piraci Rój / Grad, Terra Nova szybka / Hydra / Grad). Narzędzia:
  `scripts/webgpu/rakiety-sekwencje.mjs` (klatki w grze: nova, salwa, wachlarz, zbliżenie, torpedy, obciążenie),
  `scripts/rakiety-salwy-sym.mjs` (Node: trafienia, wysokości, rozrzut wachlarza — strojenie pól lotu).

- **Supernowa — wir:** pozostałość (`nebula.js`) kręci się OBROTEM RÓŻNICOWYM (wnętrze rzutu szybciej niż brzeg — włókna
  nawijają się w ramiona), materia ściągnięta przy wybuchu do 2–3 RAMION (ciemne przerwy), przepływ z szumu 3D (przekrój =
  czas), fala jasności przez powłokę, migotanie zagęszczeń, turkusowy brzeg; DŻETY pulsara — cząstki wyrzucane przez całe
  życie wzdłuż obracającej się osi (podwójna spirala), kładzione wzdłuż śladu strumienia; reżyser rysuje tę samą oś jako
  wirujące SNOPY z jądra (`pushStreak`). Parametry wiru per wybuch w cząstkach (`nE.w`, dżety w `nA` / `nE.x`), sekwencja
  `NOVA_SEQ_END` = 2,8 s (2026-10-05, user: wir był za długi — pozostałość 2,2 s; wybuch × `NOVA_SCALE` 2 względem dema,
  rażenie `explosionRadius` 1200 j.).

- **Supernova Barrage** (2026-10-05, user: „4 naraz — do niszczenia grup przeciwników”; id dalej `supernova_missile`):
  salwa 4 głowic, każda na INNY okręt grupy — pole broni `barrage: { radius, spacing }` → `planBarrageSalvo` (`index.html`,
  przy `fireSalvo` w `fireWeaponCore`; tylko strona gracza, gdy kierowanie ogniem nie rozpisało już salwy —
  `rocketSystem3D.hasSalvoPlan`) → `planBarrageTargets` (`src/game/barrage.js`, czysty): pierwsza w cel salwy, kolejne
  zachłannie najdalej od wybranych punktów wybuchu w promieniu `radius` (wróg bliżej niż `spacing` od wybranego punktu
  stoi w jego fali — pomijany), reszta w okręty o największej potrzebie, bez wroga — okrąg wokół punktu. MAGAZYNEK:
  2 salwy po 4 (`ammo: 2`, user: „2 salwy po 4”) — rakieta specjalna zużywa `hp.ammo` w `fireSpecialLoadout`, pusty
  magazynek blokuje `5` (komunikat „MAGAZYNEK PUSTY”), magazynek zaczepu `special_missile` zawsze z karty broni
  (`setHardpointMount`), slot 5 kokpitu pokazuje „×n” i gaśnie przy zerze. Uzupełnienie — jak reszta rakiet, dopiero
  przy nowym wyposażeniu (start kampanii / montaż u mechanika). Kandydaci:
  wrogowie bez wraków, hulków mostka i ukrytych mgłą wojny (`SensorSystem.hides`). Pozostałość: 64 000 cząstek na nową
  (`NOVA_REMNANT_PARTICLES` — 4 mieszczą się w pierścieniu `NEBULA_CAP`). FALA i HAZE wzmocnione (`NOVA_SHOCK`,
  `NOVA_HAZE` w `effects.js`: fala 55 px + fala odbita, haze 13 px) z sufitem z zoomu (siła w px ekranu — przy dalekim
  zoomie cienki front / drobny wzór zawijały obraz); haze Supernowej ma grubszy wzór (`scale` 0,3 — nowy parametr
  `DistortionField.heat(…, scale)`, `C.w` źródła; 1 = wzór dema bit w bit) — bez niego 4 nakładające się haze dawały
  „wafel” (A/B 2026-10-05). Test: `tests/barrage.test.mjs`.

- **Obrona punktowa kontra rakiety 3D** (2026-10-12; dawniej PD widziało tylko rakiety / torpedy z `bullets` — salw 3D nie
  dało się zestrzelić): `rocketSystem3D.syncThreats(graczBufor, wrogBufor, SimClock.sim, widać)` w `ciwsStep` dopisuje rakiety
  w locie do `_pdPlayerRocketBuffer` / `_pdEnemyRocketBuffer` (= `window.__playerRocketThreats` / `__npcRocketThreats` dla AI)
  jako ZASTĘPNIKI w kształcie pocisku (`x, y, vx, vy, ivx, ivy, r, life, dead, owner, type: 'rocket', rocket3d, slot` — jeden
  obiekt na rakietę, pozycja dosunięta do czasu kroku fizyki; wroga rakieta poza wzrokiem strony gracza — `SensorSystem.pointVisible`
  — nie jest celem). Promień celu PD `pdRadius` = 2 + 4 × `bodyScale` (mikrorakieta ~3,5, manewrująca 6, Supernowa ~10; pole
  karty broni bierze górę). Trafienie PD: `killRocketThreat(rb, przyczyna, skala, obrażenia)` (`index.html`) — rakieta 3D →
  `rocketSystem3D.pdHit(rb, przyczyna, obrażenia)` — model jak w Starsectorze, bez rzutu kością (decyzja użytkownika 2026-10-12,
  wariant V3): rakieta ma PUNKTY ŻYCIA PD (`ROCKET_PD_TUNE.hpById[id]` → pole karty `pdHp` → `hpDefault` 20; manewrująca 60,
  Hydra przed podziałem 60, szybka 40, Supernowa 80, mikrorakiety Grad / Rój / głowice Hydry 20 — kruche, zalewają obronę
  liczbą), trafienie zdejmuje obrażenia broni PD × `dmgMul[ciws|laser|flak]` (1 / 0,5 / 0,025 — mocniejsze działo zabija
  szybciej, premie broni wchodzą w obrażenia; flak ze spadkiem w kuli odłamków); FLAK bierze rakietę za cel tylko do
  `flakRocketRange` (0,6) × zasięgu działka — pasmo obrony punktowej (Perun 5,2 → 3,1 km), myśliwce w pełnym zasięgu
  (`ciwsStep`, `processAutonomousWeapons`); `window.RocketPdTune` = strojenie na żywo → `intercept` (znika BEZ detonacji i obrażeń: Hydra przed podziałem razem
  z głowicami, Supernowa bez wybuchu; obraz `RocketEffects.onIntercept` — błysk, iskry, sadza; liczniki
  `rocketSystem3D.stats.intercepted`), rakieta kanwy — efekt trafienia i `life = -1`. Wpięte: pociski CIWS KAŻDEJ strony (pętla pocisków, test na odcinku kroku w ruchu względnym —
  `src/game/rocketIntercept.js`; sam punkt końcowy trafiał przypadkiem), laser PD gracza, laser PD NPC (`resolvePdBeamHit` →
  `kind: 'rocket'` przy kierunku lufy ≤ `PD_LASER_ROCKET_AIM_TOL` od rakiety), flak (pęknięcie zdejmuje rakiety w kuli
  odłamków). AI PD (`processAutonomousWeapons`): rakieta zestrzelona w tym kroku przez inną lufę (kilka luf wybiera tę
  samą) — bez strzału i bez przeładowania, nowy cel od razu. Zastępnik zestrzelonej / zakończonej rakiety ma `life = -1`, `dead = true` — nowy konsument buforów zagrożeń
  sprawdza jedno z nich i niszczy rakietę TYLKO przez `killRocketThreat`. A/B balansu: `rocketSystem3D.pdTargets = false`
  (rakiety 3D poza PD jak przed zmianą). Fregaty NPC robią unik przed rakietą 3D (`tryRocketDodge` czyta te same bufory).
  Testy `tests/rocketPointDefense.test.mjs`; w grze `node scripts/webgpu/pd-rakiety-gra.mjs [--tryb strzelnica,ttk,fala] [--ab 1]`
  (salwy każdego rodzaju w Atlasa, pancernik Terra Nova i piratów, czas zabicia niszczyciela salwami Grad, fala odwetu misji 2;
  `--tune` — strojenie bez zmiany plików).

- **Torpedy — tryb celowania jak w World of Warships (`src/game/torpedoAim.js`, blok „TORPEDY: TRYB CELOWANIA” w index.html):**
  klawisz `8` — tryb (ponownie: wąski ↔ szeroki wachlarz, `torpedoSpread`), LPM — wachlarz `burstCount` NIEKIEROWANYCH torped
  z każdej gotowej wyrzutni (bullets, `target: null`, `turnRate: 0` — trafiają to, na co wpadną), PPM — wyjście. Wyrzutnie torped
  (gniazda rakietowe z bronią kategorii `torpedo`) celuje kursor (`WeaponController.updateAim`), PPM rakiet ich nie odpala.
  Nakładka `drawTorpedoOverlay`: wachlarze do zasięgu (cyjan gotowa / żółty obrót / czerwony przeładowanie), „duch” celu w punkcie
  przechwycenia (`solveTorpedoLead` — układ wyrzutni) z czasem dolotu, pasek trybu. Kilwater torped = dym rakiet
  (`RocketEffects.torpedoWake`, z pętli pocisków — też przy pocisku rysowanym w 3D). Haki `?dev`: `DevScene.mountMissile(id)`,
  `DevScene.pointerAt(x, y)`, `window.setTorpedoMode`, `window.fireTorpedoSalvos`.
