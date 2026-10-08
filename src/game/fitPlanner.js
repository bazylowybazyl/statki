// src/game/fitPlanner.js
//
// AUTOMAT REFITU (docs/PLAN-fitowanie.md § 4.5) — z konfiguracji (src/data/fitPresets.js), gniazd kadłuba i hangaru
// gracza liczy PLAN: co gdzie założyć, czego brakuje, ile to kosztuje. Czysty moduł: gry dotyka tylko przez funkcje
// z argumentu (rozmiar gniazda, ceny, posiadane części) — wykonanie planu robi index.html (applyFitPlan).
//
// Dwa tryby (decyzja D2 użytkownika: „jeśli ma w hangarze to free, lub mniej kasy — tyle, ile części ma”):
//   'buy' — pełna karta: każde gniazdo dostaje broń z przepisu; czego nie ma w hangarze, idzie na listę zakupów
//           (bez zastępstw); moduł i system F też (gdy ich nie ma).
//   'own' — „Z MAGAZYNU”: tylko to, co jest w hangarze; brak → zastępstwo z listy `alt`, potem cokolwiek pasującego,
//           gniazdo puste dopiero, gdy nic nie pasuje. Moduł / system F — tylko posiadane.
// Pula = hangar + WSZYSTKO, co już wisi w gniazdach (zdjęte wraca do puli przed rozdziałem), więc przejście karta A →
// B → A wraca do tego samego stanu, a niezmiennik „hangar + zamontowane = const” trzyma się w trybie 'own'.
// Kolejność gniazd: typ po typie, od dziobu (oś +x sprite'a), pary lustrzane (ten sam x, ±y) razem — przy brakach fit
// zostaje symetryczny.

const TYPE_ORDER = Object.freeze(['main', 'special', 'missile', 'aux', 'hangar', 'special_missile', 'builtin']);
export const FIT_SLOT_TYPES = TYPE_ORDER;

const PAIR_EPS = 0.75;

function posOf(hp) {
  return { x: Number(hp?.pos?.x ?? hp?.x) || 0, y: Number(hp?.pos?.y ?? hp?.y) || 0 };
}

/**
 * Gniazda typu `type` (bazowego) w kolejności automatu: od dziobu, pary lustrzane razem.
 * @returns {Array<Array<object>>} grupy po 1–2 gniazda
 */
export function orderFitSlots(hardpoints, type) {
  const list = (hardpoints || []).filter((hp) => hp && hp.type === type && !hp.destroyed);
  list.sort((a, b) => {
    const pa = posOf(a);
    const pb = posOf(b);
    return (pb.x - pa.x) || (pa.y - pb.y);
  });
  const used = new Set();
  const out = [];
  for (const hp of list) {
    if (used.has(hp)) continue;
    used.add(hp);
    const p = posOf(hp);
    let mate = null;
    if (Math.abs(p.y) > PAIR_EPS) {
      mate = list.find((o) => {
        if (used.has(o)) return false;
        const q = posOf(o);
        return Math.abs(q.x - p.x) < PAIR_EPS && Math.abs(q.y + p.y) < PAIR_EPS;
      }) || null;
    }
    if (mate) {
      used.add(mate);
      out.push([hp, mate]);
    } else {
      out.push([hp]);
    }
  }
  return out;
}

function toMap(stock) {
  if (stock instanceof Map) return new Map(stock);
  const out = new Map();
  if (stock && typeof stock.entries === 'function' && !(Array.isArray(stock))) {
    for (const [id, n] of stock.entries()) out.set(id, Number(n) || 0);
    return out;
  }
  for (const [id, n] of Object.entries(stock || {})) out.set(id, Number(n) || 0);
  return out;
}

/**
 * Plan konfiguracji na gniazdach kadłuba.
 * @param {object} o
 * @param {object[]} o.hardpoints   gniazda: { id, type (bazowy), pos, destroyed, … }
 * @param {object} o.preset         konfiguracja (fitPresets.js) albo własna (ten sam kształt)
 * @param {Map|object} o.stock      hangar broni: id → sztuk
 * @param {'own'|'buy'} [o.mode]
 * @param {object} o.weapons        katalog broni (MASTER_WEAPONS)
 * @param {(hp:object)=>string|null} o.currentOf       broń w gnieździe dziś (hangar: pierwsza eskadra)
 * @param {(hp:object, moduleId:string|null)=>string} o.slotType  typ gniazda po module (moduleSlotType)
 * @param {(def:object, hp:object)=>boolean} [o.fits]  rozmiar broni pasuje do gniazda (typ sprawdza planer)
 * @param {(id:string)=>boolean} [o.isFree]            broń bez liczenia sztuk (eskadry hangarów)
 * @param {(id:string)=>boolean} [o.hasPart]           moduł / system w hangarze albo założony
 * @param {(id:string)=>number|null} [o.weaponPrice]   cena sztuki w porcie (null — port nie sprzeda)
 * @param {(id:string)=>number} [o.partPrice]          cena modułu / systemu F
 * @param {(id:string)=>boolean} [o.moduleOk]          kadłub może mieć ten moduł
 * @param {(id:string)=>boolean} [o.systemOk]          kadłub ma ten system F
 * @param {string|null} [o.currentModule]
 * @param {string|null} [o.currentSystem]
 */
