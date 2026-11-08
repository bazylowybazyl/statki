// dema/kontakty-czujnikow/namiarDemo.js
//
// Tryb NAMIARU dema kontaktów (dema/kontakty-czujnikow.html, klawisz W): Atlas i wróg W JEDNYM KADRZE w realnej skali
// (kadr 45 km, Atlas 3 km), trzy propozycje z namiarTSL.js. Sceny: STANY (trzy pasy: daleko, tuż przed progiem, wykryty),
// PRZELOT (wróg się zbliża → próg → cicha praca → ciąg → wróg odchodzi; pętla 27 s), GRUPY (3 grupy, w tym jedna poza
// kadrem i jeden kontakt bez identyfikacji — OBŁOK, est = 1), PORÓWNANIE (trzy propozycje w trzech pasach, ten sam przelot).
// Model jak w prototypie: them = ich czujniki × moja sygnatura / d, me = moje czujniki × ich sygnatura / d.
// Stan zdarzeń liczy CPU po stronie widoku: rozbłysk przy przejściu przez 1, szczelina struny, wiek pęknięcia, τ struny.
import {
  createNamiarBlock, createNamiarMeshes, NAMIAR_STYLES, NAMIAR_ANCH, NAMIAR_MARKS, NAMIAR_HDR, NAMIAR_MARK_BASE, NAMIAR_MARK_VEC, NAMIAR_GEOM
} from './namiarTSL.js';

const FLASH_SEC = 0.9;
const ATLAS_LEN = 3000;
const ENEMY_LEN = 1200;           // pancernik piratów (src/data/ships.js: pirate_battleship)
const OFF_AGE = 99;
const PERIOD = 27;
export const NAMIAR_SCENES = Object.freeze(['stany', 'przelot', 'grupy']);
export const NAMIAR_TITLES = Object.freeze({ wachlarz: '1 · WACHLARZ', struna: '2 · STRUNA', blona: '3 · BŁONA' });

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));

function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

let gid = 1;
/** Grupa wrogów: Rt — ich czujniki × moja sygnatura przy śladzie 1 [j.] (them = 1 przy d = Rt), Rm — moje czujniki × ich sygnatura. */
function group(x, y, Rt, Rm, extra = {}) {
  const id = gid++;
  return {
    id, x, y, Rt, Rm, est: 0, seed: hash01(id, 31, 7), them: 0, me: 0, d: 0, ships: 1,
    brokenThem: false, brokenMe: false, ageThem: OFF_AGE, ageMe: OFF_AGE, gapThem: 0, gapMe: 0,
    tauThem: hash01(id, 3, 5) * 40, tauMe: hash01(id, 9, 5) * 40, ...extra
  };
}

/** Oś czasu przelotu: odległość wroga i mój ślad (cicha praca ×0,5, ciąg ×1,35). */
function flyby(time) {
  const T = ((time % PERIOD) + PERIOD) % PERIOD;
  const dNear = 16500, dFar = 38000;
  const d = dFar + (dNear - dFar) * lin(0, 9, T) + (dFar - dNear) * ss(23, 27, T);
  const sig = 1 - 0.5 * ss(10.5, 11.5, T) * (1 - ss(16, 17, T)) + 0.35 * ss(16, 17, T) * (1 - ss(20.5, 21.5, T));
  // cicha praca obcina też moje czujniki (prototyp: strength.silentMul 0,6)
  const sens = 1 - 0.4 * ss(10.5, 11.5, T) * (1 - ss(16, 17, T));
  const phase = T < 9 ? 'WRÓG SIĘ ZBLIŻA' : T < 10.5 ? 'WRÓG BLISKO' : T < 16 ? 'CICHA PRACA' : T < 20.5 ? 'CIĄG' : T < 23 ? 'WRÓG BLISKO' : 'WRÓG ODCHODZI';
  return { d, sig, sens, phase };
}

