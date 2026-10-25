---
paths:
  - "src/game/fogOfWar.js"
  - "src/game/sensorSystem.js"
  - "src/3d/fog/**"
  - "src/ui/fogHud.js"
---

# Mgła wojny: wzrok, sygnatury masy, obraz

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Mgła wojny (2026-10-04, `src/game/fogOfWar.js`, obraz `src/3d/fog/`, HUD `src/ui/fogHud.js`)

- Gracz WIDZI tylko to, co jest w zasięgu wzroku strony gracza: Atlas (i P2), sojusznicy, drony zwiadu, sondy, stacje czujników, przyjazne stacje, strefy fabuły (`revealArea`). Wzrok z tabeli `src/data/shipRanges.js`: fregata 5 km, destroyer 8, battleship 11, capital 14, supercapital/Atlas 18; Corvus/`role: 'radar'` 7 km, dron 20. Klasa jest rozpoznawana po aktywnym kadłubie / ramie PRZED ogólnym typem i flagami `isPlayer` / `isCapitalShip` — gracz we fregacie nie ma wzroku Atlasa, NPC supercapital nie wpada do capital. Jawne `sensors.visionRange` wygrywa. Wzrok jest celowo MNIEJSZY niż czujniki pasywne AI (`SHIP_SENSOR_PROFILES`, `fleetAwareness` — AI widzi po staremu). Opcja „Mgła wojny” w panelu Nowa gra (`sc_fog_of_war`, domyślnie wł.; konsola `setFogOfWar(bool)`).

- Orkiestracja: `SensorSystem.update` (krok czujników w `physicsStep`) — źródła → flagi bytów → sygnatury masy → świat mgły dla Core3D (`SensorSystem.fogWorld`, `Core3D.setFogOfWar`). Świadomość NPC (`_sensorAwareness`: radar kokpitu, CIC, znaczniki krawędzi) = wzrok; zgubiony kontakt zostaje duchem. Bez mgły — dawne koło 18 km.

- Pytanie dla każdej ścieżki, która pokazuje albo celuje we wroga: `SensorSystem.hides(byt)` (flaga DODATNIA `__fogVisible` — nowy byt jest ukryty do pierwszego kroku; stacje pirackie ukryte do pierwszego zobaczenia, potem znane jak teren RTS; nowy wrak widoczny do pierwszej oceny). Wpięte: render (`renderEntities` zostaje pełne dla `hexShips3D` — `setEntityHiddenTest`: siatka żyje, bez kadłuba, lamp, wież, dysz i cienia SDF; mostki, tarcze, modele 3D, reaktory, światła w pasie dostają `renderSeen` / `fogSeenInto`), stacja piracka 3D (`setWorld3DHiddenTest`), nakładki 2D NPC (kadłub budowany dalej, bez pasków — `_npcFogQuiet`), chmury myśliwców, kandydaci kierowania ogniem, `canPlayerLockTarget` (namiar spada w mgle), PPM / T / U, karta najechania, skaner X (kontakty i fala; dawne anonimowe „pingi” przy bytach w mgle usunięte 2026-10-07), radar kokpitu (`radarFeed.collect` — `env.hides`), duchy torped, kamera bojowa, CIC (kontakty i stacje). Nowa ścieżka ujawniająca wroga graczowi — ten sam test. Ostrzał zdradza pozycję: okręt, który trafi gracza, jest widoczny `FOG_FIRE_REVEAL_SEC` (4 s).

- SYGNATURY MASY (czujniki grawitacyjne — „coś ciężkiego, nie wiadomo co”): `SensorSystem.setMassSignature(id, { x, y, offset, spread, mass, label, entity })`, rozpoznanie = byt `entity` widziany (sygnatura gaśnie sama). Dziś stawia je fabuła (`api.fog.mass`); SKANER MASY (wykrywanie sygnatur z masy kadłubów) — do wdrożenia, ten sam kanał.

- Obraz: post „uber” (`src/3d/fog/fogOfWarPost.js`, gałąź za `uFogOn` — wyłączona = obraz bit w bit): punkt świata piksela (z góry: px / zoom obrócone o kąt kadru — `uFogRot` = (cos, −sin roll), hipercruise; kamery 3D: promień ∩ płaszczyzna gry; rulon: odwrotność liczona RAZ i dzielona z przyciemnieniem), koła wzroku (≤ 24 na render, j. świata względem kamery TEGO renderu — `_updateFogUniforms` po `syncCamera`, `packFogView`), brzeg poszarpany szumem (jęzory), poza kręgiem obraz przygaszony i odbarwiony + chmury szumu kafelkowego zakotwiczone w świecie (początki kafli zawinięte w double na CPU — shader nie widzi 5–10 mln j.), podświetlenie czujników tylko na gęstych smugach (bez świecącej obręczy), sygnatura = wir mgły z ciemnym jądrem. Jeden blok `uniformArray` `fogOfWar` (+1 bufor uniformów postu). Pułapka: `mix(−1e9, s, 1)` w WGSL gubi `s` (float32) — `select`. Koszt ~0,05 ms przy 1600×900. PAMIĘĆ SZUMU (2026-10-17, `FogNoiseCache`): kamera z góry bez rulonu i od zoomu `FOG_CACHE_MIN_ZOOM` — szum (chmury, welon, smugi) liczy kernel compute raz na 4 × 4 px w passie compute bloomu, „uber” czyta go dwuliniowo (kamery 3D, rulon — na piksel; A/B `Core3D.fogNoiseCache = false`); zmiana szumu (`fogNoise`) dotyczy obu dróg, nowy człon szumu o drobniejszym oczku niż 1250 j. — sprawdź błąd interpolacji (`tests/fogNoiseCache.test.mjs`).

- Misja 1: faza `scout` (wyjście z warpa `site.warpIn` ~60 km przed rzędem, sygnatura stoczni, rozpoznanie dronem — PPM → DRON ZWIADU, `launchSpotterDrone`). Testy: `tests/fogOfWar.test.mjs`, `tests/storyMission.test.mjs`.
