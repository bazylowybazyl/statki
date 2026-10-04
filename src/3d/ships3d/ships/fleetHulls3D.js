// src/3d/ships3d/ships/fleetHulls3D.js
//
// SPECYFIKACJE MODELI 3D KADŁUBÓW FLOTY (budowa: fleetHull3D.js, obrysy: fleetOutlines3D.js).
//
// Wielokąty nadbudówek w PIKSELACH OBRAZKA sprite'a — jak edytor gniazd: środek płótna = 0,
// x ku dziobowi, y W DÓŁ obrazka (model odwraca y). `mirror` — też odbicie względem osi
// (axisY, px obrazka). Wysokości (z, keel.z, z1, bevel, zx) w jednostkach `hu` = px sprite'a
// na 1% szerokości kadłuba — pokład ~3 hu, nadbudówki 6–11 hu, dno kila −10…−15 hu (Atlas:
// pokład 3,9, cytadela 8,4, radiatory 11,8, kil −18,6).
//
// Bryła: { name, poly, z1, [z0], [bevel: [wys, odsunięcie] hu], [slope hu], [zx: [xa, za, xb, zb]
// — dach pochyły liniowo w x], [mirror], [wall, cap — materiał ścian / dachu], [clip] }.
// drums: [[x, y, r, h]] — okrągłe włazy wież (piraci): bęben na dachu pod punktem, r px, h hu.
// clip: true — bryła = wielokąt ∩ obrys sprite'a (kontury z generatora obrysów): zewnętrzne
// krawędzie idą dokładnie po rysunku, wielokąt wyznacza tylko granice wewnętrzne. Po zmianie
// wielokąta: node scripts/webgpu/obrysy-floty.mjs.

import { SHIP3D_MAT as M } from '../meshBuilder3D.js';

// Farby rodzin (ściany i fazy; dachy mają rysunek sprite'a).
const TERRAN_PALETTE = {
  [M.PAINT]: { color: '#b4b0a7', rough: 0.55, metal: 0.18 },
  [M.PANEL]: { color: '#8a867e', rough: 0.6, metal: 0.2 },
  [M.DARK]: { color: '#2b2a28', rough: 0.6, metal: 0.4 },
  [M.TRIM]: { color: '#3c3a37', rough: 0.5, metal: 0.3 }
};
const PIRATE_PALETTE = {
  [M.PAINT]: { color: '#3c3733', rough: 0.72, metal: 0.45 },
  [M.PANEL]: { color: '#4a392d', rough: 0.78, metal: 0.35 },
  [M.DARK]: { color: '#1c1917', rough: 0.7, metal: 0.45 },
  [M.STEEL]: { color: '#5a534d', rough: 0.6, metal: 0.55 },
  [M.TRIM]: { color: '#7c3521', rough: 0.7, metal: 0.25 }
};

// Cywilne kadłuby (frachtowce, ruch v2, megafrachtowiec): grafit z ciemniejszymi płytami.
const CIVIL_PALETTE = {
  [M.PAINT]: { color: '#4a4e55', rough: 0.62, metal: 0.4 },
  [M.PANEL]: { color: '#383b41', rough: 0.68, metal: 0.35 },
  [M.DARK]: { color: '#1d1f23', rough: 0.6, metal: 0.45 }
};

export const FLEET3D_PALETTES = Object.freeze({ terran: TERRAN_PALETTE, pirate: PIRATE_PALETTE, civil: CIVIL_PALETTE });

/** Farba wież (modele broni, weapons3D.js) na okrętach frakcji — piraci: ciemna, zardzewiała stal. */
export const FLEET3D_WEAPON_PALETTES = Object.freeze({
  pirate: {
    [M.STEEL]: { color: '#57504a', rough: 0.66, metal: 0.5 },
    [M.PANEL]: { color: '#433630', rough: 0.75, metal: 0.35 },
    [M.METAL]: { color: '#4a433e', rough: 0.4, metal: 0.8 },
    [M.BRIGHT]: { color: '#7e6f62', rough: 0.5, metal: 0.45 }
  }
});

/**
 * Klucz bryły przyciętej do obrysu (clip: true): wielokąt w px obrazka (po odbiciu). Generator
 * (scripts/webgpu/obrysy-floty.mjs) zapisuje nim przycięte kontury, builder je po nim znajduje —
 * zmiana wielokąta bez ponownego generowania to błąd budowy (nie cichy zły kształt).
 */
