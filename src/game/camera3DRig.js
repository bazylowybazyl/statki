// ============================================================
// Kamery 3D gry (jak w demie Atlasa 3D, dema/atlas3d-webgpu/lot.js) — czysta logika, bez three.
//
// Tryby:
//   classic  — dawna kamera gry (ortho + perspektywa z góry, Core3D bez free3d); rig 3D nic nie liczy
//   top      — z góry w perspektywie (FOV 35°, wysokość jak kamera perspektywy Core3D przy zoomie gry),
//              patrzy na cel dawnej kamery (offsety riga statku zostają) na wysokości statku
//   tactical — kamera gry pochylona (3/4): pochylenie `tilt`, azymut `az` (opcjonalnie za kursem)
//   chase    — pościg za rufą; w locie 6DoF kamera obraca się razem ze statkiem (góra = góra kadłuba)
//   orbit    — swobodna orbita wokół statku (az / el przeciąganiem)
//   cinema   — samoczynny przelot wokół statku
//
// Odległość z zoomu gry: dist = ogniskowa(FOV 35°, wys. kadru) / zoom — ta sama liczba, którą
// kamera perspektywy Core3D wisi dziś nad płaszczyzną, więc kółko i sprężyna zoomu działają dalej.
// Wszystkie wektory w układzie THREE (x, −y gry, z).
// ============================================================

const DEG = Math.PI / 180;

export const CAMERA3D_MODES = Object.freeze(['classic', 'top', 'tactical', 'chase', 'orbit', 'cinema']);
export const CAMERA3D_LABELS = Object.freeze({
  classic: 'Klasyczna 2D',
  top: 'Z góry 3D',
  tactical: 'Taktyczna 3/4',
  chase: 'Pościg',
  orbit: 'Orbita',
  cinema: 'Kino'
});

export const CAMERA3D_DEFAULTS = Object.freeze({
  topFov: 35,          // jak kamera perspektywy Core3D
  fov: 50,             // pozostałe tryby
  tilt: 52,            // ° pochylenia kamery taktycznej (0 = z góry)
  tiltMin: 5,
  tiltMax: 85,
  chaseDistMul: 0.55,  // pościg: odległość względem dist z zoomu
  chaseElevation: 14,  // ° nad osią rufy
  chaseLift: 0.06,     // dodatkowe uniesienie (× odległość)
  chaseLookAhead: 0.35,// punkt patrzenia przed dziobem (× odległość)
  chaseSpring: 3.2,    // 1/s — sprężyna pozycji pościgu
  upSpring: 2.4,       // 1/s — sprężyna „góry” w pościgu 6DoF
  tacticalSpring: 5,   // 1/s
  orbitEl: 24,         // ° domyślne wzniesienie orbity
  cinemaSpeed: 0.07,   // rad/s
  nearMul: 0.006,      // near = dist · nearMul (w granicach)
  nearMin: 4,
  nearMax: 600,
  far: 4e7             // świat 12 mln j., Słońce i planety daleko
});

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function focalForFov(fovDeg, viewH) {
  return (Math.max(1, viewH) * 0.5) / Math.tan(fovDeg * 0.5 * DEG);
}

/** Odległość kamery z zoomu gry (zoom 1 → wysokość kamery perspektywy Core3D, FOV 35°). */
export function distanceForZoom(zoom, viewH, cfg = CAMERA3D_DEFAULTS) {
  return focalForFov(cfg.topFov, viewH) / Math.max(1e-4, Number(zoom) || 1);
}

export function createCamera3DRig(opts = {}) {
  return {
    mode: opts.mode && CAMERA3D_MODES.includes(opts.mode) ? opts.mode : 'chase',
    tilt: CAMERA3D_DEFAULTS.tilt,
    az: 0,                 // ° azymut (taktyczna, orbita); 0 = kamera od „południa” (+y gry), góra kadru = północ
    el: CAMERA3D_DEFAULTS.orbitEl,
    followHeading: false,  // taktyczna: azymut za kursem statku
    cine: 0,
    // Stan sprężyn (THREE).
    pos: { x: 0, y: 0, z: 0 },
    look: { x: 0, y: 0, z: 0 },
    upv: { x: 0, y: 0, z: 1 },
    first: true,
    // Wynik (THREE).
    eye: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    up: { x: 0, y: 0, z: 1 },
    fov: CAMERA3D_DEFAULTS.fov,
    near: 10,
    far: CAMERA3D_DEFAULTS.far,
    dist: 1000
  };
}

