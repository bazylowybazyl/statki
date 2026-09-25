// src/3d/slugTrail3D.js
//
// Smuga świata dla pocisków kinetycznych — port WorldTrail z dema railguna.
// Wydzielona z `railgunFx3D.js`, bo mają ją teraz dwaj odbiorcy:
//   * Hexlance (superbroń, prowadzi pocisk sama w `superweapon.js`),
//   * pociski z ogólnego potoku (`BulletTrails` niżej, np. Yamato).
//
// Każda instancja to JEDEN draw call i JEDEN komplet uniformów, czyli jeden
// wygląd. Dwóch różnie wyglądających smug nie da się zrobić na jednej
// instancji — stąd osobna dla Hexlance'a i osobna dla pocisków.

import * as THREE from 'three';
import { Core3D } from './core3d.js';
import { Fx3D, FX_PLANE_Z, FX_RENDER_ORDER } from './fxParticles3D.js';
import { sceneOriginNearCamera } from './sceneOrigin.js';

/* ============================================================================
   SMUGA POCISKU — port WorldTrail z „capital_engine_vfx_v3".
   Segmenty żyją w przestrzeni świata, bufor jest zapisywany TYLKO przy emisji
   i wygaszeniu, a GPU liczy dryf, rozszerzanie, meandry, włókna i zanik.
   Jeden draw call na wszystkie pociski w locie.

   Pod pocisk kinetyczny:
    1. Próbkowanie po PRZEBYTEJ DRODZE z interpolacją wewnątrz klatki, nie po
       czasie. Przy 12000 j/s próbki co 1/60 s leżałyby co 200 jednostek.
    2. Wzór wzdłuż smugi (szum, włókna, meandry) liczony od drogi, nie od czasu
       narodzin — inaczej włókna rozciągnęłyby się w proste kreski.
    3. Najmłodsza część smugi jest NAJJAŚNIEJSZA, z rozżarzonym rdzeniem.
    4. Wiele emiterów: każdy pocisk w locie dostaje własny slot żywej głowy.
   ========================================================================== */
export const TRAIL_PATH_UNIT = 220;   // ile jednostek drogi przypada na „sekundę" wzoru wzdłuż smugi
const TRAIL_BASE_WIDTH = 30;   // szerokość bazowa, przed przewężeniem i rozszerzaniem z wiekiem
const TRAIL_DRIFT = 30;        // gaz w śladzie prawie stoi — lekko cofa się za pociskiem

const TRAIL_NOISE_GLSL = /* glsl */`
float hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1,1)),f.x),f.y);}
float cloud(vec2 p){
 #if QUALITY_NOISE == 0
 return .5+.25*sin(p.x*2.1+p.y*3.7);
 #elif QUALITY_NOISE == 1
 return noise2(p);
 #else
 return .68*noise2(p)+.32*noise2(p*2.07+17.3);
 #endif
}
`;

