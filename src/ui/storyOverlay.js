// ============================================================
// Nakładka fabuły (2026-09-30): pasy kinowe, dialogi z portretem, cel misji, karta samouczka, znaczniki celu,
// baner, podsumowanie misji, pasek maskowania. Czyta stan StoryGame (src/game/story/storyGame.js) raz na klatkę
// i dotyka DOM tylko przy zmianie. Style: assets/css/story.css.
//
//   const overlay = createStoryOverlay(StoryGame);
//   overlay.update({ worldToScreen, W, H, ship });   // po render(), co klatkę
// Klawisze (przechwycone przed grą, faza capture): scena — Spacja / Enter dalej, Esc pomiń; podsumowanie — Enter.
// ============================================================
import { castMember } from '../data/story/cast.js';
import { CLOAK_BREAK_LABELS } from '../game/cloak.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const fmtInt = (n) => Math.round(Number(n) || 0).toLocaleString('pl-PL');
const signed = (n) => (n > 0 ? `+${fmtInt(n)}` : `−${fmtInt(Math.abs(n))}`);

export function createStoryOverlay(story) {
  const root = el('div', null, document.body);
  root.id = 'story-root';
  root.setAttribute('aria-live', 'polite');
  el('div', 'st-bar top', root);
  el('div', 'st-bar bottom', root);

  // --- znaczniki (pod panelami) ---
  const markerLayer = el('div', 'st-markers', root);
  const markerEls = new Map();

  // --- cel ---
  const obj = el('div', 'st-objective', root);
  el('div', 'st-obj-label', obj, 'CEL MISJI');
  const objText = el('div', 'st-obj-text', obj);
  const objProg = el('div', 'st-obj-progress', obj);

  // --- samouczek ---
  const hint = el('div', 'st-hint', root);
  const hintHead = el('div', 'st-hint-head', hint);
  const hintLabel = el('div', 'st-hint-label', hintHead, 'SAMOUCZEK');
  const hintTitle = el('div', 'st-hint-title', hint);
  const hintText = el('div', 'st-hint-text', hint);
  const hintKeys = el('div', 'st-keys', hint);

  // --- dialog ---
  const dlg = el('div', 'st-dialogue scene', root);
  const portrait = el('div', 'st-portrait', dlg);
  const portraitImg = el('img', null, portrait);
  portraitImg.alt = '';
  portraitImg.hidden = true;
  const initials = el('div', 'st-initials', portrait);
  const body = el('div', 'st-body', dlg);
  const speaker = el('div', 'st-speaker', body);
  const nameEl = el('div', 'st-name', speaker);
  const roleEl = el('div', 'st-role', speaker);
  const radioTag = el('div', 'st-radio-tag', speaker, 'ŁĄCZNOŚĆ');
  const textEl = el('div', 'st-text', body);
  const foot = el('div', 'st-foot', body);
  const countEl = el('span', null, foot);
  const nextEl = el('span', 'st-next', foot);
  dlg.addEventListener('click', (e) => {
    e.stopPropagation();
    if (story.dialogue?.mode === 'scene') story.dialogue.advance();
  });

  // --- baner ---
  const banner = el('div', 'st-banner', root);

  // --- maskowanie ---
  const cloakEl = el('div', 'st-cloak', root);
  const cloakLabel = el('span', null, cloakEl);
  const cloakBar = el('div', 'st-cloak-bar', cloakEl);
  const cloakFill = el('i', null, cloakBar);

  // --- panel akcji (stanowisko w doku: ODDOKUJ) ---
  const act = el('div', 'st-cmd', root);
  act.setAttribute('role', 'group');
  const actHead = el('div', 'st-cmd-head', act);
  const actTitle = el('div', 'st-cmd-title', actHead);
  const actSub = el('div', 'st-cmd-sub', actHead);
  const actRows = el('div', 'st-cmd-rows', act);
  const actBtn = el('button', 'st-cmd-btn', act);
  actBtn.type = 'button';
  const actBtnLabel = el('span', null, actBtn);
  const actBtnKey = el('span', 'st-cmd-key', actBtn);
  actBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const a = story.ui.action;
    if (a) story.triggerAction(a.id);
  });
  // klik w panel nie strzela w grze
  act.addEventListener('mousedown', (e) => e.stopPropagation());
  act.addEventListener('pointerdown', (e) => e.stopPropagation());

  // --- podsumowanie ---
  const sumWrap = el('div', 'st-summary-wrap', root);
  const sum = el('div', 'st-summary', sumWrap);
  sum.setAttribute('role', 'dialog');
  const sumTitle = el('div', 'st-sum-title', sum);
  const sumSub = el('div', 'st-sum-sub', sum);
  const sumRows = el('div', 'st-sum-rows', sum);
  const sumBtn = el('button', 'st-sum-btn', sum, 'Dalej');
  sumBtn.type = 'button';
  sumBtn.addEventListener('click', (e) => { e.stopPropagation(); story.closeSummary(); });

  // Klawisze przed grą (capture): dialog sceny i podsumowanie połykają Spację / Enter / Esc.
  window.addEventListener('keydown', (e) => {
    if (!story.active) return;
    const k = e.code;
    if (story.ui.summary) {
      if (k === 'Enter' || k === 'Space' || k === 'NumpadEnter' || k === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) story.closeSummary();
      }
      return;
    }
    const d = story.dialogue;
    if (d?.active && d.mode === 'scene') {
      if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) d.advance();
      } else if (k === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        d.skip();
      }
      return;
    }
    // panel akcji: klawisz przycisku (Enter → też NumpadEnter)
    const a = story.ui.action;
    if (a && !a.pressed && a.key && !story.letterbox) {
      const want = a.key === 'Enter' ? (k === 'Enter' || k === 'NumpadEnter') : (e.key === a.key || k === a.key);
      if (want) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) story.triggerAction(a.id);
      }
    }
  }, true);

  const last = {
    cinematic: null, dlgKey: '', dlgText: null, dlgOn: false, objKey: '', objProg: null, objOn: false,
    hintSpec: null, hintDone: null, bannerText: null, summary: null, cloakKey: '', active: null,
    action: null, actPressed: null, actRows: ''
  };
  const _s = { x: 0, y: 0, visible: false, depth: 1 };

  function setDialogue(cur, mode) {
    if (!cur) {
      if (last.dlgOn) { dlg.classList.remove('on'); last.dlgOn = false; }
      return;
    }
    const m = castMember(cur.who);
    const key = `${cur.who}|${cur.portrait || ''}|${mode}|${cur.index}`;
    if (key !== last.dlgKey) {
      last.dlgKey = key;
      dlg.className = `st-dialogue ${mode}${m.side === 'right' ? ' right' : ''}`;
      dlg.style.setProperty('--speaker', m.color || '#8fd3ff');
      nameEl.textContent = m.name;
      roleEl.textContent = m.role || '';
      radioTag.hidden = mode !== 'radio';
      initials.textContent = m.initials || '';
      const src = cur.portrait || m.portrait;
      if (src) { portraitImg.src = src; portraitImg.hidden = false; initials.hidden = true; }
      else { portraitImg.hidden = true; portraitImg.removeAttribute('src'); initials.hidden = false; }
      countEl.textContent = cur.count > 1 ? `${cur.index + 1} / ${cur.count}` : '';
      last.dlgText = null;
      // nowe kwestie wjeżdżają (klasa „on” po klatce)
      last.dlgOn = false;
    }
    const shown = cur.gap ? cur.text : cur.text.slice(0, cur.shown);
    if (shown !== last.dlgText) { textEl.textContent = shown; last.dlgText = shown; }
    nextEl.textContent = cur.typed ? 'SPACJA — DALEJ ▸   ESC — POMIŃ' : 'SPACJA — POKAŻ';
    nextEl.classList.toggle('pulse', !!cur.typed);
    if (!last.dlgOn) { requestAnimationFrame(() => dlg.classList.add('on')); last.dlgOn = true; }
  }

  function setObjective(o) {
    if (!o) {
      if (last.objOn) { obj.classList.remove('on'); last.objOn = false; last.objKey = ''; }
      return;
    }
    const key = `${o.id}|${o.text}`;
    if (key !== last.objKey) {
      last.objKey = key;
      objText.textContent = o.text;
      obj.classList.remove('fresh');
      void obj.offsetWidth;
      obj.classList.add('fresh');
    }
    let p = '';
    if (o.progress) { try { p = String(o.progress() ?? ''); } catch { p = ''; } }
    if (p !== last.objProg) { objProg.textContent = p; last.objProg = p; }
    if (!last.objOn) { obj.classList.add('on'); last.objOn = true; }
  }

  function setHint(h) {
    if (!h) {
      if (last.hintSpec) { hint.classList.remove('on', 'done'); last.hintSpec = null; }
      return;
    }
    if (h.spec !== last.hintSpec) {
      last.hintSpec = h.spec;
      hintTitle.textContent = h.spec.title || '';
      hintText.textContent = h.spec.text || '';
      hintKeys.textContent = '';
      for (const k of h.spec.keys || []) el('span', 'st-key', hintKeys, k);
      hintKeys.hidden = !(h.spec.keys && h.spec.keys.length);
      hint.classList.remove('done');
      last.hintDone = false;
      requestAnimationFrame(() => hint.classList.add('on'));
    }
    if (!!h.done !== last.hintDone) {
      last.hintDone = !!h.done;
      hint.classList.toggle('done', !!h.done);
      hintLabel.textContent = h.done ? 'WYKONANE ✓' : 'SAMOUCZEK';
    }
  }

  function setMarkers(env) {
    const markers = story.ui.markers;
    for (const [id, node] of markerEls) {
      if (!markers.has(id)) { node.el.remove(); markerEls.delete(id); }
    }
    if (!markers.size || !env.worldToScreen) return;
    const W = env.W, H = env.H;
    const ship = env.ship;
    for (const [id, m] of markers) {
      let node = markerEls.get(id);
      if (!node) {
        const e = el('div', 'st-marker', markerLayer);
        const arrow = el('div', 'st-arrow', e);
        el('div', 'st-diamond', e);
        const label = el('div', 'st-label', e);
        // Podpowiedź akcji przy znaczniku (np. ikona myszy z podświetlonym PPM — „wyślij drona tutaj”).
        const action = el('div', 'st-action', e);
        const mouseIcon = el('i', 'st-mouse', action);
        el('b', 'st-mouse-l', mouseIcon);
        el('b', 'st-mouse-r', mouseIcon);
        const actionText = el('span', null, action);
        const dist = el('div', 'st-dist', e);
        node = { el: e, arrow, label, dist, action, mouseIcon, actionText, lastLabel: null, lastDist: null, lastAction: null };
        markerEls.set(id, node);
      }
      if (node.lastLabel !== m.label) { node.label.textContent = m.label || ''; node.lastLabel = m.label; }
      const actionKey = m.action ? `${m.action.mouse || ''}|${m.action.text || ''}` : '';
      if (node.lastAction !== actionKey) {
        node.lastAction = actionKey;
        node.action.hidden = !m.action;
        node.mouseIcon.className = `st-mouse${m.action?.mouse ? ` ${m.action.mouse}` : ''}`;
        node.mouseIcon.hidden = !m.action?.mouse;
        node.actionText.textContent = m.action?.text || '';
        node.el.classList.toggle('has-action', !!m.action);
      }
      const s = env.worldToScreen(m.x, m.y, _s);
      let x = s.x, y = s.y;
      const margin = 48;
      const behind = s.depth !== undefined && s.depth <= 0;
      let edge = behind || x < margin || x > W - margin || y < margin || y > H - margin;
      if (edge) {
        // kierunek od środka ekranu (za kamerą — odwrócony)
        let dx = x - W / 2, dy = y - H / 2;
        if (behind) { dx = -dx; dy = -dy; }
        const kx = (W / 2 - margin) / Math.max(1e-6, Math.abs(dx));
        const ky = (H / 2 - margin) / Math.max(1e-6, Math.abs(dy));
        const k = Math.min(kx, ky);
        x = W / 2 + dx * k;
        y = H / 2 + dy * k;
        node.arrow.style.transform = `rotate(${Math.atan2(dy, dx) + Math.PI / 2}rad)`;
      }
      node.el.classList.toggle('edge', edge);
      node.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      if (ship) {
        const d = Math.hypot(m.x - ship.x, m.y - ship.y);
        const txt = d >= 10000 ? `${(d / 1000).toFixed(0)} km` : `${(d / 1000).toFixed(1)} km`;
        if (txt !== node.lastDist) { node.dist.textContent = txt; node.lastDist = txt; }
      }
    }
  }

  function setSummary(s) {
    if (s === last.summary) return;
    last.summary = s;
    if (!s) { sumWrap.classList.remove('on'); return; }
    const r = s.reward || {};
    sumTitle.textContent = s.title || 'MISJA WYKONANA';
    sumSub.textContent = s.subtitle || '';
    sumRows.textContent = '';
    const row = (label, value, cls = '') => {
      const e = el('div', 'st-sum-row', sumRows);
      el('span', null, e, label);
      const b = el('b', cls, e, value);
      return b;
    };
    // wyniki misji (np. zatrzymane przed startem, los herszta): [etykieta, wartość, 'pos' | 'neg' | '']
    for (const st of s.stats || []) if (st && st[0]) row(String(st[0]), String(st[1] ?? ''), st[2] || '');
    row('Doświadczenie', `+${fmtInt(r.exp)} EXP`);
    row('Kredyty', `+${fmtInt(r.credits)} CR`);
    for (const rep of r.rep || []) row(`Reputacja: ${rep.label}`, signed(rep.delta), rep.delta >= 0 ? 'pos' : 'neg');
    const rank = el('div', 'st-rank', sumRows);
    const meta = el('div', 'st-rank-meta', rank);
    el('span', null, meta, (r.rank || '').toUpperCase());
    el('span', null, meta, r.nextRank ? `${fmtInt(r.totalExp)} EXP → ${r.nextRank}` : `${fmtInt(r.totalExp)} EXP`);
    const bar = el('div', 'st-rank-bar', rank);
    const fill = el('i', null, bar);
    el('div', 'st-promo', sumRows, (r.promoted || []).length ? `Awans: ${r.promoted[r.promoted.length - 1]}` : '');
    sumWrap.classList.add('on');
    requestAnimationFrame(() => { fill.style.width = `${Math.round((r.rankFrac || 0) * 100)}%`; });
    setTimeout(() => { try { sumBtn.focus({ preventScroll: true }); } catch { /* bez fokusu */ } }, 60);
  }

  function setAction(a) {
    if (a !== last.action) {
      last.action = a;
      last.actPressed = null;
      last.actRows = '';
      if (!a) { act.classList.remove('on', 'busy'); return; }
      actTitle.textContent = a.title || '';
      actSub.textContent = a.subtitle || '';
      actBtnKey.textContent = a.key ? (a.key === 'Enter' ? '↵ ENTER' : a.key) : '';
      act.classList.add('on');
    }
    if (!a) return;
    const pressed = !!a.pressed;
    if (pressed !== last.actPressed) {
      last.actPressed = pressed;
      actBtnLabel.textContent = pressed ? (a.busyLabel || a.label || '') : (a.label || '');
      actBtn.disabled = pressed;
      act.classList.toggle('busy', pressed);
      if (!pressed) setTimeout(() => { try { if (story.ui.action === a && !a.pressed) actBtn.focus({ preventScroll: true }); } catch { /* bez fokusu */ } }, 60);
    }
    let rows = null;
    if (a.rows) { try { rows = a.rows(); } catch { rows = null; } }
    const key = rows ? rows.map((r) => r.join('|')).join(';') : '';
    if (key === last.actRows) return;
    last.actRows = key;
    actRows.textContent = '';
    for (const [label, value, cls] of rows || []) {
      const r = el('div', 'st-cmd-row', actRows);
      el('span', null, r, label);
      el('b', cls || '', r, value);
    }
  }

  function setCloak(ship) {
    const c = ship?.cloak;
    const show = !!c && story.active && (c.state !== 'off' || c.energy < c.tune.maxEnergy - 0.01);
    if (!show) {
      if (last.cloakKey) { cloakEl.className = 'st-cloak'; last.cloakKey = ''; }
      return;
    }
    let label;
    if (c.state === 'cooldown') label = `MASKOWANIE ZERWANE — ${CLOAK_BREAK_LABELS[c.lastBreak?.reason] || ''} · ${Math.ceil(c.cooldown)} S`;
    else if (c.state === 'on') label = 'MASKOWANIE';
    else if (c.state === 'engaging') label = 'MASKOWANIE…';
    else label = 'MASKOWANIE — ŁADOWANIE';
    const frac = Math.max(0, Math.min(1, c.energy / c.tune.maxEnergy));
    const key = `${label}|${Math.round(frac * 200)}`;
    if (key === last.cloakKey) return;
    last.cloakKey = key;
    cloakEl.className = `st-cloak on${c.state === 'cooldown' ? ' cooldown' : ''}`;
    cloakLabel.textContent = label;
    cloakFill.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  return {
    root,
    // Pasy kinowe przed startem pętli gry (lot intro w tle menu) — potem prowadzi je update().
    preCinematic(on) {
      root.hidden = !on;
      root.classList.toggle('cinematic', !!on);
      last.active = on ? true : null;
      last.cinematic = !!on;
    },
    update(env = {}) {
      const active = !!story.active;
      if (active !== last.active) { root.hidden = !active; last.active = active; }
      if (!active) return;
      const cin = !!story.letterbox;
      if (cin !== last.cinematic) { root.classList.toggle('cinematic', cin); last.cinematic = cin; }
      const d = story.dialogue;
      setDialogue(d?.active ? d.current : null, d?.mode || 'scene');
      // cel i samouczek chowają się na czas kina
      setObjective(cin ? null : story.ui.objective);
      setHint(cin ? null : story.ui.hint);
      if (cin) { for (const [, node] of markerEls) node.el.remove(); markerEls.clear(); }
      else setMarkers(env);
      const b = story.ui.banner;
      const bt = b ? b.text : null;
      if (bt !== last.bannerText) {
        last.bannerText = bt;
        if (bt) banner.textContent = bt;
        banner.classList.toggle('on', !!bt);
      }
      setSummary(story.ui.summary);
      setAction(cin ? null : story.ui.action);
      setCloak(env.shipEntity);
    }
  };
}
