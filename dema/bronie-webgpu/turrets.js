// dema/bronie-webgpu/turrets.js
//
// Wieżyczki dema: te same atlasy PNG co w grze (src/vfx/*Sprite2D.js), ale jako
// OŚWIETLANE kwady w scenie WebGPU — błysk wylotu, pocisk i ogień trafienia
// świecą na korpus i lufy (siatka świateł), a nie tylko pod nimi.
//
// Nie kopiujemy prostokątów atlasów: moduł sprite'a gry rysuje wieżyczkę na
// „kontekście nagrywającym” (setTransform + drawImage), a my zbieramy z tego
// kwady (prostokąt w układzie lokalnym wieżyczki + wycinek atlasu). Odrzut
// (housing/barrel) liczy moduł gry — te same limity i mnożniki co w grze.
// Skala wieżyczki = SCALE_BY_SIZE × CATEGORY_TRIM (turret2D.js; Atlas ma tier
// Capital = 1), punkty wylotu = spec.m z Turret2D.resolveSpec + wysunięcie
// spec.r·0,06 + 3 (jak triggerShot).

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, attributeArray, instanceIndex, texture, varyingProperty,
  positionGeometry, positionViewDirection, dot, normalize, max, mix, clamp, smoothstep, fwidth, diffuseColor, length
} from 'three/tsl';
import { Turret2D } from '../../src/vfx/turret2D.js';
import { TempestSprite2D } from '../../src/vfx/tempestSprite2D.js';
import { MainWeaponSprite2D } from '../../src/vfx/mainWeaponSprite2D.js';
import { SpecialWeaponSprite2D } from '../../src/vfx/specialWeaponSprite2D.js';
import { YamatoSprite2D } from '../../src/vfx/yamatoSprite2D.js';
import { PdWeaponSprite2D } from '../../src/vfx/pdWeaponSprite2D.js';
import { CiwsSprite2D } from '../../src/vfx/ciwsSprite2D.js';
import { SurfaceLightingModel } from './surfaceLighting.js';

// Z turret2D.js (nieeksportowane stałe).
const SCALE_BY_SIZE = Object.freeze({ Capital: 1.75, L: 1.02, M: 0.76, S: 0.52 });
const CATEGORY_TRIM = Object.freeze({ beam: 0.94, ciws: 0.88, flak: 0.92, rocket: 0.82, torpedo: 0.9, default: 1.0 });

export function turretScale(def) {
  return (SCALE_BY_SIZE[def.size] || SCALE_BY_SIZE.M) * (CATEGORY_TRIM[def.category] || CATEGORY_TRIM.default);
}

const MAX_QUADS = 256;

/** Moduł sprite'a dla broni (ten sam wybór co Turret2D.draw). */
function spriteFor(id) {
  if (id === 'special_yamato_cannon') return { mod: YamatoSprite2D, yamato: true };
  if (id === 'railgun_mk1' || id === 'railgun_mk2' || id === 'tempest_ion_s' || id === 'tempest_ion_l') return { mod: TempestSprite2D };
  if (MainWeaponSprite2D.supports(id)) return { mod: MainWeaponSprite2D };
  if (SpecialWeaponSprite2D.supports(id)) return { mod: SpecialWeaponSprite2D };
  if (PdWeaponSprite2D.supports(id)) return { mod: PdWeaponSprite2D };
  if (id === 'ciws_mk1' || id === 'ciws_mk2') return { mod: CiwsSprite2D };
  return null;
}

/** Kontekst 2D, który tylko zapisuje wywołania rysowania sprite'a. */
class RecorderContext {
  constructor() { this.t = [1, 0, 0, 1, 0, 0]; this.quads = []; this.image = null; }
  reset() { this.t = [1, 0, 0, 1, 0, 0]; this.quads.length = 0; }
  setTransform(a, b, c, d, e, f) { this.t = [a, b, c, d, e, f]; }
  drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh) {
    this.image = img;
    // Przy a = d = 1 i b = c = 0 transformacja to samo przesunięcie (odrzut).
    this.quads.push({ sx, sy, sw, sh, x: dx + this.t[4], y: dy + this.t[5], w: dw, h: dh });
  }
  save() {} restore() {} beginPath() {} fill() {} stroke() {} rect() {} fillRect() {}
}

class TurretMaterial extends THREE.NodeMaterial {
  static get type() { return 'TurretMaterial'; }
  constructor({ shared, quads, map }) {
    super();
    this.lights = true;
    this.fog = false;
    this.transparent = true;
    this.depthWrite = false;
    this.depthTest = false;
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = THREE.OneFactor;
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.S = shared;
    this.mapNode = texture(map);
    this.vUv = varyingProperty('vec2', 'vTurUv');
    this.vAx = varyingProperty('vec2', 'vTurAx');
    const Q = quads;
    const vUv = this.vUv;
    const vAx = this.vAx;
    this.positionNode = Fn(() => {
      const i = instanceIndex.mul(uint(3)).toVar();
      const q0 = Q.element(i);
      const q1 = Q.element(i.add(uint(1)));
      const q2 = Q.element(i.add(uint(2)));
      const g = positionGeometry.xy;
      const ax = q1.xy;
      const ay = q1.zw;
      vUv.assign(vec2(mix(q2.x, q2.z, g.x.add(0.5)), mix(q2.w, q2.y, g.y.add(0.5))));
      vAx.assign(ax.div(max(length(ax), 1e-4)));
      return vec3(q0.xy.add(ax.mul(g.x.mul(2.0))).add(ay.mul(g.y.mul(2.0))), q0.z);
    })();
  }

