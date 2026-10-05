# Demo WebGPU: ładownie „à la Venator” (dema/ladownia-webgpu.html) — zadanie 26

Polecenie użytkownika (2026-09-28): *„ładownia do przerobienia — każdy statek musi dostać ładowanie: efekt otwierania
i pusta przestrzeń, jaką mają frachtowce, do dema dronów, które ładują / rozładowują. W tej przestrzeni ładunkowej
kontenery 3D. Otwierania à la Venator.”* Kontekst: ładownia Atlasa ma dziś 20 t, a jedna skała miedzi daje ~138 t rudy.

Demo pokazuje na prawdziwych sprite'ach gry: ładownię w każdym kadłubie (Atlas, Terra Nova, piraci, frachtowce Z11),
**wrota „à la Venator”** (grzbiet dzieli się wzdłuż osi, dwie połowy rozjeżdżają się na boki), **puste wnętrze z głębią**
(dno, ściany z żebrami, lampy zapalane falą, cień krawędzi otworu), **kontenery 3D** w slotach (port wyglądu Z5 do TSL)
i **drony**, które ładują i rozładowują moduły z platformy stacji. Samodzielne demo (`WebGPURenderer` + TSL pod Vite),
gry nie dotyka; moduły renderu leżą w `src/3d/cargo/` gotowe do integracji.

## Jak otworzyć i sterować

`npm run dev` → `http://localhost:5173/dema/ladownia-webgpu.html` (port wg Vite). Start: galeria, zbliżenie na otwarty
hangar Atlasa z ładunkiem.

- **Sceny (górny rząd panelu, klawisze 1–4):** 1 Galeria (14 kadłubów, ładownie otwarte i wypełnione różnymi
  ładunkami), 2 Wrota (pętla: zamknięte → ostrzeżenie → otwarcie → lampy falą → zamknięcie), 3 Załadunek (drony stacji
  przenoszą moduły z placu do ładowni, potem wrota się zamykają; pętla), 4 Rozładunek (odwrotnie).
- **Kadłuby (przyciski w panelu, `[` `]`):** w galerii — przelot do ładowni kadłuba; w scenach 2–4 — zmiana kadłuba.
- **O** — otwórz / zamknij wrota (galeria: wszystkie naraz; sceny 3–4: **R** — przeładunek od początku).
- **Kamera:** kółko — zoom do kursora (jak w grze, do ×6; kadry do ×3,2 = maks. gry), przeciąganie / WASD — przesuw,
  **F** — cała scena, **B** — ładownia z bliska, **C** — kamera kinowa (pochylenie 38°, Q/E obrót) — najlepiej widać
  bryły wrót i głębię wnętrza. Tempo: ❚❚ / ×½ / ×1 / ×2 / ×4, Spacja — pauza. **H** — panel.
- **Panel:** pojemność wybranego kadłuba (otwór, wrota, siatka modułów, kontenery × tony, dziś, skały miedzi),
  tabela wszystkich kadłubów z wyborem tonażu kontenera, ustawienia (ładunek scen 3–4, azymut słońca, „słońce cieni”,
  moc lamp, pochylenie kamery, bloom, cienie).
- **Adres:** `?scena=galeria|otwieranie|zaladunek|rozladunek`, `?kadlub=atlas` (id z `CARGO_BAY_HULLS`), `?t=12`,
  `?test=1` (klatki tylko przez `__demo.step`), `?dpr=1`.
- **Konsola:** `__demo.scene(nazwa, kadłub)`, `setTime(t)`, `pause(b)`, `focus(kadłub, zoom)`, `frame()`,
  `tilt(stopnie, azymut)`, `sun(az, elew)`, `stats()`, `capacity(t_na_kontener)`.

## Pliki

