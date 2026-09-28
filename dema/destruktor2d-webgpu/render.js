// Render dema belek na WebGPU — rysuje wprost z buforów fizyki (bez kopii przez CPU).
//
// Skóra: czworokąt na węzeł, narożnik = spoczynkowy narożnik komórki + średnie przemieszczenie
// węzłów połączonych całą belką (ta sama zasada co beamSpriteSkin2D.js, tylko w shaderze
// wierzchołków). Ciało węzła i jego ruch sztywny czytane z bufora ciał, więc wraki po rozpadzie
// rysują się tym samym wywołaniem co kadłub. Pozycje świata hi/lo względem środka kamery,
// którą liczy kernel 'camera' na GPU (kamera nie zostaje za statkiem przy 40 000 j./s).
import { DEBRIS_CAPACITY, PROJECTILES, BLASTS, EFFECTS } from './gpuShaders.js';

const SAMPLES = 4;

const COMMON = /* wgsl */`
struct Body {
  pos: vec4<f32>, motion: vec4<f32>, massInfo: vec4<f32>, bounds: vec4<f32>,
  transfer: vec4<f32>, shape: vec4<f32>, rot: vec4<f32>, list: vec4<u32>, state: vec4<u32>,
}
struct View {
  halfSize: vec2<f32>,
  worldPerPx: f32,
  time: f32,
  flags: u32,
  strainView: u32,
  _p0: u32,
  _p1: u32,
}
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> camState: array<vec4<f32>>;

fn rot2(cs: vec2<f32>, v: vec2<f32>) -> vec2<f32> { return vec2<f32>(cs.x * v.x - cs.y * v.y, cs.y * v.x + cs.x * v.y); }
fn relToCam(p: vec4<f32>) -> vec2<f32> {
  let c = camState[0];
  return (p.xy - c.xy) + (p.zw - c.zw);
}
fn toClip(rel: vec2<f32>) -> vec4<f32> { return vec4<f32>(rel / view.halfSize, 0.0, 1.0); }
const OFF: vec4<f32> = vec4<f32>(4.0, 4.0, 0.0, 1.0);
`;

// ------------------------------------------------------------------ tło

const BG = COMMON + /* wgsl */`
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32> }
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  let p = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4<f32>(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}
fn gridLine(coord: f32, spacing: f32, px: f32) -> f32 {
  let d = abs(fract(coord / spacing + 0.5) - 0.5) * spacing;
  return 1.0 - smoothstep(0.0, px * 1.2, d);
}
fn h2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  let c = camState[0];
  // świat = środek kamery + przesunięcie ekranu; siatka liczona modulo od hi (bez utraty precyzji)
  let off = i.ndc * view.halfSize;
  let wHi = c.xy;
  let local = c.zw + off;
  let px = view.worldPerPx;
  var col = vec3<f32>(0.0157, 0.0196, 0.039);
  let spacing = 500.0;
  let gx = gridLine((wHi.x % spacing) + local.x, spacing, px);
  let gy = gridLine((wHi.y % spacing) + local.y, spacing, px);
  let g = max(gx, gy) * select(0.35, 1.0, px < 12.0);
  col = mix(col, vec3<f32>(0.043, 0.102, 0.18), g);
  // gwiazdy: jedna na komórkę 1634 j., jak 60 000 punktów na 400 000² w demie CPU
  let cell = 1634.0;
  let cw = floor((wHi % 65536.0 + local) / cell);
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let k = cw + vec2<f32>(f32(dx), f32(dy));
      let sp = (k + vec2<f32>(h2(k), h2(k + 17.3))) * cell;
      let d = length(((wHi % 65536.0) + local - sp) / px);
      col += vec3<f32>(0.373, 0.486, 0.627) * (1.0 - smoothstep(0.4, 1.3, d));
    }
  }
  return vec4<f32>(col, 1.0);
}
`;

// ------------------------------------------------------------------ skóra

