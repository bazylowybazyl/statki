# BRIEF — drednot klasy VII „pokroju Eclipse” (2026-10-21)

Stan: **projekt do decyzji, nic nie wdrożone.** Użytkownik wybrał 2026-10-21 skalę 5–6 km (3× Atlas) i poprosił
o brief: gniazda, mechaniki, co nowego trzeba zbudować. Reszta to rekomendacje — otwarte punkty w § 12. Liczby gry
sprawdzone w kodzie 2026-10-20/21 (odnośniki przy liczbach); liczby drednota to start do strojenia w grze.

## 1. Cel

Największy okręt gry i przeciwnik, z którym walka jest **rozbiórką, a nie zbijaniem paska HP**. Gracz czyta, gdzie jest
bezpiecznie (geometria zagrożenia, § 4.5), schodzi z osi zapowiedzianego superlasera, odcina baterie, generatory
i projektory, a na końcu patrzy, jak kadłub na silniku belek pęka na kawałki. Wzorzec: Eclipse (Star Wars Legends) —
superlaser w osi, setki dział, blokada skoku, promienie ściągające — przycięty do skali, którą gra uniesie.

Gdzie: boss misji kampanii i flagowiec jednej strony w scenie „Wojna” (§ 10, etap E7).

Poza zakresem:
- **okręt gracza** — jak z Gungnirem („zbyt potężna na special slot”, 2026-10-20) superbronie zostają przy NPC; najwyżej
  później jednostka floty gracza na rozkazy (tryb FLOTA);
- **skala 1:1** (17,5 km) — § 3; może żyć w obrazie głębi sceny „Wojna”;
- **nowy tryb celowania w podsystemy** — dawny namiar na podsystemy usunięto decyzją użytkownika (reguła `bron-gracza`);
  urządzenia drednota trafia się tam, gdzie leżą (§ 5.3).

## 2. Decyzje i kontekst

- 2026-10-21 — skala 5–6 km (3× Atlas), brief w `docs/`.
- 2026-10-21 — drabina klas z mostka i rdzenia I–VI przyjęta (`docs/PROPOZYCJA-KLASY-MOSTEK-RDZEN.md`) i wdrożona
  w kreatorze (`src/data/shipClasses.js`). Drednot to **klasa VII ponad drabiną, tylko NPC** (tak jak Atlas jest
  unikatem klasy VI).
- 2026-10-20 — Gungnir (`death_ray`): wbudowana wieża Colossusa TN, `npcOnly`, jeden cel. Superlaser drednota stoi na
  jego module (§ 5.1).

## 3. Skala i kadłub

Eclipse w kanonie: ~17,5 km; superlaser osiowy, 550 ciężkich dział laserowych, 500 turbolaserów, 75 dział jonowych,
10 projektorów studni grawitacyjnej, 100 promieni ściągających — razem ~1 125 luf.

| | Atlas | Colossus TN | **Drednot** | Eclipse 1:1 |
|---|---|---|---|---|
| Długość | 1,7–1,8 km | 1,54–1,56 km | **5,4 km** | 17,5 km |
| Powierzchnia | 0,67 mln j² | 0,72 mln j² | **~6 mln j²** | ~60 mln j² |
| Węzły belek (komórka 15 j.) | 3 121 | ~3 200 | **~27 tys.** | ~270 tys. |
| Sprite (gęstość) | ~2,1 px/j. | 1 672 px (1,07 px/j.) | **6–8,2 tys. px (1,1–1,5 px/j.)** | ≥ 19 tys. px przy 1,1 px/j. — ponad minimum WebGPU 8 192 |
| Udział w szerokości kadru 9 km (domyślny kadr Atlasa) | 20% | 17% | **60%** | 194% |
| Gniazda | 45 | 56 | **67 + 7 urządzeń** | ~1 125 luf |

Skala 1:1 to ~100× węzłów Atlasa i sprite ponad limit tekstury — wykonalne tylko jako „poziom” z segmentów budzonych
przy graczu (jak kawałki bazy piratów), osobny duży projekt. 3× Atlas mieści się jako jedno ciało: największe dziś ciało
gry to wieża habitatu z ~13 tys. węzłów.

Kadłub (start do strojenia):

| Parametr | Drednot | Odniesienie |
|---|---|---|
| Profil | `HULL_RENDER_PROFILES.dreadnought = { length: 9000, radius: 1500 }` → 5 400 × ~1 800 j. | `HULL_RENDER_WORLD_SCALE` 0,6 (`src/data/ships.js`) |
| Kształt | sztylet: wąski dziób z emiterem, szerokie śródokręcie, rufa z wieżą mostka i 8 dyszami MAIN | |
| Masa | ~1,6 mln | Colossus 200 tys.; w górnych klasach TN masa rośnie prawie liniowo z powierzchnią |
| Prędkość maks. | 220 j/s | Colossus 380, Atlas 500 |
| Obrót | 3°/s, przyspieszenie kątowe 1,5°/s² (90° w ~30 s) — nowy wpis w `SHIP_FLIGHT_SPECS` | superkapitał 15°/s (10°/s²), Atlas 18°/s (`src/data/shipFlightSpecs.js`) |
| Kadłub | 600 000 | Colossus i Atlas 85 000, megafrachtowiec 160 000 |
| Tarcza | 4 sektory × 60 000 (§ 5.4) | Colossus 52 000 |
| Promień encji | ~2,7 km (`createHull` nadpisuje: najdalszy węzeł + komórka) | czyta go kamera, mgła wojny, radar (§ 7.3) |

Sufit konstrukcji (`src/game/hullIntegrity.js`: maks. HP spada z udziałem żywych węzłów) działa sam — odcięta sekcja
obniża maks. HP, więc rozbiórka ma skutek bez nowego kodu.

Klasa VII obok tabeli klas (`SHIP_CLASSES` i `CORE_LEVELS` w `src/data/shipClasses.js`; VI: 900 tys. j², 60 gniazd
(32 ciężkie), R6 = 1 150 MW):

| Klasa | Wzór | Limit powierzchni | Limit gniazd (ciężkich) | Broń do | Rdzeń |
|---|---|---|---|---|---|
| VII Drednot (tylko NPC) | ten brief | 7 mln j² | 80 (48) | Capital + superbroń wbudowana | R7 ≈ 4 800 MW |

R7 ze wzoru `shipClasses.js`: utrzymanie kadłuba 0,07 · 6 mln^0,6 ≈ 820 MW + tarcza 0,5 × utrzymanie ≈ 410 MW + broń
z § 4.2 (`energyCost`, wyrzutnia 2 MW) ≈ 2 590 MW, w tym superlaser 1 000 — pobór ~3 820 MW, z zapasem 20% ~4 800 MW
(~4× R6). Uwaga: `SHIP_CLASSES` rządzi edytorem gracza (`SHIP_CLASS_MAX`, `coreLevelMax`) — klasa VII nie może do niej
trafić wprost: osobny wpis tylko NPC albo pole `npcOnly` z filtrem w kreatorze.

