// ============================================================
// Czasza tarczy-obrysu: geometria z profilu r(θ) (jak buildHullShieldGeometry
// w src/3d/shield3D.js, gęstsza) i materiał „jak dziś w grze” — port
// HULL_SHIELD_FRAGMENT do TSL: łaty trafień z tablicy 24 slotów, fresnel,
// obramówka, fala rozruchu/gaszenia, puls niskiego HP, rozpad przy pęknięciu.
// To punkt odniesienia A/B (klawisz T) dla nowego pola.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, float, vec2, vec3, vec4, attribute, positionGeometry, positionView,
  normalView, normalize, abs, dot, pow, exp, max, min, mix, smoothstep, saturate, floor, length,
  sin, step, fract, select, Loop, If, Discard
} from 'three/tsl';
import { sampleShieldProfileRadius } from '../../shieldSystem.js';
import { uTime, gnoise, hash12, SHIELD_FULL_COLOR, SHIELD_EDGE_COLOR } from './wspolne.js';

export const MAX_HITS = 24;

function clampJs(v, a, b) { return v < a ? a : (v > b ? b : v); }

// „Odwrócony” smoothstep bez krawędzi a > b (WGSL: niezdefiniowane, a dla stałych
// Tint odrzuca shader): 1 − smoothstep(b, a, x) daje to samo co GLSL smoothstep(a, b, x).
export const sstepDown = (a, b, x) => float(1.0).sub(smoothstep(b, a, x));

// ---------------------------------------------------------------------------
// Geometria: polarna kopuła na profilu, ANGULAR kroków kątowych × RINGS pierścieni
// gęstniejących ku krawędzi. Klatka lokalna kadłuba: x wzdłuż kadłuba, y = −y_grid,
// z w górę; krawędź na z = 0, wysokość h·(1 − t²)^0,62 jak w grze.

export function domeHeightFor(profile) {
  return clampJs(profile.minR * 0.85, 8, 140);
}

