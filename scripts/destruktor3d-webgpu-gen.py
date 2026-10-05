# Generator dema destruktor3d-webgpu.html z destruktor3d.html (plan docs/PLAN-zniszczenia-swiata-3d.md § 12).
#   python scripts/destruktor3d-webgpu-gen.py
# Oryginał (WebGLRenderer, skóra w GLSL) zostaje bez zmian; wersja WebGPU dostaje:
#   • WebGPURenderer + post (scena → gaz 3D w połowie rozdzielczości → refrakcja fal → bloom → ACES gry),
#   • renderer ciał w TSL (src/3d/beamShips3D.webgpu.js), żar węzłów jako kwady (beamHotGlow.webgpu.js),
#   • wybuchy i dym z gazu na siatce 3D podpięte pod zdarzenia zniszczeń (src/3d/gas/destructionGasFx.js),
#   • światła sceny (skóra oświetlona słońcem i ogniem wybuchów), klawisze J (wybuch reaktora), G (gaz).
# Każda podmiana jest sprawdzana — po zmianie oryginału generator mówi, która się rozjechała.
import io, os, sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = io.open(os.path.join(root, 'destruktor3d.html'), encoding='utf-8').read()

def rep(s, old, new, count=1):
    n = s.count(old)
    if n == 0 or (count and n != count):
        sys.exit(f'Podmiana nie pasuje ({n}×): {old[:90]!r}')
    return s.replace(old, new)

s = src
s = rep(s, '<title>Destruktor 3D — węzły i belki</title>', '<title>Destruktor 3D WebGPU — wybuchy i dym</title>')
s = rep(s, "import * as THREE from 'three';", "import * as THREE from 'three/webgpu';")
s = rep(s, "import { BeamShips3D } from './src/3d/beamShips3D.js';",
        "import { BeamShips3DGPU as BeamShips3D } from './src/3d/beamShips3D.webgpu.js';\n"
        "import { HotGlowBillboards } from './src/3d/beamHotGlow.webgpu.js';\n"
        "import { GasSceneFx } from './src/3d/gas/gasSceneFx.js';\n"
        "import { DestructionGasFx } from './src/3d/gas/destructionGasFx.js';")
s = rep(s, """const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);""",
"""// WebGPU (gaz liczony w compute) — bez adaptera demo się nie uruchomi.
if (!navigator.gpu) {
  document.body.insertAdjacentHTML('beforeend', '<p style="position:fixed;inset:40% 0 auto;text-align:center;color:#fff">Demo wymaga WebGPU (Chrome / Edge).</p>');
  throw new Error('Brak WebGPU');
}
const gpuAdapter = await navigator.gpu.requestAdapter();
const requiredLimits = {};
for (const k of ['maxStorageBuffersPerShaderStage', 'maxStorageTexturesPerShaderStage', 'maxSampledTexturesPerShaderStage',
  'maxInterStageShaderVariables', 'maxTextureDimension3D', 'maxComputeInvocationsPerWorkgroup']) {
  if (gpuAdapter?.limits?.[k] !== undefined) requiredLimits[k] = gpuAdapter.limits[k];
}
const renderer = new THREE.WebGPURenderer({ antialias: false, requiredLimits });
renderer.setSize(window.innerWidth, window.innerHeight);
// Post w pełnej rozdzielczości bufora (piksel = piksel CSS), gaz w połowie.
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);
await renderer.init();""")
s = rep(s, """const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);""",
"""const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04050a);
// Skóra w TSL bierze światła sceny (dawny GLSL: kierunek 0,35 / 0,8 / 0,5, otoczenie 0,34).
scene.add(new THREE.HemisphereLight(0x7d8faf, 0x1b1712, 1.15));
const sunLight = new THREE.DirectionalLight(0xfff1df, 2.8);
sunLight.position.set(350, 800, 500);
scene.add(sunLight);""")
s = rep(s, "const weaponVisuals = new BeamPhysicalWeaponsVisual3D(scene, weapons);",
"""const weaponVisuals = new BeamPhysicalWeaponsVisual3D(scene, weapons);
const hotGlow = new HotGlowBillboards(scene, weaponVisuals);
// Kule frontów fali i białe błyski F0 zastępuje gaz (kula ognia, błyski) i refrakcja fali — decyzja użytkownika:
// fala uderzeniowa = sama przezroczysta refrakcja, bez świecących okręgów.
weaponVisuals.fronts.material.visible = false;
weaponVisuals.flashes.material.visible = false;
// Wybuchy i dym (gaz 3D, compute WebGPU) — obraz zniszczeń; fizykę liczy solver jak dotąd.
const gasRng = (() => { let st = 20261005 >>> 0; return { next() { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; } }; })();
const gasFx = new GasSceneFx({ renderer, scene, camera, rng: gasRng, N: 64, slots: 6, lightScale: TARGET_SIZE });
gasFx.buildPipeline(window.innerWidth, window.innerHeight);
gasFx.warm();
const gasDestruction = new DestructionGasFx({ fx: gasFx, system: DestructorBeams3D, weapons });
function renderFrame() { gasFx.render(); }""")
s = rep(s, """  BeamShips3D.spawnDebris(wx, wy, wz, vx, vy, vz, node.r, node.g, node.b, scale, structural);
};""",
"""  BeamShips3D.spawnDebris(wx, wy, wz, vx, vy, vz, node.r, node.g, node.b, scale, structural);
};
// Haki gazu PO hakach dema (łańcuch: odłamki metalu zostają, gaz dokłada iskry, dym i ogień).
gasDestruction.attach();""")
# Pętla: krok efektów zegarem symulacji (pauza = stoją), render przez post z gazem.
s = rep(s, """  if (cameraMode === 'orbit') controls.update();
  const renderStart = performance.now();
  renderer.render(scene, camera);""",
"""  if (cameraMode === 'orbit') controls.update();
  const renderStart = performance.now();
  const fxDt = paused ? 0 : simulatedMs / 1000;
  gasDestruction.update(fxDt, bodies);
  gasFx.update(fxDt);
  renderFrame();""")
