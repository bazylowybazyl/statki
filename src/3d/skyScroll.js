// src/3d/skyScroll.js
//
// OBRÓT SFERY NIEBA Z DROGI STATKU (DECYZJE-2 N1, 2026-10-26). Moduł czysty (bez three, bez DOM, bez stanu gry):
// stan obrotu trzyma wołający (NebulaSystem w planet3d.assets.js — tryb `off` na stronie, worker renderu u siebie;
// te same wejścia z RenderWorld → ten sam obrót, parzystość off ≡ worker).
//
// Niebo to sfera w nieskończoności — warstwa „deep” gwiazd na sferze (krytyk § 1): obraz nieba przesuwa się na ekranie
// z tym samym prawem co warstwy GameStars (src/3d/starParallax.js), tylko z paralaksą p nieba:
//     tempo [px bufora/s] = min(v, vCap) · p · zoom      (zoom = px bufora na j. świata, Core3D.viewZoom)
//     ω [rad/s]           = tempo / f                      (f = px bufora na radian w środku kadru, FOV 35°)
// v = droga STATKU w tej klatce / dt (nie kamery: kop warpa i wysunięcie riga nie szarpią nieba), vCap = limit kamery
// gwiazd w warpie (warpNurt.js, STAR_SPEED_CAP 14 000 j/s — przy prędkości warpa paralaksa to szum). Oś obrotu =
// z × kierunek ruchu w osiach SCENY (X = x gry, Y = −y gry), więc obraz nieba płynie przeciw ruchowi statku (jak
// paralaksa), a obrót kadru (cam.roll — kurs w górę w skoku) obraca niebo razem ze światem. Skok położenia większy niż
// cutMul · v · dt + cutPad (teleport, cięcie, odrodzenie) nie obraca nieba. Drogę okrętu liczy tropiciel
// (`skyTrackStep` — cięcie per okręt), obrót — `skyScrollMove`; wołający może zmieszać drogi kilku okrętów (sky3D.js:
// statek gracza i fregata zwiadu przy sterach, z wagą przejazdu kamery).
//
// HIERARCHIA WARSTW (DECYZJE-2 W0): na ekranie tempo rośnie z bliskością — niebo ≤ deep < mid < skały w warpie < speed / pył.
// W trybie sfery niebo ZASTĘPUJE warstwę deep GameStars (gwiazdy deep chowa materiał gwiazd, niebo niesie własne gwiazdy),
// więc p nieba (0,03) leży tuż nad dawnym zakresem deep (0,010–0,028) i wyraźnie pod mid (0,055–0,18). Tabela tempa:
// `skyLayerSpeeds`, test kolejności: tests/skyScroll.test.mjs.
//
// Rzut w kamerze z góry: RÓWNOODLEGŁY (azymutalny) wokół środka kadru — piksel w odległości r od środka patrzy pod
// kątem r / f od osi widoku. Przy 32:9 brzegi nie płyną 2,3× szybciej niż środek (rzut gnomoniczny), smugi i tempo są
// równe w całym kadrze. Kamery 3D (free3d) rysują sferę zwykłą perspektywą.
import { STAR_PARALLAX_LAYERS } from './starParallax.js';

const DEG = Math.PI / 180;

export const SKY_SCROLL = Object.freeze({
  p: 0.03,              // paralaksa nieba (warstwa deep na sferze; krytyk § 1)
  vCap: 14000,          // [j/s] limit drogi na sekundę (jak kamera gwiazd w warpie — warpNurt.js STAR_SPEED_CAP)
  cutMul: 4,            // cięcie: przesunięcie > cutMul · max(v, v poprzedniej klatki) · dt + cutPad
  cutPad: 50,           // [j.]
  fovDeg: 35,           // FOV kamery z góry (core3d.js FLAT_PERSP_FOV) — f = (H/2) / tg(FOV/2)
  // Drobne gwiazdy liczone na piksel gasną, gdy niebo płynie szybciej: pełne do fadeFromDeg, zero od fadeToDeg —
  // PRĘDKOŚĆ KĄTOWA nieba [°/s], nie px/s: tempo w px rośnie z wysokością okna (zoom kamery ∝ wysokość CSS, f też), a
  // kąt nie — próg jest ten sam przy 1080p, 1440p i 4K. 2 → 4 °/s = 60 → 120 px CSS/s przy 1080p (DECYZJE-2 N3).
  // Hipercruise i warp: 1,65 °/s na każdym ekranie — drobne gwiazdy zostają.
  fadeFromDeg: 2,
  fadeToDeg: 4,
  // Wygładzenie udziału drobnych gwiazd [s] (stała czasu): krótki zryw tempa (koniec ślizgu wyjścia z warpa — statek
  // ≥ 14 tys. j/s, a zoom wraca do bojowego: ~3 °/s przez ~0,4 s) przygasza je łagodnie, bez skoku.
  fadeTau: 0.35,
  // Smuga jasnych gwiazd nieba w skoku = smuga warstwy deep GameStars (stretchMul 0,22 × WARP_STARS.stretchPx 74 ≈ 16 px).
  streakMul: 0.22,
  // Pamięć nieba: przelicz, gdy obraz przesunął się o ≥ tyle px bufora (jak NebulaSystem — SKY_CACHE_PX).
  cacheTolPx: 0.25
});

