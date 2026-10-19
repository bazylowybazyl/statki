---
paths:
  - "src/game/shipBridge*.js"
  - "src/3d/bridge3D*.js"
  - "src/3d/bridgeFx3D.js"
  - "src/3d/reactor3D*.js"
  - "src/game/reactorCore*.js"
  - "src/3d/reactorBlast/**"
  - "src/data/reactorCores.js"
---

# Mostki (zniszczenie mostka = kill) i rdzeń reaktora

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Mostki (zniszczenie mostka = kill)

- **Od 2026-10-05 mostki działają na kadłubach belkowych** (`docs/PORT-mostki.md` § 9): strefa mostka = KOMÓRKI siatki belek (ix, iy) — `src/game/shipBridgeBeams.js` (montaż, pancerz, integralność, odcięcie z odłamem, wyrwa, lock, okna, przekształcenia z pozą renderu). Stan (`entity.bridgeState`) z `backend` (`BEAM_BRIDGE_BACKEND`) — ogólne funkcje `shipBridge.js` (`bridgePngToWorld`, `bridgeGridToWorld`, `updateShipBridges`, `getBridgeAimPoint`, …) oddają mu pracę (bez backendu — wartości puste); „siatka” w ich API = piksele obrazu kadłuba. Nowy kod mostków: przez te funkcje. Wersję heksową (i demo `mostki-demo`) usunięto 2026-10-19.

- `src/game/shipBridge.js` (strefy, propozycje układów `BRIDGE_LAYOUT_PROPOSALS`, oś czasu), `src/game/shipBridgeRuntime.js` (klej gry — `attachEntityBridges`, tylko kadłub na belkach), `src/3d/bridgeFx3D.js` (okna, wyrzut atmosfery i warstwa WebGPU agonii: światła w siatce, łuki przepięć z puli ARC `WeaponFx`, osmalenie wyrwy na mapie ran — usługi z `BridgeFx3D.attach(scena, { weaponFx })`). Demo: `dema/mostki-webgpu.html` (też EDYTOR STREF — klawisz E albo `?edit=1`: przesuwanie, rogi, obrót, kolizje z gniazdami, eksport do `BRIDGE_LAYOUT_PROPOSALS`); harness `scripts/webgpu/mostki-webgpu.mjs` (`--tryb edytor`), gra `scripts/webgpu/mostki-gra.mjs`.

- Utrata dowodzenia robi z NPC hulka (`isBridgeHulk`): `npcStep` pomija AI i model lotu, `applyDamageToNPC` i sufit konstrukcji go nie ruszają, po `BRIDGE_KILL_TIMELINE.sequenceEnd` `finishBridgeKill` robi wrak BEZ losowego wybuchu reaktora. Nowe ścieżki śmierci / AI / celowania muszą to respektować.

- AI celowo nie celuje w mostki (za szybko zabijałoby gracza) — tylko przyszli „bossowie”.

- Model 3D mostka: `src/3d/bridge3D.js` (+ `bridge3DShapes.js`, graf TSL w `bridge3D.tsl.js`), `docs/PORT-mostki.md` §8–9. Wyrwy z komórek kadłuba (bufor obrażeń; siatka kwadratowa shadera — `aB3State.w` = bok komórki, maska 8 sąsiadów, poszarpany brzeg), nic nie zmienia gameplayu. Rekord belkowy idzie za rodem `dmgKey` i za ciałem silnika (wrak dostaje to samo ciało). `Bridge3D.update(…, { visibility })` — gra chowa model przy „Statkach 3D” i gasi go z maskowaniem (`bridgeModelVisibility` w `index.html`); rozgrzewka: wpis `mostki 3D (bridge3D, szczeliny)`. Cień na kadłubie to prostokąt POD kadłubem z `depthFunc GREATER` — działa, bo kadłuby (renderOrder 10) piszą głębię w passie ortho na z ≈ 0; zmieniając głębię/z kadłubów, sprawdź cień mostka. `bridgeState.model3D` wyłącza szczeliny okien w `bridgeFx3D` (wyrzut atmosfery zostaje). Model przechodzi na wrak sam, za ciałem silnika — nie dokładaj haków w `finishBridgeKill`. Wrak i odłam nie mają własnego `bridgeState`, więc ich rekord poza listą (mgła wojny, zimny bez ciała) nie odchodzi po `RECORD_TTL_SEC` — oddaje tylko wiersz obrażeń (oddanego wrak nie przyjąłby ponownie).

