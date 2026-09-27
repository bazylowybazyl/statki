// src/3d/fx/distortion.js
//
// ŹRÓDŁA ZNIEKSZTAŁCEŃ efektów (refrakcja w „uber” Core3D) — port `PostFx` z dema
// rakiet (dema/rakiety-webgpu/post.js). Liczone analitycznie ze źródeł w uniformach,
// bez dodatkowego celu renderu (jak dzisiejsze gorące powietrze w uberPassie):
//   • SHOCK   (0) fala uderzeniowa: pierścień refrakcji z profilem pochodnej gaussa —
//               obraz ściśnięty na froncie, rozciągnięty za nim; BEZ świecącego obrysu
//               (użytkownik: fale = sama przezroczysta refrakcja);
//   • IMPLODE (1) implozja: próbkowanie od środka — obraz wsysany do punktu zapadania
//               (Supernowa przed wybuchem);
//   • HEAT    (2) gorące powietrze: płynący szum w kole słabnący ku brzegowi. Bez
//               kierunku — wzór dema zakotwiczony w świecie (fazy z pozycji źródła
//               liczone na CPU w double); z kierunkiem — wzór płynie z prądem
//               (~350 j/s), a maska wydłuża się w dół strumienia (`stretch`).
// Dyspersja barw ×0,82 / ×1 / ×1,22 (jak w grze) — ułamek przesunięcia z `dispersion`
// (demo: fale i implozja 0,35–0,45, gorące powietrze 0).
//
// Dysze MAIN (`Core3D.pushHeatHazeWorld` z kierunkiem, stożek 7R), tarcze i fale warpa
// zostają na swojej ścieżce w „uber” (zadanie 02) — to tylko NOWE źródła efektów.
//
// JEDEN bufor uniformów (limit 12 na etap — PLAN §3): wszystko w jednej tablicy vec4
// (nagłówek 2 + 4 na źródło). Na CPU źródła zgłasza się w świecie gry (double); commit
// rzutuje je raz na widok do pikseli WZGLĘDEM ŚRODKA ekranu (bez dużych liczb na GPU),
// odrzuca te poza kadrem i bierze `cap` najsilniejszych (reszta w `stats.dropped`).
// Podzielony ekran: commit przed renderem każdej połowy (tablica wysyła się przy
// render()).

import * as THREE from 'three/webgpu';
import {
  Fn, float, int, vec2, vec3, vec4, uniformArray, screenUV, Loop, If,
  exp, sin, cos, max, abs, length, dot, smoothstep
} from 'three/tsl';

export const DISTORT_CAP = 32;          // źródeł na GPU (jak demo rakiet)
export const DISTORT_QUEUE = 128;       // zgłoszeń na klatkę po stronie CPU
export const DISTORT = Object.freeze({ SHOCK: 0, IMPLODE: 1, HEAT: 2 });
export const DISTORT_HEADER = 2;        // vec4 nagłówka: (liczba, czas, włącznik, —), (szer., wys., zoom, —)
export const DISTORT_STRIDE = 4;        // vec4 na źródło: A, B, C, D (niżej)
export const DISTORT_TIME_WRAP = 600;   // [s] zawinięcie zegara wzoru (float32 i sin dużych kątów)

// A = (x, y [px, oś y w górę, względem środka ekranu], promień [px], szerokość [px])
// B = (siła [px], typ, dyspersja, zasięg [px] — wcześniejsze odrzucenie piksela)
// C = (kierunek x, y [scena, jednostkowy albo 0], wydłużenie, —)
// D = fazy wzoru gorącego powietrza (4 człony sinusów)

// Zasięg profilu w promieniach / szerokościach — poza nim wkład < 1% maksimum.
const SHOCK_REACH_W = 3.2;     // |x| = (r − R) / w: x·e^(−x²) < 0,01·max
const IMPLODE_REACH_R = 2.0;   // u·e^(−2,2u²) < 0,01·max przy u > ~1,9

const TWO_PI = Math.PI * 2;
const wrapPhase = (a) => a - Math.floor(a / TWO_PI) * TWO_PI;

