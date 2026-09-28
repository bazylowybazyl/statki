// ============================================================
// Pęknięcie tarczy: czasza rozsypuje się na heksy. Fragmenty (kilka tysięcy)
// z plastra miodu na czaszy — pozycja i normalna spoczynkowa liczone raz na CPU
// z profilu; w compute lecą od ostatniego trafienia i na zewnątrz, obracają się
// wokół własnej osi i gasną w ~1,2 s. Rozpad biegnie falą od miejsca trafienia
// (fragment startuje z opóźnieniem ∝ odległości, 3600 j./s). Klatka lokalna 3D grupy tarczy.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, vec2, vec3, vec4, instancedArray, instanceIndex, hash, If, select, varying,
  attribute, positionGeometry, normalize, cross, cos, sin, dot, length, exp, max, mix, smoothstep, saturate, abs
} from 'three/tsl';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';
import { uDt, SHIELD_BREAK_COLOR } from './wspolne.js';

// Heksagon płaski (środek + 6 wierzchołków), atrybut aRim: 0 w środku, 1 na brzegu.
function hexGeometry() {
  const pos = [0, 0, 0];
  const rim = [0];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    pos.push(Math.cos(a), Math.sin(a), 0);
    rim.push(1);
  }
  const idx = [];
  for (let i = 0; i < 6; i++) idx.push(0, 1 + i, 1 + ((i + 1) % 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aRim', new THREE.Float32BufferAttribute(rim, 1));
  g.setIndex(idx);
  return g;
}

export function createShards({ renderer, group, profile, domeHeight, maxCount = 6000 }) {
  const H = domeHeight;
  const zAt = (x, y) => {
    const R = sampleShieldProfileRadius(profile, Math.atan2(-y, x));
    const t = Math.hypot(x, y) / Math.max(R, 1e-3);
    return { t, z: H * Math.pow(Math.max(0, 1 - t * t), 0.62) };
  };
  // Plaster: siatka trójkątna o odstępie d (heks od ściany do ściany = d).
  let d = Math.max(12, profile.maxR * 0.022);
  let centers;
  for (let attempt = 0; attempt < 4; attempt++) {
    centers = [];
    const rows = Math.ceil(profile.maxR * 2 / (d * 0.866)) + 2;
    const cols = Math.ceil(profile.maxR * 2 / d) + 2;
    for (let j = -rows / 2; j <= rows / 2; j++) {
      const y = j * d * 0.866;
      for (let i = -cols / 2; i <= cols / 2; i++) {
        const x = i * d + ((j & 1) ? d * 0.5 : 0);
        if (zAt(x, y).t < 0.975) centers.push(x, y);
      }
    }
    if (centers.length / 2 <= maxCount) break;
    d *= Math.sqrt(centers.length / 2 / maxCount) * 1.02;
  }
  const n = centers.length / 2;
  const rest = new Float32Array(n * 4);
  const nrm = new Float32Array(n * 4);
  const e = 2.0;
  for (let k = 0; k < n; k++) {
    const x = centers[k * 2], y = centers[k * 2 + 1];
    const z = zAt(x, y).z;
    const gx = (zAt(x + e, y).z - zAt(x - e, y).z) / (2 * e);
    const gy = (zAt(x, y + e).z - zAt(x, y - e).z) / (2 * e);
    const l = Math.hypot(gx, gy, 1);
    rest.set([x, y, z, Math.random()], k * 4);
    nrm.set([-gx / l, -gy / l, 1 / l, d * 0.5 * 0.9], k * 4);
  }
  const restBuf = instancedArray(rest, 'vec4');
  const nrmBuf = instancedArray(nrm, 'vec4');
  const posBuf = instancedArray(n, 'vec4');   // xyz, wiek (< 0: czeka na falę rozpadu)
  const velBuf = instancedArray(n, 'vec4');   // prędkość, prędkość obrotu

  const uOrigin = uniform(new THREE.Vector2());  // ostatnie trafienie (lokalnie)
  const uPower = uniform(1);
  const uSeed = uniform(0);
  const uGain = uniform(1);

  const init = Fn(() => {
    const i = instanceIndex;
    const R = restBuf.element(i);
    const Nn = nrmBuf.element(i);
    const s = float(i).add(uSeed);
    const h1 = hash(s.mul(3.0).add(1.0)), h2 = hash(s.mul(5.0).add(2.0));
    const h3 = hash(s.mul(7.0).add(3.0)), h4 = hash(s.mul(11.0).add(4.0));
    const off = R.xy.sub(uOrigin).toVar();
    const dist = length(off).toVar();
    const away = off.div(max(dist, 1.0));
    const speed = exp(dist.div(-520.0)).mul(900.0).add(220.0).mul(uPower).mul(h1.mul(0.8).add(0.6)).toVar();
    const rnd = vec3(h2.sub(0.5), h3.sub(0.5), h4.mul(0.5)).mul(160.0);
    const v = vec3(away.mul(speed.mul(0.75)), 0.0).add(Nn.xyz.mul(speed.mul(0.55))).add(rnd);
    posBuf.element(i).assign(vec4(R.xyz, dist.div(-3600.0)));
    velBuf.element(i).assign(vec4(v, h2.sub(0.5).mul(16.0)));
  })().compute(n);

  const step = Fn(() => {
    const i = instanceIndex;
    const P = posBuf.element(i).toVar();
    const V = velBuf.element(i).toVar();
    If(P.w.greaterThanEqual(0.0), () => {
      const nv = V.xyz.mul(exp(uDt.mul(-0.9)));
      P.assign(vec4(P.xyz.add(nv.mul(uDt)), P.w.add(uDt)));
      V.assign(vec4(nv, V.w));
    }).Else(() => {
      P.assign(vec4(P.xyz, P.w.add(uDt)));
    });
    posBuf.element(i).assign(P);
    velBuf.element(i).assign(V);
  })().compute(n);

  // Render: heks zorientowany wg normalnej spoczynkowej, obracany wokół losowej osi.
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const aRim = attribute('aRim', 'float');
  // Dane instancji jako atrybuty (w fragment shaderze same przechodzą przez varying).
  const P = posBuf.toAttribute();
  const V = velBuf.toAttribute();
  const Rs = restBuf.toAttribute();
  const Nn = nrmBuf.toAttribute();
  mat.positionNode = Fn(() => {
    const nz = normalize(Nn.xyz).toVar();
    const t1 = normalize(cross(nz, select(abs(nz.z).lessThan(0.9), vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0)))).toVar();
    const t2 = cross(nz, t1).toVar();
    const o = t1.mul(positionGeometry.x).add(t2.mul(positionGeometry.y)).mul(Nn.w).toVar();
    // Obrót Rodriguesa wokół losowej osi (z ziarna fragmentu).
    const ax = normalize(vec3(hash(Rs.w.mul(91.0)).sub(0.5), hash(Rs.w.mul(37.0)).sub(0.5), hash(Rs.w.mul(53.0)).sub(0.5)).add(vec3(0.001)));
    const ang = V.w.mul(max(P.w, 0.0));
    const c = cos(ang), s = sin(ang);
    const rot = o.mul(c).add(cross(ax, o).mul(s)).add(ax.mul(dot(ax, o)).mul(c.oneMinus()));
    return P.xyz.add(rot);
  })();
  // Wiek i stan liczone w vertex shaderze, do fragmentu przez varying.
  const life = mix(float(0.95), float(1.45), hash(Rs.w.mul(17.0)));
  const ageV = varying(vec2(max(P.w, 0.0), select(P.w.lessThan(0.0), float(1.0), float(0.0))).div(vec2(life, 1.0)));
  const k = saturate(ageV.x);
  const age = k.mul(1.2);
  const fade = k.oneMinus().mul(k.oneMinus());
  const waiting = ageV.y;
  const edge = smoothstep(0.55, 1.0, aRim);
  const breakCol = vec3(SHIELD_BREAK_COLOR.r, SHIELD_BREAK_COLOR.g, SHIELD_BREAK_COLOR.b);
  // Czekający fragment: pękająca struktura — jasne tylko szwy między heksami.
  const idle = breakCol.mul(edge.mul(0.85).add(0.05));
  // Odlatujący: rozbłysk przy starcie, potem żar w barwie pęknięcia i wygaszanie.
  const hot = exp(age.mul(-6.0));
  const flying = breakCol.mul(edge.mul(2.1).add(0.3)).add(vec3(1.25, 1.1, 0.95).mul(hot).mul(edge.mul(0.6).add(0.4))).mul(fade);
  mat.colorNode = mix(flying, idle, waiting).mul(uGain);
  const mesh = new THREE.Mesh(hexGeometry(), mat);
  mesh.count = n;
  mesh.frustumCulled = false;
  mesh.renderOrder = 11;
  mesh.visible = false;
  group.add(mesh);

  let activeUntil = -1;
  let startPending = false;
  return {
    mesh, count: n, cell: d, uGain,
    // Start rozpadu od punktu lokalnego (ox, oy).
    trigger(ox, oy, power, time) {
      uOrigin.value.set(ox, oy);
      uPower.value = power;
      uSeed.value = Math.floor(Math.random() * 1e5);
      startPending = true;
      activeUntil = time + 1.45 + (profile.maxR * 2) / 3600 + 0.1;
      mesh.visible = true;
    },
    compute(time) {
      if (startPending) { renderer.compute(init); startPending = false; }
      if (time < activeUntil) renderer.compute(step);
      else mesh.visible = false;
    },
    active(time) { return time < activeUntil; },
    clear() { activeUntil = -1; mesh.visible = false; }
  };
}
