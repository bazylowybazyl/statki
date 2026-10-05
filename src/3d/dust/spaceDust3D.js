// src/3d/dust/spaceDust3D.js
//
// PYŁ KOSMICZNY — obraz (TSL). Logika warstw, oktaw i prędkości kamery: spaceDust.js (tam opis „po co”).
//
// Trzy siatki, jeden graf fragmentu (te same varyingi):
//   • 'ortho' — pass ortho (warstwa 0), z = −12: POD kadłubami (dół płyty kadłuba −10,4, modelSlabDepth.js),
//     nad skałami pasa; test głębi z kadłubami, bez zapisu. Warstwy p ≤ ~1,5.
//   • 'fg'    — pass FG (warstwa 2), bez testu głębi, na wierzchu: rzadkie, rozmyte drobiny „przy kamerze”.
//     Obie na grafie wierzchołków 2D: kwad instancji liczy położenie w PIKSELACH kadru (od środka, y w górę)
//     z uniformów widoku i wypisuje klip wprost (głębia i w z rzutu początku siatki — działa w kamerze ortho
//     i perspektywy passa FG), więc siatka nie jedzie za kamerą (stoi w 0, 0; frustumCulled = false).
//   • 'free'  — kamery 3D (K, free3d): pass ortho rysuje wtedy kamerą perspektywy ze wspólną głębią; drobiny
//     w sześcianie wokół kamery (oktawy z odległości do celu), obrót kamery bez przesunięcia (cameraViewMatrix ×
//     (pozycja względem kamery, 0) — float32 bez dużych liczb), smuga = rzut drogi drobiny względem kamery.
// Rulon warpa zgina wszystkie jak resztę gry (hak klipu).
//
// Uniformy (tablica vec4 `spaceDust` / `spaceDust3d` — po jednym buforze) pisze hak przed passem ortho
// (Core3D.addPassHook) z kamerą TEGO renderu: podzielony ekran = dwa widoki, każdy z własnym położeniem wzoru
// i prędkością kamery (frame()).
//
// Światło: siatka świateł efektów (Core3D.fx.grid — błyski luf, trafienia, wybuchy, rakiety, reflektory w pasie)
// w punkcie drobiny i POŚWIATA DYSZ MAIN (stożki z EngineFrame, barwa palety silnika). Słońce: maska cienia
// (sunShadeUnlit) — w cieniu planety pył gaśnie razem z kadłubami. Emisji własnej brak.

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Discard,
  abs, attribute, cameraProjectionMatrix, cameraViewMatrix, clamp, dot, exp, float, fract, int, length, max, min,
  mix, modelViewMatrix, positionGeometry, pow, select, sin, smoothstep, sqrt, uniformArray, varyingProperty,
  vec2, vec3, vec4
} from 'three/tsl';
import { Core3D } from '../core3d.js';
import { sunShadeUnlit } from '../sunShadowMask.js';
import { blendAddytywnePremul } from '../tsl/mieszanie.js';
import { WARP_STARS } from '../warp/stars.js';
import { EngineFrame } from '../engineFrame.js';
import {
  SPACE_DUST_TUNE, DUST_HEADER_VEC4, DUST_SLOT_VEC4, DUST_INSTANCE_STRIDE, DUST_PLUME_VEC4,
  DUST3D_HEADER_VEC4, DUST3D_SLOT_VEC4, DustViewTracker,
  buildDust3DInstances, buildDustInstances, dust3DPlumeBase, dust3DUniformCount, dustPlumeBase, dustUniformCount,
  dustVisibility, writeDust3DUniforms, writeDustPlumes, writeDustUniforms
} from './spaceDust.js';

/** Siatki pyłu: warstwa passa, wysokość w scenie (głębia w passie ortho), kolejność rysowania. */
export const DUST_MESH = Object.freeze({
  ortho: Object.freeze({ layer: 0, z: -12, renderOrder: 0.5, depthTest: true }),
  fg: Object.freeze({ layer: 2, z: 0, renderOrder: 60, depthTest: false }),
  free: Object.freeze({ layer: 0, z: 0, renderOrder: 0.5, depthTest: true })
});
/** Sufit światła na drobinie (HDR) — błysk i dysze wydobywają pył, ale nie robią z niego gwiazd. */
export const DUST_LIGHT_CAP = 3.0;

