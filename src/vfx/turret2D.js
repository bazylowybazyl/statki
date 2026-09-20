// src/vfx/turret2D.js
//
// Wieżyczki rysowane na kanwie 2D zamiast siatek Three.js.
//
// Powód: modele 3D wieżyczek niosły w passie FG po kilka oświetlanych draw calli
// na broń, a przy zbliżeniu na flotę potrafiły spuchnąć klatkę na stałe (patrz
// historia `_detachContainer` w weapon3DSystem.js). Gra jest ortograficzna i
// patrzy z góry, więc wieżyczka i tak była płaską sylwetką — tutaj rysujemy ją
// wprost.
//
// Sylwetki proceduralne są wyprowadzone z geometrii builderów 3D (te same offsety luf,
// te same punkty wylotowe), żeby nie zmienić czytelności ani pozycji błysków.
// Błyski wylotowe, pociski, wiązki i trafienia ZOSTAJĄ w 3D — ten moduł oddaje
// im tylko pozycję wylotu przez `triggerShot`.
//
// Koszt rysowania: jedna macierz + 2–4 `fill(Path2D)` na wieżyczkę. Ścieżki są
// budowane RAZ na sylwetkę i cache'owane; per klatkę nie powstaje żadna geometria.
// Yamato, Tempest i CIWS w bliskim LOD używają współdzielonych atlasów (korpus + lufy).
// Zachowuje proceduralny fallback, daleki LOD i te same punkty wylotowe.

import { getEntityWeaponTier, WEAPON_TIER_SCALE } from '../data/ships.js';
import { YamatoSprite2D } from './yamatoSprite2D.js';
import { TempestSprite2D } from './tempestSprite2D.js';
import { CiwsSprite2D } from './ciwsSprite2D.js';
import { LauncherSprite2D } from './launcherSprite2D.js';
import { mountedWeaponRenderAngle } from '../game/weaponAim.js';

// Barwy odpowiadają materiałom Lambert z weapon3DSystem, rozjaśnione o ~1.6×,
// bo na kanwie nie ma oświetlenia sceny, które je podbijało.
const C = {
  base: '#5c6e8f',
  barrel: '#8b9cb8',
  armor: '#93a6c4',
  detailBlue: '#46647f',
  detailCyan: '#457077',
  detailRed: '#7a4954',
  detailAmber: '#7c6a4a'
};

// Skale przeniesione z weapon3DSystem — te same liczby, żeby wieżyczki nie
// zmieniły rozmiaru względem kadłubów.
const SCALE_BY_SIZE = Object.freeze({ Capital: 1.75, L: 1.02, M: 0.76, S: 0.52 });
const CATEGORY_TRIM = Object.freeze({
  beam: 0.94, ciws: 0.88, flak: 0.92, rocket: 0.82, torpedo: 0.90, default: 1.0
});

// LOD ekranowy. Wieżyczka mierzona w pikselach promienia sylwetki:
//  < HIDE_PX      — nie rysujemy wcale,
//  < BLOB_PX      — jeden prostokąt w barwie pancerza (1 fill),
//  wyżej          — pełna sylwetka.
const TURRET_HIDE_PX = 2.0;
const TURRET_BLOB_PX = 5.5;

function tunable(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const v = Number(window.DevTuning?.[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// ── Sylwetki ────────────────────────────────────────────────────────────────
// Format części:
//   ['r',  x, y, w, h, r]    prostokąt (zaokrąglony) wyśrodkowany w (x,y)
//   ['c',  x, y, r]          koło
//   ['p',  [[x,y], ...]]     wielokąt
//   ['ring', x, y, rOut, rIn] pierścień (torus widziany z góry)
// Grupa: { c: barwa, b: 1 gdy część cofa się z lufą, p: [części] }
// X = przód wieżyczki, Y = bok. Jednostki lokalne, przed `sizeMult`.

function hexPoly(radius, cx = 0, cy = 0) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * radius, cy + Math.sin(a) * radius]);
  }
  return pts;
}

function yamatoGun(s, gy, groups) {
  groups.barrel.p.push(['r', 6 + 5 * s, gy, 12 * s, 6 * s, 1]);
  groups.barrel.p.push(['r', 6 + 25 * s, gy, 40 * s, 8.5 * s, 2]);
  groups.detailCyan.p.push(['r', 6 + 26 * s, gy, 38 * s, 1.6 * s, 0.7]);
}

function buildYamatoSpec() {
  const groups = {
    armor: { c: C.armor, b: 0, p: [['c', 2, 0, 17], ['p', [[-14, -15], [8, -15], [20, 0], [8, 15], [-14, 15], [-20, 0]]]] },
    barrel: { c: C.barrel, b: 1, p: [] },
    detailCyan: { c: C.detailCyan, b: 1, p: [] }
  };
  yamatoGun(0.9, 6.75, groups);
  yamatoGun(1.0, 0, groups);
  yamatoGun(0.9, -6.75, groups);
  return {
    r: 58,
    g: [groups.armor, groups.barrel, groups.detailCyan],
    m: [[56, 6.75], [58, 0], [56, -6.75]]
  };
}

