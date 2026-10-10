# Wyposażenie okrętu: „click & fit”, konfiguracje i moduły — analiza i plan (2026-10-08)

> Prośba użytkownika (2026-10-08): „trzeba przebudowac UI stacji - fitowanie. chce dodac loadouty - Bliski tank - bedzie
> mial opcje »tarcza i F przyspieszenie« - montuje bronie krotkiego zasiegu, modul tarcze i f. Snajper - nowe f - silniki
> manewrowe np E i F przerzuca go w prawo, D i F obraca go wzgledem celu lub kursora. montuje bronie dalekiego zasiegu,
> silniki manewrowe i nowy modul podbijajacy zasieg broni x2 lub dopasuj. mysle jaki moglby byc 3 specjality - chyba
> general albo missile boat. przebudowac UI pod click & fit czyli wyswietlic 4 karty refit typów automatów = przycisk
> »refit ręczny«. zaplanuj to, sprawdz ui”.
>
> Osobne zadanie z tej samej rozmowy (puszczone jako osobna sesja „Specjale F okrętów: Atlas, Terra Nova, piraci”):
> systemy F wszystkich okrętów — Atlas: szarża albo manewr, Terra Nova: zryw silników, piraci: przyspieszony ogień.
> Ten plan korzysta z jej API (§ 4.4) i niczego w systemach F nie buduje.
>
> Stan kodu: `main` z 2026-10-08 + niezacommitowana praca innych sesji (m.in. `src/game/engineDamage.js`). Numery linii
> `index.html` są z tego dnia i przesuwają się — szukaj po nazwach funkcji.
>
> Makieta ekranu: `dema/fitowanie-koncept.html` (przez Vite: `http://localhost:5199/dema/fitowanie-koncept.html`).
>
> **Decyzje użytkownika (2026-10-08, odpowiedź na § 1):** D1 — „uniwersalna” (czwarta karta UNIWERSALNA, DOWÓDCA
> odpada); D2 — „w misji startowej gotowe komplety, potem ekonomia: gracz podlatuje statkiem X i pokazują mu się
> warianty, które kosztują kasę, lub jeśli ma w hangarze to free, lub mniej kasy — tyle, ile części ma”; D3 — „klasa
> dział snajperskich — potrzebne dla balansu”; D4 — „jeśli uważasz, że jest to potrzebne do balansu” (jest — § 4.2).
> Etap 0 ruszył w osobnej sesji („Etap 0 fitowania: porządki mechanika i zapis magazynu”).
>
> **Wdrożone w grze 2026-10-08 (polecenie „wgrywamy do gry”, bez commita):** etapy 2–6 — karty, automat, ceny portu,
> moduły, ekran WYPOSAŻENIE (karty + refit ręczny), Komory rakietowe, przycisk WYPOSAŻENIE w panelu stanowiska K-7;
> D5–D9 wdrożone wg propozycji. Opis wdrożenia: AGENTS.md § „WYPOSAŻENIE”; próby w grze
> `scripts/webgpu/wyposazenie-gra.mjs`, `wyposazenie-kampania-gra.mjs`. Otwarte: etapy 7–8.

## 0. W skrócie

- **Dzisiejszy MECHANIK to dwie długie listy:** magazyn broni ↔ 45 wierszy „MAIN #1 … MAIN #15, AUX #1 …”, przeciąganie
  albo dwuklik. Nie ma sylwetki okrętu (nie wiadomo, gdzie jest gniazdo), zasięgów, sum siły ognia, modułów; teksty bez
  polskich znaków, połowa po angielsku. Chipy (1 sztuka: PD CHIP) nie zmieniają liczb. „Ulepszenia” w HANGARZE to martwy
  kod (nie zapisują się, kumulują się przy ponownym kupnie, część zmienia pola, których model lotu nie czyta).
- **W grze nie ma sklepu z bronią.** Broń bierze się z zapasu startowego, z wraków holowanych do doku i z kampanii;
  24 z 41 broni dla Atlasa są osiągalne tylko w `?dev`. Magazyn broni **nie zapisuje się** — po F5 wraca zapas startowy.
- **Cel:** zakładka **WYPOSAŻENIE** (dawny MECHANIK): cztery karty konfiguracji — automat, jeden klik i okręt jest
  przezbrojony z tego, co masz — plus przycisk **REFIT RĘCZNY** (sylwetka z gniazdami, klik w gniazdo → klik w broń).
  Konfiguracja = broń w gniazdach + **MODUŁ** (nowe gniazdo) + **SYSTEM F**.
- **Karty (D1):** UNIWERSALNA (start gry i kampanii: Tempest Ciężki + Yamato, wolny moduł, F szarża), BLISKI TANK
  (krótki zasięg, moduł tarcz, F szarża), SNAJPER (nowa klasa dział snajperskich, komputer balistyczny, F manewr),
  RAKIETOWIEC (komory rakietowe, F manewr).
- **Ekonomia kart (D2, § 4.10):** w misji startowej komplety wszystkich kart są w hangarze gracza — przełączanie za
  darmo. Potem karta kosztuje tyle, ile kosztują BRAKUJĄCE części (broń, moduł, system F) po cenach portu; co gracz ma
  w hangarze — za darmo. Ten sam ekran dla każdego kadłuba („statek X”). Obok zakupu: „Z MAGAZYNU” — automat składa
  kartę z tego, co jest, z zastępstwami.
- **Klasa dział snajperskich (D3, § 4.3.1):** pole `weaponClass: 'sniper'` — Valkyrie S / M / Capital, Mjolnir i nowe
  działa main „Lanca” M / L (8 / 10 km, mało DPS). Komputer balistyczny wydłuża zasięg TYLKO tej klasie.
- **Nowe mechaniki:** gniazdo modułu i trzy moduły, wspólne źródło modyfikatorów okrętu (`ship.modifiers` — dziś martwy
  hak czytany w ~13 miejscach, nikt go nie ustawia), zapis magazynu broni, naprawa zniszczonych gniazd w doku,
  uzupełnianie amunicji jako usługa.
- **Balans (D4):** bliski tank z dzisiejszych broni przegrywał z fitem startowym nawet z bliska (2 726 wobec 3 435 DPS
  do 3,2 km — Yamato 510 DPS na 7 km bije wszystko); z Plasma Gatlingiem 640 DPS: 5 126 = +42% wobec UNIWERSALNEJ.
- **Etapy 0–8** (§ 6). Etap 0 trwa; etapy 1–5 dają w grze karty UNIWERSALNA / TANK / SNAJPER z cenami i refit ręczny;
  RAKIETOWIEC — etap 6.

## 1. Decyzje do potwierdzenia

