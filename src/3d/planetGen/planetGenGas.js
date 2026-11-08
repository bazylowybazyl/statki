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
//     rozmiar mapy w kontraście faz stały (texSize);
//   • CZAPY POLARNE (GEN_GAS_POLES, granica 72°): ruch po okręgach wokół bieguna z profilu wiatru planety, jądro
//     obracane sztywnie (kąt z CPU) — jak Saturn, bez sześciokąta w przepływie (sześciokąt, gromady cyklonów albo mgła
//     są w mapie wypieku z ziarna, przepływ z mapą przepływu ich nie rozmywa);
//   • RUINY unoszące się (hak `surface` grafu gry, planetGenRuins.tsl.js) — świecą w dzień i w nocy;
//   • CIEŃ PIERŚCIENI na tarczy (ten sam hak): promień ku słońcu przecina płaszczyznę równika (pierścienie są
//     równikowe — normalna +Y w układzie kuli niezależnie od doby), krycie z profilu pierścieni (`ringTexture`).
// Strona CPU planety: `createGenGasEngine(spec)` (model z opisu: segmenty pasów, rekordy, tekstura wiatru) i
// `GenGasAtmosphere` (zegar — GasGiantAtmosphere 1:1, tylko tablice należą do planety).
import * as THREE from 'three/webgpu';
import {
  GasGiantAtmosphere, GasGiantModel, bandRecords, vortexRecords, buildWindTexels, createWindTexture
} from '../gasGiantAtmosphere.js';
import { createGasGiantFlowDayColor } from '../gasGiantAtmosphere.tsl.js';
import { registerPlanetFlowKind, PlanetBodyNodeMaterial } from '../planet3d.assets.tsl.js';
import { PerObjectUniformArrayNode, genObjectTexture, tinyTexture } from './planetGenNodes.js';
import { ruinsShade, RUIN_KEYS } from './planetGenRuins.tsl.js';
import { If, float, vec2, vec4, clamp, fwidth, length, max, normalize, smoothstep, abs, modelWorldMatrixInverse } from 'three/tsl';

export const GEN_GAS_RADIUS = 70e6;   // [m] — wspólny promień modelu obrazu
export const GEN_GAS_BAND_CAP = 48;
export const GEN_GAS_VORTEX_CAP = 12;
export const GEN_GAS_WIND_TEXELS = 512;
export const GEN_GAS_TEX_SIZE = Object.freeze([2048, 1024]);
export const GEN_GAS_BANDS = Object.freeze({ blendDeg: 0.6, minDeg: 1.8, vortexReach: 1.3, vortexPad: 0.3 });
export const GEN_GAS_UNIFORM_KEYS = Object.freeze({ uGgClock: 'vec4', uGgFlow: 'vec4', uGgTurb: 'vec4', uGgPole: 'vec4', uGgRing: 'vec4' });
/** Czapy polarne modelu (wspólne dla planet generatora — granica stała w grafie). */
export const GEN_GAS_POLES = Object.freeze({
  north: Object.freeze({ cap: 72, core: 3.5, blend: 2.5 }),
  south: Object.freeze({ cap: 72, core: 3.5, blend: 2.5 })
});
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
  zoomLag: 0.4,
  poleSpeed: 1
};

// ── Węzły per obiekt (planetGenNodes.js) ──────────────────────────────────────────────────────────────────────────
function windFallback() {
  return tinyTexture(new Uint16Array([0, 0, 0, 15360]), THREE.HalfFloatType);
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
      this._windTex = genObjectTexture(GEN_GAS_DATA_KEYS.wind, windFallback());
    }
    return this._windTex;
  }
}

const MODEL_COMMON = {
  radius: GEN_GAS_RADIUS, bands: GEN_GAS_BANDS, bandCap: GEN_GAS_BAND_CAP, vortexCap: GEN_GAS_VORTEX_CAP,
  windTexels: GEN_GAS_WIND_TEXELS, turbFade: [58, 10], texSize: GEN_GAS_TEX_SIZE,
  names: { bands: 'genGasBands', vortices: 'genGasVortices', wind: 'genGasWind' },
  keys: { clock: 'uGgClock', flow: 'uGgFlow', turb: 'uGgTurb', pole: 'uGgPole' }, tune: GEN_GAS_ATM_TUNE, poles: GEN_GAS_POLES
};
export const GEN_GAS_GRAPH_MODEL = new GenGasGraphModel({ id: 'genGas', windAt: () => 0, cuts: [-90, 90], vortices: [], ...MODEL_COMMON });

/** Barwa mapy dnia z przepływu dla grafu 'genGas' (wołana w Fn fragmentu grafu powierzchni). */
export const genGasFlowDayColor = createGasGiantFlowDayColor(GEN_GAS_GRAPH_MODEL);
// Profil pierścieni per obiekt (ta sama tekstura co siatka pierścieni; zastępcza przezroczysta).
const RING_FALLBACK = tinyTexture(new Uint8Array([0, 0, 0, 0]));
const ringProfileNode = genObjectTexture('ringTexture', RING_FALLBACK);

// Ruiny unoszące się nad olbrzymem: tylko świecenie (bez plamy gruzu), czas i siła z uGsMisc (jak planety z
// powierzchnią). Cień pierścieni: uGgRing = (wewnętrzny, zewnętrzny [R], krycie, 1 — są pierścienie).
function genGasSurface({ U, local, worldPos }) {
  const pixL = float(0.0).toVar();
  pixL.assign(length(fwidth(local)));
  const p = normalize(local).toVar();
  const ruins = ruinsShade({ p, pixL, U, time: U.uGsMisc.x, gain: U.uGsMisc.y, land: float(0.0) });
  const shadow = float(1.0).toVar();
  If(U.uGgRing.w.greaterThan(0.5), () => {
    const s = normalize(modelWorldMatrixInverse.mul(vec4(U.sunPosition.sub(worldPos), 0.0)).xyz).toVar();
    // promień p + t·s do płaszczyzny y = 0 (t > 0: punkt i słońce po przeciwnych stronach równika)
    const t = p.y.negate().div(s.y.add(1e-6)).toVar();
    If(t.greaterThan(0.0).and(abs(s.y).greaterThan(0.002)), () => {
      const h = p.add(s.mul(t));
      const r = length(vec2(h.x, h.z));
      const q = clamp(r.sub(U.uGgRing.x).div(max(U.uGgRing.y.sub(U.uGgRing.x), 1e-3)), 0.0, 1.0);
      const inRing = smoothstep(U.uGgRing.x.sub(0.01), U.uGgRing.x, r).mul(float(1.0).sub(smoothstep(U.uGgRing.y, U.uGgRing.y.add(0.01), r)));
      const a = ringProfileNode.sample(vec2(q, 0.5)).level(0).a;
      shadow.assign(float(1.0).sub(clamp(a.mul(U.uGgRing.z).mul(inRing).mul(0.9), 0.0, 0.9)));
    });
  });
  return { emit: ruins.emit, shadow };
}
registerPlanetFlowKind('genGas', {
  keys: { ...GEN_GAS_UNIFORM_KEYS, uGsMisc: 'vec4', ...RUIN_KEYS }, color: genGasFlowDayColor, surface: genGasSurface,
  name: 'PlanetSurfaceGenGas'
});

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
