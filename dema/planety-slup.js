// Dodatek dema planet (dema/planety-webgpu.html?slup=1): słup konwekcyjny nad wielkim gryzem Ziemi
// (src/3d/earthBitePlume*.js) doklejony do Ziemi dema przez window.__planety — bez zmian w dema/planety-webgpu.js.
// Słup jest dzieckiem siatki kuli (obraca się z gruntem) i dzieli z nią uniformy słońca, gryzu i mgiełki.
//   ?slup=1 — słup, ?slupWariant=parasol|smukly (PLUME_PRESETS), ?slupZegar=0 — zegar stoi (zrzuty), ?slupPioruny=0 — bez
//   piorunów.
//   Klawisz L — słup wł. / wył. Konsola / harness: window.__slup (look, apply(), setTime(t), burst(ziarno, n), freeze(b)).
import { EarthBitePlume } from '../src/3d/earthBitePlume3D.js';
import { createPlumeLook } from '../src/3d/earthBitePlumeShape.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';

const params = new URLSearchParams(location.search);
const wanted = params.get('slup');
if (wanted !== null && wanted !== '0') start();

async function start() {
  while (!(window.__planety && window.__planety.ready && window.__planety.ready())) await new Promise((r) => setTimeout(r, 120));
  const P = window.__planety;
  const look = createPlumeLook({}, params.get('slupWariant') || 'parasol');
  if (params.get('slupPioruny') === '0') look.flashRate = 0;
  const S = { on: true, frozen: params.get('slupZegar') === '0' };
  let plume = null;
  let last = performance.now();

  function attach() {
    const body = P.S.current;
    if (!body || body.id !== 'earth' || !body.pit) return null;
    if (!plume) plume = new EarthBitePlume(body.uniforms, { look });
    if (plume.mesh.parent !== body.mesh) body.mesh.add(plume.mesh);
    return body;
  }

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const body = attach();
    if (plume) {
      plume.mesh.visible = !!body && S.on && P.S.pitOn !== false;
      if (!S.frozen) plume.update(dt);
      else plume.update(0);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat) S.on = !S.on;
  });

  window.__slup = {
    look,
    get plume() { return plume; },
    ready: () => !!plume,
    /** Po zmianie pól `look`. */
    apply() { plume?.applyLook(); },
    setTime(t) { if (plume) { plume.time = Number(t) || 0; plume.lightning.time = plume.time; plume.update(0); } },
    freeze(v = true) { S.frozen = !!v; },
    toggle(v) { S.on = v === undefined ? !S.on : !!v; },
    /** n błysków naraz w szczycie (ziarno fxRandom — powtarzalne zrzuty). */
    burst(seed = 1, n = 3) {
      if (!plume) return 0;
      fxRandom.seed(seed);
      for (const s of plume.lightning.slots) s.live = false;
      for (let i = 0; i < n; i++) plume.lightning.spawn(look, plume.frame, plume.lightning.time);
      plume.update(0);
      return n;
    }
  };
}