export function setCamera3DMode(rig, mode) {
  if (!CAMERA3D_MODES.includes(mode) || rig.mode === mode) return false;
  rig.mode = mode;
  rig.first = true;
  return true;
}

export function cycleCamera3DMode(rig, dir = 1) {
  const i = CAMERA3D_MODES.indexOf(rig.mode);
  const n = CAMERA3D_MODES.length;
  const next = CAMERA3D_MODES[((i < 0 ? 0 : i) + (dir < 0 ? n - 1 : 1)) % n];
  setCamera3DMode(rig, next);
  return next;
}

/** Przeciąganie myszą (px): taktyczna — azymut i pochylenie, orbita / pościg — azymut i wzniesienie. */
export function dragCamera3D(rig, dxPx, dyPx) {
  const k = 0.25;
  if (rig.mode === 'tactical') {
    rig.az -= dxPx * k;
    rig.tilt = clamp(rig.tilt - dyPx * k, CAMERA3D_DEFAULTS.tiltMin, CAMERA3D_DEFAULTS.tiltMax);
  } else if (rig.mode === 'orbit' || rig.mode === 'cinema') {
    if (rig.mode === 'cinema') rig.mode = 'orbit';
    rig.az -= dxPx * k;
    rig.el = clamp(rig.el + dyPx * k, -85, 85);
  }
}

const _tmpA = { x: 0, y: 0, z: 0 };

/**
 * Krok riga. input:
 *   dt, viewH, zoom                     — kadr i zoom gry
 *   ship: { x, y, z }                    — statek w układzie THREE (środek kadłuba)
 *   fwd: { x, y, z }, upB: { x, y, z }   — dziób i góra kadłuba (THREE, jednostkowe)
 *   heading                              — kurs w THREE (rad, obrót wokół +Z; = −angle gry)
 *   focus: { x, y }                      — cel dawnej kamery (THREE, z offsetem riga statku) — tryb top
 *   sixDof                               — lot 6DoF (pościg bierze górę kadłuba)
 * Wynik w rig.eye / rig.target / rig.up / rig.fov / rig.near / rig.far.
 */
