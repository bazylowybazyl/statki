// Elektrownia geotermalna „KOREK” w wielkim gryzie Ziemi — materiały TSL brył (geometria: earthBitePlant*.js).
//   • metal — korek, obudowa dziury, kotwice wind, odbiornik, sprzęt promienia: CZARNA MEGASTRUKTURA (albedo 0,03–0,05,
//     anodowana); rodzaj powierzchni z atrybutu `aPart` (PART w earthBitePlantFrame.js: kadłub, stal, okna, listwy,
//     cewki, żar, światła pozycyjne, szkło). Czytelność daje światło: krawędzie płyt i żeber łapiące słońce, żar jeziora
//     od dołu i z boków, poświata promienia przy osi (obcięta — nie srebrzy), okluzja kontaktowa przy skale i pokładach;
//     emisja wg rodzaju (szwy i listwy pod progiem bloomu, światła i uzwojenia cewek — HDR).
//   • przepływ — pancerne przewody energii (ciemna rura, biegnące cyjanowe impulsy w wąskich szczelinach) i liny wind.
// Model światła i rzut pudełkowy — earthBitePlantCommon.tsl.js (wspólne z dodatkami komponentów). KADŁUB w dwóch
// poziomach: DUŻE PANELE 0,012–0,02 R w równej siatce (bez przesunięcia rzędów), na ścianach z PIONOWYM żebrowaniem
// (przęsła między żebrami usztywnień), na pokładach z siatką podpaneli; rzadkie luki serwisowe; rowki ~0,0004 R.
// Układ wzoru: walcowe współrzędne ramy (rzut pudełkowy) albo — dla części z własnym uv (aPart.z < 0, części
// przeciągane) — uv części. Detal gaśnie do średniej OSOBNO wzdłuż każdej osi wzoru (piksel wzdłuż u i v) — bez smug pod
// ostrym kątem i bez migotania z daleka; z daleka zostaje rytm świateł (rzędy lamp, linie kondygnacji okien, listwy).
// Graf RAZ na rodzaj materiału, wartości per obiekt w `material.uniforms`. Pochodne i maska słońca — na początku Fn
// (jawne przypisanie, pułapki 15, 29); rodzaje mieszane maskami (bez rozgałęzień na rodzaj).
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, varying, positionLocal, normalLocal, uv, modelWorldMatrix,
  abs, atan, clamp, cross, dFdx, dFdy, dot, exp, floor, fract, fwidth, length, max, min, mix, normalize, select, sign, sin,
  smoothstep
} from 'three/tsl';
import { sunVisibility } from './sunShadowMask.js';
import { PART } from './earthBitePlantFrame.js';
import {
  PLANT_COLORS, perObjectUniforms, sdown, step01, aaLine, partVarying, partKind, hash12, lodFade, aaBox, aaDot,
  plantHeat, plantLightContext, plantLighting, plantVar, plantEnv, plantSurfaceUv
} from './earthBitePlantCommon.tsl.js';

const TAU = Math.PI * 2;

/** 1 dla rodzaju k, 0 dla innych (rodzaj zaokrąglony — stały na trójkącie). */
const kindMask = (kind, k) => max(float(0.0), float(1.0).sub(abs(kind.sub(k))));

/** a2 = α² z chropowatości r (α = r²) + poszerzenie odblasku przy zmiennej normalnej w pikselu (bez iskrzenia z daleka). */
const roughA2 = (r, nPix) => clamp(r.mul(r).mul(r).mul(r).add(nPix.mul(nPix).mul(0.6)), 0.002, 1.0);

/** Odległość od krawędzi komórki (f — część ułamkowa, s — rozmiar komórki [R]). */
const edgeDist = (f, s) => min(f, float(1.0).sub(f)).mul(s);

/**
 * Widoczność OKRESOWEGO rzędu linii (żebra, podszwy, rowki, doliny stali) o okresie `period` [R]: pełna przy ≥ ~8 px,
 * zero przy ≤ ~3,3 px. Ostrzej niż lodFade — gęsty rząd linii o okresie 2–5 px czytał się jak ukośne kreskowanie
 * („karbon”) na częściach skośnych w rzucie.
 */
const lodLines = (pix, period) => sdown(0.12, 0.3, pix.div(period));

