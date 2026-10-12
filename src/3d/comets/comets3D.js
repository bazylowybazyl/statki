// src/3d/comets/comets3D.js
//
// KOMETY — obraz (Core3D, pass ortho = warstwa 0): na kometę ARKUSZ GAZU (koma, dżety, ziarna, warkocze —
// comets.tsl.js) i BRYŁA JĄDRA (siatka z cometNucleus.js, cień własny z atlasu pól odległości). Logika i dane:
// src/game/cometField.js (miejsca, obrót, kolizje). Bez własnych passów, celów i rendererów.
//
// GŁĘBIA: jądro i arkusz na z = COMET_Z (pod kadłubami: skóra −10,4 … −5,3, pył kosmiczny −12) — arkusz leży
// w płaszczyźnie środka jądra, więc bryła zasłania gaz za sobą testem głębi, a gaz przed jądrem dodaje shader
// bryły (koma przed jądrem). Kadłuby zawsze nad gazem; jądro sięga nad płaszczyznę gry (bryła 3D) — kolizje
// trzymają kadłub poza obrysem z góry (cometField.js).
//
// PRECYZJA: mesh.position = miejsce komety w scenie (5–10 mln j.) — three składa modelViewMatrix w double
// (highPrecision), dane siatek są lokalne (arkusz do ~250 tys. j., jądro w promieniach).
//
// KOSZT: 2 rysunki na widoczną kometę (arkusz poza kadrem — schowany; nieaktywna kometa — bez arkusza).
// Zero alokacji na klatkę (wektory robocze, uniformy w miejscu).
//
// ROZGRZEWKA: wpis `komety` w Core3D.warmup (arkusz i jądro — jądro na siatce zastępczej o tym samym układzie
// atrybutów i indeksów, zanim worker odda prawdziwą).

import * as THREE from 'three/webgpu';
import { COMET_TUNE } from '../../data/comets.js';
import { cometSheetExtent } from '../../game/comets.js';
import { buildNucleusSurface, NUCLEUS_SDF_RANGE } from '../../game/cometNucleus.js';
import {
  COMET_LOOK, createCometSheetMaterial, createCometSheetGeometry, createCometNucleusMaterial, createCometSdfAtlas
} from './comets.tsl.js';

export const COMET_Z = -20;
const SDF_N = 48;
const TAU = Math.PI * 2;

/** Strojenie na żywo (window.CometTune): mnożniki jasności i przełączniki A/B. */
export const COMET_VIEW_TUNE = {
  gas: 0.24, dustComa: 0.18, jets: 0.42, ion: 0.46, dust: 0.085, grains: 1.4, condensation: 2.6,
  sheet: true, nucleus: true,
  // tempo animacji [1/s]: tekstura dżetów, włókna jonowe, załamania, pasma pyłu, okres zerwania [s], okres składania promieni [s]
  jetTex: 0.02, ionFlow: 0.035, ionKink: 0.05, dustBands: 0.004, disconnectPeriod: 75, foldPeriod: 38,
  grainSpeed: 55
};

function geometryFromSurface(surface) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(surface.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(surface.normals, 3));
  geo.setAttribute('aAo', new THREE.BufferAttribute(surface.ao, 1));
  geo.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geo.computeBoundingSphere();
  geo.name = 'CometNucleus';
  return geo;
}

export class CometsView {
  /**
   * @param {object} core Core3D
   * @param {import('../../game/cometField.js').CometField} field
   */
  constructor(core, field) {
    this.core = core;
    this.field = field;
    this.group = new THREE.Group();
    this.group.name = 'Comets';
    this.items = [];
    this.layers = Math.max(1, field.sites.length);
    this.atlas = createCometSdfAtlas(SDF_N, this.layers);
    this.sheetGeo = createCometSheetGeometry();
    // siatka zastępcza jądra (ten sam układ atrybutów i indeksów co prawdziwa — rozgrzewka i do gotowości)
    this.placeholderGeo = geometryFromSurface(buildNucleusSurface({ lobes: [{ c: [0, 0, 0], r: [1, 1, 1] }], blend: 0.3, rough: 0, craters: 0, seed: 1 }, 6, 64));
    this.stats = { visibleSheets: 0, visibleNuclei: 0 };
    this._ext = [0, 0, 0, 0];
    this._time = 0;
    for (const site of field.sites) this._addItem(site);
    core.scene.add(this.group);
    // jądra gotowe później (worker) — podpinamy, gdy przyjdą
    const prev = field.onSiteReady;
    field.onSiteReady = (site) => {
      if (prev) prev(site);
      this._attachNucleus(site);
    };
    for (const site of field.sites) if (site.ready) this._attachNucleus(site);
  }

