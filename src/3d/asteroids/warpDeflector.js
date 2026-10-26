// src/3d/asteroids/warpDeflector.js
//
// DEFLEKTOR NAWIGACYJNY W SKOKU GRACZA (DECYZJE-2 S3, 2026-10-26; user: „trzeba dodać odpychanie skał — skojarz tutaj
// »tarczę« grawitacyjną ze Star Trek”). Tylko obraz i tylko warp gracza (soczewka świata aktywna — WARP_WORLD_LENS):
// pole przed dziobem rozpycha skały pasa w skoku (warpDebris.js) na boki jak OPŁYW wokół dziobu.
//
// MODEL. Przepływ potencjalny wokół koła w osiach przeskalowanych do elipsy pola (półoś A wzdłuż kursu, B w poprzek,
// środek `ahead` długości kadłuba przed środkiem statku): funkcja prądu ψ = Y · (1 − 1 / (X² + Y²)), daleko ψ → Y.
// Skała płynie wzdłuż kursu jak dotąd (u maleje z przepływem), a jej położenie w poprzek to linia prądu ψ = Y∞
// w danym X (rozwiązanie zewnętrzne, ρ > 1 — Newton z przedziałem, bez alokacji). Położenie zależy od (X, Y∞, siła pola)
// i STRONY skały (stan skały: −1 / +1, 0 — nieustalona): skała zjeżdża płynnie i wraca za rufą. Skała dokładnie na
// kursie dostaje podłogę |Y∞| ≥ `floor` narastającą przy zbliżaniu (|X| 3,2 → 1,2) — bez punktu stagnacji (nie staje
// przed dziobem). STRONA (recenzja S, 2026-10-26): ustala się przy WEJŚCIU skały w działające pole (znak Y∞ w tej
// chwili — skała wpływająca z przodu, narodzona w zasięgu albo zastana przy włączeniu pola) i jest ZAMKNIĘTA w całym
// zasięgu (ρ∞ < reachOut); poza zasięgiem, przy wyłączonym polu i w głębi bez pola — nieustalona (0). Przy stałej
// stronie Y jest ciągłe w X i Y∞ (także gdy Y∞ zmienia znak — kołysanie kamery: skała zostaje na podłodze swojej
// strony), a na brzegu zasięgu obie strony dają Y∞ — strona nie przeskakuje nigdzie (dawny zamek tylko w strefie
// podłogi przerzucał na rufie skałę z kołysania, a losowa strona skały zastanej przy włączeniu pola stawiała ją przy
// złej burcie i potem skokiem o 3–4 B).
//
// PRZESTRZEŃ POZORNA. Skały leżą pod płaszczyzną gry (pass tła, perspektywa). Opływ liczy się w ich położeniu
// POZORNYM (rzut na płaszczyznę gry: k = camZ / (camZ + głębokość)) względem statku — skała omija na ekranie sylwetkę
// statku. Pole ma zasięg w głąb (`depthFull` → `depthNone` w jednostkach camZ): pasmo bliskie odpychane w pełni,
// środkowe częściowo, dalekie przepływa pod statkiem bez zmian (głębia czytelna, pole „ma grubość”).
//
// UJAWNIENIE POLA (decyzja użytkownika: bez świecących okręgów i obrysów, fale = sama refrakcja): przy bliskim przejściu
// skały przed dziobem (raz na skałę, najwyżej `glintCap` naraz, odstęp `glintGap` ± `glintJitter` — rzadko i nierówno,
// gęste pole nie składa łuków w obrys przodu) — cienki krótki ŁUK HDR na powierzchni pola w miejscu odepchnięcia
// (odcinek elipsy ±`glintArc` rad, ~0,4 s, w głębokości skały — pod statkiem, nigdy na nim) i fala
// REFRAKCJI (`Core3D.fxDistortion().shock` — pisze ją pas, nie ten moduł) z zasięgiem przyciętym przed kadłubem.
// Moduł czysty: bez three, Core3D i stanu gry (testy w Node); losowanie odstępu łuków — fxRandom (warstwa efektów).

import { fxRandom } from '../fx/fxRandom.js';

