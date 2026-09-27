// dema/asteroidy-webgpu/volumetrics.js
//
// ŚWIATŁO WOLUMETRYCZNE: smugi reflektorów (dalekich i otoczenia), poświata
// wybuchów, piorunów, świecących skał i lamp w cienkim pyle pola — z cieniami
// skał w smudze (atlas map cienia, spotShadows.js).
//
// Ośrodek to płyta wokół płaszczyzny gry (z od zBot do zTop, miękkie brzegi),
// gęstość = pył pola z mapy pola (sunMap.js: waga pasa × pole) × szum 3D
// (kłęby i włókna, rockNoise.js) — smuga ma fakturę pyłu, gęste pole świeci
// mocniej niż rzadki pas.
//
// Siatka froxeli wyrównana do kamery gry (ortho, z góry): kolumna na ~4 px
// ekranu × 40 plastrów w z, zakotwiczona w świecie (bez pływania przy
// przesuwaniu kadru). Jeden przebieg compute na KOLUMNĘ: od góry w dół
// rozpraszanie wszystkich świateł siatki (lights.js — ta sama lista co dla
// skał; komórka siatki świateł jest wspólna dla całej kolumny), funkcja fazy
// Henyeya–Greensteina, ekstynkcja, całka od góry zapisana w teksturze 3D
// (rgb = światło rozproszone od kamery do głębokości z, a = transmitancja).
//
// Złożenie bez bufora głębi, JEDEN właściciel piksela: każda powierzchnia
// passa gry (kadłuby, olbrzymy) dodaje całkę do swojej wysokości (sample(P)
// w materiale; pod dnem ośrodka = pełna kolumna), skały gry i minerały na nich
// — do stropu warstwy skał (rockMaterial.js, S.rockLayerTop), a „dno” — kwad
// z testem głębi POD wszystkim, co rysuje pass (FLOOR_Z) — kładzie pełną
// kolumnę tylko na tło.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, instanceIndex, textureStore, texture, texture3D,
  positionGeometry, positionWorld, Loop, If, Return, mix, smoothstep, clamp, exp, max, min, pow, floor, step
} from 'three/tsl';
import { createMediumNoiseVolume } from './rockNoise.js';

export const VOLUME_DEFAULTS = Object.freeze({
  cellPx: 4,          // kolumna froxeli na tyle pikseli ekranu (co najmniej)
  maxColumns: 420,    // …ale nie więcej kolumn w poprzek kadru (koszt nie rośnie z rozdzielczością)
  nz: 40,
  zTop: 380,          // [j.] strop ośrodka (reflektory dziobu świecą z z = 140)
  zBot: -760,         // [j.] dno ośrodka (pod nim skały tła i mgła głęboka)
  fadeTop: 300,
  fadeBot: 320,
  density: 1.0,       // mnożnik gęstości (suwak)
  base: 0.1,          // pył poza gęstymi polami (rzadki pas) — dodawany do mapy pola
  gain: 0.0014,       // jasność smug (skala: j. drogi × moc świateł)
  extinction: 1.6e-4, // [1/j.] przy gęstości 1
  phaseG: 0.3,        // rozpraszanie w przód (patrząc pod światło jaśniej)
  near: 380,          // [j.] bliskie pole lampy: smuga najjaśniejsza tuż przy lampie
  noiseScale: 5200,   // [j.] okres szumu kłębów (5 oktaw: 1300 … 80 j.)
  detailScale: 2600,  // [j.] okres włókien (szum grzbietowy, 3 oktawy: 650 … 160 j.)
  drift: [16, 7, 2]   // [j./s] dryf faktury pyłu
});

// [j.] płaszczyzna kwadu dna — głębiej niż jakakolwiek powierzchnia passa gry.
const FLOOR_Z = -29000;

function wrap1(v) {
  return v - Math.floor(v);
}

