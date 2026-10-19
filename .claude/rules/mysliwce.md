---
paths:
  - "src/ai/fighterAI.js"
  - "src/game/flight/fighterFlight.js"
  - "src/data/fighterSquadrons.js"
  - "src/game/fighterBombs.js"
  - "src/vfx/fighterSprite.js"
  - "src/vfx/fighterBombSprite.js"
---

# Myśliwce: pilot, role, bomby, torpedy lotnicze, eskadry gracza

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/ai/fighterAI.js`, `src/game/flight/fighterFlight.js`, `src/data/fighterSquadrons.js`, `src/game/fighterBombs.js`** — myśliwce: mózg (role: myśliwiec, przechwytujący, szturmowy, bombowiec, torpedowiec, kanonierka), pilot w kroku fizyki, karty eskadr, bomby lotnicze. Opis: § „Myśliwce: pilot, role, rozkazy” niżej, audyt `docs/AUDYT-mysliwce-2026-10-14.md`.

## Myśliwce: pilot, role, rozkazy (2026-10-14; `src/ai/fighterAI.js`, `src/game/flight/fighterFlight.js`, `src/data/fighterSquadrons.js`; audyt `docs/AUDYT-mysliwce-2026-10-14.md`)

- Zgłoszenie użytkownika: myśliwce bijące okręt „wpadały w szał” (pomiar: zawrotka co ~1,3 s, przeciążenie boczne do 22 tys. j/s² przy przyspieszeniu 2000, połowa czasu lotu bokiem), role „bombowiec zrzuca bomby NA statek, gdy jest nad nim; torpedowiec — torpedy dolatujące w statek; kanonierki po orbicie”.

- PILOT: mózg (20 Hz) ustawia tylko ZAMIAR (`setFighterIntent` / `steerFighter`: wektor żądanej prędkości, sufit skrętu, opcjonalnie kurs nosa), `stepFighterFlight` w `npcStep` (każdy krok fizyki) skręca z ograniczonym przeciążeniem bocznym (ω ≤ min(maxTurn, latAccel / v)), skręt narasta z `rollAccel`, prędkość z `accel` / `decel`, nos wzdłuż prędkości (zamiar `face` odchyla go najwyżej o `slipMax`), wieżyczka kanonierki (`turretAngle`) — tam też. Karta lotu per rola: `flight: { latAccel, maxTurnDeg, rollAccel, decel }` w `FIGHTER_SQUADRON_DEFS`. Nie ustawiaj `vx` / `vy` myśliwca z mózgu ani nowej ścieżki AI — tylko zamiar; prędkość pisze pilot. Strojenie: `window.FighterFlightTune` (+ `bumpFighterFlightTune()`), mózg — `window.FighterAITune`. Rysunek myśliwca z interpolacją między krokami fizyki (`__px / __py / __pa` z `npcStep`, render: `_npcDrawAngle`).

- DOKTRYNY (`squadron.doctrine`, encja: `fighterDoctrine`; typ encji zostaje 'fighter' / 'interceptor'): `fighter` i `interceptor` — kocioł z myśliwcami (`dogfight3D`: pościg z kontrolą zbliżania, mijanka czołowa z przesunięciem, przestrzelenie → pościg z opóźnieniem, OBRONA przed wrogiem na ogonie) i PRZELOT nad okrętem (`strafe`: podejście z ogniem → dobieg za cel → szeroki nawrót → kolejne podejście z innej strony); `strike` — przelot z salwą rakiet; `bomber` (`bomb_run`: prowadzenie po linii na oś kadłuba, prosty przelot NAD kadłubem, bomba, gdy `window.fighterOverHull` — `window.FighterBombs.drop`); `torpedo` (`torp_run`: burta celu, torpeda `aerial_torpedo` z ~2,8 km na punkt wyprzedzenia, odwrót); `gunship` (`orbit`: stała odległość od powierzchni kadłuba, wieżyczka 360°). Bombowiec i torpedowiec bez amunicji — `rearm` przy nosicielu (lider-nie-myśliwiec, nosiciel startu, lider skrzydła wsparcia; bez nosiciela — krąg i czas). Doktryny uderzeniowe (`STRIKE_CRAFT_DOCTRINES`) nie biorą myśliwców za cel (`scoreAiTarget` → −∞), przechwytujący woli maszyny uderzeniowe. Geometria celu: `window.getFighterTargetGeom` (półosie z obrysu tarczy, oś kadłuba) — `radius` okrętów jest dużo mniejszy od kadłuba, nie licz z niego ataku.

- Nowa rola = wpis w `FIGHTER_SQUADRON_DEFS` (doktryna, `flight`, broń), hangar `fighter_squad_<id>` w `MASTER_WEAPONS` (etykieta w `fittingPanel.js`), szablon wezwania w `SUPPORT_SHIP_TEMPLATES` (`supportType: 'fighter'`) i konfigurator w `SUPPORT_SHIP_CONFIGURERS`, wariant rysunku w `src/vfx/fighterSprite.js` (`VARIANTS`), gałąź w `runAdvancedFighterAI`.

- BOMBY (`src/game/fighterBombs.js`, rysunek `src/vfx/fighterBombSprite.js`, broń `fighter_bomb`): bomba jedzie z celem od zrzutu i po `fallTime` wybucha — tarcza aktywna bez przebicia → trafienie w tarczę; żywe poszycie → krater (rodzina stempla `rocket`), HP z pominięciem tarczy, `WeaponFx.bombBlast`; dziura → przelatuje (`WeaponFx.bombDud`). Klej (env) — blok „BOMBY LOTNICZE” w `index.html`, krok `FighterBombs.step(dt)` po `npcStep`. TORPEDA LOTNICZA (`aerial_torpedo`, pocisk kanwy) ma punkty życia obrony punktowej `pdHp: 60` — `killRocketThreat` liczy je dla pocisku kanwy z `pdHp` jak dla rakiety 3D (mnożniki `RocketPdTune.dmgMul`, model V3); pocisk kanwy bez `pdHp` ginie od jednego trafienia jak dotąd (pomiar: bez punktów życia jeden pancernik strącał 79% torped). NAPROWADZANIE pocisków `bullets` (torpedy, rakiety kanwy): `steerHomingBullet` w pętli pocisków — ścieżka kanwy jak dawniej (z zapasowym celem z namiaru gracza), pocisk rysowany przez WeaponFx (`__renderedByThree` — każdy bez `forceCanvas`) tylko z jawnym `turnRate > 0` i własnym celem (do 2026-10-14 nie skręcał wcale: rozgrywka zależała od ścieżki rysunku); salwy trybu torped (`turnRate: 0`, bez celu) zostają niekierowane. Nowa logika lotu pocisku — poza warunkami ścieżki rysunku (strażnik `tests/fighterTorpedoHoming.test.mjs`).

- ESKADRY GRACZA (Z): start z hangarów → ESKORTA (cele do 6 km, nie dalej niż 8 km od Atlasa) → ATAK (16 km, cel z namiaru T pierwszy) → POWRÓT (lot do wyrzutni startu — `__tubeLocal`, lądowanie `window.landFighter`, po ostatnim Z startuje od nowa). `pruneSquadList` — lista bez poległych i wylądowanych (licznik HUD). Lotniskowce NPC: skład grupy lotniczej `CARRIER_WING_MIX` (z rolami).

- Testy `tests/fighterAI.test.mjs` (pilot: przeciążenie, narastanie skrętu, 60 = 120 Hz; role na mini-symulacji: przelot bez ping-ponga, bomby tylko nad kadłubem, geometria torpedy, orbita kanonierki, przezbrojenie, lądowanie; dobór celów), `tests/fighterSquadrons.test.mjs`; w grze `node scripts/webgpu/mysliwce-zachowanie-gra.mjs [--scen atak,obrona,kociol,role] [--czas 40]` (każdy krok fizyki każdego myśliwca: tempo skrętu, przeciążenie, lot bokiem, zawrotki, stany, celność, tory w układzie celu).
