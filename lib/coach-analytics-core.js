// ══════════════════════════════════════════════════════
// VUE COACH — Analyse d'ouvertures (OA) : SOCLE pur (patron `EX`/explorer-core).
//
// La section lit les documents d'analyse déposés dans Supabase (`oa_analyses`)
// par le worker local `py -m oa.eecoach_worker` (D18). Ce socle porte l'état
// partagé `OA` (muté, jamais réassigné) et les helpers PURS — zéro dépendance
// (ni DOM ni state) → testés par Vitest (tests/coach-analytics-core.test.js).
//
// RÈGLE (identique à coach-core) : ce fichier n'importe rien de ses frères
// `coach-analytics*` → le graphe reste acyclique.
// ══════════════════════════════════════════════════════

// État partagé de la section. MUTÉ en place, jamais réassigné.
export const OA = {
  modId: null,        // module sélectionné (clé de G.oaAnalyses)
  bucket: 'all',      // tranche Elo filtrée ('all' | 1600 | 1800 | …)
  tab: 'errors',      // onglet courant : 'errors' | 'gaps' | 'diag'
  gapColor: null,     // couleur affichée dans « Trous » (null = repColor du doc)
  sel: new Set(),     // index (dans doc.errors) cochés → « Créer un paquet »
};

// ── Libellés de tranche (le dialecte FIDE d'oa : les buckets Explorer sont des
// Elo LICHESS ≈ FIDE +250 ; on affiche les deux pour ne pas mentir au coach). ──
export function bucketShort(bucket) {
  return bucket === 'all' ? 'Toutes' : `${bucket}+`;
}

export function bucketLabel(bucket, fideMap) {
  if (bucket === 'all') return 'Toutes les tranches';
  const fide = fideMap && fideMap[String(bucket)];
  return fide ? `${bucket}+ Lichess · ≈${fide} FIDE` : `${bucket}+ Lichess`;
}

// ── Formats FR (mêmes règles de goût qu'oa : jamais « winrate », virgule FR). ──
export function fmtLoss(cp) {
  if (cp == null) return '';
  const pawns = Math.abs(cp) / 100;
  const val = pawns.toFixed(2).replace('.', ',');
  return `perd ${val} ${pawns >= 2 ? 'pions' : 'pion'}`;
}

export function fmtPct(f) {
  if (f == null) return '';
  return `${Math.round(f * 100)} %`;
}

export function fmtCrit(c) {
  return (c == null) ? '' : c.toFixed(2).replace('.', ',');
}

// Δ points de victoire (delta_winrate d'oa) : « −29 pts de victoire ».
export function fmtDwr(dwr) {
  if (dwr == null) return '';
  return `−${Math.round(Math.abs(dwr) * 100)} pts de victoire`;
}

// ── Filtre des erreurs par tranche (le doc est déjà trié par criticality). ──
export function filterErrors(errors, bucket) {
  const list = errors || [];
  return bucket === 'all' ? list : list.filter(e => e.bucket === bucket);
}

// ── Erreur → kp d'exercice EECoach (« Créer un paquet »). ──
// Le drill pose la position OÙ l'humain se trompe (le camp fautif au trait) et
// demande LE meilleur coup → ligne d'un seul coup (longueur impaire, invariant
// moteur des exercices). Renvoie null si l'erreur est incomplète.
export function errorToKp(err) {
  if (!err || typeof err.fen !== 'string' || err.fen.split(/\s+/).length < 4) return null;
  if (!err.bestSan) return null;
  return { fen: err.fen, san: err.bestSan, comment: errorComment(err) };
}

// Le commentaire pédagogique du kp (montré avec la solution) : le contexte
// chiffré qui rend l'exercice parlant — la ligne, la faute fréquente, son coût.
export function errorComment(err) {
  const parts = [];
  if (err.line) parts.push(err.line);
  const freq = err.freq != null ? `${fmtPct(err.freq)} jouent ${err.san} ici` : null;
  const cost = err.lossCp != null ? fmtLoss(err.lossCp) : '';
  if (freq) parts.push(`À ${bucketShort(err.bucket)}, ${freq}${cost ? ` (${cost})` : ''}.`);
  return parts.join(' — ');
}
