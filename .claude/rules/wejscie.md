---
paths:
  - "src/input/**"
---

# Warstwa wejścia (akcje, konteksty, pad) i skróty klawiszowe

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/input/`** — warstwa wejścia (klawiatura + pady + konteksty → akcje gry, `window.Input`); klej `pumpInput` / `GameActions` w `index.html`. Opis: § „Warstwa wejścia” niżej, plan padów `docs/PLAN-pad.md`.

## Warstwa wejścia: akcje, konteksty, pad (2026-10-07, etap 1 `docs/PLAN-pad.md`; `src/input/`)

- Gra pyta o AKCJE, nie o klawisze i numery przycisków. Moduły czyste: `inputActions.js` (katalog akcji, układy klawiatury po `KeyboardEvent.code`, myszy i pada graczy 1 i 2 z etykietami, kolejność głównego keydown `KEYDOWN_ORDER`), `padDevice.js` (pady: mapowanie `standard`, martwe strefy promieniowe, krzywe, spusty z histerezą, zbocza, stuknięcie / przytrzymanie / podwójne, rodzina, podłączenie, AKTYWNY pad zamiast `pads[0]`; tablice typowane, bez alokacji na klatkę), `inputContext.js` (stos: menu → podzielony ekran → fabuła blokująca → pauza → stacja → CIC → gra; przycisk trzymany przy zmianie kontekstu jest „zjedzony” do puszczenia), `input.js` (całość: `window.Input`). Testy `tests/padDevice|inputContext|inputActions.test.mjs`.

- Klej w `index.html` (blok „WEJŚCIE / PAD”): `pumpInput(now)` RAZ na klatkę rAF — woła go pętla wejścia `inputFrameLoop` (menu, podzielony ekran) i `loop()` przed krokami fizyki, strażnik znacznika rAF; to JEDYNY odczyt `navigator.getGamepads` (pilnuje test). Akcje gry = rejestr `GameActions` (id → { gate, run }); główny `keydown` mapuje `e.code` → akcje w kolejności `KEYDOWN_ORDER` (bramki jak w dawnym łańcuchu — tryby wydobycia i torped pierwsze); pad i Esc wołają `runGameAction(id)`.

- Logika gry NIE czyta `keys[...]` (obiektu już nie ma) ani padów wprost: `Input.keyHeld(akcja)` (klawiatura), `Input.padHeld / padPressed / padHoldCrossed / padAxis` (pad gracza, tylko w kontekście akcji), `Input.axis` (scalona oś — większy moduł), `Input.manualFlight()` (klawisze lotu albo lewa gałka ≥ 0,1 s poza strefą — przejęcie sterów od autopilota). Wejście lotu scala JEDNA ścieżka (`updateInput` → `applyP1Flight` / `applyP2Flight`): klawiatura na zdarzeniach jak dawniej, gałka co klatkę tylko, gdy daje wejście — bez pada wejście lotu jest bit w bit dawne. Dopalacz z dwóch źródeł (`boostHold`): każde gasi tylko swój.

- Nowa akcja: wpis w `INPUT_ACTIONS` + układy (brak wiązania = jawne `null`) + `GameActions`; nowy kontekst UI — flaga w `_inputFlags` (`pumpInput`) i `resolveInputContext`. Pad nie działa pod menu, pauzą ani scenami (kontekst) — nie dodawaj odczytów pada poza `pumpInput`, a utrata fokusu (`blur`, ukryta karta) puszcza klawisze i przyciski (`releaseAllInput`).

- Zakres pada w etapie 1 = dawny (bez błędów B1–B13 planu): LS lot, RT ogień grupy w ręku, X dopalacz, Y warp (zbocze), LB / RB zoom (w czasie), RS kursor (px/s), View CIC, Menu menu, B / LT dawne rakiety i broń specjalna; menu: D-pad / LS, A, B (w pauzie — Kontynuuj); fabuła: A — dalej / ODDOKUJ / podsumowanie, B trzymane 0,6 s — pomiń scenę. Układ „Dowódca” i reszta akcji — etapy 2–8 (decyzje D1–D7 u użytkownika).

- Narzędzie: `node scripts/webgpu/pad-gra.mjs` (atrapa pada `pad-atrapa.js`: menu → kampania → odprawa → ODDOKUJ → wylot z hali K-7, odczyty na klatkę, Y trzymany, pad pod menu, Shift / S z padem); `--tryb klawiatura [--zpadem]` — deterministyczny ślad klawiatury (zegar harnessu), `--porownaj A.json,B.json` — regresja przy każdej zmianie wejścia (ma wyjść „identyczne”).

## Wejście i HUD (aktualne skróty)

- `W/S` — ciąg przód/tył

- `Q/E` — strafe

- `A/D` — obrót

- `LPM` (trzymany) — ogień grupy W RĘKU w kursor

- `PPM` — menu rozkazów

- `ŚPM` (trzymany) — koło trybów okrętu: bojowy / tarcze / przelot / maskowanie / torpedy / wydobycie / flota; stuknięcie — poprzedni tryb

- `1` / `2` / `3` — grupa w rękę (działa / bateria główna / rakiety); `Ctrl` lub `Alt` + `1` / `2` / `3` — auto grupy wł./wył.

- `T` — cel priorytetowy (wróg przy kursorze; ten sam albo pustka — zdejmij; trzymane + kursor po wrogach — malowanie kilku), `U` — dołóż / zdejmij cel z kolejki, `Y` — postawa ognia (swobodny / tylko cel / wstrzymać)

- `F` — system okrętu (§ „Systemy F”): szarża albo manewr (Atlas; manewr: `Q` / `E` + `F` skok w bok, `A` / `D` + `F` obrót na cel / kursor, samo `F` — najkrótszą drogą), zryw silników (Terra Nova), szybki ogień (piraci); bez systemu — rakieta

- `4` — Hexlance, `5` — pocisk specjalny (Supernowa)

- `Shift` — dopalacz (Atlas ~1500 j/s, w PRZELOCIE do 3000 j/s)

- `CapsLock` / `9` — warp (przełącznik); kurs skoku stoi od ładowania — ustaw dziób przed skokiem

- `0` / Numpad 0 — silniki główne MAIN: odpal / zgaś (zapłon z dymem ~2,1 s; ciąg, warp i szarża przy wyłączonych odpalają go same — § „Odpalanie i gaszenie silników MAIN”)

- `` ` `` — łączność ze stacjami (dawniej CapsLock)

