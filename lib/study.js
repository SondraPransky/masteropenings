// ══════════════════════════════════════════════════════
// STUDY — UI de la phase « Apprentissage » du drill.
// Extrait de lib/drill.js (décomposition dette juillet 2026, cf. CLAUDE.md §3).
// Deux sous-phases :
//   • phase « study » (arbre d'étude, mode ligne principale + sous-variantes,
//     carte pédagogique, « devine le coup ») ;
//   • phase « learn » (parcours guidé de la ligne avant le test).
// État session partagé : lib/session.js (`S`). Cœur pur : lib/drill-core.js.
// Fonctions app-level (board, feedback…) résolues au runtime via le pont window,
// comme lib/drill.js. `Chess` = global CDN.
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { G } from '../state.js';
import { isPlayerMove, chapterCount, chapterPgn, buildTreeModule, applyChapTitles } from './tree.js';
import { _normFen, splitPgnGames, replacePgnGame } from './core.js';
import { pgnToEditorTree, editorTreeToPGN, nagGlyphs } from './editor-core.js';

// ── Ponts vers app.js / lib/drill.js (résolus au runtime via le pont window) ──
const currentSession    = (...a) => window.currentSession?.(...a);
const drawBoard         = (...a) => window.drawBoard?.(...a);
const resizeBoard       = (...a) => window.resizeBoard?.(...a);
const setFeedback       = (...a) => window.setFeedback?.(...a);
const clearFeedback     = (...a) => window.clearFeedback?.(...a);
const updateSessionInfo = (...a) => window.updateSessionInfo?.(...a);
const startTreeDrill    = (...a) => window.startTreeDrill?.(...a);   // reste dans lib/drill.js
const toast             = (...a) => window.toast?.(...a);
const save              = (...a) => window.save?.(...a);
const saveModule        = (...a) => window.saveModule?.(...a);
const fig        = (x) => window.fig ? window.fig(x) : x;
const figText    = (x) => window.figurineText ? window.figurineText(x) : x;   // coups inline d'un commentaire → figurines
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

function startStudyPhase() {
  const d = S.drill;
  // Module a CHAPITRES : on n'etudie que la partie du chapitre courant (sessionIdx).
  // Parser d.pgn entier fusionnerait les chapitres (les parties se rejouent depuis
  // la racine de la 1re et les coups illegaux sont silencieusement sautes).
  const sess = window.currentSession?.() || d.sessions?.[0];
  const startFen = sess?.startFen || new Chess().fen();
  const pgn = chapterCount(d) > 1 ? chapterPgn(d, S.sessionIdx) : d.pgn;
  let root = null;
  if (pgn) { try { root = pgnToEditorTree(pgn, startFen); } catch(e) { root = null; } }
  if (!root || !root.children.length) { startTreeDrill(); return; }   // pas d'arbre exploitable → révision directe
  S.phase = 'study';
  S.studyStartFen = startFen;
  S.studyTree = root;
  window.updateSessionInfo?.();   // barre « Chapitre N/M » visible des l'apprentissage
  S.studyMaxDepth = (function md(n, depth){ let m = depth; n.children.forEach(c => { m = Math.max(m, md(c, depth+1)); }); return m; })(root, 0);
  S.hintSquare = null; S.sel = null;
  _studyOpenVars.clear();   // repli auto : on repart des seules branches du chemin courant
  document.getElementById('learn-card').style.display    = 'block';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('pos-card').style.display      = 'none';
  document.getElementById('test-btns').style.display     = 'none';
  document.getElementById('score-card').style.display    = 'none';
  document.getElementById('history-card').style.display  = 'none';
  _setStudyLayout(true);
  clearFeedback();
  studyGoPath([0]);
}

