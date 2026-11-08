// src/3d/tsl/navBlink.js
//
// Miganie świateł nawigacyjnych w shaderze — jedna funkcja dla billboardów (shipLights3D.js), lamp na kadłubie i rozlewu
// na sąsiadów (hexShips3D.tsl.js) i kul modeli 3D (shipModels3DGame.js): błysk na kadłubie to ta sama chwila co błysk
// lampy. Lustro CPU: navBlinkValue (src/data/shipNavLights.js) — tabela wzorów i kod lampy też tam.
//
// Wołać wewnątrz Fn (zmienne `.toVar()`). Wynik: 0 między błyskami, 1 w błysku; kod ujemny — światło stałe (1).
import { float, floor, fract, max, mix, smoothstep, step } from 'three/tsl';
import { NAV_BLINK_PATTERNS } from '../../data/shipNavLights.js';

// Pole wzoru wg numeru: same mnożenia i mieszania, bez gałęzi (lampa w pętli fragmentu kadłuba).
function pick(id, key) {
  let v = float(NAV_BLINK_PATTERNS[0][key]);
  for (let i = 1; i < NAV_BLINK_PATTERNS.length; i++) v = mix(v, float(NAV_BLINK_PATTERNS[i][key]), step(i - 0.5, id));
  return float(v).toVar();
}

/**
 * @param time czas [s] — ten sam zegar we wszystkich odbiorcach (Core3D.frameNowMs)
 * @param code kod lampy (navBlinkCode)
 * @param extraPhase faza dokładana w shaderze (proxy statków ruchu: wspólny slot lamp rodzaju, faza okrętu z instancji)
 */
export function navBlinkNode(time, code, extraPhase = null) {
  const id = floor(code).toVar();
  const attack = pick(id, 'attack');
  const flash = pick(id, 'flash');
  const release = pick(id, 'release');
  const second = pick(id, 'second');
  const phase = extraPhase ? fract(code).add(extraPhase) : fract(code);
  const u = fract(time.div(pick(id, 'period')).add(phase)).toVar();
  const env = (s) => {
    const off = s.add(attack).add(flash);
    return smoothstep(s, s.add(attack), u).mul(float(1.0).sub(smoothstep(off, off.add(release), u)));
  };
  return mix(max(env(float(0.0)), env(second)), float(1.0), step(code, -0.5));
}