  _addItem(site) {
    const sheet = new THREE.Mesh(this.sheetGeo, createCometSheetMaterial());
    sheet.name = `CometSheet_${site.id}`;
    sheet.frustumCulled = false;
    sheet.renderOrder = -4;
    sheet.layers.set(0);
    sheet.matrixAutoUpdate = true;
    const nucleus = new THREE.Mesh(this.placeholderGeo, createCometNucleusMaterial(this.atlas, SDF_N));
    nucleus.name = `CometNucleus_${site.id}`;
    nucleus.frustumCulled = false;
    nucleus.layers.set(0);
    nucleus.visible = false;
    this.group.add(sheet);
    this.group.add(nucleus);
    const item = { site, sheet, nucleus, nucleusReady: false };
    this.items.push(item);
    this._initUniforms(item);
    return item;
  }

  _attachNucleus(site) {
    const item = this.items.find((it) => it.site === site);
    if (!item || item.nucleusReady || !site.surface) return;
    const geo = geometryFromSurface(site.surface);
    item.nucleus.geometry = geo;
    // pole odległości do atlasu (warstwa = indeks komety)
    const g = site.grid;
    if (g && g.n === SDF_N) {
      this.atlas.image.data.set(g.data, site.index * SDF_N * SDF_N * SDF_N);
      this.atlas.needsUpdate = true;
    }
    item.nucleusReady = true;
    item.sdfExtent = g ? g.extent : 1.5;
    item.nucleus.material.uniforms.uSdf.value.set(site.index, this.layers, item.sdfExtent, g ? g.range : NUCLEUS_SDF_RANGE);
  }

  _initUniforms(item) {
    const { site } = item;
    const def = site.def;
    const tints = def.tint || {};
    const setShared = (U) => {
      const jets = def.nucleus.jets || [];
      const lon = [0, 0, 0, 0], lat = [1, 1, 1, 1], pw = [0, 0, 0, 0], w = [0.1, 0.1, 0.1, 0.1];
      for (let j = 0; j < Math.min(4, jets.length); j++) {
        lon[j] = jets[j].lon || 0; lat[j] = Math.cos(jets[j].lat || 0); pw[j] = jets[j].power ?? 1; w[j] = jets[j].width ?? 0.12;
      }
      U.uJetLon.value.set(...lon);
      U.uJetLat.value.set(...lat);
      U.uJetPow.value.set(...pw);
      U.uJetW.value.set(...w);
      const tc = tints.coma || [0.6, 1, 0.75], ti = tints.ion || [0.32, 0.56, 1], td = tints.dust || [1, 0.86, 0.64];
      U.uTintComa.value.set(tc[0], tc[1], tc[2], 1);
      U.uTintIon.value.set(ti[0], ti[1], ti[2], 1);
      U.uTintDust.value.set(td[0], td[1], td[2], 1);
    };
    setShared(item.sheet.material.uniforms);
    setShared(item.nucleus.material.uniforms);
    const alb = def.nucleus.albedo ?? 0.04;
    item.nucleus.material.uniforms.uAlbedo.value.set(alb * 1.06, alb, alb * 0.93, def.nucleus.ice ?? 1);
    item.nucleus.material.uniforms.uSdf.value.set(site.index, this.layers, 1.5, NUCLEUS_SDF_RANGE);
    this._applyGeometry(item);
  }

