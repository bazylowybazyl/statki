// src/3d/shield3D.tsl.js
//
// Materiały tarcz w TSL (port WebGPU, zadanie 14; docs/webgpu/PLAN.md §3).
// Odpowiednik dawnego GLSL z shield3D.js: kopuła „sfera” (bańka droideki — stacje,
// budowle, myśliwce) i tarcza-obrys kadłuba („hull”). Obraz 1:1 z WebGL — te same
// wzory w tej samej kolejności działań; odstępstwa tylko tam, gdzie WebGL dawał NaN
// (podstawa potęgi fresnela obcięta do ≥ 0 — reguła agents.md, MSAA + HalfFloat).
//
// GRAF NA WARIANT, WARTOŚCI NA OBIEKT. W WebGL każda tarcza miała własny
// ShaderMaterial (program z cache po źródle). W WebGPU nowy graf węzłów na encję
// to pełny NodeBuilder na CPU przy każdym spawnie. Tu:
//  - graf budowany RAZ na wariant (sfera / obrys); każda tarcza dostaje lekki
//    ShieldNodeMaterial z TYMI SAMYMI węzłami — ten sam klucz programu, jeden
//    NodeBuilder i jeden pipeline na wariant (licznik: SHIELD_TSL_STATS.builds);
//  - wartości per tarcza siedzą w `material.uniforms` (zwykłe obiekty `{ value }`
//    jak w ShaderMaterial — kod aktualizacji w shield3D.js się nie zmienia), a węzły
//    grafu czytają je przy rysowaniu obiektu: `uniform(...).onObjectUpdate(({ material })
//    => material.uniforms.X.value)` (grupa „object” — three klonuje jej wiązania na
//    każdy obiekt renderu, NodeBuilderState.createBindings);
//  - TABLICA TRAFIEŃ (24 × pozycja + czas) = JEDNA uniformArray vec4 (xyz, czas),
//    pakowana per obiekt w onObjectUpdate. Sprawdzone w źródle three r183: tablica
//    z grupy „object” ma własny bufor GPU na obiekt renderu (klon NodeUniformBuffer,
//    zapis writeBuffer przy każdym rysowaniu — Bindings._update, grupa „object”
//    zawsze aktualna), ALE jej domyślne pakowanie (UniformArrayNode.update) jest typu
//    RENDER — raz na render(), więc bez onObjectUpdate wszystkie tarcze passa
//    dostałyby trafienia jednej z nich. Na GPU: scripts/webgpu/tarcze-parzystosc.mjs.
//
// Zasady TSL portu (PLAN §3): funkcje z setLayout są CZYSTE (tu tylko szum simplex);
// pomocniki zależne od uniformów wklejane bez layoutu; smoothstep z odwróconymi
// krawędziami liczony wzorem (WGSL nie gwarantuje builtinu przy low ≥ high); pętla
// po trafieniach = Loop(24), nie 24 kopie.
//
// AGENT: szum simplex 3D (Ashima) ma też warpPlume3D.js (zadanie 13) — kandydat do
// wspólnego pomocnika w src/3d/tsl/, gdy oba moduły będą na main.
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, Discard, float, vec2, vec3, vec4, uniform, uniformArray, attribute, varying,
  positionLocal, normalLocal, modelViewMatrix, transformNormalToView,
  abs, acos, clamp, dot, exp, floor, fract, length, max, min, mix, normalize, pow, select, sin, smoothstep, step
} from 'three/tsl';

export const SHIELD_MAX_HITS = 24;

// Liczniki (spawn floty, rozgrzewka): `materials` — lekkie materiały per tarcza
// (tanie), `builds` — budowy NodeBuildera (drogie; ma ich być tyle co wariantów).
export const SHIELD_TSL_STATS = {
  materials: { sphere: 0, hull: 0 },
  builds: { sphere: 0, hull: 0 }
};

export const SHIELD_MATERIAL_NAMES = Object.freeze({ sphere: 'ShieldSphere', hull: 'ShieldHull' });

// smoothstep wzorem (jak rozwija go HLSL): poprawny także dla e0 > e1
// (smoothstep(radius, 0, dist) — łaty i pierścienie trafień, fala rozruchu).
const smoothRev = (e0, e1, x) => {
  const t = clamp(float(x).sub(e0).div(float(e1).sub(e0)), 0.0, 1.0);
  return t.mul(t).mul(float(3.0).sub(t.mul(2.0)));
};

