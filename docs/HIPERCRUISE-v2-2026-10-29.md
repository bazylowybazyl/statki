# Hipercruise v2: przelot, nie tunel (2026-10-29)

Zgłoszenie użytkownika (cytat): „popraw efekt hypercruise — obecnie za mocno drga i robi kołowe haze, nie pasuje do
czegoś takiego. Skupiamy się na silnikach — efekt z nich, i trzeba dodać jakiś efekt lotu. Może wykorzystać haze — dać
go większego z silników i efekt à la opływowy, aerodynamiczny haze wzdłuż statku w dół — żeby oddać prędkość”.

Stan i zasady: reguły `warp` (HIPERCRUISE v2), `silniki` (plazma hipercruise'u), `kamera` (wstrząsy, kop w hipercruisie),
`core3d` (warstwa DIST). Kod: `src/3d/warp/hyperLook.js` (A/B, strojenie), `src/3d/warp/hyperFlow.js` (opływ),
`src/3d/warp/player.js` (`hyperCalm`), `src/3d/warpPlume3D.js` (`setHyper`, `WARP_PLUME_HYPER`), `src/3d/engineVfxSystem.js`
(haze dysz, dysze do opływu), `src/game/warpShakes.js`, `src/game/cameraRig.js` (`hyper*`). Testy: `tests/hyperFlow.test.mjs`,
`tests/hypercruiseLook.test.mjs`, `tests/warpShakes.test.mjs`.

## 1. Skąd „drga” i „kołowe haze” (rozpoznanie przed zmianą)

Hipercruise od 2026-10-22 był efektem dawnego warpa („obecny silnik warp będzie hypercruise”), więc niósł całą
dramaturgię skoku przez tunel:

| Co | Gdzie | Wartość przed |
|---|---|---|
| Soczewka bańki na mgławicy — elipsa wokół statku przez cały lot | `player.js` (`addLens`, `bubbleLensOn = hyper`) | 26 px, a = 0,84 L, b = 0,62 L |
| Fala kopu — rozchodzący się pierścień refrakcji przez cały kadr | `player.js` (`addWave` przy kopie) | 9000 j/s, 8 px, 1,4 s |
| Fala, błysk i blask wyjścia, żar kadłuba | `player.js` (wyjście) | fala 11 px, żar τ 2,2 s |
| Wstrząs kopu / wyjścia / hamowania | `warpShakes.js` | 9 / 8 / **22** (11 px — największy, bez żadnego hamowania w obrazie) |
| Kop kamery, impulsy zoomu, drżenie rozruchu | `cameraRig.js` | 140 px (~96 px szczyt), ±10%, 4 px przy 12 Hz |
| Plazma: turbulencja kształtu ±61%, przepływ ~15 / 35 / 62 R/s (oktawa 3 przeskakiwała ~¾ okresu na klatkę przy 60 kl/s), diamenty Macha 12 Hz, szum marszu co klatkę, 5 okrągłych pulsujących poświat 7 R, rozprysk iskier | `warpPlume3D.js` | dopalacz × (1 + 1,7) w przepływie |
| Rozruch: żar wylotu drży 0,32 przy 3–18 Hz; wyjście: krztuszenie 4,6 / 11,3 Hz | `WARP_PLUME_HYPER` | |
| Gorące powietrze dysz: stożek 7 R — krótszy niż strumień (9–16 R) | `engineVfxSystem.js` | promień = wylot |

## 2. Co zmienione

- **Bez kół** (`player.js` — `hyperCalm`): w hipercruisie nie ma soczewki bańki, fali i błysku kopu ani błysku, blasku,
  fali i żaru wyjścia. Smugi gwiazd, front i przepływ jak dawniej (odcisk v2 w teście).
- **Bez szarpania**: wstrząs kopu × 0,15 (2,7 → ~1,4 px), wyjście i hamowanie 0; kop kamery × 0,3 (140 → 42 px),
  impulsy zoomu ±3%, bez drżenia rozruchu. Oddalenie na czas hipercruise'u (`warpZoomOut`) i obrót kadru bez zmian.
- **Silniki**: w locie strumień dłuższy (wydłużenie dopalaczem 1,15 zamiast 0,55) i smuklejszy (× 0,82), turbulencja
  kształtu × 0,5, przepływ dopalacza 0,6 zamiast 1,7 (bez „koła wagonu”), cechy wyciągnięte w smugi, diamenty Macha prawie
  stoją, szum marszu 0,35, migotanie 0,08, poświaty wylotu okrągłe i spokojne (duża błękitna × 0,55), iskry 0,12 i węższe.
  Rozruch — żar „oddycha” (0,07 przy 0,6–1,8 Hz), zapłon łagodniejszy (błysk 1,2, pchnięcie × 1,4), wyjście — płynne
  zdjęcie ciągu bez krztuszenia.
- **Większe gorące powietrze dysz**: stożek × 1,8 (dłuższy, szerszy, wzór płynie szybciej), źródło cofnięte pod prąd.
- **Opływ** (nowy efekt lotu, `hyperFlow.js`): przezroczysta refrakcja (warstwa DIST) przypięta do statku — warstwa
  przyścienna wzdłuż burt (grubieje od dzioba ku rufie, wnętrze kadłuba ostre), kilwater za rufą i długa struga gorącego
  powietrza z każdej dyszy MAIN (~0,5 L). Pasma szumu wydłużone wzdłuż kursu płyną ku rufie z prędkością rosnącą
  z prędkością lotu. Siła: rozruch — tylko struga z dysz (25%), lot — otoczka rośnie z prędkością prowadzoną, wyjście —
  gaśnie w 1,1 s. Amplituda w px zależy od rozmiaru kadłuba / dyszy na ekranie, z dolną granicą (widać przy dalekim zoomie).

A/B całego dawnego obrazu: `?hcStary=1` (koła, plazma, haze dysz, bez opływu). Wstrząsy i kamera — bez A/B (strona gry).

## 3. Koszt

Opływ: jeden rysunek (otoczka + do 12 strug dysz — instancje), pass DIST tylko w hipercruisie gracza (poza nim pomijany
— zero kosztu). Gorące powietrze dysz: te same 5 źródeł „uber”, większy stożek = więcej kafli 32 × 32 z bitem źródła.
Pomiar w grze — § 4.

## 4. Weryfikacja

(uzupełniane po przebiegach w grze)
