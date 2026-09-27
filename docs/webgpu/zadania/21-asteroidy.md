# Zadanie 21 — Asteroidy z dema `asteroidy-webgpu` w grze (pola, skały, minerały, olbrzymy, światło wolumetryczne, burze)
Zależności: 12, 04, 05 + zakończona sesja dema asteroid (commit na `main`) | Równolegle z: 13–20 (bez zmian w `src/3d/fx/`) | Zalecany effort: max
Zakres: moduły dema `dema/asteroidy-webgpu/` (opis: `docs/webgpu/DEMO-ASTEROIDY.md`, w tym sekcja „Do portu w grze”, jeśli
sesja dema ją dopisała) → gra (`src/3d/asteroids/`): `rockBank.js`, `rockNoise.js`, `rockMaterial.js`, `rockLayers.js`,
`minerals.js`, `giants.js`, `volumetrics.js`, `spotShadows.js`, `storm.js`, `sparks.js`, `fog.js`, `sunMap.js`, części
`sky.js` (zasłona gęstego pola, noc w polu, błyski burzy) i `world.js` (pole, miejsca, cień pól); siatkę świateł scala 12.
Gra: moduły rozgrywki `src/game/asteroidBeltField.js`, `asteroidStorms.js`, `asteroidDestructor.js`
(`resolveShipAsteroidCollision`), `asteroidRockKinds.js`, `asteroidGiants*.js`; stare pole `src/3d/asteroidField3D.js`
(sprite'y + rozgrywka + promocja do ciał heksowych, dziś WYŁĄCZONE: `OLD_ASTEROIDS_ENABLED`) i `asteroidBeltBackdrop3D.js`.

## Cel
Decyzja użytkownika 2026-09-27: „asteroidy zaraz będą production ready — zielone światło”. Pasy asteroid w grze to pola z
dema WebGPU (typy skał i rud, minerały, olbrzymy z tunelami, światło wolumetryczne z cieniami skał, reflektory statków,
burze z piorunami) w scenie Core3D, a rozgrywka pól działa: kolizje statków ze skałami, trafienia pocisków, wydobycie /
łup, burze — co najmniej to, co robiło stare pole, na nowych danych. Stare pole i tło pasa znikają z kodu.

## Przeczytaj najpierw
`agents.md`, `docs/webgpu/DEMO-ASTEROIDY.md` (cały, zwłaszcza decyzje, ustalenia three, uproszczenia i — jeśli jest — „Do
portu w grze”), memory: przebudowa asteroid, burze, kryształy, olbrzymy, demo WebGPU pola asteroid, `docs/webgpu/PLAN.md`
§3–§6, `docs/webgpu/POSTEP.md` (wyniki 04, 05, 12), `dema/asteroidy-webgpu.js` (jak demo składa klatkę i świat),
`src/3d/asteroidField3D.js` (grep: `update`, `_resolveActiveAsteroidImpacts`, `_promoteAsteroidToHex`,
`segmentCircleHitInfo`, `findNearest` — co robiło stare pole dla rozgrywki) i jego wywołania w `index.html` (grep:
`asteroidField`, `OLD_ASTEROIDS_ENABLED`, `beltBackdrop`), testy `asteroid*`.

## Kroki
1. **Stan dema:** sprawdź, że sesja dema skończyła (`git log` — commit dema asteroid na `main`, brak jej niezacommitowanych
   zmian) i przeczytaj jej notatkę integracyjną. Jeśli notatki brak — wypisz z kodu dema: moduły produkcyjne vs pokaz,
   API, zależności, budżety.
2. **Render w Core3D:** skały (warstwy pasm z budżetem, LOD per skała, bank kształtów w tablicach tekstur), minerały,
   olbrzymy (raymarching z głębią), mgła, niebo pola — w passach Core3D (warstwy jak w demie: płytkie w passie gry,
   głębokie w passie tła); materiały na siatce świateł z 12; światło wolumetryczne (froxele, compute) z dodawaniem
   całki w materiałach passa gry — także w materiale KADŁUBA (04), żeby kadłub w pyle wyglądał jak w demie; atlas map
   cienia reflektorów statków (lampy statków z edytora gniazd: `light_flood` / profile `FIELD_SHIP_LIGHTS`).
3. **Precyzja:** demo trzyma lokalny początek przy kamerze (przeskok po 20 tys. j.) — w grze początek przy kamerze z 12;
   pasy leżą przy 5–10 mln j.
4. **Rozgrywka pól** (bez zmiany zasad, na nowych danych): pozycje i typy skał z `asteroidBeltField.js` (deterministycznie
   — to samo ziarno co render), kolizje statków (`resolveShipAsteroidCollision` / nośnik: agents.md § Kadłuby — trafienia
   i styk tylko przez `HullBodies` dla kadłubów), trafienia pocisków (siatka przestrzenna jak w starym polu), niszczenie
   i odłamki (stare pole promowało skały do ciał heksowych — jeśli demo ma własny model rozpadu, użyj go; jeśli nie,
   zachowaj dzisiejsze zachowanie na nowych kształtach i opisz), wydobycie / łup (jak stare pole: `salvage`,
   surowce z `resources.js`), burze (`asteroidStorms.js` — pioruny jako zagrożenie tylko, jeśli tak jest w grze dziś).
5. **Włączenie i sprzątanie:** `OLD_ASTEROIDS_ENABLED` i `?asteroidyStare` znikają; `asteroidField3D.js` (render) i
   `asteroidBeltBackdrop3D.js` usunięte; rozgrywka przeniesiona do nowego modułu; hak cienia pól (`uFieldOcc`, okrągłe
   przesłaniacze skał w masce słońca z 03) zasilony z nowego pola.
6. **Harness:** sceny pola (gęste pole, głąb pola, burza, olbrzym) w `zrzuty.mjs` — obok zrzutów dema (te same miejsca
   i zoom); baza przyszłych porównań = zatwierdzony przebieg z `main`.
7. **Testy:** `asteroid*` (logika pola, burz, olbrzymów) bez nowych porażek; testy starego pola (`asteroidHexAdapter`,
   `asteroidFieldLight`) — zostaw, przepisz albo usuń razem z modułem (opisz); nowe — kolizja statku ze skałą, trafienie,
   łup.

## Pułapki
- Limit 12 buforów uniform na etap (ustalenia dema) — pakuj tablice.
- `renderer.setAnimationLoop(null)` nie zatrzymuje wewnętrznej pętli; `pass()`/`BloomNode` mają `updateBeforeType = FRAME`
  (ustalenia dema) — Core3D renderuje passy ręcznie, sprawdź, czy nic z dema nie zakłada `pass()`.
- Koszt: demo 1,5–3 ms GPU w scenach pola (2560 × 1440), ~4 ms przy 1024 światłach — w grze pole + bitwa naraz; budżety
  i LOD, pomiar `--wydajnosc` w polu.
- Pył fizyczny usunięty decyzją użytkownika — nie przywracaj.

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (zmiany testów starego pola opisane).
- Harness: zero błędów walidacji; sceny pola obok dema; sceny bez pól bez regresji.
- Rozgrywka: kolizja, trafienie, zniszczenie i łup działają (test + zrzut), burze działają.
- W kodzie gry nie ma `OLD_ASTEROIDS_ENABLED`, starego renderu pola ani tła pasa; `INWENTARZ.md` bez GLSL asteroid w
  grze; `agents.md` (asteroidy: gdzie render, gdzie rozgrywka, jak dodać typ skały); commit.

## Czego NIE robić
- Nie zmieniaj ekonomii (ceny, wydajność wydobycia) ani zasad kolizji poza przeniesieniem na nowe dane.
- Nie przywracaj pyłu fizycznego; nie edytuj dema.

## Raport na koniec
Co zrobione; zrzuty pól gry obok dema; wydajność w polu i w bitwie w polu; zmiany rozgrywki (jeśli jakieś); pytania.