export function createNamiarDemo(core, distLayer) {
  const blocks = NAMIAR_STYLES.map(() => createNamiarBlock());
  const parts = NAMIAR_STYLES.map((style, i) => createNamiarMeshes(style, blocks[i], distLayer));
  const meshes = parts.map((p) => p.mesh);
  const dists = parts.map((p) => p.dist).filter(Boolean);
  for (const m of [...meshes, ...dists]) m.visible = false;
  const st = { views: [], scene: 'przelot', cmp: false, distLive: false, time: 0, phase: '' };
  const enemyImg = new Image();
  enemyImg.src = '../src/assets/ships/piratebattleship.png';

  /** Widok = mój okręt + grupy; `row` — numer pasa (0–2) albo −1 (cały kadr). */
  function setScene(scene, cmp, cam, W, H, makeContact) {
    gid = 1;
    st.scene = cmp ? 'przelot' : scene;
    st.cmp = !!cmp;
    st.views = [];
    const rowH = H / 3 / cam.zoom;
    const rowY = (i) => (i - 1) * rowH;
    const xA = -17000;
    const pairRow = (i, caption, extra = {}) => {
      const gy = rowY(i);
      const g = group(xA + 20000, gy, 20000, 17000, { dFix: extra.dFix ?? null, dir: -0.035 });
      return { x: xA, y: gy, sig: 1, row: i, caption, groups: [g], flyby: extra.dFix == null };
    };
    if (cmp) {
      for (let i = 0; i < 3; i++) st.views.push({ ...pairRow(i, null), quad: i });
    } else if (scene === 'stany') {
      st.views.push(pairRow(0, 'DALEKO — 38 km', { dFix: 38000 }));
      st.views.push(pairRow(1, 'TUŻ PRZED PROGIEM — 21,5 km', { dFix: 21500 }));
      st.views.push(pairRow(2, 'WYKRYTY — 16,5 km', { dFix: 16500 }));
    } else if (scene === 'przelot') {
      const g = group(0, 0, 20000, 17000, { dir: -0.1 });
      st.views.push({ x: -16500, y: 2100, sig: 1, row: -1, caption: null, groups: [g], flyby: true });
    } else {
      // GRUPY: A (blisko, pancernik + eskorta, chodzi wokół progu), B (kontakt bez identyfikacji — OBŁOK, est),
      // C (poza kadrem, duże czujniki — już mnie widzi)
      const my = { x: -8500, y: 1700 };
      const A = group(5500, -6700, 18000, 21000, { ships: 3, wander: (t, g) => { g.x = 6800 + 1400 * Math.sin(t * 0.33); g.y = -6700 + 500 * Math.cos(t * 0.21); } });
      const c = makeContact ? makeContact(1, 13500, 8200) : null;
      const Bg = group(13500, 8200, 15000, 30000, { est: 1, contact: c, ships: 0 });
      const Cg = group(-36000, -9000, 34000, 22000, { off: true });
      st.views.push({ x: my.x, y: my.y, sig: 1, row: -1, caption: null, groups: [A, Bg, Cg], flyby: false, breathe: true });
    }
    for (const v of st.views) {
      for (const g of v.groups) {
        const t0 = 0;
        positions(v, g, t0);
        computeRatios(v, g);
        g.brokenThem = g.them >= 1; g.brokenMe = g.me >= 1;
        g.gapThem = g.brokenThem ? 1 : 0; g.gapMe = g.brokenMe ? 1 : 0;
      }
    }
  }

  function positions(v, g, time) {
    if (v.flyby) {
      const f = flyby(time);
      v.sig = f.sig;
      v.sens = f.sens;
      st.phase = f.phase;
      g.x = v.x + Math.cos(g.dir) * f.d;
      g.y = v.y + Math.sin(g.dir) * f.d;
    } else if (g.dFix != null) {
      g.x = v.x + Math.cos(g.dir) * g.dFix;
      g.y = v.y + Math.sin(g.dir) * g.dFix;
    } else if (g.wander) {
      g.wander(time, g);
    } else if (g.contact) {
      g.x = g.contact.mx; g.y = g.contact.my;
    }
    if (v.breathe) v.sig = 1 + 0.12 * Math.sin(time * 0.27);
  }

  function computeRatios(v, g) {
    const d = Math.max(1, Math.sqrt((g.x - v.x) * (g.x - v.x) + (g.y - v.y) * (g.y - v.y)));
    g.d = d;
    g.them = g.Rt * v.sig / d;
    g.me = g.Rm * (v.sens ?? 1) / d;
  }

  function stepBreak(g, key, ratio, dt) {
    const bk = `broken${key}`, gk = `gap${key}`, ak = `age${key}`;
    if (!g[bk] && ratio >= 1) { g[bk] = true; g[ak] = 0; }
    else if (g[bk] && ratio < 0.975) g[bk] = false;
    g[ak] = Math.min(OFF_AGE, g[ak] + dt);
    const target = g[bk] ? 1 : 0;
    const tau = g[bk] ? 0.07 : 0.2;
    g[gk] += (target - g[gk]) * (1 - Math.exp(-dt / tau));
    if (g[gk] < 0.015 && !g[bk]) g[gk] = 0;
  }

  function step(time, dt) {
    st.time = time;
    for (const v of st.views) {
      for (const g of v.groups) {
        positions(v, g, time);
        computeRatios(v, g);
        stepBreak(g, 'Them', g.them, dt);
        stepBreak(g, 'Me', g.me, dt);
        const kt = Math.min(1, g.them), km = Math.min(1, g.me);
        g.tauThem += dt * (1 + kt * kt);
        g.tauMe += dt * (1 + km * km);
      }
    }
  }

  const flashOf = (age) => Math.max(0, 1 - age / FLASH_SEC);
  const toS = (cam, W, H, x, y) => [(x - cam.x) * cam.zoom + W * 0.5, (y - cam.y) * cam.zoom + H * 0.5];
  const r0Of = (len, zoom, pad) => Math.max(10, len * 0.5 * zoom + pad);

  /** Prostokąt widoku [px CSS]: pas albo cały kadr. */
  function viewRect(v, W, H) {
    if (v.row < 0) return [0, 0, W, H];
    return [0, v.row * H / 3, W, (v.row + 1) * H / 3];
  }

  /** Miejsce wroga na ekranie; poza kadrem — przy krawędzi na prostej od mojego okrętu (inset px CSS). */
  function enemyScreen(sx, sy, ex, ey, rect, inset) {
    const x0 = rect[0] + inset, y0 = rect[1] + inset, x1 = rect[2] - inset, y1 = rect[3] - inset;
    if (ex >= x0 && ex <= x1 && ey >= y0 && ey <= y1) return { x: ex, y: ey, edge: false };
    const dx = ex - sx, dy = ey - sy;
    let k = 1;
    if (dx > 1e-6) k = Math.min(k, (x1 - sx) / dx);
    if (dx < -1e-6) k = Math.min(k, (x0 - sx) / dx);
    if (dy > 1e-6) k = Math.min(k, (y1 - sy) / dy);
    if (dy < -1e-6) k = Math.min(k, (y0 - sy) / dy);
    return { x: sx + dx * k, y: sy + dy * k, edge: true };
  }

  const enemyPad = 12;
  const myPad = 14;
  /** Promień bazowy błony [px CSS]: obrys kadłuba + ślad. */
  const blonaR = (cam, sig) => ATLAS_LEN * 0.5 * cam.zoom * 0.72 + 20 + 46 * sig;

  function packStyle(i, style, quad, cam, W, H) {
    const pxs = core.pxScale || core.pixelRatio || 1;
    const bw = core.composerTarget?.width || W * pxs;
    const bh = core.composerTarget?.height || H * pxs;
    const A = blocks[i].array;
    let na = 0, n = 0;
    const later = [];
    for (const v of st.views) {
      if (quad >= 0 && v.quad !== quad) continue;
      const [sx, sy] = toS(cam, W, H, v.x, v.y);
      const rect = viewRect(v, W, H);
      const first = n;
      const Rb = blonaR(cam, v.sig);
      for (const g of v.groups) {
        const [ex0, ey0] = toS(cam, W, H, g.x, g.y);
        const dir = Math.atan2(ey0 - sy, ex0 - sx);
        const seed = g.seed;
        const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * n;
        // sąsiednie grupy się nie nakładają: połowa kąta najwyżej 0,47 odstępu do najbliższego kierunku
        let lim = 9;
        for (const h of v.groups) {
          if (h === g) continue;
          const [hx, hy] = toS(cam, W, H, h.x, h.y);
          let da = Math.abs(Math.atan2(hy - sy, hx - sx) - dir);
          if (da > Math.PI) da = 2 * Math.PI - da;
          lim = Math.min(lim, da * 0.47);
        }
        A[o + 3].set(lim, 0, 0, 0);
        const myR0 = r0Of(ATLAS_LEN, cam.zoom, myPad);
        if (style === 'wachlarz') {
          // przy mnie niebieski z `me`
          A[o].set(sx * pxs, sy * pxs, myR0 * pxs, dir);
          A[o + 1].set(g.me, 0, seed, 0);
          A[o + 2].set(flashOf(g.ageMe), g.gapMe, g.ageMe, g.tauMe);
        } else if (style === 'struna') {
          // przy mnie struna drga z `them`
          A[o].set(sx * pxs, sy * pxs, myR0 * pxs, dir);
          A[o + 1].set(g.them, g.est, seed, 0);
          A[o + 2].set(flashOf(g.ageThem), g.gapThem, g.ageThem, g.tauThem);
        } else {
          // błona: grupa = wybrzuszenie (M0.z — promień bazowy, dla fali)
          A[o].set(sx * pxs, sy * pxs, Rb * pxs, dir);
          A[o + 1].set(g.them, g.est, seed, 0);
          A[o + 2].set(flashOf(g.ageThem), g.gapThem, g.ageThem, g.tauThem);
        }
        n++;
        if (style !== 'blona') {
          const inset = style === 'struna' ? 26 : 16;
          const e = enemyScreen(sx, sy, ex0, ey0, rect, inset);
          const eDir = Math.atan2(sy - e.y, sx - e.x);
          const r0 = e.edge ? 6 : r0Of(g.ships ? ENEMY_LEN : 1200, cam.zoom, enemyPad);
          later.push(style === 'wachlarz'
            ? [e.x * pxs, e.y * pxs, r0 * pxs, eDir, g.them, g.est, seed, 1, flashOf(g.ageThem), g.gapThem, g.ageThem, g.tauThem]
            : [e.x * pxs, e.y * pxs, r0 * pxs, eDir, g.me, 0, (seed + 0.37) % 1, 1, flashOf(g.ageMe), g.gapMe, g.ageMe, g.tauMe]);
        }
      }
      if (na < NAMIAR_ANCH) {
        A[NAMIAR_HDR + 2 * na].set(sx * pxs, sy * pxs, Rb * pxs, v.sig);
        A[NAMIAR_HDR + 2 * na + 1].set(first, n - first, v.groups[0]?.seed ?? 0, 0);
        na++;
      }
    }
    for (const m of later) {
      if (n >= NAMIAR_MARKS) break;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * n;
      A[o].set(m[0], m[1], m[2], m[3]);
      A[o + 1].set(m[4], m[5], m[6], m[7]);
      A[o + 2].set(m[8], m[9], m[10], m[11]);
      A[o + 3].set(9, 0, 0, 0);
      n++;
    }
    A[0].set(n, st.time % 600, pxs, na);
    A[1].set(bw, bh, 0, 0);
  }

  /** Widoczność, prostokąty i bloki — co klatkę przed renderem. `variant`: wachlarz | struna | blona | porownanie. */
  function sync(variant, cam, W, H, on) {
    const pxs = core.pxScale || core.pixelRatio || 1;
    const bw = core.composerTarget?.width || W * pxs;
    const bh = core.composerTarget?.height || H * pxs;
    st.distLive = false;
    for (let i = 0; i < meshes.length; i++) {
      const style = NAMIAR_STYLES[i];
      const vis = !!on && (variant === 'porownanie' || variant === style);
      meshes[i].visible = vis;
      const quad = variant === 'porownanie' ? i : -1;
      const r = parts[i].rect.value;
      if (quad >= 0) r.set(0, quad * bh / 3, bw, (quad + 1) * bh / 3);
      else r.set(-1, -1, 1e9, 1e9);
      if (parts[i].dist) {
        parts[i].dist.visible = vis;
        if (vis) st.distLive = true;
      }
      if (vis) packStyle(i, style, quad, cam, W, H);
    }
  }

  // ---------------------------------------------------------------- nakładka 2D (okręty, podpisy)
  function drawOverlay(ctx, cam, W, H, variant, atlasImg, text, labels) {
    const cmp = variant === 'porownanie';
    for (const v of st.views) {
      const [sx, sy] = toS(cam, W, H, v.x, v.y);
      const rect = viewRect(v, W, H);
      if (atlasImg?.complete && atlasImg.naturalWidth) {
        const L = ATLAS_LEN * cam.zoom;
        ctx.save();
        ctx.globalAlpha = 0.97;
        ctx.drawImage(atlasImg, sx - L / 2, sy - L * 1677 / 3747 / 2, L, L * 1677 / 3747);
        ctx.restore();
      }
      if (labels) text('ATLAS', sx, sy + ATLAS_LEN * 0.27 * cam.zoom + 4, '159, 220, 255', 0.75, 10);
      for (const g of v.groups) {
        const [ex, ey] = toS(cam, W, H, g.x, g.y);
        const inRect = ex >= rect[0] && ex <= rect[2] && ey >= rect[1] && ey <= rect[3];
        if (inRect && g.ships && enemyImg.complete && enemyImg.naturalWidth) {
          const L = ENEMY_LEN * cam.zoom;
          const asp = enemyImg.naturalHeight / enemyImg.naturalWidth;
          const a = Math.atan2(sy - ey, sx - ex);
          for (let s = 0; s < g.ships; s++) {
            const ox = s === 0 ? 0 : (s === 1 ? 26 : -22), oy = s === 0 ? 0 : (s === 1 ? 24 : 30);
            const sc = s === 0 ? 1 : 0.5;
            ctx.save();
            ctx.translate(ex + ox, ey + oy);
            ctx.rotate(a);
            ctx.drawImage(enemyImg, -L * sc / 2, -L * sc * asp / 2, L * sc, L * sc * asp);
            ctx.restore();
          }
        }
        if (labels) {
          const e = enemyScreen(sx, sy, ex, ey, rect, 30);
          const status = g.them >= 1 ? 'WYKRYLI MNIE' : g.me >= 1 ? 'widzę ich' : '';
          const col = g.them >= 1 ? '255, 140, 130' : '170, 190, 205';
          const line = `ONI ${(g.them * 100).toFixed(0)}% · TY ${(g.me * 100).toFixed(0)}% · ${(g.d / 1000).toFixed(1).replace('.', ',')} km${g.est ? ' · zgadnięte' : ''}`;
          const right = e.x >= sx ? (e.x + 190 < W) : (e.x - 190 < 0);
          const lx = e.x + (right ? 1 : -1) * (inRect ? ENEMY_LEN * cam.zoom * 0.5 + 34 : 0);
          const ly = Math.min(rect[3] - 44, Math.max(rect[1] + 6, inRect ? e.y - 14 : e.y + 64));
          const al = right ? 'left' : 'right';
          text(line, lx, ly, '170, 190, 205', 0.8, 10, al);
          if (status) text(status, lx, ly + 13, col, 0.95, 10, al);
          if (!inRect) text('poza kadrem', lx, ly + 26, '170, 190, 205', 0.6, 10, al);
        }
      }
      if (v.caption && labels) text(v.caption, 16, rect[1] + 12, '255, 207, 106', 0.9, 13, 'left');
      if (cmp) text(NAMIAR_TITLES[NAMIAR_STYLES[v.quad]], 16, rect[1] + 12, '255, 207, 106', 0.95, 15, 'left');
    }
    if ((st.scene === 'przelot' || cmp) && labels) {
      const v = st.views[0];
      text(`${st.phase} · mój ślad ×${v.sig.toFixed(2).replace('.', ',')}`, W / 2, cmp ? H - 22 : 16, '220, 230, 240', 0.85, 12);
    }
    if (st.views.some((v) => v.row >= 0)) {
      ctx.strokeStyle = 'rgba(160, 190, 210, 0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, H / 3); ctx.lineTo(W, H / 3);
      ctx.moveTo(0, 2 * H / 3); ctx.lineTo(W, 2 * H / 3);
      ctx.stroke();
    }
  }

  return {
    meshes, dists, st, setScene, step, sync, drawOverlay,
    warmupObjects: () => meshes.slice(),
    get distLive() { return st.distLive; }
  };
}

export { NAMIAR_GEOM };
