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
//
// WĄTEK NA PLASTRY (2026-10-18, docs/AUDYT-render-worker-2026-10-17.md § 7.5): dawny kernel to wątek na kolumnę,
// który liczy 40 plastrów po kolei, w każdym pętlę po światłach komórki siatki świateł. Przy 5120 px to ~73 tys.
// wątków (mniej niż jedna pełna fala GPU), a w rzezi bitwy gorące komórki mają do ~125 świateł (średnio ~3,5) —
// czas kernela to czas najdłuższych łańcuchów szeregowych (40 plastrów × światła komórki w jednym wątku).
// Kernel `plastry` (VOLUME_LIGHT_TUNE.slices, domyślnie): grupa robocza = `cols` kolumn × NZ/`per` wątków, wątek liczy
// gęstość i rozproszenie SWOICH `per` plastrów (ta sama funkcja `_sliceLight` co dawny kernel), wyniki idą do pamięci
// grupy, a po barierze `cols` sąsiednich wątków (jeden warp) całkuje po kolumnie od stropu w dół (ta sama arytmetyka
// i kolejność co dawny kernel) — tekstura bit w bit (odczyt z GPU: scripts/webgpu/pas-swiatlo-gra.mjs). Warp to
// plastry jednej, najwyżej dwóch sąsiednich kolumn — ta sama lista komórki, ten sam przebieg pętli świateł.

