export function createWorld({ width = 240000, height = 160000 } = {}) {
  return {
    w: width,
    h: height,
  };
}

export const WORLD = createWorld();

export const GAME_STATE = Object.freeze({
  INTERPLANETARY: 'STATE_INTERPLANETARY',
  ORBITAL: 'STATE_ORBITAL',
  TRANSITIONING: 'STATE_TRANSITIONING',
});

export const TRANSITION_RADIUS = 15000;
export const ORBITAL_RADIUS = 3000;

if (typeof window !== 'undefined' && typeof window.WORLD === 'undefined') {
  window.WORLD = WORLD;
}

if (typeof window !== 'undefined') {
  if (typeof window.GAME_STATE === 'undefined') {
    window.GAME_STATE = GAME_STATE;
  }
  if (typeof window.TRANSITION_RADIUS === 'undefined') {
    window.TRANSITION_RADIUS = TRANSITION_RADIUS;
  }
  if (typeof window.ORBITAL_RADIUS === 'undefined') {
    window.ORBITAL_RADIUS = ORBITAL_RADIUS;
  }
}
