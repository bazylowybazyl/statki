// Hala K-7 z Blendera (src/3d/haloRing/haloPortK7Glb.js, domyślna; stara — ?k7=stara) ↔ stara hala (bryły
// haloPortK7Build.js) W PRAWDZIWEJ GRZE, A/B na tych samych kadrach. Strona z harnessem (zegar wirtualny,
// Math.random z ziarnem, osobne UUID three): ten sam świat i ta sama klatka w każdym wariancie (wariant = świeża strona).
//
//   node scripts/webgpu/k7-blender-gra.mjs [--warianty stara,blender] [--kadry dok,odlacz,zbiorniki,brama,hala,noc,k3d,mars,jowisz]
//        [--rozmiar 1600x900] [--wycinek 760x460] [--out .tmp/blender/k7/gra] [--koszt 1] [--menu 1]
//
// Kadry (Atlas na C-01 hali 0 Ziemi dziobem ku bramie, pozy obsługi „podpięte” jak w kampanii przy starcie):
//   dok      — zoomy 0,22 / 0,5 / 1 / 2 (stanowisko C-01, słupek zachodni);
//   odlacz   — ODDOKUJ sekwencją fabuły (storyUndockPose): upust, odryglowanie, składanie ramion, złożone;
//   zbiorniki, brama (G-01 z nadprożem i ościeżnicą), hala (cała, zoom 0,12), noc (lampy hali), k3d (kamera 3D
//   gry — orbita nad słupkiem), mars / jowisz (hala K-7 ringów ECUMENE i BUDOWA — ta sama hala, inna paleta);
//   --menu 1 — tło menu (ring Ziemi z halami) przed startem.
// Koszt (--koszt 1): GPU klatki (mediana Core3D.gpuFrameMs) z halami i z ukrytymi halami (różnica = koszt hal),
// draw calle i trójkąty klatki (window.__rendererInfo), CPU Core3D.render, pipeline'y SYNCHRONICZNE w klatkach od
// startu kadrów (ma być 0), błędy konsoli (ma być 0).
//
// Wynik: <out>/kadry/<kadr>--<wariant>.png, <out>/ab-<kadr>.png (całe kadry w połowie rozdzielczości obok siebie
// + wycinek 1:1 ze środka), raport.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const [CW, CH] = (args.wycinek || '760x460').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/blender/k7/gra');
mkdirSync(join(out, 'kadry'), { recursive: true });
const VARIANTS = String(args.warianty || 'stara,blender').split(',');
const FRAMES = new Set(String(args.kadry || 'dok,odlacz,zbiorniki,brama,hala,noc,k3d,mars,jowisz').split(','));
const KOSZT = String(args.koszt ?? '1') !== '0';
const MENU = String(args.menu ?? '1') !== '0';
const QUERY = { stara: '&k7=stara', blender: '' };
const LABEL = { stara: 'stara hala (bryły)', blender: 'hala z Blendera (GLB)' };
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const GRA_SWOBODNA = `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`;

const { server, base } = await startVite(Number(args.port || 5402));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const report = { warianty: {} };
const files = {};   // kadr → wariant → plik

