# PLAN „3D gaz” — gaz i pył hali K-7 na siatce 3D (2026-10-12)

Brief: `docs/BRIEF-gaz-hali-3d.md` (etapy E0–E3). Ta implementacja: moduł `src/3d/hallGas3d/`, demo `dema/3d-gaz.html`
(gospodarz: kopia dema doku K-7), harness `scripts/webgpu/3d-gaz-demo.mjs`, testy `tests/hallGas3d.test.mjs`, wyniki
`.tmp/3d-gaz/<etap>/`. Osobne nazwy, bo równolegle powstaje druga implementacja tego samego briefu (GAZ-GPT:
`src/3d/hallGas/`, `dema/hala-gaz-webgpu.html`, `docs/PLAN-gaz-hali-3d.md`) — nic z niej nie importuję.

## Siatka (decyzja E0: komórka 56 j.)
- Sześcienna komórka **56 j.**, domena **200 × 168 × 14 = 470 400** komórek (11 200 × 9 408 × 784 j.): x hali ±5 220 + 320
  zapasu, głąb od ściany tylnej − 320 do bramy G-01 + 1 700 j. próżni, wysokość 0–784 (dach 711; warstwa 13 = dach zamknięty
  albo otwór). Osie tekstur 3D: x = x hali, y = z hali (głąb), z = wysokość; prędkość w komórkach/s.
- Kurz na pokładzie: pole 2D 2× drobniejsze (28 j., 400 × 336).
- Strojenie fizyki w jednostkach świata (j., j/s, 1/s) — przeliczenie na komórki w kroku: zmiana komórki (48 / 64) = jedna liczba
  (`HALL_GAS3D_GRID.cell`) i ponowny pomiar, bez przestrajania.

## Tekstury, bufory, role (stan po E1; zapis RGBA16F z zaokrągleniem stochastycznym — `src/3d/tsl/zapisF16.js`)
| zasób | zawartość | pisze → czyta |
|---|---|---|
| velA | v (x, głąb, w górę), flaga stała | project → occ, curl, advect, react, deck |
| velB | v po reakcji, cel dywergencji (źródła objętości) | react → div, deck, project |
| velC | v̂ (MacCormack prędkości) | advect → react |
| denA / denB / denC | pył, para, spaliny, temperatura (stan / φ̂ / po reakcji) | project / advect / react |
| curlT, lapT | ω i dywergencja centralna (diagnostyka); laplasjan v (filtr biharmoniczny) | curl → react |
| faceT | prędkości ŚCIAN +x, +y, +z po rzucie (Rhie–Chow) — pole transportu | project → advect, react |
| occT | zajętość 0–1 (statyka, płyta kadłuba × maska obrysu, dach), prędkość przeszkody; w szczelinie pod płytą: cel wleczenia i 1 + źródło | occ → advect, react, div, project |
| stat (RGBA8, raz na grę) | zajętość statyczna, powietrze hali, odległość od brył × 4, kolumna w obrysie hali | CPU → occ, react, project |
| deckA / deckB (2D, 28 j.) | depozyt kurzu; zmiana pyłu komórki 3D (L − s) | deck → project, deckCopy |
| pA, pB, rhs (f32), maska (u32) | ciśnienie (SOR w miejscu na pA), prawa strona, kody sąsiadów | div, SOR → project |
| rekordy (bufor storage) | kadłuby (3 vec4: kotwica, macierz → maska, prędkość, ω, źródło szczeliny), strumienie (7 vec4) | CPU → occ, react |

## Krok (raz na klatkę, dt czasu gry ≤ 1/30 s, podkroki 1/120 s, jeden `renderer.compute(lista)` — 36 dispatchy)
occ → curl → advect → react → deck → div → SOR czerwono-czarny × 14 (ω 1,7) → project → deckCopy. Żaden kernel nie czyta i nie
pisze tej samej tekstury (test `tests/hallGas3d.test.mjs` z wiązań WGSL); ≤ 4 tekstury storage, ≤ 8 buforów storage, ≤ 12 buforów
uniformów na kernel.

## Obraz
Bryła domeny w dwóch siatkach (wzór `gasVolume.js`): `back` — wysokość < 116, pass ortho (warstwa 0) przed kadłubami;
`front` — ≥ 116, pass FG (warstwa 2), przezroczysta, po bryłach FG (kryjący dach zasłania gaz nad halą — `roofView`). Marsz
w układzie hali, z sceny = `k7HeightToZ` (odcinkami liniowe — każda siatka ma swój odcinek); wyznacznik macierzy > 0 (pułapka 37).
E1: gęstość, otoczenie wnętrza hali (jak warstwa 2D: 0,11 + lampy), słońce przez otwór dachu, miękkie kolano światła. E2: faktura,
drobiny, objętość światła, siatka świateł, HG.

