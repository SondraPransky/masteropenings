// ══════════════════════════════════════════════════════
// ÉDITEUR DE VARIANTES — plateau, drag, annotations, sauvegarde (DOM)
// Extrait d'app.js (étape 1b, cf. CLAUDE.md §5.1). Cœur pur : lib/editor-core.js.
// État éditeur (_E) local à ce module ; fonctions app-level via le pont window.
// ══════════════════════════════════════════════════════
import { pgnToEditorTree, editorTreeToPGN, _findNodeByFen, nagGlyphs, _nagGroup, NAG_GLYPH, _SHAPE_COL } from './editor-core.js';
import { extractAllLines } from './core.js';
import { _buildDrillTree, _diffAgainstCoach, _editorTreeToDrillTree } from './tree.js';
import { _normFen } from './core.js';
import { G } from '../state.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const toast = (...a) => window.toast?.(...a);
const save = (...a) => window.save?.(...a);
const fig = (x) => window.fig ? window.fig(x) : x;
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);
const showPromoPicker = (...a) => window.showPromoPicker?.(...a);
const renderDrillList = (...a) => window.renderDrillList?.(...a);
const renderClassModuleSelect = (...a) => window.renderClassModuleSelect?.(...a);
const loadStudentModules = (...a) => window.loadStudentModules?.(...a);
const saveModule = (...a) => window.saveModule?.(...a);
const _sbSaveStudentModule = (...a) => window._sbSaveStudentModule?.(...a);

// ══════════════════════════════════════════════════════
// ÉDITEUR DE VARIANTES
// ══════════════════════════════════════════════════════
const EP = { wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙', bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟' };
// Couleurs d'AUTEUR : sémantiques (qui a écrit ce coup), jamais décoratives. Passées aux
// tokens — `--violet` bascule en dark (l'hex #7c3aed n'y rendait que 3.11:1). Reliquat que
// le sweep du 16/07 avait balayé ailleurs (.pg-annotated) mais pas ici.
const COACH_COL   = 'var(--violet)';   // coach : annotations de partie (P1.4/P1.5) + réponses dans la copie de l'élève
const STUDENT_COL = 'var(--blue-ink)'; // élève : ses propres lignes greffées sur un module du coach
// La couleur d'un coup dit QUI l'a ecrit. '' = personne (ligne du coach, style par defaut).
function _authorStyle(node) {
  if (node && node.author === 'coach')   return `color:${COACH_COL};font-weight:700`;
  if (node && node.author === 'student') return `color:${STUDENT_COL};font-weight:700`;
  return '';
}
// Marqueur d'auteur NON-COLORE : violet (coach) et bleu (eleve) sont des teintes voisines,
// donc la couleur seule ne suffit pas (WCAG 1.4.1 + principe produit « jamais l'info par la
// seule couleur »). Une icone en prefixe distingue l'auteur sans dependre de la teinte, avec
// le meme vocabulaire qu'ailleurs (ti-school = coach, ti-git-branch = eleve). title = infobulle
// souris ; l'icone est aria-hidden (le SAN, lui, est identique quel que soit l'auteur).
function _authorMark(node) {
  if (node && node.author === 'coach')   return '<i class="ti ti-school ed-author-mark" aria-hidden="true" title="Ajouté par le coach"></i>';
  if (node && node.author === 'student') return '<i class="ti ti-git-branch ed-author-mark" aria-hidden="true" title="Ajouté par l\'élève"></i>';
  return '';
}
const _E = { drillIdx:-1, target:'drill', root:null, path:[], node:null, startFen:'', flipped:false, sel:null, lastFrom:null, lastTo:null };
let _eSQ = 48;

// _findNodeByFen + pgnToEditorTree → lib/editor-core.js

function openPgnEditor(i) {
  const d = G.drills[i];
  _E.target = 'drill';
  _E.drillIdx = i;
  _E.startFen = d.sessions?.[0]?.startFen || new Chess().fen();
  _E.flipped  = (d.side === 'b');
  _E.sel = _E.lastFrom = _E.lastTo = null;
  // Préférer d.pgn (contient toutes les variantes) aux sessions filtrées par varmode
  if (d.pgn) {
    try { _E.root = pgnToEditorTree(d.pgn, _E.startFen); }
    catch(e) { _E.root = null; }
  }
  if (!_E.root) {
    // Fallback : reconstruire depuis les sessions
    _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
    (d.sessions||[]).forEach(sess => {
      let node = _E.root;
      if (sess.startFen && sess.startFen !== _E.startFen) {
        const par = _findNodeByFen(_E.root, sess.startFen);
        if (par) node = par;
      }
      (sess.moves||[]).forEach(mv => {
        let ch = node.children.find(c => c.san===mv.san && c.fenBefore===mv.fenBefore);
        if (!ch) {
          const g2 = new Chess(mv.fenBefore); const r = g2.move(mv.san);
          ch = { san:mv.san, fenBefore:mv.fenBefore, fenAfter:r?g2.fen():mv.fenBefore, comment:mv.comment||'', children:[] };
          node.children.push(ch);
        }
        node = ch;
      });
    });
  }
  _E.path = []; _E.node = _E.root;
  _E.createRole = null;
  document.getElementById('editor-drill-name').value = d.name;
  document.getElementById('editor-side').value = d.side || 'w';
  document.getElementById('editor-side').style.display = 'none';   // côté déjà défini → inutile en édition
  document.getElementById('editor-level').value = d.level || 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _editorRefresh();
}

