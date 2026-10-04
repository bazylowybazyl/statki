# BRIEF — kierowanie ogniem i „ciężar” okrętu gracza (2026-10-01)

Stan: **wdrożone 2026-10-01** (etapy 0–3 z § 8 i broń specjalna klas S / M / L z etapu 4), zmierzone w prawdziwej
grze narzędziem `scripts/webgpu/ogien-gra.mjs` (§ 10). Użytkownik jeszcze nie grał. Sekcje 3–6 to analiza
sprzed wdrożenia (stan „dziś” = przed 2026-10-01); co jest w kodzie i co zostało otwarte — § 10 i § 9.
Dźwięk świadomie pominięty (decyzja użytkownika).

## 1. Cel

Gracz ma dowodzić okrętem, a nie obsługiwać piętnaście wież: baterie strzelają same, gracz ustawia okręt,
wskazuje cel i sam kładzie ciężkie salwy. Atlas ma być wolny i ciężki, a mniejsze jednostki mają pod jego
ogniem ginąć szybko. Wzorce: Starsector (grupy broni na auto, jedna w ręku), World of Warships (artyleria
pomocnicza sama, główna ręcznie).

## 2. Decyzje użytkownika (2026-10-01)

1. **LPM strzela** grupą „w ręku” (domyślnie broń specjalna), namiar idzie pod klawisz **T** (bez trzymania kursora).
2. **Prędkość bojowa Atlasa: limit 500 j/s** (do sprawdzenia w grze w przedziale 500–700).
3. **Każda klasa ma swoją broń specjalną**: fregata jedną małą, niszczyciel większą, pancernik jeszcze większą,
   kapitał to, co dziś. Do dopracowania (§ 6).
4. **Atlas startuje w pełni uzbrojony**, z Yamato w gniazdach special — zrobione (§ 7).
5. **Krótki dopalacz do miażdżenia** — system okrętu pod klawiszem F jak w Starsectorze, tylko na niektórych
   kadłubach: na chwilę pełna prędkość kosztem reaktora (§ 5, „Szarża”).
6. Dźwięki — poza zakresem.

## 3. Co jest dziś (sprawdzone w kodzie)

### Celowanie i ogień
- LPM tylko zatwierdza namiar (`index.html`, mousedown/mouseup → `confirmTargetingSelection`); `mouse.left`
  nigdy nie jest `true`. PPM otwiera menu rozkazów. Klawisz T działa wyłącznie w trybie wydobycia.
- Podpowiedź `weapons` w `src/game/story/missions/mission01.js` i lista skrótów w AGENTS.md uczą
  „LPM — działa główne, T — namierz” — tego w kodzie nie ma.
- Namiar: kursor na kadłubie przez 0,7–2,6 s (`getTargetingLockDuration`: pancernik 0,9 s, fregata 1,6 s,
  myśliwiec 2,6 s), potem LPM, potem klawisz 1 (auto-ogień). Lista kontaktów i PPM → ATAK namierzają od razu.
- Gdy ginie ostatni namierzony cel, auto-ogień wszystkich grup gaśnie. Limit 8 celów (`RADAR_UI_MAX_TARGETS`).
- Bez namiaru klawisz 1 = jedna salwa na naciśnięcie, wszystkie wieże w kursor, bez wyprzedzenia.
- Z namiarami cele rozdaje numer gniazda (`i % liczba celów`, `weaponController.js` `updateAim`). Gniazda Atlasa
  idą na przemian burtami, więc przy dwóch celach lewa burta bije w A, prawa w B, niezależnie od położenia celów.
- Cała bateria główna ma jedno wspólne przeładowanie (`rail.cd`), nie osobne na gniazdo.
- Wieże gracza: bez łuków ostrzału, bez bramki „lufa wycelowana”, każda obraca się 126°/s (`ship.turret`).
- Rakiety na auto strzelają do namierzonego celu także poza zasięgiem (filtr zasięgu ma tylko grupa `main`).
- Obrona punktowa gracza (`ciwsStep`) widzi tylko okręty z `isPirate` — innych wrogich frakcji nie.
- NPC mają autonomiczne wieże: `processAutonomousWeapons` (`src/ai/capitalAI.js`) — wybór celu wg typu, łuku,
  zasięgu, linii ognia. Gracz tego nie ma.

