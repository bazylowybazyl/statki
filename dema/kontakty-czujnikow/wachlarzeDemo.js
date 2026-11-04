// dema/kontakty-czujnikow/wachlarzeDemo.js
//
// Tryb WACHLARZY dema kontaktów (dema/kontakty-czujnikow.html, klawisz W): stanowiska z okrętem gracza i wachlarzami
// „) ) )” w stronę grup wrogów — stany: daleko, przy progu, sięga, kilka grup (z radarem zgadniętym), cicha praca,
// przejście przez próg (animacja). Dane jak `P.fans` prototypu (sensorPicture.js): na grupę kąt, ułamki `me` / `them`
// (zasięg / odległość), `est`. Rozbłysk przy przejściu ułamka przez 1 liczy CPU (1 → 0 w FLASH_SEC).
// Warianty TSL — wachlarzeTSL.js; wariant 0 (dziś) — kopia rysunku 2D prototypu (drawFanHalf w radarRangeOverlay.js).
import { createFanBlock, createFanMeshes, FAN_STYLES, FAN_MAX, FAN_HDR, FAN_GEOM } from './wachlarzeTSL.js';

const FLASH_SEC = 0.9;
const ATLAS_HALF = { x: 1500, y: 671 };      // pół długości / szerokości Atlasa [j.] (3000 × 1343)
const OWN_RGB = '110, 204, 255';
const ENEMY_RGB = '255, 112, 104';
/** Kolejność ćwiartek porównania: PULS, FALA, ISKRY, DZIŚ. */
export const FAN_QUAD = Object.freeze(['puls', 'fala', 'iskry', 'dzis']);

function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

let gid = 1;
function group(ang, me, them, extra = {}) {
  const id = gid++;
  return { ang, me, them, est: 0, anim: null, seed: hash01(id, 31, 7), flashMe: -1e9, flashThem: -1e9, pMe: me, pThem: them, ...extra };
}

/** Stanowiska planszy (świat gry, j.; kąty jak canvas — y w dół). */
function stationsGrid() {
  return [
    { x: -15000, y: -6200, caption: 'DALEKO — obie strony poza zasięgiem', groups: [group(-0.5, 0.32, 0.22)] },
    { x: 0, y: -6200, caption: 'BLISKO PROGU — prawie mnie widzą', groups: [group(-0.3, 0.7, 0.93)] },
    { x: 15000, y: -6200, caption: 'SIĘGA — widzimy się nawzajem', groups: [group(-0.4, 1.15, 1.35)] },
    {
      x: -15000, y: 6300, caption: 'KILKA GRUP (czerwień słabsza — radar zgadnięty)',
      groups: [group(-1.35, 0.42, 0.3), group(-0.1, 0.85, 1.2), group(1.05, 0.55, 0.62, { est: 1 }), group(2.75, 1.1, 0.5)]
    },
    { x: 0, y: 6300, caption: 'CICHA PRACA — mój ślad krótki', groups: [group(-0.35, 0.95, 0.28)] },
    {
      x: 15000, y: 6300, caption: 'PRZEJŚCIE PRZEZ PRÓG (animacja)',
      groups: [group(-0.35, 0, 0, { anim: (t, g) => { g.me = 0.62 + 0.55 * Math.sin(t * 0.45 + 1.2); g.them = 0.64 + 0.62 * Math.sin(t * 0.45); } })]
    }
  ];
}

/** Porównanie: w każdej ćwiartce jedno stanowisko z czterema grupami — daleko, przy progu (przechodzi), sięga, zgadnięty. */
function stationsCompare(quadCenter) {
  const out = [];
  for (let q = 0; q < 4; q++) {
    const c = quadCenter(q);
    out.push({
      x: c.x - 1500, y: c.y + 1200, quad: q, caption: null,
      groups: [
        group(-2.5, 0.35, 0.22),
        group(-0.55, 0.72, 0.9, { anim: (t, g) => { g.them = 0.86 + 0.24 * Math.sin(t * 0.7 + 0.4); g.me = 0.66 + 0.12 * Math.sin(t * 0.5); } }),
        group(0.45, 1.2, 1.35),
        group(2.3, 0.5, 0.62, { est: 1 })
      ]
    });
  }
  return out;
}

