// dema/autostrada/wstegi.js
//
// Geometria wstęg drogi (czysta — tylko dane; siatkę składa styl): jedna partia na całą sieć. Atrybuty:
//   position  x, y, 0 (scena, lokalnie względem środka Ziemi),
//   aSV       s wzdłuż ścieżki [j.], v w poprzek od osi [j.] (dodatnie po LEWEJ od kierunku próbkowania),
//   aMeta     rodzaj (RODZAJ), pół szerokości właściwej [j.], kierunek ruchu względem s (+1 / −1), indeks węzła K-7 lub −1.
// Główne jezdnie to dwa pierścienie i pas rozdziału; rampy, zawrotki, wrota, pasy K-7 i drogi ciężkich — osobne wstęgi.
// Wstęga ma margines `MARGINES` poza szerokością właściwą (na poświatę i filtr linii); shader ucina go sam.
import { HW, complexes } from './siec.js';

export const RODZAJ = Object.freeze({ WEWN: 0, ZEWN: 1, ROZDZIAL: 2, ZJAZD: 3, WJAZD: 4, ZAWROTKA: 5, WROTA_WE: 6, WROTA_WY: 7, PUDLO: 8, CIEZKI: 9 });
const MARGINES = 260;

const SZER_SCIEZKI = Object.freeze({ rampOff: 170, rampOn: 170, uturn: 200, gateIn: 200, gateOut: 200, box: 640, heavy: 520 });
const RODZAJ_SCIEZKI = Object.freeze({ rampOff: RODZAJ.ZJAZD, rampOn: RODZAJ.WJAZD, uturn: RODZAJ.ZAWROTKA, gateIn: RODZAJ.WROTA_WE, gateOut: RODZAJ.WROTA_WY, box: RODZAJ.PUDLO, heavy: RODZAJ.CIEZKI });

function dopiszWstege(out, xs, ys, ss, polSzer, rodzaj, kierunek, k7) {
  const n = xs.length;
  const start = out.pos.length / 3;
  const m = polSzer + MARGINES;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let tx = xs[b] - xs[a];
    let ty = ys[b] - ys[a];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l; ty /= l;
    const nx = -ty;
    const ny = tx;
    for (const bok of [1, -1]) {
      out.pos.push(xs[i] + nx * m * bok, ys[i] + ny * m * bok, 0);
      out.sv.push(ss[i], m * bok);
      out.meta.push(rodzaj, polSzer, kierunek, k7);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a = start + i * 2;
    out.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

function pierscien(out, r, polSzer, rodzaj, kierunek, segmenty) {
  const xs = []; const ys = []; const ss = [];
  for (let i = 0; i <= segmenty; i++) {
    const t = (i / segmenty) * Math.PI * 2;
    xs.push(r * Math.cos(t));
    ys.push(r * Math.sin(t));
    ss.push(t * r);
  }
  dopiszWstege(out, xs, ys, ss, polSzer, rodzaj, kierunek, -1);
}

/** Dane wstęg sieci: { pozycje, sv, meta, indeksy } jako tablice typowane. */
export function zbudujWstegi(siec, { segmentyRing = 2400, tylko = null } = {}) {
  const out = { pos: [], sv: [], meta: [], idx: [] };
  const rWewn = (HW.edgeIn + HW.iL1 + HW.widths.L1 * 0.5) * 0.5;
  const pWewn = (HW.iL1 + HW.widths.L1 * 0.5 - HW.edgeIn) * 0.5;
  const rZewn = (HW.edgeOut + HW.oL1 - HW.widths.L1 * 0.5) * 0.5;
  const pZewn = (HW.edgeOut - (HW.oL1 - HW.widths.L1 * 0.5)) * 0.5;
  if (!tylko || tylko.has(RODZAJ.WEWN)) pierscien(out, rWewn, pWewn, RODZAJ.WEWN, -1, segmentyRing);
  if (!tylko || tylko.has(RODZAJ.ZEWN)) pierscien(out, rZewn, pZewn, RODZAJ.ZEWN, 1, segmentyRing);
  if (!tylko || tylko.has(RODZAJ.ROZDZIAL)) pierscien(out, HW.median, (HW.oL1 - HW.iL1 - HW.widths.L1) * 0.5, RODZAJ.ROZDZIAL, 1, segmentyRing / 2);
  const katy = complexes();
  for (const p of siec.paths) {
    if (p.kind === 'main') continue;
    const rodzaj = RODZAJ_SCIEZKI[p.kind];
    if (rodzaj === undefined || (tylko && !tylko.has(rodzaj))) continue;
    const q = p.probki;
    const k7 = p.kind === 'box' ? katy.indexOf(p.site) : -1;
    dopiszWstege(out, q.x, q.y, q.s, SZER_SCIEZKI[p.kind], rodzaj, 1, k7);
  }
  return {
    pozycje: new Float32Array(out.pos),
    sv: new Float32Array(out.sv),
    meta: new Float32Array(out.meta),
    indeksy: new Uint32Array(out.idx)
  };
}
