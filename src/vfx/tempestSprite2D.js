// Tempest S / Mk I / L share the single atlas; Mk II uses the twin atlas.
// Keep this explicit: Valkyrie also uses the procedural tempest2 silhouette,
// but is a different weapon and must not inherit this artwork.
// Lanca (lance_rail_m / lance_rail_l, klasa snajperska) — korpus i lufa z atlasu SINGLE (ten sam obraz),
// lufa dłuższa i smuklejsza.
const SINGLE = {
  url: new URL('../../assets/weapons/tempest-single-atlas-v1.png', import.meta.url).href,
  image: null, ready: false, barrels: 1,
  body: [297, 190, 664, 539], barrel: [28, 894, 1199, 263],
  bodyY: -8, bodyHeight: 16
};
const TWIN = {
  url: new URL('../../assets/weapons/tempest-twin-atlas-v2.png', import.meta.url).href,
  image: null, ready: false, barrels: 2,
  body: [250, 146, 786, 788], barrel: [24, 966, 1206, 270],
  bodyY: -12, bodyHeight: 23.2
};
// Lufa Lancy [x, y, długość, grubość] w jednostkach wieży: prawa krawędź na wylocie (48, 0) — SPECS.lance w Turret2D.
const LANCE = { atlas: SINGLE, tube: [5, -3.2, 43, 6.4] };
const VARIANTS = Object.freeze({
  railgun_mk1: SINGLE, tempest_ion_s: SINGLE, tempest_ion_l: SINGLE,
  railgun_mk2: TWIN,
  lance_rail_m: LANCE, lance_rail_l: LANCE,
  // Legacy ids still accepted by Turret2D.resolveSpec.
  tempest_ion_mk1: SINGLE, tempest_ion_mk2: TWIN
});

// Atlas wariantu (Lanca pożycza obraz SINGLE).
const atlasOf = (variant) => (variant ? variant.atlas || variant : null);

function preload(variant) {
  if (!variant || variant.image || typeof Image === 'undefined') return;
  const image = new Image();
  variant.image = image;
  image.decoding = 'async';
  image.onload = () => { variant.ready = image.naturalWidth === 1254 && image.naturalHeight === 1254; };
  image.onerror = () => { variant.ready = false; };
  image.src = variant.url;
}

export const TempestSprite2D = {
  enabled: true,

  isReady(weaponId) { return atlasOf(VARIANTS[weaponId])?.ready === true; },

  preload(weaponId) { preload(atlasOf(VARIANTS[weaponId])); },

  draw(ctx, weaponId, a, b, c, d, sx, sy, housingBack, barrelBack) {
    if (!this.enabled) return false;
    const variant = VARIANTS[weaponId];
    if (!variant) return false;
    const atlas = atlasOf(variant);
    preload(atlas);
    if (!atlas.ready) return false;

    // Independent sprite transforms preserve the existing recoil animation.
    // The short slide also contains accumulated recoil during rapid volleys.
    const housing = Math.min(2, housingBack);
    const barrel = housing + Math.min(4, barrelBack);
    const body = atlas.body, tube = atlas.barrel, image = atlas.image;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(image, body[0], body[1], body[2], body[3], -7, atlas.bodyY, 20, atlas.bodyHeight);

    ctx.setTransform(a, b, c, d, sx - barrel * a, sy - barrel * b);
    // Local muzzle locations remain (34, 0) or (34, -5) / (34, 5); Lanca — (48, 0).
    if (variant.tube) {
      const t = variant.tube;
      ctx.drawImage(image, tube[0], tube[1], tube[2], tube[3], t[0], t[1], t[2], t[3]);
    } else if (atlas.barrels === 1) {
      ctx.drawImage(image, tube[0], tube[1], tube[2], tube[3], 5, -3.6, 29, 7.2);
    } else {
      ctx.drawImage(image, tube[0], tube[1], tube[2], tube[3], 5, -8.6, 29, 7.2);
      ctx.drawImage(image, tube[0], tube[1], tube[2], tube[3], 5, 1.4, 29, 7.2);
    }
    return true;
  }
};
