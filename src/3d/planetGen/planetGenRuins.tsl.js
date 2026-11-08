// src/3d/planetGen/planetGenRuins.tsl.js
//
// RUINY na planetach generatora (decyzja użytkownika 2026-11-08: „ruiny na planetach — żeby było co eksplorować
// (przeszukiwać po surowce); ruiny świecą — po tym gracz pozna, czy warto przeszukać planetę; dotyczy wszystkich
// planet”). Obraz liczony w shaderze klatki (nie w mapie): ostry przy każdym zbliżeniu, a wartość ruin (ile zostało do
// znalezienia) gra może zmieniać w biegu bez wypieku — przeszukane ruiny gasną.
//
// Rekord ruin (dwa uniformy vec4 per obiekt `uRuin{2i}` i `uRuin{2i+1}` — RUIN_KEYS, RUIN_CAP miejsc):
//   [2i]     = (kierunek x, y, z w układzie planety — biegun N = +Y, promień kątowy [rad]; 0 — puste miejsce),
//   [2i + 1] = (wartość 0…1 — jasność świecenia, ziarno wzoru, rodzaj (0 — na gruncie, 1 — unoszące się, olbrzymy), —).
// Z daleka: świecąca plama ≥ ~2,5 px (z zachowaniem energii, z dolnym progiem — widać ją z orbity); z bliska: zarys
// zrujnowanego miasta (siatka murów z wyrwami, pierścienie obwarowań, jaśniejsze węzły), ciemna plama gruzu.
import { If, float, vec2, vec3, abs, atan, clamp, cos, dot, exp, floor, fract, length, max, min, mix, sin, smoothstep, cross } from 'three/tsl';

export const RUIN_CAP = 8;
/** Klucze uniformów per obiekt z rekordami ruin (vec4; dopisywane do kluczy grafu powierzchni). */
export const RUIN_KEYS = Object.freeze(Object.fromEntries(Array.from({ length: RUIN_CAP * 2 }, (_, k) => [`uRuin${k}`, 'vec4'])));
/** Barwa świecenia ruin (liniowa, HDR × siła). */
export const RUIN_GLOW = Object.freeze([0.32, 1.0, 0.86]);

const hash2 = (q, s) => fract(sin(dot(q, vec2(127.1, 311.7)).add(s.mul(0.137))).mul(43758.5453));

/**
 * Świecenie i albedo ruin w punkcie `p` (jednostkowy kierunek w układzie planety). `pixL` — rozmiar piksela na kuli
 * (promień = 1), `U` — uniformy grafu (klucze RUIN_KEYS), `time` [s], `gain` — siła świecenia planety, `land` — 1 na lądzie (plama
 * gruzu tylko tam). Wynik: { emit: vec3 (dodawane po mgiełce), albedo: float (mnożnik barwy dnia) }.
 */
