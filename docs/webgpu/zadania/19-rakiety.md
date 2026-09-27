# Zadanie 19 — Rakiety z dema `rakiety-webgpu`: dym GPU, dysze, kule ognia, Supernowa, iskry
Zależności: 12 (+ 04 dla cienia dymu na kadłubach) | Równolegle z: 05–11, 13–16, 17–18 (bez zmian w `src/3d/fx/`) | Zalecany effort: max
Zakres: z dema do gry (`src/3d/rockets/`): `smoke.js` (`SmokeSystem`: compute, mapa gęstości, samocień, światło z
siatki), `plumes.js`, `missileBodies.js`, `fireballs.js`, `sparks.js`, `arcs.js`, `nebula.js` (pozostałość Supernowej),
`effects.js` (reżyser: `onLaunch` / `onIgnite` / `onFly` / `onDetonate`, światła, duszki, siły w dymie,
zniekształcenia), `palette.js`; szum z `src/3d/fx/` (12). W grze: render `src/effects3d/rocketSystem3D.js` (siatka rakiet)
i jego pule `rocketFireGPU.js` (1 / 213) i `rocketSmokeGPU.js` (1 / 74), `supernovaMissileBlow.js` (2 / 230), fala
refrakcji Supernowej (`shockwave3D.js` — po 03), iskry `src/3d/sparkSystem3D.js` (1 / 112, scena overlay).

## Cel
Rakiety manewrujące, szybkie i Supernowa wyglądają jak w demie (decyzja użytkownika 2026-09-27: „rakiety — super”,
wdrażać przy porcie). **Model lotu, trafienia i obrażenia zostają w `rocketSystem3D.js`** (gameplay; demo go tylko
odtwarza). Rakiety przechodzą z warstwy raw overlaya do sceny Core3D. Iskry trafień i tarcia (`SparkSystem3D`) —
na `sparks.js` z dema („w wyglądzie `sparkSystem3D.js` gry”) w Core3D, API JS bez zmian.

## Przeczytaj najpierw
`agents.md` (Nośnik — rakiety w stałym układzie wyrzutni; Pociski — iskry tarcia `COLLISION_SPARKS_TUNE`, `gain`),
`docs/webgpu/DEMO-RAKIETY.md` w całości (decyzje, HDR, Supernowa, § Do portu w grze, ustalenia three), memory: demo
rakiet (bug V — siła śladu tylko na dym > 0,8 s), `docs/webgpu/POSTEP.md` (wyniki 12), `dema/rakiety-webgpu.js` + moduły,
`src/effects3d/rocketSystem3D.js` (grep: `fire`, `update`, `_onHit`, `burst`, `pushHeatHazeWorld`), `src/3d/sparkSystem3D.js`
(API: `init`, `emit`, `burst`, `update`), `src/vfx/collisionSparks.js`, `src/vfx/canvasParticleSystem.js` (wywołania
iskier), testy: `rocketGuidance`, `renderBugfixGuards` (cząstki rakiet, haze rakiet), `collisionSparks`, `collisionFx`,
`shaderPrewarm`, `renderPerfGates`.

## Kroki
1. **Zdarzenia lotu:** `rocketSystem3D` zgłasza start, zapłon, lot (pozycja, kurs, ciąg — co klatkę), detonację
   (punkt, trafiona encja, normalna) do `Effects` z dema; jego siatka i pule `RocketFireGPU` / `RocketSmokeGPU` znikają.
   Lot, naprowadzanie, trafienia i obrażenia bez zmian (test `rocketGuidance`). Torpedy i Osa (ścieżka 2D) — poza zadaniem.
2. **Dym:** `SmokeSystem` w kroku compute (12): pierścień cząstek, mapa gęstości (render do celu HalfFloat) → samocień
   i światło z siatki świateł; dym względem początku przy kamerze (demo: stały początek O + powrót po 60 tys. j.) —
   w grze początek przy kamerze z przesunięciem żywych danych (12). Siła śladu rakiety tylko na dym > 0,8 s (bug V).
