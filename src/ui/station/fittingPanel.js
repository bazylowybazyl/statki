// src/ui/station/fittingPanel.js
//
// Zakładka WYPOSAŻENIE terminala stacji (docs/PLAN-fitowanie.md § 4.8; makieta dema/fitowanie-koncept.html):
//   KONFIGURACJE — cztery karty (automat refitu: profil ognia, mapa gniazd do przezbrojenia, cena braków,
//                  „Z MAGAZYNU” / „KUP” / „ZASTOSUJ”) + kafel REFIT RĘCZNY; pasek zmian pod kartami.
//   REFIT RĘCZNY — sylwetka okrętu z gniazdami (klik, SYMETRIA, grupy, burty), lista pasującej broni z hangarem
//                  i ceną (brakujące sztuki kupowane przy montażu), moduł, system F, chipy, profil i sumy.
// Moduł UI bez stanu gry: wszystko czyta i zmienia przez `api` z index.html (blok „WYPOSAŻENIE”). DOM budowany przy
// zmianie stanu (render), co klatkę tylko liczby (tick).

import { FIT_PROFILE_POINTS, FIT_PROFILE_STEP_KM, weaponDps, weaponRangeWithModule } from '../../game/fitStats.js';

const TYPE_ORDER = ['main', 'special', 'missile', 'aux', 'hangar', 'special_missile', 'builtin'];
const SLOT = {
  main: { label: 'DZIAŁA', color: '#3ea6ff' },
  special: { label: 'BATERIA', color: '#ff4545' },
  missile: { label: 'RAKIETY', color: '#47d18c' },
  aux: { label: 'OBRONA PKT.', color: '#ffaa33' },
  hangar: { label: 'HANGARY', color: '#b18cff' },
  special_missile: { label: 'RAKIETA SPEC.', color: '#ff6ea0' },
  builtin: { label: 'WBUDOWANE', color: '#e8eef5' }
};
const BAND = {
  BLISKI: '#ff6600', LINIA: '#ffaa33', DALEKI: '#3ea6ff', SNAJPER: '#8fd3ff', RAKIETY: '#47d18c', OP: '#c9a66b', 'MYŚL.': '#b18cff', SPEC: '#ff6ea0'
};
const CLOSE_CATS = new Set(['autocannon', 'beam', 'armata']);
const SHORT = {
  railgun_mk1: 'Tempest Mk I', railgun_mk2: 'Tempest Mk II', tempest_ion_l: 'Tempest Ciężki', tempest_ion_s: 'Tempest Lekki',
  armata_mk1: 'Armata Oblężnicza', heavy_autocannon_l: 'HA Oblężniczy', heavy_autocannon: 'Działko ciężkie',
  vulcan_minigun: 'Vulcan', gatling_s: 'Gatling lekki', beam_pulse: 'Wiązka (puls)', beam_continuous: 'Wiązka ciągła',
  helios_laser: 'Helios', helios_laser_s: 'Helios lekki', helios_lance_l: 'Helios Lance',
  lance_rail_m: 'Lanca', lance_rail_l: 'Lanca Ciężka',
  special_yamato_cannon: 'Yamato', special_yamato_l: 'Yamato L', special_plasma_gatling: 'Plasma Gatling',
  special_goliath_autocannon: 'Goliath', special_valkyrie_railgun: 'Valkyrie', special_valkyrie_m: 'Oszczep',
  special_valkyrie_s: 'Kolec', siege_railgun: 'Mjolnir',
  missile_rack: 'Cruise', grad_launcher: 'Grad', hydra_mirv: 'Hydra', roj_pod: 'Rój', fast_missile_rack: 'Rakiety szybkie',
  osa_micro_missile: 'Osa', torpedo_salvo: 'Torpedy salwowe', siege_torpedo: 'Torpeda oblężnicza',
  siege_torpedo_mk2: 'Torpeda oblężnicza II',
  ciws_mk1: 'CIWS Mk I', ciws_mk2: 'CIWS Mk II', laser_pd_mk1: 'Laser PD', flak_s: 'Flak lekki', flak_m: 'Flak średni',
  flak_l: 'Grad Flak', flak_capital: 'Perun',
  fighter_squad_multirole: 'Eskadra wielozadaniowa', fighter_squad_interceptor: 'Eskadra przechwytująca',
  fighter_squad_strike: 'Eskadra szturmowa', fighter_bay: 'Hangar (stary)',
  supernova_missile: 'Supernova', hexlance_siege: 'Hexlance'
};

