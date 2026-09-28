// ============================================================
// Tło dema ładowni: ciemna mgławica (pieczona raz do tekstury) i gwiazdy „w nieskończoności”
// — kopia tła dema tarczy (dema/tarcza-webgpu/tlo.js), żeby dema nie zależały od siebie.
// Niebo to kwad przyklejony do kamery, bez testu głębi, rysowany pierwszy.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, abs, dot, exp, float, floor, fract, fwidth, int, length, max, mix, normalize, pow, positionWorld,
  cameraPosition, saturate, smoothstep, texture, uniform, uv, vec2, vec3, vec4
} from 'three/tsl';

const NEB_SIZE = 1024;
const SKY_RANGE = 1.25;
const PARALLAX = 1 / 90000;

const hash22 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(vec2(p3.x.add(p3.y), p3.x.add(p3.z)).mul(p3.zy)).mul(2.0).sub(1.0);
}).setLayout({ name: 'ldHash22', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }] });

const hash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'ldHash12', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const gnoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const a = dot(hash22(i), f);
  const b = dot(hash22(i.add(vec2(1.0, 0.0))), f.sub(vec2(1.0, 0.0)));
  const c = dot(hash22(i.add(vec2(0.0, 1.0))), f.sub(vec2(0.0, 1.0)));
  const d = dot(hash22(i.add(vec2(1.0, 1.0))), f.sub(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y).mul(1.4);
}).setLayout({ name: 'ldGnoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const fbm = Fn(([p, oct]) => {
  const sum = float(0).toVar();
  const amp = float(0.5).toVar();
  const q = vec2(p).toVar();
  Loop({ start: 0, end: oct, type: 'int', condition: '<', name: 'o' }, () => {
    sum.addAssign(amp.mul(gnoise(q)));
    q.assign(vec2(q.x.mul(1.6).add(q.y.mul(1.2)), q.y.mul(1.6).sub(q.x.mul(1.2))).add(vec2(1.7, 9.2)));
    amp.mulAssign(0.5);
  });
  return sum;
}).setLayout({ name: 'ldFbm', type: 'float', inputs: [{ name: 'p', type: 'vec2' }, { name: 'oct', type: 'int' }] });

const nebulaBake = Fn(() => {
  const p = uv().sub(0.5).mul(2 * SKY_RANGE).toVar();
  const w = p.mul(2.1).toVar();
  const q = vec2(fbm(w, int(4)), fbm(w.add(vec2(5.2, 1.3)), int(4))).toVar();
  const base = fbm(w.add(q.mul(1.8)), int(5)).mul(0.5).add(0.5).toVar();
  const fil = pow(max(float(1.0).sub(abs(gnoise(w.mul(3.1).add(q.mul(2.4))))), 0.0), 6.0).toVar();
  const lanes = smoothstep(0.52, 0.8, fbm(w.mul(1.4).add(vec2(11.0, -3.0)), int(4)).mul(0.5).add(0.5));
  const den = smoothstep(0.38, 0.86, base).toVar();
  const deep = vec3(0.0022, 0.0027, 0.0070);
  const violet = vec3(0.012, 0.009, 0.030);
  const teal = vec3(0.004, 0.014, 0.020);
  const col = deep.add(violet.mul(den)).add(teal.mul(fil).mul(den.mul(0.8).add(0.2)));
  return vec4(col.mul(lanes.mul(0.75).oneMinus()), 1.0);
});

const starLayer = Fn(([s, K, prob, bright, seed]) => {
  const p = s.mul(K).toVar();
  const cell = floor(p).toVar();
  const f = fract(p).toVar();
  const px = max(fwidth(p.x), 0.0001).toVar();
  const acc = vec3(0).toVar();
  const h0 = hash12(cell.add(seed)).toVar();
  If(h0.lessThan(prob), () => {
    const c = hash22(cell.add(seed).add(17.0)).mul(0.33).add(0.5);
    const mag = pow(hash12(cell.add(seed).add(31.0)), 4.0).toVar();
    const d = length(f.sub(c)).div(px);
    const r = mix(float(0.55), float(1.35), mag);
    const core = exp(d.mul(d).div(r.mul(r)).negate());
    const t = hash12(cell.add(seed).add(53.0));
    const tint = mix(mix(vec3(1.0, 0.72, 0.5), vec3(0.95, 0.96, 1.0), smoothstep(0.1, 0.45, t)),
      vec3(0.62, 0.74, 1.0), smoothstep(0.6, 1.0, t));
    acc.assign(tint.mul(core).mul(mix(float(0.06), float(1.0), mag)).mul(bright));
  });
  return acc;
});

export function createSky(renderer, scene) {
  const rt = new THREE.RenderTarget(NEB_SIZE, NEB_SIZE, { type: THREE.HalfFloatType, depthBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
  rt.texture.generateMipmaps = false;
  const bakeScene = new THREE.Scene();
  const bakeMat = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  bakeMat.fragmentNode = nebulaBake();
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bakeMat);
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  bakeCam.position.z = 1;
  renderer.setRenderTarget(rt);
  renderer.render(bakeScene, bakeCam);
  renderer.setRenderTarget(null);
  bakeMat.dispose();
  bakeQuad.geometry.dispose();

  const uCamXY = uniform(new THREE.Vector2());
  const uGain = uniform(1);
  const skyNode = Fn(() => {
    const rd = normalize(positionWorld.sub(cameraPosition)).toVar();
    const s = rd.xy.div(max(rd.z.negate(), 0.05)).add(uCamXY.mul(PARALLAX)).toVar();
    const nuv = s.div(2 * SKY_RANGE).add(0.5);
    const neb = texture(rt.texture, nuv).rgb;
    const stars = starLayer(s, float(34.0), float(0.022), float(1.0), float(1.0))
      .add(starLayer(s, float(95.0), float(0.055), float(0.34), float(7.0)))
      .add(starLayer(s, float(230.0), float(0.09), float(0.13), float(13.0)));
    const dim = saturate(float(1.0).sub(length(neb).mul(9.0)));
    return vec4(neb.add(stars.mul(dim.mul(0.6).add(0.4))).mul(uGain), 1.0);
  });
  const mat = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  mat.fragmentNode = skyNode();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  scene.add(mesh);
  const _dir = new THREE.Vector3();
  return {
    mesh,
    uGain,
    // Kwad na 90% odległości do płaszczyzny dalekiej, prostopadły do osi kamery.
    fit(camera) {
      const d = camera.far * 0.9;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      camera.getWorldDirection(_dir);
      mesh.position.copy(camera.position).addScaledVector(_dir, d);
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.set(2 * d * tanH * camera.aspect * 1.3, 2 * d * tanH * 1.3, 1);
      mesh.updateMatrixWorld();
      uCamXY.value.set(camera.position.x, camera.position.y);
    }
  };
}