const SPECS = {
  vulcan: {
    r: 45,
    g: [
      { c: C.armor, b: 0, p: [['r', 5, 0, 26, 16, 3]] },
      { c: C.barrel, b: 1, p: [['r', 30, 0, 24, 8.4, 2]] },
      { c: C.detailAmber, b: 0, p: [['ring', 26, 0, 4.75, 3.25]] }
    ],
    m: [[45, 0]]
  },

  helios: {
    r: 47,
    g: [
      { c: C.armor, b: 0, p: [['r', 2, 0, 20, 22, 3]] },
      { c: C.barrel, b: 1, p: [['r', 29.5, 6, 35, 3.6, 1.6], ['r', 29.5, -6, 35, 3.6, 1.6]] },
      { c: C.detailRed, b: 1, p: [['r', 43, 0, 4, 15, 1]] }
    ],
    m: [[47, 6], [47, -6]]
  },

  armata: {
    r: 55,
    g: [
      { c: C.armor, b: 0, p: [['r', 3, 0, 26, 24, 4]] },
      { c: C.barrel, b: 1, p: [['r', 31.5, 6, 35, 2.6, 1.2], ['r', 31.5, -6, 35, 2.6, 1.2]] },
      { c: C.detailAmber, b: 1, p: [['c', 19, 0, 3], ['ring', 49, 0, 6, 4]] }
    ],
    m: [[55, 0]]
  },

  // beam_continuous → emiter z talerzem
  beamEmitter: {
    r: 48,
    g: [
      { c: C.armor, b: 0, p: [['r', 0, 0, 18, 20, 3], ['r', 20, 0, 24, 7, 3], ['c', 32, 0, 10]] },
      { c: C.detailCyan, b: 1, p: [['c', 36, 0, 3.2]] }
    ],
    m: [[48, 0]]
  },

  beamPulse: {
    r: 40,
    g: [
      { c: C.armor, b: 0, p: [['r', 5, 0, 20, 20, 3]] },
      { c: C.barrel, b: 1, p: [['r', 25, 6, 20, 3.4, 1.5], ['r', 25, -6, 20, 3.4, 1.5]] },
      { c: C.detailRed, b: 1, p: [['r', 33, 6, 5, 3.9, 1.8], ['r', 33, -6, 5, 3.9, 1.8]] }
    ],
    m: [[38, 6], [38, -6]]
  },

  tempest1: {
    r: 40,
    g: [
      { c: C.armor, b: 0, p: [['r', 2, 0, 18, 16, 3]] },
      { c: C.barrel, b: 1, p: [['r', 21, 0, 20, 9, 3]] },
      { c: C.detailCyan, b: 1, p: [['ring', 27, 0, 6, 4], ['r', 34, 0, 10, 2.4, 1]] }
    ],
    m: [[34, 0]]
  },

  tempest2: {
    r: 40,
    g: [
      { c: C.armor, b: 0, p: [['r', 2, 0, 18, 16, 3]] },
      { c: C.barrel, b: 1, p: [['r', 21, -5, 20, 9, 3], ['r', 21, 5, 20, 9, 3]] },
      { c: C.detailCyan, b: 1, p: [['ring', 27, -5, 6, 4], ['ring', 27, 5, 6, 4]] }
    ],
    m: [[34, -5], [34, 5]]
  },

  goliath: {
    r: 58,
    g: [
      { c: C.armor, b: 0, p: [['r', 4, 0, 30, 28, 4]] },
      { c: C.barrel, b: 1, p: [['r', 38, 7, 36, 9, 3], ['r', 38, -7, 36, 9, 3]] }
    ],
    m: [[58, 7], [58, -7]]
  },

  plasmaGatling: {
    r: 42,
    g: [
      { c: C.armor, b: 0, p: [['c', 2, 0, 15]] },
      { c: C.barrel, b: 1, p: [['r', 25, 6, 18, 7, 3], ['r', 25, -6, 18, 7, 3]] }
    ],
    m: [[42, 0]]
  },

  heavyAutocannon: {
    r: 42,
    g: [
      { c: C.armor, b: 0, p: [['c', 2, 0, 8], ['r', 6, 0, 16, 14, 3]] },
      { c: C.barrel, b: 1, p: [['r', 28, 0, 28, 7, 3]] }
    ],
    m: [[42, 0]]
  },

  ciws: {
    r: 24,
    g: [
      { c: C.armor, b: 0, p: [['r', 0, 0, 10, 10, 2], ['c', 0, 0, 6]] },
      { c: C.barrel, b: 1, p: [['r', 15, 0, 18, 5, 2.5]] }
    ],
    m: [[22, 0]]
  },

  flak: {
    r: 30,
    g: [
      { c: C.armor, b: 0, p: [['c', 0, 0, 10], ['r', 4, 0, 13, 16, 3], ['c', -1, -8, 4.5], ['c', -1, 8, 4.5]] },
      { c: C.barrel, b: 1, p: [['r', 17, -3.5, 16, 5, 2], ['r', 17, 3.5, 16, 5, 2], ['r', 26, -3.5, 4, 6.4, 1.5], ['r', 26, 3.5, 4, 6.4, 1.5]] },
      { c: C.detailAmber, b: 0, p: [['r', -1, 0, 3, 12, 1]] }
    ],
    m: [[29, -3.5], [29, 3.5]]
  },

  laserPD: {
    r: 19,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 10, 10, 2]] },
      { c: C.detailBlue, b: 1, p: [['r', 13, 0, 10, 5, 2.2]] }
    ],
    m: [[18, 0]]
  },

  missileRack: {
    r: 23,
    g: [
      { c: C.armor, b: 0, p: [['r', 4, 0, 20, 18, 3]] },
      { c: C.detailAmber, b: 0, p: [['r', 14, 0, 16, 14, 2]] }
    ],
    m: [[16, -5], [16, 0], [16, 5]]
  },

  siegeTorpedo: {
    r: 32,
    g: [
      { c: C.armor, b: 0, p: [['r', 0, 0, 24, 26, 3]] },
      { c: C.barrel, b: 1, p: [['r', 12, 7, 28, 11, 5], ['r', 12, -7, 28, 11, 5]] }
    ],
    m: [[30, 7], [30, -7]]
  },

  hexlance: {
    r: 52,
    g: [
      { c: C.armor, b: 0, p: [['p', hexPoly(17)]] },
      { c: C.barrel, b: 1, p: [['r', 30, 0, 40, 6, 2]] },
      { c: C.detailBlue, b: 1, p: [['r', 30, 0, 38, 4, 1.5], ['ring', 42, 0, 13.5, 10.5]] }
    ],
    m: [[52, 0]]
  },

  siegeRail: {
    r: 80,
    g: [
      { c: C.armor, b: 0, p: [['r', 0, 0, 28, 26, 4]] },
      { c: C.barrel, b: 1, p: [['r', 44, 5, 60, 4, 1.5], ['r', 44, -5, 60, 4, 1.5]] },
      { c: C.detailCyan, b: 1, p: [['r', 44, 0, 58, 3, 1.2]] }
    ],
    m: [[80, 0]]
  },

  // ── Awaryjne sylwetki po kategorii (odpowiednik createFallbackWeaponMesh) ──
  fbRail: {
    r: 36,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 18, 22, 3]] },
      { c: C.barrel, b: 1, p: [['r', 15, -5, 38, 3, 1.2], ['r', 15, 5, 38, 3, 1.2]] },
      { c: C.detailBlue, b: 1, p: [['r', 15, -5, 28, 1.2, 0.6], ['r', 15, 5, 28, 1.2, 0.6]] }
    ],
    m: [[36, 0]]
  },
  fbArmata: {
    r: 30,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 20, 24, 3]] },
      { c: C.barrel, b: 1, p: [['r', 14, 0, 28, 7, 3]] },
      { c: C.detailRed, b: 1, p: [['r', 16, 0, 20, 2, 1]] }
    ],
    m: [[30, 0]]
  },
  fbPlasma: {
    r: 30,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 20, 24, 3]] },
      { c: C.barrel, b: 1, p: [['r', 14, 0, 28, 7, 3]] },
      { c: C.detailBlue, b: 1, p: [['r', 16, 0, 20, 2, 1]] }
    ],
    m: [[30, 0]]
  },
  fbAutocannon: {
    r: 24,
    g: [
      { c: C.base, b: 0, p: [['c', 0, 0, 8]] },
      { c: C.barrel, b: 1, p: [['r', 11, 0, 22, 4, 2]] }
    ],
    m: [[24, 0]]
  },
  fbCiws: {
    r: 16,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 10, 10, 2]] },
      { c: C.barrel, b: 1, p: [['r', 7, 0, 14, 3, 1.5]] }
    ],
    m: [[16, 0]]
  },
  fbBeam: {
    r: 16,
    g: [
      { c: C.base, b: 0, p: [['r', 0, 0, 10, 10, 2]] },
      { c: C.detailBlue, b: 1, p: [['r', 7, 0, 14, 3, 1.5]] }
    ],
    m: [[16, 0]]
  },
  fbDefault: {
    r: 12,
    g: [{ c: C.base, b: 0, p: [['r', 0, 0, 14, 18, 3]] }],
    m: [[10, 0]]
  }
};

