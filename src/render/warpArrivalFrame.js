// src/render/warpArrivalFrame.js
//
// KADR PRZYLOTU SKOKU GRACZA — jedno źródło dla kamery i soczewki świata (DECYZJE T1, 2026-10-25).
//
// Kamera (src/game/cameraRig.js, stepCameraRigWarp: input.arrivalDist) od wyjścia z warpa prowadzi zoom, przy którym
// bliski brzeg PRAWDZIWEGO obrazu celu leży na `fill` drogi od statku do krawędzi kadru przed dziobem; kadr skoku bierze
// z nim miękkie minimum (kamera tylko się odsuwa). Soczewka świata (src/3d/warp/worldLens.js) pokazuje cel w skoku w skali
// „podglądu” tego kadru: q_T = miękkie maksimum (q mapy, z_v), z_v = warpArrivalScale(…) — skala obrazu celu, którą
// kamera pokaże przy przylocie — tarcza rośnie RAZEM z hamowaniem, a przy przylocie kamera zbiega do tej samej skali
// (przekazanie celu na prawdziwy obraz bez skoku i bez malenia). Obie strony MUSZĄ liczyć to samo — stąd jeden moduł
// w szwie (bez three, bez DOM, bez stanu; czyta go wątek gry i worker renderu).
//
// PLANETY TŁA (z < 0, pass perspektywy: Saturn, Wenus, Uran, Neptun, Merkury; słońce): obraz ciała w głębokości D przy
// zoomie kamery z ma skalę z / (1 + k·z), k = D / ogniskowa [j./px] (planet3d.assets.js: flat = focal / (camZ − z),
// camZ = focal / zoom), i skaluje się wokół ŚRODKA kadru, nie statku (paralaksa). Kadr przylotu liczy brzeg tego obrazu
// (warpArrivalZoom z depthK i centerEdgePx); gdy żaden zoom go nie dosięga (tło: skala ≤ 1 / k), kamera staje na kadrze
// skoku (miękkie minimum), a soczewka bierze skalę obrazu przy tym zoomie (warpArrivalScale z capZoom) — cel nie maleje.
//
// Odległość przylotu (arrivalDist) = |cel − statek| − promień ciała celu w soczewce (index.html: warpBodyRadius —
// ring „Halo”: promień planety z ringiem, reszta r × 4,5; soczewka: rekord ciała `r`).
//
// WPIĘCIE (etap integracji, 2026-10-26): cameraRig.js (stepCameraRigWarp) liczy kadr przylotu tymi funkcjami —
//   const edge = warpViewEdgePx(dirX, dirY, vw / 2, vh / 2, −offsetX, −offsetY);
//   const ce = warpViewEdgePx(dirX, dirY, vw / 2, vh / 2, 0, 0);
//   target = Math.log(warpArrivalZoom(edge, arrDist, fill, input.arrivalDepthK, ce));  arrive = warpArrivalSoftMin(d);
// (input.arrivalDepthK = warpArrivalDepthK(viewH) dla celu na tle, 0 dla płaszczyzny gry — index.html:
// updateCameraWarpKick; fill z tune).

export const WARP_ARRIVAL_FRAME = Object.freeze({
  fill: 0.75,   // bliski brzeg celu na tym ułamku drogi statek → krawędź kadru przed dziobem (= CAMERA_RIG_DEFAULTS.warpArrivalFill)
  soft: 0.1,    // [log zoomu] miękkie minimum kadru przylotu z kadrem skoku (cameraRig.js — stepCameraRigWarp)
  zoomMin: 1e-5,
  zoomMax: 1e3,
  backDepth: 50000,   // [j.] głębokość planet tła pod płaszczyzną gry (planet3d.assets.js: DirectPlanet bez ringu z = −50 000)
  perspFovDeg: 35     // [°] kąt widzenia kamery perspektywy passa planet (Core3D: FLAT_PERSP_FOV)
});

/**
 * depthK celu na tle dla kamery gry [j. / px CSS]: głębokość / ogniskowa kamery perspektywy, ogniskowa = (viewH / 2) /
 * tan(fov / 2) w px CSS (index.html: input.arrivalDepthK kadru przylotu — planety bez ringu; z ringiem i małe ciała 0).
 */
export function warpArrivalDepthK(viewH, depth = WARP_ARRIVAL_FRAME.backDepth, fovDeg = WARP_ARRIVAL_FRAME.perspFovDeg) {
  const h = Math.max(1, fin(viewH, 1));
  const focal = (h * 0.5) / Math.tan(Math.max(1e-3, fin(fovDeg, 35)) * Math.PI / 360);
  return Math.max(0, fin(depth, 0)) / focal;
}

