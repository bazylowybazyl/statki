// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi: czarna megabudowla zatykająca jądro na dnie gryzu (dno sięga
// granicy jądra), z otworem pośrodku, z którego bije PROMIEŃ ENERGII w górę przez wylot gryzu do ODBIORNIKA na orbicie
// (pierścień-stacja tuż pod wewnętrzną krawędzią ringu „Halo”), i WINDY KOSMICZNE — liny z kotwic na krawędzi gryzu do
// odbiornika. Obraz (zasada żelazna 1). Materiały: earthBitePlant.tsl.js.
//
// Ring gry leży w płaszczyźnie ekranu i nie obraca się z Ziemią, więc odbiornik krąży z gryzem (obraca się z gruntem):
// przy krawędziach tarczy wchodzi pod ring, nad środkiem tarczy wisi nad otworem.
//
// Układ: obiekt kuli Ziemi (R = 1, earthBiteShape.js). Rama elektrowni: Y = oś A (= C, środek gryzu), X = E (wschód),
// Z = −N; początek na dnie gryzu (A · z0, z0 = 1 − β bazowe), więc y = wysokość nad dnem. Siatki są dziećmi siatki kuli
// (obrót doby, soczewka warpa, skala grupy); uniformy słońca, gryzu i maski słońca dzielą z kulą obiekty { value }.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EARTH_BITE } from '../data/earthBite.js';
import { earthBiteFrame, earthBiteRimAngle, earthBiteRadius, earthBiteRimPsi } from './earthBiteShape.js';
import { createPlantMetalMaterial, createPlantBeamMaterial, createPlantTetherMaterial } from './earthBitePlant.tsl.js';

const DEG = Math.PI / 180;

/** Wymiary i wygląd (R Ziemi; h — wysokość nad dnem gryzu). */
export const PLANT_DEFAULTS = Object.freeze({
  // korek: promień wierzchu (krawędź z kołnierzem), wysokość wierzchu, tarasy ku wylotowi, krater wylotu, gardziel
  rTop: 0.13, hTop: 0.053,
  rMid: 0.098, hMid: 0.059,
  rInner: 0.046, hInner: 0.065,
  rCrater: 0.024, hCrater: 0.073,
  rThroat: 0.0155,
  // wieże chłodnicze na środkowym tarasie, żebra wymienników na boku
  towers: 8, towerRing: 0.073, towerR: 0.0115, towerH: 0.032,
  fins: 56,
  // odbiornik na orbicie: promień od środka Ziemi (pod ringiem 1,09 R), promień pierścienia, grubość
  hubRadius: 1.075, hubRing: 0.05, hubTube: 0.006,
  // windy: azymuty kotwic w ramie gryzu (0 — wschód, 90 — północ), odsunięcie kotwic za krawędź [rad], grubość liny
  elevators: [45, 135, 225, 315], anchorPad: 0.015, tetherR: 0.0012,
  // promień energii: jasność (HDR), promień rdzenia, promień poświaty
  beamGain: 1.0, beamCore: 0.0035, beamGlow: 0.012,
  // przewody po dnie i ścianach gryzu: od korka do kotwic wind (główne) i do stacji na ścianach (boczne); promień rury,
  // zasięg bocznych (ułamek drogi do krawędzi), podstacje na przewodzie
  conduitR: 0.0035, sideConduits: [0, 90, 180, 270], sideReach: 0.62, substations: 3,
  // światło żaru jeziora na bokach korka
  lakeGlow: 1.3,
  timeScale: 1
});

export function createPlantLook(over = {}) {
  return { ...PLANT_DEFAULTS, ...over };
}

/** Macierz: rama elektrowni (Y = oś A, X = E, Z = −N; początek na dnie gryzu) → układ obiektu kuli. */
export function plantFrameMatrix(b = EARTH_BITE.radiusR, out = new THREE.Matrix4()) {
  const { C, E, N } = earthBiteFrame(EARTH_BITE);
  const z0 = 1 - b;
  return out.set(
    E[0], C[0], -N[0], C[0] * z0,
    E[1], C[1], -N[1], C[1] * z0,
    E[2], C[2], -N[2], C[2] * z0,
    0, 0, 0, 1
  );
}

/** Punkt na kuli Ziemi (promień r) pod kątem th od C w azymucie phi — w ramie elektrowni (y nad dnem). */
function surfacePoint(th, phi, r, z0, out = new THREE.Vector3()) {
  return out.set(Math.sin(th) * Math.cos(phi) * r, Math.cos(th) * r - z0, -Math.sin(th) * Math.sin(phi) * r);
}

