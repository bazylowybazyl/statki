// ============================================================
// Kamery 3D gry 2D (2026-09-30) — SAM WIDOK: rozgrywka zostaje w płaszczyźnie (fizyka, sterowanie i trafienia
// jak w 2D), kamera pościgowa / orbita / kinowa / taktyczna / z góry patrzy na nią w perspektywie. index.html
// woła Game3D raz na klatkę renderu i z klawiszy. Bez three i DOM (poza localStorage w try/catch).
//
//   Game3D.frame(...)  — krok riga kamer (camera3DRig.js), poza widoku (View3D) i obiekt kamery
//                        dla Core3D / modułów 3D: { x, y, zoom, mode: 'free3d', position, quaternion, fov,
//                        near, far } albo null w kamerze klasycznej (dawny tor ortho + perspektywa z góry).
//   K / Shift+K        — następna / poprzednia kamera (domyślnie klasyczna — gra z góry jak dotąd);
//   strzałki           — obrót kamery (pościg i kino przechodzą w orbitę); Home — kamera domyślna.
// Podzielony ekran: zawsze kamera klasyczna (Core3D renderuje dwa kadry z kamer 2D).
// Dawna gra 3D (lot w 3D, 6DoF, kadłuby 3D) — wycofana; kopia: Documents/statki-gra3d-kopia-2026-09-30.zip.
// ============================================================
import { View3D } from './view3D.js';
import {
  CAMERA3D_DEFAULTS, CAMERA3D_LABELS, CAMERA3D_MODES,
  createCamera3DRig, cycleCamera3DMode, setCamera3DMode, stepCamera3DRig
} from './camera3DRig.js';

// Nowy klucz (dawny sc_camera3d_mode z wycofanej gry 3D startowałby w pościgu).
const STORE_CAM = 'sc_camera3d';