const SKIN = COMMON + /* wgsl */`
struct Inst { nodeStart: u32, nodeCount: u32, beamStart: u32, beamCount: u32,
  pitchU: f32, pitchV: f32, ny: f32, half: f32, tint: vec4<f32> }
@group(0) @binding(2) var<storage, read> bodies: array<Body>;
@group(0) @binding(3) var<storage, read> posVel: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> restMass: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> nodeInfo: array<vec4<u32>>;
@group(0) @binding(6) var<storage, read> links: array<i32>;
@group(0) @binding(7) var<storage, read> beamEnds: array<vec2<u32>>;
@group(0) @binding(8) var<storage, read> beamFlags: array<u32>;
@group(0) @binding(9) var<storage, read> beamLen: array<vec4<f32>>;
@group(0) @binding(10) var<storage, read> nodeMeta: array<vec4<u32>>;
@group(0) @binding(11) var<storage, read> adj: array<u32>;
@group(0) @binding(12) var<storage, read> nodeAux: array<vec4<f32>>;
@group(1) @binding(0) var<uniform> inst: Inst;
@group(1) @binding(1) var tex: texture_2d<f32>;
@group(1) @binding(2) var samp: sampler;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) shade: f32,
  @location(2) heat: f32,
}
const CORNER_OF_VERTEX = array<u32, 6>(0u, 1u, 2u, 0u, 2u, 3u);
const SX = array<f32, 4>(-1.0, 1.0, 1.0, -1.0);
const SY = array<f32, 4>(-1.0, -1.0, 1.0, 1.0);
fn slotOf(dx: i32, dy: i32) -> u32 {
  let d = u32((dx + 1) + (dy + 1) * 3);
  return select(d - 1u, d, d < 4u);
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let local = vid / 6u;
  let k = CORNER_OF_VERTEX[vid % 6u];
  let i = inst.nodeStart + local;
  let info = nodeInfo[i];
  if ((info.x & 1u) == 0u) { o.pos = OFF; return o; }
  let b = bodies[info.y];
  let sx = SX[k];
  let sy = SY[k];
  let rm = restMass[i];
  var sum = posVel[i].xy - rm.xy;
  var weight = 1.0;
  var torn = 0u;
  for (var c = 0; c < 3; c++) {
    let dx = select(i32(sx), 0, c == 1);
    let dy = select(i32(sy), 0, c == 0);
    let e = links[i * 8u + slotOf(dx, dy)];
    if (e < 0) { continue; }
    let ends = beamEnds[u32(e)];
    let other = select(ends.x, ends.y, ends.x == i);
    if ((beamFlags[u32(e)] & 1u) != 0u || (nodeInfo[other].x & 1u) == 0u) { torn++; continue; }
    sum += posVel[other].xy - restMass[other].xy;
    weight += 1.0;
  }
  let p = rm.xy + vec2<f32>(sx, sy) * inst.half + sum / weight;
  o.pos = toClip(relToCam(b.pos) + rot2(b.rot.xy, p));
  let ix = f32(info.w & 0xffffu);
  let iy = f32(info.w >> 16u);
  let cx = ix + select(0.0, 1.0, sx > 0.0);
  let cy = iy + select(0.0, 1.0, sy > 0.0);
  o.uv = vec2<f32>(cx * inst.pitchU, (inst.ny - cy) * inst.pitchV);
  // trwałe odkształcenie belek węzła → ciemniejsza blacha; brzeg rozdarcia ciemniejszy
  let m = nodeMeta[i];
  var dent = 0.0;
  for (var q = m.x; q < m.y; q++) {
    let e = adj[q];
    if ((beamFlags[e] & 1u) != 0u) { continue; }
    let l = beamLen[e];
    dent = max(dent, abs(l.x - l.y) / l.y);
  }
  dent = smoothstep(0.02, 0.22, dent);
  o.shade = max(0.2, 1.0 - 0.42 * dent - select(0.0, 0.3, torn > 0u));
  let aux = nodeAux[i];
  o.heat = aux.y * exp(-max(0.0, view.time - aux.z) * 0.35);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  let t = textureSample(tex, samp, i.uv);
  if (t.a < 0.45) { discard; }
  var col = t.rgb * i.shade * inst.tint.rgb;
  let h = clamp(i.heat, 0.0, 1.0);
  col += vec3<f32>(1.0, 0.45, 0.12) * h * 0.9 + vec3<f32>(1.0, 0.9, 0.7) * max(0.0, h - 0.6) * 1.5;
  return vec4<f32>(col, 1.0);
}
`;