// Créer un module à partir d'un échiquier vide (role: 'teacher' | 'student')
function openPgnEditorNew(role, startFen) {
  _E.target     = 'drill';
  _E.drillIdx   = -1;
  _E.createRole = role;
  _E.startFen   = startFen || new Chess().fen();
  _E.flipped    = (new Chess(_E.startFen).turn() === 'b');   // orienter selon le trait
  _E.sel = _E.lastFrom = _E.lastTo = null;
  _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  document.getElementById('editor-drill-name').value = '';
  document.getElementById('editor-side').value = 'w';
  document.getElementById('editor-side').style.display = '';        // création : on choisit le camp
  document.getElementById('editor-level').value = 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _editorRefresh();
}

function closeEditorModal() {
  document.getElementById('modal-pgn-editor').classList.remove('on');
  // Restaurer l'éditeur en mode module par défaut (après une saisie de partie).
  _E.target = 'drill'; _E.reviewGameId = null; _E.reviewRole = null; _E.layerDrill = null;
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = '';
  const t  = document.getElementById('editor-title');       if (t)  t.textContent = '🎹 Éditeur de variantes';
  // display: la consultation coach (studentLayer/lecture seule) masque le bouton → sans
  // cette restauration il resterait invisible dans l'éditeur de module normal.
  const sv = document.getElementById('editor-save-btn');
  if (sv) { sv.textContent = '💾 Enregistrer'; sv.style.display = ''; }
}

