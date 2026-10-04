// ============================================================
// Niebo kamer 3D gry (tryb free3d Core3D): sfera wokół kamery na warstwie tła (1), kolor z KIERUNKU
// patrzenia — gwiazdy z komórek 3D (jak niebo dema Atlasa 3D, dema/atlas3d-webgpu/niebo.js) i mgławica
// gry (assets/nebula.png) w rzucie stereograficznym z nadiru (z góry wygląda jak dawna płaszczyzna
// mgławicy pod światem), dookoła horyzontu i w górze słaba mgławica z szumu. Bez paralaksy — tło w
// nieskończoności. W kamerze klasycznej (ortho + perspektywa z góry) sfera jest schowana, a rysują się
// dawne płaszczyzny mgławicy i gwiazd (planet3d.assets.js).
//
// Graf raz (moduł), jedna siatka. Pozycja = oko kamery (Core3D.syncCamera w free3d), skala = połowa
// `far`, więc sfera zawsze mieści się w bryle widzenia; bez testu i zapisu głębi, renderOrder na samym
// początku passa tła.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, float, floor, fract, dot, normalize, max, abs, pow, exp, mix, smoothstep,
  length, positionLocal, mx_fractal_noise_float, fwidth, texture
} from 'three/tsl';

const hash33 = Fn(([p3]) => {
  const p = fract(p3.mul(vec3(0.1031, 0.1030, 0.0973))).toVar();
  p.addAssign(dot(p, p.yxz.add(33.33)));
  return fract(p.xxy.add(p.yxx).mul(p.zyx));
});

// Warstwa gwiazd: komórki 3D na sferze o promieniu K, gwiazda w losowym punkcie komórki; szerokość
// gwiazdy ~1 px (fwidth), więc nie migocze przy obrocie kamery.
const starLayer = Fn(([d, K, prob, bright]) => {
  const p = d.mul(K).toVar();
  const cell = floor(p).toVar();
  const h = hash33(cell).toVar();
  const c = cell.add(h.mul(0.8).add(0.1));
  const px = max(fwidth(p.x).add(fwidth(p.y)).add(fwidth(p.z)).mul(0.5), 1e-4).toVar();
  const dist = length(p.sub(c)).div(px);
  const on = smoothstep(prob.oneMinus(), prob.oneMinus().add(0.002), h.z);
  const mag = pow(fract(h.x.mul(13.7).add(h.y)), 3.0);
  const core = exp(dist.mul(dist).negate().div(mix(0.5, 1.4, mag)));
  const tint = mix(vec3(1.0, 0.82, 0.66), vec3(0.72, 0.84, 1.0), h.y);
  return tint.mul(core).mul(on).mul(mix(0.08, 1.0, mag)).mul(bright);
});

export const SKY3D_TUNE = Object.freeze({
  nebulaSpan: 1.35,   // zasięg obrazu mgławicy w rzucie stereograficznym (1 = obraz do horyzontu)
  nebulaGain: 1.0,
  starsGain: 1.0
});

let _sky = null;

/** Tworzy (raz) sferę nieba. nebulaTexture — tekstura mgławicy gry (NebulaSystem), może być null. */
export function createSky3D(scene, nebulaTexture = null) {
  if (_sky) return _sky;
  const u = {
    stars: uniform(SKY3D_TUNE.starsGain),
    nebula: uniform(SKY3D_TUNE.nebulaGain),
    span: uniform(SKY3D_TUNE.nebulaSpan)
  };
  const tex = nebulaTexture || new THREE.Texture();
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.name = 'Sky3D';
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.colorNode = Fn(() => {
    const d = normalize(positionLocal).toVar();
    // Mgławica gry: rzut stereograficzny z nadiru (−Z) i z zenitu (lustro) — ten sam obraz, na
    // horyzoncie ciągły. Świat THREE: +Y = północ (−y gry), jak dawna płaszczyzna mgławicy.
    const k = float(1.0).div(float(1.0).add(abs(d.z)));
    const st = vec2(d.x, d.y).mul(k).div(u.span);
    const uvN = st.mul(vec2(0.5, 0.5 * 1.6)).add(0.5);
    const edge = smoothstep(1.0, 0.72, length(st));
    const neb = texture(tex, uvN).rgb.mul(edge).mul(u.nebula);
    // Słaba mgławica z szumu (fiolet i morski błękit) — żeby horyzont nie był pusty.
    const n1 = mx_fractal_noise_float(d.mul(1.6), 3, 2.0, 0.5).mul(0.5).add(0.5);
    const n2 = mx_fractal_noise_float(d.mul(3.3).add(vec3(7.1, -2.3, 4.4)), 2, 2.0, 0.5).mul(0.5).add(0.5);
    const bandDir = normalize(vec3(0.25, 0.35, 0.9));
    const bd = dot(d, bandDir);
    const band = exp(bd.mul(bd).mul(-7.0));
    const fog = smoothstep(0.45, 0.95, n1).mul(band.mul(0.8).add(0.3));
    const col = vec3(0.0012, 0.0016, 0.0034)
      .add(vec3(0.012, 0.005, 0.02).mul(fog))
      .add(vec3(0.002, 0.009, 0.013).mul(smoothstep(0.55, 0.9, n2)).mul(band.add(0.2)))
      .add(neb);
    const s = starLayer(d, float(260.0), float(0.02), float(0.5))
      .add(starLayer(d, float(90.0), float(0.028), float(1.5)));
    return col.add(s.mul(u.stars));
  })();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material);
  mesh.name = 'Sky3D';
  mesh.frustumCulled = false;
  mesh.renderOrder = -100000;
  mesh.visible = false;
  mesh.layers.set(1);
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);
  _sky = { mesh, material, u };
  return _sky;
}

export function getSky3D() { return _sky; }

/** Sfera w oku kamery, promień 0,5 · far (free3d); schowana w kamerze klasycznej. */
export function syncSky3D(active, eye, far) {
  const sky = _sky;
  if (!sky) return;
  const mesh = sky.mesh;
  if (mesh.visible !== !!active) mesh.visible = !!active;
  if (!active) return;
  const r = Math.max(1000, (Number(far) || 1e7) * 0.5);
  mesh.position.set(eye.x, eye.y, eye.z);
  mesh.scale.set(r, r, r);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);
}