### Wieże gracza pudłują z zasady (pomiar)
`stepMountedWeaponAim` to regulator bez członu prędkości, a pocisk gracza leci wzdłuż kąta wieży
(`fireWeaponCore`: `isPlayerShip ? muzzle.dir : aimPoint`). NPC strzelają wprost w punkt wyprzedzenia.
Symulacja na modułach gry: pudło = prędkość poprzeczna celu względem lufy / 6,3 — **niezależnie od zasięgu**.

| Sytuacja | Pudło dziś | Pół kadłuba celu | Z członem prędkości |
|---|---|---|---|
| Fregata 1400 j/s w poprzek, zasięg 3–10 km | 220 j. | 96 j. | 0 j. |
| Niszczyciel 1000 j/s | 158 j. | 144 j. | — |
| Myśliwiec 2800 j/s, 2,5 km | 435 j. | 12 j. | 0,1 j. |
| Atlas 3000 j/s obok stojącego pancernika | 473 j. | 312 j. | 0,5 j. |

Poprawka: do prędkości zadanej wieży dodać prędkość kątową punktu celowania (różnica kąta między krokami).

### Lot
- Atlas gracza, tryb bojowy: limit 10 000 j/s (`HULL_DRIVE_CONFIGS.atlas`), przyspieszenie 260–455 j/s²,
  hamowanie klawiszem S ok. 2700 j/s². Ten sam kadłub jako NPC: 400 j/s, 130 j/s² (`shipFlightSpecs.js`).
- Obrót: limit 31°/s jest nieosiągalny — przyspieszenie kątowe to tylko ok. 2,1°/s² (0,037 rad/s², zmierzone
  w `headingControl.js`), więc zwrot o 180° trwa 18,5 s. Atlas NPC robi to w 12,7 s.
- Inne kadłuby gracza mają ten sam problem: fregata 4800 j/s (NPC 1400), niszczyciel 4200 (1000),
  pancernik 3600 (650). Źródłem są dwie tabele: `driveTransmission.js` (gracz) i `shipFlightSpecs.js` (NPC).

### Dystans walki
- Piraci (armata, osobowość agresywna) trzymają się **ok. 1,6 km** od celu — bliżej niż długość Atlasa (1,8 km) —
  i kluczą na boki; Terra Nova (railgun) ok. 5,6 km (`capitalAiTuning.js`).
- Kadr przy domyślnym zoomie: 9000 × 5060 j. Walka z piratami mieści się więc w kadrze; poza kadrem są
  cele w podejściu i przeciwnik typu Terra Nova. Fregata ma 41 px, myśliwiec 5 px.
- Przy 1,6 km cel lecący w poprzek daje duże prędkości kątowe: pancernik ok. 25°/s, niszczyciel ok. 37°/s,
  fregata ok. 50°/s. To one ustalają, jak wolne mogą być wieże.

### Siła ognia
- 15 × railgun mk2: ok. 300 pkt/s przy 100% trafień (cykl salwy ok. 1 s). Fregata 2000–2700 pkt (tarcza +
  kadłub), niszczyciel 6400, pancernik 19 200. Odwet misji 1: ok. 220 tys. pkt.
- Rakiety i Supernowa: ok. 2500 pkt/s, dopóki starcza amunicji (8 salw) — osiem razy więcej niż działa.
- Hexlance zadaje tylko obrażenia strukturalne (rzaz); punkty kadłuba spadają pośrednio (decyzja z 2026-09-29).
- `energyCost` broni nie jest egzekwowany — bateria Yamato nie kosztuje nic poza przeładowaniem.

### Taran (pomiar na silniku belek, prawdziwe sprite'y, cele swobodne, burtą do Atlasa)

| Prędkość Atlasa | Fregata — zostaje konstrukcji | Niszczyciel | Pancernik |
|---|---|---|---|
| 300 j/s | 82–89% | 100% | — |
| 500 j/s | 16–24% | 100% (tylko odepchnięty) | 99% |
| 700 j/s | 3–18% | 99% | — |
| 1000 j/s | 3% | 85% | 78% |
| 2000 j/s | 3% | 5% | — |
| 3000 j/s | 3% | 1% | 10% |

