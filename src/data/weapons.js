export const WEAPONS = {
  railgun_mk1: { id: 'railgun_mk1', type: 'main', name: 'Railgun Mk I', dps: 40, energy: 6, ammo: null },
  railgun_mk2: { id: 'railgun_mk2', type: 'main', name: 'Railgun Mk II', dps: 60, energy: 8, ammo: null },
  armata_mk1: { id: 'armata_mk1', type: 'main', name: 'Armata Siege Cannon', damage: 220, cooldown: 1.8, energy: 14, ammo: null },
  heavy_autocannon: { id: 'heavy_autocannon', type: 'main', name: 'Heavy Autocannon', damage: 28, cooldown: 0.16, energy: 9, ammo: null },
  missile_rack: { id: 'missile_rack', type: 'missile', name: 'Missile Rack', dps: 0, energy: 2, ammo: 20 },
  ciws_mk1: { id: 'ciws_mk1', type: 'aux', name: 'CIWS Mk I', dps: 12, energy: 2, ammo: null },
  laser_pd_mk1: { id: 'laser_pd_mk1', type: 'aux', name: 'Helios PD Laser', dps: 18, energy: 3, ammo: null },
  fighter_bay: { id: 'fighter_bay', type: 'hangar', name: 'Fighter Bay', dps: 0, energy: 5, ammo: null },
  super_f: { id: 'super_f', type: 'special', name: 'Super Weapon', dps: 300, energy: 20, ammo: null }
};

export const WEAPON_ICON_PATHS = {
  heavy_autocannon: 'assets/weapons/heavy_autocannon.svg'
};

export const AISPACE_GUNS = {
  laserS: { name: 'Laser krótki', dps: 40, dmg: 8, rps: 5, speed: 520, range: 380, spread: 2, color: '#86f7ff' },
  pulse: { name: 'Pulse blaster', dps: 55, dmg: 14, rps: 4, speed: 420, range: 420, spread: 3, color: '#ffd36e' },
  rail: { name: 'Rail micro', dps: 65, dmg: 26, rps: 1.8, speed: 900, range: 560, spread: 0.6, color: '#c0b7ff' },
  gatling: { name: 'Gatling', dps: 70, dmg: 3, rps: 12, speed: 520, range: 320, spread: 4, color: '#9fff75' }
};

export const AISPACE_PD = {
  pd_mk1: { name: 'PD Mk1', dmg: 5, rps: 9, speed: 560, range: 380, spread: 6, color: '#8cffd0', burst: 3 },
  pd_laser: { name: 'PD Laser', dmg: 3, rps: 18, speed: 1200, range: 420, spread: 0.7, color: '#ff77ff', burst: 10 }
};

export const AISPACE_MISSILES = {
  AF: { name: 'AIM-3', speed: 360, turn: 600, life: 4.0, dmg: 45, seek: 'fighter', color: '#7cd7ff' },
  AS: { name: 'ASM-6', speed: 300, turn: 320, life: 6.0, dmg: 120, seek: 'ship', color: '#ffad7c' },
  HE: { name: 'HET-4', speed: 280, turn: 250, life: 5.0, dmg: 160, seek: 'any', color: '#ff7cf0' },
  SW: { name: 'Swarm-8', speed: 340, turn: 550, life: 3.0, dmg: 18, seek: 'fighter', color: '#b3ff7c', swarm: 6, spread: 18 }
};

export const AISPACE_GUNS_M = {
  m_beam: { name: 'M Beam', dmg: 24, rps: 1.8, speed: 900, range: 820, spread: 0.4, color: '#8fd8ff', isBeam: true },
  m_pulse: { name: 'M Pulse', dmg: 40, rps: 1.1, speed: 700, range: 760, spread: 0.8, color: '#ffd98a' },
  m_rail: { name: 'M Rail', dmg: 85, rps: 0.55, speed: 1200, range: 1500, spread: 0.35, color: '#d0c9ff' },
  m_autocannon: { name: 'M Auto', dmg: 22, rps: 3.2, speed: 780, range: 680, spread: 1.2, color: '#b6ff9a' },
  h_beam: { name: 'Heavy Beam', dmg: 260, rps: 0.22, speed: 1500, range: 1100, spread: 0.1, color: '#ff0000', isBeam: true },
  h_rapid: { name: 'Rapid Laser L', dmg: 45, rps: 5.0, speed: 900, range: 1300, spread: 1.0, color: '#00ff00' }
};