// ── Mode « saisie de partie » (Pilier 1, P1.1b) : l'éditeur produit un PGN ──
// rendu au modal « Nouvelle partie » (métadonnées gérées là-bas). Pas de module créé.
function openGameEditor(existingPgn, startFen) {
  _E.target   = 'game';
  _E.drillIdx = -1;
  _E.createRole = null;
  _E.startFen = startFen || new Chess().fen();
  _E.flipped  = (new Chess(_E.startFen).turn() === 'b');
  _E.sel = _E.lastFrom = _E.lastTo = null;
  let root = null;
  if (existingPgn && existingPgn.trim()) {
    try { root = pgnToEditorTree(existingPgn, _E.startFen); } catch (e) { root = null; }
  }
  _E.root = root || { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  // UI : masquer les champs module, adapter le titre.
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = 'none';
  const t  = document.getElementById('editor-title');       if (t)  t.textContent = '♟️ Saisie de partie — joue les coups, puis « Terminer »';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _editorRefresh();
}

// Fin de saisie : sérialise l'arbre en PGN et le rend au modal « Nouvelle partie ».
function _saveEditorGame() {
  const pgn = editorTreeToPGN(_E.root, _E.startFen);
  let allLines;
  try { allLines = extractAllLines(pgn); } catch (e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.some(l => l.moves.length)) { toast('⚠ Joue au moins un coup sur l\'échiquier', 'ko'); return; }
  closeEditorModal();               // remet aussi _E.target='drill' + restaure l'UI module
  window._boardEntryDone?.(pgn);    // le modal (toujours ouvert dessous) récupère le PGN
}

// ── Mode « couche d'édition élève » : l'élève greffe SES lignes sur le module du coach ──
// Le module du coach n'est jamais réécrit : seul le DIFF est persisté (ligne overlay).
// L'éditeur repart TOUJOURS du PGN vivant du coach, puis on y greffe les ajouts stockés
// → une correction du coach descend jusque dans l'éditeur (pas de copie périmée).

// Greffe les coups de l'overlay (map FEN → coups) dans l'arbre de nœuds de l'éditeur.
// `depth` : garde anti-boucle — une répétition de position (P → … → P) ferait sinon
// tourner la greffe indéfiniment, l'arbre de l'éditeur étant un arbre, pas un graphe.
function _graftLayerIntoEditorTree(node, overlay, depth) {
  if (!overlay || (depth || 0) > 160) return;
  const add = overlay[_normFen(node.fenAfter)];
  if (add) {
    for (const mv of [...(add.player || []), ...(add.opp || [])]) {
      if (node.children.find(c => c.san === mv.san)) continue;   // déjà chez le coach
      const g = new Chess(node.fenAfter);
      if (!g.move(mv.san)) continue;                             // coup devenu illégal → ignoré
      node.children.push({ san: mv.san, fenBefore: node.fenAfter, fenAfter: g.fen(),
                           comment: mv.comment || '', children: [], author: mv.author || 'student' });
    }
  }
  node.children.forEach(c => _graftLayerIntoEditorTree(c, overlay, (depth || 0) + 1));
}

// `drill` est passe PAR OBJET (pas par index) : le coach ouvre la copie d'un eleve, qui
// n'a aucune entree dans G.drills — et G.drills est persiste en localStorage, donc on ne
// veut surtout pas y injecter une copie de travail.
function openStudentLayerEditor(drill, role) {
  const d = typeof drill === 'number' ? G.drills[drill] : drill;
  if (!d) return;
  _E.target = 'studentLayer';
  _E.reviewRole = role === 'coach' ? 'coach' : 'student';
  _E.layerDrill = d; _E.drillIdx = -1; _E.createRole = null;
  _E.startFen = d.sessions?.[0]?.startFen || new Chess().fen();
  _E.flipped  = (d.side === 'b');
  _E.sel = _E.lastFrom = _E.lastTo = null;
  // On repart du PGN du coach (source vivante), PAS d'une copie figée.
  const coachPgn = (d.sessions || []).map(s => s.pgn).filter(Boolean).join('\n\n');
  let root = null;
  if (coachPgn.trim()) { try { root = pgnToEditorTree(coachPgn, _E.startFen); } catch (e) { root = null; } }
  _E.root = root || { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _graftLayerIntoEditorTree(_E.root, d._layerTree, 0);
  _E.path = []; _E.node = _E.root;
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = 'none';
  const t  = document.getElementById('editor-title');
  const who = d._overlayBy?.student ? ` de ${escapeHtml(d._overlayBy.student)}` : '';
  if (t) t.innerHTML = _E.reviewRole === 'coach'
    ? `<i class="ti ti-school" aria-hidden="true"></i> ${escapeHtml(d.name)} — copie${who} · ses lignes en bleu, tes réponses en violet`
    : `<i class="ti ti-git-branch" aria-hidden="true"></i> ${escapeHtml(d.name)} — ajoute tes lignes · celles du coach restent intactes`;
  const sv = document.getElementById('editor-save-btn');
  if (sv) {
    sv.innerHTML = _E.reviewRole === 'coach'
      ? '<i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer ma réponse'
      : '<i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer mes lignes';
    sv.style.display = '';
  }
  document.getElementById('modal-pgn-editor').classList.add('on');
  _editorRefresh();
}

// Sauvegarde : arbre complet → diff contre l'arbre VIERGE du coach → seul le diff part.
// Le diff est ce qui rend l'édition additive PAR CONSTRUCTION : une ligne du coach ne
// peut pas entrer dedans, donc l'élève ne peut ni l'écraser ni se l'approprier.
function _saveEditorStudentLayer() {
  const d = _E.layerDrill;
  if (!d) { closeEditorModal(); return; }
  // Conversion DIRECTE depuis l'arbre de l'editeur, sans detour par le PGN :
  // editorTreeToPGN -> extractAllLines perdrait l'auteur (core.js jette les commentaires
  // en `[%`), donc la reponse du coach dans la copie d'un eleve serait re-taguee 'student'.
  const fullTree  = _editorTreeToDrillTree(_E.root, d.side);
  const coachTree = d._coachTree || d.tree;          // vierge si un overlay a deja ete greffe
  const diff      = _diffAgainstCoach(fullTree, coachTree);
  const role      = _E.reviewRole;
  const overlayId = d._overlayId, overlayBy = d._overlayBy, ownerId = d._overlayOwnerId;
  closeEditorModal();
  if (role === 'coach') window._coachOverlayReplyDone?.(d.id, diff, { overlayId, overlayBy, ownerId, name: d.name, side: d.side });
  else                  window._studentLayerSaveDone?.(d.id, diff, role);
}

// ── Mode « revue coach » (Pilier 1, P1.4/P1.5) : annotation additive d'une partie ──
// Le coach ouvre la partie de l'élève, AJOUTE des sous-variantes + commentaires
// (chaque coup ajouté tagué author:'coach', rendu en couleur). Ne réécrit jamais
// les coups de l'élève. `opts` = { gameId, role:'coach'|'student', white, black, flipped }.
function openReviewEditor(pgn, opts) {
  opts = opts || {};
  _E.target      = 'review';
  _E.reviewGameId = opts.gameId;
  _E.reviewRole   = opts.role === 'student' ? 'student' : 'coach';
  _E.drillIdx = -1; _E.createRole = null;
  // Position de départ : en-tête [FEN "…"] du PGN si présent (partie depuis une position), sinon standard.
  const fenHdr = (pgn || '').match(/\[FEN\s+"([^"]+)"\]/i);
  _E.startFen = (fenHdr && fenHdr[1]) ? fenHdr[1] : new Chess().fen();
  _E.flipped  = !!opts.flipped;
  _E.sel = _E.lastFrom = _E.lastTo = null;
  let root = null;
  if (pgn && pgn.trim()) { try { root = pgnToEditorTree(pgn, _E.startFen); } catch (e) { root = null; } }
  _E.root = root || { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = 'none';
  const t  = document.getElementById('editor-title');
  const who = escapeHtml((opts.white || '?') + ' – ' + (opts.black || '?'));
  if (t) t.innerHTML = _E.reviewRole === 'coach'
    ? `<i class="ti ti-school" aria-hidden="true"></i> Revue — ${who} · ajoute variantes & commentaires`
    : `<i class="ti ti-pencil" aria-hidden="true"></i> ${who} · clique un coup pour l'annoter (revue du coach en violet)`;
  const sv = document.getElementById('editor-save-btn');
  if (sv) sv.innerHTML = _E.reviewRole === 'coach'
    ? '<i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer la revue'
    : '<i class="ti ti-device-floppy" aria-hidden="true"></i> Enregistrer';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _editorRefresh();
}

// Fin de revue : sérialise l'arbre annoté et le rend à la bibliothèque (persistance là-bas).
function _saveEditorReview() {
  const pgn  = editorTreeToPGN(_E.root, _E.startFen);
  const gid  = _E.reviewGameId, role = _E.reviewRole;
  closeEditorModal();
  window._reviewSaveDone?.(gid, pgn, role);
}

// Taille de case DERIVEE de la place reelle, pas devinee par paliers de vw.
// Les paliers en dur (34/42/48) laissaient ~66px inutilises a 375px : le plateau tombait a
// 34px/case, tres sous la cible tactile — or le prof annote au doigt (decision produit du
// 17/07). Meme maladie que resizeBoard avant le 16/07, meme remede : on MESURE le chrome
// lateral (le padding de la colonne), on ne l'additionne pas de tete.
const _E_SQ_MIN = 28, _E_SQ_MAX = 48;   // 48 = la valeur desktop d'avant → desktop inchange
function _eResize() {
  const vw = window.innerWidth;
  // Repli par paliers si la colonne n'est pas encore reflowee (clientWidth 0 a l'ouverture).
  let sq = vw < 500 ? 34 : vw < 750 ? 42 : _E_SQ_MAX;
  const col = document.getElementById('editor-board-col');
  if (col && col.clientWidth > 0) {
    const cs = getComputedStyle(col);
    const padH = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    // Borne par la FENETRE autant que par la colonne : sous 860px elle est en flex-basis:100%
    // (largeur imposee par le parent → aucune circularite) ; au-dessus elle est en `auto`,
    // donc dimensionnee par son contenu — c'est _E_SQ_MAX qui empeche la boucle
    // d'agrandissement, et le desktop y est deja au plafond (la colonne fait ~490px).
    const avail = Math.min(col.clientWidth - padH, vw - padH);
    sq = Math.max(_E_SQ_MIN, Math.min(_E_SQ_MAX, Math.floor(avail / 8)));
  }
  _eSQ = sq;
  const g = document.getElementById('editor-board-grid');
  if (g) g.style.gridTemplateColumns = `repeat(8,${_eSQ}px)`;
}

// _eResize ne tournait qu'a l'OUVERTURE : tourner le telephone (portrait -> paysage, ou la
// place double) ne redimensionnait jamais le plateau. Invisible tant que la taille venait de
// paliers de vw, ça compte des qu'elle est derivee de la place — et la rotation est un geste
// reel de « j'annote dans le train ». Meme patron que board.js (debounce 120ms) ; le rendu
// suit toujours _eResize, car les cases portent leur taille en inline (renderEditorBoard).
let _eResizeTimer;
window.addEventListener('resize', () => {
  const m = document.getElementById('modal-pgn-editor');
  if (!m || getComputedStyle(m).display === 'none') return;   // editeur ferme : rien a faire
  clearTimeout(_eResizeTimer);
  _eResizeTimer = setTimeout(() => { _eResize(); renderEditorBoard(); }, 120);
});

let _eDragSq = null;


// ── Logique click éditeur (partagée click souris + tap tactile) ──
function editorClickSqLogic(sq, ex, ey) {
  const g=new Chess(_E.node.fenAfter);
  if(_E.sel){
    if(_E.sel===sq){_E.sel=null;renderEditorBoard();return;}
    const from=_E.sel, mp=g.get(from);
    if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
      const fen=_E.node.fenAfter;
      showPromoPicker(mp.color,ex,ey,pr=>{
        const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
        if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
        else{_E.sel=null;renderEditorBoard();}
      });
      return;
    }
    const mv=g.move({from,to:sq,promotion:'q'});
    if(mv){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv,g.fen());return;}
    const p=g.get(sq);
    _E.sel=(p&&p.color===g.turn())?sq:null;
    renderEditorBoard(); return;
  }
  const p=g.get(sq);
  if(p&&p.color===g.turn()){_E.sel=sq;renderEditorBoard();}
}

// ── Flèches & cases colorées (annotations PGN [%cal]/[%csl]) ──
let _eArrowFrom = null, _eArrowColor = null, _eArrowHandlers = false;
// _SHAPE_COL importé depuis editor-core.js (palette partagée avec le board principal)

// _parseShapes → lib/editor-core.js

function _editorShapesSVG(files, ranks) {
  const shapes = (_E.node && _E.node.shapes) || [];
  if (!shapes.length) return '';
  const S = _eSQ, N = 8*S;
  const ctr = sq => { const c = files.indexOf(sq[0]), r = ranks.indexOf(sq[1]); return (c<0||r<0) ? null : { x:(c+0.5)*S, y:(r+0.5)*S }; };
  let body = '';
  shapes.forEach(sh => {
    const col = _SHAPE_COL[sh.color] || _SHAPE_COL.green;
    if (sh.type === 'circle') {
      const p = ctr(sh.square); if (!p) return;
      body += `<circle cx="${p.x}" cy="${p.y}" r="${S*0.42}" fill="none" stroke="${col}" stroke-width="${S*0.07}" opacity="0.85"/>`;
    } else {
      const a = ctr(sh.from), b = ctr(sh.to); if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy)||1, ux = dx/len, uy = dy/len, ang = Math.atan2(dy,dx);
      const head = S*0.34;
      const tip = { x:b.x-ux*S*0.10, y:b.y-uy*S*0.10 };
      const lineEnd = { x:tip.x-ux*head*0.85, y:tip.y-uy*head*0.85 };
      const sx = a.x+ux*S*0.28, sy = a.y+uy*S*0.28;
      const lx = tip.x-head*Math.cos(ang-0.5), ly = tip.y-head*Math.sin(ang-0.5);
      const rx = tip.x-head*Math.cos(ang+0.5), ry = tip.y-head*Math.sin(ang+0.5);
      body += `<line x1="${sx}" y1="${sy}" x2="${lineEnd.x}" y2="${lineEnd.y}" stroke="${col}" stroke-width="${S*0.15}" stroke-linecap="round" opacity="0.8"/>`;
      body += `<polygon points="${tip.x},${tip.y} ${lx},${ly} ${rx},${ry}" fill="${col}" opacity="0.8"/>`;
    }
  });
  return `<svg width="${N}" height="${N}" viewBox="0 0 ${N} ${N}" style="position:absolute;left:0;top:0;pointer-events:none;z-index:5">${body}</svg>`;
}

