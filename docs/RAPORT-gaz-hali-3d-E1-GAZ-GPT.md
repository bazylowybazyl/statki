# GAZ-GPT — raport E1 (2026-10-13)

E0 zaliczone (commit `36ecc44`). E1: implementacja i wszystkie miary fizyki zaliczone. **Formalna bramka kosztu symulacji pozostaje niespełniona: 0,855 ms zamiast ≤0,6 ms.** Użytkownik polecił odłożyć optymalizację (RTX 5080); ten raport nie oznacza budżetu jako zaliczonego. Commit E1 to commit zawierający ten raport.

## Miary §10

| Miara | Cel | Wynik | Ocena |
|---|---|---|---|
|Spaliny nad y=300 przy ścianie po 2 s|≥25%|56,14%|TAK|
|Pion przy ścianie|≥780 j/s (0,3 × zadane 2600)|1463 j/s|TAK|
|Masa spalin y>500, 2 → 4 s|rośnie|644147 → 1303259|TAK|
|Przepuszczalność nad kadłubem|≥0,7|0,804|TAK|
|Tunel: lot 500 j/s, 5,5 s|≥450 j.|640 j.|TAK|
|Flanka tunelu|≤1,3 × tło|1,102 × tło|TAK|
|Drugie / pierwsze podrywanie|≥0,5|0,860|TAK|
|Powrót po 30 s|≥0,8|0,816|TAK|
|Bilans pyłu / 60 s, z doliczeniem wypływu|±2%|0,0156%|TAK|
|Pas po lewej / prawej, start 300 j/s|≥200 / ≥200 j.|256 / 256 j.|TAK|
|Para poniżej y=116 po 10 s|≥60%|84,54%|TAK|
|Residuum / v_rms, najgorsza sonda|≤0,06|0,04126|TAK|
|Rdzenie wirów 6 s po ciągu, trzy odpalenia|≤2 × średnia|1,172|TAK|
|Determinizm|identyczne liczby|[-1339185723, -1339185723]|TAK|

Masy w umownych jednostkach: stężenie × objętość komórki, depozyt × powierzchnia pokładu. Podrywanie jest całką dodatniego strumienia z pokładu: pierwsze 282573,2, drugie 242873,2. Powrót liczy wyłącznie pył oznaczony przy podrywaniu, także podczas wygaszania przepływu; początkowy pył w powietrzu nie zawyża powrotu. Surowy bilans bez korekty wypływu: -0,1392%. Wypływ: 79538,1.

Tunel: kolumna pyłu 392 j. za średnim wylotem pięciu dysz, 81 próbek co 64 j.; tło z zewnętrznych 16 próbek. Flanka w pasie 4–5 komórek poza krawędzią tunelu, jak w audycie. Pas spod kadłuba: profile przy rufie, środku i dziobie, wybrany profil o największej szerokości wspólnej obu burt; komplet profili jest w JSON. Residuum używa tych samych ścian MAC i celu dywergencji co solver. Warstwa pary uwzględnia wolną część komórki nad płytą kadłuba.

## Koszty §11

Pomiar ABAB w jednej sesji, nowe wyniki znaczników Core3D (110–119 próbek na serię). Przyrost względem tego samego gospodarza bez modułu, średnia różnic median dwóch par. Nie edytowano kodu ani nie uruchamiano drugiego harnessu GPU podczas pomiaru. Sprzęt: RTX 5080 według użytkownika; serializacja `GPUAdapterInfo` dała pusty obiekt. Sprzętowy zapis f16: `trunc`, wykryty przez wspólny probe.

| Składnik | 1600×900 [ms] | 2560×1440 [ms] | Cel |
|---|---:|---:|---|
|Symulacja|0,855072|0,855888|≤0,6 — NIE|
|Obraz back|0,105968|0,432544|składowa|
|Obraz front|0,029888|0,050720|składowa|
|Obraz łącznie|0,141600|0,293072|składowa|
|Moduł łącznie, osobne ABAB całości|0,979472|1,290880|≤1,0 / ≤1,6 — TAK|
|CPU całego kroku modułu (pakowanie + solver)|0,140|0,120|≤0,25 — TAK|
|Objętość światła / drobiny|0 / 0|0 / 0|należą do E2, nie powstały w E1|
|Pamięć modułu|43,46624 MB|43,46624 MB|≤80 MB — TAK|
|Pipeline’y synchroniczne po gotowości|0|0|0 — TAK|
|Rysunki / dispatchy modułu|2 / 43|2 / 43|jeden compute(lista), 30 Jacobi|
|Alokacje w pętli modułu|0|0|stałe bufory, listy dispatchy, callback źródeł; test tożsamości list|

