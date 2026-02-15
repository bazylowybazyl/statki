import * as THREE from 'three';
import { Core3D } from './core3d.js';
// Zakładam, że masz globalny dostęp do createShortNeedleExhaust z Engineeffects.js, 
// lub musisz go tu zaimportować. Na razie używamy go tak, jak w Twoim kodzie.

export const EngineVfxSystem = {
  entityEffects: new Map(),

  update(dt, entities) {
    if (!Core3D.isInitialized || !Core3D.scene) return;

    const activeEntities = new Set();
    const time = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;

    for (const entity of entities) {
      // Ignorujemy statki martwe lub bez konfiguracji silników
      if (entity.dead || !entity.capitalProfile?.engineOffsets) continue;
      
      activeEntities.add(entity);

      let fxData = this.entityEffects.get(entity);
      if (!fxData) {
        fxData = this.createEffects(entity);
        this.entityEffects.set(entity, fxData);
      }

      this.updateEffects(entity, fxData, time);
    }

    // Sprzątanie: usuwamy efekty dla zniszczonych lub usuniętych statków
    for (const [entity, fxData] of this.entityEffects) {
      if (!activeEntities.has(entity)) {
        this.disposeEffects(fxData);
        this.entityEffects.delete(entity);
      }
    }
  },

  createEffects(entity) {
    const group = new THREE.Group();
    // Dodajemy silniki pod statek (Z = -5)
    group.position.z = -5; 
    Core3D.scene.add(group);
    
    const exhausts = [];
    
    // W przyszłości możesz tu dodać: const type = entity.capitalProfile.engineType || 'needle';
    // i za pomocą instrukcji switch() tworzyć różne rodzaje płomieni dla różnych frakcji!

    for (const offset of entity.capitalProfile.engineOffsets) {
      if (typeof window !== 'undefined' && window.createShortNeedleExhaust) {
        const exhaust = window.createShortNeedleExhaust();
        // Domyślnie obracamy w tył (odrzut z ujemnej osi X)
        exhaust.group.rotation.z = Math.PI; 
        group.add(exhaust.group);
        exhausts.push({ instance: exhaust, offset });
      }
    }

    return { group, exhausts };
  },

  updateEffects(entity, fxData, time) {
    // 1. Transformacja (Śledzenie statku)
    const ex = entity.pos ? entity.pos.x : (entity.x || 0);
    const ey = entity.pos ? entity.pos.y : (entity.y || 0);
    
    // UWAGA: Konwersja na układ WebGL (odwrócone Y)
    fxData.group.position.set(ex, -ey, -5);
    fxData.group.rotation.z = -(entity.angle || 0);

    // 2. Obliczenia przepustnicy (Throttle)
    const speed = Math.hypot(entity.vx || entity.vel?.x || 0, entity.vy || entity.vel?.y || 0);
    const moveGlow = Math.min(speed / 900, 0.6) * 0.8;
    
    // Obsługa wejścia gracza (bądź AI w przyszłości)
    const thrust = entity.input?.main || 0;
    const throttle = Math.max(thrust, moveGlow);

    // 3. Pozycjonowanie poszczególnych dysz względem kadłuba
    const lengthScale = entity.capitalProfile?.lengthScale || 3.2;
    const widthScale = entity.capitalProfile?.widthScale || 1.2;
    const radius = entity.radius || 20;
    const halfL = radius * lengthScale * 0.5;
    const halfW = radius * widthScale * 0.5;

    for (const item of fxData.exhausts) {
      const lx = (item.offset.x || 0) * halfL;
      const ly = -(item.offset.y || 0) * halfW;
      
      item.instance.group.position.set(lx, ly, 0);

      if (item.instance.setThrottle) item.instance.setThrottle(throttle);
      
      // Opcjonalne pobieranie kolorów z menu dla statku gracza
      if (entity.isPlayer && window.OPTIONS?.vfx) {
         if(item.instance.setColorTemp) item.instance.setColorTemp(window.OPTIONS.vfx.colorTempK);
         if(item.instance.setBloomGain) item.instance.setBloomGain(window.OPTIONS.vfx.bloomGain);
      }
      
      if (item.instance.update) item.instance.update(time);
    }
  },

  disposeEffects(fxData) {
    if (Core3D.scene) {
      Core3D.scene.remove(fxData.group);
    }
    // Jeśli w Engineeffects.js dodasz kiedyś funkcję dispose() zwalniającą materiały z RAMu,
    // to tutaj należy ją wywołać w pętli dla każdego fxData.exhausts.
  }
};