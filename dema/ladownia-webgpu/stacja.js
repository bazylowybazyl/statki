// ============================================================
// Platforma przeładunkowa dema (dok / stacja): pokład w płaszczyźnie gry (wierzch z = 0),
// plac modułów (bursztynowe pola), rząd gniazd dronów z włazami, wieża kontroli ruchu
// i maszty ze światłami. Prosty rekwizyt w świetle ładunku (cargoLight.tsl.js) — w grze
// źródłem i celem dronów będzie port (hala K-7, zatoki) albo drugi statek.
// Pokład zapisuje głębię w z = 0, więc cienie dronów i niesionych modułów (GREATER) kładą się
// na nim jak na kadłubie.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, If, abs, attribute, clamp, float, floor, fract, fwidth, length, max, min, mix, normalize, positionGeometry,
  positionLocal, select, smoothstep, step, uniform, varyingProperty, vec2, vec3, vec4
} from 'three/tsl';
import { CARGO_LIGHT, cargoHash, cargoShade, cargoSurfaceCap, smoothDown } from '../../src/3d/cargo/cargoLight.tsl.js';
import { pushBeacon } from '../../src/3d/cargo/drones.tsl.js';

const AMBER = vec3(0.86, 0.46, 0.05);

/**
 * Platforma: środek (x, y) w świecie sceny, plac cols × rows modułów (unit), gniazda nests
 * (świat sceny). Zwraca { group, cells (plac w świecie), nests, update(lights, time, active) }.
 */
