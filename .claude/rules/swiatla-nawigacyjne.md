---
paths:
  - "src/data/shipNavLights.js"
  - "src/3d/tsl/navBlink.js"
  - "src/3d/shipLights3D.js"
  - "src/game/shipLightRuntime.js"
  - "src/ui/shipLightEditorModel.js"
  - "scripts/lampy-nawigacyjne.mjs"
  - "scripts/webgpu/lampy-gra.mjs"
  - "tests/shipNavLights.test.mjs"
  - "tests/shipLights3D.test.mjs"
  - "tests/shipLightRuntime.test.mjs"
---

# Światła nawigacyjne okrętów: sześć lamp, „blink blink”, oświetlanie tylko w błysku

> Reguła obszaru. Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Decyzje użytkownika (2026-11-06)

- „Blink blink” czerwono-zielone jak w samolotach, znacznie mniej lamp: dwie z przodu, dwie na najszerszym elemencie, dwie z tyłu — na każdym statku. Lewa burta czerwona, prawa zielona.
- Lampa oświetla (czerwono albo zielono) tylko w błysku; bez błysku nie oświetla ani własnego kadłuba, ani statków obok.
- Różne odmiany: żółte ostrzegawcze dla statków konstrukcyjnych (styl `warning`).

## Jak to działa

