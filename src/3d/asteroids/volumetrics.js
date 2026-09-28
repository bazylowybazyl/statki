// src/3d/asteroids/volumetrics.js
//
// ŚWIATŁO WOLUMETRYCZNE pola asteroid — port dema/asteroidy-webgpu/volumetrics.js
// (zadanie 21): smugi reflektorów (dalekich i otoczenia), poświata piorunów,
// świecących skał i lamp w cienkim pyle pola — z cieniami skał w smudze (atlas map
// cienia, spotShadows.js).
//
// Ośrodek to płyta wokół płaszczyzny gry (z od zBot do zTop, miękkie brzegi),
// gęstość = pył pola z mapy pola (fieldMap.js: waga pasa × pole) × szum 3D
// GRADIENTOWY (kłęby i włókna, rockNoise.js — szum wartości progowany kontrastem
// układał się w kratkę). Siatka froxeli wyrównana do kamery gry (ortho, z góry):
// kolumna na ~4–6 px ekranu × 40 plastrów w z, zakotwiczona w świecie. Jeden
// przebieg compute na KOLUMNĘ: rozpraszanie wszystkich świateł siatki gry
// (Core3D.fx.grid, ta sama lista co dla skał; komórka siatki wspólna dla kolumny),
// faza Henyeya–Greensteina, bliskie pole lampy ~1/d, ekstynkcja; całka od góry
// w teksturze 3D (rgb = światło rozproszone od kamery do z, a = transmitancja) —
// tekstura i odczyt w beltMedium.js (singleton — czyta go też materiał kadłuba).
//
// Złożenie bez bufora głębi, JEDEN właściciel piksela: każda powierzchnia passa
// gry (kadłuby, olbrzymy) dodaje całkę do swojej wysokości, skały gry i minerały —
// do stropu warstwy skał (rockMaterial.js, S.rockLayerTop), a „dno” — kwad z testem
// głębi POD wszystkim, co rysuje pass (FLOOR_Z) — kładzie pełną kolumnę tylko na tło.
//
// Różnice względem dema: pozycje względem początku pola (Core3D.fx.origin) zamiast
// lokalnej sceny dema; kwad dna w passie ortho Core3D (warstwa 0) z renderOrder przed
// efektami gry (emitery addytywne gry bez zapisu głębi zostają nad pyłem — w demie
// były tylko duszki pola po dnie); odczyt z gałęzią na włączniku (beltMedium.sample).

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, instanceIndex, textureStore, texture, texture3D,
  positionGeometry, varyingProperty, Loop, If, Return, mix, smoothstep, clamp, exp, max, min, pow
} from 'three/tsl';
import { createMediumNoiseVolume } from './rockNoise.js';
import { getBeltMedium, VOLUME_DEFAULTS } from './beltMedium.js';

// [j.] płaszczyzna kwadu dna — głębiej niż jakakolwiek powierzchnia passa gry
// (skały gry sięgają ~−4 tys. j., olbrzymy −8,2 tys.).
export const FLOOR_Z = -29000;
// Kwad dna w kolejce przezroczystych passa ortho: po minerałach i płytkiej mgle pola,
// PRZED efektami gry (dysze 0, Fx3D 1–5, kadłuby 9–10, odłamki 11 …) — emitery
// addytywne bez zapisu głębi zostają nad pyłem, a kadłub z zapisem głębi dokłada
// swój ośrodek sam (hak hullVolume).
export const FLOOR_RENDER_ORDER = -50;

function wrap1(v) {
  return v - Math.floor(v);
}

export class VolumeLight {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {import('../fx/lightGrid.js').LightGrid} o.grid siatka świateł gry (z atlasem cieni w grid.shadows)
   * @param {import('./fieldMap.js').FieldMap} o.fieldMap mapa pola (G = pył)
   * @param {THREE.Object3D} o.parent grupa pola (pass gry — kwad dna)
   * @param {number} [o.layer] warstwa Core3D kwadu dna (0 = pass ortho)
   */
  constructor({ renderer, grid, fieldMap, parent, layer = 0 }) {
    this.renderer = renderer;
    this.grid = grid;
    this.fieldMap = fieldMap;
    this.medium = getBeltMedium();
    this.cfg = { ...VOLUME_DEFAULTS };
    const cfg = this.cfg;
    this.enabled = true;
    this.NX = this.medium.NX;
    this.NY = this.medium.NY;
    this.NZ = this.medium.NZ;
    this.dz = this.medium.dz;
    this.texture = this.medium.texture;
    this.noise = createMediumNoiseVolume(renderer, 96);
    this.U = {
      count: uniform(0, 'uint'),
      nx: uniform(1, 'uint'),
      cell: uniform(new THREE.Vector2(10, 10)),
      fadeTop: uniform(cfg.fadeTop),
      fadeBot: uniform(cfg.fadeBot),
      dz: uniform(this.dz),
      density: uniform(cfg.density),
      base: uniform(cfg.base),
      gain: uniform(cfg.gain),
      ext: uniform(cfg.extinction),
      g: uniform(cfg.phaseG),
      near: uniform(cfg.near),
      invScaleA: uniform(1 / cfg.noiseScale),
      invScaleB: uniform(1 / cfg.detailScale),
      // Waga drobnych oktaw (gaśnie, gdy kolumna froxeli jest grubsza niż detal).
      fine: uniform(1),
      offA: uniform(new THREE.Vector3()),
      offB: uniform(new THREE.Vector3()),
      // Diagnostyka: 1 = sama gęstość ośrodka (jednorodne światło), 2 = światła bez szumu.
      dbg: uniform(0)
    };
    this.stats = { columns: 0, cellWorld: 0 };
    this._count = 0;
    this.zFloor = float(FLOOR_Z);
    this._buildCompute();
    this._buildFloor(parent, layer);
  }

