// ══════════════════════════════════════════════════════
// lib/motifs-core.js — POURQUOI un coup est une faute (cœur pur, testé Vitest).
//
// L'assistant faiblesses savait QUE l'élève avait gaffé (perte en centipions) et
// QUEL coup le moteur préférait — jamais POURQUOI. Pour un enfant, « −3,4 » ne
// dit rien ; « ton fou en c4 est resté en prise » ou « ♘d5 faisait une fourchette
// roi-dame » se comprend et se retient.
//
// Inspiré de l'idée du projet QUEEN (princeton-nlp : motifs tactiques expliqués
// en langage naturel), mais CODE ORIGINAL : leurs détecteurs sont un portage de
// lichess-puzzler (AGPL), qu'on ne reprend pas pour ne pas contaminer la licence.
// Ici, une poignée de motifs simples, sûrs, vérifiés sur chess.js — mieux vaut
// ne rien dire qu'expliquer faux.
//
// API : explainFault(fenBefore, playedSan, bestSan) → [phrase, …] (0 à 2).
// `Chess` est le global habituel (CDN en navigateur, injecté en test).
// ══════════════════════════════════════════════════════

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' };
const figSan = (san) => String(san).replace(/^([KQRBN])/, m => FIG[m] || m);
const other = (c) => (c === 'w' ? 'b' : 'w');

// Même position, autre camp au trait (case en passant effacée : elle ne vaut
// que pour le camp qui vient de subir la poussée).
function withTurn(fen, turn) {
  const f = fen.split(' ');
  f[1] = turn; f[3] = '-';
  try { return new Chess(f.join(' ')); } catch (e) { return null; }
}

// Les coups LÉGAUX de `side` qui prennent sur `sq`.
function capturesOn(fen, side, sq) {
  const g = withTurn(fen, side);
  if (!g) return [];
  return g.moves({ verbose: true }).filter(m => m.to === sq && m.captured);
}

// `sq` (pièce de `owner`) est-elle défendue ? On la « déguise » en pièce adverse
// et on regarde si son propre camp pourrait la reprendre.
function isDefended(fen, sq, owner) {
  const g = withTurn(fen, owner);
  if (!g) return false;
  const pc = g.get(sq);
  if (!pc) return false;
  g.remove(sq);
  g.put({ type: pc.type === 'k' ? 'q' : pc.type, color: other(owner) }, sq);
  return g.moves({ verbose: true }).some(m => m.to === sq);
}

// Une pièce est EN PRISE si l'adversaire peut la prendre et qu'elle n'est pas
// défendue, ou qu'un preneur vaut moins qu'elle.
function hangs(fen, sq, owner) {
  const g0 = withTurn(fen, owner);
  const pc = g0 ? g0.get(sq) : null;
  if (!pc || pc.type === 'k' || pc.type === 'p') return false;
  const takers = capturesOn(fen, other(owner), sq);
  if (!takers.length) return false;
  if (!isDefended(fen, sq, owner)) return true;
  return takers.some(m => VAL[m.piece] < VAL[pc.type]);
}

// Cibles d'une FOURCHETTE posée par la pièce arrivée en `sq` (camp `side`) :
// roi en échec, ou pièces non-pions qui valent plus que l'attaquant / non défendues.
function forkTargets(fenAfter, sq, side) {
  const g = withTurn(fenAfter, side);
  if (!g) return [];
  const me = g.get(sq);
  if (!me) return [];
  // Une « fourchette » dont la pièce se fait prendre gratis n'en est pas une.
  if (hangs(fenAfter, sq, side)) return [];
  const targets = [];
  const after = new Chess(fenAfter);
  if (after.in_check()) targets.push('k');
  for (const m of g.moves({ verbose: true })) {
    if (m.from !== sq || !m.captured || m.captured === 'p' || m.captured === 'k') continue;
    if (VAL[m.captured] > VAL[me.type] || !isDefended(fenAfter, m.to, other(side))) {
      targets.push(m.captured);
    }
  }
  return targets.length >= 2 ? targets : [];
}

function listPieces(types) {
  const names = types.map(t => (t === 'k' ? 'le roi' : `${t === 'q' || t === 'r' ? 'la' : 'le'} ${NAME[t]}`));
  return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' et ' + names[names.length - 1];
}

// ── Ce que le meilleur coup accomplissait ───────────────────────────────────
function whyBest(fenBefore, bestSan) {
  if (!bestSan) return null;
  const g = new Chess(fenBefore);
  const side = g.turn();
  const mv = g.move(bestSan, { sloppy: true });
  if (!mv) return null;
  const s = figSan(mv.san);
  if (g.in_checkmate()) return `${s} donnait mat`;
  if (mv.captured && mv.captured !== 'p') {
    const fenB = new Chess(fenBefore).fen();
    if (!isDefended(fenB, mv.to, other(side)) || VAL[mv.captured] > VAL[mv.piece]) {
      return `${s} gagnait ${mv.captured === 'q' || mv.captured === 'r' ? 'la' : 'le'} ${NAME[mv.captured]}`;
    }
  }
  const t = forkTargets(g.fen(), mv.to, side);
  if (t.length) return `${s} faisait une fourchette sur ${listPieces(t)}`;
  return null;
}

// ── Ce que le coup joué abandonnait ─────────────────────────────────────────
function whyPlayed(fenBefore, playedSan) {
  const g = new Chess(fenBefore);
  const side = g.turn();
  const mv = g.move(playedSan, { sloppy: true });
  if (!mv) return null;
  const fen = g.fen();
  // 1. Un mat en un coup offert à l'adversaire.
  for (const r of g.moves({ verbose: true })) {
    const t = new Chess(fen); t.move(r);
    if (t.in_checkmate()) return `il permettait ${figSan(r.san)}, mat`;
  }
  // 2. La pièce qu'on vient de jouer, puis toute autre pièce, laissée en prise.
  const others = [];
  g.board().forEach((row, r) => row.forEach((c, f) => {
    const sq = 'abcdefgh'[f] + (8 - r);
    if (c && c.color === side && sq !== mv.to) others.push(sq);
  }));
  others.sort((a, b) => VAL[g.get(b).type] - VAL[g.get(a).type]);
  for (const sq of [mv.to, ...others]) {
    if (hangs(fen, sq, side)) {
      const pc = g.get(sq);
      return `${pc.type === 'q' || pc.type === 'r' ? 'la' : 'le'} ${NAME[pc.type]} en ${sq} restait en prise`;
    }
  }
  // 3. Une fourchette offerte.
  for (const r of g.moves({ verbose: true })) {
    const t = new Chess(fen); t.move(r);
    const tg = forkTargets(t.fen(), r.to, other(side));
    if (tg.length && tg.some(x => x === 'q' || x === 'r' || x === 'k')) {
      return `il permettait ${figSan(r.san)}, fourchette sur ${listPieces(tg)}`;
    }
  }
  return null;
}

function explainFault(fenBefore, playedSan, bestSan) {
  const out = [];
  try { const a = whyPlayed(fenBefore, playedSan); if (a) out.push(a); } catch (e) {}
  try { const b = whyBest(fenBefore, bestSan); if (b) out.push(b); } catch (e) {}
  return out;
}

export { explainFault, whyBest, whyPlayed, forkTargets, hangs, isDefended };
