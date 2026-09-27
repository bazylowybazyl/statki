# Zadanie 18 — Broń 2/2: wiązki, obrona punktowa, flak, jony; światła efektów na kadłubach; rany
Zależności: 17 | Równolegle z: 05–11, 13–16, 19 (bez zmian w `src/3d/fx/`) | Zalecany effort: xhigh
Zakres: z dema `bronie-webgpu`: `beams.js` (wiązka ciągła, pulsacyjna, laser PD), receptury flak (kula odłamków,
czarny kłąb z ognistym jądrem), CIWS / Helios PD, łuki EMP Tempesta po kadłubie; w grze: wiązki `weapon3DSystem.js`
(`_triggerBeamFx`, pule pulse / continuous — potem cały moduł do usunięcia), pęknięcia flaku `src/vfx/flakBurstVfx.js`
(dziś kanwa 2D), laser PD (dziś tylko kanwa 2D — test `beamRenderPath`), materiał kadłuba (`hexShips3D.js`, po 04)
czytający siatkę świateł (12), żar ran kadłubów belkowych.

## Cel
Wiązki, obrona punktowa i flak wyglądają jak w demie; błyski i trafienia efektów oświetlają kadłuby (siatka świateł,
zamiast „rozlania” kwadem); rana na kadłubie stygnie z bieli w czerwień z żarzącym się brzegiem — wzorem dema, ale na
żarze skóry belek (`HULL_BODY_CONFIG.heatGlowPeak`), nie na mapie uv (`DEMO-BRONIE.md` § Rany). Rozgrywka bez zmian.

## Przeczytaj najpierw
`agents.md` (Kadłuby na belkach — żar skóry; Pociski; Nośnik), `docs/webgpu/DEMO-BRONIE.md`, `docs/webgpu/POSTEP.md`
(wyniki 12 i 17), `dema/bronie-webgpu/beams.js`, `recipes.js` (flak, PD, Tempest, wiązki), `hull.js` (stygnięcie i brzeg
rany — wzór), `src/3d/weapon3DSystem.js` (wiązki), `src/vfx/flakBurstVfx.js`, w `index.html` grep: ścieżka wiązek
(`spawnLaserBeam`, `render3dOnly`, PD), `src/3d/hexShips3D.js` (TSL po 04: payload świateł, żar), memory: rany (świeci
BRZEG rany, biel 8–12 HDR), testy: `pulseBeamPoolLimit`, `beamRenderPath`, `pdBeamFastPath`, `flakSystem`,
`pointDefenseTargeting`, `hullBodies`.

## Kroki
1. **Wiązki:** `BeamSystem` z dema — ciągła (płynąca plazma, pakiety energii, cięcie burty ze stopionym rowem),
   pulsacyjna (front biegnie do celu), barwy z danych broni (dziś zaszyte — `DEMO-BRONIE.md`); zdarzenia z gry (strzał
   wiązką przez `WeaponShotBus`, punkt trafienia z gry). Limit równoczesnych wiązek jak dziś (pula ≤ 96 — test
   `pulseBeamPoolLimit` → odpowiednik).
2. **Obrona punktowa i flak:** laser PD i pęknięcia flaku przechodzą z kanwy 2D do 3D (decyzja użytkownika o nowych
   efektach) — wyłącz ścieżki kanwy (`beamRenderPath` „point-defence laser keeps its canvas-only beam path”,
   `FlakBurstVFX`) i przepisz testy z opisem decyzji. Koszt PD (tysiące wiązek/s w bitwie — audyt bitwy §2.2) zmierz.
3. **Po tym `weapon3DSystem.js` nie ma zadań** — usuń go (słuchacz szyny, rozgrzewka `compile`) albo zostaw cienki
   adapter szyny → receptury; `turret2D` / `fighterCombatFixes` bez nowych porażek.
4. **Światła efektów na kadłubach:** materiał kadłuba (TSL z 04) czyta siatkę świateł z 12 jako DODATKOWE światła
   (błyski, trafienia, żar, wiązki); model oświetlenia kadłuba i payload lamp statków bez zmian (przeniesienie lamp do
   siatki — tylko jeśli obraz identyczny i szybciej; pomiar „U hex” w bitwie). Zgłaszanie: `FxLights` (12).
5. **Rany:** żar skóry belek (`heatGlowPeak`, stygnięcie) z krzywą barwy z dema (biel → pomarańcz → wiśnia) i żarzącym
   brzegiem; bez mapy uv. Sprawdź zgodność z memory (świeci brzeg, nie odłamki).
6. **Tempest ion:** łuki EMP po kadłubie z końcami na poszyciu — punkty z sondy kadłuba gry (`HullBodies.probe`), tylko
   wizualnie.
7. **Harness:** `galeria-broni` (17) rozszerzona o wiązki, PD (drony / myśliwce jako cele) i flak.

## Pułapki
- Laser PD strzela 5 razy/s/działo — tysiące wiązek na sekundę w bitwie: jeden draw call, zero alokacji na strzał.
- Siatka świateł w materiale kadłuba = pętla po komórce na każdy piksel kadłuba — zmierz w bitwie (125+ okrętów).
- Nie zmieniaj celowania PD ani logiki flaku (testy `pointDefenseTargeting`, `flakSystem`).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (testy z kroku 2–3 przepisane z opisem decyzji).
- Harness `--backend webgpu --out .tmp/webgpu/zadania/18`: zero błędów walidacji; bez regresji w scenach bez broni;
  `galeria-broni`, `bitwa`, `bitwa-blisko` obok zrzutów dema do oceny użytkownika.
- Bitwa `--wydajnosc` przed/po (w tym „U hex” i koszt PD); bez przestojów pierwszego strzału.
- `INWENTARZ.md`, `POSTEP.md`, `agents.md` (kadłuby czytają siatkę świateł; rany); commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki (obrażenia wiązek, PD, flak, kadencje) ani kształtu ran w silniku belek (tylko wygląd żaru).
- Nie przenoś rakiet (19) ani wybuchu reaktora (20).

## Raport na koniec
Co zrobione; zrzuty wiązek / PD / flaku / ran obok dema; koszt PD i siatki w kadłubach; co zostało; pytania.