export function fleetClipKey(polyImg) {
  return polyImg.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(' ');
}

const mirrorY = true;

export const FLEET3D_SPECS = {
  // -------------------------------------------------------------------------
  // TERRA NOVA — niszczyciel Hasta (768 × 573 px, kadłub −339…316 × ±184)
  // Rufa: barki z godłem, szewron pod mostkiem, skrzynia rufowa; śródokręcie: burty z włazami
  // rakiet, kręgosłup; dziób: dwa kliny TERRA NOVA z rowem mechanizmów między nimi.
  // -------------------------------------------------------------------------
  terran_destroyer: {
    label: 'Hasta — niszczyciel Terra Nova', faction: 'terran', profile: 'terran_destroyer', editor: 'destroyer',
    bridge: 'hasta', tier: 'M', sprite: 'src/assets/ships/terrandestroyer.png',
    hu: 3.68,
    z: { belt: -3.2, deck: 3.2, bevel: 0.5 },
    keel: { s: 0.5, x: [-339, -290, -120, 150, 316], z: [-7, -11, -14, -7, -2.5] },
    pod: { z: 0 },
    mountR: { missile: 21 },
    blocks: [
      { name: 'barki rufy', mirror: mirrorY, z1: 10, bevel: [1.6, 1.4],
        poly: [[-275, -180], [-192, -180], [-187, -175], [-187, -80], [-250, -80], [-250, -118], [-303, -118]] },
      { name: 'szewron i kasztel mostka', z1: 9, bevel: [0.6, 0.6],
        poly: [[-263, -25], [-237, -80], [-187, -80], [-187, -45], [-118, -45], [-118, 45], [-187, 45], [-187, 80], [-237, 80], [-263, 25]] },
      { name: 'skrzynia rufowa', z1: 7, bevel: [0.7, 0.9],
        poly: [[-333, -38], [-266, -38], [-266, 38], [-333, 38]] },
      { name: 'ramiona', mirror: mirrorY, z1: 7, bevel: [0.5, 0.5],
        poly: [[-187, -176], [-101, -99], [-140, -99], [-187, -137]] },
      { name: 'burty', mirror: mirrorY, z1: 6.5, bevel: [0.5, 0.6],
        poly: [[-150, -98], [112, -98], [60, -44], [-150, -44]] },
      { name: 'kręgosłup', z1: 8, bevel: [0.5, 0.5],
        poly: [[-120, -21], [160, -21], [160, 21], [-120, 21]] },
      { name: 'kliny dziobowe', mirror: mirrorY, z1: 10, zx: [112, 10, 314, 5], bevel: [1.4, 1.2],
        poly: [[47, -21], [314, -21], [314, -30], [160, -93], [112, -93]] }
    ],
    windows: [
      { seg: [-145, -98, 104, -98], z: 4.9, step: 9, mirror: mirrorY, skip: 4 },
      { seg: [118, -93, 158, -93], z: 7.2, step: 8, mirror: mirrorY }
    ]
  },

  // -------------------------------------------------------------------------
  // TERRA NOVA — pancernik Bellator (1158 × 714 px, kadłub −576…579 × ±357)
  // -------------------------------------------------------------------------
  terran_battleship: {
    label: 'Bellator — pancernik Terra Nova', faction: 'terran', profile: 'terran_battleship', editor: 'battleship',
    bridge: 'bellator', tier: 'L', sprite: 'src/assets/ships/terranbattleship.png',
    hu: 7.14,
    z: { belt: -3, deck: 3, bevel: 0.5 },
    keel: { s: 0.62, x: [-576, -500, -200, 300, 579], z: [-6, -10, -13, -8, -3],
      half: [[-540, 0], [-540, -60], [-470, -200], [-250, -200], [-170, -130], [190, -130], [215, -230], [470, -200], [570, -120], [575, 0]] },
    pod: { z: 0 },
    mountR: { missile: 36 },
    // Rufa jak Hasta (×1,6), skrzydła TERRA NOVA na burtach (niesymetryczne — dolne dłuższe ku
    // rufie; prześwity z rurami między skrzydłem a kadłubem) i dwa kliny dziobowe z rowem.
    blocks: [
      { name: 'barki rufy', mirror: mirrorY, clip: true, z1: 10.5, bevel: [1.8, 1.6],
        poly: [[-480, -320], [-292, -320], [-278, -304], [-278, -138], [-400, -138], [-400, -194], [-480, -194]] },
      { name: 'szewron i kasztel mostka', z1: 9.5, bevel: [0.6, 0.6],
        poly: [[-414, -40], [-371, -137], [-278, -137], [-278, -52], [-160, -52], [-160, 52], [-278, 52], [-278, 137], [-371, 137], [-414, 40]] },
      { name: 'skrzynia rufowa', clip: true, z1: 7, bevel: [0.7, 0.9],
        poly: [[-560, -60], [-414, -60], [-414, 60], [-560, 60]] },
      { name: 'ramiona', mirror: mirrorY, z1: 7.5, bevel: [0.5, 0.5],
        poly: [[-278, -290], [-150, -168], [-200, -168], [-278, -236]] },
      { name: 'burty', mirror: mirrorY, clip: true, z1: 7, bevel: [0.5, 0.6],
        poly: [[-250, -154], [192, -154], [84, -72], [-250, -72]] },
      { name: 'kręgosłup', z1: 8.5, bevel: [0.5, 0.5],
        poly: [[-160, -42], [192, -42], [192, 42], [-160, 42]] },
      { name: 'klin dziobowy', mirror: mirrorY, clip: true, z1: 11, zx: [206, 11, 576, 7], bevel: [2.2, 2.0],
        poly: [[82, -42], [600, -42], [600, -330], [206, -330], [204, -156], [186, -156]] },
      { name: 'skrzydło górne', clip: true, z1: 10, bevel: [2.2, 2.0],
        poly: [[-150, -180], [165, -180], [165, -372], [-240, -372], [-240, -250]] },
      { name: 'skrzydło dolne', clip: true, z1: 10, bevel: [2.2, 2.0],
        poly: [[-150, 180], [165, 180], [165, 372], [-350, 372], [-350, 297], [-278, 297], [-240, 250]] }
    ],
    windows: [
      { seg: [-150, -42, 80, -42], z: 5.8, step: 14, mirror: mirrorY, skip: 5 },
      { seg: [206, -290, 450, -214], z: 8, step: 14, skip: 4 },
      { seg: [-340, 352, 20, 356], z: 6.5, step: 16, skip: 4 }
    ]
  },

  // -------------------------------------------------------------------------
  // TERRA NOVA — fregata Custos (2400 × 1792 px, kadłub −913…950 × −345…400)
  // Układ Hasty bez barków: rufa (blok z mostkiem), burty z włazami rakiet, kręgosłup z kratą
  // wentylacji, dwa kliny TERRA NOVA z rowem mechanizmów; dwie duże gondole.
  // -------------------------------------------------------------------------
  terran_frigate: {
    label: 'Custos — fregata Terra Nova', faction: 'terran', profile: 'terran_frigate', editor: 'frigate',
    bridge: 'custos', tier: 'S', sprite: 'src/assets/ships/terranfrigate.png',
    hu: 7.8,
    z: { belt: -3.2, deck: 3.2, bevel: 0.5 },
    keel: { s: 0.52, x: [-913, -800, -300, 600, 950], z: [-6, -10, -13, -7, -2.5] },
    pod: { z: 0 },
    mountR: { missile: 60 },
    blocks: [
      { name: 'rufa', clip: true, z1: 8.5, bevel: [1.4, 1.2],
        poly: [[-860, -370], [-528, -370], [-528, 420], [-860, 420]] },
      { name: 'kasztel mostka', z1: 10, bevel: [0.6, 0.6],
        poly: [[-790, -112], [-335, -112], [-335, 112], [-790, 112]] },
      { name: 'burty', mirror: mirrorY, clip: true, z1: 7, bevel: [0.5, 0.6],
        poly: [[-528, -300], [352, -300], [190, -126], [-528, -126]] },
      { name: 'kręgosłup', z1: 8, bevel: [0.5, 0.5],
        poly: [[-335, -75], [470, -75], [470, 75], [-335, 75]] },
      { name: 'kliny dziobowe', mirror: mirrorY, clip: true, z1: 10, zx: [348, 10, 960, 5], bevel: [1.4, 1.2],
        poly: [[140, -74], [1000, -74], [1000, -340], [362, -340], [349, -293]] }
    ],
    windows: [
      { seg: [-320, -75, 130, -75], z: 5.6, step: 30, mirror: mirrorY, skip: 4 }
    ]
  },

  // -------------------------------------------------------------------------
  // PIRACI — pancernik Iron Skull (1727 × 911 px)
  // Rufa: cztery silniki (bęben + obudowa do kadłuba), bloki z czerwonym pasem i włazami wież,
  // listwy burt z kolcami, kasztel z czaszką pod mostkiem; śródokręcie z wentylacją, płyta
  // IRON SKULL, ośmioboki wież dziobowych, dziób-taran z pazurami (kolce).
  // -------------------------------------------------------------------------
  pirate_battleship: {
    label: 'Iron Skull — pancernik piratów', faction: 'pirate', profile: 'pirate_battleship', editor: 'pirate_battleship',
    bridge: 'ironskull', tier: 'L', sprite: 'src/assets/ships/piratebattleship.png',
    hu: 7.6,
    z: { belt: -3, deck: 3, bevel: 0.5 },
    keel: { s: 0.55, x: [-800, -560, -100, 500, 860], z: [-6, -11, -14, -8, -3] },
    pod: { z: 0 },
    blocks: [
      { name: 'bloki rufowe', mirror: mirrorY, clip: true, z1: 9, bevel: [0.7, 0.8],
        poly: [[-560, -320], [-226, -320], [-142, -237], [-142, -110], [-490, -110], [-560, -170]] },
      { name: 'listwy burt', mirror: mirrorY, clip: true, z1: 6.5, bevel: [0.5, 0.6],
        poly: [[-560, -450], [-150, -450], [-150, -321], [-560, -321]] },
      { name: 'kasztel z czaszką', z1: 9.5, bevel: [0.7, 0.8],
        poly: [[-445, -75], [-185, -75], [-185, 75], [-445, 75]] },
      { name: 'skrzynia rufowa', clip: true, z1: 7, bevel: [0.6, 0.7],
        poly: [[-640, -62], [-445, -62], [-445, 62], [-640, 62]] },
      { name: 'śródokręcie', mirror: mirrorY, clip: true, z1: 7.5, bevel: [0.6, 0.6],
        poly: [[-150, -310], [205, -310], [205, -100], [-150, -100]] },
      { name: 'płyta IRON SKULL', z1: 8, bevel: [0.5, 0.6],
        poly: [[12, -70], [338, -70], [338, 65], [12, 65]] },
      { name: 'ośmioboki wież', mirror: mirrorY, z1: 9.5, bevel: [0.7, 0.7],
        poly: [[228, -248], [358, -248], [396, -214], [396, -132], [358, -102], [228, -102], [206, -124], [206, -226]] },
      { name: 'dziób', clip: true, z1: 9, zx: [396, 9, 720, 5], bevel: [0.7, 0.8],
        poly: [[396, -300], [720, -300], [720, 300], [396, 300]] }
    ],
    drums: [[-240, -195, 58, 1.6], [-240, 195, 58, 1.6], [310, -195, 58, 1.6], [310, 195, 58, 1.6], [565, 0, 64, 1.6]]
  },

  // -------------------------------------------------------------------------
  // PIRACI — niszczyciel (1840 × 854 px)
  // Rufa: trzy silniki, bloki z czerwonym pasem i włazami, kasztel z czaszką; śródokręcie
  // z wentylacją, płyta IRON SKULL, ośmioboki wież, dziób-taran z pazurami.
  // -------------------------------------------------------------------------
  pirate_destroyer: {
    label: 'Niszczyciel piratów', faction: 'pirate', profile: 'pirate_destroyer', editor: 'pirate_destroyer',
    bridge: 'pirate_destroyer', tier: 'M', sprite: 'src/assets/ships/piratedestroyer.png',
    hu: 6.4,
    z: { belt: -3, deck: 3, bevel: 0.5 },
    keel: { s: 0.55, x: [-880, -560, -100, 500, 870], z: [-6, -11, -14, -8, -3] },
    pod: { z: 0 },
    blocks: [
      { name: 'bloki rufowe', mirror: mirrorY, clip: true, z1: 9, bevel: [0.7, 0.8],
        poly: [[-590, -370], [-290, -370], [-235, -300], [-235, -128], [-590, -128]] },
      { name: 'kasztel z czaszką', z1: 10, bevel: [0.7, 0.8],
        poly: [[-520, -80], [-490, -112], [-280, -112], [-246, -80], [-246, 80], [-280, 112], [-490, 112], [-520, 80]] },
      { name: 'skrzynia rufowa', clip: true, z1: 7, bevel: [0.6, 0.7],
        poly: [[-600, -95], [-516, -95], [-516, 95], [-600, 95]] },
      { name: 'śródokręcie', mirror: mirrorY, clip: true, z1: 7.5, bevel: [0.6, 0.6],
        poly: [[-235, -250], [210, -250], [210, -96], [-235, -96]] },
      { name: 'płyta IRON SKULL', z1: 8, bevel: [0.5, 0.6],
        poly: [[-80, -66], [282, -66], [282, 72], [-80, 72]] },
      { name: 'ośmioboki wież', mirror: mirrorY, clip: true, z1: 9, bevel: [0.7, 0.7],
        poly: [[208, -240], [352, -240], [352, -68], [208, -68]] },
      { name: 'dziób', clip: true, z1: 8.5, zx: [352, 8.5, 690, 5], bevel: [0.7, 0.8],
        poly: [[352, -280], [690, -280], [690, 280], [352, 280]] }
    ],
    drums: [[-320, -190, 58, 1.6], [-320, 185, 58, 1.6], [272, -145, 60, 1.6], [272, 132, 60, 1.6], [590, 0, 66, 1.6]]
  },

  // -------------------------------------------------------------------------
  // PIRACI — fregata (1942 × 809 px, oś kadłuba y = +22 px obrazka)
  // Rufa: dwa silniki, bloki z czerwonym pasem i włazami, kasztel z kolczastą kulą (mostek);
  // śródokręcie: skrzynki wentylacji, płyta IRON SKULL z rurami po bokach; dziób z włazem.
  // -------------------------------------------------------------------------
  pirate_frigate: {
    label: 'Fregata piratów', faction: 'pirate', profile: 'pirate_frigate', editor: 'pirate_frigate',
    bridge: 'pirate_frigate', tier: 'S', sprite: 'src/assets/ships/piratefrigate.png',
    hu: 5.6, axisY: 22,
    z: { belt: -3, deck: 3, bevel: 0.5 },
    keel: { s: 0.55, x: [-870, -640, -300, 500, 900], z: [-6, -11, -13, -8, -3] },
    pod: { z: 0 },
    blocks: [
      { name: 'bloki rufowe', mirror: mirrorY, clip: true, z1: 8.5, bevel: [0.7, 0.8],
        poly: [[-600, -290], [-270, -290], [-222, -215], [-222, -92], [-600, -92]] },
      { name: 'kasztel', clip: true, z1: 9, bevel: [0.7, 0.8],
        poly: [[-680, -48], [-590, -84], [-300, -84], [-300, 128], [-590, 128], [-680, 92]] },
      { name: 'skrzynki wentylacji', mirror: mirrorY, z1: 7, bevel: [0.5, 0.5],
        poly: [[-160, -150], [-40, -150], [-40, -46], [-160, -46]] },
      { name: 'blok środkowy', z1: 7.5, bevel: [0.5, 0.5],
        poly: [[-250, -88], [-156, -88], [-156, 132], [-250, 132]] },
      { name: 'płyta IRON SKULL', z1: 7.5, bevel: [0.5, 0.6],
        poly: [[-60, -38], [290, -38], [290, 80], [-60, 80]] },
      { name: 'dziób', clip: true, z1: 8.5, zx: [362, 8.5, 680, 5], bevel: [0.7, 0.8],
        poly: [[362, -200], [680, -200], [680, 244], [362, 244]] }
    ],
    drums: [[-355, -165, 66, 1.6], [-355, 209, 66, 1.6], [545, 20, 72, 1.6]]
  }
};

// Corvus (kadłub gracza z katalogu) — sprite Custosa w skali profilu `corvus` (360 × 0,6).
FLEET3D_SPECS.corvus = {
  ...FLEET3D_SPECS.terran_frigate,
  label: 'Corvus — fregata rakietowa (kadłub Custosa)', profile: 'corvus', outlineOf: 'terran_frigate'
};