export const WARP_DEFLECTOR = Object.freeze({
  ahead: 0.45,        // środek pola przed środkiem kadłuba [długości kadłuba L]
  halfLen: 1.3,       // A — półoś wzdłuż kursu [L] (przód pola 1,75 L przed środkiem, 1,25 L przed dziobem)
  halfWide: 0.55,     // B — półoś w poprzek [L] …
  wideMin: 2.4,       // … co najmniej × pół szerokości kadłuba
  hullFallback: 1200, // [j.] długość kadłuba, gdy soczewka jej nie podaje
  floor: 0.38,        // najmniejsze |Y∞| przy dziobie (skała na kursie zjeżdża na bok, bez stagnacji)
  floorNear: 1.2,     // |X|, przy którym podłoga jest pełna …
  floorFar: 3.2,      // … i od którego zaczyna rosnąć
  reachIn: 4.5,       // ρ∞ (odległość od środka w osiach elipsy), od której pole słabnie …
  reachOut: 7,        // … i od której go nie ma
  depthFull: 0.25,    // głębokość / camZ: do tej pełne pole (pasmo bliskie) …
  depthNone: 0.9,     // … od tej bez pola (pasmo dalekie)
  rise: 0.35,         // [s] narastanie siły z osią β skoku …
  fall: 0.6,          // [s] … i gaśnięcie (wolniej — skały wracają na tor bez szarpnięcia przy końcu skoku i klawiszu G)
  // ŁUK (rozbłysk w miejscu odepchnięcia; recenzja S 2026-10-26: dawne 6 naraz co 0,09 s po ±0,42 rad świeciły średnio
  // 18–31% przodu elipsy, w szczycie ~60% — oko składało je w obrys)
  glintCap: 2,
  glintGap: 0.4,      // [s] średni odstęp kolejnych łuków …
  glintJitter: 0.4,   // … ± ten udział (losowo — bez równego rytmu w gęstym polu)
  glintLife: 0.42,    // [s]
  glintRise: 0.035,   // [s]
  glintTau: 0.16,     // [s] zanik
  glintTrigX: 1.15,   // X, przy którym skała „dotyka” przodu pola
  glintPush: 0.28,    // najmniejsze odepchnięcie (× B), które ujawnia pole
  glintMinWeight: 0.6, // tylko skały z pasma odpychanego (waga głębi)
  glintMaxDeg: 62,    // tylko przód pola (kąt od osi kursu na elipsie)
  glintArc: 0.18,     // połowa łuku [rad parametru elipsy] (cięciwa ~0,36 B — kreska w miejscu odepchnięcia, nie obrys)
  glintWidth: 0.012,  // pół grubości łuku [× B] (shader trzyma ≥ ~1 px)
  glintGain: 2.4,     // szczyt jasności (HDR — łapie bloom)
  glintColor: Object.freeze([0.55, 0.82, 1.0]),
  // FALA REFRAKCJI przy łuku
  rippleCap: 4,
  rippleLife: 0.45,   // [s]
  rippleR0: 0.08,     // promień frontu [× B] na starcie …
  rippleR1: 0.42,     // … i na końcu
  rippleWidth: 0.11,  // grubość [× B]
  rippleStrength: 2.6, // [px] przesunięcia obrazu (maleje (1 − t)²)
  rippleDisp: 0.25,   // dyspersja barw
  rippleReach: 3.2,   // zasięg profilu fali w grubościach (distortion.js: SHOCK_REACH_W)
  rippleHullGap: 0.8  // zasięg fali ≤ to × odległość punktu od obrysu kadłuba (fala nie dotyka statku)
});

/** Adres strony wyłącza deflektor: `?deflektor=0` (A/B; działa też w workerze renderu — adres przez RenderWorld). */
let _deflSearch = null;
let _deflOn = true;
let _deflForce = null;
export function setWarpDeflector(on) {
  _deflForce = on === true || on === false ? on : null;
}
export function warpDeflectorOn(search) {
  if (_deflForce !== null) return _deflForce;
  const s = typeof search === 'string' ? search : '';
  if (s !== _deflSearch) {
    _deflSearch = s;
    _deflOn = !/[?&]deflektor=0(?:&|$)/.test(s);
  }
  return _deflOn;
}

