// Słup konwekcyjny nad wielkim gryzem Ziemi — obiekty three: bryła-pośrednik marszu (wycinek kuli nad gryzem) z lekkim
// materiałem na wspólnym grafie (earthBitePlume.tsl.js), zegar obrazu i pioruny (earthBitePlumeShape.js, fxRandom).
//
// Siatka jest dzieckiem siatki kuli Ziemi (obraca się z gruntem, soczewka warpa i skala grupy działają same); jej
// uniformy dzielą z kulą obiekty { value } słońca, gryzu, mgiełki i maski słońca, więc DirectPlanet / demo nie muszą
// ich przepisywać. Moduł renderu: bez window i DOM (worker), losowanie z `fxRandom`.
import * as THREE from 'three/webgpu';
import { EARTH_BITE } from '../data/earthBite.js';
import { fxRandom } from './fx/fxRandom.js';
import {
  createPlumeLook, plumeFrame, plumeEnvelope, buildPlumeProxy, PlumeLightning, PLUME_FLASH_SLOTS
} from './earthBitePlumeShape.js';
import { createPlumeMaterial } from './earthBitePlume.tsl.js';

export class EarthBitePlume {
  /**
   * @param {object} sphereUniforms `uniforms` siatki kuli Ziemi (sunPosition, uBite, uHazeBeta, uHazeStrength, uSunShadowRecv)
   * @param {object} [o]
   * @param {object} [o.look] nastawy (createPlumeLook) — zmiana pól + applyLook()
   * @param {{ next(): number }} [o.rng] generator piorunów (domyślnie fxRandom)
   */
  constructor(sphereUniforms, { look = createPlumeLook(), rng = fxRandom } = {}) {
    this.look = look;
    const su = sphereUniforms;
    this.uniforms = {
      sunPosition: su.sunPosition, uBite: su.uBite, uHazeBeta: su.uHazeBeta, uHazeStrength: su.uHazeStrength,
      uSunShadowRecv: su.uSunShadowRecv,
      uPlTime: { value: 0 }, uPlFade: { value: 1 }, uPlWind: { value: new THREE.Vector3(1, 0, 0) },
      uPlCol: { value: new THREE.Vector4() }, uPlRad: { value: new THREE.Vector4() },
      uPlAnv: { value: new THREE.Vector4() }, uPlAnv2: { value: new THREE.Vector4() },
      uPlDens: { value: new THREE.Vector4() }, uPlLight: { value: new THREE.Vector4() }, uPlFlow: { value: new THREE.Vector4() },
      uPlFlash0: { value: new THREE.Vector4() }, uPlFlash1: { value: new THREE.Vector4() },
      uPlFlash2: { value: new THREE.Vector4() }, uPlFlash3: { value: new THREE.Vector4() },
      uPlFlashR: { value: new THREE.Vector4(0.03, 0.03, 0.03, 0.03) }
    };
    this.material = createPlumeMaterial(this.uniforms);
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.name = 'EarthBitePlume';
    // po chmurach i poświacie limbu (przezroczyste tej samej kuli)
    this.mesh.renderOrder = 8;
    this.lightning = new PlumeLightning(rng);
    this.time = 0;
    this._flash = new Float32Array(PLUME_FLASH_SLOTS * 4);
    this._flashR = new Float32Array(PLUME_FLASH_SLOTS);
    this._geoKey = '';
    this.applyLook();
  }

  /** Promień bazowy gryzu z uniformu kuli (demo: ?gryz=…). */
  get biteRadius() {
    return Number(this.uniforms.uBite.value.w) || EARTH_BITE.radiusR;
  }

  /** Przelicza wielkości pochodne, uniformy i (gdy zmienił się kształt) bryłę-pośrednik. */
  applyLook() {
    const L = this.look;
    const f = this.frame = plumeFrame(L, this.biteRadius);
    const u = this.uniforms;
    u.uPlWind.value.fromArray(f.W);
    u.uPlCol.value.set(L.zBot, f.zRim, L.zTop, L.lean);
    u.uPlRad.value.set(L.rBot, L.rRim, L.rTop, L.zDome);
    u.uPlAnv.value.set(L.hLo, L.hHi, L.lenDown, L.lenUp);
    const rBound = 1 + Math.max(L.hHi, L.zTop - 1) + 0.012;
    u.uPlAnv2.value.set(L.halfWidth, L.spread, L.sigmaAnvil, rBound);
    u.uPlDens.value.set(L.sigmaCol, L.sigmaLow, L.erosion, f.zLake);
    u.uPlLight.value.set(L.sun, L.glow, L.ambient, L.emit);
    u.uPlFlow.value.set(L.rise, L.outflow, L.swirl, L.noiseScale);
    const key = [L.zTop, L.rTop, L.lean, L.hHi, L.lenDown, L.lenUp, L.halfWidth, L.spread, L.windAzDeg, f.b].join('|');
    if (key !== this._geoKey) {
      this._geoKey = key;
      const env = plumeEnvelope(L, f);
      const g = buildPlumeProxy(env.D, env.theta, rBound + 0.004);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      geo.computeBoundingSphere();
      const old = this.mesh.geometry;
      this.mesh.geometry = geo;
      old?.dispose?.();
      this.envelope = env;
    }
  }

  /** Krok zegara obrazu (dt — czas klatki, jak doba Ziemi): ruch szumu, pioruny. */
  update(dt) {
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0)) * this.look.timeScale;
    this.time += d;
    const u = this.uniforms;
    u.uPlTime.value = this.time;
    this.lightning.step(d, this.look, this.frame, this._flash, this._flashR);
    const F = this._flash;
    u.uPlFlash0.value.set(F[0], F[1], F[2], F[3]);
    u.uPlFlash1.value.set(F[4], F[5], F[6], F[7]);
    u.uPlFlash2.value.set(F[8], F[9], F[10], F[11]);
    u.uPlFlash3.value.set(F[12], F[13], F[14], F[15]);
    u.uPlFlashR.value.set(this._flashR[0], this._flashR[1], this._flashR[2], this._flashR[3]);
  }

  /** Siatki do rozgrzewki (Core3D.warmup). */
  warmupMeshes() {
    return [this.mesh];
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry?.dispose?.();
    this.material.dispose();
  }
}