function _ensureEditorArrowHandlers() {
  if (_eArrowHandlers) return;
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  grid.addEventListener('mousedown', e => {
    if (e.button !== 0) return;                            // bouton gauche uniquement
    if (!(e.ctrlKey || e.shiftKey || e.altKey)) return;    // sans touche = jouer un coup
    const c = e.target.closest('[data-sq]'); if (!c) return;
    _eArrowFrom  = c.dataset.sq;
    _eArrowColor = e.ctrlKey ? 'green' : e.shiftKey ? 'red' : 'yellow';
    e.preventDefault();                                    // empêche sélection / glisser de pièce
  });
  grid.addEventListener('mouseup', e => {
    if (!_eArrowFrom) return;
    const c = e.target.closest('[data-sq]');
    if (c) editorToggleShape(_eArrowFrom, c.dataset.sq, _eArrowColor);
    _eArrowFrom = null; _eArrowColor = null;
  });
  window.addEventListener('mouseup', () => { _eArrowFrom = null; _eArrowColor = null; });
  _eArrowHandlers = true;
}

function editorToggleShape(from, to, color) {
  if (!_E.node || !_E.node.san) { toast('Place-toi sur un coup pour annoter', 'ko'); return; }
  color = color || 'green';
  const arr = _E.node.shapes = _E.node.shapes || [];
  if (from === to) {
    const i = arr.findIndex(s => s.type==='circle' && s.square===from);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'circle', square:from, color});
  } else {
    const i = arr.findIndex(s => s.type==='arrow' && s.from===from && s.to===to);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'arrow', from, to, color});
  }
  renderEditorBoard();
}
function editorClearShapes() { if (_E.node) { _E.node.shapes = []; renderEditorBoard(); } }