// Varyingi wspólne dla wszystkich grafów wierzchołków (jeden graf fragmentu).
function dustVaryings() {
  return {
    vS: varyingProperty('float', 'vDustS'),       // wzdłuż smugi [px]: 0 = głowa, −L = ogon
    vT: varyingProperty('float', 'vDustT'),       // w poprzek [px]
    vL: varyingProperty('float', 'vDustL'),       // długość smugi [px]
    vW: varyingProperty('float', 'vDustW'),       // promień plamki [px]
    vCol: varyingProperty('vec4', 'vDustCol'),    // barwa słońca × intensywność, waga (widoczność · jasność · migotanie)
    vLight: varyingProperty('vec3', 'vDustLight'), // światło efektów i dysz
    vMisc: varyingProperty('vec2', 'vDustMisc')   // miękkość, faza
  };
}

// Stożki poświaty dysz (spaceDust.js: writeDustPlumes / dustPlumeLightCpu): P — punkt drobiny w scenie WZGLĘDEM
// kamery, z — wysokość drobiny (scena). Wklejane (czyta tablicę uniformów — bez setLayout).
function plumeLight(U, base, count, P, z) {
  const acc = vec3(0.0).toVar();
  Loop({ start: int(0), end: count, type: 'int', condition: '<', name: 'dustPlume' }, ({ dustPlume }) => {
    const o = int(base).add(dustPlume.mul(DUST_PLUME_VEC4)).toVar();
    const A = U.element(o).toVar();
    const B = U.element(o.add(1)).toVar();
    const C = U.element(o.add(2)).toVar();
    const rel = P.sub(A.xy).toVar();
    const along = dot(rel, A.zw).toVar();
    const q = rel.sub(A.zw.mul(along));
    const L = max(B.x, 1.0);
    const W = max(B.y, 1.0).toVar();
    const t = clamp(along.div(L), 0.0, 1.0).toVar();
    const w = W.mul(float(1.0).add(B.w.sub(1.0).mul(t)));
    const cross = dot(q, q).div(w.mul(w));
    const start = smoothstep(W.mul(-0.8), W.mul(0.2), along);
    const end = float(1.0).sub(t).mul(float(1.0).sub(t));
    const zf = exp(z.mul(z).div(W.mul(W).mul(4.0)).negate());
    acc.addAssign(C.xyz.mul(B.z.mul(exp(cross.mul(-1.6))).mul(start).mul(end).mul(zf)));
  });
  return acc;
}

// Smuga i plamka w pikselach: wspólny dla grafów 2D i 3D zapis kwadu (head — głowa [px], dir — kierunek ruchu
// na ekranie, L — długość [px], w — promień [px]) i varyingów; zwraca piksel wierzchołka.
function writeStreak(V, head, dir, L, w, weight, color, light, misc) {
  const pad = w.mul(2.6).add(1.0).toVar();
  const g = positionGeometry.xy;
  const s = mix(L.negate().sub(pad), pad, g.x.add(0.5)).toVar();
  const t = g.y.mul(2.0).mul(pad).toVar();
  const perp = vec2(dir.y.negate(), dir.x);
  V.vS.assign(s);
  V.vT.assign(t);
  V.vL.assign(L);
  V.vW.assign(w);
  V.vCol.assign(vec4(color, weight));
  V.vLight.assign(min(light, vec3(DUST_LIGHT_CAP)));
  V.vMisc.assign(misc);
  return head.add(dir.mul(s)).add(perp.mul(t));
}

// Jasność drobiny w ruchu: rampa wklęsła (^0,6) od restAlpha do 1 — już wolny lot przy oddalonej kamerze
// (Atlas 500 j/s przy zoomie 0,2 ≈ 100 px/s) wyraźnie rozjaśnia pył; energia częściowo rozłożona na długość.
function motionGain(G1, speedPx, L, w) {
  const gain = mix(G1.y, float(1.0), pow(clamp(speedPx.sub(G1.z).div(G1.w.sub(G1.z)), 1e-6, 1.0), 0.6));
  return gain.div(sqrt(L.div(w.mul(3.0)).mul(0.5).add(1.0)));
}

const twinkleOf = (time, ph) => sin(time.mul(ph.mul(2.3).add(0.9)).add(ph.mul(40.0))).mul(0.16).add(0.84);

