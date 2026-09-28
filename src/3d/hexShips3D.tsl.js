// src/3d/hexShips3D.tsl.js
//
// Materiały kadłubów w TSL (port WebGPU, zadanie 04; docs/webgpu/PLAN.md §3).
// Odpowiednik dawnego GLSL z hexShips3D.js: HEX_FRAGMENT_SHADER (wspólny
// fragment), BEAM_SKIN_VERTEX (skóra kadłuba na belkach), HEX_VERTEX (siatka
// heksów), ARMOR_VERTEX (płyta pancerza LOD) i DEBRIS_* (pula szczątków GPU
// kadłubów heksowych). Obraz 1:1 z WebGL — te same wzory w tej samej kolejności.
//
// GRAF NA WARIANT, WARTOŚCI NA OBIEKT. W WebGL każdy kadłub miał własny
// ShaderMaterial (program z cache po źródle). W WebGPU nowy graf węzłów na encję
// to pełny NodeBuilder na CPU przy każdym spawnie (bitwy: 125–174 okręty). Tu:
//  - graf budowany RAZ na wariant (belki / heksy / pancerz / szczątki), a każdy
//    kadłub dostaje lekki materiał (HullNodeMaterial) z TYMI SAMYMI węzłami —
//    ten sam klucz programu (customProgramCacheKey), jeden NodeBuilder, jeden
//    pipeline na wariant;
//  - wartości per encja siedzą w `material.uniforms` (obiekty `{ value }` jak
//    w ShaderMaterial — kod aktualizacji w hexShips3D.js się nie zmienia), a
//    węzły grafu czytają je per obiekt: `uniform(...).onObjectUpdate(({ material })
//    => material.uniforms.X.value)`. Tekstury tak samo: węzeł `texture()` z
//    onObjectUpdate — three klonuje wiązania grupy „object” na każdy obiekt
//    renderu (NodeBuilderState.createBindings), więc każdy kadłub próbkuje swój
//    sprite / mapę kształtu przez to samo wiązanie w kodzie WGSL (sprawdzone:
//    NodeSampledTexture.update czyta textureNode.value w chwili rysowania);
//  - wartości wspólne (czas, strojenie światła, żar, lakier) to węzły z grupy
//    renderGroup — jeden zapis na klatkę dla wszystkich kadłubów;
//  - tablice lamp statku (64 × 3 vec4) i stref dysz (20 vec4) nie mieszczą się
//    rozsądnie w uniformach per obiekt (każdy uniformArray = osobny bufor
//    wysyłany w całości przy każdym rysowaniu): leżą w JEDNYM buforze storage
//    (HullLightStore) — slot na kadłub, zapis tylko przy zmianie podpisu lamp.
//
// Wyjątek three r183: każdy InstancedMesh ma w kluczu uuid obiektu
// (RenderObject.getMaterialCacheKey — „TODO” three), więc siatka heksów i pula
// szczątków GPU budują NodeBuilder per obiekt mimo wspólnego grafu (kod WGSL
// ten sam — moduł i pipeline GPU z cache). W grze heksy to dziś tylko wyłączone
// asteroidy; kadłuby okrętów (belki) i płyty pancerza idą bez tego kosztu.
//
// Zasady TSL portu (PLAN §3, POSTEP): funkcje z setLayout są CZYSTE (uniform
// w domknięciu = cudzy slot w drugim materiale, błąd r183); smoothstep
// z odwróconymi krawędziami liczony wzorem (WGSL nie gwarantuje builtinu przy
// low ≥ high); próbkowania z pochodnymi (textureSample, fwidth) w jednolitym
// przepływie sterowania — niejednolity warunek przez select() na końcu.
//
// Haki na przyszłe zadania (obraz dziś bez zmian):
//  - zadanie 18: mapa ran (bufor storage, uniformy per obiekt dmgBase/dmgW/
//    dmgH/dmgOn → perObject() niżej, próbkowanie po uv skóry, discard
//    przestrzelin, żar = max(żar skóry, żar mapy)) — hullDamageSurface /
//    hullDamageHeat; światła efektów z siatki świateł (12) — hullEffectLights;
//  - zadanie 21: ośrodek światła wolumetrycznego nowych asteroid — hullVolume.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Continue, Discard,
  float, int, vec2, vec3, vec4, nodeObject,
  uniform, attribute, storage, varying,
  positionGeometry, positionLocal, modelWorldMatrix, modelViewMatrix, cameraProjectionMatrix, uv,
  abs, clamp, cos, sin, dot, exp, fract, fwidth, length, max, min, mix, normalize, pow, select, smoothstep, sqrt, step,
  renderGroup
} from 'three/tsl';
import { MAX_SHADER_SHIP_LIGHTS, NAV_LIGHT_CHASE } from '../game/shipLightRuntime.js';
import { HullLacquer, MAX_ENGINE_ZONES } from './hullLacquer.js';
import { fieldDarkness, sunFill, sunShadeUnlit, sunVisibility } from './sunShadowMask.js';
import { warpBloomKnee } from './warp/bloomKnee.js';
import { getBeltMedium } from './asteroids/beltMedium.js';

// ── Maska słońca: JEDNO miejsce importu dla kadłubów, szczątków i smug wraków ──
// Funkcje TSL z sunShadowMask.js (zadanie 03): próbka maski Core3D po screenUV na
// wspólnych węzłach uniformów i tekstury — maska jest w grafie wariantu raz (graf na
// wariant, nie na kadłub), wiązania wspólne dla wszystkich materiałów.
export { fieldDarkness, sunFill, sunShadeUnlit, sunVisibility };

// ── Stałe i narzędzia ───────────────────────────────────────────────────────

