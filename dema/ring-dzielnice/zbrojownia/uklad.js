// DZIELNICA RINGU „Zbrojownia i skład amunicji” — UKŁAD (czysta matematyka, bez three i DOM).
//
// Odcinek ringu Ziemi tuż za prawym końcem portu (suchy dok floty leży po stronie −s). Dwie części rozdzielone pasem
// straży (wał wybuchowy przez cały przekrój):
//   • ZBROJOWNIA (s −6 000 … −250) — rola ekonomii Ziemi „zbrojownia”: hale montażu luf i emiterów przy ringu, hale
//     montażu wież w rzędzie zewnętrznym, za nimi PLAC GOTOWYCH WIEŻ ze STANOWISKAMI PRÓB na krawędzi, a dalej w
//     przestrzeń zamknięta STRZELNICA (dwa ramiona i kulochwyt — bez szpar, statki do niej nie wlatują);
//   • SKŁAD AMUNICJI (s 250 … 6 000) — towar z importu (Wenus, Saturn): w rzędzie zewnętrznym DOKI UZBRAJANIA otwarte
//     na drogę (S fregata, M niszczyciel, L pancernik), za nimi POLE BUNKRÓW z wałami, HANGAR MYŚLIWCÓW z importu
//     (wylot w przestrzeń) i NABRZEŻE AMUNICYJNE (pas MEGA) od strony przestrzeni.
// Przy ringu: ekspedycja uzbrojenia i amunicji do portu (zatoki ciężarówek po stronie ringu — ruch ku −s, czyli ku
// stoczni i suchemu dokowi floty), dostawy wsadu na licu rzędu zewnętrznego.
import { RING_V, createDistrict, ringScale } from '../kit/uklad.js';

export const ZB = Object.freeze({
  sHalf: 6000,
  armory: Object.freeze({ a: -6000, b: -250 }),
  guard: Object.freeze({ a: -250, b: 250 }),
  ammo: Object.freeze({ a: 250, b: 6000 }),
  // plac gotowych wież i stanowiska prób (za rzędem zewnętrznym zbrojowni)
  yard: Object.freeze({ v0: RING_V.outer1, v1: 10000, standV: 9420, storeV0: 6560, storeV1: 8800 }),
  // strzelnica: ramiona (ściany promieniowe) i kulochwyt
  range: Object.freeze({ armW: 300, v0: 10000, v1: 13600, backV1: 13950 }),
  // pole bunkrów, hangar myśliwców, nabrzeże
  bunkers: Object.freeze({ v0: RING_V.outer1, v1: 10800, hangarA: 250, hangarB: 1900, megaS: 4150 }),
  // stanowiska prób (s) i rodzaje wież — kolejność = grupy ruchome 1…8 budowli strzelnicy
  stands: Object.freeze([
    Object.freeze({ s: -5300, kind: 'kin', goods: 'gun_ballistic', label: 'KINETYCZNE' }),
    Object.freeze({ s: -4680, kind: 'rail', goods: 'gun_railgun', label: 'SZYNOWE' }),
    Object.freeze({ s: -4060, kind: 'laser', goods: 'gun_energy', label: 'LASEROWE' }),
    Object.freeze({ s: -3440, kind: 'plasma', goods: 'gun_plasma', label: 'PLAZMOWE' }),
    Object.freeze({ s: -2820, kind: 'launcher', goods: 'launcher_ordnance', label: 'RAKIETOWE' }),
    Object.freeze({ s: -2200, kind: 'torpedo', goods: 'launcher_torpedo', label: 'TORPEDOWE' }),
    Object.freeze({ s: -1580, kind: 'pd', goods: 'pd_turret', label: 'OBRONA PKT.' }),
    Object.freeze({ s: -960, kind: 'flak', goods: 'flak_turret', label: 'FLAK' })
  ]),
  // tarcze na kulochwycie (s) — wieże strzelają do najbliższych
  targets: Object.freeze([-5450, -4900, -4350, -3800, -3250, -2700, -2150, -1600, -1050]),
  // doki uzbrajania od lewej (klasa → kadłub floty)
  armRow: Object.freeze(['s', 'm', 'l', 'l', 'm', 's']),
  armHull: Object.freeze({ s: 'terran_frigate', m: 'terran_destroyer', l: 'terran_battleship' })
});

