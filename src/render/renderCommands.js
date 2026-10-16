// src/render/renderCommands.js — strumień rozkazów renderu (RW-21, docs/PLAN-render-worker.md § 3.3).
//
// Gra (wątek główny) zapisuje ZDARZENIA dla renderu do pierścienia rekordów (src/render/eventRing.js): każdy rekord
// niesie liczby (f64 — wartości bit w bit) i odwołania bez referencji: encja / pocisk = (slot, generacja) z przestrzeni
// slotów (src/render/renderIds.js), napis = id z tablicy napisów (rekord STR przy pierwszym użyciu), nośnik efektu =
// skopiowany blok `ActiveCarrier` albo nośnik argumentu (vx, vy, t0, z, zegar). Render (dyspozytor) czyta rekordy
// i woła swoje moduły (dziś: efekty broni — src/3d/weapons/weaponFxCommands.js).
//
// Tryby: `inline` (jeden wątek): rekord jest dyspozytowany ZARAZ po zatwierdzeniu — efekt powstaje w tej samej
// chwili co dawne wywołanie wprost (obraz bit w bit), a przy tym każdy rekord przechodzi przez kodowanie i dekodowanie.
// `worker` (RW-40+): czytelnik w workerze odtwarza rekordy z klatkami ≤ k przed renderem migawki k.
//
// Rekordy broni (katalog § 3.3): SHOT (strzał z szyny i PD gracza; lufa ROZWIĄZANA w grze — Turret2D.shotMuzzle),
// IMPACT, KERF, PIERCE, FLAK_BURST, DRONE_BLAST, BOMB_BLAST / BOMB_DUD, CHARGE (stan ładowania po kluczu działa),
// PD_LASER, HEX_CHARGE / HEX_FIRE / HEX_BEGIN / HEX_STEP / HEX_END / HEX_HIT (Hexlance: uchwyt pocisku = id gry).
//
// Czysty moduł gry / wspólny (bez three i DOM; `window` tylko do rejestracji w konsoli).

import { EventRingReader, EventRingWriter, createEventRingBuffer } from './eventRing.js';
import { createRenderIds, RenderIdSpace } from './renderIds.js';
import { RenderSlots } from './renderSlots.js';
import { ActiveCarrier } from '../game/carrierVelocity.js';
import { CLOCK_RENDER, CLOCK_SIM } from '../game/simClock.js';
import { Turret2D, normalizeWeaponFxKey } from '../vfx/turret2D.js';
import { MASTER_WEAPONS } from '../data/weapons.js';

/** Kody typów rekordów (1…65535; 0 = PAD pierścienia). */
export const RC = Object.freeze({
  STR: 1,          // definicja napisu: [id, długość, …kody znaków]
  SHOT: 2,
  IMPACT: 3,
  KERF: 4,
  PIERCE: 5,
  FLAK_BURST: 6,
  DRONE_BLAST: 7,
  BOMB_BLAST: 8,
  BOMB_DUD: 9,
  CHARGE: 10,
  PD_LASER: 11,
  HEX_CHARGE: 12,
  HEX_FIRE: 13,
  HEX_BEGIN: 14,
  HEX_STEP: 15,
  HEX_END: 16,
  HEX_HIT: 17,
  // Zakresy torów (równoległe tory nie mogą zderzyć się kodami): 1–31 broń (rw-bronie; wolne od 18), 32–63 kadłuby /
  // rany / wybuchy / iskry / odłamki / reaktor / stacje (rw-kadluby — `HC` w src/render/hullCommands.js), 64–73 rakiety
  // (RW-23), 74–127 świat (rw-swiat).
  RKT_BEGIN: 64,     // początek kroku lotu: liczba rakiet w locie i w kolejkach
  RKT_LAUNCH: 65,    // wyrzut: slot rakiety, motyw barw
  RKT_IGNITE: 66,    // zapłon
  RKT_FLY: 67,       // krok lotu rakiety (dt) — w kolejności lotu, jak dawne wywołania reżysera
  RKT_SPLIT: 68,     // podział nosiciela (Hydra)
  RKT_INTERCEPT: 69, // zestrzelenie (obrona punktowa)
  RKT_CONTACT: 70,   // punkt i odcinek styku przed wybuchem
  RKT_DETONATE: 71,  // wybuch: punkt, trafiona encja, tarcza
  RKT_UPDATE: 72,    // koniec kroku lotu (klatka reżysera)
  RKT_WAKE: 73,      // kilwater torpedy (pocisk kanwy / WeaponFx — slot pocisku)
  // Warp „Nurt” (RW-28, rw-swiat): rekord ruchu warpa = slot puli rejestru gry (src/game/warpTraffic.js — `rec.id`;
  // w trybie worker — lustro bloku WARP migawki); stan osi (czasy, droga, wymiary) render czyta z rekordu w puli.
  WARP_BEGIN: 74,    // nowy przylot / odlot: slot, rodzaj, encja (slot, gen)
  WARP_ATTACH: 75,   // podpięcie okrętu do zaplanowanego przylotu: slot, encja
  WARP_END: 76,      // koniec rekordu: slot
  WARP_CLEAR: 77     // wszystkie rekordy do zera (nowa gra, teleport w harnessie)
});

/** Rodzaje rekordu SHOT i HEX_HIT. */
export const SHOT_KIND = Object.freeze({ BUS: 0, PD: 1 });
export const HEX_HIT_KIND = Object.freeze({ IMPACT: 0, KERF: 1, EXIT: 2 });

// Napisy: −1 = undefined, −2 = null, ≥ 0 — id z tablicy.
export const STR_UNDEFINED = -1;
export const STR_NULL = -2;

