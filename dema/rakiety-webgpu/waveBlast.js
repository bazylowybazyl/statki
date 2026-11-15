// dema/rakiety-webgpu/waveBlast.js
//
// WYBUCH „FALA” — głowica rakiety „Niszczyciel” (tylko demo, 2026-11-10, trzecie podejście). Użytkownik po
// „Pulsarze”: „stricte — duże haze; wybuch od środka narastający; bez kombinowanych zawinięć, przecięć;
// od środka do zewnątrz, fala refrakcyjna; prostsze, szybsze, bardziej wybuchowe”. Dlatego tu NIE MA
// ładowania, spiral, dżetów, linii pola, powłok z żyłami, promieni ani własnych cząstek — jest jedno
// zdarzenie, wszystko rośnie promieniście ze środka i gaśnie w ~1,4 s:
//   • BŁYSK: białe jądro (HDR, bloom) — 0,07 s;
//   • JASNE CIAŁO: miękka kula światła (gauss) rozprężająca się do ~0,8 R, stygnie biel → lód → lazur;
//   • HAZE: duża rozmyta chmura błękitnego światła, która rośnie tuż ZA czołem fali (do ~3,2 R) — najjaśniejsza
//     w środku, bez krawędzi (profil gaussa wygaszony przed czołem i przed brzegiem kwadu). Szum chmury żyje we
//     współrzędnych P / Rh, więc wzór rozszerza się od środka razem z wybuchem: nic nie wiruje i nie płynie
//     w poprzek. Chmura jest po to, żeby było co uginać — refrakcja na czarnym niebie jest niewidoczna;
//   • FALA REFRAKCJI (post dema, sama refrakcja — bez rysowanego obrysu): czoło i dwa echa, trzy kręgi
//     biegnące od środka na ~3,4 R, oraz duże gorące powietrze (gruby wzór) rosnące z falą;
//   • światło dookólne w siatce dema, wymiatanie dymu rakiet, krótkie przygaszenie i podbicie bloomu, wstrząs.
// Iskry (promieniście od środka) i przypalenie wlotu dokłada reżyser efektów z pul dema (effects.js).
// GŁĘBIA przy kamerze z góry jak w „Pulsarze”: warstwa tylna rysuje się PRZED kadłubami (kadłub ją zasłania),
// przednia — po nich, słabsza (kadłub widać przez poświatę). Bez compute i bez marszu promienia: jeden kwad
// na wybuch w dwóch warstwach, 2 próbki szumu na piksel.
// Układ: scena dema (x − O.x, −(y − O.y), z ku kamerze).

import * as THREE from 'three/webgpu';
import {
  Fn, If, Discard, float, vec3, vec4, uniform, attribute, positionGeometry, varyingProperty, texture3D,
  mix, clamp, smoothstep, exp, max, sqrt, dot
} from 'three/tsl';

/** Wybuchów naraz. */
export const WAVE_BLASTS = 4;

/** Strojenie wybuchu (czasy [s], długości w R). */
export const WAVE = Object.freeze({
  R: 760,           // jednostka długości wybuchu [j.] — jasne ciało rozpręża się do ~0,8 R
  bound: 3.8,       // połowa boku kwadu [R] (haze sięga do czoła fali)
  life: 1.4,        // całe życie wybuchu
  fade: 0.5,        // wygaszanie na końcu życia
  bodyR: 0.75,      // promień jasnego ciała po rozprężeniu [R]
  bodyTau: 0.14,    // rozprężanie jasnego ciała
  waveReach: 3.4,   // zasięg fali refrakcji [R]
  waveTau: 0.34,    // rozbieg fali: r = waveReach · (1 − e^(−t / waveTau))
  waveLife: 1.0     // fala gaśnie po tylu sekundach
});

// Barwy liniowe: biel → lodowy błękit → jasny lazur → granat.
const C_WHITE = [1.0, 1.0, 1.0];
const C_ICE = [0.6, 0.86, 1.0];
const C_AZURE = [0.14, 0.52, 1.0];
const C_DEEP = [0.04, 0.13, 0.7];

const clamp01 = (v) => (v < 0 ? 0 : (v > 1 ? 1 : v));
const smooth01 = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

function newBlast() {
  return {
    active: false, x: 0, y: 0, vx: 0, vy: 0, t: 0, seed: 0, R: WAVE.R,
    // poziomy tej klatki: promienie [R] i jasności warstw
    L: { Rf: 0.03, Rh: 0.06, Ibody: 0, Icore: 0, Ihaze: 0, Iglow: 0, heat: 1, end: 1 }
  };
}

