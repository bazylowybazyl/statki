// Wieże z Blendera W GRZE (GLB, src/3d/ships3d/weapons/weaponGlb.js) ↔ dawny model z weapons3D.js, A/B na tej
// samej klatce gry: broń na zaczepach Atlasa (special — DevScene.mountSpecial, inaczej main — mountMain) w trybie
// „Bronie 3D”. Wariant = lista rodzin z GLB w adresie gry (?bronieGlb=, rejestr weaponGlb.js):
//   stary            — ?bronieGlb= (żadna rodzina: buildWeapon3D = budowniczy),
//   blender          — --glb <lista> albo (bez --glb) rodziny gry z WEAPON_GLB_GAME (jak u gracza),
//   <nazwa>:<a+b@1>  — własna lista (rodziny łączone „+”, @1 = LOD1), np. lod1:tempest1@1+tempest2@1.
// A/B Tempesta: --bronie railgun_mk1,railgun_mk2 --glb tempest1,tempest2 --warianty stary,blender,lod1:tempest1@1+tempest2@1
// Strona z harnessem (zegar wirtualny, Math.random z ziarnem, osobne UUID three): ten sam świat i ta sama klatka
// w każdym wariancie (wariant = świeża strona).
//
//   node scripts/webgpu/bronie-blender-gra.mjs [--warianty stary,blender] [--glb yamato,tempest2@1]
//        [--bronie special_yamato_cannon,special_yamato_l] [--zaczep main|special]
//        [--zoomy 0.22,0.45,0.9,1.8] [--tryby 2d3d,3d3d] [--wycinek 480x320] [--rozmiar 1600x900] [--out .tmp/blender/ab-gra]
//        [--kamery3d tactical,orbit] [--zoom3d 2.4] [--az3d -35] [--el3d 30]
// --kamery3d — kadry z kamer 3D gry (K; statki i bronie zawsze modelami): kamera taktyczna celuje w wieżę (kamera RTS
// na wieży), orbita krąży wokół wieży (Game3D.focusEntity); odległość z zoomu (camera3DRig.distanceForZoom).
//
// Wynik: <out>/ab-<broń>-<tryb>-z<zoom>.png (wycinki 1:1 wokół wieży obok siebie), <out>/ab-<broń>-3d-<kamera>.png
// (cały kadr w połowie rozdzielczości), <out>/kadry/*.png, raport.json:
// źródło modelu (glb / builder), trójkąty rodziny, INSTANCJE partii rodziny (wieże w jednym rysunku —
// InstancedBufferGeometry), pipeline'y SYNCHRONICZNE w klatkach od montażu (ma być 0), błędy konsoli (ma być 0).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, writeJson, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const [CW, CH] = (args.wycinek || '480x320').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/blender/ab-gra');
// wariant → wartość ?bronieGlb= (null — bez parametru: rodziny gry)
const VARIANT_GLB = {};
const VARIANTS = String(args.warianty || 'stary,blender').split(',').map((t) => {
  const [name, list] = t.split(':');
  VARIANT_GLB[name] = list != null ? list.split('+').join(',') : name === 'stary' ? '' : (args.glb != null ? String(args.glb) : null);
  return name;
});
const WEAPONS = String(args.bronie || 'special_yamato_cannon,special_yamato_l').split(',');
const ZOOMS = String(args.zoomy || '0.22,0.45,0.9,1.8').split(',').map(Number);
const MODES = String(args.tryby || '2d3d,3d3d').split(',').filter(Boolean);
const CAMS3D = String(args.kamery3d || '').split(',').filter(Boolean);
const ZOOM3D = Number(args.zoom3d || 2.4);
const LABEL = { stary: 'weapons3D.js (dawny)', blender: 'Blender (GLB + AO)' };
const query = (v) => (VARIANT_GLB[v] == null ? '' : `&bronieGlb=${encodeURIComponent(VARIANT_GLB[v])}`);
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const GRA_SWOBODNA = `try { localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0'); } catch (e) {}\n`;

