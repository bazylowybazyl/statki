// ============================================================
// Kamera kinowa fabuły (2026-09-30) — tor przez klatki kluczowe, czysta matematyka (bez three i DOM).
//
// Klatka: { t (s od początku), eye {x,y,z}, target {x,y,z}, up? {x,y,z} (domyślnie +z), fov (°), stop? }.
// Układ THREE (jak View3D / Core3D free3d): x, −y gry, z ku kamerze „z góry”.
// Oko i cel: sześcienny Hermite w CZASIE (styczne z sąsiadów / różnica czasów) — prędkość ciągła także przy
// odcinkach różnej długości; `stop: true` zeruje styczną (kamera zwalnia do zera i rusza łagodnie — zawis
// przed nagłym najazdem). up i fov — liniowo z wygładzeniem. Po ostatniej klatce: poza ostatniej klatki.
//
// buildDockIntroKeys(p) — ujęcie „Ziemia z menu → do Ziemi → skos nad K-7 → pion nad halą w kadrze kamery gry”;
// dalej kamera 2D gry i otwarcie dachu (reżyser: src/game/story/storyGame.js). blendPose — mieszanie dwóch póz.
// ============================================================

const DEG = Math.PI / 180;

function v3(x = 0, y = 0, z = 0) { return { x, y, z }; }
function copy3(o, a) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
function len3(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }

function hermite(p0, m0, p1, m1, s, h) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return h00 * p0 + h10 * h * m0 + h01 * p1 + h11 * h * m1;
}

function smooth01(x) { return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x); }

/** Styczna (j./s) klatki i dla pola `key` (eye | target), osi `ax`. */
function tangent(keys, i, key, ax) {
  const k = keys[i];
  if (k.stop) return 0;
  const prev = keys[i - 1];
  const next = keys[i + 1];
  if (!prev && !next) return 0;
  if (!prev) return 0;                         // start z miejsca
  if (!next) return 0;                         // koniec w miejscu
  const dt = next.t - prev.t;
  if (dt <= 1e-6) return 0;
  return (next[key][ax] - prev[key][ax]) / dt;
}

/** Długość toru (s). */
export function keysDuration(keys) {
  return keys.length ? keys[keys.length - 1].t : 0;
}

/**
 * Poza toru w chwili t → out { eye, target, up, fov }. Klatki posortowane po t.
 */
export function sampleKeys(keys, t, out = { eye: v3(), target: v3(), up: v3(0, 0, 1), fov: 45 }) {
  const n = keys.length;
  if (!n) return out;
  if (t <= keys[0].t || n === 1) return writeKey(keys[0], out);
  if (t >= keys[n - 1].t) return writeKey(keys[n - 1], out);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const h = Math.max(1e-6, b.t - a.t);
  const s = Math.min(1, Math.max(0, (t - a.t) / h));
  for (const key of ['eye', 'target']) {
    for (const ax of ['x', 'y', 'z']) {
      out[key][ax] = hermite(a[key][ax], tangent(keys, i, key, ax), b[key][ax], tangent(keys, i + 1, key, ax), s, h);
    }
  }
  const w = smooth01(s);
  const ua = a.up || UP_Z, ub = b.up || UP_Z;
  out.up.x = ua.x + (ub.x - ua.x) * w;
  out.up.y = ua.y + (ub.y - ua.y) * w;
  out.up.z = ua.z + (ub.z - ua.z) * w;
  const ul = len3(out.up);
  if (ul > 1e-6) { out.up.x /= ul; out.up.y /= ul; out.up.z /= ul; } else copy3(out.up, UP_Z);
  out.fov = a.fov + (b.fov - a.fov) * w;
  return out;
}

const UP_Z = Object.freeze({ x: 0, y: 0, z: 1 });

function writeKey(k, out) {
  copy3(out.eye, k.eye);
  copy3(out.target, k.target);
  copy3(out.up, k.up || UP_Z);
  out.fov = k.fov;
  return out;
}

/** Mieszanie dwóch póz (w 0 → a, 1 → b), wygładzone. */
export function blendPose(a, b, w, out = { eye: v3(), target: v3(), up: v3(0, 0, 1), fov: 45 }) {
  const k = smooth01(w);
  for (const key of ['eye', 'target', 'up']) {
    out[key].x = a[key].x + (b[key].x - a[key].x) * k;
    out[key].y = a[key].y + (b[key].y - a[key].y) * k;
    out[key].z = a[key].z + (b[key].z - a[key].z) * k;
  }
  const ul = len3(out.up);
  if (ul > 1e-6) { out.up.x /= ul; out.up.y /= ul; out.up.z /= ul; } else copy3(out.up, UP_Z);
  out.fov = a.fov + (b.fov - a.fov) * k;
  return out;
}

