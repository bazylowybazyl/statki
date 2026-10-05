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
4. **Kurs i skok** — kurs na obrzeża układu (znacznik), skok warp (9; Shift dopiero poza studnią Ziemi). Wywiad nie
   jest pewny, co tam jest (bez pewniaka): wyjście z warpa „kawałek dalej” — `site.warpIn`, ~60 km przed rzędem,
   poza zasięgiem wzroku Atlasa.
4a. **Rozpoznanie (mgła wojny, 2026-10-04)** — czujniki grawitacyjne widzą tylko **dużą masę**: sygnatura w mgle (wir
   zagęszczonej mgły z ciemnym jądrem, znacznik „NIEZNANA MASA · ~masa · odległość”, miejsce z odchyłką). Gracz
   rozpoznaje ją dronem zwiadu (**PPM w pustej przestrzeni → DRON ZWIADU** albo mapa CIC → SEND DRONE) albo ostrożnym
   podejściem (obrona wykrywa niezamaskowanego Atlasa z ~9 km — `site.detected`). Rozpoznanie = budynek albo okręt
   stoczni widziany przez stronę gracza (`api.site.scouted`); sygnatura gaśnie, XO: „to stocznia piratów”. Mgła
   wyłączona w menu — faza mija od razu. Mechanika mgły: AGENTS.md § „Mgła wojny”.
5. **Podejście** — maskowanie **I**, podejście do **suchego doku piratów** (szkic użytkownika 2026-10-05): trzon 5,7 km
   wzdłuż kierunku podejścia, po jednej stronie parking zamknięty ogrodzeniem — 10 okrętów burta w burtę (dziobem ku
   trzonowi), cienkie bramy taranowe na końcach; po drugiej hala jak K-7 wpięta w trzon, brama G-01 od kosmosu.
   Znacznik „Rząd okrętów” = początek toru taranu przed bramą G-W (środek parkingu).
6. **Taran** — szarża **F** (zryw do 3000 j/s na 5 s kosztem ładunku reaktora, `ramBurn.js`): Atlas rozbija cienką
   bramę G-W (kawałek wylatuje, iskry) i miażdży kadłuby po kolei (silnik belek; pokład parkingu i rękawy leżą pod
   płaszczyzną gry — tor wolny); zaliczony kadłub = zniszczony albo z konstrukcją < 30%; taran (brama albo okręt)
   zdejmuje maskowanie → alarm.
7. **Obrona stoczni** — wieżyczki (6) budzą się, eskorta (5) wylatuje z hali doku bramami (dach hali otwiera się na
   czas wylotu, koguty alarmu); samouczek kierowania ogniem
   (`docs/BRIEF-kierowanie-ogniem.md`): działa burtowe biją same (najpierw to, co strzela do gracza), LPM — salwa
   baterii Yamato w kursor, T — cel priorytetowy. Zaparkowane, uśpione okręty nie są celem wież na auto.
8. **Suchy dok** — broń wbudowana **4** (Hexlance) przebija trzon i halę (bryły trafień doku, nie okrąg); co 1/8 punktów
   odpada kawałek pod trafieniem, przy zniszczeniu łańcuch rozpadu po kotwicach (kawałki dryfują i obracają się,
   wybuchy przy dużych), okręty na parkingu idą z odcinkami trzonu.
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
| `src/game/story/shipyardLayout.js` | Układ stoczni wokół suchego doku (`planShipyard`, `placeDryDock`: okręty na parkingu, eskorta w hali z trasami wylotu, wieżyczki, tor taranu przez bramy, zbiórka, `warpIn`, bryły trafień `dryDockSegmentHit` i taranu `dryDockRamOverlap` w grze) i szyk fal. |
| `src/3d/portBuildings/pirateDryDock*.js`, `src/3d/pirateDryDockGame.js` | Suchy dok piratów: układ, bryły (budowle Z7), render, kawałki pod silnik zniszczeń, klej gry (AGENTS.md § „Suchy dok piratów”). |
| `src/game/fogOfWar.js` (przez `SensorSystem`) | Mgła wojny: wzrok strony gracza, sygnatury masy (`api.fog.mass`), rozpoznanie (`api.fog.seen`). |
| `src/game/story/progression.js` | EXP i stopnie. |
| `src/game/cloak.js` | Maskowanie: energia, włączanie, zerwanie (strzał, taran, trafienie), przeładowanie. |
| `src/ui/storyOverlay.js` + `assets/css/story.css` | Pasy kinowe, okno dialogu z portretem, cel, karta samouczka, znaczniki, podsumowanie, pasek maskowania. |
| `src/ui/missionTargetMarkers.js` | Wybrane cele do zniszczenia: narożniki i ukośny podpis jak Atlas w G, dystans, wskaźniki poza kadrem; tylko w zasięgu radaru gracza. |
| `src/game/story/storyOptions.js` | Kampania / Swobodna, Samouczek (localStorage `sc_story_campaign`, `sc_story_tutorial`). |

