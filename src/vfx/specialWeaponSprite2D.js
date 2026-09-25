// Shared modular atlases. +X is forward; each barrel ends at the existing
// Turret2D muzzle, so this visual replacement never changes gameplay geometry.
const VARIANTS = {
  special_goliath_autocannon: {
    url: new URL('../../assets/weapons/goliath-atlas-v1.png', import.meta.url).href,
    body: [60, 111, 1147, 820], tube: [34, 988, 1186, 226],
    base: [-17, -26, 44, 52], barrels: [[10, 7, 48, 8.8], [10, -7, 48, 8.8]],
    image: null, ready: false
  },
  special_plasma_gatling: {
    url: new URL('../../assets/weapons/plasma-gatling-atlas-v1.png', import.meta.url).href,
    body: [83, 90, 1097, 837], tube: [23, 959, 1212, 235],
    base: [-16, -20, 40, 40], barrels: [[8, 0, 34, 12]],
    image: null, ready: false
  },
  special_valkyrie_railgun: {
    url: new URL('../../assets/weapons/valkyrie-atlas-v1.png', import.meta.url).href,
    body: [102, 92, 1072, 826], tube: [18, 988, 1218, 233],
    base: [-14, -19, 34, 38], barrels: [[9, -5, 25, 4.8], [9, 5, 25, 4.8]],
    image: null, ready: false
  },
  siege_railgun: {
    url: new URL('../../assets/weapons/mjolnir-atlas-v1.png', import.meta.url).href,
    body: [56, 162, 1141, 740], tube: [24, 978, 1209, 196],
    base: [-16, -22, 40, 44], barrels: [[8, 0, 72, 10.5]],
    image: null, ready: false
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

export const SpecialWeaponSprite2D = {
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
    // Preserve recoil decay while keeping rapid volleys inside the receiver.
    const housing = Math.min(2, housingBack * .12);
    const recoil = housing + Math.min(5, barrelBack * .12);
    const body = v.body, tube = v.tube, base = v.base;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(v.image, body[0], body[1], body[2], body[3], base[0], base[1], base[2], base[3]);
    ctx.setTransform(a, b, c, d, sx - recoil * a, sy - recoil * b);
    for (let i = 0; i < v.barrels.length; i++) {
      const barrel = v.barrels[i];
      ctx.drawImage(v.image, tube[0], tube[1], tube[2], tube[3], barrel[0], barrel[1] - barrel[3] / 2, barrel[2], barrel[3]);
    }
    return true;
  }
};
