// Budowa sceny w wątku roboczym (docs/SPEC-woksele-zawalenia.md § 2.3): CG wieży to około 2 s, a strona ma się w tym czasie rysować. Pamięć statyki zostaje między scenami, więc S2 po S1 jest tania.
// Demo kawałków (pole `kawalki` wiadomości): do wypieku prefraktura obrazu i wybór prętów zbrojenia (kawalki.js). Bez tego pola wiadomość jak dotąd.
import { zbudujPlan } from './budowa.js';
import { PLANY_POKAZU } from './scenyPokazu.js';
import { zbudujKawalki, wybierzZbrojenie, nakladkaKruchosci } from './kawalki.js';

const pamiecStatyki = new Map();

self.onmessage = ({ data: { id, ziarno, lodS1, miasto, kawalki, kruchosc, sztywnosc } }) => {
  try {
    const plan = PLANY_POKAZU[id](ziarno, lodS1, miasto);
    // Przełącznik kruchości dema (kawalki.js, KRUCHOSC): inne granice gięcia w wypieku. Bez pola fizyka jak dotąd.
    if (kruchosc) plan.nakladka = nakladkaKruchosci(plan.nakladka, kruchosc);
    // Sztywność betonu (budowa.js, par.sztywnosc): K × s², podkroki × s, wytrzymałości bez zmian.
    if (sztywnosc > 1) plan.nakladka = { ...(plan.nakladka ?? {}), sztywnosc };
    const { w, g } = zbudujPlan(plan, { pamiecStatyki });
    const wynik = { id, w, g, zdarzeniaOd: plan.zdarzeniaOd, miasto: plan.miasto ?? null, rDysk: plan.scena.meta?.dysk ? (plan.scena.meta.dysk.R ?? 900) : 0, poklad: plan.s3 && id !== 'S3poza' ? { z: plan.s3.zGora + 11, rOtwor: 190 } : null }; // AGENT: otwór w obrazie liczony od środka dysku, a S3poza przebija dysk obok niego, więc ta scena jest bez gruzu na pokładzie
    const przenies = [];
    if (kawalki) {
      // Dysk sceny (S3, S5): wieniec po okręgu jak w obraz.js (rDysk).
      const iDysk = plan.scena.meta?.grupy?.findIndex((q) => q.nazwa === 'dysk') ?? -1;
      const R = plan.scena.meta?.dysk?.R ?? (plan.scena.meta?.typ === 'dysk' ? plan.scena.meta.R : 0);
      // Baza piratów: koła habitatu z układu (plan.kola), jak w grze.
      const kaw = zbudujKawalki(w, { ...(kawalki.kawalki ?? {}), ...(iDysk >= 0 && R > 0 && R < 1e8 ? { kolo: { grupa: iDysk, R } } : {}), ...(plan.kola ? { kola: plan.kola } : {}) });
      const zbr = wybierzZbrojenie(w, kaw, kawalki.zbrojenie ?? {});
      wynik.kaw = kaw;
      wynik.zbr = zbr;
      const gm = kaw.geometria;
      przenies.push(gm.pozycja.buffer, gm.id.buffer, gm.odlup.buffer, gm.indeksy.buffer);
    }
    self.postMessage(wynik, przenies);
  } catch (e) {
    self.postMessage({ id, blad: String(e?.stack || e) });
  }
};
