# Warp gracza „podniesiony świat” — soczewka świata (2026-10-25/26)

Stan po etapach 1–3 gałęzi `claude/warp-soczewka-swiata`: etap 1 — worker (e39ff36c) i mapa (ebc4e00d), etap 2 —
integracja w grze (ad343e4d), etap 3 — reszta świata w soczewce i HUD (3A) oraz sprzątanie „raz a porządnie” (3B,
ten dokument). Reguła obszaru (stan i zasady w skrócie): `.claude/rules/warp.md`, kamera — `.claude/rules/kamera.md`,
szew workera — `.claude/rules/render-worker.md`.

## Cel użytkownika

Prośba z 2026-10-25 (dosłownie):

> „próbowałem różnych metod warp, jednak ciężko mi osiągnąć feel przyspieszania do warp, wychodzenia z warp, dobrych
> efektów przechodzenia nad planetami/rzeczami z gry. Kiedy w webgl był prototyp »soczewka« świata, gdzie podnosiliśmy
> cały świat, wtedy było widać wszystkie planety i się je powiększało/pomniejszało — był to trochę prymitywny efekt,
> ale najlepiej oddawał to, co chcę osiągnąć — że w warpie ustawiasz planetę daleko, jest mała, i jak mijasz, to
> ogromna, potem znowu mała, i inne elementy gry też takie powinny być. Odpicuj efekt warp i zrób go raz a porządnie.”

Prototyp, o którym mowa, to „kropla” z 2026-09-26 (commit 96854205, `src/3d/warpWorldLens.js` w tamtej wersji): świat
ściśnięty wokół statku, wielkość ~1/d. Wcześniejsza uwaga (2026-10-23): „przelot nad planetami ma wyglądać podobnie
do dotarcia do celu: planeta z daleka, powiększa się powoli, pod statkiem duża, potem ucieka za statek”.

Odpowiedź: JEDEN warp gracza. Widowiskiem jest ŚWIAT W SOCZEWCE — każde ciało (planety, księżyce, małe ciała,
słońce) i rzeczy przypięte do nich są w kadrze skoku, z daleka małe, w trawersie ogromne, za trawersem wylatują z kadru
(mapa O1 od 2026-10-26; w mapie C za rufą malały); do tego smugi
gwiazd, kop kamery i przylot jako jedno zdarzenie. Rozgrywka (fizyka skoku, rampa, ślizg, zwolnienie przy ciałach)
bez zmian — 3D to tylko obraz.

## Mapa O1 „kamera pochylona” (`src/3d/warp/worldLens.js`, DECYZJE-2 O1-1…O1-4, 2026-10-26)

Wybór użytkownika po teście mapy C (2026-10-26: „a właśnie że O1 wydaje mi się najlepsze”). Mapa C zawijała tory:
dwa punkty zbiegu (przed dziobem i 1,25 drogi pod kadrem) robiły z toru mijanego ciała literę „V” (Mars: skręt 131°
w 2 s), pas boczny W / √(l² + B²) ściskał dalekie ciała przy krawędzi kadru, a obrót przelotu 1 przekręcał ringi.
O1 to homografia płaszczyzny gry — tak widzi ją kamera pochylona nad statkiem.

Osie EKRANU (kadr obrócony kursem w górę), ciało względem statku: `a` — wzdłuż kursu (+ przed dziobem), `l` — w bok.
Drogi od kotwicy do krawędzi kadru: przed dziobem `e_f`, w bok `e_s` (średnia obu stron) [px].

```
s   = w_s · min(ē_s, e16) · k_v / B1  skala w trawersie [px/j.]; e16 = 16/9 · połowa wysokości kadru (aspectMax),
                                      k_v = min(1, speedRef / v napędu) — 1 dla Mk I i Mk II, 0,7 dla Mk III
E   = h_f · e_f                       punkt zbiegu (horyzont) przed dziobem [px od kotwicy]
A   = E / s                           płaszczyzna kamery za statkiem [j.] (nie zależy od rozdzielczości ani od proporcji
                                      kadru 16:9 i szerszych; Mk III — × 1 / 0,7)
w   = 1 + β · a / A                   głębia obrazu (1 — statek, 0 — płaszczyzna kamery)
q   = flat^(1−β) · s^β / max(w, 1 / kMax);   obraz = P0 + q · (dx, dy);   promień = q · r · smoothstep(hideW0, hideW1, w)
```

Każde β to homografia (proste → proste), β → 0 daje dokładnie prawdziwy obraz (w = 1, q = flat). Odwrotność dla
HUD-u (`warpLensInverse`, postać zamknięta): u = X_a / E → a = A · u / (1 − u), l = X_l / (s · (1 − u)); za płaszczyzną
kamery — przez kMax · s; horyzont i wszystko za nim (u ≥ 1) nie ma przeciwobrazu.

Parametry (`WORLD_LENS_DEFAULTS`): `hf` 0,8, `ws` 0,8, `B1` 87 464 j. (z prototypu O1 — Mars 75 tys. j. z boku stoi
w trawersie tam, gdzie w mapie C: 659 px od statku, promień 263 px przy 1080p), `kMax` 20, `hideW0` / `hideW1`
0,05 / 0,1, `flybyTilt` 0,5, `aspectMax` 16/9 i `aspectFlow` 0 (proporcje kadru — § „Mapa O1 — proporcje kadru i napęd”),
`speedRef` 175 tys. j/s (napęd — tamże), `exitMovePx` / `exitSizePx` 40 / 30 (czas zanurzenia przy wyjściu — niżej).
Przy 1080p 16:9, kotwicy 189 px pod środkiem i napędzie Mk I / Mk II: s = 0,00878 px/j., E = 583 px, A = 66 418 j.;
dolna krawędź kadru przecina oś kursu 25 tys. j. za statkiem (Mk III: s = 0,00615, A = 94 883 j., 35,7 tys. j.).
Wszystko w px skaluje się z wysokością kadru (1440p × 1,333); kadr szerszy niż 16:9 dokłada boki.

Rysunek słowny (kadr 1920 × 1080, kurs w górę, statek ~⅓ wysokości pod środkiem):

- Daleki cel i ciała przed dziobem siedzą przy PUNKCIE ZBIEGU — 0,8 drogi od statku do górnej krawędzi — jako kropki
  (≥ 2 px planety i słońce; słońce × 5). Zbliżając się, schodzą z punktu zbiegu po PROSTYCH i rosną (wielkość z daleka
  ≈ r · E / a). Tor ciała to prosta przez punkt zbiegu — bez zakrętu w trawersie.
- W TRAWERSIE skala s (Mars 75 tys. j. z boku: 263 px promienia przy 1080p). Za trawersem ciało dalej rośnie
  i WYLATUJE z kadru — bokiem albo dołem (Mars w S1: do 565 px, wylot bokiem po ~1 s). Nie wraca pod statek i nie
  maleje „za rufą” — to świadomy wybór użytkownika (mniej ciał naraz: kontrola C1 w symulatorze jest informacyjna).
- Ciała 300 tys. j. z boku (Jowisz w S3) wyjeżdżają bokiem kadru jeszcze PRZED trawersem (r ~180 px).
- PŁASZCZYZNA KAMERY (O1-2): obraz ciała przy w → 0 uciekałby w nieskończoność — skala stoi na kMax · s (obraz daleko
  za kadrem, bez osobliwości), a promień gaśnie w paśmie w 0,1 → 0,05 (obraz leży wtedy ≥ 9 · E od kotwicy — za
  kadrem). Ciała za płaszczyzną kamery są niewidoczne (także kropki planet i słońca; punkty flot — krycie × ukrycie);
  ciało, którego obraz soczewki leży w tym paśmie, a prawdziwy jest poza kadrem, wchodzi w soczewkę wynurzeniem w miejscu
  (niewidoczne przez całe przejście). Planeta startu (ciało startu z dokiem w kadrze — symulator S7, Ceres) wylatuje
  DOLNĄ krawędzią kadru w ~0,6 s od kopu i znika.
- Planeta dokładnie na kursie (O1-4, l = 0): tor po osi kursu od punktu zbiegu, tempo dY/da = s · A² / (A + a)² → 0
  przy punkcie zbiegu — bez osobliwości.
- Tarcza zachodzi pod statek tylko przy prawdziwym przelocie nad ciałem (`q · (d − r) > 0` dla d > r; obraz podobny wokół
  kotwicy — statek nad tarczą w obrazie ⟺ nad ciałem naprawdę). Od etapu „studnie” ciało, przez które przechodzi oś kursu,
  ma skalę cięciwy kursu (ogromna tarcza POD statkiem — § „Studnie grawitacyjne — soczewka”); kieszeń kadłuba (odstęp
  `edgeGap` 24 px od tarczy z ringiem `rExt`) zostaje tylko dla ciała blisko statku na starcie.
- Ciała za celem w stożku ±30° wokół kursu zanurzają się (promień → 0 płynnie), żeby nie siedziały na tarczy celu.
- Obrót przelotu (O1-3): wirtualna kamera 100 tys. j. nad statkiem × `flybyTilt` 0,5 (Mars 41° → 18° w trawersie,
  Jowisz w S3 36° zamiast 72°); prośba o obrót z 2026-09-26 zostaje, spłaszczony ring był częścią „zawijania”.

KOTWICA P0 (M3): `P0(β) = statek + (P0_nom − statek) · β`, P0_nom — nominalne miejsce statku w kadrze (sprężyna riga
BEZ kopu i BEZ wysunięcia: `cameraRig.nominalX / Y`). Przy β = 1 świat soczewki stoi w kadrze jak gwiazdy, a statek
wyrywa się względem niego przy kopie. Planety tła (z = −50 000): kotwica × (flat / zoom)^(1−β).

Tryby przejścia ciała (P2), ustalane RAZ na przejście: RUCH (rodzina q_β — cel, ciało z prawdziwym obrazem w kadrze
albo bliskim) albo WYNURZENIE / ZANURZENIE w miejscu obrazu soczewki (promień × smoothstep(0,1; 0,8; β), położenie
× (1 + 0,06 · (1 − β))). Ciało nie wjeżdża pod statek i nie przelatuje przez kadr.

Rozstawienie w świecie: `lensImageToWorld` (jedna czysta funkcja: płaszczyzna gry 1 / zoom, tło (camZ − z) / focal,
obrót kadru) — planety, księżyce, małe ciała i słońce (`planet3d.assets.js`: `newLensBody(id, kind)`).

### Mapa O1 — wyniki i tempo warstwy (W0)

Symulator (`warp-soczewka-sym.mjs`, S1–S8, 1080p i 1440p, kadr 16:9): przy napędach Mk I, Mk II i Mk III wszystkie
kontrole poza C1 przechodzą (C1 — informacyjnie: brak słońca w S1, Merkurego, Wenus, Ziemi i słońca w S3, w S4 / S6 / S7 / S8
1–3 ciała w locie). Mk II, S1 Mars: tor prosty (skręt 0°), w trawersie (a = 0) 263 px, szczyt 565 px przy wylocie
(2338 px/s = 39 px/kl.); cel rośnie × 3,98 przy wyjściu, puszczenie 1 px/kl.; najmniejszy odstęp tarczy od kadłuba
45 px (S8, Jowisz); 0 mignięć. S7 (start z portu Ceres): Ceres w kadrze od ładowania, wylot dolną krawędzią po 0,8 s
(77 px, 33 px/kl.), za płaszczyzną kamery promień 0. S8 (przylot do Io tuż po minięciu Jowisza): Jowisz pod statkiem
w chwili wyjścia, zanurzenie Δr 37,8 px/kl. (P4 50). Mk III (skala × 0,7 — § „Mapa O1 — proporcje kadru i napęd”): S4 Io
46 px/kl. (przed poprawką 65,7), S1 Mars w trawersie 184 px (próg C2 × 0,7). Prototyp i kod gry dają przy Mk II na 16:9
te same tory (różni się tylko kąt obrotu przelotu).

WYJŚCIE — czas zanurzenia z tempa obrazu (`exitMovePx` / `exitSizePx` 40 / 30 px/kl. przy 1080p): w pierwszej klatce
wyjścia soczewka próbkuje przebieg obrazu ciała (16 kroków tej samej funkcji co klatka) i wydłuża jego zanurzenie / powrót
(najkrócej `submerge` 0,3 s, najdłużej do końca okna wyjścia exitSlow + submerge — wtedy β osi opada do 0); ciało z dłuższym
zanurzeniem zaczyna najpóźniej tak, żeby skończyć z oknem (duża tarcza pod statkiem — przed frontem smug). Zapas wobec P4
(60 / 50): ciało mijane tuż przed wyjściem rośnie jeszcze w trakcie zanurzenia (S8: Jowisz 552 → 737 px). Wyjście po
bliskim przelocie (1080p): Jowisz w płaszczyźnie 50 / 30 tys. j. — Δr 136 → 41 px/kl., Ziemia 107 → 40, Mars 75 → 40,
planety tła (ruch) 54–77 → 46–48 px/kl. ruchu. Zmiana tylko w `worldLens.js` — oś β (`warpLensPhase.js`) bez zmian.

Tempo obrazu ciał w locie (W0, px/s przy 1080p 16:9; walka i hipercruise — soczewka wyłączona, β = 0, bez zmian). Kolumny
„trawers”, „dolna krawędź” i „punkt zbiegu” to STAN USTALONY (kotwica na miejscu, statek w pełnej prędkości napędu; z mapy);
mediana i p90 — symulator S1–S8 (w pierwszych ~0,1 s lotu kotwica jeszcze jedzie, więc kolumna „daleko” symulatora ma tam
do ~215 px/s):

