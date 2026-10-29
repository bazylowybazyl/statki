---
paths:
  - "src/3d/warp/warpEdgeFx.js"
  - "tests/warpEdgeFx.test.mjs"
---

# Warp gracza: efekty boków kadru (W1–W3)

> Reguła obszaru (wydzielona z reguły `warp` 2026-10-29 — limit rozmiaru). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Skok, soczewka świata i warp „Nurt” — reguła `warp`; kadr skoku i kadr lotu — `kamera`; warstwa DIST — `core3d`. Nową wiedzę o efektach skoku dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i pomiary — do `docs/` (`docs/PROPOZYCJA-efekty-warpa-2026-10-29.md`, `docs/WARP-kadr-lotu-2026-10-29.md`).

## Boki kadru w skoku gracza

- PRZEPŁYW RÓWNOLEGŁY DO KURSU (2026-10-29; `src/3d/warp/warpEdgeFx.js`, sterownik `warpNurt.js: _commitEdge`; user o pierwszej
  wersji: „statek leci do góry, a wszystkie efekty są stworzone tak, jakby leciał w głąb ekranu”): efekty płyną przeciw kursowi
  w osiach ekranu (z obrotem kadru), bez punktu zbiegu i bez zależności od mapy O1 (`hf` zmienia `?warpSoczewka=` — reguła
  `warp`). Nie wracaj do współrzędnych biegunowych wokół punktu zbiegu ani smug zbiegających do niego.
- W1 HAZE — warstwa DIST (RG w px, B = A = 0): pasma wydłużone wzdłuż kursu, drżenie głównie w poprzek. GŁADKO — gradient
  przesunięcia w poprzek ≪ 1: duże komórki i poziom mip +3 (drobne dawały „deszcz na szybie”: gwiazdy rozmazane w poziome
  kreski z tęczą, obraz zawinięty w fałdy), przy samej krawędzi kadru przesunięcie gaśnie (próbka spoza kadru — pasek „kodu
  kreskowego”). Lustro CPU fragmentu w teście pilnuje braku fałd.
- W2 DROBINY — smugi równoległe do kursu w trzech warstwach paralaksy (daleka krótka i wolna, bliska długa i szybka), gęściej
  przy bokach, pass tła przy dalekiej płaszczyźnie (pod planetami). W3 ZORZA — pasma przy krawędziach, pass tła, tylko
  z adresu.
- WSPÓLNE: `warpEdgeLayout` (kurs, oś przez statek, czysta kolumna z szerokości kadłuba na ekranie przy zoomie TEJ klatki —
  kamera odsuwa się po kopie, reguła `kamera`, KADR LOTU), maska `warpEdgeSideMask` (kolumna, front wyjścia smug gwiazd), FAZY
  całkowane na CPU (`warpEdgePhaseStep`, limit aliasingu — nie czas × prędkość w shaderze), obwiednia `warpEdgeEnvelope`
  (hipercruise, podzielony ekran i kamery bez soczewki — 0). Pozycje liczy shader z uniformów ekranu — siatki nie zmieniają
  `position` w kroku efektów (macierze sceny Core3D synchronizuje PRZED krokami `Core3D.fx`).
- KADR W POPRZEK KURSU: kolumna (`clear`) i zasięg drobin w poprzek (`reach` = lExt + |lAxis| → `U.dustReach`) liczą się
  z rzutu kadru na poprzeczną kursu (2 · lExt), nie z szerokości ekranu — w trybie kamery „Północ” (bez obrotu kadru) przy
  kursie wschód–zachód w poprzek leży wysokość ekranu (na 32:9 z szerokości widać było ~2% smug, a haze tylko w pasach
  ~300 px). R (pół większego boku) służy TYLKO zawijaniu drobin wzdłuż kursu (nie zależy od kąta kursu). Gęstość smug
  w kadrze zależy od proporcji i kierunku kursu (32:9 przy kursie w górę — ~¼ smug w kadrze) — strojenie, nie wyrównana.
- FAZY W PX BUFORA: zmiana skali renderu w locie (rozdzielczość dynamiczna `Core3D.setRenderScale`, DPR, okno) przeskalowuje
  fazy przed krokiem — haze i zorza z wysokością kadru (kafelki ∝ H), drobiny z rozpiętością zawijania 2 · (R + 0,4 H)
  (`_phH`, `_phSpan`, zerowane w `off()`); inaczej wzór skacze w jednej klatce (5120 × 1440, skala 1 → 0,85: ~0,6–0,7
  okresu). Nowa faza efektu w px — to samo.
- Warstwę DIST zgłasza krok `Core3D.fx` „warp: boki kadru” (nie `WarpNurt.update` — flagę kasuje klatka efektów).
  Przełącznik `?warpFx=0|haze|czastki|zorza|wszystko` (domyślnie W1 + W2), strojenie `WarpNurt.edge.tune` (tryb
  `?renderWorker=0`). Decyzje D1–D7 (zestaw, siła haze, smugi pod / nad planetami, gęstość, kolumna, W4–W9, presety grafiki)
  — w propozycji. Test `tests/warpEdgeFx.test.mjs`; zrzuty `node scripts/webgpu/warp-ped-gra.mjs [--query warpFx=0]`, koszt
  `--koszt 1` (ABAB z `warpFx=0`).