// ── Kadłub: duże panele (L1), podpanele / przęsła żeber (L2), rowki (L3), luki serwisowe, rzędy świateł ──────────────
// q — uv [R], pu / pv — piksel wzdłuż u / v [R], pix — piksel izotropowy, wall — 1 ściana (żebrowanie pionowe), 0 pokład,
// ring — 1 pokład w rzucie pudełkowym (u = ρφ, v = ρ): panele w pierścieniach, szwy promieniste (u liczone na środku
// pierścienia, nie spirale ρφ = const), uvMode — własne uv części (rozmiar paneli wg ziarna). W rzucie pudełkowym układ
// paneli NIE zależy od części (współpłaszczyznowe części wyglądają tak samo — bez migotania „z-fighting”, panele
// sąsiednich części w jednej siatce); ziarno daje tylko ton części (±3%).
function hullPanels(q0, pu, pv, pix, seed, time, wall, ring, uvMode) {
  const sv = vec2(17.0, 31.0);
  // DUŻE PANELE w równej siatce: 0,016 R (część z własnym uv: 0,013–0,019), na ścianach wyższe niż szersze
  const big = mix(float(0.016), float(0.013).add(fract(seed.mul(7.31)).mul(0.006)), uvMode);
  const P1 = plantVar(vec2(big, big.mul(mix(1.0, 1.35, wall))), 'vec2');
  const ringRho = floor(q0.y.div(P1.y)).add(0.5).mul(P1.y);
  const q = plantVar(vec2(mix(q0.x, q0.x.div(max(q0.y, 1e-3)).mul(ringRho), ring), q0.y), 'vec2');
  const c1 = plantVar(q.div(P1), 'vec2');
  const id1 = plantVar(floor(c1), 'vec2');
  const f1 = plantVar(fract(c1), 'vec2');
  const h1 = plantVar(hash12(id1.add(sv)));
  const h1b = plantVar(hash12(id1.add(sv).add(vec2(41.3, 17.9))));
  // PODPANELE: ściana — przęsła między pionowymi żebrami (~0,0026 R) × 2 w pionie; pokład — siatka 3 albo 4 (wg panelu)
  const nDeck = float(3.0).add(step01(fract(h1b.mul(13.1)), 0.5));
  const nRib = max(floor(P1.x.div(0.0026)), 4.0);
  const nSub = plantVar(mix(vec2(nDeck, nDeck), vec2(nRib, 2.0), wall), 'vec2');
  const c2 = plantVar(f1.mul(nSub), 'vec2');
  const f2 = plantVar(fract(c2), 'vec2');
  const h2 = plantVar(hash12(id1.mul(7.0).add(floor(c2)).add(sv).add(19.7)));
  const sub = plantVar(P1.div(nSub), 'vec2');
  // odległości od krawędzi [R] — osobno wzdłuż u i v (piksel wzdłuż osi)
  const e1u = plantVar(edgeDist(f1.x, P1.x));
  const e1v = plantVar(edgeDist(f1.y, P1.y));
  const e2u = plantVar(edgeDist(f2.x, sub.x));
  const e2v = plantVar(edgeDist(f2.y, sub.y));
  const lod1u = plantVar(lodFade(pu, P1.x));
  const lod1v = plantVar(lodFade(pv, P1.y));
  // podpanele i żebra — rzędy gęstych linii (ostrzejszy LOD)
  const lod2u = plantVar(lodLines(pu, sub.x));
  const lod2v = plantVar(lodLines(pv, sub.y));
  const lod1 = plantVar(min(lod1u, lod1v));
  const lod2 = plantVar(min(lod2u, lod2v));
  // LUK SERWISOWY (~4% dużych paneli): prostokąt w środku panelu, obrys wklęsły, ciemniejszy, bez podziałów
  const isHatch = plantVar(step01(h1b, 0.958));
  const hh = vec2(0.3, 0.27);
  const sdh = plantVar(min(hh.x.sub(abs(f1.x.sub(0.5))).mul(P1.x), hh.y.sub(abs(f1.y.sub(0.5))).mul(P1.y)));
  const inHatch = plantVar(isHatch.mul(step01(sdh, 0.0)));
  const hatchLine = plantVar(aaLine(abs(sdh), float(0.0001), pix).mul(isHatch).mul(lod1));
  // szwy wklęsłe (ciemne, matowe): duże panele — oba kierunki; podpanele — pokład oba, ściana tylko poziome
  const seam1 = plantVar(max(aaLine(e1u, float(0.00011), pu).mul(lod1u), aaLine(e1v, float(0.00011), pv).mul(lod1v)));
  const seam2D = max(aaLine(e2u, float(0.00005), pu).mul(lod2u), aaLine(e2v, float(0.00005), pv).mul(lod2v));
  const seam2W = aaLine(e2v, float(0.00005), pv).mul(lod2v);
  const seam2 = plantVar(mix(seam2D, seam2W, wall).mul(float(1.0).sub(inHatch)));
  // ŻEBRA USZTYWNIEŃ (ściana): wypukłe na granicach przęseł, cień kontaktowy przy żebrze
  const ribW = 0.00016;
  const lodRib = plantVar(lodFade(pu, ribW * 10.0).mul(wall).mul(float(1.0).sub(inHatch)));
  const rib = plantVar(aaBox(e2u, ribW, pu).mul(lod2u).mul(wall).mul(float(1.0).sub(inHatch)));
  const ribShadow = plantVar(aaLine(abs(e2u.sub(ribW * 1.7)), float(0.00004), pu).mul(lod2u).mul(wall)
    .mul(float(1.0).sub(inHatch)));
  const sgnU = select(f2.x.lessThan(0.5), float(1.0), float(-1.0));
  // profil żebra: płaski grzbiet, zaokrąglone boki (normalna od osi żebra), u podstawy wygaszenie
  const ribT = e2u.div(ribW);
  const ribTilt = sgnU.mul(smoothstep(0.4, 1.0, ribT)).mul(sdown(1.0, 1.3, ribT)).mul(0.25).mul(lodRib).mul(lod2u);
  // skos krawędzi dużego panelu (normalna ku najbliższej krawędzi — łapie słońce) + lekkie przekoszenie płyt
  const dirE = select(e1u.lessThan(e1v), vec2(sign(f1.x.sub(0.5)), 0.0), vec2(0.0, sign(f1.y.sub(0.5))));
  const bevel = sdown(0.0, 0.0003, min(e1u, e1v)).mul(min(lodFade(pu, 0.0008), lodFade(pv, 0.0008)));
  const tilt = plantVar(dirE.mul(bevel.mul(0.5)).add(vec2(ribTilt, 0.0))
    .add(vec2(h1.sub(0.5), h1b.sub(0.5)).mul(lod1.mul(0.03))), 'vec2');
  // rowki (L3) na ~20% podpaneli — wzdłuż u albo v
  const gAxis = step01(h2, 0.9);
  const gc = mix(q.y, q.x, gAxis).div(0.0004);
  const pg = mix(pv, pu, gAxis);
  const groove = plantVar(aaLine(abs(fract(gc).sub(0.5)).mul(0.0004), float(0.00005), pg).mul(lodLines(pg, 0.0004))
    .mul(step01(h2, 0.8)).mul(float(1.0).sub(inHatch)));
  // TON: rozrzut ±5% (panel), ±4% (podpanel), ±5% (część) — czarny anodowany kadłub, nie mozaika
  const tone = plantVar(mix(1.0, float(0.95).add(h1.mul(0.1)), lod1)
    .mul(mix(1.0, float(0.96).add(h2.mul(0.08)), lod2))
    .mul(float(0.97).add(fract(seed.mul(91.7)).mul(0.06)))
    .mul(mix(1.0, 0.8, inHatch.mul(lod1)))
    .mul(float(1.0).add(rib.mul(0.06)))
    .mul(max(float(1.0).sub(seam1.mul(0.75)).sub(seam2.mul(0.5)).sub(groove.mul(0.3)).sub(ribShadow.mul(0.3))
      .sub(hatchLine.mul(0.7)), 0.08)));
  // matowa czarna powłoka (szeroki, słaby odblask słońca — wierzch nie srebrzy w kierunku lustrzanym), panele różnią się
  // połyskiem; KRAWĘDZIE wytarte do metalu (gładsze, mocniejsze odbicie) — łapią słońce cienką linią, grzbiety żeber też
  const wear = plantVar(sdown(0.00004, 0.00028, min(e1u, e1v)).mul(min(lodFade(pu, 0.0012), lodFade(pv, 0.0012)))
    .mul(float(1.0).sub(seam1)).add(rib.mul(0.6)));
  // powłoka matowa (0,72–0,76): szeroki odblask słońca z góry nie szarzeje całych płyt i pokładów (runda 3 — czarna
  // megastruktura), wytarte krawędzie zostają gładsze
  const rough = plantVar(mix(0.72, float(0.66).add(h1.mul(0.1)), lod1).add(h2.sub(0.5).mul(0.08).mul(lod2))
    .add(seam1.mul(0.2)).add(groove.mul(0.12)).add(inHatch.mul(0.05)).sub(wear.mul(0.34)));
  // rzadkie podpanele bez powłoki (mocniejszy odblask) — ~1,5%
  const f0 = plantVar(float(0.022).add(step01(h2, 0.985).mul(lod2).mul(0.035)).add(wear.mul(0.045)));
  // RZĘDY ŚWIATEŁ: część poziomych szwów dużych paneli świeci pod progiem, lampy co 0,0077 R (HDR) na ~co trzecim
  // szwie — z daleka rytm, nie siatka białych kropek na całych pasach okładziny
  const seamI = plantVar(floor(q.y.div(P1.y).add(0.5)));
  const dv = plantVar(q.y.sub(seamI.mul(P1.y)));
  const rowOn = plantVar(step01(hash12(vec2(seamI, sv.y.add(3.3))), 0.68));
  const glowSeam = plantVar(aaLine(abs(dv), float(0.00007), pv).mul(rowOn));
  const lampI = floor(q.x.div(0.0077));
  const lu = fract(q.x.div(0.0077)).sub(0.5).mul(0.0077);
  const hl = plantVar(hash12(vec2(lampI, seamI.add(7.0))));
  const red = plantVar(step01(hl, 0.82));
  const bx = plantVar(fract(time.mul(0.35).add(hl.mul(5.0))));
  const blink = mix(1.0, smoothstep(0.0, 0.04, bx).mul(sdown(0.3, 0.42, bx)).mul(0.9).add(0.1), red);
  const lamp = plantVar(aaDot(length(vec2(lu, dv)), 0.0002, pix).mul(rowOn).mul(blink));
  const lampCol = plantVar(mix(vec3(3.6, 3.0, 2.2), vec3(4.0, 0.4, 0.16), red), 'vec3');
  const hv = plantVar(mix(0.5, h2, lod2));
  return {
    tone, rough, f0, tilt, occ: plantVar(float(1.0).sub(seam1.mul(0.8)).sub(ribShadow.mul(0.4))), glowSeam, lamp,
    lampCol, hv, seam: plantVar(max(seam1, seam2D.mul(float(1.0).sub(inHatch)))), lod2
  };
}

