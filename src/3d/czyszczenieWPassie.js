// src/3d/czyszczenieWPassie.js
//
// Render z czyszczeniem celu W TYM SAMYM passie GPU (loadOp „clear” zamiast osobnego renderer.clear()). three r183
// robi z clear() OSOBNY pass z własnym zgłoszeniem (i rozwiązaniem MSAA całego celu, gdy cel ma próbki), a render po
// nim wczytuje cel z powrotem (loadOp „load”) — przy 5120 × 1440 to pełny zapis i odczyt celu. Ten sam obraz: ten sam
// kolor czyszczenia (renderer.setClearColor przed wywołaniem), te same kanały. Passy sceny Core3D (2026-10-29, reguła
// `core3d`, „CZYSZCZENIE W PASSIE”), od 2026-11-02 także cele pomocnicze w klatce: warstwa DIST i mapa gęstości dymu
// rakiet (src/3d/rockets/smoke.js).

/** A/B celów pomocniczych (DIST, gęstość dymu rakiet): false — dawne renderer.clear() + render(). */
export const CZYSZCZENIE_AB = { pomocnicze: true };

/**
 * renderer.render(scene, camera) z czyszczeniem kanałów `color` / `depth` / `stencil` w tym samym passie: autoClear na
 * czas jednego render() — stan renderera wraca także przy błędzie.
 */
export function renderCzyszczac(renderer, scene, camera, color, depth, stencil) {
  const a0 = renderer.autoClear, ac = renderer.autoClearColor, ad = renderer.autoClearDepth, as = renderer.autoClearStencil;
  renderer.autoClear = true;
  renderer.autoClearColor = color;
  renderer.autoClearDepth = depth;
  renderer.autoClearStencil = stencil;
  try {
    renderer.render(scene, camera);
  } finally {
    renderer.autoClear = a0;
    renderer.autoClearColor = ac;
    renderer.autoClearDepth = ad;
    renderer.autoClearStencil = as;
  }
}