Atlas nie traci przy tym ani prędkości, ani konstrukcji. Wniosek: przy 500 j/s taran miażdży fregaty,
niszczyciel wymaga ok. 2000 j/s, pancernik ok. 3000. Do sprawdzenia w grze: licznik taranu misji 1 liczy
`dead || hp <= 0`, a sufit punktów z konstrukcji (`maxHp · udział^2,2`) zostawia zmiażdżonemu kadłubowi
ułamek punktu — zmiażdżona fregata może nie być zaliczana.

## 4. Projekt: trzy warstwy ognia

| Warstwa | Gniazda | Kto strzela | Rola |
|---|---|---|---|
| Baterie burtowe | main | Załoga (auto) | Wszystko w zasięgu; kilka celów naraz |
| Obrona punktowa | aux | Załoga (auto, jak dziś) | Rakiety, myśliwce |
| Bateria główna | special | Gracz: LPM w kursor | Duże cele, salwa jako wydarzenie |
| Uderzenia | Hexlance, torpedy, Supernowa, rakiety, myśliwce | Gracz: klawisze jak dziś | Chwile rozstrzygające |

### Sterowanie

| Wejście | Dziś | Docelowo |
|---|---|---|
| LPM (trzymany) | Zatwierdza namiar | Ogień grupy w ręku w kursor |
| 1 / 2 / 3 | Przełącznik auto-ognia grupy | Bierze grupę w rękę (domyślnie special; bez niej main) |
| Ctrl (albo Alt) + 1 / 2 / 3 | — | Auto-ogień grupy wł. / wył. |
| T | — | Cel priorytetowy: wróg najbliżej kursora, od razu; T w pustkę albo na ten sam cel zdejmuje |
| U | — | Dokłada cel do kolejki priorytetowej (do 8) albo go z niej zdejmuje (we wdrożeniu zamiast Shift + T) |
| Y | — | Postawa ognia: swobodny → tylko cel priorytetowy → wstrzymać |
| ŚPM | Koło SINGLE / MULTI / SUB / SELECT | Zostaje SUB (podsystemy) |
| 4, 5, 8 | Hexlance, Supernowa, torpedy | Bez zmian |
| F | Rakieta | System okrętu: szarża (§ 5); rakiety pod 3 |

Im mniejszy okręt, tym więcej gracz strzela sam: fregata ma cztery działa i jedną broń specjalną, Atlas
piętnaście dział na auto i baterię w ręku.

### Reguły baterii autonomicznych
- Kolejność celu: cel priorytetowy (T) → wróg przy kursorze, gdy gracz trzyma LPM → najlepszy dla tej wieży.
- Ocena celu dla wieży: klasa celu a kaliber, szansa trafienia (czas lotu pocisku × zwrotność celu wobec jego
  rozmiaru — armata nie strzela do fregaty 5 km dalej), kąt do obrotu, lepkość 2–3 s, kara za nadmiar ognia
  na jednym celu (wieże rozkładają się na kilka celów).
- Strzał dopiero przy wycelowanej lufie (`aim.aimErr` już jest liczony) i czystej linii ognia
  (`isLineOfFireBlocked`).
- Własne przeładowanie na gniazdo.
- Postawy ognia: swobodny / tylko cel priorytetowy / wstrzymać. Pod maskowaniem zawsze wstrzymać — strzał
  zrywa maskowanie (słuchacz `WeaponShotBus` w `index.html`).
- Rakiety na auto: tylko w cel priorytetowy i tylko w zasięgu.
- Obrona punktowa: wszystkie wrogie frakcje (`isHostileNpc`), nie tylko piraci.
- Wstrząs kamery tylko od grupy w ręku i od trafień — piętnaście wież na auto nie może trząść ekranem bez przerwy.

### Obrót wież wg rozmiaru (start do strojenia)
S 126°/s (jak dziś), M 90°/s, L 60°/s, Capital 40–45°/s. Niżej nie warto schodzić: przy walce na 1,6 km
pancernik w poprzek to 25°/s, niszczyciel 37°/s. Bateria Capital ma nadążać za niszczycielem, a nie nadążać
za fregatą z bliska — fregaty z bliska są robotą dla dział burtowych.