function loadPref(key, fallback) {
  try {
    const v = globalThis.localStorage?.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}
function savePref(key, value) {
  try { globalThis.localStorage?.setItem(key, String(value)); } catch { /* prywatne okno */ }
}

const DEG = Math.PI / 180;

export const Game3D = {
  rig: createCamera3DRig({ mode: 'classic' }),
  view: View3D,
  // Obiekt kamery free3d (jeden na grę — Core3D i moduły trzymają referencję tylko w klatce).
  coreCam: { x: 0, y: 0, zoom: 1, mode: 'free3d', position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, fov: 50, near: 10, far: 4e7 },
  _shipT: { x: 0, y: 0, z: 0 },
  _fwdT: { x: 1, y: 0, z: 0 },
  _upT: { x: 0, y: 0, z: 1 },
  _focusT: { x: 0, y: 0 },
  _rigIn: { dt: 0, viewH: 1080, zoom: 1, ship: null, fwd: null, upB: null, heading: 0, focus: null, sixDof: false },
  _loaded: false,
  focusEntity: null,

  load() {
    if (this._loaded) return;
    this._loaded = true;
    const mode = loadPref(STORE_CAM, 'classic');
    if (CAMERA3D_MODES.includes(mode)) this.rig.mode = mode;
  },

  get mode() { return this.rig.mode; },
  get label() { return CAMERA3D_LABELS[this.rig.mode] || this.rig.mode; },
  /** Czy ta klatka idzie kamerą 3D (free3d). */
  isFree(splitScreen = false) { return !splitScreen && this.rig.mode !== 'classic'; },

  cycleCamera(dir = 1) {
    const m = cycleCamera3DMode(this.rig, dir);
    savePref(STORE_CAM, m);
    return m;
  },
  setCamera(mode) {
    if (!setCamera3DMode(this.rig, mode)) return false;
    savePref(STORE_CAM, mode);
    return true;
  },
  resetCamera() {
    this.rig.az = 0;
    this.rig.tilt = CAMERA3D_DEFAULTS.tilt;
    this.rig.el = CAMERA3D_DEFAULTS.orbitEl;
    this.rig.first = true;
  },
  /** Obrót kamery strzałkami (°/s × dt): x — azymut, y — pochylenie / wzniesienie. */
  steerCamera(dx, dy, dt) {
    const rig = this.rig;
    const rate = 70 * dt;
    if (rig.mode === 'tactical') {
      rig.az -= dx * rate;
      rig.tilt = Math.max(CAMERA3D_DEFAULTS.tiltMin, Math.min(CAMERA3D_DEFAULTS.tiltMax, rig.tilt - dy * rate));
    } else if (rig.mode === 'orbit' || rig.mode === 'cinema' || rig.mode === 'chase') {
      if (rig.mode !== 'orbit' && (dx || dy)) {
        // z pościgu / kina strzałki przechodzą w orbitę od bieżącej strony statku
        rig.mode = 'orbit';
      }
      rig.az -= dx * rate;
      rig.el = Math.max(-85, Math.min(85, rig.el + dy * rate));
    }
  },

  /**
   * Klatka renderu. p:
   *   dt, W, H, zoom (camera.zoom gry), focusX / focusY (cel dawnej kamery z offsetem riga),
   *   ship: { x, y } (GRA, interpolowane), heading (kurs gry),
   *   shakeX / shakeY (px ekranu)
   * Zwraca obiekt kamery free3d albo null (klasyczna).
   */
  frame(p) {
    const rig = this.rig;
    if (!this.isFree(!!p.splitScreen)) {
      View3D.active = false;
      View3D.mode = 'classic';
      return null;
    }
    // Podgląd innej encji (narzędzia / konsola: Game3D.focusEntity = npc) — kamera krąży wokół niej.
    const fe = this.focusEntity;
    if (fe && !fe.dead) {
      p.ship = { x: fe.pos ? fe.pos.x : fe.x, y: fe.pos ? fe.pos.y : fe.y, z: Number(fe.z) || 0 };
      p.heading = Number(fe.angle) || 0;
      p.focusX = p.ship.x; p.focusY = p.ship.y;
    } else if (fe) this.focusEntity = null;
    const s = this._shipT;
    s.x = p.ship.x; s.y = -p.ship.y; s.z = Number(p.ship.z) || 0;
    // Statek w płaszczyźnie gry: dziób z kursu, góra = +z.
    const fwd = this._fwdT;
    const up = this._upT;
    const h = -(Number(p.heading) || 0);
    fwd.x = Math.cos(h); fwd.y = Math.sin(h); fwd.z = 0;
    up.x = 0; up.y = 0; up.z = 1;
    const focus = this._focusT;
    focus.x = Number.isFinite(p.focusX) ? p.focusX : p.ship.x;
    focus.y = -(Number.isFinite(p.focusY) ? p.focusY : p.ship.y);
    const inp = this._rigIn;
    inp.dt = p.dt;
    inp.viewH = p.H;
    inp.zoom = p.zoom;
    inp.ship = s;
    inp.fwd = fwd;
    inp.upB = up;
    inp.heading = -(Number(p.heading) || 0);
    inp.focus = focus;
    inp.sixDof = false;
    stepCamera3DRig(rig, inp);
    // Wstrząs (px ekranu) — przesunięcie oka i celu w płaszczyźnie kadru na odległości celu.
    let ex = rig.eye.x, ey = rig.eye.y, ez = rig.eye.z;
    let tx = rig.target.x, ty = rig.target.y, tz = rig.target.z;
    const shx = Number(p.shakeX) || 0, shy = Number(p.shakeY) || 0;
    if (shx || shy) {
      const dist = Math.hypot(tx - ex, ty - ey, tz - ez) || 1;
      const focal = (p.H * 0.5) / Math.tan(rig.fov * 0.5 * DEG);
      const k = dist / focal;
      // prawo / góra kadru z bieżącego View3D (poprzednia klatka — różnica pomijalna)
      const r = View3D.right, u = View3D.up;
      const ox = (r.x * shx - u.x * shy) * k, oy = (r.y * shx - u.y * shy) * k, oz = (r.z * shx - u.z * shy) * k;
      ex += ox; ey += oy; ez += oz; tx += ox; ty += oy; tz += oz;
    }
    View3D.setLookAt({ x: ex, y: ey, z: ez }, { x: tx, y: ty, z: tz }, rig.up, rig.fov, p.W, p.H, rig.near, rig.far);
    View3D.offsetX = 0;
    View3D.offsetY = 0;
    View3D.active = true;
    View3D.mode = rig.mode;
    const cam = this.coreCam;
    View3D.writeCoreCamera(cam);
    // Pola kamery 2D dla modułów, które liczą z (x, y, zoom): środek = statek, zoom gry (LOD).
    cam.x = p.ship.x;
    cam.y = p.ship.y;
    cam.zoom = p.zoom;
    cam.viewDistance = rig.dist;
    return cam;
  }
};