// smoothstep wzorem (jak rozwija go HLSL): poprawny także dla e0 > e1 (lampy:
// smoothstep(radius, 0, dist)). WGSL nie gwarantuje builtinu przy low ≥ high.
const smoothRev = (e0, e1, x) => {
  const t = clamp(float(x).sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
};

// Rampa temperatury żaru (ciało doskonale czarne w skrócie): wiśnia →
// pomarańcz → żółć → biel. Wspólna dla kadłuba i odłamków, żeby ten sam metal
// miał tę samą barwę w obu miejscach. Barwa znormalizowana (kanał ≤ 1) —
// jasność dokłada wywołujący (kadłub i odłamki leżą w innych pasmach HDR).
export const heatRamp = /*@__PURE__*/ Fn(([h]) => {
  const c = mix(vec3(0.55, 0.04, 0.01), vec3(1.0, 0.30, 0.04), smoothstep(0.0, 0.45, h)).toVar();
  c.assign(mix(c, vec3(1.0, 0.70, 0.22), smoothstep(0.45, 0.75, h)));
  return mix(c, vec3(1.0, 0.93, 0.80), smoothstep(0.75, 1.0, h));
}).setLayout({ name: 'hullHeatRamp', type: 'vec3', inputs: [{ name: 'h', type: 'float' }] });

/** Lustro CPU rampy żaru (testy). */
export function heatRampCpu(h) {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let c = lerp([0.55, 0.04, 0.01], [1.0, 0.30, 0.04], ss(0, 0.45, h));
  c = lerp(c, [1.0, 0.70, 0.22], ss(0.45, 0.75, h));
  return lerp(c, [1.0, 0.93, 0.80], ss(0.75, 1.0, h));
}

// Tekstury zastępcze. Filtr liniowy: TSL wybiera ścieżkę próbkowania z tekstury
// obecnej przy BUDOWIE materiału (NEAREST = textureLoad bez filtrowania).
function placeholderTexture(r, g, b, a, colorSpace) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = colorSpace;
  t.needsUpdate = true;
  return t;
}
// Osobne obiekty na każde wiązanie: TextureNode dzieli wiązanie po uuid tekstury
// obecnej przy budowie — ta sama zastępcza w dwóch slotach skleiłaby je w jeden.
const PLACEHOLDER_SPRITE = placeholderTexture(0, 0, 0, 0, THREE.SRGBColorSpace);
// Wartości domyślne `material.uniforms` (osobne od zastępczych z budowy):
// kadłub bez tekstury (przezroczysty — odrzucany jak dawny pusty sampler) i bez
// mapy normalnych (płaska; próbkowana tylko przy uHasNormalMap = 1).
export const HULL_EMPTY_SPRITE_TEXTURE = placeholderTexture(0, 0, 0, 0, THREE.SRGBColorSpace);
export const HULL_FLAT_NORMAL_TEXTURE = placeholderTexture(128, 128, 255, 255, THREE.LinearSRGBColorSpace);
const PLACEHOLDER_NORMAL = placeholderTexture(128, 128, 255, 255, THREE.LinearSRGBColorSpace);
const PLACEHOLDER_SHAPE = placeholderTexture(0, 0, 0, 255, THREE.NoColorSpace);
const PLACEHOLDER_DEBRIS = placeholderTexture(0, 0, 0, 0, THREE.SRGBColorSpace);

// Wartość per obiekt: węzeł wspólny dla wszystkich materiałów wariantu, wartość
// z material.uniforms[klucz].value rysowanego obiektu.
function perObject(key, type, init) {
  return uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
}

// Tekstura per obiekt (sprite kadłuba, mapa normalnych, mapa kształtu lakieru).
// `texture().onObjectUpdate()` w three r183 NIE działa: TextureNode.setup sam
// ustawia updateType (OBJECT tylko przy macierzy uv albo flipY, inaczej NONE),
// a NodeBuilder zbiera węzły do aktualizacji dopiero po budowie — węzeł wypada
// z listy i każdy kadłub próbkowałby teksturę z chwili budowy (sprawdzone
// w Node: węzła nie ma w builder.updateNodes). Stąd updateType na stałe OBJECT
// (akcesor ignoruje zapisy konstruktora i setup) i własne update().
class HullObjectTextureNode extends THREE.TextureNode {
  static get type() {
    return 'HullObjectTextureNode';
  }

  get updateType() {
    return THREE.NodeUpdateType.OBJECT;
  }

  set updateType(_value) { /* stałe OBJECT — patrz wyżej */ }

  update(frame) {
    // Bez tekstury w materiale — zastępcza (inaczej został by sprite poprzedniego obiektu).
    const value = frame.material?.uniforms?.[this.hullKey]?.value;
    this.value = (value && value.isTexture === true) ? value : this.hullFallback;
  }

  clone() {
    const node = super.clone();
    node.hullKey = this.hullKey;
    node.hullFallback = this.hullFallback;
    return node;
  }
}

function perObjectTexture(key, placeholder, uvNode) {
  const node = new HullObjectTextureNode(placeholder, uvNode);
  node.hullKey = key;
  node.hullFallback = placeholder;
  return nodeObject(node);
}

// Próbka wspólnej tekstury (lakier) w podanym uv, bez macierzy uv tekstury
// (`sample()` na węźle bazowym bez uv włączałby updateMatrix — mat3 per obiekt).
const sampleShared = (base, uvNode) => base.sample(uvNode).setUpdateMatrix(false);
// Wartość wspólna (jeden zapis na klatkę dla wszystkich kadłubów).
const shared = (value, type = 'float') => uniform(value, type).setGroup(renderGroup);

// ── Wartości wspólne kadłubów (hexShips3D.js ustawia je raz na klatkę) ──────
// Strojenie światła statków (panel window.__shipLightTune) i żar: w WebGL
// pisane per mesh z kontrolą epoki — tu jeden zapis na klatkę.
export const HULL_SHARED = {
  uTime: shared(0),
  uStressTint: shared(0.30),
  uDayAmbient: shared(0.24),
  uDayDiffuseMul: shared(1.18),
  uSpecularMul: shared(0.30),
  // Żar: skóra belek (HULL_BODY_CONFIG) i heksy (DESTRUCTOR_CONFIG) — osobno.
  beamHeatDecay: shared(0.35),
  beamHeatPeak: shared(2.5),
  hexHeatDecay: shared(0.45),
  hexHeatPeak: shared(10.0)
};

// ── Bufor lamp i stref dysz (storage) ────────────────────────────────────────
// Slot na kadłub: MAX_SHADER_SHIP_LIGHTS × (dane, barwa, dodatki) + MAX_ENGINE_ZONES
// stref. Materiał czyta slot od `uLightBase` (w vec4) do liczników z uniformów.
export const HULL_LIGHT_SLOT_VEC4 = MAX_SHADER_SHIP_LIGHTS * 3 + MAX_ENGINE_ZONES;
export const HULL_LIGHT_ZONE_OFFSET = MAX_SHADER_SHIP_LIGHTS * 3;
export const HULL_LIGHT_SLOTS = 1024;