// ── Stal konstrukcyjna: szczotkowanie (smugi wzdłuż u), drobne żebrowanie, bez szwów i okien ─────────────────────────
function structDetail(q, pu, pv, seed) {
  // smugi i żebrowanie od położenia (nie od części — współpłaszczyznowe części bez migotania), ton części ±8%
  const streak = (scale, k) => {
    const sv = plantVar(q.y.div(scale).add(7.0 * k));
    const i = plantVar(floor(sv));
    const fr = plantVar(fract(sv));
    const sm = fr.mul(fr).mul(float(3.0).sub(fr.mul(2.0)));
    return mix(0.5, mix(hash12(vec2(i, k)), hash12(vec2(i.add(1.0), k)), sm), lodFade(pv, scale * 2.5));
  };
  const st = plantVar(streak(0.00011, 3.1).mul(0.5).add(streak(0.00037, 7.7).mul(0.5)));
  // żebrowanie WZDŁUŻ u (równolegle do szczotkowania — bez kratki „karbon” z dwóch rzędów linii w poprzek siebie)
  const rx = plantVar(fract(q.y.div(0.0009)));
  const lodR = plantVar(lodLines(pv, 0.0009));
  const valley = plantVar(aaLine(min(rx, float(1.0).sub(rx)).mul(0.0009), float(0.00006), pv).mul(lodR));
  // kontrast niski: na częściach skośnych względem ramy (żebra obudowy, wsporniki) rzut pudełkowy kładzie smugi
  // w poprzek części — przy mocnym kontraście czytały się jak ukośne kreskowanie; doliny żebrowania gasną, zanim ich
  // rząd zgęstnieje do ~3 px. Szorstkość ≥ 0,6 — grzbiety nie łapią szarego połysku
  const part = float(0.56).add(fract(seed.mul(71.3)).mul(0.1));
  const tone = part.mul(float(0.94).add(st.mul(0.12))).mul(float(1.0).sub(valley.mul(0.14)));
  const rough = float(0.6).add(st.mul(0.1)).add(valley.mul(0.08));
  return { tone: plantVar(tone), rough: plantVar(rough), tilt: plantVar(vec2(0.0, sin(rx.mul(TAU)).mul(0.06).mul(lodR)), 'vec2') };
}

