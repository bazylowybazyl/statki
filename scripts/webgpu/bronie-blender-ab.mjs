// Pilot „bronie z Blendera”: A/B wieży w demie dema/atlas3d-webgpu.html (WebGPU, prawdziwe GPU) — te same kadry
// z modelem z weapons3D.js („stary”) i z Blendera (?bronie=<rodzina>, scripts/blender/*.py → assets/weapons3d/),
// zrzuty obok siebie.
//
//   node scripts/webgpu/bronie-blender-ab.mjs [--rodzina yamato] [--bron special_yamato_cannon]
//        [--out .tmp/blender/ab-demo] [--warianty stary,blender,blender-bez-ao,blender-lod1] [--kadry galeria,gra,3d]
//        [--kadryL 5,2,1,0.45] [--w 1920 --h 1080]
//
// Kadry: galeria — zbliżenie (model dopasowany do ~80 j.): przód 3/4, tył 3/4, z góry, nisko z boku;
// gra — Atlas z pełnym fitem z góry w SKALI GRY na pierwszej wieży broni --bron, kadr = k × długość Atlasa (5 L ≈
// domyślny kadr gry 9 × 5 km, w którym kadłub zajmuje ~20% szerokości); 3d — Atlas z ukosa (kamery 3D gry, K).
// Atlas z fitem „pełny” niesie Yamato (special) i Tempest Mk II (main: railgun_mk2); tempest1 — tylko galeria.
// Wariant blender-bez-ao: sama bryła (?ao=0) — ile daje AO z wierzchołków. Zegar dema zatrzymany (?test=1,
// pauza): wieże w spoczynku, bez strzałów — kadry porównywalne 1:1.
import { join, resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo } from './wspolne.mjs';

const args = parseArgs();
const W = Number(args.w || 1920);
const H = Number(args.h || 1080);
const out = resolve(repo, args.out || '.tmp/blender/ab-demo');
const FAMILY = String(args.rodzina || 'yamato');
const WEAPON = String(args.bron || ({ yamato: 'special_yamato_cannon', tempest2: 'railgun_mk2', tempest1: 'railgun_mk1', deathRay: 'death_ray' }[FAMILY] || ''));
const VARIANTS = String(args.warianty || 'stary,blender,blender-bez-ao').split(',');
const SETS = String(args.kadry || 'galeria,gra,3d').split(',');
const FRAMES_L = String(args.kadryL || '5,2,1,0.45').split(',').map(Number);
const QUERY = { stary: '', blender: `bronie=${FAMILY}`, 'blender-bez-ao': `bronie=${FAMILY}&ao=0`, 'blender-lod1': `bronie=${FAMILY}@1` };
const LABEL = { stary: 'weapons3D.js (dziś)', blender: 'Blender (bryła + AO)', 'blender-bez-ao': 'Blender (bez AO)', 'blender-lod1': 'Blender LOD1' };

// Kadry: id → { mode, fit, setup (wyrażenie w stronie zwracające ustawienia kamery) }.
const SHOTS = [];
if (SETS.includes('galeria')) {
  const g = (az, el, dist, cam = 'orbita') => `(() => { const it = window.__demo.gallery.items.find((i) => i.fam === ${JSON.stringify(FAMILY)});
    window.__demo.camera(${JSON.stringify(cam)}); window.__demo.view({ az: ${az}, el: ${el}, dist: ${dist}, pan: [it.pos.x + 14, it.pos.y, 12 - 30] }); return true; })()`;
  SHOTS.push({ id: 'galeria-przod34', mode: 'galeria', view: g(-38, 26, 118) });
  SHOTS.push({ id: 'galeria-tyl34', mode: 'galeria', view: g(140, 30, 118) });
  SHOTS.push({ id: 'galeria-gora', mode: 'galeria', view: g(0, 0, 120, 'gra') });
  SHOTS.push({ id: 'galeria-bok', mode: 'galeria', view: g(-92, 7, 110) });
}
// Atlas: kadr z góry na pierwszą wieżę broni WEAPON (kamera „gra”: perspektywa FOV 38°, szerokość kadru ≈ 1,224 × odległość).
const atlasOnYamato = (cam, widthL, az = 0, el = 0) => `(() => {
  const d = window.__demo; const s = d.ship;
  const t = s.turrets.find((q) => q.weaponId === ${JSON.stringify(WEAPON)});
  if (!t) return 'brak wieży ${WEAPON}';
  const e = t.root.matrixWorld.elements; const p = d.flight.pos;
  d.camera(${JSON.stringify(cam)});
  const aspect = innerWidth / innerHeight; const k = 2 * Math.tan(19 * Math.PI / 180) * aspect;
  d.view({ az: ${az}, el: ${el}, dist: s.length * ${widthL} / k, pan: [e[12] - p.x, e[13] - p.y, e[14] - p.z] });
  return true; })()`;
