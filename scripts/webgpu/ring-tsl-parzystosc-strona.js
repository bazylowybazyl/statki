// Parzystość biblioteki ringu GLSL ↔ TSL (port WebGPU, zadanie 06): te same
// wejścia (tekstury RGBA32F, texelFetch / textureLoad) i te same wartości uniformów
// liczone raz przez GLSL z haloRingGLSL.js (surowy kontekst WebGL2 — tylko ten
// test; gra nie ma już WebGL) i raz przez funkcje TSL z haloRingTSL.js
// (WebGPURenderer). Wynik: window.__parz (różnice na funkcję).
// Uruchamia scripts/webgpu/ring-tsl-parzystosc.mjs. Po usunięciu haloRingGLSL.js
// (zadanie 10) strona może porównywać z zapisanym wynikiem GLSL (--zapisz-glsl).
// Zadanie 07: zestaw przemysłowy (haloRingIndustryKit.js) — GLSL (HALO_GLSL_INDKIT) ↔ TSL
// i osobno wynik TSL na GPU ↔ bliźniak JS (indKitPart): state.mirror.
import * as THREE from 'three/webgpu';
import { Fn, float, int, ivec2, vec2, vec3, vec4, texture, textureLoad, screenCoordinate, normalize, length } from 'three/tsl';
import {
  HALO_GLSL_AIR, HALO_GLSL_COMMON, HALO_GLSL_FG, HALO_GLSL_LIGHT, HALO_GLSL_NOISE, HALO_GLSL_PORTSITES,
  HALO_GLSL_RTE, HALO_GLSL_STORM, HALO_GLSL_TRANSIT
} from '../../src/3d/haloRing/haloRingGLSL.js';
import {
  haloRingTSL, haloHashI, haloHash12, haloHash13, haloHash22, haloHash33, haloGnoise3, haloGnoise2P, haloWorleyP, haloLuma, haloSrgbToLinear, haloIGN
} from '../../src/3d/haloRing/haloRingTSL.js';
import { createHaloRingLayout } from '../../src/3d/haloRing/haloRingLayout.js';
import { createHaloUniforms } from '../../src/3d/haloRing/haloRingUniforms.js';
import { RING_PLANET_WORLD_RADII } from '../../src/3d/ringScale.js';
import { HALO_RING_PLANETS } from '../../src/game/haloRingPlanets.js';
import { mulberry32 } from '../../src/3d/haloRing/haloRingLayout.js';
import { HALO_GLSL_INDKIT, IND_PARTS, haloIndKitTSL, indKitPart } from '../../src/3d/haloRing/haloRingIndustryKit.js';
import { haloFusedMulAddInt } from '../../src/3d/haloRing/haloRingTerrain.js';

const W = 64;
const H = 64;
const N = W * H;
const state = { done: false, error: null, results: {}, meta: {} };
window.__parz = state;
const logEl = document.getElementById('log');
const log = (s) => { logEl.textContent += '\n' + s; };

// ---------------------------------------------------------------------------
// Uniformy: ring Ziemi, kamera i słońce jak w klatce gry przy porcie, burza i wycięcia włączone.
const planet = new URLSearchParams(location.search).get('planet') || 'earth';
const layout = createHaloRingLayout({ planetRadius: RING_PLANET_WORLD_RADII[planet], seed: HALO_RING_PLANETS[planet].seed, profile: planet });
const u = createHaloUniforms(layout);
const TAU = Math.PI * 2;
{
  const az = 0.7;
  const el = 49 * Math.PI / 180;
  u.uSunDir.value.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)).normalize();
  const cam = new THREE.Vector3(Math.cos(0.8) * (layout.radii.rim + 2500), Math.sin(0.8) * (layout.radii.rim + 2500), 1800);
  u.uCamLocal.value.copy(cam);
  const fm = layout.radii.floorMid;
  const thetaRef = Math.atan2(cam.y, cam.x);
  u.uRefRel.value.set(fm * Math.cos(thetaRef) - cam.x, fm * Math.sin(thetaRef) - cam.y, -cam.z);
  u.uRefBasis.value.set(Math.cos(thetaRef), Math.sin(thetaRef), thetaRef, thetaRef * fm);
  u.uTime.value = 12.345;
  u.uStorm.value.set(1.0, 0.6, 900, 1.3);
  u.uFgFade.value.set(0.8, 1, 500, layout.radii.floorTop);
  u.uCutA.value[0].set(cam.x, cam.y, 0.6, 0.8);
  u.uCutB.value[0].set(1400, 900, 120, 1);
  u.uCutA.value[1].set(cam.x + 3000, cam.y - 2000, 1, 0);
  u.uCutB.value[1].set(1350, 1350, 80, 0.7);
  // zestaw przemysłowy: progi sięgające wszystkich 8 rodzajów zakładów (także radiatorów)
  u.uIndKitCdf0.value.set(0.1, 0.2, 0.3, 0.4);
  u.uIndKitCdf1.value.set(0.5, 0.6, 0.7, 1.01);
}
const KIT_CDF = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1.01];

