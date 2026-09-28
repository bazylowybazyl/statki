# Port WebGPU — harness, bazy i sposób pracy

**Port zakończony** (zadania 01–24, 2026-09-28): gra na `main` ma tylko `WebGPURenderer` i TSL — bez GLSL i API WebGL
(strażnik `tests/graBezGlsl.test.mjs`, zasady w `agents.md` § „Render: WebGPU + TSL”). Ten plik zostaje instrukcją harnessu
zrzutów i baz obrazu na przyszłość; część o zadaniach i sesjach opisuje, jak prowadzono port (wzór dla podobnych prac).

Plan i uzasadnienia: `PLAN.md`. Stan zadań, dziennik i końcowe zestawienie z bazą: `POSTEP.md`. Zadania (samodzielne
prompty): `zadania/NN-*.md`. Wyniki spike'u: `SPIKE.md`. Wydajność i precyzja: `WYDAJNOSC.md`. Inwentarz shaderów:
`INWENTARZ.md` (`node scripts/webgpu/inwentarz.mjs`; graf i wzorce wspólne ze strażnikiem — `scripts/webgpu/grafGry.mjs`).

- Pracujemy na **`main`** (decyzja użytkownika 2026-09-27; bez gałęzi `webgpu/port`); tag `webgpu-port` = ostatni commit
  portu.
- **Tag `webgl-baseline`** = ostatni stan gry na `WebGLRenderer` + harness zrzutów (kod gry identyczny z `d57cbdd`).
  Z niego robi się bazy scen przeniesionych 1:1 i odpala dema spoza portu (stan sprzed WebGPU).
- **Magenta** = zamiennik `ShaderMaterial` (`src/3d/tsl/zamiennik.js`): w grze nie występuje (`spis.zamienniki` = 0 we
  wszystkich scenach), widać go tylko w demach modułów poza portem (Z4/Z5/Z7) na Core3D.

## Jedno zadanie = jedna sesja

1. W `POSTEP.md` (tabela „Zadania portu”) wybierz zadanie, którego zależności są zrobione i którego nikt nie prowadzi.
2. Nowa sesja albo `/clear` w bieżącej; effort z nagłówka zadania: `/effort max` albo `/effort xhigh`.
3. Linia startowa (dokładnie tak):

   ```
   Przeczytaj docs/webgpu/zadania/NN-nazwa.md i wykonaj to zadanie.
   ```

4. Sesja kończy: harness i testy, commit na `main` (tylko swoje pliki), wpis w `POSTEP.md` (tabela + dziennik), raport
   z listą zrzutów do obejrzenia. Push — dopiero po decyzji użytkownika (PLAN §12 p. 4).

## Wznowienie po resecie limitu albo przerwanej sesji

Sesje zapisują postęp w dzienniku `POSTEP.md` po każdym kroku, a niezacommitowaną pracę widać w `git status` / `git diff`.
Nowa sesja z tym samym effortem:

```
Przeczytaj docs/webgpu/POSTEP.md i docs/webgpu/zadania/NN-nazwa.md. Dokończ zadanie NN od miejsca zapisanego w dzienniku (sprawdź git status).
```

## Inne sesje w tym samym katalogu

W repo pracują równolegle inne sesje (dema WebGPU, ruch v2) — `git status` pokazuje ich pliki. Commituj **tylko
swoje ścieżki** (`git add <pliki>`), nigdy `git add -A` ani `git commit -a`. Przed zadaniem sprawdź, czy nikt nie
edytuje plików z jego zakresu (zwłaszcza `src/3d/core3d.js`, `index.html`) — jeśli tak, zapytaj użytkownika.

## Zadania równoległe (worktree)

Które mogą iść naraz: kolumna „Równolegle z” w `POSTEP.md` / `PLAN.md` §9. Najwyżej 2–3 naraz (wspólne GPU).

1. Start sesji we własnym worktree: `claude --worktree webgpu-NN` (albo worktree z aplikacji) — osobny katalog i gałąź.
   Ręcznie: `git -c core.autocrlf=false worktree add -b webgpu/NN ../statki-wt/NN main` — **bez `-c core.autocrlf=false`**
   repo (`core.autocrlf=true`) wypakuje pliki z CRLF, a kilka testów-strażników (regexy po źródłach) padnie fałszywie
   (zadanie 06 widziało ~5). Z tą opcją pliki mają LF i `git status` jest czysty.
