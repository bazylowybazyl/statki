# Audyt wybuchów i dymu WebGPU (gaz na siatce 3D) — 2026-10-08

Zakres: wybuchy gry `src/3d/explosions/` (reżyser `ExplosionFx`, receptury) na gazie `src/3d/gas/` (symulacja `gasGrid.js`,
obraz `gasVolume.js`, przepisy `gasExplosions.js`, żar i błyski `gasEmbers.js`), demo `dema/wybuchy-webgpu.html`, klej
dymu wraków `gasSmokeGame.js` (wypięty). Pytanie: jak zbliżyć obraz i fizykę do Niagara Fluids („Grid 3D Gas”) i jakie są braki.

Metoda: przegląd kodu (kernele, marsz, reżyser, integracja z `index.html`), zrzuty z 2026-10-07 (gra:
`.tmp/wybuchy-gra-final4`, `.tmp/wybuchy-gra-final`; demo: `.tmp/wybuchy-demo-final` — kod gazu od tego czasu bez zmian),
liczniki z `raport.json` scen gry, pomiar kosztu `.tmp/wybuchy-koszt-final`. Żadnych zmian w kodzie — sam audyt.

## 1. Werdykt w skrócie

1. **Rdzeń jest dobry.** Siatka Eulera z MacCormackiem, spalaniem, rozprężaniem, samocieniem i Kirchhoffem daje obraz, którego
   nie da się uzyskać cząstkami (kłęby, języki, dym z wnętrza). Architektura (atlas domen, dane w komórkach, krok w
   `Core3D.fx`, zero alokacji w klatce) jest zgodna z zasadami repo i nie wymaga przebudowy.
2. **Największy brak fizyki: gaz nie widzi świata.** `GasGrid.obstacle` nie jest wołane nigdzie w grze ani w demie — kula ognia i
   dym przechodzą przez trzon doku, ściany hali i kadłuby (zrzut `prog-0_9`: ogień „leży” na nabrzeżu i stanowiskach). W Niagarze to
   kolizje z polem odległości; tu jest API na kule, nieużywane.
3. **Największy brak obrazu: dym nie czyta siatki świateł.** `gasVolume.js` oświetla gaz słońcem, otoczeniem i własnym blaskiem
   domeny; błysk sąsiedniego wybuchu, inne domeny, dysze i lufy nic w nim nie robią (zrzut `lancuch-2_2`: szary dym obok trzech
   kul ognia). Dym rakiet i pył hal siatkę czytają — gaz wybuchów jako jedyny nie.
4. **Łańcuch doku nie scala się w jeden płyn.** W scenie `lancuch` `merged = 0`, `noSlot = 7`, 26 z 38 wybuchów poszło cząstkami
   (`raport.json`). Próg scalania w `_slotFor` to ±0,35 R od środka domeny — praktycznie nieosiągalny. Dokumentacja (AGENTS.md,
   PLAN § 12) opisuje zachowanie, którego w grze nie ma.
5. **Rozdzielczość jest wąskim gardłem „kalafiora”.** Kula ognia ma ~18 komórek promienia (96 komórek na 5,4 R); przy zoomie 0,3–0,4
   komórka to 8–10 px ekranu. Wszystko poniżej tego to szum i przesunięcie odczytu (`warpAmp`), nie symulacja — widać jako
   powtarzalną „łuskę” na kłębach (`pustka-0_9`). Niagara stawia 128–200 komórek na kulę.

## 2. Co jest dobre — nie ruszać

- Krok symulacji: wiry → adwekcja RK2 → MacCormack skalarów z obcięciem → spalanie → dywergencja z celem rozprężania → Jacobi →
  rzut; wszystko w jednym `renderer.compute(lista)`; podkroki ≤ 1/60 s. Układ komórek domeny (precyzja float32 przy 5–10 mln j.).
- Obraz: emisja całkowana po odcinku (bez słojów z góry), próg ciągły, pole pozycji spoczynkowych (detal jedzie z gazem),
  Kirchhoff (sadza świeci jak ciało czarne), faza HG + wielokrotne rozpraszanie, podział na warstwę za / przed płaszczyzną gry.