## 4. Gniazda

### 4.1 Bateria = jedno gniazdo gry

- Jedno gniazdo = jeden wybór celu, jedno przeładowanie, ginie z kadłubem pod sobą (`markHardpointDestroyed`
  w `index.html`). W obrazie strzela z kilku luf: u gracza `barrelsPerShot` (Yamato: 3) to kolejka luf, każda lufa to
  osobny pocisk (`queueSalvoBarrels`, `src/game/weaponController.js`). NPC strzela dziś JEDNYM pociskiem na strzał
  niezależnie od `barrelsPerShot` (`fireWeaponCore` nie ma kolejki luf) — Yamato NPC to 170 DPS, nie 510. Salwa NPC
  z tej samej kolejki to mała nowa rzecz (§ 9); luf nie mnożyć ponad tabelę, bo każda to pocisk w `bullets`.
- Reszta „setek dział” Eclipse'a to detal sprite'a i modelu (wieżyczki-dekoracje), nie gniazda.
- Dlaczego tak mało: w audycie bitwy 6 superkapitałów (+153 działa, +60% węzłów) kosztowało −40–45% fps (+0,94 ms na
  krok, +1,8–3,4 ms na klatkę; pomiar sprzed partii wież 3D z 2026-10-07). Drednot ma tyle gniazd co ~2,5 superkapitału.

### 4.2 Lista gniazd

| Grupa | Gniazdo | Szt. | Broń na start | Zasięg | Łuk | Lufy |
|---|---|---|---|---|---|---|
| Superlaser osiowy „Ragnarök” | builtin Capital | 1 | **nowa** `superlaser_axis` (§ 5.1) | 16 km | oś kadłuba ±1,5° | 1 |
| Ciężkie baterie burtowe | special Capital | 12 (6 na burtę) | `special_yamato_cannon` (850 × 3 lufy co 5 s) | 7 km, **minimum 1,5 km (nowe)** | **120° w burtę (nowe)** | 36 |
| Baterie średnie | main L | 16 (6 + 6 w burty, 4 w rufę) | `helios_lance_l` × 8 (6 km), `heavy_autocannon_l` × 8 (3,6 km) | 3,6–6 km | 180° (jak dziś) | 16 |
| Baterie jonowe | special L | 6 (3 na burtę) | **nowa** `ion_battery` (§ 5.6) | 6 km | 180° | 6 |
| Obrona punktowa | aux | 14 (4 dziób, 6 śródokręcie, 4 rufa) | `ciws_mk2` × 8 (2,2 km), `flak_l` × 6 (3,6 km) | 2,2–3,6 km | 180° | 14 |
| Wyrzutnie | missile | 6 | `siege_torpedo` × 4 (8 km, w dziób), `missile_rack` × 2 (12 km) | 8–12 km | — | 6 |
| Hangary | hangar | 8 (4 na burtę) | eskadry: 2 przechwytujące, 2 wielozadaniowe, 2 bombowe, 2 torpedowe | — | — | — |
| Promienie ściągające | special L | 4 (2 na burtę) | **nowa** `tractor_beam` (§ 5.5) | 3 km | 180° | 4 |

Razem **67 gniazd**: ciężkie (main + special + hangar + builtin) 47, lekkie (aux + missile) 20 — w limicie klasy VII.
Nowe bronie są `npcOnly` (jak `death_ray`).

Dziś NPC dostaje JEDNĄ broń na typ gniazda: `defaultNpcLoadout` kadłuba plus loadout frakcji (`equipNpcWeapons`
w `index.html`), a `selectSpecSlots` (`src/game/npcWeaponSpec.js`) uzbraja najwyżej `spec[typ]` gniazd. Typ bez wpisu
zostaje pusty — Colossus ma uzbrojone 33 z 56 gniazd (special i hangary puste). Drednot potrzebuje wpisu dla każdego
typu i nowego pola `weapon` w gnieździe edytora — mieszanki w jednym typie (średnie, PD, wyrzutnie) inaczej się nie da.

### 4.3 Urządzenia i strefy (cele bez broni)

| Cel | Szt. | HP | Skutek zniszczenia |
|---|---|---|---|
| Emiter superlasera (gniazdo builtin) | 1 | 40 000 | koniec superlasera; ≥ 15 000 obrażeń w czasie ładowania przerywa strzał |
| Generator tarczy sektora | 4 | 25 000 | sektor bez tarczy do końca walki |
| Projektor studni grawitacyjnej | 2 | 30 000 | studnia gaśnie, gdy padną oba |
| Mostki (strefy) | 3: główny + 2 pomocnicze | jak dziś (komórki strefy) | § 5.3 |
| Rdzenie reaktora (strefy) | 2 | jak dziś | wybuch sekcji, −15% maks. HP, przeładowania × 1,5 |
| Zbiorniki paliwa | 4 | — | łańcuch śmierci (§ 5.9) |
| Dysze MAIN / SIDE | 8 / ~12 | — | `mainEngineFraction` < 0,5 → obrót i prędkość × 0,5 |

### 4.4 Rozkład na kadłubie

Oś u: rufa −0,5 → dziób +0,5; oś v: lewa burta −0,5 → prawa +0,5. Pozycje wpisuje się w edytorze gniazd
(`SHIP_EDITOR_DEFAULTS`, `src/data/hardpointEditorDefaults.js`).

- **Dziób** (u 0,30…0,50): emiter na osi (u 0,48), 4 wyrzutnie torped (u 0,30–0,38, v ±0,12), 4 PD na krawędziach,
  generator sektora dziobu (u 0,32, oś).
- **Śródokręcie** (u −0,25…0,30): 12 ciężkich baterii na krawędziach (v ±0,40…0,45, co ~0,08 długości), 12 średnich
  w rzędzie wewnętrznym (v ±0,25), 6 jonowych (u −0,05…0,10, v ±0,30), 8 hangarów w burtach (u −0,20…0,05),
  4 promienie (u 0,10 i −0,15, v ±0,42), 2 projektory na grzbiecie (u 0,05 i −0,10), 2 wyrzutnie rakiet (u 0,20,
  v ±0,05), generatory burt (u 0, v ±0,15), 2 mostki pomocnicze (u 0,15, v ±0,18), 2 rdzenie (u −0,15, v ±0,10), 6 PD.
- **Rufa** (u −0,50…−0,25): wieża mostka głównego (u −0,30, oś), 4 średnie strzelające w rufę, 4 PD, generator sektora
  rufy, 4 zbiorniki (u −0,38, v ±0,10 i ±0,25), 8 dysz MAIN.

