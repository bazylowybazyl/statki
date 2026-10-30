---
paths:
  - "src/3d/warp/warpEdgeFx.js"
  - "tests/warpEdgeFx.test.mjs"
  - "src/3d/warp/warpSW.js"
  - "tests/warpSW.test.mjs"
---

# Warp: efekty boków kadru (W1–W3) i prototyp przylotu / wylotu „jak w Gwiezdnych Wojnach” (`?warpSW=1`)

> Reguła obszaru (wydzielona z reguły `warp` 2026-10-29 — limit rozmiaru). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Skok, soczewka świata i warp „Nurt” — reguła `warp`; kadr skoku i kadr lotu — `kamera`; warstwa DIST — `core3d`. Nową wiedzę o efektach skoku dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i pomiary — do `docs/` (`docs/PROPOZYCJA-efekty-warpa-2026-10-29.md`, `docs/WARP-kadr-lotu-2026-10-29.md`).

## Boki kadru w skoku gracza

- PRZEPŁYW RÓWNOLEGŁY DO KURSU (2026-10-29; `src/3d/warp/warpEdgeFx.js`, sterownik `warpNurt.js: _commitEdge`; user o pierwszej
  wersji: „statek leci do góry, a wszystkie efekty są stworzone tak, jakby leciał w głąb ekranu”): efekty płyną przeciw kursowi
  w osiach ekranu (z obrotem kadru), bez punktu zbiegu i bez zależności od mapy O1 (`hf` zmienia `?warpSoczewka=` — reguła
  `warp`). Nie wracaj do współrzędnych biegunowych wokół punktu zbiegu ani smug zbiegających do niego.
- W1 HAZE — warstwa DIST (RG w px, B = A = 0): pasma wydłużone wzdłuż kursu, drżenie głównie w poprzek. GŁADKO — gradient
  przesunięcia w poprzek ≪ 1: duże komórki i poziom mip +3 (drobne dawały „deszcz na szybie”: gwiazdy rozmazane w poziome
  kreski z tęczą, obraz zawinięty w fałdy), przy samej krawędzi kadru przesunięcie gaśnie (próbka spoza kadru — pasek „kodu
  kreskowego”). Lustro CPU fragmentu w teście pilnuje braku fałd. SIŁA 28 px przy krawędzi (user 2026-10-29: „haze wciąż zbyt
  subtelny” — 8 px było niewidoczne; po grze 2026-10-30: „haze OK”): komórki rosną razem z amplitudą (0,4 / 0,16 H), druga
  oktawa 0,3, kop × 1,1 — przy 30 px i komórkach 0,42 / 0,17 H wracają fałdy. Mocniej = większe komórki, nie drobniejsze.
- W2 DROBINY — smugi równoległe do kursu w trzech warstwach paralaksy (daleka krótka i wolna, bliska długa i szybka), gęściej
  przy bokach, pass tła przy dalekiej płaszczyźnie (pod planetami). W3 ZORZA — blada MGŁA boków (pasma przy krawędziach, pass
  tła), domyślnie włączona: sama refrakcja na czarnym tle prawie nie widać — mgła daje jej materię, W1 ją faluje.
- SIŁA Z ADRESU `?warpHaze=<0…4>` (`WarpEdgeFxTune.gain`): mnożnik amplitudy W1 (komórki i poziom mip skalowane z nim —
  gradient bez zmian, bez fałd) i jasności mgły.
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
  Przełącznik `?warpFx=0|haze|czastki|zorza|wszystko` (domyślnie W1 + W2 + W3), strojenie `WarpNurt.edge.tune` (tryb
  `?renderWorker=0`). Decyzje D1–D7 (zestaw, siła haze, smugi pod / nad planetami, gęstość, kolumna, W4–W9, presety grafiki)
  — w propozycji. Test `tests/warpEdgeFx.test.mjs`; zrzuty `node scripts/webgpu/warp-ped-gra.mjs [--query warpFx=0]`, koszt
  `--koszt 1` (ABAB z `warpFx=0`).

## Przylot i wylot „jak w Gwiezdnych Wojnach” — prototyp `?warpSW=1`

- A/B DO OCENY (2026-10-30; user: „a przylot i wylot jak z gwiezdnych wojen? dasz radę?”; `src/3d/warp/warpSW.js`): domyślnie
  wygląd z decyzji 2026-10-03 („BEZ portalu i BEZ smugi, normalnie widoczny statek” — `arrivals.js`). Z przełącznikiem:
  PRZYLOT NPC — w wlocie kadłub ze światła i smuga za rufą (~7 L, ≤ droga od pojawienia się), przy hamowaniu ogon zatrzaskuje
  się w kadłub (≤ 0,2 s), światło gaśnie 0,25 s po hamowaniu; ODLOT NPC — od nurkowania kadłub ze światła i ślad rosnący
  z prędkością, w punkcie skoku smuga wystrzeliwuje do przodu (8 L, gaśnie w 0,35 s), błysk 1 L, kadłub znika w smudze;
  GRACZ — smuga przy kopie (6 L, 0,35 s), szczyt smug gwiazd × 2,2 / 1,4, przy hamowaniu przylotu smuga zatrzaskuje się
  w tej samej chwili co błysk (PRZYLOT = JEDNO ZDARZENIE, reguła `warp`); tylko warp i kamera z góry jednego gracza.
- BEZ NOWYCH PIPELINE'ÓW I PÓL MIGAWKI: smugi = kształt `GLOW_STREAK` duszków „Nurtu” (`frame.addStreak`, pula 64, odcinanie
  do kadru przy zgłoszeniu — pudło ustawia sterownik po `frame.reset()`), kadłub ze światła = szew `hullWarp` szerszy niż
  kadłub w trybie −1 z linią przed dziobem (`warpSWHullLight`, bez zmiany WGSL), osie z rejestru gry (blok migawki `warp`).
  Smuga i światło encji ukrytej się nie rysują — mgła wojny i soczewka skoku (`isEntityHiddenForRender`, ten sam predykat
  co skóra kadłuba), maskowanie (`__cloakLook.vis`). Rozgrywka bez zmian; nowych faz nie wiąż z `__warpNurtMode`.
- Strojenie `WARP_SW`, test `tests/warpSW.test.mjs`; zrzuty `node scripts/webgpu/zrzuty.mjs --backend webgpu --sceny
  warp-zwiastun,warp-przylot,warp-odlot-ladowanie,warp-odlot [--query warpSW=1]`, gracz — `warp-ped-gra.mjs` (faza
  `02a-kop-szczyt`), floty — `wojna-gra.mjs`.