// Bascule la mise en page « apprentissage » : info-card masquée, panneau des
// coups élargi (CSS) + plus haut + police plus grande pour mieux voir les coups.
function _setStudyLayout(on) {
  const grid  = document.getElementById('drill-grid');
  const info  = document.getElementById('drill-info-card');
  const title = document.getElementById('learn-card-title');
  const nota  = document.getElementById('learn-notation');
  const cm    = document.getElementById('learn-comment');
  const card  = document.getElementById('learn-card');
  const guessRow = document.getElementById('study-guess-row');
  if (grid) grid.classList.toggle('study-mode', on);
  if (info) info.style.display = on ? 'none' : '';
  if (guessRow) guessRow.style.display = on ? 'block' : 'none';
  S.studyGuess = false;   // « devine le coup » toujours désactivé à l'entrée/sortie de l'étude
  const gb = document.getElementById('study-guess-btn');
  if (gb) { gb.classList.remove('active'); gb.innerHTML = '<i class="ti ti-target" aria-hidden="true"></i> Devine le coup'; }
  if (on) {
    if (nota)  { nota.style.maxHeight = 'min(50vh, 440px)'; nota.style.fontSize = '13.5px'; nota.style.lineHeight = '1.85'; }
    if (cm)    { cm.style.display = 'none'; }   // commentaires déjà affichés en ligne dans le PGN → boîte inutile
    if (card)  { card.style.marginTop = '0'; card.style.paddingTop = '14px'; }   // remonte le bloc (pas d'espace perdu au-dessus)
    if (title) title.innerHTML = '<i class="ti ti-book" aria-hidden="true"></i> ' + escapeHtml(S.drill?.name || 'Apprentissage');
  } else {
    if (nota)  { nota.style.maxHeight = '160px'; nota.style.fontSize = ''; nota.style.lineHeight = ''; }
    if (cm)    { cm.style.display = ''; cm.style.height = '58px'; cm.style.minHeight = ''; cm.style.maxHeight = ''; cm.style.fontSize = ''; }
    if (card)  { card.style.marginTop = ''; card.style.paddingTop = ''; }
    const bubble = document.getElementById('study-bubble'); if (bubble) { bubble.style.display = 'none'; bubble.innerHTML = ''; }
    if (title) title.innerHTML = '<i class="ti ti-book" aria-hidden="true"></i> Apprentissage';
  }
  resizeBoard();   // re-ajuste le plateau à la nouvelle largeur de colonne
}

function studyGoPath(path) {
  if (!S.studyTree) return;
  let node = S.studyTree, g = new Chess(S.studyStartFen);
  const valid = [];
  for (const idx of path) { if (!node.children[idx]) break; node = node.children[idx]; g.move(node.san); valid.push(idx); }
  S.studyPath = valid;
  S.studyNode = node;
  S.lineGame  = g;
  drawBoard();
  renderStudyTree();
  updateStudyProgress();
  renderStudyBubble();
  renderStudyCoachTools();   // coach : boutons supprimer/promouvoir la variante sélectionnée
}

// ── Édition de variantes DEPUIS la notation du module (coach, grill 29/07) ──────
// Le coach parcourt son répertoire (vue étude) et peut supprimer/promouvoir une
// sous-variante sans ouvrir l'éditeur plein écran. Réservé au coach, sur ses PROPRES
// modules « arbre » (pas les couches élève ni les paquets d'exercices).
function _studyCanEditVariations() {
  const d = S.drill;
  return G.currentRole === 'teacher' && !!d && d.varmode === 'tree'
      && !d.isExercise && !d.overlayOf && !d.personal;
}

// Re-dérive S.studyTree depuis le module (PGN inchangé) — pour ANNULER une mutation
// en mémoire si la persistance échoue.
function _studyReloadTree() {
  const d = S.drill; if (!d) return;
  const sess = window.currentSession?.() || d.sessions?.[S.sessionIdx];
  const startFen = sess?.startFen || new Chess().fen();
  const pgn = chapterCount(d) > 1 ? chapterPgn(d, S.sessionIdx) : d.pgn;
  try { S.studyTree = pgnToEditorTree(pgn, startFen); } catch (e) {}
}

// Sérialise S.studyTree (déjà muté) → remplace SA partie du PGN → rebâtit le module
// → enregistre. Patron _saveEditorChapter (headers préservés, chapitre ciblé). Renvoie
// false (et recharge l'arbre) si le rebuild échoue : aucune divergence PGN↔affichage.
function _studyPersistTree() {
  const d = S.drill; if (!d) return false;
  const edited = editorTreeToPGN(S.studyTree, S.studyStartFen);
  const movetext = edited.replace(/^\s*(?:\[[^\]]*\]\s*)+/, '').trim();
  const sess = window.currentSession?.() || d.sessions?.[S.sessionIdx];
  const gi = sess?.gameIdx ?? S.sessionIdx ?? 0;
  const orig = splitPgnGames(d.pgn)[gi] || '';
  const mHead = orig.match(/^\s*(?:\[[^\]]*\]\s*)+/);
  const headers = mHead ? mHead[0].trim() : '[Event "?"]';
  const newPgn = replacePgnGame(d.pgn, gi, headers + '\n\n' + (movetext || '*'));
  const rebuilt = buildTreeModule({ id: d.id, name: d.name, pgn: newPgn, side: d.side,
    level: d.level, deadline: d.deadline, hideComments: d.hideComments });
  if (!rebuilt) { toast('❌ Modification impossible — rien n\'a changé', 'ko'); _studyReloadTree(); return false; }
  applyChapTitles(rebuilt.sessions, d.chapTitles);
  d.pgn = newPgn; d.tree = rebuilt.tree; d.sessions = rebuilt.sessions; d.updatedAt = Date.now();
  save();
  if (G.currentUser && G.currentRole === 'teacher') saveModule(d);
  return true;
}

