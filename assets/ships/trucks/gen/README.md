# Ciągniki i naczepy — prompty do generatora (próba kierunku graficznego)

Decyzja użytkownika (2026-11-17): zanim powstanie cokolwiek dalej w transporcie, generujemy sprite'y ciężarówek i naczep w generatorze obrazów — „może sieć neuronowa pokaże nam drogę graficzną”. Dzisiejsze sprite'y z malarza (`../*.png`, `scripts/ciagniki-sprite.mjs`) zostają nietknięte i dalej rysują demo ciągników; ten katalog to osobna próba.

PNG z generatora kładź tutaj pod nazwą z linii „Output”. Każdy `*.prompt.md`: tytuł, Output, notatki, akapit promptu po angielsku — kopiować cały akapit od „Use case:” (najdłuższy ma 3 073 znaki). Konwencje jak w `../../README.md`: rzut ściśle z góry, dziób w prawo (+X), prawdziwa alfa, bez płomieni, poświaty, cienia, napisów i logo; lampy jako zgaszone szkła (światła i strugi rysuje gra).

## Kolejność

1. `00_rig_direction` — cały zestaw (ciągnik + 3 naczepy) w trzech stylach A / B / C. To kadr do oceny kierunku, nie sprite do gry.
2. Po wyborze stylu: `tractor_standard`, potem `tractor_light` i `tractor_heavy` — z wybranym kadrem kierunku jako referencją.
3. `trailer_chassis` — pusta rama; jej obraz jest referencją dla wszystkich naczep z ładunkiem.
4. `trailer_box`, `trailer_tank`, `trailer_hopper`, `trailer_coils`, `trailer_beams`.

## Co jest wspólne we wszystkich promptach

- To statki kosmiczne, nie pojazdy drogowe: bez kół, opon i osi; zamiast nich gondole dysz i bloki dysz manewrowych.
- Ciągnik ma z góry czytać się jak kabina ciężarówki: szyba, sypialnia, lampki na dachu, lusterka, zderzak z reflektorami, kominy, siodło z tyłu.
- Barwa linii przewozowej to JEDEN czysty kolor (niebieski) na kabinie i na ładunku — z niego da się potem zrobić maskę malowania; reszta neutralna.
- Siodło ciągnika, oko dyszla i zaczep tylny naczepy są wyraźne i na osi: tam gra łączy części zestawu.
- Proporcje i wymiary są robocze (standaryzacja ładunku jest odłożona do czasu, gdy zakłady dadzą rozmiary wyrobów).

Zdania o konwencjach są we wszystkich promptach takie same — przy zmianie konwencji popraw wszystkie naraz.