SPECS.yamato = buildYamatoSpec();

// Ta sama kolejność rozstrzygania co `createWeapon3DMesh`, żeby żadna broń nie
// zmieniła sylwetki przy przejściu na 2D.
function resolveSpec(weaponId, category) {
  const key = String(weaponId || '').toLowerCase();

  if (key === 'vulcan_minigun') return SPECS.vulcan;
  if (key === 'helios_laser') return SPECS.helios;
  if (key === 'armata_mk1') return SPECS.armata;
  if (key === 'beam_continuous') return SPECS.beamEmitter;
  if (key === 'beam_pulse') return SPECS.beamPulse;
  if (key === 'special_goliath_autocannon') return SPECS.goliath;
  if (key === 'special_plasma_gatling') return SPECS.plasmaGatling;
  if (key === 'special_valkyrie_railgun') return SPECS.tempest2;
  if (key === 'special_yamato_cannon') return SPECS.yamato;
  if (key === 'railgun_mk1' || key === 'tempest_ion_mk1') return SPECS.tempest1;
  if (key === 'railgun_mk2' || key === 'tempest_ion_mk2') return SPECS.tempest2;
  if (key === 'heavy_autocannon') return SPECS.heavyAutocannon;
  if (key === 'ciws_mk1') return SPECS.ciws;
  if (key === 'laser_pd_mk1') return SPECS.laserPD;
  if (key.startsWith('flak')) return SPECS.flak;
  if (key === 'missile_rack' || key === 'fast_missile_rack') return SPECS.missileRack;
  if (key === 'supernova_missile') return SPECS.siegeTorpedo;
  if (key === 'siege_torpedo' || key === 'siege_torpedo_mk2') return SPECS.siegeTorpedo;
  if (key === 'torpedo_salvo') return SPECS.missileRack;
  if (key === 'hexlance_siege') return SPECS.hexlance;
  if (key === 'siege_railgun') return SPECS.siegeRail;
  // Warianty rodzinne S/M/L (tempest_ion_s, helios_lance_l, gatling_s …).
  if (key.includes('tempest') || key.includes('railgun')) return key.includes('mk2') ? SPECS.tempest2 : SPECS.tempest1;
  if (key.includes('helios')) return SPECS.helios;
  if (key.includes('vulcan') || key.includes('gatling')) return SPECS.vulcan;
  if (key.includes('autocannon')) return SPECS.heavyAutocannon;
  if (key.includes('armata')) return SPECS.armata;
  if (key.includes('ciws')) return SPECS.ciws;

  const cat = String(category || '').toLowerCase();
  if (cat === 'rail') return SPECS.fbRail;
  if (cat === 'armata') return SPECS.fbArmata;
  if (cat === 'plasma') return SPECS.fbPlasma;
  if (cat === 'autocannon') return SPECS.fbAutocannon;
  if (cat === 'ciws') return SPECS.fbCiws;
  if (cat === 'beam') return SPECS.fbBeam;
  return SPECS.fbDefault;
}

