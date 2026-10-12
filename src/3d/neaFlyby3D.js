// src/3d/neaFlyby3D.js
//
// Obraz przelotu planetoidy bliskiej Ziemi (src/game/neaFlyby.js — strumień E2, 2026-10-12): JEDNA skała
// z banku kształtów pasa, rysowana tym samym materiałem co skały gry (RockSet z rockLayers.js na
// `playMaterial` pasa — jak okruchy wydobycia), więc wygląda jak skała pola: typ, kształt, słońce pasa,
// siatka świateł, maska słońca. Pas rysuje i oświetla skały tylko, gdy kadr go dotyka — skała budzi go
// kołem `wake` (AsteroidBeltField.wakeSpots → rectTouchesBelt), a ten moduł rysuje ją tylko przy aktywnym
// pasie (słońce pasa i początek grupy pola są wtedy z tej klatki).
//
// Krok Core3D.fx „przelot NEA” (faza update — po świetle i aktywacji pasa w tej samej klatce): grupa na
// początku pul (Core3D.fx.origin), pozycja względem niego, LOD z zoomu kadru pasa. Rozgrzewka: wpis rejestru
// `przelot NEA (Apophis)` (siatki i materiał jak warstwa PLAY pasa — ten sam program; wpis na wszelki wypadek).
// Bez alokacji na klatkę.

import * as THREE from 'three/webgpu';
import { RockSet } from './asteroids/rockLayers.js';
import { BELT_LAYER_PLAY } from './asteroids/asteroidBelt.js';

// Kolejka passa gry: skały pasa 1 (asteroidBelt.js — RENDER_ORDER.rocks).
const RENDER_ORDER = 1;

export function createNeaFlyby3D({ core, getBelt, getFlyby }) {
  let set = null;
  let group = null;
  const list = [];
  const frame = { cam: { zoom: 1 }, viewW: 1, viewH: 1, focalPx: 1 };

  function ensure() {
    if (set) return true;
    const belt = getBelt();
    if (!belt || !belt.ready || !belt.bank || !belt.playMaterial || !core?.scene) return false;
    group = new THREE.Group();
    group.name = 'NeaFlyby';
    group.matrixAutoUpdate = true;
    core.scene.add(group);
    set = new RockSet({
      parent: group, layer: BELT_LAYER_PLAY, bank: belt.bank, material: belt.playMaterial,
      renderOrder: RENDER_ORDER, perspective: false, zOf: (rock) => belt.playZ(rock), name: 'NeaFlyby:rock',
      maxLod: 5, sunT: (x, y) => belt.sunT(x, y)
    });
    set.setVisible(false);
    return true;
  }

  function hide() {
    if (set && set.enabled) set.setVisible(false);
  }

  const step = {
    name: 'przelot NEA',
    update(ctx) {
      const flyby = getFlyby();
      const belt = getBelt();
      const rock = flyby?.rock;
      if (!rock || !rock.alive || !belt || !belt.active || !ensure()) { hide(); return; }
      const origin = ctx.origin;
      group.position.set(origin.x, origin.y, 0);
      set.setOrigin(origin.x, -origin.y);
      const v = belt._view;
      frame.cam.zoom = Math.max(1e-5, Number(v?.zoom) || 1);
      frame.focalPx = Number(belt._frame?.focalPx) || 1;
      if (!set.enabled) set.setVisible(true);
      list[0] = rock;
      set.set(list);
      set.update(frame);
    }
  };
  core.addFxStep(step);

  let warmEntry = null;
  if (core.warmup && typeof core.warmup.add === 'function') {
    warmEntry = core.warmup.add({
      name: 'przelot NEA (Apophis)',
      phase: 'loading',
      objects: () => (ensure() ? [group] : [])
    });
  }

  return {
    get set() { return set; },
    get warmState() { return warmEntry ? warmEntry.state : null; },
    ensure,
    stats() { return set ? { ...set.stats, visible: set.enabled } : null; }
  };
}