  /** Gęstość ośrodka w punkcie P (lokalnie); macro = pył pola kolumny. */
  _density(P, macro) {
    const U = this.U;
    const M = this.medium.U;
    const vert = smoothstep(M.zBot, M.zBot.add(U.fadeBot), P.z).mul(float(1.0).sub(smoothstep(M.zTop.sub(U.fadeTop), M.zTop, P.z)));
    // Szum anizotropowy: w z drobniej (płyta ma ~1100 j. grubości); najdrobniejsza
    // oktawa grubsza niż kolumna froxeli (inaczej prążki).
    const qa = vec3(P.xy.mul(U.invScaleA), P.z.mul(U.invScaleA).mul(2.0)).add(U.offA);
    const qb = vec3(P.xy.mul(U.invScaleB), P.z.mul(U.invScaleB).mul(1.5)).add(U.offB);
    const na = texture3D(this.noise, qa).level(0);
    const nb = texture3D(this.noise, qb).level(0);
    const detail = mix(float(0.5), nb.g, U.fine);
    const n = na.r.mul(0.5).add(detail.mul(0.3)).add(na.b.mul(0.2));
    // Kontrast kłębów: prześwity (0,03) i gęste włókna (2,5) — smuga ma fakturę pyłu.
    const dens = mix(float(0.03), float(2.5), smoothstep(0.42, 0.62, n));
    return macro.mul(mix(dens, float(1.0), U.dbg.greaterThan(1.5).select(1.0, 0.0))).mul(vert);
  }