// Odrzut i wstrząs — te same liczby co WEAPON_FX_PROFILE w weapon3DSystem.
const FX_PROFILE = {
  vulcan_minigun: { key: 'vulcan', recoil: 3.0, shake: 2.0 },
  helios_laser: { key: 'helios', recoil: 6.0, shake: 3.0 },
  railgun_mk1: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  railgun_mk2: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  armata_mk1: { key: 'armata', recoil: 12.0, shake: 6.5 },
  beam_continuous: { key: 'beam', recoil: 1.0, shake: 1.5 },
  beam_pulse: { key: 'beam', recoil: 6.0, shake: 3.5 },
  special_goliath_autocannon: { key: 'goliath', recoil: 20.0, shake: 10.0 },
  special_plasma_gatling: { key: 'plasmaGatling', recoil: 15.0, shake: 8.0 },
  special_valkyrie_railgun: { key: 'tempest', recoil: 20.0, shake: 12.0 },
  special_yamato_cannon: { key: 'yamato', recoil: 60.0, shake: 20.0 },
  tempest_ion_mk1: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  tempest_ion_mk2: { key: 'tempest', recoil: 4.0, shake: 2.5 },
  heavy_autocannon: { key: 'autocannon', recoil: 8.0, shake: 4.0 },
  ciws_mk1: { key: 'ciws', recoil: 1.5, shake: 1.0 },
  laser_pd_mk1: { key: 'laserPD', recoil: 0.5, shake: 0.3 },
  flak_s: { key: 'flak', recoil: 3.5, shake: 1.8 },
  flak_m: { key: 'flak', recoil: 5.0, shake: 2.6 },
  flak_l: { key: 'flak', recoil: 8.0, shake: 4.2 },
  flak_capital: { key: 'flak', recoil: 14.0, shake: 7.5 },
  missile_rack: { key: 'rocket', recoil: 4.0, shake: 2.0 },
  fast_missile_rack: { key: 'rocket', recoil: 3.0, shake: 1.5 },
  supernova_missile: { key: 'torpedo', recoil: 9.0, shake: 5.0 },
  siege_torpedo: { key: 'torpedo', recoil: 6.0, shake: 3.0 },
  siege_torpedo_mk2: { key: 'torpedo', recoil: 8.0, shake: 4.0 },
  torpedo_salvo: { key: 'torpedo', recoil: 5.0, shake: 2.5 },
  hexlance_siege: { key: 'hexlance', recoil: 30.0, shake: 15.0 },
  siege_railgun: { key: 'siegeRail', recoil: 120.0, shake: 80.0 }
};

// Barwy błysku wylotowego — przeniesione z `muzzleColor` builderów 3D.
const MUZZLE_COLOR = {
  vulcan: '#ffaa00', helios: '#ff003c', tempest: '#00ccff', armata: '#ff5500',
  beam: '#00ffcc', goliath: '#ff6600', plasmaGatling: '#00ffff', yamato: '#00ffff',
  autocannon: '#ffcc8a', ciws: '#8cffd0', flak: '#ffc258', laserPD: '#6ec8ff',
  rocket: '#ffbb77', torpedo: '#ff4444', hexlance: '#d0eaff', siegeRail: '#aaffff'
};