// ------------------------------------------------------------------ belki (podgląd)

const BEAMS = COMMON + /* wgsl */`
struct Inst { nodeStart: u32, nodeCount: u32, beamStart: u32, beamCount: u32,
  pitchU: f32, pitchV: f32, ny: f32, half: f32, tint: vec4<f32> }
@group(0) @binding(2) var<storage, read> bodies: array<Body>;
@group(0) @binding(3) var<storage, read> posVel: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> nodeInfo: array<vec4<u32>>;
@group(0) @binding(7) var<storage, read> beamEnds: array<vec2<u32>>;
@group(0) @binding(8) var<storage, read> beamFlags: array<u32>;
@group(0) @binding(9) var<storage, read> beamLen: array<vec4<f32>>;
@group(0) @binding(13) var<storage, read> beamMat: array<vec4<f32>>;
@group(1) @binding(0) var<uniform> inst: Inst;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32> }
// Belka jako pasek (dwa trójkąty): linie WebGPU mają zawsze 1 px, przy oddaleniu ginęły.
const QA = array<f32, 6>(0.0, 1.0, 1.0, 0.0, 1.0, 0.0);
const QS = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let e = inst.beamStart + vid / 6u;
  let fl = beamFlags[e];
  let ends = beamEnds[e];
  if ((fl & 1u) != 0u || (nodeInfo[ends.x].x & nodeInfo[ends.y].x & 1u) == 0u) { o.pos = OFF; return o; }
  let b = bodies[nodeInfo[ends.x].y];
  let base = relToCam(b.pos);
  let pa = base + rot2(b.rot.xy, posVel[ends.x].xy);
  let pb = base + rot2(b.rot.xy, posVel[ends.y].xy);
  let d = pb - pa;
  let len = max(length(d), 1e-6);
  let side = vec2<f32>(-d.y, d.x) / len;
  let s0 = min(1.0, abs(beamLen[e].w) / max(1e-4, beamMat[e].z));
  var width = max(view.worldPerPx * 1.4, inst.half * 0.12);
  if (view.strainView != 0u) { width = max(view.worldPerPx * 1.6, inst.half * 0.16) * (1.0 + 1.5 * s0); }
  let k = vid % 6u;
  o.pos = toClip(mix(pa, pb, QA[k]) + side * (QS[k] * width * 0.5));
  let btype = (fl >> 8u) & 255u;
  var tint = vec3<f32>(0.42, 0.52, 0.62);
  if (btype == 1u) { tint = vec3<f32>(0.34, 0.38, 0.44); }
  if (btype == 2u) { tint = vec3<f32>(0.95, 0.62, 0.22); }
  if (btype == 3u) { tint = vec3<f32>(0.25, 0.85, 0.80); }
  let s = s0;
  var col = vec3<f32>(tint.r + (1.0 - tint.r) * s, tint.g * (1.0 - s * 0.75), tint.b * (1.0 - s * 0.9));
  var alpha = 0.9;
  if (view.strainView != 0u) {
    // widok naprężeń: tylko belki obciążone — błękit → żółć → czerwień (0 … próg zerwania)
    let t = smoothstep(0.02, 0.9, s);
    col = mix(vec3<f32>(0.2, 0.6, 1.0), vec3<f32>(1.0, 0.9, 0.2), smoothstep(0.0, 0.5, t));
    col = mix(col, vec3<f32>(1.0, 0.15, 0.1), smoothstep(0.5, 1.0, t));
    alpha = smoothstep(0.02, 0.25, s);
  }
  o.color = vec4<f32>(col, alpha);
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  if (i.color.a < 0.01) { discard; }
  return i.color;
}
`;

// ------------------------------------------------------------------ węzły (podgląd)