export class VolumeLight {
  /**
   * @param {object} o
   * @param {THREE.WebGPURenderer} o.renderer
   * @param {import('./lights.js').LightGrid} o.grid siatka świateł (z atlasem cieni w grid.shadows)
   * @param {import('./sunMap.js').FieldMap} o.fieldMap mapa pola (G = pył)
   * @param {THREE.Scene} o.scene pass gry (dno ośrodka)
   * @param {number} [o.maxW] [px] największy kadr (rozmiar tekstury)
   * @param {number} [o.maxH]
   */
  constructor({ renderer, grid, fieldMap, scene, maxW = 2560, maxH = 1440 }) {
    this.renderer = renderer;
    this.grid = grid;
    this.fieldMap = fieldMap;
    this.cfg = { ...VOLUME_DEFAULTS };
    const cfg = this.cfg;
    this.enabled = true;
    // Przy dużym kadrze kolumna rośnie ponad cellPx (2560 px → ~6 px).
    const cellPx = Math.max(cfg.cellPx, maxW / cfg.maxColumns);
    this.NX = Math.ceil((maxW / cellPx) * 1.2) + 4;
    this.NY = Math.ceil((maxH / cellPx) * 1.2) + 4;
    this.NZ = cfg.nz;
    this.dz = (cfg.zTop - cfg.zBot) / this.NZ;
    const tex = new THREE.Storage3DTexture(this.NX, this.NY, this.NZ);
    tex.name = 'volumeLight';
    tex.type = THREE.HalfFloatType;
    tex.format = THREE.RGBAFormat;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.NoColorSpace;
    this.texture = tex;
    this.noise = createMediumNoiseVolume(renderer, 96);
    this.U = {
      count: uniform(0, 'uint'),
      nx: uniform(1, 'uint'),
      origin: uniform(new THREE.Vector2()),
      cell: uniform(new THREE.Vector2(10, 10)),
      invTex: uniform(new THREE.Vector3(1, 1, 1)),
      zTop: uniform(cfg.zTop),
      zBot: uniform(cfg.zBot),
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
      on: uniform(1),
      // Diagnostyka: 1 = sama gęstość ośrodka (jednorodne światło), 2 = światła bez szumu.
      dbg: uniform(0)
    };
    this.stats = { columns: 0, cellWorld: 0 };
    // Kwad „dna” leży pod WSZYSTKIM, co rysuje pass gry (kamera ortho z = 30 000,
    // far 60 000 → płaszczyzna far na z = −30 000), więc pokrywa tylko tło.
    this.zFloor = float(FLOOR_Z);
    this._buildCompute();
    this._buildFloor(scene);
  }

  /** Gęstość ośrodka w punkcie P (scena); macro = pył pola kolumny. */
  _density(P, macro) {
    const U = this.U;
    const vert = smoothstep(U.zBot, U.zBot.add(U.fadeBot), P.z).mul(float(1.0).sub(smoothstep(U.zTop.sub(U.fadeTop), U.zTop, P.z)));
    // Szum anizotropowy: w z drobniej (płyta ma ~1100 j. grubości).
    // Szum: najdrobniejsza oktawa grubsza niż kolumna froxeli (inaczej prążki).
    const qa = vec3(P.xy.mul(U.invScaleA), P.z.mul(U.invScaleA).mul(2.0)).add(U.offA);
    const qb = vec3(P.xy.mul(U.invScaleB), P.z.mul(U.invScaleB).mul(1.5)).add(U.offB);
    const na = texture3D(this.noise, qa).level(0);
    const nb = texture3D(this.noise, qb).level(0);
    const detail = mix(float(0.5), nb.g, U.fine);
    const n = na.r.mul(0.5).add(detail.mul(0.3)).add(na.b.mul(0.2));
    // Kontrast kłębów: prześwity (0,05) i gęste włókna (2,2) — smuga ma fakturę
    // pyłu (przy progach 0,3–0,78 fbm o małej wariancji dawał jednolitą szarość).
    const dens = mix(float(0.03), float(2.5), smoothstep(0.42, 0.62, n));
    return macro.mul(mix(dens, float(1.0), U.dbg.greaterThan(1.5).select(1.0, 0.0))).mul(vert);
  }