// Walec między punktami P → Q (rama elektrowni); uv.y = 0 przy P, 1 przy Q.
function cylinderBetween(P, Q, r, seg = 8) {
  const d = new THREE.Vector3().subVectors(Q, P);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  // CylinderGeometry: oś Y, v = 1 u góry — odwracamy, żeby uv.y rosło od P do Q
  const uvA = g.attributes.uv;
  for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  g.applyQuaternion(q);
  g.translate((P.x + Q.x) / 2, (P.y + Q.y) / 2, (P.z + Q.z) / 2);
  return g;
}

/** Korek w ramie elektrowni: profil obrotowy z tarasami i kraterem, wieże chłodnicze, żebra wymienników. */
export function buildCorkGeometry(L = PLANT_DEFAULTS) {
  const V = (r, h) => new THREE.Vector2(r, h);
  const profile = [
    V(L.rTop * 0.86, -0.03), V(L.rTop * 0.92, 0.02), V(L.rTop, L.hTop - 0.009), V(L.rTop, L.hTop - 0.004),
    V(L.rTop - 0.005, L.hTop), V(L.rMid + 0.002, L.hTop), V(L.rMid, L.hMid), V(L.rInner + 0.002, L.hMid),
    V(L.rInner, L.hInner), V(L.rCrater + 0.002, L.hInner), V(L.rCrater, L.hCrater), V(L.rThroat + 0.0025, L.hCrater),
    V(L.rThroat, L.hCrater - 0.012), V(L.rThroat * 0.97, 0.0)
  ];
  const parts = [new THREE.LatheGeometry(profile, 192)];
  for (let i = 0; i < L.towers; i++) {
    const a = (i / L.towers) * Math.PI * 2 + Math.PI / L.towers;
    const t = new THREE.CylinderGeometry(L.towerR * 0.78, L.towerR, L.towerH, 40, 1, false);
    t.translate(Math.cos(a) * L.towerRing, L.hMid + L.towerH * 0.5, Math.sin(a) * L.towerRing);
    parts.push(t);
  }
  for (let i = 0; i < L.fins; i++) {
    const f = new THREE.BoxGeometry(0.02, L.hTop - 0.016, 0.0024);
    f.translate(L.rTop * 0.97, (L.hTop - 0.016) * 0.5 + 0.004, 0);
    f.rotateY(-(i / L.fins) * Math.PI * 2);
    parts.push(f);
  }
  return parts;
}

/** Odbiornik na orbicie (pierścień ze szprychami i czaszą zwróconą w dół) i kotwice wind na krawędzi gryzu. */
export function buildOrbitalGeometry(L = PLANT_DEFAULTS, b = EARTH_BITE.radiusR) {
  const z0 = 1 - b;
  const hHub = L.hubRadius - z0;
  const parts = [];
  const torus = new THREE.TorusGeometry(L.hubRing, L.hubTube, 24, 180);
  torus.rotateX(Math.PI / 2);
  torus.translate(0, hHub, 0);
  parts.push(torus);
  for (let i = 0; i < 6; i++) {
    const s = new THREE.BoxGeometry(L.hubRing, L.hubTube * 0.6, L.hubTube * 0.9);
    s.translate(L.hubRing * 0.5, hHub, 0);
    s.rotateY((i / 6) * Math.PI * 2);
    // obrót wokół osi Y przechodzi przez środek odbiornika (x = z = 0), więc wysokość zostaje
    parts.push(s);
  }
  const dish = new THREE.CylinderGeometry(0.012, 0.022, 0.012, 48, 1, false);
  dish.translate(0, hHub - 0.004, 0);
  parts.push(dish);
  // kotwice: blok i wieża wzdłuż pionu miejsca, tuż za krawędzią gryzu
  for (const az of L.elevators) {
    const phi = az * DEG;
    const th = earthBiteRimAngle(phi, EARTH_BITE, b) + L.anchorPad;
    const up = surfacePoint(th, phi, 1, 0).normalize();
    const base = surfacePoint(th, phi, 1, z0);
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize(), up,
      new THREE.Vector3().crossVectors(new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 0, 1)).normalize(), up));
    const block = new THREE.BoxGeometry(0.03, 0.012, 0.03);
    block.translate(0, 0.004, 0);
    block.applyMatrix4(m);
    block.translate(base.x, base.y, base.z);
    parts.push(block);
    const tower = new THREE.CylinderGeometry(0.0035, 0.006, 0.035, 16, 1, false);
    tower.translate(0, 0.0175 + 0.008, 0);
    tower.applyMatrix4(m);
    tower.translate(base.x, base.y, base.z);
    parts.push(tower);
  }
  return parts;
}

