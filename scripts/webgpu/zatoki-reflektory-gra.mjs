// REFLEKTORY PODEJŚCIA w hali K-7 i LAMPY ZATOK KAPSUŁ RATUNKOWYCH w PRAWDZIWEJ grze (decyzje użytkownika 2026-11-11).
// Vite + Chrome z WebGPU (CDP), gra swobodna, zegar krokowy harnessu (`__harness.step`).
//
//   node scripts/webgpu/zatoki-reflektory-gra.mjs [--query renderWorker=1] [--out .tmp/webgpu/zatoki-reflektory]
//        [--etapy reflektory,zatoki] [--kadlub freighter-capital] [--port 5471]
//
// reflektory — Atlas za bramą G-01 hali 0 Ziemi (dach odsłonięty nadpisaniem fabuły), kamera nad polem C-01: kadr
//   PRZED podejściem (reflektor C-01 przygaszony), w TRAKCIE narastania i PEŁNY, Atlas na polu, po odlocie ku bramie
//   (gaśnie); poziom `approachLight` stanowisk z rejestru i jasność kadru wokół plamy reflektora (średnia luminancja).
// zatoki — okręt Terra Novy obracający się 0,25 rad/s ginie przed graczem: lampy zatok kapsuł na wraku migają coraz
//   szybciej do wyrzutu (kadry przy czasie do wyrzutu ~1,5 / ~0,6 / ~0,15 s, seria 4 kadrów, po wyrzucie), zatoki
//   w układzie wraku stoją (odchyłka miejsc w układzie kadłuba przy obrocie), kapsuły wylatują z burt.
// Wynik: <out>/wyniki.json, zrzuty <out>/*.png, pipeline'y synchroniczne strony i workera (mają być 0), błędy konsoli.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, repo, writeJson } from './wspolne.mjs';
import { readPng } from './png.mjs';

const args = parseArgs();
const query = args.query ? `&${args.query}` : '';
const out = resolve(repo, args.out || `.tmp/webgpu/zatoki-reflektory${args.query ? '-worker' : '-off'}`);
mkdirSync(out, { recursive: true });
const STAGES = new Set(String(args.etapy || 'reflektory,zatoki').split(','));
const HULL = args.kadlub || 'freighter-capital';
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');

const { server, base } = await startVite(Number(args.port || 5471));
const chrome = await startChrome({ width: 1600, height: 900 });
const guard = setTimeout(async () => { console.error('LIMIT CZASU PRZEBIEGU'); try { await chrome.close(); } catch {} process.exit(2); },
  Number(args.limit || 20) * 60000);
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 180000) => evaluate(cdp, e, t);
const result = { query: args.query || 'off', etapy: {}, zrzuty: [], bledyAsercji: [] };
const check = (ok, what) => { if (!ok) result.bledyAsercji.push(what); console.log(ok ? 'OK  ' : 'BŁĄD', what); };
const workerLogs = [];
let msgId = 900000;
cdp.on((msg) => {
  if (msg.method === 'Target.attachedToTarget') {
    for (const method of ['Runtime.enable', 'Runtime.runIfWaitingForDebugger']) cdp.ws.send(JSON.stringify({ id: ++msgId, method, sessionId: msg.params.sessionId }));
  }
  if (msg.sessionId && msg.method === 'Runtime.consoleAPICalled') {
    workerLogs.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 2000));
  }
  if (msg.sessionId && msg.method === 'Runtime.exceptionThrown') {
    workerLogs.push(`[exception] ${msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text}`.slice(0, 2000));
  }
});
await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

const step = (n) => ev(`window.__harness.step(${Math.max(1, Math.round(n))}).then(() => true)`, 600000);
const stepSec = async (s) => { let left = Math.round(s * 60); while (left > 0) { const n = Math.min(120, left); await step(n); left -= n; } };
async function shot(name) {
  await ev('window.__harness.frames(2)');
  const file = join(out, `${name}.png`);
  await screenshotPng(cdp, file);
  result.zrzuty.push(name);
  return file;
}
/** Średnia luminancja (0…255) prostokąta wokół środka kadru (± hw, ± hh px). */
function centerLuma(file, hw = 220, hh = 130) {
  const img = readPng(file);
  const ch = img.data.length / (img.width * img.height);
  const cx = img.width >> 1, cy = img.height >> 1;
  let sum = 0, n = 0;
  for (let y = cy - hh; y < cy + hh; y++) for (let x = cx - hw; x < cx + hw; x++) {
    const o = (y * img.width + x) * ch;
    sum += 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2];
    n++;
  }
  return +(sum / n).toFixed(2);
}