/** Px bufora na radian w środku kadru kamery z góry (wysokość bufora H). */
export function skyFocalPx(bufferHeight, fovDeg = SKY_SCROLL.fovDeg) {
  const h = Math.max(1, Number(bufferHeight) || 1);
  return (h * 0.5) / Math.tan(fovDeg * 0.5 * DEG);
}

/** Tempo obrazu nieba [px/s] dla prędkości v [j/s] przy zoomie [px/j.] (te same px co zoom). */
export function skyScreenSpeed(v, zoom, tune = SKY_SCROLL) {
  const vv = Math.min(Math.max(0, Number(v) || 0), tune.vCap);
  return vv * tune.p * Math.max(0, Number(zoom) || 0);
}

/**
 * Udział drobnych gwiazd liczonych na piksel przy prędkości kątowej nieba ω [rad/s] (1 → 0 między fadeFromDeg i
 * fadeToDeg °/s). ω = tempo [px] / f [px/rad] — to samo przy każdej rozdzielczości.
 */
export function skyFineStarsGain(omega, tune = SKY_SCROLL) {
  const s = (Number(omega) || 0) / DEG;
  if (s <= tune.fadeFromDeg) return 1;
  if (s >= tune.fadeToDeg) return 0;
  const t = (s - tune.fadeFromDeg) / (tune.fadeToDeg - tune.fadeFromDeg);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Krok wygładzonego udziału drobnych gwiazd (`s.fine`) ku `skyFineStarsGain(s.omega)` ze stałą czasu fadeTau; pauza
 * (dt = 0) — bez zmian. Zwraca s.fine.
 */
export function stepSkyFineGain(s, dt, tune = SKY_SCROLL) {
  const t = Number(dt) || 0;
  if (!(t > 0)) return s.fine;
  const target = skyFineStarsGain(s.omega, tune);
  const k = 1 - Math.exp(-t / Math.max(1e-6, tune.fadeTau));
  s.fine += (target - s.fine) * k;
  if (Math.abs(target - s.fine) < 1e-3) s.fine = target;
  return s.fine;
}

// ── kwaterniony (x, y, z, w) w tablicy, bez alokacji ───────────────────────────────────────────────────────

function qNormalize(q) {
  const n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]) || 1;
  q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
  return q;
}

/** q ← R(oś, kąt) · q (obrót w osiach świata, oś jednostkowa). */
function qPremulAxisAngle(q, ax, ay, az, angle) {
  const h = angle * 0.5;
  const s = Math.sin(h);
  const bx = ax * s, by = ay * s, bz = az * s, bw = Math.cos(h);
  const x = q[0], y = q[1], z = q[2], w = q[3];
  q[0] = bw * x + bx * w + by * z - bz * y;
  q[1] = bw * y - bx * z + by * w + bz * x;
  q[2] = bw * z + bx * y - by * x + bz * w;
  q[3] = bw * w - bx * x - by * y - bz * z;
  return q;
}

/** Macierz obrotu kwaternionu (wierszami, 9 liczb): m[r * 3 + c]. */
export function quatToMat3(q, out) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z;
  const xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  out[0] = 1 - 2 * (yy + zz); out[1] = 2 * (xy - wz);     out[2] = 2 * (xz + wy);
  out[3] = 2 * (xy + wz);     out[4] = 1 - 2 * (xx + zz); out[5] = 2 * (yz - wx);
  out[6] = 2 * (xz - wy);     out[7] = 2 * (yz + wx);     out[8] = 1 - 2 * (xx + yy);
  return out;
}

