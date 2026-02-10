# WebGPU port destrukcji hybrydowej (`destruktorhybrid.html`) — update po uwagach

## Co poprawiono względem poprzedniego PoC

- Zamiast abstrakcyjnych „kółek” PoC używa teraz **dwóch statków ze sprite** (`assets/capital_ship_rect_v1.png`) dzielonych na heksy na podstawie alfa-maski sprite.
- Zachowana została mechanika hybrydowa: niski impuls → rigid bounce, wysoki impuls (`yieldPoint`) → deformacja/plastic + damage + debris.
- Główny krok kolizji i integracji encji został przeniesiony do **compute WGSL** (`WebGPUBackend`), z fallbackiem CPU.
- Render pozostaje 2D (canvas), backend fizyki jest wydzielony.

## Feasibility (stan po update)

### 1:1 możliwe już teraz
- Entity collision (duel ship↔ship) + impulse + separation w WGSL.
- Integracja shardów (world transform, deform lerp, debris update) w WGSL.
- Wymuszony fallback CPU gdy brak `navigator.gpu`/adaptera.

### Co jeszcze wymaga refaktoru do pełnego 1:1
- Pełny shard↔shard narrowphase dla wielu encji i kontaktów (obecnie pass encji 2-ship).
- Pełne splitowanie wysp (`findIslands/spawnWreckEntity`) i topologia pęknięć 1:1 z CPU baseline.
- Ograniczenie readbacków i docelowe renderowanie bez pełnego sync GPU→CPU co tick.

## Architektura danych GPU (wdrożona w PoC)

- `entityBuf`: pakiety `vec4` na encję:
  - `pos/vel`, `mass/radius/angle/angVel`, `collisionNormal/impact`
- `shardBuf`: pakiety `vec4` na shard:
  - `entityId/local/hp`, `world/deform`, `target/flags`, `debrisVel`
- `paramBuf`: `dt`, `restitution`, `friction`, `thrust`, `turn`

## Plan migracji etapowej

1. **Etap 1 (zrobione w PoC):** entity collision + shard integration na WGSL, CPU fallback.
2. **Etap 2:** broadphase + contact buffer na GPU, bez ograniczenia do 2 encji.
3. **Etap 3:** shard↔shard narrowphase + impulse iterations + friction/separation na GPU.
4. **Etap 4:** damage propagation, split islands/debris pipeline z minimalnym readback.

## Benchmark mini (2 sceny)

Uruchamiany klawiszem `B`:
- A: 2x ship (typowy duel)
- B: 2x ship + cykliczne high-impulse uszkodzenia

W środowisku agenta adapter WebGPU był niedostępny, więc benchmark pokazał CPU fallback i `GPU: n/a`.

## Różnice funkcjonalne vs pełne `destruktorhybrid.html`

- PoC jest bliższy 1:1 wizualnie (sprite→heksy), ale nie zawiera jeszcze pełnej logiki splitowania wraków i wieloencjowego shard↔shard narrowphase.
- Dla czytelności pozostawiono ograniczony model sterowania (gracz + kukła).

## Uruchomienie

1. `npx http-server . -p 4173`
2. `http://127.0.0.1:4173/src/game/destruktorhybrid.webgpu.html`
3. Sterowanie: `W/S/A/D`, LPM/PPM, `R`, `B`.
