// src/game/hullDesign/hullDesignClass.js
//
// KREATOR KADŁUBÓW — KLASA OKRĘTU Z MOSTKA I RDZENIA (etap 2 stoczni z klocków; czysty: bez three i DOM; dane i rachunek
// src/data/shipClasses.js, opis docs/KREATOR-KADLUBA.md § „Klasy okrętów”). Projekt ma `bridgeLevel` (mostek I–VI —
// twarde limity: powierzchnia, gniazda, gniazda ciężkie, rozmiar broni) i `coreLevel` (rdzeń R1–R6 — moc, limit miękki).
// Tu: lista gniazd projektu, kontrola limitów, bilans mocy (utrzymanie + tarcza + broń), urządzenia bez prądu i ich kable
// („martwe” — markPipeNetPower), straż akcji edytora (akcja, która zwiększa przekroczenie limitu mostka, się nie
// wykonuje).

import { hullDesignMountOf } from './hullDesignSchema.js';
import { powerLoad } from './hullDesignSystems.js';
import { markPipeNetPower, rasterPipeNetwork } from './hullDesignPipes.js';
import {
  shipClassCheck, shipPowerBalance, classForHull, coreLevelMax, shipClass, sizeRank, isHeavySlot, weaponMountIssue,
  POWER_PRIORITY_DEFAULT
} from '../../data/shipClasses.js';

/** Gniazda modułów (rozwiniętych — lustro osobno): [{ i (indeks modułu), slot, size, weapon }]. */
export function hullDesignMountList(modules) {
  const out = [];
  modules.forEach((m, i) => {
    const g = hullDesignMountOf(m);
    if (g) out.push({ i, ...g });
  });
  return out;
}

/** Poziomy projektu: mostek (0 — najniższa klasa z powierzchni i gniazd), rdzeń (0 — jak mostek; najwyżej mostek + 1). */
export function hullDesignLevels(design, area, mounts) {
  const auto = !(design.bridgeLevel > 0);
  const bridge = auto ? classForHull(area, mounts) : design.bridgeLevel;
  const core = Math.min(design.coreLevel > 0 ? design.coreLevel : bridge, coreLevelMax(bridge));
  return { bridge, core, auto, autoCore: !(design.coreLevel > 0) };
}

/**
 * Klasa i bilans mocy projektu. `field` — buildHullField (powierzchnia `area`, moduły rozwinięte). Zwraca { area, levels,
 * mounts, check (shipClassCheck), power (shipPowerBalance), dead: Set (indeksy modułów bez prądu), deadMounts (liczba) }.
 * Utrzymanie ponad moc rdzenia — bez prądu wszystkie urządzenia sieci zasilania.
 */
export function hullDesignClass(field) {
  const { design, modules } = field.expanded;
  const area = field.area;
  const mounts = hullDesignMountList(modules);
  const levels = hullDesignLevels(design, area, mounts);
  const check = shipClassCheck({ bridgeLevel: levels.bridge, coreLevel: levels.core, area, mounts });
  const power = shipPowerBalance({ area, coreLevel: levels.core, mounts, priority: design.powerPriority || POWER_PRIORITY_DEFAULT });
  const dead = new Set();
  if (power.upkeepOver) modules.forEach((m, i) => { if (powerLoad(m) > 0) dead.add(i); });
  else mounts.forEach((g, k) => { if (!power.on[k] && power.devices.find((d) => d.i === k).mw > 0) dead.add(g.i); });
  return { area, levels, mounts, check, power, dead, deadMounts: mounts.filter((g) => dead.has(g.i)).length };
}

/**
 * Stan zasilania na sieci pola: biegi kabli do urządzeń bez prądu → `dead` (markPipeNetPower), raster od nowa. Zmienia
 * `field.pipeNet` / `field.pipeTex` (sieć bez oznaczeń zostaje w `pipeNet.base`); wołać po każdej zmianie bilansu —
 * trasy się nie liczą od nowa.
 */
export function applyHullDesignPower(field, cls) {
  if (!field.pipeNet) return field;
  const net = markPipeNetPower(field.pipeNet, field.expanded.modules, cls.dead);
  if (net !== field.pipeNet) {
    field.pipeNet = net;
    field.pipeTex = rasterPipeNetwork(net, field.grid);
  }
  return field;
}

/**
 * STRAŻ AKCJI EDYTORA (twarde limity mostka): `before` / `after` — wynik shipClassCheck (albo hullDesignClass().check)
 * przed i po akcji. Akcja jest odrzucona, gdy po niej któryś limit jest bardziej przekroczony niż przed nią (projekt
 * wczytany ponad limit da się dalej zmniejszać). Zwraca null albo komunikat dla gracza.
 */
export function hullDesignLimitBreach(before, after) {
  const over = (c) => ({
    area: Math.max(0, (c.area ?? 0) - c.cls.areaMax),
    mounts: Math.max(0, c.counts.mounts - c.cls.mountsMax),
    heavy: Math.max(0, c.counts.heavy - c.cls.heavyMax),
    size: c.counts.oversize || 0,
    weapon: c.counts.badWeapon || 0
  });
  const a = over(before), b = over(after);
  for (const k of ['area', 'mounts', 'heavy', 'size', 'weapon']) {
    if (b[k] > a[k] + 1e-6) return after.issues.find((i) => i.code === k)?.text || 'Limit mostka przekroczony.';
  }
  return null;
}

/** shipClassCheck projektu z gotową powierzchnią (straż akcji bez budowy pola: gniazda, rozmiary, broń). */
export function hullDesignCheck(design, area, modules) {
  const mounts = hullDesignMountList(modules);
  const levels = hullDesignLevels(design, area, mounts);
  return { ...shipClassCheck({ bridgeLevel: levels.bridge, coreLevel: levels.core, area, mounts }), levels };
}

/**
 * Czy gniazdo `type` (moduł edytora) wolno dołożyć do projektu klasy `bridgeLevel` przy obecnych gniazdach `mounts`:
 * null albo komunikat (limit gniazd, gniazd ciężkich, rozmiar ponad klasę).
 */
export function hullDesignMountAddIssue(bridgeLevel, mounts, gm, copies = 1) {
  const cls = shipClass(bridgeLevel);
  if (mounts.length + copies > cls.mountsMax) return `Mostek ${cls.roman} (${cls.label}): najwyżej ${cls.mountsMax} gniazd — jest ${mounts.length}.`;
  if (isHeavySlot(gm.slot) && mounts.filter((g) => isHeavySlot(g.slot)).length + copies > cls.heavyMax) {
    return `Mostek ${cls.roman} (${cls.label}): najwyżej ${cls.heavyMax} gniazd ciężkich.`;
  }
  if (sizeRank(gm.size) > sizeRank(cls.weaponSize)) return `Mostek ${cls.roman} (${cls.label}): gniazda najwyżej ${cls.weaponSize}.`;
  if (typeof gm.weapon === 'string' && gm.weapon) {
    const why = weaponMountIssue(gm.weapon, gm.slot, gm.size, { npc: true });
    if (why) return `Broń: ${why}.`;
  }
  return null;
}