/** Kwaternion z macierzy obrotu (wierszami). */
export function mat3ToQuat(m, out) {
  const tr = m[0] + m[4] + m[8];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out[3] = 0.25 * s; out[0] = (m[7] - m[5]) / s; out[1] = (m[2] - m[6]) / s; out[2] = (m[3] - m[1]) / s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    out[3] = (m[7] - m[5]) / s; out[0] = 0.25 * s; out[1] = (m[1] + m[3]) / s; out[2] = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    out[3] = (m[2] - m[6]) / s; out[0] = (m[1] + m[3]) / s; out[1] = 0.25 * s; out[2] = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    out[3] = (m[3] - m[1]) / s; out[0] = (m[2] + m[6]) / s; out[1] = (m[5] + m[7]) / s; out[2] = 0.25 * s;
  }
  return qNormalize(out);
}

// ── układ nieba ────────────────────────────────────────────────────────────────────────────────────────────
// Kierunek w układzie NIEBA: (cos φ cos λ, cos φ sin λ, sin φ) — λ długość, φ szerokość. Pas Drogi Mlecznej leży na
// równiku (φ = 0, wielkie koło — wypiekacz w trybie sfery, src/3d/skybake/). Tekstura equirect: u = λ / 2π + 0,5,
// v = 0,5 − φ / π (wiersz 0 = biegun północny).

/** Kierunek nieba z (λ, φ) [rad]. */
export function skyDirFromLonLat(lon, lat, out) {
  const c = Math.cos(lat);
  out[0] = c * Math.cos(lon); out[1] = c * Math.sin(lon); out[2] = Math.sin(lat);
  return out;
}

/** uv equirect kierunku nieba (lustro CPU materiału — skySphere.tsl.js: skyEquirectUv). */
export function skyEquirectUvCpu(d, out) {
  out[0] = Math.atan2(d[1], d[0]) / (2 * Math.PI) + 0.5;
  out[1] = 0.5 - Math.asin(Math.max(-1, Math.min(1, d[2]))) / Math.PI;
  return out;
}

/**
 * Orientacja startowa (świat ← niebo): oś widoku kamery z góry (−Z sceny) patrzy w punkt nieba (λ0, φ0), a pas
 * (kierunek rosnącego λ) biegnie na ekranie pod kątem `bandDeg` od poziomu (y w górę) — ten sam kadr co dawna
 * płaszczyzna tła (środek tekstury: 0,040 jednostki nieba od rdzenia pasa po stronie „−d”, 0,020 przed środkiem pasa,
 * pas pod 27° w dół w prawo, zgrubienie ~39° dalej wzdłuż pasa — poza kadrem startu). Jednostka nieba = 3,27 rad.
 */
export const SKY_START = Object.freeze({ lonDeg: -3.7, latDeg: -7.5, bandDeg: -27 });

export function skyStartQuat(out, start = SKY_START) {
  const lon = start.lonDeg * DEG, lat = start.latDeg * DEG, b = start.bandDeg * DEG;
  // Baza nieba w punkcie (λ0, φ0): e — wschód (∂λ), n — północ (∂φ), c — kierunek; e × n = c.
  const c = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const e = [-Math.sin(lon), Math.cos(lon), 0];
  const n = [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)];
  // Cel w świecie (prawoskrętnie): e → (cos b, sin b, 0), n → (sin b, −cos b, 0), c → (0, 0, −1) (widok z wnętrza sfery).
  const E = [Math.cos(b), Math.sin(b), 0];
  const N = [Math.sin(b), -Math.cos(b), 0];
  const C = [0, 0, -1];
  // R = [E N C] · [e n c]ᵀ (wierszami)
  const m = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 3; k++) m[r * 3 + k] = E[r] * e[k] + N[r] * n[k] + C[r] * c[k];
  }
  return mat3ToQuat(m, out);
}

// ── stan obrotu ────────────────────────────────────────────────────────────────────────────────────────────

/** Tropiciel drogi jednego okrętu: ostatnie miejsce i prędkość, licznik cięć. */
export function createSkyTrack() {
  return { lx: 0, ly: 0, lv: 0, has: false, cuts: 0 };
}

/**
 * Droga okrętu w tej klatce → out[0], out[1] (dx, dy w osiach gry, y w dół). (x, y) — poza okrętu, v — jego prędkość
 * [j/s], dt — czas klatki renderu [s]. Zwraca długość drogi [j.]; 0 (i out = 0) — pierwsza klatka, postój, pauza albo
 * CIĘCIE: skok położenia > cutMul · max(v, v poprzedniej klatki) · dt + cutPad (teleport, odrodzenie; licznik `cuts`).
 * Poza niepoliczalna — tropiciel zapomina miejsce (następna poza = pierwsza klatka).
 */
