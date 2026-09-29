// src/3d/ships3d/shipMaterials3D.tsl.js
//
// MATERIAŁY TSL modeli 3D okrętów i broni (demo dema/atlas3d-webgpu.html). WebGPU, bez GLSL.
//
// JEDEN graf na rodzaj (kadłub z pokładem / broń bez pokładu), barwy i połysk z palety
// indeksowanej atrybutem `aMat` (SHIP3D_MAT, meshBuilder3D.js) — kadłub i wszystkie wieże
// to po jednym materiale, bez grafu na obiekt (docs/webgpu/PLAN.md §3).
//
// POKŁAD (aMat = 0): tekstura sprite'a gry z rzutu z góry (uv z budowniczego) i mapa
// normalnych z luminancji sprite'a (jasne płyty wyżej, ciemne rowki niżej) — z góry model
// wygląda jak sprite, a skośne światło wydobywa rysunek płyt.
// RESZTA: barwa palety + proceduralne szwy paneli (uv = rzut pudełkowy w px sprite'a),
// odcień płyt z hasha komórki; świecące paski (E_*) w emisji (bloom gry), wnętrza dysz
// z mnożnikiem ciągu `uniforms.engine`.

import * as THREE from 'three/webgpu';
import {
  Fn, attribute, uv, texture, uniform, uniformArray, vec2, vec3, float, int,
  mix, step, smoothstep, fract, floor, min, max, clamp, dot, fwidth, normalize, pow, abs,
  normalLocal, normalView, positionViewDirection, transformNormalToView
} from 'three/tsl';
import { SHIP3D_MAT as M, SHIP3D_MAT_COUNT } from './meshBuilder3D.js';

// Paleta: barwa (sRGB), szorstkość, metaliczność, emisja (barwa sRGB + moc), szwy paneli (0..1).
const PAL = [];
const def = (id, color, rough, metal, o = {}) => { PAL[id] = { color, rough, metal, emissive: o.emissive || '#000000', power: o.power || 0, seams: o.seams ?? 1 }; };
def(M.DECK, '#808080', 0.58, 0.35);
def(M.PAINT, '#4b535f', 0.6, 0.38);
def(M.PANEL, '#363c46', 0.66, 0.34);
def(M.DARK, '#1c2026', 0.55, 0.45, { seams: 0.6 });
def(M.STEEL, '#6b7482', 0.58, 0.35, { seams: 0.7 });
def(M.METAL, '#5b626c', 0.3, 0.85, { seams: 0.25 });
def(M.BRIGHT, '#959eaa', 0.42, 0.5, { seams: 0.3 });
def(M.GLASS, '#0a1018', 0.08, 0.3, { seams: 0 });
def(M.TRIM, '#2c8ca4', 0.48, 0.25, { seams: 0.4 });
def(M.E_CYAN, '#10232b', 0.4, 0.2, { emissive: '#4fdcff', power: 4.4, seams: 0 });
def(M.E_AMBER, '#2b2210', 0.4, 0.2, { emissive: '#ffaa3c', power: 4.5, seams: 0 });
def(M.E_RED, '#2b1010', 0.4, 0.2, { emissive: '#ff3232', power: 4.2, seams: 0 });
def(M.E_MINT, '#102b20', 0.4, 0.2, { emissive: '#6dffc0', power: 4.5, seams: 0 });
def(M.E_MAGENTA, '#2b1026', 0.4, 0.2, { emissive: '#ff4fd8', power: 4.4, seams: 0 });
def(M.E_TURQ, '#102b28', 0.4, 0.2, { emissive: '#2fffe0', power: 4.4, seams: 0 });
def(M.E_WHITE, '#2a2a2a', 0.4, 0.2, { emissive: '#ffffff', power: 4.0, seams: 0 });
def(M.E_ENGINE, '#101a2b', 0.4, 0.2, { emissive: '#4c9dff', power: 3.2, seams: 0 });
def(M.E_ICE, '#10262b', 0.4, 0.2, { emissive: '#a8f4ff', power: 2.6, seams: 0 });
def(M.E_WINDOW, '#2b2518', 0.3, 0.1, { emissive: '#ffdcaa', power: 2.6, seams: 0 });
def(M.HANGAR, '#07090c', 0.8, 0.1, { emissive: '#ffb060', power: 0.35, seams: 0 });

/** Paleta w postaci danych (eksport GLB, testy). */
export const SHIP3D_PALETTE = Object.freeze(PAL.map((p) => Object.freeze({ ...p })));

// Hash 2D bez sinusa (Hoskins) — płyty paneli.
const hash12 = Fn(([p]) => {
  const q = fract(p.mul(vec2(0.1031, 0.1030))).toVar();
  const r = q.add(dot(q, q.yx.add(33.33)));
  return fract(r.x.add(r.y).mul(r.x));
});

/**
 * Materiał okrętu. deckMap — tekstura sprite'a (pokład), deckNormalMap — normalne z
 * luminancji (createDeckNormalTexture); bez deckMap materiał broni (bez gałęzi pokładu).
 * @returns {THREE.MeshStandardNodeMaterial} z `userData.uniforms` (engine, seams, bump, emissive)
 */