/** Graf wierzchołków pyłu kamery z góry (siatki 'ortho' i 'fg'). */
export function createSpaceDustVertex(U, V, grid = null, tune = SPACE_DUST_TUNE) {
  const A0 = attribute('dustA', 'vec4');   // baza x, y [0, 1), ranga, slot
  const A1 = attribute('dustB', 'vec4');   // promień [px], jasność, miękkość, faza
  const band = Math.max(1e-3, Number(tune.rankBand) || 0.15);
  return Fn(() => {
    const G0 = U.element(0);   // pół kadru [px] x, y; czas; migawka
    const G1 = U.element(1);   // smuga max [px]; widoczność w spoczynku; prędkość [px/s] → pełna widoczność
    const G2 = U.element(2);   // kamera − początek siatki świateł (x, y); zoom [px/j]; zysk światła
    const G3 = U.element(3);   // barwa × intensywność; widoczność pyłu
    const G4 = U.element(4);   // liczba stożków dysz
    const si = int(A0.w).mul(DUST_SLOT_VEC4).add(DUST_HEADER_VEC4).toVar();
    const SA = U.element(si).toVar();            // przesunięcie wzoru, kontener [px], waga oktawy
    const SB = U.element(si.add(1)).toVar();     // prędkość [px/s], —, z w siatce świateł
    // Najbliższa kopia drobiny w kontenerze wokół środka kadru.
    const pos = fract(A0.xy.sub(SA.xy).add(0.5)).sub(0.5).mul(SA.z).toVar();
    const fade = clamp(SA.w.mul(1.0 + band).sub(A0.z).div(band), 0.0, 1.0);
    const speed = length(SB.xy).toVar();
    const L = min(speed.mul(G0.w), G1.x).toVar();
    const dir = select(speed.greaterThan(1e-3), SB.xy.div(max(speed, 1e-3)), vec2(1.0, 0.0)).toVar();
    const w = max(A1.x, 0.3).toVar();
    const weight = fade.mul(G3.w).mul(motionGain(G1, speed, L, w)).mul(A1.y).mul(twinkleOf(G0.z, A1.w)).toVar();
    const reach = L.add(w.mul(2.6)).add(1.0);
    const out = vec4(2.0, 2.0, 2.0, 1.0).toVar();   // poza bryłą obcinania (drobina pominięta)
    If(abs(pos.x).lessThan(G0.x.add(reach)).and(abs(pos.y).lessThan(G0.y.add(reach))).and(weight.greaterThan(1e-3)), () => {
      const light = vec3(0.0).toVar();
      // Punkt płaszczyzny pod drobiną (scena względem kamery), z warstwy — głębszy pył dalej od świateł.
      const P = pos.div(G2.z).toVar();
      if (grid) {
        grid.loop(vec3(G2.xy.add(P), SB.w), ({ att, col, scatter }) => {
          light.addAssign(col.mul(att).mul(scatter.mul(0.65).add(0.35)));
        });
        light.mulAssign(G2.w);
      }
      light.addAssign(plumeLight(U, dustPlumeBase(), int(G4.x), P, SB.w));
      const px = writeStreak(V, pos, dir, L, w, weight, G3.xyz, light, A1.zw);
      // Głębia i w z rzutu początku siatki (kamera z góry: zależą tylko od z), xy w pikselach kadru.
      const ref = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(0.0, 0.0, 0.0, 1.0))).toVar();
      out.assign(vec4(px.div(G0.xy).mul(ref.w), ref.z, ref.w));
    });
    return out;
  })();
}

