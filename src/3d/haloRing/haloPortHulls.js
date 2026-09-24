// Kadłuby gracza w porcie ringu „Halo” (tryb lotu dema). Poprawka
// użytkownika 2026-09-23: gracz będzie latał frachtowcami i innymi statkami
// takimi samymi jak NPC, więc dokuje wszędzie, gdzie jego kadłub się mieści
// (hala K-7 i otwarte zatoki). Czyste dane, bez Three.
//
//  - w × h: płaszczyzna sprite'a jak getHullRenderSize w grze (długość
//    profilu × 0,6, proporcje obrazka 1774 × 887 → h = w / 2; Atlas 1800 × 806);
//  - outline: wypukła obwiednia kolizji z kanału alfa sprite'a (ułamki w, h;
//    +x = dziób), liczona jak K7_ATLAS_COLLISION;
//  - fit: gabaryt do stanowiska = hullFootprint ruchu v2 (długość × 0,6,
//    2 × promień × 0,6) — ta sama klasa stanowiska co u NPC;
//  - engines: rufa (ułamek w) i dysze w poprzek (ułamki h);
//  - tune: model lotu K-7 (przyspieszenie, prędkości poza/w porcie, obrót).
import { K7_ATLAS_COLLISION } from './haloPortK7Layout.js';

const freeze = (o) => Object.freeze(o);
const poly = (pts) => freeze(pts.map((p) => freeze(p)));

const OUTLINE = freeze({
  shuttle: poly([
    [-0.265237, -0.156109], [-0.260722, -0.165158], [-0.19526, -0.237557], [-0.11851, -0.237557], [0.019187, -0.201357],
    [0.11851, -0.174208], [0.163657, -0.142534], [0.204289, -0.106335], [0.249436, -0.061086], [0.26298, -0.024887],
    [0.265237, 0.029412], [0.249436, 0.070136], [0.168172, 0.147059], [0.113995, 0.187783], [0.01693, 0.214932],
    [-0.120767, 0.251131], [-0.19526, 0.251131], [-0.265237, 0.169683]
  ]),
  container: poly([
    [-0.475169, -0.038462], [-0.454853, -0.192308], [-0.380361, -0.251131], [-0.299097, -0.269231], [-0.222348, -0.269231],
    [0.080135, -0.251131], [0.247178, -0.237557], [0.375847, -0.142534], [0.452596, -0.079186], [0.484199, -0.006787],
    [0.484199, 0.033937], [0.448081, 0.11086], [0.244921, 0.269231], [-0.226862, 0.300905], [-0.294582, 0.300905],
    [-0.373589, 0.282805], [-0.454853, 0.214932], [-0.475169, 0.065611]
  ]),
  longHaul: poly([
    [-0.470655, -0.033937], [-0.457111, -0.160633], [-0.445824, -0.178733], [-0.39842, -0.210407], [-0.319413, -0.246606],
    [-0.238149, -0.242081], [0.206546, -0.201357], [0.448081, -0.047511], [0.468397, -0.020362], [0.472912, -0.006787],
    [0.472912, 0.042986], [0.448081, 0.08371], [0.206546, 0.237557], [-0.238149, 0.278281], [-0.319413, 0.282805],
    [-0.400677, 0.246606], [-0.454853, 0.205882], [-0.470655, 0.074661]
  ]),
  mega: poly([
    [-0.490971, -0.011312], [-0.475169, -0.210407], [-0.380361, -0.300905], [-0.274266, -0.300905], [0.066591, -0.278281],
    [0.224605, -0.260181], [0.414221, -0.124434], [0.459368, -0.08371], [0.490971, -0.020362], [0.488713, 0.070136],
    [0.459368, 0.128959], [0.414221, 0.169683], [0.226862, 0.30543], [0.032731, 0.328054], [-0.373589, 0.350679],
    [-0.423251, 0.31448], [-0.475169, 0.255656], [-0.490971, 0.056561]
  ])
});

const TUNE_K7 = freeze({ acc: 150, speed: 660, speedIn: 210, turn: 0.46, turnIn: 0.28, torque: 0.98 });

