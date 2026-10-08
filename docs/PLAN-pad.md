# Sterowanie padem — analiza i plan (2026-10-07)

> Prośba użytkownika (2026-10-07): „przeanalizuj sterowanie gamepadem. muszę dorobić porządne sterowanie na pada.
> rozplanuj to poprawnie”.
> Stan kodu: `main` z 2026-10-07. Numery linii `index.html` są z tego dnia — przy pracy szukaj po nazwach funkcji.
> **Etap 1 wdrożony (2026-10-07, bez commita):** warstwa wejścia `src/input/` (padDevice, inputActions, inputContext,
> input), klej `pumpInput` / `GameActions` w `index.html`, testy i `scripts/webgpu/pad-gra.mjs`; opis w `AGENTS.md`
> § „Warstwa wejścia”. Etapy 2–8 — nie.

## 0. W skrócie

- Dzisiejszy pad to dopisek sprzed kierowania ogniem (2026-10-03): pięć niezależnych odczytów
  `navigator.getGamepads()`, numery przycisków wpisane na sztywno, część akcji martwa albo zepsuta.
- **Podłączony pad psuje klawiaturę.** Od pierwszego naciśnięcia przycisku pada w sesji strony (od tej chwili Chrome
  udostępnia pad stronie) dopalacz z Shift gaśnie w następnej klatce, a S tylko hamuje — nie cofa (B2, B5).
- Padem da się dziś: lecieć (bez strafe), strzelać grupą w ręku (RT), zoomować, otworzyć CIC i menu. Nie da się:
  celu priorytetowego, grup broni, trybów okrętu, menu rozkazów, Hexlance'a, szarży, warpa (Y miga — B1), trybów
  torped / wydobycia / floty, stacji, kokpitu, a nawet **zacząć kampanii** — ODDOKUJ wymaga kliknięcia albo Enter (B7).
- Przyczyny są w architekturze, nie w samym kodzie pada: logika gry czyta `keys['…']` i `mouse.x/y` wprost, nie ma
  warstwy akcji ani kontekstów wejścia. Dlatego plan zaczyna od fundamentu.
- Cel: pad równorzędny z klawiaturą i myszą (działają naraz), układ „Dowódca” (lewa gałka — lot, prawa — celownik
  zakotwiczony w świecie z przyklejaniem do celów, spusty — manewr i ogień, bumpery — koło trybów i cel priorytetowy),
  nawigacja padem po każdym ekranie, podpowiedzi z ikonami Xbox / PlayStation, wibracje, opcje. Etapy 0–8, każdy
  z kryterium „gotowe”.

## 1. Decyzje do potwierdzenia

Etap 1 od nich nie zależy (przenosi dzisiejszy zakres akcji na nową warstwę). Etapy 2–4 — tak.

| # | Decyzja | Propozycja |
|---|---|---|
| D1 | Układ domyślny | „Dowódca” — § 3.2 (szarża na B, warp na przytrzymanym Y, zoom na D-pad ↑↓, strafe pod LT) |
| D2 | Schemat lotu | czołgowy jak W/S/A/D (LS ↕ ciąg, LS ↔ obrót); wariant „Kierunek” (LS = kurs dziobu) jako prototyp za opcją po etapie 2 |
| D3 | Stabilizator kursu na padzie | domyślnie WŁ.: gałka przesuwa strzałkę kursu, okręt kończy obrót dokładnie na niej; na klawiaturze bez zmian (WYŁ.) |
| D4 | Wsparcie celowania | przyklejanie + spowolnienie nad celem, domyślnie „średnie”; w opcjach wył. / słabe / średnie / mocne |
| D5 | Rzadkie akcje | szybkie koło pod przytrzymanym View (dwie strony po 8 pozycji): Supernowa, postawa ognia, skaner, myśliwce … |
| D6 | Przeglądarki i pady | Chrome / Edge na Windows; Xbox (XInput), DualSense, DualShock 4; inne pady tylko z mapowaniem `standard` (ręczne przypisanie — etap 7) |
| D7 | Podzielony ekran | etap 8, po przeniesieniu gracza 2 na kierowanie ogniem (notatka `AGENT:` przy `_drawReticle`) |

## 2. Stan obecny

### 2.1 Gdzie jest kod pada

Wszystko w `index.html`:

| Miejsce | Linie | Co robi |
|---|---|---|
| `menuGamepad`, `menuGamepadLoop` | 2285–2370 | własna pętla rAF; D-pad / LS ↕ — poprzedni / następny `button.menu-btn-styled` widoku (lista jednowymiarowa), A — `click()`, B — wstecz |
| `isGamepadActiveForP1`, `getP1GamepadForwardInput` | 15816–15839 | czy pad odbiera klawiaturę (tylko podzielony ekran); gaz z gałki do paska mocy (`updateEnginePower`) |
| `GAMEPAD`, `applyGamepad` | 18749–18931 | sterowanie graczy 1 i 2; wołane na początku każdej klatki `loop()` (24699) — także w pauzie |
| `getAssignedPad`, `shipSelectGamepadLoop` | 28662–28720 | wybór statku w podzielonym ekranie (własna pętla rAF) |
| `controllerAssignment`, `controllerSelectLoop` | 28789–28917 | przypisanie urządzeń do graczy (własna pętla rAF) |

Brak `gamepadconnected` / `gamepaddisconnected`, brak sprawdzenia `pad.mapping`, brak wibracji, brak opcji.
W menu po starcie gry pad czytają naraz dwie pętle (menu i `applyGamepad`).

### 2.2 Dzisiejszy układ (gracz 1)

| Wejście | Akcja | Uwagi |
|---|---|---|
| LS ↕ | ciąg / wstecz (analog) | martwa strefa 0,15 na KAŻDEJ osi osobno, bez przeskalowania (wartość skacze z 0 na 0,15) |
| LS ↔ | obrót (analog) | przy włączonym stabilizatorze ignorowany (B3) |
| RS | „wirtualna mysz”: kursor ekranu ±12 px na klatkę | prędkość zależna od FPS; kursor przypięty do ekranu |
| A | `triggerRailVolley()` | martwe — kolejkę `rail` zeruje każdy krok fizyki od przejścia na kierowanie ogniem (22804) |
| B | `fireRocket()` | stara ścieżka rakiet, obok kierowania ogniem |
| X (trzymany) | dopalacz | gałąź `else` gasi dopalacz co klatkę (B2) |
| Y | `attemptWarp()` | co klatkę przy trzymaniu (B1) |
| LB / RB | zoom − / + | 2,5% na klatkę (FPS); w CIC — zoom mapy |
| LT | broń specjalna albo rakiety | omija kierowanie ogniem |
| RT | spust grupy w ręku (`mouse.fireMain` → `fcTrigger.pad`) | jedyna akcja zgodna z kierowaniem ogniem |
| View | CIC | |
| Menu | menu / pauza | |
| D-pad, L3, R3 | — | |

