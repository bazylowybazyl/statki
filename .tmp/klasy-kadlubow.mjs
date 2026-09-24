import { HULL_RENDER_PROFILES } from '../src/data/ships.js';
import { hullFootprint, berthClassForHull } from '../src/game/traffic/dockLayout.js';
import { createK7Layout } from '../src/3d/haloRing/haloPortK7Layout.js';
const l = createK7Layout();
const pad = {};
for (const b of l.berths) pad[b.size] = pad[b.size] || { maxLength: b.maxLength, maxBeam: b.maxBeam };
const k7Of = { s: 'S', m: 'M', l: 'L', capital: 'CAPITAL' };
for (const id of Object.keys(HULL_RENDER_PROFILES)) {
  const f = hullFootprint(id);
  const cls = berthClassForHull(id);
  const k = cls ? k7Of[cls.id] : null;
  const p = k ? pad[k] : null;
  const fits = p ? (f.length <= p.maxLength && f.width <= p.maxBeam) : (cls?.id === 'mega' ? (f.length <= 2840 && f.width <= 1650) : false);
  console.log(id.padEnd(24), f.length.toFixed(0).padStart(5), '×', f.width.toFixed(0).padStart(4), ' ruch v2:', (cls?.id || '-').padEnd(8), ' K-7/zatoka:', (k || (cls?.id === 'mega' ? 'ZATOKA' : '-')).padEnd(8), fits ? 'mieści się' : 'NIE MIEŚCI SIĘ');
}
