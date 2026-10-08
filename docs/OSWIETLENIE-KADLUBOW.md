# Oświetlenie kadłubów v2 („realistyczne”, 2026-10-06)

Zgłoszenie użytkownika: „sprawdź, jak światła oświetlają statki — nie podoba mi się. Statki są po prostu
białe; trzeba to poprawić i dodać realne, ładne oświetlenie statków AAA”.

## Diagnoza (zrzuty z gry, A/B na tej samej klatce)

1. **Kadłub był płaską naklejką.** Słońce gry leży w płaszczyźnie (`uLightDir = (dx, dy, 600)` przy setkach
   tysięcy j.), a sprite nie miał normalnych — tylko „poduszkę” z uv (nachylenie ≤ 24°). N·L ≈ 0 na całym
   pokładzie, jasność robiło stałe otoczenie 0,24 + granatowy nalot lakieru. Jasne kadłuby (Terra Nova)
   wychodziły płasko białe, bez bryły.
2. **W walce kadłuby bielały.** Światła efektów (siatka świateł — błyski luf, trafienia, wybuchy: moc 6–18,
   zasięg 200–1100 j.) liczyły się zanikiem pola gry `win² / (1 + 4x²)` z „zawiniętym” Lambertem — kałuża
   światła ~0,7 zasięgu wychodziła biała; błysk lufy przy Terra Nova zalewał pół okrętu.
3. **Lampy były płaskimi plamami.** Lampy pozycyjne i reflektory dokładały do koloru stałą barwę (bez albedo
   i normalnych) — czerwone i białe krążki zamiast światła na blasze.
4. Wieżyczki (kanwa 2D) nie znały cienia planety — w nocy jasne naklejki na czarnym kadłubie.

## Model v2

| Część | Gdzie | Co robi |
|---|---|---|
| Mapa powierzchni | `src/3d/hullSurfaceBake.js` (czysta), `hullSurface.js` (kolejka, worker `hullSurfaceWorker.js`) | Raz na obraz sprite'a: normalne (kopuła z rozmytej alfy + faza sylwetki + relief paneli z jasności normalizowanej alfą + ziarno), AO wnęk, relief do samocienia. RGBA8 z mipmapami, dłuższy bok ≤ 1536. Wypiek w workerze (~0,3 s Atlas), wysyłka w wolnej chwili; do tego czasu mapa płaska. Kadłub gracza — z góry na ekranie ładowania. |
| Klucz (słońce) | `hullLighting.tsl.js` `hullPbrSun` | Azymut prawdziwego słońca, podniesiony o `keyElevDeg` (30°, jak „słońce odblasków” lakieru), ciepła biel; maska słońca Core3D × **samocień** reliefu (marsz 6 próbek ku słońcu, gaśnie przy dalekim zoomie). |
| Niebo + wypełnienie | j.w. | Półkula (zenit chłodny, horyzont ciepły) × AO; słaby chłodny odblask z przeciwnego azymutu. Strona cienia ciemna, ale z kształtem. |
| Połysk | `hullGgx` | GGX + Smith + Schlick (F0 0,04), szorstkość farby 0,42; osmalona blacha (mapa ran) matowieje. |
| Lampy kadłuba | pętla lamp w `hexShips3D.tsl.js` | Światło punktowe nad blachą (N·L z normalnymi paneli, zanik ~1/d² w oknie zasięgu, GGX); żarówka = mały rdzeń (blask rysują billboardy FG). Lampy pozycyjne — pełna kałuża, własne reflektory bez stożka × 0,3, szperacze ze stożkiem × 0,45. |
| Światła efektów | `hullEffectLightingPbr` | Ten sam BRDF. **Błyski** (moc/zasięg ≥ ~0,008: lufy, trafienia, wybuchy, pociski) — zanik skupiony do jądra (`effectCore` 0,16 zasięgu) i mnożnik 0,45; **światła pola** (światło dookoła okrętu, reflektory w pasie) — dawny zanik i mnożnik. |
| Poświata dysz | `pushEngineHullLights` (`hexShips3D.js`) | Gromada dysz MAIN z `EngineFrame` = światło punktowe za wylotem barwą palety — rufa świeci przy ciągu. |
| Wieżyczki 2D | `turret2D.js` (`lightAt`), `Core3D.sunVisibilityAtWorld` | Czarna sylwetka z alfą (1 − jasność) w cieniu planety i w głębi pola asteroid (lustro CPU maski słońca). `ctx.filter` odpada: ~4,6 ms na drawImage. |
| Lakier | `hexShips3D.tsl.js` (blok LAKIER) | Bez zmian, tylko rozmyte odbicie (granatowy nalot) × 0,35 w v2 — model ma własne niebo. |

Koszt GPU (bitwa ~19 okrętów, 1080p, RTX): +0,02–0,2 ms na klatkę; nowych passów, rysunków ani pipeline'ów
synchronicznych brak (przełącznik modelu to uniform).

## Strojenie i przełączniki

- Menu → Grafika → **Oświetlenie kadłubów**: Realistyczne / Klasyczne (`sc_hull_light`).
- Konsola: `HullLighting.setModel('classic' | 'pbr')`, strojenie na żywo `window.__hullLightTune`
  (`keyElevDeg`, `keyIntensity`, `skyIntensity`, `fillIntensity`, `roughness`, `specular`, `selfShadow`,
  `lampGain`, `lampFalloff`, `effectGain`, `effectCore`, `engineGain`, `turretNight`, `lacquerSheen`…),
  podgląd diagnostyczny `__hullLightTune.debug = 1..5` (normalne, AO, samocień, sam klucz, relief).
- Wypiek: `HullSurface.rebakeAll({ mesoGain: 10, domeTiltDeg: 30, … })` (parametry `HULL_SURFACE_DEFAULTS`).

## Narzędzia i testy

- `node scripts/webgpu/oswietlenie-gra.mjs [--sceny statyka,silnik,blyski,bitwa,noc] [--tune '{…}'] [--bake '{…}']`
  — A/B pbr / classic na tej samej klatce, histogram HDR, pipeline'y synchroniczne (ma nie być materiału kadłuba).
- `tests/hullSurfaceBake.test.mjs` (wypiek), `tests/hullLighting.test.mjs` (lustra CPU BRDF i zaników, klasyfikacja
  błysków, WGSL, cień planety na CPU, wieżyczki), `tests/hexShips3DShader.test.mjs` (wiązania tekstur).

## Otwarte

- Modele „Statki 3D” mają własne materiały PBR (mapa otoczenia z zaszytą ciepłą stroną, bez siatki świateł) —
  do ujednolicenia z v2, jeśli będą używane.
- Cienie wieżyczek 2D na kadłubie (przesunięta sylwetka od słońca) — tani i mocny efekt bryły, koszt drawImage.
- Odblask planety (błękitne wypełnienie od dziennej strony Ziemi przy porcie).