/** Słowa bloków. */
export const CARRIER_WORDS = 5;           // vx, vy, t0, z, zegar
export const ENT_WORDS = 2;               // slot (−1 = brak), generacja
export const MUZZLE_WORDS = 6 + ENT_WORDS; // znaleziona (0/1), x, y, kąt, skala, wstrząs, encja (slot, gen)

// Układ rekordów (przesunięcia w ładunku). Ten sam obiekt czyta dekoder (weaponFxCommands.js).
export const SHOT = Object.freeze({
  KIND: 0, WEAPON: 1, SHOOTER: 2, X: 4, Y: 5, IS_BEAM: 6, BEAM_MODE: 7, DIR_X: 8, DIR_Y: 9,
  HAS_BEAM: 10, B_KIND: 11, B_MODE: 12, B_SX: 13, B_SY: 14, B_EX: 15, B_EY: 16, B_WIDTH: 17, B_HIT: 18,
  B_NX: 20, B_NY: 21, B_UID: 22, MUZZLE: 23, WORDS: 23 + MUZZLE_WORDS
});
// Pocisk w rekordzie (pola, które receptury czytają przy zdarzeniu) — blok BULLET.
export const BULLET = Object.freeze({
  SHOT: 0, VFX_KEY: 2, TYPE: 3, VX: 4, VY: 5, IVX: 6, IVY: 7, Z: 8, OWNER: 9, SIZE: 10, FLAK_R: 11, WORDS: 12
});
export const IMPACT = Object.freeze({
  BULLET: 0, X: BULLET.WORDS, Y: BULLET.WORDS + 1, SCALE: BULLET.WORDS + 2, HAS_HIT: BULLET.WORDS + 3,
  H_NX: BULLET.WORDS + 4, H_NY: BULLET.WORDS + 5, H_RVX: BULLET.WORDS + 6, H_RVY: BULLET.WORDS + 7,
  H_ENT: BULLET.WORDS + 8, H_KIND: BULLET.WORDS + 10, H_THROUGH: BULLET.WORDS + 11, H_RIC: BULLET.WORDS + 12,
  H_RDX: BULLET.WORDS + 13, H_RDY: BULLET.WORDS + 14, H_RSPEED: BULLET.WORDS + 15, H_RLIFE: BULLET.WORDS + 16,
  CARRIER: BULLET.WORDS + 17, WORDS: BULLET.WORDS + 17 + CARRIER_WORDS
});
export const KERF = Object.freeze({
  BULLET: 0, X: BULLET.WORDS, Y: BULLET.WORDS + 1, DX: BULLET.WORDS + 2, DY: BULLET.WORDS + 3, COUNT: BULLET.WORDS + 4,
  RVX: BULLET.WORDS + 5, RVY: BULLET.WORDS + 6, HULL: BULLET.WORDS + 7, CARRIER: BULLET.WORDS + 9,
  WORDS: BULLET.WORDS + 9 + CARRIER_WORDS
});
export const PIERCE = Object.freeze({
  BULLET: 0, X: BULLET.WORDS, Y: BULLET.WORDS + 1, RVX: BULLET.WORDS + 2, RVY: BULLET.WORDS + 3, HULL: BULLET.WORDS + 4,
  STUCK: BULLET.WORDS + 6, CARRIER: BULLET.WORDS + 7, WORDS: BULLET.WORDS + 7 + CARRIER_WORDS
});
export const FLAK = Object.freeze({
  HAS_BULLET: 0, BULLET: 1, X: 1 + BULLET.WORDS, Y: 2 + BULLET.WORDS, R: 3 + BULLET.WORDS, CARRIER: 4 + BULLET.WORDS,
  WORDS: 4 + BULLET.WORDS + CARRIER_WORDS
});
export const BLAST = Object.freeze({ X: 0, Y: 1, SIZE: 2, HULL: 3, CARRIER: 5, WORDS: 5 + CARRIER_WORDS });
export const CHARGE = Object.freeze({
  WEAPON: 0, X: 1, Y: 2, ANGLE: 3, SCALE: 4, U: 5, DT: 6, KEY: 7, HAS_CARRIER: 9, CARRIER: 10, WORDS: 10 + CARRIER_WORDS
});
export const PD_LASER = Object.freeze({
  WEAPON: 0, X0: 1, Y0: 2, X1: 3, Y1: 4, SHOOTER: 5, TARGET: 7, MUZZLE: 9, WORDS: 9 + MUZZLE_WORDS
});
export const HEX = Object.freeze({
  // HEX_CHARGE: x, y, dirX, dirY, dt, u, index, nośnik
  C_X: 0, C_Y: 1, C_DX: 2, C_DY: 3, C_DT: 4, C_U: 5, C_INDEX: 6, C_HAS: 7, C_CARRIER: 8, C_WORDS: 8 + CARRIER_WORDS,
  // HEX_FIRE: x, y, dirX, dirY, nośnik
  F_X: 0, F_Y: 1, F_DX: 2, F_DY: 3, F_HAS: 4, F_CARRIER: 5, F_WORDS: 5 + CARRIER_WORDS,
  // HEX_BEGIN: id, x, y, vx, vy, ivx, ivy
  B_ID: 0, B_X: 1, B_Y: 2, B_VX: 3, B_VY: 4, B_IVX: 5, B_IVY: 6, B_WORDS: 7,
  // HEX_STEP: id, x0, y0, x1, y1, vx, vy
  S_ID: 0, S_X0: 1, S_Y0: 2, S_X1: 3, S_Y1: 4, S_VX: 5, S_VY: 6, S_WORDS: 7,
  // HEX_END: id, x, y
  E_ID: 0, E_X: 1, E_Y: 2, E_WORDS: 3,
  // HEX_HIT: rodzaj, x, y, relVx, relVy, moc, wstrząs, nośnik
  H_KIND: 0, H_X: 1, H_Y: 2, H_RVX: 3, H_RVY: 4, H_POWER: 5, H_SHAKE: 6, H_HAS: 7, H_CARRIER: 8, H_WORDS: 8 + CARRIER_WORDS
});


