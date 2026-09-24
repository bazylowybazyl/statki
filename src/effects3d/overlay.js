import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { BLOOM_DEFAULTS } from "../3d/bloomConfig.js";
import { flushParticlePools } from "./particlePool.js";

const RestoreAlphaShader = {
  uniforms: {
    'tDiffuse': { value: null }
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;

    // Funkcja ACES Filmic
    vec3 ACESFilmicToneMapping(vec3 color) {
      color *= 1.2; // Ekspozycja
      return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
    }

    // Konwersja do sRGB
    vec3 LinearTosRGB(vec3 color) {
      return mix(pow(color, vec3(0.41666)) * 1.055 - vec3(0.055), color * 12.92, vec3(lessThanEqual(color, vec3(0.0031308))));
    }

    void main() {
      vec4 tex = texture2D( tDiffuse, vUv );

      // Alfę liczymy z SUROWEGO, potężnego sygnału HDR, żeby dym i poświata były widoczne
      float brightness = max(tex.r, max(tex.g, tex.b));
      float alpha = min(1.0, brightness * 1.5);

      // Aplikujemy Tone Mapping do kolorów
      vec3 mappedColor = ACESFilmicToneMapping(tex.rgb);
      mappedColor = LinearTosRGB(mappedColor);

      gl_FragColor = vec4(mappedColor, alpha);
    }
  `
};

export function initOverlay({
  host,
  getView,
  mode = "screen",
  zIndex = 20,
  useBloom = true,
  useAlphaPass = true,
  adaptiveQuality = true,
  updateSparkSystem = true,
  baseRenderScale = 0.8,
  // Druga scena RENDEROWANA W TYM SAMYM KONTEKŚCIE, nad skomponowaną warstwą
  // efektów (odpowiednik dawnego rocketOverlay3D na zIndex 21). Każdy osobny
  // initOverlay tworzył własny WebGLRenderer — przy strzelaniu przeglądarka
  // przełączała się między trzema kontekstami na klatkę.
  withRawLayer = false
} = {}) {
  if (!host) throw new Error("initOverlay: host element is required");

  const useComposer = !!(useBloom || useAlphaPass);

  function getOverlayBloomConfig() {
    const bloom = (typeof window !== 'undefined' && window.DevVFX?.bloom) ? window.DevVFX.bloom : null;
    return {
      strength: Math.max(0, Number.isFinite(Number(bloom?.overlayStrength)) ? Number(bloom.overlayStrength) : BLOOM_DEFAULTS.overlayStrength),
      radius: Math.max(0, Number.isFinite(Number(bloom?.overlayRadius)) ? Number(bloom.overlayRadius) : BLOOM_DEFAULTS.overlayRadius),
      threshold: Math.max(0, Number.isFinite(Number(bloom?.overlayThreshold)) ? Number(bloom.overlayThreshold) : BLOOM_DEFAULTS.overlayThreshold)
    };
  }

  // Chwilowe modyfikatory bloomu od efektów (supernowa: podbicie, Yamato:
  // przygaszenie), liczone CO KLATKĘ od bazy (DevVFX / BLOOM_DEFAULTS). Efekty
  // nie zapisują już bazy i nie odtwarzają jej na końcu — dawniej dwa niezależne
  // „zapisz/przywróć” na tej samej konfiguracji (w dodatku w DevVFX, czyli
  // w zapisie tunera) przy nałożeniu Yamato i supernowej zostawiały bloom
  // zepsuty do końca sesji. Pola modyfikatora (wszystkie opcjonalne):
  //   strengthAdd / radiusAdd — dodatek (z kilku efektów bierzemy największy),
  //   threshold — próg (bierzemy najniższy), strengthCap — sufit siły (najniższy).
  const bloomModifiers = new Map();

  function applyOverlayBloomConfig() {
    if (!bloomPass) return null;
    const cfg = getOverlayBloomConfig();
    if (bloomModifiers.size > 0) {
      let strengthAdd = 0;
      let radiusAdd = 0;
      let threshold = cfg.threshold;
      let strengthCap = Infinity;
      for (const mod of bloomModifiers.values()) {
        if (mod.strengthAdd > strengthAdd) strengthAdd = mod.strengthAdd;
        if (mod.radiusAdd > radiusAdd) radiusAdd = mod.radiusAdd;
        if (Number.isFinite(mod.threshold) && mod.threshold < threshold) threshold = mod.threshold;
        if (Number.isFinite(mod.strengthCap) && mod.strengthCap < strengthCap) strengthCap = mod.strengthCap;
      }
      cfg.strength = Math.min(cfg.strength + strengthAdd, strengthCap);
      cfg.radius += radiusAdd;
      cfg.threshold = Math.max(0, threshold);
    }
    bloomPass.strength = cfg.strength;
    bloomPass.radius = cfg.radius;
    bloomPass.threshold = cfg.threshold;
    return cfg;
  }

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: true, 
    premultipliedAlpha: false,
    powerPreference: "high-performance"
  });
  
  const dpr = Math.min(1.2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);
  window._overlayDpr = dpr;
  renderer.setSize(host.clientWidth, host.clientHeight, false);
  renderer.setClearColor(0x000000, 0);
  
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  const dom = renderer.domElement;
  dom.classList.add("overlay3d");
  dom.style.pointerEvents = "none";
  dom.style.position = "absolute";
  dom.style.inset = "0";
  dom.style.zIndex = String(zIndex);
  dom.style.background = "transparent";
  dom.style.mixBlendMode = mode === "raw" ? "normal" : "screen";

  host.appendChild(dom);

  const scene = new THREE.Scene();
  scene.background = null;

  // Warstwa "raw" (rakiety): bez bloomu i bez alpha-passa, rysowana bezpośrednio
  // na kanwę PO skomponowanej warstwie efektów — czyli w tej samej kolejności co
  // dawniej, gdy siedziała na osobnym canvasie z wyższym zIndexem.
  const rawScene = withRawLayer ? new THREE.Scene() : null;
  if (rawScene) rawScene.background = null;

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 120, 0);
  camera.lookAt(0, 0, 0);

  let renderScale = Math.max(0.25, Number(baseRenderScale) || 0.8);
  let renderTarget = null;
  let composer = null;
  let bloomPass = null;

  if (useComposer) {
    renderTarget = new THREE.WebGLRenderTarget(
      host.clientWidth * renderer.getPixelRatio(),
      host.clientHeight * renderer.getPixelRatio(),
      {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        stencilBuffer: false,
        depthBuffer: true
      }
    );

    composer = new EffectComposer(renderer, renderTarget);
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearColor = new THREE.Color(0, 0, 0);
    renderPass.clearAlpha = 0;
    composer.addPass(renderPass);

    if (useBloom) {
      const initialBloom = getOverlayBloomConfig();
      bloomPass = new UnrealBloomPass(
        new THREE.Vector2(
          Math.max(1, Math.floor(host.clientWidth * renderScale)),
          Math.max(1, Math.floor(host.clientHeight * renderScale))
        ),
        initialBloom.strength,
        initialBloom.radius,
        initialBloom.threshold
      );
      composer.addPass(bloomPass);
    }

    if (useAlphaPass) {
      const alphaPass = new ShaderPass(RestoreAlphaShader);
      composer.addPass(alphaPass);
    }
  } else {
    renderScale = 1.0;
  }

  const effects = [];
  const stats = {
    activeEffects: 0,
    droppedEffects: 0,
    lastRenderMs: 0,
    maxEffects: 72,
    renderScale,
    bloomEnabled: !!bloomPass,
    frameSkip: 1,
    updateSkip: 1,
    skippedFrames: 0
  };
  const perf = { frameSkip: 1, skipCursor: 0, updateSkip: 1, updateCursor: 0, accumDt: 0 };
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
      if (composer) {
        composer.setSize(Math.max(1, Math.floor(w * renderScale)), Math.max(1, Math.floor(h * renderScale)));
      }
      lastSizeW = w;
      lastSizeH = h;
    }
  }

  // Poziomy jakości (0 = pełna). Zmiana skali = composer.setSize, czyli
  // realokacja 13 render targetów (2 kompozytora + 11 bloomu). Presja liczy się
  // z czasu renderu PRZY bieżącej skali, więc bez histerezy poziom skakał
  // w dół i z powrotem co kilka klatek — każdy skok to przycięcie.
  const QUALITY_TIERS = Object.freeze([
    Object.freeze({ above: -Infinity, scale: 0.84, frameSkip: 1, updateSkip: 1, bloom: true,  maxEffects: 96 }),
    Object.freeze({ above: 0.45, scale: 0.76, frameSkip: 1, updateSkip: 1, bloom: true,  maxEffects: 92 }),
    Object.freeze({ above: 0.72, scale: 0.68, frameSkip: 2, updateSkip: 1, bloom: false, maxEffects: 82 }),
    Object.freeze({ above: 1.0,  scale: 0.58, frameSkip: 2, updateSkip: 2, bloom: false, maxEffects: 72 }),
    Object.freeze({ above: 1.4,  scale: 0.5,  frameSkip: 2, updateSkip: 2, bloom: false, maxEffects: 62 }),
    Object.freeze({ above: 1.9,  scale: 0.42, frameSkip: 3, updateSkip: 3, bloom: false, maxEffects: 52 }),
    Object.freeze({ above: 2.6,  scale: 0.34, frameSkip: 4, updateSkip: 4, bloom: false, maxEffects: 40 })
  ]);
  // Pogorszenie od razu (chroni klatkę w szczycie bitwy); poprawa o jeden
  // poziom dopiero, gdy presja przez TIER_UPGRADE_HOLD_MS trzyma się wyraźnie
  // (TIER_UPGRADE_MARGIN) poniżej progu bieżącego poziomu.
  const TIER_UPGRADE_HOLD_MS = 1500;
  const TIER_UPGRADE_MARGIN = 0.75;
  let qualityTier = 0;
  let tierUpgradeSinceMs = -1;

  function tierForPressure(pressure) {
    for (let i = QUALITY_TIERS.length - 1; i > 0; i--) {
      if (pressure > QUALITY_TIERS[i].above) return i;
    }
    return 0;
  }

  function applyAdaptiveQuality() {
    if (!adaptiveQuality || !composer) {
      perf.frameSkip = 1; perf.updateSkip = 1; stats.maxEffects = 96; stats.renderScale = renderScale;
      stats.bloomEnabled = !!bloomPass?.enabled; stats.frameSkip = perf.frameSkip; stats.updateSkip = perf.updateSkip;
      return;
    }
    const active = effects.length;
    const prevRenderMs = Number(stats.lastRenderMs) || 0;
    const pressure = Math.max(active / 70, prevRenderMs / 6.5);
    const nowMs = (typeof performance !== "undefined") ? performance.now() : 0;

    const wantedTier = tierForPressure(pressure);
    if (wantedTier > qualityTier) {
      qualityTier = wantedTier;
      tierUpgradeSinceMs = -1;
    } else if (qualityTier > 0 && pressure < QUALITY_TIERS[qualityTier].above * TIER_UPGRADE_MARGIN) {
      if (tierUpgradeSinceMs < 0) {
        tierUpgradeSinceMs = nowMs;
      } else if (nowMs - tierUpgradeSinceMs >= TIER_UPGRADE_HOLD_MS) {
        qualityTier--;
        tierUpgradeSinceMs = nowMs; // kolejny krok znów po pełnym czasie
      }
    } else {
      tierUpgradeSinceMs = -1;
    }
    stats.qualityTier = qualityTier;

    const tier = QUALITY_TIERS[qualityTier];
    const targetScale = tier.scale;
    const targetBloom = tier.bloom;
    const targetMaxEffects = tier.maxEffects;
    let targetFrameSkip = tier.frameSkip;
    let targetUpdateSkip = tier.updateSkip;

    // Same pule w scenie (lista efektów pusta): bez pomijania klatek, żeby
    // dogasające cząstki nie klatkowały. Skali już NIE podbijamy — chwilowo
    // pusta lista w środku bitwy przełączała rozmiar kompozytora tam i z powrotem.
    if (active === 0) { targetFrameSkip = 1; targetUpdateSkip = 1; }

    if (effects.length > targetMaxEffects) {
      const overflow = effects.length - targetMaxEffects;
      let removedCount = 0;
      
      // 1. Zrzucamy najstarsze ZWYKŁE efekty (omijamy important: true)
      for (let i = 0; i < effects.length && removedCount < overflow; i++) {
        if (!effects[i].important) {
          const fx = effects.splice(i, 1)[0];
          if (fx.group?.parent) fx.group.parent.remove(fx.group);
          if (typeof fx.dispose === "function") fx.dispose();
          removedCount++;
          i--; // Cofamy wskaźnik, bo usunęliśmy element
        }
      }
      
      // 2. Fallback (bardzo rzadkie): usuwamy cokolwiek, jeśli wszystko to important
      while (removedCount < overflow && effects.length > 0) {
        const fx = effects.shift();
        if (fx.group?.parent) fx.group.parent.remove(fx.group);
        if (typeof fx.dispose === "function") fx.dispose();
        removedCount++;
      }
      stats.droppedEffects += overflow;
    }

    if (Math.abs(targetScale - renderScale) > 0.01) {
      renderScale = targetScale;
      composer.setSize(Math.max(1, Math.floor(lastSizeW * renderScale)), Math.max(1, Math.floor(lastSizeH * renderScale)));
    }
    perf.frameSkip = targetFrameSkip; perf.updateSkip = targetUpdateSkip; stats.maxEffects = targetMaxEffects;
    if (bloomPass && bloomPass.enabled !== targetBloom) bloomPass.enabled = targetBloom;
    stats.renderScale = renderScale; stats.bloomEnabled = !!bloomPass?.enabled;
    stats.frameSkip = perf.frameSkip; stats.updateSkip = perf.updateSkip;
  }

  // Niewidoczne dziecko nie generuje draw calla, więc nie jest powodem do
  // odpalania całego kompozytora.
  function sceneHasVisibleContent(target) {
    const kids = target.children;
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].visible !== false) return true;
    }
    return false;
  }

  function tick(dt) {
    syncCamera();
    applyAdaptiveQuality();
    if (useBloom) applyOverlayBloomConfig();

    if (updateSparkSystem && typeof window !== 'undefined' && window.SparkSystem3D?.isInitialized) {
      window.SparkSystem3D.update(dt);
    }

    let updateNow = true;
    let stepDt = dt;
    if (perf.updateSkip > 1) {
      perf.accumDt += dt;
      perf.updateCursor = (perf.updateCursor + 1) % perf.updateSkip;
      updateNow = perf.updateCursor === 0;
      if (updateNow) { stepDt = perf.accumDt; perf.accumDt = 0; }
    }

    if (updateNow) {
      for (let i = effects.length - 1; i >= 0; i--) {
        const fx = effects[i];
        if (fx.update) fx.update(stepDt);
        if (!fx.group || !fx.group.parent) effects.splice(i, 1);
      }
    }

    stats.activeEffects = effects.length;

    // Pule cząstek GPU (reactorblow / yamato / supernova) wiszą w scenie od startu
    // gry, więc `scene.children.length > 0` było prawdziwe ZAWSZE i composer —
    // RenderPass + UnrealBloom (5 poziomów mipów) + ShaderPass — mielił każdą
    // klatkę, także przy zerowej liczbie efektów. Flush zwraca, czy w pulach są
    // jeszcze żywe cząstki, i chowa siatki, gdy ich nie ma.
    const nowSec = (typeof performance !== "undefined") ? performance.now() / 1000 : 0;
    const hasLivePools = flushParticlePools(nowSec);
    const hasPersistentSceneContent = hasLivePools || sceneHasVisibleContent(scene);
    // Siatki rakiet wiszą w rawScene od startu i chowają się, gdy są puste —
    // liczba dzieci była > 0 zawsze, więc warstwa raw rysowała się co klatkę.
    const hasRawContent = !!(rawScene && sceneHasVisibleContent(rawScene));
    stats.rawObjects = rawScene ? rawScene.children.length : 0;
    if (effects.length === 0 && !hasPersistentSceneContent && !hasRawContent) {
      renderer.clear();
      stats.lastRenderMs = 0; perf.accumDt = 0;
      return;
    }
    perf.skipCursor = (perf.skipCursor + 1) % perf.frameSkip;
    if (perf.skipCursor !== 0) { stats.skippedFrames += 1; return; }

    renderer.clear();
    const t0 = (typeof performance !== "undefined") ? performance.now() : 0;
    if (effects.length || hasPersistentSceneContent) {
      if (composer) composer.render(); else renderer.render(scene, camera);
    }
    if (hasRawContent) {
      // Kompozytor kończy passem na kanwę (czyści ją przez autoClear), więc
      // warstwa raw MUSI iść po nim — z wyłączonym autoClear, inaczej skasuje
      // efekty. Kolejność = dawny zIndex 21 nad 20.
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      // Fullscreen quad kompozytora zostawia zapis w buforze głębi — bez
      // wyczyszczenia samej głębi rakiety potrafią zostać odrzucone testem Z.
      // Na osobnej kanwie miały własny bufor, więc problem nie istniał.
      renderer.clearDepth();
      renderer.render(rawScene, camera);
      renderer.autoClear = prevAutoClear;
    }
    stats.lastRenderMs = (t0 > 0) ? (performance.now() - t0) : 0;
  }

  function spawn(effect) {
    if (!effect) return;
    
    // Jeśli brak miejsca w kolejce - inteligentne wyrzucanie starych, nieważnych cząstek
    if (effects.length >= stats.maxEffects) {
      let removed = false;
      for (let i = 0; i < effects.length; i++) {
        if (!effects[i].important) {
          const oldFx = effects.splice(i, 1)[0];
          if (oldFx.group?.parent) oldFx.group.parent.remove(oldFx.group);
          if (typeof oldFx.dispose === "function") oldFx.dispose();
          removed = true;
          break;
        }
      }
      // Ostateczność
      if (!removed) {
        const oldFx = effects.shift();
        if (oldFx && oldFx.group?.parent) oldFx.group.parent.remove(oldFx.group);
        if (oldFx && typeof oldFx.dispose === "function") oldFx.dispose();
      }
      stats.droppedEffects += 1;
    }
    
    if (effect.group) {
        scene.add(effect.group);
        effects.push(effect);
        stats.activeEffects = effects.length;
    }
  }

  function resize() { syncCamera(); }

  function dispose() {
    effects.length = 0;
    if (dom.parentElement === host) host.removeChild(dom);
    if (composer) composer.dispose();
    renderer.dispose();
    if (renderTarget) renderTarget.dispose();
  }

  // Fasada warstwy raw — ten sam kształt API co osobny overlay (scene/tick/
  // resize/dispose), ale tick i resize są puste: rysowaniem i kamerą zarządza
  // nadrzędny tick, bo dzielą jeden renderer i jedną kanwę.
  const rawLayer = rawScene ? {
    scene: rawScene,
    camera,
    renderer,
    composer: null,
    tick: () => {},
    spawn: () => {},
    resize: () => {},
    dispose: () => { rawScene.clear(); },
    getStats: () => ({ merged: true, objects: rawScene.children.length })
  } : null;

  return {
    scene, camera, renderer, composer, tick, spawn, resize, dispose, rawScene, rawLayer,
    getStats: () => ({ ...stats }),
    getBloomConfig: () => ({ ...getOverlayBloomConfig() }),
    setBloomConfig: (next = {}) => {
      const devVfx = (window.DevVFX = window.DevVFX || {});
      const bloom = (devVfx.bloom = Object.assign({}, devVfx.bloom || {}));
      if (next && typeof next === "object") {
        if (next.strength != null) bloom.overlayStrength = Number(next.strength);
        if (next.radius != null) bloom.overlayRadius = Number(next.radius);
        if (next.threshold != null) bloom.overlayThreshold = Number(next.threshold);
      }
      return applyOverlayBloomConfig();
    },
    // Dla efektów: modyfikator żyje pod własnym kluczem, obiekt można mutować
    // co klatkę (czytany przy każdym ticku). Zdejmowanie = clearBloomModifier.
    setBloomModifier: (key, modifier) => {
      if (key == null) return;
      if (modifier && typeof modifier === "object") bloomModifiers.set(key, modifier);
      else bloomModifiers.delete(key);
    },
    clearBloomModifier: (key) => { bloomModifiers.delete(key); }
  };
}