const NODES = COMMON + /* wgsl */`
struct Inst { nodeStart: u32, nodeCount: u32, beamStart: u32, beamCount: u32,
  pitchU: f32, pitchV: f32, ny: f32, half: f32, tint: vec4<f32> }
@group(0) @binding(2) var<storage, read> bodies: array<Body>;
@group(0) @binding(3) var<storage, read> posVel: array<vec4<f32>>;
@group(0) @binding(5) var<storage, read> nodeInfo: array<vec4<u32>>;
@group(0) @binding(12) var<storage, read> nodeAux: array<vec4<f32>>;
@group(1) @binding(0) var<uniform> inst: Inst;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec3<f32> }
const QX = array<f32, 6>(-1.0, 1.0, 1.0, -1.0, 1.0, -1.0);
const QY = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let i = inst.nodeStart + vid / 6u;
  let info = nodeInfo[i];
  if ((info.x & 1u) == 0u) { o.pos = OFF; return o; }
  let b = bodies[info.y];
  let r = max(inst.half * 0.4, view.worldPerPx * 1.2);
  let p = posVel[i].xy + vec2<f32>(QX[vid % 6u], QY[vid % 6u]) * r;
  o.pos = toClip(relToCam(b.pos) + rot2(b.rot.xy, p));
  let c = bitcast<u32>(nodeAux[i].w);
  o.color = vec3<f32>(f32(c & 255u), f32((c >> 8u) & 255u), f32((c >> 16u) & 255u)) / 255.0 * 1.2 + 0.1;
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> { return vec4<f32>(i.color, 1.0); }
`;

// ------------------------------------------------------------------ odłamki

const DEBRIS = COMMON + /* wgsl */`
struct Debris { pos: vec4<f32>, motion: vec4<f32>, look: vec4<f32>, color: vec4<u32> }
@group(0) @binding(14) var<storage, read> debris: array<Debris>;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, @location(1) q: vec2<f32>, @location(2) kind: f32 }
const QX = array<f32, 6>(-1.0, 1.0, 1.0, -1.0, 1.0, -1.0);
const QY = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let d = debris[vid / 6u];
  let age = view.time - d.motion.z;
  if (age < 0.0 || age >= d.motion.w) { o.pos = OFF; return o; }
  let travel = (1.0 - exp(-0.6 * age)) / 0.6;
  let center = relToCam(d.pos) + d.motion.xy * travel;
  let ang = d.look.y + d.look.z * age;
  let cs = vec2<f32>(cos(ang), sin(ang));
  let q = vec2<f32>(QX[vid % 6u], QY[vid % 6u]);
  let size = max(d.look.x, view.worldPerPx * 1.5);
  let shape = select(vec2<f32>(0.6, 0.5), vec2<f32>(0.9, 0.18), d.look.w > 0.5);
  o.pos = toClip(center + rot2(cs, q * shape * size));
  let c = d.color.x;
  let rgb = vec3<f32>(f32(c & 255u), f32((c >> 8u) & 255u), f32((c >> 16u) & 255u)) / 255.0;
  let fade = clamp(d.motion.w - age, 0.0, 1.0);
  let hot = exp(-age * 3.0);
  o.color = vec4<f32>(rgb * 0.85 + vec3<f32>(1.0, 0.55, 0.2) * hot * 0.8, fade);
  o.q = q;
  o.kind = d.look.w;
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  // postrzępiony brzeg zamiast prostokąta
  let r = abs(i.q);
  let jag = 0.78 + 0.22 * sin(i.q.x * 7.0 + i.q.y * 11.0);
  if (i.kind < 0.5 && r.x + r.y > 1.5 * jag) { discard; }
  if (i.color.a < 0.02) { discard; }
  return vec4<f32>(i.color.rgb * i.color.a, i.color.a);
}
`;

// ------------------------------------------------------------------ pociski, fale, błyski

