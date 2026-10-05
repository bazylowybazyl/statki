// Feel broni w demie destruktor3d.html (F0 planu docs/PLAN-zniszczenia-swiata-3d.md): każda broń w trybie
// FIZYCZNYM (pęd / ciśnienie / ciepło przez solver) i STARYM (krater, teleport węzłów, kasowanie pasa),
// cel: stacja swobodna, stacja zakotwiczona, przęsło ściany K-7. Vite + headless Chrome (CDP, pomocniki
// z dema rdzenia — własny Vite bez HMR, odporny na równoległe sesje).
//   node scripts/destruktor3d-bronie.mjs [--bronie lance,cannon,rocket,beam] [--cele station,wall,anchored,drydock]
//        [--tryby fiz,stare] [--out katalog]
// Dla każdej próby: klatki w chwilach liczonych od PIERWSZEGO trafienia (kadr z boku), a w raport.json —
// przebieg: zerwane belki, węzły celu, odłamy, Δv / Δω celu, prędkość pręta. Arkusze PNG: jedna próba = wiersz.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startVite, startChrome, navigateAndWait, evaluate, sleep } from '../dema/rdzen-cdp.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
// ram — taran (T): statek w cel z prędkością suwaka dema (bez broni; tryb trafień bez znaczenia).
const WEAPONS = { cannon: 0, rocket: 1, beam: 2, lance: 3, ram: -1 };
const weapons = arg('bronie', 'lance,cannon,rocket,beam').split(',').filter((w) => w in WEAPONS);
const targets = arg('cele', 'station,wall').split(',');
const modes = arg('tryby', 'fiz,stare').split(',');
const outDir = arg('out', join(tmpdir(), 'destruktor3d-bronie'));
// Taran: rozmiar statku w % stacji (suwak dema; 12 = myśliwiec, ~60 = proporcje Atlasa do ściany K-7)
// i prędkość zderzenia (suwak „Prędkość zderzenia”, 10–400).
const shipPct = Number(arg('statek', 0));
const ramSpeed = Number(arg('v', 0));
mkdirSync(outDir, { recursive: true });

// Chwile klatek od pierwszego trafienia [s] i kadry kamery na cel.
const FRAMES = [0, 0.05, 0.15, 0.35, 0.8, 1.6];
const VIEWS = {
  station: { eye: [34, 14, 36], target: [12, -1, 0] },
  anchored: { eye: [34, 14, 36], target: [12, -1, 0] },
  wall: { eye: [44, 12, 34], target: [0, 0, 0] },
  // moduł suchego doku piratów (2 stanowiska, 170 j.): z ukosa od strony basenów
  drydock: { eye: [150, 85, 120], target: [10, -5, 0] }
};
// Jak długo trzymać spust: działo — seria, wiązka — ciągła, pręt i rakieta — jeden strzał.
const HOLD = { cannon: 0.6, beam: 1.6, lance: 0, rocket: 0, ram: 0 };

const { server, base } = await startVite(5293);
const chrome = await startChrome({ width: 960, height: 540, webgpu: false });
const { cdp, logs } = chrome;
const ev = (expr) => evaluate(cdp, expr);
const shotData = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const errors = () => logs.filter((l) => /^\[(error|exception)\]/.test(l));
const report = [];