Pierwsza aktywacja po rozgrzewce: dodatkowy czas JS całej klatki 0,050 / -0,215 ms; dodatkowy GPU 0,234 / 0,105 ms (900p / 1440p). Limit +2 ms spełniony. Pełne surowe serie: `koszt.json`, `aktywacja.json`.

## Obraz, testy i ograniczenia

PNG wszystkich scen przy 0,32 / 1 / 3,2, kamera 3D wewnątrz hali, impuls SIDE, zimny gaz, sączenie i odpięcie. `arkusz-odbior.png`, dwie sekwencje `arkusz-odpalenie.png` / `arkusz-odpiecie.png` (8 klatek każda), `profil-tunelu.png`, przekroje z odczytu GPU. Detal, drobiny, objętość światła, finalne cienie i porównanie obrazu z 2D należą do E2/E3. E1 pokazuje fizykę prostym marszem; dach zatrzymuje i zasłania gaz, otwór nad Atlasem jest wspólny dla bryły i solvera.

Testy: 2686 testów Node, 2684 PASS, 2 istniejące TODO, 0 FAIL; `npm test`: 1662 asercje, 0 błędów. W tym 15 testów hallGas (lustra CPU, WGSL wszystkich kerneli i obu kamer, limity wiązań, brak jednoczesnego odczytu/zapisu, ułamkowy kadłub i ściany, masa, stałe listy). Błędy konsoli i WebGPU w odbiorze/kosztach/aktywacji: 0. Pierwszy pełny test wykrył brak wpisu dema oraz CRLF z checkoutu w niezmienionym gpuFx.js; wpis dodano, plik znormalizowano do LF bez zmiany treści.

Po przeniesieniu do głównego repozytorium: 46 testów integracyjnych (w tym hallGas3d Claude’a) PASS; krótka sonda GPU dała identyczne liczby i hashe co w izolowanym przebiegu, 0 błędów i 0 pipeline’ów sync. Surowe dane: `integracja.json` i `.tmp/hala-gaz/E1-kontrola-glowne/`.

Nie wyszło: wcześniejsze warianty tworzyły wał pyłu na flankach. Konserwatywna dyfuzja zależna od rotacji, uwzględniona przed limitem wspólnego strumienia, dała 1,102×. TSL wybierał całe vec4 przez `all(bvec4)` — wybór dawcy per składnik usunął utratę masy przy przeciwnych kierunkach pyłu i gorącego gazu. Cienka płyta wymagała zajętości ścian niezależnej od zajętości objętości. Kopie f16 używają dokładnego textureLoad; liniowe próbkowanie kopii obcinało małe przyrosty. Nie ma zaniku pyłu we wnętrzu. Pozostał koszt symulacji 0,855 ms — do optymalizacji zgodnie z poleceniem użytkownika.

## Pliki i powtórzenie

Nowe: `src/3d/hallGas/hallGas.js`, `hallGasGrid.js`, `hallGasMath.js`, `hallGasProbe.js`, `hallGasVolume.js`; `tests/hallGas.test.mjs`; `scripts/webgpu/hala-gaz-e1.mjs`, `hala-gaz-koszt.mjs`, `hala-gaz-aktywacja.mjs`, `hala-gaz-raport.py`; ten raport. Zmienione: `hallGasLayout.js`, `hallGasBenchmark.js`, oba pliki `dema/hala-gaz-webgpu`, `dema/dok-k7-webgpu.js` (opcjonalne haki gospodarza), `dema/index.html` (wpis GAZ-GPT), plan i harness E0. `gasField/hallGasSources.js`: callback piszący rekord powstaje raz przy konstrukcji; harmonogram i równania starych źródeł zachowane. Wspólny `zapisF16.js` użyty bez zmian (dostarczony wcześniej, commit Claude’a 097c96d). Kod gry i pliki hallGas3d Claude’a zachowane.

```powershell
node scripts/webgpu/hala-gaz-demo.mjs --etap E0
node scripts/webgpu/hala-gaz-demo.mjs --etap E1 --odbior 1 --out .tmp/hala-gaz/E1
node scripts/webgpu/hala-gaz-koszt.mjs --out .tmp/hala-gaz/E1
node scripts/webgpu/hala-gaz-aktywacja.mjs
python scripts/webgpu/hala-gaz-raport.py
node --test "tests/*.test.mjs"
npm test
```
