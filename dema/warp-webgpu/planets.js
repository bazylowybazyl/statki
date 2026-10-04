// dema/warp-webgpu/planets.js
//
// Planety i księżyce dema w TSL — uproszczony odpowiednik planet3d.assets.js
// (tekstury i strojenie oświetlenia z gry): dzień, terminator z zawinięciem,
// noc z miastami (Ziemia), chmury (Ziemia), mgiełka atmosfery (Ziemia, Wenus,
// Mars), poświata limbu (dysk za tarczą), pierścień Saturna.
//
// Rysowane w passie planet kamerą ortho w PIKSELACH ekranu: soczewka świata
// (worldLens.js) podaje środek i promień tarczy w px, więc bez przeliczania
// przez głębię (tarcza Ziemi na starcie ma ~6000 px promienia — w perspektywie
// kula obejmowałaby kamerę). Obrót przelotu = kwaternion grupy; słońce stoi
// w układzie grupy (obraca się razem z ciałem — przy przelocie przesuwa się
// terminator, jak w propozycji 1). Obrót dobowy = przesunięcie tekstury.
// RULON (rulon.js): tarcza, chmury, poświata i pierścień przechodzą przez
// rulon W WIERZCHOŁKACH (`bendMaterial`) — przy horyzoncie bryła spłaszcza się
// z walcem, w przewężeniu za statkiem rozciąga (klepsydra); grupa stoi
// w PŁASKIM miejscu soczewki.

import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, texture, uv, positionLocal, normalWorld, max, min, mix,
  dot, clamp, smoothstep, exp, pow, abs, length, normalize
} from 'three/tsl';
import { bendMaterial } from './rulon.js';

const TEX = {
  earth: 'assets/planety/solar/earth/earth_color.jpg',
  earthNight: 'assets/planety/images/earth_nightmap.jpg',
  earthClouds: 'assets/planety/solar/earth/earth_clouds.jpg',
  mars: 'assets/planety/solar/mars/mars_color.jpg',
  jupiter: 'assets/planety/solar/jupiter/jupiter_color.jpg',
  mercury: 'assets/planety/solar/mercury/mercury_color.jpg',
  venus: 'assets/planety/solar/venus/venus_color.jpg',
  saturn: 'assets/planety/solar/saturn/saturn_color.jpg',
  saturnRing: 'assets/planety/solar/saturn/rings_alpha.png',
  moon: 'assets/planety/images/moonmap.jpg',
  io: 'assets/planety/images/jupiterIo.jpg',
  europa: 'assets/planety/images/jupiterEuropa.jpg',
  ganymede: 'assets/planety/images/jupiterGanymede.jpg',
  callisto: 'assets/planety/images/jupiterCallisto.jpg'
};

// Strojenie z planet3d.assets.js (uAmbient, uSunIntensity, uBrightness, sunsetTint, atmosfera).
const LOOK = {
  earth: { ambient: 0.02, sun: 1.0, bright: 1.0, wrap: 0.0, sunset: [1.2, 0.4, 0.1], atm: [0.3, 0.6, 1.0], atmPow: 9, halo: 1.0, haze: 1.0, hazeCol: [0.55, 0.72, 1.0], hazeBeta: [0.05, 0.1, 0.22] },
  mars: { ambient: 0.0035, sun: 1.04, bright: 0.95, wrap: -0.01, sunset: [0.2, 0.5, 1.5], atm: [0.8, 0.4, 0.2], atmPow: 9, halo: 0.55, haze: 0.32, hazeCol: [0.9, 0.62, 0.42], hazeBeta: [0.14, 0.1, 0.07] },
  jupiter: { ambient: 0.0025, sun: 0.92, bright: 0.92, wrap: -0.01, sunset: [1.0, 0.6, 0.3], atm: [0.65, 0.6, 0.5], atmPow: 5, halo: 0.45 },
  saturn: { ambient: 0.003, sun: 0.95, bright: 0.94, wrap: -0.01, sunset: [1.0, 0.5, 0.2], atm: [0.8, 0.7, 0.5], atmPow: 5, halo: 0.4 },
  venus: { ambient: 0.003, sun: 0.98, bright: 0.93, wrap: -0.01, sunset: [1.2, 0.5, 0.1], atm: [0.9, 0.7, 0.2], atmPow: 6, halo: 0.6, haze: 0.85, hazeCol: [1.0, 0.82, 0.5], hazeBeta: [0.07, 0.11, 0.16] },
  mercury: { ambient: 0.0035, sun: 1.04, bright: 0.95, wrap: -0.01, sunset: [0.8, 0.7, 0.6], atm: [0.6, 0.6, 0.6], atmPow: 10, halo: 0.15 },
  moon: { ambient: 0.004, sun: 1.05, bright: 0.95, wrap: -0.01, sunset: [1, 1, 1], atm: [0.7, 0.7, 0.75], atmPow: 10, halo: 0.12 }
};
const SPIN = { earth: 0.004, mars: 0.004, jupiter: 0.008, saturn: 0.007, venus: 0.001, mercury: 0.002, moon: 0.003 };

