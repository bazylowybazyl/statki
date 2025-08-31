// Engineeffects.js
// Minimal-no-deps (poza three) VFX: igłowy niebieski exhaust + wariant warp.
// Eksportuje: createShortNeedleExhaust, createWarpExhaustBlue

import * as THREE from "three";

/* ================== Helpers ================== */

// Tworzy 1D gradient (używany jako alpha/cutout na sprite'ach)
function makeGradientTex({ w = 64, h = 256, stops = [] }) {
  const cnv = document.createElement("canvas");
  cnv.width = w;
  cnv.height = h;
  const g = cnv.getContext("2d");

  const grad = g.createLinearGradient(0, 0, 0, h);
  if (!stops.length) {
    grad.addColorStop(0.0, "rgba(255,255,255,1)");
    grad.addColorStop(1.0, "rgba(255,255,255,0)");
  } else {
    for (const [t, a] of stops) grad.addColorStop(t, `rgba(255,255,255,${a})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);

  const tex = new THREE.CanvasTexture(cnv);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// delikatny additive niebieski kolor
function engineColor(alpha = 0.85) {
  return new THREE.Color(`rgba(170,210,255,${alpha})`);
}
function coreColor(alpha = 1) {
  return new THREE.Color(`rgba(255,255,255,${alpha})`);
}

/* ================== Exhaust: igłowy (domyślny) ================== */

export function createShortNeedleExhaust(opts = {}) {
  const group = new THREE.Group();
  group.name = "ExhaustGroup";

  // Gradienty
  const texLong = makeGradientTex({
    w: 64,
    h: 256,
    stops: [
      [0.00, 0.95],
      [0.15, 0.85],
      [0.60, 0.25],
      [1.00, 0.00],
    ],
  });
  const texCore = makeGradientTex({
    w: 32,
    h: 128,
    stops: [
      [0.00, 1.00],
      [0.45, 0.50],
      [1.00, 0.00],
    ],
  });

  // Materiały (additive, przezroczyste)
  const matPlume = new THREE.SpriteMaterial({
    map: texLong,
    color: engineColor(0.9),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });
  const matCore = new THREE.SpriteMaterial({
    map: texCore,
    color: coreColor(1.0),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
  });

  // Długi pióropusz
  const plume = new THREE.Sprite(matPlume);
  plume.center.set(0.5, 1.0);         // kotwica na górnej krawędzi (tuż przy dyszy)
  plume.scale.set(22, 120, 1);        // X, Y
  plume.position.set(0, -4, 0);       // minimalne cofnięcie
  group.add(plume);

  // Jasny rdzeń przy wylocie
  const core = new THREE.Sprite(matCore);
  core.center.set(0.5, 1.0);
  core.scale.set(16, 54, 1);
  core.position.set(0, -2, 0.1);
  group.add(core);

  // Subtle „streaks” – dwa cieńsze sprite’y z fazą, dające pulsowanie
  const streakMat = matPlume.clone();
  streakMat.color = engineColor(0.6);
  const streak1 = new THREE.Sprite(streakMat);
  streak1.center.set(0.5, 1.0);
  streak1.scale.set(10, 100, 1);
  streak1.position.set(-3, -4, 0.05);
  group.add(streak1);

  const streak2 = new THREE.Sprite(streakMat.clone());
  streak2.center.set(0.5, 1.0);
  streak2.scale.set(10, 92, 1);
  streak2.position.set(3, -4, 0.04);
  group.add(streak2);

  // API sterujące
  let throttle = 0;       // bieżące wysterowanie (0..1)
  let throttleTarget = 0; // docelowe wysterowanie
  let warpBoost = 0;      // 0..1 (dodatkowe „dopalenie” przy warp/boost)
  let colorTemp = opts.colorTempK || 6500; // K
  let bloomGain = opts.bloomGain || 1.0;   // strojenie bloom
  function setThrottle(t) { throttleTarget = THREE.MathUtils.clamp(t, 0, 1); }
  function setWarpBoost(t) { warpBoost = THREE.MathUtils.clamp(t, 0, 1); }
  function setColorTemp(k) { colorTemp = THREE.MathUtils.clamp(k | 0, 1000, 20000); }
  function setBloomGain(g) { bloomGain = THREE.MathUtils.clamp(g || 1, 0.2, 2.5); }

  function kelvinToRGB(k) {
    k = k / 100;
    let r, g, b;
    if (k <= 66) { r = 255; g = 99.47 * Math.log(k) - 161.12; }
    else { r = 329.7 * Math.pow(k - 60, -0.133); g = 288.1 * Math.pow(k - 60, -0.0755); }
    if (k >= 66) { b = 255; }
    else if (k <= 19) { b = 0; }
    else { b = 138.5 * Math.log(k - 10) - 305.0; }
    return new THREE.Color(
      Math.max(0, Math.min(1, r / 255)),
      Math.max(0, Math.min(1, g / 255)),
      Math.max(0, Math.min(1, b / 255))
    );
  }

  function update(time = 0) {
    // płynne przejście do docelowego throttle
    throttle = THREE.MathUtils.lerp(throttle, throttleTarget, 0.1);
    const base = throttle;
    const over = Math.max(0, warpBoost * 0.8);
    const idle = 0.12 + 0.08 * Math.sin(time * 2.2);
    const amp = idle + THREE.MathUtils.lerp(0.05, 1.0, base) + over; // skala jasności/długości

    // miękkie pulsowanie
    const pulse = 0.08 * Math.sin(time * 12.0) + 0.04 * Math.sin(time * 19.0 + 1.7);

    const coreLen = THREE.MathUtils.lerp(8, 88, amp) * (1 + pulse);
    const plumeLen = THREE.MathUtils.lerp(16, 180, amp) * (1 + pulse * 0.6);

    core.scale.set(16, coreLen, 1);
    plume.scale.set(22, plumeLen, 1);

    streak1.scale.set(10, Math.max(20, plumeLen * 0.78), 1);
    streak2.scale.set(10, Math.max(16, plumeLen * 0.72), 1);

    // delikatne rozjechanie X dla „życia”
    streak1.position.x = -3 + Math.sin(time * 6.3) * 0.8;
    streak2.position.x = 3 + Math.cos(time * 7.1) * 0.8;

    // kolory zależne od temperatury i bloomGain
    const heat = base * 2500 + warpBoost * 3000;
    const col = kelvinToRGB(colorTemp + heat);
    const intensity = (0.7 + base * 1.3 + warpBoost * 0.6) * bloomGain;
    matPlume.color.copy(col).multiplyScalar(intensity);
    streakMat.color.copy(col).multiplyScalar(intensity * 0.8);
    matCore.color.copy(col).multiplyScalar(intensity * 1.2);
  }

  return { group, setThrottle, setWarpBoost, setColorTemp, setBloomGain, update };
}

/* ================== Exhaust: warpowy (szerszy pióropusz) ================== */

export function createWarpExhaustBlue(opts = {}) {
  const ex = createShortNeedleExhaust(opts);
  // szersze, dłuższe domyślne proporcje
  ex.group.children.forEach((s, i) => {
    if (s instanceof THREE.Sprite) {
      s.scale.x *= (i === 0 ? 1.4 : 1.2); // plume bardziej rozlany
      s.scale.y *= (i === 0 ? 1.6 : 1.4);
    }
  });
  // mocniej reaguje na warpBoost
  const baseUpdate = ex.update;
  ex.update = (time) => {
    baseUpdate(time);
    // lekkie „falowanie” całej grupy
    ex.group.scale.x = 1 + 0.02 * Math.sin(time * 8.0);
    ex.group.scale.y = 1 + 0.03 * Math.cos(time * 6.3);
  };
  return ex;
}
