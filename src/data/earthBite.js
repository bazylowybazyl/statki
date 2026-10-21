// Wielki GRYZ Ziemi — dziura „jak w ugryzionym jabłku”, z której wzięto skałę na ring „Halo”.
// JEDNO źródło kształtu: generator map Ziemi (scripts/planety/gryz.py czyta blok JSON między
// znacznikami), bryła 3D w grze (src/3d/earthBite3D.js, gałąź gryzu w grafie planety, tło menu)
// i lustra CPU (earthBiteShape.js — tarcza cienia słońca, podkład radaru).
// Zmiana liczb = ponowne wypieczenie map (`scripts/planety/ziemia.py --szer 8192 --do-gry`).
//
// Kształt: kula o promieniu β (R Ziemi = 1) ze środkiem C na powierzchni (lon, lat). β zależy od
// azymutu φ wokół C (0 = wschód, ku północy) i kąta ψ od osi w głąb (0 = dno, brzeg ψ ≈ acos(β / 2)):
//   β = radiusR · (1 + Σ lobes amp·cos(k(φ − faza)) · wL(ψ) + teethAmp · (łuk(φ) − 2/3) · wT(ψ))
// łuk(φ) = 4t(1 − t), t = fract(n · φ' / 2π), φ' = φ + teethWarp · sin(φ + teethPhase) — łuki zębów na
// brzegu (ostrza między łukami wchodzą do środka), bruzdy schodzą po ścianie do teethDepth jej wysokości.
// wL gaśnie ku dnu (dno okrągłe), wT — poniżej bruzd. Kula Ziemi wycina wszystko, co leży bliżej C niż
// β + cutPad (cięciwa, R), łata (ściany i dno + kołnierz brzegu do β + skirtPad) przykrywa wycięcie.
// Klamry (`ribs`): belki w poprzek otworu po małych kołach x · n = offset · radiusR (n — kierunek
// `axisDeg` w płaszczyźnie stycznej w C), na wysokości [bottomKm, topKm] nad kulą, kotwy za brzegiem.
export const EARTH_BITE = Object.freeze(/*EARTH_BITE*/{
  "lon": 15.0,
  "lat": 10.0,
  "radiusR": 0.30,
  "lobes": [[2, 0.075, 18], [3, 0.03, 130], [5, 0.014, 40]],
  "teeth": 9,
  "teethAmp": 0.07,
  "teethWarp": 0.42,
  "teethPhase": 25,
  "teethDepth": 0.3,
  "cutPad": 0.0025,
  "skirtPad": 0.012,
  "lipKm": 6,
  "ribs": {
    "axisDeg": 18,
    "offsets": [-0.62, -0.22, 0.22, 0.62],
    "widthKm": 44,
    "bottomKm": 4,
    "topKm": 26,
    "anchorKm": 150,
    "anchorWidthKm": 110,
    "anchorTopKm": 34
  },
  "massDrivers": [[78, 1700], [158, 1400], [242, 1900], [318, 1500]]
}/*EARTH_BITE-KONIEC*/);
