// Panel sceny dźwięków (`?scena=dzwieki`, blok „SCENA DŹWIĘKI” w index.html) — mała nakładka HTML widoczna tylko
// w scenie: przełączniki sceny (tarcza Atlasa, cele niezniszczalne, piraci strzelają), odnowienie celów i lista
// dźwięków sceny z wyborem wariantu (1 / 2 / 3 / losowo), wyciszeniem i licznikiem odtworzeń; „Kopiuj wybór”
// kopiuje linie `id: plik` w formacie strony dema/dzwieki-ai.html. Bez suwaków (decyzja użytkownika).
//
// Panel nie przepuszcza myszy ani klawiszy do gry (kliknięcie w panel nie strzela), a przyciski nie zostają
// z fokusem (spacja / Enter w grze nie klika ich ponownie).

const STYL = `
#dzwieki-panel { position: fixed; top: 64px; right: 12px; z-index: 60; width: 300px; max-height: calc(100vh - 140px);
  display: flex; flex-direction: column; font: 12px/1.35 system-ui, sans-serif; color: #d8e6f0;
  background: rgba(8, 14, 22, 0.86); border: 1px solid rgba(120, 170, 210, 0.35); border-radius: 6px;
  box-shadow: 0 4px 18px rgba(0,0,0,0.45); pointer-events: auto; user-select: none; }
#dzwieki-panel.zwiniety .dp-cialo { display: none; }
#dzwieki-panel .dp-glowa { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid rgba(120,170,210,0.2); }
#dzwieki-panel .dp-tytul { flex: 1; font-weight: 600; letter-spacing: 0.04em; }
#dzwieki-panel .dp-cialo { display: flex; flex-direction: column; min-height: 0; }
#dzwieki-panel .dp-sekcja { padding: 6px 8px; display: grid; grid-template-columns: 1fr auto; gap: 4px 8px; align-items: center;
  border-bottom: 1px solid rgba(120,170,210,0.15); }
#dzwieki-panel .dp-uwaga { padding: 4px 8px; color: #e7c98a; font-size: 11px; }
#dzwieki-panel button { font: inherit; color: inherit; background: rgba(60, 90, 120, 0.35); border: 1px solid rgba(120,170,210,0.35);
  border-radius: 4px; padding: 2px 7px; cursor: pointer; }
#dzwieki-panel button:hover { background: rgba(80, 120, 160, 0.5); }
#dzwieki-panel button.wl { background: rgba(60, 150, 110, 0.55); border-color: rgba(120, 220, 170, 0.6); }
#dzwieki-panel button.wyl { background: rgba(140, 60, 60, 0.45); border-color: rgba(220, 120, 120, 0.5); }
#dzwieki-panel .dp-lista { overflow-y: auto; padding: 4px 8px; min-height: 0; }
#dzwieki-panel .dp-wiersz { display: grid; grid-template-columns: 1fr auto auto; gap: 4px; align-items: center; padding: 2px 0; }
#dzwieki-panel .dp-wiersz.wyciszony .dp-nazwa { opacity: 0.45; text-decoration: line-through; }
#dzwieki-panel .dp-nazwa { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#dzwieki-panel .dp-licznik { color: #8fb1c8; font-variant-numeric: tabular-nums; min-width: 2.5em; text-align: right; }
#dzwieki-panel .dp-warianty { display: flex; gap: 2px; }
#dzwieki-panel .dp-warianty button { padding: 1px 5px; min-width: 20px; }
#dzwieki-panel .dp-warianty button.wybrany { background: rgba(70, 140, 200, 0.7); border-color: rgba(150, 200, 240, 0.8); }
#dzwieki-panel .dp-stopka { padding: 6px 8px; display: flex; gap: 8px; align-items: center; border-top: 1px solid rgba(120,170,210,0.2); }
#dzwieki-panel .dp-stan { color: #9fc4a8; font-size: 11px; }
#dzwieki-panel .dp-grupa { grid-column: 1 / -1; color: #7f9fb5; font-size: 11px; margin-top: 4px; }
`;

const KATEGORIE_NAZWY = {
  superbron: 'Superbronie i duże wybuchy', dzialo: 'Działa, rakiety, wybuchy', trafienie: 'Trafienia, tarcza, kadłub',
  drobne: 'Drobne', interfejs: 'Interfejs'
};

/**
 * @param {{ dzwieki: object, akcje: { tarcza(b), niezniszczalne(b), piraciStrzelaja(b), odnow() },
 *           stan: () => ({ tarcza: boolean, niezniszczalne: boolean, piraciStrzelaja: boolean, zapisZablokowany: boolean }) }} opts
 */