function studyDeleteVariation() {
  if (!_studyCanEditVariations() || !(S.studyPath || []).length) return;
  const label = S.studyNode?.san ? fig(S.studyNode.san) : 'cette variante';
  if (!confirm(`Supprimer « ${label} » et toute sa suite ? Enregistré immédiatement.`)) return;
  let parent = S.studyTree;
  for (const idx of S.studyPath.slice(0, -1)) parent = parent.children[idx];
  parent.children.splice(S.studyPath[S.studyPath.length - 1], 1);
  const parentPath = S.studyPath.slice(0, -1);
  if (_studyPersistTree()) { studyGoPath(parentPath); toast('✓ Variante supprimée', 'ok'); }
  else studyGoPath(S.studyPath.slice(0, -1));   // rechargé : on remonte au parent
}

function studyPromoteVariation() {
  if (!_studyCanEditVariations() || !(S.studyPath || []).length) return;
  let parent = S.studyTree;
  for (const idx of S.studyPath.slice(0, -1)) parent = parent.children[idx];
  const li = S.studyPath[S.studyPath.length - 1];
  if (li === 0) return;                          // déjà la ligne principale à cette bifurcation
  const node = parent.children.splice(li, 1)[0];
  parent.children.unshift(node);
  const newPath = [...S.studyPath.slice(0, -1), 0];
  if (_studyPersistTree()) { studyGoPath(newPath); toast('✓ Variante promue en ligne principale', 'ok'); }
  else _studyReloadTree(), studyGoPath([]);
}

// Affiche/masque les outils coach selon la sélection (nœud non-racine + droits + hors « devine »).
function renderStudyCoachTools() {
  const row = document.getElementById('study-coach-tools');
  if (!row) return;
  const can = !S.studyGuess && _studyCanEditVariations() && (S.studyPath || []).length >= 1;
  row.style.display = can ? 'flex' : 'none';
  if (!can) return;
  const promoteBtn = document.getElementById('study-promote-btn');
  if (promoteBtn) promoteBtn.disabled = (S.studyPath[S.studyPath.length - 1] === 0);
}

// Carte pédagogique : en-tête = coup courant (figurine + NAG), corps = commentaire
// VERBATIM du PGN du coach. Rien à afficher → masquée.
function renderStudyBubble() {
  const el = document.getElementById('study-bubble'); if (!el) return;
  const node = S.studyNode;
  const c = node && node.comment ? node.comment : '';
  if (!c) { el.style.display = 'none'; el.innerHTML = ''; return; }
  let head = '<i class="ti ti-bulb" aria-hidden="true"></i>';
  if (node.san && node.fenBefore) {
    const parts = node.fenBefore.split(' ');
    const white = parts[1] === 'w';
    head += ` <span class="study-card-move">${parts[5] || ''}${white ? '.' : '…'} ${fig(node.san)}${nagGlyphs(node)}</span>`;
  }
  el.innerHTML = `<div class="study-card-head">${head}</div><div class="study-card-body">${figText(escapeHtml(c))}</div>`;
  el.style.display = 'block';
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');   // relance l'animation d'apparition
}

// ── « Devine le coup » : rappel actif pendant l'étude (testing effect) ──
// L'élève joue le prochain coup sur l'échiquier au lieu de le lire.
function _studyGuessReady() {
  if (!S.studyGuess || !S.studyNode) return false;
  const nxt = S.studyNode.children && S.studyNode.children[0];
  return !!(nxt && isPlayerMove(nxt.fenBefore, S.drill?.side));
}

function toggleStudyGuess() {
  S.studyGuess = !S.studyGuess;
  const btn = document.getElementById('study-guess-btn');
  if (btn) { btn.classList.toggle('active', S.studyGuess); btn.innerHTML = S.studyGuess ? '<i class="ti ti-target" aria-hidden="true"></i> Devine : activé' : '<i class="ti ti-target" aria-hidden="true"></i> Devine le coup'; }
  S.sel = null;
  if (S.studyGuess) { _studyGuessSync(); _studyGuessPrompt(); }
  else { clearFeedback(); studyGoPath(S.studyPath || []); }
  renderStudyCoachTools();   // masque les outils coach en mode « devine », les rétablit sinon
}

