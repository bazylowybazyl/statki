// Drżenie efektów w GRZE na WebGPU (port WebGPU, zadanie 23, krok 3) — następca dema/precyzja-drzenie.js
// dla modułów, które zadania 12–22 przeniosły do pul GPU z początkiem przy kamerze (FxPoolOrigin): pociski
// (ProjectileSystem), smugi (TrailSystem), wiązki, pule gpuFx (dym, odłamki, błyski ADD, iskry, łuki), iskry
// rakiet i tarcia (SparkPool), dym i ciała rakiet, bank Fx3D, dysze MAIN i SIDE, światła pozycyjne.
//
// Metoda jak precyzja-drzenie.js (tamto demo mostków nie ma pul efektów gry): kamera co klatkę o DOKŁADNIE
// 1 px po przekątnej, okno odczytu przesunięte o k px; w każdej klatce moduł wył. i wł. — różnica to SAM
// wkład modułu (tło i reszta sceny się znoszą); Lucas–Kanade → przesunięcie; drżenie = reszty po odjęciu
// stałego dryfu (pass FG ma kamerę perspektywiczną: z > 0 jedzie odrobinę szybciej niż płaszczyzna gry).
// Scena: gra z harnessem (scripts/webgpu/harness-strona.js) — czas stoi, więc efekty i fizyka nie kroczą;
// bitwa jak scena `bitwa` harnessu (3 piratów vs 2 Terra Nova, salwa rakiet, 180 klatek walki) w punkcie
// świata z przypadku (0,12 mln — precyzja bez znaczenia; 7 mln — start gracza; 9,9 mln — krok float32 = 1 j.),
// potem pomiar. Bloom, promienie słońca, gorące powietrze i zniekształcenia wyłączone (przesuwają piksele
// albo rozlewają błysk); pozostałe moduły i kadłuby schowane w passach (hak passa Core3D), bank Fx3D stoi.
// Okno: blok kanwy z największym wkładem modułu (różnica wł./wył. na całej kanwie).
//
//   node scripts/webgpu/drzenie-gra.mjs [--klatki 16] [--moduly pociski,smugi] [--miejsca 7M,9.9M]
//        [--out .tmp/webgpu/zadania/23/drzenie] [--port 5361]
//
// Wynik: <out>/drzenie.json (podsumowania, przesunięcia klatek), <out>/<miejsce>_<moduł>_z<zoom>.png (klatka 0
// modułu) i ..._roznica.png (ostatnia klatka − pierwsza: czerwony jaśniej, zielony ciemniej, niebieski = maska).
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const FRAMES = Math.max(6, Number(args.klatki || 16));
const port = Number(args.port || 5361);
const outDir = resolve(repo, args.out || '.tmp/webgpu/zadania/23/drzenie');
mkdirSync(outDir, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

// Punkty świata jak w precyzja-drzenie.js (start gracza ~7,08 / 6,29 mln; 9,9 mln — krok float32 = 1 j.).
const MIEJSCA = { '0': [120000, 120000], '7M': [7075238.77, 6289731.51], '9.9M': [9874885.3, 8289731.4] };
// Zoom 1,8 / 0,9: krok kamery 1 px niewspółmierny z siatką float32 (jak ruch kamery w grze); zoom 2 przy 7 mln
// trafia w siatkę 0,5 j. (przypadek z docs/PORT-mostki.md §8.12).
const ZOOMY = { '0': [1.8], '7M': [1.8, 0.9, 2], '9.9M': [1.8] };
// Moduły: nazwy obiektów (mesh.name) albo materiałów (material.name) w Core3D.scene; `baza` — przypadek z
// docs/webgpu/baseline.json § drzenie (moduł sprzed portu), `nowy` — próg ≤ 0,01 px RMS (zadanie 23).
const MODULY = {
  pociski: { obiekty: ['wfxProjectiles'], baza: 'bullets', nowy: true },
  smugi: { obiekty: ['wfxTrails'], baza: 'trails', nowy: true },
  wiazki: { obiekty: ['wfxBeams'], nowy: true },
  blyski: { obiekty: ['wfxAdd'], baza: 'muzzle', nowy: true },
  iskryBroni: { obiekty: ['wfxSparks', 'wfxArcs'], nowy: true },
  dymBroni: { obiekty: ['wfxSmoke'], nowy: true },
  odlamki: { obiekty: ['wfxDebris'], nowy: true },
  iskry: { obiekty: ['SparkPool'], baza: 'sparks', nowy: true },
  dymRakiet: { obiekty: ['RocketSmoke'], nowy: true },
  rakiety: { obiekty: ['RocketBodies', 'RocketPlumes', 'RocketGlow', 'RocketFireballs', 'RocketArcs'], nowy: true },
  fx3d: { przedrostek: 'FX3D_', baza: 'fx' },
  dysze: { obiekty: ['MainExhaustJets'], materialy: ['EngineFlame', 'EngineHeatGlow', 'EngineHeatRing', 'EngineFlare'], baza: 'exhaust' },
  swiatla: { obiekty: ['SHIP_NAV_LIGHTS'], baza: 'lights' }
};
const tylkoModuly = args.moduly ? new Set(args.moduly.split(',')) : null;
const tylkoMiejsca = args.miejsca ? args.miejsca.split(',') : Object.keys(MIEJSCA);
const baseline = JSON.parse(readFileSync(join(repo, 'docs/webgpu/baseline.json'), 'utf8')).drzenie?.px || {};

// --- w stronie: analiza klatek (kopia z dema/precyzja-drzenie.js — ta sama metoda) --------------------
function analyze(frames, firstImg, RW, RH) {
  const L0 = frames[0];
  const mask = new Uint8Array(RW * RH);
  let maskN = 0;
  for (let y = 2; y < RH - 2; y++) {
    for (let x = 2; x < RW - 2; x++) {
      const i = y * RW + x;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(L0[i + dy * RW + dx]) > 4) { any = true; break; }
        }
      }
      if (any) { mask[i] = 1; maskN++; }
    }
  }
  const sample = (L, x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const at = (xx, yy) => L[Math.max(0, Math.min(RH - 1, yy)) * RW + Math.max(0, Math.min(RW - 1, xx))];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const res = [];
  for (let k = 1; k < frames.length; k++) {
    const Lk = frames[k];
    let best = [0, 0];
    let bestE = Infinity;
    for (let oy = -3; oy <= 3; oy++) {
      for (let ox = -3; ox <= 3; ox++) {
        let e = 0;
        for (let y = 4; y < RH - 4; y++) {
          for (let x = 4; x < RW - 4; x++) {
            const i = y * RW + x;
            if (!mask[i]) continue;
            const d = Lk[(y + oy) * RW + x + ox] - L0[i];
            e += d * d;
          }
        }
        if (e < bestE) { bestE = e; best = [ox, oy]; }
      }
    }
    let dx = best[0];
    let dy = best[1];
    for (let it = 0; it < 6; it++) {
      let a = 0; let b = 0; let cc = 0; let ex = 0; let ey = 0;
      for (let y = 4; y < RH - 4; y++) {
        for (let x = 4; x < RW - 4; x++) {
          const i = y * RW + x;
          if (!mask[i]) continue;
          const gx = (sample(Lk, x + dx + 1, y + dy) - sample(Lk, x + dx - 1, y + dy)) * 0.5;
          const gy = (sample(Lk, x + dx, y + dy + 1) - sample(Lk, x + dx, y + dy - 1)) * 0.5;
          const e = sample(Lk, x + dx, y + dy) - L0[i];
          a += gx * gx; b += gx * gy; cc += gy * gy; ex += gx * e; ey += gy * e;
        }
      }
      const det = a * cc - b * b;
      if (Math.abs(det) < 1e-9) break;
      const ux = (cc * ex - b * ey) / det;
      const uy = (a * ey - b * ex) / det;
      dx -= ux; dy -= uy;
      if (Math.hypot(ux, uy) < 1e-3) break;
    }
    let mad = 0;
    let n = 0;
    for (let y = 4; y < RH - 4; y++) {
      for (let x = 4; x < RW - 4; x++) {
        const i = y * RW + x;
        if (!mask[i]) continue;
        mad += Math.abs(Lk[i] - L0[i]);
        n++;
      }
    }
    res.push({ k, dx: +dx.toFixed(3), dy: +dy.toFixed(3), mad: +(mad / Math.max(1, n)).toFixed(3) });
  }
  const mags = res.map((r) => Math.hypot(r.dx, r.dy));
  const steps = res.map((r, i) => (i ? Math.hypot(r.dx - res[i - 1].dx, r.dy - res[i - 1].dy) : mags[0]));
  let kk = 0; let kx = 0; let ky = 0;
  for (const r of res) { kk += r.k * r.k; kx += r.k * r.dx; ky += r.k * r.dy; }
  const vx = kx / kk;
  const vy = ky / kk;
  const resid = res.map((r) => Math.hypot(r.dx - vx * r.k, r.dy - vy * r.k));
  const summary = {
    maskPx: maskN,
    shiftRmsPx: +Math.sqrt(mags.reduce((q, v) => q + v * v, 0) / mags.length).toFixed(3),
    shiftMaxPx: +Math.max(...mags).toFixed(3),
    stepMaxPx: +Math.max(...steps).toFixed(3),
    driftPxPerFrame: [+vx.toFixed(4), +vy.toFixed(4)],
    jitterRmsPx: +Math.sqrt(resid.reduce((q, v) => q + v * v, 0) / resid.length).toFixed(3),
    jitterMaxPx: +Math.max(...resid).toFixed(3),
    madMean: +(res.reduce((q, r) => q + r.mad, 0) / res.length).toFixed(3)
  };
  const cv = document.createElement('canvas');
  cv.width = RW;
  cv.height = RH;
  const cx = cv.getContext('2d');
  cx.putImageData(firstImg, 0, 0);
  const png = cv.toDataURL('image/png').split(',')[1];
  const Ln = frames[frames.length - 1];
  const dimg = new ImageData(RW, RH);
  for (let j = 0; j < Ln.length; j++) {
    const d = Ln[j] - L0[j];
    dimg.data[j * 4] = d > 0 ? Math.min(255, d * 8) : 0;
    dimg.data[j * 4 + 1] = d < 0 ? Math.min(255, -d * 8) : 0;
    dimg.data[j * 4 + 2] = mask[j] ? 90 : 0;
    dimg.data[j * 4 + 3] = 255;
  }
  cx.putImageData(dimg, 0, 0);
  const diff = cv.toDataURL('image/png').split(',')[1];
  return { summary, frames: res, png, diff };
}