/** Liny wind: od szczytu wieży kotwicy do pierścienia odbiornika (w azymucie kotwicy). */
export function buildTetherGeometry(L = PLANT_DEFAULTS, b = EARTH_BITE.radiusR) {
  const z0 = 1 - b;
  const hHub = L.hubRadius - z0;
  const parts = [];
  L.elevators.forEach((az, i) => {
    const phi = az * DEG;
    const th = earthBiteRimAngle(phi, EARTH_BITE, b) + L.anchorPad;
    const top = surfacePoint(th, phi, 1.043, z0);
    const hub = new THREE.Vector3(Math.cos(phi) * L.hubRing, hHub, -Math.sin(phi) * L.hubRing);
    const g = cylinderBetween(top, hub, L.tetherR, 8);
    // uv.x: połowa lin — kabiny w górę, połowa — w dół (materiał)
    const uvA = g.attributes.uv;
    for (let k = 0; k < uvA.count; k++) uvA.setX(k, (i % 2) * 0.5 + 0.25);
    parts.push(g);
  });
  return parts;
}

// Punkt nad powierzchnią gryzu (ściana / dno) w kierunku (phi, psi) od C, uniesiony o lift — w ramie elektrowni.
function bowlPoint(phi, psi, lift, b, z0, out = new THREE.Vector3()) {
  const { C, E, N } = earthBiteFrame(EARTH_BITE);
  const beta = earthBiteRadius(phi, psi, EARTH_BITE, b) - lift;
  const cp = Math.cos(phi), sp = Math.sin(phi), cs = Math.cos(psi), ss = Math.sin(psi);
  const u = [0, 1, 2].map((k) => -cs * C[k] + ss * (cp * E[k] + sp * N[k]));
  const p = [0, 1, 2].map((k) => C[k] + beta * u[k]);
  const dot = (a, c) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
  return out.set(dot(p, E), dot(p, C) - z0, -dot(p, N));
}

/** Ścieżki przewodów: od podstawy korka po dnie i ścianie (ψ rośnie) — główne do kotwic za krawędzią, boczne do stacji. */
export function conduitPaths(L = PLANT_DEFAULTS, b = EARTH_BITE.radiusR) {
  const z0 = 1 - b;
  const paths = [];
  // ψ podstawy korka: β · sin ψ = promień korka przy dnie
  const psi0 = Math.asin(Math.min(1, (L.rTop * 0.95) / b));
  const add = (az, reach, main) => {
    const phi = az * DEG;
    const psiRim = earthBiteRimPsi(phi, EARTH_BITE, b);
    const psi1 = psi0 + (psiRim - 0.02 - psi0) * reach;
    const pts = [];
    for (let i = 0; i <= 40; i++) pts.push(bowlPoint(phi, psi0 + (psi1 - psi0) * (i / 40), L.conduitR * 1.6, b, z0));
    if (main) {
      // przez krawędź do kotwicy (po kuli Ziemi, tuż nad gruntem)
      const thRim = earthBiteRimAngle(phi, EARTH_BITE, b);
      for (let i = 1; i <= 6; i++) pts.push(surfacePoint(thRim + L.anchorPad * (i / 6), phi, 1 + L.conduitR * 1.6, z0));
    }
    paths.push({ az, main, pts });
  };
  for (const az of L.elevators) add(az, 1, true);
  for (const az of L.sideConduits) add(az, L.sideReach, false);
  return paths;
}