### 2.3 Błędy

| # | Waga | Błąd | Gdzie |
|---|---|---|---|
| B1 | krytyczny | Y = warp bez zbocza: `if (btn(3)) attemptWarp()`, a `attemptWarp` to przełącznik — trzymany Y co klatkę zaczyna i anuluje ładowanie; wynik zależy od parzystości liczby klatek | 18805, 22309 |
| B2 | krytyczny (klawiatura) | `else if (boost.state === 'active' && !btn(2)) stopBoost()` co klatkę — z padem widocznym dla strony dopalacz z Shift trwa jedną klatkę | 18804 |
| B3 | wysoki | stabilizator bierze skręt tylko z `keys['a'] / keys['d']`, a ręczny moment tłumi (`suppressManualTorque`) — z włączonym stabilizatorem (klawisz B) gałka nie skręca | 23081, 23170 |
| B4 | wysoki | `playerHasManualInput()` czyta tylko klawisze — gałka nie przejmuje sterów od autopilota (rozkazy PPM, TRAVEL TO, kurs warpa); gałka i autopilot nadpisują wejście co klatkę | 15508 |
| B5 | wysoki (klawiatura) | `applyGamepad` co klatkę nadpisuje wejście lotu scalonym `kbThrustY = keys['w'] ? 1 : 0` bez `retro`, a `updateInput` klawiatury liczy się tylko na zdarzeniach klawiszy — z padem S tylko hamuje, nie cofa | 18770–18791 |
| B6 | wysoki | pad działa pod menu, pauzą i scenami fabuły: `applyGamepad()` idzie przed gałęzią pauzy; B w menu = „wstecz” i rakieta naraz, Y przełącza warp pod menu | 24699, 18800–18805 |
| B7 | średni | kampanii nie da się zacząć padem — panel ODDOKUJ (`.st-cmd`) reaguje na klik i Enter; dialogi i podsumowanie misji — tylko klawiatura i mysz | `src/ui/storyOverlay.js` 80–145 |
| B8 | średni | podzielony ekran wymaga myszy: „Potwierdź” w wyborze kontrolerów tylko na klik (A przypisuje urządzenie, Enter przypisuje klawiaturę); z wyboru statku nie ma powrotu | 28950, 28669 |
| B9 | średni | zależność od FPS: kursor 12 px / klatkę, zoom 2,5% / klatkę — przy 144 Hz 2,4× szybciej niż przy 60 Hz | 18821–18845 |
| B10 | średni | gra jednoosobowa bierze tylko `pads[0]` — pad pod innym indeksem (wirtualne urządzenia, druga gałka, kierownica) nie działa | 15833, 18919 |
| B11 | niski | A — martwa salwa; RS zapisuje `ship.input.aimX / aimY`, których nikt nie czyta | 18800, 18785 |
| B12 | niski | `keys` nie są czyszczone przy utracie fokusu okna (przy `blur` zamyka się tylko koło trybów) — klawisz trzymany przy Alt+Tab zostaje „wciśnięty” | 14829, 9348 |
| B13 | niski | `pad.buttons.map(...)` co klatkę w wyborze statku (alokacja) | 28683 |

Problem projektowy (nie błąd): kursor pada jest punktem EKRANU. Przy ruchu okrętu i kamery punkt celowania „pływa” po
świecie, a rig kamery w postawie walki ciągnie kadr w stronę kursora — kursor odjeżdża razem z kadrem. Myszą gracz
koryguje to odruchowo, gałką — nie.

### 2.4 Pokrycie akcji

✔ działa padem, ~ częściowo, ✗ brak.

| Kategoria | Klawiatura / mysz | Pad dziś |
|---|---|---|
| Lot | W/S ciąg i hamulec-wstecz, A/D obrót | ~ (B3, B4) |
| | Q/E strafe | ✗ |
| | Shift dopalacz | ~ (X; B2) |
| | Ctrl bieg w dół, 7 automat napędu, V tryb napędu, C damper, B stabilizator | ✗ |
| | CapsLock / 9 warp | ✗ (B1) |
| | F szarża (bez systemu okrętu — rakieta) | ✗ |
| | L reflektory, R naprawa | ✗ |
| Broń | LPM grupa w ręku | ✔ (RT) |
| | 1/2/3 grupa w rękę, Ctrl/Alt + 1/2/3 auto grup | ✗ |
| | 4 Hexlance, 5 Supernowa, 6 strzał energii tarczy | ✗ |
| | Y postawa ognia, Z myśliwce | ✗ |
| Cele | T cel priorytetowy, T trzymane — malowanie, U dołóż / zdejmij | ✗ |
| | X skaner, H obraz drona | ✗ |
| Tryby | ŚPM koło trybów (stuknięcie — poprzedni) | ✗ |
| | I maskowanie, 8 torpedy, N wydobycie, G flota | ✗ |
| | torpedy: LPM salwa, 8 wachlarz, PPM wyjście | ✗ (RT strzela grupą, nie torpedami) |
| | wydobycie: LPM lasery, PPM ładunek, PPM + przeciągnięcie piła, L, F, T | ✗ |
| | flota (RTS): zaznaczanie, ramka, rozkazy, szyk | ✗ (wejście okrętu zerowane) |
| Rozkazy | PPM: atak, taran, podejdź, orbita, TRAVEL TO, skan, dron; na wraku odzysk, hol | ✗ |
| Kamera | kółko — zoom | ✔ (LB/RB, B9) |
| | K / Shift+K kamery 3D, Home, strzałki | ✗ |
| Interfejs | Tab / M CIC | ~ (View: otwórz i zoom; mapa bez kursora) |
| | Esc menu, Spacja pauza | ✔ (Menu) |
| | ` łączność, J dziennik misji, Alt kokpit (panele, Rezerwa) | ✗ |
| | stacja (dok): zakładki, handel, hangar, kantyna, mechanik, infrastruktura | ✗ |
| Fabuła | ODDOKUJ, dialogi, podsumowanie | ✗ (B7) |
| Menu | przyciski widoku | ~ (bez suwaków dźwięku i przełączników `.menu-chip` w Opcjach i Nowej grze) |
| Podzielony ekran | przypisanie, wybór statku | ~ (B8) |

### 2.5 Ekrany UI

| Ekran | Technika | Wybór dziś | Co utrudnia pad |
|---|---|---|---|
| Menu główne, pauza | DOM | lista `menu-btn-styled` | `.menu-chip` (opcje, nowa gra) i suwaki `[data-audio]` poza listą; lista jednowymiarowa; B na stronie głównej nic nie robi |
| Wybór kontrolerów / statku (split) | DOM | pad / klawiatura / mysz | „Potwierdź” i odpinanie tylko myszą |
| Kokpit (Shadow DOM `#cockpit-ui-host`) | DOM | mysz w trybie Alt | tryb Alt tylko klawiszem; pokrętło napędu — przeciąganie / kółko |
| Rezerwa (wezwania wsparcia) | DOM | przeciągnij kartę na mapę | `callInSupport(key, { spawnPos })` przyjmuje punkt wprost — wystarczy wybór karty + punkt celownikiem |
| Łączność, dziennik misji | DOM | klik | — |
| Stacja: handel, hangar, kantyna | DOM | klik, zakładki 1–5 | — |
| Stacja: mechanik, infrastruktura | DOM | przeciągnij i upuść, dwuklik, kółko (obrót budynku) | potrzebna ścieżka „wybierz → wskaż → potwierdź” |
| CIC | kanwa | LPM, ramka, PPM-menu, ŚPM / WASD przesuw, kółko | kursor mapy |
| Menu rozkazów (PPM) | kanwa (`src/ui/commandOverlay.js`) | trzymanie PPM i puszczenie nad wierszem; ORBITA → WŁASNY… = `window.prompt` | wybór wiersza; zamiast `prompt` — stepper |
| Koło trybów | kanwa | wektor ruchu myszy od punktu wciśnięcia (`shipModeFromWheelVector`) | gałka wraca do środka — sektor trzeba zatrzasnąć |
| Fabuła (`#story-root`) | DOM | Enter / Spacja / Esc / klik | — |
| Edytor hardpointów | kanwa | mysz | poza zakresem (narzędzie) |

