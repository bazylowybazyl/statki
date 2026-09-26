// PD shares three lazy atlases; Turret2D keeps size, aim and muzzle coordinates.
const LASER = {
  url: new URL('../../assets/weapons/helios-pd-atlas-v1.png', import.meta.url).href,
  body: [268, 129, 751, 728], tube: [152, 969, 950, 220],
  base: [-6, -7, 14, 14], barrels: [[3, 0, 15, 4]], recoil: .1,
  image: null, ready: false
};
const LIGHT_FLAK = {
  url: new URL('../../assets/weapons/flak-light-atlas-v1.png', import.meta.url).href,
  body: [195, 92, 866, 844], tube: [115, 989, 1018, 217],
  // Align the painted receiver centers with the existing +/-3.5 barrel axes.
  base: [-11, -14.5, 24, 28.8], barrels: [[5.5, -3.5, 23.5, 4.8], [5.5, 3.5, 23.5, 4.8]], recoil: .25,
  image: null, ready: false
};
const HEAVY_FLAK = {
  url: new URL('../../assets/weapons/flak-heavy-atlas-v1.png', import.meta.url).href,
  body: [169, 63, 922, 922], tube: [91, 1018, 1071, 209],
  base: [-12, -13.05, 28, 26], barrels: [[7, -3.5, 22, 5.7], [7, 3.5, 22, 5.7]], recoil: .25,
  image: null, ready: false
};
const VARIANTS = Object.freeze({
  laser_pd_mk1: LASER,
  flak_s: LIGHT_FLAK, flak_m: LIGHT_FLAK,
  flak_l: HEAVY_FLAK, flak_capital: HEAVY_FLAK
});

function preload(v) {
  if (!v || v.image || typeof Image === 'undefined') return;
  const image = new Image();
  v.image = image;
  image.decoding = 'async';
  image.onload = () => { v.ready = image.naturalWidth === 1254 && image.naturalHeight === 1254; };
  image.onerror = () => { v.ready = false; };
  image.src = v.url;
}

export const PdWeaponSprite2D = {
  enabled: true,
  supports(id) { return Object.hasOwn(VARIANTS, id); },
  isReady(id) { return VARIANTS[id]?.ready === true; },
  preload(id) { preload(VARIANTS[id]); },
  draw(ctx, id, a, b, c, d, sx, sy, housingBack, barrelBack) {
    if (!this.enabled) return false;
    const v = VARIANTS[id];
    if (!v) return false;
    preload(v);
    if (!v.ready) return false;
    const housing = Math.min(1, housingBack * v.recoil);
    const slide = housing + Math.min(2, barrelBack * v.recoil);
    const body = v.body, tube = v.tube, base = v.base;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(v.image, body[0], body[1], body[2], body[3], base[0], base[1], base[2], base[3]);
    ctx.setTransform(a, b, c, d, sx - slide * a, sy - slide * b);
    for (let i = 0; i < v.barrels.length; i++) {
      const barrel = v.barrels[i];
      ctx.drawImage(v.image, tube[0], tube[1], tube[2], tube[3], barrel[0], barrel[1] - barrel[3] / 2, barrel[2], barrel[3]);
    }
    return true;
  }
};
