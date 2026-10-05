// Widoczność w walce (2026-10-05): ile obrazu zasłaniają efekty, tarcze, światła i bloom, gdy Atlas jest pod
// ostrzałem pirackiego superkapitału w misji 1 (faza obrony stoczni). PRAWDZIWA gra: Vite + headless Chrome z
// WebGPU (CDP), gracz nic nie robi (wieże na auto strzelają same).
//
//   node scripts/webgpu/widocznosc-gra.mjs [--rozmiar 1920x1080] [--out .tmp/widocznosc] [--czas 120]
//        [--zoom 0.18] [--blisko 6000] [--kadry 3]
//
// 1) Faza obrony (?story=defences): co 2 s stan (odległość superkapitału, pociski Goliatha przy graczu, tarcza,
//    kadłub, zoom) i zrzut „jak widzi gracz”.
// 2) Gdy Goliath bije w Atlasa (≥ --pociski pocisków w promieniu 3 km), --kadry razy: pauza gry + zamrożony zegar
//    strony (performance.now — efekty GPU stoją, render biegnie) i ta sama klatka w wariantach: wszystko, bez
//    bloomu, bez dymu / błysków / iskier / pocisków / zniekształceń / tarcz / świateł efektów, czysto (bez
//    wszystkiego) i czysto + bloom. Miary w obrysie Atlasa i superkapitału: średnia różnica od kadru „czysto”,
//    udział pikseli zmienionych o > 40 / 255 („zasłonięte”), przepalone (min kanał > 235), jasność.
// --zoom: stały zoom kamery na czas pomiaru (domyślnie zoom gry — Atlas na 20% szerokości kadru).
// --blisko N: gdy superkapitał nie podejdzie sam, po 45 s gracz przenosi się N j. przed jego dziób.
//
//   node scripts/webgpu/widocznosc-gra.mjs --tryb ostrzal [--przerwa 10000]
//
// --tryb ostrzal: gra swobodna, Atlas w pustej przestrzeni, trafienia w tarczę wstrzykiwane przez
//   window.registerShieldImpact (sam obraz, bez obrażeń) z kadencją 9 × Goliath — te same trafienia w wariantach
//   (klasa efektu tarczy, ShieldTuning, próg bloomu, tabela BARRAGE); miary jak wyżej względem kadru bez trafień.
// Wynik: <out>/*.png, <out>/raport.json.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';
import { readPng } from './png.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1920x1080').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/widocznosc');
const czas = Number(args.czas || 120);
const kadry = Number(args.kadry || 3);
const progPociskow = Number(args.pociski || 6);
mkdirSync(out, { recursive: true });

// Podmiany źródeł w serwerze Vite (pliki na dysku bez zmian): [plik, [[było, jest], …], wymagane].
// --poprawka-klasy N: pomiar „po” — src/data/weapons.js z klasą trafienia tarczy „special” tylko dla broni
// o obrażeniach ≥ N (szybkostrzelne bronie specjalne → „main”).
// --lataj-dok: obejście błędu z cudzej pracy w toku (2026-10-05, src/3d/pirateDryDockGame.js —
// detachPirateDryDockBodies czyta site.id przy site = null i misja nie startuje).
const PATCHES = [];
if (args['poprawka-klasy']) {
  const heavy = `(Number(def?.baseDamage) || 0) >= ${Number(args['poprawka-klasy'])}`;
  PATCHES.push(['src/data/weapons.js', [
    ["if (mount === 'special' || mount === 'special_missile' || mount === 'builtin') return 'special';",
      `if ((mount === 'special' || mount === 'special_missile' || mount === 'builtin') && ${heavy}) return 'special';`],
    ["if (def?.size === 'Capital') return 'special';", `if (def?.size === 'Capital' && ${heavy}) return 'special';`]
  ], true]);
}
if (args['lataj-dok']) {
  PATCHES.push(['src/3d/pirateDryDockGame.js', [
    ['if (site?.owner?._worldSite === site.id) site.owner._worldSite = null;',
      'if (site && site.owner?._worldSite === site.id) site.owner._worldSite = null;']
  ], false]);
}

