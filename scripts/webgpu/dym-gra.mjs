// Dym i ogień zniszczeń w PRAWDZIWEJ grze (gaz 3D — src/3d/gas/gasSmokeGame.js, plan zniszczeń § 12): klatki po
// zdarzeniu (krok harnessu 1/60 s), liczniki gazu (domeny, źródła, ogniska), czas klatki i budowy materiałów.
//   node scripts/webgpu/dym-gra.mjs [--przypadki wrak,reaktor,stacja,kurz] [--klatki 0.3,1,2.5,5,9] [--zoom 0.45]
//        [--out .tmp/dym-gra] [--port 5371] [--3d] [--ab] [--mgla]
//   --3d: kamera 3D „z góry 3D” (K); --ab: każdy kadr też bez dymu (*-bez.png); --mgla: z mgłą wojny (domyślnie wył.)
// Okręty: spawnCallInShip (wrogi niszczyciel obok gracza w pustej przestrzeni), śmierć z puli HP (applyDamageToNPC)
// albo stopienie reaktora (ReactorGame.forceMeltdown). Stacja: Wenus, applyDamageToStation do zera. Kurz: zdarzenie
// uderzenia CollisionFX (jak taran).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startVite, startChrome, attachLogs, waitFor, evaluate, repo, osobneLosowanieUuid, parseArgs, sleep } from './wspolne.mjs';

const args = parseArgs();
const cases = String(args.przypadki || 'wrak,reaktor,stacja,kurz').split(',');
const times = String(args.klatki || '0.3,1,2.5,5,9').split(',').map(Number);
const zoom = Number(args.zoom || 0.45);
const outDir = resolve(repo, args.out || '.tmp/dym-gra');
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
mkdirSync(outDir, { recursive: true });

const DEEP = { x: 6210000, y: 5330000 };

const SETUP = String.raw`(async () => {
  const S = window.__harness.scene, H = window.__harness;
  S.hideHud(true);
  // Bez mgły wojny: stacja i kurz leżą poza wzrokiem gracza (post przygasza i odbarwia kadr).
  if (!${!!args.mgla}) window.setFogOfWar?.(false);
  DevScene.teleport(${DEEP.x}, ${DEEP.y}, 0);
  S.cam(${DEEP.x + 3000}, ${DEEP.y}, ${zoom});
  await H.frames(20);
  return !!window.GasSmoke;
})()`;

function caseJs(kind, index) {
  return String.raw`(async () => {
    const S = window.__harness.scene, H = window.__harness;
    const G = window.GasSmoke;
    G.clear();
    const X = ${DEEP.x + 3000}, Y = ${DEEP.y + index * 30000};
    let label = '${kind}';
    if ('${kind}' === 'stacja') {
      const st = stations.find((s) => s.id === 'venus');
      S.cam(st.x, st.y, ${zoom * 0.5});
      // Krok fizyki: skala stacji (st.r = baseR × stationScaleFor) liczy się w kroku — jak w grze.
      await H.step(2);
      await H.frames(30);
      for (let i = 0; i < 300 && !S.uploadsIdle(); i++) await new Promise((r) => setTimeout(r, 100));
      await new Promise((r) => setTimeout(r, 1500));
      label += ' r=' + Math.round(st.r) + ' bryła=' + Math.round(G._stationRadius(st));
      if (${!!args.diag}) {
        // Siatki bryły: pół boku pudła w (x, y) świata, z, widoczność materiału — co zawyża promień stacji.
        const rows = [];
        st._mesh3d.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
          rows.push([o.name || o.type, o.visible, o.material?.visible, +(o.material?.opacity ?? 1).toFixed(2),
            Math.round(Math.max(b.max.x - b.min.x, b.max.y - b.min.y) / 2), Math.round(b.min.z), Math.round(b.max.z), o.layers.mask]);
        });
        rows.sort((a, b) => b[4] - a[4]);
        const cp = Core3D.cameraPersp.position;
        label += ' | kamPersp z=' + Math.round(cp.z) + ' | ' + JSON.stringify(rows.slice(0, 12));
      }
      applyDamageToStation(st, 1e12);
    } else if ('${kind}' === 'kurz') {
      S.cam(X, Y, ${zoom});
      await H.frames(10);
      G._impact({ A: {}, B: {}, x: X, y: Y, nx: 0.6, ny: 0.8, approachSpeed: 520, contactVelX: 40, contactVelY: -20, brittle: false, hullPair: true });
    } else {
      DevScene.teleport(X - 9000, Y, 0);
      S.cam(X, Y, ${zoom});
      const r = spawnCallInShip('destroyer', { mode: 'hostile', spawnPos: { x: X, y: Y }, spawnAngle: 0.4 });
      const npc = Array.isArray(r) ? r[0] : r;
      await H.frames(40);
      if (!npc) return { kind: '${kind}', error: 'brak NPC' };
      npc.vx = 60; npc.vy = -25;
      if ('${kind}' === 'reaktor') ReactorGame.forceMeltdown(npc, 0.25);
      else applyDamageToNPC(npc, 1e12, 'default');
      label += ' ' + (npc.radius | 0);
    }
    return { kind: '${kind}', label, events: G.stats.events, dust: G.stats.dust };
  })()`;
}