  _buildCompute() {
    const U = this.U;
    const M = this.medium.U;
    const grid = this.grid;
    const fm = this.fieldMap;
    const NZ = this.NZ;
    this.node = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const ix = instanceIndex.mod(U.nx).toVar();
      const iy = instanceIndex.div(U.nx).toVar();
      const xy = M.origin.add(vec2(float(ix).add(0.5), float(iy).add(0.5)).mul(U.cell)).toVar();
      const muv = clamp(xy.sub(fm.origin).mul(fm.invSize), 0.0, 1.0);
      const fmap = texture(fm.texture, muv).level(0);
      const macro = U.base.add(fmap.g).mul(U.density).toVar();
      const acc = vec3(0.0).toVar();
      const T = float(1.0).toVar();
      const g = U.g;
      const g2 = g.mul(g).toVar();
      Loop({ start: 0, end: NZ, type: 'int', condition: '<', name: 'kz' }, ({ kz }) => {
        const z = M.zTop.sub(float(kz).add(0.5).mul(U.dz));
        const P = vec3(xy, z).toVar();
        const rho = this._density(P, macro).toVar();
        const inS = vec3(0.0).toVar();
        If(U.dbg.greaterThan(0.5).and(U.dbg.lessThan(1.5)), () => {
          inS.assign(vec3(0.02));
        }).ElseIf(rho.greaterThan(1e-4), () => {
          grid.loop(P, ({ toL, att, col, scatter, dist }) => {
            // Widok z góry (+z do kamery): światło biegnie od lampy do P (−toL).
            const c = toL.z.negate();
            const ph = float(1.0).sub(g2).div(pow(max(g2.add(1.0).sub(g.mul(2.0).mul(c)), 1e-4), 1.5));
            // Bliskie pole: rozpraszanie ~1/d przy lampie (smuga zaczyna się jasno).
            const nb = min(float(1.0).div(dist.div(U.near).add(0.25)), 3.0);
            inS.addAssign(col.mul(att.mul(scatter).mul(ph).mul(nb)));
          });
        });
        const S = inS.mul(rho.mul(U.dz).mul(U.gain)).toVar();
        const tHalf = exp(rho.mul(U.ext).mul(U.dz).mul(-0.5)).toVar();
        const lit = S.mul(T).mul(tHalf).toVar();
        textureStore(this.texture, vec3(ix, iy, uint(kz)), vec4(acc.add(lit.mul(0.5)), T.mul(tHalf)));
        acc.addAssign(lit);
        T.mulAssign(tHalf.mul(tHalf));
      });
    })().compute(this.NX * this.NY).setName('beltVolumeLight');
  }

  _buildFloor(parent, layer) {
    const M = this.medium.U;
    this.floorCenter = uniform(new THREE.Vector2());
    this.floorSize = uniform(new THREE.Vector2(1, 1));
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:volumeFloor';
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.lights = false;
    mat.fog = false;
    // Premultiplied „over”: + rozproszenie, tło × transmitancja kolumny.
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.premultipliedAlpha = false;
    const zFloor = this.zFloor;
    const vLocal = varyingProperty('vec2', 'vBeltFloorLocal');
    mat.positionNode = Fn(() => {
      const p = positionGeometry.xy.mul(this.floorSize).add(this.floorCenter).toVar();
      vLocal.assign(p);
      return vec3(p, zFloor);
    })();
    mat.fragmentNode = Fn(() => {
      // Pełna kolumna (odczyt na dnie ośrodka; kwad leży dużo głębiej).
      const s = this.medium._column(vec3(vLocal, M.zBot.sub(1.0)));
      return vec4(max(s.rgb, vec3(0.0)), clamp(float(1.0).sub(s.a), 0.0, 1.0));
    })();
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.floor.frustumCulled = false;
    this.floor.renderOrder = FLOOR_RENDER_ORDER;
    this.floor.name = 'AsteroidBelt:volumeFloor';
    this.floor.layers.set(layer);
    this.floor.visible = false;
    parent.add(this.floor);
  }

  /**
   * Siatka kolumn nad kadrem gry. camX, camY — środek kadru LOKALNIE (scena −
   * początek pola), originX/Y — początek pola w świecie gry (faza szumu w double).
   */
  update({ camX, camY, zoom, viewW, viewH, time, originX, originY }) {
    const U = this.U;
    const M = this.medium.U;
    const cfg = this.cfg;
    M.on.value = this.enabled ? 1 : 0;
    this.floor.visible = this.enabled;
    if (!this.enabled) { this._count = 0; return; }
    const halfW = viewW * 0.5 / zoom * 1.08;
    const halfH = viewH * 0.5 / zoom * 1.08;
    let cell = cfg.cellPx / zoom;
    cell = Math.max(cell, (2 * halfW) / (this.NX - 3), (2 * halfH) / (this.NY - 3));
    const x0 = Math.floor((camX - halfW) / cell) * cell;
    const y0 = Math.floor((camY - halfH) / cell) * cell;
    const nx = Math.min(this.NX, Math.ceil((camX + halfW - x0) / cell) + 1);
    const ny = Math.min(this.NY, Math.ceil((camY + halfH - y0) / cell) + 1);
    M.origin.value.set(x0, y0);
    U.cell.value.set(cell, cell);
    U.nx.value = nx;
    U.count.value = nx * ny;
    this._count = nx * ny;
    M.invTex.value.set(1 / (cell * this.NX), 1 / (cell * this.NY), 1 / (this.NZ * this.dz));
    U.density.value = cfg.density;
    // Włókna (najdrobniej ~160 j.) gasną, gdy kolumna ma > 40 j. (mocne oddalenie).
    U.fine.value = Math.max(0, Math.min(1, (60 - cell) / 30));
    U.gain.value = cfg.gain;
    U.base.value = cfg.base;
    // Faza szumu: (początek pola + dryf) / skala, mod 1 (tekstura okresowa).
    const vx = cfg.drift[0];
    const vy = cfg.drift[1];
    const vz = cfg.drift[2];
    const sx = originX + vx * time;
    const sy = -originY + vy * time;
    U.offA.value.set(wrap1(sx / cfg.noiseScale), wrap1(sy / cfg.noiseScale), wrap1(vz * time / cfg.noiseScale));
    U.offB.value.set(wrap1((sx * 1.7) / cfg.detailScale), wrap1((sy * 1.7) / cfg.detailScale), wrap1(0.37 + vz * time * 2 / cfg.detailScale));
    this.floorCenter.value.set(camX, camY);
    this.floorSize.value.set(halfW * 2.4, halfH * 2.4);
    this.stats.columns = nx * ny;
    this.stats.cellWorld = cell;
  }

  /** Przebieg compute (po zbudowaniu siatki świateł i map cienia tej klatki). */
  compute() {
    if (!this.enabled || !this._count) return;
    this.renderer.compute(this.node, this._count);
  }

  /** Pas poza kadrem: ośrodek wyłączony (materiały bez odczytu, kwad dna schowany). */
  disable() {
    this.medium.U.on.value = 0;
    this.floor.visible = false;
    this._count = 0;
  }

  setVisible(v) {
    this.enabled = !!v;
  }
}