const smooth = (e0, e1, x) => {
  const t = (x - e0) / (e1 - e0);
  const c = t < 0 ? 0 : (t > 1 ? 1 : t);
  return c * c * (3 - 2 * c);
};

/**
 * Linia prądu opływu koła jednostkowego: Y ≥ 0 z Y · (1 − 1 / (X² + Y²)) = T (T ≥ 0), rozwiązanie zewnętrzne (ρ ≥ 1).
 * T = 0 — oś (|X| ≥ 1) albo brzeg koła (|X| < 1). f(Y) rośnie na [max(T, √(1 − X²)), T + 1] — Newton z przedziałem.
 */
export function deflectorStreamY(X, T) {
  const x2 = X * X;
  const rim = x2 < 1 ? Math.sqrt(1 - x2) : 0;
  if (!(T > 1e-9)) return rim;
  let lo = T > rim ? T : rim;
  let hi = T + 1;
  let y = lo + 0.5 * (hi - lo);
  for (let i = 0; i < 24; i++) {
    const y2 = y * y;
    const r2 = x2 + y2;
    const f = y - y / r2 - T;
    if (f > 0) hi = y; else lo = y;
    if (Math.abs(f) < 1e-7) break;
    const df = 1 - (x2 - y2) / (r2 * r2);
    let yn = df > 1e-6 ? y - f / df : NaN;
    if (!(yn > lo && yn < hi)) yn = 0.5 * (lo + hi);
    y = yn;
  }
  return y;
}

/**
 * Strona skały w zasięgu pola (±1): ustalona (side ≠ 0) zostaje — zamek w całym zasięgu; nieustalona (0 — skała
 * wchodzi w działające pole) = znak Y∞ w tej chwili (oś dokładnie: +1).
 */
export function deflectorSide(Yinf, side = 0) {
  if (side < 0) return -1;
  if (side > 0) return 1;
  return Yinf < 0 ? -1 : 1;
}

/**
 * Położenie w poprzek przy pełnej sile pola (osie elipsy: X wzdłuż kursu od środka pola, Y∞ — linia prądu daleko
 * przed polem; `side` — strona skały z `deflectorSide`). Zwraca Y (ze znakiem). Daleko (ρ∞ ≥ reachOut) — Y∞ dla obu
 * stron (zamek strony zwalnia się tam bez skoku). Ciągła w X i Y∞ przy stałej stronie (skała po drugiej stronie osi —
 * na podłodze swojej strony, za rufą wraca na swój tor).
 */
export function deflectorY(X, Yinf, side = 1, cfg = WARP_DEFLECTOR) {
  const ax = Math.abs(X);
  const rinf = Math.sqrt(X * X + Yinf * Yinf);
  if (rinf >= cfg.reachOut) return Yinf;
  const fade = 1 - smooth(cfg.reachIn, cfg.reachOut, rinf);
  const h = 1 - smooth(cfg.floorNear, cfg.floorFar, ax);
  const s = side < 0 ? -1 : 1;
  const t = s * Yinf > 0 ? s * Yinf : 0;
  const T = Math.sqrt(t * t + cfg.floor * cfg.floor * h);
  const Y = s * deflectorStreamY(X, T);
  return Yinf + (Y - Yinf) * fade;
}

/**
 * Pole w klatce (bez alokacji): `frame(dt, lens, camX, camY, enabled)` ustawia kształt i siłę z soczewki skoku
 * (WARP_WORLD_LENS: active, beta, shipX / Y, velAngle, hullHalfLen / Wid, zoom), `deflect(u, w, k, zk, side, out)`
 * odpycha skałę (osie kursu względem kamery, świat w głębokości skały), `touch(rock, …)` ujawnia pole przy przejściu.
 */
