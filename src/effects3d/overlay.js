import * as THREE from "three";
// Importujemy moduły post-processingu (muszą być dostępne w mapie importów w index.html)
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export function initOverlay({ host, getView }) {
  if (!host) {
    throw new Error("initOverlay: host element is required");
  }

  // 1. Inicjalizacja Renderera
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // Antialiasing w rendererze wyłączamy, gdy używamy Composera (chyba że używamy SMAA)
    alpha: true,
    premultipliedAlpha: true,
    powerPreference: "high-performance"
  });
  
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  
  // Kluczowe dla kolorów:
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2; // Lekko podbite dla soczystości

  const dom = renderer.domElement;
  dom.classList.add("overlay3d");
  dom.style.pointerEvents = "none";
  dom.style.position = "absolute";
  dom.style.inset = "0";
  dom.style.zIndex = "20";
  dom.style.background = "transparent";

  host.appendChild(dom);

  const scene = new THREE.Scene();

  // Kamera ortograficzna (widok z góry)
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 120, 0);
  camera.lookAt(0, 0, 0);

  // 2. Konfiguracja Post-Processingu (BLOOM)
  const composer = new EffectComposer(renderer);
  
  // A. RenderPass - rysuje scenę 3D
  const renderPass = new RenderPass(scene, camera);
  renderPass.clear = true;
  composer.addPass(renderPass);

  // B. UnrealBloomPass - dodaje poświatę
  // Parametry: resolution, strength, radius, threshold
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(host.clientWidth, host.clientHeight), 
    2.5,  // Siła (2.5 sprawi, że reaktor będzie świecił jak neon)
    0.4,  // Promień rozmycia
    0.05  // Próg (im niższy, tym ciemniejsze elementy też świecą)
  );
  composer.addPass(bloomPass);

  // C. OutputPass - korekcja kolorów na koniec (wymagane w nowym Three.js)
  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const effects = [];
  let lastSizeW = host.clientWidth;
  let lastSizeH = host.clientHeight;

  function syncCamera() {
    if (!getView) return;
    const view = getView();
    if (!view) return;

    const viewport = view.viewport || {};
    const w = viewport.w ?? host.clientWidth;
    const h = viewport.h ?? host.clientHeight;
    const zoom = view.zoom ?? 1;
    const scale = zoom || 1;
    const halfW = w / (2 * scale);
    const halfH = h / (2 * scale);

    // Aktualizacja kamery ortograficznej, by pasowała do zoomu gry 2D
    if (camera.left !== -halfW || camera.right !== halfW || camera.top !== halfH || camera.bottom !== -halfH) {
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
    }

    const center = view.center || {};
    const cx = center.x ?? 0;
    const cz = center.y ?? 0;

    // Przesuwanie kamery razem z graczem
    if (camera.position.x !== cx || camera.position.z !== cz) {
      camera.position.set(cx, camera.position.y, cz);
      camera.lookAt(cx, 0, cz);
    }

    // Obsługa zmiany rozmiaru okna
    if (lastSizeW !== w || lastSizeH !== h) {
      renderer.setSize(w, h, false);
      composer.setSize(w, h); // Ważne: resize composera!
      lastSizeW = w;
      lastSizeH = h;
    }
  }

  function tick(dt) {
    syncCamera();

    // Aktualizacja animacji efektów
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      if (fx.update) {
        fx.update(dt);
      }
      // Usuwanie zakończonych efektów
      if (!fx.group || !fx.group.parent) {
        effects.splice(i, 1);
      }
    }

    // Renderowanie przez Composera (z Bloomem), a nie czysty renderer
    composer.render();
  }

  function spawn(effect) {
    if (!effect) return;
    // Jeśli efekt to factory function, wywołaj go (opcjonalne zabezpieczenie)
    // Ale w Twoim kodzie przekazujesz już instancję {group, update...}
    if (effect.group) {
        scene.add(effect.group);
        effects.push(effect);
    }
  }

  function resize() {
    syncCamera();
  }

  function dispose() {
    effects.length = 0;
    if (dom.parentElement === host) {
      host.removeChild(dom);
    }
    composer.dispose();
    renderer.dispose();
  }

  // Zwracamy również composer, aby Live Patch mógł go wykryć
  return { scene, camera, renderer, composer, tick, spawn, resize, dispose };
}