// src/3d/planetGen/planetGenGas.js
//
// Gazowe i lodowe olbrzymy generatora na WSPÓLNYM silniku żywej atmosfery (gasGiantAtmosphere.js / .tsl.js — ten sam,
// który animuje Jowisza i Saturna), bez nowego silnika. Różnica: Jowisz i Saturn mają model stały (graf na planetę),
// a planet z generatora może być wiele — więc JEDEN graf 'genGas' (rodzaj grafu powierzchni w planet3d.assets.tsl.js,
// dopisany przez `registerPlanetFlowKind`) dla wszystkich, a pasy, wiry i profil wiatru planety idą PER OBIEKT:
//   • tablice pasów i wirów — węzły tablic uniformów z aktualizacją na obiekt (`PerObjectUniformArrayNode`: przed
//     rysunkiem kopiują `material.uniforms[klucz].value` do bufora; bufor grupy obiektu jest osobny dla każdego
//     obiektu renderu — NodeBuilderState.createBindings), stała nazwa bufora (jeden WGSL);
//   • tekstura profilu wiatru — węzeł tekstury per obiekt (jak PlanetObjectTextureNode gry);
//   • promień modelu stały (GEN_GAS_RADIUS — model obrazu: prędkości wiatru w opisie są dobrane do tego promienia),
//     rozmiar mapy w kontraście faz stały (texSize), czapy polarne bez osobnego ruchu (pas przy biegunie prawie stoi).
// Strona CPU planety: `createGenGasEngine(spec)` (model z opisu: segmenty pasów, rekordy, tekstura wiatru) i
// `GenGasAtmosphere` (zegar — GasGiantAtmosphere 1:1, tylko tablice należą do planety).
import * as THREE from 'three/webgpu';
import {
  GasGiantAtmosphere, GasGiantModel, bandRecords, vortexRecords, buildWindTexels, createWindTexture
} from '../gasGiantAtmosphere.js';
import { createGasGiantFlowDayColor } from '../gasGiantAtmosphere.tsl.js';
import { registerPlanetFlowKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';

export const GEN_GAS_RADIUS = 70e6;   // [m] — wspólny promień modelu obrazu
export const GEN_GAS_BAND_CAP = 48;
export const GEN_GAS_VORTEX_CAP = 12;
export const GEN_GAS_WIND_TEXELS = 512;
export const GEN_GAS_TEX_SIZE = Object.freeze([2048, 1024]);
export const GEN_GAS_BANDS = Object.freeze({ blendDeg: 0.6, minDeg: 1.8, vortexReach: 1.3, vortexPad: 0.3 });
export const GEN_GAS_UNIFORM_KEYS = Object.freeze({ uGgClock: 'vec4', uGgFlow: 'vec4', uGgTurb: 'vec4' });
/** Klucze `material.uniforms` z danymi planety (tablice Vector4 i tekstura wiatru). */
export const GEN_GAS_DATA_KEYS = Object.freeze({ bands: 'genGasBands', vortices: 'genGasVortices', wind: 'genGasWind' });

// Strojenie (jak JUPITER_ATM_TUNE; czytane co klatkę — wspólne dla planet generatora).
export const GEN_GAS_ATM_TUNE = {
  on: 1,
  timeScale: 4000,
  period: 9,
  desync: 0.7,
  contrast: 0.55,
  eddy: 24,
  eddyFloor: 0.3,
  eddyScaleU: 14,
  eddyScaleV: 11,
  vortexSpeed: 1.5,
  refPxPerTexel: 1.5,
  zoomFollow: 0.75,
  vortexZoomFollow: 0.3,
  zoomLag: 0.4
};

// ── Węzły per obiekt ──────────────────────────────────────────────────────────────────────────────────────────────
class PerObjectUniformArrayNode extends THREE.UniformArrayNode {
  static get type() { return 'PerObjectUniformArrayNode'; }
  constructor(key, cap) {
    super(Array.from({ length: cap }, () => new THREE.Vector4()), 'vec4');
    this.objectKey = key;
    this.updateType = THREE.NodeUpdateType.OBJECT;
    this._fallback = this.array;
  }
  update(frame) {
    const v = frame?.material?.uniforms?.[this.objectKey]?.value;
    this.array = (Array.isArray(v) && v.length === this._fallback.length) ? v : this._fallback;
    super.update(frame);
  }
}

class GenGasObjectTextureNode extends THREE.TextureNode {
  static get type() { return 'GenGasObjectTextureNode'; }
  get updateType() { return THREE.NodeUpdateType.OBJECT; }
  set updateType(_v) { /* stałe OBJECT */ }
  update(frame) {
    const value = frame.material?.uniforms?.[this.objectKey]?.value;
    this.value = (value && value.isTexture === true) ? value : this.objectFallback;
  }
  clone() {
    const node = super.clone();
    node.objectKey = this.objectKey;
    node.objectFallback = this.objectFallback;
    return node;
  }
}
function windFallback() {
  const t = new THREE.DataTexture(new Uint16Array([0, 0, 0, 15360]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

// ── Model grafu (jeden dla wszystkich planet generatora) ─────────────────────────────────────────────────────────
class GenGasGraphModel extends GasGiantModel {
  bandArray() {
    if (!this._bandArray) this._bandArray = new PerObjectUniformArrayNode(GEN_GAS_DATA_KEYS.bands, GEN_GAS_BAND_CAP).setName('genGasBands');
    return this._bandArray;
  }
  vortexArray() {
    if (!this._vortexArray) this._vortexArray = new PerObjectUniformArrayNode(GEN_GAS_DATA_KEYS.vortices, GEN_GAS_VORTEX_CAP * 3).setName('genGasVortices');
    return this._vortexArray;
  }
  windTexture() {
    if (!this._windTex) {
      const fb = windFallback();
      const n = new GenGasObjectTextureNode(fb, null);
      n.objectKey = GEN_GAS_DATA_KEYS.wind;
      n.objectFallback = fb;
      this._windTex = n;
    }
    return this._windTex;
  }
}

const MODEL_COMMON = {
  radius: GEN_GAS_RADIUS, bands: GEN_GAS_BANDS, bandCap: GEN_GAS_BAND_CAP, vortexCap: GEN_GAS_VORTEX_CAP,
  windTexels: GEN_GAS_WIND_TEXELS, turbFade: [58, 10], texSize: GEN_GAS_TEX_SIZE,
  names: { bands: 'genGasBands', vortices: 'genGasVortices', wind: 'genGasWind' },
  keys: { clock: 'uGgClock', flow: 'uGgFlow', turb: 'uGgTurb' }, tune: GEN_GAS_ATM_TUNE, poles: null
};
export const GEN_GAS_GRAPH_MODEL = new GenGasGraphModel({ id: 'genGas', windAt: () => 0, cuts: [-90, 90], vortices: [], ...MODEL_COMMON });

/** Barwa mapy dnia z przepływu dla grafu 'genGas' (wołana w Fn fragmentu grafu powierzchni). */
export const genGasFlowDayColor = createGasGiantFlowDayColor(GEN_GAS_GRAPH_MODEL);
registerPlanetFlowKind('genGas', { keys: GEN_GAS_UNIFORM_KEYS, color: genGasFlowDayColor, name: 'PlanetSurfaceGenGas' });

/** Materiał powierzchni olbrzyma generatora (uniformy jak DirectPlanet + klucze GEN_GAS_* — GenGasAtmosphere). */
export const createGenGasSurfaceMaterial = (uniforms) => new PlanetBodyNodeMaterial('genGas', uniforms);

// ── Model planety (CPU) ───────────────────────────────────────────────────────────────────────────────────────────
class GenGasPlanetModel extends GasGiantModel {
  bandArray() {
    if (!this._bandArray) this._bandArray = { array: bandRecords(this.segments, this.bandCap, this.id).map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w)) };
    return this._bandArray;
  }
  vortexArray() {
    if (!this._vortexArray) this._vortexArray = { array: vortexRecords(this.vortices, this.vortexCap, this.segments).map(([x, y, z, w]) => new THREE.Vector4(x, y, z, w)) };
    return this._vortexArray;
  }
}

/**
 * Silnik atmosfery planety z opisu (spec.look olbrzyma: windAt, cuts, vortices — planetGenSpec.js). Zwraca
 * { model, windTexture() } — model CPU z segmentami i rekordami dla GenGasAtmosphere.
 */
export function createGenGasEngine(spec) {
  const L = spec.look;
  const vortices = L.vortices.slice(0, GEN_GAS_VORTEX_CAP).map((v) => ({ ...v }));
  // za dużo segmentów (gęsty profil) — zgrubniej (minDeg × 1,5)
  let model = new GenGasPlanetModel({ id: `genGas:${spec.seed}`, windAt: L.windAt, cuts: L.cuts, vortices, ...MODEL_COMMON });
  if (model.segments.length > GEN_GAS_BAND_CAP) {
    model = new GenGasPlanetModel({ id: `genGas:${spec.seed}`, windAt: L.windAt, cuts: L.cuts, vortices,
      ...MODEL_COMMON, bands: { ...GEN_GAS_BANDS, minDeg: GEN_GAS_BANDS.minDeg * 1.5 } });
  }
  let windTex = null;
  return {
    model,
    windTexture() {
      if (!windTex) windTex = createWindTexture(buildWindTexels(L.windAt, GEN_GAS_WIND_TEXELS, 58, 10), GEN_GAS_WIND_TEXELS, `genGasWind:${spec.seed}`);
      return windTex;
    },
    dispose() { if (windTex) windTex.dispose(); windTex = null; }
  };
}

/**
 * Zegar żywej atmosfery planety generatora (GasGiantAtmosphere 1:1): dopisuje do `planet.uniforms` klucze zegara
 * (GEN_GAS_UNIFORM_KEYS) i dane planety (GEN_GAS_DATA_KEYS — tablice pasów i wirów, tekstura wiatru).
 */
export class GenGasAtmosphere extends GasGiantAtmosphere {
  constructor(engine, planet, dayTexture) {
    super(engine.model, planet, dayTexture);
    this.engine = engine;
    this.uniforms[GEN_GAS_DATA_KEYS.bands] = { value: this.bands.array };
    this.uniforms[GEN_GAS_DATA_KEYS.vortices] = { value: this.vortices.array };
    this.uniforms[GEN_GAS_DATA_KEYS.wind] = { value: engine.windTexture() };
  }
}
