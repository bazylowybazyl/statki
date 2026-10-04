# Fabuła — reżyser misji, intro w K-7, misja 1 „Cicha stocznia” (2026-09-30)

Kampania startuje z panelu **Nowa gra → Start: Kampania** (domyślnie; **Swobodna** = dawny start przy Ziemi).
**Samouczek wł./wył.** włącza karty podpowiedzi w misji 1 (misja 1 jest samouczkiem). Podzielony ekran — zawsze bez kampanii.

## Co widzi gracz

1. **Intro** (decyzje użytkownika 2026-09-30): menu pokazuje stronę Ziemi z halą K-7 (`MENU_SHOT.hallAzimuthOffsetDeg`,
   kołysanie zamiast obrotu). Po ekranie ładowania **kamera tła menu** (ta sama Ziemia i ring, bez przejścia przez czerń)
   leci z tego ujęcia do Ziemi, skosem nad halę K-7 (Ziemia w tle) i prostuje się do pionu nad zamkniętym dachem —
   dokładnie w kadrze kamery gry (`MenuBackdrop3D.fly`, plan `StoryGame.planMenuIntro`; słońce tła przechodzi w słońce
   gry, nad halą wycięcie górnej ściany jak w grze). Gra startuje w tym kadrze (kamera 2D), dach hali się otwiera —
   pod nim zadokowany Atlas (sprite 2D, żadnego modelu 3D), kamera dojeżdża do zoomu statku. Skok dev `?story=` i brak
   tła menu — lot kamerą perspektywy w grze (ten sam tor) i to samo otwarcie dachu.
2. **Odprawa w doku** — dialog sceny (świat stoi; Spacja / Enter dalej, Esc pomiń), suwnice podpięte do Atlasa.
3. **Odcumowanie** — suwnice puszczają, Atlas wysuwa się rufą ze stanowiska C-01 i obraca dziobem do bramy G-01;
   potem sterowanie gracza: wyleć z hali (samouczek: W/S/A/D/Q/E).
4. **Kurs i skok** — kurs na stocznię wyznaczony (znacznik), skok warp (9; Shift dopiero poza studnią Ziemi).
5. **Podejście** — maskowanie **I**, podejście do rzędu zaparkowanych okrętów.
6. **Taran** — szarża **F** (zryw do 3000 j/s na 5 s kosztem ładunku reaktora, `ramBurn.js`) i Atlas miażdży kadłuby
   w rzędzie (silnik belek); zaliczony kadłub = zniszczony albo z konstrukcją < 30%; taran zdejmuje maskowanie → alarm.
7. **Obrona stoczni** — wieżyczki (6) i eskorta (5) budzą się; samouczek kierowania ogniem
   (`docs/BRIEF-kierowanie-ogniem.md`): działa burtowe biją same (najpierw to, co strzela do gracza), LPM — salwa
   baterii Yamato w kursor, T — cel priorytetowy. Zaparkowane, uśpione okręty nie są celem wież na auto.
8. **Budynek** — broń wbudowana **4** (Hexlance) przebija bryłę stacji; łańcuch wybuchów reaktorów, reszta rzędu idzie z zakładem.
9. **Odwet** — z głębi obrzeży tunelem „Nurt” wychodzi flota piratów: **7 pancerników, 8 niszczycieli, 15 fregat**
   (fale, bo efekt przylotów ma 24 miejsca). Po ~22 s z Ziemi wsparcie: **10 pancerników, 5 niszczycieli, 5 fregat**.
   Przy 20% żywego odwetu reszta ucieka warpem.
10. **Zwycięstwo** — podsumowanie: **+1500 EXP, +60 000 CR, Terra Nova +15, Piraci −20** (stopnie w `progression.js`);
    wsparcie wraca na Ziemię (POWRÓT). **Powrót** — kurs na K-7, przy porcie przez czerń do stanowiska, scena w doku.

Porażka: zniszczony Atlas przerywa misję (dziennik: „nieudana”).

## Gdzie dopisać fabułę (dialogi, portrety)

- **Kwestie:** `src/data/story/mission01.dialogue.js` — sceny (`briefing`, `alarm`, `victory`, …) to tablice kwestii
  `{ who, text, portrait?, hold? }`. Teksty w `[nawiasach]` to zaślepki opisujące, co ma paść. Liczba kwestii dowolna.
- **Obsada i portrety:** `src/data/story/cast.js` — imię, rola, barwa, strona okna (`left` swoi / `right` wrogowie) i
  `portrait` (`null` = zastępcza sylwetka z inicjałami; ścieżka np. `assets/portraits/admiral.png`, kwadrat ~512 px).
  Kwestia może nadpisać portret (inna mina).
- **Podpowiedzi samouczka:** `MISSION01_HINTS` w `src/game/story/missions/mission01.js`.
- **Nagrody, składy flot, próg ucieczki:** `MISSION01` w tym samym pliku.

## Kod

