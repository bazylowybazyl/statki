// Shared atlases, loaded once per model. Gameplay muzzle remains at (22, 0).
const VARIANTS = {
  ciws_mk1: {
    url: new URL('../../assets/weapons/ciws-mk1-atlas-v1.png', import.meta.url).href,
    image: null, ready: false,
    body: [285, 166, 689, 624], barrel: [252, 921, 751, 233],
    bodyHeight: 12, barrelHeight: 5
  },
  ciws_mk2: {
    url: new URL('../../assets/weapons/ciws-mk2-atlas-v1.png', import.meta.url).href,
    image: null, ready: false,
    body: [235, 91, 812, 786], barrel: [158, 948, 938, 243],
    bodyHeight: 14, barrelHeight: 5.6
  }
};

function preload(variant) {
  if (!variant || variant.image || typeof Image === 'undefined') return;
  const image = new Image();
  variant.image = image;
  image.decoding = 'async';
  image.onload = () => { variant.ready = image.naturalWidth === 1254 && image.naturalHeight === 1254; };
  image.onerror = () => { variant.ready = false; };
  image.src = variant.url;
}

export const CiwsSprite2D = {
  enabled: true,
  isReady(weaponId) { return VARIANTS[weaponId]?.ready === true; },
  preload(weaponId) { preload(VARIANTS[weaponId]); },
  draw(ctx, weaponId, a, b, c, d, sx, sy, housingBack, barrelBack) {
    if (!this.enabled) return false;
    const variant = VARIANTS[weaponId];
    if (!variant) return false;
    preload(variant);
    if (!variant.ready) return false;
    // Bound accumulated recoil during sustained rapid fire to the receiver slide.
    const housing = Math.min(.8, housingBack);
    const barrel = housing + Math.min(1.8, barrelBack);
    const body = variant.body, tube = variant.barrel;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(variant.image, body[0], body[1], body[2], body[3], -6, -variant.bodyHeight / 2, 12, variant.bodyHeight);
    ctx.setTransform(a, b, c, d, sx - barrel * a, sy - barrel * b);
    ctx.drawImage(variant.image, tube[0], tube[1], tube[2], tube[3], 3, -variant.barrelHeight / 2, 19, variant.barrelHeight);
    return true;
  }
};
