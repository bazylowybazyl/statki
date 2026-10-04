// src/3d/ships3d/weapons/weapons3D.js
//
// MODELE 3D BRONI — wieże, wyrzutnie i ich ruchome części (demo dema/atlas3d-webgpu.html).
// Geometria z budowniczego (meshBuilder3D.js), materiał palety (shipMaterials3D.tsl.js).
//
// SKALA I OBRYS JAK W GRZE: model powstaje w jednostkach LOKALNYCH wieży 2D (Turret2D:
// +X = przód, +Y = bok) — obrys obudowy i luf wprost z prostokątów `base` / `barrels`
// modułów sprite'ów (mainWeaponSprite2D, specialWeaponSprite2D, tempestSprite2D,
// ciwsSprite2D, pdWeaponSprite2D, launcherSprite2D, yamatoSprite2D; torpedy — sylwetka
// Turret2D), więc wyloty luf są tam, gdzie gra liczy wystrzał. Świat = lokalne × skala
// broni (weapon3DScale: rozmiar × kategoria × klasa kadłuba, jak weaponScale w turret2D.js).
// Wygląd (barwy świateł, magazyny, wentylacja, cewki) — z promptów atlasów
// (assets/weapons/*.prompt.md).
//
// CZĘŚCI (każda to osobna geometria, wspólna dla wszystkich egzemplarzy tej broni):
//   ring    — podstawa obrotnicy (stoi na barbecie kadłuba), nieruchoma,
//   housing — obudowa, obraca się w poziomie (yaw) wokół (0, 0),
//   barrel  — lufa / pojemnik: obraca się w pionie (pitch) wokół czopu `trunnion`, cofa
//             się wzdłuż swojej osi (odrzut); jedna geometria powielona w `barrels` (y, z),
//   spin    — wirujący blok luf (gatlingi) wokół osi lufy, opcjonalny.
// Oś lufy w geometrii `barrel` / `spin`: X od czopu, y = z = 0.

import { MeshBuilder3D, SHIP3D_MAT as M, octPoly, rectPoly, ngonPoly } from '../meshBuilder3D.js';

// Skale z turret2D.js (SCALE_BY_SIZE, CATEGORY_TRIM) i ships.js (WEAPON_TIER_SCALE) —
// te same liczby, żeby wieże 3D miały rozmiar wież gry.
const SCALE_BY_SIZE = Object.freeze({ Capital: 1.75, L: 1.02, M: 0.76, S: 0.52 });
const CATEGORY_TRIM = Object.freeze({ beam: 0.94, ciws: 0.88, flak: 0.92, rocket: 0.82, torpedo: 0.90, default: 1.0 });
const TIER_TURRET = Object.freeze({ S: 0.5, M: 0.7, L: 0.88, Capital: 1.0 });

/** Jednostki świata na jednostkę lokalną wieży (jak weaponScale × klasa kadłuba w turret2D.js). */
export function weapon3DScale(def, hullTier = 'Capital') {
  const base = SCALE_BY_SIZE[String(def?.size || '').trim()] || SCALE_BY_SIZE.M;
  const trim = CATEGORY_TRIM[String(def?.category || '').toLowerCase()] || CATEGORY_TRIM.default;
  return base * trim * (TIER_TURRET[hullTier] ?? 1);
}

/** Broń → rodzina modelu 3D (null — bez wieży: hangar, Hexlance wbudowany w kadłub). */
export const WEAPON3D_FAMILY = Object.freeze({
  railgun_mk1: 'tempest1', tempest_ion_s: 'tempest1', tempest_ion_l: 'tempest1', tempest_ion_mk1: 'tempest1',
  railgun_mk2: 'tempest2', tempest_ion_mk2: 'tempest2',
  vulcan_minigun: 'vulcan', gatling_s: 'vulcan',
  helios_laser: 'helios', helios_laser_s: 'helios', helios_lance_l: 'helios',
  heavy_autocannon: 'heavy', heavy_autocannon_l: 'heavy',
  armata_mk1: 'armata',
  beam_continuous: 'beamC', beam_pulse: 'beamP',
  ciws_mk1: 'ciws1', ciws_mk2: 'ciws2', laser_pd_mk1: 'heliosPd',
  flak_s: 'flakL', flak_m: 'flakL', flak_l: 'flakH', flak_capital: 'flakH',
  missile_rack: 'cruise', torpedo_salvo: 'cruise', fast_missile_rack: 'fast', osa_micro_missile: 'osa',
  roj_pod: 'osa', grad_launcher: 'cruise', hydra_mirv: 'cruise',
  supernova_missile: 'supernova', siege_torpedo: 'torpedo', siege_torpedo_mk2: 'torpedo',
  special_goliath_autocannon: 'goliath', special_plasma_gatling: 'plasmaGatling',
  special_valkyrie_railgun: 'valkyrie', special_yamato_cannon: 'yamato', siege_railgun: 'mjolnir',
  // warianty rozmiarowe broni specjalnej: model rodzica (Yamato L — ta sama wieża z dwiema skrajnymi lufami)
  special_valkyrie_s: 'valkyrie', special_valkyrie_m: 'valkyrie', special_yamato_l: 'yamato2',
  hexlance_siege: null,
  fighter_bay: null, fighter_squad_interceptor: null, fighter_squad_multirole: null, fighter_squad_strike: null
});

/** Etykiety rodzin (galeria dema). */
export const WEAPON3D_FAMILY_LABEL = Object.freeze({
  tempest1: 'Tempest Ion (1 lufa)', tempest2: 'Tempest Ion Mk II (2 lufy)', vulcan: 'Vulcan / Gatling',
  helios: 'Helios Laser', heavy: 'Heavy Autocannon', armata: 'Armata Oblężnicza', beamC: 'Laser wiązkowy (ciągły)',
  beamP: 'Laser wiązkowy (puls)', ciws1: 'CIWS Mk I', ciws2: 'CIWS Mk II', heliosPd: 'Helios PD',
  flakL: 'Kartacz Flak', flakH: 'Grad / Perun Flak', cruise: 'Wyrzutnia Cruise', fast: 'Fast Missile Rack',
  osa: 'Osa Mk I', supernova: 'Supernova', torpedo: 'Torpedy oblężnicze', goliath: 'Goliath',
  plasmaGatling: 'Ion Plasma Gatling', valkyrie: 'Valkyrie', mjolnir: 'Mjolnir', yamato: 'Yamato',
  yamato2: 'Yamato (2 lufy)'
});

