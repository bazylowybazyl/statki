// dema/asteroidy-webgpu/ship.js
//
// Kadłuby dema (Atlas + lotniskowiec eskorty) w uproszczonym renderze:
// kwad z tekstury sprite'a (alfa = sylwetka), oświetlany tym samym modelem co
// skały (słońce + WSZYSTKIE światła siatki), normalna z gradientu luminancji
// tekstury. Do tego:
//   • dysze MAIN z danych edytora (`engines.main`) i promienia z engineFx —
//     duszki blasku i smugi ciągu (glowSprites.js), światło dysz w pyle;
//   • lampy pozycyjne (czerwone, sekwencja „pasa startowego” jak w grze);
//   • światło wolumetryczne nad kadłubem (volumetrics.js: pył między kamerą
//     a pancerzem świeci w smugach reflektorów).

import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, texture, uv, modelViewMatrix, positionViewDirection, positionWorld,
  max, mix, dot, normalize, clamp, smoothstep, fwidth, diffuseColor
} from 'three/tsl';
import { getHullRenderSize } from '../../src/data/ships.js';
import { buildEntityEngineFx } from '../../src/data/engineFx.js';
import { navChaseSequence, buildPositionLightWorldSprites } from '../../src/game/shipLightRuntime.js';
import { SurfaceLightingModel } from './surfaceLighting.js';
import { GLOW_ROUND, GLOW_STREAK } from './glowSprites.js';

