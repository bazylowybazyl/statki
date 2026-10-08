// Makieta zakładki WYPOSAŻENIE (docs/PLAN-fitowanie.md): cztery karty konfiguracji + REFIT RĘCZNY.
// Prawdziwe dane: MASTER_WEAPONS, gniazda Atlasa (src/data/atlasHardpointDefaults.js), sprite kadłuba, ceny broni
// z src/game/weaponEconomy.js (wartość materiałowa × marża warsztatu 1,12 — w grze: lokalne ceny portu).
// Automat refitu, ceny kart i profil ognia to szkic przyszłych src/game/fitPlanner.js / fitStats.js — nie gra.
// Decyzje użytkownika 2026-10-08: UNIWERSALNA zamiast DOWÓDCY, komplety w misji startowej, potem płaci się tylko
// za brakujące części, klasa dział snajperskich (Lanca — projekt), Plasma Gatling 640 DPS.
// Otwieranie przez Vite: http://localhost:5199/dema/fitowanie-koncept.html
import { MASTER_WEAPONS as W0 } from '../src/data/weapons.js';
import { ATLAS_EDITOR_DEFAULTS } from '../src/data/atlasHardpointDefaults.js';
import { weaponMaterialValue } from '../src/game/weaponEconomy.js';
import atlasUrl from '../assets/capital_ship_rect_v1.png';

// ---------------------------------------------------------------------------------------------
// Dane
// ---------------------------------------------------------------------------------------------

// Klasa dział snajperskich (plan § 4.3.1, D10): nowe działa main — projekt, jeszcze nie w grze.
const EXTRA = {
  lance_rail_m: {
    id: 'lance_rail_m', name: 'Lanca', mountType: 'main', category: 'rail', size: 'M', weaponClass: 'sniper',
    baseDamage: 48, baseRange: 8000, baseSpeed: 14000, cooldown: 2.4
  },
  lance_rail_l: {
    id: 'lance_rail_l', name: 'Lanca Ciężka', mountType: 'main', category: 'rail', size: 'L', weaponClass: 'sniper',
    baseDamage: 100, baseRange: 10000, baseSpeed: 15000, cooldown: 4.0
  }
};
const W = { ...W0, ...EXTRA };
const SNIPER = new Set(['lance_rail_m', 'lance_rail_l', 'special_valkyrie_s', 'special_valkyrie_m', 'special_valkyrie_railgun', 'siege_railgun']);
const RANGE_OVERRIDE = { special_valkyrie_s: 6500 };      // D10: Kolec 5 → 6,5 km
const DAMAGE_OVERRIDE = { special_plasma_gatling: 160 };  // D4: 240 → 640 DPS

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
const nameOf = (id) => SHORT[id] || W[id]?.name || id;

const SLOT = {
  main: { label: 'DZIAŁA', color: '#3ea6ff' },
  special: { label: 'BATERIA', color: '#ff4545' },
  missile: { label: 'RAKIETY', color: '#47d18c' },
  aux: { label: 'OBRONA PKT.', color: '#ffaa33' },
  hangar: { label: 'HANGARY', color: '#b18cff' },
  special_missile: { label: 'RAKIETA SPEC.', color: '#ff6ea0' },
  builtin: { label: 'WBUDOWANE', color: '#e8eef5' }
};
const TYPE_ORDER = ['main', 'special', 'missile', 'aux', 'hangar', 'special_missile', 'builtin'];

const BAND = {
  BLISKI: '#ff6600', LINIA: '#ffaa33', DALEKI: '#3ea6ff', SNAJPER: '#8fd3ff', RAKIETY: '#47d18c', OP: '#c9a66b', MYŚL: '#b18cff', SPEC: '#ff6ea0'
};
const CLOSE_CATS = new Set(['autocannon', 'beam', 'armata']);

// Części spoza broni: moduły i system F (ceny stałe na start — plan § 5.1).
const MODULES = {
  shield_booster: { label: 'WZMACNIACZ TARCZ', desc: 'tarcza ×1,4 · regeneracja ×1,5 · twardość ×1,5', price: 12000 },
  ballistic_computer: { label: 'KOMPUTER BALISTYCZNY', desc: 'działa snajperskie: zasięg ×1,5 · pocisk ×1,4', price: 14000 },
  missile_cells: { label: 'KOMORY RAKIETOWE', desc: '6 gniazd baterii → wyrzutnie · amunicja ×1,5', price: 16000, typeMap: { special: 'missile' } }
};
const SYSTEMS = {
  ram_burn: { label: 'SZARŻA', desc: 'zryw 3000 j/s · 5 s · ładowanie 28 s', builtin: true },
  maneuver: { label: 'MANEWR', desc: 'Q/E + F skok w bok · A/D + F obrót na cel', price: 10000 }
};

const COMMON = { special_missile: { want: [['supernova_missile', 1]] }, builtin: { want: [['hexlance_siege', 1]] } };
const AUX_MIX = { want: [['ciws_mk1', 6], ['flak_capital', 4], ['laser_pd_mk1', 2], ['ciws_mk2', 2]], alt: ['ciws_mk1', 'ciws_mk2'] };
const UNIVERSAL = {
  id: 'universal', name: 'UNIWERSALNA', acc: '#9fb7cf', start: true,
  role: 'wszystko po trochu · bateria do 7 km, działa do 6 km, rakiety, myśliwce · moduł wolny',
  system: 'ram_burn', module: null,
  slots: {
    main: { want: [['tempest_ion_l', 15]], alt: ['railgun_mk2'] },
    special: { want: [['special_yamato_cannon', 6]], alt: ['special_yamato_l', 'special_valkyrie_m', 'special_valkyrie_s'] },
    missile: { want: [['grad_launcher', 1], ['missile_rack', 1]], alt: ['missile_rack', 'hydra_mirv'] },
    aux: AUX_MIX,
    hangar: { want: [['fighter_squad_multirole', 6]] },
    ...COMMON
  }
};
const PRESETS = [
  UNIVERSAL,
  {
    id: 'tank', name: 'BLISKI TANK', acc: '#ff6600',
    role: 'walka do 3,5 km · szarża zamyka dystans, tarcza wytrzymuje dolot',
    system: 'ram_burn', module: 'shield_booster',
    slots: {
      main: { want: [['heavy_autocannon_l', 15]], alt: ['armata_mk1', 'beam_pulse', 'heavy_autocannon', 'vulcan_minigun'] },
      special: { want: [['special_plasma_gatling', 6]], alt: ['special_goliath_autocannon'] },
      missile: { want: [['roj_pod', 2]], alt: ['grad_launcher'] },
      aux: { want: [['ciws_mk2', 8], ['ciws_mk1', 6]], alt: ['ciws_mk1', 'flak_capital', 'laser_pd_mk1'] },
      hangar: { want: [['fighter_squad_multirole', 6]] },
      ...COMMON
    }
  },
  {
    id: 'sniper', name: 'SNAJPER', acc: '#3ea6ff',
    role: 'walka z 9–15 km działami snajperskimi · skok w bok przed salwą',
    system: 'maneuver', module: 'ballistic_computer',
    slots: {
      main: { want: [['lance_rail_l', 15]], alt: ['lance_rail_m'] },
      special: { want: [['special_valkyrie_railgun', 4], ['siege_railgun', 2]], alt: ['special_valkyrie_m', 'special_valkyrie_s'] },
      missile: { want: [['missile_rack', 2]], alt: ['hydra_mirv'] },
      aux: { want: [['flak_capital', 6], ['ciws_mk1', 6], ['ciws_mk2', 2]], alt: ['ciws_mk1', 'laser_pd_mk1'] },
      hangar: { want: [['fighter_squad_interceptor', 6]], alt: ['fighter_squad_multirole'] },
      ...COMMON
    }
  },
  {
    id: 'missile', name: 'RAKIETOWIEC', acc: '#ffaa33',
    role: 'salwy z 8 wyrzutni na 6–12 km · automat rakiet dzieli cele',
    system: 'maneuver', module: 'missile_cells',
    slots: {
      main: { want: [['railgun_mk2', 15]] },
      special: { want: [['missile_rack', 4], ['grad_launcher', 2]], alt: ['hydra_mirv', 'roj_pod'] },
      missile: { want: [['hydra_mirv', 2]], alt: ['missile_rack', 'grad_launcher'] },
      aux: { want: [['flak_capital', 6], ['ciws_mk1', 6], ['laser_pd_mk1', 2]], alt: ['ciws_mk2'] },
      hangar: { want: [['fighter_squad_strike', 6]], alt: ['fighter_squad_multirole'] },
      ...COMMON
    }
  }
];