// _shapesToPGN + _commentWithShapes → lib/editor-core.js

function renderEditorBoard() {
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  if (!_E?.node) return;   // éditeur jamais ouvert (ex : annulation d'une promo sur le board principal) → rien à redessiner
  const g = new Chess(_E.node.fenAfter);
  const files = _E.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = _E.flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const turn = g.turn();
  const legal = new Set();
  if (_E.sel) g.moves({square:_E.sel,verbose:true}).forEach(m=>legal.add(m.to));
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file+rank, isLight = (fi+ri)%2===0, piece = g.get(sq);
      let bg = isLight ? 'var(--board-light)' : 'var(--board-dark)';
      if (sq===_E.sel) bg='#f6f669';
      else if (sq===_E.lastFrom||sq===_E.lastTo) bg=isLight?'#cdd26e':'#aaa23a';
      const pk = piece ? (piece.color+piece.type.toUpperCase()) : null;
      const canDrag = pk && piece.color===turn;
      const pcHtml = pk ? `<img src="${window.PIECE_CDN}${pk}.svg" width="${Math.round(_eSQ*.9)}" height="${Math.round(_eSQ*.9)}" draggable="false" style="pointer-events:none;display:block">` : '';
      const drag = canDrag ? `draggable="true" ondragstart="editorDragStart(event,'${sq}')"` : '';
      let dotHtml='';
      if(legal.has(sq)){
        dotHtml=piece
          ?`<div style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(0,0,0,.28);pointer-events:none"></div>`
          :`<div style="position:absolute;width:${Math.round(_eSQ*.32)}px;height:${Math.round(_eSQ*.32)}px;border-radius:50%;background:rgba(0,0,0,.19);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none"></div>`;
      }
      html += `<div data-sq="${sq}" ${drag} onclick="editorClickSq(event,'${sq}')" ontouchstart="editorTouchStart(event,'${sq}')" ondragover="event.preventDefault()" ondrop="editorDrop(event,'${sq}')" ondragend="editorDragEnd()" style="position:relative;width:${_eSQ}px;height:${_eSQ}px;background:${bg};display:flex;align-items:center;justify-content:center;cursor:${canDrag?'grab':'default'};user-select:none;box-sizing:border-box">${pcHtml}${dotHtml}</div>`;
    });
  });
  grid.style.position = 'relative';
  grid.innerHTML = html + _editorShapesSVG(files, ranks);
  const re=document.getElementById('editor-ranks');
  if(re) re.innerHTML=ranks.map(r=>`<div style="height:${_eSQ}px;width:16px;font-size:.58rem;color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:2px">${r}</div>`).join('');
  const fe=document.getElementById('editor-files');
  if(fe) fe.innerHTML=files.map(f=>`<div style="width:${_eSQ}px;font-size:.58rem;color:var(--dim);text-align:center;margin-top:2px">${f}</div>`).join('');
}

function editorDragStart(e, sq) {
  if (e.ctrlKey || e.shiftKey || e.altKey) { e.preventDefault(); return; }   // touche tenue = flèche, pas déplacement
  _eDragSq = sq; _E.sel = sq;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', sq);
  // Ghost = juste la pièce (pas toute la case)
  const p = new Chess(_E.node.fenAfter).get(sq);
  if (p) {
    const gc = document.getElementById('ghost-canvas');
    gc.width = _eSQ; gc.height = _eSQ;
    const ctx = gc.getContext('2d');
    ctx.clearRect(0, 0, _eSQ, _eSQ);
    const img = window.pieceImgs[p.color + p.type.toUpperCase()];
    if (img?.complete) ctx.drawImage(img, 0, 0, _eSQ, _eSQ);
    gc.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;display:block;z-index:var(--z-drag)';
    e.dataTransfer.setDragImage(gc, _eSQ / 2, _eSQ / 2);
    requestAnimationFrame(() => { gc.style.display = 'none'; });
  }
}
function editorDrop(e, sq) {
  e.preventDefault();
  const from = _eDragSq; _eDragSq = null;
  if (!from || from===sq) { _E.sel=null; renderEditorBoard(); return; }
  const g = new Chess(_E.node.fenAfter);
  const mp=g.get(from);
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
    const fen=_E.node.fenAfter;
    showPromoPicker(mp.color,e.clientX,e.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
      else{_E.sel=null;renderEditorBoard();}
    });
    return;
  }
  const mv = g.move({from, to:sq, promotion:'q'});
  if (mv) { _E.lastFrom=from; _E.lastTo=sq; _E.sel=null; editorApplyMove(mv, g.fen()); }
  else { _E.sel=null; renderEditorBoard(); }
}
function editorDragEnd() { _eDragSq=null; _E.sel=null; renderEditorBoard(); }