// ── Szum simplex 3D (Ashima / Gustavson) — funkcja czysta, jedna w WGSL ─────────
const mod289 = (x) => x.sub(floor(x.mul(1.0 / 289.0)).mul(289.0));
const permute = (x) => mod289(x.mul(34.0).add(1.0).mul(x));
const taylorInvSqrt = (r) => float(1.79284291400159).sub(r.mul(0.85373472095314));

export const shieldSnoise = /*@__PURE__*/ Fn(([v]) => {
  const C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const D = vec4(0.0, 0.5, 1.0, 2.0);
  const i = floor(v.add(dot(v, C.yyy))).toVar();
  const x0 = v.sub(i).add(dot(i, C.xxx)).toVar();
  const g = step(x0.yzx, x0.xyz).toVar();
  const l = float(1.0).sub(g).toVar();
  const i1 = min(g.xyz, l.zxy).toVar();
  const i2 = max(g.xyz, l.zxy).toVar();
  const x1 = x0.sub(i1).add(C.xxx).toVar();
  const x2 = x0.sub(i2).add(C.yyy).toVar();
  const x3 = x0.sub(D.yyy).toVar();
  i.assign(mod289(i));
  const pz = permute(i.z.add(vec4(0.0, i1.z, i2.z, 1.0)));
  const py = permute(pz.add(i.y).add(vec4(0.0, i1.y, i2.y, 1.0)));
  const p = permute(py.add(i.x).add(vec4(0.0, i1.x, i2.x, 1.0))).toVar();
  const n_ = float(0.142857142857);
  const ns = n_.mul(D.wyz).sub(D.xzx).toVar();
  const j = p.sub(floor(p.mul(ns.z).mul(ns.z)).mul(49.0)).toVar();
  const x_ = floor(j.mul(ns.z)).toVar();
  const y_ = floor(j.sub(x_.mul(7.0))).toVar();
  const x = x_.mul(ns.x).add(ns.yyyy).toVar();
  const y = y_.mul(ns.x).add(ns.yyyy).toVar();
  const h = float(1.0).sub(abs(x)).sub(abs(y)).toVar();
  const b0 = vec4(x.xy, y.xy).toVar();
  const b1 = vec4(x.zw, y.zw).toVar();
  const s0 = floor(b0).mul(2.0).add(1.0);
  const s1 = floor(b1).mul(2.0).add(1.0);
  const sh = step(h, vec4(0.0)).negate().toVar();
  const a0 = b0.xzyw.add(s0.xzyw.mul(sh.xxyy)).toVar();
  const a1 = b1.xzyw.add(s1.xzyw.mul(sh.zzww)).toVar();
  const p0 = vec3(a0.xy, h.x).toVar();
  const p1 = vec3(a0.zw, h.y).toVar();
  const p2 = vec3(a1.xy, h.z).toVar();
  const p3 = vec3(a1.zw, h.w).toVar();
  const norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))).toVar();
  p0.mulAssign(norm.x);
  p1.mulAssign(norm.y);
  p2.mulAssign(norm.z);
  p3.mulAssign(norm.w);
  const m = max(float(0.6).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), 0.0).toVar();
  m.assign(m.mul(m));
  return float(42.0).mul(dot(m.mul(m), vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))));
}).setLayout({ name: 'shieldSnoise', type: 'float', inputs: [{ name: 'v', type: 'vec3' }] });

// ── Wspólne kawałki (wklejane — zależą od uniformów) ────────────────────────────
// lifeColor: uColor (pełne HP) → czerwień (puste). Ta sama funkcja liczy barwę
// cząstek trafień na CPU (resolveShieldFxColor w shield3D.js).
const lifeColor = (life, color) => mix(vec3(1.0, 0.08, 0.04), color, life);

// Siatka heksów: wzór krawędzi i id komórki z tych samych pośrednich wartości.
function hexCell(p0, U) {
  const p = p0.mul(U.uHexScale);
  const s = vec2(1.0, 1.7320508);
  const hC = floor(vec4(p, p.sub(vec2(0.5, 1.0))).div(s.xyxy)).add(0.5);
  const h = vec4(p.sub(hC.xy.mul(s)), p.sub(hC.zw.add(0.5).mul(s)));
  const nearA = dot(h.xy, h.xy).lessThan(dot(h.zw, h.zw));
  const cell = abs(select(nearA, h.xy, h.zw));
  const d = max(dot(cell, s.mul(0.5)), cell.x);
  const pattern = smoothstep(float(0.5).sub(U.uEdgeWidth), 0.5, d);
  const id = select(nearA, hC.xy, hC.zw.add(0.5));
  return { pattern, id };
}