export const HALO_PLAYER_HULLS = freeze({
  atlas: freeze({
    id: 'atlas', name: 'Atlas', cls: 'CAPITAL', sprite: '/assets/capital_ship_rect_v1.png',
    w: 1800, h: 806, outline: K7_ATLAS_COLLISION, fit: freeze({ length: 1800, beam: 806 }),
    engines: freeze({ stern: 0.463, z: freeze([-0.0658, 0, 0.0658]) }), tune: TUNE_K7
  }),
  heavy_freighter: freeze({
    // w katalogu ruchu v2 bez własnego sprite'a — zastępczo frachtowiec
    // dalekiego zasięgu w skali ciężkiego (1800 j.)
    id: 'heavy_freighter', name: 'Ciężki frachtowiec', cls: 'CAPITAL', sprite: '/assets/long_haul_freighter.png', stand: true,
    w: 1800, h: 900, outline: OUTLINE.longHaul, fit: freeze({ length: 1800, beam: 660 }),
    engines: freeze({ stern: 0.47, z: freeze([-0.17, 0, 0.17]) }),
    tune: freeze({ acc: 135, speed: 600, speedIn: 200, turn: 0.42, turnIn: 0.26, torque: 0.9 })
  }),
  megafreighter: freeze({
    id: 'megafreighter', name: 'Megafrachtowiec', cls: 'MEGA', sprite: '/assets/megafreighter.png',
    w: 2760, h: 1380, outline: OUTLINE.mega, fit: freeze({ length: 2760, beam: 912 }),
    engines: freeze({ stern: 0.49, z: freeze([-0.24, -0.08, 0.08, 0.24]) }),
    tune: freeze({ acc: 95, speed: 520, speedIn: 170, turn: 0.26, turnIn: 0.17, torque: 0.55 })
  }),
  long_haul_freighter: freeze({
    id: 'long_haul_freighter', name: 'Frachtowiec dalekiego zasięgu', cls: 'L', sprite: '/assets/long_haul_freighter.png',
    w: 540, h: 270, outline: OUTLINE.longHaul, fit: freeze({ length: 540, beam: 312 }),
    engines: freeze({ stern: 0.47, z: freeze([-0.17, 0, 0.17]) }),
    tune: freeze({ acc: 190, speed: 720, speedIn: 230, turn: 0.7, turnIn: 0.45, torque: 1.5 })
  }),
  container_ship: freeze({
    id: 'container_ship', name: 'Kontenerowiec', cls: 'M', sprite: '/assets/container_ship.png',
    w: 312, h: 156, outline: OUTLINE.container, fit: freeze({ length: 312, beam: 216 }),
    engines: freeze({ stern: 0.475, z: freeze([-0.19, 0, 0.19]) }),
    tune: freeze({ acc: 220, speed: 760, speedIn: 240, turn: 0.9, turnIn: 0.6, torque: 2.0 })
  }),
  inter_station_shuttle: freeze({
    id: 'inter_station_shuttle', name: 'Prom międzystacyjny', cls: 'S', sprite: '/assets/inter_station_shuttle.png',
    w: 120, h: 60, outline: OUTLINE.shuttle, fit: freeze({ length: 120, beam: 96 }),
    engines: freeze({ stern: 0.265, z: freeze([-0.14, 0.14]) }),
    tune: freeze({ acc: 260, speed: 800, speedIn: 250, turn: 1.3, turnIn: 0.9, torque: 2.8 })
  })
});

// Kolejność przełączania kadłubów (klawisz V w demie): od największego.
export const HALO_PLAYER_HULL_ORDER = freeze(['atlas', 'megafreighter', 'heavy_freighter', 'long_haul_freighter', 'container_ship', 'inter_station_shuttle']);

// Czy kadłub mieści się na stanowisku (standard K-7: najdłuższy i najszerszy kadłub).
export function haloHullFits(hull, berth) {
  return berth.maxLength >= hull.fit.length && berth.maxBeam >= hull.fit.beam;
}
