// dema/kontakty-czujnikow/namiarDemo.js
//
// Tryb NAMIARU dema kontaktów (dema/kontakty-czujnikow.html, klawisz W) — trzecia runda (2026-11-10): CZUJKA na PPM.
// Gracz trzyma PPM: wokół okrętu nadyma się BŁONA (360°, ciała niebieskie — wszystkie planety układu, bliżej = większe
// wybrzuszenie), a STRUNA obraca się za myszką i drga tym mocniej, im silniejszy sygnał technologiczny w tym kierunku; nad
// grupą w namiarze wyrastają trójkąty (ile wrogów, tyle trójkątów; mały = statek, duży = budowla). Grupa w namiarze, która
// mnie widzi (them ≥ 1): struna czerwienieje, „!”, oko przy kursorze się otwiera.
// Sceny (świat gry, j. = m; kadr 45 km, Atlas 3 km): MISJA 1 (po warpie, baza piratów poza kadrem — gracz celuje w lewo,
// potem przeciąga w prawo przez patrol na bazę), UKŁAD (pusty układ, same planety; jedna się zbliża), PRZELOT (wróg
// się zbliża, wykrycie, cicha praca, ciąg). Własna ręka: PPM na kanwie przejmuje sterowanie od skryptu (S — od nowa).
// Model jak w prototypie: them = ich czujniki × moja sygnatura / d, me = moje czujniki × ich sygnatura / d.
import {
  createNamiarBlock, createNamiarMeshes, NAMIAR_STYLES, NAMIAR_ANCH, NAMIAR_ANCH_VEC, NAMIAR_MARKS, NAMIAR_HDR,
  NAMIAR_MARK_BASE, NAMIAR_MARK_VEC, NAMIAR_GEOM
} from './namiarTSL.js';

const ATLAS_LEN = 3000;
const ENEMY_LEN = 1200;           // pancernik piratów (src/data/ships.js: pirate_battleship)
const KM = 1000;
const OFF = 99;
export const NAMIAR_SCENES = Object.freeze(['misja', 'uklad', 'przelot']);
const STR_HALF = 0.52;            // pół kąta struny [rad]
const BEAM_SIGMA = 0.36;          // szerokość „wiązki” czujki [rad]
const AIM_TAU = 0.09;             // struna goni myszkę (s), najwyżej AIM_MAX rad/s
const AIM_MAX = 5.5;

