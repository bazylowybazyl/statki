// src/data/fitPresets.js
//
// KONFIGURACJE OKRĘTU — karty zakładki WYPOSAŻENIE („click & fit”, docs/PLAN-fitowanie.md § 4.2). Decyzje użytkownika
// 2026-10-08: cztery karty UNIWERSALNA / BLISKI TANK / SNAJPER / RAKIETOWIEC + refit ręczny; w misji startowej komplety
// wszystkich kart leżą w hangarze gracza (przełączanie za darmo), potem karta kosztuje tylko BRAKUJĄCE części.
//
// Konfiguracja to PRZEPIS, nie lista sztuk: dla każdego typu gniazda lista preferencji broni (`want` — [id, ile] po
// kolei, od dziobu, pary lustrzane razem; `alt` — zastępstwa, gdy chcianej broni nie ma albo się nie mieści), moduł
// i system F. Automat (src/game/fitPlanner.js) liczy z niej plan na gniazdach DOWOLNEGO kadłuba gracza — rozmiar
// gniazda odsiewa broń, która się nie mieści (alt-y mają warianty S / M / L dla mniejszych kadłubów).
//
// Typy gniazd: main, special, missile, aux, hangar, special_missile, builtin. Moduł „Komory rakietowe” zamienia
// gniazda `special` na `missile` (typeMap w src/data/shipModules.js) — przepis RAKIETOWCA opisuje je pod kluczem
// `special` (tam leżą), a dobiera broń rakietową.

const COMMON = Object.freeze({
  special_missile: Object.freeze({ want: [['supernova_missile', 1]] }),
  builtin: Object.freeze({ want: [['hexlance_siege', 1]] })
});

// Bateria specjalna mniejszych kadłubów (fregata S, niszczyciel M, pancernik L) — jak autoMountDefaults.
const SPECIAL_BY_SIZE = Object.freeze(['special_yamato_l', 'special_valkyrie_m', 'special_valkyrie_s']);

export const FIT_PRESETS = Object.freeze({
  universal: Object.freeze({
    id: 'universal',
    name: 'UNIWERSALNA',
    accent: '#9fb7cf',
    role: 'wszystko po trochu · bateria do 7 km, działa do 6 km, rakiety, myśliwce',
    system: 'ram_burn',
    module: null,
    start: true,
    slots: Object.freeze({
      main: { want: [['tempest_ion_l', 15]], alt: ['railgun_mk2', 'railgun_mk1'] },
      special: { want: [['special_yamato_cannon', 6]], alt: SPECIAL_BY_SIZE },
      // 2× Cruise jak dawny CAMPAIGN_LOADOUT (kampania dokłada podwójny zapas salw — decyzja 2026-10-05).
      missile: { want: [['missile_rack', 2]], alt: ['grad_launcher', 'hydra_mirv', 'roj_pod'] },
      aux: { want: [['ciws_mk1', 6], ['flak_capital', 4], ['laser_pd_mk1', 2], ['ciws_mk2', 2]], alt: ['ciws_mk1', 'ciws_mk2', 'laser_pd_mk1'] },
      hangar: { want: [['fighter_squad_multirole', 6]] },
      ...COMMON
    })
  }),
  tank: Object.freeze({
    id: 'tank',
    name: 'BLISKI TANK',
    accent: '#ff6600',
    role: 'walka do 3,5 km · szarża zamyka dystans, tarcza wytrzymuje dolot',
    system: 'ram_burn',
    module: 'shield_booster',
    slots: Object.freeze({
      main: { want: [['heavy_autocannon_l', 15]], alt: ['armata_mk1', 'beam_pulse', 'heavy_autocannon', 'vulcan_minigun'] },
      special: { want: [['special_plasma_gatling', 6]], alt: ['special_goliath_autocannon', ...SPECIAL_BY_SIZE] },
      missile: { want: [['roj_pod', 2]], alt: ['grad_launcher'] },
      aux: { want: [['ciws_mk2', 8], ['ciws_mk1', 6]], alt: ['ciws_mk1', 'flak_capital', 'laser_pd_mk1'] },
      hangar: { want: [['fighter_squad_multirole', 6]] },
      ...COMMON
    })
  }),
  sniper: Object.freeze({
    id: 'sniper',
    name: 'SNAJPER',
    accent: '#3ea6ff',
    role: 'walka z 9–15 km działami snajperskimi · skok w bok przed salwą',
    system: 'maneuver',
    module: 'ballistic_computer',
    slots: Object.freeze({
      main: { want: [['lance_rail_l', 15]], alt: ['lance_rail_m'] },
      special: { want: [['special_valkyrie_railgun', 4], ['siege_railgun', 2]], alt: ['special_valkyrie_m', 'special_valkyrie_s'] },
      missile: { want: [['missile_rack', 2]], alt: ['hydra_mirv'] },
      aux: { want: [['flak_capital', 6], ['ciws_mk1', 6], ['ciws_mk2', 2]], alt: ['ciws_mk1', 'laser_pd_mk1'] },
      hangar: { want: [['fighter_squad_interceptor', 6]], alt: ['fighter_squad_multirole'] },
      ...COMMON
    })
  }),
  missile: Object.freeze({
    id: 'missile',
    name: 'RAKIETOWIEC',
    accent: '#ffaa33',
    role: 'salwy z 8 wyrzutni na 6–12 km · automat rakiet dzieli cele',
    system: 'maneuver',
    module: 'missile_cells',
    slots: Object.freeze({
      main: { want: [['railgun_mk2', 15]], alt: ['railgun_mk1'] },
      special: { want: [['missile_rack', 4], ['grad_launcher', 2]], alt: ['hydra_mirv', 'roj_pod'] },
      missile: { want: [['hydra_mirv', 2]], alt: ['missile_rack', 'grad_launcher'] },
      aux: { want: [['flak_capital', 6], ['ciws_mk1', 6], ['laser_pd_mk1', 2]], alt: ['ciws_mk2', 'ciws_mk1'] },
      hangar: { want: [['fighter_squad_strike', 6]], alt: ['fighter_squad_multirole'] },
      ...COMMON
    })
  })
});

/** Kolejność kart na ekranie. */
export const FIT_PRESET_IDS = Object.freeze(['universal', 'tank', 'sniper', 'missile']);
/** Karta startowa gry i kampanii (zastępuje dawny CAMPAIGN_LOADOUT). */
export const FIT_START_PRESET = 'universal';

// Komplety misji startowej (D2, plan § 5.2): pula wspólna — konfiguracje dzielą broń, więc zapas pokrywa najbardziej
// wymagającą z nich, nie sumę. Dokładane RAZ (`kitsGranted` w zapisie) do zapasu startowego DEFAULT_INVENTORY_STOCK.
export const FIT_KIT_STOCK = Object.freeze({
  tempest_ion_l: 15,
  heavy_autocannon_l: 15,
  special_plasma_gatling: 6,
  ciws_mk2: 6,
  lance_rail_l: 15,
  special_valkyrie_railgun: 4,
  siege_railgun: 2,
  flak_capital: 2
});
// Części spoza broni w kompletach: moduły i silniki manewrowe (system F MANEWR).
export const FIT_KIT_PARTS = Object.freeze({
  shield_booster: 1,
  ballistic_computer: 1,
  missile_cells: 1,
  maneuver: 1
});

export function fitPresetById(id) {
  return FIT_PRESETS[String(id || '')] || null;
}