export function createStation({ x, y = null, top = null, unit, cols, rows, gap = 6, nestCount = 6 }) {
  const pa = unit.L + gap;
  const pb = unit.W + gap;
  const yardL = cols * pa + 24;
  const yardW = rows * pb + 24;
  const padR = Math.max(unit.L, unit.W) * 0.7 + 3;
  const padsW = padR * 2 + 16;
  const Lx = Math.max(yardL, nestCount * (padR * 2 + 10) + 40) + 40;
  const Ly = yardW + padsW + 30;
  const T = 26;
  // Środek z górnej krawędzi (top) albo wprost (y).
  if (!Number.isFinite(y)) y = (Number(top) || 0) - Ly / 2;
  // Plac przy krawędzi dalszej od statku (−y sceny), gniazda między placem a statkiem.
  const yardCy = -Ly / 2 + 15 + yardW / 2;
  const nestY = yardCy + yardW / 2 + padsW / 2;
  const group = new THREE.Group();
  group.name = 'Ladownia:stacja';
  group.position.set(x, y, 0);

  const uYard = uniform(new THREE.Vector4(0, yardCy, pa, pb));
  const uYard2 = uniform(new THREE.Vector4(cols, rows, unit.L, unit.W));
  const uPads = uniform(new THREE.Vector4(-(nestCount - 1) * (padR * 2 + 10) / 2, nestY, padR * 2 + 10, nestCount));
  const uPadR = uniform(padR);
  const uDeck = uniform(new THREE.Vector4(Lx / 2, Ly / 2, T, 0));

  const m = new THREE.NodeMaterial();
  m.name = 'Ladownia:poklad';
  m.lights = false;
  m.fog = false;
  const vN = varyingProperty('vec3', 'vStN');
  m.positionNode = Fn(() => {
    vN.assign(attribute('normal', 'vec3'));
    return positionGeometry;
  })();
  m.fragmentNode = Fn(() => {
    const P = positionLocal.toVar();
    const N = normalize(vN).toVar();
    const fw = fwidth(P);
    const px = max(max(fw.x, fw.y), max(fw.z, 1e-4)).toVar();
    const albedo = vec3(0.11, 0.115, 0.125).toVar();
    const emis = vec3(0.0).toVar();
    If(N.z.greaterThan(0.5), () => {
      const g = P.xy;
      const sd = min(abs(fract(g.x.div(10.0).add(0.5)).sub(0.5)), abs(fract(g.y.div(10.0).add(0.5)).sub(0.5))).mul(10.0);
      albedo.mulAssign(float(1.0).sub(smoothDown(px.add(0.08), 0.08, sd).mul(0.35)));
      albedo.mulAssign(cargoHash(floor(g.mul(0.12))).mul(0.2).add(0.9));
      // Plac: bursztynowe obrysy pól modułów.
      const ci = clamp(floor(g.x.sub(uYard.x).div(uYard.z).add(uYard2.x.mul(0.5))), 0.0, uYard2.x.sub(1.0));
      const cj = clamp(floor(g.y.sub(uYard.y).div(uYard.w).add(uYard2.y.mul(0.5))), 0.0, uYard2.y.sub(1.0));
      const cc = vec2(uYard.x.add(ci.add(0.5).sub(uYard2.x.mul(0.5)).mul(uYard.z)), uYard.y.add(cj.add(0.5).sub(uYard2.y.mul(0.5)).mul(uYard.w)));
      const q = g.sub(cc);
      const half = vec2(uYard2.z.mul(0.5).add(1.2), uYard2.w.mul(0.5).add(1.2));
      const e = abs(q).sub(half);
      const line = smoothDown(px.add(0.22), 0.22, abs(max(e.x, e.y)));
      albedo.assign(mix(albedo, AMBER, line.mul(0.85)));
      // Gniazda dronów: krąg z pasami i włazem.
      const pk = clamp(floor(g.x.sub(uPads.x).div(uPads.z).add(0.5)), 0.0, uPads.w.sub(1.0));
      const pc = vec2(uPads.x.add(pk.mul(uPads.z)), uPads.y);
      const dr = length(g.sub(pc));
      const ring = smoothDown(px.add(0.6), 0.6, abs(dr.sub(uPadR)));
      albedo.assign(mix(albedo, vec3(0.9, 0.9, 0.85), ring.mul(0.7)));
      const hatch = step(dr, uPadR.mul(0.55));
      albedo.assign(mix(albedo, vec3(0.03), hatch.mul(0.8)));
      // Pas ostrzegawczy wzdłuż krawędzi pokładu.
      const edge = min(uDeck.x.sub(abs(g.x)), uDeck.y.sub(abs(g.y)));
      const band = step(edge, 3.0).mul(step(0.6, edge));
      const stripe = step(0.5, fract(g.x.add(g.y).div(4.0)));
      albedo.assign(mix(albedo, mix(vec3(0.92, 0.62, 0.05), vec3(0.02), stripe), band));
    }).Else(() => {
      // Burty: panele i pas świateł.
      const s = select(abs(N.x).greaterThan(0.5), P.y, P.x);
      albedo.assign(vec3(0.08, 0.085, 0.095).mul(cargoHash(floor(vec2(s.div(12.0), P.z.div(6.0)))).mul(0.3).add(0.8)));
      const strip = step(abs(P.z.add(uDeck.z.mul(0.35))), 0.5).mul(step(0.5, fract(s.div(9.0))));
      emis.addAssign(vec3(0.3, 0.8, 1.0).mul(strip.mul(1.8)));
    });
    const col = cargoShade(albedo, N, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), float(0.5), float(28.0));
    return vec4(cargoSurfaceCap(col).add(emis), 1.0);
  })();
  const deckGeo = new THREE.BoxGeometry(Lx, Ly, T);
  deckGeo.translate(0, 0, -T / 2);
  const deck = new THREE.Mesh(deckGeo, m);
  deck.name = 'Ladownia:poklad';
  group.add(deck);

  // Wieża kontroli ruchu (róg pokładu od strony gniazd) — okna świecą.
  const towerMat = new THREE.NodeMaterial();
  towerMat.name = 'Ladownia:wieza';
  towerMat.lights = false;
  const vTN = varyingProperty('vec3', 'vTwN');
  towerMat.positionNode = Fn(() => { vTN.assign(attribute('normal', 'vec3')); return positionGeometry; })();
  towerMat.fragmentNode = Fn(() => {
    const P = positionLocal;
    const N = normalize(vTN);
    const albedo = vec3(0.16, 0.17, 0.19).mul(cargoHash(floor(P.xy.mul(0.2))).mul(0.2).add(0.85)).toVar();
    const side = N.z.lessThan(0.5);
    const s = select(abs(N.x).greaterThan(0.5), P.y, P.x);
    const win = step(abs(fract(P.z.div(5.0)).sub(0.5)), 0.12).mul(step(0.5, fract(s.div(4.0)))).mul(select(side, float(1.0), float(0.0)));
    const lit = step(0.55, cargoHash(floor(vec2(s.div(4.0), P.z.div(5.0)))));
    const col = cargoShade(albedo, N, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), float(0.4), float(24.0));
    return vec4(cargoSurfaceCap(col).add(vec3(1.0, 0.82, 0.55).mul(win.mul(lit).mul(1.1))), 1.0);
  })();
  const towerGeo = new THREE.BoxGeometry(46, 34, 30);
  towerGeo.translate(0, 0, 15);
  const tower = new THREE.Mesh(towerGeo, towerMat);
  tower.position.set(Lx / 2 - 34, nestY, 0);
  group.add(tower);
  group.updateMatrixWorld(true);

  // Plac i gniazda w świecie sceny.
  const cells = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      cells.push({ x: x + (i + 0.5 - cols / 2) * pa, y: y + yardCy + (j + 0.5 - rows / 2) * pb, z: 0, yaw: 0, col: i, row: j });
    }
  }
  const nests = [];
  for (let k = 0; k < nestCount; k++) nests.push({ x: x + uPads.value.x + k * uPads.value.z, y: y + nestY, z: 0 });

  const masts = [[-Lx / 2 + 6, -Ly / 2 + 6], [Lx / 2 - 6, -Ly / 2 + 6], [-Lx / 2 + 6, Ly / 2 - 6], [Lx / 2 - 6, Ly / 2 - 6]];
  return {
    group, cells, nests, size: { Lx, Ly }, padR,
    /** Światła stacji: maszty (czerwone, błysk), gniazda (zielone; bursztyn przy starcie drona), wieża. */
    pushLights(lights, time, activeNests = null) {
      const blink = (time * 0.7) % 1 < 0.14 ? 1 : 0.12;
      for (const [mx, my] of masts) lights.push(x + mx, y + my, 4, 2.2, 4.5 * blink, 0.5 * blink, 0.3 * blink, 0);
      for (let k = 0; k < nests.length; k++) {
        const n = nests[k];
        const busy = activeNests ? activeNests[k] : 0;
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          const lx = n.x + Math.cos(a) * padR;
          const ly = n.y + Math.sin(a) * padR;
          if (busy) pushBeacon(lights, lx, ly, 1.2, 1.2, time, k * 0.37 + a, 0.8);
          else lights.push(lx, ly, 1.0, 0.9, 0.2, 1.6, 0.6, 0);
        }
      }
      lights.push(x + Lx / 2 - 34, y + nestY, 32, 2.6, 5, 0.6, 0.3, 0);
    }
  };
}
