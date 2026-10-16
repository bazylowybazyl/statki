# rw-worker — stan na 2026-10-16 (dla powrotu po kompakcji / następnej sesji)

W main (po kolei): 8cffc9d5 / e4dd955c RW-40a; 9c09945e RW-40b cz. 1 (bramka 1,62×); cz. 2 planety; 81c68a61 cz. 3 pył;
a596afb8 cz. 4 rakiety; c547ebc0 cz. 5 ringi; 276e6af2 cz. 6 pył hal; 6b167b8c cz. 7 warp; a37cf9b9 cz. 8 widok + zimne
wraki; 7793f40f cz. 9 Destruction3D; cz. 10 split + CIC; 4f3141f2 split naprawiony + scripts/webgpu/render-worker-gra.mjs; aab11c53 cz. 11 komety; cd84576d cz. 12 baza piratów (zdarzenia obrazu → worker) + MGŁA WOJNY (świat mgły w wiadomości klatki); 0f399b9a RW-41b cz. 1 pas (zastępnik świata pasa w workerze: beltOp / beltOcc / beltGiant).
Opis: docs/PLAN-render-worker.md — Stan RW-40, RW-40a, RW-40b cz. 1–10, RW-42 (część 1).

## Jak to jest zbudowane
- `src/render/renderBridge.js` — tryb z adresu (`?renderWorker=1` → worker, zapas inline z powodem).
- `index.html`: `SZEW_MODE` z `resolveRenderMode`, `RW_WORKER`, `SZEW_LATE` (pakowanie jak inline, faza begin tuż przed
  kadłubami). Bloki migawki tylko w worker: `rockets` (src/render/blocks/rocketBlock.js), `view`
  (src/render/blocks/viewBlock.js; `_snapFrame.viewList = renderEntities` przed begin). W `render()` gałęzie
  `if (!RW_WORKER)` przy modułach 3D; `rwHost.syncPlanets(...)`, `dustOn`, `ringQuality`; `rwHost.postFrame()` po
  `renderSnapshot.finish`; `rwHost.commitOverlay(k)` na końcu `render()`.
- `src/render/renderWorkerHost.js` — strona: worker, RET, pierścień rozkazów na SAB (przełączany przy starcie, napisy
  od nowa, strona bez dyspozytora); wiadomości `layout`, `frame` (k, evFrame, opisy — odkładane, gdy obraz kadłuba się
  wczytuje (`_pendDesc`), topologie, rdzenie, stacje, słownik, zasoby ImageBitmap z limitem 3 s, definicje broni rakiet,
  skyZone, dust, ringQuality), `planets` (plainData ciał), `cmdRing`; łańcuch obietnic z catch (błąd nie zatrzymuje
  łańcucha); kompozycja B2cr (OverlayRing, 5 kanw; `#c` opacity 0; kanwa strony `#webgl-layer` ukryta po 1. złożeniu).
- `src/render/render.worker.js` — podkładki (window, innerWidth, rIC, fetch względem strony `pageBase`), RenderWorld
  przed modułami, Core3D na OffscreenCanvas; RenderMirror + pociski-lustra (SHOTS) + wieże (TURRETS) + rakiety (blok)
  + widok (blok view → `__inDrawBox`, `_coldDrawFrame`), czytelnik rozkazów (broń, mapa ran, wybuchy, rakiety, warp;
  `entityAt` szuka też stacji); kolejność klatki: SimClock z HEAD → shots/turrets/rockets → drain(evFrame strony) →
  syncCamera → warp → planety → ringi (+ blok ring) → pył hal → pył kosmiczny → stacje → mostki → Destruction3D →
  kadłuby (+ zimne) → modele → tarcze → reaktor (syncCores) → render (split: dwa widoki na kanwie 2D; CIC: pusta).
- Narzędzia: `zrzuty.mjs --query renderWorker=1` (zrzuty działają; statystyki dc/GPU w raporcie są ze strony —
  nieaktualne); `scripts/webgpu/render-worker-gra.mjs --start single|split --czas N` (stan hosta, logi workera).
  `render-worker-gra.mjs --js plik.js --tag x` — wyrażenie po starcie gry (czeka na > 60 złożeń; kamera nadpisuje
  zoom ustawiony w wyrażeniu). Pomiar: `profil-bitwy-flot.mjs ... --zdarzenia` z `RenderWorkerHost.composed` (obraz 3D = złożenia / s).

## Pułapki złapane
- `SnapshotDict` w workerze: obiekt z `value(c)`. Rekordy układu: `SHOT.F64 / I32` (wielkie litery).
- Adresy `assets/…` w workerze względem skryptu workera (Vite oddaje index.html → DOMException) — podmiana `fetch`.
- Łańcuch wiadomości strony stał na `createImageBitmap` niewczytanego obrazu (split, kadłub gracza 2).
- Build: `vite.config.js` `worker.format = 'es'`. Sesja `stacja` harnessu woła funkcje stacji na stronie (RW-44).

## Co zostało
W workerze wyłączone (lista `RW_WORKER_DISABLED` w render.worker.js): stacja piracka (world3d), baza piratów + ciała
świata (worldBodies3D — encje kawałków są obiektami gry; bryła bazy już w workerze), wydobycie (RW-41b cz. 2: taken, ciała), model
reaktora w wyrwie, RX_* rdzeni (hazardAt gry), tło menu (na stronie — RW-41). Luk Atlasa (`scoutBay3D`, `__bayCut`)
też nie jest w workerze. Potem RW-41, RW-41b, RW-44 (odchudzone), RW-36, RW-45.