// Zapas startowy gry (index.html: DEFAULT_INVENTORY_STOCK), komplety misji startowej (plan § 5.2).
const DEFAULT_STOCK = {
  railgun_mk2: 24, special_yamato_cannon: 6, special_valkyrie_s: 2, special_valkyrie_m: 2, special_yamato_l: 2,
  missile_rack: 8, ciws_mk1: 6, ciws_mk2: 2, flak_capital: 4, fighter_squad_multirole: 6, hexlance_siege: 1,
  supernova_missile: 4, grad_launcher: 2, roj_pod: 2, hydra_mirv: 2, torpedo_salvo: 2, siege_torpedo: 2,
  laser_pd_mk1: 2, armata_mk1: 2
};
const KITS = {
  tempest_ion_l: 15, heavy_autocannon_l: 15, special_plasma_gatling: 6, ciws_mk2: 6, lance_rail_l: 15,
  special_valkyrie_railgun: 4, siege_railgun: 2, flak_capital: 2, fighter_squad_interceptor: 6, fighter_squad_strike: 6
};
const KIT_PARTS = { shield_booster: 1, ballistic_computer: 1, missile_cells: 1, maneuver: 1 };
const MODES = {
  kits: { label: 'misja startowa — komplety', credits: 1200, kits: true },
  later: { label: 'później — bez kompletów', credits: 150000, kits: false }
};

// Gniazda Atlasa w pikselach PNG (3747 × 1677, środek = 0, dziób +X, y w dół obrazu).
const SPRITE_W = 3747;
const SPRITE_H = 1677;
const HARDPOINTS = ATLAS_EDITOR_DEFAULTS.hardpoints.map((h) => ({ id: h.id, type: h.type, x: h.x, y: h.y }));

// ---------------------------------------------------------------------------------------------
// Liczby: DPS, zasięg, pasmo, cena
// ---------------------------------------------------------------------------------------------

function dpsOf(id) {
  const w = W[id];
  if (!w || !(w.cooldown > 0) || !w.baseDamage) return 0;
  const dmg = DAMAGE_OVERRIDE[id] ?? w.baseDamage;
  const n = (w.barrelsPerShot || 1) * (w.burstCount || 1) * (w.submunition?.count || 1);
  return (dmg * n) / w.cooldown;
}
function rangeOf(id, moduleId) {
  const w = W[id];
  if (!w) return 0;
  const base = RANGE_OVERRIDE[id] ?? w.baseRange ?? 0;
  if (moduleId === 'ballistic_computer' && SNIPER.has(id)) return Math.max(base, Math.min(18000, base * 1.5));
  return base;
}
function bandOf(id) {
  const w = W[id];
  if (!w) return 'OP';
  if (w.mountType === 'aux') return 'OP';
  if (w.mountType === 'hangar') return 'MYŚL';
  if (w.mountType === 'special_missile' || w.category === 'superweapon') return 'SPEC';
  if (w.category === 'rocket' || w.category === 'torpedo') return 'RAKIETY';
  if (SNIPER.has(id)) return 'SNAJPER';
  const r = w.baseRange || 0;
  if (r <= 4500 && (CLOSE_CATS.has(w.category) || id === 'special_plasma_gatling' || r <= 3600)) return 'BLISKI';
  if (r <= 4500) return 'LINIA';
  return 'DALEKI';
}
const priceCache = new Map();
function priceOf(id) {
  if (MODULES[id]) return MODULES[id].price;
  if (SYSTEMS[id]) return SYSTEMS[id].price || 0;
  if (!priceCache.has(id)) priceCache.set(id, Math.round((weaponMaterialValue(W[id]) * 1.12) / 10) * 10);
  return priceCache.get(id);
}
const km = (m) => (m / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 });
const fmt = (v) => Math.round(v).toLocaleString('pl-PL');
const cr = (v) => `${fmt(v)} CR`;

const typeMapOf = (moduleId) => MODULES[moduleId]?.typeMap || null;
const effType = (hp, moduleId) => typeMapOf(moduleId)?.[hp.type] || hp.type;

// Kolejność gniazd: od dziobu, pary lustrzane (ten sam x, ±y) razem — braki zostawiają fit symetryczny.
function slotGroups(type) {
  const list = HARDPOINTS.filter((h) => h.type === type).sort((a, b) => (b.x - a.x) || (a.y - b.y));
  const out = [];
  const used = new Set();
  for (const h of list) {
    if (used.has(h.id)) continue;
    used.add(h.id);
    const mate = list.find((o) => !used.has(o.id) && Math.abs(o.x - h.x) < 1 && Math.abs(o.y + h.y) < 1 && Math.abs(h.y) > 1);
    if (mate) { used.add(mate.id); out.push([h, mate]); } else out.push([h]);
  }
  return out;
}
const GROUPS = Object.fromEntries(TYPE_ORDER.map((t) => [t, slotGroups(t)]));

// ---------------------------------------------------------------------------------------------
// Automat refitu (szkic fitPlanner): pula = hangar + zamontowane; tryb 'own' — zastępstwa, 'buy' — braki do kupienia
// ---------------------------------------------------------------------------------------------

function hasPart(id) {
  if (!id) return true;
  if (SYSTEMS[id]?.builtin) return true;
  return (state.parts.get(id) || 0) > 0 || state.module === id || state.system === id;
}