// ---------------------------------------------------------------------------
// Detale wspólne (układ lokalny budowniczego)
// ---------------------------------------------------------------------------

// Obudowa: wielokąt obrysu z góry, wysokość h nad z0, faza górna.
function shell(B, poly, z0, h, o = {}) {
  return B.prism(poly, z0, z0 + h, {
    bevel: o.bevel ?? [1.1, 1.1], bevelBottom: o.bevelBottom, slope: o.slope || 0, bottom: true,
    wallMat: o.wallMat ?? M.STEEL, bevelMat: o.bevelMat ?? M.BRIGHT, capMat: o.capMat ?? M.STEEL, bottomMat: M.DARK
  });
}

// Pasek statusu (świecący) leżący na dachu.
function strip(B, x0, x1, y, z, w, mat) {
  B.box((x0 + x1) / 2, y, z + 0.12, x1 - x0, w, 0.24, { mat, bottom: false });
}

// Kratka wentylacyjna: ciemna wnęka z listwami.
function vent(B, x0, x1, y0, y1, z, n, o = {}) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  B.box(cx, cy, z + 0.1, x1 - x0, y1 - y0, 0.2, { mat: M.DARK, bottom: false });
  const along = o.alongY ?? (y1 - y0 > x1 - x0);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    if (along) B.box(x0 + (x1 - x0) * t, cy, z + 0.35, (x1 - x0) / n * 0.45, (y1 - y0) * 0.9, 0.5, { mat: M.PANEL, bottom: false });
    else B.box(cx, y0 + (y1 - y0) * t, z + 0.35, (x1 - x0) * 0.9, (y1 - y0) / n * 0.45, 0.5, { mat: M.PANEL, bottom: false });
  }
}

// Wlot / prowadnica lufy w przedniej ścianie obudowy.
function receiver(B, x0, x1, y, zc, w, h) {
  B.box((x0 + x1) / 2, y, zc, x1 - x0, w, h, { mat: M.DARK, bevel: [0.3, 0.3] });
}

// Magazyn / pakiet kondensatorów po obu burtach (y0 < y1 po stronie +Y, lustro).
function sidePacks(B, x0, x1, y0, y1, z0, h, light, o = {}) {
  B.mirrorY(() => {
    B.box((x0 + x1) / 2, (y0 + y1) / 2, z0 + h / 2, x1 - x0, y1 - y0, h, { mat: o.mat ?? M.PANEL, bevel: [0.6, 0.6] });
    if (o.vent !== false) vent(B, x0 + (x1 - x0) * 0.12, x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.2, y1 - (y1 - y0) * 0.2, z0 + h, 4, { alongY: false });
    if (light != null) strip(B, x0 + (x1 - x0) * 0.7, x1 - (x1 - x0) * 0.08, (y0 + y1) / 2, z0 + h, (y1 - y0) * 0.35, light);
  });
}

// Obręcz na lufie (ośmiokąt), od x do x + len, promień r.
function collar(B, x, len, r, mat = M.STEEL) {
  B.cylinder([x, 0, 0], [x + len, 0, 0], r, r, { seg: 8, flat: true, mat, capMat: mat });
}

// Rura lufy (gładka) od x0 do x1.
function tubeX(B, x0, x1, r0, r1 = r0, mat = M.METAL, seg = 14) {
  B.cylinder([x0, 0, 0], [x1, 0, 0], r0, r1, { seg, mat, capMat: M.DARK });
}

// Graniastosłup wzdłuż X o przekroju prostokąta ze ściętymi rogami.
function boxX(B, x0, x1, hy, hz, o = {}) {
  const c = o.c ?? Math.min(hy, hz) * 0.3;
  const sec = octPoly(-hy, -hz, hy, hz, c);
  return B.alongX(x0, x1, sec, { mat: o.mat ?? M.PANEL, bevel: o.bevel ?? [0.4, 0.4] });
}

// Blok luf obrotowych (gatling): n rur na okręgu ringR, obejmy w braces (x), wirnik z tyłu.
function rotary(B, x0, x1, n, ringR, tubeR, braces, o = {}) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const y = Math.cos(a) * ringR;
    const z = Math.sin(a) * ringR;
    B.cylinder([x0, y, z], [x1, y, z], tubeR, tubeR, { seg: 8, mat: M.METAL, capMat: M.DARK });
  }
  // Oś i rura środkowa.
  B.cylinder([x0, 0, 0], [x1 - 1, 0, 0], ringR * 0.45, ringR * 0.45, { seg: 8, mat: M.DARK });
  for (const bx of braces) {
    B.cylinder([bx, 0, 0], [bx + (o.braceLen ?? 1.2), 0, 0], ringR + tubeR * 1.5, ringR + tubeR * 1.5, { seg: 10, flat: true, mat: o.braceMat ?? M.PANEL });
  }
  // Grupa wylotów.
  B.cylinder([x1 - 1.4, 0, 0], [x1, 0, 0], ringR + tubeR * 1.25, ringR + tubeR * 1.25, { seg: 10, flat: true, mat: M.DARK, capMat: M.DARK });
  if (o.strips) {
    for (let k = 0; k < n; k += 2) {
      const a = ((k + 0.5) / n) * Math.PI * 2;
      const y = Math.cos(a) * (ringR + tubeR * 0.2);
      const z = Math.sin(a) * (ringR + tubeR * 0.2);
      B.cylinder([x0 + (x1 - x0) * 0.2, y, z], [x0 + (x1 - x0) * 0.75, y, z], tubeR * 0.35, tubeR * 0.35, { seg: 6, mat: o.strips });
    }
  }
}

// Hamulec wylotowy: blok z otworami bocznymi (ciemne wcięcia).
function muzzleBrake(B, x0, x1, hy, hz, slots = 2) {
  boxX(B, x0, x1, hy, hz, { mat: M.PANEL, c: Math.min(hy, hz) * 0.25 });
  const step = (x1 - x0) / (slots + 1);
  for (let k = 1; k <= slots; k++) {
    B.mirrorY(() => B.box(x0 + step * k, hy + 0.05, 0, step * 0.45, 0.2, hz * 1.2, { mat: M.DARK, bottom: false }));
  }
  B.face([[x1 + 0.02, -hy * 0.45, -hz * 0.45], [x1 + 0.02, hy * 0.45, -hz * 0.45], [x1 + 0.02, hy * 0.45, hz * 0.45], [x1 + 0.02, -hy * 0.45, hz * 0.45]], M.DARK, [1, 0, 0]);
}