export function skyTrackStep(tr, x, y, v, dt, out, tune = SKY_SCROLL) {
  out[0] = 0; out[1] = 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { tr.has = false; return 0; }
  const vv = Math.max(0, Number(v) || 0);
  if (!tr.has) { tr.lx = x; tr.ly = y; tr.lv = vv; tr.has = true; return 0; }
  const dx = x - tr.lx;
  const dy = y - tr.ly;
  tr.lx = x; tr.ly = y;
  const vRef = Math.max(vv, tr.lv);
  tr.lv = vv;
  const t = Number(dt) || 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(t > 0) || !(d > 0)) return 0;
  if (d > tune.cutMul * vRef * t + tune.cutPad) { tr.cuts++; return 0; }
  out[0] = dx; out[1] = dy;
  return d;
}

/** Nowy stan: q (świat ← niebo, x y z w), tropiciel drogi statku, tempo i udział drobnych gwiazd ostatniej klatki. */
export function createSkyScroll(start = SKY_START) {
  const s = {
    q: new Float64Array(4),
    track: createSkyTrack(),   // droga statku (stepSkyScroll; sky3D.js — statek gracza)
    speedPx: 0,       // tempo obrazu nieba w tej klatce [px bufora/s]
    speedCss: 0,      // to samo w px CSS (narzędzia, raport W0)
    omega: 0,         // prędkość kątowa nieba [rad/s] (gaśnięcie drobnych gwiazd — niezależne od rozdzielczości)
    fine: 1,          // wygładzony udział drobnych gwiazd (stepSkyFineGain)
    cuts: 0,          // licznik cięć (teleport)
    turned: 0         // suma kątów obrotu [rad] (narzędzia)
  };
  skyStartQuat(s.q, start);
  return s;
}

/**
 * Orientacja startowa i zapomnienie drogi (narzędzia, testy). W grze orientacji nie zapisujemy, a nowa gra przeładowuje
 * stronę (`hullfallApp.relaunch` / `location.reload`), więc start zawsze ma `SKY_START`.
 */
export function resetSkyScroll(s, start = SKY_START) {
  skyStartQuat(s.q, start);
  s.track.has = false; s.track.lv = 0;
  s.speedPx = 0; s.speedCss = 0; s.omega = 0; s.fine = 1; s.turned = 0;
  return s;
}

/**
 * Obrót nieba o drogę (dx, dy) [j., osie gry] w czasie dt [s]: zoom — px bufora na j. świata (Core3D.viewZoom), f — px
 * bufora na radian (skyFocalPx), pxScale — px bufora na px CSS. Sufit drogi vCap · dt. Zwraca kąt obrotu [rad].
 */
export function skyScrollMove(s, dx, dy, dt, zoom, f, pxScale = 1, tune = SKY_SCROLL) {
  const t = Number(dt) || 0;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(t > 0) || !(d > 0)) { s.speedPx = s.speedCss = s.omega = 0; return 0; }
  const dc = Math.min(d, tune.vCap * t);
  const z = Math.max(0, Number(zoom) || 0);
  const ff = Math.max(1e-6, Number(f) || 1);
  const angle = dc * tune.p * z / ff;
  s.speedPx = dc / t * tune.p * z;
  s.speedCss = s.speedPx / Math.max(1e-6, Number(pxScale) || 1);
  s.omega = angle / t;
  if (angle > 0) {
    // oś = Z × m, m = kierunek ruchu w osiach sceny (dx, −dy) / d
    qPremulAxisAngle(s.q, dy / d, dx / d, 0, angle);
    qNormalize(s.q);
    s.turned += angle;
  }
  return angle;
}

const _dStep = new Float64Array(2);

/**
 * Krok obrotu z drogi statku (tropiciel `s.track` + `skyScrollMove`). (x, y) — poza statku w świecie gry (y w dół),
 * v — prędkość statku [j/s], dt — czas klatki renderu [s], zoom, f, pxScale — jak w skyScrollMove. Zwraca kąt [rad].
 */