- Mostek na WebGPU (zadanie 15, `docs/PORT-mostki.md` §8.14): JEDEN graf i materiał bryły na wszystkie rodzaje — Mesh + `InstancedBufferGeometry` na rodzaj (nie `InstancedMesh`: jego uuid wchodzi do klucza programu), dane instancji w jednym przeplecionym buforze, stałe rodzaju (obrys, paleta, skala detalu) w tablicy `uniformArray` czytanej indeksem rodzaju z instancji. Obrażenia = bufor storage u32 (bajty RGBA8 w słowie, 768 × 512 komórek; `Bridge3D.damage.data` to widok bajtów), wysyłane tylko zakresami zmienionych bloków (`_markRange`) — tekstury backend WebGPU wysyła w całości (1,5 MB na każdą zmianę). Maska słońca z `sunShadowMask.js` (`sunVisibility` / `sunFill`) w jednym miejscu grafu; okna, lampy, szczeliny `bridgeFx3D` i światła pozycyjne `shipLights3D` maski nie czytają. Model reaktora (`reactor3D.js`, graf w `reactor3D.tsl.js`) — w TSL, w grze (§ „Rdzeń reaktora w grze”, rama rdzenia `frameOf` wymagana); żar rdzeni dem heksowych (`coreFx3D.js`) usunięty 2026-10-19.

- **Nowy kadłub (nowy albo podmieniony sprite okrętu) = od razu mostek**: strefa w `BRIDGE_LAYOUT_PROPOSALS`, model w `bridge3DShapes.js`, paleta w `bridge3D.js` — checklista `docs/BRIEF-mostek-nowego-kadluba.md`. Mostki ma cała flota bojowa (Terra Nova, piraci, Atlas) i lokomotywa megafrachtowca; frachtowce cywilne i myśliwce nie.

## Rdzeń reaktora w grze (2026-10-02, `src/game/reactorCoreGame.js`; logika `reactorCore.js`, obraz `src/3d/reactorBlast/` + `reactor3D.js`; `docs/webgpu/DEMO-RDZEN.md` § 7)

- Każdy kadłub belkowy poza myśliwcami dostaje komorę reaktora przy budowie kadłuba (`attachEntityReactorCores` obok `attachEntityBridges`): miejsce z `src/data/reactorCores.js` (klucz = profil renderu: Atlas, Bellator, Iron Skull) albo z automatu (`autoReactorMarker` — najgłębsza komórka siatki przy środku masy). Edytor (`cores[]`) bierze górę tylko z promieniem `r` (dawne poprawki 1–4 z `PORT-rdzen.md` § 5 dalej otwarte).

- Krok `ReactorGame.step(dt, allDestructibles)` w `physicsStep` po `HullBodies.step`: zniszczona osłona komory → STOPIENIE (odliczanie klasy) → DETONACJA: kadłub → wrak z pęknięciami wg wariantu (rozprysk / przełamanie / rozerwanie / wyrwa / strumień / kula plazmy), fala rani sąsiadów (pula HP przez `applyDamageToNPC` / `applyDamageToPlayer`, łańcuch), wybuchy wtórne.

- Śmierć z puli HP: `ReactorGame.hostKilled(npc)` — rdzeń KRYTYCZNY / w STOPIENIU detonuje (kolejka do najbliższego kroku; `applyDamageToNPC` wtedy NIE robi wraku ani nie zwalnia ciała — robi to `afterHostDetonate`), nietknięty = czysty wrak. Gracz ginie zawsze detonacją (`force`, kadłub zostaje na encji gracza). Dawny losowy „krytyczny wybuch” (`tryTriggerCriticalReactorBlow`, `spawnReactorBlowBreakup`) usunięty.

- Obraz w `render()` po tarczach: `reactorBlastFx.advance / syncCores / syncHazards` (zegar = przyrost `SimClock.sim`) i `reactorModel3D.sync` (warstwa 7 — po `updateShields3D`, które ją zgłasza przypisaniem). Dev: `ReactorGame.forceMeltdown(npc, sek, wariant)`.