// Pojemnik rakiet (wyrzutnie): prostokątny, pokrywa segmentowa, dwie obejmy, wylot.
function canister(B, x0, x1, hy, hz, light, o = {}) {
  boxX(B, x0, x1, hy, hz, { mat: o.mat ?? M.STEEL, c: Math.min(hy, hz) * 0.28, bevel: [0.3, 0.3] });
  const L = x1 - x0;
  for (const t of o.bands ?? [0.28, 0.66]) boxX(B, x0 + L * t, x0 + L * t + L * 0.06, hy * 1.08, hz * 1.08, { mat: M.PANEL, c: Math.min(hy, hz) * 0.3 });
  for (let k = 1; k < 4; k++) B.box(x0 + L * (0.1 + k * 0.2), 0, hz + 0.03, 0.18, hy * 1.6, 0.06, { mat: M.DARK, bottom: false });
  // Wylot (ciemna warga) i złącze z tyłu.
  B.face([[x1 + 0.03, -hy * 0.7, -hz * 0.7], [x1 + 0.03, hy * 0.7, -hz * 0.7], [x1 + 0.03, hy * 0.7, hz * 0.7], [x1 + 0.03, -hy * 0.7, hz * 0.7]], M.DARK, [1, 0, 0]);
  boxX(B, x0 - L * 0.06, x0, hy * 0.6, hz * 0.6, { mat: M.DARK });
  if (light != null) B.box(x0 + L * 0.06, 0, hz + 0.1, L * 0.05, hy * 0.5, 0.2, { mat: light, bottom: false });
}

// Podstawa obrotnicy: niski pierścień z fazą (stoi na barbecie).
function ring(B, r, h = 1.2) {
  B.lathe([[r * 1.04, -0.4], [r * 1.04, h * 0.55], [r * 0.94, h], [0, h]], { seg: 28, mats: [M.PANEL, M.BRIGHT, M.DARK] });
  B.lathe([[r * 0.8, h], [r * 0.8, h + 0.35], [0, h + 0.35]], { seg: 24, mats: [M.DARK, M.DARK] });
}

// ---------------------------------------------------------------------------
// Rodziny. Każda funkcja dostaje budowniczych części i zwraca układ.
// R — ring, H — housing, L — barrel, S — spin (opcjonalny).
// ---------------------------------------------------------------------------