async function startPatchedVite(port) {
  const { createServer } = await import('vite');
  const byKey = new Map(PATCHES.map(([f, swaps, req]) => [resolve(repo, f).replace(/\\/g, '/').toLowerCase(), { f, swaps, req }]));
  const plugin = {
    name: 'widocznosc-podmiany',
    enforce: 'pre',
    load(id) {
      const p = byKey.get(id.split('?')[0].replace(/\\/g, '/').toLowerCase());
      if (!p) return null;
      let src = readFileSync(resolve(repo, p.f), 'utf8');
      for (const [a, b] of p.swaps) {
        if (!src.includes(a)) {
          if (p.req) throw new Error(`podmiana w ${p.f}: brak linii ${a}`);
          console.log(`(podmiana w ${p.f} pominięta — linii już nie ma)`);
          continue;
        }
        src = src.replace(a, b);
      }
      return src;
    }
  };
  const srv = await createServer({ root: repo, logLevel: 'error', plugins: [plugin], server: { port, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await srv.listen();
  return { server: srv, base: `http://localhost:${srv.httpServer.address().port}` };
}

const { server, base } = PATCHES.length
  ? await startPatchedVite(Number(args.port || 5381))
  : await startVite(Number(args.port || 5381));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);
const report = { rozmiar: [W, H], przebieg: [], pomiary: [], bledy: [] };

const state = () => ev(`(() => {
  const s = window.ship, S = window.StoryGame, site = S.site, cam = window.camera;
  const f = site && site.flagship;
  let gol = 0, golNear = 0, all = 0;
  for (const b of (window.bullets || [])) {
    if (!b) continue;
    all++;
    if (b.vfxKey === 'special_goliath_autocannon') {
      gol++;
      if (Math.hypot(b.x - s.pos.x, b.y - s.pos.y) < 3000) golNear++;
    }
  }
  const st = window.WeaponFx && window.WeaponFx.stats;
  return {
    faza: S.phase || null,
    super: f ? { d: Math.round(Math.hypot(f.x - s.pos.x, f.y - s.pos.y)), martwy: !!f.dead, hp: Math.round(f.hp || 0) } : null,
    pociski: all, goliath: gol, goliathPrzyGraczu: golNear,
    tarcza: Math.round(s.shield.val), tarczaMax: Math.round(s.shield.max), kadlub: Math.round(s.hull.val), kadlubMax: Math.round(s.hull.max),
    zoom: +cam.zoom.toFixed(4),
    atlasPx: Math.round((s.w || 0) * cam.zoom),
    wfx: st ? { strzaly: st.shots, wyloty: st.muzzles, tanieWyloty: st.cheapMuzzles, trafienia: st.impacts, tanieTrafienia: st.cheapImpacts } : null,
    swiatla: window.Core3D.fx ? window.Core3D.fx.stats.lights : null,
    przebicie: window.__breachTally ? {
      czasProc: +(100 * window.__breachTally.breached / Math.max(0.02, window.__breachTally.t)).toFixed(1),
      pociskiPrzezDziure: window.__breachTally.passed, goliathPrzezDziure: window.__breachTally.passedGoliath
    } : null
  };
})()`);

// Obrys kadłuba encji na ekranie (px, bez obrotu sprite'a — prostokąt w = długość wzdłuż kursu).
const boxOf = (expr) => ev(`(() => {
  const e = ${expr};
  if (!e) return null;
  const cam = window.camera;
  const x = e.pos ? e.pos.x : e.x, y = e.pos ? e.pos.y : e.y;
  const a = e.angle || 0, c = Math.cos(a), s = Math.sin(a);
  const hw = (e.w || e.radius || 300) / 2, hh = (e.h || e.radius || 300) / 2;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const [u, v] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) {
    const p = window.worldToScreen(x + u * c - v * s, y + u * s + v * c, cam);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0: Math.round(x0), y0: Math.round(y0), x1: Math.round(x1), y1: Math.round(y1) };
})()`);

const freezeClock = (on) => ev(on
  ? '(() => { const p = window.performance; if (!p.__nowOrig) { p.__nowOrig = p.now.bind(p); const t = p.__nowOrig(); p.now = () => t; } return true; })()'
  : '(() => { const p = window.performance; if (p.__nowOrig) { p.now = p.__nowOrig; delete p.__nowOrig; } return true; })()');

// Przełączniki podsystemów na zamrożonej klatce: material.visible (moduły co klatkę ustawiają mesh.visible,
// materiału nie ruszają — three pomija siatkę z niewidocznym materiałem w _projectObject).
const SETUP = `(() => {
  const C = window.Core3D;
  const byName = (names) => {
    const out = [];
    C.scene.traverse((o) => { if (names.includes(o.name)) out.push(o); });
    return out;
  };
  const mats = (objs) => {
    const out = [];
    for (const o of objs) o.traverse((m) => { if (m.material) for (const x of [].concat(m.material)) out.push(x); });
    return out;
  };
  const G = {
    dym: mats(byName(['wfxSmoke'])),
    blyski: mats(byName(['wfxAdd'])),
    iskry: mats(byName(['wfxSparks', 'wfxArcs', 'wfxDebris'])),
    pociski: mats(byName(['wfxProjectiles', 'wfxTrails', 'wfxBeams'])),
    znieksztalcenia: mats(byName(['wfxDist'])),
    tarcze: mats(byName(['ShieldPool'])),
    tarczePlytki: mats(byName(['ShieldTiles'])),
    tarczeIskry: mats(byName(['ShieldSparks'])),
    tarczePoswiata: mats(byName(['ShieldHullGlow'])),
    tarczeZalamanie: mats(byName(['ShieldTilesDist']))
  };
  window.__wid = {
    G,
    set(group, on) { for (const m of G[group] || []) m.visible = on; },
    counts() { const o = {}; for (const k in G) o[k] = G[k].length; return o; }
  };
  return window.__wid.counts();
})()`;

// [nazwa, wyłączone grupy, opcje] — opcje: bloom { threshold, strength } (zamiast bloomConfig.js),
// zoom (× zoom kadru; miary liczone wtedy z kadrem odniesienia o tej samej nazwie z sufiksem).
const ALL_OFF = ['bloom', 'dym', 'blyski', 'iskry', 'pociski', 'znieksztalcenia', 'gorace', 'tarcze', 'swiatla'];
const VARIANTS = [
  ['wszystko', []],
  ['wszystko-2', []],
  ['bez-bloomu', ['bloom']],
  ['bez-dymu', ['dym']],
  ['bez-blyskow', ['blyski']],
  ['bez-iskier', ['iskry']],
  ['bez-pociskow', ['pociski']],
  ['bez-znieksztalcen', ['znieksztalcenia', 'gorace']],
  ['bez-tarcz', ['tarcze']],
  ['tarcza-bez-plytek', ['tarczePlytki']],
  ['tarcza-bez-iskier', ['tarczeIskry']],
  ['tarcza-bez-poswiaty', ['tarczePoswiata']],
  ['tarcza-bez-zalamania', ['tarczeZalamanie']],
  ['bloom-prog-1.5', [], { bloom: { threshold: 1.5 } }],
  ['bloom-prog-2.5', [], { bloom: { threshold: 2.5 } }],
  ['bloom-sila-0.4', [], { bloom: { strength: 0.4 } }],
  ['zoom-x1.5', [], { zoom: 1.5 }],
  // światła efektów nie wracają po wyłączeniu (pula błysków wyczyszczona) — dalej już bez nich
  ['bez-swiatel', ['swiatla']],
  ['czysto', ALL_OFF],
  ['czysto+bloom', ALL_OFF.filter((g) => g !== 'bloom')],
  ['czysto-zoom-x1.5', ALL_OFF, { zoom: 1.5 }]
];
const refFor = (name) => (name.includes('zoom-x1.5') ? 'czysto-zoom-x1.5' : 'czysto');

const apply = (off, opt = {}) => ev(`(() => {
  const C = window.Core3D, w = window.__wid, off = ${JSON.stringify(off)}, opt = ${JSON.stringify(opt)};
  // grupy dzielą materiały („tarcze” = składniki) — najpierw wszystko widoczne, potem wyłączone
  for (const g of Object.keys(w.G)) w.set(g, true);
  for (const g of off) w.set(g, false);
  C.setPerfToggles({ bloom: !off.includes('bloom'), heatHaze: !off.includes('gorace') });
  // parametry bloomu: Core3D czyta co klatkę DevVFX.bloom (tuner wypełnia je z bloomConfig.js), bez niego — bazę
  const B = (window.DevVFX && window.DevVFX.bloom) || null;
  if (!w.bloom0) w.bloom0 = B ? { s: B.strength, t: B.threshold } : { s: C.bloomBaseStrength, t: C.bloomBaseThreshold };
  const s = opt.bloom && opt.bloom.strength !== undefined ? opt.bloom.strength : w.bloom0.s;
  const t = opt.bloom && opt.bloom.threshold !== undefined ? opt.bloom.threshold : w.bloom0.t;
  if (B) { B.strength = s; B.threshold = t; } else { C.bloomBaseStrength = s; C.bloomBaseThreshold = t; }
  const cam = window.camera;
  if (w.zoom0 === undefined) w.zoom0 = cam.zoom;
  cam.manualZoom = true;
  cam.zoom = cam.targetZoom = cam.zoomBase = w.zoom0 * (opt.zoom || 1);
  if (off.includes('swiatla')) { const L = C.fx.lights; L.enabled = false; L.flashes = 0; L.points = 0; }
  return true;
})()`);
const restore = () => ev(`(() => {
  const C = window.Core3D, w = window.__wid;
  for (const g of Object.keys(w.G)) w.set(g, true);
  C.setPerfToggles({ bloom: true, heatHaze: true });
  if (w.bloom0) {
    const B = (window.DevVFX && window.DevVFX.bloom) || null;
    if (B) { B.strength = w.bloom0.s; B.threshold = w.bloom0.t; } else { C.bloomBaseStrength = w.bloom0.s; C.bloomBaseThreshold = w.bloom0.t; }
    delete w.bloom0;
  }
  const cam = window.camera;
  if (w.zoom0 !== undefined) { cam.zoom = cam.targetZoom = cam.zoomBase = w.zoom0; delete w.zoom0; }
  cam.manualZoom = ${args.zoom ? 'true' : 'false'};
  C.fx.lights.enabled = true;
  return true;
})()`);

// Miary obrazu: obszar (prostokąt px) — jasność, przepalenie, różnica od kadru odniesienia.
function regionStats(img, ref, box) {
  const x0 = Math.max(0, box ? box.x0 : 0), y0 = Math.max(0, box ? box.y0 : 0);
  const x1 = Math.min(img.width, box ? box.x1 : img.width), y1 = Math.min(img.height, box ? box.y1 : img.height);
  let n = 0, lum = 0, blown = 0, diff = 0, covered = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      n++;
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (Math.min(r, g, b) > 235) blown++;
      if (ref) {
        const d = (Math.abs(r - ref.data[i]) + Math.abs(g - ref.data[i + 1]) + Math.abs(b - ref.data[i + 2])) / 3;
        diff += d;
        if (d > 40) covered++;
      }
    }
  }
  if (!n) return null;
  return {
    px: n, jasnosc: +(lum / n).toFixed(1), przepalone: +(100 * blown / n).toFixed(2),
    ...(ref ? { roznica: +(diff / n).toFixed(1), zaslonieteProc: +(100 * covered / n).toFixed(1) } : {})
  };
}