### 4.5 Geometria zagrożenia (wynik rozkładu)

| Kierunek od dziobu | Co strzela | Potencjał (100% trafień) |
|---|---|---|
| Dziób ±30° | superlaser (co 75 s), 4 torpedy, 4 PD | superlaser 100 000 na strzał, torpedy ~230 DPS |
| Burta 30°–150° | 6 ciężkich, 6 średnich, 3 jonowe, 2 promienie, PD | ciężkie ~3 060 DPS z salwą NPC (dziś ~1 020) + średnie ~370 + jony (tarcza × 3) |
| Rufa ±30° | 4 średnie, 4 PD | ~250 DPS |
| Przy kadłubie (< ~500 j.) | PD, średnie, promienie | ciężkie milczą |

- **Burta zabija.** Atlas (85 000 kadłuba + 52 000 tarczy) pod pełną burtą z salwą NPC (~3 430 DPS) ginie w ~40 s przy
  100% trafień, bez salwy (~1 390 DPS) w ~100 s — burtę się przecina, nie stoi się w niej. Dla porównania: Atlas
  (15 × railgun Mk II + 6 × Yamato, salwy gracza) ma ~3 400 DPS potencjału, czyli jedna burta drednota z salwą to cała
  bateria Atlasa.
- **Rów przy kadłubie.** Ciężka bateria ma łuk 120° i minimum 1,5 km. Okręt 300 j. od burty jest w łuku tylko baterii
  leżących ±520 j. wzdłuż kadłuba (300 · tg 60°), a te są bliżej niż 1,5 km — milczą. Lot wzdłuż kadłuba = tylko PD,
  średnie i promienie, za to ryzyko zderzenia z 5-kilometrowym kadłubem na belkach. Rów z Gwiazdy Śmierci wynika
  z liczb, bez skryptu.
- **Rufa jest najsłabsza**, dlatego AI trzyma burtę do wroga (§ 6), a eskorta osłania rufę.
- **Krąg.** Okręt krążący wokół drednota z prędkością v w odległości R ma prędkość kątową v / R. Atlas (500 j/s):
  6 km → 4,8°/s, 10 km → 2,9°/s, 16 km → 1,8°/s. Drednot obraca się 3°/s, więc oś superlasera dogoni krążącego Atlasa
  dopiero od ~10 km. Z bliska groźna jest burta (i ratuje rów), z daleka superlaser — gracz sam wybiera dystans i ryzyko.
- Czas walki (start strojenia): drednot ma 600 000 + 240 000 tarczy; sam Atlas z ~3 400 DPS potrzebuje ~4 min przy
  100% trafień (realnie 6–8), z flotą TN 2–3 min. Rozbiórka skraca walkę (rdzenie −2 × 15% maks. HP, sufit konstrukcji).

## 5. Mechaniki

### 5.1 Superlaser osiowy „Ragnarök”

Rozszerzenie promienia śmierci (`src/game/deathRay.js`: rzaz `HullBodies.cutSegment` z pędem, przebicia, tarcza pada do
zera, obraz przez rekordy `RAY_*` strumienia rozkazów). Różnica: **nie ma wieży** — kierunek strzału to oś kadłuba,
celuje cały okręt.

| Pole | Superlaser | Gungnir |
|---|---|---|
| `baseDamage` | 100 000 — zabija superkapitał i Atlasa | 20 000 — zabija pancernik |
| `baseRange` | 16 km — mniej niż wzrok Atlasa (18 km), więc gracz zawsze widzi strzelca | 12 km |
| `chargeTime` / `cooldown` | 12 s / 75 s | 4 s / 45 s |
| `penetration` | 3, bez `singleTarget` (linia okrętów to cel) — do decyzji, § 12 | 2, `singleTarget` |
| `deathRay.width` / `cutHalfWidth` / `frontSpeed` | 300 / 110 / 40 000 | 150 / 55 / 30 000 |
| nowe `axisFixed` | wylot z emitera, kierunek = oś kadłuba w chwili strzału | — |
| `energyCost` | 1 000 | 400 |

Fazy: wybór celu → obrót kadłuba → ładowanie, gdy cel jest w stożku ±8° od osi → strzał W OŚ (nie w cel: kto zejdzie
z osi w czasie ładowania, przeżyje) → stygnięcie.

Zapowiedź (bez niej superlaser jest niesprawiedliwy):
1. linia osi na płaszczyźnie gry od emitera do 16 km — od wyboru celu słaba, w ładowaniu narasta i pulsuje, ostatnie 2 s
   jaskrawa; idzie za kadłubem, więc widać, kiedy oś wchodzi na gracza;
2. HUD: „SUPERLASER — ZEJDŹ Z OSI” z odliczaniem, gdy gracz jest w pasie osi (szerokość wiązki + 300 j.);
3. radar: klin osi (rekord w `radarFeed.collect`);
4. dźwięk ładowania narastający do strzału.

Wybór celu: wartość = waga klasy (superkapitał i Atlas 1,0, lotniskowiec 0,9, pancernik 0,5, reszta 0) × (1 + 0,5 ×
liczba dalszych wrogów w pasie osi w zasięgu). AI lubi linie — gracz uczy się nie ustawiać floty gęsiego.

Przerwanie: ≥ 15 000 obrażeń w emiter w czasie ładowania → strzał przerwany, przeładowanie +20 s; trafienie jonowe
w emiter → ładowanie +4 s. Zniszczony emiter albo odcięty dziób (Hexlance, Gungnir, rozpad) = koniec superlasera.

Atlas w osi: 100 000 > 85 000 kadłuba — ginie. Rekomendacja: ratunek w postawie TARCZE (pole nie pada do zera, tylko
pochłania 40%, Atlas przeżywa z ~25 000) — do decyzji, § 12. Dziś promień zeruje tarczę zawsze (`collapseShield`
w `index.html`), a postawa TARCZE zmienia tylko twardość na przebicie i przyjmowane obrażenia (`shieldTaken` 0,65).

Stan w kodzie (2026-10-21):
- Promień NPC leci od wylotu wprost w cel — kąt wieży to tylko obraz (`fireDeathRayCore` w `index.html`). `axisFixed`
  zamienia kierunek na oś kadłuba.
- Ładowanie (`stepNpcWeaponCharge`, `src/ai/capitalAI.js`) strzela, gdy błąd celowania < 0,03 rad (~1,7°), i gubi
  ładunek po 2 s bez celu. Przy osi błąd = kąt między osią kadłuba a celem.
- Żaden kod nie obraca kadłuba, żeby wycelować stałą broń. Jest `resolveWeaponFacingBias` (dziób czy burta — wg liczby
  gniazd main i special w łuku): hak dla trybów LINIA i SUPERLASER (§ 6).