function planFit(preset, mounts, stock, mode) {
  const pool = new Map(stock);
  for (const id of mounts.values()) if (id) pool.set(id, (pool.get(id) || 0) + 1);
  const result = new Map();
  const subs = [];
  const empties = [];
  const buy = new Map();
  let fromHangar = 0;
  // Moduł i system: w trybie 'own' tylko posiadane (inaczej gniazdo modułu wolne, system — szarża z kadłuba).
  const module = mode === 'buy' || hasPart(preset.module) ? preset.module : null;
  const system = mode === 'buy' || hasPart(preset.system) ? preset.system : 'ram_burn';
  const avail = (id, n) => (pool.get(id) || 0) >= n;
  const take = (id, n) => pool.set(id, (pool.get(id) || 0) - n);
  for (const type of TYPE_ORDER) {
    const spec = preset.slots[type];
    if (!spec) continue;
    const eff = typeMapOf(module)?.[type] || type;
    const fits = (id) => W[id] && W[id].mountType === eff;
    const desired = [];
    for (const [id, n] of spec.want) for (let i = 0; i < n; i++) desired.push(id);
    let cursor = 0;
    for (const group of GROUPS[type]) {
      const n = group.length;
      const want = desired[Math.min(cursor, desired.length - 1)];
      cursor += n;
      if (mode === 'buy' && want && fits(want)) {
        for (const hp of group) {
          if (avail(want, 1)) { take(want, 1); fromHangar++; } else buy.set(want, (buy.get(want) || 0) + 1);
          result.set(hp.id, want);
        }
        continue;
      }
      let chosen = null;
      if (want && fits(want) && avail(want, n)) chosen = want;
      if (!chosen) chosen = (spec.alt || []).find((id) => fits(id) && avail(id, n)) || null;
      if (chosen) {
        take(chosen, n);
        fromHangar += n;
        for (const hp of group) result.set(hp.id, chosen);
        if (chosen !== want) subs.push({ want, used: chosen, n });
        continue;
      }
      // Para się nie domknie — gniazdo po gnieździe: preferencja, zastępstwa, cokolwiek pasującego z puli.
      for (const hp of group) {
        let one = null;
        if (want && fits(want) && avail(want, 1)) one = want;
        if (!one) one = (spec.alt || []).find((id) => fits(id) && avail(id, 1)) || null;
        if (!one) one = [...pool.keys()].find((id) => fits(id) && avail(id, 1)) || null;
        if (one) {
          take(one, 1);
          fromHangar++;
          result.set(hp.id, one);
          if (one !== want) subs.push({ want, used: one, n: 1 });
        } else {
          result.set(hp.id, null);
          empties.push({ want, hp: hp.id });
        }
      }
    }
  }
  const merged = new Map();
  for (const s of subs) {
    const key = `${s.want}|${s.used}`;
    const m = merged.get(key);
    if (m) m.n += s.n; else merged.set(key, { ...s });
  }
  const partsToBuy = [];
  if (mode === 'buy') {
    if (module && !hasPart(module)) partsToBuy.push(module);
    if (system && !hasPart(system)) partsToBuy.push(system);
  }
  let price = 0;
  for (const [id, n] of buy) price += priceOf(id) * n;
  for (const id of partsToBuy) price += priceOf(id);
  return {
    mode, mounts: result, stock: pool, subs: [...merged.values()], empties, buy, partsToBuy, price, fromHangar,
    module, system, preset
  };
}

// ---------------------------------------------------------------------------------------------
// Profil ognia i sumy (szkic fitStats)
// ---------------------------------------------------------------------------------------------

const STEP = 0.25;
const MAX_KM = 18;
const NPTS = Math.round(MAX_KM / STEP) + 1;

function statsOf(mounts, moduleId) {
  const guns = new Float32Array(NPTS);
  const miss = new Float32Array(NPTS);
  let maxGun = 0;
  let maxMiss = 0;
  let pd = 0;
  let pdRange = 0;
  const hangars = new Map();
  for (const hp of HARDPOINTS) {
    const id = mounts.get(hp.id);
    if (!id) continue;
    const w = W[id];
    const eff = effType(hp, moduleId);
    if (eff === 'aux') { pd++; pdRange = Math.max(pdRange, w.baseRange || 0); continue; }
    if (eff === 'hangar') { hangars.set(id, (hangars.get(id) || 0) + 1); continue; }
    if (eff === 'special_missile' || w.category === 'superweapon') continue;
    const r = rangeOf(id, moduleId);
    const d = dpsOf(id);
    const arr = eff === 'missile' ? miss : guns;
    if (eff === 'missile') maxMiss = Math.max(maxMiss, r); else maxGun = Math.max(maxGun, r);
    const last = Math.min(NPTS - 1, Math.floor(r / 1000 / STEP + 1e-6));
    for (let k = 0; k <= last; k++) arr[k] += d;
  }
  const at = (kmv) => {
    const k = Math.min(NPTS - 1, Math.round(kmv / STEP));
    return guns[k] + miss[k];
  };
  const shield = 18000 * (moduleId === 'shield_booster' ? 1.4 : 1);
  return { guns, miss, maxGun, maxMiss, pd, pdRange, hangars, at, shield };
}

// ---------------------------------------------------------------------------------------------
// Stan makiety
// ---------------------------------------------------------------------------------------------

const state = {
  mode: 'kits',
  credits: 1200,
  mounts: new Map(),
  stock: new Map(),
  parts: new Map(),
  module: null,
  system: 'ram_burn',
  presetId: 'universal',
  customs: [],
  selCard: -1,
  view: 'cards',
  sel: new Set(),
  symmetry: true,
  chipPd: true,
  hover: null
};
let UNIVERSAL_REF = null; // profil UNIWERSALNEJ z kompletami — przerywana linia w refit ręcznym

function resetState() {
  const m = MODES[state.mode];
  const stock = new Map(Object.entries(DEFAULT_STOCK));
  state.parts = new Map();
  if (m.kits) {
    for (const [id, n] of Object.entries(KITS)) stock.set(id, (stock.get(id) || 0) + n);
    for (const [id, n] of Object.entries(KIT_PARTS)) state.parts.set(id, n);
  }
  state.credits = m.credits;
  state.module = null;
  state.system = 'ram_burn';
  const plan = planFit(UNIVERSAL, new Map(), stock, 'own');
  state.mounts = plan.mounts;
  state.stock = plan.stock;
  state.presetId = 'universal';
  state.selCard = -1;
  state.sel.clear();
}

function presetById(id) {
  return PRESETS.find((p) => p.id === id) || state.customs.find((c) => c.id === id) || null;
}

function swapPart(kind, next) {
  const cur = state[kind];
  if (cur === next) return;
  if (cur && !SYSTEMS[cur]?.builtin) state.parts.set(cur, (state.parts.get(cur) || 0) + 1);
  if (next && !SYSTEMS[next]?.builtin) state.parts.set(next, Math.max(0, (state.parts.get(next) || 0) - 1));
  state[kind] = next;
}

function applyPlan(plan, label) {
  if (plan.price > 0) {
    if (plan.price > state.credits) { toast(`Za mało kredytów: ${cr(plan.price)} > ${cr(state.credits)}`); return; }
    state.credits -= plan.price;
    for (const id of plan.partsToBuy) state.parts.set(id, (state.parts.get(id) || 0) + 1);
  }
  state.mounts = plan.mounts;
  state.stock = plan.stock;
  swapPart('module', plan.module);
  swapPart('system', plan.system);
  state.presetId = plan.mode === 'own' && (plan.subs.length || plan.empties.length) ? 'custom' : plan.preset.id;
  state.selCard = -1;
  state.sel.clear();
  const bought = [...plan.buy.values()].reduce((s, n) => s + n, 0) + plan.partsToBuy.length;
  const subsN = plan.subs.reduce((s, x) => s + x.n, 0);
  toast(`Konfiguracja: ${label}${bought ? ` · kupiono ${bought} części za ${cr(plan.price)}` : ''}${subsN ? ` · zastępstwa ${subsN}` : ''}`);
  renderAll();
}

