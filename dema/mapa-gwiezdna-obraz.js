// ============================================================
// Mapa gwiezdna — OBRAZ (dema/mapa-gwiezdna.html): warstwy GPU strefy międzygwiezdnej, three r183 WebGPU + TSL.
//
//   1. TŁO — wypiek stylu „galaktyka” (src/3d/skybake/, nastawa `gra`, bez gwiazd) na pełnoekranowym
//      czworokącie z małą paralaksą + gwiazdy w ROZDZIELCZOŚCI EKRANU (skyStarField z src/3d/skyStars.tsl.js
//      — jak niebo gry: tekstura niesie gładkie warstwy, gwiazdy liczone na piksel).
//   2. MGŁAWICE — MGIEŁKA ROZGRYWKI: gęstość mgławicy liczona w shaderze tym samym szumem co rozgrywka
//      (port 1:1 `nebulaDensityAt` / `fbm2` z src/game/sector/ — hasz u32 lowbias32) — słaba poświata
//      pokazuje, gdzie mgławica naprawdę spowalnia i zasłania; nad nią obraz: każda mgławica sektora (elipsa z danych rozgrywki, src/game/sector/) to duszek z wypieku
//      stylu „mgławica” (objętość, lampy, emisja Hα / O III); sześć wariantów nastaw (`gra`, `kolorowa`,
//      `rozeta`, `filary`, `fiolet`, `pylowa`) wypiekanych RAZ przy starcie (1280 × 800), rodzaj mgławicy
//      wybiera wariant. Ciemne mgławice zasłaniają tło (mieszanie zwykłe), reszta świeci (addytywnie).
//   3. SZLAKI handlowe rdzenia — odcinki.
//   4. GWIAZDY UKŁADÓW — kwady instancjonowane, barwa i rozmiar z klasy, rdzeń HDR (> 1 — bloom);
//      widoczność z mgły eksploracji (ukryte układy nie świecą).
//   5. BURZE — wir (słaba spirala krążąca z komórką burzy, położenie z danych: stormPosition) i błyski
//      (pula kwadów, losowane `fxRandom` — losowość obrazu, nie danych).
// Post: bloom gry (BloomGry, BLOOM_DEFAULTS) → ACES gry → sRGB — jak niebo-webgpu.
// Jednostki sceny = lata świetlne strefy; osie sceny: X = x, Y = −y (y gry w dół).
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, atan, attribute, clamp, cos, dot, exp, float, floor, int, length, max, mix, pass, positionGeometry, screenUV, sin, smoothstep,
  texture, uint, uniform, varyingProperty, vec2, vec3, vec4, nodeObject
} from 'three/tsl';
import { SkyBaker } from '../src/3d/skybake/skyBaker.js';
import { createGalaktykaStyle } from '../src/3d/skybake/styleGalaktyka.js';
import { createMglawicaStyle } from '../src/3d/skybake/styleMglawica.js';
import { acesGryInv } from '../src/3d/skybake/skyGameColor.js';
import { acesGry, linearDoSrgb } from '../src/3d/tsl/kolorGry.js';
import { skyStarField } from '../src/3d/skyStars.tsl.js';
import { BloomGry } from '../src/3d/tsl/postGry.js';
import { BLOOM_DEFAULTS } from '../src/3d/bloomConfig.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';
import { hashU32, starColorRgb, STAR_CLASSES, stormPosition, EXPLORE } from '../src/game/sector/index.js';

