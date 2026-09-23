// Shared, pre-tinted Canvas2D sprites. The artwork faces +X, like npc.angle.
// Decode and tint once; a squadron only pays for one drawImage per fighter.
const SPRITE_CACHE_SIZE = 256;
let friendlySprite = null;
let hostileSprite = null;

function tintSprite(image, color) {
  const canvas = document.createElement('canvas');
  canvas.width = SPRITE_CACHE_SIZE;
  canvas.height = Math.max(1, Math.round(SPRITE_CACHE_SIZE * image.naturalHeight / image.naturalWidth));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
  const image = new Image();
  image.onload = () => {
    friendlySprite = tintSprite(image, '#55ccff');
    hostileSprite = tintSprite(image, '#ff5555');
  };
  // Keep the procedural fallback on failure; never retry from the render loop.
  image.onerror = () => { friendlySprite = hostileSprite = null; };
  image.src = new URL('../../assets/fighter-combat-v1.png', import.meta.url).href;
}

// The caller supplies the translated/rotated context and the screen-space radius.
export function drawFighterSprite(ctx, friendly, size) {
  const sprite = friendly ? friendlySprite : hostileSprite;
  if (!sprite) return false;
  const width = size * 2.4;
  const height = width * sprite.height / sprite.width;
  ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  return true;
}
