// src/data/weapons.js

/**
 * MASTER_WEAPONS - Ustandaryzowana baza uzbrojenia Super Capital
 * * Parametry:
 * - mountType: 'main', 'aux', 'missile', 'hangar', 'special' (gdzie można zamontować)
 * - category: 'rail', 'beam', 'plasma', 'autocannon', 'rocket', 'ciws', 'flak', 'superweapon' (dla renderera)
 * - size: 'S', 'M', 'L', 'Capital' (wymagany rozmiar hardpointu)
 * - baseRange: Twardy zasięg w jednostkach silnika (silnik sam wyliczy life pocisku: range/speed)
 * - cooldown: Czas między strzałami w sekundach
 */

export const MASTER_WEAPONS = {
  // ==========================================================================
  // BRONIE GŁÓWNE GRACZA (Main)
  // ==========================================================================
  railgun_mk1: { 
    id: 'railgun_mk1', name: 'Tempest Ion Mk I', mountType: 'main', category: 'rail', size: 'M',
    baseDamage: 8, baseRange: 1800, baseSpeed: 2500, cooldown: 0.12, spread: 0.02,
    penetration: 1, energyCost: 6, vfxColor: '#00ccff',
    barrelsPerShot: 1, model3D: 'tempest_ion', render3dOnly: true
  },
  railgun_mk2: { 
    id: 'railgun_mk2', name: 'Tempest Ion Mk II', mountType: 'main', category: 'rail', size: 'M',
    baseDamage: 10, baseRange: 1950, baseSpeed: 2700, cooldown: 0.12, spread: 0.018,
    penetration: 2, energyCost: 8, vfxColor: '#55deff',
    barrelsPerShot: 2, model3D: 'tempest_ion', render3dOnly: true
  },
  vulcan_minigun: { 
    id: 'vulcan_minigun', name: 'Vulcan Minigun', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 4, baseRange: 2000, baseSpeed: 4000, cooldown: 0.04, spread: 0.04,
    penetration: 0, energyCost: 5, vfxColor: '#ffaa00',
    model3D: 'vulcan_minigun', render3dOnly: true
  },
  helios_laser: { 
    id: 'helios_laser', name: 'Helios Laser', mountType: 'main', category: 'plasma', size: 'M',
    baseDamage: 12, baseRange: 3000, baseSpeed: 6000, cooldown: 0.18, spread: 0.01,
    penetration: 1, energyCost: 7, vfxColor: '#ff003c',
    model3D: 'helios_laser', render3dOnly: true
  },
  heavy_autocannon: { 
    id: 'heavy_autocannon', name: 'Heavy Autocannon', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 28, baseRange: 900, baseSpeed: 2100, cooldown: 0.16, spread: 0.04,
    penetration: 1, energyCost: 5, vfxColor: '#ffcc8a'
  },
  armata_mk1: { 
    id: 'armata_mk1', name: 'Armata Oblężnicza', mountType: 'main', category: 'armata', size: 'L',
    baseDamage: 150, baseRange: 4000, baseSpeed: 2500, cooldown: 0.8, spread: 0.005,
    explodeRadius: 140, energyCost: 14, vfxColor: '#ff5500',
    recoil: 15, shake: 8, impactScale: 1.0, barrelsPerShot: 1,
    model3D: 'armata_mk1', render3dOnly: true
  },
  beam_continuous: {
    id: 'beam_continuous', name: 'Laser Wiązkowy (Ciągły)', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 8, baseRange: 5000, baseSpeed: Infinity, cooldown: 0.05, spread: 0.0, duration: 0.06,
    penetration: 0, energyCost: 8, vfxColor: '#00ffcc',
    recoil: 1, shake: 1.5, impactScale: 0.4, beamMode: 'continuous', barrelsPerShot: 1,
    model3D: 'beam_continuous', render3dOnly: true
  },
  beam_pulse: {
    id: 'beam_pulse', name: 'Laser Wiązkowy (Puls)', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 45, baseRange: 5000, baseSpeed: Infinity, cooldown: 0.25, spread: 0.002, duration: 0.15,
    penetration: 1, energyCost: 10, vfxColor: '#ff003c',
    recoil: 6, shake: 3.5, impactScale: 0.7, beamMode: 'pulse', barrelsPerShot: 1,
    model3D: 'beam_pulse', render3dOnly: true
  },

  // ==========================================================================
  // OBRONA PUNKTOWA GRACZA (Aux)
  // ==========================================================================
  ciws_mk1: { 
    id: 'ciws_mk1', name: 'CIWS Mk I', mountType: 'aux', category: 'ciws', size: 'S',
    baseDamage: 12, baseRange: 600, baseSpeed: 900, cooldown: 0.06, spread: 0.05,
    energyCost: 2, vfxColor: '#8cffd0'
  },
  laser_pd_mk1: { 
    id: 'laser_pd_mk1', name: 'Helios PD Laser', mountType: 'aux', category: 'beam', size: 'S',
    baseDamage: 16, baseRange: 620, baseSpeed: Infinity, cooldown: 0.18, duration: 0.09, spread: 0.0,
    energyCost: 3, vfxColor: 'rgba(110,200,255,0.9)'
  },

  // ==========================================================================
  // ARSENAŁ NPC (Dawniej AISPACE_GUNS i AISPACE_GUNS_M)
  // ==========================================================================
  npc_laser_s: { 
    id: 'npc_laser_s', name: 'Light Laser', mountType: 'main', category: 'beam', size: 'S',
    baseDamage: 8, baseRange: 380, baseSpeed: Infinity, cooldown: 0.20, duration: 0.08, spread: 0.03,
    vfxColor: '#86f7ff' 
  },
  npc_pulse_s: { 
    id: 'npc_pulse_s', name: 'Pulse Blaster', mountType: 'main', category: 'plasma', size: 'S',
    baseDamage: 14, baseRange: 420, baseSpeed: 420, cooldown: 0.25, spread: 0.05,
    vfxColor: '#ffd36e' 
  },
  npc_rail_micro: { 
    id: 'npc_rail_micro', name: 'Micro Railgun', mountType: 'main', category: 'rail', size: 'S',
    baseDamage: 26, baseRange: 560, baseSpeed: 900, cooldown: 0.55, spread: 0.01,
    penetration: 1, vfxColor: '#c0b7ff' 
  },
  npc_gatling: { 
    id: 'npc_gatling', name: 'Gatling Gun', mountType: 'main', category: 'autocannon', size: 'S',
    baseDamage: 3, baseRange: 320, baseSpeed: 520, cooldown: 0.08, spread: 0.07,
    vfxColor: '#9fff75' 
  },
  npc_m_beam: { 
    id: 'npc_m_beam', name: 'Medium Beam', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 24, baseRange: 820, baseSpeed: Infinity, cooldown: 0.55, duration: 0.12, spread: 0.0,
    vfxColor: '#8fd8ff' 
  },
  npc_m_pulse: { 
    id: 'npc_m_pulse', name: 'Medium Pulse', mountType: 'main', category: 'plasma', size: 'M',
    baseDamage: 40, baseRange: 760, baseSpeed: 700, cooldown: 0.9, spread: 0.014,
    vfxColor: '#ffd98a' 
  },
  npc_m_autocannon: { 
    id: 'npc_m_autocannon', name: 'Medium Auto', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 22, baseRange: 680, baseSpeed: 780, cooldown: 0.31, spread: 0.02,
    vfxColor: '#b6ff9a' 
  },
  npc_h_beam: { 
    id: 'npc_h_beam', name: 'Heavy Beam', mountType: 'main', category: 'beam', size: 'L',
    baseDamage: 260, baseRange: 1100, baseSpeed: Infinity, cooldown: 4.5, duration: 0.20, spread: 0.0,
    vfxColor: '#ff0000' 
  },
  npc_h_rapid: { 
    id: 'npc_h_rapid', name: 'Rapid Laser L', mountType: 'main', category: 'plasma', size: 'L',
    baseDamage: 45, baseRange: 1300, baseSpeed: 900, cooldown: 0.20, spread: 0.017,
    vfxColor: '#00ff00' 
  },

  // ==========================================================================
  // OBRONA PUNKTOWA I FLAK NPC (Dawniej AISPACE_PD)
  // ==========================================================================
  npc_pd_mk1: { 
    id: 'npc_pd_mk1', name: 'PD Network', mountType: 'aux', category: 'ciws', size: 'S',
    baseDamage: 5, baseRange: 380, baseSpeed: 560, cooldown: 0.11, spread: 0.10,
    burstCount: 3, burstDelay: 0.04, vfxColor: '#8cffd0' 
  },
  npc_pd_laser: { 
    id: 'npc_pd_laser', name: 'PD Laser Net', mountType: 'aux', category: 'beam', size: 'S',
    baseDamage: 3, baseRange: 420, baseSpeed: Infinity, cooldown: 0.05, duration: 0.05, spread: 0.0,
    vfxColor: '#ff77ff' 
  },
  npc_flak_L: { 
    id: 'npc_flak_L', name: 'Flak Battery', mountType: 'aux', category: 'flak', size: 'M',
    baseDamage: 28, baseRange: 520, baseSpeed: 380, cooldown: 1.25, spread: 0.08,
    explodeRadius: 48, vfxColor: '#ffef8a' 
  },

  // ==========================================================================
  // RAKIETY (Dawniej AISPACE_MISSILES i missile_rack gracza)
  // ==========================================================================
  missile_rack: { 
    id: 'missile_rack', name: 'Standard Missile Rack', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 60, baseRange: 1500, baseSpeed: 400, cooldown: 2.5, ammo: 20,
    turnRate: 350, homingDelay: 0.25, vfxColor: '#ffbb77' 
  },
  npc_msl_af: { 
    id: 'npc_msl_af', name: 'AIM-3 Interceptor', mountType: 'missile', category: 'rocket', size: 'S',
    baseDamage: 45, baseRange: 1440, baseSpeed: 360, cooldown: 3.0, ammo: 4,
    turnRate: 600, homingDelay: 0.1, vfxColor: '#7cd7ff' 
  },
  npc_msl_as: { 
    id: 'npc_msl_as', name: 'ASM-6 Anti-Ship', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 120, baseRange: 1800, baseSpeed: 300, cooldown: 6.0, ammo: 8,
    turnRate: 320, homingDelay: 0.4, vfxColor: '#ffad7c' 
  },
  npc_msl_he: { 
    id: 'npc_msl_he', name: 'HET-4 Heavy', mountType: 'missile', category: 'rocket', size: 'L',
    baseDamage: 160, baseRange: 1400, baseSpeed: 280, cooldown: 8.0, ammo: 4,
    turnRate: 250, homingDelay: 0.6, vfxColor: '#ff7cf0' 
  },
  npc_msl_sw: { 
    id: 'npc_msl_sw', name: 'Swarm-8', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 18, baseRange: 1020, baseSpeed: 340, cooldown: 4.5, ammo: 16,
    turnRate: 550, homingDelay: 0.2, swarmCount: 6, spread: 0.3, vfxColor: '#b3ff7c' 
  },

  // ==========================================================================
  // HANGARY
  // ==========================================================================
  fighter_bay: { 
    id: 'fighter_bay', name: 'Fighter Bay', mountType: 'hangar', category: 'hangar', size: 'L',
    baseDamage: 0, baseRange: 0, baseSpeed: 0, cooldown: 30.0, energyCost: 5 
  },

  // ==========================================================================
  // SUPERBRONIE (Special)
  // ==========================================================================
  special_goliath_autocannon: {
    id: 'special_goliath_autocannon', name: 'Goliath Autocannon (Special)', mountType: 'special', category: 'autocannon', size: 'Capital',
    baseDamage: 45, baseRange: 2500, baseSpeed: 3500, cooldown: 0.10, spread: 0.03,
    penetration: 1, energyCost: 18, vfxColor: '#ff6600',
    recoil: 20, shake: 10, impactScale: 1.0,
    model3D: 'special_goliath_autocannon', render3dOnly: true
  },
  special_plasma_gatling: {
    id: 'special_plasma_gatling', name: 'Ion Plasma Gatling (Special)', mountType: 'special', category: 'plasma', size: 'Capital',
    baseDamage: 60, baseRange: 2000, baseSpeed: 2000, cooldown: 0.15, spread: 0.05,
    penetration: 1, energyCost: 22, vfxColor: '#00ffff',
    recoil: 15, shake: 8, impactScale: 1.5,
    model3D: 'special_plasma_gatling', render3dOnly: true
  },
  special_valkyrie_railgun: {
    id: 'special_valkyrie_railgun', name: 'Valkyrie Railgun (Special)', mountType: 'special', category: 'rail', size: 'Capital',
    baseDamage: 500, baseRange: 4000, baseSpeed: 15000, cooldown: 1.5, spread: 0.001,
    penetration: 3, energyCost: 40, vfxColor: '#ff00ff',
    recoil: 60, shake: 45, impactScale: 3.5,
    model3D: 'special_valkyrie_railgun', render3dOnly: true
  },
  hexlance_siege: { 
    id: 'hexlance_siege', name: 'Hexlance Siege Cannon', mountType: 'special', category: 'superweapon', size: 'Capital',
    baseDamage: 9999, baseRange: 12000, baseSpeed: 8000, cooldown: 4.0, chargeTime: 0.6,
    burstCount: 4, burstDelay: 0.25, energyCost: 150, vfxColor: '#d0eaff'
  }
};

// Ścieżki do ikon w interfejsie Mechanika
export const WEAPON_ICON_PATHS = {
  heavy_autocannon: 'assets/weapons/heavy_autocannon.svg',
  railgun_mk1: 'assets/weapons/railgun.svg',
  railgun_mk2: 'assets/weapons/railgun.svg',
  vulcan_minigun: 'assets/weapons/heavy_autocannon.svg',
  helios_laser: 'assets/weapons/railgun.svg',
  armata_mk1: 'assets/weapons/armata.svg',
  beam_continuous: 'assets/weapons/railgun.svg',
  beam_pulse: 'assets/weapons/railgun.svg',
  special_goliath_autocannon: 'assets/weapons/heavy_autocannon.svg',
  special_plasma_gatling: 'assets/weapons/railgun.svg',
  special_valkyrie_railgun: 'assets/weapons/railgun.svg',
  hexlance_siege: 'assets/weapons/supercapitalmain.png'
};
