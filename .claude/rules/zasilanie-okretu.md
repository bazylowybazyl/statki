---
paths:
  - "src/game/shipPower.js"
  - "src/game/hullPower.js"
  - "src/game/gasCover.js"
  - "src/game/shipAlarms.js"
  - "src/data/shipDeckLights.js"
  - "scripts/lampy-pokladowe.mjs"
  - "scripts/webgpu/zasilanie-gra.mjs"
  - "tests/shipPower.test.mjs"
  - "tests/powerSignature.test.mjs"
  - "tests/shipDeckLights.test.mjs"
---

# Zasilanie okrętu: włącz / wyłącz, sygnatura i gaz, lampy pokładowe, alarmy, prąd z siatki belek, reflektor dziobowy

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i pomiary — do `docs/`.

## Decyzje użytkownika (2026-11-11)

- Okręt da się włączyć i wyłączyć; wyłączony wygląda inaczej i ma mniejszą sygnaturę radarową.
- Wyłączenie gasi WSZYSTKO NARAZ: silniki MAIN i SIDE, tarczę, broń z obroną punktową, systemy F, skan X, hangary, drony, maskowanie, wydobycie, zbiórkę i reflektor.
- Sygnatura spada TAK SZYBKO JAK GASZENIE (nie 15 s). Scenariusz: „ktoś cię goni, wchodzisz w chmurę gazową, wyłączasz i jest cisza”.
- NPC dostaje tę samą OPCJĘ (`ShipPower.off / on`), żaden mózg jej dziś nie używa. Używa jej fabuła: okręty w doku bazy piratów (misja 1) stoją wyłączone do alarmu (reguła `fabula`; `storyPowerNpc` / `storyPowerOnNow` w `index.html`). Flaga `__powerManualIgnite` — rozruch NPC NIE odpala silników sam (zapłon robi właściciel, np. zegar wodowania).
- Obraz czujników (`sensorPicture`, czujka i granice w grze) liczy zasilanie jak AI: moc × `powerSensorMul`, ślad × `powerSignatureMul` × reflektor (adaptery w bloku „ZASIĘG RADARÓW” `index.html`).
- Wieże bez zasilania przestają strzelać (część kadłuba odcięta od komory reaktora).
- Przyjęte: lampy pokładowe (mini lampy oświetlające kadłub — mostek, reaktor, broń, hangary), alarmy (jeden naraz, po kilku sekundach ciszej), migotanie świateł przy trafieniu dużego kalibru, reflektor dziobowy za myszą (podnosi sygnaturę), lampki gotowości przy wieżach, czerwone światło bojowe floty, reflektory podejścia w K-7, miganie lamp zatok przed wyrzutem kapsuł, iskry przy ranach zasilanej części.

## Stan zasilania (`src/game/shipPower.js`, czysty)

