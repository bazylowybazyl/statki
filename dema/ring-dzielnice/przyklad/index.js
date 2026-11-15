// PRZYKŁAD dzielnicy ringu — najmniejsza działająca wtyczka (wzór kontraktu, dema/ring-dzielnice/README.md).
// Krótki odcinek ringu: rząd przy ringu z wnękami, po stronie przestrzeni magazyn z trzema dokami L i pasem MEGA
// (połączenie z zewnątrz), zatoki ciężarówek po obu stronach drogi, przystanek kolei. Jeden statek krąży drogą.
import { RING_V, createDistrict, yardPoint, yardTangent } from '../kit/uklad.js';
import { PB_FX, PB_MAT, YARD_H, arcTools, bodies, megaDetail, newScene, pitDetail, pushLamp, sceneOf, spire } from '../kit/sceny.js';

const M = PB_MAT;
const H = YARD_H;

function buildLayout() {
  const D = createDistrict({ id: 'przyklad', sHalf: 3600 });
  const V = RING_V;
  // rząd przy ringu: wnęki otwarte na drogę (open +1 = ku +v)
  D.arcBar({ zone: 'PI', bar: 'inner', a: -3600, b: 3600, v0: V.inner0, v1: V.inner1, row: ['m', 's', 's', 'm', 'l', 'm', 's'], open: 1 });
  // rząd zewnętrzny: magazyn z dokami L otwartymi na drogę (open −1 = ku −v)
  D.arcBar({ zone: 'PO', bar: 'outer', a: -3600, b: 3600, v0: V.outer0, v1: V.outer1, row: ['l', 'l', 'l'], open: -1, tags: { role: 'magazyn' } });
  // połączenie z zewnątrz: pas MEGA przy licu zewnętrznym
  D.megaAt('PO', 0, V.outer1, { role: 'import' });
  // transport po ringu: zatoki ciężarówek (pobocze) i przystanek kolei (kratownica)
  D.truckBay({ s: -2900, side: 1, goods: 'steel', dir: 'out', label: 'STAL' });
  D.truckBay({ s: 2900, side: 1, goods: 'iron_ore', dir: 'in', label: 'RUDA' });
  D.truckBay({ s: -3250, side: -1, goods: 'hull_plate', dir: 'out', label: 'PŁYTY' });
  D.railStop({ s: 1750, side: 1, goods: 'steel', dir: 'out', label: 'STAL' });
  return D.finish();
}

function buildScene(layout, style, occupied) {
  const { f, plates, labels, lamps, T } = newScene();
  bodies(T, f, layout, ['PI', 'PO'], { strip: M.cyan });
  for (const pit of layout.pits) pitDetail(T, f, pit, { occupied: occupied.has(pit.berth.id) });
  megaDetail(T, f, layout, 'PO', style, () => -1);
  // nadbudówka magazynu i iglica (FG)
  T.box(-1800, RING_V.outer1 - 700, H.deck + 60, 900, 120, 700, M.steel);
  f.fx(1.0, PB_FX.steady);
  T.box(-1800, RING_V.outer1 - 345, H.deck + 70, 700, 10, 6, M.warm);
  f.nofx();
  spire(T, f, 1800, RING_V.outer1 - 700, 300, 7);
  T.label('PRZYKŁAD', 0, RING_V.outer1 - 300, 1400, 150, style.labels.hub, 'WZÓR DZIELNICY');
  pushLamp(lamps, 0, RING_V.road, 340, 1);
  return sceneOf(f, plates, labels, lamps);
}

export default {
  id: 'przyklad',
  name: 'Przykład',
  sub: 'Wzór dzielnicy: rząd przy ringu, droga z kratownicą, magazyn z dokami, pas MEGA, zatoki ciężarówek i przystanek kolei.',
  build({ style }) {
    const layout = buildLayout();
    // kto stoi w dokach: funkcja stanowisko → id kadłuba | null (puste) | undefined (dobór domyślny gospodarza)
    const hulls = (b) => (b.role === 'import' ? 'megafreighter' : undefined);
    const occupied = new Set();
    let t = 0;
    return {
      layout,
      hulls,
      buildings: [{ name: 'Przykład: rzędy', scene: buildScene(layout, style, occupied) }],
      views: [
        { name: 'Magazyn', sub: 'doki L od drogi, pas MEGA od przestrzeni', caption: 'Doki otwarte na drogę; megafrachtowiec staje od strony przestrzeni', at: [0, RING_V.outer0 + 900], zoom: 0.16 },
        { name: 'Zatoka ciężarówek', sub: 'pobocze drogi przy licu rzędu', caption: 'Zatoka na poboczu: półka, światła, wysięgniki przeładunkowe', at: [-2900, RING_V.road + 700], zoom: 0.5 }
      ],
      step(dt) { t += dt; },
      // ruch: jeden frachtowiec krąży pasem od strony przestrzeni
      frame(api) {
        const span = 2 * layout.extent - 2000;
        const s = -layout.extent + 1000 + ((t * 320) % span);
        const [x, z] = yardPoint(s, RING_V.road + RING_V.laneOff);
        const h = yardTangent(s);
        const edge = Math.min(1, (s + layout.extent - 1000) / 1500, (layout.extent - 1000 - s) / 1500);
        api.proxy('przyklad-kurs', 'container_ship', x, z, h, { opacity: Math.max(0, edge), vx: Math.cos(h) * 320, vz: Math.sin(h) * 320, throttle: 0.5 });
      },
      hud: () => `<b>przykład</b> czas ${t.toFixed(0)} s`
    };
  }
};
