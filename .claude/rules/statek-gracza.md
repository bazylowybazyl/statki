---
paths:
  - "src/game/shipEntity.js"
  - "src/data/shipFlightSpecs.js"
  - "src/game/flight/driveTransmission.js"
  - "src/game/loadoutSave.js"
  - "src/game/hardpointService.js"
  - "src/data/fitPresets.js"
  - "src/data/shipModules.js"
  - "src/game/fitPlanner.js"
  - "src/game/fitStats.js"
  - "src/ui/station/fittingPanel.js"
  - "assets/css/station-fitting.css"
---

# Statek gracza: lot, zapis wyposażenia, WYPOSAŻENIE (karty, moduły, refit)

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/game/shipEntity.js`** — konfiguracja i geometria statku gracza (fizyka wejścia, offsety, thrusters, hardpointy).

- **`src/data/fitPresets.js`, `src/data/shipModules.js`, `src/game/fitPlanner.js`, `src/game/fitStats.js`, `src/ui/station/fittingPanel.js`** — WYPOSAŻENIE okrętu gracza w stacji (karty konfiguracji, moduły, automat refitu, refit ręczny). Opis: § „WYPOSAŻENIE” niżej, plan `docs/PLAN-fitowanie.md`.

## Statek gracza

- Obiekt `ship`: pozycja, kąt, prędkość, masa, shield/hull.

- Sterowanie i fizyka gracza: `shipEntity.js`.

- Kadłub, kolizje i destrukcja: `ship.beamHull` (`hullBodies.js`, silnik belek) — jak u NPC i wraków.

- **Lot z jednej tabeli** (2026-10-01): parametry lotu gracza i NPC tej klasy w `src/data/shipFlightSpecs.js` (Atlas gracza: limit bojowy 500 j/s, ~150 j/s², hamowanie ~230 j/s², obrót 18°/s); napęd gracza kalibruje się do tabeli w `calibrateDriveToShip` (`src/game/flight/driveTransmission.js`) — nie wpisuj osobnych liczb lotu gracza w `HULL_DRIVE_CONFIGS`. Stabilizator i autopilot mierzą zdolność obrotu z modelu dysz.

- **System okrętu pod F** — § „Systemy F” niżej (szarża Atlasa to jeden z czterech rodzajów).

- **Fit i zapis** (2026-10-08, etap 0 `docs/PLAN-fitowanie.md`): `localStorage['loadout']` = gniazda + MAGAZYN broni `weaponStock: { id: n }` (`src/game/loadoutSave.js`: zapis `serializeWeaponStock`, odczyt i reguła migracji `restoreWeaponStock` — kolejne magazyny w zapisie, np. części z etapu 2, dostają własną parę funkcji obok). `loadLoadout` odtwarza magazyn z zapisu — zapas startowy (`DEFAULT_INVENTORY_STOCK`) tylko na czystym starcie i przy zapisie bez pola (migracja: wtedy brakującą sztukę z gniazda zapisu tworzy `restoreHardpointMountEntry(…, { createMissing })`); gniazda wracają PO `id` (`assignHardpointEntries` + `savedHardpointBucket`: rodzaj po aktualnym mountType, puste gniazdo zostaje puste, kolejność w rodzaju tylko dla wpisów bez pary) — także `tryPreserveMounts` po przebudowie tablicy (wczytany sprite PO `loadLoadout`, zmiana kadłuba, edytor; migawka `snapshotPlayerHardpoints`). Magazyn + zamontowane = const na każdej ścieżce montażu (wyjątki: `equipCampaignLoadout` daje brakującą broń karty startowej, zakup w porcie); nowy zapis szanuje `window.__SAVE_LOCKED`. Brak sztuki = gniazdo bez zmian + komunikat; „Uzupełnij amunicję” (`refillPlayerAmmo`, bez opłaty) i remont w doku (przywraca zniszczone gniazda puste — `src/game/hardpointService.js`, `HARDPOINT_SERVICE.dockCostPerSocket`; wycena w JEDNYM miejscu `playerDockRepairQuote` — hangar, WYPOSAŻENIE, `handleRepair`) w pasku stanu WYPOSAŻENIA. Martwe „ulepszenia” HANGARU usunięte (D7). Stan wyposażenia w zapisie — § „WYPOSAŻENIE” niżej. Testy `tests/playerFitSave.test.mjs` (funkcje z index.html: save → F5 → load, karty, refit ręczny), `tests/loadoutSave.test.mjs`.

## WYPOSAŻENIE: karty konfiguracji, moduły, refit ręczny (2026-10-08; `docs/PLAN-fitowanie.md`; dawny MECHANIK)

- Decyzje użytkownika: zakładka stacji WYPOSAŻENIE = „click & fit” — 4 karty automatu (UNIWERSALNA, BLISKI TANK, SNAJPER, RAKIETOWIEC) + REFIT RĘCZNY (D1); w misji startowej komplety wszystkich kart w hangarze, potem karta kosztuje tylko BRAKUJĄCE części po cenach portu, posiadane za darmo (D2, każdy kadłub gracza); klasa dział snajperskich (`weaponClass: 'sniper'`, Lanca M / L) i Komputer balistyczny tylko dla niej (D3); Plasma Gatling 640 DPS (D4). Dawne listy magazynu i gniazd (seria 1/3/5/10, przeciąganie) usunięte.

- Dane: karty = PRZEPISY (`src/data/fitPresets.js`: per typ gniazda `want` [id, ile] od dziobu, pary lustrzane razem, `alt` zastępstwa z wariantami S / M / L dla mniejszych kadłubów; moduł, system F), komplety `FIT_KIT_STOCK` / `FIT_KIT_PARTS`. Moduły (`src/data/shipModules.js`, jeden na kadłub, fregaty 0): WZMACNIACZ TARCZ (tarcza ×1,4, regeneracja, twardość), KOMPUTER BALISTYCZNY (`classMods` — zasięg ×1,5 i pocisk ×1,4 klasy `sniper`, sufit 18 km), KOMORY RAKIETOWE (`typeMap` special → missile na tych samych pozycjach, magazynki gniazd missile ×1,5). Silniki manewrowe Atlasa (system F MANEWR) = część za 10 000 CR (`SHIP_SYSTEM_PART_PRICES`); systemy domyślne kadłubów wbudowane.

- Automat (`src/game/fitPlanner.js`, czysty): `planFit` tryb 'own' („Z MAGAZYNU”: hangar + to, co wisi; zastępstwa z `alt`, potem cokolwiek pasującego całą parą — fit symetryczny; A → B → A wraca bit w bit) albo 'buy' (każde gniazdo z przepisu; brak → lista zakupów po cenie portu; broń, której port nie złoży → `blocked`); `presetFromHardpoints` = własna konfiguracja (najwyżej 2 na kadłub). Profil ognia i liczby kart: `src/game/fitStats.js`.

- Klej (`index.html`, blok „WYPOSAŻENIE” przed `DEFAULT_PLAYER_HULL_ID`): `buildPlayerFitPlan` / `applyPlayerFitPlan` (jedna transakcja: odmowa przy `blocked` i braku kredytów, zakupy przez `fitBuyWeaponPiece` → `adjustStationStock` jak handel, moduł, zdjęcia do magazynu, montaż, system F), `setPlayerFitModule` (typy gniazd `applyPlayerModuleSlotTypes`, tarcza `applyPlayerShieldStats`, źródło 'fit' modyfikatorów, magazynki wyrzutni w proporcji mnożników), `grantFitKits` (raz — `kitsGranted`), refit ręczny `fitUiMountSlots` (brakujące sztuki kupowane przy montażu), konsola `window.PlayerFit` (`plan`, `apply`, `weaponPrice`, `range`, `state`). Gniazdo gracza ma `baseType` (pozycja z edytora) i `type` (po module) — nowa tablica gniazd gracza powstaje tylko w `rebuildHardpointsForFrame` i `loadLoadout` i obie nakładają typy modułu; `snapshotPlayerHardpoints` zapisuje typ po module. Zapis: `hullModules`, `hullSystems`, `partStock`, `hullPresets` (aktywna karta / `custom` / id własnej), `fitCustoms`, `kitsGranted` (`serializePlayerFitState` / `restorePlayerFitState` — stan wyposażenia PRZED profilem kadłuba).

- Ekran (`src/ui/station/fittingPanel.js`, styl `assets/css/station-fitting.css`, układ z container queries względem tabletu): pasek stanu (karta, moduł, F, tarcza, amunicja, NAPRAW, UZUPEŁNIJ AMUNICJĘ), karty (profil ognia, mapa gniazd do przezbrojenia, cena braków, Z MAGAZYNU / KUP / ZASTOSUJ, pasek ZMIAN; ←/→ Enter, R), refit ręczny (sylwetka z gniazdami — klik, Shift, SYMETRIA, grupy i burty; lista broni z hangarem i ceną; moduł, system F, chipy; ZAPISZ JAKO WŁASNĄ). Kanwy panelu muszą przebijać globalną regułę `main.css` `canvas:not(#c)` (absolutne, bez myszy) — selektory `.fit-root … canvas:not(#c)`. Kampania: start na UNIWERSALNEJ; przycisk WYPOSAŻENIE w panelu stanowiska K-7 zdjęty 2026-10-14 (decyzja użytkownika — w doku sam przycisk ODDOKOWANIE), droga zostaje (`spec.alt` panelu akcji fabuły → `api.dock.openFitting` → terminal portu Ziemi; przy otwartym terminalu panel akcji i jego klawisz śpią).

- Testy `tests/fitPlanner.test.mjs`, `tests/playerFitSave.test.mjs`; w grze `node scripts/webgpu/wyposazenie-gra.mjs` (karty, moduły, zasięg Lancy 15 km, refit ręczny z klikiem w sylwetkę, zakup w porcie, F5, pasek stanu, 1280×720) i `node scripts/webgpu/wyposazenie-kampania-gra.mjs` (panel stanowiska → WYPOSAŻENIE → karta → ODDOKUJ — od 2026-10-14 nieaktualne: misja 1 nie daje WYPOSAŻENIA w doku).