// ---------------------------------------------------------------------------
// Pisarz (gra)
// ---------------------------------------------------------------------------

export class RenderCommandWriter {
  /**
   * @param {{ capacity?: number, shared?: boolean, ids?: object, onGrow?: Function }} [o] — ids: przestrzenie slotów
   *   (createRenderIds; w trybie z migawką — te same co migawka), onGrow(nowyBufor) — przejście na większy pierścień.
   */
  constructor({ capacity = 4096, shared = false, ids = null, onGrow = null } = {}) {
    this.buffer = createEventRingBuffer(capacity, { shared });
    this.ring = new EventRingWriter(this.buffer, { shared, onGrow: (b) => { this.buffer = b; if (this.onGrow) this.onGrow(b); } });
    this.onGrow = onGrow;
    this.ids = ids || createRenderIds();
    // Cudze sloty (gra: RenderSlots — wspólne z migawką i kanałem zwrotnym, src/render/renderSlots.js) mają jeden cykl
    // mark & sweep na klatkę w pętli gry; pisarz robi go sam tylko na własnych (testy, dema).
    this.ownsIds = !ids;
    // Klucze stanu ładowania (stan efektu na dziale): obiekt stanu gry → slot; długie trzymanie (przerwy między
    // ładowaniami — stan łuków przeżywa je jak dawniej na obiekcie gry).
    this.chargeKeys = new RenderIdSpace('charge', { capacity: 16, retain: 3600 });
    this.frame = 0;
    this.records = 0;
    // Ułamek wstrząsu strzału (kierowanie ogniem gracza ścisza wieże na auto — index.html ustawia go wokół
    // fireWeaponCore; dawniej WeaponFx.shotShakeScale pisany z gry) — mnoży wstrząs w haku onShotFeel.
    this.shotShakeScale = 1;
    // Hak gry na strzał z wieżyczki (RW-30): (kadłub z wieżyczką, kierunek lufy x, y, wstrząs × ułamek, przeładowanie [s])
    // — wstrząs strzałów i kopnięcie kadru liczy gra (src/game/cameraShakes.js), nie efekt wylotu. null — bez.
    this.onShotFeel = null;
    this._strIds = new Map();
    this._strNext = 0;
    this._hexNext = 1;
    this._sink = null;       // dyspozytor `inline` (funkcja bez argumentów — dopija pierścień)
    this._beginIds();
  }

  _beginIds() {
    const s = this.ids;
    if (this.ownsIds) {
      if (s.entities) s.entities.begin();
      if (s.shots) s.shots.begin();
    }
    this.chargeKeys.begin();
  }

  /** Koniec klatki renderu: zwolnienie slotów bez odwołań (własne przestrzenie i klucze ładowania), numer klatki + 1. */
  endFrame() {
    const s = this.ids;
    if (this.ownsIds) {
      if (s.entities) s.entities.end();
      if (s.shots) s.shots.end();
    }
    this.chargeKeys.end();
    this.frame++;
    this._beginIds();
  }

  /** Dyspozytor `inline`: wołany po każdym zatwierdzonym rekordzie (dopija pierścień). null — bez (worker / testy). */
  setInlineSink(fn) {
    this._sink = typeof fn === 'function' ? fn : null;
  }

  // Napis → id (rekord STR przy pierwszym użyciu). Wołać PRZED begin() rekordu, który go niesie.
  str(v) {
    if (v === undefined) return STR_UNDEFINED;
    if (v === null) return STR_NULL;
    const s = typeof v === 'string' ? v : String(v);
    let id = this._strIds.get(s);
    if (id !== undefined) return id;
    id = this._strNext++;
    this._strIds.set(s, id);
    const n = s.length;
    const o = this.ring.begin(RC.STR, this.frame, 2 + n);
    const d = this.ring.data;
    d[o] = id;
    d[o + 1] = n;
    for (let i = 0; i < n; i++) d[o + 2 + i] = s.charCodeAt(i);
    this._commit();
    return id;
  }

  _begin(type, words) {
    return this.ring.begin(type, this.frame, words);
  }

  _commit() {
    this.ring.commit();
    this.records++;
    if (this._sink !== null) this._sink();
  }

  _ent(d, o, e, space = this.ids.entities) {
    if (!e || typeof e !== 'object') { d[o] = -1; d[o + 1] = 0; return; }
    const slot = space.slotOf(e);
    d[o] = slot;
    d[o + 1] = space.gen(slot);
  }

  _activeCarrier(d, o) {
    d[o] = ActiveCarrier.vx;
    d[o + 1] = ActiveCarrier.vy;
    d[o + 2] = ActiveCarrier.t0;
    d[o + 3] = ActiveCarrier.z;
    d[o + 4] = ActiveCarrier.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  }

  // Nośnik z argumentu (obiekt z vx, vy, t0, z, clock) — jak ActiveCarrier.set: wartości przepuszczone przez finite.
  _carrierArg(d, o, c) {
    d[o] = c.vx; d[o + 1] = c.vy; d[o + 2] = c.t0; d[o + 3] = c.z;
    d[o + 4] = c.clock === CLOCK_RENDER ? CLOCK_RENDER : CLOCK_SIM;
  }