export const HullLightStore = {
  slotVec4: HULL_LIGHT_SLOT_VEC4,
  capacity: HULL_LIGHT_SLOTS,
  attribute: null,
  node: null,
  _free: [],
  _next: 0,
  _dirty: false,
  _warned: false,
  stats: { acquired: 0, released: 0, exhausted: 0, ranges: 0 },

  _ensure() {
    if (this.attribute) return;
    this.attribute = new THREE.StorageBufferAttribute(new Float32Array(this.capacity * this.slotVec4 * 4), 4);
    this.node = storage(this.attribute, 'vec4', this.capacity * this.slotVec4).toReadOnly().setName('hullLights');
  },

  getNode() {
    this._ensure();
    return this.node;
  },

  /** Wolny slot albo -1 (pula pełna — kadłub rysuje się bez lamp i stref). */
  acquire() {
    this._ensure();
    let slot = -1;
    if (this._free.length > 0) slot = this._free.pop();
    else if (this._next < this.capacity) slot = this._next++;
    if (slot < 0) {
      this.stats.exhausted++;
      if (!this._warned) {
        this._warned = true;
        console.warn(`[HullLightStore] pula ${this.capacity} slotów lamp kadłubów pełna — kolejne kadłuby bez lamp`);
      }
      return -1;
    }
    this.stats.acquired++;
    return slot;
  },

  release(slot) {
    if (!(slot >= 0)) return;
    this._free.push(slot);
    this.stats.released++;
  },

  /** Float32Array puli (zapis w miejscu) i przesunięcie slotu w floatach. */
  array() {
    this._ensure();
    return this.attribute.array;
  },
  slotFloatOffset(slot) {
    return slot * this.slotVec4 * 4;
  },

  /** Zakres [startVec4, startVec4 + countVec4) slotu do wysłania na GPU. */
  markDirty(slot, startVec4, countVec4) {
    if (!(slot >= 0) || !(countVec4 > 0)) return;
    const attr = this.attribute;
    attr.addUpdateRange((slot * this.slotVec4 + startVec4) * 4, countVec4 * 4);
    this._dirty = true;
    this.stats.ranges++;
  },

  /** Raz na klatkę (updateHexShips3D): jedna wersja atrybutu na wszystkie zakresy. */
  commit() {
    if (!this._dirty || !this.attribute) return;
    this.attribute.needsUpdate = true;
    this._dirty = false;
  }
};

// ── Węzły per obiekt (wspólne dla wariantów kadłuba) ─────────────────────────
let _perObjectNodes = null;
function hullPerObjectNodes() {
  if (_perObjectNodes) return _perObjectNodes;
  _perObjectNodes = {
    uHasNormalMap: perObject('uHasNormalMap', 'float', 0),
    uSpriteSize: perObject('uSpriteSize', 'vec2', new THREE.Vector2(1, 1)),
    uLightDir: perObject('uLightDir', 'vec3', new THREE.Vector3(0, 0, 1)),
    uRotation: perObject('uRotation', 'float', 0),
    uLodOpacity: perObject('uLodOpacity', 'float', 1),
    uBillboardLighting: perObject('uBillboardLighting', 'float', 0),
    uShipLightCount: perObject('uShipLightCount', 'float', 0),
    uEngineZoneCount: perObject('uEngineZoneCount', 'float', 0),
    uLightBase: perObject('uLightBase', 'float', 0),
    uLacquerWeight: perObject('uLacquerWeight', 'float', 0),
    uLacquerGlint: perObject('uLacquerGlint', 'float', 1),
    // Warp „Nurt” (zadanie 22, hullWarp niżej): A = (linia odsłaniania, tryb ±1, linia szwu,
    // szerokość szwu) [px sprite'a, x od środka ku dziobowi], B = (barwa szwu HDR, poziom mip
    // pasa żaru), C = (barwa żaru HDR, włącznik).
    uWarpA: perObject('uWarpA', 'vec4', new THREE.Vector4(-1e6, 1, -1e6, 1)),
    uWarpB: perObject('uWarpB', 'vec4', new THREE.Vector4(0, 0, 0, 4)),
    uWarpC: perObject('uWarpC', 'vec4', new THREE.Vector4(0, 0, 0, 0))
  };
  return _perObjectNodes;
}

// ── Warp „Nurt” (zadanie 22) ──────────────────────────────────────────────────
// Wartości per kadłub (hexShips3D.js: createHullUniforms — trzymacze czytają
// entity.__warpHullU, pisze je src/3d/warp/warpNurt.js); wyłączone = gałąź się nie
// wykonuje (jednolity warunek z uniformu obiektu) i kadłub liczy to samo co przed 22.
export const HULL_WARP_OFF = Object.freeze({
  a: new THREE.Vector4(-1e6, 1, -1e6, 1),
  b: new THREE.Vector4(0, 0, 0, 4),
  c: new THREE.Vector4(0, 0, 0, 0)
});

// Przylot / wyjście / odlot (dema/warp-webgpu/hulls.js): ODSŁANIANIE frontem (widać część
// kadłuba przed linią — wyjście od dziobu, albo za nią — odlot), SZEW (cienka gorąca linia
// na linii frontu, także nad schowaną częścią — alfa szwu) i ŻAR BRZEGU (biel → pomarańcz →
// wiśnia w pasie przy sylwetce). Pole odległości sylwetki z dema zastępuje tu rozmyta alfa
// sprite'a (poziom mip ≈ szerokość pasa żaru): przy krawędzi ~0,5, w głębi 1 — ta sama
// tekstura i wiązanie co sprite, jedna próbka z jawnym poziomem, bez nowych zasobów.
// Sprite kadłuba: dziób w stronę +u (spriteRotation = 0 dla wszystkich profili).
function hullWarp(ctx, out, alpha) {
  const P = hullPerObjectNodes();
  If(P.uWarpC.w.greaterThan(0.5), () => {
    const A = P.uWarpA;
    const B = P.uWarpB;
    const C = P.uWarpC;
    const lx = ctx.uv.x.sub(0.5).mul(P.uSpriteSize.x).toVar();
    const edge = max(fwidth(lx), 0.5).mul(1.5);
    const vis = smoothstep(edge.negate(), edge, lx.sub(A.x).mul(A.y)).toVar();
    const sx = lx.sub(A.z).div(max(A.w, 0.5));
    const seamOn = step(1e-4, B.x.add(B.y).add(B.z));
    const seamK = exp(sx.mul(sx).negate()).mul(seamOn).toVar();
    const blur = ctx.sprite.level(B.w).a;
    const rim = clamp(float(1.0).sub(blur).mul(2.0), 0.0, 1.0).toVar();
    // Kolano bloomu (warp/bloomKnee.js): demo liczyło bloom bez ×3 gry.
    const heat = warpBloomKnee(C.xyz.mul(rim.mul(rim).mul(0.85).add(rim.mul(0.15))));
    // Szew świeci także nad częścią już / jeszcze schowaną: alfa = max(odsłonięcie, szew).
    const k = max(vis, seamK).toVar();
    out.assign(out.add(heat).mul(vis).add(warpBloomKnee(B.xyz.mul(seamK))).div(max(k, 1e-4)));
    alpha.assign(alpha.mul(k));
    Discard(alpha.lessThan(0.004));
  });
}