- Automat na encji `shipPower { state, t, serial }`: PRACA → GASZENIE (`shutdownTime` 2 s) → WYŁ. → ROZRUCH (`startupTime` 5 s) → PRACA. Encja bez stanu = PRACA. Strojenie `SHIP_POWER_TUNE` (konsola `ShipPowerTune`).
- Bramki rozgrywki: `shipPowerOn` — systemy (broń, PD, tarcza, F, skan, hangary, drony) tylko w PRACY; `powerAllowsEngines` — silniki od `enginesAt` (70%) rozruchu; `powerSignatureMul` — 1 w pracy i rozruchu, w gaszeniu gładko do `offSignature` 0,3; `powerSensorMul` — wyłączony ma tylko czujniki bierne (× 0,6).
- KANAŁY ŚWIATEŁ z samego stanu i czasu fazy: `shipPowerLook(state, t, out)` — `front` (czoło fali od reaktora: lampa w odległości d świeci przy d ≤ front, `powerWaveAt`), `reactor`, `bridge`, `flood`, `flicker`, `nav`, `emergency`, `level`. Ta sama funkcja liczy po stronie gry i renderu — do workera idą dwie liczby (ENT `PWR_STATE`, `PWR_T`).
- WYŁĄCZNIK W KOKPICIE (prośba użytkownika 2026-11-11: „dodaj do UI pod licznik wyłącznik”): przycisk `#pwrSwitch` pod odczytem prędkości w kopule licznika (`src/ui/cockpitUI.js`, styl `.power-switch` w `assets/css/cockpit-ui.css`) — klik = klawisz − (`dispatchGameKey('Minus')`, te same bramki), stan z `sysData` (`power`, `powerLeft`): PRACA zielona, ROZRUCH z odliczaniem i GASZENIE bursztynowe (miga), WYŁ. czerwona. Kokpit żyje w shadow DOM — narzędzia sięgają po przycisk przez `cockpitUI.els.pwrSwitch`.
- Gra (`index.html`, blok „ZASILANIE OKRĘTU”): klawisz − (`ship.power`), `PlayerPower` / `ShipPower` w konsoli, `stepPlayerPower` w `physicsStep` przed autopilotem i silnikami. Wyłączenie (`entityPowerDownEffects`) gasi silniki (`shutdownEngine`), zakłada tarczy wymuszenie z własnością zasilania (`__powerShieldOff` — wymuszeń sceny dźwięków i konsoli nie zdejmuje), kasuje TRAVEL, autopilot, ładowanie warpa, dopalacz, skan, maskowanie, wydobycie, torpedy, kolejkę startów myśliwców, drony i superbroń. Koniec rozruchu zdejmuje tarczy wymuszenie; NPC sam odpala silniki od `enginesAt`.
- Lot wyłączonego gracza (`_unpowered` w `physicsStep`): wejście dysz zerowane, stabilizator, tłumik C, hamowanie obrotu i regulator prędkości bez mocy — okręt dryfuje (opór liniowy świata zostaje). NPC wyłączony (`npcStep`): bez mózgu, broni i modelu lotu — dryf jak hulk, `aiOffStepEligible` go pomija.
- Bramki broni: `env.canFire` kierowania ogniem, `_fireSpecialGroup`, ładowanie specjali, Hexlance, rakiety, torpedy, `ciwsStep` (po `syncThreats` — bufory rakiet czytają też NPC), energia, hangary, drony R, zbiórka, F, skan, tryby (maskowanie, wydobycie, torpedy, hipercruise), dopalacz, TRAVEL; zabezpieczenie na końcu — `fireWeaponCore` (strzelec z `shipPower` bez pracy). NPC — `processAutonomousWeapons` (`capitalAI.js`).

## Sygnatura i osłona gazu (prawdziwe wykrywanie)

- `fleetAwareness.js`: hak `setAwarenessSignatureHook(fn)` — gra liczy `__sigMul` bytu raz na odświeżenie obrazu AI: zasilanie × osłona gazu × reflektor (`__spotSigMul`); `detectedBy` mnoży zasięg przez `__sigMul`. Bez haka i w stanie neutralnym mnożnik 1 — wykrywanie bit w bit jak dawniej.
- Mgła gracza (`fogOfWar.js`): koło wzroku × `__sigMul` bytu z podłogą `visionSigFloor` 0,5 (`fogPointVisibleMul`), strefy fabuły bez mnożnika.
- Osłona gazu (`src/game/gasCover.js`, `gasCoverAtGame` w index.html): obwiednia z pola pasa i pola ringu w budowie — ten sam wzór co wejście obrazu gazu (`sampleEnv`), nie zależy od kamery ani opcji grafiki; cienka mgła pasa ~0, gęste skupisko pełna osłona (sygnatura × 0,4). Chmury gazu są tylko w pasie asteroid i przy ringu Jowisza w budowie. Kanały wyżłobione przez okręty są tylko w obrazie (D7 planu gazów). Ścieżki AI, które nie pytają o wykrycie (wieże NPC w zasięgu broni, myśliwce, misja najemnika, uraza ruchu, `_detected` misji 1), mnożnika nie widzą — do decyzji przy wpięciu modelu czujników (reguła `zasieg-czujnikow`).

