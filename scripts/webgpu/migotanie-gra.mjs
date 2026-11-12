// Migotanie z daleka (aliasing detalu mniejszego niż piksel) — hala K-7 Ziemi i ring w prawdziwej grze, A/B wersji kodu
// po kolei (ten sam świat: ziarno harnessu, osobne UUID). Kadry: środek hali przy zoomach --zoomy, w każdym 4 klatki
// z kamerą przesuniętą co ¼ px (k0…k3), plus kadry z bliska (zoom 0,22 / 0,5 / 1 przy stanowisku C-01 — wygląd z bliska
// ma zostać; porównuj z bazą). Miary w prostokątach hali, ringu i całego kadru:
//   roznica — % pikseli z różnicą > 40/255 między k0 a k1 / k2 / k3 (liczy też uczciwe krawędzie przesunięte o ułamek px),
//   migotanie — % pikseli z |k2 − (k1 + k3) / 2| > 30/255 (druga różnica: treść dobrze filtrowana zmienia się z przesunięciem
//   prawie liniowo, aliasing skacze — to jest miara „mrugania”).
// Kadry dachu ringu: pas ringu w środku, 15 tys. j. wzdłuż ringu po obu stronach portu (dachA-…, dachB-…).
// Opcje: --kadry hala,dach,blisko,dachBlisko (wybór), --bloom 0 (bez bloomu), --msaa 0 (bez MSAA); A/B wersji kodu bez
// ruszania drzewa: HULLFALL_AB_DIR=<katalog z plikami „przed”> (vite.config.js). Wynik: <out>/z<zoom>-k<k>.png, dach*-z<zoom>-k<k>.png, blisko-z<zoom>.png, raport.json.
//   node scripts/webgpu/migotanie-gra.mjs --out .tmp/webgpu/migotanie/przed [--zoomy 0.035,0.05,0.07,0.12]
// Przegląd 2026-10-23: docs/AUDYT-migotanie-z-daleka-2026-10-23.md.
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, repo, osobneLosowanieUuid } from './wspolne.mjs';
import { readPng } from './png.mjs';

const args = parseArgs();
const W = 1600, H = 900;
const out = resolve(repo, args.out || '.tmp/webgpu/migotanie/gra');
mkdirSync(out, { recursive: true });
const ZOOMS = String(args.zoomy || '0.035,0.05,0.07,0.12').split(',').map(Number);
const PROG = 40;
// kadry: hala (środek hali K-7), dach (pas ringu, 4 klatki co ¼ px), blisko (hala z bliska), dachBlisko (dach z bliska)
const KADRY = new Set(String(args.kadry || 'hala,dach,blisko,dachBlisko').split(','));
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const GRA_SWOBODNA = `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`;

const { server, base } = await startVite(Number(args.port || 5419));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const report = { kadry: {} };

const PAGE_HELPERS = `(async () => {
  const m = await import('/src/game/hallDustInput.js');
  const g = window.__mig = {
    entry: (key) => window.__haloRings.entries.find((q) => q.key === key),
    aff: (key) => { const e = g.entry(key); return m.hallToGameAffine(e.collider.place, e.collider.registry.halls[0].frame, {}); },
    at: (key, hx, hz) => { const a = g.aff(key); return { x: a.p0x + hx * a.ax + hz * a.bx, y: a.p0y + hx * a.ay + hz * a.by, a }; },
    hold: null,
    placeShip(key) {
      const p = g.at(key, -810, 1900);
      const heading = Math.atan2(p.a.by, p.a.bx);
      window.DevScene.teleport(p.x, p.y, heading);
      g.hold = { x: p.x, y: p.y, heading };
      return p;
    },
    tick() {
      const H = g.hold, s = window.ship;
      if (H && s) { s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
      requestAnimationFrame(g.tick);
    }
  };
  requestAnimationFrame(g.tick);
  return true;
})()`;

const pipesSince = (k0) => ev(`(() => {
  const L = window.__harness.pipes.list;
  const sync = L.filter((e) => e.k >= ${k0} && !e.budowa && e.sync && !e.compute);
  return { sync: sync.length, lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12) };
})()`);

async function shot(name) {
  await ev('window.__harness.frames(4)');
  const f = join(out, `${name}.png`);
  await screenshotPng(cdp, f);
  return readPng(f);
}

// |b − (a + c) / 2| > 30/255 (druga różnica — miara mrugania)
function second(a, b, c, rect) {
  let n = 0, tot = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = (y * a.width + x) * 4;
      let d = 0;
      for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(b.data[i + k] - (a.data[i + k] + c.data[i + k]) / 2));
      if (d > 30) n++;
      tot++;
    }
  }
  return +(100 * n / Math.max(1, tot)).toFixed(3);
}

