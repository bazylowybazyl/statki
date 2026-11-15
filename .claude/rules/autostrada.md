---
paths:
  - "dema/autostrada.html"
  - "dema/autostrada.js"
  - "dema/autostrada/**"
  - "tests/autostrada.test.mjs"
  - "scripts/webgpu/autostrada-demo.mjs"
---

# Autostrada wokół Ziemi (demo, niewpięte)

> Reguła obszaru. Decyzje i liczby: `docs/PROPOZYCJA-autostrada-ziemi.md`. Zasady przekrojowe: `AGENTS.md`.

## Stan

- **Demo** `dema/autostrada.html` stoi na prawdziwym `Core3D`: Ziemia gry, ring „Halo” z K-7 (`HaloRingWorld` + `HaloRingGame`), proxy ruchu `ShipProxyBatch3D`, Atlas na belkach (`dema/mostki-webgpu/swiat.js`). Przełączniki w adresie:
  - `?styl=`, `?slady=daleko|pelne|brak`, `?barwy=jednostka|kierunek`;
  - `?ring=0` — szybkie strojenie bez ringu;
  - `?zasieg=<j.>` — głowica stoczni w układzie „rama” (od początku huba);
  - `?test=1` — klatki tylko z `__autostrada.klatki`.
- **Dwa układy drogi**, każdy z własną siecią, ruchem i bazą obrazu (`utworzUklad` w `dema/autostrada.js`; liczy się tylko czynny). Styl wybiera układ polem `utworz.swiat` (rejestr `style.js`, kolejność = klawisze):
  - **pierścień** (`siec.js`) — style 1–4: Klisza, Nocne Podejście, Malowanie światłem, Nawa;
  - **rama** (`siec-rama.js`) — styl 5 „Rama”: kwadrat czterech prostych, naroża opływają stocznie wystające daleko od ringu (K-7 ma zostać stocznią).
- **W obrębie układu jeden świat, kilka sposobów rysowania.** Ruch i sygnał `ruch.js`, wstęgi `wstegi.js`, baza obrazu `baza3d.js` są wspólne dla układów. Infrastruktura: `infrastruktura.js` (pierścień) i `infrastruktura-rama.js` (ten sam kształt danych). Style `styl-*.js` rysują tylko drogę.
- **Prawda sygnału:** nikt nie przejeżdża linii stopu na czerwonym (licznik `stat.przejazdyNaCzerwonym`, test). Ciężkie i mega jadą tylko przez pudło węzła w fazie CLEAR / BOX. Atlas wymusza fazę (`atlasStart`), kompleks gracza to indeks 3 (315° sceny).
- **Makieta stoczni** w stylu „Rama” to obrys i zasięg (burty, suwnice, dno doku), nie projekt bryły — tę robi użytkownik. Nastawy: `RAMA` w `siec-rama.js`.

## Zasady

- **RUCH PRZEZ GEO, NIE PRZEZ OKRĘGI:** położenie na pasie głównym to (s, r) — droga wzdłuż pasa odniesienia jezdni i współrzędna boczna („promień równoważny”, wartości `HW`). Na świat przelicza je tylko `siec.geo` (`geoPierscien` w `siec.js`, `geoRamy` w `siec-rama.js`: `poza`, `rzut`, `sPunktu`, `rPunktu`, `sKata`, `sWzdluz`). Nowy kod ruchu, infrastruktury i wstęg nie liczy `r · cos θ`.
  - Promień ścieżki w ruchu: `probki.rb` (współrzędna boczna próbki), nie `hypot(x, y)`.
  - Style 1–4 liczą na okręgach z `HW` — działają tylko w układzie pierścienia.