// Strona: pomocniki (hub hali → świat gry, poza C-01, kadr kamery RTS, ukrywanie hal, mediana GPU)
const PAGE_HELPERS = `(async () => {
  const m = await import('/src/game/hallDustInput.js');
  const st = await import('/src/game/story/storyGame.js');
  const g = window.__k7ab = {
    entry: (key) => window.__haloRings.entries.find((q) => q.key === key),
    aff: (key) => { const e = g.entry(key); return m.hallToGameAffine(e.collider.place, e.collider.registry.halls[0].frame, {}); },
    at: (key, hx, hz) => { const a = g.aff(key); return { x: a.p0x + hx * a.ax + hz * a.bx, y: a.p0y + hx * a.ay + hz * a.by, a }; },
    hold: null,
    placeShip(key) {
      const p = g.at(key, -810, 1900);
      const heading = Math.atan2(p.a.by, p.a.bx);   // dziobem ku bramie G-01 (jak w kampanii)
      window.DevScene.teleport(p.x, p.y, heading);
      g.hold = { x: p.x, y: p.y, heading };
      const e = g.entry(key);
      Object.assign(e.collider.registry.halls[0].poses.get('C-01'), { clamp: 1, extension: 1, seat: 1, lock: 1, flow: 1, vent: 0, owner: 'skrypt' });
      return p;
    },
    tick() {
      const H = g.hold, s = window.ship;
      if (H && s) { s.pos.x = H.x; s.pos.y = H.y; s.vel.x = 0; s.vel.y = 0; s.angle = H.heading; if (s.angVel !== undefined) s.angVel = 0; }
      const u = g.undock;
      if (u) { u.t = (performance.now() - u.t0) / 1000; st.storyUndockPose(u.t, u.pose); }
      requestAnimationFrame(g.tick);
    },
    startUndock(key) { const e = g.entry(key); g.undock = { t0: performance.now(), t: 0, pose: e.collider.registry.halls[0].poses.get('C-01') }; },
    cam(key, hx, hz, zoom) { const p = g.at(key, hx, hz); window.__harness.scene.cam(p.x, p.y, zoom); return p; },
    halls(key) { return g.entry(key)?.ring?.k7Halls || []; },
    hideHalls(key, hidden) {
      for (const h of g.halls(key)) {
        h.root.traverse((o) => {
          if (o === h.root) return;
          if (hidden) { o.userData.__abVis = o.visible; o.visible = false; } else if (o.userData.__abVis !== undefined) { o.visible = o.userData.__abVis; delete o.userData.__abVis; }
        });
      }
    },
    async gpuMed(n = 30) {
      const H = window.__harness, r = [];
      for (let i = 0; i < n; i++) { await H.frames(4); const v = window.Core3D?.gpuFrameMs; if (Number.isFinite(v) && v > 0) r.push(v); }
      r.sort((a, b) => a - b);
      return r.length ? +r[r.length >> 1].toFixed(3) : null;
    },
    info() {
      const i = window.__rendererInfo || {};
      const h = g.halls('earth')[0];
      return { drawCalls: i.calls ?? null, triangles: i.triangles ?? null, halaDraw: h?.drawCalls ?? null,
        glb: h?.glb ? { lod: h.glb.lod, tris: h.glb.levels.map((l) => l?.entry.tris ?? 0) } : null };
    }
  };
  requestAnimationFrame(g.tick);
  return true;
})()`;

const pipesSince = (k0) => ev(`(() => {
  const L = window.__harness.pipes.list;
  const p = L.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const nb = L.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: p.filter((e) => e.compute).length, budowyWKlatce: nb.length,
    lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 16), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 16) };
})()`);

async function shot(v, name, meta = {}) {
  await ev('window.__harness.frames(6)');
  const f = join(out, 'kadry', `${name}--${v}.png`);
  await screenshotPng(cdp, f);
  (files[name] ||= {})[v] = f;
  const info = await ev('window.__k7ab.info()');
  report.warianty[v].kadry[name] = { ...meta, ...info };
  console.log(`[${v}] ${name}`.padEnd(30), JSON.stringify(info));
}

