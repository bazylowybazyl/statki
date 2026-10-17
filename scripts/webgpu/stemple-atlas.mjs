// Atlas stempli napisów radaru (src/ui/radar/stampAtlas.js, 2026-10-17): piksele stempli z atlasu = piksele z osobnych
// płócien. Prawdziwy Chrome (raster kanwy jak w grze): te same napisy (odległości, kody śladów, „?”, różne czcionki,
// barwy, alfa, wyrównania) rysowane funkcją stampRadarText na dwóch kanwach — z atlasem i bez — w tych samych
// miejscach (całe piksele, kontekst tożsamościowy — jak znaczniki krawędzi i duchy tarczy radaru), także po
// przepieczeniu (zmiana napisu); porównanie getImageData. Wynik: liczba różnych pikseli (ma być 0) i statystyki
// atlasu; `obrot` — informacyjnie ta sama scena pod obrotem kanwy docelowej (atlas nie jest do tego używany:
// filtr próbkuje tekstury innego rozmiaru, brzegi do ~10/255).
//   node scripts/webgpu/stemple-atlas.mjs [--port 5296]
import { startVite, evaluate } from '../../dema/rdzen-cdp.js';
import { startChrome, parseArgs } from './wspolne.mjs';

const args = parseArgs();
const { server, base } = await startVite(Number(args.port || 5296));
const chrome = await startChrome({ width: 1400, height: 900, webgpu: false });
const { cdp } = chrome;
let wynik = null;
try {
  await cdp.send('Page.navigate', { url: `${base}/dema/radar-taktyczny.html` });
  await new Promise((r) => setTimeout(r, 3000));
  wynik = await evaluate(cdp, `(async () => {
    const R = await import('/src/ui/radar/radarSymbols.js');
    const A = R.RADAR_TEXT_ATLAS;
    const mk = () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; document.body.appendChild(c); return c; };
    const fonts = ['600 11px "Rajdhani", sans-serif', '700 13px monospace', '500 10px sans-serif', '600 15px "Rajdhani", sans-serif'];
    const rgbs = ['255, 90, 90', '120, 220, 255', '255, 200, 90'];
    const texts = (pass) => { const t = []; for (let i = 0; i < 48; i++) t.push(i % 5 === 0 ? 'T' + (10 + i) + ' DD' : i % 7 === 0 ? '?' : ((i * 1.7 + pass * 0.3) % 40).toFixed(1).replace('.', ',') + ' km'); return t; };
    const draw = (ctx, sts, pass, rot) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, 1280, 720);
      if (rot) { ctx.translate(640, 360); ctx.rotate(0.37); ctx.translate(-640, -360); }
      const tx = texts(pass);
      for (let i = 0; i < tx.length; i++) {
        const x = 40 + (i % 8) * 150, y = 40 + Math.floor(i / 8) * 60;
        const align = ['left', 'center', 'right'][i % 3], baseline = ['middle', 'top', 'bottom'][i % 3];
        const alpha = i % 4 === 0 ? 0.55 : 1;
        sts[i] = R.stampRadarText(ctx, sts[i] || null, tx[i], fonts[i % fonts.length], x + 0.4, y + 0.6, rgbs[i % rgbs.length], alpha, align, baseline, i % 2 ? 3 : 2.5);
      }
    };
    const run = (atlas) => {
      A.enabled = atlas;
      const c = mk(), ctx = c.getContext('2d'), sts = [];
      const shots = [];
      for (const [pass, rot] of [[0, false], [1, false], [2, true], [0, false]]) { draw(ctx, sts, pass, rot); shots.push(ctx.getImageData(0, 0, 1280, 720).data); }
      return shots;
    };
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const a = run(true), b = run(false);
    const diffAll = a.map((da, k) => { const db = b[k]; let n = 0, mx = 0; for (let i = 0; i < da.length; i++) { const d = Math.abs(da[i] - db[i]); if (d) { n++; if (d > mx) mx = d; } } return { rozne: n, maks: mx }; });
    const nonzero = a.map((da) => { let n = 0; for (let i = 3; i < da.length; i += 4) if (da[i]) n++; return n; });
    const diff = diffAll.filter((_, k) => k !== 2), obrot = diffAll[2];
    return { diff, obrot, pikseleNapisow: nonzero, atlas: { ...A.atlas.stats }, stemple: { ...A.stats } };
  })()`);
  console.log(JSON.stringify(wynik, null, 1));
} finally {
  await chrome.close();
  await server.close();
}
process.exit(wynik && wynik.diff.every((d) => d.rozne === 0) ? 0 : 1);
