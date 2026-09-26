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

export const CAMERA_ZOOM_SMOOTH = Object.freeze({
  // 1/s. Pojedynczy ząbek: połowa drogi po ~0,14 s, 95% po ~0,4 s.
  omega: 12,
  // Poniżej obu progów (|log(zoom/cel)| i |prędkość| w log/s) zoom staje na celu.
  settleLog: 1e-4,
  settleVel: 1e-3,
});

// WheelEvent.deltaMode 1 (linie, Firefox): 3 linie na ząbek = 100 px jak w Chrome.
export const WHEEL_LINE_PX = 100 / 3;

export function wheelDeltaPx(deltaY, deltaMode = 0, pagePx = 800) {
  const d = Number(deltaY) || 0;
  if (deltaMode === 1) return d * WHEEL_LINE_PX;
  if (deltaMode === 2) return d * pagePx;
  return d;
}

function settleZoom(cam, target) {
  cam.zoom = target;
  cam.zoomVel = 0;
  cam._zoomSpringOut = target;
  return false;
}

// Krok zoomu `cam` (pola zoom, targetZoom, minZoom, maxZoom) o dt sekund.
// Prędkość w log/s trzyma cam.zoomVel. Zoom zapisany z zewnątrz (przejście kamery,
// teleport, dev) rusza sprężynę od spoczynku. Zwraca true, dopóki zoom jest w ruchu.
export function stepCameraZoom(cam, dt, omega = CAMERA_ZOOM_SMOOTH.omega) {
  const zMin = cam.minZoom > 0 ? cam.minZoom : 1e-4;
  const zMax = cam.maxZoom > zMin ? cam.maxZoom : zMin;
  const rawTarget = Number(cam.targetZoom);
  const target = Number.isFinite(rawTarget) && rawTarget > 0
    ? Math.min(zMax, Math.max(zMin, rawTarget))
    : Math.min(zMax, Math.max(zMin, Number(cam.zoom) || 1));
  const zoom = cam.zoom;
  if (!(zoom > 0) || !Number.isFinite(zoom)) return settleZoom(cam, target);

  const v0 = (zoom === cam._zoomSpringOut && Number.isFinite(cam.zoomVel)) ? cam.zoomVel : 0;
  const x0 = Math.log(zoom / target);
  if (Math.abs(x0) < CAMERA_ZOOM_SMOOTH.settleLog && Math.abs(v0) < CAMERA_ZOOM_SMOOTH.settleVel) {
    return settleZoom(cam, target);
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
  cam.zoom = next;
  cam.zoomVel = v1;
  cam._zoomSpringOut = next;
  return true;
}
