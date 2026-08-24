// src/3d/drawCallStats.js
//
// Rozbicie draw calli passa Ortho na kategorie. `renderer.info` mówi tylko
// „787 wywołań" — a to za mało, żeby wiedzieć, co batchować najpierw. Z sześciu
// screenów z bitwy wychodziło, że proporcje wywracają się w zależności od zoomu
// i liczby wraków: raz dominowały dysze silników, raz ciała heksowe. Ten licznik
// kończy zgadywanie.
//
// Kategorie liczą OBIEKTY RENDEROWALNE, nie wywołania sterownika — three rysuje
// jeden widoczny Mesh/Sprite jednym wywołaniem, więc to ta sama liczba, dopóki
// nic nie jest instancjonowane na poziomie sceny.

const frame = {
  engineNozzles: 0,
  engineDraws: 0,
  shipDraws: 0,
  wreckDraws: 0,
  weaponDraws: 0,
  // Ciała zwiniete do wspolnego batcha smug — nie generuja wlasnych wywolan,
  // ale warto widziec, ile ich jest, zeby dobrac prog.
  impostorBodies: 0
};

export const DrawCallStats = {
  /** Zerowanie na starcie klatki — woła updateHexShips3D razem z lodFrameStats. */
  begin() {
    frame.engineNozzles = 0;
    frame.engineDraws = 0;
    frame.shipDraws = 0;
    frame.wreckDraws = 0;
    frame.weaponDraws = 0;
    frame.impostorBodies = 0;
  },

  addEngine(nozzles, draws) {
    frame.engineNozzles += nozzles | 0;
    frame.engineDraws += draws | 0;
  },

  addHexBody(draws, isWreck) {
    if (isWreck) frame.wreckDraws += draws | 0;
    else frame.shipDraws += draws | 0;
  },

  addWeapon(draws) {
    frame.weaponDraws += draws | 0;
  },

  addImpostor(bodies) {
    frame.impostorBodies += bodies | 0;
  },

  /**
   * Liczba widocznych, renderowalnych potomków — tyle wywołań pójdzie do GL.
   * Własny obchód zamiast `traverse`, bo three przycina CAŁE poddrzewo pod
   * niewidocznym rodzicem, a callback `traverse` nie umie przerwać zejścia.
   */
  countRenderable(root) {
    if (!root || root.visible === false) return 0;
    let n = 0;
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (node.visible === false) continue;
      if (node !== root && (node.isMesh || node.isSprite || node.isPoints || node.isLine)) n++;
      const kids = node.children;
      for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return n;
  },

  get() { return frame; }
};

if (typeof window !== 'undefined') window.__drawCallStats = frame;
