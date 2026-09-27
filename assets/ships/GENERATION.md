# Sprite’y — generacja 2026-09-26/27

Wygenerowano kolejno komplet 27 PNG z plików `*.prompt.md` w tym katalogu, wbudowanym narzędziem **imagegen**, z obrazami referencyjnymi wskazanymi w promptach. Przegląd: [galeria](gallery.html). Obrazy są zapisane pod nazwami Output.

## Weryfikacja techniczna

- 26 plików ma płótno 1774 × 887, wagon 1672 × 941. Ostatnią wersję marsjańskiego niszczyciela (1773 × 887) dopełniono jednym przezroczystym pikselem szerokości, bez skalowania.
- Wszystkie pliki mają rzeczywisty kanał alfa i przezroczyste tło.
- Wszystkie sześć pustych pokładów ma **alfę identyczną co do piksela** z wersją pełną (0 różnic). Zachowano oryginalne płótno, skalę i położenie kadłuba. Z obrazów generatora przeniesiono wyłącznie wnętrza ładowni zgodnie z README.
- Obejrzano wygenerowane obrazy i końcowe złożone puste pokłady. Poprawiono wykryte braki głównych gniazd, gniazdo specjalne krążownika KZ, dysze niszczyciela Marsa i nosicieli oraz podział ładowni ciężkiego frachtowca i megafrachtowca.
- Sloty pustych pokładów: prom 8, kontenerowiec 18, dalekiego zasięgu 28, ciężki 48, megafrachtowiec 40, wagon 32.
- Ta sesja dotyczyła generacji grafik. Nie przeprowadzono integracji ani testu kadłubów, hardpointów i mostków w grze.

## Odstępstwa do uwzględnienia przed integracją

To wygenerowany zestaw do przeglądu, nie potwierdzenie zgodności każdego detalu ze specyfikacją. Generator nie zachował wszystkich orientacyjnych proporcji i marginesów. Nie rozciągano obrazów, żeby sztucznie wymusić proporcje. Szczególnie Corvus, fregata Pasa, łowca i krążownik KZ wyszły smuklejsze, a nosiciel KW szerszy od założeń. Wpływa to na pole alfy, HP i masę zderzeń.

Główne gniazda poprawiano wzrokowo. Drobne gniazda aux, pokrywy rakietowe i elementy maszynowni miejscami mają podobną formę; ich ostateczne przypisanie i liczby wymagają sprawdzenia przy wyznaczaniu markerów edytora. Nie należy automatycznie kopiować współrzędnych z kadłubów Terra Novy.

Poniżej obwiednia pikseli o alfa > 25/255; proporcja oznacza długość / szerokość sylwetki. „Szer. płótna” pokazuje zajętość poziomą (nowe projekty miały cel ~90%). Puste pokłady zachowują proporcje i marginesy swoich oryginałów.

| PNG | Sylwetka (px) | Proporcja wynik | Cel promptu | Szer. płótna |
|---|---:|---:|---:|---:|
| [belt_carrier](belt_carrier.png) | 1728 × 648 | 2.67 | 2.8 | 97.4% |
| [belt_cruiser](belt_cruiser.png) | 1744 × 714 | 2.44 | 2.4 | 98.3% |
| [belt_destroyer](belt_destroyer.png) | 1721 × 697 | 2.47 | 2 | 97.0% |
| [belt_frigate](belt_frigate.png) | 1696 × 589 | 2.88 | 2.2 | 95.6% |
| [bounty_hunter](bounty_hunter.png) | 1708 × 456 | 3.75 | 3 | 96.3% |
| [container_ship_empty](container_ship_empty.png) | 1701 × 506 | 3.36 | oryginał | 95.9% |
| [corvus](corvus.png) | 1664 × 557 | 2.99 | 2.2 | 93.8% |
| [heavy_freighter_empty](heavy_freighter_empty.png) | 1708 × 581 | 2.94 | oryginał | 96.3% |
| [heavy_freighter](heavy_freighter.png) | 1708 × 581 | 2.94 | 2.75 | 96.3% |
| [inner_carrier](inner_carrier.png) | 1722 × 805 | 2.14 | 2.9 | 97.1% |
| [inner_cruiser](inner_cruiser.png) | 1702 × 735 | 2.32 | 2.5 | 95.9% |
| [inner_destroyer](inner_destroyer.png) | 1674 × 706 | 2.37 | 2.2 | 94.4% |
| [inner_frigate](inner_frigate.png) | 1684 × 726 | 2.32 | 2.4 | 94.9% |
| [inter_station_shuttle_empty](inter_station_shuttle_empty.png) | 939 × 431 | 2.18 | oryginał | 52.9% |
| [long_haul_freighter_empty](long_haul_freighter_empty.png) | 1674 × 472 | 3.55 | oryginał | 94.4% |
| [mars_carrier](mars_carrier.png) | 1696 × 653 | 2.60 | 2.8 | 95.6% |
| [mars_cruiser](mars_cruiser.png) | 1727 × 687 | 2.51 | 2.4 | 97.4% |
| [mars_destroyer](mars_destroyer.png) | 1678 × 786 | 2.13 | 2 | 94.6% |
| [mars_frigate](mars_frigate.png) | 1725 × 703 | 2.45 | 2.2 | 97.2% |
| [megafreighter_empty](megafreighter_empty.png) | 1744 × 578 | 3.02 | oryginał | 98.3% |
| [megafreighterwagon_empty](megafreighterwagon_empty.png) | 1587 × 587 | 2.70 | oryginał | 94.9% |
| [outer_carrier](outer_carrier.png) | 1712 × 504 | 3.40 | 3.2 | 96.5% |
| [outer_cruiser](outer_cruiser.png) | 1730 × 458 | 3.78 | 3 | 97.5% |
| [outer_destroyer](outer_destroyer.png) | 1693 × 560 | 3.02 | 2.6 | 95.4% |
| [outer_frigate](outer_frigate.png) | 1651 × 511 | 3.23 | 2.8 | 93.1% |
| [police_cutter](police_cutter.png) | 1573 × 655 | 2.40 | 2.1 | 88.7% |
| [rescue_ship](rescue_ship.png) | 1600 × 616 | 2.60 | 2.2 | 90.2% |

## Prompty i poprawki

Źródłem każdej generacji był pełny akapit zaczynający się od „Use case:” w odpowiadającym pliku [README](README.md). Do generowania dołączano wymagane referencje. Korekty imagegen ograniczano do wskazanego detalu (brakujące okrągłe podstawy, liczba dysz, dodatkowy rząd ładunku, podział zatok), z żądaniem zachowania stylu, orientacji i przezroczystości. Oryginały generatora pozostają w katalogu `generated_images` Codex; obrazy używane przez projekt są w tym katalogu.