- Wybór celu promienia to dziś najbliższy pancernik albo niszczyciel; superlaser dostaje własną ocenę (wyżej).
- **Błąd naprawiony 2026-10-21** (dotyczył też gry): utrata dowolnego gniazda NPC (`markHardpointDestroyed` ustawia
  `_weaponsInit = false`) przebudowywała wszystkie wieże w `initAutonomousWeapons` z przeładowaniem losowanym 0–2 s
  i pełną amunicją — zestrzelona wieża zerowała 45 s Gungnira Colossusa i dolewała rakiet. Teraz działo, które zostało
  (to samo gniazdo i ta sama broń), wraca tym samym wpisem: przeładowanie, amunicja, ładowanie, cel i kąt lufy bez zmian
  (test `tests/npcWeaponRebuild.test.mjs` na prawdziwej funkcji z `index.html`).

### 5.2 Łuki wroga na HUD-zie i martwe strefy

- Łuk gniazda w danych: nowe pole `arc` (stopnie) w `SHIP_EDITOR_DEFAULTS`. Dziś łuk wynika z typu gniazda (`MOUNT_ARCS`,
  `mountFireArc` w `src/game/weaponAim.js` — ten sam model u gracza i NPC). Ciężkie baterie: 120°.
- Minimalny zasięg: nowe pole `minRange` broni albo gniazda; ciężkie baterie 1,5 km. Wybór celu wież pomija cele bliżej.
- HUD: przy celu priorytetowym klasy VII i do 12 km — sektory ognia drednota na płaszczyźnie gry (czerwone, grubość =
  suma DPS żywych gniazd w danym kierunku), na wzór kompasu łuków gracza (`drawArcCompass`). Zniszczona bateria = mniej
  czerwieni, więc gracz widzi postęp rozbiórki.

### 5.3 Rozbiórka

- Gniazda giną z kadłubem pod sobą — działa dziś (`isHullPointSupported` → `markHardpointDestroyed`): żaden z 5 punktów
  próby (środek i krzyż ±14 j. × skala) nie ma żywego węzła przez 2 kolejne sprawdzenia co 0,08 s. Każde stracone gniazdo
  zdejmuje max(2, maks. HP × 0,14 / liczba gniazd) z kadłuba z pominięciem tarczy — u drednota (67 gniazd + 7 urządzeń) ~1 100–1 250. Lekkie działa
  wgniatają, baterię zdejmuje ciężka broń.
- **Urządzenia z punktami życia** — nowy typ gniazda `device` z polem `device: 'emitter' | 'shieldGen' | 'gravWell'`:
  obrażenia z trafień w promieniu urządzenia (80–120 j.), z kraterów i rzazów; giną też z kadłubem pod sobą.
- Celowanie bez nowego trybu: grupa w ręku bije w kursor, więc precyzyjnie w urządzenie. Wieże gracza na auto przy celu
  klasy VII mierzą w najbliższe żywe gniazdo albo urządzenie w swoim łuku, a nie w środek kadłuba (środek 5-kilometrowego
  celu bywa poza łukiem i zasięgiem).
- Mostki: kilka mostków na okręcie działa dziś (strefy w tablicy, `src/game/shipBridge.js`; Atlas ma główny i zapasowy;
  mostek ginie po utracie 35% komórek, dowodzenie pada, gdy zginą wszystkie — reguła `'all'`). Nowe: skutek utraty
  GŁÓWNEGO — baterie na „lokalnym sterowaniu” (rozrzut × 2, zmiana celu co 3 s, superlaser bez wyboru celu — strzela
  tylko, gdy coś stoi w osi); pole `role` strefy jest dziś tylko opisem. Padną wszystkie trzy → hulk (`isBridgeHulk`):
  tarcza 0, AI i lot stoją; dziś po 4 s `finishBridgeKill` robi wrak BEZ wybuchu reaktora — drednot zamiast tego wchodzi
  w upadek (§ 5.9).
- Rdzenie: miejsca komór to tablica na kadłub (`REACTOR_CORE_MARKERS` w `src/data/reactorCores.js` — Atlas, cała flota
  TN i Iron Skull; reszta z automatu), ale w praktyce każdy kadłub ma jedną komorę, a `cores[]` z edytora biorą górę
  tylko z promieniem `r`. Detonacja rdzenia robi z okrętu wrak (`src/game/reactorCoreGame.js`). Od 2026-10-21 reaktor
  stoi na kadłubie w obudowie (`src/3d/reactor3D.js`; poziom `tier` i rodzaj modelu w markerze), a pokrywa traci płyty
  razem z komorą — u drednota dwie obudowy to cele widoczne gołym okiem. Nowe dla klasy VII: 2 komory w markerze,
  zniszczona → wybuch w sekcji, −15% maks. HP, przeładowania × 1,5 (zamiast wraku); obie → upadek.
- Silniki: dziś `mainEngineFraction` (`src/game/engineDamage.js`) skaluje u NPC tylko przyspieszenie do przodu — prędkość
  maks. i obrót od niego nie zależą. Nowe dla klasy VII: ułamek < 0,5 → obrót i prędkość × 0,5, więc superlaser nie
  nadąża za celem.

### 5.4 Tarcza sektorowa

- 4 sektory wg kąta punktu trafienia względem osi: dziób ±35°, rufa ±35°, burty po 110°. Każdy ma 60 000 i regenerację
  500/s po 6 s bez trafienia; zasila go generator — zniszczony generator = sektor bez tarczy do końca walki.
- Test przebicia (`isShieldBreachedAt`) i podział obrażeń tarcza / kadłub liczą sektor trafienia.
- Obraz: obrys tarczy z jasnością sektora (zgaszony sektor ciemny); HUD: 4 segmenty przy znaczniku celu. AI i HUD,
  które czytają „% tarczy”, dostają sumę sektorów.

Stan w kodzie i co zmienić (sektorów nie ma nigdzie):
- Tarcza NPC to `npc.shield = { val, max, regenRate, regenDelay, regenTimer }`; kształt to profil biegunowy r(θ)
  z komórek kadłuba (`shieldSystem.js` w korzeniu repo), nie elipsa — sektory po kącie θ pasują do niego wprost
  (`shieldGridAngleTowards`).
- Obrażenia idą dwiema drogami: `applyDamageToNPC` (wiązki, rakiety, bomby, flak, wybuchy — trzeba dodać punkt trafienia,
  np. `opts.at`) i pociski odejmujące tarczę w pętli kolizji (`index.html`). Do tego `collapseShield` (promień śmierci),
  śmierć mostka i zerowanie z fabuły.
- `val` = suma sektorów, więc AI (`updateCombatPressure`, kierowanie ogniem), HUD kokpitu, CIC i lista floty działają bez
  zmian. Blokowanie jest dziś na encję (`isEntityShieldBlocking`); zgaszony sektor przepuszcza przez gałęzie przebicia
  (pociski, wiązki, rakiety).
