# Warp gracza: kadr lotu i pochylenie soczewki (2026-10-29)

Zgłoszenie użytkownika po pierwszej wersji efektów boków kadru (cytat): „hipercruise lepiej, warp gorzej, bo mamy 2D statek,
który leci do góry, i wszystkie próby efektów zrobiły 3D. To się nie klei, nie pasuje. Statek leci do góry, a wszystkie
efekty są stworzone tak, jakby leciał w głąb ekranu. Kamera jest za blisko na statek, trzeba ją oddalić, dopasować to tak,
żeby było spójne”. Z propozycji użytkownik wybrał „1 + 2 i 3a”:

1. efekty równoległe do kursu (widok z góry) — `src/3d/warp/warpEdgeFx.js`, opis w `docs/PROPOZYCJA-efekty-warpa-2026-10-29.md`;
2. kamera dalej, statek bliżej środka — niżej, „Kadr lotu”;
3a. mniej pochylenia soczewki (punkt zbiegu nad górną krawędzią) za przełącznikiem — niżej, „Pochylenie soczewki”.

Stan i zasady: reguła `kamera` (UJEDNOLICONY ZOOM SKOKU — KADR LOTU), reguła `warp` (MAPA O1 — pochylenie z adresu).

## Kadr lotu (2)

Dawniej zoom odniesienia skoku = domyślny zoom statku (kadłub 20% SZEROKOŚCI kadru), w skoku × `warpZoomOut` 0,55. Soczewka
świata liczy skalę z kadru 16:9 tej WYSOKOŚCI (`aspectMax`), więc na szerokim ekranie statek był względem świata w soczewce
większy niż na 16:9:

| kadr | 1920 × 1080 (16:9) | 5120 × 1440 (32:9 — ekran użytkownika) |
|---|---|---|
| dawny kadr skoku (Atlas, 1800 j.) | 211 px — 19,6% wysokości | 563 px — 39,1% wysokości |
| kadr lotu (po kopie) | 84 px — 7,8% wysokości | 113 px — 7,8% wysokości |

Kadr lotu (`cameraRig.js`: `warpJumpZoomRef`, wejście `zoomRefFar`, `rig.warpFarU` / `rig.warpZoomRef`): domyślny zoom statku
× `warpJumpFrame` 0,4 z szerokości kadru najwyżej `warpJumpAspect` 16:9 × wysokość; odniesienie przechodzi do niego dopiero
w locie (smoothstep `warpJumpFrameRise` 1,5 s), trzyma przez wyjście i kadr przylotu K1, wraca z wagą ujednolicenia.
Ładowanie zostaje w dawnym kadrze, podłoga K1 liczy się z kadru ładowania, wyprzedzenie w skoku `warpJumpLead` 0,35
(= `navLead`, niezależne od postawy).

### Symulator soczewki (`node scripts/webgpu/warp-soczewka-sym.mjs`, S1–S12, 1080 i 1440 wierszy, wariant K1)

Liczba kontroli z BŁĘDEM (oba rozmiary razem); opcja `--kamera klucz=liczba` (strojenie kamery gry) dodana na tę okazję.

| wariant kamery | 16:9 | 21:9 | 32:9 |
|---|---|---|---|
| dawna (`warpJumpFrame=1,warpJumpAspect=0`, wyprzedzenie 0,35) | 0 | 2 (S11) | 10 (S1 × 6, S7 × 2, S11 × 2) |
| kadr skoku × 0,5 od ładowania, wyprzedzenie 0,22 (pierwsza wersja, commit caefa4f0) | 10 (S8, S10, S12) | — | — |
| × 0,5 od ładowania, wyprzedzenie 0,35 | 6 (S12) | — | — |
| × 0,75 od ładowania, wyprzedzenie 0,35 | 6 (S12 — Luna 437 px/kl.) | — | — |
| × 0,65 / 0,75 od ładowania, wyprzedzenie 0,22 | 10 / 10 | — | — |
| szerokość ≤ 16:9 × wysokość, × 1 od ładowania | — | — | 16 (dawne 10 + S12 × 6) |
| KADR LOTU po kopie × 0,5 | 0 | — | 12 (dawne 10 + S8 × 2) |
| **KADR LOTU po kopie × 0,4 (przyjęte)** | **0** | **2 (= dawne)** | **10 (= dawne)** |

- S12 (odlot z portu nad Ziemią, start 3080 j. za brzegiem studni): dalszy kadr JUŻ W ŁADOWANIU widzi ring z portem — bramka
  ringu (`planet3d.assets.js`: `gate`, ring w kadrze trzyma planetę na prawdziwym miejscu) nie otwiera się w ładowaniu,
  a po kopie statek przelatuje nad Ziemią i ring zostaje w kadrze przez 2,4 s: przelot bez soczewki („nad tarczą 0 s”),
  potem Luna przeskakuje 108–437 px w klatce i miga. Bramka otwarta raz w skoku zostaje otwarta, więc odsuwanie dopiero
  w locie tego nie rusza; ciała w locie leżą w soczewce (px niezależne od zoomu) — maleje tylko statek.
- Wyprzedzenie 0,22 (statek bliżej środka): kop S10 61,1 / 60 px, wyjście S8 65,0 / 60 px (1080 wierszy).
- S8 na 32:9 (wyjście tuż za Jowiszem, „duża tarcza ze środkiem poza kadrem”) zależnie od kadru lotu: 0,35 — 53,6;
  0,4 — 57,5; 0,45 — 60,8; 0,5 — 63,6; 0,6 — 68,1; 0,7 — 71,6 px/kl. (próg 60); stąd 0,4.
- Dawne błędy 21:9 / 32:9 (S1, S7, S11 — ciała w bocznych pasach szerokiego kadru) są niezależne od kamery: decyzja
  `aspectFlow` czeka w `docs/webgpu/WARP-SOCZEWKA.md` § „Mapa O1 — proporcje kadru”.

## Pochylenie soczewki (3a)

`?warpSoczewka=plaska` — `hf` 2,5 zamiast 0,8 (`worldLens.js`: `parseWarpLensTilt`, stosuje `warpNurt.js:
_commitWorldLens` przy zmianie adresu, także w workerze); `?warpSoczewka=<liczba>` — `hf` wprost (0,3–10; 1 — punkt
zbiegu na górnej krawędzi). Skala w trawersie `s` bez zmian, płaszczyzna kamery `A` rośnie z `hf` (× 3,1): mniej
perspektywy, ciała wjeżdżają z góry kadru i mijają statek bardziej równolegle.

Symulator (`--param hf=2.5`, kamera z kadrem lotu): limity ruchu P4 we wszystkich scenariuszach w normie; jedyny błąd —
C5 „cel w kadrze od kopu do końca ślizgu + 1 s” w 14 przebiegach (cel poza kadrem 4–19 s): obraz dalekiego ciała leży nad
górną krawędzią (punkt zbiegu poza kadrem), cel wjeżdża z góry dopiero z bliska. Tak działa płaska soczewka — decyzja
użytkownika po obejrzeniu (domyślnie `hf` 0,8 bez zmian).