Ekranu śmierci nie ma (misja kończy się komunikatem), więc nie wchodzi w plan.

### 2.6 Przyczyny

1. **Logika gry czyta klawiaturę wprost.** `keys['w' | 's' | 'a' | 'd' | 'q' | 'e']` w `playerHasManualInput`,
   `updateEnginePower`, stabilizatorze, hamulcu i anulowaniu szarży; `keys['t']` w malowaniu celów (`fcPaintStep`);
   `computeRtsCameraPanDelta(keys)`; strzałki w kamerach 3D. Pad musiałby udawać klawisze.
2. **Celowanie = `mouse.x/y`.** 37 odczytów w `index.html` (10× `screenToWorld(mouse.x, mouse.y)`): kierowanie ogniem,
   skan pod kursorem, T, menu PPM, torpedy, wydobycie, rig kamery, rysunek celownika.
3. **Brak kontekstów wejścia.** O tym, kto dostaje wejście, decyduje kolejność słuchaczy (fabuła i Alt w fazie
   przechwytywania → `hudSystem` → menu → stacja → Esc → główny `keydown` 15609, w nim wydobycie i torpedy pierwsze)
   i flagi sprawdzane w każdym miejscu po swojemu (`stationUI.open`, `CICDisplay.active`, `StoryGame.blocksInput`,
   RTS…).
4. **Brak warstwy akcji.** Numery przycisków w pięciu miejscach; nazwy klawiszy wpisane na sztywno w podpowiedziach:
   samouczek (`MISSION01_HINTS` w `src/game/story/missions/mission01.js`), stopka CIC (`src/ui/cicDisplay.js` 2039),
   kurs warpa (`src/ui/warpCourseOverlay.js` 81), kokpit (`src/ui/cockpitUI.js` 435–481), ekran Sterowanie w menu
   (460–493 — tam już nieaktualne: „Shift — wyższy bieg”, „V / 8 Tryb”; w kokpicie „Caps — łączność”). Kokpit woła
   akcje gry SYNTETYCZNYMI zdarzeniami klawiszy (`dispatchGameKey`).

## 3. Docelowe sterowanie

### 3.1 Zasady

1. **Pad, klawiatura i mysz działają naraz** (w grze jednoosobowej bez „przypisania”). Ostatnio użyte urządzenie
   decyduje tylko o podpowiedziach i o źródle celownika (ruch myszy → kursor myszy, ruch RS → celownik pada). Lot padem
   i celowanie myszą jednocześnie ma działać.
2. **Gra pyta o akcje, nie o klawisze**: `Input.held('tgt.paint')`, `Input.axis('fly.thrust')`,
   `GameActions.run('nav.warp')`. Jedna tabela akcji z bramkami (warunkami) w kleju gry — klawiatura i pad wołają tę
   samą akcję, więc bramki są w jednym miejscu.
3. **Jeden odczyt urządzeń na klatkę rAF**, przed krokami fizyki. Zbocza (wciśnięcia) obsługiwane raz na klatkę; stany
   trzymane i osie czytają kroki fizyki.
4. **Konteksty** (stos): wierzchni dostaje przyciski. Lot lewą gałką przechodzi przez nakładki, które go nie
   potrzebują (koła, menu rozkazów — czas nie zwalnia, decyzja z 2026-10-03). Wciśnięcie, które zamknęło kontekst,
   jest „zjedzone” do puszczenia (B zamykające menu nie odpali szarży).
5. **Czas w sekundach**, nie w klatkach; wartości analogowe zostają analogowe (ciąg, obrót, strafe).
6. **Ciężkie akcje na przytrzymanie** z paskiem postępu (warp); szybkie akcje bojowe na stuknięcie. Przycisk, który
   ma wariant przytrzymania, odpala stuknięcie przy puszczeniu (< 0,25 s).
7. **Spójne zamienniki**: LPM → RT, PPM → A, ŚPM → LB, T → RB, F → B, Esc → B (w UI) / Menu (w grze). Ta sama
   zasada w trybach (wydobycie: T → RB, F → B), więc gracz nie uczy się trybów od nowa.
8. **Rozgrywka bez zmian.** Fizyka, kierowanie ogniem, tryby okrętu, rozkazy — te same funkcje co z klawiatury;
   pad dostaje drogę do nich, nie własną logikę.

### 3.2 Układ domyślny „Dowódca”

