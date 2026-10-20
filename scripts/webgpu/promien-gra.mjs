// Promień śmierci (2026-10-19, src/game/deathRay.js; dane `death_ray`) w PRAWDZIWEJ grze: własny Vite (bez HMR)
// + headless Chrome z WebGPU (CDP), harness strony (scripts/webgpu/harness-strona.js — czas stoi, gra kroczy tylko
// przez __harness.step), gra swobodna. Od 2026-10-20 promień to wbudowana wieża Colossusa Terra Nova (tylko NPC, jeden
// cel) — przygotowanie sprawdza, że gracz go nie zamontuje (DevScene.mountSpecial → 0). Trzy przypadki:
//   colossus — supercapital Terra Nova (spawnCallInShip('supercapital'), uzbrojenie jak w grze: promień na gnieździe
//              builtin dziobu; pozostałe grupy zdjęte, mózg = sam processAutonomousWeapons — bez ruchu) i dwa pirackie
//              pancerniki (z tarczą, bez mózgu i broni) na jednej linii przed dziobem w `--odl` j. i `--odl` + 2500 j.:
//              AI sama wybiera cel, ładuje 4 s i strzela; pierwszy ginie przecięty, drugi za nim zostaje cały;
//   npc      — rozkaz sceny DevScene.deathRay(strzelec, cel): pancernik Terra Nova ładuje i strzela w drugi pancernik;
//   wizual   — DevScene.deathRayVisual(…) z ładowaniem i barwą sceny (bez trafień).
// Mierzy: HP, śmierć i wraki celów (odłamy po rzazie), stan promieni (DevScene.deathRayState), statystyki WeaponFx
// (promienie, trafienia, ładowania), pipeline'y tworzone synchronicznie od wejścia do gry (ma być 0), błędy konsoli.
// Zrzuty: wieża Colossusa (zbliżenie), ładowanie, czoło, pełna wiązka, rozpad (zbliżenie), po 3 s, strzał NPC, wizualny.
//
//   node scripts/webgpu/promien-gra.mjs [--odl 5500] [--out .tmp/promien] [--port 5417] [--rozmiar 1600x900]
//        [--query renderWorker=1] [--przypadki colossus,npc,wizual]
// Wynik: <out>/*.png i <out>/raport.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const odl = Number(args.odl || 5500);
const [W, H] = (args.rozmiar || '1600x900').split('x').map(Number);
const out = resolve(repo, args.out || '.tmp/promien');
const cases = new Set(String(args.przypadki || 'colossus,npc,wizual').split(','));
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

  // ------------------------------------------------------------------ przygotowanie: Atlas, Colossus TN, cele, kamera
  // Colossus Terra Nova: uzbrojenie jak w grze (equipNpcWeapons — promień na gnieździe builtin dziobu), pozostałe grupy
  // zdjęte (czysty kadr promienia), mózg = sam processAutonomousWeapons (wybór celu, ładowanie, strzał — bez ruchu).
  // Cele: dwa pirackie pancerniki z tarczą na linii przed dziobem (bez mózgu i broni) — jeden cel: drugi ma przeżyć.
  const CY = DEEP.y + 7000;
  const prep = await ev(String.raw`(async () => {
    const S = window.__harness.scene, H = window.__harness;
    S.hideHud(true);
    window.setFogOfWar?.(false);
    DevScene.preloadHullSprites();
    DevScene.mountMissile(null);
    // gracz NIE dostaje promienia (npcOnly): montaż na gniazdach special odmawia
    const graczMontaz = DevScene.mountSpecial('death_ray', 1);
    DevScene.teleport(${DEEP.x}, ${DEEP.y}, -Math.PI / 2);
    ship.angVel = 0;
    fireControl.auto.main = false; fireControl.auto.missile = false;
    const { processAutonomousWeapons } = await import('/src/ai/capitalAI.js');
    // okręty kapitałowe (spawnCapitalCallIn) biorą pozycję z pola pos, nie ze spawnPos
    const rc = spawnCallInShip('supercapital', { mode: 'friendly', pos: { x: ${DEEP.x - 3000}, y: ${CY} }, spawnPos: { x: ${DEEP.x - 3000}, y: ${CY} }, spawnAngle: 0 });
    const c = Array.isArray(rc) ? rc[0] : rc;
    if (!c) return { error: 'brak Colossusa' };
    const builtin = (c.weapons?.builtin || []).map((l) => ({ id: l.weapon?.id, x: l.hp?.x, y: l.hp?.y, rot: l.hp?.rot, mount: l.hp?.mount }));
    for (const g of ['main', 'aux', 'missile', 'special', 'special_missile', 'hangar']) if (c.weapons?.[g]) c.weapons[g] = [];
    c._weaponsInit = false; c.autoWeapons = undefined;
    c.vx = 0; c.vy = 0; c.angVel = 0; c.angle = 0; c.desiredAngle = 0;
    c.ai = (dt) => processAutonomousWeapons(c, dt);
    if (c.supportData) c.supportData = null;
    const targets = [];
    for (const dx of [${odl}, ${odl + 2500}]) {
      const r = spawnCallInShip('battleship', { mode: 'pirate', spawnPos: { x: ${DEEP.x - 3000} + dx, y: ${CY} }, spawnAngle: Math.PI / 2 });
      const e = Array.isArray(r) ? r[0] : r;
      if (!e) return { error: 'brak celu' };
      e.ai = () => {}; e.autoWeapons = []; e._weaponsInit = true; e.vx = 0; e.vy = 0; e.angVel = 0;
      targets.push(e);
    }
    window.__prColossus = c; window.__prTarget = targets[0]; window.__prBehind = targets[1];
    S.cam(${DEEP.x - 3000 + (odl + 2500) * 0.5}, ${CY}, ${Math.min(0.3, (W * 0.8) / (odl + 2500 + 3200)).toFixed(4)});
    await H.step(30);
    return { graczMontaz, colossus: { typ: c.type, rama: c.shipFrame, builtin, hp: c.hp, radius: c.radius },
      cele: targets.map((e) => ({ typ: e.type, hp: e.hp, shield: e.shield ? Math.round(e.shield.val) : null, hull: !!e.beamHull })) };
  })()`);
  report.przygotowanie = prep;
  console.log('przygotowanie', JSON.stringify(prep));
  if (prep.error) throw new Error(prep.error);
  if (prep.graczMontaz !== 0) throw new Error('gracz zamontował promień (npcOnly): ' + prep.graczMontaz);
  if (!prep.colossus.builtin.some((b) => b.id === 'death_ray')) throw new Error('Colossus bez promienia na gnieździe builtin');
  await waitFor(cdp, '!!window.__prColossus?.beamHull && !!window.__prTarget?.beamHull && !!window.__prBehind?.beamHull', 60000, 300);
  // przygotowanie: spawn Colossusa (wieża 3D rodziny `deathRay` na gnieździe builtin) i celów — pipeline'y od wejścia do gry
  await pipeSince('przygotowanie', prepMark);

  if (cases.has('colossus')) {
    const C = report.przypadki.colossus = { etapy: [] };
    const k0 = await pipeMark();
    const tState = (name) => `(() => { const e = window.${name}; return { hp: Math.round(e.hp), dead: !!e.dead, nodes: e.beamHull?.body?.activeNodes ?? null, shield: e.shield ? Math.round(e.shield.val) : null }; })()`;
    C.przed = { cel: await ev(tState('__prTarget')), zaCelem: await ev(tState('__prBehind')) };
    const weapon = `(() => { const w = (window.__prColossus.autoWeapons || []).find((a) => a.id === 'death_ray'); return w ? { grupa: w.group, kat: +(+w.visualAngle).toFixed(3), cel: w.cachedTarget === window.__prTarget ? 'cel' : (w.cachedTarget === window.__prBehind ? 'zaCelem' : (w.cachedTarget ? 'inny' : null)), ladowanie: w.charge ? +(+w.charge.u || 0).toFixed(2) : null, cd: +(+w.cd).toFixed(2) } : null; })()`;
    // wieża Colossusa z bliska (gniazdo builtin na dziobie), zanim AI złapie cel
    C.czop = await ev(`(() => { const m = DevScene.deathRayMuzzle(window.__prColossus); if (m) window.__harness.scene.cam(m.x, m.y, 1.1);
      return m ? { x: Math.round(m.x - window.__prColossus.x), y: Math.round(m.y - window.__prColossus.y) } : null; })()`);
    await step(20);
    await shot('01-wieza-colossus');
    C.etapy.push({ t: 'wieza', bron: await ev(weapon) });
    await ev(`(() => { window.__harness.scene.cam(${DEEP.x - 3000 + (odl + 2500) * 0.5}, ${CY}, ${Math.min(0.3, (W * 0.8) / (odl + 2500 + 3200)).toFixed(4)}); return true; })()`);
    // AI: cel i ładowanie (4 s) — zrzut w połowie
    let charging = false;
    for (let i = 0; i < 240 && !charging; i++) { await step(1); charging = await ev("(window.__prColossus.autoWeapons || []).some((a) => a.id === 'death_ray' && a.charge && a.charge.charge >= 0)"); }
    C.ladowanieOd = charging;
    if (!charging) {
      const diag = await ev(`(() => { const c = window.__prColossus, t = window.__prTarget;
        const pool = window.getAIPirateCandidates?.();
        const sc = c._shipScanCaches?.slow;
        return { friendly: c.friendly, isPirate: c.isPirate, pool: Array.isArray(pool) ? pool.length : String(pool), celWPuli: Array.isArray(pool) && pool.includes(t),
          celWNpcs: (window.npcs || []).includes(t), cel: { isPirate: t.isPirate, friendly: t.friendly, dead: !!t.dead, typ: t.type, rodzaj: window.getUnitKind?.(t), x: Math.round(t.x - c.x), y: Math.round(t.y - c.y) },
          skan: sc ? { wrogowie: sc.enemies.length, rodzaje: sc.enemyKinds?.slice(0, 4), maxRange: sc.maxRange } : null,
          bronie: (c.autoWeapons || []).map((a) => ({ id: a.id, g: a.group, arc: +(+a.arc).toFixed(2), m: +(+a.mountAngle).toFixed(2), strict: a.strict, prefers: a.prefers })),
          kat: c.angle, mozg: String(c.ai).slice(0, 80) }; })()`);
      throw new Error('Colossus nie ładuje promienia: ' + JSON.stringify(await ev(weapon)) + ' diag ' + JSON.stringify(diag));
    }
    await step(120);
    C.etapy.push({ t: 'ladowanie', bron: await ev(weapon), fx: await fxStats() });
    await shot('02-ladowanie');
    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) { await step(1); fired = await ev('(DevScene.deathRayState().stats.fired || 0) > 0'); }
    C.strzal = fired;
    if (!fired) throw new Error('Colossus nie wystrzelił: ' + JSON.stringify(await ev(weapon)));
    await step(2);
    await shot('03-czolo');
    await step(10);
    C.etapy.push({ t: 'wiazka', promien: await ev('DevScene.deathRayState().rays'), fx: await fxStats() });
    await shot('04-wiazka');
    await ev(`(() => { const e = window.__prTarget; window.__harness.scene.cam(e.x, e.y, 0.75); return true; })()`);
    await step(30);
    await shot('05-rozpad-zblizenie');
    await ev(`(() => { window.__harness.scene.cam(${DEEP.x - 3000 + (odl + 2500) * 0.5}, ${CY}, ${Math.min(0.3, (W * 0.8) / (odl + 2500 + 3200)).toFixed(4)}); return true; })()`);
    await step(150);
    await shot('06-po-3s');
    C.po = {
      cel: await ev(tState('__prTarget')), zaCelem: await ev(tState('__prBehind')),
      wraki: await ev(`(() => { const e = window.__prTarget; return (window.wrecks || []).filter((w) => Math.hypot(w.x - e.x, w.y - e.y) < 3000).length; })()`),
      stan: await ev('DevScene.deathRayState().stats'), bron: await ev(weapon)
    };
    C.fx = await fxStats();
    C.pipeline = await pipeSince('colossus', k0);
    console.log('colossus', JSON.stringify({ przed: C.przed, po: C.po, fx: C.fx, pipeline: C.pipeline }));
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