2. `node_modules`: worktree go nie ma. **Kopia, nie dowiązanie** (~150 MB bez Electrona, który harnessowi niepotrzebny):

   ```powershell
   robocopy C:\Users\Szymon\Documents\GitHub\statki\node_modules <worktree>\node_modules /E /MT:8 /NFL /NDL /NJH /NJS /XD electron app-builder-bin
   ```

   **Nie rób dowiązania (junction) do głównego `node_modules`:** `git worktree remove --force` wchodzi w dowiązanie i
   kasuje ZAWARTOŚĆ celu (sprawdzone 2026-09-27 na katalogu próbnym), tak samo `Remove-Item -Recurse` w Windows
   PowerShell 5.1. Jeśli już jest dowiązanie — przed usunięciem worktree usuń SAMO dowiązanie: `cmd /c rmdir <ścieżka>`.
3. Harness w worktree — własny port i baza z GŁÓWNEGO katalogu (`.tmp/` nie jest w git, worktree go nie widzi):

   ```
   node scripts/webgpu/zrzuty.mjs --backend webgpu --port 5341 --out .tmp/webgpu/zadania/NN --baza C:/Users/Szymon/Documents/GitHub/statki/.tmp/webgpu/baseline/webgl/p1
   ```

   Każda równoległa sesja inny `--port` (domyślny 5340; np. 5341, 5342).
4. Koniec: commit w worktree; w głównym katalogu `git merge <gałąź worktree>`. Konflikty zwykle w `POSTEP.md` (zachowaj
   oba wpisy), `INWENTARZ.md` (wygeneruj od nowa: `node scripts/webgpu/inwentarz.mjs`) i `agents.md`.
5. **Pomiary wydajności** (`--wydajnosc`, `--tylko-wydajnosc`, zadanie 23) tylko wtedy, gdy nic innego nie obciąża GPU
   (inne sesje, dema WebGPU, harnessy). Zrzuty obrazu są na to odporne, liczby ms — nie.

## Harness zrzutów

Polecenie zadania (w głównym katalogu):

```
node scripts/webgpu/zrzuty.mjs --backend webgpu --out .tmp/webgpu/zadania/NN --baza .tmp/webgpu/baseline/webgl/p1
```

- Opcje: `--sceny a,b` (podzbiór; nazwy w `zrzuty.mjs` → `SCENES`), `--powtorz N` (szum), `--wydajnosc`,
  `--rozmiar 1920x1080`, `--seed n`. `--backend` tylko nazywa katalog — gra flagi nie czyta; faktyczny renderer jest
  w `wyniki.json` (`renderer`).
- Wynik: `.tmp/webgpu/zadania/NN/webgpu/` — `<scena>.png` (+ warianty „jedna warstwa” `<scena>__tlo|planety|ortho|fg`),
  `wyniki.json` (błędy i ostrzeżenia konsoli z walidacją WebGPU, draw calle i trójkąty per pass, ms CPU / GPU, HDR,
  **`spis`** — widoczne materiały per warstwa i liczba zamienników, stan świata), `porownanie-z-baza/`.
- Baza z tagu: `.tmp/webgpu/baseline/webgl/p1/*.png` (116 zrzutów po zadaniu 24: Faza 0 + sceny dopisane w 08, 16 i 24 —
  sesja „reaktor”), drugi przebieg `p2/`, szum `szum-p1-p2/`; liczby w `docs/webgpu/baseline.json` (w repo). Baza z `main`
  dla scen z nowymi efektami — § „Dwie bazy” niżej. `spis.zamienniki` w grze = 0; niezerowy to regresja (ShaderMaterial
  w grze — złapie go też `tests/graBezGlsl.test.mjs`).

### Jak czytać porównanie

`porownanie-z-baza/porownanie.md` — wiersz na scenę:

| kolumna | znaczenie |
|---|---|
| różne >2 / >8 / >32 | % pikseli różniących się o więcej niż 2 / 8 / 32 (z 255) w którymkolwiek kanale |
| `średnia`, `maks` | średnia i największa różnica kanału |
| w progu szumu | różnica ≤ 1,5 × szum dwóch przebiegów bazy (+ mały zapas) — „nic się nie zmieniło” |
| w tolerancji portu | różnica ≤ `tolerancjaPortu` z `baseline.json` (od zadania 02: >8/255 w ≤ 0,05% pikseli, średnia ≤ 0,03) — „ten sam obraz, inny renderer” |
| obok siebie | `<scena>-obok.png` (baza \| nowy \| mapa różnic, pół rozdzielczości), `<scena>-roznica.png` (pełna mapa: szarość = różnica × 4, czerwień > 32/255) |

Regresje względem poprzedniego przebiegu (albo bazy z `main`): `node scripts/webgpu/porownaj.mjs --a .tmp/webgpu/zadania/<poprzednie>/webgpu --b .tmp/webgpu/zadania/NN/webgpu --out .tmp/webgpu/zadania/NN/vs-poprzednie`.

Tolerancję skalibrowano na `kalibracja__ortho` (mało sylwetek: 0,44% pikseli na krawędziach). Różnica renderer↔renderer to
wyłącznie piksele sylwetek po resolve MSAA (~4% pikseli krawędzi, pokrycie o jedną próbkę) — scena gęstsza (ring, K-7,
bitwa) może przekroczyć próg mimo zgodności; wtedy rozstrzyga mapa różnic (różnice tylko na sylwetkach, wnętrza ≤ 2/255).
Szczegóły i pomiary: `baseline.json` → `tolerancjaPortu`.

Sceny z flagą `bezOverlay` (sesja „stacja”, zadanie 16) mają dodatkowo `__3d` (klatka Core3D bez wybuchu reaktora — w tagu
kanwa overlaya efektów, od zadania 20 siatki wybuchu w Core3D) i `__fg-3d` (sama warstwa FG, bez wybuchu i bez passów planet
— quad poświaty planet nie podlega izolacji warstw). Z `--reaktor` (zadanie 20) `wybuch` i `stacja-rozpad` dostają wariant
`__reaktor` — sam wybuch reaktora na czarnym tle; sesja „reaktor” (galeria faz wybuchu) ma go zawsze. Baza wariantu: ten sam
skrypt w katalogu z tagu `webgl-baseline`. Scena gęsta
w krawędzie ponad progiem: `node scripts/webgpu/krawedzie.mjs --a <baza> --b <nowy> [--sceny …]` — ile różnic >8/255 leży na
sylwetkach, a ile we wnętrzach.

Poza harnessem (post, zadanie 02): `node scripts/webgpu/post-kontrola.mjs` — tuner bloomu, `perfToggles.bloom`, MSAA 4 → 0 → 4,
pula znaczników czasu, bloom raz na render w podzielonym ekranie (kod wyjścia 1 przy porażce);
`node scripts/webgpu/gorace-powietrze.mjs [--root <worktree tagu>]` — kalibracja z czterema źródłami gorącego powietrza i bitwa
z gorącym powietrzem i bez, ta sama scena na WebGL i WebGPU (porównanie: `porownaj.mjs`).

### Dwie bazy: tag i `main`

- **Sceny przeniesione 1:1 z WebGL** (menu, `hud`, ringi i K-7, planety i słońce, kalibracja, stacje i ich rozpad, wybuch
  reaktora — sesja „reaktor”, podzielony ekran, warianty warstw) — baza z tagu `webgl-baseline`
  (`.tmp/webgpu/baseline/webgl/p1`, liczby w `baseline.json`), próg: `tolerancjaPortu` albo mapa różnic (krawędzie).
- **Sceny z efektami i systemami z dem WebGPU** (zadania 17–22: `galeria-*`, `bitwa`, `bitwa-blisko`, `wybuch`, `wraki`,
  `warp*` / `kop*`, sesja „rakiety”, `pas-*`, `wydobycie-*`) — w tagu wyglądają inaczej (stare efekty albo ich brak), więc
  ich bazą jest ostatni zatwierdzony przebieg harnessu na `main` (dziś `.tmp/webgpu/zadania/23/baza-main/webgpu` — 191 zrzutów
  po zadaniu 23; przebieg końcowy zadania 24: `.tmp/webgpu/zadania/24/webgpu`). Porównanie:
  `node scripts/webgpu/porownaj.mjs --a <baza main> --b <nowy przebieg> --out <katalog>`. Zmiana wyglądu takich scen = zrzuty
  gry obok dema (`scripts/webgpu/bronie-demo.mjs --tryb zrzuty`, `dema/rakiety-webgpu.html?scenario=…&shot=1`,
  `scripts/webgpu/asteroidy-demo.mjs`, `scripts/webgpu/wydobycie-gra.mjs --demo`) i ocena użytkownika; po akceptacji przebieg
  z `main` staje się nową bazą (katalog z `OPIS.txt`: commit, polecenie, znany szum).