const FAMILIES = {
  // TEMPEST ION — niska sześcioboczna obudowa, akcelerator z cewkami, cyjan.
  tempest1: (P) => tempest(P, { hy: 8, barrels: [0] }),
  tempest2: (P) => tempest(P, { hy: 11.6, barrels: [-5, 5] }),

  // VULCAN — przysadzista obudowa, skrzynie amunicji, wirnik z tyłu, blok luf obrotowych.
  vulcan: ({ R, H, L, S }) => {
    ring(R, 11);
    const z0 = 1.2;
    shell(H, octPoly(-8, -8.5, 16, 8.5, [3, 5, 5, 3]), z0, 8.5);
    H.box(4, 0, z0 + 8.5 + 0.5, 12, 9, 1, { mat: M.STEEL, bevel: [0.4, 0.4] });
    sidePacks(H, -6, 11, 8.5, 13, z0, 7, M.E_AMBER);
    H.cylinder([-11, 0, z0 + 4.5], [-7.5, 0, z0 + 4.5], 4.4, 4.4, { seg: 10, flat: true, mat: M.DARK });
    vent(H, -6.5, -2, -4, 4, z0 + 8.5, 5);
    receiver(H, 14, 17.2, 0, z0 + 4.8, 8.6, 6.2);
    const tx = 12; const tz = z0 + 4.8;
    boxX(L, -5, 2, 4.4, 4.2, { mat: M.PANEL });
    rotary(S, 2 - 4, 45 - tx, 6, 2.5, 1.05, [6 - tx + 8, 16 - tx + 8, 28 - tx + 4], { braceMat: M.PANEL });
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 45 - tx, recoil: 1.6, spin: true, light: 'amber', kind: 'ballistic', pitch: [-8, 70] };
  },

  // HELIOS — wąska kanciasta obudowa, dwa smukłe emitery z żebrami, czerwień.
  helios: ({ R, H, L }) => {
    ring(R, 16);
    const z0 = 1.2;
    shell(H, [[-12, -17], [-6, -25], [13, -25], [22, -13], [22, 13], [13, 25], [-6, 25], [-12, 17]], z0, 8.2);
    H.box(3, 0, z0 + 8.2 + 0.5, 16, 12, 1, { mat: M.STEEL, bevel: [0.4, 0.4] });
    sidePacks(H, -11, -1, 7, 18, z0 + 8.2, 3.2, null);
    H.mirrorY(() => {
      for (let k = 0; k < 4; k++) H.box(-9.5 + k * 2.4, 12.5, z0 + 11.4 + 0.7, 0.8, 10, 1.4, { mat: M.DARK, bottom: false });
      strip(H, 1, 16, 21, z0 + 8.2, 1.1, M.E_RED);
    });
    receiver(H, 18, 22.4, -6, z0 + 4.4, 6.6, 5.4);
    receiver(H, 18, 22.4, 6, z0 + 4.4, 6.6, 5.4);
    const tx = 17; const tz = z0 + 4.4;
    // Emiter: zamek, żebrowany płaszcz, smukła lanca, obręcze, głowica.
    boxX(L, 9 - tx, 15 - tx, 3.1, 2.9, { mat: M.PANEL });
    for (let x = 15 - tx; x < 29 - tx; x += 1.5) boxX(L, x, x + 0.8, 2.5, 2.5, { mat: M.DARK, c: 0.6 });
    tubeX(L, 15 - tx, 43 - tx, 1.25);
    L.mirrorY(() => L.box((17 + 38) / 2 - tx, 1.35, 0, 38 - 17, 0.35, 0.7, { mat: M.E_RED }));
    collar(L, 30 - tx, 1.4, 2.1);
    collar(L, 35 - tx, 1.4, 2.1);
    L.alongX(41 - tx, 47 - tx, [[-2.6, -1.6], [2.6, -1.6], [2.9, 0], [2.6, 1.6], [-2.6, 1.6], [-2.9, 0]], { mat: M.STEEL, bevel: [0.3, 0.3] });
    L.face([[47 - tx + 0.02, -0.9, -0.6], [47 - tx + 0.02, 0.9, -0.6], [47 - tx + 0.02, 0.9, 0.6], [47 - tx + 0.02, -0.9, 0.6]], M.E_RED, [1, 0, 0]);
    return { trunnion: [tx, tz], barrels: [[-6, 0], [6, 0]], muzzleX: 47 - tx, recoil: 0.9, light: 'red', kind: 'energy', pitch: [-8, 70] };
  },

  // HEAVY AUTOCANNON — kwadratowa obudowa, boczne zasilacze taśm, jedna gruba lufa w płaszczu.
  heavy: ({ R, H, L }) => {
    ring(R, 11.5);
    const z0 = 1.2;
    shell(H, octPoly(-9, -9.5, 17, 9.5, [3, 4, 4, 3]), z0, 9);
    sidePacks(H, -5, 10, 9.5, 12.5, z0, 7, M.E_AMBER);
    vent(H, -8.5, -3, -6, 6, z0 + 9, 5);
    H.box(6, 0, z0 + 9.4, 12, 11, 0.8, { mat: M.STEEL, bevel: [0.3, 0.3] });
    receiver(H, 13.5, 17.3, 0, z0 + 4.8, 9.4, 7);
    const tx = 12; const tz = z0 + 4.8;
    boxX(L, 7 - tx, 13 - tx, 4.2, 4, { mat: M.PANEL });
    boxX(L, 13 - tx, 30 - tx, 3.4, 3.4, { mat: M.STEEL, c: 1.1 });
    collar(L, 15 - tx, 1.6, 3.9, M.PANEL);
    collar(L, 22 - tx, 1.6, 3.9, M.PANEL);
    tubeX(L, 30 - tx, 38 - tx, 2.6);
    muzzleBrake(L, 38 - tx, 42 - tx, 3.6, 2.8, 2);
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 42 - tx, recoil: 2.2, light: 'amber', kind: 'ballistic', pitch: [-8, 65] };
  },

  // ARMATA — szeroka kanciasta obudowa, dwa siłowniki odrzutu, ogromny zamek, gruba lufa.
  armata: ({ R, H, L }) => {
    ring(R, 16);
    const z0 = 1.2;
    shell(H, [[-12, -12], [-6, -17], [16, -17], [22, -9], [22, 9], [16, 17], [-6, 17], [-12, 12]], z0, 11);
    H.box(-6, 0, z0 + 11 + 1.6, 10, 16, 3.2, { mat: M.PANEL, bevel: [0.6, 0.6] });
    vent(H, -10, -2, -6.5, 6.5, z0 + 14.2, 6);
    H.mirrorY(() => {
      H.cylinder([4, 8.6, z0 + 8.4], [21, 8.6, z0 + 8.4], 2.2, 2.2, { seg: 12, mat: M.METAL });
      H.cylinder([2, 8.6, z0 + 8.4], [5, 8.6, z0 + 8.4], 2.8, 2.8, { seg: 10, flat: true, mat: M.PANEL });
      strip(H, 8, 18, 14.2, z0 + 11, 1.2, M.E_AMBER);
    });
    receiver(H, 18, 22.4, 0, z0 + 5.4, 12, 8.4);
    const tx = 16; const tz = z0 + 5.4;
    boxX(L, 8 - tx, 17 - tx, 5.8, 5.4, { mat: M.PANEL });
    boxX(L, 17 - tx, 30 - tx, 4.6, 4.6, { mat: M.STEEL, c: 1.6 });
    tubeX(L, 30 - tx, 50 - tx, 3.5, 3.2);
    collar(L, 49 - tx, 6 - 0, 4.8, M.PANEL);
    L.face([[55 - tx + 0.02, -2.2, -2.2], [55 - tx + 0.02, 2.2, -2.2], [55 - tx + 0.02, 2.2, 2.2], [55 - tx + 0.02, -2.2, 2.2]], M.DARK, [1, 0, 0]);
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 55 - tx, recoil: 3.2, light: 'amber', kind: 'ballistic', pitch: [-5, 55] };
  },

  // LASER CIĄGŁY — niska obudowa z pakietami zasilania, emiter z szyjką i owalną głowicą.
  beamC: ({ R, H, L }) => {
    ring(R, 13);
    const z0 = 1.2;
    shell(H, octPoly(-10, -15, 18, 15, [4, 7, 7, 4]), z0, 7.5);
    sidePacks(H, -9, 1, 7, 13.5, z0 + 7.5, 3, M.E_TURQ);
    H.box(6, 0, z0 + 7.9, 12, 10, 0.8, { mat: M.STEEL, bevel: [0.3, 0.3] });
    receiver(H, 13.5, 18.4, 0, z0 + 4.4, 12, 6);
    const tx = 12; const tz = z0 + 4.4;
    boxX(L, 6 - tx, 14 - tx, 5.2, 4.2, { mat: M.PANEL });
    for (let x = 14 - tx; x < 24 - tx; x += 1.6) boxX(L, x, x + 0.9, 2.6, 2.6, { mat: M.DARK, c: 0.7 });
    tubeX(L, 14 - tx, 26 - tx, 1.8, 1.8, M.METAL);
    // Głowica: owal z warstwowym obrzeżem.
    L.push().translate(0, 0, 0);
    L.cylinder([26 - tx, 0, 0], [31 - tx, 0, 0], 2.2, 7.6, { seg: 16, mat: M.STEEL });
    L.cylinder([31 - tx, 0, 0], [44 - tx, 0, 0], 7.6, 7.8, { seg: 16, mat: M.STEEL });
    L.cylinder([44 - tx, 0, 0], [48 - tx, 0, 0], 7.8, 3.2, { seg: 16, mat: M.BRIGHT, capMat: M.E_TURQ });
    L.pop();
    collar(L, 38 - tx, 1.2, 8.2, M.PANEL);
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 48 - tx, recoil: 0.3, light: 'turq', kind: 'beam', pitch: [-8, 70] };
  },

  // LASER PULSOWY — dwa krótkie emitery z żebrowaną szyjką i szeroką głowicą, karmin.
  beamP: ({ R, H, L }) => {
    ring(R, 15);
    const z0 = 1.2;
    shell(H, octPoly(-11, -21.5, 19, 21.5, [4, 7, 7, 4]), z0, 7.8);
    sidePacks(H, -9, 6, 14, 20, z0, 6.4, M.E_RED);
    vent(H, -9, -3, -9, 9, z0 + 7.8, 6);
    H.box(6, 0, z0 + 8.2, 12, 8, 0.8, { mat: M.STEEL, bevel: [0.3, 0.3] });
    receiver(H, 15, 19.4, -6, z0 + 4.4, 7.4, 5.4);
    receiver(H, 15, 19.4, 6, z0 + 4.4, 7.4, 5.4);
    const tx = 14; const tz = z0 + 4.4;
    boxX(L, 8 - tx, 15 - tx, 3.3, 3, { mat: M.PANEL });
    for (let x = 15 - tx; x < 25 - tx; x += 1.3) boxX(L, x, x + 0.7, 2.1, 2.1, { mat: M.DARK, c: 0.5 });
    tubeX(L, 15 - tx, 28 - tx, 1.3);
    L.alongX(27 - tx, 38 - tx, [[-3.2, -2], [3.2, -2], [3.6, 0], [3.2, 2], [-3.2, 2], [-3.6, 0]], { mat: M.STEEL, bevel: [0.3, 0.3] });
    L.face([[38 - tx + 0.02, -1.2, -0.6], [38 - tx + 0.02, 1.2, -0.6], [38 - tx + 0.02, 1.2, 0.6], [38 - tx + 0.02, -1.2, 0.6]], M.E_RED, [1, 0, 0]);
    return { trunnion: [tx, tz], barrels: [[-6, 0], [6, 0]], muzzleX: 38 - tx, recoil: 0.8, light: 'red', kind: 'energy', pitch: [-8, 70] };
  },

  // CIWS — mała obudowa z zasilaczami taśm i czujnikiem, krótki blok luf obrotowych, mięta.
  ciws1: (P) => ciws(P, { hy: 6, barrelHalf: 2.5, braces: 2 }),
  ciws2: (P) => ciws(P, { hy: 7, barrelHalf: 2.8, braces: 3, heavy: true }),

  // HELIOS PD — mała kanciasta obudowa, krótki emiter z żebrami, cyjan.
  heliosPd: ({ R, H, L }) => {
    ring(R, 6.5);
    const z0 = 1.2;
    shell(H, octPoly(-6, -7, 8, 7, [2, 3, 3, 2]), z0, 5);
    sidePacks(H, -5, 3, 4.6, 7, z0, 4, M.E_CYAN, { vent: false });
    H.box(1, 0, z0 + 5.3, 7, 5, 0.6, { mat: M.STEEL, bevel: [0.2, 0.2] });
    receiver(H, 6, 8.4, 0, z0 + 2.8, 3.6, 3);
    const tx = 5; const tz = z0 + 2.8;
    boxX(L, 3 - tx, 7 - tx, 1.9, 1.7, { mat: M.PANEL });
    for (let x = 7 - tx; x < 12 - tx; x += 0.9) boxX(L, x, x + 0.5, 1.4, 1.4, { mat: M.DARK, c: 0.3 });
    tubeX(L, 7 - tx, 16 - tx, 0.7);
    L.box(10 - tx, 0, 0.8, 8, 0.3, 0.3, { mat: M.E_CYAN });
    collar(L, 13 - tx, 0.8, 1.2);
    L.alongX(15.5 - tx, 18 - tx, [[-1.5, -1], [1.5, -1], [1.7, 0], [1.5, 1], [-1.5, 1], [-1.7, 0]], { mat: M.STEEL, bevel: [0.15, 0.15] });
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 18 - tx, recoil: 0.3, light: 'cyan', kind: 'energy', pitch: [-10, 85] };
  },

  // FLAK — lekki (dwie lufy, magazyny góra/dół) i ciężki Grad/Perun (sześciokątny pancerz).
  flakL: (P) => flak(P, { base: [-11, -14.5, 24, 28.8], barrels: [5.5, 23.5, 4.8], heavy: false }),
  flakH: (P) => flak(P, { base: [-12, -13, 28, 26], barrels: [7, 22, 5.7], heavy: true }),

  // WYRZUTNIE — obudowa + pojemniki (podnoszą się do strzału), bez odrzutu.
  cruise: (P) => launcher(P, { base: [-6, -9, 16, 18], podX: -1, podW: 17, podH: 4.4, ports: [-5, 0, 5], light: M.E_AMBER, depth: 1.0 }),
  fast: (P) => launcher(P, { base: [-6, -8, 16, 16], podX: -1, podW: 17, podH: 3.8, ports: [-5, 0, 5], light: M.E_AMBER, depth: 0.8, taper: true }),
  osa: (P) => launcher(P, { base: [-7, -5, 13, 10], podX: -3, podW: 13, podH: 4.4, ports: [0], light: M.E_CYAN, depth: 0.9, cradle: true }),
  supernova: (P) => launcher(P, { base: [-12, -13, 24, 26], podX: -1, podW: 31, podH: 11, ports: [7, -7], light: M.E_MAGENTA, depth: 1.0, massive: true }),
  torpedo: (P) => launcher(P, { base: [-12, -13, 24, 26], podX: -2, podW: 28, podH: 11, ports: [7, -7], light: M.E_RED, depth: 1.0, tubes: true }),

  // GOLIATH — szeroka dwulufowa obudowa, grube zasilacze, dwie ciężkie lufy, bursztyn.
  goliath: ({ R, H, L }) => {
    ring(R, 24);
    const z0 = 1.2;
    shell(H, [[-17, -18], [-10, -26], [18, -26], [27, -15], [27, 15], [18, 26], [-10, 26], [-17, 18]], z0, 13);
    sidePacks(H, -12, 14, 17, 24, z0 + 2, 10, M.E_AMBER);
    vent(H, -15.5, -8, -12, -2, z0 + 13, 5);
    vent(H, -15.5, -8, 2, 12, z0 + 13, 5);
    H.box(6, 0, z0 + 13.8, 20, 18, 1.6, { mat: M.STEEL, bevel: [0.5, 0.5] });
    receiver(H, 22, 27.6, -7, z0 + 6.4, 10.4, 8.4);
    receiver(H, 22, 27.6, 7, z0 + 6.4, 10.4, 8.4);
    const tx = 20; const tz = z0 + 6.4;
    boxX(L, 10 - tx, 20 - tx, 4.6, 4.4, { mat: M.PANEL });
    tubeX(L, 20 - tx, 53 - tx, 3.2, 3.0);
    collar(L, 24 - tx, 2.4, 4.4, M.PANEL);
    collar(L, 36 - tx, 2.4, 4.2, M.PANEL);
    L.box(30 - tx, 0, 3.3, 14, 1.2, 0.5, { mat: M.E_AMBER });
    muzzleBrake(L, 53 - tx, 58 - tx, 4.2, 3.6, 2);
    return { trunnion: [tx, tz], barrels: [[-7, 0], [7, 0]], muzzleX: 58 - tx, recoil: 3.6, light: 'amber', kind: 'ballistic', pitch: [-5, 60] };
  },

  // ION PLASMA GATLING — ośmioboczna obudowa, kondensatory, ciężki blok luf plazmowych, cyjan.
  plasmaGatling: ({ R, H, L, S }) => {
    ring(R, 19);
    const z0 = 1.2;
    shell(H, ngonPoly(4, 0, 20.5, 8, Math.PI / 8, 20), z0, 11);
    sidePacks(H, -12, 12, 14, 20, z0 + 1, 8.5, M.E_CYAN);
    vent(H, -15, -8, -8, 8, z0 + 11, 6);
    H.box(7, 0, z0 + 11.6, 16, 14, 1.2, { mat: M.STEEL, bevel: [0.5, 0.5] });
    receiver(H, 19, 24.8, 0, z0 + 6, 15, 10.4);
    const tx = 18; const tz = z0 + 6;
    boxX(L, 8 - tx, 16 - tx, 6.4, 6.2, { mat: M.PANEL });
    rotary(S, 16 - tx, 42 - tx, 6, 3.7, 1.55, [22 - tx, 33 - tx], { braceLen: 2.2, braceMat: M.STEEL, strips: M.E_CYAN });
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 42 - tx, recoil: 1.2, spin: true, light: 'cyan', kind: 'energy', pitch: [-8, 65] };
  },

  // VALKYRIE — klinowa obudowa, dwa akceleratory szynowe z magentą.
  valkyrie: ({ R, H, L }) => {
    ring(R, 17);
    const z0 = 1.2;
    shell(H, [[-14, -13], [-8, -19], [8, -19], [20, -9], [20, 9], [8, 19], [-8, 19], [-14, 13]], z0, 9.5, { slope: 1.2 });
    sidePacks(H, -12, -2, 8, 15, z0 + 9.5 - 1.2, 3, M.E_MAGENTA);
    H.mirrorY(() => { for (let k = 0; k < 3; k++) H.box(2 + k * 3, 16.4, z0 + 5, 1, 0.4, 5, { mat: M.DARK, bottom: false }); });
    receiver(H, 16, 20.4, -5, z0 + 5.2, 6.4, 5.2);
    receiver(H, 16, 20.4, 5, z0 + 5.2, 6.4, 5.2);
    const tx = 15; const tz = z0 + 5.2;
    boxX(L, 9 - tx, 15 - tx, 2.8, 2.8, { mat: M.PANEL });
    L.mirrorY(() => L.alongX(15 - tx, 34 - tx, rectPoly(0.7, -1.9, 1.9, 1.9), { mat: M.METAL, bevel: [0.2, 0.2] }));
    L.alongX(15 - tx, 33 - tx, rectPoly(-0.7, -0.9, 0.7, 0.9), { mat: M.DARK, bevel: false });
    for (const x of [19, 24.5, 30]) boxX(L, x - tx, x + 1.2 - tx, 2.5, 2.4, { mat: M.PANEL, c: 0.6 });
    L.mirrorY(() => L.box(24 - tx, 1.95, 0, 14, 0.12, 1.4, { mat: M.E_MAGENTA }));
    return { trunnion: [tx, tz], barrels: [[-5, 0], [5, 0]], muzzleX: 34 - tx, recoil: 1.1, light: 'magenta', kind: 'rail', pitch: [-8, 65] };
  },

  // MJOLNIR — długa prostokątna platforma, banki kondensatorów, bardzo długi akcelerator.
  mjolnir: ({ R, H, L }) => {
    ring(R, 20);
    const z0 = 1.2;
    shell(H, octPoly(-16, -22, 24, 22, [4, 7, 7, 4]), z0, 10.5);
    sidePacks(H, -14, 14, 15, 21.5, z0 + 1, 8, M.E_ICE);
    vent(H, -15, -9, -10, 10, z0 + 10.5, 7);
    H.box(6, 0, z0 + 11.2, 18, 14, 1.4, { mat: M.STEEL, bevel: [0.5, 0.5] });
    receiver(H, 19, 24.6, 0, z0 + 5.6, 12, 8.4);
    const tx = 17; const tz = z0 + 5.6;
    boxX(L, 8 - tx, 18 - tx, 5.2, 5, { mat: M.PANEL });
    L.mirrorY(() => L.alongX(18 - tx, 80 - tx, rectPoly(1.3, -3.2, 3.6, 3.2), { mat: M.METAL, bevel: [0.3, 0.3] }));
    L.alongX(18 - tx, 79 - tx, rectPoly(-1.3, -1.6, 1.3, 1.6), { mat: M.DARK, bevel: false });
    for (const x of [26, 40, 54, 68]) boxX(L, x - tx, x + 2 - tx, 4.4, 4.2, { mat: M.PANEL, c: 0.9 });
    L.mirrorY(() => L.box(49 - tx, 3.65, 0, 58, 0.14, 2.2, { mat: M.E_ICE }));
    return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 80 - tx, recoil: 4.5, light: 'ice', kind: 'rail', pitch: [-5, 45] };
  },

  // YAMATO — okrągła wieża pancernika z trzema lufami (środkowa dłuższa), cyjan.
  yamato: (P) => yamato(P, false),
  // YAMATO L (special_yamato_l) — ta sama wieża i lufa, tylko dwie skrajne lufy (jak SPECS.yamatoTwin w turret2D.js).
  yamato2: (P) => yamato(P, true)
};