/** Kolumny i rzędy pola bunkrów (środki s, v) — tylko tam, gdzie nie ma hangaru ani wylotu. */
export function bunkerGrid() {
  const list = [];
  const cols = [2350, 3050, 3750, 4450, 5150, 5800];
  const rows = [6900, 7780, 8660, 9540];
  const kinds = ['missile_round', 'torpedo_round', 'ammo_kinetic', 'flak_shell'];
  cols.forEach((s, ci) => rows.forEach((v, ri) => {
    if (s > 5700 && ri === 3) return;            // róg przy nabrzeżu: posterunek
    list.push({ s, v, col: ci, row: ri, goods: kinds[(ci + ri) % kinds.length] });
  }));
  // dwa bunkry za hangarem (między ścianą tylną hangaru a rzędem zewnętrznym)
  for (const s of [700, 1450]) list.push({ s, v: 7350, col: -1, row: 0, goods: 'ammo_kinetic' });
  return list;
}

export function buildZbrojowniaLayout() {
  const D = createDistrict({ id: 'zbrojownia', sHalf: ZB.sHalf });
  const V = RING_V;
  const A = ZB.armory;
  const G = ZB.guard;
  const M = ZB.ammo;
  // --- rząd przy ringu: hale (lico ku drodze, wjazd z zatok ciężarówek na poboczu)
  D.block({ zone: 'ZI', bar: 'hale', a: A.a, b: A.b, v0: V.inner0, v1: V.inner1, face: 1 });
  D.block({ zone: 'ZI', bar: 'straz', a: G.a, b: G.b, v0: V.inner0, v1: V.inner1, face: 1 });
  D.block({ zone: 'ZI', bar: 'ekspedycja', a: M.a, b: M.b, v0: V.inner0, v1: V.inner1, face: 1 });
  // --- rząd zewnętrzny: hale montażu wież | wał straży | doki uzbrajania otwarte na drogę
  D.block({ zone: 'ZO', bar: 'montaz', a: A.a, b: A.b, v0: V.outer0, v1: V.outer1, face: -1 });
  D.block({ zone: 'ZO', bar: 'straz', a: G.a, b: G.b, v0: V.outer0, v1: V.outer1, face: -1 });
  D.arcBar({ zone: 'ZU', bar: 'uzbrajanie', a: M.a, b: M.b, v0: V.outer0, v1: V.outer1, row: ZB.armRow.slice(), open: -1, tags: { role: 'uzbrajanie', navy: true } });
  // --- za rzędem: plac gotowych wież ze stanowiskami prób | wał | pole bunkrów z hangarem
  D.block({ zone: 'ZP', bar: 'plac', a: A.a, b: A.b, v0: ZB.yard.v0, v1: ZB.yard.v1, face: 1 });
  D.block({ zone: 'ZW', bar: 'wal', a: G.a, b: G.b, v0: ZB.yard.v0, v1: ZB.bunkers.v1, face: 0 });
  D.arcBar({ zone: 'ZB', bar: 'hangar', a: ZB.bunkers.hangarA, b: ZB.bunkers.hangarB, v0: ZB.bunkers.v0, v1: ZB.bunkers.v1, row: ['hangar'], open: 1, tags: { role: 'mysliwce' } });
  D.block({ zone: 'ZB', bar: 'bunkry', a: ZB.bunkers.hangarB, b: M.b, v0: ZB.bunkers.v0, v1: ZB.bunkers.v1, face: 1 });
  // nabrzeże amunicyjne: pas MEGA od strony przestrzeni (import z Wenus i Saturna)
  D.megaAt('ZB', ZB.bunkers.megaS, ZB.bunkers.v1, { role: 'amunicja' });
  // --- strzelnica: dwa ramiona promieniowe i kulochwyt (pole zamknięte z każdej strony)
  const R = ZB.range;
  const armS = R.armW / ringScale((R.v0 + R.v1) / 2);
  D.radialBar({ zone: 'ZR', bar: 'ramie-l', a: A.a, b: A.a + armS, v0: R.v0, v1: R.v1 });
  D.radialBar({ zone: 'ZR', bar: 'ramie-p', a: A.b - armS, b: A.b, v0: R.v0, v1: R.v1 });
  D.block({ zone: 'ZR', bar: 'kulochwyt', a: A.a, b: A.b, v0: R.v1, v1: R.backV1, face: -1 });

  // --- transport po ringu
  // ekspedycja do portu (pobocze przy ringu — ruch ku −s, ku stoczni i suchemu dokowi floty)
  const OUT_ARMS = [
    ['gun_ballistic', 'DZIAŁA KIN.'], ['gun_railgun', 'DZIAŁA SZYN.'], ['gun_energy', 'EMITERY'], ['gun_plasma', 'DZIAŁA PLAZM.'],
    ['launcher_ordnance', 'WYRZUTNIE'], ['launcher_torpedo', 'WYRZ. TORPED'], ['pd_turret', 'OBRONA PKT.'], ['flak_turret', 'FLAK']
  ];
  OUT_ARMS.forEach(([goods, label], i) => D.truckBay({ s: -5550 + i * 700, side: -1, len: 360, goods, dir: 'out', label }));
  const OUT_AMMO = [['ammo_kinetic', 'AMUNICJA KIN.'], ['flak_shell', 'POCISKI FLAK'], ['missile_round', 'RAKIETY'], ['torpedo_round', 'TORPEDY'], ['fighter_craft', 'MYŚLIWCE']];
  OUT_AMMO.forEach(([goods, label], i) => D.truckBay({ s: 1000 + i * 1000, side: -1, len: 360, goods, dir: 'out', label }));
  // wsad zbrojowni (lico rzędu zewnętrznego — bez doków, więc zatoki wszędzie)
  const IN_ARMS = [
    ['steel', 'STAL'], ['titan_alloy', 'STOP TYTANU'], ['copper_wire', 'PRZEWÓD'], ['optic_lens', 'SOCZEWKI'],
    ['chips', 'UKŁADY'], ['coolant', 'CHŁODZIWO'], ['hull_plate', 'PŁYTY KADŁUBA'], ['carbon_composite', 'KOMPOZYT']
  ];
  IN_ARMS.forEach(([goods, label], i) => D.truckBay({ s: -5600 + i * 700, side: 1, len: 360, goods, dir: 'in', label }));
  // kolej (kratownica pod drogą)
  D.railStop({ s: -3600, side: -1, len: 900, goods: 'gun_railgun', dir: 'out', label: 'UZBROJENIE' });
  D.railStop({ s: -3600, side: 1, len: 900, goods: 'titan_alloy', dir: 'in', label: 'WSAD Z HUTY' });
  D.railStop({ s: 3100, side: -1, len: 900, goods: 'missile_round', dir: 'out', label: 'AMUNICJA FLOTY' });
  D.railStop({ s: -1300, side: -1, len: 900, goods: 'pd_turret', dir: 'out', label: 'WIEŻE' });

  return D.finish({ placeLabels: { range: 'STRZELNICA' }, locate: zbLocate });
}

/** Opis miejsca do HUD-u: strzelnica, plac, bunkry (inne miejsca — opis wspólny). */
function zbLocate(x, z, a, out) {
  if (a.s > ZB.armory.a && a.s < ZB.armory.b && a.v > ZB.range.v0 && a.v < ZB.range.v1) {
    out.place = 'range';
    out.inside = 0.3;
    return true;
  }
  return false;
}
