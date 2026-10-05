// Katalog dźwięków dema dema/dzwieki.html (kolejność = kolejność na stronie).
import { cannon, railgun, gatling, laserPD, beam, flak, hexlance, mjolnir } from './bronie.js';
import { missile, salvo } from './rakiety.js';
import { explosion, reactor } from './wybuchy.js';
import { hullHit, ricochet, shieldHit, grind, ram, engineMain, rcs } from './okret.js';
import { cloakOn, cloakOff, cloakBreak } from './maskowanie.js';
import { warpJump, warpCruise, warpExit, arrival } from './warp.js';
import { uiClick, uiConfirm, uiError, lockOn, paint, weaponGroup, alarm } from './interfejs.js';
import { battle, bridge } from './sceny.js';

export const SOUNDS = [
  battle, bridge,
  cannon, railgun, gatling, laserPD, beam, flak,
  hexlance, mjolnir,
  missile, salvo,
  explosion, reactor,
  hullHit, ricochet, shieldHit, grind, ram,
  engineMain, rcs,
  cloakOn, cloakOff, cloakBreak,
  warpJump, warpCruise, warpExit, arrival,
  uiClick, uiConfirm, uiError, lockOn, paint, weaponGroup, alarm,
];

// Poziomy przepisów w dB — z pomiaru (`await __dzwieki.measureAll({ bypassMaster: true })`,
// LUFS-M przed szyną główną, parametry domyślne). Cele: superbronie, reaktor, skok warpa −10;
// działa, wybuch, taran −11…−13; trafienia, rakiety, wiązka −15…−16; drobne −17…−20;
// silnik −18; tło −21…−24; interfejs −22…−24 (klik krótszy niż okno pomiaru — z ucha).
const LEVELS = {
  dzialo: -2, railgun: -2, gatling: -1, laserPD: 7.5, flak: 2.5,
  hexlance: -6.5, mjolnir: -8,
  rakieta: 2, salwa: 7,
  wybuch: -8, reaktor: -8,
  kadlub: 2, rykoszet: 5, tarcza: 0.5, zgrzyt: -2.5, taran: -5,
  silnik: -3, rcs: 7.5,
  maskaWl: 2.5, maskaWyl: 1, maskaZerwanie: 1.5,
  warpSkok: -7.5, warpLot: 1.5, warpWyjscie: -3.5, przylot: -3,
  klik: 4, potwierdzenie: 2, blad: -0.5, namiar: 2, malowanie: 6, grupa: 4, alarm: 3,
};
for (const s of SOUNDS) s.level = LEVELS[s.id] ?? 0;

export const GROUPS = [...new Set(SOUNDS.map((s) => s.group))];
