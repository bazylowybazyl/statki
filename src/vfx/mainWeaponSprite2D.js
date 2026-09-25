// One lazy atlas per family; S/M/L variants keep Turret2D's existing scale.
const VULCAN = {
  url: new URL('../../assets/weapons/vulcan-atlas-v1.png', import.meta.url).href,
  body: [84, 128, 1067, 725], tube: [40, 949, 1174, 240],
  base: [-10, -13, 28, 26], barrels: [[8, 0, 37, 8.4]], recoil: .3,
  image: null, ready: false
};
const HELIOS = {
  url: new URL('../../assets/weapons/helios-atlas-v1.png', import.meta.url).href,
  body: [87, 107, 1083, 810], tube: [29, 1000, 1195, 206],
  base: [-12, -25, 34, 50], barrels: [[9, 6, 38, 5.8], [9, -6, 38, 5.8]], recoil: .16,
  image: null, ready: false
};
const HEAVY = {
  url: new URL('../../assets/weapons/heavy-autocannon-atlas-v1.png', import.meta.url).href,
  body: [118, 107, 1020, 789], tube: [45, 965, 1164, 230],
  base: [-9, -12, 26, 24], barrels: [[7, 0, 35, 8]], recoil: .3,
  image: null, ready: false
};
const ARMATA = {
  url: new URL('../../assets/weapons/armata-atlas-v1.png', import.meta.url).href,
  body: [77, 88, 1099, 812], tube: [32, 948, 1193, 265],
  base: [-12, -17, 34, 34], barrels: [[8, 0, 47, 11]], recoil: .3,
  image: null, ready: false
};
const CONTINUOUS = {
  url: new URL('../../assets/weapons/beam-continuous-atlas-v1.png', import.meta.url).href,
  body: [80, 122, 1095, 777], tube: [68, 941, 1119, 262],
  base: [-10, -15, 28, 30], barrels: [[6, 0, 42, 16]], recoil: .06,
  image: null, ready: false
};
const PULSE = {
  url: new URL('../../assets/weapons/beam-pulse-atlas-v1.png', import.meta.url).href,
  body: [78, 78, 1098, 835], tube: [138, 998, 978, 208],
  base: [-11, -22.5, 30, 43], barrels: [[8, 6, 30, 6.4], [8, -6, 30, 6.4]], recoil: .16,
  image: null, ready: false
};
// Explicit ids prevent auxiliary lasers and special cannons inheriting main art.
const VARIANTS = Object.freeze({
  vulcan_minigun: VULCAN, gatling_s: VULCAN,
  helios_laser: HELIOS, helios_laser_s: HELIOS, helios_lance_l: HELIOS,
  heavy_autocannon: HEAVY, heavy_autocannon_l: HEAVY,
  armata_mk1: ARMATA, beam_continuous: CONTINUOUS, beam_pulse: PULSE
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

export const MainWeaponSprite2D = {
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
    const housing = Math.min(1.4, housingBack * v.recoil);
    const slide = housing + Math.min(3, barrelBack * v.recoil);
    const body = v.body, tube = v.tube, base = v.base;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(v.image, body[0], body[1], body[2], body[3], base[0], base[1], base[2], base[3]);
    ctx.setTransform(a, b, c, d, sx - slide * a, sy - slide * b);
    for (let i = 0; i < v.barrels.length; i++) {
      const barrel = v.barrels[i];
      // At rest, every right edge lands on its unchanged gameplay muzzle.
      ctx.drawImage(v.image, tube[0], tube[1], tube[2], tube[3], barrel[0], barrel[1] - barrel[3] / 2, barrel[2], barrel[3]);
    }
    return true;
  }
};
