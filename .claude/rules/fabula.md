---
paths:
  - "src/game/story/**"
  - "src/data/story/**"
---

# Fabuła: reżyser misji, intro w K-7, kampania (misja 1 i 2)

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Fabuła: reżyser misji, intro w K-7, rozdział 1 = misja 1 + misja 2 (`src/game/story/`, opis `docs/FABULA.md`)

- Nowa gra → Start: Kampania (domyślnie) / Swobodna, Samouczek wł./wył. (`storyOptions.js`). Kampania = rozdział 1 z dwóch misji w tym samym świecie (`campaign.js`, podział 2026-10-07 — decyzja użytkownika „znacząco wydłużyć akcję”). Misja 1 „Cicha baza” (samouczek; baza piratów zamiast suchego doku od 2026-10-11 — § „Baza piratów”): dok K-7 → skok na obrzeża („kawałek dalej” — `site.warpIn`; baza 57 AU od Słońca NA OSI BRAMY K-7 — `_shipyardCenter`, tor omija studnię Ziemi, Słońce i inne planety; gracz nadlatuje na poprzeczkę T) → rozpoznanie przez mgłę wojny FREGATĄ ZWIADU z ładowni Atlasa (§ „Fregata zwiadu w ładowni Atlasa”; H — start, oblot bazy: cel „budowle n / 4”, X — skan, T — oznaczenia, potem „Odwołaj fregatę (H)”; obrona wykrywa fregatę bliżej niż `PIRATE_BASE_TUNE.scoutDetect` (3 km) od obwiedni bazy albo od okrętu z załogą — `StoryGame._detected`, cel ostrzega od `scoutWarn`; powrót do ładowni omija bazę — `api.scout.avoidBase` → `ScoutBay.setAvoid`; gra bez fregaty — dron zwiadu / podejście) → maskowanie (klawisz I) → taran rzędu okrętów przy ramieniu A (szarża F albo Hexlance 4 wzdłuż rzędu) → alarm: DRONY z hangarów habitatu (gracz odpala swoje myśliwce — Z), ZEGAR STARTÓW (12 okrętów z załogą odchodzi od pomostów po kolei rufą, od najdalszych; w połowie rozgrzewania strzelają ze stanowiska; reszta w remoncie; co zniszczone przed startem — premia) i SUPERCAPITAL HERSZTA z zatoki przy zbiornikach (66% — przyspiesza starty, 33% — ucieka i ładuje skok; znacznik MOSTEK = słaby punkt; uciekinier wraca w misji 2) → habitat (finał, 36 000 + 4 000 punktów; rozpad i implozja, ogień w rurach od środka) → podsumowanie w polu (premie: zatrzymane, herszt, reakcja łańcuchowa, magazyn). Wysadzone zbiorniki paliwa w dowolnej chwili = reakcja łańcuchowa (bez podpowiedzi). Misja 2 „Odwet”: naprawa w polu (dziś R; AGENT: okręt wsparcia z dronami naprawczymi) → trzy fale z różnych stron (razem 7/8/15, w trzeciej herszt), posiłki 4/4/4 w drugiej → nagrody → ZASADZKA W PASIE (`ambush`, 2026-10-07: kurs stocznia → K-7 zawsze przecina pas; `src/game/story/beltAmbush.js` — miejsce na cięciwie kursu przy olbrzymie, gdy kurs go mija, przed bryłą, inaczej w najgęstszym polu; wyzwalacz z zapasem na hamowanie; wyrwanie z warpa `api.nav.interdict` → `storyInterdictWarp` w bloku FABUŁA = `triggerGravityWarpBrake`; front z ZAKŁÓCACZEM — póki żyje, skok się zrywa — i skrzydło z boku przez `api.fleet.pirateWave(…, { at, origin })`) → powrót do K-7 (`return`).