## E1 — model solvera (`src/3d/hallGas3d/hallGas3dGrid.js`, lustra CPU w `hallGas3dLayout.js`)
- TRANSPORT po prędkościach ŚCIAN (Rhie–Chow): rzut liczy prędkości ścian ½(v_i + v_j) − (p_j − p_i) zgodne z laplasjanem
  zwartym — ich dywergencja = cel (źródła objętości) do residuum solvera; adwekcja (RK2 wstecz, MacCormack z obcięciem dla
  skalarów i prędkości) idzie po nich. Transport po prędkościach komórek (różnica centralna) nie widział modu szachownicy 2Δ:
  masa i energia rosły bez końca. FILTR biharmoniczny v −= a·∇²(∇²v) (a = 1/300 na 1/60 s) gasi 2Δ; przy pokładzie i bryłach
  laplasjan filtra z ODBICIEM (normalna 2·v_s − v, styczne v) — bez tego filtr działał jak tarcie bezpoślizgowe.
- POKŁAD: tarcie z prawa ściany τ/ρ = Cd·|Δv|² (Cd 0,01; tempo Cd·|Δv|/h). Podrywanie = strumień erozji liftRate ×
  smoothstep(liftLo, liftHi, |v₀|) do wyczerpania kurzu komórki; opadanie wszędzie (settleMin przy szybkim przepływie);
  wymiana pył ↔ pokład dokładnie zachowawcza (e = L − s, suma czterech komórek pokładu).
- DYSZE MAIN (każda dysza z `EngineFrame`) i SIDE: stożek z rdzeniem potencjalnym (jetCore × r, dalej ∝ 1/x), przekrój
  ELIPTYCZNY — struga przy pokładzie rozpływa się na boki 0,3·x, w pion 0,05·x (strumień przyścienny, Launder–Rodi), źródło
  objętości (wydatek = jetFlow × moc × v·π w0²/k — rdzeń strugi = spaliny), zasłanianie marszem po polu odległości, rozrzedzanie
  pyłu w stożku (jetClean 6/s × profil — jak pole 2D; rdzeń czysty — tunel w locie).
- SZCZELINA pod płytą kadłuba (warstwa 0 = 0–56 j., płyta 48–116): cel wleczenia ½·v (Couette) i ŹRÓDŁO objętości
  S = edgePush·|v|·obwód/pole (obrys w rozdzielczości siatki): ciśnienie spiętrzenia wtłacza powietrze pod kadłub, rzut
  rozprowadza wypływ burtami, dziobem i rufą wg kształtu kadłuba — kurz spod kadłuba przy starcie.
- PARA kriogeniczna: OPADANIE (dryf 80 j/s, strumień zachowawczy w dół, zalega przy pokładzie — „stała opadania osobna od
  pyłu”, brief) + ciężar LINIOWY w stężeniu (3000 j/s² na jednostkę pary): gęsta przy złączce spływa z płyty kadłuba po
  burtach, ślad pary nie rozkręca prądów gęstościowych. Spaliny: wypór 900 j/s² × temperatura, stygnięcie 0,35/s.

## E1 — wyniki (`node scripts/webgpu/3d-gaz-demo.mjs --tryb e1`, RTX klasy Blackwell, 1600 × 900, zegar wirtualny; `.tmp/3d-gaz/E1/`)
| miara § 10 | cel | wynik |
|---|---|---|
| zawinięcie: spaliny w pasie 1,5 km od ściany nad y = 300 po 2 s | ≥ 25 % | **53 %** |
| szczyt prędkości pionowej przy ścianie / prędkość u wylotu | ≥ 0,3 | **0,76** (1981 / 2600 j/s) |
| grzyb: spaliny nad y = 500 rosną (2 s → 4 s); przepuszczalność nad kadłubem | rośnie; ≥ 0,7 | **593 → 1421**; min **0,94** (0,91 w całym ciągu) |
| tunel w locie (5,5 s, d = 14 komórek 2D = 392 j.; definicja audytu 2D § 6, kolumna pyłu) | ≥ 450 j., flanka ≤ 1,3 | **672 j.**, flanka **1,58 ✗** |
| — to samo przy d = 24 komórki (672 j.) | | **1064 j.**, flanka **1,14** |
| — warstwy strugi (56–168 j.), d = 392 / 672 | | 728 / 1008 j., flanka 1,35 / 1,02 |
| drugie odpalenie / pierwsze (zdjęte z pokładu) | ≥ 0,5 | **0,56** |
| wróciło na pokład po 30 s / zdjęte | ≥ 0,8 | **1,37** (pył w powietrzu −79 %) |
| masa pyłu bez źródeł, 60 s | ±2 % | **0,045 %** |
| kurz spod kadłuba: start 0 → 300 j/s, pas po obu burtach (min z 6 przekrojów) | ≥ 200 j. | **252 j.** |
| para ze złączek po 10 s poniżej y = 116 | ≥ 60 % | **68 %** |
| residuum dywergencji / v_rms (pole ścian — transport) | ≤ 0,06 | **0,004** (centralnie w komórkach 0,20 — mod 2Δ, gaszony filtrem) |
| rdzenie wirów 6 s po ciągu | ≤ 2 × średnia | **1,93** |
| determinizm (dwa przebiegi, skróty pól z GPU) | identyczne | **identyczne** |
| pipeline'y synchroniczne po starcie | 0 | **0** |