- Mapa CIC / menu PPM / skaner — TRAVEL TO (podróż do punktu: obrót, skok, wyjście w celu)

- PPM (pusta przestrzeń albo cel) → DRON ZWIADU (odsłania mgłę wojny wokół siebie; mapa CIC → SEND DRONE)

- `M` — mapa

- `X` — aktywny skan: impuls (fala), ramki i podpisy wyników na 10 s, ślady klasyfikowane na radarze (§ „Radar taktyczny kokpitu i skan X”)

- `Alt` — pełny radar (360°) i tryb interfejsu; nad tarczą zasięg (klik / kółko) i H-UP / N-UP

- `R` — drony naprawcze: wypuść / odwołaj (§ „Rój dronów naprawczych”; dawne prostowanie całego kadłuba pod R usunięte)

- `L` — reflektory gracza wł./wył. (`ship.roadLightsOff`: `getEntityLights` oddaje blok bez `road` / `flood`, pas asteroid pomija reflektory w `addShipLights`; lampy pozycyjne zostają; kontrolka `lights` nad radarem)

- `Z` — eskadry z hangarów: start (ESKORTA) → ATAK → POWRÓT (lądowanie) → ESKORTA; po wylądowaniu wszystkich Z startuje od nowa (§ „Myśliwce: pilot, role, rozkazy”)

- `N` — tryb wydobycia skał (w trybie: LPM lasery dronów, PPM ładunek / PPM + przeciągnięcie piła, `L` wielkość ładunku, `F` detonacja, `T` wiązka ściągająca)

- `8` — tryb torped (jak w World of Warships: LPM wachlarz z gotowych wyrzutni, `8` wąski / szeroki rozrzut, PPM wyjście)

- `P` — panel wydajności

- `F12` — panel dev (`src/ui/devTools.js`, odchudzony 2026-10-19 — decyzja użytkownika): kredyty, spawn jednostek (karty Rezerwy kokpitu ze wszystkich frakcji, `src/data/supportRoster.js` — jedno źródło z kokpitem; od razu przed dziobem, holownik — `callServiceTug`) i zerowanie zapisu (w Electronie jedyna droga bez konsoli). Suwaków renderu ani paneli strojenia tam nie dokładaj: obraz rysuje worker, panel działałby na Core3D strony (pilnuje `tests/devToolsPanel.test.mjs`); strojenie — konsola (`*Tune`, `DevVFX.bloom`, `CameraRig.tune`), flagi narzędzi — `DevFlags` (nie zapisują się)

- `K` / `Shift+K` — kamera (klasyczna, z góry 3D, taktyczna, pościg, orbita, kinowa), `Home` — kamera domyślna, strzałki — obrót kamery 3D

- `Space` — pauza
