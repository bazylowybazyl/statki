---
paths:
  - "src/3d/haloRing/haloPortK7*.js"
  - "src/game/k7BerthService.js"
  - "dema/dok-k7-webgpu.html"
  - "scripts/blender/k7/**"
---

# Hala K-7: obsługa paliwowa stanowisk, ramiona SCARA, przewody, hala z Blendera

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Obsługa paliwowa stanowisk K-7: ramiona SCARA, przewody z fizyką, buchy pary, rurociągi (2026-10-07; `src/3d/haloRing/haloPortK7Fuel.js`, demo `dema/dok-k7-webgpu.html`)

- Prośby użytkownika: przewody paliwowe „chodzą twardo i nierealistycznie” (dawniej krzywa Béziera z końcem po prostej), mają
  „buchać dymem we wszystkie strony po obwodzie przy przypinaniu / odpinaniu”; suwnice „nie mają żadnej roli — cargo będą
  ładowały drony” (usunięte WSZĘDZIE: hale K-7 i pasy MEGA zatok na ringach Ziemi, Marsa, Jowisza — bryły, kolizje nóg,
  pozy); „brak jest rur”. Nośnik złączki wybrał użytkownik: RAMIĘ SCARA na słupku paliwowym (nie wysięgnik, nie dron).

- POZA OBSŁUGI stanowiska capital (stan gry w rejestrze hali, `K7_SERVICE_KEYS`): `clamp` (zamki magnetyczne pola — listwy
  świecą), `extension` (ramię od złożenia do ustawienia nad wlewem), `seat` (wysięgnik ze złączką na wlewie), `lock`
  (rygle), `flow`, `vent`. Klucze suwnicy (`bridge` / `trolley` / `lower`) nie istnieją. Sekwencje — JEDNO źródło
  w `haloPortK7Layout.js`: `K7_SERVICE_DOCK`, `K7_SERVICE_UNDOCK` (`driveAt` — napęd po zwolnieniu zamków),
  `K7_SERVICE_RELEASE` (awaryjne) + `k7ServiceConnectPose` / `k7ServiceDisconnectPose` / `k7ServiceStep`; używają ich
  fabuła (`STORY_UNDOCK`), automat stanowisk gry (`k7BerthService.js`), `K7Docking` i automat portu (`PortDocking`,
  `PORT_SEQUENCE.fuel`; flaga wpisu `fuel` także w ruchu v2: `portPaths.js`, `cargoTransferWindow({ fuel })`). Nowy krok
  obsługi = okno w sekwencji, nie osobna animacja w rendererze.

- GEOMETRIA (`K7_FUEL_STATION` — jedno źródło brył, kolizji i fizyki): cokół z kolumną (kolizja `FUEL PEDESTAL`), bęben
  przewodu na licu ku stanowisku, obrotnica barku; człony 300 / 280 j. na wysokościach 330 / 300 K-7 (nad płaszczyzną lotu
  — nie kolidują z kadłubem), łokieć ku bramie (`elbowSide`); wlewy Atlasa `K7_ATLAS_FUEL_PORTS` (0,36 długości od
  środka, 0,13 szerokości od osi — w obrysie przy obu kierunkach postoju). Bryły: `buildFuelStation` (grupy: człon 1,
  człon 2, trzon wysięgnika, złączka) i `buildClampPads` w `haloPortK7Build.js`; grupy ruchome ≤ 40 (`MAX_GROUPS`).

- FIZYKA (`haloPortK7Fuel.js`, czysty, testy `tests/k7Fuel.test.mjs`): przeguby i wysięgnik nadążają za pozą jak napęd
  z masą (sprężyna z tłumieniem), interpolacja w przestrzeni przegubów (końcówka idzie łukiem); złączka wisi na linie
  przegubu, przy ryglowaniu naprowadzana na wlew (tylko gdy rygiel rośnie), odryglowanie = odrzut; przewód = lina Verleta
  (PBD, zginanie na podkrok, grawitacja ku pokładowi, opór powietrza, tarcie), zderzenia z pokładem, słupkiem i KADŁUBEM
  (obrys w hubie hali — `HaloRingGame._hullInHall` z `collider.hubOutline`); bęben wydaje i zwija przewód (stała długość
  ogniw, ogniwo przy bębnie zmienne — węzły rodzą się i znikają w wylocie). Czas = `gameDt` (pauza i sceny — stoi),
  podkrok 1/240 s, przewód w spoczynku usypia (zero pracy), budzi go zmiana pozy albo kadłub w pobliżu. Poza z `settle`
  (statek zastany przypięty — start fabuły w doku, powrót): ramię na kątach pozy, złączka zaryglowana, przewód ułożony
  od razu (`settleHose`: łuk nad grzbiet kadłuba + 1,2 s tłumionego dojścia, ~4 ms na stanowisko, raz) — także przy
  dt = 0, ponownie przy zmianie pozy albo obrysu. Render
  (`haloPortK7.js`): rura z liny (Catmull-Rom po długości łuku, ramki transportem równoległym, uv żeber jadą z materiałem
  przewodu), wysyłka tylko zmienionych przewodów (`zbierzZakres`). Strojenie `window.K7FuelTune`.