// Révèle automatiquement les coups adverses : l'élève ne devine que SES coups.
function _studyGuessSync() {
  let path = (S.studyPath || []).slice(), node = S.studyNode, guard = 0;
  while (guard++ < 300) {
    const nxt = node && node.children && node.children[0];
    if (!nxt || isPlayerMove(nxt.fenBefore, S.drill?.side)) break;
    path.push(0); node = nxt;
  }
  studyGoPath(path);
}

function _studyGuessPrompt() {
  if (_studyGuessReady()) setFeedback('hint', '🎯 Joue le prochain coup sur l\'échiquier', '');
  else if (!(S.studyNode && S.studyNode.children && S.studyNode.children.length)) setFeedback('ok', '✓ Ligne terminée — bravo !', '');
  else clearFeedback();
}

function tryStudyGuess(from, to) {
  const expected = S.studyNode && S.studyNode.children && S.studyNode.children[0];
  if (!expected) return;
  const g = new Chess(S.lineGame.fen());
  const mv = g.move({ from, to, promotion: 'q' });
  S.sel = null;
  if (!mv) { drawBoard(); return; }                       // coup illégal → on ignore
  if (mv.san === expected.san) {
    studyGoPath([...(S.studyPath || []), 0]);             // révèle le bon coup
    _studyGuessSync();                                     // révèle la réponse adverse, repasse le trait à l'élève
    _studyGuessPrompt();
  } else {
    drawBoard();
    setFeedback('ko', "✗ Ce n'est pas le coup principal — réessaie", '');
    const cv = document.getElementById('board');
    if (cv) { cv.classList.remove('shake'); void cv.offsetWidth; cv.classList.add('shake'); }
  }
}

// Vue resserrée en mode devine : coups joués (format `.mv` unifié) + « ? » pour le
// coup à trouver (masqué, comme en test).
function renderStudyGuessLine() {
  const el = document.getElementById('learn-notation'); if (!el) return;
  let node = S.studyTree, h = '';
  for (const idx of (S.studyPath || [])) {
    node = node.children[idx]; if (!node) break;
    const white = node.fenBefore.split(' ')[1] === 'w';
    if (white) h += `<span class="mv-num">${node.fenBefore.split(' ')[5]}.</span>`;
    h += `<span class="mv played">${fig(node.san)}</span>`;
  }
  const nxt = node && node.children && node.children[0];
  if (nxt) {
    const white = nxt.fenBefore.split(' ')[1] === 'w';
    h += `<span class="mv-num">${nxt.fenBefore.split(' ')[5]}${white ? '.' : '…'}</span>`;
    h += `<span class="mv ask">?</span>`;
  } else {
    h += `<span class="mv ok">✓ Ligne terminée</span>`;
  }
  el.innerHTML = h;
}

function studyNext() { if (S.studyNode && S.studyNode.children && S.studyNode.children.length) studyGoPath([...(S.studyPath || []), 0]); }
function studyPrev() { if (S.studyPath && S.studyPath.length) studyGoPath(S.studyPath.slice(0, -1)); }

function updateStudyProgress() {
  const lnum = document.getElementById('learn-pos-num');
  if (lnum) {
    const n = S.studyNode;
    if (!n || !n.san) { lnum.textContent = 'Position de départ'; lnum.style.color = 'var(--dim)'; }
    else { const isP = isPlayerMove(n.fenBefore, S.drill?.side); lnum.textContent = isP ? '● Ton coup' : "○ Coup adverse"; lnum.style.color = isP ? 'var(--cyan)' : 'var(--dim)'; }
  }
  const depth = (S.studyPath || []).length;
  const prog = document.getElementById('learn-prog'); if (prog) prog.textContent = depth + ' / ' + (S.studyMaxDepth || depth);
  const fill = document.getElementById('learn-prog-fill'); if (fill) fill.style.width = (S.studyMaxDepth ? Math.round(depth / S.studyMaxDepth * 100) : 0) + '%';
  const prevB = document.getElementById('learn-prev-btn'); if (prevB) prevB.disabled = depth === 0;
  const nextB = document.getElementById('learn-next-btn'); if (nextB) nextB.disabled = !(S.studyNode && S.studyNode.children && S.studyNode.children.length);
  const testBtn = document.querySelector('#learn-card .btn-primary'); if (testBtn) testBtn.innerHTML = '<i class="ti ti-player-play" aria-hidden="true"></i> Commencer la révision';
}