/** Przewody (rury z impulsami energii — materiał lin) i podstacje (bloki — materiał metalu). */
export function buildConduitGeometry(L = PLANT_DEFAULTS, b = EARTH_BITE.radiusR) {
  const pipes = [];
  const stations = [];
  for (const { pts, main } of conduitPaths(L, b)) {
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 160, L.conduitR * (main ? 1 : 0.7), 8, false);
    // materiał lin czyta uv.y wzdłuż i uv.x jako pas (impulsy od korka na zewnątrz)
    const uvA = tube.attributes.uv;
    for (let k = 0; k < uvA.count; k++) { const along = uvA.getX(k); uvA.setXY(k, 0.25, along); }
    pipes.push(tube);
    for (let i = 1; i <= L.substations; i++) {
      const t = i / (L.substations + 1);
      const at = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      // pion stacji: od punktu ku środkowi kuli gryzu (normalna ściany ≈ ku C)
      const toC = new THREE.Vector3(0, b, 0).sub(at).normalize();
      const x = new THREE.Vector3().crossVectors(toC, tan).normalize();
      const z = new THREE.Vector3().crossVectors(x, toC);
      const m = new THREE.Matrix4().makeBasis(x, toC, z).setPosition(at);
      const box = new THREE.BoxGeometry(0.016, 0.008, 0.022);
      box.applyMatrix4(m);
      stations.push(box);
    }
  }
  return { pipes, stations };
}

/** Promień: walec od krateru korka do czaszy odbiornika (rdzeń albo poświata). */
export function buildBeamGeometry(L = PLANT_DEFAULTS, b = EARTH_BITE.radiusR, glow = false) {
  const z0 = 1 - b;
  const y0 = L.hCrater - 0.01;
  const y1 = L.hubRadius - z0 - 0.01;
  const r = glow ? L.beamGlow : L.beamCore;
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, glow ? 40 : 24, 1, true);
  g.translate(0, (y0 + y1) * 0.5, 0);
  return g;
}

function mergeInFrame(parts, m) {
  for (const g of parts) {
    if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
  }
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  geo.applyMatrix4(m);
  geo.computeBoundingSphere();
  return geo;
}

const _rd = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _ry = new THREE.Vector3(0, 1, 0);

export class EarthBitePlant {
  /**
   * @param {object} sphereUniforms `uniforms` siatki kuli Ziemi (sunPosition, uBite, uSunShadowRecv)
   * @param {object} [o]
   * @param {object} [o.look] wygląd (createPlantLook)
   */
  constructor(sphereUniforms, { look = createPlantLook() } = {}) {
    this.look = look;
    const su = sphereUniforms;
    this.uniforms = {
      sunPosition: su.sunPosition, uBite: su.uBite, uSunShadowRecv: su.uSunShadowRecv,
      uPlantTime: { value: 0 },
      uPlantShape: { value: new THREE.Vector4() },
      uPlantBeam: { value: new THREE.Vector4() },
      uPlantLayer: { value: 0 },
      uPlantBeamLen: { value: 0.5 }
    };
    const glowUniforms = { ...this.uniforms, uPlantLayer: { value: 1 } };
    this.group = new THREE.Group();
    this.group.name = 'EarthBitePlant';
    this.metalMaterial = createPlantMetalMaterial(this.uniforms);
    this.tetherMaterial = createPlantTetherMaterial(this.uniforms);
    this.beamMaterial = createPlantBeamMaterial(this.uniforms);
    this.beamGlowMaterial = createPlantBeamMaterial(glowUniforms);
    this.metal = new THREE.Mesh(new THREE.BufferGeometry(), this.metalMaterial);
    this.metal.name = 'EarthBitePlantMetal';
    this.tethers = new THREE.Mesh(new THREE.BufferGeometry(), this.tetherMaterial);
    this.tethers.name = 'EarthBitePlantTethers';
    this.beam = new THREE.Mesh(new THREE.BufferGeometry(), this.beamMaterial);
    this.beam.name = 'EarthBitePlantBeam';
    this.beamGlow = new THREE.Mesh(new THREE.BufferGeometry(), this.beamGlowMaterial);
    this.beamGlow.name = 'EarthBitePlantBeamGlow';
    // promień po chmurach i poświacie limbu (przezroczyste tej samej kuli)
    this.beam.renderOrder = 9;
    this.beamGlow.renderOrder = 9;
    this.group.add(this.metal, this.tethers, this.beam, this.beamGlow);
    this.time = 0;
    this._geoKey = '';
    this.applyLook();
  }

  get biteRadius() {
    return Number(this.uniforms.uBite.value.w) || EARTH_BITE.radiusR;
  }