  // Lufa rozwiązana w grze (Turret2D.shotMuzzle — bez odrzutu): ta sama, którą dawniej brał efekt wylotu.
  // feel — strzał z efektem wylotu (bez wiązki ciągłej): wstrząs strzałów i kopnięcie kadru (hak onShotFeel).
  _muzzle(d, o, weaponId, x, y, shooter, feel = false) {
    const shot = Turret2D.shotMuzzle(normalizeWeaponFxKey(weaponId), x, y, shooter || null);
    if (!shot) {
      d[o] = 0; d[o + 1] = d[o + 2] = d[o + 3] = d[o + 4] = d[o + 5] = 0; d[o + 6] = -1; d[o + 7] = 0;
      return;
    }
    d[o] = 1;
    d[o + 1] = shot.x; d[o + 2] = shot.y; d[o + 3] = shot.angle; d[o + 4] = shot.scale; d[o + 5] = shot.shake;
    this._ent(d, o + 6, shot.entity);
    if (feel && this.onShotFeel !== null) {
      const gunner = shot.entity || shooter || null;
      this.onShotFeel(gunner, Math.cos(shot.angle), Math.sin(shot.angle), (Number(shot.shake) || 0) * this.shotShakeScale,
        Number(MASTER_WEAPONS[weaponId]?.cooldown) || 1);
    }
    shot.entity = null;
  }

  _bullet(d, o, b, ids) {
    this._ent(d, o + BULLET.SHOT, b, this.ids.shots);
    d[o + BULLET.VFX_KEY] = ids[0];
    d[o + BULLET.TYPE] = ids[1];
    d[o + BULLET.VX] = Number(b.vx); d[o + BULLET.VY] = Number(b.vy);
    d[o + BULLET.IVX] = Number(b.ivx); d[o + BULLET.IVY] = Number(b.ivy);
    d[o + BULLET.Z] = Number(b.z);
    d[o + BULLET.OWNER] = ids[2];
    d[o + BULLET.SIZE] = ids[3];
    d[o + BULLET.FLAK_R] = Number(b.flakBurstRadius);
  }

  // Napisy pocisku (przed begin): vfxKey, type, owner, weaponSize.
  _bulletStrs(b, out) {
    out[0] = this.str(b.vfxKey); out[1] = this.str(b.type); out[2] = this.str(b.owner); out[3] = this.str(b.weaponSize);
    return out;
  }

  // ---- rekordy broni -------------------------------------------------------

  /** Strzał z szyny (WeaponShotBus detail): broń, strzelec, wylot, wiązka; lufa rozwiązana tutaj. */
  shot(detail) {
    if (!detail) return;
    const S = SHOT;
    const beam = detail.beam || null;
    const wid = this.str(detail.weaponId);
    const bmode = this.str(detail.beamMode);
    let bk = STR_UNDEFINED, bm = STR_UNDEFINED, buid = STR_UNDEFINED;
    if (beam) { bk = this.str(beam.kind); bm = this.str(beam.mode); buid = this.str(beam.emitterUid); }
    const x = Number(detail.x); const y = Number(detail.y);
    const o = this._begin(RC.SHOT, S.WORDS);
    const d = this.ring.data;
    d[o + S.KIND] = SHOT_KIND.BUS;
    d[o + S.WEAPON] = wid;
    this._ent(d, o + S.SHOOTER, detail.shooter);
    d[o + S.X] = x; d[o + S.Y] = y;
    d[o + S.IS_BEAM] = detail.isBeam ? 1 : 0;
    d[o + S.BEAM_MODE] = bmode;
    d[o + S.DIR_X] = Number(detail.dirX); d[o + S.DIR_Y] = Number(detail.dirY);
    d[o + S.HAS_BEAM] = beam ? 1 : 0;
    d[o + S.B_KIND] = bk; d[o + S.B_MODE] = bm; d[o + S.B_UID] = buid;
    if (beam) {
      d[o + S.B_SX] = Number(beam.startX); d[o + S.B_SY] = Number(beam.startY);
      d[o + S.B_EX] = Number(beam.endX); d[o + S.B_EY] = Number(beam.endY);
      d[o + S.B_WIDTH] = Number(beam.width);
      this._ent(d, o + S.B_HIT, beam.hitEntity);
      d[o + S.B_NX] = Number(beam.nx); d[o + S.B_NY] = Number(beam.ny);
    } else {
      d[o + S.B_SX] = d[o + S.B_SY] = d[o + S.B_EX] = d[o + S.B_EY] = d[o + S.B_WIDTH] = 0;
      d[o + S.B_HIT] = -1; d[o + S.B_HIT + 1] = 0; d[o + S.B_NX] = d[o + S.B_NY] = 0;
    }
    // Wylot: impuls / PD — z początku wiązki, strzał — z punktu strzału (jak dawny efekt wylotu WeaponFx).
    const isBeam = !!(beam && detail.isBeam);
    const mx = isBeam ? Number(beam.startX) : x;
    const my = isBeam ? Number(beam.startY) : y;
    // Efekt wylotu (a z nim wstrząs i kopnięcie) — strzał i impuls / PD, nie wiązka ciągła (jak WeaponFx._onShot).
    const feel = !isBeam || (beam.kind || detail.beamMode || beam.mode) !== 'continuous';
    this._muzzle(d, o + S.MUZZLE, detail.weaponId, mx, my, detail.shooter, feel);
    this._commit();
  }