try {
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try {
    localStorage.setItem('sc_story_campaign', '0'); localStorage.setItem('sc_story_tutorial', '0');
  } catch {} })();\nwindow.__HARNESS_SEED__ = ${0x5eed4711};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1${query}` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.ship && window.DevScene && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await waitFor(cdp, '!!(window.__menuBackdrop && window.__menuBackdrop.ready) || !!window.RenderWorkerHost', 240000, 500);
  await new Promise((r) => setTimeout(r, 1500));
  await ev(`(() => { document.getElementById('btn-new-game')?.click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 900));
  await ev(`(() => { document.querySelector('[data-story-campaign="0"]')?.click(); document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && (window.__frameId || 0) > 30", 300000, 400)) throw new Error('gra nie ruszyła');
  result.tryb = await ev('window.RenderWorkerHost ? "worker" : "off"');
  await ev('window.DevScene.preloadHullSprites()');
  await ev('window.__harness.hold(true)');
  await ev('window.__harness.scene.hideHud(true)');
  await stepSec(1);
  result.pipesStronaStart = await ev(`(window.__harness?.pipes?.list || []).length`);
  const workerSyncStart = workerLogs.filter((l) => /pipeline sync/.test(l)).length;
  console.log('tryb', result.tryb);

  if (STAGES.has('reflektory')) {
    // Hala 0 Ziemi: przekształcenie hub → gra, dach odsłonięty (nadpisanie fabuły — to samo co intro kampanii).
    const st = {};
    st.hala = await ev(`(async () => {
      const m = await import('/src/game/hallDustInput.js');
      const e = window.__haloWorld.entries.find((q) => q.key === 'earth');
      const owner = e.collider.registry.halls[0];
      const a = m.hallToGameAffine(e.collider.place, owner.frame, {});
      window.__hub = (hx, hz) => ({ x: a.p0x + hx * a.ax + hz * a.bx, y: a.p0y + hx * a.ay + hz * a.by });
      window.__hubHeading = (h) => Math.atan2(Math.sin(h) * a.by + Math.cos(h) * a.ay, Math.sin(h) * a.bx + Math.cos(h) * a.ax);
      window.__hubVel = (vx, vz) => ({ x: vx * a.ax + vz * a.bx, y: vx * a.ay + vz * a.by });
      window.__berths = owner.layout.berths;
      window.StoryGame?.deps?.setHallRoof?.({ key: 'earth', hall: 0, roofFade: 1, cut: 1 });
      return { zajete: owner.layout.berths.filter((b) => b.size === 'CAPITAL').map((b) => [b.id, b.occupied, b.reserved]) };
    })()`);
    // Atlas w hubie (hx, hz), kursem w hubie hHub, prędkość (vx, vz) w hubie — trzymany przez n kroków (ruch z prędkości).
    const fly = (hx, hz, vx, vz, n, hHub = -Math.PI / 2) => ev(`(async () => {
      const H = window.__harness, s = window.ship;
      const v = window.__hubVel(${vx}, ${vz});
      for (let k = 0; k < ${n}; k++) {
        const p = window.__hub(${hx} + ${vx} * k / 60, ${hz} + ${vz} * k / 60);
        s.pos.x = p.x; s.pos.y = p.y; s.vel.x = v.x; s.vel.y = v.y; s.angle = window.__hubHeading(${hHub}); if (s.angVel !== undefined) s.angVel = 0;
        await H.step(1);
      }
      return true;
    })()`, 600000);
    const level = () => ev(`(() => Object.fromEntries(window.__berths.filter((b) => b.size === 'CAPITAL').map((b) => [b.id, +(b.approachLight ?? NaN).toFixed(3)])))()`);
    const spot = () => ev(`(() => { const e = window.__haloRings?.entries?.find((q) => q.key === 'earth'); const h = e?.ring?.k7Halls?.[0];
      const v = h?.k7Uniforms?.uK7Spots?.value; return v ? [0, 1, 2, 3].map((i) => +v[i * 3 + 2].x.toFixed(3)) : null; })()`);
    const camAt = (hx, hz, zoom) => ev(`(() => { const p = window.__hub(${hx}, ${hz}); return window.__harness.scene.cam(p.x, p.y, ${zoom}); })()`);
    // PRZED: Atlas za końcem pasa (bez podejścia), kamera nad polem C-01
    await fly(-810, 9900, 0, 0, 150);
    await camAt(-810, 2500, 0.27);
    await stepSec(0.5);
    st.przed = { poziom: await level(), reflektory: await spot() };
    st.przed.luma = centerLuma(await shot('r0-przed-podejsciem'));
    // PODEJŚCIE: pas C-01 od z 8600 ku stanowisku 250 j/s, dziobem do ściany tylnej
    await fly(-810, 8600, 0, -250, 21);
    st.wTrakcie = { poziom: await level(), reflektory: await spot() };
    st.wTrakcie.luma = centerLuma(await shot('r1-podejscie-narasta'));
    await fly(-810, 8600 - 250 * 21 / 60, 0, -250, 70);
    st.pelny = { poziom: await level(), reflektory: await spot() };
    st.pelny.luma = centerLuma(await shot('r2-podejscie-pelny'));
    // Atlas na polu C-01 (postój): kadr z kadłubem w świetle reflektora
    await fly(-810, 2300, 0, 0, 60);
    await camAt(-810, 2000, 0.3);
    st.naPolu = { poziom: await level() };
    await shot('r3-atlas-na-polu');
    // ODLOT ku bramie (S): reflektor gaśnie (2,5 s) — po odpięciu automatu obsługi
    await camAt(-810, 2500, 0.27);
    await fly(-810, 2300, 0, 320, 420, -Math.PI / 2);
    st.poOdlocie = { poziom: await level(), reflektory: await spot() };
    st.poOdlocie.luma = centerLuma(await shot('r4-po-odlocie'));
    await ev('window.StoryGame?.deps?.setHallRoof?.(null)');
    result.etapy.reflektory = st;
    console.log('reflektory:', JSON.stringify(st));
    check(st.przed.poziom['C-01'] === 0, `przed podejściem C-01 przygaszony (${st.przed.poziom['C-01']})`);
    check(st.wTrakcie.poziom['C-01'] > 0.2 && st.wTrakcie.poziom['C-01'] < 0.9, `w trakcie narasta (${st.wTrakcie.poziom['C-01']})`);
    check(st.pelny.poziom['C-01'] === 1, `podejście — pełny (${st.pelny.poziom['C-01']})`);
    check(st.pelny.luma > st.przed.luma, `kadr jaśniejszy przy pełnym reflektorze (${st.przed.luma} → ${st.pelny.luma})`);
    check(st.poOdlocie.poziom['C-01'] === 0, `po odlocie przygaszony (${st.poOdlocie.poziom['C-01']})`);
    if (st.pelny.reflektory && st.przed.reflektory) check(st.pelny.reflektory[0] > st.przed.reflektory[0] * 2, `uniform reflektora C-01 (off): ${st.przed.reflektory[0]} → ${st.pelny.reflektory[0]}`);
  }

  if (STAGES.has('zatoki')) {
    const st = {};
    // Głęboka przestrzeń, okręt Terra Novy 4 tys. j. przed graczem, obraca się 0,25 rad/s.
    st.spawn = await ev(`(() => {
      const X = 6210000, Y = 5330000;
      window.DevScene.teleport(X, Y, 0);
      const s = window.ship; s.vel.x = 0; s.vel.y = 0;
      const npc = window.spawnDevHull(${JSON.stringify(HULL)}, { pos: { x: X + 4000, y: Y }, spawnAngle: 0.4, mode: 'dummy' });
      if (!npc) return null;
      npc.factionId = 'terra_nova';
      window.__podNpc = npc;
      return { x: npc.x, y: npc.y };
    })()`);
    for (let k = 0; k < 40 && !(await ev('!!window.__podNpc?.beamHull')); k++) await stepSec(0.25);
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.3)`);
    await stepSec(0.5);
    await shot('z0-przed');
    // Śmierć z obrotem (wrak dziedziczy ruch kadłuba)
    st.kill = await ev(`(() => { const n = window.__podNpc; n.angVel = 0.25; window.applyDamageToNPC(n, 1e7, 'default', {}, false);
      const p = window.EscapePods.pool; let bound = 0; for (let i = 0; i < p.count; i++) if (p.state[i] === 0 && p.bay[i]) bound++;
      return { dead: !!n.dead, kapsul: window.EscapePods.count, wZatokach: bound }; })()`);
    // Zatoki w układzie wraku: miejsca (lokalnie) na początku i po czasie — stoją, choć wrak się obraca
    const BAYS = `(() => { const p = window.EscapePods.pool; const rows = []; let tau = Infinity;
      for (let i = 0; i < p.count; i++) { if (p.state[i] !== 0 || !p.bay[i]) continue; const e = p.bay[i].body?.hull?.entity; if (!e) continue;
        const c = Math.cos(e.angle), s = Math.sin(e.angle), dx = p.x[i] - e.x, dy = p.y[i] - e.y;
        rows.push({ uid: p.uid[i], lx: dx * c + dy * s, ly: -dx * s + dy * c, wrak: !!e.isWreck, kat: e.angle }); tau = Math.min(tau, p.timer[i]); }
      return { zatok: rows.length, tau, rows }; })()`;
    await stepSec(0.25);
    const b0 = await ev(BAYS);
    st.zatokiStart = { zatok: b0.zatok, tau: b0.tau, wrak: b0.rows.every((r) => r.wrak) };
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.3)`);
    // kadry przy najkrótszym czasie do wyrzutu ~1,0 / ~0,5 / ~0,12 s
    const stepToTau = async (tau) => { for (let k = 0; k < 400; k++) { const b = await ev(BAYS); if (!(b.tau > tau)) return b; await step(1); } return ev(BAYS); };
    const statsBays = () => ev(`(async () => { const m = await import('/src/3d/escapePods/escapePods3D.js'); return { ...m.sharedEscapePods3D().stats }; })()`);
    let b1 = await stepToTau(1.0);
    st.tau1 = { tau: b1.tau, zatok: b1.zatok, obraz: result.tryb === 'off' ? await statsBays() : null };
    await shot('z1-zatoki-tau-1s');
    // odchyłka zatok w układzie wraku (wrak obrócił się od wiązania)
    const drift = (a, b) => Math.max(0, ...b.rows.map((r) => { const q = a.rows.find((x) => x.uid === r.uid); return q ? Math.hypot(r.lx - q.lx, r.ly - q.ly) : 0; }));
    st.obrotWraku = +((b1.rows[0]?.kat ?? 0) - (b0.rows[0]?.kat ?? 0)).toFixed(3);
    st.odchylkaZatok = +drift(b0, b1).toFixed(3);
    // kadr w błysku: krok po kroku, aż świeci co najmniej połowa lamp zatok (faza z czasu do wyrzutu — podBayBlink)
    const stepToLit = () => ev(`(async () => { const m = await import('/src/3d/escapePods/escapePods3D.js'); const p = window.EscapePods.pool;
      for (let k = 0; k < 40; k++) { let n = 0, lit = 0;
        for (let i = 0; i < p.count; i++) { if (p.state[i] !== 0 || !p.bay[i]) continue; n++; if (m.podBayBlink(p.timer[i]) > 0.8) lit++; }
        if (!n || lit * 2 >= n) return { zatok: n, swieci: lit }; await window.__harness.step(1); }
      return null; })()`);
    for (let k = 0; k < 4; k++) { await step(3); st[`seria${k}`] = await stepToLit(); await shot(`z2-seria-${k}`); }
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.6)`);
    st.zblizenie = await stepToLit();
    await shot('z2b-zatoki-zblizenie');
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.3)`);
    b1 = await stepToTau(0.5);
    await stepToLit();
    await shot('z3-zatoki-tau-0-5s');
    b1 = await stepToTau(0.12);
    st.tau3 = { tau: b1.tau, zatok: b1.zatok, obraz: result.tryb === 'off' ? await statsBays() : null };
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.75)`);
    await shot('z4-zatoki-tau-0-12s-zblizenie');
    await ev(`window.__harness.scene.cam(window.__podNpc.x, window.__podNpc.y, 0.3)`);
    // wyrzut: wszystkie kapsuły poza kadłubem, lampy zatok zgasły
    for (let k = 0; k < 600; k++) { const b = await ev(BAYS); if (!b.zatok) break; await step(2); }
    await stepSec(0.6);
    st.poWyrzucie = await ev(`(() => { const p = window.EscapePods.pool; let pend = 0, out = 0; for (let i = 0; i < p.count; i++) (p.state[i] === 0 ? pend++ : out++); return { wKadlubie: pend, poza: out }; })()`);
    st.obrazPoWyrzucie = result.tryb === 'off' ? await statsBays() : null;
    st.radar = await ev('window.EscapePods.radar(20000)');
    await shot('z5-po-wyrzucie');
    result.etapy.zatoki = st;
    console.log('zatoki:', JSON.stringify(st));
    check(st.kill && st.kill.wZatokach > 0 && st.kill.wZatokach === st.kill.kapsul, `kapsuły w zatokach na kadłubie (${JSON.stringify(st.kill)})`);
    check(st.zatokiStart.wrak, 'zatoki jadą z wrakiem (ciało przeszło na wrak)');
    check(Math.abs(st.obrotWraku) > 0.05 && st.odchylkaZatok < 2, `zatoki stoją w układzie wraku przy obrocie ${st.obrotWraku} rad (odchyłka ${st.odchylkaZatok} j.)`);
    if (st.tau1.obraz) check(st.tau1.obraz.bays === st.tau1.zatok, `obraz rysuje zatoki (${st.tau1.obraz.bays} / ${st.tau1.zatok})`);
    check(st.poWyrzucie.wKadlubie === 0 && st.poWyrzucie.poza > 0, `po wyrzucie wszystkie poza kadłubem (${JSON.stringify(st.poWyrzucie)})`);
    if (st.obrazPoWyrzucie) check(st.obrazPoWyrzucie.bays === 0, 'po wyrzucie bez lamp zatok');
  }

  result.pipelineStrona = JSON.parse(await ev(`JSON.stringify((window.__harness?.pipes?.list || []).slice(${result.pipesStronaStart}).filter((p) => p.sync && !p.compute && !p.budowa).map((p) => p.nazwa))`));
  result.pipelineWorker = workerLogs.filter((l) => /pipeline sync/.test(l)).slice(workerSyncStart).map((l) => l.replace(/^.*pipeline sync #\d+ k=\d+: /, ''));
  console.log('pipeline sync strona:', result.pipelineStrona.length, result.pipelineStrona.slice(0, 8), 'worker:', result.pipelineWorker.length, result.pipelineWorker.slice(0, 8));
  check(result.pipelineStrona.length === 0, 'pipeline’y synchroniczne strony: 0');
  check(result.pipelineWorker.length === 0, 'pipeline’y synchroniczne workera: 0');
} catch (e) {
  console.error('BŁĄD', e);
  result.fatal = String(e?.stack || e);
} finally {
  clearTimeout(guard);
  result.bledy = logs.errors().slice(0, 40);
  result.bledyWorkera = workerLogs.filter((l) => /\[error\]|\[exception\]/.test(l)).slice(0, 40);
  console.log('błędy konsoli:', result.bledy.length, 'workera:', result.bledyWorkera.length);
  for (const e of [...result.bledy, ...result.bledyWorkera].slice(0, 10)) console.log('  ', String(e).slice(0, 300));
  console.log('asercje nieudane:', result.bledyAsercji.length, result.bledyAsercji);
  writeJson(join(out, 'wyniki.json'), result);
  await chrome.close();
  await server.close();
}
