// HUTA — fizyczna ruda: PYŁ (kłęby w barwie rudy przy uderzeniach, u wylotu, pod dzwonem, nad zasuwami i u galerii).
//
// Efekt bez masy: zdarzenia pyłu z symulacji (x, y, z, siła, rodzaj) zamieniane na kłęby — miękkie krążki zwrócone do
// kamery, które rosną, zwalniają i gasną. Cała animacja jest funkcją (chwila narodzin, czas symulacji) liczoną
// w shaderze: CPU pisze rekord tylko przy narodzinach (bufor-pierścień, wysyłka zakresu), w pauzie pył stoi.
// Dwie partie: BG (zasiek, wylot, taśma) i FG (ładownia pod dzwonem — nad statkiem). Jasność pod progiem bloomu,
// mieszanie zwykłe (alfa), bez zapisu głębi. Losowość z haszu numeru kłębu (bez Math.random).
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import {
  Fn, If, attribute, cameraProjectionMatrix, clamp, dot, float, length, max, min, mix, modelViewMatrix, sin, smoothstep, sqrt,
  step, uniform, varyingProperty, vec3, vec4
} from 'three/tsl';
import { zbierzZakresy } from '../../../../src/3d/zakresyWysylki.js';
import { PORT_SPACE_LIGHT } from '../../../../src/3d/portBuildings/portBuildings3D.js';
import { EVENT } from './stanowisko.js';

const STRIDE = 12;        // x, y, z, narodziny | vx, vy, vz, życie | rozmiar 0, rozmiar 1, ziarno, krycie
const k7 = (y) => { const d = y.sub(116.0); return max(d, 0.0).mul(0.42).add(min(d, 0.0)); };

function dustMaterial(U) {
  const vUv = varyingProperty('vec2', 'vPyUv');
  const vA = varyingProperty('vec4', 'vPyA');       // krycie, wiek 0…1, ziarno, strefa ładowni (kłąb przy płaskim dnie)
  const vertex = Fn(() => {
    const p = attribute('position', 'vec3');
    const iA = attribute('iA', 'vec4');
    const iB = attribute('iB', 'vec4');
    const iC = attribute('iC', 'vec4');
    const age = float(0.0).toVar();
    age.assign(U.time.x.sub(iA.w));
    const u = float(0.0).toVar();
    u.assign(age.div(max(iB.w, 1e-3)));
    // ruch: rozpęd gaśnie (opór), potem powolne unoszenie
    const k = float(0.0).toVar();
    k.assign(float(1.0).sub(clamp(u, 0.0, 1.0).mul(0.5)));
    const c = vec3(0.0).toVar();
    c.assign(iA.xyz.add(iB.xyz.mul(age.mul(k))).add(vec3(0.0, age.mul(age).mul(U.time.y), 0.0)));
    const size = float(0.0).toVar();
    size.assign(mix(iC.x, iC.y, sqrt(clamp(u, 0.0, 1.0))));
    // ziarno kłębu + 2 = strefa ładowni (wysokość 1:1 nad pokładem, jak ziarna ładowni w `obraz.js`)
    const zone = float(0.0).toVar();
    zone.assign(step(1.5, iC.z));
    const mvC = vec4(0.0).toVar();
    mvC.assign(modelViewMatrix.mul(vec4(c.x, mix(k7(c.y), c.y.sub(116.0), zone), c.z, 1.0)));
    const mv = vec4(0.0).toVar();
    mv.assign(vec4(mvC.xy.add(p.xy.mul(size)), mvC.z, 1.0));
    vUv.assign(p.xy);
    const fade = float(0.0).toVar();
    fade.assign(smoothstep(0.0, 0.12, u).mul(float(1.0).sub(u)).mul(float(1.0).sub(u.mul(0.4))));
    vA.assign(vec4(iC.w.mul(fade), u, iC.z.sub(zone.mul(2.0)), zone));
    const clip = vec4(0.0).toVar();
    clip.assign(cameraProjectionMatrix.mul(mv));
    If(u.lessThan(0.0).or(u.greaterThan(1.0)).or(iB.w.lessThan(1e-3)), () => { clip.assign(vec4(2.0, 2.0, 2.0, 1.0)); });
    return clip;
  })();
  const fragment = Fn(() => {
    const r = float(0.0).toVar();
    r.assign(length(vUv));
    // kłąb: krążek z postrzępionym brzegiem (trzy fale kąta z ziarna kłębu), gęstszy w środku
    const s = vA.z.mul(37.0);
    const wob = sin(vUv.x.mul(5.1).add(s)).mul(sin(vUv.y.mul(4.3).add(s.mul(1.7)))).mul(0.16).add(sin(vUv.x.mul(9.7).sub(vUv.y.mul(8.3)).add(s.mul(0.6))).mul(0.07));
    const d = float(0.0).toVar();
    d.assign(float(1.0).sub(smoothstep(0.25, 1.0, r.add(wob))));
    const a = float(0.0).toVar();
    // kłąb nad płaskim dnem ładowni: dolna połowa krążka gaśnie — dno nie przecina go twardą poziomą krawędzią
    a.assign(d.mul(d).mul(vA.x).mul(mix(float(1.0), smoothstep(-0.7, 0.2, vUv.y), vA.w)));
    // światło: słońce z boku rozjaśnia jedną stronę kłębu, środek ciemniejszy
    const side = float(0.0).toVar();
    side.assign(dot(vUv, U.sunScreen.xy).mul(0.22).add(0.86));
    const col = vec3(0.0).toVar();
    col.assign(U.color.mul(U.sunColor.mul(0.6).add(U.ambient)).mul(side).mul(mix(float(0.8), float(1.0), r)));
    col.assign(min(col, vec3(0.8)));
    return vec4(col, clamp(a, 0.0, 1.0));
  })();
  const m = new NodeMaterial();
  m.name = 'RudaPyl';
  m.vertexNode = vertex;
  m.fragmentNode = fragment;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  m.forceSinglePass = true;
  m.fog = false;
  m.lights = false;
  m.toneMapped = false;
  return m;
}