function cellFlash(cellId, U) {
  const rnd = fract(sin(dot(cellId, vec2(127.1, 311.7))).mul(43758.5453));
  const phase = rnd.mul(6.2831);
  const speed = float(0.5).add(rnd.mul(1.5));
  return smoothstep(0.6, 1.0, sin(U.uTime.mul(U.uFlashSpeed).mul(speed).add(phase))).mul(U.uFlashIntensity);
}

// Odsłanianie / rozpad (szum + pęknięcie). Zwraca maskę (po discard) i pas krawędzi.
function revealTerms(vObjPos, U) {
  const noise = shieldSnoise(vObjPos.mul(U.uNoiseScale)).mul(0.5).add(0.5).toVar();
  const effectiveReveal = float(U.uReveal).toVar();
  If(U.uIsBreaking.greaterThan(0.5), () => {
    // Pęknięcie: szum „glitch” podbija próg odsłaniania.
    const glitch = fract(sin(dot(vObjPos.xy, vec2(12.9898, 78.233)).add(U.uTime.mul(30.0))).mul(43758.5453));
    effectiveReveal.assign(max(effectiveReveal, glitch.mul(0.3)));
  });
  const revealMask = smoothstep(effectiveReveal.sub(U.uNoiseEdgeWidth), effectiveReveal, noise).toVar();
  Discard(revealMask.lessThan(0.001));
  const innerFade = mix(0.98, 0.15, U.uNoiseEdgeSmoothness);
  const edgeLow = smoothstep(effectiveReveal.sub(U.uNoiseEdgeWidth), effectiveReveal.sub(U.uNoiseEdgeWidth.mul(innerFade)), noise);
  const edgeHigh = smoothstep(effectiveReveal.sub(U.uNoiseEdgeWidth.mul(0.15)), effectiveReveal, noise);
  const revealEdge = edgeLow.mul(float(1.0).sub(edgeHigh)).toVar();
  return { revealMask, revealEdge };
}

function flowNoiseOf(vObjPos, U) {
  const t = U.uTime.mul(U.uFlowSpeed).toVar();
  const fn1 = shieldSnoise(vObjPos.mul(U.uFlowScale).add(vec3(t, t.mul(0.6), t.mul(0.4))));
  const fn2 = shieldSnoise(vObjPos.mul(U.uFlowScale).mul(2.1).add(vec3(t.mul(-0.5), t.mul(0.9), t.mul(0.3))));
  return fn1.mul(0.6).add(fn2.mul(0.4)).mul(0.5).add(0.5).toVar();
}

// Pęknięcie: barwa skacze w czerwień / biel (uIsBreaking > 0.5).
function shieldLifeColor(U) {
  const lColor = lifeColor(U.uLife, U.uColor).toVar();
  If(U.uIsBreaking.greaterThan(0.5), () => {
    const bFlash = fract(U.uTime.mul(25.0));
    lColor.assign(mix(vec3(1.0, 0.15, 0.1), vec3(2.0), bFlash.mul(0.4)));
  });
  return lColor;
}

// ── Uniformy per obiekt ──────────────────────────────────────────────────────────
// Klucze czytane przez graf (reszta `material.uniforms` — np. uFadeStart sfery,
// tablice trafień — to dane JS). Typ: 'float' albo 'color'.
const COMMON_KEYS = {
  uTime: 'float', uColor: 'color', uLife: 'float', uReveal: 'float',
  uHexScale: 'float', uHexOpacity: 'float', uShowHex: 'float', uEdgeWidth: 'float',
  uFresnelPower: 'float', uFresnelStrength: 'float', uOpacity: 'float',
  uFlashSpeed: 'float', uFlashIntensity: 'float',
  uNoiseScale: 'float', uNoiseEdgeColor: 'color', uNoiseEdgeWidth: 'float', uNoiseEdgeIntensity: 'float', uNoiseEdgeSmoothness: 'float',
  uFlowScale: 'float', uFlowSpeed: 'float', uFlowIntensity: 'float',
  uHitRingSpeed: 'float', uHitRingWidth: 'float', uHitMaxRadius: 'float', uHitDuration: 'float',
  uHitIntensity: 'float', uHitImpactRadius: 'float',
  uIsBreaking: 'float', uEnergyShot: 'float'
};
const HULL_KEYS = {
  ...COMMON_KEYS,
  uRimStart: 'float', uRimIntensity: 'float', uFilmStrength: 'float',
  uFieldVisibility: 'float', uSweep: 'float', uSweepWidth: 'float', uLowPower: 'float',
  uHitOpacity: 'float', uHitGrow: 'float', uHitDecay: 'float', uHitCoreLife: 'float'
};
export const SHIELD_GRAPH_KEYS = Object.freeze({ sphere: Object.keys(COMMON_KEYS), hull: Object.keys(HULL_KEYS) });