```
   LT  MANEWR (strafe)                          RT  OGIEŃ grupy w ręku
   LB  koło trybów / poprzedni tryb             RB  cel priorytetowy / namierzanie
   View  CIC · przytrzymaj: szybkie koło        Menu  pauza
   LS  ciąg ↕ · obrót ↔ · L3 dopalacz           RS  celownik · R3 celownik przed dziób
   D-pad  ↑↓ zoom · ←→ grupa w ręku             A rozkazy · B szarża · X Hexlance · Y (przytrzymaj) warp
```

Gra — lot i walka (Xbox, w nawiasie PlayStation):

| Wejście | Stuknięcie / ciągłe | Przytrzymanie | Klawiatura / mysz |
|---|---|---|---|
| LS ↕ | ciąg naprzód / hamulec, potem wstecz (analog) | | W / S |
| LS ↔ | obrót (analog; ze stabilizatorem — tempo strzałki kursu) | | A / D |
| L3 | dopalacz — przełącznik; gaśnie, gdy gałka stoi w środku 0,4 s albo kończy się paliwo | | Shift |
| RS | celownik (§ 3.4) | | mysz |
| R3 | celownik przed dziób (odklej) | kamera domyślna | — / Home |
| RT [R2] | ogień grupy w ręku | | LPM |
| LT [L2] | MANEWR (trzymany): LS ↔ = strafe (analog), RS ↔ = obrót, celownik stoi w świecie | | Q / E |
| RB [R1] | cel priorytetowy przy celowniku; pustka — zdejmij | NAMIERZANIE: przerzut RS skacze po wrogach i maluje każdego; A — dołóż / zdejmij cel pod celownikiem | T / T trzymane / U |
| LB [L1] | poprzedni tryb okrętu | koło trybów: RS wybiera sektor, puszczenie włącza | ŚPM |
| A [✕] | menu rozkazów w celowniku (wróg, wrak, stacja, punkt) | | PPM |
| B [○] | szarża (system okrętu); bez systemu — rakieta | | F |
| X [□] | Hexlance: ładowanie, ponownie — strzał | | 4 |
| Y [△] | (podpowiedź „przytrzymaj”) | warp: start ładowania / anuluj / wyjście (0,5 s, pasek) | CapsLock / 9 |
| D-pad ↑ / ↓ | zoom + / − (stuknięcie — krok × 1,25, trzymanie — płynnie) | | kółko |
| D-pad ← / → | grupa w ręku: poprzednia / następna (puste grupy pomijane) | | 1 / 2 / 3 |
| View [Create] | mapa CIC | szybkie koło (niżej) | Tab / M |
| Menu [Options] | pauza i menu | | Esc |

Szybkie koło (View trzymany; RS wybiera, puszczenie wykonuje, D-pad ← / → zmienia stronę):
- strona 1 (walka): Supernowa (5), postawa ognia (Y), skaner (X), myśliwce (Z), strzał energii tarczy (6),
  naprawa (R), reflektory (L), Rezerwa (kokpit);
