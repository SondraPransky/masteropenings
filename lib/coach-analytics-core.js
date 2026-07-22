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
  bucket: 'all',      // tranche Elo filtrée ('all' | '1600' | …) — persistée mc_oaa_bucket (UI)
  tab: 'errors',      // onglet courant : 'errors' | 'gaps' | 'diag'
  gapColor: null,     // couleur affichée dans « Trous » (null = repColor du doc)
  sel: new Set(),     // index (dans doc.errors) cochés → « Créer un paquet »
  sort: { key: 'crit', dir: -1 },   // tri de la table (crit | freq | lossCp), -1 = desc
  pin: null,          // index d'erreur ÉPINGLÉ dans l'aperçu (clic) — null = suit le survol
  hover: null,        // index survolé (volatil, ignoré tant qu'une position est épinglée)
  onlyMine: false,    // filtre « seulement où mes élèves trébuchent »
  _bucketRead: false, // garde : la tranche persistée n'est relue qu'au 1er rendu
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

// Variantes COMPACTES pour les cellules de table. La forme longue de fmtLoss
// (« perd 0,45 pion ») est une phrase : excellente en légende et en modale,
// ruineuse dans une colonne de 60px — mesuré, elle y passait à 6 lignes et
// poussait la rangée à 122px, ce qui rejetait « Criticité » et le bouton loupe
// hors de l'écran dès 1366px. En table, l'unité est portée par l'en-tête.
export function fmtLossShort(cp) {
  if (cp == null) return '';
  return `−${(Math.abs(cp) / 100).toFixed(2).replace('.', ',')}`;
}

export function fmtDwrShort(dwr) {
  if (dwr == null) return '';
  return `−${Math.round(Math.abs(dwr) * 100)} pts`;
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
// La variante indexée garde l'index d'ORIGINE dans doc.errors (la clé de
// OA.sel) — sans elle l'UI retombait sur un indexOf par ligne (O(n²)).
export function filterErrorsIndexed(errors, bucket) {
  return (errors || []).map((e, i) => ({ e, i }))
    .filter(({ e }) => bucket === 'all' || e.bucket === bucket);
}

export function filterErrors(errors, bucket) {
  return filterErrorsIndexed(errors, bucket).map(x => x.e);
}

// Un coup en SAN plausible (Ke2, exd5, O-O, e8=Q#…) — PAS de l'UCI (« d7d6 »).
// Garde contre un bestSan absent ou dégénéré : un kp.san en UCI serait
// insoluble dans le drill (comparaison SAN normalisée stricte). ⚠ L'UCI est
// rejeté par son propre motif : « d7d6 » ressemble à une disambiguïsation SAN.
const _UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const _SAN_RE = /^(O-O(-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]?x?[a-h][1-8](=[QRBN])?)[+#]?$/;

// ── Erreur → kp d'exercice EECoach (« Créer un paquet »). ──
// Le drill pose la position OÙ l'humain se trompe (le camp fautif au trait) et
// demande LE meilleur coup → ligne d'un seul coup (longueur impaire, invariant
// moteur des exercices). Renvoie null si l'erreur est incomplète.
export function errorToKp(err) {
  if (!err || typeof err.fen !== 'string' || err.fen.split(/\s+/).length < 4) return null;
  if (!err.bestSan || _UCI_RE.test(err.bestSan) || !_SAN_RE.test(err.bestSan)) return null;
  return { fen: err.fen, san: err.bestSan, comment: errorComment(err) };
}

// ── Tri de la table (pur, sur les paires {e,i} de filterErrorsIndexed). ──
// Stable : à valeur égale, l'ordre du doc (criticality desc) est conservé.
export function sortErrors(indexed, key, dir) {
  const val = e => key === 'freq' ? (e.freq ?? 0) : key === 'lossCp' ? (e.lossCp ?? 0) : (e.crit ?? 0);
  return indexed.map((x, k) => ({ x, k }))
    .sort((a, b) => (val(a.x.e) - val(b.x.e)) * dir || a.k - b.k)
    .map(({ x }) => x);
}

// ── Index de jointure par position : normFen(err.fen) → indices d'erreurs. ──
// `normFen` est INJECTÉ (en prod : _normFen de core.js) → le helper reste pur.
// C'est la clé du croisement « erreurs Lichess × résultats de MES élèves » :
// côté EECoach une position se retrouve par _drillFenMap(drillId)[san] → fen.
export function oaaFenIndex(doc, normFen) {
  const map = new Map();
  (doc?.errors || []).forEach((e, i) => {
    if (typeof e.fen !== 'string') return;
    const nf = normFen(e.fen);
    if (!map.has(nf)) map.set(nf, []);
    map.get(nf).push(i);
  });
  return map;
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
