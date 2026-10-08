# Fabuła — reżyser misji, intro w K-7, rozdział 1: misja 1 „Cicha stocznia” i misja 2 „Odwet” (2026-09-30, podział 2026-10-07)

Kampania startuje z panelu **Nowa gra → Start: Kampania** (domyślnie; **Swobodna** = dawny start przy Ziemi).
**Samouczek wł./wył.** włącza karty podpowiedzi w misjach 1 i 2 (misja 1 jest samouczkiem). Podzielony ekran — zawsze bez kampanii.

Rozdział 1 = dwie misje jedna po drugiej w tym samym świecie (`src/game/story/campaign.js`, decyzja użytkownika
2026-10-07: „znacząco wydłużyć akcję”, podział na dwie misje). Misja 1 kończy się w polu, nad gruzami stoczni;
między misjami naprawa Atlasa (docelowo okręt wsparcia z rojem dronów naprawczych — osobna praca, dziś naprawa
własna R). Skoki dev `?story=<faza>` biegną po fazach obu misji (`CAMPAIGN_PHASES`).

## Co widzi gracz

1. **Intro** (decyzje użytkownika 2026-09-30): menu pokazuje stronę Ziemi z halą K-7 (`MENU_SHOT.hallAzimuthOffsetDeg`,
   kołysanie zamiast obrotu). Po ekranie ładowania **kamera tła menu** (ta sama Ziemia i ring, bez przejścia przez czerń)
   leci z tego ujęcia do Ziemi, skosem nad halę K-7 (Ziemia w tle) i prostuje się do pionu nad zamkniętym dachem —
   dokładnie w kadrze kamery gry (`MenuBackdrop3D.fly`, plan `StoryGame.planMenuIntro`; słońce tła przechodzi w słońce
   gry, nad halą wycięcie górnej ściany jak w grze). Gra startuje w tym kadrze (kamera 2D), dach hali się otwiera —
   pod nim zadokowany Atlas (sprite 2D, żadnego modelu 3D), kamera dojeżdża do zoomu statku. Skok dev `?story=` i brak
   tła menu — lot kamerą perspektywy w grze (ten sam tor) i to samo otwarcie dachu.
2. **Odprawa w doku** — dialog sceny (świat stoi; Spacja / Enter dalej, Esc pomiń), przewody paliwowe podpięte do
   Atlasa (ramiona SCARA na słupkach paliwowych, zamki pola; suwnic nie ma od 2026-10-07).