- strona 2 (okręt i interfejs): łączność (`), dziennik misji (J), kamera (K), obraz drona (H), auto grup
  (lista trzech przełączników — Ctrl+1/2/3), napęd: tryb / automat / bieg w dół (V / 7 / Ctrl), stabilizator (B),
  damper (C).

Konteksty — co zmienia się w trybach i nakładkach (reszta jak wyżej):

| Kontekst | Zmiany |
|---|---|
| Torpedy | RT — salwa wachlarza (LPM), D-pad ← / → — wąski / szeroki (8); wyjście: LB stuknięcie (poprzedni tryb) |
| Wydobycie | RT — lasery dronów (LPM), A — ładunek w dnie otworu (PPM), A trzymane + RS — piła (PPM + przeciągnięcie), D-pad ← / → — wielkość ładunku (L), B — detonacja (F), RB — wiązka ściągająca (T) |
| Flota (RTS) — etap 4b | LS — przesuw kamery (WASD), RS — kursor, A — zaznacz (trzymane + RS — ramka), X — menu rozkazów (trzymane + RS — szyk i zwrot), B — odznacz, D-pad ↑↓ — zoom do kursora |
| Menu rozkazów otwarte | D-pad ↑↓ / RS ↕ — wiersz (domyślnie pierwszy), A — wykonaj, B — zamknij; ORBITA → WŁASNY…: D-pad ← / → zmienia dystans zamiast `window.prompt`; LS dalej leci |
| Koło trybów / szybkie koło | RS — sektor (zatrzaśnięty), puszczenie przycisku — wybór, B — anuluj |
| CIC (etap 4b) | LS — przesuw, RS — kursor mapy, D-pad ↑↓ — zoom, A — zaznacz (trzymane + RS — ramka), X — menu (ATAK / RUCH / TRAVEL TO / DRON), Y — widok systemu / taktyczny (V), B / View — zamknij |
| Fabuła: panel akcji | A — przycisk panelu (ODDOKUJ) |
| Fabuła: scena / dialog / podsumowanie | A — dalej, B trzymane 0,6 s — pomiń scenę |
| UI DOM (menu, stacja, kokpit, łączność, dziennik, split) | D-pad / LS — fokus, A — wybierz, B — wstecz / zamknij, LB / RB — zakładki, LT / RT — przewijanie, ← / → na suwaku — wartość |

### 3.3 Lot

- **Gałki**: martwa strefa PROMIENIOWA (wewnętrzna 0,12, zewnętrzna 0,95, przeskalowanie do 0..1 — bez skoku przy
  wyjściu ze strefy), krzywa odpowiedzi osobno dla ciągu (wykładnik ~1,2) i obrotu (~1,6 — precyzja przy małym
  wychyleniu). Wartości w opcjach.
- **Scalanie z klawiaturą w jednym miejscu, raz na klatkę**: oś = większa co do modułu z klawiatury (−1 / 0 / 1)
  i pada. Znika osobna ścieżka `getP1GamepadForwardInput` i nadpisywanie wejścia przez `applyGamepad` (B5).
- **Hamulec i wsteczny**: LS w dół = S (`manualBrakeHeld`, zaczep wstecznego `retroState`) — dziś już liczony
  z `ship.input.thrustY`; zostaje.
- **Stabilizator**: gałka podaje `manualHeadingInput` (analog) — strzałka kursu biegnie z tempem wychylenia, po
  puszczeniu okręt staje dokładnie na strzałce (B3). D3: na padzie domyślnie włączony.
- **Przejęcie od autopilota**: `playerHasManualInput()` → `Input.manualFlight()` — klawisze lotu albo gałka poza
  martwą strefą przez ≥ 0,1 s (dryf zużytej gałki nie anuluje rozkazu) (B4).
- **MANEWR (LT)**: LS ↔ = strafe analogowy (`leftSide / rightSide` 0..1 — model dysz przyjmuje ułamki), RS ↔ = obrót,
  celownik stoi w świecie. Do dokowania w hali K-7 i ustawiania burty.
- **Dopalacz (L3)**: przełącznik jak „sprint” w grach na pad — trzymanie wciśniętej gałki przy sterowaniu jest
  niewygodne. Kto włączył dopalacz (klawiatura / pad), ten go gasi (B2).
- **PRZELOT**: biegi w górę i w dół działają same (`stepCruiseGear`); ręczna redukcja (Ctrl) — szybkie koło, strona 2.
- **Wariant „Kierunek”** (D2, prototyp za opcją po etapie 2): LS = kurs dziobu (wychylenie ustawia strzałkę
  stabilizatora), gaz na LT. Dla okrętu, który obraca się 18°/s, wygodniejszy przy dużych zwrotach, ale
  niejednoznaczny przy „do tyłu” (zawrót czy wsteczny?) — dlatego nie domyślny.

### 3.4 Celownik pada (zakotwiczony w świecie)

Zamiast wirtualnej myszy — punkt świata, który gałka przesuwa, a świat go niesie:

- **Stan**: punkt świata (double), opcjonalna kotwica (encja + przesunięcie), widoczność. Celownik nie jedzie
  z kamerą — ruch okrętu i riga kamery nie zmienia celu. Gdy wyjdzie poza kadr, zsuwa się do jego krawędzi
  (z marginesem; podzielony ekran — własna połowa).
- **Ruch**: RS (martwa strefa promieniowa 0,10, krzywa ~2) → prędkość w px EKRANU na sekundę (np. 1300 px/s przy
  pełnym wychyleniu), przeliczana na świat przez zoom; przyspieszenie przy pełnym wychyleniu dłuższym niż 0,25 s
  (do × 2,2 w 0,4 s) — szybki przerzut przez cały kadr bez utraty precyzji.
- **Przyklejanie**: celownik w zasięgu chwytu wroga (`fcPickNearPoint`, promień `FC_GRAB_PX` — ten sam co pod T
  i wyprzedzeniem) bierze go za kotwicę i jedzie z nim; przesunięcie od środka powoli maleje (przyciąganie). Gałka
  wyprowadza celownik poza chwyt → kotwica puszcza. Nad celem prędkość × 0,45 (spowolnienie). Siła — opcja (D4).
- **Przerzut** (namierzanie, RB trzymany): szarpnięcie RS (z martwej strefy do > 0,8 w < 0,15 s) wybiera wroga w tym
  kierunku ekranu (stożek ±35°, ocena: kąt × odległość; kandydaci kierowania ogniem i `canPlayerLockTarget`) —
  celownik skacze na niego, a cel trafia na listę priorytetową (jak T trzymane).
- **Źródło celu dla gry** — jeden „kursor celowania” (ekran + świat), dziś `mouse.x/y`. Etap 3 wybiera tańszą drogę:
  przy źródle „pad” klej co klatkę zapisuje rzut celownika do `mouse.x/y` (i `mouse.overCanvas = true`), więc 37
  odczytów działa bez zmian, a kierowanie ogniem (`env.cursor`) dostaje punkt świata wprost. Wyjątki, które NIE mogą
  iść za celownikiem pada: najechanie wiersza menu PPM (`hitTestCommandMenu` w 18344 — pad prowadzi indeks wiersza),
  tryb Alt kokpitu (kursor systemu), kursor CSS kanwy.
- **Kamera**: rig (`stepCameraRig`, wejście `mouseX / mouseY`) dostaje rzut celownika — w postawie walki kadr wychyla
  się ku celowi. Bez sprzężenia, bo celownik stoi w świecie, nie na ekranie. `isCameraLookFrozen` bez zmian.
- **Rysunek**: celownik broni (`src/ui/weaponReticle.js`) jak dziś w punkcie kursora; dla pada dodatkowo znacznik
  przyklejenia (narożniki na celu) i kierunek przerzutu w namierzaniu.

### 3.5 Cele priorytetowe (RB)

- Stuknięcie: `fcDesignatePriority(false)` przy celowniku — semantyka T bez zmian (ten sam cel ponownie albo
  pustka — zdejmij).
- Przytrzymanie: NAMIERZANIE = malowanie (`fcPaintBegin` / `fcPaintStep`, warunek `keys['t']` →
  `Input.held('tgt.paint')`) + przerzut RS z § 3.4; A w namierzaniu = U (dołóż / zdejmij cel pod celownikiem).
  Puszczenie RB kończy.
- Kandydaci jak dziś (mgła wojny `SensorSystem.hides`, uśpione, zasięg); limit `RADAR_UI_MAX_TARGETS`.

### 3.6 Koła i menu rozkazów

- **Koło trybów (LB)**: przytrzymanie > 0,18 s → `openShipModeWheel`; co klatkę
  `w.hover = shipModeFromWheelVector(rs.x · R, rs.y · R)` z R ≈ 120 px (martwa strefa 34 px ≈ wychylenie 0,28).
  Sektor ZATRZASKUJE się — powrót gałki do środka go nie kasuje (inaczej puszczenie LB po puszczeniu gałki niczego
  by nie wybrało); zmienia go dopiero wychylenie w inny sektor. Puszczenie LB → `releaseShipModeWheel` →
  `setShipMode`. Stuknięcie (< `SHIP_MODE_TAP` 0,22 s) → poprzedni tryb. Logika `src/game/shipModes.js` bez zmian.
- **Szybkie koło (View)**: te same mechanizmy i rysunek co koło trybów (wspólna funkcja rysująca z listą pozycji),
  dwie strony.
- **Menu rozkazów (A)**: `openNormalWorldCommandMenuAt` w punkcie celownika (cel pod celownikiem jak dziś pod
  kursorem); nowe pole `worldCommandMenu.padIndex` ma pierwszeństwo przed najechaniem myszą; A →
  `executeWorldCommandItem`, B → `closeWorldCommandMenu`. Na stacji pod celownikiem dodatkowa pozycja OTWÓRZ STACJĘ
  (dziś LPM na stacji). ORBITA → WŁASNY… — stepper zamiast `window.prompt` (dla pada i myszy).

### 3.7 UI na padzie

Jeden moduł nawigacji przestrzennej dla DOM (`uiNav.js`):
- zakres fokusu = kontener aktywnego kontekstu (widok menu, panel stacji, kokpit, dziennik…); elementy: `button`,
  `input`, `[data-nav]`, bez ukrytych i wyłączonych;
- kierunek: najbliższy element w półpłaszczyźnie kierunku (odległość środków z karą za odchylenie od osi);
  powtarzanie przy trzymaniu (0,35 s, potem co 0,09 s);
- A = `click()` (także przełącznik `.menu-chip`), ← / → na `input[type=range]` = krok i zdarzenie `input`;
  LB / RB = zakładki (`[data-nav-tab]`), LT / RT = przewijanie kontenera, B = `[data-nav-back]` albo zamknięcie
  kontekstu;
- widoczny fokus: klasa `pad-focus` (dzisiejsze `gamepad-focus` z `assets/css/main-menu.css`); mysz przestawia fokus
  jak dziś (`pointerover`).

Ekrany:
- menu główne, opcje, nowa gra, sterowanie, twórcy — zamiast `menuGamepad` (klawiatura ↑↓ / Enter / Esc dalej działa);
- pauza — B / Menu = Kontynuuj;
- podzielony ekran — A na „Potwierdź”, B wstecz, z wyboru statku powrót do menu (B8);
- fabuła — A / B (§ 3.2); fokus na przycisku panelu akcji (`storyOverlay.js` już robi `.focus()` na dwóch przyciskach);
- kokpit — pozycja „Rezerwa” w szybkim kole wchodzi w kontekst kokpitu (fokus na kartach); karta okrętu: A = wybierz,
  potem celownik + A = punkt wezwania (`callInSupport(key, { spawnPos })`), B = anuluj; rozkazy skrzydła (ESKORTA /
  ATAK / POWRÓT) — zwykłe przyciski;
- łączność, dziennik — zwykła nawigacja;
- stacja — handel, hangar, kantyna: zwykła nawigacja + zakładki LB / RB. MECHANIK: A na broni → tryb montażu → fokus po
  gniazdach → A montuje (zamiast przeciągania i dwukliku), X zdejmuje. INFRASTRUKTURA: A na budynku → duch budynku
  na celowniku siatki (D-pad / RS), LB / RB obrót, A stawia, B anuluje;
- CIC — własny kursor mapy (kanwa, § 3.2);
- edytor hardpointów — poza zakresem (narzędzie na mysz).

### 3.8 Podpowiedzi i ikony

- Rodzina pada z `pad.id`: Xbox (`xinput`, VID 045e), PlayStation (054c — DualShock 4, DualSense), Nintendo (057e —
  inne położenie A/B), ogólny. Opcja: auto / Xbox / PlayStation.
- `promptFor(akcja)` → etykieta klawisza albo ikona przycisku wg ostatnio użytego urządzenia (z histerezą — jedno
  przypadkowe dotknięcie myszy nie przełącza ikon).
- Ikony rysowane własne (SVG i kanwa: koło z literą / symbolem, „pigułki” bumperów i spustów, gałki), bez logotypów
  producentów.
- DOM: `<span class="in-prompt" data-action="…">` odświeżane przy zmianie urządzenia; kanwa:
  `drawPrompt(ctx, akcja, x, y)`.
- Samouczek: `MISSION01_HINTS.keys` → `actions`, tekst z miejscami na akcje (`{fly.thrust}` …) rozwijanymi przez
  `promptFor`; tam, gdzie zdanie zależy od urządzenia („Kliknij ODDOKUJ”), dwa warianty tekstu.
- Do przepięcia: ekran Sterowanie w menu (+ karta „Pad” z rysunkiem układu; przy okazji poprawić nieaktualne opisy),
  stopka CIC, kurs warpa, podpowiedzi kokpitu, znacznik myszy w `storyOverlay.js` (241–259), komunikaty z nazwą
  klawisza (wyszukać przy przepinaniu).

### 3.9 Wibracje

`gamepad.vibrationActuator.playEffect('dual-rumble', …)` (Chrome / Edge; w Firefoksie brak — cicho pomijamy);
`'trigger-rumble'` (spusty Xbox na Chromium / Windows) — opcja.

| Zdarzenie | Efekt |
|---|---|
| salwa grupy w ręku | słaby, 40 ms (spust RT: trigger-rumble) |
| Hexlance: ładowanie / strzał | narastający słaby / mocny 220 ms |
| szarża: start / zderzenie | mocny / wg impulsu `CollisionFX` |
| trafienie gracza | wg obrażeń względem kadłuba |
| pęknięcie tarczy | podwójny impuls |
| warp: ładowanie / skok / wyjście | narastający / mocny 300 ms / średni |
| wybuch w pobliżu | wg odległości i profilu |
| salwa torped, start myśliwców | krótki średni |

Limit: jeden efekt na 50 ms (wygrywa mocniejszy), siła globalna z opcji, nic w menu i pauzie, tylko zdarzenia
własnego okrętu.

### 3.10 Opcje i zapis

Menu → Opcje → „Pad” (nawigowalne padem): czułość i przyspieszenie celownika, wsparcie celowania (wył. / słabe /
średnie / mocne), martwe strefy LS / RS, krzywa, stabilizator kursu na padzie, wibracje (siła, spusty), ikony (auto /
Xbox / PlayStation), schemat lotu (etap 7: „Kierunek”), przypisania (etap 7). Zapis: `localStorage['sc_pad']` (JSON
z numerem wersji; zły zapis → domyślne).

### 3.11 Podzielony ekran

- Warstwa urządzeń obsługuje 4 pady; gracz ↔ urządzenie z `controllerAssignment`; w grze jednoosobowej gracz 1 =
  ostatnio aktywny pad (B10).
- Gracz 2 zostaje na `WeaponController.update` do czasu przeniesienia na kierowanie ogniem (osobne zadanie, notatka
  `AGENT:`). Do tego czasu jego pad ma lot, ogień, rakiety i zoom przez nową warstwę; pełny układ — etap 8.
- Odłączenie pada w trakcie gry: pauza i komunikat „Podłącz pad gracza N”.

## 4. Architektura

Nowy katalog `src/input/` — moduły czyste (bez DOM i okna gry, wartości przez `env` jak `src/game/fireControl.js`),
klej w `index.html` (blok „WEJŚCIE / PAD”).

| Plik | Rola |
|---|---|
| `padDevice.js` | odczyt urządzeń raz na klatkę (funkcja odczytu wstrzyknięta — w testach atrapa), normalizacja (mapowanie `standard`; tabela znanych niestandardowych), martwe strefy promieniowe i krzywe, spusty z histerezą (0,35 / 0,25), zbocza, stuknięcie / przytrzymanie / podwójne (czas rzeczywisty), rodzina urządzenia, podłączenie / odłączenie, aktywny pad; stan w tablicach typowanych — zero alokacji na klatkę po naszej stronie |
| `inputActions.js` | katalog akcji (id, nazwa PL, kategoria, rodzaj: zbocze / trzymanie / oś) i układy domyślne pada i klawiatury (etykiety do podpowiedzi) |
| `inputContext.js` | stos kontekstów, rozstrzyganie z flag gry (menu, pauza, stacja, CIC, fabuła, koła, menu rozkazów, torpedy, wydobycie, flota, kokpit), „zjadanie” wciśnięć przy zmianie kontekstu |
| `padFlight.js` | gałki → wejście lotu (scalanie z klawiaturą, MANEWR, stabilizator, dopalacz-przełącznik, przejęcie od autopilota) |
| `padAim.js` | celownik w świecie: ruch, przyspieszenie, przyklejanie, spowolnienie, przerzut, przycięcie do kadru |
| `uiNav.js` | nawigacja przestrzenna DOM (część czysta: wybór elementu z listy prostokątów — testowalna w Node) |
| `inputPrompts.js` | etykiety i ikony akcji wg urządzenia (DOM i kanwa) |
| `padHaptics.js` | tabela efektów, limit, opcje (aktuator wstrzyknięty) |

W `index.html`: `GameActions` — rejestr `id → { run, gate }` (bramki przeniesione 1:1 z dzisiejszego `keydown`);
główny `keydown` mapuje `e.code` → akcja (ta sama kolejność: wydobycie i torpedy pierwsze), pad mapuje przyciski →
akcja; kokpit zamiast `dispatchGameKey` woła `GameActions.run`.

Klatka:

```
loop(now) / pętla menu (przed startem gry)
  Input.update(now)          ← raz na klatkę (strażnik znacznika rAF): pad, stan klawiatury, zbocza, urządzenie
  ctx = Input.context(stan)  ← wierzchni kontekst
  ctx UI   → uiNav / koła / menu rozkazów / CIC / fabuła
  ctx gra  → padFlight → applyPlayerInput (jedno scalenie z klawiaturą)
           → padAim → kursor celowania
           → zbocza → GameActions.run(…)
  physicsStep × n            ← Input.held / Input.axis
  render                     ← celownik, podpowiedzi
```

Do usunięcia po przeniesieniu: `GAMEPAD`, `applyGamepad`, `getP1GamepadForwardInput`, `isGamepadActiveForP1`,
`menuGamepadLoop` (`menuGamepad` przechodzi w `uiNav`), odczyty padów w `shipSelectGamepadLoop` /
`controllerSelectLoop`, `triggerRailVolley` (martwe), `mouse.fireMain` (zastępuje akcja).

## 5. Etapy

Kolejność: 1 → 2 → 3 → 4 dają grywalność, 5 i 6 kompletność (mogą iść równolegle — inne pliki), 7 szlif, 8 zależy
od osobnego zadania (kierowanie ogniem gracza 2). Po każdym etapie lista „co sprawdzić ręcznie” — feel (martwe
strefy, prędkość celownika, przyklejanie) ocenia użytkownik.

### Etap 0 — naprawy pilne (opcjonalny, ~2 h)

Tylko jeśli etap 1 nie rusza od razu — część tego kodu i tak zniknie.
- B1 (zbocze + przytrzymanie Y 0,5 s), B2 (dopalacz gasi tylko ten, kto go włączył), B5 (retro z S w scaleniu),
  B6 (bramka: menu, pauza, `StoryGame.blocksInput`, stacja), B9 (dt), B7 (A → `StoryGame.triggerAction`,
  A / Spacja w dialogu).
- Gotowe, gdy: z podłączonym padem Shift i S działają jak bez pada; trzymany Y ładuje warp raz; padem da się
  odcumować.

### Etap 1 — fundament: warstwa wejścia

- `padDevice.js`, `inputActions.js`, `inputContext.js` z testami.
- `Input.update` raz na klatkę (pętla gry i pętla menu); usunięte pięć osobnych odczytów; `gamepadconnected` /
  `gamepaddisconnected` (komunikat), aktywny pad zamiast `pads[0]` (B10), sprawdzenie `mapping`.
- `GameActions` w kleju; główny `keydown` przechodzi na mapę `e.code → akcja` mechanicznie (te same bramki, ta sama
  kolejność); odczyty `keys[...]` w logice (§ 2.6 p. 1) → `Input.held` / `Input.axis` / `Input.manualFlight`;
  czyszczenie stanu przy `blur` / `visibilitychange` (B12).
- Konteksty: menu / pauza / fabuła / stacja / CIC / gra — koniec przecieku (B6); fabuła na padzie (B7).
- Pad na nowej warstwie z DZISIEJSZYM zakresem akcji, bez błędów B1–B5, B9, B11, B13.
- `AGENTS.md`: sekcja o wejściu (akcje, konteksty, zakaz nowych odczytów `keys[...]` w logice gry).
- Gotowe, gdy: jeden odczyt urządzeń na klatkę; klawiatura zachowuje się identycznie (te same wartości wejścia lotu
  w skryptowanym przebiegu przed i po); padem da się odcumować i wylecieć z hali.
- Testy: `tests/padDevice.test.mjs` (martwe strefy, krzywe, histereza spustów, zbocza, stuknięcie / przytrzymanie /
  podwójne, wybór aktywnego pada), `tests/inputContext.test.mjs`, `tests/inputActions.test.mjs` (każda akcja ma
  etykietę klawiatury i pada, brak kolizji w kontekście); harness `scripts/webgpu/pad-gra.mjs` (§ 6).
- **Zrobione 2026-10-07.** Odstępstwa i ustalenia: (1) czwarty moduł `src/input/input.js` łączy klawiaturę, pady
  i konteksty (`window.Input`); (2) gałka nad CIC nie leci — jak W / A / S / D, które tam przesuwają mapę (przesuw
  gałką — etap 4b); (3) panel akcji fabuły (ODDOKUJ) bez blokady to nakładka w grze (A), nie kontekst; (4) B w menu
  pauzy na stronie głównej = Kontynuuj; (5) ślad klawiatury `pad-gra.mjs --tryb klawiatura` przed / po zmianie
  i z nieruszanym padem — identyczny (1240 klatek: wejście lotu, ruch, dopalacz, warp, przełączniki).

### Etap 2 — lot

- `padFlight.js`: scalanie osi, MANEWR (LT), stabilizator (B3), przejęcie od autopilota (B4), dopalacz L3, krzywe.
- Gotowe, gdy: misja 1 od ODDOKUJ przez bramę G-01 do punktu skoku tylko padem; ze stabilizatorem okręt staje
  dokładnie na strzałce; dryf gałki 0,1 nie anuluje TRAVEL TO.
- Testy: `tests/padFlight.test.mjs`; `pad-gra.mjs --lot` (hala K-7, strafe, przejęcie od autopilota).

### Etap 3 — celownik i ogień

- `padAim.js` + kursor celowania (§ 3.4), RT, D-pad ← / → grupy, RB cel / namierzanie / przerzut, R3, zoom na D-pad
  (dt), rig kamery z celownika, rysunek przyklejenia.
- Gotowe, gdy: fazy `defences` / `counter` misji 1 padem — grupa w ręku trafia ruchome cele, malowanie kilku celów
  przerzutem, rakiety na auto biorą malowane cele; przejście na mysz w trakcie walki bez skoków celownika.
- Testy: `tests/padAim.test.mjs` (przyklejanie, przerzut — wybór w stożku, przycięcie do kadru, niezależność od FPS);
  `pad-gra.mjs --ogien` (wzór: `scripts/webgpu/ogien-gra.mjs`).

### Etap 4 — koła, systemy, tryby

- LB koło trybów (zatrzask), View szybkie koło, A menu rozkazów (`padIndex`, stepper orbity), B szarża, X Hexlance,
  Y warp (przytrzymanie, pasek), konteksty torped i wydobycia. 4b — flota (RTS) i CIC na padzie.
- Gotowe, gdy: każda akcja z § 2.4 (poza edytorem i narzędziami dev) ma drogę na padzie; cała misja 1 tylko padem
  (skrypt + gra użytkownika).
- Testy: zatrzask sektora, pozycje szybkiego koła; `pad-gra.mjs --tryby`.

### Etap 5 — podpowiedzi i samouczek

- `inputPrompts.js`, ikony, przełączanie urządzenia, samouczek misji 1 na akcjach, ekran Sterowanie z kartą „Pad”,
  stopki i komunikaty.
- Gotowe, gdy: grając padem nie widać nazw klawiszy w samouczku, HUD-zie ani CIC; dotknięcie myszy / klawiatury
  przełącza podpowiedzi z powrotem.

### Etap 6 — UI

- `uiNav.js`; menu (z opcjami i nową grą), pauza, podzielony ekran (B8), kokpit (Rezerwa, łączność, dziennik),
  stacja (handel, hangar, kantyna, mechanik, infrastruktura).
- Gotowe, gdy: od uruchomienia gry do końca misji i zakupów w doku bez myszy i klawiatury; B zawsze cofa; fokus zawsze
  widoczny.

### Etap 7 — opcje, wibracje, przypisania

- Ekran opcji pada, `sc_pad`, `padHaptics.js`, zmiana przypisań (konflikty w obrębie kontekstu, przywróć domyślne),
  prototyp schematu „Kierunek” (D2).

### Etap 8 — podzielony ekran

- Po przeniesieniu gracza 2 na kierowanie ogniem: pełny układ dla gracza 2, konteksty i celownik per gracz,
  odłączenie / podłączenie pada w trakcie gry.

## 6. Testy i narzędzia

- **Testy jednostkowe** (`node --test "tests/*.test.mjs"`): moduły `src/input/` są czyste — matematyka gałek,
  zbocza i czasy, konteksty, celownik, nawigacja po prostokątach, podpowiedzi, limit wibracji.
- **Atrapa pada w przeglądarce**: skrypt wstrzykiwany przez `Page.addScriptToEvaluateOnNewDocument` (jak
  `scripts/webgpu/harness-strona.js`) podmienia `navigator.getGamepads` na obiekt sterowany z harnessu
  (`window.__fakePad.set({ buttons: { 7: 1 }, axes: [0, -1, 0, 0] })`), `id` Xbox (`xinput`) albo DualSense,
  `mapping: 'standard'`, `vibrationActuator` zapisujący wywołania. Scenariusze `scripts/webgpu/pad-gra.mjs`: menu →
  nowa gra → ODDOKUJ (A) → wylot → skok (Y trzymany) → koło trybów (LB + RS) → menu rozkazów (A) → walka (RS + RT,
  RB przerzut) → pauza; asercje na stanie gry + zrzuty podpowiedzi.
- **Pułapki harnessu** z poprzednich prac: kampania domyślna blokuje start (localStorage przed nawigacją), ukryty panel
  przeglądarki zatrzymuje rAF — przebiegi w CDP bez głowy.
- **Regresja klawiatury**: `celownik-gra.mjs`, `ogien-gra.mjs`, `fabula-gra.mjs`, `travel-gra.mjs`,
  `warp-qol-gra.mjs` przed i po etapie 1 — te same wyniki.

## 7. Ryzyka i pułapki

- Chrome udostępnia pad dopiero po naciśnięciu jego przycisku na stronie — przed pierwszym użyciem `getGamepads()`
  daje `null`; komunikat „Naciśnij dowolny przycisk na padzie”, nie „brak pada”.
- `getGamepads()` w Chrome zwraca migawkę — czytać raz na klatkę, nie trzymać obiektu `Gamepad` między klatkami.
- Mapowanie: Xbox i DualSense / DualShock 4 w Chrome / Edge na Windows mają `standard`; w Firefoksie DualShock bywa
  niestandardowy — wtedy komunikat i (etap 7) przypisanie ręczne. Przycisk Home / PS (16) zostaje systemowi,
  touchpad DualSense (17) — nieużywany.
- Steam Input potrafi przechwycić pad (inne `id`, przycisk Guide otwiera Steam) — do opisu dla gracza, nie w kodzie.
- Urządzenia-widma (słuchawki, kierownice) — aktywny pad wybierany po aktywności, nie po indeksie.
- Dryf gałki — martwe strefy promieniowe od 0,10–0,12; przejęcie od autopilota z progiem czasu.
- Regres klawiatury przy przenoszeniu `keydown` na akcje — przeniesienie mechaniczne + porównanie przebiegów;
  kolejność obsługi (wydobycie, torpedy, fabuła w fazie przechwytywania) zostaje.
- `mouse.x/y` jako wspólny kursor — wyjątki z § 3.4 trzeba wypisać przed etapem 3 (menu PPM, Alt, kursor CSS), inaczej
  menu podświetli wiersz pod celownikiem pada.
- Podzielony ekran ma dwa obiekty kursora (`mouse`, `mouse2`) i dwie kamery — celownik per gracz od początku.
- Wydajność: krok wejścia < 0,05 ms; żadnych domknięć ani obiektów na klatkę w `padDevice` / `padAim` (pułapki V8
  z `AGENTS.md`).