if (SETS.includes('gra')) {
  // Wycinek 1:1 wokół wieży (środek kadru) — tyle pikseli, ile widzi gracz.
  for (const k of FRAMES_L) SHOTS.push({ id: `gra-kadr-${String(k).replace('.', '_')}L`, mode: 'ogledziny', fit: 'pelny', view: atlasOnYamato('gra', k), crop: [520, 360] });
}
if (SETS.includes('3d')) {
  SHOTS.push({ id: '3d-ukos', mode: 'ogledziny', fit: 'pelny', view: atlasOnYamato('orbita', 0.55, -35, 32) });
  SHOTS.push({ id: '3d-blisko', mode: 'ogledziny', fit: 'pelny', view: atlasOnYamato('orbita', 0.22, -40, 24) });
}

const { server, base } = await startVite(Number(args.port || 5397));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const report = { variants: {}, shots: SHOTS.map((s) => s.id) };
const files = {}; // shot → wariant → plik
try {
  for (const v of VARIANTS) {
    const byMode = {};
    for (const s of SHOTS) (byMode[`${s.mode}|${s.fit || 'gra'}`] ||= []).push(s);
    for (const [key, shots] of Object.entries(byMode)) {
      const [mode, fit] = key.split('|');
      logs.clear();
      const q = new URLSearchParams(`test=1&dpr=1&tryb=${mode}&fit=${fit}${QUERY[v] ? `&${QUERY[v]}` : ''}`);
      await cdp.send('Page.navigate', { url: `${base}/dema/atlas3d-webgpu.html?${q}` });
      if (!await waitFor(cdp, 'window.__demo && (window.__demo.ready === true || window.__demo.error)', 240000)) throw new Error(`demo nie wstało (${v}, ${mode})`);
      const err = await evaluate(cdp, 'window.__demo.error || document.getElementById("err").textContent || ""');
      if (err) throw new Error(`demo (${v}): ${err}`);
      await evaluate(cdp, `(() => { for (const id of ['panel', 'hud', 'labels', 'crosshair']) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
        window.__demo.S.paused = true; return true; })()`);
      for (const s of shots) {
        const r = await evaluate(cdp, s.view);
        if (r !== true) throw new Error(`${s.id}: ${r}`);
        await evaluate(cdp, 'window.__demo.step(4)', 60000);
        await sleep(120);
        const f = join(out, 'kadry', `${s.id}--${v}.png`);
        await screenshotPng(cdp, f);
        (files[s.id] ||= {})[v] = f;
        console.log('zrzut', s.id, v);
      }
      const st = JSON.parse(await evaluate(cdp, 'JSON.stringify(window.__demo.stats())'));
      const errs = logs.errors();
      const info = logs.all().filter((l) => l.includes('[blender]'));
      (report.variants[v] ||= {})[mode] = { drawCalls: st.drawCalls, triangles: st.triangles, errors: errs, info };
      if (errs.length) console.log(`  BŁĘDY (${v}, ${mode}):\n   ${errs.join('\n   ')}`);
    }
  }

  // Zestawienia obok siebie (kanwa w przeglądarce: połowa rozdzielczości na wariant, podpis).
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  for (const s of SHOTS) {
    const list = VARIANTS.map((v) => ({ label: LABEL[v] || v, data: readFileSync(files[s.id][v]).toString('base64') }));
    const png = await evaluate(cdp, `(async () => {
      const list = ${JSON.stringify(list)};
      const crop = ${JSON.stringify(s.crop || null)};
      const imgs = await Promise.all(list.map((e) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + e.data; })));
      // crop: wycinek 1:1 ze środka kadru; bez — cały kadr w połowie rozdzielczości.
      const w = crop ? crop[0] : Math.round(imgs[0].width / 2), h = crop ? crop[1] : Math.round(imgs[0].height / 2), gap = 6;
      const sx = crop ? (imgs[0].width - w) / 2 : 0, sy = crop ? (imgs[0].height - h) / 2 : 0;
      const sw = crop ? w : imgs[0].width, sh = crop ? h : imgs[0].height;
      const c = document.createElement('canvas'); c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#555'; g.fillRect(0, 0, c.width, c.height);
      g.imageSmoothingEnabled = !crop;
      imgs.forEach((im, k) => {
        const x = k * (w + gap);
        g.drawImage(im, sx, sy, sw, sh, x, 0, w, h);
        g.font = '600 18px system-ui, sans-serif'; g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x + 8, 8, g.measureText(list[k].label).width + 16, 28);
        g.fillStyle = '#e8f2ff'; g.fillText(list[k].label, x + 16, 28);
      });
      return c.toDataURL('image/png').slice(22);
    })()`, 60000);
    const f = join(out, `ab-${s.id}.png`);
    writeFileSync(f, Buffer.from(png, 'base64'));
    console.log('zestawienie', f);
  }
  writeJson(join(out, 'raport.json'), report);
  console.log(JSON.stringify(report.variants, null, 1));
} finally {
  await chrome.close();
  await server.close();
}