// ── Haki (zadania 18 i 21) — dziś tożsamość, obraz bez zmian ────────────────

// AGENT: zadanie 18 — mapa ran: uniformy per obiekt dmgBase/dmgW/dmgH/dmgOn
// (perObject jak wyżej, wartości w material.uniforms — slot HullDamageMap),
// próbkowanie po ctx.uv (uv skóry = uv sprite'a, v = 0 u góry obrazu),
// osmalenie → ctx.albedo, przestrzelina `hole > 0,5` → Discard() (nie alfa:
// zapis głębi i cień mostka), żar mapy do ctx.damageHeat (hullDamageHeat).
function hullDamageSurface(/* ctx */) { }

// AGENT: zadanie 18 — żar = max(żar skóry, żar mapy ran), jedno źródło na
// piksel (brzeg rany 8–12 HDR, bez sumowania do przepalonej bieli).
function hullDamageHeat(ctx, skinHeat) {
  return skinHeat;
}

// AGENT: zadanie 18 — światła efektów z siatki świateł (zadanie 12): błyski,
// trafienia, wiązki jako DODATKOWE światła poszycia (× albedo, normalna
// ctx.worldNormal, pozycja świata z ctx.localWorld + ctx.originXY). Lampy
// statku (payload) zostają w pętli niżej.
function hullEffectLights(/* ctx */) {
  return vec3(0.0);
}

// Zadanie 21 — ośrodek światła wolumetrycznego pasa asteroid (src/3d/asteroids/beltMedium.js,
// jak HullNodeMaterial.setupOutput z dema/asteroidy-webgpu/ship.js): każda powierzchnia
// z zapisem głębi składa `kolor·a + rgb` (pył w kolumnie nad pancerzem, na wysokości
// fragmentu). Poza polem (włącznik ośrodka = 0) bez odczytu: a = 1, rgb = 0 — obraz bez
// zmian co do bitu. Uwaga: wyjście kadłuba NIE jest premultiplied (mieszanie SrcAlpha),
// więc rgb ośrodka na brzegu sylwetki dostaje × alfa od mieszania.
function hullVolume(/* ctx */) {
  return getBeltMedium().hullVolume();
}