| Plik | Co robi |
|---|---|
| `src/data/cargoBays.js` | **dane i geometria** (bez three): kontener standardowy, warianty tonażu, kadłuby i ładownie w przestrzeni PNG (jak strefy mostków), siatka slotów modułów i kolejność zapełniania, pojemność i tabela, przebieg wrót (`cargoBayDoorTimeline/Pose/Progress`), lampy, przekształcenia ładownia → statek → świat, `validateCargoBays` (kolizje z hardpointami, silnikami, mostkami) |
| `src/game/cargoBayOps.js` | **przeładunek dronami** (bez three, bez stanu): `planBayTransfer` (tory dronów ładownia ↔ plac, podział na drony wzdłuż osi, przelot nad przeszkodami), `bayTransferState(plan, t)` (sloty, plac, drony, niesione moduły w chwili t), sloty w świecie, komórki placu |
| `src/3d/cargo/cargoLight.tsl.js` | światło ładunku jak kadłub gry (otoczenie 0,24, rozproszone 1,18, połysk 0,30, maska słońca Core3D), **tablica ładowni** (uniformArray, stała nazwa bloku), cień krawędzi otworu, lampy (fala + migotanie), przysłonięcie nieba, fill |
| `src/3d/cargo/bay.tsl.js` | **wnętrze** (dno, ściany, pas ostrzegawczy, oprawy lamp, znaki slotów, światła prowadzące, szczelina kieszeni) i **skrzydła wrót** (wierzch z wycinka sprite'a, faza krawędzi, pas przy szczelinie, bursztynowa poświata szczeliny) + `CargoBayRig` (ładownia na statku, rekord w tablicy) |
| `src/3d/cargo/containers.tsl.js` | **kontenery 3D** — port wyglądu Z5 (standard z przetłoczeniami i drzwiami, zbiornik ISO, zsyp z usypanym ładunkiem 7 materiałów, hazmat), sfazowana bryła Z5, jedna siatka instancji |
| `src/3d/cargo/drones.tsl.js` | **drony** — bryła Z5 (korpus, ramiona, 4 bloki RCS, rama chwytaka z zamkami), światła (pozycyjne, kogut, błyski RCS), pula świateł-billboardów, kogut wrót |
| `src/3d/cargo/shadows.tsl.js` | cienie na kadłubie / pokładzie (GREATER — tylko tam, gdzie kadłub zapisał głębię) i obwódka kontaktu modułów |
| `dema/ladownia-webgpu.html`, `dema/ladownia-webgpu.js` | strona, renderer, post jak gra (BloomGry ×3 → ACES gry → sRGB), kamera, panel, pętla, `window.__demo` |
| `dema/ladownia-webgpu/sceny.js` | sceny (galeria, wrota, załadunek, rozładunek) — czyste funkcje czasu sceny |
| `dema/ladownia-webgpu/kadlub.js` | kadłub dema: kwad ze sprite'em, światło jak kadłub gry, dziury w otworach ładowni |
| `dema/ladownia-webgpu/stacja.js` | platforma przeładunkowa (plac modułów, gniazda dronów, wieża, światła) |
| `dema/ladownia-webgpu/tlo.js` | tło (kopia tła dema tarczy) |
| `scripts/webgpu/ladownia-demo.mjs` | harness: `--tryb test` (sceny × kadłuby, błędy WebGPU/WGSL), `--tryb zrzuty`, `--tryb wydajnosc` |
| `scripts/webgpu/ladownia-strefy.mjs` | strefy na sprite'ach: sprawdzenie pokrycia i kolizji, tabela pojemności, `--szukaj` wolnych prostokątów dla nowych kadłubów |
| `tests/cargoBays.test.mjs`, `tests/cargoBayOps.test.mjs`, `tests/cargoTsl.test.mjs` | testy (strefy na sprite'ach, sloty, pojemności, przebieg wrót; przeładunek; WGSL materiałów w Node i limity WebGPU) |

Pliki Z5 (`src/3d/cargoContainers3D.js`, `src/3d/cargoDrones3D.js`, `src/game/cargoPortOps.js`) bez zmian —
`src/data/cargoContainers.js` (rodziny, palety, `containerLook`) użyty wprost.

## Model ładowni

- **Przestrzeń PNG** jak mostki: środek płótna = (0, 0), +x dziób, +y w dół obrazka; ładownia = prostokąt w osi statku
  (`x, y, w, h`). Świat: `s = renderLength / dłuższy bok płótna`; układ statku 3D (x, −y); układ ładowni (a, b, z):
  a wzdłuż statku, dno w z = −głębokość, krawędź otworu w z = 0.
- **Kontener standardowy 16 × 8 × 8 j.** (jak slot kontenerowca Z5). **Moduł** (jednostka przeładunku) = nx × ny × nz
  kontenerów: dron niesie cały moduł — małe okręty 1 × 1 × 1, średnie 1 × 1 × 2, duże ładownie 2 × 2 × 2, wagon
  4 × 4 × 2. Siatka slotów: moduł + 1 j. odstępu, 1 j. od ściany; głębokość = wysokość modułu + 1,5 j. (wrota zamykają
  się nad ładunkiem). Kolejność załadunku: kolumnami od rufy, w kolumnie od osi na zewnątrz (środek masy w osi);
  rozładunek od końca. Kontenery to **widok liczby** (jak Z5): `cargoContainersForMass`, moduł zapełnia się piętrami.
- **Wrota „à la Venator”:** otwór dzielony wzdłuż osi statku, połowy jadą na boki.
  - `over` (Venator): skrzydło odrywa się w górę, jedzie PO poszyciu i osiada na szynach obok otworu — potrzebny wolny
    pas parkowania (sylwetka, bez wieżyczek i mostków); `leaves` = skrzydła na stronę (1 — klasyczny, 2–3 — teleskop:
    węższy pas, skrzydła jadą z różną prędkością i zostają w stosie, wewnętrzne wyżej).
  - `pocket` (kieszeń): skrzydło opada i chowa się pod poszycie — dla kadłubów, gdzie obok otworu stoją wieżyczki; ładownia jest głębsza o zjazd skrzydeł (`pocketDrop` — stos stoi pod nimi, test w `tests/cargoBays.test.mjs`), a część skrzydła poza otworem nie jest rysowana (wąskie kadłuby: skrzydło wystawałoby za sprite)
    (w ścianach wnętrza widać szczelinę, w którą wjeżdżają).
  - Wierzch skrzydła to **wycinek sprite'a kadłuba** — zamknięta ładownia wygląda dokładnie jak dziś; napis IRON SKULL
    czy namalowane pokrywy luków frachtowców rozjeżdżają się razem ze skrzydłami. Faza krawędzi (normalna pochyla się na
    zewnątrz) i pas ostrzegawczy przy szczelinie pokazują płytę, gdy wrota się rozchodzą.
  - Przebieg (`cargoBayDoorTimeline`): ostrzeżenie 0,9 s (koguty w narożnikach, szczelina świeci bursztynem) → oderwanie
    0,7 s → przejazd 2,4–6,5 s (dłużej przy szerszym otworze; smootherstep) → osadzenie 0,55 s; **lampy zapalają się
    falą wzdłuż ładowni z migotaniem świetlówek** od 55% przejazdu. Atlas: 6,9 s. Zamykanie = ten sam przebieg wstecz.
    Odsłonięta część otworu to zawsze |b| < otwarcie · halfB (skrzydła kryją resztę bez szpar — test).
- **Wnętrze:** płyty dna ze szwami, bursztynowe narożniki slotów, przerywana oś, turkusowe światła prowadzące przy
  ścianach; ściany z żebrami co 5 j., podłużnice, pas żółto-czarny pod krawędzią, oprawy lamp. Światło: model kadłuba
  gry (otoczenie · sunFill, rozproszone od „słońca kadłubów” prawie w płaszczyźnie — jak gra), **cień krawędzi otworu**
  od „słońca cieni” (azymut Słońca, 30° — konwencja cieni mostków i kontenerów Z5; promień ze dna musi wyjść przez
  odsłoniętą część otworu, półcień rośnie z drogą), przysłonięcie nieba przez ściany i wrota, **lampy** (rzędy pod
  krawędzią obu długich ścian, świecą w dół i do środka, zasięg ~ głębokość: kałuże światła przy ścianach, środek szerokiej
  ładowni ciemniejszy), fill. Wnętrze stoi zawsze pod skórą — przestrzeliny w poszyciu nad ładownią pokażą je same.
- **Cienie:** moduły niesione przez drony, drony i uniesione skrzydła rzucają cień na kadłub i pokład stacji
  (prostokąt przeciągnięty wzdłuż słońca cieni pod płaszczyzną gry, test głębi GREATER — rysuje się tylko na kadłubie),
  moduły na dnie i placu — miękka obwódka kontaktu.

## Pojemność — propozycja do decyzji

Pojemność = sloty modułów × kontenery w module × **tony na kontener**. Rozmiar kontenera jest jeden (16 × 8 × 8 j.),
więc pojemność rośnie z objętością ładowni — duże kadłuby mieszczą dużo więcej niż dziś.

| Kadłub | długość [j.] | ładownie (otwór a × b × głęb. [j.], wrota, siatka modułów × moduł) | kontenery | dziś [t] | 0,5 t | 1 t | **2 t** | 5 t | skały miedzi przy 2 t |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| Atlas | 1800 | 312 × 131 × 17,5, over ×1, 9×7 × 2×2×2 | 504 | 20 | 252 | 504 | **1008** | 2520 | 7,3 |
| Custos | 192 | 54 × 21 × 9,5, over ×2, 3×2 × 1×1×1 | 6 | 16 | 3 | 6 | **12** | 30 | 0,1 |
| Hasta | 288 | 55 × 35 × 9,5, over ×2, 3×3 × 1×1×1 | 9 | 30 | 4,5 | 9 | **18** | 45 | 0,1 |
| Bellator | 624 | 302 × 39 × 19,9, pocket, 17×4 × 1×1×2 | 136 | 40 | 68 | 136 | **272** | 680 | 2 |
| Citadella | 1080 | 2 × (382 × 69 × 21,4), pocket, 11×3 × 2×2×2 | 528 | 80 | 264 | 528 | **1056** | 2640 | 7,7 |
| Colossus | 1560 | 470 × 105 × 17,5, over ×2, 14×5 × 2×2×2 | 560 | 120 | 280 | 560 | **1120** | 2800 | 8,1 |
| Marauder | 192 | 31 × 10 × 11,4, pocket, 1×1 × 1×1×1 | 1 | 12 | 0,5 | 1 | **2** | 5 | 0 |
| Reaver | 360 | 70 × 26 × 11,4, pocket, 4×2 × 1×1×1 | 8 | 22 | 4 | 8 | **16** | 40 | 0,1 |
| Iron Skull | 720 | 133 × 58 × 20,9, pocket, 7×6 × 1×1×2 | 84 | 32 | 42 | 84 | **168** | 420 | 1,2 |
| Prom międzystacyjny | 120 | 19 × 19 × 11,4, pocket, 1×2 × 1×1×1 | 2 | 60 | 1 | 2 | **4** | 10 | 0 |
| Kontenerowiec | 312 | 121 × 45 × 20,2, pocket, 7×4 × 1×1×2 | 56 | 160 | 28 | 56 | **112** | 280 | 0,8 |
| Frachtowiec dalekiego zasięgu | 540 | 154 × 58 × 20,9, pocket, 9×6 × 1×1×2 | 108 | 380 | 54 | 108 | **216** | 540 | 1,6 |
| Ciężki frachtowiec | 1800 | 658 × 349 × 26,9, pocket, 19×20 × 2×2×2 | 3040 | 900 | 1520 | 3040 | **6080** | 15 200 | 44 |
| Wagon megafrachtowca | 2760 | 2 × (1499 × 238 × 26,9), pocket, 22×7 × 4×4×2 | 9856 | 100¹ | 4928 | 9856 | **19 712** | 49 280 | 143 |

¹ cargoCap składu gracza 600 / 6 wagonów; klasa ruchu `mega` = 2400 t na cały frachtowiec.

**Propozycja: 2 t na kontener** (`CARGO_TONNES_DEFAULT`). Atlas: 1008 t = **7,3 skały miedzi** (dziś 20 t — ułamek
jednej); małe okręty zostają blisko dzisiejszych wartości (Custos 12 t vs 16, Hasta 18 vs 30, Reaver 16 vs 22), duże
rosną proporcjonalnie do ładowni. Warianty w panelu (tabela) i w `CARGO_TONNES_OPTIONS`. Uwaga dla frachtowców ruchu v2:
pojemności z geometrii nie pasują do klas ekonomii (`VAN_CLASSES`: prom 60 t przy 2 kontenerach, ciężki 900 t przy 3040)
— propozycja: ruch zostaje przy klasach ekonomii, a kontenery w ładowni frachtowca są widokiem liczby
(ceil(kontenery × masa / ładownia klasy), zasada Z5); geometria rządzi pojemnością statków gracza i okrętów.

## Strefy ładowni (przestrzeń PNG, `CARGO_BAY_HULLS`)

| Kadłub | ładownia | x, y, w × h [px PNG] | wrota | moduł | uwagi |
|---|---|---|---|---|---|
| Atlas | Hangar grzbietowy | 66, 0, 649 × 272 | over ×1 | 2×2×2 | środek grzbietu między wieżą specjalną (x −320) a wyrzutnią (x 457); skrzydła parkują na płytach „V” — grzbietowy hangar Venatora |
| Custos | Luk grzbietowy | 82, 0, 680 × 264 | over ×2 | 1×1×1 | grzbiet z kratką między blokiem dowodzenia a widłami dziobu |
| Hasta | Luk grzbietowy | −4, 0, 146 × 92 | over ×2 | 1×1×1 | j.w. (narzędzie: kieszeń 184 × 100 dałaby 16 kontenerów zamiast 9) |
| Bellator | Rynna grzbietowa | 140, 0, 560 × 72 | pocket | 1×1×2 | rynna z mechanizmem przed mostkiem — pancerz skrzydeł kadłuba stoi tuż obok |
| Citadella | Pokład lewy / prawy | 38, ∓158, 592 × 107 | pocket | 2×2×2 | dwa pokłady windowe lotniskowca (ciemne płyty z okręgami); punkty `hangar` myśliwców leżą w nich — hangar i ładownia to ten sam pokład |
| Colossus | Hangar rufowy | −528, 0, 504 × 112 | over ×2 | 2×2×2 | rufowy grzbiet za nadbudówką TERRA NOVA |
| Marauder / Reaver / Iron Skull | Luk IRON SKULL | płyta z napisem | pocket | 1×1×1 / 1×1×1 / 1×1×2 | napis dzieli się i chowa pod pancerz |
| Frachtowce Z11, wagon | luki | obszar namalowanych zatok | pocket | wg rozmiaru | namalowane zatoki (bursztynowe obrysy) to pokrywy luków |

Zasady (test `tests/cargoBays.test.mjs`, narzędzie `scripts/webgpu/ladownia-strefy.mjs`): otwór i pasy parkowania
w sylwetce (≥ 97% alfy), pas parkowania ≥ zapas mostka (`bridgeZoneMargin` — korpus wieżyczki klasy kadłuba) od
hardpointów, silników i rdzeni, otwór ≥ 0,7 zapasu (korpus wieżyczki 2D może wisieć nad krawędzią), bez nakładania na
strefy mostków i innych ładowni. Nowy kadłub: `node scripts/webgpu/ladownia-strefy.mjs --szukaj id --sprite … --dlugosc …
--edytor …` wypisuje kandydatów (over ×1/×2, kieszeń, środek / para) do oceny na obrazku.

## Przeładunek dronami (`src/game/cargoBayOps.js`)

Plan liczony raz z kontekstu (sloty ładowni w świecie w kolejności załadunku, komórki placu od najbliższej, gniazda
dronów, liczba modułów, start okna), stan w chwili t czysty (jak `transferState` Z5): materializacja w połowie
przeładunku daje od razu obraz. Tor drona: wynurzenie z włazu gniazda → przelot na wysokości ponad kadłubem, stosem
skrzydeł „over” i modułem pod hakiem (drony parzyste i nieparzyste na dwóch warstwach) → nad źródło → w dół → chwyt
0,6 s → w górę → nad cel (obrót do kursu slotu) → w dół przez otwarty otwór → odłożenie 0,45 s → w górę …
→ powrót do gniazda. Ruch poziomy tylko na wysokości przelotu (test). Zadania posortowane wzdłuż osi ładowni i pocięte
na ciągłe odcinki; komórki placu przydzielone w tej samej kolejności — tory równoległe, drony się nie krzyżują (test).
Scena ustawia start okna po otwarciu wrót, a zamknięcie po ostatnim wyjściu drona z ładowni (`plan.bayClearAt`).
Tempo: poziomo 90 + 3,5 · L modułu j./s (146 dla kontenera, 203 dla modułu 2×2×2), pionowo 0,35 × — Atlas 48 modułów
(384 kontenery) ośmioma dronami: ~70 s, w oknie postoju NPC (LOAD 90 s / UNLOAD 120 s, `cargoTransferWindow`).

## Pomiary (RTX 5080, headless Chrome, 1920 × 1080, bez vsync — `--tryb wydajnosc`)

| Scena | FPS | CPU klatki | GPU (znaczniki three) | draw | kontenery |
|---|---:|---:|---:|---:|---:|
| galeria, cała | 452 | 2,2 ms | 0,18 ms | 61 | 5734 |
| galeria, hangar Atlasa | 470 | 3,1 ms | 0,20 ms | 33 | 5734 |
| wrota, Atlas | 470 | 1,5 ms | 0,08 ms | 20 | 296 |
| załadunek, Atlas (8 dronów) | 543 | 1,4 ms | 0,06 ms | 25 | 384 |
| załadunek, ciężki frachtowiec | 477 | 1,6 ms | 0,09 ms | 23 | 384 |
| wrota, wagon megafrachtowca | 465 | 3,2 ms | 0,19 ms | 24 | 5760 |

CPU to całe JS klatki dema (przebudowa buforów instancji wszystkich kontenerów co klatkę, bez alokacji; wygląd
kontenerów liczony raz na moduł — klucz tekstowy na kontener kosztował 10–15 ms przy 5,7 tys.). Rysunki: kadłub,
wnętrze ładowni i skrzydła (2–6) na statek, po jednym dla wszystkich kontenerów, dronów, świateł i dwóch rodzajów cieni.

## Plan integracji z grą

1. **Decyzje** (pytania niżej): tony na kontener, czy `cargoCap` kadłubów gracza idzie z geometrii
   (`createPlayerHullCatalog` w `src/data/playerHullCatalog.js`: `cargoCap: cargoHullCapacity(id, T).tonnes`; dziś
   Atlas 20 → 1008 t przy 2 t), polityka frachtowców ruchu v2 (klasy ekonomii vs geometria), strefy i tryb wrót per
   kadłub, własność dronów.
2. **Dane:** `CARGO_BAY_HULLS` dostaje wszystkie kadłuby w grze — dziś 9 okrętów + frachtowce Z11 + wagon; brakuje
   kadłubów ruchu v2 (`src/data/trafficHulls.js`: tanker, heavy_harvester, salvage_hauler, refinery_tender…),
   rodzin frakcji Z11 i lokomotywy megafrachtowca (narzędzie `--szukaj`). Mapowanie encja → klucz jak mostki
   (`resolveEntityHullProfileId`, `FREIGHTER_HULL_BY_TYPE`, wagony `megafreighter_wagon`). Test rozmiaru PNG pilnuje
   podmian sprite'ów (jak `tests/shipBridge.test.mjs`).
3. **Skóra kadłuba z otworem** (`src/3d/hexShips3D.tsl.js`, wariant skóry belek): prostokąty ładowni kadłuba w danych
   per kadłub (`HullObjectStore` — 1–2 vec4 więcej na slot; albo per obiekt jak `uSprite`), `Discard()` w otworze
   (wzór: przestrzelina małego kalibru w `hullDamageSurface`) + ciemna obwódka krawędzi. Belki kadłuba pod otworem
   zostają (fizyka i kolizje bez zmian — ładownia to widok; ewentualne osłabienie struktury to osobna decyzja).
4. **Render w Core3D** (nowy klej `src/3d/cargo/cargoBays3D.js` na wzór `bridge3D.js`): `CargoBayRig` na encję z
   ładownią, grupa za pozą RENDERU encji (interpolowana poza gracza, pivot wraku), warstwa 0 (pass ortho jak kadłuby).
   **Precyzja** (świat 5–10 mln j.): pule kontenerów / dronów / cieni z początkiem przy kamerze (`sceneOriginNearCamera`
   — `mesh.position` = początek, dane względem niego), tablica ładowni względem TEGO SAMEGO początku (dziś środki ładowni
   są w świecie — przy 10 mln j. float32 drga ~1 j.). Słońce: `setCargoSun` z pozycji Słońca gry co klatkę (azymut) —
   „słońce kadłubów” = `uLightDir` kadłubów, „słońce cieni” 30° jak mostki; maska Core3D już czytana (`sunVisibility`).
   Kolejka: cienie (renderOrder 10) → skrzydła (11) → kontenery (12) → drony (12,5) jak mostki; światła-billboardy do
   puli świateł pozycyjnych gry albo `Fx3D`. Rozgrzewka potoków (`Core3D.prewarmPass`) przy starcie gry.
   Flota: wnętrza i skrzydła wszystkich statków w jednym rysunku instancji (indeks ładowni już jest w danych).
5. **Wrota w rozgrywce:** stan na encji (`entity.cargoBay = { dir, at, from }`, postęp jak `DoorScene.progressAt`);
   otwierają się przy stanowisku portu (po klamrze / suwnicy K-7 — `PORT_SEQUENCE`), przy wydobyciu (urobek), na rozkaz
   gracza; zamykają przed skokiem (warp z otwartymi wrotami — blokada albo automatyczne zamknięcie) i opcjonalnie
   w walce. Ładownia otwarta = odsłonięty ładunek (patrz 8).
6. **Ładunek gracza i NPC:** `PLAYER.cargo` (worek surowców, `getBagMass`) → kontenery przez widok liczby
   (`cargoContainersForMass` na surowiec, moduły zapełniane piętrami, wygląd z `containerLook` — rodziny Z5);
   NPC ruchu — ładunek kursu (rekord) jak w Z5; wraki — `_cargoManifest` zostaje w ładowni wraku (łup do holowania
   i cięcia, `salvage.js`).
7. **Przeładunek:** handel w porcie (dziś natychmiastowy) dostaje okno przeładunku — drony portu z gniazd stanowiska
   (`cargoBerthGeometry` z `cargoPortOps.js`: słupek SERVICE, place przy polu) wkładają / wyjmują moduły przez otwarte
   wrota (`planBayTransfer` z komórkami placu stanowiska i gniazdami portu); **Z14** (kontenery i drony w bańce) —
   frachtowce ruchu przy stanowisku otwierają luki (`pocket`), a `cargoTransferWindow` daje okno planu (zamiast
   kontenerów na odkrytym pokładzie Z5 — albo Z5 zostaje dla odkrytych pokładów, decyzja).
8. **Wydobycie (21b):** urobek w tonach (`createYield` / `addToPlayerCargo`) → pełny kontener zsypu (rodzina hopper,
   materiał z rudy) pojawia się w ładowni co T ton; wiązka ściągająca może celować w otwarty otwór (odłam znika
   w ładowni) — wydobycie wymaga otwartych wrót; pełna ładownia = komunikat jak dziś.
9. **Uszkodzenia (mapa ran 18-C):** trafienia w skrzydła przy zamkniętych wrotach — pancerz (skrzydło z HP, może się
   zaciąć: `open` nie dochodzi do 1); przy otwartych — kontenery w strefie trafienia niszczone (ubytek ładunku,
   szczątki / łup), możliwy pożar ładunku hazmat. Przestrzeliny poszycia nad ładownią pokazują wnętrze bez dodatkowego
   kodu (wnętrze stoi zawsze pod skórą).
10. **Testy i harness:** sesja „ładownia” w `scripts/webgpu/zrzuty.mjs` (baza z `main`), testy mapowania encja →
    ładownia i pojemności z katalogu kadłubów.

## Decyzje podjęte w demie

- Kontener standardowy **16 × 8 × 8 j.** i moduł przeładunku zależny od wielkości ładowni (dron niesie moduł) —
  żeby duże ładownie ładowały się w oknie postoju, a kontener wyglądał tak samo na każdym statku.
- **Wrota `over` (Venator) tam, gdzie obok otworu jest wolny pas** (Atlas, Custos, Hasta, Colossus), **kieszeń**
  wszędzie, gdzie pas zajęłyby wieżyczki / pancerz (Bellator, Citadella, piraci, frachtowce).
- Wierzch skrzydeł = wycinek sprite'a (zamknięte wrota niewidoczne), pas ostrzegawczy przy szczelinie pojawia się dopiero
  przy otwieraniu.
- Światło jak kadłub gry + cień krawędzi od słońca cieni 30° + lampy wnętrza; bez nowego modelu słońca.
- Drony należą do stacji (gniazda na platformie); moduł = jeden surowiec.
- Tony na kontener w danych jako propozycja (2 t) z wariantami — gra nie jest zmieniana.

## Pytania do użytkownika

1. **Ile ton na kontener?** Propozycja 2 t (Atlas 1008 t ≈ 7 skał miedzi); warianty 0,5 / 1 / 5 t w tabeli.
2. **Czy `cargoCap` okrętów i statków gracza ma iść z geometrii** (Atlas 20 → 1008 t, Colossus 120 → 1120 t), czy
   zmniejszyć ładownie do dzisiejszej skali?
3. **Frachtowce ruchu v2:** zostają przy klasach ekonomii (kontenery = widok liczby), czy pojemność z ładowni (ciężki
   900 → 6080 t, prom 60 → 4 t)?
4. **Strefy:** hangar grzbietowy Atlasa (środek kręgosłupa, skrzydła na płytach „V”) — tak? Rynna Bellatora i rufa
   Colossusa to najlepsze wolne miejsca, ale zmieniają charakter grzbietu — inne propozycje (narzędzie `--szukaj`)?
5. **Tryb wrót:** `over` (skrzydła na poszyciu) wszędzie, gdzie się da, czy kieszeń też na okrętach Terra Nova?
6. **Wrota w walce:** otwarte = odsłonięty ładunek (trafienia niszczą kontenery), zamknięte = pancerz; blokada skoku
   przy otwartych wrotach?
7. **Drony:** portowe (Z5/Z14) czy własne statku (Atlas ma punkty `hangar`) — przy wydobyciu i handlu poza portem?
8. **Skala megafrachtowca:** 9856 kontenerów na wagon (moduł 4 × 4 × 2) — zostaje, czy osobny „megakontener”?
9. **Wydobycie:** urobek ma trafiać do ładowni widocznie (wiązka w otwór, kontener zsypu co T ton)?

## Weryfikacja

- `node scripts/webgpu/ladownia-demo.mjs --tryb test` — 9 przypadków (sceny × kadłuby), 0 błędów konsoli / walidacji
  WebGPU / WGSL; `--tryb zrzuty` — 32 zrzuty (galeria: całość, hangar Atlasa, 6 kadłubów, kino; sekwencja wrót Atlasa
  7 klatek + kino; kieszenie lotniskowca, Iron Skull i kontenerowca w 62% i 100%; załadunek start / środek / koniec /
  blisko / kino / frachtowiec; rozładunek) w `.tmp/webgpu/zadania/26/`; `--tryb wydajnosc` — tabela wyżej.
- `node --test tests/cargoBays.test.mjs tests/cargoBayOps.test.mjs tests/cargoTsl.test.mjs` — 25 testów; całość
  `node --test "tests/*.test.mjs"`: te same 5 porażek bazowych (hudRadarWiring ×2, scannerSingleBurst, solarSystem,
  targetingModes) + 3 todo; `npm test` — wszystko OK.

## three r183 pod WebGPU — ustalenia z dema

- **Cień „tylko na kadłubie” (GREATER) wymaga, żeby rzucający rysowali się PO cieniu:** kontenery, drony i skrzydła
  w kolejce przezroczystej z `NoBlending` i zapisem głębi (renderOrder > cieni) — w kolejce nieprzezroczystej
  rysowałyby się przed cieniem i ciemniały od własnego cienia (wzór mostków i Z5).
- **Tekstura per obiekt przy wspólnym grafie:** skrzydła wszystkich kadłubów to klony jednego materiału z
  `teksturaObiektu('uSprite', …)` i wartościami w `material.uniforms` (onObjectUpdate) — jeden program na wszystkie
  kadłuby (test klucza programu w `tests/cargoTsl.test.mjs`).
- **Tablica ładowni jako `uniformArray` z `.setName()`** — kontenery i drony czytają rekord po indeksie z instancji;
  jeden bufor na etap (limit 12), ten sam WGSL we wszystkich materiałach.
- **Obiekt zamrożony** (`Object.freeze` geometrii ładowni) nie przyjmie pamięci podręcznej przez `defineProperty` —
  przebiegi wrót w `WeakMap`.
- Ostrzeżenie `TimestampQueryPool … Maximum number of queries exceeded` przy ~500 FPS headless i odczycie co 8 klatek
  to jednorazowe ostrzeżenie three (jak w demie broni), nie błąd dema.