export class WarpDeflector {
  constructor(config = null) {
    this.cfg = { ...WARP_DEFLECTOR, ...(config || {}) };
    this.strength = 0;
    this.on = false;
    // kształt w osiach kursu względem kamery (świat, płaszczyzna gry)
    this.dirX = 1; this.dirY = 0;
    this.fu = 0; this.fw = 0;      // środek pola
    this.su = 0; this.sw = 0;      // środek statku
    this.A = 1; this.B = 1;
    this.hullHalf = 0;             // pół długości kadłuba [j.]
    this.camX = 0; this.camY = 0;
    this.time = 0;
    this._lastGlint = -1e9;
    this._glintGap = this.cfg.glintGap;   // odstęp do następnego łuku (losowany przy każdym łuku)
    const C = this.cfg;
    this.glints = [];
    for (let i = 0; i < C.glintCap; i++) this.glints.push({ alive: false, age: 0, th: 0, k: 1, z: 0, size: 1 });
    this.ripples = [];
    for (let i = 0; i < C.rippleCap; i++) this.ripples.push({ alive: false, age: 0, th: 0, size: 1, x: 0, y: 0, r: 0, w: 0, amp: 0 });
    this.stats = { strength: 0, pushed: 0, glints: 0, ripples: 0, total: 0 };
  }

  reset() {
    this.strength = 0;
    this.on = false;
    for (let i = 0; i < this.glints.length; i++) this.glints[i].alive = false;
    for (let i = 0; i < this.ripples.length; i++) this.ripples[i].alive = false;
    this.stats.pushed = 0;
    this.stats.glints = 0;
    this.stats.ripples = 0;
  }

  /**
   * Klatka: kształt pola z soczewki skoku gracza i kamery pasa (świat gry), siła narasta z osią β (`rise`, gaśnie `fall`).
   * enabled = false (hipercruise, `?deflektor=0`) — pole gaśnie. dir — kurs (gdy soczewka go nie podaje).
   */
  frame(dt, lens, camX, camY, enabled, dirX = 1, dirY = 0) {
    const C = this.cfg;
    const d = dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0;
    this.time += d;
    const act = !!(enabled && lens && lens.active);
    const beta = act ? Math.max(0, Math.min(1, Number(lens.beta) || 0)) : 0;
    const tau = beta > this.strength ? C.rise : C.fall;
    this.strength += (beta - this.strength) * (d > 0 ? 1 - Math.exp(-d / tau) : 0);
    if (this.strength < 0.005 && !act) this.strength = 0;
    this.on = this.strength > 0.005;
    this.camX = camX;
    this.camY = camY;
    if (act && Number.isFinite(lens.velAngle)) {
      this.dirX = Math.cos(lens.velAngle);
      this.dirY = Math.sin(lens.velAngle);
    } else if (Number.isFinite(dirX) && Number.isFinite(dirY) && (dirX || dirY)) {
      const l = Math.sqrt(dirX * dirX + dirY * dirY);
      this.dirX = dirX / l;
      this.dirY = dirY / l;
    }
    if (act) {
      const z = Number(lens.zoom) > 0 ? Number(lens.zoom) : 0;
      const hl = z > 0 ? Math.max(0, Number(lens.hullHalfLen) || 0) / z : 0;
      const hw = z > 0 ? Math.max(0, Number(lens.hullHalfWid) || 0) / z : 0;
      const L = hl > 1 ? hl * 2 : C.hullFallback;
      this.hullHalf = L * 0.5;
      this.A = C.halfLen * L;
      this.B = Math.max(C.halfWide * L, C.wideMin * (hw > 0 ? hw : L * 0.12));
      const sx = Number.isFinite(lens.shipX) ? lens.shipX - camX : 0;
      const sy = Number.isFinite(lens.shipY) ? lens.shipY - camY : 0;
      this.su = sx * this.dirX + sy * this.dirY;
      this.sw = -sx * this.dirY + sy * this.dirX;
      this.fu = this.su + C.ahead * L;
      this.fw = this.sw;
    }
    this._ageFx(d);
    this.stats.strength = this.strength;
    this.stats.pushed = 0;
  }

  /** Waga pola w głębokości skały (zk = głębokość / camZ). */
  depthWeight(zk) {
    const C = this.cfg;
    return 1 - smooth(C.depthFull, C.depthNone, zk);
  }

