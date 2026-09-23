// src/vfx/collisionFx.js
//
// Warstwa PREZENTACJI zderzeń. Model zderzeń (destructor.js) jest skalibrowany
// i nic tutaj go nie dotyka — ten moduł tylko rozgłasza to, co się właśnie
// stało, żeby efekty nie musiały wisieć wprost w pętli fizyki.
//
// Dwa zdarzenia:
//   'impact' — JEDNORAZOWE, w chwili zetknięcia pary (z energią uderzenia).
//   'grind'  — CIĄGŁE, raz na wywołanie kolizji, dopóki kadłuby się trą.
//
// Bez importu three.js: destructor.js musi móc to zaimportować bez wciągania
// renderera. Subskrybenci 3D sami sięgają po `window.SparkSystem3D` itd.
//
// UWAGA dla subskrybentów: `ev` to WSPÓŁDZIELONY obiekt scratch, nadpisywany
// przy każdym wywołaniu (zero alokacji w pętli 120 Hz). Nie wolno go zatrzymać,
// zakolejkować ani schować w domknięciu — po powrocie z callbacka jego pola są
// już nieaktualne. Co potrzebne, przepisz do własnego bufora W TRAKCIE wywołania.

/**
 * Zdarzenie uderzenia — pierwszy kontakt pary po separacji.
 * @type {{
 *   A: any, B: any,
 *   x: number, y: number,          // uśredniony punkt styku (world)
 *   nx: number, ny: number,        // normalna z B do A (ta, po której poszedł impuls na A)
 *   tx: number, ty: number,        // styczna do normalnej
 *   approachSpeed: number,         // effectiveApproachSpeed (u/s)
 *   impactSpeed: number,           // pełna prędkość względna w punkcie styku
 *   slideSpeed: number,            // składowa styczna (znak = kierunek poślizgu)
 *   contactVelX: number,           // prędkość A w punkcie styku (z obrotem) —
 *   contactVelY: number,           //   efekty niosą cząstki razem z kadłubem
 *   massA: number, massB: number,
 *   reducedMass: number,
 *   energy: number,                // 0.5 * reducedMass * approachSpeed^2
 *   contactsCount: number,
 *   hullPair: boolean,             // kadłub vs kadłub (bez ringu i asteroid)
 *   isRingCollision: boolean,
 *   brittle: boolean,              // którakolwiek strona krucha (asteroida)
 *   simTime: number
 * }}
 */
export const impactEvent = {
  A: null,
  B: null,
  x: 0,
  y: 0,
  nx: 0,
  ny: 0,
  tx: 0,
  ty: 0,
  approachSpeed: 0,
  impactSpeed: 0,
  slideSpeed: 0,
  contactVelX: 0,
  contactVelY: 0,
  massA: 0,
  massB: 0,
  reducedMass: 0,
  energy: 0,
  contactsCount: 0,
  hullPair: false,
  isRingCollision: false,
  brittle: false,
  simTime: 0
};

/**
 * Zdarzenie tarcia — te same pola co `impactEvent`, plus:
 *   bounceForce — moduł impulsu normalnego z tego ticku,
 *   points      — Float32Array [x, y, nx, ny] × pointCount, punkty wzdłuż szwu,
 *   pointCount  — ile czwórek w `points` jest ważnych.
 * `points` to bufor destructora, żywy tylko na czas wywołania (patrz uwaga wyżej).
 */
export const grindEvent = {
  A: null,
  B: null,
  x: 0,
  y: 0,
  nx: 0,
  ny: 0,
  tx: 0,
  ty: 0,
  approachSpeed: 0,
  impactSpeed: 0,
  slideSpeed: 0,
  contactVelX: 0,
  contactVelY: 0,
  massA: 0,
  massB: 0,
  reducedMass: 0,
  energy: 0,
  contactsCount: 0,
  hullPair: false,
  isRingCollision: false,
  brittle: false,
  simTime: 0,
  bounceForce: 0,
  points: null,
  pointCount: 0
};

const _impactListeners = [];
const _grindListeners = [];

function listenersFor(type) {
  if (type === 'impact') return _impactListeners;
  if (type === 'grind') return _grindListeners;
  return null;
}

// Pojedynczy wadliwy efekt nie może zatrzymać kroku fizyki — stąd try/catch
// wokół samego wywołania, nie wokół pętli (jeden pechowy subskrybent nie gasi
// pozostałych).
function dispatch(listeners, ev) {
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](ev);
    } catch (error) {
      if (typeof console !== 'undefined') console.warn('[CollisionFX] subskrybent rzucił', error);
    }
  }
}

export const CollisionFX = {
  // Ustawiane przez destructor.js z DESTRUCTOR_CONFIG.collisionFxDebug — moduł
  // nie importuje configu, żeby nie robić cyklu destructor <-> collisionFx.
  debug: 0,

  stats: { impacts: 0, grinds: 0 },

  on(type, fn) {
    const listeners = listenersFor(type);
    if (!listeners || typeof fn !== 'function') return false;
    if (listeners.indexOf(fn) !== -1) return false;
    listeners.push(fn);
    return true;
  },

  off(type, fn) {
    const listeners = listenersFor(type);
    if (!listeners) return false;
    const index = listeners.indexOf(fn);
    if (index === -1) return false;
    listeners.splice(index, 1);
    return true;
  },

  listenerCount(type) {
    return listenersFor(type)?.length || 0;
  },

  onImpact(ev) {
    this.stats.impacts++;
    if (this.debug) {
      console.debug(
        '[CollisionFX] impact #' + this.stats.impacts +
        ' v=' + ev.approachSpeed.toFixed(1) +
        ' E=' + ev.energy.toExponential(2) +
        ' m=' + Math.round(ev.massA) + '/' + Math.round(ev.massB) +
        ' kontakty=' + ev.contactsCount +
        ' @' + Math.round(ev.x) + ',' + Math.round(ev.y)
      );
    }
    dispatch(_impactListeners, ev);
  },

  onGrind(ev) {
    this.stats.grinds++;
    dispatch(_grindListeners, ev);
  },

  resetStats() {
    this.stats.impacts = 0;
    this.stats.grinds = 0;
  }
};
