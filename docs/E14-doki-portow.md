# E14 — doki portów bez ringu: krzyż, okrąg, koło z wlotem

Zadanie E14 z `docs/PLAN-ekonomia-rynki.md` (decyzja użytkownika 2026-10-22: osobna sesja na modele doków, trzy
rodzaje — dok krzyżowy, dok okrągły i koło, do którego się wlatuje, jak stacja z Elite Dangerous, tylko płaska).
Stan i zasady obszaru: reguła `doki-portow`; bańka ruchu: reguła `ruch-v2`, § „Bańka w grze”. Ten dokument trzyma
decyzje, przydział i pomiary.

## Przed E14

Porty bez ringu (planety bez „Halo”, księżyce, Ceres, Westa, kryjówki) miały dwa pomosty `buildStationDocks` na okręgu
4 tys. j. wokół węzła portu, bez modeli i bez kolizji — statki dokowały w pustej przestrzeni obok stacji (węzeł planety
= środek planety, pomosty Ceres częściowo w obrysie ciała). `docs/E6-banka-w-grze.md`, § „Braki kadłubów ruchu”, pkt 7.

## Decyzje

- **Przydział rodzaju po wielkości portu, nie po rodzaju ciała.** Liczba stanowisk to przeładunek portu
  (`suggestBerthMultiplier`, nadpisania `MARKET_DOCK_OVERRIDES`), więc budowla oddaje wielkość ruchu:
  - **krzyż** — 1 komplet (do 26 stanowisk): 14 księżyców (Fobos, Dejmos, Io, Europa, Ganimedes, Kallisto, Tytan,
    Enceladus, Rhea, Tethys, Mimas, Titania, Ariel, Tryton), kryjówki Gniazdo Hildy i Złomowisko, stacja gracza.
    Mała placówka: cztery czubki ramion mieszczą wszystkie stanowiska
    capital i MEGA (2 + 2), grzebienie po bokach ramion — S, M, L.
  - **okrąg** — 2–3 komplety (52–78): Luna, Oberon (2), Merkury, Wenus, Uran (3). Średni port: stanowiska na
    zewnętrznym obwodzie, podejście promieniowe z każdej strony, bez wspólnego wejścia.
  - **koło z wlotem** — od 4 kompletów (104–130): Saturn, Westa (4), Ceres (5). Duże huby z jedną szczeliną.
  Nadpisanie dla pojedynczego rynku: `docks: { kind }` w definicji.
- **Gospodarka bez zmian.** Budowla zmienia tylko pozycje stanowisk; id, klasy, kolejność, role, doki (`ringAngle`)
  i promienie redy (`dockRadius`, `parkingRadius` — z nich punkty manewrowe dyspozytora i łuki kolejki) są jak przy
  pomostach. Czas dojścia na stanowisko w rekordzie jest stały (`approachSeconds`), więc pozycja stanowiska nie wchodzi
  do czasów kursów.
- **Budowla obok węzła, nie wokół.** Węzeł planety to środek planety (tam stoi stacja gry), a wokół węzła dyspozytor
  kładzie punkty manewrowe (~6,7 tys. j.) i pierwszy łuk kolejki (~6,5 tys. j.). Budowla stoi tak, że jej dysk zapasu
  zaczyna się 7,6 tys. j. od węzła: ku Słońcu (planeta, kryjówka, stacja gracza — strona dzienna, poza cieniem planety),
  od planety-rodzica (księżyc), od ciała (stacja Ceres, Westy — na przedłużeniu ciało → stacja). Oś budowli patrzy na
  węzeł (z tej strony przylatuje większość ruchu): szczelina koła i ramię 0 krzyża.
- **Stacja planety zostaje** (`stations3D` w węźle). Budowla doku nie przejmuje roli stacji: stacja gry niesie terminal
  handlu, punkty dokowania gracza, punkty życia i rozpad — przeniesienie jej do budowli zmieniłoby rozgrywkę i obszar
  `stacje`. Do decyzji użytkownika, czy docelowo dok ma być stacją (model stacji w piaście krzyża / koła).
- **Koło: cztery pasy w szczelinie.** Każda połowa koła ma swój wlot (zewnętrzny pas) i swój wylot (bliżej osi) —
  połowy się nie spotykają; w środku jednokierunkowy ruch okrężny: wlot po pierścieniu A (bliżej stanowisk), wylot po
  pierścieniu B (bliżej piasty). Pierwsza wersja z trzema pasami (wspólny wylot) dawała zderzenia przy scalaniu wylotów
  obu połówek i wymuszone przechwyty przy gęstym ruchu.
- **Hangary kryjówek misji bez budowli** (układ `hangar`: baza piratów misji 1 na planetoidzie 16 tys. j., kryjówka
  najemnika, stocznia piratów): scena misji ma własne pomosty, a budowla 10 tys. j. obok weszłaby w planetoidę albo
  dublowała pomosty bazy — stanowiska zostają jak dawniej. Stałe kryjówki (Gniazdo Hildy, Złomowisko) mają krzyż.
- **Obraca się tylko piasta koła** (obraz, grupa ruchoma budowli); ściana ze stanowiskami i kolizje stoją.
- **Kolizje jak płyta ringu:** budowle statyczne i niezniszczalne, wypchnięcie kadłuba wektorem najmniejszej
  penetracji, prędkość w głąb zerowana; hipercruise nie przelatuje brył (zerwanie jak na płycie ringu, E9). Statki
  bańki nie mają kolizji z bryłami — omijają je ścieżkami (sprawdzone testami).

