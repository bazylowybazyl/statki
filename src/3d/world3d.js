import * as THREE from 'three';
import { Core3D } from './core3d.js'; // Upewnij się, że ścieżka jest poprawna!
import { createPirateStation } from '../space/pirateStation/pirateStationFactory.js';
import { fxRandom } from './fx/fxRandom.js';

let pirateStation3D = null;
let pirateStation2D = null;
let initialRadius = null;

// ── Stacja piracka bez kompilacji w grze (zadanie 25a) ───────────────────────────────────────────────
// Stacja pojawia się w trakcie gry (misja najemnika), więc jej materiały, pass cienia i rozgrzewka rozpadu
// kompilowały się w klatce przyjęcia misji. Dodatkowo jej dwa PointLight-y latarni wchodziły do zestawu świateł
// passa FG: klucz świateł jest w kluczu KAŻDEGO materiału passa (nawet nieoświetlanego) — pojawienie się stacji
// przebudowywało wszystkie materiały FG w kadrze (stacja planety, hala K-7…). Teraz:
//  - światła latarni to STAŁE światła sceny od startu gry (intensywność 0, wszystkie warstwy) — stacja je pożycza
//    (pirateStationFactory: opts.beaconLights), zestaw świateł passa się nie zmienia; zgaszone światło nic nie dodaje;
//  - bryła stacji powstaje na ekranie ładowania (wpisy rejestru Core3D.warmup, faza 'loading'): pass FG, pass mapy
//    cienia i wypiek + rozgrzewka rozpadu (Destruction3D.prebake) — attachPirateStation3D bierze ją gotową.
// Wygląd stacji losuje fxRandom (nie Math.random gry — przebieg misji nie zależy od chwili budowy bryły).
let beaconLights = null;
let prebuiltPirate = null;

function ensurePirateBeaconLights() {
  if (beaconLights) return beaconLights;
  if (!Core3D.scene) return null;
  beaconLights = [0xff3b3b, 0x39a3ff].map((color) => {
    const light = new THREE.PointLight(color, 0, 80, 2.0);
    light.name = 'PirateBeaconLight';
    // Wszystkie warstwy, jak słońce i otoczenie Core3D: zestaw świateł taki sam w każdym passie i w rozgrzewce
    // kamerą wszystkich warstw (bryły ringu przed podpięciem) — światło tylko warstwy FG dawało w passie tła
    // i w tle menu inny klucz niż w rozgrzewce. Zasięg 600 j. (80 × skala), latarnie ~3000 j. nad / pod płaszczyzną
    // gry: oświetlają tylko bryłę stacji, jak dawniej.
    light.layers.enableAll();
    Core3D.scene.add(light);
    return light;
  });
  return beaconLights;
}

function buildPirateStation3D() {
  const station = createPirateStation({ worldRadius: 360, beaconLights: ensurePirateBeaconLights() || undefined });
  station.object3d.rotation.x = Math.PI * 0.5;
  station.object3d.userData.fgCategory = 'stations';
  station.object3d.userData.destructionPreset = 'pirate';
  Core3D.enableForeground3D(station.object3d);
  return station;
}

// Gotowa (niepodpięta) bryła na ekranie ładowania — raz; wypiek i rozgrzewka rozpadu jak przy podpięciu.
// Wypiek rozpadu losuje z fxRandom (shatterShaderBake.js) — stan ciągu efektów wraca po budowie: stacja, która
// dawniej powstawała dopiero w misji, nie przesuwa iskier i świateł od startu gry (sceny harnessu jak na main).
function ensurePrebuiltPirateStation() {
  if (pirateStation3D) return null;
  if (!prebuiltPirate && Core3D.scene) {
    const fxState = fxRandom.state;
    try {
      prebuiltPirate = buildPirateStation3D();
      prebuiltPirate.object3d.scale.setScalar(25);
      prebuiltPirate.object3d.updateMatrixWorld(true);
      if (typeof window !== 'undefined' && window.Destruction3D?.prebake) {
        window.Destruction3D.prebake(prebuiltPirate.object3d);
      }
    } finally {
      fxRandom.state = fxState;
    }
  }
  return prebuiltPirate;
}

Core3D.warmup?.add({ name: 'stacja piracka: bryła', objects: () => ensurePrebuiltPirateStation()?.object3d || null, layer: 2, phase: 'loading' });
Core3D.warmup?.add({ name: 'stacja piracka: cień', objects: () => ensurePrebuiltPirateStation()?.object3d || null, shadow: true, phase: 'loading' });

export function initWorld3D() {
  // Nie tworzymy tu już żadnych ukrytych scen ani render targetów.
  // Gra polega w całości na Core3D.
  ensurePirateBeaconLights();
  return { scene: Core3D.scene };
}

export function attachPirateStation3D(_sceneIgnored, station2D) {
  if (pirateStation3D) return;

  // Stacja piratów: gotowa z ekranu ładowania (rozgrzana) albo z fabryki
  pirateStation3D = prebuiltPirate || buildPirateStation3D();
  prebuiltPirate = null;
  pirateStation2D = station2D || null;

  // Z = -100 utrzymuje stację na głębokości planet (żeby statki mogły nad nią latać)
  // Minus przy osi Y wyrównuje Canvas do WebGL.
  pirateStation3D.object3d.position.set(station2D?.x || 0, -(station2D?.y || 0), -100);

  // Dodajemy Bezpośrednio do naszego głównego świata 3D!
  if (Core3D.scene) {
      Core3D.scene.add(pirateStation3D.object3d);
      Core3D.enableForeground3D(pirateStation3D.object3d);
  }

  // Link 3D mesh to 2D entity so destroyStation3D() can find it
  if (station2D) {
      station2D._mesh3d = pirateStation3D.object3d;
  }

  // Pre-bake geometry for Tier-1 GPU shatter (amortises cost, runs once per load)
  if (typeof window !== 'undefined' && window.Destruction3D?.prebake) {
      window.Destruction3D.prebake(pirateStation3D.object3d);
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
  // światła latarni zostają w scenie (stały zestaw świateł passa FG) — zgaszone
  if (beaconLights) for (const light of beaconLights) light.intensity = 0;
}

export function updateWorld3D(dt, t) {
  if (!Core3D.isInitialized || !pirateStation3D) return;
  if (pirateStation3D.object3d?.userData?.destructionOwned || pirateStation2D?._destroyed3D) {
    // rozpad: latarnie gasną razem ze stacją (światła są pożyczone ze sceny)
    if (beaconLights) for (const light of beaconLights) light.intensity = 0;
    return;
  }

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