// ── Okna: z bliska szczeliny w rzędach (bloki 4 × 4 = pomieszczenia, zapalone wg gęstości z), DALEJ — jedna ostra
// zapalona LINIA na kondygnację (nasycony bursztyn w HDR ~1–1,5, jasność zmienia się wolno wzdłuż u, okres ≥ 0,013 R)
// na czarnym pasie (bez równej poświaty pasa — z daleka to były beżowe „kafle”). Linia drobniejsza niż piksel grubieje
// do piksela z zachowaniem energii; dopiero gdy linie są gęstsze niż ~2,5 px — średnia. Przeważnie bursztyn, co ósmy
// blok / kondygnacja chłodne. Poziom szczegółu osobno wzdłuż u i v (pu, pv).
// Część z własnym uv (uvMode — pasy fasady korony i galerii, ~0,0045 R): pas = JEDNA kondygnacja (8 rzędów okien,
// linia kondygnacji w środku pasa, uv.y od krawędzi pasa), rzut pudełkowy — kondygnacje co 0,002 R (4 rzędy), z daleka
// co trzecia (0,006 R). lit — słońce (za dnia szczeliny przygasają mocniej niż linie kondygnacji). Zwraca szczelinę
// (szkło) i emisję.
const WIN_BAND = 0.0045;
function windowSlots(q, pu, pv, pix, seed, dens, uvMode, lit) {
  const rowH = plantVar(mix(0.0005, WIN_BAND / 8.0, uvMode));
  const colW = 0.0011;
  const floorH = plantVar(mix(0.002, WIN_BAND, uvMode));
  const wv = plantVar(q.y.div(rowH));
  const row = plantVar(floor(wv));
  const blockRow = plantVar(floor(row.mul(0.25)));
  const wu = plantVar(q.x.div(colW).add(hash12(vec2(blockRow, seed.mul(41.0))).mul(8.0)));
  const col = plantVar(floor(wu));
  const lodV = plantVar(sdown(0.12, 0.3, pv.div(rowH)));
  const lodU = plantVar(sdown(0.25, 0.5, pu.div(colW)));
  const lodB = plantVar(sdown(0.25, 0.5, pv.div(rowH.mul(4.0))));
  const lodW = min(lodU, lodV);
  const slotV = mix(0.26, aaBox(abs(fract(wv).sub(0.5)).mul(rowH), rowH.mul(0.13), pv), lodV);
  const slotU = mix(0.6, aaBox(abs(fract(wu).sub(0.5)).mul(colW), colW * 0.3, pu), lodU);
  const slot = plantVar(slotV.mul(slotU));
  const hb = plantVar(hash12(vec2(blockRow.add(seed.mul(17.0)), floor(col.mul(0.25)))));
  // okno w zapalonym bloku: 85% zapalonych, jasność 0,65–1,35
  const hw = plantVar(hash12(vec2(row.mul(1.7), col.add(seed.mul(23.0)))));
  const winLit = mix(0.85, float(1.0).sub(step01(hw, 0.85)).mul(float(0.65).add(fract(hw.mul(13.7)).mul(0.7))), lodW);
  const amber = vec3(1.0, 0.5, 0.2);
  const cool = vec3(0.62, 0.8, 1.0);
  const blockLit = step01(dens, hb);
  const near = plantVar(slot.mul(blockLit).mul(winLit));
  const tintNear = mix(amber, cool, step01(fract(hb.mul(7.9)), 0.875));
  // LINIE KONDYGNACJI: zapalona linia w środku kondygnacji, jasność wolno zmienna wzdłuż u; w rzucie pudełkowym, gdy
  // linie gęstnieją poniżej ~5 px, zostaje co trzecia (jaśniejsza ×3 — ta sama energia), dwie pozostałe gasną
  const fl = plantVar(floor(q.y.div(floorH)));
  const dl = abs(fract(q.y.div(floorH)).sub(0.5)).mul(floorH);
  const thin = plantVar(float(1.0).sub(uvMode).mul(smoothstep(0.2, 0.32, pv.div(floorH))));
  const keep = float(1.0).sub(step01(abs(fl.sub(floor(fl.div(3.0)).mul(3.0)).sub(1.0)), 0.5));
  const thinW = mix(float(1.0).sub(thin), mix(1.0, 3.0, thin), keep);
  const P = plantVar(floorH.mul(mix(1.0, 3.0, thin)));
  const lw = plantVar(mix(0.00021, 0.00026, uvMode));
  const line = aaLine(dl, lw, pv).mul(thinW);
  const su = plantVar(q.x.div(0.013).add(hash12(vec2(fl, seed.mul(29.0))).mul(17.0)));
  const si = floor(su);
  const sf = fract(su);
  const ss = sf.mul(sf).mul(float(3.0).sub(sf.mul(2.0)));
  const hFl = plantVar(hash12(vec2(fl, seed.mul(37.0).add(5.0))));
  const vary = mix(hash12(vec2(si, fl.add(seed.mul(11.0)))), hash12(vec2(si.add(1.0), fl.add(seed.mul(11.0)))), ss);
  const floorLit = smoothstep(float(0.92).sub(dens), float(1.12).sub(dens), vary.mul(0.7).add(hFl.mul(0.3)));
  // z daleka linia jaśniejsza (energia linii grubszej niż piksel rozkłada się na piksel — bez tego gaśnie); nasycony
  // bursztyn (po ACES nie krem)
  const farK = plantVar(float(1.0).sub(lodFade(pv, lw.mul(6.0))));
  const mid = plantVar(line.mul(floorLit).mul(mix(1.25, 3.2, farK)));
  const amberL = vec3(1.0, 0.36, 0.08);
  const tintMid = mix(amberL, vec3(0.45, 0.72, 1.0), step01(fract(hFl.mul(5.3)), 0.875));
  // średnia (linie gęstsze niż ~2,5 px): energia linii na kondygnację (∫ linii aaLine = lw), ciemniej niż dawna poświata
  const lodL = plantVar(sdown(0.3, 0.42, pv.div(P)));
  const far = dens.mul(0.7).mul(lw).div(floorH).mul(3.2);
  const emitMid = mix(mix(amberL, cool, 0.125).mul(far), tintMid.mul(mid), lodL).mul(float(1.0).sub(lit.mul(0.25)));
  const emit = mix(emitMid, tintNear.mul(near).mul(float(1.0).sub(lit.mul(0.6))).mul(1.5), lodB.mul(lodV));
  return { slot, emit: plantVar(emit, 'vec3') };
}