Flanka 1,58 przy d = 392: linia pomiaru w tej chwili przecina rząd słupków paliwowych C-01 (z = 2660, ±615 j. od osi) — kurz
wypchnięty spod kadłuba i strugi spiętrza się przy nich (w polu 2D słupków nie było). Przy d = 672 (bez słupków) — 1,14.

Koszt: symulacja **0,354 ms GPU / krok** (reakcja 0,105, adwekcja 0,095, ciśnienie SOR 0,166, reszta 0,136 — części z osobnych
nachyleń), obraz +0,113 ms / klatkę (1600 × 900), CPU kroku efektów 0,12 ms / klatkę, pamięć 47,5 MB, 36 dispatchy, 2 rysunki.
Budżety § 11: symulacja ≤ 0,6 ✓, pamięć ≤ 80 MB ✓, CPU ≤ 0,25 ✓.

## E1 — lekcje (pułapki)
- Ciężar pary nasycony (każde stężenie ≥ 0,02 = czysta para kriogeniczna) rozkręcał prąd gęstościowy ~500 j/s po pokładzie
  całej hali — po zgaszeniu silników kurz był dalej podrywany (powietrze ×3 w 6 s, „wróciło” −2,6). Ciężar liniowy + dryf.
- Pomiar tunelu i pasa przy burtach z prawdziwej geometrii: burta z zajętości płyty (Atlas ma ~400 j. szerokości w śródokręciu,
  nie 806), oś tunelu od gromady dysz z `EngineFrame`, kolumny z bryłami poza profilem; pas przy burtach — źródła gazu hali
  wyłączone (inaczej tło z sąsiednich stanowisk podnosi próg).
- Lot w 3D przez „pył z odpaleń” (protokół 2D) nie ma tła: pył wspina się po ścianie tylnej i osiada przed startem — tło tunelu
  to warstwowa mgiełka hali (`hazeAir` 0,06 · e^(−y/120)).

## Budżety (brief § 11) i pomiar E0
Szkielet kroku (`hallGas3dBench.js`: docelowe tekstury, bufory i liczby próbek, arytmetyka zastępcza, 30 × Jacobi), RTX klasy
Blackwell, demo `dema/3d-gaz.html`, mediana 2 przebiegów, `node scripts/webgpu/3d-gaz-demo.mjs --tryb e0`:

| komórka | komórek | pamięć | krok (bufory f32) | z tego Jacobi × 30 | krok (ciśnienie w teksturach, jak gasGrid) |
|---|---|---|---|---|---|
| 48 j. | 712 704 | 62,5 MB | **0,52 ms** | 0,20 ms | 0,82 ms |
| 56 j. | 470 400 | 41,5 MB | **0,37 ms** | 0,17 ms | 0,55 ms |
| 64 j. | 304 128 | 27,1 MB | **0,27 ms** | 0,16 ms | 0,42 ms |

Budżet symulacji ≤ 0,6 ms / klatkę, całości w hali ≤ 1,0 ms (1600 × 900), pamięć modułu ≤ 80 MB. Przy 48 j. sam szkielet bierze
87% budżetu symulacji i 78% pamięci — na prawdziwe kernele (szum turbulencji, zasłanianie dysz, wymiana z pokładem, zaokrąglanie)
i na detal E2 (pozycje spoczynkowe, objętość światła, drobiny) nie zostaje miejsca. **Wybór: 56 j.** (szkielet 0,37 ms = 61% budżetu,
41,5 MB). Ciśnienie w **buforach f32** (2× szybszy Jacobi niż RGBA16F i bez gubienia precyzji ciśnienia w f16). E1 mierzy pełny
krok; zapas na 48 j. — gdy pełny krok przy 56 j. zostawi ≥ 0,2 ms.

## Decyzje własne (zgodne z briefem)
- Ciśnienie: SOR czerwono-czarny w miejscu (14 × 2 dispatchy, ω 1,7) zamiast Jacobiego × 27 — ta sama zbieżność taniej.
- Dach FIZYCZNY (otwór, ułamek otwarcia, prostokąt w układzie hali — nowe pola wejścia) ≠ wygaszenie dachu nad graczem
  (`K7RoofFade` — sam obraz). Grzyb pod sufitem wymaga stropu; otwór daje wypływ i okno słońca (brief § 3, § 13 pkt 4).
- Brama i otwór dachu: przepuszczalne „pole” — w próżni gaz ginie (brief § 13 pkt 5), lekki dryf na zewnątrz.