3. **Odcumowanie** (2026-10-07, prośba użytkownika: „gracz musi zacząć w doku i kliknąć oddokuj, żeby go oddokowało,
   i samodzielnie wylecieć”; „ułóż go dziobem w stronę wyjścia z hali”) — Atlas stoi na C-01 DZIOBEM KU BRAMIE G-01,
   przypięty (stery zablokowane); panel stanowiska (`api.ui.action`, nakładka `.st-cmd`) pokazuje stan obsługi
   (paliwo, złącza, przewody, mocowania, napęd) i przycisk **ODDOKUJ** (klik albo Enter). Sekwencja obsługi
   (`STORY_UNDOCK` = `K7_SERVICE_UNDOCK`, `storyUndockPose`: przepływ → kontrolowany upust — para z przewodów
   paliwowych → odryglowanie (buch pary dookoła złączek) → złączki w górę → ramiona paliwowe się składają → zamki
   pola; pozy idą do rejestru kolidera — z nich rysuje hala i biorą się źródła gazu, AGENTS.md § „Obsługa paliwowa
   stanowisk K-7”); przy zwolnieniu zamków stery wracają do gracza (bez automatycznego wysuwania), ramiona dokładają
   się w trakcie wylotu. Gracz wylatuje naprzód (samouczek: W/S/A/D/Q/E).
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
7. **Bitwa w stoczni: zegar wodowania i herszt** (2026-10-07) — po alarmie załogi biegną do okrętów:
   - **Parking** — każdy okręt w stanowisku ma zegar (`MISSION01.launch`: pierwszy po 40 s, kolejne co 8 s, od końca
     parkingu G-E ku wjazdowi G-W, pancerniki +20 s; odliczanie w podpisie znacznika od 30 s i w celu misji). W połowie
     rozgrzewania załoga siada przy działach — okręt strzela ze stanowiska (`armNpc`). Na zero okręt **startuje**:
     brama stanowiska B-xx wypchnięta na zewnątrz, wyjazd rufą (dziobem dalej ku trzonowi, wolno), za ogrodzeniem
     obrót i do walki (`launchNpc` z trasą z `planShipyard`). Co zniszczysz przed startem, nie walczy (premia).
   - **Pochylnie** H-P1 / H-P2 w hali (pod dachem): niedokończone pancerniki (70% punktów) wodują się po 150 / 200 s
     i wylatują bramą G-01; Hexlance (4) przebija dach, albo trzeba wlecieć do hali. Bryła budowy znika, gdy na
     pochylni stoi okręt (`slipsHidden`).
   - **Eskorta (5) i supercapital herszta** wylatują z hali bramami (supercapital pierwszy). Herszt: przy 66% punktów
     każe startować wszystkim od razu (pozostały czas × 0,5), przy 33% ucieka w głąb obrzeży i ładuje skok 40 s —
     zatrzymany (zniszczony albo **mostek** — oznaczony znacznikiem MOSTEK; zniszczony mostek = okręt bez dowodzenia)
     daje premię, uciekinier wraca w misji 2.
   - Suchy dok można zburzyć w trakcie bitwy: łańcuch rozpadu zabiera to, co jeszcze stoi w stanowiskach, na
     pochylniach i w hali; wystartowane walczą dalej.
   Samouczek kierowania ogniem (`docs/BRIEF-kierowanie-ogniem.md`): działa burtowe biją same, LPM — salwa baterii
   w kursor, T — cel priorytetowy; karty: zegar wodowania, broń, słaby punkt (mostek).
8. **Suchy dok** — broń wbudowana **4** (Hexlance) przebija trzon i halę (bryły trafień doku, nie okrąg); 36 000 + 4 000
   punktów (~7 trafień); co 1/8 punktów odpada kawałek pod trafieniem, przy zniszczeniu łańcuch rozpadu po kotwicach
   (kawałki dryfują i obracają się, wybuchy przy dużych), okręty w stanowiskach idą z odcinkami trzonu.
9. **Koniec misji 1 w polu** — podsumowanie z wynikami (zatrzymane przed startem, los herszta) i premiami:
   **900 EXP + 40 / okręt zatrzymany + 300 za herszta, 40 000 CR + 1500 / okręt + 10 000 za herszta, Terra Nova +10,
   Piraci −12**.

### Misja 2 „Odwet” (`src/game/story/missions/mission02.js`)

1. **Naprawa w polu** (`repair`) — cel z kadłubem w % i czasem do odwetu (najwyżej 45 s; pełna naprawa skraca).
   AGENT: okręt wsparcia z rojem dronów naprawczych zamiast naprawy własnej (R) — `api.player.repair`.
2. **Trzy fale odwetu** z różnych stron (`MISSION02.waves`; razem skład z decyzji 2026-09-30: 7 pancerników,
   8 niszczycieli, 15 fregat): fala 1 (`counter`) — 4 niszczyciele + 9 fregat (karta: Supernova Barrage, 5); przerwa
   18 s; fala 2 (`counter2`) — 5 pancerników + 3 niszczyciele + 3 fregaty z flanki (karta: tryb TARCZE, ŚPM), w niej
   po 25 s **posiłki z Ziemi: 4 / 4 / 4** — słabsze od odwetu (dawniej 10 / 5 / 5 po 22 s i bitwa rozstrzygała się
   bez gracza); fala 3 (`counter3`) — **okręt herszta** + 2 / 1 / 3 (herszt, który uciekł z misji 1, wraca z 60%
   punktów; znacznik MOSTEK). Fala kończy się, gdy zostanie ≤ 15% — po 20 s reszta ucieka warpem; po upadku herszta
   reszta trzeciej fali ucieka po 6 s.