export class DistortionField {
  constructor({ cap = DISTORT_CAP, queue = DISTORT_QUEUE, name = 'fxDistort' } = {}) {
    this.cap = cap;
    this.queue = queue;
    this.node = uniformArray(Array.from({ length: DISTORT_HEADER + DISTORT_STRIDE * cap }, () => new THREE.Vector4()), 'vec4').setName(name);
    this.array = this.node.array;               // Vector4[] (adapter PLAN §3: `.value` → node.array)
    // Kolejka zgłoszeń (SoA): pozycja świata w double.
    this.qx = new Float64Array(queue);
    this.qy = new Float64Array(queue);
    this.qdata = new Float32Array(queue * 9);   // typ, promień, szer., siła, dyspersja, dirX, dirY, wydłużenie, ziarno
    this.count = 0;
    this._pick = new Int32Array(queue);
    this.on = 1;
    this.stats = { queued: 0, packed: 0, culled: 0, dropped: 0 };
  }

  /** Nowa klatka zgłoszeń (statystyki są per klatka). */
  begin() {
    this.count = 0;
    this.stats.queued = 0;
    this.stats.dropped = 0;
    return this;
  }

  /**
   * Źródło w świecie gry: typ (DISTORT.*), środek (x, y), promień [j.] (fala: promień
   * frontu), szerokość [j.] (fala: grubość pierścienia), siła [px ekranu], dyspersja
   * 0..1; gorące powietrze: kierunek strumienia (świat, 0 = bez), wydłużenie ≥ 1, ziarno
   * fazy. Zwraca false, gdy siła za mała albo kolejka pełna.
   */
  add(type, x, y, radius, width, strengthPx, dispersion = 1, dirX = 0, dirY = 0, stretch = 1, seed = 0) {
    // Promień 0 jest ważny (fala tuż po wybuchu: front w środku, grubość > 0 — jak demo).
    if (!(strengthPx > 0.02) || !(radius >= 0) || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (this.count >= this.queue) { this.stats.dropped++; return false; }
    const i = this.count++;
    this.qx[i] = x;
    this.qy[i] = y;
    const o = i * 9;
    const q = this.qdata;
    q[o] = type; q[o + 1] = radius; q[o + 2] = width > 0 ? width : 0; q[o + 3] = strengthPx;
    q[o + 4] = dispersion; q[o + 5] = dirX; q[o + 6] = dirY; q[o + 7] = stretch >= 1 ? stretch : 1; q[o + 8] = seed;
    this.stats.queued++;
    return true;
  }

  /** Fala uderzeniowa (sama refrakcja). */
  shock(x, y, radius, width, strengthPx, dispersion = 0.35) {
    return this.add(DISTORT.SHOCK, x, y, radius, width, strengthPx, dispersion);
  }

  /** Implozja (wsysanie obrazu do środka). */
  implode(x, y, radius, strengthPx, dispersion = 0.35) {
    return this.add(DISTORT.IMPLODE, x, y, radius, 0, strengthPx, dispersion);
  }

  /** Gorące powietrze; z kierunkiem (świat) wzór płynie z prądem i wydłuża się (`stretch`). */
  heat(x, y, radius, strengthPx, dirX = 0, dirY = 0, stretch = 1, dispersion = 0, seed = 0) {
    return this.add(DISTORT.HEAT, x, y, radius, 0, strengthPx, dispersion, dirX, dirY, stretch, seed);
  }

  /**
   * Rzutuje zgłoszenia na widok i pakuje do bloku. camX, camY — środek kadru w świecie
   * gry, zoom — px ekranu na jednostkę świata, width / height — rozmiar celu [px],
   * time — zegar efektów [s]. Zwraca liczbę spakowanych źródeł.
   */
  commit(camX, camY, zoom, width, height, time = 0) {
    const A = this.array;
    const z = zoom > 0 ? zoom : 1;
    const hw = width * 0.5;
    const hh = height * 0.5;
    const q = this.qdata;
    const pick = this._pick;
    let vis = 0;
    let culled = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 9;
      const sx = (this.qx[i] - camX) * z;
      const sy = -(this.qy[i] - camY) * z;
      const reach = this._reach(q[o], q[o + 1], q[o + 2], q[o + 7]) * z;
      if (Math.abs(sx) - reach > hw || Math.abs(sy) - reach > hh || reach < 0.5) { culled++; continue; }
      pick[vis++] = i;
    }
    // Więcej niż cap w kadrze: `cap` najsilniejszych (stabilnie — przy remisie wcześniejsze).
    let n = vis;
    if (vis > this.cap) {
      for (let k = 0; k < this.cap; k++) {
        let best = k;
        for (let j = k + 1; j < vis; j++) {
          if (q[pick[j] * 9 + 3] > q[pick[best] * 9 + 3]) best = j;
        }
        if (best !== k) {
          const t = pick[best];
          for (let j = best; j > k; j--) pick[j] = pick[j - 1];
          pick[k] = t;
        }
      }
      n = this.cap;
    }
    for (let k = 0; k < n; k++) {
      const i = pick[k];
      const o = i * 9;
      const b = DISTORT_HEADER + k * DISTORT_STRIDE;
      const type = q[o];
      const sx = (this.qx[i] - camX) * z;
      const sy = -(this.qy[i] - camY) * z;
      A[b].set(sx, sy, q[o + 1] * z, q[o + 2] * z);
      A[b + 1].set(q[o + 3], type, q[o + 4], this._reach(type, q[o + 1], q[o + 2], q[o + 7]) * z);
      // Kierunek świat → scena (y odwrócone), jednostkowy albo 0.
      let dx = q[o + 5];
      let dy = 0 - q[o + 6];
      const dl = Math.hypot(dx, dy);
      if (dl > 1e-6) { dx /= dl; dy /= dl; } else { dx = 0; dy = 0; }
      A[b + 2].set(dx, dy, q[o + 7], 0);
      if (dx === 0 && dy === 0) {
        // Wzór zakotwiczony w świecie jak w demie: fazy z pozycji sceny źródła (double).
        const X = this.qx[i];
        const Y = -this.qy[i];
        A[b + 3].set(wrapPhase(X * 0.021), wrapPhase(Y * 0.034), wrapPhase(Y * 0.025), wrapPhase(X * 0.029));
      } else {
        const s = q[o + 8];
        A[b + 3].set(wrapPhase(s * 1.7), wrapPhase(s * 2.3), wrapPhase(s * 3.1), wrapPhase(s * 0.7));
      }
    }
    A[0].set(n, time - Math.floor(time / DISTORT_TIME_WRAP) * DISTORT_TIME_WRAP, this.on, 0);
    A[1].set(width, height, z, 0);
    this.stats.packed = n;
    this.stats.culled = culled;
    this.stats.dropped += Math.max(0, vis - n);
    return n;
  }