3. **Dysze, kadłubki, kule ognia, łuki, duszki** — do passa ortho z `renderOrder` z dema; światła dysz i błysków →
   siatka świateł; zniekształcenia (fala, implozja, gorące powietrze) → API z 12 (zastępują `pushHeatHazeWorld` rakiet).
4. **Supernowa:** sekwencja z dema (implozja wsysa dym → błysk z linią anamorficzną → fala: refrakcja + wymiatanie dymu →
   pozostałość z włókien → stygnące jądro) zastępuje `supernovaMissileBlow.js` i falę `shockwave3D` (jeśli nic innego
   jej nie używa — sprawdź; wybuchy reaktora jej nie odpalają od 2026-09-24).
5. **Iskry:** `sparks.js` jako nowy `SparkSystem3D` w Core3D — te same funkcje (`init`, `emit(pX, pY, vX, vY, life,
   size, gain)`, `burst`, `update`), barwa per wywołanie zamiast jednej globalnej (dziś wszystkie pomarańczowe —
   `DEMO-BRONIE.md`); scena overlay przestaje mieć iskry (`startOverlay3D`: `SparkSystem3D.init(ov.scene)`).
6. **Cień dymu na kadłubach** (mapa gęstości, jak w demie) — jeśli koszt w bitwie jest mały; inaczej opisz i zostaw.
7. **Otwarte w demie:** rakieta w tarczę (dziś bez kuli ognia — receptura tarczy do zrobienia: zaproponuj i pokaż
   zrzut), LOD gęstości smug przy dalekim zoomie (gra schodzi do 0,05), dym vs asteroidy (wyłączone — pomiń).
8. **Harness:** scena `galeria-rakiet` (salwa w pirata, Supernowa, trafienie z bliska — ziarno sceny, stały kadr);
   baza przyszłych porównań = zatwierdzony obraz z `main`.
9. **Testy:** `renderBugfixGuards` („cząstki rakiet: zakresy uploadu…”, „haze … rakiet w osi sceny”) → odpowiedniki dla
   nowych systemów; `collisionSparks` / `collisionFx` przez API iskier — bez zmian; `rocketGuidance` bez zmian.

## Pułapki
- Rakiety w bitwie: salwy wielu okrętów naraz — budżet cząstek dymu i LOD (demo: 96 rakiet ≈ 165 tys. cząstek, GPU
  ~1,1 ms na RTX 5080); zmierz bitwę `--wydajnosc` przed/po.
- Nośnik: układ rakiety = pęd wyrzutni (stały); smuga = porcje gazu z nośnikiem (agents.md, DEMO-RAKIETY).
- Rakiety leciały w warstwie raw overlaya NAD efektami — w passie ortho ustaw kolejność tak, żeby kadłubek i dysza nie
  ginęły pod dymem.
- `pow(uv.x, k)` w iskrach dało NaN → czarny ekran przez bloom (memory demo rakiet) — kwadraty jako `x·x`.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/19`: zero błędów walidacji; bez regresji w scenach bez rakiet;
  `galeria-rakiet` i sceny bitwy obok zrzutów dema (`dema/rakiety-webgpu.html?scenario=…&shot=1`) do oceny użytkownika;
  iskry tarcia i trafień widoczne w Core3D (scena overlay bez iskier i rakiet).
- Bitwa `--wydajnosc` przed/po; pierwsza rakieta i pierwsza Supernowa bez przestoju kompilacji.
- `INWENTARZ.md` (usunięte: `rocketFireGPU`, `rocketSmokeGPU`, `supernovaMissileBlow`, stary `sparkSystem3D`),
  `POSTEP.md`, `agents.md` (Nośnik — rakiety; iskry); commit na `main`.

## Czego NIE robić
- Nie zmieniaj lotu, naprowadzania, zapalników ani obrażeń rakiet; nie ruszaj torped i Osy (2D).
- Nie usuwaj overlaya (20) — tylko zabierz z niego rakiety i iskry.

## Raport na koniec
Co zrobione; zrzuty gry obok dema (salwa, Supernowa, trafienie, bitwa); wydajność przed/po; propozycja receptury tarczy;
co zostało; pytania.
