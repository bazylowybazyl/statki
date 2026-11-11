# Propozycja: głosy fabuły i muzyka w grze (2026-11-11) — do decyzji użytkownika

Nic tu nie jest wygenerowane ani podpięte. Liczby z repozytorium (`src/data/story/`, `index.html`), koszt z cennika
w skrypcie generatora (`scripts/dzwieki-elevenlabs.mjs`: mowa `eleven_multilingual_v2` — 1 kredyt za znak).

## Stan dziś

- Kwestie: `src/data/story/mission01.dialogue.js` i `mission02.dialogue.js` — 67 kwestii, 4 077 znaków, WSZYSTKIE są
  zaślepkami w nawiasach („[Odprawa: na obrzeżach układu coś się dzieje…]”). Obsada (`cast.js`): `player` (Dowódca
  Atlasa), `xo` (Pierwszy oficer), `admiral`, `k7` (Kontrola K-7), `intel` (Oficer wywiadu), `fleet` (Dowódca grupy
  wsparcia), `pirate` (Herszt piratów), `ambusher` (zasadzka w pasie), `unknown`. Imiona i portrety — „do uzupełnienia”.
- Znaki zaślepek na postać: xo 2 442 (60%), admiral 458, pirate 373, intel 309, k7 188, ambusher 114, player 98,
  fleet 95.
- Muzyka: w grze nie gra nic. Jest suwak „Muzyka” (menu i opcje, `OPTIONS.audio.music` = 0,7, zapis `sc_audio`), ale
  żaden kod go nie używa; plik `public/sounds/menu/menu.mp3` leży nieużywany.
- Głos, który już gra: spiker hali K-7 (Daniel, męski brytyjski, PO ANGIELSKU — decyzja użytkownika „niech gada po
  angielsku”), przez szynę `megafon`.

## Głosy fabuły — propozycja

1. NAJPIERW prawdziwe kwestie. Udźwiękowienie zaślepek nie ma sensu — tekst się zmieni, a każda zmiana to nowe
   kredyty. Kolejność: tekst misji 1 i 2 → decyzja o języku → obsada → generowanie.
2. Język — do decyzji: kwestie są po polsku, spiker K-7 mówi po angielsku. Model `eleven_multilingual_v2` mówi po
   polsku; spójność z halą przemawia za angielskim (napisy po polsku w oknie dialogu zostają).
3. Obsada (gotowe głosy z biblioteki ElevenLabs, konkretne głosy do wyboru odsłuchem — 2–3 kandydatów na rolę, próbka
   jednej kwestii po ok. 100 znaków):
   - `k7` — ten sam głos co spiker hali (Daniel) — Kontrola K-7 to ta sama hala;
   - `xo` — główny głos kampanii (60% tekstu): spokojny, rzeczowy, średni wiek; najważniejszy wybór;
   - `admiral` — starszy, niski, autorytet; `intel` — chłodny, szybszy, może kobiecy dla kontrastu z xo;
   - `fleet` — energiczny wojskowy; `pirate` — szorstki, z charakterem (najłatwiej przesadzić — próbki);
   - `ambusher` — może ten sam głos co `pirate` przez inny filtr radia;
   - `player` — do decyzji: bohater niemy (tylko napis) albo głos; `unknown` — szum radia bez głosu albo `pirate`.
4. Brzmienie: kwestie „radio” w trakcie gry przez szynę radiową (jak `megafon`, węższe pasmo 300–3 400 Hz, lekki
   szum, bez echa hali), sceny w doku i odprawa — czysto. Wyciszanie (ducking) efektów pod kwestią o 4–6 dB.
5. Koszt (1 kredyt/znak): dzisiejsza objętość ~4 100 znaków → ~4 100 kredytów za jedną wersję każdej kwestii;
   z 2 wariantami na kwestię i próbkami obsady (8 ról × 3 kandydatów × 100 znaków ≈ 2 400) — ok. 10 600 kredytów.
   Prawdziwy tekst będzie zapewne dłuższy niż zaślepki (opisy scen) — szacunek ×1,5: ok. 15 000 kredytów. Modele
   `eleven_flash_v2_5` / `eleven_turbo_v2_5` są tańsze (cennik ElevenLabs: 0,5 kredytu za znak), ale brzmią płaściej —
   do porównania na próbkach. Stan konta 2026-11-11: ok. 115 600 kredytów z 131 000 (plan Creator).