const grow = (b, k) => {
  if (!b) return null;
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  return { x0: Math.round(b.x0 - w * k), y0: Math.round(b.y0 - h * k), x1: Math.round(b.x1 + w * k), y1: Math.round(b.y1 + h * k) };
};

async function measure(tag) {
  await ev('(() => { window.__setGamePaused(true); return true; })()');
  await sleep(300);
  await freezeClock(true);
  await sleep(300);
  const st = await state();
  const files = {};
  const boxes = {};
  for (const [name, off, opt] of VARIANTS) {
    await apply(off, opt || {});
    await sleep(350);
    const f = join(out, `${tag}-${name}.png`);
    await screenshotPng(cdp, f);
    files[name] = f;
    boxes[name] = {
      atlas: grow(await boxOf('window.ship'), 0.15),
      sup: grow(await boxOf('window.StoryGame.site && window.StoryGame.site.flagship'), 0.15)
    };
  }
  await restore();
  await freezeClock(false);
  await ev('(() => { window.__setGamePaused(false); return true; })()');
  // Miary (odniesienie: kadr „czysto” o tym samym zoomie)
  const refs = {};
  const res = { tag, stan: st, obrysy: boxes, warianty: {} };
  for (const [name] of VARIANTS) {
    const rn = refFor(name);
    const ref = refs[rn] || (refs[rn] = readPng(files[rn]));
    const img = readPng(files[name]);
    const b = boxes[name];
    res.warianty[name] = {
      atlas: regionStats(img, ref, b.atlas),
      superkapital: b.sup ? regionStats(img, ref, b.sup) : null,
      kadr: regionStats(img, ref, null)
    };
  }
  report.pomiary.push(res);
  console.log(`\n== ${tag}  ${JSON.stringify(st)}`);
  console.log('obrys Atlasa', JSON.stringify(boxes.wszystko.atlas), 'superkapitał', JSON.stringify(boxes.wszystko.sup), 'zoom ×1,5:', JSON.stringify(boxes['zoom-x1.5'].atlas));
  for (const [name] of VARIANTS) {
    const v = res.warianty[name];
    const a = v.atlas || {};
    const k = v.kadr || {};
    console.log(`${name.padEnd(18)} Atlas: różnica ${String(a.roznica).padStart(5)} zasłonięte ${String(a.zaslonieteProc).padStart(5)}% przepalone ${String(a.przepalone).padStart(5)}% jasność ${String(a.jasnosc).padStart(5)} | kadr: zasłonięte ${String(k.zaslonieteProc).padStart(5)}% przepalone ${String(k.przepalone).padStart(5)}% jasność ${k.jasnosc}`);
  }
}