export function buildDomeGeometry(profile, angular = 384, rings = 24) {
  const N = angular;
  const h = domeHeightFor(profile);
  const ts = [];
  for (let j = 1; j <= rings; j++) ts.push(1 - Math.pow(1 - j / rings, 1.8));

  const count = 1 + N * ts.length;
  const positions = new Float32Array(count * 3);
  const edges = new Float32Array(count);
  positions[2] = h;
  edges[0] = 0;
  const radii = new Float32Array(N);
  for (let i = 0; i < N; i++) radii[i] = sampleShieldProfileRadius(profile, (i / N) * Math.PI * 2);
  let v = 1;
  for (let j = 0; j < ts.length; j++) {
    const t = ts[j];
    const z = h * Math.pow(Math.max(0, 1 - t * t), 0.62);
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * Math.PI * 2;
      const r = radii[i] * t;
      positions[v * 3] = Math.cos(theta) * r;
      positions[v * 3 + 1] = -Math.sin(theta) * r;   // y3d = −y_grid
      positions[v * 3 + 2] = z;
      edges[v] = t;
      v++;
    }
  }

  const indices = [];
  for (let i = 0; i < N; i++) indices.push(0, 1 + ((i + 1) % N), 1 + i);
  for (let j = 0; j < ts.length - 1; j++) {
    const base0 = 1 + j * N, base1 = 1 + (j + 1) * N;
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const a = base0 + i, b = base0 + i1, c = base1 + i, d = base1 + i1;
      indices.push(a, d, c, a, b, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aEdge', new THREE.BufferAttribute(edges, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Normalne w górę (+z na czubku) — winding zależy od odbicia y.
  const normals = geometry.getAttribute('normal');
  if (normals.getZ(0) < 0) {
    const idx = geometry.getIndex();
    for (let i = 0; i < idx.count; i += 3) {
      const tmp = idx.getX(i + 1);
      idx.setX(i + 1, idx.getX(i + 2));
      idx.setX(i + 2, tmp);
    }
    idx.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingSphere();
  return { geometry, height: h };
}

// ---------------------------------------------------------------------------
// Uniformy stanu tarczy (wspólne dla obu wyglądów), wartości z createHullShieldMaterial.

export function createShieldUniforms(profile) {
  const maxR = Math.max(1, profile.maxR);
  const hexCell = clampJs(maxR * 0.16, 10, 40);
  const hitArr = Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, 0, 0, -999)); // x, y, —, start
  return {
    maxR,
    color: uniform(SHIELD_FULL_COLOR.clone()),
    life: uniform(1),
    reveal: uniform(0),
    hexScale: uniform(1 / hexCell),
    hexOpacity: uniform(0.27),
    showHex: uniform(0),
    edgeWidth: uniform(0.2),
    fresnelPower: uniform(2.2),
    fresnelStrength: uniform(2.2),
    opacity: uniform(0.30),
    flashSpeed: uniform(0.6),
    flashIntensity: uniform(0.11),
    noiseScale: uniform(2.2 / maxR),
    noiseEdgeColor: uniform(SHIELD_EDGE_COLOR.clone()),
    noiseEdgeWidth: uniform(0.1),
    noiseEdgeIntensity: uniform(0.6),
    noiseEdgeSmoothness: uniform(0.5),
    flowScale: uniform(5.5 / maxR),
    flowSpeed: uniform(1.08),
    flowIntensity: uniform(4.0),
    hitArr,
    hits: uniformArray(hitArr, 'vec4'),
    hitRingSpeed: uniform(maxR * 0.55),
    hitRingWidth: uniform(clampJs(maxR * 0.045, 4, 18)),
    hitMaxRadius: uniform(maxR * 0.52),
    hitDuration: uniform(1.5),
    hitIntensity: uniform(1.0),
    hitImpactRadius: uniform(maxR * 0.26),
    baseHitRadius: maxR * 0.26,
    rimStart: uniform(0.84),
    rimIntensity: uniform(1.8),
    filmStrength: uniform(0.20),
    isBreaking: uniform(0),
    energyShot: uniform(0),
    fieldVisibility: uniform(0),
    sweep: uniform(-1),
    sweepWidth: uniform(0.17),
    lowPower: uniform(0),
    hitOpacity: uniform(0.90),
    hitGrow: uniform(0.10),
    hitDecay: uniform(3.4),
    hitCoreLife: uniform(0.16)
  };
}