export function planFit(o) {
  const mode = o.mode === 'buy' ? 'buy' : 'own';
  const preset = o.preset || { slots: {} };
  const W = o.weapons || {};
  const fits = o.fits || (() => true);
  const isFree = o.isFree || (() => false);
  const hasPart = o.hasPart || (() => false);
  const weaponPrice = o.weaponPrice || (() => null);
  const partPrice = o.partPrice || (() => 0);
  const moduleOk = o.moduleOk || (() => true);
  const systemOk = o.systemOk || (() => true);
  const currentOf = o.currentOf || ((hp) => hp.mount || null);

  // Moduł i system planu. 'own' — tylko posiadane; system, którego kadłub nie ma, zostaje jaki był.
  let module = preset.module || null;
  if (module && !moduleOk(module)) module = null;
  if (mode === 'own' && module && !hasPart(module)) module = null;
  let system = preset.system || null;
  if (system && !systemOk(system)) system = o.currentSystem || null;
  if (mode === 'own' && system && !hasPart(system)) system = o.currentSystem || null;

  const pool = toMap(o.stock);
  const hardpoints = (o.hardpoints || []).filter(Boolean);
  for (const hp of hardpoints) {
    if (hp.destroyed) continue;
    const id = currentOf(hp);
    if (id && !isFree(id)) pool.set(id, (pool.get(id) || 0) + 1);
  }
  const avail = (id, n) => isFree(id) || (pool.get(id) || 0) >= n;
  const take = (id, n) => { if (!isFree(id)) pool.set(id, (pool.get(id) || 0) - n); };

  const mounts = new Map();
  const buy = new Map();
  const unavailable = new Map();
  const subs = new Map();
  const empties = [];
  let fromStock = 0;
  let total = 0;
  const addSub = (want, used, n) => {
    const key = `${want || ''}|${used}`;
    const s = subs.get(key);
    if (s) s.n += n; else subs.set(key, { want: want || null, used, n });
  };

  for (const baseType of TYPE_ORDER) {
    const groups = orderFitSlots(hardpoints, baseType);
    if (!groups.length) continue;
    const spec = preset.slots?.[baseType] || null;
    const desired = [];
    for (const [id, n] of spec?.want || []) for (let i = 0; i < n; i++) desired.push(id);
    const alts = spec?.alt || [];
    let cursor = 0;
    for (const group of groups) {
      const eff = o.slotType ? o.slotType(group[0], module) : baseType;
      const okFor = (id, hp) => {
        const def = W[id];
        return !!def && def.mountType === eff && fits(def, hp);
      };
      const okAll = (id) => group.every((hp) => okFor(id, hp));
      const wants = group.map((_, i) => (desired.length ? desired[Math.min(cursor + i, desired.length - 1)] : null));
      cursor += group.length;
      total += group.length;

      if (!spec) {
        // Przepis nie mówi nic o tym typie — gniazda zostają z tym, co mają (o ile wolno: typ mógł się zmienić).
        for (const hp of group) {
          const cur = currentOf(hp);
          if (cur && okFor(cur, hp) && avail(cur, 1)) {
            take(cur, 1);
            mounts.set(hp.id, cur);
            if (!isFree(cur)) fromStock++;
          } else {
            mounts.set(hp.id, null);
          }
        }
        continue;
      }

      // Jedno gniazdo: jawnie puste (własna konfiguracja), zakup chcianej broni albo „z magazynu” z zastępstwami.
      const fillSingle = (hp, want) => {
        if (desired.length && want === null) {
          mounts.set(hp.id, null);
          return;
        }
        if (mode === 'buy' && want && okFor(want, hp)) {
          if (avail(want, 1)) {
            take(want, 1);
            if (!isFree(want)) fromStock++;
          } else if (weaponPrice(want) != null) {
            buy.set(want, (buy.get(want) || 0) + 1);
          } else {
            unavailable.set(want, (unavailable.get(want) || 0) + 1);
          }
          mounts.set(hp.id, want);
          return;
        }
        let one = null;
        if (want && okFor(want, hp) && avail(want, 1)) one = want;
        if (!one) one = alts.find((id) => okFor(id, hp) && avail(id, 1)) || null;
        if (!one) {
          const cur = currentOf(hp);
          if (cur && okFor(cur, hp) && avail(cur, 1)) one = cur;
        }
        if (!one) {
          for (const [id, cnt] of pool) {
            if (cnt > 0 && okFor(id, hp)) { one = id; break; }
          }
        }
        if (one) {
          take(one, 1);
          if (!isFree(one)) fromStock++;
          mounts.set(hp.id, one);
          if (one !== want) addSub(want, one, 1);
        } else {
          mounts.set(hp.id, null);
          empties.push({ want, hpId: hp.id });
        }
      };

      // Własna konfiguracja z różną bronią w parze — gniazdo po gnieździe.
      if (!wants.every((w) => w === wants[0])) {
        for (let i = 0; i < group.length; i++) fillSingle(group[i], wants[i]);
        continue;
      }
      const want = wants[0];
      if (desired.length && want === null) {
        for (const hp of group) mounts.set(hp.id, null);
        continue;
      }
      if (mode === 'buy' && want && okAll(want)) {
        for (const hp of group) fillSingle(hp, want);
        continue;
      }

      // 'own' (albo chciana broń nie mieści się w tych gniazdach): całą grupą — preferencja, zastępstwa, a potem
      // cokolwiek z puli, co obsadzi CAŁĄ parę (najpierw to, co już w niej wisi) — para zostaje symetryczna.
      const n = group.length;
      let chosen = null;
      if (want && okAll(want) && avail(want, n)) chosen = want;
      if (!chosen) chosen = alts.find((id) => okAll(id) && avail(id, n)) || null;
      if (!chosen) {
        const cur = currentOf(group[0]);
        if (cur && okAll(cur) && avail(cur, n)) chosen = cur;
      }
      if (!chosen) {
        for (const [id, cnt] of pool) {
          if (cnt >= n && okAll(id)) { chosen = id; break; }
        }
      }
      if (chosen) {
        take(chosen, n);
        if (!isFree(chosen)) fromStock += n;
        for (const hp of group) mounts.set(hp.id, chosen);
        if (chosen !== want) addSub(want, chosen, n);
        continue;
      }
      // Para się nie domknie — gniazdo po gnieździe.
      for (const hp of group) fillSingle(hp, want);
    }
  }

  const partsToBuy = [];
  if (mode === 'buy') {
    if (module && !hasPart(module)) partsToBuy.push(module);
    if (system && !hasPart(system) && Number(partPrice(system)) > 0) partsToBuy.push(system);
  }
  let price = 0;
  for (const [id, n] of buy) price += (Number(weaponPrice(id)) || 0) * n;
  for (const id of partsToBuy) price += Number(partPrice(id)) || 0;

  let changed = 0;
  for (const hp of hardpoints) {
    if (hp.destroyed) continue;
    if ((mounts.get(hp.id) ?? null) !== (currentOf(hp) || null)) changed++;
  }
  if (module !== (o.currentModule || null)) changed++;

  return {
    mode,
    preset,
    module,
    system,
    mounts,
    stockAfter: pool,
    buy,
    unavailable,
    partsToBuy,
    price: Math.round(price),
    subs: [...subs.values()],
    empties,
    fromStock,
    total,
    changed,
    toBuyCount: [...buy.values()].reduce((s, n) => s + n, 0) + partsToBuy.length,
    blocked: unavailable.size > 0
  };
}

/**
 * Własna konfiguracja z bieżących gniazd (refit ręczny → „ZAPISZ JAKO WŁASNĄ”): przepis w kształcie fitPresets.js,
 * kolejność broni jak w automacie (od dziobu, pary razem), więc planFit odtwarza ten sam fit.
 */
export function presetFromHardpoints(hardpoints, { id, name, module = null, system = null, currentOf } = {}) {
  const cur = currentOf || ((hp) => hp.mount || null);
  const slots = {};
  for (const type of TYPE_ORDER) {
    const groups = orderFitSlots(hardpoints, type);
    if (!groups.length) continue;
    const want = [];
    for (const group of groups) {
      for (const hp of group) {
        const wid = cur(hp) || null;
        const last = want[want.length - 1];
        if (last && last[0] === wid) last[1]++;
        else want.push([wid, 1]);
      }
    }
    slots[type] = { want, alt: [] };
  }
  return { id, name, module, system, slots };
}