function perObjectUniforms(keys) {
  const U = {};
  for (const [key, type] of Object.entries(keys)) {
    const init = type === 'color' ? new THREE.Color() : 0;
    U[key] = uniform(init, type).onObjectUpdate(({ material }) => material.uniforms[key].value);
  }
  return U;
}

// Tablica trafień: slot i = (pozycja xyz w klatce kopuły, czas startu). Dane gry
// zostają w material.uniforms.uHitPos / uHitTime (Vector3[24], liczby[24]) — pakowanie
// przy rysowaniu obiektu (typ OBJECT zamiast RENDER UniformArrayNode, patrz nagłówek).
function packHitsForObject(frame, node) {
  const out = node.value;
  const u = frame?.material?.uniforms;
  if (!u || !out || typeof out.length !== 'number') return undefined; // setup (bez klatki)
  const pos = u.uHitPos.value;
  const times = u.uHitTime.value;
  for (let i = 0; i < SHIELD_MAX_HITS; i++) {
    const p = pos[i];
    const o = i * 4;
    out[o] = p.x;
    out[o + 1] = p.y;
    out[o + 2] = p.z;
    out[o + 3] = times[i];
  }
  return undefined;
}

function perObjectHits() {
  const init = Array.from({ length: SHIELD_MAX_HITS }, () => new THREE.Vector4(0, 0, 0, -999));
  const node = uniformArray(init, 'vec4');
  node.onObjectUpdate(packHitsForObject);
  return node;
}