// ── Fragment kadłuba (wspólny dla wariantów) ────────────────────────────────
//
// opts.spriteUV   vec2 (varying) — uv sprite'a, v = 0 u góry obrazu
// opts.shade      float|null — jasność blachy (skóra belek), null = 1
// opts.stress     float — naprężenie heksa (0 dla belek i płyty)
// opts.heat       vec2 — (szczyt żaru 0–1, znacznik czasu s)
// opts.localWorld vec2 (varying) — (world − początek mesha).xy, kierunki świata
// opts.lodOpacity float — przenikanie LOD (1 dla belek)
// opts.heatDecay / opts.heatPeak — wspólne węzły żaru wariantu
function hullFragmentNode(opts) {
  const P = hullPerObjectNodes();
  const L = HullLacquer.uniforms;
  const lights = HullLightStore.getNode();
  const uTime = HULL_SHARED.uTime;

  return Fn(() => {
    const spriteUV = opts.spriteUV.toVar();
    If(spriteUV.x.lessThan(-0.01).or(spriteUV.x.greaterThan(1.01)).or(spriteUV.y.lessThan(-0.01)).or(spriteUV.y.greaterThan(1.01)), () => {
      Discard();
    });

    const sprite = perObjectTexture('uSprite', PLACEHOLDER_SPRITE, spriteUV);
    const armorRgb = sprite.rgb.toVar();
    if (opts.shade) armorRgb.mulAssign(opts.shade);
    const alpha = sprite.a.mul(opts.lodOpacity).toVar();
    If(alpha.lessThan(0.01), () => {
      Discard();
    });

    const ctx = { uv: spriteUV, sprite, albedo: armorRgb, alpha, damageHeat: float(0.0), localWorld: opts.localWorld };
    hullDamageSurface(ctx);

    const out = vec3(0.0).toVar();

    // Asteroidy / billboardy: bez modelu światła, tylko maska słońca.
    If(P.uBillboardLighting.greaterThan(0.5), () => {
      out.assign(sunShadeUnlit(armorRgb));
    }).Else(() => {
      // Normalna: mapa normalnych albo „poduszka” z uv (środek sprite'a do kamery).
      const localNormal = vec3(0.0, 0.0, 1.0).toVar();
      If(P.uHasNormalMap.greaterThan(0.5), () => {
        const nTex = perObjectTexture('uNormalMap', PLACEHOLDER_NORMAL, spriteUV);
        localNormal.assign(normalize(nTex.rgb.mul(2.0).sub(1.0)));
      }).Else(() => {
        const p = spriteUV.mul(2.0).sub(1.0);
        localNormal.assign(normalize(vec3(p.x.mul(0.45), p.y.mul(-0.45), 1.0)));
      });

      const c = cos(P.uRotation).toVar();
      const s = sin(P.uRotation).toVar();
      const worldNormal = normalize(vec3(
        localNormal.x.mul(c).sub(localNormal.y.mul(s)),
        localNormal.x.mul(s).add(localNormal.y.mul(c)),
        localNormal.z
      )).toVar();
      ctx.worldNormal = worldNormal;

      const lightDir = P.uLightDir;
      const NdotL = dot(worldNormal, lightDir).toVar();
      const dayDiffuse = max(0.0, NdotL).toVar();
      // Cień planety albo innego kadłuba (maska Core3D) gasi słońce: rozproszone,
      // połysk i odblask lakieru, a otoczenie przygasa (sunFill). Światła statku,
      // glow, stres i żar ran świecą w cieniu jak poza nim.
      const sunVis = sunVisibility().toVar();
      const sunlitColor = armorRgb.mul(HULL_SHARED.uDayAmbient.add(dayDiffuse.mul(HULL_SHARED.uDayDiffuseMul))).toVar();
      const lightMul = HULL_SHARED.uDayAmbient.mul(sunFill(sunVis)).add(dayDiffuse.mul(HULL_SHARED.uDayDiffuseMul).mul(sunVis));
      const color = armorRgb.mul(lightMul).toVar();

      const halfVector = normalize(lightDir.add(vec3(0.0, 0.0, 1.0)));
      const spec = pow(max(dot(worldNormal, halfVector), 0.0), 32.0);
      const litMask = smoothstep(-0.02, 0.08, NdotL);
      color.addAssign(vec3(spec.mul(HULL_SHARED.uSpecularMul).mul(litMask).mul(sunVis)));
      sunlitColor.addAssign(vec3(spec.mul(HULL_SHARED.uSpecularMul).mul(litMask)));

      // Glow (niebieskie elementy sprite'a) z koloru w PEŁNYM słońcu; w mroku
      // gęstego pola asteroid przygasa (zostaje ~30%).
      const isGlowing = step(0.6, sunlitColor.z).mul(step(sunlitColor.x, 0.5));
      const fieldLit = float(1.0).sub(fieldDarkness()).toVar();
      const finalColor = color.add(sunlitColor.mul(isGlowing).mul(1.5).mul(fieldLit.mul(0.7).add(0.3))).toVar();

      const spriteSize = P.uSpriteSize;
      const fragPx = spriteUV.mul(spriteSize).toVar();
      const base = int(P.uLightBase).toVar();

      // --- LAKIER: odbicie kosmosu + odblask słońca (hullLacquer.js) ---
      // Stoi PO isGlowing (niebieskawe odbicie przed nim podbiłoby cały kadłub ×2,5)
      // i PRZED lampami (lampy są emisyjne — lakier ich nie przyciemnia). Waga gaśnie
      // przy sylwetce i w strefach dysz.
      const lacquerW0 = P.uLacquerWeight.mul(L.uLacquerA.x);
      If(lacquerW0.greaterThan(0.001), () => {
        // Warunek wyżej jest jednolity (uniformy obiektu). Wewnątrz wszystko liczy
        // się w jednolitym przepływie (próbkowania z pochodnymi, fwidth), a
        // niejednolite „lacquerW > 0,001” z GLSL wybiera wynik na końcu (select).
        const shape = perObjectTexture('uShapeMap', PLACEHOLDER_SHAPE, spriteUV);
        const lacquerW = lacquerW0.mul(shape.z).toVar();
        Loop({ start: int(0), end: int(P.uEngineZoneCount), type: 'int', condition: '<' }, ({ i }) => {
          const zone = lights.element(base.add(HULL_LIGHT_ZONE_OFFSET).add(i));
          lacquerW.mulAssign(smoothstep(zone.z, zone.z.mul(1.5), length(fragPx.sub(zone.xy))));
        });
        const coatN = vec3(0.0).toVar();
        If(P.uHasNormalMap.greaterThan(0.5), () => {
          coatN.assign(localNormal);
        }).Else(() => {
          coatN.assign(vec3(shape.xy, sqrt(max(0.0, float(1.0).sub(dot(shape.xy, shape.xy))))));
        });
        const N = normalize(vec3(
          coatN.x.mul(c).sub(coatN.y.mul(s)),
          coatN.x.mul(s).add(coatN.y.mul(c)),
          coatN.z
        )).toVar();
        // Patrzymy prosto z góry, jak kamera ortho — kierunek NIE zależy od kamery.
        const NdotV = max(N.z, 0.001).toVar();
        const R = vec3(N.xy.mul(NdotV.mul(2.0)), NdotV.mul(2.0).mul(N.z).sub(1.0)).toVar();
        const fresnel = L.uLacquerA.y.add(float(1.0).sub(L.uLacquerA.y).mul(pow(float(1.0).sub(NdotV), 5.0))).toVar();
        // Podwójna paraboloida: zenit w środku tekstury, horyzont na okręgu.
        const envUV = R.xy.mul(0.5).div(abs(R.z).add(1.0)).add(0.5).toVar();
        const hemi = smoothstep(-0.35, 0.15, R.z);
        const envTex = sampleShared(L.uLacquerEnv, envUV);
        const env = min(envTex.rgb.mul(L.uLacquerA.z), vec3(L.uLacquerA.w)).add(envTex.a.mul(L.uLacquerB.x)).mul(hemi).toVar();
        const envBlur = min(sampleShared(L.uLacquerEnv, envUV).level(L.uLacquerC.z).rgb.mul(L.uLacquerA.z), vec3(L.uLacquerA.w)).mul(hemi).toVar();
        // Bliskie obłoki zakotwiczone w świecie: pozycja statku × drift + offset
        // w kadłubie (1:1) + wygięcie od R. Offset liczony w wierzchołku jako
        // kierunek (bez odejmowania dwóch pozycji ~7 mln j. we float32).
        const originXY = modelWorldMatrix.element(3).xy;
        const skyP = originXY.mul(L.uLacquerD.y).add(opts.localWorld).add(R.xy.mul(L.uLacquerD.z.div(max(R.z, 0.05))));
        const skyUV = skyP.mul(L.uLacquerD.x).toVar();
        const skyW = smoothstep(0.02, 0.3, R.z).mul(L.uLacquerE.z).mul(L.uLacquerD.w).toVar();
        const skyTex = sampleShared(L.uLacquerSky, skyUV).rgb.toVar();
        const skyLum = dot(skyTex, vec3(0.2126, 0.7152, 0.0722));
        env.addAssign(skyTex.mul(skyW.mul(L.uLacquerE.x.mul(smoothstep(0.35, 0.8, skyLum)).add(1.0))));
        envBlur.addAssign(sampleShared(L.uLacquerSky, skyUV).level(L.uLacquerE.y).rgb.mul(skyW));
        // Specular AA: gdzie normalna szybko zmienia się na ekranie, płat się
        // poszerza i ciemnieje (energia ~stała), zamiast migotać iskrami.
        const dN = fwidth(N);
        const nVar = dot(dN, dN);
        const glintExp = L.uLacquerB.z.div(L.uLacquerB.z.mul(nVar).add(1.0)).toVar();
        const sheenExp = L.uLacquerC.x.div(L.uLacquerC.x.mul(nVar).add(1.0)).toVar();
        // „Słońce odblasków”: azymut prawdziwego słońca, podniesione o uLacquerC.w (rad).
        const sunXY = lightDir.xy.div(max(length(lightDir.xy), 1e-4));
        const glintL = vec3(sunXY.mul(cos(L.uLacquerC.w)), sin(L.uLacquerC.w));
        const RdotL = max(dot(R, glintL), 0.0).toVar();
        const lobe = pow(RdotL, glintExp).mul(L.uLacquerB.y).mul(glintExp.div(L.uLacquerB.z)).mul(P.uLacquerGlint)
          .add(pow(RdotL, sheenExp).mul(L.uLacquerB.w).mul(sheenExp.div(L.uLacquerC.x))).mul(sunVis);
        // Odbicie kosmosu i odblask gasną w mroku pola (pył zasłania niebo).
        const coat = fresnel.mul(env.add(lobe)).mul(fieldLit).add(armorRgb.mul(envBlur).mul(L.uLacquerC.y).mul(fieldLit));
        const coated = finalColor.mul(float(1.0).sub(fresnel.mul(lacquerW))).add(coat.mul(lacquerW));
        finalColor.assign(select(lacquerW.greaterThan(0.001), coated, finalColor));
      });

      // --- LAMPY STATKU (payload shipLightRuntime, slot w HullLightStore) ---
      // Typ w barwie.a: 0 lampa pozycyjna, 1 reflektor dziobu, 2 rozlew grupy lamp
      // innego statku (bez rdzenia), 3 reflektor otoczenia.
      Loop({ start: int(0), end: int(P.uShipLightCount), type: 'int', condition: '<' }, ({ i }) => {
        const k = base.add(i.mul(3)).toVar();
        const lightData = lights.element(k).toVar();
        const lightColor = lights.element(k.add(1)).toVar();
        const lightExtra = lights.element(k.add(2)).toVar();

        const toFrag = fragPx.sub(lightData.xy).toVar();
        const distPx = length(toFrag).toVar();
        const radiusPx = max(0.5, lightData.z).toVar();
        const power = max(0.0, lightData.w).toVar();
        const lampColor = lightColor.xyz;
        const lightType = lightColor.w.toVar();

        // Typ 2: grupa lamp pozycyjnych INNEGO statku — sama poświata na pancerzu
        // (× albedo — błysk wydobywa detal kadłuba z mroku).
        If(lightType.greaterThan(1.5).and(lightType.lessThan(2.5)), () => {
          const xr = clamp(distPx.div(max(1.0, lightExtra.z)), 0.0, 1.0);
          const spill = float(1.0).sub(xr.mul(xr));
          finalColor.addAssign(lampColor.mul(power).mul(spill.mul(spill)).mul(armorRgb.mul(0.35).add(0.02)));
          Continue();
        });

        // Sekwencja „pasa startowego”: ta sama formuła co billboardy blasku
        // (shipLights3D), stałe z NAV_LIGHT_CHASE, przebieg od dziobu ku rufie (+).
        const localPhase = clamp(lightData.x.div(max(1.0, spriteSize.x)), 0.0, 1.0);
        const chase = fract(uTime.mul(NAV_LIGHT_CHASE.speed).add(localPhase.mul(NAV_LIGHT_CHASE.phaseGain))).toVar();
        const chasePulse = smoothstep(0.0, NAV_LIGHT_CHASE.attack, chase)
          .mul(float(1.0).sub(smoothstep(NAV_LIGHT_CHASE.hold, NAV_LIGHT_CHASE.release, chase)));
        const sequenceMul = select(lightType.greaterThan(0.5), float(1.0), mix(float(NAV_LIGHT_CHASE.rest), float(1.35), chasePulse));

        const core = smoothRev(radiusPx, 0.0, distPx);
        // Lampa pozycyjna rozlewa się szerzej niż reflektor: 9 promieni zamiast 7.
        const isNav = step(lightType, 0.5).toVar();
        const glow = smoothRev(radiusPx.mul(mix(7.0, 9.0, isNav)), 0.0, distPx);
        finalColor.addAssign(lampColor.mul(power).mul(sequenceMul).mul(core.mul(1.15).add(glow.mul(mix(0.50, 0.62, isNav)))));

        // Zasięg 0 = lampa bez stożka na tym kadłubie (własny reflektor otoczenia).
        If(lightType.greaterThan(0.5).and(lightExtra.z.greaterThan(0.0)), () => {
          const dir = normalize(lightExtra.xy).toVar();
          const along = dot(toFrag, dir).toVar();
          const coneCos = clamp(lightExtra.w, -0.98, 0.999).toVar();
          const rangePx = max(radiusPx.mul(2.0), lightExtra.z).toVar();
          const frontMask = step(0.0, along);
          const rangeMask = float(1.0).sub(smoothstep(rangePx.mul(0.18), rangePx, along)).toVar();
          // Reflektor otoczenia innego statku: zanik jak światło pola (okno do zera
          // × 1/(1 + k x²)).
          If(lightType.greaterThan(2.5), () => {
            const xr = clamp(along.div(rangePx), 0.0, 1.0);
            const win = float(1.0).sub(xr.mul(xr));
            rangeMask.assign(win.mul(win).div(xr.mul(xr).mul(6.0).add(1.0)));
          });
          const angleCos = dot(normalize(toFrag.add(dir.mul(0.001))), dir);
          const coneMask = smoothstep(coneCos, min(0.999, coneCos.add(0.16)), angleCos);
          const nearMask = float(1.0).sub(smoothstep(radiusPx.mul(0.8), radiusPx.mul(2.2), distPx));
          const beam = frontMask.mul(rangeMask).mul(coneMask).mul(float(1.0).sub(nearMask));
          finalColor.addAssign(lampColor.mul(power).mul(beam).mul(select(lightType.greaterThan(2.5), float(0.3), float(0.16))));
        });
      });

      finalColor.addAssign(hullEffectLights(ctx));

      // Naprężenie (heksy) — kanał osobny od żaru.
      if (opts.stress) {
        const stress = clamp(opts.stress.div(20.0), 0.0, 1.0);
        finalColor.addAssign(vec3(1.0, 0.25, 0.05).mul(stress.mul(HULL_SHARED.uStressTint).mul(3.5)));
      }

      // ŻAR brzegu rany i powierzchni tarcia: gaśnie z własnym zegarem (także gdy
      // siatka śpi). Jasność ~ 0,26h + 0,74h⁴ (Stefan–Boltzmann w skrócie): świeży
      // żar sięga uHeatPeak (8–12, biel z bloomem), h = 0,45 ≈ 1,3 — pomarańcz tuż
      // pod progiem bloomu, a wiśnia tli się długo nisko.
      if (opts.heat) {
        const skinHeat = opts.heat.x.mul(exp(max(0.0, uTime.sub(opts.heat.y)).mul(opts.heatDecay).negate()));
        const heat = hullDamageHeat(ctx, skinHeat).toVar();
        const heat2 = heat.mul(heat).toVar();
        finalColor.addAssign(heatRamp(heat).mul(opts.heatPeak.mul(heat.mul(0.26).add(heat2.mul(heat2).mul(0.74)))));
      }

      out.assign(finalColor);
    });

    const vol = hullVolume(ctx);
    out.assign(out.mul(vol.a).add(vol.rgb));

    hullWarp(ctx, out, alpha);

    return vec4(out, alpha);
  })();
}