const loader = new THREE.TextureLoader();
const cache = new Map();
function tex(key, srgb = true) {
  let t = cache.get(key);
  if (!t) {
    t = loader.load(TEX[key]);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    cache.set(key, t);
  }
  return t;
}

/** Materiał tarczy: oświetlenie w układzie grupy (słońce w uniformie). */
function planetMaterial(id) {
  const L = LOOK[id] || LOOK.moon;
  const isEarth = id === 'earth';
  const u = {
    sun: uniform(new THREE.Vector3(1, 0, 0)),
    spin: uniform(0),
    ambient: uniform(L.ambient),
    sunI: uniform(L.sun),
    bright: uniform(L.bright),
    wrap: uniform(L.wrap),
    sunset: uniform(new THREE.Vector3(...L.sunset)),
    atm: uniform(new THREE.Vector3(...L.atm)),
    atmPow: uniform(L.atmPow),
    rimK: uniform(1),     // > 1: węższy brzeg (tarcza na pół ekranu i więcej)
    haze: uniform(L.haze || 0),
    hazeCol: uniform(new THREE.Vector3(...(L.hazeCol || [0, 0, 0]))),
    hazeBeta: uniform(new THREE.Vector3(...(L.hazeBeta || [0.1, 0.1, 0.1]))),
    // Ekspozycja 0,8: jasne pasy Jowisza i chmury Ziemi przy tarczy na cały
    // ekran przekraczały próg bloomu (0,9) i cała tarcza świeciła szarą łuną.
    exposure: uniform(0.8),
    // Światła miast: w grze × 5 (planet3d.assets.js); przy tarczy na pół
    // ekranu i więcej tekstura nocy jest powiększona kilkunastokrotnie
    // i miasta robią się złotymi plamami — apply() zmniejsza mnożnik z rozmiarem.
    cityGain: uniform(5)
  };
  const dayTex = tex(id === 'moon' || TEX[id] ? id : 'moon');
  const nightTex = isEarth ? tex('earthNight') : null;
  const mat = new THREE.NodeMaterial();
  mat.lights = false;
  mat.fog = false;
  mat.fragmentNode = Fn(() => {
    const tuv = uv().add(vec2(u.spin, 0.0));
    const day = texture(dayTex, tuv).rgb.toVar();
    const N = normalize(positionLocal).toVar();
    const ndl = dot(N, u.sun).toVar();
    const tc = float(-0.02).sub(u.wrap.mul(0.45));
    const ts = float(0.26).add(abs(u.wrap).mul(0.35));
    const mixF = smoothstep(tc.sub(ts), tc.add(ts), ndl).toVar();
    const dayLight = clamp(u.ambient.add(max(ndl, 0.0).mul(u.sunI)), 0.0, 1.2);
    const col = vec3(0).toVar();
    if (nightTex) {
      const night = texture(nightTex, tuv).rgb;
      const lum = dot(night, vec3(0.299, 0.587, 0.114));
      const city = night.mul(lum.mul(lum)).mul(u.cityGain);
      const nightSide = night.mul(0.55).add(city).mul(float(1.0).sub(mixF));
      col.assign(mix(nightSide, day.mul(u.bright).mul(dayLight), mixF));
    } else {
      const twilight = smoothstep(tc.sub(ts.add(0.06)), tc.add(ts), ndl);
      const lit = mix(max(float(0.006), u.ambient.mul(0.35)), dayLight, twilight);
      const nightBand = float(1.0).sub(smoothstep(-0.35, 0.08, ndl));
      col.assign(day.mul(u.bright).mul(lit).add(vec3(0.02, 0.03, 0.05).mul(nightBand)));
    }
    const sunsetBand = smoothstep(-0.3, -0.02, ndl).mul(float(1.0).sub(smoothstep(-0.02, 0.2, ndl)));
    col.assign(mix(col, col.mul(u.sunset), sunsetBand.mul(0.45)));
    // Mgiełka (droga promienia przez atmosferę rośnie ku brzegowi tarczy).
    const mu = clamp(normalWorld.z, 0.0, 1.0).toVar();
    const airmass = u.haze.div(mu.mul(0.95).add(0.05));
    const ext = exp(u.hazeBeta.mul(airmass).negate());
    const dayHaze = smoothstep(-0.02, 0.3, ndl);
    col.assign(mix(col, col.mul(ext).add(u.hazeCol.mul(dayHaze).mul(float(1.0).sub(ext))), clamp(u.haze.mul(4.0), 0.0, 1.0)));
    // Brzeg tarczy: atmosfera od strony dziennej.
    const rim = pow(float(1.0).sub(mu), u.atmPow.mul(u.rimK)).mul(smoothstep(-0.25, 0.4, ndl)).mul(0.9);
    col.addAssign(u.atm.mul(rim));
    return vec4(max(col.mul(u.exposure), vec3(0.0)), 1.0);
  })();
  bendMaterial(mat, { mode: 'rgb' });
  return { mat, u };
}