- Regeneracja NPC: `npcStep`. Stan obrazu przechodzi w „breaking” dopiero przy `val` = 0 — sektor potrzebuje własnego.
- Obraz: trafienia są już lokalne (sektor pod ogniem świeci i pęka sam), ale rozpad, odrost i „życie” pola są na cały
  slot puli (12 slotów, `src/3d/shield/shieldPool.js`). Trzeba bramkować je kątem kafla i dodać wyzwalacz rozpadu
  sektora; miejsce jest (`SLOT_VEC4` ma wolny indeks 11, wolne `HARD.w` i `MISC.z`). Stan sektorów do renderu idzie
  całym łańcuchem migawki (pola `SH_*` w `snapshotLayout`, `_packEntity`, lustro, test).
- Test przebicia `isShieldBreachedAt` działa tylko dla tarczy z kaflem w puli (na ekranie ≥ 9 px) — dla 5-kilometrowego
  kadłuba zawsze.

### 5.5 Promienie ściągające

- 4 emitery, zasięg 3 km; cel: okręty do superkapitału (Atlas też); jeden emiter = jeden cel, trzyma ≤ 15 s, potem
  10 s przerwy.
- Siła działa na ENCJĘ (gra całkuje ruch encji, węzłów się nie rusza): przyspieszenie celu ku „kieszeni” 2 km od burty
  (w zasięgu ciężkich, poza ich minimum), najwyżej 250 j/s² — więcej niż ciąg Atlasa (~150 j/s²: 0 → 500 j/s
  w 3,3 s), więc samym ciągiem się nie wyrwie.
- Wyrwanie: szarża F (`RAM_ATLAS` w `src/data/shipSystems.js`: 3 000 j/s, 1 100 j/s² dodawane wprost do prędkości,
  5 s, ładowanie 28 s) — siła potrzebna do trzymania przekracza `breakForce` wiązki i wiązka pęka; zniszczenie emitera;
  wyjście z łuku albo zasięgu; maskowanie (I) — cel znika z wiązki.
- HUD: „PROMIEŃ ŚCIĄGAJĄCY — SZARŻA (F)”; obraz wiązki to receptura efektu.
- Kod: wiązka = lina `TowConstraintSystem` (`src/game/towSystem.js`, dziś hol złomu i sprzęgi megafrachtowca): lina
  ciągnie dopiero po rozciągnięciu ponad `length` (długość = odległość kieszeni), impuls przez masy encji, `maxForce`
  = masa celu × 250 j/s², `breakForce` z `onBreak` = zerwanie, `positionCorrection: 0` (bez przesuwania pozycji).
  Holownik serwisowy się nie nada — wozi ładunek kinematycznie (`setPose`). Uwaga: model lotu NPC tnie prędkość ponad
  limit (`stepShipFlight`) — ciągnięty NPC potrzebuje flagi obejścia jak `__warpExitSlide`.

### 5.6 Baterie jonowe i efekt jonowy

- `ion_battery`: special L, 6 km, 320 obrażeń co 3 s; tarcza × 3, kadłub × 0,2.
- Przeciążenie przy trafieniu kadłuba: gniazda w promieniu 250 j. milkną na 4 s (u gracza nowy stan wieży w celowniku,
  np. `FC_TURRET.ION`), regeneracja tarczy wstrzymana na 4 s, trafienie przy dyszach → ciąg × 0,5 na 3 s. Najwyżej jedno
  przeciążenie na cel co 2 s — bez stałego paraliżu.
- Do decyzji: ten sam efekt dla Tempest Ion gracza (dziś zwykły rail z wyglądem jonu).
- Stan w kodzie: żadnego wyłączania na czas nie ma (jon, EMP, ogłuszenie). Łuki EMP Tempest Iona to sam obraz.
  `combatDisabled` znaczy „uśpiony / niewalczący” i broni nie wycisza. Haki: wieże NPC — początek
  `processAutonomousWeapons` (`src/ai/capitalAI.js`, licznik per gniazdo); silniki — `shutdownEngine` / `igniteEngine`
  (`src/game/engineIgnition.js`); wieże gracza — stan w kierowaniu ogniem (`src/game/fireControl.js`).

### 5.7 Studnia grawitacyjna

- Promień 22 km od drednota (zasięg superlasera + 6 km): nikt nie wejdzie w warp ani w TRAVEL TO, odloty i wezwania
  wsparcia czekają; okręt w warpie, który przetnie granicę, wypada na brzegu z pędem (wyjście z warpa z pędem —
  „wyrwany z nadprzestrzeni”). Komunikat: „STUDNIA GRAWITACYJNA — SKOK ZABLOKOWANY”.
- 2 projektory; studnia działa, póki żyje choć jeden. Zgaszenie = komunikat i ruch kolejki wezwań — przylot floty jest
  nagrodą za rozbiórkę.
- Obraz: pierścień granicy na radarze i mapie CIC; na płaszczyźnie gry najwyżej delikatna refrakcja brzegu przy kamerze.

Stan w kodzie — zagłuszanie już jest, bez zasięgu:
- `storyInterdictWarp()` (`index.html`, w fabule `api.nav.interdict`, `src/game/story/storyGame.js`): okręt w warpie →
  `triggerGravityWarpBrake` (twarde wyjście z hamowaniem — ta sama funkcja co strefy grawitacji planet), ładowanie →
  przerwane z komunikatem „WARP: ZAKŁÓCANY”, do tego `cancelTravel` (inaczej TRAVEL TO ładowałby w kółko). Zagłuszacz
  misji 2 woła to co krok, bez sprawdzania odległości. Studnia = to samo z rejestrem źródeł i promieniem.
- Odmowa wejścia: `startManualWarpCharge`, faza „align” TRAVEL TO i `tugCarryWarpStart`; zbiorczo gałąź „charging”
  w `physicsStep` (wzór: przerwanie przy zniszczonym napędzie). Funkcji typu `warpBlockReason` nie ma — komunikaty są
  pisane w miejscu.
- Wyrwanie z lotu: gałąź „active” w `physicsStep` → `triggerGravityWarpBrake('interdict')`; test ODCINKA kroku
  (`segmentCircleEntry`, `src/game/travelNav.js`), bo w warpie okręt przelatuje tysiące jednostek na krok. Planer
  TRAVEL TO (`getCruiseGravityObstacles`, `planTravelLeg`) może traktować studnię jak studnię planety i ją omijać.
- NPC: wszystkie odloty idą przez jedno `warp.depart` w `createSupportReturn` (`src/game/supportWarp.js`) — tam
  wstrzymanie. Przyloty (`warpTraffic`) lecą po trasie zaplanowanej z góry, więc wezwanie wsparcia czeka w kolejce, aż
  studnia zgaśnie, a przylot w trakcie kończy się na brzegu (punkt końca trasy przycięty do pierścienia).