export class WaveBlast {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene scena dema (kamera ortho z góry, z ku kamerze)
   * @param {THREE.Data3DTexture} o.noise3D szum 3D kafelkowy (R, G — dwa fBm)
   * @param {() => number} [o.rng]
   * renderOrderBack — warstwa pod płaszczyzną gry (przed kadłubami), renderOrderFront — nad nią (po kadłubach i dymie).
   */
  constructor({ scene, noise3D, rng = Math.random, renderOrderBack = 3, renderOrderFront = 37 }) {
    this.rng = rng;
    this.noise3D = noise3D;
    this.time = 0;
    this.blasts = Array.from({ length: WAVE_BLASTS }, newBlast);
    this.U = { time: uniform(0) };
    // Wyjścia klatki dla reżysera efektów (effects.js).
    this.shake = 0;
    this.exposure = 1;
    this.bloomBoost = 0;
    this.forces = [];         // siły w dymie rakiet: { x, y, front, width, strength, type, reach } (scena)
    this._lights = [];
    this._dist = [];
    this._nL = 0;
    this._nD = 0;
    this._nF = 0;
    this._kick = 0;
    this.stats = { blasts: 0, live: 0 };
    this._build(scene, renderOrderBack, renderOrderFront);
  }

  /** Siatki do rozgrzewki potoków. */
  get warmMeshes() {
    return [this.meshBack, this.meshFront];
  }

  /** Żywe wybuchy. */
  get count() {
    let n = 0;
    for (const b of this.blasts) if (b.active) n++;
    return n;
  }