function yamato({ R, H, L }, twin) {
  ring(R, 22);
  const z0 = 1.2;
  // Okrągła podstawa + kanciasta tarcza czołowa.
  H.push().translate(2, 0, z0);
  H.lathe([[20.5, 0], [20.5, 6], [18.5, 9.5], [0, 9.5]], { seg: 32, mats: [M.STEEL, M.BRIGHT, M.STEEL] });
  H.pop();
  shell(H, [[-14, -15], [8, -15], [20, 0], [8, 15], [-14, 15], [-20, 0]], z0 + 6, 9.5);
  H.box(-6, 0, z0 + 15.5 + 0.8, 12, 16, 1.6, { mat: M.PANEL, bevel: [0.5, 0.5] });
  vent(H, -15, -9, -8, 8, z0 + 15.5, 5);
  H.mirrorY(() => strip(H, -2, 10, 12.5, z0 + 15.5, 1.2, M.E_CYAN));
  H.box(16, 0, z0 + 9, 6, 24, 10, { mat: M.DARK, bevel: [0.5, 0.5] });
  const tx = 16; const tz = z0 + 9;
  // Jedna lufa (środkowa, najdłuższa) — boczne to ta sama geometria przesunięta (y) i krótsza o 2 (odsunięta).
  boxX(L, 6 - tx, 12 - tx, 3.4, 3.2, { mat: M.PANEL });
  tubeX(L, 12 - tx, 56 - tx, 2.6, 2.2);
  collar(L, 12 - tx, 2.2, 3.2, M.STEEL);
  L.box(33 - tx, 0, 2.55, 30, 0.6, 0.4, { mat: M.E_CYAN });
  L.cylinder([56 - tx, 0, 0], [58 - tx, 0, 0], 2.7, 2.7, { seg: 12, flat: true, mat: M.PANEL, capMat: M.DARK });
  const layout = { trunnion: [tx, tz], muzzleX: 58 - tx, recoil: 3, light: 'cyan', kind: 'energy', pitch: [-5, 50] };
  // twin: tylko skrajne lufy (krótsze o 2 — wylot 56 jak SPECS.yamatoTwin).
  if (twin) return { ...layout, barrels: [[-6.75, -0.8], [6.75, -0.8]], barrelShift: [-2, -2] };
  return { ...layout, barrels: [[-6.75, -0.8], [0, 0], [6.75, -0.8]], barrelShift: [-2, 0, -2] };
}

