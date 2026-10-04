// ============================================================
// Widok 3D gry (kamera perspektywy w swobodnej pozie) — czysta matematyka, bez three i DOM.
//
// Układy: świat GRY (x, y w dół ekranu, z w górę ku kamerze „z góry”) i świat THREE
// (Core3D: x, −y, z). Poza kamery (oko, cel, góra) jest w układzie THREE — tak, jak dostaje
// ją Core3D (`mode: 'free3d'`, position + quaternion); rzutowanie i promienie przyjmują
// i oddają punkty w układzie GRY (x, y, z), bo tym liczy cała reszta gry.
//
// Kamera three patrzy wzdłuż −Z swojego układu: kolumny macierzy obrotu to (prawo, góra, −przód).
// Rzut: głębia = (p − oko)·przód, ekran = środek ± (xc / głębia) · ogniskowa, ogniskowa =
// (wys / 2) / tan(fov / 2) — ta sama, której używa PerspectiveCamera z pionowym fov.
// ============================================================

const DEG = Math.PI / 180;

function normalize3(v) {
  const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (l > 1e-12) { v.x /= l; v.y /= l; v.z /= l; }
  return v;
}

function cross3(a, b, out) {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  out.x = x; out.y = y; out.z = z;
  return out;
}

/** Kwaternion z macierzy obrotu o kolumnach (a, b, c) — wzór Shepperda (jak three Quaternion.setFromRotationMatrix). */
export function quatFromBasis(a, b, c, out) {
  const m11 = a.x, m12 = b.x, m13 = c.x;
  const m21 = a.y, m22 = b.y, m23 = c.y;
  const m31 = a.z, m32 = b.z, m33 = c.z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    out.w = 0.25 / s;
    out.x = (m32 - m23) * s;
    out.y = (m13 - m31) * s;
    out.z = (m21 - m12) * s;
  } else if (m11 > m22 && m11 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);
    out.w = (m32 - m23) / s;
    out.x = 0.25 * s;
    out.y = (m12 + m21) / s;
    out.z = (m13 + m31) / s;
  } else if (m22 > m33) {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);
    out.w = (m13 - m31) / s;
    out.x = (m12 + m21) / s;
    out.y = 0.25 * s;
    out.z = (m23 + m32) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);
    out.w = (m21 - m12) / s;
    out.x = (m13 + m31) / s;
    out.y = (m23 + m32) / s;
    out.z = 0.25 * s;
  }
  return out;
}

/**
 * Stan widoku jednej kamery. Jeden egzemplarz na grę (View3D) — rzutowanie nakładek 2D, promień
 * spod kursora i pudło cullingu czytają go w tej samej klatce, w której ustawił go render().
 */
export class ViewState3D {
  constructor() {
    this.active = false;
    this.mode = 'classic';
    // Poza w układzie THREE.
    this.eye = { x: 0, y: 0, z: 1000 };
    this.target = { x: 0, y: 0, z: 0 };
    this.fwd = { x: 0, y: 0, z: -1 };
    this.right = { x: 1, y: 0, z: 0 };
    this.up = { x: 0, y: 1, z: 0 };
    this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
    this.fov = 45;
    this.near = 10;
    this.far = 4e7;
    this.width = 1920;
    this.height = 1080;
    this.offsetX = 0;
    this.offsetY = 0;
    this.focal = 1;         // px na jednostkę przy głębi 1
    this.distance = 1000;   // oko → cel
  }

  /**
   * Ustawia pozę z oka i celu (układ THREE). up — wektor „do góry” kadru (przybliżony; zostanie
   * ortogonalizowany). Zwraca this.
   */
  setLookAt(eye, target, up, fov, width, height, near, far) {
    this.eye.x = eye.x; this.eye.y = eye.y; this.eye.z = eye.z;
    this.target.x = target.x; this.target.y = target.y; this.target.z = target.z;
    const f = this.fwd;
    f.x = target.x - eye.x; f.y = target.y - eye.y; f.z = target.z - eye.z;
    this.distance = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z) || 1;
    normalize3(f);
    const r = cross3(f, up, this.right);
    if (r.x * r.x + r.y * r.y + r.z * r.z < 1e-10) {
      // góra równoległa do kierunku patrzenia — dowolna prostopadła
      const alt = Math.abs(f.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
      cross3(f, alt, r);
    }
    normalize3(r);
    cross3(r, f, this.up);
    normalize3(this.up);
    const back = { x: -f.x, y: -f.y, z: -f.z };
    quatFromBasis(r, this.up, back, this.quaternion);
    this.fov = Math.max(1, Math.min(170, Number(fov) || 45));
    this.width = Math.max(1, Number(width) || 1);
    this.height = Math.max(1, Number(height) || 1);
    this.near = Math.max(0.01, Number(near) || 1);
    this.far = Math.max(this.near + 1, Number(far) || 1e7);
    this.focal = (this.height * 0.5) / Math.tan(this.fov * 0.5 * DEG);
    return this;
  }

