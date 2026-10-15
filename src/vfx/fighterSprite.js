// Shared, pre-tinted Canvas2D sprites. The artwork faces +X, like npc.angle.
// Decode and tint once; a squadron only pays for one drawImage per fighter.
//
// ROLE (2026-10-14, src/data/fighterSquadrons.js): z jednego rysunku myśliwca powstają warianty doktryn —
// przechwytujący smuklejszy i dłuższy, szturmowy z zasobnikami rakiet, bombowiec szeroki i ciemniejszy
// z komorą bomb, torpedowiec wydłużony z torpedą pod kadłubem, kanonierka masywna (wieżyczkę rysuje gra
// w kursie celowania — index.html drawGunshipTurret). Warianty pieczone raz na doktrynę i stronę.
const SPRITE_CACHE_SIZE = 256;
let baseImage = null;
const variantCache = new Map();

/** Przekształcenie rysunku bazowego na doktrynę: skala wzdłuż (sx) i w poprzek (sy), przyciemnienie, dodatki. */
const VARIANTS = Object.freeze({
  fighter: Object.freeze({ sx: 1, sy: 1, tint: 0.38, dark: 0 }),
  interceptor: Object.freeze({ sx: 1.1, sy: 0.78, tint: 0.44, dark: 0 }),
  strike: Object.freeze({ sx: 1, sy: 1.1, tint: 0.38, dark: 0.08, pods: true }),
  bomber: Object.freeze({ sx: 0.95, sy: 1.45, tint: 0.3, dark: 0.22, bay: true }),
  torpedo: Object.freeze({ sx: 1.32, sy: 0.95, tint: 0.34, dark: 0.12, torpedo: true }),
  gunship: Object.freeze({ sx: 1.18, sy: 1.32, tint: 0.3, dark: 0.28, plates: true })
});

function variantOf(doctrine) {
  return VARIANTS[doctrine] || VARIANTS.fighter;
}

function bakeVariant(image, color, v) {
  const canvas = document.createElement('canvas');
  const baseH = SPRITE_CACHE_SIZE * image.naturalHeight / image.naturalWidth;
  canvas.width = Math.max(1, Math.round(SPRITE_CACHE_SIZE * v.sx));
  canvas.height = Math.max(1, Math.round(baseH * v.sy));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const W = canvas.width;
  const H = canvas.height;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, W, H);

  // Dodatki rysowane PRZED zabarwieniem — barwa strony kładzie się na całość.
  ctx.globalCompositeOperation = 'source-over';
  if (v.bay) {
    // Komora bomb na brzuchu: ciemny prostokąt z żółto-czarnym obrzeżem.
    const bw = W * 0.34;
    const bh = H * 0.16;
    ctx.fillStyle = '#d8b440';
    ctx.fillRect(W * 0.44 - bw * 0.5 - 2, H * 0.5 - bh * 0.5 - 2, bw + 4, bh + 4);
    ctx.fillStyle = '#1b1e22';
    ctx.fillRect(W * 0.44 - bw * 0.5, H * 0.5 - bh * 0.5, bw, bh);
    ctx.fillStyle = '#3a3f46';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(W * 0.44 - bw * 0.42 + i * bw * 0.3, H * 0.5 - bh * 0.32, bw * 0.22, bh * 0.64);
    }
  }
  if (v.torpedo) {
    // Torpeda pod kadłubem — długa kapsuła wzdłuż osi, jaśniejsza głowica przy nosie.
    const th = H * 0.13;
    const x0 = W * 0.16;
    const x1 = W * 0.9;
    ctx.fillStyle = '#20252b';
    ctx.beginPath();
    ctx.moveTo(x0, H * 0.5 - th * 0.5);
    ctx.lineTo(x1 - th, H * 0.5 - th * 0.5);
    ctx.arc(x1 - th, H * 0.5, th * 0.5, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0, H * 0.5 + th * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#c9d4dc';
    ctx.beginPath();
    ctx.arc(x1 - th, H * 0.5, th * 0.42, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  }
  if (v.pods) {
    // Zasobniki rakiet pod skrzydłami, blisko kadłuba (nie wystają poza obrys skrzydła).
    ctx.fillStyle = '#262b31';
    const pw = W * 0.2;
    const ph = H * 0.055;
    ctx.fillRect(W * 0.36, H * 0.33 - ph * 0.5, pw, ph);
    ctx.fillRect(W * 0.36, H * 0.67 - ph * 0.5, pw, ph);
    ctx.fillStyle = '#c9d4dc';
    ctx.fillRect(W * 0.36 + pw - ph * 0.6, H * 0.33 - ph * 0.5, ph * 0.6, ph);
    ctx.fillRect(W * 0.36 + pw - ph * 0.6, H * 0.67 - ph * 0.5, ph * 0.6, ph);
  }
  if (v.plates) {
    // Pancerne płyty na grzbiecie kanonierki.
    ctx.strokeStyle = 'rgba(20,24,28,0.75)';
    ctx.lineWidth = Math.max(1, W * 0.012);
    for (let i = 0; i < 3; i++) {
      const x = W * (0.3 + i * 0.13);
      ctx.beginPath();
      ctx.moveTo(x, H * 0.3);
      ctx.lineTo(x, H * 0.7);
      ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = 'source-atop';
  if (v.dark > 0) {
    ctx.globalAlpha = v.dark;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalAlpha = v.tint;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

function spriteFor(friendly, doctrine) {
  if (!baseImage) return null;
  const key = (friendly ? 'f:' : 'h:') + (VARIANTS[doctrine] ? doctrine : 'fighter');
  let canvas = variantCache.get(key);
  if (canvas === undefined) {
    canvas = bakeVariant(baseImage, friendly ? '#55ccff' : '#ff5555', variantOf(doctrine));
    variantCache.set(key, canvas);
  }
  return canvas;
}

if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
  const image = new Image();
  image.onload = () => {
    baseImage = image;
    variantCache.clear();
  };
  // Keep the procedural fallback on failure; never retry from the render loop.
  image.onerror = () => { baseImage = null; };
  image.src = new URL('../../assets/fighter-combat-v1.png', import.meta.url).href;
}

// The caller supplies the translated/rotated context and the screen-space radius.
export function drawFighterSprite(ctx, friendly, size, doctrine = 'fighter') {
  const sprite = spriteFor(friendly, doctrine);
  if (!sprite) return false;
  const width = size * 2.4 * variantOf(doctrine).sx;
  const height = width * sprite.height / sprite.width;
  ctx.drawImage(sprite, -width / 2, -height / 2, width, height);
  return true;
}