// ── Listwa: z bliska ciemna obudowa ze świetlnymi rurkami wzdłuż u (co 0,0007 R w poprzek; rdzeń jaśniejszy, wokół
// poświata), segmenty co 0,0025 R; gdy rurki są drobniejsze niż piksel — równa poświata pasa (z daleka listwa to ostra
// linia światła: korona, galerie, pierścienie). Barwa nasycona (bursztyn / cyjan — po ACES nie krem). W części z własnym
// uv pierwsza rurka 0,00035 R od krawędzi pasa. Zwraca jasność × barwa bazowa (1 = poświata z daleka).
function stripLight(q, pu, pv, pix, uvMode) {
  const P = 0.0007;
  const v0 = mix(0.0, 0.00035, uvMode);
  const lv = abs(fract(q.y.sub(v0).div(P).add(0.5)).sub(0.5)).mul(P);
  const core = aaLine(lv, float(0.00007), pv).mul(1.7);
  const halo = aaLine(lv, float(0.00024), pv).mul(0.22);
  const tubes = mix(float(1.0), core.add(halo).add(0.04), lodFade(pv, P));
  const su = fract(q.x.div(0.0025));
  const seg = aaLine(min(su, float(1.0).sub(su)).mul(0.0025), float(0.00009), pu).mul(lodFade(pu, 0.0025));
  return plantVar(tubes.mul(float(1.0).sub(seg.mul(0.8))));
}

