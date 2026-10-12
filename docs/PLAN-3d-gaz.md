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

## Tekstury, bufory, role (zapis RGBA16F z zaokrągleniem stochastycznym — `src/3d/tsl/zapisF16.js`)
| zasób | zawartość | pisze → czyta |
|---|---|---|
| velA | v (x, głąb, w górę), flaga stała | project → occ, curl, advect, react, deck |
| velB | v po reakcji, cel dywergencji (źródła objętości) | react → div, project |
| velC | v̂ (MacCormack prędkości) | advect → react |
| denA / denB / denC | pył, para, spaliny, temperatura (stan / φ̂ / po reakcji) | project / advect / react |
| curlT | ω, \|ω\| | curl → react |
| occT | zajętość komórki 0–1 (statyka, płyta kadłuba × maska obrysu, dach), prędkość przeszkody | occ → advect, react, div, project |
| stat (RGBA8, raz na grę) | zajętość statyczna, wnętrze hali, odległość od przeszkody | CPU → occ, react (zasłanianie dysz) |
| deckA / deckB (2D) | depozyt kurzu, świeżość | deck → react, deckCopy |
| pA, pB, rhs (f32), maska (u32) | ciśnienie, prawa strona, sąsiedzi: płyn / stały / brzeg otwarty | div, Jacobi → project |
| rekordy (bufor storage) | dysze MAIN (każda osobno), SIDE, źródła hali; kadłuby (uniformy) | CPU → occ, react |

## Krok (raz na klatkę, dt czasu gry ≤ 1/30 s, jeden `renderer.compute(lista)`)
occ → curl → advect → react → deck → deckCopy → div → Jacobi × 27 → project. Żaden kernel nie czyta i nie pisze tej samej
tekstury; ≤ 4 tekstury storage i ≤ 8 buforów storage na kernel. Szczegóły fizyki: brief § 5 (źródła objętości, MacCormack z
obcięciem dla skalarów i prędkości, Neumann na przeszkodach, p = 0 na brzegach otwartych, pokład bez przenikania z tarciem,
wypór, ciężka para, opadanie pyłu, wymiana masy pył ↔ pokład dokładnie zachowawcza). Poślizg na częściowej zajętości:
normalna z ∇zajętości, składowa ku przeszkodzie (względem jej prędkości) wygaszana.

## Obraz
Bryła domeny w dwóch siatkach (wzór `gasVolume.js`): `back` — wysokość < 116, pass ortho (warstwa 0) przed kadłubami;
`front` — ≥ 116, pass FG (warstwa 2), przezroczysta, po bryłach FG, test głębi (zamknięty dach zasłania, wygaszony nie). Marsz
w układzie hali, z sceny = `k7HeightToZ` (odcinkami liniowe — każda siatka ma swój odcinek). Kamery 3D — ten sam marsz z promienia
kamery. E1: gęstość, otoczenie, słońce przez otwór dachu; E2: faktura, drobiny, objętość światła, siatka świateł.

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
- Dach FIZYCZNY (otwór, ułamek otwarcia, prostokąt w układzie hali — nowe pola wejścia) ≠ wygaszenie dachu nad graczem
  (`K7RoofFade` — sam obraz). Grzyb pod sufitem wymaga stropu; otwór daje wypływ i okno słońca (brief § 3, § 13 pkt 4).
- Brama i otwór dachu: przepuszczalne „pole” — w próżni gaz ginie (brief § 13 pkt 5), lekki dryf na zewnątrz.
