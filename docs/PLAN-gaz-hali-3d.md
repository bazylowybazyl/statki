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
raport.md); błędy konsoli/GP U = 0. Powtórzenie: `node scripts/webgpu/hala-gaz-demo.mjs --etap E0`.

## Tekstury, role i kolejność E1

Prędkość A/B/C (C = predykcja MacCormacka), skład A/B/C (pył, para, spaliny, temperatura), ciśnienie A/B (A dzieli rolę
wirów przed dywergencją), zajętość/prędkość przeszkody, statyczny raster 3D RGBA8, maski obrysu R8. Kurz pokładu:
dwa pola RG16F przy 24 j. + pole wymiany z dolną warstwą; wymiana masy przez rzeczywiste powierzchnie/objętości.
Żaden dispatch nie czyta i nie pisze tej samej tekstury. E2 dostanie dwie fazy pozycji spoczynkowych, światło 3D
o połowie rozdzielczości i 256 tys. drobin; rezerwa pamięci przy 64 j. pozostawia całość poniżej 80 MB.

Kolejność: zajętość → wiry → RK2 wstecz → korekta MacCormacka z obcięciem + źródła objętości/pędu/ciepła → dywergencja
z celem źródeł → 30 iteracji Jacobiego z Neumannem i rozgrzaniem → rzut → wymiana pyłu z pokładem. Opór 0,2/s,
mała konfinacja/dyfuzja; gorące spaliny wyporne, para ciężka; każda dysza MAIN osobno, SIDE z listy klatki.
Pola aktualizowane małymi przyrostami przez `sroundF16`, ciśnienie bez. Harmonogram pary z `hallGasSources` pozostaje.

Obraz E1: marsz przez rzeczywiste pole 3D, dwa rysunki: back <116 i front ≥116, otoczenie i słońce × `sunVisibility`,
bez własnego renderera/celów/postu. Od razu kamery ortho i 3D. Pełna rozgrzewka na ekranie ładowania.

Odbiór E1: tabela wszystkich miar fizyki §10 z odczytu GPU (w tym 60 s bilansu i dwie identyczne sondy), koszt GPU
≤0,6 ms symulacji, CPU ≤0,25 ms, pamięć ≤80 MB, pipeline'y po rozgrzaniu = 0. Pomiary 1600×900 i 2560×1440, ABAB;
zero edycji w trakcie pomiaru. Report nie ukrywa nieosiągniętych bramek.