Wpięcia w `index.html` (blok „FABUŁA” przed `startGame`): `StoryGame.init(deps)`, `beginNewGame` w `startGame`
(poza kamery menu przed `stopMenuBackdrop`), pętla (`StoryGame.worldFrozen` = pauza, `tick` / `frame`, nakładka po
`render`), kamera w `render()` (tam, gdzie kamera K), `applyPlayerLock` w `physicsStep`, blokada wejścia (klawiatura,
mysz), maskowanie (klawisz I, zrywanie: szyna strzałów, Hexlance, `CollisionFX`, `applyDamageToPlayer`), `callInSupport`
(`opts.origin`, `opts.onSpawned`), odlot dowolnej grupy (`storyWarpOutUnits`), `window.applyDamageToStation`.
Poza `index.html`: Hexlance trafia stacje wrogie (`superweapon.js`, `HEXLANCE_STATION_DAMAGE`), AI nie widzi
zamaskowanego gracza (`fleetAwareness.js`, `capitalAI.js`, `aiUtils.js`, `fighterAI.js`), dach hali z reżysera
(`HaloRingGame.hallRoofOverride`), poza kamery tła menu (`MenuBackdrop3D.cameraPose`).

Skrypt zaznacza ważny cel przez `api.ui.target(id, entity, label, { radius?, primary? })`, zdejmuje przez
`api.ui.target(id, null)`; `api.ui.clearTargets()` usuwa wszystkie. HUD śledzi żywą encję i chowa marker
po zniszczeniu, wyjściu z aktualnego zasięgu radaru lub przy maskowaniu. Misja 1 oznacza sześć wieżyczek
w fazie obrony i budynek w fazie stoczni; eskorta, zaparkowana flota i odwet nie dostają tych podpisów.
`radius` jest promieniem obrysu w jednostkach świata (budynek używa rozmiaru bryły, nie promienia kolizji).
`primary: true` ustawia również pozycję głównego celu w dzienniku i na mapie CIC.

## Testy i narzędzia

- `node --test tests/storyCore.test.mjs tests/storyMission.test.mjs` — reżyser, dialogi, EXP, maskowanie, tor kamery,
  układ stoczni, K-7 i **cała misja 1 na atrapie gry** (fazy, dok, fale, nagrody, dziennik, skok dev).
- `node scripts/webgpu/fabula-gra.mjs` — prawdziwa gra w headless Chrome (WebGPU): kadry lotu kamery, cięcie i dach,
  odprawa, wysunięcie, kamera gry. `--faza counter` (itd.) — skok dev i kadry fazy.
- Skok dev w grze: `index.html?story=scout|approach|ram|defences|shipyard|counter|return` (wcześniejsze fazy pominięte,
  świat ustawiony jak po nich).

## Otwarte (AGENT:)

- Wieżyczki = nieruchome platformy NPC na kadłubie pirackiej fregaty (`spawnStoryTurret`) — do podmiany na model platformy.
- Budynek stoczni = suchy dok piratów (2026-10-05). Zniszczenie dziś: kawałki odpadają macierzami grup renderu + wybuchy;
  docelowo ciała silnika zniszczeń (płaska kratownica z rzutu doku — `pirateDryDockChunks.js`, F2 planu zniszczeń).
  Kolizja statków z trzonem i ścianami hali — z ciałami silnika (dziś statki przelatują nad dokiem jak nad stacją).
- Maskowanie (wygląd 2026-10-04, jak w Crysis — AGENTS.md § „Maskowanie: wygląd”): fala heksów od generatora w środku
  kadłuba, ukryty kadłub = refrakcja tła (warstwa DIST) + szkło i łamana poświata brzegu, migotanie przy końcu energii,
  zakłócenie przy zerwaniu; wieżyczki, dysze, lampy, reflektory i cień gasną z komórką pod sobą. Opcja „Statki 3D”: na czas
  efektu okręt rysuje skóra sprite'a (AGENT: rozpuszczanie samej bryły 3D tym samym wzorem).
- Brak zapisu gry: postęp kampanii (EXP, misje) żyje do przeładowania.