### Łuki ostrzału
Pierwotnie: na start 360°, później przełącznik. **Decyzja użytkownika 2026-10-01: łuki na stałe** —
działa 180° (środek w burtę, dziób, rufę, a z rogu kadłuba po ukosie), broń specjalna 270° (środek w burtę /
dziób / rufę; bateria prawej burty nie strzela w lewo przez pokład i odwrotnie). Wdrożenie — § 10.

## 5. Lot: ciężar zamiast prędkości

Zasada: jedna tabela dla gracza i NPC — parametry lotu kadłuba gracza = `SHIP_FLIGHT_SPECS` tej klasy × ok. 1,25.

| Atlas | Dziś | Cel (start do strojenia) |
|---|---|---|
| Limit prędkości bojowej | 10 000 j/s | 500 j/s (test 500–700) |
| Przyspieszenie | 260–455 j/s² | ok. 160 j/s² |
| Hamowanie | ok. 2700 j/s² | 200–250 j/s² |
| Przyspieszenie kątowe | 2,1°/s² | 12–14°/s² |
| Prędkość obrotu | w praktyce do ok. 19°/s | 18–20°/s |
| Zwrot o 180° | 18,5 s | 10–12 s |

- Stabilizator i autopilot mierzą zdolność obrotu z modelu dysz (`resolveShipTurnCapability`), więc zmiana
  mnożników napędu nie wymaga ich przestrajania; autopilot dojazdu trzeba sprawdzić po zmianie hamowania.
- **Szarża — system okrętu pod F** (decyzja użytkownika: krótki dopalacz do miażdżenia jak F w Starsectorze,
  na niektórych kadłubach, kosztem reaktora). Bez niej przy limicie 500 j/s taran miażdży tylko fregaty.
  - Co już jest: `boost` w `index.html` (ciąg główny × 2,5, zapas 45 s, efekt dysz MAIN) — działa tylko
    w strefach orbit planet (Shift przy planecie) i nie podnosi limitu prędkości napędu.
  - Docelowo: F zrywa okręt na wprost do prędkości taranu na 4–6 s (limit napędu podniesiony na czas zrywu,
    obrót mocno przycięty), potem napęd sam wraca do 500 j/s. Prędkość zrywu z pomiaru taranu: ok. 2000 j/s
    miażdży niszczyciele, ok. 3000 j/s pancerniki — do wyboru, co Atlas ma umieć rozjechać.
  - Koszt: ładunek reaktora — zryw zużywa cały, odbudowa ok. 25–30 s. Gra nie ma dziś wspólnej puli energii
    reaktora (`energyCost` broni jest martwy, maskowanie ma własną energię), więc na start osobny pasek;
    propozycja na później: jedna pula dla zrywu, salw Yamato i maskowania.
  - Na których kadłubach: pole systemu w danych kadłuba (Atlas; kandydat NPC: piracki pancernik-taran).
  - Klawisz F dziś odpala rakietę — rakiety zostają pod 3 (i w trybie wydobycia F = detonacja, bez zmian).
- **Przelot poza walką** — otwarte. Użytkownik: szybki ma być tylko warp. Jeśli dojazdy po 20–30 km okażą się
  nużące (40–60 s przy 500 j/s), wariant umiarkowany: 2000–2500 j/s bez wroga w pobliżu, jak `travelSpeed` NPC.
- Pozostałe kadłuby gracza: ta sama reguła (fregata ok. 1750 j/s zamiast 4800 itd.).

### Skutki dla misji 1
- Podejście: punkt zbiórki 24 km od rzędu = 48 s lotu przy 500 j/s. Wykrycie następuje dopiero z 9 km, więc
  `rallyDistance` można skrócić do ok. 13 km.
- Taran: szarża pod F (podpowiedź `ram` do przepisania) i warunek zaliczenia „konstrukcja poniżej progu”.
- Odwet: front 11 km od gracza daje piratom 8–15 s do zwarcia. Przy 18–20 km bateria główna dostaje
  20–30 s strzelania do nadlatujących — to jest moment „miażdżenia”.
