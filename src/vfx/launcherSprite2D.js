// Explicit ids keep torpedo launchers on their existing art and gameplay path.
const VARIANTS = {
  missile_rack: {
    url: new URL('../../assets/weapons/cruise-launcher-atlas-v1.png', import.meta.url).href,
    body: [221, 152, 831, 679], pod: [116, 931, 1026, 229],
    base: [-6, -9, 16, 18], podX: -1, podWidth: 17, podHeight: 4.4, ports: [-5, 0, 5]
  },
  fast_missile_rack: {
    url: new URL('../../assets/weapons/fast-launcher-atlas-v1.png', import.meta.url).href,
    body: [250, 164, 769, 632], pod: [212, 941, 847, 215],
    base: [-6, -8, 16, 16], podX: -1, podWidth: 17, podHeight: 3.8, ports: [-5, 0, 5]
  },
  osa_micro_missile: {
    url: new URL('../../assets/weapons/osa-launcher-atlas-v1.png', import.meta.url).href,
    body: [81, 249, 1093, 471], pod: [163, 932, 926, 201],
    base: [-7, -5, 13, 10], podX: -3, podWidth: 13, podHeight: 4.4, ports: [0]
  },
  supernova_missile: {
    url: new URL('../../assets/weapons/supernova-launcher-atlas-v1.png', import.meta.url).href,
    body: [109, 84, 1051, 779], pod: [67, 948, 1123, 246],
    base: [-12, -13, 24, 26], podX: -1, podWidth: 31, podHeight: 11, ports: [7, -7]
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

export const LauncherSprite2D = {
  enabled: true,
  isReady(id) { return VARIANTS[id]?.ready === true; },
  preload(id) { preload(VARIANTS[id]); },
  draw(ctx, id, a, b, c, d, sx, sy, housingBack, barrelBack) {
    if (!this.enabled) return false;
    const v = VARIANTS[id];
    if (!v) return false;
    preload(v);
    if (!v.ready) return false;
    // Launch racks shudder slightly; their canisters must stay on the mounting bed.
    const housing = Math.min(1, housingBack);
    const slide = housing + (id === 'supernova_missile' ? Math.min(.6, barrelBack) : 0);
    const body = v.body, pod = v.pod, base = v.base;
    ctx.setTransform(a, b, c, d, sx - housing * a, sy - housing * b);
    ctx.drawImage(v.image, body[0], body[1], body[2], body[3], base[0], base[1], base[2], base[3]);
    ctx.setTransform(a, b, c, d, sx - slide * a, sy - slide * b);
    for (let i = 0; i < v.ports.length; i++) {
      ctx.drawImage(v.image, pod[0], pod[1], pod[2], pod[3], v.podX, v.ports[i] - v.podHeight / 2, v.podWidth, v.podHeight);
    }
    return true;
  }
};
