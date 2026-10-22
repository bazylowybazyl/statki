// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi — ORKIESTRATOR: czarna megabudowla zatykająca jądro na dnie
// gryzu (dno sięga granicy jądra), z wylotem pośrodku, z którego bije PROMIEŃ ENERGII w górę przez wylot gryzu do
// ODBIORNIKA na orbicie (pierścień-stacja tuż pod wewnętrzną krawędzią ringu „Halo”), z OBUDOWĄ DZIURY (dno, ściany,
// brzeg) i WINDAMI KOSMICZNYMI — liny z kotwic za krawędzią gryzu do SZYNY w wewnętrznej krawędzi ringu (płaszcz
// obracający się z Ziemią, wózki, kabiny na GPU). Obraz (zasada żelazna 1).
//
// Komponenty (każdy we własnym pliku, rama i kontrakt części — earthBitePlantFrame.js, opis — docs/BRIEF-korek.md):
//   korek — earthBitePlantCork.js, obudowa — earthBitePlantLining.js, windy — earthBitePlantElevators.js,
//   odbiornik — earthBitePlantOrbital.js, promień — earthBitePlantBeam.js (+ .tsl.js).
// Każdy komponent oddaje części { metal, flow } w ramie elektrowni; orkiestrator scala je w JEDNĄ siatkę metalu i JEDNĄ
// przepływu (dwa rysunki), promień ma własne siatki, a komponent może dołożyć własne obiekty (`extras` — fabryki
// (uniforms) → { object, applyLook(L, b, matrix), update(time, dt), meshes(), dispose() }; obiekt w ramie OBIEKTU kuli).
//
// Ziemia obraca się wokół osi ringu (earthSpin.js — decyzja użytkownika 2026-10-22), więc ring gry jest w jej układzie
// równikowy i stoi względem gruntu: promień przekaźnikowy (`attachRing`) i liny wind są stałe. Przekaz działa przy
// widoku ringu z odbiornika; bez niego odbiornik ładuje magazyn (`uPlantState.y`), z nim — oddaje.
//
// Układ: obiekt kuli Ziemi (R = 1, earthBiteShape.js). Siatki są dziećmi siatki kuli (obrót doby, soczewka warpa, skala
// grupy); uniformy słońca, gryzu i maski słońca dzielą z kulą obiekty { value }.
import * as THREE from 'three/webgpu';
import { EARTH_BITE } from '../data/earthBite.js';
import { earthBiteFrame } from './earthBiteShape.js';
import {
  PLANT_LAYOUT, plantFrameMatrix, plantZ0, hubHeight, mergeParts, ringPointObject, segmentClearsSphere
} from './earthBitePlantFrame.js';
import { createPlantUniformValues } from './earthBitePlantCommon.tsl.js';
import { createPlantMetalMaterial, createPlantFlowMaterial } from './earthBitePlant.tsl.js';
import * as Cork from './earthBitePlantCork.js';
import * as Lining from './earthBitePlantLining.js';
import * as Elevators from './earthBitePlantElevators.js';
import * as Orbital from './earthBitePlantOrbital.js';
import * as Beam from './earthBitePlantBeam.js';

export { plantFrameMatrix } from './earthBitePlantFrame.js';

/** Komponenty brył: budowa części i opcjonalne dodatki. */
const COMPONENTS = [
  { name: 'korek', build: Cork.buildCork, extras: Cork.extras },
  { name: 'obudowa', build: Lining.buildLining, extras: Lining.extras },
  { name: 'windy', build: Elevators.buildElevators, extras: Elevators.extras },
  { name: 'odbiornik', build: Orbital.buildOrbital, extras: Orbital.extras },
  { name: 'promień', build: Beam.buildBeamHardware, extras: Beam.extras }
];

/** Wymiary i wygląd (R Ziemi; h — wysokość nad dnem gryzu): układ wspólny + klucze komponentów (przedrostki). */
export const PLANT_DEFAULTS = Object.freeze({
  ...PLANT_LAYOUT,
  ...Cork.CORK_DEFAULTS,
  ...Lining.LINING_DEFAULTS,
  ...Elevators.ELEV_DEFAULTS,
  ...Orbital.HUB_DEFAULTS,
  ...Beam.BEAM_DEFAULTS,
  // światło żaru jeziora na bokach brył; tempo ładowania i oddawania magazynu odbiornika [1/s]
  lakeGlow: 1.3, relayFade: 1.5, chargeRate: 0.05, dischargeRate: 0.12
});

/** Okres zawinięcia zegara elektrowni [s]. */
export const PLANT_TIME_WRAP = 4096;

export function createPlantLook(over = {}) {
  return { ...PLANT_DEFAULTS, ...over };
}