  setupDiffuseColor() {
    const S = this.S;
    const tuv = this.vUv;
    const tex = this.mapNode.sample(tuv).toVar();
    diffuseColor.assign(tex);
    diffuseColor.a.lessThanEqual(0.02).discard();
    this._alpha = smoothstep(float(0.5).sub(fwidth(tex.a).mul(0.75)), float(0.5).add(fwidth(tex.a).mul(0.75)), tex.a);
    const du = 1.5 / 1254;
    const lum = (t) => dot(this.mapNode.sample(t).rgb, vec3(0.299, 0.587, 0.114));
    const gxT = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(0.9);
    const gyT = lum(tuv.add(vec2(0, du))).sub(lum(tuv.sub(vec2(0, du)))).mul(0.9);
    // gradient w osiach kwadu → scena (oś X kwadu z instancji)
    const ax = this.vAx;
    const ay = vec2(ax.y.negate(), ax.x);
    const gs = ax.mul(gxT).add(ay.mul(gyT));
    const Nv = normalize(vec3(gs.negate(), 1.0)).toVar();
    const Vv = positionViewDirection.toVar();
    const albedo = tex.rgb.mul(0.9).toVar();
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const emissive = albedo.mul(S.ambientTop.mul(up.mul(0.45).add(0.55)));
    this._surf = {
      N: Nv, V: Vv, mu: max(dot(Nv, Vv), 0.02), diffAlbedo: albedo, lunarK: float(0), wrap: S.wrap,
      gloss: float(48), specK: float(0.3), specTint: vec3(0.9, 0.9, 0.95),
      sparkBase: float(0), sparkCol: vec3(1), sunVis: float(1), emissive
    };
  }
  setupNormal() { return this._surf ? this._surf.N : vec3(0, 0, 1); }
  setupLightingModel() { return new SurfaceLightingModel(this._surf); }
  setupLighting(builder) { return super.setupLighting(builder).add(this._surf.emissive); }
  setupOutput(builder, outputNode) {
    const a = this._alpha;
    return vec4(max(outputNode.rgb.mul(this.S.exposure), vec3(0.0)).mul(a), a);
  }
}

/**
 * Oświetlane kwady z tekstury (wieżyczki, drony): jeden draw call, dane instancji
 * z CPU (środek, osie, wycinek uv) co klatkę.
 */
export class LitQuadBatch {
  constructor({ scene, shared, renderOrder = 8, max = MAX_QUADS, name = 'litQuads' }) {
    this.max = max;
    this.quadsNode = attributeArray(max * 3, 'vec4').setName(name);
    this.data = this.quadsNode.value.array;
    this.material = new TurretMaterial({ shared, quads: this.quadsNode, map: new THREE.Texture() });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = name;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.n = 0;
    this._textures = new Map();
    this.hasTexture = false;
  }

  /** Obrazek → tekstura (cache), podpięta do materiału. */
  setImage(img) {
    let tex = this._textures.get(img);
    if (!tex) {
      tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      this._textures.set(img, tex);
    }
    if (this.material.mapNode.value !== tex) this.material.mapNode.value = tex;
    this.hasTexture = true;
  }

  begin() { this.n = 0; }

  /**
   * Kwad w świecie gry: środek (gx, gy), kąt osi X (gra), półwymiary, wycinek
   * uv (u0, vTop, u1, vBottom), z.
   */
  quad(gx, gy, angle, hw, hh, u0, vTop, u1, vBottom, z = 8) {
    if (this.n >= this.max) return;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const o = this.n++ * 12;
    const D = this.data;
    D[o] = gx; D[o + 1] = -gy; D[o + 2] = z; D[o + 3] = 0;
    // oś X kwadu (lokalne +x) i oś Y (lokalne −y = góra obrazka) w scenie
    D[o + 4] = c * hw; D[o + 5] = -s * hw;
    D[o + 6] = s * hh; D[o + 7] = c * hh;
    D[o + 8] = u0; D[o + 9] = vTop; D[o + 10] = u1; D[o + 11] = vBottom;
  }

  commit() {
    const n = this.hasTexture ? this.n : 0;
    const attr = this.quadsNode.value;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.max(1, n) * 12);
    attr.needsUpdate = true;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
  }
}

/**
 * Wieżyczki jednej broni na zadanych gniazdach kadłuba.
 */
export class TurretLayer {
  constructor({ scene, shared, renderOrder = 8 }) {
    this.batch = new LitQuadBatch({ scene, shared, renderOrder, name: 'turrets' });
    this.rec = new RecorderContext();
    this.turrets = [];
    this.def = null;
    this.sprite = null;
    this.visible = true;
  }

