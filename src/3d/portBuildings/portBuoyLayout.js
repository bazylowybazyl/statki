// Boje redy (Z7): znaczniki stref postoju. Strefy liczy portParking.js (Z2,
// `buildPortParking`: pierścieniowe wycinki r0–r1 × a0–a1 w układzie gry, pasma
// klas S/M/L/capital/mega z rzędami slotów). Tu z planu powstają pozycje boi:
//   - narożniki stref (kind 0) — najjaśniejsze, rytm z profilu planety;
//   - brzegi stref: łuki r0 / r1 i krawędzie promieniowe a0 / a1 co `spacing`
//     (kind 1), z fazą biegnącą od kotwicy strefy (brzeg, od którego strefa
//     się zapełnia) — reda „pokazuje”, skąd stają statki;
//   - końce rzędów w pasmach (kind 2) — małe, stałe.
// Boje nie mają kolizji (statki przelatują nad nimi), światła świecą w FG.
// Czysta matematyka, bez Three: tablice typowane w UKŁADZIE GRY (x, y w dół).

export const BUOY_KIND = Object.freeze({ corner: 0, edge: 1, row: 2 });
export const BUOY_ROLE = Object.freeze({ civil: 0, military: 1, queue: 2 });

export const BUOY_DEFAULTS = Object.freeze({
  spacing: 1800,      // co ile wzdłuż brzegu strefy [j.]
  rows: true,         // końce rzędów pasm
  rowInset: 120       // koniec rzędu: tyle za skrajnym slotem [j.]
});


/**
 * Boje dla planu redy (`buildPortParking` z portParking.js). Zwraca
 * { count, x, y (Float64Array, gra), kind, role (Uint8Array), phase (Float32Array,
 * 0..1 — przesunięcie błysku), zone (Uint16Array), zones: [{ id, role, start, count }] }.
 */
export function buildPortBuoys(plan, options = {}) {
  const cfg = { ...BUOY_DEFAULTS, ...options };
  const pts = [];
  const zones = [];
  for (const [zi, zone] of (plan?.zones || []).entries()) {
    const role = zone.role === 'military' ? BUOY_ROLE.military : BUOY_ROLE.civil;
    const start = pts.length;
    const { cx, cy, r0, r1, a0, a1 } = zone;
    if (!(r1 > r0) || !(a1 > a0)) continue;
    const anchor = Number.isFinite(zone.anchorAngle) ? zone.anchorAngle : a0;
    const far = Math.abs(anchor - a0) < Math.abs(anchor - a1) ? a1 : a0;
    // faza: 0 przy kotwicy strefy → 1 przy dalekim brzegu (bieg światła)
    const phaseOfAngle = (a) => Math.min(1, Math.abs(a - anchor) / Math.max(1e-9, Math.abs(far - anchor)));
    const push = (r, a, kind, phase) => pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, kind, role, phase, zone: zi });
    for (const [r, a] of [[r0, a0], [r0, a1], [r1, a1], [r1, a0]]) push(r, a, BUOY_KIND.corner, phaseOfAngle(a));
    // łuki (bez narożników)
    for (const r of [r0, r1]) {
      const len = (a1 - a0) * r;
      const n = Math.max(1, Math.round(len / cfg.spacing));
      for (let k = 1; k < n; k++) {
        const a = a0 + (a1 - a0) * (k / n);
        push(r, a, BUOY_KIND.edge, phaseOfAngle(a));
      }
    }
    // krawędzie promieniowe
    for (const a of [a0, a1]) {
      const n = Math.max(1, Math.round((r1 - r0) / cfg.spacing));
      for (let k = 1; k < n; k++) push(r0 + (r1 - r0) * (k / n), a, BUOY_KIND.edge, phaseOfAngle(a));
    }
    // końce rzędów: skrajne sloty każdego rzędu pasma (sloty z portParking.js)
    if (cfg.rows) {
      for (const band of zone.bands || []) {
        const byRow = new Map();
        for (const s of band.slots) {
          const e = byRow.get(s.row) || { min: Infinity, max: -Infinity, r: s.r };
          if (s.theta < e.min) e.min = s.theta;
          if (s.theta > e.max) e.max = s.theta;
          byRow.set(s.row, e);
        }
        for (const e of byRow.values()) {
          const da = cfg.rowInset / Math.max(1, e.r);
          const lo = Math.max(a0, e.min - da - (band.cls === 'mega' || band.cls === 'capital' ? 700 / e.r : 250 / e.r));
          const hi = Math.min(a1, e.max + da + (band.cls === 'mega' || band.cls === 'capital' ? 700 / e.r : 250 / e.r));
          push(e.r, lo, BUOY_KIND.row, phaseOfAngle(lo));
          push(e.r, hi, BUOY_KIND.row, phaseOfAngle(hi));
        }
      }
    }
    zones.push({ id: zone.id, role: zone.role, start, count: pts.length - start });
  }
  const n = pts.length;
  const out = {
    count: n,
    x: new Float64Array(n),
    y: new Float64Array(n),
    kind: new Uint8Array(n),
    role: new Uint8Array(n),
    phase: new Float32Array(n),
    zone: new Uint16Array(n),
    zones
  };
  pts.forEach((p, i) => {
    out.x[i] = p.x;
    out.y[i] = p.y;
    out.kind[i] = p.kind;
    out.role[i] = p.role;
    out.phase[i] = p.phase;
    out.zone[i] = p.zone;
  });
  return out;
}

/** Jasność błysku boi (0..1) w chwili `t` — to samo liczy shader świateł (lustro testowe). */
export function buoyFlash(t, phase, rhythm) {
  const period = Math.max(0.2, rhythm?.period || 3);
  const flashes = Math.max(1, rhythm?.flashes || 1);
  const flash = rhythm?.flash || 0.35;
  const u = (((t / period - phase * 0.35) % 1) + 1) % 1 * period;
  for (let k = 0; k < flashes; k++) {
    const t0 = k * flash * 2;
    if (u >= t0 && u < t0 + flash) return 1;
  }
  return 0;
}

