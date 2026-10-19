---
paths:
  - "src/3d/hullLighting*.js"
  - "src/3d/hullSurface*.js"
---

# Oświetlenie kadłubów v2 (PBR sprite'ów, mapa powierzchni)

> Reguła obszaru (podział AGENTS.md, 2026-10-19). Claude Code wczytuje ją sam, gdy czytasz albo edytujesz plik pasujący do `paths`. Zasady przekrojowe i indeks reguł: `AGENTS.md`. Odnośnik „§ X” = nagłówek sekcji w tej albo innej regule (`grep -rn "## X" .claude/rules`). Nową wiedzę o obszarze dopisuj tutaj: stan i zasady w czasie teraźniejszym, historię i wyniki pomiarów — do `docs/`.

## Pliki obszaru (z mapy repozytorium)

- **`src/3d/hullLighting.js`, `hullLighting.tsl.js`, `hullSurface.js`** — oświetlenie kadłubów v2 (model PBR sprite'ów, mapa powierzchni ze sprite'a w workerze, lampy i błyski jako światła na blasze). Opis: § „Oświetlenie kadłubów v2” niżej, `docs/OSWIETLENIE-KADLUBOW.md`.

## Oświetlenie kadłubów v2 (2026-10-06; `src/3d/hullLighting.js`, `hullLighting.tsl.js`, `hullSurface.js`; opis `docs/OSWIETLENIE-KADLUBOW.md`)

- Zgłoszenie użytkownika: „statki są po prostu białe — dodaj realne, ładne oświetlenie AAA”. Model „realistyczny” (domyślny; menu Grafika → Oświetlenie kadłubów, `sc_hull_light`; konsola `HullLighting.setModel('classic' | 'pbr')`) — klasyczny zostaje w tym samym grafie za uniformem (A/B bez rekompilacji).

- MAPA POWIERZCHNI ze sprite'a (`hullSurfaceBake.js` — czysta, worker `hullSurfaceWorker.js`, kolejka `HullSurface` — obiekt `{ value }` na obraz z licznikiem referencji, jak mapa kształtu lakieru): normalne (kopuła z alfy, faza sylwetki, relief paneli z jasności NORMALIZOWANEJ alfą — pustka nie robi obwódki), AO, relief do samocienia; RGBA8 z mipmapami, wysyłka w wolnej chwili. Kadłub gracza piecze ekran ładowania, NPC — spawn (`prewarmHexShipVisual`). Nowy obraz kadłuba = nic do zrobienia (wypiek sam).

- SHADER (`hexShips3D.tsl.js`, gałąź `pbr`): klucz = azymut słońca podniesiony o `keyElevDeg` (30°), maska słońca × samocień reliefu; niebo (półkula) × AO; wypełnienie z przeciwnego azymutu; GGX (`hullGgx` — czysta funkcja z layoutem). LAMPY = światła nad blachą (N·L, ~1/d²), żarówka mały rdzeń. ŚWIATŁA EFEKTÓW (`hullEffectLightingPbr`): błyski (moc/zasięg ≥ ~0,008) — zanik skupiony do jądra i mnożnik 0,45 (dawniej kałuża ~0,7 zasięgu bieliła kadłub w walce), światła pola (światło dookoła okrętu, reflektory w pasie) — po staremu. Poświata dysz MAIN = światło w siatce z `EngineFrame` (`pushEngineHullLights`). Nowe światło na kadłubie — przez siatkę (`Core3D.fx.lights`), nie nowa pętla w shaderze.

- Wieże broni są 3D (B3D, 2026-10-15) i ciemnieją w cieniu planety i w głębi pola przez maskę słońca materiału wież; dawne ciemnienie wieżyczek kanwy (`Turret2D.lightAt`, `turretNight`) usunięte. `Core3D.sunVisibilityAtWorld` (lustro CPU tarcz maski i pola pasa `Core3D.sunFieldCpu`) zostaje jako diagnostyka narzędzi.

- Strojenie `window.__hullLightTune` (`debug` 1–5: normalne, AO, samocień, klucz, relief), wypiek `HullSurface.rebakeAll({...})`. A/B w grze: `node scripts/webgpu/oswietlenie-gra.mjs`; testy `tests/hullLighting.test.mjs`, `tests/hullSurfaceBake.test.mjs`. „Statki 3D” (modele) mają własne materiały — v2 ich nie dotyczy.