/** Graf wierzchołków pyłu kamer 3D (siatka 'free'). */
export function createSpaceDust3DVertex(U, V, grid = null, tune = SPACE_DUST_TUNE) {
  const A0 = attribute('dustA', 'vec4');   // baza x, y, z [0, 1), ranga
  const A1 = attribute('dustB', 'vec4');   // promień [px], jasność, faza, slot
  const band = Math.max(1e-3, Number(tune.rankBand) || 0.15);
  return Fn(() => {
    const T0 = U.element(0);   // pół kadru [px]; czas; migawka
    const T1 = U.element(1);   // smuga max; widoczność w spoczynku; prędkości [px/s]
    const T2 = U.element(2);   // kamera − początek siatki (x, y, z); zysk światła
    const T3 = U.element(3);   // barwa × intensywność; widoczność
    const T4 = U.element(4);   // prędkość kamery (scena) [j/s]; z kamery
    const T5 = U.element(5);   // stożki dysz; bliska płaszczyzna; najw. promień [px]
    const si = int(A1.w).mul(DUST3D_SLOT_VEC4).add(DUST3D_HEADER_VEC4).toVar();
    const SA = U.element(si).toVar();
    const SB = U.element(si.add(1)).toVar();
    const SC = U.element(si.add(2)).toVar();
    const rel = fract(A0.xyz.sub(SA.xyz).add(0.5)).sub(0.5).mul(SA.w).toVar();
    const dist = length(rel).toVar();
    const fade = clamp(SB.x.mul(1.0 + band).sub(A0.w).div(band), 0.0, 1.0)
      .mul(smoothstep(SB.y, SB.z, dist)).mul(float(1.0).sub(smoothstep(SB.w, SC.x, dist))).toVar();
    // obrót kamery bez przesunięcia (w = 0): położenie względem kamery zostaje małą liczbą
    const vH = cameraViewMatrix.mul(vec4(rel, 0.0)).xyz.toVar();
    const depth = vH.z.negate().toVar();
    const out = vec4(2.0, 2.0, 2.0, 1.0).toVar();
    If(depth.greaterThan(T5.y).and(fade.mul(T3.w).greaterThan(1e-3)), () => {
      const cH = cameraProjectionMatrix.mul(vec4(vH, 1.0)).toVar();
      const head = cH.xy.div(cH.w).mul(T0.xy).toVar();
      // ogon: gdzie drobina była `migawkę` temu względem kamery (kamera jechała z prędkością T4)
      const vT = cameraViewMatrix.mul(vec4(rel.add(T4.xyz.mul(T0.w)), 0.0)).xyz.toVar();
      // ogon za bliską płaszczyzną — przycięty wzdłuż drogi do niej
      const dT = vT.z.negate();
      const k = clamp(depth.sub(T5.y).div(max(depth.sub(dT), 1e-3)), 0.0, 1.0);
      vT.assign(select(dT.lessThan(T5.y), mix(vH, vT, k), vT));
      const cT = cameraProjectionMatrix.mul(vec4(vT, 1.0)).toVar();
      const sv = head.sub(cT.xy.div(cT.w).mul(T0.xy)).toVar();
      const Lraw = length(sv).toVar();
      const L = min(Lraw, T1.x).toVar();
      const dir = select(Lraw.greaterThan(1e-3), sv.div(max(Lraw, 1e-3)), vec2(1.0, 0.0)).toVar();
      // promień rośnie ku kamerze (do sufitu); bliskie drobiny — miękkie
      const w = clamp(A1.x.mul(pow(SC.y.div(depth), 0.7)), 0.45, T5.z).toVar();
      const soft = smoothstep(1.3, T5.z, w);
      const weight = fade.mul(T3.w).mul(motionGain(T1, Lraw.div(max(T0.w, 1e-3)), L, w)).mul(A1.y)
        .mul(twinkleOf(T0.z, A1.z)).mul(mix(float(1.0), float(0.55), soft)).toVar();
      const light = vec3(0.0).toVar();
      if (grid) {
        grid.loop(T2.xyz.add(rel), ({ att, col, scatter }) => {
          light.addAssign(col.mul(att).mul(scatter.mul(0.65).add(0.35)));
        });
        light.mulAssign(T2.w);
      }
      light.addAssign(plumeLight(U, dust3DPlumeBase(), int(T5.x), rel.xy, T4.w.add(rel.z)));
      const px = writeStreak(V, head, dir, L, w, weight, T3.xyz, light, vec2(soft, A1.z));
      out.assign(vec4(px.div(T0.xy), cH.z.div(cH.w), 1.0));
    });
    return out;
  })();
}

/** Wspólny graf fragmentu: kapsuła smugi z profilem Gaussa, głowa jaśniejsza, słońce (maska cienia). */
export function createSpaceDustFragment(V) {
  return Fn(() => {
    const w = max(V.vW, 0.3);
    // Odległość od odcinka [−L, 0] (kapsuła), profil Gaussa; miękkie drobiny — szerszy, płaski.
    const da = max(max(V.vS, V.vL.negate().sub(V.vS)), 0.0);
    const d2 = da.mul(da).add(V.vT.mul(V.vT)).div(w.mul(w));
    const prof = exp(d2.mul(mix(float(-1.6), float(-0.6), V.vMisc.x)));
    // Głowa jaśniejsza od ogona — kierunek ruchu czytelny.
    const taper = mix(float(1.0), float(0.3), clamp(V.vS.negate().div(max(V.vL, 1.0)), 0.0, 1.0));
    const tint = mix(vec3(1.0, 0.95, 0.88), vec3(0.82, 0.9, 1.0), fract(V.vMisc.y.mul(7.31)));
    const col = sunShadeUnlit(V.vCol.xyz.mul(tint)).add(V.vLight).mul(V.vCol.w.mul(prof).mul(taper)).toVar();
    const a = max(max(col.x, col.y), col.z);
    Discard(a.lessThan(0.0015));
    // Mieszanie ONE, ONE (kanwa premultiplied): alfa = max(rgb).
    return vec4(col, a);
  })();
}

