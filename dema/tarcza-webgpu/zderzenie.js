// ============================================================
// Tarcza w tarczę (klawisz K). Wróg z własną tarczą-obrysem podpływa do Atlasa,
// pola się nachodzą. Punkty obrysu każdej tarczy leżące w obrysie drugiej to pas
// interferencji: co klatkę odkładają energię (i drobne drgania) w polu tej drugiej,
// najgłębszy styk co ~0,12 s to trafienie klasy 'shield' (registerShieldImpact:
// HP, iskry wyrzucane stycznie). Sprężyna odpycha wroga (Atlas stoi), po ~3,5 s
// docisku wróg wraca na pozycję.
// ============================================================
import * as THREE from 'three/webgpu';
import {
  sampleShieldProfileRadius, getEntityShieldRadiusTowards, getEntityShieldBlockingProgress
} from '../../shieldSystem.js';

const N_SAMPLES = 96;

function outlineLocal(profile, n) {
  const pts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = sampleShieldProfileRadius(profile, a);
    pts[i * 2] = Math.cos(a) * r;
    pts[i * 2 + 1] = -Math.sin(a) * r;
  }
  return pts;
}

export function createClash({ atlas, atlasShield, enemy, eEnt, eShield, eGroup }) {
  const ptsA = outlineLocal(atlasShield.profile, N_SAMPLES);
  const ptsE = outlineLocal(eShield.profile, N_SAMPLES);
  const _w = new THREE.Vector2(), _l = new THREE.Vector2();
  const C = {
    on: false, phase: 'idle', t: 0, vx: 0, vy: 0, contact: false, depth: 0,
    hitCdA: 0, hitCdE: 0, contacts: 0
  };
  const ship = enemy.ship;

  // Synchronizacja encji wroga (układ gry) i grupy jego tarczy (3D) z okrętem.
  function syncEnemy() {
    eEnt.x = ship.x; eEnt.y = -ship.y; eEnt.angle = -ship.angle;
    eGroup.position.set(ship.x, ship.y, 0);
    eGroup.rotation.set(0, 0, ship.angle);
    eGroup.updateMatrixWorld(true);
  }

  // Punkty obrysu `pts` tarczy `from` leżące w obrysie tarczy `into`: energia w polu
  // `into` (klatka lokalna `intoShield`). Zwraca najgłębszy styk (układ gry) i głębokość.
  const deepest = { x: 0, y: 0, pen: 0, n: 0 };
  function band(pts, fromShield, into, intoShield, dt) {
    deepest.pen = 0; deepest.n = 0;
    const prog = getEntityShieldBlockingProgress(into);
    if (prog <= 0) return deepest;
    for (let i = 0; i < N_SAMPLES; i++) {
      fromShield.localToWorld(pts[i * 2], pts[i * 2 + 1], _w);
      const d = Math.hypot(_w.x - into.x, _w.y - into.y);
      const R = getEntityShieldRadiusTowards(into, _w.x, _w.y) * prog;
      if (d >= R) continue;
      const pen = R - d;
      intoShield.worldToLocal(_w.x, _w.y, _l);
      // Pas interferencji: energia + trzaski (losowy impuls) wzdłuż styku.
      const jitter = (Math.random() - 0.5) * 420;
      intoShield.pushEvent(_l.x, _l.y, 46 * intoShield.sizeK, jitter - 60, 1.1 * dt);
      intoShield.addHeat(_l.x, _l.y, 0.5 * dt);
      intoShield.wake(0);
      deepest.n++;
      if (pen > deepest.pen) { deepest.pen = pen; deepest.x = _w.x; deepest.y = _w.y; }
    }
    return deepest;
  }

  function update(dt) {
    if (C.phase === 'idle') { C.contact = false; C.contacts = 0; return; }
    C.t += dt;
    // Kierunek do Atlasa (3D).
    const ax = atlas.x, ay = -atlas.y;
    let dx = ax - ship.x, dy = ay - ship.y;
    const dist = Math.hypot(dx, dy) || 1;
    dx /= dist; dy /= dist;
    if (C.phase === 'approach' || C.phase === 'press') {
      const thrust = C.phase === 'approach' ? 900 : 520;
      C.vx += dx * thrust * dt; C.vy += dy * thrust * dt;
    } else if (C.phase === 'retreat') {
      const hx = enemy.home.x - ship.x, hy = enemy.home.y - ship.y;
      const hd = Math.hypot(hx, hy);
      if (hd < 60) { C.phase = 'idle'; C.vx = C.vy = 0; ship.x = enemy.home.x; ship.y = enemy.home.y; syncEnemy(); return; }
      C.vx += hx / hd * 700 * dt; C.vy += hy / hd * 700 * dt;
    }
    // Opór i limit prędkości.
    const damp = Math.exp(-dt * (C.phase === 'retreat' ? 1.2 : 0.8));
    C.vx *= damp; C.vy *= damp;
    const sp = Math.hypot(C.vx, C.vy);
    const vmax = C.phase === 'retreat' ? 650 : 700;
    if (sp > vmax) { C.vx *= vmax / sp; C.vy *= vmax / sp; }
    ship.x += C.vx * dt; ship.y += C.vy * dt;
    ship.group.position.set(ship.x, ship.y, 0);
    ship.group.updateMatrixWorld(true);
    syncEnemy();

    // Styk pól: pas na OBU tarczach.
    const dA = band(ptsE, eShield, atlas, atlasShield, dt);
    const penA = dA.pen, nA = dA.n, axh = dA.x, ayh = dA.y;
    const dE = band(ptsA, atlasShield, eEnt, eShield, dt);
    const penE = dE.pen, nE = dE.n, exh = dE.x, eyh = dE.y;
    C.contacts = nA + nE;
    C.contact = C.contacts > 0;
    C.depth = Math.max(penA, penE);
    if (C.contact) {
      if (C.phase === 'approach') { C.phase = 'press'; C.t = 0; }
      // Sprężyna: odpycha wroga od Atlasa ∝ głębokości.
      const k = 6 * C.depth;
      C.vx -= dx * k * dt; C.vy -= dy * k * dt;
      // Najgłębsze styki = trafienia klasy 'shield' (HP, iskry styczne).
      C.hitCdA -= dt; C.hitCdE -= dt;
      if (nA > 0 && C.hitCdA <= 0) { atlasShield.registerHit(axh, ayh, 18 + penA * 0.2, 'shield'); C.hitCdA = 0.12; }
      if (nE > 0 && C.hitCdE <= 0) { eShield.registerHit(exh, eyh, 18 + penE * 0.2, 'shield'); C.hitCdE = 0.12; }
    }
    if (C.phase === 'press' && C.t > 3.5) { C.phase = 'retreat'; C.t = 0; }
    if (C.phase === 'approach' && C.t > 12) { C.phase = 'retreat'; C.t = 0; }
  }

  return {
    C, update, syncEnemy,
    // fast: wróg od razu tuż przed stykiem pól (test w kontenerze — dolot trwa ~6 s).
    toggle(on, fast = false) {
      const want = on === undefined ? (C.phase === 'idle' || C.phase === 'retreat') : !!on;
      if (want) {
        C.phase = 'approach'; C.t = 0;
        if (fast) {
          const hx = enemy.home.x - atlas.x, hy = enemy.home.y + atlas.y;
          const hd = Math.hypot(hx, hy) || 1;
          const rA = getEntityShieldRadiusTowards(atlas, atlas.x + hx, atlas.y - hy);
          const rE = getEntityShieldRadiusTowards(eEnt, atlas.x, atlas.y);
          const d = rA + rE + 80;
          ship.x = atlas.x + hx / hd * d; ship.y = -atlas.y + hy / hd * d;
          ship.group.position.set(ship.x, ship.y, 0);
          ship.group.updateMatrixWorld(true);
          C.vx = -hx / hd * 250; C.vy = -hy / hd * 250;
          syncEnemy();
        }
      } else if (C.phase !== 'idle') { C.phase = 'retreat'; C.t = 0; }
      return want;
    }
  };
}