export function normalizeWeaponFxKey(weaponId) {
  const id = String(weaponId || '').toLowerCase();
  if (!id) return '';
  if (id.includes('vulcan')) return 'vulcan';
  if (id.includes('helios')) return 'helios';
  if (id.includes('tempest') || id === 'railgun_mk1' || id === 'railgun_mk2') return 'tempest';
  if (id.includes('armata') || id.includes('heavy_cannon')) return 'armata';
  if (id.includes('beam_continuous') || id.includes('beam_pulse')) return 'beam';
  if (id.includes('special_goliath')) return 'goliath';
  if (id.includes('special_plasma')) return 'plasmaGatling';
  if (id.includes('heavy_auto')) return 'autocannon';
  if (id.includes('ciws')) return 'ciws';
  if (id.includes('flak')) return 'flak';
  if (id.includes('laser_pd')) return 'laserPD';
  if (id.includes('fast_missile_rack')) return 'rocket';
  if (id.includes('supernova_missile')) return 'torpedo';
  if (id.includes('missile_rack')) return 'rocket';
  if (id.includes('siege_torpedo')) return 'torpedo';
  if (id.includes('torpedo_salvo')) return 'torpedo';
  if (id.includes('hexlance')) return 'hexlance';
  if (id.includes('siege_railgun')) return 'siegeRail';
  if (id.includes('special_valkyrie')) return 'tempest';
  if (id.includes('special_yamato')) return 'yamato';
  return id;
}

function fxProfileFor(weaponId) {
  const id = String(weaponId || '').toLowerCase();
  const direct = FX_PROFILE[id];
  if (direct) return direct;
  const key = normalizeWeaponFxKey(id);
  return { key, recoil: 3.0, shake: 1.8 };
}

// ── Kompilacja sylwetek do Path2D (raz na sylwetkę) ─────────────────────────

function addPart(path, part) {
  switch (part[0]) {
    case 'r': {
      const [, x, y, w, h, rad] = part;
      const r = Math.min(Number(rad) || 0, w * 0.5, h * 0.5);
      if (r > 0.01 && typeof path.roundRect === 'function') path.roundRect(x - w / 2, y - h / 2, w, h, r);
      else path.rect(x - w / 2, y - h / 2, w, h);
      break;
    }
    case 'c':
      path.moveTo(part[1] + part[3], part[2]);
      path.arc(part[1], part[2], part[3], 0, Math.PI * 2);
      break;
    case 'p': {
      const pts = part[1];
      if (!pts || pts.length < 3) break;
      path.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
      path.closePath();
      break;
    }
    case 'ring': {
      const [, x, y, rOut, rIn] = part;
      // Przeciwne kierunki → reguła nonzero wycina środek.
      path.moveTo(x + rOut, y);
      path.arc(x, y, rOut, 0, Math.PI * 2, false);
      path.moveTo(x + rIn, y);
      path.arc(x, y, rIn, Math.PI * 2, 0, true);
      break;
    }
    default:
      break;
  }
}

function compileSpec(spec) {
  if (spec.__layers) return spec.__layers;
  const layers = [];
  for (const group of spec.g) {
    if (!group?.p?.length) continue;
    const path = new Path2D();
    for (const part of group.p) addPart(path, part);
    layers.push({ color: group.c, path, barrel: group.b === 1 });
  }
  // Blob LOD: jeden prostokąt obejmujący sylwetkę, rysowany zamiast wszystkiego.
  const blob = new Path2D();
  const len = spec.r;
  addPart(blob, ['r', len * 0.42, 0, len * 0.95, Math.max(6, len * 0.42), 2]);
  spec.__layers = layers;
  spec.__blob = blob;
  return layers;
}

// ── Stan ────────────────────────────────────────────────────────────────────

// Rekordy widocznych wieżyczek zbierane w `sync`, konsumowane w `draw`.
// Pula obiektów: w bitwie idzie ich kilkaset na klatkę, nie chcemy alokacji.
const frameRecords = [];
let frameCount = 0;

// Stan odrzutu przeżywa klatki, więc trzyma się per encja per hardpoint.
const recoilByEntity = new WeakMap();

// Stabilny numer encji — pozwala złożyć tekstowy klucz wieżyczki, po którym
// wiązka ciągła odnajduje swoją lufę w kolejnych klatkach.
const entitySerials = new WeakMap();
let nextEntitySerial = 1;

function entitySerial(entity) {
  let n = entitySerials.get(entity);
  if (n === undefined) {
    n = nextEntitySerial++;
    entitySerials.set(entity, n);
  }
  return n;
}

// Indeks klucz → rekord, przebudowywany co klatkę razem z buforem rekordów.
const recordsByKey = new Map();

function getRecoilState(entity, uid) {
  let perEntity = recoilByEntity.get(entity);
  if (!perEntity) {
    perEntity = new Map();
    recoilByEntity.set(entity, perEntity);
  }
  let st = perEntity.get(uid);
  if (!st) {
    st = { housing: 0, barrel: 0, nextBarrel: 0, flash: 0 };
    perEntity.set(uid, st);
  }
  return st;
}

function pushRecord(entity, uid, weaponId, category, size, wx, wy, ang, scale) {
  let rec = frameRecords[frameCount];
  if (!rec) {
    rec = { entity: null, uid: '', key: '', spec: null, fxKey: '', weaponId: '', wx: 0, wy: 0, ang: 0, scale: 1, state: null };
    frameRecords[frameCount] = rec;
  }
  frameCount++;
  const profile = fxProfileFor(weaponId);
  rec.entity = entity;
  rec.uid = uid;
  rec.key = entitySerial(entity) + '|' + uid;
  recordsByKey.set(rec.key, rec);
  rec.spec = resolveSpec(weaponId, category);
  rec.fxKey = profile.key;
  rec.weaponId = String(weaponId || '');
  rec.wx = wx;
  rec.wy = wy;
  rec.ang = ang;
  rec.scale = scale;
  rec.state = getRecoilState(entity, uid);
  return rec;
}