  /** Strzał obrony punktowej gracza (ciwsStep — spoza szyny): kierunek z kąta działka. */
  pdShot(weaponId, x, y, angle, shooter) {
    const S = SHOT;
    const wid = this.str(weaponId);
    const o = this._begin(RC.SHOT, S.WORDS);
    const d = this.ring.data;
    for (let i = 0; i < S.WORDS; i++) d[o + i] = 0;
    d[o + S.KIND] = SHOT_KIND.PD;
    d[o + S.WEAPON] = wid;
    this._ent(d, o + S.SHOOTER, shooter);
    d[o + S.X] = x; d[o + S.Y] = y;
    d[o + S.BEAM_MODE] = STR_NULL;
    // PD: w DIR_X kąt działka (WeaponFx.pdShot liczy kierunek z kąta), DIR_Y nieużywane.
    d[o + S.DIR_X] = angle;
    d[o + S.B_KIND] = d[o + S.B_MODE] = d[o + S.B_UID] = STR_UNDEFINED;
    d[o + S.B_HIT] = -1;
    this._muzzle(d, o + S.MUZZLE, weaponId, x, y, shooter, true);
    this._commit();
  }

  /** Laser PD gracza: impuls od (x0, y0) do (x1, y1), cel (null — rakieta); lufa rozwiązana tutaj. */
  pdLaser(weaponId, x0, y0, x1, y1, shooter, target) {
    const P = PD_LASER;
    const wid = this.str(weaponId);
    const o = this._begin(RC.PD_LASER, P.WORDS);
    const d = this.ring.data;
    d[o + P.WEAPON] = wid;
    d[o + P.X0] = x0; d[o + P.Y0] = y0; d[o + P.X1] = x1; d[o + P.Y1] = y1;
    this._ent(d, o + P.SHOOTER, shooter);
    this._ent(d, o + P.TARGET, target);
    this._muzzle(d, o + P.MUZZLE, weaponId, x0, y0, shooter, true);
    this._commit();
  }

  /** Trafienie pocisku `b` (spawnBulletImpactEffect — po bramkach gry); nośnik — bieżący ActiveCarrier. */
  impact(b, x, y, scale = 1, hit = null) {
    if (!b) return;
    const I = IMPACT;
    const ids = this._bulletStrs(b, _bs);
    const kind = hit ? this.str(hit.kind) : STR_UNDEFINED;
    const o = this._begin(RC.IMPACT, I.WORDS);
    const d = this.ring.data;
    this._bullet(d, o, b, ids);
    d[o + I.X] = x; d[o + I.Y] = y; d[o + I.SCALE] = scale;
    d[o + I.HAS_HIT] = hit ? 1 : 0;
    if (hit) {
      d[o + I.H_NX] = hit.nx; d[o + I.H_NY] = hit.ny; d[o + I.H_RVX] = hit.relVx; d[o + I.H_RVY] = hit.relVy;
      this._ent(d, o + I.H_ENT, hit.entity);
      d[o + I.H_KIND] = kind;
      d[o + I.H_THROUGH] = hit.through ? 1 : 0;
      d[o + I.H_RIC] = hit.ric ? 1 : 0;
      d[o + I.H_RDX] = hit.ricDirX; d[o + I.H_RDY] = hit.ricDirY; d[o + I.H_RSPEED] = hit.ricSpeed; d[o + I.H_RLIFE] = hit.ricLife;
    } else {
      for (let i = I.H_NX; i < I.CARRIER; i++) d[o + i] = 0;
      d[o + I.H_ENT] = -1; d[o + I.H_KIND] = STR_UNDEFINED;
    }
    this._activeCarrier(d, o + I.CARRIER);
    this._commit();
  }

  /** Znaki rzazu pocisku w materiale (applyBulletHullPass); nośnik — bieżący ActiveCarrier. */
  kerf(b, x, y, dx, dy, count, relVx, relVy, hull = null) {
    if (!b) return;
    const K = KERF;
    const ids = this._bulletStrs(b, _bs);
    const o = this._begin(RC.KERF, K.WORDS);
    const d = this.ring.data;
    this._bullet(d, o, b, ids);
    d[o + K.X] = x; d[o + K.Y] = y; d[o + K.DX] = dx; d[o + K.DY] = dy; d[o + K.COUNT] = count;
    d[o + K.RVX] = relVx; d[o + K.RVY] = relVy;
    this._ent(d, o + K.HULL, hull);
    this._activeCarrier(d, o + K.CARRIER);
    this._commit();
  }

  /** Wyjście pocisku z kadłuba (stuck = false) albo zakleszczenie (true); nośnik — bieżący ActiveCarrier. */
  pierce(b, x, y, relVx, relVy, hull, stuck) {
    if (!b) return;
    const P = PIERCE;
    const ids = this._bulletStrs(b, _bs);
    const o = this._begin(RC.PIERCE, P.WORDS);
    const d = this.ring.data;
    this._bullet(d, o, b, ids);
    d[o + P.X] = x; d[o + P.Y] = y; d[o + P.RVX] = relVx; d[o + P.RVY] = relVy;
    this._ent(d, o + P.HULL, hull);
    d[o + P.STUCK] = stuck ? 1 : 0;
    this._activeCarrier(d, o + P.CARRIER);
    this._commit();
  }

  pierceExit(b, x, y, relVx, relVy, hull = null) { this.pierce(b, x, y, relVx, relVy, hull, false); }
  pierceStuck(b, x, y, relVx, relVy, hull = null) { this.pierce(b, x, y, relVx, relVy, hull, true); }

  /** Pęknięcie pocisku flaku (detonateFlakShell); nośnik — bieżący ActiveCarrier. */
  flakBurst(b, x, y, radius) {
    const F = FLAK;
    const ids = b ? this._bulletStrs(b, _bs) : null;
    const o = this._begin(RC.FLAK_BURST, F.WORDS);
    const d = this.ring.data;
    d[o + F.HAS_BULLET] = b ? 1 : 0;
    if (b) this._bullet(d, o + F.BULLET, b, ids);
    else for (let i = 0; i < BULLET.WORDS; i++) d[o + F.BULLET + i] = 0;
    d[o + F.X] = x; d[o + F.Y] = y; d[o + F.R] = radius;
    this._activeCarrier(d, o + F.CARRIER);
    this._commit();
  }

