# AGENTS.md — przewodnik dla agentów

> **Cel pliku**: Krótki, praktyczny opis architektury gry „Super Capital: Battle for Solar System” i miejsc integracji. Trzymaj się poniższych zasad, aby uniknąć psucia warstwy grywalnej i wydajności.

---

## Szybka mapa repozytorium

- **`index.html`** — główna pętla gry i warstwa **2D (Canvas)** odpowiedzialna za sterowanie, fizykę, strzały, HUD itp. Tu jest większość logiki grywalnej.
- **`planet3d.proc.js`** — integracja z nakładką **Three.js** (planety/słońce). Wystawia globalne API: `initPlanets3D`, `updatePlanets3D`, `drawPlanets3D`. << obecnie proceduralne planety sa nieuzywane.
- **`planet3d.js`** (wariant deweloperski) — implementacja klas 3D: `Planet3D`, `Sun3D`, współdzielony renderer WebGL i rysowanie do prywatnych canvasków.
- **`package.json`** — minimalny serwer dev (`http-server`) i zależność `three`.
- **`planet3d.assets.js`**



---

## Pipeline renderowania

1. **Gra** działa w **2D Canvas** – tu dzieją się kolizje, bronie, ruch i HUD.
2. **Three.js** generuje obraz planet/słońca do **offscreen canvas** (jeden współdzielony `WebGLRenderer`).
3. Wynik jest **wklejany** do głównego Canvas w odpowiedniej kolejności (`drawPlanets3D`), tak aby 3D było **tłem/dekoracją** i **nie wpływało** na gameplay.

**Zasada żelazna**: _Nie twórz nowego renderera WebGL na każdy obiekt._ Korzystaj z **współdzielonego** renderera.

---

## Kluczowe byty gry

### Świat i kamera
- `WORLD`: rozmiar mapy (galaktyki).
- `camera`: powiększenie (zoom), limity, szybki zoom pod kółkiem myszy.

### Słońce i planety
- `SUN`: pozycja i promień słońca w świecie.
- `initPlanets3D(planets, SUN)`: tworzy obiekty 3D (`Planet3D`, `Sun3D`).
- `updatePlanets3D(dt)`: aktualizuje rotację/animację 3D.
- `drawPlanets3D(ctx, cam)`: wkleja wyrenderowane bitmapy 3D do głównego canvasa.

**Sun3D** – obecnie prosty materiał; można go zastąpić shaderem (patrz _Miejsca do pracy_).

### Stacje/NPC
- Planety i stacje są generowane proceduralnie; NPC latają między stacjami.

### Statek gracza
- Obiekt `ship`: rozmiary, masa, pozycja, prędkość, kąt, tłumienia.
- **Silniki**: `main`, `sideLeft`, `sideRight`, `torqueLeft`, `torqueRight` (ciąg/strafe/obrót).
- **Wieżyczka**: `ship.turret` z `angle`, `recoil`, limity prędkości/akceleracji.
- **Uzbrojenie główne**: Rail (podwójna lufa) – `triggerRailVolley()`, `fireRailBarrel()`.
- **Boczne salwy** (rakiety/plazma) – `requestSalvo(side)`, `fireSideGunAtOffset()`.
- **Specjal** – `tryFireSpecial()` (cooldown), obrażenia obszarowe.
- **Tarcza/Kadłub** – `ship.shield`, `ship.hull`.

### Pociski, kolizje, efekty
- Tablice `bullets`, `particles`.
- Funkcja `bulletsAndCollisionsStep(dt)` obsługuje ruch, namierzanie rakiet, trafienia i eksplozje.
- Efekty: `spawnParticle`, `spawnExplosionPlasma`, `spawnRailHitEffect`, `spawnDefaultHit`.

### Wejście i HUD
- Klawisze: W (ciąg), Q/E (strafe), A/D (obrót), LPM (rail), PPM (rakiety), F (specjal), SHIFT (warp), SPACJA (dopalacz), M (mapa), X (skan), R (lock).
- HUD na Canvas: paski, cooldowny, mini‑mapa, skan/radar.

### Gwiazdy (tło)
- Proceduralna siatka gwiazd w kafelkach 1024×1024 z LRU (utrzymujemy tylko ostatnio widziane kafle).

---

## Miejsca do pracy dla agentów