// ---------------------------------------------------------------------------------------------
// Rysowanie
// ---------------------------------------------------------------------------------------------

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const sprite = new Image();
sprite.src = atlasUrl;
sprite.onload = () => renderAll();

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
  for (const s of list) for (let k = 0; k < NPTS; k++) m = Math.max(m, s.guns[k] + s.miss[k]);
  const nice = [2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000];
  profileMax = nice.find((v) => v >= m * 1.05) || m * 1.1;
}

function drawProfile(cv, stats, acc, ref) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const x = (k) => (k / (NPTS - 1)) * (w - 2) + 1;
  const y = (v) => h - 1 - (v / profileMax) * (h - 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  for (const kmv of [5, 10, 15]) {
    const xx = Math.round(x(kmv / STEP)) + 0.5;
    ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, h); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, h - 0.5); ctx.lineTo(w, h - 0.5); ctx.stroke();
  const area = (top, bottom, fill) => {
    ctx.beginPath();
    ctx.moveTo(x(0), y(bottom ? bottom[0] : 0));
    for (let k = 0; k < NPTS; k++) ctx.lineTo(x(k), y(top[k]));
    for (let k = NPTS - 1; k >= 0; k--) ctx.lineTo(x(k), y(bottom ? bottom[k] : 0));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };
  const total = new Float32Array(NPTS);
  for (let k = 0; k < NPTS; k++) total[k] = stats.guns[k] + stats.miss[k];
  area(stats.guns, null, hexA(acc, 0.5));
  area(total, stats.guns, hexA(acc, 0.2));
  ctx.beginPath();
  for (let k = 0; k < NPTS; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(k), y(total[k]));
  ctx.strokeStyle = acc;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (ref) {
    ctx.beginPath();
    for (let k = 0; k < NPTS; k++) (k ? ctx.lineTo : ctx.moveTo).call(ctx, x(k), y(ref.guns[k] + ref.miss[k]));
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const axisHtml = '<span>0</span><span>5</span><span>10</span><span>15 km</span>';

function summarize(mounts) {
  const by = new Map();
  for (const hp of HARDPOINTS) {
    const id = mounts.get(hp.id) || null;
    if (!by.has(hp.type)) by.set(hp.type, new Map());
    const m = by.get(hp.type);
    m.set(id, (m.get(id) || 0) + 1);
  }
  return by;
}
function wantedIn(preset, type, id) {
  return !!preset.slots[type]?.want?.some(([w]) => w === id);
}
function loadoutLines(plan) {
  const lines = [];
  const by = summarize(plan.mounts);
  for (const type of ['main', 'special', 'missile', 'aux', 'hangar']) {
    const m = by.get(type);
    if (!m) continue;
    const parts = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (type === 'aux') {
      const total = parts.reduce((s, [, n]) => s + n, 0);
      const txt = parts.filter(([id]) => id).map(([id, n]) => `${n} ${nameOf(id)}`).join(', ');
      lines.push({ n: total, text: `OP: ${txt}`, r: '', cls: '' });
      continue;
    }
    for (const [id, n] of parts) {
      if (!id) { lines.push({ n, text: `puste — ${SLOT[type].label.toLowerCase()}`, r: '', cls: 'empty' }); continue; }
      const r = W[id]?.mountType === 'hangar' ? '' : `${km(rangeOf(id, plan.module))} km`;
      const cls = plan.buy.has(id) ? 'buy' : (!wantedIn(plan.preset, type, id) ? 'sub' : '');
      lines.push({ n, text: nameOf(id), r, cls });
    }
  }
  return lines;
}

function deltaHtml(a, b, unit = '%') {
  if (!(b > 0)) return a > 0 ? '<span class="d up">nowe</span>' : '<span class="d same">—</span>';
  const p = Math.round((a / b - 1) * 100);
  if (Math.abs(p) < 1) return '<span class="d same">±0</span>';
  return `<span class="d ${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}${unit}</span>`;
}

function renderStatus() {
  const cur = presetById(state.presetId);
  const filled = HARDPOINTS.filter((h) => state.mounts.get(h.id)).length;
  const s = statsOf(state.mounts, state.module);
  $('#status').innerHTML = `
    <span class="ship">ATLAS</span>
    <span class="cfg">${cur ? cur.name : 'WŁASNA'}</span>
    <span class="kv">kadłub <b>100%</b></span>
    <span class="kv">gniazda <b>${filled}/${HARDPOINTS.length}</b></span>
    <span class="kv">moduł <b>${state.module ? MODULES[state.module].label : 'wolny'}</b></span>
    <span class="kv">F <b>${SYSTEMS[state.system].label}</b></span>
    <span class="kv">tarcza <b>${fmt(s.shield)}</b></span>
    <span class="grow"></span>
    <button class="btn" disabled>NAPRAW · 0 CR</button>
    <button class="btn" id="btn-ammo">UZUPEŁNIJ AMUNICJĘ</button>`;
  $('#btn-ammo').onclick = () => toast('Amunicja uzupełniona');
  $('#credits').textContent = cr(state.credits);
}

function slotsWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (n === 1) return '1 gniazdo';
  if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return `${n} gniazda`;
  return `${n} gniazd`;
}
function partsWord(n) {
  const d = n % 10;
  const dd = n % 100;
  if (n === 1) return '1 część';
  if (d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14)) return `${n} części`;
  return `${n} części`;
}