// Wejścia: punkty wokół ringu i planety, kierunki, parametry skalarne.
const rand = mulberry32(0x7a17);
const in0 = new Float32Array(N * 4);
const in1 = new Float32Array(N * 4);
const in2 = new Float32Array(N * 4);
{
  const R = layout.radii;
  const Z = layout.z;
  const unit = (out, o) => {
    let x; let y; let z; let l;
    do { x = rand() * 2 - 1; y = rand() * 2 - 1; z = rand() * 2 - 1; l = Math.hypot(x, y, z); } while (l < 0.05 || l > 1);
    out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l;
  };
  for (let i = 0; i < N; i++) {
    const o = i * 4;
    const far = i % 8 === 7;
    const r = far ? layout.planetRadius * (0.6 + rand() * 1.4) : R.back - 2500 + rand() * (R.rim - R.back + 6000);
    const th = rand() * TAU;
    in0[o] = Math.cos(th) * r;
    in0[o + 1] = Math.sin(th) * r;
    in0[o + 2] = far ? (rand() - 0.5) * 80000 : Z.bottom - 1500 + rand() * (Z.roof - Z.bottom + 3000);
    in0[o + 3] = rand();                                  // jitter
    unit(in1, o);
    if (i % 3 === 0) { in1[o] = u.uSunDir.value.x; in1[o + 1] = u.uSunDir.value.y; in1[o + 2] = u.uSunDir.value.z; }
    in1[o + 3] = rand() * 60000;                          // t1 / tHit
    in2[o] = Math.floor(rand() * 65536);                  // całkowite (hasz)
    in2[o + 1] = Math.floor(rand() * 65536);
    in2[o + 2] = Math.floor(rand() * 64);
    in2[o + 3] = rand();
  }
}