// aS*.xyz to wektor boczny LEŻĄCY W PŁASZCZYŹNIE GRY (XY). Styczna smugi to
// obrócony o 90° ten sam wektor — w demie (płaszczyzna XZ) było to
// vec3(s.z, 0, -s.x), tutaj vec3(-s.y, s.x, 0).
const TRAIL_VERTEX = /* glsl */`
attribute vec4 aA,aB,aVA,aVB,aSA,aSB;
attribute vec2 aMeta,aPath;
uniform float uTime,uLife,uTurbulence;
varying vec2 vUv;
varying float vAge,vEnergy,vSeed,vBirth,vPath;
vec3 endpoint(vec4 origin,vec4 velocity,vec4 sideWidth,float path){
 float age=max(0.,uTime-origin.w);
 float drift=min(age,.35)+max(age-.35,0.)*.26;
 vec3 p=origin.xyz+velocity.xyz*drift;
 float develop=smoothstep(.15,2.8,age);
 float wobble=(sin(path*2.7+aMeta.x+age*.75)*.68+sin(path*6.1-aMeta.x-age*.9)*.28);
 p+=sideWidth.xyz*wobble*sideWidth.w*uTurbulence*develop*.46;
 p.z+=sin(path*3.8+aMeta.x+age*.6)*sideWidth.w*uTurbulence*develop*.24;
 vec3 tangent=vec3(-sideWidth.y,sideWidth.x,0.);
 // p jest wzgledem mesh.position (poczatek smugi): kamera tez, roznica duzych liczb najpierw
 vec3 faceSide=normalize(cross(tangent,normalize((cameraPosition-modelMatrix[3].xyz)-p))+vec3(.000001));
 if(dot(faceSide,sideWidth.xyz)<0.)faceSide=-faceSide;
 float neck=mix(.30,1.,smoothstep(0.,.62,age));
 float width=sideWidth.w*neck*(1.+min(age*.16,2.1));
 return p+faceSide*position.y*width;
}
void main(){
 if(aMeta.y<0.){vUv=uv;vAge=0.;vEnergy=0.;vSeed=0.;vBirth=0.;vPath=0.;gl_Position=vec4(2.,2.,2.,1.);return;}
 float t=uv.x;
 vec3 p=mix(endpoint(aA,aVA,aSA,aPath.x),endpoint(aB,aVB,aSB,aPath.y),t);
 vUv=uv;vBirth=mix(aA.w,aB.w,t);vAge=max(0.,uTime-vBirth);
 vEnergy=mix(aVA.w,aVB.w,t);vSeed=aMeta.x;vPath=mix(aPath.x,aPath.y,t);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;

// Kamera dalej niż tyle od początku żywej smugi (j. sceny) przesuwa początek
// razem z danymi — float32 przy 100 tys. j. ma krok ~0,008 j.
const TRAIL_REBASE_DIST = 100000;
const _camOrigin = { x: 0, y: 0 };

const TRAIL_FRAGMENT = /* glsl */`
uniform float uTime,uLife,uOpacity,uTurbulence,uHotAmt;
uniform vec3 uTrailYoung,uTrailOld,uTrailAccent,uTrailHot;
varying vec2 vUv;
varying float vAge,vEnergy,vSeed,vBirth,vPath;
${TRAIL_NOISE_GLSL}
void main(){
 float y=vUv.y*2.-1.,age=vAge;
 float normalizedAge=clamp(age/uLife,0.,1.);
 float fade=pow(1.-normalizedAge,1.3)*(1.-smoothstep(.75,1.,normalizedAge));
 // pocisk: najmłodszy fragment najjaśniejszy (w silniku był przygaszony)
 fade*=(1.+uHotAmt*exp(-age*5.))*uOpacity*pow(vEnergy,.75);
 float n=cloud(vec2(vPath*3.2-uTime*.48,y*2.8+vSeed));
 float w=y+(n-.5)*.16*uTurbulence*smoothstep(.1,1.5,age);
 float diffuse=exp(-w*w*5.5);
 float filament=exp(-pow((w-sin(vPath*7.5-uTime*.9+vSeed)*.17*uTurbulence)*10.,2.));
 float filament2=exp(-pow((w+.25-sin(vPath*5.-uTime*.65+vSeed)*.12*uTurbulence)*15.,2.));
 float center=exp(-w*w*40.)*exp(-age*.13);
 float pulse=.94+.06*sin(vPath*15.+vSeed-uTime*1.2);
 vec3 color=mix(uTrailYoung,uTrailOld,smoothstep(.12,.95,normalizedAge));
 color*=diffuse*(.65+.35*n);
 color+=uTrailAccent*(filament*.24+filament2*.13+center*.28)*exp(-age*.065);
 // rozżarzony rdzeń tuż za pociskiem
 color+=uTrailHot*exp(-w*w*70.)*exp(-age*7.);
 color*=fade*pulse*(1.-smoothstep(.68,1.,abs(y)));
 gl_FragColor=vec4(color,1.);
}`;

function makeTrailStrip() {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 0, 1, 1], 2));
  geo.setIndex([0, 2, 1, 2, 3, 1]);
  return geo;
}

// Gęsta pula GPU + wygaszanie FIFO. Zamiana z ostatnim żywym segmentem,
// kolejka chronologiczna na stałych ID, niezależnych od kolejności slotów.
export class SlugTrail {
  constructor(scene, cfg, capacity = 4096, heads = 6, scale = 1, name = 'SLUG_TRAILS') {
    this.cfg = cfg;
    this.S = scale;                     // skala świata właściciela
    this.capacity = capacity;
    this.stride = 28;                   // [A 12][B 12][seed, emiter][drogaA, drogaB]
    this.headCount = heads;
    this.totalSlots = capacity + heads;
    this.headValid = new Uint8Array(heads);
    this.data = new Float32Array(this.totalSlots * this.stride);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, this.stride, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    this.geometry = makeTrailStrip();
    this.geometry.instanceCount = 0;
    const fields = [['aA', 4, 0], ['aVA', 4, 4], ['aSA', 4, 8], ['aB', 4, 12], ['aVB', 4, 16], ['aSB', 4, 20], ['aMeta', 2, 24], ['aPath', 2, 26]];
    for (const [name, size, offset] of fields) {
      this.geometry.setAttribute(name, new THREE.InterleavedBufferAttribute(this.buffer, size, offset));
    }
    this.uniforms = {
      uTime: { value: 0 }, uLife: { value: cfg.trailLife }, uTurbulence: { value: cfg.turbulence },
      uOpacity: { value: cfg.trailOpacity }, uHotAmt: { value: 1.2 },
      uTrailYoung: { value: new THREE.Color().setRGB(0.22, 0.62, 1.25) },
      uTrailOld: { value: new THREE.Color().setRGB(0.07, 0.035, 0.30) },
      uTrailAccent: { value: new THREE.Color().setRGB(0.55, 1.05, 1.70) },
      uTrailHot: { value: new THREE.Color().setRGB(1.10, 1.50, 2.00) }
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERTEX, fragmentShader: TRAIL_FRAGMENT, uniforms: this.uniforms,
      defines: { QUALITY_NOISE: 2 }, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = FX_RENDER_ORDER.trail;
    this.mesh.name = `${name}__WORLD_SPACE`;
    scene.add(this.mesh);

    this.previous = Array.from({ length: heads }, () => new Float32Array(13));
    this.previousValid = new Uint8Array(heads);
    this.em = Array.from({ length: heads }, () => ({ busy: false, acc: 0, path: 0, spacing: 40, seed: 0 }));
    this.idToSlot = new Int32Array(capacity);
    this.slotToId = new Int32Array(capacity);
    this.queueTimes = new Float64Array(capacity);
    this.dirtyFlags = new Uint8Array(this.totalSlots);
    this.dirtySlots = new Uint32Array(this.totalSlots);
    this.dirtyCount = 0;
    this.active = 0; this.head = 0; this.tail = 0;
    this.node = new Float32Array(13);
    this._p = new THREE.Vector3();
    // Początek układu danych (scena: x, −y świata). Świat leży przy 5–10 mln j.,
    // gdzie float32 ma krok 0,5 j.: bezwzględne węzły drgały na GPU ~1 px ×
    // zoom, a dryf i meandry gazu szły skokami. Węzły są względem początku
    // przy kamerze (sceneOrigin.js), duży kawałek niesie mesh.position
    // (modelViewMatrix w double). Początek jest „lepki”: pusta smuga idzie za
    // kamerą, żywa trzyma go, aż kamera odjedzie o TRAIL_REBASE_DIST (_rebase),
    // więc zapisanych segmentów zwykle nie trzeba przepisywać.
    this.originX = 0;
    this.originY = 0;
    this.clear();
  }

  _live() {
    if (this.active > 0) return true;
    for (let e = 0; e < this.headCount; e++) if (this.previousValid[e] || this.headValid[e]) return true;
    return false;
  }
  _setOrigin(x, y) {
    this.originX = x;
    this.originY = y;
    this.mesh.position.set(x, y, 0);
  }
  // Wołane przed zapisem nowego pocisku (begin) i raz na klatkę (prepare).
  _syncOrigin() {
    const o = sceneOriginNearCamera(_camOrigin);
    if (!this._live()) {
      if (o.x !== this.originX || o.y !== this.originY) this._setOrigin(o.x, o.y);
    } else if (Math.abs(o.x - this.originX) > TRAIL_REBASE_DIST || Math.abs(o.y - this.originY) > TRAIL_REBASE_DIST) {
      this._rebase(o.x, o.y);
    }
  }
  // Przesuwa początek razem z żywymi danymi: pozycje A/B wszystkich slotów
  // (głowy + historia) i ostatnie węzły emiterów. Rzadkie (kamera odjechała
  // przy żywej smudze), więc pełny zapis bufora nie boli.
  _rebase(x, y) {
    const dx = this.originX - x;
    const dy = this.originY - y;
    const st = this.stride;
    const d = this.data;
    const n = this.headCount + this.active;
    for (let s = 0; s < n; s++) {
      const b = s * st;
      d[b] += dx; d[b + 1] += dy;
      d[b + 12] += dx; d[b + 13] += dy;
      this.mark(s);
    }
    for (let e = 0; e < this.headCount; e++) {
      if (!this.previousValid[e]) continue;
      const p = this.previous[e];
      p[0] += dx; p[1] += dy;
    }
    this._setOrigin(x, y);
  }

  mark(slot) { if (!this.dirtyFlags[slot]) { this.dirtyFlags[slot] = 1; this.dirtySlots[this.dirtyCount++] = slot; } }

  retire() {
    if (!this.active) return;
    const id = this.head;
    const slot = this.idToSlot[id];
    const last = this.active - 1;
    const hc = this.headCount;
    const st = this.stride;
    if (slot !== last) {
      this.data.copyWithin((slot + hc) * st, (last + hc) * st, (last + hc + 1) * st);
      const moved = this.slotToId[last];
      this.slotToId[slot] = moved; this.idToSlot[moved] = slot;
      this.mark(slot + hc);
    }
    this.head = (this.head + 1) % this.capacity;
    this.active--;
  }
  expire(time) {
    const life = this.cfg.trailLife + 0.1;
    while (this.active && time - this.queueTimes[this.head] > life) this.retire();
  }

  // węzeł: [pozycja, narodziny][prędkość dryfu, energia][bok, szerokość][droga]
  // `dir` jest już w przestrzeni sceny (XY w płaszczyźnie gry, Z ku kamerze).
  makeNode(out, pos, time, dir, path) {
    const S = this.S;
    // Względem początku smugi (małe liczby dla float32).
    out[0] = pos.x - this.originX; out[1] = pos.y - this.originY; out[2] = pos.z; out[3] = time;
    out[4] = -dir.x * TRAIL_DRIFT * S; out[5] = -dir.y * TRAIL_DRIFT * S; out[6] = -dir.z * TRAIL_DRIFT * S; out[7] = 1;
    // bok = kierunek obrócony o -90° w płaszczyźnie gry
    let sx = dir.y;
    let sy = -dir.x;
    const sl = Math.hypot(sx, sy);
    if (sl < 1e-6) { sx = 1; sy = 0; } else { sx /= sl; sy /= sl; }
    out[8] = sx; out[9] = sy; out[10] = 0;
    out[11] = TRAIL_BASE_WIDTH * this.cfg.trailWidth * S;
    out[12] = path / (TRAIL_PATH_UNIT * S);
    return out;
  }

  acquire() {
    for (let e = 0; e < this.headCount; e++) if (!this.em[e].busy) return e;
    return -1;                          // wszystkie sloty zajęte: pocisk poleci bez smugi
  }
  begin(e, pos, time, dir, speed) {
    this._syncOrigin();
    const m = this.em[e];
    m.busy = true; m.acc = 0;
    m.path = Math.random() * 40 * TRAIL_PATH_UNIT;   // każdy ślad ma inny wzór
    m.seed = Math.random() * 100;
    m.spacing = Math.max(40 * this.S, speed / 160);  // najwyżej ~160 próbek/s
    this.makeNode(this.previous[e], pos, time, dir, m.path);
    this.previousValid[e] = 1;
  }
  emit(e, node) {
    const prev = this.previous[e];
    if (this.previousValid[e]) {
      if (this.active === this.capacity) this.retire();
      const slot = this.active++;
      const id = this.tail;
      const base = (slot + this.headCount) * this.stride;
      this.data.set(prev.subarray(0, 12), base);
      this.data.set(node.subarray(0, 12), base + 12);
      this.data[base + 24] = this.em[e].seed; this.data[base + 25] = e;
      this.data[base + 26] = prev[12]; this.data[base + 27] = node[12];
      this.slotToId[slot] = id; this.idToSlot[id] = slot; this.queueTimes[id] = node[3];
      this.tail = (this.tail + 1) % this.capacity;
      this.mark(slot + this.headCount);
    }
    prev.set(node);
    this.previousValid[e] = 1;
  }
  hideHead(e) {
    if (this.headValid[e]) { this.headValid[e] = 0; this.data[e * this.stride + 25] = -1; this.mark(e); }
  }
  updateHead(e, node) {
    // Tylko głowa idzie za pociskiem. Historia zostaje nietknięta.
    if (!this.previousValid[e]) { this.hideHead(e); return; }
    const prev = this.previous[e];
    const base = e * this.stride;
    this.data.set(prev.subarray(0, 12), base);
    this.data.set(node.subarray(0, 12), base + 12);
    this.data[base + 24] = this.em[e].seed; this.data[base + 25] = e;
    this.data[base + 26] = prev[12]; this.data[base + 27] = node[12];
    this.headValid[e] = 1;
    this.mark(e);
  }

  // przesuwa emiter po odcinku from->to; próbki co `spacing` jednostek drogi
  advance(e, from, to, t0, t1, dir) {
    const m = this.em[e];
    const seg = from.distanceTo(to);
    if (seg > 1e-6) {
      let d = m.spacing - m.acc;
      while (d <= seg) {
        const f = d / seg;
        this._p.lerpVectors(from, to, f);
        this.emit(e, this.makeNode(this.node, this._p, t0 + (t1 - t0) * f, dir, m.path + d));
        d += m.spacing;
      }
      m.acc = seg - (d - m.spacing);
      m.path += seg;
    }
    this.updateHead(e, this.makeNode(this.node, to, t1, dir, m.path));
  }
  // domyka ślad dokładnie w punkcie końcowym (np. trafienia) i zwalnia emiter
  end(e, pos, time, dir) {
    const m = this.em[e];
    if (this.previousValid[e] && m.acc > 1e-3) this.emit(e, this.makeNode(this.node, pos, time, dir, m.path));
    this.previousValid[e] = 0;
    this.hideHead(e);
    m.busy = false;
  }

  prepare(time) {
    this._syncOrigin();
    const u = this.uniforms;
    const c = this.cfg;
    u.uTime.value = time; u.uLife.value = c.trailLife; u.uOpacity.value = c.trailOpacity;
    u.uTurbulence.value = c.turbulence;
    let heads = 0;
    for (let e = 0; e < this.headCount; e++) heads += this.headValid[e];
    this.geometry.instanceCount = this.active + this.headCount;
    this.mesh.visible = c.trailOpacity > 0 && (this.active > 0 || heads > 0);
    // zaległe zapisy trzymamy do momentu, aż siatka będzie widoczna
    if (this.dirtyCount && this.mesh.visible) {
      const idx = this.dirtySlots.subarray(0, this.dirtyCount);
      idx.sort();
      this.buffer.clearUpdateRanges();
      let start = idx[0];
      let end = start;
      for (let i = 0; i < this.dirtyCount; i++) {
        const slot = idx[i];
        this.dirtyFlags[slot] = 0;
        if (slot > end + 1) { this.buffer.addUpdateRange(start * this.stride, (end - start + 1) * this.stride); start = slot; }
        end = slot;
      }
      this.buffer.addUpdateRange(start * this.stride, (end - start + 1) * this.stride);
      this.buffer.needsUpdate = true;
      this.dirtyCount = 0;
    }
  }
  clear() {
    this.active = 0; this.head = 0; this.tail = 0;
    this.previousValid.fill(0); this.headValid.fill(0);
    this.dirtyFlags.fill(0); this.dirtyCount = 0;
    this.geometry.instanceCount = 0;
    this.buffer.clearUpdateRanges();
    for (const m of this.em) m.busy = false;
    for (let i = 0; i < this.headCount; i++) { this.data[i * this.stride + 25] = -1; this.mark(i); }
  }
  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}


/* ============================================================================
   SMUGI POCISKÓW Z OGÓLNEGO POTOKU
   Hexlance prowadzi swój pocisk sam i sam woła trail. Zwykłe pociski żyją
   w tablicy `bullets` i przechodzą raz na klatkę przez
   `Weapon3DSystem.syncProjectiles` — stamtąd jest jedno miejsce, w którym
   znany jest i styl pocisku, i jego pozycja. Ten manager wpina się w tamtą
   pętlę: `beginFrame()` → `track()` na każdy pocisk → `endFrame()`.

   Dlaczego własne `lastX/lastY`, a nie `bullet.px/py`: fizyka chodzi
   podkrokami (PHYS_DT), a `px/py` to poprzedni KROK FIZYKI, nie poprzednia
   klatka renderu. Próbkowanie po `px` gubiłoby połowę toru przy 120 Hz.
   ========================================================================== */

// Które style pocisków (klucz z `resolveBulletVisualStyle`) dostają smugę.
// Dopisanie kolejnej broni to jedna linia — ale wygląd jest wspólny, bo to
// jedna instancja `SlugTrail`.
export const BULLET_TRAIL_KEYS = new Set(['yamato']);

// Delikatniejsza wersja smugi Hexlance'a: węższa, krócej wisi, mniej
// meandruje i ma spokojniejszy rdzeń. Barwy zjechane w cyjan (`vfxColor`
// Yamato to #00ffff), żeby smuga trzymała się barwy pocisku i błysku.
export const BULLET_TRAIL_CONFIG = {
  // DŁUGOŚĆ SMUGI = trailLife × prędkość pocisku, więc to jest TEN suwak.
  // Yamato leci 9000 j./s: 0,30 s daje ~2700 jednostek, czyli półtorej
  // długości Atlasa (1800). Do tego smuga gaśnie przez całe życie, więc
  // jasna jest mniej więcej pierwsza połowa — na ekranie czyta się jako
  // ogon za pociskiem, nie jako kreska przez pół mapy.
  // Poprzednio było 1,4 s = 12 600 jednostek, czyli siedem długości kadłuba.
  trailLife: 0.30,       // Hexlance: 3.5
  trailOpacity: 0.55,    // Hexlance: 1.0
  trailWidth: 1.0,
  turbulence: 0.28       // Hexlance: 0.45
};

// Skala smugi. Hexlance leci na 3.0 (szerokość bazowa 30 × 3 = 90 jednostek
// półszerokości). Pocisk wieżyczkowy ma być kreską, nie pasem: 0.9 → 27.
const BULLET_TRAIL_SCALE = 0.9;
const BULLET_TRAIL_HOT = 0.7;   // Hexlance: 1.2 — mniej przepalony łeb

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();

const live = new Map();          // bullet -> { emitter, lastX, lastY, seen }

export const BulletTrails = {
  enabled: true,
  cfg: BULLET_TRAIL_CONFIG,
  _trail: null,
  _prepared: false,

  get available() {
    return this.enabled === true && Core3D.isInitialized === true && !!Core3D.scene;
  },

  _ensure() {
    if (this._trail) return this._trail;
    // Zegar smugi to `Fx3D.time`, a ten stoi, dopóki bank nie powstanie
    // (`Fx3D.update` wychodzi na pustych pulach). Smuga z zamrożonym zegarem
    // nigdy by nie zgasła, więc bank musi ruszyć PRZED nią.
    if (!this.available || !Fx3D.ensure()) return null;
    this._trail = new SlugTrail(Core3D.scene, this.cfg, 1024, 6, BULLET_TRAIL_SCALE, 'BULLET_SLUG_TRAILS');
    const u = this._trail.uniforms;
    u.uHotAmt.value = BULLET_TRAIL_HOT;
    u.uTrailYoung.value.setRGB(0.30, 0.95, 1.15);
    u.uTrailOld.value.setRGB(0.05, 0.10, 0.22);
    u.uTrailAccent.value.setRGB(0.55, 1.40, 1.60);
    u.uTrailHot.value.setRGB(0.85, 1.55, 1.75);
    return this._trail;
  },

  beginFrame() {
    if (!live.size) return;
    for (const state of live.values()) state.seen = false;
  },

  /**
   * Jeden pocisk w tej klatce. `styleKey` pochodzi z `resolveBulletVisualStyle`.
   * Wołane Z PĘTLI renderu pocisków, czyli JUŻ PO `Fx3D.update()` — okno czasu
   * tej klatki to [time - lastDt, time], odwrotnie niż u Hexlance'a, który
   * emituje jeszcze w fazie update gry.
   */
  track(bullet, styleKey, x, y, vx, vy) {
    if (!BULLET_TRAIL_KEYS.has(styleKey)) return;
    const trail = this._ensure();
    if (!trail) return;

    const t1 = Fx3D.time;
    const t0 = t1 - Fx3D.lastDt;
    const len = Math.hypot(vx, vy) || 1;
    _dir.set(vx / len, -vy / len, 0);

    let state = live.get(bullet);
    if (!state) {
      // Start od poprzedniego kroku fizyki, jeśli jest — bliżej wylotu lufy
      // niż bieżąca pozycja, więc dziura pod błyskiem jest mniejsza.
      const sx = Number.isFinite(bullet.px) ? Number(bullet.px) : x;
      const sy = Number.isFinite(bullet.py) ? Number(bullet.py) : y;
      const emitter = trail.acquire();
      if (emitter >= 0) {
        _from.set(sx, -sy, FX_PLANE_Z);
        trail.begin(emitter, _from, t0, _dir, len);
      }
      state = { emitter, lastX: sx, lastY: sy, dirX: vx / len, dirY: vy / len, seen: true };
      live.set(bullet, state);
    }
    state.seen = true;

    if (state.emitter >= 0) {
      _from.set(state.lastX, -state.lastY, FX_PLANE_Z);
      _to.set(x, -y, FX_PLANE_Z);
      trail.advance(state.emitter, _from, _to, t0, t1, _dir);
    }
    state.lastX = x;
    state.lastY = y;
    state.dirX = vx / len;
    state.dirY = vy / len;
  },

  /** Zwalnia emitery pocisków, których w tej klatce już nie było, i wysyła bufor. */
  endFrame() {
    const trail = this._trail;
    if (!trail) return;
    if (live.size) {
      for (const [bullet, state] of live) {
        if (state.seen) continue;
        if (state.emitter >= 0) {
          // Kierunek z OSTATNIEJ klatki, nie zastępczy: `end()` dokłada jeszcze
          // jeden węzeł, a jego wektor boczny liczy się właśnie z kierunku —
          // podstawiony na sztywno skręcałby ostatni segment smugi.
          _to.set(state.lastX, -state.lastY, FX_PLANE_Z);
          _dir.set(state.dirX, -state.dirY, 0);
          trail.end(state.emitter, _to, Fx3D.time, _dir);
        }
        live.delete(bullet);
      }
    }
    trail.expire(Fx3D.time);
    trail.prepare(Fx3D.time);
  },

  get mesh() { return this._trail ? this._trail.mesh : null; },

  // Kompilacja shadera na ekranie ładowania razem z resztą banku.
  prewarm() {
    const trail = this._ensure();
    return trail ? trail.mesh : null;
  },

  reset() {
    live.clear();
    this._trail?.clear();
  },

  dispose() {
    live.clear();
    this._trail?.dispose();
    this._trail = null;
  }
};

if (typeof window !== 'undefined') window.BulletTrails = BulletTrails;
