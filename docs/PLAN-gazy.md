# Gazy w grze — plan (2026-10-07)

Źródło: ocena dema `dema/gazy-webgpu.html` i wymagania użytkownika z 2026-10-07. Demo nie idzie do gry 1:1
(własny renderer, kamera perspektywy zamiast ortho, pył w pudle wokół kamery — stąd „ściany”, pył stoi przy
5–10 mln j.). Z dema bierzemy pomysły i shadery, budujemy moduły na Core3D.

## Czego chce użytkownik

1. Pył w halach K-7 i dokach: okręt rufą do ściany odpala silnik, pył uderza w ścianę — ma dobrze wyglądać.
2. Fabryki z dymem — ring Jowisza ma ich mieć dużo (jak scena ringu w demie).
3. Gaz w pasie asteroid: od uderzeń w skały i w samym polu.
4. Skupiska gazu: małe okręty mogą się w nich chować, gaz da się zbierać jako surowiec.
5. Opcjonalnie: chmury i anomalie burzowe.

## Decyzje użytkownika

- Gaz ogranicza widoczność **w obie strony** (także graczowi).
- Chowanie się: myśliwce, fregaty i niszczyciele — całkowicie; większe okręty — tylko krótszy zasięg wykrycia.
- Zbieranie gazu: **osobne statki** (zbieracze). Są sprite'y zastępcze (`assets/heavy_harvester.png`,
  `assets/tanker.png`), samych statków w grze jeszcze nie ma.
- Kolory obłoków: do potwierdzenia porównaniem A/B. Propozycja: kolor = skład = surowiec (hel-3, metan, amoniak —
  `src/data/resources.js`), barwy stonowane, mocniejsze tylko w środku bogatego obłoku.

## Dwie techniki

- **Dym z cząstek** — źródła punktowe (kominy, obłoczki po uderzeniach). Pula dymu rakiet
  (`src/3d/rockets/effects.js`: compute, samocień, światło z siatki); wzór nowego źródła — `RocketEffects.torpedoWake`.
- **Pole gazu 2D** — obszary reagujące na silniki i broń (`src/3d/gasField/gasField2D.js`: płyn z przeszkodami,
  pył w powietrzu i na podłożu).

## Szew gra ↔ render (uzgodniony z sesją „Rendering w workerze”)

Gra pakuje wejście klatki do Float64Array o stałym układzie (czysta funkcja, bez referencji do encji), krok
`Core3D.addFxStep` czyta tylko tę tablicę i `EngineFrame`. W `src/3d/gasField` bez `window`, DOM i
`requestIdleCallback`; czas = dt gry z wejścia. Rozgrywka gazu (chowanie, zbieranie) liczy stan rozstrzygający po
stronie gry na CPU — GPU tylko obraz (ewentualny odczyt GPU wyłącznie asynchroniczny, z tolerancją opóźnienia).

## Etapy

1. **Hale K-7 — ZROBIONE (2026-10-07).** `src/3d/gasField/`, `src/game/hallDustInput.js`; opis w AGENTS.md
   (§ „Pył i para w halach K-7, światła hali”). Tego samego dnia (uwaga użytkownika: gaz „leży i jest niewidoczny”,
   brak źródła) — PARA z przewodów paliwowych, szpul i zaworów magazynów (`hallGasSources.js`, mocniej przy
   odcumowaniu), oświetlenie hali (`haloPortK7Lights.js`: lampy, reflektory, migające soczewki w trzech barwach) w siatce
   świateł i SNOPY w mgiełce hali. Kadłuby rozcinają gaz SWOIM OBRYSEM (maska z żywych węzłów siatki belek,
   `src/game/hullFootprint.js`; uwaga użytkownika: „odbicie” statku w dymie było prostokątne) z prędkością obrotu
   kadłuba — wzór dla każdego kolejnego pola gazu z okrętami. Do zrobienia przy okazji: zatoki portu (`registry.bays`, inny układ), dysze SIDE
   (manewry też podnoszą kurz), automat dokowania w grze swobodnej (przewody podpinają się dziś tylko w kampanii),
   „słoje” faktury pyłu w rdzeniach wirów przy ścianie (pole pozycji spoczynkowych — dwie fazy z przenikaniem).
2. **Asteroidy.** (a) Uderzenia w olbrzymy i wydobycie (lasery, piła, ładunki) → obłoczki z puli dymu w barwie
   skały (lód — para, metal / krzemian — rdzawy pył). (b) Gaz w polu: mieszanka z dema sterowana mapą pola
   (`src/3d/asteroids/fieldMap.js`: gęstość pyłu, udział lodu, natężenie burzy) — ZAMIAST płytkich płatów
   `fog.js`, nie obok (inaczej dwie mgły). Ruch: pole gazu przy kamerze (przeloty, wybuchy).
3. **Fabryki.** Kominy z planów ringów: Jowisz — sektory „przemysł ciężki” planu Fable
   (`src/3d/haloRing/arch/fablePlan.js`, strefy `FZ.INDUSTRIAL`, walce kominów), Ziemia — pas fabryczny wokół K-7
   (zestaw przemysłowy, bliźniak CPU `indKitPart`). Dym z puli rakiet na wysokości komina, od ringu w kosmos
   z dryfem wzdłuż orbity; chłodnie — para, pochodnie — światło w siatce. Tylko kominy blisko kamery.
4. **Skupiska gazu.** Obiekt świata (kształt, skład, gęstość — ta sama funkcja na CPU i GPU), czujniki
   (`SensorSystem.hides`, mgła wojny gracza, `fleetAwareness` AI) wg decyzji wyżej, przeloty i broń rozpychają gaz
   (kanał zdradza okręt), zbieracze (statki do wdrożenia), surowce z `resources.js`.
5. **Burze (opcja).** Obłok z ładunkiem: pioruny i błyski z `StormSimulator` (`src/game/asteroidStorms.js`) i
   `src/3d/asteroids/storm.js`; czy szkodzą — decyzja użytkownika.