// ── Tryb „ostrzal”: syntetyczny ostrzał tarczy Atlasa w pustej przestrzeni (gra swobodna) ─────────────
// Trafienia wstrzykiwane przez window.registerShieldImpact (sam obraz tarczy — bez obrażeń) z kadencją
// ognia superkapitału (9 × Goliath, ~24 trafień/s), w jedno miejsce burty z rozrzutem jak z 6–11 km.
// Te same trafienia w różnych wariantach: klasa efektu tarczy, strojenie ShieldTuning, próg bloomu.
// [nazwa, klasa, obrażenia, trafień/s, czas [s], opcje { tuning, bloom }]
const BARRAGE = [
  ['goliath-special', 'special', 45, 24, 3],
  ['goliath-main', 'main', 45, 24, 3],
  ['goliath-special-zar-0.3', 'special', 45, 24, 3, { tuning: { heat: 0.3 } }],
  ['goliath-special-iskry-0.25', 'special', 45, 24, 3, { tuning: { sparks: 0.25 } }],
  ['goliath-special-swiatla-0.35', 'special', 45, 24, 3, { tuning: { lights: 0.35 } }],
  ['goliath-special-prog-2', 'special', 45, 24, 3, { bloom: { threshold: 2.0 } }],
  ['goliath-main-zar-0.3-iskry-0.5', 'main', 45, 24, 3, { tuning: { heat: 0.3, sparks: 0.5 } }],
  ['armata-main', 'main', 150, 3, 3],
  ['yamato-jeden-strzal', 'special', 850, 5, 0.2]
];

