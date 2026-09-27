# Zadanie 21b — Fizyka wydobycia asteroid w grze (drony, piła, ładunki, urobek)
Zależności: 21, 12 + commit dema asteroid na `main` (po sygnale sesji „Asteroid lighting bug demo”) | Równolegle z: 22–23 | Zalecany effort: max
Zakres: logika bez three / DOM z sesji fizyki skał — `src/game/asteroidMining.js`, `src/game/asteroidMaterials.js`
(siatka komórek skały, ruda warstwami do rdzenia, wiązania, laser drona, piła, ładunek: zmiażdżenie → żwir, strefa
spękań, bryły Voronoi wg twardości / kruchości, odłamy i okruchy, ruch pod płaszczyzną gry, wiązka ściągająca → urobek w
tonach surowców `resources.js`), testy `tests/asteroidMining.test.mjs`; render z dema `dema/asteroidy-webgpu/minedRocks.js`
(atlas 3D siatek ciał — `Storage3DTexture` 256 × 256 × 128 RGBA8, compute; zewnętrze = `RockNodeMaterial` w trybie `carve`,
wnętrze = raymarching) → `src/3d/asteroids/`; `miningRig.js` dema (drony, ładunki, HUD) jako wzór zachowania, nie 1:1.
Opis: `docs/ASTEROIDY-FIZYKA.md`.

## Cel
Skały pasa da się wydobywać w grze jak w scenie „Kopalnia” dema: drony tną laserem i piłą, ładunki kruszą skałę zależnie
od materiału, wiązka ściąga urobek do ładowni. Dziś tego w grze nie ma (stare pole wyłączone, nowe z 21 bez wydobycia).

## Przeczytaj najpierw
`docs/ASTEROIDY-FIZYKA.md`, `docs/webgpu/DEMO-ASTEROIDY.md`, `docs/webgpu/zadania/21-asteroidy.md` (i wynik 21 w
`POSTEP.md`), `agents.md`, memory: przebudowa asteroid, ekonomia (`resources.js`), odzysk (`salvage.js`), ładownia gracza.

## Kroki (propozycja sesji fizyki skał)
1. `AsteroidMining` jako system gry (krok w czasie symulacji, `stepDecay120` / `ticksAt120` dla stałych na krok);
   zdarzenia (`drainEvents`) → efekty z `src/3d/fx/` (iskry, pył, błyski, zniekształcenia) z nośnikiem.
2. `minedRocks.js` → `src/3d/asteroids/` w passach skał PLAY (warstwy z 21: `hide(id)` / `unhide(id)` przejętych skał).
3. Drony z UI (wybór celu, bruzda, piła) — modele 3D osobno (na start proste, zgodne z grafiką gry).
4. Urobek → ładownia gracza; ładunki S / M / L / XL jako przedmiot (ekonomia: ceny do decyzji — wartości tymczasowe
   opisane w `POSTEP.md`).
5. Stare `asteroidDestructor.js` / heksy asteroid — do usunięcia w 24, jeśli nic ich już nie używa.

## Otwarte dla użytkownika (nie rozstrzygaj — wariant najprostszy + opis)
Kolizje odłamów z kadłubami (dziś nie — skały są pod płaszczyzną), wpływ wybuchu na sąsiednie skały, udźwig wiązki i ceny
ładunków.

## Kryteria akceptacji
- Testy bez nowych porażek (`asteroidMining` zielone); harness: scena wydobycia w polu (nowa, baza z `main`).
- Koszt: budowa ciała 10–30 ms, wybuch 10–60 ms jednorazowo (bez przestoju klatki > 50 ms — budowa w tle / rozłożona),
  klatka po wybuchu ~0,2 ms.
- `POSTEP.md` (zmiany rozgrywki: wydobycie, ładunki), `agents.md` (wydobycie: gdzie logika, gdzie render); commit.
