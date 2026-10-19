---
paths:
  - "src/3d/skybake/**"
  - "src/3d/skyStars.tsl.js"
  - "src/game/skyRegion.js"
  - "dema/niebo-webgpu.html"
  - "scripts/webgpu/niebo-*.mjs"
---

# Wypiekacz nieba i tło kosmosu

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/skybake/`** — WYPIEKACZ NIEBA (tło kosmosu liczone raz, nie co klatkę): `SkyBaker` (passy pełnoekranowe, cele pomocnicze `size`, ciężkie passy w pasach `strips`) + style: „galaktyka” (pas Drogi Mlecznej) i „mgławica” (2026-10-06, krok 3: prawdziwa objętość 3D — marsz promienia przez płytę w 8 pasach, samocień z atlasu objętości światła + cień bliski z detalem, HG, emisja Hα / O III z frontem jonizacji, ciemny pył z przodu; nastawa `gra` = lampy w płycie, gaz gęsty, bez gwiazd; `kolorowa` = lampy i masy w barwach palety `paleta1…4` + trzecie pasmo emisji `barwaZewn` — kandydaci w `.tmp/niebo/`; domyślnym tłem gry zostaje wypiek „galaktyka” — decyzja użytkownika 2026-10-11), pole gwiazd wspólne (`skyBakeStars.js`), tekstura zapisywana po odwróceniu ACES gry (w grze wygląda jak na podglądzie). Narzędzie `dema/niebo-webgpu.html`, pętla `scripts/webgpu/niebo-arkusz.mjs`, test w grze `niebo-gra.mjs`. Kafle (wycinek nieba w dowolnej gęstości: `SkyBaker.setRegion`, atlas pożyczony od wypiekacza bazowego — `shared`, `extraOctaves`) i widok A/B 1:1 w demie (`scripts/webgpu/niebo-ab.mjs`) — 2026-10-06 zmierzone: przy obecnych stylach kafle w gęstości ekranu prawie nic nie dają (treść gładsza niż piksel 4K). Tło gry = `public/assets/nebula.webp` z wypiekacza, BEZ gwiazd, bezstratny WebP (dawne `nebula.png` było cudzą grafiką); gwiazdy tła rysuje gra w rozdzielczości ekranu (`src/3d/skyStars.tsl.js` — w materiale mgławicy i w płacie mgławicy menu; gwiazdy wypieczone w tekselach przy powiększeniu 1,7–3,5× wychodziły rozlane; PAMIĘĆ NIEBA 2026-10-17 — mgławica z gwiazdami liczona raz do celu HalfFloat i czytana, póki kadr nie przesunie się o ≥ 0,25 px: `NebulaSystem.skyCacheHook` w `planet3d.assets.js`, zgięcie warpa i rulon — na piksel, A/B `Core3D.skyCacheEnabled = false`); jasność tła wg strefy gry (`src/game/skyRegion.js`: pas asteroid ciemniej, pusta przestrzeń jaśniej — mnożnik obrazu wyświetlanego w `createNebulaMaterial`, `window.setSkyZone` przed `updatePlanets3D`). Opis, geometria kadru tła (gra widzi ~620 wierszy tekstury, 1,74× przy 1080p) i zadanie kroku 3: `docs/webgpu/WYPIEK-NIEBA.md`.