- START W DOKU (2026-10-07, prośby użytkownika: „gracz musi zacząć w doku i kliknąć oddokuj … i samodzielnie
  wylecieć”, „ułóż go dziobem w stronę wyjścia z hali”): Atlas stoi na C-01 dziobem ku bramie G-01 (kurs stanowiska
  + π), przypięty — ZANIM pokaże go kamera (poprawka 2026-10-14: w intro i scenach świat stoi, więc fizyka ramion
  dopinała statek dopiero po locie kamery): poza fabuły z `settle` (`_servicePose`: zamki i obsługa podpięte, bez
  sekwencji) — ramiona i przewody hali od razu na wlewach także przy dt = 0 (§ „Obsługa paliwowa stanowisk K-7”);
  sam przycisk ODDOKOWANIE (`api.ui.action` → `StoryGame.ui.action`, nakładka `.st-cmd` w wariancie `bare` — akcja bez
  nagłówka, wierszy i `alt`; decyzja użytkownika 2026-10-14: bez panelu stanowiska z wierszami obsługi i bez
  WYPOSAŻENIA; F — klawisz `spec.key` (litera = kod klawisza), klik, pad A → `StoryGame.triggerAction`). Sekwencja `STORY_UNDOCK` = `K7_SERVICE_UNDOCK`
  (`storyUndockPose`; przepływ → upust → odryglowanie z buchem pary → złączki w górę → ramiona paliwowe się składają →
  zamki pola) w czasie gry; napęd wraca przy zwolnieniu zamków (`driveAt`) — ramiona dokładają się nad płaszczyzną lotu
  w trakcie wylotu, bez automatycznego wysuwania (dawna animacja `lock.anim` nieużywana). Pozy idą do rejestru kolidera
  (hala rysuje z nich ramiona i przewody, źródła gazu — buchy pary).
  HALA ATLASA (2026-10-26, prośby użytkownika: „zachowaj wolny slot dla Atlasa”, „zapełnij resztę slotów statkami Terra
  Nova”, „zamknij domyślnie ładownię Atlasa”): C-01 hali K-7 nr 0 to stanowisko domowe gracza w ruchu v2
  (`PLAYER_HOME_BERTHS`, `init.homeBerths`) — zapas floty i kursy nigdy na nim nie stają, a hala jest zapełniona okrętami
  frakcji portu (Terra Nova) pierwsza i do końca (reguła `ruch-v2`, § „Bańka w grze”: ZAPAS FLOTY — hala domowa,
  STANOWISKA — stanowisko domowe). Okręty hali widać już w odprawie (bańka w zatrzymanym świecie). Luk Atlasa w doku
  zamknięty (otwiera go tylko terminal stacji — reguła `przeladunek-portow`). Sprawdzenie w grze: kampania od menu,
  `TrafficBubble.list` z `berthId` `earth:K7-1:…` (27 encji, żadna na C-01), `PortCargo.playerDoor` = 0.

- Skrypt misji to funkcja `async` na `createStoryRunner` (`ctx.wait` w CZASIE GRY, `until`, `event`, `spawn`, `phase`); gry dotyka tylko przez `api` z `storyGame.js` (zależności z bloku „FABUŁA” w `index.html`). Nowa misja = nowy skrypt w `missions/` + kwestie w `src/data/story/` (obsada i portrety: `cast.js`), nie logika w `index.html`.

- Intro leci w TLE MENU (`MenuBackdrop3D.fly`, plan `StoryGame.planMenuIntro`) JEDNYM najazdem z ujęcia menu (`buildDockIntroKeys`: menu → skos nad K-7 → pion; odległość od hali maleje przez cały tor — 2026-10-05, dawniej „do Ziemi, odjazd, drugi najazd”; start gry w kampanii woła `launch({ dolly: false })` — tło tylko wyśrodkowuje planetę) i kończy się kadrem kamery gry z góry nad zamkniętym dachem K-7; gra otwiera dach (`HaloRingGame.hallRoofOverride`) nad Atlasem-sprite'em — bez modeli 3D statku w intro (decyzja użytkownika). Menu pokazuje stronę Ziemi z K-7 — nie wracaj do pełnego obrotu „talerza”.

- `StoryGame.worldFrozen` = pauza w pętli (sceny, lot, podsumowanie; czujniki i mgła wojny liczą się w niej z dt = 0 — `stepSensors(0)`, inaczej kadr startu jest szary do pierwszego kroku fizyki); `StoryGame.blocksInput` wyłącza klawisze i mysz gry; `applyPlayerLock` trzyma Atlasa w doku. Maskowany gracz (`isCloakHidden`) nie istnieje dla datalinku, wież i wyboru celów AI — nowa ścieżka celowania w gracza musi to sprawdzać.

- Rozkazy dla okrętów misji (wylot z doku trasą — też wyjazd rufą ze stanowiska, załoga przy działach, ucieczka) — `storyNpcControl.js`; w `index.html` tylko podpięcie zależności. Okręt z `__storyLaunched` już nie stoi w stanowisku: łańcuch rozpadu doku i odcinki trzonu go nie zabierają (`site.inBerth`). Stan między misjami: `api.campaign` (`bossEscaped`, wynik misji 1).

- Testy: `tests/storyCore.test.mjs`, `tests/storyMission.test.mjs` (cała kampania na atrapie gry); prawdziwa gra: `node scripts/webgpu/fabula-gra.mjs [--faza X]`, zegar wodowania i herszt: `node scripts/webgpu/wodowanie-gra.mjs`, zasadzka w pasie: `node scripts/webgpu/zasadzka-gra.mjs`; skok dev `?story=scout|approach|ram|defences|shipyard|aftermath|repair|counter|counter2|counter3|ambush|return` (faza misji 2 przechodzi misję 1 jako pominiętą; `ambush` — Atlas na kursie przed miejscem zasadzki, `return` ją omija).