// --- w stronie: pomiar modułu -------------------------------------------------------------------------
async function probe(opts, MOD, analyze) {
  const H = window.__harness;
  const S = H.scene;
  const C = window.Core3D;
  const match = (spec) => (o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return false;
    const n = o.name || '';
    const mn = o.material?.name || '';
    return (spec.obiekty && spec.obiekty.includes(n)) || (spec.materialy && spec.materialy.includes(mn))
      || (spec.przedrostek && n.startsWith(spec.przedrostek));
  };
  const find = (spec) => { const out = []; C.scene.traverse((o) => { if (match(spec)(o)) out.push(o); }); return out; };
  const target = find(MOD[opts.modul]);
  if (!target.length) return { summary: { error: 'brak siatek modułu' } };
  const others = [];
  for (const [k, spec] of Object.entries(MOD)) if (k !== opts.modul) others.push(...find(spec));
  // kadłuby (partie skór, pojedyncze siatki kadłubów, impostory), tarcze i odłamki kadłubów — schowane; tło
  // i planety też (warstwy 1, 3, 5, 6: gwiazdy i mgławica z paralaksą przesuwają się pod efektem inaczej niż
  // świat — po ACES różnica wł./wył. addytywnego efektu zależy od tła pod nim: „kropki” wzdłuż smug). Pass tła
  // zostaje (czyści bufor sceny), rysuje pustkę.
  const TLO = (1 << 1) | (1 << 3) | (1 << 5) | (1 << 6);
  C.scene.traverse((o) => {
    const mn = o.material?.name || '';
    if (/^hull:|^ShieldHull|^ShieldSphere|^ShieldImpact/.test(mn) || /^hullSkinBatch:/.test(o.name || '')) others.push(o);
    else if ((o.isMesh || o.isPoints || o.isLine || o.isSprite) && (o.layers.mask & TLO) !== 0 && (o.layers.mask & 5) === 0) others.push(o);
  });
  const origVis = new Map();
  for (const m of [...target, ...others]) origVis.set(m, m.visible);
  // Widoczność w hakach passów: moduły ustawiają visible same w swoich krokach (część w klatce efektów W ŚRODKU
  // Core3D.render), więc chowamy tuż przed każdym passem sceny.
  const st = window.__drzenie = { off: false };
  const hook = () => {
    for (let i = 0; i < others.length; i++) others[i].visible = false;
    if (st.off) for (let i = 0; i < target.length; i++) target[i].visible = false;
  };
  const names = C._scenePasses.filter((p) => p && p.name).map((p) => p.name);
  for (const n of names) C.addPassHook(n, hook);
  // Odczyt SAMEJ warstwy 3D: kopia kanwy WebGPU (drawHexShips3D: drawImage na #c) przechwycona do własnej
  // kanwy w tym samym zadaniu — HUD 2D rysowany potem na #c (celownik przy kursorze stoi na ekranie, gdy
  // kamera jedzie) zasłaniał część efektu i udawał przesunięcie.
  const c2 = document.getElementById('c');
  let canvas = window.__drzenieKanwa;
  if (!canvas) {
    canvas = window.__drzenieKanwa = document.createElement('canvas');
    canvas.width = c2.width;
    canvas.height = c2.height;
    const cx3 = canvas.getContext('2d', { willReadFrequently: true });
    const P = CanvasRenderingContext2D.prototype;
    const orig = P.drawImage;
    P.drawImage = function (src, ...r) {
      if (src === window.Core3D?.canvas && this !== cx3) { cx3.clearRect(0, 0, canvas.width, canvas.height); orig.call(cx3, src, ...r); }
      return orig.call(this, src, ...r);
    };
  }
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const lumOf = (d, n) => {
    const L = new Float32Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) L[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) * d[i + 3] / 255;
    return L;
  };
  const cleanup = () => {
    for (const n of names) C.removePassHook(n, hook);
    for (const [m, v] of origVis) m.visible = v;
    window.__drzenie = null;
  };
  try {
    const Wc = canvas.width;
    const Hc = canvas.height;
    const RW = 360;
    const RH = 260;
    const B = 40;
    // Blok 40 px z największym wkładem modułu (różnica wł./wył. na całej kanwie) przy kamerze (x, y, zoom).
    const najjasniejszy = async (x, y, zoom, margin) => {
      S.cam(x, y, zoom);
      st.off = true; await H.frames(2);
      const full0 = lumOf(g.getImageData(0, 0, Wc, Hc).data, Wc * Hc);
      st.off = false; await H.frames(2);
      const full1 = lumOf(g.getImageData(0, 0, Wc, Hc).data, Wc * Hc);
      let best = -1;
      let bx = Wc / 2;
      let by = Hc / 2;
      for (let yy0 = margin + B / 2; yy0 + B / 2 + margin < Hc; yy0 += B) {
        for (let xx0 = margin + B / 2; xx0 + B / 2 + margin < Wc; xx0 += B) {
          let s = 0;
          for (let yy = yy0 - B / 2; yy < yy0 + B / 2; yy++) for (let xx = xx0 - B / 2; xx < xx0 + B / 2; xx++) s += Math.abs(full1[yy * Wc + xx] - full0[yy * Wc + xx]);
          if (s > best) { best = s; bx = xx0; by = yy0; }
        }
      }
      return { best, bx, by, x: x + (bx - Wc / 2) / zoom, y: y + (by - Hc / 2) / zoom };
    };
    // 1. szeroki kadr (zoom 0,25) nad bitwą — gdzie jest moduł (świat), 2. kamera tam w zoomie przypadku
    const szeroki = await najjasniejszy(opts.cx, opts.cy, 0.25, 8);
    if (szeroki.best <= 0) return { summary: { error: 'moduł niewidoczny (szeroki kadr)', meshes: target.length } };
    const margin = opts.frames + 8;
    const b = await najjasniejszy(szeroki.x, szeroki.y, opts.zoom, Math.max(margin + RW / 2, margin + RH / 2));
    if (b.best <= 0) return { summary: { error: 'moduł niewidoczny w kadrze', meshes: target.length } };
    const base = { x: szeroki.x, y: szeroki.y };
    const best = b.best;
    const bx = Math.max(RW / 2 + margin, Math.min(Wc - RW / 2 - margin, b.bx));
    const by = Math.max(RH / 2 + margin, Math.min(Hc - RH / 2 - margin, b.by));
    // okno przesuwa się w lewo-górę o k px (kamera jedzie w prawo-dół), zaczyna w prawo-dół od bloku
    const R = { x: Math.round(bx - RW / 2 + opts.frames / 2), y: Math.round(by - RH / 2 + opts.frames / 2) };
    const frames = [];
    let firstImg = null;
    for (let k0 = 0; k0 < opts.frames; k0++) {
      // --staly: kamera stoi (kontrola metody: wkład modułu nie może się zmieniać z klatki na klatkę)
      const k = opts.staly ? 0 : k0;
      S.cam(base.x + k / opts.zoom, base.y + k / opts.zoom, opts.zoom);
      st.off = true; await H.frames(1);
      const Loff = lumOf(g.getImageData(R.x - k, R.y - k, RW, RH).data, RW * RH);
      st.off = false; await H.frames(1);
      const img = g.getImageData(R.x - k, R.y - k, RW, RH);
      const Lk = lumOf(img.data, RW * RH);
      if (!firstImg) firstImg = img;
      for (let i = 0; i < Lk.length; i++) Lk[i] -= Loff[i];
      frames.push(Lk);
    }
    const out = analyze(frames, firstImg, RW, RH);
    Object.assign(out.summary, { meshes: target.length, blokWkladu: +best.toFixed(0), okno: [R.x, R.y],
      polozenieSiatki: [+target[0].position.x.toFixed(2), +target[0].position.y.toFixed(2)] });
    return out;
  } finally {
    cleanup();
  }
}