// Offset fragmentu od początku mesha w KIERUNKACH świata (w = 0): lakier
// potrzebuje (world − origin).xy; bez odejmowania dwóch dużych liczb float32.
const localWorldOf = (localPos) => varying(modelWorldMatrix.mul(vec4(localPos.xy, 0.0, 0.0)).xy, 'vHullLocalWorld');

// ── Warianty ────────────────────────────────────────────────────────────────

const _variants = new Map();

/**
 * Graf wariantu (raz na moduł): 'beam' — skóra kadłuba na belkach (czworokąt na
 * węzeł, uv sprite'a, jasność blachy, żar węzła); 'hex' — siatka heksów
 * (InstancedMesh: kotwica uv aGridPos, naprężenie, żar); 'armor' — płyta
 * pancerza (jeden quad, bez żaru i naprężenia).
 */
export function getHullVariant(name) {
  let v = _variants.get(name);
  if (v) return v;
  if (name === 'beam') {
    v = {
      name,
      side: THREE.DoubleSide, // zgnieciony czworokąt potrafi się przewrócić
      positionNode: null,
      fragmentNode: hullFragmentNode({
        spriteUV: uv(),
        shade: attribute('aShade', 'float'),
        stress: null,
        heat: attribute('aHeat', 'vec2'),
        localWorld: localWorldOf(positionGeometry),
        lodOpacity: float(1.0),
        heatDecay: HULL_SHARED.beamHeatDecay,
        heatPeak: HULL_SHARED.beamHeatPeak
      })
    };
  } else if (name === 'hex') {
    const P = hullPerObjectNodes();
    v = {
      name,
      side: THREE.FrontSide,
      positionNode: null,
      fragmentNode: hullFragmentNode({
        // Kotwica uv = pozycja heksa w siatce BEZ deformacji (aGridPos) + wierzchołek.
        spriteUV: varying(attribute('aGridPos', 'vec2').add(positionGeometry.xy).div(P.uSpriteSize), 'vHexSpriteUV'),
        shade: null,
        stress: attribute('aStress', 'float'),
        heat: attribute('aHeat', 'vec2'),
        // positionLocal po instancjonowaniu (instanceMatrix · pozycja).
        localWorld: localWorldOf(positionLocal),
        lodOpacity: P.uLodOpacity,
        heatDecay: HULL_SHARED.hexHeatDecay,
        heatPeak: HULL_SHARED.hexHeatPeak
      })
    };
  } else if (name === 'armor') {
    const P = hullPerObjectNodes();
    v = {
      name,
      side: THREE.FrontSide,
      positionNode: null,
      fragmentNode: hullFragmentNode({
        spriteUV: uv(),
        shade: null,
        // Płyta to jeden quad na cały kadłub — bez naprężenia i żaru (rozżarzone
        // heksy wnętrza rysują się nad nią osobno, shouldRenderHybridShard).
        stress: null,
        heat: null,
        localWorld: localWorldOf(positionGeometry),
        lodOpacity: P.uLodOpacity,
        heatDecay: HULL_SHARED.hexHeatDecay,
        heatPeak: HULL_SHARED.hexHeatPeak
      })
    };
  } else {
    throw new Error(`hexShips3D.tsl: nieznany wariant kadłuba „${name}”`);
  }
  _variants.set(name, v);
  return v;
}