## Pomiary (2026-10-23, RTX 5080, headless Chrome)

- **Gospodarka:** `SEED=7 node scripts/symulacja-ruchu.mjs 240 1 4 60` na `main` (a4323a4b) i na E14 — wynik
  identyczny liczba w liczbę (różnią się tylko linie czasu ticku: 9,30 / 9,43 ms). Bramka bilansu niepotrzebna.
- **Testy:** `npm test` zielony; `node --test "tests/*.test.mjs"` — te same 3 porażki i 2 TODO co na `main`
  (z `node_modules` w worktree — bez niego testy czytające źródła three padają w obu wersjach). Nowe:
  `tests/portDocks.test.mjs` (7), `tests/portDockBlock.test.mjs` (6), sekcja budowli w
  `scripts/tests/portPaths.test.mjs` (krok 0,2 s, 5 wariantów — 0 wymuszeń, 0 kroków w bryle i w zacumowanym
  statku, odlot za dysk zapasu w każdym cyklu).
- **Gra, przegląd portów** `ruch-banka-gra.mjs --obserwacja 8`: tryb worker i `off` — 0 nowych pipeline'ów sync,
  0 błędów; Westa 96–112 encji (do 40 zadokowanych), Merkury 49–64, Ceres 3–11. Ostrzał, awans, taran i postój
  gracza jak w E6.
- **Zrzuty** `doki-portow-gra.mjs` (`.tmp/e14/worker2/`): krzyż Fobos z promem na stanowisku, okrąg Merkury
  (16–24 zadokowanych), koło Westa (statek w szczelinie, statki przy wewnętrznej ścianie); 0 sync, 0 błędów,
  gracz wpuszczony w ramię krzyża — wypchnięty.
- **Start w workerze** `start-sync-gra.mjs` (3 przebiegi `main`, 3 E14): 0 pipeline'ów sync; drugi flush workera
  951 → 1023 ms (+72), przygotowanie po klatce zero 464 → 474 ms (+10). Pierwszy flush dobija do limitu 4 s już na
  `main`.
- **Koszt A/B** (tryb worker, cała budowla w kadrze, `PortDocks.hideRender`, ABAB × 3, 24 próbki na stronę):

| port (rodzaj) | GPU klatki ms bez / z | CPU workera renderu ms (mediana) bez / z |
|---|---|---|
| Fobos (krzyż ×1) | 0,138 / 0,150 | 0,81 / 0,98 |
| Merkury (okrąg ×3) | 0,180 / 0,192 | 0,91 / 0,94 |
| Ceres (koło ×5) | 0,857 / 0,887 | 1,11 / 1,47 |

- **Wątek gry** (Node, 24 budowle): kolizja kadłuba w dysku koła 0,5–1 µs, bramka dalekiego NPC i pocisk ~0,06 µs.

## Ruch wielu statków (Node, krok 0,2 s, statki największych klas mieszczących się na polu)

Próba `20–30 kursów, przylot co 5–10 s, postój 60 s, odlot w losowym kierunku`; liczba kroków, w których dwa statki
w ruchu nachodzą na siebie (bańka nie rozpycha w porcie — tak samo przy pomostach i w K-7). Wszystkie przebiegi bez
wymuszonych przechwytów i etapów.

| budowla | kursy / odstęp | kroki z nałożeniem | pomosty (baza, ten sam skład) |
|---|---|---|---|
| krzyż ×1 | 20 / 10 s | 17 | 133 |
| okrąg ×3 | 30 / 10 s | 43 | 114 |
| okrąg ×2 | 25 / 5 s | 71 | — |
| koło ×4 | 30 / 10 s | 235 | 54 |
| koło ×5 | 30 / 10 s | 232 | 58 |
| koło ×5 | 30 / 5 s | ~700 | 100 |

Koło ma jedno wejście na połowę — przy bardzo gęstym ruchu przylatujący zbiegają się przed szczeliną (lot swobodny
do punktu czekania) i przecinają drogę wychodzących. Reguły korytarzy budowli: „gęsiego” po kierunku jazdy,
wychodzący ustępuje wchodzącym, przy wzajemnym — niższy numer kursu.

## Ryzyka i dalsze kroki

- Koło przy skrajnym ruchu (kurs co 5 s) — chwilowe nałożenia kadłubów przed szczeliną; możliwe dalsze kroki: reda
  przed szczeliną (kolejka przylatujących na łuku), zezwolenie na wlot jak w Elite.
- Lampki stanowisk budowli świecą stale (brak danych o zajętości w obrazie) — do podpięcia z rejestru bańki.
- Przeładunek (E12): stanowiska budowli to zwykłe stanowiska ruchu (ten sam `DockRecord`, `berthId`, poza w grze) —
  rój dronów i ładownie można podpiąć jak przy pomostach; brak tylko punktów obsługi na budowli (rękawy przy dziobie są
  w modelu).
- Autopilot i AI NPC: autopilot objeżdża dysk budowli, NPC odbijają się od brył (bez planowania objazdu) — patrole
  przy porcie mogą ocierać o konstrukcję.