// État de maîtrise SM-2 d'un coup de l'élève dans l'arbre d'étude.
// → 'known' (révisé, pas encore dû), 'due' (à revoir), ou null (pas un coup élève / jamais vu).
function _studyMastery(node) {
  if (!node || !node.san || typeof _normFen !== 'function') return null;
  if (!isPlayerMove(node.fenBefore, S.drill?.side)) return null;   // seuls les coups de l'élève sont révisés
  const student = S.student || G.currentUser?.displayName || G.currentUser?.email || 'Anonyme';
  const did = String(S.drill?.id ?? '');
  const m = G.masteryData[`${student}_${did}_${_normFen(node.fenBefore)}_${node.san}`];
  if (!m) return null;                              // jamais révisé
  return m.due <= Date.now() ? 'due' : 'known';
}

// ── Sous-variantes : montage « P1 + R3 » (design arbitré 30/07, planches web) ──
// P1 : repli AUTOMATIQUE piloté par la navigation — la branche du chemin courant
//      est dépliée + surlignée (.on), les autres se résument à leurs premiers coups
//      (.off) avec « déplier » (état _studyOpenVars, remis à zéro à chaque étude).
// R3 : les données Leitner remontent dans la notation — ✓/● par coup (déjà là) et
//      BILAN par branche repliée (« ● N à revoir » / « ✓ acquise »).
// R1 : sommaire des branches en tête, SEULEMENT si ≥ 3 branches de 1er niveau
//      (sinon fil d'Ariane). Purement présentationnel : ni données ni moteur.
let _studyOpenVars = new Set();   // branches dépliées à la main (clés = JSON du chemin)
function studyToggleVar(key) {
  if (_studyOpenVars.has(key)) _studyOpenVars.delete(key); else _studyOpenVars.add(key);
  renderStudyTree();
}