  _reach(type, radius, width, stretch) {
    if (type === DISTORT.SHOCK) return radius + SHOCK_REACH_W * Math.max(width, 1);
    if (type === DISTORT.IMPLODE) return IMPLODE_REACH_R * radius;
    return radius * (stretch + (stretch - 1) * 0.5);
  }

  /** Węzeł TSL przesunięcia dla piksela `uv` (domyślnie screenUV) — `distortionOffset`. */
  offsetNode(uv = screenUV) {
    return distortionOffset(this.node, uv);
  }
}

/**
 * TSL: przesunięcie UV (xy) i jego część z dyspersją (zw) dla piksela `uvIn` z bloku
 * źródeł (`DistortionField.node`). Wklejane bez `setLayout` (czyta tablicę uniformów —
 * PLAN §3). Oś y ekranu w dół (screenUV WebGPU), liczenie w pikselach osi sceny.
 * Wpięcie w „uber” (12-B): `const off = distortionOffset(field.node, uv)` i próbkowanie
 * `sampleDistorted(tex, uv, off)` albo dodanie `off.xy` do istniejącego przesunięcia.
 */
export function distortionOffset(block, uvIn = screenUV) {
  return Fn(() => {
    const H0 = block.element(0).toVar();                 // liczba, czas, włącznik
    const H1 = block.element(1).toVar();                 // szer., wys., zoom
    const size = H1.xy;
    const px = uvIn.mul(size).toVar();
    // Piksel w osiach sceny (y w górę), względem środka ekranu.
    const q = vec2(px.x.sub(size.x.mul(0.5)), size.y.mul(0.5).sub(px.y)).toVar();
    const invZoom = float(1.0).div(max(H1.z, 1e-6)).toVar();
    const t = H0.y;
    const offPx = vec2(0.0).toVar();
    const dispPx = vec2(0.0).toVar();
    Loop({ start: int(0), end: int(H0.x), type: 'int', condition: '<', name: 'distortItem' }, ({ distortItem }) => {
      const base = distortItem.mul(DISTORT_STRIDE).add(DISTORT_HEADER).toVar();
      const A = block.element(base).toVar();
      const B = block.element(base.add(1)).toVar();
      const d = q.sub(A.xy).toVar();
      If(abs(d.x).lessThan(B.w).and(abs(d.y).lessThan(B.w)), () => {
        const r = max(length(d), 1e-3).toVar();
        const dir = d.div(r).toVar();
        const o = vec2(0.0).toVar();
        If(B.y.lessThan(0.5), () => {
          // Fala: pochodna gaussa, maksimum ±1 przy |x| = 0,71.
          const x = r.sub(A.z).div(max(A.w, 1.0));
          const prof = x.mul(exp(x.mul(x).negate())).mul(2.33);
          o.assign(dir.mul(prof.mul(B.x)));
        }).ElseIf(B.y.lessThan(1.5), () => {
          // Implozja: próbkowanie od środka.
          const u = r.div(max(A.z, 1.0));
          const prof = u.mul(exp(u.mul(u).mul(-2.2))).mul(2.2);
          o.assign(dir.mul(prof.mul(B.x)));
        }).Else(() => {
          const C = block.element(base.add(2)).toVar();
          const D = block.element(base.add(3)).toVar();
          If(abs(C.x).add(abs(C.y)).lessThan(0.5), () => {
            // Bez kierunku — wzór dema (fazy D z pozycji źródła w świecie).
            const u = r.div(max(A.z, 1.0));
            const fall = float(1.0).sub(smoothstep(0.3, 1.0, u));
            const P = d.mul(invZoom);
            const w = vec2(
              sin(P.x.mul(0.021).add(D.x).add(t.mul(7.3))).add(sin(P.y.mul(0.034).add(D.y).sub(t.mul(5.1)))),
              cos(P.y.mul(0.025).add(D.z).add(t.mul(6.1))).add(cos(P.x.mul(0.029).add(D.w).add(t.mul(4.7))))
            ).mul(0.5);
            o.assign(w.mul(B.x.mul(fall)));
          }).Else(() => {
            // Z kierunkiem: układ strumienia (wzdłuż, w poprzek), maska-elipsa
            // wydłużona w dół strumienia, wzór płynie z prądem.
            const perp = vec2(C.y.negate(), C.x);
            const a = dot(d, C.xy);
            const c = dot(d, perp);
            const s = C.z.sub(1.0).mul(0.5).mul(A.z);
            const u = length(vec2(a.sub(s).div(C.z), c)).div(max(A.z, 1.0));
            const fall = float(1.0).sub(smoothstep(0.3, 1.0, u));
            const Pa = a.mul(invZoom);
            const Pc = c.mul(invZoom);
            const wa = sin(Pa.mul(0.021).add(D.x).sub(t.mul(7.3))).add(sin(Pc.mul(0.034).add(D.y).sub(t.mul(5.1)))).mul(0.5);
            const wc = cos(Pc.mul(0.025).add(D.z).add(t.mul(6.1))).add(cos(Pa.mul(0.029).add(D.w).sub(t.mul(4.7)))).mul(0.5);
            o.assign(C.xy.mul(wa).add(perp.mul(wc)).mul(B.x.mul(fall)));
          });
        });
        offPx.addAssign(o);
        dispPx.addAssign(o.mul(B.z));
      });
    });
    // Piksele → UV (oś y ekranu w dół).
    const inv = vec2(1.0, -1.0).div(size);
    return vec4(offPx.mul(inv), dispPx.mul(inv)).mul(H0.z);
  })();
}