const FX = COMMON + /* wgsl */`
struct Projectile { pos: vec4<f32>, motion: vec4<f32>, data: vec4<f32>, tags: vec4<u32> }
struct Blast { pos: vec4<f32>, motion: vec4<f32>, data: vec4<f32>, tags: vec4<u32> }
struct Effect { pos: vec4<f32>, data: vec4<f32> }
@group(0) @binding(15) var<storage, read> projectiles: array<Projectile>;
@group(0) @binding(16) var<storage, read> blasts: array<Blast>;
@group(0) @binding(17) var<storage, read> effects: array<Effect>;
struct VOut { @builtin(position) pos: vec4<f32>, @location(0) q: vec2<f32>, @location(1) color: vec4<f32>, @location(2) mode: f32 }
const QX = array<f32, 6>(-1.0, 1.0, 1.0, -1.0, 1.0, -1.0);
const QY = array<f32, 6>(-1.0, -1.0, 1.0, -1.0, 1.0, 1.0);
@vertex fn vs(@builtin(vertex_index) vid: u32) -> VOut {
  var o: VOut;
  let k = vid / 6u;
  let q = vec2<f32>(QX[vid % 6u], QY[vid % 6u]);
  o.q = q;
  if (k < ${PROJECTILES}u) {
    let p = projectiles[k];
    if (p.tags.z == 0u) { o.pos = OFF; return o; }
    let v = p.motion.xy;
    let speed = max(length(v), 1e-3);
    let dir = v / speed;
    let side = vec2<f32>(-dir.y, dir.x);
    let isLaser = p.tags.x == 0u;
    let len = select(max(p.data.y * 0.8, view.worldPerPx * 6.0), max(speed * 0.03, view.worldPerPx * 10.0), isLaser);
    let wid = max(select(p.data.y * 0.35, 3.5, isLaser), view.worldPerPx * 1.6);
    let center = relToCam(p.pos) - dir * len * 0.5 * select(0.0, 1.0, isLaser);
    o.pos = toClip(center + dir * q.x * len * 0.5 + side * q.y * wid);
    o.color = select(vec4<f32>(1.0, 0.55, 0.15, 1.0), vec4<f32>(0.45, 0.9, 1.0, 1.0), isLaser);
    o.mode = select(1.0, 0.0, isLaser);
    return o;
  }
  if (k < ${PROJECTILES + BLASTS}u) {
    let b = blasts[k - ${PROJECTILES}u];
    if (b.tags.y == 0u) { o.pos = OFF; return o; }
    let t = clamp(b.motion.z / 0.22, 0.0, 1.0);
    let r = b.data.x * (0.4 + 0.8 * t) * 1.4;
    o.pos = toClip(relToCam(b.pos) + q * r);
    o.color = vec4<f32>(1.0, 0.6, 0.25, 1.0 - t * 0.7);
    o.mode = 2.0;
    return o;
  }
  let e = effects[k - ${PROJECTILES + BLASTS}u];
  let age = view.time - e.data.x;
  if (age < 0.0 || age >= e.data.y) { o.pos = OFF; return o; }
  let t = age / e.data.y;
  let isLaser = e.data.w < 0.5;
  let r = max(e.data.z * select(2.2, 1.6, isLaser) * (0.6 + t), view.worldPerPx * 4.0);
  o.pos = toClip(relToCam(e.pos) + q * r);
  o.color = select(vec4<f32>(1.0, 0.7, 0.35, 1.0 - t), vec4<f32>(0.7, 0.95, 1.0, 1.0 - t), isLaser);
  o.mode = 3.0;
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {
  var a = 0.0;
  if (i.mode < 0.5) {
    // laser: jasny rdzeń, miękkie brzegi
    a = (1.0 - smoothstep(0.0, 1.0, abs(i.q.y))) * (1.0 - smoothstep(0.6, 1.0, abs(i.q.x)) * 0.6);
  } else if (i.mode < 1.5) {
    a = 1.0 - smoothstep(0.2, 1.0, length(i.q));
  } else if (i.mode < 2.5) {
    let r = length(i.q);
    a = (1.0 - smoothstep(0.75, 1.0, r)) * smoothstep(0.4, 0.95, r) + (1.0 - smoothstep(0.0, 0.7, r)) * 0.5;
  } else {
    let r = length(i.q);
    a = pow(max(0.0, 1.0 - r), 2.0);
  }
  let c = i.color.rgb * a * i.color.a;
  return vec4<f32>(c, 0.0);
}
`;