function renderStudyTree() {
  const el = document.getElementById('learn-notation'); if (!el) return;
  if (S.studyGuess) return renderStudyGuessLine();   // mode rappel actif : on masque les coups à venir
  const curPath = S.studyPath || [];
  const curStr = JSON.stringify(curPath);
  // Indicateurs de maîtrise (réutilise les données Leitner de la révision).
  // ⚠ marges des DEUX côtés : l'ancienne pastille (margin-left seul) se collait
  // au numéro du coup suivant.
  const masteredMark = '<span title="Maîtrisé" style="color:var(--green-ink);font-size:.82em;font-weight:700;margin:0 3px">✓</span>';
  const dueMark = '<span title="À revoir" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--gold);vertical-align:middle;margin:0 3px"></span>';

  const moveSpan = (node, path, depth, lead, bif) => {
    const isCur = JSON.stringify(path) === curStr;
    // ⚠ Le coup courant vit dans la classe .study-cur (style.css) : blanc sur
    // --cyan tenait en clair mais tombait à 2,98:1 en sombre (#818cf8) — même
    // remède que les boutons pleins du 16/07 (encre foncée en sombre).
    // Hiérarchie par GRAISSE et encre, jamais par taille (design 30/07) ; le coup
    // de bifurcation (1er d'une variante) ressort en 600.
    const s = isCur ? 'font-weight:700'
            : depth === 0 ? 'color:var(--text);font-weight:600'
            : bif ? 'font-weight:600'
            : 'font-weight:400';
    // Coup annoté : soulignement pointillé (le marqueur fait partie du coup — fin
    // de la pastille flottante qui se collait au numéro suivant)
    const cls = [isCur ? 'study-cur' : '', node.comment ? 'study-note' : ''].filter(Boolean).join(' ');
    return `<span ${isCur?'id="study-active" ':''}${cls?`class="${cls}" `:''}onclick="studyGoPath(${JSON.stringify(path)})" style="cursor:pointer;${lead||''}${s};padding:1px 3px;border-radius:var(--rs)">${fig(node.san)}${nagGlyphs(node)}</span>`;
  };
  // Un demi-coup : numéro (blanc, ou début de ligne forcé) + coup + marques SR.
  const ply = (node, path, depth, showNum, first, bif) => {
    const white = node.fenBefore.split(' ')[1] === 'w';
    const lead = first ? '' : 'margin-left:6px;';
    let h = '';
    if (showNum) {
      h += `<span style="color:var(--dim);font-size:.72rem;${lead}">${node.fenBefore.split(' ')[5]}${white?'.':'…'}</span>`;
      h += moveSpan(node, path, depth, '', bif);
    } else {
      h += moveSpan(node, path, depth, lead, bif);
    }
    const mast = _studyMastery(node);
    if (mast === 'known') h += masteredMark;
    else if (mast === 'due') h += dueMark;
    return h;
  };
  const isPrefix = (p) => p.length <= curPath.length && p.every((v, i) => curPath[i] === v);
  // Bilan SR d'une branche entière (R3) : nb de coups dus / connus dans le sous-arbre
  const branchSr = (n) => {
    let due = 0, known = 0;
    (function walk(x) {
      const m = _studyMastery(x);
      if (m === 'due') due++; else if (m === 'known') known++;
      (x.children || []).forEach(walk);
    })(n);
    return { due, known };
  };
  const countPlies = (n) => { let c = 1; (n.children || []).forEach(x => { c += countPlies(x); }); return c; };
  const srSumHTML = (sr) => sr.due > 0
    ? `<span class="study-srsum" title="Positions à revoir dans cette variante">● ${sr.due} à revoir</span>`
    : sr.known > 0 ? `<span class="study-srsum done" title="Variante acquise">✓ acquise</span>` : '';

  // Une variante = un paragraphe (.study-var). Active → dépliée ; sinon résumé.
  function branchHTML(v, vPath, depth) {
    const key = JSON.stringify(vPath);
    const active = isPrefix(vPath);
    const open = active || _studyOpenVars.has(key);
    let h = `<div class="study-var ${active ? 'on' : 'off'}">`;
    if (open) {
      h += ply(v, vPath, depth, true, true, true) + mainline(v, vPath, depth, false);
      if (!active) h += ` <span class="study-more" onclick="studyToggleVar('${key}')">replier</span>`;
    } else {
      // Résumé : coup de bifurcation + jusqu'à 2 coups de sa suite, puis « déplier »
      h += ply(v, vPath, depth, true, true, true);
      let pos = v, path = vPath, shown = 1;
      while (shown < 3 && pos.children && pos.children.length) {
        const mv = pos.children[0], p = [...path, 0];
        const white = mv.fenBefore.split(' ')[1] === 'w';
        h += ply(mv, p, depth, white, false, false);
        pos = mv; path = p; shown++;
      }
      const hidden = countPlies(v) - shown;
      h += `<span class="study-more" onclick="studyToggleVar('${key}')">…&nbsp;déplier${hidden > 0 ? ` · ${hidden} coups` : ''}</span>`;
      h += srSumHTML(branchSr(v));
    }
    return h + `</div>`;
  }

  function mainline(pos, path, depth, freshFirst) {
    let h = '', first = true, fresh = freshFirst;
    while (pos.children && pos.children.length) {
      const mv = pos.children[0], mvPath = [...path, 0];
      const white = mv.fenBefore.split(' ')[1] === 'w';
      h += ply(mv, mvPath, depth, white || fresh, first, false);
      pos.children.slice(1).forEach((v, vi) => { h += branchHTML(v, [...path, vi + 1], depth + 1); });
      fresh = pos.children.length > 1;   // après une variante on réaffiche le numéro
      first = false;
      pos = mv; path = mvPath;
    }
    return h;
  }

  // ── En-tête : sommaire des branches (R1, si ≥ 3 au 1er niveau) sinon fil d'Ariane ──
  const numOf = (n) => `${n.fenBefore.split(' ')[5]}${n.fenBefore.split(' ')[1] === 'w' ? '.' : '…'}`;
  const topBranches = [];
  { let pos = S.studyTree, path = [];
    while (pos.children && pos.children.length) {
      pos.children.slice(1).forEach((v, vi) => topBranches.push({ node: v, path: [...path, vi + 1] }));
      path = [...path, 0]; pos = pos.children[0];
    } }
  let head = '';
  if (topBranches.length >= 3) {
    head = `<div class="study-toc"><span class="study-toc-lbl">Lignes</span>` + topBranches.map(b => {
      const on = isPrefix(b.path);
      const sr = branchSr(b.node);
      return `<span class="study-toc-t${on ? ' on' : ''}" onclick="studyGoPath(${JSON.stringify(b.path)})">${numOf(b.node)}${fig(b.node.san)}${nagGlyphs(b.node)}${sr.due > 0 ? '<span class="study-toc-d" title="À revoir"></span>' : ''}</span>`;
    }).join('') + `</div>`;
  } else if (topBranches.length > 0) {
    // Fil d'Ariane : la chaîne des bifurcations menant au coup courant
    const segs = [];
    let node = S.studyTree;
    for (const idx of curPath) {
      const mv = node.children[idx]; if (!mv) break;
      if (idx > 0) segs.push(`${numOf(mv)}${fig(mv.san)}`);
      node = mv;
    }
    head = `<div class="study-crumb">Tu es dans : <b>Principale</b>${segs.map(s => ` › <b>${s}</b>`).join('')}</div>`;
  }

  const body = mainline(S.studyTree, [], 0, false);
  el.innerHTML = head + (body || '<span style="color:var(--dim)">Aucun coup.</span>');
  requestAnimationFrame(() => { const a = document.getElementById('study-active'); if (a) a.scrollIntoView({ block:'nearest', behavior:'instant' }); });
}