export function utworzPanelDzwiekow({ dzwieki, akcje, stan }) {
  const doc = document;
  if (!doc.getElementById('dzwieki-panel-styl')) {
    const st = doc.createElement('style');
    st.id = 'dzwieki-panel-styl';
    st.textContent = STYL;
    doc.head.appendChild(st);
  }
  const el = (tag, props = {}, dzieci = []) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const d of dzieci) if (d) e.appendChild(d);
    return e;
  };
  const przycisk = (text, fn, title = '') => el('button', {
    type: 'button', tabindex: '-1', text, title,
    onclick: (ev) => { ev.preventDefault(); fn(); ev.currentTarget.blur(); odswiez(); }
  });

  const root = el('div', { id: 'dzwieki-panel' });
  // Mysz i klawisze w panelu nie idą do gry (strzał LPM, zoom kółkiem, klawisze grup).
  for (const typ of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'wheel', 'contextmenu', 'keydown', 'keyup']) {
    root.addEventListener(typ, (ev) => ev.stopPropagation());
  }

  const zwin = przycisk('–', () => { root.classList.toggle('zwiniety'); zwin.textContent = root.classList.contains('zwiniety') ? '+' : '–'; }, 'Zwiń / rozwiń');
  const glowa = el('div', { class: 'dp-glowa' }, [el('span', { class: 'dp-tytul', text: 'SCENA DŹWIĘKÓW' }), zwin]);

  const bTarcza = przycisk('', () => akcje.tarcza(!stan().tarcza), 'Tarcza Atlasa (dźwięk włączenia / wyłączenia)');
  const bCele = przycisk('', () => akcje.niezniszczalne(!stan().niezniszczalne), 'Cele przyjmują trafienia, ale nie giną');
  const bOgien = przycisk('', () => akcje.piraciStrzelaja(!stan().piraciStrzelaja), 'Piraci strzelają do Atlasa');
  const bOdnow = przycisk('Odnów cele', () => akcje.odnow(), 'Piraci od nowa (po zniszczeniu)');
  const sekcja = el('div', { class: 'dp-sekcja' }, [
    el('span', { text: 'Tarcza Atlasa' }), bTarcza,
    el('span', { text: 'Cele' }), bCele,
    el('span', { text: 'Piraci' }), bOgien,
    el('span', { text: 'Po zniszczeniu' }), bOdnow
  ]);
  const uwaga = el('div', { class: 'dp-uwaga', text: 'Zapis gry wyłączony do przeładowania strony (scena nie zmienia Twojego zapisu).' });

  const lista = el('div', { class: 'dp-lista' });
  const wiersze = [];
  let ostatniaKat = '';
  for (const r of dzwieki.lista()) {
    if (r.kat !== ostatniaKat) {
      ostatniaKat = r.kat;
      lista.appendChild(el('div', { class: 'dp-grupa', text: KATEGORIE_NAZWY[r.kat] || r.kat }));
    }
    const licznik = el('span', { class: 'dp-licznik', text: '0' });
    const warianty = el('div', { class: 'dp-warianty' });
    const bWar = [];
    if (!r.synteza) {
      const n = Math.max(1, r.pliki.length);
      for (let w = 1; w <= n; w++) {
        const b = przycisk(String(w), () => dzwieki.ustawWybor(r.id, w), r.pliki[w - 1] || '');
        b.dataset.w = String(w);
        bWar.push(b);
        warianty.appendChild(b);
      }
      const bL = przycisk('L', () => dzwieki.ustawWybor(r.id, 0), 'Losowo (bez powtórzenia)');
      bL.dataset.w = '0';
      bWar.push(bL);
      warianty.appendChild(bL);
    }
    const bM = przycisk('wycisz', () => dzwieki.ustawWyciszenie(r.id, !dzwieki.lista().find((x) => x.id === r.id)?.wyciszony), 'Wycisz ten dźwięk w scenie');
    warianty.appendChild(bM);
    const wiersz = el('div', { class: 'dp-wiersz', title: r.synteza ? r.nazwa : r.pliki.join(', ') }, [
      el('span', { class: 'dp-nazwa', text: r.synteza ? `${r.id} (synteza)` : r.id }), licznik, warianty
    ]);
    lista.appendChild(wiersz);
    wiersze.push({ id: r.id, wiersz, licznik, bWar, bM });
  }

  const stanKopii = el('span', { class: 'dp-stan' });
  const bKopiuj = przycisk('Kopiuj wybór', async () => {
    const tekst = dzwieki.tekstWyboru();
    try {
      await navigator.clipboard.writeText(tekst);
      stanKopii.textContent = 'Skopiowano — wklej do rozmowy.';
    } catch {
      window.prompt('Skopiuj wybór:', tekst);
    }
  });
  const stopka = el('div', { class: 'dp-stopka' }, [bKopiuj, stanKopii]);

  root.appendChild(glowa);
  root.appendChild(el('div', { class: 'dp-cialo' }, [sekcja, uwaga, lista, stopka]));
  doc.body.appendChild(root);

  function przelacznik(b, wl, tWl, tWyl) {
    b.textContent = wl ? tWl : tWyl;
    b.classList.toggle('wl', !!wl);
    b.classList.toggle('wyl', !wl);
  }

  function odswiez() {
    const s = stan();
    przelacznik(bTarcza, s.tarcza, 'włączona', 'wyłączona');
    przelacznik(bCele, s.niezniszczalne, 'niezniszczalne', 'zniszczalne');
    przelacznik(bOgien, s.piraciStrzelaja, 'strzelają', 'nie strzelają');
    uwaga.style.display = s.zapisZablokowany ? '' : 'none';
    const st = dzwieki.statystyki().dzwieki;
    const rows = dzwieki.lista();
    for (const w of wiersze) {
      const r = rows.find((x) => x.id === w.id);
      w.licznik.textContent = String(st[w.id]?.zagral || 0);
      for (const b of w.bWar) b.classList.toggle('wybrany', Number(b.dataset.w) === (r?.wybor | 0));
      w.wiersz.classList.toggle('wyciszony', !!r?.wyciszony);
      w.bM.textContent = r?.wyciszony ? 'włącz' : 'wycisz';
    }
  }
  odswiez();
  const timer = setInterval(odswiez, 500);

  return {
    root,
    odswiez,
    usun() {
      clearInterval(timer);
      root.remove();
    }
  };
}
