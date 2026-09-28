// dema/bronie-webgpu/arsenal.js
//
// Katalog broni dema: działa (Capital, L, M, S), obrona punktowa i lasery.
// Rakiety i torpedy są poza zakresem (osobne zadanie). Statystyki (prędkość,
// kadencja, rozrzut, lufy, zasięg, salwy flak) biorę z MASTER_WEAPONS gry, a
// dane wizualne (odrzut, wstrząs) z FX_PROFILE w src/vfx/turret2D.js.
//
// Pola:
//   fx      — rodzina receptury (recipes.js)
//   mount   — typ gniazda Atlasa: main | special | aux | builtin
//   pattern — sposób strzału: single | twin (obie lufy naraz) | alt (lufy na
//             zmianę) | yamato (3 lufy w odstępach) | salvo (flak: burstCount
//             pocisków naraz) | beam | charge (ładowanie → strzał)
//   charge  — czas ładowania [s] (Hexlance 1,2 s jak w grze; Mjolnir 3,0 s —
//             `chargeTime` z MASTER_WEAPONS, którego gra dziś nie czyta)
//   pd      — broń obrony punktowej: domyślnie strzela do dronów-celów

import { MASTER_WEAPONS } from '../../src/data/weapons.js';

// FX_PROFILE z src/vfx/turret2D.js (odrzut / wstrząs); warianty S/L jak rodzina.
const FX_PROFILE = {
  vulcan_minigun: [3.0, 2.0], helios_laser: [6.0, 3.0], railgun_mk1: [4.0, 2.5], railgun_mk2: [4.0, 2.5],
  armata_mk1: [12.0, 6.5], beam_continuous: [1.0, 1.5], beam_pulse: [6.0, 3.5],
  special_goliath_autocannon: [20.0, 10.0], special_plasma_gatling: [15.0, 8.0],
  special_valkyrie_railgun: [20.0, 12.0], special_yamato_cannon: [60.0, 20.0],
  heavy_autocannon: [8.0, 4.0], ciws_mk1: [1.5, 1.0], ciws_mk2: [1.5, 1.0], laser_pd_mk1: [0.5, 0.3],
  flak_s: [3.5, 1.8], flak_m: [5.0, 2.6], flak_l: [8.0, 4.2], flak_capital: [14.0, 7.5],
  siege_railgun: [120.0, 80.0], hexlance_siege: [0, 14],
  tempest_ion_s: [4.0, 2.5], tempest_ion_l: [4.0, 2.5], helios_laser_s: [6.0, 3.0], helios_lance_l: [6.0, 3.0],
  gatling_s: [3.0, 2.0], heavy_autocannon_l: [8.0, 4.0]
};

const E = (id, o) => {
  const def = MASTER_WEAPONS[id];
  if (!def) throw new Error(`Brak broni ${id} w MASTER_WEAPONS`);
  const [recoil, shake] = FX_PROFILE[id] || [3, 1.8];
  return { id, def, recoil, shake, ...o };
};

export const GROUPS = [
  {
    key: 'capital', label: 'CAPITAL / SPECJALNE', items: [
      E('special_yamato_cannon', { fx: 'yamato', mount: 'special', pattern: 'yamato', short: 'Yamato' }),
      E('hexlance_siege', { fx: 'hexlance', mount: 'builtin', pattern: 'charge', charge: 1.2, short: 'Hexlance' }),
      E('siege_railgun', { fx: 'mjolnir', mount: 'special', pattern: 'charge', charge: 3.0, short: 'Mjolnir' }),
      E('special_valkyrie_railgun', { fx: 'valkyrie', mount: 'special', pattern: 'charge', charge: 0.28, alt: true, short: 'Valkyrie' }),
      E('special_goliath_autocannon', { fx: 'goliath', mount: 'special', pattern: 'alt', short: 'Goliath' }),
      E('special_plasma_gatling', { fx: 'plasmaGatling', mount: 'special', pattern: 'single', short: 'Plasma Gatling' })
    ]
  },
  {
    key: 'L', label: 'L', items: [
      E('armata_mk1', { fx: 'armata', mount: 'main', pattern: 'single', short: 'Armata' }),
      E('tempest_ion_l', { fx: 'tempest', mount: 'main', pattern: 'single', short: 'Tempest L' }),
      E('helios_lance_l', { fx: 'helios', mount: 'main', pattern: 'alt', short: 'Helios Lance' }),
      E('heavy_autocannon_l', { fx: 'autocannon', mount: 'main', pattern: 'single', short: 'Autokanon L' })
    ]
  },
  {
    key: 'M', label: 'M', items: [
      E('railgun_mk1', { fx: 'tempest', mount: 'main', pattern: 'single', short: 'Tempest Mk I' }),
      E('railgun_mk2', { fx: 'tempest', mount: 'main', pattern: 'twin', short: 'Tempest Mk II' }),
      E('helios_laser', { fx: 'helios', mount: 'main', pattern: 'alt', short: 'Helios' }),
      E('vulcan_minigun', { fx: 'vulcan', mount: 'main', pattern: 'single', short: 'Vulcan' }),
      E('heavy_autocannon', { fx: 'autocannon', mount: 'main', pattern: 'single', short: 'Autokanon' }),
      E('beam_continuous', { fx: 'beamC', mount: 'main', pattern: 'beam', short: 'Wiązka ciągła' }),
      E('beam_pulse', { fx: 'beamP', mount: 'main', pattern: 'alt', short: 'Wiązka puls' })
    ]
  },
  {
    key: 'S', label: 'S', items: [
      E('tempest_ion_s', { fx: 'tempest', mount: 'main', pattern: 'single', short: 'Tempest S' }),
      E('helios_laser_s', { fx: 'helios', mount: 'main', pattern: 'alt', short: 'Helios S' }),
      E('gatling_s', { fx: 'vulcan', mount: 'main', pattern: 'single', short: 'Gatling S' })
    ]
  },
  {
    key: 'pd', label: 'OBRONA PUNKTOWA', items: [
      E('ciws_mk1', { fx: 'ciws', mount: 'aux', pattern: 'single', pd: true, short: 'CIWS Mk I' }),
      E('ciws_mk2', { fx: 'ciws', mount: 'aux', pattern: 'single', pd: true, short: 'CIWS Mk II' }),
      E('laser_pd_mk1', { fx: 'laserPD', mount: 'aux', pattern: 'pdbeam', pd: true, short: 'Helios PD' }),
      E('flak_s', { fx: 'flak', mount: 'aux', pattern: 'salvo', pd: true, short: 'Flak S' }),
      E('flak_m', { fx: 'flak', mount: 'aux', pattern: 'salvo', pd: true, short: 'Flak M' }),
      E('flak_l', { fx: 'flak', mount: 'aux', pattern: 'salvo', pd: true, short: 'Flak L' }),
      E('flak_capital', { fx: 'flak', mount: 'aux', pattern: 'salvo', pd: true, short: 'Flak Perun' })
    ]
  }
];

export const WEAPONS = GROUPS.flatMap((g) => g.items.map((w) => ({ ...w, group: g.key })));
export const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));

/** Skala efektu z rozmiaru broni (poza skalą wieżyczki) — S lżej, Capital ciężej. */
export const SIZE_POWER = Object.freeze({ S: 0.8, M: 1.0, L: 1.25, Capital: 1.6 });

/** Barwa HDR z hex (liniowo) × mnożnik. */
export function hexHdr(hex, k = 1) {
  const s = String(hex).replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s.slice(0, 6), 16);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return [lin((v >> 16) & 255) * k, lin((v >> 8) & 255) * k, lin(v & 255) * k];
}