/**
 * Materiał kadłuba: lekki obiekt z grafem wariantu i wartościami per encja
 * w `uniforms` (obiekty `{ value }`, jak ShaderMaterial). Wszystkie materiały
 * wariantu mają ten sam klucz programu — jeden NodeBuilder i jeden pipeline.
 * W `uniforms` tylko obiekty (klucz materiału three bierze liczby z pól
 * materiału jako 0/1 — wartość per encja w polu materiału rozbiłaby klucz).
 */
export class HullNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'HullNodeMaterial';
  }

  constructor(variantName, uniforms) {
    super();
    const variant = getHullVariant(variantName);
    this.isHullNodeMaterial = true;
    this.name = `hull:${variant.name}`;
    this.uniforms = uniforms;
    this.lights = false;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = true;
    this.depthTest = true;
    this.side = variant.side;
    // Przezroczysty DoubleSide WebGPU rysowałby dwa razy (tył, przód) — WebGL
    // (ShaderMaterial) rysował raz.
    this.forceSinglePass = true;
    this.positionNode = variant.positionNode;
    this.fragmentNode = variant.fragmentNode;
  }
}

/** Czy materiał to kadłub z grafem wariantu (testy, spis). */
export function isHullNodeMaterial(material) {
  return material?.isHullNodeMaterial === true;
}