export class BeamRenderer {
  constructor(device, canvas) {
    this.device = device;
    this.canvas = canvas;
    this.context = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({ device, format: this.format, alphaMode: 'opaque' });
    this.show = { skin: true, beams: false, nodes: false, strain: false };
    this.instances = [];
    this.textures = new Map();
  }

  async init() {
    const d = this.device;
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.viewBuffer = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const storageRO = (b) => ({ binding: b, visibility: V | F, buffer: { type: 'read-only-storage' } });
    // Dwa układy: kadłuby (13 buforów storage) i efekty (5) — limit 16 na etap shadera.
    this.layout0 = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(storageRO)
    ] });
    this.layoutFx = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      ...[1, 14, 15, 16, 17].map(storageRO)
    ] });
    this.instLayout = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: {} },
      { binding: 2, visibility: F, sampler: {} }
    ] });
    this.instLayoutNoTex = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | F, buffer: { type: 'uniform' } }] });
    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8,
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const target = (blend) => [{ format: this.format, blend }];
    const additive = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    const premul = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const alpha = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
    const make = async (code, layouts, topology, blend, label) => {
      const module = d.createShaderModule({ code, label });
      return d.createRenderPipelineAsync({
        label, layout: d.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: target(blend) },
        primitive: { topology }, multisample: { count: SAMPLES }
      });
    };
    [this.bgPipe, this.skinPipe, this.beamPipe, this.nodePipe, this.debrisPipe, this.fxPipe] = await Promise.all([
      make(BG, [this.layoutFx], 'triangle-list', undefined, 'tło'),
      make(SKIN, [this.layout0, this.instLayout], 'triangle-list', undefined, 'skóra'),
      make(BEAMS, [this.layout0, this.instLayoutNoTex], 'triangle-list', alpha, 'belki'),
      make(NODES, [this.layout0, this.instLayoutNoTex], 'triangle-list', undefined, 'węzły'),
      make(DEBRIS, [this.layoutFx], 'triangle-list', premul, 'odłamki'),
      make(FX, [this.layoutFx], 'triangle-list', additive, 'efekty')
    ]);
  }

  /** Tekstura sprite'a z mipmapami (kolejne połowy rysowane na płótnie 2D). */
  async textureFor(key, image) {
    if (this.textures.has(key)) return this.textures.get(key);
    const d = this.device;
    let w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    const scale = Math.min(1, 4096 / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    const texture = d.createTexture({ size: [w, h], format: 'rgba8unorm', mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
    for (let l = 0; l < levels; l++) {
      const lw = Math.max(1, w >> l), lh = Math.max(1, h >> l);
      const canvas = new OffscreenCanvas(lw, lh);
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(image, 0, 0, lw, lh);
      d.queue.copyExternalImageToTexture({ source: canvas }, { texture, mipLevel: l }, [lw, lh]);
    }
    this.textures.set(key, texture);
    return texture;
  }

  /** Bind groupy dla bieżących buforów świata i instancji kadłubów. */
  async setScene(world, instanceLooks) {
    const d = this.device;
    const B = world.buffers;
    const order = [null, B.camState, B.bodies, B.posVel, B.restMass, B.nodeInfo, B.links, B.beamEnds, B.beamFlags,
      B.beamLen, B.nodeMeta, B.adj, B.nodeAux, B.beamMat];
    this.bg0 = d.createBindGroup({ layout: this.layout0, entries: order.map((buf, i) => ({
      binding: i, resource: { buffer: i === 0 ? this.viewBuffer : buf }
    })) });
    this.bgFx = d.createBindGroup({ layout: this.layoutFx, entries: [
      { binding: 0, resource: { buffer: this.viewBuffer } }, { binding: 1, resource: { buffer: B.camState } },
      { binding: 14, resource: { buffer: B.debris } }, { binding: 15, resource: { buffer: B.projectiles } },
      { binding: 16, resource: { buffer: B.blasts } }, { binding: 17, resource: { buffer: B.effects } }
    ] });
    this.world = world;
    for (const inst of this.instances) inst.uniform.destroy();
    this.instances = [];
    for (let k = 0; k < world.instances.length; k++) {
      const wi = world.instances[k];
      const look = instanceLooks[k];
      const skin = wi.hull.spriteSkin;
      const data = new ArrayBuffer(48);
      const u = new Uint32Array(data), f = new Float32Array(data);
      u[0] = wi.nodeStart; u[1] = wi.nodeCount; u[2] = wi.beamStart; u[3] = wi.beamCount;
      f[4] = skin.pixelPitch / skin.width; f[5] = skin.pixelPitch / skin.height; f[6] = skin.ny; f[7] = skin.cellSize * 0.5;
      const tint = look.tint || [1, 1, 1];
      f[8] = tint[0]; f[9] = tint[1]; f[10] = tint[2]; f[11] = 1;
      const uniform = d.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(uniform, 0, data);
      const texture = await this.textureFor(look.key, look.image);
      this.instances.push({
        ...wi, uniform,
        bgTex: d.createBindGroup({ layout: this.instLayout, entries: [
          { binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: texture.createView() }, { binding: 2, resource: this.sampler }
        ] }),
        bgPlain: d.createBindGroup({ layout: this.instLayoutNoTex, entries: [{ binding: 0, resource: { buffer: uniform } }] })
      });
    }
  }

  _ensureTarget(w, h) {
    if (this.msaa && this.msaa.width === w && this.msaa.height === h) return;
    this.msaa?.destroy();
    this.msaa = this.device.createTexture({ size: [w, h], sampleCount: SAMPLES, format: this.format, usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }

  /**
   * @param {GPUCommandEncoder} enc
   * @param {{ viewHeight: number, time: number }} v
   * @param {{ querySet?: GPUQuerySet }} ts
   */
  encode(enc, v, ts = {}) {
    const d = this.device;
    const w = this.canvas.width, h = this.canvas.height;
    this._ensureTarget(w, h);
    const halfH = v.viewHeight * 0.5, halfW = halfH * w / h;
    const data = new ArrayBuffer(32);
    const f = new Float32Array(data), u = new Uint32Array(data);
    f[0] = halfW; f[1] = halfH; f[2] = v.viewHeight / h; f[3] = v.time;
    u[4] = 0; u[5] = this.show.strain ? 1 : 0;
    d.queue.writeBuffer(this.viewBuffer, 0, data);
    const pass = enc.beginRenderPass({
      label: 'render',
      colorAttachments: [{ view: this.msaa.createView(), resolveTarget: this.context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'discard', clearValue: { r: 0.0157, g: 0.0196, b: 0.039, a: 1 } }],
      timestampWrites: ts.querySet ? { querySet: ts.querySet, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 } : undefined
    });
    pass.setBindGroup(0, this.bgFx);
    pass.setPipeline(this.bgPipe);
    pass.draw(3);
    pass.setBindGroup(0, this.bg0);
    const skin = this.show.skin;
    if (skin) {
      pass.setPipeline(this.skinPipe);
      for (const inst of this.instances) {
        pass.setBindGroup(1, inst.bgTex);
        pass.draw(inst.nodeCount * 6);
      }
    }
    // Bez skóry konstrukcja jest jedynym wyglądem ciała (jak BeamShips3D).
    if (this.show.beams || this.show.strain || !skin) {
      pass.setPipeline(this.beamPipe);
      for (const inst of this.instances) {
        if (!inst.beamCount) continue;
        pass.setBindGroup(1, inst.bgPlain);
        pass.draw(inst.beamCount * 6);
      }
    }
    if (this.show.nodes || !skin) {
      pass.setPipeline(this.nodePipe);
      for (const inst of this.instances) {
        if (inst.isStatic && skin) continue;
        pass.setBindGroup(1, inst.bgPlain);
        pass.draw(inst.nodeCount * 6);
      }
    }
    pass.setBindGroup(0, this.bgFx);
    pass.setPipeline(this.debrisPipe);
    pass.draw(DEBRIS_CAPACITY * 6);
    pass.setPipeline(this.fxPipe);
    pass.draw((PROJECTILES + BLASTS + EFFECTS) * 6);
    pass.end();
  }
}