const fmt = (v) => Math.round(Number(v) || 0).toLocaleString('pl-PL');
const cr = (v) => `${fmt(v)} CR`;
const km = (m) => ((Number(m) || 0) / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function partsWord(n) {
  if (n === 1) return '1 część';
  return `${n} części`;
}
function slotsWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (n === 1) return '1 gniazdo';
  if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return `${n} gniazda`;
  return `${n} gniazd`;
}
function hexA(hex, a) {
  const n = parseInt(String(hex).slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function createFittingPanel(root, api) {
  if (!root || !api) return null;
  const W = api.weapons;
  const nameOf = (id) => SHORT[id] || W[id]?.name || id;
  const bandOf = (id) => {
    const w = W[id];
    if (!w) return 'OP';
    if (w.mountType === 'aux') return 'OP';
    if (w.mountType === 'hangar') return 'MYŚL.';
    if (w.mountType === 'special_missile' || w.category === 'superweapon') return 'SPEC';
    if (w.category === 'rocket' || w.category === 'torpedo') return 'RAKIETY';
    if (w.weaponClass === 'sniper') return 'SNAJPER';
    const r = Number(w.baseRange) || 0;
    if (r <= 4500 && (CLOSE_CATS.has(w.category) || id === 'special_plasma_gatling' || r <= 3600)) return 'BLISKI';
    if (r <= 4500) return 'LINIA';
    return 'DALEKI';
  };

  const state = {
    view: 'cards',
    selCard: -1,
    sel: new Set(),
    symmetry: true,
    hover: null,
    cardPlans: [],
    hullPts: [],
    built: false,
    toastTimer: 0,
    repairSig: ''
  };

  root.classList.add('fit-mode');
  root.innerHTML = `
    <div class="fit-root">
      <div class="fit-status" data-ref="status"></div>
      <div class="fit-view on" data-view="cards">
        <div class="fit-cards" data-ref="cards"></div>
        <div class="fit-diff idle" data-ref="diff"></div>
      </div>
      <div class="fit-view" data-view="manual">
        <div class="fit-manual">
          <div class="fit-m-left">
            <div class="fit-m-tools" data-ref="tools"></div>
            <div class="fit-hull-wrap"><canvas class="fit-hull" data-ref="hull"></canvas><div class="fit-tip" data-ref="tip"></div></div>
            <div class="fit-legend" data-ref="legend"></div>
          </div>
          <div class="fit-m-right">
            <div class="fit-sel-head" data-ref="selHead"></div>
            <div class="fit-wlist" data-ref="wlist"></div>
            <div class="fit-m-sub">MODUŁ</div>
            <div class="fit-opts" data-ref="optModule"></div>
            <div class="fit-m-sub">SYSTEM F</div>
            <div class="fit-opts" data-ref="optSystem"></div>
            <div class="fit-m-sub">CHIPY</div>
            <div class="fit-opts" data-ref="optChips"></div>
          </div>
          <div class="fit-m-bottom">
            <div><canvas class="fit-profile-wide" data-ref="mProfile"></canvas><div class="fit-axis"><span>0</span><span>5</span><span>10</span><span>15 km</span></div></div>
            <div class="fit-sums" data-ref="sums"></div>
            <div class="fit-m-actions">
              <button class="fit-btn" type="button" data-act="save-custom">ZAPISZ JAKO WŁASNĄ</button>
              ${api.dev ? '<button class="fit-btn" type="button" data-act="dev-fill">DEV: WSZYSTKO ×99</button>' : ''}
              <button class="fit-btn primary" type="button" data-act="back">← KONFIGURACJE</button>
            </div>
          </div>
        </div>
      </div>
      <div class="fit-toast" data-ref="toast"></div>
    </div>`;
  const ref = {};
  for (const el of root.querySelectorAll('[data-ref]')) ref[el.dataset.ref] = el;
  const views = {
    cards: root.querySelector('[data-view="cards"]'),
    manual: root.querySelector('[data-view="manual"]')
  };
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  function toast(msg) {
    ref.toast.textContent = msg;
    ref.toast.classList.add('on');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => ref.toast.classList.remove('on'), 2600);
    api.log?.(msg);
  }

  // -----------------------------------------------------------------------------------------------------------
  // Rysowanie: profil ognia, sylwetki
  // -----------------------------------------------------------------------------------------------------------

  function fitCanvas(cv) {
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  let profileMax = 1;
  function computeProfileMax(list) {
    let m = 1;
    for (const s of list) for (let k = 0; k < FIT_PROFILE_POINTS; k++) m = Math.max(m, s.guns[k] + s.miss[k]);
    const nice = [2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000];
    profileMax = nice.find((v) => v >= m * 1.05) || m * 1.1;
  }

  function drawProfile(cv, stats, acc, ref0) {
    if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    if (w < 8 || h < 8) return;
    const N = FIT_PROFILE_POINTS;
    const x = (k) => (k / (N - 1)) * (w - 2) + 1;
    const y = (v) => h - 1 - (v / profileMax) * (h - 6);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (const kmv of [5, 10, 15]) {
      const xx = Math.round(x(kmv / FIT_PROFILE_STEP_KM)) + 0.5;
      ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, h); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
    const total = new Float32Array(N);
    for (let k = 0; k < N; k++) total[k] = stats.guns[k] + stats.miss[k];
    const area = (top, bottom, fill) => {
      ctx.beginPath();
      ctx.moveTo(x(0), y(bottom ? bottom[0] : 0));
      for (let k = 0; k < N; k++) ctx.lineTo(x(k), y(top[k]));
      for (let k = N - 1; k >= 0; k--) ctx.lineTo(x(k), y(bottom ? bottom[k] : 0));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    area(stats.guns, null, hexA(acc, 0.5));
    area(total, stats.guns, hexA(acc, 0.2));
    ctx.beginPath();
    for (let k = 0; k < N; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(k), y(total[k]));
    ctx.strokeStyle = acc;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (ref0) {
      ctx.beginPath();
      for (let k = 0; k < N; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(k), y(ref0.guns[k] + ref0.miss[k]));
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function hullLayout(hull, w, h, pad) {
    const hw = Math.max(1, hull.w);
    const hh = Math.max(1, hull.h);
    const s = Math.min((w - pad * 2) / hw, (h - pad * 2) / hh);
    return { s, cx: w / 2, cy: h / 2, hw, hh };
  }
  function drawSprite(ctx, hull, L, alpha) {
    const img = hull.image;
    if (!img || !(img.width || img.naturalWidth)) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, L.cx - (L.hw * L.s) / 2, L.cy - (L.hh * L.s) / 2, L.hw * L.s, L.hh * L.s);
    ctx.globalAlpha = 1;
  }

  // Karta: które gniazda automat przezbroi (barwa karty), które zostają (szare), co trzeba kupić (biała obwódka),
  // które zostaną puste (czerwony obrys).
  function drawFitMap(cv, hull, plan, acc) {
    if (!cv) return;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    if (w < 20 || h < 20) return;
    const L = hullLayout(hull, w, h, 4);
    drawSprite(ctx, hull, L, 0.5);
    const r = Math.max(2.2, Math.min(4.5, 9 * L.s));
    const left = new Map(plan.buy);
    for (const hp of hull.hardpoints) {
      if (hp.destroyed) continue;
      const to = plan.mounts.get(hp.id) ?? null;
      const from = hp.mount || null;
      const x = L.cx + hp.pos.x * L.s;
      const y = L.cy + hp.pos.y * L.s;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (!to) { ctx.strokeStyle = '#ff4545'; ctx.lineWidth = 1.5; ctx.stroke(); continue; }
      ctx.fillStyle = to !== from ? acc : 'rgba(200, 208, 218, 0.35)';
      ctx.fill();
      if (to !== from && (left.get(to) || 0) > 0) {
        left.set(to, left.get(to) - 1);
        ctx.beginPath(); ctx.arc(x, y, r + 2, 0, Math.PI * 2); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  function drawHull(cv, hull, opts) {
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);
    if (w < 20 || h < 20) return [];
    const L = hullLayout(hull, w, h, opts.pad ?? 18);
    drawSprite(ctx, hull, L, opts.spriteAlpha ?? 0.8);
    if (opts.shade !== false) {
      ctx.fillStyle = 'rgba(3, 5, 8, 0.38)';
      ctx.fillRect(L.cx - (L.hw * L.s) / 2, L.cy - (L.hh * L.s) / 2, L.hw * L.s, L.hh * L.s);
    }
    const r = opts.r ?? Math.max(4, Math.min(10, 22 * L.s));
    const pts = [];
    for (const hp of hull.hardpoints) {
      const x = L.cx + hp.pos.x * L.s;
      const y = L.cy + hp.pos.y * L.s;
      const col = SLOT[hp.effType]?.color || '#ccc';
      pts.push({ hp, x, y, r });
      if (opts.sel?.has(hp.id)) {
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 2; ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      if (hp.destroyed) {
        ctx.strokeStyle = '#ff4545'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      } else if (hp.mount) {
        ctx.fillStyle = col; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = 'rgba(3,5,8,0.85)'; ctx.fill();
        if (opts.bands) {
          ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
          ctx.strokeStyle = BAND[bandOf(hp.mount)] || '#ccc'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      } else {
        ctx.setLineDash([2, 2]); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
      if (opts.hover === hp.id) { ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    if (opts.labels) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px Consolas, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('DZIÓB →', w - 10, 16);
      ctx.textAlign = 'left';
      ctx.fillText('LEWA BURTA', 10, 16);
      ctx.fillText('PRAWA BURTA', 10, h - 8);
    }
    return pts;
  }

  // -----------------------------------------------------------------------------------------------------------
  // Pasek stanu
  // -----------------------------------------------------------------------------------------------------------

  function deltaHtml(a, b) {
    if (!(b > 0)) return a > 0 ? '<span class="d up">nowe</span>' : '<span class="d same">—</span>';
    const p = Math.round((a / b - 1) * 100);
    if (Math.abs(p) < 1) return '<span class="d same">±0</span>';
    return `<span class="d ${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}%</span>`;
  }

  const repairSig = (repair) => (repair?.needed ? `${repair.cost}` : '-');

  function renderStatus() {
    const hull = api.hull();
    const active = api.activePresetLabel();
    const s = api.stats(null, api.currentModule());
    const ammo = api.ammoState();
    const repair = api.repairInfo();
    state.repairSig = repairSig(repair);
    const filled = hull.hardpoints.filter((h) => h.mount && !h.destroyed).length;
    const moduleDef = api.currentModule() ? api.modules().find((m) => m.id === api.currentModule()) : null;
    ref.status.innerHTML = `
      <span class="fit-ship">${esc(hull.name)}</span>
      <span class="fit-cfg">${esc(active)}</span>
      <span class="fit-kv">gniazda <b>${filled}/${hull.hardpoints.length}</b></span>
      <span class="fit-kv">moduł <b>${moduleDef ? esc(moduleDef.label) : (api.moduleSlots() > 0 ? 'wolny' : 'brak gniazda')}</b></span>
      <span class="fit-kv">F <b>${esc(api.currentSystemLabel())}</b></span>
      <span class="fit-kv">tarcza <b>${fmt(s.shieldMax)}</b></span>
      <span class="fit-kv" data-ref-ammo>amunicja <b>${ammo.max > 0 ? `${ammo.have}/${ammo.max}` : '—'}</b></span>
      <span class="fit-grow"></span>
      <button class="fit-btn" type="button" data-act="repair" ${repair.needed ? '' : 'disabled'}>${repair.needed ? `NAPRAW · ${cr(repair.cost)}` : 'KADŁUB SPRAWNY'}</button>
      <button class="fit-btn" type="button" data-act="ammo" ${ammo.missing > 0 ? '' : 'disabled'}>UZUPEŁNIJ AMUNICJĘ</button>`;
  }

  // -----------------------------------------------------------------------------------------------------------
  // KONFIGURACJE
  // -----------------------------------------------------------------------------------------------------------

  function loadoutLines(plan) {
    const hull = api.hull();
    const by = new Map();
    for (const hp of hull.hardpoints) {
      if (hp.destroyed) continue;
      const id = plan.mounts.get(hp.id) ?? null;
      if (!by.has(hp.type)) by.set(hp.type, new Map());
      const m = by.get(hp.type);
      m.set(id, (m.get(id) || 0) + 1);
    }
    const lines = [];
    for (const type of ['main', 'special', 'missile', 'aux', 'hangar']) {
      const m = by.get(type);
      if (!m) continue;
      const parts = [...m.entries()].sort((a, b) => b[1] - a[1]);
      if (type === 'aux') {
        const total = parts.reduce((s, [, n]) => s + n, 0);
        lines.push({ n: total, text: `OP: ${parts.filter(([id]) => id).map(([id, n]) => `${n} ${nameOf(id)}`).join(', ')}`, r: '', cls: '' });
        continue;
      }
      for (const [id, n] of parts) {
        if (!id) { lines.push({ n, text: `puste — ${SLOT[type].label.toLowerCase()}`, r: '', cls: 'empty' }); continue; }
        const def = W[id];
        const r = def?.mountType === 'hangar' ? '' : `${km(weaponRangeWithModule(def, plan.module))} km`;
        const wanted = !!plan.preset?.slots?.[type]?.want?.some(([w]) => w === id);
        lines.push({ n, text: nameOf(id), r, cls: plan.buy.has(id) ? 'buy' : (!wanted ? 'sub' : '') });
      }
    }
    return lines;
  }

  function renderCards() {
    const hull = api.hull();
    const presets = api.presets();
    const cur = api.stats(null, api.currentModule());
    const credits = api.credits();
    const activeId = api.activePresetId();
    state.cardPlans = presets.map((p) => ({ buy: api.plan(p, 'buy'), own: api.plan(p, 'own') }));
    const stats = state.cardPlans.map((pl) => api.stats(pl.buy.mounts, pl.buy.module));
    computeProfileMax([cur, ...stats]);
    const box = ref.cards;
    box.innerHTML = '';
    box.classList.toggle('has-sel', state.selCard >= 0);
    presets.forEach((p, i) => {
      const { buy, own } = state.cardPlans[i];
      const st = stats[i];
      const active = activeId === p.id;
      const toBuy = buy.toBuyCount;
      const canPay = buy.price <= credits && !buy.blocked;
      const ownSubs = own.subs.reduce((s, x) => s + x.n, 0) + own.empties.length;
      const sys = api.systemLabel(p.system);
      const modLabel = p.module ? (api.modules().find((m) => m.id === p.module)?.label || p.module) : 'wolny';
      let foot;
      if (active && !toBuy) {
        foot = `<span class="fit-avail">W HANGARZE <b>${buy.total}/${buy.total}</b></span><button class="fit-btn primary" type="button" disabled>ZAŁOŻONA</button>`;
      } else if (!toBuy) {
        foot = `<span class="fit-avail">W HANGARZE <b>${buy.total}/${buy.total}</b> · 0 CR</span><button class="fit-btn primary" type="button" data-act="card-buy">ZASTOSUJ</button>`;
      } else {
        const why = buy.blocked ? ' · w porcie brak części' : (canPay ? '' : ' · za mało kredytów');
        const priceLine = `<span class="${canPay ? 'fit-price' : 'fit-warn'}">${cr(buy.price)}</span>${why}`;
        foot = active
          ? `<span class="fit-avail">NIEPEŁNA · DO KUPIENIA <b>${partsWord(toBuy)}</b><br>${priceLine}</span>
             <button class="fit-btn primary" type="button" data-act="card-buy" ${canPay ? '' : 'disabled'}>UZUPEŁNIJ</button>`
          : `<span class="fit-avail">W HANGARZE <b>${buy.fromStock}/${buy.total}</b> · DO KUPIENIA <b>${partsWord(toBuy)}</b><br>${priceLine}</span>
             <span class="fit-btns"><button class="fit-btn" type="button" data-act="card-own" title="z tego, co jest w hangarze — zastępstwa: ${ownSubs}">Z MAGAZYNU</button><button class="fit-btn primary" type="button" data-act="card-buy" ${canPay ? '' : 'disabled'}>KUP</button></span>`;
      }
      const card = el('div', `fit-card${state.selCard === i ? ' sel' : ''}`);
      card.style.setProperty('--acc', p.accent || '#ff6600');
      const lines = loadoutLines(buy).slice(0, 7);
      card.innerHTML = `
        <div class="fit-card-head"><span class="fit-card-name">${esc(p.name)}</span>${active ? '<span class="fit-tag">AKTYWNA</span>' : (p.start ? '<span class="fit-tag later">START</span>' : '')}</div>
        <div class="fit-card-role">${esc(p.role || '')}</div>
        <div class="fit-profile-wrap"><canvas class="fit-profile"></canvas><div class="fit-axis"><span>0</span><span>5</span><span>10</span><span>15 km</span></div></div>
        <div class="fit-chips"><span class="fit-chip"><i>F</i>${esc(sys)}</span><span class="fit-chip"><i>MODUŁ</i>${esc(modLabel)}</span></div>
        <div class="fit-stats">
          <div class="fit-stat"><span class="k">OGIEŃ DO 3 KM</span><span class="v">${fmt(st.at(3))}</span>${deltaHtml(st.at(3), cur.at(3))}</div>
          <div class="fit-stat"><span class="k">OGIEŃ NA 9 KM</span><span class="v">${fmt(st.at(9))}</span>${deltaHtml(st.at(9), cur.at(9))}</div>
          <div class="fit-stat"><span class="k">ZASIĘG DZIAŁ</span><span class="v">${km(st.maxGun)} km</span>${deltaHtml(st.maxGun, cur.maxGun)}</div>
          <div class="fit-stat"><span class="k">TARCZA</span><span class="v">${fmt(st.shieldMax)}</span>${deltaHtml(st.shieldMax, cur.shieldMax)}</div>
        </div>
        <ul class="fit-loadout">${lines.map((l) => `<li class="${l.cls}"><b>${l.n}×</b><span>${esc(l.text)}</span><i>${l.r}</i></li>`).join('')}</ul>
        <div class="fit-map"><canvas></canvas><span class="fit-map-k">${slotsWord(buy.changed)} do przezbrojenia${toBuy ? ' · <span class="fit-buy-k">■</span> do kupienia' : ''}</span></div>
        <div class="fit-card-foot">${foot}</div>`;
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (btn) {
          if (btn.disabled) return;
          if (btn.dataset.act === 'card-buy') applyPlan(buy, p.name);
          else if (btn.dataset.act === 'card-own') applyPlan(own, `${p.name} (z magazynu)`);
          return;
        }
        state.selCard = state.selCard === i ? -1 : i;
        renderCards();
        renderDiff();
      });
      box.appendChild(card);
      drawProfile(card.querySelector('canvas.fit-profile'), st, p.accent || '#ff6600', cur);
      drawFitMap(card.querySelector('.fit-map canvas'), hull, buy, p.accent || '#ff6600');
    });
    // Kafel REFIT RĘCZNY
    const customs = api.customs();
    const tile = el('div', 'fit-card refit');
    tile.innerHTML = `
      <div class="fit-card-head"><span class="fit-card-name">REFIT RĘCZNY</span></div>
      <div class="fit-card-role">broń gniazdo po gnieździe · moduł · system F · chipy</div>
      <canvas class="fit-mini"></canvas>
      <ul class="fit-refit-info">
        <li>gniazda <b>${hull.hardpoints.length}</b> · obsadzone <b>${hull.hardpoints.filter((h) => h.mount && !h.destroyed).length}</b>${hull.hardpoints.some((h) => h.destroyed) ? ` · zniszczone <b class="warn">${hull.hardpoints.filter((h) => h.destroyed).length}</b>` : ''}</li>
        <li>w hangarze <b>${api.stockTotal()}</b> szt. broni</li>
        ${customs.length ? `<li>własne: ${customs.map((c) => `<b data-custom="${esc(c.id)}" class="fit-custom">${esc(c.name)}</b>`).join(' · ')}</li>` : ''}
      </ul>
      <div class="fit-grow"></div>
      <button class="fit-btn primary" type="button" data-act="open-manual">OTWÓRZ<span class="fit-key">  [R]</span></button>`;
    tile.querySelector('[data-act="open-manual"]').onclick = () => setView('manual');
    for (const b of tile.querySelectorAll('[data-custom]')) {
      b.onclick = (e) => {
        e.stopPropagation();
        const c = customs.find((x) => x.id === b.dataset.custom);
        if (c) applyPlan(api.plan(c, 'own'), c.name);
      };
    }
    box.appendChild(tile);
    drawHull(tile.querySelector('canvas.fit-mini'), hull, { pad: 4, r: 3.2, spriteAlpha: 0.7, shade: true });
  }

  function renderDiff() {
    const box = ref.diff;
    const i = state.selCard;
    const presets = api.presets();
    if (i < 0 || !presets[i] || !state.cardPlans[i]) {
      box.className = 'fit-diff idle';
      box.innerHTML = '<div class="fit-diff-title">ZMIANY</div><div class="fit-diff-rows"><div>Wybierz kartę — tu pojawi się, co zostanie zdjęte, założone i kupione.</div></div><div class="fit-diff-actions"></div>';
      return;
    }
    const p = presets[i];
    const { buy, own } = state.cardPlans[i];
    const hull = api.hull();
    box.className = 'fit-diff';
    const before = new Map();
    const after = new Map();
    for (const hp of hull.hardpoints) {
      if (hp.destroyed) continue;
      const a = hp.mount || null;
      const b = buy.mounts.get(hp.id) ?? null;
      if (!before.has(hp.type)) { before.set(hp.type, new Map()); after.set(hp.type, new Map()); }
      before.get(hp.type).set(a, (before.get(hp.type).get(a) || 0) + 1);
      after.get(hp.type).set(b, (after.get(hp.type).get(b) || 0) + 1);
    }
    const desc = (m) => [...(m || new Map()).entries()].filter(([id]) => id).sort((x, y) => y[1] - x[1]).map(([id, n]) => `${n}× ${nameOf(id)}`).join(', ') || 'puste';
    const rows = [];
    for (const type of TYPE_ORDER) {
      if (!before.has(type)) continue;
      const a = desc(before.get(type));
      const b = desc(after.get(type));
      const label = type === 'special' && buy.module === 'missile_cells' ? 'BATERIA→WYRZ.' : SLOT[type].label;
      rows.push(a === b
        ? `<div><span class="g">${label}</span><span class="same">bez zmian</span></div>`
        : `<div><span class="g">${label}</span><span class="from">${esc(a)}</span> → <span class="to">${esc(b)}</span></div>`);
    }
    const modLabel = (id) => (id ? (api.modules().find((m) => m.id === id)?.label || id) : 'wolny');
    const modA = modLabel(api.currentModule());
    const modB = modLabel(buy.module);
    rows.push(`<div><span class="g">MODUŁ</span>${modA === modB ? '<span class="same">bez zmian</span>' : `<span class="from">${esc(modA)}</span> → <span class="to">${esc(modB)}</span>`}</div>`);
    const sysA = api.currentSystemLabel();
    const sysB = api.systemLabel(buy.system);
    rows.push(`<div><span class="g">SYSTEM F</span>${sysA === sysB ? '<span class="same">bez zmian</span>' : `<span class="from">${esc(sysA)}</span> → <span class="to">${esc(sysB)}</span>`}</div>`);
    const buyTxt = [...buy.buy.entries()].sort((a, b) => b[1] * (api.weaponPrice(b[0]) || 0) - a[1] * (api.weaponPrice(a[0]) || 0))
      .map(([id, n]) => `${n}× ${nameOf(id)} ${cr((api.weaponPrice(id) || 0) * n)}`)
      .concat(buy.partsToBuy.map((id) => `${api.partLabel(id)} ${cr(api.partPrice(id))}`))
      .concat([...buy.unavailable.entries()].map(([id, n]) => `${n}× ${nameOf(id)} — brak w porcie`))
      .join(', ');
    const subsTxt = own.subs.slice().sort((a, b) => b.n - a.n).map((s) => `${s.n}× ${nameOf(s.used)}${s.want ? ` zamiast ${nameOf(s.want)}` : ''}`).join(', ');
    const toBuy = buy.toBuyCount + buy.unavailable.size;
    const credits = api.credits();
    const canPay = buy.price <= credits && !buy.blocked;
    const active = api.activePresetId() === p.id;
    box.innerHTML = `
      <div class="fit-diff-title">ZMIANY · <b>${esc(p.name)}</b>${toBuy ? ` · <span class="buys">do kupienia (${cr(buy.price)}): ${esc(buyTxt)}</span>` : ' · <span class="same">wszystko w hangarze</span>'}</div>
      ${toBuy && (subsTxt || own.module !== buy.module) ? `<div class="fit-diff-title">Z MAGAZYNU zamiast kupować: <span class="subs">${esc(subsTxt || '')}${own.module !== buy.module ? `${subsTxt ? ' · ' : ''}moduł wolny` : ''}</span></div>` : ''}
      <div class="fit-diff-rows">${rows.join('')}</div>
      <div class="fit-diff-actions">
        <button class="fit-btn" type="button" data-act="diff-cancel">ANULUJ</button>
        ${toBuy && !active ? '<button class="fit-btn" type="button" data-act="diff-own">Z MAGAZYNU</button>' : ''}
        <button class="fit-btn primary" type="button" data-act="diff-apply" ${(active && !toBuy) || !canPay ? 'disabled' : ''}>${toBuy ? `${active ? 'UZUPEŁNIJ' : 'KUP I ZASTOSUJ'} · ${cr(buy.price)}` : 'ZASTOSUJ  [ENTER]'}</button>
      </div>`;
    box.querySelector('[data-act="diff-cancel"]').onclick = () => { state.selCard = -1; renderCards(); renderDiff(); };
    box.querySelector('[data-act="diff-apply"]').onclick = (e) => { if (!e.currentTarget.disabled) applyPlan(buy, p.name); };
    const ownBtn = box.querySelector('[data-act="diff-own"]');
    if (ownBtn) ownBtn.onclick = () => applyPlan(own, `${p.name} (z magazynu)`);
  }

  function applyPlan(plan, label) {
    const ok = api.apply(plan, label);
    if (ok) {
      state.selCard = -1;
      state.sel.clear();
      const bought = plan.mode === 'buy' ? plan.toBuyCount : 0;
      const subsN = plan.subs.reduce((s, x) => s + x.n, 0);
      toast(`Konfiguracja: ${label}${bought ? ` · kupiono ${partsWord(bought)} za ${cr(plan.price)}` : ''}${subsN ? ` · zastępstwa ${subsN}` : ''}`);
    }
    render();
    return ok;
  }

  // -----------------------------------------------------------------------------------------------------------
  // REFIT RĘCZNY
  // -----------------------------------------------------------------------------------------------------------

  const selType = () => {
    const hull = api.hull();
    for (const id of state.sel) {
      const hp = hull.hardpoints.find((h) => h.id === id);
      if (hp) return hp.effType;
    }
    return null;
  };
  const mirrorOf = (hull, hp) => hull.hardpoints.find((o) => o.id !== hp.id && o.type === hp.type
    && Math.abs(o.pos.x - hp.pos.x) < 0.75 && Math.abs(o.pos.y + hp.pos.y) < 0.75 && Math.abs(hp.pos.y) > 0.75);

  function toggleSlot(hp, additive) {
    if (hp.destroyed) { toast('Gniazdo zniszczone — naprawa w doku'); return; }
    const hull = api.hull();
    if (selType() && selType() !== hp.effType) state.sel.clear();
    const ids = [hp.id];
    if (state.symmetry) {
      const m = mirrorOf(hull, hp);
      if (m && !m.destroyed) ids.push(m.id);
    }
    const on = state.sel.has(hp.id);
    if (!additive) { state.sel.clear(); for (const id of ids) state.sel.add(id); }
    else for (const id of ids) { if (on) state.sel.delete(id); else state.sel.add(id); }
    renderManual();
  }

  function renderTools() {
    const hull = api.hull();
    const box = ref.tools;
    box.innerHTML = '';
    const cur = selType();
    for (const t of TYPE_ORDER) {
      const list = hull.hardpoints.filter((h) => h.effType === t && !h.destroyed);
      if (!list.length) continue;
      const b = el('button', `fit-seg${cur === t && state.sel.size === list.length ? ' on' : ''}`, `${SLOT[t].label}<span class="n">${list.length}</span>`);
      b.type = 'button';
      b.onclick = () => { state.sel.clear(); for (const h of list) state.sel.add(h.id); renderManual(); };
      box.appendChild(b);
    }
    box.appendChild(el('span', 'fit-sep'));
    const sym = el('button', `fit-seg${state.symmetry ? ' on' : ''}`, 'SYMETRIA');
    sym.type = 'button';
    sym.onclick = () => { state.symmetry = !state.symmetry; renderTools(); };
    box.appendChild(sym);
    const side = (label, pred) => {
      const b = el('button', 'fit-seg', label);
      b.type = 'button';
      b.onclick = () => {
        const t = selType() || 'main';
        state.sel.clear();
        for (const h of hull.hardpoints) if (h.effType === t && !h.destroyed && pred(h)) state.sel.add(h.id);
        renderManual();
      };
      box.appendChild(b);
    };
    side('LEWA BURTA', (h) => h.pos.y < -0.75);
    side('PRAWA BURTA', (h) => h.pos.y > 0.75);
    side('PUSTE', (h) => !h.mount);
    const clr = el('button', 'fit-seg', 'WYCZYŚĆ');
    clr.type = 'button';
    clr.onclick = () => { state.sel.clear(); renderManual(); };
    box.appendChild(clr);
  }

  function renderHull() {
    const hull = api.hull();
    state.hullPts = drawHull(ref.hull, hull, { sel: state.sel, hover: state.hover, bands: true, labels: true });
  }

  function renderLegend() {
    const hull = api.hull();
    const types = TYPE_ORDER.filter((t) => hull.hardpoints.some((h) => h.effType === t));
    ref.legend.innerHTML = types.map((t) => `<span style="--c:${SLOT[t].color}">${SLOT[t].label.toLowerCase()}</span>`).join('')
      + '<span class="empty">puste gniazdo</span><span style="--c:#ff6600">zaznaczone</span><span class="note">środek kropki — pasmo zasięgu broni</span>';
  }

  function renderWeaponList() {
    const t = selType();
    const n = state.sel.size;
    if (!t) {
      ref.selHead.innerHTML = 'Kliknij gniazdo na sylwetce (Shift — kilka, SYMETRIA — z gniazdem lustrzanym) albo grupę nad sylwetką.';
      ref.wlist.innerHTML = '';
      return;
    }
    const hull = api.hull();
    const selHps = hull.hardpoints.filter((h) => state.sel.has(h.id));
    ref.selHead.innerHTML = `ZAZNACZONE: <b>${n} × ${SLOT[t].label}</b> · brakujące sztuki kupowane przy montażu`;
    const ids = Object.keys(W).filter((id) => W[id].mountType === t && id !== 'fighter_bay' && selHps.every((h) => api.fits(id, h)))
      .sort((a, b) => weaponRangeWithModule(W[a], api.currentModule()) - weaponRangeWithModule(W[b], api.currentModule()));
    const selIds = selHps.map((h) => h.mount || null);
    const rows = ['<div class="fit-wrow head"><span>BROŃ</span><span>PASMO</span><span class="num">ZASIĘG</span><span class="num">DPS</span><span class="cnt">HANGAR</span><span class="num">CENA</span></div>'];
    for (const id of ids) {
      const have = api.stockCount(id);
      const curRow = selIds.length && selIds.every((x) => x === id);
      const band = bandOf(id);
      const isHangar = W[id].mountType === 'hangar';
      const price = isHangar ? null : api.weaponPrice(id);
      rows.push(`<div class="fit-wrow${curRow ? ' cur' : ''}" data-id="${esc(id)}">
        <span class="nm">${esc(nameOf(id))}</span>
        <span class="band" style="--bc:${BAND[band] || '#ccc'}">${band}</span>
        <span class="num">${isHangar ? '—' : `${km(weaponRangeWithModule(W[id], api.currentModule()))} km`}</span>
        <span class="num">${isHangar ? '—' : fmt(weaponDps(W[id]))}</span>
        <span class="cnt">${isHangar ? '∞' : (have > 0 ? `×${have}` : '0')}</span>
        <span class="num price">${isHangar ? '—' : (price != null ? fmt(price) : 'brak')}</span></div>`);
    }
    rows.push('<div class="fit-wrow" data-id=""><span class="nm fit-unmount">ZDEJMIJ Z ZAZNACZONYCH</span><span></span><span></span><span></span><span></span><span></span></div>');
    ref.wlist.innerHTML = rows.join('');
    for (const row of ref.wlist.querySelectorAll('.fit-wrow[data-id]')) {
      row.onclick = () => {
        const res = api.mountSlots([...state.sel], row.dataset.id || null);
        if (res?.message) toast(res.message);
        renderManual();
      };
    }
  }

  function renderOptions() {
    const modules = api.modules();
    const slots = api.moduleSlots();
    ref.optModule.innerHTML = '';
    if (slots <= 0) {
      ref.optModule.appendChild(el('div', 'fit-none', 'Ten kadłub nie ma gniazda modułu.'));
    } else {
      const cur = api.currentModule();
      const free = el('button', `fit-opt${!cur ? ' on' : ''}`, 'WOLNE<small>bez modułu</small>');
      free.type = 'button';
      free.onclick = () => { const r = api.setModule(null); if (r?.message) toast(r.message); render(); };
      ref.optModule.appendChild(free);
      for (const m of modules) {
        const tag = m.installed ? 'założony' : (m.owned ? 'w hangarze' : cr(m.price));
        const b = el('button', `fit-opt${cur === m.id ? ' on' : ''}`, `${esc(m.label)} <span class="tag">${tag}</span><small>${esc(m.desc)}</small>`);
        b.type = 'button';
        b.disabled = !m.installed && !m.owned && m.price > api.credits(); // zakup — kredyty blokują
        b.onclick = () => { const r = api.setModule(m.id); if (r?.message) toast(r.message); render(); };
        ref.optModule.appendChild(b);
      }
    }
    ref.optSystem.innerHTML = '';
    const systems = api.systems();
    if (!systems.length) ref.optSystem.appendChild(el('div', 'fit-none', 'Ten kadłub nie ma systemu F.'));
    for (const s of systems) {
      const tag = s.builtin ? 'w kadłubie' : (s.installed ? 'założony' : (s.owned ? 'w hangarze' : cr(s.price)));
      const b = el('button', `fit-opt${s.installed ? ' on' : ''}`, `${esc(s.label)} <span class="tag">${tag}</span><small>${esc(s.desc || '')}</small>`);
      b.type = 'button';
      b.disabled = !s.builtin && !s.installed && !s.owned && s.price > api.credits();
      b.onclick = () => { const r = api.setSystem(s.id); if (r?.message) toast(r.message); render(); };
      ref.optSystem.appendChild(b);
    }
    ref.optChips.innerHTML = '';
    const chips = api.chips();
    if (!chips.length) ref.optChips.appendChild(el('div', 'fit-none', 'Brak chipów dla tego kadłuba.'));
    for (const c of chips) {
      const b = el('button', `fit-opt${c.installed ? ' on' : ''}`, `${esc(c.name)} <span class="tag">${c.installed ? 'zainstalowany — klik: zdejmij' : cr(c.cost)}</span><small>${esc(c.desc || '')}</small>`);
      b.type = 'button';
      b.disabled = !c.installed && c.cost > api.credits(); // z ?dev cena 0 (instalacja za darmo)
      b.onclick = () => { const r = api.toggleChip(c.id); if (r?.message) toast(r.message); render(); };
      ref.optChips.appendChild(b);
    }
  }

  function renderBottom() {
    const s = api.stats(null, api.currentModule());
    const refStats = api.startStats();
    computeProfileMax([s, refStats]);
    drawProfile(ref.mProfile, s, '#ff6600', refStats);
    const hang = [...s.hangars.entries()].map(([id, n]) => `${n} ${nameOf(id).replace('Eskadra ', '')}`).join(', ') || '—';
    ref.sums.innerHTML = `
      <div><span>OGIEŃ DO 3 KM</span><b>${fmt(s.at(3))}</b></div>
      <div><span>NA 9 KM</span><b>${fmt(s.at(9))}</b></div>
      <div><span>NA 12 KM</span><b>${fmt(s.at(12))}</b></div>
      <div><span>ZASIĘG DZIAŁ</span><b>${km(s.maxGun)} km</b></div>
      <div><span>OBRONA PKT.</span><b>${s.pd} luf · do ${km(s.pdRange)} km</b></div>
      <div><span>TARCZA</span><b>${fmt(s.shieldMax)}</b></div>
      <div><span>RAKIETY</span><b>${s.maxMiss ? `do ${km(s.maxMiss)} km` : '—'}</b></div>
      <div><span>MYŚLIWCE</span><b>${esc(hang)}</b></div>
      <div><span>KREDYTY</span><b data-ref-credits>${cr(api.credits())}</b></div>`;
  }

  function renderManual() {
    if (state.view !== 'manual') return;
    renderStatus();
    renderTools();
    renderHull();
    renderLegend();
    renderWeaponList();
    renderOptions();
    renderBottom();
  }

  // -----------------------------------------------------------------------------------------------------------
  // Całość
  // -----------------------------------------------------------------------------------------------------------

  function render() {
    if (!root.isConnected) return;
    if (state.view === 'cards') {
      renderStatus();
      renderCards();
      renderDiff();
    } else {
      renderManual();
    }
    state.built = true;
  }

  function setView(v) {
    state.view = v;
    views.cards.classList.toggle('on', v === 'cards');
    views.manual.classList.toggle('on', v === 'manual');
    requestAnimationFrame(render);
  }

  // Liczby co klatkę (bez przebudowy DOM): kredyty, amunicja; stan naprawy co ~0,5 s (zmiana — pasek stanu od nowa).
  let lastTickSig = '';
  let repairCheckAt = 0;
  function tick() {
    if (!isVisible()) return;
    const now = performance.now();
    if (now >= repairCheckAt) {
      repairCheckAt = now + 500;
      if (repairSig(api.repairInfo()) !== state.repairSig) renderStatus();
    }
    const ammo = api.ammoState();
    const sig = `${Math.round(api.credits())}|${ammo.have}|${ammo.max}`;
    if (sig === lastTickSig) return;
    lastTickSig = sig;
    const creditsEl = root.querySelector('[data-ref-credits]');
    if (creditsEl) creditsEl.textContent = cr(api.credits());
    const ammoEl = root.querySelector('[data-ref-ammo] b');
    if (ammoEl) ammoEl.textContent = ammo.max > 0 ? `${ammo.have}/${ammo.max}` : '—';
    const ammoBtn = ref.status.querySelector('[data-act="ammo"]');
    if (ammoBtn) ammoBtn.disabled = ammo.missing <= 0;
  }

  function isVisible() {
    return root.isConnected && root.classList.contains('active') && !root.classList.contains('hidden') && api.isOpen();
  }

  // Zdarzenia: przyciski stanu i refitu ręcznego (delegacja), sylwetka, klawisze.
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'repair') { const r = api.repair(); if (r?.message) toast(r.message); render(); }
    else if (act === 'ammo') { const r = api.refillAmmo(); if (r?.message) toast(r.message); render(); }
    else if (act === 'back') setView('cards');
    else if (act === 'save-custom') { const r = api.saveCustom(); if (r?.message) toast(r.message); render(); }
    else if (act === 'dev-fill') { api.dev?.fillWeapons?.(); render(); }
  });

  function pickSlot(ev) {
    const r = ref.hull.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    let best = null;
    let bd = Infinity;
    for (const p of state.hullPts) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && d <= p.r + 6) { bd = d; best = p; }
    }
    return { best, x, y };
  }
  ref.hull.addEventListener('mousemove', (ev) => {
    const { best, x, y } = pickSlot(ev);
    const id = best?.hp.id || null;
    if (id !== state.hover) { state.hover = id; renderHull(); }
    if (!best) { ref.tip.style.display = 'none'; return; }
    const hp = best.hp;
    const side = hp.pos.y < -0.75 ? 'lewa burta' : hp.pos.y > 0.75 ? 'prawa burta' : 'oś';
    const wid = hp.mount;
    const def = wid ? W[wid] : null;
    ref.tip.innerHTML = `<div class="t1">${SLOT[hp.effType]?.label || hp.effType} · ${side}${hp.destroyed ? ' · ZNISZCZONE' : ''}</div>${def
      ? `${esc(nameOf(wid))}${def.mountType === 'hangar' ? '' : ` · ${km(weaponRangeWithModule(def, api.currentModule()))} km · ${fmt(weaponDps(def))} DPS`}`
      : '<span class="muted">puste</span>'}`;
    ref.tip.style.display = 'block';
    const wrap = ref.hull.parentElement.getBoundingClientRect();
    ref.tip.style.left = `${Math.min(x + 14, wrap.width - ref.tip.offsetWidth - 4)}px`;
    ref.tip.style.top = `${Math.max(4, y - 44)}px`;
  });
  ref.hull.addEventListener('mouseleave', () => { ref.tip.style.display = 'none'; state.hover = null; renderHull(); });
  ref.hull.addEventListener('click', (ev) => {
    const { best } = pickSlot(ev);
    if (best) toggleSlot(best.hp, ev.shiftKey || ev.ctrlKey);
  });

  function onKey(e) {
    if (!isVisible()) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    let handled = true;
    if (state.view === 'cards') {
      const presets = api.presets();
      if (e.code === 'ArrowRight') { state.selCard = Math.min(presets.length - 1, state.selCard + 1); renderCards(); renderDiff(); }
      else if (e.code === 'ArrowLeft') { state.selCard = Math.max(0, (state.selCard < 0 ? 1 : state.selCard) - 1); renderCards(); renderDiff(); }
      else if (e.code === 'Enter' && state.selCard >= 0) {
        const plan = state.cardPlans[state.selCard]?.buy;
        const p = presets[state.selCard];
        if (plan && p && !(api.activePresetId() === p.id && !plan.toBuyCount) && plan.price <= api.credits() && !plan.blocked) applyPlan(plan, p.name);
      }
      else if (e.code === 'KeyR') setView('manual');
      else if (e.code === 'Escape' && state.selCard >= 0) { state.selCard = -1; renderCards(); renderDiff(); }
      else handled = false;
    } else if (e.code === 'Escape') {
      setView('cards');
    } else {
      handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
  window.addEventListener('keydown', onKey, true);

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    let pending = false;
    ro = new ResizeObserver(() => {
      if (pending || !isVisible()) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; render(); });
    });
    ro.observe(root);
  }

  return {
    render,
    tick,
    isVisible,
    setView,
    get view() { return state.view; },
    destroy() {
      window.removeEventListener('keydown', onKey, true);
      ro?.disconnect();
      root.classList.remove('fit-mode');
    }
  };
}
