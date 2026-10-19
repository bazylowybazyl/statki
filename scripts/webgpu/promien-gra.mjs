// Promień śmierci (2026-10-19, src/game/deathRay.js; dane `death_ray`) w PRAWDZIWEJ grze: własny Vite (bez HMR)
// + headless Chrome z WebGPU (CDP), harness strony (scripts/webgpu/harness-strona.js — czas stoi, gra kroczy tylko
// przez __harness.step), gra swobodna. Trzy przypadki:
//   gracz — Atlas w pustej przestrzeni z promieniem na gnieździe special (DevScene.mountSpecial), piracki pancernik
//           (z tarczą, bez mózgu i broni) w `--odl` j. na wschód, kursor nad celem, DevScene.fireSpecial(): ładowanie
//           4 s, strzał, rozpad;
//   npc    — rozkaz sceny DevScene.deathRay(strzelec, cel): pancernik Terra Nova ładuje i strzela w drugi pancernik;
//   wizual — DevScene.deathRayVisual(…) z ładowaniem i barwą sceny (bez trafień).
// Mierzy: HP, śmierć i wraki celu (odłamy po rzazie), stan promieni (DevScene.deathRayState), statystyki WeaponFx
// (promienie, trafienia, ładowania), pipeline'y tworzone synchronicznie od końca przygotowania (ma być 0), błędy konsoli.
// Zrzuty: ładowanie (25 / 90%), czoło, pełna wiązka, trwanie, rozpad (zbliżenie), strzał NPC, strzał wizualny.
//
//   node scripts/webgpu/promien-gra.mjs [--odl 3200] [--out .tmp/promien] [--port 5417] [--rozmiar 1600x900]
//        [--query renderWorker=1] [--przypadki gracz,npc,wizual]
// Wynik: <out>/*.png i <out>/raport.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const odl = Number(args.odl || 3200);
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/promien');
const cases = new Set(String(args.przypadki || 'gracz,npc,wizual').split(','));
const query = args.query ? `&${args.query}` : '';
mkdirSync(out, { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };   // pusta przestrzeń (jak lanca-gra / dym-gra)

const { server, base } = await startVite(Number(args.port || 5417));
const chrome = await startChrome({ width: W, height: H });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 600000) => evaluate(cdp, e, t);
// Konsola workera renderu (tryb worker: pipeline'y synchroniczne loguje render.worker.js — „pipeline sync #n”).
const workerLogs = [];
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    const sid = msg.params.sessionId;
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.enable', sessionId: sid }));
    cdp.ws.send(JSON.stringify({ id: 900000 + Math.floor(Math.random() * 99999), method: 'Runtime.runIfWaitingForDebugger', sessionId: sid }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
const report = { odl, przypadki: {}, pipelineSync: {}, bledy: [] };
const shot = async (name) => {
  await sleep(120);
  writeFileSync(join(out, `${name}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
};
const step = (n) => ev(`window.__harness.step(${n}).then(() => true)`);
const frames = (n) => ev(`window.__harness.frames(${n}).then(() => true)`);
// Pipeline'y od numeru klatki dziennika harnessu: render synchroniczne (sync bez compute) i compute.
const pipeMark = async () => ({ k: await ev('window.__harness.frameLog.n'), w: workerLogs.length });
const pipeSince = async (label, mark) => {
  const k0 = mark.k;
  const r = await ev(`(() => {
    const L = window.__harness.pipes.list.filter((p) => p.k >= ${k0} && !p.budowa);
    const sync = L.filter((p) => p.sync && !p.compute), comp = L.filter((p) => p.compute);
    return { render: sync.length, compute: comp.length, lista: [...new Set(sync.map((p) => p.nazwa))].slice(0, 12), listaCompute: [...new Set(comp.map((p) => p.nazwa))].slice(0, 8) };
  })()`);
  // tryb worker: pipeline'y synchroniczne w klatkach workera i jego błędy od znacznika
  const wl = workerLogs.slice(mark.w);
  r.worker = {
    sync: wl.filter((l) => l.includes('pipeline sync')).length, lista: wl.filter((l) => l.includes('pipeline sync')).slice(0, 12),
    bledy: wl.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 8)
  };
  report.pipelineSync[label] = r;
  return r;
};
const fxStats = () => ev(`(() => { const s = window.WeaponFx?.stats || {}; return { rays: s.rays, rayHits: s.rayHits, rayCharges: s.rayCharges, charges: s.charges, rayLive: s.rayLive }; })()`);

try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4242};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.__harness && window.DevScene)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30 && !!window.DevScene?.deathRay", 300000, 400)) {
    throw new Error('gra nie ruszyła');
  }
  await ev('window.__harness.hold(true)');
  report.tryb = await ev('window.__RENDER_MODE || window.RenderWorkerHost?.mode || (window.RenderWorkerHost ? "worker" : "off")');
  const prepMark = await pipeMark();

  // ------------------------------------------------------------------ przygotowanie: Atlas, cel, kamera, kursor
  const prep = await ev(String.raw`(async () => {
    const S = window.__harness.scene, H = window.__harness;
    S.hideHud(true);
    window.setFogOfWar?.(false);
    DevScene.preloadHullSprites();
    DevScene.mountMissile(null);
    const mounted = DevScene.mountSpecial('death_ray', 1);
    // Łuk gniazda special (270° wokół normalnej burty, weaponAim.mountFireArc): kurs tak, żeby burta gniazda patrzyła
    // na wschód, gdzie stoi cel (gniazdo na lewej burcie, y < 0 sprite'a — kurs na południe, na prawej — na północ).
    const lo = (Game.player.weapons?.special || []).find((l) => l?.weapon?.id === 'death_ray');
    const hy = Number(lo?.hp?.y ?? lo?.hp?.pos?.y) || 0;
    const heading = hy < 0 ? Math.PI / 2 : -Math.PI / 2;
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, heading);
    ship.angVel = 0;
    // działa main i rakiety bez ognia na auto (czysty kadr promienia; grupa special w ręku)
    fireControl.auto.main = false; fireControl.auto.missile = false; fireControl.inHand = 'special';
    const r = spawnCallInShip('battleship', { mode: 'pirate', spawnPos: { x: ${DEEP.x + odl}, y: ${DEEP.y} }, spawnAngle: Math.PI / 2 });
    const e = Array.isArray(r) ? r[0] : r;
    if (!e) return { error: 'brak celu' };
    e.ai = () => {}; e.autoWeapons = []; e._weaponsInit = true; e.vx = 0; e.vy = 0; e.angVel = 0;
    window.__prTarget = e;
    S.cam(${DEEP.x + odl * 0.5}, ${DEEP.y}, ${Math.min(0.32, (W * 0.8) / (odl + 2600)).toFixed(4)});
    await H.step(30);
    return { mounted, special: (Game.player.weapons?.special || []).map((l) => l.weapon?.id), gniazdo: lo?.hp ? { x: lo.hp.x ?? lo.hp.pos?.x, y: hy } : null,
      kurs: +heading.toFixed(3), typ: e.type, hp: e.hp, maxHp: e.maxHp, shield: e.shield ? Math.round(e.shield.val) : null, hull: !!e.beamHull };
  })()`);
  report.przygotowanie = prep;
  console.log('przygotowanie', JSON.stringify(prep));
  if (prep.error) throw new Error(prep.error);
  await waitFor(cdp, '!!window.__prTarget?.beamHull', 60000, 300);
  await step(30);
  for (let i = 0; i < 120 && !(await ev('window.__harness.scene.uploadsIdle()')); i++) await sleep(250);
  // przygotowanie: montaż promienia (wieża 3D rodziny `deathRay`), spawn celu — pipeline'y od wejścia do gry
  await pipeSince('przygotowanie', prepMark);

  if (cases.has('gracz')) {
    const C = report.przypadki.gracz = { etapy: [] };
    // kursor nad celem, wieża dochodzi (Capital ~43°/s)
    await ev(`(() => { const e = window.__prTarget; DevScene.pointerAt(e.x, e.y); return true; })()`);
    await step(150);
    C.wieza = await ev('(() => { const fc = window.fireControl; return fc.turrets.special.slice(0, fc.turretCount.special).map((t) => ({ stan: t.state, kat: +(+t.angle).toFixed(3) })); })()');
    const k0 = await pipeMark();
    C.przed = await ev(`(() => { const e = window.__prTarget; return { hp: Math.round(e.hp), nodes: e.beamHull?.body?.activeNodes ?? null, shield: e.shield ? Math.round(e.shield.val) : null, wraki: (window.wrecks || []).length, ladowanie: DevScene.specialCharge() }; })()`);
    C.fire = await ev('DevScene.fireSpecial()');
    // ładowanie 4 s: zrzuty przy ~25% i ~90%
    await step(60);
    C.etapy.push({ t: 'ladowanie-25', stan: await ev('DevScene.specialCharge()'), fx: await fxStats() });
    await shot('01-ladowanie-25');
    await step(150);
    C.etapy.push({ t: 'ladowanie-90', stan: await ev('DevScene.specialCharge()'), fx: await fxStats() });
    await shot('02-ladowanie-90');
    // do strzału (krok po kroku — zrzut tuż po wyjściu czoła)
    let fired = false;
    for (let i = 0; i < 120 && !fired; i++) {
      await step(1);
      fired = await ev('(DevScene.deathRayState().stats.fired || 0) > 0');
    }
    C.strzal = fired;
    if (!fired) throw new Error('promień nie wystrzelił (ładowanie: ' + JSON.stringify(await ev('DevScene.specialCharge()')) + ')');
    await step(2);
    await shot('03-czolo');
    await step(10);
    C.etapy.push({ t: 'wiazka', promien: await ev('DevScene.deathRayState().rays'), fx: await fxStats() });
    await shot('04-wiazka-pelna');
    await step(40);
    await shot('05-wiazka-trwanie');
    // rozpad: zbliżenie na cel
    await ev(`(() => { const e = window.__prTarget; window.__harness.scene.cam(e.x, e.y, 0.9); return true; })()`);
    await step(30);
    await shot('06-rozpad-zblizenie');
    await step(120);
    await shot('07-rozpad-3s');
    C.po = await ev(`(() => {
      const e = window.__prTarget;
      const key = e.beamHull?.dmgKey ?? e.__dmgKeySeen ?? null;
      const wr = (window.wrecks || []);
      return { hp: Math.round(e.hp), dead: !!e.dead, shield: e.shield ? Math.round(e.shield.val) : null, wraki: wr.length,
        wrakiCelu: wr.filter((w) => Math.hypot(w.x - e.x, w.y - e.y) < 3000).length,
        stan: DevScene.deathRayState().stats };
    })()`);
    C.fx = await fxStats();
    C.pipeline = await pipeSince('gracz', k0);
    console.log('gracz', JSON.stringify({ przed: C.przed, po: C.po, fx: C.fx, pipeline: C.pipeline }));
  }

  if (cases.has('npc')) {
    const C = report.przypadki.npc = {};
    const setup = await ev(String.raw`(async () => {
      const H = window.__harness;
      const bx = ${DEEP.x}, by = ${DEEP.y + 9000};
      const rs = spawnCallInShip('battleship', { mode: 'friendly', spawnPos: { x: bx - 2200, y: by }, spawnAngle: 0 });
      const rt = spawnCallInShip('battleship', { mode: 'pirate', spawnPos: { x: bx + 2200, y: by + 300 }, spawnAngle: Math.PI / 2 });
      const s = Array.isArray(rs) ? rs[0] : rs, t = Array.isArray(rt) ? rt[0] : rt;
      for (const e of [s, t]) { e.ai = () => {}; e.autoWeapons = []; e._weaponsInit = true; e.vx = 0; e.vy = 0; e.angVel = 0; }
      window.__prShooter = s; window.__prTarget2 = t;
      window.__harness.scene.cam(bx, by, 0.3);
      await H.step(30);
      return { s: !!s, t: !!t };
    })()`);
    await waitFor(cdp, '!!window.__prShooter?.beamHull && !!window.__prTarget2?.beamHull', 60000, 300);
    for (let i = 0; i < 80 && !(await ev('window.__harness.scene.uploadsIdle()')); i++) await sleep(250);
    const k0 = await pipeMark();
    C.przed = await ev('({ hp: Math.round(window.__prTarget2.hp), shield: window.__prTarget2.shield ? Math.round(window.__prTarget2.shield.val) : null })');
    C.rozkaz = await ev(`(() => { const o = DevScene.deathRay(window.__prShooter, window.__prTarget2, { charge: 2.5 }); return o ? { state: o.state, charge: o.charge } : null; })()`);
    await step(120);
    await shot('08-npc-ladowanie');
    await step(40);
    let fired = false;
    for (let i = 0; i < 60 && !fired; i++) { await step(1); fired = await ev('DevScene.deathRayState().rays.some((r) => !r.visual)'); }
    await step(12);
    await shot('09-npc-wiazka');
    await step(150);
    await shot('10-npc-po');
    C.po = await ev('({ hp: Math.round(window.__prTarget2.hp), dead: !!window.__prTarget2.dead, setup: true })');
    C.setup = setup;
    C.pipeline = await pipeSince('npc', k0);
    console.log('npc', JSON.stringify(C));
  }

  if (cases.has('wizual')) {
    const C = report.przypadki.wizual = {};
    const bx = DEEP.x, by = DEEP.y - 9000;
    await ev(`(() => { window.__harness.scene.cam(${bx}, ${by}, 0.28); return true; })()`);
    await step(10);
    const k0 = await pipeMark();
    C.rozkaz = await ev(`(() => { const o = DevScene.deathRayVisual(${bx - 3000}, ${by + 600}, ${bx + 3000}, ${by - 600}, { charge: 1.2, color: [1, 0.22, 0.08], width: 190 }); return o ? { state: o.state || null, visual: o.visual ?? null } : null; })()`);
    await step(55);
    await shot('11-wizual-ladowanie');
    await step(30);
    await shot('12-wizual-wiazka');
    await step(40);
    C.stan = await ev('DevScene.deathRayState().stats');
    C.pipeline = await pipeSince('wizual', k0);
    console.log('wizual', JSON.stringify(C));
  }
  report.fxKoniec = await fxStats();
} catch (e) {
  report.blad = String(e?.stack || e);
  console.log('BŁĄD', e.message);
} finally {
  report.bledy = logs.errors().filter((l) => !/favicon|powerPreference|\[vite\]|DevTools|Unable to decode audio|AudioSys/.test(l)).slice(0, 40);
  report.workerBledy = workerLogs.filter((l) => l.startsWith('[exception]') || l.startsWith('[error]')).slice(0, 20);
  report.workerPipelineSync = workerLogs.filter((l) => l.includes('pipeline sync')).length;
  report.workerPipelineLista = workerLogs.filter((l) => l.includes('pipeline sync')).slice(0, 20);
  writeFileSync(join(out, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('błędy', JSON.stringify(report.bledy.slice(0, 10), null, 1));
  console.log('wyniki', out);
  await chrome.close();
  await server.close();
  process.exit(0);
}