/** Graf pyłu z góry (zgodność wstecz: { vertexNode, fragmentNode }). */
export function createSpaceDustNodes(U, grid = null, tune = SPACE_DUST_TUNE) {
  const V = dustVaryings();
  return { vertexNode: createSpaceDustVertex(U, V, grid, tune), fragmentNode: createSpaceDustFragment(V), varyings: V };
}

function createDustMaterial(vertexNode, fragmentNode, cfg, name) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.lights = false;
  m.fog = false;
  m.transparent = true;
  m.depthWrite = false;
  m.depthTest = cfg.depthTest;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  blendAddytywnePremul(m);
  m.vertexNode = vertexNode;
  m.fragmentNode = fragmentNode;
  return m;
}

function createDustGeometry(inst) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0
  ]), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  const buffer = new THREE.InstancedInterleavedBuffer(inst.data, DUST_INSTANCE_STRIDE, 1);
  geometry.setAttribute('dustA', new THREE.InterleavedBufferAttribute(buffer, 4, 0));
  geometry.setAttribute('dustB', new THREE.InterleavedBufferAttribute(buffer, 4, 4));
  geometry.instanceCount = inst.count;
  return geometry;
}

const _view = { camX: 0, camY: 0, zoomPx: 1, halfW: 1, halfH: 1, velX: 0, velY: 0, gridX: 0, gridY: 0, time: 0, vis: 0, plumes: 0 };
const _view3 = { camX: 0, camY: 0, camZ: 0, dist: 1, halfW: 1, halfH: 1, velX: 0, velY: 0, velZ: 0, gridX: 0, gridY: 0, gridZ: 0, time: 0, vis: 0, plumes: 0 };

function copyToArray(node, data) {
  const arr = node.array;
  for (let i = 0; i < arr.length; i++) arr[i].set(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]);
}

