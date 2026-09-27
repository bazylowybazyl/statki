// Środowisko portu WebGPU: wersje (Node, Chrome, system), adapter WebGPU w headless
// Chrome z flagami narzędzi CDP (dema/rdzen-cdp.js), cechy i limity, urządzenie
// z próbnym submit + znacznikami czasu, a dla porównania renderer WebGL.
//
//   node scripts/webgpu/srodowisko.mjs [--out plik.json] [--port 5310]
//
// Wynik: JSON na stdout (i do --out). Brak adaptera = kod wyjścia 2.
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { release, cpus, totalmem } from 'node:os';
import { startVite, startChrome, navigateAndWait, evaluate, repo } from '../../dema/rdzen-cdp.js';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const outFile = arg('out');
const port = Number(arg('port', 5310));

function chromeVersion() {
  // Wersja pliku chrome.exe (PowerShell) — headless nie zawsze podaje ją w UA.
  try {
    return execFileSync('powershell', ['-NoProfile', '-Command',
      "(Get-Item 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe').VersionInfo.ProductVersion"],
    { encoding: 'utf8' }).trim();
  } catch { return null; }
}

function gpuDrivers() {
  try {
    const raw = execFileSync('powershell', ['-NoProfile', '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, DriverDate | ConvertTo-Json -Compress'],
    { encoding: 'utf8' }).trim();
    const list = JSON.parse(raw);
    return (Array.isArray(list) ? list : [list]).map((g) => ({ name: g.Name, driver: g.DriverVersion, date: g.DriverDate }));
  } catch { return null; }
}

// Sonda w stronie (kontekst bezpieczny: localhost z Vite).
const PROBE = `(async () => {
  const out = { ua: navigator.userAgent, secure: isSecureContext, webgpu: !!navigator.gpu };
  const readLimits = (l) => { const o = {}; for (const k in l) { const v = l[k]; if (typeof v === 'number') o[k] = v; } return o; };
  if (navigator.gpu) {
    out.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat();
    out.wgslLanguageFeatures = navigator.gpu.wgslLanguageFeatures ? [...navigator.gpu.wgslLanguageFeatures].sort() : null;
    out.adapters = {};
    for (const pref of ['high-performance', 'low-power']) {
      const a = await navigator.gpu.requestAdapter({ powerPreference: pref });
      if (!a) { out.adapters[pref] = null; continue; }
      const info = a.info || {};
      out.adapters[pref] = {
        vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description,
        isFallbackAdapter: !!(info.isFallbackAdapter ?? a.isFallbackAdapter),
        features: [...a.features].sort(), limits: readLimits(a.limits)
      };
    }
    // Urządzenie jak w grze: high-performance, znaczniki czasu, jeden pusty submit
    // z zapytaniem o czas (urządzenie SwiftShadera ginęło po pierwszym submit).
    const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (a) {
      const ts = a.features.has('timestamp-query');
      const dev = await a.requestDevice({ requiredFeatures: ts ? ['timestamp-query'] : [] });
      let lost = null;
      dev.lost.then((i) => { lost = i.reason + ': ' + i.message; });
      const errors = [];
      dev.pushErrorScope('validation');
      const enc = dev.createCommandEncoder();
      let gpuNs = null;
      if (ts) {
        const qs = dev.createQuerySet({ type: 'timestamp', count: 2 });
        const resolveBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        const readBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const tex = dev.createTexture({ size: [256, 256], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT });
        const pass = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }],
          timestampWrites: { querySet: qs, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
        pass.end();
        enc.resolveQuerySet(qs, 0, 2, resolveBuf, 0);
        enc.copyBufferToBuffer(resolveBuf, 0, readBuf, 0, 16);
        dev.queue.submit([enc.finish()]);
        await readBuf.mapAsync(GPUMapMode.READ);
        const t = new BigUint64Array(readBuf.getMappedRange().slice(0));
        gpuNs = Number(t[1] - t[0]);
        readBuf.unmap();
      } else {
        dev.queue.submit([enc.finish()]);
      }
      await dev.queue.onSubmittedWorkDone();
      const err = await dev.popErrorScope();
      if (err) errors.push(err.message);
      out.device = { timestampQuery: ts, emptyPassNs: gpuNs, lost, errors, limits: readLimits(dev.limits) };
      dev.destroy();
    }
  }
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  if (gl) {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    out.webgl2 = {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION),
      timerQuery: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      floatBlend: !!gl.getExtension('EXT_float_blend'),
      colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float')
    };
  }
  return out;
})()`;

const result = {
  when: new Date().toISOString(),
  node: process.version,
  os: `${process.platform} ${release()}`,
  cpu: cpus()[0]?.model?.trim(),
  ramGB: +(totalmem() / 2 ** 30).toFixed(1),
  chrome: chromeVersion(),
  gpus: gpuDrivers(),
  three: JSON.parse(execFileSync('node', ['-p', "JSON.stringify(require('./node_modules/three/package.json').version)"], { cwd: repo, encoding: 'utf8' }))
};

const { server, base } = await startVite(port);
const chrome = await startChrome({ width: 800, height: 600 });
let code = 0;
try {
  const ok = await navigateAndWait(chrome.cdp, `${base}/docs/webgpu/USTALENIA.md`, 'document.readyState === "complete"', 60000);
  if (!ok) throw new Error('strona sondy się nie załadowała');
  result.page = await evaluate(chrome.cdp, PROBE, 60000);
  if (!result.page.webgpu || !result.page.adapters?.['high-performance']) code = 2;
} catch (err) {
  result.error = String(err?.message || err);
  code = 1;
} finally {
  await chrome.close();
  await server.close();
}
result.consoleErrors = chrome.logs.filter((l) => /^\[(error|exception)\]/.test(l));
const json = JSON.stringify(result, null, 2);
if (outFile) {
  const p = resolve(repo, outFile);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, json + '\n');
}
console.log(json);
process.exit(code);
