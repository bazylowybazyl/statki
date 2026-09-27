# Zadanie 19 — Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć
Zależności: 04–18 | Równolegle z: nie | Zalecany effort: max
Zakres: pomiary i poprawki wydajności / precyzji po porcie (bez nowych funkcji i efektów); narzędzia:
`scripts/webgpu/zrzuty.mjs --wydajnosc / --tylko-wydajnosc`, `scripts/profil-bitwy.mjs`, `dema/precyzja-drzenie.js`,
PerfHUD; raport `docs/webgpu/WYDAJNOSC.md`.

## Cel
Port nie pogarsza gry: klatka bitwy (CPU i GPU), draw calle, drżenie efektów względem kadłubów, czasy startu i
pierwszych klatek, pamięć — na poziomie bazy albo lepiej, a każde odstępstwo ma przyczynę i plan. Dane do decyzji
użytkownika: zapas WebGL2 (PLAN §12 p. 2) i kanwa 3D bez kopii do `#c` (PLAN §2).

## Przeczytaj najpierw
`agents.md` (Wydajność, precyzja), `docs/webgpu/PLAN.md` §2, §4, §6, §10, `docs/webgpu/baseline.json` (wydajność,
drżenie, szum), `docs/webgpu/POSTEP.md` (liczby zadań 01–18), `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md`,
`docs/webgpu/README.md` (worktree z tagu, pomiary tylko przy bezczynnym GPU), `dema/precyzja-drzenie.js` (nagłówek).

## Kroki
1. **A/B bitwy:** `zrzuty.mjs --tylko-wydajnosc` naprzemiennie tag (worktree) ↔ `main`, ≥ 3 × każdy, GPU bez innych
   obciążeń (zamknij inne dema i sesje z GPU); mediany `coreRenderMs`, odstęp klatek, `gpuFrameMs`, draw calle per
   pass, „Overlay FX 3D”, kubełki PerfHUD (physics / draw / 3D update, „U hex”).
2. **Duża bitwa:** `scripts/profil-bitwy.mjs` (~125–174 okrętów) na obu — koszt CPU backendu przy wielu małych draw
   callach (PLAN §10 p. 5). Hotspoty: profil CDP (`Profiler`) po stronie `main`; poprawki tylko w warstwie renderu.
3. **Drżenie:** `dema/precyzja-drzenie.js` (lights, windows, exhaust, impostor, fx, bullets, muzzle, trails, sparks) na
   WebGPU vs `baseline.json` § drzenie. Regresje poprawiaj regułą precyzji (PLAN §4: węzeł `modelViewMatrix`, offset w
   `mesh.position`, dane względem niego; `highPrecision`).
4. **Kompilacja i start:** czas do menu, budowa ringu w menu, pierwsza klatka gry, pierwsza klatka bitwy, pierwszy
   strzał / trafienie / wybuch / skok każdego typu. Przestoje > 50 ms — lista i poprawki (rozgrzewka passów PLAN §6,
   grafy współdzielone PLAN §3).
5. **Pamięć:** `renderer.info.memory` (tekstury, geometrie) po starcie i po 3 cyklach bitwa → sprzątanie (liczniki mają
   wracać); tekstury 8K / 16K; porównanie z bazą.
6. **Pełne uploady tekstur** (`Texture.updateRanges` ignorowane — mostki z 15, inne tekstury danych): koszt w bitwie.
7. **Kanwa bez kopii:** zmierz koszt kopii `#webgl-layer` → `#c` (`drawImage`) na `main`; oceń wariant „kanwa WebGPU pod
   2D” — tylko pomiar i rekomendacja, bez zmiany składania.
8. **Zapas WebGL2:** `WebGPURenderer({ forceWebGL: true })` za flagą dev — lista błędów i zrzuty harnessu (dane do
   decyzji użytkownika; nic nie włączaj domyślnie).
9. **Raport** `docs/webgpu/WYDAJNOSC.md`: tabele przed/po, metoda, surowe dane w `.tmp/webgpu/zadania/19/`; wnioski
   trwałe do `agents.md` (Wydajność).

## Pułapki
- Równoległe sesje obciążają GPU (dema WebGPU, harnessy) — pomiar tylko przy bezczynnym GPU; zapisz warunki.
- Porównuj mediany wersji na przemian, nie pojedyncze przebiegi (memory: pułapki V8 — A/B naprzemiennie).
- `?physHz` i ustawienia gry identyczne po obu stronach.
- Poprawka wydajności nie może zmienić obrazu: po każdej — harness vs poprzedni przebieg WebGPU.

## Kryteria akceptacji
- Mediana CPU klatki bitwy (`coreRenderMs`, odstęp klatek) i `gpuFrameMs` nie gorsze niż baza o więcej niż szum (≥ 3
  pary A/B) — albo lista przyczyn z planem i zgodą użytkownika na odstępstwo.
- Drżenie wszystkich modułów ≤ baza + szum pomiaru.
- Zero przestojów kompilacji > 100 ms w scenach harnessu po rozgrzewce; lista pozostałych > 50 ms.
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek; harness bez regresji obrazu.
- `docs/webgpu/WYDAJNOSC.md`, `POSTEP.md`, `agents.md` (Wydajność); commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki, kroku fizyki ani jakości efektów, żeby „wygrać” pomiar.
- Nie przełączaj składania kanw ani zapasu WebGL2 bez decyzji użytkownika.

## Raport na koniec
Tabela A/B; drżenie; czasy startu i przestoje; pamięć; rekomendacje (kanwa bez kopii, zapas WebGL2); co zostało; pytania.