### 5.8 Hangary

- 8 hangarów, sufit 32 myśliwców drednota naraz; zniszczony hangar przestaje wypuszczać. Bombowce i torpedowe idą
  w największy okręt w zasięgu.
- Stan w kodzie (`updateNpcHangars` w `index.html`): liczba wyrzutni = żywe gniazda `hangar`, sufit = min(hangary, 5) × 4
  (dziś najwyżej 20), start, gdy wróg jest w 9 km, do 4 maszyn na cykl co 4,5–7 s, role z `CARRIER_WING_MIX`. Drednot
  potrzebuje tylko sufitu z kadłuba (nowe pole, np. `fighterCap: 32`) i miksu ról; uzupełnianie zostaje jak jest.

### 5.9 Upadek

- Śmierć: HP 0, oba rdzenie albo wszystkie mostki przy kadłubie < 25%.
- Sekwencja 8–12 s: zbiorniki wybuchają po kolei od miejsca ostatniego trafienia (`fuelTankBlast` × 4, co 0,8–1,5 s),
  na końcu rdzenie (fala). Kadłub pęka sam na belkach od impulsów — bez sztucznego cięcia (lekcja z odrzuconego
  pancerza, 2026-09-27). Sekcje dryfują i taranują eskortę.
- Dziś okręt ma dokładnie jeden zbiornik (`src/game/fuelTank.js` bierze `list[0]`; zbiornik wyznacza miejsce wybuchu
  śmierci i może pęknąć) — kilka zbiorników i łańcuch to nowa praca.
- Kamera: sygnał reżysera kadru (`noteCameraDirectorCue`) i oddalenie, żeby objąć kadłub.
- Wrak: sekcje → wraki (śpiące, potem zimne — `coldWrecks`), duży łup złomu (ekonomia „wojna = złom”).

## 6. AI drednota

- Lot: 220 j/s, obrót 3°/s, bez odwrotu.
- Tryb LINIA (domyślny): burta do głównej grupy wroga w 5–6,5 km (w zasięgu ciężkich, poza ich minimum), powolny marsz.
  Dziś superkapitał jedzie mózgiem pancernika (`aiBattleship`), bez trzymania burty, a dystans bierze z mediany zasięgu
  baterii głównej × osobowość 0,7 (`src/ai/capitalAiTuning.js`) — dla drednota wyszłoby ~3,4 km, w minimum ciężkich.
  Potrzebny własny dystans kadłuba i trzymanie burty (`resolveWeaponFacingBias` wybiera dziś tylko dziób albo burtę).
- Tryb SUPERLASER (§ 5.1): obrót dziobem, ładowanie, strzał, powrót do burty.
- Rów: wróg < 1 km od kadłuba dłużej niż 10 s → promienie ściągające i eskorta na niego.
- Eskorta: 2 pancerniki i 4 niszczyciele w szyku (reguła `flota-ai`), za rufą i przy dziobie — osłaniają martwe pola.
- Mózg pisze tylko zamiary (AI liczy się też poza krokiem fizyki); obrót do celu superlasera to zamiar kursu.

## 7. Obraz, kamera, radar

Nic nie pada przy ~27 tys. węzłów. Granice to rozmiar tekstury sprite'a, stała rozdzielczość slotów na kadłub (mapa ran,
cień SDF) i jednorazowe skoki czasu klatki.

### 7.1 Kadłub i tekstury

- Sprite 6 000–8 192 px wzdłuż (1,1–1,5 px/j.; Atlas 2,1, Colossus 1,07, holownik serwisowy 0,36). Tekstura gry to
  natywny sprite z pełnymi mipmapami, bez skalowania i bez limitu w kodzie (`createManagedTexture`,
  `src/3d/hexShips3D.js`); minimum `maxTextureDimension2D` w WebGPU to 8 192. Koszt: ~65–120 MB VRAM z mipmapami.
  Mapy pochodne mają sufity: powierzchnia 1 536 px, lakier 384, alfa cienia 1 024.
- Obraz fizyki to sprite przerysowany do rozmiaru renderu (5 400 × 1 800); `structureFor` (`src/game/hullBodies.js`)
  czyta go raz (~39 MB RGBA) na wątku gry przy spawnie — budować na ekranie ładowania (jak `ensurePrebuilt` bazy
  piratów). W trybie workera strona wysyła obie bitmapy w pełnym rozmiarze (limit czasu 3 s) — zmierzyć spawn.
- Nieznany id profilu cicho spada na `atlas` — wpis w `HULL_RENDER_PROFILES` jest obowiązkowy.
- Limity na kadłub: ≤ 64 lampy (`src/game/shipLightRuntime.js`), ≤ 20 stref dysz (`src/3d/hullLacquer.js`) — 8 MAIN
  i 12 SIDE to dokładnie sufit.
- Skąd kadłub: (A) obraz generowany jak reszta floty — od razu; (B) kreator z klocków w stylu TN — dopiero po etapie 3
  planu kreatora (`docs/PLAN-KREATOR-STOCZNIA.md`; kreator nie jest wpięty do gry, lista integracji
  w `docs/KREATOR-KADLUBA.md`). Format kreatora nie ma limitu długości, ale kompozytor obrazu ma sufit 4 096 px
  (~0,76 teksela/j. przy 5,4 km) — do podniesienia przy B. Rekomendacja: A teraz, B jako przebudowa później.