export function stepSkyScroll(s, x, y, v, dt, zoom, f, pxScale = 1, tune = SKY_SCROLL) {
  skyTrackStep(s.track, x, y, v, dt, _dStep, tune);
  s.cuts = s.track.cuts;
  return skyScrollMove(s, _dStep[0], _dStep[1], dt, zoom, f, pxScale, tune);
}

const _qm = new Float64Array(9);

/**
 * Macierz widok → niebo (wierszami, 9 liczb): kierunek w osiach widoku kamery z góry (x w prawo, y w górę, patrzy w −z)
 * → kierunek w układzie nieba. M = Qᵀ · Rz(−roll) (kamera z góry: widok → świat = obrót o −roll wokół Z).
 */
export function skyViewMatrix(s, roll, out) {
  const q = quatToMat3(s.q, _qm);   // świat ← niebo
  const r = Number(roll) || 0;
  const c = Math.cos(r), sn = -Math.sin(r);   // Rz(−roll): [[c, −sn], [sn, c]] z sn = sin(−roll)
  // (Qᵀ)[i][k] = q[k][i]; M[i][j] = Σk Qᵀ[i][k] · Rz[k][j]
  for (let i = 0; i < 3; i++) {
    const a0 = q[0 * 3 + i], a1 = q[1 * 3 + i], a2 = q[2 * 3 + i];
    out[i * 3 + 0] = a0 * c + a1 * sn;
    out[i * 3 + 1] = -a0 * sn + a1 * c;
    out[i * 3 + 2] = a2;
  }
  return out;
}

/** Macierz świat (scena three) → niebo (wierszami): Qᵀ — kamery 3D liczą kierunek w osiach sceny. */
export function skyWorldMatrix(s, out) {
  const q = quatToMat3(s.q, _qm);
  for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = q[k * 3 + i];
  return out;
}

/** Kąt obrotu między dwiema macierzami obrotu (wierszami) [rad]. */
export function mat3AngleBetween(a, b) {
  let tr = 0;
  for (let i = 0; i < 9; i++) tr += a[i] * b[i];
  const c = Math.max(-1, Math.min(1, (tr - 1) * 0.5));
  // przy małych kątach acos jest nieprecyzyjny — z normy różnicy (‖A − B‖F² = 8 sin²(θ/2) dla obrotów)
  if (c > 0.999) {
    let s2 = 0;
    for (let i = 0; i < 9; i++) { const d = a[i] - b[i]; s2 += d * d; }
    return 2 * Math.asin(Math.min(1, Math.sqrt(s2 / 8)));
  }
  return Math.acos(c);
}

// ── rzut równoodległy (lustro CPU materiału) ───────────────────────────────────────────────────────────────

/** Piksel (px od środka kadru, y w górę) → kierunek w osiach widoku (x, y, z; widok w −z). */
export function skyEquidistantDir(px, py, f, out) {
  const r = Math.sqrt(px * px + py * py);
  const th = r / f;
  const k = r > 1e-9 ? Math.sin(th) / r : 1 / f;
  out[0] = px * k; out[1] = py * k; out[2] = -Math.cos(th);
  return out;
}

/** Kierunek w osiach widoku → piksel (px od środka, y w górę); zwraca kąt od osi widoku. */
export function skyEquidistantPx(d, f, out) {
  const rxy = Math.sqrt(d[0] * d[0] + d[1] * d[1]);
  const th = Math.atan2(rxy, -d[2]);
  const k = rxy > 1e-12 ? th * f / rxy : f;
  out[0] = d[0] * k; out[1] = d[1] * k;
  return th;
}

// ── hierarchia warstw (W0) ─────────────────────────────────────────────────────────────────────────────────

/**
 * Tempo warstw na ekranie [px/s] przy prędkości v [j/s] i zoomie [px/j.] (kamera gwiazd z limitem vCap jak w warpie i
 * hipercruisie): niebo i zakresy warstw GameStars (deep / mid / speed — min, max). Warstwy GameStars leżą na z = −250
 * w kamerze perspektywy; skala ekranowa ≈ zoom (≤ 6 % mniej przy zoomie 0,45 — pomijalne w kolejności).
 */
export function skyLayerSpeeds(v, zoom, tune = SKY_SCROLL) {
  const vv = Math.min(Math.max(0, Number(v) || 0), tune.vCap);
  const out = { sky: skyScreenSpeed(v, zoom, tune) };
  for (const L of STAR_PARALLAX_LAYERS) out[L.name] = [vv * L.parallaxMin * zoom, vv * L.parallaxMax * zoom];
  return out;
}