  /** Parametry gazu z geometrii komety (po zmianie odległości od Słońca — demo — i przy starcie). */
  _applyGeometry(item) {
    const { site } = item;
    const geo = site.geo;
    const R = site.R;
    const Rc = Math.max(R * 1.4, geo.comaR || R * 1.4);
    const A = geo.active ? geo.activity : 0;
    const sA = Math.sqrt(Math.min(4, A));
    const T = COMET_VIEW_TUNE;
    const lagScene = -geo.lagSign;          // lokalne +y siatki = −(oś y układu warkocza gry)
    const thetaS = Math.atan2(-geo.ay, geo.ax);
    item.thetaS = thetaS;
    item.active = !!geo.active;
    for (const mat of [item.sheet.material, item.nucleus.material]) {
      const U = mat.uniforms;
      U.uNuc.value.set(R, Rc, A, lagScene);
      U.uComa.value.set(Rc * 0.5, T.gas * sA, T.dustComa * sA, item.active ? T.jets * Math.max(0.35, sA) : 0);
      U.uSpin.value.set(0, site.omega, COMET_TUNE.gasSpeed, COMET_TUNE.jetPush);
    }
    const S = item.sheet.material.uniforms;
    cometSheetExtent(geo, this._ext);
    const e = this._ext;
    // y lokalne = y_lag · lagScene
    if (lagScene > 0) S.uExt.value.set(e[0], e[1], e[2], e[3]);
    else S.uExt.value.set(e[0], e[1], -e[3], -e[2]);
    S.uIon.value.set(Math.max(1, geo.ionLen), geo.ionAngle, geo.ionWidth0, geo.ionSpread);
    S.uDust.value.set(Math.max(1, geo.dustLen), geo.dustC, geo.dustBmin, geo.dustEject);
    S.uGain.value.set(T.ion * Math.pow(Math.max(A, 1e-4), 0.35), T.dust * Math.pow(Math.max(A, 1e-4), 0.3), T.grains * Math.min(1, sA * 1.5), 1);
    S.uGain2.value.set(geo.dustAgeSpan, geo.dustGamma, T.condensation * Math.min(1.5, sA), 0);
    item.sheetRadius = 0.5 * Math.hypot(e[1] - e[0], e[3] - e[2]);
    item.sheetCx = (e[0] + e[1]) * 0.5;
    item.sheetCy = (e[2] + e[3]) * 0.5 * lagScene;   // lokalne
  }

  /** Po zmianie stanu komety (demo: suwak odległości) — przelicz parametry gazu. */
  refresh(site) {
    const item = this.items.find((it) => it.site === site);
    if (item) this._applyGeometry(item);
  }