function cloudMaterial(sunU) {
  const cTex = tex('earthClouds');
  const mat = new THREE.NodeMaterial();
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  const u = { spin: uniform(0) };
  mat.fragmentNode = Fn(() => {
    const t = texture(cTex, uv().add(vec2(u.spin, 0.0))).rgb;
    const mask = dot(t, vec3(0.299, 0.587, 0.114));
    const N = normalize(positionLocal);
    const lit = smoothstep(-0.02, 0.22, dot(N, sunU));
    const a = clamp(mask.mul(0.62).mul(pow(max(lit, 0.0), 1.35)), 0.0, 1.0);
    const c = vec3(1.0).mul(lit.mul(0.92).add(0.08));
    return vec4(c.mul(a), a);
  })();
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  bendMaterial(mat, { mode: 'all' });
  return { mat, u };
}

/** Poświata limbu: dysk za tarczą, gaśnie do zera przed brzegiem kwadratu. */
function haloMaterial(id) {
  const L = LOOK[id] || LOOK.moon;
  // thick / reach — grubość i zasięg powłoki w promieniach tarczy; apply() ścina je
  // do stałej liczby px przy dużych tarczach (inaczej poświata zalewała ekran).
  const u = { sun2: uniform(new THREE.Vector2(1, 0)), gain: uniform(L.halo), col: uniform(new THREE.Vector3(...L.atm)), thick: uniform(0.028), reach: uniform(0.16) };
  const mat = new THREE.NodeMaterial();
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  mat.fragmentNode = Fn(() => {
    // Kwad 2.4 × promień: r w promieniach tarczy.
    const q = uv().sub(0.5).mul(2.4);
    const r = length(q).toVar();
    const h = max(r.sub(1.0), 0.0);
    const shell = exp(h.div(u.thick).negate()).mul(smoothstep(u.reach.add(1.0), u.reach.mul(0.125).add(1.0), r)).mul(smoothstep(0.985, 1.0, r));
    const side = clamp(dot(q.div(max(r, 1e-3)), u.sun2).mul(0.6).add(0.45), 0.0, 1.0);
    return vec4(u.col.mul(shell.mul(side).mul(u.gain).mul(0.9)), 0.0);
  })();
  bendMaterial(mat, { mode: 'rgb' });
  return { mat, u };
}

function ringMaterial(sunU) {
  const rTex = tex('saturnRing');
  rTex.wrapS = THREE.ClampToEdgeWrapping;
  rTex.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.NodeMaterial();
  mat.lights = false;
  mat.fog = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  mat.fragmentNode = Fn(() => {
    const t = texture(rTex, uv());
    const lit = clamp(abs(sunU.y).mul(0.5).add(0.45), 0.0, 1.0);
    return vec4(t.rgb.mul(t.a).mul(lit).mul(0.95), t.a.mul(0.95));
  })();
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor;
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  bendMaterial(mat, { mode: 'all' });
  return mat;
}

function ringGeometry(inner, outer) {
  const g = new THREE.RingGeometry(inner, outer, 128, 8);
  const pos = g.attributes.position;
  const uvA = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const rr = Math.hypot(x, y);
    uvA.setXY(i, Math.min(1, Math.max(0, (rr - inner) / (outer - inner))), (Math.atan2(y, x) + Math.PI) / (Math.PI * 2));
  }
  uvA.needsUpdate = true;
  return g;
}

