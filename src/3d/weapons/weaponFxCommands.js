// src/3d/weapons/weaponFxCommands.js — dekoder rekordów broni strumienia rozkazów (RW-21, docs/PLAN-render-worker.md
// § 3.3): rekord (src/render/renderCommands.js) → wywołanie WeaponFx z tymi samymi liczbami. Encje i pociski
// z (slot, gen) przez czytelnika (inline: obiekty gry; worker: lustra migawki), napisy z tablicy czytelnika, nośnik —
// blok ActiveCarrier (zdarzenia, przy których nośnik ustawia gra) albo obiekt nośnika (argument wywołania).
// Stan, który dawniej wisiał na obiektach gry: ładowanie działa (`st.fx`) — tutaj po kluczu działa; uchwyt smugi
// Hexlance'a (`proj.slug`) — tutaj po id gry.

import { ActiveCarrier } from '../../game/carrierVelocity.js';
import { WeaponFx } from './weaponFx.js';
import {
  RC, SHOT, SHOT_KIND, BULLET, IMPACT, KERF, PIERCE, FLAK, BLAST, CHARGE, PD_LASER, HEX, HEX_HIT_KIND, MUZZLE_WORDS
} from '../../render/renderCommands.js';

// Widoki wielokrotnego użytku (WeaponFx czyta je w trakcie wywołania i nie zatrzymuje).
const _detail = { weaponId: null, shooter: null, x: 0, y: 0, isBeam: false, beamMode: null, beam: null, dirX: 0, dirY: 0 };
const _beam = { kind: undefined, mode: undefined, startX: 0, startY: 0, endX: 0, endY: 0, width: 0, hitEntity: null, nx: 0, ny: 0, emitterUid: undefined };
const _shot = { x: 0, y: 0, angle: 0, scale: 1, shake: 0, entity: null };
const _bullet = { vfxKey: undefined, type: undefined, vx: 0, vy: 0, ivx: 0, ivy: 0, z: 0, owner: undefined, weaponSize: undefined, flakBurstRadius: 0, __ref: null };
const _hit = { nx: 0, ny: 0, relVx: 0, relVy: 0, entity: null, kind: undefined, through: false, ric: false, ricDirX: 0, ricDirY: 0, ricSpeed: 0, ricLife: 0 };
const _carrier = { vx: 0, vy: 0, t0: 0, z: 0, clock: 0 };

// Stan ładowania: klucz działa (slot) → { gen, state }; uchwyty smug Hexlance'a: id gry → uchwyt WeaponFx.
const _charge = [];
const _hex = new Map();

function readCarrier(d, o) {
  _carrier.vx = d[o]; _carrier.vy = d[o + 1]; _carrier.t0 = d[o + 2]; _carrier.z = d[o + 3]; _carrier.clock = d[o + 4];
  return _carrier;
}

// Lufa rozwiązana w grze: null — strzelec bez wieżyczki (efekt z punktu i kierunku strzału).
function readMuzzle(r, d, o) {
  if (!d[o]) return null;
  _shot.x = d[o + 1]; _shot.y = d[o + 2]; _shot.angle = d[o + 3]; _shot.scale = d[o + 4]; _shot.shake = d[o + 5];
  _shot.entity = r.ent(d, o + 6);
  return _shot;
}

function readBullet(r, d, o) {
  const b = _bullet;
  b.__ref = r.shot(d, o + BULLET.SHOT);
  b.vfxKey = r.str(d[o + BULLET.VFX_KEY]);
  b.type = r.str(d[o + BULLET.TYPE]);
  b.vx = d[o + BULLET.VX]; b.vy = d[o + BULLET.VY];
  b.ivx = d[o + BULLET.IVX]; b.ivy = d[o + BULLET.IVY];
  b.z = d[o + BULLET.Z];
  b.owner = r.str(d[o + BULLET.OWNER]);
  b.weaponSize = r.str(d[o + BULLET.SIZE]);
  b.flakBurstRadius = d[o + BULLET.FLAK_R];
  return b;
}