function tempest({ R, H, L }, o) {
  const hy = o.hy;
  ring(R, hy * 0.95);
  const z0 = 1.2;
  shell(H, [[-7, -hy + 3.5], [-4, -hy], [9, -hy], [13, -hy + 3.5], [13, hy - 3.5], [9, hy], [-4, hy], [-7, hy - 3.5]], z0, 6.4);
  H.box(2.5, 0, z0 + 6.4 + 0.5, 11, hy * 0.9, 1, { mat: M.STEEL, bevel: [0.4, 0.4] });
  H.mirrorY(() => {
    vent(H, -6, -2.2, hy * 0.45, hy - 1.6, z0 + 6.4, 3);
    strip(H, -1, 9, hy - 1.4, z0 + 6.4, 0.7, M.E_CYAN);
  });
  for (const y of o.barrels) receiver(H, 10.5, 13.4, y, z0 + 3.8, 5.4, 4.6);
  const tx = 9; const tz = z0 + 3.8;
  // Akcelerator: zamek, rura, cewki, pasek cyjanu, kołnierz ogniskujący, płaski wylot.
  boxX(L, 5 - tx, 11 - tx, 3.4, 3.0, { mat: M.PANEL });
  L.alongX(11 - tx, 31 - tx, octPoly(-2.3, -2.3, 2.3, 2.3, 0.8), { mat: M.METAL, bevel: [0.2, 0.2] });
  for (const x of [14, 17.5, 21, 24.5]) boxX(L, x - tx, x + 1.5 - tx, 3.0, 3.0, { mat: M.PANEL, c: 0.8 });
  L.box(21 - tx, 0, 2.4, 20, 0.7, 0.3, { mat: M.E_CYAN });
  boxX(L, 28 - tx, 31 - tx, 3.1, 3.1, { mat: M.STEEL, c: 0.9 });
  boxX(L, 31 - tx, 34 - tx, 2.3, 2.3, { mat: M.PANEL, c: 0.5 });
  L.face([[34 - tx + 0.02, -1.2, -1.2], [34 - tx + 0.02, 1.2, -1.2], [34 - tx + 0.02, 1.2, 1.2], [34 - tx + 0.02, -1.2, 1.2]], M.E_CYAN, [1, 0, 0]);
  return { trunnion: [tx, tz], barrels: o.barrels.map((y) => [y, 0]), muzzleX: 34 - tx, recoil: 1.4, light: 'cyan', kind: 'energy', pitch: [-8, 70] };
}