let _eTouchFrom=null, _eTouchStartXY={x:0,y:0};
function editorTouchStart(e,sq){
  if(document.getElementById('promo-pick')?.style.display==='flex') return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  _eTouchFrom=sq; _eTouchStartXY={x:t.clientX,y:t.clientY};
  const g=new Chess(_E.node.fenAfter), p=g.get(sq);
  if(p&&p.color===g.turn()){
    const gc=document.getElementById('ghost-canvas');
    gc.width=_eSQ; gc.height=_eSQ;
    const ctx=gc.getContext('2d');
    ctx.clearRect(0,0,_eSQ,_eSQ);
    const img=window.pieceImgs[p.color+p.type.toUpperCase()];
    if(img?.complete){ctx.globalAlpha=.85;ctx.drawImage(img,0,0,_eSQ,_eSQ);ctx.globalAlpha=1;}
    gc.style.cssText=`position:fixed;left:${t.clientX-_eSQ/2}px;top:${t.clientY-_eSQ/2}px;width:${_eSQ}px;height:${_eSQ}px;pointer-events:none;display:block;z-index:var(--z-drag)`;
  }
}
document.addEventListener('touchmove',e=>{
  if(!_eTouchFrom) return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  const gc=document.getElementById('ghost-canvas');
  gc.style.left=(t.clientX-_eSQ/2)+'px'; gc.style.top=(t.clientY-_eSQ/2)+'px';
},{passive:false});
document.addEventListener('touchend',e=>{
  if(!_eTouchFrom) return;
  const gc=document.getElementById('ghost-canvas'); gc.style.display='none';
  const t=e.changedTouches[0]; if(!t){_eTouchFrom=null;return;}
  const dx=t.clientX-_eTouchStartXY.x, dy=t.clientY-_eTouchStartXY.y;
  const from=_eTouchFrom; _eTouchFrom=null;
  if(Math.sqrt(dx*dx+dy*dy)<8){
    editorClickSqLogic(from,t.clientX,t.clientY);
    return;
  }
  // Drag : destination par elementFromPoint
  const el=document.elementFromPoint(t.clientX,t.clientY);
  const cell=el?.closest('[data-sq]');
  const toSq=cell?.dataset.sq;
  if(!toSq||toSq===from){_E.sel=null;renderEditorBoard();return;}
  const fen=_E.node.fenAfter, g=new Chess(fen), mp=g.get(from);
  _E.sel=null;
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===toSq&&m.flags.includes('p'))){
    showPromoPicker(mp.color,t.clientX,t.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:toSq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv2,g2.fen());}
      else renderEditorBoard();
    });
    return;
  }
  const mv=g.move({from,to:toSq,promotion:'q'});
  if(mv){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv,g.fen());}
  else renderEditorBoard();
});

function editorClickSq(e, sq) {
  if (e && (e.ctrlKey || e.shiftKey || e.altKey)) return;   // touche tenue = annotation, pas un coup
  editorClickSqLogic(sq, e?.clientX||0, e?.clientY||0);
}

function editorApplyMove(mv, fenAfter) {
  const idx = _E.node.children.findIndex(c=>c.san===mv.san);
  if (idx>=0) { editorGoPath([..._E.path, idx]); return; }
  const newNode = { san:mv.san, fenBefore:_E.node.fenAfter, fenAfter, comment:'', children:[] };
  // Couches additives : tout coup ajouté est marqué de son auteur (rendu en couleur,
  // round-trip PGN via [%author …]). Deux cas, même mécanisme :
  //   review       — le coach annote la PARTIE de l'élève  (P1.4)
  //   studentLayer — l'élève greffe ses lignes sur le MODULE du coach, et le coach
  //                  peut ensuite lui répondre dans sa copie (tranche C).
  if (_E.target === 'review' && _E.reviewRole === 'coach') newNode.author = 'coach';
  if (_E.target === 'studentLayer') newNode.author = _E.reviewRole === 'coach' ? 'coach' : 'student';
  _E.node.children.push(newNode);
  editorGoPath([..._E.path, _E.node.children.length-1]);
}

function editorGoPath(path) {
  let node=_E.root;
  for (const idx of path) { if (!node.children[idx]) break; node=node.children[idx]; }
  _E.path=path; _E.node=node; _E.sel=null;
  renderEditorBoard(); renderEditorNotation(); renderEditorNagBar();
  _syncEditorCommentField();
}

// Rafraîchit tout l'éditeur à l'ouverture (séquence partagée par les 4 ouvreurs :
// module, nouveau, saisie de partie, revue).
function _editorRefresh() {
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar();
  _ensureEditorArrowHandlers(); _syncEditorCommentField();
}

// En revue COACH, le champ édite la couche coachComment (additive) — jamais le
// commentaire de l'élève. Partout ailleurs : comment (comportement historique).
function _isCoachReview() { return _E.target === 'review' && _E.reviewRole === 'coach'; }
function _commentKey()    { return _isCoachReview() ? 'coachComment' : 'comment'; }

// Champ commentaire : actif seulement sur un COUP (pas la position de départ). Hors d'un
// coup → désactivé + indice, sinon on tape dans le vide (editorSaveComment garde `san`).
// En mode revue, le commentaire de L'AUTRE (élève ↔ coach) s'affiche en contexte
// lecture seule au-dessus du champ : les deux couches coexistent, aucune n'écrase l'autre.
function _syncEditorCommentField() {
  const ta = document.getElementById('editor-comment');
  if (!ta) return;
  const isMove = !!_E.node.san;
  const coach  = _isCoachReview();
  ta.value = isMove ? (_E.node[_commentKey()] || '') : '';
  ta.disabled = !isMove;
  ta.placeholder = isMove
    ? (coach ? 'Ton commentaire de coach (affiché en violet pour l\'élève)…' : 'Ex : Idée clé de la variante…')
    : 'Sélectionne un coup dans la notation pour l\'annoter';
  const vb = document.getElementById('editor-comment-validate');
  if (vb) vb.disabled = !isMove;
  const ctx = document.getElementById('editor-comment-context');
  if (ctx) {
    const other = (isMove && _E.target === 'review') ? (coach ? _E.node.comment : _E.node.coachComment) : '';
    if (other) {
      ctx.style.display = '';
      ctx.style.color = coach ? 'var(--dim)' : COACH_COL;
      ctx.innerHTML = (coach ? '<i class="ti ti-user" aria-hidden="true"></i> Élève : '
                             : '<i class="ti ti-school" aria-hidden="true"></i> Coach : ')
                    + '« ' + escapeHtml(other) + ' »';
    } else ctx.style.display = 'none';
  }
}