// ---------------------------------------------------------------------------
// Testy: [nazwa, wyrażenie GLSL (a = p+jitter, b = kierunek+skalar, d = parametry), wyrażenie TSL]
const Hl = haloRingTSL(u);
const Ut = Hl.uniforms;
const Kt = haloIndKitTSL(u);
const TESTS = [
  ['hashI', 'vec4(haloHashI(d.x, d.y, d.z), 0.0, 0.0, 1.0)', (a, b, d) => vec4(haloHashI(d.x, d.y, d.z), 0.0, 0.0, 1.0)],
  ['hash12', 'vec4(haloHash12(a.xy * 0.01), haloHash13(a.xyz * 0.003), 0.0, 1.0)', (a) => vec4(haloHash12(a.xy.mul(0.01)), haloHash13(a.xyz.mul(0.003)), 0.0, 1.0)],
  ['hash22', 'vec4(haloHash22(a.xy * 0.01), haloHash22(d.xy))', (a, b, d) => vec4(haloHash22(a.xy.mul(0.01)), haloHash22(d.xy))],
  // jak w shaderach ringu: hasz z identyfikatorów komórek (liczby całkowite)
  ['hash12_int', 'vec4(haloHash12(d.xy), haloHash12(floor(d.xy / 7.0) + 3.1), haloHash13(d.xyz), 1.0)', (a, b, d) => vec4(haloHash12(d.xy), haloHash12(d.xy.div(7.0).floor().add(3.1)), haloHash13(d.xyz), 1.0)],
  ['hash33', 'vec4(haloHash33(a.xyz * 0.003), 1.0)', (a) => vec4(haloHash33(a.xyz.mul(0.003)), 1.0)],
  ['gnoise3', 'vec4(haloGnoise3(a.xyz / 300.0), haloGnoise3(a.xyz / 37.0 + 5.0), haloGnoise3(b.xyz * 11.0), 1.0)', (a, b) => vec4(haloGnoise3(a.xyz.div(300.0)), haloGnoise3(a.xyz.div(37.0).add(5.0)), haloGnoise3(b.xyz.mul(11.0)), 1.0)],
  ['gnoise2P', 'vec4(haloGnoise2P(d.xy / 4096.0 * 8.0, vec2(8.0), 1.0), haloGnoise2P(d.xy / 1024.0, vec2(64.0), 29.0), 0.0, 1.0)', (a, b, d) => vec4(haloGnoise2P(d.xy.div(4096.0).mul(8.0), vec2(8.0, 8.0), 1.0), haloGnoise2P(d.xy.div(1024.0), vec2(64.0, 64.0), 29.0), 0.0, 1.0)],
  ['worleyP', 'vec4(haloWorleyP(d.xy / 2048.0 * 32.0, vec2(32.0), 11.0), 1.0)', (a, b, d) => vec4(haloWorleyP(d.xy.div(2048.0).mul(32.0), vec2(32.0, 32.0), 11.0), 1.0)],
  ['luma_srgb', 'vec4(haloLuma(abs(b.xyz)), haloSrgbToLinear(abs(b.xyz)))', (a, b) => vec4(haloLuma(b.xyz.abs()), haloSrgbToLinear(b.xyz.abs()))],
  ['ign', 'vec4(haloIGN(d.xy * 0.01), 0.0, 0.0, 1.0)', (a, b, d) => vec4(haloIGN(d.xy.mul(0.01)), 0.0, 0.0, 1.0)],
  ['floor_alt_up', 'vec4(haloFloorRadiusAtZ(a.z), haloAltitude(a.xyz), haloUp(a.xyz).xy)', (a) => vec4(Hl.haloFloorRadiusAtZ(a.z), Hl.haloAltitude(a.xyz), Hl.haloUp(a.xyz).xy)],
  ['planetTransmit', 'vec4(haloPlanetTransmit(a.xyz, b.xyz), 1.0)', (a, b) => vec4(Hl.haloPlanetTransmit(a.xyz, b.xyz), 1.0)],
  ['ringBlock', 'vec4(haloRingBlock(a.xyz, b.xyz), haloWallPlane(a.xyz, b.xyz, uRingZ.x, 0.01), haloConeHit(a.xyz, b.xyz, b.w, 0.01), 1.0)', (a, b) => vec4(Hl.haloRingBlock(a.xyz, b.xyz), Hl.haloWallPlane(a.xyz, b.xyz, Ut.uRingZ.x, 0.01), Hl.haloConeHit(a.xyz, b.xyz, b.w, 0.01), 1.0)],
  ['sunVisibility', 'vec4(haloSunVisibility(a.xyz, b.xyz), 1.0)', (a, b) => vec4(Hl.haloSunVisibility(a.xyz, b.xyz), 1.0)],
  ['planetshine', 'vec4(haloPlanetshine(a.xyz, b.xyz), 1.0)', (a, b) => vec4(Hl.haloPlanetshine(a.xyz, b.xyz), 1.0)],
  ['skyAmbient', 'vec4(haloSkyAmbient(a.xyz, b.xyz), 1.0)', (a, b) => vec4(Hl.haloSkyAmbient(a.xyz, b.xyz), 1.0)],
  ['airEntryExit', 'vec4(haloAirEntry(uCamLocal, normalize(a.xyz - uCamLocal), length(a.xyz - uCamLocal)), haloAirExit(uCamLocal, b.xyz), haloAirDensity(a.xyz), 1.0)',
    (a, b) => vec4(Hl.haloAirEntry(Ut.uCamLocal, normalize(a.xyz.sub(Ut.uCamLocal)), length(a.xyz.sub(Ut.uCamLocal))), Hl.haloAirExit(Ut.uCamLocal, b.xyz), Hl.haloAirDensity(a.xyz), 1.0)],
  ['airIntegrate_in', 'haloAirTestIn(normalize(a.xyz - uCamLocal), b.w * 0.2, a.w)', (a, b) => vec4(Hl.haloAirIntegrate(Ut.uCamLocal, normalize(a.xyz.sub(Ut.uCamLocal)), 0.0, b.w.mul(0.2), a.w, 8).element(0), 1.0)],
  ['airIntegrate_tr', 'haloAirTestTr(normalize(a.xyz - uCamLocal), b.w * 0.2, a.w)', (a, b) => vec4(Hl.haloAirIntegrate(Ut.uCamLocal, normalize(a.xyz.sub(Ut.uCamLocal)), 0.0, b.w.mul(0.2), a.w, 8).element(1), 1.0)],
  ['applyAir', 'vec4(haloApplyAir(abs(b.xyz), a.xyz - uCamLocal, a.w), 1.0)', (a, b) => vec4(Hl.haloApplyAir(b.xyz.abs(), a.xyz.sub(Ut.uCamLocal), a.w, 8), 1.0)],
  ['skyGain', 'vec4(haloSkyGain(abs(b.xyz)), 0.0, 0.0, 1.0)', (a, b) => vec4(Hl.haloSkyGain(b.xyz.abs()), 0.0, 0.0, 1.0)],
  ['stormFlash', 'vec4(haloStormFlash(d.x * 4.0, d.y * 0.1), 0.0, 0.0, 1.0)', (a, b, d) => vec4(Hl.haloStormFlash(d.x.mul(4.0), d.y.mul(0.1)), 0.0, 0.0, 1.0)],
  ['transit_rte', 'vec4(haloInTransitCut(d.x * 4.0, (d.w - 0.5) * 2400.0) ? 1.0 : 0.0, haloRelFromPolar(d.w * 0.02 - 0.01, a.w * 300.0 - 100.0, a.z).xyz)',
    (a, b, d) => vec4(Hl.haloInTransitCut(d.x.mul(4.0), d.w.sub(0.5).mul(2400.0)).select(1.0, 0.0), Hl.haloRelFromPolar(d.w.mul(0.02).sub(0.01), a.w.mul(300.0).sub(100.0), a.z))],
  ['portSites', 'vec4(haloPortPad(d.x * 4.0, d.w * uFloorDims.y, uFloorDims.x, 0.0, 300.0), haloPortZones(d.x * 4.0, d.w * uFloorDims.y, uFloorDims.x, a.w * 400.0 - 200.0).xyw)',
    (a, b, d) => vec4(Hl.haloPortPad(d.x.mul(4.0), d.w.mul(Ut.uFloorDims.y), Ut.uFloorDims.x, 0.0, 300.0), Hl.haloPortZones(d.x.mul(4.0), d.w.mul(Ut.uFloorDims.y), Ut.uFloorDims.x, a.w.mul(400.0).sub(200.0)).xyw)],
  ['fgVisibility', 'vec4(haloFgVisibility(a.xyz), 0.0, 0.0, 1.0)', (a) => vec4(Hl.haloFgVisibility(a.xyz), 0.0, 0.0, 1.0)],
  // zestaw przemysłowy (zadanie 07): d.w = lotH, a = punkt działki, d.z = kod materiału
  ...Array.from({ length: IND_PARTS }, (_, p) => [`kitA_p${p}`, `kitA(d.w, ${p})`, (a, b, d) => Kt.indKitPart(d.w, int(p)).element(0)]),
  ...Array.from({ length: IND_PARTS }, (_, p) => [`kitB_p${p}`, `kitB(d.w, ${p})`, (a, b, d) => Kt.indKitPart(d.w, int(p)).element(1)]),
  ['kitType', 'vec4(indKitType(d.w), 0.0, 0.0, 1.0)', (a, b, d) => vec4(Kt.indKitType(d.w), 0.0, 0.0, 1.0)],
  // hasze terenu z identyfikatorów kwartałów (bid ~ 0…2000): jasność kwartału (bid·3,1 + 5 — wejście
  // NIEcałkowite; FXC liczy je jednym zaokrągleniem, teren TSL przez haloFusedMulAddInt), okna (+0,37),
  // park (+0,5), działka (bid·7 + lot + 3 — całkowite). terrainHashBidNaive: to samo mnożenie i dodawanie
  // wprost (DXC: dwa zaokrąglenia) — dla porównania
  ['terrainHashBid', 'vec4(haloHash12(floor(d.xy / 32.0) * 3.1 + 5.0), haloHash12(floor(d.xy / 32.0) + 0.37), haloHash12(floor(d.xy / 32.0) + 0.5), haloHash12(floor(d.xy / 32.0) * 7.0 + floor(d.zw * 2.0) + 3.0))',
    (a, b, d) => vec4(haloHash12(haloFusedMulAddInt(d.xy.div(32.0).floor(), 3.1, 5.0)), haloHash12(d.xy.div(32.0).floor().add(0.37)), haloHash12(d.xy.div(32.0).floor().add(0.5)),
      haloHash12(d.xy.div(32.0).floor().mul(7.0).add(d.zw.mul(2.0).floor()).add(3.0)))],
  ['terrainHashBidNaive', 'vec4(haloHash12(floor(d.xy / 32.0) * 3.1 + 5.0), 0.0, 0.0, 1.0)',
    (a, b, d) => vec4(haloHash12(d.xy.div(32.0).floor().mul(3.1).add(5.0)), 0.0, 0.0, 1.0)],
  ['kitTopColor', 'vec4(indTopColor(d.z, a.w, (a.xy / 40000.0) * 45.0, vec4(0.0, 0.0, 6.0 + a.w * 30.0, 12.0)), 1.0)',
    (a, b, d) => vec4(Kt.indTopColor(d.z, a.w, a.xy.div(40000.0).mul(45.0), vec4(0.0, 0.0, float(6.0).add(a.w.mul(30.0)), 12.0)), 1.0)],
  ['kitShadowCyl', 'vec4(indSegBox(b.xy * 30.0, b.zw * vec2(40.0, 0.001), vec2(12.0, 7.0)), indSegCircle(b.xy * 30.0, b.zx * 40.0, 9.0), indCylRadius(floor(d.z / 21.0), a.w), indCylSlope(floor(d.z / 21.0), a.w))',
    (a, b, d) => vec4(Kt.indSegBox(b.xy.mul(30.0), b.zw.mul(vec2(40.0, 0.001)), vec2(12.0, 7.0)), Kt.indSegCircle(b.xy.mul(30.0), b.zx.mul(40.0), 9.0),
      Kt.indCylRadius(d.z.div(21.0).floor(), a.w), Kt.indCylSlope(d.z.div(21.0).floor(), a.w))]
];