function ciws({ R, H, L, S }, o) {
  const hy = o.hy;
  ring(R, hy * 1.02);
  const z0 = 1.2;
  shell(H, [[-6, -hy + 2], [-4, -hy], [3, -hy], [6.4, -hy + 2.5], [6.4, hy - 2.5], [3, hy], [-4, hy], [-6, hy - 2]], z0, 5);
  sidePacks(H, -4.5, 3, hy - 0.4, hy + (o.heavy ? 3 : 2), z0, o.heavy ? 4.4 : 3.6, M.E_MINT, { vent: false });
  H.box(-2.5, 0, z0 + 5.5, 3, 2.6, 1, { mat: M.GLASS, bevel: [0.2, 0.2] });
  receiver(H, 4.6, 6.8, 0, z0 + 2.8, 4.2, 3.4);
  const tx = 4.5; const tz = z0 + 2.8;
  boxX(L, 3 - tx, 6.5 - tx, o.barrelHalf, o.barrelHalf * 0.95, { mat: o.heavy ? M.PANEL : M.DARK });
  const braces = o.braces === 3 ? [9 - tx, 13.5 - tx, 18 - tx] : [10 - tx, 16 - tx];
  rotary(S, 6.5 - tx, 22 - tx, 6, o.barrelHalf * 0.55, o.barrelHalf * 0.3, braces, { braceLen: 0.8 });
  return { trunnion: [tx, tz], barrels: [[0, 0]], muzzleX: 22 - tx, recoil: 0.5, spin: true, light: 'mint', kind: 'ballistic', pitch: [-10, 85] };
}