  applyLook() {
    const L = this.look;
    const b = this.biteRadius;
    const z0 = 1 - b;
    const u = this.uniforms;
    u.uPlantShape.value.set(z0, L.lakeGlow, 0, L.hTop);
    u.uPlantBeam.value.set(L.beamGain, L.hCrater - 0.012, L.hubRadius - z0, L.beamCore);
    u.uPlantBeamLen.value = (L.hubRadius - z0 - 0.01) - (L.hCrater - 0.01);
    const key = JSON.stringify([L, b]);
    if (key !== this._geoKey) {
      this._geoKey = key;
      const m = plantFrameMatrix(b);
      const set = (mesh, geo) => { mesh.geometry.dispose(); mesh.geometry = geo; };
      const conduits = buildConduitGeometry(L, b);
      set(this.metal, mergeInFrame([...buildCorkGeometry(L), ...buildOrbitalGeometry(L, b), ...conduits.stations], m));
      set(this.tethers, mergeInFrame([...buildTetherGeometry(L, b), ...conduits.pipes], m));
      set(this.beam, mergeInFrame([buildBeamGeometry(L, b, false)], m));
      set(this.beamGlow, mergeInFrame([buildBeamGeometry(L, b, true)], m));
    }
  }

  /** Środek odbiornika w układzie obiektu kuli (na osi gryzu). */
  hubCenterObject(out = new THREE.Vector3()) {
    const { C } = earthBiteFrame(EARTH_BITE);
    return out.set(C[0], C[1], C[2]).multiplyScalar(this.look.hubRadius);
  }

  /**
   * Promień przekaźnikowy odbiornik → ring (rdzeń, poświata, rozbłysk w celu): siatki w układzie gospodarza (świat
   * dema / scena gry), ustawia je `placeRelay`. Walce o długości 1 wzdłuż Y (uv.y: 0 — odbiornik, 1 — ring).
   */
  createRelay() {
    const mk = (layer, r, seg) => {
      const g = new THREE.CylinderGeometry(r, r, 1, seg, 1, true);
      g.translate(0, 0.5, 0);
      const uniforms = { ...this.uniforms, uPlantLayer: { value: layer }, uPlantBeamLen: { value: 1 } };
      const m = new THREE.Mesh(g, createPlantBeamMaterial(uniforms));
      m.renderOrder = 9;
      return m;
    };
    const L = this.look;
    // przekaźnikowy grubszy od głównego: biegnie w poprzek kadru (główny jest w pionie, z góry widać go od czoła)
    const core = mk(0, L.beamCore * 1.6, 24);
    const glow = mk(1, L.beamGlow * 1.6, 40);
    const flareU = { ...this.uniforms, uPlantLayer: { value: 1 }, uPlantBeamLen: { value: 0 } };
    const flareGeo = new THREE.SphereGeometry(1, 32, 16);
    // rozbłysk: kula bez końców wzdłuż uv.y — pełna jasność poświaty
    const uvA = flareGeo.attributes.uv;
    for (let i = 0; i < uvA.count; i++) uvA.setY(i, 0.5);
    const flare = new THREE.Mesh(flareGeo, createPlantBeamMaterial(flareU));
    flare.renderOrder = 9;
    const group = new THREE.Group();
    group.name = 'EarthBitePlantRelay';
    group.add(core, glow, flare);
    this.relay = { group, core, glow, flare };
    return this.relay;
  }

  /** Ustawia promień przekaźnikowy od H do T (świat gospodarza); bez widoczności — chowa. */
  placeRelay(H, T, visible = true) {
    const r = this.relay;
    if (!r) return;
    r.group.visible = !!visible;
    if (!visible) return;
    const d = _rd.subVectors(T, H);
    const len = d.length();
    _rq.setFromUnitVectors(_ry, d.divideScalar(Math.max(len, 1e-9)));
    for (const m of [r.core, r.glow]) {
      m.position.copy(H);
      m.quaternion.copy(_rq);
      m.scale.set(1, len, 1);
      m.material.uniforms.uPlantBeamLen.value = len;
    }
    r.flare.position.copy(T);
    r.flare.scale.setScalar(this.look.beamGlow * 3.0);
  }

  update(dt) {
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0)) * this.look.timeScale;
    this.time += d;
    this.uniforms.uPlantTime.value = this.time;
  }

  warmupMeshes() {
    return [this.metal, this.tethers, this.beam, this.beamGlow];
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const mesh of [this.metal, this.tethers, this.beam, this.beamGlow]) mesh.geometry.dispose();
    for (const m of [this.metalMaterial, this.tetherMaterial, this.beamMaterial, this.beamGlowMaterial]) m.dispose();
  }
}