| napęd | k_v | mediana / p90 (S1–S8) | trawers 75 tys. j. (bez zwolnienia / przy 15%) | dolna krawędź na osi kursu | punkt zbiegu (1,5 mln j.; l 0 / 300 tys.) |
|---|---|---|---|---|---|
| Mk I | 1 | 1–61 / 16–203 | 1359 / 199 | 2347 (39 px/kl.) | 1,6 / 7,3 |
| Mk II | 1 | 2–117 / 21–289 | 2424 / 350 | 4241 (71 px/kl.) | 2,8 / 12,8 |
| Mk III | 0,7 | 3–173 / 26–326 | 2049 / 296 | 4241 (71 px/kl.) | 5,5 / 18,1 |

Kolejność w warstwie: tempo maleje z głębią (dalej wzdłuż kursu — wolniej; test `W0` w `warpLensMapC.test.mjs`). Między
warstwami (test „W0 między warstwami”; gwiazdy w warpie: min(v, 14 000) · paralaksa · zoom skoku — deep do 46, mid do
296 px/s): ciało w trawersie bez zwolnienia jest szybsze niż gwiazdy mid (≥ 1359 px/s), przy zwolnieniu 15% — w paśmie mid.
WYJĄTEK W0 (do wpisania w DECYZJE): ciała przy punkcie zbiegu (≤ 18 px/s) są wolniejsze niż gwiazdy deep — punkt zbiegu
to kierunek lotu (cel podróży stoi w nim jak w kamerze), a warstwy gwiazd przesuwają się równolegle do kursu; tak samo
w mapie C. Test pilnuje obu stron.

### Mapa O1 — proporcje kadru i napęd (recenzja O1, 2026-10-26)

PROPORCJE (`aspectMax` 16/9, `aspectFlow` 0): ē_s liczone najwyżej z kadru 16:9 tej wysokości (e16). Dawniej s rosło
z szerokością kadru (zoom gry też — `defaultShipZoom(W)`), a A = E / s malało jak H / W: na 5120 × 1440 s × 2, A ≈ 33 tys. j.,
tempo obrazu × 2 względem wysokości kadru. Teraz s, A i środkowy kadr 16:9 są takie jak na 16:9, a boki szerszego kadru
pokazują więcej świata (ciała dalej z boku). Tempo obrazu w perspektywie rośnie jednak z odległością od punktu zbiegu, więc
ciała w bocznych pasach 21:9 / 32:9 jadą szybciej niż cokolwiek w kadrze 16:9. Symulator 5120 × 1440 (P4 względem
wysokości: 80 px/kl., promień 67), maks. ruch w kadrze:

| przebieg (Mk II) | dawne s z szerokości (`aspectMax` 0) | domyślnie (`aspectFlow` 0) | `aspectFlow` 1 |
|---|---|---|---|
| S1 lot | 172 (Mars) | 175 (Ceres w bocznym pasie); kop 122 (Luna) | OK |
| S1 wyjście | 98 (Kallisto — mapa C: 98) | 98 | 98 |
| S2 / S4 / S6 lot | 104 / 154 / 106 | OK | OK |
| S3 lot | OK | 80,2 (Europa) | OK |
| S7 ładowanie | 86 (kamera) | 88 (kamera) | 88 (kamera) |
| S8 wyjście / przylot | 338 / 98 | 100 / 98 | 100 / 98 |
| Mars w trawersie (C2) | 702 px | 351 px | 176 px |
| inne kontrole | — | S5: kropka Luny 2,2 px znika przy przerwaniu | C2 |

Wnioski: (1) domyślne ustawienie usuwa błędy z recenzji w S2, S4, S6 i Marsa w S1, ale nie spełnia P4 w bocznych pasach
32:9 dla szybkich ciał bez zwolnienia (Ceres, Luna przy kopie); `aspectFlow` 1 spełnia P4 w locie, płacąc światem
o połowę mniejszym na 32:9. (2) Błędy niezależne od mapy: ładowanie S7 (prawdziwy obraz — zoom gry z szerokości, Ceres
2 × większa względem wysokości), wyjście i przylot S8 oraz S1 (kamera oddala kadr przylotu; mapa C ma to samo), na
3840 × 1080 cel S1 poza kadrem 0,43 s (podłoga zoomu kamery 0,035). (3) P4 liczone względem wysokości jest surowsze niż
kamera gry, która na 32:9 powiększa wszystko × 2 (zoom z szerokości) — względem skali kamery domyślne ustawienie mieści się
w P4 poza Ceres w S1 (175 / 160). Decyzja przy teście na 32:9: `aspectFlow` 0 (świat jak na 16:9) albo 1 (tempo jak na 16:9).
21:9 (3440 × 1440, domyślnie): Mk II — S1 Ceres 82,9 (80) i ładowanie S7 81,8; Mk I — tylko S7.

NAPĘD (`speedRef` 175 tys. j/s, `ctx.driveSpeed` = `warp.speed` — sterownik `warpNurt.js`, w workerze `WARP_SPEED`
migawki): napęd szybszy niż Mk II zmniejsza skalę mapy s × speedRef / v (Mk III × 0,7, A × 1 / 0,7) — tempo obrazu s · v
(trawers, wylot dołem blisko osi kursu 2,6 · s · v) jak przy Mk II, świat w soczewce mniejszy (Mars w trawersie 184 px,
w symulatorze próg C2 × 0,7). Mk I i Mk II — bez zmian. Prędkość napędu jest stała dla wyposażenia (nie prędkość z planu
skoku `warp.cruise` — ta w S1 przy Mk II sięga 229 tys. j/s, bo plan nadrabia zwolnienie przy Marsie), więc skala nie
zmienia się w skoku i tory zostają proste. Bez tego przy Mk III ciało bez zwolnienia wylatujące dołem blisko osi jedzie
do 104 px/kl. (symulator S4: Io 65,7). Alternatywa — zostawić skalę i przyjąć P4 > 60 przy Mk III (`speedRef` 0).

### Mapa O1 — sprawy otwarte

- Szerokie ekrany (21:9, 32:9): boczne pasy — wyżej (`aspectFlow` do decyzji na 32:9).
- Mk III: świat × 0,7 (C2 względem skali napędu) albo P4 > 60 — wyżej (`speedRef`).
- Kropki flot w wyjściu: kropka 5000 j. przed dziobem wraca na prawdziwe miejsce 78 px/kl. (mapa C 67) — skala przy
  statku O1 0,0088 px/j. wobec 0,017; próg testu W1 podniesiony z 70 do 80 px/kl. (odstępstwo — do DECYZJE). Dłuższy powrót
  punktów wymaga zmiany `warpLensPointBeta` (`warpLensPhase.js` — ta sama funkcja decyduje o kropce po stronie gry).
- Kieszeń kadłuba przy starcie z doku: ciało startu najpierw podjeżdża ~90 px ku statkowi (kieszeń puszcza),
  potem wylatuje dołem — ciągle, jak w mapie C.
- Duża tarcza przy wyjściu, gdy okno wyjścia nie wystarcza (tarcza > ~1000 px przy 1080p albo kamera oddala kadr przylotu
  na 32:9): zanurzenie trwa najwyżej do końca okna (exitSlow + submerge) — dłużej tylko ze zmianą osi β.
- Komentarze „mapa C” w modułach poza soczewką (`warpNurt.js`, `planet3d.assets.js`, `hexShips3D.js`, dema) — do
  poprawienia przy najbliższej zmianie tych plików (tylko opis).

### Mapa O1 — do obejrzenia w grze

1. Ziemia → Jowisz z Marsem blisko kursu: Mars schodzi z punktu zbiegu po prostej, rośnie przez trawers i wylatuje
   bokiem (bez zakrętu „V” i bez powrotu pod statek); obrót tarczy i ringu słabszy niż dotąd.
2. Swobodny skok obok Jowisza (300 tys. j. z boku): Jowisz wyjeżdża bokiem przed trawersem — czy mijanie „widać”.
3. Start z portu bez ringu (Ceres, Westa, Wenus): ciało startu i dok w ładowaniu, po kopie wylot dolną krawędzią
   i zniknięcie, bez mignięcia.
4. Ile ciał naraz w locie (C1 słabsze — np. Jowisz → Saturn 1–2 ciała): czy kadr nie jest pusty.
5. Ekran 32:9 (5120 × 1440): boczne pasy — szybkie małe ciała (Ceres, Luna przy kopie) przy `aspectFlow` 0; porównać
   z `aspectFlow` 1 (świat o połowę mniejszy) — decyzja.
6. Napęd Mk III: świat w soczewce × 0,7 (Mars w trawersie ~184 px przy 1080p) — czy nie za mały.
7. Wyjście tuż po bliskim przelocie dużej planety (przylot do Io albo Fobosa): duża tarcza pod statkiem zanurza się dłużej
   i zaczyna przed frontem smug — czy nie „gaśnie za wcześnie”.
8. HUD w skoku i kropki flot przy wyjściu (W1 — kropki przed dziobem wracają szybciej niż w mapie C).

## Oś faz (`src/render/warpLensPhase.js`, zegar GRY)

| faza | czas | soczewka (β) | obraz i kamera |
|---|---|---|---|
| ŁADOWANIE | `warp.chargeTime` 0,8 s | 0 → 0,9 · smoothstep(postęp) — „świat wstaje”: planeta startu odpada pod rufę, reszta wchodzi w kadr | smugi gwiazd 0,32 · ładowanie², oddalenie × 0,55, drżenie w 2. połowie, cień kadłuba gaśnie |
| KOP | 0,45 s | 0,9 → 1 easeOut³ | smugi gwiazd z 0,32 przestrzał × 1,4 w 0,12 s (bez ząbka), fala w punkcie skoku, błysk za rufą, kop kamery (statek wyrywa się ~96 px), zoom −10%, wstrząs 18 / 0,3 (gra) |
| LOT | do wyjścia | 1 | smugi gwiazd, świat w soczewce; przy mijanym ciele statek zwalnia do ~15% (fizyka), przepływ widoczny z nim |
| WYJŚCIE — zwolnienie | `ramp.slow` 0,7 s | front smug gwiazd od dziobu ku rufie (+18 → −18 tys. j.); ciało zanurza się / wraca 0,3 s po przejściu frontu | smugi gasną frontem, wstrząs 8 / 0,4; cel trzymany (niżej) |
| WYJŚCIE — wlot | `ramp.coast` 0,45 s | jak wyżej | statek leci z prędkością wlotu; z celem bez wysunięcia (K1) |
| PRZYLOT = hamowanie | chwila `ramp.tBrake` | cel rośnie z hamowaniem | jedno zdarzenie: błysk, blask, fala 0,5 L, żar τ 0,45 s, wstrząs 22 / 0,3, zoom +10% |
| ŚLIZG | do prędkości bojowej (~5 s) | wiek wyjścia trwa do zatrzymania + 14 s (`WARP_LENS_EXIT_SPAN`) | rampa hamuje do vEnd = 3 × prędkość bojowa, potem ślizg; kadr przylotu trzyma do zatrzymania + 1 s, powrót do zoomu gracza smoothstep 2 s |

Przerwane ładowanie: β opada w 0,3 s. Wyjście bez rampy (hamowanie grawitacyjne, teleport): wirtualna rampa od tej
klatki, ten sam front. Wyjście w trakcie kopu: β wyjścia = β z chwili wyjścia, tryby z wejścia zostają. Hipercruise:
β = 0 (bez soczewki — gra obok statku czytelna).

Strona gry liczy oś raz na klatkę renderu: `stepPlayerWarpLensPhase()` (`index.html`) → `stepWarpLensPhase(track, s,
warp, SimClock.render)`. Rekord `s` idzie do klatki „Nurtu” (`o.lensPhase`, tryb off) i do migawki (worker) —
`warpLensBeta(s)` daje to samo β w obu trybach.

## Cel i kadr przylotu

- Cel (`warp.targetBody`, planeta przy końcu odcinka TRAVEL TO) jest w soczewce od kopu jak każde ciało — z daleka
  kropka w punkcie zbiegu („ustawiasz planetę daleko, jest mała”).
- Skala celu `q_T` = miękkie maksimum w logarytmie (szer. 0,15) z `q` mapy i podglądu kadru przylotu `z_v` —
  `warpArrivalScale` z `src/render/warpArrivalFrame.js`, TA SAMA funkcja i stałe co kamera (`arrivalDist` riga):
  `z_kam = fill · edge / (d − k · (ce − (1 − fill) · edge))`, `fill` 0,75, k = głębokość / ogniskowa (cel na tle
  z perspektywą i paralaksą; płaszczyzna gry — k = 0), miękkie minimum z kadrem skoku `zoomRef`. Bliski brzeg zbiega do
  krawędzi kadru przylotu, tarcza rośnie RAZEM z hamowaniem.
- Przy wyjściu β celu = 1, dopóki kamera nie zbiegnie z podglądem (|ln(skala prawdziwego obrazu / q_T)| < 0,05 przez
  0,05 s) albo do zatrzymania + 0,3 s (najwyżej 8 s po rampie); potem puszczenie smoothstep 0,6 s na prawdziwy obraz.
  Od zatrzymania q_T nie mniejsze niż prawdziwy obraz (podłoga w 1 s). Cięcie (teleport) — od razu.