  _blast(type, x, y, size, hull) {
    const B = BLAST;
    const o = this._begin(type, B.WORDS);
    const d = this.ring.data;
    d[o + B.X] = x; d[o + B.Y] = y; d[o + B.SIZE] = size;
    this._ent(d, o + B.HULL, hull);
    this._activeCarrier(d, o + B.CARRIER);
    this._commit();
  }

  /** Wybuch drona (śmierć myśliwca / platformy); nośnik — bieżący ActiveCarrier. */
  droneBlast(x, y, size = 42) { this._blast(RC.DRONE_BLAST, x, y, size, null); }
  /** Wybuch bomby lotniczej na kadłubie `hull`; nośnik — bieżący ActiveCarrier. */
  bombBlast(x, y, scale = 1, hull = null) { this._blast(RC.BOMB_BLAST, x, y, scale, hull); }
  /** Bomba bez poszycia pod sobą. */
  bombDud(x, y, scale = 1) { this._blast(RC.BOMB_DUD, x, y, scale, null); }

  /**
   * Ładowanie działa (Mjolnir, Valkyrie): `stateOwner` — obiekt gry, do którego należy stan efektu ładowania
   * (dawniej `st.fx` / `weapon.chargeFx`; teraz stan trzyma render po kluczu), carrier — nośnik (obiekt) albo null.
   */
  charge(weaponId, x, y, angle, scale, u, dt, stateOwner, carrier = null) {
    const C = CHARGE;
    const wid = this.str(weaponId);
    const o = this._begin(RC.CHARGE, C.WORDS);
    const d = this.ring.data;
    d[o + C.WEAPON] = wid;
    d[o + C.X] = x; d[o + C.Y] = y; d[o + C.ANGLE] = angle; d[o + C.SCALE] = scale; d[o + C.U] = u; d[o + C.DT] = dt;
    this._ent(d, o + C.KEY, stateOwner, this.chargeKeys);
    d[o + C.HAS_CARRIER] = carrier ? 1 : 0;
    if (carrier) this._carrierArg(d, o + C.CARRIER, carrier);
    else for (let i = 0; i < CARRIER_WORDS; i++) d[o + C.CARRIER + i] = 0;
    this._commit();
  }

  // ---- Hexlance (superweapon.js) ------------------------------------------

  hexlanceCharge(x, y, dirX, dirY, dt, u, carrier, index = 0) {
    const o = this._begin(RC.HEX_CHARGE, HEX.C_WORDS);
    const d = this.ring.data;
    d[o + HEX.C_X] = x; d[o + HEX.C_Y] = y; d[o + HEX.C_DX] = dirX; d[o + HEX.C_DY] = dirY;
    d[o + HEX.C_DT] = dt; d[o + HEX.C_U] = u; d[o + HEX.C_INDEX] = index;
    d[o + HEX.C_HAS] = carrier ? 1 : 0;
    if (carrier) this._carrierArg(d, o + HEX.C_CARRIER, carrier);
    else for (let i = 0; i < CARRIER_WORDS; i++) d[o + HEX.C_CARRIER + i] = 0;
    this._commit();
  }

  hexlanceFire(x, y, dirX, dirY, carrier) {
    const o = this._begin(RC.HEX_FIRE, HEX.F_WORDS);
    const d = this.ring.data;
    d[o + HEX.F_X] = x; d[o + HEX.F_Y] = y; d[o + HEX.F_DX] = dirX; d[o + HEX.F_DY] = dirY;
    d[o + HEX.F_HAS] = carrier ? 1 : 0;
    if (carrier) this._carrierArg(d, o + HEX.F_CARRIER, carrier);
    else for (let i = 0; i < CARRIER_WORDS; i++) d[o + HEX.F_CARRIER + i] = 0;
    this._commit();
  }

  /** Pocisk Hexlance'a: zwraca id uchwytu gry (render trzyma pod nim swój uchwyt smugi, albo nic). */
  hexlanceBegin(x, y, vx, vy, ivx = 0, ivy = 0) {
    const id = this._hexNext++;
    const o = this._begin(RC.HEX_BEGIN, HEX.B_WORDS);
    const d = this.ring.data;
    d[o + HEX.B_ID] = id;
    d[o + HEX.B_X] = x; d[o + HEX.B_Y] = y; d[o + HEX.B_VX] = vx; d[o + HEX.B_VY] = vy; d[o + HEX.B_IVX] = ivx; d[o + HEX.B_IVY] = ivy;
    this._commit();
    return id;
  }

  hexlanceStep(id, x0, y0, x1, y1, vx, vy) {
    if (!id) return;
    const o = this._begin(RC.HEX_STEP, HEX.S_WORDS);
    const d = this.ring.data;
    d[o + HEX.S_ID] = id;
    d[o + HEX.S_X0] = x0; d[o + HEX.S_Y0] = y0; d[o + HEX.S_X1] = x1; d[o + HEX.S_Y1] = y1; d[o + HEX.S_VX] = vx; d[o + HEX.S_VY] = vy;
    this._commit();
  }

  hexlanceEnd(id, x, y) {
    if (!id) return;
    const o = this._begin(RC.HEX_END, HEX.E_WORDS);
    const d = this.ring.data;
    d[o + HEX.E_ID] = id; d[o + HEX.E_X] = x; d[o + HEX.E_Y] = y;
    this._commit();
  }

