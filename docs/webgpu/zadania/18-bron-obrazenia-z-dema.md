# Zadanie 18 — Broń 2/2: obrażenia z dema — mapa ran na kadłubach, przebicia, rykoszety, ładowanie i serie; światła efektów na poszyciu
Zależności: 17, 04 | Równolegle z: 05–11, 13–16, 19 (bez zmian w `src/3d/fx/`) | Zalecany effort: max
Zakres: z dema `bronie-webgpu`: `hull.js` (mapa uszkodzeń w compute: żar stygnący z bieli w czerwień, osmalenie,
przestrzeliny z żarzącym się brzegiem, poświata jonowa, pole odległości kadłuba) i logika trafień z `projectiles.js` /
`gunnery.js` / `recipes.js` (przebicia z rzazem i wylotem, rykoszety, ładowanie Mjolnira, serie Hexlance'a); w grze:
materiał kadłuba `src/3d/hexShips3D.js` (TSL po 04), kolizje pocisków (`bulletsAndCollisionsStep` w `index.html`,
`src/game/hullBodies.js` — `sweep`, `impact`, `probe`), sterowanie ogniem (`src/game/weaponController.js`,
`src/game/superweapon.js`), dane broni (`src/data/weapons.js`: `chargeTime`, `requiresStationary`, `burstCount`, `recoil`,
`shake`, `impactScale`).

## Cel
Decyzja użytkownika 2026-09-27: „bardzo mi się podobają nowe obrażenia od broni w demie — trzeba to wdrożyć”. Kadłuby
w grze dostają rany jak w demie (żar, osmalenie, przestrzeliny ze świecącym brzegiem, poświata jonowa), a mechanika
trafień z dema wchodzi do rozgrywki: przebicia na wylot, rykoszety, ładowanie Mjolnira, serie Hexlance'a, pola odrzutu /
wstrząsu / skali trafienia z danych broni. Błyski i trafienia oświetlają poszycie (siatka świateł z 12). **To zmiana
rozgrywki zatwierdzona przez użytkownika** — liczby obrażeń zostają, zmienia się to, co opisuje demo; każdą zmianę
balansu opisz.

## Przeczytaj najpierw
`agents.md` (Kadłuby na belkach — cały akapit: trafienia tylko przez `HullBodies`, dwie masy, żar skóry; Pociski),
`docs/webgpu/DEMO-BRONIE.md` (§ Rany na kadłubie, § Znalezione w grze — pola nieczytane), `docs/PORT-silnik-belek.md`,
`docs/webgpu/POSTEP.md` (wyniki 04, 12, 17), memory: rany (świeci BRZEG rany, biel 8–12 HDR — nie odłamki),
`dema/bronie-webgpu/hull.js`, `projectiles.js` (przebicia, rykoszety), `gunnery.js` (ładowanie, serie), `recipes.js`
(`impact`, rzaz, wylot), `src/game/hullBodies.js`, w `index.html` grep: `bulletsAndCollisionsStep`, `applyImpact`,
`HullBodies.sweep`, `HullBodies.impact`; testy: `hullBodies`, `projectileTrajectory`, `projectileHexSweep`, `weaponAim`,
`lineOfFire`, `fleetBattle`, `npcWeaponSpecCap`, `beamWeapons3D`.

## Kroki
1. **Mapa ran na kadłubach:** tekstura uszkodzeń w uv sprite'a (skóra belek niesie uv, więc rany jadą z odkształceniem),
   kernele z `hull.js` (stempel trafienia, stygnięcie, osmalenie, przestrzelina z brzegiem, poświata jonowa). Pamięć:
   demo ma 512 × 256 na kadłub — w grze warstwy tablicy tekstur przydzielane kadłubom uszkodzonym / w kadrze (LRU,
   rozdzielczość od rozmiaru kadłuba), zmierz pamięć przy 125+ okrętach. Wrak dziedziczy rany rodzica (`convertToWreck`,
   `shatter`, `onWreck`). Materiał kadłuba (04) próbkuje mapę; żar skóry belek (`HULL_BODY_CONFIG.heatGlowPeak`) i mapa
   nie mogą się sumować do przepalonej bieli — jedno źródło żaru na piksel.
2. **Spójność z silnikiem belek:** prawdziwe wyrwy robi `HullBodies.impact` (krater z budżetem HP) — stempel mapy w tym
   samym miejscu i promieniu; przestrzelina na mapie tam, gdzie krater nie powstał (małe kalibry).
3. **Przebicia i rykoszety w rozgrywce:** wzorem dema (kąt padania, grubość z pola odległości / sondy `HullBodies.probe`)
   — pocisk przechodzi na wylot z mniejszą energią albo odbija się; obrażenia rozliczane jak dziś przez `HullBodies`.
   Deterministycznie (bez nowych `Math.random` w kolejności gry, albo z ziarnem trafienia), testy zachowania.
4. **Ładowanie i serie:** Mjolnir (`chargeTime`, `requiresStationary`) i Hexlance (`burstCount`) czytane przez gracza i
   AI; efekty ładowania z receptur (17). Pola `recoil` / `shake` / `impactScale` — dziś odrzut idzie z `FX_PROFILE`:
   zdecyduj jedno źródło (dane broni), opisz.
5. **Światła efektów na poszyciu:** materiał kadłuba czyta siatkę świateł z 12 jako DODATKOWE światła (błyski, trafienia,
   żar, wiązki) — model oświetlenia kadłuba i payload lamp statków bez zmian (przeniesienie lamp do siatki tylko, jeśli
   obraz identyczny i szybciej; pomiar „U hex”).
6. **Harness:** `galeria-broni` (17) rozszerzona o serie trafień w jeden kadłub (rany narastają i stygną) i przebicia.
7. **Testy:** nowe — przebicie / rykoszet / ładowanie / seria (logika, deterministycznie), przydział warstw mapy ran
   (LRU, wrak dziedziczy); stare bez nowych porażek (albo przepisane z opisem zmiany rozgrywki).

## Pułapki
- Trafienia i zapytania tylko przez `HullBodies` (agents.md) — nie pisz węzłów ani `body.pos` z gry.
- Mapa ran + żar skóry + lakier + maska słońca w jednym materiale — pilnuj pasm HDR (brzeg rany 8–12, reszta pod progiem).
- Setki kadłubów × tekstura na kadłub — pamięć i upload; compute tylko dla kadłubów z nowymi trafieniami / stygnących.
- Rozgrywka: przebicia zwiększają obrażenia w szeregu celów, rykoszety je zmniejszają — sprawdź bitwę flot (`fleetBattle`,
  wynik bitwy w harnessie) i opisz różnicę.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (zmiany zachowania opisane w commicie); nowe testy
  zielone.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/18`: zero błędów walidacji; `galeria-broni`, `bitwa`, `bitwa-blisko`
  obok zrzutów dema (rany, przebicia, oświetlenie poszycia).
- Bitwa `--wydajnosc` przed/po (w tym „U hex”, compute mapy ran, pamięć tekstur).
- `POSTEP.md` — lista zmian rozgrywki (przebicia, rykoszety, ładowanie, serie, odrzut) z liczbami; commit na `main`.

## Czego NIE robić
- Nie zmieniaj obrażeń bazowych, kadencji ani zasięgów broni; nie ruszaj logiki PD / flaku (testy `pointDefenseTargeting`,
  `flakSystem`) poza tym, co wymaga demo.
- Nie przenoś rakiet (19) ani wybuchu reaktora (20); wieżyczki zostają 2D.

## Raport na koniec
Co zrobione; zrzuty ran / przebić / oświetlenia obok dema; pamięć i koszt mapy ran; zmiany rozgrywki z liczbami; pytania.
