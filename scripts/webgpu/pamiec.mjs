// Pamięć GPU i liczniki three po starcie i po cyklach bitwa → sprzątanie (port WebGPU, zadanie 23, krok 5).
// Hak na GPUDevice.createBuffer / createTexture (przed skryptami strony): żywe bufory i tekstury z rozmiarem
// (tekstura: piksele wszystkich mipów × bajty formatu × próbki; destroy odejmuje) + renderer.info.memory
// (geometrie, tekstury) + sterta JS. Cykl: bitwa 2 × `--bok` okrętów w czasie rzeczywistym (`--sekundy`),
// zniszczenie wszystkich NPC, odlot gracza o 120 tys. j. (wraki dalej niż próg despawnu gry wracają do puli
// — droga gry), powrót. Liczniki po cyklach mają wracać (bez przyrostu z cyklu na cykl).
//
//   node scripts/webgpu/pamiec.mjs [--cykle 3] [--bok 20] [--sekundy 8] [--out .tmp/webgpu/zadania/23/pamiec.json]
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, sleep, repo, osobneLosowanieUuid } from './wspolne.mjs';

const args = parseArgs();
const CYKLE = Math.max(1, Number(args.cykle || 3));
const BOK = Math.max(2, Number(args.bok || 20));
const SEK = Math.max(2, Number(args.sekundy || 8));
const port = Number(args.port || 5365);
const out = resolve(repo, args.out || '.tmp/webgpu/zadania/23/pamiec.json');
mkdirSync(dirname(out), { recursive: true });
const INJECT = readFileSync(join(repo, 'scripts/webgpu/harness-strona.js'), 'utf8');
const DEEP = { x: 6210000, y: 5330000 };

const HAK_GPU = `(() => {
  if (!('GPUDevice' in window) || window.__gpuPamiec) return;
  const live = window.__gpuPamiec = { bufory: new Map(), tekstury: new Map(), sumaB: 0, sumaT: 0 };
  const P = GPUDevice.prototype;
  const cb = P.createBuffer;
  const ct = P.createTexture;
  const bpp = { rgba8unorm: 4, 'rgba8unorm-srgb': 4, bgra8unorm: 4, 'bgra8unorm-srgb': 4, rgba16float: 8, rgba32float: 16, r32float: 4,
    rg32float: 8, rg16float: 4, r16float: 2, r8unorm: 1, rg8unorm: 2, depth24plus: 4, 'depth24plus-stencil8': 4, depth32float: 4,
    depth16unorm: 2, r32uint: 4, rg32uint: 8, rgba32uint: 16, rgba16uint: 8, rgba8uint: 4, rgba8snorm: 4, rgb10a2unorm: 4, rg11b10ufloat: 4,
    'bc1-rgba-unorm': 0.5, 'bc1-rgba-unorm-srgb': 0.5, 'bc3-rgba-unorm': 1, 'bc3-rgba-unorm-srgb': 1, 'bc7-rgba-unorm': 1,
    'bc7-rgba-unorm-srgb': 1, 'bc4-r-unorm': 0.5, 'bc5-rg-unorm': 1 };
  P.createBuffer = function (d) {
    const b = cb.call(this, d);
    const size = Number(d.size) || 0;
    live.sumaB += size; live.bufory.set(b, { size, label: d.label || '' });
    const destroy = b.destroy.bind(b);
    b.destroy = () => { const e = live.bufory.get(b); if (e) { live.sumaB -= e.size; live.bufory.delete(b); } return destroy(); };
    return b;
  };
  P.createTexture = function (d) {
    const t = ct.call(this, d);
    const s = d.size;
    const w = s.width ?? s[0];
    const h = s.height ?? s[1] ?? 1;
    const l = s.depthOrArrayLayers ?? s[2] ?? 1;
    const mips = d.mipLevelCount || 1;
    let px = 0;
    for (let m = 0; m < mips; m++) px += Math.max(1, w >> m) * Math.max(1, h >> m) * (d.dimension === '3d' ? Math.max(1, l >> m) : l);
    const bytes = px * (bpp[d.format] ?? 4) * (d.sampleCount || 1);
    live.sumaT += bytes; live.tekstury.set(t, { bytes, w, h, l, format: d.format, mips, probki: d.sampleCount || 1, label: d.label || '' });
    const destroy = t.destroy.bind(t);
    t.destroy = () => { const e = live.tekstury.get(t); if (e) { live.sumaT -= e.bytes; live.tekstury.delete(t); } return destroy(); };
    return t;
  };
})();`;