  /**
   * Klatka: czas gry [s] (obrót, fazy), kamery (kadr — odcinanie), opcjonalnie kamera 2 (podzielony ekran).
   * @param {number} time
   * @param {{x:number,y:number,zoom:number}} cam
   * @param {object} [cam2]
   */
  update(time, cam, cam2 = null) {
    const T = COMET_VIEW_TUNE;
    const t = Number(time) || 0;
    this._time = t;
    const core = this.core;
    // kadr kamery ortho passów = rozmiar celu sceny / zoom (przy DPR > 1 większy niż px CSS) — bierzemy większy
    const ct0 = core.composerTarget;
    const W = Math.max(core.width || 1600, ct0 ? ct0.width : 0), H = Math.max(core.height || 900, ct0 ? ct0.height : 0);
    const free = core.isFreePerspectiveCamera ? core.isFreePerspectiveCamera(cam) : false;
    let vs = 0, vn = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const s = it.site;
      const sx = s.x, sy = -s.y;
      // odcinanie: koło arkusza / jądra kontra koło kadru (kamera 1 i 2)
      const ct = Math.cos(it.thetaS), st = Math.sin(it.thetaS);
      const scx = sx + it.sheetCx * ct - it.sheetCy * st;
      const scy = sy + it.sheetCx * st + it.sheetCy * ct;
      const sheetOn = T.sheet && it.active && (this._inView(cam, W, H, free, scx, scy, it.sheetRadius)
        || (cam2 !== null && this._inView(cam2, W, H, false, scx, scy, it.sheetRadius)));
      const nucOn = T.nucleus && it.nucleusReady && (this._inView(cam, W, H, free, sx, sy, s.reach * 1.1)
        || (cam2 !== null && this._inView(cam2, W, H, false, sx, sy, s.reach * 1.1)));
      it.sheet.visible = sheetOn;
      it.nucleus.visible = nucOn;
      if (!sheetOn && !nucOn) continue;
      const spinScene = s.spin;
      const spinLocal = spinScene - it.thetaS;
      if (sheetOn) {
        vs++;
        it.sheet.position.set(sx, sy, COMET_Z);
        it.sheet.rotation.set(0, 0, it.thetaS);
        this._phases(it.sheet.material.uniforms, t, spinLocal);
        it.sheet.material.uniforms.uGain.value.w = 1;
      }
      if (nucOn) {
        vn++;
        const n = it.nucleus;
        n.position.set(sx, sy, COMET_Z);
        n.rotation.set(0, 0, spinScene);
        n.scale.setScalar(s.R);
        const U = n.material.uniforms;
        this._phases(U, t, spinLocal);
        // Słońce: w scenie (−ax, +ay, 0) od jądra; w układzie bryły obrót o −spin
        const g = s.geo;
        const lx = -g.ax, ly = g.ay;
        const c = Math.cos(-spinScene), sn = Math.sin(-spinScene);
        U.uSunObj.value.set(lx * c - ly * sn, lx * sn + ly * c, 0, COMET_LOOK.sunIntensity);
        if (free && cam && cam.position) {
          let vx = cam.position.x - sx, vy = cam.position.y - sy, vz = cam.position.z - COMET_Z;
          const l = Math.hypot(vx, vy, vz) || 1;
          vx /= l; vy /= l; vz /= l;
          U.uViewObj.value.set(vx * c - vy * sn, vx * sn + vy * c, vz, COMET_LOOK.hazeFront);
        } else {
          U.uViewObj.value.set(0, 0, 1, COMET_LOOK.hazeFront);
        }
      }
    }
    this.stats.visibleSheets = vs;
    this.stats.visibleNuclei = vn;
  }

  _phases(U, t, spinLocal) {
    const T = COMET_VIEW_TUNE;
    U.uSpin.value.x = spinLocal;
    U.uPhase.value.set((t * T.jetTex) % 1, (t * T.ionFlow) % 1, (t * T.ionKink) % 1, (t * T.dustBands) % 1);
    const fold = (t / T.foldPeriod) % 1;
    U.uPhase2.value.set((t / T.disconnectPeriod) % 1, fold < 0.5 ? fold * 2 : 2 - fold * 2,
      ((t * T.grainSpeed) / COMET_LOOK.grainCell) % 1024, (t * 0.5) % 1000);
  }

  _inView(cam, W, H, free, px, py, rad) {
    if (!cam) return false;
    if (free) return true;
    const z = Math.max(1e-5, Number(cam.zoom) || 1);
    const hw = W * 0.5 / z, hh = H * 0.5 / z;
    const cx = Number(cam.x) || 0, cy = -(Number(cam.y) || 0);
    const dx = Math.max(0, Math.abs(px - cx) - hw);
    const dy = Math.max(0, Math.abs(py - cy) - hh);
    return dx * dx + dy * dy <= rad * rad;
  }

  /** Siatki do rozgrzewki (Core3D.warmup): arkusz i jądro każdej komety (jądro może być na siatce zastępczej). */
  warmupMeshes() {
    const out = [];
    for (const it of this.items) { out.push(it.sheet); out.push(it.nucleus); }
    return out;
  }

  dispose() {
    this.group.removeFromParent();
    for (const it of this.items) {
      it.sheet.material.dispose();
      it.nucleus.material.dispose();
      if (it.nucleus.geometry !== this.placeholderGeo) it.nucleus.geometry.dispose();
    }
    this.sheetGeo.dispose();
    this.placeholderGeo.dispose();
    this.atlas.dispose();
    this.items.length = 0;
  }
}

export { TAU as COMET_TAU };