const STEP = (n) => String.raw`(async () => {
  const H = window.__harness, G = window.GasSmoke;
  const t0 = performance.now();
  await H.step(${n});
  const g = G.grid.stats;
  return { ms: +(performance.now() - t0).toFixed(1), domeny: g.active, zrodla: g.sources, podkroki: g.substeps,
    ogniska: G.followers.length, zdarzenia: G.stats.events, cpu: +G.stats.cpuMs.toFixed(2),
    gpu: Number.isFinite(Core3D.gpuFrameMs) ? +Core3D.gpuFrameMs.toFixed(2) : null };
})()`;

const { server, base } = await startVite(Number(args.port || 5371));
const report = { cases: [] };
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
const shot = async (file) => writeFileSync(file, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1&renderer=webgpu` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready)', 240000, 500);
  // Tryb swobodny (bez kampanii) — jak maskowanie-gra.mjs.
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) {
    const diag = await ev(`(() => ({ loading: document.getElementById('loading')?.className, frame: window.__frameId || 0,
      gas: !!window.GasSmoke, calib: !!window.shipDriveState?.calib, menu: document.getElementById('main-menu')?.style?.display }))()`);
    console.log('DIAG', JSON.stringify(diag));
    console.log('LOGI', JSON.stringify(logs.all().slice(-25), null, 1));
    throw new Error('gra nie ruszyła');
  }
  await ev('window.__harness.hold(true)');
  const ok = await ev(SETUP);
  if (!ok) throw new Error('brak window.GasSmoke');
  if (args['3d']) await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k' })); return true; })()`);
  await sleep(6000);
  await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
  for (const [i, kind] of cases.entries()) {
    if (kind === 'stacja' && args.diag) {
      // Kadr stacji przed zniszczeniem (porównanie skali bryły z obłokiem i ogniskami).
      await ev(`(async () => { const st = stations.find((s) => s.id === 'venus'); window.__harness.scene.cam(st.x, st.y, ${zoom * 0.5}); await window.__harness.step(2); await window.__harness.frames(30); return true; })()`);
      await waitFor(cdp, 'window.__harness.scene.uploadsIdle()', 60000, 250);
      await sleep(1500);
      await shot(join(outDir, 'stacja-przed.png'));
    }
    const info = await ev(caseJs(kind, i));
    const rows = [];
    let tNow = 0;
    for (const at of times) {
      const n = Math.max(1, Math.round((at - tNow) * 60));
      const st = await ev(STEP(n));
      await sleep(150);
      const file = join(outDir, `${kind}-${String(at).replace('.', '_')}.png`);
      await shot(file);
      if (args.ab) {
        // Ten sam kadr bez dymu (czas stoi — frames nie kroczy gry): czy obłok nie zasłania wraku / stacji.
        await ev(`(async () => { Core3D.perfToggles.gasSmoke = false; await window.__harness.frames(2); return true; })()`);
        await sleep(150);
        await shot(file.replace(/\.png$/, '-bez.png'));
        await ev(`(async () => { Core3D.perfToggles.gasSmoke = true; await window.__harness.frames(1); return true; })()`);
      }
      rows.push({ t: at, ...st });
      tNow = at;
    }
    report.cases.push({ info, rows });
    console.log(kind, JSON.stringify(info), JSON.stringify(rows.map((r) => [r.t, r.domeny, r.zrodla, r.ogniska, r.gpu])));
    await ev(STEP(240));
  }
} catch (e) {
  console.log('BŁĄD', e.message);
} finally {
  report.errors = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 30);
  writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('błędy', JSON.stringify(report.errors.slice(0, 10), null, 1));
  console.log('wyniki', outDir);
  await chrome.close();
  await server.close();
  process.exit(0);
}