function editorPrev() { if (_E.path.length) editorGoPath(_E.path.slice(0,-1)); }
function editorNext() { if (_E.node.children.length) editorGoPath([..._E.path, 0]); }
function flipEditorBoard() { _E.flipped=!_E.flipped; renderEditorBoard(); }
function editorSaveComment() {
  if (!_E.node.san) return;
  _E.node[_commentKey()] = document.getElementById('editor-comment').value;
  renderEditorNotation();   // aperçu live : le commentaire s'écrit dans la notation au fil de la frappe
}
// Bouton « Valider » : confirme le commentaire sur le coup (déjà pris au fil de la frappe)
// + retour visuel. La partie se sauvegarde avec « Enregistrer » (en haut).
function editorValidateComment() {
  const ta = document.getElementById('editor-comment');
  if (!ta || !_E.node.san) { toast('Sélectionne d\'abord un coup dans la notation', 'ko'); return; }
  editorSaveComment();
  ta.blur();
  toast(ta.value.trim() ? '✓ Commentaire ajouté au coup' : 'Commentaire effacé', 'ok');
}

function editorDeleteNode() {
  if (!_E.path.length) { toast('Impossible de supprimer la position de départ','ko'); return; }
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  parent.children.splice(_E.path[_E.path.length-1], 1);
  editorGoPath(_E.path.slice(0,-1));
}

function editorPromoteMain() {
  if (_E.path.length<1) return;
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  const li=_E.path[_E.path.length-1];
  if (li===0) return;
  const node=parent.children.splice(li,1)[0];
  parent.children.unshift(node);
  editorGoPath([..._E.path.slice(0,-1), 0]);
}

// ── Annotations NAG (!, ?, !?, ±, ⩲, …) ───────────────────
const NAG_QUALITY = [3,1,5,6,2,4];          // !! ! !? ?! ? ??
const NAG_EVAL    = [10,13,14,15,16,17,18,19];
// nagGlyphs + _nagGroup → lib/editor-core.js
function editorToggleNag(n) {
  if (!_E.node || !_E.node.san) return;
  const had = (_E.node.nags||[]).includes(n);
  // un seul NAG par groupe (qualité / évaluation) → cliquer remplace
  _E.node.nags = (_E.node.nags||[]).filter(x => _nagGroup(x) !== _nagGroup(n));
  if (!had) _E.node.nags.push(n);
  _E.node.nags.sort((a,b)=>a-b);
  renderEditorNotation(); renderEditorNagBar();
}
function editorClearNags() {
  if (!_E.node || !_E.node.san) return;
  _E.node.nags = [];
  renderEditorNotation(); renderEditorNagBar();
}
function renderEditorNagBar() {
  const el = document.getElementById('editor-nag-bar'); if (!el) return;
  const dis = !(_E.node && _E.node.san);
  const active = (_E.node && _E.node.nags) ? _E.node.nags : [];
  // .ed-nag-btn porte la GEOMETRIE (et la cible tactile sous hover:none — le prof annote
  // au doigt). Seules les couleurs d'etat restent inline : elles sont conditionnelles.
  const b = (n) => {
    const on = active.includes(n);
    return `<button type="button" class="ed-nag-btn" onclick="editorToggleNag(${n})"${dis?' disabled':''} title="$${n}" `
      + `style="cursor:${dis?'default':'pointer'};border:1px solid ${on?'var(--cyan)':'var(--border)'};`
      + `background:${on?'var(--cyan-dim)':'var(--surf)'};color:${on?'var(--cyan)':'var(--text-2)'};opacity:${dis?'.4':'1'}">${NAG_GLYPH[n]}</button>`;
  };
  const sep = '<span style="width:8px;display:inline-block"></span>';
  const clr = `<button type="button" class="ed-nag-btn ed-nag-clear" onclick="editorClearNags()"${(dis||!active.length)?' disabled':''} title="Effacer l'annotation" `
    + `style="cursor:${(dis||!active.length)?'default':'pointer'};`
    + `border:1px solid var(--border);background:var(--surf);color:var(--red);opacity:${(dis||!active.length)?'.4':'1'}">✕</button>`;
  el.innerHTML = NAG_QUALITY.map(b).join('') + sep + NAG_EVAL.map(b).join('') + sep + clr;
}

// Spans de commentaire d'un nœud dans la notation : couche élève (gris) + couche coach (violet).
function _cmtSpans(n) {
  const it = 'font-style:italic;font-family:var(--font-ui);font-size:.8rem';
  return (n.comment ? ` <span style="color:var(--dim);${it}">${escapeHtml(n.comment)}</span> ` : '')
       + (n.coachComment ? ` <span style="color:${COACH_COL};${it}"><i class="ti ti-school" aria-hidden="true"></i> ${escapeHtml(n.coachComment)}</span> ` : '');
}