export function createShipMaterial(o = {}) {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.name = o.name || (o.deckMap ? 'okręt 3D (pokład)' : 'broń 3D');

  const u = {
    engine: uniform(o.engine ?? 1),        // moc wnętrz dysz (0..~2, ciąg)
    seams: uniform(o.seams ?? 1),          // siła szwów paneli
    bump: uniform(o.bump ?? 0.55),         // siła mapy normalnych pokładu
    emissive: uniform(o.emissiveGain ?? 1), // mnożnik wszystkich świateł
    deck: uniform(1),                      // 1 — pokład z tekstury sprite'a, 0 — gładka farba (porównanie brył)
    rim: uniform(o.rim ?? 1),              // chłodne podświetlenie krawędzi (sylwetka na tle kosmosu)
    panel: uniform(new THREE.Vector2(o.panelW ?? 88, o.panelH ?? 30)) // rozmiar płyty (px sprite'a)
  };

  const colors = uniformArray(PAL.map((p) => new THREE.Color(p.color)), 'color');
  const pbr = uniformArray(PAL.map((p) => new THREE.Vector4(p.rough, p.metal, p.power, p.seams)), 'vec4');
  const emis = uniformArray(PAL.map((p) => new THREE.Color(p.emissive)), 'color');

  const aMat = attribute('aMat', 'float');
  const id = clamp(aMat.add(0.5), 0, SHIP3D_MAT_COUNT - 1).toInt();
  const P = pbr.element(id);

  // --- szwy paneli (uv w px; cegiełkowo, co drugi rząd przesunięty o pół płyty) ---
  // Same wyrażenia (bez przypisań) — graf poza Fn(); pochodne bez gałęzi.
  const p = uv();
  const cell = u.panel;
  const row = floor(p.y.div(cell.y));
  const wRow = mix(float(0.6), float(1.9), hash12(vec2(row, 17.0))).mul(cell.x); // szerokość płyt w rzędzie
  const g = vec2(p.x.div(wRow).add(hash12(vec2(row, 5.0))), p.y.div(cell.y));
  const cellId = floor(g);
  const f = fract(g);
  const dEdge = min(min(f.x, f.x.oneMinus()).mul(wRow), min(f.y, f.y.oneMinus()).mul(cell.y));
  const aa = fwidth(p.x).add(fwidth(p.y)).mul(0.6).add(1e-4); // px na piksel ekranu
  const seam = smoothstep(float(0.35), aa.mul(1.4).add(0.9), dEdge).oneMinus();
  const far = smoothstep(1.4, 4.0, aa).oneMinus(); // daleko szwy gasną (bez mory)
  const tint = hash12(cellId.add(vec2(float(id).mul(7.0), 311.0))).sub(0.5).mul(0.16).add(1.0);
  const seamK = seam.mul(far).mul(P.w).mul(u.seams);
  const palColor = colors.element(id).mul(tint).mul(seamK.mul(0.42).oneMinus());

  // --- emisja ---
  const isEngine = step(float(M.E_ENGINE - 0.5), aMat).mul(step(aMat, float(M.E_ENGINE + 0.5)));
  const power = P.z.mul(mix(float(1), u.engine, isEngine)).mul(u.emissive);
  // Krawędź sylwetki: (1 − |n·v|)⁴ w chłodnym odcieniu — okręt nie znika w cieniu na czarnym tle.
  const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0.0), 4.0);
  mat.emissiveNode = emis.element(id).mul(power).add(vec3(0.030, 0.042, 0.062).mul(rim).mul(u.rim));

  if (o.deckMap) {
    const deckMask = step(aMat, float(0.5));
    const tex = texture(o.deckMap, uv());
    const lum = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    const deckColor = mix(colors.element(int(M.PAINT)).mul(1.15), tex.rgb, u.deck);
    mat.colorNode = mix(palColor, deckColor, deckMask);
    // Jaśniejsze płyty gładsze (lakier), ciemne szczeliny matowe.
    mat.roughnessNode = mix(P.x, float(0.72).sub(lum.mul(0.35)), deckMask);
    mat.metalnessNode = P.y;
    if (o.deckNormalMap) {
      const nm = texture(o.deckNormalMap, uv()).xy.mul(2).sub(1);
      const up = step(0.5, normalLocal.z).mul(deckMask).mul(u.bump);
      const n = normalize(normalLocal.add(vec3(nm.x, nm.y, 0).mul(up)));
      mat.normalNode = transformNormalToView(n);
    }
  } else {
    mat.colorNode = palColor;
    mat.roughnessNode = P.x;
    mat.metalnessNode = P.y;
  }

  mat.userData.uniforms = u;
  return mat;
}

/**
 * Mapa normalnych pokładu z luminancji sprite'a (jak kadlub.js dema tarczy): wysokość =
 * jasność × alfa, Sobel, połowa rozdzielczości. Tylko przeglądarka (kanwa 2D).
 */
export function createDeckNormalTexture(image, strength = 2.4) {
  const W = Math.ceil(image.naturalWidth / 2);
  const H = Math.ceil(image.naturalHeight / 2);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  c2.drawImage(image, 0, 0, W, H);
  const img = c2.getImageData(0, 0, W, H);
  const d = img.data;
  const h = new Float32Array(W * H);
  for (let i = 0, n = W * H; i < n; i++) {
    const a = d[i * 4 + 3] / 255;
    h[i] = ((0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255) * a + a * 0.35;
  }
  const at = (x, y) => h[(y < 0 ? 0 : (y >= H ? H - 1 : y)) * W + (x < 0 ? 0 : (x >= W ? W - 1 : x))];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      // Oś y obrazka w dół, w modelu +Y w górę obrazka: ny = +gy.
      let nx = -gx * strength; let ny = gy * strength; let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const o = (y * W + x) * 4;
      d[o] = (nx * 0.5 + 0.5) * 255;
      d[o + 1] = (ny * 0.5 + 0.5) * 255;
      d[o + 2] = (nz * 0.5 + 0.5) * 255;
      d[o + 3] = 255;
    }
  }
  c2.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Tekstura sprite'a pokładu (sRGB, mipmapy, anizotropia). */
export function createDeckTexture(image, anisotropy = 8) {
  const tex = new THREE.Texture(image);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}