## Obraz

- Shader kadłuba (`hexShips3D.tsl.js`): slot `HullObjectStore` ma 25 vec4 — `uPowerA` (czoło fali, lampy, nawigacyjne, tryb bojowy) i `uPowerB` (migotanie, liczba WŁASNYCH lamp payloadu); własne lampy × kanał (reflektory × lampy, nawigacyjne × nav), cudze bez zmian. Wartości pisze `syncEntityPowerUniforms` (`hexShips3D.js`); tryb bojowy (światło bojowe floty albo alarm) przechodzi w 1,2 s. Proxy ruchu — stała praca.
- LAMPY POKŁADOWE: typ 4 w pętli lamp kadłuba — świeci w dół na blachę (plama `DECK_LIGHT_LOOK.spread` × promień), jasność = kanał lamp × fala od reaktora (`d` lampy) × migotanie świetlówki w rozruchu (siła z `uPowerB.x`, ziarno lampy), barwa rejs (ciepła biel) → bojowa przygaszona czerwień. Miejsca: `SHIP_DECK_LIGHTS` (`src/data/shipDeckLights.js`, generator `node scripts/lampy-pokladowe.mjs --zapisz [--podglad .tmp/lampy-pokladowe/podglad]`: mostek, reaktor, skupiska broni i hangarów, grzbiet; `d` — odległość od obudowy rdzenia), rodzaj `deck` bloku lamp (`shipLightRuntime.js`) po kluczu kadłuba z lamp nawigacyjnych (`navLightHullKeyOf` — marker z tabeli albo kopia po miejscu), tylko w payloadzie własnego kadłuba (bez billboardów, grup i siatki), mocowania jak inne lampy. Nowy kadłub albo sprite → przeliczyć tabelę (strażnik `tests/shipDeckLights.test.mjs`).
- Światła zewnętrzne (`entityPowerLightGain` w `shipLightRuntime.js`): billboardy i rozlew lamp nawigacyjnych × nav, reflektory i światło dookoła okrętu w pasie × kanał lamp, migotanie po trafieniu przygasza. Dysze SIDE i płomyk dyżurny MAIN wyłączonego okrętu gasną (`engineVfxSystem.js`, jak hulk).
- Okna mostka (`bridge3D.js`): poza utratą dowodzenia okno świeci, gdy kanał `bridge` przekroczy jego próg (ziarno okna — gasną i zapalają się po kolei), przy zapalaniu migocze; co ósme okno (`bridgeEmergencyWindow`) świeci słabo na czerwono, gdy okręt jest wyłączony; światło bojowe — okna na czerwono; stroboskopy × nav.

## Alarmy (`src/game/shipAlarms.js`, blok „ALARMY OKRĘTU” w index.html)

- Szyna `ShipAlarm`: warunki co krok fizyki (`stepShipAlarmConditions` po `ciwsStep`): kadłub < 25%, rdzeń KRYTYCZNY / STOPIENIE, zapadnięcie tarczy, rakieta lub torpeda z namiarem na gracza (bufor PD i `rocketSystem3D.collectIncoming`), trafiony mostek (`lastLossAt`), świeże wykrycie przez piratów. Jeden alarm naraz (priorytet), `state.volume` po 4 s łagodnie do 0,35. Stan `ShipAlarm.state`, zdarzenia `ShipAlarm.on(fn)`; dźwięk podpina sesja dźwięków (szyna sama nic nie gra). Konsola `ShipAlarmDev.set(id, sek)`.
- Obraz: komunikat z etykietą ALARM, czerwona ramka ekranu (`drawShipAlarmFrame`, pod celownikiem), koguty — dwa obracające się reflektory w barwie alarmu nad osią kadłuba gracza (krok `Core3D.fx` „koguty alarmu” w `hexShips3D.js`, kod alarmu w migawce ENT `ALARM`), lampy pokładowe na czerwono.