- Podpowiedź `weapons` — do przepisania razem z nowym sterowaniem.

## 6. Broń specjalna mniejszych klas

Dziś wszystkie bronie special mają rozmiar Capital, a gniazdo przyjmuje broń nie większą niż rozmiar kadłuba
(`canMountWeaponOnHardpoint`) — fregata, niszczyciel, pancernik i lotniskowiec nie mają czego zamontować.
Propozycja startowa na istniejących rodzinach efektów (bez nowych receptur):

| Klasa | Rozmiar | Propozycja | Rodzina efektu | Liczby startowe |
|---|---|---|---|---|
| Fregata | S | Lekki railgun osiowy | valkyrie | 180 obr., przeładowanie 2,5 s, zasięg 9000 j. |
| Niszczyciel | M | Railgun średni | valkyrie | 380 obr., 3 s, przebija fregatę |
| Pancernik | L | Bateria dwulufowa | yamato | 2 × 450 obr., 5 s |
| Kapitał | Capital | Yamato, Valkyrie, Goliath, Plasma Gatling, Mjolnir | — | bez zmian |

Koszt jednej nowej broni: `MASTER_WEAPONS`, `WEAPON_FX`, klucz wieżyczki (`turret2D.js`), sprite
(`specialWeaponSprite2D.js`), stempel rany (`hullDamageStamps.js`), model (`weapons3D.js`), ikona, testy tabel.
Do czasu ich dodania reguła „bez special w ręku jest main” wystarcza, żeby mniejszym okrętem dało się strzelać.

## 7. Zrobione: domyślny fit Atlasa (2026-10-01)

`autoMountDefaults()` i `DEFAULT_INVENTORY_STOCK` w `index.html`: wszystkie 45 gniazd obsadzone.
- special: 6 × Yamato (jedna pełna salwa: 18 pocisków, 15 300 obrażeń co 5 s),
- aux: 6 × CIWS Mk I (dziób, rufa), 4 × flak „Perun” (końce skrzydeł, burty z przodu), 2 × laser PD (skrzydła),
  2 × CIWS Mk II (śródokręcie),
- reszta bez zmian (15 × railgun mk2, Grad + pociski manewrujące, 6 eskadr, Hexlance, Supernowa).

Zapisany fit z przeglądarki wygrywa z kodem — nowy domyślny widać po `?reset=loadout` albo na czystym zapisie.

## 8. Kolejność wdrożenia

| Etap | Zakres | Uwagi |
|---|---|---|
| 0 | Człon prędkości wież i bramka wycelowania; T = cel priorytetowy bez trzymania; auto-ogień przechodzi na następny cel; rakiety auto tylko w zasięgu; obrona punktowa przeciw wszystkim wrogim; okrąg zasięgu baterii zamiast Hexlance; podpowiedź misji i skróty w AGENTS.md | Bez zmiany modelu |
| 1 | Moduł `src/game/fireControl.js`: baterie autonomiczne, przeładowanie na gniazdo, postawy ognia, cisza pod maskowaniem; LPM = grupa w ręku; grupy 1 / 2 / 3; stan grup w HUD | Za opcją „klasyczne / dowodzenie” do porównania w `?story=defences` i `?story=counter` |
| 2 | Lot z jednej tabeli: Atlas 500 j/s, hamowanie, obrót; szarża pod F z ładunkiem reaktora; dystanse i taran misji 1 | Limit i prędkość zrywu wystawione do strojenia w panelu dev |
| 3 | Znacznik wyprzedzenia, gotowość wież przy kursorze, obrót wież wg rozmiaru, znaczniki celów o minimalnym rozmiarze, strzałki poza kadrem, wstrząs tylko od grupy w ręku | |
| 4 | Broń specjalna klas S / M / L; balans (bateria burtowa L, Hexlance, koszt energii Yamato); łuki ostrzału | |

Dla wdrażających:
- Ogień gracza P1 jest dziś wpisany w `index.html` (`triggerRailVolley`, `fireRailBarrel`, `_fireSpecialGroup`),
  a P2 idzie przez `WeaponController.update` — nowy moduł ma obsłużyć obie ścieżki.
