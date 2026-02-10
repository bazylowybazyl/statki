# WebGPU port destrukcji hybrydowej (`destruktorhybrid.html`) — raport feasibility + plan + benchmark

## 1) Feasibility

### Co można przenieść 1:1 na GPU compute (WGSL)

1. **Broadphase entity↔entity / shard↔shard** jako pass typu data-parallel:
   - obecnie CPU robi O(N²) po encjach i lokalne filtrowanie po mapie shardów (`resolveCollisions`, `collideEntities`),
   - logika odrzucenia po `radSum` i testach odległości nadaje się do równoległego pair filtering.
2. **Impulse solve + separation**:
   - wyliczenie normalnej, relatywnej prędkości, impulsu i korekty penetracji to operacje arytmetyczne,
   - może działać jako iteracyjny compute pass z buforem kontaktów.
3. **Deformacja/plasticity/damage propagation**:
   - `impactForce > yieldPoint` i rozdział uszkodzeń po shardach może iść przez bufor wpływów,
   - aktualizacja `hp`, `targetDeformation`, flag shardów i emisji debris też jest naturalna dla compute.
4. **Integracja debris / relaksacja deformacji**:
   - PoC w tym PR już to robi na GPU (WGSL) na realnych shardach.

### Co wymaga refaktoru

1. **Model pamięci**:
   - aktualny kod bazuje na obiektach JS (`HexShard`) + referencjach (`neighbors`) i mapach stringowych,
   - GPU potrzebuje **SoA/flat buffers** oraz indeksów zamiast referencji obiektowych.
2. **Rozdzielenie backendu fizyki od renderu 2D**:
   - dziś logika fizyki jest sprzężona z rysowaniem i cache canvas,
   - trzeba utrzymać czysty interfejs `physics.step(dt)` + synchronizacja stanu do renderu.
3. **Losowość i deterministyczność**:
   - fragmenty typu `Math.random()` (frays/debris spin) rozjeżdżają replay,
   - dla porównania CPU/GPU wymagany seedowany RNG i fixed dt.
4. **Kolejkowanie split/debris**:
   - `splitQueue` / `findIslands` (BFS po neighborach) jest grafowe i nieregularne,
   - najlepiej etapowo: detekcja uszkodzeń na GPU, finalny split/topologia początkowo na CPU.

### Ryzyka i ograniczenia

- **Readback GPU→CPU**: drogi, nie robić co klatkę (PoC używa okresowej synchronizacji).
- **Atomiki i kolejność kontaktów**: solver kontaktów może dawać inne mikro-wyniki niż CPU (nondeterminism).
- **Brak WebGPU na części urządzeń**: wymagany fallback CPU (dodany).
- **Numerical drift**: różnice FP32 CPU vs GPU przy wielu iteracjach kontaktów.

---

## 2) Projekt architektury danych GPU (SoA / layout)

### Proponowane buffery

1. `EntityStateBuffer` (SoA):
   - `posX[], posY[], velX[], velY[], angle[], angVel[], invMass[], radius[]`
2. `ShardStateBuffer` (SoA):
   - `entityId[]`, `localX[]`, `localY[]`, `worldX[]`, `worldY[]`,
   - `deformX[]`, `deformY[]`, `targetDefX[]`, `targetDefY[]`,
   - `hp[]`, `flags[]` (bitmask: active/debris/damaged)
3. `NeighborIndexBuffer`:
   - CSR-like: `neighborOffset[]`, `neighborCount[]`, `neighborIds[]`
4. `BroadphaseGridBuffer`:
   - `cellHeads[]`, `next[]`, `cellShardIds[]` (spatial hash)
5. `ContactBuffer`:
   - `contactA[]`, `contactB[]`, `normalX[]`, `normalY[]`, `penetration[]`, `impulseAcc[]`
6. `DamageEventBuffer`:
   - `shardId[]`, `forceX[]`, `forceY[]`, `energy[]`

### Mapowanie entity/shard/contact

- `entityId` w każdym shardzie jako klucz do masy/prędkości.
- Kontakty zapisane jako para indeksów shardów (lub shard↔entity).
- Damage pass zbiera wpływy i redukuje je do shardów (sumowanie atomikami lub segmented reduction).

---

## 3) Plan migracji etapowej

### Etap 1 — broadphase na GPU
- Zbudować spatial hash w compute (wstawienie shardów/colliderów do komórek).
- Wygenerować kandydatów kontaktu (pair filtering) do `ContactBuffer`.
- Zachować narrowphase + impulse na CPU (walidacja zgodności).

### Etap 2 — collision + impulse na GPU
- Narrowphase shard↔shard jako compute pass.
- Iteracyjny solver impulsów (normal + friction + separation) na GPU.
- CPU zostaje tylko orkiestratorem i renderem 2D.

### Etap 3 — damage/debris/split + optymalizacje
- Damage propagation i update `hp/deformation` na GPU.
- Debris spawn/update na GPU, split pipeline hybrydowo (topologia początkowo CPU).
- Optymalizacje: mniej readbacków, batched dispatch, ping-pong buffery, profilowanie passów.

---

## 4) PoC implementacji (ten PR)

Nowy plik: **`src/game/destruktorhybrid.webgpu.html`**

Zawartość:
- standalone demo (bez integracji z główną grą),
- backend `WebGPUBackend` (WGSL compute) + `CPUBackend` fallback,
- compute pass obsługujący:
  - integrację debris,
  - wygaszanie prędkości,
  - relaksację deformacji shardów,
- CPU nadal wykonuje collision solve/hybrid impulse (rigid + yield/plastic threshold),
- instrumentacja czasu (`performance.now`) i overlay debug.

---

## 5) Benchmark mini (2 sceny)

Uruchomienie w środowisku CI/agent (Chromium Playwright):

- Scena A: `2 encje x 90 shardów`
- Scena B: `8 encji x 64 shardy`
- `fixed dt = 1/120`

Wynik z obecnego środowiska:

- WebGPU adapter: **niedostępny** (fallback CPU)
- Scena A CPU: **0.026 ms/frame** (~38554 FPS)
- Scena B CPU: **0.051 ms/frame** (~19512 FPS)
- GPU: **n/a** (brak adaptera WebGPU)

> Na maszynie z aktywnym WebGPU należy powtórzyć benchmark (klawisz `B`) i porównać ms/frame CPU vs GPU.

---

## 6) Lista różnic funkcjonalnych vs `destruktorhybrid.html`

1. PoC nie odwzorowuje jeszcze pełnego pipeline splitowania wraków (`findIslands/spawnWreckEntity`) 1:1.
2. Fray/poszarpanie wierzchołków jest uproszczone (deformation scalar/vector bez pełnej geometrii krawędzi).
3. Narrowphase jest wciąż CPU, GPU pass obejmuje etap integracji/deformation (krok przejściowy).
4. Render jest minimalny (2D debug circles), celem jest backend fizyki.

---

## Instrukcja uruchomienia

1. Uruchom statyczny serwer z root repo (np. `npx http-server . -p 4173`).
2. Otwórz: `http://127.0.0.1:4173/src/game/destruktorhybrid.webgpu.html`.
3. Sterowanie:
   - LPM: mały impuls (rigid),
   - PPM: duży impuls (yield/plastic + debris),
   - `R`: reset sceny,
   - `1/2`: wybór sceny,
   - `B`: benchmark mini.