// ── Pula szczątków GPU kadłubów heksowych (DEBRIS_*) ─────────────────────────
// InstancedMesh (CircleGeometry(25, 6)) z atrybutami instancji: start, prędkość,
// obrót, czas, kotwica uv, żar w chwili oderwania. Pozycja świata w wierzchołku,
// mesh w początku układu (jak w WebGL: projekcja × widok × pozycja świata).

export const DEBRIS_SHARED = {
  uHeatDecay: shared(0.45),
  uHeatTint: shared(1.0)
};

let _debrisGraph = null;
function debrisGraph() {
  if (_debrisGraph) return _debrisGraph;
  const uTime = perObject('uTime', 'float', 0);
  const uSpriteSize = perObject('uSpriteSize', 'vec2', new THREE.Vector2(1, 1));
  const uLightDir = perObject('uLightDir', 'vec3', new THREE.Vector3(0, 0, 1));
  const uDayAmbient = perObject('uDayAmbient', 'float', 0.24);
  const uDayDiffuseMul = perObject('uDayDiffuseMul', 'float', 1.18);

  const aGridPos = attribute('aGridPos', 'vec2');
  const aStartPos = attribute('aStartPos', 'vec2');
  const aStartVel = attribute('aStartVel', 'vec2');
  const aRot = attribute('aRotationData', 'vec3');
  const aTime = attribute('aTimeData', 'vec2');
  const aHeat = attribute('aHeat', 'float');

  const age = uTime.sub(aTime.x);
  const lifetime = aTime.y;
  const vAlpha = float(1.0).sub(smoothstep(lifetime.mul(0.72), lifetime, age));

  const vertexNode = Fn(() => {
    const k = 0.16;
    const distMul = float(1.0).sub(exp(age.mul(-k))).div(k);
    const currentPos = aStartPos.add(aStartVel.mul(distMul));
    const currentAngle = aRot.x.add(aRot.y.mul(age));
    const scaled = positionGeometry.xy.mul(aRot.z).toVar();
    const c = cos(currentAngle).toVar();
    const s = sin(currentAngle).toVar();
    const rotated = vec2(scaled.x.mul(c).sub(scaled.y.mul(s)), scaled.x.mul(s).add(scaled.y.mul(c)));
    const worldPosition = vec3(currentPos.x.add(rotated.x), currentPos.y.add(rotated.y).negate(), 0.0);
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(worldPosition, 1.0)));
    // Martwy (poza życiem albo wygaszony) — poza obcięciem, jak vec4(2, 2, 2, 1) w GLSL.
    const dead = age.lessThan(0.0).or(lifetime.lessThanEqual(0.0)).or(age.greaterThan(lifetime)).or(vAlpha.lessThanEqual(0.01));
    return select(dead, vec4(2.0, 2.0, 2.0, 1.0), clip);
  })();

  const vSpriteUV = varying(aGridPos.add(positionGeometry.xy).div(uSpriteSize), 'vDebrisUV');
  const vAlphaV = varying(vAlpha, 'vDebrisAlpha');
  const vAge = varying(age, 'vDebrisAge');
  // Geometria odłamka to CircleGeometry(25, 6) — promień znormalizowany = maska
  // urwanej krawędzi, na której zbiera się żar.
  const vEdge = varying(length(positionGeometry.xy).div(25.0), 'vDebrisEdge');
  const vHeat = varying(aHeat, 'vDebrisHeat');

  const fragmentNode = Fn(() => {
    const suv = vSpriteUV.toVar();
    If(suv.x.lessThan(-0.01).or(suv.x.greaterThan(1.01)).or(suv.y.lessThan(-0.01)).or(suv.y.greaterThan(1.01)), () => {
      Discard();
    });
    const color = perObjectTexture('uSprite', PLACEHOLDER_DEBRIS, suv).toVar();
    If(color.a.lessThan(0.01), () => {
      Discard();
    });
    const p = suv.mul(2.0).sub(1.0);
    const normal = normalize(vec3(p.x.mul(0.45), p.y.mul(-0.45), 1.0));
    const NdotL = max(0.0, dot(normal, uLightDir));
    // Cień (maska Core3D) gasi słońce i przygasza otoczenie — żar krawędzi zostaje.
    const sunVis = sunVisibility().toVar();
    const lightMul = uDayAmbient.mul(sunFill(sunVis)).add(NdotL.mul(uDayDiffuseMul).mul(sunVis));
    const rgb = color.rgb.mul(lightMul).toVar();
    // Żar na URWANYCH KRAWĘDZIACH, jasność liniowa i niska (debrisHeatGlow ~1):
    // odłamki zostają w paśmie barwy — główny żar ma być na kadłubie.
    const edge = smoothstep(0.5, 1.0, vEdge);
    const heat = vHeat.mul(exp(vAge.mul(DEBRIS_SHARED.uHeatDecay).negate())).toVar();
    rgb.addAssign(heatRamp(heat).mul(heat).mul(DEBRIS_SHARED.uHeatTint).mul(edge.mul(0.65).add(0.35)));
    return vec4(rgb, color.a.mul(vAlphaV));
  })();

  _debrisGraph = { vertexNode, fragmentNode };
  return _debrisGraph;
}

/** Materiał puli szczątków GPU: wartości puli (sprite, rozmiar, czas, słońce) w `uniforms`. */
export class HullDebrisNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'HullDebrisNodeMaterial';
  }

  constructor(uniforms) {
    super();
    const g = debrisGraph();
    this.isHullDebrisNodeMaterial = true;
    this.name = 'hull:debris';
    this.uniforms = uniforms;
    this.lights = false;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = false;
    this.side = THREE.DoubleSide;
    this.forceSinglePass = true;
    this.vertexNode = g.vertexNode;
    this.fragmentNode = g.fragmentNode;
  }

  // Pozycję świata liczy vertexNode z atrybutów instancji. Bez tego three dokłada
  // instancjonowanie InstancedMesh (macierz instancji + normalne) — kod martwy, ale
  // dwa bufory wierzchołków więcej: 9 > maxVertexBuffers (8) i pipeline nie powstaje.
  setupPosition() {
    return positionLocal;
  }
}

// Eksport węzłów do testów struktury grafu (bez GPU).
export const HULL_TSL_INTERNALS = Object.freeze({
  hullPerObjectNodes,
  debrisGraph,
  smoothRev,
  HullObjectTextureNode,
  PLACEHOLDER_SPRITE,
  PLACEHOLDER_SHAPE
});