function diff(a, b, rect) {
  let n = 0, tot = 0;
  for (let y = rect.y0; y < rect.y1; y++) {
    for (let x = rect.x0; x < rect.x1; x++) {
      const i = (y * a.width + x) * 4;
      const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
      if (d > PROG) n++;
      tot++;
    }
  }
  return +(100 * n / Math.max(1, tot)).toFixed(3);
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await ev('window.__harness.hold(true)');
  await ev(PAGE_HELPERS);
  for (let k = 0; k < 4000; k += 20) {
    const ok = await ev(`(() => { const e = window.__mig.entry('earth'); return !!(e && e.ring && e.ring.isReady && e.ring.k7Halls && e.ring.k7Halls.length); })()`);
    if (ok) break;
    await ev('window.__harness.frames(20)');
  }
  await ev(`(() => { window.__harness.scene.hideHud(true); window.__mig.placeShip('earth'); return true; })()`);
  await ev('window.__harness.step(240)');
  const k0 = await ev('window.__harness.frameLog.n');
  if (args.bloom === '0') await ev('(() => { window.Core3D.setPerfToggles({ bloom: false }); return true; })()');
  if (args.msaa === '0') await ev('(() => { window.Core3D.setMsaaEnabled(false); return true; })()');
  const centre = await ev(`(() => { const p = window.__mig.at('earth', 0, 3800); return { x: p.x, y: p.y }; })()`);
  const hallRect = { x0: 380, x1: 1220, y0: 60, y1: 860 };
  const ringRect = { x0: 0, x1: 520, y0: 0, y1: 560 };
  const frameRect = { x0: 0, x1: W, y0: 0, y1: H };

  for (const z of KADRY.has('hala') ? ZOOMS : []) {
    const frames = [];
    for (const k of [0, 1, 2, 3]) {
      await ev(`window.__harness.scene.cam(${centre.x + k * 0.25 / z}, ${centre.y}, ${z})`);
      frames.push(await shot(`z${z}-k${k}`));
    }
    const r = (report.kadry[`z${z}`] = {
      roznicaHala: { k1: diff(frames[0], frames[1], hallRect), k2: diff(frames[0], frames[2], hallRect), k3: diff(frames[0], frames[3], hallRect) },
      roznicaRing: { k1: diff(frames[0], frames[1], ringRect), k2: diff(frames[0], frames[2], ringRect), k3: diff(frames[0], frames[3], ringRect) },
      migotanie: { hala: second(frames[1], frames[2], frames[3], hallRect), ring: second(frames[1], frames[2], frames[3], ringRect), kadr: second(frames[1], frames[2], frames[3], frameRect) }
    });
    console.log(`zoom ${z}`.padEnd(12), JSON.stringify(r));
  }
  // dach ringu (pas ringu w środku kadru, 15 tys. j. wzdłuż ringu w obie strony od portu): te same 4 klatki co ¼ px
  const dachy = await ev(`(() => {
    const e = window.__mig.entry('earth');
    const L = e.collider.layout, P = e.place;
    const h = window.__mig.at('earth', 0, 3800);
    const nx0 = h.x - P.x, ny0 = h.y - P.y, nl = Math.sqrt(nx0 * nx0 + ny0 * ny0) || 1;
    const nx = nx0 / nl, ny = ny0 / nl, r = (L.radii.min + L.radii.max) * 0.5;
    return [-15000, 15000].map((t) => ({ t, x: P.x + nx * r - ny * t, y: P.y + ny * r + nx * t }));
  })()`);
  for (const d of KADRY.has('dach') ? dachy : []) {
    for (const z of ZOOMS) {
      const frames = [];
      for (const k of [0, 1, 2, 3]) {
        await ev(`window.__harness.scene.cam(${d.x + k * 0.25 / z}, ${d.y}, ${z})`);
        frames.push(await shot(`dach${d.t > 0 ? 'B' : 'A'}-z${z}-k${k}`));
      }
      const r = (report.kadry[`dach${d.t > 0 ? 'B' : 'A'}-z${z}`] = {
        roznicaKadr: { k1: diff(frames[0], frames[1], frameRect), k2: diff(frames[0], frames[2], frameRect), k3: diff(frames[0], frames[3], frameRect) },
        migotanie: { kadr: second(frames[1], frames[2], frames[3], frameRect) }
      });
      console.log(`dach${d.t > 0 ? 'B' : 'A'} zoom ${z}`.padEnd(18), JSON.stringify(r));
    }
  }
  // dach z bliska (wygląd ma zostać): pas ringu przy zoomach 0,25 / 0,6
  for (const d of KADRY.has('dachBlisko') ? dachy : []) {
    for (const z of [0.25, 0.6]) {
      await ev(`window.__harness.scene.cam(${d.x}, ${d.y}, ${z})`);
      await shot(`dach${d.t > 0 ? 'B' : 'A'}-blisko-z${z}`);
    }
  }
  // z bliska (wygląd ma zostać)
  for (const [z, hx, hz] of KADRY.has('blisko') ? [[0.5, -810, 2500], [1, -1080, 2620], [0.22, -810, 2300]] : []) {
    await ev(`(() => { const p = window.__mig.at('earth', ${hx}, ${hz}); window.__harness.scene.cam(p.x, p.y, ${z}); return true; })()`);
    await shot(`blisko-z${z}`);
  }
  report.pipeline = await pipesSince(k0);
  report.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 20);
  console.log('pipeline', JSON.stringify(report.pipeline), 'bledy', report.bledy.length, report.bledy.slice(0, 5).join(' | '));
} catch (e) {
  console.error('BŁĄD', e);
  report.fatal = String(e?.stack || e);
} finally {
  writeJson(join(out, 'raport.json'), report);
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
