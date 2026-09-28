# Demo WebGPU: tarcza nowej generacji (dema/tarcza-webgpu.html)

Samodzielne demo na `WebGPURenderer` + TSL pod Vite (`npm run dev`, strona
`/dema/tarcza-webgpu.html`). Nie dotyka gry ani `Core3D`; z kodu gry importuje tylko
`shieldSystem.js` (stany, czasy, obrys, trafienia). Wygląd i wydajność ocenia się
na prawdziwym GPU; w kontenerze działa sprawdzanie poprawności (SwiftShader, §8).

## Pliki

| Plik | Co robi |
|---|---|
| `dema/tarcza-webgpu.js` | renderer, kamera, pętla (`?test=1` + `__demo.step`), wejście, panel, `window.__demo` |
| `dema/tarcza-webgpu/tarcza.js` | most `shieldSystem.js` ↔ render: encja, trafienia (`registerShieldImpact`), faza „niewidzialnego pola”, zdarzenia pola, światła trafień, wiązka, iskry z pancerza |
| `dema/tarcza-webgpu/pole.js` | stan pola w compute: siatka kartezjańska, fala (h, v), energia E, przebicie B, obwiednia fali W, tekstura rgba16f, mapa przebić 64×64 dla CPU |
| `dema/tarcza-webgpu/czasza.js` | geometria czaszy z profilu (384 × 24), materiał „jak dziś w grze” (port `HULL_SHIELD_FRAGMENT`, tryb B), nowy materiał z pola (tryb A) z załamaniem |
| `dema/tarcza-webgpu/iskry.js` | iskry w compute ślizgające się po czaszy (pula 64 tys.) |
| `dema/tarcza-webgpu/odlamki.js` | pęknięcie: heksy z czaszy w compute |
| `dema/tarcza-webgpu/bronie.js` | PD, laser, torpeda, wiązka, salwy, ogień wrogów, kolizje w płaszczyźnie gry |
| `dema/tarcza-webgpu/zderzenie.js` | tarcza w tarczę (K) |
| `dema/tarcza-webgpu/kadlub.js`, `wrogowie.js`, `tlo.js`, `wspolne.js` | Atlas ze sprite'a (heksy z alfy co 12 px, normalna z luminancji), okręty z brył, niebo, światła i szumy |
| `scripts/tarcza-webgpu-dym.mjs` | skrypt sprawdzający (Playwright + SwiftShader, zrzuty do `.tmp/tarcza/`) |

## Ustalenia

- **Klatka lokalna 3D tarczy:** x wzdłuż kadłuba, y = −y gry, z w górę; grupa w świecie
  na (x, −y), obrót −kąt (jak Core3D). Siatka pola, czasza i kwad kadłuba są w tej samej
  klatce; `?debug=pole` pokazuje izolinie t siatki i czaszy oraz znacznik w dziobie
  w trzech miejscach (kadłub, czasza, pole) — muszą być współśrodkowe.
- **Tekstura pola** (StorageTexture): wiersz j = v j/H, bez odwracania v (§9.5).
- **Fala:** h = 0 poza obrysem i w przebiciu (odbicie od obu), podkroki stałe ≤ 1/240 s
  i z warunku CFL (Courant 0,5), parami (ping-pong A→B→A), do 32 na klatkę.
- **Energia:** dyfuzja jako rozmycie gaussowskie σ² = 2·D·dt (dokładne, stabilne przy każdej
  siatce), brzeg bez przepływu, stygnięcie exp(−dt/τ).
- **Załamanie:** jeden bazowy `viewportTexture()` i próbki przez `.sample(uv)` — klony dzielą
  teksturę bazowego węzła, więc kopia bufora ramki jest jedna na render. Każde osobne
  `viewportSharedTexture()` kopiuje obraz od nowa (klucz aktualizacji = węzeł).
- **Mieszanie czaszy:** `rgb + tło·(1 − a)` (CustomBlending One / OneMinusSrcAlpha) —
  a = 0 to czysta emisja, a > 0 zastępuje tło obrazem załamanym. Nie `premultipliedAlpha`
  (materiał sam mnożyłby rgb przez a).
- **WGSL:** żadnego `smoothstep` z odwróconymi krawędziami (dla stałych Tint odrzuca shader) —
  `1 − smoothstep(b, a, x)`; nazwy funkcji `setLayout` tylko ASCII (nazwa z „ó” wywraca
  budowanie: „Function is not a WGSL code”).
- **Klatki bez pętli animacji:** `pass` i `BloomNode` odświeżają się raz na klatkę węzłów
  (`NodeFrame.frameId`), którą liczy pętla `setAnimationLoop`. Pod `?test=1` pętla rAF
  zostaje, ale klatka dema idzie tylko z `__demo.step(n)`.