  /** Ustawia broń i gniazda: mounts = [{ lx, ly }] w układzie kadłuba (gra, y w dół). */
  setWeapon(def, hull, mounts) {
    this.def = def;
    this.hull = hull;
    this.spec = Turret2D.resolveSpec(def.id, def.category);
    this.scale = turretScale(def);
    this.sprite = spriteFor(def.id);
    if (this.sprite) {
      if (this.sprite.yamato) this.sprite.mod.preload();
      else this.sprite.mod.preload(def.id);
    }
    this.turrets = mounts.map((m, i) => ({
      lx: m.lx, ly: m.ly, angle: m.angle ?? 0, housing: 0, barrel: 0, nextBarrel: 0, index: i,
      cooldown: 0, aimX: 0, aimY: 0, aimAge: 99, charge: -1, beam: null, burst: 0
    }));
  }

  _spriteReady() {
    const s = this.sprite;
    if (!s) return false;
    // YamatoSprite2D ma getter `ready`, pozostałe moduły isReady(id)
    return s.yamato ? s.mod.ready === true : s.mod.isReady(this.def.id);
  }

  /** Pozycja gniazda w świecie gry. */
  mountWorld(t, out) {
    const h = this.hull;
    const c = Math.cos(h.angle);
    const s = Math.sin(h.angle);
    out.x = h.x + t.lx * c - t.ly * s;
    out.y = h.y + t.lx * s + t.ly * c;
    return out;
  }

  /** Obrót ku celowi (świat gry) z ograniczoną prędkością kątową [rad/s]; zwraca błąd kąta. */
  aim(t, tx, ty, dt, turnRate = 3.5) {
    const p = this.mountWorld(t, _p);
    const want = Math.atan2(ty - p.y, tx - p.x);
    let d = want - t.angle;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const step = turnRate * dt;
    t.angle += Math.max(-step, Math.min(step, d));
    return Math.abs(d) - Math.min(Math.abs(d), step);
  }

  /**
   * Strzał z wieżyczki: odrzut (jak Turret2D.triggerShot) i punkt wylotu lufy
   * w świecie gry. barrel = indeks lufy albo −1 (kolejna).
   */
  fire(t, recoil, out, barrel = -1) {
    const kick = Math.max(0.1, recoil);
    t.housing = Math.min(t.housing + kick * 0.4, kick * 3.0);
    t.barrel = Math.max(t.barrel, kick);
    const m = this.spec.m;
    const idx = barrel >= 0 ? Math.min(barrel, m.length - 1) : t.nextBarrel % m.length;
    t.nextBarrel = (idx + 1) % Math.max(1, m.length);
    return this.muzzle(t, idx, out);
  }

  get barrelCount() { return this.spec ? this.spec.m.length : 1; }

  /** Punkt wylotu lufy idx (świat gry) i kąt. */
  muzzle(t, idx, out) {
    const p = this.mountWorld(t, _p);
    const m = this.spec.m[Math.min(idx, this.spec.m.length - 1)];
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    const fwd = this.spec.r * 0.06 + 3;
    const mx = m[0] * this.scale + fwd;
    const my = m[1] * this.scale;
    out.x = p.x + mx * c - my * s;
    out.y = p.y + mx * s + my * c;
    out.angle = t.angle;
    out.scale = this.scale;
    out.barrel = idx;
    return out;
  }

  update(dt) {
    for (const t of this.turrets) {
      t.housing *= Math.max(0, 1 - 10 * dt);
      t.barrel *= Math.max(0, 1 - 15 * dt);
    }
  }

  /** Nagranie sprite'ów i zapis kwadów instancji. */
  commit() {
    const B = this.batch;
    B.begin();
    if (this.visible && this._spriteReady()) {
      const rec = this.rec;
      for (const t of this.turrets) {
        rec.reset();
        const ok = this.sprite.yamato
          ? this.sprite.mod.draw(rec, 1, 0, 0, 1, 0, 0, t.housing, t.barrel)
          : this.sprite.mod.draw(rec, this.def.id, 1, 0, 0, 1, 0, 0, t.housing, t.barrel);
        if (!ok || !rec.image) continue;
        B.setImage(rec.image);
        const p = this.mountWorld(t, _p);
        const c = Math.cos(t.angle);
        const s = Math.sin(t.angle);
        const k = this.scale;
        const W = rec.image.naturalWidth || 1254;
        const H = rec.image.naturalHeight || 1254;
        let z = 8;
        for (const q of rec.quads) {
          // środek prostokąta w układzie lokalnym (y w dół) → świat gry
          const lcx = (q.x + q.w * 0.5) * k;
          const lcy = (q.y + q.h * 0.5) * k;
          const gx = p.x + lcx * c - lcy * s;
          const gy = p.y + lcx * s + lcy * c;
          B.quad(gx, gy, t.angle, q.w * 0.5 * k, q.h * 0.5 * k, q.sx / W, 1 - q.sy / H, (q.sx + q.sw) / W, 1 - (q.sy + q.sh) / H, z);
          z += 0.01;
        }
      }
    }
    B.commit();
  }
}

const _p = { x: 0, y: 0 };
