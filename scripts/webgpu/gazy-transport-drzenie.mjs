// Drżenie gazu przy locie w demie dema/gazy-transport-webgpu.html (zgłoszenie 2026-10-13: „przy poruszaniu się statkiem
// gazy ciągle drżą”). Klatki kroczone DETERMINISTYCZNIE (rAF przechwycony, znacznik czasu rośnie o 1000 / hz ms na klatkę —
// jak monitor o tej częstotliwości), statek leci autopilotem konsoli (__demo.move). Na każdą klatkę: czy okno symulacji
// przesunęło się o komórkę (S.simOx / simOy), czy był krok symulacji (S.simSteps), średnia różnica obrazu z poprzednią
// klatką (kanwa WebGPU zmniejszona do 200 × 112 na OffscreenCanvas). Klatka „przesunięcie bez kroku” = tekstury obrazu
// (simTex, restTex) ze starym początkiem czytane z nowym → gaz skacze o komórkę (64 j.). Zrzuty PNG: klatka przed
// pierwszym skokiem, skok, klatka po.
//
//   node scripts/webgpu/gazy-transport-drzenie.mjs [--hz 144] [--klatki 400] [--scena belt|ring|fog] [--out .tmp/gazy-transport/drzenie]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs, startStaticServer, startChrome, attachLogs, waitFor, evaluate, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs();
const HZ = Number(args.hz || 144);
const FRAMES = Number(args.klatki || 400);
const SCENA = args.scena || 'belt';
const out = resolve(repo, args.out || `.tmp/gazy-transport/drzenie-${SCENA}-${HZ}hz`);
mkdirSync(out, { recursive: true });

const { server, base } = await startStaticServer(Number(args.port || 5339), repo);
const chrome = await startChrome({ width: 1600, height: 900 });
const logs = await attachLogs(chrome);
const { cdp } = chrome;
const ev = (e, t = 120000) => evaluate(cdp, e, t);

try {
  await cdp.send('Page.navigate', { url: `${base}/dema/gazy-transport-webgpu.html?scena=${SCENA}` });
  if (!await waitFor(cdp, 'window.__demo && window.__demo.S.simSteps > 60 && window.__demo.S.simWarm <= 0', 120000)) throw new Error('demo nie wystartowało');
  await sleep(500);

  await ev(`(() => {
    const D = window.__demo, S = D.S;
    const cv = document.querySelector('canvas');
    const W = 200, H = 112;
    const off = new OffscreenCanvas(W, H), cx = off.getContext('2d', { willReadFrequently: true });
    let prev = null;
    const G = window.__drz = { t: performance.now(), cb: null, frames: 0 };
    window.requestAnimationFrame = (cb) => { G.cb = cb; return 1; };
    window.__stepFrame = (dtMs) => {
      const cb = G.cb; if (!cb) return null; G.cb = null;
      const ox = S.simOx, oy = S.simOy, st = S.simSteps;
      G.t += dtMs; cb(G.t); G.frames++;
      const shift = (S.simOx !== ox || S.simOy !== oy) ? 1 : 0;
      const step = S.simSteps !== st ? 1 : 0;
      let d = -1;
      cx.drawImage(cv, 0, 0, W, H);
      const img = cx.getImageData(0, 0, W, H).data;
      if (prev) { let s = 0; for (let i = 0; i < img.length; i += 4) s += Math.abs(img[i] - prev[i]) + Math.abs(img[i + 1] - prev[i + 1]) + Math.abs(img[i + 2] - prev[i + 2]); d = s / (W * H * 3); }
      prev = img;
      return { f: G.frames, d: +d.toFixed(3), shift, step, x: Math.round(D.ship.x), y: Math.round(D.ship.y), v: Math.round(Math.hypot(D.ship.vx, D.ship.vy)) };
    };
    D.move(1, 0);
    return 'ok';
  })()`);
  await sleep(300);
  if (!await waitFor(cdp, 'window.__drz.cb !== null', 10000, 50)) throw new Error('brak przechwyconego rAF');

  const rows = [];
  let lastShot = null, glitches = 0, writeNext = null;
  for (let i = 0; i < FRAMES; i++) {
    const r = await ev(`window.__stepFrame(${1000 / HZ})`);
    if (!r) throw new Error(`klatka ${i}: brak rAF`);
    rows.push(r);
    const stale = r.shift === 1 && r.step === 0;
    const wantShot = glitches < 2 && (r.v > 1200);
    if (wantShot || writeNext) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const buf = Buffer.from(data, 'base64');
      if (writeNext) { writeFileSync(join(out, `${writeNext}-${r.f}-po.png`), buf); writeNext = null; }
      if (stale && glitches < 2) {
        glitches++;
        const tag = `skok${glitches}`;
        if (lastShot) writeFileSync(join(out, `${tag}-${r.f - 1}-przed.png`), lastShot);
        writeFileSync(join(out, `${tag}-${r.f}-skok.png`), buf);
        writeNext = tag;
      }
      lastShot = buf;
    }
  }

  const moving = rows.filter((r) => r.v > 1200);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[s.length >> 1].toFixed(3); };
  const ds = (f) => moving.filter(f).map((r) => r.d);
  const report = {
    hz: HZ, klatki: rows.length, scena: SCENA, klatekWLocie: moving.length,
    przesuniecOkna: moving.filter((r) => r.shift).length,
    przesuniecBezKroku: moving.filter((r) => r.shift && !r.step).length,
    klatekBezKroku: moving.filter((r) => !r.step).length,
    roznicaObrazu: {
      medianaZwykle: med(ds((r) => !r.shift)),
      medianaPrzesuniecieZKrokiem: med(ds((r) => r.shift && r.step)),
      medianaPrzesuniecieBezKroku: med(ds((r) => r.shift && !r.step)),
      max: Math.max(...ds(() => true)),
      top: [...moving].sort((a, b) => b.d - a.d).slice(0, 12)
    },
    bledy: logs.errors ? logs.errors() : undefined
  };
  writeJson(join(out, 'raport.json'), { ...report, klatkiLot: moving });
  console.log(JSON.stringify(report, null, 2));
  console.log(`zrzuty i raport: ${out}`);
} finally {
  await chrome.close();
  await server.close();
}