export function createFanDemo(core, distLayer) {
  const blocks = FAN_STYLES.map(() => createFanBlock());
  const parts = FAN_STYLES.map((style, i) => createFanMeshes(style, blocks[i], distLayer));
  const meshes = parts.map((p) => p.mesh);
  const dist = parts.find((p) => p.dist)?.dist || null;
  for (const m of meshes) m.visible = false;
  if (dist) dist.visible = false;
  const st = { stations: [], cmp: false, distLive: false, time: 0 };

  function setScene(cmp, quadCenter) {
    gid = 1;
    st.cmp = !!cmp;
    st.stations = cmp ? stationsCompare(quadCenter) : stationsGrid();
  }

  function step(time) {
    st.time = time;
    for (const s of st.stations) {
      for (const g of s.groups) {
        if (g.anim) g.anim(time, g);
        if (g.pMe < 1 && g.me >= 1) g.flashMe = time;
        if (g.pThem < 1 && g.them >= 1) g.flashThem = time;
        g.pMe = g.me; g.pThem = g.them;
      }
    }
  }

  const flashOf = (t0) => Math.max(0, 1 - (st.time - t0) / FLASH_SEC);

  function r0Css(zoom) {
    return Math.max(13, Math.max(ATLAS_HALF.x * zoom, ATLAS_HALF.y * zoom) + 6) + 8;
  }

  /** Widoczność, prostokąty porównania i bloki (px bufora) — co klatkę przed renderem. */
  function sync(variant, cam, W, H, on) {
    const pxs = core.pxScale || core.pixelRatio || 1;
    const bw = core.composerTarget?.width || W * pxs;
    const bh = core.composerTarget?.height || H * pxs;
    st.distLive = false;
    for (let i = 0; i < meshes.length; i++) {
      const style = FAN_STYLES[i];
      const vis = !!on && (variant === 'porownanie' || variant === style);
      meshes[i].visible = vis;
      const r = parts[i].rect.value;
      const quad = variant === 'porownanie' ? FAN_QUAD.indexOf(style) : -1;
      if (quad >= 0) {
        const x0 = (quad % 2) * bw / 2, y0 = (quad < 2 ? 0 : 1) * bh / 2;
        r.set(x0, y0, x0 + bw / 2, y0 + bh / 2);
      } else {
        r.set(-1, -1, 1e9, 1e9);
      }
      if (parts[i].dist) {
        parts[i].dist.visible = vis;
        if (vis) st.distLive = true;
      }
      if (!vis) continue;
      const A = blocks[i].array;
      const r0 = r0Css(cam.zoom) * pxs;
      let n = 0;
      for (const s of st.stations) {
        if (quad >= 0 && s.quad !== quad) continue;
        const sx = ((s.x - cam.x) * cam.zoom + W * 0.5) * pxs;
        const sy = ((s.y - cam.y) * cam.zoom + H * 0.5) * pxs;
        for (const g of s.groups) {
          if (n >= FAN_MAX) break;
          const o = FAN_HDR + 3 * n;
          A[o].set(sx, sy, r0, g.ang);
          A[o + 1].set(g.me, g.them, g.est, g.seed);
          A[o + 2].set(flashOf(g.flashMe), flashOf(g.flashThem), 0, 0);
          n++;
        }
      }
      A[0].set(n, st.time % 600, pxs, 0);
      A[1].set(bw, bh, 0, 0);
    }
  }

  // ---------------------------------------------------------------- nakładka 2D (okręt, podpisy, wariant „dziś”)
  function fanHalf2D(ctx, sx, sy, r0, dir, side, ratio, rgb, est) {
    const N = FAN_GEOM.N, gap = FAN_GEOM.GAP;
    const lit = Math.max(0, Math.min(1, ratio)) * N;
    const full = Math.floor(lit);
    const a0 = side < 0 ? dir - FAN_GEOM.HALF : dir + FAN_GEOM.SPLIT;
    const a1 = side < 0 ? dir - FAN_GEOM.SPLIT : dir + FAN_GEOM.HALF;
    ctx.lineWidth = FAN_GEOM.LW;
    ctx.beginPath();
    for (let i = Math.ceil(lit); i < N; i++) {
      const r = r0 + i * gap;
      ctx.moveTo(sx + Math.cos(a0) * r, sy + Math.sin(a0) * r);
      ctx.arc(sx, sy, r, a0, a1);
    }
    ctx.strokeStyle = `rgba(${rgb}, 0.1)`;
    ctx.stroke();
    const ea = est ? 0.6 : 1;
    for (let i = 0; i < Math.ceil(lit); i++) {
      const part = i < full ? 1 : lit - full;
      const a = ea * part * (1 - 0.35 * i / N);
      if (a <= 0.01) continue;
      const r = r0 + i * gap;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a0) * r, sy + Math.sin(a0) * r);
      ctx.arc(sx, sy, r, a0, a1);
      ctx.lineWidth = FAN_GEOM.LW + 3;
      ctx.strokeStyle = `rgba(${rgb}, ${a * 0.2})`;
      ctx.stroke();
      ctx.lineWidth = FAN_GEOM.LW;
      ctx.strokeStyle = `rgba(${rgb}, ${a})`;
      ctx.stroke();
    }
    if (ratio >= 1) {
      const am = (a0 + a1) / 2;
      const rt = r0 + N * gap + 2;
      const c = Math.cos(am), s = Math.sin(am);
      ctx.beginPath();
      ctx.moveTo(sx + c * (rt + 7), sy + s * (rt + 7));
      ctx.lineTo(sx + c * rt - s * 4.5, sy + s * rt + c * 4.5);
      ctx.lineTo(sx + c * rt + s * 4.5, sy + s * rt - c * 4.5);
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb}, ${0.95 * ea})`;
      ctx.fill();
    }
  }

  function drawOverlay(ctx, cam, W, H, variant, atlasImg, text, labels) {
    const r0 = r0Css(cam.zoom);
    for (const s of st.stations) {
      const sx = (s.x - cam.x) * cam.zoom + W * 0.5;
      const sy = (s.y - cam.y) * cam.zoom + H * 0.5;
      if (atlasImg?.complete && atlasImg.naturalWidth) {
        const L = 2 * ATLAS_HALF.x * cam.zoom;
        ctx.save();
        ctx.globalAlpha = 0.95;
        ctx.drawImage(atlasImg, sx - L / 2, sy - L * 1677 / 3747 / 2, L, L * 1677 / 3747);
        ctx.restore();
      }
      const today = variant === 'dzis' || (variant === 'porownanie' && FAN_QUAD[s.quad] === 'dzis');
      if (today) {
        ctx.save();
        ctx.lineCap = 'round';
        for (const g of s.groups) {
          fanHalf2D(ctx, sx, sy, r0, g.ang, -1, g.me, OWN_RGB, false);
          fanHalf2D(ctx, sx, sy, r0, g.ang, 1, g.them, ENEMY_RGB, !!g.est);
        }
        ctx.restore();
      }
      if (labels && s.caption) text(s.caption, sx, sy + r0 + FAN_GEOM.N * FAN_GEOM.GAP + 26, '170, 186, 204', 0.75, 11);
      if (labels) {
        for (const g of s.groups) {
          const rl = r0 + FAN_GEOM.N * FAN_GEOM.GAP + 22;
          const lx = sx + Math.cos(g.ang) * rl, ly = sy + Math.sin(g.ang) * rl;
          text(`TY ${(g.me * 100).toFixed(0)}% · ONI ${(g.them * 100).toFixed(0)}%`, lx, ly - 6, '150, 166, 184', 0.55, 9);
        }
      }
    }
  }

  return {
    meshes, dist, st, setScene, step, sync, drawOverlay,
    warmupObjects: () => meshes.slice(),
    get distLive() { return st.distLive; }
  };
}
