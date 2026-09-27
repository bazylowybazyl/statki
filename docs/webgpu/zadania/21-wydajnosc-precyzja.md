# Zadanie 21 — Wydajność i precyzja: A/B z tagiem, drżenie, kompilacja, pamięć
Zależności: 04–20 | Równolegle z: nie | Zalecany effort: max
Zakres: pomiary i poprawki wydajności / precyzji po porcie (bez nowych funkcji i efektów); narzędzia:
`scripts/webgpu/zrzuty.mjs --wydajnosc / --tylko-wydajnosc`, `scripts/profil-bitwy.mjs`, `dema/precyzja-drzenie.js`,
PerfHUD; raport `docs/webgpu/WYDAJNOSC.md`.

## Cel
Port nie pogarsza gry: klatka bitwy (CPU i GPU), draw calle, drżenie efektów względem kadłubów, czasy startu i
pierwszych klatek, pamięć — na poziomie bazy albo lepiej, a każde odstępstwo ma przyczynę i plan. Dane do decyzji
użytkownika: kanwa 3D bez kopii do `#c` (PLAN §2).

## Przeczytaj najpierw
`agents.md` (Wydajność, precyzja), `docs/webgpu/PLAN.md` §2, §4, §6, §10, `docs/webgpu/baseline.json` (wydajność,
drżenie, szum), `docs/webgpu/POSTEP.md` (liczby zadań 01–20), `docs/AUDYT-wydajnosc-bitwa-2026-09-24.md`,
`docs/webgpu/README.md` (worktree z tagu, pomiary tylko przy bezczynnym GPU), `dema/precyzja-drzenie.js` (nagłówek).

## Kroki
1. **A/B bitwy:** `zrzuty.mjs --tylko-wydajnosc` naprzemiennie tag (worktree) ↔ `main`, ≥ 3 × każdy, GPU bez innych
   obciążeń (zamknij inne dema i sesje z GPU); mediany `coreRenderMs`, odstęp klatek, `gpuFrameMs`, draw calle per
   pass, kubełki PerfHUD (physics / draw / 3D update, „U hex”, compute efektów). Od zadań 17–19 bitwa ma NOWE, bogatsze
   efekty broni i rakiet — rozdziel koszt: sam port (sceny bez ognia: `hud`, `ring-z02`, `k7-hala`, `kalibracja`,
   `slonce` — CPU / GPU na klatkę vs baza) i koszt nowych efektów (kubełki compute i passa ortho w bitwie, osobno).
2. **Duża bitwa:** `scripts/profil-bitwy.mjs` (~125–174 okrętów) na obu — koszt CPU backendu przy wielu małych draw
   callach (PLAN §10 p. 5). Hotspoty: profil CDP (`Profiler`) po stronie `main`; poprawki tylko w warstwie renderu.
3. **Drżenie:** `dema/precyzja-drzenie.js` na WebGPU vs `baseline.json` § drzenie. Moduły bullets / muzzle / trails /
   sparks zastąpiły zadania 17–19 — przepnij narzędzie na nowe (pule `gpuFx`, `ProjectileSystem`, `TrailSystem`, iskry,
   dym rakiet); próg dla nich ≤ 0,01 px RMS (baza starych: pociski 0,001, smugi 0,008), dla lights / windows /
   exhaust / impostor / fx — baza + szum. Regresje poprawiaj regułą precyzji (PLAN §4: węzeł `modelViewMatrix`, offset
   w `mesh.position`, dane względem niego; pule GPU względem początku przy kamerze — zadanie 12).
4. **Kompilacja i start:** czas do menu, budowa ringu w menu, pierwsza klatka gry, pierwsza klatka bitwy, pierwszy
   strzał / trafienie / wybuch / skok każdego typu. Przestoje > 50 ms — lista i poprawki (rozgrzewka passów PLAN §6,
   grafy współdzielone PLAN §3).
5. **Pamięć:** `renderer.info.memory` (tekstury, geometrie) po starcie i po 3 cyklach bitwa → sprzątanie (liczniki mają
   wracać); tekstury 8K / 16K; porównanie z bazą.
6. **Pełne uploady tekstur** (`Texture.updateRanges` ignorowane — mostki z 15, inne tekstury danych): koszt w bitwie.
7. **Kanwa bez kopii:** zmierz koszt kopii `#webgl-layer` → `#c` (`drawImage`) na `main`; oceń wariant „kanwa WebGPU pod
   2D” — tylko pomiar i rekomendacja, bez zmiany składania.
8. **Tylko WebGPU:** sprawdź komunikat „Gra wymaga przeglądarki z WebGPU” w Chrome bez WebGPU (flaga
   `--disable-webgpu` w `startChrome`) — gra nie startuje na zapasie WebGL2 (decyzja użytkownika, PLAN §12 p. 2).
9. **Raport** `docs/webgpu/WYDAJNOSC.md`: tabele przed/po, metoda, surowe dane w `.tmp/webgpu/zadania/21/`; wnioski
   trwałe do `agents.md` (Wydajność).

## Pułapki
- Równoległe sesje obciążają GPU (dema WebGPU, harnessy) — pomiar tylko przy bezczynnym GPU; zapisz warunki.
- Porównuj mediany wersji na przemian, nie pojedyncze przebiegi (memory: pułapki V8 — A/B naprzemiennie).
- `?physHz` i ustawienia gry identyczne po obu stronach.
- Poprawka wydajności nie może zmienić obrazu: po każdej — harness vs poprzedni przebieg WebGPU.

## Kryteria akceptacji
- Sam port (sceny bez ognia): mediana CPU klatki i `gpuFrameMs` nie gorsze niż baza o więcej niż szum (≥ 3 pary A/B).
  Bitwa z nowymi efektami: koszt efektów zmierzony, w budżecie zaakceptowanym przez użytkownika (liczby + propozycja
  LOD, jeśli za drogo) — albo lista przyczyn z planem.
- Drżenie wszystkich modułów ≤ baza + szum pomiaru.
- Zero przestojów kompilacji > 100 ms w scenach harnessu po rozgrzewce; lista pozostałych > 50 ms.
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek; harness bez regresji obrazu.
- `docs/webgpu/WYDAJNOSC.md`, `POSTEP.md`, `agents.md` (Wydajność); commit na `main`.

## Czego NIE robić
- Nie zmieniaj rozgrywki, kroku fizyki ani jakości efektów, żeby „wygrać” pomiar.
- Nie przełączaj składania kanw bez decyzji użytkownika.

## Raport na koniec
Tabela A/B; drżenie; czasy startu i przestoje; pamięć; rekomendacje (kanwa bez kopii); co zostało; pytania.
