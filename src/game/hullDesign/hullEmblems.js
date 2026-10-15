// src/game/hullDesign/hullEmblems.js
//
// KREATOR KADŁUBÓW — emblematy wektorowe (czyste dane; własne kształty, bez cudzych znaków). Emblemat = lista
// konturów w polu 100 × 100 (y w dół), wypełnianych parzysto-nieparzyście (otwór = kontur wewnątrz konturu).
// Atlas naklejek (src/3d/hullDesign/hullDecalAtlas.js) rysuje je do tekstury; docelowo zestaw robi grafik.

function circle(cx, cy, r, n = 48) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function star(cx, cy, r0, r1, n, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const r = i % 2 ? r1 : r0;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

function gear(cx, cy, r0, r1, teeth) {
  const out = [];
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = (i % 4) < 2 ? r1 : r0;
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

export const HD_EMBLEMS = Object.freeze({
  wing: Object.freeze({ label: 'Skrzydło', paths: [
    [[50, 18], [62, 44], [96, 58], [96, 66], [60, 58], [50, 82], [40, 58], [4, 66], [4, 58], [38, 44]]
  ] }),
  star: Object.freeze({ label: 'Gwiazda', paths: [star(50, 50, 46, 19, 8), circle(50, 50, 9, 24)] }),
  ring: Object.freeze({ label: 'Pierścień', paths: [circle(50, 50, 44), circle(50, 50, 33), [[8, 46], [92, 46], [92, 54], [8, 54]]] }),
  claw: Object.freeze({ label: 'Pazur', paths: [
    [[20, 92], [36, 8], [46, 8], [32, 92]],
    [[44, 92], [58, 8], [68, 8], [56, 92]],
    [[68, 92], [80, 8], [90, 8], [80, 92]]
  ] }),
  chevron: Object.freeze({ label: 'Szewron', paths: [
    [[6, 30], [50, 56], [94, 30], [94, 46], [50, 72], [6, 46]],
    [[6, 58], [50, 84], [94, 58], [94, 70], [50, 96], [6, 70]]
  ] }),
  bolt: Object.freeze({ label: 'Błyskawica', paths: [[[58, 4], [22, 56], [46, 56], [36, 96], [78, 40], [54, 40], [66, 4]]] }),
  gear: Object.freeze({ label: 'Koło zębate', paths: [gear(50, 50, 36, 46, 10), circle(50, 50, 18)] }),
  // Orzeł Terra Novy (własny rysunek w duchu znaku z sprite'ów): korpus, głowa, po trzy lotki skrzydeł, ogon — części
  // rozłączne (wypełnienie parzysto-nieparzyste).
  eagle: Object.freeze({ label: 'Orzeł Terra Novy', paths: [
    [[50, 17], [54, 25], [50, 31], [46, 25]],
    [[50, 33], [55, 44], [53.5, 70], [50, 79], [46.5, 70], [45, 44]],
    [[43, 44], [6, 18], [8, 27], [42, 51]],
    [[42.5, 54], [9, 37], [11.5, 45], [42.5, 60]],
    [[43, 63], [16, 55], [19, 61], [43, 68]],
    [[57, 44], [94, 18], [92, 27], [58, 51]],
    [[57.5, 54], [91, 37], [88.5, 45], [57.5, 60]],
    [[57, 63], [84, 55], [81, 61], [57, 68]],
    [[46.5, 83], [50, 97], [53.5, 83], [50, 87]]
  ] })
});
export const HD_EMBLEM_KEYS = Object.freeze(Object.keys(HD_EMBLEMS));
