
    // Most ES-module -> window. Zostają tu WYŁĄCZNIE symbole, które moduły w src/
    // czytają przez `window.` (nie mogą ich zaimportować, bo powstałby cykl),
    // plus konsolowe API Core3D* do ręcznego strojenia w devtools.
    // Wszystko, co potrzebuje tylko główny skrypt, jest tam importowane wprost.
    import * as THREE from "three";
    import { initStations3D, updateStations3D, detachPlanetStations3D, drawStations3D } from "./src/3d/stations3D.js";
    import { Core3D } from "./src/3d/core3d.js";
    import { Destruction3D } from "./src/vfx/destruction3D.js";
    import { drawInfrastructureIcon, updateInfrastructureAnimations } from './src/buildings/infrastructureView.js';
    import { DestructorSystem, initHexBody } from "./src/game/destructor.js";

    // Uchwyt do konsoli przeglądarki; kod importuje three samodzielnie.
    window.THREE = THREE;

    window.Core3D = Core3D;
    window.initStations3D = initStations3D;
    window.updateStations3D = updateStations3D;
    window.detachPlanetStations3D = detachPlanetStations3D;
    window.drawStations3D = drawStations3D;
    window.Destruction3D = Destruction3D;
    window.drawInfrastructureIcon = drawInfrastructureIcon;
    window.updateInfrastructureAnimations = updateInfrastructureAnimations;
    window.DestructorSystem = DestructorSystem;
    window.initHexBody = initHexBody;

    // --- konsolowe API do strojenia rendera (devtools) ---
    window.Core3DPerfStatus = () => (window.Core3D?.getPerfStatus ? window.Core3D.getPerfStatus() : null);
    window.Core3DPerf = (opts = {}) => (window.Core3D?.setPerfToggles ? window.Core3D.setPerfToggles(opts) : null);
    window.Core3DMsaa = (enabled = true, samples = 4) => (window.Core3D?.setMsaaEnabled ? window.Core3D.setMsaaEnabled(enabled, samples) : null);
    window.Core3DShaftQuality = (quality = 'medium') => (window.Core3D?.setShadowShaftsQuality ? window.Core3D.setShadowShaftsQuality(quality) : null);
    window.Core3DPreset = (name = 'base') => {
      if (!window.Core3D) return null;
      const key = String(name || '').toLowerCase();
      if (key === 'base' || key === 'default') {
        window.Core3D.setPerfToggles?.({ bloom: true, heatHaze: true, threeShadows: true, bgPass: true, planetPass: true, orthoPass: true, fgPass: true, enginePointLights: true });
        window.Core3D.setShadowShaftsQuality?.(window.OPTIONS?.shadowShafts || 'medium');
        window.Core3D.setMsaaEnabled?.(true, 4);
      } else if (key === 'nobloom') {
        window.Core3D.setPerfToggles?.({ bloom: false });
      } else if (key === 'noheat') {
        window.Core3D.setPerfToggles?.({ heatHaze: false });
      } else if (key === 'nofg') {
        window.Core3D.setPerfToggles?.({ fgPass: false });
      } else if (key === 'fast') {
        window.Core3D.setPerfToggles?.({ bloom: false, heatHaze: false, fgPass: true, bgPass: true, orthoPass: true, enginePointLights: false });
        window.Core3D.setShadowShaftsQuality?.('low');
        window.Core3D.setMsaaEnabled?.(false);
      } else if (key === 'ultrafast') {
        window.Core3D.setPerfToggles?.({ bloom: false, heatHaze: false, threeShadows: false, fgPass: false, planetPass: false, bgPass: true, orthoPass: true, enginePointLights: false });
        window.Core3D.setShadowShaftsQuality?.('off');
        window.Core3D.setMsaaEnabled?.(false);
      }
      const status = window.Core3D.getPerfStatus?.();
      console.log('[Core3DPreset]', key, status);
      return status;
    };
  