- Księżyce celu jadą skalą celu. Cel bez obrotu przelotu (`lensFaceQuat`).
- Sterownik trzyma soczewkę, póki `WARP_WORLD_LENS.targetHold` > 0.

## Kamera K1 (`src/game/cameraRig.js`, `src/game/cameraZoom.js` — reguła `kamera`)

- Kadr przylotu przy wyjściu Z CELEM: sprężyna logarytmu zoomu goni zoom, przy którym bliski brzeg PRAWDZIWEGO obrazu
  celu leży na 0,75 drogi do krawędzi przed dziobem (kamera tylko się odsuwa — miękkie minimum z kadrem skoku).
- Podłoga zoomu tylko przy zatrzaśniętym kadrze przylotu: 0,07 · zoomRef (`rig.warpZoomFloor` → `camera.zoomImpulseMin`
  → `cameraZoomFloor`; wyjątek od limitu kadłuba 0,035 — kadr przylotu do Marsa przy 1080p ~0,019, Atlas wtedy mały).
- Bez wysunięcia statku przy wyjściu, wyprzedzenie zostaje — przy KAŻDYM skoku (warp zawsze do celu, DECYZJE-2 T2;
  dawna gałąź swobodnego skoku z wysunięciem 0,4 pół kadru i dogonieniem w 1,3 s usunięta razem z `WARP_EXIT.ahead`).
  Cel = ciało: kadr z brzegu jego tarczy; cel = punkt (punkt w próżni, skok awaryjny, przerwany skok —
  `warp.route.arrive` 'point'): odległość 0 — kadr skoku bez odsuwania, ta sama oś trzymania i powrotu.
- Trzymanie kadru przylotu do końca ślizgu + 1 s, powrót do zoomu gracza smoothstep 2 s. Nowe ładowanie przy
  zatrzaśniętym kadrze — zejście do kadru skoku smoothstep 0,8 s.
- Obrót kadru kursem w górę od ładowania do chwili po zatrzymaniu (`stepCameraRigRoll`, `warpJumpRollOmega` 5/s).
- Hipercruise kolejnego odcinka TRAVEL TO przejmuje kamerę dopiero po powrocie kadru przylotu (`playerWarpArrivalLive()` w `index.html`).

## Warp zawsze do celu (DECYZJE-2 T1–T4, 2026-10-26)

Decyzja użytkownika po teście: „tak robimy [warp do celu]” (model C analizy „warp z miejsca do miejsca”). Każdy skok
gracza ma cel albo punkt końca — swobodnego skoku w dziób bez końca nie ma (dawniej: 5,4% skoków wpadało w studnię bez
rampy, 94,6% bez ręcznego wyjścia doleciałoby do brzegu świata).

- **Klawisz warpa** (CapsLock / 9): (1) kurs TRAVEL TO, gdy dziób w ±5° od odcinka (zielone pasmo) albo w stożku ±20°
  (kurs gracza wygrywa z innymi celami w stożku); (2) cel w stożku ±20° przed dziobem (ciało, port, stacja, punkt i cel
  misji, olbrzym i pole pasa, wrak, wrogi kontakt — `collectTravelTargets`; tarcza studni ciała liczy się jak trafienie
  w środek, wygrywa najmniejsza odchyłka, potem najbliższy; skok do ciała idzie tam, gdzie promień dzioba — obrócony
  najmniej, ile trzeba — wchodzi w brzeg studni, więc namiar odchodzi od dzioba najwyżej o stożek; inne cele — do brzegu
  budowli po pierwszym odcinku planisty TRAVEL TO ze studniami skoku); (3) skok awaryjny 400 tys. j. w dziób, skrócony
  przed brzegiem studni HAMUJĄCEJ skok (słońce, baza piratów; od etapu „studnie” planety i małe ciała skok przelatuje —
  § „Studnie grawitacyjne — przelot nad planetą”), przed jądrem studni startu (z portu bazy w głąb — odmowa) i przed
  brzegiem świata, bez dodatkowej ceny. Kurs = dokładny namiar przy starcie
  ładowania; dziób dociąga się do niego w ładowaniu (`warpChargeTurn`, 24° w ~0,55 s z 0,8 s), w skoku bez skrętu.
  Wyjście automatyczne przy punkcie, komunikat HUD. Ręczne wyjście w locie zostaje. Skok oddalający się od źródła studni
  hamującej nie hamuje grawitacyjnie przy wylocie z jej stref orbit (`warpLeavingWell`). W studni planety, małego ciała
  i słońca skok nie startuje (etap „studnie”).
- **Czasy skoku awaryjnego** (bez ciał na kursie, Atlas): Mk I / II / III — prędkość przelotowa 52,0 / 60,1 / 60,1 tys.
  j/s, do wyjścia 7,67 / 6,67 / 6,63 s, zatrzymanie (rampa 1,33 s + ślizg 5,07 s) po 14,1 / 13,1 / 13,0 s od kopu.
- **CIC**: TRAVEL TO przyciąga do najbliższego celu w 28 px mapy (menu PPM pokazuje jego nazwę), w próżni — „PUNKT”.
- **Plan trasy przy kopie** (`warp.route`, WORLD `WARP_ROUTE_*` — układ migawki 4): rodzaj skoku, przylot (ciało /
  punkt), punkt skoku i zatrzymania, droga, czas do wyjścia i do zatrzymania, prędkość przelotowa, najbardziej widoczne
  mijane ciało z chwilą trawersu, pierwszy przelot przez strefę pasa (drogi i chwile). Stała długość, ten sam obiekt
  w trybie off i w workerze — dla akcentów, dźwięku i pasa jako zdarzenia trasy (zespół skał — opcja D).
- **Kamera**: kadr przylotu K1 przy każdym wyjściu (ciało — z brzegu tarczy; punkt — bez odsuwania), bez wysunięcia
  statku (§ „Kamera K1”).
- **Stałe kąty planet** (T3): kąty z ziarna świata zapisanego w zapisie gry (`worldSeed`, wersja zapisu 2); ziarno
  ustala się przy starcie strony — `?ziarno=<n>` / `?ziarno=nowe`, zapis, bez zapisu nowe. Zbiór tras między hubami
  jest w danym zapisie skończony (45 par) — każdą da się przepuścić przez symulator. Menu nie ma jeszcze „Wczytaj”,
  „Nowa gra” nie przeładowuje strony, a autozapis niesie to samo ziarno — w praktyce układ jest stały na profil
  przeglądarki (nowy: `?reset=economy` / `?ziarno=nowe`); „nowa gra = nowe ziarno” czeka na decyzję (otwarte sprawy).
- **Hipercruise krótkich odcinków TRAVEL TO** (T4): start dopiero od `minLeg + stopMargin` (6 + 4,1 km) — odcinek
  6–10,1 km startował hipercruise co ~1 s z wyjściem po 2 klatkach.
- Tempo warstw (W0) bez zmian: wszystkie warstwy gwiazd liczą tempo z tej samej prędkości kamery (min(v; 14 000 j/s) —
  `STAR_SPEED_CAP`), więc kolejność deep < mid < speed nie zależy od skoku. Poza mijanym ciałem skok awaryjny leci
  ≥ 52 tys. j/s, × 0,3 przy planetach ≥ 15,6 tys. j/s — ponad limitem, gwiazdy mają tempo zwykłego skoku (deep 16–46,
  mid 90–296, speed 2217 px/s). Przy mijanym ciele (zwolnienie do 0,15) schodzi pod limit — Mk II 9,0 tys. j/s (64%
  tempa gwiazd), nad planetą w jej strefie też 9,0 tys. j/s (podłoga łącznego zwolnienia od etapu „studnie”; dawniej
  2,7 tys. j/s — 19%); wszystkie warstwy zwalniają w tej samej proporcji, jak w każdym skoku obok planety.

## Studnie grawitacyjne — przelot nad planetą (BRIEF-studnie, 2026-10-27)

Decyzja użytkownika (2026-10-26): „studnia grawitacyjna — trzeba to zmienić … jak przelatujemy centralnie nad planetą
efekt będzie najlepszy prawda? (…) nie można odpalić warpa PRZY planecie i trzeba od niej kawałek odlecieć, ale samo
przelatywanie w warpie? powinno jak najbardziej być. i masz wtedy ogromną planetę, nad którą możesz przelecieć i nie
wymuszasz przelotu bokiem”. Zasady w skrócie — reguła `warp`, „STUDNIE GRAWITACYJNE”.

LOGIKA GRY (zespół A):

- **Start zablokowany** w studni planety, małego ciała (`planetOrbitRadii(b).gravityWell` — granica strefy
  `planet_gravity`) i słońca (strefa `sun`, 2 · `SUN.r`): CapsLock / 9 / pad / UI → „WARP: STUDNIA GRAWITACJI — ODLEĆ OD:
  ZIEMIA · 3 KM DO BRZEGU” (nazwa po polsku — `RADAR_PLANET_NAMES`; planety mają w grze `name` angielskie), bez ładowania
  i bez przejęcia sterów (`refusePlayerWarpInWell` przed `takeManualWarpCourse`). Wnętrze ringu „Halo” (bliżej planety niż
  płyta habitatu) — start wolno (§ „Studnie grawitacyjne — poprawki po recenzji”). Baza piratów, NPC, ruch v2, wezwania
  wsparcia, holownik — jak dawniej.
- **TRAVEL TO ze studni**: odcinek 'drive' `wellExit` do punktu 5000 j. za brzegiem (`playerWellExitPoint`: z hali K-7 /
  zatoki — przez wylot doku osią hali; z dysku doku bez ringu — promieniowo od budowli; inaczej `wellExitPoint` — prosto
  w stronę celu, a przez jądro studni promieniowo), nie krótszy niż próg hipercruise'u (~10,3 km); potem skok.
- **W locie** studnia planety nie hamuje; słońce i baza piratów — `triggerGravityWarpBrake` jak dawniej (wylot z nich —
  `warpLeavingWell`); przechwyt fabularny misji 2 bez zmian.
- **Planista** bez objazdów planet i małych ciał (`getCruiseGravityObstacles` = strefa słońca + studnia bazy piratów +
  doki portów); cel kończy skok na brzegu swojej studni. Skok awaryjny skraca się tylko przed słońcem i bazą piratów;
  planeta na kursie jest celem ze stożka (odcinek do niej kończy się na brzegu jej studni).
- **Planeta startu na kursie** (wyjście promieniowe, cel za planetą): skok nad nią — mijane ciało
  (`route.flyBody`, zwolnienie przelotu), nie ciało startu (`warp.originBody` null).

PODŁOGA ZWOLNIENIA (`warpSpeedFactor(strefa, przelot)`, `WARP_SLOW_FLOOR` 0,15 — jedna funkcja w fizyce, planie
prędkości i symulatorze): nad planetą w jej studni strefa 0,3 × przelot 0,15 dawało 0,045. Odcinek z planetą dokładnie
na kursie w połowie (pomiar 2026-10-27 tą samą symulacją co `planWarpCruise`, krok 60 Hz; s, A — mapa O1 przy 1080p),
podłoga 0 (dawniej) / 0,15:

| napęd, planeta (odcinek) | prędkość przelotowa planu [tys. j/s] | nad tarczą [tys. j/s] | czas nad tarczą [s] | środek ciała w trawersie / przy dolnej krawędzi [px/kl.] |
|---|---|---|---|---|
| Mk I, Jowisz (1,5 mln j.) | 181 / 125 | 8,2 / 18,8 | 8,95 / 5,1 | 1,2 / 2,7 — 3,1 / 7,1 |
| Mk II, Jowisz (1,5 mln j.) | 271 / 190 | 12,2 / 28,5 | 5,7 / 3,3 | 1,8 / 4,2 — 4,6 / 10,7 |
| Mk III, Jowisz (1,5 mln j.) | 334 / 239 | 15,1 / 35,9 | 4,3 / 2,5 | 1,5 / 3,7 — 4,0 / 9,5 |
| Mk II, Mars (0,8 mln j.) | 231 / 163 | 10,5 / 24,4 | 3,8 / 2,4 | 1,5 / 3,6 — 3,9 / 9,2 |
| Mk II, Ziemia (1,2 mln j.) | 248 / 177 | 11,2 / 26,6 | 4,7 / 2,8 | 1,6 / 3,9 — 4,2 / 10,0 |

- Bez podłogi tarcza wisi pod statkiem do połowy podróży (Mk I nad Jowiszem 9 s z 18,6 s), a plan nadrabia to prędkością
  przelotową +39–45% — szybciej jedzie wszystko inne w kadrze (gwiazdy, mijane ciała, P4 w innych miejscach).
- Podłoga 0,15 = najgłębszy SAM przelot (1 − `depth`): nad planetą statek leci tak jak przy najbliższym bocznym przelocie,
  którego tempo W0 jest zmierzone (trawers 75 tys. j. przy 15%: Mk II 350 px/s).
- Górna granica z P4: środek ciała na osi kursu jedzie s · v w trawersie i 2,57 · s · v przy dolnej krawędzi kadru (25 tys. j.
  za statkiem); przy suficie prędkości przelotowej planu (`vMax` Mk I / II / III: 231 / 404 / 577 tys. j/s) P4 60 px/kl.
  przekracza dopiero podłoga ≥ 0,39 (Mk II, III; Mk I — 0,69). Przy 0,15 i suficie: 13 / 22,8 / 22,8 px/kl. Promień tarczy
  Jowisza w trawersie (a = 0) rośnie 2–3 px/kl. (P4 50).
