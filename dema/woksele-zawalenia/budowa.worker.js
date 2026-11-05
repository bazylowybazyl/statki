// Budowa sceny w wątku roboczym (docs/SPEC-woksele-zawalenia.md § 2.3): CG wieży to około 2 s, a strona ma się w tym czasie rysować. Pamięć statyki zostaje między scenami, więc S2 po S1 jest tania.
import { zbudujPlan } from './budowa.js';
import { PLANY_POKAZU } from './scenyPokazu.js';

const pamiecStatyki = new Map();

self.onmessage = ({ data: { id, ziarno, lodS1, miasto } }) => {
  try {
    const plan = PLANY_POKAZU[id](ziarno, lodS1, miasto);
    const { w, g } = zbudujPlan(plan, { pamiecStatyki });
    self.postMessage({ id, w, g, zdarzeniaOd: plan.zdarzeniaOd, miasto: plan.miasto ?? null, rDysk: plan.scena.meta?.dysk ? (plan.scena.meta.dysk.R ?? 900) : 0, poklad: plan.s3 && id !== 'S3poza' ? { z: plan.s3.zGora + 11, rOtwor: 190 } : null }); // AGENT: otwór w obrazie liczony od środka dysku, a S3poza przebija dysk obok niego, więc ta scena jest bez gruzu na pokładzie
  } catch (e) {
    self.postMessage({ id, blad: String(e?.stack || e) });
  }
};
