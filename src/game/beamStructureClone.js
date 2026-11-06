// Kopia szablonu kratownicy na kolejne ciało: fizyka mutuje magazyny węzłów i belek, więc każde ciało ma własne.
// Dla testów silnika belek, pomiarów i dema dema/destruktor2d-webgpu (gra ma swoją kopię w hullBodies.js).
import { defineLazyViews } from './beamStore3D.js';

export function cloneBeamStructure(src) {
  // Widoki `nodes` / `beams` kopii powstają dopiero na żądanie (defineLazyViews).
  return defineLazyViews({
    ...src,
    nodeStore: src.nodeStore.clone(),
    beamStore: src.beamStore.clone(),
    invInertia: src.invInertia.slice()
  });
}
