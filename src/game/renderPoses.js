// src/game/renderPoses.js — pozy RENDERU bytów między krokami fizyki (audyt renderu 2026-10-17,
// docs/AUDYT-render-worker-2026-10-17.md).
//
// Fizyka idzie stałym krokiem (PHYS_HZ — od 2026-10-11 domyślnie 60 Hz), obraz z monitorem (do 240 Hz). Gracz ma
// interpolację (prevState → window.__interpShipPose), reszta bytów szła do obrazu w pozie z KOŃCA ostatniego kroku:
// kadłuby NPC i wraki (z wieżami, dyszami, światłami, mostkami, tarczami) stały 3–4 klatki i skakały o v/60
// (500 j/s = 8,3 j., przy zoomie 0,45 ~3,7 px; dopalacz 1500 j/s ~11 px), a kamera jechała płynnie za graczem.
//
// Tu: gdy numer kroku fizyki zmienił się od poprzedniej klatki renderu, poza z tamtej klatki (= z końca poprzedniego
// kroku) staje się pozą „poprzednią”; poza renderu = lerp(poprzednia, bieżąca, t), t = 1 − (1 − α) / k (α — ułamek
// kroku z pętli gry, jak u gracza; k — kroki od poprzedniej klatki renderu). Byt przesunięty BEZ kroku fizyki (ruch
// w czasie klatki: prowadzenie w tunelu warpa, sceny fabuły) — bez interpolacji (poza bieżąca); skok dłuższy niż
// `snapDist` w kroku (teleport, przylot) — też. Kąt najkrótszym łukiem.
//
// Czysty moduł (bez DOM, three i `window`). Stan w WeakMap po bycie — pola gry nietknięte. Bez alokacji w klatce poza
// pierwszym spotkaniem bytu.

const TAU = Math.PI * 2;

function wrapPi(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export class RenderPoses {
  /** @param {{ snapDist?: number }} [o] — skok w jednym kroku powyżej `snapDist` (j. świata) = bez interpolacji */
  constructor({ snapDist = 6000 } = {}) {
    this.snapDist = snapDist;
    this._map = new WeakMap();
    this._frame = 0;
    this.stats = { interpolated: 0, frameDriven: 0, snapped: 0 };
  }

  /**
   * Raz na klatkę renderu, po krokach fizyki: `entities` — byty do rysowania, `tick` — numer ostatniego kroku fizyki,
   * `alpha` — ułamek kroku do następnego (pauza / zamrożony świat: 1 — poza bieżąca).
   */
  frame(entities, tick, alpha) {
    const f = ++this._frame;
    const a = alpha >= 0 ? (alpha <= 1 ? alpha : 1) : 0;
    const map = this._map, snap2 = this.snapDist * this.snapDist, st = this.stats;
    st.interpolated = 0; st.frameDriven = 0; st.snapped = 0;
    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (!e) continue;
      const p = e.pos;
      const cx = p ? p.x : (e.x || 0), cy = p ? p.y : (e.y || 0), ca = e.angle || 0;
      let r = map.get(e);
      if (r === undefined) {
        r = { frame: f, tick, k: 1, px: cx, py: cy, pa: ca, ax: cx, ay: cy, aa: ca, x: cx, y: cy, angle: ca, live: false };
        map.set(e, r);
        continue;
      }
      if (r.tick !== tick) {
        // krok(i) fizyki od poprzedniej klatki: poza z tamtej klatki = koniec poprzedniego kroku
        r.k = tick > r.tick ? tick - r.tick : 1;
        r.px = r.frame === f - 1 ? r.ax : cx;   // byt nierysowany w poprzedniej klatce — bez historii
        r.py = r.frame === f - 1 ? r.ay : cy;
        r.pa = r.frame === f - 1 ? r.aa : ca;
        r.tick = tick;
      } else if (cx !== r.ax || cy !== r.ay || ca !== r.aa) {
        // ruch bez kroku fizyki (czas klatki) — poza bieżąca
        r.px = cx; r.py = cy; r.pa = ca; r.k = 1;
        st.frameDriven++;
      }
      r.ax = cx; r.ay = cy; r.aa = ca;
      r.frame = f;
      const dx = cx - r.px, dy = cy - r.py;
      if (dx * dx + dy * dy > snap2) {
        r.px = cx; r.py = cy; r.pa = ca;
        st.snapped++;
      }
      const t = 1 - (1 - a) / r.k;
      r.x = r.px + (cx - r.px) * t;
      r.y = r.py + (cy - r.py) * t;
      r.angle = r.pa + wrapPi(ca - r.pa) * t;
      r.live = r.px !== cx || r.py !== cy || r.pa !== ca;
      if (r.live) st.interpolated++;
    }
  }

  /**
   * Poza, którą NASTĘPNE `frame(…, tick, alpha)` da bytowi `e` — bez zmiany stanu (2026-10-17: kamera przy sterach
   * fregaty zwiadu liczy się w render() przed frame(); jechała za pozą kroku, a fregata rysowała się w pozie
   * interpolowanej — fregata drżała w kadrze). Te same reguły co frame(); wynik do `out` ({ x, y, angle }).
   */
  predict(e, tick, alpha, out) {
    const p = e.pos;
    const cx = p ? p.x : (e.x || 0), cy = p ? p.y : (e.y || 0), ca = e.angle || 0;
    const r = this._map.get(e);
    out.x = cx; out.y = cy; out.angle = ca;
    if (r === undefined) return out;
    const a = alpha >= 0 ? (alpha <= 1 ? alpha : 1) : 0;
    let px = r.px, py = r.py, pa = r.pa, k = r.k;
    if (r.tick !== tick) {
      k = tick > r.tick ? tick - r.tick : 1;
      const prev = r.frame === this._frame;   // narysowany w bieżącej (dla następnej — poprzedniej) klatce
      px = prev ? r.ax : cx; py = prev ? r.ay : cy; pa = prev ? r.aa : ca;
    } else if (cx !== r.ax || cy !== r.ay || ca !== r.aa) {
      px = cx; py = cy; pa = ca; k = 1;
    }
    const dx = cx - px, dy = cy - py;
    if (dx * dx + dy * dy > this.snapDist * this.snapDist) { px = cx; py = cy; pa = ca; }
    const t = 1 - (1 - a) / k;
    out.x = px + (cx - px) * t;
    out.y = py + (cy - py) * t;
    out.angle = pa + wrapPi(ca - pa) * t;
    return out;
  }

  /** Poza renderu bytu z bieżącej klatki ({ x, y, angle } — obiekt stanu, tylko do odczytu) albo null. */
  poseOf(e) {
    const r = e ? this._map.get(e) : undefined;
    return r !== undefined && r.frame === this._frame ? r : null;
  }
}