> **Krytyczna zasada**: _Warstwa grywalna musi pozostać w Canvas 2D._ Three.js jest dekoracją/warstwą wizualną. Nie ruszaj fizyki/kolizji/strzelania w 3D.

1. **Słońce (Sun3D)**  
   - Zastąp materiał słońca shaderem (granulacja, plamy, korona, lekkie bloom).  
   - **Nie zmieniaj API** (`Sun3D` musi dalej tworzyć `canvas` i renderować do niego; `drawPlanets3D` ma pozostać bez zmian).
   - Używaj **tego samego współdzielonego renderera** (patrz sekcja _Renderer współdzielony_).

2. **Planety (Planet3D)**  
   - Drobne ulepszenia materiałów (emisja miast w nocy, albedo).  
   - Zachowaj rozmiar i podpisy – gameplay liczy na to, że planety to tło.

3. **Statek 3D — tylko jako _overlay dekoracyjny_ (opcjonalnie)**  
   - Jeśli potrzebny model 3D statku, renderuj go do **osobnego offscreen canvas** i **wklejaj** POD warstwą HUD, ale NAD tłem 3D.  
   - **Nie** ingeruj w sterowanie/kolizje – 2D jest źródłem prawdy.

4. **Wydajność**  
   - Nie alokuj zasobów w pętli; recyklinguj geometrie/meshe/tekstury.  
   - Jedna instancja `WebGLRenderer` na całe 3D (patrz _Renderer współdzielony_).  
   - Uważaj na `devicePixelRatio` – limituj do 2x.

5. **Kolejność rysowania**  
   - Porządek: **tło 3D** → **świat gry 2D** → **HUD/efekty**.

---

## Renderer współdzielony (ważne)

- Funkcja `getSharedRenderer(w, h)` zwraca jeden wspólny `THREE.WebGLRenderer` (alpha=true, antialias=true).  
- Każdy obiekt 3D ma **prywatny 2D canvas** (`this.canvas`), do którego kopiujemy wynik `r.domElement`.  
- Dzięki temu mamy jeden kontekst WebGL i wiele bitmap 2D do łatwego wklejania w głównej warstwie.

---

## Konwencje PR dla agentów

- **Nie** dodawaj frameworków (np. React) ani bundlera – projekt jest „vanilla”.
- **Nie** zmieniaj publicznego API `initPlanets3D/updatePlanets3D/drawPlanets3D`.
- **Tak**: małe, izolowane PR-y z jasnym opisem.  
- Dołącz GIF/PNG z porównaniem „przed/po”.

### Lista kontrolna PR
- [ ] Brak nowych globali (poza parametrami w obrębie 3D).  
- [ ] Jedna instancja `WebGLRenderer` (współdzielona).  
- [ ] Bez alokacji w pętli (`animate`/`render`).  
- [ ] FPS bez spadków (profiluj `performance.now()`).  
- [ ] Warstwa grywalna (2D) nietknięta.

---

## Słownik symboli / nazewnictwo
- **ship** – statek gracza (pozycja, kąt, silniki, wieżyczka, broń).  
- **rail** – podwójne działa z recoil.  
- **side guns / salvos** – boczne salwy rakiet/plazmy.  
- **stations** – stacje orbitalne wokół planet.  
- **npcs** – proste cele/transporty między stacjami.  
- **scan/radar** – falowe skanowanie i pingowanie celu.

---

## FAQ dla agentów

**Czy można przepisać wszystko do Three.js?**  
Nie. Gameplay pozostaje w 2D Canvas. Three.js służy do tła (planety/słońce) i ewentualnie lekkich _overlays_.

**Gdzie wpiąć nowe efekty 3D?**  
W klasach `Planet3D`/`Sun3D` oraz w ich `render()`. Zachowaj API i współdzielony renderer.

**Jak kontrolować kolejność rysowania?**  
Używaj tylko `drawPlanets3D` do wklejenia bitmap 3D, reszta dzieje się w głównym rysowaniu gry.

**Czy robić screenshot?**  |
Nie, nie rób screenshota, gra jest za duza abyś mógł ją odpalić.
---

> Masz pytania? Dodaj komentarz do PR lub zostaw TODO w kodzie z prefiksem `AGENT:` (np. `// AGENT: replace Sun3D material with shader`).

