# GAZ-GPT — plan gazu 3D hali K-7 (E0, 2026-10-12)

Lektura §0 briefu wykonana w kolejności: wskazane sekcje AGENTS (pułapki 1–38), audyty i plany, zastępowany kod,
kod wzorcowy oraz narzędzia i testy. Wcześniejsze niezacommitowane zmiany pozostają. E0 i E1 to warsztat na gospodarzu
`dema/dok-k7-webgpu.js`; integracja gry, detal i światło należą do E2/E3.

## Siatka i pomiar E0

Jeden Core3D, TSL i krok `Core3D.fx`, jeden `compute(lista)` na krok. Domena lokalna: x w poprzek, z wzdłuż hali,
wysokość y jako trzecia oś tekstury. Brama i otwarty dach wypuszczają gaz. Zamknięty dach i pokład blokują przepływ.
Mapowanie obrazu przez `k7HeightToZ`; kadłub to maska belek × płyta 48–116 j. o ułamkowej zajętości.

E0: puste równania z rzeczywistymi odczytami/zapisami, adwekcja + 30 iteracji Jacobiego, 10 atlasów RGBA16F.
Mediany ABAB w jednym przebiegu na GPU użytkownika, 1600×900; koszt = compute B minus compute A (bez gazu).

| Komórka | Domena | Komórki | Compute A / B [ms], dwie pary | Przyrost [ms] | Atlasy [MB] |
|---|---|---:|---|---:|---:|
|48|240×192×16|737280|0,067936 / 0,549920; 0,067584 / 0,548704|0,481552|58,9824|
|56|208×168×14|489216|0,065920 / 0,389056; 0,068544 / 0,391456|0,323024|39,1373|
|64|184×144×12|317952|0,066144 / 0,296064; 0,066560 / 0,295232|0,229296|25,4362|

**Wybór: 64 j.** 48 j. zostawia tylko 0,118 ms na rzeczywiste równania. 64 j. zostawia 0,371 ms do limitu symulacji 0,6 ms.
E0 jest dolną granicą kosztu, nie deklaracją kosztu E1. Zrzuty i surowe dane: `.tmp/hala-gaz/E0/` (3 PNG, raport.json,
raport.md); błędy konsoli/GPU = 0. Powtórzenie: `node scripts/webgpu/hala-gaz-demo.mjs --etap E0`.

## Tekstury, role i kolejność E1

E1: 14 atlasów RGBA16F: vel A/B/C (C: predykcja, potem źródło/rotacja), den A/B/C (pył/para/spaliny/temperatura),
prs A/B, curl (potem limiter strumieni), flag, face (zajętość ścian), source, trace A/B (poderwany pył / wypływ).
Dwa statyczne rastry RGBA8, maski R8. Pokład 24 j.: A/B + diagnostyka RGBA16F i raster startowy RGBA8. Razem 43,46624 MB.
RGBA16F zamiast RG16F: format storage obsługiwany przez WebGPU; dodatkowe kanały mierzą podrywanie i powrót.

Kolejność: zajętość objętości i ścian → wiry → RK2 wstecz → monotoniczna korekta prędkości i rekonstrukcji dawcy +
źródła / siły → zgodna dywergencja MAC → 30 ważonych Jacobi (2/3) → rzut → limit wspólnych strumieni → zachowawczy
transport skalarów → wymiana pokładu powierzchniami nakładania 24/64 → dokładne kopie. 43 dispatchy. Stałe listy
1–3 podkroków, jeden compute na klatkę. Opór 0,2/s i kwadratowy; dyfuzja zależna od rotacji, wyporność temperatury,
opadanie pary 75 j/s i pyłu 48 j/s. Każda dysza MAIN osobno, SIDE z listy klatki. Harmonogram źródeł zachowany.

Obraz E1: marsz przez rzeczywiste pole 3D, dwa rysunki: back <116 i front ≥116, otoczenie i słońce × `sunVisibility`,
bez własnego renderera/celów/postu. Od razu kamery ortho i 3D. Pełna rozgrzewka na ekranie ładowania.

Odbiór E1: wszystkie miary fizyki §10 spełnione; tunel 640 j., flanka 1,102×, zawinięcie 56,14%, powrót 81,57%,
bilans +0,0156%, deterministyczne sondy. GPU 900p: moduł 0,979472 ms, symulacja 0,855072 ms; 1440p: moduł 1,290880 ms.
CPU 0,14 ms, 0 pipeline’ów sync, 0 błędów. **Budżet symulacji 0,6 ms NIE spełniony; użytkownik odłożył optymalizację.**
Pełny raport §14: `docs/RAPORT-gaz-hali-3d-E1-GAZ-GPT.md` i `.tmp/hala-gaz/E1/`; zrzuty, przekroje i dwa arkusze sekwencji.