- Reżyser: kłęby z opóźnieniami, strumienie z otworów (`jet` — prośba użytkownika 2026-10-07), płonące odłamki ze smugą, wtórne,
  LOD gaz / cząstki / samo światło, nośnik prędkości, zegar `SimClock.sim`, rozgrzewka (0 pipeline'ów synchronicznych w scenach).
- Koszt (RTX 5080, 1600 × 900, łańcuch 13 wybuchów, 6 domen): +0,85 ms na klatkę, p95 +0,9 ms, CPU kroku ~0,08 ms.
- Narzędzia: harness gry i dema ze zrzutami na zatrzymanej klatce, A/B warstw tej samej klatki, `--ruch`, `--koszt`, sonda `probe`.

## 3. Braki — ranking

Wartość = ile zmienia w obrazie / fizyce; koszt = praca + ryzyko. Odnośniki do kodu: plik:linia stanu z 2026-10-08.

| # | Brak | Objaw na zrzutach | Gdzie w kodzie | Propozycja | Wartość / koszt |
|---|---|---|---|---|---|
| **F1** | Scalanie domen nie działa; łańcuch i wtórne lecą cząstkami | `lancuch`: `merged 0`, `noSlot 7`, 26/38 cząstkami; obok kul z gazu małe „kulki” rakietowe | `explosionFx.js:300` (`m = half·0,5 − R` → ±0,35 R) | Scalać, gdy kula MIEŚCI SIĘ w domenie: `m = half − R − 2h`; wtórne i wybuchy w promieniu domeny rodzica dziedziczą jej slot bez testu `gasMinPx` (domena już liczy się, cząstki tylko psują spójność); `slots` 6 → 8 i pomiar pamięci | wysoka / niski |
| **F2** | Gaz przenika budowle i kadłuby | `prog-0_9`: ogień na nabrzeżu, dym na trzonie; w demie strumienie przez kadłub okrętu | `GasGrid.obstacle` bez wywołań; `EXPLOSION_GRID.maxObstacles: 8` | Maska komórek stałych w domenie (R8 w atlasie): statyka (kawałki doku z `placeDryDock().ramShapes` / `hitShapes`, ściany K-7 z kolidera) rastrowana RAZ przy `acquire`, kadłuby — obrys `hullFootprint` z prędkością ciała + ω × r jak w pyle hal (`gasField2D.js`). W adwekcji komórka stała = prędkość ciała, w Jacobim Neumann (p sąsiada), w rzucie wymuszenie — wzór jest gotowy w `gasField2D.js` | **najwyższa** / średni (1–2 dni) |
| **F3** | Dym nie oświetlany siatką świateł | `lancuch-2_2`: szary dym obok kul ognia; błysk wybuchu nie rozświetla sąsiednich obłoków; dysze i lufy nie świecą w dymie | `gasVolume.js:218–220` (tylko słońce + otoczenie + `lgt.yzw` własnej domeny) | W `_march` co 3–4 próbki (albo na 3 wysokościach jak hala: `gasFieldLayer.js:141–154`) `grid.loop(P, …)` z kolanem `L / (1 + k·ΣL)`, dodane do `scat`; tylko gdy `sigma > próg`. Siatka ma już światło każdego wybuchu (`_lights`) — same wybuchy zaczną oświetlać swój i cudzy dym | **najwyższa** / niski (½ dnia + strojenie kolana) |
| **F4** | Adwekcja PRĘDKOŚCI 1. rzędu (semi-Lagrange RK2 bez korekcji) | wiry gasną w kilku krokach; kłęby „miękkie”, życie detalu < 1 s; kompensowane wzmacnianiem wirów 3,5 i turbulencją 35 (siła z szumu, nie dynamika) | `gasGrid.js:320` (`vel = at(velA, pb)`), MacCormack tylko dla skalarów (`:387`) | MacCormack / BFECC dla prędkości: ten sam schemat co skalary (próbka wstecz, do przodu, korekta ½, obcięcie do 8 sąsiadów) — +2 odczyty tekstury w `advectNode`. Potem obniżyć `vorticity` i `turbulence` (pomiar: energia kinetyczna i maks \|ω\| z `probe` po 1 s) | wysoka / niski |
| **F5** | Rozdzielczość kuli ognia | „łuska” szumu na kłębach przy zoomie ≥ 0,3; detal nie jedzie z gazem po ~0,7 s (`restRelax` 1,5/s) | `EXPLOSION_GRID` 96 × 96 × 36, `domainScale 5,4` (`explosionFx.js:55, 71`) | (a) tanio: `domainScale` 5,4 → 4,2 (+29% komórek na R; obłok i tak gaśnie zanim dojdzie do brzegu — sprawdzić `probe` maks dymu przy ścianie), (b) drugi atlas „fine” 128 × 128 × 48 na 2 sloty dla wybuchu z promieniem ≥ 60 px na ekranie (pamięć +140 MB — tylko na GPU dyskretnym, `GPU_REQUIRED_LIMITS` / rozmiar VRAM) | wysoka / średni (a: godzina, b: 1–2 dni) |
| **F6** | Ciśnienie: Jacobi 15 iteracji na 96 komórkach | niedobieżność po rzucie → rozprężanie spalania nie w pełni „wypchnięte”, kłęby lokalnie się ściskają; demo liczy 25 | `explosionFx.js:55` (`jacobi: 15`), `gasGrid.js:453` | (a) Gauss–Seidel czerwono-czarny (2 kernele po ½ komórek na iterację — ta sama praca, zbieżność ×2), (b) V-cycle 2-poziomowy (96 → 48 → 24, atlas mip) — Niagara liczy multigrid; sonda: dodać \|div\| po rzucie do `probeMax` i porównać 15 / 25 / RBGS / V-cycle | średnia / średni |
| **F7** | Brak kontrakcji przy stygnięciu | obłok tylko rośnie (`disperse`), nie „oddycha”; nie powstaje wałek toroidalny — w Niagarze zasysanie przy stygnięciu daje zawijanie kłębów | `gasGrid.js:447` (rhs = div − rozprężanie − disperse) | rhs += `contraction · max(0, −dT/dt)` (dT/dt z kroku stygnięcia w `reactNode`, zapisać w wolnym kanale `denC` — dziś `den.w` = tempo spalania; można nadpisać po spalaniu różnicą) — jedno mnożenie; A/B na zrzutach 0,7–2 s | średnia / niski |
| **F8** | Źródła NARZUCAJĄ prędkość przez cały czas życia | strumienie „pająka” to sztywne rury (`kino-0_7`), front kuli gładki w kapsule | `gasGrid.js:334` (`mix(vel, vTarget, velBlend·w·dt)` — przy 40/s i 1/60 s to 67% na krok), `gasExplosions.js:110, 185` | po `rampIn` przejść z narzucenia na siłę ∝ (vTarget − v) z `velBlend` malejącym do ~6/s — strumień zaczyna się rwać i kłębić własną dynamiką | średnia / niski |
| **F9** | Opór wszędzie zamiast gąbki na brzegu | w próżni opór nie istnieje; dziś hamuje też wiry w środku obłoku (`drag 0,2 + 0,03·\|v\|`) | `gasGrid.js:371`, `explosionFx.js:850–851` | opór = f(odległość od brzegu domeny): 0 w środku, rosnący w pasie `borderFade`; `dragQuad` zostaje dla frontu (> 40 kom./s). Wiry żyją dłużej bez zmiany, jak gaz wychodzi z kadru | średnia / niski |
| **F10** | Blask ognia zbierany tylko z 4,5 komórki | wnętrze obłoku prawie czarne tuż obok ognia (`pustka-1_6`) | `gasGrid.js:109` (`GLOW_RADII [2, 4,5]`, 28 próbek na komórkę) | blask z poziomu mip atlasu (1/4 rozdzielczości, promień 12–16 komórek za tę samą cenę) albo zastąpić przez F3 (siatka świateł ma światło wybuchu z zasięgiem R × 2–5) | średnia / niski |
| **F11** | Brak cienia dymu na kadłubach i pokładzie | pokład pod gęstym obłokiem oświetlony jak bez dymu (`prog-0_9`, `lancuch`) | maska słońca (`sunShadowMask.js`) zna kadłuby (SDF) i pole pasa, nie zna gazu | rysunek brył domen do maski słońca: 1 − T z `lightT.x` dolnej warstwy wzdłuż `sunDir` (R maski) — jeden dodatkowy rysunek na domenę w passie maski; A/B z `maska-slonca.mjs` | średnia / średni |
| **F12** | Ziarno startu marszu przyklejone do ekranu | drobna nieruchoma faktura na kłębach przy ruchu kamery (biały szum z haszu piksela bez czasu) | `gasVolume.js:105` | szum niebieski 64² (ta sama wariancja, mniej widoczny) + `jitter` 0,4 → 0,25 (emisja już całkowana po odcinku); bez TAA nie da się uśrednić | niska / niski |
| **F13** | Koszt marszu przy zbliżeniu niezmierzony | `--koszt` liczy łańcuch przy zoomie 0,085 (kula ~40 px); przy 0,4–0,8 kula zajmuje ¼–½ kadru, marsz w pełnej rozdzielczości na celu MSAA, 2 warstwy | `explosionFx.js:863–864` (`stepCells 0,8`, `maxSteps 80`) | zmierzyć `wybuchy-gra.mjs --koszt` przy zoomie 0,4 i 0,8; gdy > 2 ms: `stepCells` adaptacyjne z promienia na ekranie (0,8 → 1,4 przy kuli > 300 px) albo marsz do celu ½ rozdzielczości jak w demie (`gasSceneFx.js` — RTT + 4 próbki) | ryzyko / niski (pomiar) |
| **F14** | Trzy różne wybuchy okrętów | śmierć NPC z puli HP = `WeaponFx.droneBlast` (42 j. × 1,35 — mały błysk bez dymu, `index.html:21440`), detonacja rdzenia = `reactorBlast` (plazma + dym rakiet), dok / stacja / gracz = gaz | `index.html:21438–21444` | śmierć NPC bez rdzenia → `makeReactorBlow({ profile: escort / cruiser / capital, vx, vy })` (nośnik = prędkość wraku, `spawn` już go przyjmuje); `reactorBlast` mógłby dołożyć domenę gazu z `tint` barwy frakcji (kula plazmy → gaz). **Decyzja użytkownika** (dym wraków wypięty na jego prośbę — tu chodzi o sam wybuch) | wysoka / niski–średni |
| **F15** | Wygaszana domena „odżywa” skokiem | `_extendSlot` / scalenie ustawia `until` w przyszłość → `fade` z 0,5 wraca do 1 w jednej klatce (obłok nagle gęstnieje) | `gasGrid.js simulate` (fade = 1 w gałęzi `now ≤ until`), `explosionFx.js:304, 331` | `fade` tylko rośnie rampą (np. 2/s), `extraDecay` gaśnie tak samo | niska / niski |
| **F16** | Dwie siatki gazu po wpięciu dymu wraków | `gasSmokeGame.js` tworzy własny `GasGrid` (osobny atlas ~60 MB + osobna lista kerneli) | `gasSmokeGame.js:63` | wspólna siatka `ExplosionFx.grid` z priorytetami slotów (pole `priority` już jest) | średnia / niski (gdy dym wraków wróci) |
| **F17** | Pamięć: 11 atlasów × 96² × 36 × 6 × 8 B ≈ 175 MB od startu gry | na GPU zintegrowanych to połowa budżetu efektów; przez większość gry 0 domen | `gasGrid.js` konstruktor | alokacja atlasu przy pierwszym wybuchu (rozgrzewka kerneli zostaje — pusty dispatch nie potrzebuje pełnego atlasu, wystarczy 1 slot), `curl` liczony w locie w adwekcji (−1 tekstura), `S` z limitów adaptera | niska / niski |
| **F18** | Odłamki i iskry gry nie czują gazu | `WeaponFx` DEBRIS i `SparkSystem3D` lecą przez kłąb bez porwania; tylko żar `gasEmbers` czyta `velA` | `explosionFx.js _chunks / _sparks` | niski priorytet; ewentualnie DEBRIS z próbką `velA` jak żar (jeden odczyt tekstury w kernelu puli) | niska / średni |

## 4. Fizyka: porównanie z Niagara Fluids „Grid 3D Gas”

| Cecha Niagary | Tu | Ocena |
|---|---|---|
| Adwekcja semi-Lagrange + MacCormack (skalary i prędkość) | skalary tak (obcięcie do 8 sąsiadów); prędkość NIE (F4) | brak |
| Rzut ciśnienia: multigrid (albo Jacobi z wieloma iteracjami) | Jacobi 15 (gra) / 25 (demo), rozgrzanie 0,92, otwarte brzegi | słabo (F6) |
| Wzmacnianie wirów | tak (`fvc`, ε 3,5) | jest — za mocne, bo kompensuje F4 |
| Wypór z temperatury, ciężar dymu | tak; w próżni 0 (słusznie) + `radialLift` od środka wybuchu | jest |
| Turbulencja (curl noise) | siła z szumu 3D zakotwiczonego w siatce, rzutowana | jest, inny mechanizm — wystarcza |
| Spalanie: paliwo → ciepło, dym, rozprężanie (dywergencja) | tak, 1:1 (`expansion` ∝ tempo spalania) | jest |
| Stygnięcie, zanik gęstości | Newton + T⁴ + szybsze w rzadkim gazie; `smokeDecay`, `fuelDecay` | jest |
| Kontrakcja przy stygnięciu / cel dywergencji ujemny | nie (F7) | brak |
| Kolizje z polem odległości (statyka, dynamika z prędkością) | API kul (`obstacle`) — nieużywane w grze (F2) | **brak w grze** |
| Źródła: cząstki / kształty z prędkością | kapsuły z promieniem, brzeg szumem, prędkość promieniowa + kierunkowa, narzucenie (F8) | jest |
| Domena za obiektem (nośnik) | tak (`carrier`) | jest |
| Rzadkie bloki (sparse allocation, tylko aktywne kafle) | pełne domeny, atlas z listą aktywnych | inaczej, koszt OK przy 6 domenach |
| Rozdzielczość 128–256 na wybuch | 96 × 96 × 36 na 5,4 R (F5) | za nisko przy zbliżeniu |
| Pole pozycji spoczynkowych / detal sub-grid | tak (`rest`, warp polem wirowym, szum, erozja) | jest — zastępuje rozdzielczość |

## 5. Obraz: porównanie

| Cecha | Tu | Ocena |
|---|---|---|
| Marsz promienia z przesunięciem startu | biały szum z piksela (F12), `stepCells` 0,8, ≤ 80 kroków | jest |
| Emisja ciała czarnego, Kirchhoff, płomień frontu | tak | dobrze (lepiej niż typowy preset Niagary) |
| Samocień ku słońcu (objętość światła raz na klatkę) | 16 kroków × 2 komórki | jest |
| Światła sceny w gazie | brak (F3) | **brak** |
| Blask ognia w dymie | 14 kierunków × 2 promienie, zasięg 4,5 komórki (F10) | za krótki |
| Wielokrotne rozpraszanie | T^¼ · `multiScatter` | przybliżenie; wnętrze obłoku ciemne |
| Otoczenie | stała `ambient` (0,05–0,08) | brak strefy (`skyRegion`: przy planecie jaśniej) |
| Cień gazu na scenie | brak (F11) | brak |
| Głębia | podział po płaszczyźnie gry (z = 0), bez tekstury głębi | OK z góry; kamery 3D przybliżone |
| Maska cienia słońca gry (planeta) | tak (`sunVisibility` mnoży człon słońca) | jest |

## 6. Integracja z grą

- Wejścia gazu: `window.makeReactorBlow` z progów i łańcucha doku (`index.html:29186`, bez `vx / vy` — dok stoi, OK), rozpad stacji
  (`Destruction3D` → `reactorFactory`), śmierć gracza (`triggerReactorBlow3D`). Śmierć NPC — poza gazem (F14).
- `applyDamageToStation` → `Destruction3D` daje wybuchom łańcuchowym `size · 0,22` (profil `fighter`, `gas: false`) — przy zoomie
  0,12 to 9 px, więc cząstki z LOD; spójne, ale finał stacji (`stacja-1_2`) to jedna kula z gazu i kilka „kulek” rakietowych.
- Siatka świateł: jedno światło na wybuch (`_lights`, suma faz) — dobrze; po F3 te światła zrobią też obraz w dymie.
- Rozgrzewka: pełna (kernele, bryły obu warstw, kamera z góry i 3D) — harness potwierdza 0 pipeline'ów synchronicznych.
- Testy: 9 w `gasGrid.test.mjs`, 7 w `explosions.test.mjs`. Brak strażników na: scalanie domen w łańcuchu (F1 — test
  „12 wybuchów w promieniu domeny = 1 domena”), przeszkody w grze (F2), światła siatki w marszu (F3, WGSL z `grid.loop`).

## 7. Błędy i zapachy w kodzie

- `explosionFx.js:300` — próg scalania `half·0,5 − R` (patrz F1). W AGENTS.md § „Wybuchy WebGPU” zdanie „wybuch blisko młodej żywej
  domeny dokłada się do niej (łańcuch doku)” nie zgadza się z pomiarem (`merged 0`).
- `gasGrid.js simulate` — `fade` skacze do 1 przy przedłużeniu domeny w fazie wygaszania (F15).
- `gasVolume.js:228` — `Tprev` po pustej próbce = 0, więc pierwsza próbka ognia po przerwie jest uśredniana z 0 (ciemniejszy brzeg
  płomienia). Jeśli zamierzone — komentarz; jeśli nie — `Tprev = −1` (jak start).
- `explosionFx.js:55` — `maxObstacles: 8` to pozostałość po demie; przy F2 maska zastąpi kule, a limit zniknie.
- `gasExplosions.js` — `fire(…, { keep })` woła `grid.keepAlive`, `jet` i `puff` nie: domena może wygasnąć, gdy jeszcze bije strumień
  (`jet` do 1,5 s przy `domainLife` 3 s — dziś mieści się, ale przy innych liczbach nie).
- `gasEmbers.js` — `highWater` po zawinięciu pierścienia = `EMBER_CAP` (65 536) i krok liczy całą pulę aż do wygaśnięcia
  `maxLife + 0,5 s` od ostatniej emisji; łańcuch doku trzyma to przez ~8 s. Tanio (jeden kernel), ale `count` można zbić do
  najwyższego żywego indeksu z CPU (zlecenia mają znane życie).
- AGENTS.md § „Wybuchy WebGPU” nie wspomina, że przeszkody gazu w grze nie istnieją — następny agent może założyć, że dym opływa dok.

## 8. Proponowana kolejność

Każdy etap z pomiarem przed / po tym samym harnessem (`wybuchy-gra.mjs` sceny prog, lancuch, stacja, pustka + `--koszt`;
`wybuchy-demo.mjs --ruch` po zmianach adwekcji; `probe` na liczbach).

- **A. Spójność i tanie poprawki (1 dzień):** F1 (scalanie + wtórne dziedziczą slot), F15 (fade rampą), F4 (MacCormack prędkości
  → potem obniżyć `vorticity` / `turbulence` z pomiarem), F7 (kontrakcja — A/B), F8 (narzucenie → siła po rampie), F9 (gąbka).
  Oczekiwany efekt: łańcuch doku jako jeden obłok, kłęby żyją dłużej, strumienie się rwą.
- **B. Światło (1 dzień):** F3 (siatka świateł w marszu) + F10 (blask z mipa albo przez siatkę) + `ambient` ze strefy nieba.
  Oczekiwany efekt: błysk rozświetla dym, wybuchy obok siebie oświetlają się nawzajem — to jest „AAA” z Niagary.
- **C. Świat (1–2 dni):** F2 (maska komórek stałych: statyka doku + obrysy kadłubów z prędkością). Oczekiwany efekt: dym
  opływa trzon, wylewa się bramami i szczelinami, kadłub rozcina kłąb; wybuch przy ścianie hali bije w jedną stronę.
- **A2. Zbiornik paliwa (1 dzień, decyzja § 10 pkt 1):** dane `fuelTanks.js` + automat, zbiornik przy kadłubie, śmierć NPC i
  gracza bez rdzenia → wybuch z gazu z miejsca zbiornika z nośnikiem wraku; `reactorBlast` dokłada domenę gazu w barwie frakcji.
  Pomiar: bitwa 166 okrętów (`scripts/profil-bitwy-flot.mjs`) — koszt klatki przed / po, `noSlot` w bitwie.
- **D. Rozdzielczość i koszt (1–2 dni, po pomiarze F13):** F5a od razu (domainScale), F5b (atlas „fine” — pamięć zaakceptowana,
  § 10 pkt 4), F13 (adaptacyjny krok / ½ rozdzielczości), F17 (alokacja leniwa).
- **E. Później:** F11 (cień dymu na kadłubach — kosztuje pass), F16 (gdy wróci dym wraków), F18.

## 9. Pytania do użytkownika — ODPOWIEDZIANE 2026-10-08 (§ 10)

1. Śmierć NPC bez detonacji rdzenia → wybuch z gazu (F14)?
2. Łańcuch doku: jeden obłok czy kilka kul (F1)?
3. Kolizje gazu (F2): tylko statyka czy też kadłuby w locie?
4. Budżet pamięci GPU (F5b, F17)?

## 10. Decyzje użytkownika (2026-10-08) — brief do wdrożenia

1. **Wybuch okrętu z ZBIORNIKA PALIWA (F14).** „Każdy statek będzie miał zbiornik na paliwo — więc z pewnego miejsca (zbiornika)”.
   Śmierć NPC bez detonacji rdzenia (`applyDamageToNPC`, `index.html:21438–21444`) i śmierć gracza bez rdzenia dostają wybuch z gazu
   z MIEJSCA ZBIORNIKA, nie ze środka kadłuba:
   - dane: `src/data/fuelTanks.js` na wzór `src/data/reactorCores.js` (klucz = profil renderu kadłuba: Atlas, Bellator, Iron Skull,
     …; wpis = komórka siatki belek albo px sprite'a + promień), automat dla kadłubów bez wpisu jak `autoReactorMarker` (np. druga
     najgłębsza komórka przy rufie, z dala od komory reaktora), edytor (`hpEditor.v1`) może nadpisać;
   - zbiornik żyje z kadłubem jak komora reaktora (`attachEntityReactorCores` obok `attachEntityBridges` — ten sam wzór, bez
     logiki stopienia: zbiornik to tylko MIEJSCE wybuchu + skala z pojemności); pozycja w świecie z pozy renderu encji;
   - wybuch: `makeReactorBlow({ x, y, size, profile: escort / cruiser / capital wg klasy, vx, vy })` — nośnik = prędkość wraku,
     rozmiar ∝ √pojemności zbiornika (klasa kadłuba), strumienie `jet` wzdłuż osi kadłuba z miejsca zbiornika (rozerwany
     zbiornik = gaz wychodzi z rury, decyzja z 2026-10-07); detonacja rdzenia (`reactorBlast`) zostaje jak jest, ale dokłada
     tę samą domenę gazu z `tint` barwy frakcji (jedna rodzina wybuchów okrętów);
   - `WeaponFx.droneBlast` zostaje tylko dla myśliwców i dronów (`isFighterLike`) i platform.
2. **Łańcuch doku = KILKA OSTRZEJSZYCH KUL (F1).** Nie jedna wielka domena. Więcej slotów (6 → 8–10, pamięć jest — pkt 4),
   próg scalania naprawiony (kula mieści się w domenie), wtórne dziedziczą slot rodzica bez testu `gasMinPx`; gdy slotów brak —
   dalej cząstki (żywej domeny nie zabierać), ale ma to być wyjątek, nie reguła (cel: `noSlot` 0 w scenie `lancuch`).
3. **Kolizje: STATYKA I KADŁUBY — „można spróbować” (F2).** Etap C najpierw statyka (dok, hale), potem kadłuby obrysem z belek jak
   w pyle hal; kadłuby z pomiarem kosztu pakowania (budżet: ≤ 0,15 ms CPU na klatkę przy 6 domenach i 16 kadłubach w domenach) i
   A/B obrazu; jeśli koszt albo obraz nie bronią się — zostaje sama statyka, kadłuby za przełącznikiem.
4. **Pamięć GPU: 175 MB + ~140 MB (atlas „fine”) — OK (F5b, F17).** Atlas „fine” 128 × 128 × 48 na 2 sloty dla wybuchów
   ≥ 60 px promienia na ekranie wchodzi do etapu D bez warunku sprzętowego; leniwa alokacja (F17) zostaje jako porządek, nie
   warunek.

Kolejność etapów z § 8 bez zmian (A → B → C → D), a F14 (zbiornik paliwa) dochodzi jako etap **A2** po A (dane + klej gry, bez
czekania na światło i przeszkody), bo zmienia najczęstszy wybuch w grze — śmierć okrętu w bitwie.