async function waitRing(key, maxFrames = 4000) {
  for (let k = 0; k < maxFrames; k += 20) {
    const ok = await ev(`(() => { const e = window.__k7ab.entry(${JSON.stringify(key)}); return !!(e && e.ring && e.ring.isReady && e.ring.k7Halls && e.ring.k7Halls.length); })()`);
    if (ok) return true;
    await ev('window.__harness.frames(20)');
  }
  return false;
}

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  for (const v of VARIANTS) {
    logs.clear();
    const vr = (report.warianty[v] = { opis: LABEL[v] || v, kadry: {} });
    await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${QUERY[v] ?? ''}` });
    if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
    if (MENU) {
      if (await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500)) {
        await sleep(2500);
        await ev('window.__harness.scene.hideHud(true)');
        const f = join(out, 'kadry', `menu--${v}.png`);
        await screenshotPng(cdp, f);
        (files.menu ||= {})[v] = f;
        await ev('window.__harness.scene.hideHud(false)');
      }
    }
    await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
    if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
    await ev('window.__harness.hold(true)');
    await ev(PAGE_HELPERS);
    if (!await waitRing('earth')) throw new Error('ring Ziemi nie zbudowany');
    vr.hala = await ev(`(() => { const h = window.__k7ab.halls('earth')[0]; return { glb: !!h.glb, draw: h.drawCalls, lod: h.glb?.lod ?? null, tris: h.glb ? h.glb.levels.map((l) => l?.entry.tris ?? 0) : null }; })()`);
    console.log(v, 'hala', JSON.stringify(vr.hala));
    await ev(`(() => { window.__harness.scene.hideHud(true); window.__k7ab.placeShip('earth'); return true; })()`);
    // przewody i ramiona dochodzą do pozy „podpięte”, gaz hali i mgła wojny
    await ev('window.__harness.step(300)');
    const k0 = await ev('window.__harness.frameLog.n');

    if (FRAMES.has('dok')) {
      for (const [z, hx, hz] of [[0.22, -810, 2300], [0.5, -810, 2500], [1, -1080, 2620], [2, -1425, 2650]]) {
        await ev(`window.__k7ab.cam('earth', ${hx}, ${hz}, ${z})`);
        await shot(v, `dok-z${z}`, { zoom: z });
      }
    }
    if (KOSZT) {
      // koszt hal: ten sam kadr z halami i z ukrytymi halami (bryły hal Ziemi), na przemian ABAB
      await ev(`window.__k7ab.cam('earth', -810, 2500, 0.5)`);
      await ev('window.__harness.frames(30)');
      const k = {};
      for (const rep of [0, 1]) {
        k[`z${rep}`] = await ev('window.__k7ab.gpuMed(30)');
        await ev(`window.__k7ab.hideHalls('earth', true)`);
        k[`bez${rep}`] = await ev('window.__k7ab.gpuMed(30)');
        await ev(`window.__k7ab.hideHalls('earth', false)`);
      }
      k.info = await ev('window.__k7ab.info()');
      k.perf = await ev('window.__harness.scene.perf(60)');
      await ev(`window.__k7ab.cam('earth', 0, 3800, 0.12)`);
      await ev('window.__harness.frames(30)');
      k.halaZ = await ev('window.__k7ab.gpuMed(30)');
      await ev(`window.__k7ab.hideHalls('earth', true)`);
      k.halaBez = await ev('window.__k7ab.gpuMed(30)');
      await ev(`window.__k7ab.hideHalls('earth', false)`);
      k.halaInfo = await ev('window.__k7ab.info()');
      vr.koszt = k;
      console.log(v, 'koszt', JSON.stringify(k));
    }
    if (FRAMES.has('zbiorniki')) {
      await ev(`window.__k7ab.cam('earth', -810, 560, 1)`);
      await shot(v, 'zbiorniki-z1', { zoom: 1 });
    }
    if (FRAMES.has('brama')) {
      await ev(`window.__k7ab.cam('earth', 0, 7350, 0.5)`);
      await shot(v, 'brama-z0.5', { zoom: 0.5 });
      await ev(`window.__k7ab.cam('earth', -2950, 7330, 1.2)`);
      await shot(v, 'brama-koniec-z1.2', { zoom: 1.2 });
    }
    if (FRAMES.has('hala')) {
      await ev(`window.__k7ab.cam('earth', 0, 3800, 0.12)`);
      await shot(v, 'hala-z0.12', { zoom: 0.12 });
    }
    if (FRAMES.has('noc')) {
      await ev('(() => { window.__haloRings.__day = window.__haloRings._daylight; window.__haloRings._daylight = () => 0; return true; })()');
      await ev(`window.__k7ab.cam('earth', -810, 2500, 0.5)`);
      await ev('window.__harness.step(30)');
      await shot(v, 'noc-z0.5', { zoom: 0.5 });
      await ev(`window.__k7ab.cam('earth', -1425, 2650, 2)`);
      await shot(v, 'noc-z2', { zoom: 2 });
      await ev('(() => { window.__haloRings._daylight = window.__haloRings.__day; return true; })()');
      await ev('window.__harness.step(30)');
    }
    if (FRAMES.has('k3d')) {
      const ok = await ev(`(async () => {
        const p = window.__k7ab.at('earth', -1425, 2650);
        if (!window.Game3D) return false;
        window.__harness.scene.cam(p.x, p.y, 1.4);
        window.Game3D.setCamera('orbit');
        window.Game3D.focusEntity = { pos: { x: p.x, y: p.y }, angle: window.ship.angle, z: 0 };
        const r = window.Game3D.rig; r.az = -50; r.el = 32; r.first = true;
        await window.__harness.frames(14);
        return true;
      })()`);
      if (ok) {
        await shot(v, 'k3d-slupek', {});
        await ev(`(async () => { const r = window.Game3D.rig; r.az = 25; r.el = 22; r.first = true; await window.__harness.frames(10); return true; })()`);
        await shot(v, 'k3d-stanowisko', {});
        await ev(`(() => { window.Game3D.focusEntity = null; window.Game3D.setCamera('classic'); return true; })()`);
        await ev('window.__harness.frames(10)');
      }
    }
    if (FRAMES.has('odlacz')) {
      await ev(`window.__k7ab.cam('earth', -810, 2560, 0.5)`);
      await ev(`(() => { window.__k7ab.startUndock('earth'); return true; })()`);
      let tNow = 0;
      for (const [t, name] of [[0.9, 'odlacz-1-upust'], [1.5, 'odlacz-2-odryglowanie'], [2.7, 'odlacz-3-skladanie'], [3.8, 'odlacz-4-skladanie'], [5.4, 'odlacz-5-zlozone']]) {
        await ev(`window.__harness.step(${Math.round((t - tNow) * 60)})`);
        tNow = t;
        await shot(v, name, { t });
      }
      await ev(`window.__k7ab.cam('earth', -1425, 2650, 1.6)`);
      await shot(v, 'odlacz-6-zlozone-z1.6', {});
    }
    for (const key of ['mars', 'jowisz']) {
      if (!FRAMES.has(key)) continue;
      const ringKey = key === 'mars' ? 'mars' : 'jupiter';
      await ev(`(() => { window.__k7ab.undock = null; window.__k7ab.placeShip(${JSON.stringify(ringKey)}); window.__k7ab.cam(${JSON.stringify(ringKey)}, -810, 2500, 0.5); return true; })()`);
      if (!await waitRing(ringKey, 6000)) { console.log(v, key, 'ring nie zbudowany'); continue; }
      await ev(`window.__k7ab.placeShip(${JSON.stringify(ringKey)})`);
      await ev('window.__harness.step(240)');
      await ev(`window.__k7ab.cam(${JSON.stringify(ringKey)}, -810, 2500, 0.5)`);
      await shot(v, `${key}-z0.5`, { zoom: 0.5 });
      await ev(`window.__k7ab.cam(${JSON.stringify(ringKey)}, -1425, 2650, 1.6)`);
      await shot(v, `${key}-z1.6`, { zoom: 1.6 });
    }
    vr.pipeline = await pipesSince(k0);
    vr.bledy = logs.errors().filter((l) => !/favicon|\[vite\]|DevTools|powerPreference/.test(l)).slice(0, 30);
    console.log(v, 'pipeline', JSON.stringify(vr.pipeline));
    if (vr.bledy.length) console.log(`  BŁĘDY (${v}):\n   ${vr.bledy.join('\n   ')}`);
  }

  // Zestawienia: całe kadry w połowie rozdzielczości obok siebie + wycinek 1:1 ze środka
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  for (const [name, byV] of Object.entries(files)) {
    const list = VARIANTS.filter((v) => byV[v]);
    if (list.length < 2) continue;
    const imgs = list.map((v) => 'data:image/png;base64,' + readFileSync(byV[v]).toString('base64'));
    const png = await ev(`(async () => {
      const srcs = ${JSON.stringify(imgs)};
      const labels = ${JSON.stringify(list.map((v) => LABEL[v] || v))};
      const im = await Promise.all(srcs.map((s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = s; })));
      const w = im[0].width, h = im[0].height, cw = ${CW}, ch = ${CH}, pad = 8, top = 26;
      const W = Math.max(im.length * (w / 2) + (im.length - 1) * pad, im.length * cw + (im.length - 1) * pad);
      const c = document.createElement('canvas');
      c.width = W; c.height = top + h / 2 + pad + top + ch;
      const g = c.getContext('2d');
      g.fillStyle = '#05070d'; g.fillRect(0, 0, c.width, c.height);
      g.font = '15px Consolas, monospace'; g.fillStyle = '#cfe4ff';
      im.forEach((i, k) => {
        const x = k * (w / 2 + pad);
        g.fillText(labels[k] + ' — ${name}', x + 4, 18);
        g.drawImage(i, x, top, w / 2, h / 2);
        const cx = k * (cw + pad);
        const y = top + h / 2 + pad;
        g.fillText(labels[k] + ' — wycinek 1:1', cx + 4, y + 18);
        g.drawImage(i, (w - cw) / 2, (h - ch) / 2, cw, ch, cx, y + top, cw, ch);
      });
      return c.toDataURL('image/png').split(',')[1];
    })()`);
    writeFileSync(join(out, `ab-${name}.png`), Buffer.from(png, 'base64'));
  }
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
