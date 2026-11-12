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
  - `?test=1` — klatki tylko z `__autostrada.klatki`.
- **Jeden świat, kilka sposobów rysowania.** Sieć `siec.js` (pochodzi ze sprawdzonego skryptu inżyniera ruchu), ruch i sygnał `ruch.js`, wstęgi `wstegi.js`, infrastruktura `infrastruktura.js` i baza obrazu `baza3d.js` są wspólne. Style `styl-*.js` rysują tylko drogę. Rejestr: `style.js`, kolejność = klawisze.
- **Prawda sygnału:** nikt nie przejeżdża linii stopu na czerwonym (licznik `stat.przejazdyNaCzerwonym`, test). Ciężkie i mega jadą tylko przez pudło K-7 w fazie CLEAR / BOX. Atlas wymusza fazę (`atlasStart`), K-7 gracza to indeks 3 (315° sceny).

## Zasady

- **TOR BOCZNY PO DRODZE, NIE PO CZASIE:** promień na pasie to krzywa Hermite'a po przebytej drodze `v.d`. Kurs wynika z nachylenia:
  - jazda CW: +atan;
  - jazda CCW: −atan.
- **Przejścia pas ↔ ścieżka bez skoku:**
  - zjazd dokładnie w chwili minięcia punktu (ps = przejechana nadwyżka);
  - odsunięcie ścieżki po PRAWEJ burcie z nachyleniem z pasa;
  - wtopienie z dokładnej pozy na ścieżce.
- **Strażnik:** test „poza gładka” — skok pozycji < 12 j., kursu < 0,05 rad na klatkę 60 Hz.
- **Ślady (Klisza)** czytają historię pozycji (`ruch.hist`: wiersz co 0,2 s; wysyłka zakresem jednego wiersza, po przewinięciu całość). Nie wracaj do sztywnego łuku z krzywizny pojazdu: wyginał ogon przy manewrach.
- **Obraz drogi pod kadłubami:** `transparent: false` + `AdditiveBlending` (pułapka 41). Światła pojazdów są nad kadłubami (lista przezroczystych, kolejka 14). Bramownice i głowice — warstwa 2 (FG, z ≈ 190–240).
- **Próg bloomu:** rzecz cieńsza niż ~3 px trzyma szczyt ≤ 0,85. Nad progiem świeci tylko sygnał.
- **Niebo gry jest jasne:** podkład (`baza3d.js`, siła `styl.podklad`) przyciemnia je pod drogą. Ocena wyglądu zawsze na prawdziwym niebie.

## Jak sprawdzać

- `node --test tests/autostrada.test.mjs` — sieć, sygnał, ciężkie, płynność, historia.
- `node scripts/webgpu/autostrada-demo.mjs --out .tmp/autostrada/<k> [--style klisza,lampy] [--kadry wezel,zatoka,...] [--atlas 1] [--ring 0]` — zrzuty, błędy konsoli (ma być 0).