export const SpaceDust3D = {
  tune: SPACE_DUST_TUNE,
  meshes: { ortho: null, fg: null, free: null },
  nodes: null,
  uniforms: null,
  uniforms3: null,
  _data: null,
  _data3: null,
  _views: [
    { tracker: new DustViewTracker(), x: 0, y: 0, zoom: 1, active: false },
    { tracker: new DustViewTracker(), x: 0, y: 0, zoom: 1, active: false }
  ],
  _view3: { tracker: new DustViewTracker(), zoom: 1, dist: 8000, active: false },
  _time: 0,
  _enabled: true,
  _hook: null,
  stats: { vis: 0, speed: 0, views: 0, instances: 0, plumes: 0, mode: '' },

  /** Siatki w scenie Core3D, hak passa ortho, rozgrzewka. Po Core3D.init (scena i siatka świateł). */
  init() {
    if (this.meshes.ortho || !Core3D.isInitialized || !Core3D.scene) return !!this.meshes.ortho;
    const grid = Core3D.fx?.grid || null;
    const n = dustUniformCount();
    this.uniforms = uniformArray(Array.from({ length: n }, () => new THREE.Vector4()), 'vec4').setName('spaceDust');
    this._data = new Float32Array(n * 4);
    const n3 = dust3DUniformCount();
    this.uniforms3 = uniformArray(Array.from({ length: n3 }, () => new THREE.Vector4()), 'vec4').setName('spaceDust3d');
    this._data3 = new Float32Array(n3 * 4);
    const V = dustVaryings();
    const fragmentNode = createSpaceDustFragment(V);
    const vertex2D = createSpaceDustVertex(this.uniforms, V, grid, this.tune);
    const vertex3D = createSpaceDust3DVertex(this.uniforms3, V, grid, this.tune);
    this.nodes = { vertexNode: vertex2D, vertex3DNode: vertex3D, fragmentNode, varyings: V };
    this.stats.instances = 0;
    for (const pass of ['ortho', 'fg', 'free']) {
      const cfg = DUST_MESH[pass];
      const inst = pass === 'free' ? buildDust3DInstances(this.tune) : buildDustInstances(this.tune, pass);
      const material = createDustMaterial(pass === 'free' ? vertex3D : vertex2D, fragmentNode, cfg, `spaceDust:${pass}`);
      const mesh = new THREE.Mesh(createDustGeometry(inst), material);
      mesh.name = `SpaceDust:${pass}`;
      mesh.position.set(0, 0, cfg.z);
      mesh.frustumCulled = false;
      mesh.renderOrder = cfg.renderOrder;
      mesh.layers.set(cfg.layer);
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
      Core3D.scene.add(mesh);
      this.meshes[pass] = mesh;
      this.stats.instances += inst.count;
    }
    this._hook = (camera) => this._beforeOrtho(camera);
    Core3D.addPassHook('ortho', this._hook);
    // Pierwsza klatka gry nie kompiluje materiałów pyłu (ortho i FG — dwa pipeline'y na jednym grafie). Siatka
    // kamer 3D — kamerą perspektywy (kamera K w passie ortho to perspektywa ze wspólną głębią).
    Core3D.warmup?.add?.({ name: 'pył kosmiczny', objects: () => [this.meshes.ortho, this.meshes.fg].filter(Boolean) });
    Core3D.warmup?.add?.({ name: 'pył kosmiczny (kamery 3D)', objects: () => this.meshes.free, ortho: false });
    return true;
  },

  /** Przebudowa drobin po zmianie warstw (liczby, rozmiary, jasności) — strojenie na żywo. */
  rebuild() {
    let total = 0;
    for (const pass of ['ortho', 'fg', 'free']) {
      const mesh = this.meshes[pass];
      if (!mesh) continue;
      const inst = pass === 'free' ? buildDust3DInstances(this.tune) : buildDustInstances(this.tune, pass);
      const old = mesh.geometry;
      mesh.geometry = createDustGeometry(inst);
      old.dispose();
      total += inst.count;
    }
    this.stats.instances = total;
  },

  /**
   * Raz na klatkę renderu (index.html, przed drawHexShips3D): kamery gry BEZ wstrząsu (prędkość smug) —
   * gracz 1 i gracz 2 podzielonego ekranu (null bez niego), czas, włącznik z opcji. Kamera 3D (free3d):
   * położenie kamery perspektywy (scena).
   */
  frame(dt, cam1, cam2 = null, enabled = true) {
    this._enabled = enabled !== false && this.tune.enabled !== false;
    const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    this._time += h;
    const W = Math.max(1, Core3D.width || 1920);
    const free = !!(cam1 && cam1.mode === 'free3d' && cam1.position);
    const v3 = this._view3;
    if (free) {
      const p = cam1.position;
      v3.zoom = Number(cam1.zoom) || 1;
      v3.dist = Math.max(100, Number(cam1.viewDistance) || 8000);
      if (!v3.active) v3.tracker.reset();
      v3.active = true;
      v3.tracker.step3(Number(p.x), Number(p.y), Number(p.z), h, this.tune, Math.max(20000, 6 * v3.dist));
    } else if (v3.active) {
      v3.active = false;
      v3.tracker.reset();
    }
    for (let i = 0; i < 2; i++) {
      const v = this._views[i];
      const c = free ? null : (i === 0 ? cam1 : cam2);
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) {
        if (v.active) v.tracker.reset();
        v.active = false;
        continue;
      }
      v.active = true;
      v.x = c.x;
      v.y = c.y;
      v.zoom = Number(c.zoom) || 1;
      v.tracker.step(c.x, c.y, v.zoom, h, this.tune, W);
    }
  },

  _hideAll() {
    for (const pass of ['ortho', 'fg', 'free']) if (this.meshes[pass]) this.meshes[pass].visible = false;
  },

  // Widoczność pyłu dla widoku: opcja, zoom (strategiczny bez pyłu), prędkość kamery (warp), ładowanie skoku.
  _visibility(zoom, speed) {
    if (!this._enabled) return 0;
    const warp = Number(WARP_STARS.stretch.value) || 0;
    return dustVisibility(this.tune, zoom, speed) * (1 - Math.min(1, warp / 0.35));
  },

  // Hak passa ortho (raz na widok): uniformy z kamery TEGO renderu, widoczność siatek.
  _beforeOrtho(camera) {
    if (!this.meshes.ortho) return;
    const target = Core3D.composerTarget;
    this._hideAll();
    this.stats.vis = 0;
    this.stats.plumes = 0;
    this.stats.mode = '';
    if (!this._enabled || !camera || !target) return;
    if (camera.isPerspectiveCamera) {
      if (Core3D.isFreePerspectiveCamera() && this._view3.active) this._beforeFree(camera, target);
      return;
    }
    if (!camera.isOrthographicCamera) return;
    // Widok: kamera gry najbliższa kamerze passa (podzielony ekran — gracz 1 albo 2).
    const cx = camera.position.x;
    const cy = -camera.position.y;
    let best = Infinity;
    let view = null;
    for (const v of this._views) {
      if (!v.active) continue;
      const d = (v.x - cx) * (v.x - cx) + (v.y - cy) * (v.y - cy);
      if (d < best) { best = d; view = v; }
    }
    if (!view) return;
    const vis = this._visibility(view.zoom, view.tracker.speed);
    this.stats.vis = vis;
    if (!(vis > 0.002)) return;
    const grid = Core3D.fx?.grid;
    const zoomPx = target.width / Math.max(1e-6, camera.right - camera.left);
    _view.camX = camera.position.x;
    _view.camY = camera.position.y;
    _view.zoomPx = zoomPx;
    _view.halfW = target.width * 0.5;
    _view.halfH = target.height * 0.5;
    // tracker: świat gry (y w dół) → scena (y w górę)
    _view.velX = view.tracker.vx;
    _view.velY = -view.tracker.vy;
    _view.gridX = grid ? camera.position.x - grid.originX : 0;
    _view.gridY = grid ? camera.position.y - grid.originY : 0;
    _view.time = this._time;
    _view.vis = vis;
    const reach = Math.sqrt(_view.halfW * _view.halfW + _view.halfH * _view.halfH) / Math.max(1e-9, zoomPx);
    _view.plumes = writeDustPlumes(this.tune, EngineFrame, _view.camX, _view.camY, reach, this._data, dustPlumeBase());
    copyToArray(this.uniforms, writeDustUniforms(this.tune, _view, this._data));
    this.meshes.ortho.visible = true;
    if (this.meshes.fg) this.meshes.fg.visible = this.meshes.fg.geometry.instanceCount > 0;
    this.stats.speed = view.tracker.speed;
    this.stats.plumes = _view.plumes;
    this.stats.mode = '2d';
  },

  // Kamery 3D (K): kamera perspektywy passa (wspólna głębia), sześcian drobin wokół niej.
  _beforeFree(camera, target) {
    const v3 = this._view3;
    const vis = this._visibility(v3.zoom, v3.tracker.speed);
    this.stats.vis = vis;
    if (!(vis > 0.002) || !this.meshes.free) return;
    const grid = Core3D.fx?.grid;
    const p = camera.position;
    _view3.camX = p.x;
    _view3.camY = p.y;
    _view3.camZ = p.z;
    _view3.dist = v3.dist;
    _view3.halfW = target.width * 0.5;
    _view3.halfH = target.height * 0.5;
    _view3.velX = v3.tracker.vx;
    _view3.velY = v3.tracker.vy;
    _view3.velZ = v3.tracker.vz;
    _view3.gridX = grid ? p.x - grid.originX : 0;
    _view3.gridY = grid ? p.y - grid.originY : 0;
    _view3.gridZ = p.z;
    _view3.time = this._time;
    _view3.vis = vis;
    _view3.plumes = writeDustPlumes(this.tune, EngineFrame, p.x, p.y, v3.dist * 2.5, this._data3, dust3DPlumeBase());
    copyToArray(this.uniforms3, writeDust3DUniforms(this.tune, _view3, this._data3));
    this.meshes.free.visible = true;
    this.stats.speed = v3.tracker.speed;
    this.stats.plumes = _view3.plumes;
    this.stats.mode = '3d';
  },

  dispose() {
    if (this._hook) Core3D.removePassHook('ortho', this._hook);
    this._hook = null;
    for (const pass of ['ortho', 'fg', 'free']) {
      const mesh = this.meshes[pass];
      if (!mesh) continue;
      mesh.parent?.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      this.meshes[pass] = null;
    }
  }
};

if (typeof window !== 'undefined') {
  window.SpaceDust3D = SpaceDust3D;
  window.SpaceDustTune = SPACE_DUST_TUNE;
}
