# Zadanie 22 — Warp „Nurt” z dema `warp-webgpu` w grze (ładowanie, skok, podróż, wyjście, przylot i odlot NPC)
Zależności: 12, 13 + zakończona sesja dema warpa (poprawiony „Nurt”, commit na `main`) | Równolegle z: 14–21 (bez zmian w `src/3d/fx/`) | Zalecany effort: max
Zakres: moduły dema `dema/warp-webgpu/` (opis: `docs/webgpu/DEMO-WARP.md`, w tym „Jak to wejdzie do gry” i ewentualna
notatka integracyjna sesji) → gra (`src/3d/warp/`): `medium.js` (ośrodek: compute, render smug), `stars.js` (płaskie
rozciąganie i front — do `StarSystem` gry po 05), `sky.js` (soczewka mgławicy — do `NebulaSystem`), `hulls.js`
(odsłanianie, szew, żar brzegu — do materiału kadłuba po 04), `glow.js`, `post.js` (fale, soczewka tła — do „uber” /
zniekształceń z 12); gra: `src/game/warpDrive.js` (automat warpa gracza i NPC — źródło zdarzeń), `planWarpFleetArrival`,
`GameState.warp`, plazma WARP z dysz (`warpPlume3D.js`, 13), API warpa w Core3D (no-opy z 01 — `setWarpLensWorld`,
`setWarpViewWorld`, `pushWarpSpaceWorld`, `pushWarpWaveWorld`, `setWarpStarsObject`, `suppressShadowShafts`) i miejsce
„pass zgięcia tła” w `Core3D.render()`.

## Cel
Decyzja użytkownika 2026-09-27: „warp — też będzie ready do wgrania, jak skończy sesję” (sesja dopracowuje „Nurt”: lot
dobry, ładowanie i wyjście miały dostać lepszy feel „portalu”). Skok gracza, przyloty i odloty NPC, wezwania floty
wyglądają jak w demie po poprawkach; rozgrywka warpa bez zmian (biegi, czasy, `warpDrive.js`).

## Przeczytaj najpierw
`agents.md` (Core3D: warstwy 8/9, dawna soczewka — czego nie powtarzać: „jajko” z wycinania maską), `docs/webgpu/DEMO-WARP.md`
w całości (technika, pułapki: cienka powłoka = świecący obrys, gęstość, wyrzut zalewający ekran), `docs/BRIEF-warp.md`,
memory: przebudowa warpa, warp „Nurt”, soczewka skoku, styl fal (sama refrakcja), `docs/webgpu/POSTEP.md` (wyniki 01, 05,
12, 13), `src/game/warpDrive.js`, `dema/warp-webgpu.js` + moduły.

## Kroki
1. **Stan dema:** commit sesji warpa na `main`, jej notatka integracyjna (odpowiedzi na „Otwarte pytania do usera” w
   `DEMO-WARP.md` — jeśli brak, efekt zostaje czysto wizualny: wyrzut bez obrażeń, nić zwiastuna bez radaru).
2. **Ośrodek** jako system compute w Core3D (krok z 12), aktywny tylko przy bańkach w pobliżu kadru (bez baniek — ani
   kroku, ani draw calla); kotwica = początek przy kamerze; krok stały 1/240 s z dosuwaniem w renderze (jak w demie).
3. **Bańki** zgłasza `warpDrive.js` (gracz i NPC: ładowanie, skok, podróż, wyjście, przylot, odlot) — do 16 naraz; nić
   zwiastuna z `planWarpFleetArrival`.
4. **Gwiazdy i niebo:** rozciąganie płaskie i front w `StarSystem` (05); soczewka mgławicy w `NebulaSystem`; pass zgięcia
   tła w miejscu z 01 (zaraz po passie tła, przed planetami); fale = refrakcja przez zniekształcenia z 12.
5. **Kadłub:** odsłanianie frontem, szew, żar brzegu z pola odległości sylwetki (`hullShadowSdf.js` / SDF kadłubów) jako
   uniformy materiału kadłuba (04); plazma WARP z `warpPlume3D` (13) w barwach palety gry.
6. **API Core3D warpa:** zamiast no-opów — nowe wejścia (albo usunięcie starych nazw i wywołań w grze, jeśli nowe API jest
   prostsze — opisz); testy `warpDrive`, `warpSpace`, `warpWorldLens` (matematyka CPU) przepnij albo usuń razem ze starym
   modułem.
7. **Harness:** scena `warp` (ładowanie gracza) + nowe: skok, przylot NPC z zewnątrz — obok zrzutów dema; baza przyszłych
   porównań = zatwierdzony przebieg z `main`.

## Pułapki
- Wszystko z „Pułapek” dema: bez świecących okręgów i obrysów; wyrzut narasta 0,18 s (inaczej bloom na cały ekran);
  mgiełka z migawką ×0,15; kometa z zewnątrz ×0,55 wzbudzenia.
- Przepływ ośrodka w podróży to prędkość WIDOCZNA (bieg I 16 tys., II 21 tys. j/s), nie prawdziwa prędkość warpa.
- Pula znaczników czasu — przy długich przewinięciach wyłączaj pomiar (demo).
- Nie przywracaj starej soczewki warpa ani wycinania statku maską („jajko”).

## Kryteria akceptacji
- `npm test` i `node --test "tests/*.test.mjs"`: bez nowych porażek (testy starego warpa opisane).
- Harness: zero błędów walidacji; skok, przylot, odlot obok dema; poza warpem koszt ośrodka = 0 (brak kroku i draw calla).
- W kodzie gry nie ma starej soczewki (`warpLens3D`, `warpWorldLens`, `warpFx3D`, `warpLensPass` — chyba że coś nadal ich
  potrzebuje; opisz); `agents.md` (warp: gdzie bańki, ośrodek, pass zgięcia); commit.

## Czego NIE robić
- Nie zmieniaj rozgrywki warpa (biegi, czasy, koszty, automat) ani logiki przylotu NPC.
- Nie edytuj dema.

## Raport na koniec
Co zrobione; zrzuty skoku / przylotu / odlotu obok dema; koszt GPU w skoku i poza nim; pytania.