  /**
   * Punkt GRY (x, y, z) → ekran. out: x, y (px, z przesunięciem widoku), depth (j. świata wzdłuż
   * kierunku patrzenia; ≤ near = za kamerą), scale (px na jednostkę świata na tej głębi),
   * visible (przed kamerą i w kadrze z marginesem 10%).
   */
  project(gx, gy, gz, out) {
    const px = gx - this.eye.x;
    const py = -gy - this.eye.y;
    const pz = (gz || 0) - this.eye.z;
    const f = this.fwd, r = this.right, u = this.up;
    const depth = px * f.x + py * f.y + pz * f.z;
    const xc = px * r.x + py * r.y + pz * r.z;
    const yc = px * u.x + py * u.y + pz * u.z;
    const d = depth > this.near * 0.5 ? depth : this.near * 0.5;
    const k = this.focal / d;
    out.x = this.offsetX + this.width * 0.5 + xc * k;
    out.y = this.offsetY + this.height * 0.5 - yc * k;
    out.depth = depth;
    out.scale = k;
    const mx = this.width * 0.1;
    const my = this.height * 0.1;
    out.visible = depth > this.near
      && out.x > this.offsetX - mx && out.x < this.offsetX + this.width + mx
      && out.y > this.offsetY - my && out.y < this.offsetY + this.height + my;
    return out;
  }

  /** Promień spod punktu ekranu (px) → out: ox, oy, oz (oko) i dx, dy, dz (kierunek, jednostkowy) — układ GRY. */
  ray(sx, sy, out) {
    const nx = (sx - this.offsetX - this.width * 0.5) / this.focal;
    const ny = -(sy - this.offsetY - this.height * 0.5) / this.focal;
    const f = this.fwd, r = this.right, u = this.up;
    let dx = f.x + r.x * nx + u.x * ny;
    let dy = f.y + r.y * nx + u.y * ny;
    let dz = f.z + r.z * nx + u.z * ny;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= l; dy /= l; dz /= l;
    out.ox = this.eye.x; out.oy = -this.eye.y; out.oz = this.eye.z;
    out.dx = dx; out.dy = -dy; out.dz = dz;
    return out;
  }

  /**
   * Punkt pod kursorem na płaszczyźnie z = planeZ (układ GRY). Promień równoległy do płaszczyzny
   * albo przecięcie za kamerą / dalej niż maxDist → punkt na promieniu w odległości maxDist.
   * out: x, y, z, t (odległość od oka), onPlane.
   */
  pointOnPlaneZ(sx, sy, planeZ, maxDist, out, rayScratch) {
    const ray = this.ray(sx, sy, rayScratch || {});
    const lim = Math.max(1, Number(maxDist) || this.far);
    let t = lim;
    let onPlane = false;
    if (Math.abs(ray.dz) > 1e-6) {
      const tp = (planeZ - ray.oz) / ray.dz;
      if (tp > 0 && tp < lim) { t = tp; onPlane = true; }
    }
    out.x = ray.ox + ray.dx * t;
    out.y = ray.oy + ray.dy * t;
    out.z = onPlane ? planeZ : ray.oz + ray.dz * t;
    out.t = t;
    out.onPlane = onPlane;
    return out;
  }

  /**
   * Przybliżone pudło widoku w płaszczyźnie gry (środek i pół-wymiary, układ GRY) do cullingu 2D:
   * rzut stożka widzenia do odległości reach na płaszczyznę z = 0 (bez obcinania dołem — obejmuje
   * wszystko, co kamera może widzieć bliżej niż reach).
   */
  groundBox(reach, out) {
    const R = Math.max(1, reach);
    const e = this.eye;
    let minX = e.x, maxX = e.x, minY = -e.y, maxY = -e.y;
    const tanV = Math.tan(this.fov * 0.5 * DEG);
    const tanH = tanV * (this.width / this.height);
    const f = this.fwd, r = this.right, u = this.up;
    for (let i = 0; i < 4; i++) {
      const sxn = (i & 1) ? 1 : -1;
      const syn = (i & 2) ? 1 : -1;
      let dx = f.x + r.x * sxn * tanH + u.x * syn * tanV;
      let dy = f.y + r.y * sxn * tanH + u.y * syn * tanV;
      let dz = f.z + r.z * sxn * tanH + u.z * syn * tanV;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      dx /= l; dy /= l; dz /= l;
      // Do płaszczyzny z = 0, jeśli promień w nią trafia bliżej niż R; inaczej punkt w odległości R.
      let t = R;
      if (dz < -1e-6) t = Math.min(R, -e.z / dz);
      if (t < 0) t = R;
      const gx = e.x + dx * t;
      const gy = -(e.y + dy * t);
      if (gx < minX) minX = gx; if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy; if (gy > maxY) maxY = gy;
    }
    out.x = (minX + maxX) * 0.5;
    out.y = (minY + maxY) * 0.5;
    out.halfW = (maxX - minX) * 0.5;
    out.halfH = (maxY - minY) * 0.5;
    return out;
  }

  /** Obiekt kamery dla Core3D.syncCamera (tryb free3d) — pola czytane przez Core3D i moduły 3D. */
  writeCoreCamera(out) {
    out.mode = 'free3d';
    out.position = out.position || { x: 0, y: 0, z: 0 };
    out.quaternion = out.quaternion || { x: 0, y: 0, z: 0, w: 1 };
    out.position.x = this.eye.x; out.position.y = this.eye.y; out.position.z = this.eye.z;
    out.quaternion.x = this.quaternion.x; out.quaternion.y = this.quaternion.y;
    out.quaternion.z = this.quaternion.z; out.quaternion.w = this.quaternion.w;
    out.fov = this.fov;
    out.near = this.near;
    out.far = this.far;
    out.eyeGameX = this.eye.x;
    out.eyeGameY = -this.eye.y;
    out.eyeGameZ = this.eye.z;
    out.distance = this.distance;
    return out;
  }
}

/** Jedyny widok gry (gracz 1). render() ustawia go co klatkę; poza trybem 3D active = false. */
export const View3D = new ViewState3D();
