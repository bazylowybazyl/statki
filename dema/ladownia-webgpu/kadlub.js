// ============================================================
// Kadłub dema ładowni: kwad ze sprite'a gry w grupie statku (układ Core3D: pozycja (x, −y)
// gry, obrót −kąt), światło jak kadłub gry (otoczenie 0,24, rozproszone 1,18 z „poduszkową”
// normalną z uv, połysk 0,30, podbicie niebieskich świateł sprite'a jak isGlowing w
// hexShips3D.tsl.js) i DZIURY w otworach ładowni (odrzucone piksele + ciemna obwódka krawędzi)
// — pod nimi stoi wnętrze (src/3d/cargo/bay.tsl.js). W grze to samo zrobi skóra kadłuba na
// belkach (plan integracji: docs/webgpu/DEMO-LADOWNIA.md).
//
// Jeden graf materiału na wszystkie kadłuby; klony z `material.uniforms` (sprite przez
// teksturaObiektu, prostokąty ładowni, obrót statku) — jeden program.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  Discard, Fn, If, abs, float, length, max, min, mix, normalize, smoothstep, step, uniform, uv, vec2, vec3, vec4
} from 'three/tsl';
import { teksturaObiektu, teksturaZastepcza } from '../../src/3d/tsl/teksturaObiektu.js';
import { CARGO_LIGHT, cargoShade } from '../../src/3d/cargo/cargoLight.tsl.js';
import { cargoBayScale, cargoHullBays } from '../../src/data/cargoBays.js';

const MAX_HOLES = 4;
const perObject = (key, type, init) =>
  uniform(init, type).onObjectUpdate(({ material }) => material.uniforms?.[key]?.value ?? init);
const PLACEHOLDER = teksturaZastepcza(0, 0, 0, 0, THREE.SRGBColorSpace);

function sdBox(p, b) {
  const d = abs(p).sub(b);
  return length(max(d, vec2(0.0))).add(min(max(d.x, d.y), 0.0));
}

let _template = null;
function hullTemplate() {
  if (_template) return _template;
  const m = new THREE.NodeMaterial();
  m.name = 'Ladownia:kadlub';
  m.lights = false;
  m.fog = false;
  const uSize = perObject('uSize', 'vec4', new THREE.Vector4(100, 50, 0, 0));
  const uRot = perObject('uRot', 'vec4', new THREE.Vector4(1, 0, 0, 0));
  const holes = [];
  for (let i = 0; i < MAX_HOLES; i++) holes.push(perObject(`uHole${i}`, 'vec4', new THREE.Vector4(0, 0, -1, -1)));
  m.fragmentNode = Fn(() => {
    const t = uv().toVar();
    const spr = teksturaObiektu('uSprite', PLACEHOLDER, t).toVar();
    const P = t.sub(0.5).mul(uSize.xy).toVar();
    // Odległość od najbliższego otworu (ujemna w środku); puste wpisy mają pół-wymiary < 0.
    const d = float(1e6).toVar();
    for (const h of holes) {
      const inUse = step(0.0, h.z);
      d.assign(mix(d, min(d, sdBox(P.sub(h.xy), h.zw)), inUse));
    }
    If(spr.a.lessThan(0.5).or(d.lessThan(0.0)), () => { Discard(); });
    // Ciemna obwódka otworu (fazka krawędzi i cień krawędzi).
    const rim = mix(float(0.3), float(1.0), smoothstep(0.0, 2.4, d));
    const albedo = spr.rgb.mul(rim).toVar();
    const p = t.mul(2.0).sub(1.0);
    const Nl = normalize(vec3(p.x.mul(0.45), p.y.mul(0.45), 1.0));
    const c = uRot.x;
    const s = uRot.y;
    const Nw = normalize(vec3(Nl.x.mul(c).sub(Nl.y.mul(s)), Nl.x.mul(s).add(Nl.y.mul(c)), Nl.z));
    const col = cargoShade(albedo, Nw, CARGO_LIGHT.sunDir, float(1.0), float(1.0), vec3(0.0), float(1.0), float(32.0)).toVar();
    // isGlowing gry: niebieskie elementy sprite'a (okna, światła) świecą ×1,5 koloru w słońcu.
    const glowing = step(0.6, col.z).mul(step(col.x, 0.5));
    col.addAssign(col.mul(glowing).mul(1.5));
    return vec4(col, 1.0);
  })();
  _template = m;
  return m;
}

/** Wczytuje obraz (sprite gry). */
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Nie wczytano obrazu: ${url}`));
    img.src = url;
  });
}

/** Tekstura sprite'a (sRGB, mipmapy, anizotropia). */
export function spriteTexture(img, anisotropy = 8) {
  const tex = new THREE.Texture(img);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Statek dema: grupa (poza gry → Core3D), kwad kadłuba z dziurami ładowni.
 * hull — wpis CARGO_BAY_HULLS, tex — tekstura sprite'a.
 */
export function createHullShip(hull, tex) {
  const s = cargoBayScale(hull);
  const w = hull.png.w * s;
  const h = hull.png.h * s;
  const group = new THREE.Group();
  group.name = `Ladownia:${hull.label}`;
  const mat = hullTemplate().clone();
  mat.uniforms = {
    uSprite: { value: tex },
    uSize: { value: new THREE.Vector4(w, h, 0, 0) },
    uRot: { value: new THREE.Vector4(1, 0, 0, 0) }
  };
  const bays = cargoHullBays(hull);
  for (let i = 0; i < MAX_HOLES; i++) {
    const g = bays[i];
    mat.uniforms[`uHole${i}`] = { value: g ? new THREE.Vector4(g.cx, g.cy, g.halfA, g.halfB) : new THREE.Vector4(0, 0, -1, -1) };
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.name = 'Ladownia:kadlub';
  group.add(mesh);
  const ship = {
    hull, group, mesh, material: mat, width: w, height: h, scale: s,
    pose: { x: 0, y: 0, angle: 0 },
    place(x, y, angle = 0) {
      this.pose.x = x; this.pose.y = y; this.pose.angle = angle;
      group.position.set(x, -y, 0);
      group.rotation.z = -angle;
      group.updateMatrixWorld(true);
      mat.uniforms.uRot.value.set(Math.cos(-angle), Math.sin(-angle), 0, 0);
    }
  };
  return ship;
}