  _hexHit(kind, x, y, relVx, relVy, carrier, power, shake) {
    const o = this._begin(RC.HEX_HIT, HEX.H_WORDS);
    const d = this.ring.data;
    d[o + HEX.H_KIND] = kind;
    d[o + HEX.H_X] = x; d[o + HEX.H_Y] = y; d[o + HEX.H_RVX] = relVx; d[o + HEX.H_RVY] = relVy;
    d[o + HEX.H_POWER] = power; d[o + HEX.H_SHAKE] = shake ? 1 : 0;
    d[o + HEX.H_HAS] = carrier ? 1 : 0;
    if (carrier) this._carrierArg(d, o + HEX.H_CARRIER, carrier);
    else for (let i = 0; i < CARRIER_WORDS; i++) d[o + HEX.H_CARRIER + i] = 0;
    this._commit();
  }

  hexlanceImpact(x, y, relVx, relVy, carrier = null, power = 1, shake = true) { this._hexHit(HEX_HIT_KIND.IMPACT, x, y, relVx, relVy, carrier, power, shake); }
  hexlanceKerf(x, y, relVx, relVy, carrier = null, power = 1) { this._hexHit(HEX_HIT_KIND.KERF, x, y, relVx, relVy, carrier, power, true); }
  hexlanceExit(x, y, relVx, relVy, carrier) { this._hexHit(HEX_HIT_KIND.EXIT, x, y, relVx, relVy, carrier, 1, true); }
}

const _bs = [0, 0, 0, 0];

// Rakiety (RW-23): rakieta = indeks w puli symulacji (src/game/rockets/rocketSim.js — `r.index`; w trybie worker —
// lustro bloku ROCKETS migawki), bez generacji (pula stała, zdarzenia rakiety idą w kolejności jej życia).
export const RKT = Object.freeze({
  SLOT: 0,
  L_COLOR: 1, L_WORDS: 2,
  F_DT: 1, F_WORDS: 2,
  I_X: 1, I_Y: 2, I_WORDS: 3,
  C_X0: 1, C_Y0: 2, C_X1: 3, C_Y1: 4, C_WORDS: 5,
  D_X: 1, D_Y: 2, D_HIT: 3, D_SHIELD: 5, D_WORDS: 6,
  W_SHOT: 0, W_DT: 2, W_WORDS: 3
});

// Warp (RW-28): slot rekordu w puli rejestru ruchu warpa gry (stała pula 24), rodzaj 0 = przylot, 1 = odlot.
export const WARP_KIND = Object.freeze({ ARRIVAL: 0, DEPARTURE: 1 });
export const WARP = Object.freeze({
  SLOT: 0,
  B_KIND: 1, B_ENT: 2, B_WORDS: 2 + ENT_WORDS,
  A_ENT: 1, A_WORDS: 1 + ENT_WORDS
});

Object.assign(RenderCommandWriter.prototype, {
  /** Nowy rekord ruchu warpa (src/game/warpTraffic.js): slot, rodzaj, encja (przylot zaplanowany — bez). */
  warpBegin(rec) {
    const o = this._begin(RC.WARP_BEGIN, WARP.B_WORDS);
    const d = this.ring.data;
    d[o + WARP.SLOT] = rec.id;
    d[o + WARP.B_KIND] = rec.kind === 'departure' ? WARP_KIND.DEPARTURE : WARP_KIND.ARRIVAL;
    this._ent(d, o + WARP.B_ENT, rec.entity);
    this._commit();
  },
  warpAttach(rec) {
    const o = this._begin(RC.WARP_ATTACH, WARP.A_WORDS);
    const d = this.ring.data;
    d[o + WARP.SLOT] = rec.id;
    this._ent(d, o + WARP.A_ENT, rec.entity);
    this._commit();
  },
  warpEnd(rec) {
    const o = this._begin(RC.WARP_END, 1);
    this.ring.data[o] = rec.id;
    this._commit();
  },
  warpClear() {
    this._begin(RC.WARP_CLEAR, 0);
    this._commit();
  }
});

Object.assign(RenderCommandWriter.prototype, {
  _rkt1(type, r) {
    const o = this._begin(type, 1);
    this.ring.data[o] = r.index;
    this._commit();
  },
  rocketBegin(active) {
    const o = this._begin(RC.RKT_BEGIN, 1);
    this.ring.data[o] = active;
    this._commit();
  },
  rocketLaunch(r, colorTheme) {
    const c = this.str(colorTheme);
    const o = this._begin(RC.RKT_LAUNCH, RKT.L_WORDS);
    const d = this.ring.data;
    d[o + RKT.SLOT] = r.index; d[o + RKT.L_COLOR] = c;
    this._commit();
  },
  rocketIgnite(r) { this._rkt1(RC.RKT_IGNITE, r); },
  rocketSplit(r) { this._rkt1(RC.RKT_SPLIT, r); },
  rocketFly(r, dt) {
    const o = this._begin(RC.RKT_FLY, RKT.F_WORDS);
    const d = this.ring.data;
    d[o + RKT.SLOT] = r.index; d[o + RKT.F_DT] = dt;
    this._commit();
  },
  rocketIntercept(r, x, y) {
    const o = this._begin(RC.RKT_INTERCEPT, RKT.I_WORDS);
    const d = this.ring.data;
    d[o + RKT.SLOT] = r.index; d[o + RKT.I_X] = x; d[o + RKT.I_Y] = y;
    this._commit();
  },
  rocketContact(r, x0, y0, x1, y1) {
    const o = this._begin(RC.RKT_CONTACT, RKT.C_WORDS);
    const d = this.ring.data;
    d[o + RKT.SLOT] = r.index; d[o + RKT.C_X0] = x0; d[o + RKT.C_Y0] = y0; d[o + RKT.C_X1] = x1; d[o + RKT.C_Y1] = y1;
    this._commit();
  },
  rocketDetonate(r, x, y, hit, hitShield) {
    const o = this._begin(RC.RKT_DETONATE, RKT.D_WORDS);
    const d = this.ring.data;
    d[o + RKT.SLOT] = r.index; d[o + RKT.D_X] = x; d[o + RKT.D_Y] = y;
    this._ent(d, o + RKT.D_HIT, hit);
    d[o + RKT.D_SHIELD] = hitShield ? 1 : 0;
    this._commit();
  },
  rocketUpdate(dt) {
    const o = this._begin(RC.RKT_UPDATE, 1);
    this.ring.data[o] = dt;
    this._commit();
  },
  /** Kilwater torpedy (pętla pocisków gry): pocisk = slot pocisku (stan kilwateru trzyma render). */
  torpedoWake(b, dt) {
    if (!b) return;
    const o = this._begin(RC.RKT_WAKE, RKT.W_WORDS);
    const d = this.ring.data;
    this._ent(d, o + RKT.W_SHOT, b, this.ids.shots);
    d[o + RKT.W_DT] = dt;
    this._commit();
  }
});