6. Uprawnienia klucza: „Text to Speech” (klucz już je ma — działa spiker) i odczyt głosów („Voices: Read”) do wyboru
   obsady. Głosy z biblioteki bez klonowania — bez „Voice Cloning”.
7. Technika: skrypt generatora już obsługuje mowę (wpisy z `teksty` i `glos`); kwestia → plik z id kwestii; okno
   dialogu (`src/game/story/dialogue.js`) wołałoby dźwięk przy wypisaniu kwestii, a `hold` liczyłby się z długości
   pliku zamiast z długości tekstu.

## Muzyka — propozycja

1. Gdzie gra (szyna muzyki z suwakiem `OPTIONS.audio.music`, osobna od efektów, bez kompresora efektów):
   - MENU — temat główny (pętla 1,5–2 min), wygaszany przy starcie gry;
   - LOT / EKSPLORACJA — 2–3 spokojne utwory ambientowe, cicho (−8…−10 dB pod efektami), z przerwami ciszy, bo gra ma
     silniki, warp i tło mostka;
   - WALKA — warstwa bojowa przenikana z eksploracji, gdy wrogowie są w zasięgu broni albo trwa alarm okrętu
     (`ShipAlarm`), z 4–6 s opóźnieniem wyjścia, żeby nie skakała;
   - MOMENTY FABUŁY — odprawa w K-7 (pod kwestiami, bardzo cicho), alarm w bazie piratów, finał (zawalenie habitatu),
     podsumowanie misji (krótki motyw zwycięstwa); zasadzka w pasie — uderzenie warstwy bojowej;
   - HALA K-7 — bez muzyki (ma własne tło i spikera) albo eksploracja bardzo cicho.
2. Styl — do decyzji użytkownika (wzorzec dźwięku to Starsector): ambient syntezatorowy z orkiestrowymi smyczkami
   i niskim pulsem, bez wokalu; walka — perkusja i ostinato, bez epickiego chóru.
3. Generowanie: ElevenLabs ma generator muzyki (Eleven Music, osobne API) — potrzebne uprawnienie klucza do muzyki
   (pozycja „Music” w ustawieniach klucza; dzisiejszy klucz ma efekty, mowę i odczyt głosów). Cennika muzyki w kredytach
   nie znam pewnie — przed decyzją sprawdzić na koncie (próba jednego utworu 30 s i `--konto` przed i po). Licencja do
   użytku komercyjnego — sprawdzić w warunkach planu (gra ma być wydana: reguła `electron-wydanie`). Pliki — jak efekty
   robocze: `public/sounds/ai/` z manifestem.
4. Objętość na start: temat menu (2 min), 2 utwory eksploracji (po 2–3 min), 1 warstwa walki (2 min), 3 krótkie
   motywy (odprawa, alarm, zwycięstwo po 20–40 s) — ok. 12 minut muzyki.
5. Plik `public/sounds/menu/menu.mp3` — do odsłuchu przez użytkownika: jeśli pasuje, menu może grać od razu bez
   generowania (pochodzenie pliku do sprawdzenia przed wydaniem).

## Decyzje dla użytkownika

1. Głosy: najpierw piszemy prawdziwe kwestie misji 1–2? (bez tego generowanie głosów jest stratą kredytów)
2. Język głosów: polski czy angielski (jak spiker K-7)?
3. Bohater (`player`) mówi czy jest niemy?
4. Muzyka: czy w ogóle w grze (gdzie: menu / lot / walka / fabuła), jaki styl, i czy próbować generatora ElevenLabs
   (uprawnienie klucza do muzyki), czy szukać muzyki z innego źródła?
