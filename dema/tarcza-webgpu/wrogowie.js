// ============================================================
// Wrogowie: proceduralne okręty z brył (wzór buildShip z dema/laser-webgpu.html),
// materiał kadłuba z panelami oświetlany światłami trafień. Każdy okręt zapisuje
// obrys brył w płaszczyźnie (widok z góry) — z niego powstają komórki hexGrid
// dla tarczy-obrysu tą samą drogą co u Atlasa (getEntityShieldProfile).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  float, vec3, color, select, fract, floor, abs, max, mix, smoothstep, hash,
  positionLocal, normalLocal, positionWorld, normalWorld, normalize
} from 'three/tsl';
import { shotLight, mulberry32, uTime } from './wspolne.js';

function hullMaterial(o) {
  const m = new THREE.MeshStandardNodeMaterial();
  const p = positionLocal.div(o.panel);
  const uvp = select(abs(normalLocal.z).greaterThan(0.5), p.xy,
    select(abs(normalLocal.x).greaterThan(0.5), p.yz, p.xz));
  const cell = floor(uvp).add(1000.0);
  const f = abs(fract(uvp).sub(0.5)).mul(2.0);
  const line = smoothstep(0.88, 0.97, max(f.x, f.y));
  const vari = hash(cell.x.mul(157.0).add(cell.y.mul(311.0)).add(o.seed)).mul(0.35).add(0.75);
  const albedo = mix(color(o.base).mul(vari), color(o.line), line.mul(0.85));
  const rough = float(o.rough).add(line.mul(0.15));
  const metal = float(o.metal);
  m.colorNode = albedo;
  m.roughnessNode = rough;
  m.metalnessNode = metal;
  m.emissiveNode = shotLight(albedo, rough, metal, positionWorld, normalize(normalWorld));
  return m;
}

function glowMaterial(rgb) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = vec3(rgb[0], rgb[1], rgb[2]);
  return m;
}

// Kształt jak w demie lasera: kadłub ~1490 × 364 j. przy skali 1 (dziób w +x).
export function buildShip(o) {
  const g = new THREE.Group();
  const hull = hullMaterial({ base: o.base, line: o.line, metal: 0.3, rough: 0.5, panel: 46, seed: o.seed });
  const dark = hullMaterial({ base: o.dark, line: o.line, metal: 0.25, rough: 0.64, panel: 30, seed: o.seed + 9 });
  const footprint = [];
  const add = (mat, w, h, d, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    footprint.push([x - w / 2, y - h / 2, x + w / 2, y + h / 2]);
    return mesh;
  };
  add(hull, 900, 210, 70, 0, 0, 0);
  add(hull, 280, 150, 60, 580, 0, 0);
  add(hull, 170, 86, 46, 790, 0, -2);
  add(dark, 170, 290, 96, -520, 0, 4);
  add(hull, 520, 58, 50, -40, 152, -6);
  add(hull, 520, 58, 50, -40, -152, -6);
  add(dark, 140, 92, 70, -260, 0, 62);
  add(hull, 72, 132, 22, -270, 0, 106);
  add(dark, 620, 26, 14, 60, 0, 42);
  const rnd = mulberry32(o.seed);
  for (let i = 0; i < 52; i++) {
    const w = 18 + rnd() * 70;
    const h = 14 + rnd() * 50;
    const d = 8 + rnd() * 22;
    add(rnd() < 0.5 ? dark : hull, w, h, d, -430 + rnd() * 920, (rnd() - 0.5) * 170, 35 + d * 0.5);
  }
  const nozMat = glowMaterial(o.engine);
  for (const y of [-92, 0, 92]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(36, 42, 30, 20), nozMat);
    c.rotation.z = Math.PI / 2;
    c.position.set(-612, y, 4);
    g.add(c);
    footprint.push([-627, y - 42, -597, y + 42]);
  }
  const navR = new THREE.MeshBasicNodeMaterial();
  navR.colorNode = vec3(6.0, 0.25, 0.15).mul(select(fract(uTime.mul(0.8)).lessThan(0.12), float(1.0), float(0.08)));
  const navG = new THREE.MeshBasicNodeMaterial();
  navG.colorNode = vec3(0.2, 5.0, 0.6).mul(select(fract(uTime.mul(0.8).add(0.5)).lessThan(0.12), float(1.0), float(0.08)));
  add(navR, 14, 14, 14, -60, 184, 20);
  add(navG, 14, 14, 14, -60, -184, 20);
  const turret = new THREE.Group();
  turret.position.set(170, 0, 48);
  g.add(turret);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(50, 58, 30, 28), dark);
  base.rotation.x = Math.PI / 2;
  turret.add(base);
  footprint.push([112, -58, 228, 58]);
  for (const y of [-12, 12]) {
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(175, 14, 14), hull);
    barrel.position.set(96, y, 12);
    turret.add(barrel);
  }
  g.scale.setScalar(o.scale);
  return {
    group: g, turret, scale: o.scale, engine: o.engine, footprint,
    x: 0, y: 0, angle: 0, // pozycja i kąt w świecie 3D (y w górę)
    fireCd: 0, barrel: 0
  };
}

export function placeShip(ship, x, y, angle) {
  ship.x = x; ship.y = y; ship.angle = angle;
  ship.group.position.set(x, y, 0);
  ship.group.rotation.set(0, 0, angle);
  ship.group.updateMatrixWorld(true);
}

// Wieża celuje w punkt świata 3D.
export function aimTurret(ship, tx, ty) {
  ship.turret.rotation.z = Math.atan2(ty - ship.y, tx - ship.x) - ship.angle;
  ship.turret.updateMatrixWorld(true);
}

// Wylot lufy (side = ±1) w świecie 3D.
export function barrelTip(ship, side, out) {
  return ship.turret.localToWorld(out.set(190, side * 12, 12));
}

// Punkt lokalny okrętu (skala 1) → świat 3D.
export function shipPoint(ship, lx, ly, lz, out) {
  return ship.group.localToWorld(out.set(lx, ly, lz));
}

// Komórki obrysu z brył (widok z góry): siatka co `step` j. (w skali 1), komórka
// tam, gdzie jej środek leży w którejś bryle. y w dół jak w sprite'ach gry.
export function footprintShards(footprint, step = 12) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of footprint) {
    if (b[0] < x0) x0 = b[0];
    if (b[1] < y0) y0 = b[1];
    if (b[2] > x1) x1 = b[2];
    if (b[3] > y1) y1 = b[3];
  }
  const shards = [];
  const half = step / 2;
  for (let y = y0 + half; y < y1; y += step) {
    for (let x = x0 + half; x < x1; x += step) {
      let inside = false;
      for (const b of footprint) {
        if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) { inside = true; break; }
      }
      if (inside) shards.push({ origLx: x, origLy: -y, lx: x, ly: -y, radius: half });
    }
  }
  return shards;
}
