import * as THREE from 'three';
import { Core3D } from './core3d.js'; // Upewnij się, że ścieżka jest poprawna!
import { createPirateStation } from '../space/pirateStation/pirateStationFactory.js';

let pirateStation3D = null;
let pirateStation2D = null;
let initialRadius = null;

export function initWorld3D() {
  // Nie tworzymy tu już żadnych ukrytych scen ani render targetów.
  // Gra polega w całości na Core3D.
  return { scene: Core3D.scene };
}

export function attachPirateStation3D(_sceneIgnored, station2D) {
  if (pirateStation3D) return;
  
  // Tworzymy stację piratów z jej fabryki
  pirateStation3D = createPirateStation({ worldRadius: 360 }); 
  pirateStation2D = station2D || null;
  
  // Z = -100 utrzymuje stację na głębokości planet (żeby statki mogły nad nią latać)
  // Minus przy osi Y wyrównuje Canvas do WebGL.
  pirateStation3D.object3d.position.set(station2D?.x || 0, -(station2D?.y || 0), -100);
  
  // Dodajemy Bezpośrednio do naszego głównego świata 3D!
  if (Core3D.scene) {
      Core3D.scene.add(pirateStation3D.object3d);
  }
  
  initialRadius = pirateStation3D.radius;
  
  // Domyślna skala
  setPirateStationScale(25);
}

export function dettachPirateStation3D(_sceneIgnored) {
  if (!pirateStation3D) return;
  
  if (Core3D.scene && pirateStation3D.object3d.parent === Core3D.scene) {
    Core3D.scene.remove(pirateStation3D.object3d);
  }
  
  pirateStation3D.dispose();
  pirateStation3D = null;
  pirateStation2D = null;
  initialRadius = null;
}

export function updateWorld3D(dt, t) {
  if (!Core3D.isInitialized || !pirateStation3D) return;
  
  // Animacje proceduralne stacji (obrót pierścieni itp.)
  if (pirateStation3D?.update) {
      pirateStation3D.update(t ?? 0, dt ?? 0);
  }
  
  // Śledzenie lokalizacji z fizyki 2D
  if (pirateStation2D) {
      pirateStation3D.object3d.position.set(pirateStation2D.x, -pirateStation2D.y, -100);
  }
}

// Zostawiamy tę funkcję PUSTĄ! 
// Dzięki temu stare wywołania 'drawWorld3D' w index.html nie spowodują błędu,
// a jednocześnie nie narysują już nam tego zbugowanego zrzutu ekranu planety.
export function drawWorld3D(ctx, cam, worldToScreen) {
    // Pusto. Renderowaniem zajmuje się teraz wyłącznie Core3D.render() w hexShips3D.
}

export function setPirateStationScale(s) {
  if (!pirateStation3D || !initialRadius) return;
  const k = Number(s);
  if (!Number.isFinite(k) || k <= 0) return;
  pirateStation3D.object3d.scale.setScalar(k);
  pirateStation3D.radius = initialRadius * k;
}

export function setPirateStationWorldRadius(r) {
  if (!pirateStation3D || !initialRadius) return;
  const R = Number(r);
  if (!Number.isFinite(R) || R <= 0) return;
  const k = R / initialRadius;
  setPirateStationScale(k);
}

// Legacy helpers
export function getPirateStationSprite() { return null; }
export function setPirateCamDistance(mul) {}

if (typeof window !== 'undefined') {
  window.__setStation3DScale = setPirateStationScale;
  window.__setStation3DWorldRadius = setPirateStationWorldRadius;
  window.__setPirateCamDistance = setPirateCamDistance;
}