function renderEditorNotation() {
  const el=document.getElementById('editor-notation'); if (!el) return;
  // forceNum: afficher le numéro même pour un coup noir (après une variante)
  function nodeHTML(node, path, forceNum) {
    if (!node.children.length) return '';
    const main=node.children[0], vars=node.children.slice(1);
    const mainPath=[...path,0];
    const isCur=JSON.stringify(mainPath)===JSON.stringify(_E.path);
    const isOnPath=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===mainPath.join();
    const turn=main.fenBefore.split(' ')[1], num=main.fenBefore.split(' ')[5];
    let h='';
    // 1. Coup principal avec numéro
    if (turn==='w'||forceNum) h+=`<span style="color:var(--dim);font-size:.72rem">${num}${turn==='w'?'.':'…'}</span> `;
    const s=isCur?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
      (_authorStyle(main) ? _authorStyle(main) :
       isOnPath?'color:var(--text);font-weight:600':'color:var(--text-2)');
    h+=`<span onclick="editorGoPath(${JSON.stringify(mainPath)})" style="cursor:pointer;${s};padding:1px 4px;border-radius:3px">${_authorMark(main)}${fig(main.san)}${nagGlyphs(main)}</span>`;
    h+=_cmtSpans(main);
    // 2. Variantes immédiatement après le coup principal
    vars.forEach((v,vi) => {
      const vPath=[...path,vi+1];
      const isCurV=JSON.stringify(vPath)===JSON.stringify(_E.path);
      const isOnV=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===vPath.join();
      const vTurn=v.fenBefore.split(' ')[1], vNum=v.fenBefore.split(' ')[5];
      const vs=isCurV?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
        (_authorStyle(v) ? _authorStyle(v) :
         isOnV?'color:var(--text);font-weight:600':'color:var(--dim)');
      h+=` <span style="color:var(--dim)">(</span><span style="color:var(--dim);font-size:.72rem">${vNum}${vTurn==='w'?'.':'…'}</span> `;
      h+=`<span onclick="editorGoPath(${JSON.stringify(vPath)})" style="cursor:pointer;${vs};padding:1px 4px;border-radius:3px">${_authorMark(v)}${fig(v.san)}${nagGlyphs(v)}</span>`;
      h+=_cmtSpans(v);
      h+=nodeHTML(v,vPath,false);
      h+=`<span style="color:var(--dim)">)</span>`;
    });
    // 3. Continuation ligne principale (avec numéro si des variantes ont été affichées)
    h+=' '+nodeHTML(main, mainPath, vars.length>0);
    return h;
  }
  el.innerHTML = nodeHTML(_E.root,[],false) || '<span style="color:var(--dim);font-size:.8rem">Aucun coup — jouez sur l\'échiquier pour commencer</span>';
}

// editorTreeToPGN(root) → lib/editor-core.js

function saveEditorDrill() {
  if (_E.target === 'studentLayer') { _saveEditorStudentLayer(); return; }  // couche élève → seul le diff part
  if (_E.target === 'game')   { _saveEditorGame(); return; }   // mode saisie de partie (P1.1b) → PGN rendu au modal
  if (_E.target === 'review') { _saveEditorReview(); return; } // mode revue coach (P1.4) → PGN annoté rendu à la bibliothèque
  const pgn  = editorTreeToPGN(_E.root, _E.startFen);
  const name = (document.getElementById('editor-drill-name').value || '').trim();
  const side =  document.getElementById('editor-side').value || 'w';
  const level = document.getElementById('editor-level').value || 'Intermédiaire';
  if (!name) { toast('⚠ Donne un nom au module', 'ko'); return; }
  let allLines;
  try { allLines = extractAllLines(pgn); } catch(e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.some(l => l.moves.length)) { toast('⚠ Joue au moins un coup sur l\'échiquier', 'ko'); return; }

  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup à enregistrer', 'ko'); return; }
  const sessions = [{ label: 'Arbre complet', startFen: _E.startFen || new Chess().fen(), moves: [], kps: [] }];

  let d, isNew = false;
  if (_E.drillIdx < 0) {
    // Création
    isNew = true;
    d = {
      id: Date.now(),
      name, level, side, pgn,
      mode: 'line', varmode: 'tree', tree, sessions,
      hideComments: false, deadline: null, personal: false, ownerStudentId: null,
      created: new Date().toLocaleDateString('fr-FR'),
      updatedAt: Date.now()
    };
    if (_E.createRole === 'student') { d.personal = true; d.ownerStudentId = G.currentUser?.uid || null; }
    G.drills.push(d);
  } else {
    // Modification
    d = G.drills[_E.drillIdx];
    d.name = name; d.side = side; d.pgn = pgn; d.level = level;
    d.varmode = 'tree'; d.mode = 'line';
    d.tree = tree; d.sessions = sessions;
    d.updatedAt = Date.now();
  }

  save(); closeEditorModal();

  // Persistance selon la propriété du module
  if (G.currentUser) {
    if (d.personal) _sbSaveStudentModule(d);
    else if (G.currentRole === 'teacher') saveModule(d);
  }

  // Rafraîchir la bonne vue
  if (G.currentRole === 'student') loadStudentModules();
  else { renderDrillList(); renderClassModuleSelect(); }

  toast(isNew ? '✓ Module créé' : '✓ Module mis à jour', 'ok');
}

// Touches ← → dans l'éditeur
document.addEventListener('keydown', e => {
  if (!document.getElementById('modal-pgn-editor')?.classList.contains('on')) return;
  const tag=document.activeElement?.tagName;
  if (tag==='TEXTAREA'||tag==='INPUT') return;
  if (e.key==='ArrowRight') { e.preventDefault(); editorNext(); }
  if (e.key==='ArrowLeft')  { e.preventDefault(); editorPrev(); }
});



// ── Pont window : handlers onclick inline + accès depuis app.js (cancelPromo) ──
Object.assign(window, { _E, openPgnEditor, openPgnEditorNew, closeEditorModal, _eResize, editorClickSqLogic, _editorShapesSVG, _ensureEditorArrowHandlers, editorToggleShape, editorClearShapes, renderEditorBoard, editorDragStart, editorDrop, editorDragEnd, editorTouchStart, editorClickSq, editorApplyMove, editorGoPath, editorPrev, editorNext, flipEditorBoard, editorSaveComment, editorValidateComment, editorDeleteNode, editorPromoteMain, editorToggleNag, editorClearNags, renderEditorNagBar, renderEditorNotation, saveEditorDrill, openGameEditor, openReviewEditor, openStudentLayerEditor });
