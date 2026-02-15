# AGENTS.md — aktualny przewodnik dla agentów

> **Cel pliku**: krótki, praktyczny opis aktualnej architektury gry „Super Capital: Battle for Solar System” i miejsc integracji. Trzymaj się tych zasad, żeby nie psuć gameplayu i wydajności.

---

## Szybka mapa repozytorium

- **`index.html`** — główna pętla gry i warstwa **2D Canvas** (sterowanie, fizyka, strzały, HUD, UI).
- **`src/3d/core3d.js`** — **jedyny współdzielony rdzeń WebGL** (`renderer`, `scene`, `camera`, `composer`, bloom, alpha pass).
- **`src/3d/hexShips3D.js`** — aktualizacja i render statków/hexów 3D; końcowe wywołanie renderu 3D (`Core3D.render()`) i kopiowanie na 2D.
- **`src/3d/world3d.js`** — obiekty świata 3D (np. piracka stacja), podpinane do `Core3D.scene`.
- **`src/3d/stations3D.js`** — stacje 3D, podpinane do `Core3D.scene`.
- **`planet3d.assets.js`** — aktywna warstwa planet/słońca (API globalne: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`).
- **`planet3d.proc.js`** — wariant legacy/proceduralny (nie używać jako głównej ścieżki bez wyraźnej potrzeby).
- **`src/game/destructor.js`** — silnik destrukcji heksów (fizyka kolizji, deformacje, splity, debris).
- **`src/game/shipEntity.js`** — konfiguracja i geometria statku gracza (fizyka wejścia, offsety, thrusters, hardpointy).
- **`package.json`** — serwer dev i zależności.

---

## Pipeline renderowania (aktualny)

1. **Gameplay i fizyka** dzieją się w 2D (`index.html`, `destructor.js`, logika broni/NPC/HUD).
2. W `render(alpha, frameDt)` aktualizowane są moduły 3D:
   - `updatePlanets3D(frameDt, cam)`
   - `updateStations3D(stations)`
   - `updateWorld3D(frameDt, vfxTime)`
   - `updateHexShips3D(cam, hexEntities)`
3. Finalna klatka WebGL jest kopiowana na główny canvas przez `drawHexShips3D(ctx, W, H)`.
4. HUD/overlays 2D są rysowane na końcu.

**Zasada żelazna**: _Nie twórz nowych instancji `THREE.WebGLRenderer` poza `Core3D`._

---

## Kluczowe byty gry

### Świat i kamera
- `WORLD` — rozmiar mapy.
- `camera` — zoom, limity, tryby śledzenia/focus.

### Planety i słońce
- `initPlanets3D(planets, SUN)` — inicjalizacja.
- `updatePlanets3D(dt, cam)` — aktualizacja.
- Planety są częścią wizualnej warstwy 3D, gameplay nadal jest liczony w 2D.

### Stacje i obiekty 3D
- `updateStations3D(stations)` — synchronizacja stacji 2D -> 3D.
- `updateWorld3D(dt, t)` — aktualizacja obiektów świata 3D.

### Statek gracza
- Obiekt `ship`: pozycja, kąt, prędkość, masa, shield/hull.
- Sterowanie i fizyka gracza: `shipEntity.js`.
- Destrukcja i kolizje heksów: `destructor.js`.

### Pociski, kolizje, efekty
- Tablice `bullets`, `particles`.
- `bulletsAndCollisionsStep(dt)` — ruch, trafienia, eksplozje, applyImpact.

### Wejście i HUD (aktualne skróty)
- `W/S` — ciąg przód/tył
- `Q/E` — strafe
- `A/D` — obrót
- `LPM` — rail
- `PPM` — rakiety/specjal zależnie od stanu
- `F` — specjal
- `Shift` — warp/boost (kontekstowo)
- `M` — mapa
- `X` — scan
- `T` — lock target
- `R` — repair/heal (destructor)
- `P` — panel wydajności
- `Space` — pauza

---

## Miejsca do pracy dla agentów

> **Krytyczna zasada**: gameplay (fizyka, kolizje, damage, input) pozostaje źródłem prawdy w **2D**. 3D jest warstwą renderingu.

1. **Core3D (`src/3d/core3d.js`)**
   - Modyfikacje renderera/composera/blooma/alpha-pass rób wyłącznie tutaj.
   - Nie duplikuj postprocessingu w innych modułach.

2. **Moduły 3D (`world3d.js`, `stations3D.js`, `hexShips3D.js`)**
   - Używaj `Core3D.scene` i `Core3D.camera`.
   - Nie twórz lokalnych rendererów ani dodatkowych canvasów WebGL.

3. **Destruction + ship integration**
   - Zachowaj spójność osi/rotacji między `shipEntity.js` i `destructor.js`.
   - Unikaj alokacji w gorących pętlach (kolizje, spatial queries, contact buffers).

4. **Wydajność**
   - Bez nowych alokacji per-frame tam, gdzie da się użyć pooli/buforów.
   - Profiluj przez `PerfHUD` (`performance.now()`), szczególnie: physics/draw/3D update.

5. **Kolejność rysowania**
   - 3D world pass -> 2D world/HUD.
   - Nie przywracaj starych, równoległych ścieżek `drawPlanets3D`/`drawStations3D`/`drawWorld3D` jako osobnych finalnych passów, jeśli render jest już zunifikowany przez `Core3D`.

---

## Konwencje PR dla agentów

- Nie dodawaj frameworków ani bundlera.
- Trzymaj zmiany małe i izolowane.
- Nie zmieniaj API bez potrzeby i opisu skutków.
- Zachowuj kompatybilność warstwy grywalnej 2D.
- Nie rób screenshotów z gry w ramach pracy agenta (za ciężki runtime / duży kontekst).

### Lista kontrolna PR
- [ ] Brak nowych rendererów WebGL poza `Core3D`.
- [ ] Brak alokacji w pętli render/update tam, gdzie były bufory/pule.
- [ ] Brak regresji sterowania i kolizji 2D.
- [ ] Spójność osi/rotacji (sprite, thrusters, impact/local transforms).
- [ ] Mierzalna poprawa lub brak regresji FPS.

---

## FAQ

**Czy można przepisać gameplay do Three.js?**
Nie. Gameplay pozostaje w 2D Canvas.

**Gdzie dodawać nowe efekty 3D?**
W `src/3d/*`, z wykorzystaniem `Core3D`.

**Czy można dodać drugi bloom/composer lokalnie w module?**
Nie. Postprocessing powinien być centralny w `Core3D`.

**Jak zostawić notatkę dla kolejnych agentów?**
Dodaj TODO z prefiksem `AGENT:`.

---

> Uwaga techniczna: trzymaj `AGENTS.md` w kodowaniu UTF-8.