export function ruinsShade({ p, pixL, U, time, gain, land }) {
  const emit = vec3(0.0).toVar();
  const albedo = float(1.0).toVar();
  for (let i = 0; i < RUIN_CAP; i++) {
    const a = U[`uRuin${i * 2}`];
    const b = U[`uRuin${i * 2 + 1}`];
    // AGENT: kompilator GPU potrafi wykonać gałąź spekulatywnie (spłaszczyć if) — wszystko w niej musi być skończone
    // także dla pustego miejsca (promień 0): dzielenie przez max(r, ε), bez odwróconych krawędzi smoothstep. NaN
    // z pustego miejsca zjadał albedo całej planety (zmierzone w demie, 2026-11-08).
    const r = max(a.w, 1e-3).toVar();
    // wynik miejsca w zmiennych miejsca, składany POZA gałęziami (mnożenie wspólnej zmiennej w zagnieżdżonych gałęziach
    // pętli rozwiniętej kompilator GPU psuł — albedo całej planety ×0,14 przy ruinach po drugiej stronie, 2026-11-08)
    const glow = float(0.0).toVar();
    const stain = float(0.0).toVar();
    const lines = float(0.0).toVar();
    If(a.w.greaterThan(0.0), () => {
      const s = a.xyz;
      const d = length(p.sub(s)).toVar();
      // z daleka: plama światła ≥ 2,5 px; energia zachowana do progu (z orbity planeta ma kilka pikseli — próg 0,18)
      const sig = max(r.mul(0.55), pixL.mul(2.5)).toVar();
      const keep = max(r.mul(0.55).div(sig).pow2(), 0.18);
      const pulse = float(0.82).add(sin(time.mul(b.x.mul(1.6).add(0.7)).add(b.y)).mul(0.18));
      const value = b.x;
      const far = exp(d.div(sig).pow2().negate()).mul(keep);
      glow.assign(far.mul(0.9).mul(value).mul(pulse));
      // z bliska (promień > ~10 px): zarys miasta
      const detail = smoothstep(10.0, 28.0, r.div(max(pixL, 1e-7))).toVar();
      If(detail.greaterThan(0.001).and(d.lessThan(r.mul(1.3))), () => {
        const sx = cross(vec3(0.0, 1.0, 0.0), s);
        const es = sx.div(max(length(sx), 1e-5));
        const ns = cross(s, es);
        const ang = b.y.mul(2.399);
        // współrzędne przycięte (gałąź wykonana spekulatywnie daleko od ruin — bez ogromnych argumentów sin / floor)
        const q0 = clamp(vec2(dot(p.sub(s), es), dot(p.sub(s), ns)).div(r), -2.0, 2.0);
        const q = vec2(q0.x.mul(cos(ang)).sub(q0.y.mul(sin(ang))), q0.x.mul(sin(ang)).add(q0.y.mul(cos(ang)))).toVar();
        const rq = length(q).toVar();
        const px = min(pixL.div(r), 1.0);             // piksel w jednostkach promienia ruin
        // siatka murów (8 komórek na promień) z wyrwami: mur komórki istnieje z haszu
        const g = q.mul(8.0);
        const cell = floor(g);
        const fg = abs(fract(g).sub(0.5)).toVar();    // 0 — środek komórki, 0,5 — mur
        const pc = px.mul(8.0);
        const w0 = float(0.46).sub(pc.mul(1.2));
        const wall = max(smoothstep(w0, 0.49, fg.x), smoothstep(w0, 0.49, fg.y));
        const keepCell = smoothstep(0.32, 0.4, hash2(cell, b.y));
        // obwarowania: dwa pierścienie z przerwami
        const ringW = max(px.mul(1.5), 0.012);
        const theta = atan(q.y, q.x.add(1e-6)).div(2 * Math.PI).add(0.5);
        const gap = smoothstep(0.2, 0.35, fract(sin(floor(theta.mul(11.0)).add(floor(rq.mul(3.0)).mul(7.0)).mul(91.7).add(b.y)).mul(4375.85)));
        const ring = max(float(1.0).sub(smoothstep(0.0, ringW, abs(rq.sub(0.48)))), float(1.0).sub(smoothstep(0.0, ringW, abs(rq.sub(0.86))))).mul(gap);
        // węzły (place, wieże) — jasne punkty w części komórek
        const nodeR = max(pc.mul(2.0), 0.12);
        const node = smoothstep(0.86, 0.95, hash2(cell.add(13.0), b.y)).mul(float(1.0).sub(smoothstep(0.0, nodeR, length(fract(g).sub(0.5)))));
        const inside = float(1.0).sub(smoothstep(0.78, 1.0, rq));
        lines.assign(max(wall.mul(keepCell), ring).mul(inside));
        glow.addAssign(lines.mul(0.55).add(node.mul(inside).mul(2.2)).mul(detail).mul(value).mul(pulse));
        // gruz: ciemna plama z jaśniejszymi murami (kamień) — tylko na lądzie
        stain.assign(float(1.0).sub(smoothstep(0.55, 1.05, rq)).mul(detail).mul(land));
      });
    });
    emit.addAssign(vec3(...RUIN_GLOW).mul(glow.mul(gain)));
    albedo.mulAssign(mix(float(1.0), float(0.62).add(lines.mul(0.5)), clamp(stain, 0.0, 1.0)));
  }
  return { emit, albedo };
}

