// ============================================================
// Audyt zasięgów czujników jednostek (2026-11-11, docs/AUDYT-zasiegi-jednostek-2026-11-11.md, reguła zasieg-czujnikow).
// Czysta logika (bez three / DOM / window): skąd byt bierze MOC czujników (KONTAKT), SYGNATURĘ i WZROK (IDENTYFIKACJA)
// i czy któraś trafia w gałąź awaryjną:
//  - moc: `sensors` / `sensorProfile` bytu (jawny profil SHIP_SENSOR_PROFILES) — inaczej `fallbackSensorProfile` z typu
//    (fleetAwareness.js, domyślnie frigate_combat);
//  - sygnatura: `isCapitalShip` albo typ w `SENSOR_CONFIG.sizeModifiers`, albo jawna klasa kadłuba
//    (`SENSOR_SIGNATURE_CLASS_BY_HULL`) — inaczej kubełki promienia (`getEntitySizeModifier`);
//  - wzrok: jawne `visionRange`, rola radaru, myśliwiec, klasa kadłuba `shipRangeClassOf` — inaczej wzrok fregaty.
// Stacje (rekordy `kind: 'station'` obrazu czujników) biorą moc i sygnaturę z SENSOR_PICTURE_TUNE — jawne.
// Narzędzia: test `tests/zasiegiJednostek.test.mjs` (tabele), `RadarZasiegi.jednostki()` w grze
// (harness `scripts/webgpu/zasiegi-jednostek-gra.mjs`).
// ============================================================

import { SENSOR_CONFIG, signatureSourceOf } from './sensorSystem.js';
import { SIGNATURE_PENDING_DECISION, unitSensorProfileKey } from '../data/sensorUnits.js';
import { shipRangeClassOf } from '../data/shipRanges.js';
import { detectionLevel } from './sensorDetection.js';

const FIGHTER_RE = /fighter|interceptor|bomber|drone/;

/** Źródło mocy czujników bytu: 'profil' (własny), 'jednostka:<klucz>' (src/data/sensorUnits.js) albo 'awaryjna'. */
export function sensorStrengthSourceOf(e) {
  const p = e?.sensors || e?.sensorProfile;
  if (p && Number(p.passiveRange ?? p.passive ?? p.radarRange) > 0) return 'profil';
  const unit = unitSensorProfileKey(e);
  return unit ? `jednostka:${unit}` : 'awaryjna';
}

/** Źródło wzroku bytu: 'jawny' | 'radar' | 'mysliwiec' | 'klasa:<klasa>' | 'awaryjna' (wzrok fregaty). */
export function visionSourceOf(e) {
  if (!e) return 'awaryjna';
  if (Number(e.sensors?.visionRange ?? e.visionRange) > 0) return 'jawny';
  if (e.sensors?.role === 'radar' || e.sensorProfile?.role === 'radar') return 'radar';
  const type = String(e.type || e.shipFrame || '').toLowerCase();
  if (e.fighter || FIGHTER_RE.test(type)) return 'mysliwiec';
  const cls = shipRangeClassOf(e);
  return cls ? `klasa:${cls}` : 'awaryjna';
}

/**
 * Wiersz audytu bytu: moc, sygnatura, wzrok i ich źródła; `awaryjne` — lista członów z gałęzi awaryjnej.
 * `A` — adaptery obrazu czujników (passiveOf, activeOf, baseSigOf, visionOf, isStation), `tune` — SENSOR_PICTURE_TUNE.
 */
export function auditSensorUnit(e, A, tune, isStation = !!(A.isStation && A.isStation(e))) {
  const station = !!isStation;
  const passive = station ? tune.stationStrength : A.passiveOf(e);
  const active = station ? tune.stationStrength : A.activeOf(e, passive);
  const sig = station ? tune.stationSignature : A.baseSigOf(e);
  const vision = station ? tune.stationVision : A.visionOf(e);
  const src = {
    moc: station ? 'stacja' : sensorStrengthSourceOf(e),
    sygnatura: station ? 'stacja' : signatureSourceOf(e),
    wzrok: station ? 'stacja' : visionSourceOf(e)
  };
  const awaryjne = [];
  if (src.moc === 'awaryjna') awaryjne.push('moc');
  // wyjątek do decyzji użytkownika (D1 — fregata z wezwań): kubełki promienia zostają, poza listą awaryjnych
  const decyzja = [];
  if (src.sygnatura.startsWith('promien')) {
    if (SIGNATURE_PENDING_DECISION.includes(String(e?.type || '').toLowerCase())) decyzja.push('sygnatura');
    else awaryjne.push('sygnatura');
  }
  if (src.wzrok === 'awaryjna') awaryjne.push('wzrok');
  const bad = [];
  for (const [k, v] of [['moc', passive], ['aktywna', active], ['sygnatura', sig], ['wzrok', vision]]) {
    if (!(Number.isFinite(v) && v > 0)) bad.push(k);
  }
  return { station, passive, active, sig, vision, src, awaryjne, decyzja, zle: bad };
}

/**
 * Para gracz ↔ byt (obie strony): promień kontaktu i wzroku, poziomy z odległości. `me` / `them` — { x, y, strength,
 * sigEff (sygnatura × osłona), vision }. Zwraca { d, ichR, ichId, ichPoziom, mojR, mojId, mojPoziom }.
 */
export function sensorPair(me, them) {
  const dx = them.x - me.x, dy = them.y - me.y;
  const d2 = dx * dx + dy * dy;
  const ichR = them.strength * me.sigEff;
  const mojR = me.strength * them.sigEff;
  return {
    d: Math.sqrt(d2),
    ichR, ichId: them.vision, ichPoziom: detectionLevel(d2, ichR, them.vision),
    mojR, mojId: me.vision, mojPoziom: detectionLevel(d2, mojR, me.vision)
  };
}

export { SENSOR_CONFIG };