/** Warianty wypieku mgławic: nastawa stylu „mgławica” + nadpisania kompozycji (masa w środku duszka). */
export const NEBULA_VARIANTS = Object.freeze([
  { name: 'gra', preset: 'gra' },
  { name: 'kolorowa', preset: 'kolorowa' },
  { name: 'rozeta', preset: 'rozeta' },
  { name: 'filary', preset: 'filary' },
  { name: 'fiolet', preset: 'fiolet' },
  { name: 'pylowa', preset: 'pylowa' }
]);
/** Rodzaj mgławicy (dane sektora) → warianty wypieku. */
const KIND_VARIANTS = Object.freeze({
  emisyjna: [0, 1, 2],
  fioletowa: [4, 1],
  pylowa: [3, 5],
  ciemna: [5]
});
const NEBULA_BAKE_SIZE = Object.freeze({ width: 1280, height: 800 });
const BG_BAKE_SIZE = Object.freeze({ width: 2560, height: 1600 });
/** Kompozycja duszka: masa główna w środku, wydłużona wzdłuż x (elipsa danych), bez mgiełki tła (brzegi czarne). */
const SPRITE_COMPOSITION = Object.freeze({ srodekX: 0, srodekY: 0, kat: 0, wydluzenie: 1.45, rozmiar: 0.3, masyRozmiar: 0.55, mgielka: 0, gwiazdy: 0 });
/** Duszek sięga 1,3 × półosi elipsy (miękki brzeg poza elipsą rozgrywki). */
const SPRITE_EXTENT = 1.3;
const FLASH_CAP = 24;
/** Rozmiar gwiazdy układu [px CSS] = clamp(px na ly × k, min, max) × rozmiar klasy (nakładka liczy to samo). */
export const STAR_SIZE = Object.freeze({ k: 0.075, min: 2.6, max: 20 });

function makeCopyTarget(w, h) {
  const rt = new THREE.RenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  return rt;
}

/** Geometria instancjonowana z kwadu ±1. */
function quadInstanced(count, attrs) {
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(base.index);
  geo.setAttribute('position', base.getAttribute('position'));
  for (const [name, arr, size] of attrs) geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
  geo.instanceCount = count;
  return geo;
}

