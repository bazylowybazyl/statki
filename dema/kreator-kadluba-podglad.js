// dema/kreator-kadluba-podglad.js
//
// KREATOR KADŁUBÓW — PODGLĄD W TRAKCIE PRZECIĄGANIA. Szybki wypiek (pole w połowie rozdzielczości z workera budowy)
// zostaje w celach kompozytora; ten kwad rysuje je wprost w passie gry (warstwa 0), bez odczytu na CPU i bez ciała
// gry: albedo (cel ALB, sRGB) oświetlone jak skóra kadłuba v2 — hullPbrSun z mapą powierzchni (cel SURF: normalne, AO)
// i emisja niebieskich paneli (hullGlowMask). Bez samocienia, lakieru i maski słońca — po puszczeniu wraca ciało gry.
// Jeden materiał na stałych węzłach (tekstury podmieniane przez `.value`), rozgrzany przy starcie (`warm`).

import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uniform, texture, uv, max, mix, pow, step, length, normalize, clamp } from 'three/tsl';
import { HullLighting } from '../src/3d/hullLighting.js';
import { hullPbrSun, hullGlowMask, surfaceNormal } from '../src/3d/hullLighting.tsl.js';

function placeholder() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

const srgbToLinear = (c) => mix(c.div(12.92), pow(c.add(0.055).div(1.055), vec3(2.4)), step(vec3(0.04045), c));

export function createDesignPreview(Core3D) {
  const albT = texture(placeholder(), vec2(0));
  const surfT = texture(placeholder(), vec2(0));
  const uSun = uniform(new THREE.Vector2(-0.8, 0.5));
  const node = Fn(() => {
    const q = vec2(uv().x, float(1.0).sub(uv().y));
    const a = albT.sample(q).level(0);
    const s = surfT.sample(q).level(0);
    const albedo = srgbToLinear(clamp(a.xyz, 0.0, 1.0)).toVar();
    const N = normalize(surfaceNormal(s));
    const sunXY = uSun.div(max(length(uSun), 1e-4));
    const sun = hullPbrSun({ albedo, N, sunXY, keyVis: float(1.0), ao: s.z, skyField: float(1.0) });
    const glow = hullGlowMask(albedo).mul(HullLighting.uniforms.uMat.z);
    return vec4(sun.color.add(albedo.mul(glow)), a.w);
  })();
  const material = new THREE.NodeMaterial();
  material.name = 'KreatorPodglad';
  material.fragmentNode = node;
  material.transparent = true;
  material.depthWrite = false;
  material.lights = false;
  material.fog = false;
  material.side = THREE.DoubleSide;
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  mesh.name = 'kreator: podgląd przeciągania';
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  Core3D.scene.add(mesh);
  return {
    mesh,
    get visible() { return mesh.visible; },
    /** Pokaż cele kompozytora w pudle obrazu `im` (j. świata; y gry w dół), słońce `sun` ({ x, y } gry) albo null. */
    show(composer, im, sun) {
      albT.value = composer.targets.alb.texture;
      surfT.value = composer.targets.surf.texture;
      mesh.position.set(im.cx, -im.cy, 0.5);
      mesh.scale.set(im.w, im.h, 1);
      if (sun) uSun.value.set(sun.x - im.cx, -(sun.y - im.cy));
      mesh.visible = true;
    },
    hide() { mesh.visible = false; },
    /** Rozgrzewka pipeline'u w passie gry (przed pierwszym przeciąganiem). */
    warm(composer) {
      albT.value = composer.targets.alb.texture;
      surfT.value = composer.targets.surf.texture;
      return Core3D.prewarmPass(mesh, 0);
    }
  };
}
