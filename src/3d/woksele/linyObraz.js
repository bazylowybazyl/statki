// Rysunek lin bazy (solver.liny, kernel kLiny; prośba użytkownika 2026-11-12: „widzę szpary, pusta przestrzeń ciągnie w dół — trzeba dodać coś, co trzyma, jakieś druty”).
// Liny widoczne leżą w liście jako pierwsze (scenaBazy.js, planLin), więc rysunek to instancje 0 … nWidocznych − 1. Spoiny (krótkie, w styku części) się nie rysują.
// Lina to wstęga z ODCINKI odcinków między węzłami a i b z bufora węzłów solvera: luźna (L < L0) zwisa parabolą w dół (−z), napięta jest prosta, zerwana albo z martwym
// końcem zapada się w punkt. Wstęga leży poziomo w poprzek liny (z góry, z kamery misji 1, ma pełną grubość), pionowa lina — wzdłuż osi x. Jeden rysunek, jeden materiał,
// graf raz na moduł. Moduł bez window i DOM: działa w workerze renderu (wGrze) i na stronie dema.
import * as THREE from 'three/webgpu';
import { Fn, attribute, instanceIndex, storage, uint, float, vec3, length, max, sqrt, cross, select } from 'three/tsl';

const ODCINKI = 12;
/** Grubość liny [j.]: w kadrze misji 1 (~0,14 px / j.) około 2–3 px. */
export const GRUBOSC_LINY = 18;

export function createLinyObraz({ solver, grubosc = GRUBOSC_LINY, barwa = [0.085, 0.082, 0.08] }) {
  const L = solver.liny;
  if (!L) return null;
  const MAX = solver.maxNodes;

  // Wstęga: (ODCINKI + 1) par wierzchołków, atrybut tLiny = (t wzdłuż liny, strona ±1).
  const t = new Float32Array(2 * 2 * (ODCINKI + 1));
  for (let k = 0; k <= ODCINKI; k++) {
    t[4 * k] = k / ODCINKI; t[4 * k + 1] = -1;
    t[4 * k + 2] = k / ODCINKI; t[4 * k + 3] = 1;
  }
  const indeksy = [];
  for (let k = 0; k < ODCINKI; k++) {
    const a = 2 * k;
    indeksy.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2 * (ODCINKI + 1)), 3));
  geo.setAttribute('tLiny', new THREE.BufferAttribute(t, 2));
  geo.setIndex(indeksy);
  geo.instanceCount = 0;

  const wWezR = storage(solver.atrybuty.wez, 'vec4', 3 * MAX).setName('wokWez').toReadOnly();
  const wLinyE = storage(L.atrybuty.e, 'uvec2', L.max).setName('wokLinyE').toReadOnly();
  const wLinyP = storage(L.atrybuty.p, 'vec4', L.max).setName('wokLinyP').toReadOnly();
  const aT = attribute('tLiny', 'vec2');

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.name = 'WokLiny';
  mat.side = THREE.DoubleSide;
  mat.map = null;
  mat.positionNode = Fn(() => {
    const q = instanceIndex;
    const ab = wLinyE.element(q);
    const P = wLinyP.element(q);
    const pa = wWezR.element(ab.x.mul(uint(3))).toVar();
    const pb = wWezR.element(ab.y.mul(uint(3))).toVar();
    const ch = pb.xyz.sub(pa.xyz).toVar();
    const dl = max(length(ch), float(1e-3)).toVar();
    const kier = ch.div(dl).toVar();
    // Zwis paraboli o długości łuku L0 nad cięciwą dl: h ≈ √(3 · dl · (L0 − dl) / 8).
    const h = sqrt(dl.mul(max(P.x.sub(dl), float(0))).mul(0.375)).toVar();
    const s = aT.x;
    const srodek = pa.xyz.add(ch.mul(s)).sub(vec3(0, 0, h.mul(4).mul(s).mul(float(1).sub(s)))).toVar();
    const pop = cross(kier, vec3(0, 0, 1)).toVar();
    const pl = length(pop).toVar();
    const poprzek = select(pl.lessThan(0.2), vec3(1, 0, 0), pop.div(max(pl, float(1e-3))));
    const cala = P.w.greaterThan(0.5).and(pa.w.greaterThanEqual(0)).and(pb.w.greaterThanEqual(0));
    return select(cala, srodek.add(poprzek.mul(aT.y.mul(grubosc * 0.5))), pa.xyz);
  })();
  mat.colorNode = vec3(...barwa);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'WokLiny';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  return {
    mesh,
    /** Liczba lin do rysunku (widoczne są pierwsze na liście). */
    ustaw(nWidocznych) {
      geo.instanceCount = Math.max(0, Math.min(nWidocznych | 0, L.max));
    },
    get n() { return geo.instanceCount; },
  };
}

/** Liczba widocznych lin z listy planLin (widoczne leżą na początku). */
export const ileWidocznych = (liny) => {
  let n = 0;
  while (n < (liny?.length ?? 0) && liny[n].widac) n++;
  return n;
};
