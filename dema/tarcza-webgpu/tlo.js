// ============================================================
// Tło: ciemna mgławica i gwiazdy „w nieskończoności” — dalekie i ciemne,
// żeby błękit tarczy był na nich czytelny. Mgławica z szumu 2D pieczona RAZ
// do tekstury; gwiazdy liczone w shaderze nieba (komórki z hashem). Niebo to
// kwad przyklejony do kamery, bez testu głębi, rysowany pierwszy.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, float, int, vec2, vec3, vec4, texture, uv, positionWorld, cameraPosition, abs,
  normalize, max, min, mix, smoothstep, saturate, exp, dot, floor, fract, length, fwidth, pow, If, select
} from 'three/tsl';
import { fbm, gnoise, hash12, hash22 } from './wspolne.js';

const NEB_SIZE = 1024;
const SKY_RANGE = 1.25;    // współrzędne nieba s ∈ [−R, R] mieszczą się w teksturze
const PARALLAX = 1 / 90000; // lekki ruch tła przy przesuwie kamery

// Mgławica: ciemny fiolet i granat z chłodnymi włóknami i pasami pyłu.
const nebulaBake = Fn(() => {
  const p = uv().sub(0.5).mul(2 * SKY_RANGE).toVar();       // współrzędne nieba
  const w = p.mul(2.1).toVar();
  const q = vec2(fbm(w, int(4)), fbm(w.add(vec2(5.2, 1.3)), int(4))).toVar();
  const base = fbm(w.add(q.mul(1.8)), int(5)).mul(0.5).add(0.5).toVar();
  const fil = pow(max(float(1.0).sub(abs(gnoise(w.mul(3.1).add(q.mul(2.4))))), 0.0), 6.0).toVar();
  const lanes = smoothstep(0.52, 0.8, fbm(w.mul(1.4).add(vec2(11.0, -3.0)), int(4)).mul(0.5).add(0.5));
  const den = smoothstep(0.38, 0.86, base).toVar();
  const deep = vec3(0.0022, 0.0027, 0.0070);
  const violet = vec3(0.020, 0.0075, 0.034);
  const teal = vec3(0.004, 0.014, 0.020);
  const col = deep.add(violet.mul(den)).add(teal.mul(fil).mul(den.mul(0.8).add(0.2)));
  return vec4(col.mul(lanes.mul(0.75).oneMinus()), 1.0);
});

// Jedna warstwa gwiazd: komórka z prawdopodobieństwem gwiazdy, punkt w komórce,
// rdzeń gaussowski w pikselach ekranu (fwidth — ostre na każdym zoomie).
const starLayer = Fn(([s, K, prob, bright, seed]) => {
  const p = s.mul(K).toVar();
  const cell = floor(p).toVar();
  const f = fract(p).toVar();
  const px = max(fwidth(p.x), 0.0001).toVar();          // przed If (pochodne)
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
  // 1) Pieczenie mgławicy (raz).
  const rt = new THREE.RenderTarget(NEB_SIZE, NEB_SIZE, { type: THREE.HalfFloatType, depthBuffer: false });
  rt.texture.minFilter = THREE.LinearFilter;
  rt.texture.magFilter = THREE.LinearFilter;
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

  // 2) Niebo przy kamerze.
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
    // Gwiazdy przygaszone tam, gdzie mgławica gęsta (pył zasłania tło).
    const dim = saturate(float(1.0).sub(length(neb).mul(9.0)));
    return vec4(neb.add(stars.mul(dim.mul(0.6).add(0.4))).mul(uGain), 1.0);
  });
  const mat = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  mat.fragmentNode = skyNode();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  scene.add(mesh);

  return {
    mesh,
    uGain,
    // Kwad na 90% odległości do płaszczyzny dalekiej, pokrywa cały kadr.
    fit(camera) {
      const d = camera.far * 0.9;
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      mesh.position.set(camera.position.x, camera.position.y, camera.position.z - d);
      mesh.scale.set(2 * d * tanH * camera.aspect * 1.08, 2 * d * tanH * 1.08, 1);
      mesh.updateMatrixWorld();
      uCamXY.value.set(camera.position.x, camera.position.y);
    }
  };
}