// ── Graf: kolista bańka (sfera) ──────────────────────────────────────────────────
function buildSphereGraph() {
  const U = perObjectUniforms(COMMON_KEYS);
  const hits = perObjectHits();
  const vObjPos = varying(positionLocal, 'vShieldObjPos');
  const vNormal = varying(transformNormalToView(normalLocal), 'vShieldNormal');
  const vViewDir = varying(normalize(modelViewMatrix.mul(vec4(positionLocal, 1.0)).xyz.negate()), 'vShieldViewDir');

  const fragment = Fn(() => {
    const { revealMask, revealEdge } = revealTerms(vObjPos, U);

    // Fresnel (podstawa ≥ 0: interpolowana normalna nie jest jednostkowa — NaN z pow).
    const fresnel = pow(max(float(1.0).sub(dot(vNormal, vViewDir)), 0.0), U.uFresnelPower).mul(U.uFresnelStrength).toVar();
    const flowNoise = flowNoiseOf(vObjPos, U);

    // Heksy: wybór ściany sześcianu + wygaszenie szwów.
    const normPos = normalize(vObjPos).toVar();
    const absN = abs(normPos).toVar();
    const dominance = max(absN.x, max(absN.y, absN.z));
    const hexFade = smoothstep(0.65, 0.85, dominance).toVar();
    const faceX = absN.x.greaterThanEqual(absN.y).and(absN.x.greaterThanEqual(absN.z));
    const faceY = absN.y.greaterThanEqual(absN.z);
    const faceUV = select(faceX, vObjPos.yz, select(faceY, vObjPos.xz, vObjPos.xy)).toVar();
    const hexInfo = hexCell(faceUV, U);
    const hex = hexInfo.pattern.mul(hexFade);
    const flash = cellFlash(hexInfo.id, U).mul(hexFade);

    // Bufor trafień: pierścień po geodezyjnej + podświetlenie heksów przy punkcie.
    const ringContrib = float(0.0).toVar();
    const hexHitBoost = float(0.0).toVar();
    Loop(SHIELD_MAX_HITS, ({ i }) => {
      const hit = hits.element(i);
      const ht = hit.w;
      const elapsed = U.uTime.sub(ht).toVar();
      const isActive = step(0.0, ht).mul(step(0.0, elapsed)).mul(step(elapsed, U.uHitDuration)).toVar();
      const dist = acos(clamp(dot(normPos, normalize(hit.xyz)), -1.0, 1.0)).toVar();
      const ringR = min(elapsed.mul(U.uHitRingSpeed), U.uHitMaxRadius).toVar();
      const noiseD = shieldSnoise(normPos.mul(5.0).add(vec3(elapsed.mul(2.0)))).mul(0.05);
      const ring = smoothRev(U.uHitRingWidth, 0.0, abs(dist.add(noiseD).sub(ringR)));
      const fade = float(1.0).sub(smoothstep(U.uHitDuration.mul(0.5), U.uHitDuration, elapsed));
      const radialFade = float(1.0).sub(smoothstep(U.uHitMaxRadius.mul(0.75), U.uHitMaxRadius, ringR));
      ringContrib.addAssign(ring.mul(fade).mul(radialFade).mul(isActive));
      const zone = smoothRev(U.uHitImpactRadius, 0.0, dist);
      const zoneFade = float(1.0).sub(smoothstep(0.0, U.uHitDuration.mul(0.35), elapsed));
      hexHitBoost.addAssign(zone.mul(zoneFade).mul(isActive));
    });
    ringContrib.assign(min(ringContrib, 2.0));
    hexHitBoost.assign(min(hexHitBoost, 1.0));

    const energyBoost = U.uEnergyShot.mul(0.5);
    const lColor = shieldLifeColor(U);

    const effectiveHexOpacity = U.uHexOpacity.add(hexHitBoost.mul(U.uHitIntensity)).mul(U.uShowHex);
    const intensity = hex.mul(effectiveHexOpacity).mul(float(0.3).add(fresnel.mul(0.7)))
      .add(fresnel.mul(0.4)).add(flash.mul(U.uShowHex)).toVar();
    intensity.addAssign(energyBoost);

    const shieldColor = lColor.mul(intensity).mul(2.0).toVar();
    shieldColor.addAssign(lColor.mul(flowNoise.mul(fresnel).mul(U.uFlowIntensity)));
    shieldColor.addAssign(lColor.mul(ringContrib).mul(U.uHitIntensity));

    const edgeColor = mix(U.uNoiseEdgeColor, lColor, float(1.0).sub(U.uLife));
    const edgeGlow = edgeColor.mul(revealEdge).mul(U.uNoiseEdgeIntensity);

    const alpha = clamp(intensity.mul(U.uOpacity).mul(revealMask).add(revealEdge.mul(U.uNoiseEdgeIntensity)), 0.0, 1.0);

    // Pełna okrągła tarcza w 3D — bez wycinania.
    return vec4(shieldColor.add(edgeGlow), alpha);
  })();

  return { fragment, uniforms: U, hits };
}