// ══════════════════════════════════════════════════════
// PHASE APPRENTISSAGE (mode ligne) — parcours guidé avant le test
// ══════════════════════════════════════════════════════
function startLearnPhase() {
  const d    = S.drill;
  const sess = currentSession();
  const startFen = sess.startFen || new Chess().fen();
  S.phase    = 'learn';
  S.learnIdx = 0;
  // Reset ici (entrée d'une session neuve) et non dans startLineDrill : replayErrors
  // pose errorOnlySet juste avant enterTestPhase → startLineDrill, qui l'écraserait.
  S.errorOnlySet = null;

  // Préparer la liste des coups (même structure que le test)
  S.lineAllMoves = sess.moves.map((mv, i) => ({
    ...mv,
    isPlayer: isPlayerMove(mv.fenBefore, d.side),
    idx: i,
    result: null
  }));
  S.lineGame = new Chess(startFen);
  // Cursor starts on first move, not position de départ
  if (S.lineAllMoves.length > 0) {
    S.lineGame.move(S.lineAllMoves[0].san);
    S.learnIdx = 1;
  } else {
    S.learnIdx = 0;
  }
  updateSessionInfo();

  _setStudyLayout(false);   // mode ligne : info-card visible, panneau standard
  document.getElementById('learn-card').style.display = 'block';
  document.getElementById('notation-card').style.display = 'none';
  document.getElementById('test-btns').style.display = 'none';
  document.getElementById('score-card').style.display = 'none';
  document.getElementById('history-card').style.display = 'none';
  clearFeedback();
  renderLearnState();
  drawBoard();
}

function learnNext() {
  if (S.phase === 'study') return studyNext();
  if (S.learnIdx >= S.lineAllMoves.length) return;
  clearFeedback();
  const mv = S.lineAllMoves[S.learnIdx];
  S.lineGame.move(mv.san);
  S.learnIdx++;
  renderLearnState();
  drawBoard();
  // Fin de ligne : animation bouton
  if (S.learnIdx >= S.lineAllMoves.length) {
    setFeedback('ok', '✓ Tu as tout vu — lance le test !', '');
  }
}

function learnPrev() {
  if (S.phase === 'study') return studyPrev();
  if (S.learnIdx <= 0) return;
  clearFeedback();
  S.learnIdx--;
  const startFen = currentSession().startFen || new Chess().fen();
  S.lineGame = new Chess(startFen);
  for (let i = 0; i < S.learnIdx; i++) S.lineGame.move(S.lineAllMoves[i].san);
  renderLearnState();
  drawBoard();
}

function renderLearnState() {
  renderLearnNotation();
  renderLearnComment();
  updateLearnProgress();
}