3. **Zwycięstwo** — **+1300 EXP, +50 000 CR, Terra Nova +10, Piraci −10**; wsparcie wraca na Ziemię (POWRÓT).
4. **Zasadzka w pasie asteroid** (`ambush`, 2026-10-07) — kurs na K-7 (cel „Wróć do hali K-7”, dziennik „Przeleć
   przez pas asteroid” — gracz o zasadzce nie wie). Kurs stocznia → Ziemia zawsze przecina pas (stocznia ≥ 8 AU za
   jego zewnętrzną krawędzią); miejsce liczy `src/game/story/beltAmbush.js` na cięciwie kursu w pasie: **przy
   olbrzymie**, gdy kurs mija jego bryłę bliżej niż 60 tys. j. (punkt PRZED bryłą — promień + 14 tys. j.: Atlas
   hamuje po wyrwaniu, nie wjeżdża w skałę), inaczej **w najgęstszym polu** na cięciwie (gęstość skał PLAY,
   wygładzona; brzegi pasa pominięte). Wyzwalacz: Atlas minął miejsce wzdłuż kursu z zapasem na hamowanie
   (prędkość × 0,08 s) albo przeciął promień miejsca (zszedł z kursu). Wtedy **wyrwanie z warpa** — wyjście bez rampy
   i hamowanie jak przy studni grawitacji (`api.nav.interdict` → `triggerGravityWarpBrake`; ładowanie skoku
   przerwane), kurs zdjęty na czas walki. **Front** (niszczyciel + 4 fregaty + **zakłócacz warpa** — niszczyciel ze
   znacznikiem) 6,5 km przed Atlasem na kursie, tunele z pola 40 km przed nim; po 12 s **skrzydło** (3 fregaty) z boku
   kursu. Póki zakłócacz żyje, każdy skok (też ładowanie) się zrywa („WARP ZAKŁÓCANY”). Po zakłócaczu: zasadzka łamie
   się jak fale (≤ 15% → po 20 s ucieczka) albo Atlas odlatuje dalej niż 40 km i reszta zostaje w pasie (ucieka).
   Kurs na K-7 wraca.
5. **Powrót** (`return`) — reszta drogi do K-7, przy porcie przez czerń do stanowiska, scena w doku.

Porażka: zniszczony Atlas przerywa misję (dziennik: „nieudana”).

## Gdzie dopisać fabułę (dialogi, portrety)

- **Kwestie:** `src/data/story/mission01.dialogue.js` i `mission02.dialogue.js` — sceny (`briefing`, `alarm`, `victory`, …) to tablice kwestii
  `{ who, text, portrait?, hold? }`. Teksty w `[nawiasach]` to zaślepki opisujące, co ma paść. Liczba kwestii dowolna.
- **Obsada i portrety:** `src/data/story/cast.js` — imię, rola, barwa, strona okna (`left` swoi / `right` wrogowie) i
  `portrait` (`null` = zastępcza sylwetka z inicjałami; ścieżka np. `assets/portraits/admiral.png`, kwadrat ~512 px).
  Kwestia może nadpisać portret (inna mina).
- **Podpowiedzi samouczka:** `MISSION01_HINTS` / `MISSION02_HINTS` w `src/game/story/missions/`.
- **Strojenie:** `MISSION01` (zegar wodowania `launch`, herszt `boss`, punkty doku, nagrody i premie) i `MISSION02`
  (fale, posiłki, przerwy, ucieczka, zasadzka `ambush`, nagrody); trasy wyjazdu ze stanowisk i pochylni —
  `SHIPYARD_TUNE`; miejsce i wyzwalacz zasadzki — `BELT_AMBUSH_TUNE` (`beltAmbush.js`).

