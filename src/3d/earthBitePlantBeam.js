// Elektrownia „KOREK” — PROMIEŃ ENERGII: główny z krateru korka do czaszy odbiornika (siatki w ramie elektrowni, dzieci
// grupy elektrowni) i przekaźnikowy z odbiornika do wewnętrznej krawędzi ringu (siatki w układzie gospodarza — świat
// dema / scena gry; ustawia je `place`). Materiał: earthBitePlantBeam.tsl.js.
import * as THREE from 'three/webgpu';
import { hubHeight } from './earthBitePlantFrame.js';
import { createPlantBeamMaterial } from './earthBitePlantBeam.tsl.js';

/** Wymiary promienia (R Ziemi). */
export const BEAM_DEFAULTS = Object.freeze({
  beamGain: 1.0,      // jasność (HDR)
  beamCore: 0.0035,   // promień rdzenia
  beamGlow: 0.012,    // promień poświaty
  relayScale: 1.6     // przekaźnikowy grubszy od głównego (biegnie w poprzek kadru, główny z góry widać od czoła)
});

/**
 * Sprzęt promienia w ramie elektrowni (pierścienie zamknięcia wzdłuż promienia itp.): { metal, flow } — jak komponenty
 * brył (orkiestrator scala z resztą).
 */
export function buildBeamHardware() {
  return { metal: [], flow: [] };
}

/** Główny promień: walec od krateru korka do czaszy odbiornika (rdzeń albo poświata), rama elektrowni. */
export function buildBeamGeometry(L, b, glow = false) {
  const y0 = L.apertureH - 0.01;
  const y1 = hubHeight(L, b) - 0.01;
  const r = glow ? L.beamGlow : L.beamCore;
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, glow ? 40 : 24, 1, true);
  g.translate(0, (y0 + y1) * 0.5, 0);
  return g;
}

const _rd = new THREE.Vector3();
const _rq = new THREE.Quaternion();
const _ry = new THREE.Vector3(0, 1, 0);

export class PlantBeam {
  /** @param {object} uniforms wspólne uniformy elektrowni (EarthBitePlant.uniforms) */
  constructor(uniforms) {
    this.uniforms = uniforms;
    const layer = (k) => ({ ...uniforms, uPlantLayer: { value: k } });
    this.coreMaterial = createPlantBeamMaterial(layer(0));
    this.glowMaterial = createPlantBeamMaterial(layer(1));
    this.core = new THREE.Mesh(new THREE.BufferGeometry(), this.coreMaterial);
    this.core.name = 'EarthBitePlantBeam';
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMaterial);
    this.glow.name = 'EarthBitePlantBeamGlow';
    // promień po chmurach i poświacie limbu (przezroczyste tej samej kuli)
    this.core.renderOrder = 9;
    this.glow.renderOrder = 9;
    /** Siatki w ramie elektrowni (orkiestrator przenosi geometrię macierzą ramy i dokłada do grupy). */
    this.frameMeshes = [this.core, this.glow];
    this.relay = null;
    this.look = null;
  }

  /** Przebudowa geometrii (rama elektrowni; `matrix` — rama → obiekt kuli). */
  applyLook(L, b, matrix) {
    this.look = L;
    const u = this.uniforms;
    u.uPlantBeam.value.set(L.beamGain, L.apertureH - 0.012, hubHeight(L, b), L.beamCore);
    u.uPlantBeamLen.value = (hubHeight(L, b) - 0.01) - (L.apertureH - 0.01);
    const set = (mesh, geo) => { mesh.geometry.dispose(); geo.applyMatrix4(matrix); geo.computeBoundingSphere(); mesh.geometry = geo; };
    set(this.core, buildBeamGeometry(L, b, false));
    set(this.glow, buildBeamGeometry(L, b, true));
  }

  /**
   * Promień przekaźnikowy odbiornik → ring (rdzeń, poświata, rozbłysk w celu): siatki w układzie gospodarza. Walce
   * o długości 1 wzdłuż Y (uv.y: 0 — odbiornik, 1 — ring).
   */
  createRelay() {
    const L = this.look;
    const mk = (layer, r, seg) => {
      const g = new THREE.CylinderGeometry(r, r, 1, seg, 1, true);
      g.translate(0, 0.5, 0);
      const uniforms = { ...this.uniforms, uPlantLayer: { value: layer }, uPlantBeamLen: { value: 1 } };
      const m = new THREE.Mesh(g, createPlantBeamMaterial(uniforms));
      m.renderOrder = 9;
      return m;
    };
    const core = mk(0, L.beamCore * L.relayScale, 24);
    const glow = mk(1, L.beamGlow * L.relayScale, 40);
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

  /** Ustawia promień przekaźnikowy od H do T (układ gospodarza); bez widoczności — chowa. */
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

  /** Siatki do rozgrzewki (rama i przekaźnik). */
  warmupMeshes() {
    const out = [...this.frameMeshes];
    if (this.relay) out.push(this.relay.core, this.relay.glow, this.relay.flare);
    return out;
  }

  dispose() {
    for (const m of this.warmupMeshes()) { m.geometry.dispose(); m.material.dispose(); }
    this.relay?.group.parent?.remove(this.relay.group);
  }
}