function onShot(r, d, o) {
  const S = SHOT;
  const pre = readMuzzle(r, d, o + S.MUZZLE);
  const shooter = r.ent(d, o + S.SHOOTER);
  const weaponId = r.str(d[o + S.WEAPON]);
  if (d[o + S.KIND] === SHOT_KIND.PD) {
    WeaponFx.pdShot(weaponId, d[o + S.X], d[o + S.Y], d[o + S.DIR_X], shooter, pre);
    _shot.entity = null;
    return;
  }
  const det = _detail;
  det.weaponId = weaponId;
  det.shooter = shooter;
  det.x = d[o + S.X]; det.y = d[o + S.Y];
  det.isBeam = d[o + S.IS_BEAM] === 1;
  det.beamMode = r.str(d[o + S.BEAM_MODE]);
  det.dirX = d[o + S.DIR_X]; det.dirY = d[o + S.DIR_Y];
  if (d[o + S.HAS_BEAM]) {
    const b = _beam;
    b.kind = r.str(d[o + S.B_KIND]); b.mode = r.str(d[o + S.B_MODE]); b.emitterUid = r.str(d[o + S.B_UID]);
    b.startX = d[o + S.B_SX]; b.startY = d[o + S.B_SY]; b.endX = d[o + S.B_EX]; b.endY = d[o + S.B_EY];
    b.width = d[o + S.B_WIDTH];
    b.hitEntity = r.ent(d, o + S.B_HIT);
    b.nx = d[o + S.B_NX]; b.ny = d[o + S.B_NY];
    det.beam = b;
  } else {
    det.beam = null;
  }
  try {
    WeaponFx._onShot(det, pre);
  } finally {
    det.shooter = null; det.beam = null; _beam.hitEntity = null; _shot.entity = null;
  }
}

function onPdLaser(r, d, o) {
  const P = PD_LASER;
  const pre = readMuzzle(r, d, o + P.MUZZLE);
  WeaponFx.pdLaser(r.str(d[o + P.WEAPON]), d[o + P.X0], d[o + P.Y0], d[o + P.X1], d[o + P.Y1],
    r.ent(d, o + P.SHOOTER), r.ent(d, o + P.TARGET), pre);
  _shot.entity = null;
}

function onImpact(r, d, o) {
  const I = IMPACT;
  const b = readBullet(r, d, o);
  let hit = null;
  if (d[o + I.HAS_HIT]) {
    hit = _hit;
    hit.nx = d[o + I.H_NX]; hit.ny = d[o + I.H_NY]; hit.relVx = d[o + I.H_RVX]; hit.relVy = d[o + I.H_RVY];
    hit.entity = r.ent(d, o + I.H_ENT);
    hit.kind = r.str(d[o + I.H_KIND]);
    hit.through = d[o + I.H_THROUGH] === 1;
    hit.ric = d[o + I.H_RIC] === 1;
    hit.ricDirX = d[o + I.H_RDX]; hit.ricDirY = d[o + I.H_RDY]; hit.ricSpeed = d[o + I.H_RSPEED]; hit.ricLife = d[o + I.H_RLIFE];
  }
  ActiveCarrier.set(readCarrier(d, o + I.CARRIER));
  try {
    WeaponFx.impact(b, d[o + I.X], d[o + I.Y], d[o + I.SCALE], hit);
  } finally {
    b.__ref = null; _hit.entity = null;
  }
}

function onKerf(r, d, o) {
  const K = KERF;
  const b = readBullet(r, d, o);
  ActiveCarrier.set(readCarrier(d, o + K.CARRIER));
  try {
    WeaponFx.kerf(b, d[o + K.X], d[o + K.Y], d[o + K.DX], d[o + K.DY], d[o + K.COUNT], d[o + K.RVX], d[o + K.RVY], r.ent(d, o + K.HULL));
  } finally {
    b.__ref = null;
  }
}

function onPierce(r, d, o) {
  const P = PIERCE;
  const b = readBullet(r, d, o);
  ActiveCarrier.set(readCarrier(d, o + P.CARRIER));
  const hull = r.ent(d, o + P.HULL);
  try {
    if (d[o + P.STUCK]) WeaponFx.pierceStuck(b, d[o + P.X], d[o + P.Y], d[o + P.RVX], d[o + P.RVY], hull);
    else WeaponFx.pierceExit(b, d[o + P.X], d[o + P.Y], d[o + P.RVX], d[o + P.RVY], hull);
  } finally {
    b.__ref = null;
  }
}

function onFlak(r, d, o) {
  const F = FLAK;
  const b = d[o + F.HAS_BULLET] ? readBullet(r, d, o + F.BULLET) : null;
  ActiveCarrier.set(readCarrier(d, o + F.CARRIER));
  try {
    WeaponFx.flakBurst(b, d[o + F.X], d[o + F.Y], d[o + F.R]);
  } finally {
    if (b) b.__ref = null;
  }
}

function onBlast(type) {
  return (r, d, o) => {
    const B = BLAST;
    ActiveCarrier.set(readCarrier(d, o + B.CARRIER));
    if (type === RC.DRONE_BLAST) WeaponFx.droneBlast(d[o + B.X], d[o + B.Y], d[o + B.SIZE]);
    else if (type === RC.BOMB_BLAST) WeaponFx.bombBlast(d[o + B.X], d[o + B.Y], d[o + B.SIZE], r.ent(d, o + B.HULL));
    else WeaponFx.bombDud(d[o + B.X], d[o + B.Y], d[o + B.SIZE]);
  };
}