const POMIAR = `(() => {
  const L = window.__gpuPamiec; const R = window.Core3D?.renderer; const MB = (b) => +(b / 1048576).toFixed(1);
  const tex = [...(L?.tekstury.values() || [])];
  const duze = tex.filter((t) => t.w >= 4096 || t.h >= 4096).sort((a, b) => b.bytes - a.bytes)
    .map((t) => ({ rozmiar: t.w + 'x' + t.h + (t.l > 1 ? 'x' + t.l : ''), format: t.format, mipy: t.mips, MB: MB(t.bytes), etykieta: t.label.slice(0, 60) }));
  const najwieksze = tex.sort((a, b) => b.bytes - a.bytes).slice(0, 12)
    .map((t) => ({ rozmiar: t.w + 'x' + t.h + (t.l > 1 ? 'x' + t.l : ''), format: t.format, MB: MB(t.bytes), etykieta: t.label.slice(0, 60) }));
  return { buforyMB: MB(L?.sumaB || 0), buforow: L?.bufory.size || 0, teksturyMB: MB(L?.sumaT || 0), tekstur: L?.tekstury.size || 0,
    three: { ...(R?.info?.memory || {}) }, stertaJsMB: performance.memory ? MB(performance.memory.usedJSHeapSize) : null,
    npc: (window.npcs || []).filter((n) => !n.dead).length, wraki: (window.wrecks || []).length, zimne: (window.coldWrecks || []).length,
    duze, najwieksze };
})()`;

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 1920, height: 1080 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 300000) => evaluate(cdp, e, t);
const wynik = { when: new Date().toISOString(), cykle: CYKLE, bok: BOK, sekundy: SEK, pomiary: [] };
const zapisz = (etap, m) => {
  wynik.pomiary.push({ etap, ...m });
  console.log(`${etap.padEnd(22)} bufory ${String(m.buforyMB).padStart(7)} MB (${m.buforow}) | tekstury ${String(m.teksturyMB).padStart(7)} MB (${m.tekstur}) | three: geometrie ${m.three.geometries}, tekstury ${m.three.textures} | sterta JS ${m.stertaJsMB} MB | npc ${m.npc}, wraki ${m.wraki}, zimne ${m.zimne}`);
};
try {
  await osobneLosowanieUuid(cdp);
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `${HAK_GPU}\nwindow.__HARNESS_SEED__ = ${0x5eed1234};\n${INJECT}` });
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  if (!await waitFor(cdp, '!!(window.Core3D && window.Core3D.isInitialized && window.Core3D.gpuReady !== false && window.ship && window.__harness)', 240000, 400)) throw new Error('gra nie wstała');
  await ev(`(() => { window.__harness.clock.mode = 'real'; return true; })()`);
  await waitFor(cdp, '!!window.__menuBackdrop?.ready', 120000, 250);
  await sleep(1500);
  zapisz('menu', await ev(POMIAR));
  await ev(`(() => { document.getElementById('btn-mode-single')?.click(); return true; })()`);
  if (!await waitFor(cdp, '(window.__frameId || 0) > 30', 300000, 400)) throw new Error('gra nie ruszyła');
  await sleep(4000);
  zapisz('gra po starcie', await ev(POMIAR));
  for (let c = 1; c <= CYKLE; c++) {
    const n = await ev(`(async () => { const S = window.__harness.scene; S.hideHud(true);
      DevScene.teleport(${DEEP.x} + ${c} * 40000, ${DEEP.y}, 0);
      const s = ship; let n = 0; const put = (k, mode, x, y, a) => { const r = spawnCallInShip(k, { mode, spawnPos: { x: s.pos.x + x, y: s.pos.y + y }, spawnAngle: a }); n += Array.isArray(r) ? r.length : (r ? 1 : 0); };
      const side = ${BOK}, nb = Math.max(1, Math.round(side * 0.17)), nd = side - nb;
      for (let i = 0; i < nd; i++) put('destroyer', 'pirate', 6000 + (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, Math.PI);
      for (let i = 0; i < nb; i++) put('pirate_battleship', 'pirate', 9000, -(nb * 1300) + i * 2600, Math.PI);
      for (let i = 0; i < nd; i++) put('destroyer', 'friendly', 800 - (i % 3) * 900, -((nd / 3) * 700) + Math.floor(i / 3) * 1400, 0);
      for (let i = 0; i < nb; i++) put('battleship', 'friendly', -2600, -(nb * 1300) + i * 2600, 0);
      S.cam(s.pos.x + 3500, s.pos.y, 0.12);
      return n; })()`);
    await sleep(SEK * 1000);
    zapisz(`cykl ${c}: bitwa (${n})`, await ev(POMIAR));
    // wszyscy NPC giną (wraki, wybuchy), potem odlot poza próg despawnu wraków i powrót
    await ev(`(() => { for (const npc of (window.npcs || []).slice()) if (!npc.dead) window.applyDamageToNPC(npc, 1e12, 'pamiec'); return true; })()`);
    await sleep(4000);
    await ev(`(() => { DevScene.teleport(ship.pos.x + 120000, ship.pos.y, 0); window.__harness.scene.cam(ship.pos.x, ship.pos.y, 0.3); return true; })()`);
    await sleep(4000);
    zapisz(`cykl ${c}: po sprzątaniu`, await ev(POMIAR));
  }
  wynik.bledy = logs.errors().filter((l) => !/favicon|AudioSys/.test(l)).slice(0, 20);
  const last = wynik.pomiary[wynik.pomiary.length - 1];
  console.log('\nnajwieksze tekstury (koniec):');
  for (const t of last.najwieksze) console.log(`  ${String(t.MB).padStart(7)} MB  ${t.rozmiar} ${t.format} ${t.etykieta}`);
  console.log('tekstury ≥ 4096 px:', last.duze.length);
  for (const t of last.duze) console.log(`  ${String(t.MB).padStart(7)} MB  ${t.rozmiar} ${t.format} mipy ${t.mipy} ${t.etykieta}`);
} finally {
  writeFileSync(out, JSON.stringify(wynik, null, 1));
  await chrome.close();
  await server.close();
}
