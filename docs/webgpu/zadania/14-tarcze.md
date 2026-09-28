# Zadanie 14 — Tarcze i trafienia w tarczę
Zależności: 03 | Równolegle z: 04–13, 15–20 | Zalecany effort: xhigh
Zakres: `src/3d/shield3D.js` (2 materiały / 398 linii GLSL: `SHIELD_FRAGMENT` — kopuła, `HULL_SHIELD_FRAGMENT` —
obrys kadłuba; tablice trafień 24 × `vec3` / `float`; **materiał na encję** (`createShieldMaterial`,
`createHullShieldMaterial`); `prewarmShields3D` z trzymaczami obu wariantów; `Core3D.setShieldLayerActive`),
`src/3d/shieldImpactFx.js` (2 / 185: wstęgi i bańki trafień, pula, LOD). 4 materiały / 583 linie.

## Cel
Tarcze jak w bazie: pole niewidzialne poza rozruchem i trafieniem, fale trafień, pękanie, strzał energii; cząstki
trafień (barwa z tarczy, LOD). Warstwa 7 rysuje się po passie ortho bez czyszczenia głębi (kadłuby zasłaniają) i nie
czyta maski słońca. Spawn floty nie buduje materiału tarczy na każdy okręt.

## Przeczytaj najpierw
`agents.md` (kontrakt warstw 3/5/6/7, maska słońca — emitery), `docs/webgpu/PLAN.md` §3 (graf węzłów — materiał na
encję), §6 (rozgrzewka), `docs/webgpu/SPIKE.md` (3 — `uniformArray`), `docs/webgpu/POSTEP.md`, pliki zakresu, testy:
`shieldImpactFx`, `shaderPrewarm` (tarcze), `shadowShaftsQuality` („shields render in ortho without clearing depth and
never read the mask”), `renderPerfGates`, `shieldProfile`, `shieldRadius`.

## Kroki
1. **Graf na wariant, nie na encję:** dwa grafy (kopuła, obrys) budowane raz; wartości per tarcza (`uLife`, `uReveal`,
   `uColor`, profil `maxR/minR`, pękanie, strzał energii…) przez `uniform(...).onObjectUpdate(({ object }) => …)`
   (PLAN §3 — dziś każdy okręt ma własny `ShaderMaterial`; w WebGPU byłaby to budowa NodeBuilder na każdy spawn).
2. **Tablice trafień (24):** sprawdź w źródle three / małym teście, czy `uniformArray` z `onObjectUpdate` dostaje osobny
   bufor na obiekt (grupa `objectGroup`). Jeśli nie — dane trafień w teksturze danych albo buforze storage (wiersz na
   tarczę, indeks tarczy per obiekt). Pętla `for i < MAX_HITS` → `Loop(24)`.
3. **`shieldImpactFx`:** pula wstęg i baniek → TSL; współrzędne lokalne (test „świat 12 mln j. nie wchodzi do float32”),
   barwa z tarczy, LOD po rozmiarze na ekranie; `pushHeatHazeWorld` z trafień (zadanie 02).
4. **Rozgrzewka:** `prewarmShields3D` → rozgrzewka passa tarcz (`setRenderTarget(composerTarget)`, kamera ortho z
   warstwą 7, obiekty w kadrze — PLAN §6); trzymacze obu wariantów zostają (odpowiednik testu `shaderPrewarm`).
5. **Warstwa 7:** `setShieldLayerActive` co klatkę jak dziś.
6. **Testy:** asercje GLSL → odpowiedniki (struktura grafu / stan materiału w Node — PLAN §7); `shieldImpactFx` (API JS)
   bez zmian.

## Pułapki
- Bez czyszczenia głębi między passem ortho (0) a tarczami (7) — kontrakt runnera passów z 01.
- `AdditiveBlending`, `depthWrite: false`; kolor HDR — jasność bez zmian.
- Adapter: `uniformArray` trzyma dane w `node.array` (`.value` adaptera → `array`).
- Tarcza pojawia się przy rozruchu i trafieniu — w zrzutach bazy widać ją tylko tam, gdzie trafiają pociski; porównuj
  sceny bitwy (a nie `hud`).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek.
- Harness `--backend webgpu --out .tmp/webgpu/zadania/14 --baza .tmp/webgpu/baseline/webgl/p1`: zero błędów walidacji;
  `spis` warstwy 7 bez zamienników w scenach bitwy; `bitwa-blisko` i `bitwa` w tolerancji tam, gdzie warstwa jest czysta.
- Spawn 30 NPC (`?dev`) nie buduje materiałów tarcz per okręt (licznik budów / czas klatki spawnu w raporcie).
- `INWENTARZ.md`: pliki zadania bez GLSL; `POSTEP.md`; commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki tarcz (blokowanie ostrzału, promienie, profile) ani strojenia (`SHIELD_FIELD_TUNING`).
- Nie dokładaj maski słońca do tarcz.

## Raport na koniec
Co zrobione; zrzuty trafień w tarczę (bitwa) obok bazy; wynik sprawdzenia `uniformArray` per obiekt; czas spawnu;
co zostało; pytania.