- Model 3D: automat ze sprite'a (`autoHull3D.js`, obrysy z `node scripts/webgpu/obrysy-floty.mjs`), bronie 3D w partiach.
- Mostki × 3 wg `docs/BRIEF-mostek-nowego-kadluba.md`.
- Wieżyczki-dekoracje (setki „dział” Eclipse'a) w sprite'cie i modelu, bez gniazd.
- Plan awaryjny przy limicie tekstury: kadłub z modułów z osobnymi sprite'ami jak skład megafrachtowca.

### 7.2 Mapa ran i cień

- Mapa ran: największy slot L (512 × 256 tekseli, kadłuby ≥ 900 j.) rozciąga się na cały sprite — drednot dostałby
  ~10,5 × 7 j. na teksel (Atlas ~3,5; cel 2–3,5), a sufit 48 stempli i 32 rozdarć na slot na klatkę gubi stemple pod
  ogniem floty. Naprawa: klasa XL jako pierwszy wiersz `DMG_CLASSES` (`src/3d/hullDamageMap.tsl.js`; np. 2 048 × 1 024
  → ~2,6 × 1,8 j. na teksel, 1–2 sloty); pula przelicza się sama, sprawdzić `DMG_JOB_CAP`.
- Cień SDF: teksel = dłuższy bok / 231, czyli ~23 j. (Atlas 7,5) — drobne wyrwy znikają z cienia. Wypiek rośnie z liczbą
  komórek (Atlas 2–4 ms przy budżecie 2,5 ms, najwyżej 2 wypieki na klatkę i jeden na sekundę na kadłub), więc wypiek
  drednota to rząd kilkudziesięciu ms. Potrzebny wypiek na raty i większa siatka dla klasy VII (`src/3d/hullShadowSdf.js`).

### 7.3 Kamera, radar, mgła wojny

- Kamera: reżyser kadru (`src/game/cameraDirector.js`) waży cel przez clamp(promień / 450, 0,3, 4) — drednot od razu ma
  sufit 4 i przejmuje środek kadru, gdy jest w zasięgu (9–20 km). Dolny zoom liczy się z długości gracza (≈ 0,064, kadr
  ~30 × 17 km przy 1920 × 1080), a pasy HUD zjadają wysokość, więc część kadłuba wypada z kadru. Dla klasy VII: kadr
  na część kadłuba najbliżej gracza, nie na środek; przy przylocie podać `hullLength` do sygnału (promień sygnału =
  połowa długości).
- Radar: kontakty po odległości środka, sylwetka w prawdziwym rozmiarze; id `dreadnought` ma już klasę SC
  (`src/ui/radar/radarConfig.js`). Do dodania tylko pierścień studni (§ 5.7).
- Mgła wojny: okręt widać, gdy środek jest w zasięgu wzroku + min(1 500, 0,5 · promień) (`src/game/fogOfWar.js`) — dziób
  drednota może wejść 1,35 km w pole widzenia, a okręt zostaje ukryty. Dla klasy VII test po obrysie (najbliższy punkt
  kadłuba). Świadomość AI: `isCapitalShip` (największy mnożnik rozmiaru, × 1,3).

### 7.4 Scena „Wojna”

- Klasa obrazu w głębi: wpis `WB_CLASSES` (`src/render/warBackdropPlan.js`), PNG w `SPRITES` i komórka w `ATLAS_CELLS`
  (`src/3d/warBackdrop/warBackdrop3D.js`; atlas 4 096 × 2 144 ma wolny pas na komórkę 1 536 × 512 — atlasu nie da się
  powiększyć po pierwszym wgraniu bez zmiany `ATLAS_W / H`). Pasma głębi skalują kadłuby do 3,6×, więc 5,4 km wygląda
  tam na ~19 km — Eclipse 1:1 „za darmo”. Klasy dłuższe niż 1 300 j. nie pojawiają się w paśmie bliskim.

## 8. Wydajność — budżet i pomiar

- Budżet: bitwa z drednotem i flotą TN ≤ +3 ms na klatkę względem tej samej bitwy bez drednota, 0 pipeline'ów
  synchronicznych.
- Pociski (z salwą NPC): ciężkie ~2,4 salwy/s × 3 lufy ≈ 7/s, średnie ~21/s, jonowe 2/s — ~30 pocisków na sekundę bez
  obrony punktowej; 8 × CIWS Mk II przy nalocie dokłada do ~160/s (jak u każdego okrętu z CIWS).
- Węzły: ~27 tys. w jednym ciele; trafienie rusza lokalnie (solver lokalny), w spoczynku ciało śpi. Pamięć ~650 B na
  węzeł (~17 MB ciała), sprite 65–120 MB VRAM.
- Jednorazowe skoki do usunięcia przed E1: spawn (odczyt obrazu fizyki), wypiek cienia SDF (§ 7.2), zamrożenie zimnego
  wraku — `src/game/coldWrecks.js` ma budżet 12 000 węzłów na klatkę, ale pierwszy wrak w klatce przechodzi zawsze,
  więc wrak 27 tys. węzłów zamarza w jednej klatce (~27–80 ms).
- Wieże NPC: każde gniazdo samo wybiera cel (w praktyce najbliższy dozwolony; bez skupiania ognia), przegląd co
  0,08–0,14 s (aux) albo 0,24–0,40 s (reszta), liniowo po wspólnej pamięci wrogów okrętu. 67 gniazd ≈ 300 przeglądów
  na sekundę. Broń powyżej 4,8 km poszerza pamięć do całej frakcji wroga — superlaser (16 km) jak Gungnir. Przed E1
  usunąć alokację w `pickTargetSubsystem` (tworzy i sortuje tablicę gniazd celu przy każdej zmianie celu).
- Pomiar: `scripts/profil-bitwy-flot.mjs` (scenariusz z drednotem) i nowe `scripts/webgpu/drednot-gra.mjs`; A/B czasami
  funkcji w tej samej bitwie, przebiegi po kolei.

## 9. Co trzeba zbudować

| # | Element | Stan dziś | Gdzie | Rozmiar |
|---|---|---|---|---|
| 0 | Utrata gniazda nie zeruje przeładowań i nie dolewa amunicji | **naprawione 2026-10-21** (§ 5.1) | `initAutonomousWeapons` (`src/ai/capitalAI.js`), test `tests/npcWeaponRebuild.test.mjs` | S |
| 1 | Kadłub: profil, sprite, mapa normalnych, gniazda, dysze, wpis lotu, mostki × 3, obrys i model 3D | nowy wpis (lista „Nowy kadłub” w `AGENTS.md`) | `src/data/ships.js`, `src/data/shipFlightSpecs.js`, `index.html`, `src/data/hardpointEditorDefaults.js`, `src/data/engineFx.js` | M |
| 2 | Broń per gniazdo (pole `weapon`) i loadout wszystkich typów | jedna broń na typ | `equipNpcWeapons`, `src/game/npcWeaponSpec.js` | S |
| 3 | Superlaser osiowy: `axisFixed`, zapowiedź (rekord strumienia rozkazów z linią osi), przerwanie, własna ocena celu | promień śmierci jest | `src/game/deathRay.js`, `src/data/weapons.js`, `src/ai/capitalAI.js`, `src/render/renderCommands.js` | M |
| 4 | Łuk gniazda w danych i `minRange` | łuk z typu gniazda | `src/game/weaponAim.js`, `src/ai/capitalAI.js`, `src/game/fireControl.js` | S |
| 5 | Łuki wroga na HUD-zie | kompas łuków gracza jest | HUD | S |
| 6 | Urządzenia z HP (`device`) | brak | obrażenia i integralność gniazd (`index.html`) | M |
| 7 | Wieże gracza na auto mierzą w gniazda celu klasy VII | mierzą w okręt | `src/game/fireControl.js` | S |
| 8 | Rola mostka głównego (lokalne sterowanie) | kilka mostków działa | `src/game/shipBridge*.js`, AI | S |
| 9 | 2 komory rdzenia, wybuch sekcji zamiast wraku | jedna komora z obudową na kadłub, detonacja = wrak | `src/data/reactorCores.js`, `src/game/reactorCoreGame.js`, `src/game/reactorCore.js` | M |
| 10 | Kilka zbiorników i łańcuch upadku zamiast wraku po 4 s | jeden zbiornik | `src/game/fuelTank.js`, śmierć okrętu, `finishBridgeKill` | M |
| 11 | Silniki klasy VII: obrót i prędkość z `mainEngineFraction` | tylko przyspieszenie | `src/game/flight/shipFlightModel.js` | S |
| 12 | Tarcza sektorowa | brak | tarcze, obrażenia, regeneracja, HUD, migawka, pula tarcz | L |
| 13 | Efekt jonowy i `ion_battery` | brak | wieże NPC i gracza, silniki, celownik | M |
| 14 | Studnia grawitacyjna | zagłuszanie z fabuły bez zasięgu | warp gracza, TRAVEL TO, `src/game/supportWarp.js`, `warpTraffic` | M |
| 15 | Promień ściągający i `tractor_beam` | lina holu jest | `src/game/towSystem.js`, model lotu NPC, obraz | M |
| 16 | AI drednota: LINIA / SUPERLASER, dystans kadłuba, rów, eskorta | mózg pancernika | `src/ai/capitalAI.js`, `src/ai/capitalAiTuning.js`, szyk floty | M |
| 17 | Sufit myśliwców z kadłuba | wzór min(hangary, 5) × 4 | `updateNpcHangars` (`index.html`) | S |
| 18 | Klasa VII (tylko NPC) przy tabeli klas, R7 | drabina I–VI w kreatorze | `src/data/shipClasses.js` | S |
| 19 | Drednot w scenie „Wojna”: flagowiec i Eclipse 1:1 w głębi | scena jest | `src/render/warBackdropPlan.js`, scena | S |
| 20 | Misja z bossem | brak | `src/game/story/missions/` | L |
| 21 | Salwa NPC (`barrelsPerShot` z kolejki luf) | NPC: 1 pocisk na strzał | `src/ai/capitalAI.js`, `queueSalvoBarrels` | S |
| 22 | Klasa XL mapy ran | slot L rozciągnięty | `src/3d/hullDamageMap.tsl.js` (`DMG_CLASSES`) | S |
| 23 | Cień SDF dużego kadłuba: wypiek na raty, większa siatka | jeden wypiek | `src/3d/hullShadowSdf.js` | M |
| 24 | Zimny wrak giganta na raty | pierwszy wrak w klatce bez budżetu | `src/game/coldWrecks.js` | S |
| 25 | Obraz fizyki na ekranie ładowania | odczyt przy spawnie | `structureFor` (`src/game/hullBodies.js`) | S |
| 26 | Mgła po obrysie, kadr na najbliższą część kadłuba | liczą od środka | `src/game/fogOfWar.js`, `src/game/cameraDirector.js` | S |

## 10. Etapy

| Etap | Co (wiersze § 9) | Po co |
|---|---|---|
| E0 | Drednot jako sam obraz w głębi sceny „Wojna” — w pasmach głębi wygląda na ~19 km (19, § 7.4) | ocena wyglądu i skali przy zerowym ryzyku |
| E1 | Kadłub z istniejącą bronią (1, 2, 17, 21), dystans kadłuba w AI (część 16), skoki i obraz (22–26), spawn z `DevScene`, pomiar wydajności (błąd 0 już naprawiony) | pierwszy grywalny „olbrzym z bateriami” |
| E2 | Superlaser osiowy z zapowiedzią i przerwaniem, tryb SUPERLASER (3, część 16) | sygnatura drednota |
| E3 | Rozbiórka: łuki i `minRange`, łuki na HUD-zie, urządzenia, celowanie w gniazda, mostek główny, rdzenie, silniki (4–9, 11) | walka = rozbiórka |
| E4 | Tarcza sektorowa i baterie jonowe (12, 13) | |
| E5 | Studnia grawitacyjna i promienie ściągające (14, 15) | |
| E6 | Upadek, wrak, złom, kamera (10) | nagroda |
| E7 | Flagowiec sceny „Wojna”, misja z bossem (19, 20) | |

Klasa VII (18) — kiedykolwiek, bez wpuszczania jej do edytora gracza.

Każdy etap kończy się oceną użytkownika w grze (feel, czytelność, czas walki).

## 11. Testy i narzędzia

- Testy (`node:test`): dane drednota (gniazda, limit klasy VII, `npcOnly`), oś superlasera (kierunek z osi, przebicia,
  przerwanie), podział sektorów tarczy, `isInterdicted` w każdym miejscu startu i lotu warpu, siła i zerwanie promienia
  ściągającego, liczniki przeciążenia jonowego.
- W grze: `scripts/webgpu/drednot-gra.mjs` — spawn drednota z eskortą przeciw flocie TN, fazy (linia, ładowanie, strzał,
  rozbiórka, upadek), zrzuty, czasy klatek (osobno: spawn, wypiek cienia, zamrożenie wraku), pipeline'y synchroniczne
  (0), oba tryby renderu (`off` i worker).
- Błąd z § 5.1: `tests/npcWeaponRebuild.test.mjs` — utrata gniazda nie zmienia przeładowań i amunicji pozostałych
  wież (jest od 2026-10-21).

## 12. Otwarte decyzje

1. **Frakcja i nazwa** — Terra Nova (np. „Dominus”, „Imperator”), piraci (zdobyczny, reaktywowany kadłub) czy trzecia
   siła. Superlaser roboczo „Ragnarök” (nordyckie nazwy superbroni: Gungnir, Mjolnir).
2. **Superlaser przebija linię** (3 okręty) czy jeden cel jak Gungnir. Rekomendacja: linia — to sedno geometrii zagrożenia.
3. **Superlaser a Atlas** — zabija w osi (rekomendacja: tak, z ratunkiem w postawie TARCZE) czy tylko ciężko rani.
4. **Kadłub** — sprite teraz (rekomendacja) czy czekać na kreator w grze (etap 3).
5. **Efekt jonowy dla gracza** — Tempest Ion dostaje przeciążenie czy zostaje zwykłym railem.
6. **Gdzie pierwszy raz** — misja kampanii czy scena „Wojna”.

## Aneks A. Wariant „Vengeance” (burtowiec)

Drugi archetyp na tej samej ramie danych: ~4 km, ~45 gniazd, bez superlasera. Ciężar w bateriach burtowych (łuki 120°
z obu burt), dziób z ciężkimi torpedami. Geometria odwrotna niż u drednota: śmierć z boku, luka na dziobie i rufie.
Pasuje do piratów (stary, reaktywowany kadłub). Robić po E3, gdy działają łuki w danych i urządzenia.