function weaponScale(size, category) {
  const base = SCALE_BY_SIZE[String(size || '').trim()] || SCALE_BY_SIZE.M;
  const trim = CATEGORY_TRIM[String(category || '').toLowerCase()] || CATEGORY_TRIM.default;
  return base * trim;
}

function shouldRenderTurret(def) {
  if (!def) return false;
  const mountType = String(def.mountType || '').toLowerCase();
  if (mountType === 'hangar' || mountType === 'builtin') return false;
  return true;
}

function entityLocalScale(entity) {
  const sxRaw = Number(entity?.__hardpointScaleX);
  const syRaw = Number(entity?.__hardpointScaleY);
  const uniformRaw = Number(entity?.__hardpointScale);
  const uniform = Number.isFinite(uniformRaw) && uniformRaw > 0 ? uniformRaw : 1;
  return {
    x: Number.isFinite(sxRaw) && sxRaw > 0 ? sxRaw : uniform,
    y: Number.isFinite(syRaw) && syRaw > 0 ? syRaw : uniform
  };
}

let lastFxTimeSec = 0;

export const Turret2D = {
  enabled: true,

  /** Sylwetka dla danej broni — wystawione dla testów i podglądu w konsoli. */
  resolveSpec,

  // Pure geometry lookup: usable by simulation even offscreen or with VFX off.
  // The caller owns out; no render records, interpolation or recoil affect it.
  writeMuzzleOffset(entity, def, barrelIndex, out) {
    const spec = resolveSpec(def.id, def.category);
    const tier = getEntityWeaponTier(entity);
    const scale = weaponScale(def.size, def.category) * (WEAPON_TIER_SCALE[tier] || WEAPON_TIER_SCALE.Capital).turret;
    const muzzle = spec.m[Math.max(0, barrelIndex | 0) % spec.m.length];
    out.x = muzzle[0] * scale;
    out.y = muzzle[1] * scale;
    return out;
  },

  beginFrame() {
    frameCount = 0;
    recordsByKey.clear();
    const timeSec = (typeof performance !== 'undefined') ? performance.now() / 1000 : 0;
    const dt = lastFxTimeSec > 0 ? Math.max(0.001, Math.min(0.05, timeSec - lastFxTimeSec)) : (1 / 60);
    lastFxTimeSec = timeSec;
    this._dt = dt;
  },

  _dt: 1 / 60,

  /**
   * Zbiera wieżyczki jednej encji do bufora klatki. Wywoływane z hexShips3D
   * dla widocznych encji, z pozycją i kątem już zinterpolowanymi.
   */
  sync(entity, shipEx, shipEy, shipAngle, shipScale) {
    if (!this.enabled || !entity) return;
    // Taktyczna nakładka CIC zasłania świat — wieżyczek nie ma po co liczyć.
    // Sięgamy przez window, bo cicDisplay.js dotyka DOM już przy imporcie, a ten
    // moduł ma zostać czysty (test node importuje go bez przeglądarki).
    if (typeof window !== 'undefined' && window.CICDisplay?.active) return;

    const local = entityLocalScale(entity);
    const tier = getEntityWeaponTier(entity);
    const tierScale = (WEAPON_TIER_SCALE[tier] || WEAPON_TIER_SCALE.Capital).turret;
    const cosA = Math.cos(shipAngle);
    const sinA = Math.sin(shipAngle);

    const emit = (uid, def, localX, localY, angle, useHardpointScale) => {
      const psx = useHardpointScale ? local.x : (entity.isPlayer ? 1 : shipScale);
      const psy = useHardpointScale ? local.y : (entity.isPlayer ? 1 : shipScale);
      const lx = (Number(localX) || 0) * psx;
      const ly = (Number(localY) || 0) * psy;
      const wx = shipEx + lx * cosA - ly * sinA;
      const wy = shipEy + lx * sinA + ly * cosA;
      const scale = weaponScale(def.size, def.category) * tierScale;
      pushRecord(entity, uid, def.id, def.category, def.size, wx, wy, angle, scale);
    };

    if (entity.autoWeapons) {
      for (let i = 0; i < entity.autoWeapons.length; i++) {
        const w = entity.autoWeapons[i];
        const def = w?.def;
        if (!shouldRenderTurret(def) || !w.hpOffset || w.hpOffset.x == null || w.hpOffset.y == null) continue;
        emit(
          `npc_wep_${i}_${def.id || def.category || 'x'}`,
          def,
          w.hpOffset.x,
          w.hpOffset.y,
          w.visualAngle !== undefined ? w.visualAngle : shipAngle,
          true
        );
      }
      return;
    }

    if (!entity.isPlayer || !entity.weapons) return;

    const interp = (typeof window !== 'undefined' && entity === window.ship && window.__interpShipTurretAngles)
      ? window.__interpShipTurretAngles
      : null;
    const pick = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    const aimAlpha = (typeof window !== 'undefined' && Number.isFinite(window.__weaponAimAlpha))
      ? window.__weaponAimAlpha : 1;
    const ciwsInterp = Array.isArray(interp?.ciws) ? interp.ciws : null;

    const emitTurretBound = (list, prefix) => {
      for (let i = 0; i < list.length; i++) {
        const def = list[i]?.weapon;
        if (!shouldRenderTurret(def)) continue;
        const hp = list[i].hp?.pos || list[i].hp;
        if (!hp) continue;
        emit(
          `${prefix}_${i}_${def.id || def.category || 'x'}`,
          def,
          hp.x ?? 0,
          hp.y ?? 0,
          mountedWeaponRenderAngle(entity, list[i], aimAlpha),
          false
        );
      }
    };

    emitTurretBound(entity.weapons.main || [], 'p_main');

    const auxes = entity.weapons.aux || [];
    for (let i = 0; i < auxes.length; i++) {
      const def = auxes[i]?.weapon;
      if (!shouldRenderTurret(def)) continue;
      const c = entity.ciws?.[i];
      const hp = auxes[i].hp?.pos || auxes[i].hp;
      emit(
        `p_aux_${i}_${def.id || def.category || 'x'}`,
        def,
        hp?.x ?? c?.offset?.x ?? 0,
        hp?.y ?? c?.offset?.y ?? 0,
        pick(ciwsInterp?.[i], c?.angle !== undefined ? c.angle : shipAngle),
        false
      );
    }

    emitTurretBound(entity.weapons.missile || [], 'p_missile');
    emitTurretBound(entity.weapons.special || [], 'p_special');
    emitTurretBound(entity.weapons.special_missile || [], 'p_special_missile');
  },

  /**
   * Znajduje wieżyczkę, która oddała strzał (najbliższy punkt wylotowy do
   * podanego punktu w świecie), zadaje jej odrzut i zwraca dane dla błysku 3D.
   * Zwraca null, gdy żadna wieżyczka nie jest w tej klatce widoczna.
   */
  triggerShot(weaponKey, shotX, shotY) {
    if (!this.enabled || frameCount === 0) return null;

    let best = null;
    let bestDistSq = Infinity;
    let bestMuzzle = 0;

    for (let i = 0; i < frameCount; i++) {
      const rec = frameRecords[i];
      if (weaponKey && rec.fxKey !== weaponKey) continue;
      const muzzles = rec.spec.m;
      const cosA = Math.cos(rec.ang);
      const sinA = Math.sin(rec.ang);
      for (let m = 0; m < muzzles.length; m++) {
        const mx = muzzles[m][0] * rec.scale;
        const my = muzzles[m][1] * rec.scale;
        const wx = rec.wx + mx * cosA - my * sinA;
        const wy = rec.wy + mx * sinA + my * cosA;
        const dx = wx - shotX;
        const dy = wy - shotY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          best = rec;
          bestMuzzle = m;
        }
      }
    }

    if (!best) return null;

    const profile = fxProfileFor(best.weaponId);
    const st = best.state;
    const kick = Math.max(0.1, profile.recoil);
    st.housing = Math.min(st.housing + kick * 0.4, kick * 3.0);
    st.barrel = Math.max(st.barrel, kick);

    // Punkt wylotowy wybieramy cyklicznie, jeśli broń ma kilka luf, ale ten
    // najbliższy strzałowi ma pierwszeństwo — pociski wychodzą z właściwej lufy.
    const muzzles = best.spec.m;
    const idx = muzzles.length > 1 ? bestMuzzle : 0;
    st.nextBarrel = (idx + 1) % Math.max(1, muzzles.length);

    const cosA = Math.cos(best.ang);
    const sinA = Math.sin(best.ang);
    // Błysk przesuwamy lekko PRZED wylot: kanwa 2D leży nad warstwą WebGL, więc
    // płomień wyśrodkowany na wylocie byłby do połowy przykryty lufą.
    const forward = best.spec.r * 0.06 + 3;
    const mx = muzzles[idx][0] * best.scale + forward;
    const my = muzzles[idx][1] * best.scale;

    return {
      x: best.wx + mx * cosA - my * sinA,
      y: best.wy + mx * sinA + my * cosA,
      angle: best.ang,
      scale: best.scale,
      color: MUZZLE_COLOR[profile.key] || '#b8d7ff',
      shake: Math.max(0, profile.shake)
    };
  },

  /**
   * Uchwyt do wieżyczki najbliższej podanemu punktowi. Zwracany klucz jest
   * stabilny między klatkami (numer encji + uid hardpointu), więc wiązka ciągła
   * może po nim odnajdywać swoją lufę, dopóki wieżyczka jest widoczna.
   * Format: `<serial>|<uid>#<indeks lufy>`.
   */
  findTurretKey(x, y, weaponKey = '') {
    if (!this.enabled || frameCount === 0) return null;
    let bestKey = null;
    let bestDistSq = Infinity;

    for (let i = 0; i < frameCount; i++) {
      const rec = frameRecords[i];
      if (weaponKey && rec.fxKey !== weaponKey) continue;
      const muzzles = rec.spec.m;
      const cosA = Math.cos(rec.ang);
      const sinA = Math.sin(rec.ang);
      for (let m = 0; m < muzzles.length; m++) {
        const mx = muzzles[m][0] * rec.scale;
        const my = muzzles[m][1] * rec.scale;
        const dx = rec.wx + mx * cosA - my * sinA - x;
        const dy = rec.wy + mx * sinA + my * cosA - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestKey = rec.key + '#' + m;
        }
      }
    }
    return bestKey;
  },

  /**
   * Pozycja lufy dla klucza z `findTurretKey`, w tej klatce.
   * null, gdy wieżyczka zniknęła (encja martwa, kamera odjechała, CIC).
   */
  resolveMuzzle(turretKey) {
    if (!turretKey || frameCount === 0) return null;
    const hashAt = turretKey.lastIndexOf('#');
    if (hashAt < 0) return null;
    const rec = recordsByKey.get(turretKey.slice(0, hashAt));
    if (!rec) return null;
    const muzzles = rec.spec.m;
    const idx = Math.min(Math.max(0, Number(turretKey.slice(hashAt + 1)) || 0), muzzles.length - 1);
    const cosA = Math.cos(rec.ang);
    const sinA = Math.sin(rec.ang);
    const mx = muzzles[idx][0] * rec.scale;
    const my = muzzles[idx][1] * rec.scale;
    return {
      x: rec.wx + mx * cosA - my * sinA,
      y: rec.wy + mx * sinA + my * cosA
    };
  },

  /** Wygaszanie odrzutu. Wołane raz na klatkę, przed rysowaniem. */
  update(dt) {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(0.05, dt) : this._dt;
    for (let i = 0; i < frameCount; i++) {
      const st = frameRecords[i].state;
      if (!st) continue;
      if (st.housing > 0) st.housing = Math.max(0, st.housing - st.housing * 10 * step);
      if (st.barrel > 0) st.barrel = Math.max(0, st.barrel - st.barrel * 15 * step);
    }
  },

  /**
   * Rysuje wszystkie wieżyczki zebrane w tej klatce.
   * Cache Path2D lub atlas broni; zero budowy ścieżek i obrazów per klatkę.
   */
  draw(ctx, cam) {
    if (!this.enabled || frameCount === 0 || !ctx) return 0;
    const worldToScreen = (typeof window !== 'undefined') ? window.worldToScreen : null;
    if (!worldToScreen) return 0;

    const zoom = Math.max(0.0001, Number(cam?.zoom) || 1);
    const origin = worldToScreen(0, 0, cam);
    const ox = origin.x;
    const oy = origin.y;

    const hidePx = tunable('turretHidePx', TURRET_HIDE_PX);
    const blobPx = tunable('turretBlobPx', TURRET_BLOB_PX);

    // Zgrubny prostokąt widoku w pikselach ekranu — wieżyczki poza nim odpadają
    // przed jakimkolwiek ustawieniem macierzy.
    const vw = ctx.canvas?.width || 0;
    const vh = ctx.canvas?.height || 0;

    let drawn = 0;
    ctx.save();
    for (let i = 0; i < frameCount; i++) {
      const rec = frameRecords[i];
      const spec = rec.spec;
      const worldScale = rec.scale;
      const screenR = spec.r * worldScale * zoom;
      if (screenR < hidePx) continue;
      const layers = spec.__layers || compileSpec(spec);

      const sx = ox + rec.wx * zoom;
      const sy = oy + rec.wy * zoom;
      if (vw > 0 && (sx < -screenR * 2 || sy < -screenR * 2 || sx > vw + screenR * 2 || sy > vh + screenR * 2)) continue;

      const st = rec.state;
      const k = worldScale * zoom;
      const cosA = Math.cos(rec.ang);
      const sinA = Math.sin(rec.ang);
      const a = cosA * k, b = sinA * k, c = -sinA * k, d = cosA * k;

      if (screenR < blobPx) {
        ctx.setTransform(a, b, c, d, sx, sy);
        ctx.fillStyle = C.armor;
        ctx.fill(spec.__blob);
        drawn++;
        continue;
      }

      const barrelBack = st ? st.barrel : 0;
      const housingBack = st ? st.housing : 0;

      if ((spec === SPECS.missileRack || spec === SPECS.siegeTorpedo || spec === SPECS.fbDefault)
        && LauncherSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
        drawn++;
        continue;
      }

      if (spec === SPECS.ciws && CiwsSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
        drawn++;
        continue;
      }

      if (spec === SPECS.yamato && YamatoSprite2D.draw(ctx, a, b, c, d, sx, sy, housingBack, barrelBack)) {
        drawn++;
        continue;
      }

      if ((spec === SPECS.tempest1 || spec === SPECS.tempest2)
        && TempestSprite2D.draw(ctx, rec.weaponId, a, b, c, d, sx, sy, housingBack, barrelBack)) {
        drawn++;
        continue;
      }

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        // Odrzut: cała wieżyczka cofa się o `housing`, lufy dodatkowo o `barrel`.
        const back = housingBack + (layer.barrel ? barrelBack : 0);
        const e = sx - back * a;
        const f = sy - back * b;
        ctx.setTransform(a, b, c, d, e, f);
        ctx.fillStyle = layer.color;
        ctx.fill(layer.path);
      }
      drawn++;
    }
    // restore() cofa też macierz — kanwa wraca dokładnie w stan sprzed passa.
    ctx.restore();
    return drawn;
  },

  /** Liczba wieżyczek zebranych w tej klatce (dla perf HUD). */
  get frameCount() { return frameCount; },

  clear() {
    frameCount = 0;
    frameRecords.length = 0;
    recordsByKey.clear();
  }
};

if (typeof window !== 'undefined') window.Turret2D = Turret2D;
