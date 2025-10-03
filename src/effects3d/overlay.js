import * as THREE from "three";

export function initOverlay({ host, getView }) {
  if (!host) {
    throw new Error("initOverlay: host element is required");
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: true,
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(host.clientWidth, host.clientHeight, false);

  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const dom = renderer.domElement;
  dom.classList.add("overlay3d");
  dom.style.pointerEvents = "none";
  dom.style.position = "absolute";
  dom.style.inset = "0";
  dom.style.zIndex = "20";
  dom.style.background = "transparent";

  host.appendChild(dom);

  const scene = new THREE.Scene();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 120, 0);
  camera.lookAt(0, 0, 0);

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

    if (camera.position.x !== cx || camera.position.z !== cz) {
      camera.position.set(cx, camera.position.y, cz);
      camera.lookAt(cx, 0, cz);
    }

    if (lastSizeW !== w || lastSizeH !== h) {
      renderer.setSize(w, h, false);
      lastSizeW = w;
      lastSizeH = h;
    }
  }

  function tick(dt) {
    syncCamera();

    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      if (fx.update) {
        fx.update(dt);
      }
      if (!fx.group || !fx.group.parent) {
        effects.splice(i, 1);
      }
    }

    renderer.render(scene, camera);
  }

  function spawn(effect) {
    if (!effect) return;
    effects.push(effect);
  }

  function resize() {
    syncCamera();
  }

  function dispose() {
    effects.length = 0;
    if (dom.parentElement === host) {
      host.removeChild(dom);
    }
    renderer.dispose();
  }

  return { scene, camera, renderer, tick, spawn, resize, dispose };
}
