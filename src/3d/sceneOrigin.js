// src/3d/sceneOrigin.js
//
// Początek układu danych instancji przy kamerze — precyzja float32.
//
// Świat gry leży przy 5–10 mln j. (krok float32 0,5 j., powyżej 8,39 mln — 1 j.).
// Moduł, który wpisuje BEZWZGLĘDNĄ pozycję świata do macierzy instancji albo
// atrybutu, a mesh trzyma w zerze, liczy ją na GPU we float32: duże liczby
// znoszą się dopiero w `modelViewMatrix * p` / NDC i obraz drga ~1 px (× zoom)
// względem kadłubów, inaczej w każdej klatce, gdy kamera drgnie. Kadłuby są
// dokładne, bo stoją na mesh.position — three składa modelViewMatrix w double.
//
// Wzór naprawy (Bridge3D._setOrigin, docs/PORT-mostki.md §8.12): co klatkę
// początek przy kamerze trafia do mesh.position, dane instancji liczone są
// względem niego na CPU w double (małe liczby), a shader robi
// `projectionMatrix * modelViewMatrix * …` (nie `viewMatrix * świat`).

import { Core3D } from './core3d.js';

/**
 * Początek przy kamerze w układzie SCENY (x, −y świata gry). Kamera ortho:
 * środek kadru; wolna kamera (free3d, lot nad Ring City): pozycja kamery
 * perspektywicznej. Bez kamery — zero (jak dawniej: nic nie psuje).
 *
 * Kamera gry z poprzedniej klatki też wystarcza (moduł wołany przed
 * Core3D.syncCamera): liczy się, żeby mesh.position i dane tej klatki miały
 * TEN SAM początek, a do kamery było daleko najwyżej kilka ekranów.
 *
 * @param {{x:number, y:number}} out
 * @param {object} [cam] kamera gry (domyślnie Core3D.activeCam1)
 * @returns {{x:number, y:number}} out
 */
export function sceneOriginNearCamera(out, cam = Core3D.activeCam1) {
  let x = 0;
  let y = 0;
  if (cam) {
    if (Core3D.isFreePerspectiveCamera(cam)) {
      x = Number(cam.position.x);
      y = Number(cam.position.y);
    } else {
      x = Number(cam.x);
      y = -Number(cam.y);
    }
  }
  out.x = Number.isFinite(x) ? x : 0;
  out.y = Number.isFinite(y) ? y : 0;
  return out;
}