async function loadImage(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** Materiał kadłuba: tekstura sprite'a, normalna z luminancji, model światła skał. */
class HullNodeMaterial extends THREE.NodeMaterial {
  static get type() { return 'HullNodeMaterial'; }

  constructor({ map, shared, hullW, hullH, texW, texH, owner = 0 }) {
    super();
    this.lights = true;
    // Właściciel świateł (lights.js): kadłub nie łapie własnych lamp i reflektorów.
    this.lightOwner = uniform(owner);
    this.fog = false;
    // Krawędź sylwetki z alfy tekstury (premultiplied „over”) — twardy próg
    // alfy dawał schodki, których MSAA nie wygładza. Głębię pisze cały kwad
    // poza pustym tłem (półprzezroczysty brzeg zasłania pył tylko na 1–2 px).
    this.transparent = true;
    this.depthWrite = true;
    this.blending = THREE.CustomBlending;
    this.blendSrc = THREE.OneFactor;
    this.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.blendSrcAlpha = THREE.OneFactor;
    this.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.map = map;
    this.S = shared;
    this.hullW = hullW;
    this.hullH = hullH;
    this.texW = texW;
    this.texH = texH;
    // Transmitancja słońca przy kadłubie (× przełącznik przesłaniania).
    this.sunT = uniform(1);
    this._surf = null;
  }

  setupDiffuseColor() {
    const S = this.S;
    const map = this.map;
    const tuv = uv();
    const tex = texture(map, tuv).toVar();
    diffuseColor.assign(tex);
    diffuseColor.a.lessThanEqual(0.02).discard();
    // Alfa krawędzi wyostrzona do ~1,5 px (tekstura ma miękki, szeroki brzeg).
    this._alpha = smoothstep(float(0.5).sub(fwidth(tex.a).mul(0.75)), float(0.5).add(fwidth(tex.a).mul(0.75)), tex.a);
    // Normalna z gradientu luminancji (relief paneli, kraty, dysze).
    const du = 1.5 / this.texW;
    const dv = 1.5 / this.texH;
    const lum = (t) => dot(texture(map, t).rgb, vec3(0.299, 0.587, 0.114));
    const hs = 7.0; // j. wysokości na jednostkę luminancji
    const gx = lum(tuv.add(vec2(du, 0))).sub(lum(tuv.sub(vec2(du, 0)))).mul(hs / (2 * du * this.hullW));
    const gy = lum(tuv.add(vec2(0, dv))).sub(lum(tuv.sub(vec2(0, dv)))).mul(hs / (2 * dv * this.hullH));
    const nLocal = normalize(vec3(gx.negate(), gy.negate(), 1.0));
    const Nv = normalize(modelViewMatrix.mul(vec4(nLocal, 0.0)).xyz).toVar();
    const Vv = positionViewDirection.toVar();
    const albedo = tex.rgb.mul(0.85).toVar();
    const metal = float(0.3);
    const diffAlbedo = albedo.mul(float(1.0).sub(metal.mul(0.85))).toVar();
    const specTint = mix(vec3(1.0), vec3(0.6, 0.6, 0.62), metal);
    const sunT = mix(float(1.0), this.sunT, S.sunOcc).toVar();
    const fill = mix(float(0.4), float(1.0), sunT).mul(float(1.0).sub(float(1.0).sub(sunT).mul(0.92)));
    const up = clamp(Nv.z.mul(0.5).add(0.5), 0.0, 1.0);
    const emissive = diffAlbedo.mul(S.ambientTop.mul(up.mul(0.45).add(0.55))).mul(fill).toVar();
    this._surf = {
      N: Nv, V: Vv, mu: max(dot(Nv, Vv), 0.02), diffAlbedo, lunarK: float(0), wrap: S.wrap,
      gloss: float(40), specK: float(0.22), specTint, sparkBase: float(0), sparkCol: vec3(1), sunVis: sunT, emissive
    };
  }

  setupNormal() {
    return this._surf ? this._surf.N : vec3(0, 0, 1);
  }

  setupLightingModel() {
    return new SurfaceLightingModel(this._surf);
  }

  setupLighting(builder) {
    return super.setupLighting(builder).add(this._surf.emissive);
  }

  setupOutput(builder, outputNode) {
    const a = this._alpha;
    const lit = max(outputNode.rgb.mul(this.S.exposure), vec3(0.0)).mul(a).toVar();
    if (this.S.volume) {
      // Pył nad pancerzem: rozproszenie od kamery do z kadłuba, pancerz
      // przygaszony transmitancją (dno ośrodka jest pod kadłubem zasłonięte).
      const v = this.S.volume.sample(positionWorld);
      lit.assign(lit.mul(v.a).add(v.rgb));
    }
    return vec4(lit, a);
  }
}

/**
 * Kadłub dema.
 * @param {object} o
 * @param {string} o.id klucz kadłuba (getHullRenderSize, engineFx)
 * @param {string} o.url sprite
 * @param {object} o.editor dane edytora (engines, lights)
 */
export class DemoHull {
  static async load({ id, url, editor, scene, shared, owner = 0 }) {
    const img = await loadImage(url);
    const hull = new DemoHull();
    await hull._init({ id, img, editor, scene, shared, owner });
    return hull;
  }

  async _init({ id, img, editor, scene, shared, owner }) {
    this.id = id;
    this.owner = owner;
    const size = getHullRenderSize(id, img.naturalWidth, img.naturalHeight);
    this.w = size.w;
    this.h = size.h;
    this.length = size.w;
    this.hpScale = size.w / img.naturalWidth;
    const map = new THREE.Texture(img);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.needsUpdate = true;
    this.material = new HullNodeMaterial({ map, shared, hullW: size.w, hullH: size.h, texW: img.naturalWidth, texH: img.naturalHeight, owner });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(size.w, size.h), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = `hull_${id}`;
    scene.add(this.mesh);
    // Encja w formacie gry: światła z edytora (shipLightRuntime czyta px PNG × skala).
    this.entity = {
      id, pos: { x: 0, y: 0 }, x: 0, y: 0, angle: 0, editorLights: editor?.lights || null,
      __hardpointScale: this.hpScale, visual: { spriteScale: 1 }, w: size.w, h: size.h
    };
    // Dysze MAIN (px PNG względem środka, +X = dziób) → układ kadłuba w j. świata.
    const fx = buildEntityEngineFx(id, null, this.hpScale);
    this.nozzleRadius = fx.nozzleRadius || this.length * 0.0188;
    this.nozzles = (editor?.engines?.main || []).map((e) => ({ x: e.x * this.hpScale, y: e.y * this.hpScale }));
    if (!this.nozzles.length) this.nozzles.push({ x: -size.w * 0.48, y: 0 });
    // Stan ruchu (świat gry).
    this.x = 0; this.y = 0; this.angle = 0; this.vx = 0; this.vy = 0; this.angVel = 0;
    this.thrust = 0;
    this._navSprites = [];
    // Faza sekwencji lamp wzdłuż kadłuba: szerokość sprite'a w świecie (jak
    // siatka kadłuba w grze).
    const gridLike = { srcWidth: size.w, pivot: { x: 0 } };
    this._navOpts = { out: this._navSprites, time: 0, getGrid: () => gridLike };
  }

  setPose(x, y, angle, vx, vy, angVel) {
    this.x = x; this.y = y; this.angle = angle; this.vx = vx; this.vy = vy; this.angVel = angVel;
    const e = this.entity;
    e.x = e.pos.x = x;
    e.y = e.pos.y = y;
    e.angle = angle;
  }

  /** Mesh w scenie względem początku (ox, oy) [świat gry]. */
  syncMesh(ox, oy, sunT) {
    this.mesh.position.set(this.x - ox, -(this.y - oy), 0);
    this.mesh.rotation.set(0, 0, -this.angle);
    this.mesh.updateMatrixWorld(true);
    this.material.sunT.value = sunT;
  }

  /** Pozycja dyszy w świecie gry. */
  nozzleWorld(n, out) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    // Oś y sprite'a (px w dół) = +y gry przy kącie 0.
    out.x = this.x + n.x * c - n.y * s;
    out.y = this.y + n.x * s + n.y * c;
    return out;
  }

  /**
   * Duszki: blask dysz i smugi ciągu, lampy pozycyjne. Scena względem (ox, oy).
   */
  addGlows(glow, ox, oy, time, thrustVis = 1) {
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const back = { x: -c, y: -s };
    const p = { x: 0, y: 0 };
    const th = this.thrust;
    const R = this.nozzleRadius;
    for (const n of this.nozzles) {
      this.nozzleWorld(n, p);
      const sx = p.x - ox;
      const sy = -(p.y - oy);
      // Rdzeń dyszy: stały blask plazmy + ciąg (paleta „plazma” z engineFx).
      const k = (0.35 + th * 1.2) * thrustVis;
      glow.add(sx, sy, 4, R * (2.2 + th * 1.3), 0.7 * k, 2.1 * k, 3.6 * k, GLOW_ROUND);
      if (th > 0.02) {
        const len = R * (6 + th * 22);
        const cxs = sx + back.x * len * 0.45;
        const cys = sy - back.y * len * 0.45;
        glow.add(cxs, cys, 3, R * 1.6, 0.25 * th, 0.9 * th, 2.4 * th, GLOW_STREAK, -back.x, back.y, len / (R * 1.6));
      }
    }
    // Lampy pozycyjne: sekwencja jak w grze (billboardy shipLights3D).
    this._navOpts.time = time;
    buildPositionLightWorldSprites([this.entity], this._navOpts);
    for (const l of this._navSprites) {
      const seq = navChaseSequence(time, l.phase);
      const col = l.color;
      const k = 3.0 * seq * l.intensity;
      glow.add(l.x - ox, -(l.y - oy), 6, Math.max(12, l.coreWorld * 7), col.r * k, col.g * k, col.b * k, GLOW_ROUND);
    }
  }
}