- Stan celowania jest już per gniazdo (`getMountedWeaponAim`), `updateAim` już przypisuje cel każdej wieży —
  to jest miejsce wpięcia wyboru celu.
- NPC w etapie 1 zostają bez zmian. Ujednolicenie celowania NPC z graczem (strzał wzdłuż lufy) osłabiłoby
  wrogów i zmieniło wszystkie bitwy flot — osobna decyzja po testach.
- LPM ma dziś inne role w kolejności obsługi: wydobycie, torpedy, menu rozkazów, RTS, panel stacji — ogień
  wchodzi na końcu tej kolejki.

## 9. Otwarte

- Przelot poza walką: bez niego, czy umiarkowany (§ 5).
- Hexlance: czy ma zabijać to, co przetnie.
- Koszt salwy Yamato (energia), gdy sześć dział strzela za darmo — razem z pytaniem o wspólną pulę reaktora
  (szarża, Yamato, maskowanie).
- Szarża: we wdrożeniu 3000 j/s (miażdży też pancerniki); co dzieje się z bronią i tarczą w trakcie, które kadłuby
  ją mają poza Atlasem.
- Przewaga kalibru (mnożnik obrażeń za różnicę rozmiaru broni i celu) — na razie nie.
- Łuki ostrzału: wdrożone tylko w trybie „Dowodzenie” gracza; klasyczne sterowanie, gracz 2 i NPC strzelają
  bez łuków. Celownik nie odróżnia wieży „poza łukiem” od „jeszcze się obraca” (obie bez pipsu wycelowania);
  łuków nie widać na ekranie.
- Pad: grupa w ręku tylko pod RT (`mouse.fireMain` → `fcTrigger.pad`); T / U / Y i grupy z pada — brak.
- Gracz 2 (podzielony ekran) zostaje na klasycznym sterowaniu (`WeaponController.update`).
- Broń specjalna S / M / L korzysta z receptur Valkyrie / Yamato w skali Capital — efekty (wylot, smuga, trafienie)
  są za duże na fregatę; do przeskalowania albo własnych receptur.
- Siła baterii burtowej: 15 × railgun mk2 zabija fregatę eskorty w 6–14 s (§ 10) — to sufit obrażeń dział
  (~25 pkt/s na wieżę), nie wyboru celów. Czy Atlas ma miażdżyć szybciej — decyzja balansu.

## 10. Wdrożenie (2026-10-01)

### Co jest w kodzie
- `src/game/fireControl.js` — czysty moduł (bez DOM / three): `stepFireControl` (celowanie i strzały grup main /
  special / missile), `fcPickTarget` (ocena celu wieży), grupa w ręku, auto grup, postawa. Klej gry: blok
  „KIEROWANIE OGNIEM” w `index.html` (`stepPlayerFireControl` w `physicsStep`, `refreshFireControlCandidates`,
  `fcTrigger`, `fcFireMain` / `fcFireSpecial`, `fcDesignatePriority`, HUD `_drawFireControlReticle` /
  `_drawFireControlStatus`). Opcja menu → Opcje → Sterowanie „Kierowanie ogniem” (Dowodzenie / Klasyczne,
  `sc_fire_control`); podzielony ekran — zawsze klasyczne.
- Ocena celu wieży na auto (`FC_TUNE`): dopasowanie kalibru × szansa trafienia (czas lotu × unik klasy), ZAGROŻENIE
  (kandydat `threat`: 1 = trafił gracza w ostatnich 6 s — znacznik `__fcHitPlayerAt` w kolizjach pocisków — albo ma
  go za cel; 0,4 = walczy z kimś innym), dobijanie rannych, premia za szybkie zabicie (mała pozostała potrzeba),
  skupienie (dołączanie do ognia, kara dopiero za nadmiar ponad potrzebę celu), najwyżej 2 cele naraz bez kary,
  lepkość, kąt obrotu, burta, zasięg. Uśpione okręty (`combatDisabled` — zaparkowane i wieżyczki misji przed
  alarmem) nie są kandydatami (tylko pod T).
- Jedna tabela lotu: `src/data/shipFlightSpecs.js` (Atlas gracza 500 j/s), kalibracja napędu gracza do tabeli
  w `src/game/flight/driveTransmission.js` (`calibrateDriveToShip`).