## Kod

| Moduł | Rola |
|---|---|
| `src/game/story/storyRunner.js` | Wykonawca skryptów misji: `async` z `ctx.wait` (czas gry), `until`, `event`, `spawn`, `phase`; anulowanie. |
| `src/game/story/dialogue.js` | Kolejka kwestii: scena (czeka na gracza) i radio (samo, w trakcie gry), pisanie znak po znaku. |
| `src/game/story/storyGame.js` | Klej z grą: kamera intro, dach K-7, blokada Atlasa w doku i odcumowanie (ODDOKUJ), dialogi, cele, znaczniki, stocznia, fale, nagrody, dziennik, skoki dev. |
| `src/game/story/campaign.js` | Rozdział 1: misja 1, potem misja 2; fazy kampanii `CAMPAIGN_PHASES` (skoki dev). |
| `src/game/story/missions/mission01.js`, `mission02.js` | Skrypty misji (fazy `MISSION01_PHASES`, `MISSION02_PHASES`); stan między misjami w `api.campaign`. |
| `src/game/story/storyNpcControl.js` | Rozkazy dla okrętów misji: wylot z doku trasą (też wyjazd rufą), załoga przy działach, ucieczka. |
| `src/game/story/beltAmbush.js` | Zasadzka misji 2: cięciwa kursu w pasie, miejsce przy olbrzymie albo w najgęstszym polu (`planBeltAmbush`), wyzwalacz z zapasem na hamowanie (`beltAmbushReached`); w skrypcie przez `api.belt`. |
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
| `src/ui/missionTargetMarkers.js` | Wybrane cele do zniszczenia: narożniki i ukośny podpis jak Atlas w G, dystans, wskaźniki poza kadrem; skupisko celów jednej grupy — jeden podpis z licznikiem; tylko w zasięgu radaru gracza. |
| `src/game/story/storyOptions.js` | Kampania / Swobodna, Samouczek (localStorage `sc_story_campaign`, `sc_story_tutorial`). |

Wpięcia w `index.html` (blok „FABUŁA” przed `startGame`): `StoryGame.init(deps)`, `beginNewGame` w `startGame`
(poza kamery menu przed `stopMenuBackdrop`), pętla (`StoryGame.worldFrozen` = pauza, `tick` / `frame`, nakładka po
`render`), kamera w `render()` (tam, gdzie kamera K), `applyPlayerLock` w `physicsStep`, blokada wejścia (klawiatura,
mysz), maskowanie (klawisz I, zrywanie: szyna strzałów, Hexlance, `CollisionFX`, `applyDamageToPlayer`), `callInSupport`
(`opts.origin`, `opts.onSpawned`), odlot dowolnej grupy (`storyWarpOutUnits`), `window.applyDamageToStation`,
zasadzka w pasie (`interdictWarp` → `storyInterdictWarp`, `beltDensity` — pole pasa, `beltGiants` — olbrzymy).
Fala w zadanym miejscu: `api.fleet.pirateWave(site, skład, { at, facing?, origin, tag, extra })` (bez `at` — front
od gracza w stronę `site.origin`, jak fale odwetu).
Poza `index.html`: Hexlance trafia stacje wrogie (`superweapon.js`, `HEXLANCE_STATION_DAMAGE`), AI nie widzi
zamaskowanego gracza (`fleetAwareness.js`, `capitalAI.js`, `aiUtils.js`, `fighterAI.js`), dach hali z reżysera
(`HaloRingGame.hallRoofOverride`), poza kamery tła menu (`MenuBackdrop3D.cameraPose`).

