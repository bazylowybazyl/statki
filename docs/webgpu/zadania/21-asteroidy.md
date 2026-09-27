# Zadanie 21 — Asteroidy z dema `asteroidy-webgpu` w grze (pola, skały, minerały, olbrzymy, światło wolumetryczne, burze)
Zależności: 12, 04, 05 + commit dema asteroid na `main` | Równolegle z: 13–20 (bez zmian w `src/3d/fx/`) | Zalecany effort: max
Zakres: moduły produkcyjne dema `dema/asteroidy-webgpu/` wg tabeli w `docs/webgpu/DEMO-ASTEROIDY.md` § „Do portu w grze”
(`rockBank`, `rockNoise`, `rockMaterial`, `rockLayers`, `minerals`, `spotShadows`, `volumetrics`, `sunMap`, `storm`,
`sparks`, `giants`, `fog`, `glowSprites`, `surfaceLighting`, `tslCommon`; siatkę świateł `lights.js` scala 12) → gra
(`src/3d/asteroids/`), klej `start()` + `frame()` z `dema/asteroidy-webgpu.js` → moduł pasa w Core3D. Dane pola z gry bez
kopii: `src/game/asteroidBeltField.js` (`AsteroidBeltField`, `FieldSunOcclusion`), `asteroidStorms.js` (`StormSimulator`),
`asteroidGiants.js` + `GiantBuilder`, `asteroidRockKinds.js`. Stare pole do usunięcia: `src/3d/asteroidField3D.js`
(sprite'y + rozgrywka + promocja do ciał heksowych, dziś WYŁĄCZONE: `OLD_ASTEROIDS_ENABLED`), `asteroidBeltBackdrop3D.js`,
klej WebGL `src/3d/asteroidBelt3D.js` z `src/3d/rocks/*`, `beltDust3D`, `beltStorm3D`, `fieldLights3D` (gra ich nie tworzy).

## Cel
Decyzja użytkownika 2026-09-27: „asteroidy zaraz będą production ready — zielone światło”. Pasy asteroid w grze to pola
z dema WebGPU (typy skał i rud, minerały, olbrzymy z tunelami, światło wolumetryczne z cieniami skał, reflektory statków,
burze z piorunami, mgła, zasłona i nocna łuna pola) w passach Core3D; rozgrywka pola jak w demie: **kolizje statków z
olbrzymami** (`collideCircle` na SDF / `collideShipWithGiants`), **małe skały pod płaszczyzną gry** (statki latają nad
nimi), burze i pioruny wizualnie. Stare pole, tło pasa i klej WebGL znikają z kodu.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/DEMO-ASTEROIDY.md` (cały — decyzje, ustalenia three r183, **„Do portu w grze”**: moduły, kolejność
klatki, warunki łatwe do zgubienia, wydajność, rozgrywka), memory: przebudowa asteroid, burze, kryształy, olbrzymy, demo
WebGPU pola asteroid, `docs/webgpu/PLAN.md` §3–§6, `docs/webgpu/POSTEP.md` (wyniki 04, 05, 12), `dema/asteroidy-webgpu.js`,
w `index.html` grep: `asteroidField`, `OLD_ASTEROIDS_ENABLED`, `beltBackdrop`, `AsteroidField`; `src/3d/asteroidField3D.js`
(co robiło stare pole: `update`, `_resolveActiveAsteroidImpacts`, `_promoteAsteroidToHex`), testy `asteroid*`.

## Kroki
1. **Stan dema:** commit sesji asteroid na `main` (orkiestrator robi go przy starcie zadania, jeśli sesja nie zrobiła).
2. **Moduł pasa w Core3D** (klej z `start()`/`frame()`): kolejność klatki z § „Do portu w grze” wpięta w `render()` gry
   (przeskok początku → warstwy → olbrzymy → źródła świateł → `fieldMap` → mgła → burza → siatka świateł i atlas →
   cienie → ośrodek `compute` → iskry → duszki) PRZED `Core3D.render`; pasmo PLAY w passie ortho, RUBBLE/MID/DEEP w passie
   tła (perspektywa); złożenie jak w grze (warstwy Core3D), nie `RenderPipeline` dema.
3. **Siatka świateł** — wersja z 12 z polami dema asteroid (rozpraszanie w pyle L1.w, indeks mapy cienia L3.z, właściciel
   L3.w); światła statków z runtime gry (`shipLightRuntime.js`, `addShipLights`, profile `FIELD_SHIP_LIGHTS`); atlas map
   cienia reflektorów (`ShadowAtlas`, `grid.shadows = atlas`).
4. **Ośrodek (światło wolumetryczne):** `volume.sample(positionWorld)` (`col·a + rgb`) w KAŻDYM materiale passa gry, także
   w materiale kadłuba z 04 (wzór `HullNodeMaterial.setupOutput` z `ship.js` dema) i w materiałach efektów, które mają go
   czuć; kwad dna ośrodka w passie gry (renderOrder 12); `shared.volume` przed kompilacją materiałów.
5. **Warunki z dema:** skały PLAY pod płaszczyzną (`zOf = −1,45 r · skala`, z minerałami 1,62), ośrodek z od −760 do 380;
   transmitancja słońca do renderu przez `nightKnee` (logika — surowe T); limit 12 buforów uniform (pakować);
   `FieldSunOcclusion.precomputeAll` (~1 s) na ekranie ładowania; maska słońca z 03 (`uFieldOcc`, przesłaniacze pola).
6. **Rozgrywka:** kolizje statków (kadłuby belkowe — przez nośnik i `HullBodies`, agents.md) z olbrzymami na SDF; małe
   skały bez kolizji (pod płaszczyzną); pioruny bez obrażeń; wyłącz i usuń stare pole (`OLD_ASTEROIDS_ENABLED`,
   `?asteroidyStare`, `asteroidField3D.js`, `asteroidBeltBackdrop3D.js`, klej WebGL). **Zmiana rozgrywki względem
   starego pola** (zderzenia z małymi skałami, niszczenie skał, łup ze skał) — opisz w `POSTEP.md` jako otwarte dla
   użytkownika (demo tego nie ma; nie dorabiaj).
7. **Niebo:** z `sky.js` dema tylko zasłona gęstego pola i nocna łuna (tło gry ma własne niebo z 05).
8. **Harness:** sceny pola (gęste pole z Atlasem, głąb pola — noc, burza, olbrzym) w `zrzuty.mjs` — obok zrzutów dema w tych
   samych miejscach i zoomie; baza przyszłych porównań = zatwierdzony przebieg z `main`.
9. **Testy:** `asteroid*` (logika pola, burz, olbrzymów) bez nowych porażek; testy starego pola (`asteroidHexAdapter`,
   `asteroidFieldLight`, `asteroidBeltBackdrop`) — przepisz albo usuń razem z modułem (opisz); nowe — kolizja statku z
   olbrzymem.

## Pułapki
- `renderer.setAnimationLoop(null)` nie zatrzymuje wewnętrznej pętli; `pass()`/`BloomNode` mają `updateBeforeType = FRAME`
  (ustalenia dema) — Core3D renderuje passy ręcznie; nie przenoś `RenderPipeline` dema.
- Koszt: demo 1,5–3 ms GPU w polu (2560 × 1440), ~4 ms przy 1024 światłach, CPU dema 6–13 ms w headless (`layer.update` z
  budżetem, `grid.build`, `atlas.gather`, burza) — w grze pole + bitwa naraz: budżety, LOD, pomiar `--wydajnosc` w polu.
- Pył fizyczny usunięty decyzją użytkownika — nie przywracaj.
- Precyzja: demo ma lokalny początek przy kamerze (przeskok po 20 tys. j.) — w grze początek przy kamerze z 12.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (zmiany testów starego pola opisane).
- Harness: zero błędów walidacji; sceny pola obok dema; sceny bez pól bez regresji.
- Kolizja z olbrzymem działa (test + zrzut); burza z piorunami widoczna.
- W kodzie gry nie ma `OLD_ASTEROIDS_ENABLED`, starego pola, tła pasa ani kleju WebGL; `INWENTARZ.md` bez GLSL asteroid
  w grze; `agents.md` (asteroidy: gdzie render, gdzie rozgrywka, jak dodać typ skały); commit.

## Czego NIE robić
- Nie dorabiaj wydobycia ani niszczenia skał (nie ma w demie — decyzja użytkownika później); nie zmieniaj ekonomii.
- Nie przywracaj pyłu fizycznego; nie edytuj dema.

## Raport na koniec
Co zrobione; zrzuty pól gry obok dema; wydajność w polu i w bitwie w polu; zmiany rozgrywki względem starego pola; pytania.