const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));
const wrap = (a) => a - Math.floor((a + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
const lerpAng = (a, b, k) => a + wrap(b - a) * k;
const approach = (v, target, dt, tauUp, tauDown = tauUp) => v + (target - v) * (1 - Math.exp(-dt / (target > v ? tauUp : tauDown)));

function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

let gid = 1;
/** Grupa technologiczna (statki, budowle): Rt — ich czujniki × moja sygnatura przy śladzie 1 [j.], Rm — moje czujniki × ich sygnatura. */
function group(x, y, Rt, Rm, extra = {}) {
  const id = gid++;
  return {
    id, x, y, Rt, Rm, est: 0, nBig: 0, nSmall: 1, sprites: 0, name: '', seed: hash01(id, 31, 7),
    them: 0, me: 0, d: 0, bearing: 0, m: 0, reveal: 0, det: 0, detOn: false, flashAge: OFF, ...extra
  };
}
/** Ciało niebieskie: R — promień [j.], rodzaj 0 skalista, 1 gazowa, 2 lodowa / wodna, 3 gwiazda. */
function body(name, kind, R, d, bearing, extra = {}) {
  const id = gid++;
  return { id, name, kind, R, d, bearing, x: 0, y: 0, seed: hash01(id, 17, 3), c: 0, sigma: 0.3, rev: 0, revV: 0, ...extra };
}

/** Oś czasu przelotu (pętla 27 s): odległość wroga, mój ślad (cicha praca ×0,5, ciąg ×1,35), moje czujniki (cisza ×0,6). */
function flyby(T) {
  const dNear = 16500, dFar = 38000;
  const d = dFar + (dNear - dFar) * lin(0, 9, T) + (dFar - dNear) * ss(23, 27, T);
  const sig = 1 - 0.5 * ss(10.5, 11.5, T) * (1 - ss(16, 17, T)) + 0.35 * ss(16, 17, T) * (1 - ss(20.5, 21.5, T));
  const sens = 1 - 0.4 * ss(10.5, 11.5, T) * (1 - ss(16, 17, T));
  const phase = T < 9 ? 'WRÓG SIĘ ZBLIŻA' : T < 10.5 ? 'WRÓG BLISKO' : T < 16 ? 'CICHA PRACA' : T < 20.5 ? 'CIĄG' : T < 23 ? 'WRÓG BLISKO' : 'WRÓG ODCHODZI';
  return { d, sig, sens, phase };
}

const SCENES = {
  // MISJA 1: po warpie, baza piratów poza kadrem (obok planetoidy Hidalgo). Gracz klika PPM w lewo (tam pusto), przeciąga
  // w dół i w prawo: patrol (2 statki, nie widzą mnie), potem baza (budowla + 6 statków, widzi mnie — „!”, oko).
  misja: {
    period: 13,
    build(makeContact) {
      const v = { x: -9000, y: 2500, sig: 1, sens: 1 };
      v.groups = [
        group(31000, -4300, 48000, 56000, { nBig: 1, nSmall: 6, name: 'baza piratów + 6 statków' }),
        group(12000, 9000, 17000, 24000, { nSmall: 2, sprites: 2, name: 'patrol, 2 statki' })
      ];
      const c = makeContact ? makeContact(1, -15000, -11000) : null;
      v.groups.push(group(-15000, -11000, 12500, 30000, { est: 1, nSmall: 1, contact: c, name: 'kontakt bez identyfikacji' }));
      v.planets = [
        body('Hidalgo (planetoida)', 0, 2600, 42000, -0.02),
        body('Mars', 0, 7000, 160 * KM, 2.4),
        body('Ziemia', 2, 9000, 380 * KM, -0.9),
        body('Jowisz', 1, 32000, 900 * KM, -2.2),
        body('Słońce', 3, 60000, 2500 * KM, 1.2)
      ];
      return v;
    },
    script(v, T) {
      const PIR = -0.168, PAT = 0.3;
      let aim;
      if (T < 2.4) aim = Math.PI - 0.1 + 0.05 * Math.sin(T * 1.3);
      else if (T < 4.6) aim = lerpAng(Math.PI - 0.1, PAT, ss(2.4, 4.6, T));   // z lewej przez dół w prawo
      else if (T < 5.6) aim = PAT + 0.04 * Math.sin((T - 4.6) * 3);
      else if (T < 6.6) aim = lerpAng(PAT, PIR, ss(5.6, 6.6, T));
      else if (T < 9.4) aim = PIR + 0.035 * Math.sin((T - 6.6) * 2.2);
      else aim = lerpAng(PIR, -0.8, ss(9.4, 10.2, T));
      return { on: T >= 0.4 && T < 10.6, aim, caption: null };
    }
  },
  // UKŁAD: pusty układ (nowe demo wielu układów) — same ciała niebieskie, jedna planeta się zbliża i oddala; struna obiega
  // okrąg (w kierunku stacji nad gazowym olbrzymem drgnie i pokaże jeden duży trójkąt).
  uklad: {
    period: 16,
    build() {
      const v = { x: -2000, y: 0, sig: 1, sens: 1 };
      v.groups = [group(0, 0, 20000, 90000, { nBig: 1, nSmall: 0, far: { d: 70 * KM, bearing: 2.95 }, name: 'stacja, 70 km' })];
      v.planets = [
        body('Kora', 0, 3500, 60 * KM, 0.6, { path: (T) => 14 * KM + 46 * KM * (0.5 + 0.5 * Math.cos(2 * Math.PI * T / 16)) }),
        body('Lód', 2, 2500, 95 * KM, 2.3),
        body('Morze', 2, 5200, 210 * KM, -0.7),
        body('Okruch', 0, 1500, 48 * KM, 1.6),
        body('Olbrzym', 1, 24000, 420 * KM, -2.6),
        body('Gwiazda', 3, 50000, 1800 * KM, -1.62)
      ];
      return v;
    },
    script(v, T) {
      return { on: T >= 0.3, aim: -1.0 + 2 * Math.PI * Math.max(0, T - 0.3) / 15.5, caption: null };
    }
  },
  // PRZELOT: celuję w wroga (3 statki) — sygnał rośnie, gdy się zbliża; wykrycie, cicha praca, ciąg.
  przelot: {
    period: 27,
    build() {
      const v = { x: -16500, y: 2100, sig: 1, sens: 1 };
      v.groups = [group(0, 0, 20000, 17000, { nSmall: 3, sprites: 3, dir: -0.1, flyby: true, name: 'pancernik + 2 statki' })];
      v.planets = [body('Mars', 0, 7000, 140 * KM, 2.2), body('Jowisz', 1, 32000, 700 * KM, -2.4), body('Słońce', 3, 60000, 2200 * KM, 0.9)];
      return v;
    },
    script(v, T) {
      return { on: T >= 0.4 && T < 26.6, aim: -0.1 + 0.05 * Math.sin(T * 0.7), caption: flyby(T).phase };
    }
  }
};

export function createNamiarDemo(core, distLayer) {
  const blocks = NAMIAR_STYLES.map(() => createNamiarBlock());
  const parts = NAMIAR_STYLES.map((style, i) => createNamiarMeshes(style, blocks[i], distLayer));
  const meshes = parts.map((p) => p.mesh);
  const dists = parts.map((p) => p.dist).filter(Boolean);
  for (const m of [...meshes, ...dists]) m.visible = false;
  const st = {
    view: null, scene: 'misja', distLive: false, time: 0, t0: 0, caption: null,
    manual: false, mouse: { x: 0, y: 0, rmb: false, inside: false }, cursor: { x: 0, y: 0 }, eye: 0
  };
  const enemyImg = new Image();
  enemyImg.src = '../src/assets/ships/piratebattleship.png';

  function setScene(scene, cam, W, H, makeContact, time = 0) {
    gid = 1;
    st.scene = SCENES[scene] ? scene : 'misja';
    st.view = SCENES[st.scene].build(makeContact);
    const v = st.view;
    Object.assign(v, { phi: Math.PI, on: false, onAge: OFF, vis: 0, amp: 0, pluck: 0, tau: 7.3, harm: 0, det: 0 });
    st.t0 = time;
    st.manual = false;
    st.eye = 0;
    step(time, 0);
    v.phi = v.aimTarget ?? v.phi;
  }

  function sceneT(time) {
    const P = SCENES[st.scene].period;
    return (((time - st.t0) % P) + P) % P;
  }

  function step(time, dt) {
    st.time = time;
    const v = st.view;
    if (!v) return;
    const sc = SCENES[st.scene];
    const T = sceneT(time);
    const s = sc.script(v, T);
    st.caption = s.caption;
    let on = s.on, aimT = s.aim;
    if (st.manual) {
      on = st.mouse.rmb;
      aimT = Math.atan2(st.mouse.y - v.sy, st.mouse.x - v.sx);
    }
    v.aimTarget = aimT;
    // przelot: ślad i czujniki z osi czasu
    if (st.scene === 'przelot') { const f = flyby(T); v.sig = f.sig; v.sens = f.sens; }
    // PPM: nadyma / gaśnie
    if (on && !v.on) v.onAge = 0;
    v.on = on;
    v.onAge = Math.min(OFF, v.onAge + dt);
    v.vis = approach(v.vis, on ? 1 : 0, dt, 0.14, 0.32);
    // struna goni kierunek celowania (z ograniczeniem prędkości obrotu — jak antena)
    const dphi = wrap(aimT - v.phi);
    const stepA = Math.max(-AIM_MAX * dt, Math.min(AIM_MAX * dt, dphi * (1 - Math.exp(-dt / AIM_TAU))));
    v.phi = wrap(v.phi + (dt > 0 ? stepA : dphi));
    // grupy technologiczne
    let signal = 0, detBeam = 0, eye = 0;
    for (const g of v.groups) {
      if (g.flyby) {
        const f = flyby(T);
        g.x = v.x + Math.cos(g.dir) * f.d;
        g.y = v.y + Math.sin(g.dir) * f.d;
      } else if (g.far) {
        g.x = v.x + Math.cos(g.far.bearing) * g.far.d;
        g.y = v.y + Math.sin(g.far.bearing) * g.far.d;
      } else if (g.contact) {
        g.x = g.contact.mx; g.y = g.contact.my;
      }
      const dx = g.x - v.x, dy = g.y - v.y;
      g.d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      g.bearing = Math.atan2(dy, dx);
      g.them = g.Rt * v.sig / g.d;
      g.me = g.Rm * v.sens / g.d;
      const da = wrap(g.bearing - v.phi);
      g.da = da;
      g.m = Math.exp(-(da / BEAM_SIGMA) * (da / BEAM_SIGMA));
      const inBeam = v.on && Math.abs(da) < STR_HALF * 0.95 && g.m > 0.3;
      const prev = g.reveal;
      g.reveal = approach(g.reveal, inBeam ? 1 : 0, dt, 0.32, 0.22);
      if (prev < 0.06 && g.reveal >= 0.06) v.pluck = Math.min(1.4, v.pluck + 0.9);   // szarpnięcie, gdy grupa wchodzi w namiar
      if (!g.detOn && g.them >= 1) g.detOn = true;
      else if (g.detOn && g.them < 0.975) g.detOn = false;
      const detPrev = g.det;
      g.det = approach(g.det, g.detOn && g.reveal > 0.05 ? 1 : 0, dt, 0.18, 0.3);
      if (detPrev < 0.1 && g.det >= 0.1) g.flashAge = 0;
      g.flashAge = Math.min(OFF, g.flashAge + dt);
      if (v.on) signal += Math.min(1.4, g.me) * g.m;
      detBeam = Math.max(detBeam, g.det * g.reveal);
      eye = Math.max(eye, g.det * g.reveal);
    }
    const sg = Math.min(1, signal);
    const ampT = 0.35 + 5.2 * sg * Math.sqrt(sg);
    v.amp = approach(v.amp, ampT, dt, 0.35, 0.5);
    v.pluck *= Math.exp(-dt / 0.38);
    v.harm = approach(v.harm, sg, dt, 0.4);
    v.tau += dt * (1 + 0.6 * v.harm * v.harm);
    v.det = detBeam;
    st.eye = approach(st.eye, eye > 0.5 ? 1 : 0, dt, 0.11, 0.2);
    // ciała niebieskie: bliskość (log odległości), szerokość z rozmiaru, wyłonienie po echu impulsu (sprężyna z przerzutem)
    for (const p of v.planets) {
      if (p.path) p.d = p.path(T);
      p.x = v.x + Math.cos(p.bearing) * p.d;
      p.y = v.y + Math.sin(p.bearing) * p.d;
      p.c = Math.max(0, Math.min(1, 1 - Math.log10(p.d / (8 * KM)) / 2.4));
      p.sigma = Math.max(0.13, Math.min(0.7, 0.13 + 1.8 * p.R / p.d));
      const delay = 0.12 + 0.1 * Math.log2(1 + p.d / (10 * KM));
      const target = v.on && v.onAge > delay ? 1 : 0;
      if (dt > 0) {
        p.revV += ((target - p.rev) * 70 - p.revV * 9) * dt;
        p.rev = Math.max(0, p.rev + p.revV * dt);
      }
    }
  }

  const toS = (cam, W, H, x, y) => [(x - cam.x) * cam.zoom + W * 0.5, (y - cam.y) * cam.zoom + H * 0.5];
  /** Promień bazowy błony [px CSS]: obrys kadłuba + ślad. */
  const blonaR = (cam, sig) => ATLAS_LEN * 0.5 * cam.zoom * 0.72 + 8 + 26 * sig;
  const strunaR = (cam) => blonaR(cam, 1.6) + 50;      // poza błoną z wybrzuszeniami

  function packStruna(A, cam, W, H, pxs) {
    const v = st.view;
    let n = 0;
    const [sx, sy] = toS(cam, W, H, v.x, v.y);
    for (const g of v.groups) {
      if (g.reveal < 0.002 || n >= NAMIAR_MARKS) continue;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * n;
      A[o].set(g.da, g.nBig, g.nSmall, g.reveal);
      A[o + 1].set(g.det, g.est, g.seed, Math.max(0, 1 - g.flashAge / 0.6));
      A[o + 2].set(0, 0, 0, 0);
      A[o + 3].set(0, 0, 0, 0);
      n++;
    }
    const a = NAMIAR_HDR;
    A[a].set(sx * pxs, sy * pxs, strunaR(cam) * pxs, v.phi);
    A[a + 1].set(STR_HALF, (v.amp + 7 * v.pluck) * pxs, v.tau, v.vis);
    A[a + 2].set(v.det, 0, n, Math.min(1, v.harm + 0.5 * v.pluck));
    A[a + 3].set(0.37, 0, 0, 0);
    A[0].set(n, st.time % 600, pxs, 1);
  }

  function packBlona(A, cam, W, H, pxs) {
    const v = st.view;
    let n = 0;
    const [sx, sy] = toS(cam, W, H, v.x, v.y);
    for (const p of v.planets) {
      if (n >= NAMIAR_MARKS) break;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * n;
      A[o].set(p.bearing, p.c, p.sigma, p.rev);
      A[o + 1].set(p.kind, p.seed, 0, 0);
      A[o + 2].set(0, 0, 0, 0);
      A[o + 3].set(0, 0, 0, 0);
      n++;
    }
    const a = NAMIAR_HDR;
    A[a].set(sx * pxs, sy * pxs, blonaR(cam, v.sig) * pxs, v.sig);
    A[a + 1].set(0, n, 0.21, v.vis);
    A[a + 2].set(v.on ? v.onAge : -1, 0, 0, 0);
    A[0].set(n, st.time % 600, pxs, 1);
  }

  // WACHLARZ (druga runda, do porównania): przy mnie niebieski z `me`, przy wrogu (albo przy krawędzi ekranu) czerwony z `them`.
  function packWachlarz(A, cam, W, H, pxs) {
    const v = st.view;
    const [sx, sy] = toS(cam, W, H, v.x, v.y);
    const myR0 = Math.max(10, ATLAS_LEN * 0.5 * cam.zoom + 14);
    let n = 0;
    const put = (x, y, r0, dir, ratio, est, seed, side) => {
      if (n >= NAMIAR_MARKS) return;
      const o = NAMIAR_MARK_BASE + NAMIAR_MARK_VEC * n;
      A[o].set(x * pxs, y * pxs, r0 * pxs, dir);
      A[o + 1].set(ratio, est, seed, side);
      A[o + 2].set(0, 0, OFF, 0);
      A[o + 3].set(9, 0, 0, 0);
      n++;
    };
    for (const g of v.groups) put(sx, sy, myR0, g.bearing, g.me, 0, g.seed, 0);
    for (const g of v.groups) {
      const [ex, ey] = toS(cam, W, H, g.x, g.y);
      const e = edgeClamp(sx, sy, ex, ey, W, H, 16);
      put(e.x, e.y, e.edge ? 6 : Math.max(10, ENEMY_LEN * 0.5 * cam.zoom + 12), Math.atan2(sy - e.y, sx - e.x), g.them, g.est, g.seed, 1);
    }
    A[0].set(n, st.time % 600, pxs, 0);
  }

  function edgeClamp(sx, sy, ex, ey, W, H, inset) {
    const x0 = inset, y0 = inset, x1 = W - inset, y1 = H - inset;
    if (ex >= x0 && ex <= x1 && ey >= y0 && ey <= y1) return { x: ex, y: ey, edge: false };
    const dx = ex - sx, dy = ey - sy;
    let k = 1;
    if (dx > 1e-6) k = Math.min(k, (x1 - sx) / dx);
    if (dx < -1e-6) k = Math.min(k, (x0 - sx) / dx);
    if (dy > 1e-6) k = Math.min(k, (y1 - sy) / dy);
    if (dy < -1e-6) k = Math.min(k, (y0 - sy) / dy);
    return { x: sx + dx * k, y: sy + dy * k, edge: true };
  }

  /** `variant`: czujka (struna + błona) | struna | blona | wachlarz. */
  function sync(variant, cam, W, H, on) {
    const pxs = core.pxScale || core.pixelRatio || 1;
    const bw = core.composerTarget?.width || W * pxs;
    const bh = core.composerTarget?.height || H * pxs;
    st.distLive = false;
    const v = st.view;
    if (v) { const [sx, sy] = toS(cam, W, H, v.x, v.y); v.sx = sx; v.sy = sy; }
    for (let i = 0; i < meshes.length; i++) {
      const style = NAMIAR_STYLES[i];
      const vis = !!on && !!v && (variant === style || (variant === 'czujka' && style !== 'wachlarz'));
      meshes[i].visible = vis;
      parts[i].rect.value.set(-1, -1, 1e9, 1e9);
      if (parts[i].dist) {
        parts[i].dist.visible = vis;
        if (vis) st.distLive = true;
      }
      if (!vis) continue;
      const A = blocks[i].array;
      if (style === 'struna') packStruna(A, cam, W, H, pxs);
      else if (style === 'blona') packBlona(A, cam, W, H, pxs);
      else packWachlarz(A, cam, W, H, pxs);
      A[1].set(bw, bh, 0, 0);
    }
    // kursor: własna ręka — myszka; skrypt — punkt 250 px od okrętu w kierunku celowania
    if (v) {
      if (st.manual) { st.cursor.x = st.mouse.x; st.cursor.y = st.mouse.y; }
      else { st.cursor.x = v.sx + Math.cos(v.aimTarget) * 250; st.cursor.y = v.sy + Math.sin(v.aimTarget) * 250; }
    }
  }

  /** Mysz z kanwy (px CSS): PPM przejmuje sterowanie od skryptu. */
  function mouse(kind, x, y) {
    st.mouse.x = x; st.mouse.y = y;
    if (kind === 'down') { st.manual = true; st.mouse.rmb = true; }
    else if (kind === 'up') st.mouse.rmb = false;
  }

  // ---------------------------------------------------------------- nakładka 2D (okręty, ciała, kursor z okiem, podpisy)
  function drawEye(ctx, x, y, open, t) {
    const w = 17;
    const o = Math.max(0, Math.min(1, open));
    const red = o > 0.5;
    const rgb = red ? '255, 112, 104' : '170, 205, 225';
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = `rgba(${rgb}, ${red ? 0.9 : 0.4})`;
    ctx.shadowBlur = red ? 10 : 4;
    const hU = 1.5 + 12 * o, hL = 4.5 + 6.5 * o;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, -hU, w, 0);
    ctx.quadraticCurveTo(0, hL, -w, 0);
    ctx.closePath();
    if (o > 0.05) {
      ctx.fillStyle = 'rgba(8, 10, 14, 0.85)';
      ctx.fill();
      ctx.save();
      ctx.clip();
      const look = Math.sin(t * 1.7) * 1.2;
      ctx.beginPath();
      ctx.arc(look, -0.3, 6.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${0.95 * o})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(look, -0.3, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(10, 4, 4, 0.95)';
      ctx.fill();
      ctx.restore();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(${rgb}, 0.95)`;
    ctx.stroke();
    if (o < 0.3) {
      // zamknięte: rzęsy w dół
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (const k of [-0.55, 0, 0.55]) {
        const px = k * w, py = (1 - k * k) * hL * 0.5;
        ctx.moveTo(px, py);
        ctx.lineTo(px * 1.15, py + 5);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlanet(ctx, x, y, r, kind) {
    const cols = [['150, 120, 100', '40, 30, 26'], ['200, 170, 120', '60, 45, 30'], ['120, 170, 210', '20, 35, 55'], ['255, 230, 160', '200, 120, 40']][kind];
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    g.addColorStop(0, `rgb(${cols[0]})`);
    g.addColorStop(1, `rgb(${cols[1]})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawOverlay(ctx, cam, W, H, variant, atlasImg, text, labels) {
    const v = st.view;
    if (!v) return;
    const [sx, sy] = toS(cam, W, H, v.x, v.y);
    for (const p of v.planets) {
      const [px, py] = toS(cam, W, H, p.x, p.y);
      const r = p.R * cam.zoom;
      if (px + r > 0 && px - r < W && py + r > 0 && py - r < H) {
        drawPlanet(ctx, px, py, r, p.kind);
        if (labels) text(p.name, px, py + r + 6, '170, 190, 205', 0.7, 10);
      }
    }
    if (atlasImg?.complete && atlasImg.naturalWidth) {
      const L = ATLAS_LEN * cam.zoom;
      ctx.save();
      ctx.globalAlpha = 0.97;
      ctx.drawImage(atlasImg, sx - L / 2, sy - L * 1677 / 3747 / 2, L, L * 1677 / 3747);
      ctx.restore();
    }
    for (const g of v.groups) {
      if (!g.sprites) continue;
      const [ex, ey] = toS(cam, W, H, g.x, g.y);
      if (ex < -40 || ex > W + 40 || ey < -40 || ey > H + 40 || !enemyImg.complete || !enemyImg.naturalWidth) continue;
      const L = ENEMY_LEN * cam.zoom;
      const asp = enemyImg.naturalHeight / enemyImg.naturalWidth;
      const a = Math.atan2(sy - ey, sx - ex);
      for (let s = 0; s < g.sprites; s++) {
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
      text('ATLAS', sx, sy + ATLAS_LEN * 0.27 * cam.zoom + 4, '159, 220, 255', 0.75, 10);
      // co jest w namiarze (podpis do oceny — w grze nie musi być)
      let best = null;
      for (const g of v.groups) if (g.reveal > 0.5 && (!best || g.m > best.m)) best = g;
      const head = v.on ? (best
        ? `CZUJKA · w namiarze: ${best.name} · ${(best.d / KM).toFixed(0)} km · oni ${(best.them * 100).toFixed(0)}%${best.det > 0.5 ? ' · WYKRYLI MNIE' : ''}`
        : 'CZUJKA · w namiarze nic technologicznego') : 'PPM — czujka';
      text(head, W / 2, 16, best && best.det > 0.5 ? '255, 150, 140' : '220, 230, 240', 0.88, 12);
      if (st.caption) text(`${st.caption} · mój ślad ×${v.sig.toFixed(2).replace('.', ',')}`, W / 2, 34, '200, 214, 226', 0.75, 11);
    }
    // kursor: celownik + oko (zamknięte — nie widzą mnie; otwarte — grupa w namiarze widzi mnie)
    if (v.vis > 0.05 || st.manual) {
      const cx = st.cursor.x, cy = st.cursor.y;
      ctx.save();
      ctx.globalAlpha = Math.min(1, v.vis * 1.5 + 0.2);
      ctx.strokeStyle = 'rgba(220, 235, 245, 0.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - 7, cy); ctx.lineTo(cx - 2.5, cy);
      ctx.moveTo(cx + 2.5, cy); ctx.lineTo(cx + 7, cy);
      ctx.moveTo(cx, cy - 7); ctx.lineTo(cx, cy - 2.5);
      ctx.moveTo(cx, cy + 2.5); ctx.lineTo(cx, cy + 7);
      ctx.stroke();
      drawEye(ctx, cx + 30, cy + 22, st.eye, st.time);
      ctx.restore();
    }
  }

  return {
    meshes, dists, st, setScene, step, sync, drawOverlay, mouse,
    warmupObjects: () => meshes.slice(),
    get distLive() { return st.distLive; }
  };
}

export { NAMIAR_GEOM, NAMIAR_ANCH, NAMIAR_ANCH_VEC };