/**
 * Poza „z góry” pasująca do kamery klasycznej gry (ortho): środek (gx, gy) w układzie GRY, widoczna wysokość
 * kadru = H / zoom j. świata. Perspektywa o fov daje ten sam kadr w płaszczyźnie gry z wysokości
 * (H / zoom / 2) / tan(fov / 2). up = +y THREE (góra ekranu = −y gry).
 */
export function topDownPose(gx, gy, zoom, viewH, fov, out = { eye: v3(), target: v3(), up: v3(0, 1, 0), fov: 30 }) {
  const visH = Math.max(1, viewH) / Math.max(1e-6, zoom);
  const height = (visH * 0.5) / Math.tan(fov * 0.5 * DEG);
  out.eye.x = gx; out.eye.y = -gy; out.eye.z = height;
  out.target.x = gx; out.target.y = -gy; out.target.z = 0;
  out.up.x = 0; out.up.y = 1; out.up.z = 0;
  out.fov = fov;
  return out;
}

// Strojenie ujęcia K-7 (j. świata, s). Decyzja użytkownika 2026-09-30: „pokaż Ziemię, leć do Ziemi i skończ na K-7;
// jak najmniej statku 3D — pokaż dach K-7, wyprostuj kamerę, wtedy usuń dach, pokaż statek 2D zadokowany od góry”.
// Tor kończy się POZĄ Z GÓRY identyczną z kamerą klasyczną gry (topDownPose) — dalej przejmuje kamera 2D, a dach
// otwiera reżyser (HaloRingGame.hallRoofOverride). Hala K-7 ma ~10 440 × 7 150 j.
export const DOCK_INTRO_TUNE = Object.freeze({
  toEarthSec: 3.4,        // najazd na Ziemię (oko bliżej planety po linii z menu)
  toEarthMul: 0.5,        // odległość oka od środka Ziemi względem pozy menu
  toEarthFov: 34,
  overHallSec: 3.6,       // skos nad K-7: hala w dole, Ziemia w tle u góry kadru
  overHallHeight: 52000,
  overHallOut: 30000,     // oko na zewnątrz ringu (od strony bramy hali)
  overHallFov: 38,
  alignSec: 2.8,          // prostowanie do pionu — kadr gry
  holdSec: 0.7            // zawis nad zamkniętym dachem
});

/**
 * Klatki intro. p:
 *   start: { eye, target (środek Ziemi), up, fov } — poza kamery menu (THREE),
 *   hall:  { x, y } środek hali K-7 (THREE, z = 0), outX / outY — wersor „na zewnątrz ringu” (ku bramie),
 *   end:   poza z góry (topDownPose) — kadr kamery gry na końcu,
 *   tune?: nadpisania DOCK_INTRO_TUNE.
 */
export function buildDockIntroKeys(p) {
  const T = { ...DOCK_INTRO_TUNE, ...(p.tune || {}) };
  const keys = [];
  let t = 0;
  const hall = p.hall;
  const ox = Number(hall.outX) || 1, oy = Number(hall.outY) || 0;
  const on = Math.hypot(ox, oy) || 1;
  const outX = ox / on, outY = oy / on;
  const s = p.start;
  const ec = s.target;

  keys.push({ t, eye: { ...s.eye }, target: { ...s.target }, up: { ...(s.up || UP_Z) }, fov: s.fov || 30, stop: true });

  // 1. Do Ziemi: p.mid (łuk po stronie dziennej ku hali) albo oko po linii ze startu; cel płynie ku hali.
  t += T.toEarthSec;
  const k = T.toEarthMul;
  const midEye = p.mid ? p.mid : v3(ec.x + (s.eye.x - ec.x) * k, ec.y + (s.eye.y - ec.y) * k, ec.z + (s.eye.z - ec.z) * k);
  keys.push({
    t,
    eye: v3(midEye.x, midEye.y, midEye.z),
    target: v3(ec.x + (hall.x - ec.x) * 0.45, ec.y + (hall.y - ec.y) * 0.45, 0),
    up: v3(0, 0, 1),
    fov: T.toEarthFov
  });

  // 2. Skos nad K-7 od strony bramy: dach hali w dole kadru, Ziemia w tle (góra kadru ku planecie).
  t += T.overHallSec;
  keys.push({
    t,
    eye: v3(hall.x + outX * T.overHallOut, hall.y + outY * T.overHallOut, T.overHallHeight),
    target: v3(hall.x, hall.y, 0),
    up: v3(-outX, -outY, 0.2),
    fov: T.overHallFov
  });

  // 3. Prostowanie do pionu: kadr kamery gry (środek na Atlasie, góra ekranu = −y gry).
  const e = p.end;
  t += T.alignSec;
  keys.push({ t, eye: { ...e.eye }, target: { ...e.target }, up: { ...e.up }, fov: e.fov, stop: true });
  t += T.holdSec;
  keys.push({ t, eye: { ...e.eye }, target: { ...e.target }, up: { ...e.up }, fov: e.fov, stop: true });
  return keys;
}