export class StarMapImage {
  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {object} sector — z generateSector
   */
  constructor(renderer, sector) {
    this.renderer = renderer;
    this.sector = sector;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 0, 10);
    this.U = {
      pxPerLy: uniform(100),
      dpr: uniform(1),
      time: uniform(0),
      bgCenter: uniform(new THREE.Vector2(0.5, 0.5)),
      bgViewH: uniform(0.3),
      aspect: uniform(16 / 9),
      screenH: uniform(1080),
      bgGain: uniform(0.42),
      nebGain: uniform(1.0),
      hazeGain: uniform(0.04),
      selected: uniform(-1)
    };
    this.bakes = { bg: false, nebulae: 0, total: NEBULA_VARIANTS.length + 1, ms: {} };
    this._buildBackground();
    this._buildNebulae();
    this._buildHaze();
    this._buildStorms();
    this._buildLanes();
    this._buildStars();
    this._buildFlashes();
    this._buildPipeline();
  }

  // ── 1. tło ──────────────────────────────────────────────────────────────────────────────────────
  _buildBackground() {
    const U = this.U;
    this.bgBaker = new SkyBaker(this.renderer, { width: BG_BAKE_SIZE.width, height: BG_BAKE_SIZE.height });
    this.bgStyle = createGalaktykaStyle();
    this.bgBaker.setStyle(this.bgStyle);
    const tex = this.bgBaker.texture;
    tex.wrapS = THREE.MirroredRepeatWrapping;
    tex.wrapT = THREE.MirroredRepeatWrapping;
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:tlo';
    mat.depthTest = false;
    mat.depthWrite = false;
    mat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    mat.fragmentNode = Fn(() => {
      // Okno tekstury 1,6 : 1 (uv), y od góry jak cel wypieku.
      const win = vec2(U.bgViewH.mul(U.aspect).div(1.6), U.bgViewH);
      const uvB = U.bgCenter.add(screenUV.sub(0.5).mul(win)).toVar();
      const smooth = acesGry(texture(tex, uvB).rgb).mul(U.bgGain).toVar();
      // Gwiazdy w pikselach ekranu: komórki w tekselach tła 5120 × 3200 (jak tekstura tła gry).
      const p = uvB.mul(vec2(5120.0, 3200.0));
      const pxT = U.bgViewH.mul(3200.0).div(U.screenH.mul(U.dpr));
      const stars = skyStarField(p, pxT, smooth, uint(7));
      return vec4(acesGryInv(smooth.add(stars)), 1.0);
    })();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    this.scene.add(mesh);
    this.bgMesh = mesh;
  }

  // ── 2. mgławice ─────────────────────────────────────────────────────────────────────────────────
  _buildNebulae() {
    const U = this.U;
    const S = this.sector;
    this.nebBaker = new SkyBaker(this.renderer, { width: NEBULA_BAKE_SIZE.width, height: NEBULA_BAKE_SIZE.height });
    this.nebStyle = createMglawicaStyle();
    this.nebBaker.setStyle(this.nebStyle);
    this.nebTargets = NEBULA_VARIANTS.map(() => makeCopyTarget(NEBULA_BAKE_SIZE.width, NEBULA_BAKE_SIZE.height));
    const copyMat = new THREE.NodeMaterial();
    copyMat.name = 'MapaGwiezdna:kopia';
    copyMat.fragmentNode = vec4(texture(this.nebBaker.texture, screenUV).rgb, 1.0);
    this._copyQuad = new THREE.QuadMesh(copyMat);
    // Przydział wariantu każdej mgławicy (z ziarna mgławicy) → grupy instancji na wariant (i osobno ciemne).
    const groups = new Map();
    for (const n of S.nebulae) {
      const list = KIND_VARIANTS[n.kind] || KIND_VARIANTS.emisyjna;
      const v = list[n.seed % list.length];
      const dark = n.kind === 'ciemna';
      const key = `${v}:${dark ? 1 : 0}`;
      if (!groups.has(key)) groups.set(key, { v, dark, list: [] });
      groups.get(key).list.push(n);
    }
    this.nebMeshes = [];
    for (const g of groups.values()) {
      const count = g.list.length;
      const A = new Float32Array(count * 4);
      const B = new Float32Array(count * 4);
      g.list.forEach((n, i) => {
        A.set([n.x, n.y, n.rx * SPRITE_EXTENT, n.ry * SPRITE_EXTENT], i * 4);
        // kąt, siła, odbicia (różne mgławice z jednego wypieku nie wyglądają tak samo)
        B.set([n.angle, 0.65 + 0.5 * n.density, (n.seed & 1) ? -1 : 1, (n.seed & 2) ? -1 : 1], i * 4);
      });
      const geo = quadInstanced(count, [['nA', A, 4], ['nB', B, 4]]);
      const vQ = varyingProperty('vec2', 'vNebQ');
      const vUv = varyingProperty('vec2', 'vNebUv');
      const vG = varyingProperty('float', 'vNebG');
      const mat = new THREE.NodeMaterial();
      mat.name = `MapaGwiezdna:mglawica:${NEBULA_VARIANTS[g.v].name}${g.dark ? ':ciemna' : ''}`;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.forceSinglePass = true;
      mat.blending = g.dark ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.positionNode = Fn(() => {
        const a = attribute('nA', 'vec4');
        const b = attribute('nB', 'vec4');
        const q = positionGeometry.xy;
        vQ.assign(q);
        vUv.assign(q.mul(b.zw).mul(0.5).add(0.5));
        vG.assign(b.y);
        const lu = q.x.mul(a.z);
        // y sceny = −y gry: v duszka (w dół w grze) idzie w −Y sceny.
        const lv = q.y.negate().mul(a.w);
        const c = cos(b.x);
        const s = sin(b.x);
        const gx = a.x.add(lu.mul(c)).sub(lv.mul(s));
        const gy = a.y.add(lu.mul(s)).add(lv.mul(c));
        return vec3(gx, gy.negate(), 0.0);
      })();
      const tex = this.nebTargets[g.v].texture;
      mat.fragmentNode = Fn(() => {
        const r = length(vQ);
        const mask = float(1.0).sub(smoothstep(0.62, 1.0, r));
        const c = texture(tex, vUv).rgb;
        // AdditiveBlending three = (SrcAlpha, One): alfa 1, inaczej nic nie dochodzi.
        if (!g.dark) return vec4(c.mul(mask).mul(vG).mul(U.nebGain), 1.0);
        // Ciemna mgławica: pył zasłania tło (alfa z gęstości wypieku), brzeg lekko podświetlony.
        const lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
        const alpha = smoothstep(0.004, 0.05, lum).mul(mask).mul(0.88);
        return vec4(vec3(0.010, 0.007, 0.006).add(c.mul(0.08)), alpha);
      })();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = g.dark ? -900 : -800;
      this.scene.add(mesh);
      this.nebMeshes.push(mesh);
    }
  }

  // ── mgiełka rozgrywki (gęstość jak w src/game/sector/sectorZone.js) ───────────────────────────────
  _buildHaze() {
    const U = this.U;
    const N = this.sector.nebulae;
    const A = new Float32Array(N.length * 4);
    const Bv = new Float32Array(N.length * 4);
    const C = new Float32Array(N.length * 4);
    const TINT = { emisyjna: [0.5, 0.35, 0.95], fioletowa: [0.62, 0.32, 1.0], pylowa: [0.85, 0.62, 0.36], ciemna: [0.25, 0.2, 0.3] };
    N.forEach((n, i) => {
      A.set([n.x, n.y, n.rx * SPRITE_EXTENT, n.ry * SPRITE_EXTENT], i * 4);
      // Ziarno u32 w dwóch połówkach 16-bitowych (float32 nie trzyma 32 bitów).
      Bv.set([n.angle, n.density, n.seed >>> 16, n.seed & 0xffff], i * 4);
      C.set([...(TINT[n.kind] || TINT.emisyjna), n.kind === 'ciemna' ? 0.4 : 1], i * 4);
    });
    const geo = quadInstanced(N.length, [['hA', A, 4], ['hB', Bv, 4], ['hC', C, 4]]);
    const vQ = varyingProperty('vec2', 'vMgQ');
    const vW = varyingProperty('vec2', 'vMgW');
    const vB = varyingProperty('vec4', 'vMgB');
    const vC = varyingProperty('vec4', 'vMgC');
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:mgielka';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const a = attribute('hA', 'vec4');
      const b = attribute('hB', 'vec4');
      const q = positionGeometry.xy;
      vQ.assign(q);
      vB.assign(b);
      vC.assign(attribute('hC', 'vec4'));
      const lu = q.x.mul(a.z);
      const lv = q.y.negate().mul(a.w);
      const c = cos(b.x);
      const sn = sin(b.x);
      const gx = a.x.add(lu.mul(c)).sub(lv.mul(sn));
      const gy = a.y.add(lu.mul(sn)).add(lv.mul(c));
      vW.assign(vec2(gx, gy));
      return vec3(gx, gy.negate(), 0.0);
    })();
    // lowbias32 — jak mix32 (sectorRandom.js); mnożenie u32 zawija mod 2^32 jak Math.imul.
    const mix32 = (x) => {
      const h = x.toVar();
      h.assign(h.bitXor(h.shiftRight(uint(16))));
      h.assign(h.mul(uint(0x7feb352d)));
      h.assign(h.bitXor(h.shiftRight(uint(15))));
      h.assign(h.mul(uint(0x846ca68b)));
      h.assign(h.bitXor(h.shiftRight(uint(16))));
      return h;
    };
    const cellHash = (cx, cy, seed) => float(mix32(uint(cx).mul(uint(0x8da6b343)).bitXor(uint(cy).mul(uint(0xd8163841))).bitXor(seed))).mul(1.0 / 4294967296.0);
    const valueNoise = (x, y, seed) => {
      const ix = int(floor(x)).toVar();
      const iy = int(floor(y)).toVar();
      const fx = x.sub(floor(x));
      const fy = y.sub(floor(y));
      const ux = fx.mul(fx).mul(float(3.0).sub(fx.mul(2.0)));
      const uy = fy.mul(fy).mul(float(3.0).sub(fy.mul(2.0)));
      const a = cellHash(ix, iy, seed);
      const b = cellHash(ix.add(1), iy, seed);
      const c = cellHash(ix, iy.add(1), seed);
      const d = cellHash(ix.add(1), iy.add(1), seed);
      return a.add(b.sub(a).mul(ux)).add(c.sub(a).mul(uy)).add(a.sub(b).sub(c).add(d).mul(ux).mul(uy));
    };
    mat.fragmentNode = Fn(() => {
      const seed = uint(vB.z).mul(uint(65536)).add(uint(vB.w)).toVar();
      // r elipsy (kwad = 1,3 × półosie), szum fbm2(x·k + 17,3, y·k − 5,1, ziarno, 3 oktawy).
      const r = length(vQ).mul(SPRITE_EXTENT);
      const k = 0.22;
      const px = vW.x.mul(k).add(17.3).toVar();
      const py = vW.y.mul(k).sub(5.1).toVar();
      const sum = float(0.0).toVar();
      let amp = 0.5;
      let norm = 0;
      let f = 1;
      for (let o = 0; o < 3; o++) {
        sum.addAssign(valueNoise(px.mul(f), py.mul(f), seed.add(uint((Math.imul(o, 0x9e3779b9)) >>> 0))).mul(amp));
        norm += amp;
        amp *= 0.5;
        f *= 2.03;
      }
      const nz = sum.div(norm).toVar();
      const edge = float(1.0).sub(smoothstep(0.5, 1.15, r.add(nz.sub(0.5).mul(0.55))));
      const d = clamp(vB.y.mul(edge).mul(nz.mul(0.6).add(0.7)), 0.0, 1.0);
      return vec4(vC.rgb.mul(d).mul(vC.w).mul(U.hazeGain), 1.0);
    })();
    this.haze = new THREE.Mesh(geo, mat);
    this.haze.frustumCulled = false;
    this.haze.renderOrder = -850;
    this.scene.add(this.haze);
  }

  // ── burze: wiry ─────────────────────────────────────────────────────────────────────────────────
  _buildStorms() {
    const U = this.U;
    const n = Math.max(1, this.sector.storms.length);
    this.stormA = new Float32Array(n * 4);
    const geo = quadInstanced(this.sector.storms.length, [['wA', this.stormA, 4]]);
    this.stormAttr = geo.getAttribute('wA');
    const vQ = varyingProperty('vec2', 'vWirQ');
    const vS = varyingProperty('float', 'vWirS');
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:burze';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const a = attribute('wA', 'vec4');
      const q = positionGeometry.xy;
      vQ.assign(q);
      vS.assign(a.w);
      return vec3(a.x.add(q.x.mul(a.z)), a.y.negate().add(q.y.mul(a.z)), 0.0);
    })();
    mat.fragmentNode = Fn(() => {
      const r = length(vQ);
      // y sceny w górę — kąt w osiach gry (y w dół) dla zgodności z kierunkiem wiatru (spin).
      const th = atan(vQ.y.negate(), vQ.x);
      const arms = sin(th.mul(3.0).add(r.mul(9.0).mul(vS)).sub(U.time.mul(0.9).mul(vS))).mul(0.5).add(0.5);
      const disc = float(1.0).sub(smoothstep(0.35, 1.0, r)).mul(smoothstep(0.0, 0.2, r));
      const k = disc.mul(arms.mul(arms).mul(0.75).add(0.25)).mul(0.12);
      return vec4(vec3(0.45, 0.32, 1.0).mul(k), 1.0);
    })();
    this.storms = new THREE.Mesh(geo, mat);
    this.storms.frustumCulled = false;
    this.storms.renderOrder = -760;
    this.scene.add(this.storms);
  }

  // ── 3. szlaki ────────────────────────────────────────────────────────────────────────────────────
  _buildLanes() {
    const S = this.sector.systems;
    const pos = new Float32Array(this.sector.lanes.length * 6);
    this.sector.lanes.forEach(([a, b], i) => pos.set([S[a].x, -S[a].y, 0, S[b].x, -S[b].y, 0], i * 6));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicNodeMaterial({ color: new THREE.Color(0.16, 0.42, 0.38), transparent: true, opacity: 0.55, depthTest: false, depthWrite: false });
    mat.blending = THREE.AdditiveBlending;
    mat.name = 'MapaGwiezdna:szlaki';
    this.lanes = new THREE.LineSegments(geo, mat);
    this.lanes.frustumCulled = false;
    this.lanes.renderOrder = -700;
    this.scene.add(this.lanes);
  }

  // ── 4. gwiazdy układów ──────────────────────────────────────────────────────────────────────────
  _buildStars() {
    const U = this.U;
    const S = this.sector.systems;
    // Instancje: gwiazda główna + towarzysz (układy podwójne) — towarzysz przesunięty o 0,12 ly.
    const items = [];
    S.forEach((s, i) => {
      items.push({ i, x: s.x, y: s.y, cls: s.star, comp: 0 });
      if (s.companion) items.push({ i, x: s.x + 0.12, y: s.y + 0.05, cls: s.companion, comp: 1 });
    });
    const n = items.length;
    const A = new Float32Array(n * 4);
    const C = new Float32Array(n * 4);
    this.starVis = new Float32Array(n);
    this.starItems = items;
    items.forEach((it, k) => {
      const cls = STAR_CLASSES[it.cls];
      A.set([it.x, it.y, cls.mapSize * (it.comp ? 0.7 : 1), it.i], k * 4);
      const [r, g, b] = starColorRgb(it.cls);
      // sRGB → liniowo (przybliżenie potęgą 2,2), jasność klasy w HDR.
      C.set([r ** 2.2, g ** 2.2, b ** 2.2, it.cls === 'N' ? 1 : 0], k * 4);
    });
    const geo = quadInstanced(n, [['sA', A, 4], ['sC', C, 4], ['sV', this.starVis, 1]]);
    this.starVisAttr = geo.getAttribute('sV');
    const vQ = varyingProperty('vec2', 'vStQ');
    const vC = varyingProperty('vec4', 'vStC');
    const vV = varyingProperty('float', 'vStV');
    const vK = varyingProperty('float', 'vStK');
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:gwiazdy';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const a = attribute('sA', 'vec4');
      const q = positionGeometry.xy;
      vQ.assign(q);
      vC.assign(attribute('sC', 'vec4'));
      vV.assign(attribute('sV', 'float'));
      // Rozmiar w px CSS (STAR_SIZE_PX w demie — etykiety): rośnie z przybliżeniem, z podłogą (cały sektor) i sufitem.
      const sizePx = clamp(U.pxPerLy.mul(STAR_SIZE.k), STAR_SIZE.min, STAR_SIZE.max).mul(a.z);
      vK.assign(sizePx);
      // Kwad = 3,5 × rozmiar (poświata), w latach świetlnych.
      const half = sizePx.mul(3.5).div(U.pxPerLy);
      const sel = a.w.equal(U.selected).select(float(1.25), float(1.0));
      return vec3(a.x.add(q.x.mul(half).mul(sel)), a.y.negate().add(q.y.mul(half).mul(sel)), 0.0);
    })();
    mat.fragmentNode = Fn(() => {
      // r w jednostkach „rozmiaru gwiazdy” (kwad = ±3,5).
      const r = length(vQ).mul(3.5);
      const core = exp(r.mul(r).mul(-3.0)).mul(2.2);
      const halo = exp(r.mul(-2.2)).mul(0.16);
      const edge = float(1.0).sub(smoothstep(2.6, 3.5, r));
      // Pulsar (N): migotanie.
      const pulse = mix(float(1.0), sin(U.time.mul(9.0)).mul(0.5).add(0.6), vC.w);
      const rgb = vC.rgb.mul(core.add(halo)).add(vec3(core.mul(0.35)));
      return vec4(rgb.mul(edge).mul(vV).mul(pulse), 1.0);
    })();
    this.stars = new THREE.Mesh(geo, mat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -600;
    this.scene.add(this.stars);
  }

  /** Widoczność gwiazd z mgły eksploracji: 0 — ukryty, 1 — widać (`exp.level`). */
  setExploration(exp) {
    let changed = false;
    this.starItems.forEach((it, k) => {
      const v = exp.level[it.i] === EXPLORE.HIDDEN ? 0 : 1;
      if (this.starVis[k] !== v) { this.starVis[k] = v; changed = true; }
    });
    if (changed) this.starVisAttr.needsUpdate = true;
  }

  // ── 5. błyski burz ──────────────────────────────────────────────────────────────────────────────
  _buildFlashes() {
    const U = this.U;
    this.flashA = new Float32Array(FLASH_CAP * 4);
    this.flashLife = new Float32Array(FLASH_CAP);
    const geo = quadInstanced(FLASH_CAP, [['fA', this.flashA, 4]]);
    this.flashAttr = geo.getAttribute('fA');
    const vQ = varyingProperty('vec2', 'vFlQ');
    const vI = varyingProperty('float', 'vFlI');
    const mat = new THREE.NodeMaterial();
    mat.name = 'MapaGwiezdna:blyski';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.forceSinglePass = true;
    mat.blending = THREE.AdditiveBlending;
    mat.positionNode = Fn(() => {
      const a = attribute('fA', 'vec4');
      const q = positionGeometry.xy;
      vQ.assign(q);
      vI.assign(a.w);
      return vec3(a.x.add(q.x.mul(a.z)), a.y.negate().add(q.y.mul(a.z)), 0.0);
    })();
    mat.fragmentNode = Fn(() => {
      const r2 = dot(vQ, vQ);
      const k = exp(r2.mul(-6.0)).mul(float(1.0).sub(clamp(r2, 0.0, 1.0)));
      return vec4(vec3(0.62, 0.52, 1.0).mul(k).mul(vI).mul(1.6), 1.0);
    })();
    this.flashes = new THREE.Mesh(geo, mat);
    this.flashes.frustumCulled = false;
    this.flashes.renderOrder = -750;
    this.scene.add(this.flashes);
    this._sp = { x: 0, y: 0 };
  }

  /** Błyski: w każdej burzy w kadrze losowo (fxRandom), życie 0,35 s. */
  updateFlashes(dt, t, view) {
    const A = this.flashA;
    for (let i = 0; i < FLASH_CAP; i++) {
      if (this.flashLife[i] > 0) {
        this.flashLife[i] = Math.max(0, this.flashLife[i] - dt);
        A[i * 4 + 3] = (this.flashLife[i] / 0.35) ** 2 * (0.6 + 0.4 * fxRandom.next());
      } else A[i * 4 + 3] = 0;
    }
    this.boltEvents = this.boltEvents || [];
    this.boltEvents.length = 0;
    this.sector.storms.forEach((st, k) => {
      stormPosition(this.sector, st, t, this._sp);
      this.stormA[k * 4] = this._sp.x;
      this.stormA[k * 4 + 1] = this._sp.y;
      this.stormA[k * 4 + 2] = st.r;
      this.stormA[k * 4 + 3] = st.spin;
    });
    this.stormAttr.needsUpdate = true;
    for (const st of this.sector.storms) {
      stormPosition(this.sector, st, t, this._sp);
      if (Math.abs(this._sp.x - view.x) > view.halfW + st.r || Math.abs(this._sp.y - view.y) > view.halfH + st.r) continue;
      if (fxRandom.next() > dt * 2.2) continue;
      const slot = this.flashLife.findIndex((l) => l <= 0);
      if (slot < 0) break;
      const a = fxRandom.next() * Math.PI * 2;
      const rr = Math.sqrt(fxRandom.next()) * st.r * 0.85;
      const x = this._sp.x + Math.cos(a) * rr;
      const y = this._sp.y + Math.sin(a) * rr;
      const size = st.r * (0.07 + 0.08 * fxRandom.next());
      A.set([x, y, size, 1], slot * 4);
      this.flashLife[slot] = 0.35;
      this.boltEvents.push({ x, y, size, len: st.r * (0.35 + 0.35 * fxRandom.next()) });
    }
    this.flashAttr.needsUpdate = true;
    return this.boltEvents;
  }

  // ── post ────────────────────────────────────────────────────────────────────────────────────────
  _buildPipeline() {
    const pipeline = new THREE.RenderPipeline(this.renderer);
    const scenePass = pass(this.scene, this.camera, { samples: 4 });
    const col = scenePass.getTextureNode('output');
    const bloom = nodeObject(new BloomGry(col, BLOOM_DEFAULTS.strength, BLOOM_DEFAULTS.radius, BLOOM_DEFAULTS.threshold));
    const lin = col.rgb.add(bloom.rgb);
    pipeline.outputNode = vec4(linearDoSrgb(acesGry(max(lin, vec3(0.0)))), 1.0);
    pipeline.outputColorTransform = false;
    this.pipeline = pipeline;
  }

  // ── wypieki (raz przy starcie, po kolei — GPU nie dostaje dwóch ciężkich zadań naraz) ─────────────
  async bakeAll(onProgress = () => {}) {
    const seed = this.sector.seed;
    const t0 = performance.now();
    const bgSeed = (hashU32(seed, 'tło') % 9999) + 1;
    this.bgStyle.apply({ ...this.bgStyle.defaults, ...(this.bgStyle.presets.gra || {}), gwiazdy: 0 }, bgSeed, this.bgBaker);
    this.bakes.ms.tlo = Math.round(await this.bgBaker.bake());
    this.bakes.bg = true;
    onProgress(this.bakes);
    const st = this.nebStyle;
    for (let i = 0; i < NEBULA_VARIANTS.length; i++) {
      const v = NEBULA_VARIANTS[i];
      const vSeed = (hashU32(seed, 'mgławica-wypiek', i) % 9999) + 1;
      st.apply({ ...st.defaults, ...(st.presets[v.preset] || {}), ...SPRITE_COMPOSITION }, vSeed, this.nebBaker);
      this.bakes.ms[v.name] = Math.round(await this.nebBaker.bake());
      const r = this.renderer;
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.nebTargets[i]);
      this._copyQuad.render(r);
      r.setRenderTarget(prev);
      this.bakes.nebulae++;
      onProgress(this.bakes);
    }
    this.bakes.totalMs = Math.round(performance.now() - t0);
    return this.bakes;
  }

  /**
   * Kadr: środek (x, y) [ly, osie gry], px CSS na ly, rozmiar okna CSS, DPR, czas. Tło: okno tekstury
   * z małą paralaksą (cały sektor przesuwa tło o ~1/4 tekstury), lekkie powiększenie przy zbliżeniu.
   */
  setView(cx, cy, pxPerLy, w, h, dpr, t) {
    const U = this.U;
    const cam = this.camera;
    const hw = w / 2 / pxPerLy;
    const hh = h / 2 / pxPerLy;
    cam.left = -hw;
    cam.right = hw;
    cam.top = hh;
    cam.bottom = -hh;
    cam.position.set(cx, -cy, 10);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    U.pxPerLy.value = pxPerLy;
    U.dpr.value = dpr;
    U.time.value = t;
    U.aspect.value = w / h;
    U.screenH.value = h;
    const B = this.sector.bounds;
    const sx = (cx - (B.x0 + B.x1) / 2) / (B.x1 - B.x0);
    const sy = (cy - (B.y0 + B.y1) / 2) / (B.y1 - B.y0);
    U.bgCenter.value.set(0.5 + sx * 0.4, 0.5 + sy * 0.32);
    U.bgViewH.value = 0.34 / Math.pow(Math.max(1, pxPerLy / 12), 0.06);
    // Szlaki: wyraźne na mapie sektora, przygaszone z bliska (lot).
    this.lanes.material.opacity = 0.6 - 0.42 * Math.min(1, Math.max(0, (pxPerLy - 20) / 120));
    return { x: cx, y: cy, halfW: hw, halfH: hh };
  }

  render() {
    this.pipeline.render();
  }
}
