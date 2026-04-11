// src/data/weapons.js

/**
 * MASTER_WEAPONS - Ustandaryzowana baza uzbrojenia Super Capital
 * * Parametry:
 * - mountType: 'main', 'aux', 'missile', 'hangar', 'special', 'builtin' (gdzie można zamontować)
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
    baseDamage: 8, baseRange: 10000, baseSpeed: 7000, cooldown: 0.12, spread: 0.02,
    penetration: 1, energyCost: 6, vfxColor: '#00ccff',
    barrelsPerShot: 1, model3D: 'tempest_ion', render3dOnly: true
  },
  railgun_mk2: { 
    id: 'railgun_mk2', name: 'Tempest Ion Mk II', mountType: 'main', category: 'rail', size: 'M',
    baseDamage: 10, baseRange: 14000, baseSpeed: 8000, cooldown: 0.12, spread: 0.018,
    penetration: 2, energyCost: 8, vfxColor: '#55deff',
    barrelsPerShot: 2, model3D: 'tempest_ion', render3dOnly: true
  },
  vulcan_minigun: { 
    id: 'vulcan_minigun', name: 'Vulcan Minigun', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 4, baseRange: 5000, baseSpeed: 4000, cooldown: 0.04, spread: 0.04,
    penetration: 0, energyCost: 5, vfxColor: '#ffaa00',
    model3D: 'vulcan_minigun', render3dOnly: true
  },
  helios_laser: { 
    id: 'helios_laser', name: 'Helios Laser', mountType: 'main', category: 'plasma', size: 'M',
    baseDamage: 12, baseRange: 15000, baseSpeed: 10000, cooldown: 0.18, spread: 0.01,
    penetration: 1, energyCost: 7, vfxColor: '#ff003c',
    model3D: 'helios_laser', render3dOnly: true
  },
  heavy_autocannon: { 
    id: 'heavy_autocannon', name: 'Heavy Autocannon', mountType: 'main', category: 'autocannon', size: 'M',
    baseDamage: 28, baseRange: 7000, baseSpeed: 3000, cooldown: 0.16, spread: 0.04,
    penetration: 1, energyCost: 5, vfxColor: '#ffcc8a'
  },
  armata_mk1: { 
    id: 'armata_mk1', name: 'Armata Oblężnicza', mountType: 'main', category: 'armata', size: 'L',
    baseDamage: 150, baseRange: 7000, baseSpeed: 2500, cooldown: 0.8, spread: 0.005,
    explodeRadius: 140, energyCost: 14, vfxColor: '#ff5500',
    recoil: 15, shake: 8, impactScale: 1.0, barrelsPerShot: 1,
    model3D: 'armata_mk1', render3dOnly: true
  },
  beam_continuous: {
    id: 'beam_continuous', name: 'Laser Wiązkowy (Ciągły)', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 8, baseRange: 6000, baseSpeed: Infinity, cooldown: 0.05, spread: 0.0, duration: 0.06,
    penetration: 0, energyCost: 8, vfxColor: '#00ffcc',
    recoil: 1, shake: 1.5, impactScale: 0.4, beamMode: 'continuous', barrelsPerShot: 1,
    model3D: 'beam_continuous', render3dOnly: true
  },
  beam_pulse: {
    id: 'beam_pulse', name: 'Laser Wiązkowy (Puls)', mountType: 'main', category: 'beam', size: 'M',
    baseDamage: 45, baseRange: 6000, baseSpeed: Infinity, cooldown: 0.25, spread: 0.002, duration: 0.15,
    penetration: 1, energyCost: 10, vfxColor: '#ff003c',
    recoil: 6, shake: 3.5, impactScale: 0.7, beamMode: 'pulse', barrelsPerShot: 1,
    model3D: 'beam_pulse', render3dOnly: true
  },

  // ==========================================================================
  // OBRONA PUNKTOWA GRACZA (Aux)
  // ==========================================================================
  ciws_mk1: { 
    id: 'ciws_mk1', name: 'CIWS Mk I', mountType: 'aux', category: 'ciws', size: 'S',
    baseDamage: 12, baseRange: 5500, baseSpeed: 2000, cooldown: 0.06, spread: 0.05,
    energyCost: 2, vfxColor: '#8cffd0'
  },
  laser_pd_mk1: { 
    id: 'laser_pd_mk1', name: 'Helios PD Laser', mountType: 'aux', category: 'beam', size: 'S',
    baseDamage: 16, baseRange: 4500, baseSpeed: Infinity, cooldown: 0.18, duration: 0.09, spread: 0.0,
    energyCost: 3, vfxColor: 'rgba(110,200,255,0.9)'
  },

  // ==========================================================================
  // RAKIETY
  // ==========================================================================
  missile_rack: { 
    id: 'missile_rack', name: 'Cruise Missile Rack', mountType: 'missile', category: 'rocket', size: 'M',
    baseDamage: 90, baseRange: 24000, baseSpeed: 1800, cooldown: 2.5, ammo: 20,
    turnRate: 420, homingDelay: 0.2, explosionRadius: 72, vfxColor: '#ffbb77' 
  },
  fast_missile_rack: {
    id: 'fast_missile_rack', name: 'Fast Missile Rack', mountType: 'missile', category: 'rocket', size: 'S',
    baseDamage: 55, baseRange: 12000, baseSpeed: 3200, cooldown: 1.6, ammo: 28,
    turnRate: 920, homingDelay: 0.08, explosionRadius: 42, vfxColor: '#ffd27a',
    bodyScale: 0.56, exhaustScale: 0.6, fireScale: 0.58, smokeScale: 0.55, explosionVisualScale: 0.72,
    proximityRadius: 58, terminalRadius: 150, reacquireRadius: 420,
    reacquireTurnMultiplier: 2.75, reacquireSpeedFactor: 0.5, terminalSpeedFactor: 0.62,
    leadHorizon: 0.3, terminalLeadHorizon: 0.04,
    description: 'Short-range high-agility missile rack. Smaller, faster missiles built for nimble targets.'
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
    baseDamage: 45, baseRange: 15000, baseSpeed: 3500, cooldown: 0.10, spread: 0.03,
    penetration: 1, energyCost: 18, vfxColor: '#ff6600',
    recoil: 20, shake: 10, impactScale: 1.0,
    model3D: 'special_goliath_autocannon', render3dOnly: true
  },
  special_plasma_gatling: {
    id: 'special_plasma_gatling', name: 'Ion Plasma Gatling (Special)', mountType: 'special', category: 'plasma', size: 'Capital',
    baseDamage: 60, baseRange: 15000, baseSpeed: 2000, cooldown: 0.15, spread: 0.05,
    penetration: 1, energyCost: 22, vfxColor: '#00ffff',
    recoil: 15, shake: 8, impactScale: 1.5,
    model3D: 'special_plasma_gatling', render3dOnly: true
  },
  special_valkyrie_railgun: {
    id: 'special_valkyrie_railgun', name: 'Valkyrie Railgun (Special)', mountType: 'special', category: 'rail', size: 'Capital',
    baseDamage: 500, baseRange: 25000, baseSpeed: 15000, cooldown: 1.5, spread: 0.001,
    penetration: 3, energyCost: 40, vfxColor: '#ff00ff',
    recoil: 60, shake: 45, impactScale: 3.5,
    model3D: 'special_valkyrie_railgun', render3dOnly: true
  },
  special_yamato_cannon: {
    id: 'special_yamato_cannon', name: 'Bateria Główna Klasy YAMATO', mountType: 'special', category: 'plasma', size: 'Capital',
    baseDamage: 850, baseRange: 20000, baseSpeed: 9000, cooldown: 2.5, spread: 0.005,
    penetration: 5, energyCost: 75, vfxColor: '#00ffff',
    recoil: 90, shake: 65, impactScale: 4.5, barrelsPerShot: 3,
    model3D: 'special_yamato_cannon', render3dOnly: true
  },
  hexlance_siege: {
    id: 'hexlance_siege', name: 'Hexlance Siege Cannon', mountType: 'builtin', category: 'superweapon', size: 'Capital',
    baseDamage: 9999, baseRange: 60000, baseSpeed: 12000, cooldown: 6.0, chargeTime: 1.2,
    burstCount: 4, burstDelay: 0.25, energyCost: 200, vfxColor: '#d0eaff'
  },

  // ==========================================================================
  // SIEGE / LONG-RANGE WEAPONS
  // ==========================================================================
  siege_torpedo: {
    id: 'siege_torpedo', name: 'Siege Torpedo Mk I', mountType: 'missile', category: 'torpedo', size: 'L',
    baseDamage: 800, baseRange: 60000, baseSpeed: 600, cooldown: 12.0, ammo: 6,
    turnRate: 80, homingDelay: 1.0, vfxColor: '#ff4444',
    explosionRadius: 200, armorPen: 3,
    description: 'Heavy anti-capital torpedo. Slow but devastating. Visible on enemy sensors.'
  },
  siege_torpedo_mk2: {
    id: 'siege_torpedo_mk2', name: 'Siege Torpedo Mk II', mountType: 'missile', category: 'torpedo', size: 'Capital',
    baseDamage: 1400, baseRange: 80000, baseSpeed: 500, cooldown: 18.0, ammo: 4,
    turnRate: 60, homingDelay: 1.5, vfxColor: '#ff2222',
    explosionRadius: 350, armorPen: 5,
    description: 'Capital-grade siege torpedo. Extremely powerful but slow and easy to intercept.'
  },
  torpedo_salvo: {
    id: 'torpedo_salvo', name: 'Torpedo Salvo Launcher', mountType: 'missile', category: 'torpedo', size: 'L',
    baseDamage: 250, baseRange: 45000, baseSpeed: 800, cooldown: 15.0, ammo: 12,
    turnRate: 120, homingDelay: 0.8, vfxColor: '#ff8844',
    burstCount: 6, burstDelay: 0.3,
    explosionRadius: 120,
    description: 'Launches a salvo of 6 lighter torpedoes. Harder to intercept all of them.'
  },
  siege_railgun: {
    id: 'siege_railgun', name: 'Mjolnir Siege Railgun', mountType: 'special', category: 'rail', size: 'Capital',
    baseDamage: 2500, baseRange: 100000, baseSpeed: 25000, cooldown: 8.0, chargeTime: 3.0,
    spread: 0.0005, penetration: 10, energyCost: 120, vfxColor: '#aaffff',
    recoil: 120, shake: 80, impactScale: 5.0,
    requiresStationary: true,
    description: 'Extreme range railgun. Ship must be stationary to fire. Devastating single-shot damage.'
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
  special_yamato_cannon: 'assets/weapons/supercapitalmain.png',
  hexlance_siege: 'assets/weapons/supercapitalmain.png',
  siege_torpedo: 'assets/weapons/torpedo.svg',
  siege_torpedo_mk2: 'assets/weapons/torpedo.svg',
  torpedo_salvo: 'assets/weapons/torpedo.svg',
  siege_railgun: 'assets/weapons/railgun.svg',
  ciws_mk1: 'assets/weapons/ciws.svg',
  laser_pd_mk1: 'assets/weapons/laser_pd.svg',
  missile_rack: 'assets/weapons/missile_rack.svg',
  fast_missile_rack: 'assets/weapons/missile_rack.svg'
};
