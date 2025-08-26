// engineEffects.js
import * as THREE from "three";

// Wspólny shader igły (taper + flicker). Y: 0 przy dyszy (góra quad'a), 1 na końcu.
function makeNeedleMaterial({
  colorA = 0xffffff,       // kolor przy końcu (dalej od dyszy) – zwykle biały
  colorB = 0xffffff,       // kolor przy dyszy (mocny start)
  intensity = 3.0,         // mnożnik jasności (additive)
  widthNear = 0.65,        // szerokość przy dyszy (większe = grubiej u wylotu)
  widthFar = 0.18,         // szerokość na końcu
  lengthFadeStart = 0.0,   // gdzie zaczyna się fade (0..1)
  lengthFadeEnd = 0.4,     // gdzie gaśnie (0..1) — krótsze = bardziej „krótki płomień”
  flickHz = 50.0,          // częstotliwość drgania
  extraBands = 0.0,        // 0=brak, 0..1 subtelne „shock bands”
  bandsFreq = 25.0,
  bandsSpeed = 15.0,
  phase = 0.0              // różnicowanie sąsiednich igieł
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,           // ważne przy współdzielonym rendererze
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime:       { value: 0 },
      uColorA:     { value: new THREE.Color(colorA) },
      uColorB:     { value: new THREE.Color(colorB) },
      uIntensity:  { value: intensity },
      uWidthNear:  { value: widthNear },
      uWidthFar:   { value: widthFar },
      uFadeA:      { value: lengthFadeStart },
      uFadeB:      { value: lengthFadeEnd },
      uFlickHz:    { value: flickHz },
      uBandsAmp:   { value: extraBands },
      uBandsFreq:  { value: bandsFreq },
      uBandsSpeed: { value: bandsSpeed },
      uPhase:      { value: phase }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv;
      uniform float uTime, uIntensity, uWidthNear, uWidthFar, uFadeA, uFadeB, uFlickHz;
      uniform float uBandsAmp, uBandsFreq, uBandsSpeed, uPhase;
      uniform vec3  uColorA, uColorB;

      void main() {
        float y = vUv.y;                     // 0 = przy dyszy (góra quad'a)
        float x = abs(vUv.x - 0.5);

        // Szerzej przy dyszy, wężej na końcu
        float width = mix(uWidthNear, uWidthFar, y);
        float cross = smoothstep(1.0, 0.0, x / width);

        // Krótki zanik po długości (miękkie wejście + fade)
        float along = 1.0 - y;
        along *= smoothstep(0.0, 0.12, y);
        along *= smoothstep(uFadeB, uFadeA, y);

        // Subtelny flicker
        float flick = 0.9 + 0.1 * sin(uTime * uFlickHz + uPhase);

        // Opcjonalne delikatne pasma
        float bands = 1.0;
        if (uBandsAmp > 0.0) {
          float ph = y * uBandsFreq - uTime * uBandsSpeed + uPhase;
          bands = mix(1.0, 0.5 + 0.5 * sin(ph), clamp(uBandsAmp, 0.0, 1.0));
        }

        float a = cross * along * flick * bands;

        // Kolor: mocniejszy przy dyszy -> blend do bieli/końcowego
        vec3 col = mix(uColorB, uColorA, 1.0 - y);
        gl_FragColor = vec4(col * a * uIntensity, a);
      }
    `
  });
}

// Buduje zestaw równoległych „igieł” w dół lokalnej osi +Y.
// Każda igła to PlaneGeometry(needleWidth, needleLen).
function buildNeedles({
  count = 4,
  spacing = 12,       // odstęp między igłami w jednostkach sceny (ortho)
  needleWidth = 14,
  needleLen = 60,
  materialFactory
}) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(needleWidth, needleLen, 1, 1);

  for (let i = 0; i < count; i++) {
    const mat = materialFactory(i);
    const m = new THREE.Mesh(geo, mat);
    const offsetIndex = i - (count - 1) / 2;
    m.position.set(offsetIndex * spacing, -5, 0); // -5 żeby górna krawędź była blisko dyszy
    group.add(m);
  }
  return { group, geo };
}

// Public API – efekt 1: krótki biały strumień
export function createShortNeedleExhaust(opts = {}) {
  const {
    count = 4,
    spacing = 12,
    needleWidth = 14,
    needleLen = 60,
    colorNear = 0xffffff,      // przy dyszy
    colorFar  = 0xffffff,      // dalej w strumieniu
    intensity = 3.5
  } = opts;

  const { group, geo } = buildNeedles({
    count, spacing, needleWidth, needleLen,
    materialFactory: (i) => makeNeedleMaterial({
      colorA: colorFar,
      colorB: colorNear,
      intensity,
      widthNear: 0.65,
      widthFar:  0.18,
      lengthFadeStart: 0.15,
      lengthFadeEnd:   0.55,    // KRÓTKO
      flickHz: 50,
      extraBands: 0.0,
      phase: i * 0.45
    })
  });

  function update(t) {
    group.traverse(o => {
      if (o.material && o.material.uniforms) {
        o.material.uniforms.uTime.value = t;
      }
    });
  }

  function dispose() {
    group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      }
    });
    geo?.dispose?.();
  }

  return { group, update, dispose };
}

// Public API – efekt 2: dłuższy, niebieski warp/boost
export function createWarpExhaustBlue(opts = {}) {
  const {
    count = 6,
    spacing = 12,
    needleWidth = 16,
    needleLen = 110,            // DŁUŻSZY ogon do warp
    colorNear = 0x99ccff,       // turkus/niebieski przy dyszy
    colorFar  = 0xffffff,       // końcówki wpadające w biel
    intensity = 3.8,
  } = opts;

  const { group, geo } = buildNeedles({
    count, spacing, needleWidth, needleLen,
    materialFactory: (i) => makeNeedleMaterial({
      colorA: colorFar,
      colorB: colorNear,
      intensity,
      widthNear: 0.70,
      widthFar:  0.12,
      // dłuższy fade: zacznie się później i wygaśnie dalej
      lengthFadeStart: 0.05,
      lengthFadeEnd:   0.85,
      flickHz: 42.0,
      // delikatne „shock bands” jak w referencjach
      extraBands: 0.35,
      bandsFreq:  28.0,
      bandsSpeed: 12.0,
      phase: i * 0.5
    })
  });

  function update(t) {
    group.traverse(o => {
      if (o.material && o.material.uniforms) {
        o.material.uniforms.uTime.value = t;
      }
    });
  }

  function dispose() {
    group.traverse(o => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      }
    });
    geo?.dispose?.();
  }

  return { group, update, dispose };
}
