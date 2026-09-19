// One shared atlas, sampled directly: no per-turret images or per-frame canvases.
// Local +X points forward. Barrel tips match Turret2D's existing muzzle offsets.
const ATLAS_URL = new URL('../../assets/weapons/yamato-atlas-v1.png', import.meta.url).href;
let atlas = null;
let ready = false;

export const YamatoSprite2D = {
  // Also used by the isolated A/B preview; the game defaults to sprites.
  enabled: true,

  get ready() { return ready; },

  preload() {
    if (atlas || typeof Image === 'undefined') return;
    atlas = new Image();
    atlas.decoding = 'async';
    atlas.onload = () => { ready = atlas.naturalWidth === 1254 && atlas.naturalHeight === 1254; };
    atlas.onerror = () => { ready = false; };
    atlas.src = ATLAS_URL;
  },

  draw(ctx, a, b, c, d, sx, sy, housingBack, barrelBack) {
    if (!this.enabled) return false;
    this.preload();
    if (!ready) return false; // Keep the procedural silhouette until loaded, or on failure.

    // The old Yamato kick is 60 units, longer than its barrel. Keep the same
    // decay but limit the sprite's visual travel to the receiver's slide length.
    const housing = Math.min(2.5, housingBack * 0.12);
    const barrel = housing + Math.min(6, barrelBack * 0.12);
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(atlas, 124, 107, 996, 764, -22, -24, 48, 48);

    ctx.setTransform(a, b, c, d, sx - barrel * a, sy - barrel * b);
    // One barrel sprite reused three times. At rest the ends are exactly
    // (56, -6.75), (58, 0), (56, 6.75), matching SPECS.yamato.m.
    ctx.drawImage(atlas, 28, 962, 1198, 226, 6, -9.65, 50, 5.8);
    ctx.drawImage(atlas, 28, 962, 1198, 226, 6, -3.1, 52, 6.2);
    ctx.drawImage(atlas, 28, 962, 1198, 226, 6, 3.85, 50, 5.8);
    return true;
  }
};