// ── Metal: korek, obudowa, kotwice, odbiornik ──────────────────────────────────────────────────────────────────────
function buildMetalGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const vLocal = varying(positionLocal, 'vPlantLocal');
  const vNormal = varying(normalLocal, 'vPlantNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vPlantWorld');
  const vPart = partVarying();
  const vUv = uv();
  const fragmentNode = Fn(() => {
    // pochodne i maska słońca PRZED gałęziami (jawne przypisanie)
    const pix = float(0.0).toVar();
    pix.assign(max(length(fwidth(vLocal)), 1e-7));
    const nPix = float(0.0).toVar();
    nPix.assign(length(fwidth(vNormal)));
    const dpx = plantVar(dFdx(vLocal), 'vec3');
    const dpy = plantVar(dFdy(vLocal), 'vec3');
    const duvx = plantVar(dFdx(vUv), 'vec2');
    const duvy = plantVar(dFdy(vUv), 'vec2');
    const sunVisP = float(1.0).toVar();
    sunVisP.assign(mix(1.0, sunVisibility(), U.uSunShadowRecv));
    const p = plantVar(vLocal, 'vec3');
    const n0 = plantVar(vNormal.div(max(length(vNormal), 1e-6)), 'vec3');
    const C = plantLightContext(U, p, vWorld, sunVisP);
    const time = U.uPlantTime;
    const kind = plantVar(partKind(vPart));
    const seed = plantVar(vPart.y);
    const kHull = plantVar(kindMask(kind, PART.HULL));
    const kStruct = plantVar(kindMask(kind, PART.STRUCT));
    const kWin = plantVar(kindMask(kind, PART.WINDOW));
    const kStrip = plantVar(kindMask(kind, PART.STRIP));
    const kGlass = plantVar(kindMask(kind, PART.GLASS));
    const kHot = plantVar(kindMask(kind, PART.HOT));
    const kPlate = plantVar(kHull.add(kWin).add(kHot));
    // WŁASNE uv części: z < 0 przy kadłubie, stali, oknach, listwach i żarze (|z| — parametr rodzaju)
    const uvKinds = kPlate.add(kStruct).add(kStrip);
    const uvMode = plantVar(step01(vPart.z.negate(), 0.0).mul(uvKinds));
    const zA = plantVar(abs(vPart.z));
    const zOr = (d) => select(zA.greaterThan(0.0), zA, float(d));
    const wOr = (d) => select(vPart.w.greaterThan(0.0), vPart.w, float(d));

    // układ wzoru (rzut pudełkowy albo uv części), piksel wzdłuż osi wzoru, detal
    const B = plantSurfaceUv(C, n0, seed, vUv, uvMode, dpx, dpy, duvx, duvy);
    // żar: zawsze siatka płyt (szwy w obu kierunkach)
    const wallH = plantVar(B.wall.mul(float(1.0).sub(kHot)));
    const H = hullPanels(B.uv, B.pu, B.pv, pix, seed, time, wallH, float(1.0).sub(wallH).mul(float(1.0).sub(B.uvMode))
      .mul(B.deck), B.uvMode);
    const S = structDetail(B.uv, B.pu, B.pv, seed);
    const W = windowSlots(B.uv, B.pu, B.pv, pix, seed, zOr(0.5), B.uvMode, C.lit);
    const kOther = plantVar(float(1.0).sub(kPlate).sub(kStruct).sub(kGlass));
    const winGlass = plantVar(W.slot.mul(kWin));
    // brud i sadza (~0,011 R, plamy szumu wartości; przy jeziorze ciemniej) — kadłub i stal, z daleka zostaje
    const gq = B.uv.div(0.011).add(seed.mul(5.3));
    const gi = plantVar(floor(gq), 'vec2');
    const gf = fract(gq);
    const gs = plantVar(gf.mul(gf).mul(float(3.0).sub(gf.mul(2.0))), 'vec2');
    const vn = mix(mix(hash12(gi), hash12(gi.add(vec2(1.0, 0.0))), gs.x),
      mix(hash12(gi.add(vec2(0.0, 1.0))), hash12(gi.add(vec2(1.0, 1.0))), gs.x), gs.y);
    const grime = plantVar(smoothstep(0.5, 0.9, vn).mul(0.1).mul(lodFade(pix, 0.011))
      .add(clamp(C.lakeE.mul(0.06), 0.0, 0.22)).mul(kPlate.add(kStruct)));
    // POKŁADY (powierzchnie poziome, |n·A| > ~0,8 — wierzch korka, pierścienie zamknięcia, dachy): w słońcu z góry
    // ciemniej o ~15% (albedo i odbicie na wprost — matowy odblask powłoki dominuje na wierzchu) — czarna megastruktura
    const deckK = plantVar(mix(1.0, 0.85, smoothstep(0.78, 0.9, abs(dot(n0, C.A))).mul(kPlate.add(kStruct))));
    // płyty żaru: niskie albedo (sadza, nalot)
    const tone = plantVar(H.tone.mul(kPlate.mul(0.85)).mul(mix(1.0, 0.55, kHot)).add(S.tone.mul(kStruct))
      .add(kOther.mul(0.8)).add(kGlass.mul(0.3))
      .mul(float(1.0).sub(winGlass.mul(0.7))).mul(float(1.0).sub(grime)).mul(deckK));
    const rough = H.rough.mul(kPlate).add(S.rough.mul(kStruct)).add(kOther.mul(0.45)).add(kGlass.mul(0.07)).add(grime.mul(0.5))
      .add(kHot.mul(0.12));
    const roughW = plantVar(mix(rough, 0.1, winGlass));
    const f0 = plantVar(H.f0.mul(kPlate).add(kStruct.mul(0.032)).add(kOther.mul(0.04)).add(kGlass.mul(0.06)).mul(deckK));
    const tilt = plantVar(H.tilt.mul(kPlate).add(S.tilt.mul(kStruct)), 'vec2');
    const n = plantVar(normalize(n0.add(B.tu.mul(tilt.x)).add(B.tv.mul(tilt.y))), 'vec3');
    const albedo = vec3(...T.metal).mul(tone);
    const specOcc = mix(1.0, H.occ, kPlate);
    const col = plantVar(plantLighting(C, n, albedo, roughA2(roughW, nPix), f0, specOcc), 'vec3');

    // szkło (i szyby okien): odbicie otoczenia, żaru i promienia z Fresnelem
    const R = plantVar(C.V.negate().sub(n.mul(dot(n, C.V.negate()).mul(2.0))), 'vec3');
    const fc = float(1.0).sub(max(dot(n, C.V), 0.0));
    const fc2 = fc.mul(fc);
    const fr = float(0.05).add(fc2.mul(fc2).mul(fc).mul(0.95));
    const rb = max(dot(R, C.beamDir), 0.0);
    const rb4 = rb.mul(rb).mul(rb).mul(rb);
    const rb16 = rb4.mul(rb4).mul(rb4).mul(rb4);
    const glassEnv = plantEnv(C, R).mul(1.4)
      .add(vec3(...T.lava).mul(C.lakeE.mul(max(dot(R, C.lakeDir), 0.0)).mul(0.12)))
      .add(vec3(...T.beam).mul(C.beamE.mul(rb16).mul(0.08)));
    col.addAssign(glassEnv.mul(fr).mul(kGlass.add(winGlass)));

    // KADŁUB: świecące szwy rzędów świateł (pod progiem bloomu; ciepłe w gryzie, chłodne na orbicie) i lampy
    const seamCol = mix(vec3(0.42, 0.75, 1.0).mul(0.36), vec3(1.0, 0.5, 0.17).mul(0.42), C.bowl);
    col.addAssign(seamCol.mul(H.glowSeam).add(H.lampCol.mul(H.lamp)).mul(kHull));
    // OKNA: nocą świecą, w pełnym słońcu szczeliny przygasają (dominuje odblask szyby), linie kondygnacji — mniej
    col.addAssign(W.emit.mul(kWin));
    // LISTWA: z — jasność, w — 0 ciepła (bursztyn) / 1 chłodna (cyjan, wolny przepływ); świetlne rurki w ciemnej obudowie
    const coolF = step01(vPart.w, 0.5);
    const flowS = mix(1.0, sin(B.uv.x.div(0.012).sub(time.mul(0.35)).mul(TAU)).mul(0.22).add(0.82), coolF);
    const stripCol = mix(vec3(0.95, 0.3, 0.06), vec3(0.06, 0.42, 1.0), coolF);
    col.addAssign(stripCol.mul(zOr(1.0)).mul(flowS).mul(stripLight(B.uv, B.pu, B.pv, pix, B.uvMode)).mul(kStrip));
    // CEWKA: puls z fazą z, uzwojenia (jasne linie w poprzek, ciemne przerwy); w = −1 — wskaźnik magazynu (jasność wg
    // naładowania, szybszy puls przy przekazie)
    const store = vPart.w.lessThan(-0.5);
    const coilRate = select(store, mix(1.2, 6.0, U.uPlantState.x), float(3.0));
    const coilPulse = float(0.75).add(sin(time.mul(coilRate).sub(vPart.z.mul(TAU))).mul(0.25));
    const coilGain = select(store, U.uPlantState.y.mul(U.uPlantState.y).mul(1.6).add(0.08), wOr(1.0));
    const cu = fract(B.uv.x.div(0.0007));
    const windDuty = 2 * 0.00012 / 0.0007;
    const wind = mix(float(windDuty), aaLine(min(cu, float(1.0).sub(cu)).mul(0.0007), float(0.00012), B.pu),
      lodFade(B.pu, 0.0007));
    // ciało cewki — ciemny cyjan, uzwojenia — nasycony cyjan z białym rdzeniem (HDR tylko w rdzeniu drutu)
    const wCore = mix(float(windDuty * 0.35), aaLine(min(cu, float(1.0).sub(cu)).mul(0.0007), float(0.00004), B.pu),
      lodFade(B.pu, 0.0007));
    const coil = vec3(0.1, 0.5, 1.0).mul(0.12).add(vec3(0.12, 0.55, 1.0).mul(wind.mul(1.15)))
      .add(vec3(...T.beamCore).mul(wCore.mul(2.2)))
      .mul(coilPulse.mul(coilGain).mul(U.uPlantBeam.x));
    col.addAssign(coil.mul(kindMask(kind, PART.COIL)));
    // ŻAR: ciemne płyty z GORĄCYMI szwami (rampa ciała doskonale czarnego wg z — gradient ku źródłu ciepła, per
    // wierzchołek), każda płyta trochę inna temperatura, lekkie falowanie; z daleka średnia płyt i szwów
    const wave = sin(B.uv.x.mul(900.0).add(time.mul(0.8))).mul(sin(B.uv.y.mul(700.0).sub(time.mul(0.6))));
    const heatZ = plantVar(zOr(0.0));
    // płyta ~0,35–0,47 żaru szwu (ciemna czerwień — sadza na stygnącej blasze), szew — pełny żar (żółć w HDR)
    const plateHeat = plantHeat(heatZ.mul(float(0.35).add(H.hv.mul(0.12)).add(wave.mul(0.03))));
    const seamHeat = plantHeat(heatZ.mul(float(1.04).add(wave.mul(0.04))));
    const seamAvg = float(1.0).sub(H.lod2).mul(0.16);
    col.addAssign(mix(plateHeat, seamHeat, clamp(H.seam.add(seamAvg), 0.0, 1.0)).mul(kHot));
    // ŚWIATŁO POZYCYJNE: ostre mrugnięcie (z — częstotliwość, faza z ziarna), w — 0 czerwone / 1 białe
    const bx = fract(time.mul(zOr(0.5)).add(seed.mul(7.7)));
    const flash = smoothstep(0.0, 0.01, bx).mul(exp(bx.mul(-28.0))).mul(6.0).add(0.06);
    const beacon = mix(vec3(1.0, 0.09, 0.04), vec3(1.0, 0.96, 0.88), step01(vPart.w, 0.5)).mul(flash);
    col.addAssign(beacon.mul(kindMask(kind, PART.BEACON)));
    // GARDZIEL wylotu (ściany zwrócone ku osi, lej i szyb): ciemne ściany z emisyjnymi pierścieniami przy krawędzi
    // (słabną w głąb), biała gorączka tylko na dnie szybu
    const apR = U.uPlantCork.w;
    const apH = U.uPlantCork.z;
    const throat = plantVar(sdown(apR.mul(1.05), apR.mul(1.75), C.rho).mul(sdown(apH.sub(0.003), apH.add(0.002), C.y)).mul(C.bowl)
      .mul(max(dot(n0, C.out.negate()), 0.0).mul(0.75).add(0.25)));
    const depth = plantVar(clamp(apH.sub(C.y).div(max(apH, 1e-3)), 0.0, 1.0));
    const sThr = apH.sub(C.y).add(apR.mul(1.75).sub(C.rho));
    const ringD = abs(fract(sThr.div(0.0032)).sub(0.5)).mul(0.0032);
    const rings = aaLine(ringD, float(0.00014), pix).mul(sdown(0.08, 0.5, depth)).mul(lodFade(pix, 0.0032))
      .add(sdown(0.08, 0.5, depth).mul(float(1.0).sub(lodFade(pix, 0.0032))).mul(0.09));
    const heat = smoothstep(0.62, 1.0, depth);
    const throatCol = vec3(...T.beam).mul(rings.mul(1.5).add(0.015))
      .add(vec3(...T.beamCore).mul(heat.mul(heat).mul(1.5)));
    col.addAssign(throatCol.mul(throat.mul(U.uPlantBeam.x)));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { fragmentNode };
}

// ── Przepływ: pancerne przewody energii i liny wind ────────────────────────────────────────────────────────────────
function buildFlowGraph() {
  const U = perObjectUniforms();
  const T = PLANT_COLORS;
  const vLocal = varying(positionLocal, 'vFlowLocal');
  const vNormal = varying(normalLocal, 'vFlowNormal');
  const vWorld = varying(modelWorldMatrix.mul(vec4(positionLocal, 1.0)).xyz, 'vFlowWorld');
  const vPart = partVarying('vFlowPart');
  const vUv = uv();
  const fragmentNode = Fn(() => {
    const pix = float(0.0).toVar();
    pix.assign(max(length(fwidth(vLocal)), 1e-7));
    const nPix = float(0.0).toVar();
    nPix.assign(length(fwidth(vNormal)));
    const sunVisP = float(1.0).toVar();
    sunVisP.assign(mix(1.0, sunVisibility(), U.uSunShadowRecv));
    // kierunek osi przewodu: gradient uv.y na powierzchni z pochodnych ekranowych (też przed gałęziami)
    const dpx = plantVar(dFdx(vLocal), 'vec3');
    const dpy = plantVar(dFdy(vLocal), 'vec3');
    const dvx = plantVar(dFdx(vUv.y));
    const dvy = plantVar(dFdy(vUv.y));
    const p = plantVar(vLocal, 'vec3');
    const n = plantVar(vNormal.div(max(length(vNormal), 1e-6)), 'vec3');
    const C = plantLightContext(U, p, vWorld, sunVisP);
    const time = U.uPlantTime;
    const kTether = plantVar(kindMask(partKind(vPart), PART.TETHER));
    const s = plantVar(vUv.y.mul(max(vPart.z, 1e-4)));
    const dirW = select(vPart.w.lessThan(0.0), float(-1.0), float(1.0));
    // PRZEWÓD: pancerne opaski co 0,01 R (z daleka — średnia), pakiety energii z ostrym czołem i miękkim ogonem
    const bs = fract(s.div(0.01));
    const collar = mix(0.14, aaBox(min(bs, float(1.0).sub(bs)).mul(0.01), 0.0007, pix), lodFade(pix, 0.0014));
    const pq = fract(s.mul(dirW).div(0.03).sub(time.mul(0.6)));
    const front = sdown(float(1.0).sub(max(pix.div(0.03).mul(1.5), 0.004)), 1.0, pq);
    const pq2 = pq.mul(pq);
    const pq4 = pq2.mul(pq2);
    const pq8 = pq4.mul(pq4);
    const pq16 = pq8.mul(pq8);
    const packet = plantVar(pq16.mul(3.4).add(pq4.mul(pq).mul(0.22)).mul(front));
    // pancerz: trzy WĄSKIE szczeliny wzdłuż osi (co 120°, pierwsza od strony osi gryzu), energia widoczna w szczelinach,
    // pakiet prześwieca przez pancerz (z daleka — biegnące impulsy na ciemnej linii); kąt wokół osi z normalnej, piksel
    // kątowy = |fwidth(n)|
    const xx = dot(dpx, dpx);
    const yy = dot(dpy, dpy);
    const xy = dot(dpx, dpy);
    const det = max(xx.mul(yy).sub(xy.mul(xy)), xx.mul(yy).mul(1e-4).add(1e-30));
    const g = dpx.mul(dvx.mul(yy).sub(dvy.mul(xy))).add(dpy.mul(dvy.mul(xx).sub(dvx.mul(xy)))).div(det);
    const tAx = plantVar(g.div(max(length(g), 1e-12)), 'vec3');
    const r0a = C.A.sub(tAx.mul(dot(C.A, tAx)));
    const r0b = C.out.sub(tAx.mul(dot(C.out, tAx)));
    const r0 = plantVar(select(length(r0a).greaterThan(0.3), r0a, r0b), 'vec3');
    const r0n = plantVar(r0.div(max(length(r0), 1e-4)), 'vec3');
    const th = atan(dot(n, cross(tAx, r0n)), dot(n, r0n).add(1e-6));
    const dth = abs(fract(th.mul(3.0 / TAU).add(0.5)).sub(0.5)).mul(TAU / 3.0);
    const slitW = 0.07;
    // szczelina ostra, dopóki ma ≥ ~1 px (aaBox grubieje do piksela), potem średnia
    const slitLod = plantVar(sdown(0.6, 1.2, nPix.div(slitW * 2.0)));
    const slit = plantVar(mix(3.0 * slitW * 2.0 / TAU, aaBox(dth, slitW, max(nPix, 1e-4)), slitLod));
    // pakiet w szczelinie ≤ ~1,7 × barwa promienia (lekki bloom, po ACES zostaje cyjan, nie biel); prześwit pakietu przez
    // pancerz tylko z daleka (szczeliny drobniejsze niż piksel — biegnący impuls na ciemnej linii), z bliska słaby —
    // inaczej cała rura świeci bladym cyjanem jak plastik
    // prześwit wg szerokości rury na ekranie (π / nPix px): rura węższa niż ~5 px — impuls na ciemnej linii (nasycony
    // cyjan, nie blady), szersza niż ~12 px — zero (cyjan tylko w szczelinach; prześwit z ogonem pakietu barwił całe
    // przęsła rury między opaskami bladym cyjanem)
    const armorGlow = smoothstep(0.25, 0.6, nPix).mul(0.14);
    const pipeEmit = vec3(...T.beam).mul(slit.mul(packet.mul(0.45).add(0.15)))
      .add(vec3(0.1, 0.55, 1.0).mul(packet.mul(armorGlow)))
      .mul(float(1.0).sub(collar.mul(0.9))).mul(U.uPlantBeam.x);
    // LINA: światła prowadzące co 0,03 R (co czwarte czerwone), fala jasności w górę; kabiny jeżdżą na GPU (dodatek
    // wind) — w materiale liny ich nie ma. Światło na samych końcach liny (kotwica s ≈ 0, dok na szynie s ≈ z) zgaszone:
    // przy czołach doków świeciłoby jak reflektor; gaśnie wg położenia LAMPY (cała lampa, nie jej połowa)
    const gs = s.div(0.03);
    const gi = floor(gs.add(0.5));
    const sc = gi.mul(0.03);
    const ends = smoothstep(0.012, 0.026, sc).mul(smoothstep(0.012, 0.026, max(vPart.z, 1e-4).sub(sc)));
    const guide = aaDot(abs(gs.sub(gi)).mul(0.03), 0.0006, pix).mul(ends);
    const chase = sdown(0.0, 0.18, fract(gi.mul(0.05).sub(time.mul(0.15))));
    const red = step01(fract(gi.mul(0.25)), 0.7);
    const tetherEmit = mix(vec3(2.6, 2.4, 2.1), vec3(3.0, 0.3, 0.12), red).mul(guide.mul(chase.mul(0.75).add(0.25)));
    // światło: pancerz — ciemny metal (F0 0,04, szorstkość 0,45; opaski gładsze), lina gładsza; odblask poświaty promienia
    // NEUTRALNY i słabszy (×0,5) — cyjan tylko w szczelinach i pakietach, nie bladocyjanowy połysk wzdłuż rury
    const tone = mix(mix(0.7, 0.9, collar).mul(float(1.0).sub(slit.mul(0.6))), 0.9, kTether);
    const rough = mix(mix(0.45, 0.38, collar), 0.42, kTether);
    const col = plantVar(plantLighting(C, n, vec3(...T.metal).mul(tone), roughA2(rough, nPix), mix(0.04, 0.05, collar),
      float(1.0), { beamSpec: 0.5, beamSpecTint: 0.15 }), 'vec3');
    col.addAssign(mix(pipeEmit, tetherEmit, kTether));
    return vec4(max(col, vec3(0.0)), 1.0);
  })();
  return { fragmentNode };
}

const GRAPHS = {};
function graph(kind) {
  GRAPHS[kind] ??= kind === 'metal' ? buildMetalGraph() : buildFlowGraph();
  return GRAPHS[kind];
}

function opaque(name, kind, uniforms) {
  const m = new THREE.NodeMaterial();
  m.name = name;
  m.uniforms = uniforms;
  m.fragmentNode = graph(kind).fragmentNode;
  m.lights = false;
  m.fog = false;
  return m;
}

export const createPlantMetalMaterial = (uniforms) => opaque('EarthBitePlantMetal', 'metal', uniforms);
export const createPlantFlowMaterial = (uniforms) => opaque('EarthBitePlantFlow', 'flow', uniforms);