Skrypt zaznacza ważny cel przez `api.ui.target(id, entity, label, { radius?, primary?, group? })`, zdejmuje przez
`api.ui.target(id, null)`; `api.ui.clearTargets()` usuwa wszystkie. HUD śledzi żywą encję i chowa marker
po zniszczeniu, wyjściu z aktualnego zasięgu radaru lub przy maskowaniu. Misja 1 oznacza 10 okrętów parkingu
w fazie taranu (grupa „Parking”), okręty obrony w fazie obrony (grupa „Eskorta”, supercapital osobno) i budynek
w fazie stoczni; odwet nie dostaje tych podpisów.
`radius` jest promieniem obrysu w jednostkach świata (budynek używa rozmiaru bryły, nie promienia kolizji).
`primary: true` ustawia również pozycję głównego celu w dzienniku i na mapie CIC.
`group` (2026-10-07, zgłoszenie: „ile napisów ZNISZCZ i jak szerokie”): cele jednej grupy, których ramki dzieli
na ekranie < 90 px (rozchodzą się > 130 px), mają ramkę każdy, ale JEDEN podpis „GRUPA / ×n · km do
najbliższego”; poza kadrem — jeden grot na krawędź. Kreska podpisu celu ≤ 52 px; podpis grupy bez wolnego
miejsca znika (ramka zostaje), cel spoza grupy zawsze ma podpis. Rząd okrętów bez grupy = 10 podpisów z
kreskami przez pół ekranu.

## Testy i narzędzia

- `node --test tests/storyCore.test.mjs tests/storyMission.test.mjs` — reżyser, dialogi, EXP, maskowanie, tor kamery,
  układ stoczni (trasy wyjazdu ze stanowisk i pochylni), K-7 i **cała kampania na atrapie gry** (misja 1: zegar
  wodowania, starty, przyspieszenie i ucieczka herszta, dok w środku bitwy; misja 2: naprawa, fale, posiłki, herszt,
  zasadzka w pasie — wyrwanie z warpa, zakłócacz zrywa skok, skrzydło, ucieczka albo odlot Atlasa; nagrody, dziennik,
  skoki dev) i geometria zasadzki (cięciwa, olbrzym, najgęstsze pole, wyzwalacz).
- `node scripts/webgpu/zasadzka-gra.mjs [--walka 15] [--dok 1]` — prawdziwa gra, `?story=ambush`: plan miejsca
  (olbrzym / pole, gęstość), skok TRAVEL TO, chwila wyrwania i hamowanie, przylot piratów, klawisz 9 pod zakłócaczem
  (skok ma się zerwać), walka wśród skał, zakłócacz, skrzydło, kurs przywrócony i dalszy lot warpem; pipeline'y
  synchroniczne po starcie fazy.
- `node scripts/webgpu/wodowanie-gra.mjs [--czas 150]` — prawdziwa gra, `?story=defences`: kamera nad parkingiem,
  co sekundę stan okrętów parkingu i pochylni (w stanowisku / przy działach / wystartował, odległość od ogrodzenia),
  bramy stanowisk, cel, baner; herszt do 60% (przyspieszenie) i 30% (ucieczka, mostek); kadry startów.
- `node scripts/webgpu/fabula-gra.mjs` — prawdziwa gra w headless Chrome (WebGPU): kadry lotu kamery, cięcie i dach,
  odprawa, panel ODDOKUJ i odcumowanie, kamera gry. `--faza counter` (itd.) — skok dev i kadry fazy.
- `node scripts/webgpu/hala-swiatla-gra.mjs --kampania` — start kampanii do panelu ODDOKUJ, klik myszą, kadry upustu
  z przewodów i wylotu.
- Skok dev w grze: `index.html?story=scout|approach|ram|defences|shipyard|aftermath|repair|counter|counter2|counter3|ambush|return`
  (`ambush` — Atlas 120 tys. j. przed miejscem zasadzki na kursie; `return` omija zasadzkę)
  (wcześniejsze fazy pominięte, świat ustawiony jak po nich; faza misji 2 przechodzi misję 1 jako pominiętą).

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