- Liczby tarczy i jej przejścia w soczewce przy przelocie centralnym (d ≈ 0, tarcza pod statkiem) — § „Studnie
  grawitacyjne — soczewka” niżej (zespół B, scenariusze S10 / S11). Zespół B dołożył do zwolnienia PAS UKŁADU KSIĘŻYCÓW
  (tamże) — prędkości przelotowe planu przy przelocie centralnym w tabeli wyżej są sprzed tej zmiany.

Trasy TRAVEL TO (400 ziaren × 6 par: Ziemia–Jowisz, Ziemia–Saturn, Mars–Saturn, Wenus–Jowisz, Ziemia–Neptun,
Merkury–Mars; brzeg studni do brzegu): dawny planista objeżdżał studnię planety na 3,8% tras — 3 skoki zamiast 1 (droga
dłuższa o ≤ 0,8%, ale każdy skok to ładowanie, obrót i co najmniej ~8 s podróży). Przykłady (Mk II, suma czasów skoku
+ 0,8 s ładowania, bez obrotów): Mars → Saturn (ziarno 63352) 25,9 → 15,9 s, Ziemia → Neptun (253408) 42,7 → 26,1 s,
Wenus → Jowisz (182137) 24,1 → 14,3 s. Mars → Saturn 63352 po prostej przelatuje nad Jowiszem (51 tys. j. od środka):
prędkość przelotowa Mk I / II / III 136 / 214 / 276 tys. j/s (bez podłogi 187 / 290 / 373), nad Jowiszem
20 / 32 / 41 tys. j/s (bez podłogi 8 / 13 / 17).

DLA SOCZEWKI (zespół B, pkt 5–6 BRIEF-u): `warp.originBody` może być null przy statku tuż przy studni (skok nad planetą
startu); ciało mijane centralnie (d < r, także d ≈ 0) to zwykłe ciało przelotu w `_warpFlybyBodies` / `route.flyBody`;
`warp.flybyFactor` w migawce to sam przelot (bez strefy i podłogi). Symulator liczy prędkość tą samą funkcją
(`WD.warpSpeedFactor(zoneAt(…), WD.warpFlybyFactor(…))`) — S1–S9 bez zmian wyniku (podłoga nie wiąże: żadna trasa nie
przechodzi przez strefę planety).

### Studnie grawitacyjne — soczewka (zespół B, BRIEF-studnie pkt 5–6, 2026-10-27)

STAN WYJŚCIOWY (mapa O1, skala środka ciała, kieszeń kadłuba zawsze): przelot centralny nad Jowiszem dawał — (1) kieszeń
rozdmuchiwała tarczę przy brzegu ringu do prawdziwej skali (q → zoom kamery: Jowisz 421 → ~5600 px), (2) bez kieszeni
tarcza pod statkiem rosła × 3,6 (skala środka: 245 px przy wejściu nad tarczę, 1520 px przy zejściu — statek „opadał” ku
planecie), wylot dołem 82 px/kl. (S10, Mk II, P4 60), a ring wpadał w pas ukrycia za płaszczyzną kamery jeszcze w kadrze
(zwijanie — C9), (3) księżyce Jowisza mijane tuż za studnią w pełnej prędkości wylatywały z kadru ponad P4 (Europa 65,
Luna 81 px/kl. przy Mk II).

CIĘCIWA KURSU (`worldLens.js: warpLensChordAlong`, `WORLD_LENS_DEFAULTS.chord / chordSoft 0,25 / chordMax 0,9`): ciało,
przez które przechodzi OŚ KURSU (|l| < `rExt` — promień z ringiem „Halo” albo pierścieniem Saturna, `_lensPrepare`), ma
głębię mapy w punkcie osi kursu w ciele najbliższym statkowi: przed nim punkt wejścia (a − h), nad nim statek (0 — skala s),
za nim punkt wyjścia (a + h), h = √(rExt² − l²) ≤ 0,9 · A, końce wygładzone kwadratowo (C¹). Skutki:
- nad tarczą skala s — „stała wysokość”: tarcza POD statkiem nie rośnie i nie ucieka, powierzchnia jedzie s · v;
- punkt wejścia i wyjścia osi kursu leży dokładnie w homografii O1 — wylot dołem kadru w tempie mapy, ciało gaśnie za
  płaszczyzną kamery dopiero, gdy cała cięciwa jest za nią (bez zwijania ringu w kadrze);
- statek nad tarczą w obrazie ⟺ nad ciałem naprawdę (obraz podobny wokół kotwicy; tarcza z ringiem — to samo dla ringu);
- przed przelotem ciało na osi kursu jest większe niż w skali środka (skala punktu wejścia: Jowisz 100 tys. j. przed
  dziobem × 1,5, 1 mln j. × 1,05), ciała obok osi kursu i cel — bez zmian (skala środka, kadr przylotu);
- planeta startu NA OSI KURSU ZA RUFĄ też ma cięciwę: zamiast ukrycia za płaszczyzną kamery tarcza u dołu kadru (start
  z brzegu studni Ziemi: ring ~160 px pod statkiem, promień kuli ~420 px przy 1080p), wylot dołem w kopie — jak ciało,
  nad którym statek przeleciał (S1 kop 43 px/kl.; skala środka dawała przy Wenus w S10 61 px/kl. w kopie);
- decyzja raz na skok (`b.chordOn`): statek NAD ciałem już przy wejściu (dok bez ciała z promieniem doku) — skala środka
  i kieszeń jak dotąd (prawdziwy obraz pod statkiem, bez kurczenia w ładowaniu).
Kieszeń kadłuba (`pocket`, `b.pocketOn`) — tylko ciało blisko statku na starcie: ruch, bo prawdziwy obraz albo dok w kadrze
(attachR), cięciwa nie przed statkiem (dok Luny — S7, Hidalgo, dok bez ciała, olbrzym pasa); ciała mijane w locie, także
o włos od ringu, kieszeni nie mają. Bez nowego pola migawki: cięciwa i kieszeń liczą się z kursu, statku i rekordów ciał —
te same dane w trybie off i w workerze. A/B: `chord: 0`, `pocket: 0`; symulator `--param chord=0,pocket=0`.

PAS ZWOLNIENIA Z UKŁADEM KSIĘŻYCÓW (`warpDrive.js: warpFlybySlowdown(…, reach)`, `WARP_FLYBY_DEFAULTS.reachWidth` 0,9,
`warpMoonReach(moonsOf(id))` — najdalsza orbita + 12 tys. j.; Ziemia 108, Mars 104, Jowisz 262 tys. j.): pas nie węższy
niż 0,9 × zasięg — przelot centralny ma dziś pas 2,2 · r (Jowisz 106 tys. j.), przy brzegu układu zwolnienie ~0,7.
Przelot bokiem bez zmian (2,2 · (l + r) ≥ 0,9 · zasięg — Jowisz od ~59 tys. j. z boku). Ta sama funkcja w fizyce
(`_warpFlybyBodies[i].reach`), planie prędkości i symulatorze. 0,9, nie 1: przy 1 pas obejmował przelot S8 (Jowisz 69 tys.
j. z boku) i przesuwał chwile jego wyjścia — Mk III dawało mignięcie 4 px przy zanurzeniu (kruchość opisana w otwartych
sprawach). Koszt: wolniej przy planecie, więc plan nadrabia prędkością przelotową gdzie indziej.

Przelot centralny w połowie odcinka (krok 60 Hz, ta sama symulacja co plan; 1080p, mapa O1 — s 0,00878 px/j., Mk III × 0,7;
„wylot” — punkt wyjścia osi kursu z ringu na dolnej krawędzi kadru), pas bez układu księżyców / z nim (0,9):

| napęd, planeta (odcinek) | prędkość przelotowa planu [tys. j/s] | nad tarczą (najwięcej) [tys. j/s] | czas nad tarczą [s] | promień tarczy pod statkiem [px] | powierzchnia pod statkiem [px/kl.] | wylot dołem [px/kl.] |
|---|---|---|---|---|---|---|
| Mk I, Jowisz (1,5 mln j.) | 125 / 153 | 20 / 23 | 5,1 / 4,2 | 421 | 2,9 / 3,4 | 20,5 / 13,1 |
| Mk II, Jowisz (1,5 mln j.) | 190 / 235 | 40 / 37 | 3,3 / 2,7 | 421 | 5,9 / 5,3 | 28,8 / 19,4 |
| Mk III, Jowisz (1,5 mln j.) | 239 / 299 | 69 / 48 | 2,5 / 2,1 | 295 | 7,1 / 4,9 | 29,4 / 18,7 |
| Mk II, Ziemia (1,2 mln j.) | 177 / 182 | 42 / 36 | 2,8 / 2,7 | 332 | 6,1 / 5,3 | 28,8 / 26,2 |
| Mk II, Mars (0,8 mln j.) | 163 / 175 | 40 / 32 | 2,4 / 2,3 | 263 | 5,9 / 4,6 | 28,6 / 23,1 |

W0 (tarcza pod statkiem a gwiazdy): gwiazdy w warpie jadą min(v, 14 tys. j/s) · paralaksa · zoom skoku — przy 1080p
warstwa speed 1676–2923 px/s (28–49 px/kl.), mid ≤ 296 px/s. Powierzchnia pod statkiem: w środku odcinka ≤ 7 px/kl.
(tabela), w symulatorze S10 najwięcej 625 px/s (Mk II) i 777 px/s (Mk III) przy wejściu nad Ziemię (prędkość jeszcze goni
strefę) — WOLNIEJ niż każda gwiazda warstwy speed, zwykle szybciej niż mid (tarcza „między” warstwami: bliżej niż mgławica
i daleka mgiełka gwiazd, dalej niż drobiny speed). Kontrola C9 symulatora.

Symulator (S10 Wenus → Saturn, kurs 114°, Ziemia i Jowisz na osi kursu; S11 Mars → Saturn, Jowisz 51 tys. j. od kursu —
nad ringiem; promień kuli nad tarczą, czas nad tarczą, najgorszy krok P4 w locie — 1080p; 1440p: promień × 1,333,
P4 względem progów × 1,333):

| przebieg | Ziemia nad tarczą: promień / czas | Jowisz nad tarczą: promień / czas | P4 kop / lot / wyjście [px/kl.] | mignięcia |
|---|---|---|---|---|
| S10 Mk I | 329–335 px / 3,2 s | 416–427 px / 4,1 s | 37 / 46 / 18 | 0 |
| S10 Mk II | 330–335 px / 1,9 s | 416–427 px / 2,5 s | 56 / 37 / 25 | 0 |
| S10 Mk III | 232–233 px / 1,3 s | 293–297 px / 1,9 s | 57 / 40 / 24 | 0 |
| S11 Mk I / II / III (nad ringiem) | — | 414–429 / 414–428 / 292–298 px; 1,8 / 1,2 / 0,9 s | 34 / 33 / 18 · 43 / 49 / 20 · 47 / **62** / 24 | 0 |

Kop S10 = planeta startu (Wenus, na osi kursu za rufą) wylatująca dołem przy rozpędzie (najbliżej progu: Mk II 1440p 74 / 80).
Lot = księżyce (Europa, Kallisto) i wylot tarcz; S11 Mk III — Kallisto 62 px/kl. (otwarte sprawy). Spójność „nad tarczą
w obrazie ⟺ naprawdę” — 0 niespójnych klatek; promień nad tarczą stały (× ≤ 1,04 — końce cięciwy); zwijanie za trawersem 0.

### Studnie grawitacyjne — poprawki po recenzji (2026-10-27)

Recenzje „rozgrywka” i „obraz” etapu znalazły błędy w miejscach, których S1–S11 i testy nie sprawdzały. Stan po poprawkach
(liczby — symulator `warp-soczewka-sym.mjs` i testy `tests/warpStudnie.test.mjs`, `tests/warpLensPrzejscia.test.mjs`):

WYJŚCIE ZE STUDNI Z PORTU (rozgrywka ust. 1–3; `index.html: playerWellExitPoint`, `travelNav.js: wellExitPoint`,
`haloRingCollision.js: dockExit`):
- Dawny wylot styczny do strefy orbit (jądro = ring + 3000 j.) prowadził z bramy K-7 do celu „za Ziemią” (±58° od kierunku
  na środek — ~1/3 kierunków) przez front hali (z ≈ 7,4 tys., 2,6–3,5 tys. j. od osi), ze stanowisk C-01…C-04 (47,9 tys. j.,
  poza strefą orbit) — w ścianę boczną; hale Ziemi 46,25–53,4 tys. j., płyta przed bramą do 54,6 tys., `wallsOuter` 54 tys.
  (Mars 37,75–44,9 / 38,25, Jowisz 57,25–64,4 / 57,75 tys. j.). Skok z końca stycznej mijał też Ziemię 53–57 tys. j. od
  środka — bez przelotu nad tarczą.