  _buildCompute() {
    const U = this.U;
    const grid = this.grid;
    const fm = this.fieldMap;
    const NZ = this.NZ;
    this.node = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const ix = instanceIndex.mod(U.nx).toVar();
      const iy = instanceIndex.div(U.nx).toVar();
      const xy = U.origin.add(vec2(float(ix).add(0.5), float(iy).add(0.5)).mul(U.cell)).toVar();
      const muv = clamp(xy.sub(fm.origin).mul(fm.invSize), 0.0, 1.0);
      const fmap = texture(fm.texture, muv).level(0);
      const macro = U.base.add(fmap.g).mul(U.density).toVar();
      const acc = vec3(0.0).toVar();
      const T = float(1.0).toVar();
      const g = U.g;
      const g2 = g.mul(g).toVar();
      Loop({ start: 0, end: NZ, type: 'int', condition: '<', name: 'kz' }, ({ kz }) => {
        const z = U.zTop.sub(float(kz).add(0.5).mul(U.dz));
        const P = vec3(xy, z).toVar();
        const rho = this._density(P, macro).toVar();
        const inS = vec3(0.0).toVar();
        If(U.dbg.greaterThan(0.5).and(U.dbg.lessThan(1.5)), () => {
          inS.assign(vec3(0.02));
        }).ElseIf(rho.greaterThan(1e-4).and(U.on.greaterThan(0.5)), () => {
          grid.loop(P, ({ toL, att, col, scatter, dist }) => {
            // Widok z góry (+z do kamery): światło biegnie od lampy do P (−toL).
            const c = toL.z.negate();
            const ph = float(1.0).sub(g2).div(pow(max(g2.add(1.0).sub(g.mul(2.0).mul(c)), 1e-4), 1.5));
            // Bliskie pole: rozpraszanie ~1/d przy lampie (smuga zaczyna się jasno,
            // stożek przy lampie jest wąski — bez tego smuga „rosła z niczego”).
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
    })().compute(this.NX * this.NY).setName('volumeLight');
  }

  /**
   * TSL dla materiałów passa gry: światło rozproszone od kamery do wysokości
   * P.z (rgb) i transmitancja (a); pod dnem ośrodka pełna kolumna. Kwad dna
   * leży pod wszystkim (FLOOR_Z) i pokrywa tylko tło, więc kolumna wchodzi
   * na piksel raz (wcześniej kwad tuż pod zBot kładł ją też na powierzchnie
   * głębsze niż dno — duże skały liczyły pył dwa razy).
   */
  sample(P) {
    return mix(vec4(0.0, 0.0, 0.0, 1.0), this._column(P), this.U.on);
  }

  /**
   * Całka kolumny do wysokości P.z. W XY filtr B-spline z 4 próbek
   * trójliniowych (trójliniowy sam robił schodki na wąskich smugach przy
   * lampach), w z liniowo.
   */
  _column(P) {
    const U = this.U;
    const size = vec2(this.NX, this.NY);
    const t = vec2(P.x.sub(U.origin.x).mul(U.invTex.x), P.y.sub(U.origin.y).mul(U.invTex.y)).mul(size).sub(0.5).toVar();
    const i = floor(t);
    const f = t.sub(i).toVar();
    const f2 = f.mul(f);
    const f3 = f2.mul(f);
    const w0 = f3.negate().add(f2.mul(3.0)).sub(f.mul(3.0)).add(1.0).div(6.0);
    const w1 = f3.mul(3.0).sub(f2.mul(6.0)).add(4.0).div(6.0);
    const w2 = f3.mul(-3.0).add(f2.mul(3.0)).add(f.mul(3.0)).add(1.0).div(6.0);
    const w3 = f3.div(6.0);
    const g0 = w0.add(w1).toVar();
    const g1 = w2.add(w3).toVar();
    const h0 = i.sub(0.5).add(w1.div(g0)).div(size).toVar();
    const h1 = i.add(1.5).add(w3.div(g1)).div(size).toVar();
    const wz = U.zTop.sub(P.z).mul(U.invTex.z).toVar();
    const tap = (u, v) => texture3D(this.texture, vec3(u, v, wz)).level(0);
    return tap(h0.x, h0.y).mul(g0.x).add(tap(h1.x, h0.y).mul(g1.x)).mul(g0.y)
      .add(tap(h0.x, h1.y).mul(g0.x).add(tap(h1.x, h1.y).mul(g1.x)).mul(g1.y));
  }

  _buildFloor(scene) {
    const U = this.U;
    this.floorCenter = uniform(new THREE.Vector2());
    this.floorSize = uniform(new THREE.Vector2(1, 1));
    const mat = new THREE.NodeMaterial();
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
    const zFloor = this.zFloor;
    mat.positionNode = vec3(positionGeometry.xy.mul(this.floorSize).add(this.floorCenter), zFloor);
    mat.fragmentNode = Fn(() => {
      // Pełna kolumna (odczyt na dnie ośrodka; kwad leży dużo głębiej).
      const s = this._column(vec3(positionWorld.xy, U.zBot.sub(1.0)));
      return vec4(max(s.rgb, vec3(0.0)), clamp(float(1.0).sub(s.a), 0.0, 1.0));
    })();
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.floor.frustumCulled = false;
    // Po płytkiej mgle (8–9), przed duszkami blasku (20).
    this.floor.renderOrder = 12;
    this.floor.name = 'volumeFloor';
    scene.add(this.floor);
  }

  /**
   * Siatka kolumn nad kadrem gry. cam = (camX, camY) w SCENIE, originX/Y =
   * lokalny początek sceny (świat gry) — faza szumu liczona w double.
   */
  update({ camX, camY, zoom, viewW, viewH, time, originX, originY }) {
    const U = this.U;
    const cfg = this.cfg;
    U.on.value = this.enabled ? 1 : 0;
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
    U.origin.value.set(x0, y0);
    U.cell.value.set(cell, cell);
    U.nx.value = nx;
    U.count.value = nx * ny;
    this._count = nx * ny;
    U.invTex.value.set(1 / (cell * this.NX), 1 / (cell * this.NY), 1 / (this.NZ * this.dz));
    U.density.value = cfg.density;
    // Włókna (najdrobniej ~160 j.) gasną, gdy kolumna ma > 40 j. (mocne oddalenie).
    U.fine.value = Math.max(0, Math.min(1, (60 - cell) / 30));
    U.gain.value = cfg.gain;
    U.base.value = cfg.base;
    // Faza szumu: (początek sceny + dryf) / skala, mod 1 (tekstura okresowa).
    const [vx, vy, vz] = cfg.drift;
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

  setVisible(v) {
    this.enabled = !!v;
  }
}