export class PlanetSet {
  /**
   * @param {THREE.Scene} scene pass planet (kamera ortho w pikselach)
   * @param {Array} bodies ciała z solar.js
   */
  constructor(scene, bodies) {
    this.items = new Map();
    // Rulon gnie siatki w wierzchołkach — bok siatki na ekranie musi być krótki,
    // inaczej tarcza na pół ekranu i więcej (start z Ziemi: ~6000 px promienia)
    // wychodzi kanciasta, a tekstura „łamie się” na każdym trójkącie. Poziomy
    // szczegółowości wg promienia na ekranie (apply): < 300 px, < 1500 px, więcej.
    this.lods = [
      { sphere: new THREE.SphereGeometry(1, 96, 64), quad: new THREE.PlaneGeometry(2.4, 2.4, 48, 48) },
      { sphere: new THREE.SphereGeometry(1, 256, 160), quad: new THREE.PlaneGeometry(2.4, 2.4, 128, 128) },
      { sphere: new THREE.SphereGeometry(1, 768, 400), quad: new THREE.PlaneGeometry(2.4, 2.4, 320, 320) }
    ];
    const sphere = this.lods[0].sphere;
    const quad = this.lods[0].quad;
    for (const b of bodies) {
      const look = TEX[b.id] ? b.id : 'moon';
      const group = new THREE.Group();
      group.name = `body_${b.id}`;
      group.visible = false;
      const { mat, u } = planetMaterial(look);
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.renderOrder = 0;
      group.add(mesh);
      const item = { body: b, group, mesh, u, look, clouds: null, halo: null, haloU: null, ring: null };
      if (b.id === 'earth') {
        const cm = cloudMaterial(u.sun);
        item.clouds = new THREE.Mesh(sphere, cm.mat);
        item.clouds.scale.setScalar(1.006);
        item.clouds.renderOrder = 1;
        item.cloudsU = cm.u;
        group.add(item.clouds);
      }
      if (b.id === 'saturn') {
        const ring = new THREE.Mesh(ringGeometry(1.22, 1.77), ringMaterial(u.sun));
        ring.rotation.x = -60 * Math.PI / 180;
        ring.renderOrder = 2;
        item.ring = ring;
        group.add(ring);
      }
      const hm = haloMaterial(look);
      item.halo = new THREE.Mesh(quad, hm.mat);
      item.halo.renderOrder = -1;
      item.haloU = hm.u;
      // Rulon przenosi bryłę w shaderze — płaskie miejsce bywa daleko poza
      // kadrem (ciało ściągnięte przez przewężenie), więc bez odrzucania przez
      // three; kadr sprawdza apply() na miejscu po rulonie.
      item.halo.frustumCulled = false;
      group.traverse((o) => { o.frustumCulled = false; });
      scene.add(item.halo);
      scene.add(group);
      this.items.set(b.id, item);
    }
    this._q = new THREE.Quaternion();
    this._axis = new THREE.Vector3();
    this._sunW = new THREE.Vector3();
  }

  hideAll() {
    for (const it of this.items.values()) {
      it.group.visible = false;
      it.halo.visible = false;
    }
  }