let cardPlans = [];
function renderCards() {
  const cur = statsOf(state.mounts, state.module);
  cardPlans = PRESETS.map((p) => ({ buy: planFit(p, state.mounts, state.stock, 'buy'), own: planFit(p, state.mounts, state.stock, 'own') }));
  const planStats = cardPlans.map((pl) => statsOf(pl.buy.mounts, pl.buy.module));
  computeProfileMax([cur, ...planStats]);
  const root = $('#cards');
  root.innerHTML = '';
  root.classList.toggle('has-sel', state.selCard >= 0);
  PRESETS.forEach((p, i) => {
    const { buy, own } = cardPlans[i];
    const st = planStats[i];
    const active = state.presetId === p.id;
    const toBuy = [...buy.buy.values()].reduce((s, n) => s + n, 0) + buy.partsToBuy.length;
    const card = el('div', `card${state.selCard === i ? ' sel' : ''}`);
    card.style.setProperty('--acc', p.acc);
    const lines = loadoutLines(buy).slice(0, 7);
    const sys = SYSTEMS[p.system];
    const ownSubs = own.subs.reduce((s, x) => s + x.n, 0) + own.empties.length;
    const canPay = buy.price <= state.credits;
    let foot;
    if (active && !toBuy) {
      foot = `<span class="avail">W HANGARZE <b>${HARDPOINTS.length}/${HARDPOINTS.length}</b></span><button class="btn primary" disabled>ZAŁOŻONA</button>`;
    } else if (!toBuy) {
      foot = `<span class="avail">W HANGARZE <b>${HARDPOINTS.length}/${HARDPOINTS.length}</b> · 0 CR</span><button class="btn primary" data-act="buy">ZASTOSUJ</button>`;
    } else if (active) {
      // Karta założona z zastępstwami (np. start bez kompletów) — dokup brakujące części.
      foot = `<span class="avail">NIEPEŁNA · DO KUPIENIA <b>${partsWord(toBuy)}</b><br><span class="${canPay ? 'price' : 'warn'}">${cr(buy.price)}</span>${canPay ? '' : ' · za mało kredytów'}</span>
        <button class="btn primary" data-act="buy" ${canPay ? '' : 'disabled'}>UZUPEŁNIJ</button>`;
    } else {
      foot = `<span class="avail">W HANGARZE <b>${buy.fromHangar}/${HARDPOINTS.length}</b> · DO KUPIENIA <b>${partsWord(toBuy)}</b><br><span class="${canPay ? 'price' : 'warn'}">${cr(buy.price)}</span>${canPay ? '' : ' · za mało kredytów'}</span>
        <span class="btns"><button class="btn" data-act="own" title="złóż z tego, co jest w hangarze — ${ownSubs} zastępstw">Z MAGAZYNU</button><button class="btn primary" data-act="buy" ${canPay ? '' : 'disabled'}>KUP</button></span>`;
    }
    card.innerHTML = `
      <div class="card-head"><span class="card-name">${p.name}</span>${active ? '<span class="card-tag">AKTYWNA</span>' : (p.start ? '<span class="card-tag later">START</span>' : '')}</div>
      <div class="card-role">${p.role}</div>
      <div class="profile-wrap"><canvas class="profile"></canvas><div class="axis">${axisHtml}</div></div>
      <div class="chips"><span class="chip"><i>F</i>${sys.label}</span><span class="chip"><i>MODUŁ</i>${p.module ? MODULES[p.module].label : 'wolny'}</span></div>
      <div class="stats">
        <div class="stat"><span class="k">OGIEŃ DO 3 KM</span><span class="v">${fmt(st.at(3))}</span>${deltaHtml(st.at(3), cur.at(3))}</div>
        <div class="stat"><span class="k">OGIEŃ NA 9 KM</span><span class="v">${fmt(st.at(9))}</span>${deltaHtml(st.at(9), cur.at(9))}</div>
        <div class="stat"><span class="k">ZASIĘG DZIAŁ</span><span class="v">${km(st.maxGun)} km</span>${deltaHtml(st.maxGun, cur.maxGun)}</div>
        <div class="stat"><span class="k">TARCZA</span><span class="v">${fmt(st.shield)}</span>${deltaHtml(st.shield, cur.shield)}</div>
      </div>
      <ul class="loadout">${lines.map((l) => `<li class="${l.cls}"><b>${l.n}×</b><span>${l.text}</span><i>${l.r}</i></li>`).join('')}</ul>
      <div class="fitmap"><canvas></canvas><span class="fitmap-k">${slotsWord(changedCount(buy))} do przezbrojenia${toBuy ? ` · <span class="buy-k">■</span> do kupienia` : ''}</span></div>
      <div class="card-foot">${foot}</div>`;
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (btn) {
        if (btn.dataset.act === 'buy') applyPlan(buy, p.name);
        else if (btn.dataset.act === 'own') applyPlan(own, `${p.name} (z magazynu)`);
        return;
      }
      state.selCard = state.selCard === i ? -1 : i;
      renderCards();
      renderDiff();
    });
    root.appendChild(card);
    drawProfile(card.querySelector('canvas.profile'), st, p.acc, cur);
    drawFitMap(card.querySelector('.fitmap canvas'), buy, p.acc);
  });
  // Kafel REFIT RĘCZNY
  const tile = el('div', 'card refit');
  tile.innerHTML = `
    <div class="card-head"><span class="card-name">REFIT RĘCZNY</span></div>
    <div class="card-role">broń gniazdo po gnieździe · moduł · system F · chipy</div>
    <canvas class="mini"></canvas>
    <ul>
      <li>gniazda <b>${HARDPOINTS.length}</b> · obsadzone <b>${HARDPOINTS.filter((h) => state.mounts.get(h.id)).length}</b></li>
      <li>w hangarze <b>${[...state.stock.values()].reduce((s, n) => s + Math.max(0, n), 0)}</b> szt. broni</li>
      <li>moduły w hangarze <b>${[...state.parts.entries()].filter(([id, n]) => MODULES[id] && n > 0).length}</b></li>
      ${state.customs.length ? `<li>własne: ${state.customs.map((c) => `<b data-custom="${c.id}" style="cursor:pointer;color:#fff">${c.name}</b>`).join(' · ')}</li>` : ''}
    </ul>
    <div class="grow"></div>
    <button class="btn primary">OTWÓRZ<span class="key">  [R]</span></button>`;
  tile.querySelector('button').onclick = () => setView('manual');
  tile.querySelectorAll('[data-custom]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const c = state.customs.find((x) => x.id === b.dataset.custom);
      if (c) applyPlan(planFit(c, state.mounts, state.stock, 'own'), c.name);
    };
  });
  root.appendChild(tile);
  drawMini(tile.querySelector('canvas'));
}

function renderDiff() {
  const box = $('#diff');
  const i = state.selCard;
  if (i < 0) {
    box.className = 'diff idle';
    box.innerHTML = `<div class="diff-title">ZMIANY</div><div class="diff-rows"><div>Wybierz kartę — tu pojawi się, co zostanie zdjęte, założone i kupione.</div></div><div class="diff-actions"></div>`;
    return;
  }
  const p = PRESETS[i];
  const { buy, own } = cardPlans[i];
  box.className = 'diff';
  const before = summarize(state.mounts);
  const after = summarize(buy.mounts);
  const rows = [];
  const desc = (m) => [...m.entries()].filter(([id]) => id).sort((a, b) => b[1] - a[1]).map(([id, n]) => `${n}× ${nameOf(id)}`).join(', ') || 'puste';
  for (const type of TYPE_ORDER) {
    const a = desc(before.get(type) || new Map());
    const b = desc(after.get(type) || new Map());
    const label = type === 'special' && buy.module === 'missile_cells' ? 'BATERIA→WYRZ.' : SLOT[type].label;
    if (a === b) { rows.push(`<div><span class="g">${label}</span><span class="same">bez zmian</span></div>`); continue; }
    rows.push(`<div><span class="g">${label}</span><span class="from">${a}</span> → <span class="to">${b}</span></div>`);
  }
  const modA = state.module ? MODULES[state.module].label : 'wolny';
  const modB = buy.module ? MODULES[buy.module].label : 'wolny';
  rows.push(`<div><span class="g">MODUŁ</span>${modA === modB ? '<span class="same">bez zmian</span>' : `<span class="from">${modA}</span> → <span class="to">${modB}</span>`}</div>`);
  rows.push(`<div><span class="g">SYSTEM F</span>${state.system === buy.system ? '<span class="same">bez zmian</span>' : `<span class="from">${SYSTEMS[state.system].label}</span> → <span class="to">${SYSTEMS[buy.system].label}</span>`}</div>`);
  const buyTxt = [...buy.buy.entries()].sort((a, b) => b[1] * priceOf(b[0]) - a[1] * priceOf(a[0]))
    .map(([id, n]) => `${n}× ${nameOf(id)} ${cr(priceOf(id) * n)}`)
    .concat(buy.partsToBuy.map((id) => `${(MODULES[id] || SYSTEMS[id]).label} ${cr(priceOf(id))}`)).join(', ');
  const subsTxt = own.subs.slice().sort((a, b) => b.n - a.n).map((s) => `${s.n}× ${nameOf(s.used)} zamiast ${nameOf(s.want)}`).join(', ');
  const toBuy = [...buy.buy.values()].reduce((s, n) => s + n, 0) + buy.partsToBuy.length;
  const canPay = buy.price <= state.credits;
  box.innerHTML = `
    <div class="diff-title">ZMIANY · <b>${p.name}</b>${toBuy ? ` · <span class="buys">do kupienia (${cr(buy.price)}): ${buyTxt}</span>` : ' · <span class="same">wszystko w hangarze</span>'}</div>
    ${toBuy && subsTxt ? `<div class="diff-title">Z MAGAZYNU zamiast kupować: <span class="subs">${subsTxt}</span>${own.module !== buy.module ? ' · <span class="subs">moduł wolny</span>' : ''}</div>` : ''}
    <div class="diff-rows">${rows.join('')}</div>
    <div class="diff-actions"><button class="btn" id="d-cancel">ANULUJ</button>${toBuy && state.presetId !== p.id ? '<button class="btn" id="d-own">Z MAGAZYNU</button>' : ''}<button class="btn primary" id="d-apply" ${(state.presetId === p.id && !toBuy) || !canPay ? 'disabled' : ''}>${toBuy ? `${state.presetId === p.id ? 'UZUPEŁNIJ' : 'KUP I ZASTOSUJ'} · ${cr(buy.price)}` : 'ZASTOSUJ  [ENTER]'}</button></div>`;
  $('#d-cancel').onclick = () => { state.selCard = -1; renderCards(); renderDiff(); };
  $('#d-apply').onclick = () => applyPlan(buy, p.name);
  const ownBtn = $('#d-own');
  if (ownBtn) ownBtn.onclick = () => applyPlan(own, `${p.name} (z magazynu)`);
}