| Moduł | Rola |
|---|---|
| `src/game/story/storyRunner.js` | Wykonawca skryptów misji: `async` z `ctx.wait` (czas gry), `until`, `event`, `spawn`, `phase`; anulowanie. |
| `src/game/story/dialogue.js` | Kolejka kwestii: scena (czeka na gracza) i radio (samo, w trakcie gry), pisanie znak po znaku. |
| `src/game/story/storyGame.js` | Klej z grą: kamera intro, dach K-7, blokada Atlasa w doku i wysunięcie, dialogi, cele, znaczniki, stocznia, fale, nagrody, dziennik, skoki dev. |
| `src/game/story/missions/mission01.js` | Skrypt misji 1 (fazy `MISSION01_PHASES`). |
| `src/game/story/introCamera.js` | Tor kamery (Hermite w czasie), poza z góry = kadr kamery gry. |
| `src/3d/menuBackdrop3D.js` (`fly`, `cameraPose`, `sunLocal`) | Lot intro w tle menu; ujęcie menu na stronę Ziemi z K-7. |
| `src/3d/haloRing/haloRingGame.js` (`hallRoofOverride`, `showcaseHallCut`, `gameSunLocal`) | Dach K-7 z reżysera, wycięcie ściany nad halą w tle menu, słońce gry w układzie ringu. |
| `src/game/story/k7Dock.js` | Hala K-7 w układzie gry (stanowiska, brama, „poza halą”). |
| `src/game/story/shipyardLayout.js` | Układ stoczni (rząd, wieżyczki, eskorta, punkt zbiórki) i szyk fal. |
| `src/game/story/progression.js` | EXP i stopnie. |
| `src/game/cloak.js` | Maskowanie: energia, włączanie, zerwanie (strzał, taran, trafienie), przeładowanie. |
| `src/ui/storyOverlay.js` + `assets/css/story.css` | Pasy kinowe, okno dialogu z portretem, cel, karta samouczka, znaczniki, podsumowanie, pasek maskowania. |
| `src/game/story/storyOptions.js` | Kampania / Swobodna, Samouczek (localStorage `sc_story_campaign`, `sc_story_tutorial`). |

Wpięcia w `index.html` (blok „FABUŁA” przed `startGame`): `StoryGame.init(deps)`, `beginNewGame` w `startGame`
(poza kamery menu przed `stopMenuBackdrop`), pętla (`StoryGame.worldFrozen` = pauza, `tick` / `frame`, nakładka po
`render`), kamera w `render()` (tam, gdzie kamera K), `applyPlayerLock` w `physicsStep`, blokada wejścia (klawiatura,
mysz), maskowanie (klawisz I, zrywanie: szyna strzałów, Hexlance, `CollisionFX`, `applyDamageToPlayer`), `callInSupport`
(`opts.origin`, `opts.onSpawned`), odlot dowolnej grupy (`storyWarpOutUnits`), `window.applyDamageToStation`.
Poza `index.html`: Hexlance trafia stacje wrogie (`superweapon.js`, `HEXLANCE_STATION_DAMAGE`), AI nie widzi
zamaskowanego gracza (`fleetAwareness.js`, `capitalAI.js`, `aiUtils.js`, `fighterAI.js`), dach hali z reżysera
(`HaloRingGame.hallRoofOverride`), poza kamery tła menu (`MenuBackdrop3D.cameraPose`).

## Testy i narzędzia

- `node --test tests/storyCore.test.mjs tests/storyMission.test.mjs` — reżyser, dialogi, EXP, maskowanie, tor kamery,
  układ stoczni, K-7 i **cała misja 1 na atrapie gry** (fazy, dok, fale, nagrody, dziennik, skok dev).
- `node scripts/webgpu/fabula-gra.mjs` — prawdziwa gra w headless Chrome (WebGPU): kadry lotu kamery, cięcie i dach,
  odprawa, wysunięcie, kamera gry. `--faza counter` (itd.) — skok dev i kadry fazy.
- Skok dev w grze: `index.html?story=approach|ram|defences|shipyard|counter|return` (wcześniejsze fazy pominięte,
  świat ustawiony jak po nich).

## Otwarte (AGENT:)

- Wieżyczki = nieruchome platformy NPC na kadłubie pirackiej fregaty (`spawnStoryTurret`) — do podmiany na model platformy.
- Budynek stoczni = stacja piracka (`attachPirateStation3D`) — własny model i zniszczenie w silniku zniszczeń 3D (osobna sesja użytkownika).
- Maskowanie: kadłub (skóra 2D) rozpuszcza się linią od rufy z zimnym szwem, ukryty — blady szew skanuje sylwetkę
  (`applyCloakHullLook` w `index.html`, uniformy `hullWarp`). Modele 3D (opcja „Statki 3D”), dysze i światła pozycyjne
  zostają widoczne.
- Brak zapisu gry: postęp kampanii (EXP, misje) żyje do przeładowania.
