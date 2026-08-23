// Katalog kadlubow dostepnych graczowi: statystyki, rozmiary renderu, ceny.
// Czyste dane sklejane z szablonow statkow — bez stanu gry.
//
// Trzy rzeczy przychodza z zewnatrz, bo powstaja dopiero w trakcie startu gry:
//   ships        — SHIPS po buildShipFrames()
//   basePhysics  — BASE_PLAYER_PHYSICS (z SHIP_PHYSICS)
//   baseProfile  — BASE_PLAYER_PROFILE (masa/kadlub/tarcza biezacego statku)
import {
  SUPPORT_SHIP_TEMPLATES as SUPPORT_SHIP_TEMPLATES_DATA,
  CAPITAL_SHIP_TEMPLATES as CAPITAL_SHIP_TEMPLATES_DATA,
  getHullRenderSize
} from './ships.js';
import { PLAYER_HULL_MARKET } from './playerHullMarket.js';
import { MEGAFREIGHTER_TRAIN_MODULES } from '../game/megafreighterTrain.js';
import terranFrigateImg from '../assets/ships/terranfrigate.png';
import terranDestroyerImg from '../assets/ships/terrandestroyer.png';
import terranBattleshipImg from '../assets/ships/terranbattleship.png';
import terranCarrierImg from '../assets/ships/terrancarrier.png';
import terranSupercapitalImg from '../assets/ships/terransupercapital.png';
import pirateFrigateImg from '../assets/ships/piratefrigate.png';
import pirateDestroyerImg from '../assets/ships/piratedestroyer.png';
import pirateBattleshipImg from '../assets/ships/piratebattleship.png';