export function stepCamera3DRig(rig, input, cfg = CAMERA3D_DEFAULTS) {
  const dt = Math.max(0, Number(input.dt) || 0);
  const viewH = Math.max(1, Number(input.viewH) || 1080);
  const dist = distanceForZoom(input.zoom, viewH, cfg);
  rig.dist = dist;
  const s = input.ship;
  const want = _tmpA;
  let lookX = s.x, lookY = s.y, lookZ = s.z;
  let upX = 0, upY = 0, upZ = 1;
  let snap = false;
  let spring = cfg.tacticalSpring;
  let fov = cfg.fov;
  let d = dist;
  switch (rig.mode) {
    case 'top': {
      const fx = input.focus ? input.focus.x : s.x;
      const fy = input.focus ? input.focus.y : s.y;
      lookX = fx; lookY = fy; lookZ = s.z;
      // prawie prostopadle (0,05° odchyłki na południe — stabilna góra kadru = północ)
      want.x = fx; want.y = fy - dist * 0.0009; want.z = s.z + dist;
      upX = 0; upY = 1; upZ = 0;
      fov = cfg.topFov;
      snap = true;
      break;
    }
    case 'tactical': {
      // za kursem: kamera za rufą (az = kurs − 90°, bo az = 0 to kamera na południu)
      const az = ((rig.followHeading ? (Number(input.heading) || 0) / DEG - 90 : 0) + rig.az) * DEG;
      const t = rig.tilt * DEG;
      const fx = input.focus ? input.focus.x : s.x;
      const fy = input.focus ? input.focus.y : s.y;
      lookX = fx; lookY = fy; lookZ = s.z;
      // az = 0: kamera na południu (−Y three), patrzy na północ
      want.x = fx + Math.sin(az) * Math.sin(t) * dist;
      want.y = fy - Math.cos(az) * Math.sin(t) * dist;
      want.z = s.z + Math.cos(t) * dist;
      fov = cfg.topFov + (cfg.fov - cfg.topFov) * Math.min(1, rig.tilt / 60);
      break;
    }
    case 'chase': {
      const f = input.fwd;
      const ub = input.sixDof && input.upB ? input.upB : null;
      // góra kadru: w 6DoF sprężyna ku górze kadłuba, w locie poziomym pion świata
      if (ub) {
        const k = rig.first ? 1 : 1 - Math.exp(-dt * cfg.upSpring);
        rig.upv.x += (ub.x - rig.upv.x) * k;
        rig.upv.y += (ub.y - rig.upv.y) * k;
        rig.upv.z += (ub.z - rig.upv.z) * k;
      } else {
        const k = rig.first ? 1 : 1 - Math.exp(-dt * cfg.upSpring);
        rig.upv.x += (0 - rig.upv.x) * k;
        rig.upv.y += (0 - rig.upv.y) * k;
        rig.upv.z += (1 - rig.upv.z) * k;
      }
      const ul = Math.sqrt(rig.upv.x ** 2 + rig.upv.y ** 2 + rig.upv.z ** 2) || 1;
      upX = rig.upv.x / ul; upY = rig.upv.y / ul; upZ = rig.upv.z / ul;
      d = dist * cfg.chaseDistMul;
      const el = cfg.chaseElevation * DEG;
      const back = d * Math.cos(el);
      const lift = d * Math.sin(el) + d * cfg.chaseLift;
      want.x = s.x - f.x * back + upX * lift;
      want.y = s.y - f.y * back + upY * lift;
      want.z = s.z - f.z * back + upZ * lift;
      const ahead = d * cfg.chaseLookAhead;
      lookX = s.x + f.x * ahead + upX * d * 0.03;
      lookY = s.y + f.y * ahead + upY * d * 0.03;
      lookZ = s.z + f.z * ahead + upZ * d * 0.03;
      spring = cfg.chaseSpring;
      break;
    }
    case 'cinema': {
      rig.cine += dt;
      const a = rig.cine * cfg.cinemaSpeed + 0.6;
      const e = (18 + Math.sin(rig.cine * 0.13) * 12) * DEG;
      d = dist * (0.8 + 0.15 * Math.sin(rig.cine * 0.05));
      want.x = s.x + Math.cos(a) * Math.cos(e) * d;
      want.y = s.y + Math.sin(a) * Math.cos(e) * d;
      want.z = s.z + Math.sin(e) * d;
      spring = 2;
      break;
    }
    case 'orbit':
    default: {
      const a = (rig.az - 90) * DEG;
      const e = rig.el * DEG;
      want.x = s.x + Math.cos(a) * Math.cos(e) * dist;
      want.y = s.y + Math.sin(a) * Math.cos(e) * dist;
      want.z = s.z + Math.sin(e) * dist;
      snap = true;
      break;
    }
  }
  const kp = snap || rig.first ? 1 : 1 - Math.exp(-dt * spring);
  const kl = snap || rig.first ? 1 : 1 - Math.exp(-dt * 8);
  // Sprężyna liczy względem statku (pościg za szybkim okrętem nie zostaje w tyle o drogę klatki):
  // stan = offset od statku, nie pozycja świata.
  if (rig.first) {
    rig.pos.x = want.x - s.x; rig.pos.y = want.y - s.y; rig.pos.z = want.z - s.z;
    rig.look.x = lookX - s.x; rig.look.y = lookY - s.y; rig.look.z = lookZ - s.z;
  } else {
    rig.pos.x += (want.x - s.x - rig.pos.x) * kp;
    rig.pos.y += (want.y - s.y - rig.pos.y) * kp;
    rig.pos.z += (want.z - s.z - rig.pos.z) * kp;
    rig.look.x += (lookX - s.x - rig.look.x) * kl;
    rig.look.y += (lookY - s.y - rig.look.y) * kl;
    rig.look.z += (lookZ - s.z - rig.look.z) * kl;
  }
  rig.first = false;
  rig.eye.x = s.x + rig.pos.x; rig.eye.y = s.y + rig.pos.y; rig.eye.z = s.z + rig.pos.z;
  rig.target.x = s.x + rig.look.x; rig.target.y = s.y + rig.look.y; rig.target.z = s.z + rig.look.z;
  rig.up.x = upX; rig.up.y = upY; rig.up.z = upZ;
  rig.fov = fov;
  const ed = Math.sqrt((rig.eye.x - rig.target.x) ** 2 + (rig.eye.y - rig.target.y) ** 2 + (rig.eye.z - rig.target.z) ** 2);
  rig.near = clamp(ed * cfg.nearMul, cfg.nearMin, cfg.nearMax);
  rig.far = cfg.far;
  return rig;
}