- **PASY RAMY SĄ RÓWNOLEGŁE:** krzywa pasa = oś drogi odsunięta wzdłuż normalnej (na łuku naroża rośnie promień, środek ten sam). Nie odsuwaj pasów po promieniu od środka Ziemi: na prostej zwężałyby się ku narożom.
- **WĘZŁY RAMY NA PROSTYCH:** zjazdy, wjazdy, zawrotki i wrota buduje się w hubie boku (kąt tranzytu), gdzie pasy to proste `z = const`. Na łuku naroża leży tylko pudło stoczni z linią stopu. Test pilnuje, że kliny ramp mieszczą się przed narożem.
- **OBRYS STOCZNI WOLNY:** żadna ścieżka poza pasami promieniowymi węzła nie wchodzi w obrys stoczni (test, także dla innych zasięgów). Wyjazd ciężkich (±2 430) leży bliżej osi niż wjazd (±4 050) — inaczej drogi przedpola się przecinają.
- **TOR BOCZNY PO DRODZE, NIE PO CZASIE:** promień na pasie to krzywa Hermite'a po przebytej drodze `v.d`. Kurs wynika z nachylenia:
  - jazda CW: +atan;
  - jazda CCW: −atan.
- **Przejścia pas ↔ ścieżka bez skoku:**
  - zjazd dokładnie w chwili minięcia punktu (ps = przejechana nadwyżka);
  - odsunięcie ścieżki po PRAWEJ burcie; jego pochodna = tangens kąta między ścieżką w tym punkcie a kursem kadłuba na pasie (klin zawrotki skręca od pierwszego metra);
  - wtopienie z dokładnej pozy na ścieżce: kurs kadłuba (z pochodną odsunięcia) wobec kursu pasa, granica nachylenia 0,75 (klin kieszeni ma do 0,63).
- **Tor boczny wpływa na dynamikę:** długość toru zmiany pasa ustala czas „ducha” w starym pasie. Zmiana wzorów przejść zmienia więc przebieg ruchu (statystycznie ten sam), nie tylko pozy.
- **Strażnik:** testy „poza gładka” (oba układy) — skok pozycji < 12 j., kursu < 0,05 rad na klatkę 60 Hz.
- **Ślady (Klisza)** czytają historię pozycji (`ruch.hist`: wiersz co 0,2 s; wysyłka zakresem jednego wiersza, po przewinięciu całość). Nie wracaj do sztywnego łuku z krzywizny pojazdu: wyginał ogon przy manewrach.
- **Obraz drogi pod kadłubami:** `transparent: false` + `AdditiveBlending` (pułapka 41). Światła pojazdów są nad kadłubami (lista przezroczystych, kolejka 14). Bramownice, głowice i makieta stoczni — warstwa 2 (FG, z ≈ 100–240).
- **Próg bloomu:** rzecz cieńsza niż ~3 px trzyma szczyt ≤ 0,85. Nad progiem świeci tylko sygnał.
- **Niebo gry jest jasne:** podkład (`baza3d.js`, siła `styl.podklad`) przyciemnia je pod drogą; „Rama” ma własną taflę (mnożenie z ostrą krawędzią) i gasi podkład bazy. Ocena wyglądu zawsze na prawdziwym niebie.
- **Odbicia w tafli („Rama”)** to instancje przepisywane co klatkę na CPU: stożek reflektorów zaczyna się przy dziobie, plama sygnału mieści się w poprzek w płycie. Bez ziarna w komórkach świata — z bliska wyglądało jak szum.

## Jak sprawdzać

- `node --test tests/autostrada.test.mjs` — oba układy: sieć, sygnał, ciężkie, płynność, historia; geometria ramy (poza ↔ rzut, równoległość), obrys stoczni dla trzech zasięgów.
- `node scripts/webgpu/autostrada-demo.mjs --out .tmp/autostrada/<k> [--style klisza,rama] [--kadry wezel,stocznia,zatoka,...] [--atlas 1] [--ring 0] [--query zasieg=40000] [--nakladki 1]` — zrzuty, błędy konsoli (ma być 0). Kadr `stocznia` istnieje tylko w układzie „rama”.
- Zmiana w `ruch.js` albo `siec.js`: porównaj liczniki `ruch.stat` pierścienia przed i po (ten sam `ziarno`) — pokaże, czy zmieniła się dynamika, czy tylko pozy.