// ---------------------------------------------------------------------------
// Czytelnik / dyspozytor (render)
// ---------------------------------------------------------------------------

export class RenderCommandReader {
  /**
   * @param {ArrayBuffer|SharedArrayBuffer} buffer — pierścień pisarza
   * @param {{ entityAt?: (slot, gen) => object|null, shotAt?: (slot, gen) => object|null }} [o] — rozwiązanie slotów
   *   (inline: przestrzenie pisarza; worker: lustra migawki)
   */
  constructor(buffer, { entityAt = null, shotAt = null } = {}) {
    this.ring = new EventRingReader(buffer);
    this.strs = [];
    this.handlers = [];
    this.entityAt = entityAt;
    this.shotAt = shotAt;
    this.dispatched = 0;
    this._draining = false;
  }

  /** Obsługa typu: fn(reader, data, offset, words). */
  on(type, fn) {
    this.handlers[type] = typeof fn === 'function' ? fn : null;
    return this;
  }

  adopt(buffer) { this.ring.adopt(buffer); }

  /** Napis z id (−1 → undefined, −2 → null). */
  str(id) {
    if (id === STR_UNDEFINED) return undefined;
    if (id === STR_NULL) return null;
    return this.strs[id];
  }

  /** Encja z (slot, gen) w danych rekordu. */
  ent(d, o) {
    const slot = d[o];
    if (slot < 0 || !this.entityAt) return null;
    return this.entityAt(slot, d[o + 1]);
  }

  shot(d, o) {
    const slot = d[o];
    if (slot < 0 || !this.shotAt) return null;
    return this.shotAt(slot, d[o + 1]);
  }

  /** Dopija pierścień (rekordy z klatkami ≤ maxFrame). Nie wchodzi drugi raz w siebie (rekord rodzący rekord). */
  drain(maxFrame = Infinity) {
    if (this._draining) return 0;
    this._draining = true;
    let n = 0;
    try {
      const r = this.ring;
      for (let o; (o = r.next(maxFrame)) >= 0;) {
        const d = r.data;
        const type = r.type;
        if (type === RC.STR) {
          const len = d[o + 1];
          let s = '';
          for (let i = 0; i < len; i++) s += String.fromCharCode(d[o + 2 + i]);
          this.strs[d[o]] = s;
        } else {
          const fn = this.handlers[type];
          if (fn) fn(this, d, o, r.words);
        }
        n++;
      }
    } finally {
      this._draining = false;
    }
    this.dispatched += n;
    return n;
  }
}

// ---------------------------------------------------------------------------
// Wspólny strumień gry (tryb inline)
// ---------------------------------------------------------------------------

function idSpaceLookup(space) {
  return (slot, gen) => (space.isLive(slot, gen) ? space.objectAt(slot) : null);
}

/**
 * Strumień rozkazów gry. `RenderCommands.writer` — pisarz (gra), `RenderCommands.reader` — czytelnik trybu inline
 * (render rejestruje obsługę typów: reader.on(RC.X, fn)). `ready` — render gotowy na efekty (inline: haczyk renderu,
 * worker: flaga z kanału zwrotnego); gra bramkuje nim kosztowne przygotowania zdarzeń (bramki kadru, cooldown).
 */
export function createRenderCommands({ mode = 'inline', capacity = 4096, ids = null } = {}) {
  const writer = new RenderCommandWriter({ capacity, shared: mode === 'worker', ids });
  const api = {
    mode,
    writer,
    reader: null,
    _ready: null,
    _projReady: null,
    /** Render przyjmuje zdarzenia efektów (inline: WeaponFx.available; worker: flaga z kanału zwrotnego). */
    get ready() { return this._ready ? !!this._ready() : true; },
    /** Render rysuje pociski w 3D (inline: pule WeaponFx zbudowane) — reguła `__renderedByThree` po stronie gry. */
    get projectilesReady() { return this._projReady ? !!this._projReady() : true; },
    setReady(fn, projectilesFn = null) {
      this._ready = typeof fn === 'function' ? fn : null;
      this._projReady = typeof projectilesFn === 'function' ? projectilesFn : null;
    },
    endFrame() { writer.endFrame(); }
  };
  if (mode === 'inline') {
    const ids = writer.ids;
    const reader = new RenderCommandReader(writer.buffer, {
      entityAt: idSpaceLookup(ids.entities),
      shotAt: idSpaceLookup(ids.shots)
    });
    writer.onGrow = (b) => reader.adopt(b);
    writer.setInlineSink(() => reader.drain());
    api.reader = reader;
  }
  return api;
}

/** Strumień rozkazów gry (jeden na stronę) — na wspólnych slotach renderu (cykl klatki: pętla gry). */
export const RenderCommands = createRenderCommands({ ids: RenderSlots });

if (typeof window !== 'undefined') window.RenderCommands = RenderCommands;
