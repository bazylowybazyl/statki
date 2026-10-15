// src/vfx/fighterBombSprite.js
//
// Rysunek bomb lotniczych na kanwie 2D (2026-10-14; logika — src/game/fighterBombs.js). Rysowane PO
// myśliwcach. Bomba to mała ciemna, opływowa bryła z lampką na nosie, ze statecznikami, w kursie z chwili
// zrzutu (obraca się z celem). W trakcie spadania (t: 0 → 1) maleje i blednie — oddala się od kamery w dół,
// na kadłub; pod nią zaciska się blady pierścień punktu upadku (czytelność przy dalekim zoomie).
// Najmniejszy rozmiar na ekranie trzyma bombę widoczną przy zoomie 0,2; przy 1,0 jest w skali myśliwca.
//
// drawFighterBombs(ctx, bombs, toScreen, zoom):
//   bombs    — obiekt z createFighterBombs (list + count) albo tablica bomb { x, y, heading, t, radius,
//              age, friendly },
//   toScreen — (x, y, out, z) → out z polami x, y w px ekranu (np. worldToScreenInto z kamerą renderu;
//              z — wysokość bomby nad płaszczyzną gry dla kamer 3D),
//   zoom     — px ekranu na jednostkę świata,
//   renderPose — opcjonalnie (target, out) → bool: poza celu W RENDERZE { x, y, angle } (interpolowana poza
//              kadłuba) — bomba rysuje się w tym samym miejscu kadłuba co obraz (bez niej: pozycja z kroku fizyki).
// Bez alokacji na klatkę (punkt ekranu i poza we wspólnych obiektach).

/** Najmniejszy promień kadłuba bomby na ekranie [px]. */
export const BOMB_MIN_PX = 2.2;
/** Najmniejszy promień lampki [px]. */
export const BOMB_LAMP_MIN_PX = 1.1;
/** Wysokość zrzutu nad płaszczyzną gry [j.] — kamery 3D (bomba schodzi do kadłuba). */
export const BOMB_DROP_HEIGHT = 60;
/** Ułamek rozmiaru, o który bomba maleje do chwili upadku. */
export const BOMB_SHRINK = 0.5;

const LAMP_FRIENDLY = '#7fe6ff';
const LAMP_HOSTILE = '#ff6a3d';
const BODY_FILL = '#24272c';
const BODY_RIM = 'rgba(205, 214, 226, 0.75)';

const _pt = { x: 0, y: 0, depth: 1 };
const _rp = { x: 0, y: 0, angle: 0 };

/** Rozmiar bomby na ekranie [px] dla promienia, zoomu i postępu spadania (lustro rysunku — testy). */
export function bombScreenRadius(radius, zoom, t) {
  const r = (Number(radius) || 5) * Math.max(0, Number(zoom) || 0);
  const k = 1 - BOMB_SHRINK * Math.min(1, Math.max(0, Number(t) || 0));
  return Math.max(BOMB_MIN_PX * (0.75 + 0.25 * k), r * k);
}

/** Krycie bomby: blednie pod koniec spadania. */
export function bombAlpha(t) {
  const u = Math.min(1, Math.max(0, Number(t) || 0));
  return 1 - 0.55 * u * u;
}

export function drawFighterBombs(ctx, bombs, toScreen, zoom, renderPose = null) {
  if (!ctx || !bombs || typeof toScreen !== 'function') return 0;
  const list = Array.isArray(bombs) ? bombs : bombs.list;
  const n = Array.isArray(bombs) ? bombs.length : (bombs.count | 0);
  if (!list || n <= 0) return 0;
  const z = Math.max(0.0001, Number(zoom) || 1);
  const prevAlpha = ctx.globalAlpha;
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    const b = list[i];
    if (!b) continue;
    const t = Math.min(1, Math.max(0, Number(b.t) || 0));
    let wx = b.x;
    let wy = b.y;
    let h = Number(b.heading) || 0;
    if (renderPose && !b.orphan && b.target && renderPose(b.target, _rp)) {
      const rc = Math.cos(_rp.angle);
      const rs = Math.sin(_rp.angle);
      wx = _rp.x + b.lx * rc - b.ly * rs;
      wy = _rp.y + b.lx * rs + b.ly * rc;
      h = _rp.angle + (Number(b.relHeading) || 0);
    }
    const p = toScreen(wx, wy, _pt, (1 - t) * BOMB_DROP_HEIGHT);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -1e5) continue;
    const r = bombScreenRadius(b.radius, z, t);
    const a = bombAlpha(t);
    const c = Math.cos(h);
    const s = Math.sin(h);
    const len = r * 1.25;   // pół długości kadłuba bomby
    const wid = r * 0.55;   // pół szerokości

    // Punkt upadku: blady pierścień zaciska się do kadłuba bomby (gdzie spadnie).
    const ringR = r * (1.2 + 2.6 * (1 - t));
    ctx.globalAlpha = 0.18 + 0.32 * t;
    ctx.strokeStyle = b.friendly ? LAMP_FRIENDLY : LAMP_HOSTILE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Stateczniki (krzyż na ogonie, w rzucie z góry — dwie skośne kreski).
    ctx.globalAlpha = a;
    const tx = p.x - c * len * 0.85;
    const ty = p.y - s * len * 0.85;
    const fx = -s * wid * 1.5;
    const fy = c * wid * 1.5;
    ctx.strokeStyle = BODY_RIM;
    ctx.lineWidth = Math.max(0.8, r * 0.28);
    ctx.beginPath();
    ctx.moveTo(tx + fx - c * wid * 0.6, ty + fy - s * wid * 0.6);
    ctx.lineTo(tx - fx - c * wid * 0.6, ty - fy - s * wid * 0.6);
    ctx.stroke();

    // Kadłub: ciemna elipsa z jasnym obrysem (czytelna na tle mgławicy i na pancerzu).
    ctx.fillStyle = BODY_FILL;
    ctx.strokeStyle = BODY_RIM;
    ctx.lineWidth = Math.max(0.7, r * 0.22);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, len, wid, h, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Lampka na nosie: miga (2 Hz z czasu spadania), przed upadkiem świeci ciągle.
    const age = Number(b.age) || 0;
    const blink = t > 0.7 || (age * 6) % 1 < 0.55;
    if (blink) {
      const lr = Math.max(BOMB_LAMP_MIN_PX, r * 0.32);
      ctx.fillStyle = b.friendly ? LAMP_FRIENDLY : LAMP_HOSTILE;
      ctx.beginPath();
      ctx.arc(p.x + c * len * 0.62, p.y + s * len * 0.62, lr, 0, Math.PI * 2);
      ctx.fill();
    }
    drawn++;
  }
  ctx.globalAlpha = prevAlpha;
  return drawn;
}