// Apprentissage : feuille de coups au MÊME format unifié (flux `.mv`) que le test,
// entièrement cliquable (aucun coup caché) → navigation directe dans la ligne.
function renderLearnNotation() {
  const el = document.getElementById('learn-notation');
  if (!el) return;
  if (!S.lineAllMoves.length) { el.innerHTML = '<span class="mv future">—</span>'; return; }
  let html = '';
  S.lineAllMoves.forEach((mv, i) => {
    const turn = mv.fenBefore.split(' ')[1];
    const num  = mv.fenBefore.split(' ')[5];
    if (turn === 'w')  html += `<span class="mv-num">${num}.</span>`;
    else if (i === 0)  html += `<span class="mv-num">${num}…</span>`;

    let cls = 'mv clickable';
    let id = '';
    if (i === S.learnIdx - 1)      { cls += ' cur'; id = ' id="learn-notation-active"'; }  // coup courant
    else if (i < S.learnIdx)       { cls += mv.isPlayer ? ' played' : ' auto'; }            // déjà vus
    else                           { cls += ' future'; }                                    // pas encore atteints
    const title = mv.comment ? ` title="${escapeHtml(mv.comment)}"` : '';
    html += `<span class="${cls}"${id}${title} onclick="learnGoto(${i})">${fig(mv.san)}</span>`;
  });
  el.innerHTML = html;
  requestAnimationFrame(() => {
    const a = document.getElementById('learn-notation-active');
    if (a) a.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
}

// Clic-navigation en apprentissage : rejoue la ligne jusqu'au coup cliqué (inclus).
function learnGoto(ply) {
  if (S.phase !== 'learn' || !S.lineAllMoves[ply]) return;
  clearFeedback();
  S.learnIdx = ply + 1;
  const startFen = currentSession().startFen || new Chess().fen();
  S.lineGame = new Chess(startFen);
  for (let i = 0; i < S.learnIdx; i++) S.lineGame.move(S.lineAllMoves[i].san);
  renderLearnState();
  drawBoard();
}

function renderLearnComment() {
  const el = document.getElementById('learn-comment');
  if (!el) return;
  // Si la ligne n'a aucun commentaire, on masque entièrement la boîte (pas d'espace vide inutile).
  const lineHasComments = (S.lineAllMoves || []).some(m => m && m.comment);
  if (!lineHasComments) { el.style.display = 'none'; return; }
  el.style.display = '';
  const mv = S.learnIdx > 0 ? S.lineAllMoves[S.learnIdx - 1] : null;
  const comment = mv && mv.comment ? mv.comment : '';
  if (comment) {
    el.style.background = 'var(--bg)';
    el.innerHTML = `<span style="color:var(--cyan);margin-right:5px">💬</span>${escapeHtml(comment)}`;
  } else {
    // Coup sans commentaire (mais la ligne en a ailleurs) : boîte invisible mais hauteur conservée → aucun mouvement.
    el.style.background = 'transparent';
    el.innerHTML = '';
  }
  el.scrollTop = 0;
}

function updateLearnProgress() {
  const total = S.lineAllMoves.length;
  document.getElementById('learn-prog').textContent = S.learnIdx + ' / ' + total;
  const pct = total > 0 ? Math.round(S.learnIdx / total * 100) : 0;
  const fill = document.getElementById('learn-prog-fill');
  if (fill) fill.style.width = pct + '%';
  let label, labelColor;
  if (S.learnIdx === 0) {
    label = 'Position de départ'; labelColor = 'var(--dim)';
  } else if (S.learnIdx === total) {
    label = '✓ Fin de la ligne'; labelColor = 'var(--green)';
  } else {
    const mv = S.lineAllMoves[S.learnIdx - 1];
    label = mv.isPlayer ? 'Votre coup' : 'Adversaire';
    labelColor = mv.isPlayer ? 'var(--cyan)' : 'var(--dim)';
  }
  const lnum = document.getElementById('learn-pos-num');
  lnum.textContent = label;
  lnum.style.color = labelColor;
  document.getElementById('learn-prev-btn').disabled = S.learnIdx <= 0;
  document.getElementById('learn-next-btn').disabled = S.learnIdx >= total;
  // Bouton test : s'illumine quand la ligne est vue en entier
  const testBtn = document.querySelector('#learn-card .btn-primary');
  if (testBtn) {
    const done = S.learnIdx >= total;
    testBtn.innerHTML = done ? '<i class="ti ti-player-play" aria-hidden="true"></i> Commencer le test' : '<i class="ti ti-target" aria-hidden="true"></i> Je connais la ligne — Tester';
    testBtn.style.opacity = done ? '1' : '0.75';
    testBtn.style.transform = done ? 'scale(1.02)' : '';
    testBtn.style.boxShadow = done ? '0 0 12px var(--cyan-glow)' : '';
  }
}

// ── Pont window (onclick inline + accès inter-modules) ──
Object.assign(window, {
  startStudyPhase, _setStudyLayout, studyGoPath, renderStudyBubble, _studyGuessReady, toggleStudyGuess,
  studyDeleteVariation, studyPromoteVariation, renderStudyCoachTools,
  _studyGuessSync, _studyGuessPrompt, tryStudyGuess, renderStudyGuessLine, studyNext, studyPrev,
  updateStudyProgress, _studyMastery, renderStudyTree, studyToggleVar,
  startLearnPhase, learnNext, learnPrev, learnGoto, renderLearnState, renderLearnNotation, renderLearnComment,
  updateLearnProgress,
});