// ── Graf: tarcza-obrys kadłuba ──────────────────────────────────────────────────
// Geometria w lokalnej klatce kadłuba (x w prawo, y = −y siatki, z w górę), jednostki
// świata. Trafienia liczone dystansem w XY, obramówka z fresnela i pasa krawędzi (aEdge).
function buildHullGraph() {
  const U = perObjectUniforms(HULL_KEYS);
  const hits = perObjectHits();
  const vObjPos = varying(positionLocal, 'vShieldObjPos');
  const vNormal = varying(transformNormalToView(normalLocal), 'vShieldNormal');
  const vViewDir = varying(normalize(modelViewMatrix.mul(vec4(positionLocal, 1.0)).xyz.negate()), 'vShieldViewDir');
  const vEdge = varying(attribute('aEdge', 'float'), 'vShieldEdge');

  const fragment = Fn(() => {
    const { revealMask, revealEdge } = revealTerms(vObjPos, U);

    // Fresnel: kopuła płaska na środku (przezroczysta z góry), przy krawędzi normalne
    // kładą się poziomo → świecący obrys. Podstawa ≥ 0 (NaN z pow przy MSAA).
    const fresnel = pow(max(float(1.0).sub(abs(dot(vNormal, vViewDir))), 0.0), U.uFresnelPower).mul(U.uFresnelStrength).toVar();
    const flowNoise = flowNoiseOf(vObjPos, U);

    // Heksy w lokalnej płaszczyźnie kadłuba.
    const faceUV = vObjPos.xy;
    const hexInfo = hexCell(faceUV, U);
    const hex = hexInfo.pattern;
    const flash = cellFlash(hexInfo.id, U);

    // Ziarno pola: JEDEN szum na fragment deformuje krawędzie wszystkich łat.
    const fieldGrain = shieldSnoise(vObjPos.mul(U.uNoiseScale.mul(3.0)).add(vec3(U.uTime.mul(0.7)))).toVar();

    // Trafienia: miękka łata wokół punktu, jasne jądro, pierścień przy trafieniu.
    const hitPatch = float(0.0).toVar();
    const core = float(0.0).toVar();
    const ringContrib = float(0.0).toVar();
    Loop(SHIELD_MAX_HITS, ({ i }) => {
      const hit = hits.element(i);
      const ht = hit.w;
      const elapsed = U.uTime.sub(ht).toVar();
      const isActive = step(0.0, ht).mul(step(0.0, elapsed)).mul(step(elapsed, U.uHitDuration)).toVar();
      const dist = length(vObjPos.xy.sub(hit.xy)).toVar();

      // Łata rozpycha się w pierwszych ~100 ms, potem gaśnie wykładniczo.
      const grow = smoothstep(0.0, U.uHitGrow, elapsed);
      const radius = U.uHitImpactRadius.mul(float(0.42).add(grow.mul(0.58))).toVar();
      const decay = exp(elapsed.negate().mul(U.uHitDecay))
        .mul(float(1.0).sub(smoothstep(U.uHitDuration.mul(0.7), U.uHitDuration, elapsed))).toVar();

      const d = dist.add(fieldGrain.mul(radius).mul(0.17)).toVar();
      const fall = smoothRev(radius, radius.mul(0.10), d).toVar();
      hitPatch.addAssign(fall.mul(fall).mul(decay).mul(isActive));

      // Jądro — krótki, bardzo jasny punkt styku.
      core.addAssign(smoothRev(radius.mul(0.30), 0.0, dist)
        .mul(float(1.0).sub(smoothstep(0.0, U.uHitCoreLife, elapsed))).mul(isActive));

      // Pierścień zamknięty w okolicy trafienia, nie przez całą tarczę.
      const ringR = elapsed.mul(U.uHitRingSpeed).toVar();
      const ring = smoothRev(U.uHitRingWidth, 0.0, abs(d.sub(ringR)));
      ringContrib.addAssign(ring.mul(float(1.0).sub(smoothstep(U.uHitMaxRadius.mul(0.55), U.uHitMaxRadius, ringR))).mul(decay).mul(isActive));
    });
    hitPatch.assign(min(hitPatch, 1.6));
    core.assign(min(core, 1.0));
    ringContrib.assign(min(ringContrib, 1.5));

    const lColor = shieldLifeColor(U);

    // Obramówka: jasny pas przy krawędzi obrysu.
    const rim = smoothstep(U.uRimStart, 1.0, vEdge).toVar();
    const rimGlow = rim.mul(rim).mul(U.uRimIntensity).toVar();

    // Film energetyczny na całej czaszy.
    const film = U.uFilmStrength.mul(float(0.55).add(flowNoise.mul(0.45)));

    // WARSTWA POLA — widoczna tylko przy rozruchu, gaszeniu i pęknięciu.
    // uSweep < 0: brak fali, całe pole zapalone (pęknięcie); uSweep ≥ 0: zapalone to,
    // co leży WEWNĄTRZ czoła (rozruch 0 → 1,2 na zewnątrz, gaszenie z powrotem).
    const lit = float(1.0).toVar();
    const sweepBand = float(0.0).toVar();
    If(U.uSweep.greaterThanEqual(0.0), () => {
      lit.assign(smoothRev(U.uSweep.add(U.uSweepWidth), U.uSweep.sub(U.uSweepWidth), vEdge));
      sweepBand.assign(smoothRev(U.uSweepWidth, 0.0, abs(vEdge.sub(U.uSweep))).mul(float(0.75).add(flowNoise.mul(0.25))));
    });

    const hexField = hex.mul(U.uHexOpacity).mul(U.uShowHex).mul(float(0.3).add(fresnel.mul(0.7))).add(flash.mul(U.uShowHex));
    const field = hexField.add(fresnel.mul(0.4)).add(rimGlow).add(film).mul(lit).toVar();
    field.addAssign(sweepBand.mul(1.9));
    // Domknięcie: czoło dobija do obrysu i całość błyska krawędzią.
    field.addAssign(rim.mul(smoothstep(0.86, 1.04, U.uSweep)).mul(float(1.0).sub(smoothstep(1.04, 1.5, U.uSweep))).mul(2.4));
    field.mulAssign(U.uFieldVisibility);

    // Ostrzeżenie: ledwo widoczny, pulsujący obrys przy niskim HP.
    const warn = rimGlow.mul(U.uLowPower).mul(float(0.55).add(sin(U.uTime.mul(4.6)).mul(0.45))).mul(0.30).toVar();

    // WARSTWA TRAFIENIA — jedyne światło podczas normalnej pracy.
    const local = hitPatch.mul(float(0.42).add(fresnel.mul(0.85)).add(flowNoise.mul(0.35)).add(rim.mul(0.5)))
      .add(core.mul(1.9))
      .add(ringContrib.mul(0.8)).toVar();
    local.mulAssign(U.uHitIntensity);

    const intensity = field.add(warn).add(local).add(U.uEnergyShot.mul(0.5));

    const shieldColor = lColor.mul(intensity).mul(2.0).toVar();
    shieldColor.addAssign(lColor.mul(flowNoise.mul(fresnel.add(rim.mul(0.6)).add(U.uFilmStrength)).mul(U.uFlowIntensity).mul(lit).mul(U.uFieldVisibility)));
    shieldColor.addAssign(vec3(1.0).mul(core).mul(0.75)); // jądro trafienia wybielone

    const edgeVis = max(U.uFieldVisibility, U.uIsBreaking);
    const edgeColor = mix(U.uNoiseEdgeColor, lColor, float(1.0).sub(U.uLife));
    const edgeGlow = edgeColor.mul(revealEdge).mul(U.uNoiseEdgeIntensity).mul(edgeVis);

    // Wystrzał energii zapala całą tarczę — to zdarzenie, więc wchodzi do alfy
    // własnym kanałem (baza pola jest wtedy zerowa).
    const alpha = clamp(field.add(warn).mul(U.uOpacity)
      .add(local.mul(U.uHitOpacity))
      .add(U.uEnergyShot.mul(0.35))
      .add(revealEdge.mul(U.uNoiseEdgeIntensity).mul(edgeVis)), 0.0, 1.0).toVar();
    alpha.mulAssign(revealMask);
    Discard(alpha.lessThan(0.002));

    return vec4(shieldColor.mul(revealMask).add(edgeGlow), alpha);
  })();

  return { fragment, uniforms: U, hits };
}

