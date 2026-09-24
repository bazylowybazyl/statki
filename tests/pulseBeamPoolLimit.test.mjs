import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';
import { Core3D } from '../src/3d/core3d.js';
import { Weapon3DSystem, MAX_PULSE_BEAM_VISUALS } from '../src/3d/weapon3DSystem.js';

// Wizual wiązki pulsacyjnej to Group + 2 Mesh + 2 materiały w scenie. Pula
// rosła bez sufitu: tysiące strzałów PD na sekundę = setki aktywnych grup
// i draw calli na stałe (audyt 2026-09-24, p. 2.2).

function withFakeScene(fn) {
  const saved = { init: Core3D.isInitialized, scene: Core3D.scene, doc: globalThis.document };
  // makeHeadTexture rysuje na kanwie — w node wystarczy kanwa bez kontekstu.
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  Core3D.isInitialized = true;
  Core3D.scene = new THREE.Scene();
  Weapon3DSystem._pulseBeamPool.length = 0;
  Weapon3DSystem._pulseBeamActive.length = 0;
  try {
    return fn(Core3D.scene);
  } finally {
    Weapon3DSystem._pulseBeamPool.length = 0;
    Weapon3DSystem._pulseBeamActive.length = 0;
    Core3D.isInitialized = saved.init;
    Core3D.scene = saved.scene;
    if (saved.doc === undefined) delete globalThis.document;
    else globalThis.document = saved.doc;
  }
}

function pulseDetail(i) {
  return {
    weaponId: 'beam_pulse',
    beamMode: 'pulse',
    beam: { startX: i, startY: 0, endX: i + 500, endY: 0, width: 5, mode: 'pulse' }
  };
}

test('pula wiązek pulse nie rośnie ponad MAX_PULSE_BEAM_VISUALS', () => {
  assert.equal(MAX_PULSE_BEAM_VISUALS, 96);
  withFakeScene((scene) => {
    for (let i = 0; i < 500; i++) Weapon3DSystem._triggerBeamFx(pulseDetail(i));
    const active = Weapon3DSystem._pulseBeamActive.length;
    const pooled = Weapon3DSystem._pulseBeamPool.length;
    assert.equal(active, MAX_PULSE_BEAM_VISUALS);
    assert.equal(pooled, 0);
    assert.equal(scene.children.filter((c) => c.isGroup).length, MAX_PULSE_BEAM_VISUALS, 'grupy w scenie ponad limit');
  });
});

test('po zapełnieniu recyklingowana jest najstarsza aktywna wiązka', () => {
  withFakeScene(() => {
    for (let i = 0; i < MAX_PULSE_BEAM_VISUALS; i++) Weapon3DSystem._triggerBeamFx(pulseDetail(i));
    const active = Weapon3DSystem._pulseBeamActive;
    // Postarzamy jedną wiązkę — to ją ma przejąć następny strzał.
    const oldest = active[17];
    oldest.life = 0.001;
    const next = Weapon3DSystem._acquirePulseBeam();
    assert.equal(next, oldest);
    assert.equal(active.length, MAX_PULSE_BEAM_VISUALS, 'recykling nie dopisuje drugi raz do aktywnych');
  });
});

test('wygasłe wiązki wracają do puli i są brane z niej, zanim powstanie nowa', () => {
  withFakeScene((scene) => {
    for (let i = 0; i < 10; i++) Weapon3DSystem._triggerBeamFx(pulseDetail(i));
    Weapon3DSystem._updateBeamFx(1, 0);
    assert.equal(Weapon3DSystem._pulseBeamActive.length, 0);
    assert.equal(Weapon3DSystem._pulseBeamPool.length, 10);
    for (let i = 0; i < 10; i++) Weapon3DSystem._triggerBeamFx(pulseDetail(i));
    assert.equal(scene.children.filter((c) => c.isGroup).length, 10, 'nowe grupy mimo pełnej puli');
  });
});
