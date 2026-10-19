---
paths:
  - "src/game/coldWreck*.js"
  - "src/game/hullColdSnapshot.js"
---

# Wraki: gorące, śpiące, zimne (migawki)

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Wraki: gorące, śpiące, zimne

- `wrecks` = gorące i śpiące (`_wreckSleeping`); `coldWrecks` = zimne (`src/game/coldWrecks.js`, brief `docs/BRIEF-zimne-wraki.md`, belki — § 11). Zimny wrak nie jest w `wrecks`, siatce pocisków, listach destruktora, `renderEntities` ani w krokach czujników — jest duchem dla okrętów i pocisków (AI omija go jak wrak: `rebuildWreckIndex(wrecks, coldWrecks)`; radar: `env.coldWrecks`). Łup, ładunek i ród mapy ran zostają na obiekcie. Usuwanie: `recycleWreckEntity` (belki — też zimny z samą migawką → `HullBodies.recycleWreck`).

- Wrak na belkach marznie do MIGAWKI względem szablonu kadłuba (`src/game/hullColdSnapshot.js`; API `HullBodies.captureColdSnapshot / restoreColdBody / releaseColdBody`; ten sam rekord `hull`). W kadrze gra wybiera wraki, którym potrzebne jest CIAŁO DO RYSOWANIA (`selectColdRenderBodies` w `src/game/coldWreckView.js` przed `updateHexShips3D` → `coldWreckSystem.ensureRenderBody`, budżet węzłów na klatkę; render dostaje znacznik `w._coldDrawFrame` przez hak `drawn` — RW-31; bramkę zamrażania `coldFreezeVisuallySafe`, flagę `__inDrawBox` i smugę zimnego wraku też liczy gra z widoku klatki, pudła wspólne z renderem w `src/render/drawBox.js`) — poza fizyką, rysowane jak wrak śpiący (`updateColdBeamWrecks` w `hexShips3D.js`; mostek, rdzeń, model 3D przez `withColdNearWrecks` w index.html; rekord Bridge3D zimnego wraku bez ciała czeka — `beamHostParkedCold`), zwalniane po `renderIdleSec` bez rysowania; zimny wrak może więc mieć `beamHull` (sprawdzaj `isCold`). Nowe pole stanu węzła / belki, które zmienia gra, musi wejść do migawki (inaczej zniknie po odmrożeniu) — test `tests/coldWrecksBeam.test.mjs` porównuje ciało i skórę po odtworzeniu. Zamrażanie blokuje gracz i ciało ruchome w `clearRadius`, stojący okręt tylko z bliska (`clearContactPad`); dlaczego wrak nie marznie — `ColdWreckSystem.explain(w)` w konsoli.

- Budzenie WYŁĄCZNIE jawne: `thawWreck(w, reason, onReady)` (holowanie, cięcie, rozkaz), max 1 na klatkę. Nowa ścieżka usuwająca wraki obsługuje też `coldWrecks` (`coldWreckSystem.forget`), a nowe odwołanie do wraku (cel, lina, rozkaz) trzeba stemplować w `markColdWreckReferences` — inaczej wrak zamarznie pod ręką.