const hash01 = (n) => {
  let t = (n + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export class RudaPyl {
  /** @param {object} o  bgGroup, fgGroup — grupy w układzie „hub”; cap — kłębów na partię */
  constructor({ bgGroup, fgGroup, cap = 384 }) {
    this.cap = cap;
    this.U = {
      time: uniform(new THREE.Vector4(0, 4, 0, 0)),               // czas symulacji, unoszenie [j./s²]
      color: uniform(new THREE.Vector3(0.5, 0.3, 0.2)),
      sunColor: uniform(new THREE.Vector3(...PORT_SPACE_LIGHT.sunColor)),
      ambient: uniform(new THREE.Vector3(0.16, 0.17, 0.19)),
      sunScreen: uniform(new THREE.Vector4(-0.7, 0.7, 0, 0))      // kierunek ku słońcu na ekranie (x, y)
    };
    this.material = dustMaterial(this.U);
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0]);
    this.sets = {};
    for (const [key, group] of [['bg', bgGroup], ['fg', fgGroup]]) {
      const data = new Float32Array(cap * STRIDE);
      const buf = new THREE.InstancedInterleavedBuffer(data, STRIDE);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(quad, 3));
      g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 0));
      g.setAttribute('iB', new THREE.InterleavedBufferAttribute(buf, 4, 4));
      g.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
      g.instanceCount = cap;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.name = `Ruda_pyl_${key}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 30;
      group.add(mesh);
      this.sets[key] = { data, buf, mesh, head: 0 };
    }
    this.serial = 1;
    this.amount = 0.6;
    this.spawned = 0;
    this.budget = 0;
    this.setLayers(1, 2);
  }

  setLayers(bg, fg) {
    this.sets.bg.mesh.layers.set(bg);
    this.sets.fg.mesh.layers.set(fg);
  }

  warmupMeshes() { return [this.sets.bg.mesh, this.sets.fg.mesh]; }

  /** Barwa i ilość pyłu rudy. */
  setOre(ore) {
    this.U.color.value.set(...ore.dustColor);
    this.amount = ore.dust;
  }

  reset() {
    for (const s of Object.values(this.sets)) { s.data.fill(0); s.head = 0; zbierzZakresy(s.buf, 0, s.data.length); }
  }

  _put(key, x, y, z, t, vx, vy, vz, life, s0, s1, alpha) {
    const S = this.sets[key];
    const o = S.head * STRIDE;
    const d = S.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t;
    d[o + 4] = vx; d[o + 5] = vy; d[o + 6] = vz; d[o + 7] = life;
    d[o + 8] = s0; d[o + 9] = s1; d[o + 10] = hash01(this.serial * 31 + 7) * 0.999 + (key === 'fg' ? 2 : 0); d[o + 11] = alpha;
    zbierzZakresy(S.buf, o, STRIDE);
    S.head = (S.head + 1) % this.cap;
    this.spawned++;
  }

  /**
   * Zdarzenia pyłu z migawki (`n` rekordów 5 × f32) w chwili `t` symulacji; `jet` — oś strugi u wylotu (x, y, z),
   * `stepSim` — długość kroku symulacji [s] (budżet kłębów rośnie z czasem, nie z liczbą migawek).
   */
  spawn(events, n, t, jet, stepSim) {
    const A = this.amount;
    // uderzenia: z setek zdarzeń na krok wybierane najsilniejsze w ramach budżetu ~70 kłębów na sekundę
    this.budget = Math.min(6, this.budget + stepSim * 70 * (0.35 + 0.65 * A));
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const x = events[o];
      const y = events[o + 1];
      const z = events[o + 2];
      const f = events[o + 3];
      const kind = events[o + 4];
      const id = this.serial++;
      const h1 = hash01(id * 3 + 1);
      const h2 = hash01(id * 3 + 2);
      const h3 = hash01(id * 3 + 3);
      const ang = h1 * 6.2831853;
      if (kind === EVENT.IMPACT || kind === EVENT.HOLD) {
        if (this.budget < 1 || h2 > f * 2.2 + 0.08) continue;
        this.budget -= 1;
        const sp = 14 + 46 * f;
        this._put(kind === EVENT.HOLD ? 'fg' : 'bg', x, y + 3, z, t, Math.cos(ang) * sp, 10 + 34 * f + 14 * h3, Math.sin(ang) * sp,
          1.0 + 1.1 * h3, 6 + 8 * f, 20 + 34 * f + 14 * h1, (0.1 + 0.2 * f) * (0.45 + 0.55 * A));
      } else if (kind === EVENT.SPOUT) {
        // u wylotu: smuga niesiona strugą
        const jx = jet ? jet[0] : 0;
        const jy = jet ? jet[1] : 0;
        const jz = jet ? jet[2] : -1;
        // kłąb rodzi się u UJŚCIA strugi (koniec dyszy z klapą, ok. 64 j. od osi wylotu wzdłuż strugi), nie nad bębnem
        const sp = 110 + 60 * h2;
        this._put('bg', x + jx * 64, y + jy * 64 - 6, z + jz * 64, t, jx * sp + Math.cos(ang) * 10, jy * sp + 2, jz * sp + Math.sin(ang) * 10,
          0.8 + 0.5 * h3, 10, 30 + 14 * h1, 0.11 * (0.4 + 0.6 * A));
      } else if (kind === EVENT.BELL) {
        // przy krawędzi dzwonu: pierścień pyłu wzbijanego prądem przy powierzchni — kłąb rodzi się tuż poza obręczą,
        // wiruje wokół osi i jest wciągany pod krawędź (strefa ładowni — wysokość 1:1 względem pokładu)
        const br = 36 + 16 * h2;
        this._put('fg', x + Math.cos(ang) * br, y - 4, z + Math.sin(ang) * br, t, -Math.cos(ang) * 30 - Math.sin(ang) * 26, 5 + 9 * h3, -Math.sin(ang) * 30 + Math.cos(ang) * 26,
          0.7 + 0.5 * h3, 11, 30 + 14 * h1, 0.3 * (0.45 + 0.55 * A));
      } else if (kind === EVENT.GATE) {
        this._put('bg', x + (h1 - 0.5) * 40, y + 6, z + (h2 - 0.5) * 40, t, (h1 - 0.5) * 20, 16 + 12 * h3, (h2 - 0.5) * 20,
          1.6 + 0.8 * h3, 14, 60 + 30 * h1, 0.13 * (0.4 + 0.6 * A));
      } else if (kind === EVENT.FURNACE) {
        // przesyp do kosza pieca: kłąb wypływa spod okapu od strony taśmy — nisko (okap ma spód 40 j. nad taśmą),
        // krótko i prawie poziomo, żeby nie wychodził ponad dach okapu
        if (h2 > 0.35) continue;
        this._put('bg', x + (h1 - 0.5) * 30, y - 6, z + 46, t, (h1 - 0.5) * 14, 1 + 3 * h3, 26 + 22 * h2,
          0.8 + 0.4 * h3, 10, 24 + 10 * h1, 0.14 * (0.4 + 0.6 * A));
      }
    }
  }

  /** Czas symulacji klatki i kierunek ku słońcu na ekranie (jednostkowy, x w prawo, y w górę). */
  frame(time, sunX = -0.7, sunY = 0.7) {
    this.U.time.value.x = time;
    this.U.sunScreen.value.set(sunX, sunY, 0, 0);
  }
}