export class EarthBitePlant {
  /**
   * @param {object} sphereUniforms `uniforms` siatki kuli Ziemi (sunPosition, uBite, uSunShadowRecv)
   * @param {object} [o]
   * @param {object} [o.look] wygląd (createPlantLook)
   */
  constructor(sphereUniforms, { look = createPlantLook() } = {}) {
    this.look = look;
    const su = sphereUniforms;
    this.uniforms = { sunPosition: su.sunPosition, uBite: su.uBite, uSunShadowRecv: su.uSunShadowRecv, ...createPlantUniformValues() };
    this.group = new THREE.Group();
    this.group.name = 'EarthBitePlant';
    this.metalMaterial = createPlantMetalMaterial(this.uniforms);
    this.flowMaterial = createPlantFlowMaterial(this.uniforms);
    this.metal = new THREE.Mesh(new THREE.BufferGeometry(), this.metalMaterial);
    this.metal.name = 'EarthBitePlantMetal';
    this.flow = new THREE.Mesh(new THREE.BufferGeometry(), this.flowMaterial);
    this.flow.name = 'EarthBitePlantFlow';
    this.beam = new Beam.PlantBeam(this.uniforms);
    this.group.add(this.metal, this.flow, ...this.beam.frameMeshes);
    this.extras = [];
    for (const c of COMPONENTS) {
      for (const make of c.extras ?? []) {
        const x = make(this.uniforms);
        this.extras.push(x);
        if (x.object) this.group.add(x.object);
      }
    }
    this.time = 0;
    this.relayOn = 0;
    this.relayWanted = false;
    this.charge = 0.5;
    this._geoKey = '';
    this.applyLook();
  }

  get biteRadius() {
    return Number(this.uniforms.uBite.value.w) || EARTH_BITE.radiusR;
  }

  applyLook() {
    const L = this.look;
    const b = this.biteRadius;
    const u = this.uniforms;
    u.uPlantShape.value.set(plantZ0(b), L.lakeGlow, 0, L.corkTopH);
    u.uPlantCork.value.set(L.corkR, L.corkTopH, L.apertureH, L.apertureR);
    u.uPlantHub.value.set(hubHeight(L, b), L.hubRing, 0, 0);
    const key = JSON.stringify([L, b]);
    if (key === this._geoKey) return;
    this._geoKey = key;
    const m = plantFrameMatrix(b);
    const metal = [];
    const flow = [];
    for (const c of COMPONENTS) {
      const parts = c.build(L, b);
      metal.push(...(parts.metal ?? []));
      flow.push(...(parts.flow ?? []));
    }
    const set = (mesh, geo) => { mesh.geometry.dispose(); mesh.geometry = geo; };
    set(this.metal, mergeParts(metal, m));
    set(this.flow, mergeParts(flow, m));
    this.beam.applyLook(L, b, m);
    for (const x of this.extras) x.applyLook?.(L, b, m);
  }

  /** Środek odbiornika w układzie obiektu kuli (na osi gryzu). */
  hubCenterObject(out = new THREE.Vector3()) {
    const { C } = earthBiteFrame(EARTH_BITE);
    return out.set(C[0], C[1], C[2]).multiplyScalar(this.look.hubRadius);
  }

  /** Promień przekaźnikowy odbiornik → ring: siatki w układzie gospodarza (świat dema / scena gry). */
  createRelay() {
    this.relay = this.beam.createRelay();
    return this.relay;
  }

  /**
   * Ring w układzie Ziemi: oś obrotu `axis` (układ obiektu kuli, earthSpin.js), wewnętrzna krawędź `innerR` [R]. Ring
   * jest równikowy i stoi względem gruntu, więc promień przekaźnikowy odbiornik → najbliższy punkt krawędzi ringu jest
   * stały: jego siatki idą do grupy elektrowni (układ obiektu kuli, obracają się z Ziemią). Linia przez planetę —
   * przekaz wyłączony (magazyn się ładuje). Zwraca, czy przekaz działa.
   */
  attachRing(axis, innerR = this.look.ringInnerR) {
    const relay = this.relay ?? this.createRelay();
    if (relay.group.parent !== this.group) this.group.add(relay.group);
    const H = this.hubCenterObject(new THREE.Vector3());
    const T = ringPointObject(H, axis, innerR);
    const on = segmentClearsSphere(H, T, 1.002);
    this.ringAxis = axis.clone();
    this.placeRelay(H, T, on);
    return on;
  }

  /** Ustawia promień przekaźnikowy od H do T (układ gospodarza); bez widoczności — chowa (odbiornik ładuje magazyn). */
  placeRelay(H, T, visible = true) {
    this.relayWanted = !!visible;
    this.beam.placeRelay(H, T, visible);
  }

  /** Stan przekazu od razu u celu (zrzuty przy zatrzymanym zegarze): przekaz 0 albo 1 wg widoku ringu. */
  settleRelay() {
    this.relayOn = this.relayWanted ? 1 : 0;
    this.update(0);
  }

  update(dt) {
    const L = this.look;
    const d = Math.max(0, Math.min(0.25, Number(dt) || 0)) * L.timeScale;
    // zegar efektów zawinięty (f32 w shaderach: sin / fract przy dużym czasie tracą dokładność) — skok raz na ~68 min
    this.time = (this.time + d) % PLANT_TIME_WRAP;
    const target = this.relayWanted ? 1 : 0;
    this.relayOn += (target - this.relayOn) * Math.min(1, d * L.relayFade);
    this.charge = Math.max(0, Math.min(1, this.charge + d * (this.relayWanted ? -L.dischargeRate : L.chargeRate)));
    const u = this.uniforms;
    u.uPlantTime.value = this.time;
    u.uPlantState.value.set(this.relayOn, this.charge, 0, 0);
    for (const x of this.extras) x.update?.(this.time, d);
  }

  warmupMeshes() {
    const out = [this.metal, this.flow, ...this.beam.warmupMeshes()];
    for (const x of this.extras) out.push(...(x.meshes?.() ?? []));
    return out;
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const mesh of [this.metal, this.flow]) mesh.geometry.dispose();
    for (const mat of [this.metalMaterial, this.flowMaterial]) mat.dispose();
    this.beam.dispose();
    for (const x of this.extras) x.dispose?.();
  }
}