  /**
   * Obrót tarczy (tylko wygląd): punkt (lat, lon) [°] staje przy krawędzi
   * tarczy w kierunku (dirX, dirY) (ekran, y w górę), `inset` [°] od brzegu
   * ku kamerze; biegun pochylony do kamery. Start podróży z Ziemi: przy
   * krawędzi pod statkiem nocne światła Europy zamiast czarnej Arktyki
   * (w orientacji gry biegun stoi na górze tarczy). Bez `o` — jak w grze.
   */
  orient(id, o = null) {
    const it = this.items.get(id);
    if (!it) return;
    const q = it.orient || (it.orient = new THREE.Quaternion());
    q.identity();
    if (o) {
      const rad = Math.PI / 180;
      const nl = Math.hypot(o.dirX, o.dirY) || 1;
      const n = new THREE.Vector3(o.dirX / nl, o.dirY / nl, 0);
      const z = new THREE.Vector3(0, 0, 1);
      const inset = (o.inset ?? 10) * rad;
      const lat = (o.lat ?? 50) * rad;
      const lon = (o.lon ?? 10) * rad;
      const D = n.clone().multiplyScalar(Math.cos(inset)).addScaledVector(z, Math.sin(inset));
      const T = z.clone().addScaledVector(D, -D.dot(z)).normalize();
      const P = D.clone().multiplyScalar(Math.sin(lat)).addScaledVector(T, Math.cos(lat)).normalize();
      const eT = D.clone().addScaledVector(P, -D.dot(P)).normalize();
      const eEast = new THREE.Vector3().crossVectors(P, eT);
      // Lokalny równik kuli three: dł. λ ↔ (cos λ, 0, −sin λ); oś y = biegun.
      const X0 = eT.clone().multiplyScalar(Math.cos(lon)).addScaledVector(eEast, -Math.sin(lon));
      const Z0 = new THREE.Vector3().crossVectors(X0, P);
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X0, P, Z0));
    }
    it.mesh.quaternion.copy(q);
    if (it.clouds) it.clouds.quaternion.copy(q);
    it.orientInv = q.clone().invert();
  }

  /**
   * Wynik soczewki (worldLens.js) → siatki. px od środka ekranu (y w dół),
   * kamera passa: ortho w px ze środkiem (0, 0); t — czas (obrót dobowy).
   */
  /**
   * `rulon` (opcjonalnie, rulon.js): { map(x, y) → { x, y, g, vis }, boost(x, y) → mnożnik }
   * — punkt w px od środka, y w GÓRĘ. Grupa stoi w płaskim miejscu (siatki
   * gnie shader), `map` służy tylko odrzuceniu ciał poza kadrem, `boost` —
   * powiększenie ciała przeciąganego przez przewężenie.
   */
  apply(view, W, H, t, visible = true, rulon = null) {
    this.hideAll();
    if (!visible) return;
    for (const v of view) {
      const it = this.items.get(v.body.id);
      if (!it) continue;
      const vx = v.x;
      const vy = -v.y;
      let size = v.size;
      let cx = vx;
      let cy = vy;
      let cs = size;
      if (rulon) {
        size *= rulon.boost(vx, vy);
        const m = rulon.map(vx, vy);
        cx = m.x;
        cy = m.y;
        // Zapas: przewężenie rozciąga bryłę wzdłuż kursu (za rufą do 1 + spit).
        cs = size * Math.max(1, m.g) * 2.5;
      }
      if (!(size > 0.4)) continue;
      // Poza kadrem (z poświatą) — pomijamy.
      if (Math.abs(cx) - cs * 1.2 > W * 0.5 || Math.abs(cy) - cs * 1.2 > H * 0.5) continue;
      it.group.visible = true;
      const lod = this.lods[size < 300 ? 0 : size < 1500 ? 1 : 2];
      it.mesh.geometry = lod.sphere;
      if (it.clouds) it.clouds.geometry = lod.sphere;
      it.halo.geometry = lod.quad;
      it.group.position.set(vx, vy, 0);
      it.group.scale.setScalar(size);
      this._axis.set(v.turnAx, v.turnAy, 0);
      it.group.quaternion.setFromAxisAngle(this._axis, v.turnAngle);
      it.group.updateMatrixWorld(true);
      // Słońce w układzie siatki (shader liczy w positionLocal).
      it.u.sun.value.set(v.sunX, v.sunY, 0);
      if (it.orientInv) it.u.sun.value.applyQuaternion(it.orientInv);
      const spin = (t * (SPIN[it.look] || 0.003)) % 1;
      it.u.spin.value = spin;
      it.u.cityGain.value = 5 * Math.min(1, Math.max(0.22, 1400 / size));
      it.u.rimK.value = Math.max(1, size / 1400);
      it.haloU.thick.value = Math.min(0.028, 40 / size);
      it.haloU.reach.value = Math.min(0.16, 230 / size);
      if (it.cloudsU) it.cloudsU.spin.value = (spin * 1.15) % 1;
      // Poświata: dysk za tarczą, strona słoneczna po obrocie przelotu.
      this._sunW.set(v.sunX, v.sunY, 0).applyQuaternion(it.group.quaternion);
      const sl = Math.hypot(this._sunW.x, this._sunW.y) || 1;
      it.haloU.sun2.value.set(this._sunW.x / sl, this._sunW.y / sl);
      it.halo.visible = true;
      it.halo.position.set(vx, vy, -size * 1.3);
      it.halo.scale.setScalar(size);
      it.halo.updateMatrixWorld(true);
    }
  }
}