| # | Decyzja | Stan |
|---|---|---|
| D1 | Cztery karty | **ZDECYDOWANE:** UNIWERSALNA, BLISKI TANK, SNAJPER, RAKIETOWIEC + osobny przycisk REFIT RĘCZNY. DOWÓDCA (mostek flagowy, rozkaz skupienia) poza zakresem |
| D2 | Skąd automat bierze broń | **ZDECYDOWANE:** w misji startowej komplety wszystkich kart w hangarze gracza (zapisywany magazyn), potem ekonomia — cena karty = brakujące części po cenach portu, posiadane za darmo (§ 4.10). Dotyczy każdego kadłuba gracza |
| D3 | Zasięg snajpera | **ZDECYDOWANE:** klasa dział snajperskich (§ 4.3.1); komputer balistyczny ×1,5 zasięgu i ×1,4 prędkości pocisku tylko dla tej klasy, sufit 18 km (wzrok Atlasa) |
| D4 | Siła bliskiego zasięgu | **ZDECYDOWANE:** Ion Plasma Gatling 240 → 640 DPS (broń tylko gracza — NPC w grze jej nie noszą). Tank: 5 126 DPS do 3,2 km = +42% wobec UNIWERSALNEJ |
| D5 | Gniazda modułów | Propozycja: Atlas 1 moduł + system F; inne kadłuby gracza 1 moduł od niszczyciela w górę (fregaty — 0), system F z kadłuba. Chipy zostają osobno (zmieniają reguły, nie liczby) — w tej samej kolumnie ekranu |
| D6 | Rakietowiec | Propozycja: moduł „Komory rakietowe” zamienia 6 gniazd baterii (special) na wyrzutnie (missile) + amunicja rakiet ×1,5. Alternatywa: +6 nowych komór VLS na grzbiecie (pozycje na sprite'cie, edytor gniazd) |
| D7 | Nazwa i porządki | Propozycja: zakładka MECHANIK → **WYPOSAŻENIE** (klawisz 4 bez zmian); naprawa kadłuba i gniazd + uzupełnienie amunicji w nagłówku zakładki; martwe „ulepszenia” z HANGARU usunąć (sesja etapu 0 pyta o to osobno) |
| D8 | Kiedy można zmienić konfigurację | Propozycja (zmieniona przez D2): w przyjaznym doku, natychmiast. Kampania startuje na UNIWERSALNEJ (zastępuje `CAMPAIGN_LOADOUT`), a w doku K-7 przed ODDOKUJ można wybrać dowolną kartę — komplety są w hangarze |
| D9 | Własne konfiguracje | Propozycja: refit ręczny ma „ZAPISZ JAKO WŁASNĄ” — do 2 własnych, jako małe karty pod czterema (nie zamiast nich) |
| D10 | Liczby klasy snajperskiej | Propozycja (§ 4.3.1): Lanca M 8 km / 20 DPS, Lanca L 10 km / 25 DPS; Valkyrie S 5 → 6,5 km (dziś krótsza niż Yamato L) |

## 2. Stan obecny — UI (zrzuty w grze, 2026-10-08, 1920×1080)

Zrzuty: zakładki HANGAR, HANDEL, KANTYNA, MECHANIK (broń i chipy) i lot po zamknięciu terminala — skrypt CDP na
prawdziwej grze (gra swobodna, port Ziemi).

### 2.1 Co widzi gracz

**MECHANIK**
- Lewa karta „Magazyn broni”: lista sztuk z magazynu pogrupowana typem gniazda (nazwa, rozmiar, `×n`, „150dmg / 2.5s /
  8 ammo”). Broń, której wszystkie sztuki są zamontowane, **znika z listy** — nie widać, co w ogóle masz.
- Prawa karta „Hardpointy”: 15 identycznych wierszy „MAIN #1 Tempest Ion Mk II 10dmg / 0.8s ×”, potem AUX #1… —
  gniazdo bez położenia na okręcie i bez łuku ostrzału; wybór gniazd do serii przyciskami 1 / 3 / 5 / 10 / ALL.
- Nigdzie nie ma **zasięgu** broni (najważniejszej liczby po skróceniu zasięgów 2026-10-07), sumy DPS, profilu ognia,
  obrony punktowej, stanu amunicji.
- Teksty: „Przeciagnij bron na slot po prawej stronie”, „Upusc bron na slot, aby podmienic uzbrojenie” (bez polskich
  znaków), „Hardpointy”, „MAIN #1”, odznaki „LOADOUT / STATEK”, stopka „MODUŁ MECHANIC”; w `?dev` przycisk „FILL WEAPC…”
  ucięty na końcu paska filtrów.
- Chipy: jedna karta „PD CHIP 900 CR (DEV: 0) · ZAINSTALUJ” — ten sam układ list.

**HANGAR**
- Rząd „usług” na górze z uciętymi nazwami: „Napraw kadłub — Uszkodzenia: 0%…”, „Chłodzenie rai…”, „Wzmocniony boo…”,
  „Zwrotność +” (to martwe ulepszenia, § 3.3).
- Listy kadłubów po angielsku: „Terra Nova frigate”, „Independent supercapital”, „ACTIVE”, odznaki „MARKET / INVENTORY”,
  „Kliknij statek aby rozwinac szczegoly i kupic hull”. Statystyki gniazd Atlasa w rozwinięciu są z `ships.js`
  (`spec: main 24, missile 8, aux 8, hangar 4, special 1`) — nieprawdziwe (Atlas ma 15 / 2 / 14 / 6 / 6 + 1 + 1).

**HANDEL** — przyciski „KUP 10” kolumny „Handel z dokiem” wchodzą pod kartę „Ładunki górnicze” (przepełnienie siatki).

**Lot (HUD)** — pole F na szynie kokpitu podpisane „SALWA”, a status z lewej „[F] SZARŻA – GOTOWA” (poprawia sesja
specjałów F).

### 2.2 Błędy w logice mechanika (do naprawy przy przebudowie)

| Błąd | Gdzie | Skutek |
|---|---|---|
| Seria „3” obsadza 4 gniazda, „10” — 11 | `applyWeaponBatchToHardpoints` (gniazdo startowe + N dodatkowych) | przycisk kłamie |
| Brak sztuki w połowie serii: stara broń zostaje, a gniazdo dostaje amunicję NOWEJ | `applyWeaponToHardpoint` → `setHardpointMount` wychodzi bez słowa | zła amunicja, brak komunikatu |
| Zniszczone gniazdo nigdy nie wraca | `markHardpointDestroyed` (`hp.destroyed = true`, broń przepada); `handleRepair` / `dockRemontShip` nie zdejmują flagi; zapis jej nie zawiera (po F5 gniazdo „ożywa”) | po bitwie gniazda zostają martwe do przeładowania strony |
| Amunicja uzupełnia się tylko ponownym upuszczeniem tej samej broni na gniazdo | brak usługi | ukryta funkcja |
| Magazyn broni nie jest zapisywany | `saveLoadout` pisze tylko gniazda | broń z wraków przepada po F5 (zamontowana — zostaje) |
| `loadLoadout` odtwarza gniazda kolejnością w typie, nie po `id` | `loadLoadout` | mieszany typ (np. 4× Valkyrie + 2× Mjolnir) po F5 przesiada się między gniazdami |

### 2.3 Jak to jest zbudowane

- DOM w `index.html`: `#hud-top-container > #hud-top-dock > #top-drawer` z panelami `#tab-hangar`, `#tab-trade`,
  `#tab-cantina`, `#tab-mechanic-html`, `#tab-infrastructure-html` (+ osierocony `#tab-upgrades`). Budowane raz
  (`initStationOverlay` → `buildMechanicPanel`, `buildHangarPanel` …); co klatkę tylko tanie odświeżenia
  (`renderStationOverlay` → `updateMechanicCards` …), listy mechanika przebudowuje `renderMechanic()` po zdarzeniach.
- Tablet kokpitu (`src/ui/cockpitUI.js`) przenosi `#hud-top-container` do swojego `slot="station-panel"` i dokłada ramkę,
  pasek zakładek i stopkę (`syncTablet`, `selectStationTab` → `CockpitBridge.selectStationTab`). Etykiety zakładek są
  w trzech miejscach (`STATION_TERMINAL_TABS` — ang., `STATION_TAB_LABELS`, `STATION_TABS` w kokpicie).
- Style: treść w niebieskim „aero glass” (`assets/css/main.css`, ~1466–1927 i 3488–3790, martwe duplikaty 497–569 i
  804–968), układ w tablecie z `assets/css/cockpit-ui-bridge.css`, ramka tabletu w `cockpit-ui.css` (czarno-pomarańczowa).
  Dwa języki wizualne naraz.
- Klawisze: przy otwartej stacji Digit1–5 przełączają zakładki, Esc zamyka (`keydown` przy `stationUI.open`).
- Testy przypięte do napisów źródła: `tests/stationUiLayout.test.mjs` (selektory, szerokości `.weapon-row` / `.hp-row`,
  `mechanicHardpointGlyph`), `tests/shipChips.test.mjs` (wycina `function buildMechanicPanel() {`),
  `tests/mechanicDevWeapons.test.mjs`, `tests/playerDefaultLoadout.test.mjs`.

## 3. Stan obecny — model danych fitu

### 3.1 Gniazda Atlasa

| Typ (`HP`) | Gniazd | Grupa ognia | Dziś (fabryczna) |
|---|---|---|---|
| `main` | 15 | 1 DZIAŁA | Tempest Ion Mk II (4,5 km) |
| `special` | 6 | 2 BATERIA GŁÓWNA | Yamato (7 km) |
| `missile` | 2 | 3 RAKIETY | Grad + Cruise |
| `aux` | 14 | obrona punktowa | 6× CIWS Mk I, 4× Perun, 2× laser PD, 2× CIWS Mk II |
| `hangar` | 6 | myśliwce (Z) | 6× eskadra wielozadaniowa |
| `special_missile` | 1 | 5 | Supernova Barrage |
| `builtin` | 1 | 4 | Hexlance |

- Układ: `src/data/atlasHardpointDefaults.js` (pozycje w pikselach PNG 3747 × 1677, dziób +X, pary lustrzane ±y), ale
  `localStorage['hpEditor.v1']` z edytora gniazd **wygrywa** z kodem. Wszystkie gniazda Atlasa mają rozmiar Capital
  (`buildPlayerDefaultEditorHardpoints`) — rozmiar broni na Atlasie niczego nie blokuje.
- Gniazdo: `{ id, type, size, pos: { x, y, rot }, mount, ammo, maxAmmo }` (+ `hangarSquadrons`, `destroyed` …), bez grupy.
- Grupy ognia (`FC_GROUPS` w `fireControl.js`) to typy gniazd: `main` / `special` / `missile`.

### 3.2 Magazyn, montaż, zapis

- Magazyn: `Game.player.inventory` = `WeaponInventory` (`src/game/weaponInventory.js`: `count / give / take / set`).
  Montaż jest darmowy: `take` z magazynu, zdjęcie — `give`. Zasada „magazyn + zamontowane = const” (opis pułapek:
  pamięć projektu, `tests/playerDefaultLoadout.test.mjs`).
- `saveLoadout` → `localStorage['loadout']` = `{ activeHullId, ownedHullIds, shipFrame, hullChips, hardpoints: [{ id, type,
  mount, ammo, maxAmmo, hangarSquadrons }] }`; `loadLoadout` przy starcie po `rebuildHardpointsForFrame()`.
  `PLAYER.hullLoadouts` jest zadeklarowane i nieużywane (jeden fit, nie per kadłub).
- Zapas startowy `DEFAULT_INVENTORY_STOCK` (24 Tempest Mk II, 6 Yamato, 8 Cruise, 2 Grad / Rój / Hydra / torpedy …)
  i fit fabryczny `autoMountDefaults`; kampania nadpisuje 5 typów gniazd (`CAMPAIGN_LOADOUT` / `equipCampaignLoadout`).

### 3.3 System F, chipy, ulepszenia, modyfikatory

- **System F** (`src/data/shipSystems.js`): tylko SZARŻA (`ram_burn`) dla Atlasa, Iron Skulla i Colossusa, przypięta do
  kadłuba (`shipSystemFor(hullId)`), bez wyboru i bez zapisu; ładunek `ramBurn` globalny. Rozbudowę robi sesja specjałów F.
- **Chipy** (`src/data/chips.js`, `src/game/shipChips.js`): per kadłub (`PLAYER.hullChips`), koszt i zwrot 50%, zapis
  w `loadout`, działanie sprawdzane w miejscu użycia (`hasShipChip`). „Chip nie podbija liczb, tylko zmienia regułę”.
- **Ulepszenia** (`BLUEPRINTS.upgrades`: `rail_cooler`, `boost_core`, `agility`, `purchaseUpgrade`): niezapisywane,
  nieusuwalne, kumulują się; `agility` zmienia `ship.engines.torqueLeft.maxThrust`, którego dzisiejszy model dysz nie czyta.
  Do usunięcia — ich rolę przejmują moduły.
- **`ship.modifiers`** (pola `range`, `damage`, `projectileSpeed`, `fireRate`) jest czytany, nikt go nie ustawia:
  `fireWeaponCore` (zasięg → życie pocisku, długość wiązki; `cd = cooldown × fireRate` — **fireRate mnoży cooldown**),
  `getPlayerWeaponRange` → `_fcEnv.rangeOf` (wybór celów wież na auto, rakiety na auto, blokady), skan kandydatów
  `refreshFireControlCandidates`, autopilot ataku, okrąg zasięgu w HUD (`_drawTargetingRange`), pierścienie radaru,
  wachlarz torped. **Nie** biorą go: rakiety 3D (`rocketSystem3D` — `maxRange = weaponDef.baseRange`), obrona punktowa
  i flak, Hexlance, ścieżka gracza 2 (`weaponController.js`, `getFiringModeModifiers` nie istnieje). Kontrakt z sesją F:
  modyfikatory składane ze źródeł (`system`, `fit`), nie przypisywane wprost (§ 4.4).

### 3.4 Broń — pasma, siła, dostępność

DPS = obrażenia × lufy × salwa / cooldown (flak — z pełną siłą, na kadłuby 10–16%).

| Broń | Gniazdo | Zasięg | DPS | Skąd dziś |
|---|---|---|---|---|
| Tempest Ion Mk II | main | 4,5 km | 25 | zapas (24), wraki TN |
| Armata Oblężnicza | main | 3,5 | 60 | zapas (2), wraki piratów |
| Heavy Autocannon — Oblężniczy | main | 3,6 | 86 | tylko `?dev` |
| Laser Wiązkowy (Puls) | main | 3,5 | 69 | tylko `?dev` |
| Tempest Ion — Ciężki | main | 6 | 36 | kampania |
| Helios Lance | main | 6 | 38 | tylko `?dev` |
| Yamato | special | 7 | 510 | zapas (6) |
| Ion Plasma Gatling | special | 3,2 | 240 | tylko `?dev` |
| Goliath | special | 4,5 | 141 | wrak pirackiego supercapitala |
| Oszczep (Valkyrie M) | special | 7 | 127 | zapas (2) |
| Valkyrie | special | 9 | 167 | tylko `?dev` |
| Mjolnir | special | 20 (postój, ładowanie 3 s) | 313 | tylko `?dev` |
| Cruise Rack | missile | 12 | 400 (8 salw) | zapas (8), wraki |
| Hydra | missile | 9 | 411 (10 salw) | zapas (2), wraki TN |
| Grad | missile | 6 | 480 (8 salw) | zapas (2), wraki |
| Rój | missile | 4,5 | 400 (16 salw) | zapas (2), wraki piratów |
| CIWS Mk II / Perun | aux | 2,2 / 5,2 | OP | zapas (2 / 4) |
| eskadry przechwytujące / szturmowe | hangar | — | — | tylko `?dev` |

Wnioski: (1) tożsamość konfiguracji siedzi w gniazdach **specjalnych** — działa main dają mało (25–86 DPS na gniazdo);
(2) Yamato (510 DPS, 7 km) bije każdą broń specjalną bliższego zasięgu — łamie regułę „dłuższy zasięg = mniej DPS”
(D4); (3) bez kompletów albo zbrojowni (D2) automat nie ma z czego zbudować żadnej konfiguracji poza fabryczną.

## 4. Projekt

### 4.1 Pojęcia

- **Konfiguracja** (karta) — przepis, nie lista konkretnych sztuk: dla każdego typu gniazda **lista preferencji** broni
  (od najlepszej do zastępstw), moduł, system F, opcjonalnie zamiana typu gniazd (rakietowiec).
- **Automat refitu** — z przepisu, gniazd kadłuba i magazynu liczy **plan**: co zdjąć, co założyć, czego brakuje i czym
  automat to zastąpił. Klik „ZASTOSUJ” wykonuje plan.
- **Moduł** — nowe gniazdo kadłuba (1 na Atlasie), stałe premie; jeden moduł naraz.
- **System F** — wybór z listy dozwolonej dla kadłuba (Atlas: szarża / manewr — sesja specjałów F).
- **Hangar gracza** — zapisywany magazyn części (broń, eskadry, moduły, systemy F); to, co w nim jest, karta bierze za
  darmo (D2).
- **Profil ognia** — DPS w funkcji odległości (0–18 km), osobno działa i rakiety; ten sam wykres na kartach, w refit
  ręcznym i (później) w HUD-zie. Najlepszy sposób, żeby karty różniły się na pierwszy rzut oka.

### 4.2 Cztery konfiguracje

| | UNIWERSALNA (start) | BLISKI TANK | SNAJPER | RAKIETOWIEC |
|---|---|---|---|---|
| Działa (main 15) | Tempest Ciężki → Tempest Mk II | HA Oblężniczy → Armata → Puls → … | **Lanca L** → Lanca M (klasa snajperska) | Tempest Mk II |
| Bateria (special 6) | Yamato | Ion Plasma Gatling → Goliath | 4× Valkyrie + 2× Mjolnir (→ Oszczep → Kolec) | **wyrzutnie**: 4× Cruise + 2× Grad |
| Rakiety (missile 2) | Grad + Cruise | 2× Rój | 2× Cruise | 2× Hydra |
| OP (aux 14) | 6 CIWS I, 4 Perun, 2 laser, 2 CIWS II | 8× CIWS II, 6× CIWS I | 6× Perun, 6× CIWS I, 2× CIWS II | 6× Perun, 6× CIWS I, 2× laser |
| Hangary (6) | 6× wielozadaniowa | 6× wielozadaniowa | 6× przechwytująca | 6× szturmowa |
| Supernova, Hexlance | tak | tak | tak | tak |
| Moduł | wolny (dowolny w refit ręcznym) | Wzmacniacz tarcz | Komputer balistyczny | Komory rakietowe |
| System F | Szarża | Szarża | Manewr | Manewr |

UNIWERSALNA zastępuje oba dzisiejsze fity startowe: `autoMountDefaults` (gra swobodna — działa Tempest Mk II, 4,5 km)
i `CAMPAIGN_LOADOUT` (kampania — Tempest Ciężki, 2× Cruise z podwójnym zapasem). Działa: Tempest Ciężki (6 km, 36 DPS
zamiast 25); kampania zachowuje podwójny zapas rakiet jako swoją regułę.

Liczby (ten sam wzór DPS co § 3.4; tank z D4, snajper z Lancą L i komputerem balistycznym):

| | UNIWERSALNA | Tank | Snajper | Rakietowiec |
|---|---|---|---|---|
| Działa do 3 km | 3 600 | **5 126** (bez D4: 2 726) | 1 667 (w ruchu 1 042) | 375 |
| Działa na 6 / 7 km | 3 600 / 3 060 | 0 | 1 667 (w ruchu 1 042) | 0 |
| Działa na 9 / 12 / 15 / 18 km | 0 | 0 | 1 667 / 1 667 / 1 000 / 625 (Mjolnir strzela tylko na postoju) | 0 |
| Rakiety do 6 / na 9 / na 12 km | 880 / 400 / 400 | 800 / 0 / 0 | 800 / 800 / 800 | **3 383 / 2 423 / 1 600** (~90 s ognia) |
| Tarcza | 18 000 | **25 200** | 18 000 | 18 000 |

Jak się gra (do opisu na karcie — jedna linia, bez ozdobników):
- **Uniwersalna**: wszystko po trochu — bateria Yamato do 7 km, działa do 6 km, rakiety, myśliwce; wolny moduł.
- **Tank**: zamknij dystans szarżą (taran też zabija), tarcza wytrzymuje dolot, z bliska największa siła ognia w grze.
- **Snajper**: walcz z 9–15 km, poza zasięgiem NPC (najdalej 7 km działa, 12 km rakiety); skok w bok przed salwą,
  szybki obrót baterii na cel. Kamera: domyślny kadr 9 × 5 km — przy module zasięgu zoom startowy dalej (§ 4.8.4).
- **Rakietowiec**: salwy z 8 wyrzutni sterowane automatem rakiet (budżet celu, § „Kierowanie ogniem gracza”), amunicja
  się kończy — uzupełnienie w doku; ciężka OP przeciw kontrze rakietowej. Uczciwie: do 7 km jest **słabszy** od
  uniwersalnej (działa + rakiety do 3 km: 3 758 wobec 4 480, −16% — Yamato), dalej wygrywa (na 9 km 2 423 wobec 400).
  Jeśli ma być mocny także z bliska — amunicja / przeładowanie z modułu albo szybsze salwy, nie więcej gniazd.

### 4.3 Moduły

Nowy plik `src/data/shipModules.js` (dane) + `src/game/shipModules.js` (czysty: efekty i walidacja).

| Moduł | Efekt (start do strojenia) | Gdzie działa |
|---|---|---|
| Wzmacniacz tarcz | tarcza max ×1,4, regeneracja ×1,5, opóźnienie ×0,7, twardość ×1,5 | statycznie po `applyPlayerHullProfile` (zachować ułamek napełnienia); postawa TARCZE mnoży dalej |
| Komputer balistyczny | zasięg ×1,5 broni klasy snajperskiej (`weaponClass: 'sniper'`, § 4.3.1), prędkość ich pocisków ×1,4 (czas lotu do końca zasięgu ×1,07), sufit 18 km | źródło `fit` modyfikatorów (§ 4.4) + mnożnik zależny od broni (niżej) |
| Komory rakietowe | gniazda `special` stają się `missile` (te same pozycje), amunicja rakiet ×1,5 | przy budowie gniazd (`rebuildHardpointsForFrame` z mapą zamiany typów), `maxAmmo` przy montażu |

Mnożnik zależny od broni: dziś `ship.modifiers.range` to jedna liczba. Komputer balistyczny potrzebuje mnożnika per
broń — jedna funkcja `weaponRangeMul(shooter, weaponDef)` (w module modyfikatorów) zamiast `mods.range` w
`fireWeaponCore`, `getPlayerWeaponRange`, `_drawTargetingRange`, pierścieniach radaru i wachlarzu torped; tak samo
`weaponSpeedMul`. Rakiety nie są klasą snajperską, więc luka `rocketSystem3D` (zasięg z `weaponDef`) zostaje bez zmian.

Sufit 18 km = wzrok Atlasa (`FOG_TUNE.vision`) — dalej broń i tak nie ma celu (mgła wojny). Mjolnir (20 km) nie rośnie.
Mostek flagowy (aura dla floty) odpadł z DOWÓDCĄ (D1).

#### 4.3.1 Klasa dział snajperskich (D3)

Dziś gniazda main nie mają nic dalej niż 6 km, a „daleki” Yamato (7 km, 510 DPS) bije wszystko — moduł zasięgu na
całą broń kinetyczną dałby snajperowi zwykłą baterię, tylko dalej. Klasa snajperska to broń, której jedyną zaletą jest
zasięg: mało DPS, duża pojedyncza salwa, szybki pocisk, czasem ładowanie.

- **Znacznik:** pole `weaponClass: 'sniper'` w `MASTER_WEAPONS` (nie nowa `category` — ta steruje efektami, kraterami
  i ekonomią: Lanca zostaje `rail`, efekty i cena jak u railguna). Czyta je moduł (`weaponRangeMul`), pasmo w UI
  („SNAJPER”), automat kart i strażnik testu (każda broń klasy ma zasięg ≥ 6,5 km i DPS niższy od najdłuższej broni
  zwykłej tego rozmiaru).
- **Skład:** Valkyrie S / M / Capital (special) i Mjolnir (special) — dziś już „snajperskie” z nazwy; nowe działa main:

| Broń (propozycja, D10) | Rozmiar | Zasięg / z modułem | Obrażenia / cooldown | DPS | Pocisk | Cena (port ×1,12) |
|---|---|---|---|---|---|---|
| Lanca | M (main) | 8 / 12 km | 48 / 2,4 s | 20 | 14 000 j/s (0,57 s do końca) | ~2 400 CR |
| Lanca Ciężka | L (main) | 10 / 15 km | 100 / 4,0 s | 25 | 15 000 j/s (0,67 s) | ~4 800 CR |
| Valkyrie S (Kolec) | S (special) | 5 → **6,5** / 9,75 km | bez zmian (180 / 2,5 s) | 72 | bez zmian | — |
| Oszczep, Valkyrie, Mjolnir | M / Capital | 7 / 9 / 20 km → 10,5 / 13,5 / 18 km | bez zmian | 127 / 167 / 313 | bez zmian | — |

- Dla porównania w tym samym rozmiarze: Tempest Mk II (M, 4,5 km) 25 DPS, Tempest Ciężki (L, 6 km) 36 DPS — Lanca ma
  mniej DPS za dwa razy dłuższy zasięg (reguła „dłuższy zasięg = mniej DPS”).
- Nowa broń wg AGENTS.md („Nowa broń”): wpis w `MASTER_WEAPONS` z `recoil` / `shake` (jak Valkyrie M), rodzina
  efektów — receptura Valkyrie (`WEAPON_FX`, `weaponFxTable.js`), klucz wieżyczki (`normalizeWeaponFxKey`), model 3D —
  rodzina w `FAMILIES` (`weapons3D.js`, wieża Tempesta z dłuższą lufą), krater ze stempla rail; testy `weaponFxTable`,
  `weaponRecipes`, `weaponRecoilSource`, `turretBatch3D` pilnują kompletu. Skąd ją wziąć: komplet SNAJPERA (D2) i port.

### 4.4 System F i modyfikatory — API z sesji specjałów F (wdrożone 2026-10-08, bez commita)

Sesja „Specjale F okrętów” zrobiła (jej notatka: `specjale-f-api-dla-fitowania.md` w notatkach sesji):
- **Systemy** (`src/data/shipSystems.js`, czyste): `ram_burn` (SZARŻA), `maneuver` (SILNIKI MANEWROWE: Q/E + F skok
  w bok, A/D + F obrót na cel / kursor), `engine_burst` (Terra Nova: Custos, Hasta, Bellator, Citadella; Colossus —
  w katalogu kadłub Terra Nova — z opcją szarży), `rapid_fire` (piraci: Marauder, Reaver; Iron Skull z opcją szarży).
  `shipSystemFor(hullId)` — domyślny, `shipSystemOptionsFor(hullId)` — lista do wyboru (pierwsza = domyślna; pola `id`,
  `label`, `short`, `icon`, `desc` — zdanie po polsku do karty), `shipSystemDefFor(hullId, id)` — walidacja.
- **Gracz** (`index.html`, blok „SYSTEM OKRĘTU (F)”): `setPlayerShipSystem(id, hullId)`, wybór w
  `PLAYER.hullSystems[hullId]` (brak wpisu = domyślny); `window.getPlayerShipSystemOptions(hullId)`,
  `window.playerShipSystem()`. **Nie zapisuje się** — zapis `PLAYER.hullSystems` w `localStorage['loadout']` i UI
  wyboru są w tym planie (§ 4.7 — pole `hullSystems` = ta sama mapa).
- **Modyfikatory** (`src/game/shipModifiers.js`, czysty): `setModifierSource(encja, źródło, { range, damage,
  projectileSpeed, fireRate })`, `clearModifierSource`, `modifierSource`, `modifierFireRate`, `fireRateModifier(k)` = 1/k;
  `encja.modifiers` = iloczyn źródeł, przeliczany tylko przy zmianie. Źródło `'system'` — szybki ogień, `'fit'` — moduły
  tego planu. `fireRate` mnoży przeładowanie (gracz: `hp.fcCd` / `specialCd` / `missileCd`, NPC: `processAutonomousWeapons`).

Do dopisania w etapie 3: pola są dziś JEDNĄ liczbą na okręt, a komputer balistyczny działa tylko na klasę snajperską.
Rozszerzenie `shipModifiers.js` o mnożniki per klasa broni (np. pole źródła `classRange: { sniper: 1,5 }`,
`classProjectileSpeed`) i funkcje `weaponRangeMul(encja, def)` / `weaponSpeedMul(encja, def)` (= pole ogólne × pole klasy
`def.weaponClass`); miejsca czytające dziś `mods.range` / `projectileSpeed` (§ 3.3) przechodzą na te funkcje. System F jest
też CZĘŚCIĄ w hangarze gracza (D2): Atlas ma szarżę w kadłubie, silniki manewrowe trzeba mieć (komplet SNAJPERA) albo kupić.

### 4.5 Automat refitu (`src/game/fitPlanner.js`, czysty)

```
planFit({ hardpoints, inventory, preset, modules, systemOptions, typeMap, mode: 'own' | 'buy' }) → {
  slots: [{ hpId, from, to, source: 'mounted' | 'stock' | 'buy' | 'missing', substitute }],
  unmount: Map(id → n), mount: Map(id → n), buy: Map(id → n), missing: [{ wanted, n, usedInstead }],
  module, system, complete: n / total, stats: fitStats(...)
}
priceFit(plan, station, econ) → { total, lines: [{ id, n, unit, available }], blocked: [...] }   // weaponPriceAt
applyFit(plan, api)  // api = buy (buyWeaponFrom) / setHardpointMount / addHangarSquadronToHardpoint / give / take /
                     //       setModule / setSystem — zakup i montaż jedną transakcją (brak kredytów = nic się nie dzieje)
```

- Dwa tryby (D2): `buy` — pełna karta, brakujące części idą na listę zakupów (bez zastępstw); `own` — „Z MAGAZYNU”:
  tylko to, co jest w hangarze, braki zastępowane (niżej). Karta pokazuje oba wyniki: cenę braków i co da się złożyć
  za darmo.
- Pula = magazyn + **wszystko, co już zamontowane** (zdjęte wraca do puli przed rozdziałem), więc przejście tank →
  snajper → tank zawsze wraca do tego samego stanu.
- Kolejność gniazd: pary lustrzane razem (±y przy tym samym x) — przy brakach fit zostaje symetryczny; najpierw
  gniazda bliżej dziobu / o szerszym łuku (`mountFireArc`).
- Zastępstwo: następna pozycja listy preferencji; brak wszystkich — broń, która już tam siedzi; gniazdo puste tylko,
  gdy nic nie pasuje. Gniazdo zniszczone (`destroyed`) pomijane (najpierw naprawa).
- Niezmiennik w teście: `magazyn + zamontowane` przed i po `applyFit` równe (sztuka po sztuce); deterministyczny wynik.
- Amunicja: założona broń — pełny magazynek (jak dziś przy montażu); moduł komór — `maxAmmo × 1,5`.
- Start: UNIWERSALNA zastępuje `autoMountDefaults` i `CAMPAIGN_LOADOUT` — jedna ścieżka montażu (automat) zamiast trzech
  (start gry swobodnej, start kampanii, mechanik).

### 4.6 Statystyki (`src/game/fitStats.js`, czysty)

- `fireProfile(slots, mods)` → DPS(d) dla d = 0…18 km co 0,25 km, osobno działa (main + special + builtin bez
  Hexlance'a) i rakiety (salwy, z czasem do wyczerpania amunicji);
- sumy: maks. zasięg, DPS w pasmach (do 3 / 3–7 / 7–12 / ponad 12 km), OP (liczba luf i zasięg), alfa salwy rakiet,
  tarcza (z modułem), system F, kompletność;
- ta sama funkcja liczy karty, refit ręczny i porównanie „przed / po”. Test: profil UNIWERSALNEJ = liczby z § 4.2.

### 4.7 Zapis

`localStorage['loadout']` — pola dokładane (bez zmiany istniejących; brak pola = dzisiejsze zachowanie):
- `weaponStock: { id: n }` — magazyn broni (dziś nie zapisywany). Odtwarzanie: magazyn z zapisu, gniazda z zapisu,
  **bez** dokładania zapasu startowego; `restoreHardpointMountEntry` tworzy sztukę z powietrza tylko przy zapisie bez
  `weaponStock` (migracja). Uwaga na pułapki z pamięci projektu (automount + `loadLoadout`, `beforeunload` →
  `__SAVE_LOCKED`).
- `partStock: { id: n }` — moduły i systemy F leżące w hangarze (zdjęty moduł wraca tu, nie znika).
- `hullModules: { hullId: moduleId }`, `hullSystems: { hullId: systemId }`, `hullPresets: { hullId: presetId }`,
  `customPresets: [...]` (D9), `kitsGranted: true` (komplety misji startowej wydane — drugi raz się nie dokładają).
- Gniazda odtwarzane **po `id`** (fallback: kolejność w typie, jak dziś) — inaczej mieszany typ przesiada się.
- Zamiana typów gniazd (komory rakietowe) wynika z modułu — zapisany jest moduł, nie typy.

### 4.8 Ekran WYPOSAŻENIE

Makieta: `dema/fitowanie-koncept.html` + `.js` (przez Vite — importuje `MASTER_WEAPONS`, gniazda Atlasa, sprite
kadłuba i ceny z `weaponEconomy.js`). Działa w niej: wybór karty → pasek zmian (z listą zakupów i zastępstw) →
ZASTOSUJ / „Z MAGAZYNU” / KUP, profil ognia z przerywaną linią obecnego fitu, mapa gniazd do przezbrojenia (biała
obwódka = część do kupienia), refit ręczny (sylwetka, zaznaczanie z symetrią, lista broni z hangarem i ceną — brakujące
sztuki kupowane przy montażu, moduł — także zamiana baterii na wyrzutnie — system F, chip, zapis własnej konfiguracji),
klawisze ← / → / Enter / R / Esc. Przełącznik nad tabletem „stan gracza”: „misja startowa — komplety” (wszystko za
darmo, 1 200 CR) i „później — bez kompletów, 150 000 CR” (np. inny kadłub albo po stratach: UNIWERSALNA niepełna —
UZUPEŁNIJ 15× Tempest Ciężki za 71 550 CR, TANK 261 990 CR, SNAJPER 282 770 CR, RAKIETOWIEC 86 860 CR). Lanca to dane
projektu (§ 4.3.1), Ion Plasma Gatling liczony z D4 (640 DPS). Wiersze „OGIEŃ” na kartach liczą działa + rakiety.

#### 4.8.1 Widok główny — KONFIGURACJE

```
┌ WYPOSAŻENIE ──────────────────────────────────────────────────────────────────────────────┐
│ ATLAS · UNIWERSALNA   kadłub 100%  gniazda 45/45  amunicja 100%   [NAPRAW · 0 CR] [UZUPEŁNIJ AMUNICJĘ] │
├──────────────┬──────────────┬──────────────┬──────────────┬─────────┤
│ UNIWERSALNA  │ BLISKI TANK  │ SNAJPER      │ RAKIETOWIEC  │ REFIT   │
│ wszystko po  │ do 3,5 km    │ 9–15 km      │ salwy 6–12km │ RĘCZNY  │
│ ▁▃▃▃▃▂▁▁▁▁   │ ▁▁█████▁▁▁▁  │ ▁▁▃▃▃▃▃▃▂▁   │ ▁▃▅▅▅▃▃▁▁▁   │ sylwetka│
│ (profil ognia, kreska = obecna konfiguracja)                         │ gniazda │
│ F SZARŻA · MODUŁ TARCZE      …                                       │ →       │
│ ogień ≤3 km +42% · zasięg 3,6 km · tarcza +40%                       │         │
│ 15× HA Oblężniczy · 6× Plasma Gatling · …                            │         │
│ W HANGARZE 30/45 · DO KUPIENIA 15 · 71 600 CR                        │         │
│ [Z MAGAZYNU]  [KUP I ZASTOSUJ · 71 600 CR]                           │         │
├──────────────┴──────────────┴──────────────┴──────────────┴─────────┤
│ ZMIANY (po wybraniu karty): zdejmij 15× Tempest Ciężki, 6× Yamato → hangar · załóż … ·      │
│ moduł — → Wzmacniacz tarcz · F bez zmian            [ANULUJ] [ZASTOSUJ]                     │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- Karta: nazwa, jedna linia roli, **profil ognia** (wypełnienie = karta, kreska = obecny fit), system F i moduł,
  te same 4 wiersze na każdej karcie z różnicą względem obecnej konfiguracji (ogień do 3 km, ogień na 9 km, zasięg
  dział, tarcza — porównanie kart „w poziomie”), skrót broni, mapa gniazd do przezbrojenia (sylwetka: barwa karty =
  zmiana, szare = zostaje, czerwony obrys = zostanie puste), stan części („W HANGARZE 30/45 · DO KUPIENIA 15 ·
  71 600 CR”). Przyciski: wszystko w hangarze — jedno ZASTOSUJ; braki — „Z MAGAZYNU” (za darmo, z zastępstwami) i
  „KUP I ZASTOSUJ · cena” (wyłączony, gdy brak kredytów albo port nie ma części — wtedy podpis „w porcie brak: 4×
  Valkyrie”). Karta aktywnej konfiguracji: znacznik AKTYWNA. Przy 720p lista broni i mapa gniazd chowają się
  (szczegóły są w pasku zmian).
- Klik w kartę = podgląd zmian w pasku pod kartami (z listą zakupów i zastępstw); przycisk wykonuje plan. Bez okien
  dialogowych.
- W trybie „Z MAGAZYNU” zastępstwa są na żółto, a gniazda, które zostaną puste, na czerwono.
- Klawisze (przy otwartej stacji 1–5 zmieniają zakładki — nie ruszać): ← / → wybór karty, Enter zastosuj, R refit
  ręczny (sprawdzić, że kontekst wejścia „stacja” nie przepuszcza R do naprawy w locie), Esc zamyka stację jak dziś.
  Pad (etap stacji z `docs/PLAN-pad.md`): D-pad ← / →, A zastosuj, Y refit ręczny, B wstecz.

#### 4.8.2 REFIT RĘCZNY

- Lewa część: **sylwetka okrętu** (sprite kadłuba, dziób w prawo) z 45 znacznikami gniazd w prawdziwych miejscach
  (`hp.pos`), kolor = typ gniazda, środek znacznika = pasmo zasięgu zamontowanej broni, przerywany obrys = puste,
  przekreślenie = zniszczone. Klik =
  zaznacz; domyślnie z gniazdem lustrzanym (przełącznik SYMETRIA); szybkie zaznaczenia: CAŁA GRUPA, LEWA BURTA,
  PRAWA BURTA, PUSTE. Najechanie: nazwa, zasięg, łuk ostrzału gniazda (wycinek na sylwetce).
- Prawa część: broń pasująca do zaznaczonych gniazd — nazwa, pasmo (BLISKI / LINIA / DALEKI / SNAJPER / OP), zasięg,
  DPS, w hangarze ×n, cena w porcie. Klik = montaż na wszystkich zaznaczonych: najpierw sztuki z hangaru, brakujące
  — zakup po potwierdzeniu ceny w tym samym wierszu (bez okna). ZDEJMIJ dla zaznaczenia (część wraca do hangaru).
- Pod listą: gniazdo MODUŁU, wybór SYSTEMU F (posiadane / cena), CHIPY (dzisiejsza karta przeniesiona tutaj).
- Na dole: profil ognia obecnego fitu i sumy z § 4.6 (aktualizowane po każdej zmianie), przyciski ZAPISZ JAKO WŁASNĄ,
  ← KONFIGURACJE (powrót do startu = karta UNIWERSALNA).
- Bez przeciągania (klik → klik); przeciąganie można zostawić jako skrót, ale nie jest potrzebne.

#### 4.8.3 Wygląd i technika

- Język wizualny kokpitu (płaski instrument: czarne tło tabletu, cienkie linie, pomarańcz `#ff6600` = wybór,
  bursztyn = ostrzeżenie, błękit = informacja, czerwień = brak), czcionka mono jak tablet, napisy z polskimi znakami,
  min. 11 px, wymiary przez `clamp()` / jednostkę tabletu. Bez „aero glass” w tej zakładce. Tekst tylko funkcjonalny
  (bez lore i statusów — notatka o menu z 2026-09-26).
- Kod poza `index.html` (kierunek z `docs/PLAN-rozbior-index.md`): `src/ui/station/fittingPanel.js` (DOM, zdarzenia,
  rysowanie sylwetki i profili na kanwie 2D) + `assets/css/station-fitting.css`; w `index.html` tylko klej
  (`buildMechanicPanel` montuje panel, `applyFit` przez istniejące funkcje montażu, zapis). DOM budowany raz, przy
  zmianie stanu — żadnej przebudowy co klatkę (`updateMechanicCards` w pętli ma tylko odświeżać liczby).
- Sylwetka: obraz kadłuba z `hullSpriteCache` (już wczytany przez grę) albo obrys z `buildHullSilhouette`
  (`turretPanel.js`); pozycje gniazd z `hp.pos` (przestrzeń renderu — skala `__hardpointScaleX/Y`).
- Tablet: panel siedzi w `#tab-mechanic-html` (id zostaje — tablet i testy go znają), etykieta zakładki z jednego
  miejsca (`STATION_TAB_LABELS`) we wszystkich trzech listach.

#### 4.8.4 W locie

- Okrąg zasięgu broni w HUD i pierścienie radaru biorą modyfikatory same (`ship.modifiers`) — po § 4.3 wystarczy
  `weaponRangeMul`.
- Snajper: zoom startowy kamery z maks. zasięgu fitu (np. kadr = 1,2 × zasięg baterii w kierunku celowania) —
  opcjonalnie, w `cameraRig.js` (`frameMargin` bez zmian).
- Nazwa konfiguracji w dzienniku po zastosowaniu („Konfiguracja: SNAJPER”); karta celu i HUD bez zmian.

### 4.9 Kampania, inne kadłuby, gracz 2

- Misja startowa (D2, D8): kampania zaczyna na UNIWERSALNEJ, w hangarze leżą komplety TANKA, SNAJPERA i RAKIETOWCA —
  w doku K-7 przed ODDOKUJ gracz wybiera kartę za darmo (panel stanowiska dostaje przycisk WYPOSAŻENIE obok ODDOKUJ).
  Komplety wydaje się raz (`kitsGranted`); to, co potem zginie w walce (zniszczone gniazdo zabiera broń), trzeba
  odkupić. Gra swobodna — te same komplety na starcie.
- Inne kadłuby gracza (kupione w HANGARZE, „statek X” z D2): te same cztery przepisy liczone z gniazd tego kadłuba —
  karta pokazuje, co z hangaru pasuje i ile kosztują braki; kompletów startowych dla nich nie ma. Brakuje broni
  specjalnej S / M / L krótkiego zasięgu (TANK na fregacie dostanie zastępstwa) — do uzupełnienia w katalogu broni.
- Gracz 2 (podzielony ekran): poza zakresem (strzela jeszcze przez `WeaponController.update`).

### 4.10 Ekonomia kart (D2)

Słowami użytkownika: „gracz podlatuje statkiem X i pokazują mu się warianty, które kosztują kasę, lub jeśli ma w
hangarze to free, lub mniej kasy — tyle, ile części ma”.

- **Część** = sztuka broni, eskadra, moduł albo system F (silniki manewrowe). Leży w hangarze gracza (zapisywany
  magazyn) albo w gnieździe; zdjęta wraca do hangaru, nie przepada i nie jest sprzedawana sama.
- **Cena karty** = suma cen BRAKUJĄCYCH części w tym porcie (`weaponPriceAt(station, econ, id).sell` — lokalne ceny
  składników × marża warsztatu 1,12; moduły i system F — stała cena z danych, bez rynku, na start). Wszystko w hangarze →
  0 CR, jeden przycisk ZASTOSUJ.
- **Dostępność:** port bez składników na daną broń (`stationCanBuildWeapon` = false) — pozycja „w porcie brak”, kupno
  pełnej karty niemożliwe, „Z MAGAZYNU” działa zawsze. Kupno pobiera składniki z magazynu portu (`buyWeaponFrom` —
  transakcja atomowa), więc stacja z wojny / bez dostaw sprzedaje drogo albo wcale (zgodnie z gospodarką).
- **Rząd wielkości** (ceny bazowe ×1,12): Lanca ~2 400, Lanca Ciężka / Tempest Ciężki / HA Oblężniczy ~4 800, Perun
  ~8 200, Valkyrie / Mjolnir ~21 000, Plasma Gatling / Yamato ~27 300 CR. Braki przy dzisiejszym zapasie (bez kompletów,
  razem z modułem i silnikami manewrowymi): TANK ~262 tys., SNAJPER ~283 tys., RAKIETOWIEC ~87 tys., UNIWERSALNA
  ~72 tys. (15× Tempest Ciężki). Gracz startuje z 1 200 CR — dlatego komplety misji startowej, a kupowanie to cel na
  później (odkupienie strat, karty dla innych kadłubów, lepsze wersje).
- **Sprzedaż** nadmiaru z hangaru (`sellWeaponTo`, cena skupu portu) — osobny przycisk w refit ręcznym, później.
- Pułapka: `fitPlanner` dostaje ceny z zewnątrz (czysty moduł bez gospodarki), a `applyFit` robi zakup przez API
  ekonomii przed montażem — brak kredytów albo części w trakcie = cała transakcja odrzucona, nic nie zmienione.

## 5. Liczby i zapas startowy

### 5.1 Strojenie na start

| Co | Wartość startowa | Uwagi |
|---|---|---|
| Ion Plasma Gatling | 60 → 160 obrażeń / 0,25 s (240 → 640 DPS) | D4; broń tylko gracza. Obrażenia na strzał zmieniają też krater (wzorzec w `hullDamageStamps.js`, test `hullCraters`) — przy zbyt dużych dziurach podnieść szybkostrzelność zamiast obrażeń |
| Wzmacniacz tarcz | ×1,4 / ×1,5 / ×0,7 / ×1,5 | tarcza Atlasa 18 000 → 25 200, regeneracja 150 → 225/s |
| Komputer balistyczny | zasięg ×1,5, pocisk ×1,4, sufit 18 km — tylko klasa snajperska | D3; Lanca L 15 km, Valkyrie 13,5 km |
| Komory rakietowe | 6 × special → missile, amunicja ×1,5 | D6 |
| Lanca / Lanca Ciężka | 8 / 10 km, 20 / 25 DPS | D10, § 4.3.1 |
| Ceny modułów i systemu F | Wzmacniacz tarcz 12 000, Komputer balistyczny 14 000, Komory rakietowe 16 000, Silniki manewrowe 10 000 CR | D2; stałe na start, potem z gospodarki |

### 5.2 Komplety misji startowej (D2)

Pula wspólna — konfiguracje dzielą broń, więc zapas ma pokryć najbardziej wymagającą z nich, nie sumę. Dokładane do
dzisiejszego zapasu startowego: Tempest Ciężki +15 (UNIWERSALNA), HA Oblężniczy +15, Ion Plasma Gatling +6, CIWS Mk II
+6 (do 8), Lanca Ciężka +15, Valkyrie +4, Mjolnir +2, Perun +2 (do 6), eskadry przechwytujące +6, szturmowe +6, po
jednym module (tarcze, komputer balistyczny, komory rakietowe) i silniki manewrowe. Reszta jest już w zapasie (Cruise 8,
Grad 2, Hydra 2, Rój 2). Wydawane raz (`kitsGranted`): czysty start dopisuje je do `DEFAULT_INVENTORY_STOCK`, stary zapis
bez znacznika dostaje brakujące sztuki kompletu przy pierwszym wczytaniu.

## 6. Etapy

| Etap | Zakres | Gotowe, gdy |
|---|---|---|
| 0 | Porządki mechanika bez nowych funkcji: seria 1/3/5/10 (off-by-one), błąd braku sztuki, naprawa zniszczonych gniazd w `handleRepair` / `dockRemontShip`, usługa „uzupełnij amunicję”, zapis magazynu broni + odtwarzanie gniazd po `id`, usunięcie martwych ulepszeń (po D7) — **w toku, osobna sesja** | testy niezmiennika magazynu i zapisu przechodzą; F5 nie gubi broni z wraków |
| 1 | **Wdrożony 2026-10-08 (bez commita; notatka `etap1-klasa-snajperska.md`, próba w grze `scripts/webgpu/lanca-gra.mjs`).** Klasa dział snajperskich (D3, § 4.3.1): `weaponClass: 'sniper'`, Lanca M / L (dane, efekty, wieża 2D i 3D), Valkyrie S 6,5 km, Plasma Gatling 640 DPS (D4), strażnik klasy w testach | Lanca strzela w grze (`zasiegi-gra.mjs` z nadpisaniem broni gracza), testy kompletu broni przechodzą, 0 pipeline'ów w klatce |
| 2 | **Wdrożony 2026-10-08.** Dane i automat: `fitPresets.js` (4 karty), `fitPlanner.js` (tryby `own` / `buy`), `fitStats.js`, `priceFit` (+ testy); start gry i kampanii przez UNIWERSALNĄ (zastępuje `autoMountDefaults` i `CAMPAIGN_LOADOUT`); komplety misji startowej + `kitsGranted` | profil UNIWERSALNEJ = § 4.2; tank ↔ snajper ↔ tank wraca bit w bit; konsola `applyFitPreset('tank')` działa w grze |
| 3 | **Wdrożony 2026-10-08.** Moduły: `shipModules.js`, źródło `fit` w `shipModifiers.js` (gotowe z sesji F) + mnożniki per klasa broni i `weaponRangeMul` / `weaponSpeedMul` we wszystkich miejscach z § 3.3, wzmacniacz tarcz, komputer balistyczny, zapis `partStock` / `hullModules` / `hullSystems` (= `PLAYER.hullSystems`) | w grze: zasięg Lancy L 15 km w `rangeOf`, okręgu HUD i życiu pocisku; tarcza 25 200; wieże na auto strzelają z nowego zasięgu |
| 4 | **Wdrożony 2026-10-08.** Ekran KONFIGURACJE (4 karty, profil ognia, mapa gniazd, ceny braków, „Z MAGAZYNU” / „KUP I ZASTOSUJ”, pasek zmian) w tablecie i przycisk WYPOSAŻENIE w panelu stanowiska K-7 | zrzuty 1920×1080 i 1280×720 bez przepełnień; zakup + zastosowanie ≤ 1 klatka przestoju; zakup bez kredytów nic nie zmienia |
| 5 | **Wdrożony 2026-10-08.** REFIT RĘCZNY (sylwetka, zaznaczanie, lista broni z ceną, moduł / F / chipy, własne konfiguracje) — zastępuje dzisiejsze listy | wszystko, co dało się zrobić w starym mechaniku, da się zrobić klikiem |
| 6 | **Wdrożony 2026-10-08** (salwy z 8 wyrzutni w misji — do pomiaru `rakiety-auto-gra.mjs`). RAKIETOWIEC: komory rakietowe (zamiana typów gniazd), amunicja ×1,5, automat rakiet przy 8 wyrzutniach | salwy z 8 wyrzutni w odwecie misji 1 bez spadku klatek (`rakiety-auto-gra.mjs`) |
| 7 | Ekonomia dalej: sprzedaż nadmiaru, ceny modułów i systemu F z gospodarki, broń specjalna S / M / L krótkiego zasięgu dla mniejszych kadłubów, karty dla każdego kadłuba gracza | karta na fregacie bez zastępstw w BLISKIM TANKU; testy `scripts/tests/weaponEconomy` |
| 8 | Porządki reszty stacji: HANGAR po polsku i bez martwego rzędu, statystyki gniazd z prawdziwych gniazd, HANDEL bez przepełnienia, jedna lista etykiet zakładek, martwy CSS i `#tab-upgrades` | zrzuty wszystkich zakładek bez angielskich napisów i ucięć |

Zależności: etap 1 (broń) jest niezależny i może iść od razu; etap 2 potrzebuje zapisu magazynu z etapu 0 i nazw broni
z etapu 1; etap 3 — API modyfikatorów z sesji specjałów F; etapy 4–5 — etapów 2–3.

## 7. Ryzyka i pułapki

- **Zapis z edytora gniazd** (`hpEditor.v1`) wygrywa z kodem — automat pracuje na RZECZYWISTYCH gniazdach, nigdy na
  „45”. Test z niepełnym układem.
- **Magazyn + zamontowane = const** przy każdej ścieżce (automount, `loadLoadout`, `equipCampaignLoadout`, automat,
  refit ręczny). Zapis magazynu zmienia kolejność startu — przepisać pułapki z pamięci projektu do testu.
- **`beforeunload` → `saveLoadout`**: każdy nowy zapis szanuje `window.__SAVE_LOCKED` (zerowanie zapisu).
- **Napisy w testach** (`stationUiLayout`, `shipChips`, `mechanicDevWeapons`) — przenieść strażników na nowe moduły
  zamiast trzymać stare nazwy funkcji.
- **Zasięg w wielu miejscach** — po `weaponRangeMul` sprawdzić skryptem w grze, że `rangeOf`, okrąg HUD, życie pocisku
  i pierścienie radaru mają tę samą liczbę.
- **Inne sesje edytują `index.html`** (silniki, flota, radar, specjale F) — zmiany tylko w swoich hunkach, bez `git stash`.
- **Balans**: tank i snajper zmieniają tempo misji 1 i 2 (odwet, zasadzka w pasie) — pomiar `zasiegi-gra.mjs` /
  `ogien-gra.mjs` z każdą konfiguracją przed oddaniem. Komplety na starcie dają graczowi części warte ~650 tys. CR —
  łup z wraków (broń z rozbiórki w doku) traci wartość na początku gry; sprawdzić przy etapie 7, czy sprzedaż nie robi
  z kompletów maszynki do kredytów (skup np. tylko części spoza kompletu albo z niską ceną).
- **Kampania zmienia start** (D2/D8): dziś misja 1 ma stałe uzbrojenie niezależne od zapisu (decyzja 2026-10-05);
  UNIWERSALNA ma być tym samym stałym startem — test `tests/storyMission.test.mjs` i `fabula-gra.mjs` po etapie 2.

## 8. Testy i narzędzia

- Czyste moduły (`node --test "tests/*.test.mjs"`): `fitPlanner` (niezmiennik, determinizm, symetria przy brakach,
  zastępstwa, tryb `buy` bez zastępstw, zamiana typów gniazd, gniazda zniszczone), `priceFit` (posiadane = 0 CR, braki po
  cenach portu, port bez składników), `fitStats` (profil UNIWERSALNEJ i kart = tabela § 4.2), `shipModules` (tarcza,
  zasięg tylko klasy snajperskiej, sufit), klasa snajperska (zasięg ≥ 6,5 km, DPS poniżej zwykłej broni tego rozmiaru),
  zapis (`weaponStock`, `partStock`, `kitsGranted`, migracja ze starego zapisu, odtwarzanie po `id`).
- W grze: `scripts/webgpu/wyposazenie-gra.mjs` (CDP, gra swobodna — `sc_story_campaign = '0'` przed nawigacją): otwarcie
  stacji, zrzuty kart i refit ręcznego w 1920×1080 i 1280×720, zastosowanie każdej karty (liczniki broni per typ gniazda,
  `rangeOf` i okrąg HUD), F5 → ten sam fit i magazyn, czas klatki przy ZASTOSUJ, błędy konsoli.
- Makieta: `dema/fitowanie-koncept.html` — do oceny układu przed etapem 4. Zrzuty skryptem CDP na WŁASNYM serwerze
  (`startVite` z `dema/rdzen-cdp.js` — bez HMR i obserwowania plików): współdzielony Vite (5199) przeładowuje stronę,
  gdy inna sesja zmieni moduł z jej grafu (makieta importuje `weapons.js`) — w połowie scenariusza stan wraca do startu.