const { server, base } = await startVite(Number(args.port || 5398));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 240000) => evaluate(cdp, e, t);
const pipesSince = (k0) => ev(`(() => {
  const L = window.__harness.pipes.list;
  const p = L.filter((e) => e.k >= ${k0} && !e.budowa);
  const sync = p.filter((e) => e.sync && !e.compute);
  const nb = L.filter((e) => e.k >= ${k0} && e.budowa && !e.poza);
  return { sync: sync.length, compute: p.filter((e) => e.compute).length, budowyWKlatce: nb.length,
    lista: [...new Set(sync.map((e) => e.nazwa))].slice(0, 12), nbLista: [...new Set(nb.map((e) => e.nazwa))].slice(0, 12) };
})()`);
// Partie wież w scenie: rodzina → { instancje, rysunek (visible), InstancedBufferGeometry, trójkąty, aAO }
const batchInfo = () => ev(`(() => {
  const o = {};
  window.Core3D.scene.traverse((m) => {
    if (!m.isMesh || !String(m.name).startsWith('wieże 3D: ')) return;
    const g = m.geometry;
    o[m.name.slice(10)] = { instancje: g.instanceCount, rysowana: m.visible, instanced: !!g.isInstancedBufferGeometry,
      trojkaty: g.index ? g.index.count / 3 : 0, aAO: !!g.attributes.aAO, aoMin: g.attributes.aAO ? +Math.min(...g.attributes.aAO.array).toFixed(2) : null };
  });
  return o;
})()`);
const report = { warianty: {} };
const files = {};
const files3d = {}; // `${broń}-3d-${kamera}` → wariant → plik
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${GRA_SWOBODNA}window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  for (const v of VARIANTS) {
    for (const weapon of WEAPONS) {
      logs.clear();
      await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query(v)}` });
      if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness && window.setVisualMode)', 240000, 400)) throw new Error('gra nie wstała');
      await ev(`(() => { window.setVisualMode(false, true); document.getElementById('btn-mode-single')?.click(); return true; })()`);
      if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
      await ev('window.__harness.hold(true)');
      const k0 = await ev('window.__harness.frameLog.n');
      const mounted = await ev(`(async () => {
        const H = window.__harness, S = H.scene; S.hideHud(true);
        // broń specjalna (special_*) na zaczepy special, reszta (Tempest, Lanca, …) na main; --zaczep main|special
        const n = ${JSON.stringify(args.zaczep || (weapon.startsWith('special_') ? 'special' : 'main'))} === 'special'
          ? window.DevScene.mountSpecial(${JSON.stringify(weapon)}) : window.DevScene.mountMain(${JSON.stringify(weapon)});
        for (let i = 0; i < 600 && !S.hullsReady(); i++) await H.frames(2);
        // Pół sekundy czasu gry: krok czujników (mgła wojny) i wejście gry.
        await H.step(30);
        await H.frames(12);
        const w = await import('/src/3d/ships3d/weapons/weapons3D.js');
        const fam = w.WEAPON3D_FAMILY[${JSON.stringify(weapon)}];
        const m = w.buildWeapon3D(fam);
        const t = (k) => m.parts[k].build().triangleCount;
        return { glb: ${JSON.stringify(VARIANT_GLB[v] ?? 'gra')}, zaczepy: n, rodzina: fam, zrodlo: m.source, trojkatyRodziny: t('ring') + t('housing') + m.barrels.length * t('barrel') };
      })()`);
      const key = `${v}/${weapon}`;
      const vr = (report.warianty[key] = { ...mounted, kadry: {} });
      console.log(key, JSON.stringify(mounted));
      for (const mode of MODES) {
        await ev(`(() => { window.setVisualMode(${mode.startsWith('3d')}, ${mode.endsWith('3d')}); return true; })()`);
        for (const z of ZOOMS) {
          const r = await ev(`(async () => {
            const H = window.__harness, S = H.scene;
            const recs = window.Turret2D.recordsFor(window.ship) || [];
            const t = recs.find((q) => q.weaponId === ${JSON.stringify(weapon)});
            if (!t) return { brak: recs.map((q) => q.weaponId) };
            S.cam(t.wx, t.wy, ${z});
            await H.frames(8);
            const t2 = (window.Turret2D.recordsFor(window.ship) || []).find((q) => q.weaponId === ${JSON.stringify(weapon)});
            return { x: Math.round(t2.wx), y: Math.round(t2.wy), skala: +t2.scale.toFixed(3) };
          })()`);
          if (r.brak) throw new Error(`brak wieży ${weapon} w rekordach (${v}): ${r.brak.join(',')}`);
          r.partie = await batchInfo();
          const f = join(out, 'kadry', `${weapon}-${mode}-z${z}--${v}.png`);
          await screenshotPng(cdp, f);
          ((files[`${weapon}-${mode}`] ||= {})[z] ||= {})[v] = f;
          vr.kadry[`${mode}-z${z}`] = r;
          // partie rodziny z wieżami w tej klatce (tryb AUTO: LOD0 — `rodzina`, LOD1 — `rodzina@1`)
          const ps = [vr.rodzina, `${vr.rodzina}@1`].map((n) => [n, r.partie[n]]).filter(([, p]) => p && p.instancje > 0);
          console.log('zrzut', key, mode, z, ps.length
            ? ps.map(([n, p]) => `partia ${n}: ${p.instancje} wież / 1 rysunek, ${p.trojkaty} trójkątów, AO min ${p.aoMin}`).join('; ')
            : 'brak partii');
        }
      }
      for (const k of CAMS3D) {
        await ev(`(async () => { const H = window.__harness, S = H.scene; window.setVisualMode(false, false);
          const t = (window.Turret2D.recordsFor(window.ship) || []).find((q) => q.weaponId === ${JSON.stringify(weapon)});
          S.cam(t.wx, t.wy, ${ZOOM3D});
          window.Game3D.setCamera(${JSON.stringify(k)});
          window.Game3D.focusEntity = ${JSON.stringify(k)} === 'orbit' ? { pos: { x: t.wx, y: t.wy }, angle: window.ship.angle, z: 0 } : null;
          const r = window.Game3D.rig; r.az = ${Number(args.az3d ?? -35)}; r.el = ${Number(args.el3d ?? 30)}; r.first = true;
          await H.frames(12); return true; })()`);
        const partie = await batchInfo();
        vr.kadry[`3d-${k}`] = { partie };
        const f = join(out, 'kadry', `${weapon}-3d-${k}--${v}.png`);
        await screenshotPng(cdp, f);
        (files3d[`${weapon}-3d-${k}`] ||= {})[v] = f;
        // rodziny z dwiema partiami (LOD0 / LOD1 — tryb AUTO): ile wież w każdej
        const lods = Object.entries(partie).filter(([n]) => n === vr.rodzina || n === `${vr.rodzina}@1`)
          .map(([n, p]) => `${n}: ${p.instancje}${p.rysowana ? '' : ' (ukryta)'}`).join(', ');
        console.log('zrzut', key, '3d', k, lods ? `partie ${lods}` : '');
      }
      // Kamera 3D zapisuje się w preferencjach (localStorage) — bez powrotu do klasycznej następny wariant
      // (świeża strona) startowałby w kamerze 3D i kadry z góry byłyby z perspektywy.
      if (CAMS3D.length) await ev(`(async () => { window.Game3D.focusEntity = null; window.Game3D.setCamera('classic'); await window.__harness.frames(2); return true; })()`);
      vr.pipeline = await pipesSince(k0);
      vr.bledy = logs.errors().slice(0, 30);
      console.log('  pipeline', JSON.stringify(vr.pipeline));
      if (vr.bledy.length) console.log(`  BŁĘDY (${key}):\n   ${vr.bledy.join('\n   ')}`);
    }
  }

  // Zestawienia: wycinek 1:1 wokół wieży (środek kadru) z każdego wariantu obok siebie.
  await cdp.send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  for (const [fk, byZoom] of Object.entries(files)) {
    for (const z of ZOOMS) {
      const list = VARIANTS.map((v) => ({ label: `${LABEL[v] || v} · zoom ${z}`, data: readFileSync(byZoom[z][v]).toString('base64') }));
      const png = await ev(`(async () => {
        const list = ${JSON.stringify(list)};
        const imgs = await Promise.all(list.map((e) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + e.data; })));
        const w = ${CW}, h = ${CH}, gap = 6;
        const c = document.createElement('canvas'); c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h;
        const g = c.getContext('2d'); g.fillStyle = '#555'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
        imgs.forEach((im, k) => {
          const x = k * (w + gap);
          g.drawImage(im, (im.width - w) / 2, (im.height - h) / 2, w, h, x, 0, w, h);
          g.font = '600 14px system-ui, sans-serif'; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 6, 6, g.measureText(list[k].label).width + 12, 22);
          g.fillStyle = '#e8f2ff'; g.fillText(list[k].label, x + 12, 22);
        });
        return c.toDataURL('image/png').slice(22);
      })()`, 60000);
      const f = join(out, `ab-${fk}-z${z}.png`);
      writeFileSync(f, Buffer.from(png, 'base64'));
      console.log('zestawienie', f);
    }
  }
  // Kadry kamer 3D: cały kadr w połowie rozdzielczości, warianty obok siebie.
  for (const [fk, byVar] of Object.entries(files3d)) {
    const list = VARIANTS.map((v) => ({ label: `${LABEL[v] || v} · ${fk.replace(/^.*-3d-/, 'kamera ')}`, data: readFileSync(byVar[v]).toString('base64') }));
    const png = await ev(`(async () => {
      const list = ${JSON.stringify(list)};
      const imgs = await Promise.all(list.map((e) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + e.data; })));
      const w = Math.round(imgs[0].width / 2), h = Math.round(imgs[0].height / 2), gap = 6;
      const c = document.createElement('canvas'); c.width = w * imgs.length + gap * (imgs.length - 1); c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#555'; g.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, k) => {
        const x = k * (w + gap);
        g.drawImage(im, x, 0, w, h);
        g.font = '600 14px system-ui, sans-serif'; g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x + 6, 6, g.measureText(list[k].label).width + 12, 22);
        g.fillStyle = '#e8f2ff'; g.fillText(list[k].label, x + 12, 22);
      });
      return c.toDataURL('image/png').slice(22);
    })()`, 60000);
    const f = join(out, `ab-${fk}.png`);
    writeFileSync(f, Buffer.from(png, 'base64'));
    console.log('zestawienie', f);
  }
  writeJson(join(out, 'raport.json'), report);
} finally {
  await chrome.close();
  await server.close();
}