// --- sylwetka --------------------------------------------------------------------------------

function hullLayout(w, h, pad = 18) {
  const s = Math.min((w - pad * 2) / SPRITE_W, (h - pad * 2) / SPRITE_H);
  return { s, cx: w / 2, cy: h / 2 };
}
function drawHullInto(ctx, w, h, opts) {
  const { s, cx, cy } = hullLayout(w, h, opts.pad ?? 18);
  if (sprite.complete && sprite.naturalWidth) {
    ctx.globalAlpha = opts.spriteAlpha ?? 0.8;
    ctx.drawImage(sprite, cx - (SPRITE_W * s) / 2, cy - (SPRITE_H * s) / 2, SPRITE_W * s, SPRITE_H * s);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(3, 5, 8, 0.38)';
    ctx.fillRect(cx - (SPRITE_W * s) / 2, cy - (SPRITE_H * s) / 2, SPRITE_W * s, SPRITE_H * s);
  }
  const r = opts.r ?? Math.max(4, Math.min(10, 3200 * s / 100));
  const pts = [];
  for (const hp of HARDPOINTS) {
    const x = cx + hp.x * s;
    const y = cy + hp.y * s;
    const eff = effType(hp, state.module);
    const id = state.mounts.get(hp.id);
    const col = SLOT[eff].color;
    pts.push({ hp, x, y });
    if (opts.sel?.has(hp.id)) {
      ctx.beginPath(); ctx.arc(x, y, r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 2; ctx.shadowColor = '#ff6600'; ctx.shadowBlur = 10; ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (id) {
      ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.fillStyle = 'rgba(3,5,8,0.85)'; ctx.fill();
      if (opts.bands) { ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2); ctx.strokeStyle = BAND[bandOf(id)]; ctx.lineWidth = 1.5; ctx.stroke(); }
    } else {
      ctx.setLineDash([2, 2]); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    if (opts.hover === hp.id) { ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
  }
  return { pts, r };
}
function drawMini(cv) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  drawHullInto(ctx, w, h, { pad: 4, r: 3.2, spriteAlpha: 0.7 });
}

// Karta: które gniazda automat przezbroi (barwa karty), które zostają (szare), które trzeba dokupić (biała obwódka),
// które zostaną puste (czerwony obrys).
function changedCount(plan) {
  let n = 0;
  for (const hp of HARDPOINTS) if ((plan.mounts.get(hp.id) || null) !== (state.mounts.get(hp.id) || null)) n++;
  return n;
}
function drawFitMap(cv, plan, acc) {
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  if (w < 20 || h < 20) return;
  const { s, cx, cy } = hullLayout(w, h, 4);
  if (sprite.complete && sprite.naturalWidth) {
    ctx.globalAlpha = 0.5;
    ctx.drawImage(sprite, cx - (SPRITE_W * s) / 2, cy - (SPRITE_H * s) / 2, SPRITE_W * s, SPRITE_H * s);
    ctx.globalAlpha = 1;
  }
  const r = Math.max(2.4, Math.min(4.5, 1500 * s / 100));
  // Które gniazda dostaną kupione sztuki: kolejno po gniazdach z bronią z listy zakupów (ile sztuk, tyle gniazd).
  const left = new Map(plan.buy);
  for (const hp of HARDPOINTS) {
    const to = plan.mounts.get(hp.id) || null;
    const from = state.mounts.get(hp.id) || null;
    const x = cx + hp.x * s;
    const y = cy + hp.y * s;
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

let hullPts = [];
function renderHull() {
  const cv = $('#hull');
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const res = drawHullInto(ctx, w, h, { sel: state.sel, hover: state.hover, bands: true });
  hullPts = res.pts.map((p) => ({ ...p, r: res.r }));
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.fillText('DZIÓB →', w - 10, 16);
  ctx.textAlign = 'left';
  ctx.fillText('LEWA BURTA', 10, 16);
  ctx.fillText('PRAWA BURTA', 10, h - 8);
}

const selType = () => {
  const first = [...state.sel][0];
  if (!first) return null;
  return effType(HARDPOINTS.find((h) => h.id === first), state.module);
};
const mirrorOf = (hp) => HARDPOINTS.find((o) => o.id !== hp.id && o.type === hp.type && Math.abs(o.x - hp.x) < 1 && Math.abs(o.y + hp.y) < 1);

function toggleSlot(hp, additive) {
  const eff = effType(hp, state.module);
  if (selType() && selType() !== eff) state.sel.clear();
  const ids = [hp.id];
  if (state.symmetry) { const m = mirrorOf(hp); if (m) ids.push(m.id); }
  const on = state.sel.has(hp.id);
  if (!additive) { state.sel.clear(); for (const id of ids) state.sel.add(id); }
  else for (const id of ids) on ? state.sel.delete(id) : state.sel.add(id);
  renderManual();
}

function renderTools() {
  const root = $('#tools');
  root.innerHTML = '';
  const cur = selType();
  for (const t of TYPE_ORDER) {
    const n = HARDPOINTS.filter((h) => effType(h, state.module) === t).length;
    if (!n) continue;
    const b = el('button', `seg${cur === t && [...state.sel].length === n ? ' on' : ''}`, `${SLOT[t].label}<span class="n">${n}</span>`);
    b.onclick = () => { state.sel.clear(); HARDPOINTS.filter((h) => effType(h, state.module) === t).forEach((h) => state.sel.add(h.id)); renderManual(); };
    root.appendChild(b);
  }
  root.appendChild(el('span', 'sep'));
  const sym = el('button', `seg${state.symmetry ? ' on' : ''}`, 'SYMETRIA');
  sym.onclick = () => { state.symmetry = !state.symmetry; renderTools(); };
  root.appendChild(sym);
  const side = (label, pred) => {
    const b = el('button', 'seg', label);
    b.onclick = () => {
      const t = selType() || 'main';
      state.sel.clear();
      HARDPOINTS.filter((h) => effType(h, state.module) === t && pred(h)).forEach((h) => state.sel.add(h.id));
      renderManual();
    };
    root.appendChild(b);
  };
  side('LEWA BURTA', (h) => h.y < -1);
  side('PRAWA BURTA', (h) => h.y > 1);
  side('PUSTE', (h) => !state.mounts.get(h.id));
  const clr = el('button', 'seg', 'WYCZYŚĆ');
  clr.onclick = () => { state.sel.clear(); renderManual(); };
  root.appendChild(clr);
}

function renderLegend() {
  const root = $('#legend');
  const types = TYPE_ORDER.filter((t) => HARDPOINTS.some((h) => effType(h, state.module) === t));
  root.innerHTML = types.map((t) => `<span style="--c:${SLOT[t].color}">${SLOT[t].label.toLowerCase()}</span>`).join('')
    + '<span class="empty">puste gniazdo</span>'
    + '<span style="--c:#ff6600">zaznaczone</span>'
    + '<span class="note">środek kropki — pasmo zasięgu broni</span>';
}

function renderWeaponList() {
  const head = $('#sel-head');
  const list = $('#wlist');
  const t = selType();
  const n = state.sel.size;
  if (!t) {
    head.innerHTML = 'Kliknij gniazdo na sylwetce (Shift — kilka, SYMETRIA — z gniazdem lustrzanym) albo grupę nad sylwetką.';
    list.innerHTML = '';
    return;
  }
  head.innerHTML = `ZAZNACZONE: <b>${n} × ${SLOT[t].label}</b> · brakujące sztuki kupowane przy montażu`;
  const ids = Object.keys(W).filter((id) => W[id].mountType === t && id !== 'fighter_bay')
    .sort((a, b) => (rangeOf(a, state.module) || 0) - (rangeOf(b, state.module) || 0));
  const selIds = [...state.sel].map((id) => state.mounts.get(id));
  const rows = [`<div class="wrow head"><span>BROŃ</span><span>PASMO</span><span class="num">ZASIĘG</span><span class="num">DPS</span><span class="cnt">HANGAR</span><span class="num">CENA</span></div>`];
  for (const id of ids) {
    const have = state.stock.get(id) || 0;
    const cur = selIds.length && selIds.every((x) => x === id);
    const band = bandOf(id);
    const isHangar = W[id].mountType === 'hangar';
    rows.push(`<div class="wrow${cur ? ' cur' : ''}${EXTRA[id] ? ' new' : ''}" data-id="${id}">
      <span class="nm">${nameOf(id)}${EXTRA[id] ? ' <em>nowa</em>' : ''}</span>
      <span class="band" style="--bc:${BAND[band]}">${band}</span>
      <span class="num">${isHangar ? '—' : `${km(rangeOf(id, state.module))} km`}</span>
      <span class="num">${isHangar ? '—' : fmt(dpsOf(id))}</span>
      <span class="cnt">${have > 0 ? `×${have}` : '0'}</span>
      <span class="num price">${fmt(priceOf(id))}</span></div>`);
  }
  const unmount = `<div class="wrow" data-id=""><span class="nm" style="color:var(--red)">ZDEJMIJ Z ZAZNACZONYCH</span><span></span><span></span><span></span><span></span><span></span></div>`;
  list.innerHTML = rows.join('') + unmount;
  list.querySelectorAll('.wrow[data-id]').forEach((row) => {
    row.onclick = () => mountSelected(row.dataset.id || null);
  });
}

function mountSelected(id) {
  const targets = [...state.sel].filter((hpId) => (state.mounts.get(hpId) || null) !== id);
  if (!targets.length) return;
  if (!id) {
    for (const hpId of targets) {
      const cur = state.mounts.get(hpId);
      if (cur) state.stock.set(cur, (state.stock.get(cur) || 0) + 1);
      state.mounts.set(hpId, null);
    }
    state.presetId = 'custom';
    toast(`Zdjęto ${targets.length} — wróciły do hangaru`);
    renderManual();
    return;
  }
  const have = state.stock.get(id) || 0;
  const missing = Math.max(0, targets.length - have);
  const cost = missing * priceOf(id);
  let canBuy = missing;
  if (cost > state.credits) canBuy = Math.floor(state.credits / priceOf(id));
  const total = Math.min(targets.length, have + canBuy);
  if (canBuy > 0) {
    state.credits -= canBuy * priceOf(id);
    state.stock.set(id, have + canBuy);
  }
  for (let i = 0; i < total; i++) {
    const hpId = targets[i];
    const cur = state.mounts.get(hpId);
    if (cur) state.stock.set(cur, (state.stock.get(cur) || 0) + 1);
    state.stock.set(id, state.stock.get(id) - 1);
    state.mounts.set(hpId, id);
  }
  state.presetId = 'custom';
  toast(`Zamontowano ${total}× ${nameOf(id)}${canBuy ? ` · kupiono ${canBuy} za ${cr(canBuy * priceOf(id))}` : ''}${total < targets.length ? ` · ${targets.length - total} bez sztuk (kredyty)` : ''}`);
  renderManual();
}

function partTag(id) {
  if (!id) return '';
  if (SYSTEMS[id]?.builtin) return 'w kadłubie';
  if (state.module === id || state.system === id) return 'założony';
  if ((state.parts.get(id) || 0) > 0) return 'w hangarze';
  return cr(priceOf(id));
}

function renderOptions() {
  const mod = $('#opt-module');
  mod.innerHTML = '';
  for (const id of [null, ...Object.keys(MODULES)]) {
    const b = el('button', `opt${state.module === id ? ' on' : ''}`, id
      ? `${MODULES[id].label} <span class="tag">${partTag(id)}</span><small>${MODULES[id].desc}</small>`
      : 'WOLNE<small>bez modułu</small>');
    b.onclick = () => setModule(id);
    mod.appendChild(b);
  }
  const sys = $('#opt-system');
  sys.innerHTML = '';
  for (const [id, s] of Object.entries(SYSTEMS)) {
    const b = el('button', `opt${state.system === id ? ' on' : ''}`, `${s.label} <span class="tag">${partTag(id)}</span><small>${s.desc}</small>`);
    b.onclick = () => {
      if (state.system === id) return;
      if (!hasPart(id)) {
        if (priceOf(id) > state.credits) { toast('Za mało kredytów'); return; }
        state.credits -= priceOf(id);
        state.parts.set(id, (state.parts.get(id) || 0) + 1);
        toast(`Kupiono: ${s.label} · ${cr(priceOf(id))}`);
      }
      swapPart('system', id);
      state.presetId = 'custom';
      renderManual();
    };
    sys.appendChild(b);
  }
  const chips = $('#opt-chips');
  chips.innerHTML = '';
  const c = el('button', `opt${state.chipPd ? ' on' : ''}`, `PD CHIP<small>${state.chipPd ? 'zainstalowany · OP strzela też do kadłubów' : '900 CR · OP strzela też do kadłubów'}</small>`);
  c.onclick = () => { state.chipPd = !state.chipPd; renderOptions(); };
  chips.appendChild(c);
}

function setModule(id) {
  if (state.module === id) return;
  if (id && !hasPart(id)) {
    if (priceOf(id) > state.credits) { toast('Za mało kredytów'); return; }
    state.credits -= priceOf(id);
    state.parts.set(id, (state.parts.get(id) || 0) + 1);
    toast(`Kupiono: ${MODULES[id].label} · ${cr(priceOf(id))}`);
  }
  const prevMap = typeMapOf(state.module);
  const nextMap = typeMapOf(id);
  let returned = 0;
  for (const hp of HARDPOINTS) {
    const a = prevMap?.[hp.type] || hp.type;
    const b = nextMap?.[hp.type] || hp.type;
    if (a === b) continue;
    const cur = state.mounts.get(hp.id);
    if (cur) { state.stock.set(cur, (state.stock.get(cur) || 0) + 1); state.mounts.set(hp.id, null); returned++; }
  }
  swapPart('module', id);
  state.presetId = 'custom';
  state.sel.clear();
  if (returned) toast(`${id ? MODULES[id].label : 'Bez modułu'}: ${returned} gniazd zmieniło typ — broń wróciła do hangaru`);
  renderManual();
}

function renderBottom() {
  const s = statsOf(state.mounts, state.module);
  computeProfileMax([s, UNIVERSAL_REF]);
  drawProfile($('#m-profile'), s, '#ff6600', UNIVERSAL_REF);
  $('#m-axis').innerHTML = axisHtml;
  const hang = [...s.hangars.entries()].map(([id, n]) => `${n} ${nameOf(id).replace('Eskadra ', '').slice(0, 7)}.`).join(', ') || '—';
  $('#sums').innerHTML = `
    <div><span>OGIEŃ DO 3 KM</span><b>${fmt(s.at(3))}</b></div>
    <div><span>NA 9 KM</span><b>${fmt(s.at(9))}</b></div>
    <div><span>NA 12 KM</span><b>${fmt(s.at(12))}</b></div>
    <div><span>ZASIĘG DZIAŁ</span><b>${km(s.maxGun)} km</b></div>
    <div><span>OBRONA PKT.</span><b>${s.pd} luf · do ${km(s.pdRange)} km</b></div>
    <div><span>TARCZA</span><b>${fmt(s.shield)}</b></div>
    <div><span>RAKIETY</span><b>${s.maxMiss ? `do ${km(s.maxMiss)} km` : '—'}</b></div>
    <div><span>MYŚLIWCE</span><b>${hang}</b></div>
    <div><span>KREDYTY</span><b>${cr(state.credits)}</b></div>`;
}

function renderManual() {
  if (state.view !== 'manual') return;
  renderTools();
  renderHull();
  renderLegend();
  renderWeaponList();
  renderOptions();
  renderBottom();
  renderStatus();
}

function renderAll() {
  renderStatus();
  if (state.view === 'cards') { renderCards(); renderDiff(); } else renderManual();
}

function setView(v) {
  state.view = v;
  $('#view-cards').classList.toggle('on', v === 'cards');
  $('#view-manual').classList.toggle('on', v === 'manual');
  requestAnimationFrame(renderAll);
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---------------------------------------------------------------------------------------------
// Zdarzenia
// ---------------------------------------------------------------------------------------------

const hullCv = $('#hull');
const tip = $('#tip');
function pickSlot(ev) {
  const r = hullCv.getBoundingClientRect();
  const x = ev.clientX - r.left;
  const y = ev.clientY - r.top;
  let best = null;
  let bd = Infinity;
  for (const p of hullPts) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bd && d <= p.r + 6) { bd = d; best = p; }
  }
  return { best, x, y };
}
hullCv.addEventListener('mousemove', (ev) => {
  const { best, x, y } = pickSlot(ev);
  const id = best?.hp.id || null;
  if (id !== state.hover) { state.hover = id; renderHull(); }
  if (!best) { tip.style.display = 'none'; return; }
  const hp = best.hp;
  const eff = effType(hp, state.module);
  const wid = state.mounts.get(hp.id);
  const side = hp.y < -1 ? 'lewa burta' : hp.y > 1 ? 'prawa burta' : 'oś';
  tip.innerHTML = `<div class="t1">${SLOT[eff].label} · ${side}</div>${wid
    ? `${nameOf(wid)}${W[wid].mountType === 'hangar' ? '' : ` · ${km(rangeOf(wid, state.module))} km · ${fmt(dpsOf(wid))} DPS`}`
    : '<span style="color:var(--muted)">puste</span>'}`;
  tip.style.display = 'block';
  const wrap = hullCv.parentElement.getBoundingClientRect();
  tip.style.left = `${Math.min(x + 14, wrap.width - tip.offsetWidth - 4)}px`;
  tip.style.top = `${Math.max(4, y - 44)}px`;
});
hullCv.addEventListener('mouseleave', () => { tip.style.display = 'none'; state.hover = null; renderHull(); });
hullCv.addEventListener('click', (ev) => {
  const { best } = pickSlot(ev);
  if (best) toggleSlot(best.hp, ev.shiftKey || ev.ctrlKey);
});

$('#btn-back').onclick = () => setView('cards');
$('#btn-save').onclick = () => {
  if (state.customs.length >= 2) { toast('Najwyżej 2 własne konfiguracje (D9) — makieta'); return; }
  const n = state.customs.length + 1;
  const want = {};
  for (const t of TYPE_ORDER) {
    const list = GROUPS[t].flat().map((hp) => state.mounts.get(hp.id)).filter(Boolean);
    const counts = [];
    for (const id of list) { const last = counts[counts.length - 1]; if (last && last[0] === id) last[1]++; else counts.push([id, 1]); }
    want[t] = { want: counts };
  }
  state.customs.push({ id: `own${n}`, name: `WŁASNA ${n}`, module: state.module, system: state.system, slots: want });
  state.presetId = `own${n}`;
  toast(`Zapisano jako WŁASNA ${n} — widoczna w kaflu REFIT RĘCZNY`);
  renderAll();
};

document.querySelectorAll('.mock-bar [data-mode]').forEach((b) => {
  b.onclick = () => {
    state.mode = b.dataset.mode;
    document.querySelectorAll('.mock-bar [data-mode]').forEach((x) => x.classList.toggle('on', x === b));
    resetState();
    renderAll();
    toast(state.mode === 'kits'
      ? 'Misja startowa: komplety wszystkich kart w hangarze — przełączanie za darmo'
      : 'Później (inny kadłub, straty): bez kompletów, 150 000 CR — karty pokazują ceny braków');
  };
});

window.addEventListener('keydown', (e) => {
  if (state.view === 'cards') {
    if (e.code === 'ArrowRight') { state.selCard = Math.min(PRESETS.length - 1, state.selCard + 1); renderCards(); renderDiff(); }
    else if (e.code === 'ArrowLeft') { state.selCard = Math.max(0, (state.selCard < 0 ? 1 : state.selCard) - 1); renderCards(); renderDiff(); }
    else if (e.code === 'Enter' && state.selCard >= 0) {
      const p = PRESETS[state.selCard];
      const plan = cardPlans[state.selCard]?.buy;
      if (plan && state.presetId !== p.id && plan.price <= state.credits) applyPlan(plan, p.name);
    }
    else if (e.code === 'KeyR') setView('manual');
    else if (e.code === 'Escape' && state.selCard >= 0) { state.selCard = -1; renderCards(); renderDiff(); }
  } else if (e.code === 'Escape') setView('cards');
});

new ResizeObserver(() => renderAll()).observe($('.screen'));

{
  const stock = new Map(Object.entries(DEFAULT_STOCK));
  for (const [id, n] of Object.entries(KITS)) stock.set(id, (stock.get(id) || 0) + n);
  UNIVERSAL_REF = statsOf(planFit(UNIVERSAL, new Map(), stock, 'own').mounts, null);
}
resetState();
renderAll();