const GRAPHS = { sphere: null, hull: null };

/** Graf wariantu ('sphere' | 'hull') — budowany raz, wspólny dla wszystkich tarcz. */
export function getShieldGraph(variant) {
  const key = variant === 'sphere' ? 'sphere' : 'hull';
  if (!GRAPHS[key]) GRAPHS[key] = key === 'sphere' ? buildSphereGraph() : buildHullGraph();
  return GRAPHS[key];
}

/**
 * Lekki materiał tarczy: węzły wspólne dla wariantu, wartości w `uniforms`
 * (obiekty `{ value }` — jak w ShaderMaterial). Stan renderu jak w WebGL:
 * addytywny, bez zapisu głębi, test głębi względem passa ortho, FrontSide.
 */
export class ShieldNodeMaterial extends THREE.NodeMaterial {
  static get type() {
    return 'ShieldNodeMaterial';
  }

  constructor(variant, uniforms) {
    super();
    this.isShieldNodeMaterial = true;
    this._shieldVariant = variant === 'sphere' ? 'sphere' : 'hull';
    this.name = SHIELD_MATERIAL_NAMES[this._shieldVariant];
    this.uniforms = uniforms;
    this.fragmentNode = getShieldGraph(this._shieldVariant).fragment;
    this.transparent = true;
    this.depthWrite = false;
    this.side = THREE.FrontSide;
    this.blending = THREE.AdditiveBlending;
    this.lights = false;
    this.fog = false;
    SHIELD_TSL_STATS.materials[this._shieldVariant]++;
  }

  setup(builder) {
    // Wywoływane tylko przy budowie NodeBuildera (raz na klucz programu).
    SHIELD_TSL_STATS.builds[this._shieldVariant]++;
    return super.setup(builder);
  }
}

/** Materiał wariantu z gotowymi wartościami (`{ uFoo: { value } }`). */
export function createShieldNodeMaterial(variant, uniforms) {
  return new ShieldNodeMaterial(variant, uniforms);
}