const { server, base } = await startVite(port);
const wynik = { klatki: FRAMES, when: new Date().toISOString(), przypadki: [] };
try {
  for (const miejsce of tylkoMiejsca) {
    const P = MIEJSCA[miejsce];
    if (!P) throw new Error(`nieznane miejsce ${miejsce}`);
    const chrome = await startChrome({ width: 1920, height: 1080 });
    const logs = await attachLogs(chrome);
    const { cdp } = chrome;
    const ev = (e, t = 300000) => evaluate(cdp, e, t);
    try {
      await osobneLosowanieUuid(cdp);
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
      await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
      if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
      await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
      if (!await waitFor(cdp, 'window.DevScene.preloadHullSprites()', 120000, 250)) throw new Error('sprite’y kadłubów');
      await ev('window.__harness.hold(true)');
      // Bitwa jak scena `bitwa` harnessu + salwa rakiet piratów, 180 klatek walki; potem czas stoi.
      const stan = await ev(`(async () => { const S = window.__harness.scene, H = window.__harness; H.reseed(0x23d); S.hideHud(true);
        DevScene.teleport(${P[0]}, ${P[1]}, 0);
        const s = ship; const at = (fx, fy) => ({ x: s.pos.x + fx, y: s.pos.y + fy });
        spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, -900), spawnAngle: Math.PI });
        spawnCallInShip('destroyer', { mode: 'pirate', spawnPos: at(3000, 900), spawnAngle: Math.PI });
        spawnCallInShip('pirate_battleship', { mode: 'pirate', spawnPos: at(4000, 0), spawnAngle: Math.PI });
        spawnCallInShip('destroyer', { mode: 'friendly', spawnPos: at(600, -1200), spawnAngle: 0 });
        spawnCallInShip('battleship', { mode: 'friendly', spawnPos: at(-300, 1100), spawnAngle: 0 });
        S.cam(s.pos.x + 1800, s.pos.y, 0.3);
        let it = 0; for (; it < 400 && !S.hullsReady(); it++) await H.frames(2);
        H.reseed(0xb17a);
        await H.step(120);
        const W = window.MASTER_WEAPONS?.missile_rack;
        const cel = (window.npcs || []).find((n) => !n.dead && n.friendly);
        if (W && cel && window.rocketSystem3D) for (let i = 0; i < 4; i++) window.rocketSystem3D.fire(s.pos.x + 3000, s.pos.y - 300 + i * 200, cel, 1, W, 'blue', 0, 0);
        await H.step(60);
        // Środek bitwy: średnia żywych okrętów
        const L = (window.npcs || []).filter((n) => !n.dead);
        const cx = L.reduce((a, n) => a + n.x, 0) / Math.max(1, L.length);
        const cy = L.reduce((a, n) => a + n.y, 0) / Math.max(1, L.length);
        // Pomiar: bez bloomu, promieni, gorącego powietrza i zniekształceń; bez passu tła i planet (gwiazdy
        // i mgławica z paralaksą przesuwają się pod efektem inaczej niż świat — po ACES różnica wł./wył. addytywnego
        // efektu zależy od tła pod nim: „kropki” wzdłuż smug); bank Fx3D stoi (WeaponFx.sync dokłada ≥ 1 ms zegara
        // iskier na klatkę także przy stojącym czasie — migotanie to nie ruch).
        Core3D.setPerfToggles({ bloom: false, godRays: false, heatHaze: false, fxDistortion: false });
        const Fx = window.Fx3D; if (Fx && !Fx.__drzenieUpdate) { const u = Fx.update; Fx.__drzenieUpdate = u; Fx.update = function () { return u.call(this, 0); }; }
        return { cx, cy, npc: L.length, kadluby: S.hullsReady(), rakiety: window.rocketSystem3D?.activeRockets ?? null }; })()`);
      console.log(`== ${miejsce}: ${JSON.stringify(stan)}`);
      for (const zoom of ZOOMY[miejsce]) {
        for (const modul of Object.keys(MODULY)) {
          if (tylkoModuly && !tylkoModuly.has(modul)) continue;
          const opts = { modul, zoom, frames: FRAMES, cx: stan.cx, cy: stan.cy, staly: !!args.staly };
          const r = await ev(`(${probe.toString()})(${JSON.stringify(opts)}, ${JSON.stringify(MODULY)}, ${analyze.toString()})`);
          const s = r.summary;
          const id = `${miejsce}_${modul}_z${zoom}`;
          const bazaKey = MODULY[modul].baza ? `${MODULY[modul].baza}_${miejsce === '0' ? '0' : miejsce}_z${zoom}` : null;
          const bazaVal = bazaKey ? baseline[bazaKey] : null;
          wynik.przypadki.push({ id, miejsce, modul, zoom, ...s, frames: r.frames, baza: bazaVal ? { klucz: bazaKey, ...bazaVal } : null });
          if (s.error) { console.log(`  ${id.padEnd(26)} — ${s.error}`); continue; }
          writeFileSync(join(outDir, `${id}.png`), Buffer.from(r.png, 'base64'));
          writeFileSync(join(outDir, `${id}_roznica.png`), Buffer.from(r.diff, 'base64'));
          const prog = MODULY[modul].nowy ? ' (próg 0,01)' : bazaVal?.rms !== undefined ? ` (baza ${bazaVal.rms})` : '';
          console.log(`  ${id.padEnd(26)} siatki ${String(s.meshes).padStart(2)} maska ${String(s.maskPx).padStart(6)} | przesunięcie RMS ${s.shiftRmsPx.toFixed(3)} maks ${s.shiftMaxPx.toFixed(3)} | dryf ${s.driftPxPerFrame.join(',')} | drżenie RMS ${s.jitterRmsPx.toFixed(3)} maks ${s.jitterMaxPx.toFixed(3)}${prog}`);
        }
      }
      wynik.bledy = [...(wynik.bledy || []), ...logs.errors().slice(0, 10)];
    } finally {
      await chrome.close();
    }
  }
} finally {
  await server.close();
  writeFileSync(join(outDir, 'drzenie.json'), JSON.stringify(wynik, null, 1));
  console.log(`zapisano ${join(outDir, 'drzenie.json')}`);
}
