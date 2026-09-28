// Płynny zoom kamery (kółko myszy, pad, przełącznik ŚPM).
//
// Zoom goni cel sprężyną krytycznie tłumioną w przestrzeni log(zoom), krokowaną
// RAZ NA KLATKĘ RENDERU czasem tej klatki. Dawniej był to lerp liniowy w każdym
// kroku fizyki 120 Hz, a render brał wynik bez interpolacji: przy monitorze
// 144/165 Hz co kilka klatek wypadało 0 kroków fizyki (zoom stał), przy spadku FPS
// 2–3 kroki naraz (zoom przeskakiwał), a każdy ząbek kółka od razu dawał pełną
// prędkość — zoom szarpał przy każdym ząbku.
//
// - log(zoom): ząbek to stały mnożnik, więc przybliżanie i oddalanie mają to samo
//   tempo na każdym poziomie (0,035 … 3,2).
// - Sprężyna (2. rząd) pamięta prędkość między ząbkami: seria ząbków to jeden
//   ciągły ruch, start jest miękki, a przy stałym celu nie ma przestrzału.
// - Krok to rozwiązanie dokładne (nie Euler) — przebieg nie zależy od FPS.
// - Człon przejściowy (zadanie 22-B, kop warpa — cameraRig.js): cam.zoomImpulseLog dodaje się
//   do log(zoom) PO sprężynie: camera.zoom = zoomBase · e^człon (w zakresie zoomu). Stan sprężyny
//   to zoomBase — zoom gracza; człon go nie rusza, targetZoom też nie, więc po impulsie kamera
//   wraca dokładnie do zoomu gracza. Bez członu (0 / brak pola) zoom = zoomBase jak dawniej.

export const CAMERA_ZOOM_SMOOTH = Object.freeze({
  // 1/s. Pojedynczy ząbek: połowa drogi po ~0,14 s, 95% po ~0,4 s.
  omega: 12,
  // Poniżej obu progów (|log(zoom/cel)| i |prędkość| w log/s) zoom staje na celu.
  settleLog: 1e-4,
  settleVel: 1e-3,
  // Najwyżej tyle w log(zoom) może dodać człon przejściowy (×/÷ 20).
  impulseLogMax: 3
});

// WheelEvent.deltaMode 1 (linie, Firefox): 3 linie na ząbek = 100 px jak w Chrome.
export const WHEEL_LINE_PX = 100 / 3;

export function wheelDeltaPx(deltaY, deltaMode = 0, pagePx = 800) {
  const d = Number(deltaY) || 0;
  if (deltaMode === 1) return d * WHEEL_LINE_PX;
  if (deltaMode === 2) return d * pagePx;
  return d;
}

function impulseLog(cam) {
  const v = Number(cam.zoomImpulseLog);
  if (!Number.isFinite(v) || v === 0) return 0;
  const m = CAMERA_ZOOM_SMOOTH.impulseLogMax;
  return v < -m ? -m : (v > m ? m : v);
}

// Zoom gracza (stan sprężyny, bez członu przejściowego). Zapis camera.zoom z zewnątrz od
// ostatniego kroku (przejście, teleport, dev) jest nowym zoomem gracza.
export function cameraZoomBase(cam) {
  const base = Number(cam.zoomBase);
  if (cam.zoom === cam._zoomSpringOut && base > 0 && Number.isFinite(base)) return base;
  return cam.zoom;
}

function showZoom(cam, base, term, zMin, zMax) {
  const shown = term === 0 ? base : Math.min(zMax, Math.max(zMin, base * Math.exp(term)));
  cam.zoom = shown;
  cam._zoomSpringOut = shown;
}

function settleZoom(cam, target, term, zMin, zMax) {
  cam.zoomBase = target;
  cam.zoomVel = 0;
  showZoom(cam, target, term, zMin, zMax);
  return term !== 0;
}

// Krok zoomu `cam` (pola zoom, targetZoom, minZoom, maxZoom; opcjonalnie zoomImpulseLog)
// o dt sekund. Prędkość w log/s trzyma cam.zoomVel, stan sprężyny cam.zoomBase. Zoom zapisany
// z zewnątrz (przejście kamery, teleport, dev) rusza sprężynę od spoczynku. Zwraca true, dopóki
// zoom jest w ruchu (sprężyna albo niezerowy człon przejściowy).
export function stepCameraZoom(cam, dt, omega = CAMERA_ZOOM_SMOOTH.omega) {
  const zMin = cam.minZoom > 0 ? cam.minZoom : 1e-4;
  const zMax = cam.maxZoom > zMin ? cam.maxZoom : zMin;
  const rawTarget = Number(cam.targetZoom);
  const term = impulseLog(cam);
  const own = cam.zoom === cam._zoomSpringOut;
  const base = cameraZoomBase(cam);
  const target = Number.isFinite(rawTarget) && rawTarget > 0
    ? Math.min(zMax, Math.max(zMin, rawTarget))
    : Math.min(zMax, Math.max(zMin, Number(base) || 1));
  if (!(base > 0) || !Number.isFinite(base)) return settleZoom(cam, target, term, zMin, zMax);

  const v0 = (own && Number.isFinite(cam.zoomVel)) ? cam.zoomVel : 0;
  const x0 = Math.log(base / target);
  if (Math.abs(x0) < CAMERA_ZOOM_SMOOTH.settleLog && Math.abs(v0) < CAMERA_ZOOM_SMOOTH.settleVel) {
    return settleZoom(cam, target, term, zMin, zMax);
  }

  // x(t) = (x0 + (v0 + ωx0)t)·e^(−ωt) — dokładnie dla celu stałego w obrębie kroku.
  const h = dt > 0 ? dt : 0;
  const decay = Math.exp(-omega * h);
  const k = v0 + omega * x0;
  const x1 = (x0 + k * h) * decay;
  let v1 = (v0 - k * omega * h) * decay;
  let next = target * Math.exp(x1);
  if (next <= zMin || next >= zMax) {
    next = Math.min(zMax, Math.max(zMin, next));
    v1 = 0;
  }
  cam.zoomBase = next;
  cam.zoomVel = v1;
  showZoom(cam, next, term, zMin, zMax);
  return true;
}
