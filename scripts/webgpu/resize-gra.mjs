// Resize okna: menu i gra, bloom wł./wył., nieaktywne cele efektów.
// node scripts/webgpu/resize-gra.mjs [--out .tmp/resize] [--tylkoMenu]
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs, startVite, startChrome, attachLogs, waitFor, evaluate, screenshotPng, sleep, repo, writeJson } from './wspolne.mjs';

const args = parseArgs(), out = resolve(repo, args.out || '.tmp/resize');
mkdirSync(out, { recursive: true });
const { server, base } = await startVite(5384);
const chrome = await startChrome({ width: 1600, height: 900 });
const { cdp } = chrome, logs = await attachLogs(chrome);
const ev = (e) => evaluate(cdp, e);
const report = { stages: [] };

async function resizes(name) {
  logs.clear();
  for (let i = 0; i < 24; i++) {
    // W tym samym cyklu przełączamy też pipeline postu — wiązania obu muszą przeżyć resize.
    await ev(`window.Core3D.setPerfToggles({ bloom: ${i % 3 !== 0} })`);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900 + (i % 7) * 101, height: 520 + (i % 5) * 71,
      deviceScaleFactor: i % 4 === 0 ? 1.5 : 1, mobile: false });
    await sleep(100);
    const errors = logs.errors();
    if (errors.length) {
      report.errors = errors;
      report.missing = await ev('window.__resizeMissing');
      throw new Error(JSON.stringify({ stage: name, iteration: i, errors, missing: report.missing }));
    }
  }
  const frameBefore = await ev('window.Core3D.renderer.info.frame');
  await sleep(200);
  const state = await ev(`({ frame: window.Core3D.renderer.info.frame, width: window.Core3D.width, height: window.Core3D.height,
    textures: window.Core3D.renderer.info.memory.textures, missing: window.__resizeMissing })`);
  assert.ok(state.frame > frameBefore, 'render nadal działa');
  assert.equal(state.missing.length, 0);
  report.stages.push({ name, ...state });
  await screenshotPng(cdp, join(out, `${name}.png`));
  console.log(`${name}: 24 zmiany rozmiaru / DPR, render działa, bez brakujących tekstur`);
}

try {
  await cdp.send('Page.navigate', { url: `${base}/index.html?dev=1` });
  assert.ok(await waitFor(cdp, '!!window.__menuBackdrop?.ready', 240000, 500));
  await sleep(1000);
  await ev(`(() => {
    window.__resizeMissing = [];
    const b = window.Core3D.renderer.backend;
    for (const name of ['createBindings', 'updateBindings']) {
      const original = b[name];
      b[name] = function(group, bindings, ...rest) {
        for (const binding of group.bindings) {
          if (binding.isSampledTexture) {
            const t = binding.texture, data = this.get(t);
            if (!data.texture && !data.externalTexture) window.__resizeMissing.push({ name: t.name, uuid: t.uuid,
              target: ['composerTarget', 'sunShadowTarget', 'distortionTarget', 'planetHaloTarget'].find(k => window.Core3D[k]?.texture === t),
              width: t.image?.width, height: t.image?.height, renderTarget: !!t.isRenderTargetTexture });
          }
        }
        return original.call(this, group, bindings, ...rest);
      };
    }
  })()`);
  await resizes('menu');
  if (!args.tylkoMenu) {
    await ev("document.getElementById('btn-new-game')?.click()");
    await sleep(900);
    await ev("document.querySelector('[data-story-campaign=\"0\"]')?.click(); document.getElementById('btn-mode-single')?.click()");
    assert.ok(await waitFor(cdp, "document.getElementById('loading')?.classList.contains('hidden') && !!window.shipDriveState?.calib", 300000, 400));
    await sleep(2500);
    await resizes('gra');
    await ev("window.Core3D.setPerfToggles({ shadowShafts: false, planetPass: false, heatHaze: false })");
    await resizes('bez-efektow');
  }
} finally {
  writeJson(join(out, 'wyniki.json'), report);
  await chrome.close();
  await server.close();
}