- Znany szum obu baz: `planeta-cien` (obrót stacji Wenus zależy od liczby klatek ładowania — 0,24–0,52% pikseli > 2/255).

### Nowa scena bazy

Scena, która pokazuje to, co przeszło z WebGL 1:1 (i ma sens porównanie ze starym rendererem), dostaje bazę z tagu — kroki
niżej. Scena z nowymi efektami albo nowym systemem po porcie — bazę z `main` (przebieg harnessu na zatwierdzonym `main`,
wyżej), nie z tagu. Baza z tagu:

1. Scena dopisana w `scripts/webgpu/zrzuty.mjs` na `main` (tylko harness, bez zmian w grze — haki `?dev` już są).
2. Worktree z tagu: `git worktree add ../statki-webgl webgl-baseline`, kopia `node_modules` jak wyżej (robocopy),
   skopiuj `scripts/webgpu/` z `main` do worktree (nadpisz).
3. W worktree: `node scripts/webgpu/zrzuty.mjs --backend webgl --powtorz 2 --port 5345 --sceny <nowa> --out C:/…/statki/.tmp/webgpu/baseline-nowe/<nowa>`.
4. Na `main`: `node scripts/webgpu/baza.mjs --dopisz .tmp/webgpu/baseline-nowe/<nowa>` — kopiuje PNG do bazy, dopisuje
   scenę i jej szum do `baseline.json` (i do plików bazy, więc pełna przebudowa jej nie zgubi). Commit `baseline.json`
   + harness.
5. Sprzątanie worktree: `git worktree remove --force ../statki-webgl` (bezpieczne tylko przy KOPII `node_modules`).

Całą bazę od nowa (np. nowa rozdzielczość): w worktree z tagu `zrzuty.mjs --backend webgl --powtorz 2 --wydajnosc
--out <…>/.tmp/webgpu/baseline`, potem na `main` `node scripts/webgpu/baza.mjs` (skalibrowana tolerancja zostaje).

### Dema spoza portu

Moduły poza grą przejdą na TSL przy swojej integracji (PLAN §12 p. 1). Do tego czasu pełny obraz dem na WebGL daje tag:
`warp-demo` (na `main` usunięte w 22), `asteroidy.html`, `budowle-portowe` (Z7), `kontenery` (Z5), `scripts/proxy-batch` (Z4)
— w worktree z tagu `npm run dev` i adres jak dawniej. Na `main` dema Z4/Z7 na Core3D rysują GLSL magentą (zamiennik),
`kontenery` (własny `WebGLRenderer` + moduły TSL gry) nie działa, `destruktor2d/3d` działają (własny `WebGLRenderer`,
`beamShips3D` / `beamDebris3D` w GLSL). `dema/station-destruction-sandbox.html` jest zepsute także na tagu (ścieżki `./src/…`
względem `dema/` po przeniesieniu pliku; importuje usunięte `overlay.js`, `shockwave3D.js`, `stationDestructionEffects.js`).
Dema `dema/*-webgpu*` i warsztaty przeniesionych modułów (`halo_ring_demo`, `mostki-demo`, `rdzen-demo`) działają na `main`.

## Pułapki środowiska

- Testy: `node --test "tests/*.test.mjs"` (wzorzec w cudzysłowie; `node --test tests/` na Node 22 nie działa) i `npm test`.
  Porażki bazowe: `POSTEP.md` § Testy bazowe.
- Treść z `\` albo backtickami zapisuj narzędziem Write/Edit (albo skryptem zapisanym Write) — heredoc i `node -e "…"`
  gubią ukośniki i wykonują backticki.
- CRLF z Pythona / Write psuje strażników-regexy w testach — normalizuj w teście (`replace(/\r\n/g, '\n')`), nie w pliku.
- Nie czytaj `index.html` w całości (~23 tys. linii) — grep i fragmenty.
