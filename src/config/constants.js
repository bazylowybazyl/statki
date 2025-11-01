export const DEFAULT_PLANET_SCALE = 3; // jak w starym index.html
export const TIME_SCALE = 60;

if (typeof window !== 'undefined') {
  if (typeof window.DEFAULT_PLANET_SCALE === 'undefined') {
    window.DEFAULT_PLANET_SCALE = DEFAULT_PLANET_SCALE;
  }
  if (typeof window.TIME_SCALE === 'undefined') {
    window.TIME_SCALE = TIME_SCALE;
  }
}
