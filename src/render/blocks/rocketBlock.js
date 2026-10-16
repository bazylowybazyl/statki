// src/render/blocks/rocketBlock.js — blok migawki: pula rakiet w locie (docs/PLAN-render-worker.md § 3.2 ROCKETS,
// RW-40b). Lot rakiet liczy gra (src/game/rockets/rocketSim.js, krok fizyki — RW-23); obraz (reżyser efektów
// src/3d/rockets/effects.js i dekoder RKT_* — rocketFxCommands.js) czyta rakietę z puli po indeksie. Inline — obiekt
// gry; w workerze — LUSTRO z tego bloku: pola, które czyta reżyser (pozycja, prędkość, kierunek nosa, ciąg, faza,
// stan, układ wyrzutni), strzelec i cel (slot + generacja encji), broń (id przez słownik strony; definicję wysyła
// strona raz — `weaponDefs`).
//
// Rejestracja (strona gry): `packer.addBlock(createRocketBlock())`, w fazie begin `frame.rockets = pula`. Strona
// renderu: `applyRocketBlock(blk, dict, mirror, entityAt, defOf)` → `mirror.pool[i]`. Czysty moduł.

const F = Object.freeze({
  IDX: 0, STATE: 1, MODE: 2, PHASE: 3, WEAPON: 4, SHOOTER_S: 5, SHOOTER_G: 6, TARGET_S: 7, TARGET_G: 8,
  BODY: 9, THRUST: 10, MAX_THRUST: 11, PITCH: 12, AGE: 13,
  PX: 14, PY: 15, PZ: 16, VX: 17, VY: 18, VZ: 19, FVX: 20, FVY: 21, FVZ: 22, DX: 23, DY: 24, DZ: 25,
  STRIDE: 26
});
export const ROCKET_BLOCK = Object.freeze({ HEAD: Object.freeze({ CAP: 0, N: 1, STRIDE: 4 }), REC: F, CAP: 256 });

const H = ROCKET_BLOCK.HEAD;

export function createRocketBlock() {
  return {
    name: 'rockets', f64: H.STRIDE + ROCKET_BLOCK.CAP * F.STRIDE, phase: 'begin',
    pack(blk, frame, packer) {
      const D = blk.f64;
      const pool = frame.rockets || null;
      const cap = pool ? pool.length : 0;
      D[H.CAP] = cap;
      let n = 0;
      const ents = packer.ids.entities;
      for (let i = 0; i < cap; i++) {
        const r = pool[i];
        if (!r || !r.active) continue;
        const o = H.STRIDE + n * F.STRIDE;
        if (o + F.STRIDE > D.length) { packer.resizeBlock('rockets', { f64: H.STRIDE + cap * F.STRIDE }); break; }
        D[o + F.IDX] = i;
        D[o + F.STATE] = packer.dict.code(r.state);
        D[o + F.MODE] = packer.dict.code(r.mode);
        D[o + F.PHASE] = packer.dict.code(r.guidancePhase);
        D[o + F.WEAPON] = packer.dict.code(r.weaponDef ? r.weaponDef.id : null);
        const ss = r.shooter ? ents.peek(r.shooter) : -1;
        D[o + F.SHOOTER_S] = ss; D[o + F.SHOOTER_G] = ss >= 0 ? ents.gen(ss) : 0;
        const ts = r.target ? ents.peek(r.target) : -1;
        D[o + F.TARGET_S] = ts; D[o + F.TARGET_G] = ts >= 0 ? ents.gen(ts) : 0;
        D[o + F.BODY] = r.bodyScale; D[o + F.THRUST] = r.currentThrust; D[o + F.MAX_THRUST] = r.maxThrust;
        D[o + F.PITCH] = r.nosePitch; D[o + F.AGE] = r.timeSinceLaunch;
        const p = r.position, v = r.velocity, fv = r.frameVel, d = r.visualDir;
        D[o + F.PX] = p.x; D[o + F.PY] = p.y; D[o + F.PZ] = p.z;
        D[o + F.VX] = v.x; D[o + F.VY] = v.y; D[o + F.VZ] = v.z;
        D[o + F.FVX] = fv.x; D[o + F.FVY] = fv.y; D[o + F.FVZ] = fv.z;
        D[o + F.DX] = d.x; D[o + F.DY] = d.y; D[o + F.DZ] = d.z;
        n++;
      }
      D[H.N] = n;
    }
  };
}

const vec = () => ({ x: 0, y: 0, z: 0 });

export function createRocketMirror() {
  return { pool: [] };
}

/** Strona renderu: lustra rakiet (obiekt na indeks puli — reżyser trzyma stan efektów po obiekcie). */
export function applyRocketBlock(blk, dict, mirror, entityAt, defOf) {
  const D = blk.f64;
  const cap = D[H.CAP] | 0;
  const n = D[H.N] | 0;
  const pool = mirror.pool;
  for (let i = pool.length; i < cap; i++) {
    pool.push({ active: false, index: i, position: vec(), velocity: vec(), frameVel: vec(), visualDir: vec(),
      state: undefined, mode: undefined, guidancePhase: undefined, weaponDef: null, shooter: null, target: null,
      bodyScale: 1, currentThrust: 0, maxThrust: 0, nosePitch: 0, timeSinceLaunch: 0 });
  }
  for (let i = 0; i < pool.length; i++) pool[i].active = false;
  for (let k = 0; k < n; k++) {
    const o = H.STRIDE + k * F.STRIDE;
    const r = pool[D[o + F.IDX] | 0];
    if (!r) continue;
    r.active = true;
    r.state = dict.value(D[o + F.STATE]); r.mode = dict.value(D[o + F.MODE]); r.guidancePhase = dict.value(D[o + F.PHASE]);
    r.weaponDef = defOf(dict.value(D[o + F.WEAPON])) || null;
    r.shooter = D[o + F.SHOOTER_S] >= 0 ? entityAt(D[o + F.SHOOTER_S], D[o + F.SHOOTER_G]) : null;
    r.target = D[o + F.TARGET_S] >= 0 ? entityAt(D[o + F.TARGET_S], D[o + F.TARGET_G]) : null;
    r.bodyScale = D[o + F.BODY]; r.currentThrust = D[o + F.THRUST]; r.maxThrust = D[o + F.MAX_THRUST];
    r.nosePitch = D[o + F.PITCH]; r.timeSinceLaunch = D[o + F.AGE];
    const p = r.position, v = r.velocity, fv = r.frameVel, d = r.visualDir;
    p.x = D[o + F.PX]; p.y = D[o + F.PY]; p.z = D[o + F.PZ];
    v.x = D[o + F.VX]; v.y = D[o + F.VY]; v.z = D[o + F.VZ];
    fv.x = D[o + F.FVX]; fv.y = D[o + F.FVY]; fv.z = D[o + F.FVZ];
    d.x = D[o + F.DX]; d.y = D[o + F.DY]; d.z = D[o + F.DZ];
  }
  return mirror;
}