  _build(scene, orderBack, orderFront) {
    const U = this.U;
    const noise = this.noise3D;
    const cap = WAVE_BLASTS;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(base.index);
    geo.setAttribute('position', base.getAttribute('position'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    // A: środek xy (scena), R [j.], połowa boku [R]
    // B: promień jasnego ciała [R], jasność ciała, promień haze [R], jasność jądra
    // C: jasność haze, temperatura 1 → 0 (stygnięcie barwy), ziarno, jasność błękitnej łuny błysku
    this._attrs = [mk(), mk(), mk()];
    'ABC'.split('').forEach((k, i) => geo.setAttribute(`wv${k}`, this._attrs[i]));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.geo = geo;

    const vQ = varyingProperty('vec2', 'vWvQ');
    const vA = varyingProperty('vec4', 'vWvA');
    const vB = varyingProperty('vec4', 'vWvB');
    const vC = varyingProperty('vec4', 'vWvC');
    const positionNode = Fn(() => {
      const A = attribute('wvA', 'vec4');
      const q = positionGeometry.xy.mul(2.0);
      vQ.assign(q.mul(A.w));
      vA.assign(A);
      vB.assign(attribute('wvB', 'vec4'));
      vC.assign(attribute('wvC', 'vec4'));
      return vec3(A.xy.add(q.mul(A.w.mul(A.z))), 0.0);
    })();

    const WHITE = vec3(...C_WHITE);
    const ICE = vec3(...C_ICE);
    const AZURE = vec3(...C_AZURE);
    const DEEP = vec3(...C_DEEP);
    const gauss = (x, w) => { const k = x.div(w); return exp(k.mul(k).negate()); };

    const fragment = (back) => Fn(() => {
      const P = vQ.toVar();                          // punkt kadru w układzie wybuchu [R]
      const b2 = dot(P, P).toVar();
      If(b2.greaterThan(vA.w.mul(vA.w)), () => { Discard(); });
      const b = sqrt(b2).toVar();
      const Rf = max(vB.x, 0.03).toVar();            // promień jasnego ciała [R]
      const Rh = max(vB.z, 0.06).toVar();            // promień haze [R] — tuż za czołem fali
      const heat = clamp(vC.y, 0.0, 1.0).toVar();
      const seed = vC.z.toVar();
      const time = U.time;
      const sv = vec3(seed.mul(3.1), seed.mul(5.7), seed.mul(7.3)).toVar();
      // Szum we współrzędnych rosnących z wybuchem: wzór rozszerza się od środka razem z czołem (nie wiruje,
      // nie płynie w poprzek). Dwie grube skale — mgła światła, nie faktura.
      const q = P.div(Rh.add(0.4)).toVar();
      const n1 = texture3D(noise, vec3(q.mul(0.5), time.mul(0.05)).add(sv)).level(0).x;
      const n2 = texture3D(noise, vec3(q.mul(1.25), time.mul(-0.08)).add(sv.mul(1.7))).level(0).y;
      const c = n1.mul(0.6).add(n2.mul(0.4)).toVar();
      const cloud = smoothstep(0.3, 0.8, c).add(0.5).toVar();       // 0,5 … 1,5

      // HAZE: gauss od środka, wygaszony tuż przed czołem fali i przed brzegiem kwadu (żadnej krawędzi).
      const uh = b.div(Rh).toVar();
      const edge = float(1.0).sub(smoothstep(0.82, 1.1, uh));
      const win = float(1.0).sub(smoothstep(vA.w.mul(0.8), vA.w.mul(0.98), b));
      const haze = gauss(uh, float(0.62)).mul(edge).mul(win).toVar();
      // JASNE CIAŁO: miękka kula w środku (szum tylko lekko ją marszczy).
      const body = gauss(b.div(Rf), float(0.8)).mul(win).toVar();

      // Barwa: środek stygnie biel → lód → lazur, obrzeże chłodne (lazur → granat).
      const hot = mix(ICE, WHITE, heat.mul(0.7));
      const cBody = mix(AZURE, hot, heat);
      const cHaze = mix(mix(DEEP, AZURE, 0.6), mix(AZURE, ICE, heat.mul(0.8)), gauss(uh, float(0.45)));

      // Jasności: ciało startuje nad progiem bloomu (błysk), haze trzyma pasmo 0,1–0,5 — błękit zostaje
      // błękitem po ACES. Warstwa przednia (nad kadłubami) słabsza: kadłub widać przez poświatę.
      const layer = back ? 1.0 : 0.5;
      const col = vec3(0.0).toVar();
      col.addAssign(cHaze.mul(haze.mul(cloud).mul(vC.x).mul(layer)));
      col.addAssign(cBody.mul(body.mul(c.mul(0.5).add(0.75)).mul(vB.y).mul(layer)));
      // Łuna błysku: szeroki błękit od pierwszej klatki (zanim chmura urośnie) — błysk jest niebieski, nie szary.
      col.addAssign(AZURE.mul(gauss(b, float(1.5)).mul(win).mul(vC.w).mul(layer)));
      if (!back) {
        // Jądro tylko w warstwie przedniej (jeden raz): biały błysk w środku i lodowa otoczka.
        const cs = Rf.mul(Rf).mul(0.06).add(0.004);
        col.addAssign(WHITE.mul(exp(b2.div(cs).negate()).mul(vB.w)));
        col.addAssign(ICE.mul(exp(b2.div(cs.mul(6.0).add(0.05)).negate()).mul(vB.w.mul(0.22))));
      }
      // Wyjście premultiplied: zasłania tylko jasny środek (chmura haze jest czysto addytywna — bez ciemnego krążka).
      const lum = max(max(col.x, col.y), col.z);
      return vec4(clamp(col, vec3(0.0), vec3(48.0)), clamp(lum.sub(0.3).mul(0.4), 0.0, back ? 0.6 : 0.4));
    })();

    const make = (back) => {
      const mat = new THREE.NodeMaterial();
      mat.name = back ? 'WaveBack' : 'WaveFront';
      mat.transparent = !back;          // tył: kolejka nieprzezroczysta (przed kadłubami), przód: przezroczysta (po nich)
      mat.depthWrite = false;
      mat.depthTest = false;
      mat.lights = false;
      mat.fog = false;
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
      mat.blendSrcAlpha = THREE.OneFactor;
      mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
      mat.blendEquation = THREE.AddEquation;
      mat.blendEquationAlpha = THREE.AddEquation;
      mat.positionNode = positionNode;
      mat.fragmentNode = fragment(back);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = mat.name;
      mesh.frustumCulled = false;
      mesh.renderOrder = back ? orderBack : orderFront;
      mesh.visible = false;
      scene.add(mesh);
      return mesh;
    };
    this.meshBack = make(true);
    this.meshFront = make(false);
  }

  /**
   * Nowy wybuch w punkcie sceny (X, Y); cvx / cvy — prędkość nośnika w scenie [j./s] (trafiony kadłub),
   * R — jednostka długości wybuchu [j.]. Zwraca numer wybuchu.
   */
  spawn(X, Y, { cvx = 0, cvy = 0, R = WAVE.R } = {}) {
    // Wolne miejsce albo najstarszy wybuch.
    let i = -1;
    let oldest = -1;
    for (let k = 0; k < this.blasts.length; k++) {
      const q = this.blasts[k];
      if (!q.active) { i = k; break; }
      if (oldest < 0 || q.t > this.blasts[oldest].t) oldest = k;
    }
    if (i < 0) i = oldest;
    const b = this.blasts[i];
    b.active = true;
    b.x = X; b.y = Y; b.vx = cvx; b.vy = cvy;
    b.t = 0;
    b.R = R;
    b.seed = this.rng();
    this._levels(b);
    this._kick = Math.max(this._kick, 22);
    this.stats.blasts++;
    return i;
  }

  /** Promień czoła fali refrakcji [R] po czasie a [s]. */
  static waveRadius(a) {
    return WAVE.waveReach * (1 - Math.exp(-a / WAVE.waveTau));
  }

  // Promienie i jasności warstw w chwili b.t — wszystko rośnie od środka i gaśnie wykładniczo.
  _levels(b) {
    const W = WAVE;
    const L = b.L;
    const a = b.t;
    const end = 1 - smooth01((a - (W.life - W.fade)) / W.fade);
    L.end = end;
    L.Rf = W.bodyR * (1 - Math.exp(-a / W.bodyTau)) + 0.1 * a + 0.03;
    L.Rh = 0.94 * WaveBlast.waveRadius(a) + 0.06;
    L.Ibody = 1.25 * Math.exp(-a / 0.26) * end;
    L.Icore = 8 * Math.exp(-a / 0.065) + 1.4 * Math.exp(-a / 0.28) * end;
    L.Ihaze = (0.6 * Math.exp(-a / 0.2) + 0.42 * Math.exp(-a / 0.8)) * end;
    L.Iglow = 0.42 * Math.exp(-a / 0.11);
    L.heat = Math.exp(-a / 0.3);
  }

  /**
   * Klatka: krok wybuchów (dt = 0 w pauzie — obraz stoi), instancje poświaty i wyjścia dla reżysera
   * (światła, zniekształcenia, siły w dymie, wstrząs, ekspozycja, bloom).
   */
  update(dt, time) {
    this.time = time;
    this.U.time.value = time % 1000;
    this._nL = 0; this._nD = 0; this._nF = 0;
    this.exposure = 1;
    this.bloomBoost = 0;
    let rumble = 0;
    let n = 0;
    const [aA, aB, aC] = this._attrs.map((at) => at.array);
    for (let i = 0; i < this.blasts.length; i++) {
      const b = this.blasts[i];
      if (b.active && dt > 0) {
        b.t += dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.t >= WAVE.life) { b.active = false; continue; }
        this._levels(b);
      }
      if (!b.active) continue;
      const L = b.L;
      const o = n * 4;
      aA[o] = b.x; aA[o + 1] = b.y; aA[o + 2] = b.R; aA[o + 3] = WAVE.bound;
      aB[o] = L.Rf; aB[o + 1] = L.Ibody; aB[o + 2] = L.Rh; aB[o + 3] = L.Icore;
      aC[o] = L.Ihaze; aC[o + 1] = L.heat; aC[o + 2] = b.seed; aC[o + 3] = L.Iglow;
      n++;
      rumble = Math.max(rumble, this._outputs(b));
    }
    this.geo.instanceCount = n;
    this.meshBack.visible = n > 0;
    this.meshFront.visible = n > 0;
    if (n) {
      for (const at of this._attrs) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * 4);
        at.needsUpdate = true;
      }
    }
    this.shake = Math.max(rumble, this._kick);
    if (dt > 0) this._kick = 0;
    this._lights.length = this._nL;
    this._dist.length = this._nD;
    this.forces.length = this._nF;
    this.stats.live = n;
  }

  _light(x, y, z, range, r, g, b, I) {
    if (!(I > 0.01)) return;
    let L = this._lights[this._nL];
    if (!L) L = this._lights[this._nL] = {};
    this._nL++;
    L.x = x; L.y = y; L.z = z; L.range = range; L.r = r * I; L.g = g * I; L.b = b * I;
  }

  // Źródło zniekształcenia: cap — sufit siły [px] (fala: na px grubości frontu, haze: na jednostkę zoomu).
  _dist_(type, x, y, radius, width, strength, disp, scale, cap) {
    if (!(strength > 0.02)) return;
    let D = this._dist[this._nD];
    if (!D) D = this._dist[this._nD] = {};
    this._nD++;
    D.type = type; D.x = x; D.y = y; D.radius = radius; D.width = width; D.strength = strength; D.disp = disp; D.scale = scale; D.cap = cap;
  }

  _force(x, y, front, width, strength, type, reach) {
    let F = this.forces[this._nF];
    if (!F) F = this.forces[this._nF] = {};
    this._nF++;
    F.x = x; F.y = y; F.front = front; F.width = width; F.strength = strength; F.type = type; F.reach = reach;
  }

  // Światło, fala refrakcji, haze, siła w dymie i obraz całego kadru dla wybuchu b; zwraca dudnienie (wstrząs).
  _outputs(b) {
    const W = WAVE;
    const L = b.L;
    const a = b.t;
    const R = b.R;
    const x = b.x;
    const y = b.y;
    // Światło dookólne: ostry błysk i krótki ogon (kadłuby i dym łapią błękit).
    const I = Math.min(11, 9 * Math.exp(-a / 0.07) + 3 * Math.exp(-a / 0.3) * L.end);
    this._light(x, y, 170, R * (5 + 2.5 * Math.exp(-a / 0.1)), 0.55, 0.8, 1.0, I);
    // FALA REFRAKCJI: czoło i dwa echa — trzy kręgi od środka, sama refrakcja (bez obrysu); wymiata dym rakiet.
    // Siła gaśnie liniowo (krąg ma być czytelny przez całą drogę), mała dyspersja barw (gwiazdy pod falą
    // nie rozszczepiają się w kolorowe kropki).
    if (a < W.waveLife) {
      const f = 1 - a / W.waveLife;
      const rr = R * WaveBlast.waveRadius(a);
      const grow = 1 + a * 1.1;
      this._dist_(0, x, y, rr, 170 * grow, 52 * f, 0.1, 1, 0.6);
      this._dist_(0, x, y, rr * 0.66, 125 * grow, 30 * f, 0.1, 1, 0.6);
      this._dist_(0, x, y, rr * 0.4, 100 * grow, 17 * f, 0.1, 1, 0.6);
      this._force(x, y, R * 3.0 * (1 - Math.exp(-a / 0.36)), 200 * (1 + a * 1.5), 16000 * f * f, 0, 0);
    }
    // HAZE w poście: duże gorące powietrze (gruby wzór) rosnące razem z falą, gaśnie z poświatą.
    const hz = Math.exp(-a / 0.55) * L.end;
    this._dist_(2, x, y, R * (0.8 + 2.2 * (1 - Math.exp(-a / W.waveTau))), 0, 16 * hz, 0, 0.4, 70);
    this.exposure = Math.min(this.exposure, 1 - 0.2 * Math.exp(-a / 0.07));
    this.bloomBoost = Math.max(this.bloomBoost, 0.75 * Math.exp(-a / 0.16));
    return 3 * Math.exp(-a / 0.45);
  }

  /** Światła wybuchów do siatki dema (scena). */
  addLights(grid) {
    let n = 0;
    for (let i = 0; i < this._nL; i++) {
      const L = this._lights[i];
      if (grid.add(L.x, L.y, L.z, L.range, L.r, L.g, L.b, 1.0, 0, 0, -1, -2, 0) >= 0) n++;
    }
    return n;
  }

  /** Źródła zniekształceń (scena); zoom — px ekranu na j. (sufit siły z zoomu). */
  fillDistortion(post, zoom = 1) {
    for (let i = 0; i < this._nD; i++) {
      const D = this._dist[i];
      const cap = D.type === 0 ? D.width * zoom * D.cap : zoom * D.cap;
      post.add(D.type, D.x, D.y, D.radius, D.width, Math.min(D.strength, cap), D.disp, D.scale);
    }
  }

  /** Rozgrzewka: nic poza siatkami (bez compute) — potoki idą klatką rozgrzewki dema. */
  warm() {}

  clear() {
    for (const b of this.blasts) b.active = false;
    this.geo.instanceCount = 0;
    this.meshBack.visible = false;
    this.meshFront.visible = false;
    this._nL = 0; this._nD = 0; this._nF = 0;
    this._lights.length = 0; this._dist.length = 0; this.forces.length = 0;
    this.shake = 0; this.exposure = 1; this.bloomBoost = 0; this._kick = 0;
  }
}