// Plaster miodu w płaszczyźnie kadłuba: xy = id komórki, z = odległość od środka
// komórki w metryce heksa (0 w środku, 0,5 na krawędzi).
export const hexCell = Fn(([p]) => {
  const s = vec2(1.0, 1.7320508);
  const hC = floor(vec4(p.x, p.y, p.x.sub(0.5), p.y.sub(1.0)).div(vec4(s.x, s.y, s.x, s.y))).add(0.5).toVar();
  const h1 = p.sub(hC.xy.mul(s)).toVar();
  const h2 = p.sub(hC.zw.add(0.5).mul(s)).toVar();
  const near1 = dot(h1, h1).lessThan(dot(h2, h2));
  const c = abs(select(near1, h1, h2)).toVar();
  const id = select(near1, hC.xy, hC.zw.add(0.5));
  const d = max(dot(c, s.mul(0.5)), c.x);
  return vec3(id, d);
}).setLayout({ name: 'hexCell', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

// ---------------------------------------------------------------------------
// Materiał „jak dziś w grze” (HULL_SHIELD_FRAGMENT). Szum 3D simplex z gry zastąpiony
// szumem 2D w płaszczyźnie kadłuba (czasza jest funkcją xy) — ten sam charakter,
// cztery tanie wywołania zamiast czterech simplexów.

export function createReferenceMaterial(U) {
  const m = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, blending: THREE.AdditiveBlending
  });
  const aEdge = attribute('aEdge', 'float');

  m.fragmentNode = Fn(() => {
    const obj = positionGeometry.toVar();
    const vEdge = aEdge.toVar();
    const t = uTime.toVar();
    const N = normalize(normalView).toVar();
    const V = normalize(positionView.negate()).toVar();

    // Reveal / dissolve
    const noise = gnoise(obj.xy.mul(U.noiseScale)).mul(0.5).add(0.5).toVar();
    const glitch = hash12(obj.xy.mul(0.37).add(vec2(t.mul(30.0), t.mul(-17.0))));
    const effReveal = select(U.isBreaking.greaterThan(0.5), max(U.reveal, glitch.mul(0.3)), U.reveal).toVar();
    const revealMask = smoothstep(effReveal.sub(U.noiseEdgeWidth), effReveal, noise).toVar();
    const innerFade = mix(float(0.98), float(0.15), U.noiseEdgeSmoothness);
    const edgeLow = smoothstep(effReveal.sub(U.noiseEdgeWidth), effReveal.sub(U.noiseEdgeWidth.mul(innerFade)), noise);
    const edgeHigh = smoothstep(effReveal.sub(U.noiseEdgeWidth.mul(0.15)), effReveal, noise);
    const revealEdge = edgeLow.mul(edgeHigh.oneMinus()).toVar();

    const fresnel = pow(saturate(float(1.0).sub(abs(dot(N, V)))), U.fresnelPower).mul(U.fresnelStrength).toVar();

    const ft = t.mul(U.flowSpeed);
    const fn1 = gnoise(obj.xy.mul(U.flowScale).add(vec2(ft, ft.mul(0.6))));
    const fn2 = gnoise(obj.xy.mul(U.flowScale.mul(2.1)).add(vec2(ft.mul(-0.5), ft.mul(0.9))));
    const flowNoise = fn1.mul(0.6).add(fn2.mul(0.4)).mul(0.5).add(0.5).toVar();

    const hc = hexCell(obj.xy.mul(U.hexScale)).toVar();
    const hex = smoothstep(float(0.5).sub(U.edgeWidth), float(0.5), hc.z).toVar();
    const rnd = hash12(hc.xy.add(vec2(17.0, 3.0)));
    const flash = smoothstep(0.6, 1.0, sin(t.mul(U.flashSpeed).mul(rnd.mul(1.5).add(0.5)).add(rnd.mul(6.2831)))).mul(U.flashIntensity).toVar();

    const fieldGrain = gnoise(obj.xy.mul(U.noiseScale.mul(3.0)).add(vec2(t.mul(0.7), t.mul(-0.4)))).toVar();

    // Trafienia: miękka łata wokół punktu, jądro, lokalny pierścień.
    const hitPatch = float(0).toVar();
    const core = float(0).toVar();
    const ringC = float(0).toVar();
    const R0 = U.hitImpactRadius.toVar();
    Loop({ start: 0, end: MAX_HITS, type: 'int', condition: '<', name: 'hi' }, ({ hi }) => {
      const hp = U.hits.element(hi);
      const elapsed = t.sub(hp.w);
      const active = step(0.0, hp.w).mul(step(0.0, elapsed)).mul(step(elapsed, U.hitDuration));
      If(active.greaterThan(0.5), () => {
        const dist = length(obj.xy.sub(hp.xy));
        const grow = smoothstep(0.0, U.hitGrow, elapsed);
        const radius = R0.mul(grow.mul(0.58).add(0.42));
        const decay = exp(elapsed.mul(U.hitDecay).negate()).mul(smoothstep(U.hitDuration.mul(0.7), U.hitDuration, elapsed).oneMinus());
        const d = dist.add(fieldGrain.mul(radius).mul(0.17));
        const fall = sstepDown(radius, radius.mul(0.10), d);
        hitPatch.addAssign(fall.mul(fall).mul(decay));
        core.addAssign(sstepDown(radius.mul(0.30), 0.0, dist).mul(smoothstep(0.0, U.hitCoreLife, elapsed).oneMinus()));
        const ringR = elapsed.mul(U.hitRingSpeed);
        const ring = sstepDown(U.hitRingWidth, 0.0, abs(d.sub(ringR)));
        ringC.addAssign(ring.mul(smoothstep(U.hitMaxRadius.mul(0.55), U.hitMaxRadius, ringR).oneMinus()).mul(decay));
      });
    });
    const hitP = min(hitPatch, 1.6);
    const coreC = min(core, 1.0).toVar();
    const ringCC = min(ringC, 1.5);

    const lColor = mix(vec3(1.0, 0.08, 0.04), U.color, U.life).toVar();
    const bFlash = fract(t.mul(25.0));
    lColor.assign(select(U.isBreaking.greaterThan(0.5), mix(vec3(1.0, 0.15, 0.1), vec3(2.0), bFlash.mul(0.4)), lColor));

    const rim = smoothstep(U.rimStart, 1.0, vEdge).toVar();
    const rimGlow = rim.mul(rim).mul(U.rimIntensity).toVar();
    const film = U.filmStrength.mul(flowNoise.mul(0.45).add(0.55));

    // Warstwa pola — tylko rozruch, gaszenie, pęknięcie (uSweep < 0: całe pole).
    const hasSweep = U.sweep.greaterThanEqual(0.0);
    const lit = select(hasSweep, sstepDown(U.sweep.add(U.sweepWidth), U.sweep.sub(U.sweepWidth), vEdge), float(1.0)).toVar();
    const sweepBand = select(hasSweep,
      sstepDown(U.sweepWidth, 0.0, abs(vEdge.sub(U.sweep))).mul(flowNoise.mul(0.25).add(0.75)), float(0.0));
    const hexField = hex.mul(U.hexOpacity).mul(U.showHex).mul(fresnel.mul(0.7).add(0.3)).add(flash.mul(U.showHex));
    const field = hexField.add(fresnel.mul(0.4)).add(rimGlow).add(film).mul(lit).toVar();
    field.addAssign(sweepBand.mul(1.9));
    field.addAssign(rim.mul(smoothstep(0.86, 1.04, U.sweep)).mul(smoothstep(1.04, 1.5, U.sweep).oneMinus()).mul(2.4));
    field.mulAssign(U.fieldVisibility);

    const warn = rimGlow.mul(U.lowPower).mul(sin(t.mul(4.6)).mul(0.45).add(0.55)).mul(0.30).toVar();

    const local = hitP.mul(fresnel.mul(0.85).add(0.42).add(flowNoise.mul(0.35)).add(rim.mul(0.5)))
      .add(coreC.mul(1.9)).add(ringCC.mul(0.8)).mul(U.hitIntensity).toVar();

    const intensity = field.add(warn).add(local).add(U.energyShot.mul(0.5));
    const shieldColor = lColor.mul(intensity).mul(2.0).toVar();
    shieldColor.addAssign(lColor.mul(flowNoise.mul(fresnel.add(rim.mul(0.6)).add(U.filmStrength)).mul(U.flowIntensity).mul(lit).mul(U.fieldVisibility)));
    shieldColor.addAssign(vec3(coreC.mul(0.75)));

    const edgeVis = max(U.fieldVisibility, U.isBreaking);
    const edgeColor = mix(U.noiseEdgeColor, lColor, U.life.oneMinus());
    const edgeGlow = edgeColor.mul(revealEdge).mul(U.noiseEdgeIntensity).mul(edgeVis);

    const alpha = saturate(field.add(warn).mul(U.opacity)
      .add(local.mul(U.hitOpacity))
      .add(U.energyShot.mul(0.35))
      .add(revealEdge.mul(U.noiseEdgeIntensity).mul(edgeVis))).mul(revealMask).toVar();
    If(alpha.lessThan(0.002), () => { Discard(); });
    return vec4(max(shieldColor.mul(revealMask).add(edgeGlow), vec3(0.0)), alpha);
  })();
  return m;
}
