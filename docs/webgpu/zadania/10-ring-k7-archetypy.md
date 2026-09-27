# Zadanie 10 — Ring 5/5: port K-7 i ringi-archetypy Marsa (ECUMENE) i Jowisza (Fable)
Zależności: 09 | Równolegle z: 04, 05, 12–14, 16, 17 | Zalecany effort: xhigh
Zakres: `src/3d/haloRing/haloPortK7.js` (278 linii: `K7Instances`, `K7Plates`, `K7Labels`, `K7Hoses` —
`GLSL_K7_SURFACE`), `src/3d/haloRing/arch/archGLSL.js` (424: `ARCH_GLSL_LIT`, `ARCH_GLSL_SABS`, instancje, pasy,
szkło, linie, punkty), `arch/archMaterials.js`, `arch/ecumene.js` (171), `arch/fable.js` (178). ~1050 linii, 7 materiałów.

## Cel
Hala K-7 z zatokami i stanowiskami (wspólna dla trzech ringów, różni ją tylko ubiór) oraz dwa inne ringi-archetypy
(Mars = ECUMENE, Jowisz = Fable — decyzja użytkownika 2026-09-27: to INNE ringi, nie skórka) jak w bazie. Po tym
zadaniu ring nie ma zamienników.

## Przeczytaj najpierw
`agents.md` (Trzy RÓŻNE ringi; stacja-port = hala K-7 — nie rysuj brył stacji), `docs/PORT-halo-ring.md`
§ „Ringi-archetypy”, § „Port K-7”, `docs/webgpu/POSTEP.md`, `haloRingTSL.js`, pliki zakresu, testy `haloPortK7`
(bliźniak obrotu instancji wierzchołków K-7 na 16 floatach), `haloRingArch` (regexy shaderów archetypów).

## Kroki
1. K-7: materiały instancji / płyt / etykiet / węży → TSL (bliźniak JS obrotu instancji — test `haloPortK7`), lampy
   hal nocą (cień planety), zanik dachu (`K7RoofFade`).
2. `archGLSL.js` → biblioteka TSL archetypów; `archMaterials.js` (fabryka), `ecumene.js`, `fable.js` — powierzchnie
   (`ECU_SURFACE_FRAGMENT`, `FAB_SURFACE_FRAGMENT`), `needsUpdate`/`defines` w biegu → budowa raz.
3. Testy: `haloPortK7`, `haloRingArch` (regexy → odpowiedniki TSL), `haloPortBays`.

## Pułapki
- Zmiana ringu Ziemi nie dotyka Marsa i Jowisza i odwrotnie (agents.md) — wspólne są tylko hala K-7 i zatoki.
- Instancje K-7 w układzie lokalnym ringu (RTE).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/10 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `k7-hala`, `mars-ring`, `jowisz-ring` (+ warianty) **bez zamienników** i w tolerancji; `spis` ringu = 0 zamienników;
  bez regresji względem 09.
- `halo_ring_demo` z `--planet mars` i `--planet jupiter` (`--set profile`) porównane z bazą dema z tagu; `--set bays`.
- `INWENTARZ.md`: cały `src/3d/haloRing/` bez GLSL; `POSTEP.md`; commit na `main`.

## Czego NIE robić
- Nie przenoś tła menu (11); nie zmieniaj profili, układów ani kolizji portu.

## Raport na koniec
Co zrobione; zrzuty `k7-hala`, `mars-ring`, `jowisz-ring` obok bazy; co zostało; pytania.