s = rep(s, """  BeamShips3D.sync(bodies, camera, simulationTime);
  renderer.render(scene, camera);
  const launched""", """  BeamShips3D.sync(bodies, camera, simulationTime);
  renderFrame();
  const launched""")
s = rep(s, """    weaponVisuals.sync();
    renderer.render(scene, camera);
    updateStats();""", """    weaponVisuals.sync();
    hotGlow.sync(camera);
    renderFrame();
    updateStats();""")
s = rep(s, """  weaponVisuals.sync();
  syncMs = performance.now() - syncStart;""", """  weaponVisuals.sync();
  hotGlow.sync(camera);
  syncMs = performance.now() - syncStart;""")
s = rep(s, """  renderer.setSize(window.innerWidth, window.innerHeight);
});""", """  renderer.setSize(window.innerWidth, window.innerHeight);
  gasFx.resize(window.innerWidth, window.innerHeight);
});""")
# Klawisze: J — wybuch reaktora celu, G — gaz wł./wył.
s = rep(s, "  if (e.code === 'KeyM') setLegacy(!weapons.legacy);\n});",
"""  if (e.code === 'KeyM') setLegacy(!weapons.legacy);
  if (e.code === 'KeyJ') blowReactor();
  if (e.code === 'KeyG') { gasFx.on.gas = !gasFx.on.gas; toast(gasFx.on.gas ? 'Gaz (wybuchy i dym): WŁĄCZONY' : 'Gaz: WYŁĄCZONY (A/B)', 1600); }
});
function blowReactor() {
  const target = stationBody && !stationBody.dead ? stationBody : bodies.find((b) => !b.dead && !b.isProjectile && b !== ramBody);
  if (!target) return;
  paused = false;
  gasDestruction.reactor(target, 2);
  toast('Wybuch reaktora: kula ognia w środku bryły + front ciśnienia przez solver', 2600);
}""")
s = rep(s, "&nbsp;|&nbsp; <kbd>T</kbd> taran &nbsp;|&nbsp; <kbd>P</kbd> pauza &nbsp;|&nbsp; <kbd>R</kbd> reset",
        "&nbsp;|&nbsp; <kbd>T</kbd> taran &nbsp;|&nbsp; <kbd>P</kbd> pauza &nbsp;|&nbsp; <kbd>R</kbd> reset"
        " &nbsp;|&nbsp; <kbd>J</kbd> wybuch reaktora &nbsp;|&nbsp; <kbd>G</kbd> gaz (A/B)")
s = rep(s, "  scene, camera, renderer, DestructorBeams3D, BeamShips3D, weapons,",
        "  scene, camera, renderer, DestructorBeams3D, BeamShips3D, weapons, gasFx, gasDestruction, blowReactor,")
# Step harnessu: efekty gazu w tym samym zegarze co fizyka.
s = rep(s, """      simulationTime += dt;
      trackHits();
    }
    pruneBodies();
  },""", """      simulationTime += dt;
      trackHits();
      gasDestruction.update(dt, bodies);
      gasFx.update(dt);
    }
    pruneBodies();
  },""")
header = ("<!-- WYGENEROWANE: python scripts/destruktor3d-webgpu-gen.py z destruktor3d.html — zmiany rób w oryginale\n"
          "     albo w generatorze. Wersja WebGPU: wybuchy i dym z gazu 3D (src/3d/gas/), skóra ciał w TSL. -->\n")
s = s.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + header, 1) if s.startswith('<!DOCTYPE html>') else header + s
out = os.path.join(root, 'destruktor3d-webgpu.html')
io.open(out, 'w', encoding='utf-8', newline='').write(s)
print('ok', out, len(s))