- DANE: `src/data/shipNavLights.js` (czysty moduł). `NAV_LIGHT_POINTS` — klucz edytora → promień lampy i sześć punktów w px PNG (kolejność: dziób lewa / prawa, najszersze lewa / prawa, rufa lewa / prawa), tabela generowana: `node scripts/lampy-nawigacyjne.mjs --zapisz` (`--podglad <katalog>` — sprite'y z lampami do obejrzenia). `withShipNavLights(klucz, lights)` buduje blok wpisu edytora; `hardpointEditorDefaults.js` przepuszcza przez nią każdy wpis, a `atlasHardpointDefaults.js` — Atlasa.
- STYL = wiersz `NAV_LIGHT_STYLES` (barwa burt, numer wzoru migania, przesunięcie prawej burty w cyklu, moc). Kadłub poza stylem domyślnym → wiersz w `NAV_LIGHT_HULL_STYLE` (dziś `construction_tug`, `service_tug`). Nowy statek konstrukcyjny: punkty w tabeli + `warning` w tym wierszu. Podgląd w grze z `?dev`: `DevScene.navStyl('warning')` (gracz), `restyleNavLights(blok, styl)` — dowolna encja.
- WZORY MIGANIA: `NAV_BLINK_PATTERNS` (czasy w ułamkach cyklu); nowy wzór na końcu listy, shader czyta tabelę sam. Lampa niesie `blink` (numer wzoru) i `lag` (przesunięcie w cyklu); `normalizeLightMarker` / `compactLightMarker` je przepuszczają.
- KOD MIGANIA = numer wzoru + faza w cyklu (`navBlinkCode`, faza = `lag` + faza okrętu); ujemny — światło stałe. Jedna liczba idzie do: billboardu (`aParams.x`), slotu lampy w kadłubie (`lightExtra.x` typów 0 i 2 — kierunku nie mają), kuli modelu 3D (`iCol.w`, −1 = reflektor). Błysk liczy jedna funkcja `navBlinkNode` (`src/3d/tsl/navBlink.js`), lustro CPU `navBlinkValue` — zmiana wzoru tylko w tabeli; zegar we wszystkich odbiorcach to `Core3D.frameNowMs`.
- FAZA OKRĘTU (`navPhaseOf`): z tożsamości encji — `id`, `uid`, ród kadłuba `beamHull.dmgKey`, nazwa (większość NPC nie ma `id`; nazwa jest wspólna dla typu, więc na końcu). Flota nie miga równo. Proxy statków ruchu: wspólny slot lamp rodzaju ma fazę 0, faza okrętu idzie w instancji (`iHull.w` → `P.uNavPhase`, `navPhaseFromId(kurs)`), a billboard dostaje ją w `view.navPhase`.
- OŚWIETLANIE: własny kadłub — lampa typu 0 mnożona przez błysk (`NAV_LIGHT_LOOK.hullGain`); cudzy — każda lampa to osobne światło typu 2 (`buildNavLightClusters`, moc × `NAV_CLUSTER.powerMul`, zasięg z długości kadłuba), błysk liczy shader, więc podpis lamp nie zmienia się co klatkę i nie ma wysyłek. Skały i gaz: `lightGrid.addShipLights` dodaje światło tylko przy `pulse` > 0. Światło świata (błysk burzy) bez kodu świeci stale. Blok z więcej niż `NAV_CLUSTER.maxLamps` lampami (dołożone w edytorze) — grupy burta × połowa długości z rytmem pierwszej lampy.
- BILLBOARD (`shipLights3D.js`, warstwa FG): w błysku rdzeń i halo HDR z bloomem; między błyskami sam mały punkt `NAV_LIGHT_LOOK.idle` pod progiem bloomu, bez halo. Pula `MAX_NAV_LIGHT_SPRITES` = 1024: sześć lamp na okręt, kadłuby przed proxy.

## Reflektory otoczenia

Generator z obrysu lamp (`computeAutoFloodMarkers`) nie ma z sześciu lamp obrysu: reflektory kadłubów, które je miały, stoją na stałe w `SHIP_FLOOD_LIGHTS` (Atlas, Citadella, Colossus po 5, Hasta 1 — miejsca i progi z dawnego obrysu), reszta floty ich nie ma, jak dotąd. Generator w grze działa tylko przy `autoFlood: true` w źródle (kreator); przycisk „wstaw” edytora dalej z niego korzysta.

## Zapis edytora

`hpEditor.v1` z dawnymi lampami obrysu: `migrateSavedNavLights` (wołana z `migratePirateSpriteLayout` — gracz, NPC, edytor) zastępuje `position` lampami z tabeli raz; własne reflektory z zapisu zostają. Edytor zapisuje `navLayout` (`compactLights`) — układ zapisany po tej zmianie jest decyzją użytkownika i migracja go nie rusza. Nowy kształt danych lamp → podbij `NAV_LIGHT_LAYOUT`.

## Pułapki

- Zmienna `.toVar()` powstaje w miejscu pierwszego użycia (pułapka 29): błysk w pętli lamp kadłuba przypisany PRZED gałęzią typu 2, inaczej reflektory czytałyby zmienną nieprzypisaną.
- Pierścień pakietów `PACK_RING` jest wspólny dla rodzajów świateł: każdy pakiet ustawia swój `blink` (reflektor −1), inaczej zostaje kod poprzedniego światła.
- Parowanie lamp opiera się na kolejności i id (`_l`, `_r`), nie na znaku y: oś sprite'a bywa przesunięta i obie lampy wąskiego dziobu mogą mieć y < 0 (`repair_drone`).
- Jasny kadłub traci barwę przy dużej mocy rozlewu (biel zamiast czerwieni): `NAV_CLUSTER.powerMul` ~0,5, sprawdzać na Citadelli i Bellatorze, nie na ciemnym Atlasie.

## Jak sprawdzić

- `node --test tests/shipNavLights.test.mjs tests/shipLights3D.test.mjs tests/shipLightRuntime.test.mjs` (komplet kadłubów, lampy na alfie sprite'a, burty, wzory, oświetlanie tylko w błysku, migracja zapisu).
- Nowy kadłub albo sprite: `node scripts/lampy-nawigacyjne.mjs --zapisz --podglad .tmp/lampy/podglad`, obejrzeć podgląd.
- W grze: `node scripts/webgpu/lampy-gra.mjs [--query renderWorker=1] [--out .tmp/webgpu/lampy-gra]` — zatrzymany zegar: Atlas z sąsiadami po obu burtach w chwili błysku i w przerwie (przyrost czerwieni i zieleni na sąsiadach), zbliżenie, oba błyski „blink blink”, daleki zoom, styl ostrzegawczy, pipeline'y w klatkach.