- BUCHY PARY: rygiel przechodzi przez 0,5 (ryglowanie — mały, odryglowanie — duży) → (1) strumień PROMIENIOWY pola gazu
  hali (`gasField2D.js`: `jetC.w = 1`, para wstrzykiwana na obwodzie złączki, prędkość od środka, płaty z szumu — nie równy
  okrąg; rekordy z `hallGasSources.js`, zdarzenia `src.events`), (2) kłęby pary z puli dymu rakiet (paleta VAPOR, oświetla
  je siatka świateł hali) — `HallDust.setVaporSmoke(rocketFx.smoke)` w `index.html`; upust (`vent`) — strumień kłębów
  z zaworu przedmuchu. Strojenie `HallDustTune.puff*`, `HallDustTune.gas.burst* / latch*`.

- RURY (`buildFuelPiping`): zbiorniki-cygara na siodłach przy ścianie tylnej (`k7FuelTanks` — w `k7SolidList` z
  `shape: 'tank'`: kolizje i przeszkoda gazu, w renderze własny kształt), pompy, kolektory paliwa i powrotu wzdłuż
  ściany tylnej, rurociągi na legarach wzdłuż boków stanowisk capital (dawne bieżnie suwnic) do zaworów przy słupkach,
  piony do zaworów upustowych (`rig.vents`), rury instalacji na licu ściany (FG). Wszystko pod płaszczyzną lotu poza
  rurami na ścianie.

- Narzędzia: demo `dema/dok-k7-webgpu.html` (sama hala na uniformach ringu; pokaz w pętli, ODDOKUJ / podłącz / awaryjnie,
  lot W / S / A / D z automatem stanowisk, widoki z góry i 3D, ×0,25), zrzuty `node scripts/webgpu/dok-k7-demo.mjs`, w grze
  `node scripts/webgpu/hala-swiatla-gra.mjs [--kampania | --automat]`.

- HALA Z BLENDERA (pilot 2026-10-13, `docs/PILOT-blender-k7.md`; DOMYŚLNA w grze i demach od 2026-10-13 — decyzja
  użytkownika; stara hala z brył do A/B: `?k7=stara` / `window.__K7_GLB = false`, bez pliku GLB — też stara): słupki paliwowe z ramionami SCARA (człony,
  wysięgnik, złączka), zamki pola, zbiorniki, pompy, kolektory i rurociągi, upusty, rury na ścianie, reflektory,
  ościeżnice i nadproża bram z `assets/k7/k7_hala(_lod1).glb` (skrypty `scripts/blender/k7/`, wymiary z gry:
  `k7-dane.mjs` → `k7-dane.json`, hasz w GLB). Sekcje z modelu (`K7_GLB_TAGS`) rejestrator pomija (`skipTags`),
  miejsca elementów (`Recorder.place`) dostają JEDNĄ scaloną geometrię na zestaw bg / fg i LOD, wspólną dla wszystkich
  hal (`src/3d/haloRing/haloPortK7Glb.js`), rysowaną grafem K-7 `glb` (paleta ringu, lampy hali, grupy `k7Groups`, AO).
  Zmiana wymiaru elementu w `haloPortK7Layout.js` / sekcji w `haloPortK7Build.js` = ponowny eksport i wypiek (test
  `tests/haloPortK7Glb.test.mjs` „wymiary z gry” pada); nowa bryła w sekcji z modelu nie pojawi się w hali z Blendera,
  dopóki nie trafi do modelu. Kolizje bez zmian. A/B w grze: `node scripts/webgpu/k7-blender-gra.mjs`.