function flak({ R, H, L }, o) {
  const [bx, by, bw, bh] = o.base;
  const x0 = bx; const x1 = bx + bw; const hy = bh / 2;
  ring(R, hy * 0.95);
  const z0 = 1.2;
  const h = o.heavy ? 9 : 7.5;
  if (o.heavy) shell(H, [[x0, -hy + 4], [x0 + 5, -hy], [x1 - 6, -hy], [x1, -hy + 5], [x1, hy - 5], [x1 - 6, hy], [x0 + 5, hy], [x0, hy - 4]], z0, h, { bevel: [1.6, 1.4] });
  else shell(H, octPoly(x0, -hy + 3, x1, hy - 3, [2.5, 4, 4, 2.5]), z0, h);
  const magY0 = o.heavy ? hy - 5 : hy - 4.6;
  sidePacks(H, x0 + 3, x1 - 7, magY0, hy + (o.heavy ? 1.2 : 0.4), z0, h - 1, M.E_AMBER);
  for (let k = 0; k < 5; k++) H.box(x0 + 0.8, -3 + k * 1.5, z0 + h * 0.55, 1.6, 0.8, h * 0.8, { mat: M.DARK });
  H.box((x0 + x1) / 2 + 1, 0, z0 + h + 0.45, bw * 0.45, hy * 0.8, 0.9, { mat: M.STEEL, bevel: [0.3, 0.3] });
  for (const y of [-3.5, 3.5]) receiver(H, x1 - 3.6, x1 + 0.4, y, z0 + h * 0.55, o.barrels[2] + 1, o.barrels[2] + 0.6);
  const tx = x1 - 3; const tz = z0 + h * 0.55;
  const [b0, bl, bt] = o.barrels;
  const r = bt / 2;
  boxX(L, b0 - tx, b0 + bl * 0.25 - tx, r * 1.05, r * 1.0, { mat: M.PANEL });
  boxX(L, b0 + bl * 0.25 - tx, b0 + bl * 0.7 - tx, r * 0.78, r * 0.78, { mat: M.STEEL, c: r * 0.3 });
  collar(L, b0 + bl * 0.3 - tx, bl * 0.06, r * 0.95, M.PANEL);
  collar(L, b0 + bl * 0.55 - tx, bl * 0.06, r * 0.95, M.PANEL);
  tubeX(L, b0 + bl * 0.7 - tx, b0 + bl * 0.86 - tx, r * 0.55);
  muzzleBrake(L, b0 + bl * 0.86 - tx, b0 + bl - tx, r * 0.85, r * 0.7, o.heavy ? 3 : 2);
  return { trunnion: [tx, tz], barrels: [[-3.5, 0], [3.5, 0]], muzzleX: b0 + bl - tx, recoil: o.heavy ? 1.8 : 1.3, light: 'amber', kind: 'ballistic', pitch: [-8, 85] };
}

function launcher({ R, H, L }, o) {
  const [bx, by, bw, bh] = o.base;
  const x0 = bx; const x1 = bx + bw; const hy = bh / 2;
  ring(R, Math.max(hy, bw / 2) * 0.9);
  const z0 = 1.2;
  const h = o.massive ? 6.5 : 4.2;
  if (o.cradle) {
    // Osa: wąska kołyska z bocznymi policzkami.
    H.box((x0 + x1) / 2, 0, z0 + 1.2, bw, bh * 0.7, 2.4, { mat: M.STEEL, bevel: [0.4, 0.4] });
    H.mirrorY(() => H.box((x0 + x1) / 2, hy - 0.6, z0 + 2.6, bw * 0.8, 1.2, 3, { mat: M.PANEL, bevel: [0.3, 0.3] }));
  } else {
    shell(H, octPoly(x0, -hy, x1, hy, o.massive ? [3, 4, 4, 3] : [1.8, 2.5, 2.5, 1.8]), z0, h);
    vent(H, x0 + 0.8, x0 + bw * 0.28, -hy * 0.6, hy * 0.6, z0 + h, 4);
    if (o.massive) sidePacks(H, x0 + 2, x1 - 4, hy - 3.6, hy + 1.2, z0, h + 1.5, o.light);
    // Kozły: podpory pod pojemniki (obrót w pionie na tylnym czopie).
    H.mirrorY(() => H.box(x0 + bw * 0.35, hy * 0.92, z0 + h + 1.2, bw * 0.18, 1.2, 2.4, { mat: M.DARK }));
  }
  const tx = o.podX + 1.5; const tz = z0 + h + o.podH / 2 + 0.6;
  const px0 = o.podX - tx; const px1 = o.podX + o.podW - tx;
  if (o.tubes) {
    // Torpedy: okrągłe wyrzutnie rurowe z pierścieniami.
    L.cylinder([px0, 0, 0], [px1, 0, 0], o.podH / 2, o.podH / 2, { seg: 16, mat: M.STEEL, capMat: M.DARK });
    for (const t of [0.15, 0.55, 0.92]) collar(L, px0 + (px1 - px0) * t, (px1 - px0) * 0.05, o.podH / 2 * 1.08, M.PANEL);
    L.box(px0 + (px1 - px0) * 0.1, 0, o.podH / 2 + 0.1, (px1 - px0) * 0.05, 1.2, 0.2, { mat: o.light, bottom: false });
  } else {
    canister(L, px0, px1, o.podH / 2 * 0.95, o.podH / 2 * o.depth, o.light, { bands: o.massive ? [0.2, 0.5, 0.8] : [0.28, 0.66] });
    if (o.taper) L.alongX(px1 - (px1 - px0) * 0.12, px1, rectPoly(-o.podH * 0.4, -o.podH * 0.35, o.podH * 0.4, o.podH * 0.35), { mat: M.STEEL, bevel: [0.2, 0.2] });
  }
  return { trunnion: [tx, tz], barrels: o.ports.map((y) => [y, 0]), muzzleX: px1, recoil: o.massive ? 0.6 : 0, light: 'amber', kind: 'missile', launcher: true, pitch: [0, 60], rest: 6 };
}

// ---------------------------------------------------------------------------
// Budowa modelu broni
// ---------------------------------------------------------------------------

const CACHE = new Map();

/**
 * Model broni (geometria części + układ). Wynik jest współdzielony (cache po rodzinie):
 * { family, label, parts: { ring, housing, barrel, spin } (MeshBuilder3D), trunnion, barrels,
 *   barrelShift, muzzleX, recoil, spin, pitch: [min, max] (°), launcher, kind, light }.
 * Jednostki LOKALNE wieży — mnożyć przez weapon3DScale(def).
 */
export function buildWeapon3D(family, o = {}) {
  const key = `${family}|${o.uvScale ?? 1}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const fn = FAMILIES[family];
  if (!fn) throw new Error(`nieznana rodzina broni 3D: ${family}`);
  const mk = () => new MeshBuilder3D({ uvScale: o.uvScale ?? 1 });
  const P = { R: mk(), H: mk(), L: mk(), S: mk() };
  const lay = fn(P);
  const model = Object.freeze({
    family,
    label: WEAPON3D_FAMILY_LABEL[family] || family,
    parts: { ring: P.R, housing: P.H, barrel: P.L, spin: P.S.vcount() > 0 ? P.S : null },
    trunnion: lay.trunnion,
    barrels: lay.barrels,
    barrelShift: lay.barrelShift || null,
    muzzleX: lay.muzzleX,
    recoil: lay.recoil ?? 1,
    spin: !!lay.spin,
    pitch: lay.pitch || [-8, 70],
    rest: lay.rest ?? 0,
    launcher: !!lay.launcher,
    kind: lay.kind || 'ballistic',
    light: lay.light || 'cyan'
  });
  CACHE.set(key, model);
  return model;
}

export const WEAPON3D_FAMILIES = Object.freeze(Object.keys(FAMILIES));