  /**
   * Odepchnięcie skały: u, w — położenie swobodne (osie kursu względem kamery, świat w głębokości skały), k — paralaksa
   * (camZ / (camZ + głębokość)), zk — głębokość / camZ, side — strona skały (stan skały: −1 / +1, 0 — nieustalona;
   * wołający przepisuje `out.side` — nowa skała zaczyna od 0). out: w (położenie w poprzek po odepchnięciu), slope
   * (dw / du drogi skały — kierunek śladu), side (0 poza działającym polem), X, Y, Yinf (osie elipsy), push (|ΔY| × waga),
   * weight.
   */
  deflect(u, w, k, zk, side, out) {
    out.w = w; out.slope = 0; out.push = 0; out.weight = 0; out.X = 0; out.Y = 0; out.Yinf = 0; out.side = 0;
    if (!this.on || !(k > 0)) return out;
    const wt = this.strength * this.depthWeight(zk);
    if (!(wt > 1e-4)) return out;
    const C = this.cfg;
    const A = this.A;
    const B = this.B;
    const X = (k * u - this.fu) / A;
    const Yinf = (k * w - this.fw) / B;
    out.X = X;
    out.Yinf = Yinf;
    if (X * X + Yinf * Yinf >= C.reachOut * C.reachOut) { out.Y = Yinf; return out; }
    side = out.side = deflectorSide(Yinf, side);
    const Y = deflectorY(X, Yinf, side, C);
    const dY = (Y - Yinf) * wt;
    out.Y = Yinf + dY;
    out.weight = wt;
    out.push = Math.abs(dY);
    out.w = (this.fw + B * out.Y) / k;
    // Nachylenie drogi (świat): dw / du = (B / A) · dYdef / dX (głębokość się skraca) — różnice centralne.
    const h = 0.02;
    const yp = Yinf + (deflectorY(X + h, Yinf, side, C) - Yinf) * wt;
    const ym = Yinf + (deflectorY(X - h, Yinf, side, C) - Yinf) * wt;
    out.slope = (B / A) * (yp - ym) / (2 * h);
    if (out.push > 1e-3) this.stats.pushed++;
    return out;
  }