/**
 * TSL: próbkowanie obrazu `tex` (węzeł tekstury) z przesunięciem `off` (wynik
 * `distortionOffset`) i dyspersją barw ×0,82 / ×1 / ×1,22 (jak w demie i w grze).
 */
export function sampleDistorted(tex, uv, off) {
  const main = off.xy.sub(off.zw);
  const r = tex.sample(uv.add(main).add(off.zw.mul(0.82))).r;
  const g = tex.sample(uv.add(main).add(off.zw)).g;
  const b = tex.sample(uv.add(main).add(off.zw.mul(1.22))).b;
  return vec3(r, g, b);
}

/**
 * Lustro CPU `distortionOffset` (testy): przesunięcie w PIKSELACH osi sceny (x, y w
 * górę) i jego część z dyspersją dla piksela ekranu (px, py) — `out` = { x, y, dx, dy }.
 */
export function distortionOffsetCpu(field, px, py, out = { x: 0, y: 0, dx: 0, dy: 0 }) {
  const A = field.array;
  const n = A[0].x | 0;
  const t = A[0].y;
  const W = A[1].x;
  const H = A[1].y;
  const invZoom = 1 / Math.max(A[1].z, 1e-6);
  const qx = px - W * 0.5;
  const qy = H * 0.5 - py;
  out.x = 0; out.y = 0; out.dx = 0; out.dy = 0;
  for (let k = 0; k < n; k++) {
    const b = DISTORT_HEADER + k * DISTORT_STRIDE;
    const a = A[b]; const B = A[b + 1]; const C = A[b + 2]; const D = A[b + 3];
    const dx = qx - a.x;
    const dy = qy - a.y;
    if (!(Math.abs(dx) < B.w && Math.abs(dy) < B.w)) continue;
    const r = Math.max(Math.hypot(dx, dy), 1e-3);
    const ux = dx / r;
    const uy = dy / r;
    let ox = 0;
    let oy = 0;
    if (B.y < 0.5) {
      const x = (r - a.z) / Math.max(a.w, 1);
      const prof = x * Math.exp(-x * x) * 2.33 * B.x;
      ox = ux * prof; oy = uy * prof;
    } else if (B.y < 1.5) {
      const u = r / Math.max(a.z, 1);
      const prof = u * Math.exp(-2.2 * u * u) * 2.2 * B.x;
      ox = ux * prof; oy = uy * prof;
    } else if (Math.abs(C.x) + Math.abs(C.y) < 0.5) {
      const u = r / Math.max(a.z, 1);
      const fall = 1 - smooth(0.3, 1, u);
      const Px = dx * invZoom;
      const Py = dy * invZoom;
      ox = (Math.sin(Px * 0.021 + D.x + t * 7.3) + Math.sin(Py * 0.034 + D.y - t * 5.1)) * 0.5 * B.x * fall;
      oy = (Math.cos(Py * 0.025 + D.z + t * 6.1) + Math.cos(Px * 0.029 + D.w + t * 4.7)) * 0.5 * B.x * fall;
    } else {
      const px2 = -C.y;
      const py2 = C.x;
      const al = dx * C.x + dy * C.y;
      const ac = dx * px2 + dy * py2;
      const s = (C.z - 1) * 0.5 * a.z;
      const u = Math.hypot((al - s) / C.z, ac) / Math.max(a.z, 1);
      const fall = 1 - smooth(0.3, 1, u);
      const Pa = al * invZoom;
      const Pc = ac * invZoom;
      const wa = (Math.sin(Pa * 0.021 + D.x - t * 7.3) + Math.sin(Pc * 0.034 + D.y - t * 5.1)) * 0.5;
      const wc = (Math.cos(Pc * 0.025 + D.z + t * 6.1) + Math.cos(Pa * 0.029 + D.w - t * 4.7)) * 0.5;
      ox = (C.x * wa + px2 * wc) * B.x * fall;
      oy = (C.y * wa + py2 * wc) * B.x * fall;
    }
    out.x += ox; out.y += oy;
    out.dx += ox * B.z; out.dy += oy * B.z;
  }
  const on = A[0].z;
  out.x *= on; out.y *= on; out.dx *= on; out.dy *= on;
  return out;
}

function smooth(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