try {
  const ready = await navigateAndWait(cdp, `${base}/destruktor3d.html`,
    '!!(window.__demo && window.__demo.station && window.__demo.structure && window.__demo.structure.stats.nodes > 600)', 120000);
  if (!ready) throw new Error('demo się nie wczytało');
  await sleep(1500);
  if (shipPct > 0 || ramSpeed > 0) {
    await ev(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = String(v); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); };
      if (${shipPct} > 0) set('sl-ship-size', ${shipPct});
      if (${ramSpeed} > 0) set('sl-speed', ${ramSpeed});
      return true;
    })()`);
    await sleep(1500);
  }
  const rows = [];
  for (const target of targets) {
    for (const weapon of weapons) {
      for (const mode of modes) {
        const run = await scenario(target, weapon, mode === 'stare');
        report.push(run.summary);
        rows.push(run);
        console.log(`${target.padEnd(8)} ${weapon.padEnd(6)} ${mode.padEnd(5)}`, JSON.stringify(run.summary.final));
      }
    }
  }
  await contactSheets(rows);
  writeFileSync(join(outDir, 'raport.json'), JSON.stringify(report, null, 1));
  console.log('błędy konsoli', JSON.stringify(errors().slice(0, 12)));
  console.log('wyniki', outDir);
} catch (e) {
  console.log('BŁĄD', e.message, JSON.stringify(errors().slice(0, 10)));
} finally {
  await chrome.close();
  await server.close();
  process.exit(0);
}

async function scenario(target, weapon, legacy) {
  const view = VIEWS[target] || VIEWS.station;
  await ev(`(() => {
    const d = window.__demo;
    d.setPaused(true);
    d.setTarget(${JSON.stringify(target)});
    d.setPaused(true);
    d.setLegacy(${legacy});
    if (${WEAPONS[weapon]} >= 0) d.selectWeapon(${WEAPONS[weapon]});
    else { d.launch(); d.setPaused(true); }
    d.view(${JSON.stringify(view.eye)}, ${JSON.stringify(view.target)});
    const t = d.station;
    window.__probe = { v0: { ...t.vel }, w0: { ...t.angVel }, nodes0: t.activeNodes,
      broken0: d.DestructorBeams3D.perf.beamsBroken, firstHit: -1, time: 0 };
    return true;
  })()`);
  // Strzał i lot do pierwszego trafienia (≤ 2 s), spust trzymany wg broni.
  const hold = HOLD[weapon];
  const fired = await ev(`(() => {
    const d = window.__demo, w = d.weapons;
    if (${hold} === 0 && ${WEAPONS[weapon]} >= 0) w.fire(${WEAPONS[weapon]}, d.ram, d.bodies);
    return true;
  })()`);
  const flight = await ev(`(() => {
    const d = window.__demo, w = d.weapons, p = window.__probe;
    // Taran: „trafienie” = pierwszy kontakt (zerwana belka albo kontakt węzłów).
    const hits = ${WEAPONS[weapon]} >= 0 ? () => w.stats.hits.reduce((a, b) => a + b, 0)
      : () => d.DestructorBeams3D.perf.contacts + (d.DestructorBeams3D.perf.beamsBroken - p.broken0);
    for (let k = 0; k < 480 && hits() === 0; k++) {
      d.step(1 / 120, 1, ${hold > 0}, false);
      p.time += 1 / 120;
    }
    p.firstHit = hits() > 0 ? p.time : -1;
    p.holdLeft = ${hold};
    return { firstHit: p.firstHit, fired: ${fired} };
  })()`);
  const frames = [];
  let tNow = 0;
  for (const at of FRAMES) {
    const state = await ev(`(() => {
      const d = window.__demo, w = d.weapons, p = window.__probe, t = d.station;
      const steps = Math.round((${at} - ${tNow}) * 120);
      for (let k = 0; k < steps; k++) {
        const holding = p.holdLeft > 0;
        d.step(1 / 120, 1, holding, false);
        p.holdLeft -= 1 / 120;
      }
      d.render();
      const rod = w.rods[0]?.body;
      const wrecks = d.bodies.filter(b => b.isWreck && !b.dead && !b.isProjectile);
      return {
        t: ${at},
        zerwane: d.DestructorBeams3D.perf.beamsBroken - p.broken0,
        wezlyCelu: t.dead ? 0 : t.activeNodes,
        stracone: p.nodes0 - (t.dead ? 0 : t.activeNodes),
        odlamy: wrecks.length,
        wezlyOdlamow: wrecks.reduce((s, b) => s + b.activeNodes, 0),
        dv: +Math.hypot(t.vel.x - p.v0.x, t.vel.y - p.v0.y, t.vel.z - p.v0.z).toFixed(2),
        dw: +Math.hypot(t.angVel.x - p.w0.x, t.angVel.y - p.w0.y, t.angVel.z - p.w0.z).toFixed(3),
        pret: rod ? { v: +Math.hypot(rod.vel.x, rod.vel.y, rod.vel.z).toFixed(1), wbity: !!w.rods[0].host, wezly: rod.activeNodes } : null,
        stopione: w.stats.ablated,
        ped: Math.round(w.stats.impulse)
      };
    })()`);
    await sleep(60);
    frames.push({ state, png: await shotData() });
    tNow = at;
  }
  const name = `${target}-${weapon}-${legacy ? 'stare' : 'fiz'}`;
  frames.forEach((f, i) => writeFileSync(join(outDir, `${name}-${i}.png`), Buffer.from(f.png, 'base64')));
  return {
    name, target, weapon, legacy, frames,
    summary: { name, pierwszeTrafienie: flight.firstHit, przebieg: frames.map((f) => f.state), final: frames[frames.length - 1].state }
  };
}

// Arkusz na cel: wiersz = broń × tryb, kolumny = chwile od trafienia; podpis z liczbami.
async function contactSheets(rows) {
  const byTarget = new Map();
  for (const r of rows) {
    if (!byTarget.has(r.target)) byTarget.set(r.target, []);
    byTarget.get(r.target).push(r);
  }
  for (const [target, list] of byTarget) {
    const cell = (f) => `<td><img src="data:image/png;base64,${f.png}"><div>t=${f.state.t}s · zerwane ${f.state.zerwane}` +
      ` · odłamy ${f.state.odlamy} · Δv ${f.state.dv} · Δω ${f.state.dw}${f.state.pret ? ` · pręt ${f.state.pret.v}${f.state.pret.wbity ? ' (wbity)' : ''}` : ''}</div></td>`;
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#05060c;color:#cfe4ff;font:12px Consolas,monospace}
      table{border-collapse:collapse} td{padding:3px;vertical-align:top} img{width:320px;height:180px;display:block}
      th{color:#ffd479;text-align:left;padding:4px 6px;white-space:nowrap} div{width:320px}
    </style><table>${list.map((r) => `<tr><th>${r.weapon}<br>${r.legacy ? 'STARE' : 'FIZYCZNE'}</th>${r.frames.map(cell).join('')}</tr>`).join('')}</table>`;
    const W = 120 + FRAMES.length * 326, H = list.length * 222 + 8;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(300);
    await ev(`(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); return true; })()`);
    await sleep(700);
    writeFileSync(join(outDir, `arkusz-${target}.png`), Buffer.from(await shotData(), 'base64'));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 960, height: 540, deviceScaleFactor: 1, mobile: false });
    await navigateAndWait(cdp, `${base}/destruktor3d.html`,
      '!!(window.__demo && window.__demo.station && window.__demo.structure && window.__demo.structure.stats.nodes > 600)', 120000);
    await sleep(800);
  }
}