## Prąd z siatki belek (`src/game/hullPower.js`)

- Maska zasilania węzłów: BFS od komory reaktora (komórki `cellX / cellY` rdzeni gospodarza; komora wybita do zera — od żywych sąsiadów komory) po belkach poszycia, wnętrza i grodzi — WRĘGI NIE PRZEWODZĄ (po rozpadzie żywe węzły ciała są zawsze spójne belkami, prąd liczy tylko „okablowanie”). Rdzeń odcięty z odłamem = cały okręt bez prądu. Kadłub bez rdzenia — null (wszystko zasilane). Pamięć per ciało, od nowa przy zmianie liczby żywych węzłów, żywych belek (gra) albo komór. Działa też na lustrze ciała w workerze (rdzenie na lustrze gospodarza — `applyCores`).
- Mocowania (`refreshHullMountSet(set, hull, byt)`): lampy i dysze w części bez prądu gasną — także rozgrywka dysz MAIN (`engineDamage.js`). Wieże: `hullPointPowered(byt, gniazdo, sx, sy)` (`hullMounts.js`) — NPC w `processAutonomousWeapons`, gracz w `skip` kierowania ogniem.
- Migotanie po trafieniu (`notePowerFlick` w `applyHexImpact`, od 240 obrażeń, gaśnie 1,4 / s czasu gry; ENT `PWR_FLICK`) — sam obraz.

## Światło bojowe floty i reflektor dziobowy

- `fleetCoordinator.js` (`markBattleLights`): członkowie strony w szyku bojowym mają `__battleLights` (ENT_FLAG2 `BATTLE_LIGHTS`); gracz — razem ze stroną sojuszniczą (`getFleetPhase('friendly').battle`).
- Reflektor dziobowy (klawisz ;, `PlayerSearchlight`): kąt ku kursorowi w łuku ± 60° od kursu z ograniczoną prędkością obrotu (`__spotAng` → ENT `SPOT_ANG`), sygnatura × 1,6, gaśnie bez zasilania; obraz — stożek w siatce świateł z dziobu (krok „szperacz dziobowy” w `hexShips3D.js`: kadłuby, skały, pył, gaz). W pustej przestrzeni snopu nie widać (brak ośrodka); cień skał od reflektora — nie (reflektory dalekie pasa mają własny slot cienia).

## Pułapki

- Moc / zasięg światła siatki ≥ ~0,002 oświetlenie kadłubów v2 bierze za BŁYSK (zanik skupiony, × 0,45) — koguty i reflektor trzymają stosunek ~0,0016.
- Kod wycinający funkcje z index.html do piaskownicy testów (PD, wieże, ładowanie specjali, wygląd broni) potrzebuje zaślepek `playerPowered` / `playerPowerRefuse`.
- Harness ze `scene.cam` stawia kamerę w trybie RTS — akcje okrętu (−, 0, ;) są wtedy zablokowane bramką `gaNotRts`; narzędzia wołają `PlayerPower.toggle()`.

## Jak sprawdzić

- `node --test tests/shipPower.test.mjs tests/powerSignature.test.mjs tests/shipDeckLights.test.mjs tests/hullMounts.test.mjs tests/shipLightRuntime.test.mjs`.
- W grze: `node scripts/webgpu/zasilanie-gra.mjs [--query renderWorker=1] [--out .tmp/webgpu/zasilanie-gra]` — wyłączenie, gaszenie, dryf, sygnatura, rozruch (zrzuty fali), praca, światło bojowe, alarm (koguty, ramka), reflektor, NPC wyłączony / włączony, pipeline'y synchroniczne (ma być 0).