function onCharge(r, d, o) {
  const C = CHARGE;
  const slot = d[o + C.KEY];
  const gen = d[o + C.KEY + 1];
  let e = slot >= 0 ? _charge[slot] : null;
  if (slot >= 0 && (!e || e.gen !== gen)) e = _charge[slot] = { gen, state: WeaponFx.createChargeState() };
  WeaponFx.charge(r.str(d[o + C.WEAPON]), d[o + C.X], d[o + C.Y], d[o + C.ANGLE], d[o + C.SCALE], d[o + C.U], d[o + C.DT],
    e ? e.state : null, d[o + C.HAS_CARRIER] ? readCarrier(d, o + C.CARRIER) : null);
}

function onHexCharge(r, d, o) {
  WeaponFx.hexlanceCharge(d[o + HEX.C_X], d[o + HEX.C_Y], d[o + HEX.C_DX], d[o + HEX.C_DY], d[o + HEX.C_DT], d[o + HEX.C_U],
    d[o + HEX.C_HAS] ? readCarrier(d, o + HEX.C_CARRIER) : null, d[o + HEX.C_INDEX]);
}

function onHexFire(r, d, o) {
  WeaponFx.hexlanceFire(d[o + HEX.F_X], d[o + HEX.F_Y], d[o + HEX.F_DX], d[o + HEX.F_DY],
    d[o + HEX.F_HAS] ? readCarrier(d, o + HEX.F_CARRIER) : null);
}

function onHexBegin(r, d, o) {
  const h = WeaponFx.hexlanceBegin(d[o + HEX.B_X], d[o + HEX.B_Y], d[o + HEX.B_VX], d[o + HEX.B_VY], d[o + HEX.B_IVX], d[o + HEX.B_IVY]);
  if (h) _hex.set(d[o + HEX.B_ID], h);
}

function onHexStep(r, d, o) {
  const h = _hex.get(d[o + HEX.S_ID]);
  if (h) WeaponFx.hexlanceStep(h, d[o + HEX.S_X0], d[o + HEX.S_Y0], d[o + HEX.S_X1], d[o + HEX.S_Y1], d[o + HEX.S_VX], d[o + HEX.S_VY]);
}

function onHexEnd(r, d, o) {
  const id = d[o + HEX.E_ID];
  const h = _hex.get(id);
  if (h) WeaponFx.hexlanceEnd(h, d[o + HEX.E_X], d[o + HEX.E_Y]);
  _hex.delete(id);
}

function onHexHit(r, d, o) {
  const c = d[o + HEX.H_HAS] ? readCarrier(d, o + HEX.H_CARRIER) : null;
  const kind = d[o + HEX.H_KIND];
  const x = d[o + HEX.H_X], y = d[o + HEX.H_Y], vx = d[o + HEX.H_RVX], vy = d[o + HEX.H_RVY];
  if (kind === HEX_HIT_KIND.IMPACT) WeaponFx.hexlanceImpact(x, y, vx, vy, c, d[o + HEX.H_POWER], d[o + HEX.H_SHAKE] === 1);
  else if (kind === HEX_HIT_KIND.KERF) WeaponFx.hexlanceKerf(x, y, vx, vy, c, d[o + HEX.H_POWER]);
  else WeaponFx.hexlanceExit(x, y, vx, vy, c);
}

/** Obsługa rekordów broni w czytelniku strumienia rozkazów; WeaponFx przestaje słuchać szyny strzałów. */
export function installWeaponFxCommands(reader) {
  if (!reader) return false;
  reader.on(RC.SHOT, onShot);
  reader.on(RC.PD_LASER, onPdLaser);
  reader.on(RC.IMPACT, onImpact);
  reader.on(RC.KERF, onKerf);
  reader.on(RC.PIERCE, onPierce);
  reader.on(RC.FLAK_BURST, onFlak);
  reader.on(RC.DRONE_BLAST, onBlast(RC.DRONE_BLAST));
  reader.on(RC.BOMB_BLAST, onBlast(RC.BOMB_BLAST));
  reader.on(RC.BOMB_DUD, onBlast(RC.BOMB_DUD));
  reader.on(RC.CHARGE, onCharge);
  reader.on(RC.HEX_CHARGE, onHexCharge);
  reader.on(RC.HEX_FIRE, onHexFire);
  reader.on(RC.HEX_BEGIN, onHexBegin);
  reader.on(RC.HEX_STEP, onHexStep);
  reader.on(RC.HEX_END, onHexEnd);
  reader.on(RC.HEX_HIT, onHexHit);
  WeaponFx.useCommands(true);
  return true;
}

/** Stan dekodera (testy, konsola). */
export const WeaponFxCommandState = { charge: _charge, hex: _hex, MUZZLE_WORDS };