export function createPlayerHullCatalog({ ships, basePhysics, baseProfile }) {
  const SHIPS = ships;
  const BASE_PLAYER_PHYSICS = basePhysics;
  const BASE_PLAYER_PROFILE = baseProfile;
  const marketCost = (id) => Math.max(0, Number(PLAYER_HULL_MARKET[id]?.cost) || 0);
  const atlas = CAPITAL_SHIP_TEMPLATES_DATA?.supercapital || {};
  const frigate = SUPPORT_SHIP_TEMPLATES_DATA?.frigate_pd || {};
  const destroyer = SUPPORT_SHIP_TEMPLATES_DATA?.destroyer || {};
  const battleship = SUPPORT_SHIP_TEMPLATES_DATA?.battleship || {};
  const carrier = CAPITAL_SHIP_TEMPLATES_DATA?.carrier || {};
  const supercapital = CAPITAL_SHIP_TEMPLATES_DATA?.supercapital || {};
  const megafreighter = CAPITAL_SHIP_TEMPLATES_DATA?.megafreighter || {};
  const atlasSize = getHullRenderSize('atlas');
  const corvusSize = getHullRenderSize('corvus');
  const frigateSize = getHullRenderSize('terran_frigate');
  const destroyerSize = getHullRenderSize('terran_destroyer');
  const battleshipSize = getHullRenderSize('terran_battleship');
  const carrierSize = getHullRenderSize('terran_carrier');
  const supercapitalSize = getHullRenderSize('terran_supercapital');
  const megafreighterSize = getHullRenderSize('megafreighter');
  return {
    atlas: {
      id: 'atlas',
      name: 'Atlas',
      role: 'Independent supercapital',
      cost: marketCost('atlas'),
      shipFrame: 'atlas',
      spriteSrc: "assets/capital_ship_rect_v1.png",
      size: { w: atlasSize.w, h: atlasSize.h },
      spriteScale: 1.0,
      cargoCap: BASE_PLAYER_PROFILE.cargoCap,
      hullMax: BASE_PLAYER_PROFILE.hullMax,
      shield: {
        max: BASE_PLAYER_PROFILE.shieldMax,
        regenRate: BASE_PLAYER_PROFILE.shieldRegen,
        regenDelay: BASE_PLAYER_PROFILE.shieldDelay
      },
      mass: Number(atlas?.mass),
      rammingMass: Number(atlas?.rammingMass),
      radius: atlasSize.radius,
      sensors: atlas?.sensors ? { ...atlas.sensors } : undefined,
      physics: { ...BASE_PLAYER_PHYSICS }
    },
    frigate: {
      id: 'frigate',
      name: 'Custos',
      role: 'Terra Nova frigate',
      cost: marketCost('frigate'),
      shipFrame: 'terran_frigate',
      spriteSrc: terranFrigateImg,
      size: { w: frigateSize.w, h: frigateSize.h },
      spriteScale: 1.0,
      cargoCap: 16,
      hullMax: Math.max(2200, Number(frigate?.stats?.hp) || 2200),
      shield: {
        max: Math.max(900, Number(frigate?.shield?.max) || 900),
        regenRate: Math.max(110, Number(frigate?.shield?.regenRate) || 110),
        regenDelay: Math.max(2.5, Number(frigate?.shield?.regenDelay) || 2.5)
      },
      mass: Number(frigate?.stats?.mass),
      rammingMass: Number(frigate?.stats?.rammingMass),
      radius: frigateSize.radius,
      sensors: frigate?.sensors ? { ...frigate.sensors } : undefined,
      physics: {
        speed: 720,
        reverseMult: 0.68,
        turnAccel: 16.0,
        maxTurnSpeed: 3.2,
        linearFriction: 0.997,  // v_max ≈ 4000 u/s
        angularFriction: 0.875,
        boostMult: 2.5
      }
    },
    corvus: {
      id: 'corvus',
      name: 'Corvus',
      role: 'Independent missile frigate',
      cost: marketCost('corvus'),
      shipFrame: 'corvus',
      spriteSrc: terranFrigateImg,
      size: { w: corvusSize.w, h: corvusSize.h },
      spriteScale: 1.0,
      cargoCap: 24,
      hullMax: 3000,
      shield: { max: 1600, regenRate: 145, regenDelay: 3.0 },
      mass: 12000,
      rammingMass: 1600,
      radius: corvusSize.radius,
      sensors: SHIPS.corvus?.sensors ? { ...SHIPS.corvus.sensors } : undefined,
      physics: {
        speed: 650,
        reverseMult: 0.64,
        turnAccel: 14.5,
        maxTurnSpeed: 2.9,
        linearFriction: 0.997,
        angularFriction: 0.88,
        boostMult: 2.35
      }
    },
    pirate_frigate: {
      id: 'pirate_frigate',
      name: 'Marauder',
      role: 'Captured pirate frigate',
      cost: marketCost('pirate_frigate'),
      shipFrame: 'pirate_frigate',
      spriteSrc: pirateFrigateImg,
      size: { w: frigateSize.w, h: frigateSize.h },
      spriteScale: 1.0,
      cargoCap: 12,
      hullMax: 2600,
      shield: { max: 700, regenRate: 95, regenDelay: 3.4 },
      mass: 9500,
      rammingMass: 1200,
      radius: frigateSize.radius,
      sensors: SHIPS.pirate_frigate?.sensors ? { ...SHIPS.pirate_frigate.sensors } : undefined,
      physics: {
        speed: 760,
        reverseMult: 0.72,
        turnAccel: 17.0,
        maxTurnSpeed: 3.35,
        linearFriction: 0.9968,
        angularFriction: 0.865,
        boostMult: 2.65
      }
    },
    destroyer: {
      id: 'destroyer',
      name: 'Hasta',
      role: 'Terra Nova destroyer',
      cost: marketCost('destroyer'),
      shipFrame: 'terran_destroyer',
      spriteSrc: terranDestroyerImg,
      size: { w: destroyerSize.w, h: destroyerSize.h },
      spriteScale: 1.0,
      cargoCap: 30,
      hullMax: Math.max(6200, Number(destroyer?.stats?.hp) || 6200),
      shield: {
        max: Math.max(2200, Number(destroyer?.shield?.max) || 2200),
        regenRate: Math.max(180, Number(destroyer?.shield?.regenRate) || 180),
        regenDelay: Math.max(3.5, Number(destroyer?.shield?.regenDelay) || 3.5)
      },
      mass: Number(destroyer?.stats?.mass),
      rammingMass: Number(destroyer?.stats?.rammingMass),
      radius: destroyerSize.radius,
      sensors: destroyer?.sensors ? { ...destroyer.sensors } : undefined,
      physics: {
        speed: 520,
        reverseMult: 0.58,
        turnAccel: 10.4,
        maxTurnSpeed: 2.35,
        linearFriction: 0.9973, // v_max ≈ 3200 u/s
        angularFriction: 0.89,
        boostMult: 2.2
      }
    },
    pirate_destroyer: {
      id: 'pirate_destroyer',
      name: 'Reaver',
      role: 'Captured pirate destroyer',
      cost: marketCost('pirate_destroyer'),
      shipFrame: 'pirate_destroyer',
      spriteSrc: pirateDestroyerImg,
      size: { w: destroyerSize.w, h: destroyerSize.h },
      spriteScale: 1.0,
      cargoCap: 22,
      hullMax: 6500,
      shield: { max: 1600, regenRate: 150, regenDelay: 4.0 },
      mass: 23000,
      rammingMass: 4600,
      radius: destroyerSize.radius,
      sensors: SHIPS.pirate_destroyer?.sensors ? { ...SHIPS.pirate_destroyer.sensors } : undefined,
      physics: {
        speed: 570,
        reverseMult: 0.62,
        turnAccel: 11.3,
        maxTurnSpeed: 2.5,
        linearFriction: 0.9971,
        angularFriction: 0.885,
        boostMult: 2.3
      }
    },
    battleship: {
      id: 'battleship',
      name: 'Bellator',
      role: 'Terra Nova battleship',
      cost: marketCost('battleship'),
      shipFrame: 'terran_battleship',
      spriteSrc: terranBattleshipImg,
      size: { w: battleshipSize.w, h: battleshipSize.h },
      spriteScale: 1.0,
      cargoCap: 40,
      hullMax: Math.max(14000, Number(battleship?.stats?.hp) || 14000),
      shield: {
        max: Math.max(7200, Number(battleship?.shield?.max) || 7200),
        regenRate: Math.max(260, Number(battleship?.shield?.regenRate) || 260),
        regenDelay: Math.max(4.2, Number(battleship?.shield?.regenDelay) || 4.2)
      },
      mass: Number(battleship?.stats?.mass),
      rammingMass: Number(battleship?.stats?.rammingMass),
      radius: battleshipSize.radius,
      sensors: battleship?.sensors ? { ...battleship.sensors } : undefined,
      physics: {
        speed: 340,
        reverseMult: 0.52,
        turnAccel: 6.8,
        maxTurnSpeed: 1.6,
        linearFriction: 0.9969, // v_max ≈ 1800 u/s
        angularFriction: 0.92,
        boostMult: 1.85
      }
    },
    pirate_battleship: {
      id: 'pirate_battleship',
      name: 'Iron Skull',
      role: 'Captured pirate battleship',
      cost: marketCost('pirate_battleship'),
      shipFrame: 'pirate_battleship',
      spriteSrc: pirateBattleshipImg,
      size: { w: battleshipSize.w, h: battleshipSize.h },
      spriteScale: 1.0,
      cargoCap: 32,
      hullMax: 15000,
      shield: { max: 5200, regenRate: 230, regenDelay: 4.8 },
      mass: 48000,
      rammingMass: 7600,
      radius: battleshipSize.radius,
      sensors: SHIPS.pirate_battleship?.sensors ? { ...SHIPS.pirate_battleship.sensors } : undefined,
      physics: {
        speed: 375,
        reverseMult: 0.56,
        turnAccel: 7.4,
        maxTurnSpeed: 1.72,
        linearFriction: 0.9967,
        angularFriction: 0.915,
        boostMult: 1.95
      }
    },
    carrier: {
      id: 'carrier',
      name: 'Citadella',
      role: 'Terra Nova fleet carrier',
      cost: marketCost('carrier'),
      shipFrame: 'terran_carrier',
      spriteSrc: terranCarrierImg,
      size: { w: carrierSize.w, h: carrierSize.h },
      spriteScale: 1.0,
      cargoCap: 80,
      hullMax: Math.max(42000, Number(carrier?.hull) || 42000),
      shield: {
        max: Math.max(28000, Number(carrier?.shield) || 28000),
        regenRate: Math.max(260, Number(carrier?.shieldRegen) || 260),
        regenDelay: Math.max(6, Number(carrier?.shieldDelay) || 6)
      },
      mass: Math.max(100000, Number(carrier?.mass) || 100000),
      rammingMass: Math.max(15000, Number(carrier?.rammingMass) || 15000),
      radius: carrierSize.radius,
      sensors: carrier?.sensors ? { ...carrier.sensors } : undefined,
      physics: {
        speed: 270,
        reverseMult: 0.46,
        turnAccel: 4.4,
        maxTurnSpeed: 1.05,
        linearFriction: 0.9972,
        angularFriction: 0.94,
        boostMult: 1.6
      }
    },
    supercapital: {
      id: 'supercapital',
      name: 'Colossus',
      role: 'Terra Nova supercapital',
      cost: marketCost('supercapital'),
      shipFrame: 'terran_supercapital',
      spriteSrc: terranSupercapitalImg,
      size: { w: supercapitalSize.w, h: supercapitalSize.h },
      spriteScale: 1.0,
      cargoCap: 120,
      hullMax: Math.max(85000, Number(supercapital?.hull) || 85000),
      shield: {
        max: Math.max(52000, Number(supercapital?.shield) || 52000),
        regenRate: Math.max(400, Number(supercapital?.shieldRegen) || 400),
        regenDelay: Math.max(8, Number(supercapital?.shieldDelay) || 8)
      },
      mass: Math.max(200000, Number(supercapital?.mass) || 200000),
      rammingMass: Math.max(800000, Number(supercapital?.rammingMass) || 800000),
      radius: supercapitalSize.radius,
      sensors: supercapital?.sensors ? { ...supercapital.sensors } : undefined,
      physics: {
        speed: 205,
        reverseMult: 0.42,
        turnAccel: 3.0,
        maxTurnSpeed: 0.72,
        linearFriction: 0.9976,
        angularFriction: 0.952,
        boostMult: 1.45
      }
    },
    megafreighter: {
      id: 'megafreighter',
      name: 'Megafreighter',
      role: 'Three-section rigid freight train',
      cost: marketCost('megafreighter'),
      shipFrame: 'megafreighter',
      spriteSrc: MEGAFREIGHTER_TRAIN_MODULES[0]?.spriteSrc || megafreighter?.profile?.spriteSrc,
      size: { w: megafreighterSize.w, h: megafreighterSize.h },
      spriteScale: 1.0,
      cargoCap: 600,
      hullMax: Math.max(160000, Number(megafreighter?.hull) || 160000),
      shield: { max: 0, regenRate: 0, regenDelay: 1 },
      mass: Math.max(900000, Number(megafreighter?.mass) || 900000),
      rammingMass: Math.max(900000, Number(megafreighter?.rammingMass) || 900000),
      radius: megafreighterSize.radius,
      sensors: megafreighter?.sensors ? { ...megafreighter.sensors } : undefined,
      physics: {
        speed: 230,
        reverseMult: 0.36,
        turnAccel: 3.2,
        maxTurnSpeed: 0.65,
        linearFriction: 0.998,
        angularFriction: 0.97,
        boostMult: 1.25
      }
    }
  };
}
