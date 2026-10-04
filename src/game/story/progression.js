// ============================================================
// Postęp gracza (2026-09-30): doświadczenie (EXP) i stopnie. Czysta logika — stan w PLAYER.progress.
// Progi i nazwy stopni to dane do strojenia (fabuła może je zmienić bez ruszania kodu).
// ============================================================

export const RANKS = Object.freeze([
  Object.freeze({ id: 'kmdr_por', name: 'Komandor porucznik', exp: 0 }),
  Object.freeze({ id: 'kmdr', name: 'Komandor', exp: 1500 }),
  Object.freeze({ id: 'kontradm', name: 'Kontradmirał', exp: 4000 }),
  Object.freeze({ id: 'wiceadm', name: 'Wiceadmirał', exp: 9000 }),
  Object.freeze({ id: 'adm', name: 'Admirał', exp: 18000 })
]);

export function createProgress() {
  return { exp: 0, rank: 0, missionsDone: [] };
}

export function rankIndexForExp(exp) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if ((Number(exp) || 0) >= RANKS[i].exp) idx = i;
  return idx;
}

/**
 * Dodaje EXP; zwraca { gained, exp, rank, promoted: [nazwy nowych stopni] }. Ujemne EXP — 0 (kary to reputacja).
 */
export function grantExp(progress, amount) {
  const gained = Math.max(0, Math.round(Number(amount) || 0));
  const before = rankIndexForExp(progress.exp);
  progress.exp = (Number(progress.exp) || 0) + gained;
  const after = rankIndexForExp(progress.exp);
  progress.rank = after;
  const promoted = [];
  for (let i = before + 1; i <= after; i++) promoted.push(RANKS[i].name);
  return { gained, exp: progress.exp, rank: after, promoted };
}

/** Postęp do następnego stopnia: { rank, name, next (nazwa | null), frac 0..1, toNext (EXP) }. */
export function rankProgress(progress) {
  const exp = Number(progress?.exp) || 0;
  const idx = rankIndexForExp(exp);
  const cur = RANKS[idx];
  const nxt = RANKS[idx + 1] || null;
  if (!nxt) return { rank: idx, name: cur.name, next: null, frac: 1, toNext: 0 };
  const span = Math.max(1, nxt.exp - cur.exp);
  return { rank: idx, name: cur.name, next: nxt.name, frac: Math.min(1, (exp - cur.exp) / span), toNext: nxt.exp - exp };
}
