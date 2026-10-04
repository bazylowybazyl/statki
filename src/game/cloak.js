// ============================================================
// Maskowanie (cloak) okrętu — 2026-09-30, decyzja użytkownika: „pęka przy ataku”.
// Czysta logika (bez three / DOM). Stan w `ship.cloak`; gra pyta `isCloakHidden(encja)` przy wykrywaniu
// i celowaniu (datalink floty, AI, wieżyczki, stacje), render czyta `level` (0 widać … 1 ukryty).
//
// Stany: off → engaging (kadłub gaśnie przez engageSec; jeszcze WIDAĆ) → on (ukryty, energia spada)
//        → revealing (powrót przez revealSec; już widać) → off | cooldown (po zerwaniu: przeładowanie).
// Zerwanie (`breakCloak`): strzał, taran, trafienie, koniec energii — natychmiast widać i cooldown.
// Energia w SEKUNDACH maskowania; ładuje się tylko, gdy maskowanie wyłączone.
// ============================================================

export const CLOAK_TUNE = Object.freeze({
  maxEnergy: 60,        // s pełnego maskowania
  minEnergy: 8,         // s — próg włączenia
  drainPerSec: 1,
  rechargePerSec: 0.4,  // s energii na s (wyłączone, bez cooldownu)
  engageSec: 1.6,
  revealSec: 0.6,
  breakCooldownSec: 8
});

export const CLOAK_BREAK_LABELS = Object.freeze({
  fire: 'strzał',
  ram: 'taran',
  hit: 'trafienie',
  energy: 'brak energii',
  manual: 'wyłączone',
  script: 'rozkaz'
});

export function createCloak(tune = CLOAK_TUNE) {
  const t = { ...CLOAK_TUNE, ...tune };
  return {
    tune: t,
    state: 'off',
    energy: t.maxEnergy,
    level: 0,
    cooldown: 0,
    lastBreak: null,      // { reason, time }
    time: 0,
    enabled: true         // zdolność dostępna (fabuła może ją zablokować)
  };
}

/** Czy encja jest teraz niewidoczna dla czujników i celowania. */
export function isCloakHidden(entity) {
  const c = entity?.cloak;
  return !!c && c.state === 'on';
}

/** Czy maskowanie jest w toku (włączone albo się włącza) — do UI i ograniczeń. */
export function isCloakEngaged(c) {
  return !!c && (c.state === 'on' || c.state === 'engaging');
}

/** Zwraca powód odmowy (tekst) albo null, gdy można włączyć. */
export function cloakBlockReason(c) {
  if (!c) return 'brak maskowania';
  if (!c.enabled) return 'maskowanie niedostępne';
  if (c.state === 'cooldown') return `przeładowanie ${Math.ceil(c.cooldown)} s`;
  if (c.energy < c.tune.minEnergy) return 'za mało energii';
  return null;
}

export function engageCloak(c) {
  if (!c || c.state === 'on' || c.state === 'engaging') return false;
  if (cloakBlockReason(c)) return false;
  c.state = 'engaging';
  return true;
}

export function disengageCloak(c, reason = 'manual') {
  if (!c || (c.state !== 'on' && c.state !== 'engaging')) return false;
  c.state = 'revealing';
  c.lastBreak = { reason, time: c.time, forced: false };
  return true;
}

export function toggleCloak(c) {
  if (!c) return false;
  if (c.state === 'on' || c.state === 'engaging') return disengageCloak(c, 'manual');
  return engageCloak(c);
}

/**
 * Zerwanie (atak, taran, trafienie, energia): natychmiast widać, potem przeładowanie.
 * Zwraca true, gdy maskowanie było czynne (zdarzenie dla gry — alarm, komunikat).
 */
export function breakCloak(c, reason = 'fire') {
  if (!c || (c.state !== 'on' && c.state !== 'engaging')) return false;
  c.state = 'cooldown';
  c.level = 0;
  c.cooldown = c.tune.breakCooldownSec;
  c.lastBreak = { reason, time: c.time, forced: true };
  return true;
}

/** Krok (czas gry). Zwraca 'energy', gdy maskowanie właśnie zgasło z braku energii. */
export function stepCloak(c, dt) {
  if (!c) return null;
  const d = Math.max(0, Number(dt) || 0);
  const t = c.tune;
  c.time += d;
  let event = null;
  switch (c.state) {
    case 'engaging':
      c.level = Math.min(1, c.level + d / Math.max(0.01, t.engageSec));
      c.energy = Math.max(0, c.energy - t.drainPerSec * d);
      if (c.level >= 1) c.state = 'on';
      break;
    case 'on':
      c.level = 1;
      c.energy = Math.max(0, c.energy - t.drainPerSec * d);
      if (c.energy <= 0) { breakCloak(c, 'energy'); event = 'energy'; }
      break;
    case 'revealing':
      c.level = Math.max(0, c.level - d / Math.max(0.01, t.revealSec));
      if (c.level <= 0) c.state = 'off';
      break;
    case 'cooldown':
      c.level = 0;
      c.cooldown = Math.max(0, c.cooldown - d);
      if (c.cooldown <= 0) c.state = 'off';
      break;
    default:
      c.level = 0;
      c.energy = Math.min(t.maxEnergy, c.energy + t.rechargePerSec * d);
      break;
  }
  return event;
}
