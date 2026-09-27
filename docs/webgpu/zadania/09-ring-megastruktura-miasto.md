# Zadanie 09 — Ring 4/5: megastruktura i miasto (kopuły, landmarki, drzewa)
Zależności: 08 | Równolegle z: 04, 05, 12–14, 16, 17 | Zalecany effort: xhigh
Zakres: `src/3d/haloRing/haloRingMegastructure.js` (535 linii: `HALO_PRIM_FRAGMENT` 297 — używa go też miasto;
materiały `HaloMegaPrims`, `HaloDomeGlass`, `HaloMegaTrains`, `HaloMegaLights`), `src/3d/haloRing/haloRingCity.js`
(375: `HaloCity_garden`, `HaloCity_industry`, `HaloTrees` z `TREE_VERTEX` 121), `haloRingDomes.js`,
`haloRingLandmarks.js` (sprawdź, czy mają własne materiały). ~910 linii, 7 materiałów.

## Cel
Megabudowle, pociągi i światła megastruktury, szklane kopuły-biosfery, parki, drzewa i dzielnice miasta (ogród,
przemysł) jak w bazie, w obu trybach jakości (LOD „Ultra”: okna z daleka, dalsze opadanie miasta).

## Przeczytaj najpierw
`agents.md` (Ring nie udaje życia — bez ruchu zastępczego), `docs/PORT-halo-ring.md` (Megabudowle, Kopuły, parki
i gatunki drzew, Jakość/LOD), `docs/webgpu/POSTEP.md`, `haloRingTSL.js`, `haloRingMegastructure.js`, `haloRingCity.js`,
testy `haloRingLandmarks`, `haloRingDomes`, `haloRingTrees`.

## Kroki
1. `HALO_PRIM_FRAGMENT` → TSL (wspólny dla megastruktury i miasta), potem materiały megastruktury (instancje, światła
   nocne HDR, pociągi, szkło kopuł — przezroczystość i kolejność) i miasta (ogród, przemysł, drzewa — `TREE_VERTEX`
   z instancji, LOD po rozmiarze w px).
2. `defines` megastruktury (7) i miasta (3) → gałęzie budowane raz (osobne materiały) albo uniformy — bez przebudowy
   w biegu.
3. Dane instancji względem początku przy kamerze / RTE — jak dziś.
4. Testy: `haloRingLandmarks`, `haloRingDomes`, `haloRingTrees` (dane, nie shadery — mają przejść bez zmian).

## Pułapki
- Wiele instancji i materiałów — pilnuj liczby draw calli (`passy` w `wyniki.json` jak w bazie).
- Szkło kopuł: przezroczyste `DoubleSide` → `forceSinglePass: true`; sortowanie z drzewami wewnątrz.
- Światła nocne > 1 (HDR) — pasmo z `agents.md` (barwy 0,4–1,3, biel 8–12).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/09 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `k7-hala__tlo`, `ring-z02` bez zamienników megastruktury i miasta; bez regresji względem 08.
- `halo_ring_demo` — `--set landmarks` i `--set domes` porównane z bazą dema z tagu (+ `quality=ultra` dla dwóch ujęć).
- `INWENTARZ.md`, `POSTEP.md`, commit na `main`.

## Czego NIE robić
- Nie przenoś K-7 i archetypów (10); nie dodawaj ruchu/„życia” w mieście.

## Raport na koniec
Co zrobione; zrzuty dema (landmarki, kopuły, miasto nocą) obok bazy; draw calle; co zostało; pytania.