const fin = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clampZoom = (z) => (z < WARP_ARRIVAL_FRAME.zoomMin ? WARP_ARRIVAL_FRAME.zoomMin
  : (z > WARP_ARRIVAL_FRAME.zoomMax ? WARP_ARRIVAL_FRAME.zoomMax : z));

/**
 * Odległość od punktu (sx, sy — px od środka kadru, y w dół) do krawędzi kadru hw × hh wzdłuż (ux, uy) [px].
 * Punkt poza kadrem albo kierunek zerowy — 0.
 */
export function warpViewEdgePx(ux, uy, hw, hh, sx, sy) {
  const tx = ux > 1e-9 ? (hw - sx) / ux : (ux < -1e-9 ? (-hw - sx) / ux : Infinity);
  const ty = uy > 1e-9 ? (hh - sy) / uy : (uy < -1e-9 ? (-hh - sy) / uy : Infinity);
  const t = Math.min(tx, ty);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

/**
 * Zoom KAMERY kadru przylotu [px/j.]: bliski brzeg prawdziwego obrazu celu (`arrivalDist` j. przed statkiem) na `fill`
 * drogi `edgePx` (statek → krawędź kadru przed dziobem).
 *   płaszczyzna gry (depthK = 0): fill · edge / d;
 *   tło (depthK = D / ogniskowa > 0): fill · edge / (d − depthK · (centerEdgePx − (1 − fill) · edge)) — obraz tła
 *   skaluje się wokół środka kadru (centerEdgePx: droga środek → ta sama krawędź); mianownik ≤ 0 (żaden zoom nie
 *   dosięga) — zoomMax (kamera i tak bierze miękkie minimum z kadrem skoku).
 * cameraRig.js: log tego zoomu to cel sprężyny `warpArrLog`; worldLens.js — przez warpArrivalScale.
 */
export function warpArrivalZoom(edgePx, arrivalDist, fill = WARP_ARRIVAL_FRAME.fill, depthK = 0, centerEdgePx = NaN) {
  const e = Math.max(1, fin(edgePx, 1));
  const f = fin(fill, WARP_ARRIVAL_FRAME.fill);
  const d = Math.max(1, fin(arrivalDist, 1));
  const k = Math.max(0, fin(depthK, 0));
  let den = d;
  if (k > 0) den = d - k * (fin(centerEdgePx, e) - (1 - f) * e);
  if (!(den > 0)) return WARP_ARRIVAL_FRAME.zoomMax;
  return clampZoom(e * f / den);
}

/** Skala obrazu ciała [px/j.] przy zoomie kamery `zoom` i głębokości depthK = D / ogniskowa: zoom / (1 + depthK · zoom). */
export function warpPerspScale(zoom, depthK = 0) {
  const z = fin(zoom, 0);
  const k = Math.max(0, fin(depthK, 0));
  return k > 0 ? z / (1 + k * z) : z;
}

/** Miękkie minimum (x, 0) w logarytmie zoomu: kadr przylotu nie przybliża ponad kadr skoku (cameraRig.js). */
export function warpArrivalSoftMin(d, soft = WARP_ARRIVAL_FRAME.soft) {
  const w = Number(soft) || 0;
  return 0.5 * (d - Math.sqrt(d * d + w * w));
}

/** Zoom kadru przylotu po miękkim minimum z kadrem skoku `capZoom` (jak kamera: exp(B + softMin(ln z − B))); bez — z. */
export function warpArrivalCapZoom(zoom, capZoom, soft = WARP_ARRIVAL_FRAME.soft) {
  const z = fin(zoom, 0);
  const c = fin(capZoom, NaN);
  if (!(z > 0) || !(c > 0)) return z;
  const B = Math.log(c);
  return Math.exp(B + warpArrivalSoftMin(Math.log(z) - B, soft));
}

/**
 * Skala OBRAZU celu w kadrze przylotu [px/j.] — z_v soczewki: zoom kamery kadru przylotu (warpArrivalZoom) po miękkim
 * minimum z kadrem skoku `capZoom` (zoom odniesienia skoku; NaN — bez), przeliczony na skalę obrazu w głębokości celu
 * (warpPerspScale). Płaszczyzna gry bez capZoom — dokładnie warpArrivalZoom.
 */
export function warpArrivalScale(edgePx, arrivalDist, fill = WARP_ARRIVAL_FRAME.fill, depthK = 0, centerEdgePx = NaN, capZoom = NaN) {
  const z = warpArrivalCapZoom(warpArrivalZoom(edgePx, arrivalDist, fill, depthK, centerEdgePx), capZoom);
  return warpPerspScale(z, depthK);
}