- Szarża: `src/data/shipSystems.js` (system kadłuba), `src/game/flight/ramBurn.js` — 3000 j/s, 5 s, ładowanie 28 s,
  rusza tylko z pełnego ładunku; klawisz F.
- Wieże: człon prędkości (feed-forward) i obrót wg rozmiaru broni — `turretDriveFor` w `src/game/weaponAim.js`.
- Łuki ostrzału (`MOUNT_ARCS`, `mountFireArc`, `bearingInArc` w `src/game/weaponAim.js`): działa 180°, broń
  specjalna 270°. Środek łuku = normalna obrysu kadłuba (elipsa `ship.w / 2` × `ship.h / 2`) w miejscu gniazda,
  zaokrąglona — działa do 8 kierunków co 45°, specjale do 4 co 90°. Atlas: działa śródokręcia w burty, dziobowe
  i rufowe na rogach po ukosie, rufowe na osi w tył; 6 × Yamato w burty (po 3 na stronę). `stepMountedWeaponAim`
  przycina kąt zadany do łuku i prowadzi wieżę przez łuk (nigdy przez kadłub), obrót kadłuba dociska lufę do
  krawędzi; cel poza łukiem = duży błąd celowania = brak strzału. Wybór celu na auto pomija cele poza łukiem
  wieży (także priorytetowe), a obrót kadłuba, który wyprowadza cel z łuku, zrywa go. Pomiar w grze (defences,
  gracz stoi): Yamato pod LPM strzela burtą, która sięga (9 pocisków = 3 wieże), 2 fregaty eskorty w 16 s;
  gdy wrogowie są po jednej stronie, pracuje ~7 z 15 dział.
- Domyślny fit Atlasa (§ 7), broń specjalna klas S / M / L w `src/data/weapons.js`, misja 1 (`src/game/story/*`:
  szarża w podpowiedzi taranu, zaliczenie taranu przy konstrukcji < 30%, podpowiedź broni).

### Pomiary w grze (`ogien-gra.mjs`, headless Chrome z WebGPU)
| Lot Atlasa (`--tryb lot`) | Wynik |
|---|---|
| Limit prędkości bojowej | 500 j/s |
| Rozpędzanie 0 → 500 j/s | ok. 3,3 s (~150 j/s²) |
| Hamowanie S z 500 do 25 j/s | 2,1 s (~230 j/s²) |
| Obrót | 18°/s, osiągnięte w ~1,5 s (~12°/s²); gaśnie 1,65 s po puszczeniu steru |
| Szarża F | 3000 j/s po ~2,5 s, zryw 5 s, potem wytracanie do ~500 j/s w ~3,5 s; druga od razu — odmowa (ładunek) |

| Ogień (`--tryb ogien`) | Wynik |
|---|---|
| LPM trzymany, bateria Yamato w ręku | salwy `special_yamato_cannon` co przeładowanie (16–18 pocisków na salwę z 6 wież) |
| Defences, sam ogień auto, gracz stoi, 24 s (przed poprawką wyboru celu) | 0 zabitych, 10 z 15 dział w zaparkowanym pancerniku, tarcza 17 400 → 0, śmierć |
| Defences, to samo po poprawce | 2 fregaty eskorty zabite (pierwsza po 6–14 s), całe 15 dział na jednym celu, tarcza 17 400 → 2400–3200 |
| Counter, sam ogień auto, gracz stoi | ogień od ~20 s (front wchodzi w 14 km), 29 wrogów → zwycięstwo po ~44 s walki razem ze wsparciem, tarcza 18 000 → 3400 |

Narzędzie: `node scripts/webgpu/ogien-gra.mjs --tryb lot | --tryb ogien [--faza defences|counter] [--czas N]
[--out .tmp/ogien]` — zrzuty i `raport-<tryb>.json` (próbki: wrogowie, kandydaci, statystyki baterii, spust,
pociski gracza wg broni, tarcza / kadłub). Stan wież do diagnostyki: `window.__fcEnv.aimOf(loadout).fcTarget`.

Zapisany loadout z przeglądarki (`localStorage`) wygrywa z kodem — nowy domyślny fit po `?reset=loadout`.
