// Dodatek dema planet (dema/planety-webgpu.html?korek=1 / ?slup=1): elektrownia geotermalna „KOREK” w wielkim gryzie
// Ziemi (src/3d/earthBitePlant*.js — korek na dnie, promień energii do odbiornika pod ringiem, windy kosmiczne) i słup
// dymu (src/3d/earthBitePlume*.js), doklejone do Ziemi dema przez window.__planety — bez zmian w dema/planety-webgpu.js.
// Siatki są dziećmi siatki kuli (obracają się z gruntem) i dzielą z nią uniformy słońca, gryzu i mgiełki.
//   ?korek=1 — elektrownia, ?slup=1 — dym, ?slupWariant=parasol|smukly (PLUME_PRESETS), ?slupZegar=0 — zegar stoi
//   (zrzuty), ?slupPioruny=0 — bez piorunów.
//   Klawisze: K — elektrownia wł. / wył., L — dym wł. / wył. Konsola / harness: window.__slup (look, plantLook, apply(),
//   setTime(t), burst(ziarno, n), freeze(b)).
import { EarthBitePlume } from '../src/3d/earthBitePlume3D.js';
import { EarthBitePlant, createPlantLook } from '../src/3d/earthBitePlant.js';
import { createPlumeLook } from '../src/3d/earthBitePlumeShape.js';
import { fxRandom } from '../src/3d/fx/fxRandom.js';

const params = new URLSearchParams(location.search);
const on = (k) => params.get(k) !== null && params.get(k) !== '0';
if (on('slup') || on('korek')) start();

async function start() {
  while (!(window.__planety && window.__planety.ready && window.__planety.ready())) await new Promise((r) => setTimeout(r, 120));
  const P = window.__planety;
  const look = createPlumeLook({}, params.get('slupWariant') || 'parasol');
  if (params.get('slupPioruny') === '0') look.flashRate = 0;
  const plantLook = createPlantLook();
  const S = { on: on('slup'), plantOn: on('korek'), frozen: params.get('slupZegar') === '0' };
  let plume = null;
  let plant = null;
  let last = performance.now();

  function attach() {
    const body = P.S.current;
    if (!body || body.id !== 'earth' || !body.pit) return null;
    if (!plume) plume = new EarthBitePlume(body.uniforms, { look });
    if (plume.mesh.parent !== body.mesh) body.mesh.add(plume.mesh);
    if (!plant) plant = new EarthBitePlant(body.uniforms, { look: plantLook });
    if (plant.group.parent !== body.mesh) body.mesh.add(plant.group);
    return body;
  }

  function tick(now) {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const body = attach();
    if (plume) {
      plume.mesh.visible = !!body && S.on && P.S.pitOn !== false;
      plant.group.visible = !!body && S.plantOn && P.S.pitOn !== false;
      plume.update(S.frozen ? 0 : dt);
      plant.update(S.frozen ? 0 : dt);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyL' && !e.repeat) S.on = !S.on;
    if (e.code === 'KeyK' && !e.repeat) S.plantOn = !S.plantOn;
  });

  window.__slup = {
    look,
    plantLook,
    get plume() { return plume; },
    get plant() { return plant; },
    ready: () => !!plume,
    /** Po zmianie pól `look`. */
    apply() { plume?.applyLook(); plant?.applyLook(); },
    setTime(t) {
      if (plume) { plume.time = Number(t) || 0; plume.lightning.time = plume.time; plume.update(0); }
      if (plant) { plant.time = Number(t) || 0; plant.update(0); }
    },
    freeze(v = true) { S.frozen = !!v; },
    toggle(v) { S.on = v === undefined ? !S.on : !!v; },
    togglePlant(v) { S.plantOn = v === undefined ? !S.plantOn : !!v; },
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