- Dziś: jądro planety z ringiem = pas budowli portu (`wallsOuter` + 600 + zasięg kadłuba: Ziemia 55 588, Mars 47 086,
  Jowisz 66 586 j. przy studniach 55 752 / 47 250 / 66 750), prosta przez jądro → wylot promieniowy; statek w hali / zatoce
  — prosta przez bramę (x huba przycięte do prześwitu bramy − zasięg; pas stanowiska capital — osią hali); dysk doku bez
  ringu — promieniowo od budowli. Test na prawdziwej geometrii (`HaloRingWorld`, Ziemia / Mars / Jowisz; stanowiska
  C-01…C-04, statek po odcumowaniu przed bramą ×3, bok hali; cele co 10°; kadłub Atlasa 1800 × 806 wzdłuż odcinka co 60 j.):
  0 styków ze ścianami i płytą. Odcinki: ze stanowiska 12,8 km (Ziemia), sprzed bramy 10,3 km (wydłużony do progu
  hipercruise'u — dawniej ~3,8 km autopilotem bojowym), koniec 60,75–65,3 tys. j. od środka Ziemi.
- Cel w zapasie wyjścia po drugiej stronie planety — dawniej napęd prosto przez ring i planetę; dziś najpierw wylot.
- Statek pod halą (między płytą a ścianą tylną, pylony) — poza `dockExit` (wylot promieniowy w ścianę tylną; rzadkie).

WNĘTRZE RINGU (rozgrywka ust. 2): statek bliżej planety niż płyta habitatu (Ziemia: < 40,8 tys. j. — ponad połowa pola
studni i cała tarcza; tam ląduje ręczne wyjście w przelocie centralnym) — start skoku WOLNO (`rFree`). Dawniej planista
wyprowadzał promieniowo w płytę (hipercruise — „PŁYTA RINGU NA KURSIE”, autopilot pchał w płytę). Odcinek do tranzytu
wymaga precyzji ~0,1 km (tranzyt 570 j. pół prześwitu, Atlas 403), a dolot odcinka ma tolerancję 1,9 km — do decyzji
użytkownika (wyjątek startu albo prowadzenie do tranzytu).

BRAMKA RINGU A ODLOT NAD PLANETĄ STARTU (obraz K1; symulator S12 — start `--s12-za` j. za brzegiem studni Ziemi, kurs nad
Ziemią): przy starcie bliżej niż ~2000 j. za brzegiem prawdziwy ring z portem jest w kadrze skoku przez cały przelot —
bramka zostaje zamknięta, Ziemia nie wchodzi w soczewkę (C9: 2,4 s nad tarczą bez soczewki; prawdziwa tarcza 4400 px jedzie
pod statkiem z prędkością podłogi, Mk II 55–59, Mk III 69–74 px/kl.). Próg 2000 j. ten sam przy 16:9, 21:9 i 32:9 (1440p)
i Mk I–III. `TRAVEL_TUNE.wellExit` 5000 j. → odcinek wyjścia kończy się ≥ 3080 j. za brzegiem (tolerancja dolotu 1920 j.).
Odlot ręczny bliżej brzegu (gracz sam podleci i zawróci nad planetę) zostaje — bramka soczewki bez zmian.

PYŁ HALI K-7 W SOCZEWCE (próba w grze 10-27, oba tryby): przy przelocie nad Ziemią pył, stożki reflektorów i pola siłowe
hali przy kamerze zostawały w prawdziwym miejscu, a ring jechał z obrazem planety — „duch hali” nad soczewką (w main studnia
hamowała, przelotu nie było). Dziś `packHallDustFrame` dostaje ringi tylko przy `warpLensHudWorld()` — pył gaśnie od
β > 0,02 (także w ładowaniu obok hali) i wraca z resetem po wyjściu (test w `tests/warpStudnie.test.mjs`).

KSIĘŻYCE (obraz W2, W4; `worldLens.js: moonRigid`, `src/data/moonBodies.js`):
- W2 — księżyc w obrazie kuli rodzica: rodzic z cięciwą kursu rysuje się skalą punktu cięciwy, księżyc swoją mapą — Europa
  4,8 s (S10), Luna 1,4 s (S12) w obrazie kuli Jowisza / Ziemi, choć naprawdę za ringiem (w 3D znika w tarczy). Dziś
  księżyc rodzica z cięciwą PRZED statkiem jedzie skalą obrazu rodzica, za cięciwą płynnie własną mapą (`moonRigidFade`
  0,35 · A): 0 s w S10 / S12 (kontrola C9). Planeta startu za rufą — bez tego (księżyc w jej skali przelatywał kadr ponad
  P4: S2 Luna 120, S4 Io 96 px/kl.).
- W4 — księżyce mijane w pełnej prędkości: Luna i księżyce Jowisza są ciałami zwolnienia skoku (miejsce i promień bryły
  z danych obrazu — `src/data/moonBodies.js`, re-eksport w `src/3d/moonOrbit.js`), bez księżyców celu. S12 (start 3080 j.
  za brzegiem, kurs 0°): Luna Mk I / II / III 32 / 45 / 37 px/kl.; S10 z kursem 0° (`--s10-kurs 0`, Luna 88 tys. j. za
  Ziemią): Luna z 80 → poniżej progu, ale w tym wariancie Kallisto 66 px/kl. przy Mk II (otwarte).

SYMULATOR (2026-10-27): S12 w domyślnej liście; S13 (`--scen S13 --s13-za <j.>` — wyjście nad tarczą albo tuż za nią)
poza nią — otwarta sprawa W1 (niżej). Kontrola mignięć nie liczy końca CIĄGŁEGO kurczenia / rośnięcia (ostatni krok ≤
2 × poprzedni / następny w tę samą stronę): wynurzenie / zanurzenie w miejscu próbkowane klatkami zostawiało na końcu
3–5 px (S5 przy Mk III — Ziemia 12,8 → 3,5 → 0,1 px przy przerwanym ładowaniu; S8 przy Mk III — Jowisz 12,7 → 4,1 → 0,3 px
przy wyjściu), co dawniej szło jako mignięcie. C9 sprawdza też, że nad ciałem obraz jest w pełnej soczewce (bramka — K1;
dawna spójność „nad tarczą w obrazie ⟺ naprawdę” przy β = 1 była prawdziwa z konstrukcji — D2) i że księżyc nie leży
w obrazie kuli rodzica (W2).

Wyniki (S1–S12, 1080p / 1440p, 16:9): Mk I i Mk II — kod wyjścia 0; Mk III — tylko S11 (Kallisto 61,8 / 82,4 px/kl. przy
progach 60 / 80 — otwarte). S10 (Mk II): Ziemia 330–334 px / 1,83 s, Jowisz 417–427 px / 2,52 s nad tarczą, powierzchnia
pod statkiem ≤ 610 px/s (Mk III 794 px/s; gwiazdy speed ≥ 1676 px/s — W0); kop 56 / lot 36 / wyjście 25 px/kl.

## Ośrodek wyłączony (DECYZJE O1)

Ośrodek drobin (1 mln, turkus i pomarańcz) i soczewka bańki na mgławicy w skoku GRACZA są domyślnie wyłączone
(`player.js: warpMediumOn`) — turkusowe czoło leżało przed dziobem, w strefie punktu zbiegu, i rysowało się po
planetach. A/B: `?warpOsrodek=1` (działa też w workerze), w testach i demie `setWarpMedium(true | false | null)`.
Przyloty i odloty NPC (nić zwiastuna, bańki) i hipercruise (`?hcOsrodek=1`) bez zmian. Koszt `?warpOsrodek=1`
niezmierzony (otwarte).

## Jeden warp (sprzątanie S1)

Style skoku `'rulon'`, `'akcent'`, `'soczewka'` usunięte z `player.js`, z rigu kamery (środek lejka) i z dema.
`warpDrive.js` trzyma API zgodne dla dawnych importów (`warpStyle` → 'ped', `warpRulonEnabled` → false,
`setWarpStyle` → null). Usunięty martwy kod: szczeliny, szwy i smugi sylwetki (`addRift` / `addSeam` / `addSeamLens` /
`addSmear`, `RiftSprites`, `SmearPool` i ich rozgrzewka), implozja i soczewka bańki jako fale, `gearPulse` / `gearT`,
`WARP_FLOW.gear1`, `frame.shake`, `frame.busy`, `RULON_BOX`. Bez zmiany WGSL materiałów gry: bloki szczelin w kernelu
ośrodka i w mgławicy zostają (liczniki 0), hak rulonu zostaje (decyzja C2 — niżej).

## Worker (domyślny tryb gracza)

Migawka (`src/render/snapshotLayout.js`, `SNAPSHOT_LAYOUT_VERSION` 3, WORLD, Float64, pole nieobecne = NaN), lustro
czystym modułem `src/render/warpWorldMirror.js` (`applyWarpWorld`, bez alokacji):

- stan i lot: `WARP_STATE`, `WARP_CHARGE`, `WARP_CHARGE_TIME`, `WARP_GEAR` (martwy — do usunięcia przy następnej zmianie
  układu), `WARP_FLYBY`, `WARP_CRUISE`, `WARP_SPEED`, `WARP_ENTRY`, kurs `WARP_DIR_X / Y`;
- ciała: `WARP_TARGET_BODY`, `WARP_ORIGIN_BODY` — indeks na liście `planets ++ smallBodies` (−1 — brak);
- zegary: `WARP_KICK_SIM` (SimClock.sim kopu), `WARP_FX_CLOCK`;
- rampa wyjścia: `WARP_EXIT_ACTIVE`, `WARP_EXIT_AGE`, `_T0`, `_SLOW`, `_COAST`, `_BRAKE`, `_TSLOW`, `_TBRAKE`, `_THALT`,
  `_V0`, `_VARR`, `_VEND`, `_DIST`, `_DIR_X / Y`, `_HULL`;
- ślizg: `WARP_SLIDE_ACTIVE`, `_SPEED`, `_VMIN`, `_DECEL`, `_DIR_X / Y`; hamowanie grawitacyjne `WARP_ABRUPT`;
- kotwica kadru: `WARP_ANCHOR_SX / SY` (= −`cameraRig.nominalX / Y`, px CSS, osie ekranu; NaN poza kamerą statku);
- oś β: `WARP_LENS_*` (`WARP_LENS_FIELDS`: charge, kickAge, exitAge, exitSlow, exitHalt, exitBeta, abortAge, abortBeta,
  zoomRef, zoomJump, arrivalFill, …) + `WARP_LENS_STATE`, `WARP_LENS_HYPER`, `WARP_LENS_ARRIVING`.

Wstrząsy kopu, wyjścia i hamowania zgłasza GRA (`src/game/warpShakes.js` — te same chwile i wartości w obu trybach),
plazma WARP i dopalacza gracza działa w workerze, księżyce stoją w węzłach gry (`src/3d/moonOrbit.js`). Parzystość
β off ≡ worker: `tests/warpWorkerMirror.test.mjs`.

## Reszta świata w soczewce — rejestr kotwic (etap 3A, DECYZJE E1–E4)

„Inne elementy gry też takie powinny być” — w skoku jedzie z soczewką wszystko, co gracz widzi w świecie, a nie tylko
ciała. Trzy drogi, wszystkie przez wspólną soczewkę gry `WARP_LENS_SHARED` (`worldLens.js`, jedna na wątek renderu):

1. **Rzecz PRZYPIĘTA do ciała** (ring „Halo”, stacje przy planetach i małych ciałach, doki portów bez ringu) —
   kotwica ciała w rejestrze `WARP_LENS_ANCHORS[id]`. Pisze ją `planet3d.assets.js` po rozstawieniu ciał
   (`writeLensAnchor`: x, y — punkt płaszczyzny gry pod obrazem środka ciała, przy β → 0 prawdziwy środek także dla
   ciał tła z paralaksą; k — promień obrazu / prawdziwy; rx, ry — prawdziwy środek; px, real, vis, q / turned). Klucz:
   id planety, `mapId` księżyca ('luna', 'io'…), id małego ciała; słońce kotwicy nie ma. Obraz rzeczy:
   `p' = (x, y) + k · (p − (rx, ry))` (`lensAnchorPoint`); budowla z ramką — `root.matrix` = `lensPivotElements` · ramka
   (skala dodatnia — ten sam pipeline). Stacja bierze kotwicę `station.planet.id`, dok — id portu (księżyc bez bryły:
   planeta-rodzic z `SYSTEM_MAP_MOON_BY_ID`; w workerze kod ciała w bloku migawki `ANCHOR`). `WARP_RING_LENS` to ten sam
   rejestr (nazwa zgodności). Stacje i doki zgłaszają zasięg (`reach` → `b.attachR`): ciało z rzeczą przypiętą w kadrze
   wchodzi w soczewkę RUCHEM, więc dok startu nie przeskakuje w klatce wynurzenia (za to ciało może wjechać w kadr
   szybciej niż próg P4 — test „start z doku Ceres”: dok ≤ 11 px/klatkę, ciało 50–114 px/klatkę).
2. **Obiekt z WŁASNYM miejscem** (komety `comet:<id>`, olbrzymy pasa `giant:<id>`, planetoida Hidalgo z bazą piratów
   `hidalgo`, dok bez ciała — kryjówka, stacja gracza — `dock:<n>`) — rekord dodatkowy `warpLensExtraBody(klucz)`
   + `setWarpLensExtra(…)` co klatkę, także poza skokiem. Rekord idzie w tym samym przebiegu `WarpWorldLens.update` co
   ciała (tryby przejścia, front wyjścia, stożek za celem, kropki), z jedną klatką zwłoki położenia; kotwica pod kluczem
   rekordu. Olbrzym nie ma bryły w soczewce — elipsa `smudge` w partii kropek (impostor bez SDF), prawdziwy widok
   schowany od progu 0,02. Kometa: arkusz i jądro × k z ≤ −400. Hidalgo, osada z windą i bryła bazy: macierz soczewki
   wokół środka skały; kawałki bazy w bańce gracza i światła masztów gasną na czas soczewki. Obiekt znikający na stałe
   zwalnia rekord (`dropWarpLensExtra` — rejestry nie rosną przy długiej sesji).
3. **PUNKTY — floty, NPC, wraki (gorące i zimne)** — kropki. Strona gry raz na klatkę renderu (`prepareWarpLensDots`,
   `stampWarpLensDots` w `index.html`) stawia `__lensDot`, gdy udział soczewki PUNKTU ≥ `WARP_LENS_DOT_SWAP` (0,02):
   `warpLensDotFor` → `warpLensPointBeta` (`src/render/warpLensPhase.js`, jednostki świata — ta sama funkcja daje
   `out.beta` w `mapPoint` renderu, więc decyzja i obraz się nie rozjeżdżają między px CSS a px bufora). Encja z kropką
   jest ukryta jak we mgle (predykat ukrycia kadłubów, `fogSeenInto`, migawka: `FOG_HIDDEN` + `ENT_FLAG.LENS_DOT`) —
   skóra, dysze, lampy, wieże, mostki, modele 3D, tarcze, rdzenie, nakładki 2D. Kropkę rysuje `HexBodyLensBatch`
   (`hexBodyImpostorBatch.js`: ten sam materiał co smugi dalekich wraków, jeden rysunek, z = −640 pod kadłubami) na
   pozycji `WARP_LENS_SHARED.mapPoint(x, y, out, r)`: kadłub × skala obrazu, najmniej ~2 px widocznej plamki, barwa =
   średnia sprite'a, krycie × `out.alpha` × widoczność maskowania. Mgła wojny wygrywa (ukryta encja nie ma kropki),
   gracz i drugi gracz zawsze normalnie. Zimne wraki decyduje render (`pushColdWreckLensDots`: smuga z migawki), ich
   dodatki (mostki, modele, rdzenie) chowa ta sama decyzja per wrak (`withColdNearWrecks` → pakowanie pomija je
   w `COLD_NEAR`). Statki ruchu v2 (proxy bańki) od progu kropki wypadają z listy obrazu (`lensHideTrafficProxies`),
   kropek nie mają.
   - W WYJŚCIU punkt wraca na prawdziwe miejsce w 0,3 s (`submerge`) od chwili, gdy front smug gwiazd minie jego
     PRAWDZIWE miejsce (`warpExitFrontCross` — odwrotność frontu, bez stanu). Prawdziwe miejsce w kadrze — kropka
     dojeżdża widoczna (67 / 39 / 60 px/klatkę przy zoomie 0,12 / 0,04 / 0,3) i oddaje miejsce skórze; poza kadrem
     (brzeg kadłuba dalej niż `pointEdgeSoft` 96 px) — stoi w obrazie soczewki, póki gaśnie, potem jedzie niewidoczna.

**Warstwy (E3):** nic z soczewki nie rysuje się na statku. Bryły w perspektywie (stacje, doki, Hidalgo i baza, ring)
w skoku przechodzą do passa TŁA (warstwa 1 — ta sama kamera perspektywy co FG, rysowany przed passem gry; rzut się nie
zmienia, więc wysokie części nie skaczą), płaskie (komety, kropki) leżą na z ≤ `WARP_LENS_UNDER_Z` (−400) w passie gry.
Po skoku wracają na FG.

**HUD (E4):** znaczniki świata na kanwie (kontakty, podpisy planet, nakładki NPC, rozkazy, cele fabuły, HUD mgły) gasną
z alfą 1 − `warpLensHudBeta` (`_hudLensAlpha` w `index.html`), przy alfie ≤ 0,01 nie rysują się wcale; rysunki
z absolutną alfą (liny holownicze, zaznaczenie z paskami życia, ikony infrastruktury) są chowane od progu kropki
(`warpLensHudWorld()`). HUD kursu warpa zostaje — namiar w mapie C jest prawdziwy.

Gdzie co jest: reguła `warp` („REJESTR KOTWIC SOCZEWKI”) i reguły obszarów `stacje`, `doki-portow`, `komety`,
`pas-asteroid`, `baza-piratow`, `kadluby-belki` (floty, NPC, wraki), `radar-cic` (znaczniki). Test:
`tests/warpLensAnchors.test.mjs` (punkty, doki, zwalnianie rekordów, start z doku Ceres), przypadek migawki
w `tests/snapshotPack.test.mjs`.

## Symulator i weryfikacja

`node scripts/webgpu/warp-soczewka-sym.mjs` — symulator dowodowy bez przeglądarki: prawdziwe moduły gry i renderu
w Node (fizyka skoku, rampa, ślizg, kamera gry z K1, oś β jak w grze, `WarpWorldLens` na rekordach jak
`planet3d.assets.js`), krok 60 Hz. Scenariusze: S1 Ziemia → Jowisz z Marsem w trawersie, S2 Ziemia → Mars,
S3 punkt w próżni obok Jowisza (TRAVEL TO do punktu, kadr przylotu K1 punktu — dawniej swobodny skok bez przylotu), S4 Jowisz → Saturn (cel na tle), S5 przerwane ładowanie, S6 Ziemia → Mars z Jowiszem
w stożku za celem, S7 start z portu Ceres (ciało startu z dokiem w kadrze — mapa O1: wylot dołem i znika, kontrola C8),
S8 przylot do Io tuż po minięciu Jowisza (duża tarcza pod statkiem w chwili wyjścia — czas zanurzenia, P4 wyjścia),
S9 skok awaryjny 400 tys. j. z Jowiszem w połowie (najczęstszy skok z klawisza; u zespołu T — S7), S10 przelot centralny
Wenus → Saturn nad Ziemią i Jowiszem (`--s10-kurs <°>`, domyślnie 114°), S11 przelot nad ringiem Jowisza obok tarczy
(etap „studnie” — § „Studnie grawitacyjne — soczewka”). S7 od etapu „studnie” startuje z doku LUNY (księżyc bez studni);
dawny dok Ceres (1,7 r) leży dziś w studni Ceres (16,5 tys. j.), start tam jest zablokowany — `--s7 ceres` (mechanizm
kieszeni). S1: Mars 75 tys. j. z boku jest poza swoją studnią (47 tys.) — trasa i dawniej szła prosto; „prosto zamiast
objazdu” pokazują S10 i S11. Kontrole od etapu „studnie”: P4 dużej tarczy ze środkiem poza kadrem — ruch WIDOCZNEJ części
(punkty powierzchni i brzeg kuli / ringu w kadrze; „id*” w raporcie), C3 bez ciał przy punkcie zbiegu (wyjątek W0), C4
informacyjnie (tarcza przelotu pod statkiem), C9 — przelot nad ciałem (S10 / S11 / S12: nad ciałem tylko w pełnej
soczewce, księżyc nie w kuli rodzica), mignięcie bez końca ciągłego kurczenia / rośnięcia, `--zasieg` (A/B pasa
zwolnienia). Po recenzji etapu „studnie”: S12 — odlot z portu nad Ziemią z końca odcinka wyjścia (`--s12-za` j. za brzegiem
studni, domyślnie wellExit − 0,6 · arriveRadius = 3080; `--s12-kurs`, `--s12-bok`), w domyślnej liście; S13 — wyjście nad
tarczą Jowisza albo tuż za nią (`--scen S13 --s13-za`, `--s13-bok`) — otwarte (W1), poza domyślną listą.
Opcje: `--scen S1,S4`, `--res 1080,1440`, `--B1 87464`, `--naped mk1|mk2|mk3` (skala mapy z napędu — k_v),
`--aspect 16:9|21:9|32:9|W:H` (W = H · proporcje; P4 i W0 względem wysokości kadru), `--param klucz=liczba,…` (A/B
`WORLD_LENS_DEFAULTS`, np. `aspectFlow=1`, `aspectMax=0`, `speedRef=0`), `--tory gl|wszystkie|nie`, `--md plik.md`,
`--json plik.json` (klatki z a, l, kątem przelotu, kotwicą — do rysunków torów), `--origin-ruch` (A/B planety startu
„ruchem”). Kod wyjścia ≠ 0, gdy kontrola nie przejdzie (progi P4: ruch środka ≤ 60 px/klatkę, promień ≤ 50 px/klatkę,
0 mignięć — mała tarcza przejeżdżająca krawędź kadru ruchem ciągłym to nie mignięcie, o ile krok wyjazdu ≤ progu P4:
P4 liczy tylko klatki z ciałem w kadrze w obu, więc krok przez krawędź sprawdza ta heurystyka; kryteria C2–C5 — C2 mierzy
promień przy a = 0, próg × k_v; stożek C6; start C8). C1 (widać świat) —
informacyjnie (mapa O1 świadomie chowa ciała za płaszczyzną kamery). Wiersz W0 — tempo obrazu ciał w locie (p10 /
mediana / p90 / max, daleko ≥ 1,5 mln j.).

Wyniki etapu 2 (1080p): Mars w trawersie 263 px, cel rośnie przy wyjściu × 3,97, puszczenie celu przez zbieżność kamery
(1,0 px/klatkę), Saturn jako cel na tle × 3,82, największy skok w wyjściu 38,9 px/klatkę, najmniejszy odstęp tarczy od
kadłuba 87 px, 0 mignięć. W grze (worker, Ziemia → Mars): 0 klatek z NaN, 0 pipeline'ów synchronicznych, cel w kadrze
w każdej klatce od pierwszego pojawienia.

Wyniki etapu 3 (kontrola całości, 2026-10-26): symulator bez zmian względem etapu 2 (te same liczby). W grze (worker,
`warp-ped-gra`, dwa przebiegi z losową trasą do Marsa — przelot obok Jowisza, potem obok Merkurego): 0 klatek z NaN,
0 błędów strony (poza 404 favicon) i workera, cel w kadrze w każdej klatce od pierwszego pojawienia, komety w kadrze
soczewki. Pierwszy przebieg złapał 1 pipeline synchroniczny `CometNucleus_hale-bopp` — w workerze komety nie miały
wpisu rozgrzewki (luka sprzed etapu, odsłonięta, bo kometa wjeżdża teraz w kadr skoku z daleka); po dopisaniu wpisu
w `setComets` (`render.worker.js`) drugi przebieg — 0 pipeline'ów synchronicznych z kometami w kadrze.

Testy: `warpWorldLens`, `warpLensMapC`, `warpLensPrzejscia`, `warpWorkerMirror`, `warpNurt`, `cameraRig`,
`hypercruiseLook` (odcisk O3 — hipercruise bez zmian). W grze: `node scripts/webgpu/warp-ped-gra.mjs
[--query renderWorker=1]` (losuje trasę; w trybie worker mierzy tylko cel). Demo: `/dema/warp-ped.html`
(te same moduły; `scripts/webgpu/warp-ped-demo.mjs [--osrodek 0,1]`).

## Decyzje podjęte przez orkiestratora za użytkownika

Użytkownik nie był pytany w trakcie (DECYZJE.md, 2026-10-25) — każdą z tych rzeczy da się cofnąć:

1. **Ośrodek drobin w warpie gracza wyłączony** (O1) — A/B `?warpOsrodek=1`.
2. **Jeden styl skoku** (S1) — style rulon / akcent / soczewka usunięte; hak rulonu w materiałach zostaje do decyzji C2.
3. **Atlas mały przy przylocie** — kadr przylotu odsuwa kamerę, aż brzeg celu zmieści się w kadrze; podłoga zoomu
   0,07 · zoomRef schodzi poniżej limitu kadłuba (przy Marsie ~0,019 przy 1080p — Atlas ~30 px).
4. **Planeta startu bez ruchu** (`originMove: false`) — ciało startu przechodzi w soczewkę regułą ogólną (wynurzenie
   w miejscu), nie „ruchem” rodziny q_β: przy ruchu Ziemia skakała 100 px/klatkę w ładowaniu (ponad próg P4). A/B:
   symulator `--origin-ruch`.
5. **Luna (i księżyce Jowisza) nieruchome w węźle gry** (W2) — faza Luny nie jest już losowa (`Math.random` w module
   renderu łamało zasadę 9); obraz = pozycja węzła gry, tak samo w obu trybach. Wyjątek: Io (obraz 86 tys. j., węzeł
   60 tys.).
6. **B = 45 tys. j.** (DECYZJE: 40 tys.) — środek przedziału, w którym przechodzą kontrole symulatora. Nieaktualne od
   2026-10-26: mapa C zastąpiona mapą O1 (decyzja użytkownika, § „Mapa O1”).
7. **Hipercruise kolejnego odcinka TRAVEL TO czeka na koniec kadru przylotu** (dodatek do K1) — inaczej zoom skakał
   0,035 → 0,16 w kilku klatkach.
8. **Porty bez ringu** (Luna, Ceres, Westa, Wenus): ciało startu jest w soczewce od ładowania (M6), bramka zostaje tylko
   dla ringu „Halo”.

## Do sprawdzenia w grze (jutro, użytkownik)

Tryb domyślny (worker); wybrane trasy powtórzyć z `?renderWorker=0`.

1. **Ziemia → Jowisz (TRAVEL TO)**, najlepiej z Marsem blisko kursu.
   - Ładowanie: świat „wstaje” — Ziemia odpływa pod rufę i maleje, dalsze planety pojawiają się jako kropki, bez
     przeskoku przez kadr.
   - Kop: smugi gwiazd strzelają bez cofnięcia w pierwszej klatce, statek wyrywa się do przodu.
   - Lot: Jowisz to kropka w punkcie zbiegu nad dziobem i POWOLI rośnie; Mars jedzie po PROSTEJ od punktu zbiegu,
     w trawersie duży (kilkaset px), dalej rośnie i wylatuje bokiem kadru (mapa O1 — bez zakrętu i bez powrotu pod
     statek; obrót przelotu słabszy — 0,5); słońce widoczne jako jasna kropka; nic nie zachodzi na kadłub.
   - Wyjście: rzeczywistość prostuje się przed dziobem (front smug), ciała zanurzają się z frontem, bez „trzasku”.
   - Przylot: Jowisz rośnie RAZEM z hamowaniem, przejście w prawdziwy obraz bez skoku i bez mignięcia; ring Jowisza
     jedzie z planetą i nie rysuje się na statku; jeden błysk + fala (bez drugiego „wybuchu”); Atlas mały w kadrze
     przylotu; ślizg z pędem, potem kamera wraca do zoomu gracza (2 s).
2. **Ziemia → Mars (krótki skok)**: cel od kropki do kadru przylotu bez skoku; Luna przy starcie nie skacze.
3. **Jowisz → Saturn**: cel NA TLE (planeta pod płaszczyzną gry) — rośnie i puszcza bez zmalenia po przylocie;
   pierścień Saturna.
4. **CapsLock bez kursu** (warp zawsze do celu, § niżej): dziób na planetę / stację w ±20° — skok do niej (komunikat
   „WARP: CEL PRZED DZIOBEM — …”); dziób w pustkę — skok awaryjny 400 km w dziób („WARP: SKOK AWARYJNY 400 KM”),
   wyjście samo przy punkcie, bez wysunięcia statku; dziób na studnię tuż przed statkiem — odmowa z komunikatem.
   Planeta 25–35° od dzioba z dużą studnią w stożku: dziób skręca w ŁADOWANIU najwyżej ~20°, w skoku bez skrętu.
   Kurs TRAVEL TO 8–20° od dzioba i inna planeta na dziobie: skok idzie kursem. Z portu K-7 przy ringu dziobem
   w pustkę: pełny skok bez hamowania po kilku km; dziobem na planetę — odmowa. Skok awaryjny obok Jowisza: Jowisz
   mijany duży, przy wyjściu zanurza się płynnie (S9 symulatora).
5. **Przerwane ładowanie** (CapsLock dwa razy): świat opada w ~0,3 s bez przeskoku.
6. **Start z portu bez ringu** (Luna, Ceres, Westa, Wenus): ciało startu jedzie w soczewce od ładowania. Patrz:
   dok i stacja jadą z ciałem (maleją i odpływają pod rufę), leżą POD statkiem (pass tła), bez skoku wysokich części
   bryły przy przełączeniu warstwy; statki ruchu v2 zacumowane przy doku znikają z obrazu (nie zostają w powietrzu);
   ciało startu może wjechać w kadr szybko (ruch wymuszony dokiem — znane, test D8).
7. **Hipercruise** (krótki odcinek TRAVEL TO, < 40 tys. j.): wygląd jak przed zmianą (smugi, fale, żar, bez soczewki);
   kamera po przylocie przechodzi w hipercruise kolejnego odcinka bez skoku zoomu.
8. **Przylot NPC** (wezwanie wsparcia, piraci): nić zwiastuna, błysk, fala — jak dawniej (usunięte szczeliny nie były
   używane).
9. **HUD**: znaczniki kontaktów i podpisy planet gasną w skoku i wracają frontem przy wyjściu (3A); HUD kursu warpa
   zostaje.
10. **A/B ośrodka**: ta sama trasa z `?warpOsrodek=1` — dawny ośrodek drobin w skoku; porównać czytelność i płynność.
11. **Skok przy flocie** (własne skrzydło albo NPC obok statku, potem przylot do miejsca z flotą — np. scena „Wojna”
    albo wezwanie wsparcia przed skokiem): na początku ładowania okręty zamieniają się w kropki (próg 0,02 — skóra →
    płaska elipsa bez przenikania; oceń, czy razi), kropki jadą z soczewką pod statkiem; przy wyjściu kropki z miejscem
    w kadrze dojeżdżają na nie i oddają miejsce skórze, kropki z miejscem poza kadrem gasną w miejscu (bez przelotu przez
    kadr). Wróg z maskowaniem nie świeci kropką.
12. **Pole wraków / zimne wraki** (po bitwie, skok z pola): wraki jako smugi w soczewce, po skoku skóra i mostki
    wracają bez mignięcia.
13. **Przelot obok Ceres i pasa** (TRAVEL TO przez pas): stolica Unii przy Ceres (~14 px) jedzie z obrazem Ceres;
    olbrzymy pasa jako elipsy, bez podwójnego obrazu w ładowaniu; komety (arkusz i jądro razem, w soczewce mniejsze
    i ciemniejsze); misja 1 / Hidalgo — skała, osada i baza jadą razem (kawałki bazy w bańce i światła masztów gasną na
    czas skoku).
14. **Port K-7 z ringiem** (Ziemia / Mars): ring zostaje prawdziwy, póki jest w kadrze, a NPC przy nim robią się
    kropkami i odpływają mapą punktu (znane — D3); oceń, czy widać rozjazd.
15. **HUD w skoku**: liny holownicze, zaznaczenie z paskami życia i ikony infrastruktury znikają od początku ładowania
    i wracają po wyjściu; znaczniki kontaktów gasną płynnie.
16. **Wydajność** (PerfHUD `P`): liczba rysunków w skoku z dokiem startu i stacją Ceres w kadrze, brak przycięć przy
    przejściu stacji i doków na pass tła (pipeline'y synchroniczne — narzędzie `warp-ped-gra` niżej).
17. **Studnie — start** (etap „studnie”): CapsLock przed bramą K-7 — odmowa „ODLEĆ OD: ZIEMIA · n KM DO BRZEGU”, kurs
    TRAVEL TO nie znika; TRAVEL TO z bramy (misja 1) — wylot hipercruise'em ~10 km osią hali (HUD „STUDNIA GRAWITACJI ·
    WYLEĆ NAPĘDEM”), potem jeden skok. TRAVEL TO ze stanowiska w hali (gra swobodna) — obrót w hali i wylot pasem
    stanowiska przez bramę (bez ścian). Cel za Ziemią — wylot promieniowy, skok nad Ziemią (tarcza pod statkiem od początku
    — ring poza kadrem skoku).
18. **Studnie — przelot**: skok przez studnię Marsa / Jowisza (TRAVEL TO, cel za planetą): bez hamowania, zwolnienie nad
    tarczą (× 0,15 — Mk II ~28 tys. j/s nad Jowiszem), na brzegu studni Ziemi / Marsa / Jowisza skok przyhamowuje
    (strefa × 0,3 wchodzi skokowo: przelot ~0,46 → 0,15, wygładzone gonieniem prędkości 6/s) — oceń, czy szarpie.
    Słońce i baza piratów (misja z najemnikami) — hamowanie jak dawniej; zasadzka misji 2 — przechwyt jak dawniej.
19. **Ręczne wyjście nad planetą** (ucieczka w skoku nad Ziemią / Jowiszem): rampa i ślizg kończą się nad tarczą albo
    przy ringu (ślizg staje przed płytą — `playerWarpObstacleAhead`; rampa jest duchem) — oceń, czy statek nie zostaje
    w płycie ringu. Obraz: tarcza przechodzi z soczewki w prawdziwą (×13–19) w oknie wyjścia ~1 s — szybciej niż P4
    (otwarte, W1); oceń. Wnętrze ringu: CapsLock / TRAVEL TO skaczą od razu (wyjątek startu).
20. **Studnie — tarcza pod statkiem** (TRAVEL TO przez Jowisza / Ziemię, cel za planetą — np. Mars → Saturn): planeta
    z punktu zbiegu rośnie, wjeżdża POD statek (ogromna tarcza — Jowisz ~420 px promienia przy 1080p, Mk III ~300 px),
    nad nią nie rośnie i jedzie wolno pod kadłubem (wolniej niż gwiazdy), ring pod statkiem razem z nią, potem wylatuje
    dołem kadru. Bez rozdmuchania tarczy na cały ekran, bez zwijania ringu u dołu kadru, kadłub zawsze nad tarczą (pass
    planet przed passem gry). Obrót przelotu przechodzi przez zero nad środkiem — tarcza „toczy się” pod statkiem; oceń.
    Księżyce Jowisza / Luna przy podejściu jadą skalą obrazu planety (poza jej kulą, układ jak w rzeczywistości), za
    planetą płynnie przechodzą na własną mapę — oceń przejście. Ten sam przelot w workerze i `?renderWorker=0` (bez nowego
    pola migawki).
21. **Start z planety na osi kursu za rufą** (TRAVEL TO z K-7 w stronę od Ziemi): po wylocie ze studni Ziemia z ringiem
    widoczna u dołu kadru (dawniej za płaszczyzną kamery — niewidoczna), w ładowaniu wynurza się w miejscu, w kopie wylatuje
    dołem. Oceń, czy to lepsze niż dawne zniknięcie.
22. **Przelot przez układ księżyców** (cel za Jowiszem albo Ziemią): pas zwolnienia sięga układu księżyców, a księżyce
    z bryłą same zwalniają skok — księżyce mijane bez „świstu” przez kadr; oceń, czy przelot nie dłuży się (plan nadrabia
    prędkością gdzie indziej). Odlot z K-7 obok Luny — Luna nie przelatuje kadru.
23. **Przelot nad planetą bez komunikatów stref** (skok i hipercruise): bez „APPROACH VECTOR” i wpisów stref planety
    w dzienniku; słońce i pas — jak dawniej.

## Otwarte sprawy

- **Studnie — do decyzji / oceny w grze (2026-10-27, po recenzji):**
  - W1 — WYJŚCIE NAD TARCZĄ albo tuż za nią (S13: `--scen S13 --s13-za 5000 | 0 | -30000 | -66000`): tarcza pod statkiem
    przechodzi z soczewki w prawdziwy obraz (Jowisz 421 → 5600–8000 px — kamera w wyjściu już wraca do zoomu gracza)
    w oknie wyjścia osi β (~1 s): widoczna część jedzie 71–85 px/kl. przy Mk II 1080p (P4 60; 1440p 95–113 / 80), przy
    stopie nad środkiem promień 120 px/kl. Od ~20 tys. j. za studnią w P4. To przeskalowanie wokół kotwicy (×13–19), nie
    przesunięcie; dolna granica czasu przy stałym tempie skali to ~0,9 s (narożnik kadru · ln skali / P4), a krzywa
    zanurzenia i zoom kamery w wyjściu dokładają swoje — prawie liniowe zanurzenie dało tylko 72,7 → 71,1. Do decyzji:
    dłuższe okno wyjścia soczewki dla dużej tarczy pod statkiem (oś β gry — `warpLensPhase.js`, zmiana frontu smug),
    wstrzymanie powrotu zoomu kamery do końca zanurzenia, albo zasada rozgrywki „wyjście nad planetą odroczone za jej
    studnię” (jak blokada startu).
  - Mk III: S11 — Kallisto 61,8 / 82,4 px/kl. (P4 60 / 80; mała, 86,7 tys. j. z boku, mijana przy wylocie z pasa
    zwolnienia Jowisza 188 tys. j/s) — tarcza za małą na zwolnienie księżyca (r / odstęp 0,03 < `minSize` 0,05); szerszy
    pas układu księżyców (zapas 30 tys. j.) — 61,0. Ta sama klasa co „Mk III: P4 > 60” mapy O1. Warianty spoza domyślnej
    listy: S10 `--s10-kurs 0` przy Mk II — Kallisto 66 px/kl.; S12 `--s12-kurs 60` — Luna 63 px/kl. (księżyc z boku,
    statek już przyspiesza).
  - Wnętrze ringu — start skoku wolno (wyjątek) zamiast odcinka do tranzytu (rozgrywka ust. 2) — do decyzji użytkownika.
  - Planeta startu na osi kursu za rufą z cięciwą (widoczna u dołu kadru — D1, zmiana O1-2 zespołu B) — do zatwierdzenia.
  - Doki portu planety startu w soczewce (D4): gdy kurs przelatuje nad planetą startu (`originBody` null),
    `addWarpLensPortDocks` nie dokłada jej doków — mijane porty dochodzą dopiero w 90 tys. j. od kamery; do obejrzenia.
  - Punkty a cięciwa (D6): NPC i wraki (`mapPoint`) liczą się skalą środka, przelatywana planeta i jej ring — skalą
    cięciwy; kropki przy ringu / porcie przelatywanej planety nie leżą na obrazie ringu.
  - Mk III: S5 (przerwane ładowanie) i S8 (wyjście) — koniec ciągłego zanurzenia w miejscu (12,8 → 3,5 → 0,1 px) kontrola
    mignięć liczy dziś jako ciągły (§ „Studnie grawitacyjne — poprawki po recenzji”); oceń w grze, czy ostatni krok razi.
  - Zapas P4 przy Mk II: S8 wyjście — brzeg tarczy Jowisza z ringiem 59,9 px/kl. (miara widocznej części; dawna miara
    środka i promienia — 14,8 / 39,9), S10 kop przy 1440p — 74 / 80 (planeta startu Wenus wylatuje dołem przy rozpędzie;
    plan przelotowy wyższy przez pas układu księżyców).
  - Księżyc na tarczy z RINGIEM rodzica w obrazie (informacyjnie w C9; w kuli rodzica — kontrola, 0 s): przy skali obrazu
    rodzica księżyc leży tam, gdzie naprawdę względem planety.

- **Ręczne wyjście daleko od celu**: kamera kadruje punkt zatrzymania (`warp.route.arrive` 'point'), a soczewka trzyma
  cel przy krawędzi do zatrzymania + `arrivalStopGrace` i puszcza w 0,6 s (`_arrivalHold` czyta `warp.targetBody`).
  Pole `route.arrive` jest w migawce — pominięcie trzymania przy 'point' to zmiana soczewki (+ scenariusz symulatora).
- **„Nowa gra = nowe ziarno”** (DECYZJE-2 T3) nie zachodzi: ziarno ustala się przy starcie strony, a „Nowa gra” jej nie
  przeładowuje. Do decyzji: przeładowanie strony z nowym ziarnem przy „Nowej grze” albo planety stałe na profil.
- **Narzędzia w grze** (`zrzuty.mjs`, `silniki.mjs`, `tsl-uuid-gra.mjs`, `tunelowanie-gra.mjs`) ustawiają ładowanie
  wprost — skok dostaje koniec z planu awaryjnego (~7 s, 60–90 tys. j/s zamiast prędkości napędu): bazy zrzutów warpa
  trzeba odświeżyć, a pomiar tunelowania ocenić na nowo.
- **Io**: obraz na 86 tys. j., węzeł gry i port ruchu v2 na 60 tys. (węzeł leży pod ringiem Jowisza).
- **Przekazanie kamery hipercruise'owi po przylocie**: po powrocie kadru przylotu hipercruise od razu oddala kadr
  (0,178 → 0,098 w ~0,5 s), a soczewka zeruje się przy hipercruisie odcinka od razu — warto przekazać kamerę wprost.
- **Koszt `?warpOsrodek=1`** i koszt klatki w kadrze przylotu (podłoga 0,07 · zoomRef, Mars z halami K-7 i ruchem v2)
  — niezmierzone (`scripts/webgpu/koszt-klatki.mjs`).
- **Hak rulonu (C2)**: zostaje w etapie wierzchołków każdego materiału; usunięcie = przebudowa WGSL wszystkich
  materiałów (lista w `.claude/rules/warp.md`, „HAK RULONU”; projekt D § 6). Razem z nim: bloki szczelin w ośrodku
  i mgławicy, martwe uniformy gwiazd (`warpFactor`, `moveDir`, `exitWhip*`) i mgławicy, opcjonalnie `DISTORT.BUBBLE`.
- Martwe pola gry w `index.html` (`warp.gear`, `lastDir`, `warpBrakeTimer`, `turnRate`, `orientTolerance`) i słowo
  migawki `WARP_GEAR` — do usunięcia przy najbliższej zmianie tych plików. Tamże resztki stylu rulonu w kamerze
  (`updateCameraWarpKick`): pole wejścia `rulon` (`_cameraWarpInput`, start `rulon: true`), zapis
  `w.rulon = … warpRulonEnabled(location.search)` (zawsze false — rig pole ignoruje), import `warpRulonEnabled`
  i nieaktualny komentarz „`?warp=akcent|soczewka`; rulon tylko z `?warp=rulon`”. Usuwając je, usuń też import
  i atrapę `warpRulonEnabled` w `tests/cameraRig.test.mjs`; API zgodne w `warpDrive.js` może wtedy zniknąć.
- Wstrząs zwracany przez `warpArrivalFxState` / `warpDepartureFxState` (`arrivals.js`) jest nieczytany (wstrząsy
  przylotów zgłasza gra) — notatka `AGENT:` w pliku, usunąć przy C2.
- `scripts/webgpu/warp-ped-gra.mjs` losuje trasę w każdym przebiegu i w trybie worker nie mierzy mijanego ciała.
- **Reszta świata (3A) — do oceny w grze:**
  - Zamiana skóra → kropka przy udziale 0,02 bez przenikania: przenikanie wymaga alfy per obiekt w grafie partii skór
    (dziś `lodOpacity: float(1)`), czyli zmiany WGSL kadłubów, i dałoby szwy nakładających się kafli węzłów.
  - Dwie mapy przy statku: punkty (NPC, wraki) nie znają bramki ringu ani trzymania celu — przy porcie K-7 z zamkniętą
    bramką ring stoi prawdziwy, a NPC odpływają mapą punktu; przy przylocie NPC portu celu wracają na prawdziwe miejsca,
    gdy cel jest jeszcze trzymany w soczewce; NPC przy doku jadą mapą punktu, a dok skalą ciała. Propozycja: render
    przypina punkty w zasięgu zakotwiczonego ciała (dok `keepR`, ring `rExt`, cel trzymany) do jego kotwicy
    (`lensAnchorPoint`); strona gry potrzebuje wtedy stanu bramki i trzymania celu do decyzji kropki.
  - Bazy piratów: odłamy kawałków straconych znikają na czas soczewki, kawałki ruszone wracają do statyki bez śladów
    ran (poprawka — macierz soczewki w `worldBodies3D`).
  - Testy stacji, komet, olbrzymów i Hidalgo to regexy na źródle (zachowanie sprawdzają testy punktów, doków,
    zwalniania rekordów, startu z doku i migawki).
  - Liczba rysunków brył GLB stacji w soczewce i koszt przełączenia stacji / doków na pass tła — niezmierzone.
  - Mijane porty dochodzą do listy obrazu dopiero w 90 tys. j. od kamery (mała budowla pojawia się przy przelocie
    blisko portu).
- Demo „Nurt” (`dema/warp-webgpu.html`) wycofane — ciała idą przez bezstanową mapę C bez trzymania celu.

## Słowniczek kodów decyzji

Kod, testy i reguły etapu powołują się na kody z dokumentu decyzji orkiestratora („DECYZJE”, 2026-10-25) i na
projekty panelu („projekt A–D § …”). Tych plików nie ma w repo — co weszło do kodu, opisuje ten dokument; kody:

| kod | znaczenie |
|---|---|
| M1, M2 | mapa C „perspektywa drogi” i jej parametry — od 2026-10-26 zastąpiona mapą O1 (§ „Mapa O1”) |
| DECYZJE-2 O1-1…O1-4 | mapa O1 „kamera pochylona” (homografia, kMax, ukrycie za płaszczyzną kamery, obrót przelotu 0,5, odwrotność HUD, planeta na kursie) — § „Mapa O1”; INNE niż O1 / O2 / O3 niżej (ośrodek, obraz, hipercruise) |
| M3 | kotwica P0 = nominalne miejsce statku w kadrze (sprężyna riga bez kopu i wysunięcia), tło × (flat / zoom)^(1−β); do workera skalarami migawki |
| M4 | ciała za celem w stożku ±30° zanurzają się (nie są wycinane na stałe) |
| M5 | każde ciało w soczewce: planety, księżyce, małe ciała, słońce (`sunBoost` 5, kropki ≥ 2 px, poniżej 1,5 px nie rysować) |
| M6 | planeta startu w soczewce („świat wstaje”); bramka ringu „Halo” zostaje |
| P1 | oś β z zegara gry: ładowanie 0,9 · smoothstep, kop 0,9 → 1, lot 1 — czysta funkcja, ta sama w off i w workerze |
| P2 | tryb przejścia ciała ustalany raz na przejście: RUCH albo WYNURZENIE / ZANURZENIE w miejscu |
| P3 | wyjście: ciała zanurzają się / wracają frontem smug gwiazd (od dziobu ku rufie) |
| P4 | progi ciągłości przy 60 Hz: środek ≤ 60 px/klatkę, promień ≤ 50 px/klatkę, 0 mignięć |
| T1 | cel w soczewce od kopu; skala = miękkie maksimum z podglądem kadru przylotu (ta sama funkcja co kamera) |
| T2 | trzymanie celu przy wyjściu do zbieżności kamery (albo zatrzymania + zapas), potem puszczenie 0,6 s; cięcie od razu |
| K1 | kadr przylotu: podłoga zoomu 0,07 · zoomRef tylko przy `warpArrOn`, bez wysunięcia statku przy wyjściu z celem, trzymanie do końca ślizgu + 1 s, powrót 2 s |
| O1 | ośrodek drobin i soczewka bańki w warpie gracza wyłączone, A/B `?warpOsrodek=1` |
| O2 | co zostaje z obrazu: smugi gwiazd (bez ząbka w klatce kopu), fale, błysk kopu, przylot jako jedno zdarzenie, wstrząsy z gry, żar, obrót kadru, kop kamery, smugi skał pasa |
| O3 | hipercruise bez zmian — odcisk w `tests/hypercruiseLook.test.mjs` |
| W1 | warp gracza w workerze: pełna rampa, ślizg, kurs, cel i start w migawce, wstrząsy z gry, plazma w workerze, test parzystości off ≡ worker |
| W2 | księżyce deterministyczne, w węzłach gry (bez `Math.random` w module renderu) |
| E1–E4 | reszta świata (etap 3A): rejestr kotwic soczewki, floty i wraki jako kropki, warstwy (nic z soczewki na statku), HUD gaszony z β |
| S1 | sprzątanie „jeden warp” (= krok C1). Uwaga: S1–S6 w symulatorze to SCENARIUSZE (§ „Symulator i weryfikacja”) |
| C1, C2 (sprzątanie) | projekt D § 6: C1 — bez zmiany WGSL materiałów gry (zrobione, § „Jeden warp”); C2 — hak rulonu i reszta, zmienia WGSL każdego materiału (osobna decyzja, § „Otwarte sprawy”) |
| C1–C6 (kryteria) | INNE znaczenie: kryteria oceny z briefu panelu — C1 widać świat, C2 dynamika wielkości (Mars w trawersie ≥ 250 px przy 1080p, dalekie ≤ ~20 px), C3 ruch bez parkowania, C4 tarcza nie zachodzi na kadłub, C5 ciągłość przejść, C6 rozszerzalność; w symulatorze wiersze `C1-…`–`C5-…`, a `C6-stożek` to kontrola M4 |
| projekt A–D | projekty panelu: A — kamera podniesiona z rybim okiem (nie wybrany), B — „kropla 2.0” (przejścia i cel: § 4.3, § 4.4), C — „perspektywa drogi” (mapa), D — oś faz, worker i sprzątanie (§ 2 oś czasu, § 4 worker, § 5 interfejs mapy, § 6 sprzątanie) |

## Historia (skrót)

- 2025-12 – 2026-01: stara soczewka WebGL (`warpBlackHole.js`); zasada „nigdy nie próbkować gotowej klatki z maską
  wokół statku” (jajko wokół kadłuba).
- 2026-09-25/26: „kropla” (świat ściśnięty wokół statku, wielkość ~1/d) — wtedy user: Ziemia za rufą „stoi w miejscu”,
  Jowisz i Mars „widoczne od razu”; wersja w prawdziwych odległościach — „podoba mi się”; siatka wyrzucona.
- 2026-09-27 – 10-03: warp „Nurt” (ośrodek drobin, kop, wyjście jak Star Wars, przyloty NPC tunelem), rulon (zwinięcie
  świata w walec, hak w każdym materiale) — `docs/webgpu/DEMO-WARP.md`.
- 2026-10-07 – 10-19: soczewka świata jednej skali S z nominalnej prędkości, cel przy krawędzi kadru, przelot z daleka
  z punktem zbiegu przed dziobem, bramka ringu, cel bez obrotu przelotu; 10-19 user: „przekombinowałem z zawijanym
  efektem warp” — demo „Pęd” i style skoku (`docs/webgpu/DEMO-WARP-PED.md`).
- 2026-10-23: „Pęd” w grze (styl domyślny, wyjście z pędem i ślizgiem, kamera skoku z obrotem kadru).
- 2026-10-25/26: „podniesiony świat” — mapa C, oś β z zegara gry, worker, K1, ośrodek wyłączony, jeden warp
  (ten dokument).
- 2026-10-26 (DECYZJE-2 po teście użytkownika): mapa O1 „kamera pochylona” zamiast mapy C — tor prosty, jeden punkt
  zbiegu, ciała za płaszczyzną kamery niewidoczne, obrót przelotu 0,5; symulator: S7 (start z portu Ceres), C1
  informacyjnie, W0, `--naped`. Porównanie torów C / O1: notatki sesji (poza repo). Projekty panelu A–D, sędziowie i DECYZJE zostały poza repo (notatki sesji orkiestratora) — kody
  w § „Słowniczek kodów decyzji”.
- 2026-10-26 (recenzja O1): skala w bok z kadru najwyżej 16:9 (dawniej z szerokości — 32:9 dwa razy szybciej, A ≈ 33 tys. j.),
  skala × 175 tys. / v przy napędzie szybszym niż Mk II, czas zanurzenia przy wyjściu z tempa obrazu (duża tarcza pod
  statkiem); symulator: S8, `--aspect`, `--param`, C2 przy a = 0; test W0 między warstwami
  (§ „Mapa O1 — proporcje kadru i napęd”).
- 2026-10-27 (etap „studnie”, zespół B): przelot nad ciałem w soczewce — cięciwa kursu (tarcza pod statkiem w skali s,
  wylot dołem w tempie homografii punktu wyjścia), kieszeń kadłuba tylko dla ciała blisko statku na starcie, pas zwolnienia
  z układem księżyców (0,9 × zasięg); symulator: S7 z doku Luny, S10, S11, P4 widocznej części dużej tarczy, C3 bez punktu
  zbiegu, C4 informacyjnie, C9 (§ „Studnie grawitacyjne — soczewka”).