  /**
   * Ujawnienie pola: skała z pasma odpychanego mija przód pola (X przechodzi `glintTrigX`) mocno odepchnięta — łuk
   * i fala (raz na skałę: `rock.hit`). size — skala efektu z wielkości skały (0,6–1,4). Zwraca true, gdy powstał.
   */
  touch(rock, d, k, z, size) {
    const C = this.cfg;
    if (!this.on || rock.hit || d.weight < C.glintMinWeight * this.strength || this.strength < 0.5) return false;
    if (!(d.X <= C.glintTrigX && d.X > 0) || d.push < C.glintPush) return false;
    rock.hit = true;
    if (this.time - this._lastGlint < this._glintGap) return false;
    // Punkt na elipsie w stronę skały (osie elipsy), tylko przód pola.
    const th = Math.atan2(d.Y, Math.max(1e-6, d.X));
    if (Math.abs(th) > C.glintMaxDeg * Math.PI / 180) return false;
    let g = null;
    for (let i = 0; i < this.glints.length; i++) if (!this.glints[i].alive) { g = this.glints[i]; break; }
    if (!g) return false;
    this._lastGlint = this.time;
    this._glintGap = C.glintGap * (1 + C.glintJitter * (2 * fxRandom.next() - 1));
    g.alive = true; g.age = 0; g.th = th; g.k = k; g.z = z; g.size = size;
    this.stats.total++;
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      if (r.alive) continue;
      r.alive = true; r.age = 0; r.th = th; r.size = size;
      this._placeRipple(r);   // miejsce i promień już w klatce narodzin (pas zgłasza fale zaraz po update)
      this.stats.ripples++;
      break;
    }
    return true;
  }

  _ageFx(d) {
    const C = this.cfg;
    let ng = 0;
    for (let i = 0; i < this.glints.length; i++) {
      const g = this.glints[i];
      if (!g.alive) continue;
      g.age += d;
      if (g.age >= C.glintLife || !this.on) g.alive = false; else ng++;
    }
    let nr = 0;
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i];
      if (!r.alive) continue;
      r.age += d;
      if (r.age >= C.rippleLife || !this.on) { r.alive = false; continue; }
      nr++;
      this._placeRipple(r);
    }
    this.stats.glints = ng;
    this.stats.ripples = nr;
  }

  /** Jasność łuku w wieku `age` (narastanie `glintRise`, zanik `glintTau`, do zera na końcu życia). */
  glintEnvelope(age) {
    const C = this.cfg;
    const up = smooth(0, C.glintRise, age);
    const end = 1 - smooth(C.glintLife * 0.75, C.glintLife, age);
    return up * Math.exp(-Math.max(0, age - C.glintRise) / C.glintTau) * end;
  }

  /**
   * Łuk w świecie (bez alokacji, out): środek cięciwy (x, y — świat gry w głębokości skały), kierunek styczny (tx, ty —
   * świat), połowa długości `half` [j.], strzałka `sag` [j., + na zewnątrz pola — po lewej stycznej w scenie: nx, ny],
   * pół grubości `halfW` [j.], jasność `I`.
   */
  glintGeometry(g, out) {
    const C = this.cfg;
    const A = this.A;
    const B = this.B;
    const c = Math.cos(g.th);
    const s = Math.sin(g.th);
    // osie elipsy (u — kurs, w — w poprzek) względem kamery, płaszczyzna gry
    const pu = this.fu + A * c;
    const pw = this.fw + B * s;
    let tu = -A * s; let tw = B * c;
    const tl = Math.sqrt(tu * tu + tw * tw) || 1;
    tu /= tl; tw /= tl;
    let nu = B * c; let nw = A * s;
    const nl = Math.sqrt(nu * nu + nw * nw) || 1;
    nu /= nl; nw /= nl;
    const rc = Math.pow(A * A * s * s + B * B * c * c, 1.5) / (A * B);
    const half = C.glintArc * B * g.size;
    const sag = Math.min(0.5 * half, half * half / (2 * Math.max(1, rc)));
    // cięciwa: środek łuku cofnięty o strzałkę do środka pola; świat w głębokości skały = pozorne / k
    const ik = 1 / Math.max(1e-3, g.k);
    const cu = (pu - nu * sag) * ik;
    const cw = (pw - nw * sag) * ik;
    const dx = this.dirX; const dy = this.dirY;
    out.x = this.camX + cu * dx - cw * dy;
    out.y = this.camY + cu * dy + cw * dx;
    out.tx = tu * dx - tw * dy;
    out.ty = tu * dy + tw * dx;
    out.nx = nu * dx - nw * dy;
    out.ny = nu * dy + nw * dx;
    out.half = half * ik;
    out.sag = sag * ik;
    out.halfW = C.glintWidth * B * ik;
    out.I = C.glintGain * this.glintEnvelope(g.age) * Math.min(1, this.strength * 1.25);
    return out;
  }

  // Fala refrakcji: płaszczyzna gry w punkcie łuku, zasięg przycięty przed obrysem kadłuba (statek ostry).
  _placeRipple(r) {
    const C = this.cfg;
    const A = this.A;
    const B = this.B;
    const t = r.age / C.rippleLife;
    const pu = this.fu + A * Math.cos(r.th);
    const pw = this.fw + B * Math.sin(r.th);
    const dx = this.dirX; const dy = this.dirY;
    r.x = this.camX + pu * dx - pw * dy;
    r.y = this.camY + pu * dy + pw * dx;
    let R = B * (C.rippleR0 + (C.rippleR1 - C.rippleR0) * smooth(0, 1, t)) * r.size;
    let W = B * C.rippleWidth * r.size;
    const du = pu - this.su;
    const dw = pw - this.sw;
    const gap = Math.sqrt(du * du + dw * dw) - this.hullHalf;
    const maxReach = Math.max(0, gap * C.rippleHullGap);
    const reach = R + C.rippleReach * W;
    if (reach > maxReach) {
      const s = maxReach / reach;
      R *= s;
      W *= s;
    }
    const f = 1 - t;
    r.r = R;
    r.w = W;
    r.amp = C.rippleStrength * f * f * Math.min(1, this.strength * 1.25) * Math.min(1.4, r.size);
  }
}