import * as THREE from 'three/webgpu';
import {
  Fn, float, uint, vec2, vec3, vec4, uniform, instanceIndex, textureStore, texture, texture3D,
  positionGeometry, varyingProperty, Loop, If, Return, mix, smoothstep, clamp, exp, max, min, pow,
  workgroupArray, workgroupBarrier
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

// Przełącznik A/B na żywo (oba kernele zbudowane i rozgrzane raz, `compute()` wybiera): slices = false — dawny kernel
// (wątek na kolumnę). cols / per — kolumny na grupę roboczą i plastry na wątek kernela `plastry` (inna para niż
// domyślna buduje i kompiluje swój kernel przy pierwszym użyciu — tylko do pomiarów).
export const VOLUME_LIGHT_TUNE = { slices: true, cols: 8, per: 2 };
// 8 kolumn × 20 wątków (po 2 plastry) = grupa 160 — najszybszy z układów 4×1, 8×2, 16×4, 32×8 w ciężkiej i lekkiej
// klatce bitwy (pomiar: pas-swiatlo-gra.mjs --koszt; § 7.5 audytu).
const VOLUME_SLICES_DEFAULT = Object.freeze({ cols: 8, per: 2 });

/**
 * Lustro CPU podziału wątków kernela `plastry` (cols kolumn na grupę, per plastrów na wątek; per dzieli nz): wątek
 * `id` → kolumna (indeks w siatce kolumn, wiersz po wierszu), jego plastry (sub + j · nz/per — sąsiednie wątki warpu
 * to sąsiednie plastry), miejsce w grupie. Kolumna ≥ liczby kolumn — wątek bez pracy (dochodzi tylko do bariery).
 * Całkuje kolumnę `colLocal` grupy wątek o miejscu colLocal (cols sąsiednich wątków jednego warpu).
 */
export function volumeSliceThread(id, nz, cols = VOLUME_SLICES_DEFAULT.cols, per = VOLUME_SLICES_DEFAULT.per) {
  const tpc = nz / per;
  const wg = cols * tpc;
  const lane = id % wg;
  const colLocal = Math.floor(lane / tpc);
  const sub = lane % tpc;
  const kz = [];
  for (let j = 0; j < per; j++) kz.push(sub + j * tpc);
  return { column: Math.floor(id / wg) * cols + colLocal, kz, lane, colLocal, group: Math.floor(id / wg), wg };
}

/** Wątki dispatchu kernela `plastry` dla `columns` kolumn (pełne grupy). */
export function volumeSliceThreads(columns, nz, cols = VOLUME_SLICES_DEFAULT.cols, per = VOLUME_SLICES_DEFAULT.per) {
  return Math.ceil(columns / cols) * cols * (nz / per);
}

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
    const NZ = this.NZ;
    // Dawny kernel: wątek na kolumnę, 40 plastrów po kolei (VOLUME_LIGHT_TUNE.slices = false).
    this.node = Fn(() => {
      If(instanceIndex.greaterThanEqual(U.count), () => { Return(); });
      const ix = instanceIndex.mod(U.nx).toVar();
      const iy = instanceIndex.div(U.nx).toVar();
      const { xy, macro } = this._column(ix, iy);
      const acc = vec3(0.0).toVar();
      const T = float(1.0).toVar();
      const g = U.g;
      const g2 = g.mul(g).toVar();
      Loop({ start: 0, end: NZ, type: 'int', condition: '<', name: 'kz' }, ({ kz }) => {
        const { S, tHalf } = this._sliceLight(xy, kz, macro, g, g2);
        const lit = S.mul(T).mul(tHalf).toVar();
        textureStore(this.texture, vec3(ix, iy, uint(kz)), vec4(acc.add(lit.mul(0.5)), T.mul(tHalf)));
        acc.addAssign(lit);
        T.mulAssign(tHalf.mul(tHalf));
      });
    })().compute(this.NX * this.NY).setName('beltVolumeLight');
    this._slicesNodes = new Map();
    this.nodeSlices = this._slicesNode(VOLUME_SLICES_DEFAULT.cols, VOLUME_SLICES_DEFAULT.per);
  }

  /** Kernel `plastry` dla pary (kolumny na grupę, plastry na wątek) — budowany raz na parę. */
  _slicesNode(cols, per) {
    const key = cols * 1000 + per;
    let node = this._slicesNodes.get(key);
    if (!node) {
      node = this._slicesKernel(cols, per);
      this._slicesNodes.set(key, node);
    }
    return node;
  }

  /** Kernel `plastry` (opis w nagłówku pliku): wątek na (kolumnę, plastry), całkowanie po barierze grupy. */
  _slicesKernel(cols, per) {
    const U = this.U;
    const NZ = this.NZ;
    if (NZ % per !== 0) throw new Error(`[VolumeLight] plastry na wątek (${per}) muszą dzielić NZ (${NZ})`);
    const TPC = NZ / per;
    const WG = cols * TPC;
    if (WG > 256) throw new Error(`[VolumeLight] grupa robocza ${WG} > 256 wątków`);
    // Pamięć grupy: rozproszenie plastra (rgb) + gęstość × dz × gain (a) oraz transmitancja pół plastra.
    const sharedL = workgroupArray('vec4', cols * NZ);
    const sharedT = workgroupArray('float', cols * NZ);
    const node = Fn(() => {
      const lane = instanceIndex.mod(uint(WG)).toVar();
      const group = instanceIndex.div(uint(WG)).toVar();
      const colLocal = lane.div(uint(TPC)).toVar();
      const sub = lane.mod(uint(TPC)).toVar();
      const id = group.mul(uint(cols)).add(colLocal).toVar();
      If(id.lessThan(U.count), () => {
        const { xy, macro } = this._column(id.mod(U.nx), id.div(U.nx));
        const g = U.g;
        const g2 = g.mul(g).toVar();
        const slice = (kz) => {
          const { inS, rho } = this._sliceLight(xy, kz, macro, g, g2, false);
          // Postać wyrażeń jak w dawnym kernelu (zmienne w tych samych miejscach): sterownik przestawia iloczyny
          // (fast-math) zależnie od tego, co jest zmienną — S = inS · (rho·dz·gain) liczone dopiero w wątku
          // całkującym, tHalf tutaj (sprawdzone odczytem tekstury: inne podziały dawały 1 ULP f16 w ~0,002–0,01% tekseli).
          const k1 = rho.mul(U.dz).mul(U.gain).toVar();
          const tHalf = exp(rho.mul(U.ext).mul(U.dz).mul(-0.5)).toVar();
          const at = colLocal.mul(uint(NZ)).add(kz).toVar();
          sharedL.element(at).assign(vec4(inS, k1));
          sharedT.element(at).assign(tHalf);
        };
        if (per === 1) slice(sub);
        else {
          Loop({ start: 0, end: per, type: 'int', condition: '<', name: 'kzJ' }, ({ kzJ }) => {
            slice(sub.add(uint(kzJ).mul(uint(TPC))).toVar());
          });
        }
      });
      // Bariera w jednolitym przepływie (bez wcześniejszego wyjścia) — wszystkie wątki grupy dochodzą tutaj.
      workgroupBarrier();
      // Całkowanie: wątek o miejscu c < cols całkuje kolumnę c grupy — cols sąsiednich wątków jednego warpu.
      const cid = group.mul(uint(cols)).add(lane).toVar();
      If(lane.lessThan(uint(cols)).and(cid.lessThan(U.count)), () => {
        const ix = cid.mod(U.nx).toVar();
        const iy = cid.div(U.nx).toVar();
        const base = lane.mul(uint(NZ)).toVar();
        const acc = vec3(0.0).toVar();
        const T = float(1.0).toVar();
        Loop({ start: 0, end: NZ, type: 'int', condition: '<', name: 'kzI' }, ({ kzI }) => {
          const v = sharedL.element(base.add(uint(kzI))).toVar();
          const tHalf = sharedT.element(base.add(uint(kzI))).toVar();
          const S = v.xyz.mul(v.w).toVar();
          const lit = S.mul(T).mul(tHalf).toVar();
          textureStore(this.texture, vec3(ix, iy, uint(kzI)), vec4(acc.add(lit.mul(0.5)), T.mul(tHalf)));
          acc.addAssign(lit);
          T.mulAssign(tHalf.mul(tHalf));
        });
      });
    })().compute(volumeSliceThreads(this.NX * this.NY, NZ, cols, per), [WG]).setName('beltVolumeLight');
    node.__volCols = cols;
    node.__volPer = per;
    return node;
  }

  /** TSL: środek kolumny (lokalnie) i pył pola kolumny z mapy pola. */
  _column(ix, iy) {
    const U = this.U;
    const M = this.medium.U;
    const fm = this.fieldMap;
    const xy = M.origin.add(vec2(float(ix).add(0.5), float(iy).add(0.5)).mul(U.cell)).toVar();
    const muv = clamp(xy.sub(fm.origin).mul(fm.invSize), 0.0, 1.0);
    const fmap = texture(fm.texture, muv).level(0);
    const macro = U.base.add(fmap.g).mul(U.density).toVar();
    return { xy, macro };
  }

  /**
   * TSL: plaster kz kolumny xy — gęstość, rozproszenie wszystkich świateł siatki (faza HG, bliskie pole) i ich wkład
   * do całki: { S (rozproszenie × gęstość × dz × gain), tHalf (transmitancja pół plastra) }; integrand = false —
   * { inS, rho } (kernel `plastry` składa wkład sam). Wspólne dla obu kerneli.
   */
  _sliceLight(xy, kz, macro, g, g2, integrand = true) {
    const U = this.U;
    const M = this.medium.U;
    const grid = this.grid;
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
    return integrand ? this._sliceIntegrand(inS, rho) : { inS, rho };
  }

  /** TSL: wkład plastra do całki z rozproszenia inS i gęstości rho — { S, tHalf }. */
  _sliceIntegrand(inS, rho) {
    const U = this.U;
    const S = inS.mul(rho.mul(U.dz).mul(U.gain)).toVar();
    const tHalf = exp(rho.mul(U.ext).mul(U.dz).mul(-0.5)).toVar();
    return { S, tHalf };
  }

  _buildFloor(parent, layer) {
    const M = this.medium.U;
    this.floorCenter = uniform(new THREE.Vector2());
    this.floorSize = uniform(new THREE.Vector2(1, 1));
    const mat = new THREE.NodeMaterial();
    mat.name = 'AsteroidBelt:volumeFloor';
    // Dno ośrodka pod całym kadrem (4 wierzchołki) — rulon warpa (src/3d/warp/rulon.js) go nie zgina.
    mat.rulonBend = false;
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
    const T = VOLUME_LIGHT_TUNE;
    if (T.slices) {
      const node = T.cols === VOLUME_SLICES_DEFAULT.cols && T.per === VOLUME_SLICES_DEFAULT.per ? this.nodeSlices : this._slicesNode(T.cols, T.per);
      this.renderer.compute(node, volumeSliceThreads(this._count, this.NZ, node.__volCols, node.__volPer));
    } else {
      this.renderer.compute(this.node, this._count);
    }
  }

  /** Kernele do rozgrzewki (puste dispatche — licznik kolumn w uniformie = 0 przed pierwszą klatką pola). */
  computeNodes() {
    return [this.node, this.nodeSlices];
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
