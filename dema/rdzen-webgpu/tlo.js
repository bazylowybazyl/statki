// Tło dema rdzenia: nieprzezroczysta noc z gwiazdami i słabą mgławicą — pełnoekranowy kwad TSL
// w passie tła Core3D (warstwa 1). Bez niego kanwa Core3D jest przezroczysta, a poświata bloomu
// w pustce (rgb > alfa na kanwie premultiplied) wychodzi ~2× jaśniej niż w grze (tam tło
// zapisuje alfę 1) — wybuch w demie wyglądałby na przepalony, choć bufor HDR był w pasmach.
// Paralaksa: tło przesuwa się z kamerą × PARALLAX (świat gry), gwiazdy w komórkach z haszem.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, positionGeometry, screenCoordinate, texture,
  floor, fract, sin, dot, mix, smoothstep, max, exp, length
} from 'three/tsl';
import { fxNoise } from '../../src/3d/fx/noise.js';

const PARALLAX = 0.06;

export function createBackdrop(core) {
  const U = {
    cam: uniform(new THREE.Vector3(0, 0, 1)),      // x, y (świat gry), zoom
    res: uniform(new THREE.Vector2(1600, 900))     // rozmiar bufora rysowania [px]
  };
  const cloud = fxNoise.cloud2D();
  const hash12 = (p) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
  const mat = new THREE.NodeMaterial();
  mat.name = 'RdzenBackdrop';
  mat.depthWrite = false;
  mat.depthTest = false;
  mat.lights = false;
  mat.fog = false;
  mat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
  mat.fragmentNode = Fn(() => {
    const px = screenCoordinate.xy;
    // punkt tła w „świecie” paralaksy (y ekranu w dół = y gry w dół)
    const w = px.sub(U.res.mul(0.5)).div(max(U.cam.z, 1e-3)).mul(PARALLAX).add(U.cam.xy.mul(PARALLAX));
    const col = vec3(0.0035, 0.0045, 0.0075).toVar();
    // mgławica: dwie oktawy faktury chmur, chłodny fiolet i błękit — ledwo widoczna
    const n1 = texture(cloud, w.mul(1 / 5200)).level(0);
    const n2 = texture(cloud, w.mul(1 / 1900).add(vec2(0.31, 0.77))).level(0);
    const neb = smoothstep(0.45, 0.85, n1.x.mul(0.65).add(n2.y.mul(0.35)));
    col.addAssign(vec3(0.010, 0.006, 0.020).mul(neb).add(vec3(0.004, 0.008, 0.014).mul(smoothstep(0.5, 0.9, n2.x))));
    // gwiazdy: trzy warstwy komórek, punkt ~1 px niezależnie od zoomu
    // [komórka w j. paralaksy, próg haszu (rzadkość), jasność] — przy zoomie 0,5 komórka ~20–60 px
    const layers = [[2.5, 0.972, 0.55], [4.2, 0.985, 0.9], [7.5, 0.992, 1.25]];
    for (const [cell, thr, gain] of layers) {
      const q = w.div(cell);
      const c = floor(q);
      const h = hash12(c);
      const off = vec2(hash12(c.add(17.1)), hash12(c.add(41.7)));
      const d = length(fract(q).sub(off)).mul(cell).mul(U.cam.z).div(PARALLAX);
      const star = smoothstep(thr, 1.0, h).mul(exp(d.mul(d).mul(-0.9)));
      const tint = mix(vec3(1.0, 0.86, 0.72), vec3(0.72, 0.84, 1.0), hash12(c.add(5.3)));
      col.addAssign(tint.mul(star).mul(gain));
    }
    return vec4(col, 1.0);
  })();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10000;
  mesh.layers.set(1);
  mesh.name = 'RdzenBackdrop';
  core.scene.add(mesh);
  return {
    mesh,
    sync(cam, width, height) {
      U.cam.value.set(cam.x, cam.y, cam.zoom);
      const pr = core.pixelRatio || 1;
      U.res.value.set(width * pr, height * pr);
    }
  };
}
