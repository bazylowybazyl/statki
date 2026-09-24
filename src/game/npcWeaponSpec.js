// Limit obsadzonych gniazd NPC do specyfikacji ramy (SHIPS[rama].spec).
//
// Layouty z edytora (src/data/hardpointEditorDefaults.js, nadpisywane przez
// 'hpEditor.v1' z localStorage) to POZYCJE wizualne — bywa ich 3–10× więcej
// niż spec ramy. equipNpcWeapons obsadzał każde gniazdo, więc bitwa 174 okrętów
// miała 3 765 luf zamiast ~1 000 (docs/AUDYT-wydajnosc-bitwa-2026-09-24.md, 2.1).
// Layoutów nie ruszamy; tu tylko wybieramy, które gniazda dostają broń:
// najwyżej spec[typ], rozłożone równo po kącie wokół środka kadłuba.
// „Pierwsze N” z listy dawałoby jednostronną burtę, bo edytor zapisuje
// gniazda w kolejności stawiania.

export const NPC_SPEC_WEAPON_TYPES = Object.freeze(['main', 'aux', 'missile']);

// Rama, z której czytamy spec: najpierw npc.shipFrame (applyCallInIdentity /
// assignNpcShipFrame), potem typ jednostki. Brak ramy ze spec = brak limitu.
export function resolveNpcSpecFrameId(npc, ships) {
  if (!npc || !ships) return null;
  const frame = String(npc.shipFrame || '').toLowerCase();
  if (frame && ships[frame]?.spec) return frame;

  const type = String(npc.type || '').toLowerCase();
  const pirate = npc.isPirate === true;
  let id = null;
  if (type === 'battleship' || type === 'pirate_battleship') id = pirate ? 'pirate_battleship' : 'terran_battleship';
  else if (type === 'destroyer') id = pirate ? 'pirate_destroyer' : 'terran_destroyer';
  else if (type.includes('frigate')) id = pirate ? 'pirate_frigate' : 'terran_frigate';
  else if (type === 'carrier' || type === 'capital_carrier') id = 'terran_carrier';
  else if (type === 'supercapital') id = 'terran_supercapital';
  else if (type === 'atlas' || type === 'corvus') id = type;
  return id && ships[id]?.spec ? id : null;
}

function slotLocalX(hp) {
  return Number(hp?.x ?? hp?.pos?.x) || 0;
}

function slotLocalY(hp) {
  return Number(hp?.y ?? hp?.pos?.y) || 0;
}

// Wybiera `count` gniazd z `slots`, równo po kącie wokół środka kadłuba:
// sortujemy po atan2(y, x) i bierzemy co (n/count)-te miejsce w tej kolejności,
// ze środka każdego przedziału. Dla 2 z burtowego rzędu daje to po jednym
// z każdej burty, dla 1 — gniazdo najbliżej dziobu. Deterministyczne.
export function pickEvenlyByAngle(slots, count, out = []) {
  out.length = 0;
  const n = Array.isArray(slots) ? slots.length : 0;
  const k = Math.max(0, Math.min(n, Math.floor(Number(count) || 0)));
  if (k === 0) return out;
  if (k >= n) {
    for (let i = 0; i < n; i++) out.push(slots[i]);
    return out;
  }
  const order = [];
  for (let i = 0; i < n; i++) {
    order.push({ hp: slots[i], angle: Math.atan2(slotLocalY(slots[i]), slotLocalX(slots[i])), index: i });
  }
  order.sort((a, b) => (a.angle - b.angle) || (a.index - b.index));
  for (let i = 0; i < k; i++) {
    out.push(order[Math.floor((i + 0.5) * n / k)].hp);
  }
  return out;
}

// Zbiór gniazd, które dostają broń. Typy spoza `types` nie są ruszane (hangary,
// special — obsadza je kto inny). Typ bez liczby w spec = bez limitu.
export function selectSpecSlots(hardpoints, spec, types = NPC_SPEC_WEAPON_TYPES) {
  const armed = new Set();
  if (!Array.isArray(hardpoints)) return armed;
  const picked = [];
  for (let t = 0; t < types.length; t++) {
    const type = types[t];
    const slots = [];
    for (let i = 0; i < hardpoints.length; i++) {
      const hp = hardpoints[i];
      if (hp && hp.type === type && !hp.destroyed) slots.push(hp);
    }
    if (!slots.length) continue;
    const limitRaw = spec ? Number(spec[type]) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.max(0, Math.floor(limitRaw)) : slots.length;
    pickEvenlyByAngle(slots, limit, picked);
    for (let i = 0; i < picked.length; i++) armed.add(picked[i]);
  }
  return armed;
}