// ---------------------------------------------------------------------------
// GLSL: surowy WebGL2 (tylko narzędzie pomiarowe), texelFetch wejść, cel RGBA32F.
function glslRun() {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('brak WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('brak EXT_color_buffer_float');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  state.meta.glsl = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const mkTex = (data) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  };
  const tex = [mkTex(in0), mkTex(in1), mkTex(in2)];
  const out = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  const vs = '#version 300 es\nvoid main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }';
  const lib = `${HALO_GLSL_COMMON}\n${HALO_GLSL_NOISE}\n${HALO_GLSL_STORM}\n${HALO_GLSL_LIGHT}\n#define AIR_STEPS 8\n${HALO_GLSL_AIR}\n${HALO_GLSL_PORTSITES}\n${HALO_GLSL_TRANSIT}\n#define HALO_FG\n${HALO_GLSL_FG}\nuniform mat4 viewMatrix;\nuniform mat4 modelMatrix;\nuniform mat4 projectionMatrix;\n${HALO_GLSL_RTE}\n${HALO_GLSL_INDKIT}\n`;
  const helpers = `
vec4 haloAirTestIn(vec3 d, float t1, float j) { vec3 ins; vec3 tr; haloAirIntegrate(uCamLocal, d, 0.0, t1, j, ins, tr); return vec4(ins, 1.0); }
vec4 haloAirTestTr(vec3 d, float t1, float j) { vec3 ins; vec3 tr; haloAirIntegrate(uCamLocal, d, 0.0, t1, j, ins, tr); return vec4(tr, 1.0); }
vec4 kitA(float lotH, int p) { vec4 A; vec4 B; indKitPart(lotH, p, A, B); return A; }
vec4 kitB(float lotH, int p) { vec4 A; vec4 B; indKitPart(lotH, p, A, B); return B; }
`;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const vso = compile(gl.VERTEX_SHADER, vs);
  const setUniforms = (prog) => {
    for (const [key, entry] of Object.entries(u)) {
      const v = entry.value;
      if (typeof v === 'number') {
        const loc = gl.getUniformLocation(prog, key);
        if (loc) gl.uniform1f(loc, v);
      } else if (v && v.isVector4) {
        const loc = gl.getUniformLocation(prog, key);
        if (loc) gl.uniform4f(loc, v.x, v.y, v.z, v.w);
      } else if (v && v.isVector3) {
        const loc = gl.getUniformLocation(prog, key);
        if (loc) gl.uniform3f(loc, v.x, v.y, v.z);
      } else if (v && typeof v.length === 'number') {
        const loc = gl.getUniformLocation(prog, `${key}[0]`) || gl.getUniformLocation(prog, key);
        if (!loc) continue;
        const first = v[0];
        if (typeof first === 'number') gl.uniform1fv(loc, Float32Array.from({ length: v.length }, (_, i) => v[i]));
        else if (first?.isVector4) gl.uniform4fv(loc, Float32Array.from(v.flatMap((q) => [q.x, q.y, q.z, q.w])));
        else if (first?.isVector3) gl.uniform3fv(loc, Float32Array.from(v.flatMap((q) => [q.x, q.y, q.z])));
      }
    }
  };
  const results = {};
  for (const [name, expr] of TESTS) {
    const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${lib}
${helpers}
uniform sampler2D uIn0;
uniform sampler2D uIn1;
uniform sampler2D uIn2;
out vec4 fragColor;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uIn0, c, 0);
  vec4 b = texelFetch(uIn1, c, 0);
  vec4 d = texelFetch(uIn2, c, 0);
  fragColor = ${expr};
}`;
    const prog = gl.createProgram();
    gl.attachShader(prog, vso);
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`${name}: ${gl.getProgramInfoLog(prog)}`);
    gl.useProgram(prog);
    setUniforms(prog);
    ['uIn0', 'uIn1', 'uIn2'].forEach((n, k) => {
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(gl.TEXTURE_2D, tex[k]);
      gl.uniform1i(gl.getUniformLocation(prog, n), k);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, W, H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Float32Array(N * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, px);
    results[name] = px;
  }
  return results;
}

// ---------------------------------------------------------------------------
// TSL: WebGPURenderer, textureLoad wejść (screenCoordinate: wiersz 0 = góra celu =
// wiersz 0 danych), cel RGBA32F, odczyt asynchroniczny bez dopełnienia.
async function tslRun() {
  const adapter = await navigator.gpu.requestAdapter();
  const renderer = new THREE.WebGPURenderer({ antialias: false, requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D } });
  await renderer.init();
  state.meta.tsl = `${adapter.info?.vendor || ''} ${adapter.info?.architecture || ''}`.trim();
  const errors = [];
  renderer.backend.device.addEventListener('uncapturederror', (e) => errors.push(String(e.error?.message || e.error).slice(0, 400)));
  const mkTex = (data) => {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const tex = [mkTex(in0), mkTex(in1), mkTex(in2)];
  const rt = new THREE.RenderTarget(W, H, { type: THREE.FloatType, depthBuffer: false });
  const quad = new THREE.QuadMesh();
  const results = {};
  for (const [name, , tslExpr] of TESTS) {
    const m = new THREE.NodeMaterial();
    m.fragmentNode = Fn(() => {
      const c = ivec2(int(screenCoordinate.x), int(screenCoordinate.y));
      const a = textureLoad(texture(tex[0]), c).toVar();
      const b = textureLoad(texture(tex[1]), c).toVar();
      const d = textureLoad(texture(tex[2]), c).toVar();
      return tslExpr(a, b, d);
    })();
    m.blending = THREE.NoBlending;
    m.depthTest = false;
    m.depthWrite = false;
    quad.material = m;
    renderer.setRenderTarget(rt);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    const raw = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H);
    const rowElems = Math.ceil(W * 16 / 256) * 64;
    const px = new Float32Array(N * 4);
    for (let y = 0; y < H; y++) px.set(raw.subarray(y * rowElems, y * rowElems + W * 4), y * W * 4);
    results[name] = px;
    m.dispose();
  }
  state.meta.tslErrors = errors;
  return results;
}

function compare(A, B) {
  let maxAbs = 0;
  let maxRel = 0;
  let same = 0;
  let nanA = 0;
  let nanB = 0;
  let sumAbs = 0;
  let at = -1;
  const sameCh = [0, 0, 0, 0];
  for (let i = 0; i < A.length; i++) {
    const x = A[i];
    const y = B[i];
    if (!Number.isFinite(x)) nanA++;
    if (!Number.isFinite(y)) nanB++;
    if (!Number.isFinite(x) || !Number.isFinite(y)) { if (Number.isNaN(x) !== Number.isNaN(y)) at = i; continue; }
    if (x === y) { same++; sameCh[i & 3]++; }
    const d = Math.abs(x - y);
    sumAbs += d;
    const rel = d / Math.max(1e-6, Math.abs(x));
    if (d > maxAbs) { maxAbs = d; at = i; }
    if (rel > maxRel && Math.abs(x) > 1e-4) maxRel = rel;
  }
  return {
    n: A.length, bitIdentical: same, identicalPct: +(100 * same / A.length).toFixed(2), maxAbs, meanAbs: sumAbs / A.length,
    identicalPctByChannel: sameCh.map((c) => +(100 * c / (A.length / 4)).toFixed(2)),
    maxRel, nanGLSL: nanA, nanTSL: nanB, worst: at >= 0 ? { i: at, glsl: A[at], tsl: B[at], sample: Math.floor(at / 4) } : null
  };
}

async function main() {
  const glsl = glslRun();
  log(`GLSL: ${state.meta.glsl}`);
  const tsl = await tslRun();
  log(`TSL: ${state.meta.tsl}`);
  for (const [name] of TESTS) {
    state.results[name] = compare(glsl[name], tsl[name]);
    log(`${name.padEnd(18)} ${JSON.stringify(state.results[name])}`);
  }
  state.mirror = compareKitMirror(tsl);
  log(`zestaw TSL ↔ bliźniak JS: ${JSON.stringify(state.mirror)}`);
  state.done = true;
}

// Wynik TSL na GPU (float32) ↔ bliźniak JS indKitPart (float64) na tych samych lotH (float32
// z tekstury wejść): decyzje (istnienie części, materiał, kształt) mają być identyczne, wymiary —
// w granicach zaokrąglenia float32 (odległość w ULP po zaokrągleniu wyniku JS do float32).
function compareKitMirror(tsl) {
  const f32 = new Float32Array(2);
  const i32 = new Int32Array(f32.buffer);
  const ord = (x) => (x < 0 ? 0x80000000 - x : x);
  const ulp = (a, b) => {
    f32[0] = a;
    f32[1] = b;
    return Math.abs(ord(i32[0]) - ord(i32[1]));
  };
  let values = 0;
  let identical = 0;
  let maxUlp = 0;
  let maxAbs = 0;
  let parts = 0;
  let decisionMismatch = 0;
  let worst = null;
  const ulpHist = { 0: 0, 1: 0, 2: 0, '>2': 0 };
  for (let i = 0; i < N; i++) {
    const lotH = in2[i * 4 + 3];
    for (let p = 0; p < IND_PARTS; p++) {
      const ref = indKitPart(lotH, p, KIT_CDF);
      const A = tsl[`kitA_p${p}`];
      const B = tsl[`kitB_p${p}`];
      const gpu = [A[i * 4], A[i * 4 + 1], A[i * 4 + 2], A[i * 4 + 3], B[i * 4], B[i * 4 + 1], B[i * 4 + 2], B[i * 4 + 3]];
      const js = [...ref.A, ...ref.B];
      parts++;
      if ((js[5] > 0) !== (gpu[5] > 0) || js[6] !== gpu[6] || js[7] !== gpu[7]) {
        decisionMismatch++;
        if (!worst) worst = { lotH, p, js, gpu };
      }
      for (let k = 0; k < 8; k++) {
        values++;
        const d = ulp(Math.fround(js[k]), gpu[k]);
        if (d === 0) identical++;
        ulpHist[d > 2 ? '>2' : d]++;
        maxUlp = Math.max(maxUlp, d);
        maxAbs = Math.max(maxAbs, Math.abs(js[k] - gpu[k]));
      }
    }
  }
  return { parts, decisionMismatch, values, identicalF32: identical, identicalPct: +(100 * identical / values).toFixed(3), maxUlp, ulpHist, maxAbs, worst };
}

main().catch((err) => {
  state.error = String(err?.stack || err);
  state.done = true;
  log('BŁĄD ' + state.error);
});

