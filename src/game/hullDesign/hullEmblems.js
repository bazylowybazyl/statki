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
  // Znak piratów (BEZ czaszek — decyzja użytkownika): dwa skrzyżowane kordelasy z jelcami nad poszarpanym proporcem
  raider: Object.freeze({ label: 'Znak piratów', paths: [
    [[18, 16], [24, 12], [72, 66], [66, 72]],
    [[60, 74], [76, 58], [80, 62], [64, 78]],
    [[66, 74], [74, 66], [88, 82], [82, 88]],
    [[82, 16], [76, 12], [28, 66], [34, 72]],
    [[40, 74], [24, 58], [20, 62], [36, 78]],
    [[34, 74], [26, 66], [12, 82], [18, 88]],
    [[30, 90], [70, 90], [64, 96], [58, 92], [50, 98], [42, 92], [36, 96]]
  ] }),
  // Słońce Konsorcjum Wewnętrznego: tarcza z dwunastoma promieniami
  sun: Object.freeze({ label: 'Słońce', paths: [star(50, 50, 47, 30, 12, 0), circle(50, 50, 22, 36)] }),
  // Skała Unii Pasa: bryła asteroidy z kraterem i pierścieniem toru
  rock: Object.freeze({ label: 'Skała', paths: [
    [[30, 22], [52, 14], [72, 22], [84, 42], [80, 66], [62, 84], [38, 86], [20, 70], [14, 46]],
    circle(56, 40, 10, 24),
    [[4, 60], [96, 36], [97, 41], [5, 65]]
  ] }),
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