async function runBarrage() {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(2500);
  // Pusta przestrzeń: poza polami pasa asteroid (ośrodek objętościowy rozprasza światła trafień w pyle
  // — w polu cały kadr bieleje), z dala od planet i Słońca; mysz na środku (kamera bez wychylenia).
  report.miejsce = await ev(`(() => {
    const s = window.ship, belt = window.__asteroidBelt, P = window.planets || [], S = window.SUN;
    const far = (x, y, d) => Math.hypot(x - x0, y - y0) > d;
    let x0 = 0, y0 = 0;
    for (const R of [300000, 500000, 800000, 1200000]) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        const x = s.pos.x + Math.cos(a) * R, y = s.pos.y + Math.sin(a) * R;
        const pad = 90000;
        if (belt && belt.field && belt.field.rectTouchesBelt(x - pad, y - pad, x + pad, y + pad)) continue;
        x0 = x; y0 = y;
        if (P.some((p) => p && !far(p.x, p.y, 200000))) continue;
        if (S && !far(S.x, S.y, 300000)) continue;
        window.DevScene.teleport(x, y, 0);
        return { x: Math.round(x), y: Math.round(y), R, k };
      }
    }
    return null;
  })()`);
  if (!report.miejsce) throw new Error('nie znalazłem pustego miejsca');
  console.log('miejsce:', JSON.stringify(report.miejsce));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: W / 2, y: H / 2, button: 'none' });
  await sleep(4000);
  if (args.zoom) await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom)}; return true; })()`);
  await ev(`(() => {
    // → { n: trafień, br: trafień przy otwartym przebiciu, first: [s] pierwsze przebicie albo −1 }
    window.__ostrzal = (cls, dmg, rate, dur, seed) => new Promise((done) => {
      const s = window.ship; let n = 0; let br = 0; let first = -1; let x = seed >>> 0;
      const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
      const total = Math.max(1, Math.round(rate * dur));
      const tick = () => {
        const a = s.angle + Math.PI / 2 + (rnd() - 0.5) * 0.35;
        window.registerShieldImpact(s, s.pos.x + Math.cos(a) * 3000, s.pos.y + Math.sin(a) * 3000, dmg, cls);
        if (s.__shieldBreach) { br++; if (first < 0) first = n / rate; }
        if (++n >= total) { clearInterval(id); done({ n, br, first: +first.toFixed(2) }); }
      };
      const id = setInterval(tick, 1000 / rate);
      tick();
    });
    return true;
  })()`);
  report.ostrzal = { zoom: await ev('window.camera.zoom'), atlasPx: await ev('Math.round(window.ship.w * window.camera.zoom)'), warianty: {} };
  const frozenShot = async (name) => {
    await ev('(() => { window.__setGamePaused(true); return true; })()');
    await freezeClock(true);
    await sleep(350);
    const f = join(out, `ostrzal-${name}.png`);
    await screenshotPng(cdp, f);
    const box = grow(await boxOf('window.ship'), 0.15);
    await freezeClock(false);
    await ev('(() => { window.__setGamePaused(false); return true; })()');
    return { f, box };
  };
  let seed = 7;
  if (args.przebicie) {
    // Przebicie (mechanika): ten sam ostrzał przez 10 s w klasie „special” i „main” — kiedy pole pierwszy raz
    // się przebija i jaka część trafień przypada na otwartą dziurę (pocisk w dziurze leci do pancerza).
    report.przebicie = {};
    for (const [name, cls, dmg, rate, dur] of [
      ['special-24/s', 'special', 45, 24, 10], ['main-24/s', 'main', 45, 24, 10],
      ['special-12/s', 'special', 45, 12, 10], ['main-12/s', 'main', 45, 12, 10]
    ]) {
      await waitFor(cdp, '!window.ship.__shieldBreach', 40000, 250);
      await sleep(6000);
      const r = await ev(`window.__ostrzal('${cls}', ${dmg}, ${rate}, ${dur}, ${seed++})`, 60000);
      report.przebicie[name] = r;
      console.log(`${name.padEnd(14)} trafień ${r.n}, pierwsze przebicie po ${r.first < 0 ? '—' : r.first + ' s'}, trafień w otwartą dziurę ${r.br} (${Math.round(100 * r.br / r.n)}%)`);
    }
    return;
  }
  const ref = await frozenShot('spokoj');
  const refImg = readPng(ref.f);
  console.log('zoom', report.ostrzal.zoom, 'Atlas px', report.ostrzal.atlasPx, 'obrys', JSON.stringify(ref.box));
  for (const [name, cls, dmg, rate, dur, opt = {}] of BARRAGE) {
    await ev(`(() => {
      const T = window.ShieldTuning, opt = ${JSON.stringify(opt)};
      window.__tun0 = {};
      for (const k in (opt.tuning || {})) { window.__tun0[k] = T[k]; T[k] = opt.tuning[k]; }
      const B = window.DevVFX && window.DevVFX.bloom;
      window.__bl0 = B ? { s: B.strength, t: B.threshold } : null;
      if (B && opt.bloom) { if (opt.bloom.threshold !== undefined) B.threshold = opt.bloom.threshold; if (opt.bloom.strength !== undefined) B.strength = opt.bloom.strength; }
      return true;
    })()`);
    const { n } = await ev(`window.__ostrzal('${cls}', ${dmg}, ${rate}, ${dur}, ${seed++})`, 60000);
    const shot = await frozenShot(name);
    await ev(`(() => {
      const T = window.ShieldTuning;
      for (const k in window.__tun0) T[k] = window.__tun0[k];
      const B = window.DevVFX && window.DevVFX.bloom;
      if (B && window.__bl0) { B.strength = window.__bl0.s; B.threshold = window.__bl0.t; }
      return true;
    })()`);
    const img = readPng(shot.f);
    const r = { trafien: n, atlas: regionStats(img, refImg, shot.box), kadr: regionStats(img, refImg, null) };
    report.ostrzal.warianty[name] = r;
    console.log(`${name.padEnd(30)} trafień ${String(n).padStart(3)} | Atlas: różnica ${String(r.atlas.roznica).padStart(5)} zasłonięte ${String(r.atlas.zaslonieteProc).padStart(5)}% przepalone ${String(r.atlas.przepalone).padStart(5)}% jasność ${String(r.atlas.jasnosc).padStart(5)} | kadr: zasłonięte ${String(r.kadr.zaslonieteProc).padStart(5)}%`);
    // tarcza stygnie (awakeAfterHit 4,5 s + coolTime 2,6 s), dziura się zamyka
    await sleep(Number(args.przerwa || 10000));
  }
  const end = await frozenShot('spokoj-koniec');
  const e = regionStats(readPng(end.f), refImg, end.box);
  console.log('kontrola (spokój na końcu vs na początku):', JSON.stringify(e));
  report.ostrzal.kontrola = e;
}

async function runMission() {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&story=defences` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.StoryGame)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  await ev(`(() => { localStorage.setItem('sc_story_tutorial', '0'); return true; })()`);
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await sleep(900);
  await ev(`(() => { document.querySelector('[data-story-campaign="1"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && window.StoryGame.active && window.StoryGame.phase === 'defences'", 300000, 400)) throw new Error('fabuła nie doszła do fazy obrony');
  await sleep(1500);
  report.setup = await ev(SETUP);
  report.bloom = await ev('(() => ({ ...window.Core3D.getPerfStatus(), cfg: window.Core3D.bloomConfig || null }))()');
  console.log('grupy materiałów:', JSON.stringify(report.setup));
  report.klasaGoliatha = await ev(`window.shieldFxClassForBullet({ vfxKey: 'special_goliath_autocannon' })`);
  console.log('klasa trafienia tarczy Goliatha:', report.klasaGoliatha);
  if (args.zoom) await ev(`(() => { const c = window.camera; c.manualZoom = true; c.zoom = c.targetZoom = c.zoomBase = ${Number(args.zoom)}; return true; })()`);
  // Przebicie tarczy Atlasa (co 20 ms): udział czasu z dziurą w polu i pociski, które przez nią przeszły
  // (b.shieldPassed — pętla pocisków w index.html). --kadry 0: bez pauz na pomiary, ciągły przebieg.
  await ev(`(() => {
    const seen = new WeakSet();
    const T = window.__breachTally = { t: 0, breached: 0, passed: 0, passedGoliath: 0 };
    setInterval(() => {
      const s = window.ship;
      T.t += 0.02;
      if (s.__shieldBreach) T.breached += 0.02;
      for (const b of (window.bullets || [])) {
        if (!b || b.shieldPassed !== s || seen.has(b)) continue;
        seen.add(b);
        T.passed++;
        if (b.vfxKey === 'special_goliath_autocannon') T.passedGoliath++;
      }
    }, 20);
    return true;
  })()`);

  const t0 = Date.now();
  let done = 0;
  let moved = false;
  let i = 0;
  while ((Date.now() - t0) / 1000 < czas && (kadry === 0 || done < kadry)) {
    const st = await state();
    const t = Math.round((Date.now() - t0) / 1000);
    report.przebieg.push({ t, ...st });
    console.log(`t=${String(t).padStart(3)} s`, JSON.stringify(st));
    if (i % 2 === 0) await screenshotPng(cdp, join(out, `lot-${String(t).padStart(3, '0')}.png`));
    i++;
    if (st.super && st.super.martwy) { console.log('superkapitał zniszczony'); break; }
    if (kadry > 0 && st.goliathPrzyGraczu >= progPociskow) {
      await measure(`pomiar-${++done}`);
      await sleep(2500);
      continue;
    }
    if (!moved && args.blisko && t > 45 && st.super && st.super.d > Number(args.blisko) * 1.5) {
      moved = true;
      await ev(`(() => {
        const f = window.StoryGame.site.flagship, s = window.ship, d = ${Number(args.blisko)};
        const a = f.angle || 0;
        window.DevScene.teleport(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, a + Math.PI);
        return true;
      })()`);
      console.log('gracz przeniesiony przed superkapitał');
    }
    await sleep(2000);
  }
}

try {
  if (args.tryb === 'ostrzal') await runBarrage();
  else await runMission();
  report.bledy = logs.errors().slice(0, 80);
  if (report.bledy.length) console.log('BŁĘDY:\n' + report.bledy.join('\n'));
} catch (err) {
  report.wyjatek = String(err?.stack || err);
  report.logi = logs.all().slice(-60);
  console.error(err);
  console.log(report.logi.join('\n'));
} finally {
  writeJson(join(out, 'raport.json'), report);
  await chrome.close();
  await server.close();
}
